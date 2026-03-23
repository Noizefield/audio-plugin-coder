#!/usr/bin/env bash
# APC Plugin Rollback (macOS/Linux)
# Restores a plugin from a ZIP backup.
#
# Usage: bash scripts/rollback.sh <PluginName> <Version>

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
PLUGIN_DIR="$ROOT_PATH/plugins/$PLUGIN_NAME"
BACKUP_ROOT="$ROOT_PATH/_backups/$PLUGIN_NAME"

# Strip 'v' prefix
CLEAN_VER="${VERSION#v}"

echo "--- ROLLBACK: $PLUGIN_NAME to v$CLEAN_VER ---"

# --- FIND BACKUP ZIP ---
if [[ ! -d "$BACKUP_ROOT" ]]; then
    echo "Error: No backups found for $PLUGIN_NAME" >&2
    exit 1
fi

# Find zips matching the version, sorted newest first
TARGET_ZIP="$(ls -t "$BACKUP_ROOT"/*v${CLEAN_VER}*.zip 2>/dev/null | head -1)"

if [[ -z "$TARGET_ZIP" ]]; then
    echo "Error: Could not find a backup zip for version $CLEAN_VER in $BACKUP_ROOT" >&2
    exit 1
fi

echo "Found Backup: $(basename "$TARGET_ZIP")"

# --- PERFORM ROLLBACK ---

# Remove current folder if it exists
if [[ -d "$PLUGIN_DIR" ]]; then
    echo "Clearing current source..."
    rm -rf "$PLUGIN_DIR"
fi

# Re-create empty folder
mkdir -p "$PLUGIN_DIR"

# Unzip
echo "Restoring from Zip..."
unzip -qo "$TARGET_ZIP" -d "$PLUGIN_DIR"

# Fix: If the zip created a nested folder (PluginName/PluginName/Source/...),
# move contents up one level
if [[ -d "$PLUGIN_DIR/$PLUGIN_NAME/Source" ]]; then
    echo "Adjusting folder structure..."
    mv "$PLUGIN_DIR/$PLUGIN_NAME"/* "$PLUGIN_DIR"/ 2>/dev/null || true
    mv "$PLUGIN_DIR/$PLUGIN_NAME"/.[!.]* "$PLUGIN_DIR"/ 2>/dev/null || true
    rmdir "$PLUGIN_DIR/$PLUGIN_NAME" 2>/dev/null || true
fi

echo "SUCCESS! $PLUGIN_NAME rolled back to v$CLEAN_VER"
