# Signing, Packaging and Provenance

Agent-facing flow for the release end of Ship. Scripts and their environment variables are
documented in `scripts/installer/README.md`; this guide fixes the **order** and the **rules**.

> **Status: real signing, notarization and Linux packaging were NOT exercised** when these tools
> were written (no certificate, Apple account, macOS or Linux host). Only syntax checks and
> `--dry-run` output were verified. Tell the user this on first use and ask them to confirm the first
> real run on each platform.

## Rules

1. **Never** put certificates, `.pfx` files, passwords, notary credentials or tokens in the repo, in
   `apc.config.json`, in `status.json`, in chat output or in commit messages. Configuration is
   environment variables only (CI secret store / OS keychain). Scripts mask secrets in `--dry-run`.
2. Run `--dry-run` first and show the user the commands before the first real signing run.
3. **Unsigned or skipped is a legitimate, reportable state - not a pass.** Each script prints
   `SKIPPED (artifacts NOT signed): <reason>` when its configuration is missing. Relay that sentence
   verbatim in the ship summary. In release CI use `--require` / `-Require` so a skip fails the job.
4. Do not claim an artifact is signed, notarized or verified unless the script's own verify step
   (`signtool verify /pa`, `codesign --verify`, `stapler validate`, `spctl --assess`) ran and succeeded
   in this session. `--dry-run` output proves nothing about the artifact.
5. Sign **before** you hash: any change to a file after `apc sbom` invalidates its digest.

## Release order

```
 1. node bin/apc.js build <Plugin>                    build (all formats; CLAP if opted in)
 2. node bin/apc.js audio <Plugin>                    audio gates (see audio-validation.md)  [optional but recommended]
 3. installers: scripts/installer/create-windows-installer.ps1 | create-macos-installer.sh | create-linux-packages.sh
 4. sign (per platform, on that platform):
      Windows : scripts\installer\sign-windows.ps1 [-DryRun] [-Require] <plugin binaries> <installer.exe>
      macOS   : scripts/installer/sign-macos.sh [--dry-run] [--require] <bundles> then the .pkg/.dmg
      Linux   : (packages unsigned by APC; sign with dpkg-sig / rpmsign or publish via a signed repo)
 5. node bin/apc.js sbom <Plugin>                     SBOM + provenance over the FINAL signed files
 6. (optional, if available) sign the provenance / SBOM, e.g. with the same code-signing key,
    Sigstore/cosign or GPG, so the record itself is attestable
 7. publish
```

### Windows details

Sign the inner binaries first (`<Name>.vst3`, `<Name>.clap`, `<Name>.exe`) **before** compiling them into
the Inno Setup installer, then sign the installer `.exe` itself. Inno can do the latter via
`SignTool=` in the `.iss`, but then the secrets handling is Inno's; prefer the script. Timestamping is
always on (RFC 3161, default DigiCert URL, override with `APC_SIGN_TIMESTAMP_URL`) so signatures outlive the
certificate. Methods: Azure Trusted Signing, a `.pfx`, or a cert store / EV token.

### macOS details

Hardened runtime + secure timestamp are mandatory for notarization. Sign nested code first (the
script does this inside-out), then the bundle, then the `.pkg`/`.dmg` that wraps them, then notarize and
staple **that container**. Stapling a bare plugin bundle is untested here. `spctl` can reject plugin
bundles for reasons unrelated to your signature; judge by the container's assessment.

### Linux details

`create-linux-packages.sh` installs `<Name>.vst3` to `/usr/lib/vst3/` and `<Name>.clap` to `/usr/lib/clap/`
(system-wide paths per the formats' specs). It builds DEB (`dpkg-deb`) and RPM (`rpmbuild` with a generated
spec; a `-suffix` in the version becomes the RPM `Release`). Missing tools skip that format with a message.
Dependencies are minimal (`libc6`, `libstdc++6`); WebView plugins also need the system webkit2gtk runtime
- check `ldd` on the built plugin and extend the `Depends:` line by hand if needed.

## `apc sbom`

```
node bin/apc.js sbom <Plugin> [--out F] [--release-dir D] [--json] [--deterministic] [--no-git] [--no-artifacts]
```

Writes next to each other (default `paths.release_dir`):

- `<Plugin>-sbom.cdx.json` - **CycloneDX 1.5 JSON**. Components: JUCE (version from
  `_tools/JUCE` module declaration + git commit), `clap-juce-extensions` (only if `formats.clap`),
  `visage` (only for Visage UIs), `pluginval` (scope `excluded`: test tool, not shipped), and every package in
  the plugin's `package-lock.json` (v1/v2/v3; dev packages scope `optional`). Licenses are taken from the
  component's own LICENSE file or lockfile and left out when not recognized - never guessed.
- `<Plugin>-provenance.json` - in-toto Statement v1 with a SLSA-provenance-v1-shaped predicate: source git
  sha + **dirty flag**, builder id (`urn:apc:builder:local` or the GitHub Actions run), OS/arch,
  tool versions (apc, node, git, cmake, JUCE), resolved submodule commits, timestamp, and the
  **sha256 of every `<Plugin>*` file in the release dir** as `subject`.

Properties to rely on: deterministic ordering and key order (diff two runs), `serialNumber` is derived from the
content, the timestamp honours `SOURCE_DATE_EPOCH` and `--deterministic` omits it. Remote URLs are stripped of
embedded credentials.

Limits to state honestly:

- The provenance record is **self-generated and unsigned**. It is a documented record of what ran, not a
  SLSA-certified attestation, and it says so in `predicate.apc`. A `git_dirty: true` record means the artifact
  was not built from the recorded commit alone - do not ship such a build as a release.
- Transitive native dependencies pulled by JUCE modules (system libraries, webkit2gtk, WebView2 runtime) are
  not enumerated.
- Empty `subject` (no release artifacts found) means `/apc-ship` has not produced files yet; the tool says so.

## Ship summary checklist (what to tell the user)

- For each platform: signed? notarized? (`yes, verified` / `SKIPPED - <reason>` / `not run`).
- Path and sha256 of each release artifact (from the provenance `subject` list).
- SBOM + provenance paths, and that provenance is unsigned unless step 6 was done.
- Anything not exercised in this session (be explicit).
