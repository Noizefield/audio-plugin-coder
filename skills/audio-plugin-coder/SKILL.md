---
name: audio-plugin-coder
description: Run Audio Plugin Coder lifecycle actions for JUCE plugins, including setup, dream, plan, design, implement, test, debug, status, resume, and ship. Use when the user asks to create or continue an APC audio plugin or mentions an APC phase.
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
2. Read `.claude/rules/juce-build-protocols.md` and `.claude/rules/file-naming-conventions.md` for implementation, build, test, debug, or ship actions.
3. Read the workflow and primary instruction file from the routing table.
4. If a routed `.claude/` file is missing, use the equivalent `.agent/` path.
5. Resolve examples for the current OS: PowerShell on Windows, Bash/Zsh on macOS or Linux.
6. Announce preferred model from `apc.config.json` → `models.phases.<phase>` when present.

## Action Routing

| Action | Workflow | Primary instructions |
|---|---|---|
| `setup` | `.claude/workflows/apc-setup.md` | `.claude/skills/apc-setup/SKILL.md` |
| `dream` | `.claude/workflows/apc-dream.md` | `.claude/skills/dream/SKILL.md` or `.agent/skills/skill_ideation/SKILL.md` |
| `plan` | `.claude/workflows/apc-plan.md` | `.claude/skills/plan/SKILL.md` or `.agent/skills/skill_planning/SKILL.md` |
| `design` | `.claude/workflows/apc-design.md` | `.claude/skills/design/SKILL.md` or `.agent/skills/skill_design/SKILL.md` |
| `impl` or `implement` | `.claude/workflows/apc-impl.md` | `.claude/skills/impl/SKILL.md` or `.agent/skills/skill_implementation/SKILL.md` |
| `test` | `.claude/workflows/apc-test.md` | `.claude/skills/skill_testing/SKILL.md` |
| `debug` | `.claude/workflows/apc-debug.md` | `.claude/skills/debug/SKILL.md` and `.claude/skills/skill_troubleshooting/SKILL.md` |
| `ship` | `.claude/workflows/apc-ship.md` | `.claude/skills/ship/SKILL.md` or `.agent/skills/skill_packaging/SKILL.md` |
| `status` | `.claude/workflows/apc-status.md` | Read-only state inspection |
| `resume` | `.claude/workflows/apc-resume.md` | Route to the next incomplete phase, then complete only that phase |
| `new` | `.claude/workflows/apc-new.md` | Run one phase at a time and obtain each required user confirmation |

For WebView design or implementation, also load `.claude/skills/skill_design_webview/SKILL.md` when present.

## Execution Rules

1. Enforce the prerequisite phase from `status.json`.
2. Preserve the recorded `ui_framework`.
3. Treat shell snippets in workflow files as intent, not as permission to use the wrong platform shell.
4. Use the repository's state-management and build scripts instead of reimplementing their behavior.
5. Search `.claude/troubleshooting/known-issues.yaml` before trial-and-error debugging.
6. Preserve unrelated user changes and generated plugin projects.
7. Validate the requested phase's outputs.
8. Update state only after successful validation.
9. Stop after the requested phase and report the next APC invocation using `$audio-plugin-coder:audio-plugin-coder` with `/apc-*` names in user-facing text.
