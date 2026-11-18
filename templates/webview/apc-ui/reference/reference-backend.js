/* =============================================================================
   reference-backend.js - the mock "plugin side" for the APC Minimal reference (classic script, ES5).
   Load it right after apc-mock.js, BEFORE the kit components (they read apc.info at load).

   In a real plugin everything in this file is the C++ processor + the native bridge: the parameters, the preset
   values. Here it is a small fake so the page is alive in a plain browser. It registers the plugin's parameters on
   the kit's in-memory backend (APC.mock) by wrapping its public bridge entry point, APC.mock.call: our parameter
   ids answer first, every other apc.* function (presets, settings, licence, update, ...) falls through to the
   mock. The kit components cannot tell it from the native bridge: same apc.params.get / apc.param.set / begin / end /
   reset / mod / midi functions, same "param" and "preset" events (CONTRACT.md).

   Exposes APC.refBackend = { params, order, value(id), index(id), onChange(fn), state }.
   Query / attributes: ?mode=night|day  ?scenario=demo|trial|licensed|unverified|update-available|update-failed|io-error
   (the Hub sets <html data-theme> and data-demo-scenario instead). No network, no storage, no telemetry.
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC, root = document.documentElement;
  var state = { errors: [] };
  window.__APC_REF__ = state;
  function fail(msg) {
    state.errors.push(msg);
    if (APC && APC.toast && APC.toast.error) APC.toast.error(msg);
    else if (window.console) console.error("[reference] " + msg);
  }
  if (!APC || !APC.mock) { fail("apc-mock.js did not load (the reference plugin needs the kit's in-memory backend)"); return; }
  var mock = APC.mock;
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function qs(name) { var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search); return m ? decodeURIComponent(m[1]) : ""; }
  var listeners = [];
  function changed() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  /* ---- mode and scenario (Hub: attributes on <html>; standalone: URL) ------------------------------------ */
  var mode = qs("mode") || root.getAttribute("data-theme") || "night";
  if (mode !== "day") mode = "night";
  root.setAttribute("data-theme", mode);
  var scenario = qs("scenario") || root.getAttribute("data-demo-scenario") || "demo";
  try { mock.scenario(scenario); } catch (e) { fail("unknown scenario \"" + scenario + "\": " + e.message); mock.scenario("demo"); }
  mock.call("apc.settings.set", { patch: { ui: { theme: mode } } });

  /* =============================================================================================================
     1. PARAMETERS
     ============================================================================================================= */
  function def(id, name, unit, min, max, dflt, extra) {
    var p = { id: id, name: name, unit: unit, min: min, max: max, "default": dflt, value: dflt, group: "filter",
      help: { what: name + ".", effect: "", how: "Drag, scroll, or type a value." }, modulation: [], midiCc: null };
    var k; for (k in (extra || {})) p[k] = extra[k];
    return p;
  }
  function choice(id, name, labels, dflt, extra) {
    return def(id, name, "", 0, labels.length - 1, labels[dflt], Object.assign({ choices: labels, value: labels[dflt], step: 1 }, extra || {}));
  }
  function help(what, effect) { return { what: what, effect: effect, how: "Drag, scroll, or type a value." }; }
  var ORDER = [
    def("flt_cutoff", "Cutoff", "Hz", 20, 20000, 1200, { skew: 0.3, midiCc: 74, help: help("Filter cutoff frequency.", "Higher values let more of the high end through."),
      modulation: [{ src: "lfo1", amount: 35, polarity: "bipolar", min: 200, max: 4000, bypass: false }, { src: "env1", amount: 40, polarity: "unipolar", min: 20, max: 20000, bypass: false }] }),
    def("flt_reso", "Resonance", "dB", 0, 18, 6, { help: help("Boost at the cutoff frequency.", "More resonance rings and emphasises the cutoff.") }),
    def("flt_drive", "Drive", "dB", 0, 24, 3, { help: help("Input saturation before the filter.", "Adds harmonics and level.") }),
    def("flt_mix", "Mix", "%", 0, 100, 100, { help: help("Dry / wet balance.", "Below 100 % blends the unfiltered signal back in.") }),
    choice("flt_type", "Type", ["Lowpass", "Highpass", "Bandpass", "Notch"], 0, { help: help("Filter response shape.", "Lowpass keeps lows, highpass keeps highs.") }),
    choice("flt_slope", "Slope", ["12 dB/oct", "24 dB/oct"], 1, { help: help("Steepness of the filter skirt.", "24 dB/oct cuts twice as hard.") }),
    choice("flt_mode", "Channels", ["Stereo", "Mid", "Side"], 0, { help: help("Which part of the stereo image is filtered.", "Mid and Side leave the other half untouched.") }),
    def("pk_freq", "Peak frequency", "Hz", 20, 20000, 3200, { skew: 0.3, help: help("Centre of the post-filter peak band.", "") }),
    def("pk_gain", "Peak gain", "dB", -18, 18, 4, { help: help("Boost or cut of the post-filter peak band.", "") }),
    def("out_gain", "Output", "dB", -24, 12, 0, { group: "out", help: help("Output level trim.", "") }),
    choice("fx_bypass", "Bypass", ["Off", "On"], 0, { group: "out", help: help("Bypass the whole effect.", "On passes the input unchanged.") }),
    choice("os_quality", "Oversampling", ["1x", "2x", "4x"], 1, { group: "engine", help: help("Internal oversampling factor.", "Higher is cleaner and uses more CPU.") }),
    choice("opt_dither", "Dither", ["Off", "On"], 0, { group: "engine" }),
    choice("opt_keytrack", "Key track", ["Off", "On"], 0, { group: "engine" }),
    choice("opt_autogain", "Auto gain", ["Off", "On"], 1, { group: "engine" }),
    def("env_a", "Attack", "s", 0.001, 2, 0.02, { skew: 0.3, group: "mod" }),
    def("env_d", "Decay", "s", 0.001, 3, 0.35, { skew: 0.3, group: "mod" }),
    def("env_s", "Sustain", "", 0, 1, 0.55, { group: "mod" }),
    def("env_r", "Release", "s", 0.005, 3, 0.6, { skew: 0.3, group: "mod" }),
    def("env_amt", "Envelope to cutoff", "%", -100, 100, 40, { group: "mod" }),
    choice("lfo_shape", "LFO shape", ["Sin", "Tri", "Saw", "Sqr"], 0, { group: "mod" }),
    def("lfo_rate", "LFO rate", "Hz", 0.05, 20, 2, { skew: 0.4, group: "mod" }),
    def("lfo_depth", "LFO depth", "%", 0, 100, 35, { group: "mod" }),
    def("in_gain", "Gain", "dB", -24, 24, 0, { group: "in", help: help("Input trim before the filter.", "Above 0 dB drives the input harder.") }),
    choice("in_phase", "Phase", ["Normal", "Invert"], 0, { group: "in", help: help("Polarity of the input.", "Invert flips the signal 180 degrees.") }),
    choice("scope_hold", "Hold", ["Off", "On"], 0, { group: "mon", help: help("Freezes the oscilloscope.", "") }),
    choice("flt_char", "Character", ["Steel", "Sift", "Tide", "Flint"], 0, { group: "filter", help: help("Saturation character of the filter core.", "Each shape colours the resonance differently.") }),
    def("seq_bpm", "Tempo", "BPM", 40, 220, 120, { group: "seq", help: help("Sequencer tempo.", "") })
  ];
  var P = {}, midi = {};
  ORDER.forEach(function (p) { P[p.id] = p; });
  function idx(id) { var p = P[id]; return p.choices.indexOf(p.value); }
  function v(id) { return P[id].value; }
  var base = null, dirty = false, slots = { A: null, B: null }, active = "A";
  function snapshot() { var o = {}; ORDER.forEach(function (p) { o[p.id] = p.value; }); return o; }
  function sameSnap(a, b) { var k; for (k in a) if (a[k] !== b[k]) return false; return true; }
  function coerce(p, val) {
    var i;
    if (p.choices) {
      if (typeof val === "number") return p.choices[clamp(Math.round(val), 0, p.choices.length - 1)];
      for (i = 0; i < p.choices.length; i++) if (String(p.choices[i]).toLowerCase() === String(val).toLowerCase()) return p.choices[i];
      return null;
    }
    val = Number(val);
    return isFinite(val) ? clamp(val, p.min, p.max) : null;
  }
  function pushParam(p) { mock.emit("param", { id: p.id, value: p.value }); }
  function applyValues(vals, quiet) {
    ORDER.forEach(function (p) { var nv = vals && vals[p.id] !== undefined ? vals[p.id] : p["default"]; if (nv !== p.value) { p.value = nv; if (!quiet) pushParam(p); } });
    changed();
  }
  /* preset "files": values derived from the preset name, so every preset sounds (and looks) different */
  function hash(s) { var h = 2166136261, i; for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function presetValues(name) {
    if (!name || name === "INIT") return null;
    var a = hash(name), r = function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    var o = {};
    o.flt_cutoff = Math.round(150 * Math.pow(10, r() * 2.2));
    o.flt_reso = Math.round(r() * 120) / 10;
    o.flt_drive = Math.round(r() * 90) / 10;
    o.flt_mix = 70 + Math.round(r() * 30);
    o.flt_type = P.flt_type.choices[Math.floor(r() * 4)];
    o.flt_slope = P.flt_slope.choices[Math.floor(r() * 2)];
    o.pk_freq = Math.round(800 * Math.pow(10, r() * 1.3));
    o.pk_gain = Math.round((r() * 16 - 6) * 10) / 10;
    o.lfo_rate = Math.round((0.2 + r() * 8) * 100) / 100;
    o.lfo_depth = Math.round(r() * 80);
    o.lfo_shape = P.lfo_shape.choices[Math.floor(r() * 4)];
    o.env_a = Math.round((0.005 + r() * 0.4) * 1000) / 1000;
    o.env_d = Math.round((0.1 + r() * 1.2) * 1000) / 1000;
    o.env_s = Math.round(r() * 100) / 100;
    o.env_r = Math.round((0.1 + r() * 1.6) * 1000) / 1000;
    return o;
  }
  function presetPatch(res) {                                  /* the mock's preset state with OUR dirty flag */
    var st = res && res.state ? res.state : res;
    if (st && st.current) { st = clone(st); st.current.dirty = !!(st.current.dirty || dirty); return res && res.state ? Object.assign({}, res, { state: st }) : st; }
    return res;
  }
  function markDirty() {
    var d = !sameSnap(snapshot(), base || snapshot());
    if (d === dirty) return;
    dirty = d;
    mock.call("apc.presets.state", {}).then(function (st) { if (st && st.current) mock.emit("preset", { state: st }); });
  }
  function afterLoad() {
    mock.call("apc.presets.state", {}).then(function (st) {
      var vals = st && st.current ? presetValues(st.current.name) : null;
      dirty = false;
      applyValues(vals, false);
      base = snapshot();
      mock.emit("preset", { state: st });
    });
  }

  var origCall = mock.call;
  var HOOK = {
    "apc.info": function (a) {
      return origCall.call(mock, "apc.info", a).then(function (i) {
        if (i && !i.error) { i.product = "APC Minimal"; i.manufacturer = "DESIGN LIBRARY"; i.version = "1.0.0"; i.buildDate = "2026-11-08"; }
        return i;
      });
    },
    "apc.params.list": function () { return clone(ORDER); },
    "apc.params.get": function (a) { return P[a.id] ? clone(P[a.id]) : null; },
    "apc.param.set": function (a) {
      var p = P[a.id]; if (!p) return null;
      var nv = coerce(p, a.value); if (nv === null) return { error: "invalid_value", message: "Invalid value for " + p.name };
      p.value = nv; pushParam(p); changed(); markDirty(); return { value: nv };
    },
    "apc.param.begin": function (a) { return P[a.id] ? { ok: true } : null; },
    "apc.param.end": function (a) { return P[a.id] ? { ok: true } : null; },
    "apc.param.reset": function (a) { var p = P[a.id]; if (!p) return null; p.value = p["default"]; pushParam(p); changed(); markDirty(); return { value: p.value }; },
    "apc.mod.set": function (a) {
      var p = P[a.id]; if (!p) return null;
      if (!a.route || !a.route.src) return { error: "invalid_route", message: "A modulation route needs a source." };
      var r = Object.assign({ amount: 0, polarity: "bipolar", min: p.min, max: p.max, bypass: false }, a.route), i;
      r.amount = clamp(Number(r.amount) || 0, -100, 100);
      for (i = 0; i < p.modulation.length; i++) if (p.modulation[i].src === r.src) { p.modulation[i] = r; pushParam(p); return { modulation: clone(p.modulation) }; }
      p.modulation.push(r); pushParam(p); return { modulation: clone(p.modulation) };
    },
    "apc.mod.remove": function (a) { var p = P[a.id]; if (!p) return null; p.modulation = p.modulation.filter(function (r) { return r.src !== a.src; }); pushParam(p); return { modulation: clone(p.modulation) }; },
    "apc.mod.clear": function (a) { var p = P[a.id]; if (!p) return null; p.modulation = []; pushParam(p); return { modulation: [] }; },
    "apc.midi.learn": function (a) { var p = P[a.id]; if (!p) return null; p.midiCc = 20 + ORDER.indexOf(p); return { id: p.id, cc: p.midiCc }; },
    "apc.midi.unlearn": function (a) { var p = P[a.id]; if (!p) return null; p.midiCc = null; return { id: p.id, cc: null }; },
    "apc.midi.table.get": function () {
      return { rows: ORDER.filter(function (p) { return !p.choices; }).map(function (p) {
        var m = midi[p.id]; return { id: p.id, name: p.name, unit: p.unit, cc: p.midiCc, min: m ? m.min : p.min, max: m ? m.max : p.max, pmin: p.min, pmax: p.max }; }) };
    },
    "apc.midi.table.set": function (a) {
      var rows = a && (a.rows || (a.id ? [a] : null)), i, r, p;
      if (!rows) return { error: "invalid", message: "No rows." };
      for (i = 0; i < rows.length; i++) {
        r = rows[i]; p = P[r.id];
        if (!p) return { error: "unknown_param", message: "Unknown parameter: " + r.id };
        if (r.cc !== null && r.cc !== undefined && r.cc !== "") { var cc = Number(r.cc); if (!(cc >= 0 && cc <= 127 && Math.floor(cc) === cc)) return { error: "invalid_cc", message: "CC must be a whole number from 0 to 127 (" + p.name + ")." }; }
      }
      rows.forEach(function (q) { var pp = P[q.id]; if (q.cc !== undefined) pp.midiCc = (q.cc === null || q.cc === "") ? null : Number(q.cc); midi[pp.id] = { min: q.min !== undefined ? Number(q.min) : pp.min, max: q.max !== undefined ? Number(q.max) : pp.max }; });
      return HOOK["apc.midi.table.get"]();
    }
  };
  /* preset functions: the mock owns the list / names / files, we add what the preset does to OUR parameters */
  ["apc.presets.load", "apc.presets.init", "apc.presets.revert"].forEach(function (name) {
    HOOK[name] = function (a) {
      return origCall.call(mock, name, a).then(function (res) {
        if (res && res.error) return res;
        if (name === "apc.presets.revert") { dirty = false; applyValues(base, false); mock.call("apc.presets.state", {}).then(function (st) { mock.emit("preset", { state: st }); }); }
        else afterLoad();
        return presetPatch(res);
      });
    };
  });
  HOOK["apc.presets.state"] = function (a) { return origCall.call(mock, "apc.presets.state", a).then(presetPatch); };
  HOOK["apc.presets.save"] = function (a) {
    return origCall.call(mock, "apc.presets.save", a).then(function (res) {
      if (res && !res.error) { base = snapshot(); dirty = false; mock.call("apc.presets.state", {}).then(function (st) { mock.emit("preset", { state: st }); }); }
      return res;
    });
  };
  HOOK["apc.presets.ab"] = function (a) {
    var action = a && a.action;
    return origCall.call(mock, "apc.presets.ab", a).then(function (res) {
      if (res && res.error) return res;
      var other = active === "A" ? "B" : "A";
      if (action === "toggle") {
        slots[active] = snapshot();
        if (!slots[other]) slots[other] = snapshot();
        active = other; applyValues(slots[active], false); markDirty();
      } else if (action === "copyAtoB") slots.B = slots.A = snapshot();
      else if (action === "copyBtoA") slots.A = slots.B || snapshot();
      return res;
    });
  };
  mock.call = function (name, args) {
    var h = HOOK[name];
    if (h) {
      try {
        var r = h(args || {});
        if (r === null) return origCall.call(mock, name, args);          /* not ours: the mock answers */
        return Promise.resolve(r).then(clone);
      } catch (e) { return Promise.reject(e); }
    }
    return origCall.call(mock, name, args);
  };
  base = snapshot();


  APC.refBackend = {
    params: P, order: ORDER, state: state,
    value: function (id) { return P[id].value; },
    index: function (id) { return idx(id); },
    onChange: function (fn) { listeners.push(fn); },
    fail: fail
  };
})();
