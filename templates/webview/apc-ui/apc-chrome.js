/* =============================================================================
   apc-chrome.js — APC UI kit window chrome: header (brand lockup), footer
   (version always visible - U-16), corner gripper + scale steps (U-08),
   day/night theme (U-07). Classic script (ES5-safe); extends window.APC.
   Load after apc-controls.js and apc-help.js.

   Components:
     <header data-apc="header"></header>      brand lockup + Help/Save slots + theme + scale + gear
     <footer data-apc="footer"></footer>      info bar/preset, [DEMO]/[TRIAL n d], ↑ update, v<semver>
     <div class="apc-grip" data-apc="gripper"></div>   aspect-locked, 5 % snap, persists via apc.ui.setScale
     <div data-apc="scale"></div>             50..300 % in 25 % steps, - / +
     <div data-apc="theme-switch"></div>      Night / Day / Follow OS (only when features.themeEnabled)
   API:  APC.chrome = { scale:{get,set,step,steps,range}, theme:{apply,mode,start,resolved} }
   Bus out: settings:open  license:open  update:open  scale:changed {scale}  theme:changed {mode,theme}
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.__chrome) return;
  if (!APC.register || !APC.dom) { if (window.console) console.error("apc-chrome.js: load apc-kit.js first"); return; }
  APC.__chrome = true;
  var h = APC.dom.el;

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

  function call(name, args) {
    if (APC.controls && APC.controls.call) return APC.controls.call(name, args);
    var p;
    try { p = APC.bridge.call(name, args || {}); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function (r) {
      if (r && r.error) APC.emit("error", { message: "Could not complete " + name + ": " + (r.message || r.error), source: name });
      return r;
    }, function (e) {
      APC.emit("error", { message: "Could not complete " + name + ": " + ((e && e.message) || e), source: name });
    });
  }

  /* ---- apc.info (shared, loaded once) ---- */
  var info = null, infoP = null;
  function loadInfo(force) {
    if (infoP && !force) return infoP;
    if (!APC.bridge) return Promise.resolve(null);
    infoP = call("apc.info", {}).then(function (i) {
      if (i && !i.error) { info = i; APC.emit("info:loaded", i); }
      return info;
    });
    return infoP;
  }
  function feature(name) { return !!(info && info.features && info.features[name]); }
  function link(name) { var u = info && info.links && info.links[name]; return (typeof u === "string" && u) ? u : ""; }

  /* ============================================================================
     Theme (U-07): Night / Day / Follow-OS; sets data-theme="night|day" on <html>
     ============================================================================ */
  var MODES = ["follow-os", "night", "day"];
  var MODE_LABEL = { "follow-os": "Follow OS", night: "Night", day: "Day" };
  var mq = null, themeState = { mode: "follow-os", started: false, enabled: false };
  try { mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null; } catch (e) { mq = null; }
  function resolved(mode) {
    if (mode === "day" || mode === "night") return mode;
    return (mq && mq.matches) ? "day" : "night";
  }
  function applyTheme(mode) {
    if (MODES.indexOf(mode) < 0) mode = "follow-os";
    themeState.mode = mode;
    var t = resolved(mode), root = document.documentElement;
    root.setAttribute("data-theme", t);
    root.setAttribute("data-theme-mode", mode);
    APC.emit("theme:changed", { mode: mode, theme: t });
    return t;
  }
  function startTheme() {
    if (themeState.started) return Promise.resolve();
    if (!APC.bridge) return Promise.resolve();
    themeState.started = true;
    return Promise.all([loadInfo(), prefs.reload()]).then(function () {
      themeState.enabled = feature("themeEnabled");
      if (!themeState.enabled) { APC.emit("theme:available", { enabled: false }); return; }
      applyTheme(prefs.get("theme") || "follow-os");
      APC.emit("theme:available", { enabled: true });
    });
  }
  if (mq) {
    var onMq = function () { if (themeState.enabled && themeState.mode === "follow-os") applyTheme("follow-os"); };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  APC.on("prefs:changed", function (p) {
    if (themeState.enabled && p && p.theme && p.theme !== themeState.mode) applyTheme(p.theme);
  });

  /* ============================================================================
     Scale (U-08): one value, written by steps, +/- and the gripper
     ============================================================================ */
  var SCALE = { value: 1, min: 0.5, max: 3, loaded: false };
  var STEPS = [], si;
  for (si = 50; si <= 300; si += 25) STEPS.push(si / 100);
  function snap5(x) { return parseFloat((Math.round(x * 20) / 20).toFixed(2)); }
  function clampScale(x) { return Math.min(SCALE.max, Math.max(SCALE.min, x)); }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function setScale(x, persist) {
    x = clampScale(snap5(x));
    SCALE.value = x;
    prefs.set({ scale: x });
    APC.emit("scale:changed", { scale: x });
    if (persist === false) return Promise.resolve(x);
    return call("apc.ui.setScale", { scale: x }).then(function (r) {
      if (r && !r.error && typeof r.scale === "number" && r.scale !== x) { SCALE.value = r.scale; APC.emit("scale:changed", { scale: r.scale }); }
      return SCALE.value;
    });
  }
  function stepScale(dir) {
    var cur = SCALE.value, i, t = null;
    if (dir > 0) { for (i = 0; i < STEPS.length; i++) if (STEPS[i] > cur + 1e-6) { t = STEPS[i]; break; } }
    else { for (i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] < cur - 1e-6) { t = STEPS[i]; break; } }
    if (t === null) return Promise.resolve(cur);
    return setScale(t);
  }
  function loadScale() {
    if (SCALE.loaded || !APC.bridge) return Promise.resolve(SCALE.value);
    SCALE.loaded = true;
    return call("apc.ui.getPrefs", {}).then(function (r) {
      if (r && !r.error && typeof r.scale === "number") { SCALE.value = clampScale(r.scale); APC.emit("scale:changed", { scale: SCALE.value }); }
      return SCALE.value;
    });
  }

  APC.register("scale", function (el, o) {
    if (o.min) SCALE.min = Math.max(0.5, parseFloat(o.min) || 0.5);
    if (o.max) SCALE.max = Math.min(3, parseFloat(o.max) || 3);
    el.classList.add("apc-scale");
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Interface scale");
    var out = h("output", { class: "apc-scale__val", "aria-live": "polite", text: pct(SCALE.value) });
    var minus = h("button", { class: "apc-btn apc-scale__btn", type: "button", "aria-label": "Smaller interface", title: "Smaller", text: "−" });
    var plus = h("button", { class: "apc-btn apc-scale__btn", type: "button", "aria-label": "Larger interface", title: "Larger", text: "+" });
    el.appendChild(minus); el.appendChild(out); el.appendChild(plus);
    function paint() {
      out.textContent = pct(SCALE.value);
      minus.disabled = SCALE.value <= SCALE.min + 1e-6;
      plus.disabled = SCALE.value >= SCALE.max - 1e-6;
    }
    var onMinus = function () { stepScale(-1); }, onPlus = function () { stepScale(1); };
    minus.addEventListener("click", onMinus);
    plus.addEventListener("click", onPlus);
    var off = APC.on("scale:changed", paint);
    paint();
    loadScale();
    return { dispose: function () { off(); minus.removeEventListener("click", onMinus); plus.removeEventListener("click", onPlus); } };
  });

  /* ---- corner gripper ---- */
  APC.register("gripper", function (el) {
    el.classList.add("apc-grip");
    el.setAttribute("role", "slider");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Resize interface (drag, or use the arrow keys)");
    el.setAttribute("aria-valuemin", String(Math.round(SCALE.min * 100)));
    el.setAttribute("aria-valuemax", String(Math.round(SCALE.max * 100)));
    var badge = h("span", { class: "apc-grip__badge", "aria-hidden": "true", hidden: true });
    el.appendChild(badge);
    if (APC.attachGrip) APC.attachGrip(el);                 /* native resizeGrip plumbing (apc-fit.js); idempotent */
    var drag = null;
    function paint() {
      el.setAttribute("aria-valuenow", String(Math.round(SCALE.value * 100)));
      el.setAttribute("aria-valuetext", pct(SCALE.value));
    }
    function preview(e, d) {
      var dx = e.screenX - d.sx, dy = e.screenY - d.sy;               /* screen coords: stable while the window resizes */
      var k = (dx * d.w0 + dy * d.h0) / (d.w0 * d.w0 + d.h0 * d.h0);  /* aspect-locked projection */
      return clampScale(snap5(d.scale0 * (1 + k)));
    }
    function down(e) {
      if (e.button !== 0 && e.button !== undefined) return;
      drag = { sx: e.screenX, sy: e.screenY, scale0: SCALE.value,
               w0: Math.max(1, window.innerWidth), h0: Math.max(1, window.innerHeight), last: SCALE.value };
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
    }
    function move(e) {
      if (!drag) return;
      var s = preview(e, drag);
      drag.last = s;
      badge.hidden = false; badge.textContent = pct(s);
      el.setAttribute("data-dragging", "true");
    }
    function up(e) {
      if (!drag) return;
      var d = drag; drag = null;
      var s = (e && e.type === "pointerup") ? preview(e, d) : d.scale0;
      badge.hidden = true; el.removeAttribute("data-dragging");
      if (e && e.type === "pointerup" && Math.abs(s - d.scale0) > 1e-6) setScale(s);   /* persist on release */
    }
    function key(e) {
      var d = 0;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") d = 0.05;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -0.05;
      else if (e.key === "PageUp") d = 0.25;
      else if (e.key === "PageDown") d = -0.25;
      if (d) { e.preventDefault(); setScale(SCALE.value + d); }
    }
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("keydown", key);
    var off = APC.on("scale:changed", paint);
    paint();
    loadScale();
    return { dispose: function () {
      off();
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("keydown", key);
    } };
  });

  /* ---- theme switch button ---- */
  APC.register("theme-switch", function (el) {
    el.classList.add("apc-theme-switch");
    var b = (el.tagName === "BUTTON") ? el : h("button", {});
    if (b !== el) el.appendChild(b);
    b.type = "button"; b.classList.add("apc-btn");
    function paint() {
      b.textContent = (themeState.mode === "night" ? "☾ " : themeState.mode === "day" ? "☀ " : "◐ ") + MODE_LABEL[themeState.mode];
      b.setAttribute("aria-label", "Theme: " + MODE_LABEL[themeState.mode] + ". Click to change");
      b.title = "Theme: " + MODE_LABEL[themeState.mode];
      el.hidden = !themeState.enabled;
    }
    var click = function () {
      var next = MODES[(MODES.indexOf(themeState.mode) + 1) % MODES.length];
      applyTheme(next);
      prefs.set({ theme: next });
      call("apc.settings.set", { patch: { ui: { theme: next } } });
      paint();
    };
    b.addEventListener("click", click);
    var o1 = APC.on("theme:changed", paint), o2 = APC.on("theme:available", paint);
    el.hidden = true;
    paint();
    startTheme();
    return { dispose: function () { b.removeEventListener("click", click); o1(); o2(); } };
  });

  /* ============================================================================
     Header: brand lockup (logo -> company URL, name -> product URL; only when configured)
     ============================================================================ */
  function openUrl(url) { call("apc.openUrl", { url: url }); }       /* user click only; native allow-lists */
  function brandPart(cls, text, url, what, imgSrc) {
    var inner = imgSrc ? h("img", { class: "apc-brand__logo", src: imgSrc, alt: text || "" }) : document.createTextNode(text || "");
    if (!text && !imgSrc) return null;
    if (!url) return h("span", { class: cls }, inner);
    return h("button", { class: cls + " apc-brand__link", type: "button", "aria-label": "Open " + what + " website: " + (text || ""),
      title: "Open " + what + " website", onclick: function () { openUrl(url); } }, inner);
  }

  APC.register("header", function (el, o) {
    el.classList.add("apc-header");
    var kids = [], c = el.firstChild;
    while (c) { kids.push(c); c = c.nextSibling; }
    var brand = h("div", { class: "apc-brand" });
    var centre = h("div", { class: "apc-header__slot", "data-slot": "center" });
    kids.forEach(function (k) { centre.appendChild(k); });
    var tools = h("div", { class: "apc-header__tools" });
    var slotSave = h("div", { class: "apc-header__save", "data-slot": "save" });
    var tail = [];
    if (o.save === "true") slotSave.appendChild(h("button", { class: "apc-btn", type: "button", "aria-label": "Save preset", title: "Save preset (Ctrl/Cmd+S)", text: "Save",
      onclick: function () { APC.emit("preset:save"); } }));
    else if (APC.components && APC.components().indexOf("save-button") >= 0) slotSave.appendChild(h("div", { "data-apc": "save-button" }));
    tools.appendChild(slotSave);
    if (o.help !== "false") tools.appendChild(h("div", { class: "apc-header__help", "data-slot": "help", "data-apc": "help-button" }));
    tools.appendChild(h("div", { class: "apc-header__theme", "data-slot": "theme", "data-apc": "theme-switch" }));
    if (o.scale !== "false") tools.appendChild(h("div", { class: "apc-header__scale", "data-slot": "scale", "data-apc": "scale" }));
    tools.appendChild(h("button", { class: "apc-btn apc-gear", type: "button", "aria-label": "Settings", title: "Settings",
      onclick: function () { APC.emit("settings:open"); }, text: "⚙" }));
    el.appendChild(brand); el.appendChild(centre); el.appendChild(tools);

    function paintBrand() {
      APC.dom.clear(brand);
      var mfr = (info && info.manufacturer) || o.manufacturer || "", prod = (info && info.product) || o.product || "";
      var a = brandPart("apc-brand__mfr", mfr, link("company"), mfr || "company", o.logoSrc);
      var b = brandPart("apc-brand__name", prod, link("product"), prod || "product");
      if (a) brand.appendChild(a);
      if (a && b) brand.appendChild(h("span", { class: "apc-brand__sep", "aria-hidden": "true", text: "|" }));
      if (b) brand.appendChild(b);
    }
    paintBrand();
    APC.mount(el);
    loadInfo().then(paintBrand);
    startTheme();
    return { dispose: function () {}, repaint: paintBrand };
  });

  /* ============================================================================
     Footer (U-16): version ALWAYS visible; [DEMO]/[TRIAL n d]; ↑ update; preset + dirty
     ============================================================================ */
  APC.register("footer", function (el, o) {
    el.classList.add("apc-footer");
    var ver = h("span", { class: "apc-version", "data-testid": "apc-version" });
    var badge = h("button", { class: "apc-badge", type: "button", hidden: true, "aria-label": "Licence status" });
    var upd = h("button", { class: "apc-update-note", type: "button", hidden: true });
    var left, usesBar = !!APC.help;
    if (usesBar) left = h("div", { class: "apc-footer__info", "data-apc": "infobar" });
    else left = h("span", { class: "apc-footer__preset", role: "status" });
    el.appendChild(left); el.appendChild(badge); el.appendChild(upd); el.appendChild(ver);

    function paintVersion(v) {
      v = String(v || "").replace(/^v/i, "");
      ver.textContent = "v" + (v || "—");
      ver.setAttribute("aria-label", "Version " + (v || "unknown"));
    }
    paintVersion(o.version || (info && info.version) || "");
    if (usesBar) APC.mount(el);

    function paintLicense(st) {
      var s = st && st.state, txt = "";
      if (s === "DEMO") txt = "[DEMO]";
      else if (s === "TRIAL") txt = "[TRIAL " + (typeof st.daysLeft === "number" ? st.daysLeft : "?") + " d]";
      else if (s === "UNVERIFIED") txt = "[UNVERIFIED]";
      badge.hidden = !txt;
      badge.textContent = txt;
      badge.setAttribute("data-state", s || "");
      badge.setAttribute("aria-label", txt ? "Licence status: " + txt.replace(/[\[\]]/g, "") + ". Click to open activation" : "Licence status");
    }
    function paintUpdate(u) {
      var s = u && u.state, txt = "";
      if (s === "UpdateAvailable") txt = "↑ update available";
      else if (s === "Downloading" || s === "Verifying") txt = "↑ update downloading";
      else if (s === "ReadyToInstall") txt = "↑ update ready to install";
      upd.hidden = !txt;
      upd.textContent = txt;
      upd.title = (u && u.latest) ? ("Version " + u.latest + " is available") : "An update is available";
      upd.setAttribute("aria-label", txt ? txt.replace("↑ ", "") + ". Click for details" : "Update");
    }
    function paintPreset(ps) {
      var cur = ps && ps.current, txt = cur && cur.name ? (cur.name + (cur.dirty ? " *" : "")) : "";
      if (usesBar) APC.help.setIdleText(txt);
      else left.textContent = txt;
    }
    var offs = [];
    var onBadge = function () { APC.emit("license:open"); }, onUpd = function () { APC.emit("update:open"); };
    badge.addEventListener("click", onBadge);
    upd.addEventListener("click", onUpd);

    loadInfo().then(function (i) { if (i) paintVersion(i.version); });
    call("apc.license.status", {}).then(function (r) { if (r && !r.error) paintLicense(r); });
    call("apc.update.state", {}).then(function (r) { if (r && !r.error) paintUpdate(r); });
    call("apc.presets.state", {}).then(function (r) { if (r && !r.error) paintPreset(r); });
    if (APC.bridge && APC.bridge.on) {
      [["license", function (ev) { paintLicense(ev && (ev.status || ev)); }],
       ["update", function (ev) { paintUpdate(ev && (ev.state ? (typeof ev.state === "object" ? ev.state : ev) : ev)); }],
       ["preset", function (ev) { paintPreset(ev && ev.state ? ev.state : ev); }]].forEach(function (p) {
        var u = APC.bridge.on(p[0], p[1]);
        if (typeof u === "function") offs.push(u);
      });
    }
    return { dispose: function () {
      badge.removeEventListener("click", onBadge); upd.removeEventListener("click", onUpd);
      for (var i = 0; i < offs.length; i++) offs[i]();
    } };
  });

  APC.chrome = {
    scale: { get: function () { return SCALE.value; }, set: setScale, step: stepScale, steps: STEPS.slice(),
             range: function () { return [SCALE.min, SCALE.max]; }, snap5: snap5 },
    theme: { apply: applyTheme, mode: function () { return themeState.mode; }, start: startTheme,
             resolved: resolved, enabled: function () { return themeState.enabled; } },
    info: function () { return info; }
  };
  Promise.resolve().then(startTheme);
})();
