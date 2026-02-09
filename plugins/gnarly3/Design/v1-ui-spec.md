# UI Specification v1 (Based on Swiss Minimal)

## Design Source
- **Library Design:** swiss-minimal-001
- **ID:** swiss-minimal-001
- **Style:** Clean, geometric, high-contrast

## Layout
- **Window Size:** 400x300px (compact, professional)
- **Grid:** 2x2 control grid with comfortable spacing
- **Sections:** Title + Controls container
- **Alignment:** Center-aligned, clean margins

## Controls
| Parameter | Type | Position | Range | Default | Layout |
|-----------|------|----------|-------|---------|--------|
| `cutoff` | Rotary Knob | Top-left | 20Hz - 20kHz | 1000Hz | 70px diameter |
| `resonance` | Rotary Knob | Top-right | 0.0 - 1.0 | 0.0 | 70px diameter |

## Control Details
- **Knob Style:** Clean circular design with 2px black border
- **Indicator:** 2px black line, 25px length
- **Rotation Range:** -135° to +135° (270° total)
- **Interaction:** Relative drag (industry standard)
- **Labels:** 14px, centered below knobs
- **Values:** 12px, secondary color, tabular numbers

## Color Palette
- **Background:** #FFFFFF (white)
- **Primary Text:** #000000 (black)
- **Secondary Text:** #666666 (gray)
- **Borders:** #000000 (black)
- **Controls:** #FFFFFF (white backgrounds)

## Typography
- **Font Family:** Inter, system fonts
- **Title:** 24px, 700 weight, 0.01em letter-spacing
- **Labels:** 14px, 400 weight
- **Values:** 12px, 400 weight, tabular-nums

## Spacing
- **Comfortable:** 20px (control gaps)
- **Section:** 32px (title margin, container padding)
- **Small:** 8px (label gaps)

## Style Notes
- Clean, minimal aesthetic inspired by Swiss design
- High contrast black/white palette
- Geometric precision with exact borders and spacing
- Professional, utility-focused appearance
- Suitable for technical audio processing plugins
- Maintains clarity and readability at small sizes