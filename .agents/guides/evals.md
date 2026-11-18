# AI Eval Harness: `apc eval`

Measures how well an AI coding agent handles APC work, deterministically and without API keys. The harness **never calls an LLM**. You run the agent in whatever host you use (Claude Code, Codex, Cursor, Kilo, ...); the harness prepares the workspace, grades the result with static checks, records the row, and renders a leaderboard (pass rate, median tokens, median dollars per agent/model). Wins can be proposed into `.agents/troubleshooting/known-issues.yaml`.

```
apc eval list                                   # tasks
apc eval run <task> --prepare                   # make a workspace, print its path
   ... let your agent work in that workspace ...
apc eval score <task> --workspace <dir>         # grade (exit 0 = pass, 1 = fail)
apc eval record <task> --workspace <dir> --agent claude-code --model opus \
     --tokens-in 120000 --tokens-out 8000 --cost-usd 1.42 --wall-s 310
apc eval leaderboard --out evals/LEADERBOARD.md # markdown table
apc eval promote <run_id>                       # propose a known-issues entry
apc eval selftest                               # prove every task can pass AND fail
```

`apc eval run <task> --grade --workspace <dir>` is the same as `score`. `run` with an already-prepared `--workspace` and no flag grades it.

## Running one eval

1. `node bin/apc.js eval run add-parameter --prepare` creates a temporary APC root (the task fixture plus a minimal `apc.config.json` / `package.json`) and writes `TASK.md` (the prompt and the exact `APC_ROOT=... node bin/apc.js` invocation) into it. Add `--workspace <dir>` to choose the location (it must be empty or absent) and `--json` for scripting.
2. Point the agent at that directory: working directory **and** `APC_ROOT=<dir>`, so `apc validate ...` inside the task sees the workspace, not this repository. Give it the prompt from `TASK.md` and nothing else.
3. When the agent finishes, grade: `node bin/apc.js eval score add-parameter --workspace <dir>`. Every check prints `ok` or `FAIL -- reason`.
4. Record it (agent and model are free-form labels; the numeric fields are optional but needed for the cost columns):

   ```bash
   node bin/apc.js eval record add-parameter --workspace <dir> --agent claude-code --model opus --tokens-in 120000 --tokens-out 8000 --cost-usd 1.42 --wall-s 310
   ```

   `--result <file>` records the output of `score --json` instead of re-grading. `--ledger <file>` overrides `evals/results/ledger.jsonl`.

The reference solutions in `evals/tasks/<id>/reference/` are **not** copied into the workspace.

## The four golden tasks

| Task | What it tests | Graded with |
|------|---------------|-------------|
| `add-parameter` | add a float param (ID, range, default), read it in `processBlock`, document it, keep `gain` | static source checks + `apc validate plugin` |
| `fix-webview-member-order` | fix the known-issue `webview-002` crash by reordering members only | `apc validate webview-order` + count guards (cannot "fix" by deleting) + `PluginEditor.cpp` untouched |
| `port-visage-to-webview` | port a Visage UI to the JUCE 9 WebView setup | `apc validate webview`, `webview-order`, `visage` (must now fail), `plugin`; processor files untouched |
| `respect-standards-flow` | answer `apc standards plan` questions with `apc standards set`, end with `apc standards validate` passing | `apc standards validate`, exact values, locked registry byte-identical to the repo |

## Task format

`evals/tasks/<id>/task.json` (schema `apc-eval-task/1`):

| Field | Meaning |
|-------|---------|
| `id`, `title`, `prompt` | `id` equals the directory name; `prompt` is what the agent is given |
| `category`, `tags` | `category` becomes the known-issues category on promote |
| `fixture` | directory (relative to the task) copied to the workspace root |
| `setup` | ordered ops run after the copy: `mkdir`, `write`, `delete`, `json-set`, `copy-from-repo` (all paths confined to the workspace) |
| `timeout_s` | advisory time limit shown to the agent |
| `checks` | the deterministic grader, below |

Check types (all take `id`, optional `description`):

| `type` | Fields | Passes when |
|--------|--------|-------------|
| `file_exists` / `file_absent` | `path` | the file exists / does not |
| `file_contains` | `path`, `pattern`, `flags`, `min` (1) | the regex matches at least `min` times |
| `file_not_contains` | `path`, `pattern`, `flags` | the regex never matches |
| `file_count` | `path`, `pattern`, `min`, `max` | match count within range |
| `json_path` | `path`, `pointer` (`a.b[0]` or an array for dotted keys), one of `equals` `exists` `matches` `contains` | the JSON value satisfies it |
| `unchanged_from_fixture` | `path` | byte-identical to the fixture copy (guards protected files) |
| `file_matches_repo` | `path`, `repo_path` | byte-identical to a file in this repository |
| `apc` | `args`, `expect_exit` (0), `stdout_contains`, `stdout_not_contains` | `node bin/apc.js <args>` run with `APC_ROOT=<workspace>` exits as expected |

A task passes when **all** checks pass; `score` is the fraction passed.

### Adding a task

1. `evals/tasks/<id>/task.json`, `fixture/`, and `reference/good/` + `reference/bad/` overlay directories (an optional `_delete.txt` lists files to remove).
2. `node bin/apc.js eval selftest <id>`. It requires: the bare fixture **fails**, `reference/good` **passes**, `reference/bad` **fails**. A task the bare fixture already passes is vacuous and is rejected.
3. Prefer checks that agree with an existing validator. Add guards against cheating (count guards, `unchanged_from_fixture`) rather than trusting the prompt.

## Ledger and leaderboard

`evals/results/ledger.jsonl`, one JSON object per line (schema `apc-eval-row/1`):

`run_id`, `task`, `agent`, `model`, `passed`, `checks` (`{passed, total, failed:[ids]}`), `tokens_in`, `tokens_out`, `cost_usd`, `wall_s`, `date`, `apc_version`. Unknown numbers are `null`.

`apc eval leaderboard` aggregates per agent + model: runs, pass rate, **median** tokens (in + out), median dollars, median wall time, ranked by pass rate then cheaper median cost; a per-task pass matrix follows. Rows without token/cost data show `-` and are excluded from those medians, never counted as zero. `--task <id>` filters, `--json` prints the data, `--out evals/LEADERBOARD.md` writes the table.

## Promoting a win into known-issues

```bash
node bin/apc.js eval promote <run_id> --note "Declare relays first, WebView second" --dry-run
node bin/apc.js eval promote <run_id> --note "..."
```

The target is `.agents/troubleshooting/known-issues.yaml` (override with `--known-issues <file>`). The harness:

* only **appends**; existing entries are never edited (the original bytes are verified unchanged after writing);
* writes the proposal as a **commented block** between `# >>> APC-EVAL PROPOSAL run_id=...` and `# <<< END ...` markers, so the file stays valid YAML and nothing is active until a human uncomments it;
* refuses a run that did not pass (`--allow-failed` proposes a failure pattern instead) and refuses to propose the same run twice.

To accept: remove the leading `# ` from the YAML lines, fill the `TODO` fields, give it a real id, delete the marker lines. To reject: delete the block. Try it on a copy first with `--known-issues`.

## Limits

* Static grading cannot prove a plugin builds or sounds right; it checks structure and APC conventions. A build-and-null-test tier belongs with the audio validation pipeline.
* Token and cost figures are reported by you from your host; the harness does not measure them.
* The golden fixtures are tiny hand-written plugins. They test following APC rules, not large-codebase navigation.
