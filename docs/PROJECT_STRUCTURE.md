# APC Project Structure Guide

This document explains the complete directory structure and organization of the Audio Plugin Coder (APC) framework.

## Overview

APC follows a monorepo architecture with clear separation between framework code, tools, plugin projects, and build artifacts.

```
audio-plugin-coder/
├── .agents/                # Canonical AI knowledge (skills, workflows, rules, guides, troubleshooting)
├── .claude/ .kilocode/ .agent/  # Thin host pointers to .agents/ files (Claude, Kilo, legacy)
├── .cursor/                # Cursor rules (pointer)
├── .opencode/              # OpenCode command shims (-> .agents/workflows/)
├── .codex/                 # Optional Codex project agents (cost tiers)
├── .codex-plugin/          # Codex plugin manifest (+ skills loader)
├── _tools/                 # External dependencies (JUCE, pluginval, visage submodules)
├── build/                  # Build artifacts (gitignored)
├── release/                # Ship packages and installers (gitignored except README)
├── docs/                   # Documentation
├── plugins/                # Your plugin projects
├── scripts/                # Build and utility scripts (.ps1 + .sh)
├── skills/                 # Packaged Codex skill adapter
├── templates/              # Plugin templates (visage, webview, ffgl, max-external)
├── design_library/         # UI design examples
├── assets/                 # Logos and banners
├── .github/                # GitHub Actions workflows
├── AGENTS.md               # Agent guidance (AGENTS.md standard)
├── CMakeLists.txt          # Root CMake configuration
└── README.md               # Project overview
```

---

## Core Directories

### `.agents/` - Canonical AI Knowledge

Single source of truth for all AI-agent instructions. Host-specific folders
(`.claude/` for Claude Code, `.kilocode/` for Kilo, `.agent/` legacy,
`.opencode/command/` for OpenCode) contain thin pointers to these files.

```
.agents/
├── guides/                 # Reference documentation
│   ├── documentation-system.md
│   └── state-management-guide.md
├── rules/                  # System constraints and protocols
│   ├── agent.md            # Main agent rules
│   ├── file-naming-conventions.md
│   └── juce-build-protocols.md
├── skills/                 # Domain knowledge modules
│   ├── apc-setup/
│   ├── debug/              # (aliases: skill_debug/)
│   ├── design/             # (aliases: skill_design/)
│   ├── dream/              # (aliases: skill_ideation/)
│   ├── impl/               # (aliases: skill_implementation/)
│   ├── plan/               # (aliases: skill_planning/)
│   ├── ship/               # (aliases: skill_packaging/)
│   ├── test/
│   ├── skill_design_webview/
│   ├── skill_testing/
│   └── skill_troubleshooting/
├── agents/                 # Worker profiles (Luna/Terra/Sol/Astra)
├── troubleshooting/        # Auto-captured issues
│   ├── known-issues.yaml
│   └── resolutions/
└── workflows/              # Slash command orchestrators (apc-* + deprecated short aliases)
    ├── apc-setup.md
    ├── apc-dream.md
    ├── apc-plan.md
    ├── apc-design.md
    ├── apc-impl.md (apc-implement.md alias)
    ├── apc-test.md
    ├── apc-debug.md
    ├── apc-ship.md
    ├── apc-status.md
    ├── apc-resume.md
    ├── apc-new.md
    └── [short aliases: setup.md, dream.md, plan.md, ...]
```

**Key Files:**
- [`agent.md`](../.agents/rules/agent.md) - Critical rules for AI agents
- [`known-issues.yaml`](../.agents/troubleshooting/known-issues.yaml) - Database of known issues
- [`status-template.json`](../templates/status-template.json) - Plugin state schema (lives under root `templates/`)

---

### Codex Integration Files

Codex discovers APC through dedicated files at the repository root:

```
AGENTS.md                    # Agent guidance (read by any AGENTS.md-aware agent)
.agents/skills/              # Repo-local Codex skill (loader)
.codex-plugin/plugin.json    # Codex plugin manifest
skills/audio-plugin-coder/   # Packaged Codex skill
```

See [Codex Compatibility](codex-compatibility.md) for the command mapping and packaging details.

---

### `_tools/` - External Dependencies

Third-party tools and frameworks required by APC.

```
_tools/
├── JUCE/                   # JUCE 9 framework (submodule, pin 9.0.1)
│   ├── modules/            # JUCE modules (audio, GUI, DSP)
│   ├── examples/           # Example plugins
│   └── CMakeLists.txt      # JUCE CMake configuration
├── pluginval/              # Plugin validation tool (submodule)
└── visage/                 # Visage GUI library (submodule)
    # NOTE: _tools/DebugView/ (Sysinternals, Windows-only) is gitignored local tooling
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

1. **The Sanctuary** (configured `paths.plugins_dir`, default `plugins/[Name]/`)
   - Contains all source code and design files
   - Version controlled
   - Clean, organized structure

2. **The Dirty Zone** (configured `paths.build_dir`, default `build/`)
   - All compilation artifacts
   - Gitignored
   - Can be safely deleted

3. **The Shipping Zone** (configured `paths.release_dir`, default `release/`)
   - Final distribution packages
   - Installers and ZIP files
   - Ready for release
   - Override with `paths.release_dir` in `apc.config.json`

---

### `scripts/` - Build Automation

PowerShell (`.ps1`, Windows) and Bash (`.sh`, macOS/Linux) scripts for building, testing, and packaging.
Most scripts ship as `.ps1`/`.sh` pairs (see `lib/Get-ApcPaths.ps1` + `lib/apc-paths.sh` for path resolution);
a few Windows-only helpers (e.g. `terminal-monitoring`, `copy-agent-folders`, `setup_bridges`) have no `.sh` counterpart.

```
scripts/
├── apc-write-config.ps1/.sh
├── backup.ps1/.sh
├── build-and-install.ps1/.sh  # Main build script
├── codex/                     # Optional Codex cost-aware orchestration
│   ├── apc-codex-run.ps1/.sh
│   ├── smoke-proof.ps1/.sh
│   ├── install-profiles.ps1/.sh
│   ├── profiles/              # luna/terra/sol/astra tier configs
│   └── routing-schema.json
├── error-detection.ps1/.sh
├── lib/
│   ├── Get-ApcPaths.ps1       # Path resolution (plugins/build/release)
│   └── apc-paths.sh
├── pluginval-integration.ps1
├── preview-design.ps1/.sh
├── rollback.ps1/.sh
├── setup_bridges.bat/.ps1     # FFGL + Max/MSP bridge setup (Windows)
├── state-management.ps1/.sh   # State management module
├── system-check.ps1/.sh
├── validate-*.ps1(.sh)         # Phase/setup validators (webview, visage, state, plugin)
├── installer/
│   ├── create-windows-installer.ps1
│   ├── create-macos-installer.sh
│   └── installer-template.iss
└── (Windows-only / legacy helpers: setup.ps1, setup_bridges, copy-agent-folders.ps1,
    list-folder-structure.ps1, terminal-monitoring.ps1, add-icon-to-exe.ps1 + rcedit-x64.exe)
```

**Critical Scripts:**
- [`build-and-install.ps1`](scripts/build-and-install.ps1) - Build and install plugins
- [`state-management.ps1`](scripts/state-management.ps1) - State tracking functions
- [`validate-webview-setup.ps1`](scripts/validate-webview-setup.ps1) - WebView validation
- [`codex/apc-codex-run.ps1`](scripts/codex/apc-codex-run.ps1) - Optional Codex tier routing (see [Codex Orchestration](codex-orchestration.md))

---

### `docs/` - Documentation

Comprehensive documentation for the APC framework.

```
docs/
├── README.md                   # Documentation index (start here)
├── plugin-development-lifecycle.md  # Five-phase workflow detail
├── command-reference.md        # Commands and scripts
├── codex-compatibility.md      # Codex skill, plugin manifest, command mapping
├── codex-orchestration.md      # Optional Luna/Terra/Sol/Astra codex exec routing
├── model-routing.md            # Per-phase model preferences
├── build-system.md             # CMake configuration and build scripts
├── github-actions.md           # CI/CD documentation
├── icon-management-guide.md    # Icon creation guide
├── installer-creation.md       # Platform installer how-to (Windows Inno Setup)
├── ship-workflow.md            # End-to-end shipping process (uses installer-creation)
├── state-management-deep-dive.md  # State tracking internals
├── troubleshooting-guide.md    # Common issues and solutions
├── webview-framework.md        # WebView UI framework
├── PROJECT_STRUCTURE.md        # This file
└── FAQ.md                      # Frequently asked questions
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
$PluginPath/
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
$PluginPath/
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

# Ship packages (release/README.md is tracked)
release/**
!release/README.md

# Legacy ship folder (replaced by release/). Ignore leftovers.
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
_tools/visage
```

---

## Local-Only & Heavy Directories (kept, documented — not clutter)

| Path | Size class | Tracked? | Notes |
|------|-----------|----------|-------|
| `_tools/` | ~226MB | 3 gitlinks + ignored `DebugView/` | JUCE 9.0.1 / pluginval / visage submodules. `_tools/DebugView/` (Sysinternals exes) is gitignored Windows-only tooling. Init with `git submodule update --init --recursive`. |
| `.git/` | ~761MB | n/a | History + submodule objects. Do not rewrite history to shrink; `git gc` if needed. |
| `.opencode/` | ~55MB on disk | 12 shims (`command/apc-*.md`) | Rest is ignored `node_modules/`. Only the shims are committed. |
| `assets/APC_Logo.gif` | ~9.8MB | tracked | Used by README + `.codex-plugin` logo. Keep; optimize only if size matters. |
| `build/` | regenerable | ignored | CMake dirty zone. Safe to delete locally, never commit. |
| `release/` | ship output | only `README.md` tracked | `/apc-ship` writes here (honors `paths.release_dir`). Do not use `dist/`. |
| `.tmp/` | logs | ignored | Codex smoke/usage logs. Safe to clear locally. |
| `plans/` | local docs | ignored | Never published. Decision lists live here. |
| `logs/` | empty placeholder | ignored | Kept for tooling that expects the dir. |
| `github/` | local helpers | ignored | Personal `*.ps1` git helpers. Not `.github/` (CI) — different folder, similar name by accident of history. |
| `design_library/_exclude/` | examples overflow | ignored | Not shipped. |
| `bin/` (`setup.js`), `common/` (`VisageJuceHost.h`) | tiny | tracked | Intentional single-file dirs (npm `bin`, C++ bridge header). |

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
- [File Naming Conventions](../.agents/rules/file-naming-conventions.md) - Complete naming rules
- [Maintenance Triage](maintenance-triage.md) - Orphan/legacy retirement list (nothing deleted without approval)
