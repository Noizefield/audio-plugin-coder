---
description: "Open a feature generation on a shipped plugin (minor bump, feature-brief pipeline)"
---

# Evolve Generation
**Preferred model:** Read `apc.config.json` -> `models.phases.plan` (an `evolve` key, if present, wins; announce to user; switch host model if possible).

**Setup gate:** If `setup.completed` is false, warn once and suggest `/apc-setup` (do not hard-block).

**The rule:** A shipped generation is read-only. New work always opens a generation first. `/apc-evolve` is how features begin. Never run `/apc-impl` against a frozen (`ship_complete`, no open generation) plugin — if the generation is not open, stop and open it.

## Step 1 — Open the generation

Ask the user for a one-line feature goal and an optional codename
(`v1.1 "Analog Warmth"` — may be skipped; `/apc-patch` never takes one):

```text
node bin/apc.js evolve <PluginName> [--codename "Name"]
```

This verifies the plugin is shipped, backfills the frozen prior-generation
record on first use, snapshots `status.json`, bumps minor (`v1.0` -> `v1.1`),
points the phase at `plan`, resets design/code/test/ship flags (foundation
flags stay true), and writes `.ideas/{version}-brief.md` as the feature stub.
Fill that stub in with the user before proceeding — it is the scope contract.

If a generation is already open, stop: finish or re-ship it first. One open
generation at a time.

## Step 2 — Feature pipeline (delta, not from scratch)

Run the normal pipeline scoped to the brief — do not re-dream the plugin:

1. `/apc-plan <Name>` — architecture delta for the feature only.
2. `/apc-design <Name>` — UI delta (new controls live here, never in patch).
3. `/apc-impl <Name>` — implement against the open generation.
4. `node bin/apc.js validate <webview|visage> --plugin <Name>` — must pass.
5. `/apc-test <Name>` — full validation must pass, **including a regression
   pass over the prior generation's behavior** (the frozen record + ship tag
   are the oracle: `git diff {prior-tag}` shows exactly what changed).

## Step 3 — Re-ship (freezes the generation)

Run `/apc-ship <Name>` as normal. The ship flow freezes the open generation,
bundles the feature brief as release notes (generation > 1), and returns the
machine to rest.

**Completion message:** state the generation version (+ codename), what was
added, and that `v{version}` is frozen. Suggest `/apc-status <Name>` to show
the lineage.
