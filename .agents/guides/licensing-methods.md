# Licensing methods - how to sell a plugin with APC

For developers who **sell** plugins. APC offers exactly two built-in ways to issue licenses; everything else is a pointer.
The plugin side is the same for both: it verifies a signed `apc-license/1.0` file ([`licensing-seam.md`](licensing-seam.md)).

> **Read this first.** Any client-side licensing scheme can be defeated, and a license file can be copied. What this gives
> you is *friction for honest users* (the common case: a friend asks "can I have your file?") and a clean way to tell a
> paying customer from a demo user. It is **not DRM**. Do not promise customers or yourself more than that.

## 1. Which method?

```
Do you sell it at all?
 ├─ no (free / open source) ........................ license.mode = free        -> nothing in this guide applies
 └─ yes
     ├─ few customers, you send each one a file by hand, no website/server ....... Method A  signed-file        (default)
     ├─ web shop that can hold a key per order and a small server/plugin ......... Method B  online-activation
     └─ you want a dongle, or a vendor to run everything ........................ pointers (section 7) - not built in
```

| | **A `signed-file`** (default) | **B `online-activation`** |
|---|---|---|
| Server needed | none | yes (your own; reference issuer for testing) |
| Customer experience | receives a `.lic`, loads it (button or drag-and-drop) | types a key; online = automatic, offline = a request code and a file |
| Seats (`license.seats`, default 3) | written into the file, **cannot be enforced** (the same file can be loaded anywhere it matches) | **enforced** by the issuer; in-app deactivation frees a seat |
| Machine binding | optional: customer sends you "machine info", you bind the file to it | automatic: the plugin sends salted component hashes |
| Lost license | re-send the file | customer re-activates (same machine = same seat) |
| Your effort | sign a file per order (script it from your shop's webhook) | run an HTTPS service next to your shop |

Choose A until you have a reason not to. Moving to B later needs no plugin change beyond adding the activation dialog,
because the file format and the verifier are identical.

## 2. What is shared

1. **A LICENSE key pair** (Ed25519). The private key signs licenses and stays with you; the 32-byte public key is compiled into the plugin.
   It must be a *different* pair from the update key (`apc release keygen`, [`updater.md`](updater.md)): whoever can sign updates must not be able to mint licenses.
2. **The file** `apc-license/1.0` ([schema](../../schemas/apc-license.schema.json)): customer, order, type, expiry, seats, optional machine components.
3. **The plugin** (`common/apc/ApcLicense.h`): verifies the file, decides DEMO / TRIAL / LICENSED / UNVERIFIED, gates exactly three verbs.
4. **The tools**: `apc license keygen | issue | verify | inspect | serial | serve | request-code` (all accept `--json`; exit 0 ok, 1 failed, 2 usage).

Back up the private key offline. If you lose it you cannot issue new licenses for the public key embedded in shipped plugins;
changing the key means shipping a new plugin build (old files then no longer verify against the new key).

## 3. Method A - `signed-file`

```bash
# 1. once per product: make the key pair (private key stays OUT of the repo)
apc license keygen --out ~/keys/mysynth-license --product mysynth
#    -> apc-license-private.pem (secret, back it up), apc-license-public.b64, apc-license-public-key.inc (C++)

# 2. embed the public key in the plugin: paste apc-license-public-key.inc (kApcLicensePublicKey[32]) next to your
#    ISignatureVerifier adapter. Commit the .inc/.b64 (public); never the .pem.

# 3. per order: issue a file
apc license issue --key ~/keys/mysynth-license/apc-license-private.pem --product mysynth \
    --name "Ada Lovelace" --email ada@example.com --order W-1042 --seats 3 --out ada.lic
#    subscription / trial need an expiry:   --type subscription --expires 2027-11-08T00:00:00Z
#    reviewers / press:                     --type nfr

# 4. check what you are about to send, with the PUBLIC key only (what the plugin will do):
apc license verify ada.lic --pubkey ~/keys/mysynth-license/apc-license-public.b64 --product mysynth
apc license inspect ada.lic
```

`--product` must equal the product identifier compiled into the plugin (`LicenseConfig::product`); a license for another product is UNVERIFIED.
`issue` refuses to overwrite a file without `--force`, validates every field against the schema, and warns if the license key equals the update key.

**Binding a file to one machine (optional).** The plugin can show a "Copy machine info" text (the output of `machineFingerprint()`: up to a few
16-hex-char salted hashes). The customer sends it; you add `--machine-components h1,h2,h3 --min-match 2`. The plugin then accepts the file
on any machine that reproduces **2 of the 3** hashes (a new disk or network card does not lock the customer out). Without components the file
works anywhere and can be shared freely - fine for `nfr`, a weak choice for retail. Seats stay informational in method A.

**Customer flow in the plugin:** *Settings -> Load license file...* (or drag a `.lic` onto the window) -> `LicenseManager::activateFromText()`
verifies first and only then installs the file atomically; a wrong or edited file never replaces a good one. *Deactivate* removes the local file.

## 4. Method B - `online-activation`

The model: your shop generates a **key valid for N machines** (3-5, your choice; `license.seats`). The customer enters it in the plugin.

```
 online                                                   offline (studio without internet)
 plugin --POST /v1/activate--> issuer                     plugin shows REQUEST CODE  ──(customer copies it)──┐
        {serial, machine_components, product, ...}                                                           v
        issuer: key valid? product ok? seat free or machine known?    customer, on any connected computer: opens your website page,
        <-- signed apc-license/1.0 (license) --                       pastes the code  -> POST /v1/offline/redeem -> downloads the .lic
 plugin: activateFromText()  -> LICENSED                                                                      │
                                                          plugin: Load license file...  <──(USB stick)────────┘   -> LICENSED
```

### 4.1 Development setup with the reference issuer

`scripts/lib/license-issuer.js` is a zero-dependency Node implementation of the API in section 5 with a JSON-file store. It is for **development and testing**; production issuers belong behind HTTPS (section 6).

```bash
apc license keygen --out ./keys --product mysynth                                    # LICENSE key pair (see 3)
apc license serial --db ./issuer-db.json --product mysynth --seats 3 \
    --email ada@example.com --name "Ada Lovelace" --order W-1042                     # prints a key ONCE, stores only its hash
apc license serve  --db ./issuer-db.json --key ./keys/apc-license-private.pem --product mysynth --port 8787
#    -> listening on http://127.0.0.1:8787   (loopback only, no TLS; --host needs --allow-remote)
curl -s localhost:8787/v1/health
```

Also: `apc license serial --db ... --product mysynth --list` (ids, seats used; never the clear key), `--revoke <key>`, `--restore <key>`,
`--reset <key>` (free all seats, e.g. after a hard-disk failure). Serial format: 20 characters of Crockford base32 in four groups
(`ABCDE-FGHJK-MNPQR-STVWX`), the last character is a check character that catches typos and most transpositions before any lookup.

### 4.2 What the plugin does

Illustrative sequence (this repository ships `ApcLicense.h`, not the HTTP client; the call below is integrator code and is **not tested here**):

1. **Activate (online).** On a worker thread: `components = machineFingerprint(product, machineInfo)`; `POST {issuerUrl}/v1/activate` with
   `{serial, email?, machine_components, product, plugin_version}`. On HTTP 200 pass the response's `license` object, serialised as JSON
   (any whitespace - the signature covers canonical JSON), to `LicenseManager::activateFromText(text, licensePath)` on the message thread.
   **Never trust the server's word alone:** `activateFromText` re-verifies the signature with the embedded public key.
2. **Errors.** Switch on `error`: `invalid_serial` ("That key is not valid. Check for typos."), `revoked`, `seat_limit` ("All N seats are in use. Deactivate
   another computer, or contact support." - the body has `seats` and `seats_used`), `product_mismatch`, `rate_limited` (try later), anything else / no network ->
   offer the offline path. Show your own wording; `message` is for logs.
3. **Activate (offline).** Build the request code: base64url (no padding) of the UTF-8 JSON
   `{"v":1,"product":"mysynth","serial":"...","machine_components":["..."],"plugin_version":"1.2.3"}` and show it with a *Copy* button and your website address.
   (The issuer also accepts padded standard base64, so a plain `base64Encode()` from `ApcCanonicalJson.h` works.) `apc license request-code ...` builds/decodes the same format for testing.
4. **Load the file.** *Load license file...* / drag-and-drop -> `activateFromText()`.
5. **Deactivate.** *Deactivate this computer*: `POST /v1/deactivate {serial, machine_components}` (best effort; if offline, tell the user the seat is
   freed only after they deactivate online or you reset it), then `LicenseManager::deactivate(licensePath)`. The plugin must keep the serial the customer typed (store it
   next to the license, not in `settings.json`) for this call.
6. **Re-activation after hardware changes** needs nothing special: the same machine (k-of-n components) maps to the same seat; the issuer refreshes the stored components.

### 4.3 Offline from the customer's side (website page)

Your site needs one small page: a text box for the request code and a button that calls the issuer (`POST /v1/offline/request` first to show
"register this computer for key ABCDE-*****-*****-STVWX? 1 of 3 seats used", then `POST /v1/offline/redeem`) and offers `license_text` as a
download named `file_name`. `offline/request` is a dry run that consumes no seat; implementing only `redeem` is fine.

## 5. Issuer API v1 (normative: `schemas/apc-activation-api.schema.json`)

JSON bodies, `Content-Type: application/json` on every POST, HTTPS in production. Errors are `{ "ok": false, "error": "<code>", "message": "..." }`.

| Route | Request | Success (HTTP 200) | Errors |
|---|---|---|---|
| `GET /v1/health` | - | `{ok, api:"v1", service, product}` | - |
| `POST /v1/activate` | `{serial, email?, machine_components[1..16 x 16-hex], product, plugin_version?}` | `{ok, license, license_text, seats, seats_used, already_registered}` | `invalid_serial` 403, `revoked` 403, `seat_limit` 409, `product_mismatch` 400, `bad_request` 400 |
| `POST /v1/deactivate` | `{serial, machine_components[], product?}` | `{ok, freed, seats, seats_used}` (idempotent: `freed:false` when the machine held no seat; allowed for revoked keys) | `invalid_serial` 403, `bad_request` 400 |
| `POST /v1/offline/request` | `{request_code}` | dry run: `{ok, product, serial_hint, machine_count, seats, seats_used, already_registered, would_fit}` | `invalid_request_code` 400, `product_mismatch` 400, `invalid_serial`, `revoked`, `seat_limit` |
| `POST /v1/offline/redeem` | `{request_code}` | like activate, plus `file_name` | as above |

Cross-cutting: `413 payload_too_large` (reference cap 16 KiB), `415 unsupported_media_type`, `429 rate_limited`, `404 not_found`, `405 method_not_allowed`, `500 server_error`.
`invalid_serial` is also returned for a wrong `email`, so the endpoint does not reveal which keys exist.

Semantics every implementation must keep:

- **Idempotent per machine.** A request whose components share at least `min(k, n)` hashes with a registered machine *is* that machine (default k = 2). Re-activation returns a fresh license and does not use a second seat.
- **The license** is a normal `apc-license/1.0` object: `allowed_seats` = the key's seat count, `machine_components` = the request's components, `machine_min_match` = k, signed with the LICENSE key.
- **No raw hardware data** ever reaches the server - only the plugin's salted hashes.

The reference issuer additionally: binds to `127.0.0.1`, caps the body, rate-limits per socket address (60 requests/min, and 10 failed key attempts/min), compares keys in constant time against stored SHA-256 hashes, sends no CORS headers (browsers cannot call it cross-origin), requires `application/json` on POST, writes its JSON database atomically (temp file + fsync + rename) and picks up changes made by `apc license serial` while it runs.

## 6. Production issuers, WooCommerce-style plugins and hosted services

**You do not have to run the reference issuer.** The plugin needs (a) an HTTPS endpoint speaking the API above, or (b) any way to get a correctly signed `.lic` to the customer.

*A license-manager plugin on your shop* (a WordPress/WooCommerce-style plugin with an **activation limit** and activate / deactivate / validate REST routes) already owns most of the logic. Typical mapping:

| This API | Typical license-manager concept |
|---|---|
| key (`serial`) | the license key generated per order |
| `seats` | the plugin's "activation limit" (3-5, set per product) |
| `/v1/activate` | its "activate" route (instance / domain / machine id = our hash list) |
| `/v1/deactivate` | its "deactivate" route |
| `seat_limit` | its "activation limit reached" error |
| revoke / reset | disabling the key / clearing activations in its admin screen |

What such plugins typically do **not** do is return an Ed25519-signed `apc-license/1.0`. Two ways to bridge that:
(1) a small glue endpoint on your server (in the language of your site) that calls the manager's activation, then builds the license, canonicalises it as `apc-canon/1`
(sorted keys, no whitespace, integers only - rules in `ApcCanonicalJson.h`) and signs it with the private key; (2) a signer that only holds the private key, called by the glue code.
Keep the private key **out of the web root and out of the database** (environment secret, secrets manager or a separate signing service): if your website is compromised, an attacker with the key can mint licenses.
Whatever you write, **test it with this repository**: take a license your endpoint returned and run `apc license verify it.lic --pubkey <b64> --product <slug> --machine-components <the hashes you sent>`.
A mismatch in canonicalisation shows up there as `signature does not match`; the golden vectors are `test/fixtures/release/canonical-vectors.json` and `test/fixtures/license/golden.json`.
Which language-level Ed25519 calls your platform offers (for example PHP's bundled libsodium) is for you to confirm; none of that was exercised in this repository.

*Hosted licensing services:* if you use one, its response is not an `apc-license/1.0` file. Either use method A and issue the file from its webhook, or treat the service as the activation
authority and have your own thin endpoint translate. Features, limits and pricing change; **check each vendor's current documentation** before deciding.

**Before you put an issuer on the internet:**

- HTTPS only (terminate TLS at a reverse proxy or your host). The reference issuer deliberately has no TLS.
- Rate limiting that understands your proxy (the reference one keys on the socket address), logging without keys or full serials, backups of the database, a revocation path.
- Store keys hashed (the reference does); never log the request body.
- Treat the server as untrusted *by the plugin* and the plugin as untrusted *by the server*: the plugin re-verifies every license, the server re-validates every field.

## 7. Pointers only (no code in APC)

- **PACE iLok / hardware dongles:** heavy integration (vendor SDK, wrapping step), vendor fees, and the support burden of lost or broken keys; customers often dislike them. If you need it, follow the vendor's documentation; APC does not wire it in.
- **Third-party licensing SDKs and services** (for example LicenseSpring, Cryptlex, Keygen, LicenseSeat, Keylight): APC makes no claims about their features, pricing or audio-plugin suitability - **check the vendor docs**. If you adopt one, set `license.method = third-party`, keep the gates and states from `ApcLicense.h`, and have the vendor's check produce the same answer the manager expects, or replace the verifier behind `ISignatureVerifier`.
- **`license.protection = hardened`:** external binary wrappers or protectors. A pointer, not a feature: expect higher support cost and false positives (a protected plugin that a DAW's sandbox flags is a worse outcome than a cracked one).

## 8. Protection depth (decision L-06): `minimal`, honestly

`minimal` = signed license + machine binding (k-of-n) + in-app deactivation + trial rollback guard. That is all APC builds in.

- A signed license proves *you* issued it. It does **not** stop someone copying the file to another machine that matches, or patching the plugin to skip the check.
- Machine binding makes casual sharing awkward; it is not a lock. Seats in method A are not enforced at all.
- The trial guard stops editing a date; deleting the trial record restarts the trial. The HMAC key is inside the binary.
- Some pirated copies will exist. Spend your effort on a good demo, a fair price, painless re-activation and updates - those win more sales than friction does.

## 9. Privacy (GDPR and similar)

- The plugin sends **salted hashes** of up to a few hardware properties (never raw serial numbers, MAC addresses or names), plus the key the customer typed, plugin version and product - and only when the user presses *Activate* (no telemetry, decision L-08).
- The issuer stores: key hash, customer name/e-mail/order (you already have these in your shop), machine hashes, timestamps, plugin version. The license file itself contains name, e-mail and order id; tell customers that the file is personal data and not to post it publicly.
- **Disclose it in your privacy policy** (what is sent, why, how long it is kept, how to delete a machine/record). You are the controller; this guide is not legal advice.
- Do not add other fields "while you are at it".

## 10. Plugin checklist: what the generated plugin must do

- [ ] Embed the **license** public key (not the update key); implement `ISignatureVerifier` with a vetted Ed25519 library; unit-test it with `test/fixtures/license/golden.json` data (valid, tampered).
- [ ] `LicenseConfig.product` equals the `--product` slug used when issuing.
- [ ] **Verify on the message thread (or a worker), never in `processBlock`:** `evaluateFile()` at processor init / editor open, `activateFromText()` after activation. They do crypto and file I/O.
- [ ] **One atomic read in `processBlock`:** `state()` / `isAllowed()` / `isLicensedRT()` only. No parsing, no locks, no allocation, no network.
- [ ] **Gate only** preset *save*, pack *export* and pack *install* (`Verb::PresetSave`, `PackExport`, `PackInstall`) - in the UI action and the file-I/O function. Never in the DSP graph; audio output must be bit-identical in DEMO and LICENSED (`apc audio` null gate).
- [ ] **Never break DAW recall:** loading a project/session, loading an existing preset, and plugin state restore work in every state (DEMO, TRIAL, UNVERIFIED, expired). Show the banner (`status().message`); do not block, silence or crash.
- [ ] UNVERIFIED and DEMO texts offer the way out: *Activate*, *Load license file...*, *Contact support*.
- [ ] Method B: network calls on a worker thread with timeouts, HTTPS, no retry storms; every failure maps to a message and to the offline path; store the typed serial for deactivation; deactivate calls `/v1/deactivate` then `LicenseManager::deactivate()`.
- [ ] Offer *Copy machine info* (method A binding) and the request code (method B offline); display the `machineFingerprint()` hashes only, never raw values.
- [ ] Machine components: read-only, non-elevated, no personal data; at least 3 independent components so k-of-n (default 2) tolerates a hardware swap.
- [ ] Store `license.lic` and the trial record in the per-user app-data root (not next to the binary, not in `settings.json`).
- [ ] No telemetry, no background checks, no "phone home on start" (L-08).
- [ ] Privacy-policy text lists exactly what Activate sends.

## 11. What was verified, and what was not

Verified by tests in this repository (`test/license.test.js`, `test/apc-cpp-license.test.js`, `test/apc-cpp-release.test.js`): key generation, issue/verify round trip, tamper and wrong-key rejection,
wrong product, expiry, 2-of-3 vs 1-of-3 machine match, canonical bytes against hand-derived strings and committed golden licenses, the reference issuer (activate idempotence, seat limit,
deactivate, offline request/redeem, invalid serial, size cap, rate limit, restart persistence), and that `ApcLicense.h` (MSVC build) accepts licenses issued by the Node tool with a real Ed25519 verification.

**Not verified:** the plugin-side HTTPS client; any real Ed25519 adapter inside a plugin (libsodium / Monocypher / OpenSSL skeletons are uncompiled); platform machine-id readers; macOS/Linux builds of the C++ test;
integration with any WooCommerce-style plugin or hosted service (section 6 is mapping guidance, not a tested integration); TLS/production hardening of the issuer; behaviour inside a DAW.
