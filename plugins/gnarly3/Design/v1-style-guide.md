# Style Guide v1 (Based on Swiss Minimal)

## Color Palette
- **Primary:** #000000 (black)
- **Accent:** #FF0000 (red) - for potential highlights/warnings
- **Background:** #FFFFFF (white)
- **Secondary Text:** #666666 (medium gray)
- **Borders:** #000000 (black)
- **Control Backgrounds:** #FFFFFF (white)

## Typography
- **Font Family:** 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Title:** 24px, 700 weight, 0.01em letter-spacing
- **Control Labels:** 14px, 400 weight, centered
- **Value Display:** 12px, 400 weight, tabular-nums, secondary color
- **Line Height:** 1.2 for readability

## Spacing & Layout
- **Window Dimensions:** 400x300px (compact but spacious)
- **Grid System:** 2x2 control layout with 20px gaps
- **Container Padding:** 32px around controls
- **Control Spacing:** 8px between knob and label
- **Border Width:** 2px solid black throughout
- **Border Radius:** 50% for knobs, none for containers

## Control Specifications
- **Knob Diameter:** 70px
- **Knob Border:** 2px solid black
- **Indicator Line:** 2px width, 25px height, black
- **Rotation Range:** -135° to +135° (270° total travel)
- **Interaction:** Relative drag with 0.5 sensitivity factor

## Visual Hierarchy
- **Title:** Largest, boldest element, establishes plugin identity
- **Controls:** Primary interactive elements, equal visual weight
- **Labels:** Clear identification for each control
- **Values:** Secondary information, smaller and less prominent

## Interaction States
- **Hover:** No visual change (minimal design philosophy)
- **Active/Dragging:** No visual feedback (clean interaction)
- **Focus:** No focus indicators (native app feel)

## Design Principles
- **Minimalism:** Reduce to essentials, eliminate ornamentation
- **Clarity:** Every element serves a clear purpose
- **Consistency:** Uniform spacing, typography, and styling
- **Professional:** Clean, technical appearance suitable for audio work
- **Scalable:** Works well at different sizes and resolutions

## Browser Compatibility
- **CSS Variables:** Used for consistent color theming
- **Flexbox/Grid:** Modern layout systems
- **Transform:** Hardware-accelerated for smooth interactions
- **User Select:** Disabled for native app feel

## Performance Considerations
- **No Images:** Pure CSS for fast loading
- **Minimal DOM:** Simple structure for quick rendering
- **Efficient Animations:** Transform-based for GPU acceleration
- **No External Dependencies:** Self-contained HTML/CSS/JS