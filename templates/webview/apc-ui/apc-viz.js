/* =============================================================================
   apc-viz.js - APC UI kit visualisation / display elements (classic script, ES5, no network)
   graph, envelope, spectrum, waveform, scope, meter, stepseq, xypad, picture.
   Contract: CONTRACT.md. Styles: apc-viz.css (DOM parts), tokens: design_library/apc-minimal/tokens.css.
   Load order: apc-fit.js, apc-kit.js, apc-bridge.js, apc-mock.js (optional), apc-viz.js, [apc-mock-viz.js].
   CSS: apc-core.css + apc-viz.css. Guide: .agents/guides/ui-kit-viz.md. Self-test: tests/kit-viz.html.

   ----------------------------------------------------------------------------
   COMMON RULES (every element)
   - Mount declaratively: <div class="apc-cell" data-apc="NAME" data-...></div>, then APC.mount(root).
     The element fills its cell (.apc-cell absolute rem box); standalone it defaults to 20rem x 10rem
     (CSS vars --apc-viz-w / --apc-viz-h). Any number of instances per page.
   - Canvas drawings read their colours from CSS tokens AT DRAW TIME (getComputedStyle on the element) and
     redraw when: data-theme changes on <html> or any ancestor (MutationObserver), class/style of <html>/<body>
     change, APC "theme:changed" fires, the element or the rem scale resizes, or APC.viz.refreshTheme() is called.
     Tokens used (nothing else): --viz-line --viz-accent --viz-fill --viz-grid --viz-axis --viz-1..4 --meter-ok
     --meter-warn --meter-clip --led-on --led-off --step-off --step-on --step-accent --step-playhead --inset --plate
     --plate-2 --rule --rule-2 --ink --ink-2 --accent --apc-danger --apc-mod-1..8 --font-ui --t-micro --t-label
     --t-value --label-spacing --stroke --stroke-2. Optional: --apc-viz-node (node size), --apc-viz-w/-h.
   - 1 px hairlines are device-pixel aligned (canvas backing store = whole device pixels, never resampled).
   - ONE requestAnimationFrame for the page (APC.viz.raf), views repaint only when dirty, hidden (0-size) and
     offscreen (IntersectionObserver) views skip drawing. No per-frame allocation in the drawing loops.
   - Accessibility: every element has role + accessible name (data-label, else aria-label, else the element text);
     data visualisations carry a text alternative (aria-describedby -> .apc-viz-sr, updated at most once per second);
     interactive parts are real focusable elements with visible focus ring; every gesture has a keyboard path;
     prefers-reduced-motion (or APC.viz.setReducedMotion(true)) disables smoothing, falling levels and decay.
   - Errors never fail silently: bridge/param/JSON/URL problems go through APC.emit("error", {message,...}) (toast).
   - Params: values cross the bridge in real-world units (apc.params.get / apc.param.set / begin / end / reset),
     one begin..end gesture per drag / key press / wheel burst; host changes arrive as the `param` event.
   - Data feed: bridge event "viz" = { id, data } (native event name: apc.viz, a JUCE event, not a function). Elements subscribe with data-viz="<id>"
     (meter: data-meter="<id>"; falls back to the element id). Payloads (numbers as JSON arrays or Float32Array):
       spectrum   {type:"spectrum", db:[...bins dB], fs:48000, log:false}  or a bare array of dB bins
                  (bins are linear 0..fs/2; log:true = bins already log-spaced over fmin..fmax)
       meter      {type:"meter", db: n | [l,r], peak?: n | [l,r]}  or bare dB number / [l,r]
                  plus the existing bridge event meter {id,value} (value linear amplitude, or dB with data-input="db")
       waveform   {type:"waveform", min:[..], max:[..]} (peak columns) | {type:"waveform", samples:[..]}; bare array = samples
                  static: replaces, scroll: appends, scope: replaces
       stepseq    {type:"playhead", step:n} | n | {type:"steps", steps:[..], accents?:[..]}
       graph/envelope {type:"curve", values|points|x/y} | {type:"curves", curves:[..]} | bare array of y values
   - JS API: every mounted element exposes its API on el.__apcViz (= APC.viz.get(el)); init also returns it
     (it has dispose(): removes observers, RAF work, bridge listeners, DOM, timers).
   - Namespace: APC.viz = { biquadResponse, logSpace, axis, subscribe, push, flush, debug, raf, get, names, createView,
     reducedMotion, setReducedMotion, refreshTheme, ParamLink, call, now }.

   ----------------------------------------------------------------------------
   graph - general 2D plot on a canvas
     <div class="apc-cell" data-apc="graph" data-label="EQ" data-xscale="log" data-xmin="20" data-xmax="20000"
          data-ymin="-18" data-ymax="18" data-xunit="Hz" data-yunit="dB"
          data-nodes='[{"id":"b1","x":"eq_f1","y":"eq_g1","q":"eq_q1","label":"1"}]'></div>
     Options: data-label, data-xscale linear|log|sqrt (log: 10-based), data-xmin/xmax (default 0..1; 20..20000 when log),
       data-ymin/ymax (default -1..1, linear), data-xunit (default "Hz" when log), data-yunit, data-axes both|x|y|none
       (default both), data-grid (true), data-xticks / data-yticks (comma list), data-xname / data-yname (tooltip names,
       default FREQ / GAIN), data-ysigned, data-fill-base zero|bottom, data-connect (line through the nodes),
       data-curvature -1..1, data-mod (modulation overlay, default true), data-curves (JSON, see setCurves),
       data-nodes (JSON), data-viz (curve feed id), data-node-name.
     Curve spec: {fn:function(x)->y} | {points:[[x,y]..]} | {x:[..],y:[..]} | {values:[..]} (even spacing over the x
       axis); plus color ("line"|"accent"|"axis"|"1".."4"|css colour|"var(--name)"), width, fill, base, dash, label, hidden.
     Node spec: {id, label, name, color:"1".."4", x:"param id", y:"param id", q:"param id", xv, yv, qv, qmin, qmax,
       lockX, lockY}. Params make the node round-trip; without params the node is free (events only).
     Events (APC bus + DOM CustomEvent "apc-node"): graph:node {id, node, x, y, q, phase:"begin|move|end|wheel|key|reset", text}.
     JS API: setCurves(curves), getCurves(), setNodes(specs), getNodes(), setNodeValue(id,{x,y,q}), setRange({xmin,xmax,
       ymin,ymax,xscale,xunit,yunit}), getRange(), redraw(), geometry() -> {x0,y0,x1,y1,w,h,mapX,mapY,unmapX,unmapY},
       focusNode(id), getNodeElement(id), getSummary(), ready, dispose().
     Pointer: drag a node (Shift = 10x finer, modifiers latched at pointer-down), wheel on a node = Q, Alt/Option+click = reset
       the node's params, hover/focus = tooltip + guides. Hover tooltip: "FREQ 1.20 kHz  GAIN +3.0 dB  Q 0.71".
     Keyboard (focused node): Left/Right = x, Up/Down = y (1 % of the axis; Shift = 0.1 %; PageUp/PageDown = 10 %),
       + / = / ] and - / [ = Q, Delete/Backspace = reset.
     ARIA: host role="img" (no nodes) or "group" (nodes), aria-label + aria-describedby text alternative (curve peak/low);
       each node role="slider" with aria-valuemin/max/now (x) and aria-valuetext "FREQ ... GAIN ... Q ...".
     Modulation overlay: modulation routes of the node's y/x params are drawn as dashed hairlines in the --apc-mod-N colour
       beside the node, plus a live marker from `param` events carrying {modulated}.
     APC.viz.biquadResponse(type, f0, q, gainDb, fs, freqs) -> Float32Array|Array of dB (RBJ cookbook: peak, lowshelf,
       highshelf, lowpass, highpass, bandpass, notch). DISPLAY ONLY: real analysis must come from the DSP / native side.

   envelope - ADSR or free N-point envelope editor (same engine as graph)
     <div data-apc="envelope" data-attack="env_a" data-decay="env_d" data-sustain="env_s" data-release="env_r" data-tmax="3">
     <div data-apc="envelope" data-mode="multi" data-xmin="0" data-xmax="4" data-xscale="linear" data-points='[{"id":"p1","xv":0,"yv":0},..]'>
     Options: data-mode adsr|multi (adsr), data-attack/decay/sustain/release (param ids; unbound = local values), data-tmax
       (seconds on the x axis, 4), data-hold (length of the sustain plateau, tmax*0.2), data-xscale (sqrt for adsr: short
       times stay editable; linear for multi), data-curvature (0.55: fast-then-slow segments, 0 = straight), data-editable
       (multi: true), data-axes (x), data-points / data-nodes (multi), plus the graph options.
     ADSR nodes: Attack (time only), Decay+Sustain (time and level), Release (time only). Sustain is edited in the param's
       normalised range. Dragging is clamped so attack+decay+hold+release <= tmax.
     multi: points stay ordered in time, first/last points are time-locked by default; double-click on the plot adds a point,
       Insert (focused point) adds one after it, Delete/Backspace removes a free point (>= 2 stay).
     Events: envelope:node (as graph:node, + adsr:{attack,decay,sustain,release}), envelope:change {id, mode, phase:
       "end|key|reset|add|remove", adsr | points:[{id,x,y}]}.
     JS API: as graph, plus getAdsr()/setAdsr({attack,decay,sustain,release}), getPoints()/setPoints([{x,y}]).
     Keyboard / pointer / ARIA: as graph (node names Attack, Decay and sustain, Release).

   spectrum - live spectrum analyser
     <div data-apc="spectrum" data-viz="spec" data-label="Spectrum" data-style="fill" data-smoothing="0.6">
     Options: data-viz (feed id), data-style fill|line|bars (fill), data-bands (bars: 48), data-fmin/fmax (20/20000),
       data-dbmin/dbmax (-90/0), data-xscale log|linear (log), data-smoothing 0..0.98 (0.6; frame-rate independent attack/release),
       data-peak-hold (true), data-hold-ms (900), data-fall dB/s (18), data-slope dB/oct tilt around 1 kHz (0),
       data-fs default sample rate of bare arrays (48000), data-axes (both), data-grid (true).
     JS API: setData(dbArray,{fs,log}), clear(), resetPeaks(), setRange({fmin,fmax,dbmin,dbmax}), setStyle(s), getState() ->
       {cols,cur,peak,frames,style,hasData}, geometry(), redraw(), dispose().
     ARIA: role="img", aria-label, text alternative "Strongest component 1.2 kHz at -18.0 dB." (max once per second).
     Reduced motion: no smoothing, no peak fall. No pointer / keyboard interaction (display only).

   waveform / scope - waveform display, scrolling roll, oscilloscope
     <div data-apc="waveform" data-label="Sample" data-axes="none">          (static)
     <div data-apc="waveform" data-mode="scroll" data-viz="wv" data-spc="256">  (scrolling peak columns)
     <div data-apc="scope" data-viz="osc" data-trigger="true">                  (= waveform data-mode="scope")
     Options: data-mode static|scroll|scope, data-ymin/ymax (-1/1), data-yunit, data-axes (none), data-grid (true),
       data-trigger (rising zero crossing, scope), data-spc samples per column (scroll, 256), data-cols ring size (2048),
       data-samples (JSON initial samples), data-viz.
     Rendering: one min/max column per DEVICE pixel (fewer samples than pixels/2 draw a polyline).
     JS API: setSamples(arr), setPeaks(min,max), pushPeaks(min,max), pushSamples(arr), clear(), setCursor(0..1|null)
       (accent hairline), getState(), geometry(), redraw(), dispose().
     ARIA: role="img", text alternative "Range -0.5 to 0.5". Display only.

   meter - level meter
     <div data-apc="meter" data-meter="out" data-channels="2" data-label="Output" data-style="continuous">
     Options: data-meter / data-viz / id (feed id), data-meter-r (second id for the right channel), data-channels 1|2,
       data-orientation v|h, data-min/max (-60/6 dB), data-warn (-12), data-clip-at (0), data-style continuous|segmented,
       data-segments (auto), data-peak-hold (true), data-hold-ms (1500), data-fall dB/s (24), data-ticks (true),
       data-input linear|db for `meter` events (linear), data-announce (false: live-region level announcements, max 1 / 1.5 s).
     Zones: below warn --meter-ok, warn..clip --meter-warn, above --meter-clip. Peak line / peak segment in --ink.
     Ballistics: instant attack, linear fall (data-fall); clip latches (lamp + class is-clipped) until reset.
     Events: meter:clip {id, on} (also DOM "apc-clip").
     JS API: setLevel(db, ch, peakDb), setLevels([l,r]), step(ms), reset() (clip + peaks), resetClip(), getState() ->
       {level,target,peak,clip,frames,channels}, geometry(), redraw(), dispose().
     Pointer / keyboard: the clip lamp is a real <button>: click, Enter or Space resets the latch.
     ARIA: role="meter" with aria-valuemin/max/now and aria-valuetext "L -12.3 dB, R -14.0 dB, clipped" (updated max 4x/s);
       a one-shot live-region message "<label> clipped" when the latch trips.

   stepseq - step sequencer (DOM grid; crisp 1px borders)
     <div data-apc="stepseq" data-count="16" data-rows="4" data-row-labels="KICK,SNARE,HAT,CLAP" data-viz="seq" data-id="s1"
          data-steps='[[1,0,0,0,..],[..],..]'>
     Options: data-mode gate|value|pitch (gate), data-count (16, max 64), data-rows (gate 4, pitch 12, value 1), data-length
       (active steps, = count), data-group (beat grouping, 4), data-min/max (value mode, 0..1), data-numbers (step-number
       header, true), data-row-labels, data-steps (JSON), data-accents (JSON booleans, value/pitch), data-playhead,
       data-param (bridge param), data-viz (playhead feed id), data-id.
     Step data: gate = rows x count of 0 off | 1 on | 2 accent; value = count numbers (+accents[]); pitch = count rows counted
       from the BOTTOM (0 lowest), -1 = rest (+accents[]).
     Pointer: press+drag paints (starting on a lit cell erases), Shift-click = accent toggle, value mode: click/drag sets the
       value from the pointer height (Shift = unquantised, Alt = clear), pitch mode: click selects the row, click again = rest.
     Keyboard (grid, roving tabindex): arrows move (value mode: Up/Down edit, Shift = fine; pitch: Up/Down change pitch),
       Home/End first/last step, Space/Enter toggle, Shift+Space accent, Delete/Backspace clear.
     Events: APC.emit("stepseq", {id, mode, steps, accents?, length, count, phase:"change|end|key|api|length|clear"})
       (+ DOM "apc-stepseq"). With data-param the bridge gets apc.param.begin/set/end ONLY when the descriptor says it is an
       array parameter ({array:true} or type/kind "steps" or an array value); otherwise events only.
     Playhead: viz feed {type:"playhead", step:n} (wraps at the length); class is-play on the column, outline --step-playhead.
     JS API: getSteps(), getAccents(), setSteps(steps,accents), setLength(n), getLength(), setPlayhead(n), getPlayhead(),
       getCell(r,c), getActive(), clear(), redraw(), dispose().
     ARIA: role="grid" (rowcount/colcount), rows/gridcells with aria-selected and a label "Step 3, row 2 KICK: accent".

   xypad - 2-axis pad bound to two params
     <div data-apc="xypad" data-x="cutoff_hz" data-y="resonance_pct" data-xlabel="CUTOFF" data-ylabel="RESO">
     Options: data-x / data-y (param ids; unbound = local 0..1, or data-xmin/xmax/ymin/ymax), data-xlabel / data-ylabel,
       data-grid (4 divisions), data-id, data-label.
     Pointer: press jumps there and drags (absolute); Shift-press = relative fine (10x); Alt/Option+click or double-click =
       reset both params to their defaults; one begin..end gesture per drag. A tick marks the default position.
     Keyboard (thumb): arrows = 1 % (Shift 0.1 %), PageUp/PageDown = y 10 %, Home/End = x min/max, Delete/Backspace = reset.
     Events: xypad:change {id, x, y, nx, ny, phase:"begin|move|end|key|reset"} (+ DOM "apc-xypad").
     JS API: getValue() -> {x,y,nx,ny}, setValue(x,y), setNormalized(nx,ny), getThumb(), redraw(), geometry(), dispose().
     ARIA: group + thumb role="slider" (valuenow = x, valuetext "Cutoff 1 kHz, Resonance 20 %"); live readouts in the corners.

   picture - image / artwork display (photo, logo art, skin slot)
     <div data-apc="picture" data-alt="Cover art" data-src="art/cover.png" data-fit="cover">
     <div data-apc="picture" data-alt="Test image" data-overlay="spectrum" data-viz="spec">   (placeholder + overlay)
     Options: data-alt (MANDATORY accessible text; missing -> warning toast; data-alt="" = decorative, role=presentation),
       data-src (relative path or data:image/... only), data-fit contain|cover|fill (contain with src, cover without),
       data-seed (placeholder composition), data-overlay spectrum|none, data-overlay-style fill|line|bars, data-viz (overlay
       feed), plus spectrum options for the overlay.
     No src: a procedurally drawn, token-coloured geometric "photograph" stand-in (flat colours, labelled TEST IMAGE).
     Never loads from the network: http(s):, protocol-relative, file:, javascript: etc. are rejected with a visible error
       block (role=alert) and APC.emit("error"); an <img> that fails to load shows the same error.
     JS API: setSrc(url) -> bool, setFit(f), getState(), getOverlay(), redraw(), dispose().
     ARIA: role="img" with aria-label = alt. Display only.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.viz && APC.viz.__apcViz) return;
  if (!APC.register || !APC.dom) {
    if (window.console) console.error("apc-viz.js: load apc-kit.js first");
    return;
  }
  var h = APC.dom.el;
  var viz = { __apcViz: true, version: 1 };
  APC.viz = viz;

  /* ===========================================================================
     Small utilities
     =========================================================================== */
  function num(v, d) {
    if (v === undefined || v === null || v === "") return d;
    var n = Number(v);
    return isFinite(n) ? n : d;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function bool(v, d) {
    if (v === undefined || v === null) return d;
    if (v === true || v === false) return v;
    var s = String(v).toLowerCase();
    if (s === "") return true;
    return !(s === "false" || s === "0" || s === "no" || s === "off");
  }
  function pick(v, list, d) {
    var s = String(v === undefined || v === null ? "" : v).toLowerCase();
    return list.indexOf(s) >= 0 ? s : d;
  }
  function trimNum(n, d) { return String(parseFloat(Number(n).toFixed(d))); }
  function reportError(msg, detail, src) {
    APC.emit("error", { message: msg, detail: detail ? String(detail) : undefined, source: src || "apc-viz" });
  }
  function jsonOpt(raw, d, what) {
    if (raw === undefined || raw === null || raw === "") return d;
    if (typeof raw !== "string") return raw;
    try { return JSON.parse(raw); }
    catch (e) { reportError("Invalid JSON in " + what + ": " + (e && e.message ? e.message : e), e, "apc-viz"); return d; }
  }
  function listOpt(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    if (Object.prototype.toString.call(raw) === "[object Array]") return raw;
    return String(raw).split(",").map(function (s) { return s.trim(); });
  }
  function isArr(a) { return Object.prototype.toString.call(a) === "[object Array]" || (a && a.buffer && typeof a.length === "number" && typeof a !== "string"); }
  function cssNum(s, d) { var n = parseFloat(s); return isFinite(n) ? n : d; }
  function fmtValue(v, unit, digits) {
    if (APC.format && APC.format.value) return APC.format.value(v, unit, digits);
    return trimNum(v, digits === undefined ? 2 : digits) + (unit ? " " + unit : "");
  }
  function uid() { return "apcv" + (++uidN); }
  var uidN = 0;

  /* ---- reduced motion ---------------------------------------------------------- */
  var rmOverride = null, rmMq = null;
  function reducedMotion() {
    if (rmOverride !== null) return rmOverride;
    try {
      if (!rmMq && window.matchMedia) rmMq = window.matchMedia("(prefers-reduced-motion: reduce)");
      return !!(rmMq && rmMq.matches);
    } catch (e) { return false; }
  }
  viz.reducedMotion = reducedMotion;
  /* force on/off (tests, "reduce motion" switch in settings); null = follow the OS */
  viz.setReducedMotion = function (v) { rmOverride = (v === null || v === undefined) ? null : !!v; };
  viz.now = function () { return (window.performance && performance.now) ? performance.now() : Date.now(); };

  /* ===========================================================================
     Colour handling: tokens are read at draw time and normalised through a canvas
     =========================================================================== */
  var ncCtx = null, ncCache = {};
  function parseColor(str) {
    if (!ncCtx) {
      var c = document.createElement("canvas");
      c.width = c.height = 1;
      ncCtx = c.getContext("2d");
    }
    ncCtx.fillStyle = "#010203";
    ncCtx.fillStyle = str;
    var out = ncCtx.fillStyle;
    if (out === "#010203" && String(str).replace(/\s/g, "").toLowerCase() !== "#010203" && !/^rgb\(1,2,3\)$/i.test(String(str).replace(/\s/g, ""))) return "";
    return out;
  }
  function normColor(str, fallback) {
    var key = str || "", c = ncCache[key];
    if (c === undefined) { c = key ? parseColor(key) : ""; ncCache[key] = c; }
    if (c) return c;
    if (fallback === undefined) return "";
    var fk = "fb:" + fallback;
    if (ncCache[fk] === undefined) ncCache[fk] = parseColor(fallback) || fallback;
    return ncCache[fk];
  }
  viz.parseColor = function (s) { return normColor(s, ""); };

  /* [theme key, css custom property, last-resort fallback = APC Minimal night]. Components use ONLY these tokens. */
  var TOKENS = [
    ["line", "--viz-line", "#EDEAE0"], ["accent", "--viz-accent", "#FF9500"], ["fill", "--viz-fill", "rgba(255,149,0,0.16)"],
    ["grid", "--viz-grid", "#2A2823"], ["axis", "--viz-axis", "#8A877E"],
    ["v1", "--viz-1", "#FF9500"], ["v2", "--viz-2", "#56B4E9"], ["v3", "--viz-3", "#009E73"], ["v4", "--viz-4", "#F0E442"],
    ["ink", "--ink", "#EDEAE0"], ["ink2", "--ink-2", "#8A877E"], ["rule", "--rule", "#3D3A33"], ["rule2", "--rule-2", "#2A2823"],
    ["inset", "--inset", "#0B0B0B"], ["plate", "--plate", "#121211"], ["plate2", "--plate-2", "#1A1917"],
    ["ok", "--meter-ok", "#33FF33"], ["warn", "--meter-warn", "#F0E442"], ["clip", "--meter-clip", "#FF5A4D"],
    ["ledOn", "--led-on", "#FF9500"], ["ledOff", "--led-off", "#2A2823"],
    ["stepOff", "--step-off", "#0B0B0B"], ["stepOn", "--step-on", "#FF9500"], ["stepAccent", "--step-accent", "#EDEAE0"], ["playhead", "--step-playhead", "#33FF33"],
    ["danger", "--apc-danger", "#FF5A4D"],
    ["m1", "--apc-mod-1", "#e69f00"], ["m2", "--apc-mod-2", "#56b4e9"], ["m3", "--apc-mod-3", "#009e73"], ["m4", "--apc-mod-4", "#f0e442"],
    ["m5", "--apc-mod-5", "#3d9be0"], ["m6", "--apc-mod-6", "#d55e00"], ["m7", "--apc-mod-7", "#cc79a7"], ["m8", "--apc-mod-8", "#b8b8b8"]
  ];

  /* Every canvas component owns a hidden probe element whose inline style resolves the
     length/font tokens (var() + max()/rem) into used pixel values. Inline so the kit works even before the CSS loads. */
  function makeProbe() {
    var p = document.createElement("span");
    p.className = "apc-viz-probe";
    p.setAttribute("aria-hidden", "true");
    var s = p.style;
    s.position = "absolute"; s.left = "0"; s.top = "0"; s.visibility = "hidden"; s.pointerEvents = "none"; s.display = "block";
    s.overflow = "hidden"; s.margin = "0"; s.padding = "0"; s.boxSizing = "content-box";
    s.fontSize = "var(--t-label, max(10px, .625rem))";
    s.fontFamily = "var(--font-num, ui-monospace, Consolas, monospace)";
    s.letterSpacing = "var(--label-spacing, .12em)";
    s.width = "var(--t-value, max(11px, .6875rem))";          /* -> value text size */
    s.height = "var(--apc-viz-node, .625rem)";                /* -> node diameter */
    s.minWidth = "var(--t-micro, max(9px, .5rem))";           /* -> micro text size */
    s.borderLeft = "var(--stroke, 1px) solid transparent";    /* -> stroke width */
    s.borderTop = "var(--stroke-2, 2px) solid transparent";   /* -> heavy stroke width */
    return p;
  }
  function readTheme(v) {
    var th = v.theme || (v.theme = {}), cs = getComputedStyle(v.host), i, t, raw;
    for (i = 0; i < TOKENS.length; i++) {
      t = TOKENS[i];
      raw = cs.getPropertyValue(t[1]);
      th[t[0]] = normColor(raw ? raw.trim() : "", t[2]);
    }
    var pc = v.probe ? getComputedStyle(v.probe) : cs;
    th.labelPx = cssNum(pc.fontSize, 10);
    th.valuePx = v.probe ? cssNum(pc.width, 11) : 11;
    th.microPx = v.probe ? cssNum(pc.minWidth, 9) : 9;
    th.nodePx = v.probe ? cssNum(pc.height, 10) : 10;
    th.stroke = v.probe ? Math.max(0.5, cssNum(pc.borderLeftWidth, 1)) : 1;
    th.stroke2 = v.probe ? Math.max(th.stroke, cssNum(pc.borderTopWidth, 2)) : 2;
    th.font = (v.probe && pc.fontFamily) ? pc.fontFamily : "monospace";
    var ls = parseFloat(pc.letterSpacing);
    th.ls = isFinite(ls) ? ls : 0;
    return th;
  }
  /* design token lookup by colour spec: "line", "accent", "1".."4", a CSS colour, or "var(--name)" */
  function resolveColor(v, spec, fallbackKey) {
    var th = v.theme;
    if (spec === undefined || spec === null || spec === "") return th[fallbackKey || "line"];
    spec = String(spec);
    if (th[spec] !== undefined && typeof th[spec] === "string") return th[spec];
    if (/^[1-4]$/.test(spec)) return th["v" + spec];
    if (/^m[1-8]$/.test(spec)) return th[spec];
    var m = /^var\(\s*(--[\w-]+)/.exec(spec);
    if (m) { var raw = getComputedStyle(v.host).getPropertyValue(m[1]); return normColor(raw ? raw.trim() : "", th[fallbackKey || "line"]); }
    return normColor(spec, th[fallbackKey || "line"]);
  }

  /* ===========================================================================
     Shared observers + ONE requestAnimationFrame loop for every canvas on the page
     =========================================================================== */
  var views = [];                 /* every live canvas view */
  var queue = [], work = [];      /* dirty views waiting for the next frame (swapped, never reallocated) */
  var rafId = 0, fbTimer = 0, frames = 0, draws = 0;
  var ro = null, io = null, moTheme = null, moRoot = null, winHooked = false;

  function onResizeEntries(entries) {
    for (var i = 0; i < entries.length; i++) {
      var v = entries[i].target.__apcVizView;
      if (!v || v.disposed) continue;
      var cr = entries[i].contentRect;
      v.w = cr.width; v.h = cr.height;
      v.themeStale = true;              /* rem scale changes the used font/node sizes */
      v.layoutStale = true;
      if (v.onResize) v.onResize();
      v.invalidate();
    }
  }
  function onIntersect(entries) {
    for (var i = 0; i < entries.length; i++) {
      var v = entries[i].target.__apcVizView;
      if (!v || v.disposed) continue;
      v.visible = entries[i].isIntersecting;
      if (v.visible && v.dirty) schedule(v);
    }
  }
  function refreshTheme() {
    for (var i = 0; i < views.length; i++) { views[i].themeStale = true; views[i].layoutStale = true; views[i].invalidate(); }
    APC.emit("viz:theme", {});
  }
  viz.refreshTheme = refreshTheme;
  /* hooks for the self-test page (observer callbacks cannot be forced in a headless run) */
  viz._test = { onIntersect: function (entries) { onIntersect(entries); }, onResize: function (entries) { onResizeEntries(entries); } };
  function onThemeMutation() { refreshTheme(); }
  /* window / rem-scale change: re-measure everything even if a ResizeObserver notification is late */
  function onWindowResize() {
    for (var i = 0; i < views.length; i++) { var v = views[i]; v.measure(); v.themeStale = true; v.layoutStale = true; if (v.onResize) v.onResize(); v.invalidate(); }
  }
  function ensureObservers() {
    if (!ro && typeof ResizeObserver !== "undefined") ro = new ResizeObserver(onResizeEntries);
    if (!io && typeof IntersectionObserver !== "undefined") io = new IntersectionObserver(onIntersect);
    if (!moTheme && typeof MutationObserver !== "undefined") {
      /* data-theme on <html> or ANY ancestor/descendant scope (a themed section) */
      moTheme = new MutationObserver(onThemeMutation);
      moTheme.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
      /* class / inline custom-property switches on the roots */
      moRoot = new MutationObserver(onThemeMutation);
      moRoot.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
      if (document.body) moRoot.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    }
    if (!winHooked) { winHooked = true; window.addEventListener("load", onThemeMutation); window.addEventListener("resize", onWindowResize); }
  }
  function dropObserversIfIdle() {
    if (views.length) return;
    if (ro) { ro.disconnect(); ro = null; }
    if (io) { io.disconnect(); io = null; }
    if (moTheme) { moTheme.disconnect(); moTheme = null; }
    if (moRoot) { moRoot.disconnect(); moRoot = null; }
    if (winHooked) { winHooked = false; window.removeEventListener("load", onThemeMutation); window.removeEventListener("resize", onWindowResize); }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (fbTimer) { clearTimeout(fbTimer); fbTimer = 0; }
    queue.length = 0;
  }
  APC.on("theme:changed", function () { refreshTheme(); });

  function schedule(v) {
    if (v._q || v.disposed) return;
    v._q = true;
    queue.push(v);
    arm();
  }
  /* ONE requestAnimationFrame for the whole page. A timeout fallback (only while the page is visible) keeps
     drawing alive where frames are throttled or not delivered (embedded WebViews, headless test runs). */
  function arm() {
    if (!rafId) rafId = requestAnimationFrame(tickRaf);
    if (!fbTimer && !document.hidden) fbTimer = setTimeout(tickFallback, 80);
  }
  function tickRaf(ts) { rafId = 0; tick(ts); }
  function tickFallback() { fbTimer = 0; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } tick(viz.now()); }
  function tick(ts) {
    if (fbTimer) { clearTimeout(fbTimer); fbTimer = 0; }
    frames++;
    var t = queue; queue = work; work = t;
    var n = work.length, i, v;
    for (i = 0; i < n; i++) {
      v = work[i]; v._q = false;
      if (v.disposed) continue;
      if ((v.w < 1 || v.h < 1) && v.host.clientWidth > 0 && v.host.clientHeight > 0) v.measure();    /* became visible without a ResizeObserver callback */
      if (!v.visible || v.w < 1 || v.h < 1) { v.dirty = true; continue; }   /* hidden / offscreen: skip, stay dirty */
      if (v.dirty) paint(v, ts);
    }
    work.length = 0;
    if (queue.length) arm();
  }
  function paint(v, ts) {
    if (v.disposed) return false;
    /* safety net: a ResizeObserver notification can be late or missing (throttled frames); the integer client size is a cheap check */
    if (Math.abs(v.host.clientWidth - v.w) > 1 || Math.abs(v.host.clientHeight - v.h) > 1) {
      v.measure(); v.themeStale = true; v.layoutStale = true;
      if (v.onResize) v.onResize();
    }
    if (v.w < 1 || v.h < 1) return false;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var bw = Math.max(1, Math.floor(v.w * dpr + 0.02)), bh = Math.max(1, Math.floor(v.h * dpr + 0.02));   /* floor: never wider than the host, so the last hairline is not clipped */
    if (v.cv.width !== bw || v.cv.height !== bh) {
      v.cv.width = bw; v.cv.height = bh; v.layoutStale = true;
      /* whole device pixels: the compositor never resamples the canvas, so 1-device-px hairlines stay sharp at fractional rem sizes */
      v.cv.style.width = (bw / dpr) + "px"; v.cv.style.height = (bh / dpr) + "px";
    }
    v.sx = bw / v.w; v.sy = bh / v.h; v.dpr = dpr;
    if (v.themeStale || !v.theme) { readTheme(v); v.themeStale = false; v.layoutStale = true; if (v.onTheme) v.onTheme(); }
    var ctx = v.ctx;
    ctx.setTransform(v.sx, 0, 0, v.sy, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, v.w, v.h);
    v.dirty = false;
    var keep = false;
    try { keep = v.draw(ctx, v, ts); }
    catch (e) { reportError("Drawing the " + v.kind + " failed: " + (e && e.message ? e.message : e), e, "apc-viz:" + v.kind); }
    v.drawCount++; draws++;
    if (keep) v.invalidate();
    return true;
  }

  /* Create a canvas view inside `host`. draw(ctx, view, ts) paints in CSS px; return true to request another frame. */
  function createView(host, kind, draw, extra) {
    var cv = document.createElement("canvas");
    cv.className = "apc-viz-cv";
    cv.setAttribute("aria-hidden", "true");
    var ctx = cv.getContext("2d");
    if (!ctx) { reportError("Canvas 2D is not available: the " + kind + " cannot be drawn.", null, "apc-viz:" + kind); }
    var probe = makeProbe();
    host.insertBefore(cv, host.firstChild);
    host.appendChild(probe);
    var v = {
      host: host, cv: cv, ctx: ctx, probe: probe, kind: kind, draw: draw, w: 0, h: 0, sx: 1, sy: 1, dpr: 1,
      dirty: true, visible: true, _q: false, disposed: false, theme: null, themeStale: true, layoutStale: true,
      drawCount: 0, onResize: null, onTheme: null, st: extra || {}
    };
    v.invalidate = function () { v.dirty = true; schedule(v); };
    v.measure = function () {
      /* the content box of the host = the area the canvas covers (hosts have no padding); the canvas itself is sized in whole device pixels */
      var r = host.getBoundingClientRect();
      v.w = Math.max(0, r.width - (host.offsetWidth - host.clientWidth)); v.h = Math.max(0, r.height - (host.offsetHeight - host.clientHeight));
    };
    /* synchronous repaint (ignores visibility): tests, screenshots, API calls */
    v.redraw = function () { v.measure(); v.themeStale = true; return paint(v, viz.now()); };
    v.dispose = function () {
      if (v.disposed) return;
      v.disposed = true;
      var ix = views.indexOf(v);
      if (ix >= 0) views.splice(ix, 1);
      ix = queue.indexOf(v); if (ix >= 0) queue.splice(ix, 1);
      if (ro) ro.unobserve(host);
      if (io) io.unobserve(host);
      cv.__apcVizView = null;
      if (host.__apcVizView === v) host.__apcVizView = null;
      if (cv.parentNode) cv.parentNode.removeChild(cv);
      if (probe.parentNode) probe.parentNode.removeChild(probe);
      dropObserversIfIdle();
    };
    cv.__apcVizView = v;
    host.__apcVizView = v;                 /* the IntersectionObserver watches the host, the ResizeObserver the canvas */
    views.push(v);
    ensureObservers();
    if (ro) ro.observe(host);
    if (io) io.observe(host);
    v.measure();
    v.invalidate();
    return v;
  }
  viz.createView = createView;
  /* synchronously paint every dirty view (tests). force=true also paints hidden/offscreen ones. */
  viz.flush = function (force) {
    var n = 0;
    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      if (v.dirty && (force || (v.visible && v.w >= 1))) { if (force) v.measure(); if (paint(v, viz.now())) n++; }
    }
    return n;
  };
  /* introspection for tests / diagnostics */
  viz.debug = function () {
    var feedsOn = 0, k;
    for (k in feeds) if (feeds[k]) feedsOn++;
    return { views: views.length, queued: queue.length, raf: rafId !== 0 || fbTimer !== 0, frames: frames, draws: draws,
      ro: !!ro, io: !!io, mo: !!(moTheme || moRoot), feeds: feedsOn, subs: subCount };
  };
  viz.raf = {
    size: function () { return queue.length; },
    running: function () { return rafId !== 0 || fbTimer !== 0; },
    frames: function () { return frames; },
    schedule: schedule
  };

  /* ---- drawing helpers: device-pixel-aligned hairlines (fillRect, never AA'd strokes) ---- */
  function lwDev(v, heavy) {
    var s = heavy ? v.theme.stroke2 : v.theme.stroke;
    return Math.max(1, Math.round(s * Math.min(v.sx, v.sy)));
  }
  function vline(ctx, v, x, y0, y1, color, ld) {
    ld = ld || lwDev(v);
    var left = Math.round(x * v.sx - ld / 2) / v.sx;
    var ya = Math.round(y0 * v.sy) / v.sy, yb = Math.round(y1 * v.sy) / v.sy;
    ctx.fillStyle = color;
    ctx.fillRect(left, ya, ld / v.sx, yb - ya);
  }
  function hline(ctx, v, y, x0, x1, color, ld) {
    ld = ld || lwDev(v);
    var top = Math.round(y * v.sy - ld / 2) / v.sy;
    var xa = Math.round(x0 * v.sx) / v.sx, xb = Math.round(x1 * v.sx) / v.sx;
    ctx.fillStyle = color;
    ctx.fillRect(xa, top, xb - xa, ld / v.sy);
  }
  function frameRect(ctx, v, x0, y0, x1, y1, color, ld) {
    ld = ld || lwDev(v);
    var xa = Math.round(x0 * v.sx) / v.sx, xb = Math.round(x1 * v.sx) / v.sx;
    var ya = Math.round(y0 * v.sy) / v.sy, yb = Math.round(y1 * v.sy) / v.sy;
    var tx = ld / v.sx, ty = ld / v.sy;
    ctx.fillStyle = color;
    ctx.fillRect(xa, ya, xb - xa, ty);
    ctx.fillRect(xa, yb - ty, xb - xa, ty);
    ctx.fillRect(xa, ya, tx, yb - ya);
    ctx.fillRect(xb - tx, ya, tx, yb - ya);
  }
  function setFont(ctx, v, px) {
    ctx.font = (Math.round(px * 10) / 10) + "px " + v.theme.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = (v.theme.ls || 0) + "px";
  }
  viz.draw = { vline: vline, hline: hline, frameRect: frameRect };

  /* ===========================================================================
     Event hub: ONE bridge listener per event name, routed by id (viz / meter / param)
     =========================================================================== */
  var reg = { viz: {}, meter: {}, param: {} };
  var feeds = {};
  var subCount = 0;
  function routeEvent(name, p) {
    if (!p) return;
    var id = p.id;
    if (name === "param" && (id === "*" || id === undefined)) {
      var all = reg.param, k, l, i;
      for (k in all) { l = all[k].slice(); for (i = 0; i < l.length; i++) { try { l[i].fn({ id: "*" }); } catch (e) { reportError("viz handler failed", e); } } }
      return;
    }
    var list = reg[name][id];
    if (!list || !list.length) return;
    list = list.slice();
    var payload = name === "viz" ? p.data : p;
    for (var j = 0; j < list.length; j++) {
      try { list[j].fn(payload, p); }
      catch (e2) { reportError("handler failed: " + name + " " + id + ": " + (e2 && e2.message ? e2.message : e2), e2, "apc-viz"); }
    }
  }
  function hookFeed(name) {
    if (feeds[name]) return;
    var f = { off: null, offBus: null };
    if (APC.bridge && typeof APC.bridge.on === "function") {
      try { f.off = APC.bridge.on(name, function (p) { routeEvent(name, p); }); } catch (e) { reportError("Could not listen to " + name + " events", e); }
    }
    if (name === "viz") f.offBus = APC.on("viz", function (p) { routeEvent("viz", p); });   /* page code may APC.emit("viz", {id,data}) */
    feeds[name] = f;
  }
  function unhookFeed(name) {
    var f = feeds[name]; if (!f) return;
    if (typeof f.off === "function") f.off();
    if (typeof f.offBus === "function") f.offBus();
    delete feeds[name];
  }
  function subscribeEvent(name, id, kind, fn, meta) {
    if (!id) return function () {};
    var e = { fn: fn, kind: kind, meta: meta || {} };
    (reg[name][id] = reg[name][id] || []).push(e);
    subCount++;
    hookFeed(name);
    var done = false;
    return function off() {
      if (done) return; done = true;
      var l = reg[name][id], ix = l ? l.indexOf(e) : -1;
      if (ix >= 0) { l.splice(ix, 1); subCount--; }
      if (l && !l.length) delete reg[name][id];
      var any = false, k;
      for (k in reg[name]) { any = true; break; }
      if (!any) unhookFeed(name);
    };
  }
  /* viz.subscribe(id, kind, fn(data), meta) -> off(). meta is read live by APC.mockViz (e.g. {length: 16}). */
  viz.subscribe = function (id, kind, fn, meta) { return subscribeEvent("viz", id, kind, fn, meta); };
  viz.subscribeMeter = function (id, fn, meta) { return subscribeEvent("meter", id, "meter", fn, meta); };
  /* deliver data to the subscribers of `id` without a bridge (APC.mockViz fallback, page code) */
  viz.push = function (id, data) { routeEvent("viz", { id: id, data: data }); };
  viz.pushMeter = function (id, value) { routeEvent("meter", { id: id, value: value }); };
  viz.subscribedIds = function () {
    var out = {}, k, i, l;
    for (k in reg.viz) { l = reg.viz[k]; out[k] = []; for (i = 0; i < l.length; i++) out[k].push({ kind: l[i].kind, meta: l[i].meta }); }
    for (k in reg.meter) { l = reg.meter[k]; out[k] = out[k] || []; for (i = 0; i < l.length; i++) out[k].push({ kind: l[i].kind, meta: l[i].meta, event: "meter" }); }
    return out;
  };

  /* ===========================================================================
     Parameter link: descriptor, value <-> normalised, throttled set, host gestures
     =========================================================================== */
  function bcall(name, args) {
    var p;
    try {
      if (!APC.bridge || !APC.bridge.call) throw new Error("bridge unavailable");
      p = APC.bridge.call(name, args || {});
    } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) {
      if (r && r.error && !r.infra) {
        if (r.error === "gated") APC.emit("license:gated", { fn: name, result: r });
        else reportError("Could not complete " + name + ": " + (r.message || r.error), r.error, name);
      }
      return r;
    }, function (e) { reportError("Could not complete " + name + ": " + ((e && e.message) || e), e, name); return undefined; });
  }
  viz.call = bcall;

  function ParamLink(id, onChange) {
    var L = { id: id, ready: false, failed: false, dead: false, desc: null, value: 0, min: 0, max: 1, skew: 1, step: 0, unit: "", def: 0,
      name: id, mods: [], modulated: null, gesture: false };
    var timer = 0, hasPending = false, pending = 0, lastSend = 0, off = null;

    function setDesc(d) {
      L.desc = d; L.ready = true;
      L.name = d.name || id;
      L.min = num(d.min, 0); L.max = num(d.max, 1);
      L.skew = (typeof d.skew === "number" && d.skew > 0) ? d.skew : 1;
      L.step = (typeof d.step === "number" && d.step > 0) ? d.step : 0;
      L.unit = d.unit || "";
      L.def = num(d["default"], L.min);
      L.value = num(d.value, L.def);
      L.mods = d.modulation || [];
    }
    L.load = function (done) {
      off = subscribeEvent("param", id, "param", function (ev) { onParamEvent(ev); });
      return bcall("apc.params.get", { id: id }).then(function (d) {
        if (L.dead) return L;
        if (!d || d.error || typeof d !== "object") { L.failed = true; if (onChange) onChange("failed"); if (done) done(L); return L; }
        if ((d.choices && d.choices.length) || typeof d.value === "boolean" || typeof d["default"] === "boolean") {
          L.failed = true;
          reportError("Parameter \"" + id + "\" is a choice/boolean and cannot drive a continuous display control.", id, "apc-viz");
          if (onChange) onChange("failed"); if (done) done(L); return L;
        }
        setDesc(d);
        if (onChange) onChange("ready");
        if (done) done(L);
        return L;
      });
    };
    function onParamEvent(ev) {
      if (L.dead || !ev) return;
      if (ev.id === "*") { bcall("apc.params.get", { id: id }).then(function (d) { if (d && !d.error && !L.dead && !L.gesture) { setDesc(d); if (onChange) onChange("external"); } }); return; }
      if (typeof ev.modulated === "number") L.modulated = ev.modulated; else if (ev.modulated === null) L.modulated = null;
      if (L.gesture) { if (onChange) onChange("mod"); return; }
      if (typeof ev.value === "number" && isFinite(ev.value) && ev.value !== L.value) { L.value = ev.value; if (onChange) onChange("external"); }
      else if (onChange) onChange("mod");
    }
    L.norm = function (v) {
      var r = L.max - L.min;
      if (!(r > 0)) return 0;
      var p = clamp((v - L.min) / r, 0, 1);
      return L.skew === 1 ? p : Math.pow(p, L.skew);
    };
    L.fromNorm = function (t) {
      t = clamp(t, 0, 1);
      var p = L.skew === 1 ? t : Math.pow(t, 1 / L.skew);
      return L.min + (L.max - L.min) * p;
    };
    L.snap = function (v) {
      if (L.step) v = L.min + Math.round((v - L.min) / L.step) * L.step;
      return Math.round(clamp(v, L.min, L.max) * 1e9) / 1e9;
    };
    function flush() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (!hasPending || L.dead) return;
      hasPending = false; lastSend = Date.now();
      bcall("apc.param.set", { id: id, value: pending });
    }
    L.set = function (v) {
      if (!L.ready) return false;
      v = L.snap(v);
      if (v === L.value) return false;
      L.value = v; pending = v; hasPending = true;
      var wait = 16 - (Date.now() - lastSend);
      if (wait <= 0) flush(); else if (!timer) timer = setTimeout(function () { timer = 0; flush(); }, wait);
      return true;
    };
    L.begin = function () { if (L.gesture || !L.ready) return; L.gesture = true; bcall("apc.param.begin", { id: id }); };
    L.end = function () { if (!L.gesture) return; flush(); L.gesture = false; bcall("apc.param.end", { id: id }); };
    L.reset = function () {
      if (!L.ready) return;
      L.value = L.snap(L.def);
      bcall("apc.param.reset", { id: id }).then(function (r) {
        if (L.dead || !r || r.error || typeof r.value !== "number") return;
        if (r.value !== L.value) { L.value = r.value; if (onChange) onChange("external"); }
      });
      if (onChange) onChange("local");
    };
    L.dispose = function () {
      if (L.dead) return;
      L.end(); L.dead = true;
      if (timer) { clearTimeout(timer); timer = 0; }
      if (off) { off(); off = null; }
    };
    return L;
  }
  viz.ParamLink = ParamLink;

  /* ===========================================================================
     Axes: linear / log10 / sqrt, nice ticks, labels
     =========================================================================== */
  function makeAxis(min, max, type, unit) {
    var a = { min: min, max: max, type: type || "linear", unit: unit || "", l0: 0, l1: 1 };
    return setAxisRange(a, min, max);
  }
  function setAxisRange(a, min, max) {
    if (!(max > min)) max = min + 1;
    if (a.type === "log") { if (!(min > 0)) min = 1e-3; if (!(max > min)) max = min * 10; a.l0 = Math.log(min); a.l1 = Math.log(max); }
    a.min = min; a.max = max;
    return a;
  }
  function aT(a, v) {
    if (a.type === "log") return (Math.log(v > 0 ? v : a.min * 1e-3) - a.l0) / (a.l1 - a.l0);
    if (a.type === "sqrt") return Math.sqrt(Math.max(0, (v - a.min) / (a.max - a.min)));
    return (v - a.min) / (a.max - a.min);
  }
  function aV(a, t) {
    if (a.type === "log") return Math.exp(a.l0 + t * (a.l1 - a.l0));
    if (a.type === "sqrt") return a.min + t * t * (a.max - a.min);
    return a.min + t * (a.max - a.min);
  }
  function fmtAxis(a, val, step, signed) {
    var u = a.unit, n, s;
    if (u === "Hz") {
      if (Math.abs(val) >= 1000) { s = trimNum(val / 1000, 2) + "K"; return s; }
      return trimNum(val, val < 10 ? 1 : 0);
    }
    if (u === "s") {
      if (val === 0) return "0";
      if (Math.abs(val) < 1) return trimNum(val * 1000, 0) + "MS";
      return trimNum(val, 2) + "S";
    }
    if (u === "ms") return trimNum(val, step && step < 1 ? 1 : 0) + (val === 0 ? "" : "");
    var digits = 0;
    if (step) { digits = Math.max(0, -Math.floor(Math.log(step) / Math.LN10 + 1e-9)); if (digits > 4) digits = 4; }
    n = trimNum(val, digits);
    if (n === "-0") n = "0";
    if ((u === "dB" || signed) && val > 0) n = "+" + n;
    return n;
  }
  /* -> { v:[], major:[], lab:[] } ; labels are thinned so neighbours never overlap (minLabelGap px) */
  function axisTicks(a, len, minGap, signed, custom) {
    var out = { v: [], major: [], lab: [], step: 0 }, i, n, d, m, val, ppd;
    function push(v2, major, label) { out.v.push(v2); out.major.push(major); out.lab.push(label); }
    if (custom && custom.length) {
      for (i = 0; i < custom.length; i++) { val = Number(custom[i]); if (isFinite(val) && val >= a.min && val <= a.max) push(val, true, fmtAxis(a, val, 0, signed)); }
    } else if (a.type === "log") {
      var lo = Math.floor(Math.log(a.min) / Math.LN10 + 1e-9), hi = Math.ceil(Math.log(a.max) / Math.LN10 - 1e-9);
      ppd = len / ((a.l1 - a.l0) / Math.LN10);
      var labelSet = ppd >= 130 ? [1, 2, 5] : (ppd >= 70 ? [1, 3] : [1]);
      var minors = ppd >= 90;
      for (d = lo; d <= hi; d++) {
        for (m = 1; m <= 9; m++) {
          val = m * Math.pow(10, d);
          if (val < a.min * (1 - 1e-9) || val > a.max * (1 + 1e-9)) continue;
          if (m !== 1 && !minors) continue;
          push(val, m === 1, labelSet.indexOf(m) >= 0 ? fmtAxis(a, val, 0, signed) : "");
        }
      }
    } else if (a.type === "sqrt") {
      var top = Math.pow(10, Math.floor(Math.log(a.max) / Math.LN10 + 1e-9)), seq = [1, 2, 5], mag, si, cand = [];
      for (mag = top; mag >= top / 1000; mag /= 10) for (si = 0; si < 3; si++) { val = seq[si] * mag; if (val > a.min && val <= a.max * (1 + 1e-9)) cand.push(val); }
      cand.sort(function (x, y) { return x - y; });
      push(a.min, true, fmtAxis(a, a.min, 0, signed));
      for (i = 0; i < cand.length; i++) push(cand[i], true, fmtAxis(a, cand[i], 0, signed));
    } else {
      var count = Math.max(1, Math.floor(len / Math.max(8, minGap)));
      var raw = (a.max - a.min) / count, mg = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), res = raw / mg;
      var stp = (res < 1.5 ? 1 : (res < 3 ? 2 : (res < 7 ? 5 : 10))) * mg;
      out.step = stp;
      n = Math.ceil(a.min / stp - 1e-9);
      for (i = n; i * stp <= a.max + stp * 1e-9; i++) {
        val = Math.round(i * stp * 1e9) / 1e9;
        push(val, Math.abs(val) < stp * 1e-6, fmtAxis(a, val, stp, signed));
      }
    }
    /* thin labels */
    var last = -1e9, p;
    for (i = 0; i < out.v.length; i++) {
      if (!out.lab[i]) continue;
      p = aT(a, out.v[i]) * len;
      if (p - last < minGap) out.lab[i] = ""; else last = p;
    }
    return out;
  }
  viz.axis = { make: makeAxis, t: aT, v: aV, ticks: axisTicks };

  /* ===========================================================================
     Display-only filter response (RBJ cookbook). Real analysis must come from the DSP/native side:
     this exists so a UI/demo can draw an EQ curve without a backend.
     type: peak | lowshelf | highshelf | lowpass | highpass | bandpass | notch
     -> Float32Array (or Array if freqs is a plain Array) of magnitude in dB, one per freq
     =========================================================================== */
  function biquadResponse(type, f0, q, gainDb, fs, freqs) {
    fs = fs > 0 ? fs : 48000;
    q = q > 0 ? q : 0.7071;
    f0 = clamp(f0, 1, fs / 2 * 0.999);
    var A = Math.pow(10, (gainDb || 0) / 40), w0 = 2 * Math.PI * f0 / fs, cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q);
    var b0, b1, b2, a0, a1, a2, sq = 2 * Math.sqrt(A) * al;
    switch (String(type).toLowerCase()) {
      case "peak": case "peaking": case "bell":
        b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case "lowshelf":
        b0 = A * ((A + 1) - (A - 1) * cw + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - sq);
        a0 = (A + 1) + (A - 1) * cw + sq; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - sq; break;
      case "highshelf":
        b0 = A * ((A + 1) + (A - 1) * cw + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - sq);
        a0 = (A + 1) - (A - 1) * cw + sq; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - sq; break;
      case "lowpass":
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case "highpass":
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case "bandpass":
        b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case "notch":
        b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      default:
        b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    var one = typeof freqs === "number";
    var list = one ? [freqs] : freqs;
    var out = (list && list.buffer) ? new Float32Array(list.length) : new Array(list.length), i, w, c1, c2, nu, de;
    for (i = 0; i < list.length; i++) {
      w = 2 * Math.PI * list[i] / fs; c1 = Math.cos(w); c2 = Math.cos(2 * w);
      nu = b0 * b0 + b1 * b1 + b2 * b2 + 2 * (b0 * b1 + b1 * b2) * c1 + 2 * b0 * b2 * c2;
      de = 1 + a1 * a1 + a2 * a2 + 2 * (a1 + a1 * a2) * c1 + 2 * a2 * c2;
      out[i] = 10 * Math.log(Math.max(nu, 1e-30) / Math.max(de, 1e-30)) / Math.LN10;
    }
    return one ? out[0] : out;
  }
  viz.biquadResponse = biquadResponse;
  /* n log-spaced frequencies from f0 to f1 (inclusive) */
  viz.logSpace = function (f0, f1, n) {
    var out = new Float32Array(n), a = Math.log(f0), b = Math.log(f1);
    for (var i = 0; i < n; i++) out[i] = Math.exp(a + (b - a) * (i / (n - 1)));
    return out;
  };

  /* ===========================================================================
     Common component plumbing
     =========================================================================== */
  function hostLabel(el, opts, fallback) {
    return opts.label || el.getAttribute("aria-label") || (el.textContent || "").replace(/\s+/g, " ").trim() || fallback;
  }
  function prepareHost(el, kind, opts) {
    var label = hostLabel(el, opts, kind);
    APC.dom.clear(el);
    el.classList.add("apc-viz", "apc-viz-" + kind);
    return label;
  }
  function srNode(text) {
    return h("span", { class: "apc-viz-sr", id: uid() , text: text || "" });
  }
  function vizId(el, opts) { return opts.viz || opts.meter || opts.id || el.id || ""; }
  function throttleText(node, fn, ms) {
    /* returns update(text) that touches the DOM at most once per `ms` */
    var last = -Infinity, pend = null, timer = 0;
    function put(t) { if (node.textContent !== t) node.textContent = t; }
    return {
      update: function (t) {
        var n = viz.now();
        if (n - last >= ms) { last = n; put(t); }
        else { pend = t; if (!timer) timer = setTimeout(function () { timer = 0; last = viz.now(); if (pend !== null) put(pend); pend = null; }, ms - (n - last)); }
      },
      dispose: function () { if (timer) clearTimeout(timer); timer = 0; }
    };
  }
  function pointerPos(e, rect) { return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }
  function fireDom(el, name, detail) {
    try { el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail })); } catch (e) { /* old engines: bus event still fires */ }
  }

  /* ===========================================================================
     graph / envelope engine (one engine, three modes: graph, adsr, multi)
     =========================================================================== */
  /* a ParamLink look-alike for values that are not bound to a plugin parameter */
  function LocalLink(min, max, value, def, unit) {
    var L = { id: null, ready: true, failed: false, dead: false, local: true, value: value, min: min, max: max, skew: 1, step: 0,
      unit: unit || "", def: def === undefined ? value : def, name: "", mods: [], modulated: null, gesture: false };
    L.norm = function (v) { var r = L.max - L.min; return r > 0 ? clamp((v - L.min) / r, 0, 1) : 0; };
    L.fromNorm = function (t) { return L.min + (L.max - L.min) * clamp(t, 0, 1); };
    L.snap = function (v) { return clamp(v, L.min, L.max); };
    L.set = function (v) { v = clamp(v, L.min, L.max); if (v === L.value) return false; L.value = v; return true; };
    L.begin = function () { L.gesture = true; };
    L.end = function () { L.gesture = false; };
    L.reset = function () { L.value = L.def; };
    L.load = function (done) { if (done) done(L); return Promise.resolve(L); };
    L.dispose = function () { L.dead = true; };
    return L;
  }

  function modStyleN(src) {
    if (APC.controls && APC.controls.sourceStyle) { try { return APC.controls.sourceStyle(src); } catch (e) { /* fall through */ } }
    var k = String(src === undefined ? "" : src).toLowerCase(), hsh = 0, j;
    for (j = 0; j < k.length; j++) hsh = (hsh * 31 + k.charCodeAt(j)) % 9973;
    var i = hsh % 24;
    return { n: (i % 8) + 1, dash: Math.floor(i / 8) % 3 };
  }
  var DASHES = [[], [5, 3], [1.5, 2.5]];
  /* hairline with a dash pattern (solid / dashed / dotted by modulation source), drawn as snapped rects so it stays crisp */
  function dashLine(ctx, v, vertical, pos, a, b, color, dashIdx, ld) {
    var pat = DASHES[dashIdx] || [], lo = Math.min(a, b), hi = Math.max(a, b), p = lo, on = true, i = 0, seg;
    if (!pat.length) { if (vertical) vline(ctx, v, pos, lo, hi, color, ld); else hline(ctx, v, pos, lo, hi, color, ld); return; }
    while (p < hi) {
      seg = Math.min(pat[i % pat.length], hi - p);
      if (on) { if (vertical) vline(ctx, v, pos, p, p + seg, color, ld); else hline(ctx, v, pos, p, p + seg, color, ld); }
      p += pat[i % pat.length]; on = !on; i++;
    }
  }

  function normCurve(c) {
    if (typeof c === "function") c = { fn: c };
    if (isArr(c) && typeof c[0] === "number") c = { values: c };
    c = c || {};
    var o = { kind: "none", color: c.color, width: c.width, fill: bool(c.fill, false), dash: bool(c.dash, false), label: c.label || "",
      base: c.base, hidden: bool(c.hidden, false), fn: null, xs: null, ys: null, n: 0 };
    var i, p;
    if (typeof c.fn === "function") { o.kind = "fn"; o.fn = c.fn; return o; }
    var pts = c.points;
    if (pts && pts.length) {
      o.n = pts.length; o.xs = new Float64Array(o.n); o.ys = new Float64Array(o.n); o.kind = "xy";
      for (i = 0; i < o.n; i++) {
        p = pts[i];
        if (isArr(p)) { o.xs[i] = Number(p[0]); o.ys[i] = Number(p[1]); }
        else { o.xs[i] = Number(p.x); o.ys[i] = Number(p.y); }
      }
      return o;
    }
    if (c.x && c.y && c.x.length === c.y.length) {
      o.n = c.x.length; o.kind = "xy"; o.xs = new Float64Array(o.n); o.ys = new Float64Array(o.n);
      for (i = 0; i < o.n; i++) { o.xs[i] = Number(c.x[i]); o.ys[i] = Number(c.y[i]); }
      return o;
    }
    var vals = c.values || c.y || c.ys || c.db;
    if (vals && vals.length) {
      o.n = vals.length; o.kind = "ys"; o.ys = new Float64Array(o.n);
      for (i = 0; i < o.n; i++) o.ys[i] = Number(vals[i]);
    }
    return o;
  }
  function curveSummary(c, xa, unitY, unitX) {
    if (c.hidden || c.kind === "none") return "";
    var best = -Infinity, worst = Infinity, bx = 0, i, n = 64, x, y, t;
    for (i = 0; i <= n; i++) {
      t = i / n;
      if (c.kind === "fn") { x = aV(xa, t); try { y = c.fn(x); } catch (e) { return ""; } }
      else if (c.kind === "xy") { var k = Math.min(c.n - 1, Math.round(t * (c.n - 1))); x = c.xs[k]; y = c.ys[k]; }
      else { var k2 = Math.min(c.n - 1, Math.round(t * (c.n - 1))); x = aV(xa, t); y = c.ys[k2]; }
      if (!isFinite(y)) continue;
      if (y > best) { best = y; bx = x; }
      if (y < worst) worst = y;
    }
    if (best === -Infinity) return "";
    return (c.label ? c.label + ": " : "") + "peak " + fmtValue(best, unitY, 1) + " at " + fmtValue(bx, unitX) + ", low " + fmtValue(worst, unitY, 1) + ".";
  }

  function createGraph(el, opts, kind) {
    var isEnv = kind === "envelope";
    var label = prepareHost(el, kind, opts);
    var envMode = isEnv ? pick(opts.mode, ["adsr", "multi"], "adsr") : null;
    var elId = el.id || opts.id || "";
    var disposed = false, offs = [], timers = [];
    function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i > -1) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }
    function cancel(t) { if (!t) return; clearTimeout(t); var i = timers.indexOf(t); if (i > -1) timers.splice(i, 1); }
    function on(node, type, fn, o) { node.addEventListener(type, fn, o || false); offs.push(function () { node.removeEventListener(type, fn, o || false); }); }

    /* ---- axes ---- */
    var xtype = pick(opts.xscale, ["linear", "log", "sqrt"], (isEnv && envMode === "adsr") ? "sqrt" : "linear");
    var tmax = num(opts.tmax, 4);
    var xdefMin = xtype === "log" ? 20 : 0, xdefMax = xtype === "log" ? 20000 : (isEnv ? tmax : 1);
    var xunit = opts.xunit !== undefined ? opts.xunit : (xtype === "log" ? "Hz" : (isEnv ? "s" : ""));
    var yunit = opts.yunit !== undefined ? opts.yunit : "";
    var xa = makeAxis(num(opts.xmin, xdefMin), num(opts.xmax, xdefMax), xtype, xunit);
    var ya = makeAxis(num(opts.ymin, isEnv ? 0 : -1), num(opts.ymax, isEnv ? 1 : 1), "linear", yunit);
    var axesMode = pick(opts.axes, ["both", "x", "y", "none", "true", "false"], isEnv ? "x" : "both");
    if (axesMode === "true") axesMode = "both"; else if (axesMode === "false") axesMode = "none";
    var showGrid = bool(opts.grid, true);
    var xticksCustom = listOpt(opts.xticks), yticksCustom = listOpt(opts.yticks);
    var xname = opts.xname || (xunit === "Hz" ? "FREQ" : (isEnv ? "TIME" : "X"));
    var yname = opts.yname || (yunit === "dB" ? "GAIN" : (isEnv ? "LEVEL" : "Y"));
    var signedY = bool(opts.ysigned, yunit === "dB");
    var fillBase = pick(opts.fillBase, ["zero", "bottom"], (ya.min < 0 && ya.max > 0) ? "zero" : "bottom");
    var connect = bool(opts.connect, isEnv);
    var curvature = clamp(num(opts.curvature, isEnv ? 0.55 : 0), -1, 1);
    var showMod = bool(opts.mod, true);
    var editable = bool(opts.editable, envMode === "multi");
    var holdOpt = num(opts.hold, tmax * 0.2);

    var host = el;
    var st = { lay: null, curves: [], nodes: [], active: null, dragging: null, tipNode: null, fx: null, summary: "", pendingLinks: 0, ready: false };
    var desc = srNode("");
    var tip = h("div", { class: "apc-viz-tip", "aria-hidden": "true", hidden: true });
    el.appendChild(desc);
    el.appendChild(tip);
    el.setAttribute("aria-describedby", desc.id);

    var view = createView(el, kind, draw, st);
    var API = {};

    /* ---- node construction ---- */
    function chg(reason) { if (disposed) return; syncNodes(); view.invalidate(); }
    function linkFor(spec, fallbackMin, fallbackMax, fallbackVal, unit) {
      if (typeof spec === "string" && spec) { var L = ParamLink(spec, chg); st.pendingLinks++; L.load(function () { st.pendingLinks--; checkReady(); }); return L; }
      return LocalLink(fallbackMin, fallbackMax, fallbackVal, fallbackVal, unit);
    }
    function checkReady() {
      if (disposed) return;
      var allOk = true, i, n, f;
      for (i = 0; i < st.nodes.length; i++) { n = st.nodes[i]; f = [n.lx, n.ly, n.lq]; for (var j = 0; j < 3; j++) if (f[j] && f[j].failed) allOk = false; }
      if (adsr && (adsr.a.failed || adsr.d.failed || adsr.s.failed || adsr.r.failed)) allOk = false;
      if (st.pendingLinks <= 0) {
        st.ready = true;
        el.removeAttribute("aria-busy");
        if (!allOk) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
        syncNodes(); view.invalidate();
      }
    }
    function makeNode(spec, i) {
      var nd = { id: String(spec.id !== undefined ? spec.id : "n" + (i + 1)), label: spec.label !== undefined ? String(spec.label) : String(i + 1),
        name: spec.name || "", color: spec.color || "", x: 0, y: 0, q: null, lx: null, ly: null, lq: null, lockX: bool(spec.lockX, false), lockY: bool(spec.lockY, false),
        spec: spec, el: null, role: spec.role || "", qLocal: false };
      nd.lx = linkFor(spec.x, xa.min, xa.max, num(spec.xv, aV(xa, 0.5)), xunit);
      nd.ly = linkFor(spec.y, ya.min, ya.max, num(spec.yv, (ya.min + ya.max) / 2), yunit);
      if (spec.q) nd.lq = linkFor(spec.q, 0.1, 20, num(spec.qv, 1), "");
      else if (spec.qv !== undefined) { nd.lq = LocalLink(num(spec.qmin, 0.1), num(spec.qmax, 20), num(spec.qv, 1), num(spec.qv, 1), ""); }
      return nd;
    }
    function nodeEl(nd) {
      var e = h("div", { class: "apc-viz-node", role: "slider", tabindex: "0", "data-node": nd.id, "data-label": nd.label });
      if (nd.color) e.setAttribute("data-color", nd.color);
      e.setAttribute("aria-roledescription", "node");
      e.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight");
      e.setAttribute("aria-label", nd.name || ((opts.nodeName || (isEnv ? "Envelope point" : "Node")) + " " + nd.label));
      el.appendChild(e);
      wireNode(nd, e);
      return e;
    }

    API.setNodes = function (specs) {
      clearNodes();
      specs = specs || [];
      st.pendingLinks = 0;
      for (var i = 0; i < specs.length; i++) { var nd = makeNode(specs[i] || {}, i); st.nodes.push(nd); }
      for (i = 0; i < st.nodes.length; i++) st.nodes[i].el = nodeEl(st.nodes[i]);
      updateRole();
      if (st.pendingLinks > 0) { st.ready = false; el.setAttribute("aria-busy", "true"); } else { st.ready = true; el.removeAttribute("aria-busy"); }
      syncNodes(); view.invalidate();
    };
    function clearNodes() {
      st.dragging = null; st.active = null; hideTip();
      for (var i = 0; i < st.nodes.length; i++) {
        var nd = st.nodes[i];
        [nd.lx, nd.ly, nd.lq].forEach(function (l) { if (l && l.dispose) l.dispose(); });
        if (nd.offs) nd.offs.forEach(function (f) { f(); });
        if (nd.el && nd.el.parentNode) nd.el.parentNode.removeChild(nd.el);
      }
      st.nodes = [];
    }
    function updateRole() {
      if (st.nodes.length) { el.setAttribute("role", "group"); }
      else { el.setAttribute("role", "img"); }
    }

    /* ---- ADSR ---- */
    var adsr = null;
    function setupAdsr() {
      var a = linkFor(opts.attack, 0, tmax, 0.05, "s"), d = linkFor(opts.decay, 0, tmax, 0.25, "s"),
        s = linkFor(opts.sustain, 0, 1, 0.6, ""), r = linkFor(opts.release, 0, tmax, 0.5, "s");
      adsr = { a: a, d: d, s: s, r: r, hold: holdOpt, nodes: [] };
      var nA = { id: "attack", label: "A", name: "Attack", lockY: true }, nD = { id: "decay", label: "D", name: "Decay and sustain" }, nR = { id: "release", label: "R", name: "Release", lockY: true };
      var nds = [nA, nD, nR].map(function (sp, i) {
        var nd = { id: sp.id, label: sp.label, name: sp.name, color: "", x: 0, y: 0, q: null, lx: null, ly: null, lq: null, lockX: false, lockY: !!sp.lockY, spec: sp, el: null, role: sp.id };
        return nd;
      });
      st.nodes = nds;
      for (var i = 0; i < nds.length; i++) nds[i].el = nodeEl(nds[i]);
      updateRole();
      el.setAttribute("aria-busy", st.pendingLinks > 0 ? "true" : "false");
      if (st.pendingLinks <= 0) el.removeAttribute("aria-busy");
      st.ready = st.pendingLinks <= 0;
    }
    function adsrVals() {
      var A = adsr.a.value, D = adsr.d.value, S = adsr.s.norm(adsr.s.value), R = adsr.r.value;
      return { a: A, d: D, s: S, r: R, h: adsr.hold };
    }
    function adsrSyncNodes() {
      var v2 = adsrVals(), nA = st.nodes[0], nD = st.nodes[1], nR = st.nodes[2];
      nA.x = v2.a; nA.y = 1;
      nD.x = v2.a + v2.d; nD.y = v2.s;
      nR.x = v2.a + v2.d + v2.h + v2.r; nR.y = 0;
      /* shape curve: start, attack, decay, hold, release */
      var segs = [[0, 0, v2.a, 1], [v2.a, 1, v2.a + v2.d, v2.s], [v2.a + v2.d, v2.s, v2.a + v2.d + v2.h, v2.s], [v2.a + v2.d + v2.h, v2.s, nR.x, 0]];
      var N = 28, pts = [], i, j, sg, u, f, k = curvature * 6;
      for (i = 0; i < 4; i++) {
        sg = segs[i];
        for (j = (i === 0 ? 0 : 1); j <= N; j++) {
          u = j / N;
          if (i === 2 || Math.abs(k) < 1e-3) f = u;
          else f = (1 - Math.exp(-k * u)) / (1 - Math.exp(-k));
          pts.push([sg[0] + (sg[2] - sg[0]) * u, sg[1] + (sg[3] - sg[1]) * f]);
          if (sg[2] === sg[0] && j > 0) break;     /* zero-length segment: one point is enough */
        }
      }
      var c = normCurve({ points: pts, color: "accent", fill: true, base: 0, label: "Envelope" });
      st.curves = [c];
    }
    function adsrWrite(nd, nx, ny) {
      var v2 = adsrVals(), a = adsr.a, d = adsr.d, s = adsr.s, r = adsr.r;
      if (nd.role === "attack") {
        var maxA = Math.min(a.max, tmax - v2.d - v2.h - v2.r);
        a.set(clamp(nx, a.min, Math.max(a.min, maxA)));
      } else if (nd.role === "decay") {
        var maxD = Math.min(d.max, tmax - v2.a - v2.h - v2.r);
        d.set(clamp(nx - v2.a, d.min, Math.max(d.min, maxD)));
        s.set(s.fromNorm(clamp(ny, 0, 1)));
      } else if (nd.role === "release") {
        var maxR = Math.min(r.max, tmax - v2.a - v2.d - v2.h);
        r.set(clamp(nx - (v2.a + v2.d + v2.h), r.min, Math.max(r.min, maxR)));
      }
    }
    function adsrLinks(nd) {
      return nd.role === "attack" ? [adsr.a] : (nd.role === "decay" ? [adsr.d, adsr.s] : [adsr.r]);
    }
    function adsrTip(nd) {
      if (nd.role === "attack") return "ATTACK " + fmtValue(adsr.a.value, "s");
      if (nd.role === "decay") return "DECAY " + fmtValue(adsr.d.value, "s") + "  SUSTAIN " + fmtValue(adsr.s.value, adsr.s.unit);
      return "RELEASE " + fmtValue(adsr.r.value, "s");
    }

    /* ---- generic node read / write ---- */
    function readNode(nd) {
      if (nd.lx) nd.x = nd.lx.value;
      if (nd.ly) nd.y = nd.ly.value;
      if (nd.lq) nd.q = nd.lq.value;
    }
    function nodeLinks(nd) {
      if (adsr) return adsrLinks(nd);
      var l = [];
      if (nd.lx && !nd.lockX) l.push(nd.lx);
      if (nd.ly && !nd.lockY) l.push(nd.ly);
      return l;
    }
    function ordered() { return envMode === "multi"; }
    function writeNode(nd, nx, ny, dir) {
      if (adsr) { adsrWrite(nd, nx, ny); return; }
      var ix = st.nodes.indexOf(nd), prev = st.nodes[ix - 1], next = st.nodes[ix + 1];
      if (ordered()) {
        if (prev) nx = Math.max(nx, prev.x);
        if (next) nx = Math.min(nx, next.x);
      }
      if (nd.lx && !nd.lockX) {
        var cx = nd.lx.value;
        if (nd.lx.set(nx) === false && dir && dir.dx && nd.lx.step) nd.lx.set(cx + dir.dx * nd.lx.step);
      }
      if (nd.ly && !nd.lockY) {
        var cy = nd.ly.value;
        if (nd.ly.set(ny) === false && dir && dir.dy && nd.ly.step) nd.ly.set(cy + dir.dy * nd.ly.step);
      }
    }
    function nodeText(nd) {
      if (adsr) return adsrTip(nd);
      var parts = [xname + " " + fmtValue(nd.x, xunit), yname + " " + fmtValue(nd.y, yunit, Math.abs(ya.max - ya.min) <= 30 ? 1 : undefined)];
      if (nd.lq) parts.push("Q " + trimNum(nd.q, 2));
      return parts.join("  ");
    }
    function emitNode(nd, phase) {
      var d = { id: elId, node: nd.id, x: nd.x, y: nd.y, q: nd.q, phase: phase, text: nodeText(nd) };
      if (adsr) { var vv = adsrVals(); d.adsr = { attack: adsr.a.value, decay: adsr.d.value, sustain: adsr.s.value, release: adsr.r.value }; d.level = vv.s; }
      APC.emit(kind + ":node", d);
      fireDom(el, "apc-node", d);
      if (isEnv && (phase === "end" || phase === "key" || phase === "reset")) emitEnvChange(phase);
    }
    function pointsOut() {
      return st.nodes.map(function (n) { return { id: n.id, x: n.x, y: n.y }; });
    }
    function emitEnvChange(phase) {
      var d = { id: elId, mode: envMode, phase: phase };
      if (adsr) d.adsr = { attack: adsr.a.value, decay: adsr.d.value, sustain: adsr.s.value, release: adsr.r.value };
      else d.points = pointsOut();
      APC.emit("envelope:change", d);
    }

    /* ---- sync: links -> nodes -> curve -> DOM ---- */
    function syncNodes() {
      var i, nd, ready = true;
      if (adsr) { ready = adsr.a.ready && adsr.d.ready && adsr.s.ready && adsr.r.ready; }
      if (adsr && ready) adsrSyncNodes();
      for (i = 0; i < st.nodes.length; i++) {
        nd = st.nodes[i];
        if (!adsr) { readNode(nd); if (!(nd.lx.ready && nd.ly.ready && (!nd.lq || nd.lq.ready))) ready = false; }
      }
      if (!adsr && connect) {
        var sorted = st.nodes.slice().sort(function (p, q2) { return p.x - q2.x; });
        if (!ordered()) {
          var pts = sorted.map(function (n) { return [n.x, n.y]; });
          var segN = 18, outp = [], j, u, f, k = curvature * 6, a0, a1;
          if (Math.abs(k) < 1e-3 || pts.length < 2) outp = pts;
          else {
            for (i = 0; i < pts.length - 1; i++) {
              a0 = pts[i]; a1 = pts[i + 1];
              for (j = (i === 0 ? 0 : 1); j <= segN; j++) { u = j / segN; f = (1 - Math.exp(-k * u)) / (1 - Math.exp(-k)); outp.push([a0[0] + (a1[0] - a0[0]) * u, a0[1] + (a1[1] - a0[1]) * f]); }
            }
          }
          st.curves = pts.length >= 2 ? [normCurve({ points: outp, color: "accent", fill: isEnv, base: 0 })] : [];
        } else {
          var o2 = [], jj, uu, ff, kk = curvature * 6;
          for (i = 0; i < sorted.length - 1; i++) {
            for (jj = (i === 0 ? 0 : 1); jj <= 18; jj++) {
              uu = jj / 18; ff = Math.abs(kk) < 1e-3 ? uu : (1 - Math.exp(-kk * uu)) / (1 - Math.exp(-kk));
              o2.push([sorted[i].x + (sorted[i + 1].x - sorted[i].x) * uu, sorted[i].y + (sorted[i + 1].y - sorted[i].y) * ff]);
            }
          }
          st.curves = o2.length ? [normCurve({ points: o2, color: "accent", fill: true, base: 0 })] : [];
        }
      }
      for (i = 0; i < st.nodes.length; i++) {
        nd = st.nodes[i];
        if (!nd.el) continue;
        nd.el.hidden = !ready || !st.ready;
        nd.el.setAttribute("aria-valuemin", String(xa.min));
        nd.el.setAttribute("aria-valuemax", String(xa.max));
        nd.el.setAttribute("aria-valuenow", String(Math.round(nd.x * 1e6) / 1e6));
        nd.el.setAttribute("aria-valuetext", nodeText(nd));
      }
      positionNodes();
      if (st.tipNode) showTip(st.tipNode);
      updateSummary();
    }
    function positionNodes() {
      var L = st.lay;
      if (!L) return;
      for (var i = 0; i < st.nodes.length; i++) {
        var nd = st.nodes[i];
        if (!nd.el) continue;
        var px = L.x0 + clamp(aT(xa, nd.x), 0, 1) * L.w, py = L.y1 - clamp(aT(ya, nd.y), 0, 1) * L.h;
        var tr = "translate(" + (Math.round(px * 100) / 100) + "px," + (Math.round(py * 100) / 100) + "px)";
        if (nd.tr !== tr) { nd.el.style.transform = tr; nd.tr = tr; }
      }
    }
    function updateSummary() {
      var parts = [], i;
      for (i = 0; i < st.curves.length; i++) { var s = curveSummary(st.curves[i], xa, yunit, xunit); if (s) parts.push(s); }
      if (adsr && adsr.a.ready && adsr.d.ready && adsr.s.ready && adsr.r.ready) {
        parts = ["Envelope: attack " + fmtValue(adsr.a.value, "s") + ", decay " + fmtValue(adsr.d.value, "s") + ", sustain " + fmtValue(adsr.s.value, adsr.s.unit) + ", release " + fmtValue(adsr.r.value, "s") + "."];
      } else if (isEnv && st.nodes.length) {
        parts = ["Envelope with " + st.nodes.length + " points."];
      }
      var t = label + ". " + parts.join(" ") + (st.nodes.length && !adsr ? " " + st.nodes.length + " draggable nodes." : "");
      if (t !== st.summary) { st.summary = t; desc.textContent = t; }
      if (!st.nodes.length) el.setAttribute("aria-label", label + (parts.length ? ". " + parts.join(" ") : ""));
      else el.setAttribute("aria-label", label);
    }

    /* ---- tooltip + guides ---- */
    function showTip(nd) {
      if (!nd.el || nd.el.hidden) return;
      st.tipNode = nd;
      tip.textContent = nodeText(nd);
      tip.hidden = false;
      var L = st.lay;
      if (!L) return;
      var px = L.x0 + clamp(aT(xa, nd.x), 0, 1) * L.w, py = L.y1 - clamp(aT(ya, nd.y), 0, 1) * L.h;
      var tw = tip.offsetWidth, th2 = tip.offsetHeight, gap = view.theme ? view.theme.nodePx * 0.9 : 8;
      var lx = clamp(px - tw / 2, 2, Math.max(2, view.w - tw - 2));
      var ty = py - gap - th2;
      if (ty < 2) ty = py + gap;
      tip.style.transform = "translate(" + Math.round(lx) + "px," + Math.round(ty) + "px)";
    }
    function hideTip() { st.tipNode = null; tip.hidden = true; }
    function setActive(nd) { if (st.active !== nd) { st.active = nd; view.invalidate(); } }
    function updateActive() {
      var nd = st.dragging ? st.dragging.node : (st.hover || st.focus || null);
      setActive(nd);
      if (nd) showTip(nd); else hideTip();
    }

    /* ---- gestures ---- */
    function beginNode(nd) { nodeLinks(nd).forEach(function (l) { l.begin(); }); if (nd.lq && nd.lq.begin && !adsr) nd.lq.begin(); }
    function endNode(nd) { nodeLinks(nd).forEach(function (l) { l.end(); }); if (nd.lq && nd.lq.end && !adsr) nd.lq.end(); }
    function commit(nd, nx, ny, dir) {
      writeNode(nd, nx, ny, dir);
      syncNodes(); view.invalidate();
    }
    function resetNode(nd) {
      var links = nodeLinks(nd).slice();
      if (nd.lq && !adsr) links.push(nd.lq);
      links.forEach(function (l) { l.reset(); });
      syncNodes(); view.invalidate(); showTip(nd);
      emitNode(nd, "reset");
    }
    function scaleOf() {
      var r = view.cv.getBoundingClientRect();
      return { x: (r.width / (view.w || 1)) || 1, y: (r.height / (view.h || 1)) || 1 };
    }
    function wireNode(nd, e) {
      nd.offs = [];
      function add(type, fn, o) { e.addEventListener(type, fn, o || false); nd.offs.push(function () { e.removeEventListener(type, fn, o || false); }); }
      add("pointerdown", function (ev) {
        if (disposed || (ev.button !== undefined && ev.button !== 0)) return;
        if (ev.altKey) { ev.preventDefault(); try { e.focus({ preventScroll: true }); } catch (x) { e.focus(); } resetNode(nd); return; }
        try { e.setPointerCapture(ev.pointerId); } catch (x2) { /* synthetic events */ }
        try { e.focus({ preventScroll: true }); } catch (x3) { e.focus(); }
        ev.preventDefault();
        st.dragging = { node: nd, pid: ev.pointerId, cx: ev.clientX, cy: ev.clientY, tx: aT(xa, nd.x), ty: aT(ya, nd.y), fine: ev.shiftKey ? 0.1 : 1, moved: false };
        beginNode(nd);
        e.classList.add("is-drag");
        updateActive();
        emitNode(nd, "begin");
      });
      add("pointermove", function (ev) {
        var d = st.dragging;
        if (!d || d.node !== nd || ev.pointerId !== d.pid || disposed || !st.lay) return;
        var sc = scaleOf();
        var dx = (ev.clientX - d.cx) / sc.x / st.lay.w * d.fine, dy = -(ev.clientY - d.cy) / sc.y / st.lay.h * d.fine;
        d.moved = true;
        var nx = nd.lockX ? nd.x : aV(xa, clamp(d.tx + dx, 0, 1)), ny = nd.lockY ? nd.y : aV(ya, clamp(d.ty + dy, 0, 1));
        if (adsr && nd.role === "decay") ny = clamp(d.ty + dy, 0, 1);       /* sustain is edited in normalised level space */
        commit(nd, nx, ny);
        emitNode(nd, "move");
      });
      function finish(ev) {
        var d = st.dragging;
        if (!d || d.node !== nd || (ev && ev.pointerId !== undefined && ev.pointerId !== d.pid)) return;
        st.dragging = null;
        try { e.releasePointerCapture(d.pid); } catch (x) { /* ignore */ }
        e.classList.remove("is-drag");
        endNode(nd);
        updateActive();
        emitNode(nd, "end");
      }
      add("pointerup", finish);
      add("pointercancel", finish);
      add("lostpointercapture", finish);
      add("pointerenter", function () { st.hover = nd; if (!st.dragging) updateActive(); });
      add("pointerleave", function () { if (st.hover === nd) st.hover = null; if (!st.dragging) updateActive(); });
      add("focus", function () { st.focus = nd; updateActive(); });
      add("blur", function () { if (st.focus === nd) st.focus = null; updateActive(); });
      add("wheel", function (ev) {
        if (disposed || !nd.lq || st.dragging) return;
        var dy = ev.deltaY || ev.deltaX || 0;
        if (!dy) return;
        ev.preventDefault();
        var notches = -(ev.deltaMode === 0 ? dy / 100 : (ev.deltaMode === 1 ? dy / 3 : dy));
        if (!nd.wheelOn) { nd.wheelOn = true; nd.lq.begin(); }
        nd.lq.set(nd.lq.fromNorm(nd.lq.norm(nd.lq.value) + notches * (ev.shiftKey ? 0.004 : 0.03)));
        syncNodes(); view.invalidate(); showTip(nd);
        emitNode(nd, "wheel");
        cancel(nd.wheelT);
        nd.wheelT = later(function () { nd.wheelOn = false; nd.lq.end(); emitNode(nd, "end"); }, 250);
      }, { passive: false });
      add("keydown", function (ev) { onNodeKey(nd, ev); });
      add("contextmenu", function (ev) { ev.preventDefault(); });
    }
    function onNodeKey(nd, ev) {
      if (disposed) return;
      var k = ev.key, step = ev.shiftKey ? 0.001 : 0.01, dx = 0, dy = 0, handled = false;
      if (k === "ArrowRight") dx = 1; else if (k === "ArrowLeft") dx = -1;
      else if (k === "ArrowUp") dy = 1; else if (k === "ArrowDown") dy = -1;
      else if (k === "PageUp") { dy = 1; step = 0.1; } else if (k === "PageDown") { dy = -1; step = 0.1; }
      if (dx || dy) {
        ev.preventDefault();
        var nx = nd.x, ny = nd.y;
        if (dx && !nd.lockX) nx = aV(xa, clamp(aT(xa, nd.x) + dx * step, 0, 1));
        if (dy && !nd.lockY) ny = aV(ya, clamp(aT(ya, nd.y) + dy * step, 0, 1));
        if (adsr && nd.role === "decay") ny = clamp(aT(ya, nd.y) + dy * step, 0, 1);
        if ((dx && nd.lockX) || (dy && nd.lockY)) { if (!(dx && !nd.lockX) && !(dy && !nd.lockY)) return; }
        beginNode(nd);
        commit(nd, nx, ny, { dx: dx, dy: dy });
        endNode(nd);
        showTip(nd);
        emitNode(nd, "key");
        return;
      }
      if ((k === "+" || k === "=" || k === "]" || k === "-" || k === "_" || k === "[") && nd.lq) {
        ev.preventDefault();
        var dir = (k === "+" || k === "=" || k === "]") ? 1 : -1;
        nd.lq.begin();
        nd.lq.set(nd.lq.fromNorm(nd.lq.norm(nd.lq.value) + dir * (ev.shiftKey ? 0.005 : 0.03)));
        nd.lq.end();
        syncNodes(); view.invalidate(); showTip(nd);
        emitNode(nd, "key");
        return;
      }
      if (k === "Delete" || k === "Backspace") {
        ev.preventDefault();
        if (envMode === "multi" && editable && removablePoint(nd)) removePoint(nd);
        else resetNode(nd);
        return;
      }
      if (k === "Insert" && envMode === "multi" && editable) { ev.preventDefault(); insertAfter(nd); return; }
      if (k === "Escape" && st.dragging && st.dragging.node === nd) { ev.preventDefault(); handled = true; }
      return handled;
    }

    /* ---- multi-point editing ---- */
    function specOf(n) { return { id: n.id, x: n.spec.x, y: n.spec.y, xv: n.x, yv: n.y, label: n.label, name: n.name, color: n.color, lockX: n.lockX, lockY: n.lockY }; }
    function removablePoint(nd) { return st.nodes.length > 2 && !nd.lx.id && !nd.ly.id; }
    function removePoint(nd) {
      var ix = st.nodes.indexOf(nd);
      var specs = st.nodes.filter(function (n) { return n !== nd; }).map(specOf);
      API.setNodes(specs);
      var f = st.nodes[Math.min(ix, st.nodes.length - 1)];
      if (f && f.el) f.el.focus();
      emitEnvChange("remove");
    }
    function insertAfter(nd) {
      var ix = st.nodes.indexOf(nd), nxt = st.nodes[ix + 1];
      var nx = nxt ? (nd.x + nxt.x) / 2 : (nd.x + xa.max) / 2, ny = nxt ? (nd.y + nxt.y) / 2 : nd.y;
      addPointAt(nx, ny, ix + 1);
    }
    function addPointAt(nx, ny, atIndex) {
      var specs = st.nodes.map(specOf);
      var id = "p" + (++uidN);
      specs.splice(atIndex, 0, { id: id, xv: nx, yv: ny, label: String(atIndex + 1) });
      specs.forEach(function (s, i) { if (!s.x && !s.y) s.label = String(i + 1); });
      API.setNodes(specs);
      var f = null;
      st.nodes.forEach(function (n) { if (n.id === id) f = n; });
      if (f && f.el) f.el.focus();
      emitEnvChange("add");
    }
    if (isEnv) {
      on(el, "dblclick", function (ev) {
        if (!(envMode === "multi" && editable) || ev.target.closest && ev.target.closest(".apc-viz-node") || !st.lay) return;
        var r = view.cv.getBoundingClientRect(), L = st.lay, sc = scaleOf();
        var px = (ev.clientX - r.left) / sc.x, py = (ev.clientY - r.top) / sc.y;
        if (px < L.x0 || px > L.x1 || py < L.y0 || py > L.y1) return;
        var nx = aV(xa, (px - L.x0) / L.w), ny = aV(ya, (L.y1 - py) / L.h), ix = 0;
        while (ix < st.nodes.length && st.nodes[ix].x < nx) ix++;
        addPointAt(nx, ny, ix);
      });
    }

    /* ---- geometry / layout ---- */
    function layout(ctx, v) {
      var th = v.theme, fs = th.labelPx, pad = Math.round(fs * 0.5), showX = axesMode === "both" || axesMode === "x", showY = axesMode === "both" || axesMode === "y";
      var top = pad, bottom = pad, left = pad, right = pad, charW = fs * 0.62 + th.ls;
      setFont(ctx, v, fs);
      if (showX) { bottom = Math.round(fs * 2.1); right = Math.round(fs * 1.6); }
      if ((showY && yunit) || (showX && xunit && xunit !== "s")) top = Math.round(fs * 1.5);
      var yt = null, xt = null;
      if (showY) {
        yt = axisTicks(ya, Math.max(10, v.h - top - bottom), Math.max(fs * 3, 18), signedY, yticksCustom);
        var mw = 0, i;
        for (i = 0; i < yt.lab.length; i++) if (yt.lab[i]) mw = Math.max(mw, ctx.measureText(yt.lab[i]).width);
        left = Math.round(mw + pad * 1.4);
      }
      var plotW = Math.max(10, v.w - left - right);
      if (showX) xt = axisTicks(xa, plotW, Math.max(fs * 4.4, 28), false, xticksCustom);
      st.lay = { x0: left, y0: top, x1: left + plotW, y1: Math.max(top + 10, v.h - bottom), w: plotW, h: Math.max(10, v.h - bottom - top),
        xt: xt, yt: yt, showX: showX, showY: showY, pad: pad, fs: fs, charW: charW };
      if (!showX && !showY) {
        /* no axes: grid from a coarse default so the plot still reads */
        st.lay.xt = axisTicks(xa, plotW, Math.max(fs * 4.4, 28), false, xticksCustom);
        st.lay.yt = axisTicks(ya, st.lay.h, Math.max(fs * 3, 18), signedY, yticksCustom);
      } else {
        if (!st.lay.xt) st.lay.xt = axisTicks(xa, plotW, Math.max(fs * 4.4, 28), false, xticksCustom);
        if (!st.lay.yt) st.lay.yt = axisTicks(ya, st.lay.h, Math.max(fs * 3, 18), signedY, yticksCustom);
      }
    }
    function geometry() {
      if (!st.lay) return null;
      var L = st.lay;
      return { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, w: L.w, h: L.h,
        mapX: function (val) { return L.x0 + aT(xa, val) * L.w; }, mapY: function (val) { return L.y1 - aT(ya, val) * L.h; },
        unmapX: function (px) { return aV(xa, (px - L.x0) / L.w); }, unmapY: function (py) { return aV(ya, (L.y1 - py) / L.h); } };
    }

    /* ---- drawing ---- */
    function curvePath(ctx, c, L, closeFill, baseY) {
      var i, px, py, t, x, y, started = false, n, firstX = 0, lastX = 0;
      ctx.beginPath();
      if (c.kind === "fn") {
        n = Math.max(8, Math.min(1024, Math.ceil(L.w / 1.5)));
        for (i = 0; i <= n; i++) {
          t = i / n; x = aV(xa, t); y = c.fn(x);
          if (!isFinite(y)) { started = false; continue; }
          px = L.x0 + t * L.w; py = L.y1 - aT(ya, y) * L.h;
          if (!started) { ctx.moveTo(px, py); started = true; if (!closeFill) continue; firstX = px; } else ctx.lineTo(px, py);
          lastX = px;
        }
      } else if (c.kind === "xy") {
        for (i = 0; i < c.n; i++) {
          if (!isFinite(c.ys[i]) || !isFinite(c.xs[i])) { started = false; continue; }
          px = L.x0 + aT(xa, c.xs[i]) * L.w; py = L.y1 - aT(ya, c.ys[i]) * L.h;
          if (!started) { ctx.moveTo(px, py); started = true; firstX = px; } else ctx.lineTo(px, py);
          lastX = px;
        }
      } else if (c.kind === "ys") {
        n = c.n;
        for (i = 0; i < n; i++) {
          if (!isFinite(c.ys[i])) { started = false; continue; }
          px = L.x0 + (n > 1 ? i / (n - 1) : 0) * L.w; py = L.y1 - aT(ya, c.ys[i]) * L.h;
          if (!started) { ctx.moveTo(px, py); started = true; firstX = px; } else ctx.lineTo(px, py);
          lastX = px;
        }
      }
      if (closeFill && started) { ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath(); }
      return started;
    }
    function drawMods(ctx, v, L, th) {
      var i, j, nd, r, l, base, a, lo, hi, nlo, nhi, sty, col, px, py, ld = lwDev(v);
      for (i = 0; i < st.nodes.length; i++) {
        nd = st.nodes[i];
        if (!nd.el || nd.el.hidden) continue;
        px = L.x0 + clamp(aT(xa, nd.x), 0, 1) * L.w; py = L.y1 - clamp(aT(ya, nd.y), 0, 1) * L.h;
        for (var pass = 0; pass < 2; pass++) {
          l = pass === 0 ? nd.ly : nd.lx;
          if (!l || !l.ready || !l.mods || !l.mods.length || l.local) continue;
          if (adsr) continue;
          base = l.norm(l.value);
          for (j = 0; j < l.mods.length; j++) {
            r = l.mods[j];
            if (r.bypass) continue;
            a = num(r.amount, 0) / 100;
            if (/^bi/i.test(String(r.polarity || ""))) { lo = base - Math.abs(a); hi = base + Math.abs(a); }
            else { lo = Math.min(base, base + a); hi = Math.max(base, base + a); }
            lo = clamp(lo, 0, 1); hi = clamp(hi, 0, 1);
            if (typeof r.min === "number") { nlo = l.norm(r.min); lo = Math.max(lo, Math.min(nlo, hi)); }
            if (typeof r.max === "number") { nhi = l.norm(r.max); hi = Math.min(hi, Math.max(nhi, lo)); }
            sty = modStyleN(r.src); col = th["m" + sty.n];
            var vlo = l.fromNorm(lo), vhi = l.fromNorm(hi), off = (j + 1) * 3 + th.nodePx * 0.5;
            if (pass === 0) { var y0 = L.y1 - clamp(aT(ya, vhi), 0, 1) * L.h, y1 = L.y1 - clamp(aT(ya, vlo), 0, 1) * L.h; dashLine(ctx, v, true, px + off, y0, y1, col, sty.dash, ld); }
            else { var x0 = L.x0 + clamp(aT(xa, vlo), 0, 1) * L.w, x1 = L.x0 + clamp(aT(xa, vhi), 0, 1) * L.w; dashLine(ctx, v, false, py + off, x0, x1, col, sty.dash, ld); }
            if (typeof l.modulated === "number") {
              ctx.fillStyle = col;
              var ms = Math.max(3, th.nodePx * 0.3);
              if (pass === 0) ctx.fillRect(Math.round(px + off) - ms / 2, L.y1 - clamp(aT(ya, l.modulated), 0, 1) * L.h - ms / 2, ms, ms);
              else ctx.fillRect(L.x0 + clamp(aT(xa, l.modulated), 0, 1) * L.w - ms / 2, Math.round(py + off) - ms / 2, ms, ms);
            }
          }
        }
      }
    }
    function draw(ctx, v) {
      var th = v.theme;
      if (v.layoutStale) { layout(ctx, v); v.layoutStale = false; positionNodes(); }
      var L = st.lay, ld = lwDev(v), i, c, col;
      ctx.fillStyle = th.inset;
      ctx.fillRect(0, 0, v.w, v.h);
      /* grid */
      if (showGrid) {
        var xt = L.xt, yt = L.yt;
        for (i = 0; i < xt.v.length; i++) {
          ctx.globalAlpha = xt.major[i] ? 1 : 0.5;
          var gx = L.x0 + aT(xa, xt.v[i]) * L.w;
          if (gx > L.x0 + 1 && gx < L.x1 - 1) vline(ctx, v, gx, L.y0, L.y1, th.grid, ld);
        }
        for (i = 0; i < yt.v.length; i++) {
          ctx.globalAlpha = yt.major[i] ? 1 : 0.5;
          var gy = L.y1 - aT(ya, yt.v[i]) * L.h;
          if (gy > L.y0 + 1 && gy < L.y1 - 1) hline(ctx, v, gy, L.x0, L.x1, yt.major[i] && ya.min < 0 ? th.rule : th.grid, ld);
        }
        ctx.globalAlpha = 1;
      }
      /* curves, clipped to the plot */
      ctx.save();
      ctx.beginPath(); ctx.rect(L.x0, L.y0 - 1, L.w, L.h + 2); ctx.clip();
      var cw = Math.max(th.stroke * 1.5, 1.5);
      for (i = 0; i < st.curves.length; i++) {
        c = st.curves[i];
        if (c.hidden || c.kind === "none") continue;
        col = resolveColor(v, c.color, i === 0 ? "accent" : "line");
        if (!c.color && i > 0) col = th["v" + (((i - 1) % 4) + 1)];
        if (c.fill) {
          var by = L.y1;
          if (c.base !== undefined && c.base !== null) by = L.y1 - clamp(aT(ya, Number(c.base)), 0, 1) * L.h;
          else if (fillBase === "zero") by = L.y1 - clamp(aT(ya, 0), 0, 1) * L.h;
          if (curvePath(ctx, c, L, true, by)) {
            if (col === th.accent) { ctx.fillStyle = th.fill; ctx.fill(); }
            else { ctx.globalAlpha = 0.16; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
          }
        }
        if (curvePath(ctx, c, L, false, 0)) {
          ctx.strokeStyle = col; ctx.lineWidth = (c.width ? c.width : cw); ctx.lineJoin = "round"; ctx.lineCap = "butt";
          ctx.setLineDash(c.dash ? [4, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
      if (showMod) drawMods(ctx, v, L, th);
      /* guides for the hovered / focused / dragged node */
      if (st.active && st.active.el && !st.active.el.hidden) {
        var nd = st.active, gpx = L.x0 + clamp(aT(xa, nd.x), 0, 1) * L.w, gpy = L.y1 - clamp(aT(ya, nd.y), 0, 1) * L.h;
        ctx.globalAlpha = 0.55;
        vline(ctx, v, gpx, gpy, L.y1, th.axis, ld);
        hline(ctx, v, gpy, L.x0, gpx, th.axis, ld);
        ctx.globalAlpha = 1;
      }
      frameRect(ctx, v, L.x0, L.y0, L.x1, L.y1, th.rule, ld);
      /* axis labels */
      var fs = L.fs;
      setFont(ctx, v, fs);
      ctx.fillStyle = th.axis;
      if (L.showY) {
        ctx.textAlign = "right"; ctx.textBaseline = "middle";
        for (i = 0; i < L.yt.v.length; i++) {
          if (!L.yt.lab[i]) continue;
          var ly2 = L.y1 - aT(ya, L.yt.v[i]) * L.h;
          if (ly2 < L.y0 - 1 || ly2 > L.y1 + 1) continue;
          ctx.fillText(L.yt.lab[i], L.x0 - L.pad * 0.8, Math.round(ly2));
        }
        if (yunit) { ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(String(yunit).toUpperCase(), L.x0, Math.round(L.pad * 0.5)); }
      }
      if (L.showX) {
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        var lastR = -1e9;
        for (i = 0; i < L.xt.v.length; i++) {
          if (!L.xt.lab[i]) continue;
          var lx2 = L.x0 + aT(xa, L.xt.v[i]) * L.w;
          ctx.fillText(L.xt.lab[i], Math.round(lx2), L.y1 + L.pad * 0.9);
        }
        if (xunit && xunit !== "s") { ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText(String(xunit).toUpperCase(), L.x1, Math.round(L.pad * 0.5)); }
      }
      return false;
    }

    /* ---- public API ---- */
    API.kind = kind; API.el = el; API.view = view;
    API.setCurves = function (curves) {
      st.curves = (curves || []).map(normCurve);
      updateSummary();
      view.invalidate();
    };
    API.getCurves = function () { return st.curves.slice(); };
    API.setRange = function (r) {
      r = r || {};
      if (r.xscale) { xa.type = pick(r.xscale, ["linear", "log", "sqrt"], xa.type); }
      setAxisRange(xa, num(r.xmin, xa.min), num(r.xmax, xa.max));
      setAxisRange(ya, num(r.ymin, ya.min), num(r.ymax, ya.max));
      if (r.xunit !== undefined) xa.unit = xunit = r.xunit;
      if (r.yunit !== undefined) ya.unit = yunit = r.yunit;
      view.layoutStale = true; syncNodes(); view.invalidate();
    };
    API.getRange = function () { return { xmin: xa.min, xmax: xa.max, ymin: ya.min, ymax: ya.max, xscale: xa.type }; };
    API.redraw = function () { view.layoutStale = true; syncNodes(); return view.redraw(); };
    API.getNodes = function () { return st.nodes.map(function (n) { return { id: n.id, x: n.x, y: n.y, q: n.q }; }); };
    API.getNodeElement = function (id) { for (var i = 0; i < st.nodes.length; i++) if (st.nodes[i].id === id) return st.nodes[i].el; return null; };
    API.focusNode = function (id) { var e = API.getNodeElement(id); if (e) e.focus(); return !!e; };
    API.setNodeValue = function (id, val) {
      for (var i = 0; i < st.nodes.length; i++) if (st.nodes[i].id === id) {
        var nd = st.nodes[i];
        if (adsr) { writeNode(nd, val.x !== undefined ? val.x : nd.x, val.y !== undefined ? val.y : nd.y); }
        else {
          if (val.x !== undefined && nd.lx) nd.lx.set(val.x);
          if (val.y !== undefined && nd.ly) nd.ly.set(val.y);
          if (val.q !== undefined && nd.lq) nd.lq.set(val.q);
        }
        syncNodes(); view.invalidate(); return true;
      }
      return false;
    };
    API.geometry = geometry;
    API.getSummary = function () { return st.summary; };
    API.getAdsr = function () { return adsr ? { attack: adsr.a.value, decay: adsr.d.value, sustain: adsr.s.value, release: adsr.r.value } : null; };
    API.setAdsr = function (o) {
      if (!adsr) return false;
      o = o || {};
      if (o.attack !== undefined) adsr.a.set(o.attack);
      if (o.decay !== undefined) adsr.d.set(o.decay);
      if (o.sustain !== undefined) adsr.s.set(o.sustain);
      if (o.release !== undefined) adsr.r.set(o.release);
      syncNodes(); view.invalidate(); return true;
    };
    API.getPoints = function () { return pointsOut(); };
    API.setPoints = function (pts) {
      if (envMode !== "multi") return false;
      API.setNodes((pts || []).map(function (p, i) { return { id: p.id || ("p" + (i + 1)), xv: p.x, yv: p.y, label: String(i + 1) }; }));
      return true;
    };
    Object.defineProperty(API, "ready", { get: function () { return st.ready; } });
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      if (st.dragging) endNode(st.dragging.node);
      clearNodes();
      if (adsr) [adsr.a, adsr.b, adsr.d, adsr.s, adsr.r].forEach(function (l) { if (l && l.dispose) l.dispose(); });
      timers.forEach(function (t) { clearTimeout(t); }); timers = [];
      offs.forEach(function (f) { f(); }); offs = [];
      if (unsub) unsub();
      view.dispose();
      if (desc.parentNode) desc.parentNode.removeChild(desc);
      if (tip.parentNode) tip.parentNode.removeChild(tip);
      el.__apcViz = null;
    };

    /* ---- init from options ---- */
    var curvesOpt = jsonOpt(opts.curves, null, "data-curves");
    if (curvesOpt) st.curves = curvesOpt.map(normCurve);
    var unsub = null;
    var feedId = vizId(el, opts);
    if (feedId) {
      unsub = viz.subscribe(feedId, kind, function (data) {
        if (!data) return;
        if (data.type === "curves" && data.curves) API.setCurves(data.curves);
        else if (data.type === "curve") API.setCurves([data]);
        else if (isArr(data) && typeof data[0] === "number") API.setCurves([{ values: data, color: "accent", fill: true }]);
      }, { kind: kind });
    }
    if (adsr === null && isEnv && envMode === "adsr") {
      setupAdsr();                 /* ParamLinks start loading inside linkFor(); checkReady() fires when all descriptors arrived */
      if (st.ready) syncNodes();
    } else {
      var nodeSpecs = jsonOpt(opts.nodes || opts.points, null, "data-nodes");
      if (nodeSpecs && isArr(nodeSpecs) && nodeSpecs.length) API.setNodes(nodeSpecs);
      else if (isEnv && envMode === "multi") {
        API.setNodes([{ id: "p1", xv: 0, yv: 0, lockX: true, label: "1" }, { id: "p2", xv: xa.max * 0.2, yv: 1, label: "2" }, { id: "p3", xv: xa.max * 0.6, yv: 0.5, label: "3" }, { id: "p4", xv: xa.max, yv: 0, label: "4" }]);
      } else updateRole();
    }
    updateSummary();
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     Plot helpers shared by spectrum / waveform / xypad: layout, grid, frame, labels
     =========================================================================== */
  function plotLayout(ctx, v, c) {
    var th = v.theme, fs = th.labelPx, pad = c.axes === "none" ? 0 : Math.round(fs * 0.5);
    var showX = c.axes === "both" || c.axes === "x", showY = c.axes === "both" || c.axes === "y";
    var top = pad, bottom = pad, left = pad, right = pad;
    setFont(ctx, v, fs);
    if (showX) { bottom = Math.round(fs * 2.1); right = Math.round(fs * 1.6); }
    if ((showY && c.ya.unit) || (showX && c.xa.unit && c.xa.unit !== "s")) top = Math.round(fs * 1.5);
    var yt = null, xt = null, i;
    if (showY) {
      yt = axisTicks(c.ya, Math.max(10, v.h - top - bottom), Math.max(fs * 3, 18), c.signedY, c.yticks);
      var mw = 0;
      for (i = 0; i < yt.lab.length; i++) if (yt.lab[i]) mw = Math.max(mw, ctx.measureText(yt.lab[i]).width);
      left = Math.round(mw + pad * 1.4);
    }
    var w = Math.max(10, v.w - left - right), hh = Math.max(10, v.h - top - bottom);
    xt = axisTicks(c.xa, w, Math.max(fs * 4.4, 28), false, c.xticks);
    if (!yt) yt = axisTicks(c.ya, hh, Math.max(fs * 3, 18), c.signedY, c.yticks);
    return { x0: left, y0: top, x1: left + w, y1: top + hh, w: w, h: hh, xt: xt, yt: yt, showX: showX, showY: showY, pad: pad, fs: fs };
  }
  function plotBase(ctx, v, L, c) {
    var th = v.theme, ld = lwDev(v), i, g;
    if (!c.transparent) { ctx.fillStyle = th.inset; ctx.fillRect(L.x0, L.y0, L.w, L.h); }
    if (c.grid) {
      for (i = 0; i < L.xt.v.length; i++) {
        ctx.globalAlpha = L.xt.major[i] ? 1 : 0.5;
        g = L.x0 + aT(c.xa, L.xt.v[i]) * L.w;
        if (g > L.x0 + 1 && g < L.x1 - 1) vline(ctx, v, g, L.y0, L.y1, th.grid, ld);
      }
      for (i = 0; i < L.yt.v.length; i++) {
        ctx.globalAlpha = L.yt.major[i] ? 1 : 0.5;
        g = L.y1 - aT(c.ya, L.yt.v[i]) * L.h;
        if (g > L.y0 + 1 && g < L.y1 - 1) hline(ctx, v, g, L.x0, L.x1, (L.yt.major[i] && c.ya.min < 0 && c.ya.max > 0) ? th.rule : th.grid, ld);
      }
      ctx.globalAlpha = 1;
    }
  }
  function plotFrameAndLabels(ctx, v, L, c) {
    var th = v.theme, ld = lwDev(v), i, p;
    if (!c.noFrame) frameRect(ctx, v, L.x0, L.y0, L.x1, L.y1, th.rule, ld);
    if (!L.showX && !L.showY) return;
    setFont(ctx, v, L.fs);
    ctx.fillStyle = th.axis;
    if (L.showY) {
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (i = 0; i < L.yt.v.length; i++) {
        if (!L.yt.lab[i]) continue;
        p = L.y1 - aT(c.ya, L.yt.v[i]) * L.h;
        if (p < L.y0 - 1 || p > L.y1 + 1) continue;
        ctx.fillText(L.yt.lab[i], L.x0 - L.pad * 0.8, Math.round(p));
      }
      if (c.ya.unit) { ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(String(c.ya.unit).toUpperCase(), L.x0, Math.round(L.pad * 0.5)); }
    }
    if (L.showX) {
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (i = 0; i < L.xt.v.length; i++) {
        if (!L.xt.lab[i]) continue;
        p = L.x0 + aT(c.xa, L.xt.v[i]) * L.w;
        ctx.fillText(L.xt.lab[i], Math.round(p), L.y1 + L.pad * 0.9);
      }
      if (c.xa.unit && c.xa.unit !== "s") { ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText(String(c.xa.unit).toUpperCase(), L.x1, Math.round(L.pad * 0.5)); }
    }
  }

  /* ===========================================================================
     spectrum
     =========================================================================== */
  function createSpectrum(el, opts, cfg) {
    cfg = cfg || {};
    var overlay = !!cfg.overlay;
    var label = overlay ? "" : prepareHost(el, "spectrum", opts);
    if (overlay) el.classList.add("apc-viz", "apc-viz-spectrum", "apc-viz-overlay");
    var disposed = false;
    var xtype = pick(opts.xscale, ["log", "linear"], "log");
    var xa = makeAxis(num(opts.fmin, 20), num(opts.fmax, 20000), xtype, "Hz");
    var ya = makeAxis(num(opts.dbmin, -90), num(opts.dbmax, 0), "linear", "dB");
    var style = pick(opts.style, ["fill", "line", "bars"], "fill");
    var bands = clamp(Math.round(num(opts.bands, 48)), 4, 256);
    var smoothing = clamp(num(opts.smoothing, 0.6), 0, 0.98);
    var peakHold = bool(opts.peakHold, !overlay);
    var holdMs = num(opts.holdMs, 900), fall = num(opts.fall, 18);
    var slope = num(opts.slope, 0);
    var fsDefault = num(opts.fs, 48000);
    var axes = overlay ? "none" : pick(opts.axes, ["both", "x", "y", "none", "true", "false"], "both");
    var axesMode = axes === "true" ? "both" : (axes === "false" ? "none" : axes);
    var showGrid = overlay ? false : bool(opts.grid, true);
    var st = { src: null, n: 0, fs: fsDefault, log: false, ncol: 0, cur: null, pk: null, pkT: null, mapKey: "", colA: null, colB: null, colF: null,
      lay: null, lastT: 0, frames: 0, hasData: false };
    var desc = overlay ? null : srNode("");
    if (desc) { el.appendChild(desc); el.setAttribute("role", "img"); el.setAttribute("aria-label", label); el.setAttribute("aria-describedby", desc.id); }
    var sumT = desc ? throttleText(desc, null, 1000) : null;
    var view = createView(el, "spectrum", draw, st);
    var API = { kind: "spectrum", el: el, view: view };
    var feedId = vizId(el, opts);
    var unsub = null;

    function colCount(L) { return style === "bars" ? bands : clamp(Math.round(L ? L.w : view.w), 2, 1024); }
    function ensureCols(L) {
      var nc = colCount(L);
      if (st.ncol !== nc) {
        st.ncol = nc; st.cur = new Float32Array(nc); st.pk = new Float32Array(nc); st.pkT = new Float64Array(nc);
        st.colA = new Float32Array(nc); st.colB = new Float32Array(nc); st.colF = new Float32Array(nc);
        for (var i = 0; i < nc; i++) { st.cur[i] = st.pk[i] = ya.min; }
        st.mapKey = "";
      }
    }
    function remap() {
      var key = st.n + "|" + st.fs + "|" + st.log + "|" + st.ncol + "|" + xa.min + "|" + xa.max + "|" + xa.type;
      if (key === st.mapKey) return;
      st.mapKey = key;
      var nc = st.ncol, i, f0, f1, n = st.n;
      for (i = 0; i < nc; i++) {
        f0 = aV(xa, i / nc); f1 = aV(xa, (i + 1) / nc);
        st.colF[i] = aV(xa, (i + 0.5) / nc);
        if (st.log) {                       /* source bins already log-spaced over [fmin,fmax] */
          st.colA[i] = (i / nc) * (n - 1); st.colB[i] = ((i + 1) / nc) * (n - 1);
        } else {
          var nyq = st.fs / 2;
          st.colA[i] = clamp(f0 / nyq, 0, 1) * (n - 1); st.colB[i] = clamp(f1 / nyq, 0, 1) * (n - 1);
        }
      }
    }
    function setData(db, o) {
      if (disposed || !db || !db.length) return;
      o = o || {};
      st.src = db; st.n = db.length;
      if (o.fs > 0) st.fs = o.fs;
      st.log = !!o.log;
      ensureCols(st.lay);
      remap();
      var now = viz.now(), dt = st.lastT ? clamp((now - st.lastT) / 1000, 0, 0.25) : 0, rm = reducedMotion() || !!o.instant;
      st.lastT = now;
      var nc = st.ncol, i, a, b, ia, ib, val, k, fr, atk = rm ? 0 : smoothing * 0.35, rel = rm ? 0 : smoothing, c;
      for (i = 0; i < nc; i++) {
        a = st.colA[i]; b = st.colB[i];
        if (b - a < 1) {            /* sub-bin column: interpolate */
          var mid = (a + b) / 2; ia = Math.floor(mid); ib = Math.min(st.n - 1, ia + 1); fr = mid - ia;
          val = db[ia] * (1 - fr) + db[ib] * fr;
        } else {
          ia = Math.max(0, Math.floor(a)); ib = Math.min(st.n - 1, Math.ceil(b));
          val = -Infinity;
          for (k = ia; k <= ib; k++) if (db[k] > val) val = db[k];
        }
        if (slope && st.colF[i] > 0) val += slope * (Math.log(st.colF[i] / 1000) / Math.LN2);
        if (!isFinite(val)) val = ya.min;
        c = st.cur[i];
        c = val > c ? c + (val - c) * (1 - atk) : c + (val - c) * (1 - rel);
        st.cur[i] = c;
        /* peak hold with timed fall */
        if (c >= st.pk[i]) { st.pk[i] = c; st.pkT[i] = now; }
        else if (now - st.pkT[i] > holdMs) {
          if (rm) st.pk[i] = c; else st.pk[i] = Math.max(c, st.pk[i] - fall * dt);
        }
      }
      st.hasData = true;
      if (!o.instant) st.frames++;
      if (sumT) updateSummary();
      view.invalidate();
    }
    function updateSummary() {
      var best = -Infinity, bi = 0, i;
      for (i = 0; i < st.ncol; i++) if (st.cur[i] > best) { best = st.cur[i]; bi = i; }
      if (best > ya.min + 1) sumT.update(label + ". Strongest component " + fmtValue(st.colF[bi], "Hz") + " at " + trimNum(best, 1) + " dB.");
      else sumT.update(label + ". No signal.");
    }
    function layoutNow(ctx, v) {
      st.lay = overlay ? { x0: 0, y0: 0, x1: v.w, y1: v.h, w: v.w, h: v.h, xt: null, yt: null } :
        plotLayout(ctx, v, { axes: axesMode, xa: xa, ya: ya, signedY: false });
      var oldN = st.ncol;
      ensureCols(st.lay);
      if (st.ncol !== oldN && st.src) { setData(st.src, { fs: st.fs, log: st.log, instant: true }); }   /* columns were rebuilt: re-derive them without smoothing */
    }
    function draw(ctx, v) {
      var th = v.theme;
      if (v.layoutStale || !st.lay) { layoutNow(ctx, v); v.layoutStale = false; }
      var L = st.lay, ld = lwDev(v), i, nc = st.ncol, x, y, bw, gap;
      if (!overlay) {
        ctx.fillStyle = th.inset; ctx.fillRect(0, 0, v.w, v.h);
        plotBase(ctx, v, L, { xa: xa, ya: ya, grid: showGrid });
      }
      if (st.hasData && st.cur) {
        ctx.save();
        ctx.beginPath(); ctx.rect(L.x0, L.y0, L.w, L.h + 1); ctx.clip();
        var lineW = Math.max(th.stroke * 1.25, 1.25);
        if (style === "bars") {
          gap = Math.max(ld / v.sx, 1 / v.sx) * (L.w / nc > 6 ? 2 : 1);
          bw = L.w / nc;
          ctx.fillStyle = th.ok;   /* the spectrum is ENERGY: cyan (--ok / --meter-ok), not the limit red */
          if (overlay) ctx.globalAlpha = 0.75;
          for (i = 0; i < nc; i++) {
            y = L.y1 - clamp(aT(ya, st.cur[i]), 0, 1) * L.h;
            var xa0 = Math.round((L.x0 + i * bw) * v.sx) / v.sx, xb0 = Math.round((L.x0 + (i + 1) * bw - gap) * v.sx) / v.sx;
            var yy = Math.round(y * v.sy) / v.sy;
            if (L.y1 - yy > 0.5) ctx.fillRect(xa0, yy, Math.max(1 / v.sx, xb0 - xa0), L.y1 - yy);
          }
          ctx.globalAlpha = 1;
          if (peakHold) {
            ctx.fillStyle = th.ink;
            for (i = 0; i < nc; i++) {
              y = L.y1 - clamp(aT(ya, st.pk[i]), 0, 1) * L.h;
              var xa1 = Math.round((L.x0 + i * bw) * v.sx) / v.sx, xb1 = Math.round((L.x0 + (i + 1) * bw - gap) * v.sx) / v.sx;
              var py = Math.round(y * v.sy) / v.sy;
              if (st.pk[i] > ya.min + 0.5) ctx.fillRect(xa1, py, Math.max(1 / v.sx, xb1 - xa1), Math.max(ld, 1) / v.sy);
            }
          }
        } else {
          var cw = L.w / (nc - 1 || 1);
          if (style === "fill") {
            ctx.beginPath();
            ctx.moveTo(L.x0, L.y1);
            for (i = 0; i < nc; i++) ctx.lineTo(L.x0 + i * cw, L.y1 - clamp(aT(ya, st.cur[i]), 0, 1) * L.h);
            ctx.lineTo(L.x0 + (nc - 1) * cw, L.y1); ctx.closePath();
            ctx.fillStyle = th.fill; ctx.fill();
          }
          ctx.beginPath();
          for (i = 0; i < nc; i++) {
            x = L.x0 + i * cw; y = L.y1 - clamp(aT(ya, st.cur[i]), 0, 1) * L.h;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = overlay ? th.accent : th.line; ctx.lineWidth = lineW; ctx.lineJoin = "round"; ctx.stroke();
          if (peakHold) {
            ctx.beginPath();
            for (i = 0; i < nc; i++) {
              x = L.x0 + i * cw; y = L.y1 - clamp(aT(ya, st.pk[i]), 0, 1) * L.h;
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = th.axis; ctx.lineWidth = Math.max(th.stroke, 1); ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (!overlay) plotFrameAndLabels(ctx, v, L, { xa: xa, ya: ya });
      return false;
    }

    API.setData = setData;
    API.clear = function () {
      if (!st.cur) return;
      for (var i = 0; i < st.ncol; i++) { st.cur[i] = st.pk[i] = ya.min; }
      st.hasData = false; view.invalidate();
    };
    API.resetPeaks = function () { for (var i = 0; i < st.ncol; i++) st.pk[i] = st.cur[i]; view.invalidate(); };
    API.setRange = function (r) {
      r = r || {};
      setAxisRange(xa, num(r.fmin, xa.min), num(r.fmax, xa.max));
      setAxisRange(ya, num(r.dbmin, ya.min), num(r.dbmax, ya.max));
      st.mapKey = ""; view.layoutStale = true; view.invalidate();
    };
    API.setStyle = function (s) { style = pick(s, ["fill", "line", "bars"], style); st.ncol = 0; view.layoutStale = true; view.invalidate(); };
    API.redraw = function () { view.layoutStale = true; return view.redraw(); };
    API.getState = function () {
      return { cols: st.ncol, cur: st.cur, peak: st.pk, frames: st.frames, style: style, hasData: st.hasData };
    };
    API.geometry = function () { var L = st.lay; if (!L) return null; return { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, w: L.w, h: L.h, mapX: function (f) { return L.x0 + aT(xa, f) * L.w; }, mapY: function (d) { return L.y1 - aT(ya, d) * L.h; } }; };
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      if (unsub) unsub();
      if (sumT) sumT.dispose();
      view.dispose();
      if (desc && desc.parentNode) desc.parentNode.removeChild(desc);
      el.__apcViz = null;
    };
    if (feedId) {
      unsub = viz.subscribe(feedId, "spectrum", function (data) {
        if (!data) return;
        if (isArr(data) && typeof data[0] === "number") setData(data);
        else if (data.db && data.db.length) setData(data.db, { fs: data.fs, log: data.log });
      }, { kind: "spectrum" });
    }
    if (!overlay) el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     waveform / scope
     =========================================================================== */
  function createWaveform(el, opts, forceMode) {
    var label = prepareHost(el, forceMode === "scope" ? "scope" : "waveform", opts);
    var disposed = false;
    var mode = forceMode || pick(opts.mode, ["static", "scroll", "scope"], "static");
    var ya = makeAxis(num(opts.ymin, -1), num(opts.ymax, 1), "linear", opts.yunit || "");
    var xa = makeAxis(0, 1, "linear", "");
    var axes = pick(opts.axes, ["both", "x", "y", "none", "true", "false"], "none");
    if (axes === "true") axes = "both"; else if (axes === "false") axes = "none";
    var showGrid = bool(opts.grid, true);
    var trigger = bool(opts.trigger, mode === "scope");
    var spc = Math.max(1, Math.round(num(opts.spc, 256)));
    var cap = clamp(Math.round(num(opts.cols, 2048)), 64, 8192);
    var st = { smp: null, nS: 0, pkMin: null, pkMax: null, nP: 0, rMin: new Float32Array(cap), rMax: new Float32Array(cap), rN: 0, rHead: 0,
      accMin: 0, accMax: 0, accN: 0, cursor: -1, lay: null, frames: 0 };
    var desc = srNode("");
    el.appendChild(desc);
    el.setAttribute("role", "img"); el.setAttribute("aria-label", label); el.setAttribute("aria-describedby", desc.id);
    var sumT = throttleText(desc, null, 1000);
    var view = createView(el, forceMode === "scope" ? "scope" : "waveform", draw, st);
    var API = { kind: forceMode === "scope" ? "scope" : "waveform", el: el, view: view, mode: mode };
    var feedId = vizId(el, opts), unsub = null;

    function summarize() {
      var lo = Infinity, hi = -Infinity, i;
      if (st.smp) { for (i = 0; i < st.nS; i++) { if (st.smp[i] < lo) lo = st.smp[i]; if (st.smp[i] > hi) hi = st.smp[i]; } }
      else if (st.pkMin) { for (i = 0; i < st.nP; i++) { if (st.pkMin[i] < lo) lo = st.pkMin[i]; if (st.pkMax[i] > hi) hi = st.pkMax[i]; } }
      else if (st.rN) { for (i = 0; i < st.rN; i++) { if (st.rMin[i] < lo) lo = st.rMin[i]; if (st.rMax[i] > hi) hi = st.rMax[i]; } }
      if (lo === Infinity) sumT.update(label + ". Empty.");
      else sumT.update(label + ". Range " + trimNum(lo, 2) + " to " + trimNum(hi, 2) + (mode === "static" ? "" : ", live") + ".");
    }
    function toF32(a) { if (a && a.buffer && a instanceof Float32Array) return a; var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i]; return o; }
    API.setSamples = function (a) { if (!a || !a.length) return; st.smp = toF32(a); st.nS = a.length; st.pkMin = st.pkMax = null; st.frames++; summarize(); view.invalidate(); };
    API.setPeaks = function (mn, mx) {
      if (!mn || !mx || !mn.length || mn.length !== mx.length) return;
      st.pkMin = toF32(mn); st.pkMax = toF32(mx); st.nP = mn.length; st.smp = null; st.frames++; summarize(); view.invalidate();
    };
    function pushCol(lo, hi) {
      st.rMin[st.rHead] = lo; st.rMax[st.rHead] = hi;
      st.rHead = (st.rHead + 1) % cap;
      if (st.rN < cap) st.rN++;
    }
    API.pushPeaks = function (mn, mx) {
      for (var i = 0; i < mn.length; i++) pushCol(mn[i], mx[i]);
      st.frames++; summarize(); view.invalidate();
    };
    API.pushSamples = function (a) {
      for (var i = 0; i < a.length; i++) {
        var s = a[i];
        if (st.accN === 0) { st.accMin = st.accMax = s; } else { if (s < st.accMin) st.accMin = s; if (s > st.accMax) st.accMax = s; }
        if (++st.accN >= spc) { pushCol(st.accMin, st.accMax); st.accN = 0; }
      }
      st.frames++; summarize(); view.invalidate();
    };
    API.clear = function () { st.smp = null; st.pkMin = st.pkMax = null; st.rN = 0; st.rHead = 0; st.accN = 0; summarize(); view.invalidate(); };
    API.setCursor = function (p) { st.cursor = p === null || p === undefined ? -1 : clamp(Number(p), 0, 1); view.invalidate(); };
    API.redraw = function () { view.layoutStale = true; return view.redraw(); };
    API.getState = function () { return { mode: mode, samples: st.nS, peaks: st.nP, cols: st.rN, frames: st.frames, cursor: st.cursor }; };
    API.geometry = function () { var L = st.lay; if (!L) return null; return { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1, w: L.w, h: L.h, mapY: function (val) { return L.y1 - aT(ya, val) * L.h; } }; };
    API.dispose = function () { if (disposed) return; disposed = true; if (unsub) unsub(); sumT.dispose(); view.dispose(); if (desc.parentNode) desc.parentNode.removeChild(desc); el.__apcViz = null; };

    function draw(ctx, v) {
      var th = v.theme;
      if (v.layoutStale || !st.lay) { st.lay = plotLayout(ctx, v, { axes: axes, xa: xa, ya: ya }); v.layoutStale = false; }
      var L = st.lay, ld = lwDev(v), i, c, y0, y1, x;
      ctx.fillStyle = th.inset; ctx.fillRect(0, 0, v.w, v.h);
      plotBase(ctx, v, L, { xa: xa, ya: ya, grid: false });
      /* centre line + +-50 % guides */
      var zy = L.y1 - aT(ya, 0) * L.h;
      if (showGrid) {
        var qy = [0.5, -0.5];
        for (i = 0; i < 2; i++) { var gy = L.y1 - aT(ya, qy[i] * (ya.max)) * L.h; ctx.globalAlpha = 0.5; hline(ctx, v, gy, L.x0, L.x1, th.grid, ld); }
        ctx.globalAlpha = 1;
        hline(ctx, v, zy, L.x0, L.x1, th.grid, ld);
      }
      var ncol = Math.max(1, Math.round(L.w * v.sx));       /* one column per DEVICE pixel */
      var cw = 1 / v.sx;
      ctx.fillStyle = th.line;
      if (mode === "static" && (st.smp || st.pkMin)) {
        var N = st.smp ? st.nS : st.nP, ptsMode = st.smp && N <= L.w / 2;
        if (ptsMode) {
          ctx.beginPath();
          for (i = 0; i < N; i++) { x = L.x0 + (N > 1 ? i / (N - 1) : 0) * L.w; var yy = L.y1 - clamp(aT(ya, st.smp[i]), 0, 1) * L.h; if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
          ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(th.stroke * 1.25, 1.25); ctx.stroke();
        } else {
          for (c = 0; c < ncol; c++) {
            var s0 = Math.floor(c * N / ncol), s1 = Math.max(s0 + 1, Math.ceil((c + 1) * N / ncol)), lo = Infinity, hi = -Infinity, k;
            if (st.smp) { for (k = s0; k < s1 && k < N; k++) { var sv = st.smp[k]; if (sv < lo) lo = sv; if (sv > hi) hi = sv; } }
            else { for (k = s0; k < s1 && k < N; k++) { if (st.pkMin[k] < lo) lo = st.pkMin[k]; if (st.pkMax[k] > hi) hi = st.pkMax[k]; } }
            if (lo === Infinity) continue;
            y0 = L.y1 - clamp(aT(ya, hi), 0, 1) * L.h; y1 = L.y1 - clamp(aT(ya, lo), 0, 1) * L.h;
            var ry0 = Math.round(y0 * v.sy) / v.sy, ry1 = Math.round(y1 * v.sy) / v.sy;
            ctx.fillRect(L.x0 + c * cw, ry0, cw, Math.max(1 / v.sy, ry1 - ry0));
          }
        }
      } else if (mode === "scroll" && st.rN) {
        var shown = Math.min(st.rN, ncol);
        for (c = 0; c < shown; c++) {
          var ix = (st.rHead - shown + c + cap * 2) % cap, xx = L.x1 - (shown - c) * cw;
          y0 = L.y1 - clamp(aT(ya, st.rMax[ix]), 0, 1) * L.h; y1 = L.y1 - clamp(aT(ya, st.rMin[ix]), 0, 1) * L.h;
          var qy0 = Math.round(y0 * v.sy) / v.sy, qy1 = Math.round(y1 * v.sy) / v.sy;
          ctx.fillRect(Math.round(xx * v.sx) / v.sx, qy0, cw, Math.max(1 / v.sy, qy1 - qy0));
        }
      } else if (mode === "scope" && st.smp) {
        var start = 0, N2 = st.nS, span = N2;
        if (trigger) { for (i = 1; i < N2 / 2; i++) if (st.smp[i - 1] < 0 && st.smp[i] >= 0) { start = i; break; } span = N2 - start; }
        ctx.beginPath();
        var pts = Math.min(span, Math.max(2, Math.round(L.w)));
        for (i = 0; i < pts; i++) {
          var si = start + Math.floor(i * (span - 1) / (pts - 1));
          x = L.x0 + (i / (pts - 1)) * L.w; var sy2 = L.y1 - clamp(aT(ya, st.smp[si]), 0, 1) * L.h;
          if (i === 0) ctx.moveTo(x, sy2); else ctx.lineTo(x, sy2);
        }
        ctx.strokeStyle = th.line; ctx.lineWidth = Math.max(th.stroke * 1.25, 1.25); ctx.lineJoin = "round"; ctx.stroke();
      }
      if (st.cursor >= 0) vline(ctx, v, L.x0 + st.cursor * L.w, L.y0, L.y1, th.accent, Math.max(lwDev(v), 1));
      plotFrameAndLabels(ctx, v, L, { xa: xa, ya: ya });
      return false;
    }
    if (feedId) {
      unsub = viz.subscribe(feedId, API.kind, function (data) {
        if (!data) return;
        if (isArr(data) && typeof data[0] === "number") { if (mode === "scroll") API.pushSamples(data); else API.setSamples(data); return; }
        if (data.min && data.max) { if (mode === "scroll") API.pushPeaks(data.min, data.max); else API.setPeaks(data.min, data.max); }
        else if (data.samples) { if (mode === "scroll") API.pushSamples(data.samples); else API.setSamples(data.samples); }
      }, { kind: API.kind, mode: mode });
    }
    var initial = jsonOpt(opts.samples, null, "data-samples");
    if (initial && initial.length) API.setSamples(initial);
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     meter
     =========================================================================== */
  function toDb(v, input) {
    if (typeof v !== "number" || !isFinite(v)) return -Infinity;
    if (input === "db") return v;
    return v > 1e-6 ? 20 * Math.log(v) / Math.LN10 : -120;
  }
  function createMeter(el, opts) {
    var label = prepareHost(el, "meter", opts);
    var disposed = false, timers = [];
    var horiz = /^h/i.test(String(opts.orientation || ""));
    var channels = opts.meterR ? 2 : clamp(Math.round(num(opts.channels, 1)), 1, 2);
    var dbmin = num(opts.min, -60), dbmax = num(opts.max, 6);
    var warnAt = num(opts.warn, -12), clipAt = num(opts.clipAt, 0);
    var style = pick(opts.style, ["continuous", "segmented"], "continuous");
    var segOpt = Math.round(num(opts.segments, 0));
    var peakHold = bool(opts.peakHold, true), holdMs = num(opts.holdMs, 1500), fall = num(opts.fall, 24);
    var showTicks = bool(opts.ticks, true);
    var input = pick(opts.input, ["db", "linear"], "linear");
    var announce = bool(opts.announce, false);
    var ya = makeAxis(dbmin, dbmax, "linear", "dB");
    var st = { lvl: [dbmin, dbmin], tgt: [dbmin, dbmin], pk: [dbmin, dbmin], pkT: [0, 0], clip: false, lastTs: 0, lay: null, frames: 0, ticks: null };
    el.classList.add(horiz ? "apc-viz-meter--h" : "apc-viz-meter--v");
    el.setAttribute("role", "meter");
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-valuemin", String(dbmin)); el.setAttribute("aria-valuemax", String(dbmax)); el.setAttribute("aria-valuenow", String(dbmin));
    el.setAttribute("aria-valuetext", "No signal");
    var clipBtn = h("button", { class: "apc-viz-clip", type: "button", "aria-label": label + " clip indicator: not clipped. Press to reset." });
    var live = h("span", { class: "apc-viz-sr", role: "status", "aria-live": announce ? "polite" : "off" });
    el.appendChild(clipBtn); el.appendChild(live);
    var view = createView(el, "meter", draw, st);
    var API = { kind: "meter", el: el, view: view };
    var idL = opts.meter || opts.viz || opts.id || el.id || "", idR = opts.meterR || "";
    var elId = el.id || opts.id || idL;
    var unsubs = [];
    var lastAria = 0, lastAnnounce = 0;

    function textOf() {
      var t = [], i;
      for (i = 0; i < channels; i++) t.push((channels > 1 ? (i ? "R " : "L ") : "") + (st.lvl[i] <= dbmin + 0.05 ? "off" : trimNum(st.lvl[i], 1) + " dB"));
      return t.join(", ") + (st.clip ? ", clipped" : "");
    }
    function updateAria(force) {
      var n = viz.now();
      if (!force && n - lastAria < 250) return;
      lastAria = n;
      var mx = Math.max(st.lvl[0], channels > 1 ? st.lvl[1] : -Infinity);
      el.setAttribute("aria-valuenow", String(Math.round(clamp(mx, dbmin, dbmax) * 10) / 10));
      el.setAttribute("aria-valuetext", textOf());
      if (announce && n - lastAnnounce > 1500) { lastAnnounce = n; live.textContent = textOf(); }
    }
    function setClip(on) {
      if (st.clip === on) return;
      st.clip = on;
      el.classList.toggle("is-clipped", on);
      clipBtn.setAttribute("aria-label", label + " clip indicator: " + (on ? "clipped. Press to reset." : "not clipped. Press to reset."));
      if (on) { live.textContent = label + " clipped"; if (!announce) { /* one-shot announcement */ live.setAttribute("aria-live", "polite"); timers.push(setTimeout(function () { live.setAttribute("aria-live", announce ? "polite" : "off"); }, 1000)); } }
      APC.emit("meter:clip", { id: elId, on: on });
      fireDom(el, "apc-clip", { id: elId, on: on });
      updateAria(true);
      view.invalidate();
    }
    function setLevel(db, ch, peakDb) {
      ch = ch || 0;
      if (disposed || ch > 1 || (ch === 1 && channels < 2)) return;
      if (typeof db !== "number" || !isFinite(db)) db = dbmin;
      st.tgt[ch] = db;
      var now = viz.now();
      var p = (typeof peakDb === "number" && isFinite(peakDb)) ? peakDb : db;
      if (p >= st.pk[ch]) { st.pk[ch] = p; st.pkT[ch] = now; }
      if (db >= st.lvl[ch] || reducedMotion()) st.lvl[ch] = db;
      if (Math.max(db, p) >= clipAt) setClip(true);
      st.frames++;
      updateAria(false);
      view.invalidate();
    }
    /* advance the ballistics by dtMs; returns true while something is still moving */
    function isMoving() {
      for (var ch = 0; ch < channels; ch++) {
        if (st.lvl[ch] > st.tgt[ch]) return true;
        if (peakHold && st.pk[ch] > st.lvl[ch]) return true;      /* holding or falling */
      }
      return false;
    }
    function advance(dtMs) {
      var dt = dtMs / 1000, ch, now = viz.now(), rm = reducedMotion();
      for (ch = 0; ch < channels; ch++) {
        if (st.lvl[ch] > st.tgt[ch]) {
          if (rm) st.lvl[ch] = st.tgt[ch];
          else st.lvl[ch] = Math.max(st.tgt[ch], st.lvl[ch] - fall * dt);
        }
        if (st.pk[ch] > st.lvl[ch] && now - st.pkT[ch] > holdMs) {
          if (rm) st.pk[ch] = st.lvl[ch];
          else st.pk[ch] = Math.max(st.lvl[ch], st.pk[ch] - fall * 0.6 * dt);
        }
      }
      return isMoving();
    }
    function dbPos(L, db) { return clamp(aT(ya, db), 0, 1); }
    function layoutNow(ctx, v) {
      var th = v.theme, fs = th.labelPx, pad = Math.round(fs * 0.4), lamp = Math.round(fs * 0.9), gap = 2;
      setFont(ctx, v, fs);
      var tk = axisTicks(ya, (horiz ? v.w : v.h) - lamp, Math.max(fs * 2.6, 20), true, null), tickW = 0, i;
      if (showTicks) {
        if (horiz) tickW = Math.round(fs * 1.2);
        else { for (i = 0; i < tk.lab.length; i++) if (tk.lab[i]) tickW = Math.max(tickW, ctx.measureText(tk.lab[i]).width); tickW = Math.round(tickW + pad * 1.6); }
      }
      var L = { lamp: lamp, pad: pad, tickW: tickW, tk: tk, fs: fs };
      if (!horiz) {
        L.aS = lamp + pad; L.aE = v.h - (showTicks ? Math.round(fs * 0.5) : 0);       /* along axis: value 0 = bottom (aE) */
        L.cS = 0; L.cE = Math.max(4, v.w - tickW);
        L.lampRect = null;
      } else {
        L.aS = showTicks ? Math.round(fs * 1.3) : 0; L.aE = v.w - lamp - pad;
        L.cS = 0; L.cE = Math.max(4, v.h - tickW);
      }
      var thick = (L.cE - L.cS - gap * (channels - 1)) / channels;
      var maxT = th.nodePx * 2.2;
      if (thick > maxT) { var used = maxT * channels + gap * (channels - 1), off = (L.cE - L.cS - used) / 2; L.cS += off; L.cE = L.cS + used; thick = maxT; }
      L.thick = thick; L.gap = gap;
      /* lamp rect = across all bars at the end of the along-axis */
      if (!horiz) { L.lx = L.cS; L.ly = 0; L.lw = L.cE - L.cS; L.lh = lamp; }
      else { L.lx = v.w - lamp; L.ly = L.cS; L.lw = lamp; L.lh = L.cE - L.cS; }
      clipBtn.style.left = Math.round(L.lx) + "px"; clipBtn.style.top = Math.round(L.ly) + "px";
      clipBtn.style.width = Math.round(L.lw) + "px"; clipBtn.style.height = Math.round(L.lh) + "px";
      st.lay = L;
    }
    function zoneColor(th, db) { return db >= clipAt ? th.clip : (db >= warnAt ? th.warn : th.ok); }
    /* map (along, cross) rectangles to x/y depending on orientation */
    function rectAC(ctx, v, a0, a1, c0, c1) {
      /* a0..a1 along axis in layout coords (vertical: y), c0..c1 cross (vertical: x) */
      var x0, x1, y0, y1;
      if (!horiz) { x0 = c0; x1 = c1; y0 = Math.min(a0, a1); y1 = Math.max(a0, a1); }
      else { y0 = c0; y1 = c1; x0 = Math.min(a0, a1); x1 = Math.max(a0, a1); }
      var rx0 = Math.round(x0 * v.sx) / v.sx, rx1 = Math.round(x1 * v.sx) / v.sx, ry0 = Math.round(y0 * v.sy) / v.sy, ry1 = Math.round(y1 * v.sy) / v.sy;
      if (rx1 - rx0 > 0 && ry1 - ry0 > 0) ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    }
    function alongOf(L, db) { var t = dbPos(L, db); return horiz ? L.aS + t * (L.aE - L.aS) : L.aE - t * (L.aE - L.aS); }
    function draw(ctx, v, ts) {
      var th = v.theme, i, ch;
      if (v.layoutStale || !st.lay) { layoutNow(ctx, v); v.layoutStale = false; }
      var L = st.lay, ld = lwDev(v), dtc = 0;
      if (ts && st.lastTs && ts > st.lastTs) dtc = Math.min(ts - st.lastTs, 100);
      if (dtc > 0) advance(dtc);
      var a0 = L.aS, a1 = L.aE;
      /* clip lamp */
      ctx.fillStyle = st.clip ? th.clip : th.inset;
      rectAC(ctx, v, horiz ? L.lx : L.ly, horiz ? L.lx + L.lw : L.ly + L.lh, horiz ? L.ly : L.lx, horiz ? L.ly + L.lh : L.lx + L.lw);
      if (!st.clip) frameRect(ctx, v, L.lx, L.ly, L.lx + L.lw, L.ly + L.lh, th.rule2, ld);
      for (ch = 0; ch < channels; ch++) {
        var c0 = L.cS + ch * (L.thick + L.gap), c1 = c0 + L.thick;
        /* track */
        ctx.fillStyle = th.inset;
        rectAC(ctx, v, a0, a1, c0, c1);
        var lvl = st.lvl[ch], pk = st.pk[ch];
        if (style === "segmented") {
          var nSeg = segOpt > 0 ? segOpt : Math.max(4, Math.floor(Math.abs(a1 - a0) / Math.max(4, th.nodePx * 0.55)));
          var segLen = Math.abs(a1 - a0) / nSeg, gapPx = Math.max(ld / Math.min(v.sx, v.sy), 1 / Math.min(v.sx, v.sy)) * (segLen > 5 ? 2 : 1);
          for (i = 0; i < nSeg; i++) {
            var tMid = (i + 0.5) / nSeg, dbMid = dbmin + tMid * (dbmax - dbmin);
            var sa0 = horiz ? a0 + i * segLen : a1 - (i + 1) * segLen, sa1 = horiz ? a0 + (i + 1) * segLen : a1 - i * segLen;
            var lit = lvl >= dbMid, isPk = peakHold && pk > lvl && Math.abs(pk - dbMid) <= (dbmax - dbmin) / nSeg * 0.5;
            ctx.fillStyle = (lit || isPk) ? zoneColor(th, dbMid) : th.ledOff;
            if (!lit && !isPk) ctx.globalAlpha = 0.55;
            rectAC(ctx, v, horiz ? sa0 : sa0 + gapPx / 2, horiz ? sa1 - gapPx : sa1 - gapPx / 2, c0 + 0, c1);
            ctx.globalAlpha = 1;
          }
        } else {
          /* continuous: ok / warn / clip zones, each a flat rectangle */
          var z0 = dbmin, zs = [warnAt, clipAt, dbmax], zc = [th.ok, th.warn, th.clip], zi, zlo = dbmin, zhi;
          for (zi = 0; zi < 3; zi++) {
            zhi = Math.min(zs[zi], dbmax);
            var top = Math.min(lvl, zhi);
            if (top > zlo) {
              ctx.fillStyle = zc[zi];
              rectAC(ctx, v, alongOf(L, zlo), alongOf(L, top), c0, c1);
            }
            zlo = Math.max(zlo, zhi);
          }
          if (peakHold && pk > dbmin + 0.2) {
            ctx.fillStyle = th.ink;
            var pp = alongOf(L, pk), wpx = Math.max(ld / Math.min(v.sx, v.sy), 1 / Math.min(v.sx, v.sy)) * 2;
            rectAC(ctx, v, horiz ? pp - wpx : pp, horiz ? pp : pp + wpx, c0, c1);
          }
        }
        frameRect(ctx, v, horiz ? a0 : c0, horiz ? c0 : a0, horiz ? a1 : c1, horiz ? c1 : a1, th.rule2, ld);
      }
      /* scale ticks + labels */
      if (showTicks && L.tickW > 0) {
        setFont(ctx, v, L.fs);
        ctx.fillStyle = th.axis;
        var tk = L.tk;
        for (i = 0; i < tk.v.length; i++) {
          var pos = alongOf(L, tk.v[i]);
          if (!horiz) {
            hline(ctx, v, pos, L.cE + 1, L.cE + 1 + L.pad * 0.7, th.axis, ld);
            if (tk.lab[i]) { ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(tk.lab[i], L.cE + 1 + L.pad * 1.0, Math.round(pos)); }
          } else {
            vline(ctx, v, pos, L.cE + 1, L.cE + 1 + L.pad * 0.7, th.axis, ld);
            if (tk.lab[i]) { ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(tk.lab[i], Math.round(pos), L.cE + 1 + L.pad * 1.0); }
          }
        }
      }
      var more = isMoving();
      st.lastTs = more ? (ts || 0) : 0;      /* idle: the next burst starts a fresh time base */
      if (more) updateAria(false);
      return more;
    }

    API.setLevel = function (db, ch, peak) { setLevel(db, ch, peak); };
    API.setLevels = function (arr) { for (var i = 0; i < arr.length && i < channels; i++) setLevel(arr[i], i); };
    API.step = function (ms) { var m = advance(ms); updateAria(true); view.invalidate(); return m; };
    API.reset = function () { setClip(false); for (var i = 0; i < 2; i++) st.pk[i] = st.lvl[i]; view.invalidate(); };
    API.resetClip = function () { setClip(false); };
    API.redraw = function () { view.layoutStale = true; return view.redraw(); };
    API.getState = function () { return { level: st.lvl.slice(0, channels), target: st.tgt.slice(0, channels), peak: st.pk.slice(0, channels), clip: st.clip, frames: st.frames, channels: channels }; };
    API.geometry = function () { return st.lay; };
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      unsubs.forEach(function (f) { f(); }); unsubs = [];
      timers.forEach(function (t) { clearTimeout(t); }); timers = [];
      clipBtn.removeEventListener("click", onClip);
      view.dispose();
      if (clipBtn.parentNode) clipBtn.parentNode.removeChild(clipBtn);
      if (live.parentNode) live.parentNode.removeChild(live);
      el.__apcViz = null;
    };
    function onClip() { API.reset(); }
    clipBtn.addEventListener("click", onClip);

    /* data: viz {type:'meter', db | peak | value} or bare number / [l,r]; native `meter` event {id, value} (input = linear|db) */
    function onData(data, ch0, fromMeterEvent) {
      if (data === undefined || data === null) return;
      var inp = fromMeterEvent ? input : "db";
      if (typeof data === "number") { setLevel(toDb(data, inp), ch0 || 0); return; }
      if (isArr(data)) { for (var i = 0; i < data.length; i++) setLevel(toDb(data[i], inp), (ch0 || 0) + i); return; }
      var d = data.db !== undefined ? data.db : (data.value !== undefined ? data.value : data.level);
      var pkv = data.peak;
      if (isArr(d)) { for (var j = 0; j < d.length; j++) setLevel(toDb(d[j], data.db !== undefined ? "db" : inp), (ch0 || 0) + j, isArr(pkv) ? toDb(pkv[j], "db") : undefined); }
      else if (typeof d === "number") setLevel(toDb(d, data.db !== undefined ? "db" : inp), ch0 || 0, typeof pkv === "number" ? toDb(pkv, "db") : undefined);
    }
    if (idL) {
      unsubs.push(viz.subscribe(idL, "meter", function (d) { onData(d, 0, false); }, { kind: "meter" }));
      unsubs.push(viz.subscribeMeter(idL, function (p) { onData(p.value, 0, true); }, { kind: "meter" }));
    }
    if (idR) {
      unsubs.push(viz.subscribe(idR, "meter", function (d) { onData(d, 1, false); }, { kind: "meter" }));
      unsubs.push(viz.subscribeMeter(idR, function (p) { onData(p.value, 1, true); }, { kind: "meter" }));
    }
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     stepseq (DOM grid: crisp 1px borders, roving tabindex, token-only CSS)
     =========================================================================== */
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function createStepseq(el, opts) {
    var label = prepareHost(el, "stepseq", opts);
    var disposed = false, offs = [];
    function on(node, type, fn, o) { node.addEventListener(type, fn, o || false); offs.push(function () { node.removeEventListener(type, fn, o || false); }); }
    var mode = pick(opts.mode, ["gate", "value", "pitch"], "gate");
    var count = clamp(Math.round(num(opts.count, 16)), 1, 64);
    var rows = mode === "value" ? 1 : clamp(Math.round(num(opts.rows, mode === "pitch" ? 12 : 4)), 1, 24);
    var length = clamp(Math.round(num(opts.length, count)), 1, count);
    var group = Math.max(0, Math.round(num(opts.group, 4)));
    var vmin = num(opts.min, 0), vmax = num(opts.max, 1);
    var showNums = bool(opts.numbers, true);
    var rowLabels = listOpt(opts.rowLabels);
    var elId = el.id || opts.id || "";
    var paramId = opts.param || "";
    var st = { grid: [], vals: new Float32Array(count), pitch: new Int16Array(count), acc: new Uint8Array(count), play: -1, ar: 0, ac: 0 };
    var r, c;
    for (r = 0; r < rows; r++) st.grid.push(new Uint8Array(count));
    for (c = 0; c < count; c++) { st.vals[c] = vmin; st.pitch[c] = -1; }
    var meta = { length: length, count: count };

    el.classList.add("apc-viz-stepseq--" + mode);
    el.setAttribute("role", "grid");
    el.setAttribute("aria-label", label);
    el.setAttribute("aria-rowcount", String(rows)); el.setAttribute("aria-colcount", String(count));
    el.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter Home End Delete");
    var gridEl = h("div", { class: "apc-viz-steps" });
    var hasLabels = !!rowLabels || mode === "pitch";
    gridEl.style.gridTemplateColumns = (hasLabels ? "auto " : "") + "repeat(" + count + ", minmax(0, 1fr))";
    gridEl.style.gridTemplateRows = (showNums ? "auto " : "") + "repeat(" + rows + ", minmax(0, 1fr))";
    el.appendChild(gridEl);
    var cells = [], cols = [], nums = [];
    function rowLabelText(rv) {
      if (rowLabels && rowLabels[rv] !== undefined) return rowLabels[rv];
      if (mode === "pitch") { var p = rows - 1 - rv; return NOTE_NAMES[p % 12] + (Math.floor(p / 12) + 3); }
      return "";
    }
    if (showNums) {
      var hr = h("div", { class: "apc-viz-steprow", role: "row" });
      if (hasLabels) hr.appendChild(h("div", { class: "apc-viz-rowlabel", role: "columnheader", "aria-hidden": "true" }));
      for (c = 0; c < count; c++) {
        var nEl = h("div", { class: "apc-viz-stepnum" + ((group && c % group === 0) ? " is-group" : ""), role: "columnheader", text: String(c + 1) });
        nums.push(nEl); hr.appendChild(nEl);
      }
      gridEl.appendChild(hr);
    }
    for (c = 0; c < count; c++) cols.push([]);
    for (r = 0; r < rows; r++) {
      var rowEl = h("div", { class: "apc-viz-steprow", role: "row" }), rowCells = [];
      if (hasLabels) rowEl.appendChild(h("div", { class: "apc-viz-rowlabel", role: "rowheader", text: rowLabelText(r) }));
      for (c = 0; c < count; c++) {
        var cell = h("div", { class: "apc-viz-step" + ((group && c % group === 0) ? " is-group" : ""), role: "gridcell", tabindex: "-1", "data-r": r, "data-c": c, "data-state": "0", "aria-selected": "false" });
        if (mode === "value") cell.appendChild(h("div", { class: "apc-viz-bar" }));
        rowCells.push(cell); cols[c].push(cell); rowEl.appendChild(cell);
      }
      cells.push(rowCells); gridEl.appendChild(rowEl);
    }
    var desc = srNode("");
    el.appendChild(desc);

    /* ---- state <-> cells ---- */
    function stateOf(rv, cv) {
      if (mode === "gate") return st.grid[rv][cv];
      if (mode === "pitch") return (st.pitch[cv] === rows - 1 - rv) ? (st.acc[cv] ? 2 : 1) : 0;
      return st.vals[cv] > vmin + 1e-9 ? (st.acc[cv] ? 2 : 1) : 0;
    }
    function cellName(rv, cv) {
      var s = stateOf(rv, cv), t = "Step " + (cv + 1) + (mode === "value" ? "" : (mode === "pitch" ? ", " + rowLabelText(rv) : ", row " + (rv + 1) + (rowLabels && rowLabels[rv] ? " " + rowLabels[rv] : "")));
      if (mode === "value") return t + ": " + trimNum(st.vals[cv], 2) + (st.acc[cv] ? ", accent" : "");
      return t + ": " + (s === 2 ? "accent" : (s === 1 ? "on" : "off"));
    }
    function paintCell(rv, cv) {
      var cell = cells[rv][cv], s = stateOf(rv, cv);
      var sv = String(s);
      if (cell.getAttribute("data-state") !== sv) cell.setAttribute("data-state", sv);
      cell.setAttribute("aria-selected", s > 0 ? "true" : "false");
      cell.setAttribute("aria-label", cellName(rv, cv));
      if (mode === "value") {
        var f = vmax > vmin ? clamp((st.vals[cv] - vmin) / (vmax - vmin), 0, 1) : 0;
        cell.firstChild.style.height = (Math.round(f * 1000) / 10) + "%";
        cell.setAttribute("aria-valuenow", String(st.vals[cv]));
      }
    }
    function paintAll() {
      for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < count; cc++) {
        paintCell(rr, cc);
        cells[rr][cc].classList.toggle("is-off", cc >= length);
        cells[rr][cc].setAttribute("aria-disabled", cc >= length ? "true" : "false");
      }
      for (cc = 0; cc < nums.length; cc++) nums[cc].classList.toggle("is-off", cc >= length);
      setActive(st.ar, st.ac, false);
      updateDesc();
    }
    function updateDesc() {
      var on = 0, rr, cc;
      for (cc = 0; cc < length; cc++) for (rr = 0; rr < rows; rr++) if (stateOf(rr, cc) > 0) on++;
      var t = label + ": " + length + " steps" + (mode === "gate" ? ", " + rows + " rows" : "") + ", " + on + " active.";
      if (desc.textContent !== t) desc.textContent = t;
    }
    function setActive(rv, cv, focus) {
      if (cells[st.ar] && cells[st.ar][st.ac]) cells[st.ar][st.ac].setAttribute("tabindex", "-1");
      st.ar = clamp(rv, 0, rows - 1); st.ac = clamp(cv, 0, count - 1);
      var cell = cells[st.ar][st.ac];
      cell.setAttribute("tabindex", "0");
      if (focus) { try { cell.focus({ preventScroll: true }); } catch (e) { cell.focus(); } }
    }
    function setPlayhead(n) {
      n = Math.round(n);
      if (n >= 0) n = n % length;
      if (n === st.play) return;
      var i;
      if (st.play >= 0) {
        for (i = 0; i < cols[st.play].length; i++) cols[st.play][i].classList.remove("is-play");
        if (nums[st.play]) nums[st.play].classList.remove("is-play");
      }
      st.play = n < 0 ? -1 : n;
      if (st.play >= 0) {
        for (i = 0; i < cols[st.play].length; i++) cols[st.play][i].classList.add("is-play");
        if (nums[st.play]) nums[st.play].classList.add("is-play");
      }
    }

    /* ---- model I/O ---- */
    function getSteps() {
      var out, rr, cc;
      if (mode === "gate") { out = []; for (rr = 0; rr < rows; rr++) out.push(Array.prototype.slice.call(st.grid[rr])); return out; }
      if (mode === "value") return Array.prototype.slice.call(st.vals);
      return Array.prototype.slice.call(st.pitch);
    }
    function getAccents() { return Array.prototype.slice.call(st.acc).map(function (x) { return !!x; }); }
    function setSteps(steps, accents) {
      var rr, cc, row;
      if (!steps) return false;
      if (mode === "gate") {
        if (steps.length && !isArr(steps[0])) steps = [steps];
        for (rr = 0; rr < rows; rr++) { row = steps[rr] || []; for (cc = 0; cc < count; cc++) st.grid[rr][cc] = clamp(Math.round(num(row[cc], 0)), 0, 2); }
      } else if (mode === "value") {
        for (cc = 0; cc < count; cc++) st.vals[cc] = clamp(num(steps[cc], vmin), vmin, vmax);
      } else {
        for (cc = 0; cc < count; cc++) { var pv = Math.round(num(steps[cc], -1)); st.pitch[cc] = (pv >= 0 && pv < rows) ? pv : -1; }
      }
      if (accents && mode !== "gate") for (cc = 0; cc < count; cc++) st.acc[cc] = accents[cc] ? 1 : 0;
      paintAll();
      return true;
    }
    var ln = { link: null, ready: false, arrayParam: false };
    var gestureOpen = false, sendTimer = 0;
    function payload() { var d = { id: elId, mode: mode, steps: getSteps(), length: length, count: count }; if (mode !== "gate") d.accents = getAccents(); return d; }
    function emitChange(phase) {
      var d = payload(); d.phase = phase || "change";
      APC.emit("stepseq", d);
      fireDom(el, "apc-stepseq", d);
      updateDesc();
    }
    function sendParam() {
      if (!ln.link || !ln.link.ready || !ln.arrayParam) return;
      bcall("apc.param.set", { id: paramId, value: getSteps() });
    }
    function openGesture() { if (gestureOpen) return; gestureOpen = true; if (ln.link && ln.arrayParam) bcall("apc.param.begin", { id: paramId }); }
    function closeGesture() { if (!gestureOpen) return; gestureOpen = false; sendParam(); if (ln.link && ln.arrayParam) bcall("apc.param.end", { id: paramId }); }
    function commit(rv, cv) { paintCell(rv, cv); updateDesc(); emitChange("change"); }

    /* ---- editing primitives ---- */
    function setCell(rv, cv, s) {
      if (cv >= length) return false;
      if (mode === "gate") { if (st.grid[rv][cv] === s) return false; st.grid[rv][cv] = s; paintCell(rv, cv); return true; }
      if (mode === "pitch") {
        var p = rows - 1 - rv;
        if (s === 0) { if (st.pitch[cv] !== p) return false; var old = st.pitch[cv]; st.pitch[cv] = -1; paintCell(rows - 1 - old, cv); return true; }
        if (st.pitch[cv] === p && ((s === 2) === !!st.acc[cv])) return false;
        var prev = st.pitch[cv];
        st.pitch[cv] = p; st.acc[cv] = s === 2 ? 1 : 0;
        if (prev >= 0 && prev !== p) paintCell(rows - 1 - prev, cv);
        paintCell(rv, cv);
        return true;
      }
      return false;
    }
    function setValue(cv, val) {
      if (cv >= length) return false;
      val = clamp(val, vmin, vmax);
      if (st.vals[cv] === val) return false;
      st.vals[cv] = val; paintCell(0, cv);
      return true;
    }
    function toggleAccent(rv, cv) {
      if (cv >= length) return false;
      if (mode === "gate") { var s0 = st.grid[rv][cv]; return setCell(rv, cv, s0 === 2 ? 1 : 2); }
      if (mode === "pitch") { if (st.pitch[cv] < 0) return false; st.acc[cv] = st.acc[cv] ? 0 : 1; paintCell(rows - 1 - st.pitch[cv], cv); return true; }
      if (st.vals[cv] <= vmin) return false;
      st.acc[cv] = st.acc[cv] ? 0 : 1; paintCell(0, cv); return true;
    }

    /* ---- pointer painting ---- */
    var paint = null;
    function hit(e) {
      var a = cells[0][0].getBoundingClientRect(), b = cells[rows - 1][count - 1].getBoundingClientRect();
      var cw = (b.right - a.left) / count, chh = (b.bottom - a.top) / rows;
      if (!(cw > 0) || !(chh > 0)) return null;
      var cc = Math.floor((e.clientX - a.left) / cw), rr = Math.floor((e.clientY - a.top) / chh);
      if (cc < 0 || cc >= count || rr < 0 || rr >= rows) return { c: clamp(cc, 0, count - 1), r: clamp(rr, 0, rows - 1), out: true, a: a, b: b, ch: chh };
      return { c: cc, r: rr, out: false, a: a, b: b, ch: chh };
    }
    function valueFromY(e, ht) {
      var f = 1 - clamp((e.clientY - ht.a.top) / (ht.b.bottom - ht.a.top), 0, 1);
      var v = vmin + f * (vmax - vmin);
      var q = (vmax - vmin) / 32;
      return e.shiftKey ? v : Math.round(v / q) * q + (vmin - Math.round(vmin / q) * q);
    }
    function applyPaint(e, ht) {
      var changed = false;
      if (mode === "value") {
        if (paint.accent) { if (paint.last !== ht.c) { changed = toggleAccent(0, ht.c); } }
        else changed = setValue(ht.c, paint.clearVal !== undefined ? paint.clearVal : valueFromY(e, ht));
      } else if (paint.accent) {
        if (paint.last !== ht.c + "," + ht.r) changed = mode === "gate" ? setCell(ht.r, ht.c, paint.target) : toggleAccent(ht.r, ht.c);
      } else if (mode === "pitch") {
        changed = setCell(ht.r, ht.c, paint.target === 0 ? 0 : 1);
        if (paint.target === 0 && !changed) { /* erasing on a column whose pitch is elsewhere: clear it */
          if (st.pitch[ht.c] >= 0 && ht.c < length) { var o = st.pitch[ht.c]; st.pitch[ht.c] = -1; paintCell(rows - 1 - o, ht.c); changed = true; }
        }
      } else {
        changed = setCell(ht.r, ht.c, paint.target);
      }
      paint.last = mode === "value" ? ht.c : ht.c + "," + ht.r;
      if (changed) emitChange("change");
    }
    function onDown(e) {
      if (disposed || (e.button !== undefined && e.button !== 0)) return;
      if (e.target && e.target.closest && e.target.closest(".apc-viz-rowlabel,.apc-viz-stepnum")) return;
      var ht = hit(e);
      if (!ht || ht.out) return;
      if (ht.c >= length) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ }
      setActive(ht.r, ht.c, true);
      paint = { pid: e.pointerId, accent: !!e.shiftKey, last: null, target: 1, clearVal: undefined };
      var s = stateOf(ht.r, ht.c);
      if (mode === "gate") paint.target = paint.accent ? (s === 2 ? 1 : 2) : (s > 0 ? 0 : 1);
      else if (mode === "pitch") paint.target = (st.pitch[ht.c] === rows - 1 - ht.r) && !paint.accent ? 0 : 1;
      else if (e.altKey) paint.clearVal = vmin;
      openGesture();
      applyPaint(e, ht);
    }
    function onMove(e) {
      if (!paint || e.pointerId !== paint.pid || disposed) return;
      var ht = hit(e);
      if (!ht) return;
      if (ht.out && mode !== "value") return;
      applyPaint(e, ht);
    }
    function onUp(e) {
      if (!paint || (e.pointerId !== undefined && e.pointerId !== paint.pid)) return;
      try { el.releasePointerCapture(paint.pid); } catch (x) { /* ignore */ }
      paint = null;
      closeGesture();
      emitChange("end");
    }
    on(el, "pointerdown", onDown);
    on(el, "pointermove", onMove);
    on(el, "pointerup", onUp);
    on(el, "pointercancel", onUp);
    on(el, "focusin", function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute("data-r") !== null) setActive(parseInt(t.getAttribute("data-r"), 10), parseInt(t.getAttribute("data-c"), 10), false);
    });

    /* ---- keyboard ---- */
    on(el, "keydown", function (e) {
      if (disposed) return;
      var k = e.key, rr = st.ar, cc = st.ac, handled = true, changed = false;
      if (k === "ArrowRight") cc = Math.min(count - 1, cc + 1);
      else if (k === "ArrowLeft") cc = Math.max(0, cc - 1);
      else if (k === "Home") cc = 0;
      else if (k === "End") cc = length - 1;
      else if (k === "ArrowUp" || k === "ArrowDown") {
        var dir = k === "ArrowUp" ? -1 : 1;                /* grid rows grow downward */
        if (mode === "gate") rr = clamp(rr + dir, 0, rows - 1);
        else if (mode === "pitch") {
          var cur = st.pitch[cc], np = clamp((cur < 0 ? (dir < 0 ? 0 : rows) : cur) - dir, 0, rows - 1);
          openGesture();
          if (cc < length) { var prevp = st.pitch[cc]; st.pitch[cc] = np; if (prevp >= 0) paintCell(rows - 1 - prevp, cc); paintCell(rows - 1 - np, cc); changed = true; }
          rr = rows - 1 - np;
        } else {
          openGesture();
          var stepv = (vmax - vmin) / (e.shiftKey ? 100 : 16);
          changed = setValue(cc, st.vals[cc] - dir * stepv);
        }
      }
      else if (k === " " || k === "Spacebar" || k === "Enter") {
        if (cc < length) {
          openGesture();
          if (mode === "gate") changed = e.shiftKey ? toggleAccent(rr, cc) : setCell(rr, cc, st.grid[rr][cc] > 0 ? 0 : 1);
          else if (mode === "pitch") changed = e.shiftKey ? toggleAccent(rr, cc) : setCell(rr, cc, st.pitch[cc] === rows - 1 - rr ? 0 : 1);
          else changed = e.shiftKey ? toggleAccent(0, cc) : setValue(cc, st.vals[cc] > vmin ? vmin : vmax);
        }
      }
      else if (k === "Delete" || k === "Backspace") {
        openGesture();
        if (mode === "gate") changed = setCell(rr, cc, 0);
        else if (mode === "pitch") { var po = st.pitch[cc]; if (po >= 0 && cc < length) { st.pitch[cc] = -1; st.acc[cc] = 0; paintCell(rows - 1 - po, cc); changed = true; } }
        else { changed = setValue(cc, vmin); st.acc[cc] = 0; }
      }
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      if (rr !== st.ar || cc !== st.ac) setActive(rr, cc, true);
      if (changed) { emitChange("key"); }
      if (gestureOpen) { closeGesture(); }
    });

    /* ---- param + feed binding ---- */
    var offParam = null, unsub = null;
    if (paramId) {
      /* a steps parameter's value is an array, which the numeric ParamLink refuses: read the descriptor ourselves */
      bcall("apc.params.get", { id: paramId }).then(function (d) {
        if (disposed || !d || d.error) return;
        ln.link = { ready: true, desc: d };
        applyParamDesc(d);
      });
      offParam = subscribeEvent("param", paramId, "stepseq", function (ev) {
        if (disposed || !ev || gestureOpen) return;
        if (isArr(ev.value)) setSteps(ev.value, ev.accents);
      }, meta);
    }
    function applyParamDesc(d) {
      if (!d) return;
      ln.arrayParam = !!(d.array === true || d.type === "steps" || d.kind === "steps" || isArr(d.value));
      if (isArr(d.value)) setSteps(d.value, d.accents);
    }
    var feedId = vizId(el, opts);
    if (feedId) {
      unsub = viz.subscribe(feedId, "stepseq", function (data) {
        if (data === undefined || data === null) return;
        if (typeof data === "number") { setPlayhead(data); return; }
        if (data.type === "steps" && data.steps) { setSteps(data.steps, data.accents); return; }
        if (typeof data.step === "number") setPlayhead(data.step);
      }, meta);
    }

    var API = { kind: "stepseq", el: el, mode: mode };
    API.getSteps = getSteps;
    API.getAccents = getAccents;
    API.setSteps = function (s, a) { var ok = setSteps(s, a); if (ok) emitChange("api"); return ok; };
    API.setLength = function (n) {
      length = clamp(Math.round(n), 1, count); meta.length = length;
      paintAll(); if (st.play >= length) setPlayhead(0);
      emitChange("length");
    };
    API.getLength = function () { return length; };
    API.setPlayhead = setPlayhead;
    API.getPlayhead = function () { return st.play; };
    API.getCell = function (rv, cv) { return cells[rv] ? cells[rv][cv] || null : null; };
    API.getActive = function () { return { r: st.ar, c: st.ac }; };
    API.clear = function () { var rr, cc; for (rr = 0; rr < rows; rr++) for (cc = 0; cc < count; cc++) st.grid[rr][cc] = 0; for (cc = 0; cc < count; cc++) { st.vals[cc] = vmin; st.pitch[cc] = -1; st.acc[cc] = 0; } paintAll(); emitChange("clear"); };
    API.redraw = function () { paintAll(); };
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      closeGesture();
      if (offParam) offParam();
      if (unsub) unsub();
      offs.forEach(function (f) { f(); }); offs = [];
      APC.dom.clear(el);
      el.__apcViz = null;
    };

    var init = jsonOpt(opts.steps, null, "data-steps");
    if (init) setSteps(init, jsonOpt(opts.accents, null, "data-accents")); else paintAll();
    setActive(0, 0, false);
    if (opts.playhead !== undefined) setPlayhead(num(opts.playhead, -1));
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     xypad
     =========================================================================== */
  function createXYPad(el, opts) {
    var label = prepareHost(el, "xypad", opts);
    var disposed = false, offs = [];
    function on(node, type, fn, o) { node.addEventListener(type, fn, o || false); offs.push(function () { node.removeEventListener(type, fn, o || false); }); }
    var elId = el.id || opts.id || "";
    var pending = 0;
    function mkLink(pid, min, max, val) {
      if (pid) { var L = ParamLink(pid, function () { if (!disposed) sync(); }); pending++; L.load(function () { pending--; if (!pending) el.removeAttribute("aria-busy"); sync(); }); return L; }
      return LocalLink(min, max, val, val, "");
    }
    var lx = mkLink(opts.x, num(opts.xmin, 0), num(opts.xmax, 1), num(opts.xmin, 0) + (num(opts.xmax, 1) - num(opts.xmin, 0)) / 2);
    var ly = mkLink(opts.y, num(opts.ymin, 0), num(opts.ymax, 1), num(opts.ymin, 0) + (num(opts.ymax, 1) - num(opts.ymin, 0)) / 2);
    if (pending) el.setAttribute("aria-busy", "true");
    var xName = opts.xlabel || "X", yName = opts.ylabel || "Y";
    var gridN = clamp(Math.round(num(opts.grid, 4)), 0, 16);
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", label);
    var thumb = h("div", { class: "apc-viz-thumb", role: "slider", tabindex: "0", "aria-roledescription": "2D pad",
      "aria-label": label + " position", "aria-keyshortcuts": "ArrowUp ArrowDown ArrowLeft ArrowRight PageUp PageDown Home End Delete" });
    var rx = h("span", { class: "apc-viz-xyread apc-viz-xyread--x", "aria-hidden": "true" });
    var ry = h("span", { class: "apc-viz-xyread apc-viz-xyread--y", "aria-hidden": "true" });
    el.appendChild(thumb); el.appendChild(rx); el.appendChild(ry);
    var st = { drag: null, lastTr: "", lastText: "" };
    var view = createView(el, "xypad", draw, st);
    var API = { kind: "xypad", el: el, view: view };

    function tOf(l) { return l.ready ? l.norm(l.value) : 0.5; }
    function fmtL(l) { return l.ready ? fmtValue(l.value, l.unit) : "..."; }
    function sync() {
      if (disposed) return;
      var tx = tOf(lx), ty = tOf(ly), px = tx * view.w, py = (1 - ty) * view.h;
      var tr = "translate(" + (Math.round(px * 100) / 100) + "px," + (Math.round(py * 100) / 100) + "px)";
      if (tr !== st.lastTr) { thumb.style.transform = tr; st.lastTr = tr; }
      var nm1 = (lx.name || xName), nm2 = (ly.name || yName);
      if (opts.xlabel) nm1 = opts.xlabel; if (opts.ylabel) nm2 = opts.ylabel;
      rx.textContent = nm1 + " " + fmtL(lx); ry.textContent = nm2 + " " + fmtL(ly);
      var txt = nm1 + " " + fmtL(lx) + ", " + nm2 + " " + fmtL(ly);
      if (txt !== st.lastText) {
        st.lastText = txt;
        thumb.setAttribute("aria-valuetext", txt);
        thumb.setAttribute("aria-valuemin", String(lx.min)); thumb.setAttribute("aria-valuemax", String(lx.max));
        thumb.setAttribute("aria-valuenow", String(Math.round(lx.value * 1e6) / 1e6));
      }
      view.invalidate();
    }
    function draw(ctx, v) {
      var th = v.theme, ld = lwDev(v), i, g;
      ctx.fillStyle = th.inset; ctx.fillRect(0, 0, v.w, v.h);
      for (i = 1; i < gridN; i++) {
        g = (i / gridN);
        var major = (gridN % 2 === 0 && i === gridN / 2);
        vline(ctx, v, g * v.w, 0, v.h, major ? th.rule : th.grid, ld);
        hline(ctx, v, g * v.h, 0, v.w, major ? th.rule : th.grid, ld);
      }
      /* default position tick */
      if (lx.ready && ly.ready) {
        var dx = lx.norm(lx.def) * v.w, dy = (1 - ly.norm(ly.def)) * v.h, tk = Math.max(3, th.nodePx * 0.35);
        hline(ctx, v, dy, dx - tk, dx + tk, th.axis, ld); vline(ctx, v, dx, dy - tk, dy + tk, th.axis, ld);
        /* modulated position (hollow square in the first mod colour) */
        if (typeof lx.modulated === "number" || typeof ly.modulated === "number") {
          var mx = (typeof lx.modulated === "number" ? lx.norm(lx.modulated) : lx.norm(lx.value)) * v.w, my = (1 - (typeof ly.modulated === "number" ? ly.norm(ly.modulated) : ly.norm(ly.value))) * v.h;
          frameRect(ctx, v, mx - 3, my - 3, mx + 3, my + 3, th.m1, ld);
        }
      }
      var cx = tOf(lx) * v.w, cy = (1 - tOf(ly)) * v.h;
      ctx.globalAlpha = 0.85;
      vline(ctx, v, cx, 0, v.h, th.accent, ld);
      hline(ctx, v, cy, 0, v.w, th.accent, ld);
      ctx.globalAlpha = 1;
      frameRect(ctx, v, 0, 0, v.w, v.h, th.rule, ld);
      return false;
    }
    view.onResize = function () { sync(); };

    /* ---- gestures ---- */
    function begin() { lx.begin(); ly.begin(); }
    function end() { lx.end(); ly.end(); }
    function emitChange(phase) {
      var d = { id: elId, x: lx.value, y: ly.value, nx: tOf(lx), ny: tOf(ly), phase: phase };
      APC.emit("xypad:change", d); fireDom(el, "apc-xypad", d);
    }
    function setT(tx, ty) {
      var a = lx.ready ? lx.set(lx.fromNorm(clamp(tx, 0, 1))) : false, b = ly.ready ? ly.set(ly.fromNorm(clamp(ty, 0, 1))) : false;
      if (a || b) { sync(); emitChange("move"); }
    }
    function rectOf() { var r = view.cv.getBoundingClientRect(); return r; }
    function onDown(e) {
      if (disposed || (e.button !== undefined && e.button !== 0)) return;
      if (e.target && e.target.closest && e.target.closest(".apc-viz-xyread")) return;
      if (!lx.ready || !ly.ready) return;
      if (e.altKey) { e.preventDefault(); try { thumb.focus({ preventScroll: true }); } catch (x) { thumb.focus(); } lx.reset(); ly.reset(); sync(); emitChange("reset"); return; }
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (x2) { /* synthetic */ }
      try { thumb.focus({ preventScroll: true }); } catch (x3) { thumb.focus(); }
      var r = rectOf();
      st.drag = { pid: e.pointerId, fine: !!e.shiftKey, cx: e.clientX, cy: e.clientY, tx: tOf(lx), ty: tOf(ly), w: r.width || 1, h: r.height || 1, left: r.left, top: r.top };
      thumb.classList.add("is-drag");
      begin();
      emitChange("begin");
      if (!st.drag.fine) setT((e.clientX - r.left) / st.drag.w, 1 - (e.clientY - r.top) / st.drag.h);
    }
    function onMove(e) {
      var d = st.drag;
      if (!d || e.pointerId !== d.pid || disposed) return;
      if (d.fine) setT(d.tx + (e.clientX - d.cx) / d.w * 0.1, d.ty - (e.clientY - d.cy) / d.h * 0.1);
      else setT((e.clientX - d.left) / d.w, 1 - (e.clientY - d.top) / d.h);
    }
    function onUp(e) {
      var d = st.drag;
      if (!d || (e.pointerId !== undefined && e.pointerId !== d.pid)) return;
      st.drag = null;
      try { el.releasePointerCapture(d.pid); } catch (x) { /* ignore */ }
      thumb.classList.remove("is-drag");
      end();
      emitChange("end");
    }
    on(el, "pointerdown", onDown);
    on(el, "pointermove", onMove);
    on(el, "pointerup", onUp);
    on(el, "pointercancel", onUp);
    on(el, "lostpointercapture", onUp);
    on(el, "dblclick", function (e) {
      if (disposed || !lx.ready || !ly.ready) return;
      if (APC.prefs && APC.prefs.get && APC.prefs.get("double_click") === "value_entry") return;
      lx.reset(); ly.reset(); sync(); emitChange("reset");
    });
    on(el, "contextmenu", function (e) { e.preventDefault(); });
    on(thumb, "keydown", function (e) {
      if (disposed || !lx.ready || !ly.ready) return;
      var k = e.key, step = e.shiftKey ? 0.001 : 0.01, dx = 0, dy = 0;
      if (k === "ArrowRight") dx = 1; else if (k === "ArrowLeft") dx = -1; else if (k === "ArrowUp") dy = 1; else if (k === "ArrowDown") dy = -1;
      else if (k === "PageUp") { dy = 1; step = 0.1; } else if (k === "PageDown") { dy = -1; step = 0.1; }
      else if (k === "Home") { e.preventDefault(); begin(); lx.set(lx.min); end(); sync(); emitChange("key"); return; }
      else if (k === "End") { e.preventDefault(); begin(); lx.set(lx.max); end(); sync(); emitChange("key"); return; }
      else if (k === "Delete" || k === "Backspace") { e.preventDefault(); lx.reset(); ly.reset(); sync(); emitChange("reset"); return; }
      else return;
      e.preventDefault();
      begin();
      var cx0 = lx.value, cy0 = ly.value;
      if (dx) { lx.set(lx.fromNorm(lx.norm(lx.value) + dx * step)); if (lx.value === cx0 && lx.step) lx.set(cx0 + dx * lx.step); }
      if (dy) { ly.set(ly.fromNorm(ly.norm(ly.value) + dy * step)); if (ly.value === cy0 && ly.step) ly.set(cy0 + dy * ly.step); }
      end();
      sync(); emitChange("key");
    });

    API.getValue = function () { return { x: lx.value, y: ly.value, nx: tOf(lx), ny: tOf(ly) }; };
    API.setValue = function (x, y) {
      if (x !== undefined && x !== null) lx.set(x);
      if (y !== undefined && y !== null) ly.set(y);
      sync();
    };
    API.setNormalized = function (nx, ny) { setT(nx, ny); };
    API.getThumb = function () { return thumb; };
    API.redraw = function () { sync(); return view.redraw(); };
    API.geometry = function () { return { w: view.w, h: view.h, thumbX: tOf(lx) * view.w, thumbY: (1 - tOf(ly)) * view.h }; };
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      if (st.drag) { end(); st.drag = null; }
      lx.dispose(); ly.dispose();
      offs.forEach(function (f) { f(); }); offs = [];
      view.dispose();
      [thumb, rx, ry].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      el.__apcViz = null;
    };
    sync();
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     picture
     =========================================================================== */
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
  /* only relative paths and data:image URLs are allowed: the kit never touches the network */
  function checkImageUrl(src) {
    var s = String(src || "").trim();
    if (!s) return { ok: false, reason: "empty" };
    if (/^data:image\//i.test(s)) return { ok: true, url: s };
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s) || /^\/\//.test(s) || /^\\\\/.test(s)) return { ok: false, reason: "network or absolute URL" };
    return { ok: true, url: s };
  }
  function drawArt(ctx, v, th, seed, fit) {
    var AW = 1600, AH = 900, w = v.w, hh = v.h, sx, sy, ox, oy;
    if (fit === "fill") { sx = w / AW; sy = hh / AH; ox = 0; oy = 0; }
    else {
      var s = fit === "cover" ? Math.max(w / AW, hh / AH) : Math.min(w / AW, hh / AH);
      sx = sy = s; ox = (w - AW * s) / 2; oy = (hh - AH * s) / 2;
    }
    var rnd = mulberry(seed || 1), i, k;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, hh); ctx.clip();
    ctx.translate(ox, oy); ctx.scale(sx, sy);
    ctx.fillStyle = th.plate2; ctx.fillRect(0, 0, AW, AH);
    /* horizon hairline bands */
    ctx.fillStyle = th.rule2;
    for (i = 0; i < 5; i++) ctx.fillRect(0, 90 + i * 46, AW, 2);
    /* sun */
    var sunX = 760 + rnd() * 560, sunY = 300 + rnd() * 90;
    ctx.fillStyle = th.accent; ctx.beginPath(); ctx.arc(sunX, sunY, 150, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.55; ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sunX, sunY, 215, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    /* three ridges, flat colours */
    var ridges = [{ base: 560, amp: 70, col: th.rule, a: 1 }, { base: 640, amp: 95, col: th.ink2, a: 0.55 }, { base: 740, amp: 70, col: th.inset, a: 1 }], rg, x, y;
    for (k = 0; k < ridges.length; k++) {
      rg = ridges[k];
      ctx.globalAlpha = rg.a; ctx.fillStyle = rg.col;
      ctx.beginPath(); ctx.moveTo(0, AH);
      y = rg.base;
      for (x = 0; x <= AW + 100; x += 100) { y = rg.base - rnd() * rg.amp; ctx.lineTo(x, y); }
      ctx.lineTo(AW, AH); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    /* water: horizontal hairlines */
    ctx.fillStyle = th.ink2; ctx.globalAlpha = 0.45;
    for (i = 0; i < 9; i++) { var wx = 100 + rnd() * 1000; ctx.fillRect(wx, 770 + i * 14, 140 + rnd() * 340, 2); }
    ctx.globalAlpha = 1;
    /* a few square "stars" */
    ctx.fillStyle = th.axis;
    for (i = 0; i < 12; i++) ctx.fillRect(40 + rnd() * 1500, 20 + rnd() * 90, 3, 3);
    ctx.restore();
  }
  function createPicture(el, opts) {
    var label0 = el.getAttribute("aria-label") || "";
    var kindLabel = prepareHost(el, "picture", opts);
    var disposed = false, subs = [], view = null, img = null, errEl = null, overlayApi = null;
    var alt = opts.alt, decorative = false;
    if (alt === undefined || alt === null) {
      alt = label0 || opts.label || "";
      if (!alt) {
        /* alt text is mandatory: warn visibly. data-alt="" (explicitly empty) marks purely decorative art. */
        if (APC.toast && APC.toast.warn) APC.toast.warn("A picture needs alternative text: add data-alt=\"...\" (or data-alt=\"\" for purely decorative art).", 6000);
        alt = "Image";
      }
    } else if (String(alt).trim() === "") { decorative = true; alt = ""; }
    var src = opts.src || "";
    var fit = pick(opts.fit, ["contain", "cover", "fill"], src ? "contain" : "cover");
    var seed = Math.round(num(opts.seed, 1));
    if (decorative) { el.setAttribute("role", "presentation"); el.removeAttribute("aria-label"); }
    else { el.setAttribute("role", "img"); el.setAttribute("aria-label", alt); }
    var API = { kind: "picture", el: el };
    function showError(msg) {
      if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl);
      errEl = h("div", { class: "apc-viz-error", role: "alert", text: msg });
      el.appendChild(errEl);
      el.classList.add("is-error");
      reportError(msg, src, "apc-viz:picture");
    }
    function clearError() { if (errEl && errEl.parentNode) errEl.parentNode.removeChild(errEl); errEl = null; el.classList.remove("is-error"); }
    API.setSrc = function (s) {
      src = s || "";
      clearError();
      if (img && img.parentNode) img.parentNode.removeChild(img);
      img = null;
      if (!src) { if (!view) view = createView(el, "picture", drawPlaceholder, {}); else view.invalidate(); el.classList.remove("has-image"); return true; }
      var chk = checkImageUrl(src);
      if (!chk.ok) {
        if (view) { view.dispose(); view = null; }
        showError("Picture blocked: only relative paths and data:image URLs are allowed, never network URLs (" + String(src).slice(0, 48) + ")");
        return false;
      }
      if (view) { view.dispose(); view = null; }
      img = h("img", { class: "apc-viz-img", alt: "", draggable: "false" });     /* the host carries the accessible name */
      img.setAttribute("aria-hidden", "true");
      img.style.objectFit = fit;
      img.addEventListener("error", function () { if (!disposed) { showError("Picture could not be loaded: " + String(src).slice(0, 60)); } });
      img.addEventListener("load", function () { if (!disposed) { el.classList.add("has-image"); } });
      img.src = chk.url;
      el.insertBefore(img, el.firstChild);
      return true;
    };
    API.setFit = function (f) { fit = pick(f, ["contain", "cover", "fill"], fit); if (img) img.style.objectFit = fit; if (view) view.invalidate(); };
    API.getState = function () { return { src: src, fit: fit, error: !!errEl, placeholder: !!view, alt: alt }; };
    API.redraw = function () { return view ? view.redraw() : false; };
    API.getOverlay = function () { return overlayApi; };
    API.dispose = function () {
      if (disposed) return;
      disposed = true;
      if (overlayApi) overlayApi.dispose();
      if (view) view.dispose();
      subs.forEach(function (f) { f(); });
      APC.dom.clear(el);
      el.__apcViz = null;
    };
    function drawPlaceholder(ctx, v) {
      var th = v.theme;
      ctx.fillStyle = th.inset; ctx.fillRect(0, 0, v.w, v.h);
      drawArt(ctx, v, th, seed, fit);
      var ld = lwDev(v);
      frameRect(ctx, v, 0, 0, v.w, v.h, th.rule, ld);
      setFont(ctx, v, th.microPx);
      ctx.fillStyle = th.axis; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText("TEST IMAGE", Math.round(th.microPx * 0.8), v.h - Math.round(th.microPx * 0.7));
      return false;
    }
    API.setSrc(src);
    if (pick(opts.overlay, ["spectrum", "none"], "none") === "spectrum") {
      var ov = h("div", { class: "apc-viz-overlay-host" });
      el.appendChild(ov);
      var oo = {};
      for (var key in opts) if (Object.prototype.hasOwnProperty.call(opts, key)) oo[key] = opts[key];
      oo.style = opts.overlayStyle || "fill"; oo.viz = opts.viz || opts.overlayViz || ""; oo.peakHold = "false";
      overlayApi = createSpectrum(ov, oo, { overlay: true });
    }
    el.__apcViz = API;
    return API;
  }

  /* ===========================================================================
     registration
     =========================================================================== */
  APC.register("graph", function (el, o) { return createGraph(el, o, "graph"); });
  APC.register("envelope", function (el, o) { return createGraph(el, o, "envelope"); });
  APC.register("spectrum", function (el, o) { return createSpectrum(el, o); });
  APC.register("waveform", function (el, o) { return createWaveform(el, o); });
  APC.register("scope", function (el, o) { return createWaveform(el, o, "scope"); });
  APC.register("meter", function (el, o) { return createMeter(el, o); });
  APC.register("stepseq", function (el, o) { return createStepseq(el, o); });
  APC.register("xypad", function (el, o) { return createXYPad(el, o); });
  APC.register("picture", function (el, o) { return createPicture(el, o); });

  /* instance lookup: APC.viz.get(element) -> the JS API of a mounted viz element (or null) */
  viz.get = function (el) { return (el && el.__apcViz) || null; };
  viz.names = ["graph", "envelope", "spectrum", "waveform", "scope", "meter", "stepseq", "xypad", "picture"];
})();
