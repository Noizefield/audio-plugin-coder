/* =============================================================================
   apc-fit.js — APC UI kit runtime (classic script; attaches window.APC)
   Layout geometry is pure CSS (see apc-core.css); this file covers only what
   CSS cannot: canvas backing-store fit and the in-page resize grip.
   webview-008: no ES modules — this file must stay classic-script safe.
   ============================================================================= */
(function () {
  "use strict";

  var NATIVE = (typeof window !== "undefined" && window.__juce__ &&
                typeof window.__juce__.invoke === "function")
    ? window.__juce__.invoke.bind(window.__juce__)
    : null;

  function invokeNative(name) {
    if (!NATIVE) return false;
    var args = Array.prototype.slice.call(arguments, 1);
    try { NATIVE.apply(null, [name].concat(args)); return true; }
    catch (e) { return false; }
  }

  /* ---- fitCanvas(cv, redraw[, opts]) ---------------------------------------
     Keeps a canvas backing store at device resolution: width = CSS box * dpr.
     redraw(ctx, w, h) paints in CSS px (ctx is pre-scaled by dpr).
     Re-fits via ResizeObserver. Returns { dispose }. */
  function fitCanvas(cv, redraw, opts) {
    opts = opts || {};
    var maxDpr = opts.maxDpr || 3;
    function fit() {
      var r = cv.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      var w = Math.max(1, Math.round(r.width * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w; cv.height = h;
      }
      var ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw(ctx, r.width, r.height);
    }
    fit();
    var ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(cv); else window.addEventListener("resize", fit);
    return { dispose: function () { if (ro) ro.disconnect(); else window.removeEventListener("resize", fit); }, refit: fit };
  }

  /* ---- attachGrip(el[, opts]) ------------------------------------------------
     In-page corner resize gripper. Forwards accumulated drag deltas (CSS px =
     JUCE logical px) to the native `resizeGripStart` / `resizeGrip` functions.
     Falls back to a no-op outside JUCE so the preview stays safe in a browser. */
  function attachGrip(el, opts) {
    opts = opts || {};
    var origin = null;
    el.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      origin = { x: e.clientX, y: e.clientY };
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      invokeNative("resizeGripStart");
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!origin) return;
      var dx = e.clientX - origin.x;
      var dy = e.clientY - origin.y;
      invokeNative("resizeGrip", Math.round(dx), Math.round(dy));
      if (opts.onDrag) opts.onDrag(dx, dy);
    });
    function end() { if (origin) { origin = null; invokeNative("resizeGripEnd"); } }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  /* ---- mountKit(root) --------------------------------------------------------
     Auto-wires kit elements inside root: every .apc-grip gets drag forwarding,
     every canvas[data-fit] gets fitCanvas with an optional global redraw fn
     named by data-fit. */
  function mountKit(root) {
    root = root || document;
    Array.prototype.forEach.call(root.querySelectorAll(".apc-grip"), function (g) {
      attachGrip(g);
    });
    Array.prototype.forEach.call(root.querySelectorAll("canvas[data-fit]"), function (cv) {
      var fn = window[cv.getAttribute("data-fit")];
      if (typeof fn === "function") fitCanvas(cv, fn);
    });
  }

  window.APC = {
    invokeNative: invokeNative,
    fitCanvas: fitCanvas,
    attachGrip: attachGrip,
    mountKit: mountKit
  };
})();
