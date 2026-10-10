#!/usr/bin/env bash
# ClapValidator integration for APC (macOS/Linux twin of
# clap-validator-integration.ps1). Source this file, then call
# test_with_clap_validator <clap-path> <plugin-name> [validator-binary].
# Returns 0 on pass, 1 on fail, 2 when the validator is unavailable (skipped).

test_with_clap_validator() {
    local plugin_path="$1"
    local plugin_name="$2"
    local validator="${3:-}"

    echo "Running clap-validator tests..."

    if [[ -z "$validator" ]]; then
        local root
        root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
        local candidates=(
            "$root/_tools/clap-validator-bin/clap-validator"
            "$root/_tools/clap-validator/clap-validator"
            "$root/_tools/clap-validator/target/release/clap-validator"
        )
        for c in "${candidates[@]}"; do
            [[ -x "$c" ]] && validator="$c" && break
        done
        if [[ -z "$validator" ]] && command -v clap-validator &>/dev/null; then
            validator="clap-validator"
        fi
    fi

    if [[ -z "$validator" ]]; then
        echo "WARNING: clap-validator not found - skipping (cargo install clap-validator or Install-ClapValidator)"
        return 2
    fi
    if [[ ! -e "$plugin_path" ]]; then
        echo "ERROR: CLAP plugin not found at $plugin_path" >&2
        return 1
    fi

    local output exit_code=0 start=$SECONDS
    output="$("$validator" validate --only-failed "$plugin_path" 2>&1)" || exit_code=$?
    local duration=$((SECONDS - start))

    local passed=false
    if [[ $exit_code -eq 0 ]] && ! grep -qiE '\bFAILED\b' <<<"$output"; then
        passed=true
    fi

    # Record result in status.json (best effort)
    if command -v jq &>/dev/null; then
        local status_json
        status_json="$(apc_plugin_path "$plugin_name" 2>/dev/null)/status.json"
        if [[ -f "$status_json" ]]; then
            local ts summary
            ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
            summary="$(grep -iE 'FAILED|error' <<<"$output" | head -10 | tr '\n' ';')"
            update_plugin_state "$(dirname "$status_json")" \
                "validation.clap_validator_results={\"passed\":$passed,\"duration_seconds\":$duration,\"output_summary\":\"${summary//\"/\\\"}\",\"last_run\":\"$ts\"}" \
                2>/dev/null || true
        fi
    fi

    if $passed; then
        echo "clap-validator tests PASSED!"
        return 0
    else
        echo "clap-validator tests FAILED!" >&2
        head -25 <<<"$output" >&2
        return 1
    fi
}
