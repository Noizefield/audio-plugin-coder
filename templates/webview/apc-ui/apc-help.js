/* =============================================================================
   apc-help.js — APC UI kit help system (U-09, X-09): tooltip, info bar,
   F1 / "?" help mode with a VISIBLE Help button, manual-entry overlay.
   Classic script (ES5-safe); extends window.APC. Load after apc-controls.js.

   Text comes ONLY from the ParamDescriptor `help` {what, effect, how} (written once,
   reused by tooltip + info bar + manual). Master toggle: ui.tooltips. Delay:
   ui.tooltip_delay_ms (default 400). Tooltip never shows while dragging and is
   anchored beside the control (never under the pointer, never over the readout).

   Components:  <div data-apc="infobar"></div>   <div data-apc="help-button"></div>
   API:  APC.help = { mode(on), toggleMode(), isMode(), openManual(id), closeManual(),
                      showTooltip(el), hideTooltip(), tooltipVisible(), tooltipEnabled(),
                      setIdleText(text), start(), destroy() }
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__help) return;
  if (!APC.register || !APC.dom) { if (window.console) console.error("apc-help.js: load apc-kit.js first"); return; }
  APC.__help = true;
  var h = APC.dom.el;
  var IS_MAC = /Mac|iPhone|iPad/.test((navigator.platform || "") + (navigator.userAgent || ""));
  var MOD = IS_MAC ? "Option" : "Alt";

  /* ---- prefs (shared shape; first loaded module creates it) ---- */
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
        }, function () { return api.all(); });
      }
    };
    APC.on("settings:changed", function (s) { if (s && s.ui) api.set(s.ui); else if (s) api.set(s); });
    APC.prefs = api;
    return api;
  }
  var prefs = ensurePrefs();

  /* ---- bridge + descriptors ---- */
  function call(name, args) {
    if (APC.controls && APC.controls.call) return APC.controls.call(name, args);
    var p;
    try { p = APC.bridge.call(name, args || {}); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(null, function (e) {
      APC.emit("error", { message: "Could not complete " + name + ": " + ((e && e.message) || e), source: name });
    });
  }
  function getDesc(id) {
    if (APC.controls && APC.controls.params) return APC.controls.params.get(id, false);
    return call("apc.params.get", { id: id }).then(function (d) { return (d && !d.error) ? d : null; });
  }
  function modelFor(desc) { return (APC.controls && APC.controls.Model) ? new APC.controls.Model(desc) : null; }
  function fmt(model, v) { return model ? model.format(v) : String(v); }

  var info = null, infoReq = false;
  function loadInfo() {
    if (infoReq || !APC.bridge) return;
    infoReq = true;
    call("apc.info", {}).then(function (i) {
      if (i && !i.error) { info = i; APC.emit("info:loaded", i); refreshButtons(); }
    });
  }
  function helpModeAvailable() { return !(info && info.features && info.features.helpMode === false); }

  /* ---- state ---- */
  var S = { started: false, dragging: false, hoverEl: null, focusEl: null, timer: 0, tip: null, tipFor: null,
            mode: false, idle: "", bars: [], buttons: [], manual: null, offs: [] };

  function paramEl(node) {
    while (node && node.nodeType === 1) { if (node.hasAttribute && node.hasAttribute("data-param")) return node; node = node.parentNode; }
    return null;
  }
  function tooltipEnabled() { return prefs.get("tooltips") !== false; }

  /* ---- text builders (descriptor.help only) ---- */
  function currentValue(el, desc) {
    var hd = el && el.__apcCtl;
    return hd ? hd.getValue() : (desc ? desc.value : undefined);
  }
  function proseOf(desc) {
    var hp = (desc && desc.help) || {}, parts = [];
    if (hp.what) parts.push(hp.what);
    if (hp.effect) parts.push(hp.effect);
    return parts.join(" ");
  }
  function infoLine(el, desc) {
    var model = modelFor(desc), v = currentValue(el, desc), hp = (desc && desc.help) || {};
    var s = "[" + (desc.name || desc.id) + "] " + (model ? fmt(model, model.snap(model.fromWire(v))) : String(v));
    if (model) s += " (default " + fmt(model, model.def) + ")";
    var body = proseOf(desc);
    if (body) s += " — " + body;
    s += " " + (hp.how ? hp.how + " " : "") + MOD + "+Click to reset.";
    return s;
  }

  /* ---- info bar ---- */
  function barsRender() {
    var text, i, b, kind;
    if (S.mode) { text = "Help mode: click any control to read its manual entry. Press Esc or F1 to leave."; kind = "mode"; }
    else if (S.hoverText && tooltipEnabled()) { text = S.hoverText; kind = "hover"; }
    else { text = S.idle || ""; kind = "idle"; }
    for (i = 0; i < S.bars.length; i++) {
      b = S.bars[i];
      b.textContent = text;
      b.setAttribute("data-state", kind);
    }
  }
  function setHoverFor(el) {
    if (!el) { S.hoverText = ""; barsRender(); return; }
    var id = el.getAttribute("data-param");
    getDesc(id).then(function (d) {
      if (!d) return;
      if (S.infoFor !== el && S.hoverEl !== el && S.focusEl !== el) return;
      S.hoverText = infoLine(el, d);
      barsRender();
      if (el === S.focusEl && el.setAttribute) el.setAttribute("aria-description", proseOf(d));
    });
    S.infoFor = el;
  }
  function refreshInfo() { var el = S.hoverEl || S.focusEl; if (el) setHoverFor(el); }

  /* ---- tooltip ---- */
  function ensureTip() {
    if (S.tip && document.body.contains(S.tip)) return S.tip;
    S.tip = h("div", { class: "apc-tooltip", role: "tooltip", id: "apc-tooltip", hidden: true });
    document.body.appendChild(S.tip);
    return S.tip;
  }
  function hideTooltip() {
    if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
    if (S.tip) { S.tip.hidden = true; S.tip.classList.remove("is-visible"); }
    if (S.tipFor && S.tipFor.removeAttribute) S.tipFor.removeAttribute("aria-describedby");
    S.tipFor = null;
  }
  function tooltipVisible() { return !!(S.tip && !S.tip.hidden); }
  function showTooltip(el) {
    if (!el || S.dragging || !tooltipEnabled() || S.mode) return;
    var id = el.getAttribute("data-param");
    getDesc(id).then(function (desc) {
      if (!desc || S.dragging || S.hoverEl !== el && S.focusEl !== el && S.forced !== el) return;
      var model = modelFor(desc), tip = ensureTip(), hp = desc.help || {}, v = currentValue(el, desc);
      APC.dom.clear(tip);
      tip.appendChild(h("div", { class: "apc-tooltip__title" },
        h("b", { text: desc.name || desc.id }),
        h("span", { class: "apc-tooltip__val", text: model ? fmt(model, model.snap(model.fromWire(v))) : String(v) })));
      var prose = proseOf(desc);
      if (prose) tip.appendChild(h("div", { class: "apc-tooltip__body", text: prose }));
      if (model) tip.appendChild(h("div", { class: "apc-tooltip__meta", text: "Range " + model.rangeText() + " · Default " + fmt(model, model.def) }));
      tip.appendChild(h("div", { class: "apc-tooltip__keys", text: (hp.how ? hp.how + " · " : "") + MOD + "-Click: reset · Shift-Drag: fine" }));
      tip.hidden = false;
      placeTip(tip, el);
      tip.classList.add("is-visible");
      S.tipFor = el;
      el.setAttribute("aria-describedby", "apc-tooltip");
    });
  }
  function placeTip(tip, el) {
    var r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), gap = 6, m = 4;
    var top = r.top - t.height - gap;               /* anchored above the control: never under the pointer / readout */
    if (top < m) top = r.bottom + gap;              /* no room above -> below */
    if (top + t.height > window.innerHeight - m) top = Math.max(m, Math.min(top, window.innerHeight - t.height - m));
    var left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - t.width - m));
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
  }

  /* ---- title="" attributes -> the kit tooltip ----------------------------------------------------------
     A native title would pop up an OS-styled bubble beside the kit's own tooltip. While the pointer is over such an
     element the attribute is moved to data-apc-title (so the OS shows nothing) and the text appears in the kit
     tooltip after the usual delay; it is put back as soon as the pointer leaves. */
  function releaseTitle() {
    if (S.titleTimer) { clearTimeout(S.titleTimer); S.titleTimer = 0; }
    var el = S.titleEl, txt = S.titleTxt;
    S.titleEl = null; S.titleTxt = "";
    if (el) {
      el.removeAttribute("data-apc-title");
      if (txt && !el.hasAttribute("title")) el.setAttribute("title", txt);
      if (S.titleTip) { S.titleTip = false; hideTooltip(); }
    }
  }
  function adoptTitle(target) {
    var el = target && target.closest ? target.closest("[title]") : null;
    if (!el && target && target.closest) el = target.closest("[data-apc-title]");
    if (el === S.titleEl) return;
    releaseTitle();
    if (!el) return;
    var txt = el.getAttribute("title");
    if (!txt) return;
    S.titleEl = el; S.titleTxt = txt;
    el.setAttribute("data-apc-title", txt);
    el.removeAttribute("title");
    if (paramEl(el) || S.mode || S.dragging || !tooltipEnabled()) return;   /* parameter controls have their own rich tooltip */
    var delay = Number(prefs.get("tooltip_delay_ms"));
    if (!isFinite(delay) || delay < 0) delay = 400;
    S.titleTimer = setTimeout(function () {
      S.titleTimer = 0;
      if (S.titleEl !== el || S.dragging || S.mode || !tooltipEnabled() || !document.body.contains(el)) return;
      var tip = ensureTip();
      APC.dom.clear(tip);
      tip.appendChild(h("div", { class: "apc-tooltip__title" }, h("b", { text: txt })));
      tip.hidden = false;
      placeTip(tip, el);
      tip.classList.add("is-visible");
      S.titleTip = true;
    }, delay);
  }

  /* ---- delegated listeners ---- */
  function onOver(e) {
    if (e.pointerType === "touch") return;
    adoptTitle(e.target);
    var c = paramEl(e.target);
    if (c === S.hoverEl) return;
    S.hoverEl = c;
    hideTooltip();
    if (!c) { if (!S.focusEl) { S.hoverText = ""; barsRender(); } return; }
    setHoverFor(c);
    if (S.dragging || !tooltipEnabled() || S.mode) return;
    var delay = Number(prefs.get("tooltip_delay_ms"));
    if (!isFinite(delay) || delay < 0) delay = 400;
    S.timer = setTimeout(function () { S.timer = 0; if (!S.dragging && S.hoverEl === c) showTooltip(c); }, delay);
  }
  function onOut(e) {
    if (!e.relatedTarget) releaseTitle();
    if (!e.relatedTarget && S.hoverEl) { S.hoverEl = null; hideTooltip(); if (!S.focusEl) { S.hoverText = ""; barsRender(); } }
  }
  function onDownAny() { hideTooltip(); }
  function onFocusIn(e) {
    var c = paramEl(e.target);
    S.focusEl = c;
    if (c) setHoverFor(c);
  }
  function onFocusOut(e) {
    if (paramEl(e.target) === S.focusEl) { S.focusEl = null; if (!S.hoverEl) { S.hoverText = ""; barsRender(); } }
  }
  function typing(t) {
    var tag = t && t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable);
  }
  function onKeyDown(e) {
    hideTooltip();
    if (e.key === "F1") { if (helpModeAvailable()) { e.preventDefault(); toggleMode(); } return; }
    if (e.key === "?" && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) { if (helpModeAvailable()) { e.preventDefault(); toggleMode(); } return; }
    if (e.key === "Escape") {
      if (S.manual) { e.preventDefault(); closeManual(true); }
      else if (S.mode) { e.preventDefault(); mode(false); }
    }
  }
  function swallow(e) {
    var t = e.target;
    if (S.manual && S.manual.node.contains(t)) return;
    if (t.closest && t.closest("[data-apc='help-button'], .apc-help-btn, .apc-toasts, .apc-manual")) return;
    e.preventDefault(); e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type === "click") {
      var c = paramEl(t);
      if (c) openManual(c.getAttribute("data-param"));
      else APC.toast.info("No help entry for this element. Click a control, or press Esc to leave help mode.", 2500);
    }
  }
  var SWALLOW = ["pointerdown", "mousedown", "click", "dblclick", "contextmenu", "pointerup", "mouseup"];

  function add(target, type, fn, cap) {
    target.addEventListener(type, fn, !!cap);
    S.offs.push(function () { target.removeEventListener(type, fn, !!cap); });
  }
  function start() {
    if (S.started) return;
    S.started = true;
    add(document, "pointerover", onOver);
    add(document, "pointerout", onOut);
    add(document, "pointerdown", onDownAny, true);
    add(document, "wheel", onDownAny, true);
    add(document, "contextmenu", onDownAny, true);
    add(document, "focusin", onFocusIn);
    add(document, "focusout", onFocusOut);
    add(document, "keydown", onKeyDown, true);
    S.offs.push(APC.on("ctl:drag", function (e) { S.dragging = !!(e && e.active); if (S.dragging) hideTooltip(); }));
    S.offs.push(APC.on("context:opened", hideTooltip));
    S.offs.push(APC.on("prefs:changed", function () { if (!tooltipEnabled()) { hideTooltip(); S.hoverText = ""; } barsRender(); }));
    loadInfo();
    if (APC.bridge && APC.bridge.on) {
      var u = APC.bridge.on("param", function () { refreshInfo(); });
      if (typeof u === "function") S.offs.push(u);
    }
  }
  function destroy() {
    releaseTitle();
    hideTooltip();
    if (S.mode) mode(false);
    closeManual(false);
    for (var i = 0; i < S.offs.length; i++) { try { S.offs[i](); } catch (e) {} }
    S.offs = []; S.started = false; S.dragging = false; S.hoverEl = null; S.focusEl = null;
    if (S.tip && S.tip.parentNode) S.tip.parentNode.removeChild(S.tip);
    S.tip = null;
  }

  /* ---- help mode ---- */
  function refreshButtons() {
    var i, b, ok = helpModeAvailable();
    for (i = 0; i < S.buttons.length; i++) {
      b = S.buttons[i];
      b.setAttribute("aria-pressed", S.mode ? "true" : "false");
      b.hidden = !ok;
    }
  }
  function mode(on) {
    on = !!on;
    if (on && !helpModeAvailable()) return;
    if (on === S.mode) return;
    S.mode = on;
    hideTooltip();
    document.documentElement.classList.toggle("apc-help-mode", on);
    var i;
    if (on) { for (i = 0; i < SWALLOW.length; i++) add(document, SWALLOW[i], swallow, true); S.modeOffs = S.offs.splice(S.offs.length - SWALLOW.length, SWALLOW.length); }
    else if (S.modeOffs) { for (i = 0; i < S.modeOffs.length; i++) S.modeOffs[i](); S.modeOffs = null; }
    refreshButtons();
    barsRender();
    APC.emit("help:mode", { on: on });
  }
  function toggleMode() { mode(!S.mode); }

  /* ---- manual entry overlay ---- */
  function gestureList() {
    return [
      MOD + "+Click: reset to the default",
      "Double-click: " + (prefs.get("double_click") === "value_entry" ? "type a value" : "reset to the default"),
      "Click the value: type a number (units such as Hz, kHz, dB, % are understood)",
      "Drag: adjust · Shift+Drag: fine · " + (IS_MAC ? "Cmd" : "Ctrl") + "+Drag: extra fine",
      "Mouse wheel / arrow keys: nudge (Shift = fine, PageUp/PageDown = coarse)",
      "Right-click, Shift+F10 or the ⋯ button: modulation, MIDI learn, value entry"
    ];
  }
  function closeManual(refocus) {
    if (!S.manual) return;
    var m = S.manual; S.manual = null;
    document.removeEventListener("keydown", m.onKey, true);
    if (m.node.parentNode) m.node.parentNode.removeChild(m.node);
    if (refocus && m.restore && document.body.contains(m.restore)) { try { m.restore.focus({ preventScroll: true }); } catch (e) { m.restore.focus(); } }
    APC.emit("help:manual", { open: false });
  }
  function openManual(id) {
    closeManual(false);
    var restore = document.activeElement;
    return getDesc(id).then(function (desc) {
      if (!desc) { APC.toast.warn("No manual entry for “" + id + "”.", 3000); return; }
      var model = modelFor(desc), hp = desc.help || {}, hid = "apc-man-" + String(id).replace(/[^a-z0-9_-]/gi, "");
      var body = h("div", { class: "apc-manual__body" });
      function sect(title, text) { if (text) body.appendChild(h("section", { class: "apc-man__sec" }, h("h3", { text: title }), h("p", { text: text }))); }
      sect("What is it?", hp.what);
      sect("What does it do to the sound?", hp.effect);
      sect("How do I work it?", hp.how);
      if (!hp.what && !hp.effect && !hp.how) body.appendChild(h("p", { class: "apc-man__none", text: "No help text has been written for this parameter yet." }));
      var meta = [];
      if (model) { meta.push("Range " + model.rangeText()); meta.push("Default " + fmt(model, model.def)); }
      if (typeof desc.midiCc === "number") meta.push("MIDI CC " + desc.midiCc);
      if (meta.length) body.appendChild(h("p", { class: "apc-man__meta", text: meta.join(" · ") }));
      var ul = h("ul", { class: "apc-man__keys" });
      gestureList().forEach(function (g) { ul.appendChild(h("li", { text: g })); });
      body.appendChild(h("section", { class: "apc-man__sec" }, h("h3", { text: "Gestures" }), ul));
      var foot = h("div", { class: "apc-manual__foot" });
      var docs = info && info.links && info.links.docs;
      if (docs) foot.appendChild(h("button", { class: "apc-btn", type: "button", text: "Open full manual",
        onclick: function () { call("apc.openUrl", { url: docs }); } }));
      var closeBtn = h("button", { class: "apc-btn apc-btn--primary", type: "button", "data-k": "close", text: "Close", onclick: function () { closeManual(true); } });
      foot.appendChild(closeBtn);
      var dlg = h("div", { class: "apc-manual", role: "dialog", "aria-modal": "true", "aria-labelledby": hid, tabindex: "-1" },
        h("h2", { class: "apc-manual__title", id: hid, text: desc.name || id }), body, foot);
      var overlay = h("div", { class: "apc-manual-overlay", "data-for": id }, dlg);
      overlay.addEventListener("pointerdown", function (e) { if (e.target === overlay) closeManual(true); });
      var onKey = function (e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeManual(true); return; }
        if (e.key === "Tab") {
          var f = APC.dom.focusables(dlg), a = document.activeElement;
          if (!f.length) return;
          if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
          else if (!dlg.contains(a)) { e.preventDefault(); f[0].focus(); }
        }
      };
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(overlay);
      S.manual = { node: overlay, onKey: onKey, restore: restore };
      hideTooltip();
      closeBtn.focus();
      if (S.mode) mode(false);
      APC.emit("help:manual", { open: true, id: id });
    });
  }

  /* ---- components ---- */
  APC.register("infobar", function (el, o) {
    el.classList.add("apc-infobar");
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "off");
    if (o && o.idle) S.idle = S.idle || o.idle;
    S.bars.push(el);
    start(); loadInfo();
    barsRender();
    return { dispose: function () { var i = S.bars.indexOf(el); if (i > -1) S.bars.splice(i, 1); } };
  });
  APC.register("help-button", function (el, o) {
    var b = el;
    if (el.tagName !== "BUTTON") { b = h("button", {}); el.appendChild(b); }
    b.type = "button";
    b.classList.add("apc-btn", "apc-help-btn");
    b.setAttribute("aria-label", "Help mode: then click any control");
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("title", "Help (F1 or ?)");
    b.textContent = o && o.text ? o.text : "?";
    var click = function () { toggleMode(); };
    b.addEventListener("click", click);
    S.buttons.push(b);
    start(); loadInfo();
    refreshButtons();
    return { dispose: function () { b.removeEventListener("click", click); var i = S.buttons.indexOf(b); if (i > -1) S.buttons.splice(i, 1); } };
  });

  APC.help = {
    mode: mode, toggleMode: toggleMode, isMode: function () { return S.mode; },
    openManual: openManual, closeManual: closeManual, manualOpen: function () { return !!S.manual; },
    showTooltip: function (el) { S.forced = el; showTooltip(el); },
    hideTooltip: hideTooltip, tooltipVisible: tooltipVisible, tooltipEnabled: tooltipEnabled,
    tooltipNode: function () { return S.tip; },
    titleTooltips: true,   /* [title] attributes are shown by the kit tooltip while hovered (never the OS bubble) */
    setIdleText: function (t) { S.idle = t || ""; barsRender(); },
    start: start, destroy: destroy
  };
  start();
})();
