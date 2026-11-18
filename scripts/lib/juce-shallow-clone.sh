#!/usr/bin/env bash
# juce-shallow-clone.sh -- idempotent shallow fetch of the pinned JUCE tag.
#
# Building block for `apc doctor --fix` and for checkouts that have no git
# history (npx / zip installs) or whose submodule init failed. Fetches exactly
# one tag at depth 1 (~10x smaller than a full clone) into _tools/JUCE.
#
# Usage:
#   scripts/lib/juce-shallow-clone.sh [--tag 9.0.1] [--dest DIR] [--repo URL] [--force] [--quiet]
#
# Defaults:
#   --tag   juce.pin from apc.config.json, else apc.config.example.json
#   --dest  <repo root>/_tools/JUCE
#   --repo  https://github.com/juce-framework/JUCE.git
#
# Idempotent: if DEST already holds the requested tag the script only verifies
# it and exits 0. A non-empty DEST at a different version is never overwritten
# unless --force (which fetches the tag into the existing git checkout; nothing
# is deleted).
#
# Exit codes: 0 ok (already present or cloned+verified) - 1 failed - 2 usage.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG=""
DEST="$ROOT/_tools/JUCE"
REPO="https://github.com/juce-framework/JUCE.git"
FORCE=0
QUIET=0

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
fail() { printf 'juce-shallow-clone: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-2}"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --tag)   [ $# -ge 2 ] || usage; TAG="$2"; shift 2 ;;
        --dest)  [ $# -ge 2 ] || usage; DEST="$2"; shift 2 ;;
        --repo)  [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --quiet) QUIET=1; shift ;;
        -h|--help) usage 0 ;;
        *) printf 'unknown argument: %s\n' "$1" >&2; usage ;;
    esac
done

command -v git >/dev/null 2>&1 || fail "git is not installed"

# --- resolve the pin ---------------------------------------------------------
read_pin() {
    # prints juce.pin from a config file, or nothing. No jq/node dependency.
    local file="$1"
    [ -f "$file" ] || return 0
    tr -d '\r\n' < "$file" | sed -n 's/.*"juce"[[:space:]]*:[[:space:]]*{[^}]*"pin"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}
if [ -z "$TAG" ]; then
    TAG="$(read_pin "$ROOT/apc.config.json")"
    [ -n "$TAG" ] || TAG="$(read_pin "$ROOT/apc.config.example.json")"
    [ -n "$TAG" ] || fail "no juce.pin found in apc.config.json / apc.config.example.json; pass --tag"
fi
case "$TAG" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "tag '$TAG' does not look like a JUCE release tag (expected MAJOR.MINOR.PATCH, e.g. 9.0.1)" ;;
esac

# --- verification ------------------------------------------------------------
header_version() {
    local h="$DEST/modules/juce_core/system/juce_StandardHeader.h"
    [ -f "$h" ] || return 0
    local maj min pat
    maj="$(sed -n 's/^#define[[:space:]]*JUCE_MAJOR_VERSION[[:space:]]*\([0-9]*\).*/\1/p' "$h" | head -n1)"
    min="$(sed -n 's/^#define[[:space:]]*JUCE_MINOR_VERSION[[:space:]]*\([0-9]*\).*/\1/p' "$h" | head -n1)"
    pat="$(sed -n 's/^#define[[:space:]]*JUCE_BUILDNUMBER[[:space:]]*\([0-9]*\).*/\1/p' "$h" | head -n1)"
    [ -n "$maj" ] && [ -n "$min" ] && [ -n "$pat" ] && printf '%s.%s.%s' "$maj" "$min" "$pat"
}

verify() {
    # returns 0 when DEST is JUCE at exactly $TAG; prints the reason otherwise
    [ -f "$DEST/CMakeLists.txt" ] || { echo "no CMakeLists.txt in $DEST"; return 1; }
    if git -C "$DEST" rev-parse --git-dir >/dev/null 2>&1; then
        local actual
        actual="$(git -C "$DEST" describe --tags --exact-match HEAD 2>/dev/null || true)"
        [ "$actual" = "$TAG" ] || { echo "checkout is at '${actual:-no exact tag}', wanted '$TAG'"; return 1; }
    fi
    local hv
    hv="$(header_version || true)"
    if [ -n "$hv" ] && [ "$hv" != "$TAG" ]; then
        echo "juce_StandardHeader.h reports $hv, wanted $TAG"; return 1
    fi
    return 0
}

if [ -d "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
    if reason="$(verify)"; then
        say "JUCE $TAG already present at $DEST"
        exit 0
    fi
    if [ "$FORCE" != 1 ]; then
        fail "$DEST exists but is not JUCE $TAG ($reason). Re-run with --force to fetch the tag into the existing checkout (nothing is deleted)."
    fi
    git -C "$DEST" rev-parse --git-dir >/dev/null 2>&1 || fail "$DEST is not a git checkout; move it away or choose --dest"
    say "fetching JUCE $TAG into existing checkout $DEST (depth 1)"
    git -C "$DEST" fetch --depth 1 "$REPO" "refs/tags/$TAG:refs/tags/$TAG" || fail "could not fetch tag $TAG from $REPO"
    git -C "$DEST" checkout --quiet --detach "refs/tags/$TAG" || fail "could not check out $TAG"
else
    say "cloning JUCE $TAG (depth 1) into $DEST"
    mkdir -p "$(dirname "$DEST")"
    git clone --quiet --depth 1 --branch "$TAG" "$REPO" "$DEST" || fail "git clone of tag $TAG from $REPO failed (wrong tag? offline?)"
fi

if reason="$(verify)"; then
    say "JUCE $TAG ready at $DEST"
    exit 0
fi
fail "verification failed after fetch: $reason"
