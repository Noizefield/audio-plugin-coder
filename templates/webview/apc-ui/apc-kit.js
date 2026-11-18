/* =============================================================================
   apc-kit.js — APC UI kit core (classic script; extends window.APC)
   Event bus, DOM helper, component registry/mount, toast, number formatting,
   tiny store. No network, no modules (webview-008). Contract: CONTRACT.md.
   Load order: apc-fit.js, apc-kit.js, apc-bridge.js, apc-mock.js (optional),
   then the components.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__kitCore) return;
  APC.__kitCore = true;

  /* ---- event bus --------------------------------------------------------- */
  var handlers = {};
  APC.on = function (name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    return function () { APC.off(name, fn); };
  };
  APC.off = function (name, fn) {
    var l = handlers[name]; if (!l) return;
    var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1);
  };
  APC.emit = function (name, data) {
    var l = (handlers[name] || []).slice();
    for (var i = 0; i < l.length; i++) {
      try { l[i](data); } catch (e) { if (name !== "error") APC.emit("error", { message: "handler failed: " + name, detail: String(e), source: "bus" }); }
    }
  };

  /* ---- DOM helper: el("div", {class:"x", "data-a":1, onclick:fn}, child...) - */
  APC.dom = {
    el: function (tag, attrs) {
      var node = document.createElement(tag);
      var k, v;
      for (k in (attrs || {})) {
        v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : String(v));
      }
      for (var i = 2; i < arguments.length; i++) APC.dom.append(node, arguments[i]);
      return node;
    },
    append: function (node, child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) { for (var i = 0; i < child.length; i++) APC.dom.append(node, child[i]); return; }
      node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
    },
    clear: function (node) { while (node.firstChild) node.removeChild(node.firstChild); },
    focusables: function (root) {
      return Array.prototype.slice.call(root.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
    }
  };

  /* ---- component registry ------------------------------------------------ */
  var components = {};
  APC.register = function (name, init) { components[name] = init; };
  APC.components = function () { return Object.keys(components); };
  function optsFromData(el) {
    var o = {}, a = el.attributes;
    for (var i = 0; i < a.length; i++) {
      if (a[i].name.indexOf("data-") === 0 && a[i].name !== "data-apc") {
        var key = a[i].name.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
        o[key] = a[i].value;
      }
    }
    return o;
  }
  APC.mount = function (root) {
    root = root || document;
    var mounted = [];
    Array.prototype.forEach.call(root.querySelectorAll("[data-apc]"), function (el) {
      if (el.__apc) return;
      var name = el.getAttribute("data-apc"), init = components[name];
      if (!init) { APC.emit("error", { message: "unknown APC component: " + name, source: "mount" }); return; }
      try { el.__apc = init(el, optsFromData(el), APC) || {}; mounted.push(el.__apc); }
      catch (e) { APC.emit("error", { message: "component failed: " + name, detail: String(e), source: "mount" }); }
    });
    return { dispose: function () { mounted.forEach(function (m) { if (m && m.dispose) m.dispose(); }); } };
  };

  /* ---- toast (visible errors: stone rule 1) ------------------------------ */
  var toastHost = null;
  function host() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = APC.dom.el("div", { class: "apc-toasts", role: "region", "aria-label": "Notifications", "aria-live": "polite" });
    document.body.appendChild(toastHost);
    return toastHost;
  }
  function toast(kind, msg, ms) {
    var t = APC.dom.el("div", { class: "apc-toast apc-toast--" + kind, role: kind === "error" ? "alert" : "status" },
      APC.dom.el("span", { class: "apc-toast__msg", text: msg }),
      APC.dom.el("button", { class: "apc-toast__x", type: "button", "aria-label": "Dismiss", text: "×",
        onclick: function () { if (t.parentNode) t.parentNode.removeChild(t); } }));
    host().appendChild(t);
    if (kind !== "error") setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 3500);
    return t;
  }
  APC.toast = {
    info: function (m, ms) { return toast("info", m, ms); },
    warn: function (m, ms) { return toast("warn", m, ms); },
    error: function (m) { return toast("error", m); }   /* errors stay until dismissed */
  };
  APC.on("error", function (e) { if (e && e.message && !e.quiet) APC.toast.error(e.message); });

  /* ---- number formatting / parsing (real-world units) -------------------- */
  APC.format = {
    value: function (v, unit, digits) {
      if (typeof v !== "number" || !isFinite(v)) return "—";
      var u = unit || "", a = Math.abs(v), d = digits;
      if (u === "Hz" && a >= 1000) return trim(v / 1000, d === undefined ? 2 : d) + " kHz";
      if (u === "s" && a < 1) return trim(v * 1000, d === undefined ? 1 : d) + " ms";
      if (d === undefined) d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
      return trim(v, d) + (u ? " " + u : "");
    },
    /* Parses "850", "850 Hz", "1.2k", "1,2 kHz", "-6 dB", "35%", "20ms". Returns number or null. */
    parse: function (text, unit) {
      if (text === null || text === undefined) return null;
      var s = String(text).trim().replace(",", ".");
      var m = /^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([a-zµ%]*)$/i.exec(s);
      if (!m) return null;
      var n = parseFloat(m[1]), suf = m[2].toLowerCase();
      if (suf === "k" || suf === "khz") return n * 1000;
      if (suf === "ms") return unit === "s" ? n / 1000 : n;
      if (suf === "s" && unit === "ms") return n * 1000;
      return n;
    }
  };
  function trim(n, d) { return String(parseFloat(n.toFixed(d))); }

  /* ---- tiny store -------------------------------------------------------- */
  APC.store = (function () {
    var data = {};
    return {
      get: function (k) { return data[k]; },
      set: function (k, v) { data[k] = v; APC.emit("store:" + k, v); },
      all: function () { return data; }
    };
  })();
})();
