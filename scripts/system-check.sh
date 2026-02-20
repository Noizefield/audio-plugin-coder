#!/usr/bin/env bash
# APC System Check (macOS)
# Validates all dependencies required for building audio plugins.
# Usage: bash scripts/system-check.sh [--check-all]

set -euo pipefail

# --- HELPERS ---

version_gte() {
    # Returns 0 if $1 >= $2 (semantic version comparison)
    local v1="$1" v2="$2"
    if [[ "$(printf '%s\n' "$v2" "$v1" | sort -V | head -n1)" == "$v2" ]]; then
        return 0
    fi
    return 1
}

json_bool() {
    if [[ "$1" == "true" ]]; then echo "true"; else echo "false"; fi
}

# --- CHECK FUNCTIONS ---

check_platform() {
    local platform="macos"
    local ver=""
    if command -v sw_vers &>/dev/null; then
        ver="$(sw_vers -productVersion 2>/dev/null || echo "unknown")"
    fi
    echo "{\"platform\":\"$platform\",\"version\":\"$ver\"}"
}

check_xcode() {
    if xcode-select -p &>/dev/null; then
        local xcode_path
        xcode_path="$(xcode-select -p)"
        # Get Xcode version if available
        local ver="unknown"
        if command -v xcodebuild &>/dev/null; then
            ver="$(xcodebuild -version 2>/dev/null | head -1 | sed 's/Xcode //' || echo "unknown")"
        fi
        echo "{\"found\":true,\"version\":\"$ver\",\"path\":\"$xcode_path\",\"ok\":true}"
    else
        echo "{\"found\":false,\"error\":\"Xcode command line tools not installed. Run: xcode-select --install\"}"
    fi
}

check_cmake() {
    local min_ver="3.22"
    if command -v cmake &>/dev/null; then
        local ver
        ver="$(cmake --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")"
        local ok="false"
        if version_gte "$ver" "$min_ver"; then
            ok="true"
        fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":$ok}"
    else
        echo "{\"found\":false}"
    fi
}

check_python() {
    local min_ver="3.8"
    local py_cmd=""

    if command -v python3 &>/dev/null; then
        py_cmd="python3"
    elif command -v python &>/dev/null; then
        py_cmd="python"
    fi

    if [[ -n "$py_cmd" ]]; then
        local out
        out="$($py_cmd --version 2>&1 || echo "")"
        local ver
        ver="$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")"
        local ok="false"
        if version_gte "$ver" "$min_ver"; then
            ok="true"
        fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":$ok}"
    else
        echo "{\"found\":false}"
    fi
}

check_juce() {
    local path="./_tools/JUCE"
    if [[ -f "$path/modules/juce_core/juce_core.h" ]]; then
        echo "{\"found\":true,\"path\":\"$path\",\"ok\":true}"
    else
        echo "{\"found\":false,\"path\":\"$path\"}"
    fi
}

check_jq() {
    if command -v jq &>/dev/null; then
        local ver
        ver="$(jq --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' || echo "unknown")"
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":true}"
    else
        echo "{\"found\":false,\"error\":\"Install with: brew install jq\"}"
    fi
}

check_all() {
    echo "{"
    echo "  \"platform\": $(check_platform),"
    echo "  \"xcode\": $(check_xcode),"
    echo "  \"cmake\": $(check_cmake),"
    echo "  \"python\": $(check_python),"
    echo "  \"juce\": $(check_juce),"
    echo "  \"jq\": $(check_jq)"
    echo "}"
}

# --- MAIN ---
case "${1:---check-all}" in
    --check-all) check_all ;;
    *) check_all ;;
esac
