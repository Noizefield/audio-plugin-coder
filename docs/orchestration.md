# Subagent Orchestration

APC ships a host-agnostic delegation layer: **canonical worker profiles**
(`.agents/agents/*.md`) plus an **orchestrator command** (`/apc-orchestrate`)
that decomposes a goal into disjoint subtasks, fans them out to subagent
workers, verifies the results, and integrates them.

The same definitions work across hosts — Devin CLI, Claude Code, OpenCode,
Cursor, Kilo — and hosts without native subagents fall back to headless CLI
dispatch (Codex path) or sequential execution.

## Commands

| Invocation | Host |
|---|---|
| `/apc-orchestrate <goal>` | Devin (`.devin/skills/apc-orchestrate` adapter, or `/devin:apc-orchestrate` when namespaced), Claude Code, Kilo, OpenCode (`/apc-orchestrate` command file) |
| `/orchestrate <goal>` | Devin/Windsurf (`.agents/skills/orchestrate/` is picked up natively) |
| `$audio-plugin-coder:audio-plugin-coder orchestrate <goal>` | Codex skill action |
| "orchestrate X across subagents" | any host — natural-language equivalent |

## Worker profiles

Canonical files: `.agents/agents/<name>.md` (Markdown + YAML frontmatter —
the shared convention across Devin, Claude Code, and OpenCode).

| Profile | Tier intent | Scope |
|---|---|---|
| `cheap-worker` | low cost | Search, extraction, exploration, formatting, simple edits (restricted tool set) |
| `standard-worker` | default | Implementation, routine debugging, refactoring, tests, review |
| `deep-worker` | strong | Multi-step, ambiguous, cross-component, concurrency |
| `expert-worker` | escalation only | After verified failure of a lower tier |

Canonical frontmatter fields: `name`, `description`, optional
`allowed-tools` (canonical tool names: `read grep glob exec edit write
web_search webfetch`). The body is the worker's system prompt.

## Per-host adapters

Worker profiles land where each host expects them:

| Host | Location | Mechanism |
|---|---|---|
| Devin CLI | `.agents/agents/*.md` — **read natively, no copy needed** | `run_subagent` |
| Claude Code | `.claude/agents/*.md` (generated) | Task subagents |
| OpenCode | `.opencode/agent/*.md` (generated, `mode: subagent`) | subagent dispatch |
| Codex | `.codex/agents/*.toml` (hand-maintained, Codex-only model fields) | `codex exec` routing |
| Cursor / Kilo | profile contents passed as the subagent brief | host subagent / mode |

### Sync script

After adding or editing a canonical worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-agents.ps1
```

```bash
bash scripts/sync-agents.sh
```

The script:

- Parses each `.agents/agents/*.md` (name, description, `allowed-tools`, body)
- Emits `.claude/agents/<name>.md` with a Claude `tools:` allowlist
- Emits `.opencode/agent/<name>.md` with `mode: subagent` and a tools map
  (write-capable tools hard-disabled when not granted)
- Checks `.codex/agents/<name_underscored>.toml` parity and warns on drift
- Is idempotent; `--check` / `-Check` verifies adapters are current (CI)

Tool names are normalized per host (`exec` → Claude `Bash` → OpenCode
`bash`, etc.) — the mapping table lives in the sync scripts.

### Model selection per host

Canonical `.md` profiles deliberately omit `model:` — model IDs are
host-specific (`gpt-5.6-*` on Codex, `swe-2-max` on Devin, `sonnet`/`opus`
on Claude). Each host applies its own default subagent model or inherits
the parent's. To pin a model on a specific host, edit the generated
adapter after sync (or extend `sync-agents` with a model map when a
`models.orchestration` config block lands).

Codex model routing is already solved separately: `models.codex.tiers.*`
maps the four workers to concrete model IDs — see
[`codex-orchestration.md`](codex-orchestration.md).

## Orchestrator protocol

The orchestrator skill (`.agents/skills/orchestrate/SKILL.md`) runs **inline
in the main agent** — only the root session can spawn subagents on most
hosts. Its contract:

1. Decompose into subtasks with **disjoint file sets** — two write-capable
   workers never share files.
2. **Wave 0** research (`cheap-worker` / `deep-worker`) → fold findings
   into write briefs.
3. **Wave 1** up to 3 concurrent write workers (parallel workers multiply
   spend — keep it bounded, see the warning in codex-orchestration.md).
4. **Wave 2** objective verification (`node bin/apc.js build <Name>`,
   targeted tests/lint) — never trust worker self-assessment.
5. Integrate, escalate failed tasks one tier up, consolidated report.

Every worker brief must carry: repo root, plugin path + `status.json`
context, exact deliverable, owned vs forbidden paths, APC rules
(`ui_framework`, shell parity, no raw `cmake`, no AI attribution trailers),
and the report format.

## Limits

- **"All LLMs" means "all hosts with native subagents or a headless CLI."**
  Exotic hosts get the sequential fallback.
- Parallel write tasks currently rely on disjoint-file discipline in the
  briefs. Git-worktree isolation per worker is the planned Phase C
  hardening (Orca worktrees on this machine).
- Background subagents can't request new tool permissions on some hosts;
  resume them in the foreground if a permission denial blocks a task.
