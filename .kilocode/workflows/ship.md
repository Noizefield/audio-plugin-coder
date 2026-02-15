---
description: "PHASE 5: Packaging - Create cross-platform installers and distribution packages"
---

# Ship Phase

**Goal:** Create professional, cross-platform plugin installers with license agreements
**Trigger:** `/ship [Name]` or "Ship [Name]"
**Prerequisites:** Phase 4 (CODE) complete, audio engine working, all tests passed
**Skill Reference:** `.kilocode/skills/skill_packaging/SKILL.md`

---

## Prerequisites

```powershell
. "$PSScriptRoot\..\scripts\state-management.ps1"

$state = Get-PluginState -PluginPath "plugins\$PluginName"

if ($state.current_phase -ne "code_complete") {
    Write-Error "Implementation not complete. Run /impl first."
    exit 1
}
```

---

## Overview

The Ship phase creates distribution-ready plugin packages for Windows, macOS, and Linux. It supports:

- **Local builds** - Use existing build on current platform
- **GitHub Actions builds** - Cross-platform CI/CD for platforms you can't build locally
- **Hybrid approach** - Combine local and remote builds

### Supported Platforms & Formats

| Platform | VST3 | AU | Standalone | LV2 | Build Method |
|----------|------|-----|------------|-----|--------------|
| Windows  | ?    | -   | ?          | -   | Local or GitHub |
| macOS    | ?    | ?   | ?          | -   | GitHub only |
| Linux    | ?    | -   | ?          | ?   | GitHub only |

---

## Workflow Steps

### STEP 1: Detect Environment

**Execute:** Detect current platform and check for existing local build

**Logic:**
- Identify current OS (Windows/macOS/Linux)
- Check `build/` directory for existing artifacts
- Determine which platforms can use local build vs need GitHub Actions

**Reference:** See `skill_packaging/SKILL.md` - "STEP 1: DETECT CURRENT PLATFORM & BUILD STATUS"

---

### STEP 2: Prompt User for Platform Selection

**Execute:** Display platform selection menu and capture user input

**CRITICAL:** Always ask user which platforms to include in the release

**Options to Present:**
```
Current Platform: [Windows|macOS|Linux]
Local Build Status: [Found|Not Found]

Select platforms to include:
[1] Current Platform - USE LOCAL BUILD
[2] Current Platform - BUILD WITH GITHUB ACTIONS  
[3] Windows (VST3, Standalone) - GITHUB ACTIONS
[4] macOS (VST3, AU, Standalone) - GITHUB ACTIONS
[5] Linux (VST3, LV2, Standalone) - GITHUB ACTIONS
[6] ALL PLATFORMS - Use local for current, GitHub for others

Enter numbers (comma-separated) or 'all':
```

**Rationale:** User may already have a local build and want to save GitHub Actions minutes/credits by only building missing platforms.

**Reference:** See `skill_packaging/SKILL.md` - "STEP 2: ASK USER FOR PLATFORM SELECTION"

---

### STEP 3: Process Local Build (If Selected)

**Execute:** Create installer from local build artifacts

**Applies to:** Current platform only, when user selects local build option

**Actions:**
1. Validate local build artifacts exist
2. Create platform-native installer
3. Generate license file

**Windows Only:**
- Check for Inno Setup
- Generate `.iss` script from template
- Compile installer executable
- Include license agreement page
- Support custom installation path

**Reference:** See `skill_packaging/SKILL.md` - "STEP 3: LOCAL BUILD PROCESS"

---

### STEP 4: Trigger GitHub Actions (If Selected)

**Execute:** Trigger cross-platform builds via GitHub Actions

**Applies to:** Platforms selected that differ from current platform, or when user explicitly chooses GitHub Actions

**Actions:**
1. Verify GitHub Actions workflow exists (`.github/workflows/build-release.yml`)
2. Check git status (commit if needed)
3. Create and push tag to trigger workflow
4. Provide user with GitHub Actions URL to monitor progress

**Tag Format:** `v{version}-{PluginName}`

**Reference:** See `skill_packaging/SKILL.md` - "STEP 4: GITHUB ACTIONS BUILD PROCESS"

---

### STEP 5: Download & Process Artifacts

**Execute:** Download build artifacts and create installers

**When:** After GitHub Actions completes

**Actions:**
1. Download artifacts using `gh` CLI
2. For macOS: Prepare PKG/DMG creation scripts (run on Mac to finalize)
3. For Linux: Prepare AppImage/DEB creation scripts (run on Linux to finalize)
4. Create platform-specific installers

**Note:** macOS and Linux installers require their respective platforms for final signing/packaging. Windows can prepare the structure.

**Reference:** See `skill_packaging/SKILL.md` - "STEP 5: CREATE INSTALLERS FOR GITHUB BUILDS"

---

### STEP 6: Create License File

**Execute:** Generate EULA text file for inclusion in all installers

**Location:** `dist/{PluginName}-v{version}/LICENSE.txt`

**Reference:** See `skill_packaging/SKILL.md` - "STEP 6: CREATE LICENSE FILE"

---

### STEP 7: Finalize Distribution

**Execute:** Assemble final distribution package

**Actions:**
1. Create unified distribution directory
2. Copy all platform installers
3. Add documentation (README, CHANGELOG, INSTALL guide)
4. Create final ZIP archive
5. Update plugin state to `ship_complete`

**Output Structure:**
```
dist/{PluginName}-v{version}/
+-- {PluginName}-{version}-Windows-Setup.exe
+-- {PluginName}-{version}-macOS.dmg
+-- {PluginName}-{version}-macOS.pkg
+-- {PluginName}-{version}-Linux.AppImage
+-- {PluginName}-{version}.deb
+-- README.md
+-- CHANGELOG.md
+-- LICENSE.txt
+-- INSTALL.md
```

**Reference:** See `skill_packaging/SKILL.md` - "STEP 7: FINALIZE DISTRIBUTION"

---

## Validation

- Verify all formats built (VST3/AU/LV2/Standalone)
- Verify tests passed
- Verify installer created in dist/
- Verify GitHub commit successful

---

## State Management

**Update `status.json`:**
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

---

## Completion

```
+--------------------------------------------------------------+
¦  ?? PLUGIN SHIPPED SUCCESSFULLY!                             ¦
¦--------------------------------------------------------------¦
¦  Plugin: {PluginName} v{version}                              ¦
¦                                                              ¦
¦  Platforms Built:                                            ¦
¦    • Windows: {Local/GitHub}                                  ¦
¦    • macOS: GitHub Actions                                    ¦
¦    • Linux: GitHub Actions                                    ¦
¦                                                              ¦
¦  Distribution: dist/{PluginName}-v{version}.zip               ¦
¦                                                              ¦
¦  Installers:                                                 ¦
¦    • Windows: Setup.exe with license & custom path           ¦
¦    • macOS: DMG + PKG with component selection               ¦
¦    • Linux: AppImage + DEB packages                          ¦
+--------------------------------------------------------------+
```

---

## Next Steps

- Test installers on target platforms
- Upload to GitHub Releases (if not auto-released)
- Distribute to users
- Begin next plugin project

---

## Reference

For detailed implementation, code samples, and troubleshooting:
**? See `.kilocode/skills/skill_packaging/SKILL.md`**
