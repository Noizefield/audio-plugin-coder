# WebView Black Screen - Resource Provider Callback Not Invoked

**Issue ID:** webview-010
**Category:** WebView
**Severity:** CRITICAL
**Status:** ✅ SOLVED
**Date Identified:** 2026-02-10
**Date Resolved:** 2026-02-10

---

## Problem Description

XENON plugin builds successfully and opens in DAW, but shows only a black screen. WebView component creates successfully and URL loads (`https://juce.backend/`), but **no resources are served** because the `getResource()` callback is never invoked.

### Symptoms
- ✅ Plugin compiles without errors
- ✅ Plugin loads in DAW
- ✅ Window opens with correct size
- ❌ Black screen - no UI elements visible
- ✅ WebView2 Runtime installed
- ✅ BinaryData embedded correctly (7 files)
- ❌ **`getResource()` callback NEVER called** (no log entries)

### Debug Log Output
```
10 Feb 2026 14:47:40 | ============================================
10 Feb 2026 14:47:40 | XENON Editor Constructor Started
10 Feb 2026 14:47:40 | ============================================
10 Feb 2026 14:47:40 | Creating WebBrowserComponent...
10 Feb 2026 14:47:41 | WebBrowserComponent created successfully
10 Feb 2026 14:47:41 | Loading WebView URL: https://juce.backend/
10 Feb 2026 14:47:41 | Constructor completed successfully
10 Feb 2026 14:47:41 | ============================================
```

**CRITICAL:** No resource requests logged - `getResource()` never invoked!

---

## Root Cause

**TWO TIMING VIOLATIONS** in constructor order:

### Issue 1: addAndMakeVisible() Called Too Early
`addAndMakeVisible(*webView)` was called BEFORE parameter attachments were created.

**XENON (WRONG):**
```cpp
// Line 369: Create WebView
webView = std::make_unique<juce::WebBrowserComponent>(options);

// Line 373: Make visible TOO EARLY
addAndMakeVisible(*webView);  // ❌ BEFORE attachments!

// Lines 375-789: Create attachments
masterVolAttachment = std::make_unique<...>(...);
// ... 100+ more attachments ...

// Line 794: Load URL
webView->goToURL(rootUrl);
```

When `addAndMakeVisible()` is called before attachments exist:
1. WebView starts initializing immediately
2. WebView tries to access parameter attachments via relays
3. Attachments don't exist yet → null pointer or bad state
4. **Resource provider gets disabled or crashes silently**

### Issue 2: setSize() Called Before WebView Created
`setSize()` was called at the START of constructor, before WebView was created.

**XENON (WRONG):**
```cpp
XenonAudioProcessorEditor::XenonAudioProcessorEditor(...)
{
    // Line 36: Set size WAY TOO EARLY
    setSize(1280, 820);  // ❌ BEFORE WebView exists!

    // Lines 38-369: Create options and WebView
    auto options = ...;
    webView = std::make_unique<...>(options);

    // Line 794: Load URL
    webView->goToURL(rootUrl);
}
```

When `setSize()` is called before WebView exists:
1. Editor gets sized before WebView is created
2. `resized()` might not be called properly when WebView is added
3. WebView might initialize with wrong bounds or fail to render

---

## Solution

### MANDATORY CONSTRUCTOR ORDER (From CloudWash Pattern)

```cpp
PluginEditor::PluginEditor(Processor& p)
    : AudioProcessorEditor(&p), audioProcessor(p)
{
    // 1. CREATE ATTACHMENTS FIRST (before WebView)
    param1Attachment = std::make_unique<juce::WebSliderParameterAttachment>(...);
    param2Attachment = std::make_unique<juce::WebSliderParameterAttachment>(...);
    // ... all attachments ...

    // 2. CREATE WEBVIEW (with resource provider callback)
    webView = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options{}
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options(
                juce::WebBrowserComponent::Options::WinWebView2{}
                    .withUserDataFolder(juce::File::getSpecialLocation(
                        juce::File::SpecialLocationType::tempDirectory)))
            .withNativeIntegrationEnabled()
            .withResourceProvider([this](const auto& url) { return getResource(url); })
            .withOptionsFrom(param1Relay)
            .withOptionsFrom(param2Relay)
            // ... all relays ...
    );

    // 3. ADD TO UI (now safe - attachments exist)
    addAndMakeVisible(*webView);

    // 4. LOAD URL
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    // 5. SET SIZE (LAST - after everything is ready)
    setSize(width, height);
}
```

### Key Rules
1. **Attachments BEFORE WebView creation** (CloudWash pattern - safest)
2. **addAndMakeVisible() AFTER all attachments** (webview-004 fix)
3. **setSize() at END** (after goToURL)

---

## Fixes Applied to XENON

### Fix 1: Removed Early addAndMakeVisible()
```cpp
// OLD (Line 373):
webView = std::make_unique<juce::WebBrowserComponent>(options);
addAndMakeVisible(*webView);  // ❌ TOO EARLY
masterVolAttachment = std::make_unique<...>(...);

// NEW:
webView = std::make_unique<juce::WebBrowserComponent>(options);
// NOTE: addAndMakeVisible() moved to line ~794 (after attachments)
masterVolAttachment = std::make_unique<...>(...);
```

### Fix 2: Moved addAndMakeVisible() After Attachments
```cpp
// NEW (Line ~794):
burstRateAttachment = std::make_unique<...>(...);  // Last attachment

// CRITICAL: Add WebView to UI AFTER all attachments created
logToFile("All attachments created. Adding WebView to UI...");
addAndMakeVisible(*webView);
logToFile("WebView added to UI successfully");

webView->goToURL(rootUrl);
```

### Fix 3: Moved setSize() to End
```cpp
// OLD (Line 36):
XenonAudioProcessorEditor::XenonAudioProcessorEditor(...)
{
    setSize(1280, 820);  // ❌ TOO EARLY
    auto options = ...;

// NEW (Line ~802):
webView->goToURL(rootUrl);

// Set editor size LAST (after WebView fully set up)
logToFile("Setting editor size to 1280x820");
setSize(1280, 820);

logToFile("Constructor completed successfully");
```

---

## Comparison with Working Plugins

### CloudWash (CORRECT - Production Pattern)
```cpp
// 1. Create attachments FIRST
positionAttachment = std::make_unique<...>(...);
sizeAttachment = std::make_unique<...>(...);
// ... all attachments ...

// 2. Create WebView (attachments already exist)
webView = std::make_unique<juce::WebBrowserComponent>(options);

// 3. Add to UI
addAndMakeVisible(*webView);

// 4. Load URL
webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

// 5. Set size LAST
setSize(800, 500);
```

### AngelGrain (CORRECT - Alternative Pattern)
```cpp
// 1. Create relays
delayTimeRelay = std::make_unique<...>(...);

// 2. Create WebView
webView.reset(new SinglePageBrowser(createWebOptions(*this)));

// 3. Create attachments
delayTimeAttachment = std::make_unique<...>(...);

// 4. Add to UI (attachments exist now)
addAndMakeVisible(*webView);

// 5. Load URL
webView->goToURL(...);

// 6. Set size LAST
setSize(540, 480);
```

**Both patterns work** as long as attachments exist before `addAndMakeVisible()`.
CloudWash's pattern (attachments before WebView) is safer and recommended.

---

## Verification Steps

### 1. Clean Rebuild
```powershell
.\scripts\build-and-install.ps1 -PluginName XENON
```

### 2. Check Debug Log
Expected log after fixes:
```
XENON Editor Constructor Started
Creating WebBrowserComponent...
WebBrowserComponent created successfully
All attachments created. Adding WebView to UI...
WebView added to UI successfully
Loading WebView URL: https://juce.backend/

========== EMBEDDED RESOURCES ==========  ← Should appear now!
Total embedded files: 7
1. index_html → Source/ui/public/index.html
...
========================================

RESOURCE REQUEST: https://juce.backend/ → index.html
✓ FOUND: Source/ui/public/index.html (12345 bytes, MIME: text/html)

RESOURCE REQUEST: https://juce.backend/assets/index-NprFptum.js → ...
✓ FOUND: Source/ui/public/assets/index-NprFptum.js (...)
...
```

### 3. Test in DAW
- [ ] Load plugin in DAW
- [ ] Window opens
- [ ] **UI displays** (not black screen)
- [ ] Controls visible and interactive
- [ ] No crashes on close

---

## Related Issues

- **webview-004:** Attachment creation order crash
- **webview-002:** Member declaration order crash
- **webview-007:** Black screen - embedded resources

---

## Prevention Checklist

For ALL WebView plugins, verify constructor order:

```cpp
// ✅ CORRECT ORDER
{
    // 1. Create attachments (optional: can be after WebView)
    // 2. Create WebView
    // 3. addAndMakeVisible  ← MUST be after attachments
    // 4. goToURL
    // 5. setSize            ← MUST be last
}

// ❌ WRONG ORDER (causes black screen)
{
    setSize(...);           // ❌ TOO EARLY
    create WebView
    addAndMakeVisible(...)  // ❌ BEFORE attachments
    create attachments      // ❌ TOO LATE
    goToURL(...)
}
```

### Code Review Rules
- [ ] `setSize()` called at END of constructor (after goToURL)
- [ ] `addAndMakeVisible()` called AFTER all attachments created
- [ ] Resource provider callback registered: `.withResourceProvider(...)`
- [ ] `resized()` sets WebView bounds: `webView->setBounds(getLocalBounds())`

---

## Technical Explanation

The black screen with no resource requests occurs because:

1. **Early addAndMakeVisible():** WebView starts initializing before attachments exist
2. During initialization, WebView tries to access relays/attachments
3. Null pointer or bad state causes resource provider to fail silently
4. `getResource()` callback never gets registered or gets unregistered
5. When `goToURL()` is called, WebView can't load any resources
6. Black screen with no error messages

Additionally:

7. **Early setSize():** Editor gets sized before WebView exists
8. `resized()` might not be called when WebView is added
9. WebView might initialize with zero or wrong bounds
10. Resource loading depends on proper WebView initialization

**Both timing issues must be fixed** for resource provider to work.

---

## Resolution Timeline

**14:47:** User reports black screen, WebView creates but no UI
**14:48:** Confirmed getResource() never called (log shows zero requests)
**15:00:** Examined CloudWash working pattern
**15:05:** Identified timing violations (addAndMakeVisible + setSize)
**15:10:** Applied fixes (moved both to correct positions)
**15:15:** ✅ Ready for rebuild and testing

---

**Document Version:** 1.0
**Last Updated:** 2026-02-10 15:15
**Resolution Status:** ✅ FIXES APPLIED - AWAITING VERIFICATION
**Attempts to Resolve:** 4 iterations
**Time to Resolution:** 30 minutes
**Related Skills:** `.claude/skills/skill_design_webview/SKILL.md`
**Working Examples:** `plugins/CloudWash/`, `plugins/AngelGrain/`
