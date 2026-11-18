# Release signing and packaging scripts

Companion scripts for the Ship phase. They sit next to the existing installer builders
(`create-windows-installer.ps1`, `create-macos-installer.sh`) and are meant to run
**after** the installers exist and **before** `node bin/apc.js sbom <Plugin>` (so the
provenance record hashes the signed bytes). Flow and rationale:
`.agents/guides/signing-and-provenance.md`.

> **Status: real signing was NOT exercised.** These scripts were written and checked
> without a code-signing certificate, an Apple Developer account, a macOS host or a Linux
> host. Verified: PowerShell parser accepts `sign-windows.ps1`; `bash -n` accepts both
> shell scripts; `--dry-run` output reads correctly and masks secrets. Everything that
> talks to `signtool`, `codesign`, `notarytool`, `stapler`, `spctl`, `dpkg-deb` or
> `rpmbuild` is UNVERIFIED until run once on the real platform.

Common behaviour:

- Configuration is **environment variables only**. Nothing is hardcoded, secrets are
  masked (`********`) in `--dry-run` output and logs.
- `--dry-run` / `-DryRun` prints the exact commands and executes nothing.
- Missing configuration means **SKIPPED (artifacts NOT signed)** with the missing
  variable names, exit 0. Add `--require` / `-Require` in release CI to make a skip a
  failure. A skipped signing step must never be reported as "signed".
- Never commit certificates, `.pfx` files, passwords or notary credentials. Put them in
  the CI secret store or the OS keychain.

## `sign-windows.ps1`

```powershell
.\scripts\installer\sign-windows.ps1 [-DryRun] [-Require] [-Method auto|azure|pfx|certstore] [-TimestampUrl URL] <file>...
```

| Variable | Used by | Meaning |
|---|---|---|
| `APC_SIGN_METHOD` | all | `azure`, `pfx` or `certstore`; default auto-detect in that order |
| `APC_SIGN_TIMESTAMP_URL` | all | RFC 3161 timestamp server (default `http://timestamp.digicert.com`) |
| `APC_SIGNTOOL` | all | explicit `signtool.exe` path (else PATH, then newest Windows SDK x64) |
| `APC_SIGN_AZURE_DLIB` | azure | path to `Azure.CodeSigning.Dlib.dll` |
| `APC_SIGN_AZURE_ENDPOINT` | azure | Trusted Signing endpoint, e.g. `https://eus.codesigning.azure.net` |
| `APC_SIGN_AZURE_ACCOUNT` | azure | Trusted Signing account name |
| `APC_SIGN_AZURE_PROFILE` | azure | certificate profile name |
| `APC_SIGN_PFX_PATH` | pfx | path to the `.pfx` file |
| `APC_SIGN_PFX_PASSWORD` | pfx | optional; briefly visible in process listings while signtool runs |
| `APC_SIGN_CERT_SHA1` | certstore | certificate thumbprint (EV token / HSM / installed cert) |
| `APC_SIGN_CERT_SUBJECT` | certstore | subject-name substring, used when no thumbprint is given |
| `APC_SIGN_MACHINE_STORE` | certstore | `1` = search the machine store (`/sm`) |

Azure authentication itself (`az login`, or `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET`) is read by the Azure SDK inside the dlib, not by this script.
Every signed file is verified afterwards with `signtool verify /pa`.

## `sign-macos.sh`

```bash
scripts/installer/sign-macos.sh [--dry-run] [--no-notarize] [--require] <path>...
```

`<path>` = `.vst3` / `.component` / `.clap` / `.app` bundle, `.dmg` or `.pkg`.

| Variable | Meaning |
|---|---|
| `APC_SIGN_IDENTITY` | `Developer ID Application: Name (TEAMID)` (bundles, `.app`, `.dmg`) |
| `APC_SIGN_INSTALLER_IDENTITY` | `Developer ID Installer: Name (TEAMID)` (`.pkg`, via `productsign`) |
| `APC_ENTITLEMENTS` | optional entitlements `.plist` |
| `APC_NOTARY_PROFILE` | keychain profile created with `xcrun notarytool store-credentials` (preferred) |
| `APC_NOTARY_APPLE_ID`, `APC_NOTARY_TEAM_ID`, `APC_NOTARY_PASSWORD` | alternative: Apple ID + team + app-specific password |

Per item: nested code signed inside-out, `codesign --options runtime --timestamp`,
`codesign --verify --deep --strict`, `ditto` zip, `xcrun notarytool submit --wait`,
`xcrun stapler staple` + `validate`, `spctl --assess`. Hardened runtime plus a secure
timestamp are required for notarization. Without notarization credentials the script
signs and verifies but says so and skips notarize/staple.

Notes: notarize and staple the **`.pkg` or `.dmg`** you ship; stapling a bare plugin
bundle is UNVERIFIED. `spctl --assess` on plugin bundles can report "rejected" for
reasons unrelated to signing - treat the installer-level assessment as authoritative.

## `create-linux-packages.sh`

```bash
scripts/installer/create-linux-packages.sh <Plugin> --version X.Y.Z [--format deb|rpm|both] \
    [--vst3 PATH] [--clap PATH] [--out DIR] [--maintainer "N <m>"] [--description T] \
    [--url U] [--license ID] [--arch A] [--dry-run] [--require]
```

Installs `<Name>.vst3` to `/usr/lib/vst3/` and `<Name>.clap` (when built) to
`/usr/lib/clap/`. DEB via `dpkg-deb --root-owner-group --build`; RPM via a generated spec
and `rpmbuild -bb`. A missing `dpkg-deb` / `rpmbuild` skips that format with a message.

| Variable (all optional) | Meaning |
|---|---|
| `APC_PKG_MAINTAINER` | `Name <email>` for DEB `Maintainer` / RPM changelog |
| `APC_PKG_URL` | homepage / URL field |
| `APC_PKG_LICENSE` | RPM `License:` value (default `Proprietary`) |
| `APC_PKG_DESCRIPTION` | one-line description |

Packages are **not signed** by this script; sign with `dpkg-sig` / `rpmsign`, or publish
through a signed repository.
