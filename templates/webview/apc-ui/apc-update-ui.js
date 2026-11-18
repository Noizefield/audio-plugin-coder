/* =============================================================================
   apc-update-ui.js — update dialog (check, download, verify, ReadyToInstall, failure + retry)
   Component: [data-apc="update"] (inline). Sheet: APC.updateUI.open() or APC.emit("update:open").
   Classic script (no modules, no network). Contract: CONTRACT.md. Guide: .agents/guides/ui-kit-panels.md
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.updateUI) return;
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

  /* ---- state machine view (CONTRACT.md / .agents/guides/updater.md) ------------------------------------------ */
  function norm(ev) { return ev && ev.state && typeof ev.state === "object" ? ev.state : ev; }   /* event payload is {state:{...}} */

  function render(container, opts) {
    opts = opts || {};
    var st = null, disposed = false, offs = [], busy = false;
    var root = el("div", { "class": "apc-up", "data-k": "update" });
    container.appendChild(root);

    function act(fnName, extra) {
      busy = true; draw();
      return KB.call(fnName, extra).then(function (r) {
        busy = false;
        if (KB.isErr(r)) { KB.fail(r, "update"); }
        else if (r && r.state) st = r;
        draw();
        return r;
      });
    }
    function check() { return act("apc.update.check"); }
    function download() { return act("apc.update.download"); }

    function title(text, state) { return el("p", { "class": "apc-up__title", "data-k": "title", text: text, "data-state": state }); }
    function row() { var r = el("div", { "class": "apc-lc__row apc-up__row" }); for (var i = 0; i < arguments.length; i++) if (arguments[i]) r.appendChild(arguments[i]); return r; }

    function draw() {
      if (disposed) return;
      APC.dom.clear(root);
      if (!st) { root.appendChild(el("p", { "class": "apc-kb-note", role: "status", text: "Loading update status…" })); return; }
      var s = st.state || "Idle", cur = st.current ? "v" + st.current : "";
      root.setAttribute("data-state", s);
      if (s === "Idle") {
        root.appendChild(title("You are running " + cur + ".", s));
        root.appendChild(row(KB.btn("Check for Updates", check, "apc-kb-btn--primary", { "data-k": "check", disabled: busy })));
      } else if (s === "Checking") {
        root.appendChild(el("p", { "class": "apc-up__title", "data-k": "title", role: "status", "data-state": s, text: "Checking for updates…" }));
        root.appendChild(el("div", { "class": "apc-up__bar apc-up__bar--busy", role: "progressbar", "aria-label": "Checking for updates" }, el("span", { "class": "apc-up__fill" })));
      } else if (s === "UpToDate") {
        root.appendChild(title("You have the latest version" + (cur ? " (" + cur + ")" : "") + ".", s));
        root.appendChild(row(KB.btn("Check again", check, "", { "data-k": "check", disabled: busy })));
      } else if (s === "UpdateAvailable") {
        root.appendChild(title("Version " + st.latest + " is available (you have " + cur + ").", s));
        if (st.notes) root.appendChild(el("pre", { "class": "apc-up__notes", tabindex: "0", "aria-label": "Release notes", "data-k": "notes", text: st.notes }));
        root.appendChild(el("p", { "class": "apc-kb-note", text: "Downloading does not install anything. You will be asked to close your DAW and run the installer yourself." }));
        root.appendChild(row(KB.btn("Download", download, "apc-kb-btn--primary", { "data-k": "download", disabled: busy }),
          opts.onLater ? KB.btn("Later", opts.onLater, "", { "data-k": "later" }) : null));
      } else if (s === "Downloading" || s === "Verifying") {
        var pct = Math.round(Math.max(0, Math.min(1, Number(st.progress) || 0)) * 100);
        root.appendChild(el("p", { "class": "apc-up__title", "data-k": "title", role: "status", "data-state": s,
          text: s === "Downloading" ? "Downloading version " + st.latest + "… " + pct + "%" : "Verifying the download (signature and checksum)…" }));
        var bar = el("div", { "class": "apc-up__bar", role: "progressbar", "aria-label": s === "Downloading" ? "Download progress" : "Verification", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct), "data-k": "progress" },
          el("span", { "class": "apc-up__fill", style: "width:" + pct + "%" }));
        root.appendChild(bar);
        root.appendChild(row(KB.btn("Cancel", function () { act("apc.update.cancel"); }, "", { "data-k": "cancel", disabled: busy })));
      } else if (s === "ReadyToInstall") {
        root.appendChild(title("Update " + (st.latest ? "v" + st.latest : "") + " is ready to install.", s));
        root.appendChild(el("p", { "class": "apc-up__instruction", "data-k": "instruction", role: "status", text: "Close your DAW, then run this installer." }));
        if (st.installerPath) root.appendChild(el("p", { "class": "apc-up__path", "data-k": "path", text: st.installerPath }));
        root.appendChild(el("p", { "class": "apc-kb-note", text: "This plugin cannot replace itself while your DAW is running, so nothing has been installed yet." }));
        root.appendChild(row(KB.btn("Reveal installer", function () {
          KB.call("apc.update.revealInstaller").then(function (r) { if (KB.isErr(r)) KB.fail(r, "update"); });
        }, "apc-kb-btn--primary", { "data-k": "reveal" })));
      } else if (s === "Failed") {
        root.appendChild(el("p", { "class": "apc-up__title apc-up__title--err", "data-k": "title", role: "alert", "data-state": s, text: "The update did not complete." }));
        root.appendChild(el("p", { "class": "apc-up__error", "data-k": "error", text: st.message || st.error || "Unknown error." }));
        root.appendChild(el("p", { "class": "apc-kb-note", text: "Nothing was installed and your plugin is unchanged." }));
        root.appendChild(row(KB.btn("Try again", function () { if (st.latest) download(); else check(); }, "apc-kb-btn--primary", { "data-k": "retry", disabled: busy })));
      } else {
        root.appendChild(title("Update status: " + s, s));
      }
    }

    offs.push(KB.on("update", function (ev) { var n = norm(ev); if (n && n.state) { st = n; busy = false; draw(); } }));
    draw();
    KB.call("apc.update.state").then(function (s) {
      if (disposed) return;
      if (KB.isErr(s)) { KB.fail(s, "update"); return; }
      st = s; draw();
    });
    return {
      dispose: function () { disposed = true; offs.forEach(function (o) { o(); }); if (root.parentNode) root.parentNode.removeChild(root); },
      root: root, check: check
    };
  }

  var current = null;
  function open() {
    if (current) { current.panel.focus(); return current; }
    var sh = KB.sheet({ title: "Software update", "class": "apc-up-sheet", onClose: function () { if (r) r.dispose(); current = null; } });
    var r = render(sh.body, { onLater: function () { sh.close("later"); } });
    sh.foot.appendChild(KB.btn("Close", function () { sh.close("button"); }, "", { "data-k": "close" }));
    sh.panel.setAttribute("data-apc-sheet", "update");
    current = sh;
    sh.focusFirst();
    return sh;
  }
  APC.updateUI = { render: render, open: open, close: function () { if (current) current.close("api"); }, isOpen: function () { return !!current; } };
  APC.on("update:open", function () { open(); });
  APC.register("update", function (node, o) { var r = render(node, {}); return { dispose: r.dispose }; });
})();
