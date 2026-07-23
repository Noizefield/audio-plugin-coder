# Audio Plugin Coder — Agent Guidance

## Scope

These instructions apply to the entire repository and are written for any coding agent that reads the `AGENTS.md` standard (Codex, Cursor, and others). Agents with their own APC configuration (Claude Code via `.claude/`, Kilo via `.kilocode/`) should treat that configuration as primary; this file stays consistent with it.

## APC Workflow

- Use the `audio-plugin-coder` skill for APC lifecycle work.
- APC commands such as `/dream`, `/design`, and `/impl` in the documentation are Claude Code/Kilo slash-command syntax. If your agent does not define them, use the `audio-plugin-coder` skill or an equivalent natural-language request instead.

## Codex

- Invoke APC as `$audio-plugin-coder:audio-plugin-coder <action> <PluginName>` or use an equivalent natural-language request.
- Never use Codex `/plan` or `/status` as APC workflow commands; those names are reserved by Codex built-ins.
- See `docs/codex-compatibility.md` for setup and the full command mapping.

## Required Context

- Before changing `plugins/<PluginName>/`, read its `status.json`.
- Read the relevant workflow and skill under `.claude/`; fall back to the matching `.agent/` file if needed.
- Also read `.claude/rules/juce-build-protocols.md` and `.claude/rules/file-naming-conventions.md` before implementation, build, or packaging work.
- Preserve the selected `ui_framework`: Visage work must not introduce WebView files, and WebView work must not introduce Visage controls.

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

## Build and Validation

- Run build operations from the repository root.
- Do not invoke raw `cmake`, `xcodebuild`, `msbuild`, or compiler commands for normal APC builds.
- Use `scripts/build-and-install.ps1` on Windows or `scripts/build-and-install.sh` on macOS/Linux.
- Start with the narrowest validation relevant to the changed plugin.
- Do not alter unrelated generated plugins, build artifacts, or user debug output.
