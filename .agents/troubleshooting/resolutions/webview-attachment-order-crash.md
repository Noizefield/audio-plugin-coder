# WebView Plugin Crash - Attachment Creation Order

**Issue ID:** webview-004
**Category:** WebView
**Severity:** CRITICAL
**Status:** ✅ SOLVED
**Date Identified:** 2026-01-24
**Date Resolved:** 2026-01-24

---

## Problem Description

WebView plugin compiles successfully but **crashes entire DAW** when loaded. Standalone version also crashes immediately.

### Symptoms
- ✅ Plugin builds without errors
- ❌ Crashes DAW completely when loading VST3
- ❌ Standalone crashes immediately
- ❌ No specific error message
- ✅ WebView2 runtime is installed and working

---

## Root Cause

**CRITICAL ORDER VIOLATION:** Parameter attachments created AFTER `addAndMakeVisible(webView)` instead of BEFORE.

### Why This Crashes

When `addAndMakeVisible()` is called on the WebView:
1. WebView starts initializing immediately
2. WebView tries to access parameter attachments via relays
3. **Attachments don't exist yet** (created after addAndMakeVisible)
4. Null pointer dereference → **INSTANT CRASH**

### Incorrect Pattern (nf_gnarly - CRASHES)

```cpp
// WRONG ORDER - CAUSES DAW CRASH
NfGnarlyAudioProcessorEditor::NfGnarlyAudioProcessorEditor (NfGnarlyAudioProcessor& p)
{
    // 1. Create relays
    driveRelay = std::make_unique<juce::WebSliderRelay> ("drive");

    // 2. Create WebView
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));

    // 3. Make visible BEFORE attachments ❌ WRONG!
    addAndMakeVisible (*webView);  // ← WebView starts initializing HERE

    // 4. Create attachments AFTER visible ❌ TOO LATE!
    driveAttachment = std::make_unique<juce::WebSliderParameterAttachment> (...);
    // WebView already tried to access attachment → CRASH
}
```

### Correct Pattern (AngelGrain - WORKS)

```cpp
// CORRECT ORDER - WORKS PERFECTLY
AngelGrainAudioProcessorEditor::AngelGrainAudioProcessorEditor (AngelGrainAudioProcessor& p)
{
    // 1. Create relays
    delayTimeRelay = std::make_unique<juce::WebSliderRelay> ("delayTime");

    // 2. Create WebView
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));

    // 3. Create attachments BEFORE visible ✅ CORRECT!
    delayTimeAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.parameters.getParameter ("delayTime"),
        *delayTimeRelay,
        nullptr
    );

    // 4. Make visible LAST ✅ CORRECT!
    addAndMakeVisible (*webView);  // Now safe - attachments exist

    // 5. Load URL
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    setSize (540, 480);
}
```

---

## Solution

### Fix 1: Correct Constructor Order

**MANDATORY ORDER:**
1. Create relays
2. Create WebView (but don't make visible yet)
3. **Create ALL attachments BEFORE addAndMakeVisible** ⭐ CRITICAL
4. `addAndMakeVisible(*webView)`
5. `goToURL(...)`
6. `setSize(...)`

### Fix 2: Simplified Resource Provider

AngelGrain uses **direct BinaryData access**, not iteration:

```cpp
// CORRECT - Direct access (AngelGrain pattern)
std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url)
{
    if (url.isEmpty() || url == "/" || url == "/index.html")
    {
        return makeResource (
            PluginName_BinaryData::index_html,
            PluginName_BinaryData::index_htmlSize,
            "text/html"
        );
    }
    return std::nullopt;
}
```

**Don't use:**
```cpp
// WRONG - Complex iteration (causes issues)
for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
{
    // ... searching through resources
}
```

---

## Complete Fix Applied to nf_gnarly

### Before (CRASHED DAW):
```cpp
// webView created
addAndMakeVisible (*webView);  // ← TOO EARLY
// attachments created AFTER     ← CAUSES CRASH
```

### After (FIXED):
```cpp
// webView created
// attachments created FIRST      ← FIXED
addAndMakeVisible (*webView);   // ← NOW SAFE
```

---

## Verification

After applying fixes:

1. **Clean rebuild:**
   ```powershell
   cmake --build build --config Release --target nf_gnarly_VST3
   ```

2. **Copy VST3:**
   ```powershell
   Copy-Item -Path "build\plugins\nf_gnarly\nf_gnarly_artefacts\Release\VST3\NF Gnarly.vst3" `
             -Destination "C:\Program Files\Common Files\VST3\" -Recurse -Force
   ```

3. **Test in DAW:**
   - Rescan plugins
   - Load "NF Gnarly"
   - ✅ Should load without crash
   - ✅ UI should display
   - ✅ Controls should work
   - ✅ Close plugin - no crash
   - ✅ Unload from DAW - no crash

---

## Prevention

### Checklist for All WebView Plugins:

```cpp
// Constructor template
PluginEditor::PluginEditor (Processor& p)
{
    // 1. Relays
    param1Relay = std::make_unique<juce::WebSliderRelay> ("param1");

    // 2. WebView (don't make visible yet!)
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));

    // 3. Attachments BEFORE addAndMakeVisible ⭐ CRITICAL
    param1Attachment = std::make_unique<juce::WebSliderParameterAttachment> (...);

    // 4. Make visible (safe now)
    addAndMakeVisible (*webView);

    // 5. Load
    webView->goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    // 6. Size
    setSize (width, height);
}
```

### Code Review Checklist:
- [ ] Relays created first
- [ ] WebView created second
- [ ] **ALL attachments created BEFORE `addAndMakeVisible`** ⭐
- [ ] `addAndMakeVisible` called AFTER attachments
- [ ] `goToURL` called AFTER `addAndMakeVisible`
- [ ] `setSize` called at end
- [ ] Resource provider uses direct BinaryData access

---

## Related Issues

- **webview-002**: Member declaration order crash (destructor issue)
- **webview-003**: Runtime crash investigation (led to this discovery)

---

## Impact

**Before Fix:**
- ❌ 100% crash rate
- ❌ DAW completely crashes
- ❌ Plugin unusable

**After Fix:**
- ✅ 0% crash rate
- ✅ Plugin loads perfectly
- ✅ UI works correctly
- ✅ No crashes on close/unload

---

## Technical Explanation

The crash occurs because:

1. `addAndMakeVisible()` triggers WebView component initialization
2. During initialization, WebView calls JavaScript bridge setup
3. JavaScript bridge tries to access parameter relays
4. Relays reference attachments that don't exist yet
5. Null pointer dereference in attachment access
6. **Instant crash with no error message**

The fix ensures all attachments exist BEFORE WebView tries to access them.

---

**Document Version:** 1.1
**Last Updated:** 2026-01-24 16:30
**Resolution Status:** ✅ SOLVED - VERIFIED WORKING
**Attempts to Resolve:** 3
**Time to Resolution:** 45 minutes

---

## User Verification

**2026-01-24 16:30:** User confirmed plugin now works!
- ✅ Plugin loads in DAW without crash
- ✅ GUI displays correctly
- ✅ Controls are visible and interactive
- ✅ No crashes on close/unload

**Remaining Issues (audio processing, not WebView):**
- Mono processing only (needs stereo)
- Parameter response delayed (needs faster smoothing)
- Cutoff knob feel (needs UI adjustment)
