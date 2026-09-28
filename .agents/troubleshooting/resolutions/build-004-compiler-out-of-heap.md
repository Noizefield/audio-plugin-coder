# MSVC C1060: compiler is out of heap space

**Issue ID:** build-004
**Category:** build
**Severity:** high
**First Detected:** 2026-09-08
**Resolution Status:** solved

---

## Problem Description

`build-and-install.ps1` fails while compiling the JUCE modules (not the plugin's own
sources) with dozens of `error C1060: compiler is out of heap space` lines from
`juce_core`, `juce_graphics`, `juce_gui_basics`, `juce_events`.

## Symptoms

- Every failing file is a JUCE module unity file (`juce_core.cpp`, `juce_graphics_Harfbuzz.cpp`, ...)
- Errors point into MSVC STL headers (`memory`, `sstream`) rather than into plugin code
- Machine has many logical cores (16+) and other large applications open

## Root Cause

`juce::juce_recommended_config_flags` adds `/MP` (compile every file of a project in
parallel on all logical cores) and `juce_recommended_lto_flags` adds `/GL`. A
link-time-optimised compile of a JUCE unity file needs roughly 1 to 2 GB. With 16 cores
that is 16 to 32 GB of compiler memory at once. The build script also configures with
`--fresh`, so every build recompiles all of JUCE.

## Solution

### Quick Fix
```powershell
# Fewer concurrent compiler instances for this build
$env:APC_BUILD_JOBS = 4
powershell -ExecutionPolicy Bypass -File .\scripts\build-and-install.ps1 -PluginName <Name>
```

### Permanent Fix (applied 2026-09-08, corrected 2026-09-28)
`scripts/build-and-install.ps1` sets `$env:_CL_ = "/MP<n>"` before configuring, where `n`
defaults to half the logical cores. cl.exe reads `_CL_` after its command line, so this
`/MP<n>` comes after JUCE's `/MP` and wins: MSBuild still parallelises across projects but
each project compiles with at most `n` files at once. (The first version of this fix used
`$env:CL`, which cl.exe reads *before* the command line, so JUCE's `/MP` still won.)

It also sets `$env:PreferredToolArchitecture = "x64"`, an MSBuild property that selects the
64-bit-hosted compiler. The 32-bit-hosted cl.exe stops at about 4 GB per process however
much RAM is free.

## Verification

Rerun the build; the log should show `Compiler jobs: <n>` near the top and no `C1060`.
In Task Manager, no more than `n` `cl.exe` processes per project run at once.

## Prevention

- Keep `APC_BUILD_JOBS` at or below `RAM_GB / 2`
- Close memory-heavy applications during a `--fresh` build
