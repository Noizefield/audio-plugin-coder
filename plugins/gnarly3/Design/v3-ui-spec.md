# UI Specification v3 (Swiss Minimal + Improved Layout)

## Design Source
- **Base Design:** swiss-minimal-001 (v1)
- **Iteration:** Added drive control and filter graph (v2)
- **Refinement:** Matched widths, reduced spacing, improved resonance visualization
- **Style:** Clean, geometric, high-contrast

## Layout
- **Window Size:** 400x380px (optimized height)
- **Structure:** Title → Filter Graph → Controls
- **Alignment:** Center-aligned, clean margins
- **Box Matching:** Graph and controls containers have identical width (380px inner)

## Controls Container
- **Width:** 380px (fixed to match graph)
- **Layout:** 3-column grid (Drive, Cutoff, Resonance)
- **Padding:** 24px (reduced from 32px for tighter layout)
- **Gap:** 20px between knobs

## Filter Response Graph
- **Position:** Above controls, centered
- **Size:** 380x120px (matches controls width)
- **Background:** Light gray (#F8F8F8)
- **Grid:** Logarithmic frequency (20Hz-20kHz), linear amplitude (-24dB to +24dB)
- **Curve:** Real-time resonant low-pass filter response
- **Resonance Peak:** Proper Q-factor based peaking at cutoff frequency
- **Fill:** Semi-transparent area under curve

## Spacing Improvements
- **Graph to Controls Gap:** 20px (reduced from 32px)
- **Container Padding:** 24px (reduced from 32px)
- **Overall Height:** More compact layout

## Controls
| Parameter | Type | Position | Range | Default | Layout |
|-----------|------|----------|-------|---------|--------|
| `drive` | Rotary Knob | Left | -24dB - +24dB | 0dB | 70px diameter |
| `cutoff` | Rotary Knob | Center | 20Hz - 20kHz | 1000Hz | 70px diameter |
| `resonance` | Rotary Knob | Right | 0.0 - 1.0 | 0.0 | 70px diameter |

## Control Details
- **Knob Style:** Clean circular design with 2px black border
- **Indicator:** 2px black line, 25px length
- **Rotation Range:** -135° to +135° (270° total)
- **Interaction:** Relative drag (industry standard)
- **Labels:** 14px, centered below knobs
- **Values:** 12px, secondary color, tabular numbers, real-time updates

## Resonance Visualization
- **Algorithm:** State Variable Filter (SVF) topology approximation
- **Q Factor:** Ranges from 1 (no resonance) to 10 (high resonance)
- **Peak Response:** Visible peak at cutoff frequency when resonance > 0
- **Magnitude:** Proper dB scaling with peak amplification

## Color Palette
- **Background:** #FFFFFF (white)
- **Primary Text:** #000000 (black)
- **Secondary Text:** #666666 (gray)
- **Borders:** #000000 (black)
- **Controls:** #FFFFFF (white backgrounds)
- **Graph Background:** #F8F8F8 (light gray)
- **Graph Lines:** #000000 (black)
- **Graph Fill:** rgba(0, 0, 0, 0.1) (semi-transparent black)

## Typography
- **Font Family:** Inter, system fonts
- **Title:** 24px, 700 weight, 0.01em letter-spacing
- **Labels:** 14px, 400 weight
- **Values:** 12px, 400 weight, tabular-nums
- **Graph Labels:** (none - visual only)

## Spacing
- **Comfortable:** 20px (control gaps, graph-to-controls gap)
- **Section:** 24px (title margin, container padding)
- **Small:** 8px (label gaps)

## Interactive Elements
- **Knob Rotation:** Updates parameter values in real-time
- **Graph Update:** Real-time visualization with proper resonance peaking
- **Parameter Display:** Live value updates during interaction

## Style Notes
- Clean, minimal aesthetic inspired by Swiss design
- High contrast black/white palette with subtle graph background
- Geometric precision with exact borders and spacing
- Professional, technical appearance suitable for audio processing
- Real-time visual feedback with accurate filter modeling
- Compact layout maximizes information density
- Resonance properly visualized as frequency response peak