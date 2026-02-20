#!/usr/bin/env bash
# APC Plugin Backup (macOS/Linux)
# Creates a clean ZIP backup of a plugin, excluding build artifacts.
#
# Usage: bash scripts/backup.sh <PluginName> <Version>

set -euo pipefail

# --- PARSE ARGUMENTS ---
PLUGIN_NAME="${1:-}"
VERSION="${2:-}"

if [[ -z "$PLUGIN_NAME" || -z "$VERSION" ]]; then
    echo "Usage: $0 <PluginName> <Version>" >&2
    exit 1
fi

# --- PATH RESOLUTION ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$ROOT_PATH/plugins/$PLUGIN_NAME"
BACKUP_ROOT="$ROOT_PATH/_backups"

# Strip 'v' prefix if user typed "v1.0"
CLEAN_VER="${VERSION#v}"
TIMESTAMP="$(date +%Y%m%d_%H%M)"
ZIP_NAME="${PLUGIN_NAME}_v${CLEAN_VER}_${TIMESTAMP}.zip"
TARGET_ZIP="$BACKUP_ROOT/$PLUGIN_NAME/$ZIP_NAME"

# --- VALIDATION ---
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo "Error: Plugin '$PLUGIN_NAME' not found at $SOURCE_DIR" >&2
    exit 1
fi

# --- CREATE TEMP STAGING AREA ---
TEMP_DIR="$(mktemp -d)"
STAGE_DIR="$TEMP_DIR/$PLUGIN_NAME"
mkdir -p "$STAGE_DIR"

echo "--- BACKUP: $PLUGIN_NAME ($VERSION) ---"
echo "Staging files..."

# --- COPY SOURCE ---
cp -R "$SOURCE_DIR"/* "$STAGE_DIR"/ 2>/dev/null || true
# Also copy dotfiles/dot-directories (like .ideas)
cp -R "$SOURCE_DIR"/.[!.]* "$STAGE_DIR"/ 2>/dev/null || true

# --- CLEAN STAGING AREA (Remove Artifacts) ---
EXCLUSIONS=(
    "build"
    "cmake-build-*"
    ".vs"
    "*.user"
    "*.suo"
    "*.ncb"
    "*.db"
    "*.ipch"
    ".DS_Store"
)

for pattern in "${EXCLUSIONS[@]}"; do
    find "$STAGE_DIR" -name "$pattern" -exec rm -rf {} + 2>/dev/null || true
done

# --- ZIP ---
mkdir -p "$BACKUP_ROOT/$PLUGIN_NAME"

echo "Compressing to: $TARGET_ZIP"
(cd "$TEMP_DIR" && zip -rq "$TARGET_ZIP" "$PLUGIN_NAME")

# --- CLEANUP ---
rm -rf "$TEMP_DIR"

echo "SUCCESS! Backup saved to: $TARGET_ZIP"
