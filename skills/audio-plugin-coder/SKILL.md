---
name: audio-plugin-coder
description: Run Audio Plugin Coder lifecycle actions for JUCE plugins, including setup, dream, plan, design, implement, test, debug, status, resume, ship, patch, and evolve. Use when the user asks to create or continue an APC audio plugin or mentions an APC phase.
---

# Audio Plugin Coder

Use this skill to run APC's phase-gated audio-plugin workflow in an Audio Plugin Coder checkout.

## Invocation

Prefer either form:

```text
$audio-plugin-coder:audio-plugin-coder setup
$audio-plugin-coder:audio-plugin-coder dream TapeDelay
$audio-plugin-coder:audio-plugin-coder plan TapeDelay
```

Natural-language requests such as "design the TapeDelay plugin" or "set up APC" also work.

Accept action names with or without an `apc-` prefix (`apc-dream` → `dream`).

Do not use bare `/plan` or `/status` spellings in Codex. Prefer skill actions or `/apc-plan` / `/apc-status`. Treat legacy short slash commands as deprecated aliases.

## Preconditions

1. Confirm the current workspace is an APC checkout by finding `templates/status-template.json`, `scripts/`, and `CMakeLists.txt`.
2. If those files are absent, explain that the workflow must run from an APC checkout and stop.
3. For plugin phases, determine the action and plugin name. Ask for a missing plugin name only when it cannot be inferred safely.
4. Resolve the plugins directory via `scripts/lib/Get-ApcPaths.ps1` / `scripts/lib/apc-paths.sh` (defaults to `./plugins`).
5. Before changing an existing plugin, read `<plugins_dir>/<PluginName>/status.json`.
6. If `apc.config.json` is missing or `setup.completed` is false and the action is not `setup`, warn once and suggest `setup` / `/apc-setup`.

## Load APC Instructions

Keep this adapter thin; load APC's existing knowledge just in time:

1. Read `AGENTS.md`.
2. Read `.agents/rules/juce-build-protocols.md` and `.agents/rules/file-naming-conventions.md` for implementation, build, test, debug, or ship actions.
3. Read the workflow and primary instruction file from the routing table.
4. If a routed `.agents/` file is missing, fall back to the equivalent host-shim path (`.claude/`, `.agent/`, `.kilocode/` — pointers to the same canonical files).
5. Resolve examples for the current OS: PowerShell on Windows, Bash/Zsh on macOS or Linux.
6. Announce preferred model from `apc.config.json` → `models.phases.<phase>` when present.
7. For automated Codex CLI cost routing (optional, not the default interactive path), see `docs/codex-orchestration.md` and `scripts/codex/apc-codex-run.ps1` / `.sh`. Do not nest `codex exec` under every interactive turn.

## Action Routing

| Action | Workflow | Primary instructions |
|---|---|---|
| `setup` | `.agents/workflows/apc-setup.md` | `.agents/skills/apc-setup/SKILL.md` |
| `dream` | `.agents/workflows/apc-dream.md` | `.agents/skills/dream/SKILL.md` or `.agents/skills/skill_ideation/SKILL.md` |
| `plan` | `.agents/workflows/apc-plan.md` | `.agents/skills/plan/SKILL.md` or `.agents/skills/skill_planning/SKILL.md` |
| `design` | `.agents/workflows/apc-design.md` | `.agents/skills/design/SKILL.md` or `.agents/skills/skill_design/SKILL.md` |
| `impl` or `implement` | `.agents/workflows/apc-impl.md` | `.agents/skills/impl/SKILL.md` or `.agents/skills/skill_implementation/SKILL.md` |
| `test` | `.agents/workflows/apc-test.md` | `.agents/skills/skill_testing/SKILL.md` |
| `debug` | `.agents/workflows/apc-debug.md` | `.agents/skills/debug/SKILL.md` and `.agents/skills/skill_troubleshooting/SKILL.md` |
| `ship` | `.agents/workflows/apc-ship.md` | `.agents/skills/ship/SKILL.md` or `.agents/skills/skill_packaging/SKILL.md` |
| `status` | `.agents/workflows/apc-status.md` | Read-only state inspection |
| `resume` | `.agents/workflows/apc-resume.md` | Route to the next incomplete phase, then complete only that phase |
| `patch` | `.agents/workflows/apc-patch.md` | Open a bugfix generation on a shipped plugin, then complete only that fix |
| `evolve` | `.agents/workflows/apc-evolve.md` | Open a feature generation on a shipped plugin, then run the delta pipeline |
| `new` | `.agents/workflows/apc-new.md` | Run one phase at a time and obtain each required user confirmation |

For WebView design or implementation, also load `.agents/skills/skill_design_webview/SKILL.md` when present.

## Execution Rules

1. Enforce the prerequisite phase from `status.json`.
2. Preserve the recorded `ui_framework`.
3. Treat shell snippets in workflow files as intent, not as permission to use the wrong platform shell.
4. Use the repository's state-management and build scripts instead of reimplementing their behavior.
5. Search `.agents/troubleshooting/known-issues.yaml` before trial-and-error debugging.
6. Preserve unrelated user changes and generated plugin projects.
7. Validate the requested phase's outputs.
8. Update state only after successful validation.
9. Stop after the requested phase and report the next APC invocation using `$audio-plugin-coder:audio-plugin-coder` with `/apc-*` names in user-facing text.
