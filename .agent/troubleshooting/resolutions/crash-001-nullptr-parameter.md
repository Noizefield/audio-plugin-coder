# CRASH-001: Nullptr Dereference from Non-Existent Parameter

**Status:** SOLVED
**Category:** Build/Runtime Crash
**Severity:** CRITICAL
**Date Discovered:** 2026-01-29
**Plugin:** CloudWash

## Problem Description

Plugin crashes immediately when loaded in DAW or standalone, with access violation error. Crash occurs during PluginEditor constructor when creating parameter attachments.

## Symptoms

- ✗ Plugin crashes on load (DAW or standalone)
- ✗ Access violation error
- ✗ Crash in PluginEditor constructor
- ✗ No error message, just immediate crash

## Root Cause

Code attempts to create a parameter attachment for a parameter that **doesn't exist** in the `createParameterLayout()` function.

**Example from CloudWash:**
```cpp
// PluginEditor.cpp line 62-63
blendModeAttachment = std::make_unique<juce::WebSliderParameterAttachment>(
    *audioProcessor.apvts.getParameter("blend_mode"), blendModeRelay);
    // ↑ getParameter() returns nullptr because "blend_mode" doesn't exist!
    // ↑ Dereferencing nullptr with * operator = CRASH
```

But in `PluginProcessor.cpp` `createParameterLayout()`:
```cpp
// NO "blend_mode" parameter defined!
layout.add(std::make_unique<juce::AudioParameterFloat>("position", ...));
layout.add(std::make_unique<juce::AudioParameterFloat>("size", ...));
// ... no blend_mode anywhere ...
```

## Solution

### Step 1: Identify the Missing Parameter

Search your `PluginEditor.cpp` for all `getParameter()` calls:
```cpp
apvts.getParameter("parameter_name")
```

### Step 2: Verify Each Parameter Exists

For each parameter name found, search `PluginProcessor.cpp` `createParameterLayout()` to verify it's defined:
```cpp
layout.add(std::make_unique<juce::AudioParameterFloat>("parameter_name", ...));
```

### Step 3: Fix the Mismatch

**Option A: Remove the attachment** (if parameter not needed)
```cpp
// Remove from PluginEditor.h:
juce::WebSliderRelay blendModeRelay { "blend_mode" };  // DELETE
std::unique_ptr<juce::WebSliderParameterAttachment> blendModeAttachment;  // DELETE

// Remove from PluginEditor.cpp:
blendModeAttachment = std::make_unique<...>(...);  // DELETE
.withOptionsFrom(blendModeRelay)  // DELETE
```

**Option B: Add the parameter** (if needed)
```cpp
// Add to PluginProcessor.cpp createParameterLayout():
layout.add(std::make_unique<juce::AudioParameterFloat>(
    "blend_mode", "Blend Mode",
    juce::NormalisableRange<float>(0.0f, 1.0f, 0.001f), 0.5f));
```

### Step 4: Rebuild and Test

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName YourPlugin
```

## Prevention Checklist

- [ ] **Parameter naming convention** - Use consistent names (snake_case or camelCase)
- [ ] **Parameter audit** - Before building, verify all `getParameter()` calls match layout
- [ ] **Code review** - Check parameter additions in both files
- [ ] **Testing** - Always test plugin load after adding new parameters

## Testing the Fix

1. **Standalone Test:**
   ```powershell
   cd build\plugins\YourPlugin\YourPlugin_artefacts\Release\Standalone
   .\YourPlugin.exe
   ```
   Plugin should launch without crashing.

2. **DAW Test:**
   - Load plugin in DAW (Ableton, Reaper, etc.)
   - Plugin should load without crash
   - All parameters should be accessible

3. **PluginVal Test:**
   ```powershell
   .\_tools\pluginval\pluginval.exe --validate "C:\Program Files\Common Files\VST3\YourPlugin.vst3"
   ```
   Should pass "Open plugin (cold)" and "Open plugin (warm)" tests.

## Related Issues

- **webview-004**: Similar crash pattern but caused by attachment order, not missing parameter
- **build-004**: JuceHeader.h not found - different error, same crash symptom

## Code Pattern to Avoid

```cpp
// ❌ WRONG - No null check
auto* param = apvts.getParameter("might_not_exist");
auto attachment = std::make_unique<WebSliderParameterAttachment>(*param, relay);
// CRASH if param is nullptr!

// ✅ CORRECT - With null check
auto* param = apvts.getParameter("might_not_exist");
if (param != nullptr) {
    auto attachment = std::make_unique<WebSliderParameterAttachment>(*param, relay);
} else {
    DBG("ERROR: Parameter 'might_not_exist' not found!");
}
```

## Debugging Tips

If you encounter this crash:

1. **Look at the call stack** - Crash will be in PluginEditor constructor
2. **Find the line number** - Debugger shows exact `getParameter()` call
3. **Check parameter name** - Copy the string literal
4. **Search PluginProcessor** - Does this parameter exist in `createParameterLayout()`?
5. **Fix mismatch** - Either add parameter or remove attachment

## Success Criteria

- ✅ Plugin loads in standalone without crash
- ✅ Plugin loads in DAW without crash
- ✅ All UI controls bind to correct parameters
- ✅ PluginVal passes basic load tests

---
**Last Updated:** 2026-01-29
**Verified Fix:** CloudWash v0.1.0
