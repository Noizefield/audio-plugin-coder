#!/usr/bin/env bash
# APC Master Builder (macOS)
# Configures, builds, and installs audio plugins using Xcode generator.
#
# Usage: bash scripts/build-and-install.sh <PluginName> [--no-install] [--skip-tests]

set -euo pipefail

# --- PARSE ARGUMENTS ---
PLUGIN_NAME=""
NO_INSTALL=false
SKIP_TESTS=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-install) NO_INSTALL=true; shift ;;
        --skip-tests) SKIP_TESTS=true; shift ;;
        -*) echo "Unknown option: $1" >&2; exit 1 ;;
        *) PLUGIN_NAME="$1"; shift ;;
    esac
done

if [[ -z "$PLUGIN_NAME" ]]; then
    echo "Usage: $0 <PluginName> [--no-install] [--skip-tests]" >&2
    exit 1
fi

# --- PATH RESOLUTION ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$ROOT_PATH/build"
PLUGIN_DIR="$ROOT_PATH/plugins/$PLUGIN_NAME"
STATUS_JSON="$PLUGIN_DIR/status.json"

# --- IMPORT MODULES ---
# shellcheck source=state-management.sh
. "$SCRIPT_DIR/state-management.sh"
# shellcheck source=error-detection.sh
. "$SCRIPT_DIR/error-detection.sh"

# --- DETECT FRAMEWORK ---
USE_VISAGE=false
if [[ -f "$STATUS_JSON" ]] && command -v jq &>/dev/null; then
    fw="$(jq -r '.ui_framework // "pending"' "$STATUS_JSON" 2>/dev/null || echo "pending")"
    if [[ "$fw" == "visage" ]]; then
        USE_VISAGE=true
    fi
fi

echo "--- APC BUILDER: $PLUGIN_NAME ---"
if $USE_VISAGE; then
    echo "Framework: visage"
fi

# --- VALIDATE PREREQUISITES ---
if [[ -f "$STATUS_JSON" ]] && command -v jq &>/dev/null; then
    current_phase="$(jq -r '.current_phase // ""' "$STATUS_JSON" 2>/dev/null || echo "")"
    if [[ "$current_phase" != "code" && "$current_phase" != "ship" && "$current_phase" != "complete" ]] && ! $SKIP_TESTS; then
        echo "WARNING: Plugin implementation not marked as complete. Use --skip-tests to override."
    fi
fi

# --- 1. CONFIGURE ---
echo "Configuring build..."
VISAGE_FLAG=""
if $USE_VISAGE; then
    VISAGE_FLAG="-DAPC_ENABLE_VISAGE:BOOL=ON"
fi

CONFIG_OUTPUT=""
CONFIG_OUTPUT=$(cmake -S "$ROOT_PATH" -B "$BUILD_DIR" \
    -G Xcode \
    -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=10.13 \
    --fresh \
    $VISAGE_FLAG 2>&1) || {
    echo "ERROR: CMake configuration failed" >&2
    echo "$CONFIG_OUTPUT" >&2

    if command -v jq &>/dev/null; then
        errors="$(parse_build_errors "$CONFIG_OUTPUT")"
        error_count="$(echo "$errors" | jq 'length')"
        if (( error_count > 0 )); then
            known="$(find_known_issue "$errors" 2>/dev/null || true)"
            if [[ -n "$known" ]]; then
                echo "Known issue detected: $(echo "$known" | jq -r '.title')"
            else
                new_issue_from_error "$errors" "$CONFIG_OUTPUT" 2>/dev/null || true
            fi
        fi
    fi
    exit 1
}

# --- 2. BUILD VST3 ---
echo "Compiling VST3..."
VST3_OUTPUT=""
VST3_OUTPUT=$(cmake --build "$BUILD_DIR" --config Release --target "${PLUGIN_NAME}_VST3" 2>&1) || {
    echo "ERROR: VST3 build failed" >&2
    echo "$VST3_OUTPUT" >&2

    if command -v jq &>/dev/null; then
        errors="$(parse_build_errors "$VST3_OUTPUT")"
        error_count="$(echo "$errors" | jq 'length')"
        if (( error_count > 0 )); then
            known="$(find_known_issue "$errors" 2>/dev/null || true)"
            if [[ -n "$known" ]]; then
                echo "Known issue detected: $(echo "$known" | jq -r '.title')"
            else
                new_issue_from_error "$errors" "$VST3_OUTPUT" 2>/dev/null || true
            fi
        fi
    fi
    exit 1
}

# --- 3. BUILD AU (AudioUnit) ---
echo "Compiling AudioUnit..."
AU_OUTPUT=""
AU_OUTPUT=$(cmake --build "$BUILD_DIR" --config Release --target "${PLUGIN_NAME}_AU" 2>&1) || {
    echo "WARNING: AudioUnit build failed (non-fatal)" >&2
    echo "$AU_OUTPUT" >&2
}

# --- 4. BUILD STANDALONE ---
echo "Compiling Standalone..."
STANDALONE_OUTPUT=""
STANDALONE_OUTPUT=$(cmake --build "$BUILD_DIR" --config Release --target "${PLUGIN_NAME}_Standalone" 2>&1) || {
    echo "WARNING: Standalone build failed (non-fatal)" >&2
    echo "$STANDALONE_OUTPUT" >&2
}

# --- 5. INSTALL ---
if ! $NO_INSTALL; then
    echo "Installing plugins..."

    # Find and install VST3
    VST3_BUNDLE="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.vst3" -type d | head -1)"
    if [[ -n "$VST3_BUNDLE" ]]; then
        VST3_DEST="$HOME/Library/Audio/Plug-Ins/VST3/${PLUGIN_NAME}.vst3"
        if [[ -d "$VST3_DEST" ]]; then
            rm -rf "$VST3_DEST"
        fi
        cp -R "$VST3_BUNDLE" "$VST3_DEST"
        echo "INSTALLED VST3 to: $VST3_DEST"
    else
        echo "WARNING: VST3 bundle not found in build output"
    fi

    # Find and install AU
    AU_BUNDLE="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.component" -type d 2>/dev/null | head -1 || true)"
    if [[ -n "$AU_BUNDLE" ]]; then
        AU_DEST="$HOME/Library/Audio/Plug-Ins/Components/${PLUGIN_NAME}.component"
        if [[ -d "$AU_DEST" ]]; then
            rm -rf "$AU_DEST"
        fi
        cp -R "$AU_BUNDLE" "$AU_DEST"
        echo "INSTALLED AU to: $AU_DEST"
    fi

    # Report Standalone location
    STANDALONE_APP="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.app" -type d 2>/dev/null | head -1 || true)"
    if [[ -n "$STANDALONE_APP" ]]; then
        echo "STANDALONE built at: $STANDALONE_APP"
        echo "Tip: Copy to /Applications/ if desired."
    fi
fi

# --- 6. UPDATE BUILD STATUS ---
if command -v jq &>/dev/null && [[ -f "$STATUS_JSON" ]]; then
    timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    update_plugin_state "$PLUGIN_DIR" \
        "validation.build_completed=true" \
        "validation.build_timestamp=$timestamp" \
        2>/dev/null || true
fi

echo "Build process complete!"
