/* =============================================================================
   kit-theme-plus.js - the theme editor's controls (loads after kit.js)
   Replaces kitTokenControl() with real inputs:
     colour  -> swatch button opening a picker (SV square, hue, alpha, hex,
                EyeDropper, palette)
     length  -> range slider + stepper for plain lengths; expressions stay text
     number  -> stepper + range
   Everything still lands in kitThSet(d, name, value).
   ============================================================================= */
(function () {
  "use strict";
  if (typeof window.kitTokenControl !== "function") return;

  function hex2rgb(h) {
    h = String(h || "").trim().replace(/^#/, "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgb2hex(r, g, b) {
    function p(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length < 2 ? "0" + s : s; }
    return "#" + p(r) + p(g) + p(b);
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, mx ? d / mx : 0, mx];
  }
  function hsv2rgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  
  /* ---- control builders ------------------------------------------------ */
  function textField(name, val) {
    return '<input type="text" class="th-txt" data-th-text="' + esc(name) + '" value="' + esc(val) +
      '" spellcheck="false" aria-label="' + esc(name) + '">';
  }

  function colorControl(d, mode, name, val) {
    var c = kitResolveColor(d, mode, val, 0);
    var hex = c ? kitHex(c) : "#000000";
    var a = c ? c.a : 1;
    return '<button type="button" class="tp-swatch" data-tp-open="' + esc(name) + '" style="--tp-c:' + hex + '"' +
      ' aria-label="Pick a colour for ' + esc(name) + '" title="Open the colour picker"></button>' +
      textField(name, val) +
      (c && a < 1
        ? '<label class="th-alpha" title="alpha">a <input type="number" min="0" max="1" step="0.01" data-th-alpha="' +
          esc(name) + '" value="' + Math.round(a * 100) / 100 + '" aria-label="' + esc(name) + ' alpha"></label>'
        : "");
  }

  function parseLen(v) {
    var m = /^\s*(-?[\d.]+)\s*(px|rem|em|)\s*$/.exec(String(v));
    return m ? { n: parseFloat(m[1]), unit: m[2] || "" } : null;
  }
  function lengthControl(d, mode, name, val) {
    var p = parseLen(val);
    if (!p) return textField(name, val) + '<span class="mut th-unit">expression</span>';
    var unit = p.unit || "rem";
    var max = unit === "px" ? 48 : 4;
    var step = unit === "px" ? 0.5 : 0.05;   // half-pixels matter: radii are 1.5px, 2px, 3px
    return '<input type="range" class="tp-range" data-tp-range="' + esc(name) + '" data-tp-unit="' + esc(unit) +
        '" min="0" max="' + max + '" step="' + step + '" value="' + p.n + '" aria-label="' + esc(name) + '">' +
      '<span class="tp-num">' +
        '<button type="button" class="tp-step" data-tp-step="-1" aria-label="less">-</button>' +
        '<input type="number" class="tp-val" data-tp-num="' + esc(name) + '" data-tp-unit="' + esc(unit) +
          '" min="0" max="' + max + '" step="' + step + '" value="' + p.n + '" aria-label="' + esc(name) + ' value">' +
        '<button type="button" class="tp-step" data-tp-step="1" aria-label="more">+</button>' +
        '<span class="mut tp-u">' + esc(unit || "x") + "</span>" +
      "</span>";
  }

  function numberControl(d, mode, name, val) {
    var n = parseFloat(val);
    if (!isFinite(n)) return textField(name, val);
    var max = Math.max(10, Math.ceil(n * 4));
    var step = n < 5 ? 1 : 0.5;
    return '<input type="range" class="tp-range" data-tp-numrange="' + esc(name) + '" min="0" max="' + max +
        '" step="' + step + '" value="' + n + '" aria-label="' + esc(name) + '">' +
      '<span class="tp-num">' +
        '<button type="button" class="tp-step" data-tp-step="-1" aria-label="less">-</button>' +
        '<input type="number" class="tp-val" data-tp-num="' + esc(name) + '" value="' + n + '" aria-label="' + esc(name) + ' value">' +
        '<button type="button" class="tp-step" data-tp-step="1" aria-label="more">+</button>' +
      "</span>";
  }

  function fontControl(d, mode, name, val) {
    var sets = name === "--font-text" ? d.fontsets.text : d.fontsets.ui;
    var opts = '<option value="">custom...</option>' + (sets || []).map(function (f) {
      return '<option value="' + esc(f.value) + '"' + (f.value === val ? " selected" : "") + ">" +
        esc(f.name || f.label || f.id) + "</option>";
    }).join("");
    return (sets && sets.length
        ? '<select class="th-sel" data-th-font="' + esc(name) + '" aria-label="' + esc(name) + ' font set">' + opts + "</select>"
        : "") +
      '<input type="text" class="th-txt th-wide" data-th-text="' + esc(name) + '" value="' + esc(val) +
        '" spellcheck="false" aria-label="' + esc(name) + '">';
  }

  window.kitTokenControl = function (d, mode, name) {
    var kind = d.kindOf[name] || "value";
    var val = kitValue(d, mode, name);
    if (val === undefined) val = "";
    if (kind === "color") return colorControl(d, mode, name, val);
    if (kind === "length") return lengthControl(d, mode, name, val);
    if (kind === "number") return numberControl(d, mode, name, val);
    if (kind === "font") return fontControl(d, mode, name, val);
    return textField(name, val);
  };
})();

/* =============================================================================
   The colour picker + event wiring for the theme editor's token controls.
   The colour itself is chosen in the browser's colour dialog (hue strip + its own
   eyedropper); PICK is the EyeDropper API for sampling anywhere on screen; the
   chips are the live palette. Every path ends in kitThSet().
   ============================================================================= */
(function () {
  "use strict";
  var P = { el: null, name: null };
  var PAL = ["--plate", "--plate-2", "--inset", "--ink", "--ink-2", "--ink-3",
    "--accent", "--ok", "--apc-danger", "--memory", "--meter-warn"];

  function K() { return window.__kit; }
  function D() { return window.kitDesign && window.kitDesign(K()); }
  function set(name, val) { window.kitThSet(K(), D(), name, val); }

  function build() {
    if (P.el) return P.el;
    var p = document.createElement("div");
    p.className = "tp-pop";
    p.id = "tp-pop";
    p.hidden = true;
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Colour picker");
    p.innerHTML =
      '<div class="tp-row"><input type="color" class="tp-colour" aria-label="colour">' +
      '<input type="text" class="tp-hex" spellcheck="false" aria-label="hex colour"></div>' +
      '<label class="tp-lab"><span>A</span><input type="range" class="tp-alpha2" min="0" max="100" step="1" aria-label="alpha"></label>' +
      '<div class="tp-row"><button type="button" class="tp-drop" title="Sample a colour from anywhere on the screen">PICK</button>' +
      '<button type="button" class="tp-close" aria-label="Close">CLOSE</button></div>' +
      '<div class="tp-pal"></div>';
    document.body.appendChild(p);
    P.el = p;
    wire(p);
    return p;
  }


  function current() {
    var p = P.el;
    var a = Number(p.querySelector(".tp-alpha2").value) / 100;
    var hex = p.querySelector(".tp-colour").value || "#000000";
    if (a >= 0.999) return hex;
    var h = hex.replace("#", "");
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + (Math.round(a * 100) / 100) + ")";
  }
  function sync() {
    var p = P.el;
    var hx = p.querySelector(".tp-hex");
    if (document.activeElement !== hx) hx.value = p.querySelector(".tp-colour").value;
    p.style.setProperty("--tp-live", p.querySelector(".tp-colour").value);
  }
  function paintPalette() {
    var d = D(), pal = P.el.querySelector(".tp-pal");
    pal.innerHTML = "";
    PAL.forEach(function (name) {
      var c = d ? window.kitResolveColor(d, K().mode, window.kitValue(d, K().mode, name), 0) : null;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tp-chip";
      b.title = name;
      b.setAttribute("aria-label", name);
      b.dataset.tpPick = c ? window.kitHex(c) : "";
      b.style.background = b.dataset.tpPick || "transparent";
      pal.appendChild(b);
    });
  }
  function open(name, anchor) {
    build();
    P.name = name;
    var d = D();
    var c = d ? window.kitResolveColor(d, K().mode, window.kitValue(d, K().mode, name), 0) : null;
    var p = P.el;
    p.querySelector(".tp-colour").value = c ? window.kitHex(c) : "#000000";
    p.querySelector(".tp-alpha2").value = String(Math.round((c ? c.a : 1) * 100));
    p.hidden = false;
    paintPalette();
    sync();
    var r = anchor.getBoundingClientRect();
    p.style.top = Math.max(8, Math.min(window.innerHeight - p.offsetHeight - 8, r.bottom + 6)) + "px";
    p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left - 8)) + "px";
    try { p.querySelector(".tp-colour").focus(); } catch (e) { /* ignore */ }
  }
  function close() { if (P.el) P.el.hidden = true; }


  function wire(p) {
    var col = p.querySelector(".tp-colour");
    col.addEventListener("input", function () { sync(); set(P.name, current()); });
    p.querySelector(".tp-hex").addEventListener("change", function (e) {
      var h = e.target.value.trim().replace(/^#/, "");
      if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) { sync(); return; }
      if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
      col.value = "#" + h.toLowerCase();
      sync();
      set(P.name, current());
    });
    p.querySelector(".tp-alpha2").addEventListener("input", function () { set(P.name, current()); });
    p.querySelector(".tp-close").addEventListener("click", close);
    p.querySelector(".tp-drop").addEventListener("click", function () {
      var btn = this;
      if (!window.EyeDropper) { btn.textContent = "N/A"; setTimeout(function () { btn.textContent = "PICK"; }, 1200); return; }
      new window.EyeDropper().open().then(function (r) {
        col.value = r.sRGBHex.toLowerCase();
        sync();
        set(P.name, current());
      }).catch(function () { /* cancelled */ });
    });
    p.querySelector(".tp-pal").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-tp-pick]") : null;
      if (!b || !b.dataset.tpPick) return;
      col.value = b.dataset.tpPick.toLowerCase();
      p.querySelector(".tp-alpha2").value = "100";
      sync();
      set(P.name, current());
    });
    document.addEventListener("pointerdown", function (e) {
      if (p.hidden || p.contains(e.target)) return;
      if (e.target.closest && e.target.closest(".tp-swatch")) return;
      close();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }


  /* ---- delegated wiring: swatches, sliders, steppers -------------------- */
  function fieldValue(input) {
    var n = Number(input.value);
    if (!isFinite(n)) return null;
    var unit = input.getAttribute("data-tp-unit");
    return unit == null ? String(n) : String(n) + unit;
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var sw = t.closest(".tp-swatch");
    if (sw && sw.dataset.tpOpen) { open(sw.dataset.tpOpen, sw); return; }
    var step = t.closest(".tp-step");
    if (!step) return;
    var box = step.parentNode.querySelector(".tp-val");
    if (!box) return;
    var dir = Number(step.dataset.tpStep) < 0 ? -1 : 1;
    var inc = (Number(box.step) || 1) * dir;
    var next = Number(box.value || 0) + inc;
    if (box.min !== "" && isFinite(Number(box.min))) next = Math.max(Number(box.min), next);
    if (box.max !== "" && isFinite(Number(box.max))) next = Math.min(Number(box.max), next);
    box.value = String(Math.round(next * 1000) / 1000);
    var v = fieldValue(box);
    if (v != null) set(box.getAttribute("data-tp-num"), v);
  });
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.dataset) return;
    if (t.classList.contains("tp-range")) {
      var key = t.getAttribute("data-tp-range") || t.getAttribute("data-tp-numrange");
      if (!key) return;
      var val = t.getAttribute("data-tp-range") ? fieldValue(t) : String(Number(t.value));
      if (val != null) set(key, val);
      var box = t.parentNode.querySelector(".tp-val");
      if (box) box.value = t.value;
      return;
    }
    if (t.getAttribute("data-tp-num")) {
      var v2 = fieldValue(t);
      if (v2 != null) set(t.getAttribute("data-tp-num"), v2);
    }
  });
})();

