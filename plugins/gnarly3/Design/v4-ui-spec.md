# UI Specification v4 (Swiss Minimal + Extreme Resonance)

## Design Source
- **Base Design:** swiss-minimal-001 (v1)
- **Evolution:** Added drive control and filter graph (v2-v3)
- **Refinement:** Extreme resonance peaking, improved drive visualization
- **Style:** Clean, geometric, high-contrast

## Layout
- **Window Size:** 400x380px (optimized height)
- **Structure:** Title → Filter Graph → Controls
- **Alignment:** Center-aligned, clean margins
- **Box Matching:** Graph and controls containers have identical width (380px inner)

## Resonance Visualization
- **Algorithm:** Analog second-order low-pass with extreme Q factor
- **Q Range:** Resonance 0.0 → Q:0.7 (flat), Resonance 1.0 → Q:50 (extremely peaky)
- **Peak Behavior:** Sharp, narrow resonance peak at cutoff frequency
- **Maximum Resonance:** Spiky, self-oscillating appearance at max setting
- **Zero Resonance:** Completely flat low-pass response (no peaking)

## Drive Visualization
- **Effect:** Linear gain applied to entire frequency response
- **Range:** -24dB to +24dB boost/cut
- **Visualization:** Vertical shift of entire response curve
- **Real-time:** Immediate visual feedback when adjusting drive

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
- **Curve:** Real-time extreme resonant low-pass filter response
- **Resonance Peak:** Extremely narrow and tall at maximum resonance
- **Drive Effect:** Vertical translation of entire curve
- **Fill:** Semi-transparent area under curve

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

## Interactive Elements
- **Resonance Knob:** Extreme peaking from flat (0.0) to spiky (1.0)
- **Cutoff Knob:** Shifts peak frequency horizontally
- **Drive Knob:** Shifts entire curve vertically
- **Graph Update:** Real-time visualization with proper analog behavior

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

## Style Notes
- Clean, minimal aesthetic inspired by Swiss design
- High contrast black/white palette with subtle graph background
- Geometric precision with exact borders and spacing
- Professional, technical appearance suitable for audio processing
- Extreme resonance peaking for educational analog filter behavior
- Real-time visual feedback with accurate parameter relationships
- Drive level clearly visualized as vertical curve translation