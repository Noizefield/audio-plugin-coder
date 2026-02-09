# UI Specification v2 (Swiss Minimal + Filter Graph)

## Design Source
- **Base Design:** swiss-minimal-001 (v1)
- **Iteration:** Added filter response graph and drive control
- **Style:** Clean, geometric, high-contrast

## Layout
- **Window Size:** 400x400px (expanded for graph)
- **Structure:** Title → Filter Graph → Controls
- **Grid:** 3-column control layout (Drive, Cutoff, Resonance)
- **Alignment:** Center-aligned, clean margins

## Controls
| Parameter | Type | Position | Range | Default | Layout |
|-----------|------|----------|-------|---------|--------|
| `drive` | Rotary Knob | Left | -24dB - +24dB | 0dB | 70px diameter |
| `cutoff` | Rotary Knob | Center | 20Hz - 20kHz | 1000Hz | 70px diameter |
| `resonance` | Rotary Knob | Right | 0.0 - 1.0 | 0.0 | 70px diameter |

## Filter Response Graph
- **Position:** Above controls, centered
- **Size:** 300x120px
- **Background:** Light gray (#F8F8F8)
- **Grid:** Logarithmic frequency (20Hz-20kHz), linear amplitude (-24dB to +24dB)
- **Curve:** Real-time filter response visualization
- **Fill:** Semi-transparent area under curve

## Control Details
- **Knob Style:** Clean circular design with 2px black border
- **Indicator:** 2px black line, 25px length
- **Rotation Range:** -135° to +135° (270° total)
- **Interaction:** Relative drag (industry standard)
- **Labels:** 14px, centered below knobs
- **Values:** 12px, secondary color, tabular numbers, real-time updates

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
- **Comfortable:** 20px (control gaps)
- **Section:** 32px (title margin, container padding, graph spacing)
- **Small:** 8px (label gaps)

## Interactive Elements
- **Knob Rotation:** Updates parameter values in real-time
- **Graph Update:** Real-time visualization of filter response
- **Parameter Display:** Live value updates during interaction

## Style Notes
- Clean, minimal aesthetic inspired by Swiss design
- High contrast black/white palette with subtle graph background
- Geometric precision with exact borders and spacing
- Professional, technical appearance suitable for audio processing
- Real-time visual feedback enhances user experience
- Maintains clarity and readability at larger size
- Filter graph provides immediate visual feedback for parameter changes