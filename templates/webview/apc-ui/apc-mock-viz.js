/* =============================================================================
   apc-mock-viz.js - animated MOCK data for the visualisation elements (classic script, ES5)
   Load after apc-mock.js and apc-viz.js. Mock only: a real plugin pushes the same payloads from
   the native side (event "viz" {id,data}, see apc-viz.js header / CONTRACT.md).

     APC.mockViz.start([opts])   begin feeding every id that a viz element subscribed to
     APC.mockViz.stop()          stop the timer (state kept)
     APC.mockViz.running()       -> bool
     APC.mockViz.step([n])       emit n frames synchronously (30 fps time base) - for tests / manual stepping
     APC.mockViz.seed(n)         reseed the generator and restart the frame counter (deterministic output)

   start() options: { fps:30, seed:<int>, manual:true (no timer: call step()), force:true (ignore reduced motion) }
   What is generated, per subscriber kind (the element decides by what it subscribed to, see APC.viz.subscribedIds()):
     spectrum  {type:'spectrum', db:[512 dB bins], fs:48000}           pink-ish floor + moving harmonic peaks
     meter     {type:'meter', db:[L,R]}                                 slow LFO + bursts (touches 0 dB now and then)
     waveform  scroll mode: {type:'waveform', min:[..], max:[..]}      scope mode: {type:'waveform', samples:[512]}
     scope     {type:'waveform', samples:[512]}
     stepseq   {type:'playhead', step:n}                                120 bpm, 16th notes, wraps at the element's length
     curves    (graph / envelope) are NOT animated
   Auto-start: the script starts itself on DOMContentLoaded unless prefers-reduced-motion is set, the bridge is
   native (a real plugin feeds the data), or window.APC_MOCKVIZ_AUTOSTART === false. Under reduced motion an
   explicit start() emits ONE static frame and no timer (unless {force:true}). Pauses while the tab is hidden.
   Delivery: APC.bridge._dispatch("viz", {id,data}) when it exists (so APC.bridge.on("viz") consumers also hear
   it), else APC.viz.push(id, data). No network, no timers outliving stop().
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.mockViz) return;

  var BINS = 512, SCOPE_N = 512, COLS = 24;
  var timer = 0, fps = 30, frame = 0, seedVal = 0x5eed1234, rng = null, opts = {};
  var spec = new Float32Array(BINS), colMin = new Float32Array(COLS), colMax = new Float32Array(COLS), scope = new Float32Array(SCOPE_N);
  var lastPeak = [-60, -60], burst = [0, 0];

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function reseed(n) { seedVal = n >>> 0; rng = mulberry(seedVal); frame = 0; lastPeak = [-60, -60]; burst = [0, 0]; }
  reseed(seedVal);

  function dispatch(id, data) {
    var b = APC.bridge;
    if (b && typeof b._dispatch === "function") b._dispatch("viz", { id: id, data: data });
    else if (APC.viz && APC.viz.push) APC.viz.push(id, data);
  }
  function isNative() { return !!(APC.bridge && APC.bridge.isNative); }

  /* ---- generators (pure functions of the frame counter and the seeded noise) ---- */
  function genSpectrum() {
    var t = frame / 30, i, f, db, k, h1, nyq = 24000;
    for (i = 0; i < BINS; i++) {
      f = i * nyq / (BINS - 1);
      db = -26 - 4.5 * (Math.log(Math.max(f, 20) / 100) / Math.LN2) + (rng() - 0.5) * 6;       /* pink-ish -4.5 dB/oct */
      spec[i] = db;
    }
    /* three drifting harmonic stacks */
    for (k = 1; k <= 3; k++) {
      var base = 110 * k * (1 + 0.25 * Math.sin(t * 0.35 + k)), amp = 34 - k * 6 + 6 * Math.sin(t * 1.3 + k * 2);
      for (h1 = 1; h1 <= 8; h1++) {
        f = base * h1;
        var bi = Math.round(f / nyq * (BINS - 1));
        for (i = -2; i <= 2; i++) {
          if (bi + i < 0 || bi + i >= BINS) continue;
          var v = -8 - h1 * 5 + amp - 28 + (rng() - 0.5) * 2 - Math.abs(i) * 6;
          if (v > spec[bi + i]) spec[bi + i] = v;
        }
      }
    }
    for (i = 0; i < BINS; i++) { if (spec[i] > 0) spec[i] = 0; if (spec[i] < -100) spec[i] = -100; }
    return { type: "spectrum", db: spec, fs: 48000 };
  }
  function genMeter() {
    var t = frame / 30, out = [0, 0], ch;
    for (ch = 0; ch < 2; ch++) {
      var base = -22 + 9 * Math.sin(t * (0.9 + ch * 0.13) + ch) + 4 * Math.sin(t * 3.1 + ch * 2);
      if (burst[ch] <= 0 && rng() < 0.012) burst[ch] = 6 + Math.floor(rng() * 8);
      var b = burst[ch] > 0 ? (burst[ch]--, 14 + rng() * 6) : 0;
      out[ch] = Math.min(3, base + b + (rng() - 0.5) * 2);
    }
    return { type: "meter", db: out };
  }
  function genWaveCols() {
    var t = frame / 30, i, mx, env;
    for (i = 0; i < COLS; i++) {
      var tt = t + i / COLS / 6;
      env = 0.25 + 0.55 * Math.abs(Math.sin(tt * 1.7)) * (0.6 + 0.4 * Math.sin(tt * 7.3));
      mx = Math.min(1, env * (0.7 + 0.3 * rng()));
      colMax[i] = mx; colMin[i] = -Math.min(1, env * (0.6 + 0.4 * rng()));
    }
    return { type: "waveform", min: colMin, max: colMax };
  }
  function genScope() {
    var t = frame / 30, i, p = 0, f1 = 3 + 1.5 * Math.sin(t * 0.4), ph = t * 2.2;
    for (i = 0; i < SCOPE_N; i++) {
      p = i / SCOPE_N * Math.PI * 2 * f1 + ph;
      scope[i] = 0.55 * Math.sin(p) + 0.22 * Math.sin(p * 2.01 + 0.5) + 0.1 * Math.sin(p * 3.02) + (rng() - 0.5) * 0.02;
    }
    return { type: "waveform", samples: scope };
  }

  function emitFrame() {
    var ids = APC.viz && APC.viz.subscribedIds ? APC.viz.subscribedIds() : {}, id, list, i, kinds, sp = null, me = null, wc = null, sc = null;
    for (id in ids) {
      list = ids[id];
      kinds = {};
      for (i = 0; i < list.length; i++) kinds[list[i].kind] = list[i];
      if (kinds.spectrum) { if (!sp) sp = genSpectrum(); dispatch(id, sp); }
      if (kinds.meter) { if (!me) me = genMeter(); dispatch(id, me); }
      var wv = kinds.waveform || kinds.scope;
      if (wv) {
        var wmode = wv.meta && wv.meta.mode;                 /* static waveforms are not animated */
        if (wmode === "scroll") { if (!wc) wc = genWaveCols(); dispatch(id, wc); }
        else if (wmode === "scope") { if (!sc) sc = genScope(); dispatch(id, sc); }
      }
      if (kinds.stepseq) {
        var len = (kinds.stepseq.meta && kinds.stepseq.meta.length) || 16;
        dispatch(id, { type: "playhead", step: Math.floor(frame / 30 * 8) % len });          /* 8 steps / s = 120 bpm 16ths */
      }
    }
    frame++;
  }
  function hidden() { return typeof document !== "undefined" && document.hidden; }
  function tickTimer() {
    timer = 0;
    if (!hidden()) emitFrame();
    if (running) timer = setTimeout(tickTimer, 1000 / fps);
  }
  var running = false;

  var api = APC.mockViz = {
    version: 1,
    start: function (o) {
      o = o || {};
      opts = o;
      if (o.seed !== undefined) reseed(o.seed);
      fps = o.fps > 0 ? o.fps : 30;
      var rm = APC.viz && APC.viz.reducedMotion && APC.viz.reducedMotion();
      if (rm && !o.force) { emitFrame(); return false; }          /* one static frame, no animation */
      if (running) return true;
      running = true;
      if (!o.manual) timer = setTimeout(tickTimer, 1000 / fps);
      return true;
    },
    stop: function () { running = false; if (timer) { clearTimeout(timer); timer = 0; } },
    running: function () { return running; },
    step: function (n) { n = n > 0 ? n : 1; for (var i = 0; i < n; i++) emitFrame(); return frame; },
    seed: function (n) { reseed(n === undefined ? 0x5eed1234 : n); },
    frame: function () { return frame; }
  };

  function autostart() {
    if (window.APC_MOCKVIZ_AUTOSTART === false) return;
    if (isNative()) return;
    if (APC.viz && APC.viz.reducedMotion && APC.viz.reducedMotion()) return;
    api.start();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autostart);
  else setTimeout(autostart, 0);
})();
