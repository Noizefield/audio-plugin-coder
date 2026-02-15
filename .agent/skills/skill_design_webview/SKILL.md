---
name: juce-webview-windows
description: Quick-start guide for building JUCE 8 audio plugins with WebView2 UIs on Windows. Covers essential setup, critical member ordering, and step-by-step implementation workflow.
---

# JUCE 8 WebView Plugin - Quick Start Guide

**Platform:** Windows 11 | JUCE 8 | WebView2 | CMake

---

## 🎯 Quick Overview

Build audio plugin UIs using modern web technologies (HTML/CSS/JavaScript) instead of C++ JUCE components.

**Benefits:**
- Fast iteration with hot reloading
- Use familiar web frameworks (React, Vue, or vanilla JS)
- Modern UI capabilities (CSS animations, flexbox, gradients)
- Team-friendly (frontend devs can work without C++ knowledge)
- GPU acceleration via WebGL

**Trade-offs:**
- ~100MB additional memory footprint
- Windows 11 WebView2 dependency
- Different performance characteristics than native C++

---

## 🔴 CRITICAL: Member Declaration Order (PREVENTS DAW CRASHES)

**⚠️ #1 CAUSE OF WEBVIEW PLUGIN CRASHES - MUST FOLLOW**

### The Rule

C++ destroys members in **REVERSE order of declaration**. WebView references relays, so relays must be declared FIRST to be destroyed LAST.

### Correct Pattern (PluginEditor.h)

```cpp
private:
    YourAudioProcessor& audioProcessor;

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
```

**Wrong Order → DAW Crash on Unload**

See: [`..agent/troubleshooting/resolutions/webview-member-order-crash.md`](../../troubleshooting/resolutions/webview-member-order-crash.md)

---

## 📋 Step-by-Step Implementation

### Step 1: Create Web UI Files

```
plugins/YourPlugin/
└── Source/
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
  <title>My Plugin</title>
  <script type="module" src="js/index.js"></script>
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #1a1a2e;
      color: #e0e0e0;
      font-family: system-ui, sans-serif;
    }
    input[type="range"] { width: 100%; }
  </style>
</head>
<body>
  <h1>My Plugin</h1>
  <div>
    <label for="gainSlider">Gain</label>
    <input type="range" id="gainSlider" min="0" max="1" step="0.01" value="0.5">
    <span id="gainValue">0.5</span>
  </div>
</body>
</html>
```

### Step 3: Write index.js

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
        gainState.setNormalisedValue(gainSlider.value);
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

### Step 4: Configure CMakeLists.txt

```cmake
# Embed web files into binary
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html
        Source/ui/public/js/index.js
        Source/ui/public/js/juce/index.js
        Source/ui/public/js/juce/check_native_interop.js
)

# Plugin definition
juce_add_plugin(YourPlugin
    FORMATS VST3 Standalone
    PRODUCT_NAME "Your Plugin"
    NEEDS_WEBVIEW2 TRUE
)

# Link binary data
target_link_libraries(YourPlugin
    PRIVATE
        YourPlugin_WebUI
        juce::juce_gui_extra
        # ... other modules
)

# WebView2 definitions
target_compile_definitions(YourPlugin
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)
```

### Step 5: Create ParameterIDs.hpp

```cpp
#pragma once

namespace ParameterIDs {
    constexpr char GAIN[] = "GAIN";
    constexpr char FREQUENCY[] = "FREQUENCY";
}
```

### Step 6: Write PluginEditor.h

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

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (YourPluginEditor)
};
```

### Step 7: Write PluginEditor.cpp

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

### Step 8: Build

```powershell
.\scripts\build-and-install.ps1 -PluginName YourPlugin
```

### Step 9: Test

1. Load plugin in DAW
2. Open plugin window → UI should display
3. Move sliders → parameters should update
4. Automate in DAW → UI should update
5. **Close window → should NOT crash**
6. Unload plugin → should NOT crash

---

## ✅ Validation Checklist

Before considering your WebView plugin complete:

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

## ⚠️ Common Mistakes

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

## 📚 Additional Resources

For detailed technical information, see the reference documents:

- **[Technical Details](reference/webview-technical-details.md)** - WebView2 internals, JUCE 8 changes, architecture
- **[Communication Guide](reference/webview-communication-guide.md)** - Frontend-backend events, native functions
- **[Resource Providers](reference/webview-resource-providers.md)** - Detailed resource serving patterns
- **[Parameter Synchronization](reference/webview-parameter-sync.md)** - Advanced parameter binding patterns
- **[Troubleshooting](reference/webview-troubleshooting.md)** - Debugging, performance, common issues

---

## 🔗 Related Documentation

- **Troubleshooting:** `..agent/troubleshooting/resolutions/webview-member-order-crash.md`
- **Templates:** `templates/webview/`
- **Working Examples:** `plugins/AngelGrain/`, `plugins/TestWebView/`
- **Known Issues:** `..agent/troubleshooting/known-issues.yaml` (webview-001, webview-002)

---

**Document Version:** 2.0 (Streamlined)
**Last Updated:** 2026-01-24
**Status:** Production Ready

