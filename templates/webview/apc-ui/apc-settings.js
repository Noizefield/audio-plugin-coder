/* =============================================================================
   apc-settings.js — settings overlay (Global, Engine/Quality, MIDI, Presets & Data, License, About)
   Opened by APC.emit("settings:open", {tab?}) or any [data-apc="settings"] element. Overlay (not an OS dialog); focus trap; Esc closes.
   Classic script (no modules, no network). Contract: CONTRACT.md. Guide: .agents/guides/ui-kit-panels.md
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.settingsUI) return;
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

  /* ---- constants ------------------------------------------------------------------------------------------- */
  var UI_DEFAULTS = { theme: "follow-os", scale: 1.0, tooltips: true, tooltip_delay_ms: 400, preset_load: "confirm-if-dirty", wheel_target: "control",
    reset_animation: "glide", double_click: "reset", aspect_lock: true, auto_update_check: false };
  var STD_KEY = { theme: "ux.theme", tooltips: "ux.tooltips", tooltip_delay_ms: "ux.tooltip_delay_ms", preset_load: "ux.preset_load",
    wheel_target: "ux.wheel_target", reset_animation: "ux.reset_animation", double_click: "ux.double_click", aspect_lock: "ux.aspect_lock" };
  var SCALE_STEPS = [50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300];
  var LINKS = [["company", "Manufacturer website"], ["product", "Product page"], ["docs", "Manual"], ["support", "Support"]];

  function relTime(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return "";
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 129600) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " days ago";
  }
  function pctLabel(p) { return p + " %"; }

  var current = null;

  function open(o) {
    o = o || {};
    if (current) { if (o.tab) current.select(o.tab); if (current.sheet) current.sheet.panel.focus(); return current.ready; }
    var ctl = { sheet: null, select: function () {}, ready: null };
    current = ctl;
    ctl.ready = Promise.all([KB.call("apc.info"), KB.call("apc.settings.get"), KB.call("apc.engine.get")]).then(function (res) {
      var info = res[0], settings = res[1], eng = res[2];
      if (KB.isErr(info)) { KB.fail(info, "settings"); current = null; return null; }
      if (KB.isErr(settings)) { KB.fail(settings, "settings"); settings = { schema: "apc-settings/1.0", ui: {}, engine: {}, presets: {}, license: {} }; }
      if (!settings.ui) settings.ui = {};
      var engineFields = (!KB.isErr(eng) && eng && eng.fields) ? eng.fields : null;
      if (!KB.isErr(eng) && eng && !eng.fields && eng.values === undefined && !Array.isArray(eng)) {          /* bare {oversampling:..} from a minimal native side */
        engineFields = [];
        if (eng.oversampling !== undefined) engineFields.push({ key: "oversampling", label: "Oversampling", type: "enum", values: [1, 2, 4, 8], suffix: "×", latency: true });
        if (eng.max_voices !== undefined) engineFields.push({ key: "max_voices", label: "Max polyphony", type: "int", min: 1, max: 64 });
        eng = { values: eng, fields: engineFields, defaults: {} };
      }
      return build(info, settings, KB.isErr(eng) ? null : eng, ctl, o);
    });
    return ctl.ready;
  }

  function build(info, settings, eng, ctl, o) {
    var feats = info.features || {}, std = info.standards || {};
    var disposers = [], tabs = [], panels = {}, built = {}, activeId = null, errEls = {}, syncers = [];
    var sheet = KB.sheet({ title: "Settings", "class": "apc-sx-sheet", onClose: function () {
      disposers.forEach(function (d) { try { d(); } catch (e) {} }); current = null;
    } });
    ctl.sheet = sheet;
    sheet.panel.setAttribute("data-apc-sheet", "settings");

    var tablist = el("div", { "class": "apc-sx__tabs", role: "tablist", "aria-label": "Settings sections", "aria-orientation": "vertical" });
    var area = el("div", { "class": "apc-sx__area" });
    sheet.body.appendChild(el("div", { "class": "apc-sx" }, tablist, area));
    sheet.foot.appendChild(KB.btn("Close", function () { sheet.close("button"); }, "apc-kb-btn--primary", { "data-k": "close" }));

    /* ---- tab visibility rules (U-05) ---- */
    tabs.push({ id: "global", label: "Global", make: makeGlobal });
    if (eng && eng.fields && eng.fields.length) tabs.push({ id: "engine", label: "Engine / Quality", make: makeEngine });
    if (feats.midiLearnTable) tabs.push({ id: "midi", label: "MIDI", make: makeMidi });
    tabs.push({ id: "presets", label: "Presets & Data", make: makePresets });
    if (feats.licenseMode && feats.licenseMode !== "none") tabs.push({ id: "license", label: "License", make: makeLicense });
    tabs.push({ id: "about", label: "About", make: makeAbout });

    tabs.forEach(function (t) {
      t.btn = el("button", { type: "button", role: "tab", id: KB.uid("apc-sx-tab"), "class": "apc-sx__tab", "data-tab": t.id, text: t.label, tabindex: "-1", "aria-selected": "false" });
      t.panel = el("div", { role: "tabpanel", "class": "apc-sx__panel", "data-panel": t.id, "aria-labelledby": t.btn.id, hidden: true, tabindex: "-1" });
      t.btn.setAttribute("aria-controls", t.panel.id = KB.uid("apc-sx-panel"));
      t.btn.addEventListener("click", function () { select(t.id, true); });
      t.btn.addEventListener("keydown", function (e) {
        var i = tabs.indexOf(t), n = -1;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") n = (i + 1) % tabs.length;
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = tabs.length - 1;
        if (n >= 0) { e.preventDefault(); select(tabs[n].id, true); }
      });
      tablist.appendChild(t.btn); area.appendChild(t.panel);
    });

    function select(id, focus) {
      var t = null; tabs.forEach(function (x) { if (x.id === id) t = x; });
      if (!t) return;
      activeId = id;
      tabs.forEach(function (x) {
        var on = x === t;
        x.btn.setAttribute("aria-selected", on ? "true" : "false"); x.btn.tabIndex = on ? 0 : -1; x.panel.hidden = !on;
      });
      if (!built[id]) {
        built[id] = true;
        var r = t.make(t.panel);
        if (r && r.dispose) disposers.push(r.dispose);
      }
      if (focus) t.btn.focus();
    }
    ctl.select = function (id) { select(id, false); };

    /* ---- shared row helpers ---- */
    function errBox(panel, id) {
      var e = el("div", { "class": "apc-sx__err", role: "alert", "data-k": "error", hidden: true });
      panel.appendChild(e); errEls[id] = e; return e;
    }
    function showErr(id, text) { var e = errEls[id]; if (!e) return; e.textContent = text || ""; e.hidden = !text; }
    function row(label, control, note, idHint) {
      var id = control.id || (control.id = KB.uid("apc-sx-c"));
      var r = el("div", { "class": "apc-sx__row" }, el("label", { "for": id, "class": "apc-sx__label", text: label }), el("div", { "class": "apc-sx__ctl" }, control));
      if (note) r.querySelector(".apc-sx__ctl").appendChild(el("div", { "class": "apc-kb-note", text: note }));
      return r;
    }
    function select_(list, value, onchange, attrs) {
      var s = el("select", { "class": "apc-kb-input", id: KB.uid("apc-sx-c") });
      var k; for (k in (attrs || {})) s.setAttribute(k, attrs[k]);
      list.forEach(function (it) { s.appendChild(el("option", { value: String(it[0]), text: it[1] })); });
      s.value = String(value);
      s.addEventListener("change", function () {
        var v = s.value; list.forEach(function (it) { if (String(it[0]) === v) v = it[0]; });
        onchange(v);
      });
      return s;
    }
    function restoreBtn(panelId, label, fn) {
      return el("div", { "class": "apc-sx__foot" }, KB.btn("Restore defaults", function () {
        KB.confirm({ title: "Restore defaults?", message: label, ok: "Restore defaults", danger: true }).then(function (yes) { if (yes) fn(); });
      }, "", { "data-k": "restore" }));
    }
    function stdDefault(key) { var sk = STD_KEY[key]; return (sk && std[sk] !== undefined) ? std[sk] : UI_DEFAULTS[key]; }

    /* write helper: patch machine settings; failure is visible and the controls snap back */
    function save(tabId, patch) {
      return KB.call("apc.settings.set", { patch: patch }).then(function (r) {
        if (KB.isErr(r)) {
          showErr(tabId, "Could not save settings: " + KB.errText(r));
          KB.fail(r, "settings");
          syncers.forEach(function (f) { f(); });
          return false;
        }
        settings = r; showErr(tabId, "");
        APC.emit("settings:changed", { settings: r });
        syncers.forEach(function (f) { f(); });
        return true;
      });
    }
    function uiVal(key) { var v = settings.ui ? settings.ui[key] : undefined; return v === undefined ? stdDefault(key) : v; }

    /* ======================= Global ======================= */
    function makeGlobal(panel) {
      errBox(panel, "global");
      panel.appendChild(el("p", { "class": "apc-kb-note", text: "Changes are saved immediately for this computer. Most apply the next time the plugin window is opened; the scale applies now." }));
      function enumRow(key, label, list, note) {
        var s = select_(list, uiVal(key), function (v) { var p = { ui: {} }; p.ui[key] = v; save("global", p); }, { "data-key": key });
        syncers.push(function () { s.value = String(uiVal(key)); });
        panel.appendChild(row(label, s, note));
        return s;
      }
      if (feats.themeEnabled) enumRow("theme", "Interface theme", [["night", "Night"], ["day", "Day"], ["follow-os", "Follow OS"]]);
      /* scale */
      var scaleList = SCALE_STEPS.map(function (p) { return [p, pctLabel(p)]; }); scaleList.push(["follow", "Follow gripper"]);
      function scaleVal() { return uiVal("scale_follow_gripper") ? "follow" : Math.round((Number(uiVal("scale")) || 1) * 100); }
      var sc = select_(scaleList, scaleVal(), function (v) {
        var p = { ui: v === "follow" ? { scale_follow_gripper: true } : { scale: v / 100, scale_follow_gripper: false } };
        save("global", p).then(function (ok) { if (ok && v !== "follow") KB.call("apc.ui.setScale", { scale: v / 100 }).then(function (r) { if (KB.isErr(r)) KB.fail(r, "settings"); }); });
      }, { "data-key": "scale" });
      syncers.push(function () { var v = scaleVal(); sc.value = String(v); if (sc.value !== String(v)) { sc.value = "100"; } });
      panel.appendChild(row("GUI scaling", sc, "Drag the corner gripper any time; \"Follow gripper\" keeps whatever size you last dragged to."));
      /* tooltips */
      var tt = el("input", { type: "checkbox", id: KB.uid("apc-sx-c"), "data-key": "tooltips" });
      var td = select_([[200, "200 ms"], [400, "400 ms"], [800, "800 ms"], [1200, "1200 ms"]], uiVal("tooltip_delay_ms"), function (v) { save("global", { ui: { tooltip_delay_ms: v } }); }, { "data-key": "tooltip_delay_ms" });
      function syncTt() { tt.checked = !!uiVal("tooltips"); td.value = String(uiVal("tooltip_delay_ms")); td.disabled = !tt.checked; }
      tt.addEventListener("change", function () { save("global", { ui: { tooltips: tt.checked } }); });
      syncTt(); syncers.push(syncTt);
      panel.appendChild(row("Tooltip help", tt, "Show a short help text when you hover a control."));
      panel.appendChild(row("Tooltip delay", td));
      enumRow("preset_load", "Preset load behavior", [["instant", "Instant"], ["confirm-if-dirty", "Confirm if there are unsaved changes"]]);
      enumRow("wheel_target", "Mouse wheel target", [["control", "Control under the pointer"], ["panel", "Scroll the panel"]]);
      enumRow("reset_animation", "Reset animation", [["snap", "Snap"], ["glide", "Glide"]]);
      enumRow("double_click", "Double-click on a control", [["reset", "Reset to default"], ["value_entry", "Type a value"]], "Alt/Option+click always resets.");
      if (feats.autoUpdateCheck) {
        var au = el("input", { type: "checkbox", id: KB.uid("apc-sx-c"), "data-key": "auto_update_check" });
        au.addEventListener("change", function () { save("global", { ui: { auto_update_check: au.checked } }); });
        function syncAu() { au.checked = !!uiVal("auto_update_check"); } syncAu(); syncers.push(syncAu);
        panel.appendChild(row("Check for updates automatically", au, "Off by default. When on, contacts the update server at most once a day. Nothing else is ever sent; there is no telemetry."));
      }
      panel.appendChild(restoreBtn("global", "Reset every setting on the Global tab to its default?", function () {
        var ui = {}; ["theme", "tooltips", "tooltip_delay_ms", "preset_load", "wheel_target", "reset_animation", "double_click", "auto_update_check"].forEach(function (k) { ui[k] = stdDefault(k); });
        ui.scale = 1.0; ui.scale_follow_gripper = false;
        save("global", { ui: ui }).then(function (ok) { if (ok) KB.call("apc.ui.setScale", { scale: 1.0 }); });
      }));
    }

    /* ======================= Engine / Quality ======================= */
    function makeEngine(panel) {
      var state = { values: (eng && eng.values) || {}, defaults: (eng && eng.defaults) || {}, fields: eng.fields, scope: (eng && eng.scope) || "chunk", latency: eng && eng.latencySamples };
      errBox(panel, "engine");
      var scopeNote = state.scope === "machine"
        ? "These settings apply to every instance of the plugin on this computer."
        : "Engine settings are saved with the project, so a project always sounds the same on any computer. The machine value is the default for new instances.";
      panel.appendChild(el("p", { "class": "apc-kb-note", "data-k": "engine-note", text: scopeNote }));
      var latency = el("div", { "class": "apc-kb-note", "data-k": "latency" });
      var inputs = {}, defLabels = {};
      function fmt(f, v) { return v === undefined || v === null ? "—" : String(v) + (f.suffix || ""); }
      function machineVal(f) { return settings.engine && settings.engine[f.key] !== undefined ? settings.engine[f.key] : undefined; }
      function syncEngine() {
        state.fields.forEach(function (f) {
          var v = state.values[f.key];
          if (inputs[f.key]) { if (f.type === "bool") inputs[f.key].checked = !!v; else inputs[f.key].value = String(v === undefined ? "" : v); }
          if (defLabels[f.key]) defLabels[f.key].textContent = state.scope === "machine" ? "" : "Default for new instances: " + fmt(f, machineVal(f));
        });
        latency.textContent = "Quality changes may increase the latency the plugin reports to your DAW." + (state.latency !== undefined && state.latency !== null ? " Current latency: " + state.latency + " samples." : "");
      }
      syncers.push(syncEngine);
      function setEngine(patch) {
        return KB.call("apc.engine.set", { patch: patch }).then(function (r) {
          if (KB.isErr(r)) { showErr("engine", "Could not change the engine setting: " + KB.errText(r)); KB.fail(r, "settings"); }
          else { showErr("engine", ""); if (r.values) { state.values = r.values; state.latency = r.latencySamples; } else state.values = r; }
          syncEngine();
          return r;
        });
      }
      state.fields.forEach(function (f) {
        var c, id = KB.uid("apc-sx-c");
        if (f.type === "enum") {
          c = select_((f.values || []).map(function (v) { return [v, fmt(f, v)]; }), state.values[f.key], function (v) { var p = {}; p[f.key] = v; setEngine(p); }, { "data-key": f.key });
        } else if (f.type === "bool") {
          c = el("input", { type: "checkbox", "data-key": f.key });
          c.addEventListener("change", function () { var p = {}; p[f.key] = c.checked; setEngine(p); });
        } else {
          c = el("input", { type: "number", "class": "apc-kb-input", "data-key": f.key, min: f.min, max: f.max, step: "1" });
          c.addEventListener("change", function () {
            var n = Math.round(Number(c.value));
            if (!isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
              showErr("engine", f.label + " must be a whole number" + (f.min !== undefined ? " from " + f.min + " to " + f.max : "") + "."); syncEngine(); return;
            }
            var p = {}; p[f.key] = n; setEngine(p);
          });
        }
        c.id = id; inputs[f.key] = c;
        defLabels[f.key] = el("span", { "class": "apc-kb-note", "data-k": "default-" + f.key });
        var r = row(f.label, c); r.querySelector(".apc-sx__ctl").appendChild(defLabels[f.key]);
        panel.appendChild(r);
      });
      panel.appendChild(latency);
      syncEngine();
      if (state.scope !== "machine") {
        panel.appendChild(el("div", { "class": "apc-lc__row" }, KB.btn("Set as default for new instances", function () {
          var patch = { engine: {} }; state.fields.forEach(function (f) { patch.engine[f.key] = state.values[f.key]; });
          save("engine", patch).then(function (ok) { if (ok) APC.toast.info("Saved. New instances will start with these engine settings; existing projects keep their own."); });
        }, "", { "data-k": "set-default" })));
      }
      panel.appendChild(restoreBtn("engine", "Reset this instance's engine settings to the plugin's built-in defaults? Other instances and the machine default are not changed.", function () {
        var p = {}; state.fields.forEach(function (f) { p[f.key] = state.defaults[f.key] !== undefined ? state.defaults[f.key] : f["default"]; });
        setEngine(p);
      }));
    }

    /* ======================= MIDI ======================= */
    function makeMidi(panel) {
      errBox(panel, "midi");
      var rows = [], tbody = el("tbody"), exportBox, importBox;
      panel.appendChild(el("p", { "class": "apc-kb-note", text: "Assign a MIDI CC (0 to 127) to a parameter, or press Learn and move a knob on your controller. Min and Max limit the range the controller can reach." }));
      var table = el("table", { "class": "apc-sx__table", "data-k": "midi-table" },
        el("thead", null, el("tr", null, el("th", { scope: "col", text: "Parameter" }), el("th", { scope: "col", text: "CC" }), el("th", { scope: "col", text: "Min" }), el("th", { scope: "col", text: "Max" }), el("th", { scope: "col", text: "Actions" }))), tbody);
      panel.appendChild(el("div", { "class": "apc-sx__scroll" }, table));
      function load() {
        return KB.call("apc.midi.table.get").then(function (r) {
          if (KB.isErr(r)) { showErr("midi", "Could not read the MIDI table: " + KB.errText(r)); KB.fail(r, "settings"); return; }
          showErr("midi", ""); rows = r.rows || r; draw(); exp();
        });
      }
      function setRows(list) {
        return KB.call("apc.midi.table.set", { rows: list }).then(function (r) {
          if (KB.isErr(r)) { showErr("midi", "Could not change the MIDI table: " + KB.errText(r)); KB.fail(r, "settings"); return load(); }
          showErr("midi", ""); rows = r.rows || rows; draw(); exp();
        });
      }
      function numOrNull(v) { v = String(v).replace(/^\s+|\s+$/g, ""); return v === "" ? null : Number(v); }
      function draw() {
        APC.dom.clear(tbody);
        rows.forEach(function (r) {
          var cc = el("input", { type: "number", "class": "apc-kb-input apc-sx__num", min: "0", max: "127", step: "1", "aria-label": r.name + " MIDI CC", "data-k": "cc", value: r.cc === null || r.cc === undefined ? "" : r.cc });
          var mn = el("input", { type: "number", "class": "apc-kb-input apc-sx__num", step: "any", "aria-label": r.name + " minimum", "data-k": "min", value: r.min });
          var mx = el("input", { type: "number", "class": "apc-kb-input apc-sx__num", step: "any", "aria-label": r.name + " maximum", "data-k": "max", value: r.max });
          function commit() {
            var c = numOrNull(cc.value);
            if (c !== null && !(c >= 0 && c <= 127 && Math.floor(c) === c)) { showErr("midi", "CC for " + r.name + " must be a whole number from 0 to 127."); cc.focus(); return; }
            var a = Number(mn.value), b = Number(mx.value);
            if (!isFinite(a) || !isFinite(b) || a > b) { showErr("midi", "Min must not be greater than Max for " + r.name + "."); return; }
            setRows([{ id: r.id, cc: c, min: a, max: b }]);
          }
          [cc, mn, mx].forEach(function (i) { i.addEventListener("change", commit); });
          var learn = KB.btn("Learn", function () { KB.call("apc.midi.learn", { id: r.id }).then(function (x) { if (KB.isErr(x)) { showErr("midi", KB.errText(x)); KB.fail(x, "settings"); } else load(); }); }, "", { "aria-label": "Learn MIDI CC for " + r.name, "data-k": "learn" });
          var un = KB.btn("Unlearn", function () { KB.call("apc.midi.unlearn", { id: r.id }).then(function (x) { if (KB.isErr(x)) { showErr("midi", KB.errText(x)); KB.fail(x, "settings"); } else load(); }); }, "", { "aria-label": "Unlearn MIDI CC for " + r.name, "data-k": "unlearn", disabled: r.cc === null || r.cc === undefined });
          tbody.appendChild(el("tr", { "data-id": r.id }, el("th", { scope: "row", text: r.name + (r.unit ? " (" + r.unit + ")" : "") }), el("td", null, cc), el("td", null, mn), el("td", null, mx), el("td", { "class": "apc-sx__acts" }, learn, un)));
        });
      }
      exportBox = el("textarea", { "class": "apc-kb-input apc-lc__text", rows: "3", readonly: true, "data-k": "midi-export", "aria-label": "Exported MIDI map" });
      importBox = el("textarea", { "class": "apc-kb-input apc-lc__text", rows: "3", "data-k": "midi-import", "aria-label": "MIDI map to import", spellcheck: "false", placeholder: "Paste an exported MIDI map here" });
      function exp() {
        exportBox.value = JSON.stringify({ schema: "apc-midi-map/1", rows: rows.filter(function (r) { return r.cc !== null && r.cc !== undefined; }).map(function (r) { return { id: r.id, cc: r.cc, min: r.min, max: r.max }; }) });
      }
      panel.appendChild(el("details", { "class": "apc-lc__more", "data-k": "midi-io" }, el("summary", { text: "Export / import MIDI map" }),
        el("div", { "class": "apc-kb-field" }, el("label", { text: "Export (copy this text)" }), exportBox, el("div", { "class": "apc-lc__row" }, KB.btn("Copy", function () { KB.copyText(exportBox.value, exportBox).then(function (ok) { APC.toast.info(ok ? "MIDI map copied." : "Select the text and copy it with Ctrl/Cmd+C."); }); }, "", { "data-k": "midi-copy" }))),
        el("div", { "class": "apc-kb-field" }, el("label", { text: "Import" }), importBox, el("div", { "class": "apc-lc__row" }, KB.btn("Apply imported map", function () {
          var j; try { j = JSON.parse(importBox.value); } catch (e) { showErr("midi", "That is not a valid MIDI map (the text could not be read)."); return; }
          if (!j || !Array.isArray(j.rows)) { showErr("midi", "That is not a valid MIDI map (no rows found)."); return; }
          setRows(j.rows);
        }, "", { "data-k": "midi-apply" })))));
      panel.appendChild(restoreBtn("midi", "Remove every MIDI CC assignment and reset the ranges?", function () {
        setRows(rows.map(function (r) { return { id: r.id, cc: null, min: r.pmin !== undefined ? r.pmin : r.min, max: r.pmax !== undefined ? r.pmax : r.max }; }));
      }));
      load();
    }

    /* ======================= Presets & Data ======================= */
    function makePresets(panel) {
      errBox(panel, "presets");
      var pinfo = null;
      var rootIn = el("input", { type: "text", "class": "apc-kb-input", readonly: true, "data-k": "root", id: KB.uid("apc-sx-c") });
      var status = el("div", { "class": "apc-sx__status", "data-k": "index-status", role: "status" });
      var dev = el("div", { "class": "apc-sx__dev", "data-k": "dev-root", hidden: true });
      panel.appendChild(row("Preset folder", rootIn, "Read-only. Presets, packs and your ratings live here, in your user data folder."));
      panel.appendChild(el("div", { "class": "apc-lc__row" },
        KB.btn("Open Presets Folder", function () { KB.call("apc.presets.openFolder").then(function (r) { if (KB.isErr(r)) { showErr("presets", KB.errText(r)); KB.fail(r, "settings"); } else showErr("presets", ""); }); }, "", { "data-k": "open-folder" }),
        KB.btn("Rescan Now", function () {
          KB.call("apc.presets.rescan").then(function (r) {
            if (KB.isErr(r)) { showErr("presets", "Rescan failed: " + KB.errText(r)); KB.fail(r, "settings"); return; }
            showErr("presets", ""); APC.emit("presets:rescanned", r); refresh();
          });
        }, "", { "data-k": "rescan" })));
      panel.appendChild(status); panel.appendChild(dev);
      panel.appendChild(el("div", { "class": "apc-sx__group" },
        el("p", { "class": "apc-kb-note", text: "Restore Factory Layout re-creates the factory presets in this user account's folder. Installers only write to the account that ran them, so if other user accounts on this computer have no factory presets, run this once in each of them." }),
        el("div", { "class": "apc-lc__row" }, KB.btn("Restore Factory Layout", function () {
          KB.confirm({ title: "Restore Factory Layout?", message: "The factory presets are re-created in your folder. Your own presets are not touched.", ok: "Restore" }).then(function (yes) {
            if (!yes) return;
            KB.call("apc.presets.restoreFactory").then(function (r) {
              if (KB.isErr(r)) { showErr("presets", "Could not restore the factory layout: " + KB.errText(r)); KB.fail(r, "settings"); return; }
              showErr("presets", ""); APC.toast.info("Factory layout restored."); refresh();
            });
          });
        }, "", { "data-k": "restore-factory" }))));
      function refresh() {
        KB.call("apc.presets.info").then(function (r) {
          if (KB.isErr(r)) { status.textContent = "Index information is not available."; if (r.error !== "unknown_function") KB.fail(r, "settings"); return; }
          pinfo = r; rootIn.value = r.root || "";
          status.textContent = "Index: " + r.assets + " asset" + (r.assets === 1 ? "" : "s") + (r.builtAt ? ", rebuilt " + relTime(r.builtAt) : "") + ".";
          dev.hidden = !r.devRoot; dev.textContent = r.devRoot ? "Development root active: " + r.devRoot + " (debug builds only)" : "";
        });
      }
      panel.appendChild(restoreBtn("presets", "Clear the recent-presets list and the remembered last pack and preset? Your presets, ratings and favorites are not affected.", function () {
        save("presets", { presets: { recents: [], last_pack: null, last_preset: null } });
      }));
      refresh();
    }

    /* ======================= License ======================= */
    function makeLicense(panel) {
      if (!APC.licenseUI) { panel.appendChild(el("p", { "class": "apc-kb-note", text: "The license panel (apc-license-ui.js) is not loaded." })); return null; }
      var r = APC.licenseUI.render(panel, {});
      if (info.links && info.links.account) panel.appendChild(linkEl(info.links.account, "Manage your account"));
      return r;
    }

    /* ======================= About ======================= */
    function linkEl(url, label) {
      var a = el("a", { href: url, "class": "apc-sx__link", text: label, rel: "noopener" });
      a.addEventListener("click", function (e) { e.preventDefault(); KB.openUrl(url); });
      return a;
    }
    function makeAbout(panel) {
      var dl = el("dl", { "class": "apc-sx__facts" });
      function fact(k, v) { if (v === undefined || v === null || v === "") return; dl.appendChild(el("dt", { text: k })); dl.appendChild(el("dd", { text: String(v) })); }
      panel.appendChild(el("h3", { "class": "apc-sx__product", "data-k": "product", text: info.product || "" }));
      fact("Manufacturer", info.manufacturer); fact("Version", info.version ? "v" + info.version : ""); fact("Build date", info.buildDate);
      fact("JUCE", info.juceVersion); fact("Framework", info.frameworkVersion);
      panel.appendChild(dl);
      var links = el("ul", { "class": "apc-sx__links", "data-k": "links" }), nLinks = 0;
      LINKS.forEach(function (l) { var u = info.links && info.links[l[0]]; if (u) { links.appendChild(el("li", null, linkEl(u, l[1]))); nLinks++; } });
      if (nLinks) panel.appendChild(links);
      panel.appendChild(el("h4", { "class": "apc-sx__h", text: "Updates" }));
      var up = document.createElement("div"); panel.appendChild(up);
      var ur = APC.updateUI ? APC.updateUI.render(up, {}) : null;
      if (!ur) up.appendChild(el("p", { "class": "apc-kb-note", text: "The update panel (apc-update-ui.js) is not loaded." }));
      var legal = info.legal || {};
      if (legal.openSource) panel.appendChild(el("details", { "class": "apc-lc__more", "data-k": "oss" }, el("summary", { text: "Open-source licenses" }), el("pre", { "class": "apc-up__notes", tabindex: "0", text: legal.openSource })));
      if (legal.eula) panel.appendChild(el("details", { "class": "apc-lc__more", "data-k": "eula" }, el("summary", { text: "End-user license agreement" }), el("pre", { "class": "apc-up__notes", tabindex: "0", text: legal.eula })));
      panel.appendChild(el("div", { "class": "apc-lc__row" }, KB.btn("Copy diagnostics", function () {
        KB.call("apc.diagnostics.copy").then(function (r) {
          if (KB.isErr(r)) { KB.fail(r, "settings"); return; }
          KB.copyText(r.text || "", null).then(function (ok) { APC.toast.info(ok ? "Diagnostics copied. Nothing is sent anywhere." : "Could not access the clipboard."); });
        });
      }, "", { "data-k": "diagnostics" })));
      return { dispose: function () { if (ur) ur.dispose(); } };
    }

    select(o.tab && tabs.some(function (t) { return t.id === o.tab; }) ? o.tab : "global", true);
    return sheet;
  }

  APC.settingsUI = { open: open, close: function () { if (current && current.sheet) current.sheet.close("api"); }, isOpen: function () { return !!(current && current.sheet); } };
  APC.on("settings:open", function (d) { open(d || {}); });
  APC.register("settings", function (node) {
    function go(e) { if (e) e.preventDefault(); open({}); }
    node.addEventListener("click", go);
    node.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && node.tagName !== "BUTTON" && node.tagName !== "A") go(e); });
    node.setAttribute("aria-haspopup", "dialog");
    if (!node.getAttribute("role") && node.tagName !== "BUTTON" && node.tagName !== "A") node.setAttribute("role", "button");
    if (!node.hasAttribute("tabindex") && node.tagName !== "BUTTON" && node.tagName !== "A") node.tabIndex = 0;
    if (!node.getAttribute("aria-label") && !node.textContent.replace(/\s/g, "")) node.setAttribute("aria-label", "Settings");
    return { dispose: function () { node.removeEventListener("click", go); } };
  });
})();
