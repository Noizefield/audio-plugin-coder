# Installer Creation Guide

This guide covers how to create installers for all platforms.

## Overview

| Platform | Status | Method | Location |
|----------|--------|--------|----------|
| Windows | ✅ Implemented | Inno Setup | Local (Windows) |
| macOS | ❌ Not Implemented | DMG/PKG | Requires macOS |
| Linux | ❌ Not Implemented | AppImage/DEB | Requires Linux |

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

- **Location**: `dist\{PluginName}-{Version}-Windows-Setup.exe`
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

## macOS Installer (NOT IMPLEMENTED)

### Status
❌ Cannot be created on Windows

### Why
macOS installers require macOS-specific tools:
- `hdiutil` - DMG creation
- `pkgbuild` - PKG component creation
- `productbuild` - PKG distribution creation
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
| macOS Installer | ❌ Not Ready | Requires macOS |
| Linux Packages | ❌ Not Ready | Requires Linux |
| Automated CI/CD | ⚠️ Partial | ZIPs only, installers need implementation |
