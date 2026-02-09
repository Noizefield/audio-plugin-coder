# Style Guide v4 (Swiss Minimal + Extreme Resonance)

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
- **Window Dimensions:** 400x380px (more compact)
- **Layout Structure:** Vertical stack (title + graph + controls)
- **Container Matching:** Graph and controls have identical 380px width
- **Grid System:** 3-column control layout with 20px gaps
- **Container Padding:** 24px (reduced for tighter layout)
- **Graph Spacing:** 20px gap between graph and controls (reduced)
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
- **Dimensions:** 380x120px (matches controls container width)
- **Background:** Light gray (#F8F8F8)
- **Grid Lines:** Light gray (#CCCCCC), 1px width
- **Frequency Scale:** Logarithmic (20Hz to 20kHz)
- **Amplitude Scale:** Linear (-24dB to +24dB)
- **Response Curve:** 2px black line with extreme resonance peaking
- **Fill Area:** Semi-transparent black under curve
- **Grid Divisions:** 10 frequency points, 4 amplitude levels
- **Resonance Algorithm:** Analog second-order low-pass with Q:0.7-50

## Resonance Visualization (v4 Enhancement)
- **Q Factor Range:** 0.7 (flat) to 50 (extremely peaky)
- **Peak Sharpness:** Extremely narrow bandwidth at high resonance
- **Self-Oscillation:** Visually approaches infinity at maximum resonance
- **Zero Resonance:** Perfectly flat low-pass response (no artifacts)
- **Real-time Behavior:** Instant visual feedback with analog accuracy

## Drive Visualization (v4 Enhancement)
- **Linear Gain:** dB values converted to linear multiplication
- **Curve Translation:** Entire frequency response shifts vertically
- **Range Effect:** -24dB (curve drops) to +24dB (curve rises)
- **Visual Clarity:** Obvious level changes in graph display

## Visual Hierarchy
- **Title:** Largest, boldest element, establishes plugin identity
- **Filter Graph:** Primary visual element with dynamic behavior
- **Controls:** Interactive elements controlling the graph
- **Labels:** Clear identification for each control
- **Values:** Secondary information, real-time updates

## Interaction States
- **Hover:** No visual change (minimal design philosophy)
- **Active/Dragging:** Real-time parameter and graph updates
- **Focus:** No focus indicators (native app feel)

## Animation & Transitions
- **Knob Rotation:** Smooth transform updates (no CSS transitions)
- **Graph Updates:** Immediate redraw with extreme resonance calculation
- **Value Updates:** Instant text updates during interaction

## Design Principles
- **Minimalism:** Reduce to essentials, eliminate ornamentation
- **Clarity:** Every element serves a clear purpose
- **Consistency:** Uniform spacing, typography, and styling
- **Professional:** Clean, technical appearance suitable for audio work
- **Feedback:** Real-time visual response to parameter changes
- **Accuracy:** Proper analog filter modeling for educational value
- **Extremes:** Demonstrate full range of filter behavior

## Browser Compatibility
- **CSS Variables:** Used for consistent color theming
- **Flexbox/Grid:** Modern layout systems
- **Canvas API:** For real-time filter visualization
- **Transform:** Hardware-accelerated for smooth interactions
- **Math Functions:** For accurate extreme filter response calculation
- **User Select:** Disabled for native app feel

## Performance Considerations
- **Canvas Rendering:** Efficient redraw only when parameters change
- **Mathematical Accuracy:** Proper extreme filter response calculation
- **No Images:** Pure CSS and Canvas for fast loading
- **Minimal DOM:** Simple structure for quick rendering
- **Efficient Updates:** Parameter changes trigger targeted updates
- **No External Dependencies:** Self-contained HTML/CSS/JS

## Resonance Behavior (v4 Key Feature)
- **Minimum (0.0):** Q=0.7, perfectly flat low-pass response
- **Low (0.2):** Q=10, subtle peaking begins
- **Medium (0.5):** Q=25, noticeable resonance peak
- **High (0.8):** Q=40, sharp, narrow peak
- **Maximum (1.0):** Q=50, extremely spiky, self-oscillating appearance

## Layout Improvements (v4)
- **Width Matching:** Graph and controls containers now identical width
- **Reduced Spacing:** Tighter vertical layout saves space
- **Better Proportion:** More balanced visual weight distribution
- **Extreme Resonance:** Proper analog-style peaking behavior
- **Drive Visualization:** Clear level changes in frequency response