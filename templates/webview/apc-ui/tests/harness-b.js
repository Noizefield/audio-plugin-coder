/* =============================================================================
   harness-b.js — tiny self-test harness for the kit-B pages (classic script).
   Loaded by tests/kit-b-*.html after apc-kit.js / apc-mock.js / the components.
   Result contract (CONTRACT.md "Testing contract"):
     window.__APC_TEST__ = { pass, fail, failures:[...] } and <pre id="apc-test-result"> JSON.
   No dependence on kit-A files.
   ============================================================================= */
(function () {
  "use strict";
  var APC = window.APC;
  var T = (window.T = {});
  var tests = [], mounted = null, results = { page: document.title, pass: 0, fail: 0, total: 0, failures: [], names: [] };

  T.test = function (name, fn) { tests.push({ name: name, fn: fn }); };
  T.assert = function (cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); };
  T.eq = function (a, b, msg) {
    var x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) throw new Error((msg || "values differ") + ": expected " + y + " but got " + x);
  };
  T.q = function (sel, root) { return (root || document).querySelector(sel); };
  T.qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  T.text = function (sel, root) { var n = T.q(sel, root); return n ? n.textContent : null; };
  T.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  /* poll until fn() is truthy (virtual time makes this cheap) */
  T.wait = function (fn, msg, ms) {
    var end = (ms || 3000), waited = 0;
    return new Promise(function (resolve, reject) {
      (function poll() {
        var v; try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (waited >= end) return reject(new Error("timed out waiting for: " + (msg || fn)));
        waited += 5; setTimeout(poll, 5);
      })();
    });
  };
  T.click = function (el) { if (!el) throw new Error("click: element not found"); el.click(); };
  T.key = function (el, key, opts) {
    if (!el) throw new Error("key: element not found");
    var ev = new KeyboardEvent("keydown", { key: key, bubbles: true, cancelable: true, shiftKey: !!(opts && opts.shift), ctrlKey: !!(opts && opts.ctrl), metaKey: !!(opts && opts.meta) });
    el.dispatchEvent(ev); return ev;
  };
  T.input = function (el, value) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  T.choose = function (select, value) { select.value = String(value); select.dispatchEvent(new Event("change", { bubbles: true })); };
  T.check = function (cb, on) { if (cb.checked !== on) cb.click(); };
  T.bridge = function (name, args) { return APC.bridge.call(name, args || {}); };
  T.toasts = function (kind) { return T.qa(".apc-toast" + (kind ? "--" + kind : "")); };

  /* fresh deterministic world for each test */
  T.reset = function (scenario) {
    try { if (mounted) mounted.dispose(); } catch (e) {}
    mounted = null;
    if (APC.__kb && APC.__kb.closeAll) APC.__kb.closeAll();
    T.qa(".apc-toasts").forEach(function (n) { n.innerHTML = ""; });
    var stage = document.getElementById("stage");
    stage.innerHTML = "";
    APC.mock.reset();
    APC.mock.config({ tickMs: 5 });
    if (scenario) APC.mock.scenario(scenario);
    document.body.focus();
    return stage;
  };
  T.mount = function (html) {
    var stage = document.getElementById("stage");
    stage.innerHTML = html;
    mounted = APC.mount(stage);
    return stage;
  };
  /* resolves after pending promise microtasks and the mock's own timers have settled */
  T.settle = function () { return T.sleep(30); };

  function finish() {
    var res = { page: results.page, pass: results.pass, fail: results.fail, total: results.total, failures: results.failures, names: results.names };
    window.__APC_TEST__ = res;
    var pre = document.getElementById("apc-test-result");
    if (!pre) { pre = document.createElement("pre"); pre.id = "apc-test-result"; document.body.appendChild(pre); }
    pre.textContent = JSON.stringify(res);
  }
  window.addEventListener("error", function (e) { results.fail++; results.failures.push("uncaught: " + e.message); });
  window.addEventListener("unhandledrejection", function (e) { results.fail++; results.failures.push("unhandled rejection: " + (e.reason && e.reason.message || e.reason)); });

  T.run = function () {
    var i = 0;
    function next() {
      if (i >= tests.length) { finish(); return; }
      var t = tests[i++], done = false;
      results.total++;
      function ok() { if (done) return; done = true; results.pass++; results.names.push("ok " + t.name); next(); }
      function bad(e) { if (done) return; done = true; results.fail++; results.failures.push(t.name + ": " + (e && e.message ? e.message : String(e))); results.names.push("FAIL " + t.name); next(); }
      var guard = setTimeout(function () { bad(new Error("test timed out")); }, 20000);
      try {
        var r = t.fn();
        if (r && r.then) r.then(function () { clearTimeout(guard); ok(); }, function (e) { clearTimeout(guard); bad(e); });
        else { clearTimeout(guard); ok(); }
      } catch (e) { clearTimeout(guard); bad(e); }
    }
    next();
  };
})();
