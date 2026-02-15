# WebView Native Function Bridge - Wrong API

**Issue ID:** webview-005
**Category:** webview
**Severity:** critical
**First Detected:** 2026-02-11
**Resolution Status:** solved

---

## Problem Description

JavaScript trigger button and all native function calls silently fail. No errors in console, no C++ log entries, no audio. The JS-to-C++ bridge appears completely non-functional.

## Symptoms

- UI buttons (TRIGGER, presets, etc.) visually respond but have no effect
- No C++ native function handler logs appear
- `ExciterBank::setGate()` never receives `true`
- No JavaScript console errors (the wrong API silently fails)
- WebView loads and renders correctly

## Root Cause

The JavaScript code used a **non-existent API** to call C++ native functions:

```javascript
// WRONG - This method does NOT exist in JUCE 8
window.__JUCE__.backend.invokeNativeFunction('triggerNote', [60, 1.0])
```

`invokeNativeFunction()` was hallucinated during code generation. It does not exist on the `__JUCE__.backend` object.

The correct JUCE 8 API is:

```javascript
// CORRECT - getNativeFunction returns a callable
const triggerNote = window.Juce.getNativeFunction('triggerNote');
triggerNote(60, 1.0);
```

### How JUCE Native Functions Actually Work

```
JS: window.Juce.getNativeFunction('name')
  -> returns a wrapper function
  -> calling it does: emitEvent("__juce__invoke", { name, params, resultId })
  -> C++ WebBrowserComponent receives the event
  -> Calls registered .withNativeFunction() handler
  -> Returns result via "__juce__complete" event
```

The key mechanism is `window.__JUCE__.backend.emitEvent()`, not a direct function call.

## Solution

### 1. Implement getNativeFunction (if not using JUCE's frontend library)

Add to your inline JavaScript:

```javascript
class PromiseHandler {
    constructor() {
        this.lastPromiseId = 0;
        this.promises = new Map();
        if (window.__JUCE__ && window.__JUCE__.backend) {
            window.__JUCE__.backend.addEventListener("__juce__complete",
                ({ promiseId, result }) => {
                    if (this.promises.has(promiseId)) {
                        this.promises.get(promiseId).resolve(result);
                        this.promises.delete(promiseId);
                    }
                }
            );
        }
    }
    createPromise() {
        const promiseId = "" + this.lastPromiseId++;
        const result = new Promise((resolve) => {
            this.promises.set(promiseId, { resolve });
        });
        return [promiseId, result];
    }
}

const promiseHandler = new PromiseHandler();

window.Juce = window.Juce || {};
window.Juce.getNativeFunction = function (name) {
    return function () {
        const [promiseId, result] = promiseHandler.createPromise();
        window.__JUCE__.backend.emitEvent("__juce__invoke", {
            name: name,
            params: Array.prototype.slice.call(arguments),
            resultId: promiseId,
        });
        return result;
    };
};
```

### 2. Update All Native Function Calls

| Old (Wrong) | New (Correct) |
|-------------|---------------|
| `window.__JUCE__.backend.invokeNativeFunction('triggerNote', [60, 1.0])` | `window.Juce.getNativeFunction('triggerNote')(60, 1.0)` |
| `invokeNativeFunction('getFactoryPresets', [])` | `window.Juce.getNativeFunction('getFactoryPresets')()` |
| `invokeNativeFunction('setParam', [id, value])` | `window.Juce.getNativeFunction('setParam')(id, value)` |

### 3. Fix Backend Readiness Check

```javascript
// WRONG - checking for non-existent method
typeof window.__JUCE__.backend.invokeNativeFunction === 'function'

// CORRECT - check for the actual communication method
typeof window.__JUCE__.backend.emitEvent === 'function'
```

## Verification

- [x] TRIGGER button produces C++ log entry "NATIVE FUNCTION 'triggerNote' CALLED"
- [x] `triggerNoteFromUI()` sets atomic retrigger flags
- [x] `processBlock()` detects retrigger and calls `voiceManager.noteOn()`
- [x] Envelopes trigger (log shows "ENVELOPES TRIGGERED")

## Reference: JUCE Source

The correct API can be verified at:
`_tools/JUCE/modules/juce_gui_extra/native/javascript/index.js`

## Related Issues

- `dsp-001` - Silent effects chain (discovered after this bridge fix)

## Prevention

- **ALWAYS** reference `_tools/JUCE/modules/juce_gui_extra/native/javascript/index.js` for the correct JS API
- **NEVER** assume `invokeNativeFunction()` exists - it is NOT part of JUCE
- Use `window.Juce.getNativeFunction('name')` which returns a callable function
- Backend readiness: check `typeof window.__JUCE__.backend.emitEvent === 'function'`

## Tags

`juce` `webview` `javascript` `native-function` `bridge` `getNativeFunction` `emitEvent`

---

**Created by:** Claude (automated)
**Resolved:** 2026-02-12
**Attempts before resolution:** 2
**Plugin:** XENON
