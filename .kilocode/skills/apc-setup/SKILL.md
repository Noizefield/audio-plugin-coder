---
name: apc-setup
description: Guided first-run APC setup — toolchain, paths, models, JUCE verification. Trigger with /apc-setup or natural language "set up APC".
---

# APC Setup (`/apc-setup`)

**Trigger:** `/apc-setup` · `/setup` (deprecated alias) · "set up Audio Plugin Coder"

**Model preference:** economy / cheap (routing only). Read `apc.config.json` → `models.phases.setup` if present.

## Goal

Walk the user through a complete, cross-platform first-run configuration and write `apc.config.json`. Do **not** start a plugin phase.

## Preconditions

1. Workspace is an APC checkout (`CMakeLists.txt`, `scripts/`, `apc.config.example.json`).
2. Detect OS: Windows → PowerShell; macOS/Linux → Bash.

## Idempotency

If `apc.config.json` exists and `setup.completed` is true, ask the user to choose:

1. **Re-check only** — run system-check, report results
2. **Change paths** — update `paths.*` only
3. **Change models** — update `models.*` only
4. **Full wizard** — redo all steps (confirm before overwriting paths)

Never silently overwrite custom paths.

## Wizard steps

### 1. Welcome

Explain APC briefly and that this configures the framework (not a plugin).

### 2. Prerequisites

Run system-check:

- Windows: `.\scripts\system-check.ps1 -Human`
- macOS/Linux: `bash scripts/system-check.sh --human`

For each failing check, give install guidance:

| Check | Windows | macOS | Linux |
|---|---|---|---|
| Git | https://git-scm.com | Xcode CLT / brew | distro package |
| CMake ≥ 3.22 | https://cmake.org | `brew install cmake` | distro package |
| Node ≥ 18 | https://nodejs.org | `brew install node` | distro / nvm |
| Python ≥ 3.8 | python.org (not Store stub) | system / brew | distro |
| VS C++ | VS 2022 Build Tools | — | — |
| Xcode CLT | — | `xcode-select --install` | — |
| g++/clang | — | — | build-essential |
| WebView2 | Evergreen Runtime | WKWebView (system) | WebKitGTK + **libegl-dev** |
| JUCE ≥ 9 | submodule | submodule | submodule |

Re-run checks until critical tools pass (or user explicitly continues with warnings).

### 3. Submodules / tools

```powershell
git submodule update --init --recursive
```

```bash
git submodule update --init --recursive
```

Confirm `_tools/JUCE` major ≥ 9 via system-check. Ask whether Visage UI support is desired (`defaults.enable_visage`).

### 4. Path layout

Ask (defaults recommended for first-time users):

1. Keep `plugins/`, `build/`, `release/` inside the repo? **Yes (recommended)** / customize
2. If custom **plugins** path: absolute or relative to the repo root (e.g. `../apc_plugins`); create directory if missing. Scripts and APC workflows resolve via `Get-ApcPluginPath` / `apc_plugin_path` — a junction/symlink at `./plugins` is **optional** (legacy convenience only).
3. Custom **build** path (e.g. `../apc_builds`): warn against OneDrive/Dropbox/iCloud
4. Custom **release** path for installers/zips (e.g. `../apc_releases`; default `release/`)

Relative paths are resolved from the APC repo root. Absolute paths are also supported.

### 5. UI framework default

Ask preferred default for new plugins: `webview` (recommended) or `visage`. Store in `defaults.ui_framework_preference`.

### 6. AI model routing (global)

Offer presets, then allow per-phase overrides:

| Profile | plan | design | impl | ship |
|---|---|---|---|---|
| Quality | strongest | strong | strong | economy |
| Balanced (default) | strongest | strong | strong | economy |
| Budget | mid | mid | mid | economy |

Ask the user for **concrete model IDs** they can use in their agent (do not invent vendor-specific IDs they did not confirm). Store under `models.phases.*`.

Remind: many hosts cannot auto-switch models; APC will announce the preferred model at phase start.

### 7. Verify

1. Write `apc.config.json` (from answers; start from `apc.config.example.json`)
2. Re-run system-check
3. Optional smoke: configure CMake only into the configured build dir with `-DAPC_PLUGINS_DIR=...`
4. Set `setup.completed = true`, `setup.completed_at`, `setup.platform`

Helper scripts (prefer these over hand-writing JSON when possible):

- Windows: `.\scripts\apc-write-config.ps1` (see script help)
- Or edit JSON carefully with the path helpers in `scripts/lib/Get-ApcPaths.ps1`

### 8. Summary

Print:

- Resolved plugins / build / release paths
- JUCE major
- Model profile
- Next command: **`/apc-dream <PluginName>`**

Stop. Do not run dream.

## Soft gate for other phases

If another APC phase runs while `setup.completed` is false, **warn** once and offer `/apc-setup`, but do not hard-block power users who already have a working toolchain.
