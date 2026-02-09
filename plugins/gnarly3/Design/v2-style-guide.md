# Style Guide v2 (Swiss Minimal + Filter Graph)

## Color Palette
- **Primary:** #000000 (black)
- **Accent:** #FF0000 (red) - for potential highlights/warnings
- **Background:** #FFFFFF (white)
- **Secondary Text:** #666666 (medium gray)
- **Borders:** #000000 (black)
- **Control Backgrounds:** #FFFFFF (white)
- **Graph Background:** #F8F8F8 (light gray)
- **Graph Elements:** #000000 (black)
- **Graph Fill:** rgba(0, 0, 0, 0.1) (semi-transparent)

## Typography
- **Font Family:** 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
- **Title:** 24px, 700 weight, 0.01em letter-spacing
- **Control Labels:** 14px, 400 weight, centered
- **Value Display:** 12px, 400 weight, tabular-nums, secondary color
- **Line Height:** 1.2 for readability

## Spacing & Layout
- **Window Dimensions:** 400x400px (expanded for graph)
- **Layout Structure:** Vertical stack (title + graph + controls)
- **Grid System:** 3-column control layout with 20px gaps
- **Container Padding:** 32px around all elements
- **Graph Spacing:** 32px gap between graph and controls
- **Control Spacing:** 8px between knob and label
- **Border Width:** 2px solid black throughout
- **Border Radius:** 50% for knobs, none for containers and graph

## Control Specifications
- **Knob Diameter:** 70px
- **Knob Border:** 2px solid black
- **Indicator Line:** 2px width, 25px height, black
- **Rotation Range:** -135° to +135° (270° total travel)
- **Interaction:** Relative drag with 0.5 sensitivity factor

## Graph Specifications
- **Dimensions:** 300x120px
- **Background:** Light gray (#F8F8F8)
- **Grid Lines:** Light gray (#CCCCCC), 1px width
- **Frequency Scale:** Logarithmic (20Hz to 20kHz)
- **Amplitude Scale:** Linear (-24dB to +24dB)
- **Response Curve:** 2px black line
- **Fill Area:** Semi-transparent black under curve
- **Grid Divisions:** 10 frequency points, 4 amplitude levels

## Visual Hierarchy
- **Title:** Largest, boldest element, establishes plugin identity
- **Filter Graph:** Primary visual element, shows filter response
- **Controls:** Interactive elements, grouped below graph
- **Labels:** Clear identification for each control
- **Values:** Secondary information, real-time updates

## Interaction States
- **Hover:** No visual change (minimal design philosophy)
- **Active/Dragging:** Real-time parameter and graph updates
- **Focus:** No focus indicators (native app feel)

## Animation & Transitions
- **Knob Rotation:** Smooth transform updates (no CSS transitions)
- **Graph Updates:** Immediate redraw on parameter change
- **Value Updates:** Instant text updates during interaction

## Design Principles
- **Minimalism:** Reduce to essentials, eliminate ornamentation
- **Clarity:** Every element serves a clear purpose
- **Consistency:** Uniform spacing, typography, and styling
- **Professional:** Clean, technical appearance suitable for audio work
- **Feedback:** Real-time visual response to parameter changes
- **Scalable:** Works well at different sizes and resolutions

## Browser Compatibility
- **CSS Variables:** Used for consistent color theming
- **Flexbox/Grid:** Modern layout systems
- **Canvas API:** For filter response visualization
- **Transform:** Hardware-accelerated for smooth interactions
- **User Select:** Disabled for native app feel

## Performance Considerations
- **Canvas Rendering:** Efficient redraw only when parameters change
- **No Images:** Pure CSS and Canvas for fast loading
- **Minimal DOM:** Simple structure for quick rendering
- **Efficient Updates:** Parameter changes trigger targeted updates
- **No External Dependencies:** Self-contained HTML/CSS/JS

## Accessibility Considerations
- **Color Contrast:** High contrast black/white text
- **Interactive Elements:** Clear visual targets (70px knobs)
- **Real-time Feedback:** Immediate visual response to actions
- **Keyboard Navigation:** (Not implemented - mouse-only design)