# CloudWash User Manual

**Version 1.0.0**
**Granular Texture Processor**

---

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Interface Overview](#interface-overview)
5. [Processing Modes](#processing-modes)
6. [Parameters Reference](#parameters-reference)
7. [Quality Settings](#quality-settings)
8. [Tips & Tricks](#tips--tricks)
9. [Technical Specifications](#technical-specifications)
10. [Troubleshooting](#troubleshooting)
11. [Credits](#credits)

---

## Introduction

**CloudWash** is a VST portation of the legendary Mutable Instruments Clouds Eurorack module. It transforms incoming audio through four distinct processing modes, creating everything from subtle ambient textures to complex granular soundscapes.
As of now, CloudWash is only available as VST plugin for Windows. MacOS (AU) and Linux version are planned.
The plugin was completele made with the Open Source Framework: AudioPluginCoder (APC) by Noizefield. Check out the GitHub Page for more info on AudioPluginCoder here: https://github.com/Noizefield/audio-plugin-coder


### Key Features

- **4 Processing Modes**: Granular synthesis, pitch shifting, looping delay, and spectral processing
- **13 Real-time Parameters**: Complete control over grain density, size, pitch, and effects
- **20 Factory Presets**: Professional starting points for instant inspiration
- **Up to 8 Seconds Buffer**: Extended audio memory for complex textures
- **Real-time Visualization**: See your grains and audio levels in action
- **Modern WebView Interface**: Clean, responsive, and intuitive design

---

## Installation

### Windows

1. Run the **CloudWash Installer** (`CloudWash-1.0.0-Windows-Setup.exe`)
2. Choose your installation preferences:
   - **VST3 Plugin** (for use in DAWs)
   - **Standalone Application** (optional)
   - **Desktop Shortcut** (optional)
3. Click **Install** (requires administrator privileges)
4. **Restart your DAW** to detect the plugin

### Installation Locations

- **VST3**: `C:\Program Files\Common Files\VST3\CloudWash.vst3`
- **Standalone**: `C:\Program Files\CloudWash\CloudWash.exe`
- **Documentation**: Inside the plugin folder at `CloudWash.vst3\Documentation\`

### System Requirements

- Windows 10 or later (64-bit)
- WebView2 Runtime (automatically installed if needed)
- VST3-compatible DAW (Ableton Live, FL Studio, Reaper, Cubase, etc.)
- Minimum 4GB RAM recommended

---

## Quick Start

### In 60 Seconds

1. **Load CloudWash** into your DAW on an audio track
2. **Select Mode**: Click one of the four mode buttons at the top (start with **GRANULAR**)
3. **Choose a Preset**: Use the preset dropdown to load "Ethereal Cloud" or "Ambient Pad"
4. **Play Audio**: Route audio into CloudWash
5. **Tweak**: Adjust **DENSITY** and **TEXTURE** knobs to taste
6. **Freeze**: Click the **FREEZE** button to capture and loop the current buffer

---

## Interface Overview

CloudWash's interface is organized into logical sections:

### Header
- **Plugin Title**: CLOUDWASH branding
- **Mode Tabs**: Switch between 4 processing modes (GRANULAR, PITCH, DELAY, SPECTRAL)

### Grain Visualization
- **Cloud Animation**: Visual representation of active grains
- Particle movement reflects **DENSITY** parameter
- Particle size/color reflects **TEXTURE** parameter

### Main Control Grid (5×2 layout)

**Top Row:**
- **POSITION**: Playback position in the audio buffer
- **TEXTURE**: Grain randomness and character
- **PITCH**: Pitch shifting (-2 to +2 octaves)
- **DENSITY**: Grain trigger rate
- **FEEDBACK**: Reverb/delay feedback amount

**Bottom Row:**
- **SIZE**: Individual grain duration
- **IN GAIN**: Input signal level
- **BLEND**: Dry/wet mix
- **SPREAD**: Stereo width
- **REVERB**: Reverb effect amount

### Level Meters
- **IN**: Input signal level (left side)
- **OUT**: Output signal level (right side)
- Color-coded: Green (safe), Yellow (hot), Red (clipping)

### Footer Controls
- **Preset Selector**: 20 factory presets
- **Quality Selector**: Buffer size and quality modes
- **FREEZE Button**: Capture and loop current buffer
- **Freeze LED**: Visual indicator when frozen
- **Noizefield Logo**: Click to visit noizefield.com

---

## Processing Modes

CloudWash features four distinct processing engines. Switch modes using the tabs at the top of the interface.

### Mode 0: GRANULAR

**Description**: Classic granular synthesis engine with up to 64 concurrent grains.

**How It Works**: Incoming audio is stored in a circular buffer. The engine generates small "grains" (snippets) from this buffer, with each grain having independent pitch, position, and envelope shape.

**Best For**:
- Ambient textures and soundscapes
- Glitchy rhythmic patterns
- Evolving pads and drones
- Sound design and experimental processing

**Key Parameters**:
- **POSITION**: Where grains are read from the buffer (0% = oldest, 100% = newest)
- **SIZE**: Grain duration (20ms to 500ms, scaled cubically for fine control)
- **DENSITY**: How many grains trigger per second (0-100%)
- **TEXTURE**: Grain randomness and envelope variation

**Try These Presets**: Ethereal Cloud, Grain Storm, Dense Texture, Sparse Grains

---

### Mode 1: PITCH (WSOLA Pitch Shifter)

**Description**: High-quality pitch shifting using Waveform Similarity Overlap-Add (WSOLA) algorithm.

**How It Works**: Analyzes the input signal to find optimal splice points, allowing pitch changes without the "chipmunk" effect of traditional pitch shifters. Uses correlation matching for smooth transitions.

**Best For**:
- Realistic pitch shifting (-2 to +2 octaves)
- Harmonization and doubling
- Creative transposition effects
- Formant-preserving pitch changes

**Key Parameters**:
- **PITCH**: Pitch shift amount (-2.00 to +2.00 semitones, displayed as +/-)
- **SIZE**: Analysis window size (affects quality vs. latency)
- **BLEND**: Dry/wet mix for parallel processing

**Try These Presets**: Pitch Shifter, Octave Up, Octave Down

---

### Mode 2: DELAY (Looping Delay with Pitch)

**Description**: Pitch-shifted delay with tap-tempo sync and crossfaded loops.

**How It Works**: Creates delay loops with independent pitch shifting. Features 64-sample crossfades for smooth loop transitions. Can sync to tempo or run freely.

**Best For**:
- Rhythmic delays and echoes
- Pitch-cascading effects
- Dub-style delay processing
- Creating infinite loops

**Key Parameters**:
- **POSITION**: Delay time/loop point
- **PITCH**: Pitch shift of delayed signal
- **FEEDBACK**: Delay regeneration (0-90%)
- **DENSITY**: Modulation rate of delay time

**Special Feature**: Supports "Feedback" blend mode for self-oscillating delays.

**Try These Presets**: Looping Delay, Pitch Cascade, Resonant Delay

---

### Mode 3: SPECTRAL (Phase Vocoder)

**Description**: FFT-based spectral processing with quantization, warping, and pitch shifting.

**How It Works**: Uses a 4096-point Fast Fourier Transform to analyze and manipulate the frequency spectrum. Can freeze, warp, quantize, and pitch-shift the spectral content independently.

**Best For**:
- Spectral freezing effects
- Frequency-domain manipulation
- Robot/vocoder-style effects
- Surreal ambient textures

**Key Parameters**:
- **PITCH**: Spectral pitch shift
- **TEXTURE**: Spectral warping and quantization
- **DENSITY**: Spectral freeze amount
- **FREEZE**: Locks the spectrum in place

**Try These Presets**: Spectral Wash, Spectral Freeze

---

## Parameters Reference

### POSITION (0-100%)

**Mode-Dependent Behavior**:
- **GRANULAR**: Playback position in buffer (0% = oldest audio, 100% = newest)
- **PITCH/DELAY**: Analysis window position
- **SPECTRAL**: Spectrum analysis position

**Tip**: Automate this parameter for evolving textures that scan through the buffer.

---

### SIZE (0-100%)

**What It Does**: Controls the duration/size of processing windows.

**Mode-Dependent Behavior**:
- **GRANULAR**: Grain size (20ms to 500ms, cubic scaling)
- **PITCH**: Analysis window size (128 to 4096 samples)
- **DELAY**: Loop/delay length
- **SPECTRAL**: FFT window overlap

**Tip**: Larger sizes = smoother/more ambient. Smaller sizes = glitchy/rhythmic.

---

### PITCH (-2.00 to +2.00 octaves)

**What It Does**: Transposes the processed signal up or down.

**Range**:
- **-2.00** = Down 2 octaves
- **0.00** = No change (center position)
- **+2.00** = Up 2 octaves

**Display**: Shows as **+0.00** or **-0.50**, etc.

**Tip**: Combine with BLEND for parallel harmonization effects.

---

### DENSITY (0-100%, displayed as -100% to +100%)

**What It Does**: Controls the rate/amount of grain triggering or modulation.

**Display Format**: Shows deviation from center (50% = 0%)
- **50%** (center) = Normal density = displays as **0%**
- **0%** = Sparse = displays as **-100%**
- **100%** = Maximum = displays as **+100%**

**Tip**: The visualization shows particle speed based on this parameter.

---

### TEXTURE (0-100%)

**What It Does**: Adds randomness and character to the processing.

**Mode-Dependent Behavior**:
- **GRANULAR**: Random variation in grain pitch, position, and envelope
- **PITCH**: Adds formant variation
- **DELAY**: Modulates delay time
- **SPECTRAL**: Adds spectral quantization

**Tip**: Low values = smooth and coherent. High values = chaotic and glitchy.

---

### IN GAIN (0-100%)

**What It Does**: Controls the input signal level before processing.

**Default**: 80%

**Use Cases**:
- Boost quiet signals before processing
- Reduce hot signals to prevent clipping
- Control how much signal enters the buffer

**Tip**: Watch the input meter to avoid clipping (red segments).

---

### BLEND (0-100%)

**What It Does**: Dry/wet mix between original and processed signal.

**Range**:
- **0%** = 100% dry (original signal only)
- **50%** = Equal mix
- **100%** = 100% wet (processed signal only)

**Tip**: Use lower values (20-50%) for subtle texturing. Use high values (80-100%) for full effect processing.

---

### SPREAD (0-100%)

**What It Does**: Controls stereo width of the output.

**Range**:
- **0%** = Mono (centered)
- **50%** = Normal stereo
- **100%** = Maximum stereo width

**Implementation**: Uses grain panning and stereo decorrelation.

**Tip**: Great for creating wide ambient pads. Be careful with high values on mono-summed systems.

---

### FEEDBACK (0-100%)

**What It Does**: Controls regeneration amount for delay and reverb effects.

**Mode-Dependent**:
- **GRANULAR/SPECTRAL**: Reverb feedback
- **DELAY**: Delay regeneration (can self-oscillate at high values)

**Warning**: Values above 90% can cause runaway feedback in Delay mode.

---

### REVERB (0-100%)

**What It Does**: Adds stereo reverb to the output.

**Algorithm**: Dattorro plate reverb (Griesinger topology)
- 4 input diffusers
- 8 main delay lines
- Dual LFOs for modulation

**Tip**: Subtle amounts (10-30%) add space. High amounts (60-100%) create ambient washes.

---

## Quality Settings

CloudWash offers 5 quality modes that balance buffer size, sample rate, and channel configuration:

### Hi-Fi Stereo (1s)
- **Buffer**: 1 second
- **Channels**: Stereo
- **Sample Rate**: 48kHz
- **Best For**: Real-time performance, low latency requirements

### Hi-Fi Mono (2s)
- **Buffer**: 2 seconds
- **Channels**: Mono
- **Sample Rate**: 48kHz
- **Best For**: Longer buffers with pristine quality

### Lo-Fi Stereo (4s)
- **Buffer**: 4 seconds
- **Channels**: Stereo
- **Sample Rate**: 32kHz (vintage mode)
- **Best For**: Lo-fi aesthetics, tape-like character

### Lo-Fi Mono (8s)
- **Buffer**: 8 seconds
- **Channels**: Mono
- **Sample Rate**: 32kHz (vintage mode)
- **Best For**: Maximum buffer time, vintage character

### Ultra HQ (Long)
- **Buffer**: 8 seconds
- **Channels**: Stereo
- **Sample Rate**: 48kHz
- **Best For**: Maximum quality and buffer length (DEFAULT)

**Tip**: Higher quality modes use more CPU. Lower sample rates give vintage character similar to classic hardware samplers.

---

## Tips & Tricks

### Getting Started

1. **Start with Presets**: Don't start from scratch. Load a preset close to what you want, then tweak.

2. **Use FREEZE Creatively**: Hit FREEZE on interesting moments. Great for creating drones from transients.

3. **Automate POSITION**: Slowly sweeping the POSITION knob creates evolving textures that never repeat.

4. **Layer Processing**: Use multiple instances in series for complex effects.

### Mode-Specific Tips

**GRANULAR Mode:**
- Lower DENSITY and larger SIZE = ambient clouds
- Higher DENSITY and smaller SIZE = glitchy rhythms
- Automate TEXTURE for evolving character

**PITCH Mode:**
- Use subtle shifts (±0.10 to ±0.25) for natural doubling
- Blend at 50% for parallel harmonization
- Extreme shifts (±2.00) for creative effects

**DELAY Mode:**
- Set FEEDBACK to 60-70% for rhythmic delays
- Use PITCH for cascading delay effects
- Combine with FREEZE for infinite loops

**SPECTRAL Mode:**
- High TEXTURE creates robotic/vocoder effects
- FREEZE locks the spectrum for sustained tones
- Great for creating surreal atmospheres

### Performance Tips

1. **Monitor CPU Usage**: Ultra HQ mode uses more CPU. Switch to Hi-Fi Stereo if needed.

2. **Use Dry/Wet**: Don't always run 100% wet. Subtle processing (30-50% blend) often sounds better.

3. **Watch Your Meters**: Keep input and output levels in the green/yellow zones. Red = clipping.

4. **Freeze for Transitions**: Hit FREEZE during song transitions to create ambient beds.

### Creative Techniques

**Grain Clouds from Drums:**
- Route drums into CloudWash
- Set MODE to GRANULAR
- SIZE = 30-40%, DENSITY = 60-80%
- FREEZE on kick hits for instant bass drones

**Vocal Textures:**
- Process vocals in SPECTRAL mode
- High TEXTURE for robotic effects
- Low BLEND (20-30%) to keep intelligibility

**Infinite Sustain:**
- FREEZE + high REVERB + high FEEDBACK
- Perfect for guitars and synths
- Creates sustaining, evolving textures

**Rhythmic Stutter:**
- GRANULAR mode, SIZE = 5-10%
- DENSITY = 80-100%
- Sync your DAW playback for rhythmic results

---

## Technical Specifications

### Audio Processing
- **Sample Rates**: 32kHz (vintage), 48kHz (native)
- **Bit Depth**: 32-bit floating point
- **Latency**: Mode-dependent (typically < 10ms)
- **Max Grain Count**: 64 concurrent grains (GRANULAR mode)
- **Buffer Size**: Up to 384,000 samples (8 seconds @ 48kHz)

### DSP Algorithms
- **GRANULAR**: 64-voice grain engine with cubic size scaling, linear interpolation
- **PITCH**: WSOLA (Waveform Similarity Overlap-Add) with 128-4096 sample windows
- **DELAY**: Pitch-shifted loops with 64-sample crossfades, tap-tempo capable
- **SPECTRAL**: 4096-point FFT phase vocoder with quantization and warping

### Effects
- **Reverb**: Dattorro plate topology (4 input diffusers, 8 delay lines, dual LFO modulation)
- **Stereo Processing**: Independent L/R grain panning and stereo width control

### Plugin Formats
- **VST3**: Windows x64
- **Standalone**: Windows x64 application

### Performance
- **CPU Usage**: Mode-dependent, typically 5-15% on modern CPUs
- **RAM Usage**: ~50MB for plugin, plus buffer allocation (max ~3MB for 8-second buffer)

---

## Troubleshooting

### Plugin Not Appearing in DAW

**Problem**: CloudWash doesn't show up in your plugin list.

**Solutions**:
1. **Restart your DAW** completely
2. **Rescan plugin folders** in your DAW preferences
3. **Check installation path**: Should be in `C:\Program Files\Common Files\VST3\CloudWash.vst3`
4. **Verify VST3 folder** is in your DAW's scan paths

---

### No Sound Output

**Problem**: Plugin loads but produces no audio.

**Solutions**:
1. Check **BLEND** knob - should be above 0%
2. Check **IN GAIN** - might be too low
3. Ensure audio is routed **into** the plugin
4. Try loading a preset (it will reset all parameters)
5. Check input/output meters - if input shows signal but output doesn't, try switching modes

---

### Crackling or Glitches

**Problem**: Audio has unwanted clicks or pops.

**Solutions**:
1. **Increase buffer size** in your DAW audio settings
2. Switch to a **lower quality mode** (Hi-Fi Stereo instead of Ultra HQ)
3. **Reduce DENSITY** parameter if in GRANULAR mode
4. Check CPU usage - close other applications if CPU is maxed out

---

### High CPU Usage

**Problem**: Plugin uses too much CPU.

**Solutions**:
1. Switch to **Hi-Fi Stereo (1s)** quality mode
2. Use **Mono modes** instead of Stereo (uses less CPU)
3. **Freeze tracks** when not actively adjusting parameters
4. **Increase DAW buffer size** (512 or 1024 samples)

---

### FREEZE Not Working

**Problem**: FREEZE button doesn't seem to do anything.

**Solutions**:
1. Ensure **audio is playing** - buffer must have content to freeze
2. Check that **BLEND** is not at 0% (you won't hear frozen audio if fully dry)
3. Try switching to **GRANULAR mode** - FREEZE works best there
4. **LED should illuminate** when active - if not, click FREEZE again

---

### WebView2 Installation Failed

**Problem**: Installer says WebView2 is required but installation failed.

**Solutions**:
1. **Download WebView2 manually** from Microsoft:
   https://developer.microsoft.com/microsoft-edge/webview2/
2. Install the **Evergreen Standalone Installer**
3. Run CloudWash installer again

---

### Parameters Not Responding

**Problem**: Turning knobs doesn't change the sound.

**Solutions**:
1. **Check if frozen** - FREEZE locks buffer, some parameters won't have effect
2. **Switch modes** - some parameters only work in certain modes
3. **Reload the plugin** - close and reopen in your DAW
4. **Try a preset** - verifies that parameter changes work

---

### Logo Link Not Opening

**Problem**: Clicking the Noizefield logo doesn't open browser.

**Solutions**:
1. **Check default browser** is set in Windows
2. **Run DAW as administrator** (some DAWs restrict external access)
3. Manually visit: https://noizefield.com

---

## Credits

**CloudWash** is based on the **Mutable Instruments Clouds** Eurorack module by Émilie Gillet.

### Original Hardware
- **Designer**: Émilie Gillet (Mutable Instruments)
- **Original Module**: Clouds (Eurorack granular processor)
- **Source Code**: https://github.com/pichenettes/eurorack

### CloudWash Plugin
- **Development**: Audio Plugin Coder (APC) framework
- **DSP Implementation**: Based on Mutable Instruments open-source code
- **Interface Design**: Modern WebView-based UI with real-time visualization
- **Platform**: JUCE 8 framework

### Libraries & Components
- **JUCE**: Audio plugin framework (https://juce.com)
- **WebView2**: Microsoft Edge WebView2 (https://developer.microsoft.com/microsoft-edge/webview2/)
- **stmlib**: Mutable Instruments DSP library
- **Dattorro Reverb**: Based on Jon Dattorro's plate reverb topology

### License
CloudWash incorporates code from Mutable Instruments, which is released under the MIT License. The Mutable Instruments code is copyright Émilie Gillet.

---

## Support & Resources

### Website
Visit **https://noizefield.com** for:
- Latest version downloads
- Community

### Documentation
- **User Manual**: This document
- **License**: See LICENSE.txt in installation folder
- **Changelog**: See CHANGELOG.md for version history

### Community
Join the discussion and share your CloudWash creations!

---

**Version 1.0.0** - January 2026
**© 2026 Noizefield** - https://noizefield.com

**Enjoy CloudWash!** 🎛️☁️
