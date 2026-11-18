/* =============================================================================
   tests/harness-a.js — helpers for tests/kit-a.html (kit-A: controls, context,
   help, chrome). Classic script. Provides:
     - H.mock    deterministic in-page bridge (spy) registered as APC.bridge BEFORE
                 any component initialises (independent of apc-bridge.js/apc-mock.js)
     - H.test()  tiny async runner; H.finish() writes window.__APC_TEST__ and
                 <pre id="apc-test-result"> per CONTRACT.md "Testing contract"
     - synthetic pointer/key/wheel helpers
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC;
  var H = (window.H = {});

  /* ---- bridge mock -------------------------------------------------------------- */
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  var handlers = {};
  var M = (H.mock = { calls: [], fail: {}, state: null });

  function P(id, name, unit, min, max, def, extra) {
    var p = { id: id, name: name, unit: unit, min: min, max: max, "default": def, value: def,
      help: { what: name + " does a thing.", effect: "It changes the sound.", how: "Drag it." }, modulation: [], midiCc: null };
    for (var k in (extra || {})) p[k] = extra[k];
    return p;
  }
  function freshParams() {
    return [
      P("cutoff_hz", "Cutoff", "Hz", 20, 20000, 1000, { value: 850, skew: 0.3,
        modulation: [{ src: "lfo1", amount: 35, polarity: "bipolar", min: 200, max: 4000, bypass: false },
                     { src: "env1", amount: -20, polarity: "unipolar", min: 20, max: 20000, bypass: false }], midiCc: 74 }),
      P("gain_db", "Gain", "dB", -24, 12, 0),
      P("mix_pct", "Mix", "%", 0, 100, 100, { value: 40 }),
      P("time_s", "Time", "s", 0.001, 5, 0.1),
      P("steps_n", "Steps", "", 0, 10, 5, { step: 1 }),
      P("wave", "Waveform", "", 0, 3, "Saw", { choices: ["Sine", "Saw", "Square", "Triangle"], value: "Saw", step: 1 }),
      P("bypass", "Bypass", "", 0, 1, false, { value: false }),
      P("plain", "Plain", "", 0, 1, 0.5, { value: 0.5, modulation: [] })
    ];
  }
  M.reset = function () {
    M.calls.length = 0; M.fail = {};
    M.state = {
      params: freshParams(),
      info: { product: "Test Synth", manufacturer: "Test Audio", version: "v2.3.4", buildDate: "2026-11-07",
        links: { company: "https://example.test/company", product: "", docs: "https://example.test/docs" },
        features: { themeEnabled: true, helpMode: true } },
      settings: { schema: "apc-settings/1.0", ui: { theme: "night", scale: 1, tooltips: true, tooltip_delay_ms: 400, double_click: "reset", wheel_target: "control" } },
      license: { state: "DEMO", mode: "none" },
      update: { state: "Idle", current: "2.3.4" },
      presets: { current: { id: "p1", name: "Init", dirty: false, readOnly: false } },
      scale: 1, echo: false
    };
  };
  function find(id) { for (var i = 0; i < M.state.params.length; i++) if (M.state.params[i].id === id) return M.state.params[i]; return null; }
  M.find = find;
  M.names = function () { return M.calls.map(function (c) { return c.name; }); };
  M.of = function (name) { return M.calls.filter(function (c) { return c.name === name; }); };
  M.emit = function (name, data) {
    var l = (handlers[name] || []).slice();
    for (var i = 0; i < l.length; i++) l[i](clone(data));
  };
  var F = {
    "apc.info": function () { return clone(M.state.info); },
    "apc.params.get": function (a) { var p = find(a.id); return p ? clone(p) : { error: "unknown_param", message: "Unknown parameter: " + a.id }; },
    "apc.params.list": function () { return clone(M.state.params); },
    "apc.param.set": function (a) { var p = find(a.id); p.value = a.value; if (M.state.echo) setTimeout(function () { M.emit("param", { id: a.id, value: a.value }); }, 0); return { value: a.value }; },
    "apc.param.begin": function () { return { ok: true }; },
    "apc.param.end": function () { return { ok: true }; },
    "apc.param.reset": function (a) { var p = find(a.id); p.value = p["default"]; return { value: p.value }; },
    "apc.mod.set": function (a) {
      var p = find(a.id), i;
      for (i = 0; i < p.modulation.length; i++) if (p.modulation[i].src === a.route.src) { p.modulation[i] = clone(a.route); return { modulation: clone(p.modulation) }; }
      p.modulation.push(clone(a.route)); return { modulation: clone(p.modulation) };
    },
    "apc.mod.remove": function (a) { var p = find(a.id); p.modulation = p.modulation.filter(function (r) { return r.src !== a.src; }); return { modulation: clone(p.modulation) }; },
    "apc.mod.clear": function (a) { find(a.id).modulation = []; return { modulation: [] }; },
    "apc.midi.learn": function (a) { var p = find(a.id); p.midiCc = 21; return { id: a.id, cc: 21 }; },
    "apc.midi.unlearn": function (a) { find(a.id).midiCc = null; return { id: a.id, cc: null }; },
    "apc.settings.get": function () { return clone(M.state.settings); },
    "apc.settings.set": function (a) { var u = a.patch && a.patch.ui, k; for (k in (u || {})) M.state.settings.ui[k] = u[k]; return clone(M.state.settings); },
    "apc.license.status": function () { return clone(M.state.license); },
    "apc.update.state": function () { return clone(M.state.update); },
    "apc.presets.state": function () { return clone(M.state.presets); },
    "apc.openUrl": function () { return { ok: true }; },
    "apc.ui.setScale": function (a) { M.state.scale = a.scale; return { scale: a.scale }; },
    "apc.ui.getPrefs": function () { return { scale: M.state.scale }; }
  };
  M.call = function (name, args) {
    M.calls.push({ name: name, args: clone(args) });
    return new Promise(function (resolve, reject) {
      if (M.fail[name] || (args && args.id && M.fail[name + ":" + args.id])) { reject(new Error("simulated failure of " + name)); return; }
      var fn = F[name];
      if (!fn) { resolve({ error: "unknown_function", message: "Unknown bridge function: " + name }); return; }
      resolve(clone(fn(args || {})));
    });
  };
  M.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return function () { var l = handlers[name], i = l.indexOf(fn); if (i > -1) l.splice(i, 1); }; };
  M.reset();
  APC.bridge = { call: M.call, on: M.on };

  /* ---- assertions / runner ---------------------------------------------------------- */
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
  H.run = function () {
    var i = 0, only = (/[?&]only=([^&]+)/.exec(location.search) || [])[1];     /* tests/kit-a.html?only=gripper */
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

  /* ---- fixture ---------------------------------------------------------------------------- */
  var handlesMade = [];
  H.plate = function () { return document.getElementById("plate"); };
  var slot = 0;
  /* mk("knob","cutoff_hz",{label:"CUTOFF"}) -> mounted element, descriptor loaded */
  H.mk = function (kind, param, attrs, box) {
    slot++;
    var el = document.createElement("div");
    el.className = "apc-cell";
    el.setAttribute("data-apc", kind);
    el.setAttribute("data-param", param);
    var k;
    for (k in (attrs || {})) el.setAttribute(k, attrs[k]);
    var b = box || { x: 2 + ((slot * 8) % 40), y: 9, w: 6, h: 8 };
    el.style.left = b.x + "rem"; el.style.top = b.y + "rem"; el.style.width = b.w + "rem"; el.style.height = b.h + "rem";
    H.plate().appendChild(el);
    var m = APC.mount(H.plate());          /* APC.mount scans descendants only: mount from the plate */
    handlesMade.push(m);
    return H.ready(el).then(function () { return el; });
  };
  H.ready = function (el) {
    var n = 0;
    return new Promise(function (resolve) {
      (function poll() { if (!el.hasAttribute("aria-busy") && el.__apcCtl && el.__apcCtl.model || ++n > 50) resolve(); else setTimeout(poll, 0); })();
    });
  };
  H.mount = function (html, host) {
    var d = document.createElement("div");
    d.innerHTML = html;
    var node = d.firstElementChild;
    (host || H.plate()).appendChild(node);
    handlesMade.push(APC.mount(host || H.plate()));
    return node;
  };
  function cleanup() {
    try { if (APC.context) APC.context.close(false); } catch (e) {}
    try { if (APC.help) { APC.help.hideTooltip(); APC.help.mode(false); APC.help.closeManual(false); } } catch (e) {}
    if (APC.controls && APC.controls.closeMenu) APC.controls.closeMenu(false);
    handlesMade.forEach(function (m) { try { m.dispose(); } catch (e) {} });
    handlesMade = [];
    var p = H.plate(); while (p.firstChild) p.removeChild(p.firstChild);
    Array.prototype.forEach.call(document.querySelectorAll(".apc-toast, .apc-menu, .apc-ctx, .apc-manual-overlay"), function (n) { n.parentNode && n.parentNode.removeChild(n); });
    M.reset();
    if (APC.controls) APC.controls.params.drop("*");      /* descriptor cache must not leak between tests */
    if (APC.help) { var o = document.createElement("div"); document.body.appendChild(o); o.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); document.body.removeChild(o); }
    APC.prefs.set({ double_click: "reset", wheel_target: "control", tooltips: true, tooltip_delay_ms: 400 });
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return H.tick();
  }

  /* ---- synthetic input -------------------------------------------------------------------------- */
  function center(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
  H.center = center;
  H.pe = function (t, type, o) {
    o = o || {};
    var c = (o.x === undefined) ? center(t) : { x: o.x, y: (o.y === undefined ? center(t).y : o.y) };
    var ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: o.id || 1, pointerType: o.type || "mouse",
      button: o.button || 0, clientX: c.x, clientY: c.y, screenX: o.sx || 0, screenY: o.sy || 0,
      shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl, metaKey: !!o.meta });
    t.dispatchEvent(ev);
    return ev;
  };
  /* press, move vertically by dy (negative = up) in 3 steps, optionally keep pressed */
  H.drag = function (el, dy, mods, opts) {
    mods = mods || {}; opts = opts || {};
    var c = center(el), i;
    H.pe(el, "pointerdown", { x: c.x, y: c.y, shift: mods.shift, alt: mods.alt, ctrl: mods.ctrl, meta: mods.meta });
    for (i = 1; i <= 3; i++) H.pe(el, "pointermove", { x: c.x + (opts.dx || 0) * i / 3, y: c.y + dy * i / 3, shift: mods.moveShift, alt: mods.moveAlt, ctrl: mods.moveCtrl });
    if (!opts.hold) H.pe(el, "pointerup", { x: c.x + (opts.dx || 0), y: c.y + dy });
    return c;
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
  H.click = function (t, o) {
    o = o || {};
    t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: !!o.alt, shiftKey: !!o.shift }));
  };
  H.dbl = function (t) { t.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })); };
  H.ctx = function (t, o) {
    var c = center(t);
    var ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: (o && o.x) || c.x, clientY: (o && o.y) || c.y });
    t.dispatchEvent(ev);
    return ev;
  };
  H.callsSince = function (n) { return M.calls.slice(n); };
})();
