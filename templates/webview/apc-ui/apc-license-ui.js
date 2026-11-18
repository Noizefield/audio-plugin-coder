/* =============================================================================
   apc-license-ui.js — activation dialog / license status (serial, license file, offline request, deactivate)
   Component: [data-apc="license"] (inline). Sheet: APC.licenseUI.open() or APC.emit("license:open", {verb}).
   Classic script (no modules, no network). Contract: CONTRACT.md. Guide: .agents/guides/ui-kit-panels.md
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.licenseUI) return;
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

  /* ---- text ------------------------------------------------------------------------------------ */
  var VERB_LABEL = { PresetSave: "Saving presets", PackExport: "Exporting preset packs", PackInstall: "Installing preset packs" };
  var ERR_TEXT = {
    missing_serial: "Enter your serial number first.",
    invalid_serial: "That serial number was not recognized. Check it for typing mistakes and try again.",
    invalid_email: "That email address does not look right.",
    seat_limit: "All seats for this license are already in use. Deactivate another computer first, or contact support.",
    network: "Could not reach the activation server. Check your internet connection, or use offline activation below.",
    invalid_file: "That file is not a valid license file.",
    unverified: "The license file failed verification, so it was not installed. Your current state is unchanged.",
    unsupported: "This option is not available in this product."
  };
  function explain(s, mode) {
    var name = s.name ? " to " + s.name : "";
    if (s.state === "LICENSED") return { why: "Licensed" + name + ". Everything is unlocked.", next: "To move your license to another computer, deactivate this one first." };
    if (s.state === "TRIAL") return { why: "Trial: everything is unlocked for " + s.daysLeft + " more days. After that the plugin continues in Demo mode.",
      next: mode === "signed-file" ? "Load your license file to keep everything unlocked." : "Enter a serial number or load a license file to keep everything unlocked." };
    if (s.state === "UNVERIFIED") return { why: "This license could not be verified on this computer (for example the hardware changed or the license file was modified). The plugin keeps working in Demo mode; nothing is lost.",
      next: mode === "signed-file" ? "Load your license file again, or contact support." : "Activate again online, load your license file again, or contact support." };
    return { why: "Demo mode: audio and every parameter work fully. Saving your own presets and exporting or installing preset packs are locked.",
      next: mode === "signed-file" ? "Load your license file to unlock them." : "Enter your serial number or load a license file to unlock them." };
  }
  function errMsg(r) { return (r.message && String(r.message)) || ERR_TEXT[r.error] || ("Failed: " + r.error); }

  /* ---- render(container, opts) -> { dispose } ----------------------------------------------------- */
  function render(container, opts) {
    opts = opts || {};
    var status = null, mode = "none", busy = false, disposed = false, built = null, offs = [], docDrop = [];
    var root = el("div", { "class": "apc-lc" });
    var badge = el("span", { "class": "apc-kb-badge apc-lc__badge", "data-k": "badge" });
    var why = el("p", { "class": "apc-lc__why", "data-k": "why" });
    var next = el("p", { "class": "apc-lc__next apc-kb-note", "data-k": "next" });
    var detail = el("p", { "class": "apc-lc__detail apc-kb-note", "data-k": "detail", hidden: true });
    var lead = el("p", { "class": "apc-lc__lead", "data-k": "lead", hidden: true });
    var fb = el("div", { "class": "apc-lc__feedback", "data-k": "feedback", "aria-live": "polite" });
    var head = el("div", { "class": "apc-lc__status", role: "group", "aria-label": "License status" }, badge, why, next, detail);
    var form = el("div", { "class": "apc-lc__form" });
    root.appendChild(lead); root.appendChild(head); root.appendChild(fb); root.appendChild(form);
    container.appendChild(root);
    if (opts.lead) { lead.textContent = opts.lead; lead.hidden = false; }

    var f = { serial: null, email: null, paste: null, resp: null, code: null, deact: null, activate: null, offlineBtn: null, loadBtn: null, pasteBtn: null, respBtn: null, copyBtn: null };

    function say(kind, text) {
      KB_clear(fb);
      if (!text) return;
      fb.appendChild(el("div", { "class": "apc-lc__msg apc-lc__msg--" + kind, role: kind === "err" ? "alert" : "status", "data-kind": kind, text: text }));
    }
    function KB_clear(n) { APC.dom.clear(n); }
    function setBusy(b) {
      busy = b;
      ["activate", "offlineBtn", "loadBtn", "pasteBtn", "respBtn", "deact"].forEach(function (k) { if (f[k]) f[k].disabled = b; });
      root.setAttribute("aria-busy", b ? "true" : "false");
    }
    function apply(res, okText) {
      setBusy(false);
      if (KB.isErr(res)) {
        say("err", errMsg(res));
        if (res.error === "io" || res.error === "exception" || res.error === "no_bridge") KB.fail(res, "license");
        return false;
      }
      say("ok", okText);
      if (res && res.status) { status = res.status; draw(); }
      return true;
    }
    function doActivate() {
      var serial = f.serial.value.replace(/^\s+|\s+$/g, ""), email = f.email.value.replace(/^\s+|\s+$/g, "");
      if (!serial) { say("err", ERR_TEXT.missing_serial); f.serial.focus(); return; }
      setBusy(true); say("info", "Activating…");
      KB.call("apc.license.activate", { serial: serial, email: email || undefined }).then(function (r) { if (apply(r, "Activated. Thank you!")) f.serial.value = ""; });
    }
    function loadText(text, label) {
      setBusy(true); say("info", "Checking license…");
      KB.call("apc.license.loadFile", { text: text }).then(function (r) { apply(r, "License file loaded."); });
    }
    function readFile(file) {
      if (!file) return;
      if (file.size > 65536) { say("err", "That file is too large to be a license file."); return; }
      var rd = new FileReader();
      rd.onload = function () { loadText(String(rd.result), file.name); };
      rd.onerror = function () { say("err", "Could not read " + file.name + "."); KB.fail("Could not read the license file " + file.name, "license"); };
      rd.readAsText(file);
    }
    function dropHandlers(target) {
      function over(e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { e.preventDefault(); target.classList.add("is-drop"); } }
      function leave() { target.classList.remove("is-drop"); }
      function drop(e) {
        target.classList.remove("is-drop");
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length && !e.__apcLicHandled) { e.__apcLicHandled = true; e.preventDefault(); readFile(files[0]); }
      }
      target.addEventListener("dragover", over); target.addEventListener("dragleave", leave); target.addEventListener("drop", drop);
      return function () { target.removeEventListener("dragover", over); target.removeEventListener("dragleave", leave); target.removeEventListener("drop", drop); };
    }

    function build() {
      KB_clear(form); built = mode; docDrop.forEach(function (d) { d(); }); docDrop = [];
      f = { serial: null, email: null, paste: null, resp: null, code: null, deact: null, activate: null, offlineBtn: null, loadBtn: null, pasteBtn: null, respBtn: null, copyBtn: null };
      if (mode === "none") { root.hidden = true; return; }
      root.hidden = false;
      var online = mode === "online-activation";
      if (online) {
        var sid = KB.uid("apc-lc-s"), eid = KB.uid("apc-lc-e");
        f.serial = el("input", { "class": "apc-kb-input", id: sid, type: "text", "data-k": "serial", autocomplete: "off", spellcheck: "false", placeholder: "XXXX-XXXX-XXXX-XXXX" });
        f.email = el("input", { "class": "apc-kb-input", id: eid, type: "email", "data-k": "email", autocomplete: "email", placeholder: "you@example.com" });
        f.activate = KB.btn("Activate", doActivate, "apc-kb-btn--primary", { "data-k": "activate" });
        f.serial.addEventListener("keydown", function (e) { if (e.key === "Enter") doActivate(); });
        f.email.addEventListener("keydown", function (e) { if (e.key === "Enter") doActivate(); });
        form.appendChild(el("div", { "class": "apc-kb-field" }, el("label", { "for": sid, text: "Serial number" }), f.serial));
        form.appendChild(el("div", { "class": "apc-kb-field" }, el("label", { "for": eid, text: "Email (optional)" }), f.email));
        form.appendChild(el("div", { "class": "apc-lc__row" }, f.activate));
      }
      /* load file (+ drag and drop + paste fallback) */
      var input = el("input", { type: "file", accept: ".lic,.json,.txt", hidden: true, "data-k": "file", "aria-hidden": "true", tabindex: "-1" });
      input.addEventListener("change", function () { readFile(input.files && input.files[0]); input.value = ""; });
      f.loadBtn = KB.btn("Load License File…", function () { input.click(); }, "", { "data-k": "load-file" });
      var zone = el("div", { "class": "apc-lc__drop", "data-k": "drop" }, f.loadBtn, el("span", { "class": "apc-kb-note", text: " or drop a .lic file here" }), input);
      docDrop.push(dropHandlers(zone));
      if (opts.dropTarget === "document") docDrop.push(dropHandlers(document.documentElement));
      form.appendChild(zone);
      var pasteId = KB.uid("apc-lc-p");
      f.paste = el("textarea", { "class": "apc-kb-input apc-lc__text", id: pasteId, rows: "3", "data-k": "paste", spellcheck: "false", placeholder: "{ \"schema\": \"apc-license/1.0\", … }" });
      f.pasteBtn = KB.btn("Use pasted license", function () {
        if (!f.paste.value.replace(/\s/g, "")) { say("err", "Paste the license text first."); f.paste.focus(); return; }
        loadText(f.paste.value);
      }, "", { "data-k": "use-paste" });
      form.appendChild(el("details", { "class": "apc-lc__more", "data-k": "paste-box" }, el("summary", { text: "Paste license text instead" }),
        el("label", { "for": pasteId, "class": "apc-kb-sr", text: "License text" }), f.paste, el("div", { "class": "apc-lc__row" }, f.pasteBtn)));
      if (online) {
        var codeId = KB.uid("apc-lc-c"), respId = KB.uid("apc-lc-r");
        f.offlineBtn = KB.btn("Create request code", function () {
          setBusy(true);
          KB.call("apc.license.offlineRequest").then(function (r) {
            setBusy(false);
            if (KB.isErr(r)) { say("err", errMsg(r)); return; }
            f.code.value = r.requestCode || ""; f.code.parentNode.hidden = false; say("info", "Request code created. Copy it, then follow the steps below.");
            f.code.focus(); f.code.select();
          });
        }, "", { "data-k": "offline-request" });
        f.code = el("textarea", { "class": "apc-kb-input apc-lc__text", id: codeId, rows: "2", readonly: true, "data-k": "request-code" });
        f.copyBtn = KB.btn("Copy code", function () {
          KB.copyText(f.code.value, f.code).then(function (ok) { say(ok ? "ok" : "info", ok ? "Request code copied." : "Select the code above and copy it with Ctrl/Cmd+C."); });
        }, "", { "data-k": "copy-code" });
        f.resp = el("textarea", { "class": "apc-kb-input apc-lc__text", id: respId, rows: "3", "data-k": "response", spellcheck: "false", placeholder: "Paste the license you receive here" });
        f.respBtn = KB.btn("Apply response", function () {
          if (!f.resp.value.replace(/\s/g, "")) { say("err", "Paste the response from the activation page first."); f.resp.focus(); return; }
          loadText(f.resp.value);
        }, "apc-kb-btn--primary", { "data-k": "apply-response" });
        form.appendChild(el("details", { "class": "apc-lc__more", "data-k": "offline" }, el("summary", { text: "Activate offline (no internet on this computer)" }),
          el("ol", { "class": "apc-lc__steps apc-kb-note" },
            el("li", { text: "Create a request code here and copy it." }),
            el("li", { text: "On a computer with internet, open the activation page and paste the code." }),
            el("li", { text: "Copy the license you receive and paste it below." })),
          el("div", { "class": "apc-lc__row" }, f.offlineBtn),
          el("div", { "class": "apc-kb-field", hidden: true }, el("label", { "for": codeId, text: "Request code" }), f.code, el("div", { "class": "apc-lc__row" }, f.copyBtn)),
          el("div", { "class": "apc-kb-field" }, el("label", { "for": respId, text: "Response from the activation page" }), f.resp),
          el("div", { "class": "apc-lc__row" }, f.respBtn)));
      }
      f.deact = KB.btn("Deactivate This Machine", function () {
        KB.confirm({ title: "Deactivate this machine?", message: "The license is removed from this computer and the plugin returns to Demo mode. You can activate again later.", ok: "Deactivate", danger: true }).then(function (yes) {
          if (!yes) return;
          setBusy(true);
          KB.call("apc.license.deactivate").then(function (r) { apply(r, "This machine is deactivated."); });
        });
      }, "apc-kb-btn--danger", { "data-k": "deactivate" });
      form.appendChild(el("div", { "class": "apc-lc__row apc-lc__row--end" }, f.deact));
    }

    function draw() {
      if (disposed || !status) return;
      var m = status.mode || mode;
      if (m !== built) { mode = m; build(); }
      mode = m;
      if (mode === "none") return;
      var ex = explain(status, mode);
      badge.textContent = KB.badgeText(status);
      badge.setAttribute("data-state", status.state);
      why.textContent = ex.why; next.textContent = ex.next;
      detail.textContent = status.message || ""; detail.hidden = !status.message;   /* native banner text, shown as supplied */
      if (f.deact) f.deact.hidden = !(status.state === "LICENSED" || status.state === "UNVERIFIED");
    }
    function setStatus(s) { status = s; draw(); }

    offs.push(KB.on("license", function (ev) { setStatus((ev && ev.status) || ev); }));
    KB.call("apc.license.status").then(function (s) {
      if (disposed) return;
      if (KB.isErr(s)) { KB.fail(s, "license"); return; }
      setStatus(s);
    });
    return {
      dispose: function () {
        disposed = true; offs.forEach(function (o) { o(); }); docDrop.forEach(function (d) { d(); });
        if (root.parentNode) root.parentNode.removeChild(root);
      },
      root: root
    };
  }

  /* ---- activation sheet (opened by gated verbs / the footer badge via license:open) ---------------------- */
  var current = null;
  function open(o) {
    o = o || {};
    if (current) { current.panel.focus(); return Promise.resolve(current); }
    return KB.call("apc.license.status").then(function (s) {
      if (KB.isErr(s)) { KB.fail(s, "license"); return null; }
      if (s.mode === "none") return null;                         /* licensing disabled: nothing to show */
      if (current) return current;
      var lead = o.verb ? ((VERB_LABEL[o.verb] || "This feature") + " needs a license. Everything else keeps working in Demo mode.") : (o.lead || "");
      var sh = KB.sheet({ title: "Activate", "class": "apc-lc-sheet", onClose: function () { if (r) r.dispose(); current = null; } });
      var r = render(sh.body, { lead: lead, dropTarget: "document" });
      sh.foot.appendChild(KB.btn("Later", function () { sh.close("later"); }, "", { "data-k": "later" }));
      sh.panel.setAttribute("data-apc-sheet", "license");
      current = sh;
      sh.focusFirst();
      return sh;
    });
  }
  function close() { if (current) current.close("api"); }

  APC.licenseUI = { render: render, open: open, close: close, isOpen: function () { return !!current; } };
  APC.__licenseUi = true;
  APC.on("license:open", function (d) { open(d || {}); });
  APC.register("license", function (node, o) {
    var r = render(node, { dropTarget: o.dropTarget });
    return { dispose: r.dispose };
  });
})();
