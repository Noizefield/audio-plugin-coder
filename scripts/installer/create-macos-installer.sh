#!/usr/bin/env bash
# APC macOS Installer Creator
# Creates a DMG containing VST3, AU, and Standalone builds.
#
# Usage: bash scripts/installer/create-macos-installer.sh <PluginName> <Version> [CompanyName]

set -euo pipefail

# --- PARSE ARGUMENTS ---
PLUGIN_NAME="${1:-}"
VERSION="${2:-}"
COMPANY_NAME="${3:-APC}"

if [[ -z "$PLUGIN_NAME" || -z "$VERSION" ]]; then
    echo "Usage: $0 <PluginName> <Version> [CompanyName]" >&2
    exit 1
fi

# --- PATH RESOLUTION ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_PATH="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_DIR="$ROOT_PATH/build"
DIST_DIR="$ROOT_PATH/dist"
PLUGIN_DIR="$ROOT_PATH/plugins/$PLUGIN_NAME"

DMG_NAME="${PLUGIN_NAME}-${VERSION}-macOS.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"

echo "========================================"
echo "  Creating macOS Installer"
echo "  Plugin: $PLUGIN_NAME"
echo "  Version: $VERSION"
echo "========================================"
echo ""

# --- CHECK PREREQUISITES ---

# Check for build artifacts
VST3_BUNDLE="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.vst3" -type d 2>/dev/null | head -1 || true)"
AU_BUNDLE="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.component" -type d 2>/dev/null | head -1 || true)"
STANDALONE_APP="$(find "$BUILD_DIR" -name "${PLUGIN_NAME}.app" -type d 2>/dev/null | head -1 || true)"

if [[ -z "$VST3_BUNDLE" ]]; then
    echo "ERROR: VST3 build not found. Please build the plugin first." >&2
    echo "Run: bash scripts/build-and-install.sh $PLUGIN_NAME" >&2
    exit 1
fi

echo "[OK] Build artifacts found"
echo "  VST3: $VST3_BUNDLE"
[[ -n "$AU_BUNDLE" ]] && echo "  AU: $AU_BUNDLE"
[[ -n "$STANDALONE_APP" ]] && echo "  Standalone: $STANDALONE_APP"

# --- CREATE LICENSE FILE ---

LICENSE_PATH="$DIST_DIR/LICENSE.txt"
if [[ ! -f "$LICENSE_PATH" ]]; then
    echo "Creating license file..."
    mkdir -p "$DIST_DIR"
    CURRENT_YEAR="$(date +%Y)"
    cat > "$LICENSE_PATH" << EOLICENSE
================================================================================
                    $PLUGIN_NAME END USER LICENSE AGREEMENT
================================================================================

IMPORTANT: PLEASE READ THIS LICENSE CAREFULLY BEFORE USING THIS SOFTWARE.

1. GRANT OF LICENSE
   This software is licensed, not sold. By installing or using this software,
   you agree to be bound by the terms of this agreement.

2. PERMITTED USE
   - You may install and use this software on multiple computers
   - You may use this software for commercial and non-commercial purposes
   - You may create and distribute audio content using this software

3. RESTRICTIONS
   - You may not reverse engineer, decompile, or disassemble this software
   - You may not redistribute or resell this software
   - You may not remove or alter any copyright notices

4. DISCLAIMER OF WARRANTY
   THIS SOFTWARE IS PROVIDED AS IS WITHOUT WARRANTY OF ANY KIND.

5. LIMITATION OF LIABILITY
   IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY DAMAGES ARISING FROM
   THE USE OF THIS SOFTWARE.

================================================================================
By installing this software, you acknowledge that you have read, understood,
and agree to be bound by these terms.

Copyright (c) $CURRENT_YEAR $COMPANY_NAME
================================================================================
EOLICENSE
    echo "License file created: $LICENSE_PATH"
fi

# --- CREATE DMG STAGING AREA ---

echo "Preparing DMG contents..."
STAGING_DIR="$(mktemp -d)"
DMG_CONTENTS="$STAGING_DIR/$PLUGIN_NAME"
mkdir -p "$DMG_CONTENTS"

# Copy VST3
if [[ -n "$VST3_BUNDLE" ]]; then
    mkdir -p "$DMG_CONTENTS/VST3"
    cp -R "$VST3_BUNDLE" "$DMG_CONTENTS/VST3/"
    echo "  Added VST3"
fi

# Copy AU
if [[ -n "$AU_BUNDLE" ]]; then
    mkdir -p "$DMG_CONTENTS/AU"
    cp -R "$AU_BUNDLE" "$DMG_CONTENTS/AU/"
    echo "  Added AudioUnit"
fi

# Copy Standalone
if [[ -n "$STANDALONE_APP" ]]; then
    cp -R "$STANDALONE_APP" "$DMG_CONTENTS/"
    echo "  Added Standalone"
fi

# Copy License
cp "$LICENSE_PATH" "$DMG_CONTENTS/LICENSE.txt"

# Copy Documentation if it exists
if [[ -d "$PLUGIN_DIR/Documentation" ]]; then
    cp -R "$PLUGIN_DIR/Documentation" "$DMG_CONTENTS/Documentation"
    echo "  Added Documentation"
fi

# Create README for installation
cat > "$DMG_CONTENTS/INSTALL.txt" << EOINSTALL
$PLUGIN_NAME v$VERSION - Installation Guide
================================================================================

AUTOMATIC INSTALLATION:
  Run the included install.command file (double-click it).

MANUAL INSTALLATION:

  VST3 Plugin:
    Copy "$PLUGIN_NAME.vst3" from the VST3 folder to:
    ~/Library/Audio/Plug-Ins/VST3/

  AudioUnit Plugin:
    Copy "$PLUGIN_NAME.component" from the AU folder to:
    ~/Library/Audio/Plug-Ins/Components/

  Standalone Application:
    Drag "$PLUGIN_NAME.app" to your Applications folder.

After installation, restart your DAW to detect the new plugin.

================================================================================
Created by $COMPANY_NAME
EOINSTALL

# Create install.command helper script
cat > "$DMG_CONTENTS/install.command" << 'EOINSTALLSCRIPT'
#!/usr/bin/env bash
# Installer helper for
EOINSTALLSCRIPT

cat >> "$DMG_CONTENTS/install.command" << EOINSTALLSCRIPT
# $PLUGIN_NAME

set -e
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"

echo "Installing $PLUGIN_NAME..."

# Install VST3
if [[ -d "\$SCRIPT_DIR/VST3/${PLUGIN_NAME}.vst3" ]]; then
    VST3_DIR="\$HOME/Library/Audio/Plug-Ins/VST3"
    mkdir -p "\$VST3_DIR"
    rm -rf "\$VST3_DIR/${PLUGIN_NAME}.vst3"
    cp -R "\$SCRIPT_DIR/VST3/${PLUGIN_NAME}.vst3" "\$VST3_DIR/"
    echo "  Installed VST3 to \$VST3_DIR/"
fi

# Install AU
if [[ -d "\$SCRIPT_DIR/AU/${PLUGIN_NAME}.component" ]]; then
    AU_DIR="\$HOME/Library/Audio/Plug-Ins/Components"
    mkdir -p "\$AU_DIR"
    rm -rf "\$AU_DIR/${PLUGIN_NAME}.component"
    cp -R "\$SCRIPT_DIR/AU/${PLUGIN_NAME}.component" "\$AU_DIR/"
    echo "  Installed AU to \$AU_DIR/"
fi

# Install Standalone
if [[ -d "\$SCRIPT_DIR/${PLUGIN_NAME}.app" ]]; then
    cp -R "\$SCRIPT_DIR/${PLUGIN_NAME}.app" "/Applications/" 2>/dev/null || {
        echo "  Could not copy to /Applications (permission denied). Copying to ~/Applications instead."
        mkdir -p "\$HOME/Applications"
        cp -R "\$SCRIPT_DIR/${PLUGIN_NAME}.app" "\$HOME/Applications/"
    }
    echo "  Installed Standalone"
fi

echo ""
echo "Installation complete! Restart your DAW to detect the plugin."
echo "Press any key to close..."
read -n 1
EOINSTALLSCRIPT

chmod +x "$DMG_CONTENTS/install.command"

# --- CREATE DMG ---

echo "Creating DMG..."
mkdir -p "$DIST_DIR"

# Remove existing DMG if present
rm -f "$DMG_PATH"

# Create DMG using hdiutil
hdiutil create \
    -volname "$PLUGIN_NAME $VERSION" \
    -srcfolder "$DMG_CONTENTS" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

# --- CLEANUP ---
rm -rf "$STAGING_DIR"

# --- VERIFY OUTPUT ---
if [[ -f "$DMG_PATH" ]]; then
    FILE_SIZE="$(du -h "$DMG_PATH" | cut -f1)"
    echo ""
    echo "========================================"
    echo "  Installer Created Successfully!"
    echo "========================================"
    echo "  File: $DMG_PATH"
    echo "  Size: $FILE_SIZE"
    echo "========================================"
else
    echo "ERROR: DMG file not found at expected location: $DMG_PATH" >&2
    exit 1
fi
