# build-005: FetchContent fails — stale `_deps` after `build_dir` relocation

**Date:** 2026-09-19
**Plugin/context:** Myriaplex `/apc-design` preview (`preview-design.ps1`), Visage framework

## Symptoms

`preview-design.ps1` configure step fails:

```
-- VISAGE: Downloading graphics dependencies
CMake Error at .../FetchContent.cmake:1906 (message):
  CMake step for bgfx failed: 1
```

Running the generated populate script manually shows the real failure:

```
Had to git clone more than once: 3 times.
CMake Error at .../bgfx-populate-gitclone.cmake:50 (message):
  Failed to clone repository: 'https://github.com/bkaradzic/bgfx.cmake.git'
```

A manual `git clone` of the same repo works fine — the network is not the problem.

## Root cause

`apc.config.json` → `paths.build_dir` had been changed from the repo-local `build/` to `../apc_builds`. The new build dir's `_deps/` tree was populated earlier under the *old* location (or copied over). The generated `*-subbuild/*/tmp/*-populate-gitclone.cmake` scripts **hardcode absolute paths** of the build dir they were generated in (`audio-plugin-coder/build/_deps/...`).

When the populate step ran the stale script, `execute_process(git clone ...)` used `WORKING_DIRECTORY "audio-plugin-coder/build/_deps"` — which no longer existed — so git.exe could not even start, producing a 3x retry then "Failed to clone repository".

## Solution

```powershell
# From repo root (Windows)
Remove-Item -Recurse -Force "<build_dir>\_deps"
# then re-run the preview/build script
.\scripts\preview-design.ps1 -PluginName <Name>
```

With `_deps` gone, the configure step regenerates the subbuild scripts with correct absolute paths and re-fetches bgfx/freetype normally.

Verified: after deleting `R:\_VST_Development_2026\apc_builds\_deps`, configure + standalone build + launch all succeeded.

## Prevention

- Never copy/move `_deps` between build directories — it is not portable (absolute paths baked into generated scripts).
- After changing `paths.build_dir` (or `plugins_dir`) in `apc.config.json`, delete the target's `_deps` once before the first configure.
