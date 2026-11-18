# Updater (`apc-updater`)

Backend-only update check + download + verification for a generated plugin. No UI components
(the editor reads a status struct). Decisions: U-16, X-07, L-09 (behavior LOCKED; pricing OPEN
and not this module's business). Registry options: `update.auto_check`, `update.endpoint`.

| Piece | File |
|---|---|
| State machine (C++17, std only, **no JUCE**) | `common/apc/ApcUpdateFlow.h` |
| SemVer + downgrade check | `common/apc/ApcSemVer.h` |
| Canonical JSON, SHA-256, base64, injected seams | `common/apc/ApcCanonicalJson.h` |
| Manifest schema | `schemas/apc-update-manifest.schema.json` (`apc-update/1.0`) |
| Release tooling (keygen / manifest / sign / verify) | `scripts/apc-release.js` -> `apc release ...` |
| Tests | `common/apc/tests/test_update_*.cpp`, `test_semver_*.cpp`, `test/release.test.js`, `test/apc-cpp-release.test.js` |

> `bin/apc.js` does not dispatch `release` yet (not part of this workstream). The CLI owner adds one case:
> `case 'release': process.exit(require('../scripts/apc-release.js').run(rest, { root: ROOT, resolvePaths, pluginPath, readConfig, cmd: 'release' }));`
> Until then the examples below work through that same `run(args, ctx)` entry point (see `test/release.test.js`).

## Trust chain (what the plan left undefined)

```
release machine                                   user machine (plugin)
installer  --OS code signing (Authenticode / notarization)-->  OS checks it at launch   [additional, OS-level]
installer  --sha256 + size--> manifest  --Ed25519 (UPDATE key)--> embedded PUBLIC key verifies the manifest
                                                                   -> sha256/size of the download must match the SIGNED values
```

1. **Update key != license key.** Generate a dedicated Ed25519 pair with `apc release keygen`. A leaked
   update key must not forge licenses and vice versa. The plugin embeds only the 32-byte public key.
2. The manifest is the only thing signed. Artifact integrity rides on the signed `sha256` + `size`.
3. HTTPS is required (transport), but trust does **not** depend on it: a MITM or a hijacked CDN cannot
   produce a valid signature.
4. Sign the installer with the OS code-signing tooling **first** (see `signing-and-provenance.md`),
   then hash it: `apc release manifest` must run on the **final** bytes.

### What this does NOT protect against (say so to the user)

- **Freeze / replay:** an attacker who can serve an old, validly signed manifest can hide a newer release
  (the user stays "up to date") or offer an older-but-newer-than-installed one. Mitigation if needed:
  persist the highest `published_at` seen and refuse older (not implemented).
- **Key rotation / compromise:** v1 has one key. If it is compromised, ship a new plugin build with a new
  embedded key through a channel the user trusts; there is no in-band revocation.
- Real network behaviour: the logic is tested with fakes only. `IHttp` is not implemented here.

## Manifest `apc-update/1.0`

```json
{
  "schema": "apc-update/1.0",
  "product": "DemoSynth",
  "version": "1.3.0",
  "min_supported": "1.0.0",
  "published_at": "2026-11-07T12:00:00Z",
  "notes": "Plain text, max 16 KiB.",
  "artifacts": [
    { "platform": "windows-x64", "kind": "installer", "url": "https://dl.example.test/DemoSynth-1.3.0-Windows-Setup.exe",
      "sha256": "<64 lowercase hex>", "size": 12345678 }
  ],
  "signature": "<base64 of the 64-byte Ed25519 signature>"
}
```

- `platform`: `windows|macos|linux` + `-x64|-arm64|-universal`. `kind`: the updater only offers `installer`
  (full installers, never patches; a user on any old version can run the newest one).
- `url` may be a bare file name; the plugin resolves it next to the manifest URL. Everything else must be
  `https://`.
- `min_supported` is informational (`UpdateStatus::belowMinSupported`): an old plugin is told to update,
  never disabled.
- **All numbers are integers.** Floats have no canonical form and are rejected.

### Canonical JSON (`apc-canon/1`) - the signed bytes

Signed bytes = canonical JSON of the document **without** its `signature` member:

1. Object members sorted by the key's **UTF-8 bytes** (code point order; not JS/UTF-16 order). Duplicate keys: error.
2. No whitespace.
3. Strings UTF-8; escape only `"`, `\`, and U+0000..U+001F (`\b \f \n \r \t`, else `\u00xx` lowercase hex).
   `/`, DEL, U+2028 and non-ASCII are emitted raw.
4. Integers only, `|n| <= 2^53-1`, no `+`, no leading zeros, never `-0`, no exponent.
5. `true false null`; arrays keep order.

Implemented twice and kept identical by golden vectors: `scripts/apc-release.js` (`canonicalize`) and
`ApcCanonicalJson.h` (`canonicalize`, `canonicalizeWithout`), both tested against
`test/fixtures/release/canonical-vectors.json` (hand-derived expected bytes + an RFC 8032 key).
**If you touch either implementation, run both test suites.**

## Release workflow

```bash
# once per product line (keep the private key OFFLINE; never commit it)
node bin/apc.js release keygen --out ~/.apc-keys/<product>           # refuses to overwrite
#   -> apc-update-private.pem (0600), apc-update-public.pem, apc-update-public.b64, apc-update-public-key.inc

# per release, AFTER the installers are built and OS-signed
node bin/apc.js release manifest --plugin <Name> --base-url https://dl.example.test/<name> \
     --notes CHANGELOG-this-release.txt --min-supported 1.0.0 --key ~/.apc-keys/<product>/apc-update-private.pem
node bin/apc.js release verify release/<Name>/update-manifest.json \
     --pubkey ~/.apc-keys/<product>/apc-update-public.b64 --current <previous-version>
# upload the installers and update-manifest.json; the manifest URL is the plugin's update.endpoint
```

- Artifacts are scanned in `paths.release_dir/<Plugin>` (fallbacks: `<Plugin>_v<ver>`, then the shared release
  dir filtered by name prefix). Files whose name carries another version, or whose platform cannot be inferred,
  are **skipped with a warning**; two installers for one platform is an error.
- `verify --current V` fails on a downgrade (and reports "no update" when equal); it also re-hashes local artifacts.
- Everything accepts `--json`. Exit codes: 0 ok, 1 failure, 2 usage.

## Plugin integration

1. Embed the public key (`apc-update-public-key.inc`) and write an `ISignatureVerifier` adapter over
   libsodium / Monocypher-ed25519 / OpenSSL (skeletons: header comment of `ApcCanonicalJson.h`). **Ed25519 verify is not
   implemented in this repo.** Without it the module cannot work; do not fake `verify()` to return true.
2. Implement `IHttp` (JUCE `URL`, WinHTTP/NSURLSession, libcurl - your choice; **HTTPS, timeout, size cap**). `get()` is
   the manifest; `download()` streams to the `.part` path the flow gives you and must poll the `cancel` flag.
3. Construct one `UpdateFlow` per process (processor-owned or a singleton, **not** editor-owned) with
   `UpdateConfig{ product, currentVersion = JucePlugin_VersionString, platform, endpointUrl = standards `update.endpoint`,
   downloadDir = <AppDataRoot>/<Mfr>/<Plugin>/updates }`.
4. Run operations on a **worker thread**, never the audio or message thread. Poll `status()` from a UI timer or use
   `onChange` (called on the worker; hop to the message thread with `MessageManager::callAsync` guarded by a weak flag).
   Join the worker before destroying the flow.
5. Settings: wrap the shared `SettingsStore` in `StoreUpdateSettings<SettingsStore>` for the once-per-day gate
   (`ui.auto_update_check`, `update.last_check_unix`; see `settings-store.md`). Call `autoCheckIfDue()` once when a
   plugin window opens (worker thread). The slot is claimed atomically across instances and processes.
6. The version string (`v1.3.0`, `[DEMO]`/`[TRIAL n d]` badge, `^ update available` note) comes from one source and
   is always visible (U-16). The editor only reads `UpdateStatus`.

### States and what the UI shows

| State | Meaning | UI |
|---|---|---|
| `Idle` | nothing happened | - |
| `Checking` | manifest request in flight | spinner / "Checking..." |
| `UpToDate` | latest <= running | "You have the latest version" (manual check only) |
| `UpdateAvailable` | newer signed release for this platform | notes + **[Download]** `[Later]`; footer note `^ update available` |
| `Downloading` / `Verifying` | explicit download running / hash+size check | progress from `bytesDownloaded / artifactSize`, **[Cancel]** |
| `ReadyToInstall` | verified installer is on disk (`installerPath`) | show `message`: **close the DAW, then run the installer**; offer "Show file" |
| `Failed` | `error` + non-empty `message` | show `message`; offer retry (download failures are retryable) |

`automatic == true` means the check came from the daily gate: stay quiet for `UpToDate` and `Network` failures
(stone rule: invisible when nothing is found), but still write the status to the local diagnostics log
(`crash-diagnostics.md`). Manual checks always show their result.

### Why `ReadyToInstall` and not "install now"

Windows keeps a loaded plugin DLL locked, so the installer cannot replace it while the DAW runs; many sandboxed
hosts block launching executables; and the installer needs elevation (one UAC click) anyway. The flow therefore
downloads + verifies, then **tells the user** to close the DAW and run the installer. It never launches, replaces or
deletes anything, and never downloads without an explicit `download()` call (also after an auto-check).

## Hard rules for agents

- Network traffic only for: explicit user actions (manual check, download) and the daily auto-check when the user
  enabled `auto_update_check` (default OFF). No telemetry, no extra requests (stone rule 4).
- Never hardcode the update URL; read the `update.endpoint` option (empty = report "No update service is configured").
- Never skip signature verification "for testing" in shipped code; tests inject `ISignatureVerifier` fakes.
- Do not claim the updater works end to end: it has been tested against fakes (`IHttp`, verifier) and the golden
  vectors only.
