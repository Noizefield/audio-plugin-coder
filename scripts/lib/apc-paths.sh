#!/usr/bin/env bash
# Resolve APC paths from apc.config.json (plugins / build / release).
# Usage: source scripts/lib/apc-paths.sh

apc_repo_root() {
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$here/../../CMakeLists.txt" ]]; then
        cd "$here/../.." && pwd
    elif [[ -f "$here/../CMakeLists.txt" ]]; then
        cd "$here/.." && pwd
    else
        pwd
    fi
}

apc_resolve_path() {
    local value="$1"
    local root="$2"
    if [[ "$value" = /* ]] || [[ "$value" =~ ^[A-Za-z]:[\\/] ]]; then
        # Absolute (Unix or Windows-style)
        printf '%s\n' "$value"
    else
        printf '%s\n' "$root/$value"
    fi
}

apc_read_config_field() {
    # apc_read_config_field <repo_root> <jq_path> <default>
    local root="$1"
    local jq_path="$2"
    local default="$3"
    local cfg="$root/apc.config.json"
    local example="$root/apc.config.example.json"
    local file=""

    if [[ -f "$cfg" ]]; then
        file="$cfg"
    elif [[ -f "$example" ]]; then
        file="$example"
    else
        printf '%s\n' "$default"
        return 0
    fi

    if command -v jq &>/dev/null; then
        local val
        val="$(jq -r "$jq_path // empty" "$file" 2>/dev/null || true)"
        if [[ -n "$val" && "$val" != "null" ]]; then
            printf '%s\n' "$val"
            return 0
        fi
    else
        # Minimal fallback without jq for common path keys
        case "$jq_path" in
            .paths.plugins_dir)
                grep -oE '"plugins_dir"[[:space:]]*:[[:space:]]*"[^"]+"' "$file" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || printf '%s\n' "$default"
                return 0
                ;;
            .paths.build_dir)
                grep -oE '"build_dir"[[:space:]]*:[[:space:]]*"[^"]+"' "$file" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || printf '%s\n' "$default"
                return 0
                ;;
            .paths.release_dir)
                grep -oE '"release_dir"[[:space:]]*:[[:space:]]*"[^"]+"' "$file" | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || printf '%s\n' "$default"
                return 0
                ;;
        esac
    fi
    printf '%s\n' "$default"
}

apc_load_paths() {
    # Sets: APC_REPO_ROOT APC_PLUGINS_DIR APC_BUILD_DIR APC_RELEASE_DIR
    APC_REPO_ROOT="$(apc_repo_root)"
    local plugins_rel build_rel release_rel
    plugins_rel="$(apc_read_config_field "$APC_REPO_ROOT" ".paths.plugins_dir" "plugins")"
    build_rel="$(apc_read_config_field "$APC_REPO_ROOT" ".paths.build_dir" "build")"
    release_rel="$(apc_read_config_field "$APC_REPO_ROOT" ".paths.release_dir" "release")"
    APC_PLUGINS_DIR="$(apc_resolve_path "$plugins_rel" "$APC_REPO_ROOT")"
    APC_BUILD_DIR="$(apc_resolve_path "$build_rel" "$APC_REPO_ROOT")"
    APC_RELEASE_DIR="$(apc_resolve_path "$release_rel" "$APC_REPO_ROOT")"
    export APC_REPO_ROOT APC_PLUGINS_DIR APC_BUILD_DIR APC_RELEASE_DIR
}

apc_plugin_path() {
    local name="$1"
    if [[ -z "${APC_PLUGINS_DIR:-}" ]]; then
        apc_load_paths
    fi
    printf '%s\n' "$APC_PLUGINS_DIR/$name"
}

apc_setup_completed() {
    local root
    root="$(apc_repo_root)"
    local cfg="$root/apc.config.json"
    if [[ ! -f "$cfg" ]]; then
        return 1
    fi
    if command -v jq &>/dev/null; then
        [[ "$(jq -r '.setup.completed // false' "$cfg")" == "true" ]]
    else
        grep -q '"completed"[[:space:]]*:[[:space:]]*true' "$cfg"
    fi
}

apc_model_for_phase() {
    local phase="$1"
    local root
    root="$(apc_repo_root)"
    local cfg="$root/apc.config.json"
    [[ -f "$cfg" ]] || cfg="$root/apc.config.example.json"
    [[ -f "$cfg" ]] || return 0
    if command -v jq &>/dev/null; then
        jq -c --arg p "$phase" '.models.phases[$p] // empty' "$cfg" 2>/dev/null || true
    fi
}
