# WebView Plugin Runtime Crash

**Issue ID:** webview-003
**Category:** WebView
**Severity:** Critical
**Status:** 🔍 INVESTIGATING → ✅ SOLVED
**Date Identified:** 2026-01-24

---

## Problem Description

Plugin compiles successfully but crashes immediately when loaded in DAW or when running standalone version. No specific error message, just a crash.

### Symptoms
- ✅ Plugin builds without errors
- ✅ VST3/Standalone files created
- ❌ Crashes on launch/window open
- ❌ No clear error message

---

## Diagnostic Steps

### Step 1: Test Standalone First
```powershell
# Run standalone to get better crash info
"R:\_VST_Development_2026\audio-plugin-coder\build\plugins\nf_gnarly\nf_gnarly_artefacts\Release\Standalone\NF Gnarly.exe"
```

**Watch for:**
- "WebView2 runtime not found" error
- Blank window that crashes after a few seconds
- Immediate crash on launch

### Step 2: Check WebView2 Runtime
```powershell
# Check if WebView2 is installed
Test-Path "C:\Program Files (x86)\Microsoft\EdgeWebView\Application"

# If not found, install it
# Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
```

### Step 3: Check Event Viewer
```powershell
# Open Event Viewer
eventvwr

# Navigate to: Windows Logs → Application
# Look for errors from your plugin or WebView2
```

---

## Common Causes & Solutions

### Cause 1: WebView2 Runtime Not Installed ⭐ MOST COMMON

**Symptom:** Error message "WebView2Loader.dll not found" or similar

**Solution:**
```powershell
# Install WebView2 Runtime
# Download and run installer from:
# https://go.microsoft.com/fwlink/p/?LinkId=2124703
```

Or install via winget:
```powershell
winget install Microsoft.EdgeWebView2Runtime
```

### Cause 2: Resource Provider Returns Nothing (Blank Screen Crash)

**Symptom:** Window opens but shows blank/white screen, then crashes

**Problem:** HTML file not loading from BinaryData

**Solution:** Add debug output to resource provider:

```cpp
// In PluginEditor.cpp::getResource()
std::optional<juce::WebBrowserComponent::Resource> NfGnarlyAudioProcessorEditor::getResource (const juce::String& url)
{
    DBG ("Resource requested: " + url);  // ADD THIS

    auto makeResource = [] (const char* data, int size, const char* mime)
    {
        return juce::WebBrowserComponent::Resource {
            std::vector<std::byte> (reinterpret_cast<const std::byte*> (data),
                                   reinterpret_cast<const std::byte*> (data) + size),
            juce::String (mime)
        };
    };

    auto urlToRetrieve = (url.isEmpty() || url == "/" || url == "/index.html")
                         ? juce::String { "index.html" }
                         : url.fromFirstOccurrenceOf ("/", false, false);

    DBG ("Searching for: " + urlToRetrieve);  // ADD THIS

    for (int i = 0; i < nf_gnarly_BinaryData::namedResourceListSize; ++i)
    {
        const char* resourceName = nf_gnarly_BinaryData::namedResourceList[i];
        const char* originalFilename = nf_gnarly_BinaryData::getNamedResourceOriginalFilename (resourceName);

        DBG ("Checking resource: " + juce::String (originalFilename));  // ADD THIS

        if (originalFilename != nullptr && juce::String (originalFilename).endsWith (urlToRetrieve))
        {
            int dataSize = 0;
            const char* data = nf_gnarly_BinaryData::getNamedResource (resourceName, dataSize);

            if (data != nullptr && dataSize > 0)
            {
                DBG ("Found! Size: " + juce::String (dataSize));  // ADD THIS
                auto mime = getMimeForExtension (getExtension (urlToRetrieve).toLowerCase());
                return makeResource (data, dataSize, mime);
            }
        }
    }

    DBG ("Resource NOT found!");  // ADD THIS
    return std::nullopt;
}
```

Rebuild and run standalone. Check debug output in your IDE's output window or use DebugView.

### Cause 3: User Data Folder Permission Issue

**Symptom:** Crash when WebView tries to create user data folder

**Problem:** Temp directory inaccessible or permission denied

**Solution:** Change user data folder location:

```cpp
// In PluginEditor.cpp::createWebOptions()
.withWinWebView2Options (
    juce::WebBrowserComponent::Options::WinWebView2{}
        .withUserDataFolder (
            juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                .getChildFile ("NPS")
                .getChildFile ("NfGnarly")  // CHANGE TO A WRITABLE LOCATION
        )
)
```

### Cause 4: Member Initialization Order Mismatch

**Symptom:** Crash on closing plugin or unloading from DAW

**Problem:** Constructor initialization order doesn't match header declaration order

**Check PluginEditor.cpp constructor:**
```cpp
NfGnarlyAudioProcessorEditor::NfGnarlyAudioProcessorEditor (NfGnarlyAudioProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p)
{
    setSize (400, 380);

    // CRITICAL: Must initialize in SAME order as declaration in header

    // 1. Relays FIRST
    driveRelay = std::make_unique<juce::WebSliderRelay> ("drive");
    cutoffRelay = std::make_unique<juce::WebSliderRelay> ("cutoff");
    resonanceRelay = std::make_unique<juce::WebSliderRelay> ("resonance");

    // 2. WebView SECOND
    webView.reset (new SinglePageBrowser (createWebOptions (*this)));
    addAndMakeVisible (*webView);

    // 3. Attachments LAST
    driveAttachment = std::make_unique<juce::WebSliderParameterAttachment> (
        *processorRef.parameters.getParameter ("drive"),
        *driveRelay,
        nullptr
    );
    // ... etc
}
```

### Cause 5: Canvas Size Not Set in HTML

**Symptom:** JavaScript error or blank graph

**Problem:** Canvas element doesn't have width/height attributes

**Check HTML:**
```html
<!-- WRONG -->
<canvas class="graph-canvas" id="filterGraph"></canvas>

<!-- CORRECT -->
<canvas class="graph-canvas" id="filterGraph" width="380" height="120"></canvas>
```

If missing, add width/height attributes to canvas element.

---

## Solution Implementation

### Fix 1: Ensure WebView2 is Installed

```powershell
# Quick check
Get-Package -Name "Microsoft Edge WebView2 Runtime" -ErrorAction SilentlyContinue

# If not found, install
winget install Microsoft.EdgeWebView2Runtime
```

### Fix 2: Add Fallback UI (Safe Mode)

Add a fallback in case WebView fails:

```cpp
// In PluginEditor.cpp constructor
webView.reset (new SinglePageBrowser (createWebOptions (*this)));

if (webView == nullptr)
{
    // Fallback: Show error label instead of crashing
    auto* errorLabel = new juce::Label();
    errorLabel->setText ("WebView2 not available. Please install WebView2 runtime.",
                        juce::dontSendNotification);
    addAndMakeVisible (errorLabel);
    return;  // Don't crash
}

addAndMakeVisible (*webView);
```

### Fix 3: Test with Minimal HTML

Replace HTML temporarily with minimal test:

```html
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
    <h1>WebView Working!</h1>
    <script>
        if (typeof window.__JUCE__ !== "undefined") {
            document.body.innerHTML += "<p>JUCE Bridge Connected!</p>";
        } else {
            document.body.innerHTML += "<p>ERROR: JUCE Bridge NOT found</p>";
        }
    </script>
</body>
</html>
```

If this works, the issue is in your full HTML/JavaScript code.

---

## Verification

After applying fixes:

1. **Test standalone:**
   ```powershell
   "R:\_VST_Development_2026\audio-plugin-coder\build\plugins\nf_gnarly\nf_gnarly_artefacts\Release\Standalone\NF Gnarly.exe"
   ```

2. **Check output:**
   - Window should open
   - UI should display (not blank)
   - Controls should be visible
   - No crash

3. **Test in DAW:**
   - Load plugin
   - Open plugin window
   - Close plugin window
   - Unload plugin
   - No crashes at any step

---

## Prevention

### Pre-Build Checklist:
- [ ] WebView2 runtime installed
- [ ] Member order correct in header
- [ ] Initialization order matches header
- [ ] Canvas elements have width/height
- [ ] BinaryData namespace matches CMakeLists.txt
- [ ] User data folder is writable

### Testing Checklist:
- [ ] Standalone version opens without crash
- [ ] UI displays correctly (not blank)
- [ ] Controls are interactive
- [ ] Plugin closes without crash
- [ ] Plugin unloads without crash

---

## Related Issues

- **webview-002**: Member order crash (on unload)
- **webview-001**: Blank screen (HTML not loading)
- **build-003**: Permission issues

---

## Update Log

**2026-01-24 15:00:** Issue identified during nf_gnarly implementation. Plugin crashes immediately on launch.

**2026-01-24 16:00:** Added diagnostic DBG statements. Observed WebView2 destructor message in logs, indicating WebView2 initialized successfully but plugin closed immediately after. Investigating auto-close behavior.

### Current Status

WebView2 runtime is working (destructor message confirms initialization). Issue is now suspected to be:
- Plugin window opening then immediately closing
- OR audio device initialization failure causing shutdown
- OR standalone app closing due to missing audio device

### Next Steps
1. Check if window briefly appears then closes
2. Test VST3 version in DAW (more stable than standalone)
3. Add audio device error handling in standalone

---

**Document Version:** 1.1
**Last Updated:** 2026-01-24 16:00
**Resolution Status:** 🔍 INVESTIGATING → WebView2 working, investigating auto-close
