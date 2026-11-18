/* =============================================================================
   apc-context.js — APC UI kit right-click context inspector (U-03).
   Classic script (ES5-safe); extends window.APC. Requires apc-controls.js.
   Sections in this exact order: VALUE -> MODULATION -> MIDI -> HELP.

   API:   APC.context.open(handle, {x,y,via})   handle = el.__apcCtl of a control
          APC.context.close([refocus])  .isOpen()  .panel()
          APC.context.sources = [{id,name}, ...]  (modulation sources offered by "+ Add source")
   Opens: right-click, Shift+F10 / ContextMenu key, the visible "⋯" button, touch long-press.
   Bus out: params:changed {id}   undo:push {label,id,kind}   context:opened/closed {id}
   Esc closes and returns focus; focus is trapped while open.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__context) return;
  if (!APC.register || !APC.dom) { if (window.console) console.error("apc-context.js: load apc-kit.js first"); return; }
  if (!APC.controls) { if (window.console) console.error("apc-context.js: load apc-controls.js first"); return; }
  APC.__context = true;
  var h = APC.dom.el;
  var C = APC.controls;
  var call = C.call;

  var DEFAULT_SOURCES = [
    { id: "lfo1", name: "LFO 1" }, { id: "lfo2", name: "LFO 2" }, { id: "env1", name: "Env 1" }, { id: "env2", name: "Env 2" },
    { id: "macro1", name: "Macro 1" }, { id: "velocity", name: "Velocity" }, { id: "keytrack", name: "Keytrack" },
    { id: "modwheel", name: "Mod Wheel" }, { id: "aftertouch", name: "Aftertouch" }, { id: "random", name: "Random" },
    { id: "breath", name: "Breath" }, { id: "expression", name: "Expression" }
  ];

  var state = null;            /* { handle, node, restore, onKey, onOutside, helpOpen } */
  var selfEmit = false;

  function fmtPct(n) { return (n > 0 ? "+" : "") + Math.round(n) + "%"; }
  function swatch(src) {
    var s = C.sourceStyle(src);
    var d = h("span", { class: "apc-swatch apc-swatch--dash" + s.dash, "aria-hidden": "true" });
    d.style.background = "var(--apc-mod-" + s.n + ", currentColor)";
    return d;
  }
  function btn(text, attrs, onclick) {
    var a = attrs || {};
    a.type = "button"; a["class"] = "apc-btn " + (a["class"] || "");
    a.onclick = onclick; a.text = text;
    return h("button", a);
  }

  function close(refocus) {
    if (!state) return;
    var s = state; state = null;
    document.removeEventListener("pointerdown", s.onOutside, true);
    document.removeEventListener("keydown", s.onKey, true);
    window.removeEventListener("resize", s.onResize);
    if (s.node.parentNode) s.node.parentNode.removeChild(s.node);
    s.handle.el.setAttribute("aria-expanded", "false");
    APC.emit("context:closed", { id: s.handle.id });
    if (refocus) {
      var target = (s.restore && document.body.contains(s.restore)) ? s.restore : s.handle.el;
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function afterChange(label, kind) {
    if (!state) return;
    var hd = state.handle, id = hd.id;
    return C.params.get(id, true).then(function () {
      selfEmit = true;
      try { APC.emit("params:changed", { id: id }); } finally { selfEmit = false; }
      APC.emit("undo:push", { label: label, id: id, kind: kind || "mod" });
      return hd.refresh(false);          /* waits for the in-flight descriptor; handle.desc is current afterwards */
    }).then(function () { if (state && state.handle === hd) build(state.focusKey); });
  }

  function sourcesFor(desc) {
    var list = (APC.context.sources || DEFAULT_SOURCES).slice(), i, extra = (desc && desc.modSources) || [];
    for (i = 0; i < extra.length; i++) list.push(typeof extra[i] === "string" ? { id: extra[i], name: C.sourceName(extra[i]) } : extra[i]);
    return list;
  }

  /* ---- section builders ---- */
  function secValue(hd, desc, model) {
    var sec = section("value", "VALUE");
    sec.appendChild(h("div", { class: "apc-ctx__row" },
      btn("Reset", { "data-k": "reset", title: "Reset to default (base value only; modulation untouched)" }, function () { close(true); hd.reset(); }),
      btn("Enter value…", { "data-k": "enter" }, function () { close(false); hd.enterValue(); }),
      btn("Copy value", { "data-k": "copy" }, function () {
        C.clipboard.value = hd.getValue(); C.clipboard.text = model ? model.format(hd.getValue()) : String(hd.getValue());
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(C.clipboard.text).then(null, function () {}); } catch (e) {}
        APC.toast.info("Copied " + C.clipboard.text, 1500);
        rebuildKeep("copy");
      }),
      btn("Paste", { "data-k": "paste", disabled: C.clipboard.text ? null : true }, function () {
        var r = model ? model.parse(C.clipboard.text) : { ok: false };
        if (!r.ok) { APC.toast.warn("Cannot paste “" + C.clipboard.text + "” into " + (desc && desc.name || hd.id), 3000); return; }
        close(true);
        hd.setValue(r.value, "Paste " + (desc && desc.name || hd.id));
        if (r.clamped) APC.toast.info("Clamped to " + model.rangeText(), 2000);
      })));
    return sec;
  }

  function secMod(hd, desc, model) {
    var sec = section("modulation", "MODULATION"), routes = (desc && desc.modulation) || [], i;
    var longForm = true;
    for (i = 0; i < routes.length; i++) if (/^(uni|bi)$/i.test(String(routes[i].polarity || ""))) longForm = false;
    function pol(bi) { return longForm ? (bi ? "bipolar" : "unipolar") : (bi ? "bi" : "uni"); }
    function save(route, label) { return call("apc.mod.set", { id: hd.id, route: route }).then(function (r) { if (r && !r.error) return afterChange(label); }); }
    function copyRoute(r) { var o = {}, k; for (k in r) o[k] = r[k]; return o; }

    var used = {}, avail = [];
    routes.forEach(function (r) { used[String(r.src)] = true; });
    sourcesFor(desc).forEach(function (s) { if (!used[s.id]) avail.push(s); });

    if (!routes.length) sec.appendChild(h("div", { class: "apc-ctx__note", text: "No modulation routes." }));
    routes.forEach(function (route, ix) {
      var nm = C.sourceName(route), bi = C.isBi(route), amount = typeof route.amount === "number" ? route.amount : 0;
      var amtOut = h("output", { class: "apc-route__amt", text: fmtPct(amount) });
      var amt = h("input", { type: "range", min: "-100", max: "100", step: "1", value: String(amount), "data-k": "amt" + ix, "aria-label": nm + " amount, percent" });
      var amtFill = h("span", { class: "apc-range__fill", "aria-hidden": "true" });
      function paintAmt() {   /* flat slider look: fill from the origin (0 of a zero-centred range) to the thumb */
        var lo = parseFloat(amt.min), hi = parseFloat(amt.max), v = parseFloat(amt.value), o = lo < 0 && hi > 0 ? 0 : lo;
        var p = (v - lo) / (hi - lo), p0 = (o - lo) / (hi - lo);
        amtWrap.style.setProperty("--lo", String(Math.min(p, p0))); amtWrap.style.setProperty("--span", String(Math.abs(p - p0)));
      }
      var amtWrap = h("span", { class: "apc-range" }, amtFill, amt);
      paintAmt();
      amt.addEventListener("input", function () { amtOut.textContent = fmtPct(parseFloat(amt.value)); paintAmt(); });
      amt.addEventListener("change", function () { var r = copyRoute(route); r.amount = parseFloat(amt.value); state.focusKey = "amt" + ix; save(r, "Modulation amount " + nm); });
      function limitInput(which, aria) {
        var cur = route[which], inp = h("input", { type: "text", class: "apc-route__lim", size: "7", "data-k": which + ix, "aria-label": nm + " " + aria + (model && model.unit ? " (" + model.unit + ")" : ""),
          value: typeof cur === "number" && model ? model.format(cur) : "", placeholder: model ? model.format(which === "min" ? model.min : model.max) : "" });
        inp.addEventListener("change", function () {
          var r = copyRoute(route), txt = inp.value.trim();
          if (!txt) r[which] = null;
          else {
            var p = model ? model.parse(txt) : { ok: false };
            if (!p.ok) { inp.classList.add("apc-invalid"); inp.setAttribute("aria-invalid", "true"); APC.toast.warn("Range " + which + ": " + (p.reason || "invalid"), 2500); return; }
            r[which] = p.value;
          }
          state.focusKey = which + ix; save(r, "Modulation range " + nm);
        });
        return inp;
      }
      /* source dropdown (U-03): changing it re-routes this slot to another source */
      function srcSelect(rt, i, label) {
        var sel = h("select", { class: "apc-ctx__select apc-route__name", "data-k": "src" + i, "aria-label": "Source of route " + (i + 1) },
          h("option", { value: String(rt.src), text: label, selected: true }));
        avail.forEach(function (o) { sel.appendChild(h("option", { value: o.id, text: o.name || C.sourceName(o.id) })); });
        sel.addEventListener("change", function () {
          if (!sel.value || sel.value === String(rt.src)) return;
          var nr = copyRoute(rt); nr.src = sel.value; state.focusKey = "src" + i;
          call("apc.mod.remove", { id: hd.id, src: rt.src }).then(function (r) {
            if (r && !r.error) return save(nr, "Change modulation source " + label + " → " + C.sourceName(nr.src));
          });
        });
        return sel;
      }
      var row = h("div", { class: "apc-route" + (route.bypass ? " is-bypassed" : ""), role: "group", "aria-label": "Route: " + nm, "data-src": String(route.src) },
        h("div", { class: "apc-route__src" }, swatch(route.src), srcSelect(route, ix, nm)),
        h("label", { class: "apc-route__amount" }, amtWrap, amtOut),
        btn(bi ? "bi" : "uni", { "data-k": "pol" + ix, "aria-pressed": bi ? "true" : "false", "aria-label": nm + " polarity: " + (bi ? "bipolar" : "unipolar") + ", click to switch", title: "Polarity" }, function () {
          var r = copyRoute(route); r.polarity = pol(!bi); state.focusKey = "pol" + ix; save(r, "Modulation polarity " + nm);
        }),
        h("span", { class: "apc-route__range" }, limitInput("min", "range minimum"), h("span", { "aria-hidden": "true", text: "–" }), limitInput("max", "range maximum")),
        btn(route.bypass ? "off" : "on", { "data-k": "byp" + ix, "aria-pressed": route.bypass ? "true" : "false", "aria-label": nm + (route.bypass ? " bypassed, click to enable" : " active, click to bypass"), title: "Bypass" }, function () {
          var r = copyRoute(route); r.bypass = !route.bypass; state.focusKey = "byp" + ix; save(r, "Modulation bypass " + nm);
        }),
        btn("✕", { "data-k": "del" + ix, "aria-label": "Remove " + nm + " route", title: "Remove route" }, function () {
          state.focusKey = "add";
          call("apc.mod.remove", { id: hd.id, src: route.src }).then(function (r) { if (r && !r.error) afterChange("Remove modulation " + nm); });
        }));
      sec.appendChild(row);
    });

    var sel = h("select", { class: "apc-ctx__select", "data-k": "add", "aria-label": "Add modulation source" }, h("option", { value: "", text: "+ Add source…" }));
    avail.forEach(function (s) { sel.appendChild(h("option", { value: s.id, text: s.name || C.sourceName(s.id) })); });
    sel.addEventListener("change", function () {
      if (!sel.value) return;
      var src = sel.value, nm = C.sourceName(src);
      var route = { src: src, amount: 50, polarity: pol(false), min: model ? model.min : null, max: model ? model.max : null, bypass: false };
      state.focusKey = "add";
      save(route, "Add modulation " + nm);
    });
    sec.appendChild(h("div", { class: "apc-ctx__row" }, sel,
      btn("Clear all modulation", { "data-k": "clear", disabled: routes.length ? null : true }, function () {
        state.focusKey = "add";
        call("apc.mod.clear", { id: hd.id }).then(function (r) { if (r && !r.error) afterChange("Clear modulation"); });
      })));
    return sec;
  }

  function secMidi(hd, desc) {
    var sec = section("midi", "MIDI"), cc = desc && desc.midiCc;
    var hasCc = typeof cc === "number";
    var learning = state.learning === true;
    sec.appendChild(h("div", { class: "apc-ctx__row" },
      btn(learning ? "Learning… move a controller" : "MIDI Learn", { "data-k": "learn", "aria-pressed": learning ? "true" : "false" }, function () {
        state.focusKey = "learn";
        call("apc.midi.learn", { id: hd.id }).then(function (r) {
          if (!r || r.error) return;
          if (r.learning === true && (r.cc === undefined || r.cc === null)) { if (state) { state.learning = true; build("learn"); } return; }
          if (state) state.learning = false;
          return afterChange("MIDI learn", "midi");
        });
      }),
      btn("Unlearn", { "data-k": "unlearn", disabled: hasCc || learning ? null : true }, function () {
        state.focusKey = "learn"; state.learning = false;
        call("apc.midi.unlearn", { id: hd.id }).then(function (r) { if (r && !r.error) afterChange("MIDI unlearn", "midi"); });
      }),
      h("span", { class: "apc-ctx__cc", role: "status", text: "CC: " + (hasCc ? cc : "—") })));
    return sec;
  }

  function secHelp(hd, desc) {
    var sec = section("help", "HELP");
    sec.appendChild(h("div", { class: "apc-ctx__row" },
      btn("What’s this?", { "data-k": "what", "aria-expanded": state.helpOpen ? "true" : "false" }, function () {
        if (APC.help && APC.help.openManual) { close(false); APC.help.openManual(hd.id); return; }
        state.helpOpen = !state.helpOpen; state.focusKey = "what"; build("what");
      })));
    if (state.helpOpen) {
      var hp = (desc && desc.help) || {}, box = h("div", { class: "apc-ctx__help", role: "note" });
      ["what", "effect", "how"].forEach(function (k) { if (hp[k]) box.appendChild(h("p", { text: hp[k] })); });
      if (!box.firstChild) box.appendChild(h("p", { text: "No help text for this parameter." }));
      sec.appendChild(box);
    }
    return sec;
  }

  var secSeq = 0;
  function section(key, title) {
    var hid = "apc-ctx-h" + (++secSeq);
    return h("section", { class: "apc-ctx__sec", "data-sec": key, role: "group", "aria-labelledby": hid },
      h("h3", { class: "apc-ctx__h", id: hid, text: title }));
  }

  function rebuildKeep(key) { if (state) { state.focusKey = key; build(key); } }

  function build(focusKey) {
    if (!state) return;
    var hd = state.handle, desc = hd.desc, model = hd.model, node = state.node;
    var keep = focusKey || (node.contains(document.activeElement) && document.activeElement.getAttribute("data-k")) || null;
    APC.dom.clear(node);
    var name = (desc && desc.name) || hd.id;
    node.setAttribute("aria-label", "Options for " + name);
    var headTxt = name;
    if (model) headTxt += " · current " + model.format(hd.getValue()) + " · default " + model.format(model.def);
    node.appendChild(h("div", { class: "apc-ctx__head", text: headTxt }));
    if (!desc) { node.appendChild(h("div", { class: "apc-ctx__note", text: "Parameter details are not available." })); }
    node.appendChild(secValue(hd, desc, model));
    node.appendChild(secMod(hd, desc, model));
    node.appendChild(secMidi(hd, desc));
    node.appendChild(secHelp(hd, desc));
    var tgt = keep ? node.querySelector('[data-k="' + keep + '"]') : null;
    if (!tgt || tgt.disabled) tgt = node.querySelector("button:not([disabled])");
    if (tgt) tgt.focus(); else node.focus();
  }

  function position(node, x, y) {
    var w = window.innerWidth, hgt = window.innerHeight, m = 6, r = node.getBoundingClientRect();
    var left = Math.min(Math.max(m, x), Math.max(m, w - r.width - m));
    var top = y;
    if (top + r.height > hgt - m) top = Math.max(m, hgt - r.height - m);
    node.style.left = left + "px";
    node.style.top = top + "px";
  }

  function open(handle, o) {
    o = o || {};
    if (!handle || !handle.el) return;
    close(false);
    if (APC.controls.closeMenu) APC.controls.closeMenu(false);
    var node = h("div", { class: "apc-popover apc-ctx", role: "dialog", "aria-modal": "false", tabindex: "-1", "aria-label": "Options" });
    state = { handle: handle, node: node, restore: handle.el, focusKey: null, helpOpen: false, learning: false };
    document.body.appendChild(node);
    handle.el.setAttribute("aria-expanded", "true");
    build(null);
    var x = typeof o.x === "number" ? o.x : 0, y = typeof o.y === "number" ? o.y : 0;
    if (o.via === "keyboard" || o.via === "button") {
      var r = handle.el.getBoundingClientRect();
      if (o.via === "keyboard") { x = r.left; y = r.bottom + 2; }
    }
    position(node, x, y);
    state.onKey = function (e) {
      if (!state) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === "Tab") {
        var f = APC.dom.focusables(node).filter(function (n) { return !n.disabled && n.offsetParent !== null || n === document.activeElement; });
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1], a = document.activeElement;
        if (!node.contains(a)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
      }
    };
    state.onOutside = function (e) { if (state && !state.node.contains(e.target)) close(false); };
    state.onResize = function () { close(false); };
    document.addEventListener("keydown", state.onKey, true);
    document.addEventListener("pointerdown", state.onOutside, true);
    window.addEventListener("resize", state.onResize);
    APC.emit("context:opened", { id: handle.id });
  }

  APC.on("params:changed", function (ev) {
    if (!selfEmit && state && ev && ev.id === state.handle.id) {
      /* the control refreshes first (registered earlier); rebuild on the next tick with the new descriptor */
      var hd = state.handle;
      hd.refresh(false).then(function () { if (state && state.handle === hd) build(state.focusKey); });
    }
  });

  APC.context = {
    open: open, close: close,
    isOpen: function () { return !!state; },
    panel: function () { return state ? state.node : null; },
    sources: null
  };
  APC.context.sources = DEFAULT_SOURCES.slice();
})();
