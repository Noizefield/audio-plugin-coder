# Plugin Development Lifecycle

Complete guide to the APC plugin development workflow from initial concept to shipped product.

## Overview

APC uses a structured five-phase workflow that guides you through the entire plugin development process. Each phase has specific inputs, outputs, and validation criteria.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLUGIN DEVELOPMENT LIFECYCLE                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  💭 DREAM          📋 PLAN          🎨 DESIGN                   │
│  Ideation          Architecture     GUI Design                   │
│  ├─ Concept        ├─ DSP Design    ├─ Mockups                   │
│  ├─ Parameters     ├─ Framework     ├─ Style Guide               │
│  └─ State Init     └─ Complexity    └─ Preview                   │
│                                                                  │
│       ↓                 ↓                ↓                       │
│                                                                  │
│  💻 IMPLEMENT       🚀 SHIP           ✅ COMPLETE                │
│  Coding             Distribution      Done!                      │
│  ├─ DSP Engine      ├─ Local Build    ├─ Released                │
│  ├─ UI Binding      ├─ CI/CD Build    └─ Maintained              │
│  └─ Testing         └─ Installers                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: DREAM (Ideation)

### Purpose
Transform a vague idea into a concrete plugin concept with defined parameters.

### Trigger
```
/dream MyPlugin
```

### Activities

1. **Concept Definition**
   - Sonic character (warm, clean, dirty, etc.)
   - Plugin category (EQ, compressor, reverb, etc.)
   - Target use case (mixing, mastering, creative)

2. **Parameter Specification**
   - Identify top 3-5 parameters
   - Define ranges and defaults
   - Determine parameter types (linear, logarithmic, etc.)

3. **Visual Direction**
   - Aesthetic style (minimal, skeuomorphic, cyberpunk)
   - Color palette ideas
   - Layout preferences

### Inputs
- User's plugin idea (natural language)
- Optional: Reference plugins, audio examples

### Outputs

```
plugins/MyPlugin/
├── .ideas/
│   ├── creative-brief.md      # Vision and concept
│   └── parameter-spec.md      # Parameter definitions
└── status.json                # Initialized state
```

**creative-brief.md:**
```markdown
# MyPlugin Creative Brief

## Hook
One-sentence marketing pitch

## Description
Detailed behavior and character

## Sonic Character
- Warmth: High/Medium/Low
- Clarity: High/Medium/Low
- Character: Clean/Colorful/Distorted

## Use Cases
1. Primary use case
2. Secondary use case

## References
- Plugin A (for character)
- Plugin B (for workflow)
```

**parameter-spec.md:**
```markdown
# Parameter Specification

| ID | Name | Type | Range | Default | Unit |
|:---|:-----|:-----|:------|:--------|:-----|
| gain | Gain | Float | 0.0-1.0 | 0.5 | dB |
| ... | ... | ... | ... | ... | ... |
```

### Validation Criteria
- [ ] Creative brief exists and is complete
- [ ] Parameter spec exists with all required fields
- [ ] At least 1 parameter defined
- [ ] State initialized correctly

### Completion State
```json
{
  "current_phase": "ideation_complete",
  "validation": {
    "creative_brief_exists": true,
    "parameter_spec_exists": true
  }
}
```

### Common Pitfalls
- **Too many parameters** - Start with 3-5, add more later
- **Vague descriptions** - Be specific about sonic character
- **Missing ranges** - Always define min/max/default values

---

## Phase 2: PLAN (Architecture)

### Purpose
Design the DSP architecture and select the appropriate UI framework.

### Trigger
```
/plan MyPlugin
```

### Activities

1. **DSP Architecture Design**
   - Identify core DSP components
   - Define signal flow
   - Map parameters to DSP

2. **Complexity Assessment**
   - Rate complexity (1-5 scale)
   - Determine implementation strategy
   - Identify risks

3. **Framework Selection**
   - Choose Visage or WebView
   - Document rationale
   - Plan implementation approach

### Inputs
- `creative-brief.md`
- `parameter-spec.md`

### Outputs

```
plugins/MyPlugin/.ideas/
├── architecture.md            # DSP design
└── plan.md                    # Implementation strategy
```

**architecture.md:**
```markdown
# DSP Architecture

## Core Components
- Component 1: Description
- Component 2: Description

## Processing Chain
```
Input → [Component 1] → [Component 2] → Output
```

## Parameter Mapping
| Parameter | Component | Function | Range |
|-----------|-----------|----------|-------|
| gain | Gain Stage | Input gain | -60 to 24 dB |

## Complexity Assessment
**Score: 3/5**
**Rationale:** Multi-band processing with sidechain
```

**plan.md:**
```markdown
# Implementation Plan

## Complexity Score: 3

## Implementation Strategy
Phased implementation:
1. Core processing
2. Optimization
3. Polish

## Dependencies
- juce_audio_basics
- juce_dsp

## Risk Assessment
**High:** Real-time constraints
**Medium:** Parameter smoothing
```

### Validation Criteria
- [ ] Architecture document complete
- [ ] Plan document complete
- [ ] Complexity score assigned (1-5)
- [ ] UI framework selected (Visage/WebView)
- [ ] Rationale documented

### Completion State
```json
{
  "current_phase": "plan_complete",
  "ui_framework": "webview",
  "complexity_score": 3,
  "validation": {
    "architecture_defined": true,
    "ui_framework_selected": true
  },
  "framework_selection": {
    "decision": "webview",
    "rationale": "Complex UI with visualization",
    "implementation_strategy": "phased"
  }
}
```

### Framework Decision Matrix

| Criteria | Visage | WebView |
|----------|--------|---------|
| Complexity 1-2 | ✅ | ⚠️ |
| Complexity 3-5 | ⚠️ | ✅ |
| Performance Critical | ✅ | ⚠️ |
| Rich Visualization | ⚠️ | ✅ |
| Fast Iteration | ⚠️ | ✅ |
| Memory Constrained | ✅ | ⚠️ |

### Common Pitfalls
- **Underestimating complexity** - Be honest about difficulty
- **Wrong framework choice** - Consider long-term maintenance
- **Missing dependencies** - List all JUCE modules needed

---

## Phase 3: DESIGN (GUI)

### Purpose
Create visual mockups and detailed UI specifications.

### Trigger
```
/design MyPlugin
```

### Activities

1. **Requirements Gathering**
   - Style direction (minimal, analog, futuristic)
   - Layout preferences
   - Control types (knobs, sliders, buttons)
   - Color palette
   - Window size

2. **Mockup Generation**
   - Create layout specification
   - Define style guide
   - Generate preview (framework-specific)
     - WebView: HTML preview (`v1-test.html`)
     - Visage: optional C++ preview scaffold (default yes)

3. **Iteration**
   - Review with user
   - Refine design
   - Version control (v1, v2, v3...)

### Inputs
- `architecture.md`
- `plan.md`
- `parameter-spec.md`
- Framework selection from state

### Outputs

```
plugins/MyPlugin/
└── Design/
    ├── v1-ui-spec.md          # Layout specification
    ├── v1-style-guide.md      # Visual reference
    └── v1-test.html           # WebView preview (optional)
 
Visage preview (optional):
```
plugins/MyPlugin/Source/
    ├── PluginEditor.h
    ├── PluginEditor.cpp
    └── VisageControls.h
```
```

**v1-ui-spec.md:**
```markdown
# UI Specification v1

## Layout
- Window: 600x400px
- Grid: 3 columns, 2 rows

## Controls
| Parameter | Type | Position | Size |
|-----------|------|----------|------|
| gain | Knob | Top-left | 80x80 |

## Color Palette
- Background: #1a1a2e
- Primary: #e0e0e0
- Accent: #4a9eff
```

**v1-style-guide.md:**
```markdown
# Style Guide v1

## Colors
- Primary: #e0e0e0
- Accent: #4a9eff
- Background: #1a1a2e

## Typography
- Font: System UI
- Title: 24px bold
- Labels: 12px regular

## Controls
- Knob size: 80x80px
- Knob style: Modern gradient
- Label position: Below
```

### Validation Criteria
- [ ] UI spec exists with layout details
- [ ] Style guide exists with colors/typography
- [ ] All parameters have UI representations
- [ ] Window size defined
- [ ] Framework-specific preview created (WebView HTML or Visage scaffold)

### Completion State
```json
{
  "current_phase": "design_complete",
  "validation": {
    "design_complete": true
  }
}
```

### Design Iteration

Each iteration creates new versions:
```
Design/
├── v1-ui-spec.md          # Initial design
├── v1-style-guide.md
├── v2-ui-spec.md          # After feedback
├── v2-style-guide.md
└── v3-ui-spec.md          # Final design
```

Latest version is used for implementation.

### Common Pitfalls
- **Skipping user approval** - Always confirm design before coding
- **Too complex for first version** - Start simple, iterate
- **Ignoring framework constraints** - Design for chosen framework

---

## Phase 4: IMPLEMENT (Code)

### Purpose
Write the C++ DSP and UI code.

### Trigger
```
/impl MyPlugin
```

### Activities

1. **Framework Conversion** (WebView only)
   - Convert design to HTML/CSS/JS
   - Set up JUCE frontend library
   - Create resource provider

2. **DSP Implementation**
   - Write PluginProcessor.h/cpp
   - Implement audio processing
   - Add parameter binding

3. **UI Implementation**
   - Write PluginEditor.h/cpp
   - Connect UI to parameters
   - Framework-specific setup

4. **Build & Test**
   - Compile plugin
   - Run validation tests
   - Fix issues

### Inputs
- All design documents
- `architecture.md`
- `parameter-spec.md`
- Framework selection

### Outputs

```
plugins/MyPlugin/Source/
├── PluginProcessor.h
├── PluginProcessor.cpp
├── PluginEditor.h
├── PluginEditor.cpp
└── ui/                      # WebView only
    └── public/
        ├── index.html
        └── js/
            ├── index.js
            └── juce/
                └── index.js
```

**Key Implementation Points:**

**PluginProcessor.cpp:**
```cpp
void prepareToPlay(double sampleRate, int samplesPerBlock) {
    // Initialize DSP
}

void processBlock(AudioBuffer<float>& buffer, MidiBuffer& midi) {
    // Get parameters
    auto* gainParam = apvts.getRawParameterValue("gain");
    
    // Process audio
    // ... DSP code ...
}
```

**PluginEditor.cpp (WebView):**
```cpp
// CRITICAL: Relays → WebView → Attachments order

// 1. Relays (in header)
juce::WebSliderRelay gainRelay { "GAIN" };

// 2. WebView (in constructor)
webView = std::make_unique<WebBrowserComponent>(
    Options().withBackend(webview2)
             .withOptionsFrom(gainRelay)
);

// 3. Attachments (after webView creation)
gainAttachment = std::make_unique<WebSliderParameterAttachment>(...);
```

### Validation Criteria
- [ ] Plugin compiles without errors
- [ ] Plugin loads in DAW
- [ ] Parameters affect audio
- [ ] UI displays correctly
- [ ] No crashes on load/unload
- [ ] Tests pass

### Completion State
```json
{
  "current_phase": "code_complete",
  "validation": {
    "code_complete": true,
    "tests_passed": true
  }
}
```

### Implementation Strategies

**Single-Pass (Complexity ≤2):**
- Implement all at once
- One build/test cycle
- Good for: Simple gain, basic filter

**Phased (Complexity ≥3):**
- Phase 1: Core processing
- Phase 2: Advanced features
- Phase 3: Polish
- Good for: Multi-band, complex algorithms

### Common Pitfalls
- **Wrong member order** - Causes crashes (WebView)
- **Missing parameter validation** - Always validate ranges
- **No smoothing** - Causes zipper noise
- **Real-time violations** - No allocations in processBlock

---

## Phase 5: SHIP (Package)

### Purpose
Create professional installers and distribute the plugin.

### Trigger
```
/ship MyPlugin
```

### Activities

1. **Platform Selection**
   - Detect current platform
   - Ask which platforms to include
   - Plan local vs. GitHub Actions builds

2. **Local Build**
   - Create Windows installer (Inno Setup)
   - Package local artifacts

3. **GitHub Actions**
   - Trigger cross-platform builds
   - Download artifacts
   - Create platform packages

4. **Final Distribution**
   - Create unified distribution
   - Generate documentation
   - Create ZIP package

### Inputs
- Complete plugin code
- `status.json` with `code_complete`
- Local build artifacts

### Outputs

```
release/
├── MyPlugin-v1.0/
│   ├── MyPlugin-1.0-Windows-Setup.exe
│   ├── MyPlugin-1.0-macOS.zip
│   ├── MyPlugin-1.0-Linux.zip
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── LICENSE.txt
│   └── INSTALL.md
└── MyPlugin-v1.0.zip
```

### Platform Support

| Platform | Local | GitHub Actions | Formats |
|----------|-------|----------------|---------|
| Windows | ✅ | ✅ | VST3, Standalone |
| macOS | ❌ | ✅ | VST3, AU, Standalone |
| Linux | ❌ | ✅ | VST3, LV2, Standalone |

### Validation Criteria
- [ ] All selected platforms built
- [ ] Installers created
- [ ] Documentation included
- [ ] License file present
- [ ] Version tagged

### Completion State
```json
{
  "current_phase": "ship_complete",
  "version": "v1.0.0",
  "validation": {
    "ship_ready": true
  },
  "distribution": {
    "platforms": ["Windows", "macOS", "Linux"],
    "local_build": ["Windows"],
    "github_build": ["macOS", "Linux"]
  }
}
```

### Common Pitfalls
- **Not testing locally first** - Always test before shipping
- **Missing Inno Setup** - Required for Windows installer
- **Wrong version number** - Update status.json before shipping
- **Uncommitted changes** - Commit everything before GitHub Actions

---

## State Transitions

### Valid Flow

```
ideation → ideation_complete → plan → plan_complete →
design → design_complete → code → code_complete →
ship → ship_complete → complete
```

### Invalid Flows (Blocked)

| Attempt | Blocked Because |
|---------|-----------------|
| ideation → design | Missing plan |
| plan → code | Missing design |
| design → ship | Missing code |
| Any → ship | Tests not passed |

### Recovery

If you need to go back:
```powershell
# Manual state update
Update-PluginState -PluginPath "plugins\MyPlugin" -Phase "design_complete"

# Or restore from backup
Restore-PluginState -PluginPath "plugins\MyPlugin"
```

---

## Best Practices

### Across All Phases

1. **Commit after each phase**
   ```powershell
   git add .
   git commit -m "feat(MyPlugin): Complete [phase] phase"
   ```

2. **Validate before proceeding**
   ```powershell
   /status MyPlugin
   ```

3. **Backup before risky changes**
   ```powershell
   Backup-PluginState -PluginPath "plugins\MyPlugin"
   ```

4. **Test incrementally**
   - Build after each major change
   - Test in DAW frequently
   - Run validation scripts

### Phase-Specific

**DREAM:**
- Keep parameters minimal (3-5 to start)
- Be specific about sonic character
- Document references

**PLAN:**
- Be honest about complexity
- Consider long-term maintenance
- List all dependencies

**DESIGN:**
- Get user approval before coding
- Version your iterations
- Design for the chosen framework

**IMPLEMENT:**
- Follow framework-specific rules
- Validate member order (WebView)
- Test early and often

**SHIP:**
- Test local build first
- Use semantic versioning
- Include all documentation

---

## Example Timeline

| Phase | Duration | Key Activities |
|-------|----------|----------------|
| DREAM | 5-10 min | Define concept, parameters |
| PLAN | 10-15 min | Architecture, framework choice |
| DESIGN | 15-30 min | Mockups, iteration |
| IMPLEMENT | 30-60 min | Coding, testing |
| SHIP | 10-20 min | Building, packaging |
| **Total** | **1-2 hours** | **Complete plugin** |

*Note: Actual time varies based on complexity and iteration cycles.*

---

## Related Documentation

- [Command Reference](command-reference.md) - All available commands
- [State Management](state-management-deep-dive.md) - How state is tracked
- [Project Structure](PROJECT_STRUCTURE.md) - File organization
- [Troubleshooting](troubleshooting-guide.md) - When things go wrong
