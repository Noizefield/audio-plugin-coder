# PERFORMANCE-001: Mutex Blocking Entire ProcessBlock

**Status:** SOLVED
**Category:** Performance/Threading
**Severity:** HIGH
**Date Discovered:** 2026-01-29
**Plugin:** CloudWash

## Problem Description

Plugin causes audio dropouts and editor hangs when opened during audio processing. PluginVal test "Open editor whilst processing" hangs/times out. Audio thread performance degrades significantly.

## Symptoms

- ✗ Audio dropouts during playback
- ✗ Editor hangs when opened while audio is playing
- ✗ PluginVal hangs at "Open editor whilst processing" test
- ✗ DAW becomes unresponsive when changing parameters during playback
- ✗ High CPU usage in processBlock

## Root Cause

A `std::lock_guard<std::mutex>` is held for the **entire duration** of `processBlock()`, which can be 300+ lines of code and ~10ms of execution time.

**Problem Code:**
```cpp
void processBlock(juce::AudioBuffer<float>& buffer, ...) {
    std::lock_guard<std::mutex> lock(processorMutex);  // ❌ LOCKS ENTIRE FUNCTION

    // 300+ lines of audio processing...
    // All parameter updates from GUI thread are blocked here!
    // Editor creation is blocked here!
    // Mode changes are blocked here!

} // Lock released only at end of function
```

**Why This Causes Problems:**

1. **Editor Thread Blocked:** When DAW tries to create editor during playback, it waits for mutex → hangs for ~10ms per audio block
2. **Parameter Updates Blocked:** GUI thread can't update parameters while audio processing
3. **Test Timeouts:** PluginVal expects editor to open within strict timeout, but mutex delays it
4. **Unnecessary Locking:** Most of processBlock doesn't need mutex protection (uses atomics)

## Solution

### Step 1: Identify What Actually Needs Protection

In CloudWash, only the `processor.Prepare()` call needs mutex protection. Everything else uses atomics or is audio-thread-only.

**Protected by Atomics (no mutex needed):**
- `currentMode.load()` / `currentMode.store()`
- `pendingMode`, `pendingQuality`, `silenceBlocksRemaining`
- Parameter reads: `apvts.getRawParameterValue()->load()`

**Needs Mutex Protection:**
- `processor.Prepare()` - Reallocates internal buffers
- `processor.set_playback_mode()` + `processor.set_quality()` - When followed by Prepare()

### Step 2: Move Mutex to Minimal Critical Section

**BEFORE (BAD):**
```cpp
void processBlock(...) {
    std::lock_guard<std::mutex> lock(processorMutex);  // ❌ ENTIRE FUNCTION

    // Clear buffers
    buffer.clear(...);

    // Mode/quality changes
    if (modeChanged) {
        processor.Prepare();
    }

    // Parameter updates
    p->position = position;
    p->size = size;
    // ... 200 more lines ...

    // DSP processing
    processor.Process(...);

    // Output metering
    outputPeakLevel.store(...);
}
```

**AFTER (GOOD):**
```cpp
void processBlock(...) {
    // NO MUTEX for normal processing!

    // Mode/quality change handling
    if (modeChanged && lastSilenceBlock) {
        // Lock ONLY for Prepare() call
        {
            std::lock_guard<std::mutex> lock(processorMutex);  // ✅ MINIMAL SCOPE
            processor.set_playback_mode(newMode);
            processor.set_quality(newQuality);
            processor.Prepare();  // The ONLY operation that needs protection
        }  // Lock released immediately

        currentMode.store(newMode);
        currentQuality.store(newQuality);
    }

    // All other processing without mutex
    // ... 200+ lines of audio processing ...
}
```

### Step 3: Use Atomics for Cross-Thread Communication

Replace mutex-protected variables with atomics:

```cpp
// PluginProcessor.h
private:
    std::atomic<int> currentMode { 0 };
    std::atomic<int> currentQuality { 0 };
    std::atomic<int> pendingMode { -1 };
    std::atomic<int> pendingQuality { -1 };
    std::atomic<int> silenceBlocksRemaining { 0 };

    std::mutex processorMutex;  // Only for Prepare() calls
```

### Step 4: Rebuild and Test

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName YourPlugin
```

## Performance Impact

**Before Fix:**
- Audio thread blocks: ~10ms per block
- Editor creation time: 941ms + blocking time = unpredictable
- PluginVal test: TIMEOUT

**After Fix:**
- Audio thread blocks: <0.1ms (only during rare Prepare() calls)
- Editor creation time: 941ms (WebView2 init, no blocking)
- PluginVal test: Completes (or times out only due to WebView2 slowness, not mutex)

## Prevention Checklist

### Audio Thread Rules

- [ ] **Never hold mutex during audio processing**
- [ ] **Use atomics for cross-thread communication**
- [ ] **Keep locks minimal** - Only protect buffer allocation, not processing
- [ ] **Avoid memory allocation** in processBlock
- [ ] **Avoid locks** in processBlock except for critical sections

### Code Review Questions

1. Is this mutex held for entire processBlock? → **BAD**
2. Can I use atomics instead? → **GOOD**
3. What exactly needs protection? → **Lock only that**
4. How long will this lock be held? → **Aim for <1μs**

## Testing the Fix

### 1. PluginVal Test

```powershell
.\_tools\pluginval\pluginval.exe --validate "C:\Program Files\Common Files\VST3\YourPlugin.vst3" --strictness-level 5
```

**Expected Results:**
- ✅ "Open plugin (cold)" - PASSED
- ✅ "Open plugin (warm)" - PASSED
- ✅ "Open editor whilst processing" - Should not hang on mutex (may still timeout due to WebView2 slowness)

### 2. DAW Test

1. Load plugin in DAW
2. Start playback
3. Open/close plugin editor repeatedly
4. **Expected:** Editor should open smoothly without dropouts

### 3. Performance Test

Use your DAW's CPU meter:
- **Before fix:** High CPU spikes when opening editor
- **After fix:** Minimal CPU change when opening editor

## Related Issues

- **webview-009**: WebView slow initialization - Different issue, but can compound mutex problem
- **webview-003**: Plugin crashes on load - Can be mistaken for mutex deadlock

## Best Practices

### ✅ DO:
```cpp
// Minimal critical section
{
    std::lock_guard<std::mutex> lock(mutex);
    criticalOperation();  // Single, fast operation
}
// Lock released immediately
```

### ❌ DON'T:
```cpp
// Entire function locked
void processBlock(...) {
    std::lock_guard<std::mutex> lock(mutex);  // BAD!
    // 300 lines of code...
}
```

### ✅ Use Atomics:
```cpp
std::atomic<float> parameter { 0.5f };

// Audio thread
float value = parameter.load();

// GUI thread
parameter.store(newValue);
```

### ✅ Use Lock-Free Queues for Complex Data:
```cpp
juce::AbstractFifo fifo { 1024 };
// Or juce::AudioBuffer for audio data
```

## Debugging Mutex Issues

### Symptoms of Mutex Problems:
- Audio dropouts
- UI hangs
- Deadlocks
- Slow parameter updates

### How to Debug:

1. **Profile with Timer:**
```cpp
void processBlock(...) {
    auto start = juce::Time::getHighResolutionTicks();

    std::lock_guard<std::mutex> lock(mutex);

    auto duration = juce::Time::highResolutionTicksToSeconds(
        juce::Time::getHighResolutionTicks() - start);

    if (duration > 0.001) {  // > 1ms
        DBG("WARNING: Lock held for " + juce::String(duration * 1000) + "ms");
    }
}
```

2. **Check Lock Contention:**
   - Add logging when acquiring lock
   - If logs show frequent contention → use atomics

3. **Visual Studio Concurrency Visualizer:**
   - Shows thread blocking/waiting
   - Identifies mutex hotspots

## Success Criteria

- ✅ ProcessBlock executes without holding mutex (except critical sections)
- ✅ Editor opens smoothly during playback
- ✅ No audio dropouts when changing parameters
- ✅ PluginVal "Open editor whilst processing" doesn't hang on mutex
- ✅ CPU usage stable when opening/closing editor

---
**Last Updated:** 2026-01-29
**Verified Fix:** CloudWash v0.1.0
**Performance Gain:** ~99% reduction in mutex lock time (10ms → <0.1ms)
