# Changelog

All notable changes to Audio Plugin Coder (APC) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.3.0] - 2026-03-23

### Added

- **macOS Support** (PR #6 by vjcharles)
  - `scripts/build-and-install.sh` — macOS build script (Xcode generator, matches PS1 feature parity)
  - `scripts/state-management.sh` — Bash port of the state management module
  - `scripts/error-detection.sh` — Bash port of the error detection and known-issues lookup
  - `scripts/backup.sh` / `scripts/rollback.sh` — Backup and rollback for macOS
  - `scripts/preview-design.sh` — Design preview script for macOS
  - `scripts/system-check.sh` — System dependency checker for macOS (Xcode, CMake, JUCE)
  - `scripts/installer/create-macos-installer.sh` — DMG installer creation script for macOS
  - `notes/PLAN1-macos.md` / `notes/PLAN1-results.md` — Contributor's porting notes

- **npx Installer** (`npx audio-plugin-coder@latest`)
  - One-command setup: clones the repo and guides through initial configuration
  - Platform-aware: detects Windows, macOS, and Linux and shows relevant next steps
  - Checks for required tools (Git, Node.js, VS Code, CMake, VS Build Tools / Xcode / GCC)
  - Zero dependencies — pure Node.js stdlib
  - Works direct from GitHub: `npx github:Noizefield/audio-plugin-coder`

- **Versioning**
  - Added `package.json` with semantic versioning
  - Git tags now used to mark releases (e.g., `v0.3.0`)

### Changed

- **Agent rules updated for cross-platform awareness** (PR #6)
  - `agent.md`: OS detection logic — uses PowerShell on Windows, Bash on macOS; never mixes shells
  - `juce-build-protocols.md`: Platform notes for macOS Xcode generator and macOS CI requirements
  - `file-naming-conventions.md`: Script extension guidance (`.ps1` on Windows, `.sh` on macOS)

### Security

- **Tightened Claude Code permissions** (PR #6, prompt injection audit by vjcharles)
  - Removed overly broad wildcards: `powershell:*`, `powershell -Command:*`, `python:*`
  - Added explicit deny list:
    - `curl`, `wget`, `Invoke-WebRequest` — blocks external network calls by agent
    - `Invoke-Expression`, `iex` — blocks PowerShell eval
    - Piping to `bash` / `sh` — blocks shell injection
    - `~/.ssh`, `~/.aws` — blocks credential file access
    - `base64 -d` — blocks common exfiltration encoding
    - `python -c`, `python3 -c`, `node -e` — blocks inline code execution

---

## [0.2.0] - 2026-02-15

### Added

- **FFGL Bridge Template** (PR #2 by 12Matt3r)
  - FreeFrameGL 2.0 plugin template for VJ software (Resolume, VDMX, TouchDesigner)
  - JUCE 8 integration with parameter handling via `AudioProcessorValueTreeState`
  - OpenGL rendering with host-provided context
  - Thread-safe parameter caching for real-time performance
  - One-click setup scripts (`scripts/setup_bridges.ps1`, `scripts/setup_bridges.bat`)

- **Max/MSP External Template** (PR #2 by 12Matt3r)
  - Max/MSP external template using Cycling '74 Min-API
  - JUCE 8 DSP and UI integration
  - Double-precision audio processing support
  - Native window handle extraction for UI embedding
  - Floating window fallback for UI display

- **Consolidated Templates Folder**
  - All templates moved to single root `templates/` folder
  - `templates/visage/` — Visage (C++) UI templates
  - `templates/webview/` — WebView (HTML5) UI templates
  - `templates/ffgl/` — FFGL visual plugin templates
  - `templates/max-external/` — Max/MSP external templates
  - `templates/status-template.json` — Plugin state tracking template

- **Visage Integration**
  - `APC_ENABLE_VISAGE` CMake option and optional subdirectory wiring
  - `scripts/validate-visage-setup.ps1` validation script
  - Visage gnarly3 pilot UI (experimental): knob interaction, live filter graph
  - Windowless preview rendering path for stability

- **CloudWash Plugin** — granular texture processor (Mutable Instruments Clouds adaptation)
  - 4 processing modes: Granular, Pitch Shifter, Looping Delay, Spectral
  - WebView-based UI with real-time visualization
  - 13 parameters with JUCE backend integration
  - Noizefield branding with clickable logo (opens external browser)
  - 300+ line `USER_MANUAL.md`

- **Automatic Documentation System**
  - `Documentation/` folder auto-created per plugin; all files auto-included in installer
  - Start Menu shortcuts to User Manual and Documentation folder
  - New guide: `.claude/guides/documentation-system.md`

- **WebView External URL Support**
  - Plugins can open URLs in the system's default browser
  - Implemented via `window.__JUCE__.backend.emitEvent()` and `juce::URL::launchInDefaultBrowser()`

- **GitHub Actions CI/CD**
  - `.github/workflows/build-release.yml` — release builds for Windows, macOS, Linux
  - `.github/workflows/build-pr.yml` — PR validation with automatic plugin detection
  - Platform selection via workflow_dispatch
  - Automatic GitHub Release creation on git tags

- **CMake Cross-Platform Support**
  - Platform detection in root `CMakeLists.txt`
  - Windows: VST3 + Standalone, macOS: VST3 + AU + Standalone (Universal), Linux: VST3 + LV2 + Standalone
  - WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux)

- **Windows Installer**
  - Inno Setup template (`scripts/installer/installer-template.iss`)
  - PowerShell generator (`scripts/installer/create-windows-installer.ps1`)
  - EULA, component selection (VST3, Standalone, Presets, Docs), shortcuts, uninstaller

- **Troubleshooting Auto-Capture System**
  - Known issues database (`.claude/troubleshooting/known-issues.yaml`)
  - Auto-documents solutions after 3 failed attempts

- **State Management System**
  - `status.json` tracking for all plugins
  - Phase gating, validation, backup, and rollback

### Changed

- Design phase branches by framework: WebView → HTML preview; Visage → C++ scaffold (no HTML)
- Implementation phase routes templates by framework and runs Visage validation
- Build/preview scripts auto-enable `APC_ENABLE_VISAGE` when `ui_framework == visage`
- Agent folders (`.kilocode`, `.claude`, `.agent`) synchronized with consistent content
- Windows installer now 64-bit only (`ArchitecturesAllowed=x64compatible`)
- Documentation placed inside plugin bundle (keeps VST3 root clean)

### Fixed

- WebView UI integration and parameter binding for CloudWash
- Visage preview input routing (knobs receive mouse events)
- Desktop shortcuts now display correct plugin icon
- VST3 plugins install to 64-bit Program Files (not x86)
- Linux CI: added `NEEDS_WEB_BROWSER`, JACK deps, and C language requirement
- macOS CI: removed per-target `XCODE_ATTRIBUTE_ARCHS` (conflicts with global `CMAKE_OSX_ARCHITECTURES`)
- LV2/Standalone CI: wrapped builds with `xvfb-run` for headless display

---

## [0.1.0-beta] - 2026-01-31

### Added

- Initial public beta release
- Five-phase workflow system (Dream → Plan → Design → Implement → Ship)
- Dual UI framework support: Visage (pure C++) and WebView (HTML5/JS)
- JUCE 8 integration with CMake build system
- PowerShell automation scripts for Windows
- Agent-agnostic design: works with Claude Code, Antigravity, and Kilo
- Comprehensive skill system (ideation, architecture, design, DSP, packaging)
- Workflow orchestration with slash commands (`/dream`, `/plan`, `/design`, `/impl`, `/ship`)
- File naming conventions and project structure standards
- Windows 11 support with Visual Studio 2022

### Known Limitations at Release
- Visage UI framework scaffolding only (full implementation planned)
- macOS and Linux support pending
- VST2, Audio Unit (AU), and CLAP formats not supported

---

## Release Notes

### Version Numbering
- **Major.Minor.Patch** format following [Semantic Versioning](https://semver.org/)
- **Beta suffix** during pre-1.0 development (e.g., `0.1.0-beta`)
- Git tags mark each release (`v0.3.0`, `v0.2.0`, etc.)

### Support
For issues, feature requests, or questions:
- GitHub Issues: https://github.com/Noizefield/audio-plugin-coder/issues
- Discussions: https://github.com/Noizefield/audio-plugin-coder/discussions

---

**Built with love for the audio development community**
