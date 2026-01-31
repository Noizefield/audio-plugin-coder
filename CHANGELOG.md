# Changelog

All notable changes to Audio Plugin Coder (APC) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CloudWash plugin: Full-featured granular texture processor (Mutable Instruments Clouds adaptation)
  - 4 processing modes (Granular, Pitch Shifter, Looping Delay, Spectral)
  - WebView-based UI with real-time visualization
  - 13 parameters with JUCE backend integration
  - Noizefield branding integration
- Troubleshooting auto-capture system
  - Known issues database (`.claude/troubleshooting/known-issues.yaml`)
  - Auto-documentation of solutions after 3 failed attempts
  - Self-improving issue resolution
- State management system
  - `status.json` tracking for all plugins
  - Phase gating and validation
  - Backup and rollback capabilities

### Changed
- Improved README with correct repository links
- Updated logo URL to point to Noizefield organization
- Fixed LICENSE reference (now points to LICENCE.md)

### Fixed
- WebView UI integration for CloudWash
- Parameter binding between C++ backend and JavaScript frontend
- Grain visualization connected to real audio processing
- Build and installation scripts for Windows 11

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
