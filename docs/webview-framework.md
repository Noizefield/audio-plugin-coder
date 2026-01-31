# WebView Framework Guide

Complete guide for building audio plugins with WebView2-based UIs using HTML, CSS, and JavaScript.

## Overview

The WebView framework uses Microsoft's WebView2 (Chromium-based) to render plugin UIs using modern web technologies instead of native C++ components.

**Benefits:**
- Fast iteration with hot reload
- Familiar web development workflow
- Rich UI capabilities (CSS animations, gradients, Canvas)
- Team-friendly (frontend developers can contribute)
- GPU acceleration via WebGL

**Trade-offs:**
- ~100MB additional memory footprint
- Windows 11 + WebView2 Runtime dependency
- Different performance characteristics than native C++

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    DAW (Host Application)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Your Plugin (VST3/Standalone)             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │         PluginProcessor (C++ DSP)              │  │  │
│  │  │  ┌─────────────────────────────────────────┐   │  │  │
│  │  │  │     AudioProcessorValueTreeState       │   │  │  │
│  │  │  │         (Parameter Storage)            │   │  │  │
│  │  │  └─────────────────────────────────────────┘   │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                         │                             │  │
│  │  ┌──────────────────────┼─────────────────────────┐  │  │
│  │  │     PluginEditor     │    (C++ Wrapper)       │  │  │
│  │  │  ┌───────────────────┴─────────────────────┐  │  │  │
│  │  │  │      WebBrowserComponent               │  │  │  │
│  │  │  │  ┌─────────────────────────────────┐   │  │  │  │
│  │  │  │  │      WebView2 Runtime           │   │  │  │  │
│  │  │  │  │  ┌─────────────────────────┐    │   │  │  │  │
│  │  │  │  │  │    Chromium Engine      │    │   │  │  │  │
│  │  │  │  │  │  ┌─────────────────┐    │    │   │  │  │  │
│  │  │  │  │  │  │  Your HTML/CSS  │    │    │   │  │  │  │
│  │  │  │  │  │  │    + JavaScript │    │    │   │  │  │  │
│  │  │  │  │  │  └─────────────────┘    │    │   │  │  │  │
│  │  │  │  │  └─────────────────────────┘    │   │  │  │  │
│  │  │  │  └─────────────────────────────────┘   │  │  │  │
│  │  │  └─────────────────────────────────────────┘  │  │  │
│  │  └───────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Communication Flow

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   HTML/JS    │◀───────▶│  WebView2    │◀───────▶│     C++      │
│    (UI)      │  JUCE   │   Runtime    │  JUCE   │    (DSP)     │
└──────────────┘ Frontend └──────────────│  Native └──────────────┘
                                        │  API
                                        │
                              ┌─────────┴──────────┐
                              │  WebSliderRelay    │
                              │  WebSliderParameter│
                              │    Attachment      │
                              └────────────────────┘
```

---

## Critical: Member Declaration Order

### The Rule

**C++ destroys members in REVERSE order of declaration.** WebView references relays, so relays must be declared FIRST to be destroyed LAST.

### Correct Order (PluginEditor.h)

```cpp
class MyPluginEditor : public juce::AudioProcessorEditor
{
private:
    MyAudioProcessor& audioProcessor;

    // ═══════════════════════════════════════════════════════════════
    // CRITICAL: Destruction Order = Reverse of Declaration
    // Order: Relays → WebView → Attachments
    // ═══════════════════════════════════════════════════════════════

    // 1. RELAYS FIRST (destroyed last)
    juce::WebSliderRelay gainRelay { "GAIN" };
    juce::WebSliderRelay frequencyRelay { "FREQUENCY" };

    // 2. WEBVIEW SECOND (destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> frequencyAttachment;
};
```

### Wrong Order (Causes DAW Crash)

```cpp
// WRONG - Crashes on unload!
private:
    std::unique_ptr<juce::WebBrowserComponent> webView;  // ❌ Too early!
    juce::WebSliderRelay gainRelay { "GAIN" };           // ❌ Too late!
```

**See:** [Troubleshooting: WebView Member Order Crash](.kilocode/troubleshooting/resolutions/webview-member-order-crash.md)

---

## Implementation Steps

### Step 1: Create Directory Structure

```
plugins/YourPlugin/
└── Source/
    └── ui/
        └── public/
            ├── index.html
            └── js/
                ├── index.js
                └── juce/
                    └── index.js    (Copy from JUCE)
```

### Step 2: Copy JUCE Frontend Library

```powershell
# Copy from JUCE modules to your plugin
Copy-Item "_tools/JUCE/modules/juce_gui_extra/native/javascript/index.js" `
    "plugins/YourPlugin/Source/ui/public/js/juce/index.js"
```

### Step 3: Create index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Plugin</title>
  <script type="module" src="js/index.js"></script>
  <style>
    :root {
      --primary: #e0e0e0;
      --accent: #4a9eff;
      --background: #1a1a2e;
    }

    body {
      margin: 0;
      padding: 20px;
      background: var(--background);
      color: var(--primary);
      font-family: system-ui, sans-serif;
      width: 600px;
      height: 400px;
      overflow: hidden;
    }

    .control {
      margin-bottom: 20px;
    }

    input[type="range"] {
      width: 100%;
      accent-color: var(--accent);
    }
  </style>
</head>
<body>
  <h1>My Plugin</h1>
  <div class="control">
    <label for="gainSlider">Gain</label>
    <input type="range" id="gainSlider" min="0" max="1" step="0.01" value="0.5">
    <span id="gainValue">0.5</span>
  </div>
</body>
</html>
```

### Step 4: Create index.js

```javascript
import * as Juce from "./juce/index.js";

document.addEventListener("DOMContentLoaded", () => {
    // Get parameter state from C++
    const gainState = Juce.getSliderState("GAIN");

    const gainSlider = document.getElementById("gainSlider");
    const gainValue = document.getElementById("gainValue");

    // User interaction → Update C++
    gainSlider.addEventListener("mousedown", () => gainState.sliderDragStarted());
    gainSlider.addEventListener("mouseup", () => gainState.sliderDragEnded());
    gainSlider.addEventListener("input", () => {
        gainState.setNormalisedValue(parseFloat(gainSlider.value));
        gainValue.textContent = gainSlider.value;
    });

    // C++ automation → Update UI
    gainState.valueChangedEvent.addListener(() => {
        const value = gainState.getNormalisedValue();
        gainSlider.value = value;
        gainValue.textContent = value.toFixed(2);
    });
});
```

### Step 5: Configure CMakeLists.txt

```cmake
# Embed web files into binary
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
)

# Plugin definition
juce_add_plugin(YourPlugin
    COMPANY_NAME "APC"
    PLUGIN_MANUFACTURER_CODE Apco
    PLUGIN_CODE YrPl
    FORMATS VST3 Standalone
    PRODUCT_NAME "Your Plugin"
    NEEDS_WEBVIEW2 TRUE
)

# Link binary data
target_link_libraries(YourPlugin
    PRIVATE
        YourPlugin_WebUI
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
)

# WebView2 definitions
target_compile_definitions(YourPlugin
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)
```

### Step 6: Create ParameterIDs.hpp

```cpp
#pragma once

namespace ParameterIDs {
    constexpr char GAIN[] = "GAIN";
    constexpr char FREQUENCY[] = "FREQUENCY";
}
```

### Step 7: Write PluginEditor.h

```cpp
#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "ParameterIDs.hpp"

class YourPluginEditor : public juce::AudioProcessorEditor
{
public:
    explicit YourPluginEditor(YourAudioProcessor&);
    ~YourPluginEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    YourAudioProcessor& audioProcessor;

    // CRITICAL: Relays → WebView → Attachments
    juce::WebSliderRelay gainRelay { ParameterIDs::GAIN };
    juce::WebSliderRelay frequencyRelay { ParameterIDs::FREQUENCY };

    std::unique_ptr<juce::WebBrowserComponent> webView;

    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebSliderParameterAttachment> frequencyAttachment;

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);
    static const char* getMimeForExtension(const juce::String& extension);
    static juce::String getExtension(juce::String filename);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(YourPluginEditor)
};
```

### Step 8: Write PluginEditor.cpp

```cpp
#include "PluginEditor.h"
#include "BinaryData.h"

YourPluginEditor::YourPluginEditor(YourAudioProcessor& p)
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
            .withOptionsFrom(gainRelay)
            .withOptionsFrom(frequencyRelay)
            .withResourceProvider([this](const auto& url) {
                return getResource(url);
            })
    );

    addAndMakeVisible(*webView);

    // Create attachments (AFTER webView)
    gainAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.getAPVTS().getParameter(ParameterIDs::GAIN),
        gainRelay,
        nullptr
    );

    frequencyAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
        *audioProcessor.getAPVTS().getParameter(ParameterIDs::FREQUENCY),
        frequencyRelay,
        nullptr
    );

    // Load UI
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

YourPluginEditor::~YourPluginEditor() {}

void YourPluginEditor::paint(juce::Graphics& g)
{
    g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
}

void YourPluginEditor::resized()
{
    webView->setBounds(getLocalBounds());
}

std::optional<juce::WebBrowserComponent::Resource> YourPluginEditor::getResource(const juce::String& url)
{
    const auto urlToRetrieve = url == "/" ? juce::String{ "index.html" }
                                          : url.fromFirstOccurrenceOf("/", false, false);

    // Try to find resource in BinaryData
    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
    {
        const char* resourceName = BinaryData::namedResourceList[i];
        const char* originalFilename = BinaryData::getNamedResourceOriginalFilename(resourceName);

        if (originalFilename != nullptr && juce::String(originalFilename).endsWith(urlToRetrieve))
        {
            int dataSize = 0;
            const char* data = BinaryData::getNamedResource(resourceName, dataSize);

            if (data != nullptr && dataSize > 0)
            {
                std::vector<std::byte> byteData((size_t)dataSize);
                std::memcpy(byteData.data(), data, (size_t)dataSize);
                auto mime = getMimeForExtension(getExtension(urlToRetrieve).toLowerCase());
                return juce::WebBrowserComponent::Resource{ std::move(byteData), juce::String{ mime } };
            }
        }
    }

    return std::nullopt;
}

const char* YourPluginEditor::getMimeForExtension(const juce::String& extension)
{
    static const std::unordered_map<juce::String, const char*> mimeMap =
    {
        { { "html" }, "text/html" },
        { { "css"  }, "text/css" },
        { { "js"   }, "text/javascript" },
        { { "json" }, "application/json" },
        { { "png"  }, "image/png" },
        { { "jpg"  }, "image/jpeg" },
        { { "svg"  }, "image/svg+xml" }
    };

    if (const auto it = mimeMap.find(extension.toLowerCase()); it != mimeMap.end())
        return it->second;

    return "text/plain";
}

juce::String YourPluginEditor::getExtension(juce::String filename)
{
    return filename.fromLastOccurrenceOf(".", false, false);
}
```

### Step 9: Build

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName YourPlugin
```

### Step 10: Test

1. Load plugin in DAW
2. Open plugin window → UI should display
3. Move sliders → parameters should update
4. Automate in DAW → UI should update
5. **Close window → should NOT crash**
6. Unload plugin → should NOT crash

---

## Validation Checklist

### Code Structure
- [ ] Member order: Relays → WebView → Attachments
- [ ] Destruction order comment added to header
- [ ] All relays are direct members (not `unique_ptr`)
- [ ] WebView and attachments are `unique_ptr`

### WebView Setup
- [ ] `.withBackend(webview2)` specified
- [ ] `.withWinWebView2Options(...withUserDataFolder(...))` provided
- [ ] `.withNativeIntegrationEnabled()` included
- [ ] All relays registered: `.withOptionsFrom(relay)` for each
- [ ] Resource provider implemented
- [ ] `webView->goToURL(...)` called

### CMakeLists.txt
- [ ] All web files in `juce_add_binary_data()`
- [ ] `NEEDS_WEBVIEW2 TRUE` set
- [ ] Binary data target linked
- [ ] `JUCE_WEB_BROWSER=1` defined
- [ ] `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1` defined

### Resource Provider
- [ ] Handles "/" → "index.html" mapping
- [ ] Iterates BinaryData when direct lookup fails
- [ ] Correct MIME types returned
- [ ] Returns `std::nullopt` for missing resources

### JavaScript
- [ ] Parameter IDs match C++ exactly
- [ ] `sliderDragStarted()` / `sliderDragEnded()` called
- [ ] `valueChangedEvent.addListener()` used for automation

### Testing
- [ ] Plugin loads without errors
- [ ] UI displays correctly
- [ ] Parameters work (user interaction)
- [ ] Automation works (DAW → UI updates)
- [ ] **Window closes without crash**
- [ ] **Plugin unloads without crash**
- [ ] Multiple instances work

---

## Common Mistakes

### ❌ Wrong Member Order
```cpp
// WRONG - Crashes on unload!
std::unique_ptr<juce::WebBrowserComponent> webView;
juce::WebSliderRelay relay { "PARAM" };
```

### ❌ Missing .withOptionsFrom()
```cpp
// WRONG - Parameter binding won't work!
webView = std::make_unique<juce::WebBrowserComponent>(
    Options().withBackend(webview2)
    // Missing: .withOptionsFrom(gainRelay)
);
```

### ❌ Wrong MIME Type
```cpp
// WRONG - JS files won't execute!
return Resource{ data, "text/html" }; // For a .js file!
```

### ❌ Creating Attachments Before WebView
```cpp
// WRONG - Order matters!
gainAttachment = std::make_unique<...>(...);  // Too early
webView = std::make_unique<...>(...);         // Too late
```

### ❌ Not Embedding All Files
```cmake
# WRONG - Missing JS files!
juce_add_binary_data(Plugin_WebUI
    SOURCES
        Source/ui/public/index.html
        # Missing: js files!
)
```

---

## Advanced Topics

### Custom JavaScript Functions

Expose C++ functions to JavaScript:

```cpp
// In PluginEditor constructor
webView = std::make_unique<juce::WebBrowserComponent>(
    Options()
        .withNativeFunction("getPluginInfo", [this](const auto& args, auto* completion) {
            auto info = juce::DynamicObject::make();
            info->setProperty("name", "MyPlugin");
            info->setProperty("version", "1.0.0");
            completion->operator()(juce::var(info));
        })
);
```

```javascript
// In JavaScript
const info = await window.__JUCE__.nativeFunctions.getPluginInfo();
console.log(info.name); // "MyPlugin"
```

### Canvas-Based Rendering

For complex visualizations, use HTML5 Canvas:

```html
<canvas id="visualizer" width="600" height="200"></canvas>
```

```javascript
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// Animation loop
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw waveform, spectrum, etc.
    requestAnimationFrame(draw);
}
draw();
```

---

## Troubleshooting

### Blank Screen

**Check:**
1. Resource provider returns correct data
2. MIME types are correct
3. Web files are embedded in CMakeLists.txt
4. Open DevTools: Right-click in WebView → Inspect

### Parameters Not Working

**Check:**
1. Parameter IDs match exactly (case-sensitive)
2. `.withOptionsFrom()` called for each relay
3. Attachments created after `addAndMakeVisible()`
4. JavaScript imports JUCE library correctly

### DAW Crashes

**Check:**
1. Member declaration order (Relays → WebView → Attachments)
2. Run validation script:
   ```powershell
   .\scripts\validate-webview-member-order.ps1 -PluginName YourPlugin
   ```

### Build Errors

**Check:**
1. `NEEDS_WEBVIEW2 TRUE` in CMakeLists.txt
2. `juce::juce_gui_extra` linked
3. WebView2 Runtime installed

---

## Related Documentation

- [WebView Templates](.kilocode/templates/webview/) - Starter templates
- [WebView Skill](.kilocode/skills/skill_design_webview/SKILL.md) - Detailed skill
- [Known Issues](.kilocode/troubleshooting/known-issues.yaml) - WebView issues
- [Member Order Crash](.kilocode/troubleshooting/resolutions/webview-member-order-crash.md) - Critical fix