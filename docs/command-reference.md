# Command Reference

Complete reference for all APC agent commands and platform scripts.

## Primary slash commands (`/apc-*`)

Use the **`apc-` prefix** to avoid collisions with other frameworks and host builtins:

| Primary | Deprecated alias | Purpose |
|---|---|---|
| `/apc-setup` | `/setup` | First-run toolchain, paths, models |
| `/apc-dream` | `/dream` | Ideation |
| `/apc-plan` | `/plan` | Architecture + UI framework |
| `/apc-design` | `/design` | UI design |
| `/apc-impl` / `/apc-implement` | `/impl` | Implementation |
| `/apc-test` | `/test` | Testing |
| `/apc-debug` | `/debug` | Debugging |
| `/apc-ship` | `/ship` | Packaging |
| `/apc-status` | `/status` | State inspection |
| `/apc-resume` | `/resume` | Continue next incomplete phase |
| `/apc-patch` | — | Open a bugfix generation on a shipped plugin |
| `/apc-evolve` | — | Open a feature generation on a shipped plugin |
| `/apc-new` | `/new` | Guided multi-phase with confirmations |

Paths and models: see `apc.config.example.json`, `docs/model-routing.md`.

## Overview

APC provides multiple ways to interact with the system:
- **Slash Commands** - AI agent commands (`/apc-dream`, `/apc-plan`, etc.)
- **Codex Skill** - `$audio-plugin-coder:audio-plugin-coder <action> <Name>`
- **PowerShell Scripts** - Build and utility scripts
- **GitHub Actions** - CI/CD workflows
- **Direct Tools** - Manual tool invocation

---

## Codex Commands

Codex discovers APC's repo-local skill from `.agents/skills/`. The reliable Codex interface is the
skill action:

```text
$audio-plugin-coder:audio-plugin-coder setup
$audio-plugin-coder:audio-plugin-coder dream EchoReverb
$audio-plugin-coder:audio-plugin-coder plan EchoReverb
$audio-plugin-coder:audio-plugin-coder design EchoReverb
$audio-plugin-coder:audio-plugin-coder impl EchoReverb
$audio-plugin-coder:audio-plugin-coder test EchoReverb
$audio-plugin-coder:audio-plugin-coder debug EchoReverb
$audio-plugin-coder:audio-plugin-coder status EchoReverb
$audio-plugin-coder:audio-plugin-coder resume EchoReverb
$audio-plugin-coder:audio-plugin-coder ship EchoReverb
$audio-plugin-coder:audio-plugin-coder patch EchoReverb
$audio-plugin-coder:audio-plugin-coder evolve EchoReverb
$audio-plugin-coder:audio-plugin-coder new EchoReverb
```

Natural-language equivalents also work. Do not use `/plan` or `/status` for APC in Codex; those
names invoke Codex's built-in plan mode and session status. The bare `/apc-*` names remain the
Claude/Kilo form. Plugin surfaces that support packaged command adapters may expose the
namespaced `/audio-plugin-coder:apc-*` form.

See [Codex Compatibility](codex-compatibility.md) for discovery and packaging details.

---

## Slash Commands

Slash commands are the primary APC syntax in Claude Code and Kilo. Codex uses the skill action;
sections below still describe the shared APC behavior.

### `/apc-dream [Name]` (alias: `/dream`)

**Purpose:** Initialize a new plugin with ideation phase

**Trigger:** Natural language equivalent: "Create a new delay plugin called EchoReverb"

**Actions:**
1. Creates plugin directory: `$PluginPath/`
2. Generates `creative-brief.md` (concept document)
3. Generates `parameter-spec.md` (parameter definitions)
4. Initializes `status.json` (project state)

**Output Files:**
```
$PluginPath/
├── .ideas/
│   ├── creative-brief.md
│   └── parameter-spec.md
└── status.json
```

**Next Step:** `/apc-plan [Name]`

---

### `/apc-plan [Name]` (alias: `/plan`)

**Purpose:** Define architecture and select UI framework

**Trigger:** Natural language: "Plan the architecture for EchoReverb"

**Actions:**
1. Reads `creative-brief.md` and `parameter-spec.md`
2. Generates `architecture.md` (DSP design)
3. Generates `plan.md` (implementation strategy)
4. Determines complexity score (1-5)
5. Selects UI framework (Visage/WebView)
6. Updates `status.json`

**Output Files:**
```
$PluginPath/.ideas/
├── architecture.md
└── plan.md
```

**Next Step:** `/apc-design [Name]`

---

### `/apc-design [Name]` (alias: `/design`)

**Purpose:** Create GUI mockups and visual design

**Trigger:** Natural language: "Design the UI for EchoReverb"

**Actions:**
1. Reads UI framework from `status.json`
2. Gathers design requirements (style, layout, colors)
3. Generates design specifications:
   - `v1-ui-spec.md` (layout specification)
   - `v1-style-guide.md` (visual reference)
   - WebView: `v1-test.html` (HTML preview)
   - Visage: optional C++ preview scaffold (default yes)
4. Creates framework-specific preview artifacts (no production code yet)

**Output Files:**
```
$PluginPath/
├── Design/
│   ├── v1-ui-spec.md
│   ├── v1-style-guide.md
│   └── v1-test.html (WebView only)
└── Source/ (Visage preview only)
    ├── PluginEditor.h
    ├── PluginEditor.cpp
    └── VisageControls.h
```

**Next Step:** `/apc-impl [Name]` or iterate design

---

### `/apc-impl [Name]` (alias: `/impl`)

**Purpose:** Implement DSP and UI code

**Trigger:** Natural language: "Implement EchoReverb"

**Actions:**
1. Validates design phase complete
2. Creates `Source/` directory structure
3. Generates `PluginProcessor.h/cpp` (DSP code)
4. Generates `PluginEditor.h/cpp` (UI code)
5. Implements parameter binding
6. Builds and tests plugin

**Output Files:**
```
$PluginPath/Source/
├── PluginProcessor.h
├── PluginProcessor.cpp
├── PluginEditor.h
└── PluginEditor.cpp
```

**Next Step:** `/apc-ship [Name]`

---

### `/apc-ship [Name]` (alias: `/ship`)

**Purpose:** Package and distribute plugin

**Trigger:** Natural language: "Ship EchoReverb"

**Actions:**
1. Detects current platform
2. Checks for local builds
3. Asks which platforms to include
4. Creates local installer (current platform)
5. Triggers GitHub Actions (other platforms)
6. Packages final distribution

**Output:**
```
release/
├── EchoReverb-v1.0/
│   ├── EchoReverb-1.0-Windows-Setup.exe
│   ├── EchoReverb-1.0-macOS.zip
│   ├── EchoReverb-1.0-Linux.zip
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── LICENSE.txt
│   └── INSTALL.md
└── EchoReverb-v1.0.zip
```

**Platforms:** Windows (VST3, Standalone), macOS (VST3, AU, Standalone), Linux (VST3, LV2, Standalone)

---

### `/apc-status [Name]` (alias: `/status`)

**Purpose:** Check current progress and state

**Trigger:** Natural language: "What's the status of EchoReverb?"

**Actions:**
1. Reads `status.json`
2. Displays current phase
3. Shows validation checklist
4. Lists completed work
5. Suggests next steps

**Output Example:**
```
Plugin: EchoReverb
Current Phase: design_complete
UI Framework: webview
Complexity Score: 3/5

Validation Status:
✓ Creative brief exists
✓ Parameter spec exists
✓ Architecture defined
✓ UI framework selected
✓ Design complete
𐄂 Code complete
𐄂 Tests passed
𐄂 Ship ready

Next Step: Run /apc-impl EchoReverb to start implementation
```

---

### `/apc-resume [Name]` (alias: `/resume`)

**Purpose:** Continue development from last phase

**Trigger:** Natural language: "Continue working on EchoReverb"

**Actions:**
1. Reads current phase from `status.json`
2. Validates previous phases complete
3. Continues to next incomplete phase

**Example:**
- If phase is `plan_complete` → Runs design phase
- If phase is `design_complete` → Runs implementation phase
- If phase is `code_complete` → Runs shipping phase

---

### `/apc-test [Name]` (alias: `/test`)

**Purpose:** Run validation tests

**Trigger:** Natural language: "Test EchoReverb"

**Actions:**
1. Runs pluginval validation
2. Checks for crashes
3. Validates parameter binding
4. Reports test results

---

### `/apc-debug [Name]` (alias: `/debug`)

**Purpose:** Debug plugin issues

**Trigger:** Natural language: "Debug EchoReverb"

**Actions:**
1. Analyzes code for issues
2. Checks known issues database
3. Suggests fixes
4. Can generate VS Code: debug configuration

---

### `/apc-new [Name]` (alias: `/new`)

**Purpose:** Run complete workflow with confirmations

**Trigger:** Natural language: "Create EchoReverb from scratch"

**Actions:**
1. Runs all phases sequentially
2. Asks for confirmation at each phase
3. Completes full plugin development

**Flow:**
```
/apc-dream → confirm → /apc-plan → confirm → /apc-design → confirm → /apc-impl → confirm → /apc-ship
```

---

### `/apc-patch [Name]` (no alias)

**Purpose:** Open a bugfix generation on a shipped plugin

**Trigger:** Natural language: "Fix the click bug in shipped Organik"

**Actions:**
1. Verifies the plugin is shipped (refuses otherwise — use `/apc-resume`)
2. Backfills the frozen prior-generation record on first use
3. Snapshots `status.json`, bumps the patch digit (`v1.0` → `v1.0.1`)
4. Points the phase at `code`; resets only `tests_passed` / `ship_ready`

**Scope:** DSP/code fixes + tiny UI touch-ups (text, labels, positions).
New controls or layout → `/apc-evolve`. Then `/apc-impl` → `/apc-test` →
`/apc-ship` (ship freezes the generation).

---

### `/apc-evolve [Name]` (no alias)

**Purpose:** Open a feature generation on a shipped plugin

**Trigger:** Natural language: "Add a tape-hiss mode to shipped Organik"

**Actions:**
1. Asks for a one-line goal + optional codename (`v1.1 "Analog Warmth"`)
2. Verifies shipped state, backfills, snapshots (as patch)
3. Bumps minor (`v1.0` → `v1.1`), points the phase at `plan`
4. Writes `.ideas/{version}-brief.md` as the feature scope contract

**Flow:** `/apc-plan` → `/apc-design` → `/apc-impl` → `/apc-test` →
`/apc-ship` (brief bundled as release notes; ship freezes the generation).

---

## Platform Scripts

Prefer the single cross-platform CLI (Node 18+, zero deps) — it dispatches
to the right `scripts/` backend for the current OS, so agents never need the
`.ps1`-vs-`.sh` matrix:

```
node bin/apc.js version [--json]           # framework version (from package.json)
node bin/apc.js paths [--json] [--plugin N]  # resolved plugins/build/release dirs
node bin/apc.js doctor [--fix]             # version header + system-check (--fix: safe auto-fixes only)
node bin/apc.js build <Name> [--no-install] [--skip-tests] [--strict]
node bin/apc.js validate <kind> [--plugin N] [--json]  # webview|webview-order|visage|plugin run natively (cross-platform); state stays shell-bound
node bin/apc.js backup <Name> <Version>
node bin/apc.js rollback <Name> <Version>
node bin/apc.js patch <Name> [--json]           # open bugfix generation (v1.0 -> v1.0.1)
node bin/apc.js evolve <Name> [--codename N] [--json]  # open feature generation (v1.0 -> v1.1)
node bin/apc.js freeze <Name> [--tag T] [--json]  # freeze open generation (called by ship flow)
node bin/apc.js status [--plugin N] [--json]    # generation timeline (frozen flag + lineage)
npm test                                    # CLI test suite (test/apc.test.js, zero deps)
```

A shipped generation (`ship_complete` with no open generation) is read-only:
open a generation first — `/apc-patch` for bugs (code-first, tiny UI
touch-ups allowed), `/apc-evolve` for features (brief → plan → design →
impl → test → ship). `/apc-resume` on a shipped plugin suggests these two
instead of stopping.

Raw `scripts/` invocation still works (the CLI delegates to it in phase 1):

Windows uses PowerShell (`.ps1`); macOS/Linux use the matching Bash
(`.sh`) script **where a twin exists**. Core flows (build, state, backup,
system-check) ship as pairs; several validators (`validate-*.ps1`,
`pluginval-integration.ps1`) are currently Windows-only — one reason the
roadmap calls for a single cross-platform `apc` CLI (Idea 1). Examples below
show PowerShell; swap in the `.sh` equivalent on macOS/Linux when available
(e.g. `bash scripts/build-and-install.sh`).

## PowerShell Scripts

### Build Scripts

#### build-and-install.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName <Name> [-NoInstall] [-SkipTests] [-Strict]
```

**Parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `PluginName` | Yes | Name of plugin to build |
| `NoInstall` | No | Build without installing to system |
| `SkipTests` | No | Skip pluginval validation |
| `Strict` | No | Fail on any validation warning |

**Example:**
```powershell
# Full build and install
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin

# Build only (no install)
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName MyPlugin -NoInstall
```

---

### Validation Scripts

#### validate-plugin-status.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-plugin-status.ps1 -PluginName <Name>
```

Validates plugin state and prerequisites.

---

#### validate-webview-setup.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-webview-setup.ps1 -PluginName <Name>
```

Validates WebView plugin configuration.

**Checks:**
- CMakeLists.txt has binary data target
- NEEDS_WEBVIEW2 is set
- JUCE_WEB_BROWSER definition present
- Resource provider implemented

---

#### validate-webview-member-order.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-webview-member-order.ps1 -PluginName <Name>
```

Validates critical member declaration order.

---

#### validate-visage-setup.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-visage-setup.ps1 -PluginName <Name>
```

Validates Visage plugin configuration.

**Checks:**
- Root CMake has Visage option and subdirectory wiring
- Plugin CMake links `visage::visage`
- `VisageControls.h` exists
- `PluginEditor` uses `VisageJuceHost.h`
- No WebView-only flags present

---

#### validate-state-management.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-state-management.ps1
```

Validates state management system integrity.

---

### Utility Scripts

#### First-run setup (retired `setup.ps1`)

`scripts/setup.ps1` was retired; set up via the one-command installer or the agent phase:

```powershell
npx github:Noizefield/audio-plugin-coder
# or, inside an AI agent session in this repo:
/apc-setup
```

This initializes the APC environment:
- Checks prerequisites
- Initializes git submodules
- Validates JUCE installation

---

#### system-check.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\system-check.ps1
```

Checks system requirements:
- Windows version
- PowerShell version
- CMake version
- Visual Studio installation
- WebView2 Runtime

---

#### pluginval-integration.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pluginval-integration.ps1 -PluginName <Name> [-Strict]
```

Runs pluginval validation on plugin.

---

#### preview-design.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\preview-design.ps1 -PluginName <Name>
```

Opens design preview for Visage plugins.

---

### State Management Scripts

#### state-management.ps1

Dot-source to use functions:
```powershell
. .\scripts\state-management.ps1

# Then use functions
. ".\scripts\lib\Get-ApcPaths.ps1"
$PluginPath = Get-ApcPluginPath -PluginName "MyPlugin"
New-PluginState -PluginName "MyPlugin" -PluginPath $PluginPath
Get-PluginState -PluginPath $PluginPath
Update-PluginState -PluginPath $PluginPath -Updates @{...}
Test-PluginState -PluginPath $PluginPath -RequiredPhase "plan_complete"
Complete-Phase -PluginPath $PluginPath -Phase "design" -Updates @{...}
Backup-PluginState -PluginPath $PluginPath
Restore-PluginState -PluginPath $PluginPath
```

---

#### backup.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -PluginName <Name>
```

Creates complete backup of plugin.

---

#### rollback.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rollback.ps1 -PluginName <Name>
```

Rolls back plugin to previous state.

---

### Installer Scripts

#### create-windows-installer.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\installer\create-windows-installer.ps1 -PluginName <Name> -Version <Version>
```

**Parameters:**
| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `PluginName` | Yes | - | Plugin folder name |
| `Version` | Yes | - | Version number (e.g., "1.0.0") |
| `CompanyName` | No | "APC" | Company name |
| `PluginURL` | No | GitHub URL | Plugin website |

---

## GitHub Actions Workflows

### Manual Trigger

```bash
# Trigger with GitHub CLI
gh workflow run build-release.yml -f plugin_name=MyPlugin -f platforms=all

# Available platforms: all, windows, macos, linux, windows,macos, etc.
```

### Tag Push Trigger

```bash
# Create and push tag
git tag -a v1.0.0-MyPlugin -m "Release MyPlugin v1.0.0"
git push origin v1.0.0-MyPlugin
```

### Download Artifacts

```bash
# List recent runs
gh run list --workflow=build-release.yml

# Download artifacts
gh run download <run-id> --dir release/github-artifacts
```

---

## Command Quick Reference

### Phase Commands

| Command | Phase | Output |
|---------|-------|--------|
| `/apc-dream` | Ideation | Concept + Parameters |
| `/apc-plan` | Planning | Architecture + Framework |
| `/apc-design` | Design | UI Specifications |
| `/apc-impl` | Implementation | Working Code |
| `/apc-ship` | Shipping | Distribution Package |

### Status Commands

| Command | Purpose |
|---------|---------|
| `/apc-status` | Check progress |
| `/apc-resume` | Continue development |
| `/apc-test` | Run validation |
| `/apc-debug` | Debug issues |

### Revisit Commands (shipped plugins)

| Command | Purpose |
|---------|---------|
| `/apc-patch` | Open bugfix generation (patch bump, code-first) |
| `/apc-evolve` | Open feature generation (minor bump, delta pipeline) |

### Script Commands

| Script | Purpose |
|--------|---------|
| `build-and-install.ps1` | Build plugin |
| `validate-*.ps1` | Validation |
| `bin/setup.js` (`npx`) / `/apc-setup` | Initialize (replaces retired `setup.ps1`) |
| `system-check.ps1` | Check requirements |
| `state-management.ps1` | Manage state |
| `backup.ps1` / `rollback.ps1` | Recovery |

---

## Common Workflows

### New Plugin Workflow

```text
# Using slash commands (short aliases like /dream still work but are deprecated)
/apc-dream MyPlugin
/apc-plan MyPlugin
/apc-design MyPlugin
/apc-impl MyPlugin
/apc-ship MyPlugin

# Or using /apc-new
/apc-new MyPlugin
```

### Resume Workflow

```text
# Check status first
/apc-status MyPlugin

# Resume from current phase
/apc-resume MyPlugin
```

### Debug Workflow

```powershell
# Run validation
.\scripts\validate-plugin-status.ps1 -PluginName MyPlugin

# Check for known issues
Get-Content .agents/troubleshooting/known-issues.yaml | Select-String "error pattern"

# Debug
/apc-debug MyPlugin
```

### Ship Workflow

```text
# Local build first (Windows shown; .sh on macOS/Linux)
.\scripts\build-and-install.ps1 -PluginName MyPlugin

# Then ship
/apc-ship MyPlugin

# Or manual trigger
gh workflow run build-release.yml -f plugin_name=MyPlugin -f platforms=all
```

---

## Related Documentation

- [Project Structure](PROJECT_STRUCTURE.md) - Where commands create files
- [State Management](state-management-deep-dive.md) - How state is tracked
- [GitHub Actions](github-actions.md) - CI/CD workflows
- [Troubleshooting](troubleshooting-guide.md) - When commands fail
