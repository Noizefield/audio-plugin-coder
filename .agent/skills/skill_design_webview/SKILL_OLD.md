---
name: juce-webview-windows
description: Complete guide for building JUCE 8 audio plugins with WebView2 UIs on Windows. Use when working with JUCE WebBrowserComponent, WebView2, web-based plugin UIs, React/Vue/HTML frontends for VST/AU plugins, parameter attachments, JavaScript-C++ communication, hot reloading, or debugging WebView plugins. Covers CMake configuration, frontend-backend communication patterns, performance optimization, and Windows-specific WebView2 setup.
---

# JUCE 8 WebView UIs - Complete Windows Guide

## Overview

JUCE 8 enables building audio plugin and application UIs using web technologies (React, Vue, Svelte, or plain HTML/CSS/JavaScript) via Microsoft's WebView2 component on Windows 11.

### Traditional vs WebView Plugin UI

```
TRADITIONAL APPROACH:              WEBVIEW APPROACH:
┌─────────────────────┐            ┌─────────────────────┐
│ C++ JUCE Code       │            │ C++ JUCE Code       │
│ +-----------------+ │            │ +-----------------+ │
│ | JUCE Components | │            │ | WebView2        | │
│ | (Buttons, etc)  | │            │ | Browser         | │
│ +-----------------+ │            │ | +-------------+ | │
│        │            │            │ | | HTML/CSS/JS | | │
│        ▼            │            │ | +-------------+ | │
│ Native Controls     │            │ +-----------------+ │
└─────────────────────┘            └─────────────────────┘
                                         │
                    ┌────────────────────┘
                    ▼
            Modern web technologies
            (React, Vue, plain HTML/CSS/JS)
```

## Key Benefits

- **Rapid Iteration**: Hot reloading for quick UI development
- **Modern Frameworks**: Use mature web frontend frameworks and component libraries
- **Team Collaboration**: Frontend developers can work without touching C++
- **Hardware Acceleration**: GPU acceleration via WebGL
- **Familiar Workflow**: Standard web development practices
- **Modern UI**: Full CSS framework support, animations, responsive design
- **Web Ecosystem**: Access to npm packages, libraries, tools
- **Custom Design**: Complete creative freedom, no native look constraints

## Important Considerations

- JUCE doesn't provide built-in UI widgets - use web component libraries
- WebView rendering may vary across browser versions
- Use polyfills for cross-platform compatibility
- Parameter value calculations currently handled frontend-side
- Best practices still evolving for this paradigm
- WebView adds ~100MB to plugin memory footprint

---

## 🔴 CRITICAL: Member Declaration Order (PREVENTS DAW CRASHES)

**⚠️ THIS IS THE #1 CAUSE OF WEBVIEW PLUGIN CRASHES - READ CAREFULLY**

### The Problem

C++ destroys member variables in **REVERSE order of declaration**. If your `WebBrowserComponent` is destroyed AFTER the `WebSliderRelay` objects it references (via `.withOptionsFrom()`), the WebView will attempt to access freed memory during its destructor, causing a **segmentation fault that crashes the entire DAW**.

### The Solution: ALWAYS Use This Declaration Order

```cpp
// PluginEditor.h - Member declaration section
private:
    YourAudioProcessor& audioProcessor;

    // ═══════════════════════════════════════════════════════════════════
    // CRITICAL: Member Declaration Order (Destruction = Reverse Order)
    // ═══════════════════════════════════════════════════════════════════
    //
    // RULE: Relays → WebView → Attachments
    //
    // RATIONALE: WebView references relays via .withOptionsFrom().
    //            WebView must be destroyed BEFORE relays to avoid
    //            accessing freed memory (segfault/DAW crash).
    // ═══════════════════════════════════════════════════════════════════

    // 1. PARAMETER RELAYS FIRST (no dependencies)
    juce::WebSliderRelay gainRelay { "GAIN" };
    juce::WebSliderRelay frequencyRelay { "FREQUENCY" };
    juce::WebToggleButtonRelay bypassRelay { "BYPASS" };

    // 2. WEBVIEW SECOND (depends on relays)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. PARAMETER ATTACHMENTS LAST (depend on relays + parameters)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> frequencyAttachment;
    std::unique_ptr<juce::WebToggleButtonParameterAttachment> bypassAttachment;
```

### Why This Order Matters

**Destruction happens in REVERSE:**

✅ **CORRECT ORDER** (Relays → WebView → Attachments):
```
Destruction Order:
1. attachments destroyed first ✅
2. webView destroyed second ✅ (relays still valid)
3. relays destroyed last ✅
Result: No crashes
```

❌ **WRONG ORDER** (WebView → Relays → Attachments):
```
Destruction Order:
1. attachments destroyed first ✅
2. relays destroyed second ❌
3. webView destroyed last ❌ (tries to access destroyed relays)
Result: CRASH! Segmentation fault, DAW terminates
```

### Checklist - ALWAYS Verify

- [ ] Relays declared BEFORE webView
- [ ] WebView declared BEFORE attachments
- [ ] Relays are direct members (not `std::unique_ptr`)
- [ ] WebView is `std::unique_ptr<juce::WebBrowserComponent>`
- [ ] Attachments are `std::unique_ptr<...Attachment>`
- [ ] Added comment explaining destruction order

**This is non-negotiable for WebView plugins. One wrong order = DAW crashes.**

---

## Windows WebView2 Component

### What is WebView2?

WebView2 is Microsoft's embedded browser component based on **Chromium** (same engine as Edge). It allows you to embed a full browser window in your native application.

```
┌─────────────────────────────────────────┐
│         Native Application              │
│  ┌───────────────────────────────────┐  │
│  │     WebView2 Browser Control      │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │     Chromium Engine         │  │  │
│  │  │  - HTML Rendering           │  │  │
│  │  │  - JavaScript Execution     │  │  │
│  │  │  - CSS Styling              │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Windows Compatibility

- **Windows 11**: WebView2 runtime pre-installed ✅
- **Windows 10**: Majority received mid-2022 update with runtime
- WebView component is OS-native, **not bundled** with your app

### WebView2 Package Components

The WebView2 NuGet package provides:
- `WebView2Loader.dll` - Runtime loader
- `WebView2LoaderStatic.lib` - Static linking library (recommended)
- `WebView2.h` - C++ headers

**Default installation location:**
```
%USERPROFILE%\AppData\Local\PackageManagement\NuGet\Packages\
microsoft.web.webview2.1.0.1901.177\
```

## Key Changes from JUCE 7

### 1. Enhanced WebBrowserComponent

New low-level functions:
- `evaluateJavascript()` - Execute JavaScript in WebView context
- `emitEventIfBrowserIsVisible()` - Emit events to JavaScript

### 2. New Options for WebBrowserComponent::Options

```cpp
.withInitialisationData()          // Pass key-value pairs to JavaScript
.withUserScript()                  // Run JS before page load
.withNativeIntegrationEnabled()    // Enable C++/JS communication
.withNativeFunction()              // Expose C++ functions to JS
.withEventListener()               // Listen to JS events in C++
.withResourceProvider()            // Serve resources from C++ to WebView
```

### 3. Static WebView2 Linking

Windows best practice: statically link the WebView2 loader (not the runtime itself).

Flag: `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING`

### 4. WebViewPluginDemo

New demo project showing React frontend integration with audio processing.

## File Architecture

### Web UI Directory Structure

```
plugin/Source/ui/public/
├── index.html           # Main HTML file with embedded CSS
├── js/
│   ├── index.js        # JavaScript logic + JUCE communication
│   └── juce/
│       └── index.js    # JUCE frontend library (auto-generated)
└── assets/             # Images, fonts, etc (optional)
```

### Web Files Role

| File | Purpose |
|------|---------|
| `index.html` | Structure and styling (HTML + CSS) |
| `js/index.js` | UI interactions and JUCE API calls |
| `js/juce/index.js` | Bridge library for C++ ↔ JS communication |

### What Gets Compiled

During build, all files in `plugin/Source/ui/public/` are:
1. Zipped into `webview_files.zip`
2. Converted to C++ binary data (`WebViewFiles.h`)
3. Linked into the final plugin binary

**Result:** The plugin contains the entire web UI embedded—no external files needed at runtime!

## Project Configuration

### CMake Setup

```cmake
# Add to juce_add_gui_app or juce_add_plugin
NEEDS_WEBVIEW2 TRUE

# Compile definitions
target_compile_definitions(YourTarget
    PRIVATE
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)

# Optional: Custom WebView2 package location
set(JUCE_WEBVIEW2_PACKAGE_LOCATION "path/to/webview2")
```

### Projucer Setup

Enable in `Modules > juce_gui_extra`:
- `JUCE_WEB_BROWSER` = enabled
- `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING` = enabled

### Required Module

The WebView functionality is in the `juce_gui_extra` module.

## The Build Process Explained

### Step 1: CMake Configuration

```cmd
cmake --preset vs
```

**What happens:**
```
CMakeLists.txt
        │
        ▼
1. Read CMakePresets.json (configures build system)
        │
        ▼
2. Download CPM.cmake (if not present)
        │
        ▼
3. Download JUCE 8.0.6 framework → libs/juce/
        │
        ▼
4. Execute DownloadWebView2.ps1
   └── Installs Microsoft.Web.WebView2 NuGet package
        │
        ▼
5. Generate Visual Studio solution → vs-build/
```

### Step 2: Compilation

```cmd
cmake --build --preset vs
```

**What happens:**
```
1. Compile C++ source files
        │
        ▼
2. Zip web UI files → webview_files.zip
        │
        ▼
3. Convert zip to C++ array → WebViewFiles.h
        │
        ▼
4. Link JUCE libraries + WebView2 + binary data
        │
        ▼
5. Output: JuceWebViewPlugin.vst3 / .exe
```

### Step 3: Runtime Loading

```
Plugin launches
        │
        ▼
PluginEditor.cpp creates WebBrowserComponent
        │
        ▼
WebBrowserComponent loads embedded HTML
        │
        ▼
JUCE frontend library (juce/index.js) initializes
        │
        ▼
Web UI is ready and interactive!
```

### How JUCE Embeds Web Files

**Build Time:**
```
plugin/Source/ui/public/
├── index.html
├── js/index.js
└── js/juce/index.js
        │
        ▼  (CMake zip)
webview_files.zip (binary archive)
        │
        ▼  (JUCE binary data tool)
WebViewFiles.h (C++ array of bytes)
        │
        ▼  (Compilation)
WebViewFiles.obj
        │
        ▼  (Linking)
JuceWebViewPlugin.dll/vst3
```

**Runtime:**
```
Plugin loads
        │
        ▼
WebBrowserComponent::loadHTML()
        │
        ▼
Extract embedded zip from binary
        │
        ▼
Serve HTML/JS/CSS from memory
        │
        ▼
Browser renders page
```

## WebBrowserComponent Setup

### Essential Windows Configuration

```cpp
webBrowser = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(File::getSpecialLocation(
                    File::SpecialLocationType::tempDirectory)))
        .withNativeIntegrationEnabled()
        // ... additional options
);
```

**Critical for Windows:**
- Specify `.withBackend(webview2)` - WebView2 is not yet the default
- Specify `.withUserDataFolder()` - Required for plugins to work properly

### Loading Pages

**Debug mode (development server):**
```cpp
webComponent.goToURL("localhost:3000");
```

**Release mode (from embedded C++ resources):**
```cpp
webComponent.goToURL(WebBrowserComponent::getResourceProviderRoot());
```

## Resource Providers

### Purpose

Acts as a lightweight web server to serve content from C++ to the WebView.

### Common Patterns

**Release builds**: Serve HTML, CSS, JS, images from `BinaryData`

**Debug builds**: May use localhost dev server, but can still use resource provider for C++ backend data (e.g., spectrum visualization)

### Resource Provider Addresses

Access from JavaScript using:
```javascript
juce.getBackendResourceAddress(path)
```

**Windows resolution:**
```
https://juce.backend/ + path
```

### localhost Development

When loading from localhost (e.g., `localhost:3000`), supply origin to `withResourceProvider`'s optional `allowsOriginIn` parameter.

## Frontend-Backend Communication

### The Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     JavaScript (Frontend)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ window.__JUCE__.backend                             │   │
│  │   .emitEvent("name", data)     → Send to C++       │   │
│  │   .addEventListener("name",    ← Receive from C++  │   │
│  │     (callback))                                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ JSON over internal bridge
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     C++ JUCE (Backend)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ backend                                              │   │
│  │   .emitEvent("name", data)     → Send to JS        │   │
│  │   .addEventListener("name",    ← Receive from JS   │   │
│  │     (callback))                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Audio Engine                                         │   │
│  │   - Process audio buffers                            │   │
│  │   - Manage parameters                                │   │
│  │   - Handle state                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### JavaScript → C++ Communication

**JavaScript (index.js):**
```javascript
// Send data to C++
window.__JUCE__.backend.emitEvent("parameterChanged", {
    paramId: "gain",
    value: 0.75
});

// Listen for events from C++
window.__JUCE__.backend.addEventListener("updateUI", (data) => {
    console.log("Received from C++:", data);
});
```

**C++ (PluginProcessor.cpp):**
```cpp
// Listen for events from JavaScript
backend.addEventListener("parameterChanged", [](auto obj) {
    String paramId = obj["paramId"].toString();
    float value = obj["value"].toString().getFloatValue();
    
    // Update parameter
    if (paramId == "gain") {
        gainParam->setValueNotifyingHost(value);
    }
});

// Send event to JavaScript
backend.emitEvent("updateUI", var{
    "level", -3.5f
});
```

### Custom Event Flow

**JavaScript to C++:**
```
1. JS: emitEvent("myEvent", {key: value})
        │
        ▼
2. JUCE frontend library serializes JSON
        │
        ▼
3. Internal message passing to C++
        │
        ▼
4. C++ backend receives: obj["key"] == "value"
```

**C++ to JavaScript:**
```
1. C++: backend.emitEvent("myEvent", var{"key", "value"})
        │
        ▼
2. JUCE serializes var to JSON
        │
        ▼
3. Internal message passing to JS
        │
        ▼
4. JS callback receives: {key: "value"}
```

## Native Functions (C++ to JavaScript)

### Exposing C++ Functions

```cpp
.withNativeFunction("loadPreset", [](auto& var, auto complete)
{
    int presetID = var[0];
    loadPresetID(presetID);  // Your C++ implementation
    complete("Preset Loaded: " + var[0].toString());
})
```

### Calling from JavaScript

```javascript
const loadPreset = Juce.getNativeFunction("loadPreset");
loadPreset(45).then((result) => {
    console.log(result);  // "Preset Loaded: 45"
});
```

**Note**: API is asynchronous using JavaScript Promises.

## JUCE Frontend Library

### Location
`modules/juce_gui_extra/native/javascript/index.js`

### Features
- Designed to run without errors even when backend is absent
- Allows frontend development and visual testing without C++ machinery
- Import as `Juce` namespace in your JavaScript code

### Provided Functions

| Function | Purpose |
|----------|---------|
| `Juce.getSliderState(id)` | Get slider parameter sync object |
| `Juce.getToggleState(id)` | Get toggle parameter sync object |
| `Juce.getComboBoxState(id)` | Get combo box parameter sync object |
| `Juce.getNativeFunction(name)` | Call C++ function directly |
| `Juce.getBackendResourceAddress(path)` | Get URL for embedded resource |
| `window.__JUCE__.backend` | Event bus for custom messages |

## Parameter Attachments & Synchronization

### Attachment Types

JUCE provides built-in web parameter attachments:
- `WebSliderParameterAttachment`
- `WebToggleButtonParameterAttachment`
- `WebComboBoxParameterAttachment`

### Creating Attachments in C++

```cpp
// Create relay and attachment
WebSliderRelay gainRelay{browser, "GAIN"};
WebSliderParameterAttachment gainWebAttachment{
    *processor.parameters.getParameter("GAIN"),
    gainRelay,
    nullptr
};

// Pass relay to WebBrowserComponent constructor
webBrowser = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(File::getSpecialLocation(
                    File::SpecialLocationType::tempDirectory)))
        .withOptionsFrom(gainRelay)
        // ... other options
);
```

### Slider State (JavaScript)

```javascript
// Get the slider state object
const sliderState = Juce.getSliderState("GAIN");

// Set value from JavaScript (0.0 to 1.0)
sliderState.setNormalisedValue(0.5);

// Listen for changes from C++ (e.g., DAW automation)
sliderState.valueChangedEvent.addListener(() => {
    const currentValue = sliderState.getNormalisedValue();
    console.log("Slider value:", currentValue);
    // Update your UI element here
});

// Notify backend of drag events
slider.addEventListener("mousedown", () => {
    sliderState.sliderDragStarted();
});

slider.addEventListener("mouseup", () => {
    sliderState.sliderDragEnded();
});

// Update when user interacts
slider.addEventListener("input", (event) => {
    sliderState.setNormalisedValue(slider.value / slider.max);
});
```

### Toggle State (JavaScript)

```javascript
const toggleState = Juce.getToggleState("BYPASS");

// Listen for changes from C++
toggleState.valueChangedEvent.addListener(() => {
    const isOn = toggleState.getValue();
    console.log("Bypass:", isOn);
    checkbox.checked = isOn;
});

// Update when user clicks
checkbox.addEventListener("input", () => {
    toggleState.setValue(checkbox.checked);
});
```

### ComboBox State (JavaScript)

```javascript
const comboState = Juce.getComboBoxState("DISTORTION_TYPE");

// Populate dropdown when choices change
comboState.propertiesChangedEvent.addListener(() => {
    const select = document.getElementById("distortionTypeComboBox");
    select.innerHTML = "";
    comboState.properties.choices.forEach(choice => {
        select.innerHTML += `<option value="${choice}">${choice}</option>`;
    });
});

// Handle selection changes from C++
comboState.valueChangedEvent.addListener(() => {
    const index = comboState.getChoiceIndex();
    select.selectedIndex = index;
});

// Update when user selects
select.addEventListener("input", () => {
    comboState.setChoiceIndex(select.selectedIndex);
});
```

## Step-by-Step Implementation Guide

### Step 1: Create the Web UI Directory

```
your-plugin/
└── plugin/
    └── ui/
        └── public/
            ├── index.html
            └── js/
                └── index.js
```

### Step 2: Write index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Web Plugin</title>
  <!-- webview-008: ALL JavaScript must be INLINE - external scripts fail silently -->
  <style>
    /* Modern dark theme */
    body {
        background: #1a1a2e;
        color: #e0e0e0;
        font-family: system-ui, -apple-system, sans-serif;
        margin: 0;
        padding: 20px;
    }
    .control-group {
        margin: 20px 0;
    }
    input[type="range"] {
        width: 100%;
    }
  </style>
</head>
<body>
  <h1>My Plugin</h1>
  
  <div class="control-group">
    <label for="gainSlider">Gain</label>
    <input type="range" id="gainSlider" min="0" max="1" step="0.01" value="0.5">
    <span id="gainValue">0.5</span>
  </div>
  
  <div class="control-group">
    <label>
      <input type="checkbox" id="bypassCheckbox">
      Bypass
    </label>
  </div>
  
  <div class="control-group">
    <label for="distortionTypeComboBox">Distortion Type</label>
    <select id="distortionTypeComboBox"></select>
  </div>
</body>
</html>
```

### Step 3: Write index.js

```javascript
// const Juce = window.Juce;  // inlined library (webview-008: no imports)

// Wait for DOM
document.addEventListener("DOMContentLoaded", () => {
    // Get parameter states
    const gainState = Juce.getSliderState("GAIN");
    const bypassState = Juce.getToggleState("BYPASS");
    const distState = Juce.getComboBoxState("DISTORTION_TYPE");
    
    // Get UI elements
    const gainSlider = document.getElementById("gainSlider");
    const gainValue = document.getElementById("gainValue");
    const bypassCheckbox = document.getElementById("bypassCheckbox");
    const distComboBox = document.getElementById("distortionTypeComboBox");
    
    // === GAIN SLIDER ===
    gainSlider.addEventListener("mousedown", () => {
        gainState.sliderDragStarted();
    });
    
    gainSlider.addEventListener("mouseup", () => {
        gainState.sliderDragEnded();
    });
    
    gainSlider.addEventListener("input", () => {
        gainState.setNormalisedValue(gainSlider.value);
        gainValue.textContent = gainSlider.value;
    });
    
    // Listen for C++ changes
    gainState.valueChangedEvent.addListener(() => {
        const value = gainState.getNormalisedValue();
        gainSlider.value = value;
        gainValue.textContent = value.toFixed(2);
    });
    
    // === BYPASS CHECKBOX ===
    bypassCheckbox.addEventListener("input", () => {
        bypassState.setValue(bypassCheckbox.checked);
    });
    
    bypassState.valueChangedEvent.addListener(() => {
        bypassCheckbox.checked = bypassState.getValue();
    });
    
    // === DISTORTION COMBOBOX ===
    distState.propertiesChangedEvent.addListener(() => {
        distComboBox.innerHTML = "";
        distState.properties.choices.forEach(choice => {
            distComboBox.innerHTML += `<option value="${choice}">${choice}</option>`;
        });
    });
    
    distState.valueChangedEvent.addListener(() => {
        distComboBox.selectedIndex = distState.getChoiceIndex();
    });
    
    distComboBox.addEventListener("input", () => {
        distState.setChoiceIndex(distComboBox.selectedIndex);
    });
    
    // === CUSTOM EVENTS ===
    // Send custom event to C++
    window.__JUCE__.backend.emitEvent("uiReady", { 
        timestamp: Date.now() 
    });
    
    // Listen for custom events from C++
    window.__JUCE__.backend.addEventListener("customUpdate", (data) => {
        console.log("Received from C++:", data);
    });
});
```

### Step 4: Define Parameters in C++

**ParameterIDs.hpp:**
```cpp
namespace ParameterIDs {
    constexpr char GAIN[] = "GAIN";
    constexpr char BYPASS[] = "BYPASS";
    constexpr char DISTORTION_TYPE[] = "DISTORTION_TYPE";
}
```

**PluginProcessor.h:**
```cpp
class AudioProcessor : public juce::AudioProcessor {
public:
    // ...
    
private:
    juce::AudioParameterFloat* gainParam;
    juce::AudioParameterBool* bypassParam;
    juce::AudioParameterChoice* distTypeParam;
    
    void createParameters();
};
```

**PluginProcessor.cpp:**
```cpp
#include "ParameterIDs.hpp"

AudioProcessor::AudioProcessor() {
    createParameters();
}

void AudioProcessor::createParameters() {
    gainParam = new juce::AudioParameterFloat(
        ParameterIDs::GAIN, "Gain",
        juce::NormalisableRange<float>(0.0f, 1.0f), 
        0.5f
    );
    
    bypassParam = new juce::AudioParameterBool(
        ParameterIDs::BYPASS, "Bypass", 
        false
    );
    
    distTypeParam = new juce::AudioParameterChoice(
        ParameterIDs::DISTORTION_TYPE, "Distortion Type",
        juce::StringArray{"Clean", "Overdrive", "Distortion", "Fuzz"}, 
        0
    );
    
    addParameter(gainParam);
    addParameter(bypassParam);
    addParameter(distTypeParam);
}
```

### Step 5: Initialize WebView in Editor

**PluginEditor.h:**
```cpp
#include <JuceHeader.h>
#include "PluginProcessor.h"

class PluginEditor : public juce::AudioProcessorEditor {
public:
    PluginEditor(AudioProcessor& p);
    ~PluginEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    AudioProcessor& processor;
    std::unique_ptr<juce::WebBrowserComponent> webView;
    
    // Parameter attachments
    std::unique_ptr<WebSliderRelay> gainRelay;
    std::unique_ptr<WebSliderParameterAttachment> gainAttachment;
    
    std::unique_ptr<WebToggleButtonRelay> bypassRelay;
    std::unique_ptr<WebToggleButtonParameterAttachment> bypassAttachment;
    
    std::unique_ptr<WebComboBoxRelay> distTypeRelay;
    std::unique_ptr<WebComboBoxParameterAttachment> distTypeAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginEditor)
};
```

**PluginEditor.cpp:**
```cpp
#include "PluginEditor.h"
#include "ParameterIDs.hpp"

PluginEditor::PluginEditor(AudioProcessor& p)
    : AudioProcessorEditor(&p), processor(p)
{
    setSize(600, 400);
    
    // Create parameter relays
    gainRelay = std::make_unique<WebSliderRelay>(
        *webView, ParameterIDs::GAIN
    );
    bypassRelay = std::make_unique<WebToggleButtonRelay>(
        *webView, ParameterIDs::BYPASS
    );
    distTypeRelay = std::make_unique<WebComboBoxRelay>(
        *webView, ParameterIDs::DISTORTION_TYPE
    );
    
    // Create WebBrowserComponent with all options
    webView = std::make_unique<juce::WebBrowserComponent>(
        juce::WebBrowserComponent::Options()
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withWinWebView2Options(
                juce::WebBrowserComponent::Options::WinWebView2{}
                    .withUserDataFolder(juce::File::getSpecialLocation(
                        juce::File::SpecialLocationType::tempDirectory)))
            .withNativeIntegrationEnabled()
            .withOptionsFrom(*gainRelay)
            .withOptionsFrom(*bypassRelay)
            .withOptionsFrom(*distTypeRelay)
            .withEventListener("uiReady", [](const juce::var& data) {
                DBG("UI is ready at: " + data["timestamp"].toString());
            })
    );
    
    addAndMakeVisible(*webView);
    
    // Create parameter attachments
    gainAttachment = std::make_unique<WebSliderParameterAttachment>(
        *processor.parameters.getParameter(ParameterIDs::GAIN),
        *gainRelay,
        nullptr
    );
    bypassAttachment = std::make_unique<WebToggleButtonParameterAttachment>(
        *processor.parameters.getParameter(ParameterIDs::BYPASS),
        *bypassRelay
    );
    distTypeAttachment = std::make_unique<WebComboBoxParameterAttachment>(
        *processor.parameters.getParameter(ParameterIDs::DISTORTION_TYPE),
        *distTypeRelay
    );
    
    // Load web content
    #if JUCE_DEBUG
        // Development server
        webView->goToURL("http://localhost:3000");
    #else
        // Embedded resources
        webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
    #endif
}

PluginEditor::~PluginEditor() {
}

void PluginEditor::paint(juce::Graphics& g) {
    g.fillAll(juce::Colours::black);
}

void PluginEditor::resized() {
    webView->setBounds(getLocalBounds());
}
```

### Step 6: Build Configuration

**CMakeLists.txt excerpt:**
```cmake
juce_add_plugin(MyPlugin
    PLUGIN_MANUFACTURER_CODE Manu
    PLUGIN_CODE Demo
    FORMATS VST3 Standalone
    PRODUCT_NAME "My WebView Plugin"
    NEEDS_WEBVIEW2 TRUE
)

target_compile_definitions(MyPlugin
    PRIVATE
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)

# Add web UI files to binary data
juce_add_binary_data(MyPlugin_WebUI
    SOURCES
        plugin/Source/ui/public/index.html
        plugin/Source/ui/public/js/index.js
)

target_link_libraries(MyPlugin
    PRIVATE
        MyPlugin_WebUI
        juce::juce_gui_extra
)
```

### Step 7: Build and Test

```cmd
# Configure
cmake --preset vs

# Build
cmake --build --preset vs

# Run standalone
vs-build\plugin\Debug\Standalone\MyPlugin.exe

# VST3 location
vs-build\plugin\Debug\VST3\MyPlugin.vst3
```

## Hot Reloading Workflow

### Setup for Development

1. **Set up a development server in your web UI directory:**

```bash
cd plugin/Source/ui/public
# If using a simple HTTP server
npx http-server -p 3000

# Or with live reload
npx live-server --port=3000
```

2. **In PluginEditor.cpp, use conditional compilation:**

```cpp
#if JUCE_DEBUG
    webView->goToURL("http://localhost:3000");
#else
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
#endif
```

3. **Enable DevTools for debugging:**

```cpp
#if JUCE_DEBUG
    webView->setDevToolsEnabled(true);
#endif
```

4. **Edit and save** - With live-server, the WebView auto-reloads on file changes

5. **Right-click in the WebView** and select "Inspect" to open Edge DevTools

### Release Build Process

For production, the web files are automatically embedded during build. No separate build step needed unless using a bundler like Webpack or Vite.

);
```

## Performance Considerations

| Aspect | Recommendation |
|--------|----------------|
| **Message Rate** | Limit to ~60Hz for parameter updates |
| **JSON Size** | Keep messages small (<1KB) |
| **Rendering** | Use CSS transforms, avoid layout thrashing |
| **Audio Thread** | Never call JS from audio thread - use message queue |
| **Memory** | WebView adds ~100MB to plugin |
| **Startup** | First WebView2 init may take 1-2 seconds |

### Best Practices

**DO:**
- Update UI at 60fps maximum
- Use CSS animations for smooth visuals
- Batch parameter changes when possible
- Test on lower-end hardware
- Profile with Edge DevTools Performance tab

**DON'T:**
- Call JavaScript from the audio processing thread
- Send massive JSON payloads (>1KB)
- Manipulate DOM rapidly (causes reflows)
- Use synchronous operations in hot paths

## Debugging

### Method 1: Edge DevTools

```cpp
#if JUCE_DEBUG
    webView->setDevToolsEnabled(true);
#endif
```

Then **right-click** in WebView → **Inspect**

Available tools:
- Console (JavaScript logs, errors)
- Elements (DOM inspection, CSS debugging)
- Network (resource loading)
- Performance (profiling)
- Sources (JavaScript debugging with breakpoints)

### Method 2: Visual Studio Output

```cpp
DBG("Debug message from C++");  // Appears in VS Output window
```

```javascript
console.log("Debug from JavaScript");  // Appears in Edge DevTools Console
```

### Method 3: Standalone App with Console

```cmd
MyPlugin.exe --console
```

Shows console window with JavaScript output.

### Common Debugging Scenarios

**JavaScript not loading:**
- Check DevTools Console for errors
- Verify file paths in index.html
- Check resource provider is configured correctly

**Parameters not syncing:**
- Verify parameter IDs match exactly (case-sensitive)
- Check attachments are created before WebBrowserComponent
- Use DevTools to inspect `Juce.getSliderState("ID")`

**Events not firing:**
- Verify event names match on both sides
- Check `withNativeIntegrationEnabled()` is set
- Log events on both C++ and JS sides

## Common Issues and Solutions

| Issue | Solution |
|-------|----------|
| **UI not loading** | Check WebView2 Runtime is installed (`edge://version`) |
| **Parameters not syncing** | Verify parameter ID strings match exactly (case-sensitive) |
| **Events not received** | Ensure both sides use same event name |
| **Build fails** | Delete build folder, regenerate: `cmake --preset vs` |
| **Old UI shown** | Rebuild project (web files compiled into binary) |
| **Blank white screen** | Check browser DevTools Console for JS errors |
| **WebView2 not found** | Run `DownloadWebView2.ps1` or install NuGet package manually |
| **Hot reload not working** | Ensure dev server is running on correct port |
| **DevTools won't open** | Call `.setDevToolsEnabled(true)` before loading content |

## Common Mistakes (What NOT to Do)

### ❌ Mistake 1: Using Data URIs Instead of Resource Provider

**WRONG:**
```cpp
const char* htmlContent = R"HTML(...)HTML";
webView.goToURL("data:text/html;base64," + juce::Base64::toBase64(...));
```

**WHY IT FAILS:** Data URIs don't support module imports (`<script type="module">`), can't load external JS files, and break JUCE frontend library integration.

**CORRECT:**
```cpp
// Embed files via juce_add_binary_data in CMakeLists.txt
// Then use resource provider:
webView->goToURL(WebBrowserComponent::getResourceProviderRoot());
```

---

### ❌ Mistake 2: Missing WebView2 Backend Specification

**WRONG:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options{}
);
```

**WHY IT FAILS:** Default backend may not be WebView2 on Windows, causing initialization failures.

**CORRECT:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)
        // ... other options
);
```

---

### ❌ Mistake 3: Missing User Data Folder

**WRONG:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)
        // Missing withUserDataFolder()
);
```

**WHY IT FAILS:** WebView2 requires a user data folder to initialize. Without it, plugins crash or fail silently.

**CORRECT:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(File::getSpecialLocation(
                    File::SpecialLocationType::tempDirectory)))
        // ... other options
);
```

---

### ❌ Mistake 4: Wrong Parameter Relay Order

**WRONG:**
```cpp
// Creating WebBrowserComponent first
webView = std::make_unique<WebBrowserComponent>(...);

// Then trying to create relays
driveRelay = std::make_unique<WebSliderRelay>(*webView, "DRIVE");
```

**WHY IT FAILS:** Relays must exist before WebBrowserComponent is created, as they're passed via `.withOptionsFrom()`.

**CORRECT:**
```cpp
// Step 1: Create relays FIRST (before WebBrowserComponent)
driveRelay = std::make_unique<WebSliderRelay>(*webView, ParameterIDs::DRIVE);

// Step 2: Create WebBrowserComponent with relays
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withOptionsFrom(*driveRelay)
        // ... other options
);

// Step 3: Create attachments AFTER WebBrowserComponent
driveAttachment = std::make_unique<WebSliderParameterAttachment>(...);
```

---

### ❌ Mistake 5: Missing Resource Provider

**WRONG:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(...)
        // Missing withResourceProvider()
);
webView->goToURL("some-url");  // Files won't load!
```

**WHY IT FAILS:** Without resource provider, embedded web files can't be served to the WebView.

**CORRECT:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(...)
        .withResourceProvider([this](const auto& url) {
            return getResource(url);  // Implement this function
        })
);

// Implement getResource() function:
std::optional<WebBrowserComponent::Resource> getResource(const String& url) {
    // Load from embedded zip file
    // See template for full implementation
}
```

---

### ❌ Mistake 6: Not Embedding Web Files in CMakeLists.txt

**WRONG:**
```cmake
juce_add_plugin(MyPlugin
    NEEDS_WEBVIEW2 TRUE
)
# Missing juce_add_binary_data!
```

**WHY IT FAILS:** Web files aren't embedded in the plugin binary, so they can't be loaded at runtime.

**CORRECT:**
```cmake
juce_add_plugin(MyPlugin
    NEEDS_WEBVIEW2 TRUE
)

# Embed web UI files
juce_add_binary_data(MyPlugin_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
)

target_link_libraries(MyPlugin
    PRIVATE
        MyPlugin_WebUI  # Link the embedded files
        # ... other libraries
)
```

---

### ❌ Mistake 7: Missing JUCE Frontend Library

**WRONG:**
```html
<!-- index.html -->
<!-- webview-008: ALL JavaScript must be INLINE - external scripts fail silently -->
```

```javascript
// js/index.js
const Juce = window.Juce;  // inlined - imports fail (webview-008)!
```

**WHY IT FAILS:** JUCE frontend library (`juce/index.js`) must be copied from JUCE modules to your project.

**CORRECT:**
1. Copy `_tools/JUCE/modules/juce_gui_extra/native/javascript/index.js` to `Source/ui/public/js/juce/index.js`
2. Copy `_tools/JUCE/modules/juce_gui_extra/native/javascript/check_native_interop.js` to `Source/ui/public/js/juce/check_native_interop.js`
3. Include both in `juce_add_binary_data()` in CMakeLists.txt

---

### ❌ Mistake 8: Missing Native Integration

**WRONG:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(...)
        // Missing withNativeIntegrationEnabled()
);
```

**WHY IT FAILS:** JavaScript can't communicate with C++ backend, parameters won't sync.

**CORRECT:**
```cpp
webView = std::make_unique<WebBrowserComponent>(
    WebBrowserComponent::Options()
        .withBackend(...)
        .withNativeIntegrationEnabled()  // Required for JS ↔ C++ communication
        // ... other options
);
```

---

## Quick Validation Checklist

Before building, verify:

- [ ] CMakeLists.txt has `juce_add_binary_data()` for web files
- [ ] CMakeLists.txt links the binary data target
- [ ] PluginEditor.cpp uses `.withBackend(webview2)`
- [ ] PluginEditor.cpp uses `.withUserDataFolder()`
- [ ] PluginEditor.cpp uses `.withNativeIntegrationEnabled()`
- [ ] PluginEditor.cpp uses `.withResourceProvider()`
- [ ] Parameter relays created BEFORE WebBrowserComponent
- [ ] Parameter attachments created AFTER WebBrowserComponent
- [ ] Uses `getResourceProviderRoot()` not data URI
- [ ] JUCE frontend library copied to `js/juce/index.js`

**Run validation script:**
```powershell
.\scripts\validate-webview-setup.ps1 -PluginName YourPlugin
```

### Windows-Specific Issues

**WebView2 Runtime Missing:**
```
Error: WebView2 runtime not found
```

**Solution:**
1. Check if installed: Open Edge browser → `edge://version`
2. If missing, download: [WebView2 Runtime Installer](https://developer.microsoft.com/microsoft-edge/webview2/)
3. Install and restart plugin

**User Data Folder Error:**
```
Error: Failed to create WebView2 environment
```

**Solution:**
Ensure user data folder is specified and writable:
```cpp
.withWinWebView2Options(
    juce::WebBrowserComponent::Options::WinWebView2{}
        .withUserDataFolder(juce::File::getSpecialLocation(
            juce::File::SpecialLocationType::tempDirectory))
)
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web Frontend (HTML/CSS/JS)                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  UI Components (React/Vue/Vanilla)                        │  │
│  │  - Sliders, buttons, visualizations                       │  │
│  │  - JUCE Frontend Library (juce/index.js)                  │  │
│  │  - Parameter States (slider, toggle, combobox)            │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                          ┌──────┴──────────┐
                          │  Communication   │
                          │  - Events        │
                          │  - Functions     │
                          │  - Attachments   │
                          │  - JSON Bridge   │
                          └──────┬───────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────┐
│            WebBrowserComponent (JUCE WebView2 Wrapper)          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  - Chromium Engine (WebView2)                             │  │
│  │  - Resource Provider (serves embedded files)              │  │
│  │  - Native Functions (C++ callable from JS)                │  │
│  │  - Event System (bidirectional messaging)                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
┌────────────────────────────────┴────────────────────────────────┐
│                    C++ Backend (JUCE Audio Plugin)              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Audio Processing                                          │  │
│  │  - processBlock()                                          │  │
│  │  - DSP algorithms                                          │  │
│  │  - Buffer management                                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Parameter Management                                      │  │
│  │  - AudioParameterFloat, Bool, Choice                       │  │
│  │  - Parameter attachments                                   │  │
│  │  - State save/load                                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Plugin Editor                                             │  │
│  │  - WebBrowserComponent management                          │  │
│  │  - Parameter relays                                        │  │
│  │  - Event handlers                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## WebViewPluginDemo (Official Example)

### Building the Demo on Windows

**Using CMake:**
```cmd
cmake . -B cmake-build -DJUCE_BUILD_EXAMPLES=ON
cmake --build cmake-build --config Debug
```

**Output location:**
```
cmake-build\examples\GUI\WebViewPluginDemo_artefacts\Debug\VST3\WebViewPluginDemo.vst3
```

**Install VST3:**
```cmd
copy cmake-build\examples\GUI\WebViewPluginDemo_artefacts\Debug\VST3\WebViewPluginDemo.vst3 ^
     %COMMONPROGRAMFILES%\VST3\
```

**Using Projucer:**
- File > Open Example > WebViewPluginDemo
- Export for Visual Studio
- Build in VS

### Demo Features

- Lowpass filter controlled by web UI slider
- Real-time audio spectrum visualization
- React frontend
- Shows parameter attachment patterns
- Demonstrates resource provider for audio data

### Building the React Frontend

The demo uses a React app in `examples/Plugins/WebViewPluginDemoGUI`:

```cmd
cd examples\Plugins\WebViewPluginDemoGUI
npm install
npm run build
```

This creates `examples\Assets\webviewplugin-gui_1.0.0.zip` which the demo loads.

**For development with hot reload:**
```cmd
npm start
```

Then uncomment in the demo's editor code:
```cpp
webComponent.goToURL("http://localhost:3000");
// webComponent.goToURL(WebBrowserComponent::getResourceProviderRoot())