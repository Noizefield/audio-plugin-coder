# Silent Effects Chain - JUCE DSP Initialization Bugs

**Issue ID:** dsp-001
**Category:** dsp
**Severity:** critical
**First Detected:** 2026-02-12
**Resolution Status:** solved

---

## Problem Description

Plugin generates audio (confirmed by PRE-FX peak measurement ~1.0) but `effects.process()` outputs complete silence (POST-FX peak = 0.0). The entire effects chain kills the signal.

## Symptoms

- Plugin GUI works, trigger fires, envelopes activate
- DSP chain generates signal internally
- No audio reaches output
- Visualizer shows nothing
- No error messages or crashes

## Root Cause

Three separate JUCE DSP initialization bugs compound to produce silence:

### 1. `ProcessorDuplicator` with Null Coefficients (PRIMARY KILLER)

`juce::dsp::ProcessorDuplicator<IIR::Filter, IIR::Coefficients>` after `prepare()` has null/invalid `state`. Calling `process()` on it silently outputs zeros instead of passing signal through.

### 2. `juce::dsp::Gain` Defaults to Zero

`juce::dsp::Gain<float>` uses an internal `SmoothedValue<float>` which defaults to 0.0 after `prepare()`. This means gain is 0 = signal multiplied by zero = silence.

### 3. `SmoothedValue` Stuck at Zero

`juce::SmoothedValue<float>` defaults to 0.0. `reset()` keeps current=target=0.0. `getCurrentValue()` does NOT advance the ramp (only `getNextValue()` or `skip()` does). So reading it always returns 0.0.

## Solution

### Fix 1: Initialize Filter Coefficients After prepare()

```cpp
// In EffectsChain::prepare():
masterFilter.prepare (spec);
*masterFilter.state = *juce::dsp::IIR::Coefficients<float>::makeLowPass (sampleRate, 20000.0f, 0.707f);

lpgFilter.prepare (spec);
*lpgFilter.state = *juce::dsp::IIR::Coefficients<float>::makeLowPass (sampleRate, 5000.0f, 0.707f);
```

### Fix 2: Set Gain to Unity After prepare()

```cpp
// In EffectsChain::prepare():
preGain.prepare (spec);
preGain.setGainLinear (1.0f);
postGain.prepare (spec);
postGain.setGainLinear (1.0f);

// In prepareToPlay():
masterGain.prepare (spec);
masterGain.setGainLinear (1.0f);
```

### Fix 3: Initialize SmoothedValues with Actual Parameter Values

```cpp
// In prepareToPlay():
smoothedMasterVol.reset (sampleRate, 0.02);
smoothedMasterVol.setCurrentAndTargetValue (apvts.getRawParameterValue ("masterVol")->load());

// In processBlock(), advance before reading:
smoothedMasterVol.skip (buffer.getNumSamples());
masterGain.setGainLinear (smoothedMasterVol.getCurrentValue());
```

## Verification

After applying fixes, stage-by-stage peak measurement confirmed healthy signal flow:

```
FX-CHAIN INPUT:     0.493515  -> signal enters
after preGain:      0.493515  -> unity gain OK
after masterFilter: 0.493758  -> filter passes OK
after distortion:   0.457194  -> tanh shapes OK
after reverb:       0.906250  -> reverb adds tail OK
after compressor:   0.499007  -> compresses OK
after limiter:      0.706802  -> limits OK
after postGain:     0.706802  -> unity gain OK
```

- [x] Audio output confirmed in standalone
- [x] Visualizer displays waveform
- [x] All effects stages pass signal correctly

## Debugging Strategy Used

1. **Test tone injection** - Write 440Hz sine directly to output buffer to confirm audio device works
2. **PRE-FX / POST-FX peak** - Measure signal magnitude before and after effects chain
3. **Stage-by-stage peak logging** - Measure after each individual effect processor
4. **Binary bypass** - Comment out suspect stages to narrow down the culprit

## Related Issues

- `audio-001` - Earlier audio processing issues (mono/delayed response)
- `webview-005` - JUCE WebView bridge API (prerequisite fix)

## Prevention Checklist

For ALL future plugins using JUCE DSP:

- [ ] After `ProcessorDuplicator::prepare()`, ALWAYS set `*filter.state = *Coefficients::make...()`
- [ ] After `Gain::prepare()`, ALWAYS call `setGainLinear(1.0f)`
- [ ] After `SmoothedValue::reset()`, ALWAYS call `setCurrentAndTargetValue(initialValue)`
- [ ] Use `getNextValue()` or `skip(N)` to advance SmoothedValue, never just `getCurrentValue()`
- [ ] Test audio output immediately after implementing effects chain

## Tags

`juce` `dsp` `effects` `initialization` `silence` `ProcessorDuplicator` `Gain` `SmoothedValue`

---

**Created by:** Claude (automated)
**Resolved:** 2026-02-12
**Attempts before resolution:** 4
**Plugin:** XENON
