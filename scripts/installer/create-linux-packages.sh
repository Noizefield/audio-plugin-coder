#!/usr/bin/env bash
# create-linux-packages.sh - build DEB and/or RPM packages for a plugin (APC release flow).
#
# Usage:
#   scripts/installer/create-linux-packages.sh <PluginName> --version X.Y.Z
#       [--format deb|rpm|both] [--vst3 PATH] [--clap PATH] [--out DIR]
#       [--maintainer "Name <mail>"] [--description TEXT] [--url URL] [--license ID]
#       [--arch amd64|arm64|...] [--dry-run] [--require]
#
# Installs (system-wide, per the VST3 / CLAP specs):
#   <Name>.vst3  ->  /usr/lib/vst3/<Name>.vst3
#   <Name>.clap  ->  /usr/lib/clap/<Name>.clap      (only if a .clap artifact exists)
#
# Artifact discovery (override with --vst3 / --clap): paths from
#   scripts/lib/apc-paths.sh (apc_load_paths -> APC_BUILD_DIR / APC_RELEASE_DIR), else ./build:
#   <build>/plugins/<Name>/<Name>_artefacts/Release/{VST3,CLAP}/<Name>.{vst3,clap}
# Output goes to --out (default: paths.release_dir, else ./release).
#
# Environment (all optional): APC_PKG_MAINTAINER, APC_PKG_URL, APC_PKG_LICENSE, APC_PKG_DESCRIPTION.
#
# --dry-run prints the generated DEBIAN/control, the RPM spec and the exact commands, and
# executes nothing (no dpkg-deb / rpmbuild required, artifacts need not exist).
# Without --dry-run a missing dpkg-deb / rpmbuild skips that format with a message
# (exit 0, or 1 with --require). Missing build artifacts are an error.
#
# NOT EXERCISED on a real Linux host when this script was written - only `bash -n` and
# --dry-run output were checked. Packages are unsigned; sign with `dpkg-sig`/`rpmsign`
# or publish through a signed repository.
#
# Exit: 0 ok or skipped, 1 failure, 2 usage.

set -euo pipefail

NAME=""; VERSION=""; FORMAT="both"; VST3=""; CLAP=""; OUT=""
MAINTAINER="${APC_PKG_MAINTAINER:-}"; URL="${APC_PKG_URL:-}"; LICENSE_ID="${APC_PKG_LICENSE:-Proprietary}"
DESCRIPTION="${APC_PKG_DESCRIPTION:-}"; ARCH=""; DRY=0; REQUIRE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift ;;
    --format) FORMAT="${2:?--format needs a value}"; shift ;;
    --vst3) VST3="${2:?--vst3 needs a value}"; shift ;;
    --clap) CLAP="${2:?--clap needs a value}"; shift ;;
    --out) OUT="${2:?--out needs a value}"; shift ;;
    --maintainer) MAINTAINER="${2:?--maintainer needs a value}"; shift ;;
    --description) DESCRIPTION="${2:?--description needs a value}"; shift ;;
    --url) URL="${2:?--url needs a value}"; shift ;;
    --license) LICENSE_ID="${2:?--license needs a value}"; shift ;;
    --arch) ARCH="${2:?--arch needs a value}"; shift ;;
    --dry-run) DRY=1 ;;
    --require) REQUIRE=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "create-linux-packages: unknown option $1" >&2; exit 2 ;;
    *) if [[ -z "$NAME" ]]; then NAME="$1"; else echo "unexpected argument $1" >&2; exit 2; fi ;;
  esac
  shift
done

[[ -n "$NAME" ]] || { echo "create-linux-packages: <PluginName> required (see --help)" >&2; exit 2; }
[[ -n "$VERSION" ]] || { echo "create-linux-packages: --version required" >&2; exit 2; }
[[ "$NAME" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "create-linux-packages: invalid plugin name '$NAME'" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9][A-Za-z0-9.+~_-]*$ ]] || { echo "create-linux-packages: invalid version '$VERSION'" >&2; exit 2; }
case "$FORMAT" in deb|rpm|both) ;; *) echo "create-linux-packages: --format must be deb|rpm|both" >&2; exit 2 ;; esac

# --- defaults -----------------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$ROOT/build"; RELEASE_DIR="$ROOT/release"
if [[ -f "$ROOT/scripts/lib/apc-paths.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/lib/apc-paths.sh" 2>/dev/null || true
  if declare -F apc_load_paths >/dev/null 2>&1; then
    apc_load_paths 2>/dev/null || true
    BUILD_DIR="${APC_BUILD_DIR:-$BUILD_DIR}"; RELEASE_DIR="${APC_RELEASE_DIR:-$RELEASE_DIR}"
  fi
fi
[[ -n "$OUT" ]] || OUT="$RELEASE_DIR"

ART="$BUILD_DIR/plugins/$NAME/${NAME}_artefacts/Release"
[[ -n "$VST3" ]] || VST3="$ART/VST3/$NAME.vst3"
if [[ -z "$CLAP" && ( -e "$ART/CLAP/$NAME.clap" || $DRY -eq 1 ) ]]; then CLAP="$ART/CLAP/$NAME.clap"; fi

if [[ -z "$ARCH" ]]; then
  if command -v dpkg >/dev/null 2>&1; then ARCH="$(dpkg --print-architecture)"
  else case "$(uname -m)" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) ARCH="$(uname -m)" ;; esac; fi
fi
case "$ARCH" in amd64) RPM_ARCH=x86_64 ;; arm64) RPM_ARCH=aarch64 ;; *) RPM_ARCH="$ARCH" ;; esac

PKG="$(printf '%s' "$NAME" | tr '[:upper:]_.' '[:lower:]--' | sed 's/[^a-z0-9+-]/-/g')"
[[ -n "$MAINTAINER" ]] || MAINTAINER="Unspecified <noreply@example.invalid>"
[[ -n "$DESCRIPTION" ]] || DESCRIPTION="$NAME audio plugin"
[[ -n "$URL" ]] || URL=""

# RPM forbids '-' in Version: 1.2.3-beta.1 -> Version 1.2.3, Release 0.beta.1
RPM_VERSION="${VERSION%%-*}"; RPM_RELEASE="1"
if [[ "$VERSION" == *-* ]]; then RPM_RELEASE="0.${VERSION#*-}"; RPM_RELEASE="${RPM_RELEASE//-/.}"; fi

FORMATS_TEXT="VST3"
if [[ -n "$CLAP" ]]; then FORMATS_TEXT="VST3 and CLAP"; fi

skip() { echo "SKIPPED: $1"; if [[ $REQUIRE -eq 1 ]]; then echo "ERROR: --require given" >&2; exit 1; fi; }
say() { if [[ $DRY -eq 1 ]]; then echo "[dry-run] $*"; else echo "> $*"; fi; }
run() { say "$*"; [[ $DRY -eq 1 ]] || "$@"; }

if [[ $DRY -eq 0 ]]; then
  [[ -e "$VST3" ]] || { echo "ERROR: VST3 artifact not found: $VST3 (build first: node bin/apc.js build $NAME)" >&2; exit 1; }
  [[ -z "$CLAP" || -e "$CLAP" ]] || { echo "ERROR: CLAP artifact not found: $CLAP" >&2; exit 1; }
fi

WORK=""
cleanup() { if [[ -n "$WORK" && $DRY -eq 0 ]]; then rm -rf "$WORK"; fi; return 0; }
trap cleanup EXIT
if [[ $DRY -eq 1 ]]; then WORK="${TMPDIR:-/tmp}/apc-pkg.XXXXXX"; else WORK="$(mktemp -d)"; fi

# stage <dest-root>: lay the files out exactly as they install
stage() {
  local dest="$1"
  run install -d -m 0755 "$dest/usr/lib/vst3"
  run cp -a "$VST3" "$dest/usr/lib/vst3/$NAME.vst3"
  if [[ -n "$CLAP" ]]; then
    run install -d -m 0755 "$dest/usr/lib/clap"
    run cp -a "$CLAP" "$dest/usr/lib/clap/$NAME.clap"
  fi
}

[[ $DRY -eq 1 ]] || mkdir -p "$OUT"
FAILED=0

# --- DEB ----------------------------------------------------------------------------
build_deb() {
  if [[ $DRY -eq 0 ]] && ! command -v dpkg-deb >/dev/null 2>&1; then skip "dpkg-deb not found - DEB not built"; return 0; fi
  local stagedir="$WORK/deb/${PKG}_${VERSION}_${ARCH}"
  local control
  control="Package: $PKG
Version: $VERSION
Architecture: $ARCH
Maintainer: $MAINTAINER
Section: sound
Priority: optional
Depends: libc6, libstdc++6
Description: $DESCRIPTION
 $FORMATS_TEXT audio plugin built with the Audio Plugin Coder framework."
  if [[ -n "$URL" ]]; then control="$control
Homepage: $URL"; fi
  stage "$stagedir"
  if [[ $DRY -eq 1 ]]; then
    echo "[dry-run] would write $stagedir/DEBIAN/control:"
    sed 's/^/    /' <<<"$control"
  else
    mkdir -p "$stagedir/DEBIAN"; printf '%s\n' "$control" > "$stagedir/DEBIAN/control"
  fi
  run dpkg-deb --root-owner-group --build "$stagedir" "$OUT/${PKG}_${VERSION}_${ARCH}.deb"
}

# --- RPM ----------------------------------------------------------------------------
build_rpm() {
  if [[ $DRY -eq 0 ]] && ! command -v rpmbuild >/dev/null 2>&1; then skip "rpmbuild not found - RPM not built"; return 0; fi
  local top="$WORK/rpmbuild" stagedir="$WORK/rpm-stage"
  local files="/usr/lib/vst3/$NAME.vst3"
  [[ -n "$CLAP" ]] && files="$files
/usr/lib/clap/$NAME.clap"
  local spec
  spec="Name:       $PKG
Version:    $RPM_VERSION
Release:    $RPM_RELEASE
Summary:    $DESCRIPTION
License:    $LICENSE_ID${URL:+
URL:        $URL}
BuildArch:  $RPM_ARCH
AutoReqProv: no

%description
$DESCRIPTION
$FORMATS_TEXT audio plugin built with the Audio Plugin Coder framework.

%install
mkdir -p %{buildroot}
cp -a $stagedir/. %{buildroot}/

%files
$files

%changelog
* $(LC_ALL=C date -u +'%a %b %d %Y') $MAINTAINER - $RPM_VERSION-$RPM_RELEASE
- Packaged by create-linux-packages.sh"
  stage "$stagedir"
  if [[ $DRY -eq 1 ]]; then
    echo "[dry-run] would write $top/SPECS/$PKG.spec:"
    sed 's/^/    /' <<<"$spec"
  else
    mkdir -p "$top"/{SPECS,BUILD,RPMS,SRPMS}; printf '%s\n' "$spec" > "$top/SPECS/$PKG.spec"
  fi
  run rpmbuild -bb --define "_topdir $top" --define "_rpmdir $OUT" "$top/SPECS/$PKG.spec"
}

echo "Packaging $NAME $VERSION ($ARCH) -> $OUT   formats: $FORMAT"
case "$FORMAT" in
  deb)  build_deb ;;
  rpm)  build_rpm ;;
  both) build_deb; build_rpm ;;
esac

if [[ $DRY -eq 1 ]]; then echo "DRY RUN complete - no package was built."; else echo "Done. Output: $OUT"; fi
exit $FAILED
