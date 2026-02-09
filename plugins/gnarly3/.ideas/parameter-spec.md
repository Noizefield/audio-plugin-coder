# NF Gnarly - Parameter Specification

## Core Parameters

| ID | Name | Type | Range | Default | Unit | Description |
|----|------|------|-------|---------|------|-------------|
| `drive` | Drive | Float | -24.0 - 24.0 | 0.0 | dB | Input gain applied before filtering (linear) |
| `cutoff` | Cutoff Frequency | Float | 20.0 - 20000.0 | 1000.0 | Hz | Filter cutoff frequency (logarithmic) |
| `resonance` | Resonance | Float | 0.0 - 1.0 | 0.0 | - | Resonance amount (0.0 = subtle, 1.0 = self-oscillation) |
## Parameter Behavior

### Drive

- **Range**: -24dB to +24dB

- **Scaling**: Linear (dB)

- **Default**: 0.0dB (unity gain)

- **Smoothing**: Required to prevent zipper noise

- **Units**: Decibels

### Cutoff Frequency

- **Range**: 20Hz to 20kHz
- **Scaling**: Logarithmic (2 decades per octave)
- **Default**: 1000Hz (1kHz)
- **Smoothing**: Required to prevent zipper noise
- **Units**: Hertz

### Resonance
- **Range**: 0.0 to 1.0
- **Scaling**: Linear
- **Default**: 0.0 (subtle resonance)
- **Behavior**: At maximum (1.0), filter enters self-oscillation
- **Units**: Normalized (0-1)

## Technical Requirements

### Real-Time Safety
- All parameters must be smoothed for audio thread use
- No memory allocation in audio processing
- Lock-free parameter updates

### Parameter Persistence
- Parameters saved with plugin state
- Recallable presets
- Automation compatible

## Future Expansion
- No additional parameters planned
- Maintains two-knob simplicity philosophy