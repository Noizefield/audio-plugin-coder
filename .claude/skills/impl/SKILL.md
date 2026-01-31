# SKILL: DSP IMPLEMENTATION
**Goal:** Implement audio processing where parameters control DSP
**Focus:** PluginProcessor.h, PluginProcessor.cpp
**Output Location:** `plugins/[Name]/Source/`

---

## 📊 PHASE 4: CODE (DSP Implementation)

**Trigger:** `/impl [Name]` (after DESIGN phase complete)
**Input:** Reads `plugins/[Name]/status.json` and `.ideas/parameter-spec.md`
**Prerequisites:** Architecture plan complete, UI framework selected

**State Validation:**
```powershell
# Import state management module
. "$PSScriptRoot\..\scripts\state-management.ps1"

# Validate prerequisites
if (-not (Test-PluginState -PluginPath "plugins\[Name]" -RequiredPhase "design_complete" -RequiredFiles @(".ideas/architecture.md", ".ideas/plan.md"))) {
    Write-Error "Prerequisites not met. Complete design phase first."
    exit 1
}

# Check framework selection
$state = Get-PluginState -PluginPath "plugins\[Name]"
if ($state.ui_framework -eq "pending") {
    Write-Error "UI framework not selected. Cannot proceed with implementation."
    exit 1
}
Write-Host "Framework: $($state.ui_framework)" -ForegroundColor Cyan
```

---

## 🎨 PHASE 4.0: DESIGN-TO-FRAMEWORK CONVERSION (CRITICAL - BEFORE DSP CODE)

**IMPORTANT:** This phase converts the approved design specifications into framework-specific code. User must approve the conversion before DSP implementation begins.

### 4.0.1 Read Approved Design
- Read `Design/v[N]-ui-spec.md` (latest approved version)
- Read `Design/v[N]-style-guide.md` (latest approved version)
- Read `.ideas/parameter-spec.md` for parameter definitions

### 4.0.2 Framework-Specific Conversion

**For WebView Framework:**
Convert the approved design specs into production JUCE WebView code.

**Create the required directory structure:**
```
plugins/[Name]/Source/ui/
└───public/
    │   index.html          # Production UI based on approved design
    │
    └───js/
        │   index.js        # JUCE integration and parameter binding
        │
        └───juce/
                check_native_interop.js  # Development utility
                index.js                # JUCE frontend library
```

**Implementation Steps:**
1. **Create directories:** `plugins/[Name]/Source/ui/public/` and subdirectories
2. **Copy JUCE frontend library:** Copy `modules/juce_gui_extra/native/javascript/index.js` to `js/juce/index.js`
3. **Create interop checker:** Generate `js/juce/check_native_interop.js` for development
4. **Convert design to HTML:** Transform approved design specs into `index.html` with embedded CSS
5. **Generate JavaScript:** Create `js/index.js` with parameter state setup and UI controls

**Conversion Process:**
- Extract layout, colors, and styling from `v[N]-style-guide.md`
- Extract control specifications from `v[N]-ui-spec.md`
- Generate HTML structure matching the approved design
- Implement interactive controls using JUCE parameter states
- Apply approved color palette and visual style

**Example Output (based on approved design):**

**ui/public/index.html:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Name] Plugin</title>
  <script type="module" src="js/index.js"></script>
  <style>
    /* Styles based on approved v[N]-style-guide.md */
    body {
        background: [approved-background-color];
        color: [approved-text-color];
        font-family: [approved-font-family];
        margin: 0;
        padding: 20px;
    }
    /* Additional styles from approved design */
  </style>
</head>
<body>
  <!-- Layout based on approved v[N]-ui-spec.md -->
  <div id="plugin-ui">
    <!-- Controls generated from parameter-spec.md -->
  </div>
</body>
</html>
```

**ui/public/js/index.js:**
```javascript
import * as Juce from "./juce/index.js";

// Initialize parameter states from parameter-spec.md
const parameterStates = {};

document.addEventListener("DOMContentLoaded", () => {
    // Create UI controls based on approved design
    initializeUI();
    console.log("WebView UI initialized from approved design");
});

function initializeUI() {
    // Generate controls based on v[N]-ui-spec.md specifications
    // Bind to JUCE parameter states
}
```

**USER APPROVAL REQUIRED - CRITICAL STOP POINT:**
```
✅ Design converted to WebView code

Files created:
- plugins/[Name]/Source/ui/public/index.html
- plugins/[Name]/Source/ui/public/js/index.js
- plugins/[Name]/Source/ui/public/js/juce/index.js

⚠️ **MANDATORY STOP** - You MUST test the WebView setup before proceeding to DSP implementation!

What would you like to do?
1. Test WebView - Open plugins/[Name]/Source/ui/public/index.html in browser and verify appearance
2. Approve - Proceed with DSP implementation (confirms WebView GUI is acceptable)
3. Revise - Make changes to the conversion

**YOU MUST CHOOSE OPTION 1 OR 2 BEFORE CONTINUING**
**DO NOT PROCEED TO PHASE 4.1 WITHOUT USER APPROVAL**

Choose (1-3): _
```

**Approval Validation:**
- If user chooses 1: Wait for user to test and return to this menu
- If user chooses 2: Mark WebView GUI as approved and proceed to Phase 4.1
- If user chooses 3: Allow revisions to the design conversion

**For Visage Framework:**
Convert approved design to Visage C++ code (Source/VisageControls.h).

---

## ✅ WEBVIEW IMPLEMENTATION CHECKLIST (MANDATORY)

**CRITICAL:** When implementing WebView plugins, you MUST verify ALL 8 points below. Use templates from `.claude/templates/webview/` and run validation script.

### WebView Setup Validation (Run Before DSP Implementation)

**Before proceeding to Phase 4.1, validate WebView setup:**

```powershell
# Run validation script
.\scripts\validate-webview-setup.ps1 -PluginName [Name]
```

### Mandatory Checklist (All Must Pass):

1. ✅ **CMakeLists.txt embeds web files**
   - Contains `juce_add_binary_data([Name]_WebUI ...)`
   - Links binary data target: `target_link_libraries([Name] PRIVATE [Name]_WebUI ...)`
   - Has `NEEDS_WEBVIEW2 TRUE` in `juce_add_plugin()`
   - Has compile definitions: `JUCE_WEB_BROWSER=1` and `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1`

2. ✅ **WebBrowserComponent uses WebView2 backend**
   - `.withBackend(WebBrowserComponent::Options::Backend::webview2)` is present
   - NOT using default backend (must be explicit)

3. ✅ **WebBrowserComponent has user data folder**
   - `.withUserDataFolder(File::getSpecialLocation(File::SpecialLocationType::tempDirectory))` is present
   - Required for Windows plugins to work

4. ✅ **Native integration enabled**
   - `.withNativeIntegrationEnabled()` is present
   - Enables JavaScript ↔ C++ communication

5. ✅ **Resource provider implemented**
   - `.withResourceProvider([this](const auto& url) { return getResource(url); })` is present
   - `getResource()` function exists and loads from embedded zip
   - `getZipFile()` helper function exists

6. ✅ **Parameter relays created BEFORE WebBrowserComponent**
   - Relays created before `std::make_unique<WebBrowserComponent>()`
   - Relays passed via `.withOptionsFrom(*relay)` for each parameter

7. ✅ **Parameter attachments created AFTER WebBrowserComponent**
   - Attachments created after `addAndMakeVisible(*webView)`
   - Attachments connect parameters to relays

8. ✅ **Web content loaded via resource provider**
   - Uses `webView->goToURL(WebBrowserComponent::getResourceProviderRoot())`
   - NOT using `data:text/html;base64,...` or `loadHTML()`
   - NOT using hardcoded HTML strings

### 🔴 CRITICAL: Member Declaration Order (PluginEditor.h)

**⚠️ #1 CAUSE OF DAW CRASHES - VERIFY THIS FIRST**

C++ destroys members in REVERSE order of declaration. If WebView is declared before relays, it will be destroyed AFTER relays, causing a crash when it tries to access freed relay memory.

**✅ CORRECT ORDER (in PluginEditor.h):**
```cpp
private:
    // 1. RELAYS FIRST (destroyed last)
    juce::WebSliderRelay gainRelay { "GAIN" };

    // 2. WEBVIEW SECOND (destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
```

**❌ WRONG ORDER (causes DAW crash on unload):**
```cpp
private:
    std::unique_ptr<juce::WebBrowserComponent> webView;  // ❌ Too early!
    juce::WebSliderRelay gainRelay { "GAIN" };           // ❌ Too late!
```

**Verification:** Run validation script before building:
```powershell
.\scripts\validate-webview-member-order.ps1 -PluginName [Name]
```

See: `.claude/troubleshooting/resolutions/webview-member-order-crash.md`

---

### Common Mistakes to Avoid:

❌ **DON'T:** Declare webView before relays in header file
✅ **DO:** Always use order: Relays → WebView → Attachments

❌ **DON'T:** Use data URIs (`data:text/html;base64,...`)
✅ **DO:** Use `getResourceProviderRoot()` with embedded files

❌ **DON'T:** Create WebBrowserComponent without WebView2 backend
✅ **DO:** Explicitly specify `.withBackend(webview2)`

❌ **DON'T:** Create parameter attachments before WebBrowserComponent
✅ **DO:** Create relays → WebBrowserComponent → attachments (in that order)

❌ **DON'T:** Skip resource provider
✅ **DO:** Implement `getResource()` function to serve embedded files

❌ **DON'T:** Forget to embed web files in CMakeLists.txt
✅ **DO:** Use `juce_add_binary_data()` to embed all web UI files

### Template Usage:

**Copy templates from:** `.claude/templates/webview/`
- `PluginEditor.h.template` → `Source/PluginEditor.h`
- `PluginEditor.cpp.template` → `Source/PluginEditor.cpp`
- `CMakeLists.txt.template` → `CMakeLists.txt`

**Replace placeholders:**
- `{{PLUGIN_NAME}}` → Your plugin class name
- `{{PLUGIN_NAME_LOWER}}` → Lowercase plugin name
- `{{PARAMETER_RELAYS}}` → Your parameter relay declarations
- `{{CREATE_PARAMETER_RELAYS}}` → Code to create relays
- `{{WITH_OPTIONS_FROM_RELAYS}}` → `.withOptionsFrom()` calls
- `{{CREATE_PARAMETER_ATTACHMENTS}}` → Code to create attachments

### If Validation Fails:

1. Review error messages from validation script
2. Check templates in `.claude/templates/webview/`
3. Compare your code with JUCE example: `_tools/JUCE/examples/Plugins/WebViewPluginDemo.h`
4. Ensure web files exist: `Source/ui/public/index.html`, `js/index.js`, `js/juce/index.js`
5. Verify CMakeLists.txt embeds files correctly

**DO NOT PROCEED TO DSP IMPLEMENTATION UNTIL ALL 8 CHECKS PASS**

---

## 🔧 PHASE 4.1: DSP IMPLEMENTATION

Read `plugins/[Name]/.ideas/plan.md` to determine implementation approach:
```
Complexity Score: [N]

If score ≤2: Single-pass implementation (all at once)
If score ≥3: Phased implementation (multiple passes)
```

**Single-pass** (Simple plugins):
- One implementation session
- All DSP components at once
- Example: Simple gain, filter, compressor

**Phased** (Complex plugins):
- Multiple implementation phases
- Break into logical chunks
- Example: Multi-band processing, synthesis engines

---

## 🔧 PHASE 4.1: DSP IMPLEMENTATION

**Prerequisites:** UI structure must be created (Phase 4.0) before DSP implementation begins.

### FOR SINGLE-PASS (Complexity ≤2):

**Step 1: Read contracts**
- `.ideas/creative-brief.md` - Plugin purpose and behavior
- `.ideas/architecture.md` - DSP components and math
- `.ideas/parameter-spec.md` - Parameter bindings

**Step 2: Update PluginProcessor.h**

Add DSP member variables:
```cpp
private:
    // DSP Components from .ideas/architecture.md
    juce::dsp::Gain inputGain;
    juce::dsp::IIR::Filter filter;
    juce::dsp::Compressor compressor;
    
    // State
    double currentSampleRate = 44100.0;
```

**Step 3: Implement prepareToPlay()**

Initialize DSP at sample rate:
```cpp
void prepareToPlay(double sampleRate, int samplesPerBlock) override
{
    currentSampleRate = sampleRate;
    
    juce::dsp::ProcessSpec spec;
    spec.sampleRate = sampleRate;
    spec.maximumBlockSize = samplesPerBlock;
    spec.numChannels = getTotalNumOutputChannels();
    
    inputGain.prepare(spec);
    filter.prepare(spec);
    compressor.prepare(spec);
}
```

**Step 4: Implement processBlock()**

Add DSP processing:
```cpp
void processBlock(juce::AudioBuffer& buffer,
                  juce::MidiBuffer& midiMessages) override
{
    juce::ScopedNoDenormals noDenormals;
    
    // Get parameter values from APVTS
    auto gainValue = apvts.getRawParameterValue("gain")->load();
    auto thresholdValue = apvts.getRawParameterValue("threshold")->load();
    
    // Update DSP components
    inputGain.setGainDecibels(gainValue);
    compressor.setThreshold(thresholdValue);
    
    // Process audio
    juce::dsp::AudioBlock block(buffer);
    juce::dsp::ProcessContextReplacing context(block);
    
    inputGain.process(context);
    filter.process(context);
    compressor.process(context);
}
```

**Step 5: Connect parameters to DSP**

Ensure all parameters from `.ideas/parameter-spec.md` are:
- Read from APVTS in processBlock using the unified parameter handling system
- Applied to DSP components with proper validation and smoothing
- Mapped correctly (linear, logarithmic, exponential as specified)
- Consistent with parameter ranges defined in the specification

**Consistency Verification:**
```cpp
// Verify parameter consistency during development
#ifdef DEBUG
void verifyParameterConsistency()
{
    // Check that parameter IDs match between spec and implementation
    // This helps catch typos and ensures all specified parameters are implemented
    const auto& parameters = apvts.processor.getParameters();
    for (int i = 0; i < parameters.size(); ++i)
    {
        auto* param = dynamic_cast<juce::AudioProcessorParameterWithID*>(parameters[i]);
        if (param != nullptr)
        {
            // Verify this parameter exists in parameter-spec.md
            // (Implementation would read and parse the spec file)
        }
    }
}
#endif
```

---

### FOR PHASED (Complexity ≥3):

**plan.md will define phases like:**
```markdown
### Phase 4.1.1: Core Processing
- Input/output gain
- Basic filtering

### Phase 4.1.2: Dynamics
- Compressor
- Limiter

### Phase 4.1.3: Modulation
- LFO
- Envelope follower
```

**Execute each phase sequentially:**

1. **Phase 4.1.1** - Implement core components
   - Add member variables
   - Update prepareToPlay()
   - Add to processBlock()
   - **Build and test**
   - **Git commit**

2. **Phase 4.1.2** - Add dynamics components
   - Build on Phase 4.1.1 code (preserve everything)
   - Add new components
   - **Build and test**
   - **Git commit**

3. **Phase 4.1.3** - Add modulation
   - Build on Phase 4.1.2 code
   - Complete implementation
   - **Build and test**
   - **Git commit**

**Decision menu after each phase:**
```
✓ Phase 4.1.1 complete

Progress: 1 of 3 phases

What's next?
1. Continue to Phase 4.1.2 (recommended)
2. Test current state in DAW
3. Review Phase 4.1.1 code
4. Pause here

Choose (1-4): _
```

---

## 🎯 CRITICAL IMPLEMENTATION RULES

### Real-Time Safety:
- **NO heap allocations in processBlock()** - Pre-allocate in prepareToPlay()
- **NO locks in audio thread** - Use atomic values for parameter access
- **NO file I/O in processBlock()** - All resources loaded beforehand
- Use `juce::ScopedNoDenormals` at start of processBlock()

### 🔄 UNIFIED PARAMETER HANDLING SYSTEM

#### Parameter Validation & Range Checking
```cpp
// Helper function for parameter validation
float validateParameter(float value, float minVal, float maxVal, const char* paramName)
{
    if (value < minVal || value > maxVal)
    {
        // Log warning but clamp to valid range
        jassertfalse; // Debug warning
        return juce::jlimit(minVal, maxVal, value);
    }
    return value;
}

// In processBlock() - with validation
auto* gainParam = apvts.getRawParameterValue("gain");
float rawGainValue = gainParam->load();
float validatedGain = validateParameter(rawGainValue, -60.0f, 24.0f, "gain");
inputGain.setGainDecibels(validatedGain);
```

#### Parameter Smoothing (Anti-Zipper Noise)
```cpp
// Member variables for smoothed parameters
juce::SmoothedValue<float> smoothedGain;
juce::SmoothedValue<float> smoothedCutoff;
juce::SmoothedValue<float> smoothedResonance;

// In prepareToPlay()
void prepareToPlay(double sampleRate, int samplesPerBlock) override
{
    // Initialize smoothing with appropriate time constants
    smoothedGain.reset(sampleRate, 0.020); // 20ms for gain
    smoothedCutoff.reset(sampleRate, 0.050); // 50ms for filter
    smoothedResonance.reset(sampleRate, 0.010); // 10ms for resonance
}

// In processBlock() - with smoothing
auto* gainParam = apvts.getRawParameterValue("gain");
smoothedGain.setTargetValue(gainParam->load());

for (int sample = 0; sample < numSamples; ++sample)
{
    float currentGain = smoothedGain.getNextValue();
    // Apply to DSP with per-sample smoothing
    inputGain.setGainDecibels(currentGain);
}
```

#### Parameter Mapping Templates
```cpp
// Template for different parameter types
enum class ParameterType
{
    Linear,
    Logarithmic,
    Exponential,
    Boolean
};

// Parameter mapping helper
float mapParameter(float normalizedValue, ParameterType type, float minVal, float maxVal)
{
    switch (type)
    {
        case ParameterType::Linear:
            return juce::jmap(normalizedValue, 0.0f, 1.0f, minVal, maxVal);
            
        case ParameterType::Logarithmic:
            return juce::jmap(juce::jlimit(0.0f, 1.0f, normalizedValue),
                             0.0f, 1.0f, minVal, maxVal, true);
            
        case ParameterType::Exponential:
            return minVal * std::pow(maxVal / minVal, normalizedValue);
            
        case ParameterType::Boolean:
            return normalizedValue > 0.5f ? maxVal : minVal;
            
        default:
            return normalizedValue;
    }
}

// Usage example
auto* cutoffParam = apvts.getRawParameterValue("cutoff");
float normalizedCutoff = cutoffParam->load();
float mappedCutoff = mapParameter(normalizedCutoff,
                                 ParameterType::Logarithmic,
                                 20.0f, 20000.0f);
*filter.coefficients = juce::dsp::IIR::Coefficients::makeLowPass(
    sampleRate, mappedCutoff);
```

#### Consistency Verification
```cpp
// Helper to verify parameter consistency between spec and implementation
void verifyParameterConsistency()
{
    // This should be called during development/debug builds
    #ifdef DEBUG
    // Check that all parameters in parameter-spec.md are implemented
    // This is a development-time check, not runtime
    #endif
}
```

### Parameter Binding:
```cpp
// Standardized parameter binding pattern
void processBlock(juce::AudioBuffer& buffer, juce::MidiBuffer& midiMessages) override
{
    juce::ScopedNoDenormals noDenormals;
    
    // 1. Read all parameters with validation
    auto* gainParam = apvts.getRawParameterValue("gain");
    auto* cutoffParam = apvts.getRawParameterValue("cutoff");
    auto* resonanceParam = apvts.getRawParameterValue("resonance");
    
    // 2. Update smoothed values
    smoothedGain.setTargetValue(gainParam->load());
    smoothedCutoff.setTargetValue(cutoffParam->load());
    smoothedResonance.setTargetValue(resonanceParam->load());
    
    // 3. Process audio with per-sample parameter updates
    const int numSamples = buffer.getNumSamples();
    
    for (int sample = 0; sample < numSamples; ++sample)
    {
        // Get current smoothed values
        float currentGain = smoothedGain.getNextValue();
        float currentCutoff = smoothedCutoff.getNextValue();
        float currentResonance = smoothedResonance.getNextValue();
        
        // Apply to DSP components
        inputGain.setGainDecibels(currentGain);
        
        // Update filter with mapped values
        float mappedCutoff = mapParameter(currentCutoff,
                                         ParameterType::Logarithmic,
                                         20.0f, 20000.0f);
        float mappedResonance = mapParameter(currentResonance,
                                           ParameterType::Linear,
                                           0.1f, 10.0f);
        
        *filter.coefficients = juce::dsp::IIR::Coefficients::makeLowPass(
            currentSampleRate, mappedCutoff, mappedResonance);
        
        // Process this sample
        juce::dsp::AudioBlock block(buffer.getArrayOfWritePointers(),
                                   buffer.getNumChannels(), 1);
        juce::dsp::ProcessContextReplacing context(block);
        
        inputGain.process(context);
        filter.process(context);
    }
}
```

### Edge Cases:
```cpp
// Handle zero-length buffers
if (buffer.getNumSamples() == 0)
    return;

// Handle silent input
auto totalNumInputChannels = getTotalNumInputChannels();
auto totalNumOutputChannels = getTotalNumOutputChannels();

for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
    buffer.clear(i, 0, buffer.getNumSamples());
```

### Buffer Management:
```cpp
// Pre-allocate buffers in prepareToPlay()
void prepareToPlay(double sampleRate, int samplesPerBlock) override
{
    tempBuffer.setSize(2, samplesPerBlock);
    // Use tempBuffer in processBlock() - no allocation
}
```

---

## ✅ PHASE 4.2: BUILD & VERIFY

After implementation complete:

**Step 1: Validate JUCE/CMake setup**
```powershell
# Import state management module
. "$PSScriptRoot\..\scripts\state-management.ps1"

# Validate prerequisites using standardized function
if (-not (Validate-PhasePrerequisites -PluginPath "plugins\[Name]" -CurrentPhase "code" -RequiredPhase "design_complete" -RequiredFiles @(".ideas/architecture.md", ".ideas/plan.md"))) {
    Write-Host "ERROR: Prerequisites not met. Complete design phase first." -ForegroundColor Red
    exit 1
}

# Check JUCE installation
if (-not (Test-Path "C:\JUCE")) {
    Write-Host "ERROR: JUCE not found at C:\JUCE" -ForegroundColor Red
    Write-Host "Please install JUCE 8 and set up the project correctly" -ForegroundColor Yellow
    exit 1
}

# Check CMake availability
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: CMake not found" -ForegroundColor Red
    Write-Host "Please install CMake and ensure it's in your PATH" -ForegroundColor Yellow
    exit 1
}

# Validate project structure
if (-not (Test-Path "CMakeLists.txt")) {
    Write-Host "ERROR: CMakeLists.txt not found in project root" -ForegroundColor Red
    exit 1
}

# Validate canvas implementation for WebView framework
if ($state.ui_framework -eq "webview") {
    if (-not (Test-CanvasImplementation -PluginPath "plugins\[Name]")) {
        Write-Host "ERROR: Canvas implementation required for WebView framework" -ForegroundColor Red
        Write-Host "WebView plugins must use HTML5 Canvas API with JUCE frontend library" -ForegroundColor Yellow
        Write-Host "Please ensure Design/index.html uses canvas-based rendering" -ForegroundColor Yellow
        exit 1
    }
}
```

**Step 2: Build plugin**
```powershell
# Build plugin with validation
try {
    powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName [Name]
    Write-Host "Build completed successfully" -ForegroundColor Green
} catch {
    Write-Host "Build failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Please check the build script and JUCE configuration" -ForegroundColor Yellow
    exit 1
}
```

**If build fails:**
1. Read error messages carefully
2. Verify JUCE modules are properly included
3. Ensure CMakeLists.txt is correctly configured
4. Fix issues and rebuild

**If build succeeds:**
- Plugin compiles with DSP processing
- Parameters control audio engine
- JUCE/CMake integration validated
- Ready for testing

---

## 🧪 PHASE 4.3: AUTOMATED TESTING

Run 5 automated tests:

1. **Build test** - Compiles successfully (already passed)
2. **Load test** - Plugin loads in DAW without crash
3. **Process test** - Audio processing works
4. **Parameter test** - Parameters affect audio output
5. **State test** - Save/load preserves settings

**If tests fail:** Cannot proceed to SHIP phase until audio engine is stable.

---

## 🎨 PHASE 4.4: GUI DECISION GATE

**CRITICAL CHOICE:** Custom UI or headless?
```
✓ Audio Engine Working

DSP components: [N]
Parameters: [N]
Tests: All passed

What type of interface?

1. Add custom UI - WebView interface with mockup
2. Ship headless - DAW controls only (fast path)
3. Test in DAW first

Choose (1-3): _
```

### Option 1: Custom UI Path
- Check for existing mockup in `.ideas/mockups/`
- If none: Invoke ui-mockup skill
- If exists: Proceed to SHIP phase (Phase 5)

### Option 2: Headless Path
- Generate minimal PluginEditor (simple window)
- DAW provides parameter controls automatically
- Fast path to v1.0.0
- Can add custom UI later via `/improve [Name]`

### Option 3: Test First
- Load plugin in DAW
- Verify DSP behavior
- Return to decision menu

---

## 📦 PHASE 4.5: STATE MANAGEMENT

Ensure plugin state saves/loads correctly:
```cpp
// getStateInformation()
void getStateInformation(juce::MemoryBlock& destData) override
{
    auto state = apvts.copyState();
    std::unique_ptr xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

// setStateInformation()
void setStateInformation(const void* data, int sizeInBytes) override
{
    std::unique_ptr xmlState(getXmlFromBinary(data, sizeInBytes));
    
    if (xmlState.get() != nullptr)
        if (xmlState->hasTagName(apvts.state.getType()))
            apvts.replaceState(juce::ValueTree::fromXml(*xmlState));
}
```

**Critical:** State must preserve all parameter values between sessions.

---

## 🔄 VERSIONING & COMMITS

**Git commit after each phase:**
```powershell
# Backup state before commit
Backup-PluginState -PluginPath "plugins\[Name]"

git add plugins/[Name]/Source/
git add plugins/[Name]/.ideas/plan.md
git commit -m "feat([Name]): Phase 4.1 DSP - [Phase description]

Implemented: [list components]
Parameters connected: [N]
Real-time safe: Yes

Generated with Kilo Code"
```

**For single-pass:**
```powershell
# Backup state before final commit
Backup-PluginState -PluginPath "plugins\[Name]"

git commit -m "feat([Name]): Phase 4 CODE complete

All DSP components implemented
[N] parameters connected
Real-time safe audio processing

Generated with Kilo Code"
```

**Update state after implementation:**
```powershell
# Mark implementation complete using standardized function
Complete-Phase -PluginPath "plugins\[Name]" -Phase "code" -Updates @{
  "validation.code_complete" = $true
  "validation.tests_passed" = $false  # Will be set after testing
}
```

---

## 🎵 COMMON DSP PATTERNS

### Gain/Volume Control:
```cpp
juce::dsp::Gain gain;
gain.setGainDecibels(dbValue);
gain.process(context);
```

### Filtering:
```cpp
juce::dsp::IIR::Filter filter;
*filter.coefficients = juce::dsp::IIR::Coefficients::makeLowPass(
    sampleRate, cutoffFreq, resonance);
filter.process(context);
```

### Compression:
```cpp
juce::dsp::Compressor compressor;
compressor.setThreshold(thresholdDb);
compressor.setRatio(ratio);
compressor.setAttack(attackMs);
compressor.setRelease(releaseMs);
compressor.process(context);
```

### Smoothing (Anti-Zipper):
```cpp
juce::SmoothedValue smoothedGain;
smoothedGain.reset(sampleRate, 0.05); // 50ms ramp

// In processBlock
smoothedGain.setTargetValue(newGainValue);
for (int sample = 0; sample < numSamples; ++sample)
{
    float currentGain = smoothedGain.getNextValue();
    // Apply currentGain to audio
}
```

---

## 📚 INTEGRATION

**Invoked by:**
- Natural language: "Implement DSP for [Name]"
- After Phase 3 (DESIGN) complete
- Part of plugin-workflow automation

**Updates:**
- `Source/PluginProcessor.h` - DSP member variables
- `Source/PluginProcessor.cpp` - Audio processing logic
- `PLUGINS.md` - Phase status
- `plugins/[Name]/status.json` - Project state

**Next phase:**
- Phase 5: SHIP (if headless chosen or custom UI complete)

---

## ⚠️ CRITICAL REMINDERS

1. **Real-time safety** - No allocations in audio thread
2. **Parameter zero-drift** - Use exact IDs from parameter-spec.md
3. **Use unified parameter system** - Always validate, smooth, and map parameters
4. **Test after each phase** - Verify before continuing
5. **Commit frequently** - Preserve progress
6. **Edge cases** - Handle silent input, zero buffers
7. **Build from root** - Not from plugin directory
8. **Consistency check** - Verify all spec parameters are implemented

---

## 🐛 TROUBLESHOOTING

**Build errors:**
- Verify JUCE module includes
- Check parameter ID typos

**No audio output:**
- Verify processBlock() called
- Check channel routing
- Verify DSP components initialized in prepareToPlay()

**Crackling/artifacts:**
- Add parameter smoothing
- Check buffer size handling
- Verify real-time safety (no allocations)

**Parameters don't respond:**
- Verify APVTS getRawParameterValue() calls
- Check parameter ID strings match spec
- Verify parameter ranges correct