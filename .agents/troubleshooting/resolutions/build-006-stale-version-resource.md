# Plugin reports the old version in Windows File Properties after a VERSION change

**Issue ID:** build-005
**Category:** build
**Severity:** medium
**First Detected:** 2026-09-25
**Resolution Status:** solved

---

## Problem Description

After `VERSION` changes (in `juce_add_plugin`, or the root project's version), the rebuilt
VST3 DLL and Standalone EXE still carry the old number in their Windows version resource
(Properties > Details > File version / Product version). The host sees the new version,
because `JucePlugin_VersionString` is a compile definition and does change.

## Symptoms

- `CMakeLists.txt` and `status.json` say the new version; File Properties show the old one
- A full rebuild (even with `--fresh`) does not change it
- `build\plugins\<Name>\<Name>_artefacts\JuceLibraryCode\<Name>_resources.rc` still contains
  `VALUE "FileVersion",  "<old>\0"` while `Info.txt` next to it has the new `VERSION`

## Root Cause

JUCE's CMake (`_juce_add_resources_rc` in `extras/Build/CMake/JUCEUtils.cmake`) generates the
`.rc` with `juceaide rcfile Info.txt <Name>_resources.rc` as a custom command whose only
dependency is the icon. Configure rewrites `Info.txt` with the new version, but nothing tells
MSBuild the `.rc` depends on it, so once the file exists it is never regenerated.

## Solution

### Quick Fix
```powershell
Get-ChildItem .\build\plugins\<Name> -Recurse -Filter <Name>_resources.rc | Remove-Item
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName <Name>
```
Only the `.rc` and the final link are redone.

### Permanent Fix (applied 2026-09-28)
`scripts/build-and-install.ps1` step 1b: after configure, compare the `.rc`'s `FileVersion`
with the `VERSION` record in `Info.txt` (records separated by ASCII 30, key and value by
ASCII 31) and delete the `.rc` when they differ, so the build regenerates it. Only on a
mismatch: regenerating it every build would force a full link-time-optimised relink every build.

## Verification

The build log prints `Version stamp says <old>, plugin is <new>: regenerating <Name>_resources.rc`
once after a version change, and nothing on later builds. File Properties show the new version.

## Prevention

Bump versions through `VERSION` in the plugin's `juce_add_plugin`; `build-and-install.ps1`
then takes care of the stamp. macOS and Linux have no `.rc`, so `build-and-install.sh` needs
no change.
