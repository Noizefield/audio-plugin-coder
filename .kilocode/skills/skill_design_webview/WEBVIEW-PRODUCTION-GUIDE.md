# JUCE 8 WebView Plugin - Production Guide
**Complete guide based on CloudWash development (2026-01-26)**

**Platform:** Windows 11 | JUCE 8 | WebView2 | CMake

---

## 🚨 CRITICAL: ES6 Modules DO NOT WORK in WebView

**⚠️ #1 ISSUE WITH WEBVIEW PLUGINS**

### The Problem
```html
<!-- ❌ THIS WILL FAIL SILENTLY -->
<script type="module" src="js/index.js"></script>
```

**Symptoms:**
- Plugin loads but shows blank/incomplete UI
- Knobs don't render (only dots visible)
- No animations
- JavaScript fails with CORS errors in browser tests
- No console errors in DAW (fails silently)

### The Solution
**ALL JavaScript must be inline in index.html**

```html
<!-- ✅ CORRECT -->
<script>
    // All code directly in HTML
    // No imports, no modules
    // JUCE library inlined
    // UI code inlined
</script>
```

---

## 📁 File Structure

```
plugins/YourPlugin/Source/ui/public/
├── index.html              ← PRODUCTION (all JS inline, 900+ lines)
├── test-local.html         ← BROWSER TEST (same as index.html)
└── js/
    ├── index.js           ← NOT USED (reference only)
    └── juce/
        └── index.js       ← NOT USED (copy into index.html)
```

**Key Points:**
- `index.html` = Production file embedded in plugin
- `test-local.html` = Test in browser before building
- `js/*.js` = Reference only, not loaded by plugin

---

## 🏗️ Complete Production HTML Structure

### 1. HTML Template
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Plugin</title>
    <style>
        /* All CSS inline here */
        /* 400-500 lines typical */
    </style>
</head>
<body>
    <!-- All HTML structure -->
    <!-- Knobs, meters, buttons, etc. -->

    <script>
        /* ========================================
           PART 1: JUCE LIBRARY (Inline, ~500 lines)
           ======================================== */

        // Check JUCE availability
        const juceAvailable = typeof window.__JUCE__ !== 'undefined';

        // JUCE Library classes (copy from js/juce/index.js)
        class ListenerList { /* ... */ }
        class SliderState { /* ... */ }
        class ToggleState { /* ... */ }
        class ComboBoxState { /* ... */ }

        // Create global Juce object
        window.Juce = {
            getSliderState: function(name) { /* ... */ },
            getToggleState: function(name) { /* ... */ },
            getComboBoxState: function(name) { /* ... */ }
        };

        /* ========================================
           PART 2: UI INITIALIZATION (~400 lines)
           ======================================== */

        document.addEventListener("DOMContentLoaded", () => {
            console.log("=== Plugin Initialization ===");

            // ALWAYS initialize visuals first
            initializeKnobs();
            initializeModeTabs();
            initializeButtons();
            initializeMeters();

            // THEN connect JUCE parameters (if available)
            if (juceAvailable) {
                initializeParameterStates();
            }
        });

        function initializeKnobs() { /* ... */ }
        function initializeModeTabs() { /* ... */ }
        // ... etc
    </script>
</body>
</html>
```

---

## 🎨 Knob Rendering Pattern

### SVG-Based Circular Knobs
```javascript
function initializeKnobs() {
    const knobs = document.querySelectorAll('.knob');
    const ARC_START = 120;   // Start angle (degrees)
    const ARC_RANGE = 300;   // Total sweep (degrees)
    const KNOB_RADIUS = 31;  // Pixels

    knobs.forEach(knob => {
        const paramName = knob.dataset.param;
        const min = parseFloat(knob.dataset.min);
        const max = parseFloat(knob.dataset.max);
        const defaultValue = parseFloat(knob.dataset.default);

        let value = defaultValue;
        let isDragging = false;

        const track = knob.querySelector('.knob-track');
        const arc = knob.querySelector('.knob-arc');
        const indicator = knob.querySelector('.knob-indicator');
        const valueDisplay = knob.parentElement.querySelector('.knob-value');

        function updateKnob(newValue, fromJuce = false) {
            value = Math.max(min, Math.min(max, newValue));
            const normalized = (value - min) / (max - min);

            // Draw background track (full circle)
            const trackPath = describeArc(35, 35, KNOB_RADIUS, ARC_START, ARC_START + ARC_RANGE);
            track.setAttribute('d', trackPath);

            // Draw value arc (partial circle)
            const endAngle = ARC_START + (ARC_RANGE * normalized);
            const arcPath = describeArc(35, 35, KNOB_RADIUS, ARC_START, endAngle);
            arc.setAttribute('d', arcPath);

            // Position indicator dot
            const angle = (ARC_START + (ARC_RANGE * normalized)) * Math.PI / 180;
            const indicatorX = 35 + KNOB_RADIUS * Math.cos(angle) - 3.5;
            const indicatorY = 35 + KNOB_RADIUS * Math.sin(angle) - 3.5;
            indicator.style.left = `${indicatorX}px`;
            indicator.style.top = `${indicatorY}px`;

            // Update value display
            valueDisplay.textContent = `${Math.round(normalized * 100)}%`;

            // Update JUCE parameter (only from user interaction)
            if (!fromJuce && parameterStates[paramName]) {
                try {
                    parameterStates[paramName].setNormalisedValue(normalized);
                } catch (error) {
                    console.warn(`JUCE update failed for ${paramName}:`, error.message);
                }
            }
        }

        function describeArc(x, y, radius, startAngle, endAngle) {
            const start = polarToCartesian(x, y, radius, endAngle);
            const end = polarToCartesian(x, y, radius, startAngle);
            const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
            return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
        }

        function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
            const angleInRadians = angleInDegrees * Math.PI / 180.0;
            return {
                x: centerX + (radius * Math.cos(angleInRadians)),
                y: centerY + (radius * Math.sin(angleInRadians))
            };
        }

        // Mouse drag handling
        knob.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isDragging = true;
            startY = e.clientY;
            startValue = value;

            // Notify JUCE of gesture start
            if (parameterStates[paramName]) {
                try {
                    parameterStates[paramName].sliderDragStarted();
                } catch (error) {}
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaY = startY - e.clientY;
                const sensitivity = 0.005;  // Adjust for feel
                const newValue = startValue + deltaY * (max - min) * sensitivity;
                updateKnob(newValue, false);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;

                // Notify JUCE of gesture end
                if (parameterStates[paramName]) {
                    try {
                        parameterStates[paramName].sliderDragEnded();
                    } catch (error) {}
                }
            }
        });

        // Double-click to reset
        knob.addEventListener('dblclick', () => {
            updateKnob(defaultValue, false);
        });

        // Initialize visual
        updateKnob(defaultValue, false);

        // Listen for automation from JUCE
        if (parameterStates[paramName]) {
            try {
                parameterStates[paramName].valueChangedEvent.addListener(() => {
                    const normalizedValue = parameterStates[paramName].getNormalisedValue();
                    const actualValue = min + (normalizedValue * (max - min));
                    updateKnob(actualValue, true);  // fromJuce = true
                });
            } catch (error) {
                console.warn(`Failed to add listener for ${paramName}:`, error.message);
            }
        }
    });
}
```

### HTML Structure for Knobs
```html
<div class="knob-container">
    <div class="knob-label">POSITION</div>
    <div class="knob" data-param="position" data-min="0" data-max="1" data-default="0.5">
        <svg width="70" height="70" viewBox="0 0 70 70">
            <path class="knob-track" />
            <path class="knob-arc" />
        </svg>
        <div class="knob-indicator"></div>
    </div>
    <div class="knob-value">50%</div>
</div>
```

### CSS for Knobs
```css
.knob {
    width: 70px;
    height: 70px;
    cursor: ns-resize;
    position: relative;
}

.knob-track {
    fill: none;
    stroke: #2A2A3E;  /* Background */
    stroke-width: 6;
    stroke-linecap: round;
}

.knob-arc {
    fill: none;
    stroke: #427E88;  /* Value color */
    stroke-width: 6;
    stroke-linecap: round;
    transition: none;  /* IMPORTANT: No transition for smooth dragging */
}

.knob-indicator {
    width: 7px;
    height: 7px;
    background: #FFFFFF;
    border-radius: 50%;
    position: absolute;
    pointer-events: none;
}
```

**CRITICAL:**
- ✅ NO CSS transitions on `.knob-arc` (causes jumpiness)
- ✅ Use `e.preventDefault()` on mousedown (prevents text selection)
- ✅ `fromJuce` flag prevents feedback loops
- ✅ Try/catch around all JUCE calls (graceful degradation)

---

## 📊 Audio Meters (Real-Time)

### The Problem
CloudWash meters show random animation because they're not connected to real audio.

### The Solution
Use JUCE's native function system to send audio levels from C++.

#### C++ Side (PluginEditor.cpp)
```cpp
class YourPluginEditor : public juce::AudioProcessorEditor,
                         public juce::Timer
{
public:
    YourPluginEditor(YourAudioProcessor& p)
        : AudioProcessorEditor(&p), audioProcessor(p)
    {
        // ... WebView setup ...

        // Start timer for meter updates (30 FPS)
        startTimerHz(30);
    }

    void timerCallback() override
    {
        // Get current audio levels from processor
        float inputLevel = audioProcessor.getInputLevel();
        float outputLevel = audioProcessor.getOutputLevel();

        // Send to WebView via custom event
        if (webView)
        {
            juce::String script = juce::String::formatted(
                "if (window.updateMeters) window.updateMeters(%f, %f);",
                inputLevel, outputLevel
            );
            webView->emitEventIfBrowserIsVisible("evaluateJavascript", script);
        }
    }

private:
    YourAudioProcessor& audioProcessor;
    std::unique_ptr<juce::WebBrowserComponent> webView;
};
```

#### C++ Side (PluginProcessor.h/cpp)
```cpp
class YourAudioProcessor
{
public:
    float getInputLevel() const { return inputPeak.load(); }
    float getOutputLevel() const { return outputPeak.load(); }

    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        // Calculate peak levels
        float inPeak = buffer.getMagnitude(0, buffer.getNumSamples());
        float outPeak = inPeak;  // Or post-processing peak

        // Update atomics (thread-safe)
        inputPeak.store(inPeak);
        outputPeak.store(outPeak);

        // ... rest of processing ...
    }

private:
    std::atomic<float> inputPeak{0.0f};
    std::atomic<float> outputPeak{0.0f};
};
```

#### JavaScript Side (index.html)
```javascript
// Global function called from C++
window.updateMeters = function(inputLevel, outputLevel) {
    updateMeter(document.getElementById('inputMeter'), inputLevel);
    updateMeter(document.getElementById('outputMeter'), outputLevel);
};

function updateMeter(meter, level) {
    const segments = meter.querySelectorAll('.meter-segment');
    const activeSegments = Math.floor(level * 24);

    segments.forEach((segment, index) => {
        segment.classList.remove('active', 'green', 'yellow', 'red');
        if (index < activeSegments) {
            segment.classList.add('active');
            if (index < 19) segment.classList.add('green');
            else if (index < 23) segment.classList.add('yellow');
            else segment.classList.add('red');
        }
    });
}
```

**IMPORTANT:**
- Use `std::atomic` for thread-safe level passing
- Use timer callback (not processBlock) for UI updates
- 30 FPS is sufficient for smooth meters
- Consider peak hold and decay in C++

---

## ⚙️ JUCE Library Inline Template

**File:** Copy from `js/juce/index.js` and modify:

```javascript
// ============================================
// JUCE LIBRARY (INLINE VERSION)
// ============================================

const juceAvailable = typeof window.__JUCE__ !== 'undefined';

// Helper: Listener List
class ListenerList {
    constructor() {
        this.listeners = new Map();
        this.listenerId = 0;
    }
    addListener(fn) {
        const newListenerId = this.listenerId++;
        this.listeners.set(newListenerId, fn);
        return newListenerId;
    }
    removeListener(id) {
        if (this.listeners.has(id)) this.listeners.delete(id);
    }
    callListeners(payload) {
        for (const [, value] of this.listeners) {
            value(payload);
        }
    }
}

// SliderState class
class SliderState {
    constructor(name) {
        if (!juceAvailable) {
            console.warn(`SliderState '${name}' created without JUCE backend`);
            return;
        }

        if (!window.__JUCE__.initialisationData.__juce__sliders.includes(name)) {
            console.warn(`Creating SliderState for '${name}', which is unknown to the backend`);
        }

        this.name = name;
        this.identifier = "__juce__slider" + this.name;
        this.scaledValue = 0;
        this.properties = {
            start: 0,
            end: 1,
            skew: 1,
            name: "",
            label: "",
            numSteps: 100,
            interval: 0,
            parameterIndex: -1,
        };
        this.valueChangedEvent = new ListenerList();
        this.propertiesChangedEvent = new ListenerList();

        window.__JUCE__.backend.addEventListener(this.identifier, (event) =>
            this.handleEvent(event)
        );

        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "requestInitialUpdate",
        });
    }

    setNormalisedValue(newValue) {
        if (!juceAvailable) return;

        this.scaledValue = this.snapToLegalValue(
            this.normalisedToScaledValue(newValue)
        );

        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "valueChanged",
            value: this.scaledValue,
        });
    }

    sliderDragStarted() {
        if (!juceAvailable) return;

        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "sliderDragStarted",
        });
    }

    sliderDragEnded() {
        if (!juceAvailable) return;

        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "sliderDragEnded",
        });
    }

    handleEvent(event) {
        if (event.eventType == "valueChanged") {
            this.scaledValue = event.value;
            this.valueChangedEvent.callListeners();
        }
        if (event.eventType == "propertiesChanged") {
            let { eventType: _, ...rest } = event;
            this.properties = rest;
            this.propertiesChangedEvent.callListeners();
        }
    }

    getScaledValue() {
        return this.scaledValue;
    }

    getNormalisedValue() {
        return Math.pow(
            (this.scaledValue - this.properties.start) /
                (this.properties.end - this.properties.start),
            this.properties.skew
        );
    }

    normalisedToScaledValue(normalisedValue) {
        return (
            Math.pow(normalisedValue, 1 / this.properties.skew) *
                (this.properties.end - this.properties.start) +
            this.properties.start
        );
    }

    snapToLegalValue(value) {
        const interval = this.properties.interval;
        if (interval == 0) return value;

        const start = this.properties.start;
        const clamp = (val, min = 0, max = 1) => Math.max(min, Math.min(max, val));

        return clamp(
            start + interval * Math.floor((value - start) / interval + 0.5),
            this.properties.start,
            this.properties.end
        );
    }
}

// ToggleState class
class ToggleState {
    constructor(name) {
        if (!juceAvailable) {
            console.warn(`ToggleState '${name}' created without JUCE backend`);
            return;
        }

        if (!window.__JUCE__.initialisationData.__juce__toggles.includes(name)) {
            console.warn(`Creating ToggleState for '${name}', which is unknown to the backend`);
        }

        this.name = name;
        this.identifier = "__juce__toggle" + this.name;
        this.value = false;
        this.properties = {
            name: "",
            parameterIndex: -1,
        };
        this.valueChangedEvent = new ListenerList();
        this.propertiesChangedEvent = new ListenerList();

        window.__JUCE__.backend.addEventListener(this.identifier, (event) =>
            this.handleEvent(event)
        );

        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "requestInitialUpdate",
        });
    }

    getValue() {
        return this.value;
    }

    setValue(newValue) {
        if (!juceAvailable) return;

        this.value = newValue;
        window.__JUCE__.backend.emitEvent(this.identifier, {
            eventType: "valueChanged",
            value: this.value,
        });
    }

    handleEvent(event) {
        if (event.eventType == "valueChanged") {
            this.value = event.value;
            this.valueChangedEvent.callListeners();
        }
        if (event.eventType == "propertiesChanged") {
            let { eventType: _, ...rest } = event;
            this.properties = rest;
            this.propertiesChangedEvent.callListeners();
        }
    }
}

// Create global Juce object
const sliderStates = new Map();
const toggleStates = new Map();

if (juceAvailable) {
    for (const sliderName of window.__JUCE__.initialisationData.__juce__sliders) {
        sliderStates.set(sliderName, new SliderState(sliderName));
    }

    for (const name of window.__JUCE__.initialisationData.__juce__toggles) {
        toggleStates.set(name, new ToggleState(name));
    }
}

window.Juce = {
    getSliderState: function(name) {
        if (!sliderStates.has(name)) {
            sliderStates.set(name, new SliderState(name));
        }
        return sliderStates.get(name);
    },

    getToggleState: function(name) {
        if (!toggleStates.has(name)) {
            toggleStates.set(name, new ToggleState(name));
        }
        return toggleStates.get(name);
    }
};
```

---

## 🧪 Testing Workflow

### 1. Browser Test (Before Building)
```html
<!-- test-local.html -->
<!DOCTYPE html>
<html>
<!-- Copy entire index.html -->
<!-- Add test banner at top -->
<body>
    <div style="background: #FFC107; padding: 8px; text-align: center;">
        ⚠️ BROWSER TEST - No JUCE Backend
    </div>
    <!-- Rest of UI -->
</body>
</html>
```

Open `test-local.html` in Chrome/Edge:
- ✅ All knobs render (arcs + dots)
- ✅ Knobs respond to drag
- ✅ Mode tabs switch
- ✅ Buttons toggle
- ✅ No console errors

### 2. Build Plugin
```powershell
.\scripts\build-and-install.ps1 -PluginName YourPlugin
```

### 3. Test in DAW
- ✅ Plugin loads
- ✅ UI displays correctly
- ✅ Parameters respond to knobs
- ✅ DAW can automate parameters
- ✅ Parameters save/restore
- ✅ No crashes on close

---

## ✅ Production Checklist

### HTML File
- [ ] All JavaScript inline (no `<script src="...">`)
- [ ] All CSS inline (no external stylesheets)
- [ ] JUCE library inlined (~500 lines)
- [ ] UI code inlined (~400 lines)
- [ ] `juceAvailable` check before JUCE calls
- [ ] Try/catch around all JUCE API calls
- [ ] Console logging for debugging

### Knob Implementation
- [ ] SVG paths calculated correctly
- [ ] NO CSS transitions on arcs (prevents glitches)
- [ ] `fromJuce` flag prevents feedback loops
- [ ] `sliderDragStarted/Ended()` called
- [ ] `setNormalisedValue()` used (not `setValue()`)
- [ ] Double-click to reset
- [ ] Value display updates

### Parameter Binding
- [ ] All parameter IDs match C++ exactly
- [ ] SliderState for numeric params
- [ ] ToggleState for boolean params
- [ ] Mode/dropdown params use SliderState with normalization
- [ ] Bi-directional sync (UI ↔ JUCE)

### C++ Side
- [ ] Member order: Relays → WebView → Attachments
- [ ] All relays registered with `.withOptionsFrom()`
- [ ] Resource provider returns inline HTML
- [ ] BinaryData includes index.html only (no JS files)

### CMakeLists.txt
```cmake
juce_add_binary_data(YourPlugin_WebUI
    SOURCES
        Source/ui/public/index.html  # Only HTML!
)
```

### Testing
- [ ] Browser test passes (test-local.html)
- [ ] Plugin loads in DAW
- [ ] All controls visible and functional
- [ ] Parameters respond to automation
- [ ] No crashes on close/unload

---

## 🐛 Common Issues & Solutions

### Issue: Knobs glitchy/jumpy when dragging
**Cause:** CSS transitions on SVG paths
**Solution:** Remove all transitions from `.knob-arc`
```css
.knob-arc {
    transition: none;  /* CRITICAL */
}
```

### Issue: Meters show random values
**Cause:** Not connected to real audio
**Solution:** Implement C++ timer callback + atomic levels (see Meters section)

### Issue: Some parameters have no effect
**Cause:** DSP not implemented for that parameter
**Solution:** Check PluginProcessor.cpp, implement DSP

### Issue: UI doesn't load at all
**Cause:** ES6 modules or missing inline JS
**Solution:** Ensure ALL JavaScript is inline in index.html

### Issue: Parameters don't save/restore
**Cause:** Parameter IDs mismatch between JS and C++
**Solution:** Verify IDs match exactly (case-sensitive)

---

## 📚 Reference

### Working Example
**CloudWash Plugin:**
- File: `plugins/CloudWash/Source/ui/public/index.html`
- 978 lines, 34KB
- 10 knobs, 4 modes, freeze button, 2 dropdowns
- Full JUCE integration
- Production-ready

### Key Files
```
plugins/YourPlugin/
├── Source/
│   ├── PluginProcessor.h/cpp
│   ├── PluginEditor.h/cpp
│   └── ui/public/
│       ├── index.html          ← PRODUCTION (all inline)
│       └── test-local.html     ← BROWSER TEST
└── CMakeLists.txt
```

---

**Document Version:** 3.0 (Complete Production Guide)
**Last Updated:** 2026-01-26
**Based On:** CloudWash Plugin Development
**Status:** Production Ready
