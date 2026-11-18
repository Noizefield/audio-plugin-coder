/* =============================================================================
   apc-controls.js — APC UI kit controls: knob, slider (h/v), selector, toggle.
   Classic script (ES5-safe, no modules); extends window.APC. Contract: CONTRACT.md,
   standards U-01..U-04, U-12, U-13, U-15 (plans/02-ux-standards/control-interactions.md).
   Load after apc-kit.js + apc-bridge.js. Everything is driven by the
   ParamDescriptor from APC.bridge.call("apc.params.get", {id}).

   Markup:   <div class="apc-cell" data-apc="knob" data-param="cutoff_hz" data-label="CUTOFF"></div>
   Exports:  APC.controls = { Model, call, params, sourceStyle, localize, closeMenu, clipboard }
             APC.prefs    = { get(key), set(patch), reload() }   (ui.* settings cache)
   Bus out:  ctl:drag {id,active}   undo:push {label,id,before,after}   params:changed {id}
   Bus in:   params:changed {id}    settings:changed {ui...}
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__controls) return;
  if (!APC.register || !APC.dom) {
    if (window.console) console.error("apc-controls.js: load apc-kit.js first");
    return;
  }
  APC.__controls = true;
  var h = APC.dom.el;
  var SVGNS = "http://www.w3.org/2000/svg";
  var IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || "") + (navigator.userAgent || ""));

  /* ---- ui.* preference cache (shared shape with apc-help.js / apc-chrome.js) --- */
  function ensurePrefs() {
    if (APC.prefs) return APC.prefs;
    var cache = { theme: "follow-os", scale: 1, tooltips: true, tooltip_delay_ms: 400, wheel_target: "control",
                  double_click: "reset", reset_animation: "glide" };
    var api = {
      get: function (k) { return cache[k]; },
      all: function () { var o = {}, k; for (k in cache) o[k] = cache[k]; return o; },
      set: function (patch) {
        var changed = false, k;
        for (k in (patch || {})) { if (cache[k] !== patch[k]) { cache[k] = patch[k]; changed = true; } }
        if (changed) APC.emit("prefs:changed", api.all());
      },
      reload: function () {
        if (!APC.bridge || !APC.bridge.call) return Promise.resolve(api.all());
        return Promise.resolve(APC.bridge.call("apc.settings.get", {})).then(function (s) {
          if (s && s.ui) api.set(s.ui);
          return api.all();
        }, function (e) {
          APC.emit("error", { message: "Could not read settings: " + ((e && e.message) || e), source: "apc.settings.get" });
          return api.all();
        });
      }
    };
    APC.on("settings:changed", function (s) { if (s && s.ui) api.set(s.ui); else if (s) api.set(s); });
    APC.prefs = api;
    return api;
  }
  var prefs = ensurePrefs();
  var prefsRequested = false;

  /* ---- bridge helper: never fails silently (stone rule 1) ----------------------- */
  function fail(name, e) {
    var m = (e && e.message) ? e.message : String(e);
    APC.emit("error", { message: "Could not complete " + name + ": " + m, detail: String(e), source: name });
  }
  function call(name, args) {
    var p;
    try {
      if (!APC.bridge || !APC.bridge.call) throw new Error("bridge unavailable");
      p = APC.bridge.call(name, args || {});
    } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) {
        if (r.error === "gated") APC.emit("license:gated", { fn: name, result: r });
        else fail(name, r.message || r.error);
      }
      return r;
    }, function (e) { fail(name, e); return undefined; });
  }

  /* ---- descriptor cache ---------------------------------------------------------- */
  var descCache = {}, inflight = {};
  var params = {
    get: function (id, fresh) {
      if (!fresh && descCache[id]) return Promise.resolve(descCache[id]);
      if (!fresh && inflight[id]) return inflight[id];
      var p = call("apc.params.get", { id: id }).then(function (d) {
        delete inflight[id];
        if (d && !d.error) { descCache[id] = d; return d; }
        return null;
      });
      inflight[id] = p;
      return p;
    },
    peek: function (id) { return descCache[id] || null; },
    put: function (id, d) { descCache[id] = d; },
    drop: function (id) { if (id === "*" || id === undefined) { descCache = {}; } else { delete descCache[id]; } }
  };

  /* ---- numeric model of one parameter -------------------------------------------- */
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function r9(x) { return Math.round(x * 1e9) / 1e9; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function stepDigits(step) {
    if (!step || step >= 1) return 0;
    var s = String(step), i = s.indexOf(".");
    return i < 0 ? 0 : Math.min(6, s.length - i - 1);
  }
  var DECIMAL = (function () { try { return (1.5).toLocaleString().indexOf(",") >= 0 ? "," : "."; } catch (e) { return "."; } })();
  function localize(s) { return DECIMAL === "." ? s : String(s).replace(".", DECIMAL); }

  function Model(desc) {
    var d = this.desc = desc || {};
    this.choices = (d.choices && d.choices.length) ? d.choices.slice() : null;
    this.isChoice = !!this.choices;
    this.unit = d.unit || "";
    this.isBool = !this.isChoice && (typeof d.value === "boolean" || typeof d["default"] === "boolean");
    if (this.isChoice) { this.min = 0; this.max = this.choices.length - 1; this.step = 1; this.skew = 1; }
    else if (this.isBool) { this.min = 0; this.max = 1; this.step = 1; this.skew = 1; }
    else {
      this.min = num(d.min, 0); this.max = num(d.max, 1);
      this.step = (typeof d.step === "number" && d.step > 0) ? d.step : 0;
      this.skew = (typeof d.skew === "number" && d.skew > 0) ? d.skew : 1;
    }
    this.digits = (typeof d.digits === "number") ? d.digits : (this.step ? stepDigits(this.step) : undefined);
    this.def = this.fromWire(d["default"]);
  }
  Model.prototype.fromWire = function (w) {
    var i, n;
    if (typeof w === "boolean") return w ? 1 : 0;
    if (typeof w === "string") {
      if (this.isChoice) {
        i = this.choices.indexOf(w);
        if (i < 0) { for (i = 0; i < this.choices.length; i++) if (String(this.choices[i]).toLowerCase() === w.toLowerCase()) break; }
        return (i >= 0 && i < this.choices.length) ? i : 0;
      }
      n = parseFloat(w);
      return isFinite(n) ? n : this.min;
    }
    if (typeof w === "number" && isFinite(w)) return this.isChoice ? clamp(Math.round(w), 0, this.max) : w;
    return this.min;
  };
  Model.prototype.toWire = function (v) {
    if (this.isChoice) return this.choices[clamp(Math.round(v), 0, this.max)];
    if (this.isBool) return v >= 0.5;
    return v;
  };
  Model.prototype.range = function () { return this.max - this.min; };
  Model.prototype.toNorm = function (v) {
    var r = this.range();
    if (!(r > 0)) return 0;
    var p = clamp((v - this.min) / r, 0, 1);
    return this.skew === 1 ? p : Math.pow(p, this.skew);
  };
  Model.prototype.fromNorm = function (t) {
    t = clamp(t, 0, 1);
    var p = this.skew === 1 ? t : Math.pow(t, 1 / this.skew);
    return this.min + this.range() * p;
  };
  Model.prototype.snap = function (v) {
    if (this.step) v = this.min + Math.round((v - this.min) / this.step) * this.step;
    return r9(clamp(v, this.min, this.max));
  };
  Model.prototype.stepsCount = function () { return this.step ? Math.round(this.range() / this.step) : 0; };
  Model.prototype.format = function (v) {
    if (this.isChoice) return String(this.choices[clamp(Math.round(v), 0, this.max)]);
    if (this.isBool) return v >= 0.5 ? "On" : "Off";
    return localize(APC.format.value(v, this.unit, this.digits));
  };
  Model.prototype.rangeText = function () {
    if (this.isChoice) return String(this.choices[0]) + " – " + String(this.choices[this.max]);
    return this.format(this.min) + " – " + this.format(this.max);
  };
  /* Returns { ok, value?, clamped?, reason? }. */
  Model.prototype.parse = function (text) {
    var s = String(text === null || text === undefined ? "" : text).trim(), i, n, lc, hit = [];
    if (!s) return { ok: false, reason: "Type a value" };
    if (this.isChoice || this.isBool) {
      var list = this.isChoice ? this.choices : ["Off", "On"];
      lc = s.toLowerCase();
      for (i = 0; i < list.length; i++) if (String(list[i]).toLowerCase() === lc) return { ok: true, value: i };
      for (i = 0; i < list.length; i++) if (String(list[i]).toLowerCase().indexOf(lc) === 0) hit.push(i);
      if (hit.length === 1) return { ok: true, value: hit[0] };
      return { ok: false, reason: hit.length ? "Be more specific" : "Not one of the choices" };
    }
    n = APC.format.parse(s, this.unit);
    if (n === null || !isFinite(n)) return { ok: false, reason: "Not a number" };
    /* seconds shown as "250 ms": a bare number above the range is read as ms */
    if (this.unit === "s" && /^[-+]?[\d.,]+$/.test(s) && n > this.max && n / 1000 <= this.max) n = n / 1000;
    var v = this.snap(n);
    return { ok: true, value: v, clamped: n < this.min - 1e-9 || n > this.max + 1e-9 };
  };

  /* ---- modulation source palette (colour-blind-safe via --apc-mod-1..8 + dash) ---- */
  var SRC_ALIASES = { lfo: "lfo1", env: "env1", vel: "velocity", key: "keytrack", keytr: "keytrack", kt: "keytrack",
    mw: "modwheel", wheel: "modwheel", at: "aftertouch", pressure: "aftertouch", rnd: "random", expr: "expression", cc11: "expression" };
  var SRC_ORDER = ["lfo1", "lfo2", "env1", "env2", "macro", "velocity", "keytrack", "modwheel", "aftertouch", "random", "breath", "expression"];
  function srcKey(name) {
    var s = String(name === null || name === undefined ? "" : name).toLowerCase().replace(/[\s_\-]+/g, "");
    return SRC_ALIASES[s] || s;
  }
  function sourceStyle(name) {
    var k = srcKey(name), i = SRC_ORDER.indexOf(k), hsh = 0, j;
    if (i < 0) {
      for (j = 0; j < k.length; j++) hsh = (hsh * 31 + k.charCodeAt(j)) % 9973;
      i = hsh % 24;
    }
    return { n: (i % 8) + 1, dash: Math.floor(i / 8) % 3, key: k };
  }
  var DASHES = ["", "5 3", "1.5 2.5"];
  var SRC_NAMES = { lfo1: "LFO 1", lfo2: "LFO 2", env1: "Env 1", env2: "Env 2", macro: "Macro", velocity: "Velocity",
    keytrack: "Keytrack", modwheel: "Mod Wheel", aftertouch: "Aftertouch", random: "Random", breath: "Breath", expression: "Expression" };
  function sourceName(r) {
    if (r && r.name) return String(r.name);
    var src = (r && r.src !== undefined) ? r.src : r, k = srcKey(src);
    return SRC_NAMES[k] || String(src);
  }
  function isBi(r) { return !!(r && /^bi/i.test(String(r.polarity || ""))); }
  function routeSpan(route, model, baseNorm) {
    var a = (num(route.amount, 0)) / 100, lo, hi, nlo, nhi;
    if (isBi(route)) { lo = baseNorm - Math.abs(a); hi = baseNorm + Math.abs(a); }
    else { lo = Math.min(baseNorm, baseNorm + a); hi = Math.max(baseNorm, baseNorm + a); }
    lo = clamp(lo, 0, 1); hi = clamp(hi, 0, 1);
    if (typeof route.min === "number") { nlo = model.toNorm(route.min); lo = Math.max(lo, Math.min(nlo, hi)); }
    if (typeof route.max === "number") { nhi = model.toNorm(route.max); hi = Math.min(hi, Math.max(nhi, lo)); }
    return [lo, hi];
  }

  /* Summed modulation reach: every active route pushes the value up and/or down from the base
     (bipolar both ways by |amount|, unipolar by sign); the extents add up, then clamp to 0..1. */
  function sumSpan(routes, model, baseNorm) {
    var up = 0, down = 0, i, sp;
    for (i = 0; i < routes.length; i++) {
      sp = routeSpan(routes[i], model, baseNorm);
      up += Math.max(0, sp[1] - baseNorm);
      down += Math.max(0, baseNorm - sp[0]);
    }
    return [clamp(baseNorm - down, 0, 1), clamp(baseNorm + up, 0, 1)];
  }

  /* ---- SVG helpers ----------------------------------------------------------------- */
  function svgEl(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag), k;
    for (k in (attrs || {})) n.setAttribute(k, attrs[k]);
    return n;
  }
  function f2(x) { return (Math.round(x * 100) / 100).toString(); }
  function polar(r, deg) { var a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; }
  function arcPath(r, a1, a2) {
    if (a2 - a1 < 0.05) return "";
    var p1 = polar(r, a1), p2 = polar(r, a2);
    return "M" + f2(p1[0]) + " " + f2(p1[1]) + " A" + r + " " + r + " 0 " + ((a2 - a1) > 180 ? 1 : 0) + " 1 " + f2(p2[0]) + " " + f2(p2[1]);
  }
  var A0 = -135, ASWEEP = 270, R_TRACK = 46, R_MOD = 42, R_TICK_IN = 38.5, R_TICK_OUT = 43;
  /* R_MOD is the modulation band's radius. It used to be 49 of 50 - i.e. hugging the outer
     edge of the wrap, where it read as a white halo around the whole knob. 42 sits inside
     the 38..46 gap between the dial and the track, so it reads as a reach band. */

  /* data-size: sm | md | lg | <css length> | <number = rem>. knob = diameter, slider = track length, others = control height */
  function applySize(node, kind, s) {
    if (!s) return;
    var table = kind === "knob" ? { sm: "2rem", md: "3rem", lg: "4rem" } : (kind === "slider" ? { sm: "4rem", md: "6rem", lg: "9rem" } : { sm: "1.25rem", md: "1.5rem", lg: "2rem" });
    var prop = kind === "knob" ? "--knob-size" : (kind === "slider" ? "--slider-len" : "--w-h");
    var v = table[s] || (/^[\d.]+$/.test(s) ? s + "rem" : s);
    node.style.setProperty(prop, v);
    node.setAttribute("data-size", s);
  }

  /* ---- shared registries ------------------------------------------------------------ */
  var handles = {};               /* param id -> [handle] */
  var subscribedTo = null, unsubs = [];
  var openMenu = null;
  function closeOpenMenu(refocus) {
    if (!openMenu) return;
    var m = openMenu; openMenu = null;
    document.removeEventListener("pointerdown", m.outside, true);
    if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
    if (m.owner && m.owner.el) { m.owner.el.setAttribute("aria-expanded", "false"); if (refocus) m.owner.focus(); }
  }
  var clipboard = { value: null, text: "" };

  function ensureEvents() {
    var b = APC.bridge;
    if (!b || !b.on || subscribedTo === b) return;
    subscribedTo = b;
    unsubs = [];
    function sub(name, fn) { var u = b.on(name, fn); if (typeof u === "function") unsubs.push(u); }
    sub("param", function (ev) {
      if (!ev) return;
      var id = ev.id, list, i, all;
      if (id === "*" || id === undefined) {
        params.drop("*");
        for (id in handles) { list = handles[id].slice(); for (i = 0; i < list.length; i++) list[i].refresh(true); }
        return;
      }
      if (descCache[id] && typeof ev.value !== "undefined") descCache[id].value = ev.value;
      list = (handles[id] || []).slice();
      for (i = 0; i < list.length; i++) list[i].onParam(ev);
    });
    sub("preset", function () {
      params.drop("*");
      var id, list, i;
      for (id in handles) { list = handles[id].slice(); for (i = 0; i < list.length; i++) list[i].refresh(true); }
    });
    sub("meter", function (ev) {
      if (!ev || typeof ev.id !== "string") return;
      var n = ev.id.length - 4;
      if (n > 0 && ev.id.lastIndexOf(".mod") === n) {
        var list = (handles[ev.id.slice(0, n)] || []).slice(), i;
        for (i = 0; i < list.length; i++) list[i].onParam({ id: ev.id.slice(0, n), modulated: ev.value, onlyMod: true });
      }
    });
    sub("midi", function (ev) {            /* optional: native pushes {id,cc} after a learn completes */
      if (ev && ev.id) { params.drop(ev.id); APC.emit("params:changed", { id: ev.id }); }
    });
  }
  APC.on("params:changed", function (ev) {
    if (!ev || !ev.id) return;
    params.drop(ev.id);
    var list = (handles[ev.id] || []).slice(), i;
    for (i = 0; i < list.length; i++) list[i].refresh(true);
  });

  /* ---- scrolling-panel detection for the wheel rule --------------------------------- */
  function inScrollable(node) {
    var n = node.parentNode, cs;
    while (n && n !== document.body && n !== document.documentElement && n.nodeType === 1) {
      cs = window.getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
      n = n.parentNode;
    }
    return false;
  }

  /* ============================================================================
     The control
     ============================================================================ */
  function createControl(root, opts, kind) {
    var id = opts.param;
    if (!id) {
      APC.emit("error", { message: "APC " + kind + " needs data-param", source: "apc-controls" });
      return { dispose: function () {} };
    }
    prefs.get("double_click");
    if (!prefsRequested) { prefsRequested = true; prefs.reload(); }

    var model = null, desc = null;
    var st = { value: 0, modulated: null, ready: false };
    var g = { active: false, start: 0, label: "" };
    var drag = null, longPress = 0, lastTap = null, lastDouble = 0, suppressClick = false;
    var entry = null, hintEl = null, hintTimer = 0, invalidTimer = 0, glideTimer = 0;
    var pending = 0, hasPending = false, sendTimer = 0, lastSendAt = 0, lastSent = null;
    var wheelAcc = 0, wheelTimer = 0, hoverAt = 0;
    var timers = [], offs = [], disposed = false;
    var isCont = (kind === "knob" || kind === "slider");
    var horizontal = (kind === "slider" && /^h/i.test(opts.orient || opts.orientation || ""));
    var bipolarOpt = (opts.bipolar === "true" || opts.bipolar === "");
    /* Arc / fill origin. A gain-like range (dB, or any range not centred on zero) fills from its MINIMUM like a
       normal knob; only a range centred on zero (pan, detune, +/-100 %) fills from the middle. data-bipolar="true|false" forces it. */
    function isBipolar() {
      if (opts.bipolar === "false") return false;
      if (bipolarOpt) return true;
      if (!model || model.isChoice || !(model.min < 0 && model.max > 0)) return false;
      if (String(model.unit || "").toLowerCase() === "db") return false;
      return Math.abs(model.min + model.max) <= 0.1 * (model.max - model.min);
    }
    var readoutPos = /^(above|top)$/i.test(opts.readout || "") ? "above" : "below";
    var showReadout = (isCont && !/^(false|none|off)$/i.test(opts.readout || ""));
    var unitMode = /^(separate|none)$/i.test(opts.unit || "") ? String(opts.unit).toLowerCase() : "inline";
    var tickOpt = opts.ticks || "";
    var forcedDisabled = (opts.disabled === "true" || opts.disabled === "");
    var steppers = (kind === "selector" && opts.steppers !== "false");
    var labelText = opts.label || (root.textContent || "").replace(/\s+/g, " ").trim() || "";
    var ui = {};                    /* built nodes */
    var handle;

    function later(fn, ms) {
      var t = setTimeout(function () { var i = timers.indexOf(t); if (i > -1) timers.splice(i, 1); fn(); }, ms);
      timers.push(t);
      return t;
    }
    function cancel(t) { if (!t) return; clearTimeout(t); var i = timers.indexOf(t); if (i > -1) timers.splice(i, 1); }
    function on(node, type, fn, o) { node.addEventListener(type, fn, o || false); offs.push(function () { node.removeEventListener(type, fn, o || false); }); }
    function name() { return (desc && desc.name) || labelText || id; }

    /* ---- build DOM ---- */
    APC.dom.clear(root);
    root.classList.add("apc-ctl", "apc-ctl--" + kind);
    if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "0");
    root.setAttribute("data-param", id);
    root.setAttribute("role", kind === "toggle" ? "switch" : "slider");
    root.setAttribute("aria-label", labelText || id);
    root.setAttribute("aria-disabled", "true");
    root.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown PageUp PageDown Home End");
    root.setAttribute("data-readout-pos", readoutPos);
    applySize(root, kind, opts.size);
    if (forcedDisabled) { root.setAttribute("data-disabled", "true"); root.classList.add("is-disabled"); root.setAttribute("tabindex", "-1"); }
    if (kind === "toggle" && /^button$/i.test(opts.variant || "")) root.classList.add("apc-psw--button");

    ui.more = h("button", { class: "apc-ctl-more", type: "button", tabindex: "-1", "aria-label": "Options for " + (labelText || id),
      title: "Options (right-click)", text: "⋯" });

    if (kind === "knob") {
      root.classList.add("apc-knob");
      ui.ringTicks = svgEl("g", { "class": "apc-ring__ticks" });
      /* The track is a real 270 degree arc - the plate's own M..A.. path - NOT a full circle
         with a dash pattern. The CSS keeps `vector-effect: non-scaling-stroke` so the 2px stroke
         stays 2px at any knob size, but that also measures dash lengths in screen pixels, so a
         0.75-circumference dash no longer matched the circle: the ring painted almost closed,
         with its gap in the wrong place. A path needs no dash and is scale independent. */
      ui.ringTrack = svgEl("path", { "class": "apc-ring__track", d: arcPath(R_TRACK, A0, A0 + ASWEEP) });
      ui.ringValue = svgEl("path", { "class": "apc-ring__value" });
      ui.ringMod = svgEl("g", { "class": "apc-ring__mod" });
      ui.marker = svgEl("circle", { "class": "apc-ring__marker", r: "3", cx: "0", cy: "-45.5", visibility: "hidden" });
      ui.ring = svgEl("svg", { "class": "apc-ring", viewBox: "-50 -50 100 100", "aria-hidden": "true", focusable: "false" });
      ui.ring.appendChild(ui.ringTicks); ui.ring.appendChild(ui.ringTrack); ui.ring.appendChild(ui.ringValue); ui.ring.appendChild(ui.ringMod); ui.ring.appendChild(ui.marker);
      ui.pointer = h("div", { class: "apc-knob-pointer" });
      ui.body = h("div", { class: "apc-knob-wrap" }, ui.ring, h("div", { class: "apc-knob-dial" }, ui.pointer));
    } else if (kind === "slider") {
      root.classList.add("apc-fader");
      if (horizontal) root.classList.add("apc-fader--h");
      ui.fill = h("div", { class: "apc-fader-fill" });
      ui.modLayer = h("div", { class: "apc-fader-mod" });
      ui.cap = h("div", { class: "apc-fader-cap" });
      ui.ticks = h("div", { class: "apc-fader-ticks", "aria-hidden": "true" });
      ui.track = h("div", { class: "apc-fader-track" }, ui.fill, ui.modLayer, ui.ticks, ui.cap);
      ui.body = ui.track;
    } else if (kind === "selector") {
      root.classList.add("apc-flip");
      ui.value = h("span", { class: "apc-flip-value" });
      ui.cap = h("button", { class: "apc-flip-cap apc-sel-cap", type: "button", tabindex: "-1", "aria-haspopup": "listbox", "aria-label": "Choose " + (labelText || id) }, ui.value);
      if (steppers) {
        ui.prev = h("button", { class: "apc-sel-step apc-sel-step--prev", type: "button", tabindex: "-1", "aria-label": "Previous " + (labelText || id), title: "Previous", text: "‹" });
        ui.next = h("button", { class: "apc-sel-step apc-sel-step--next", type: "button", tabindex: "-1", "aria-label": "Next " + (labelText || id), title: "Next", text: "›" });
        ui.body = h("div", { class: "apc-sel-row" }, ui.prev, ui.cap, ui.next);
      } else ui.body = ui.cap;
    } else {
      root.classList.add("apc-psw");
      ui.led = h("span", { class: "led" });                      // the button variant keeps the single lamp
      ui.cap = h("span", { class: "apc-psw-cap", "aria-hidden": "true" });
      ui.track = h("span", { class: "apc-psw-track", "aria-hidden": "true" }, ui.cap);
      ui.body = null;
    }
    ui.dot = h("span", { class: "apc-mod-dot", hidden: true, "aria-hidden": "true" });
    ui.label = h("div", { class: kind === "knob" ? "apc-knob-label" : "apc-ctl-label" }, labelText, ui.dot);
    if (showReadout) ui.readout = h("button", { class: "apc-readout", type: "button", tabindex: "-1", text: "—" });

    /* No visible "..." options button by default: the context panel is already reachable by right-click,
       touch long-press and Shift+F10 / ContextMenu key, so the button was redundant and confusing.
       data-more="show" adds it back for a product that wants an always-visible touch affordance. */
    var showMore = opts.more === "show";
    if (kind === "toggle") {
      ui.label = h("span", { class: "apc-ctl-label" }, labelText, ui.dot);
      root.appendChild(root.classList.contains("apc-psw--button") ? ui.led : ui.track);
      root.appendChild(ui.label);
      if (showMore) root.appendChild(ui.more);
    }
    else {
      root.appendChild(ui.body);
      if (ui.readout) root.appendChild(ui.readout);
      root.appendChild(ui.label);
      if (showMore) root.appendChild(ui.more);
    }

    /* ---- model / state ---- */
    function setupFromDescriptor(d) {
      desc = d; model = new Model(d);
      st.value = model.snap(model.fromWire(d.value));
      lastSent = st.value;
      st.ready = true;
      root.removeAttribute("aria-disabled");
      root.removeAttribute("aria-busy");
      if (!labelText) { labelText = d.name || id; if (ui.label && ui.label.firstChild) ui.label.firstChild.nodeValue = labelText; root.setAttribute("aria-label", labelText); }
      root.setAttribute("aria-valuemin", String(model.min));
      root.setAttribute("aria-valuemax", String(model.max));
      if (forcedDisabled) root.setAttribute("aria-disabled", "true");
      buildTicks();
      render();
    }
    /* optional tick marks: data-ticks="5" (count incl. both ends) or "steps" (one per step of a stepped/choice parameter) */
    function buildTicks() {
      if (!tickOpt || !model || (kind !== "knob" && kind !== "slider")) return;
      var n = 0, i, t, a, p1, p2, mk;
      if (tickOpt === "steps") n = model.stepsCount() + 1;
      else n = parseInt(tickOpt, 10);
      if (!(n >= 2) || n > 41) return;
      if (kind === "knob") APC.dom.clear(ui.ringTicks); else APC.dom.clear(ui.ticks);
      for (i = 0; i < n; i++) {
        t = i / (n - 1);
        if (kind === "knob") {
          a = A0 + t * ASWEEP; p1 = polar(R_TICK_IN, a); p2 = polar(R_TICK_OUT, a);
          ui.ringTicks.appendChild(svgEl("line", { "class": "apc-ring__tick", x1: f2(p1[0]), y1: f2(p1[1]), x2: f2(p2[0]), y2: f2(p2[1]) }));
        } else {
          mk = h("span", { class: "apc-fader-tick" });
          if (horizontal) mk.style.left = f2(t * 100) + "%"; else mk.style.bottom = f2(t * 100) + "%";
          ui.ticks.appendChild(mk);
        }
      }
    }
    function refresh(fresh) {
      root.setAttribute("aria-busy", "true");
      return params.get(id, !!fresh).then(function (d) {
        if (disposed) return;
        if (d) { if (g.active) { desc = d; renderMod(); return; } setupFromDescriptor(d); }
        else { root.removeAttribute("aria-busy"); root.setAttribute("aria-invalid", "true"); }
      });
    }

    /* ---- rendering ---- */
    function modRoutes() { return (desc && desc.modulation) ? desc.modulation : []; }
    function zeroNorm() { return model.toNorm(0); }
    function render() {
      if (!model) return;
      var v = st.value, t = model.toNorm(v), txt = model.format(v), i;
      var routes = modRoutes();
      var live = [];
      for (i = 0; i < routes.length; i++) if (!routes[i].bypass) live.push(sourceName(routes[i]));
      if (kind === "toggle") {
        root.setAttribute("aria-checked", v >= 0.5 ? "true" : "false");
        root.setAttribute("data-on", v >= 0.5 ? "true" : "false");
      } else {
        root.setAttribute("aria-valuenow", String(v));
        root.setAttribute("aria-valuetext", txt + (live.length ? ", modulated by " + live.join(", ") : ""));
      }
      if (ui.readout) {
        paintReadout(txt);
        ui.readout.setAttribute("aria-label", "Value of " + name() + ": " + txt + ". Click to type a value");
      }
      if (kind === "knob") {
        var ang = A0 + t * ASWEEP;
        ui.pointer.style.transform = "rotate(" + f2(ang) + "deg)";   // the pointer fills the dial; its centre is the dial's
        var from = isBipolar() ? A0 + zeroNorm() * ASWEEP : A0;
        ui.ringValue.setAttribute("d", arcPath(R_TRACK, Math.min(from, ang), Math.max(from, ang)));
      } else if (kind === "slider") {
        var sf = isBipolar() ? zeroNorm() : 0, lo = Math.min(sf, t), span = Math.abs(t - sf);
        if (horizontal) { ui.cap.style.left = f2(t * 100) + "%"; ui.cap.style.top = ""; ui.fill.style.left = f2(lo * 100) + "%"; ui.fill.style.width = f2(span * 100) + "%"; }
        else { ui.cap.style.top = f2((1 - t) * 100) + "%"; ui.fill.style.bottom = f2(lo * 100) + "%"; ui.fill.style.height = f2(span * 100) + "%"; }
      } else if (kind === "selector") {
        ui.value.textContent = txt;
        if (ui.prev) { ui.prev.disabled = forcedDisabled || v <= model.min; ui.next.disabled = forcedDisabled || v >= model.max; }
      }
      renderMod();
    }
    /* readout text: "inline" = value and unit in one string (default); "separate" = unit as its own dimmed span; "none" = no unit */
    function paintReadout(txt) {
      var m = (unitMode !== "inline" && model && model.unit && !model.isChoice && !model.isBool) ? /^(.*\S)\s+(\S+)$/.exec(txt) : null;
      if (!m) { ui.readout.textContent = txt; return; }
      APC.dom.clear(ui.readout);
      ui.readout.appendChild(h("span", { class: "apc-readout__v", text: m[1] }));
      if (unitMode === "separate") { ui.readout.appendChild(document.createTextNode(" ")); ui.readout.appendChild(h("span", { class: "apc-readout__u", text: m[2] })); }
    }
    function renderMod() {
      if (!model) return;
      var routes = modRoutes(), s, base = model.toNorm(st.value);
      var active = routes.filter(function (r) { return !r.bypass; });
      var any = active.length > 0;
      if (kind === "knob") APC.dom.clear(ui.ringMod);
      if (kind === "slider") APC.dom.clear(ui.modLayer);
      /* ONE neutral band for the whole modulation: the summed reach of all active routes around the
         base value (clamped to the range). Individual sources are edited in the context panel. */
      if (any && (kind === "knob" || kind === "slider")) {
        var span = sumSpan(active, model, base);
        if (kind === "knob") {
          ui.ringMod.appendChild(svgEl("path", { d: arcPath(R_MOD, A0 + span[0] * ASWEEP, A0 + span[1] * ASWEEP),
            "class": "apc-ring__route apc-ring__sum", "data-src": "sum" }));
        } else {
          s = h("div", { class: "apc-fader-route apc-fader-sum", "data-src": "sum" });
          if (horizontal) { s.style.left = f2(span[0] * 100) + "%"; s.style.width = f2((span[1] - span[0]) * 100) + "%"; }
          else { s.style.bottom = f2(span[0] * 100) + "%"; s.style.height = f2((span[1] - span[0]) * 100) + "%"; }
          ui.modLayer.appendChild(s);
        }
      }
      root.classList.toggle("is-modulated", any);
      ui.dot.hidden = !any;
      if (any) ui.dot.title = "Modulated by " + active.map(sourceName).join(", ");
      if (kind === "knob") {
        if (st.modulated !== null && active.length) {
          ui.marker.setAttribute("visibility", "visible");
          var p2 = polar(R_MOD, A0 + model.toNorm(st.modulated) * ASWEEP);
          ui.marker.setAttribute("cx", f2(p2[0])); ui.marker.setAttribute("cy", f2(p2[1]));
        } else ui.marker.setAttribute("visibility", "hidden");
      }
    }

    /* ---- sending values (leading + trailing, flushed at gesture end) ---- */
    function flushSend() {
      if (sendTimer) { cancel(sendTimer); sendTimer = 0; }
      if (!hasPending) return;
      hasPending = false; lastSendAt = Date.now();
      var v = pending;
      lastSent = v;
      call("apc.param.set", { id: id, value: model.toWire(v) }).then(function (r) {
        if (disposed || g.active || !r || r.error || typeof r.value === "undefined") return;
        var hv = model.snap(model.fromWire(r.value));
        if (hv !== st.value && !hasPending) { st.value = hv; render(); }
      });
    }
    function queueSend(v) {
      pending = v; hasPending = true;
      var wait = 16 - (Date.now() - lastSendAt);
      if (wait <= 0) flushSend();
      else if (!sendTimer) sendTimer = later(flushSend, wait);
    }
    function beginG(label) {
      if (g.active) return;
      g.active = true; g.start = st.value; g.label = label || ("Adjust " + name());
      call("apc.param.begin", { id: id });
      APC.emit("ctl:drag", { id: id, active: true });
    }
    function endG() {
      if (!g.active) return;
      flushSend();
      g.active = false;
      call("apc.param.end", { id: id });
      APC.emit("ctl:drag", { id: id, active: false });
      if (st.value !== g.start) APC.emit("undo:push", { label: g.label, id: id, before: g.start, after: st.value });
    }
    function setLocal(v) {
      v = model.snap(v);
      if (v === st.value) return false;
      st.value = v;
      render();
      queueSend(v);
      return true;
    }
    /* one complete host gesture around a discrete change (keyboard, entry, paste, toggle) */
    function commitValue(v, label) {
      if (!model) return false;
      v = model.snap(v);
      if (v === st.value && !g.active) return false;
      var wasActive = g.active;
      beginG(label);
      var changed = setLocal(v);
      if (!wasActive) endG();
      return changed;
    }
    function reset(label) {
      if (!model) return;
      var before = st.value;
      st.value = model.snap(model.def); lastSent = st.value;
      if (prefs.get("reset_animation") === "glide") {
        root.classList.add("apc-glide"); cancel(glideTimer);
        glideTimer = later(function () { root.classList.remove("apc-glide"); }, 200);
      }
      render();
      call("apc.param.reset", { id: id }).then(function (r) {
        if (disposed || !r || r.error || typeof r.value === "undefined") return;
        var hv = model.snap(model.fromWire(r.value));
        if (hv !== st.value) { st.value = hv; render(); }
      });
      if (before !== st.value) APC.emit("undo:push", { label: label || ("Reset " + name()), id: id, before: before, after: st.value });
    }
    function onParam(ev) {
      if (disposed || !model) return;
      if (typeof ev.modulated === "number") st.modulated = ev.modulated;
      else if (ev.modulated === null) st.modulated = null;
      if (ev.onlyMod) { renderMod(); return; }
      if (g.active) { renderMod(); return; }
      if (typeof ev.value !== "undefined") {
        var v = model.snap(model.fromWire(ev.value));
        if (desc) desc.value = ev.value;
        if (v !== st.value) { st.value = v; lastSent = v; render(); return; }
      }
      renderMod();
    }

    /* ---- hint / value entry ---- */
    function hint(msg) {
      if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
      hintEl = h("span", { class: "apc-hint", role: "status", text: msg });
      root.appendChild(hintEl);
      cancel(hintTimer);
      hintTimer = later(function () { if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl); hintEl = null; }, 2200);
    }
    function flashInvalid(msg) {
      if (!entry) return;
      entry.classList.remove("apc-invalid"); void entry.offsetWidth;
      entry.classList.add("apc-invalid");
      entry.setAttribute("aria-invalid", "true");
      cancel(invalidTimer);
      invalidTimer = later(function () { if (entry) entry.classList.remove("apc-invalid"); }, 500);
      hint(msg || "Invalid value");
      entry.focus();
    }
    function closeEntry(refocus) {
      if (!entry) return;
      var e = entry; entry = null;
      if (e.parentNode) e.parentNode.removeChild(e);
      root.classList.remove("is-editing");
      if (ui.readout) ui.readout.hidden = false;
      if (refocus && !disposed) { try { root.focus({ preventScroll: true }); } catch (x) { root.focus(); } }
    }
    function openEntry() {
      if (!model || disposed) return false;
      if (entry) { entry.focus(); entry.select(); return true; }
      if (APC.help && APC.help.hideTooltip) APC.help.hideTooltip();
      entry = h("input", { class: "apc-entry", type: "text", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
        inputmode: model.isChoice ? "text" : "decimal",
        "aria-label": "Type a value for " + name() + ". Enter applies, Escape cancels." });
      entry.value = model.format(st.value);
      if (ui.readout) { ui.readout.hidden = true; root.insertBefore(entry, ui.readout); }
      else { entry.classList.add("apc-entry--float"); root.appendChild(entry); }
      root.classList.add("is-editing");
      entry.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); commitEntry(); }
        else if (e.key === "Escape") { e.preventDefault(); closeEntry(true); }
      });
      entry.addEventListener("input", function () { entry.removeAttribute("aria-invalid"); });
      entry.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
      entry.addEventListener("blur", function () {
        var e = entry;
        if (!e || disposed) return;
        var r = model.parse(e.value);
        if (r.ok) { commitEntry(); return; }
        later(function () { if (entry === e && document.body.contains(e)) flashInvalid(r.reason); }, 0);
      });
      entry.focus();
      entry.select();
      return true;
    }
    function commitEntry() {
      if (!entry) return;
      var r = model.parse(entry.value);
      if (!r.ok) { flashInvalid(r.reason); return; }
      var e = entry; entry = null;
      if (e.parentNode) e.parentNode.removeChild(e);
      root.classList.remove("is-editing");
      if (ui.readout) ui.readout.hidden = false;
      commitValue(r.value, "Set " + name());
      if (r.clamped) hint("Clamped to " + model.rangeText());
      try { root.focus({ preventScroll: true }); } catch (x) { root.focus(); }
    }

    /* ---- selector menu ---- */
    function closeMenu(refocus) { if (openMenu && openMenu.owner === handle) closeOpenMenu(refocus); }
    function showMenu() {
      if (!model || !model.isChoice) return;
      if (openMenu) { var same = openMenu.owner === handle; closeOpenMenu(false); if (same) return; }
      var node = h("div", { class: "apc-menu", role: "listbox", "aria-label": name() });
      var items = [], i, cur = Math.round(st.value);
      function pick(ix) { closeMenu(true); commitValue(ix, "Set " + name()); }
      for (i = 0; i < model.choices.length; i++) {
        (function (ix) {
          var it = h("div", { class: "apc-menu__item", role: "option", tabindex: "-1", "aria-selected": ix === cur ? "true" : "false", text: String(model.choices[ix]) });
          it.addEventListener("click", function () { pick(ix); });
          it.addEventListener("keydown", function (e) {
            var k = e.key, to = -1;
            if (k === "ArrowDown") to = Math.min(items.length - 1, ix + 1);
            else if (k === "ArrowUp") to = Math.max(0, ix - 1);
            else if (k === "Home") to = 0;
            else if (k === "End") to = items.length - 1;
            else if (k === "Enter" || k === " ") { e.preventDefault(); e.stopPropagation(); pick(ix); return; }
            else if (k === "Escape" || k === "Tab") { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
            if (to >= 0) { e.preventDefault(); e.stopPropagation(); items[to].focus(); }
          });
          items.push(it); node.appendChild(it);
        })(i);
      }
      document.body.appendChild(node);
      var r = root.getBoundingClientRect(), nr = node.getBoundingClientRect();
      var top = r.bottom + 2;
      if (top + nr.height > window.innerHeight) top = Math.max(0, r.top - nr.height - 2);
      node.style.left = Math.max(0, Math.min(r.left, window.innerWidth - nr.width)) + "px";
      node.style.top = top + "px";
      node.style.minWidth = r.width + "px";
      var outside = function (e) { if (!node.contains(e.target) && !root.contains(e.target)) closeMenu(false); };
      document.addEventListener("pointerdown", outside, true);
      openMenu = { owner: handle, node: node, outside: outside };
      root.setAttribute("aria-expanded", "true");
      (items[cur] || items[0]).focus();
    }

    /* ---- context panel ---- */
    function openContext(x, y, via) {
      if (APC.help && APC.help.hideTooltip) APC.help.hideTooltip();
      if (APC.context && APC.context.open) APC.context.open(handle, { x: x, y: y, via: via });
      else APC.emit("context:open", { id: id, x: x, y: y, via: via, handle: handle });
    }

    /* ---- pointer gestures ---- */
    function within(node, t) { return !!node && (t === node || node.contains(t)); }
    function pxRange() {
      if (kind === "slider" && ui.track) {
        var r = ui.track.getBoundingClientRect();
        return Math.max(40, horizontal ? r.width : r.height);
      }
      return 150;
    }
    function startLongPress(e) {
      cancel(longPress);
      var x = e.clientX, y = e.clientY;
      longPress = later(function () {
        longPress = 0;
        if (drag && !drag.moved) {
          var d = drag; drag = null;
          try { root.releasePointerCapture(d.pid); } catch (x2) {}
          suppressClick = true;
          openContext(x, y, "touch");
        }
      }, 550);
    }
    function onDown(e) {
      if (disposed || forcedDisabled) return;
      suppressClick = false;
      if (e.button !== 0 && e.button !== undefined) return;
      var t = e.target;
      if (entry && within(entry, t)) return;
      if (within(ui.more, t) || within(ui.prev, t) || within(ui.next, t)) return;
      if (IS_MAC && e.ctrlKey) return;                       /* ctrl+click = context menu on macOS */
      if (e.altKey) {                                        /* U-01: alt/option+click always resets (base value only) */
        e.preventDefault();
        suppressClick = true;
        try { root.focus({ preventScroll: true }); } catch (x) { root.focus(); }
        reset();
        return;
      }
      if (ui.readout && within(ui.readout, t)) return;       /* click on readout -> value entry (click handler) */
      if (!model || kind === "toggle") return;
      if (entry) closeEntry(false);
      try { root.setPointerCapture(e.pointerId); } catch (x2) {}
      try { root.focus({ preventScroll: true }); } catch (x3) { root.focus(); }
      drag = { pid: e.pointerId, x: e.clientX, y: e.clientY, moved: false, startNorm: model.toNorm(st.value), type: e.pointerType || "mouse",
               mode: (IS_MAC ? e.metaKey : e.ctrlKey) ? 0.01 : (e.shiftKey ? 0.1 : 1) };       /* modifiers latched: ignored during the drag */
      if (kind === "slider" && ui.track && within(ui.track, t) && !within(ui.cap, t)) {   /* click on track jumps there */
        var tr = ui.track.getBoundingClientRect();
        var frac = horizontal ? (e.clientX - tr.left) / (tr.width || 1) : 1 - (e.clientY - tr.top) / (tr.height || 1);
        drag.moved = true; drag.startNorm = clamp(frac, 0, 1); drag.x = e.clientX; drag.y = e.clientY;
        beginG(); setLocal(model.fromNorm(drag.startNorm));
      }
      if (drag.type === "touch") startLongPress(e);
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pid || disposed) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        drag.moved = true; cancel(longPress); longPress = 0;
        beginG();
        if (APC.help && APC.help.hideTooltip) APC.help.hideTooltip();
      }
      var delta = horizontal ? dx : -dy;
      var nn = drag.startNorm + (delta / pxRange()) * drag.mode;
      setLocal(model.fromNorm(clamp(nn, 0, 1)));
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null;
      cancel(longPress); longPress = 0;
      try { root.releasePointerCapture(e.pointerId); } catch (x) {}
      if (d.moved) { endG(); suppressClick = true; return; }
      if (d.type === "touch") {                              /* touch double-tap = double-click behaviour */
        var now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.abs(e.clientX - lastTap.x) < 30 && Math.abs(e.clientY - lastTap.y) < 30) {
          lastTap = null; lastDouble = now; doubleAction();
        } else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }
    function onCancel(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null;
      cancel(longPress); longPress = 0;
      if (d.moved) endG();
    }
    function doubleAction() {
      if (!model || kind === "toggle") return;
      if (prefs.get("double_click") === "value_entry" && isCont) openEntry();     /* U-02 / U-15 */
      else reset();
    }
    function onClick(e) {
      if (disposed || forcedDisabled) return;
      var t = e.target;
      if (within(ui.more, t)) {
        e.preventDefault();
        var r = ui.more.getBoundingClientRect();
        openContext(r.left, r.bottom, "button");
        return;
      }
      if (within(ui.prev, t) || within(ui.next, t)) {          /* visible prev/next buttons of the selector (the keyboard path is ArrowUp/Down) */
        e.preventDefault();
        if (model) commitValue(st.value + (within(ui.prev, t) ? -1 : 1), "Set " + name());
        return;
      }
      if (suppressClick) { suppressClick = false; return; }
      if (e.altKey) return;
      if (ui.readout && within(ui.readout, t)) { e.preventDefault(); openEntry(); return; }
      if (!model) return;
      if (kind === "toggle") { commitValue(st.value >= 0.5 ? 0 : 1, "Toggle " + name()); return; }
      if (kind === "selector") showMenu();
    }
    function onDbl(e) {
      if (disposed || forcedDisabled || e.altKey) return;
      var t = e.target;
      if (within(ui.more, t) || within(ui.prev, t) || within(ui.next, t) || (entry && within(entry, t)) || (ui.readout && within(ui.readout, t))) return;
      if (Date.now() - lastDouble < 500) return;
      e.preventDefault();
      doubleAction();
    }
    function onCtx(e) {
      e.preventDefault();                                    /* never the browser menu */
      if (disposed || forcedDisabled) return;
      openContext(e.clientX, e.clientY, "pointer");
    }

    /* ---- wheel (U-12 rule: 120 ms hover or Shift inside scrollable panels) ---- */
    function onWheel(e) {
      if (disposed || forcedDisabled || !model || drag) return;
      var scrollable = inScrollable(root), capture;
      if (!scrollable) capture = true;
      else if (prefs.get("wheel_target") === "panel") capture = !!e.shiftKey;
      else capture = !!e.shiftKey || (hoverAt > 0 && (now() - hoverAt) >= 120);
      if (!capture) return;
      var dy = e.deltaY || e.deltaX || 0;
      if (!dy) return;
      e.preventDefault();
      var notches = e.deltaMode === 0 ? dy / 100 : (e.deltaMode === 1 ? dy / 3 : dy);
      notches = -notches;
      if (APC.help && APC.help.hideTooltip) APC.help.hideTooltip();
      beginG();
      if (model.step) {
        wheelAcc += notches;
        var n = wheelAcc < 0 ? Math.ceil(wheelAcc) : Math.floor(wheelAcc);
        if (n !== 0) { wheelAcc -= n; setLocal(st.value + n * model.step); }
      } else {
        setLocal(model.fromNorm(model.toNorm(st.value) + notches * (e.shiftKey ? 0.001 : 0.01)));
      }
      cancel(wheelTimer);
      wheelTimer = later(function () { wheelTimer = 0; wheelAcc = 0; endG(); }, 250);
    }
    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

    /* ---- keyboard ---- */
    function nudge(dir, kindOfStep) {
      var v;
      if (model.step) {
        var cnt = kindOfStep === "coarse" ? Math.max(1, Math.round(model.stepsCount() / 10)) : 1;
        v = st.value + dir * cnt * model.step;
      } else {
        var amt = kindOfStep === "coarse" ? 0.1 : (kindOfStep === "fine" ? 0.001 : 0.01);
        v = model.fromNorm(model.toNorm(st.value) + dir * amt);
      }
      commitValue(v);
    }
    function onKey(e) {
      if (disposed || forcedDisabled) return;
      var t = e.target;
      if (entry && within(entry, t)) return;
      var k = e.key;
      if (t !== root && t.tagName === "BUTTON" && (k === "Enter" || k === " ")) return;     /* the button's own click handles it */
      if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) {
        e.preventDefault();
        var r = root.getBoundingClientRect();
        openContext(r.left + r.width / 2, r.bottom, "keyboard");
        return;
      }
      if (!model) return;
      if (k === "Enter" || k === "F2") {
        if (kind === "toggle") { if (root.tagName !== "BUTTON") { e.preventDefault(); commitValue(st.value >= 0.5 ? 0 : 1, "Toggle " + name()); } return; }
        e.preventDefault();
        if (kind === "selector") showMenu(); else if (isCont) openEntry();
        return;
      }
      if (k === " " || k === "Spacebar") {
        if (kind === "toggle") { if (root.tagName !== "BUTTON") { e.preventDefault(); commitValue(st.value >= 0.5 ? 0 : 1, "Toggle " + name()); } }
        else if (kind === "selector") { e.preventDefault(); showMenu(); }
        return;
      }
      if (k === "Delete" || k === "Backspace") { e.preventDefault(); reset(); return; }
      if (kind === "toggle") {
        if (k === "ArrowUp" || k === "ArrowRight") { e.preventDefault(); commitValue(1, "Toggle " + name()); }
        else if (k === "ArrowDown" || k === "ArrowLeft") { e.preventDefault(); commitValue(0, "Toggle " + name()); }
        return;
      }
      var dir = 0, step = e.shiftKey ? "fine" : "step";
      if (k === "ArrowUp" || k === "ArrowRight") dir = 1;
      else if (k === "ArrowDown" || k === "ArrowLeft") dir = -1;
      else if (k === "PageUp") { dir = 1; step = "coarse"; }
      else if (k === "PageDown") { dir = -1; step = "coarse"; }
      else if (k === "Home") { e.preventDefault(); commitValue(model.min); return; }
      else if (k === "End") { e.preventDefault(); commitValue(model.max); return; }
      if (dir) { e.preventDefault(); nudge(dir, step); }
    }

    /* ---- wire up ---- */
    on(root, "pointerdown", onDown);
    on(root, "pointermove", onMove);
    on(root, "pointerup", onUp);
    on(root, "pointercancel", onCancel);
    on(root, "click", onClick);
    on(root, "dblclick", onDbl);
    on(root, "contextmenu", onCtx);
    on(root, "wheel", onWheel, { passive: false });
    on(root, "keydown", onKey);
    on(root, "pointerenter", function () { hoverAt = now(); });
    on(root, "mouseenter", function () { if (!hoverAt) hoverAt = now(); });
    on(root, "pointerleave", function () { hoverAt = 0; });
    on(root, "mouseleave", function () { hoverAt = 0; });
    on(root, "lostpointercapture", function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag; drag = null; cancel(longPress); longPress = 0;
      if (d.moved) endG();
    });

    handle = {
      kind: kind, id: id, el: root,
      get desc() { return desc; },
      get model() { return model; },
      getValue: function () { return st.value; },
      getText: function () { return model ? model.format(st.value) : ""; },
      setValue: function (v, label) { return commitValue(v, label); },
      commitValue: commitValue,
      reset: reset,
      enterValue: openEntry,
      refresh: refresh,
      onParam: onParam,
      isDragging: function () { return g.active; },
      isDisabled: function () { return forcedDisabled; },
      setDisabled: function (b) {
        forcedDisabled = !!b;
        root.classList.toggle("is-disabled", forcedDisabled);
        if (forcedDisabled) { root.setAttribute("aria-disabled", "true"); root.setAttribute("data-disabled", "true"); root.setAttribute("tabindex", "-1"); }
        else { root.removeAttribute("data-disabled"); root.setAttribute("tabindex", "0"); if (model) root.removeAttribute("aria-disabled"); }
        if (forcedDisabled) { closeEntry(false); closeMenu(false); }
        if (model) render();
      },
      focus: function () { try { root.focus({ preventScroll: true }); } catch (x) { root.focus(); } },
      dispose: function () {
        if (disposed) return;
        endG();
        disposed = true;
        closeEntry(false);
        closeMenu(false);
        var i;
        for (i = 0; i < timers.length; i++) clearTimeout(timers[i]);
        timers = [];
        for (i = 0; i < offs.length; i++) { try { offs[i](); } catch (e) {} }
        offs = [];
        var l = handles[id] || [], ix = l.indexOf(handle);
        if (ix > -1) l.splice(ix, 1);
        if (root.__apcCtl === handle) root.__apcCtl = null;
      }
    };
    root.__apcCtl = handle;
    (handles[id] = handles[id] || []).push(handle);
    ensureEvents();
    root.setAttribute("aria-busy", "true");
    refresh(false);
    return handle;
  }

  APC.controls = {
    Model: Model, call: call, params: params, sourceStyle: sourceStyle, sourceName: sourceName,
    localize: localize, clipboard: clipboard, isBi: isBi, routeSpan: routeSpan,
    closeMenu: closeOpenMenu,
    handle: function (idOrEl) {
      if (idOrEl && idOrEl.nodeType) return idOrEl.__apcCtl || null;
      var l = handles[idOrEl]; return l && l.length ? l[0] : null;
    },
    all: function () { var out = [], id; for (id in handles) out = out.concat(handles[id]); return out; }
  };

  APC.register("knob", function (el, o) { return createControl(el, o, "knob"); });
  APC.register("slider", function (el, o) { return createControl(el, o, "slider"); });
  APC.register("selector", function (el, o) { return createControl(el, o, "selector"); });
  APC.register("toggle", function (el, o) { return createControl(el, o, "toggle"); });
})();
