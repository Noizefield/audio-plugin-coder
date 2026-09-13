# CRASH-002: CloudWash Access Violation (0xc0000005)

**Status:** INVESTIGATING
**Category:** Runtime Crash
**Severity:** CRITICAL
**Date Discovered:** 2026-01-29
**Plugin:** CloudWash

## Problem Description

CloudWash plugin crashes immediately on launch with Access Violation exception (0xc0000005). Both standalone and VST3 versions crash before UI appears.

## Crash Details

```
Faulting application: CloudWash.exe
Exception code: 0xc0000005 (ACCESS_VIOLATION)
Faulting module: CloudWash.exe
Fault offset: 0x0000000000ab89dc
```

**What is 0xc0000005?**
- Access Violation = Reading or writing to invalid memory address
- Common causes: Nullptr dereference, buffer overflow, use-after-free

## Symptoms

- ✗ Plugin crashes on launch (standalone and VST3)
- ✗ No UI appears
- ✗ Immediate crash, no error message
- ✗ Crash dump generated (133MB)

## Already Fixed (Not the Cause)

1. ✅ blend_mode parameter nullptr - FIXED (but still crashes)
2. ✅ Mutex blocking - FIXED (but still crashes)
3. ✅ Timer callback safety - FIXED (but still crashes)

## Investigation Steps Taken

### 1. Added Debug Logging

Added DBG() statements to track initialization:

```cpp
// PluginProcessor.cpp constructor
DBG("CloudWash: Constructor started");
DBG("CloudWash: Initializing Clouds processor");
DBG("CloudWash: Setting playback mode");
DBG("CloudWash: Calling Prepare()");
DBG("CloudWash: Setting initial state");
DBG("CloudWash: Initializing presets");
DBG("CloudWash: Constructor completed successfully");

// PluginEditor.cpp constructor
DBG("CloudWash: Editor constructor started");
DBG("CloudWash: Creating parameter attachments");
DBG("CloudWash: Creating WebView");
DBG("CloudWash: Adding WebView to component");
DBG("CloudWash: Loading web content");
DBG("CloudWash: Setting editor size");
DBG("CloudWash: Starting timer");
DBG("CloudWash: Editor constructor completed");
```

**To see debug output:** Run in Visual Studio debugger and check Output window.

### 2. Crash Dump Analysis Needed

Crash dump file: `C:\CrashDumps\CloudWash.exe.18776.dmp` (133MB)

**To analyze:**
```powershell
# Option 1: Visual Studio
devenv /debugcrash C:\CrashDumps\CloudWash.exe.*.dmp

# Option 2: WinDbg
windbg -z C:\CrashDumps\CloudWash.exe.*.dmp
```

**WinDbg commands to run:**
```
!analyze -v           # Automatic crash analysis
k                     # Call stack
lm                    # List loaded modules
r                     # Show registers
.ecxr                 # Show exception context
```

## Suspected Causes (In Order of Likelihood)

### 1. Clouds Processor Initialization (MOST LIKELY)

**Evidence:**
- Crashes during PluginProcessor constructor
- Complex memory initialization for Clouds DSP
- Buffer allocation issues

**Code involved:**
```cpp
// PluginProcessor.cpp line 24-36
const int memLen = 118784;
const int ccmLen = 65536 - 128;
block_mem.resize(memLen, 0);
block_ccm.resize(ccmLen, 0);

processor.Init(block_mem.data(), block_mem.size(),
               block_ccm.data(), block_ccm.size());
processor.set_playback_mode(clouds::PLAYBACK_MODE_GRANULAR);
processor.set_quality(0);
processor.set_silence(false);
processor.Prepare();  // ← Might crash here
```

**Possible issues:**
- `processor.Init()` expects specific memory alignment
- `processor.Prepare()` accessing uninitialized buffers
- Buffer sizes incorrect for current configuration

### 2. Sample Rate Converter Initialization

**Evidence:**
- Template parameters might be incorrect
- No explicit initialization in constructor

**Code involved:**
```cpp
// PluginProcessor.h line 100-101
clouds::SampleRateConverter<-2, 45, clouds::src_filter_1x_2_45> inputResamplers[2];
clouds::SampleRateConverter<+2, 45, clouds::src_filter_1x_2_45> outputResamplers[2];
```

**Possible issues:**
- Template ratio parameters wrong
- Filter coefficients not initialized
- Array access out of bounds

### 3. Preset Loading Crash

**Evidence:**
- `initializePresets()` called at end of constructor
- Accesses parameters that might not be fully initialized

**Code involved:**
```cpp
// PluginProcessor.cpp line 600-745
void CloudWashAudioProcessor::initializePresets() {
    presets.clear();
    presets.push_back({"01 - Init", {
        {"position", 0.5f}, {"size", 0.5f}, // etc...
    }});
    currentPresetIndex = 0;
}
```

**Possible issues:**
- Parameter access before APVTS fully initialized
- Map operations on uninitialized data

### 4. WebView2 Component Crash

**Evidence:**
- Crashes might be in Editor constructor
- WebView2 requires specific initialization order

**Less likely because:**
- Crash happens too early (before editor created)
- Exception would be different for WebView errors

## Testing Strategy

### Test 1: Disable Clouds Processor

Comment out Clouds initialization to isolate issue:

```cpp
// PluginProcessor.cpp constructor - TEMPORARILY COMMENT OUT
CloudWashAudioProcessor::CloudWashAudioProcessor()
    : /* ... */
      apvts (*this, nullptr, "Parameters", createParameterLayout())
{
    DBG("CloudWash: Constructor started");

    /*
    // TEMPORARILY DISABLED FOR TESTING
    const int memLen = 118784;
    const int ccmLen = 65536 - 128;
    block_mem.resize(memLen, 0);
    block_ccm.resize(ccmLen, 0);

    processor.Init(block_mem.data(), block_mem.size(),
                   block_ccm.data(), block_ccm.size());
    processor.set_playback_mode(clouds::PLAYBACK_MODE_GRANULAR);
    processor.set_quality(0);
    processor.set_silence(false);
    processor.Prepare();
    */

    currentMode.store(0);
    currentQuality.store(0);

    // initializePresets();  // Also comment out

    DBG("CloudWash: Constructor completed successfully");
}
```

**Expected result:**
- If plugin loads → Clouds processor is the problem
- If still crashes → Look at APVTS or other initialization

### Test 2: Minimal processBlock

Comment out all DSP processing:

```cpp
void CloudWashAudioProcessor::processBlock(AudioBuffer<float>& buffer, MidiBuffer&) {
    // Just pass through
    return;
}
```

### Test 3: Run with Debugger

**REQUIRED:** Must run in Visual Studio debugger to see exact crash location.

```powershell
# Open solution
devenv R:\_VST_Development_2026\audio-plugin-coder\build\CloudWash.sln

# Or debug executable directly
devenv /debugexe R:\_VST_Development_2026\audio-plugin-coder\build\plugins\CloudWash\CloudWash_artefacts\Debug\Standalone\CloudWash.exe
```

**When it crashes:**
1. Visual Studio will break at crash location
2. Note the exact line number
3. Check Call Stack window (Ctrl+Alt+C)
4. Check Locals window to see variable values
5. Share the crash location

## Required Information

**Please provide:**

1. **Exact crash location** (file:line number from debugger)
2. **Call stack** when crash occurs
3. **Variable values** at crash point
4. **Which test above works/fails**

## Next Steps

1. ⏳ **YOU MUST RUN IN DEBUGGER** - I cannot fix without knowing exact crash location
2. ⏳ Try Test 1 (disable Clouds processor)
3. ⏳ Check debug output (which DBG() statements print)
4. ⏳ Analyze crash dump with WinDbg or VS

## Temporary Workaround

None - plugin must be debugged to find root cause.

## Related Issues

- crash-001: nullptr dereference (already fixed)
- performance-001: mutex blocking (already fixed)
- webview-009: slow initialization (different issue)

---
**Last Updated:** 2026-01-29
**Status:** Needs debugger investigation
**Crash Type:** Access Violation (0xc0000005)
**Crash Dump:** C:\CrashDumps\CloudWash.exe.18776.dmp
