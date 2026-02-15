# WebView Plugin Crashes DAW - Member Declaration Order Issue

**Issue ID:** webview-002
**Category:** WebView
**Severity:** 🔴 CRITICAL
**Status:** ✅ SOLVED
**Date Reported:** 2026-01-24
**Last Updated:** 2026-01-24

---

## Problem Description

WebView-based JUCE plugins crash the entire DAW process when:
- Closing the plugin window
- Unloading the plugin from a track
- Closing the project
- Shutting down the DAW

The crash typically manifests as a **segmentation fault** or **access violation** in the `WebBrowserComponent` destructor, causing the entire DAW to terminate unexpectedly.

### Symptoms

- ❌ DAW crashes when plugin window is closed
- ❌ Segmentation fault during plugin unload
- ❌ Access violation error (0xC0000005 on Windows)
- ❌ Pure virtual function call errors
- ❌ **Crash ONLY happens in release builds** (debug builds may work fine)
- ❌ Crash during destruction, not during initialization or runtime
- ❌ Plugin works perfectly until user tries to close it

### Common Error Messages

```
Access violation reading location 0x[address]
Exception thrown: Access violation reading location
Segmentation fault (core dumped)
pure virtual function call
```

---

## Root Cause

**C++ destroys class members in REVERSE order of their declaration in the header file.**

When a `WebBrowserComponent` is declared BEFORE the `WebSliderRelay` objects in the header file, the destruction order becomes:

1. Relays destroyed FIRST ❌
2. WebView destroyed LAST ❌ → tries to access already-destroyed relays → **CRASH**

The `WebBrowserComponent` holds references to the relay objects (registered via `.withOptionsFrom(relay)`). When the WebView is destroyed, it attempts to clean up these references. If the relays were already destroyed, this accesses freed memory, causing undefined behavior and typically a segmentation fault.

### Why Debug Builds May Not Crash

Debug builds often:
- Initialize freed memory to specific patterns (0xCD, 0xDD)
- Have slower/different destruction sequences
- Include additional runtime checks that mask the issue

Release builds optimize away these protections, exposing the underlying memory access violation.

---

## Quick Fix

### Step 1: Check Current Member Order

Open `Source/PluginEditor.h` and find the `private:` section:

```cpp
// ❌ WRONG ORDER - CAUSES CRASHES
private:
    std::unique_ptr<juce::WebBrowserComponent> webView;           // Destroyed LAST ❌
    juce::WebSliderRelay gainRelay { "GAIN" };                    // Destroyed FIRST ❌
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
```

### Step 2: Reorder Members Correctly

**Change to this order:**

```cpp
// ✅ CORRECT ORDER - NO CRASHES
private:
    // CRITICAL: Destruction happens in REVERSE order of declaration
    // Order: Relays → WebView → Attachments

    // 1. PARAMETER RELAYS FIRST (no dependencies)
    juce::WebSliderRelay gainRelay { "GAIN" };

    // 2. WEBVIEW SECOND (depends on relays)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. PARAMETER ATTACHMENTS LAST (depend on relays + parameters)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
```

### Step 3: Rebuild

```powershell
.\scripts\build-and-install.ps1 -PluginName YourPlugin
```

### Step 4: Test

1. Load plugin in DAW
2. Open plugin window
3. **Close plugin window** → should NOT crash
4. Unload plugin → should NOT crash
5. Close DAW → should NOT crash

---

## Detailed Step-by-Step Solution

### 1. Identify the Problem

Check your `PluginEditor.h` file for member declaration order.

**Signs you have this issue:**
- WebBrowserComponent declared before relays
- Crashes happen on destruction (not initialization)
- Release builds crash, debug builds may work

### 2. Understand C++ Destruction Order

```cpp
class Example {
    int memberA;    // Declared 1st → Destroyed LAST
    int memberB;    // Declared 2nd → Destroyed 2nd
    int memberC;    // Declared 3rd → Destroyed FIRST
};
```

**Destruction is REVERSE of declaration.**

### 3. Apply the Correct Pattern

For WebView plugins, the pattern is always:

```cpp
private:
    AudioProcessor& audioProcessor;  // Reference (not destroyed)

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Member Declaration Order
    // Destruction happens in REVERSE order
    // ═══════════════════════════════════════════════════════════════

    // Step 1: Relays (no dependencies, can be destroyed last)
    juce::WebSliderRelay relay1 { "PARAM1" };
    juce::WebSliderRelay relay2 { "PARAM2" };
    juce::WebToggleButtonRelay toggle1 { "TOGGLE1" };

    // Step 2: WebView (references relays via .withOptionsFrom())
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // Step 3: Attachments (reference both relays and parameters)
    std::unique_ptr<juce::WebSliderParameterAttachment> attachment1;
    std::unique_ptr<juce::WebSliderParameterAttachment> attachment2;
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> toggleAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (YourEditor)
};
```

### 4. Verify Constructor Still Works

Your constructor should create items in this order:

```cpp
YourEditor::YourEditor(YourProcessor& p)
    : AudioProcessorEditor(&p), audioProcessor(p)
    // Relays initialized via member initializer list (inline init in header)
{
    // 1. Create WebView (relays already exist at this point)
    webView = std::make_unique<juce::WebBrowserComponent>(
        Options()
            .withBackend(webview2)
            .withWinWebView2Options(...)
            .withNativeIntegrationEnabled()
            .withOptionsFrom(relay1)    // References relay1
            .withOptionsFrom(relay2)    // References relay2
            .withOptionsFrom(toggle1)   // References toggle1
            .withResourceProvider(...)
    );

    addAndMakeVisible(*webView);

    // 2. Create attachments (after webView, before end of constructor)
    attachment1 = std::make_unique<juce::WebSliderParameterAttachment>(...);
    attachment2 = std::make_unique<juce::WebSliderParameterAttachment>(...);
    toggleAttachment = std::make_unique<juce::WebToggleButtonParameterAttachment>(...);

    // 3. Load UI
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}
```

### 5. Rebuild and Test Thoroughly

```powershell
# Build
.\scripts\build-and-install.ps1 -PluginName YourPlugin

# Test sequence:
# 1. Load in DAW (Reaper, Ableton, etc.)
# 2. Open plugin window
# 3. Interact with controls
# 4. Close window (CRITICAL TEST)
# 5. Unload plugin
# 6. Load multiple instances
# 7. Close all instances
# 8. Close DAW
```

**All steps should complete without crashes.**

---

## Verification Checklist

Use this checklist to verify your fix:

### Header File (PluginEditor.h)
- [ ] Relays declared BEFORE webView
- [ ] webView declared BEFORE attachments
- [ ] Relays are direct members: `juce::WebSliderRelay relay { "ID" };`
- [ ] webView is unique_ptr: `std::unique_ptr<juce::WebBrowserComponent> webView;`
- [ ] Attachments are unique_ptr: `std::unique_ptr<...Attachment> attachment;`
- [ ] Added comment explaining destruction order

### Constructor (PluginEditor.cpp)
- [ ] Relays initialized in header (inline) or member initializer list
- [ ] webView created in constructor body
- [ ] All relays registered: `.withOptionsFrom(relay1)`, `.withOptionsFrom(relay2)`, etc.
- [ ] Attachments created AFTER webView
- [ ] `webView->goToURL(...)` called at end

### Build
- [ ] Clean rebuild completed successfully
- [ ] No warnings about destruction order
- [ ] Both debug and release builds created

### Testing
- [ ] Plugin loads without errors
- [ ] UI displays correctly
- [ ] Parameters work (knobs, sliders, toggles)
- [ ] **Window closes without crash** ✅
- [ ] Plugin unloads without crash ✅
- [ ] Multiple instances work ✅
- [ ] DAW shutdown clean ✅

---

## Prevention

### For Future Plugins

1. **Always use correct member order in templates**
   - Update `templates/webview/PluginEditor.h.template`
   - Include destruction order comments

2. **Add pre-build validation**
   - Use `scripts/validate-webview-member-order.ps1` before building
   - Catches incorrect order automatically

3. **Follow the checklist**
   - Use the WebView development checklist from `.claude/WEBVIEW_FRAMEWORK_FIXES.md`

4. **Test destruction thoroughly**
   - Don't just test initialization and runtime
   - Always test window close, plugin unload, DAW shutdown

### Code Review Pattern

When reviewing WebView plugin code, always check:

```cpp
// Expected pattern in PluginEditor.h:
private:
    // 1. Relays (direct members)
    juce::Web*Relay relay;

    // 2. WebView (unique_ptr)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. Attachments (unique_ptr)
    std::unique_ptr<juce::Web*Attachment> attachment;
```

**If order is different → STOP and fix before building.**

---

## Related Issues

- **webview-001:** WebView blank screen (resource loading)
- **build-001:** CMake duplicate target errors

---

## Technical Details

### Why Relays Must Be Direct Members

Relays should be declared as direct members (not pointers):

```cpp
// ✅ CORRECT
juce::WebSliderRelay relay { "PARAM" };

// ❌ AVOID (complicates init, no benefit)
std::unique_ptr<juce::WebSliderRelay> relay;
```

**Reasons:**
1. Simpler initialization (inline or member init list)
2. Clear lifetime (exists for entire object lifetime)
3. No manual memory management needed
4. Constructor can reference them immediately

### Why WebView and Attachments Use unique_ptr

```cpp
// ✅ CORRECT
std::unique_ptr<juce::WebBrowserComponent> webView;
std::unique_ptr<juce::WebSliderParameterAttachment> attachment;
```

**Reasons:**
1. Complex construction (requires Options chain)
2. Optional creation (can be created conditionally)
3. Late initialization (created in constructor body)
4. RAII cleanup (automatic destruction management)

---

## Example: Complete Working Code

### PluginEditor.h

```cpp
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"

class MyPluginEditor : public juce::AudioProcessorEditor
{
public:
    explicit MyPluginEditor(MyProcessor&);
    ~MyPluginEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    MyProcessor& audioProcessor;

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Member Declaration Order (Destruction = Reverse)
    // Order: Relays → WebView → Attachments
    // ═══════════════════════════════════════════════════════════════

    // 1. RELAYS (direct members)
    juce::WebSliderRelay gainRelay { "GAIN" };
    juce::WebSliderRelay frequencyRelay { "FREQUENCY" };

    // 2. WEBVIEW (unique_ptr)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS (unique_ptr)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> frequencyAttachment;

    // Helper functions
    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MyPluginEditor)
};
```

### PluginEditor.cpp

```cpp
#include "PluginEditor.h"
#include "BinaryData.h"

MyPluginEditor::MyPluginEditor(MyProcessor& p)
    : AudioProcessorEditor(&p), audioProcessor(p)
{
    setSize(600, 400);

    // Create WebView with relay references
    webView = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options()
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options(
                juce::WebBrowserComponent::Options::WinWebView2{}
                    .withUserDataFolder(juce::File::getSpecialLocation(
                        juce::File::SpecialLocationType::tempDirectory)))
            .withNativeIntegrationEnabled()
            .withOptionsFrom(gainRelay)         // Relay 1
            .withOptionsFrom(frequencyRelay)    // Relay 2
            .withResourceProvider([this](const auto& url) {
                return getResource(url);
            })
    );

    addAndMakeVisible(*webView);

    // Create attachments (after WebView)
    gainAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.getAPVTS().getParameter("GAIN"),
        gainRelay,
        nullptr
    );

    frequencyAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.getAPVTS().getParameter("FREQUENCY"),
        frequencyRelay,
        nullptr
    );

    // Load UI
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

MyPluginEditor::~MyPluginEditor()
{
    // Destruction happens automatically in correct order:
    // 1. frequencyAttachment (destroyed first)
    // 2. gainAttachment
    // 3. webView (destroyed while relays still exist) ✅
    // 4. frequencyRelay
    // 5. gainRelay (destroyed last)
}

void MyPluginEditor::paint(juce::Graphics& g)
{
    g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
}

void MyPluginEditor::resized()
{
    webView->setBounds(getLocalBounds());
}

std::optional<juce::WebBrowserComponent::Resource> MyPluginEditor::getResource(const juce::String& url)
{
    // Resource provider implementation...
    return std::nullopt;
}
```

---

## Summary

**Problem:** DAW crashes when unloading WebView plugin
**Cause:** Incorrect member declaration order in header file
**Solution:** Declare members as: Relays → WebView → Attachments
**Result:** Plugin loads and unloads cleanly, no crashes

**Critical Takeaway:** In C++, destruction order = reverse of declaration order. Always consider lifetime dependencies when ordering class members.

---

**Resolution Status:** ✅ SOLVED
**Prevention:** Use template with correct order + pre-build validation
**Confidence:** HIGH - Root cause well understood and fix verified
