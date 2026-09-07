#!/usr/bin/env bash
# Write or update apc.config.json (used by /apc-setup).
# Usage:
#   bash scripts/apc-write-config.sh \
#     --plugins plugins --build build --release release \
#     --ui webview --profile balanced --platform macos --completed
#   bash scripts/apc-write-config.sh ... --enable-codex [--enable-codex-escalation] [--install-codex-profiles]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/apc-paths.sh
. "$SCRIPT_DIR/lib/apc-paths.sh"

PLUGINS="plugins"
BUILD="build"
RELEASE="release"
UI="webview"
ENABLE_VISAGE=false
PROFILE="balanced"
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
[[ "$PLATFORM" == "darwin" ]] && PLATFORM="macos"
COMPLETED=false
ENABLE_CODEX=false
ENABLE_CODEX_ESCALATION=false
INSTALL_CODEX_PROFILES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --plugins) PLUGINS="$2"; shift 2 ;;
        --build) BUILD="$2"; shift 2 ;;
        --release) RELEASE="$2"; shift 2 ;;
        --ui) UI="$2"; shift 2 ;;
        --enable-visage) ENABLE_VISAGE=true; shift ;;
        --profile) PROFILE="$2"; shift 2 ;;
        --platform) PLATFORM="$2"; shift 2 ;;
        --completed) COMPLETED=true; shift ;;
        --enable-codex) ENABLE_CODEX=true; shift ;;
        --enable-codex-escalation) ENABLE_CODEX_ESCALATION=true; shift ;;
        --install-codex-profiles) INSTALL_CODEX_PROFILES=true; shift ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

ROOT="$(apc_repo_root)"
EXAMPLE="$ROOT/apc.config.example.json"
OUT="$ROOT/apc.config.json"

if [[ ! -f "$EXAMPLE" ]]; then
    echo "Missing $EXAMPLE" >&2
    exit 1
fi

if command -v jq &>/dev/null; then
    COMPLETED_AT="null"
    COMPLETED_BOOL=false
    if $COMPLETED; then
        COMPLETED_AT="\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\""
        COMPLETED_BOOL=true
    fi

    # Start from existing local config when present; else example. Always ensure models.codex from example.
    BASE="$EXAMPLE"
    if [[ -f "$OUT" ]]; then
        BASE="$OUT"
    fi

    TMP="$(mktemp)"
    jq \
        --slurpfile example "$EXAMPLE" \
        --arg plugins "$PLUGINS" \
        --arg build "$BUILD" \
        --arg release "$RELEASE" \
        --arg ui "$UI" \
        --argjson visage "$ENABLE_VISAGE" \
        --arg profile "$PROFILE" \
        --arg platform "$PLATFORM" \
        --argjson completed "$COMPLETED_BOOL" \
        --argjson completed_at "$COMPLETED_AT" \
        --argjson enable_codex "$ENABLE_CODEX" \
        --argjson enable_codex_esc "$ENABLE_CODEX_ESCALATION" \
        '
        . as $cfg
        | ($example[0].models.codex) as $codex_default
        | $cfg
        | .paths.plugins_dir=$plugins
        | .paths.build_dir=$build
        | .paths.release_dir=$release
        | .defaults.ui_framework_preference=$ui
        | .defaults.enable_visage=$visage
        | .models.profile=$profile
        | .models.codex = (.models.codex // $codex_default)
        | .models.codex.enabled = $enable_codex
        | .models.codex.escalation = (.models.codex.escalation // $codex_default.escalation)
        | .models.codex.escalation.enabled = $enable_codex_esc
        | .setup.completed=$completed
        | .setup.completed_at=$completed_at
        | .setup.platform=$platform
        ' \
        "$BASE" > "$TMP"
    mv "$TMP" "$OUT"
else
    cp "$EXAMPLE" "$OUT"
    echo "WARNING: jq not found; copied example. Install jq and re-run to apply options." >&2
fi

apc_load_paths
mkdir -p "$APC_PLUGINS_DIR" "$APC_BUILD_DIR" "$APC_RELEASE_DIR"

if $ENABLE_CODEX || $INSTALL_CODEX_PROFILES; then
    if [[ -f "$ROOT/scripts/codex/install-profiles.sh" ]]; then
        bash "$ROOT/scripts/codex/install-profiles.sh" || true
    fi
fi

echo "Wrote $OUT"
echo "Plugins: $APC_PLUGINS_DIR"
echo "Build:   $APC_BUILD_DIR"
echo "Release: $APC_RELEASE_DIR"
if command -v jq &>/dev/null; then
    echo "Codex orchestration: enabled=$(jq -r '.models.codex.enabled // false' "$OUT") escalation=$(jq -r '.models.codex.escalation.enabled // false' "$OUT")"
fi
