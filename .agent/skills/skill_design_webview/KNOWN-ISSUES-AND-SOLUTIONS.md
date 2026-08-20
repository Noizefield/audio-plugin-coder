# WebView Known Issues & Solutions
**Comprehensive guide for future AI developers**

**Last Updated:** 2026-08-13
**Based On:** CloudWash Plugin Development + Organik Designâ†’WebUI conversion

---

## ðŸš¨ Critical Issues (Must Know)

### 1. ES6 Modules Don't Work
**Severity:** CRITICAL
**Issue ID:** webview-008

**Problem:**
```html
<!-- âŒ THIS FAILS SILENTLY -->
<script type="module" src="js/index.js"></script>
```

**Symptoms:**
- Knobs show only dots (no arcs)
- No animations
- No interactivity
- CORS errors in browser tests

**Solution:**
ALL JavaScript must be inline in index.html (900+ lines typical).

**Reference:**
- `..agent/troubleshooting/resolutions/webview-es6-modules-fail.md`
- `..agent/skills/skill_design_webview/WEBVIEW-PRODUCTION-GUIDE.md`
- Working example: `plugins/CloudWash/Source/ui/public/index.html`

---

### 1b. External CSS Does Not Apply (Messy / Unstyled UI)
**Severity:** HIGH
**Issue ID:** webview-011

**Problem:**
```html
<!-- âŒ WORKS IN EDGE, FAILS IN JUCE WEBVIEW â€” page looks like raw HTML -->
<link rel="stylesheet" href="css/tokens.css" />
<link rel="stylesheet" href="css/hackerbridge_style.css" />
```

Copying `Design/index.html` into `WebUI/` without inlining CSS is the usual cause.

**Symptoms:**
- HTML/buttons/text visible (not a black screen)
- Default OS/WebView buttons, overlapping absolute layout
- Broken logo; Design footer hint still showing
- Design preview in browser looks correct

**Also check:**
- `getResource()` must not map unknown URLs to `index.html` (relative `css/tokens.css` then serves HTML as CSS)
- `juce_add_binary_data` original names are **basenames** (`tokens.css`), not `css/tokens.css`
- Running Standalone can lock a **stale EXE** while VST3 rebuilds

**Solution:**
Inline ALL CSS in `index.html` (same rule as JS). Explicit BinaryData map by path **and** basename. Add `html.plugin-host` when `window.__JUCE__` exists. Kill Standalone before rebuild.

**Reference:**
- `..agent/troubleshooting/resolutions/webview-011-unstyled-external-css.md`
- Working example: `plugins/Organik/WebUI/index.html`, `plugins/CloudWash/Source/ui/public/index.html`

---

### 2. Member Declaration Order
**Severity:** CRITICAL
**Issue ID:** webview-002

**Problem:**
Wrong order causes DAW crashes on plugin unload.

**Correct Order (PluginEditor.h):**
```cpp
private:
    // 1. Relays FIRST (destroyed last)
    juce::WebSliderRelay gainRelay { "gain" };

    // 2. WebView SECOND (destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. Attachments LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
```

**Reference:**
- `..agent/troubleshooting/resolutions/webview-member-order-crash.md`

---

### 3. JUCE 8 API Changes
**Severity:** HIGH
**Issue ID:** webview-005, webview-006

**Changes:**
1. `withUserDataFolder()` moved to nested class
2. `Resource` uses `std::vector<std::byte>` not `MemoryBlock`

**Correct JUCE 8 Pattern:**
```cpp
webView = std::make_unique<juce::WebBrowserComponent>(
    juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(...))
        )
        .withNativeIntegrationEnabled()
);
```

**Reference:**
- `..agent/troubleshooting/resolutions/webview-juce8-api-changes.md`

---

## âš ï¸ Common Issues

### 4. Knob Rendering Glitches
**Severity:** MEDIUM

**Problem:**
Knobs appear jumpy/glitchy when dragging.

**Cause:**
CSS transitions on SVG paths.

**Solution:**
```css
.knob-arc {
    /* NO transition - causes glitches */
    transition: none;
}
```

**Status:** FIXED in CloudWash (2026-01-26)

---

### 5. Meters Show Random Values
**Severity:** MEDIUM

**Problem:**
Meters animated with `Math.random()` instead of real audio levels.

**Cause:**
No connection between C++ audio processing and JavaScript meters.

**Solution:**
See "Audio Meter Connection" section in `WEBVIEW-PRODUCTION-GUIDE.md`.

**Quick Fix:**
1. Add `std::atomic<float> inputPeak` in PluginProcessor
2. Update in processBlock()
3. Send to WebView via Timer callback
4. Call `window.updateMeters(inputLevel, outputLevel)` from C++

**Status:** Documented in CloudWash (implementation pending)

---

### 6. Parameters Have No Effect on Audio
**Severity:** MEDIUM

**Problem:**
Some knobs move but don't affect audio processing.

**Cause:**
DSP not implemented for that parameter in PluginProcessor::processBlock().

**Diagnosis:**
1. Check PluginProcessor.cpp
2. Find parameter: `apvts.getRawParameterValue("param_name")`
3. Verify it's used in audio processing

**Solution:**
Implement DSP for that parameter.

**Example (CloudWash):**
- Mode 0 (Granular): âœ… Fully implemented
- Modes 1-3: âš ï¸ Placeholders (awaiting Phase 4.1.2)

---

### 7. BinaryData Resource Loading
**Severity:** HIGH
**Issue ID:** webview-007

**Problem:**
Plugin shows black screen - resources not loading.

**Cause:**
Resource provider tries to load from file system instead of embedded BinaryData.

**Solution:**
```cpp
std::optional<WebBrowserComponent::Resource> getResource(const String& url)
{
    // Map URL to BinaryData variable
    if (path == "index.html")
    {
        resourceData = BinaryData::index_html;
        resourceSize = BinaryData::index_htmlSize;
        mimeType = "text/html";
    }

    // Convert to std::vector<std::byte>
    std::vector<std::byte> data(resourceSize);
    std::memcpy(data.data(), resourceData, resourceSize);

    return WebBrowserComponent::Resource{ std::move(data), mimeType };
}
```

**Reference:**
- `..agent/troubleshooting/resolutions/webview-black-screen-resources.md`

---

## ðŸ“‹ Development Checklist

### Before Building Plugin

- [ ] ALL JavaScript is inline in index.html
- [ ] ALL CSS is inline in index.html (no `<link rel="stylesheet">`)
- [ ] No `<script type="module">` tags
- [ ] No `import` / `export` statements
- [ ] test-local.html created and tested in browser
- [ ] All knobs render with arcs in browser test
- [ ] No CORS errors in browser console

### C++ Side

- [ ] Member order: Relays â†’ WebView â†’ Attachments
- [ ] JUCE 8 API used (WinWebView2 nested class)
- [ ] Resource provider returns embedded BinaryData
- [ ] All relays registered with `.withOptionsFrom()`

### JavaScript Side

- [ ] JUCE library inlined (~500 lines)
- [ ] UI code inlined (~400 lines)
- [ ] `juceAvailable` check before JUCE calls
- [ ] Try/catch around all JUCE API calls
- [ ] No CSS transitions on `.knob-arc`
- [ ] `setNormalisedValue()` used (not `setValue()`)
- [ ] `sliderDragStarted/Ended()` called

### CMakeLists.txt

```cmake
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html  # ONLY HTML!
)

juce_add_plugin(YourPlugin
    NEEDS_WEBVIEW2 TRUE
    # ...
)

target_compile_definitions(YourPlugin
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)
```

---

## ðŸ” Debugging Steps

### Issue: UI Doesn't Load At All

1. **Check browser test first:**
   ```bash
   # Open test-local.html in Chrome/Edge
   plugins/YourPlugin/Source/ui/public/test-local.html
   ```

2. **Look for ES6 module errors:**
   - Open browser console (F12)
   - Look for: "Cross-Origin Request blocked"
   - If found â†’ ES6 modules issue (webview-008)

3. **Check resource provider:**
   - Verify BinaryData.h exists in build folder
   - Check getResource() maps URLs correctly
   - Verify MIME types

### Issue: UI Loads but Looks Messy / Unstyled

1. **This is webview-011, not a layout bug in the Design.**
2. Search `WebUI/index.html` for `<link rel="stylesheet">` â€” if present, inline the CSS.
3. Confirm `getResource()` does not rewrite CSS URLs to `index.html`.
4. Compare Standalone vs VST3 file times; kill a locked Standalone and rebuild.
5. Full write-up: `..agent/troubleshooting/resolutions/webview-011-unstyled-external-css.md`

### Issue: Knobs Don't Render

1. **Check browser test:**
   - If works in browser â†’ BinaryData issue
   - If fails in browser â†’ JavaScript error

2. **Check console:**
   ```javascript
   // Should see:
   "Initializing 10 knobs..."
   "  âœ“ Knob: position"
   // ... all 10 knobs
   ```

3. **Check SVG paths:**
   - Use browser inspector
   - Look at `<path class="knob-arc">`
   - Should have `d="M x y A ..."` attribute

### Issue: Parameters Don't Sync

1. **Check parameter IDs match:**
   ```cpp
   // C++
   juce::WebSliderRelay positionRelay { "position" };
   ```
   ```javascript
   // JavaScript
   const state = Juce.getSliderState("position");
   ```

2. **Check attachment creation:**
   ```cpp
   // AFTER webView creation
   positionAttachment = std::make_unique<WebSliderParameterAttachment>(
       *apvts.getParameter("position"),
       positionRelay,
       nullptr
   );
   ```

3. **Check JUCE console warnings:**
   - "Creating SliderState for 'position', which is unknown to the backend"
   - Means parameter ID mismatch

---

## ðŸ“š Documentation Locations

### Skills
- **`..agent/skills/skill_design_webview/SKILL.md`**
  - Quick-start guide (may be outdated)

- **`..agent/skills/skill_design_webview/WEBVIEW-PRODUCTION-GUIDE.md`** â­
  - COMPLETE production guide
  - Use this for all new plugins
  - Based on CloudWash development

- **`..agent/skills/skill_design_webview/KNOWN-ISSUES-AND-SOLUTIONS.md`** â­
  - This file
  - Quick reference for common issues

### Troubleshooting
- **`..agent/troubleshooting/known-issues.yaml`**
  - Database of all known issues
  - Searchable by ID, category, symptoms

- **`..agent/troubleshooting/resolutions/`**
  - Detailed resolution documents
  - webview-001 through webview-011 (see especially webview-008 JS, webview-011 CSS)

### Working Examples
- **`plugins/CloudWash/Source/ui/public/index.html`** â­
  - 978 lines, 34KB
  - COMPLETE working implementation
  - Use as template for all new plugins

- **`plugins/AngelGrain/`**
  - Another working WebView plugin
  - Simpler than CloudWash

---

## ðŸŽ¯ Quick Start for New Plugin

### 1. Copy CloudWash Template
```powershell
# Copy working implementation
cp plugins/CloudWash/Source/ui/public/index.html plugins/YourPlugin/Source/ui/public/
```

### 2. Modify for Your Plugin
1. Change title: "CLOUDWASH" â†’ "YOUR PLUGIN"
2. Update parameter names in HTML data attributes
3. Update JavaScript parameter list
4. Modify knob labels, defaults, ranges
5. Adjust layout/styling

### 3. Test in Browser
```bash
# Save as test-local.html and open in browser
plugins/YourPlugin/Source/ui/public/test-local.html
```

### 4. Update C++ Side
1. PluginEditor.h: Add relays for all parameters
2. PluginEditor.cpp: Register relays with `.withOptionsFrom()`
3. Create attachments (correct order!)

### 5. Build & Test
```powershell
.\scripts\build-and-install.ps1 -PluginName YourPlugin
```

---

## âš¡ Performance Tips

### Knob Rendering
- âœ… DO: Remove CSS transitions
- âœ… DO: Use `e.preventDefault()` on mousedown
- âŒ DON'T: Recalculate SVG paths unnecessarily

### Meter Updates
- âœ… DO: Use Timer at 30 FPS
- âœ… DO: Use `std::atomic` for thread safety
- âŒ DON'T: Call from processBlock() (too frequent)

### Memory
- âœ… DO: Embed all resources in BinaryData
- âœ… DO: Use inline JavaScript (single file)
- âœ… DO: Use inline CSS (single `<style>` block)
- âŒ DON'T: Load external files at runtime
- âŒ DON'T: Use `<link rel="stylesheet">` in production WebUI (webview-011)

---

## ðŸ”— Related Files

### Must Read
1. **WEBVIEW-PRODUCTION-GUIDE.md** - Complete development guide
2. **webview-es6-modules-fail.md** - #1 issue (JS)
3. **webview-011-unstyled-external-css.md** - messy/unstyled UI (CSS)
4. **CloudWash index.html** - Working reference implementation

### Optional Reading
- webview-member-order-crash.md
- webview-juce8-api-changes.md
- webview-black-screen-resources.md
- webview-011-unstyled-external-css.md

---

## ðŸ“ Notes for AI Developers

### When User Reports WebView Issue

1. **First, check this file** for known solutions
2. **Then, search** `..agent/troubleshooting/known-issues.yaml`
3. **If found**, apply documented solution
4. **If new issue:**
   - After 3 attempts, trigger auto-capture
   - Document in known-issues.yaml
   - Create resolution document

### When Building New WebView Plugin

1. **Start with CloudWash template** (don't start from scratch)
2. **Test in browser first** (saves build cycles)
3. **Follow production checklist** (see above)
4. **Reference WEBVIEW-PRODUCTION-GUIDE.md** for details

### When User Says "GUI Not Working"

Ask clarifying questions:
- "Does it show in browser test (test-local.html)?"
- "Are knobs visible? Do they have arcs or just dots?"
- "Any console errors? (F12 in browser)"
- "Which controls specifically don't work?"

Then diagnose using "Debugging Steps" section above.

---

**Document Maintainer:** AI Assistant
**Status:** Living Document
**Updates:** Add new issues as discovered
**Version:** 1.0 (2026-01-26)

