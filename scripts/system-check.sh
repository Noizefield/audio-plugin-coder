#!/usr/bin/env bash
# APC System Check (macOS / Linux)
# Validates dependencies required for building audio plugins.
# Usage: bash scripts/system-check.sh [--check-all|--human]

set -euo pipefail

HUMAN=false
case "${1:---check-all}" in
    --human) HUMAN=true ;;
esac

version_gte() {
    local v1="$1" v2="$2"
    if [[ "$(printf '%s\n' "$v2" "$v1" | sort -V | head -n1)" == "$v2" ]]; then
        return 0
    fi
    return 1
}

detect_os() {
    case "$(uname -s)" in
        Darwin) echo "macos" ;;
        Linux) echo "linux" ;;
        *) echo "unknown" ;;
    esac
}

check_platform() {
    local platform
    platform="$(detect_os)"
    local ver="unknown"
    if [[ "$platform" == "macos" ]] && command -v sw_vers &>/dev/null; then
        ver="$(sw_vers -productVersion 2>/dev/null || echo "unknown")"
    elif [[ "$platform" == "linux" ]]; then
        ver="$(uname -r 2>/dev/null || echo "unknown")"
    fi
    echo "{\"platform\":\"$platform\",\"version\":\"$ver\"}"
}

check_git() {
    if command -v git &>/dev/null; then
        local ver
        ver="$(git --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")"
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false}"
    fi
}

check_node() {
    if command -v node &>/dev/null; then
        local ver
        ver="$(node --version 2>/dev/null | tr -d 'v')"
        local ok="false"
        if version_gte "$ver" "18.0.0"; then ok="true"; fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":$ok}"
    else
        echo "{\"found\":false,\"ok\":false}"
    fi
}

check_xcode() {
    if [[ "$(detect_os)" != "macos" ]]; then
        echo "{\"found\":false,\"ok\":true,\"skipped\":true}"
        return
    fi
    if xcode-select -p &>/dev/null; then
        local ver="unknown"
        if command -v xcodebuild &>/dev/null; then
            ver="$(xcodebuild -version 2>/dev/null | head -1 | sed 's/Xcode //' || echo "unknown")"
        fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false,\"error\":\"Run: xcode-select --install\"}"
    fi
}

check_compiler() {
    if [[ "$(detect_os)" == "macos" ]]; then
        echo "{\"found\":true,\"ok\":true,\"skipped\":true}"
        return
    fi
    if command -v g++ &>/dev/null || command -v clang++ &>/dev/null; then
        local ver="unknown"
        if command -v g++ &>/dev/null; then
            ver="$(g++ --version 2>/dev/null | head -1 || echo "g++")"
        else
            ver="$(clang++ --version 2>/dev/null | head -1 || echo "clang++")"
        fi
        # Escape quotes for JSON
        ver="${ver//\"/\'}"
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false}"
    fi
}

check_cmake() {
    local min_ver="3.22"
    if command -v cmake &>/dev/null; then
        local ver
        ver="$(cmake --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")"
        local ok="false"
        if version_gte "$ver" "$min_ver"; then ok="true"; fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":$ok}"
    else
        echo "{\"found\":false,\"ok\":false}"
    fi
}

check_python() {
    local min_ver="3.8"
    local py_cmd=""
    if command -v python3 &>/dev/null; then py_cmd="python3"
    elif command -v python &>/dev/null; then py_cmd="python"; fi

    if [[ -n "$py_cmd" ]]; then
        local out ver ok="false"
        out="$($py_cmd --version 2>&1 || echo "")"
        ver="$(echo "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")"
        if version_gte "$ver" "$min_ver"; then ok="true"; fi
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":$ok}"
    else
        echo "{\"found\":false,\"ok\":false}"
    fi
}

check_juce() {
    local path="./_tools/JUCE"
    local header="$path/modules/juce_core/system/juce_StandardHeader.h"
    local core="$path/modules/juce_core/juce_core.h"
    if [[ ! -f "$core" ]]; then
        echo "{\"found\":false,\"path\":\"$path\",\"ok\":false}"
        return
    fi
    local major=0
    if [[ -f "$header" ]]; then
        major="$(grep -E 'JUCE_MAJOR_VERSION' "$header" | head -1 | grep -oE '[0-9]+' | head -1 || echo 0)"
    fi
    local ok="false"
    if [[ "$major" -ge 9 ]]; then ok="true"; fi
    echo "{\"found\":true,\"path\":\"$path\",\"major\":$major,\"ok\":$ok,\"required_major\":9}"
}

check_webkit() {
    if [[ "$(detect_os)" != "linux" ]]; then
        echo "{\"found\":false,\"ok\":true,\"skipped\":true}"
        return
    fi
    if pkg-config --exists webkit2gtk-4.1 2>/dev/null || pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
        echo "{\"found\":true,\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false,\"hint\":\"Install webkit2gtk development packages\"}"
    fi
}

check_egl() {
    if [[ "$(detect_os)" != "linux" ]]; then
        echo "{\"found\":false,\"ok\":true,\"skipped\":true}"
        return
    fi
    if pkg-config --exists egl 2>/dev/null || [[ -f /usr/include/EGL/egl.h ]]; then
        echo "{\"found\":true,\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false,\"hint\":\"Install libegl-dev (Debian/Ubuntu) or mesa-libEGL-devel\"}"
    fi
}

check_jq() {
    if command -v jq &>/dev/null; then
        local ver
        ver="$(jq --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' || echo "unknown")"
        echo "{\"found\":true,\"version\":\"$ver\",\"ok\":true}"
    else
        echo "{\"found\":false,\"ok\":false,\"hint\":\"brew install jq / apt install jq\"}"
    fi
}

check_config() {
    local has_local=false has_example=false completed=false
    [[ -f "./apc.config.json" ]] && has_local=true
    [[ -f "./apc.config.example.json" ]] && has_example=true
    if $has_local && command -v jq &>/dev/null; then
        [[ "$(jq -r '.setup.completed // false' ./apc.config.json)" == "true" ]] && completed=true
    fi
    echo "{\"config_present\":$has_local,\"example_present\":$has_example,\"setup_completed\":$completed}"
}

check_all() {
    echo "{"
    echo "  \"platform\": $(check_platform),"
    echo "  \"git\": $(check_git),"
    echo "  \"node\": $(check_node),"
    echo "  \"xcode\": $(check_xcode),"
    echo "  \"compiler\": $(check_compiler),"
    echo "  \"cmake\": $(check_cmake),"
    echo "  \"python\": $(check_python),"
    echo "  \"juce\": $(check_juce),"
    echo "  \"webkit\": $(check_webkit),"
    echo "  \"egl\": $(check_egl),"
    echo "  \"jq\": $(check_jq),"
    echo "  \"apc_config\": $(check_config)"
    echo "}"
}

print_human() {
    local os
    os="$(detect_os)"
    echo ""
    echo "APC System Check ($os)"
    echo "---------------------"
    local json
    json="$(check_all)"
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r '
          to_entries[]
          | select(.key != "platform" and .key != "apc_config")
          | "  " + (if (.value.ok == true or .value.skipped == true) then "[OK]" else "[!!]" end) + "  " + .key
        '
        local done
        done="$(echo "$json" | jq -r '.apc_config.setup_completed')"
        if [[ "$done" == "true" ]]; then
            echo "  [OK]  apc.config.json setup completed"
        else
            echo "  [--]  Run /apc-setup to create apc.config.json"
        fi
    else
        echo "$json"
    fi
    echo ""
}

if $HUMAN; then
    print_human
else
    check_all
fi
