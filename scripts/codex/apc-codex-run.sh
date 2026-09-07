#!/usr/bin/env bash
# Cost-aware Codex CLI runner for APC (ChatGPT auth, tier routing, JSONL usage log).
# Usage:
#   bash scripts/codex/apc-codex-run.sh --prompt "find TODOs" --phase status
#   bash scripts/codex/apc-codex-run.sh --prompt "…" --dry-run
#   bash scripts/codex/apc-codex-run.sh --prompt "…" --phase impl --plugin VinylNoize --escalate
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../lib/apc-paths.sh
source "$ROOT/scripts/lib/apc-paths.sh"
apc_load_paths

PROMPT=""
PHASE=""
TIER=""
PLUGIN=""
DRY_RUN=0
SKIP_AUTH=0
ESCALATE=0
USE_PROFILE=0
VERIFY_CMD=""
WORKDIR="$ROOT"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt|-p) PROMPT="$2"; shift 2 ;;
    --phase) PHASE="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --plugin) PLUGIN="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-auth) SKIP_AUTH=1; shift ;;
    --escalate) ESCALATE=1; shift ;;
    --use-profile) USE_PROFILE=1; shift ;;
    --verify) VERIFY_CMD="$2"; shift 2 ;;
    --cd) WORKDIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$PROMPT" ]]; then PROMPT="$1"; shift; else echo "Unknown arg: $1" >&2; exit 2; fi
      ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "Missing --prompt" >&2
  exit 2
fi

CFG="$(apc_codex_config_file)"
require_auth=true
default_tier=terra
usage_rel=".tmp/codex-usage"
if [[ -n "$CFG" ]] && command -v jq >/dev/null 2>&1; then
  require_auth="$(jq -r '.models.codex.require_chatgpt_auth // true' "$CFG")"
  default_tier="$(jq -r '.models.codex.default_tier // "terra"' "$CFG")"
  usage_rel="$(jq -r '.models.codex.usage_log_dir // ".tmp/codex-usage"' "$CFG")"
  esc_cfg="$(jq -r '.models.codex.escalation.enabled // false' "$CFG")"
  if [[ "$esc_cfg" == "true" ]]; then ESCALATE=1; fi
  if [[ -z "$VERIFY_CMD" ]]; then
    VERIFY_CMD="$(jq -r '.models.codex.escalation.verify_command // empty' "$CFG")"
  fi
fi

heuristic_tier() {
  local t
  t="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$t" in
    *architecture*|*race\ condition*|*root\ cause*|*security*|*concurrency*|*deadlock*|*intermittent*) echo sol; return ;;
  esac
  case "$t" in
    *find\ *|*list\ *|*search*|*extract*|*summarize*|*grep*|*todo*) echo luna; return ;;
  esac
  case "$t" in
    *implement*|*write\ tests*|*refactor*|*fix\ *|*bug*) echo terra; return ;;
  esac
  echo ""
}

resolve_tier() {
  if [[ -n "$TIER" ]]; then echo "$TIER"; return; fi
  local h
  h="$(heuristic_tier "$PROMPT")"
  if [[ -n "$h" ]]; then echo "$h"; return; fi
  if [[ -n "$PHASE" ]]; then
    apc_codex_tier_for_phase "$PHASE"
    return
  fi
  echo "$default_tier"
}

tier_model() {
  case "$1" in
    luna) apc_codex_tier_field luna model gpt-5.6-luna ;;
    terra) apc_codex_tier_field terra model gpt-5.6-terra ;;
    sol) apc_codex_tier_field sol model gpt-5.6 ;;
    astra) apc_codex_tier_field astra model gpt-6-astra ;;
    *) echo "" ;;
  esac
}

tier_profile() {
  case "$1" in
    luna) apc_codex_tier_field luna profile luna ;;
    terra) apc_codex_tier_field terra profile terra ;;
    sol) apc_codex_tier_field sol profile sol ;;
    astra) apc_codex_tier_field astra profile astra ;;
    *) echo "$1" ;;
  esac
}

tier_max_attempts() {
  case "$1" in
    luna) apc_codex_tier_field luna max_attempts 1 ;;
    terra) apc_codex_tier_field terra max_attempts 2 ;;
    sol) apc_codex_tier_field sol max_attempts 1 ;;
    astra) apc_codex_tier_field astra max_attempts 1 ;;
    *) echo 1 ;;
  esac
}

usage_log() {
  local dir
  if [[ "$usage_rel" = /* ]]; then dir="$usage_rel"; else dir="$ROOT/$usage_rel"; fi
  mkdir -p "$dir"
  printf '%s\n' "$1" >>"$dir/usage.jsonl"
}

if [[ "$SKIP_AUTH" -eq 0 ]]; then
  if ! command -v codex >/dev/null 2>&1; then
    echo "codex CLI not found on PATH" >&2
    exit 1
  fi
  AUTH_OUT="$(codex login status 2>&1 || true)"
  if [[ "$require_auth" == "true" ]] && echo "$AUTH_OUT" | grep -qiE 'api.?key'; then
    echo "Codex is authenticated with an API key. Use ChatGPT sign-in, or set models.codex.require_chatgpt_auth=false." >&2
    exit 1
  fi
fi

CURRENT="$(resolve_tier)"
echo "APC Codex run: tier=$CURRENT phase=$PHASE dryRun=$DRY_RUN escalate=$ESCALATE"

if [[ -z "$VERIFY_CMD" && -n "$PLUGIN" && "$ESCALATE" -eq 1 ]]; then
  VERIFY_CMD="bash \"$ROOT/scripts/build-and-install.sh\" $PLUGIN"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '{"tier":"%s","model":"%s","profile":"%s","prompt":%s}\n' \
    "$CURRENT" "$(tier_model "$CURRENT")" "$(tier_profile "$CURRENT")" \
    "$(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$PROMPT")"
  exit 0
fi

escalations=0
while true; do
  model="$(tier_model "$CURRENT")"
  profile="$(tier_profile "$CURRENT")"
  max_a="$(tier_max_attempts "$CURRENT")"
  ok=0
  for ((i=1; i<=max_a; i++)); do
    echo "Attempt $i/$max_a on tier $CURRENT ($model)"
    jsonl="$(mktemp)"
    set +e
    if [[ "$USE_PROFILE" -eq 1 ]]; then
      codex exec --profile "$profile" --json -C "$WORKDIR" "$PROMPT" >"$jsonl" 2>&1
    else
      codex exec --model "$model" --json -C "$WORKDIR" "$PROMPT" >"$jsonl" 2>&1
    fi
    ec=$?
    set -e
    cat "$jsonl"

    if grep -qi 'usage limit' "$jsonl"; then
      usage_log "{\"timestamp\":\"$(date -Iseconds)\",\"tier\":\"$CURRENT\",\"model\":\"$model\",\"usage_limit\":true}"
      echo "Codex usage limit hit. Retry after the window resets." >&2
      exit 1
    fi

    verified=0
    if [[ $ec -eq 0 ]]; then
      if [[ -n "$VERIFY_CMD" ]]; then
        echo "Verify: $VERIFY_CMD"
        set +e
        eval "$VERIFY_CMD"
        ve=$?
        set -e
        [[ $ve -eq 0 ]] && verified=1
      else
        verified=1
      fi
    fi

    usage_log "{\"timestamp\":\"$(date -Iseconds)\",\"phase\":\"$PHASE\",\"tier\":\"$CURRENT\",\"model\":\"$model\",\"exit_code\":$ec,\"verified\":$([ $verified -eq 1 ] && echo true || echo false)}"

    if [[ $verified -eq 1 ]]; then
      ok=1
      break
    fi
  done

  if [[ $ok -eq 1 ]]; then
    echo "Done on tier $CURRENT"
    exit 0
  fi

  if [[ $ESCALATE -eq 0 ]]; then
    echo "Failed on tier $CURRENT. Re-run with --escalate or enable models.codex.escalation.enabled." >&2
    exit 1
  fi

  next="$(apc_codex_next_tier "$CURRENT" || true)"
  if [[ -z "$next" ]]; then
    echo "Escalation exhausted at $CURRENT" >&2
    exit 1
  fi
  escalations=$((escalations + 1))
  if [[ $escalations -gt 3 ]]; then
    echo "Escalation budget exceeded" >&2
    exit 1
  fi
  echo "Escalating $CURRENT -> $next"
  usage_log "{\"timestamp\":\"$(date -Iseconds)\",\"tier\":\"$CURRENT\",\"escalated\":true,\"next_tier\":\"$next\"}"
  CURRENT="$next"
done
