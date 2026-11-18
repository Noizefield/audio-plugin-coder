/* =============================================================================
   apc-mock.js — APC UI kit in-memory fake backend (classic script; extends window.APC)
   Implements EVERY bridge function and event of CONTRACT.md with realistic,
   deterministic (seedable) sample data. Used by the Hub gallery, the kit
   self-tests and `apc screenshot`. It is also the executable reference for what
   the native side must return (see .agents/guides/ui-kit-panels.md).

   Registers: APC.mock, and APC.bridge = APC.bridge || APC.mock (no native).
   Scenarios: APC.mock.scenario("demo"|"trial"|"licensed"|"unverified"|
              "update-available"|"update-failed"|"io-error")
   No network, no storage, no telemetry.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.mock) return;

  /* ---- PMX/1 vocabulary subset (slugs; must stay equal to schemas/pmx1-vocabulary.json —
          test/kit-b.test.js cross-checks it) ------------------------------------------ */
  var CATS = [
    ["pad", "Pad", "PD"], ["bass", "Bass", "BA"], ["lead", "Lead", "LD"], ["keys", "Keys", "KY"],
    ["bells", "Bells", "BE"], ["pluck", "Pluck", "PL"], ["impact", "Impact", "IM"],
    ["percussion", "Percussion", "DR"], ["drone", "Drone", "DN"], ["sfx", "SFX", "SC"], ["voice", "Voice", "VC"]
  ];
  var AXES = {
    bri: ["dark", "muted", "neutral", "bright", "brilliant"],
    war: ["cold", "cool", "neutral", "warm", "hot"],
    agg: ["gentle", "firm", "hard", "brutal"],
    wid: ["mono", "narrow", "wide", "ultra"],
    dep: ["thin", "mid", "deep", "sub-heavy"],
    mov: ["static", "breathing", "evolving", "chaotic"],
    rou: ["smooth", "textured", "gritty", "destroyed"],
    spa: ["dry", "room", "hall", "infinite"],
    met: ["harmonic", "inharmonic", "atonal"],
    den: ["sparse", "layered", "massive"]
  };
  var AXIS_KEYS = ["bri", "war", "agg", "wid", "dep", "mov"];
  var MOODS = ["dark", "ominous", "tense", "suspenseful", "epic", "triumphant", "aggressive", "dystopian", "cold",
    "mysterious", "melancholic", "warm", "nostalgic", "serene", "dreamy", "ethereal", "hopeful", "futuristic"];

  /* ---- tiny helpers -------------------------------------------------------- */
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function merge(dst, src) {
    var k;
    for (k in src) {
      if (isObj(src[k]) && isObj(dst[k])) merge(dst[k], src[k]);
      else dst[k] = clone(src[k]);
    }
    return dst;
  }
  function rngFrom(seed) {                       /* mulberry32 */
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lc(s) { return String(s === undefined || s === null ? "" : s).toLowerCase(); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  var ROOT = "/mock/AppData/Example Audio/Example Synth";

  /* ---- configuration (survives scenario(), reset by reset()) ------------------ */
  function defaultCfg() {
    return {
      seed: 1234, tickMs: 150, hierarchy: "typed", licenseMode: "online-activation", offline: false,
      checkFails: false, devRoot: null,
      features: { themeEnabled: true, helpMode: true, midiLearnTable: true, undoRedo: true, macros: false,
        dragModulation: true, oversampling: true, autoUpdateCheck: true },
      links: { company: "https://example.test/", product: "https://example.test/example-synth",
        docs: "https://example.test/manual", support: "https://example.test/support", update: "" },
      legal: { openSource: "Example Synth uses open-source components. (sample text)", eula: "End-user license agreement (sample text)." }
    };
  }
  var cfg = defaultCfg();
  var handlers = {};
  var timers = [];
  var calls = [];
  var S = null;                                   /* live state */

  /* ---- parameter model --------------------------------------------------------- */
  function P(id, name, unit, min, max, def, extra) {
    var p = { id: id, name: name, unit: unit, min: min, max: max, "default": def, value: def,
      help: { what: name + " — sample help.", effect: "Changes the sound in a way described once, here.", how: "Drag, scroll, or type a value." },
      group: "main", modulation: [], midiCc: null };
    var k; for (k in (extra || {})) p[k] = extra[k];
    return p;
  }
  function buildParams() {
    var ps = [
      P("cutoff_hz", "Cutoff", "Hz", 20, 20000, 1200, { skew: 0.3, group: "filter",
        help: { what: "Filter cutoff frequency.", effect: "Higher values let more high frequencies through.", how: "Drag up to open the filter." },
        modulation: [{ src: "lfo1", amount: 35, polarity: "bipolar", min: 200, max: 4000, bypass: false },
                     { src: "env1", amount: -20, polarity: "unipolar", min: 20, max: 20000, bypass: false }], midiCc: 74 }),
      P("resonance_pct", "Resonance", "%", 0, 100, 20, { group: "filter" }),
      P("drive_db", "Drive", "dB", 0, 24, 0, { group: "filter", modulation: [{ src: "lfo2", amount: 10, polarity: "unipolar", min: 0, max: 12, bypass: true }] }),
      P("attack_s", "Attack", "s", 0.001, 5, 0.005, { skew: 0.3, group: "env" }),
      P("release_s", "Release", "s", 0.005, 10, 0.4, { skew: 0.3, group: "env" }),
      P("osc_wave", "Waveform", "", 0, 3, 1, { choices: ["Sine", "Saw", "Square", "Triangle"], group: "osc", value: "Saw", "default": "Saw", step: 1 }),
      P("detune_ct", "Detune", "ct", -50, 50, 0, { group: "osc" }),
      P("mix_pct", "Mix", "%", 0, 100, 100, { group: "out" }),
      P("gain_db", "Gain", "dB", -24, 12, 0, { group: "out" }),
      P("lfo_rate_hz", "LFO Rate", "Hz", 0.05, 30, 2, { skew: 0.4, group: "mod" }),
      P("lfo_depth_pct", "LFO Depth", "%", 0, 100, 0, { group: "mod", modulation: [{ src: "wheel", amount: 100, polarity: "unipolar", min: 0, max: 100, bypass: false }] }),
      P("bypass", "Bypass", "", 0, 1, 0, { choices: ["Off", "On"], group: "out", value: "Off", "default": "Off", step: 1 })
    ];
    return ps;
  }
  function paramIndex(id) { for (var i = 0; i < S.params.length; i++) if (S.params[i].id === id) return i; return -1; }
  function getParam(id) { var i = paramIndex(id); return i < 0 ? null : S.params[i]; }
  function coerce(p, v) {
    if (p.choices) {
      if (typeof v === "number") return p.choices[clamp(Math.round(v), 0, p.choices.length - 1)];
      for (var i = 0; i < p.choices.length; i++) if (lc(p.choices[i]) === lc(v)) return p.choices[i];
      return null;
    }
    v = Number(v);
    if (!isFinite(v)) return null;
    return clamp(v, p.min, p.max);
  }
  function valuesSnapshot() { var o = {}; for (var i = 0; i < S.params.length; i++) o[S.params[i].id] = S.params[i].value; return o; }
  function applyValues(vals) {
    for (var i = 0; i < S.params.length; i++) {
      var p = S.params[i];
      p.value = vals && vals[p.id] !== undefined ? vals[p.id] : p["default"];
    }
  }
  function defaultsValues() { var o = {}; for (var i = 0; i < S.params.length; i++) o[S.params[i].id] = S.params[i]["default"]; return o; }
  function sameVals(a, b) { for (var k in a) if (a[k] !== b[k]) return false; return true; }
  /* deterministic per-preset parameter values: changes with the preset number only */
  function valuesFor(item) {
    var v = defaultsValues();
    v.cutoff_hz = Math.round(150 + ((item.n * 937) % 9000));
    v.resonance_pct = (item.n * 7) % 70;
    v.drive_db = (item.n * 3) % 18;
    v.mix_pct = 60 + (item.n * 11) % 41;
    return v;
  }

  /* ---- preset sample data -------------------------------------------------------- */
  var EMPTY_AX = [null, null, null, null, null, null];
  /* [kind, pack, name, cat, sub, moods, axes(bri,war,agg,wid,dep,mov), tags, genres, rating, fav, bpm, extra] */
  var SAMPLE = [
    ["sound", "Factory", "Sub Distort", "bass", "sub", ["dark", "aggressive"], ["muted", "warm", "hard", "mono", "sub-heavy", "breathing"], ["reese", "saturation"], ["dubstep"], 4, true, null],
    ["sound", "Factory", "Reese Tension", "bass", "reese", ["tense", "dark"], ["bright", "cool", "hard", "narrow", "deep", "evolving"], ["reese"], ["drum-and-bass"], 5, false, null],
    ["sound", "Factory", "Velvet Low", "bass", "analog", ["warm", "serene"], ["muted", "hot", "gentle", "wide", "deep", "static"], ["smooth"], ["ambient"], 3, false, null],
    ["sound", "Factory", "Black Hole", "bass", "sub", ["dark"], ["dark", "cold", "firm", "mono", "sub-heavy", "static"], ["sub"], ["dubstep"], 2, false, null],
    ["sound", "Factory", "Night Choir", "pad", "choir", ["dark", "mysterious"], ["muted", "cool", "gentle", "ultra", "mid", "evolving"], ["choir", "airy"], ["cinematic"], 4, false, null],
    ["sound", "Factory", "Glass Halo", "pad", "crystal", ["ethereal", "dreamy"], ["brilliant", "cool", "gentle", "ultra", "thin", "breathing"], ["glassy"], ["ambient"], 5, true, null],
    ["sound", "Factory", "Tape Keys", "keys", "e-piano", ["nostalgic", "warm"], ["neutral", "warm", "gentle", "narrow", "mid", "static"], ["vintage"], ["lo-fi"], 3, false, null],
    ["sound", "Factory", "Pluck Rain", "pluck", "harp", ["hopeful"], ["bright", "neutral", "firm", "wide", "thin", "static"], ["short"], ["ambient"], 3, false, null],
    ["kit", "Factory", "Heavy Impacts", "percussion", "drum", ["aggressive", "dark"], ["muted", "neutral", "brutal", "wide", "deep", "static"], ["hybrid"], ["drum-and-bass"], 4, false, null, { kit_type: "hybrid" }],
    ["kit", "Factory", "Glass Percussion", "percussion", "metallic", ["cold", "futuristic"], ["brilliant", "cold", "hard", "wide", "thin", "static"], ["glitch"], ["electro"], 2, false, null, { kit_type: "glitch" }],
    ["sequence", "Factory", "Halftime 174", "percussion", "drum", [], EMPTY_AX, ["halftime"], ["drum-and-bass"], 4, false, 174, { feel: "halftime" }],
    ["sequence", "Factory", "Slow Pulse 90", "percussion", "drum", [], EMPTY_AX, ["slow"], ["ambient"], 3, false, 90, { feel: "straight" }],
    ["patch", "Factory", "Dark Obsidian", "impact", "hit", ["dark", "aggressive"], ["dark", "cold", "brutal", "wide", "sub-heavy", "evolving"], ["cinematic"], ["drum-and-bass"], 5, true, null],
    ["patch", "Factory", "Ice Cathedral", "pad", "shimmer", ["ethereal", "cold"], ["brilliant", "cold", "gentle", "ultra", "thin", "breathing"], ["reverb-tail"], ["ambient"], 4, false, null],
    ["sound", "Expansion One", "Rust Lead", "lead", "aggressive", ["aggressive", "dystopian"], ["bright", "hot", "brutal", "wide", "mid", "chaotic"], ["distorted"], ["industrial"], 3, false, null],
    ["sound", "Expansion One", "Neon Lead", "lead", "sync", ["futuristic", "triumphant"], ["brilliant", "warm", "firm", "wide", "thin", "evolving"], ["sync"], ["synthwave"], 4, false, null],
    ["sound", "Expansion One", "Ritual Drone", "drone", "ritual", ["ominous", "dark"], ["dark", "cold", "hard", "narrow", "sub-heavy", "evolving"], ["dark-ambient"], ["ambient"], 3, false, null],
    ["sound", "Expansion One", "Riser Wash", "sfx", "riser", ["suspenseful", "tense"], ["bright", "neutral", "firm", "ultra", "thin", "evolving"], ["riser"], ["cinematic"], 2, false, null],
    ["kit", "Expansion One", "Tribal Hits", "percussion", "tribal", ["epic"], ["neutral", "warm", "hard", "wide", "deep", "static"], ["tribal"], ["world-tribal"], 4, false, null, { kit_type: "acoustic" }],
    ["sequence", "Expansion One", "Rolling 140", "percussion", "drum", [], EMPTY_AX, ["rolling"], ["techno"], 3, false, 140, { feel: "straight" }],
    ["patch", "Expansion One", "Broken Link", "bass", "growl", ["dark", "tense"], ["muted", "neutral", "hard", "narrow", "deep", "breathing"], ["growl"], ["dubstep"], 1, false, null, { missing: ["Sub Kick 02"] }],
    ["patch", "Expansion One", "Sunrise Pad", "pad", "analog", ["hopeful", "warm"], ["neutral", "warm", "gentle", "wide", "mid", "breathing"], ["analog"], ["synthwave"], 4, false, null],
    ["sound", "User", "Unknown Bass", "bass", "mono", ["dark"], EMPTY_AX, [], [], 0, false, null],
    ["sound", "User", "My Wobble", "bass", "wobble", ["aggressive"], ["neutral", null, null, null, null, null], ["wobble"], ["dubstep"], 3, false, null],
    ["sound", "User", "Test Lead", "lead", "solo", [], EMPTY_AX, [], [], 0, false, null],
    ["sound", "User", "Soft Keys", "keys", "organ", ["serene"], ["bright", "warm", "gentle", "wide", "mid", "static"], ["soft"], ["lo-fi"], 3, false, null],
    ["kit", "User", "My Kit", "percussion", "kick", [], EMPTY_AX, ["personal"], [], 0, false, null, { kit_type: "electronic" }],
    ["sequence", "User", "Fill Idea", "percussion", "drum", [], EMPTY_AX, [], ["house"], 0, false, 128, { feel: "swing" }],
    ["patch", "User", "Scratch 1", null, null, [], EMPTY_AX, [], [], 0, false, null],
    ["patch", "User", "Evening Song", "pad", "evolving", ["dreamy", "melancholic"], ["muted", "warm", "gentle", "wide", "mid", "evolving"], ["slow"], ["ambient"], 4, true, null]
  ];

  function makeItem(n, row, rnd) {
    var axes = {};
    for (var i = 0; i < 6; i++) if (row[6][i]) axes[AXIS_KEYS[i]] = row[6][i];
    var extra = row[12] || {};
    var meta = { category: row[3], subcategory: row[4], moods: row[5].slice(), tags: row[7].slice(), genre: row[8].slice(),
      axes: axes, desc: row[2] + " — sample " + (row[3] || "untagged") + " preset.", author: row[1] === "User" ? "You" : "Example Audio" };
    if (row[11]) meta.tempo_bpm = row[11];
    if (extra.kit_type) meta.kit_type = extra.kit_type;
    if (extra.feel) meta.feel = extra.feel;
    return { id: (row[0].slice(0, 3)) + "_" + ("0000" + n).slice(-4), n: n, kind: row[0], name: row[2], pack: row[1], meta: meta,
      rating: row[9], favorite: !!row[10], mtime: 1760000000 + n * 3600, uses: Math.floor(rnd() * 20), lastLoaded: 0,
      readOnly: row[1] !== "User", missing: extra.missing ? extra.missing.slice() : [] };
  }
  function buildItems(rnd) {
    var out = [];
    for (var i = 0; i < SAMPLE.length; i++) out.push(makeItem(i + 1, SAMPLE[i], rnd));
    return out;
  }

  /* ---- preset query (the reference semantics of apc.presets.list) ---------------- */
  var KIND_OF_SCOPE = { patch: "patch", patches: "patch", sound: "sound", sounds: "sound", kit: "kit", kits: "kit", sequence: "sequence", sequences: "sequence" };
  function toArr(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function axisPass(it, key, f) {
    var word = it.meta && it.meta.axes && it.meta.axes[key];
    if (!word) return false;                                   /* untagged never passes a strict axis */
    var order = AXES[key]; if (!order) return false;
    var have = order.indexOf(word), want = order.indexOf(f.word);
    if (have < 0 || want < 0) return false;
    if (f.op === "lte") return have <= want;
    if (f.op === "eq") return have === want;
    return have >= want;                                       /* gte (default) */
  }
  function matches(it, sc, fl, q) {
    var m = it.meta || {}, i, a;
    if (sc && sc !== "all" && sc !== "everything") {
      if (sc.indexOf("pack:") === 0) { if (it.pack !== sc.slice(5)) return false; }
      else if (KIND_OF_SCOPE[lc(sc)]) { if (it.kind !== KIND_OF_SCOPE[lc(sc)]) return false; }
    }
    if (fl) {
      a = toArr(fl.kind);     if (a.length && a.indexOf(it.kind) < 0) return false;
      a = toArr(fl.pack);     if (a.length && a.indexOf(it.pack) < 0) return false;
      a = toArr(fl.category); if (a.length && a.indexOf(m.category) < 0) return false;
      a = toArr(fl.mood);     if (a.length && !any(a, toArr(m.moods))) return false;           /* within a group: OR */
      a = toArr(fl.genre);    if (a.length && !any(a, toArr(m.genre))) return false;
      a = toArr(fl.tag);      if (a.length && !any(a, toArr(m.tags))) return false;
      if (fl.favorite && !it.favorite) return false;
      if (fl.minRating && !(it.rating >= fl.minRating)) return false;
      if (fl.axes) for (var k in fl.axes) { if (fl.axes[k] && !axisPass(it, k, fl.axes[k])) return false; }   /* across groups: AND */
    }
    if (q) {
      var hay = lc([it.name, m.subcategory, m.desc, m.category, m.author, toArr(m.tags).join(" "), toArr(m.moods).join(" ")].join(" "));
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function any(want, have) { for (var i = 0; i < want.length; i++) if (have.indexOf(want[i]) >= 0) return true; return false; }
  function cmpName(a, b) { var x = lc(a.name), y = lc(b.name); return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
  function sortItems(arr, mode) {
    var f;
    switch (lc(mode)) {
      case "type": f = function (a, b) { var x = (a.meta && a.meta.category) || "~", y = (b.meta && b.meta.category) || "~"; return x < y ? -1 : x > y ? 1 : cmpName(a, b); }; break;
      case "rating": f = function (a, b) { return (b.rating - a.rating) || cmpName(a, b); }; break;
      case "recent": f = function (a, b) { return (b.lastLoaded - a.lastLoaded) || (b.mtime - a.mtime) || cmpName(a, b); }; break;
      case "bpm": f = function (a, b) { var x = a.meta && a.meta.tempo_bpm, y = b.meta && b.meta.tempo_bpm;
        if (x && y) return (x - y) || cmpName(a, b); if (x) return -1; if (y) return 1; return cmpName(a, b); }; break;
      case "uses": case "most-used": case "mostused": f = function (a, b) { return (b.uses - a.uses) || cmpName(a, b); }; break;
      default: f = cmpName;
    }
    return arr.sort(f);
  }
  function view(it) {                                          /* what crosses the bridge */
    var o = { id: it.id, kind: cfg.hierarchy === "flat" ? "preset" : it.kind, name: it.name, pack: it.pack, meta: it.meta,
      rating: it.rating, favorite: it.favorite, mtime: it.mtime, uses: it.uses, lastLoaded: it.lastLoaded, readOnly: it.readOnly };
    if (it.missing && it.missing.length) o.missing = it.missing;
    return o;
  }

  /* ---- state ------------------------------------------------------------------------ */
  function defaultSettings() {
    return {
      schema: "apc-settings/1.0",
      ui: { theme: "follow-os", scale: 1.0, tooltips: true, tooltip_delay_ms: 400, preset_load: "confirm-if-dirty",
        wheel_target: "control", reset_animation: "glide", double_click: "reset", aspect_lock: true, auto_update_check: false },
      engine: { oversampling: 2, max_voices: 16 },
      presets: { recents: [], last_pack: null, last_preset: null, favorites: [], index_built_at: "2026-11-08T08:00:00Z" },
      license: { activated: false }
    };
  }
  var ENUMS = {
    "ui.theme": ["night", "day", "follow-os"], "ui.tooltip_delay_ms": [200, 400, 800, 1200], "ui.preset_load": ["instant", "confirm-if-dirty"],
    "ui.wheel_target": ["control", "panel"], "ui.reset_animation": ["snap", "glide"], "ui.double_click": ["reset", "value_entry"],
    "engine.oversampling": [1, 2, 4, 8], "engine.bounce_oversampling": [1, 2, 4, 8]
  };
  var ENGINE_FIELDS = [
    { key: "oversampling", label: "Oversampling", type: "enum", values: [1, 2, 4, 8], suffix: "×", "default": 1, latency: true },
    { key: "max_voices", label: "Max polyphony", type: "int", min: 1, max: 64, "default": 16 }
  ];
  function engineDefaults() { var o = {}; for (var i = 0; i < ENGINE_FIELDS.length; i++) o[ENGINE_FIELDS[i].key] = ENGINE_FIELDS[i]["default"]; return o; }

  function freshState() {
    var rnd = rngFrom(cfg.seed);
    var st = { rnd: rnd, params: null, items: null, clock: 0, ioError: false, failDownloads: 0, trialEnabled: false, trialDays: 27,
      cur: null, base: null, slots: { A: null, B: null }, active: "A", settings: defaultSettings(),
      engineInst: null, midi: null, nextCc: 20, lic: null, upd: null, indexBuiltAt: "2026-11-08T08:00:00Z", requestCode: null,
      factoryRestores: 0, scenarioName: "demo" };
    S = st;
    st.params = buildParams();
    st.items = buildItems(rnd);
    st.engineInst = merge(engineDefaults(), st.settings.engine);            /* new instance = machine defaults (X-08) */
    st.cur = { id: "init", name: "INIT", dirty: false, readOnly: true, kind: "preset", pack: "Factory", missing: [] };
    st.base = defaultsValues();
    st.lic = { state: "DEMO", name: null, daysLeft: null, seats: null };
    st.upd = { state: "Idle", current: "1.2.0", latest: null, notes: null, error: null, progress: 0, message: "", installerPath: null };
    return st;
  }

  /* ---- events / timers ----------------------------------------------------------------- */
  function emit(name, data) {
    var l = (handlers[name] || []).slice();
    for (var i = 0; i < l.length; i++) { try { l[i](clone(data)); } catch (e) { if (typeof console !== "undefined") console.error("[apc-mock] handler", name, e); } }
  }
  function later(fn) {
    var id = setTimeout(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); fn(); }, cfg.tickMs);
    timers.push(id);
    return id;
  }
  function clearTimers() { while (timers.length) clearTimeout(timers.pop()); }

  /* ---- license ------------------------------------------------------------------------------ */
  function licStatus() {
    var l = S.lic, m;
    /* short banner/badge text like the native LicenseStatus::message (the UI adds the plain-language explanation) */
    if (l.state === "LICENSED") m = "Licensed to " + l.name;
    else if (l.state === "TRIAL") m = "Trial: " + l.daysLeft + " days left";
    else if (l.state === "UNVERIFIED") m = "License not verified on this machine (hardware changed or file modified)";
    else m = "Demo: save and export are locked";
    var o = { state: l.state, mode: cfg.licenseMode, message: m };
    if (l.name) o.name = l.name;
    if (l.state === "TRIAL") o.daysLeft = l.daysLeft;
    if (l.seats) o.seats = l.seats;
    return o;
  }
  function setLic(state, name, seats) {
    S.lic = { state: state, name: name || null, daysLeft: state === "TRIAL" ? S.trialDays : null, seats: seats || null };
    S.settings.license.activated = state === "LICENSED";
    emit("license", { status: licStatus() });
  }
  function baseLic() { if (S.trialEnabled) setLic("TRIAL"); else setLic("DEMO"); }
  function gated(verb) {
    var s = S.lic.state;
    return (s === "DEMO" || s === "UNVERIFIED") ? { error: "gated", verb: verb, message: "Locked in Demo mode. Activate to use this." } : null;
  }
  function ioErr(path, what) {
    return { error: "io", path: path, message: "Could not " + what + " " + path + ": access is denied." };
  }

  /* ---- preset state ------------------------------------------------------------------------------ */
  function itemById(id) { for (var i = 0; i < S.items.length; i++) if (S.items[i].id === id) return S.items[i]; return null; }
  function presetState() {
    var c = S.cur;
    return { current: { id: c.id, name: c.name, dirty: c.dirty, readOnly: c.readOnly, kind: c.kind, pack: c.pack, missing: c.missing.slice() },
      ab: { active: S.active, hasB: !!S.slots[S.active === "A" ? "B" : "A"] }, loadBehavior: S.settings.ui.preset_load };
  }
  function pushAllParams() { for (var i = 0; i < S.params.length; i++) emit("param", { id: S.params[i].id, value: S.params[i].value }); }
  function pushPreset() { emit("preset", { state: presetState() }); }
  function recomputeDirty() {
    var d = !sameVals(valuesSnapshot(), S.base);
    if (d !== S.cur.dirty) { S.cur.dirty = d; pushPreset(); }
  }
  function slotSnap() { return { values: valuesSnapshot(), base: clone(S.base), cur: clone(S.cur) }; }
  function slotApply(s) { applyValues(s.values); S.base = clone(s.base); S.cur = clone(s.cur); }

  /* ---- update ------------------------------------------------------------------------------------------ */
  function setUpd(patch) {
    var k; for (k in patch) S.upd[k] = patch[k];
    emit("update", { state: clone(S.upd) });
  }
  var NOTES = "Version 1.3.0\n- New: sample factory pack\n- Fixed: preset browser sorting\n- Improved: oversampling latency report";

  /* ---- bridge functions ---------------------------------------------------------------------------------- */
  var F = {};
  F["apc.info"] = function () {
    return { product: "Example Synth", manufacturer: "Example Audio", version: "1.2.0", buildDate: "2026-11-07",
      juceVersion: "9.0.0", frameworkVersion: "APC UI kit 1", links: clone(cfg.links), legal: clone(cfg.legal),
      features: merge(merge({}, cfg.features), { licenseMode: cfg.licenseMode, presetHierarchy: cfg.hierarchy }),
      standards: { "ux.theme_enabled": cfg.features.themeEnabled, "ux.double_click": "reset", "ux.tooltips": true, "ux.tooltip_delay_ms": 400,
        "ux.preset_load": "confirm-if-dirty", "ux.wheel_target": "control", "ux.reset_animation": "glide" } };
  };
  F["apc.params.list"] = function () { return clone(S.params); };
  F["apc.params.get"] = function (a) { var p = getParam(a && a.id); return p ? clone(p) : { error: "unknown_param", message: "Unknown parameter: " + (a && a.id) }; };
  F["apc.param.set"] = function (a) {
    var p = getParam(a && a.id); if (!p) return { error: "unknown_param", message: "Unknown parameter: " + (a && a.id) };
    var v = coerce(p, a.value); if (v === null) return { error: "invalid_value", message: "Invalid value for " + p.name };
    p.value = v; emit("param", { id: p.id, value: v }); recomputeDirty(); return { value: v };
  };
  F["apc.param.begin"] = function (a) { return { ok: !!getParam(a && a.id) }; };
  F["apc.param.end"] = function (a) { return { ok: !!getParam(a && a.id) }; };
  F["apc.param.reset"] = function (a) {
    var p = getParam(a && a.id); if (!p) return { error: "unknown_param" };
    p.value = p["default"]; emit("param", { id: p.id, value: p.value }); recomputeDirty(); return { value: p.value };
  };
  F["apc.mod.set"] = function (a) {
    var p = getParam(a && a.id); if (!p || !a.route || !a.route.src) return { error: "invalid_route" };
    var r = merge({ amount: 0, polarity: "bipolar", min: p.min, max: p.max, bypass: false }, a.route);
    r.amount = clamp(Number(r.amount) || 0, -100, 100);
    for (var i = 0; i < p.modulation.length; i++) if (p.modulation[i].src === r.src) { p.modulation[i] = r; emit("param", { id: p.id, value: p.value }); return { modulation: clone(p.modulation) }; }
    p.modulation.push(r); emit("param", { id: p.id, value: p.value }); return { modulation: clone(p.modulation) };
  };
  F["apc.mod.remove"] = function (a) {
    var p = getParam(a && a.id); if (!p) return { error: "unknown_param" };
    p.modulation = p.modulation.filter(function (r) { return r.src !== a.src; }); return { modulation: clone(p.modulation) };
  };
  F["apc.mod.clear"] = function (a) { var p = getParam(a && a.id); if (!p) return { error: "unknown_param" }; p.modulation = []; return { modulation: [] }; };
  F["apc.midi.learn"] = function (a) {
    var p = getParam(a && a.id); if (!p) return { error: "unknown_param" };
    p.midiCc = S.nextCc++; return { id: p.id, cc: p.midiCc };
  };
  F["apc.midi.unlearn"] = function (a) { var p = getParam(a && a.id); if (!p) return { error: "unknown_param" }; p.midiCc = null; return { id: p.id, cc: null }; };
  F["apc.midi.table.get"] = function () {
    var rows = [];
    for (var i = 0; i < S.params.length; i++) {
      var p = S.params[i]; if (p.choices) continue;
      var m = S.midi && S.midi[p.id];
      rows.push({ id: p.id, name: p.name, unit: p.unit, cc: p.midiCc, min: m ? m.min : p.min, max: m ? m.max : p.max, pmin: p.min, pmax: p.max });
    }
    return { rows: rows };
  };
  F["apc.midi.table.set"] = function (a) {
    var rows = a && (a.rows || (a.id ? [a] : null)); if (!rows) return { error: "invalid", message: "No rows." };
    S.midi = S.midi || {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], p = getParam(r.id); if (!p) return { error: "unknown_param", message: "Unknown parameter: " + r.id };
      if (r.cc !== null && r.cc !== undefined) {
        var cc = Number(r.cc); if (!(cc >= 0 && cc <= 127 && Math.floor(cc) === cc)) return { error: "invalid_cc", message: "CC must be a whole number from 0 to 127 (" + p.name + ")." };
      }
    }
    for (i = 0; i < rows.length; i++) {
      var q = rows[i], pp = getParam(q.id);
      if (q.cc !== undefined) pp.midiCc = (q.cc === null || q.cc === "") ? null : Number(q.cc);
      S.midi[pp.id] = { min: q.min !== undefined ? Number(q.min) : pp.min, max: q.max !== undefined ? Number(q.max) : pp.max };
    }
    return F["apc.midi.table.get"]();
  };

  /* settings (machine-wide) */
  F["apc.settings.get"] = function () { return clone(S.settings); };
  F["apc.settings.set"] = function (a) {
    var patch = a && a.patch; if (!isObj(patch)) return { error: "invalid", message: "No patch." };
    if (S.ioError) return ioErr(ROOT + "/settings.json", "write");
    var sec, key;
    for (sec in patch) if (isObj(patch[sec])) for (key in patch[sec]) {
      var en = ENUMS[sec + "." + key];
      if (en && en.indexOf(patch[sec][key]) < 0) return { error: "invalid", message: "Invalid value for " + sec + "." + key + ": " + patch[sec][key] };
    }
    merge(S.settings, patch);
    S.settings.schema = "apc-settings/1.0";
    return clone(S.settings);
  };
  /* engine: per-instance (chunk) vs machine defaults (X-08) */
  function engineView() {
    return { values: clone(S.engineInst), defaults: engineDefaults(), fields: clone(ENGINE_FIELDS),
      scope: "chunk", latencySamples: 32 * (S.engineInst.oversampling || 1) };
  }
  F["apc.engine.get"] = function () { return engineView(); };
  F["apc.engine.set"] = function (a) {
    var patch = a && a.patch; if (!isObj(patch)) return { error: "invalid", message: "No patch." };
    for (var k in patch) {
      var en = ENUMS["engine." + k];
      if (en && en.indexOf(patch[k]) < 0) return { error: "invalid", message: "Invalid value for engine." + k + ": " + patch[k] };
    }
    merge(S.engineInst, patch);                           /* does NOT touch settings.engine (machine default) */
    return engineView();
  };

  /* presets */
  F["apc.presets.list"] = function (a) {
    a = a || {};
    var q = lc(a.search || "").slice(0, 64), out = [], i;
    for (i = 0; i < S.items.length; i++) if (matches(S.items[i], a.scope, a.filters, q)) out.push(S.items[i]);
    sortItems(out, a.sort || "name");
    var items = new Array(out.length);
    for (i = 0; i < out.length; i++) items[i] = view(out[i]);
    return { items: items, total: items.length, totalAll: S.items.length };
  };
  F["apc.presets.state"] = function () { return presetState(); };
  F["apc.presets.info"] = function () {
    var packs = {}, i, names = [];
    for (i = 0; i < S.items.length; i++) { var it = S.items[i]; if (!packs[it.pack]) { packs[it.pack] = { name: it.pack, readOnly: it.readOnly, count: 0 }; names.push(it.pack); } packs[it.pack].count++; }
    var list = names.map(function (n) { return packs[n]; });
    if (!packs.User) list.push({ name: "User", readOnly: false, count: 0 });
    return { root: ROOT + "/presets", assets: S.items.length, builtAt: S.indexBuiltAt, devRoot: cfg.devRoot, factoryInstall: "user-folder",
      hierarchy: cfg.hierarchy, packs: list, writablePacks: ["User", "_wip"] };
  };
  F["apc.presets.load"] = function (a) {
    var it = itemById(a && a.id); if (!it) return { error: "not_found", message: "Preset not found: " + (a && a.id) };
    if (S.ioError) return ioErr(ROOT + "/presets/" + it.pack + "/" + it.name + ".preset", "read");
    applyValues(valuesFor(it));
    S.base = valuesSnapshot();
    S.cur = { id: it.id, name: it.name, dirty: false, readOnly: it.readOnly, kind: cfg.hierarchy === "flat" ? "preset" : it.kind, pack: it.pack, missing: it.missing.slice() };
    it.uses++; it.lastLoaded = ++S.clock;
    S.settings.presets.last_preset = it.id; S.settings.presets.last_pack = it.pack;
    var rec = S.settings.presets.recents; rec = rec.filter(function (x) { return x !== it.id; }); rec.unshift(it.id); S.settings.presets.recents = rec.slice(0, 20);
    S.slots[S.active] = null;
    pushPreset(); pushAllParams();
    return presetState();
  };
  F["apc.presets.save"] = function (a) {
    a = a || {};
    var g = gated("PresetSave"); if (g) return g;
    var c = S.cur, it;
    if (!a.name) {                                          /* quick save = overwrite loaded file */
      it = itemById(c.id);
      if (!it || it.readOnly) return { error: "readonly", message: "Factory presets are read-only. Use Save As… to save a copy." };
      if (S.ioError) return ioErr(ROOT + "/presets/" + it.pack + "/" + it.name + ".preset", "write");
      it.mtime += 60; S.base = valuesSnapshot(); c.dirty = false; pushPreset();
      return { ok: true, id: it.id, state: presetState() };
    }
    var pack = a.pack || "User", name = String(a.name).replace(/[\/\\:*?"<>|]/g, "-").replace(/^\s+|\s+$/g, "") || "untitled";
    var path = ROOT + "/presets/" + pack + "/" + name + ".preset";
    if (S.ioError) return ioErr(path, "write");
    if (pack !== "User" && pack !== "_wip") return { error: "readonly", message: "Pack " + pack + " is read-only.", path: path };
    for (var i = 0; i < S.items.length; i++) if (S.items[i].pack === pack && S.items[i].name === name && S.items[i].kind === (a.kind || c.kind)) {
      if (!a.replace) return { error: "exists", message: "A preset named " + name + " already exists in " + pack + ".", path: path };
      S.items.splice(i, 1); break;
    }
    var n = S.items.length + 1000 + (++S.clock);
    var kind = cfg.hierarchy === "flat" ? "preset" : (a.kind || (c.kind === "preset" ? "patch" : c.kind) || "patch");
    var meta = merge({ category: null, subcategory: null, moods: [], tags: [], genre: [], axes: {}, desc: "", author: "You" }, a.meta || {});
    it = { id: "usr_" + ("0000" + n).slice(-4), n: n, kind: kind, name: name, pack: pack, meta: meta, rating: 0, favorite: false,
      mtime: 1760000000 + n * 3600, uses: 0, lastLoaded: ++S.clock, readOnly: false, missing: [] };
    S.items.push(it);
    S.base = valuesSnapshot();
    S.cur = { id: it.id, name: it.name, dirty: false, readOnly: false, kind: kind, pack: pack, missing: [] };
    pushPreset();
    return { ok: true, id: it.id, path: path, state: presetState() };
  };
  F["apc.presets.revert"] = function () {
    if (S.ioError && S.cur.id !== "init") return ioErr(ROOT + "/presets/" + S.cur.pack + "/" + S.cur.name + ".preset", "read");
    applyValues(S.base); S.cur.dirty = false; pushPreset(); pushAllParams(); return presetState();
  };
  F["apc.presets.init"] = function () {
    applyValues(defaultsValues()); S.base = valuesSnapshot();
    S.cur = { id: "init", name: "INIT", dirty: false, readOnly: true, kind: "preset", pack: "Factory", missing: [] };
    S.slots[S.active] = null; pushPreset(); pushAllParams(); return presetState();
  };
  F["apc.presets.rate"] = function (a) {
    var it = itemById(a && a.id); if (!it) return { error: "not_found" };
    var n = Math.round(Number(a.stars)); if (!(n >= 0 && n <= 5)) return { error: "invalid", message: "Stars must be 0 to 5." };
    if (S.ioError) return ioErr(ROOT + "/user-data.json", "write");
    it.rating = n; return { id: it.id, rating: n };
  };
  F["apc.presets.favorite"] = function (a) {
    var it = itemById(a && a.id); if (!it) return { error: "not_found" };
    if (S.ioError) return ioErr(ROOT + "/user-data.json", "write");
    it.favorite = !!a.on; return { id: it.id, favorite: it.favorite };
  };
  F["apc.presets.import"] = function (a) {
    var g = gated("PackInstall"); if (g) return g;
    var src = (a && (a.path || (a.name ? a.name : "dropped pack"))) || "";
    if (!src) return { error: "invalid", message: "Choose a pack file to import." };
    if (S.ioError) return ioErr(String(a.path || "pack file"), "read");
    var base = "Imported Pack", name = base, k = 2;
    function exists(n) { return S.items.some(function (x) { return x.pack === n; }); }
    while (exists(name)) name = base + " " + (k++);                   /* import never overwrites */
    var added = 0;
    for (var i = 0; i < 2; i++) {
      var n = S.items.length + 2000 + (++S.clock);
      S.items.push({ id: "imp_" + ("0000" + n).slice(-4), n: n, kind: "sound", name: "Imported " + (i + 1), pack: name,
        meta: { category: "pad", subcategory: "analog", moods: ["serene"], tags: [], genre: [], axes: {}, desc: "Imported sample.", author: "Import" },
        rating: 0, favorite: false, mtime: 1760000000 + n * 3600, uses: 0, lastLoaded: 0, readOnly: true, missing: [] });
      added++;
    }
    return { ok: true, imported: added, pack: name };
  };
  F["apc.presets.exportPack"] = function (a) {
    var g = gated("PackExport"); if (g) return g;
    var ids = (a && a.ids) || []; if (!ids.length) return { error: "invalid", message: "Nothing to export." };
    var path = "/mock/Exports/Example-Pack-" + ids.length + ".apcpack";
    if (S.ioError) return ioErr(path, "write");
    return { ok: true, path: path, count: ids.length };
  };
  F["apc.presets.ab"] = function (a) {
    var act = a && a.action, other = S.active === "A" ? "B" : "A", t;
    if (act === "toggle") {
      S.slots[S.active] = slotSnap();
      if (!S.slots[other]) S.slots[other] = slotSnap();             /* first toggle: B starts as a copy of A */
      slotApply(S.slots[other]); S.active = other;
    } else if (act === "copyAtoB" || act === "copyBtoA") {
      S.slots[S.active] = slotSnap();
      var from = act === "copyAtoB" ? "A" : "B", to = act === "copyAtoB" ? "B" : "A";
      if (!S.slots[from]) return { error: "empty", message: "Slot " + from + " is empty." };
      S.slots[to] = clone(S.slots[from]);
      if (S.active === to) slotApply(S.slots[to]);
    } else return { error: "invalid", message: "Unknown A/B action." };
    pushPreset(); pushAllParams();
    return presetState();
  };
  F["apc.presets.rescan"] = function () {
    if (S.ioError) return ioErr(ROOT + "/presets", "read");
    S.indexBuiltAt = "2026-11-08T09:00:00Z"; S.settings.presets.index_built_at = S.indexBuiltAt;
    return { ok: true, count: S.items.length, builtAt: S.indexBuiltAt };
  };
  F["apc.presets.openFolder"] = function () { return { ok: true, path: ROOT + "/presets" }; };
  F["apc.presets.restoreFactory"] = function () { S.factoryRestores++; return { ok: true, restored: 14, path: ROOT + "/presets/Factory" }; };

  /* license */
  F["apc.license.status"] = function () { return licStatus(); };
  F["apc.license.activate"] = function (a) {
    if (cfg.licenseMode !== "online-activation") return { error: "unsupported", message: "Online activation is not available in this product." };
    var serial = String((a && a.serial) || "").replace(/^\s+|\s+$/g, "").toUpperCase(), email = String((a && a.email) || "").replace(/^\s+|\s+$/g, "");
    if (!serial) return { error: "missing_serial", message: "Enter your serial number." };
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "invalid_email", message: "That email address does not look right." };
    if (cfg.offline) return { error: "network", message: "Could not reach the activation server. Check your connection, or use offline activation." };
    if (/^FULL-[A-Z0-9-]+$/.test(serial)) return { error: "seat_limit", message: "All seats for this license are in use." };
    if (/^TEST-0000-[A-Z0-9-]+$/.test(serial)) {
      setLic("LICENSED", email ? email.split("@")[0] : "Test Customer", 3);
      return { ok: true, status: licStatus() };
    }
    return { error: "invalid_serial", message: "That serial number was not recognized." };
  };
  F["apc.license.loadFile"] = function (a) {
    var text = a && a.text, j;
    if (S.ioError) return ioErr(ROOT + "/license.lic", "write");
    try { j = JSON.parse(String(text)); } catch (e) { return { error: "invalid_file", message: "That is not a license file (it could not be read)." }; }
    if (!j || j.schema !== "apc-license/1.0") return { error: "invalid_file", message: "That is not an Example Synth license file." };
    if (String(j.signature_ed25519 || "") === "TAMPERED") return { error: "unverified", message: "The license file failed verification and was not installed. Your current license state is unchanged." };
    if (String(j.signature_ed25519 || "").indexOf("TEST") !== 0) return { error: "invalid_file", message: "The license signature is not valid." };
    setLic("LICENSED", j.customer_name || "Licensed user", j.allowed_seats || 1);
    return { ok: true, status: licStatus() };
  };
  F["apc.license.deactivate"] = function () {
    if (S.lic.state !== "LICENSED" && S.lic.state !== "UNVERIFIED") return { error: "not_active", message: "This machine is not activated." };
    baseLic(); return { ok: true, status: licStatus() };
  };
  F["apc.license.offlineRequest"] = function () {
    if (cfg.licenseMode !== "online-activation") return { error: "unsupported", message: "Offline activation is not available in this product." };
    var r = S.rnd, hex = "0123456789ABCDEF", parts = [], i, j, s;
    for (i = 0; i < 4; i++) { s = ""; for (j = 0; j < 4; j++) s += hex.charAt(Math.floor(r() * 16)); parts.push(s); }
    S.requestCode = "APC-REQ-" + parts.join("-");
    return { requestCode: S.requestCode };
  };

  /* update */
  F["apc.update.state"] = function () { return clone(S.upd); };
  F["apc.update.check"] = function () {
    if (S.upd.state === "Checking" || S.upd.state === "Downloading" || S.upd.state === "Verifying") return clone(S.upd);
    setUpd({ state: "Checking", error: null, message: "Checking for updates…", progress: 0 });
    later(function () {
      if (cfg.checkFails) { setUpd({ state: "Failed", error: "Network", message: "Could not reach the update server. Check your connection and try again.", latest: null }); return; }
      if (S.scenarioName === "update-available" || S.scenarioName === "update-failed")
        setUpd({ state: "UpdateAvailable", latest: "1.3.0", notes: NOTES, error: null, message: "Version 1.3.0 is available." });
      else setUpd({ state: "UpToDate", latest: S.upd.current, notes: null, error: null, message: "You have the latest version." });
    });
    return clone(S.upd);
  };
  F["apc.update.download"] = function () {
    var st = S.upd.state;
    if (!(st === "UpdateAvailable" || (st === "Failed" && S.upd.latest))) return { error: "invalid_state", message: "No update is available to download." };
    setUpd({ state: "Downloading", progress: 0, error: null, message: "Downloading version " + S.upd.latest + "…" });
    var step = 0, steps = 5;
    (function tick() {
      later(function () {
        step++;
        if (S.failDownloads > 0 && step === 2) {
          S.failDownloads--;
          setUpd({ state: "Failed", error: "Download", message: "The download was interrupted. Nothing was installed. You can try again." });
          return;
        }
        if (step < steps) { setUpd({ progress: step / steps }); tick(); return; }
        setUpd({ state: "Verifying", progress: 1, message: "Verifying the download (signature and checksum)…" });
        later(function () {
          setUpd({ state: "ReadyToInstall", progress: 1, installerPath: "/mock/Updates/ExampleSynth-" + S.upd.latest + "-Setup.exe",
            message: "Version " + S.upd.latest + " is downloaded and verified. Close your DAW, then run the installer." });
        });
      });
    })();
    return clone(S.upd);
  };
  F["apc.update.cancel"] = function () {
    if (S.upd.state !== "Downloading" && S.upd.state !== "Verifying") return { error: "invalid_state", message: "Nothing to cancel." };
    clearTimers(); setUpd({ state: "UpdateAvailable", progress: 0, message: "Download cancelled." }); return clone(S.upd);
  };
  F["apc.update.revealInstaller"] = function () {
    if (S.upd.state !== "ReadyToInstall") return { error: "invalid_state", message: "There is no downloaded installer." };
    return { ok: true, path: S.upd.installerPath };
  };

  /* misc */
  F["apc.openUrl"] = function (a) {
    var url = a && a.url, ok = false, k;
    for (k in cfg.links) if (cfg.links[k] && cfg.links[k] === url) ok = true;
    return ok ? { ok: true } : { error: "not_allowed", message: "That link is not on the allow-list." };
  };
  F["apc.ui.setScale"] = function (a) {
    var s = Number(a && a.scale); if (!(s >= 0.5 && s <= 3)) return { error: "invalid", message: "Scale must be 50% to 300%." };
    S.settings.ui.scale = s; return { scale: s };
  };
  F["apc.ui.getPrefs"] = function () { return clone(S.settings.ui); };
  F["apc.diagnostics.copy"] = function () { return { text: "Example Synth 1.2.0\nlicense: " + S.lic.state + "\n(mock diagnostics — local only)" }; };

  /* ---- scenarios ---------------------------------------------------------------------------------------------------- */
  var SCENARIOS = {
    "demo": function () { S.trialEnabled = false; setLic("DEMO"); },
    "trial": function () { S.trialEnabled = true; setLic("TRIAL"); },
    "licensed": function () { setLic("LICENSED", "Test Customer", 3); },
    "unverified": function () { setLic("UNVERIFIED", "Test Customer", 3); },
    "update-available": function () { setLic("LICENSED", "Test Customer", 3); setUpd({ state: "UpdateAvailable", latest: "1.3.0", notes: NOTES, message: "Version 1.3.0 is available." }); },
    "update-failed": function () { S.failDownloads = 1; SCENARIOS["update-available"](); },
    "io-error": function () { setLic("LICENSED", "Test Customer", 3); S.ioError = true; }
  };

  /* ---- public API -------------------------------------------------------------------------------------------------------- */
  function call(name, args) {
    calls.push({ name: name, args: clone(args) });
    return new Promise(function (resolve, reject) {
      var fn = F[name];
      if (!fn) { resolve({ error: "unknown_function", message: "Unknown bridge function: " + name }); return; }
      try { resolve(clone(fn(args || {}))); } catch (e) { reject(e); }
    });
  }
  function on(name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    return function () { off(name, fn); };
  }
  function off(name, fn) { var l = handlers[name]; if (!l) return; var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }

  function build() { clearTimers(); freshState(); }
  var api = {
    call: call, on: on, off: off, emit: emit, functions: function () { return Object.keys(F); },
    scenario: function (name) {
      if (!SCENARIOS[name]) throw new Error("Unknown mock scenario: " + name + " (" + Object.keys(SCENARIOS).join(", ") + ")");
      build(); S.scenarioName = name; SCENARIOS[name]();
      emit("license", { status: licStatus() }); emit("update", { state: clone(S.upd) }); pushPreset();
      return name;
    },
    scenarios: function () { return Object.keys(SCENARIOS); },
    config: function (patch) { if (patch) { merge(cfg, patch); if (patch.seed !== undefined || patch.hierarchy !== undefined) { var n = S.scenarioName; api.scenario(n); } } return clone(cfg); },
    seed: function (n) { cfg.seed = n >>> 0; return api.scenario(S.scenarioName); },
    reset: function () { cfg = defaultCfg(); calls = []; return api.scenario("demo"); },
    /* simulate the plugin being opened again as a NEW instance: engine starts from the machine defaults (X-08) */
    newInstance: function () { S.engineInst = merge(engineDefaults(), S.settings.engine); return clone(S.engineInst); },
    /* append `n` deterministic generated presets to pack "Bulk" (for list-performance tests) */
    loadBank: function (n) {
      var r = rngFrom(cfg.seed + 7), kinds = ["sound", "sound", "sound", "kit", "sequence", "patch"], words = ["Amber", "Basalt", "Cobalt", "Dusk", "Ember", "Flint", "Gleam", "Haze", "Iron", "Jade", "Koi", "Lumen"], nouns = ["Pad", "Bass", "Lead", "Bell", "Drone", "Pulse", "Wash", "Stab"], i, k, ax, cat, base = S.items.length;
      for (i = 0; i < n; i++) {
        cat = CATS[Math.floor(r() * CATS.length)];
        ax = {}; if (r() < 0.7) for (k = 0; k < AXIS_KEYS.length; k++) ax[AXIS_KEYS[k]] = AXES[AXIS_KEYS[k]][Math.floor(r() * AXES[AXIS_KEYS[k]].length)];
        S.items.push({ id: "blk_" + (base + i), n: base + i + 1, kind: kinds[Math.floor(r() * kinds.length)],
          name: words[Math.floor(r() * words.length)] + " " + nouns[Math.floor(r() * nouns.length)] + " " + (i + 1), pack: "Bulk",
          meta: { category: cat[0], subcategory: null, moods: [MOODS[Math.floor(r() * MOODS.length)]], tags: [], genre: [], axes: ax, desc: "", author: "Bulk" },
          rating: Math.floor(r() * 6), favorite: r() < 0.05, mtime: 1760000000 + (base + i) * 60, uses: Math.floor(r() * 50), lastLoaded: 0, readOnly: true, missing: [] });
      }
      return S.items.length;
    },
    /* native -> JS events that have no function of their own: meter {id,value} and error {message,detail?,source} */
    meter: function (id, value) { emit("meter", { id: id, value: value }); },
    emitError: function (message, detail) { emit("error", { message: message, detail: detail, source: "mock" }); },
    calls: function (name) { return calls.filter(function (c) { return !name || c.name === name; }); },
    clearCalls: function () { calls = []; },
    state: function () { return { settings: clone(S.settings), engineInst: clone(S.engineInst), license: licStatus(), update: clone(S.upd), preset: presetState(), items: S.items.length, scenario: S.scenarioName }; },
    vocab: { categories: CATS, axes: AXES, moods: MOODS },
    version: 1
  };
  /* plain (non-promise) engine for deterministic synchronous stepping in tests */
  api.__queryItems = function (a) { return F["apc.presets.list"](a); };

  build();
  api.scenario("demo");
  APC.mock = api;
  if (!APC.bridge) APC.bridge = api;
})();
