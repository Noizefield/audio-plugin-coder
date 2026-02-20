#!/usr/bin/env bash
# APC GUI Preview (macOS)
# Builds and launches the Standalone target for instant GUI preview.
#
# Usage: bash scripts/preview-design.sh <PluginName>

set -euo pipefail

# --- PARSE ARGUMENTS ---
PLUGIN_NAME="${1:-}"
if [[ -z "$PLUGIN_NAME" ]]; then
    echo "Usage: $0 <PluginName>" >&2
    exit 1
fi

# --- PATH RESOLUTION ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_PATH/build"
PLUGIN_DIR="$ROOT_PATH/plugins/$PLUGIN_NAME"
STATUS_JSON="$PLUGIN_DIR/status.json"

# --- DETECT FRAMEWORK ---
USE_VISAGE=false
FRAMEWORK_NAME="webview"
if [[ -f "$STATUS_JSON" ]] && command -v jq &>/dev/null; then
    fw="$(jq -r '.ui_framework // "pending"' "$STATUS_JSON" 2>/dev/null || echo "pending")"
    if [[ "$fw" == "visage" ]]; then
        USE_VISAGE=true
        FRAMEWORK_NAME="visage"
    fi
fi

echo "--- APC PREVIEW: $PLUGIN_NAME ---"
echo "Framework: $FRAMEWORK_NAME"

# --- 1. CONFIGURE ---
echo "Configuring..."
VISAGE_FLAG=""
if $USE_VISAGE; then
    VISAGE_FLAG="-DAPC_ENABLE_VISAGE:BOOL=ON"
fi

cmake -S "$ROOT_PATH" -B "$BUILD_DIR" \
    -G Xcode \
    -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=10.13 \
    --fresh \
    $VISAGE_FLAG

# Verify Visage flag in cache if applicable
if $USE_VISAGE && [[ -f "$BUILD_DIR/CMakeCache.txt" ]]; then
    if ! grep -q "APC_ENABLE_VISAGE:BOOL=ON" "$BUILD_DIR/CMakeCache.txt"; then
        echo "ERROR: APC_ENABLE_VISAGE is OFF in CMakeCache.txt. Reconfigure with -DAPC_ENABLE_VISAGE=ON." >&2
        exit 1
    fi
fi

# --- 2. BUILD STANDALONE ---
echo "Compiling Standalone..."
cmake --build "$BUILD_DIR" --config Release --target "${PLUGIN_NAME}_Standalone"

# --- 3. LAUNCH ---
STANDALONE_APP="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.app" -type d 2>/dev/null | head -1 || true)"

if [[ -n "$STANDALONE_APP" ]]; then
    echo "Launching..."
    open -W "$STANDALONE_APP"
    EXIT_CODE=$?
    if [[ $EXIT_CODE -ne 0 ]]; then
        echo "WARNING: CRASH DETECTED (exit code $EXIT_CODE). Check Console.app for crash logs."
    fi
else
    echo "ERROR: Standalone .app not found." >&2
    exit 1
fi
