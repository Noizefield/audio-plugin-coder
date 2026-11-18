# Docs CI: `apc docs check`

Documentation is part of the product: agents read it as instructions, so a stale command, a dead link or a broken snippet is a bug. `apc docs check` makes that testable. Zero dependencies, Node 18+, never executes a snippet.

```bash
node bin/apc.js docs check                  # all checks, human report, exit 1 on any error
node bin/apc.js docs check --json           # machine-readable (schema apc-docs-check/1)
node bin/apc.js docs check --external       # also list http(s) links (never fetched)
node bin/apc.js docs check --fix-safe       # apply the mechanical fixes below, then re-check
node bin/apc.js docs check --strict         # known-debt allow-list entries count as errors again
node bin/apc.js docs check --only links,stale
node bin/apc.js docs check docs/FAQ.md      # limit to some files
```

**One-line CI command:** `node bin/apc.js docs check` (exit code 0 = clean). The repo's `.github/workflows/docs.yml` runs exactly that plus `node --test test/docs-check.test.js test/eval.test.js`.

Exit codes: `0` clean (warnings allowed), `1` findings, `2` usage error.

## Scope

| In scope | Not scanned |
|----------|-------------|
| `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `hub/README.md`, `docs/**/*.md`, `.agents/**/*.md` | `plans/` (gitignored), `node_modules/`, `_tools/`, `build/`, `release/`, anything outside the list |

Snippet checks apply to `docs/**` and `.agents/**` only.

## The four checks

### 1. `links` - relative links and anchors

* Inline links, reference definitions and HTML `href` / `src` are resolved against the file's directory (`/x` resolves against the repo root).
* Existence is **case-exact**, so a Windows or macOS checkout cannot hide a link that breaks on Linux CI (`link-case-mismatch`).
* `#anchor` is checked against the GitHub heading slug of the target (duplicate headings get `-1`, `-2` suffixes) and against `<a name>` / `id` attributes. `#L12` line anchors are accepted.
* A link into `plans/` is an error (`link-to-gitignored`): it cannot resolve for anyone else.
* Skipped, and counted in `skipped`: fenced code, inline code, `mailto:`, absolute OS paths, and targets that are clearly placeholders (`<Name>`, `${VAR}`, `*`).

Rules: `broken-link`, `broken-anchor`, `link-case-mismatch`, `link-to-gitignored`.

### 2. `snippets` - fenced blocks must parse

| Fence | Check |
|-------|-------|
| `json` | `JSON.parse` |
| `jsonc` | parses after stripping comments and trailing commas |
| `bash`, `sh` | `bash -n` (syntax only; one batched process) |
| `powershell`, `pwsh`, `ps1` | the PowerShell language parser (`pwsh`, else Windows `powershell`), one batched process, never invoked |

**Placeholder policy (conservative: an illustrative example must not fail the build):**

* `<Name>`-style placeholders are replaced by a plain word before bash/PowerShell parsing; `@{...}` in PowerShell becomes `@{}`.
* A `json` block that does not parse is **skipped, not failed**, when it contains an ellipsis (`...`) or an `<angle>` placeholder. Anything else that fails is an error, and if stripping comments would make it valid the message says to use `jsonc`.
* To opt a deliberately non-parseable block out, put `no-check` after the language: ` ```json no-check `. The block is listed under `skipped`.
* If the needed shell is absent (no `bash`, no PowerShell) the blocks are reported under `skipped` once - they are never silently treated as passing. `ubuntu-latest` runners have both.
* Windows PowerShell 5.1 cannot parse PowerShell 7 syntax (`&&`, `||`, `?:`, `??`); such blocks are skipped with a note rather than failed. On a runner with `pwsh` they are parsed for real.

Rules: `json-invalid`, `bash-syntax`, `powershell-syntax`, `unterminated-fence`.

### 3. `stale` - known-stale strings

| Rule | Flags | Not flagged |
|------|-------|-------------|
| `bare-primary-command` | `/dream` `/plan` `/design` `/impl` `/test` `/ship` `/status` `/resume` used as the primary form | lines mentioning an alias / deprecated / legacy / short form, lines containing the matching `/apc-*`, and warnings ("do not use `/plan`", "reserved") |
| `singular-agent-dir` | `.agent/` paths (canonical: `.agents/`) | lines that list host folders (`.claude/`, `.kilocode/`), warnings |
| `juce-8` | `JUCE 8` | lines that also say `JUCE 9` (migration notes) |
| `visage-not-implemented` | "Visage ... not yet implemented" | - |
| `plugins-dir-assumption` | `./plugins` as an assumption (use `paths.plugins_dir`) | warnings ("never hardcode `./plugins`") |
| `cmake-glob-plugins` | `file(GLOB PLUGIN_DIRS "plugins/*")` | - |
| `platform-local-build-unsupported` | macOS/Linux "local build" marked unsupported (table cell or prose) | - |

### 4. `version` - single source of truth

`package.json` is canonical. The check runs `apc version sync` (so the logic is never duplicated): `hub/version.js` and the CMake `APC_VERSION` must agree, otherwise `version-sync` fails (`--fix-safe` runs `apc version sync --fix`). A *static* README version badge (`img.shields.io/badge/Version-X.Y.Z`) is compared too (`readme-badge`); the dynamic `github/package-json/v` badge always agrees. A stale `package-lock.json` version is a warning (`lockfile-version`).

## The allow-list: `docs/.stale-allowlist.json`

```json
{
  "schema": "apc-docs-allowlist/1",
  "allow": [
    {
      "rule": "juce-8",
      "file": ".agents/troubleshooting/resolutions/**",
      "reason": "Historical write-ups about the JUCE 8 migration."
    },
    {
      "rule": "bare-primary-command",
      "file": ".agents/skills/**",
      "debt": true,
      "reason": "Skill headers still show the bare form; owner to update."
    }
  ]
}
```

* `rule` is any finding rule (not only stale rules); `file` is a repo-relative glob (`*` one segment, `**` any depth); `contains` / `pattern` match the offending line text or the message. At least one of `file` / `contains` / `pattern` is required - a bare rule entry never matches, so a rule cannot be silenced globally.
* `reason` is required (a missing one is a warning).
* `"debt": true` marks a *known-stale* item that is tolerated, not endorsed. Debt is counted separately in the report (`known-debt`), listed in `--json` under `debt`, and becomes an error under `--strict`. Use plain entries only when the text is **correct** (historical, or a deliberate counter-example).
* An entry that matches nothing on a full run produces an `allowlist-unused` warning - delete it when the underlying text is fixed.

## `--fix-safe`

Only mechanical, reviewable edits: `.agent/` becomes `.agents/` on lines flagged `singular-agent-dir`; a link whose only problem is letter case is respelled; `apc version sync --fix` when versions drifted. Everything else (links, snippets, wording) needs a human or an agent. Review the diff before committing.

## Fixing findings

| Finding | Typical fix |
|---------|-------------|
| `broken-link` in `docs/x.md` pointing at `scripts/...` | the link is relative to `docs/`: use `../scripts/...` |
| `json-invalid` for an illustrative template | fence ` ```json no-check ` (or ` ```jsonc ` if only comments break it) |
| `powershell-syntax` from `[Name]` placeholders | use `<Name>`, or ` ```powershell no-check ` |
| `bare-primary-command` | write `/apc-plan`, and mention `/plan` only as a noted alias |
| a legitimate stale-looking mention | rephrase with a warning word ("never", "legacy alias") or add an allow-list entry with a reason |

## Limitations

* Link checking is local only; external URLs are listed (`--external`), not fetched. Pair with a link-checker action if you need liveness.
* Snippets are parsed, not run. A syntactically valid command can still be wrong.
* Stale-string rules are regex heuristics over single lines; expect to tune them via the allow-list.
* The PowerShell parser in CI is PowerShell 7; local Windows runs use 5.1 and may skip PS7-only blocks.
