#!/usr/bin/env bash
# APC State Management Module (macOS/Linux)
# Provides standardized state management for APC plugin development workflow.
# Source this file: . scripts/state-management.sh

set -euo pipefail

# --- PATH RESOLUTION ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- SCHEMA CONSTANTS ---
STATE_PHASES=("ideation" "plan" "design" "code" "ship" "complete")
STATE_FRAMEWORKS=("visage" "webview" "pending")
STATE_REQUIRED_FIELDS=("plugin_name" "version" "current_phase" "ui_framework" "complexity_score" "created_at" "last_modified" "phase_history" "validation" "framework_selection" "error_recovery")
STATE_VALIDATION_FIELDS=("creative_brief_exists" "parameter_spec_exists" "architecture_defined" "ui_framework_selected" "design_complete" "code_complete" "tests_passed" "ship_ready")

# --- HELPERS ---

_check_jq() {
    if ! command -v jq &>/dev/null; then
        echo "ERROR: jq is required for state management. Install with: brew install jq" >&2
        return 1
    fi
}

_iso_date() {
    date -u +"%Y-%m-%dT%H:%M:%SZ"
}

_array_contains() {
    local needle="$1"; shift
    for item in "$@"; do
        [[ "$item" == "$needle" ]] && return 0
    done
    return 1
}

_phase_index() {
    local phase="$1"
    for i in "${!STATE_PHASES[@]}"; do
        [[ "${STATE_PHASES[$i]}" == "$phase" ]] && echo "$i" && return 0
    done
    echo "-1"
}

# --- FUNCTIONS ---

new_plugin_state() {
    # Initialize a new plugin state from template
    # Usage: new_plugin_state <PluginName> <PluginPath>
    _check_jq || return 1
    local plugin_name="$1"
    local plugin_path="$2"

    # Try multiple locations for the template
    local template_path=""
    local candidates=(
        "$REPO_ROOT/.kilocode/templates/status-template.json"
        "$REPO_ROOT/templates/status-template.json"
        "$SCRIPT_DIR/../templates/status-template.json"
    )
    for path in "${candidates[@]}"; do
        if [[ -f "$path" ]]; then
            template_path="$path"
            break
        fi
    done

    if [[ -z "$template_path" ]]; then
        echo "WARNING: Status template not found." >&2
        return 1
    fi

    local now
    now="$(_iso_date)"
    local status_path="$plugin_path/status.json"

    jq --arg name "$plugin_name" --arg now "$now" \
        '.plugin_name = $name | .created_at = $now | .last_modified = $now' \
        "$template_path" > "$status_path"

    echo "Initialized state for $plugin_name"
}

get_plugin_state() {
    # Read and return plugin state JSON
    # Usage: get_plugin_state <PluginPath>
    _check_jq || return 1
    local plugin_path="$1"
    local status_path="$plugin_path/status.json"

    if [[ ! -f "$status_path" ]]; then
        return 1
    fi

    cat "$status_path"
}

get_state_field() {
    # Get a specific field from state using jq query
    # Usage: get_state_field <PluginPath> <jq_query>
    # Example: get_state_field "plugins/MyPlugin" ".ui_framework"
    _check_jq || return 1
    local plugin_path="$1"
    local query="$2"
    local status_path="$plugin_path/status.json"

    if [[ ! -f "$status_path" ]]; then
        return 1
    fi

    jq -r "$query" "$status_path"
}

update_plugin_state() {
    # Update plugin state with key=value pairs, optional phase and framework
    # Usage: update_plugin_state <PluginPath> [--phase <phase>] [--framework <framework>] [key=value ...]
    _check_jq || return 1
    local plugin_path="$1"; shift
    local status_path="$plugin_path/status.json"
    local phase=""
    local framework=""
    local -a updates=()

    if [[ ! -f "$status_path" ]]; then
        echo "WARNING: Status file not found at $status_path" >&2
        return 1
    fi

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --phase)   phase="$2"; shift 2 ;;
            --framework) framework="$2"; shift 2 ;;
            *=*)       updates+=("$1"); shift ;;
            *)         shift ;;
        esac
    done

    local jq_filter="."
    local now
    now="$(_iso_date)"

    # Apply key=value updates (supports dot notation like "validation.build_completed=true")
    for update in "${updates[@]}"; do
        local key="${update%%=*}"
        local value="${update#*=}"

        # Convert dot notation to jq path
        local jq_path
        jq_path="$(echo "$key" | sed 's/\./"."/g')"
        jq_path=".\"$jq_path\""

        # Detect value type
        if [[ "$value" == "true" || "$value" == "false" ]]; then
            jq_filter="$jq_filter | $jq_path = $value"
        elif [[ "$value" =~ ^[0-9]+$ ]]; then
            jq_filter="$jq_filter | $jq_path = $value"
        elif [[ "$value" == "null" ]]; then
            jq_filter="$jq_filter | $jq_path = null"
        else
            jq_filter="$jq_filter | $jq_path = \"$value\""
        fi
    done

    # Update phase if specified
    if [[ -n "$phase" ]]; then
        if ! _array_contains "$phase" "${STATE_PHASES[@]}"; then
            echo "WARNING: Invalid phase: $phase" >&2
            return 1
        fi
        local fw_selected
        fw_selected="${framework:-$(jq -r '.ui_framework' "$status_path")}"
        jq_filter="$jq_filter | .current_phase = \"$phase\" | .last_modified = \"$now\""
        jq_filter="$jq_filter | .phase_history += [{\"phase\": \"$phase\", \"completed_at\": \"$now\", \"framework_selected\": \"$fw_selected\"}]"
    fi

    # Update framework if specified
    if [[ -n "$framework" ]]; then
        if ! _array_contains "$framework" "${STATE_FRAMEWORKS[@]}"; then
            echo "WARNING: Invalid framework: $framework" >&2
            return 1
        fi
        jq_filter="$jq_filter | .ui_framework = \"$framework\" | .framework_selection.decision = \"$framework\" | .last_modified = \"$now\""
    fi

    # Apply updates
    local tmp_file="${status_path}.tmp"
    if jq "$jq_filter" "$status_path" > "$tmp_file"; then
        # Validate before saving
        if test_state_schema "$tmp_file"; then
            mv "$tmp_file" "$status_path"
            echo "Updated state${phase:+: $phase}${framework:+ ($framework)}"
            return 0
        else
            rm -f "$tmp_file"
            echo "WARNING: State validation failed during update." >&2
            return 1
        fi
    else
        rm -f "$tmp_file"
        echo "WARNING: jq filter failed." >&2
        return 1
    fi
}

test_plugin_state() {
    # Validate plugin state prerequisites
    # Usage: test_plugin_state <PluginPath> [--required-phase <phase>] [--required-files <file1> <file2> ...]
    _check_jq || return 1
    local plugin_path="$1"; shift
    local required_phase=""
    local -a required_files=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --required-phase) required_phase="$2"; shift 2 ;;
            --required-files) shift; while [[ $# -gt 0 && "$1" != --* ]]; do required_files+=("$1"); shift; done ;;
            *) shift ;;
        esac
    done

    local status_path="$plugin_path/status.json"
    if [[ ! -f "$status_path" ]]; then
        echo "WARNING: Status file not found" >&2
        return 1
    fi

    # Schema validation
    if ! test_state_schema "$status_path"; then
        echo "WARNING: State schema validation failed" >&2
        return 1
    fi

    # Phase prerequisite check
    if [[ -n "$required_phase" ]]; then
        local current_phase
        current_phase="$(jq -r '.current_phase' "$status_path")"
        local required_idx current_idx
        required_idx="$(_phase_index "$required_phase")"
        current_idx="$(_phase_index "$current_phase")"

        if (( current_idx < required_idx )); then
            echo "WARNING: Cannot proceed: Current phase '$current_phase' must complete '$required_phase' first" >&2
            return 1
        fi
    fi

    # Required files check
    for file in "${required_files[@]}"; do
        if [[ ! -f "$plugin_path/$file" ]]; then
            echo "WARNING: Required file missing: $file" >&2
            return 1
        fi
    done

    return 0
}

test_state_schema() {
    # Validate state JSON against schema
    # Usage: test_state_schema <status.json path>
    _check_jq || return 1
    local file="$1"

    if [[ ! -f "$file" ]]; then
        return 1
    fi

    # Check required fields exist
    for field in "${STATE_REQUIRED_FIELDS[@]}"; do
        if ! jq -e "has(\"$field\")" "$file" &>/dev/null; then
            echo "WARNING: Missing required field: $field" >&2
            return 1
        fi
    done

    # Check phase validity
    local phase
    phase="$(jq -r '.current_phase' "$file")"
    if ! _array_contains "$phase" "${STATE_PHASES[@]}"; then
        echo "WARNING: Invalid phase: $phase" >&2
        return 1
    fi

    # Check framework validity
    local fw
    fw="$(jq -r '.ui_framework' "$file")"
    if ! _array_contains "$fw" "${STATE_FRAMEWORKS[@]}"; then
        echo "WARNING: Invalid framework: $fw" >&2
        return 1
    fi

    # Check validation fields
    for field in "${STATE_VALIDATION_FIELDS[@]}"; do
        if ! jq -e ".validation | has(\"$field\")" "$file" &>/dev/null; then
            echo "WARNING: Missing validation field: $field" >&2
            return 1
        fi
    done

    return 0
}

backup_plugin_state() {
    # Create a backup of status.json
    # Usage: backup_plugin_state <PluginPath>
    _check_jq || return 1
    local plugin_path="$1"
    local status_path="$plugin_path/status.json"

    if [[ ! -f "$status_path" ]]; then
        return 1
    fi

    local backup_dir="$plugin_path/_state_backups"
    mkdir -p "$backup_dir"

    local timestamp
    timestamp="$(date +%Y%m%d_%H%M%S)"
    local backup_file="$backup_dir/status_backup_${timestamp}.json"

    cp "$status_path" "$backup_file"
    echo "State backed up to $backup_file"

    # Update error recovery info in current state
    local tmp_file="${status_path}.tmp"
    jq --arg bf "$backup_file" \
        '.error_recovery.last_backup = $bf | .error_recovery.rollback_available = true' \
        "$status_path" > "$tmp_file" && mv "$tmp_file" "$status_path"

    echo "$backup_file"
}

restore_plugin_state() {
    # Restore status.json from a backup
    # Usage: restore_plugin_state <PluginPath> [backup_file]
    _check_jq || return 1
    local plugin_path="$1"
    local backup_file="${2:-}"
    local status_path="$plugin_path/status.json"
    local backup_dir="$plugin_path/_state_backups"

    if [[ ! -d "$backup_dir" ]]; then
        echo "WARNING: No backup directory found" >&2
        return 1
    fi

    if [[ -n "$backup_file" && -f "$backup_file" ]]; then
        local source="$backup_file"
    else
        # Get latest backup
        local source
        source="$(ls -t "$backup_dir"/status_backup_*.json 2>/dev/null | head -1)"
        if [[ -z "$source" ]]; then
            echo "WARNING: No backup files found" >&2
            return 1
        fi
    fi

    echo "Restoring state from $source"
    cp "$source" "$status_path"

    # Update error recovery info
    local now
    now="$(_iso_date)"
    local tmp_file="${status_path}.tmp"
    jq --arg msg "Rollback performed from $source at $now" \
        '.error_recovery.rollback_available = false | .error_recovery.error_log += [$msg]' \
        "$status_path" > "$tmp_file" && mv "$tmp_file" "$status_path"

    echo "State restored"
}

add_state_error() {
    # Append an error message to error_recovery.error_log
    # Usage: add_state_error <PluginPath> <ErrorMessage>
    _check_jq || return 1
    local plugin_path="$1"
    local error_message="$2"
    local status_path="$plugin_path/status.json"

    if [[ ! -f "$status_path" ]]; then
        return 1
    fi

    local now
    now="$(_iso_date)"
    local tmp_file="${status_path}.tmp"
    jq --arg msg "$now: $error_message" \
        '.error_recovery.error_log += [$msg]' \
        "$status_path" > "$tmp_file" && mv "$tmp_file" "$status_path"
}

set_plugin_framework() {
    # Set the UI framework for a plugin
    # Usage: set_plugin_framework <PluginPath> <visage|webview> <Rationale>
    _check_jq || return 1
    local plugin_path="$1"
    local framework="$2"
    local rationale="$3"

    if [[ "$framework" != "visage" && "$framework" != "webview" ]]; then
        echo "ERROR: Framework must be 'visage' or 'webview'" >&2
        return 1
    fi

    update_plugin_state "$plugin_path" \
        --framework "$framework" \
        "framework_selection.rationale=$rationale" \
        "framework_selection.implementation_strategy=single-pass"
}
