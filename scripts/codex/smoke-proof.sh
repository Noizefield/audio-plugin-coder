#!/usr/bin/env bash
# Post-allowance Codex CLI smoke checks for APC cost orchestration.
# Usage: bash scripts/codex/smoke-proof.sh [--skip-live]
set -euo pipefail

SKIP_LIVE=0
if [[ "${1:-}" == "--skip-live" ]]; then
  SKIP_LIVE=1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/.tmp/codex-smoke"
SCHEMA="$ROOT/scripts/codex/routing-schema.json"
mkdir -p "$OUT"

step() { printf '[%s] %s%s\n' "$1" "$2" "${3:+ - $3}"; }

if ! command -v codex >/dev/null 2>&1; then
  step FAIL Auth "codex not found"
  exit 1
fi

AUTH_OUT="$(codex login status 2>&1 || true)"
if echo "$AUTH_OUT" | grep -qiE 'api.?key'; then
  step FAIL Auth "API-key auth detected; use ChatGPT sign-in"
  exit 1
fi
step PASS Auth "login status ok"

if [[ ! -f "$ROOT/scripts/codex/profiles/luna.config.toml" ]]; then
  step FAIL "Profiles present" "missing luna template"
  exit 1
fi
step PASS "Profiles present" "luna.config.toml"

if [[ "$SKIP_LIVE" -eq 1 ]]; then
  step SKIP "Live exec" "--skip-live"
  exit 0
fi

echo "Running luna --json smoke..."
if ! codex exec --model gpt-5.6-luna --json "Reply with exactly: ok" >"$OUT/luna-jsonl.txt" 2>&1; then
  :
fi
if grep -qi 'usage limit' "$OUT/luna-jsonl.txt"; then
  step BLOCKED "turn.completed.usage" "Plus usage limit - retry after reset"
  exit 2
fi
if grep -q 'turn.completed' "$OUT/luna-jsonl.txt" && grep -q 'input_tokens' "$OUT/luna-jsonl.txt"; then
  step PASS "turn.completed.usage"
else
  step FAIL "turn.completed.usage" "see $OUT/luna-jsonl.txt"
  exit 1
fi

echo "Running: codex exec --profile luna ..."
codex exec --profile luna --json "Reply with exactly: profile-ok" >"$OUT/luna-profile-jsonl.txt" 2>&1 || true
if grep -qi 'usage limit' "$OUT/luna-profile-jsonl.txt"; then
  step BLOCKED "profile smoke" "usage limit"
  exit 2
fi
if grep -qiE 'unknown profile|no such profile|profile.*not found' "$OUT/luna-profile-jsonl.txt"; then
  step FAIL "profile smoke" "Profile luna not found - run scripts/codex/install-profiles.sh"
  exit 1
fi
if grep -q 'turn.completed' "$OUT/luna-profile-jsonl.txt"; then
  step PASS "profile smoke" "--profile luna"
else
  step FAIL "profile smoke" "see $OUT/luna-profile-jsonl.txt"
  exit 1
fi

if [[ -f "$SCHEMA" ]]; then
  codex exec --model gpt-5.6-luna --json --output-schema "$SCHEMA" -o "$OUT/routing-result.json" \
    "Classify this task: list all TODO comments. Return cheapest capable tier." \
    >"$OUT/schema-jsonl.txt" 2>&1 || true
  if [[ -f "$OUT/routing-result.json" ]]; then
    step PASS output-schema "$OUT/routing-result.json"
  elif grep -qi 'usage limit' "$OUT/schema-jsonl.txt"; then
    step BLOCKED output-schema "usage limit"
    exit 2
  else
    step WARN output-schema "no -o file; check Codex flags"
  fi
fi

echo "Smoke proof finished. Artifacts in $OUT"
