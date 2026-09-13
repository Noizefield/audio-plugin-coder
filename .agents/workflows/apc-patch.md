---
description: "Open a bugfix generation on a shipped plugin (patch digit bump, code-first loop)"
---

# Patch Generation
**Preferred model:** Read `apc.config.json` -> `models.phases.impl` (a `patch` key, if present, wins; announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

**The rule:** A shipped generation is read-only. New work always opens a generation first. `/apc-patch` is how bugfixes begin. Never run `/apc-impl` against a frozen (`ship_complete`, no open generation) plugin — the CLI blocks nothing here, *you* enforce it: if the generation is not open, stop and open it.

## Step 1 — Open the generation

```text
node bin/apc.js patch <PluginName>
```

This verifies the plugin is shipped, backfills the frozen prior-generation
record on first use (pre-generations plugins migrate with zero upfront work),
snapshots `status.json`, bumps the patch digit (`v1.0` -> `v1.0.1`), points
the phase at `code`, and resets only `tests_passed` / `ship_ready` (design
flags stay true — the design did not change).

If a generation is already open, stop: finish or re-ship it first. One open
generation at a time.

## Step 2 — Fix (code-first, tiny UI touch-ups allowed)

**Scope contract:** DSP/code fixes plus *tiny* UI touch-ups only (text,
labels, positions). New controls, layout changes, or new parameters are out
of scope — that is `/apc-evolve`, not a patch. If the fix outgrows the
contract mid-work, say so and switch.

Load and execute `.agents/skills/impl/SKILL.md` (scoped to the fix), then:

1. Reproduce the bug in the Standalone first when possible.
2. Apply the minimal fix; no drive-by refactors.
3. `node bin/apc.js validate webview --plugin <Name>` (or `visage`) — must pass.
4. `/apc-test <Name>` — full validation must pass.

## Step 3 — Re-ship (freezes the generation)

Run `/apc-ship <Name>` as normal. The ship flow freezes the open generation
(tag `v{version}-{Plugin}`, timestamp) and returns the machine to rest
(`ship_complete`, read-only until the next patch/evolve).

**Completion message:** state the generation version, what was fixed, and that
`v{version}` is frozen. Suggest `/apc-status <Name>` to show the lineage.
