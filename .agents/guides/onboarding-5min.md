# 5-Minute Onboarding: Fresh Clone to Green `apc doctor`

**Goal:** from `git clone` to a green `apc doctor` and a working `/apc-setup`, with the fewest decisions and one checklist per OS.

**Honest time budget:** the APC steps below take about five minutes. Installing a C++ toolchain for the first time (Visual Studio Build Tools, Xcode Command Line Tools) is a one-off download that is *not* counted in that figure. If you would rather not install anything locally, use the [dev container](#option-b-dev-container-linux-no-local-install) instead.

Status of this guide: the command lines were written against `scripts/system-check.{ps1,sh}` and `bin/apc.js`. Package-manager lines (`winget`, `brew`, `apt`) and the dev container have **not** been executed on a clean machine; see [What is verified](#what-is-verified).

---

## The checklist (every OS)

1. **Clone with submodules** (JUCE, pluginval, Visage and the CLAP extension are submodules):

   ```bash
   git clone --recurse-submodules https://github.com/Noizefield/audio-plugin-coder.git
   cd audio-plugin-coder
   ```

   Forgot `--recurse-submodules`? `node bin/apc.js doctor --fix` initialises them. On a slow link, fetch only the pinned JUCE tag instead (see [Shallow JUCE](#shallow-juce-pinned-tag-only)).

2. **Install the toolchain** for your OS (table below). `doctor --fix` never installs toolchains unsupervised; it prints the exact commands.

3. **Auto-fix the mechanical gaps:**

   ```bash
   node bin/apc.js doctor --fix
   ```

4. **Run the guided setup** in your AI host: `/apc-setup` (Claude Code, Kilo, Cursor, OpenCode, Devin) or `$audio-plugin-coder:audio-plugin-coder setup` (Codex). It writes the machine-local `apc.config.json` (paths, UI defaults, per-phase models).

5. **Verify:**

   ```bash
   node bin/apc.js doctor
   ```

   Green means every line is `[OK]` and the last line reads `apc.config.json setup completed`.

6. **Start building:** `/apc-dream MyFirstPlugin`.

---

## Per-OS toolchain

### Windows 10/11

Needs: Git, Node.js 18+, Python 3.8+, CMake 3.22+, Visual Studio 2022 with the *Desktop development with C++* workload, and the WebView2 runtime (preinstalled on Windows 11).

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Kitware.CMake -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
winget install --id Microsoft.EdgeWebView2Runtime -e
```

Open a **new** terminal afterwards so `PATH` is refreshed, then continue at step 3 of the checklist. Windows runs `scripts\system-check.ps1 -Human` behind `apc doctor`; its lines are: Git, Node.js, Python, Visual Studio C++, CMake, WebView2 Runtime, WebView2 SDK (NuGet), JUCE, pluginval.

### macOS

Needs: Xcode Command Line Tools, CMake 3.22+, Node.js 18+, Python 3.8+, `jq`. WebView uses the system WKWebView, nothing extra to install.

```bash
xcode-select --install
brew install cmake node python3 jq
```

### Linux (Ubuntu/Debian shown)

Needs: a C++20 compiler, CMake 3.22+, Node.js 18+, Python 3.8+, `jq`, and the JUCE system libraries (ALSA, X11, FreeType, FontConfig, GL, EGL, WebKitGTK 4.1 for WebView).

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake ninja-build git jq python3 pkg-config \
  libasound2-dev libjack-jackd2-dev libx11-dev libxext-dev libxrandr-dev libxinerama-dev \
  libxcursor-dev libxcomposite-dev libxrender-dev libfreetype-dev libfontconfig1-dev \
  libgl1-mesa-dev libegl-dev libwebkit2gtk-4.1-dev libcurl4-openssl-dev xvfb
```

Install Node.js 18+ from your distribution or [NodeSource](https://github.com/nodesource/distributions). `xvfb` is only needed for headless pluginval and Standalone smoke tests.

---

## Option B: dev container (Linux, no local install)

`.devcontainer/` builds an Ubuntu 24.04 image with the full Linux toolchain above, Node LTS, `xvfb` and pluginval. Open the repo in VS Code (or any dev-container host) and choose *Reopen in Container*.

On first create it runs `scripts/lib/juce-shallow-clone.sh` (fetches only the pinned JUCE tag) and then `node bin/apc.js doctor`. Then continue at step 4 of the checklist. Build and validation run inside the container; **DAW and audio-hardware testing do not**, so keep a host machine for listening tests. Docker was not available where this was authored, so the image build is unverified (see below).

---

## Shallow JUCE (pinned tag only)

The JUCE submodule is the largest download. When you have no git history (npx or zip installs) or the submodule init failed, fetch just the tag from `apc.config.json` (`juce.pin`):

```bash
bash scripts/lib/juce-shallow-clone.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\lib\juce-shallow-clone.ps1
```

Both are idempotent: if `_tools/JUCE` already holds the pinned tag they only verify it and exit 0. A *different* version is never overwritten without `--force` / `-Force`, and `--force` only fetches the tag into the existing checkout (nothing is deleted). After fetching, the tag and the version in `juce_StandardHeader.h` are cross-checked.

---

## What `apc doctor --fix` does

**Today** (`bin/apc.js`, `doctorFix`), all idempotent and non-destructive:

1. Creates `apc.config.json` from `apc.config.example.json` if missing.
2. Creates the configured `plugins_dir`, `build_dir` and `release_dir` if missing.
3. Initialises submodules (`git submodule update --init --recursive`) if `_tools/JUCE` is empty.
4. Prints the copy-paste toolchain install line for your OS. It does not run it.

**Proposed additions** (not implemented yet; the patch snippet is in the workstream report):

1. If the submodule route leaves `_tools/JUCE` empty (no `.git`, or the fetch failed), fall back to `scripts/lib/juce-shallow-clone.{sh,ps1}`.
2. If JUCE is present but not the pinned tag, warn and print the `--force` command rather than touching it.
3. Print the per-OS dev-container hint when `APC_DEVCONTAINER=1`.
4. Optionally (explicit `--install`, never implicit) run the package-manager line for the OS after a confirmation prompt.

---

## When a line is `[!!]`

| Line | Likely cause | Fix |
|------|--------------|-----|
| Git / Node.js / Python | not on `PATH` | install, then open a new terminal |
| Visual Studio C++ | Build Tools installed without the C++ workload | rerun the `winget` line with `--override` above, or add *Desktop development with C++* in the VS Installer |
| CMake | older than 3.22 | `winget upgrade Kitware.CMake` / `brew upgrade cmake` / distro backports |
| JUCE (>=9) | submodule empty | `node bin/apc.js doctor --fix`, or the shallow-clone script |
| pluginval | submodule empty or not built | `git submodule update --init _tools/pluginval`; see [build protocols](../rules/juce-build-protocols.md) |
| WebView2 SDK (NuGet) | NuGet package not restored | run the first build once; it restores the package |
| webkit / egl (Linux) | `-dev` packages missing | the `apt-get` line above |
| `Run /apc-setup` | no `apc.config.json` yet | step 4 of the checklist |

---

## What is verified

| Item | Status |
|------|--------|
| `apc doctor` output format and the Windows `[OK]` list | run on Windows 11 while authoring |
| `scripts/lib/juce-shallow-clone.sh` and `.ps1`: clone, idempotent re-run, version-mismatch refusal, `--force`, bad tag, header/tag disagreement | tested against a local fake JUCE origin (`test/docs-check.test.js`), bash and Windows PowerShell 5.1 |
| Fetching the real JUCE tag over the network | **UNVERIFIED** |
| `winget` / `brew` / `apt` lines | **UNVERIFIED** (written from vendor docs and `system-check` requirements, not run on clean machines) |
| `.devcontainer/devcontainer.json` | parses as JSON; **image build UNVERIFIED** (no Docker available) |
| macOS and Linux `apc doctor` runs | **UNVERIFIED** (authored on Windows) |
