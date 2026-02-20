# File Naming Conventions

**Purpose:** Standardize file organization across all APC plugin development skills
**Scope:** All plugin projects under `plugins\[Name]\`

## 📁 Directory Structure
```
plugins\[Name]\
├── .ideas\           # Project planning and specifications
│   ├── creative-brief.md
│   ├── parameter-spec.md
│   ├── architecture.md
│   └── plan.md
├── Design\           # Visual assets and mockups
│   ├── v1-ui-spec.md        # ← Note versioning
│   ├── v1-style-guide.md    # ← Note versioning
│   ├── v1-test.html         # ← WebView preview (optional)
│   └── index.html           # ← WebView production (WebView only)
├── Source\           # C++ source code
│   ├── PluginProcessor.h
│   ├── PluginProcessor.cpp
│   ├── PluginEditor.h
│   ├── PluginEditor.cpp
│   └── VisageControls.h     # (Visage only)
├── status.json       # ← Project state tracking (ROOT LEVEL)
└── README.md         # Plugin documentation
```

## 📋 File Naming Rules

### .ideas\ Directory
- **creative-brief.md** - Plugin concept and vision
- **parameter-spec.md** - Parameter definitions and ranges
- **architecture.md** - DSP component design
- **plan.md** - Implementation plan and complexity assessment
- **mockups\** - Optional subdirectory for design mockups

### Design\ Directory
- **ui-spec.md** - UI layout and component specifications
- **style-guide.md** - Visual style and color palette
- **index.html** - Main HTML interface (WebView only)
- **v1-test.html** - Preview HTML (WebView only)

### Source\ Directory
- **PluginProcessor.h** - Audio processing class header
- **PluginProcessor.cpp** - Audio processing implementation
- **PluginEditor.h** - UI editor class header
- **PluginEditor.cpp** - UI editor implementation
- **VisageControls.h** - Custom Visage widgets (Visage only)

### Documentation\ Directory
- **USER_MANUAL.md** - Main user manual (auto-generated or user-created)
- **QUICKSTART.md** - Quick start guide (optional)
- **[Any files]** - All files automatically included in installer
- **Purpose**: User-facing documentation, shipped with plugin
- **Auto-inclusion**: Installer template automatically copies all files from this folder

### Assets\ Directory
- **icon.ico** - Plugin icon for Windows installer and shortcuts
- **Purpose**: Graphics and branding assets
- **Required**: icon.ico must exist for professional installer

### Root Level
- **status.json** - Project state and configuration
- **README.md** - Plugin documentation and usage

## 🔧 Versioning System

### Design Files
- Use version prefixes for iterative design: `v1-ui-spec.md`, `v2-ui-spec.md`, `v3-ui-spec.md`
- Keep all versions in Design\ directory for comparison and rollback
- **Latest version number** used for implementation unless user specifies
- Both Visage and WebView use same versioning pattern

**Example progression:**
```
Design\
├── v1-ui-spec.md      # Initial design
├── v1-style-guide.md
├── v2-ui-spec.md      # After first iteration
├── v2-style-guide.md
└── v2-test.html       # Latest version used for implementation
```

### Implementation Files
- No versioning in Source\ directory
- Use Git for version control
- Commit after each phase completion

## 🎯 Framework-Specific Rules

### Visage Framework
- **Required:** `Source\VisageControls.h` for custom widgets
- **Forbidden:** HTML\CSS files in Design\
- **Headers:** Use `#include "visage\ui.h"` (not `visage\visage.h`)

### WebView Framework
- **Required:** `Design\index.html` with inline CSS\JS
- **Optional:** `Design\v1-test.html` for preview
- **Integration:** `Source\PluginEditor.h` with WebView setup

## 🔄 Phase Integration

### Phase 1: DREAM
- Creates: `.ideas\creative-brief.md`, `.ideas\parameter-spec.md`
- Updates: `status.json` (phase: "ideation_complete")

### Phase 2: PLAN
- Creates: `.ideas\architecture.md`, `.ideas\plan.md`
- Updates: `status.json` (ui_framework selection)

### Phase 3: DESIGN
- Creates: `Design\ui-spec.md`, `Design\style-guide.md`
- Optional: `Design\index.html`, `Source\VisageControls.h`
- Updates: `status.json` (phase: "design_complete")

### Phase 4: CODE
- Creates: `Source\PluginProcessor.*`, `Source\PluginEditor.*`
- Updates: `status.json` (phase: "code_complete")

### Phase 5: SHIP
- Creates: `dist\[Name]_v1.0\` with distribution files
- Updates: `status.json` (phase: "ship_complete", version: "v1.0.0")

## ⚠️ Critical Rules

1. **Consistency:** All skills must follow these naming conventions
2. **Framework Awareness:** File creation depends on UI framework selection
3. **Version Control:** Use Git for tracking changes, not file versioning in Source\
4. **State Tracking:** Always update `status.json` after each phase
5. **Path Separators:** Use backslashes (`\`) on Windows (PowerShell), forward slashes (`/`) on macOS/Linux (Bash)
6. **Script Equivalents:** Every `.ps1` script in `scripts/` has a `.sh` counterpart for macOS/Linux

## 🔗 Cross-Skill References

- **skill_ideation.md:** Creates initial .ideas\ files
- **skill_planning.md:** Creates architecture.md and plan.md
- **skill_design.md:** Creates Design\ files with versioning
- **skill_implementation.md:** Creates Source\ files
- **skill_packaging.md:** Creates dist\ directory and distribution files

## 📁 State Management Files

### Template Files
- **`..claude\templates\status-template.json`** - Standardized state schema template
- **`..claude\guides\state-management-guide.md`** - State management documentation

### Script Files
- **`scripts\state-management.ps1`** - Core state management PowerShell module (Windows)
- **`scripts/state-management.sh`** - Core state management Bash module (macOS/Linux)
- **`scripts\validate-state-management.ps1`** - State management validation script

### State Operations
- **State Initialization:** `New-PluginState` (Windows) / `new_plugin_state` (macOS)
- **State Updates:** `Update-PluginState` (Windows) / `update_plugin_state` (macOS)
- **State Validation:** `Test-PluginState` (Windows) / `test_plugin_state` (macOS)
- **Error Recovery:** `Backup-PluginState` / `backup_plugin_state` and `Restore-PluginState` / `restore_plugin_state`

## 🛠️ Validation

Each skill should validate:
1. Required files exist before proceeding
2. File paths match conventions
3. Framework-specific files are created appropriately
4. status.json is updated with correct phase information

This ensures consistent project structure across all plugin development workflows.
