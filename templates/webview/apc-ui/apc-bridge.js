/* =============================================================================
   apc-bridge.js - JS <-> native bridge of the APC UI kit (classic script, ES5).
   Contract: CONTRACT.md. Native side: common/apc/juce/ApcWebBridge.h.
   Load order: apc-fit.js, apc-kit.js, apc-bridge.js, apc-mock.js (optional), components.

     APC.bridge.call (name, args[, {timeoutMs, quiet}])  -> Promise   (NEVER rejects)
     APC.bridge.on   (event, fn)                          -> off()     param preset license update meter error
     APC.bridge.isNative                                  -> true inside a JUCE WebView that registered the kit
     APC.bridge.isError (result)                          -> true for { error: "<code>", message }
     APC.bridge.has (name) / .functions()                 -> what the native side registered

   HOW IT TALKS TO JUCE 9 (the real mechanism, verified against
   _tools/JUCE/modules/juce_gui_extra/native/typescript/webview-interop/dist/index.js):
     * JUCE injects window.__JUCE__ (UPPER case; there is no lower-case window.__juce__) before any page script.
       __JUCE__.initialisationData.__juce__functions lists the registered native function names.
     * a native call is the event  "__juce__invoke" { name, params:[...], resultId }  sent with
       __JUCE__.backend.emitEvent; the answer arrives as the event "__juce__complete" { promiseId, result }.
     * native -> JS events: __JUCE__.backend.addEventListener ("apc.<name>", fn); the C++ side emits them with
       WebBrowserComponent::emitEventIfBrowserIsVisible.
   This file implements that protocol directly so it works whether or not the page also inlined the JUCE
   interop library (webview-008: no modules/external scripts, so the library is pasted into index.html).
   Result ids start at 1e9, so they can never collide with the library's own promise counter (0,1,2,...).

   ERROR MODEL (CONTRACT: never fail silently)
     * Every function takes ONE argument object and resolves with the contract value, or with
       { error:"<code>", message:"<text>", path?:"<file>" }.  The promise never rejects.
     * Errors the PLUGIN answers (not_found, exists, io, invalid, ...) are plain values: the caller presents
       them (every kit component checks r.error and calls APC.emit ("error") or shows an inline message). This file does
       NOT toast them a second time. { error:"gated", verb } is the license gate (L-02): open the activation sheet.
     * INFRASTRUCTURE failures - the plugin never answered or could not be reached - are marked { infra:true } and this
       file emits APC.emit ("error", {message, detail, source}) for them (once), because no component can know they happened:
       "timeout" (no answer within the per-call timeout), "unknown_function" (older plugin build), "transport",
       "no_backend" (not in a native WebView and no APC.mock), "mock_error", "invalid" (bad function name).
       Pass {quiet:true} to suppress that event.
     * Outside a native WebView the call is served by APC.mock (apc-mock.js, resolved lazily because it loads after
       this file). Without a mock the call resolves { error:"no_backend" } - visibly, not silently.
   ============================================================================= */
(function () {
  "use strict";
  var APC = (window.APC = window.APC || {});
  if (APC.bridge && APC.bridge.__apcBridge) return;

  var ID_BASE = 1000000000;
  var DEFAULT_TIMEOUT_MS = 8000;
  var LONG_TIMEOUT_MS = {
    "apc.license.activate": 60000,
    "apc.license.loadFile": 20000,
    "apc.license.deactivate": 30000,
    "apc.presets.rescan": 120000,
    "apc.presets.import": 120000,
    "apc.presets.exportPack": 120000,
    "apc.presets.save": 20000,
    "apc.presets.load": 15000
  };

  var seq = 0;
  var pending = {};            /* resultId -> { done, timer, name } */
  var completeHooked = false;
  var listeners = {};          /* event -> [fn] */
  var nativeHooked = {};       /* event -> true */
  var mockHooked = {};         /* event -> true */

  /* ---- environment ---------------------------------------------------------- */
  function juce() {
    var J = window.__JUCE__;
    return (J && J.backend && typeof J.backend.emitEvent === "function" &&
            typeof J.backend.addEventListener === "function") ? J : null;
  }
  function nativeNames() {
    var J = juce();
    var d = J && J.initialisationData;
    return (d && Object.prototype.toString.call(d.__juce__functions) === "[object Array]") ? d.__juce__functions : null;
  }
  function isNative() {
    var n = nativeNames();
    return !!(n && n.indexOf("apc.info") !== -1);
  }

  /* infrastructure error: infra:true makes call() emit the visible "error" event for it */
  function errObj(code, message, extra) {
    var o = { error: code, message: message, infra: true };
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) o[k] = extra[k]; } }
    return o;
  }
  function isError(r) {
    return !!r && typeof r === "object" && Object.prototype.toString.call(r) !== "[object Array]" && typeof r.error === "string";
  }
  function emitError(info) {
    if (typeof APC.emit === "function") APC.emit("error", info);
    else if (typeof console !== "undefined" && console.error) console.error("[APC]", info.message, info.detail || "");
  }

  /* ---- native call ---------------------------------------------------------- */
  function hookComplete(J) {
    if (completeHooked) return;
    completeHooked = true;
    J.backend.addEventListener("__juce__complete", function (p) {
      var e = p && pending[p.promiseId];
      if (!e) return;                       /* not ours (the JUCE interop library's own promises) */
      delete pending[p.promiseId];
      clearTimeout(e.timer);
      e.done(p.result === undefined ? null : p.result);
    });
  }

  function invokeNative(name, args, timeoutMs, done) {
    var J = juce();
    var names = nativeNames();
    if (names.indexOf(name) === -1) {
      done(errObj("unknown_function", "This plugin build does not provide \"" + name + "\" (update the plugin or the UI kit)."));
      return;
    }
    hookComplete(J);
    var id = ID_BASE + (++seq);
    var entry = { name: name, done: done, timer: null };
    entry.timer = setTimeout(function () {
      if (!pending[id]) return;
      delete pending[id];
      done(errObj("timeout", "The plugin did not answer \"" + name + "\" within " + Math.round(timeoutMs / 1000) + " s."));
    }, timeoutMs);
    pending[id] = entry;
    try {
      J.backend.emitEvent("__juce__invoke", { name: name, params: [args === undefined ? {} : args], resultId: id });
    } catch (e) {
      delete pending[id];
      clearTimeout(entry.timer);
      done(errObj("transport", "Could not send \"" + name + "\" to the plugin: " + String(e && e.message ? e.message : e)));
    }
  }

  /* ---- mock fallback -------------------------------------------------------- */
  function invokeMock(name, args, timeoutMs, done) {
    var m = APC.mock;
    if (!m) {
      done(errObj("no_backend", "No native plugin backend and no APC.mock loaded (open the UI inside the plugin, or include apc-mock.js)."));
      return;
    }
    var fn = typeof m.call === "function" ? m.call : (typeof m.invoke === "function" ? m.invoke : null);
    if (!fn) { done(errObj("no_backend", "APC.mock does not implement call(name, args).")); return; }
    var finished = false;
    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      done(errObj("timeout", "The mock backend did not answer \"" + name + "\"."));
    }, timeoutMs);
    function fin(v) { if (finished) return; finished = true; clearTimeout(timer); done(v === undefined ? null : v); }
    var p;
    try { p = fn.call(m, name, args === undefined ? {} : args); }
    catch (e) { fin(errObj("mock_error", "Mock backend failed in \"" + name + "\": " + String(e && e.message ? e.message : e))); return; }
    Promise.resolve(p).then(fin, function (e) {
      fin(errObj("mock_error", "Mock backend failed in \"" + name + "\": " + String(e && e.message ? e.message : e)));
    });
  }

  /* ---- public: call --------------------------------------------------------- */
  function call(name, args, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      function done(r) {
        if (isError(r) && r.infra === true && !opts.quiet) {
          emitError({ message: r.message || ("Plugin error: " + r.error), detail: r.path || r.error, source: "bridge:" + name });
        }
        resolve(r);
      }
      if (typeof name !== "string" || name.indexOf("apc.") !== 0) {
        done(errObj("invalid", "APC.bridge.call needs a function name starting with \"apc.\" (got " + String(name) + ")."));
        return;
      }
      var ms = opts.timeoutMs || LONG_TIMEOUT_MS[name] || DEFAULT_TIMEOUT_MS;
      if (isNative()) invokeNative(name, args, ms, done);
      else { syncMock(); invokeMock(name, args, ms, done); }
    });
  }

  /* ---- public: events ------------------------------------------------------- */
  function dispatch(evt, payload) {
    var l = (listeners[evt] || []).slice();
    for (var i = 0; i < l.length; i++) {
      try { l[i](payload); }
      catch (e) { emitError({ message: "handler failed: " + evt, detail: String(e), source: "bridge:event" }); }
    }
  }

  function hookNative(evt) {
    if (nativeHooked[evt] || !isNative()) return;
    nativeHooked[evt] = true;
    juce().backend.addEventListener("apc." + evt, function (p) { dispatch(evt, p); });
  }

  /* apc-mock.js loads after this file and its event API is not fixed by the contract: accept mock.on / mock.subscribe,
     and mock code may always push with APC.bridge._dispatch (evt, payload). */
  function syncMock() {
    var m = APC.mock;
    if (!m || isNative()) return;
    var sub = typeof m.on === "function" ? m.on : (typeof m.subscribe === "function" ? m.subscribe : null);
    if (!sub) return;
    for (var evt in listeners) {
      if (!Object.prototype.hasOwnProperty.call(listeners, evt) || mockHooked[evt]) continue;
      mockHooked[evt] = true;
      (function (e) { sub.call(m, e, function (p) { dispatch(e, p); }); })(evt);
    }
  }

  function on(evt, fn) {
    if (typeof fn !== "function") return function () {};
    (listeners[evt] = listeners[evt] || []).push(fn);
    hookNative(evt);
    syncMock();
    return function off() {
      var l = listeners[evt]; if (!l) return;
      var i = l.indexOf(fn); if (i !== -1) l.splice(i, 1);
    };
  }

  function functions() { var n = nativeNames(); return n ? n.filter(function (x) { return x.indexOf("apc.") === 0; }) : []; }

  var bridge = {
    __apcBridge: true,
    version: 1,
    call: call,
    on: on,
    isError: isError,
    has: function (name) { return functions().indexOf(name) !== -1; },
    functions: functions,
    _dispatch: dispatch        /* for apc-mock.js and tests: push a native -> JS event */
  };
  Object.defineProperty(bridge, "isNative", { get: isNative, enumerable: true });
  APC.bridge = bridge;
})();
