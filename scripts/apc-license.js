'use strict';

/**
 * apc-license - developer-side tooling for APC licensing (`apc-license/1.0`).
 *
 * The plugin side is ONE design: it verifies a signed apc-license/1.0 file (common/apc/ApcLicense.h).
 * The two built-in methods differ only in HOW that file is produced:
 *   A  signed-file        you run `issue` per customer and send the .lic (no server, seats not enforceable)
 *   B  online-activation  a server counts machines per key and returns the signed .lic
 *                         (`serve` is a zero-dependency REFERENCE issuer for development/testing;
 *                          production issuers are your own server, see .agents/guides/licensing-methods.md)
 *
 *   license keygen   --out <dir> [--product slug]
 *   license issue    --key <pem> --product <slug> --name N --email E --order ID --out file.lic
 *                    [--type commercial_perpetual|subscription|trial|nfr] [--seats N] [--expires ISO]
 *                    [--machine-components h1,h2,h3 --min-match K] [--force]
 *   license verify   <file.lic> --pubkey <pem|b64|file> [--product slug] [--machine-components h1,h2,..] [--now ISO]
 *   license inspect  <file.lic> [--pubkey <pem|b64|file>]
 *   license serial   --db <file.json> --product <slug> [--seats N] [--email E] [--name N] [--order ID]
 *                    [--type T] [--expires ISO] | --list | --revoke <serial> | --restore <serial> | --reset <serial>
 *   license serve    --db <file.json> --key <pem> --product <slug> [--seats N] [--min-match K]
 *                    [--port P] [--host H --allow-remote]
 *   license request-code  --product slug --serial S --machine-components h1,h2,h3 [--plugin-version V]
 *                    | --decode <code>               (builds / decodes the offline request code)
 *
 * Every subcommand accepts --json. Exit codes: 0 ok, 1 failure (verification failed, refused to overwrite,
 * ...), 2 usage error. Private keys are never printed. All signing is over apc-canon/1 canonical JSON of the
 * license WITHOUT its signature member, byte-identical with common/apc/ApcCanonicalJson.h (this file reuses
 * the helpers in scripts/apc-release.js; golden vectors: test/fixtures/release/canonical-vectors.json).
 *
 * HONESTY: a signed license proves YOU issued it. It does not stop copying. Machine binding is friction for
 * honest users, not DRM. See .agents/guides/licensing-methods.md.
 *
 * Zero dependencies, Node 18+.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const release = require('./apc-release.js');

const SCHEMA = 'apc-license/1.0';
const LICENSE_TYPES = ['commercial_perpetual', 'subscription', 'trial', 'nfr'];
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const HEX16 = /^[0-9a-f]{16}$/;
const FIELD_ORDER = ['schema', 'product', 'customer_name', 'customer_email', 'order_id', 'issued_at', 'expires_at',
  'license_type', 'allowed_seats', 'machine_components', 'machine_min_match', 'signature_ed25519'];
const KEY_FILES = {
  private: 'apc-license-private.pem',
  public: 'apc-license-public.pem',
  b64: 'apc-license-public.b64',
  inc: 'apc-license-public-key.inc',
};

class UsageError extends Error {}
class Fail extends Error {}

// --------------------------------------------------------------------------
// Dates, machine hashes
// --------------------------------------------------------------------------

/** "YYYY-MM-DDTHH:MM:SSZ" -> unix seconds, or null when malformed / not a real calendar date. */
function parseIso(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  // Date.parse rolls 2023-02-31 over to March: reject that the same way ApcLicense.h does
  if (d.toISOString().slice(0, 19) + 'Z' !== s) return null;
  return Math.floor(ms / 1000);
}

function toIso(unixSeconds) { return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** Same bytes as machineComponentHash() in ApcLicense.h: hex of the first 8 bytes of SHA-256. */
function machineComponentHash(product, label, value) {
  return crypto.createHash('sha256').update(`apc-machine/1\0${product}\0${label}\0${value}`, 'utf8').digest('hex').slice(0, 16);
}

/** Number of DISTINCT license components that the current machine also produces. */
function machineMatchCount(licenseComps, machine) {
  const have = new Set(machine);
  return [...new Set(licenseComps)].filter((c) => have.has(c)).length;
}

/** k-of-n rule of ApcLicense.h: required is clamped to [1, n]; no components = unbound = true. */
function machineMatches(licenseComps, machine, required) {
  const lic = [...new Set(licenseComps)];
  if (lic.length === 0) return true;
  const k = Math.min(Math.max(required < 1 ? 1 : required, 1), lic.length);
  return machineMatchCount(lic, machine) >= k;
}

// --------------------------------------------------------------------------
// Payload validation (mirrors schemas/apc-license.schema.json and the checks in ApcLicense.h)
// --------------------------------------------------------------------------

/**
 * @param {object} doc
 * @param {{requireSignature?:boolean}} [opts]
 * @returns {string[]} problems (empty = valid)
 */
function validateLicense(doc, opts) {
  const requireSignature = !opts || opts.requireSignature !== false;
  const e = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['license must be a JSON object'];
  const allowed = new Set(FIELD_ORDER);
  for (const k of Object.keys(doc)) if (!allowed.has(k)) e.push(`unknown member "${k}"`);
  const required = FIELD_ORDER.filter((k) => k !== 'machine_components' && k !== 'machine_min_match' && (k !== 'signature_ed25519' || requireSignature));
  for (const k of required) if (!(k in doc)) e.push(`missing member "${k}"`);
  if ('schema' in doc && doc.schema !== SCHEMA) e.push(`schema must be "${SCHEMA}"`);
  const str = (k, max, min) => {
    if (!(k in doc)) return;
    if (typeof doc[k] !== 'string') e.push(`${k} must be a string`);
    else if (doc[k].length > max) e.push(`${k} is longer than ${max} characters`);
    else if (min && doc[k].length < min) e.push(`${k} must not be empty`);
  };
  str('product', 64, 1); str('customer_name', 256); str('customer_email', 320); str('order_id', 128);
  if (typeof doc.product === 'string' && doc.product && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(doc.product)) e.push('product may only contain letters, digits, ".", "_" and "-"');
  if ('issued_at' in doc && parseIso(doc.issued_at) === null) e.push('issued_at must be a real UTC date "YYYY-MM-DDTHH:MM:SSZ"');
  if ('expires_at' in doc && doc.expires_at !== null && parseIso(doc.expires_at) === null) e.push('expires_at must be null or a real UTC date "YYYY-MM-DDTHH:MM:SSZ"');
  if ('license_type' in doc && !LICENSE_TYPES.includes(doc.license_type)) e.push(`license_type must be one of ${LICENSE_TYPES.join(', ')}`);
  if ('allowed_seats' in doc && !(Number.isInteger(doc.allowed_seats) && doc.allowed_seats >= 1 && doc.allowed_seats <= 9999)) e.push('allowed_seats must be an integer 1..9999');
  let n = 0;
  if ('machine_components' in doc) {
    const c = doc.machine_components;
    if (!Array.isArray(c) || c.length < 1 || c.length > 16) e.push('machine_components must be an array of 1..16 items');
    else {
      n = c.length;
      if (!c.every((x) => typeof x === 'string' && HEX16.test(x))) e.push('machine_components items must be 16 lowercase hex characters');
      if (new Set(c).size !== c.length) e.push('machine_components must be unique');
    }
  }
  if ('machine_min_match' in doc) {
    if (!('machine_components' in doc)) e.push('machine_min_match requires machine_components');
    if (!(Number.isInteger(doc.machine_min_match) && doc.machine_min_match >= 1 && doc.machine_min_match <= 16)) e.push('machine_min_match must be an integer 1..16');
    else if (n && doc.machine_min_match > n) e.push('machine_min_match must not exceed the number of machine_components');
  }
  if ('signature_ed25519' in doc) {
    const s = doc.signature_ed25519;
    if (typeof s !== 'string') e.push('signature_ed25519 must be a string');
    else if (Buffer.from(s, 'base64').length !== 64 || Buffer.from(s, 'base64').toString('base64') !== s) e.push('signature_ed25519 must be base64 of exactly 64 bytes');
  }
  return e;
}

// --------------------------------------------------------------------------
// Build / sign / serialise / verify
// --------------------------------------------------------------------------

function orderDoc(doc) {
  const out = {};
  for (const k of FIELD_ORDER) if (k in doc) out[k] = doc[k];
  return out;
}

/** Text written to disk: readable JSON; signing is over canonical JSON so whitespace is irrelevant. */
function licenseText(doc) { return JSON.stringify(orderDoc(doc), null, 2) + '\n'; }

/**
 * Builds, validates and signs a license.
 * @param {object} f  {product, customer_name, customer_email, order_id, license_type, expires_at, allowed_seats,
 *                     machine_components?, machine_min_match?}
 * @param {import('crypto').KeyObject} privateKey  Ed25519 LICENSE key
 * @param {string} [issuedAt] defaults to now
 * @returns {object} the signed license object
 */
function signLicense(f, privateKey, issuedAt) {
  const doc = {
    schema: SCHEMA, product: f.product, customer_name: f.customer_name, customer_email: f.customer_email, order_id: f.order_id,
    issued_at: issuedAt || toIso(Math.floor(Date.now() / 1000)),
    expires_at: f.expires_at === undefined ? null : f.expires_at,
    license_type: f.license_type || 'commercial_perpetual', allowed_seats: f.allowed_seats === undefined ? 3 : f.allowed_seats,
  };
  if (f.machine_components && f.machine_components.length) {
    doc.machine_components = f.machine_components.slice();
    if (f.machine_min_match !== undefined) doc.machine_min_match = f.machine_min_match;
  }
  const problems = validateLicense(doc, { requireSignature: false });
  if (problems.length) throw new Fail(`license is not valid: ${problems.join('; ')}`);
  try {
    doc.signature_ed25519 = crypto.sign(null, release.canonicalBytes(doc), privateKey).toString('base64');
  } catch (e) { throw new Fail(`cannot sign: ${e.message}`); }
  return orderDoc(doc);
}

/** Reads + strictly parses a license file (BOM allowed, no duplicate keys, integers only). */
function readLicenseFile(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new Fail(`cannot read ${file}: ${e.message}`); }
  if (buf.length > 256 * 1024) throw new Fail(`${file} is larger than 256 KiB: not a license file`);
  let text;
  try { text = release.decodeUtf8(buf); } catch { throw new Fail(`${file} is not valid UTF-8`); }
  try { return release.parseStrict(text); } catch (e) { throw new Fail(`${file}: ${e.message}`); }
}

function signatureValid(doc, publicKey) {
  if (typeof doc.signature_ed25519 !== 'string') return false;
  const sig = Buffer.from(doc.signature_ed25519, 'base64');
  if (sig.length !== 64 || sig.toString('base64') !== doc.signature_ed25519) return false;
  try { return crypto.verify(null, release.canonicalBytesWithout(doc, 'signature_ed25519'), publicKey, sig); } catch { return false; }
}

/**
 * Same decision order as LicenseManager::assessLicenseText.
 * @returns {{state:'LICENSED'|'TRIAL'|'DEMO'|'UNVERIFIED', ok:boolean, checks:object[]}}
 */
function verifyLicense(doc, publicKey, opts) {
  const o = opts || {};
  const checks = [];
  const add = (name, ok, detail, skipped) => checks.push({ name, ok, skipped: !!skipped, detail: detail || '' });
  const done = (state) => ({ state, ok: state === 'LICENSED' || state === 'TRIAL', checks });

  const problems = doc && typeof doc === 'object' ? validateLicense(doc) : ['not an object'];
  add('format', problems.length === 0, problems.join('; ') || SCHEMA);
  if (!doc || doc.schema !== SCHEMA) return done('UNVERIFIED');
  const sigOk = signatureValid(doc, publicKey);
  add('signature', sigOk, sigOk ? 'Ed25519 over canonical JSON' : 'signature does not match (tampered, wrong key, or unsigned)');
  if (!sigOk) return done('UNVERIFIED');
  if (problems.length) return done('UNVERIFIED');
  if (o.product) {
    const ok = doc.product === o.product;
    add('product', ok, ok ? doc.product : `license is for "${doc.product}", expected "${o.product}"`);
    if (!ok) return done('UNVERIFIED');
  } else add('product', true, `${doc.product} (not checked: no --product given)`, true);
  const now = o.now !== undefined ? o.now : Math.floor(Date.now() / 1000);
  if (doc.expires_at !== null) {
    const exp = parseIso(doc.expires_at);
    const ok = now < exp;
    add('expiry', ok, ok ? `valid until ${doc.expires_at}` : `expired ${doc.expires_at}`);
    if (!ok) return done('DEMO');
  } else add('expiry', true, 'does not expire');
  const comps = doc.machine_components || [];
  if (!comps.length) add('machine', true, 'unbound license (no machine_components)', true);
  else if (!o.machine) add('machine', true, `bound to ${comps.length} component(s); not checked: no --machine-components given`, true);
  else {
    const k = doc.machine_min_match || 2;
    const need = Math.min(Math.max(k, 1), new Set(comps).size);
    const have = machineMatchCount(comps, o.machine);
    const ok = have >= need;
    add('machine', ok, `${have} of ${new Set(comps).size} components match, ${need} required`);
    if (!ok) return done('UNVERIFIED');
  }
  return done(doc.license_type === 'trial' ? 'TRIAL' : 'LICENSED');
}

// --------------------------------------------------------------------------
// Keys
// --------------------------------------------------------------------------

function pubFromPrivate(privateKey) { return crypto.createPublicKey(privateKey); }

function safeLoadPublic(arg) {
  try { return release.loadPublicKey(arg); } catch { return null; }
}

/** Warns when the license key is the same as the UPDATE key (they must be separate keys). */
function updateKeyWarnings(licensePublic, keyFile, updatePubArg) {
  const warnings = [];
  const mine = release.rawPublicKey(licensePublic);
  const candidates = [];
  if (updatePubArg) candidates.push(updatePubArg);
  if (keyFile) {
    const dir = path.dirname(path.resolve(keyFile));
    for (const f of ['apc-update-public.b64', 'apc-update-public.pem']) candidates.push(path.join(dir, f));
  }
  for (const c of candidates) {
    if (!fs.existsSync(c) && c !== updatePubArg) continue;
    const k = safeLoadPublic(c);
    if (k && release.rawPublicKey(k).equals(mine)) {
      warnings.push(`this LICENSE key is identical to the UPDATE key (${c}). Use two separate key pairs: whoever can sign updates must not be able to mint licenses, and vice versa`);
      break;
    }
  }
  return warnings;
}

// --------------------------------------------------------------------------
// CLI plumbing
// --------------------------------------------------------------------------

function parseArgs(args, valueFlags, boolFlags) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (boolFlags.includes(name)) flags[name] = true;
      else if (valueFlags.includes(name)) {
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new UsageError(`--${name} needs a value`);
        flags[name] = args[++i];
      } else throw new UsageError(`unknown option --${name}`);
    } else positional.push(a);
  }
  return { flags, positional };
}

function out(ctx) { return ctx.stdout || ((s) => process.stdout.write(s)); }
function errOut(ctx) { return ctx.stderr || ((s) => process.stderr.write(s)); }
function emit(ctx, json, obj, lines) {
  if (json) out(ctx)(JSON.stringify(obj, null, 2) + '\n');
  else out(ctx)(lines.join('\n') + '\n');
}

function intFlag(flags, name, min, max) {
  if (flags[name] === undefined) return undefined;
  if (!/^[0-9]+$/.test(flags[name])) throw new UsageError(`--${name} must be a whole number`);
  const n = Number(flags[name]);
  if (n < min || n > max) throw new UsageError(`--${name} must be between ${min} and ${max}`);
  return n;
}

function componentsFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  const list = flags[name].split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length || !list.every((x) => HEX16.test(x))) throw new UsageError(`--${name} must be a comma-separated list of 16-character lowercase hex component hashes`);
  if (new Set(list).size !== list.length) throw new UsageError(`--${name} contains duplicates`);
  if (list.length > 16) throw new UsageError(`--${name} accepts at most 16 components`);
  return list;
}

function isoFlag(flags, name) {
  if (flags[name] === undefined) return undefined;
  let v = flags[name];
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}\.[0-9]+Z$/.test(v)) v = v.replace(/\.[0-9]+Z$/, 'Z');
  if (parseIso(v) === null) throw new UsageError(`--${name} must be a real UTC date like 2027-10-23T14:30:00Z`);
  return v;
}

function requireFlags(flags, sub, names) {
  for (const n of names) if (flags[n] === undefined) throw new UsageError(`license ${sub} needs --${n}`);
}

// --------------------------------------------------------------------------
// Subcommands
// --------------------------------------------------------------------------

function cmdKeygen(args, ctx) {
  const { flags } = parseArgs(args, ['out', 'product'], ['json']);
  if (!flags.out) throw new UsageError('license keygen needs --out <dir>');
  const dir = path.resolve(flags.out);
  const files = Object.fromEntries(Object.entries(KEY_FILES).map(([k, v]) => [k, path.join(dir, v)]));
  const existing = Object.values(files).filter((f) => fs.existsSync(f));
  if (existing.length) throw new Fail(`refusing to overwrite existing key file(s): ${existing.join(', ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = release.rawPublicKey(publicKey);
  const b64 = raw.toString('base64');
  fs.writeFileSync(files.private, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(files.private, 0o600); } catch { /* not supported on this platform */ }
  fs.writeFileSync(files.public, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  fs.writeFileSync(files.b64, b64 + '\n', { flag: 'wx' });
  const bytes = [...raw].map((b) => '0x' + b.toString(16).padStart(2, '0'));
  const rows = []; for (let i = 0; i < 32; i += 8) rows.push('    ' + bytes.slice(i, i + 8).join(', '));
  fs.writeFileSync(files.inc,
    `// Generated by \`apc license keygen\`${flags.product ? ` for product "${flags.product}"` : ''}. LICENSE public key (Ed25519, 32 bytes). Public: safe to commit.\n` +
    '// NOT the update key: the plugin embeds two different keys, one per verifier.\n' +
    'static const unsigned char kApcLicensePublicKey[32] = {\n' + rows.join(',\n') + '\n};\n', { flag: 'wx' });

  const warnings = [];
  const root = ctx.root ? path.resolve(ctx.root) : null;
  if (root && (dir === root || dir.startsWith(root + path.sep))) warnings.push('the key directory is inside the repository: make sure the private key is git-ignored and NEVER committed');
  if (process.platform === 'win32') warnings.push('file mode 0600 is not enforced on Windows: keep the private key in a protected folder');
  warnings.push('this is a LICENSE key: keep it separate from the update key made by `apc release keygen`, and back the private key up offline (losing it means no new licenses can be issued for the embedded public key)');
  emit(ctx, flags.json, { ok: true, command: 'keygen', dir, product: flags.product || null, files, publicKeyBase64: b64, warnings },
    [`License signing key pair written to ${dir}`, `  private: ${files.private}  (KEEP SECRET, back it up offline, never commit)`,
      `  public : ${files.public}`, `  base64 : ${b64}   (raw 32 bytes, embed in the plugin)`, `  C++    : ${files.inc}`, ...warnings.map((w) => `  WARNING: ${w}`)]);
  return 0;
}

function loadKeyOrFail(file) {
  try { return release.loadPrivateKey(file); } catch (e) { throw new Fail(e.message); }
}

function cmdIssue(args, ctx) {
  const { flags } = parseArgs(args, ['key', 'product', 'name', 'email', 'order', 'type', 'seats', 'expires', 'machine-components', 'min-match', 'out', 'issued-at', 'update-pubkey'], ['json', 'force']);
  requireFlags(flags, 'issue', ['key', 'product', 'name', 'email', 'order', 'out']);
  const type = flags.type || 'commercial_perpetual';
  if (!LICENSE_TYPES.includes(type)) throw new UsageError(`--type must be one of ${LICENSE_TYPES.join(', ')}`);
  const seats = intFlag(flags, 'seats', 1, 9999);
  const expires = isoFlag(flags, 'expires');
  if ((type === 'subscription' || type === 'trial') && !expires) throw new UsageError(`--type ${type} needs --expires`);
  const comps = componentsFlag(flags, 'machine-components');
  const minMatch = intFlag(flags, 'min-match', 1, 16);
  if (minMatch !== undefined && !comps) throw new UsageError('--min-match needs --machine-components');
  if (minMatch !== undefined && comps && minMatch > comps.length) throw new UsageError(`--min-match (${minMatch}) exceeds the number of components (${comps.length})`);
  const outFile = path.resolve(flags.out);
  if (fs.existsSync(outFile) && !flags.force) throw new Fail(`refusing to overwrite ${outFile} (use --force)`);
  const key = loadKeyOrFail(flags.key);
  const warnings = updateKeyWarnings(pubFromPrivate(key), flags.key, flags['update-pubkey']);
  if (!comps) warnings.push('license is not machine-bound: it works on any machine, so it can be shared freely (fine for nfr/reviewers)');
  const doc = signLicense({
    product: flags.product, customer_name: flags.name, customer_email: flags.email, order_id: flags.order,
    license_type: type, allowed_seats: seats, expires_at: expires || null, machine_components: comps, machine_min_match: minMatch,
  }, key, isoFlag(flags, 'issued-at'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, licenseText(doc));
  fs.renameSync(tmp, outFile);
  emit(ctx, flags.json, { ok: true, command: 'issue', file: outFile, license: doc, warnings },
    [`Issued ${type} license for ${doc.customer_name} <${doc.customer_email}> (order ${doc.order_id}) -> ${outFile}`,
      `  product ${doc.product}, seats ${doc.allowed_seats}, expires ${doc.expires_at || 'never'}${doc.machine_components ? `, machine-bound ${doc.machine_min_match || 'default'}-of-${doc.machine_components.length}` : ''}`,
      ...warnings.map((w) => `  WARNING: ${w}`)]);
  return 0;
}

function parseNow(flags) {
  if (flags.now === undefined) return undefined;
  const t = parseIso(flags.now);
  if (t === null) throw new UsageError('--now must be a UTC date like 2027-10-23T14:30:00Z');
  return t;
}

function cmdVerify(args, ctx) {
  const { flags, positional } = parseArgs(args, ['pubkey', 'product', 'machine-components', 'now', 'update-pubkey'], ['json']);
  if (positional.length !== 1) throw new UsageError('license verify needs exactly one <file.lic>');
  requireFlags(flags, 'verify', ['pubkey']);
  const file = path.resolve(positional[0]);
  let pub;
  try { pub = release.loadPublicKey(flags.pubkey); } catch (e) { throw new Fail(e.message); }
  const machine = componentsFlag(flags, 'machine-components');
  const doc = readLicenseFile(file);
  const r = verifyLicense(doc, pub, { product: flags.product, machine, now: parseNow(flags) });
  const warnings = updateKeyWarnings(pub, null, flags['update-pubkey']);
  emit(ctx, flags.json, { ok: r.ok, command: 'verify', file, state: r.state, checks: r.checks, warnings },
    [`${r.ok ? 'OK' : 'FAILED'} (${r.state}): ${file}`,
      ...r.checks.map((c) => `  [${c.skipped ? 'skip' : (c.ok ? ' ok ' : 'FAIL')}] ${c.name}${c.detail ? ' - ' + c.detail : ''}`),
      ...warnings.map((w) => `  WARNING: ${w}`)]);
  return r.ok ? 0 : 1;
}

function cmdInspect(args, ctx) {
  const { flags, positional } = parseArgs(args, ['pubkey'], ['json']);
  if (positional.length !== 1) throw new UsageError('license inspect needs exactly one <file.lic>');
  const file = path.resolve(positional[0]);
  const doc = readLicenseFile(file);
  const problems = validateLicense(doc);
  let signature = 'not checked (no --pubkey: inspect shows what the file CLAIMS, not that it is genuine)';
  let sigOk = null;
  if (flags.pubkey) {
    let pub;
    try { pub = release.loadPublicKey(flags.pubkey); } catch (e) { throw new Fail(e.message); }
    sigOk = signatureValid(doc, pub);
    signature = sigOk ? 'valid' : 'INVALID';
  }
  const ok = problems.length === 0 && sigOk !== false;
  const lines = [`${file}`];
  for (const k of FIELD_ORDER) if (k in doc && k !== 'signature_ed25519') lines.push(`  ${k.padEnd(18)} ${JSON.stringify(doc[k])}`);
  lines.push(`  ${'signature'.padEnd(18)} ${signature}`);
  if (problems.length) lines.push(...problems.map((p) => `  PROBLEM: ${p}`));
  emit(ctx, flags.json, { ok, command: 'inspect', file, license: doc, problems, signature: sigOk === null ? 'unchecked' : (sigOk ? 'valid' : 'invalid') }, lines);
  return ok ? 0 : 1;
}

function cmdSerial(args, ctx) {
  const { flags } = parseArgs(args, ['db', 'product', 'seats', 'email', 'name', 'order', 'type', 'expires', 'revoke', 'restore', 'reset'], ['json', 'list']);
  requireFlags(flags, 'serial', ['db', 'product']);
  const issuer = require('./lib/license-issuer.js');
  const dbFile = path.resolve(flags.db);
  const wrap = (fn) => { try { return fn(); } catch (e) { throw new Fail(e.message); } };
  if (flags.list) {
    const rows = wrap(() => issuer.listSerials(dbFile, flags.product));
    emit(ctx, flags.json, { ok: true, command: 'serial', serials: rows },
      rows.length ? rows.map((r) => `${r.id}  ${r.status.padEnd(8)} ${r.seats_used}/${r.seats} seats  ${r.license_type}  ${r.customer_email}  ${r.order_id}`) : ['(no serials)']);
    return 0;
  }
  for (const action of ['revoke', 'restore', 'reset']) {
    if (flags[action] !== undefined) {
      const r = wrap(() => issuer.adminUpdate(dbFile, flags.product, flags[action], action));
      emit(ctx, flags.json, Object.assign({ command: 'serial', action }, r),
        [r.ok ? `${action}: ${r.id} is now ${r.status}, ${r.seats_used} seat(s) in use` : `${action}: no such serial`]);
      return r.ok ? 0 : 1;
    }
  }
  const type = flags.type || 'commercial_perpetual';
  if (!LICENSE_TYPES.includes(type)) throw new UsageError(`--type must be one of ${LICENSE_TYPES.join(', ')}`);
  const expires = isoFlag(flags, 'expires');
  if ((type === 'subscription' || type === 'trial') && !expires) throw new UsageError(`--type ${type} needs --expires`);
  const r = wrap(() => issuer.createSerial(dbFile, flags.product, {
    seats: intFlag(flags, 'seats', 1, 9999), email: flags.email, name: flags.name, order: flags.order, type, expires: expires || null,
  }));
  emit(ctx, flags.json, { ok: true, command: 'serial', serial: r.serial, id: r.id, seats: r.seats, db: dbFile },
    [`Serial: ${r.serial}`, `  seats ${r.seats}, id ${r.id}, stored hashed in ${dbFile}`,
      '  The serial is shown only now: send it to the customer. It cannot be recovered from the database.']);
  return 0;
}

function cmdRequestCode(args, ctx) {
  const { flags } = parseArgs(args, ['product', 'serial', 'machine-components', 'plugin-version', 'decode'], ['json']);
  const issuer = require('./lib/license-issuer.js');
  if (flags.decode !== undefined) {
    const d = issuer.decodeRequestCode(flags.decode);
    if (!d.ok) throw new Fail(d.message);
    emit(ctx, flags.json, { ok: true, command: 'request-code', request: d.value }, [JSON.stringify(d.value, null, 2)]);
    return 0;
  }
  requireFlags(flags, 'request-code', ['product', 'serial', 'machine-components']);
  const comps = componentsFlag(flags, 'machine-components');
  const code = issuer.encodeRequestCode({ product: flags.product, serial: flags.serial, machine_components: comps, plugin_version: flags['plugin-version'] });
  emit(ctx, flags.json, { ok: true, command: 'request-code', requestCode: code }, [code]);
  return 0;
}

function cmdServe(args, ctx) {
  const { flags } = parseArgs(args, ['db', 'key', 'product', 'seats', 'min-match', 'port', 'host', 'update-pubkey'], ['json', 'allow-remote']);
  requireFlags(flags, 'serve', ['db', 'key', 'product']);
  const issuer = require('./lib/license-issuer.js');
  const port = intFlag(flags, 'port', 0, 65535);
  const host = flags.host || '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!loopback && !flags['allow-remote']) throw new UsageError(`--host ${host} is not loopback: add --allow-remote if you really mean it (this reference issuer has no TLS)`);
  const defaultSeats = intFlag(flags, 'seats', 1, 9999);
  const key = loadKeyOrFail(flags.key);
  const warnings = updateKeyWarnings(pubFromPrivate(key), flags.key, flags['update-pubkey']);
  if (!loopback) warnings.push('listening on a non-loopback address WITHOUT TLS: put it behind an HTTPS reverse proxy; this is a reference issuer for development and testing');
  const dbFile = path.resolve(flags.db);
  const inst = issuer.createIssuer({
    dbFile, product: flags.product, privateKey: key, defaultSeats, minMatch: intFlag(flags, 'min-match', 1, 16),
    log: (m) => { if (!flags.json) errOut(ctx)(`${new Date().toISOString()} ${m}\n`); },
  });
  try { inst.db.load(); } catch (e) { throw new Fail(e.message); }
  return inst.listen(port === undefined ? 8787 : port, host).then((addr) => {
    const url = `http://${addr.address.includes(':') ? `[${addr.address}]` : addr.address}:${addr.port}`;
    emit(ctx, flags.json, { ok: true, command: 'serve', url, product: flags.product, db: dbFile, warnings },
      [`Reference license issuer for "${flags.product}" listening on ${url}  (development/testing only, no TLS)`, `  db: ${dbFile}`,
        ...warnings.map((w) => `  WARNING: ${w}`), '  Ctrl+C to stop.']);
    if (ctx.onListening) ctx.onListening(inst, addr);
    return new Promise((resolve) => {
      const stop = () => { inst.close().then(() => resolve(0)); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      if (ctx.signal) ctx.signal.addEventListener('abort', stop, { once: true });
    });
  }, (e) => { throw new Fail(`cannot listen on ${host}:${port}: ${e.message}`); });
}

const USAGE = [
  'Usage: apc license <subcommand> [options]   (all subcommands accept --json)',
  '  keygen  --out <dir> [--product slug]         new Ed25519 LICENSE key pair (refuses to overwrite; not the update key)',
  '  issue   --key <pem> --product <slug> --name N --email E --order ID --out file.lic',
  '          [--type commercial_perpetual|subscription|trial|nfr] [--seats N] [--expires ISO]',
  '          [--machine-components h1,h2,h3 --min-match K] [--force]      (method A: signed-file)',
  '  verify  <file.lic> --pubkey <pem|b64> [--product slug] [--machine-components h1,h2,..] [--now ISO]',
  '  inspect <file.lic> [--pubkey <pem|b64>]',
  '  serial  --db <file.json> --product <slug> [--seats N] [--email E] [--name N] [--order ID] [--type T] [--expires ISO]',
  '          | --list | --revoke <serial> | --restore <serial> | --reset <serial>',
  '  serve   --db <file.json> --key <pem> --product <slug> [--seats N] [--min-match K] [--port P]',
  '                                                method B REFERENCE issuer (loopback, no TLS, dev/test only)',
  '  request-code --product slug --serial S --machine-components h1,h2,h3 [--plugin-version V] | --decode <code>',
];

/**
 * @param {string[]} args  arguments after `license` (a leading "license" is tolerated)
 * @param {{root?:string, resolvePaths?:Function, pluginPath?:Function, readConfig?:Function, cmd?:any,
 *          stdout?:Function, stderr?:Function}} ctx
 * @returns {number|Promise<number>} exit code (a Promise only for `serve`, which runs until stopped)
 */
function run(args, ctx) {
  ctx = ctx || {};
  let a = Array.isArray(args) ? args.slice() : [];
  if (a[0] === 'license') a = a.slice(1);
  const sub = a[0];
  const rest = a.slice(1);
  const json = rest.includes('--json');
  const handleError = (e) => {
    const usage = e instanceof UsageError;
    // errors thrown by scripts/apc-release.js helpers (canonical JSON, key loading) are its own "Fail" class
    const failLike = e instanceof Fail || (e && e.constructor && e.constructor.name === 'Fail');
    if (!usage && !failLike) throw e;
    if (json) out(ctx)(JSON.stringify({ ok: false, error: e.message, usage }, null, 2) + '\n');
    else {
      errOut(ctx)(`error: ${e.message}\n`);
      if (usage) errOut(ctx)(USAGE.join('\n') + '\n');
    }
    return usage ? 2 : 1;
  };
  try {
    switch (sub) {
      case 'keygen': return cmdKeygen(rest, ctx);
      case 'issue': return cmdIssue(rest, ctx);
      case 'verify': return cmdVerify(rest, ctx);
      case 'inspect': return cmdInspect(rest, ctx);
      case 'serial': return cmdSerial(rest, ctx);
      case 'request-code': return cmdRequestCode(rest, ctx);
      case 'serve': return Promise.resolve(cmdServe(rest, ctx)).catch(handleError);
      case undefined: case 'help': case '--help':
        out(ctx)(USAGE.join('\n') + '\n');
        return sub === undefined ? 2 : 0;
      default: throw new UsageError(`unknown subcommand "${sub}"`);
    }
  } catch (e) {
    return handleError(e);
  }
}

module.exports = {
  run, USAGE, SCHEMA, LICENSE_TYPES, FIELD_ORDER,
  validateLicense, signLicense, licenseText, verifyLicense, readLicenseFile, signatureValid,
  machineComponentHash, machineMatchCount, machineMatches, parseIso, toIso,
};
