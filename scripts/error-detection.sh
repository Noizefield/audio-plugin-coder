#!/usr/bin/env bash
# Error Detection and Handling Module for APC Build Process (macOS/Linux)
# Implements error detection and known issue matching.
# Source this file: . scripts/error-detection.sh

# --- HELPERS ---

_check_jq_error() {
    if ! command -v jq &>/dev/null; then
        echo "WARNING: jq is required for error detection. Install with: brew install jq" >&2
        return 1
    fi
}

# --- PATH RESOLUTION ---
_ERROR_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ERROR_REPO_ROOT="$(cd "$_ERROR_SCRIPT_DIR/.." && pwd)"

# --- ERROR PATTERNS ---

# CMake error patterns
CMAKE_PATTERNS=(
    "CMake Error"
    "Could not find"
    "Target.*already exists"
    "duplicate target"
    "undefined reference"
    "linking failed"
    "compilation failed"
)

# JUCE/WebView error patterns
JUCE_PATTERNS=(
    "WebView2.*not found"
    "juce_gui_extra.*not found"
    "JUCE_WEB_BROWSER.*undefined"
    "WebBrowserComponent.*error"
    "Canvas.*not supported"
)

# Clang/linker error patterns (macOS equivalents of MSVC patterns)
COMPILER_PATTERNS=(
    "error:.*"
    "fatal error:.*"
    "ld: error:"
    "Undefined symbols for architecture"
    "linker command failed"
    "clang: error:"
)

# --- FUNCTIONS ---

parse_build_errors() {
    # Parse build output for known error patterns
    # Usage: parse_build_errors "build output string"
    # Output: JSON array of {pattern, line, category}
    local output="$1"
    local errors="[]"

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue

        # Check CMake patterns
        for pattern in "${CMAKE_PATTERNS[@]}"; do
            if echo "$line" | grep -qE "$pattern"; then
                errors=$(echo "$errors" | jq --arg p "$pattern" --arg l "$line" --arg c "cmake" \
                    '. += [{"pattern": $p, "line": $l, "category": $c}]')
                break
            fi
        done

        # Check JUCE patterns
        for pattern in "${JUCE_PATTERNS[@]}"; do
            if echo "$line" | grep -qE "$pattern"; then
                errors=$(echo "$errors" | jq --arg p "$pattern" --arg l "$line" --arg c "webview" \
                    '. += [{"pattern": $p, "line": $l, "category": $c}]')
                break
            fi
        done

        # Check compiler patterns
        for pattern in "${COMPILER_PATTERNS[@]}"; do
            if echo "$line" | grep -qE "$pattern"; then
                errors=$(echo "$errors" | jq --arg p "$pattern" --arg l "$line" --arg c "build" \
                    '. += [{"pattern": $p, "line": $l, "category": $c}]')
                break
            fi
        done
    done <<< "$output"

    echo "$errors"
}

find_known_issue() {
    # Search known issues database for matching error
    # Usage: find_known_issue <errors_json>
    # Output: JSON object {id, title, solution, resolution_file} or empty string
    _check_jq_error || return 1
    local errors_json="$1"

    # Try multiple paths for known issues
    local known_issues_path=""
    local candidates=(
        "$_ERROR_REPO_ROOT/.claude/troubleshooting/known-issues.yaml"
        "$_ERROR_REPO_ROOT/.kilocode/troubleshooting/known-issues.yaml"
    )
    for path in "${candidates[@]}"; do
        if [[ -f "$path" ]]; then
            known_issues_path="$path"
            break
        fi
    done

    if [[ -z "$known_issues_path" ]]; then
        echo "WARNING: Known issues database not found" >&2
        return 1
    fi

    local yaml_content
    yaml_content="$(cat "$known_issues_path")"

    # Extract error lines from JSON
    local error_lines
    error_lines="$(echo "$errors_json" | jq -r '.[].line')"

    # Simple YAML pattern matching (no YAML parser needed)
    local current_id="" current_title="" current_resolution_file=""
    local in_patterns=false

    while IFS= read -r line; do
        # Detect issue ID
        if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*id:[[:space:]]*(.*) ]]; then
            current_id="${BASH_REMATCH[1]}"
            current_title=""
            current_resolution_file=""
            in_patterns=false
        fi

        # Detect title
        if [[ "$line" =~ ^[[:space:]]*title:[[:space:]]*(.*) ]]; then
            current_title="${BASH_REMATCH[1]}"
            current_title="${current_title//\"/}"  # strip quotes
        fi

        # Detect resolution file
        if [[ "$line" =~ ^[[:space:]]*resolution_file:[[:space:]]*(.*) ]]; then
            current_resolution_file="${BASH_REMATCH[1]}"
        fi

        # Enter error_patterns section
        if [[ "$line" =~ ^[[:space:]]*error_patterns: ]]; then
            in_patterns=true
            continue
        fi

        # Exit patterns section on next key
        if $in_patterns && [[ "$line" =~ ^[[:space:]]*[a-z_]+: ]] && [[ ! "$line" =~ ^[[:space:]]*- ]]; then
            in_patterns=false
        fi

        # Match patterns
        if $in_patterns && [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.*) ]]; then
            local pattern="${BASH_REMATCH[1]}"
            pattern="${pattern//\"/}"  # strip quotes

            # Check if any error line matches this pattern
            while IFS= read -r error_line; do
                if echo "$error_line" | grep -qF "$pattern"; then
                    # Found a match - read solution if available
                    local solution=""
                    if [[ -n "$current_resolution_file" ]]; then
                        local res_dir
                        res_dir="$(dirname "$known_issues_path")"
                        local res_path="$res_dir/$current_resolution_file"
                        if [[ -f "$res_path" ]]; then
                            solution="$(cat "$res_path")"
                        fi
                    fi

                    # Output match as JSON
                    jq -n --arg id "$current_id" \
                          --arg title "$current_title" \
                          --arg solution "$solution" \
                          --arg res_file "$current_resolution_file" \
                        '{id: $id, title: $title, solution: $solution, resolution_file: $res_file}'
                    return 0
                fi
            done <<< "$error_lines"
        fi
    done <<< "$yaml_content"

    # No match found
    return 1
}

new_issue_from_error() {
    # Auto-capture a new issue from build errors
    # Usage: new_issue_from_error <errors_json> <build_output>
    _check_jq_error || return 1
    local errors_json="$1"
    local build_output="$2"

    local category
    category="$(echo "$errors_json" | jq -r '.[0].category // "build"')"

    # Find known issues dir
    local issues_dir=""
    local candidates=(
        "$_ERROR_REPO_ROOT/.claude/troubleshooting"
        "$_ERROR_REPO_ROOT/.kilocode/troubleshooting"
    )
    for path in "${candidates[@]}"; do
        if [[ -d "$path" ]]; then
            issues_dir="$path"
            break
        fi
    done

    if [[ -z "$issues_dir" ]]; then
        echo "WARNING: Troubleshooting directory not found" >&2
        return 1
    fi

    # Generate issue ID
    local existing_count=0
    if [[ -d "$issues_dir/resolutions" ]]; then
        existing_count="$(ls "$issues_dir/resolutions/"*.md 2>/dev/null | wc -l | tr -d ' ')"
    fi
    local new_id="${category}-$(printf '%03d' $((existing_count + 1)))"

    # Get error summary
    local error_summary
    error_summary="$(echo "$errors_json" | jq -r '.[0].line // "Unknown error"' | head -c 100)"

    local today
    today="$(date +%Y-%m-%d)"

    # Build YAML entry
    local new_issue
    new_issue="- id: $new_id
  title: \"[Auto] $error_summary\"
  category: $category
  severity: high
  symptoms:"

    # Add first 5 error lines as symptoms
    local symptoms
    symptoms="$(echo "$errors_json" | jq -r '.[0:5][].line')"
    while IFS= read -r line; do
        [[ -n "$line" ]] && new_issue="$new_issue
    - \"$line\""
    done <<< "$symptoms"

    new_issue="$new_issue
  error_patterns:"

    # Add first 3 patterns
    local patterns
    patterns="$(echo "$errors_json" | jq -r '.[0:3][].pattern')"
    while IFS= read -r line; do
        [[ -n "$line" ]] && new_issue="$new_issue
    - \"$line\""
    done <<< "$patterns"

    new_issue="$new_issue
  resolution_status: investigating
  resolution_file: resolutions/$new_id.md
  frequency: 1
  last_occurred: $today
  attempts_before_resolution: 1"

    # Append to known-issues.yaml
    echo "" >> "$issues_dir/known-issues.yaml"
    echo "$new_issue" >> "$issues_dir/known-issues.yaml"

    # Create resolution document from template if available
    local template_path="$issues_dir/_template.md"
    if [[ -f "$template_path" ]]; then
        mkdir -p "$issues_dir/resolutions"
        local res_file="$issues_dir/resolutions/$new_id.md"
        sed -e "s/\[auto-generated-id\]/$new_id/g" \
            -e "s/\[Issue Title\]/[Auto] $error_summary/g" \
            -e "s/\[date\]/$(date '+%Y-%m-%d %H:%M')/g" \
            "$template_path" > "$res_file"
    fi

    echo "Issue logged as $new_id"
    echo "See: $issues_dir/resolutions/$new_id.md"
}
