# DSP Implementation Plan

## Complexity Assessment
**Score: 2**

**Rationale:** Simple filter with drive, cutoff, resonance. Single-pass implementation sufficient.

## Implementation Strategy
Single-pass implementation - all DSP components implemented in one phase.

## Processing Chain
Input → Drive Gain → Diode Ladder Filter (Cutoff + Resonance) → Output

## Parameters
- drive: Input gain (-24dB to +24dB)
- cutoff: Filter cutoff (20Hz - 20kHz, log)
- resonance: Feedback amount (0.0 - 1.0, maps to Q 0.7 - 50)

## Implementation Steps
1. Add member variables for filter and gain
2. Initialize in prepareToPlay
3. Update parameters in processBlock with smoothing
4. Apply drive gain then filter
5. Test audio processing

## Dependencies
- juce::dsp::IIR::Filter for filter
- juce::dsp::Gain for drive
- juce::SmoothedValue for parameter smoothing