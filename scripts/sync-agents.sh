#!/usr/bin/env bash
# Syncs canonical APC worker profiles (.agents/agents/*.md) to
# host-specific subagent formats (.claude/agents, .opencode/agent).
#
# .agents/agents/*.md is the single source of truth (Devin reads it
# natively). This script emits per-host adapters:
#
#   .claude/agents/<name>.md    Claude Code subagents (tools allowlist)
#   .opencode/agent/<name>.md   OpenCode subagents (mode + tools map)
#
# Codex workers stay as TOML in .codex/agents/ (Codex-only fields);
# this script validates name parity (cheap-worker <-> cheap_worker.toml).
#
# Canonical frontmatter:
#   name          worker identifier (hyphenated)
#   description   shown to the orchestrator when picking a profile
#   allowed-tools optional allowlist using canonical tool names:
#                 read grep glob exec edit write web_search webfetch
#
# Usage:
#   bash scripts/sync-agents.sh           # write adapters
#   bash scripts/sync-agents.sh --check   # verify up to date (CI)

set -euo pipefail

CHECK=0
for arg in "$@"; do
    case "$arg" in
        --check|-Check) CHECK=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CANON_DIR="$REPO_ROOT/.agents/agents"
CLAUDE_DIR="$REPO_ROOT/.claude/agents"
OPENCODE_DIR="$REPO_ROOT/.opencode/agent"
CODEX_DIR="$REPO_ROOT/.codex/agents"

[[ -d "$CANON_DIR" ]] || { echo "Canonical agents directory not found: $CANON_DIR" >&2; exit 1; }

# canonical -> Claude Code tool names
claude_tool() {
    case "$1" in
        read)          echo "Read" ;;
        grep)          echo "Grep" ;;
        glob)          echo "Glob" ;;
        exec)          echo "Bash" ;;
        edit)          echo "Edit" ;;
        write)         echo "Write" ;;
        web_search)    echo "WebSearch" ;;
        webfetch)      echo "WebFetch" ;;
        notebook_edit) echo "NotebookEdit" ;;
        *)             echo "$1" ;;
    esac
}

# canonical -> opencode tool keys (space separated)
opencode_tools() {
    case "$1" in
        read)          echo "read" ;;
        grep)          echo "grep" ;;
        glob)          echo "glob list" ;;
        exec)          echo "bash" ;;
        edit)          echo "edit" ;;
        write)         echo "write" ;;
        web_search)    echo "webfetch" ;;
        webfetch)      echo "webfetch" ;;
        notebook_edit) echo "edit" ;;
        *)             echo "$1" ;;
    esac
}

write_if_changed() {
    local path="$1" content="$2" existing=""
    if [[ -f "$path" ]]; then
        existing="$(cat "$path")"
    fi
    # compare ignoring trailing newline differences
    if [[ "$existing" == "$(printf '%s' "$content" | sed -e 's/[[:space:]]*$//' )" || "$existing" == "$content" ]]; then
        echo "  ok (unchanged): $path"
        return 0
    fi
    if [[ $CHECK -eq 1 ]]; then
        echo "  stale: $path" >&2
        return 1
    fi
    mkdir -p "$(dirname "$path")"
    printf '%s\n' "$content" > "$path"
    echo "  wrote: $path"
    return 0
}

ALL_OK=1
shopt -s nullglob extglob
MD_FILES=("$CANON_DIR"/*.md)
[[ ${#MD_FILES[@]} -gt 0 ]] || { echo "No canonical worker profiles in $CANON_DIR" >&2; exit 1; }

echo "Syncing ${#MD_FILES[@]} worker profile(s) from $CANON_DIR"
echo

for file in "${MD_FILES[@]}"; do
    # --- parse frontmatter -------------------------------------------------
    name="" description="" in_tools=0
    declare -a tools=()
    seen_open=0; seen_close=0
    body=""
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"   # tolerate CRLF source files
        if [[ $seen_open -eq 0 && "$line" == "---" ]]; then seen_open=1; continue; fi
        if [[ $seen_open -eq 1 && $seen_close -eq 0 ]]; then
            if [[ "$line" == "---" ]]; then seen_close=1; continue; fi
            if [[ $in_tools -eq 1 && "$line" =~ ^[[:space:]]+-[[:space:]]+(.+)$ ]]; then
                tools+=("${BASH_REMATCH[1]//[[:space:]]/}")
                continue
            fi
            if [[ "$line" =~ ^([A-Za-z_-]+):[[:space:]]*(.*)$ ]]; then
                in_tools=0
                key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
                val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
                case "$key" in
                    name)                  name="$val" ;;
                    description)           description="$val" ;;
                    allowed-tools|tools)   in_tools=1 ;;
                esac
            fi
            continue
        fi
        [[ -n "$body" ]] && body="$body"$'\n'
        body="$body$line"
    done < "$file"
    # trim leading/trailing whitespace from the whole body (like PS .Trim())
    body="${body##+([[:space:]])}"
    body="${body%%+([[:space:]])}"

    [[ -n "$name" ]] || name="$(basename "$file" .md)"
    echo "worker: $name"

    stamp="_Generated from .agents/agents/$name.md by scripts/sync-agents - do not edit._"

    # --- .claude/agents/<name>.md ------------------------------------------
    {
        printf -- "---\nname: %s\ndescription: %s\n" "$name" "$description"
        if [[ ${#tools[@]} -gt 0 ]]; then
            cl_list=""
            for t in "${tools[@]}"; do
                ct="$(claude_tool "$t")"
                [[ -n "$cl_list" ]] && cl_list="$cl_list, "
                cl_list="$cl_list$ct"
            done
            printf "tools: %s\n" "$cl_list"
        fi
        printf -- "---\n\n%s\n\n%s\n" "$stamp" "$body"
    } > /tmp/apc-agent-claude.$$
    write_if_changed "$CLAUDE_DIR/$name.md" "$(cat /tmp/apc-agent-claude.$$)" || ALL_OK=0

    # --- .opencode/agent/<name>.md ------------------------------------------
    {
        printf -- "---\ndescription: %s\nmode: subagent\n" "$description"
        if [[ ${#tools[@]} -gt 0 ]]; then
            printf "tools:\n"
            granted=""
            for t in "${tools[@]}"; do
                for k in $(opencode_tools "$t"); do
                    case " $granted " in *" $k "*) continue ;; esac
                    granted="$granted $k"
                done
            done
            # emit granted keys sorted (matches sync-agents.ps1 output)
            for k in $(printf '%s\n' $granted | sort -u); do
                printf "  %s: true\n" "$k"
            done
            for k in write edit patch; do
                case " $granted " in
                    *" $k "*) ;;                       # granted - keep
                    *) printf "  %s: false\n" "$k" ;;  # hard-disable
                esac
            done
        fi
        printf -- "---\n\n%s\n\n%s\n" "$stamp" "$body"
    } > /tmp/apc-agent-opencode.$$
    write_if_changed "$OPENCODE_DIR/$name.md" "$(cat /tmp/apc-agent-opencode.$$)" || ALL_OK=0
    rm -f /tmp/apc-agent-claude.$$ /tmp/apc-agent-opencode.$$

    # --- Codex parity check -------------------------------------------------
    # TOML file name is hyphenated like the .md (TOML `name` field inside
    # uses underscores - codex convention). TOMLs stay hand-maintained.
    toml_name="$name.toml"
    if [[ -f "$CODEX_DIR/$toml_name" ]]; then
        echo "  codex parity: $toml_name"
    else
        echo "  warn: no Codex TOML for $name (expected .codex/agents/$toml_name)" >&2
    fi
    echo
done

if [[ $CHECK -eq 1 && $ALL_OK -eq 0 ]]; then
    echo "Adapters are stale — run scripts/sync-agents." >&2
    exit 1
fi
echo "Done."
