# GitHub Actions CI/CD Documentation

This guide covers the GitHub Actions workflows used for cross-platform plugin builds in APC.

## Overview

APC uses GitHub Actions to build plugins for platforms you don't have local access to. This enables:

- **Windows developers** to build macOS and Linux versions
- **macOS developers** to build Windows and Linux versions
- **Linux developers** to build Windows and macOS versions
- **Automatic PR validation** across all platforms

## Workflows

### 1. Build and Release (`build-release.yml`)

**Purpose:** Create release builds for distribution

**Triggers:**
- Tag push (`v*`)
- Manual workflow dispatch

#### Manual Trigger Parameters

| Parameter | Type | Description | Options |
|-----------|------|-------------|---------|
| `plugin_name` | string | Name of plugin folder | Any plugin in `plugins/` |
| `platforms` | choice | Platforms to build | `all`, `windows`, `macos`, `linux`, `windows,macos`, `windows,linux`, `macos,linux` |

#### Platform Selection Examples

**Build all platforms:**
```
plugin_name: CloudWash
platforms: all
```

**Build only macOS and Linux (skip Windows):**
```
plugin_name: CloudWash
platforms: macos,linux
```

**Build only Windows:**
```
plugin_name: CloudWash
platforms: windows
```

### 2. Build PR (`build-pr.yml`)

**Purpose:** Validate pull request changes

**Triggers:**
- Pull request to `main`, `master`, or `develop`
- Push to `main`, `master`, or `develop`

**Features:**
- Automatically detects which plugins changed
- Builds only affected plugins
- Runs on all three platforms simultaneously
- Posts build summary to PR

## Build Jobs

### Windows Build

**Runner:** `windows-latest`

**Steps:**
1. Checkout repository with submodules
2. Setup MSVC compiler
3. Configure CMake with Visual Studio 2022
4. Build VST3 target
5. Build Standalone target
6. Upload artifacts

**Outputs:**
- `{PluginName}.vst3` bundle
- `{PluginName}.exe` standalone

### macOS Build

**Runner:** `macos-latest`

**Steps:**
1. Checkout repository with submodules
2. Install CMake via Homebrew
3. Configure CMake with Xcode (Universal Binary)
4. Build VST3 target
5. Build AU target
6. Build Standalone target
7. Upload artifacts

**Outputs:**
- `{PluginName}.vst3` bundle
- `{PluginName}.component` (AU)
- `{PluginName}.app` standalone

**Universal Binary:**
Built for both `x86_64` (Intel) and `arm64` (Apple Silicon) architectures.

### Linux Build

**Runner:** `ubuntu-latest`

**Steps:**
1. Checkout repository with submodules
2. Install dependencies (ALSA, Freetype, OpenGL, X11, WebKitGTK)
3. Configure CMake
4. Build VST3 target
5. Build LV2 target
6. Build Standalone target
7. Upload artifacts

**Outputs:**
- `{PluginName}.vst3` bundle
- `{PluginName}.lv2` bundle
- `{PluginName}` standalone binary

## Release Job

The release job runs after all platform builds complete (successfully or not).

**Features:**
- Downloads all platform artifacts
- Creates platform-specific ZIP files
- Creates GitHub Release (if triggered by tag)
- Uploads artifacts for manual triggers

**ZIP Structure:**
```
{PluginName}-{Version}-Windows.zip
├── {PluginName}.vst3/
└── {PluginName}.exe

{PluginName}-{Version}-macOS.zip
├── {PluginName}.vst3/
├── {PluginName}.component/
└── {PluginName}.app/

{PluginName}-{Version}-Linux.zip
├── {PluginName}.vst3/
├── {PluginName}.lv2/
└── {PluginName}
```

## Using the Workflows

### Triggering a Manual Build

1. Go to your GitHub repository
2. Click the **Actions** tab
3. Select **"Build and Release"** from the left sidebar
4. Click the **"Run workflow"** button
5. Fill in the parameters:
   - **Plugin name**: Enter the exact folder name from `plugins/`
   - **Platforms**: Select which platforms to build
6. Click **"Run workflow"**

### Monitoring Build Progress

1. Click on the running workflow
2. View individual job logs:
   - `build-windows` - Windows build log
   - `build-macos` - macOS build log
   - `build-linux` - Linux build log
   - `release` - Packaging and release creation

### Downloading Artifacts

**For manual triggers:**
1. Wait for workflow to complete
2. Click on the completed workflow run
3. Scroll to "Artifacts" section
4. Download `release-{PluginName}`

**For tag pushes:**
1. Go to repository **Releases**
2. Find the release for your tag
3. Download platform-specific ZIP files

## Workflow Configuration

### Environment Variables

```yaml
env:
  BUILD_TYPE: Release
```

All builds use Release configuration for optimal performance.

### Artifact Retention

- **Release builds:** 30 days
- **PR builds:** 7 days

### Job Conditions

Each platform job has a condition:

```yaml
if: github.event.inputs.platforms == 'all' || contains(github.event.inputs.platforms, 'windows')
```

This ensures jobs only run when:
- `all` platforms selected, OR
- The specific platform is in the selection

### Release Job Condition

```yaml
if: always() && (needs.build-windows.result == 'success' || needs.build-macos.result == 'success' || needs.build-linux.result == 'success')
```

The release job runs even if some builds fail, packaging only successful builds.

## Advanced Usage

### Triggering from Command Line

Using GitHub CLI:

```bash
# Trigger with specific platforms
gh workflow run build-release.yml \
  -f plugin_name=CloudWash \
  -f platforms=macos,linux

# Trigger all platforms
gh workflow run build-release.yml \
  -f plugin_name=CloudWash \
  -f platforms=all
```

### Creating a Release with Tag

```bash
# Create and push tag
git tag -a v1.0.0-CloudWash -m "Release CloudWash v1.0.0"
git push origin v1.0.0-CloudWash

# Workflow automatically triggers and creates GitHub Release
```

### Downloading Artifacts via CLI

```bash
# List recent runs
gh run list --workflow=build-release.yml

# Download artifacts from specific run
gh run download <run-id> --dir dist/github-artifacts

# Download with pattern
gh run download <run-id> --pattern "*CloudWash"
```

## Troubleshooting

### "Workflow not found"

**Cause:** Workflow file not in default branch

**Solution:** Ensure `.github/workflows/build-release.yml` is committed and pushed to `main`/`master`.

### "No artifacts uploaded"

**Cause:** Build failed or artifact path incorrect

**Solution:**
1. Check build job logs for errors
2. Verify plugin name matches folder name exactly
3. Check that CMakeLists.txt defines the targets correctly

### "Permission denied"

**Cause:** Workflow lacks write permissions

**Solution:** Ensure workflow has:
```yaml
permissions:
  contents: write
```

### macOS build fails with "Xcode not found"

**Cause:** macOS runner configuration issue

**Solution:** This is rare with `macos-latest`. Check GitHub Status page for outages.

### Linux build fails with missing dependencies

**Cause:** Missing system libraries

**Solution:** The workflow installs all required dependencies. If it fails, check the `Install Dependencies` step output.

## Customization

### Adding a New Platform

To add a new platform (e.g., iOS):

1. Add new job to workflow:
```yaml
build-ios:
  if: github.event.inputs.platforms == 'all' || contains(github.event.inputs.platforms, 'ios')
  runs-on: macos-latest
  steps:
    # iOS-specific build steps
```

2. Update release job needs:
```yaml
needs: [build-windows, build-macos, build-linux, build-ios]
```

3. Add platform option to workflow_dispatch inputs

### Changing Build Configuration

To change from Release to Debug:

```yaml
env:
  BUILD_TYPE: Debug
```

And update CMake configuration:
```yaml
- name: Configure CMake
  run: cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
```

### Adding Custom Build Steps

Add steps before or after existing ones:

```yaml
- name: Custom Pre-build Step
  run: |
    echo "Running custom setup..."
    # Your commands here

- name: Build VST3
  run: cmake --build build --config Release --target "${{ inputs.plugin_name }}_VST3"

- name: Custom Post-build Step
  run: |
    echo "Running custom cleanup..."
    # Your commands here
```
