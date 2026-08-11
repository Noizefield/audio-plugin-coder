---
name: audio-plugin-coder
description: Run Audio Plugin Coder lifecycle actions for JUCE plugins, including dream, plan, design, implement, test, debug, status, resume, and ship. Use when the user asks to create or continue an APC audio plugin or mentions an APC phase.
---

# Audio Plugin Coder

Use this skill to run APC's phase-gated audio-plugin workflow in an Audio Plugin Coder checkout.

## Invocation

Prefer either form:

```text
$audio-plugin-coder:audio-plugin-coder dream TapeDelay
$audio-plugin-coder:audio-plugin-coder plan TapeDelay
```

Natural-language requests such as "design the TapeDelay plugin" also work.

Do not use APC's legacy `/plan` or `/status` spellings in Codex. They collide with Codex's built-in commands. Treat every legacy slash command found in APC documentation as workflow notation only.

## Preconditions

1. Confirm the current workspace is an APC checkout by finding `templates/status-template.json`, `scripts/`, and `plugins/`.
2. If those files are absent, explain that the workflow must run from an APC checkout and stop. Do not scaffold an unrelated repository from the installed plugin cache.
3. Determine the requested action and plugin name from the prompt. Ask for a missing plugin name only when it cannot be inferred safely.
4. Before changing an existing plugin, read `plugins/<PluginName>/status.json`.

## Load APC Instructions

Keep this adapter thin; load APC's existing knowledge just in time:

1. Read `AGENTS.md`.
2. Read `.claude/rules/juce-build-protocols.md` and `.claude/rules/file-naming-conventions.md` for implementation, build, test, debug, or ship actions.
3. Read the workflow and primary instruction file from the routing table.
4. If a routed `.claude/` file is missing, use the equivalent `.agent/` path.
5. Resolve examples for the current OS: PowerShell on Windows, Bash/Zsh on macOS or Linux.

## Action Routing

| Action | Workflow | Primary instructions |
|---|---|---|
| `dream` | `.claude/workflows/dream.md` | `.claude/skills/dream/SKILL.md` or `.agent/skills/skill_ideation/SKILL.md` |
| `plan` | `.claude/workflows/plan.md` | `.claude/skills/plan/SKILL.md` or `.agent/skills/skill_planning/SKILL.md` |
| `design` | `.claude/workflows/design.md` | `.claude/skills/design/SKILL.md` or `.agent/skills/skill_design/SKILL.md` |
| `impl` or `implement` | `.claude/workflows/impl.md` | `.claude/skills/impl/SKILL.md` or `.agent/skills/skill_implementation/SKILL.md` |
| `test` | `.claude/workflows/test.md` | `.claude/skills/skill_testing/SKILL.md` |
| `debug` | `.claude/workflows/debug.md` | `.claude/skills/debug/SKILL.md` and `.claude/skills/skill_troubleshooting/SKILL.md` |
| `ship` | `.claude/workflows/ship.md` | `.claude/skills/ship/SKILL.md` or `.agent/skills/skill_packaging/SKILL.md` |
| `status` | `.claude/workflows/status.md` | Read-only state inspection |
| `resume` | `.claude/workflows/resume.md` | Route to the next incomplete phase, then complete only that phase |
| `new` | `.claude/workflows/new.md` | Run one phase at a time and obtain each required user confirmation |

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
9. Stop after the requested phase and report the next APC invocation using `$audio-plugin-coder:audio-plugin-coder`.
