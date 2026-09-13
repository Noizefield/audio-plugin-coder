#!/usr/bin/env bash
# Start the APC Hub live dashboard (read-only command center).
# Launches hub/server.js (Node stdlib only, loopback 127.0.0.1) and opens
# the dashboard in the default browser. The server never writes, builds,
# or executes anything.
# Usage: bash scripts/apc-hub.sh [--port 4872] [--no-open]
set -euo pipefail

PORT=4872
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    --no-open) EXTRA+=(--no-open); shift ;;
    *) shift ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="$REPO_ROOT/hub/server.js"

if [[ ! -f "$SERVER" ]]; then echo "Hub server not found: $SERVER" >&2; exit 1; fi
if ! command -v node >/dev/null 2>&1; then echo "Node.js (>=18) is required for APC Hub. See docs/hub.md." >&2; exit 1; fi

echo "-> APC Hub starting (http://localhost:$PORT/)"
exec node "$SERVER" --port "$PORT" "${EXTRA[@]}"
