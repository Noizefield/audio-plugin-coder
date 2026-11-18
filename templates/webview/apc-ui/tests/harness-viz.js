/* =============================================================================
   tests/harness-viz.js - helpers for tests/kit-viz.html (visualisation elements). Classic script.
   Provides, before any component initialises:
     - H.mock    deterministic in-page bridge spy registered as APC.bridge: call log, params, event emit,
                 _dispatch (so APC.mockViz can push), listener counting (dispose checks)
     - H.test()/H.run(): tiny async runner; writes window.__APC_TEST__ and <pre id="apc-test-result">
     - synthetic pointer / key / wheel helpers, canvas pixel helpers
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC;
  var H = (window.H = {});

  /* ---- bridge spy ---------------------------------------------------------------------- */
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  var handlers = {};
  var M = (H.mock = { calls: [], fail: {}, state: null });
  function P(id, name, unit, min, max, def, extra) {
    var p = { id: id, name: name, unit: unit, min: min, max: max, "default": def, value: def,
      help: { what: name, effect: "", how: "" }, modulation: [], midiCc: null };
    for (var k in (extra || {})) p[k] = extra[k];
    return p;
  }
  function freshParams() {
    return [
      P("eq_f1", "Freq 1", "Hz", 20, 20000, 1000, { skew: 0.3 }),
      P("eq_g1", "Gain 1", "dB", -18, 18, 0, { modulation: [{ src: "lfo1", amount: 40, polarity: "bipolar", bypass: false }] }),
      P("eq_q1", "Q 1", "", 0.1, 18, 0.71, { skew: 0.5 }),
      P("eq_f2", "Freq 2", "Hz", 20, 20000, 4000, { skew: 0.3 }),
      P("eq_g2", "Gain 2", "dB", -18, 18, 3),
      P("env_a", "Attack", "s", 0.001, 2, 0.1, { skew: 0.3 }),
      P("env_d", "Decay", "s", 0.001, 2, 0.4, { skew: 0.3 }),
      P("env_s", "Sustain", "", 0, 1, 0.6),
      P("env_r", "Release", "s", 0.005, 3, 0.6, { skew: 0.3 }),
      P("xp_x", "Cutoff", "Hz", 20, 20000, 1000, { skew: 0.3 }),
      P("xp_y", "Resonance", "%", 0, 100, 20),
      P("seq_steps", "Steps", "", 0, 1, 0, { type: "steps", value: [[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], "default": null }),
      P("plain", "Plain", "", 0, 1, 0.5),
      P("wave", "Waveform", "", 0, 3, "Saw", { choices: ["Sine", "Saw", "Square", "Triangle"], value: "Saw" })
    ];
  }
  M.reset = function () {
    M.calls.length = 0; M.fail = {};
    M.state = { params: freshParams() };
  };
  function find(id) { for (var i = 0; i < M.state.params.length; i++) if (M.state.params[i].id === id) return M.state.params[i]; return null; }
  M.find = find;
  M.of = function (name, id) { return M.calls.filter(function (c) { return c.name === name && (!id || (c.args && c.args.id === id)); }); };
  M.names = function (id) { return M.calls.filter(function (c) { return !id || (c.args && c.args.id === id); }).map(function (c) { return c.name.replace("apc.param.", "").replace("apc.params.", "p."); }); };
  M.emit = function (name, data) {
    var l = (handlers[name] || []).slice();
    for (var i = 0; i < l.length; i++) l[i](clone(data));
  };
  M.listeners = function () { var n = 0, k; for (k in handlers) n += handlers[k].length; return n; };
  var F = {
    "apc.params.get": function (a) { var p = find(a.id); return p ? clone(p) : { error: "unknown_param", message: "Unknown parameter: " + a.id }; },
    "apc.param.set": function (a) { var p = find(a.id); if (p) p.value = a.value; return { value: a.value }; },
    "apc.param.begin": function () { return { ok: true }; },
    "apc.param.end": function () { return { ok: true }; },
    "apc.param.reset": function (a) { var p = find(a.id); p.value = p["default"]; return { value: p.value }; }
  };
  M.call = function (name, args) {
    M.calls.push({ name: name, args: clone(args) });
    return new Promise(function (resolve, reject) {
      if (M.fail[name]) { reject(new Error("simulated failure of " + name)); return; }
      var fn = F[name];
      if (!fn) { resolve({ error: "unknown_function", message: "Unknown bridge function: " + name }); return; }
      resolve(clone(fn(args || {})));
    });
  };
  M.on = function (name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    return function () { var l = handlers[name], i = l ? l.indexOf(fn) : -1; if (i > -1) l.splice(i, 1); };
  };
  M.reset();
  APC.bridge = { call: M.call, on: M.on, _dispatch: function (name, payload) { M.emit(name, payload); } };
  /* _dispatch must NOT clone typed arrays: pass through */
  APC.bridge._dispatch = function (name, payload) {
    var l = (handlers[name] || []).slice();
    for (var i = 0; i < l.length; i++) l[i](payload);
  };

  /* ---- assertions / runner ---------------------------------------------------------------- */
  var result = { pass: 0, fail: 0, failures: [], tests: [] };
  var cur = null;
  H.assert = function (cond, msg) {
    if (cond) { result.pass++; return true; }
    result.fail++; result.failures.push((cur ? cur + ": " : "") + msg);
    return false;
  };
  function show(v) { try { return JSON.stringify(v); } catch (e) { return v && v.nodeType ? "<" + String(v.nodeName).toLowerCase() + ">" : String(v); } }
  H.eq = function (a, b, msg) { return H.assert(a === b, msg + " (expected " + show(b) + ", got " + show(a) + ")"); };
  H.near = function (a, b, tol, msg) { return H.assert(typeof a === "number" && Math.abs(a - b) <= tol, msg + " (expected ~" + b + ", got " + a + ")"); };
  var queue = [];
  H.test = function (name, fn) { queue.push({ name: name, fn: fn }); };
  H.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  H.tick = function () { return H.sleep(0).then(function () { return H.sleep(0); }); };
  H.until = function (fn, ms) {
    var waited = 0;
    return new Promise(function (resolve) {
      (function poll() { var v = false; try { v = fn(); } catch (e) { v = false; } if (v || waited >= (ms || 1000)) resolve(!!v); else { waited += 5; setTimeout(poll, 5); } })();
    });
  };
  H.run = function () {
    var i = 0, only = (/[?&]only=([^&]+)/.exec(location.search) || [])[1];
    if (only) queue = queue.filter(function (t) { return t.name.toLowerCase().indexOf(decodeURIComponent(only).toLowerCase()) >= 0; });
    function next() {
      if (i >= queue.length) return finish();
      var t = queue[i++]; cur = t.name;
      var before = result.fail;
      var done = Promise.resolve().then(t.fn).then(null, function (e) { H.assert(false, "threw " + (e && e.stack || e)); });
      return done.then(function () { return cleanup(); }).then(function () {
        result.tests.push({ name: t.name, ok: result.fail === before });
        return next();
      });
    }
    return next();
  };
  function finish() {
    window.__APC_TEST__ = { pass: result.pass, fail: result.fail, failures: result.failures, tests: result.tests };
    var pre = document.getElementById("apc-test-result");
    if (!pre) { pre = document.createElement("pre"); pre.id = "apc-test-result"; document.body.appendChild(pre); }
    pre.textContent = JSON.stringify(window.__APC_TEST__);
    document.title = (result.fail ? "FAIL " : "PASS ") + result.pass + "/" + (result.pass + result.fail);
  }

  /* ---- fixture --------------------------------------------------------------------------- */
  var mounts = [];
  H.plate = function () { return document.getElementById("plate"); };
  var slot = 0;
  /* mk("graph", {attrs...}, {x,y,w,h}) -> mounted element (waits for descriptors) */
  H.mk = function (kind, attrs, box, host) {
    slot++;
    var el = document.createElement("div");
    el.className = "apc-cell";
    el.setAttribute("data-apc", kind);
    var k;
    for (k in (attrs || {})) el.setAttribute(k, attrs[k]);
    var b = box || { x: 1 + ((slot * 11) % 36), y: 2, w: 10, h: 6 };
    el.style.left = b.x + "rem"; el.style.top = b.y + "rem"; el.style.width = b.w + "rem"; el.style.height = b.h + "rem";
    var parent = host || H.plate();
    parent.appendChild(el);
    mounts.push(APC.mount(parent));
    return H.settled(el).then(function () { return el; });
  };
  H.settled = function (el) {
    return H.until(function () { return !el.hasAttribute("aria-busy"); }, 600).then(function () { return H.tick(); });
  };
  H.flush = function (force) { return APC.viz.flush(force !== false); };
  function cleanup() {
    mounts.forEach(function (m) { try { m.dispose(); } catch (e) { /* ignore */ } });
    mounts = [];
    var p = H.plate(); while (p.firstChild) p.removeChild(p.firstChild);
    Array.prototype.forEach.call(document.querySelectorAll(".apc-toast"), function (n) { n.parentNode && n.parentNode.removeChild(n); });
    document.documentElement.setAttribute("data-theme", "night");
    APC.viz.setReducedMotion(null);
    if (APC.mockViz) { APC.mockViz.stop(); APC.mockViz.seed(1); }
    M.reset();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return H.tick();
  }

  /* ---- synthetic input -------------------------------------------------------------------- */
  function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  H.center = center;
  H.pe = function (t, type, o) {
    o = o || {};
    var c = center(t);
    var ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: o.id || 1, pointerType: o.type || "mouse",
      button: o.button || 0, clientX: o.x === undefined ? c.x : o.x, clientY: o.y === undefined ? c.y : o.y,
      shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl, metaKey: !!o.meta });
    t.dispatchEvent(ev);
    return ev;
  };
  /* press on `el` at (x,y), move through the points, release */
  H.dragPath = function (el, pts, mods) {
    mods = mods || {};
    H.pe(el, "pointerdown", { x: pts[0][0], y: pts[0][1], shift: mods.shift, alt: mods.alt });
    for (var i = 1; i < pts.length; i++) H.pe(el, "pointermove", { x: pts[i][0], y: pts[i][1] });
    if (!mods.hold) H.pe(el, "pointerup", { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] });
  };
  H.key = function (t, key, o) {
    o = o || {};
    var ev = new KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true, shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl, metaKey: !!o.meta });
    t.dispatchEvent(ev);
    return ev;
  };
  H.wheel = function (t, dy, o) {
    o = o || {};
    var ev = new WheelEvent("wheel", { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true, shiftKey: !!o.shift });
    t.dispatchEvent(ev);
    return ev;
  };
  H.dbl = function (t) { t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); };

  /* ---- canvas pixels --------------------------------------------------------------------- */
  /* rgba of the device pixel under CSS point (x,y) of the element's canvas */
  H.pixel = function (cv, x, y) {
    var r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    var px = Math.min(cv.width - 1, Math.max(0, Math.floor(x * sx))), py = Math.min(cv.height - 1, Math.max(0, Math.floor(y * sy)));
    var d = cv.getContext("2d").getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
  H.rgb = function (css) {
    var c = document.createElement("canvas"); c.width = c.height = 1;
    var x = c.getContext("2d"); x.fillStyle = "#000"; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
    var d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  };
  H.tok = function (el, name) { return getComputedStyle(el).getPropertyValue(name).trim(); };
  H.same = function (a, b, tol) { tol = tol === undefined ? 6 : tol; return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol; };
  /* is any pixel in the CSS rectangle within `tol` of colour rgb? */
  H.hasColor = function (cv, x0, y0, x1, y1, rgb, tol) {
    var r = cv.getBoundingClientRect(), sx = cv.width / r.width, sy = cv.height / r.height;
    var ax = Math.max(0, Math.floor(x0 * sx)), ay = Math.max(0, Math.floor(y0 * sy));
    var bx = Math.min(cv.width, Math.ceil(x1 * sx)), by = Math.min(cv.height, Math.ceil(y1 * sy));
    if (bx <= ax || by <= ay) return false;
    var d = cv.getContext("2d").getImageData(ax, ay, bx - ax, by - ay).data, i;
    for (i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && H.same([d[i], d[i + 1], d[i + 2]], rgb, tol === undefined ? 8 : tol)) return true;
    return false;
  };
  H.countColor = function (cv, rgb, tol) {
    var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, i, n = 0;
    for (i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && H.same([d[i], d[i + 1], d[i + 2]], rgb, tol === undefined ? 6 : tol)) n++;
    return n;
  };
  H.distinctColors = function (cv) {
    var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data, seen = {}, n = 0, i, k;
    for (i = 0; i < d.length; i += 16) { k = d[i] + "," + d[i + 1] + "," + d[i + 2]; if (!seen[k]) { seen[k] = 1; n++; } }
    return n;
  };
})();
