# WebView Framework Analysis & Improvement Plan

**Date:** 2026-01-24
**Analysis:** Comprehensive review of WebView implementation failures
**Success Rate:** ~10% (9 out of 10 failures)
**Working Example:** AngelGrain plugin

---

## Executive Summary

The framework is failing to produce working WebView UIs because of **missing HTML/JavaScript templates**. While the framework has excellent C++ templates and documentation, it lacks the critical JUCE bridge code that enables JavaScript-to-C++ parameter communication.

### Root Cause
**Missing Component:** No HTML template with JUCE frontend library code in `templates/webview/`

**Impact:** AIs generate HTML files with incorrect JavaScript patterns, resulting in non-functional UIs where controls don't connect to the C++ backend.

---

## Critical Findings

### ✅ What's Working (AngelGrain Pattern)

AngelGrain demonstrates a **fully functional** WebView implementation:

#### 1. **Correct JavaScript Architecture** (3-Part System)

The HTML must include ALL three JavaScript sections inline:

**PART 1: Native Interop (`check_native_interop.js`)**
```javascript
// Initializes window.__JUCE__ object
// Creates event system (ListenerList, EventListenerList, Backend)
if (typeof window.__JUCE__ === "undefined") {
    window.__JUCE__ = { postMessage: function () { } };
}
// ... (Backend class with event handling)
```

**PART 2: JUCE Bridge (`juce/index.js`)**
```javascript
// SliderState class for parameter control
class SliderState {
    constructor(name) {
        this.identifier = "__juce__slider" + name;
        // Listens to C++ events
        window.__JUCE__.backend.addEventListener(this.identifier, (e) => {
            if (e.eventType == "valueChanged") {
                this.scaledValue = e.value;
                this.valueChangedEvent.callListeners();
            }
        });
    }

    setNormalisedValue(v) {
        this.scaledValue = this.snapToLegalValue(this.normalisedToScaledValue(v));
        // Sends event to C++
        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "valueChanged",
            value: this.scaledValue
        });
    }

    sliderDragStarted() { /* ... */ }
    sliderDragEnded() { /* ... */ }
    getNormalisedValue() { /* ... */ }
}

const sliderStates = new Map();
const getSliderState = (name) => {
    if (!sliderStates.has(name))
        sliderStates.set(name, new SliderState(name));
    return sliderStates.get(name);
};
```

**PART 3: Plugin UI Logic (`index.js`)**
```javascript
// Plugin-specific code
const paramConfigs = {
    drive: { min: -24, max: 24, unit: 'dB', decimals: 1 },
    // ...
};

function initializeKnobs() {
    document.querySelectorAll('.knob').forEach(knob => {
        const paramId = knob.dataset.param;
        const sliderState = getSliderState(paramId);  // ← CRITICAL

        // C++ → JS updates
        sliderState.valueChangedEvent.addListener(() => {
            const norm = sliderState.getNormalisedValue();
            // Update visual state
        });

        // JS → C++ updates
        knob.addEventListener('mousedown', e => {
            sliderState.sliderDragStarted();  // ← CRITICAL
        });

        knob.addEventListener('mouseup', e => {
            sliderState.sliderDragEnded();  // ← CRITICAL
        });

        // User interaction
        sliderState.setNormalisedValue(newValue);  // ← CRITICAL
    });
}
```

#### 2. **Correct C++ Member Order** (PluginEditor.h)

```cpp
private:
    // CRITICAL: Destruction order = REVERSE of declaration
    // Order: Relays → WebView → Attachments

    // 1. RELAYS FIRST (destroyed last)
    std::unique_ptr<juce::WebSliderRelay> driveRelay;
    std::unique_ptr<juce::WebSliderRelay> cutoffRelay;

    // 2. WEBVIEW SECOND (destroyed middle)
    std::unique_ptr<SinglePageBrowser> webView;

    // 3. ATTACHMENTS LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> driveAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> cutoffAttachment;
```

#### 3. **Correct WebView Configuration**

```cpp
webView = std::make_unique<SinglePageBrowser>(
    juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(
                    juce::File::tempDirectory).getChildFile("NPS_AngelGrain")))
        .withNativeIntegrationEnabled()  // ← CRITICAL
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider([&editor](const juce::String& url) {
            return editor.getResource(url);
        })
        .withOptionsFrom(*delayTimeRelay)  // ← Register ALL relays
        .withOptionsFrom(*grainSizeRelay)
        .withOptionsFrom(*feedbackRelay)
        // ... (all parameters)
);
```

---

### ❌ What's Broken (nf_gnarly Pattern)

The nf_gnarly plugin demonstrates the **typical failure pattern**:

#### 1. **Wrong JavaScript Pattern**

```javascript
// WRONG - These methods don't exist!
const juce = window.__JUCE__;

function loadParameters() {
    if (juce && juce.getParameter) {  // ← DOESN'T EXIST
        parameters.drive.value = juce.getParameter('drive');
    }
}

function setParameter(paramName, value) {
    if (juce && juce.setParameter) {  // ← DOESN'T EXIST
        juce.setParameter(paramName, value);
    }
}
```

**Problem:** The JUCE API doesn't have `getParameter()` or `setParameter()` methods. Communication happens via:
- `SliderState` objects created with `getSliderState(name)`
- Event-based updates via `valueChangedEvent.addListener()`
- Normalized values via `setNormalisedValue()` / `getNormalisedValue()`

#### 2. **Missing JUCE Bridge Code**

The nf_gnarly HTML is missing:
- ❌ ListenerList class
- ❌ EventListenerList class
- ❌ Backend class
- ❌ SliderState class
- ❌ ToggleState class
- ❌ getSliderState() helper function

**Without these**, the JavaScript has no way to communicate with C++.

#### 3. **Missing Critical Method Calls**

```javascript
// WRONG - No drag lifecycle management
knob.addEventListener('mousedown', (e) => {
    isDragging = true;
    // Missing: sliderState.sliderDragStarted()
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    // Missing: sliderState.sliderDragEnded()
});
```

**Problem:** JUCE needs `sliderDragStarted()` and `sliderDragEnded()` calls to properly manage automation recording and parameter gestures in DAWs.

---

## Gap Analysis

### Templates Inventory

| Component | Location | Status |
|-----------|----------|--------|
| C++ PluginEditor.h | `templates/webview/` | ✅ Exists |
| C++ PluginEditor.cpp | `templates/webview/` | ✅ Exists |
| CMakeLists.txt | `templates/webview/` | ✅ Exists |
| HTML Template | `templates/webview/` | ❌ **MISSING** |
| JavaScript Bridge | `templates/webview/` | ❌ **MISSING** |

### Documentation Inventory

| Document | Status | Issues |
|----------|--------|--------|
| skill_design_webview/SKILL.md | ✅ Exists | Shows structure but doesn't include full JUCE bridge code |
| WebView Quick Start | ✅ Exists | Good C++ documentation, minimal JS examples |
| Working Example (AngelGrain) | ✅ Exists | Perfect reference but not templated |

---

## Recommended Solutions

### Priority 1: Create HTML Template with JUCE Bridge ⭐⭐⭐

**File:** `templates/webview/index.html.template`

**Contents:**
1. Complete 3-part JavaScript system (inline)
2. Placeholder sections for plugin-specific CSS
3. Placeholder sections for plugin-specific controls
4. Template variables: `{{PLUGIN_NAME}}`, `{{PARAMETERS}}`, etc.

**Benefits:**
- AI can copy-paste working JUCE bridge code
- 100% consistent with AngelGrain's proven pattern
- Eliminates JavaScript API guessing

**Implementation:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{PLUGIN_NAME}}</title>
    <style>
        /* ========================================
           PLUGIN-SPECIFIC STYLES (CUSTOMIZE)
           ======================================== */
        {{PLUGIN_STYLES}}
    </style>
</head>
<body>
    {{PLUGIN_HTML}}

    <script>
        /******************************************************************************
         * PART 1: Native Interop (DO NOT MODIFY)
         ******************************************************************************/
        // [COMPLETE check_native_interop.js CODE FROM ANGELGRAIN]

        /******************************************************************************
         * PART 2: JUCE Bridge (DO NOT MODIFY)
         ******************************************************************************/
        // [COMPLETE juce/index.js CODE FROM ANGELGRAIN]

        /******************************************************************************
         * PART 3: Plugin UI Logic (CUSTOMIZE)
         ******************************************************************************/
        const paramConfigs = {
            {{PARAMETER_CONFIGS}}
        };

        function initializeKnobs() {
            document.querySelectorAll('.knob').forEach(knob => {
                const paramId = knob.dataset.param;
                const config = paramConfigs[paramId];
                const sliderState = getSliderState(paramId);

                // [STANDARD KNOB IMPLEMENTATION]
            });
        }

        document.addEventListener('DOMContentLoaded', () => {
            initializeKnobs();
        });
    </script>
</body>
</html>
```

### Priority 2: Update skill_design_webview/SKILL.md ⭐⭐

**Changes:**
1. Add section: "CRITICAL: Include JUCE Bridge Code"
2. Instruct AI to copy PART 1 and PART 2 from template (never modify)
3. Show example of PART 3 customization
4. Add validation checklist: "Does HTML include SliderState class?"

### Priority 3: Create Validation Script ⭐

**File:** `scripts/validate-webview-html.ps1`

**Checks:**
- ✅ HTML file includes "class SliderState"
- ✅ HTML file includes "getSliderState"
- ✅ HTML file includes "window.__JUCE__.backend"
- ✅ All parameter IDs match between C++ and JavaScript
- ✅ All controls have `data-param` attributes

### Priority 4: Add Pre-Implementation Check ⭐

**In skill_implementation/SKILL.md:**

Before generating code, the AI should:
1. Read `templates/webview/index.html.template`
2. Verify template contains complete JUCE bridge code
3. Use template as base for plugin HTML

---

## Testing Plan

### Phase 1: Create Templates (1 hour)
1. Extract JUCE bridge code from AngelGrain HTML
2. Create `index.html.template` with placeholders
3. Test template with nf_gnarly plugin

### Phase 2: Update Documentation (30 min)
1. Update skill_design_webview/SKILL.md
2. Add "JUCE Bridge Requirements" section
3. Add troubleshooting: "Controls don't work? Missing SliderState class"

### Phase 3: Validation (30 min)
1. Create validation script
2. Run against AngelGrain (should pass)
3. Run against nf_gnarly (should fail initially)

### Phase 4: Implementation Test (1 hour)
1. Use updated framework to implement nf_gnarly
2. Verify controls work correctly
3. Test in DAW (Reaper/Ableton)
4. Verify no crashes on unload

---

## Success Metrics

**Before Improvements:**
- ❌ 10% success rate (1 in 10 plugins work)
- ❌ Controls don't respond to user input
- ❌ No automation updates from DAW
- ❌ AI generates incorrect JavaScript API calls

**After Improvements:**
- ✅ 90%+ success rate (9 in 10 plugins work)
- ✅ Controls work on first implementation
- ✅ Automation works bidirectionally
- ✅ AI uses correct SliderState pattern consistently

---

## Implementation Checklist

- [ ] Extract AngelGrain JUCE bridge code (Parts 1 & 2)
- [ ] Create `templates/webview/index.html.template`
- [ ] Add parameter config template system
- [ ] Update `skill_design_webview/SKILL.md` with bridge code requirements
- [ ] Create `scripts/validate-webview-html.ps1`
- [ ] Add pre-implementation check to skill_implementation
- [ ] Test with nf_gnarly plugin
- [ ] Document in troubleshooting database
- [ ] Update README with template usage

---

## Appendix A: Complete JUCE Bridge Code

### Part 1: Native Interop (320 lines)
See: `plugins/AngelGrain/Source/ui/public/index.html` lines 330-362

### Part 2: JUCE Bridge (58 lines)
See: `plugins/AngelGrain/Source/ui/public/index.html` lines 364-418

### Part 3: Plugin Logic (Variable)
See: `plugins/AngelGrain/Source/ui/public/index.html` lines 420-481

---

## Appendix B: File Structure Comparison

### Working (AngelGrain)
```
plugins/AngelGrain/
└── Source/
    └── ui/
        └── public/
            └── index.html  ← Single file, all code inline
```

### Alternative (Framework Convention)
```
plugins/PluginName/
└── Design/
    └── index.html  ← Single file, all code inline
```

**Note:** Both work, but AngelGrain uses `Source/ui/public/` while the framework documents `Design/`. The C++ CMakeLists.txt path must match the actual location.

---

## Appendix C: Common Failure Patterns

### Pattern 1: Missing JUCE Bridge
**Symptom:** "Cannot read property 'getParameter' of undefined"
**Cause:** Missing SliderState class
**Fix:** Include complete JUCE bridge code (Parts 1 & 2)

### Pattern 2: Wrong API Calls
**Symptom:** Controls don't respond
**Cause:** Using `juce.getParameter()` instead of `getSliderState()`
**Fix:** Use SliderState objects for all parameter access

### Pattern 3: No Automation Updates
**Symptom:** DAW automation doesn't update UI
**Cause:** Missing `valueChangedEvent.addListener()`
**Fix:** Register listener on SliderState objects

### Pattern 4: Crashes on Unload
**Symptom:** DAW crashes when closing plugin
**Cause:** Wrong member order in PluginEditor.h
**Fix:** Relays → WebView → Attachments

---

**End of Analysis**
