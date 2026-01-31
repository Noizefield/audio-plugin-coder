# Troubleshooting Guide

Comprehensive guide for diagnosing and resolving issues in the Audio Plugin Coder framework.

## Overview

APC includes an auto-capture system that learns from problems. This guide covers:
- Known issues database
- Common problems and solutions
- Debugging techniques
- Error recovery procedures

---

## Known Issues Database

### Location

```
.kilocode/troubleshooting/
├── known-issues.yaml           # Issue registry
├── _template.md                # Resolution template
└── resolutions/                # Solution documents
    ├── webview-member-order-crash.md
    ├── webview-runtime-crash.md
    ├── webview-attachment-order-crash.md
    ├── webview-blank-screen.md
    ├── audio-processing-issues.md
    ├── cmake-duplicate-target.md
    ├── vst3-install-failed.md
    └── vst3-permission-denied.md
```

### Issue Schema

```yaml
issues:
  - id: category-###
    title: "Issue title"
    category: build|webview|packaging|dsp|ui
    severity: low|medium|high|critical
    symptoms:
      - "Observable symptom 1"
      - "Observable symptom 2"
    error_patterns:
      - "Pattern to match in error messages"
    root_cause: "Explanation of why it happens"
    resolution_status: investigating|solved
    resolution_file: resolutions/category-###.md
    frequency: N
    last_occurred: YYYY-MM-DD
    attempts_before_resolution: N
    prevention: "How to prevent it"
```

### Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `build` | CMake, compilation, linking | Duplicate targets, missing headers |
| `webview` | WebView2, HTML/JS loading | Blank screen, crashes, member order |
| `packaging` | VST3 installation, distribution | Permission denied, DAW not detecting |
| `dsp` | Audio processing, parameters | No output, crackling, parameter issues |
| `ui` | Visage rendering, controls | Layout issues, control binding |

---

## Auto-Capture Protocol

### Detection

When an error occurs:
1. Extract key phrases from error message
2. Search `known-issues.yaml` for matches
3. If found → Apply documented solution
4. If not found → Attempt resolution manually

### Threshold

Auto-capture triggers after:
- 3+ attempts to fix the same issue, OR
- >5 minutes spent on the same error, OR
- Recognized as recurring pattern

### Capture Process

```powershell
# Generate unique issue ID
$category = "build"  # or webview, packaging, etc.
$existingIssues = (Get-Content .kilocode/troubleshooting/known-issues.yaml | 
    Select-String -Pattern "id: $category-" | Measure-Object).Count
$newId = "$category-$(($existingIssues + 1).ToString('000'))"

# Create new issue entry
$newIssue = @"

  - id: $newId
    title: "[Auto] $errorSummary"
    category: $category
    severity: high
    symptoms:
      - "$errorMessage"
    error_patterns:
      - "$keyPattern1"
      - "$keyPattern2"
    resolution_status: investigating
    resolution_file: resolutions/$newId.md
    frequency: 1
    last_occurred: $(Get-Date -Format "yyyy-MM-dd")
    attempts_before_resolution: $attemptCount
"@

# Append to known-issues.yaml
Add-Content -Path .kilocode/troubleshooting/known-issues.yaml -Value $newIssue
```

---

## Common Issues

### Build Issues

#### CMake: Duplicate Target Error

**Issue ID:** `cmake-001`

**Symptoms:**
```
CMake Error: add_library cannot create target
Target 'juce_core' already exists
```

**Root Cause:** Plugin CMakeLists.txt calls `juce_add_modules` when JUCE is already included at root level.

**Solution:**
Remove `juce_add_modules` from plugin CMakeLists.txt:
```cmake
# WRONG - Don't do this in plugin CMakeLists.txt
juce_add_modules(juce_core juce_audio_processors)  # Remove!

# CORRECT - Just link the modules
target_link_libraries(MyPlugin PRIVATE
    juce::juce_core
    juce::juce_audio_processors
)
```

**Prevention:** Never call `juce_add_modules` in plugin CMakeLists.txt files.

---

#### Permission Denied: VST3 Install

**Issue ID:** `build-003`

**Symptoms:**
```
file INSTALL cannot make directory
C:\Program Files\Common Files/VST3
Permission denied
```

**Root Cause:** Windows requires administrator privileges to write to Program Files.

**Solutions:**

1. **Run as Administrator:**
   ```powershell
   # Right-click PowerShell → Run as Administrator
   ```

2. **Skip install and copy manually:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin -NoInstall
   # Then manually copy from build/ to VST3 folder
   ```

3. **Change install prefix:**
   ```cmake
   # In plugin CMakeLists.txt
   set(CMAKE_INSTALL_PREFIX "${CMAKE_BINARY_DIR}/install")
   ```

**Prevention:** Run build scripts as administrator or use `-NoInstall` flag.

---

### WebView Issues

#### DAW Crashes When Unloading Plugin

**Issue ID:** `webview-002`

**Symptoms:**
- DAW crashes when closing plugin window
- Segmentation fault on plugin destructor
- Access violation in WebBrowserComponent destructor
- Crash only happens in release builds

**Root Cause:** Member declaration order causes WebBrowserComponent to be destroyed after WebSliderRelay objects it references.

**Solution:**
Ensure correct member order in PluginEditor.h:
```cpp
private:
    // 1. RELAYS FIRST (destroyed last)
    juce::WebSliderRelay gainRelay { "GAIN" };

    // 2. WEBVIEW SECOND (destroyed middle)
    std::unique_ptr<juce::WebBrowserComponent> webView;

    // 3. ATTACHMENTS LAST (destroyed first)
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
```

**Verification:**
```powershell
.\scripts\validate-webview-member-order.ps1 -PluginName MyPlugin
```

**Prevention:** Always declare members in order: Relays → WebView → Attachments.

**See:** [webview-member-order-crash.md](.kilocode/troubleshooting/resolutions/webview-member-order-crash.md)

---

#### Plugin Crashes on Load

**Issue ID:** `webview-004`

**Symptoms:**
- Plugin crashes entire DAW when loaded
- Standalone crashes immediately on launch
- No error message, instant crash
- Build succeeds perfectly

**Root Cause:** `addAndMakeVisible(webView)` called BEFORE parameter attachments created. WebView initializes and tries to access attachments that don't exist yet → null pointer crash.

**Solution:**
Correct initialization order in PluginEditor.cpp:
```cpp
YourPluginEditor::YourPluginEditor(YourAudioProcessor& p)
    : AudioProcessorEditor(&p), audioProcessor(p)
{
    setSize(600, 400);

    // 1. Create WebView
    webView = std::make_unique<juce::WebBrowserComponent>(...);

    // 2. Create ALL attachments BEFORE addAndMakeVisible
    gainAttachment = std::make_unique<juce::WebSliderParameterAttachment>(...);
    freqAttachment = std::make_unique<juce::WebSliderParameterAttachment>(...);
    // ... create all attachments

    // 3. NOW make visible
    addAndMakeVisible(*webView);

    // 4. Load URL
    webView->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}
```

**Critical Fix Order:**
1. Relays (in header)
2. WebView (in constructor)
3. Attachments (in constructor, before addAndMakeVisible)
4. addAndMakeVisible
5. goToURL
6. setSize

**Prevention:** Always create ALL parameter attachments BEFORE calling `addAndMakeVisible(webView)`.

**See:** [webview-attachment-order-crash.md](.kilocode/troubleshooting/resolutions/webview-attachment-order-crash.md)

---

#### Blank White Screen

**Issue ID:** `webview-001`

**Symptoms:**
- Blank white screen in plugin
- Failed to load resource errors

**Root Cause:** Resource provider not finding web files or incorrect MIME types.

**Solution:**
1. Verify files are embedded in CMakeLists.txt:
   ```cmake
   juce_add_binary_data(MyPlugin_WebUI
       SOURCES
           Source/ui/public/index.html
           Source/ui/public/js/index.js
   )
   ```

2. Check resource provider implementation:
   ```cpp
   std::optional<Resource> getResource(const String& url) {
       // Handle root URL
       const auto urlToRetrieve = url == "/" ? String{ "index.html" }
                                              : url.fromFirstOccurrenceOf("/", false, false);
       // ... rest of implementation
   }
   ```

3. Verify MIME types:
   ```cpp
   // JS files must return "text/javascript"
   // CSS files must return "text/css"
   ```

4. Open DevTools to debug:
   - Right-click in WebView → Inspect
   - Check Console for errors
   - Check Network tab for failed requests

**Prevention:** Run validation script before building:
```powershell
.\scripts\validate-webview-setup.ps1 -PluginName MyPlugin
```

---

### Packaging Issues

#### VST3 Not Appearing in DAW

**Issue ID:** `vst3-002`

**Symptoms:**
- Plugin builds successfully
- DAW doesn't see the plugin
- VST3 folder scan doesn't detect it

**Root Cause:** VST3 not installed to correct location or DAW cache issue.

**Solutions:**

1. **Verify install location:**
   ```
   C:\Program Files\Common Files\VST3\MyPlugin.vst3
   ```

2. **Force DAW rescan:**
   - Delete DAW's plugin cache
   - Rescan VST3 folder

3. **Check plugin validates:**
   ```powershell
   .\scripts\pluginval-integration.ps1 -PluginName MyPlugin
   ```

4. **Try different DAW:**
   - Some DAWs are more strict about validation
   - Test with Reaper (most permissive)

**Prevention:** Always run pluginval validation before installing.

---

## Debugging Techniques

### Enable Debug Logging

**C++ Debug Output:**
```cpp
// In PluginProcessor or PluginEditor
DBG("Debug message: " << variable);
```

**JavaScript Debug Output:**
```javascript
// In WebView JavaScript
console.log("Debug message:", variable);
```

### VS Code: Debugging

**launch.json configuration:**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Standalone",
      "type": "cppvsdbg",
      "request": "launch",
      "program": "${workspaceFolder}/build/plugins/MyPlugin/MyPlugin_artefacts/Debug/Standalone/MyPlugin.exe",
      "args": [],
      "stopAtEntry": false,
      "cwd": "${workspaceFolder}",
      "environment": [],
      "console": "integratedTerminal"
    }
  ]
}
```

### WebView DevTools

1. Right-click in WebView → Inspect
2. Check Console for JavaScript errors
3. Check Network tab for failed resource loads
4. Check Elements tab for DOM structure

### PluginVal Validation

```powershell
# Run validation
.\scripts\pluginval-integration.ps1 -PluginName MyPlugin

# Strict validation
.\scripts\pluginval-integration.ps1 -PluginName MyPlugin -Strict
```

---

## Error Recovery

### State Rollback

If a phase goes wrong:

```powershell
# Check available backups
Get-ChildItem plugins/MyPlugin/status.json.backup.*

# Restore previous state
.\scripts\state-management.ps1
Restore-PluginState -PluginPath "plugins/MyPlugin"

# Or manually reset phase
Update-PluginState -PluginPath "plugins/MyPlugin" -Phase "design_complete"
```

### Git Recovery

```powershell
# Check git status
git status

# Reset to last commit
git checkout -- plugins/MyPlugin/

# Or reset specific files
git checkout -- plugins/MyPlugin/Source/PluginEditor.cpp
```

### Clean Build

```powershell
# Remove all build artifacts
Remove-Item -Recurse -Force build/

# Rebuild from scratch
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin
```

---

## Getting Help

### Before Asking

1. **Check known issues:**
   ```powershell
   Get-Content .kilocode/troubleshooting/known-issues.yaml | Select-String "your error"
   ```

2. **Run validation:**
   ```powershell
   .\scripts\validate-plugin-status.ps1 -PluginName MyPlugin
   .\scripts\validate-webview-setup.ps1 -PluginName MyPlugin
   ```

3. **Check state:**
   ```powershell
   Get-Content plugins/MyPlugin/status.json | ConvertFrom-Json
   ```

### Information to Provide

When reporting an issue:
- Error message (full text)
- Current phase from status.json
- Steps to reproduce
- Platform (Windows/macOS/Linux)
- DAW being used
- Build output (if build-related)

---

## Prevention Checklist

### Before Building
- [ ] JUCE submodules initialized
- [ ] CMake 3.22+ installed
- [ ] Visual Studio 2022 installed (Windows)
- [ ] WebView2 Runtime installed (for WebView plugins)

### Before Testing
- [ ] Build succeeded without errors
- [ ] Validation scripts pass
- [ ] Member order correct (WebView)
- [ ] Resource provider implemented (WebView)

### Before Shipping
- [ ] All tests pass
- [ ] Plugin loads in DAW
- [ ] Parameters work correctly
- [ ] No crashes on load/unload
- [ ] State saves/loads correctly

---

## Related Documentation

- [Known Issues](.kilocode/troubleshooting/known-issues.yaml) - Full issue database
- [WebView Framework](webview-framework.md) - WebView-specific troubleshooting
- [Build System](build-system.md) - Build troubleshooting
- [State Management](state-management-deep-dive.md) - State recovery