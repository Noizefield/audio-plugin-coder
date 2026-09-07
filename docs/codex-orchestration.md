# Codex Cost-Aware Orchestration

Optional **Codex CLI** layer that routes APC work to cheaper models first (Luna → Terra → Sol → Astra), logs token usage from `codex exec --json`, and can escalate after objective build/test failure.

This does **not** replace interactive APC (`$audio-plugin-coder:audio-plugin-coder …`). Claude Code, Cursor, and Kilo keep announce-only `models.phases.*` preferences.

## Prerequisites

1. Codex CLI installed and on `PATH`.
2. ChatGPT sign-in (`codex login`) — **not** an API key — if you want Plus/plan allowance.
3. Named profiles in the user Codex home (`luna` / `terra` / `sol` / `astra`).

## Enable via `/apc-setup` (recommended for GitHub users)

No hand-copying of JSON is required for a normal setup.

1. Clone this repo (scripts, `.codex/agents/`, and `apc.config.example.json` already include the Codex layer).
2. Run **`/apc-setup`** (or skill action `setup`).
3. At **step 6b**, choose whether to enable Codex cost-aware CLI routing.
4. Setup writes local `apc.config.json` from the example (merging `models.codex`) and, if you opted in, sets `models.codex.enabled = true` and installs profiles via `scripts/codex/install-profiles.*`.

Equivalent non-interactive helpers:

```powershell
.\scripts\apc-write-config.ps1 -EnableCodexOrchestration -EnableCodexEscalation -MarkCompleted -Platform windows
```

```bash
bash scripts/apc-write-config.sh --enable-codex --enable-codex-escalation --completed --platform macos
```

If you already have an older `apc.config.json` without `models.codex`, re-run setup **Change models** or `apc-write-config` — it merges the missing block from the example.

Manual profile install only (if you skipped setup opt-in):

```powershell
powershell -File scripts/codex/install-profiles.ps1
```

```bash
bash scripts/codex/install-profiles.sh
```

Then use `-UseProfile` / `--use-profile` with the runner.

## Config (`models.codex`)

See [`apc.config.example.json`](../apc.config.example.json). Important keys:

| Key | Meaning |
|---|---|
| `enabled` | Opt-in flag set by `/apc-setup` step 6b; documents that Codex routing is configured |
| `require_chatgpt_auth` | Abort when `codex login status` looks like API-key auth |
| `phase_tiers` | APC phase → `luna` / `terra` / `sol` / `astra` |
| `tiers.*.model` | Concrete Codex model IDs (override when OpenAI renames models) |
| `escalation.enabled` | Allow one-tier escalation after failed verify |
| `escalation.verify_command` | Shell/PowerShell command; default can be build-and-install when `-PluginName` is set |
| `usage_log_dir` | JSONL usage log (default `.tmp/codex-usage`) |

Default for GitHub clones: `enabled: false` (safe for Cursor/Claude/Kilo). Opt in during setup when you use Codex CLI.

## Project agents

Repo agents live under [`.codex/agents/`](../.codex/agents/) (`cheap_worker`, `standard_worker`, `deep_worker`, `expert_worker`). Interactive Codex sessions can delegate narrow work to the cheap worker.

## Runner

Windows:

```powershell
powershell -File scripts/codex/apc-codex-run.ps1 -Prompt "find TODOs in Source/" -Phase status -DryRun
powershell -File scripts/codex/apc-codex-run.ps1 -Prompt "Summarize plugin status" -Phase status
powershell -File scripts/codex/apc-codex-run.ps1 -Prompt "Implement fix" -Phase impl -PluginName MyPlugin -EscalateOnVerifyFail
```

macOS / Linux:

```bash
bash scripts/codex/apc-codex-run.sh --prompt "find TODOs in Source/" --phase status --dry-run
bash scripts/codex/apc-codex-run.sh --prompt "Implement fix" --phase impl --plugin MyPlugin --escalate
```

Routing order:

1. Explicit `-Tier` / `--tier`
2. Deterministic prompt heuristics (search → Luna, implement → Terra, concurrency → Sol)
3. `models.codex.phase_tiers.<phase>` (or built-in defaults)
4. `models.codex.default_tier` (Terra)

Fast mode stays off by default (`models.codex.fast_mode`).

## Smoke proof (after usage-window reset)

```powershell
powershell -File scripts/codex/smoke-proof.ps1 -SkipLiveExec   # auth + templates only
powershell -File scripts/codex/smoke-proof.ps1                 # live Luna JSONL + schema
```

```bash
bash scripts/codex/smoke-proof.sh --skip-live
bash scripts/codex/smoke-proof.sh
```

Exit code `2` means Plus usage limit blocked live checks — retry later.

## Helpers

PowerShell ([`scripts/lib/Get-ApcPaths.ps1`](../scripts/lib/Get-ApcPaths.ps1)):

- `Get-ApcCodexConfig`
- `Get-ApcCodexTierForPhase`
- `Get-ApcCodexTierInfo`
- `Get-ApcCodexNextTier`

Bash ([`scripts/lib/apc-paths.sh`](../scripts/lib/apc-paths.sh)):

- `apc_codex_tier_for_phase`
- `apc_codex_tier_field`
- `apc_codex_next_tier`

## Design notes

- Prefer objective verification (build/tests) over model self-assessment for escalation.
- Bound retries per tier (`tiers.*.max_attempts`).
- Avoid spawning many parallel Codex subagents for APC phases — they multiply allowance use.
- Full design background: [`plans/codex-plus-model-orchestration.md`](../plans/codex-plus-model-orchestration.md).
