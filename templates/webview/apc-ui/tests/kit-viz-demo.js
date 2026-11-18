/* =============================================================================
   tests/kit-viz-demo.js - showcase plate for the visualisation elements (NOT a test page: no .html, not run by
   `apc kit test`). Open  tests/kit-viz.html?demo=1[&theme=day]  in a browser, or screenshot it in headless Edge:
     msedge --headless=new --screenshot=out.png --window-size=1280,720 --virtual-time-budget=6000 file:///.../kit-viz.html?demo=1
   Everything is fed by APC.mockViz (seeded: the picture is identical on every run).
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC, H = window.H, viz = APC.viz;
  var q = location.search;
  if (/[?&]theme=day/.test(q)) document.documentElement.setAttribute("data-theme", "day");
  var plate = document.getElementById("plate");
  /* the test page's token fixture colours the primary line green so pixel assertions are unambiguous; the demo shows the real APC Minimal look */
  var fix = document.createElement("style");
  fix.textContent = ":root,[data-theme]{--viz-line:var(--ink)}";
  document.head.appendChild(fix);

  function cap(text, x, y, w) {
    return '<div class="apc-cell" style="left:' + x + 'rem;top:' + (y - 1.15) + 'rem;width:' + w + 'rem;height:1rem;font:var(--t-micro) var(--font-ui);letter-spacing:var(--label-spacing);text-transform:uppercase;color:var(--ink-2);white-space:nowrap">' + text + "</div>";
  }
  function cell(kind, x, y, w, hh, attrs) {
    var a = "";
    for (var k in attrs) a += " " + k + "='" + String(attrs[k]).replace(/'/g, "&#39;") + "'";
    return '<div class="apc-cell" data-apc="' + kind + '" style="left:' + x + "rem;top:" + y + "rem;width:" + w + "rem;height:" + hh + 'rem"' + a + "></div>";
  }
  var html = "";
  /* row A */
  html += cap("Graph - parametric EQ (log x, nodes bound to params; wheel = Q)", 1, 2, 23);
  html += cell("graph", 1, 2, 23, 9.5, { "data-label": "Parametric EQ response", "data-xscale": "log", "data-xmin": 20, "data-xmax": 20000, "data-ymin": -18, "data-ymax": 18, "data-xunit": "Hz", "data-yunit": "dB",
    "data-nodes": JSON.stringify([{ id: "b1", x: "eq_f1", y: "eq_g1", q: "eq_q1", label: "1" }, { id: "b2", x: "eq_f2", y: "eq_g2", label: "2", color: "2" }, { id: "b3", xv: 9000, yv: -4, label: "3", color: "3" }]) });
  html += cap("Envelope - ADSR", 24.5, 2, 12);
  html += cell("envelope", 24.5, 2, 12, 9.5, { "data-label": "Amp envelope", "data-attack": "env_a", "data-decay": "env_d", "data-sustain": "env_s", "data-release": "env_r", "data-tmax": 3 });
  html += cap("XY pad", 38, 2, 11);
  html += cell("xypad", 38, 2, 11, 9.5, { "data-label": "Filter pad", "data-x": "xp_x", "data-y": "xp_y", "data-xlabel": "CUTOFF", "data-ylabel": "RESO" });
  /* row B */
  html += cap("Spectrum - 20 Hz..20 kHz, peak hold", 1, 14, 21);
  html += cell("spectrum", 1, 14, 21, 6.4, { "data-label": "Spectrum analyser", "data-viz": "demo-spec", "data-style": "fill", "data-smoothing": 0.5 });
  html += cap("Waveform / scope", 23, 14, 10);
  html += cell("waveform", 23, 14, 10, 3, { "data-label": "Sample waveform", "data-axes": "none" });
  html += cell("scope", 23, 17.4, 10, 3, { "data-label": "Oscilloscope", "data-viz": "demo-scope", "data-axes": "none" });
  html += cap("Meters", 34, 14, 8);
  html += cell("meter", 34, 14, 4.4, 6.4, { "data-label": "Output L R", "data-meter": "demo-m", "data-channels": 2, "data-input": "db" });
  html += cell("meter", 39.2, 14, 2.4, 6.4, { "data-label": "Segmented", "data-meter": "demo-m2", "data-style": "segmented", "data-input": "db", "data-ticks": "false" });
  html += cell("meter", 42.6, 14, 6.4, 2.6, { "data-label": "Horizontal", "data-meter": "demo-m3", "data-orientation": "h", "data-input": "db" });
  html += cell("meter", 42.6, 17.2, 6.4, 1.6, { "data-label": "Horizontal segmented", "data-meter": "demo-m4", "data-orientation": "h", "data-style": "segmented", "data-input": "db", "data-ticks": "false" });
  /* row C */
  html += cap("Step sequencer - gate grid (shift = accent), playhead", 1, 22.2, 24);
  html += cell("stepseq", 1, 22.2, 24, 4.9, { "data-label": "Drum steps", "data-viz": "demo-seq", "data-count": 16, "data-rows": 4, "data-row-labels": "KICK,SNARE,HAT,CLAP",
    "data-steps": JSON.stringify([[2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 1, 0], [0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1], [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]]) });
  html += cap("Value steps", 26.5, 22.2, 11);
  html += cell("stepseq", 26.5, 22.2, 11, 4.9, { "data-label": "Velocity", "data-viz": "demo-seq", "data-mode": "value", "data-count": 8, "data-numbers": "false",
    "data-steps": "[0.9,0.4,0.6,0.35,1,0.45,0.7,0.5]", "data-accents": "[true,false,false,false,true,false,false,false]" });
  html += cap("Picture + spectrum overlay", 38.5, 22.2, 10.5);
  html += cell("picture", 38.5, 22.2, 10.5, 4.9, { "data-alt": "Procedural test image", "data-overlay": "spectrum", "data-viz": "demo-spec", "data-smoothing": 0.5, "data-seed": 3, "data-fit": "cover" });
  plate.innerHTML = html;
  APC.mount(plate);

  /* data: a decaying kick-like waveform, then seeded mock frames */
  H.until(function () { return !plate.querySelector("[aria-busy]"); }, 1500).then(function () {
    var wv = plate.querySelector('[data-apc="waveform"]').__apcViz, N = 800, mn = new Float32Array(N), mx = new Float32Array(N), i, env, ph;
    for (i = 0; i < N; i++) {
      env = Math.exp(-i / 220) * (i < 8 ? i / 8 : 1);
      ph = Math.sin(i * (0.9 / (1 + i / 90)));
      mx[i] = Math.max(0.02, env * (0.35 + 0.6 * Math.abs(ph))) * (0.9 + 0.1 * Math.sin(i * 2.3));
      mn[i] = -Math.max(0.02, env * (0.3 + 0.6 * Math.abs(ph))) * (0.9 + 0.1 * Math.cos(i * 1.9));
    }
    wv.setPeaks(mn, mx);
    var g = plate.querySelector('[data-apc="graph"]').__apcViz, f = viz.logSpace(20, 20000, 240);
    var p1 = viz.biquadResponse("peak", 1000, 1.2, 6, 48000, f), ls = viz.biquadResponse("lowshelf", 120, 0.7, 3.5, 48000, f), hs = viz.biquadResponse("highshelf", 9000, 0.7, -4, 48000, f), sum = new Float32Array(240);
    for (i = 0; i < 240; i++) sum[i] = p1[i] + ls[i] + hs[i];
    var pts = []; for (i = 0; i < 240; i++) pts.push([f[i], sum[i]]);
    g.setCurves([{ points: pts, color: "accent", fill: true, label: "Total" },
      { points: Array.prototype.map.call(f, function (hz, k) { return [hz, p1[k]]; }), color: "axis", dash: true, label: "Band 1" }]);
    APC.mockViz.start({ seed: 7, manual: true, force: true });
    APC.mockViz.step(45);
    var meters = plate.querySelectorAll('[data-apc="meter"]');
    Array.prototype.forEach.call(meters, function (m, k) { if (m.__apcViz) m.__apcViz.setLevels(k === 0 ? [-9, -15] : [-14]); });
    plate.querySelector('[data-apc="meter"]').__apcViz.setLevel(-3, 0, -1.5);
    viz.push("demo-seq", { type: "playhead", step: 6 });
    H.flush(true);
    /* headless screenshots settle the viewport late: re-measure once more before the picture is taken */
    setTimeout(function () { window.dispatchEvent(new Event("resize")); viz.flush(true); }, 2500);
    var done = document.createElement("div");
    done.id = "demo-done"; done.style.display = "none"; done.textContent = "ready";
    document.body.appendChild(done);
  });
})();
