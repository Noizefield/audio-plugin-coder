# APC Project Structure Guide

This document explains the complete directory structure and organization of the Audio Plugin Coder (APC) framework.

## Overview

APC follows a monorepo architecture with clear separation between framework code, tools, plugin projects, and build artifacts.

```
audio-plugin-coder/
├── .agent/              # AI agent configuration and skills
├── _tools/                 # External dependencies (JUCE, pluginval)
├── build/                  # Build artifacts (gitignored)
├── dist/                   # Distribution packages (gitignored)
├── docs/                   # Documentation
├── plugins/                # Your plugin projects
├── scripts/                # Build and utility scripts
├── .github/                # GitHub Actions workflows
├── CMakeLists.txt          # Root CMake configuration
└── README.md               # Project overview
```

---

## Core Directories

### `.agent/` - AI Agent Configuration

Contains all configuration, skills, and knowledge base for AI agents.

```
.agent/
├── guides/                 # Reference documentation
│   └── state-management-guide.md
├── rules/                  # System constraints and protocols
│   ├── agent.md            # Main agent rules
│   ├── file-naming-conventions.md
│   └── juce-build-protocols.md
├── skills/                 # Domain knowledge modules
│   ├── skill_debug/
│   ├── skill_design/
│   ├── skill_design_webview/
│   ├── skill_ideation/
│   ├── skill_implementation/
│   ├── skill_packaging/
│   ├── skill_planning/
│   ├── skill_testing/
│   └── skill_troubleshooting/
├── templates/              # Code templates
│   ├── status-template.json
│   └── webview/            # WebView plugin templates
├── troubleshooting/        # Auto-captured issues
│   ├── known-issues.yaml
│   └── resolutions/
└── workflows/              # Slash command orchestrators
    ├── debug.md
    ├── design.md
    ├── dream.md
    ├── impl.md
    ├── new.md
    ├── plan.md
    ├── resume.md
    ├── ship.md
    ├── status.md
    └── test.md
```

**Key Files:**
- [`agent.md`](.agent/rules/agent.md) - Critical rules for AI agents
- [`known-issues.yaml`](.agent/troubleshooting/known-issues.yaml) - Database of known issues
- [`status-template.json`](.agent/templates/status-template.json) - Plugin state schema

---

### `_tools/` - External Dependencies

Third-party tools and frameworks required by APC.

```
_tools/
├── JUCE/                   # JUCE 8 framework
│   ├── modules/            # JUCE modules (audio, GUI, DSP)
│   ├── examples/           # Example plugins
│   └── CMakeLists.txt      # JUCE CMake configuration
└── pluginval/              # Plugin validation tool
    └── pluginval.exe       # Windows executable
```

**Note:** These are Git submodules. Initialize with:
```powershell
git submodule update --init --recursive
```

---

### `plugins/` - Plugin Projects

Each plugin has its own directory with standardized structure.

```
plugins/
└── [PluginName]/
    ├── .ideas/             # Planning and specifications
    │   ├── creative-brief.md
    │   ├── parameter-spec.md
    │   ├── architecture.md
    │   └── plan.md
    ├── Design/             # UI design files
    │   ├── v1-ui-spec.md
    │   ├── v1-style-guide.md
    │   └── v1-test.html    # WebView preview (optional)
    ├── Source/             # C++ source code
    │   ├── PluginProcessor.h
    │   ├── PluginProcessor.cpp
    │   ├── PluginEditor.h
    │   ├── PluginEditor.cpp
    │   └── VisageControls.h (Visage only)
    ├── Assets/             # Icons, images (optional)
    ├── status.json         # Project state tracking
    └── README.md           # Plugin documentation
```

**The Three Zones:**

1. **The Sanctuary** (`plugins/[Name]/`)
   - Contains all source code and design files
   - Version controlled
   - Clean, organized structure

2. **The Dirty Zone** (`build/`)
   - All compilation artifacts
   - Gitignored
   - Can be safely deleted

3. **The Shipping Zone** (`dist/`)
   - Final distribution packages
   - Installers and ZIP files
   - Ready for release

---

### `scripts/` - Build Automation

PowerShell scripts for building, testing, and packaging.

```
scripts/
├── add-icon-to-exe.ps1
├── backup.ps1
├── build-and-install.ps1      # Main build script
├── copy-agent-folders.ps1
├── error-detection.ps1
├── list-folder-structure.ps1
├── pluginval-integration.ps1
├── preview-design.ps1
├── rollback.ps1
├── setup.ps1
├── state-management.ps1       # State management module
├── system-check.ps1
├── terminal-monitoring.ps1
├── validate-plugin-status.ps1
├── validate-state-management.ps1
├── validate-webview-member-order.ps1
├── validate-webview-setup.ps1
└── installer/
    ├── create-windows-installer.ps1
    └── installer-template.iss
```

**Critical Scripts:**
- [`build-and-install.ps1`](scripts/build-and-install.ps1) - Build and install plugins
- [`state-management.ps1`](scripts/state-management.ps1) - State tracking functions
- [`validate-webview-setup.ps1`](scripts/validate-webview-setup.ps1) - WebView validation

---

### `docs/` - Documentation

Comprehensive documentation for the APC framework.

```
docs/
├── README.md                   # Documentation index
├── github-actions.md           # CI/CD documentation
├── icon-management-guide.md    # Icon creation guide
├── installer-creation.md       # Installer guide
├── ship-workflow.md            # Shipping process
└── [Additional guides...]
```

---

## File Naming Conventions

### Plugin Files

| Directory | File | Purpose |
|-----------|------|---------|
| `.ideas/` | `creative-brief.md` | Plugin concept and vision |
| `.ideas/` | `parameter-spec.md` | Parameter definitions |
| `.ideas/` | `architecture.md` | DSP component design |
| `.ideas/` | `plan.md` | Implementation strategy |
| `Design/` | `v[N]-ui-spec.md` | UI layout specification |
| `Design/` | `v[N]-style-guide.md` | Visual style reference |
| `Design/` | `v[N]-test.html` | WebView preview |
| `Source/` | `PluginProcessor.h` | Audio processor header |
| `Source/` | `PluginProcessor.cpp` | Audio processing logic |
| `Source/` | `PluginEditor.h` | UI editor header |
| `Source/` | `PluginEditor.cpp` | UI implementation |
| `Source/` | `VisageControls.h` | Custom Visage widgets |
| Root | `status.json` | Project state tracking |

### Versioning

Design files use version prefixes:
- `v1-ui-spec.md` - Initial design
- `v2-ui-spec.md` - First iteration
- `v3-ui-spec.md` - Second iteration

Keep all versions for comparison. Latest version is used for implementation.

---

## State Management

### `status.json` Schema

Every plugin has a `status.json` file tracking development progress:

```json
{
  "plugin_name": "PluginName",
  "version": "v0.0.0",
  "current_phase": "ideation|plan|design|code|ship|complete",
  "ui_framework": "visage|webview|pending",
  "complexity_score": 1-5,
  "created_at": "2026-01-01T00:00:00Z",
  "last_modified": "2026-01-01T00:00:00Z",
  "phase_history": [],
  "validation": {
    "creative_brief_exists": false,
    "parameter_spec_exists": false,
    "architecture_defined": false,
    "ui_framework_selected": false,
    "design_complete": false,
    "code_complete": false,
    "tests_passed": false,
    "ship_ready": false
  },
  "framework_selection": {
    "decision": "pending",
    "rationale": "",
    "implementation_strategy": "pending"
  },
  "error_recovery": {
    "last_backup": null,
    "rollback_available": false,
    "error_log": []
  }
}
```

### Phase Flow

```
ideation → plan → design → code → ship → complete
   ↓         ↓        ↓       ↓      ↓
 status.json updated at each phase
```

---

## Build System

### Root CMakeLists.txt

The root [`CMakeLists.txt`](CMakeLists.txt) configures:
1. JUCE as a subdirectory
2. Global build settings
3. Plugin subdirectory inclusion

### Plugin CMakeLists.txt

Each plugin has its own `CMakeLists.txt`:

```cmake
juce_add_plugin(PluginName
    COMPANY_NAME "APC"
    PLUGIN_MANUFACTURER_CODE Apco
    PLUGIN_CODE PlgN
    FORMATS VST3 Standalone
    PRODUCT_NAME "Plugin Name"
    NEEDS_WEBVIEW2 TRUE  # For WebView plugins
)

target_link_libraries(PluginName
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
)
```

### Build Outputs

```
build/
└── plugins/
    └── [PluginName]/
        └── [PluginName]_artefacts/
            └── Release/
                ├── [PluginName].vst3/     # VST3 plugin
                ├── [PluginName].exe       # Standalone
                └── [PluginName].lib       # Static library
```

---

## Framework-Specific Paths

### WebView Framework

```
plugins/[Name]/
├── Design/
│   └── index.html          # Production UI
└── Source/
    ├── ui/
    │   └── public/
    │       ├── index.html
    │       └── js/
    │           ├── index.js
    │           └── juce/
    │               └── index.js
    └── [C++ files]
```

### Visage Framework

```
plugins/[Name]/
├── Design/
│   └── [Visage design specs]
└── Source/
    ├── VisageControls.h    # Custom widgets
    └── [C++ files]
```

---

## Git Configuration

### .gitignore

```
# Build artifacts
build/
dist/

# IDE
.vscode/
.idea/
*.user

# OS
.DS_Store
Thumbs.db

# Temporary
*.tmp
*.log
```

### Submodules

```
_tools/JUCE
_tools/pluginval
```

---

## Best Practices

1. **Always work from repository root** - Never run commands from plugin subdirectories
2. **Use PowerShell scripts** - Don't run cmake/msbuild directly
3. **Commit after each phase** - Preserve progress in git
4. **Keep The Sanctuary clean** - Only source code and design files
5. **Version design iterations** - Keep all versions, use latest for implementation
6. **Update status.json** - Always update state after phase completion

---

## Related Documentation

- [State Management Guide](state-management-deep-dive.md) - Deep dive into state tracking
- [Build System](build-system.md) - Detailed build documentation
- [WebView Framework](webview-framework.md) - WebView-specific paths
- [File Naming Conventions](.agent/rules/file-naming-conventions.md) - Complete naming rules
