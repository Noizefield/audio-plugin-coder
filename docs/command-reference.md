# Command Reference

Complete reference for all APC commands, slash commands, and PowerShell scripts.

## Overview

APC provides multiple ways to interact with the system:
- **Slash Commands** - AI agent commands (`/dream`, `/plan`, etc.)
- **PowerShell Scripts** - Build and utility scripts
- **GitHub Actions** - CI/CD workflows
- **Direct Tools** - Manual tool invocation

---

## Slash Commands

Slash commands are the primary way to interact with APC through AI agents.

### `/dream [Name]`

**Purpose:** Initialize a new plugin with ideation phase

**Trigger:** Natural language equivalent: "Create a new delay plugin called EchoReverb"

**Actions:**
1. Creates plugin directory: `plugins/[Name]/`
2. Generates `creative-brief.md` (concept document)
3. Generates `parameter-spec.md` (parameter definitions)
4. Initializes `status.json` (project state)

**Output Files:**
```
plugins/[Name]/
├── .ideas/
│   ├── creative-brief.md
│   └── parameter-spec.md
└── status.json
```

**Next Step:** `/plan [Name]`

---

### `/plan [Name]`

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
plugins/[Name]/.ideas/
├── architecture.md
└── plan.md
```

**Next Step:** `/design [Name]`

---

### `/design [Name]`

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
plugins/[Name]/
├── Design/
│   ├── v1-ui-spec.md
│   ├── v1-style-guide.md
│   └── v1-test.html (WebView only)
└── Source/ (Visage preview only)
    ├── PluginEditor.h
    ├── PluginEditor.cpp
    └── VisageControls.h
```

**Next Step:** `/impl [Name]` or iterate design

---

### `/impl [Name]`

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
plugins/[Name]/Source/
├── PluginProcessor.h
├── PluginProcessor.cpp
├── PluginEditor.h
└── PluginEditor.cpp
```

**Next Step:** `/ship [Name]`

---

### `/ship [Name]`

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
dist/
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

### `/status [Name]`

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

Next Step: Run /impl EchoReverb to start implementation
```

---

### `/resume [Name]`

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

### `/test [Name]`

**Purpose:** Run validation tests

**Trigger:** Natural language: "Test EchoReverb"

**Actions:**
1. Runs pluginval validation
2. Checks for crashes
3. Validates parameter binding
4. Reports test results

---

### `/debug [Name]`

**Purpose:** Debug plugin issues

**Trigger:** Natural language: "Debug EchoReverb"

**Actions:**
1. Analyzes code for issues
2. Checks known issues database
3. Suggests fixes
4. Can generate VS Code: debug configuration

---

### `/new [Name]`

**Purpose:** Run complete workflow with confirmations

**Trigger:** Natural language: "Create EchoReverb from scratch"

**Actions:**
1. Runs all phases sequentially
2. Asks for confirmation at each phase
3. Completes full plugin development

**Flow:**
```
/dream → confirm → /plan → confirm → /design → confirm → /impl → confirm → /ship
```

---

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

#### setup.ps1

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Initializes APC environment:
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
New-PluginState -PluginName "MyPlugin" -PluginPath "plugins\MyPlugin"
Get-PluginState -PluginPath "plugins\MyPlugin"
Update-PluginState -PluginPath "plugins\MyPlugin" -Updates @{...}
Test-PluginState -PluginPath "plugins\MyPlugin" -RequiredPhase "plan_complete"
Complete-Phase -PluginPath "plugins\MyPlugin" -Phase "design" -Updates @{...}
Backup-PluginState -PluginPath "plugins\MyPlugin"
Restore-PluginState -PluginPath "plugins\MyPlugin"
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
gh run download <run-id> --dir dist/github-artifacts
```

---

## Command Quick Reference

### Phase Commands

| Command | Phase | Output |
|---------|-------|--------|
| `/dream` | Ideation | Concept + Parameters |
| `/plan` | Planning | Architecture + Framework |
| `/design` | Design | UI Specifications |
| `/impl` | Implementation | Working Code |
| `/ship` | Shipping | Distribution Package |

### Status Commands

| Command | Purpose |
|---------|---------|
| `/status` | Check progress |
| `/resume` | Continue development |
| `/test` | Run validation |
| `/debug` | Debug issues |

### Script Commands

| Script | Purpose |
|--------|---------|
| `build-and-install.ps1` | Build plugin |
| `validate-*.ps1` | Validation |
| `setup.ps1` | Initialize |
| `system-check.ps1` | Check requirements |
| `state-management.ps1` | Manage state |
| `backup.ps1` / `rollback.ps1` | Recovery |

---

## Common Workflows

### New Plugin Workflow

```powershell
# Using slash commands
/dream MyPlugin
/plan MyPlugin
/design MyPlugin
/impl MyPlugin
/ship MyPlugin

# Or using /new
/new MyPlugin
```

### Resume Workflow

```powershell
# Check status first
/status MyPlugin

# Resume from current phase
/resume MyPlugin
```

### Debug Workflow

```powershell
# Run validation
.\scripts\validate-plugin-status.ps1 -PluginName MyPlugin

# Check for known issues
Get-Content .agent/troubleshooting/known-issues.yaml | Select-String "error pattern"

# Debug
/debug MyPlugin
```

### Ship Workflow

```powershell
# Local build first
.\scripts\build-and-install.ps1 -PluginName MyPlugin

# Then ship
/ship MyPlugin

# Or manual trigger
gh workflow run build-release.yml -f plugin_name=MyPlugin -f platforms=all
```

---

## Related Documentation

- [Project Structure](PROJECT_STRUCTURE.md) - Where commands create files
- [State Management](state-management-deep-dive.md) - How state is tracked
- [GitHub Actions](github-actions.md) - CI/CD workflows
- [Troubleshooting](troubleshooting-guide.md) - When commands fail

