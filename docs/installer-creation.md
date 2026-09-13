# Installer Creation Guide

This guide is the per-platform installer how-to for the [Ship phase](ship-workflow.md) (`/apc-ship`).
Ship orchestrates the end-to-end flow; this doc covers the installer tools themselves.

## Overview

| Platform | Status | Method | Location |
|----------|--------|--------|----------|
| Windows | ✅ Implemented | Inno Setup `.exe` | Local (Windows): `scripts/installer/create-windows-installer.ps1` |
| macOS | ⚠️ Scripted (run on macOS) | DMG | Local (macOS): `scripts/installer/create-macos-installer.sh` |
| Linux | ❌ Manual | AppImage/DEB | Requires Linux (see below) |

Output goes to the configured `paths.release_dir` (default `release/`).

---

## Windows Installer

### Prerequisites

1. **Inno Setup** installed
   - Download: https://jrsoftware.org/isdl.php
   - Install with default settings

2. **Plugin built successfully**
   - VST3 and Standalone targets compiled

### Creating the Installer

```powershell
# Navigate to project root
# Run the installer creation script
.\scripts\installer\create-windows-installer.ps1 -PluginName [Plugin Name] -Version "1.0.0"
```

### Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `PluginName` | Yes | - | Plugin folder name |
| `Version` | Yes | - | Version number (e.g., "1.0.0") |
| `CompanyName` | No | "APC" | Company name |
| `PluginURL` | No | GitHub URL | Plugin website |

### Output

- **Location**: `release\{PluginName}-{Version}-Windows-Setup.exe`
- **Size**: ~5-20 MB (depends on plugin)

### Installer Features

- ✅ License agreement (EULA)
- ✅ Custom installation path
- ✅ Component selection (VST3, Standalone, Presets, Docs)
- ✅ Start Menu shortcuts
- ✅ Desktop shortcut option
- ✅ Uninstaller

### Installation Paths

```
VST3:     C:\Program Files\Common Files\VST3\{PluginName}.vst3
Standalone: C:\Program Files\{PluginName}\{PluginName}.exe
Presets:  C:\ProgramData\{PluginName}\Presets\
```

---

## macOS Installer (DMG via script, finalize on macOS)

### Status
⚠️ Scripted — must run on macOS (needs `hdiutil`; signing needs an Apple Developer certificate).

### Scripted creation

```bash
# On a Mac, from the repo root (honors paths.release_dir, default release/)
bash scripts/installer/create-macos-installer.sh <PluginName> <Version> [CompanyName]
```

This bundles the VST3, AU, and Standalone builds into `{PluginName}-{Version}-macOS.dmg`.

### Why it can't run on Windows
macOS installers require macOS-specific tools:
- `hdiutil` - DMG creation
- `pkgbuild` / `productbuild` - PKG creation (manual path below)
- `codesign` - Code signing
- Apple Developer certificate

### What You Can Do

1. **Build on GitHub Actions**
   - Workflow creates macOS binaries
   - Download artifacts to a Mac

2. **Manual Creation on macOS**
   ```bash
   # Create component packages
   pkgbuild --component Plugin.vst3 \
       --install-location "/Library/Audio/Plug-Ins/VST3" \
       Plugin-VST3.pkg
   
   # Create DMG
   hdiutil create -volname "Plugin Installer" \
       -srcfolder Plugin.app \
       -ov -format UDZO \
       Plugin.dmg
   ```

### Future Enhancement
Add macOS installer creation to GitHub Actions workflow (requires macOS runner with signing certificates).

---

## Linux Packages (NOT IMPLEMENTED)

### Status
❌ Cannot be created on Windows

### Why
Linux packages require Linux-specific tools:
- `appimagetool` - AppImage creation
- `dpkg-deb` - DEB package creation

### What You Can Do

1. **Build on GitHub Actions**
   - Workflow creates Linux binaries
   - Download artifacts to a Linux machine

2. **Manual Creation on Linux**
   ```bash
   # Create AppImage
   appimagetool AppDir/ Plugin.AppImage
   
   # Create DEB
   dpkg-deb --build deb-package/ Plugin.deb
   ```

### Future Enhancement
Add Linux package creation to GitHub Actions workflow.

---

## GitHub Actions Alternative

Currently, GitHub Actions creates **ZIP distributions** only:
- `Plugin-v1.0.0-Windows.zip`
- `Plugin-v1.0.0-macOS.zip`
- `Plugin-v1.0.0-Linux.zip`

### To Create Installers in CI/CD

Update `.github/workflows/build-release.yml` to:

1. **Windows**: Add Inno Setup step
2. **macOS**: Add DMG/PKG creation step
3. **Linux**: Add AppImage/DEB creation step

This would enable fully automated releases with installers.

---

## Troubleshooting

### "Inno Setup not found"

**Solution**: Install Inno Setup from https://jrsoftware.org/isdl.php

### "Build artifacts not found"

**Solution**: Build the plugin first:
```powershell
.\scripts\build-and-install.ps1 -PluginName CloudWash
```

### "Permission denied"

**Solution**: Run PowerShell as Administrator

---

## Summary

| Task | Status | How To |
|------|--------|--------|
| Windows Installer | ✅ Ready | Use `create-windows-installer.ps1` |
| macOS Installer | ⚠️ Scripted (run on Mac) | Use `create-macos-installer.sh` |
| Linux Packages | ❌ Manual | AppImage/DEB steps below |
| Automated CI/CD | ⚠️ Partial | ZIPs only, installers need implementation |
