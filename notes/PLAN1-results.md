All done. Here's a summary of everything implemented:
                                                                                                                                                                     
  New Files Created (8)                                                                                                                                              
   
  #: 1                                                                                                                                                               
  File: scripts/state-management.sh                                            
  Description: Bash port of state management — jq-based JSON manipulation, all functions ported
  ────────────────────────────────────────
  #: 2
  File: scripts/error-detection.sh
  Description: Error detection with macOS compiler patterns (clang/ld instead of MSVC)
  ────────────────────────────────────────
  #: 3
  File: scripts/system-check.sh
  Description: macOS dependency validation — checks Xcode, CMake, Python, JUCE, jq; outputs JSON
  ────────────────────────────────────────
  #: 4
  File: scripts/build-and-install.sh
  Description: Master build script — Xcode generator, universal binary (x86_64+arm64), installs VST3 to ~/Library/Audio/Plug-Ins/VST3/, AU to
    ~/Library/Audio/Plug-Ins/Components/
  ────────────────────────────────────────
  #: 5
  File: scripts/preview-design.sh
  Description: Builds Standalone and launches .app via open -W
  ────────────────────────────────────────
  #: 6
  File: scripts/backup.sh
  Description: Clean zip backup using zip, excludes build artifacts
  ────────────────────────────────────────
  #: 7
  File: scripts/rollback.sh
  Description: Restore from backup using unzip, handles nested folder structure
  ────────────────────────────────────────
  #: 8
  File: scripts/installer/create-macos-installer.sh
  Description: DMG creator using hdiutil, includes VST3/AU/Standalone + install.command helper

  Files Modified (3)

  ┌──────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────┐
  │                   File                   │                                         Changes                                         │
  ├──────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ .claude/rules/agent.md                   │ Platform-aware OS/shell rules, macOS build commands, dual-platform maintenance commands │
  ├──────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ .claude/rules/juce-build-protocols.md    │ Dual-platform build commands and environment sections                                   │
  ├──────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────┤
  │ .claude/rules/file-naming-conventions.md │ Platform-aware path separators, .sh script equivalents noted                            │
  └──────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────┘

  Key Details

  - All 8 scripts pass bash -n syntax validation
  - system-check.sh tested live — outputs valid JSON with platform/tool detection
  - All scripts are chmod +x
  - CMake uses -G Xcode -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" -DCMAKE_OSX_DEPLOYMENT_TARGET=10.13
  - No Windows .ps1 scripts were modified
