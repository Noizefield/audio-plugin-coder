# Audio Plugin Coder — Agent Guidance

## Scope

These instructions apply to the entire repository and are written for any coding agent that reads the `AGENTS.md` standard (Codex, Cursor, and others). Agents with their own APC configuration (Claude Code via `.claude/`, Kilo via `.kilocode/`) should treat that configuration as primary; this file stays consistent with it.

## First run

- New checkouts should start with **`/apc-setup`** (skill action `setup`) before creating plugins.
- Setup writes machine-local `apc.config.json` (see `apc.config.example.json`). Paths, UI defaults, and per-phase model preferences live there.
- Resolve plugin/build/release directories via `scripts/lib/Get-ApcPaths.ps1` or `scripts/lib/apc-paths.sh` — do not assume `./plugins` if config overrides exist.

## APC Workflow

- Use the `audio-plugin-coder` skill for APC lifecycle work.
- **Primary slash commands** are prefixed: `/apc-setup`, `/apc-dream`, `/apc-plan`, `/apc-design`, `/apc-impl`, `/apc-test`, `/apc-debug`, `/apc-ship`, `/apc-status`, `/apc-resume`, `/apc-new`.
- Short forms (`/dream`, `/design`, `/impl`, …) remain as **deprecated aliases** that redirect to `/apc-*`.
- If the agent host does not expose slash commands, use the `audio-plugin-coder` skill or an equivalent natural-language request.

## Codex

- Invoke APC as `$audio-plugin-coder:audio-plugin-coder <action> <PluginName>` or use an equivalent natural-language request.
- Actions include `setup`, `dream`, `plan`, `design`, `impl`, `test`, `debug`, `status`, `resume`, `ship`, `new` (also accept `apc-dream` style names by stripping the `apc-` prefix).
- Never use Codex `/plan` or `/status` as APC workflow commands; those names are reserved by Codex built-ins. Prefer `/apc-plan` / `/apc-status` in docs, or the skill actions above.
- See `docs/codex-compatibility.md` for setup and the full command mapping.

## Required Context

- Before changing a plugin under the configured plugins directory, read its `status.json`.
- Read the relevant workflow and skill under `.claude/`; fall back to the matching `.agent/` file if needed.
- Also read `.claude/rules/juce-build-protocols.md` and `.claude/rules/file-naming-conventions.md` before implementation, build, or packaging work.
- Preserve the selected `ui_framework`: Visage work must not introduce WebView files, and WebView work must not introduce Visage controls.
- Announce the preferred model from `apc.config.json` → `models.phases.<phase>` at phase start (see `docs/model-routing.md`).

## Platform Rules

- Detect the host OS before choosing commands.
- Use PowerShell and `.ps1` scripts on Windows.
- Use Bash/Zsh and `.sh` scripts on macOS or Linux.
- Do not copy a PowerShell example from an APC workflow verbatim on macOS or Linux; use the equivalent shell function or script.

## Phase Gates

- Complete only the requested APC phase.
- Validate the prior phase before writing files.
- Back up plugin state before implementation, debugging, or packaging changes.
- Update `status.json` through the platform state-management script when a phase completes.
- Stop after the requested phase instead of automatically starting the next phase.
- If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

## Build and Validation

- Run build operations from the repository root.
- Do not invoke raw `cmake`, `xcodebuild`, `msbuild`, or compiler commands for normal APC builds.
- Use `scripts/build-and-install.ps1` on Windows or `scripts/build-and-install.sh` on macOS/Linux (they honor `apc.config.json` paths).
- Start with the narrowest validation relevant to the changed plugin.
- Do not alter unrelated generated plugins, build artifacts, or user debug output.
- APC targets **JUCE 9** (`_tools/JUCE`). WebView interop: `@juce-framework/webview` or `native/typescript/webview-interop/dist/index.js`.
