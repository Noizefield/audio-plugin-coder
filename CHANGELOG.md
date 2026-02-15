# Changelog

All notable changes to Audio Plugin Coder (APC) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **FFGL Bridge Template** (from PR #2 by 12Matt3r)
  - FreeFrameGL 2.0 plugin template for VJ software (Resolume, VDMX, TouchDesigner)
  - JUCE 8 integration with parameter handling via `AudioProcessorValueTreeState`
  - OpenGL rendering with host-provided context
  - Thread-safe parameter caching for real-time performance
  - One-click setup scripts (`scripts/setup_bridges.ps1`, `scripts/setup_bridges.bat`)
  - GitHub Actions CI/CD workflow for cross-platform builds

- **Max/MSP External Template** (from PR #2 by 12Matt3r)
  - Max/MSP external template using Cycling '74 Min-API
  - JUCE 8 DSP and UI integration
  - Double-precision audio processing support
  - Native window handle extraction for UI embedding
  - Floating window fallback for UI display

- **Consolidated Templates Folder**
  - All templates now in single root `templates/` folder
  - `templates/visage/` - Visage (C++) UI templates
  - `templates/webview/` - WebView (HTML5) UI templates
  - `templates/ffgl/` - FFGL visual plugin templates
  - `templates/max-external/` - Max/MSP external templates
  - `templates/status-template.json` - Plugin state tracking template

- Visage integration scaffolding
  - `APC_ENABLE_VISAGE` CMake option and optional subdirectory wiring
  - `scripts/validate-visage-setup.ps1` validation script
  - Design workflow: Visage preview scaffold (no HTML), default yes
  - Implementation workflow: framework routing and Visage validation
  - Documentation updates for Visage preview flow and validation
- Visage gnarly3 pilot UI (experimental)
  - Knob interaction and parameter binding
  - Live filter graph with non-linear “gnarly” response
  - Windowless preview rendering path for stability
- CloudWash plugin: Full-featured granular texture processor (Mutable Instruments Clouds adaptation)
  - 4 processing modes (Granular, Pitch Shifter, Looping Delay, Spectral)
  - WebView-based UI with real-time visualization
  - 13 parameters with JUCE backend integration
  - Noizefield branding with clickable logo (opens https://noizefield.com in external browser)
  - Comprehensive 300+ line USER_MANUAL.md with full documentation
- **Automatic Documentation System**
  - `Documentation/` folder auto-created for all plugins
  - All files in Documentation/ automatically included in installer
  - Documentation placed inside plugin bundle (keeps VST3 root clean)
  - Start Menu shortcuts to User Manual and Documentation folder
  - Auto-generation of basic manual if folder is empty
  - Documentation system integrated into `/ship` workflow
  - New guide: `.claude/guides/documentation-system.md`
- **WebView External URL Support**
  - Plugins can now open URLs in system's default browser
  - Implemented via `window.__JUCE__.backend.emitEvent()` and `juce::URL::launchInDefaultBrowser()`
  - Example: CloudWash logo opens noizefield.com when clicked
- Troubleshooting auto-capture system
  - Known issues database (`.claude/troubleshooting/known-issues.yaml`)
  - Auto-documentation of solutions after 3 failed attempts
  - Self-improving issue resolution
- State management system
  - `status.json` tracking for all plugins
  - Phase gating and validation
  - Backup and rollback capabilities
- GitHub Actions cross-platform build workflow
  - Automated builds for Windows, macOS, and Linux
  - Manual trigger via workflow_dispatch
  - Automatic releases on git tags

### Changed
- **Template folder consolidation**
  - Moved all templates from `.agent/templates/`, `.claude/templates/`, `.kilocode/templates/` to root `templates/`
  - Updated all references in skill files, workflows, and troubleshooting docs to point to root `templates/`
  - Renamed `FFGL_Bridge` to `ffgl` and `Max_External` to `max-external` for consistent naming
  - Removed duplicate template folders from agent directories
- Design phase now branches by framework: WebView generates HTML preview; Visage avoids HTML and uses C++ scaffold
- Implementation phase now routes templates by framework and runs Visage validation for Visage plugins
- Build and preview scripts now auto-enable `APC_ENABLE_VISAGE` when `ui_framework == visage`
- **Installer template improvements**
  - Documentation now placed inside plugin bundle instead of VST3 root folder
  - Fixed desktop shortcut icons (now references icon.ico correctly)
  - Added Start Menu shortcuts to documentation
  - SetupIconFile now uses absolute path for reliability
  - Icon files copied to both VST3 and Standalone installation folders
- **File naming conventions updated**
  - Added `Documentation/` and `Assets/` to standard plugin structure
  - Standardized icon.ico location in `Assets/` folder
- CloudWash plugin enhancements
  - Updated user manual with platform information and APC credits
  - Clickable Noizefield logo in bottom-right corner

### Changed
- Improved README with correct repository links
- Updated logo URL to point to Noizefield organization
- Fixed LICENSE reference (now points to LICENCE.md)
- **Windows installer improvements**
  - Changed to 64-bit installation mode (`ArchitecturesAllowed=x64compatible`)
  - Installer now suggests `C:\Program Files\Common Files\VST3\` instead of x86 folder
  - Added icon.ico to installation files for uninstall display
  - Fixed `UninstallDisplayIcon` to show plugin icon in Windows "Add or Remove Programs"
  - Build script (`build-and-install.ps1`) now automatically embeds icons post-build

### Fixed
- WebView UI integration for CloudWash
- Parameter binding between C++ backend and JavaScript frontend
- Grain visualization connected to real audio processing
- Build and installation scripts for Windows 11
- Visage preview input routing (knobs receive mouse events)
- **Windows installer icon issues**
  - Desktop shortcuts now display correct plugin icon (not default Windows icon)
  - Executable files now have embedded icons visible in Windows Explorer
  - Uninstall entry in Windows Programs list now shows plugin icon
  - Fixed PowerShell script syntax errors (Unicode checkmark characters)
- **Installation path issues**
  - VST3 plugins now correctly install to 64-bit Program Files folder
  - Prevented installation to Program Files (x86) for 64-bit builds

---

## [0.2.0] - 2026-01-31

### Added

#### Cross-Platform Build System (Ship Workflow Improvement)
- **GitHub Actions CI/CD** for automated cross-platform builds
  - `.github/workflows/build-release.yml` - Release builds for Windows, macOS, Linux
  - `.github/workflows/build-pr.yml` - PR validation with automatic plugin detection
  - Platform selection support (Windows, macOS, Linux, or combinations)
  - Manual workflow dispatch with dropdown options
  - Automatic artifact packaging and GitHub Release creation

- **CMake Cross-Platform Support**
  - Platform detection in root `CMakeLists.txt` (Windows/macOS/Linux)
  - Platform-specific plugin format selection:
    - Windows: VST3, Standalone
    - macOS: VST3, AU, Standalone (Universal Binary)
    - Linux: VST3, LV2, Standalone
  - WebView backend selection per platform (WebView2, WKWebView, WebKitGTK)
  - macOS Universal Binary support (Intel + Apple Silicon)
  - Updated all plugin CMakeLists.txt files (CloudWash, AngelGrain, nf_gnarly, gnarly2)

- **Windows Installer Creation**
  - Inno Setup installer template (`scripts/installer/installer-template.iss`)
  - PowerShell installer generation script (`scripts/installer/create-windows-installer.ps1`)
  - License agreement (EULA) integration
  - Custom installation path selection
  - Component selection (VST3, Standalone, Presets, Documentation)
  - Start Menu and Desktop shortcuts
  - Uninstaller with complete removal

- **Documentation**
  - `docs/README.md` - Main documentation with build system overview
  - `docs/github-actions.md` - Detailed GitHub Actions usage guide
  - `docs/ship-workflow.md` - Ship phase documentation with platform selection
  - `docs/installer-creation.md` - Installer creation guide for all platforms
  - `templates/CMakeLists.txt.template` - Template for new plugins
  - `templates/LICENSE.txt.template` - EULA template for installers

### Changed
- **Ship Workflow** (`.kilocode/workflows/ship.md`)
  - Added platform selection prompt (local vs GitHub Actions)
  - Hybrid build approach (use local build + GitHub for other platforms)
  - Support for selective platform building to save CI minutes
  - Updated to reference detailed skill documentation

- **Skill Packaging** (`.kilocode/skills/skill_packaging/SKILL.md`)
  - Complete rewrite with cross-platform support
  - Step-by-step implementation guide
  - Platform detection and user interaction logic
  - GitHub Actions integration
  - PowerShell function implementations

### Known Limitations / Future Work

The following features were designed but not fully implemented:

- **Phase 4: macOS Installer Creation** - NOT IMPLEMENTED
  - Requires macOS for DMG/PKG creation (`hdiutil`, `pkgbuild`, `productbuild`)
  - Code signing requires Apple Developer certificate
  - Can be built on macOS using prepared structure from GitHub artifacts
  - **TODO**: Add macOS installer creation to GitHub Actions workflow

- **Phase 5: Linux Package Creation** - NOT IMPLEMENTED
  - Requires Linux for AppImage/DEB creation (`appimagetool`, `dpkg-deb`)
  - Can be built on Linux using prepared structure from GitHub artifacts
  - **TODO**: Add Linux package creation to GitHub Actions workflow

- **GitHub Actions Installer Creation** - NOT IMPLEMENTED
  - Current workflow creates ZIP distributions only
  - Windows installer (.exe) created locally via PowerShell script
  - **TODO**: Add installer creation steps to GitHub Actions for all platforms
  - This would enable fully automated release with installers

- **GitHub Actions Build Failures** - KNOWN ISSUES
  - macOS build fails: `JUCEModuleSupport.cmake` not found during CMake configuration
  - Linux build fails: `libwebkit2gtk` package compatibility issues on Ubuntu 24.04
  - **TODO**: Fix submodule checkout and WebKit package dependencies for CI builds
  - Windows builds are working correctly

---

## [0.1.0-beta] - 2026-01-31

### Added
- Initial public beta release
- Five-phase workflow system (Dream → Plan → Design → Implement → Ship)
- Dual UI framework support (Visage and WebView)
- JUCE 8 integration with CMake build system
- PowerShell automation scripts
- Agent-agnostic design (Claude Code, Antigravity, Kilo support)
- Comprehensive skill system:
  - Ideation and concept development
  - Architecture planning
  - UI design (both Visage and WebView)
  - DSP implementation
  - Packaging and distribution
- Workflow orchestration with slash commands
- File naming conventions and project structure standards
- Windows 11 support with Visual Studio 2022

### Known Limitations
- Visage UI framework not fully implemented (planned)
- macOS support pending
- Linux support pending
- VST2 format not supported
- Audio Unit (AU) format not supported
- CLAP format not supported

---

## Release Notes

### Version Numbering
- **Major.Minor.Patch** format (e.g., 1.0.0)
- **Alpha/Beta** suffixes during development (e.g., 0.1.0-beta)

### Support
For issues, feature requests, or questions:
- GitHub Issues: https://github.com/Noizefield/audio-plugin-coder/issues
- Discussions: https://github.com/Noizefield/audio-plugin-coder/discussions

---

**Built with ❤️ for the audio development community**
