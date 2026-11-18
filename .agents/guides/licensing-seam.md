# Licensing module (`apc-license`) - the plugin half

> **Decided 2026-11-08** (`schemas/apc-standards.json`: `license.method`, `license.protection`).
> **L-07:** two built-in ways to *issue* licenses, one design to *verify* them. **L-06:** protection depth is `minimal`.
> Choosing a method, step-by-step setup, the issuer API and the plugin checklist: [`licensing-methods.md`](licensing-methods.md).
> This page documents the C++ module that every method shares.

File: `common/apc/ApcLicense.h` (C++17, std only, no JUCE). Tests: `common/apc/tests/test_license_states.cpp` (state machine,
fake signature) and `common/apc/tests/test_license_issued.cpp` (files issued by `apc license`, see "Verified against").
Related: `.agents/rules/product-standards.md`; `schemas/apc-standards.json`; `schemas/apc-license.schema.json`.

## The one design

The plugin **only ever verifies a signed `apc-license/1.0` file**. It does not know or care how the file was produced:

```
Method A  signed-file        developer: apc license issue  -> .lic -> e-mail/download -> customer loads it
Method B  online-activation  plugin -> POST /v1/activate -> issuer signs -> .lic        (offline: request code -> website -> .lic)
                                                       \________ same file, same ApcLicense.h _________/
license text -> ISignatureVerifier (LICENSE public key) -> LicenseManager -> LicenseState -> gates
```

Third-party SDKs and iLok/dongles are **not** built in (pointers in `licensing-methods.md`); do not wire one in unless the owner asks.

## What an agent must NOT assume or do

- `ApcLicense.h` contains **no HTTP client, no serial format, no seat counting**. Method B's server side is the issuer
  (`scripts/lib/license-issuer.js` for development, the developer's own server for production). The plugin's HTTPS call
  (a few lines on a worker thread) is integrator code that is **not shipped or tested in this repository**.
- **Ed25519 verify is not implemented in the header** (std has none). Inject an `ISignatureVerifier` over a vetted library
  (libsodium / Monocypher-ed25519 / OpenSSL; skeletons in the header comment of `ApcCanonicalJson.h`, **not compiled by the
  tests**). Never make `verify()` return true to get a demo working.
- The license key is **not** the update key (`updater.md`). Two keys, two verifier instances. `apc license` warns when it
  detects the same public key next to the license key or via `--update-pubkey`.
- No obfuscation, anti-debug, binary integrity checks, kernel drivers or dongles (`license.protection` = `minimal`; `hardened`
  is a pointer to external wrappers). Do not add them.
- This is **friction, not DRM**. A signed file proves the developer issued it; it can still be copied, and a determined person
  can patch the plugin. Never describe it to a customer as copy protection.
- No telemetry or background requests (L-08). Activation and deactivation are explicit user actions.

## What exists

| Piece | Behaviour |
|---|---|
| `LicenseState` | `Demo`, `Trial`, `Licensed`, `Unverified` - all are **working** states (audio identical, DAW recall always works) |
| `Verb` + `gateAllows()` / `LicenseManager::isAllowed()` | gates exactly `PresetSave`, `PackExport`, `PackInstall` (L-02) |
| `LicenseManager::evaluate / evaluateFile` | message-thread/worker: parse + verify + expiry + machine match + trial; publishes state |
| `state()`, `isAllowed()`, `isLicensedRT()` | **one `std::atomic<uint8_t>` load**, safe in `processBlock()`; no crypto/IO/locks |
| `activateFromText(text, path)` | verify **first**, write `license.lic` atomically (temp+rename) only if valid; a bad file never replaces a good one. Used for the tail of method B (server reply) and for "Load license file" in both methods |
| `deactivate(path)` | **local only**: remove the file, fall back to the no-license rules. With method B call the issuer's `POST /v1/deactivate` first so the seat is freed |
| `IMachineInfo`, `machineFingerprint()` | component-wise machine match (below) |
| `IBlobStore` / `FileBlobStore` | the separate trial record file |

### Gate matrix

| Verb | DEMO | TRIAL | LICENSED | UNVERIFIED |
|---|---|---|---|---|
| `PresetSave`, `PackExport`, `PackInstall` | no | yes | yes | `GatePolicy::unverifiedAllowsVerbs` (default **no**) |

Gates live in exactly two layers: UI actions and preset/pack file I/O. **Never** in the DSP graph. UNVERIFIED defaulting
to "no" is a conservative default; a paying customer behind a hardware false positive is a support cost, so offer the
re-activation path in the banner (the status text already does).

### Transitions

```
no license ──trial off──────────────────────────────► DEMO
no license ──trial on, record ok, days left─────────► TRIAL ──expired / clock rolled back / record bad──► DEMO
valid license (signature, product, not expired, machine k-of-n)──► LICENSED
signed license_type=trial key, not expired──────────► TRIAL
license expired (now >= expires_at)─────────────────► DEMO   (also wins over a running built-in trial)
license present but tampered / wrong product / wrong schema / unreadable / wrong machine──► UNVERIFIED (+ banner text)
deactivate() ─► back to the no-license rules
```

Every status carries a non-empty `message` (badge/banner text) so nothing degrades silently. UNVERIFIED is never a crash.
The CLI mirrors this order: `apc license verify` reports `LICENSED` / `TRIAL` / `DEMO` / `UNVERIFIED` (signature, then product,
then expiry, then machine - the same order as `assessLicenseText`).

### License file `apc-license/1.0`

Schema: `schemas/apc-license.schema.json`. Produced by `apc license issue` (method A) or the issuer (method B).

```json
{ "schema": "apc-license/1.0", "product": "<slug>", "customer_name": "...", "customer_email": "...", "order_id": "...",
  "issued_at": "2026-10-23T14:30:00Z", "expires_at": null,
  "license_type": "commercial_perpetual|subscription|trial|nfr", "allowed_seats": 3,
  "machine_components": ["a4f89d31e8c7b640", "5c2e...", "91ab..."], "machine_min_match": 2,
  "signature_ed25519": "<base64, 64 bytes, over apc-canon/1 bytes of this object without this member>" }
```

- Canonical JSON rules are in `updater.md` (same implementation, `ApcCanonicalJson.h` / `scripts/apc-release.js`). **Integers
  only** in signed documents (`allowed_seats`, `machine_min_match`). Dates are `YYYY-MM-DDTHH:MM:SSZ` UTC.
- `expires_at` must be **present** (`null` = never); a missing member is UNVERIFIED. `machine_components` and `machine_min_match`
  are optional (no components = unbound license, e.g. `nfr`).
- The plugin treats `allowed_seats` as information. Seats are only **enforced** by a method-B issuer.
- Formatting is not signed: pretty-printed or minified files verify identically. Any edit to a value does not.

### Machine match: k of n components

- `IMachineInfo::components()` returns raw labelled identifiers (CPU model, OS machine id, boot volume id, ...).
- Each is hashed `sha256("apc-machine/1" 0 product 0 label 0 value)[0:16]` (salted per product; raw values never stored or
  transmitted - disclose this in the privacy policy). `apc license` computes the identical hash (`machineComponentHash`);
  the cross-check is in `test_license_issued.cpp`.
- The license stores the n hashes. The machine matches when **at least k** distinct license components are also produced by
  this machine: k = `machine_min_match` if present else `LicenseConfig::minMatchComponents` (default **2 of 3**), clamped
  to [1, n]. Swapping one disk or board does not invalidate a license. No components = unbound license.
- The issuer (method B) uses the same k-of-n rule to decide whether a request is a machine it already knows.
- Choosing *which* identifiers to read per OS is platform code the integrator writes; keep it read-only and non-elevated.

### Built-in trial and the clock-rollback guard

- Opt-in per plugin (`license.mode` trial / demo+trial); `trialDays` default 40; no key, no email. Independent of the method.
- Separate small record (**not** `settings.json`): `{"v":1,"first":T0,"last":Tmax,"mac":HMAC-SHA256}`.
  `last` is the **monotonic maximum of observed times**; it is rewritten only when it advanced >= 15 min.
- `now + 1h tolerance < last` => **rollback** => DEMO (`ClockRollback`), never a lock-out: correcting the clock resumes
  the trial and the rolled-back time gains nothing. Rolling back after expiry cannot revive the trial.
- Clock before 2023-11 is "invalid": DEMO, nothing written. Edited / foreign / unauthenticated record: DEMO
  (`TrialRecordInvalid`) and the record is **not** silently rewritten.
- **Honest limits (do not oversell):** the HMAC key is compiled into the binary, so this stops casual edits only;
  deleting the record restarts the trial; a clock jumped far *forward* then restored leaves the plugin in DEMO until real
  time catches up (bounded by the remaining trial). A second record location or an OS keychain is the `hardened` territory
  and is **not** built in.
- Subscription/`expires_at` checks use the system clock without the rollback guard.
- A time-limited trial can also be issued as a signed `license_type: "trial"` key (`apc license issue --type trial --expires ...`).

## Verified against (what the tests prove, and what they do not)

- `test_license_states.cpp` uses a **fake** signature primitive: it proves the state machine, not Ed25519.
- `test_license_issued.cpp`, golden mode (runs inside `test/apc-cpp-release.test.js`): licenses signed by the Node tool with a
  test-only seed are loaded through `ApcLicense.h`; the test verifier accepts only the exact (canonical bytes, signature) pair Node
  produced. So the C++ canonicalisation (including quote, backslash, control characters, non-BMP, U+2028, DEL) is byte-identical
  to what Node signed, and the machine hashes agree. `test/license.test.js` proves with Node's Ed25519 that those bytes + signature are valid.
- `test/apc-cpp-license.test.js` (live mode): a fresh key and licenses are generated per run, and the C++ test hands the bytes
  **it computed** to a real Ed25519 verification (Node) - a tampered copy and a foreign key are rejected, and a license
  served by the reference issuer verifies too.
- **Not proven:** which Ed25519 library you embed (the adapter is yours), the plugin's HTTP client, platform machine-id reading,
  behaviour inside a DAW. The compiler used was MSVC; tests skip cleanly without a compiler.

## Integration checklist

The full plugin checklist (threads, gating, recall) is in [`licensing-methods.md`](licensing-methods.md#10-plugin-checklist-what-the-generated-plugin-must-do). Core items:

- [ ] `ISignatureVerifier` adapter with the **license** public key (not the update key)
- [ ] `IMachineInfo` implementation; `FileBlobStore(<AppDataRoot>/<Mfr>/<Plugin>/trial.dat)`
- [ ] `LicenseConfig{ product, trialEnabled, trialDays, trialMacKey = a build-time constant }` from the standards options
- [ ] `evaluateFile(<AppDataRoot>/.../license.lic)` at processor init / editor open (message thread), never in `processBlock`
- [ ] Gates only in UI + preset/pack I/O, reading `isAllowed(Verb)`
- [ ] Badge text from `status().message` in the shared footer spot (U-16); demo-recall banner per `demo-models.md`
- [ ] Automated test that audio output is bit-identical in DEMO vs LICENSED (use `apc audio` null gate)
