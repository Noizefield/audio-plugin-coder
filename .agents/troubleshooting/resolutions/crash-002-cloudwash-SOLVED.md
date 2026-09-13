# CRASH-002: CloudWash Clouds Processor Initialization Crash - IDENTIFIED

**Status:** ROOT CAUSE IDENTIFIED ✅
**Category:** Clouds DSP Initialization
**Severity:** CRITICAL
**Date Identified:** 2026-01-30
**Plugin:** CloudWash

## Root Cause: CONFIRMED

**The crash is in the Clouds processor initialization** - specifically in one of these calls:

1. `processor.Init(block_mem.data(), block_mem.size(), block_ccm.data(), block_ccm.size())`
2. `processor.Prepare()`
3. `inputResamplers[i].Init()` or `outputResamplers[i].Init()`

## Test Results Proof

### Test 1: With Clouds Enabled
```
Result: CRASH (Access Violation 0xc0000005)
PluginVal: FAILED/TIMEOUT
Standalone: CRASHED
```

### Test 2: With Clouds Disabled (Option 2 Test)
```
Result: SUCCESS ✅
PluginVal: PASSED (5 seconds)
Standalone: LOADED SUCCESSFULLY
UI: Appeared and functional
```

**This proves:** Everything else works fine (APVTS, parameters, WebView, editor, presets). Only Clouds initialization crashes.

## Likely Specific Causes

### 1. Memory Buffer Alignment Issue (MOST LIKELY)

The Clouds processor may expect specific memory alignment:

```cpp
// PluginProcessor.cpp line 24-27
const int memLen = 118784;
const int ccmLen = 65536 - 128;
block_mem.resize(memLen, 0);
block_ccm.resize(ccmLen, 0);

// This might not be aligned properly for Clouds
processor.Init(block_mem.data(), block_mem.size(),
               block_ccm.data(), block_ccm.size());
```

**Possible issue:** `std::vector<uint8_t>` doesn't guarantee alignment. Clouds might expect 16-byte or 32-byte alignment.

**Fix:** Use aligned allocation:

```cpp
// Replace std::vector<uint8_t> with aligned buffer
std::vector<uint8_t> block_mem;
std::vector<uint8_t> block_ccm;

// WITH:
alignas(32) std::array<uint8_t, 118784> block_mem;
alignas(32) std::array<uint8_t, 65408> block_ccm;

// OR use juce::AudioBuffer which is aligned
```

### 2. Incorrect Buffer Sizes

VCV Rack uses slightly different sizes or initialization order:

```cpp
// Current:
const int memLen = 118784;
const int ccmLen = 65536 - 128;  // = 65408

// Check VCV Rack Clouds.cpp for exact sizes
// May need different sizes or initialization sequence
```

### 3. Sample Rate Converter Template Parameters Wrong

```cpp
// PluginProcessor.h line 100-101
clouds::SampleRateConverter<-2, 45, clouds::src_filter_1x_2_45> inputResamplers[2];
clouds::SampleRateConverter<+2, 45, clouds::src_filter_1x_2_45> outputResamplers[2];
```

**The template parameters might be incorrect:**
- Ratio: -2 and +2 might be wrong
- Filter size: 45 might be wrong
- Filter type: `src_filter_1x_2_45` might not match ratio

**Need to check** VCV Rack source to see exact template parameters used.

### 4. Init() Call Before APVTS Ready

Clouds processor is initialized in constructor before APVTS is fully constructed:

```cpp
CloudWashAudioProcessor::CloudWashAudioProcessor()
    : AudioProcessor (/* ... */),
      apvts (*this, nullptr, "Parameters", createParameterLayout())  // APVTS constructor
{
    // Clouds Init() called here - might access APVTS too early?
    processor.Init(...);
}
```

**Unlikely** but possible if Clouds processor tries to access host parameters during Init().

## Next Steps to Fix

### Step 1: Check VCV Rack Clouds Implementation

Look at `plugins/CloudWash/Org_Code/AudibleInstruments-2/src/Clouds.cpp`:

```cpp
// Find the exact:
// 1. Buffer sizes
// 2. Init() call sequence
// 3. Sample rate converter template parameters
// 4. Memory alignment requirements
```

### Step 2: Try Aligned Memory Allocation

Modify `PluginProcessor.h`:

```cpp
// Replace:
std::vector<uint8_t> block_mem;
std::vector<uint8_t> block_ccm;

// With:
alignas(32) uint8_t block_mem[118784];
alignas(32) uint8_t block_ccm[65408];
```

### Step 3: Try Different Init Sequence

VCV Rack might call Init() differently:

```cpp
// Try this sequence:
processor.Init(block_mem, sizeof(block_mem), block_ccm, sizeof(block_ccm));
processor.set_playback_mode(clouds::PLAYBACK_MODE_GRANULAR);
processor.set_quality(0);
// DON'T call Prepare() yet
// processor.Prepare();  // Try commenting this out
```

### Step 4: Check Sample Rate Converter

Try disabling sample rate conversion entirely and run at 32kHz:

```cpp
// In prepareToPlay:
void prepareToPlay(double sampleRate, int samplesPerBlock) {
    // Force 32kHz internal rate
    // Comment out sample rate converter Init()

    processor.Prepare();  // Call only once here, not in constructor
}
```

### Step 5: Run with Debugger (RECOMMENDED)

Even though we know it's Clouds Init(), we need the EXACT line:

```powershell
devenv /debugexe "R:\_VST_Development_2026\audio-plugin-coder\build\plugins\CloudWash\CloudWash_artefacts\Debug\Standalone\CloudWash.exe"
```

**Uncomment the Clouds Init() code and run in debugger.**

It will break on the exact line that crashes, showing which of these is the problem:
- `processor.Init()`
- `processor.set_playback_mode()`
- `processor.Prepare()`
- Sample rate converter `Init()`

## Files to Check

1. **VCV Rack Reference:**
   - `plugins/CloudWash/Org_Code/AudibleInstruments-2/src/Clouds.cpp`
   - Look for exact buffer sizes and Init() sequence

2. **Clouds Source:**
   - `plugins/CloudWash/Source/dsp/clouds/dsp/granular_processor.h`
   - Check Init() requirements

3. **Sample Rate Converter:**
   - `plugins/CloudWash/Source/dsp/clouds/dsp/sample_rate_converter.h`
   - Check template parameter requirements

## Temporary State

Currently the plugin is in TEST MODE:
- ✅ Loads successfully
- ✅ UI works
- ❌ No audio processing (all commented out)

To fix, need to:
1. Identify exact crash line in Clouds Init()
2. Fix the initialization issue
3. Re-enable Clouds processor
4. Test again

## Success Criteria

- ✅ Plugin loads with Clouds enabled
- ✅ No crash in Init() or Prepare()
- ✅ PluginVal passes all tests
- ✅ Audio processing works

---
**Last Updated:** 2026-01-30
**Status:** Root cause identified, specific fix needed
**Test Result:** Plugin works WITHOUT Clouds, crashes WITH Clouds
**Action Required:** Debug exact crash line in Clouds Init() or try memory alignment fix
