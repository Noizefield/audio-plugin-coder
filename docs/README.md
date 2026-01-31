# APC Documentation

Welcome to the Audio Plugin Coder (APC) documentation. This guide covers everything you need to know about building, packaging, and distributing cross-platform audio plugins.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Build System](#build-system)
3. [GitHub Actions CI/CD](#github-actions-cicd)
4. [Ship Workflow](#ship-workflow)
5. [Platform Support](#platform-support)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### Prerequisites

- **Windows**: Visual Studio 2022, CMake 3.22+, PowerShell 7+
- **macOS**: Xcode, CMake 3.22+
- **Linux**: GCC, CMake 3.22+, development libraries

### Project Structure

```
audio-plugin-coder/
├── _tools/                 # JUCE, Visage, and other tools
├── docs/                   # This documentation
├── plugins/                # Your plugin projects
├── scripts/                # Build and utility scripts
├── .github/workflows/      # CI/CD configuration
└── CMakeLists.txt          # Root CMake configuration
```

---

## Build System

### Local Development Build

For Windows development:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName [Plugin Name]
```

Options:
- `-NoInstall` - Build without installing to system
- `-SkipTests` - Skip PluginVal validation
- `-Strict` - Fail on any validation warning

### CMake Configuration

The build system uses CMake with JUCE. Each plugin has its own `CMakeLists.txt`:

```cmake
juce_add_plugin(PluginName
    COMPANY_NAME "APC"
    FORMATS VST3 Standalone
    PRODUCT_NAME "Plugin Name"
    NEEDS_WEBVIEW2 TRUE
)
```

---

## GitHub Actions CI/CD

APC uses GitHub Actions for cross-platform builds. This allows you to build for macOS and Linux even when developing on Windows.

### Workflows

| Workflow | File | Purpose |
|----------|------|---------|
| Build Release | `.github/workflows/build-release.yml` | Create release builds for distribution |
| Build PR | `.github/workflows/build-pr.yml` | Validate PR changes |

### Triggering a Build

#### Option 1: Manual Trigger (Recommended)

1. Go to your GitHub repository
2. Click **Actions** tab
3. Select **"Build and Release"** workflow
4. Click **"Run workflow"**
5. Fill in the parameters:
   - **Plugin name**: Your plugin folder name (e.g., `CloudWash`)
   - **Platforms**: Choose which platforms to build

#### Platform Selection

When triggering manually, you can select specific platforms:

| Option | Builds |
|--------|--------|
| `all` | Windows, macOS, Linux |
| `windows` | Windows only |
| `macos` | macOS only |
| `linux` | Linux only |
| `windows,macos` | Windows + macOS |
| `windows,linux` | Windows + Linux |
| `macos,linux` | macOS + Linux |

**Use Case Example**: You're on Windows with a local build. You only need macOS and Linux from GitHub:
- Select `macos,linux` from the dropdown
- GitHub skips Windows, saving CI minutes

#### Option 2: Tag Push (Automatic Release)

Push a tag to automatically trigger a release build:

```bash
git tag -a v1.0.0-CloudWash -m "Release CloudWash v1.0.0"
git push origin v1.0.0-CloudWash
```

The workflow will:
1. Build for all platforms
2. Create platform-specific ZIP files
3. Create a GitHub Release with all artifacts

### Build Outputs

After a successful build, you'll find artifacts in:

- **GitHub Actions**: Download from the workflow run page
- **GitHub Release**: Attached to the release (if triggered by tag)

Artifacts are named:
- `{PluginName}-{Version}-Windows.zip`
- `{PluginName}-{Version}-macOS.zip`
- `{PluginName}-{Version}-Linux.zip`

---

## Ship Workflow

The Ship phase creates professional installers for distribution.

### Supported Platforms & Formats

| Platform | VST3 | AU | Standalone | LV2 | Build Method |
|----------|------|-----|------------|-----|--------------|
| Windows  | ✓    | -   | ✓          | -   | Local or GitHub |
| macOS    | ✓    | ✓   | ✓          | -   | GitHub only |
| Linux    | ✓    | -   | ✓          | ✓   | GitHub only |

### Shipping Process

#### Step 1: Complete Implementation

Ensure your plugin is complete:
- Phase 4 (CODE) finished
- All tests passing
- Local build successful

#### Step 2: Trigger Ship Workflow

```powershell
# Option 1: Use the skill
/ship CloudWash

# Option 2: Run manually
powershell -ExecutionPolicy Bypass -File .\scripts\ship-local.ps1 -PluginName CloudWash
```

#### Step 3: Platform Selection

The workflow will ask which platforms to include:

```
Current Platform: Windows
Local Build Status: Found

Select platforms to include:
[1] Current Platform - USE LOCAL BUILD
[2] Current Platform - BUILD WITH GITHUB ACTIONS  
[3] Windows - GITHUB ACTIONS
[4] macOS (VST3, AU, Standalone) - GITHUB ACTIONS
[5] Linux (VST3, LV2, Standalone) - GITHUB ACTIONS
[6] ALL PLATFORMS - Use local for current, GitHub for others

Enter numbers (comma-separated) or 'all':
```

**Example selections:**
- `1,4,5` - Use local Windows build, GitHub for macOS + Linux
- `6` - Use local for current platform, GitHub for all others
- `4,5` - Only build macOS and Linux on GitHub

#### Step 4: Wait for Builds

- **Local build**: Immediate, creates installer
- **GitHub Actions**: Monitor progress on GitHub

#### Step 5: Download Artifacts

For GitHub builds, download artifacts when complete:

```powershell
# Using GitHub CLI
gh run download --dir dist/github-artifacts --pattern "*-$PluginName"
```

#### Step 6: Create Installers

The workflow creates:
- **Windows**: `.exe` installer with license agreement
- **macOS**: `.zip` with VST3/AU bundles (prepare PKG/DMG on Mac)
- **Linux**: `.zip` with binaries (prepare AppImage/DEB on Linux)

#### Step 7: Final Distribution

Output structure:
```
dist/{PluginName}-v{version}/
├── {PluginName}-{version}-Windows-Setup.exe
├── {PluginName}-{version}-macOS.zip
├── {PluginName}-{version}-Linux.zip
├── README.md
├── CHANGELOG.md
├── LICENSE.txt
└── INSTALL.md
```

---

## Platform Support

### Windows

**Requirements:**
- Windows 10/11 64-bit
- WebView2 Runtime (pre-installed on Windows 11)
- VST3-compatible DAW

**Build locally:** Yes (native)
**Build via GitHub:** Yes

### macOS

**Requirements:**
- macOS 10.13+
- Intel or Apple Silicon (Universal Binary)
- VST3 or AU compatible DAW

**Build locally:** No (requires macOS)
**Build via GitHub:** Yes

### Linux

**Requirements:**
- Ubuntu 20.04+ or equivalent
- WebKitGTK
- VST3 or LV2 compatible DAW

**Build locally:** No (requires Linux)
**Build via GitHub:** Yes

---

## Troubleshooting

### GitHub Actions Issues

#### "Workflow not found"
Ensure `.github/workflows/build-release.yml` exists and is committed to the repository.

#### "No artifacts found"
Check that the plugin name matches exactly (case-sensitive).

#### Build fails on one platform
The release job will still package successful builds. Check individual job logs for errors.

### Local Build Issues

#### "CMake not found"
Install CMake 3.22 or later from https://cmake.org/download/

#### "JUCE not found"
Ensure submodules are initialized:
```bash
git submodule update --init --recursive
```

### Installer Issues

#### Inno Setup not found
Download and install from https://jrsoftware.org/isdl.php

#### macOS/Linux installers can't be created on Windows
These require their respective platforms for final packaging. The workflow prepares the structure; finalize on the target OS.

---

## Additional Resources

- [JUCE Documentation](https://docs.juce.com/)
- [VST3 SDK](https://developer.steinberg.help/display/VST/VST+3+Home)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

## Contributing

To contribute to APC:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

The PR workflow will automatically build and test your changes.
