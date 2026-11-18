#!/usr/bin/env bash
# sign-macos.sh - Developer ID codesign + notarize + staple + spctl verify (APC release flow).
#
# Usage:
#   scripts/installer/sign-macos.sh [--dry-run] [--no-notarize] [--require] <path>...
#
# <path> may be a plugin bundle (.vst3 .component .clap), an .app, a .dmg or a .pkg.
#
# All configuration comes from environment variables; nothing is hardcoded and secrets
# are masked in --dry-run output. With no configuration the script SKIPS (exit 0, nothing
# signed) with a clear message; --require turns a skip into a failure.
#
#   APC_SIGN_IDENTITY            "Developer ID Application: Name (TEAMID)"  (bundles, .app, .dmg)
#   APC_SIGN_INSTALLER_IDENTITY  "Developer ID Installer: Name (TEAMID)"    (.pkg only, productsign)
#   APC_ENTITLEMENTS             optional entitlements .plist
#   Notarization - ONE of:
#     APC_NOTARY_PROFILE         keychain profile from `xcrun notarytool store-credentials`
#     APC_NOTARY_APPLE_ID + APC_NOTARY_TEAM_ID + APC_NOTARY_PASSWORD   (app-specific password)
#   (Notarization is skipped, with a message, if neither is set; --no-notarize also skips it.)
#
# REAL SIGNING / NOTARIZATION WAS NOT EXERCISED when this script was written (no Apple
# Developer account, no macOS host). Only `bash -n` and --dry-run output were checked.
# Stapling a bare plugin bundle is UNVERIFIED; the dependable route is to notarize and
# staple the .pkg / .dmg that wraps the plugins.
#
# Exit: 0 ok or skipped, 1 failure (or skip with --require), 2 usage.

set -euo pipefail

DRY=0; NO_NOTARIZE=0; REQUIRE=0
PATHS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --no-notarize) NO_NOTARIZE=1 ;;
    --require) REQUIRE=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "sign-macos: unknown option $1" >&2; exit 2 ;;
    *) PATHS+=("$1") ;;
  esac
  shift
done
[[ ${#PATHS[@]} -gt 0 ]] || { echo "sign-macos: no <path> given (see --help)" >&2; exit 2; }

skip() {
  echo "SKIPPED (artifacts NOT signed): $1"
  if [[ $REQUIRE -eq 1 ]]; then echo "ERROR: --require was given, so a skipped signing step is a failure." >&2; exit 1; fi
  exit 0
}

# quote args for display; MASK:<value> entries are printed as ********
show() {
  local out="" a
  for a in "$@"; do
    if [[ "$a" == MASK:* ]]; then a="********"; fi
    case "$a" in *[[:space:]]*) a="\"$a\"" ;; esac
    out+="$a "
  done
  echo "${out% }"
}

# run a command; MASK:<v> args are masked in the echo but passed unmasked
run() {
  if [[ $DRY -eq 1 ]]; then echo "[dry-run] $(show "$@")"; return 0; fi
  echo "> $(show "$@")"
  local real=() a
  for a in "$@"; do real+=("${a#MASK:}"); done
  "${real[@]}"
}

IDENTITY="${APC_SIGN_IDENTITY:-}"
INSTALLER_IDENTITY="${APC_SIGN_INSTALLER_IDENTITY:-}"
ENTITLEMENTS="${APC_ENTITLEMENTS:-}"

NEEDS_APP_ID=0; NEEDS_PKG_ID=0
for p in "${PATHS[@]}"; do
  case "$p" in
    *.pkg) NEEDS_PKG_ID=1 ;;
    *) NEEDS_APP_ID=1 ;;
  esac
done
[[ $NEEDS_APP_ID -eq 1 && -z "$IDENTITY" ]] && skip "APC_SIGN_IDENTITY is not set (e.g. \"Developer ID Application: Name (TEAMID)\")."
[[ $NEEDS_PKG_ID -eq 1 && -z "$INSTALLER_IDENTITY" ]] && skip "APC_SIGN_INSTALLER_IDENTITY is not set (needed to sign .pkg with productsign)."

if [[ $DRY -eq 0 ]]; then
  [[ "$(uname -s)" == "Darwin" ]] || skip "not running on macOS (codesign/notarytool/stapler/spctl are macOS-only); use --dry-run to preview."
  for tool in codesign xcrun ditto spctl; do command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: $tool not found" >&2; exit 1; }; done
  for p in "${PATHS[@]}"; do [[ -e "$p" ]] || { echo "ERROR: not found: $p" >&2; exit 1; }; done
fi

# notarization credentials -> argument list
NOTARY_ARGS=(); NOTARY_NOTE=""
if [[ -n "${APC_NOTARY_PROFILE:-}" ]]; then
  NOTARY_ARGS=(--keychain-profile "$APC_NOTARY_PROFILE")
elif [[ -n "${APC_NOTARY_APPLE_ID:-}" && -n "${APC_NOTARY_TEAM_ID:-}" && -n "${APC_NOTARY_PASSWORD:-}" ]]; then
  NOTARY_ARGS=(--apple-id "$APC_NOTARY_APPLE_ID" --team-id "$APC_NOTARY_TEAM_ID" --password "MASK:$APC_NOTARY_PASSWORD")
else
  NOTARY_NOTE="no notarization credentials (set APC_NOTARY_PROFILE, or APC_NOTARY_APPLE_ID + APC_NOTARY_TEAM_ID + APC_NOTARY_PASSWORD)"
fi
if [[ $NO_NOTARIZE -eq 1 ]]; then NOTARY_NOTE="--no-notarize given"; fi
if [[ -n "$NOTARY_NOTE" ]]; then echo "NOTE: notarization will be skipped: $NOTARY_NOTE"; fi

TMP=""
cleanup() { [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"; return 0; }
trap cleanup EXIT
if [[ $DRY -eq 1 ]]; then TMP="${TMPDIR:-/tmp}/apc-notarize.XXXXXX"; else TMP="$(mktemp -d)"; fi

sign_bundle() {
  local b="$1"
  # inside-out: nested dylibs / frameworks first, then the bundle itself
  if [[ -d "$b/Contents" ]]; then
    while IFS= read -r nested; do
      run codesign --force --options runtime --timestamp --sign "$IDENTITY" "$nested"
    done < <(find "$b/Contents" \( -name '*.dylib' -o -name '*.so' -o -name '*.framework' \) 2>/dev/null | sort)
  fi
  local args=(codesign --force --options runtime --timestamp --sign "$IDENTITY")
  [[ -n "$ENTITLEMENTS" ]] && args+=(--entitlements "$ENTITLEMENTS")
  run "${args[@]}" "$b"
  run codesign --verify --deep --strict --verbose=2 "$b"
}

notarize() {
  local item="$1" upload="$1"
  [[ -n "$NOTARY_NOTE" ]] && return 0
  case "$item" in
    *.dmg|*.pkg) ;;
    *) upload="$TMP/$(basename "$item").zip"; run ditto -c -k --keepParent "$item" "$upload" ;;
  esac
  run xcrun notarytool submit "$upload" "${NOTARY_ARGS[@]}" --wait
  run xcrun stapler staple "$item"
  run xcrun stapler validate "$item"
}

assess() {
  local item="$1"
  case "$item" in
    *.pkg) run spctl --assess --type install -vv "$item" ;;
    *.dmg) run spctl --assess --type open --context context:primary-signature -vv "$item" ;;
    *)     run spctl --assess --type execute -vv "$item" ;;
  esac
}

for item in "${PATHS[@]}"; do
  echo "== $item"
  case "$item" in
    *.pkg)
      signed="${item%.pkg}-signed.pkg"
      run productsign --sign "$INSTALLER_IDENTITY" --timestamp "$item" "$signed"
      [[ $DRY -eq 1 ]] || mv -f "$signed" "$item"
      ;;
    *.dmg)
      run codesign --force --timestamp --sign "$IDENTITY" "$item"
      run codesign --verify --verbose=2 "$item"
      ;;
    *)
      sign_bundle "$item"
      ;;
  esac
  notarize "$item"
  assess "$item"
done

[[ $DRY -eq 1 ]] && echo "DRY RUN complete - nothing was signed." || echo "Done: ${#PATHS[@]} item(s) processed."
