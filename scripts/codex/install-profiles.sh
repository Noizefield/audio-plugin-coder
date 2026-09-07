#!/usr/bin/env bash
# Copy APC Codex profile templates into ~/.codex (or $CODEX_HOME).
# Usage: bash scripts/codex/install-profiles.sh [--force]
set -euo pipefail

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/scripts/codex/profiles"
DEST="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$DEST"

for f in "$SRC"/*.config.toml; do
  base="$(basename "$f")"
  if [[ -f "$DEST/$base" && "$FORCE" -eq 0 ]]; then
    echo "Skip existing $base (use --force to overwrite)"
  else
    cp "$f" "$DEST/$base"
    echo "Installed $base -> $DEST/$base"
  fi
done

echo "Done. Example: codex exec --profile luna \"Reply with ok\""
