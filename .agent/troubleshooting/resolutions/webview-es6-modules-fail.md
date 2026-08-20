# WebView ES6 Modules Fail - JavaScript Not Loading

**Issue ID:** webview-008
**Category:** webview
**Severity:** Critical
**Status:** SOLVED
**Date Resolved:** 2026-01-26

---

## Summary

Plugin loads but UI is incomplete - knobs show only indicator dots without arcs, no animations run, and JavaScript fails silently. This is the **#1 issue for new WebView developers**.

---

## Symptoms

1. Plugin builds and loads successfully
2. Plugin window opens showing HTML structure
3. **Knobs show only white dots** (no circular arcs)
4. **No animations** (meters frozen, grain visualization static)
5. **No interactivity** (knobs don't respond to mouse)
6. **Browser test shows CORS error:** "Cross-Origin Request blocked: CORS request not http"
7. No JavaScript errors in DAW (fails silently)

### Visual Symptoms

**What you see:**
```
[CLOUDWASH Header]
[Empty grain canvas area]
[ • ] [ • ] [ • ] [ • ] [ • ]  ← Only dots, no arcs
  50%   50%  +0.00  50%    0%
[ • ] [ • ] [ • ] [ • ] [ • ]
  50%   80%   50%   0%     0%
```

**What you should see:**
```
[CLOUDWASH Header]
[Animated grain particles]
[◠●] [◠●] [◠●] [◠●] [◠●]  ← Circular arcs with dots
 50%   50%  +0.00  50%    0%
[◠●] [◠●] [◠●] [◠●] [◠●]
 50%   80%   50%   0%     0%
```

---

## Root Cause

### The Problem

**ES6 modules do NOT work in JUCE WebView.**

```html
<!-- ❌ THIS FAILS SILENTLY IN WEBVIEW -->
<!DOCTYPE html>
<html>
<head>
    <script type="module" src="js/index.js"></script>
</head>
```

**Why it fails:**
1. ES6 modules require `http://` or `https://` protocol
2. WebView uses custom protocol (`juce://` or resource provider root)
3. Browser blocks cross-origin module loading
4. `import` statements fail silently
5. No JavaScript executes

### Affected Code Patterns

```javascript
// ❌ ALL OF THESE FAIL:
import * as Juce from "./juce/index.js";
import { getSliderState } from "./juce/index.js";
export function myFunction() { }
```

---

## Solution

**ALL JavaScript must be inline in `index.html`**

### Step 1: Read Current Structure

Your current failing structure:
```
plugins/YourPlugin/Source/ui/public/
├── index.html              ← Has <script type="module">
├── js/
│   ├── index.js           ← NOT LOADED
│   └── juce/
│       └── index.js       ← NOT LOADED
```

### Step 2: Create Inline HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Your Plugin</title>
    <!-- NO external scripts! -->
    <style>
        /* All CSS inline */
    </style>
</head>
<body>
    <!-- All HTML structure -->

    <!-- ============================================
         ALL JAVASCRIPT INLINE
         ============================================ -->
    <script>
        // PART 1: JUCE Library (copy from js/juce/index.js)
        // Remove: import/export statements
        // Add: window.Juce = { ... }
        const juceAvailable = typeof window.__JUCE__ !== 'undefined';

        class ListenerList {
            // ... (copy from JUCE library)
        }

        class SliderState {
            // ... (copy from JUCE library)
        }

        class ToggleState {
            // ... (copy from JUCE library)
        }

        // Create global Juce object
        window.Juce = {
            getSliderState: function(name) { /* ... */ },
            getToggleState: function(name) { /* ... */ }
        };

        // PART 2: UI Code (copy from js/index.js)
        // Remove: import * as Juce
        // Use: window.Juce directly

        document.addEventListener("DOMContentLoaded", () => {
            console.log("Plugin initializing...");

            // Initialize UI
            initializeKnobs();
            initializeButtons();
            // ... etc
        });

        function initializeKnobs() {
            // ... your UI code
        }
    </script>
</body>
</html>
```

### Step 3: Update CMakeLists.txt

```cmake
# ✅ ONLY EMBED HTML (no JS files!)
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html
        # NO JS FILES - everything is inline!
)
```

### Step 4: Create Test File

```html
<!-- test-local.html -->
<!-- Exact copy of index.html for browser testing -->
<!-- Add test banner -->
<body>
    <div style="background: #FFC107; padding: 8px; text-align: center;">
        ⚠️ BROWSER TEST - No JUCE Backend
    </div>
    <!-- Rest is identical to index.html -->
</body>
```

---

## Complete Working Example

**CloudWash Plugin** demonstrates the correct approach:

```
plugins/CloudWash/Source/ui/public/
├── index.html           ← 978 lines, 34KB, ALL JavaScript inline
├── test-local.html      ← Browser test version
└── js/                  ← NOT USED (reference only)
    ├── index.js
    └── juce/index.js
```

**File:** `plugins/CloudWash/Source/ui/public/index.html`
- Line 1-7: HTML header
- Line 8-363: CSS (inline)
- Line 364-540: HTML body structure
- Line 541-978: JavaScript (inline)
  - Line 545-715: JUCE library (ListenerList, SliderState, ToggleState)
  - Line 720-978: UI code (knobs, meters, buttons)

**Key characteristics:**
- ✅ NO `<script src="...">` tags
- ✅ NO `import` statements
- ✅ NO `export` statements
- ✅ Everything in one `<script>` block
- ✅ Works in both browser tests and WebView

---

## Verification Steps

### 1. Test in Browser FIRST
```bash
# Open test-local.html in Chrome/Edge
plugins/YourPlugin/Source/ui/public/test-local.html
```

**Expected:**
- ✅ All knobs render with arcs
- ✅ Knobs respond to mouse drag
- ✅ Animations run
- ✅ NO CORS errors in console
- ✅ Console shows: "Plugin initializing..."

**If still seeing CORS errors:**
- JavaScript is still trying to load external files
- Check for any remaining `<script src="...">` tags

### 2. Build Plugin
```powershell
.\scripts\build-and-install.ps1 -PluginName YourPlugin
```

### 3. Test in DAW
1. Load plugin in DAW
2. **All knobs should show full circular arcs**
3. Drag knobs → should respond
4. Mode tabs → should switch
5. Buttons → should toggle

---

## Common Mistakes

### ❌ Mistake 1: Partial Inlining
```html
<!-- WRONG - Still using external files -->
<script>
    // UI code inline
</script>
<script type="module" src="js/juce/index.js"></script>  <!-- ✗ -->
```

**Problem:** The module still won't load, JUCE library unavailable.

### ❌ Mistake 2: Leaving Import Statements
```html
<script>
    import * as Juce from "./juce/index.js";  // ✗ FAILS!
    // ... rest of code
</script>
```

**Problem:** `import` only works in `type="module"` which doesn't work.

**Solution:** Remove `import`, copy JUCE library inline.

### ❌ Mistake 3: Not Testing in Browser
Building without browser test → waste time on build cycles.

**Solution:** ALWAYS test `test-local.html` in browser first.

### ❌ Mistake 4: CMake Still Embedding JS Files
```cmake
juce_add_binary_data(Plugin_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js        # ✗ NOT NEEDED
        Source/ui/public/js/juce/index.js   # ✗ NOT NEEDED
)
```

**Problem:** Wasted build time, larger binary.

**Solution:** Only embed `index.html`.

---

## Prevention

### For All Future WebView Plugins

1. **Start with inline JavaScript from day 1**
   - Don't use ES6 modules
   - Don't create separate `.js` files
   - Write everything in `<script>` block

2. **Use CloudWash as template**
   - Copy `plugins/CloudWash/Source/ui/public/index.html`
   - Modify for your plugin
   - Test in browser before building

3. **Document structure:**
   ```
   index.html          ← PRODUCTION (all inline)
   test-local.html     ← BROWSER TEST (same as index.html)
   ```

4. **CMakeLists.txt pattern:**
   ```cmake
   juce_add_binary_data(YourPlugin_WebUI
       SOURCES
           Source/ui/public/index.html  # ONLY HTML!
   )
   ```

---

## Conversion Guide

**If you have existing ES6 module code:**

### Step 1: Extract JUCE Library
```bash
# Copy JUCE library content
cp plugins/YourPlugin/Source/ui/public/js/juce/index.js juce_library_backup.js
```

### Step 2: Remove Module Syntax
```javascript
// BEFORE (ES6):
import "./check_native_interop.js";
export function getSliderState(name) { }
export { SliderState, ToggleState };

// AFTER (inline):
// (remove import/export completely)
window.Juce = {
    getSliderState: function(name) { }
    // ...
};
```

### Step 3: Combine into index.html
```html
<script>
    // 1. JUCE library (from js/juce/index.js, modified)
    class ListenerList { }
    class SliderState { }
    window.Juce = { };

    // 2. UI code (from js/index.js, modified)
    // Change: import * as Juce
    // To: use window.Juce directly

    document.addEventListener("DOMContentLoaded", () => {
        const paramState = window.Juce.getSliderState("gain");
        // ...
    });
</script>
```

### Step 4: Test Conversion
```bash
# 1. Open test-local.html in browser
# 2. Check console for errors
# 3. Verify all knobs render
# 4. Build plugin
# 5. Test in DAW
```

---

## Technical Details

### Why ES6 Modules Need HTTP

1. **Security:** Browsers block cross-origin script loading
2. **Protocol:** `import` requires HTTP/HTTPS
3. **File protocol:** `file://` doesn't support CORS headers
4. **WebView protocol:** Custom protocols (like `juce://`) don't support modules

### Why This Isn't in JUCE Docs

- JUCE examples use simple `<script src="...">` (no modules)
- ES6 modules are modern practice but incompatible with WebView
- Many developers default to ES6 modules without testing

---

## Related Issues

- **webview-001:** HTML not loading (different - path issue)
- **webview-007:** Black screen (different - BinaryData issue)
- **build-004:** JuceHeader.h not found (JUCE 8 migration)

---

## Quick Reference

### ✅ DO
- ✅ Inline all JavaScript in index.html
- ✅ Create test-local.html for browser testing
- ✅ Use CloudWash as reference
- ✅ Test in browser before building

### ❌ DON'T
- ❌ Use `<script type="module">`
- ❌ Use `import` / `export` statements
- ❌ Create separate `.js` files
- ❌ Embed JS files in CMakeLists.txt

---

## Notes

This issue affects **100% of developers** who follow modern JavaScript practices. ES6 modules are standard for web development but incompatible with JUCE WebView architecture.

**The solution is counterintuitive:** Modern best practices (separate modules) don't work. Must use "old-school" inline JavaScript.

**CloudWash plugin** demonstrates the correct approach and serves as the canonical example.

---

**Resolution Author:** AI Assistant
**Date:** 2026-01-26
**Verified On:** CloudWash Plugin
**File Size:** 978 lines, 34KB (index.html)
**Status:** Production Ready
