# SKILL: PACKAGING (Cross-Platform)

**Goal:** Create professional, cross-platform plugin installers for Windows, macOS, and Linux
**Trigger:** `/ship [Name]` or "Ship [Name]"
**Prerequisites:** Phase 4 (CODE) complete, audio engine working, all tests passed
**Output Location:** `dist/[Name]_v[version]/`

---

## Overview

This skill handles the complete packaging and distribution process for APC plugins. It supports:

- **Local builds** (current platform only)
- **GitHub Actions builds** (cross-platform CI/CD)
- **Hybrid approach** (local + remote for specific platforms)

### Platform Support Matrix

| Platform | VST3 | AU | Standalone | LV2 | Local Build | GitHub Actions |
|----------|------|-----|------------|-----|-------------|----------------|
| Windows  | ✓    | -   | ✓          | -   | ✓ (native)  | ✓              |
| macOS    | ✓    | ✓   | ✓          | -   | ✗           | ✓              |
| Linux    | ✓    | -   | ✓          | ✓   | ✗           | ✓              |

---

## STEP 1: DETECT CURRENT PLATFORM & BUILD STATUS

```powershell
# Detect current operating system
$CurrentOS = if ($IsWindows -or ($env:OS -eq "Windows_NT")) { "Windows" }
             elseif ($IsMacOS) { "macOS" }
             elseif ($IsLinux) { "Linux" }
             else { "Unknown" }

# Check for existing local build
$BuildDir = "build"
$HasLocalBuild = Test-Path "$BuildDir/*_artefacts/Release/*.vst3" -or
                 Test-Path "$BuildDir/*_artefacts/Release/*.component" -or
                 Test-Path "$BuildDir/*_artefacts/*.vst3"

Write-Host "Current Platform: $CurrentOS" -ForegroundColor Cyan
Write-Host "Local Build Found: $HasLocalBuild" -ForegroundColor Cyan
```

---

## STEP 2: ASK USER FOR PLATFORM SELECTION

**CRITICAL:** Before proceeding, ask the user which platforms to build for.

### Platform Selection Prompt

```
╔══════════════════════════════════════════════════════════════╗
║  SHIP WORKFLOW - Platform Selection                          ║
╠══════════════════════════════════════════════════════════════╣
║  Current Platform: Windows                                    ║
║  Local Build Status: Found                                    ║
╠══════════════════════════════════════════════════════════════╣
║  Select platforms to include in release:                     ║
║                                                              ║
║  [1] Windows (VST3, Standalone) - USE LOCAL BUILD            ║
║  [2] Windows (VST3, Standalone) - BUILD WITH GITHUB ACTIONS  ║
║  [3] macOS (VST3, AU, Standalone) - GITHUB ACTIONS REQUIRED  ║
║  [4] Linux (VST3, LV2, Standalone) - GITHUB ACTIONS REQUIRED ║
║  [5] ALL PLATFORMS - Use local for current, GitHub for rest  ║
║                                                              ║
║  Enter numbers (comma-separated) or 'all':                   ║
╚══════════════════════════════════════════════════════════════╝
```

### Decision Logic

```powershell
# Determine which platforms need GitHub Actions
$PlatformsNeedingGitHub = @()
$PlatformsUsingLocal = @()

foreach ($platform in $SelectedPlatforms) {
    if ($platform -eq $CurrentOS -and $HasLocalBuild -and $UseLocalBuild) {
        $PlatformsUsingLocal += $platform
    } else {
        $PlatformsNeedingGitHub += $platform
    }
}

# Inform user of the plan
Write-Host "`nBuild Plan:" -ForegroundColor Green
Write-Host "  Local builds: $($PlatformsUsingLocal -join ', ')" -ForegroundColor Yellow
Write-Host "  GitHub Actions: $($PlatformsNeedingGitHub -join ', ')" -ForegroundColor Yellow
```

---

## STEP 3: LOCAL BUILD PROCESS (If Selected)

### 3.0 Prepare Documentation (AUTOMATIC)

**CRITICAL**: This step runs BEFORE installer creation and ensures documentation exists.

```powershell
# Check if Documentation folder exists
$DocPath = "plugins\$PluginName\Documentation"

if (-not (Test-Path $DocPath)) {
    Write-Host "Creating Documentation folder..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $DocPath -Force | Out-Null

    # Generate basic USER_MANUAL.md from plugin metadata
    Write-Host "Generating basic documentation..." -ForegroundColor Yellow
    $ManualContent = @"
# $PluginName User Manual

**Version $Version**

## Installation
See the installer for installation instructions.

## Parameters
[Auto-generated parameter list would go here]

## Credits
Built with Audio Plugin Coder (APC)

**© $(Get-Date -Format yyyy)** - https://noizefield.com
"@
    Set-Content -Path "$DocPath\USER_MANUAL.md" -Value $ManualContent

    Write-Host "✓ Basic documentation created" -ForegroundColor Green
    Write-Host "  You can edit: $DocPath\USER_MANUAL.md" -ForegroundColor Cyan
} else {
    Write-Host "✓ Documentation folder exists" -ForegroundColor Green

    # List what will be included
    $DocFiles = Get-ChildItem -Path $DocPath -File -Recurse
    if ($DocFiles.Count -gt 0) {
        Write-Host "  Files to include in installer:" -ForegroundColor Cyan
        foreach ($file in $DocFiles) {
            Write-Host "    - $($file.Name)" -ForegroundColor Gray
        }
    } else {
        Write-Warning "Documentation folder is empty! Add files to: $DocPath"
    }
}
```

**Philosophy**:
- Documentation folder is ALWAYS created (even if empty)
- If empty, basic documentation is auto-generated
- User can add/edit files in Documentation\ folder
- Installer automatically includes ALL files from Documentation\

---

### 3.1 Validate Local Build

```powershell
if ($PlatformsUsingLocal -contains "Windows") {
    # Verify build artifacts exist
    $Vst3Path = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "*.vst3" | Select-Object -First 1
    $StandalonePath = Get-ChildItem -Path "$BuildDir" -Recurse -Filter "*.exe" | Select-Object -First 1

    if (-not $Vst3Path) {
        Write-Error "No local VST3 build found. Run build-and-install.ps1 first."
        exit 1
    }

    Write-Host "✓ Local Windows build verified" -ForegroundColor Green
}
```

### 3.2 Create Windows Installer (Local)

```powershell
function New-WindowsInstaller {
    param([string]$PluginName, [string]$Version)

    # Check for Inno Setup
    $InnoPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $InnoPath)) {
        Write-Warning "Inno Setup not found. Download from: https://jrsoftware.org/isdl.php"
        Write-Host "Falling back to ZIP distribution..." -ForegroundColor Yellow
        return New-ZipDistribution -PluginName $PluginName -Version $Version
    }

    # Generate installer script from template
    $TemplatePath = "scripts/installer-template.iss"
    $IssPath = "build/$PluginName-installer.iss"

    $Template = Get-Content $TemplatePath -Raw
    $IssContent = $Template `
        -replace '{#PluginName}', $PluginName `
        -replace '{#PluginVersion}', $Version `
        -replace '{#BuildDir}', $BuildDir

    Set-Content -Path $IssPath -Value $IssContent

    # Compile installer
    & $InnoPath $IssPath

    $InstallerPath = "dist/$PluginName-$Version-Setup.exe"
    if (Test-Path $InstallerPath) {
        Write-Host "✓ Windows installer created: $InstallerPath" -ForegroundColor Green
        return $InstallerPath
    } else {
        throw "Installer creation failed"
    }
}
```

---

## STEP 4: GITHUB ACTIONS BUILD PROCESS (If Selected)

### 4.1 Verify GitHub Repository Setup

```powershell
# Check if GitHub Actions workflow exists
$WorkflowPath = ".github/workflows/build-release.yml"
if (-not (Test-Path $WorkflowPath)) {
    Write-Error "GitHub Actions workflow not found. Run setup first."
    Write-Host "Create workflow file: $WorkflowPath" -ForegroundColor Yellow
    exit 1
}

# Check git status
$GitStatus = git status --porcelain
if ($GitStatus) {
    Write-Warning "Uncommitted changes detected. Commit before triggering workflow."
    $Commit = Read-Host "Commit changes now? (y/n)"
    if ($Commit -eq 'y') {
        git add .
        git commit -m "Prepare release build for $PluginName"
        git push
    }
}
```

### 4.2 Trigger GitHub Actions Workflow

```powershell
function Invoke-GitHubActionsBuild {
    param(
        [string]$PluginName,
        [string[]]$Platforms,
        [string]$Version
    )

    # Create a tag to trigger workflow
    $TagName = "v$Version-$PluginName"

    Write-Host "`nTriggering GitHub Actions build..." -ForegroundColor Cyan
    Write-Host "  Tag: $TagName" -ForegroundColor Yellow
    Write-Host "  Platforms: $($Platforms -join ', ')" -ForegroundColor Yellow

    # Create and push tag
    git tag -a $TagName -m "Build $PluginName v$Version for $($Platforms -join ', ')"
    git push origin $TagName

    Write-Host "`n✓ Build triggered!" -ForegroundColor Green
    Write-Host "  Monitor at: https://github.com/$(git remote get-url origin | Split-Path -Leaf)/actions" -ForegroundColor Cyan
    Write-Host "`nThe workflow will:" -ForegroundColor Yellow
    Write-Host "  1. Build for selected platforms" -ForegroundColor Gray
    Write-Host "  2. Create installers" -ForegroundColor Gray
    Write-Host "  3. Upload artifacts" -ForegroundColor Gray
    Write-Host "  4. Create GitHub Release (if configured)" -ForegroundColor Gray

    return $TagName
}
```

### 4.3 Download Build Artifacts

```powershell
function Get-GitHubArtifacts {
    param([string]$TagName, [string]$PluginName)

    Write-Host "`nWaiting for build completion..." -ForegroundColor Cyan
    Write-Host "(Check GitHub Actions for progress)" -ForegroundColor Gray

    # Wait for user confirmation or poll GitHub API
    $Proceed = Read-Host "`nBuild complete? Download artifacts now? (y/n)"

    if ($Proceed -eq 'y') {
        # Use gh CLI to download artifacts
        $ArtifactsDir = "dist/github-artifacts"
        New-Item -ItemType Directory -Path $ArtifactsDir -Force | Out-Null

        # Download all artifacts for this tag
        gh run download --dir $ArtifactsDir --pattern "*-$PluginName-*"

        Write-Host "✓ Artifacts downloaded to: $ArtifactsDir" -ForegroundColor Green
        return $ArtifactsDir
    }
}
```

---

## STEP 5: CREATE INSTALLERS FOR GITHUB BUILDS

### 5.1 macOS Installer Creation

```powershell
function New-macOSInstaller {
    param([string]$PluginName, [string]$Version, [string]$ArtifactsDir)

    # Note: macOS installer creation requires macOS
    # On Windows, we prepare the structure for later signing/notarization

    $MacOSDir = "dist/$PluginName-$Version-macOS"
    New-Item -ItemType Directory -Path $MacOSDir -Force | Out-Null

    # Copy artifacts
    Copy-Item "$ArtifactsDir/macos-binaries/*" $MacOSDir -Recurse -Force

    # Create DMG structure (can be finalized on macOS)
    @"
# macOS Installer Creation Script
# Run this on a Mac to create signed DMG and PKG

PLUGIN_NAME=$PluginName
VERSION=$Version

# Create component packages
pkgbuild --component "$MacOSDir/$PluginName.vst3" \\
    --install-location "/Library/Audio/Plug-Ins/VST3" \\
    "dist/$PluginName-\$VERSION-VST3.pkg"

pkgbuild --component "$MacOSDir/$PluginName.component" \\
    --install-location "/Library/Audio/Plug-Ins/Components" \\
    "dist/$PluginName-\$VERSION-AU.pkg"

# Create distribution
productbuild --distribution scripts/macos/distribution.xml \\
    --package-path dist \\
    --resources resources \\
    "dist/$PluginName-\$VERSION-macOS.pkg"

# Create DMG
create-dmg \\
    --volname "$PluginName Installer" \\
    "dist/$PluginName-\$VERSION-macOS.dmg" \\
    "$MacOSDir"
"@ | Set-Content "dist/create-macos-installer-$Version.sh"

    Write-Host "✓ macOS installer scripts prepared" -ForegroundColor Green
    Write-Host "  Run 'create-macos-installer-$Version.sh' on a Mac to finalize" -ForegroundColor Yellow
}
```

### 5.2 Linux Package Creation

```powershell
function New-LinuxPackages {
    param([string]$PluginName, [string]$Version, [string]$ArtifactsDir)

    $LinuxDir = "dist/$PluginName-$Version-Linux"
    New-Item -ItemType Directory -Path $LinuxDir -Force | Out-Null

    # Copy artifacts
    Copy-Item "$ArtifactsDir/linux-binaries/*" $LinuxDir -Recurse -Force

    # Create AppImage (using appimagetool)
    @"
#!/bin/bash
# Linux Package Creation Script
# Run this on Linux to create packages

PLUGIN_NAME=$PluginName
VERSION=$Version

# Create AppDir structure
mkdir -p AppDir/usr/bin
mkdir -p AppDir/usr/lib/vst3
mkdir -p AppDir/usr/lib/lv2

cp "$LinuxDir/$PLUGIN_NAME" AppDir/usr/bin/
cp -r "$LinuxDir/$PLUGIN_NAME.vst3" AppDir/usr/lib/vst3/
cp -r "$LinuxDir/$PLUGIN_NAME.lv2" AppDir/usr/lib/lv2/

# Create desktop entry
cat > AppDir/$PLUGIN_NAME.desktop << EOF
[Desktop Entry]
Name=$PLUGIN_NAME
Exec=$PLUGIN_NAME
Icon=$PLUGIN_NAME
Type=Application
Categories=AudioVideo;Audio;
EOF

# Build AppImage
appimagetool AppDir "dist/$PLUGIN_NAME-\$VERSION-x86_64.AppImage"

# Create DEB package
# ... (DEB creation commands)
"@ | Set-Content "dist/create-linux-packages-$Version.sh"

    Write-Host "✓ Linux package scripts prepared" -ForegroundColor Green
}
```

---

## STEP 6: CREATE LICENSE FILE

```powershell
function New-LicenseFile {
    param([string]$PluginName, [string]$OutputPath)

    $LicenseText = @"
================================================================================
                    $PluginName END USER LICENSE AGREEMENT
================================================================================

IMPORTANT: PLEASE READ THIS LICENSE CAREFULLY BEFORE USING THIS SOFTWARE.

1. GRANT OF LICENSE
   This software is licensed, not sold. By installing or using this software,
   you agree to be bound by the terms of this agreement.

2. PERMITTED USE
   - You may install and use this software on multiple computers
   - You may use this software for commercial and non-commercial purposes
   - You may create and distribute audio content using this software

3. RESTRICTIONS
   - You may not reverse engineer, decompile, or disassemble this software
   - You may not redistribute or resell this software
   - You may not remove or alter any copyright notices

4. DISCLAIMER OF WARRANTY
   THIS SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.

5. LIMITATION OF LIABILITY
   IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY DAMAGES ARISING FROM
   THE USE OF THIS SOFTWARE.

================================================================================
By installing this software, you acknowledge that you have read, understood,
and agree to be bound by these terms.
================================================================================
"@

    Set-Content -Path $OutputPath -Value $LicenseText
    Write-Host "✓ License file created: $OutputPath" -ForegroundColor Green
}
```

---

## STEP 7: FINALIZE DISTRIBUTION

### 7.1 Create Distribution Structure

```powershell
function New-DistributionPackage {
    param(
        [string]$PluginName,
        [string]$Version,
        [hashtable]$Artifacts
    )

    $DistDir = "dist/$PluginName-v$Version"
    New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

    # Copy all installers
    if ($Artifacts.Windows) {
        Copy-Item $Artifacts.Windows $DistDir/
    }
    if ($Artifacts.macOS) {
        Copy-Item $Artifacts.macOS $DistDir/ -Recurse
    }
    if ($Artifacts.Linux) {
        Copy-Item $Artifacts.Linux $DistDir/ -Recurse
    }

    # Copy documentation
    Copy-Item "plugins/$PluginName/README.md" $DistDir/ -ErrorAction SilentlyContinue
    Copy-Item "CHANGELOG.md" $DistDir/ -ErrorAction SilentlyContinue
    New-LicenseFile -PluginName $PluginName -OutputPath "$DistDir/LICENSE.txt"

    # Create unified README
    @"
# $PluginName v$Version

## Installation

### Windows
Run the `$PluginName-$Version-Setup.exe` installer and follow the prompts.
You can customize the installation location during setup.

### macOS
Option 1: Open `$PluginName-$Version-macOS.dmg` and drag to Applications
Option 2: Run `$PluginName-$Version-macOS.pkg` for system-wide installation

### Linux
Option 1: Run the AppImage directly (no installation required)
Option 2: Install the .deb package with: `sudo dpkg -i $PluginName-$Version.deb`

## Supported Formats
- VST3 (Windows, macOS, Linux)
- AU (macOS only)
- LV2 (Linux only)
- Standalone (all platforms)

## License
See LICENSE.txt for full license terms.
"@ | Set-Content "$DistDir/INSTALL.md"

    # Create final ZIP
    Compress-Archive -Path "$DistDir/*" -DestinationPath "dist/$PluginName-v$Version.zip" -Force

    Write-Host "`n✓ Distribution package created:" -ForegroundColor Green
    Write-Host "  Location: $DistDir" -ForegroundColor Yellow
    Write-Host "  Archive: dist/$PluginName-v$Version.zip" -ForegroundColor Yellow
}
```

### 7.2 Update State

```powershell
Update-PluginState -PluginPath "plugins/$PluginName" -Phase "ship_complete" -Updates @{
    "version" = $Version
    "validation.ship_ready" = $true
    "distribution.platforms" = $SelectedPlatforms
    "distribution.local_build" = $PlatformsUsingLocal
    "distribution.github_build" = $PlatformsNeedingGitHub
}
```

---

## GitHub Actions Workflow Template

**File:** `.github/workflows/build-release.yml`

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      plugin_name:
        description: 'Plugin name to build'
        required: true
      platforms:
        description: 'Platforms to build (windows,macos,linux,all)'
        default: 'all'

jobs:
  build-windows:
    if: github.event.inputs.platforms == 'all' || contains(github.event.inputs.platforms, 'windows')
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: ilammy/msvc-dev-cmd@v1
      - name: Configure
        run: cmake -S . -B build -G "Visual Studio 17 2022" -A x64
      - name: Build VST3
        run: cmake --build build --config Release --target ${{ inputs.plugin_name }}_VST3
      - name: Build Standalone
        run: cmake --build build --config Release --target ${{ inputs.plugin_name }}_Standalone
      - uses: actions/upload-artifact@v4
        with:
          name: windows-${{ inputs.plugin_name }}
          path: build/*_artefacts/Release/*

  build-macos:
    if: github.event.inputs.platforms == 'all' || contains(github.event.inputs.platforms, 'macos')
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Configure
        run: cmake -S . -B build -G Xcode -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64"
      - name: Build All
        run: |
          cmake --build build --config Release --target ${{ inputs.plugin_name }}_VST3
          cmake --build build --config Release --target ${{ inputs.plugin_name }}_AU
          cmake --build build --config Release --target ${{ inputs.plugin_name }}_Standalone
      - uses: actions/upload-artifact@v4
        with:
          name: macos-${{ inputs.plugin_name }}
          path: build/*_artefacts/Release/*

  build-linux:
    if: github.event.inputs.platforms == 'all' || contains(github.event.inputs.platforms, 'linux')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Install deps
        run: |
          sudo apt-get update
          sudo apt-get install -y cmake libasound2-dev libfreetype6-dev \
            libgl1-mesa-dev libx11-dev libxcomposite-dev libxcursor-dev \
            libxext-dev libxinerama-dev libxrandr-dev libwebkit2gtk-4.0-dev
      - name: Configure
        run: cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
      - name: Build All
        run: |
          cmake --build build --target ${{ inputs.plugin_name }}_VST3
          cmake --build build --target ${{ inputs.plugin_name }}_LV2
          cmake --build build --target ${{ inputs.plugin_name }}_Standalone
      - uses: actions/upload-artifact@v4
        with:
          name: linux-${{ inputs.plugin_name }}
          path: build/*_artefacts/*
```

---

## Troubleshooting

### Issue: GitHub Actions workflow not found
**Solution:** Create `.github/workflows/build-release.yml` with the template above

### Issue: Inno Setup not installed
**Solution:** Download from https://jrsoftware.org/isdl.php or use ZIP distribution

### Issue: macOS/Linux installers can't be created on Windows
**Solution:** The skill prepares installer scripts that must be run on the target platform

### Issue: Build artifacts not found
**Solution:** Verify build completed successfully and check `build/` directory structure
