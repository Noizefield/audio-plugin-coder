# macOS Support for Audio Plugin Coder

## Context
APC is a JUCE 8-based audio plugin generator that currently only supports Windows 11 (PowerShell scripts, Visual Studio, Inno Setup). The CMake build system and CI/CD workflows already support macOS, but all operational scripts (build, preview, install, system-check, backup, rollback, installer) are PowerShell-only. This plan adds standalone Bash equivalents for macOS.

## Scope

### New Files to Create (8 files)

1. **`scripts/build-and-install.sh`** — macOS master build script
   - CMake configure with `-G Xcode -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" -DCMAKE_OSX_DEPLOYMENT_TARGET=10.13`
   - Build VST3, AU, and Standalone targets
   - Install VST3 to `~/Library/Audio/Plug-Ins/VST3/`
   - Install AU to `~/Library/Audio/Plug-Ins/Components/`
   - Install Standalone to `/Applications/` (optional)
   - Read `status.json` for framework detection (visage vs webview)
   - Skip Windows-specific icon embedding and PluginVal (not available on macOS out of the box)

2. **`scripts/preview-design.sh`** — macOS GUI preview
   - Build Standalone target with Xcode generator
   - Launch `.app` bundle via `open` command
   - Read `status.json` for framework flags

3. **`scripts/system-check.sh`** — macOS dependency validation
   - Detect macOS version via `sw_vers`
   - Check for Xcode (`xcode-select -p`)
   - Check for CMake
   - Check for JUCE in `_tools/JUCE`
   - Check for Python
   - Output JSON (matching PowerShell script format)

4. **`scripts/backup.sh`** — macOS plugin backup
   - Port of `backup.ps1`: stage files, exclude build artifacts, zip to `_backups/`
   - Uses `zip` command instead of `Compress-Archive`

5. **`scripts/rollback.sh`** — macOS plugin rollback
   - Port of `rollback.ps1`: find backup by version, restore
   - Uses `unzip` instead of `Expand-Archive`

6. **`scripts/installer/create-macos-installer.sh`** — DMG creator
   - Create a DMG containing VST3 bundle, AU component, Standalone app
   - Use `hdiutil` for DMG creation
   - Include a simple background/layout for drag-to-install UX
   - Output to `dist/PluginName-Version-macOS.dmg`

7. **`scripts/state-management.sh`** — Bash port of state management
   - Functions: `get_plugin_state`, `update_plugin_state`, `test_plugin_state`, `backup_plugin_state`
   - Uses `jq` for JSON manipulation (will check for `jq` availability)
   - Sourced by other scripts (`. scripts/state-management.sh`)

8. **`scripts/error-detection.sh`** — Bash port of error detection
   - Functions: `parse_build_errors`, `find_known_issue`
   - Pattern matching against known-issues.yaml
   - Lighter weight than PowerShell version (no auto-execution of fixes)

### Files to Modify (3 files)

9. **`.claude/rules/agent.md`** — Update agent rules
   - Change "System" line to include macOS
   - Replace absolute "PowerShell Only" / "No Bash" rules with platform-aware rules
   - Add macOS build commands alongside Windows commands
   - Update Build Protocol section with macOS equivalents

10. **`.claude/rules/juce-build-protocols.md`** — Update build protocols
    - Update Section 1.B to acknowledge both shells
    - Clarify macOS commands in Section 3.D (already partially there)

11. **`.claude/rules/file-naming-conventions.md`** — Minor update
    - Note that path separators are `/` on macOS/Linux, `\` on Windows
    - Note `.sh` script equivalents exist

### Files NOT Changed
- `CMakeLists.txt` — already cross-platform
- `templates/CMakeLists.txt.template` — already cross-platform
- Plugin `CMakeLists.txt` files — already cross-platform
- `.github/workflows/` — already have macOS jobs
- Windows `.ps1` scripts — kept as-is, untouched

## Implementation Order

1. `scripts/state-management.sh` (dependency for other scripts)
2. `scripts/error-detection.sh` (dependency for build script)
3. `scripts/system-check.sh` (standalone, good first test)
4. `scripts/build-and-install.sh` (core script)
5. `scripts/preview-design.sh` (depends on build infra)
6. `scripts/backup.sh` and `scripts/rollback.sh` (simple ports)
7. `scripts/installer/create-macos-installer.sh` (DMG creation)
8. Update `.claude/rules/` documentation (agent.md, juce-build-protocols.md, file-naming-conventions.md)

## Key Technical Decisions

- **Xcode generator** for CMake (matches CI/CD and produces universal binaries)
- **Universal binary** support: `x86_64;arm64` via `CMAKE_OSX_ARCHITECTURES`
- **Deployment target**: macOS 10.13 (matches CI workflow)
- **jq dependency**: Required for JSON manipulation in Bash; `system-check.sh` will verify it's installed (available via `brew install jq`)
- **No PluginVal**: The PowerShell pluginval integration downloads a Windows binary; macOS version exists but we'll skip automated validation for now (can be added later)
- **DMG installer**: Uses `hdiutil` (built into macOS), no third-party tools needed
- **AU plugin format**: macOS builds include AudioUnit in addition to VST3

## Verification

1. Run `bash scripts/system-check.sh` on macOS — should output JSON with platform/tool detection
2. Run `bash scripts/build-and-install.sh PluginName` — should configure, build, and install VST3+AU
3. Run `bash scripts/preview-design.sh PluginName` — should build and launch standalone
4. Run `bash scripts/backup.sh PluginName 1.0` — should create zip in `_backups/`
5. Run `bash scripts/installer/create-macos-installer.sh PluginName 1.0.0` — should produce DMG in `dist/`
6. Verify agent rules are platform-aware and don't block Bash usage on macOS
