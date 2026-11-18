/* =============================================================================
   reference-plugin.js - the UI wiring of the APC Minimal reference plugin (classic script, ES5).
   Load it LAST (after the kit components and reference-backend.js).

     1. DISPLAY DSP  the filter curve (APC.viz.biquadResponse), a spectrum, a scope trace, level meters and a
                     playhead are computed from the live parameter values and pushed through the generic
                     `viz` feed (APC.viz.push). A real plugin pushes the same payloads from its analysis thread.
     2. PAGE WIRING  A/B switch, header menu, sequencer transport, and window.APC_REFERENCE.open(kind), which the
                     Hub KIT page uses for its "open an overlay" strip (settings, presets, licence, update, ...).
   Everything it draws comes from the kit elements and design tokens. No network, no storage, no telemetry.
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC, root = document.documentElement, B = APC && APC.refBackend;
  var state = window.__APC_REF__ || { errors: [] };
  state.mounted = 0; state.ready = false;
  window.__APC_REF__ = state;
  function fail(msg) {
    state.errors.push(msg);
    if (APC && APC.toast && APC.toast.error) APC.toast.error(msg);
    else if (window.console) console.error("[reference] " + msg);
  }
  if (!APC || !APC.mock || !APC.mount || !APC.viz || !B) { fail("the APC kit scripts or reference-backend.js did not load"); return; }
  var mock = APC.mock, viz = APC.viz;
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function v(id) { return B.value(id); }
  function idx(id) { return B.index(id); }

  var FS = 48000, N = 200, FREQS = viz.logSpace(20, 20000, N);
  var TYPES = ["lowpass", "highpass", "bandpass", "notch"];
  function filterDb(freqs, out) {
    var type = TYPES[idx("flt_type")], R = v("flt_reso"), x24 = idx("flt_slope") === 1;
    var stage = viz.biquadResponse(type, v("flt_cutoff"), Math.pow(10, R / (x24 ? 40 : 20)), 0, FS, freqs);
    var pk = viz.biquadResponse("peak", v("pk_freq"), 1.1, v("pk_gain"), FS, freqs), m = v("flt_mix") / 100, i, f, lin;
    for (i = 0; i < freqs.length; i++) {
      f = (x24 ? 2 : 1) * stage[i] + (type === "bandpass" ? R : 0);
      lin = m * Math.pow(10, f / 20) + (1 - m);
      out.filt[i] = 20 * Math.log10(Math.max(lin, 1e-5));
      out.peak[i] = pk[i];
    }
    return out;
  }
  var cur = { filt: new Float32Array(N), peak: new Float32Array(N) };
  var graphEl = null, graphDirty = true, harmDb = new Float32Array(48);
  function changed() { graphDirty = true; }
  B.onChange(changed);
  function paintGraph() {
    if (!graphEl || !graphEl.__apcViz || !graphDirty) return;
    graphDirty = false;
    filterDb(FREQS, cur);
    var byp = idx("fx_bypass") === 1, tot = [], pkc = [], i;
    for (i = 0; i < N; i++) { tot.push([FREQS[i], byp ? 0 : cur.filt[i] + cur.peak[i]]); pkc.push([FREQS[i], byp ? 0 : cur.peak[i]]); }
    graphEl.__apcViz.setCurves([{ points: tot, color: "accent", fill: true, label: "Total" }, { points: pkc, color: "axis", dash: true, label: "Peak band" }]);
    var hf = new Float32Array(harmDb.length), hh = [], k, tmp = { filt: new Float32Array(harmDb.length), peak: new Float32Array(harmDb.length) };
    for (k = 0; k < hf.length; k++) hh.push(110 * (k + 1));
    filterDb(hh, tmp);
    for (k = 0; k < hf.length; k++) harmDb[k] = byp ? 0 : tmp.filt[k] + tmp.peak[k];
  }

  var BINS = 160, specBuf = new Float32Array(BINS), specF = viz.logSpace(20, 20000, BINS), specFilt = { filt: new Float32Array(BINS), peak: new Float32Array(BINS) };
  var seed = 0x5eed, rnd = function () { seed = (seed + 0x6D2B79F5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  var frame = 0, running = false, playing = false, bpm = 120, timer = 0;
  function frameSpectrum(t) {
    filterDb(specF, specFilt);
    var byp = idx("fx_bypass") === 1, g = v("out_gain") + v("flt_drive") * 0.25, i, f, db, k, base0 = 110 * (1 + 0.12 * Math.sin(t * 0.4)), d;
    for (i = 0; i < BINS; i++) {
      f = specF[i];
      db = -52 - 3.5 * Math.log(Math.max(f, 20) / 100) / Math.LN2 + (rnd() - 0.5) * 5;
      for (k = 1; k <= 40; k++) { d = Math.log(f / (base0 * k)) / Math.LN2; if (d > -0.09 && d < 0.09) db = Math.max(db, -14 - 6 * Math.log(k) / Math.LN2 - Math.abs(d) * 220 + Math.sin(t * 1.7 + k) * 2); }
      specBuf[i] = clamp(db + (byp ? 0 : specFilt.filt[i] + specFilt.peak[i]) + g, -100, 0);
    }
    viz.push("ref-spec", { type: "spectrum", db: specBuf, log: true });
  }
  var scopeBuf = new Float32Array(512);
  function frameScope(t) {
    var i, k, s, mx = 0, ph = t * 2.3, amp, w;
    for (i = 0; i < 512; i++) {
      s = 0; w = (i / 512) * Math.PI * 4;
      for (k = 1; k <= 24; k++) { amp = Math.pow(10, (idx("fx_bypass") === 1 ? 0 : harmDb[k - 1]) / 20) / k; s += amp * Math.sin(k * (w + ph)); }
      scopeBuf[i] = s; if (Math.abs(s) > mx) mx = Math.abs(s);
    }
    var norm = 0.8 / Math.max(mx, 0.8);
    for (i = 0; i < 512; i++) scopeBuf[i] *= norm;
    viz.push("ref-scope", { type: "waveform", samples: scopeBuf });
  }
  var lastRd = 0, clipTimer = 0;
  function frameMeters(t, ts) {
    var byp = idx("fx_bypass") === 1, inL = -19 + 7 * Math.sin(t * 1.1) + 3 * Math.sin(t * 3.7) + (rnd() - 0.5) * 2, inR = inL - 1.2 + 2 * Math.sin(t * 0.8 + 1);
    if ((frame % 330) > 318) { inL += 15; inR += 14; }                  /* a transient now and then: clip lamp */
    var drive = byp ? 0 : v("flt_drive") * 0.35, gain = v("out_gain"), cutLoss = byp ? 0 : -clamp((Math.log(v("flt_cutoff") / 20000) / Math.LN10) * -3, 0, 8);
    var outL = inL + gain + drive + cutLoss, outR = inR + gain + drive + cutLoss;
    viz.push("ref-in", { type: "meter", db: [inL, inR] });
    viz.push("ref-out", { type: "meter", db: [outL, outR] });
    if (ts - lastRd > 150) {
      lastRd = ts;
      mock.meter("ref.in", Math.max(inL, inR)); mock.meter("ref.out", Math.max(outL, outR));
      mock.meter("ref.cpu", 0.12 + 0.03 * Math.sin(t * 0.7) + (v("os_quality") === "4x" ? 0.12 : v("os_quality") === "2x" ? 0.05 : 0));
    }
  }
  function lfoWave() {
    var el = document.getElementById("rp-lfo-wave"), s = [], i, shape = v("lfo_shape"), x;
    if (!el || !el.__apcViz) return;
    for (i = 0; i < 256; i++) {
      x = i / 256;
      s.push(shape === "Sin" ? Math.sin(x * 2 * Math.PI) : shape === "Tri" ? 1 - 4 * Math.abs(x - 0.5) + 0 : shape === "Saw" ? 2 * x - 1 : (x < 0.5 ? 0.9 : -0.9));
    }
    el.__apcViz.setSamples(s);
  }
  function tick(ts) {
    timer = 0;
    if (!running) return;
    var t = frame / 30;
    paintGraph();
    if (!document.hidden) {
      frameSpectrum(t); frameScope(t); frameMeters(t, ts || 0);
      if (playing) viz.push("ref-seq", { type: "playhead", step: Math.floor(t * (bpm / 60) * 4) % 16 });
      frame++;
    }
    timer = setTimeout(function () { tick(window.performance ? performance.now() : Date.now()); }, 1000 / 30);
  }
  function startFeeds() {
    var calm = viz.reducedMotion && viz.reducedMotion();
    if (calm) { paintGraph(); frameSpectrum(2); frameScope(2); frameMeters(2, 1e9); frame = 0; return; }   /* one static frame */
    running = true; tick(0);
  }

  /* =============================================================================================================
     3. PAGE WIRING
     ============================================================================================================= */
  function $(sel) { return document.querySelector(sel); }
  var abActive = "A";
  function wire() {
    graphEl = $('[data-apc="graph"]');
    lfoWave();
    // LFO shape display follows the parameter
    mock.on("param", function (e) { if (e && e.id === "lfo_shape") lfoWave(); });
    // A/B switch -> bridge
    var ab = document.getElementById("rp-ab");
    if (ab) ab.addEventListener("apc:change", function (e) {
      var want = e.detail && e.detail.value;
      if (want && want !== abActive) mock.call("apc.presets.ab", { action: "toggle" });
    });
    mock.on("preset", function (e) {
      var st = e && (e.state || e), a = st && st.ab && st.ab.active, h = ab && ab.__apcW;
      if (a) abActive = a;
      if (a && h && h.getValue && h.getValue() !== a) { var i = a === "B" ? 1 : 0; if (h.setIndex) h.setIndex(i); }
    });
    // header menu
    var menu = document.getElementById("rp-menu");
    if (menu && menu.__apcW) menu.__apcW.onselect = function (it) {
      switch (it && it.id) {
        case "init": mock.call("apc.presets.init", {}); break;
        case "copyab": mock.call("apc.presets.ab", { action: "copyAtoB" }); break;
        case "presets": api.open("presets"); break;
        case "settings": APC.emit("settings:open", {}); break;
        case "license": APC.emit("license:open", {}); break;
        case "update": APC.emit("update:open", {}); break;
        case "help": APC.help && APC.help.mode(!APC.help.isMode()); break;
        case "about": APC.emit("settings:open", { tab: "about" }); break;
      }
    };
    // sequencer transport and tempo
    var play = document.getElementById("rp-play"), bp = document.getElementById("rp-bpm");
    if (play) play.addEventListener("apc:change", function (e) { playing = !!(e.detail && e.detail.pressed); if (!playing) viz.push("ref-seq", { type: "playhead", step: -1 }); });
    if (bp) bp.addEventListener("apc:change", function (e) { var n = Number(e.detail && e.detail.value); if (n >= 40 && n <= 240) bpm = n; });
    // clip lamp follows the output meter
    APC.on("meter:clip", function (e) {
      var led = document.getElementById("rp-clip");
      if (e && /out/.test(e.id || "") && led && led.__apcW) led.__apcW.setState(e.on ? "error" : "off");
    });
  }

  /* overlays for the Hub strip (and for people poking at the page from a console) */
  var api = window.APC_REFERENCE = {
    kinds: ["settings", "presets", "license", "update", "context", "menu", "help", "tooltip", "close"],
    open: function (kind) {
      var knob = $('[data-apc="knob"][data-param="flt_cutoff"]'), r;
      api.close();
      switch (kind) {
        case "settings": APC.emit("settings:open", {}); return true;
        case "presets": { var b = $(".apc-pc__browse"); if (b) { b.click(); return true; } return false; }
        case "license": APC.emit("license:open", {}); return true;
        case "update": APC.emit("update:open", {}); return true;
        case "context":
          if (!knob || !knob.__apcCtl || !APC.context) return false;
          r = knob.getBoundingClientRect();
          APC.context.open(knob.__apcCtl, { x: r.right + 8, y: r.top + 4, via: "pointer" }); return true;
        case "menu": { var mb = $("#rp-menu button"); if (mb) { mb.click(); return true; } return false; }
        case "help": if (APC.help) { APC.help.mode(true); return true; } return false;
        case "tooltip": if (APC.help && knob) { APC.help.showTooltip(knob); return true; } return false;
      }
      return false;
    },
    close: function () {
      try {
        if (APC.help) { if (APC.help.isMode && APC.help.isMode()) APC.help.mode(false); APC.help.hideTooltip(); }
        if (APC.context && APC.context.close) APC.context.close();
        if (APC.widgets && APC.widgets.closeAll) APC.widgets.closeAll();
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      } catch (e) { /* nothing open */ }
    },
    state: state
  };

  /* errors recorded before this script ran (the Hub's /kit-demo/_early.js) become visible toasts */
  function drainEarly() {
    var q = window.__apcDemoErrors;
    if (q && typeof q.forEach === "function") q.forEach(function (m) { fail(String(m)); });
    window.__apcDemoErrors = { push: function (m) { fail(String(m)); } };
    if (!q) {
      window.addEventListener("error", function (e) { fail("script error: " + (e && e.message)); });
      window.addEventListener("unhandledrejection", function (e) { fail("unhandled rejection: " + String(e && e.reason)); });
    }
  }
  drainEarly();

  try {
    APC.mount(document);
    wire();
    var all = document.querySelectorAll("[data-apc]"), n = 0, i;
    for (i = 0; i < all.length; i++) if (all[i].__apc) n++;
    state.mounted = n;
    root.setAttribute("data-ref-mounted", String(n));
    startFeeds();
    state.ready = true;
    root.setAttribute("data-ref-ready", state.errors.length ? "0" : "1");
  } catch (e) {
    fail("reference plugin failed to start: " + (e && e.message ? e.message : e));
    root.setAttribute("data-ref-ready", "0");
  }
})();
