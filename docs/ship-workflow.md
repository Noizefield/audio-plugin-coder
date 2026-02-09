# Ship Workflow Documentation

This guide explains the Ship phase of the APC (Audio Plugin Coder) system, which handles packaging and distribution of plugins.

## Overview

The Ship phase creates professional, cross-platform plugin installers ready for distribution to end users.

### What Ship Does

1. **Detects your current platform** (Windows/macOS/Linux)
2. **Checks for local builds** (already compiled plugins)
3. **Asks which platforms to include** (interactive selection)
4. **Creates local installers** (for current platform)
5. **Triggers GitHub Actions builds** (for other platforms)
6. **Downloads build artifacts** (from GitHub)
7. **Creates platform-specific installers** (with license agreements)
8. **Packages final distribution** (ZIP with all installers)

### Supported Platforms

| Platform | VST3 | AU | Standalone | LV2 | Local Build | GitHub Actions |
|----------|------|-----|------------|-----|-------------|----------------|
| Windows  | ✓    | -   | ✓          | -   | ✓ (native)  | ✓              |
| macOS    | ✓    | ✓   | ✓          | -   | ✗           | ✓              |
| Linux    | ✓    | -   | ✓          | ✓   | ✗           | ✓              |

## Prerequisites

Before running Ship:

1. **Phase 4 (CODE) complete** - Plugin implementation finished
2. **All tests passing** - Audio engine validated
3. **Local build successful** (for current platform)

## Running Ship

### Command

```powershell
# Using the skill trigger
/ship CloudWash

# Or run directly
powershell -ExecutionPolicy Bypass -File .\scripts\ship-local.ps1 -PluginName CloudWash
```

## Step-by-Step Process

### Step 1: Environment Detection

The workflow detects:
- Your current operating system
- Whether you have a local build available

**Example output:**
```
Current Platform: Windows
Local Build Status: Found
```

### Step 2: Platform Selection

**CRITICAL:** The workflow always asks which platforms to include.

**Menu displayed:**
```
Select platforms to include:
[1] Current Platform - USE LOCAL BUILD
[2] Current Platform - BUILD WITH GITHUB ACTIONS  
[3] Windows (VST3, Standalone) - GITHUB ACTIONS
[4] macOS (VST3, AU, Standalone) - GITHUB ACTIONS
[5] Linux (VST3, LV2, Standalone) - GITHUB ACTIONS
[6] ALL PLATFORMS - Use local for current, GitHub for others

Enter numbers (comma-separated) or 'all':
```

#### Selection Examples

**Scenario 1: Windows developer with local build, want macOS + Linux**
```
Enter: 1,4,5
```
Result:
- Windows: Use local build
- macOS: Build on GitHub
- Linux: Build on GitHub

**Scenario 2: Want to rebuild everything on GitHub**
```
Enter: 3,4,5
```
Result:
- All platforms built on GitHub
- Consistent builds across platforms

**Scenario 3: Just need one missing platform**
```
Enter: 4
```
Result:
- Only macOS built on GitHub
- Fastest option for single platform

**Scenario 4: Let the system decide**
```
Enter: all
```
Result:
- Current platform uses local build
- Other platforms use GitHub Actions

### Step 3: Local Build Processing

If you selected to use local build:

**Windows:**
1. Validates build artifacts exist
2. Checks for Inno Setup (installer compiler)
3. Generates `.iss` script from template
4. Compiles installer executable
5. Includes license agreement
6. Supports custom installation path

**Output:**
- `dist/{PluginName}-{version}-Windows-Setup.exe`

### Step 4: GitHub Actions Trigger

For platforms selected to build on GitHub:

1. Verifies workflow file exists
2. Checks git status (commits if needed)
3. Creates and pushes tag
4. Triggers `build-release.yml` workflow

**Tag format:** `v{version}-{PluginName}`

**Example:** `v1.0.0-CloudWash`

### Step 5: Download Artifacts

After GitHub Actions completes:

```powershell
# Using GitHub CLI
gh run download --dir dist/github-artifacts --pattern "*-$PluginName"
```

Or manually from GitHub Actions page.

### Step 6: Create Installers

**Windows (already done in Step 3):**
- Professional `.exe` installer
- License agreement page
- Custom installation path
- Start Menu shortcuts
- Uninstaller

**macOS (prepare on Windows, finalize on Mac):**
- Creates installer scripts
- Prepares PKG/DMG structure
- Must run final packaging on macOS for signing

**Linux (prepare on Windows, finalize on Linux):**
- Creates AppImage structure
- Prepares DEB package
- Must run final packaging on Linux

### Step 7: Final Distribution

Creates unified distribution package:

```
dist/{PluginName}-v{version}/
├── {PluginName}-{version}-Windows-Setup.exe   (Windows installer)
├── {PluginName}-{version}-macOS.zip           (macOS bundles)
├── {PluginName}-{version}-Linux.zip           (Linux binaries)
├── README.md                                  (Plugin documentation)
├── CHANGELOG.md                               (Version history)
├── LICENSE.txt                                (EULA)
└── INSTALL.md                                 (Installation guide)
```

**Final ZIP:**
```
dist/{PluginName}-v{version}.zip
```

## Installer Features

### Windows Installer (Inno Setup)

**Features:**
- ✓ License agreement display
- ✓ Custom installation path selection
- ✓ VST3 path auto-detection
- ✓ Component selection (VST3, Standalone, Presets)
- ✓ Start Menu shortcuts
- ✓ Uninstaller integration
- ✓ Silent install option (`/SILENT`)

**Installation Paths:**
```
VST3:     C:\Program Files\Common Files\VST3\
Standalone: C:\Program Files\{PluginName}\
Presets:  C:\ProgramData\{PluginName}\Presets\
```

### macOS Installation

**Formats:**
- **DMG**: Drag-and-drop install
- **PKG**: System installer with component selection

**Installation Paths:**
```
VST3:     /Library/Audio/Plug-Ins/VST3/
AU:       /Library/Audio/Plug-Ins/Components/
Standalone: /Applications/
```

**Note:** macOS installers require code signing. The workflow prepares the structure; you must finalize on a Mac with a developer certificate.

### Linux Installation

**Formats:**
- **AppImage**: Portable, no installation required
- **DEB**: Debian/Ubuntu package

**Installation Paths:**
```
VST3:     /usr/lib/vst3/
LV2:      /usr/lib/lv2/
Standalone: /usr/bin/
```

**Note:** Linux packages should be built on Linux for proper dependency resolution.

## License Agreement

All installers include a license agreement (EULA).

**Default License:** MIT License (from repository root)

**Custom License:** Place `LICENSE.txt` in your plugin folder:
```
plugins/{PluginName}/LICENSE.txt
```

**License includes:**
- Grant of license
- Permitted use
- Restrictions
- Disclaimer of warranty
- Limitation of liability

## State Management

After shipping, the plugin state is updated:

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

## Troubleshooting

### "Local build not found"

**Cause:** No build artifacts in `build/` directory

**Solution:**
```powershell
# Build first
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName CloudWash

# Then ship
/ship CloudWash
```

### "Inno Setup not found"

**Cause:** Inno Setup not installed

**Solution:**
1. Download from https://jrsoftware.org/isdl.php
2. Install with default settings
3. Restart terminal

Or use ZIP distribution instead of installer.

### "GitHub Actions workflow not found"

**Cause:** Workflow file not committed

**Solution:**
```bash
git add .github/workflows/
git commit -m "Add GitHub Actions workflows"
git push
```

### "No artifacts downloaded"

**Cause:** GitHub Actions still running or failed

**Solution:**
1. Check workflow status on GitHub
2. Wait for completion
3. Retry download

### "macOS/Linux installers incomplete"

**Cause:** These platforms require native tools for final packaging

**Solution:**
1. Copy prepared files to target platform
2. Run final packaging scripts
3. Or use the ZIP distributions directly

## Best Practices

### 1. Test Local Build First

Always ensure your local build works before shipping:
```powershell
.\scripts\build-and-install.ps1 -PluginName CloudWash
```

### 2. Use Platform Selection Wisely

- **Save CI minutes:** Use local build for current platform
- **Consistent builds:** Use GitHub for all platforms
- **Quick fix:** Build only the missing platform

### 3. Version Management

Follow semantic versioning:
- `v1.0.0` - Major release
- `v1.1.0` - Feature addition
- `v1.1.1` - Bug fix

### 4. Test Installers

Before distributing:
- Test on clean systems
- Verify uninstall works
- Check all formats load in DAWs

### 5. Document Changes

Always update:
- `CHANGELOG.md` - What changed
- `README.md` - User-facing documentation
- `INSTALL.md` - Installation instructions

## Examples

### Example 1: Windows Developer Shipping Cross-Platform

```powershell
# 1. Build locally first
.\scripts\build-and-install.ps1 -PluginName CloudWash

# 2. Start ship workflow
/ship CloudWash

# 3. Select platforms: 1,4,5 (Use local Windows, GitHub for macOS/Linux)

# 4. Wait for GitHub Actions
#    - Go to GitHub → Actions
#    - Monitor build progress

# 5. Download artifacts
gh run download --dir dist/github-artifacts

# 6. Create final distribution
#    - Windows installer created locally
#    - macOS/Linux prepared from GitHub artifacts
```

### Example 2: Quick macOS Build

```powershell
# Already have Windows and Linux, just need macOS
/ship CloudWash

# Select: 4 (macOS only)

# Workflow triggers GitHub Actions for macOS only
# Fast and saves CI minutes
```

### Example 3: Full GitHub Build

```powershell
# Want consistent builds across all platforms
/ship CloudWash

# Select: 3,4,5 (Build all on GitHub)

# Or select: all (uses local for current, GitHub for rest)
```

## Next Steps After Shipping

1. **Test installers** on target platforms
2. **Create GitHub Release** (if not auto-created)
3. **Distribute to users**
4. **Collect feedback**
5. **Plan next version**

## Related Documentation

- [GitHub Actions CI/CD](github-actions.md) - Detailed workflow documentation
- [Main README](README.md) - Project overview
- `.agent/skills/skill_packaging/SKILL.md` - Implementation details

