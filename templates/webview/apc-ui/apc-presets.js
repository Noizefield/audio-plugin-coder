/* =============================================================================
   apc-presets.js — preset browser + header chip (scope, filters, search, sort, ratings, dirty/revert, A/B, save)
   Components: [data-apc="presets"] (browser), [data-apc="preset-chip"] (compact header chip that opens the browser).
   Classic script (no modules, no network). Contract: CONTRACT.md. Guide: .agents/guides/ui-kit-panels.md
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.presetsUI) return;
  var el = APC.dom.el;

  /* ---- shared kit-B helpers (identical copy in every kit-B file; first loaded wins) ---- */
  var KB = APC.__kb || (APC.__kb = (function () {
    var el = APC.dom.el, kb = {}, stack = [], bound = false, uid = 0;
    kb.el = el;
    kb.uid = function (p) { uid++; return (p || "apc-kb") + "-" + uid; };
    kb.call = function (name, args) {
      var b = APC.bridge;
      if (!b || !b.call) return Promise.resolve({ error: "no_bridge", message: "No backend is connected." });
      try {
        return Promise.resolve(b.call(name, args || {})).then(null, function (e) { return { error: "exception", message: (e && e.message) || String(e) }; });
      } catch (e) { return Promise.resolve({ error: "exception", message: String(e) }); }
    };
    kb.on = function (name, fn) {
      var b = APC.bridge;
      if (!b || !b.on) return function () {};
      var r = b.on(name, fn);
      return typeof r === "function" ? r : function () { if (b.off) b.off(name, fn); };
    };
    kb.isErr = function (r) { return !!(r && typeof r === "object" && !Array.isArray(r) && r.error); };
    kb.errText = function (r) {
      var m = r.message || String(r.error);
      if (r.path && String(m).indexOf(r.path) < 0) m += " (" + r.path + ")";
      return m;
    };
    kb.fail = function (r, source) {            /* visible error: the kit core turns every "error" event into a toast */
      APC.emit("error", { message: typeof r === "string" ? r : kb.errText(r), detail: r && r.error, source: source || "kit-b" });
    };
    kb.btn = function (label, onclick, cls, attrs) {
      var a = { type: "button", "class": "apc-kb-btn" + (cls ? " " + cls : ""), text: label, onclick: onclick }, k;
      for (k in (attrs || {})) a[k] = attrs[k];
      return el("button", a);
    };
    kb.visible = function (root) {
      return APC.dom.focusables(root).filter(function (n) { return n.getClientRects().length > 0 && !n.closest("[hidden]"); });
    };
    function onKey(e) {
      if (!stack.length) return;
      var top = stack[stack.length - 1];
      if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); e.stopPropagation(); top.close("esc"); return; }
      if (e.key === "Tab") {
        var f = kb.visible(top.panel), a = document.activeElement;
        if (!f.length) { e.preventDefault(); top.panel.focus(); return; }
        if (!top.panel.contains(a)) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && (a === f[0] || a === top.panel)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    /* modal sheet: backdrop + dialog, focus trap, Esc closes (top-most only), focus restored on close */
    kb.sheet = function (o) {
      o = o || {};
      var prev = document.activeElement, titleId = kb.uid("apc-kb-t"), closed = false, self = {};
      var closeBtn = el("button", { type: "button", "class": "apc-kb-sheet__x", "aria-label": "Close", text: "×", onclick: function () { self.close("button"); } });
      var title = el("h2", { "class": "apc-kb-sheet__title", id: titleId, text: o.title || "" });
      var head = el("div", { "class": "apc-kb-sheet__head" }, title, closeBtn);
      var body = el("div", { "class": "apc-kb-sheet__body" });
      var foot = el("div", { "class": "apc-kb-sheet__foot" });
      var panel = el("div", { "class": "apc-kb-sheet " + (o["class"] || ""), role: o.role || "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" }, head, body, o.noFoot ? null : foot);
      var root = el("div", { "class": "apc-kb-backdrop" }, panel);
      root.addEventListener("mousedown", function (e) { if (e.target === root && !o.modalOnly) self.close("backdrop"); });
      self.root = root; self.panel = panel; self.body = body; self.foot = foot; self.head = head; self.title = title;
      self.close = function (why) {
        if (closed) return; closed = true;
        var i = stack.indexOf(self); if (i >= 0) stack.splice(i, 1);
        if (root.parentNode) root.parentNode.removeChild(root);
        if (!stack.length && bound) { document.removeEventListener("keydown", onKey); bound = false; }
        if (prev && prev.focus && document.body.contains(prev)) { try { prev.focus(); } catch (e) {} }
        if (o.onClose) o.onClose(why);
      };
      document.body.appendChild(root);
      stack.push(self);
      if (!bound) { document.addEventListener("keydown", onKey); bound = true; }
      self.focusFirst = function () {
        var t = o.focus ? panel.querySelector(o.focus) : null;
        if (!t) { var f = kb.visible(body); t = f[0] || closeBtn; }
        t.focus();
      };
      return self;
    };
    kb.confirm = function (o) {
      return new Promise(function (resolve) {
        var done = false;
        function fin(v) { if (!done) { done = true; resolve(v); } sh.close("done"); }
        var sh = kb.sheet({ title: o.title || "Please confirm", role: "alertdialog", "class": "apc-kb-sheet--small", modalOnly: true, onClose: function () { if (!done) { done = true; resolve(false); } } });
        sh.body.appendChild(el("p", { "class": "apc-kb-note", text: o.message || "" }));
        sh.foot.appendChild(kb.btn(o.cancel || "Cancel", function () { fin(false); }, "", { "data-k": "cancel" }));
        sh.foot.appendChild(kb.btn(o.ok || "OK", function () { fin(true); }, o.danger ? "apc-kb-btn--danger" : "apc-kb-btn--primary", { "data-k": "ok" }));
        sh.panel.setAttribute("data-apc-confirm", "1");
        sh.focusFirst();
      });
    };
    kb.closeAll = function () { while (stack.length) stack[stack.length - 1].close("reset"); };
    kb.badgeText = function (s) {
      if (!s) return "";
      if (s.state === "TRIAL") return "TRIAL " + (s.daysLeft !== undefined && s.daysLeft !== null ? s.daysLeft + " d" : "");
      if (s.state === "LICENSED") return "LICENSED" + (s.name ? " to " + s.name : "");
      return s.state || "";
    };
    kb.openUrl = function (url) {
      return kb.call("apc.openUrl", { url: url }).then(function (r) { if (kb.isErr(r)) kb.fail(r, "link"); return r; });
    };
    kb.copyText = function (text, field) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fb(); });
      } catch (e) {}
      return Promise.resolve(fb());
      function fb() {
        try { if (field) { field.focus(); field.select(); } return !!document.execCommand("copy"); } catch (e) { return false; }
      }
    };
    return kb;
  })());

  /* ---- PMX/1 vocabulary (slugs; append-only; cross-checked against schemas/pmx1-vocabulary.json by test/kit-b.test.js) ---- */
  var CATS = [
    ["pad", "Pad", "PD"], ["bass", "Bass", "BA"], ["lead", "Lead", "LD"], ["keys", "Keys", "KY"], ["bells", "Bells", "BE"], ["pluck", "Pluck", "PL"],
    ["impact", "Impact", "IM"], ["percussion", "Percussion", "DR"], ["drone", "Drone", "DN"], ["sfx", "SFX", "SC"], ["voice", "Voice", "VC"],
    ["reverb", "Reverb", "RV"], ["delay", "Delay", "DL"], ["modulation", "Modulation", "MD"], ["dynamics", "Dynamics", "DY"], ["eq-filter", "EQ / Filter", "EQ"],
    ["distortion", "Distortion", "DS"], ["pitch", "Pitch", "PI"], ["utility", "Utility", "UT"], ["creative-fx", "Creative FX", "CF"]
  ];
  var AXES = [
    ["bri", "Brightness", ["dark", "muted", "neutral", "bright", "brilliant"]], ["war", "Warmth", ["cold", "cool", "neutral", "warm", "hot"]],
    ["agg", "Aggression", ["gentle", "firm", "hard", "brutal"]], ["wid", "Width", ["mono", "narrow", "wide", "ultra"]],
    ["dep", "Depth", ["thin", "mid", "deep", "sub-heavy"]], ["mov", "Movement", ["static", "breathing", "evolving", "chaotic"]],
    ["rou", "Roughness", ["smooth", "textured", "gritty", "destroyed"]], ["spa", "Space", ["dry", "room", "hall", "infinite"]],
    ["met", "Metallic", ["harmonic", "inharmonic", "atonal"]], ["den", "Density", ["sparse", "layered", "massive"]]
  ];
  var MOODS = ["dark", "ominous", "tense", "suspenseful", "epic", "triumphant", "aggressive", "dystopian", "cold", "mysterious", "melancholic", "warm",
    "nostalgic", "serene", "dreamy", "ethereal", "hopeful", "futuristic"];
  var GENRES = [["ambient", "Ambient"], ["cinematic", "Cinematic"], ["cyberpunk", "Cyberpunk"], ["drum-and-bass", "Drum & Bass"], ["dubstep", "Dubstep"], ["edm", "EDM"],
    ["electro", "Electro"], ["house", "House"], ["industrial", "Industrial"], ["lo-fi", "Lo-Fi"], ["synthwave", "Synthwave"], ["techno", "Techno"], ["trance", "Trance"],
    ["trap", "Trap"], ["world-tribal", "World / Tribal"]];
  var KINDS = [["patch", "Patches"], ["sound", "Sounds"], ["kit", "Kits"], ["sequence", "Sequences"]];
  var SORTS = [["name", "NAME"], ["type", "TYPE"], ["rating", "RATING"], ["recent", "RECENT"], ["bpm", "BPM"], ["uses", "MOST USED"]];
  var OPS = [["gte", "≥ at least"], ["lte", "≤ at most"], ["eq", "= exactly"]];
  var OP_SYM = { gte: "≥", lte: "≤", eq: "=" };
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function catInfo(slug) { for (var i = 0; i < CATS.length; i++) if (CATS[i][0] === slug) return CATS[i]; return null; }
  function labelOf(list, v) { for (var i = 0; i < list.length; i++) { var a = list[i]; if ((Array.isArray(a) ? a[0] : a) === v) return Array.isArray(a) ? a[1] : cap(a); } return v; }

  /* ---- shared flows (used by the browser and the header chip) ------------------------------------------------------ */
  function gatedOrFail(r, source) {
    if (r && r.error === "gated") {
      if (APC.__licenseUi) APC.emit("license:open", { verb: r.verb, reason: "gated" });
      else APC.toast.warn("This needs a license. Activate the plugin to use it.");
      return true;
    }
    KB.fail(r, source || "presets");
    return false;
  }
  function getState() {
    return KB.call("apc.presets.state").then(function (s) { if (KB.isErr(s)) { KB.fail(s, "presets"); return null; } return s; });
  }
  function loadWithConfirm(id, name) {
    return getState().then(function (ps) {
      function go() {
        return KB.call("apc.presets.load", { id: id }).then(function (r) {
          if (KB.isErr(r)) { KB.fail(r, "presets"); return false; }
          return true;
        });
      }
      if (ps && ps.current && ps.current.dirty && (ps.loadBehavior || "confirm-if-dirty") !== "instant") {
        return KB.confirm({ title: "Unsaved changes", message: "\"" + ps.current.name + "\" has unsaved changes. Load " + (name ? "\"" + name + "\"" : "this preset") + " and discard them?", ok: "Discard and load", cancel: "Keep editing", danger: true })
          .then(function (yes) { return yes ? go() : false; });
      }
      return go();
    });
  }
  function afterSave(r, label) {
    if (KB.isErr(r)) { gatedOrFail(r, "presets"); return false; }
    APC.toast.info("Saved \"" + (label || "preset") + "\".");
    APC.emit("presets:changed", { reason: "save", id: r.id });
    return true;
  }
  function quickSave() {
    return getState().then(function (ps) {
      if (!ps) return false;
      if (ps.current.readOnly || ps.current.id === "init") return saveAsSheet({ note: ps.current.id === "init" ? "" : "This preset is read-only, so your changes are saved as a copy." });
      return KB.call("apc.presets.save", {}).then(function (r) { return afterSave(r, ps.current.name); });
    });
  }
  function saveAsSheet(o) {
    o = o || {};
    return Promise.all([KB.call("apc.presets.state"), KB.call("apc.presets.info"), KB.call("apc.info")]).then(function (res) {
      var ps = res[0], pi = KB.isErr(res[1]) ? {} : res[1], inf = KB.isErr(res[2]) ? {} : res[2];
      var flat = (inf.features && inf.features.presetHierarchy) === "flat";
      var writable = (pi.writablePacks && pi.writablePacks.length) ? pi.writablePacks : ["User"];
      var done = false, sh;
      var name = el("input", { type: "text", "class": "apc-kb-input", id: KB.uid("apc-pb-n"), "data-k": "sa-name", maxlength: "64", value: (ps && ps.current && ps.current.id !== "init") ? ps.current.name + (ps.current.readOnly ? " copy" : "") : "" });
      var pack = el("select", { "class": "apc-kb-input", id: KB.uid("apc-pb-p"), "data-k": "sa-pack" });
      writable.forEach(function (p) { pack.appendChild(el("option", { value: p, text: p })); });
      var kind = el("select", { "class": "apc-kb-input", id: KB.uid("apc-pb-k"), "data-k": "sa-kind" });
      KINDS.forEach(function (k) { kind.appendChild(el("option", { value: k[0], text: k[1].replace(/s$/, "") })); });
      var cat = el("select", { "class": "apc-kb-input", id: KB.uid("apc-pb-c"), "data-k": "sa-category" });
      cat.appendChild(el("option", { value: "", text: "— none —" }));
      CATS.forEach(function (c) { cat.appendChild(el("option", { value: c[0], text: c[1] })); });
      var tags = el("input", { type: "text", "class": "apc-kb-input", id: KB.uid("apc-pb-t"), "data-k": "sa-tags", placeholder: "dark-ambient, reese (max 8)", spellcheck: "false" });
      var desc = el("textarea", { "class": "apc-kb-input", id: KB.uid("apc-pb-d"), rows: "2", "data-k": "sa-desc", maxlength: "200" });
      var moodBox = el("div", { "class": "apc-pb__moods", role: "group", "aria-label": "Moods (up to two)" });
      var moodIn = MOODS.map(function (m) {
        var cb = el("input", { type: "checkbox", value: m, "data-k": "sa-mood" });
        cb.addEventListener("change", function () { if (moodIn.filter(function (x) { return x.checked; }).length > 2) { cb.checked = false; err.textContent = "Choose at most two moods."; err.hidden = false; } });
        moodBox.appendChild(el("label", { "class": "apc-pb__mood" }, cb, " " + cap(m)));
        return cb;
      });
      var err = el("div", { "class": "apc-sx__err", role: "alert", hidden: true, "data-k": "sa-error" });
      var overwrite = KB.btn("Overwrite", function () { submit(true); }, "apc-kb-btn--danger", { hidden: true, "data-k": "sa-overwrite" });
      function field(lbl, ctrl) { return el("div", { "class": "apc-kb-field" }, el("label", { "for": ctrl.id, text: lbl }), ctrl); }
      function submit(replace) {
        var n = name.value.replace(/^\s+|\s+$/g, "");
        if (!n) { err.textContent = "Give the preset a name."; err.hidden = false; name.focus(); return; }
        var tg = tags.value.split(/[\s,]+/).filter(Boolean).map(function (t) { return t.toLowerCase().replace(/[^a-z0-9-]/g, "-"); });
        if (tg.length > 8) { err.textContent = "At most 8 tags."; err.hidden = false; return; }
        var meta = { category: cat.value || null, moods: moodIn.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }), tags: tg, desc: desc.value };
        var a = { name: n, pack: pack.value, meta: meta };
        if (!flat) a.kind = kind.value;
        if (replace) a.replace = true;
        KB.call("apc.presets.save", a).then(function (r) {
          if (KB.isErr(r)) {
            if (r.error === "gated") { done = true; sh.close("gated"); gatedOrFail(r); return; }
            if (r.error === "exists") { err.textContent = r.message + " Choose another name, or overwrite it."; err.hidden = false; overwrite.hidden = false; return; }
            err.textContent = KB.errText(r); err.hidden = false; KB.fail(r, "presets"); return;
          }
          done = true; sh.close("saved"); afterSave(r, n);
        });
      }
      sh = KB.sheet({ title: "Save preset as…", "class": "apc-pb-sheet", focus: "[data-k=sa-name]" });
      if (o.note) sh.body.appendChild(el("p", { "class": "apc-kb-note", text: o.note }));
      sh.body.appendChild(field("Name", name)); sh.body.appendChild(field("Pack", pack));
      if (!flat) sh.body.appendChild(field("Type", kind));
      sh.body.appendChild(field("Category", cat));
      sh.body.appendChild(el("div", { "class": "apc-kb-field" }, el("span", { "class": "apc-sx__label", text: "Moods" }), moodBox));
      sh.body.appendChild(field("Tags", tags)); sh.body.appendChild(field("Description", desc)); sh.body.appendChild(err);
      sh.foot.appendChild(KB.btn("Cancel", function () { sh.close("cancel"); }, "", { "data-k": "sa-cancel" }));
      sh.foot.appendChild(overwrite);
      sh.foot.appendChild(KB.btn("Save", function () { submit(false); }, "apc-kb-btn--primary", { "data-k": "sa-save" }));
      name.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(false); });
      sh.focusFirst();
      return sh;
    });
  }

  /* Ctrl/Cmd+S accelerator (the visible Save button is the real control, X-09). One listener for all mounted components. */
  var accelUsers = 0;
  function onAccel(e) {
    if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== "s") return;
    e.preventDefault();
    if (e.shiftKey) saveAsSheet({}); else quickSave();
  }
  function accelOn() { if (accelUsers++ === 0) document.addEventListener("keydown", onAccel); return function () { if (--accelUsers === 0) document.removeEventListener("keydown", onAccel); }; }

  /* ---- preset browser -------------------------------------------------------------------------------------------------- */
  function emptyFilters() { return { kind: [], pack: [], category: [], mood: [], genre: [], tag: [], axes: {}, favorite: false, minRating: 0 }; }

  function createBrowser(host, opts) {
    opts = opts || {};
    var disposed = false, offs = [], timers = [], info = {}, flat = false, packs = [], pstate = null, writableKnown = false;
    var scope = "all", search = "", sortKey = "name", filters = emptyFilters(), items = [], total = 0, totalAll = 0, cursor = 0, rowH = 0, seq = 0, openPop = null, lastRender = 0;
    var hideCats = opts.hideCategories ? String(opts.hideCategories).split(",") : [];
    var onlyCats = opts.categories ? String(opts.categories).split(",") : null;
    var root = el("div", { "class": "apc-pb", "data-k": "browser" });
    host.appendChild(root);

    /* -- top bar -- */
    var scopeBar = el("div", { "class": "apc-pb__scopes", role: "radiogroup", "aria-label": "Scope" });
    var searchIn = el("input", { type: "search", "class": "apc-kb-input apc-pb__search", "aria-label": "Search presets", placeholder: "Search name, tags, mood…", maxlength: "64", "data-k": "search", spellcheck: "false" });
    var sortSel = el("select", { "class": "apc-kb-input apc-pb__sort", "aria-label": "Sort by", "data-k": "sort" });
    SORTS.forEach(function (s) { sortSel.appendChild(el("option", { value: s[0], text: s[1] })); });
    var top = el("div", { "class": "apc-pb__top" }, scopeBar, searchIn, sortSel);

    /* -- actions + current preset -- */
    var curName = el("span", { "class": "apc-pb__curname", "data-k": "current" });
    var curDirty = el("span", { "class": "apc-pb__dirty", "data-k": "dirty", "aria-label": "unsaved changes", hidden: true, text: "*" });
    var curMissing = el("span", { "class": "apc-pb__missing", "data-k": "missing" });
    var cur = el("div", { "class": "apc-pb__cur", "aria-live": "polite" }, curName, curDirty, curMissing);
    var bSave = KB.btn("Save", function () { quickSave(); }, "apc-kb-btn--primary", { "data-k": "save", title: "Save (Ctrl/Cmd+S)" });
    var bSaveAs = KB.btn("Save As…", function () { saveAsSheet({}); }, "", { "data-k": "save-as" });
    var bRevert = KB.btn("Revert", function () { KB.call("apc.presets.revert").then(function (r) { if (KB.isErr(r)) KB.fail(r, "presets"); }); }, "", { "data-k": "revert" });
    var bInit = KB.btn("Init", function () {
      getState().then(function (ps) {
        if (ps && ps.current.dirty && (ps.loadBehavior || "confirm-if-dirty") !== "instant")
          return KB.confirm({ title: "Unsaved changes", message: "Reset to the INIT sound and discard the unsaved changes to \"" + ps.current.name + "\"?", ok: "Discard and init", cancel: "Keep editing", danger: true }).then(function (y) { return y; });
        return true;
      }).then(function (go) { if (go) KB.call("apc.presets.init").then(function (r) { if (KB.isErr(r)) KB.fail(r, "presets"); }); });
    }, "", { "data-k": "init" });
    var bAB = KB.btn("A/B", function () { KB.call("apc.presets.ab", { action: "toggle" }).then(function (r) { if (KB.isErr(r)) KB.fail(r, "presets"); else setState(r); }); }, "", { "data-k": "ab", "aria-pressed": "false", title: "Switch between A and B" });
    var bCopy = KB.btn("Copy A→B", function () {
      KB.call("apc.presets.ab", { action: pstate && pstate.ab && pstate.ab.active === "B" ? "copyBtoA" : "copyAtoB" }).then(function (r) { if (KB.isErr(r)) KB.fail(r, "presets"); else setState(r); });
    }, "", { "data-k": "ab-copy" });
    var bImport = KB.btn("Import…", function () { importSheet(); }, "", { "data-k": "import" });
    var bExport = KB.btn("Export…", function () { exportFlow(); }, "", { "data-k": "export" });
    var actions = el("div", { "class": "apc-pb__actions", role: "toolbar", "aria-label": "Preset actions" }, cur, bSave, bSaveAs, bRevert, bInit, bAB, bCopy, bImport, bExport);

    /* -- filters -- */
    var filterBar = el("div", { "class": "apc-pb__filters", role: "group", "aria-label": "Filters", "data-k": "filters" });
    /* -- list -- */
    var sizer = el("div", { "class": "apc-pb__sizer" });
    var list = el("div", { "class": "apc-pb__list", role: "listbox", tabindex: "0", "aria-label": "Presets", "data-k": "list" }, sizer);
    var foot = el("div", { "class": "apc-pb__foot" }, el("span", { "class": "apc-pb__count", "data-k": "count", "aria-live": "polite" }), el("span", { "class": "apc-pb__desc", "data-k": "desc" }));
    var countEl = foot.firstChild, descEl = foot.lastChild;
    root.appendChild(top); root.appendChild(actions); root.appendChild(filterBar); root.appendChild(list); root.appendChild(foot);

    function later(fn, ms) { var t = setTimeout(function () { var i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; }

    /* -- scope bar -- */
    function scopeDefs() {
      var d = [["all", "Everything"]];
      if (!flat) KINDS.forEach(function (k) { d.push([k[0], k[1]]); });
      packs.forEach(function (p) { d.push(["pack:" + p, p]); });
      return d;
    }
    function drawScopes() {
      APC.dom.clear(scopeBar);
      scopeDefs().forEach(function (s) {
        var b = el("button", { type: "button", role: "radio", "class": "apc-pb__scope", "data-scope": s[0], "aria-checked": scope === s[0] ? "true" : "false", tabindex: scope === s[0] ? "0" : "-1", text: s[1] });
        b.addEventListener("click", function () { scope = s[0]; cursor = 0; drawScopes(); refresh(); });
        b.addEventListener("keydown", function (e) {
          var defs = scopeDefs(), i = -1, n; defs.forEach(function (x, k) { if (x[0] === scope) i = k; });
          if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % defs.length; else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + defs.length) % defs.length; else return;
          e.preventDefault(); scope = defs[n][0]; cursor = 0; drawScopes(); refresh();
          var nb = scopeBar.querySelector("[data-scope=\"" + scope + "\"]"); if (nb) nb.focus();
        });
        scopeBar.appendChild(b);
      });
    }

    /* -- filter groups (OR within a group, AND across groups, explicit ANY; popups, no blind cycling) -- */
    function catOptions() {
      return CATS.filter(function (c) { return hideCats.indexOf(c[0]) < 0 && (!onlyCats || onlyCats.indexOf(c[0]) >= 0); }).map(function (c) { return [c[0], c[1]]; });
    }
    function groupDefs() {
      var g = [];
      if (!flat) g.push({ id: "kind", label: "Kind", type: "multi", options: KINDS });
      g.push({ id: "pack", label: "Pack", type: "multi", options: packs.map(function (p) { return [p, p]; }) });
      g.push({ id: "category", label: "Category", type: "multi", options: catOptions() });
      g.push({ id: "mood", label: "Mood", type: "multi", options: MOODS.map(function (m) { return [m, cap(m)]; }) });
      g.push({ id: "genre", label: "Genre", type: "multi", options: GENRES });
      g.push({ id: "tag", label: "Tag", type: "tags" });
      AXES.forEach(function (a) { g.push({ id: "axis:" + a[0], label: a[1], type: "axis", key: a[0], words: a[2] }); });
      g.push({ id: "minRating", label: "Rating", type: "single", options: [[0, "ANY"], [1, "1 star +"], [2, "2 stars +"], [3, "3 stars +"], [4, "4 stars +"], [5, "5 stars"]] });
      g.push({ id: "favorite", label: "Favorite", type: "single", options: [[0, "ANY"], [1, "Favorites only"]] });
      return g;
    }
    function describe(g) {
      var v;
      if (g.type === "axis") { v = filters.axes[g.key]; return v ? OP_SYM[v.op] + " " + v.word : "ANY"; }
      if (g.id === "minRating") return filters.minRating ? filters.minRating + (filters.minRating < 5 ? "+ stars" : " stars") : "ANY";
      if (g.id === "favorite") return filters.favorite ? "Yes" : "ANY";
      v = filters[g.id];
      if (!v.length) return "ANY";
      if (v.length === 1) return g.options ? labelOf(g.options, v[0]) : v[0];
      return v.length + " selected";
    }
    function isActive(g) {
      if (g.type === "axis") return !!filters.axes[g.key];
      if (g.id === "minRating") return !!filters.minRating;
      if (g.id === "favorite") return filters.favorite;
      return filters[g.id].length > 0;
    }
    function activeCount() { return groupDefs().filter(isActive).length; }
    var groupBtns = {};
    function drawFilters() {
      closePop();
      APC.dom.clear(filterBar); groupBtns = {};
      groupDefs().forEach(function (g) {
        var b = el("button", { type: "button", "class": "apc-pb__fg", "data-group": g.id, "aria-haspopup": "dialog", "aria-expanded": "false" });
        b.addEventListener("click", function () { if (openPop && openPop.group === g.id) closePop(); else openPopup(g, b); });
        groupBtns[g.id] = { g: g, b: b };
        filterBar.appendChild(b);
      });
      filterBar.appendChild(KB.btn("Clear filters", function () { filters = emptyFilters(); syncGroupBtns(); refresh(); }, "apc-pb__clear", { "data-k": "clear-filters" }));
      syncGroupBtns();
    }
    function syncGroupBtns() {
      var id;
      for (id in groupBtns) {
        var g = groupBtns[id].g, b = groupBtns[id].b;
        b.textContent = g.label.toUpperCase() + ": " + describe(g);
        b.classList.toggle("is-active", isActive(g));
        b.setAttribute("aria-label", g.label + " filter: " + describe(g));
      }
      var c = filterBar.querySelector("[data-k=clear-filters]"); if (c) c.disabled = activeCount() === 0;
    }
    function changed() { syncGroupBtns(); cursor = 0; refresh(); }

    function closePop(focusAnchor) {
      if (!openPop) return;
      var p = openPop; openPop = null;
      document.removeEventListener("mousedown", p.outside, true);
      if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
      p.btn.setAttribute("aria-expanded", "false");
      if (focusAnchor) p.btn.focus();
    }
    function openPopup(g, btn) {
      closePop();
      var pop = el("div", { "class": "apc-pb__pop", role: "dialog", "aria-label": g.label + " filter", "data-popup": g.id });
      var body = el("div", { "class": "apc-pb__opts" });
      pop.appendChild(body);
      var uid = KB.uid("apc-pb-o");
      function sync() { buildBody(); syncGroupBtns(); }
      function buildBody() {
        APC.dom.clear(body);
        var anyOn = !isActive(g);
        function opt(type, name, value, label, checked, onchange, k) {
          var inp = el("input", { type: type, name: name, value: String(value), "data-v": String(value) });
          inp.checked = checked;
          inp.addEventListener("change", onchange);
          body.appendChild(el("label", { "class": "apc-pb__opt" + (k ? " " + k : "") }, inp, " " + label));
          return inp;
        }
        if (g.type === "multi") {
          opt("checkbox", uid, "__any", "ANY", anyOn, function () { filters[g.id] = []; changed(); sync(); }, "apc-pb__opt--any");
          g.options.forEach(function (o) {
            opt("checkbox", uid, o[0], o[1], filters[g.id].indexOf(o[0]) >= 0, function (e) {
              var a = filters[g.id], i = a.indexOf(o[0]);
              if (e.target.checked && i < 0) a.push(o[0]); else if (!e.target.checked && i >= 0) a.splice(i, 1);
              changed(); sync();
            });
          });
        } else if (g.type === "tags") {
          opt("checkbox", uid, "__any", "ANY", anyOn, function () { filters.tag = []; changed(); sync(); }, "apc-pb__opt--any");
          filters.tag.forEach(function (t) { opt("checkbox", uid, t, t, true, function () { filters.tag.splice(filters.tag.indexOf(t), 1); changed(); sync(); }); });
          var ti = el("input", { type: "text", "class": "apc-kb-input", "aria-label": "Add tag", "data-k": "tag-input", placeholder: "add tag + Enter", spellcheck: "false" });
          ti.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            var t = ti.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
            if (t && filters.tag.indexOf(t) < 0) { filters.tag.push(t); changed(); sync(); var n = body.querySelector("[data-k=tag-input]"); if (n) n.focus(); }
          });
          body.appendChild(ti);
        } else if (g.type === "axis") {
          var cu = filters.axes[g.key], op = cu ? cu.op : "gte";
          body.appendChild(el("div", { "class": "apc-pb__ops", role: "radiogroup", "aria-label": "Comparison" }));
          var opsBox = body.lastChild;
          OPS.forEach(function (o) {
            var r = el("input", { type: "radio", name: uid + "-op", value: o[0], "data-op": o[0] }); r.checked = op === o[0];
            r.addEventListener("change", function () { op = o[0]; if (filters.axes[g.key]) { filters.axes[g.key].op = op; changed(); sync(); } });
            opsBox.appendChild(el("label", { "class": "apc-pb__opt" }, r, " " + o[1]));
          });
          opt("radio", uid + "-w", "__any", "ANY", anyOn, function () { delete filters.axes[g.key]; changed(); sync(); }, "apc-pb__opt--any");
          g.words.forEach(function (w) {
            opt("radio", uid + "-w", w, w, !!cu && cu.word === w, function () { filters.axes[g.key] = { op: op, word: w }; changed(); sync(); });
          });
        } else {
          g.options.forEach(function (o) {
            var on = g.id === "minRating" ? filters.minRating === o[0] : (filters.favorite ? 1 : 0) === o[0];
            opt("radio", uid, o[0], o[1], on, function () {
              if (g.id === "minRating") filters.minRating = o[0]; else filters.favorite = !!o[0];
              changed(); sync();
            }, o[0] === 0 ? "apc-pb__opt--any" : "");
          });
        }
      }
      buildBody();
      pop.addEventListener("keydown", function (e) { if (e.key === "Escape" || e.key === "Esc") { e.preventDefault(); e.stopPropagation(); closePop(true); } });
      var outside = function (e) { if (!pop.contains(e.target) && e.target !== btn) closePop(); };
      document.addEventListener("mousedown", outside, true);
      root.appendChild(pop);
      var rb = root.getBoundingClientRect(), bb = btn.getBoundingClientRect();
      pop.style.left = Math.max(0, bb.left - rb.left) + "px"; pop.style.top = Math.max(0, bb.bottom - rb.top) + "px";
      btn.setAttribute("aria-expanded", "true");
      openPop = { group: g.id, el: pop, btn: btn, outside: outside };
      var f = pop.querySelector("input"); if (f) f.focus();
    }

    /* -- query -- */
    function spec() {
      var f = {}, k;
      ["kind", "pack", "category", "mood", "genre", "tag"].forEach(function (id) { if (filters[id].length) f[id] = filters[id].slice(); });
      var ax = {}, any = false;
      for (k in filters.axes) { ax[k] = { op: filters.axes[k].op, word: filters.axes[k].word }; any = true; }
      if (any) f.axes = ax;
      if (filters.favorite) f.favorite = true;
      if (filters.minRating) f.minRating = filters.minRating;
      return { scope: scope, filters: f, search: search, sort: sortKey };
    }
    function refresh() {
      var my = ++seq;
      return KB.call("apc.presets.list", spec()).then(function (r) {
        if (disposed || my !== seq) return;
        if (KB.isErr(r)) { KB.fail(r, "presets"); items = []; total = 0; }
        else { items = r.items || []; total = r.total !== undefined ? r.total : items.length; totalAll = r.totalAll !== undefined ? r.totalAll : total; }
        if (cursor >= items.length) cursor = Math.max(0, items.length - 1);
        renderList(true);
      });
    }

    /* -- virtual list -- */
    function measure() {
      var probe = el("div", { "class": "apc-pb__row apc-pb__row--probe", "aria-hidden": "true", style: "position:relative;visibility:hidden" }, el("span", { text: "Mg" }));
      sizer.appendChild(probe); var h = probe.offsetHeight; sizer.removeChild(probe);
      return h > 4 ? h : 24;
    }
    function rowEl(it, idx) {
      var ci = it.meta && it.meta.category ? catInfo(it.meta.category) : null;
      var isCur = pstate && pstate.current && pstate.current.id === it.id;
      var r = el("div", { "class": "apc-pb__row" + (isCur ? " is-current" : "") + (idx === cursor ? " is-cursor" : ""), role: "option", id: uid + "-" + idx,
        "data-id": it.id, "data-index": idx, "aria-selected": isCur ? "true" : "false", "aria-posinset": idx + 1, "aria-setsize": items.length, style: "top:" + (idx * rowH) + "px;height:" + rowH + "px" });
      r.appendChild(el("span", { "class": "apc-pb__code", title: ci ? ci[1] : "No category", text: ci ? ci[2] : "--" }));
      var nm = el("span", { "class": "apc-pb__name" }, it.name);
      if (isCur && pstate.current.dirty) nm.appendChild(el("span", { "class": "apc-pb__dirty", text: "*" }));
      if (it.missing && it.missing.length) nm.appendChild(el("span", { "class": "apc-pb__missing", text: it.missing.map(function (m) { return " [Missing: " + m + "]"; }).join("") }));
      r.appendChild(nm);
      var sub = (flat ? "" : (it.kind + " · ")) + it.pack + (it.meta && it.meta.subcategory ? " · " + it.meta.subcategory : "") + (it.meta && it.meta.tempo_bpm ? " · " + it.meta.tempo_bpm + " BPM" : "");
      r.appendChild(el("span", { "class": "apc-pb__sub", text: sub }));
      var stars = el("span", { "class": "apc-pb__stars", role: "group", "aria-label": "Rating " + it.rating + " of 5" });
      for (var s = 1; s <= 5; s++) stars.appendChild(el("button", { type: "button", tabindex: "-1", "class": "apc-pb__star" + (s <= it.rating ? " is-on" : ""), "data-star": s, "aria-label": "Rate " + it.name + " " + s + (s === 1 ? " star" : " stars"), text: s <= it.rating ? "★" : "☆" }));
      r.appendChild(stars);
      r.appendChild(el("button", { type: "button", tabindex: "-1", "class": "apc-pb__fav" + (it.favorite ? " is-on" : ""), "data-fav": "1", "aria-pressed": it.favorite ? "true" : "false", "aria-label": (it.favorite ? "Remove " : "Add ") + it.name + (it.favorite ? " from favorites" : " to favorites"), text: it.favorite ? "♥" : "♡" }));
      return r;
    }
    var uid = KB.uid("apc-pb-row");
    function renderList(reset) {
      var t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
      if (!rowH || reset === "remeasure") rowH = measure();
      sizer.style.height = (items.length * rowH) + "px";
      var vh = list.clientHeight || 320, st = list.scrollTop;
      var start = Math.max(0, Math.floor(st / rowH) - 4), end = Math.min(items.length, Math.ceil((st + vh) / rowH) + 4);
      if (end - start > 120) end = start + 120;
      APC.dom.clear(sizer);
      var frag = document.createDocumentFragment();
      for (var i = start; i < end; i++) frag.appendChild(rowEl(items[i], i));
      sizer.appendChild(frag);
      countEl.textContent = items.length === 0 ? "No presets match." : (total + (totalAll && totalAll !== total ? " of " + totalAll : "") + " preset" + (total === 1 ? "" : "s"));
      var ci = items[cursor];
      descEl.textContent = ci && ci.meta && ci.meta.desc ? ci.meta.desc : "";
      list.setAttribute("aria-activedescendant", ci && cursor >= start && cursor < end ? uid + "-" + cursor : "");
      lastRender = t0 ? performance.now() - t0 : 0;
      if (items.length === 0) sizer.appendChild(el("div", { "class": "apc-pb__empty", role: "status", text: activeCount() || search ? "Nothing matches. Clear the search or filters." : "No presets yet." }));
    }
    function scrollToCursor() {
      var top = cursor * rowH, bottom = top + rowH, vh = list.clientHeight || 320;
      if (top < list.scrollTop) list.scrollTop = top; else if (bottom > list.scrollTop + vh) list.scrollTop = bottom - vh;
      renderList();
    }
    list.addEventListener("scroll", function () { renderList(); });
    sizer.addEventListener("click", function (e) {
      var rowNode = e.target.closest ? e.target.closest(".apc-pb__row") : null;
      if (!rowNode) return;
      var idx = Number(rowNode.getAttribute("data-index")), it = items[idx]; if (!it) return;
      cursor = idx;
      var star = e.target.closest(".apc-pb__star"), fav = e.target.closest(".apc-pb__fav");
      if (star) { rate(it, Number(star.getAttribute("data-star"))); return; }
      if (fav) { favorite(it, !it.favorite); return; }
      loadWithConfirm(it.id, it.name);
      renderList();
    });
    list.addEventListener("keydown", function (e) {
      var it = items[cursor], page = Math.max(1, Math.floor((list.clientHeight || 320) / rowH) - 1), n = cursor;
      if (e.key === "ArrowDown") n++; else if (e.key === "ArrowUp") n--; else if (e.key === "PageDown") n += page; else if (e.key === "PageUp") n -= page;
      else if (e.key === "Home") n = 0; else if (e.key === "End") n = items.length - 1;
      else if (e.key === "Enter" && it) { e.preventDefault(); loadWithConfirm(it.id, it.name); return; }
      else if (it && /^[0-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); rate(it, Number(e.key)); return; }
      else if (it && (e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); favorite(it, !it.favorite); return; }
      else return;
      e.preventDefault();
      cursor = Math.max(0, Math.min(items.length - 1, n)); scrollToCursor();
    });
    function rate(it, n) {
      if (n === it.rating) n = 0;                              /* click the current star again to clear */
      KB.call("apc.presets.rate", { id: it.id, stars: n }).then(function (r) {
        if (KB.isErr(r)) { KB.fail(r, "presets"); return; }
        it.rating = r.rating !== undefined ? r.rating : n;
        if (sortKey === "rating" || filters.minRating) refresh(); else renderList();
      });
    }
    function favorite(it, on) {
      KB.call("apc.presets.favorite", { id: it.id, on: on }).then(function (r) {
        if (KB.isErr(r)) { KB.fail(r, "presets"); return; }
        it.favorite = r.favorite !== undefined ? r.favorite : on;
        if (filters.favorite) refresh(); else renderList();
      });
    }

    /* -- state -- */
    function setState(ps) {
      if (!ps) return;
      pstate = ps.state && ps.state.current ? ps.state : ps;       /* event payload is {state:{...}} */
      var c = pstate.current || {}, ab = pstate.ab || {};
      curName.textContent = c.name || "";
      curDirty.hidden = !c.dirty;
      APC.dom.clear(curMissing);
      curMissing.textContent = (c.missing || []).map(function (m) { return "[Missing: " + m + "]"; }).join(" ");
      cur.setAttribute("data-readonly", c.readOnly ? "1" : "0");
      bRevert.disabled = !c.dirty;
      bAB.textContent = "A/B: " + (ab.active || "A"); bAB.setAttribute("aria-pressed", ab.active === "B" ? "true" : "false");
      bCopy.textContent = ab.active === "B" ? "Copy B→A" : "Copy A→B";
      renderList();
    }
    offs.push(KB.on("preset", function (ev) { setState(ev); }));

    /* -- import / export hooks -- */
    function importSheet() {
      var path = el("input", { type: "text", "class": "apc-kb-input", id: KB.uid("apc-pb-i"), "data-k": "import-path", placeholder: "/path/to/pack file", spellcheck: "false" });
      var errBox = el("div", { "class": "apc-sx__err", role: "alert", hidden: true });
      var sh = KB.sheet({ title: "Import pack", "class": "apc-pb-sheet", focus: "[data-k=import-path]" });
      function run(a) {
        KB.call("apc.presets.import", a).then(function (r) {
          if (KB.isErr(r)) { if (r.error === "gated") { sh.close("gated"); gatedOrFail(r); return; } errBox.textContent = KB.errText(r); errBox.hidden = false; KB.fail(r, "presets"); return; }
          sh.close("done"); APC.toast.info("Imported " + r.imported + " preset" + (r.imported === 1 ? "" : "s") + (r.pack ? " into \"" + r.pack + "\"" : "") + "."); refresh(); refreshPacks();
        });
      }
      var drop = el("div", { "class": "apc-lc__drop", "data-k": "import-drop", text: "…or drop a pack file here" });
      drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-drop"); });
      drop.addEventListener("dragleave", function () { drop.classList.remove("is-drop"); });
      drop.addEventListener("drop", function (e) {
        e.preventDefault(); drop.classList.remove("is-drop");
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () { run({ name: f.name, data: String(rd.result).replace(/^data:[^,]*,/, ""), encoding: "base64" }); };
        rd.onerror = function () { errBox.textContent = "Could not read " + f.name + "."; errBox.hidden = false; KB.fail("Could not read " + f.name, "presets"); };
        rd.readAsDataURL(f);
      });
      sh.body.appendChild(el("p", { "class": "apc-kb-note", text: "Importing never overwrites: a pack with the same name is added as \"Name 2\"." }));
      sh.body.appendChild(el("div", { "class": "apc-kb-field" }, el("label", { "for": path.id, text: "Pack file path" }), path));
      sh.body.appendChild(drop); sh.body.appendChild(errBox);
      sh.foot.appendChild(KB.btn("Cancel", function () { sh.close("cancel"); }, "", { "data-k": "cancel" }));
      sh.foot.appendChild(KB.btn("Import", function () { var p = path.value.replace(/^\s+|\s+$/g, ""); if (!p) { errBox.textContent = "Enter the path of a pack file, or drop one here."; errBox.hidden = false; path.focus(); return; } run({ path: p }); }, "apc-kb-btn--primary", { "data-k": "import-go" }));
      sh.focusFirst();
    }
    function exportFlow() {
      var ids = items.map(function (i) { return i.id; });
      if (!ids.length) { APC.toast.warn("There is nothing to export in the current view."); return; }
      KB.confirm({ title: "Export pack", message: "Export the " + ids.length + " preset" + (ids.length === 1 ? "" : "s") + " in the current view as a pack?", ok: "Export" }).then(function (yes) {
        if (!yes) return;
        KB.call("apc.presets.exportPack", { ids: ids }).then(function (r) {
          if (KB.isErr(r)) { gatedOrFail(r); return; }
          APC.toast.info("Exported " + r.count + " preset" + (r.count === 1 ? "" : "s") + " to " + r.path + ".");
        });
      });
    }

    /* -- startup -- */
    function refreshPacks() {
      return KB.call("apc.presets.info").then(function (pi) {
        if (disposed) return;
        if (!KB.isErr(pi) && pi.packs) packs = pi.packs.map(function (p) { return p.name; }).filter(function (n) { return n !== "_wip"; });
        drawScopes(); drawFilters();
      });
    }
    var releaseAccel = accelOn();
    var onResize = function () { closePop(); };               /* popups are positioned in px: close instead of drifting */
    window.addEventListener("resize", onResize);
    var searchTimer = null;
    searchIn.addEventListener("input", function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { searchTimer = null; search = searchIn.value; cursor = 0; refresh(); }, 120);
    });
    searchIn.addEventListener("keydown", function (e) { if (e.key === "Escape" && searchIn.value) { e.stopPropagation(); searchIn.value = ""; search = ""; refresh(); } });
    sortSel.addEventListener("change", function () { sortKey = sortSel.value; cursor = 0; refresh(); });
    var ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(function () { var h = measure(); if (h !== rowH) { rowH = h; renderList("remeasure"); } else renderList(); }) : null;
    if (ro) ro.observe(list);

    var ready = Promise.all([KB.call("apc.info"), KB.call("apc.presets.info"), KB.call("apc.presets.state")]).then(function (res) {
      if (disposed) return;
      info = KB.isErr(res[0]) ? {} : res[0];
      flat = (info.features && info.features.presetHierarchy) === "flat";
      if (!KB.isErr(res[1]) && res[1].packs) packs = res[1].packs.map(function (p) { return p.name; }).filter(function (n) { return n !== "_wip"; });
      if (!KB.isErr(res[2])) setState(res[2]);
      drawScopes(); drawFilters();
      return refresh().then(function () {
        if (pstate && pstate.current) { for (var i = 0; i < items.length; i++) if (items[i].id === pstate.current.id) { cursor = i; break; } scrollToCursor(); }
      });
    });

    return {
      root: root, ready: ready, refresh: refresh,
      state: function () { return { scope: scope, filters: filters, search: search, sort: sortKey, items: items, total: total, rowHeight: rowH, lastRenderMs: lastRender, cursor: cursor }; },
      setScope: function (s) { scope = s; cursor = 0; drawScopes(); return refresh(); },
      setSort: function (s) { sortKey = s; sortSel.value = s; cursor = 0; return refresh(); },
      setSearch: function (s) { search = s; searchIn.value = s; cursor = 0; return refresh(); },
      dispose: function () {
        disposed = true; closePop(); releaseAccel(); window.removeEventListener("resize", onResize); offs.forEach(function (o) { o(); }); timers.forEach(clearTimeout);
        if (searchTimer) clearTimeout(searchTimer);
        if (ro) ro.disconnect();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  /* ---- header chip: <prev> name* <next> [Save] + button that opens the browser ------------------------------------------------ */
  function createChip(host, opts) {
    var offs = [], disposed = false, pstate = null, sheet = null;
    var root = el("div", { "class": "apc-pc", role: "group", "aria-label": "Preset", "data-k": "chip" });
    var name = el("span", { "class": "apc-pc__name", "data-k": "chip-name" }), dirty = el("span", { "class": "apc-pb__dirty", hidden: true, "aria-label": "unsaved changes", text: "*" });
    var browse = el("button", { type: "button", "class": "apc-pc__browse", "aria-haspopup": "dialog", "data-k": "chip-browse", "aria-label": "Open the preset browser" }, name, dirty);
    function step(dir) {
      KB.call("apc.presets.list", { scope: "all", sort: "name" }).then(function (r) {
        if (KB.isErr(r)) { KB.fail(r, "presets"); return; }
        var its = r.items || []; if (!its.length) return;
        var idx = -1; its.forEach(function (x, i) { if (pstate && pstate.current && x.id === pstate.current.id) idx = i; });
        var n = idx < 0 ? (dir > 0 ? 0 : its.length - 1) : (idx + dir + its.length) % its.length;
        loadWithConfirm(its[n].id, its[n].name);
      });
    }
    var prev = KB.btn("‹", function () { step(-1); }, "apc-pc__step", { "aria-label": "Previous preset", "data-k": "chip-prev" });
    var next = KB.btn("›", function () { step(1); }, "apc-pc__step", { "aria-label": "Next preset", "data-k": "chip-next" });
    var save = KB.btn("Save", function () { quickSave(); }, "apc-pc__save", { "data-k": "chip-save", title: "Save (Ctrl/Cmd+S)" });
    browse.addEventListener("click", function () {
      if (sheet) { sheet.close("toggle"); return; }
      var b;
      sheet = KB.sheet({ title: "Presets", "class": "apc-pb-sheet apc-pb-sheet--wide", onClose: function () { sheet = null; if (b) b.dispose(); } });
      b = createBrowser(sheet.body, opts);
      sheet.panel.setAttribute("data-apc-sheet", "presets");
      b.ready.then(function () { if (sheet) sheet.focusFirst(); });
    });
    root.appendChild(prev); root.appendChild(browse); root.appendChild(next); root.appendChild(save);
    host.appendChild(root);
    function set(ps) {
      pstate = ps && ps.state && ps.state.current ? ps.state : ps; if (!pstate || !pstate.current) return;
      name.textContent = pstate.current.name; dirty.hidden = !pstate.current.dirty;
      browse.setAttribute("aria-label", "Open the preset browser. Current preset: " + pstate.current.name + (pstate.current.dirty ? " (unsaved changes)" : ""));
    }
    offs.push(KB.on("preset", set));
    var release = accelOn();
    KB.call("apc.presets.state").then(function (s) { if (!disposed && !KB.isErr(s)) set(s); else if (KB.isErr(s)) KB.fail(s, "presets"); });
    return { dispose: function () { disposed = true; release(); offs.forEach(function (o) { o(); }); if (sheet) sheet.close("dispose"); if (root.parentNode) root.parentNode.removeChild(root); }, root: root };
  }

  APC.presetsUI = { createBrowser: createBrowser, createChip: createChip, quickSave: quickSave, saveAs: saveAsSheet, load: loadWithConfirm,
    vocab: { categories: CATS, axes: AXES, moods: MOODS, genres: GENRES } };
  APC.register("presets", function (node, o) { var b = createBrowser(node, o); node.__apcPresets = b; return { dispose: b.dispose }; });
  APC.register("preset-chip", function (node, o) { var c = createChip(node, o); return { dispose: c.dispose }; });
})();
