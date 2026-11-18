'use strict';
// apc license (scripts/apc-license.js + scripts/lib/license-issuer.js) test suite.
// Zero deps: node:test + node:assert (Node 18+).  Run: npm test  (== node --test test/)
// Everything runs in-process against temp directories and ephemeral loopback ports; the real repo is never touched.
// The C++ cross-check (ApcLicense.h verifies licenses issued by this tool) is test/apc-cpp-license.test.js and,
// in golden mode, test/apc-cpp-release.test.js (common/apc/tests/test_license_issued.cpp).

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const lic = require(path.join(REPO_ROOT, 'scripts', 'apc-license.js'));
const release = require(path.join(REPO_ROOT, 'scripts', 'apc-release.js'));
const issuerLib = require(path.join(REPO_ROOT, 'scripts', 'lib', 'license-issuer.js'));
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'license', 'golden.json'), 'utf8'));
const LICENSE_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'apc-license.schema.json'), 'utf8'));
const API_SCHEMA = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'apc-activation-api.schema.json'), 'utf8'));

const tmpDirs = [];
function tmp(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `apc-license-${prefix}-`)); tmpDirs.push(d); return d; }
after(() => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Runs lic.run in-process and captures stdout/stderr. */
function apc(args, ctx) {
  let stdout = ''; let stderr = '';
  const status = lic.run(args, Object.assign({ stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } }, ctx));
  return { status, stdout, stderr, json: () => JSON.parse(stdout) };
}

function keygen(dir) {
  const r = apc(['keygen', '--out', dir, '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return { dir, priv: path.join(dir, 'apc-license-private.pem'), pubPem: path.join(dir, 'apc-license-public.pem'), pubB64File: path.join(dir, 'apc-license-public.b64'), b64: r.json().publicKeyBase64 };
}

const H1 = 'aaaaaaaaaaaaaaaa'; const H2 = 'bbbbbbbbbbbbbbbb'; const H3 = 'cccccccccccccccc'; const H4 = 'dddddddddddddddd'; const H5 = 'eeeeeeeeeeeeeeee';

function issue(k, dir, extra, name) {
  const out = path.join(dir, name || 'customer.lic');
  const r = apc(['issue', '--key', k.priv, '--product', 'demo-synth', '--name', 'Ada Lovelace', '--email', 'ada@example.test', '--order', 'ORD-1', '--out', out, '--json', ...(extra || [])]);
  return { r, out };
}

// ---- tiny JSON-schema validator for the subset our schemas use (so the schema files are tested, not just parsed) ----
function schemaErrors(schema, value, root, at) {
  root = root || schema; at = at || '$';
  const e = [];
  if (schema.$ref) {
    let target;
    if (schema.$ref === 'apc-license.schema.json') target = LICENSE_SCHEMA;
    else if (schema.$ref.startsWith('#/$defs/')) target = root.$defs[schema.$ref.slice(8)];
    assert.ok(target, `unresolved $ref ${schema.$ref}`);
    return schemaErrors(target, value, target === LICENSE_SCHEMA ? LICENSE_SCHEMA : root, at);
  }
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.const !== undefined && value !== schema.const) e.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) e.push(`${at}: not in enum`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) { e.push(`${at}: type ${t} not in ${types}`); return e; }
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) e.push(`${at}: too short`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) e.push(`${at}: too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) e.push(`${at}: pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) e.push(`${at}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) e.push(`${at}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) e.push(`${at}: too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) e.push(`${at}: too many items`);
    if (schema.uniqueItems && new Set(value.map((x) => JSON.stringify(x))).size !== value.length) e.push(`${at}: items not unique`);
    if (schema.items) value.forEach((x, i) => e.push(...schemaErrors(schema.items, x, root, `${at}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) e.push(`${at}: missing ${k}`);
    for (const [k, deps] of Object.entries(schema.dependentRequired || {})) if (k in value) for (const d of deps) if (!(d in value)) e.push(`${at}: ${k} requires ${d}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && schema.properties[k]) e.push(...schemaErrors(schema.properties[k], v, root, `${at}.${k}`));
      else if (schema.additionalProperties === false) e.push(`${at}: unexpected member ${k}`);
    }
  }
  return e;
}
const apiErrors = (def, value) => schemaErrors({ $ref: `#/$defs/${def}` }, value, API_SCHEMA);

// ---------------------------------------------------------------------------------------------------------------
// keygen
// ---------------------------------------------------------------------------------------------------------------

test('keygen: writes a key pair + C++ include, never prints the private key, refuses to overwrite', () => {
  const dir = path.join(tmp('kg'), 'keys');
  const r = apc(['keygen', '--out', dir, '--product', 'demo-synth']);
  assert.equal(r.status, 0, r.stderr);
  for (const f of ['apc-license-private.pem', 'apc-license-public.pem', 'apc-license-public.b64', 'apc-license-public-key.inc']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const pem = fs.readFileSync(path.join(dir, 'apc-license-private.pem'), 'utf8');
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  assert.ok(body.length > 20);
  assert.ok(!r.stdout.includes(body) && !r.stderr.includes(body), 'private key material must never be printed');
  const b64 = fs.readFileSync(path.join(dir, 'apc-license-public.b64'), 'utf8').trim();
  assert.equal(Buffer.from(b64, 'base64').length, 32);
  assert.match(fs.readFileSync(path.join(dir, 'apc-license-public-key.inc'), 'utf8'), /kApcLicensePublicKey\[32\]/);
  assert.match(r.stdout, /LICENSE key/);
  const again = apc(['keygen', '--out', dir]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(dir, 'apc-license-private.pem'), 'utf8'), pem, 'existing private key untouched');
  assert.equal(apc(['keygen']).status, 2);
});

test('keygen: --json output has no private key and each run yields a different key', () => {
  const a = keygen(path.join(tmp('kg2'), 'a')); const b = keygen(path.join(tmp('kg3'), 'b'));
  assert.notEqual(a.b64, b.b64);
  const j = apc(['keygen', '--out', path.join(tmp('kg4'), 'c'), '--json']).stdout;
  assert.ok(!/PRIVATE KEY/.test(j));
});

test('a license key equal to the UPDATE key is warned about (issue, verify, serve use the same check)', () => {
  const dir = tmp('same');
  const k = keygen(path.join(dir, 'k'));
  fs.copyFileSync(k.pubB64File, path.join(dir, 'k', 'apc-update-public.b64'));   // pretend `apc release keygen` output lives next to it
  const { r } = issue(k, dir);
  assert.equal(r.status, 0);
  assert.ok(r.json().warnings.some((w) => /identical to the UPDATE key/.test(w)), r.stdout);
  // different key => no such warning
  const k2 = keygen(path.join(dir, 'k2'));
  fs.writeFileSync(path.join(dir, 'k2', 'apc-update-public.b64'), k.b64 + '\n');
  const r2 = issue(k2, dir, [], 'b.lic').r;
  assert.ok(!r2.json().warnings.some((w) => /UPDATE key/.test(w)));
  // explicit --update-pubkey on verify
  const v = apc(['verify', path.join(dir, 'customer.lic'), '--pubkey', k.b64, '--update-pubkey', k.pubPem, '--json']);
  assert.ok(v.json().warnings.some((w) => /identical to the UPDATE key/.test(w)));
});

// ---------------------------------------------------------------------------------------------------------------
// issue / verify / inspect
// ---------------------------------------------------------------------------------------------------------------

test('issue -> verify round trip (PEM and base64 public key), exit codes, schema-valid output', () => {
  const dir = tmp('rt'); const k = keygen(path.join(dir, 'k'));
  const { r, out } = issue(k, dir, ['--seats', '5']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.schema, 'apc-license/1.0');
  assert.equal(doc.allowed_seats, 5);
  assert.equal(doc.expires_at, null);
  assert.equal(doc.license_type, 'commercial_perpetual');
  assert.deepEqual(schemaErrors(LICENSE_SCHEMA, doc), []);
  assert.deepEqual(lic.validateLicense(doc), []);
  for (const pk of [k.b64, k.pubPem, k.pubB64File]) {
    const v = apc(['verify', out, '--pubkey', pk, '--product', 'demo-synth', '--json']);
    assert.equal(v.status, 0, v.stdout);
    assert.equal(v.json().state, 'LICENSED');
    assert.ok(v.json().checks.every((c) => c.ok));
  }
  const text = apc(['verify', out, '--pubkey', k.b64]);
  assert.match(text.stdout, /OK \(LICENSED\)/);
  assert.match(text.stdout, /skip\] product/, 'product not checked unless --product is given');
  const ins = apc(['inspect', out, '--pubkey', k.b64, '--json']);
  assert.equal(ins.status, 0);
  assert.equal(ins.json().signature, 'valid');
  assert.equal(apc(['inspect', out, '--json']).json().signature, 'unchecked');
  const wrong = keygen(path.join(dir, 'other'));
  assert.equal(apc(['verify', out, '--pubkey', wrong.b64]).status, 1);
  assert.equal(apc(['inspect', out, '--pubkey', wrong.b64, '--json']).json().signature, 'invalid');
});

test('issue refuses to overwrite without --force, and validates its inputs', () => {
  const dir = tmp('iv'); const k = keygen(path.join(dir, 'k'));
  const first = issue(k, dir);
  assert.equal(first.r.status, 0);
  const before = fs.readFileSync(first.out, 'utf8');
  const again = issue(k, dir);
  assert.equal(again.r.status, 1);
  assert.equal(fs.readFileSync(first.out, 'utf8'), before);
  assert.equal(issue(k, dir, ['--force']).r.status, 0);
  const bad = (extra) => issue(k, dir, extra, 'x.lic').r.status;
  assert.equal(bad(['--type', 'lifetime']), 2);
  assert.equal(bad(['--type', 'subscription']), 2, 'subscription needs an expiry');
  assert.equal(bad(['--type', 'trial']), 2, 'trial needs an expiry');
  assert.equal(bad(['--seats', '0']), 2);
  assert.equal(bad(['--seats', 'many']), 2);
  assert.equal(bad(['--expires', '2027-02-30T00:00:00Z']), 2, 'not a real date');
  assert.equal(bad(['--expires', 'tomorrow']), 2);
  assert.equal(bad(['--machine-components', 'zzzz']), 2);
  assert.equal(bad(['--machine-components', `${H1},${H1}`]), 2, 'duplicates');
  assert.equal(bad(['--min-match', '2']), 2, 'min-match needs components');
  assert.equal(bad(['--machine-components', `${H1},${H2}`, '--min-match', '3']), 2, 'min-match above n');
  assert.ok(!fs.existsSync(path.join(dir, 'x.lic')));
  assert.equal(apc(['issue', '--key', k.priv]).status, 2);
  assert.equal(apc(['issue', '--key', path.join(dir, 'nope.pem'), '--product', 'p', '--name', 'n', '--email', 'e', '--order', 'o', '--out', path.join(dir, 'y.lic')]).status, 1);
  // a public key is not a signing key
  assert.equal(apc(['issue', '--key', k.pubPem, '--product', 'p', '--name', 'n', '--email', 'e', '--order', 'o', '--out', path.join(dir, 'y.lic')]).status, 1);
});

test('tamper detection: editing any field breaks the signature', () => {
  const dir = tmp('tp'); const k = keygen(path.join(dir, 'k'));
  const { out } = issue(k, dir, ['--seats', '3', '--machine-components', `${H1},${H2},${H3}`]);
  const orig = fs.readFileSync(out, 'utf8');
  const edits = [
    ['"allowed_seats": 3', '"allowed_seats": 30'],
    ['"customer_name": "Ada Lovelace"', '"customer_name": "Eve"'],
    ['"expires_at": null', '"expires_at": "2099-01-01T00:00:00Z"'],
    ['"license_type": "commercial_perpetual"', '"license_type": "nfr"'],
    ['"product": "demo-synth"', '"product": "other-synth"'],
    [H1, H4],
  ];
  for (const [from, to] of edits) {
    assert.ok(orig.includes(from), from);
    const f = path.join(dir, 'tampered.lic');
    fs.writeFileSync(f, orig.replace(from, to));
    const v = apc(['verify', f, '--pubkey', k.b64, '--json']);
    assert.equal(v.status, 1, `${from} -> ${to}`);
    assert.equal(v.json().state, 'UNVERIFIED');
  }
  // formatting is NOT part of the signed bytes (canonical JSON): minified / re-indented file still verifies
  const compact = path.join(dir, 'compact.lic');
  fs.writeFileSync(compact, JSON.stringify(JSON.parse(orig)));
  assert.equal(apc(['verify', compact, '--pubkey', k.b64]).status, 0);
  // unsigned, truncated or garbage files fail cleanly (never throw)
  const unsigned = JSON.parse(orig); delete unsigned.signature_ed25519;
  fs.writeFileSync(path.join(dir, 'u.lic'), JSON.stringify(unsigned));
  assert.equal(apc(['verify', path.join(dir, 'u.lic'), '--pubkey', k.b64]).status, 1);
  fs.writeFileSync(path.join(dir, 'g.lic'), '{"schema": ');
  assert.equal(apc(['verify', path.join(dir, 'g.lic'), '--pubkey', k.b64]).status, 1);
  assert.equal(apc(['verify', path.join(dir, 'missing.lic'), '--pubkey', k.b64]).status, 1);
  const dup = orig.replace('"order_id"', '"product": "x",\n  "order_id"');   // duplicate member
  fs.writeFileSync(path.join(dir, 'd.lic'), dup);
  assert.equal(apc(['verify', path.join(dir, 'd.lic'), '--pubkey', k.b64]).status, 1);
  // flip one signature bit
  const sig = Buffer.from(JSON.parse(orig).signature_ed25519, 'base64'); sig[10] ^= 1;
  const flipped = JSON.parse(orig); flipped.signature_ed25519 = sig.toString('base64');
  fs.writeFileSync(path.join(dir, 'f.lic'), JSON.stringify(flipped));
  assert.equal(apc(['verify', path.join(dir, 'f.lic'), '--pubkey', k.b64]).status, 1);
});

test('wrong product and expiry decisions follow ApcLicense.h (UNVERIFIED / DEMO)', () => {
  const dir = tmp('pe'); const k = keygen(path.join(dir, 'k'));
  const { out } = issue(k, dir, ['--type', 'subscription', '--expires', '2027-06-01T00:00:00Z']);
  const v = (extra) => apc(['verify', out, '--pubkey', k.b64, '--json', ...extra]);
  assert.equal(v(['--product', 'demo-synth', '--now', '2027-01-01T00:00:00Z']).status, 0);
  const wrongProduct = v(['--product', 'another-product', '--now', '2027-01-01T00:00:00Z']);
  assert.equal(wrongProduct.status, 1);
  assert.equal(wrongProduct.json().state, 'UNVERIFIED');
  const expired = v(['--product', 'demo-synth', '--now', '2027-06-01T00:00:00Z']);   // now >= expires_at
  assert.equal(expired.status, 1);
  assert.equal(expired.json().state, 'DEMO');
  assert.equal(v(['--product', 'demo-synth', '--now', '2027-05-31T23:59:59Z']).status, 0);
  assert.equal(v(['--now', 'soon']).status, 2);
  // signed trial key
  const t = issue(k, dir, ['--type', 'trial', '--expires', '2027-02-01T00:00:00Z'], 't.lic').out;
  const tv = apc(['verify', t, '--pubkey', k.b64, '--now', '2027-01-01T00:00:00Z', '--json']);
  assert.equal(tv.status, 0);
  assert.equal(tv.json().state, 'TRIAL');
  assert.equal(apc(['verify', t, '--pubkey', k.b64, '--now', '2027-03-01T00:00:00Z', '--json']).json().state, 'DEMO');
});

test('k-of-n machine match: 2 of 3 passes, 1 of 3 fails, default k is 2, k is clamped, unbound passes', () => {
  const dir = tmp('kn'); const k = keygen(path.join(dir, 'k'));
  const { out } = issue(k, dir, ['--machine-components', `${H1},${H2},${H3}`, '--min-match', '2']);
  const v = (machine) => apc(['verify', out, '--pubkey', k.b64, '--machine-components', machine.join(','), '--json']);
  assert.equal(v([H1, H2, H3]).status, 0);
  assert.equal(v([H1, H2, H4]).status, 0, '2 of 3');
  assert.equal(v([H3, H5, H2]).status, 0, '2 of 3, any two');
  const one = v([H1, H4, H5]);
  assert.equal(one.status, 1, '1 of 3');
  assert.equal(one.json().state, 'UNVERIFIED');
  assert.match(one.json().checks.find((c) => c.name === 'machine').detail, /1 of 3 components match, 2 required/);
  assert.equal(v([H4, H5]).status, 1, 'none');
  // no --machine-components given: reported as skipped, not silently "ok"
  const skipped = apc(['verify', out, '--pubkey', k.b64, '--json']).json().checks.find((c) => c.name === 'machine');
  assert.ok(skipped.skipped);
  // min-match omitted => the plugin default (2); 3-of-3 when asked
  const noK = issue(k, dir, ['--machine-components', `${H1},${H2},${H3}`], 'nok.lic').out;
  assert.ok(!('machine_min_match' in JSON.parse(fs.readFileSync(noK, 'utf8'))));
  assert.equal(apc(['verify', noK, '--pubkey', k.b64, '--machine-components', `${H1},${H2},${H4}`]).status, 0);
  assert.equal(apc(['verify', noK, '--pubkey', k.b64, '--machine-components', `${H1},${H4},${H5}`]).status, 1);
  const all = issue(k, dir, ['--machine-components', `${H1},${H2},${H3}`, '--min-match', '3'], 'all.lic').out;
  assert.equal(apc(['verify', all, '--pubkey', k.b64, '--machine-components', `${H1},${H2},${H4}`]).status, 1);
  // one-component license: k clamps to n
  const single = issue(k, dir, ['--machine-components', H1], 'one.lic').out;
  assert.equal(apc(['verify', single, '--pubkey', k.b64, '--machine-components', H1]).status, 0);
  assert.equal(apc(['verify', single, '--pubkey', k.b64, '--machine-components', H2]).status, 1);
  // unbound license ignores the machine
  const unbound = issue(k, dir, [], 'unbound.lic').out;
  assert.equal(apc(['verify', unbound, '--pubkey', k.b64, '--machine-components', H5]).status, 0);
  // library helpers agree
  assert.equal(lic.machineMatches([H1, H2, H3], [H1, H2], 2), true);
  assert.equal(lic.machineMatches([H1, H2, H3], [H1], 2), false);
  assert.equal(lic.machineMatches([H1, H1, H2], [H1], 2), false, 'duplicates count once');
  assert.equal(lic.machineMatches([], [], 2), true);
  assert.equal(lic.machineMatches([H1], [H1], 5), true, 'k clamped to n');
});

// ---------------------------------------------------------------------------------------------------------------
// canonical bytes == golden / hand-derived / C++ fixture
// ---------------------------------------------------------------------------------------------------------------

test('canonical bytes of issued licenses are exactly the hand-derived apc-canon/1 strings', () => {
  const priv = release.privateKeyFromSeed(Buffer.from(GOLDEN.seed_hex, 'hex'));
  const unbound = lic.signLicense({ product: 'DemoSynth', customer_name: 'Ada', customer_email: 'ada@example.test', order_id: 'ORD-1', license_type: 'nfr', expires_at: null, allowed_seats: 3 }, priv, '2026-10-23T14:30:00Z');
  assert.equal(release.canonicalBytesWithout(unbound, 'signature_ed25519').toString('utf8'),
    '{"allowed_seats":3,"customer_email":"ada@example.test","customer_name":"Ada","expires_at":null,"issued_at":"2026-10-23T14:30:00Z","license_type":"nfr","order_id":"ORD-1","product":"DemoSynth","schema":"apc-license/1.0"}');
  const bound = lic.signLicense({ product: 'DemoSynth', customer_name: 'A"B', customer_email: 'e', order_id: 'o', license_type: 'commercial_perpetual', expires_at: '2027-01-01T00:00:00Z', allowed_seats: 2, machine_components: [H2, H1], machine_min_match: 2 }, priv, '2026-10-23T14:30:00Z');
  assert.equal(release.canonicalBytesWithout(bound, 'signature_ed25519').toString('utf8'),
    `{"allowed_seats":2,"customer_email":"e","customer_name":"A\\"B","expires_at":"2027-01-01T00:00:00Z","issued_at":"2026-10-23T14:30:00Z","license_type":"commercial_perpetual","machine_components":["${H2}","${H1}"],"machine_min_match":2,"order_id":"o","product":"DemoSynth","schema":"apc-license/1.0"}`);
  // the signature really covers those bytes
  const pub = crypto.createPublicKey(priv);
  assert.equal(crypto.verify(null, Buffer.from(release.canonicalBytesWithout(bound, 'signature_ed25519')), pub, Buffer.from(bound.signature_ed25519, 'base64')), true);
});

test('golden fixture (consumed by test_license_issued.cpp): signatures valid, canonical bytes match, regeneration is deterministic', () => {
  const pub = release.publicKeyFromRaw(Buffer.from(GOLDEN.public_key_b64, 'base64'));
  const priv = release.privateKeyFromSeed(Buffer.from(GOLDEN.seed_hex, 'hex'));
  assert.deepEqual(release.rawPublicKey(crypto.createPublicKey(priv)), Buffer.from(GOLDEN.public_key_b64, 'base64'));
  assert.ok(GOLDEN.cases.length >= 5);
  for (const c of GOLDEN.cases) {
    const doc = release.parseStrict(c.license_text);
    const canon = release.canonicalBytesWithout(doc, 'signature_ed25519');
    assert.equal(canon.toString('utf8'), c.canonical, c.name);
    assert.equal(doc.signature_ed25519, c.signature_b64, c.name);
    assert.equal(crypto.verify(null, canon, pub, Buffer.from(c.signature_b64, 'base64')), true, `${c.name}: Ed25519 signature over the canonical bytes`);
    assert.deepEqual(lic.validateLicense(doc), [], c.name);
    assert.deepEqual(schemaErrors(LICENSE_SCHEMA, doc), [], c.name);
    // re-signing the same payload reproduces the committed signature (Ed25519 is deterministic)
    const again = lic.signLicense(Object.fromEntries(Object.entries(doc).filter(([k]) => !['schema', 'issued_at', 'signature_ed25519'].includes(k))), priv, doc.issued_at);
    assert.equal(again.signature_ed25519, c.signature_b64, c.name);
    // the pretty-printed text stores the same bytes the tool writes
    assert.equal(lic.licenseText(doc), c.license_text, c.name);
  }
  for (const m of GOLDEN.machine) assert.equal(lic.machineComponentHash(GOLDEN.product, m.label, m.value), m.hash);
  // the nasty-characters case really contains quote, backslash, control chars, non-BMP, U+2028, DEL
  const nasty = JSON.parse(GOLDEN.cases[0].license_text).customer_name;
  for (const needle of ['"', '\\', '\t', '\u0001', '😀', ' ', '\u007f', 'ë']) assert.ok(nasty.includes(needle), JSON.stringify(needle));
});

// ---------------------------------------------------------------------------------------------------------------
// schema <-> validator agreement
// ---------------------------------------------------------------------------------------------------------------

test('schemas/apc-license.schema.json and validateLicense() agree on a corpus', () => {
  const good = JSON.parse(GOLDEN.cases[0].license_text);
  const goodUnbound = JSON.parse(GOLDEN.cases[1].license_text);
  const sigOnly = (d) => d;
  const mutations = {
    ok: (d) => sigOnly(d),
    'extra member': (d) => Object.assign(d, { extra: 1 }),
    'wrong schema': (d) => Object.assign(d, { schema: 'apc-license/2.0' }),
    'missing product': (d) => { delete d.product; return d; },
    'missing expires_at': (d) => { delete d.expires_at; return d; },
    'missing signature': (d) => { delete d.signature_ed25519; return d; },
    'bad type': (d) => Object.assign(d, { license_type: 'lifetime' }),
    'float seats': (d) => Object.assign(d, { allowed_seats: 3.5 }),
    'zero seats': (d) => Object.assign(d, { allowed_seats: 0 }),
    'string seats': (d) => Object.assign(d, { allowed_seats: '3' }),
    'bad issued_at': (d) => Object.assign(d, { issued_at: '2026-10-23 14:30:00' }),
    'offset date': (d) => Object.assign(d, { issued_at: '2026-10-23T14:30:00+00:00' }),
    'bad expires_at': (d) => Object.assign(d, { expires_at: 'never' }),
    'good expires_at': (d) => Object.assign(d, { expires_at: '2030-01-01T00:00:00Z' }),
    'upper-case component': (d) => Object.assign(d, { machine_components: ['AAAAAAAAAAAAAAAA'] }),
    'short component': (d) => Object.assign(d, { machine_components: ['abcd'] }),
    'dup components': (d) => Object.assign(d, { machine_components: [H1, H1] }),
    'empty components': (d) => Object.assign(d, { machine_components: [] }),
    'min_match without components': (d) => { delete d.machine_components; return Object.assign(d, { machine_min_match: 2 }); },
    'min_match zero': (d) => Object.assign(d, { machine_min_match: 0 }),
    'short signature': (d) => Object.assign(d, { signature_ed25519: 'AAAA' }),
    'empty product': (d) => Object.assign(d, { product: '' }),
    'product with space': (d) => Object.assign(d, { product: 'my synth' }),
    'null name': (d) => Object.assign(d, { customer_name: null }),
  };
  for (const base of [good, goodUnbound]) {
    for (const [name, fn] of Object.entries(mutations)) {
      const d = fn(JSON.parse(JSON.stringify(base)));
      const s = schemaErrors(LICENSE_SCHEMA, d).length > 0;
      const j = lic.validateLicense(d).length > 0;
      assert.equal(j, s, `${name}: validator=${j} schema=${s}`);
    }
  }
  // things the schema cannot express are rejected by the validator only
  const tooBig = JSON.parse(JSON.stringify(good)); tooBig.machine_min_match = 4;
  assert.ok(lic.validateLicense(tooBig).some((m) => /exceed/.test(m)));
  const badDay = JSON.parse(JSON.stringify(good)); badDay.issued_at = '2026-02-30T10:00:00Z';
  assert.ok(lic.validateLicense(badDay).length > 0);
  // every ApcLicense.h field is described, and nothing else
  assert.deepEqual(Object.keys(LICENSE_SCHEMA.properties).sort(), [...lic.FIELD_ORDER].sort());
});

// ---------------------------------------------------------------------------------------------------------------
// serials
// ---------------------------------------------------------------------------------------------------------------

test('serials: format, check character, normalisation, hashed storage, uniqueness', () => {
  const dir = tmp('sr'); const db = path.join(dir, 'db.json');
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = issuerLib.generateSerial();
    assert.match(s, /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    assert.ok(issuerLib.isValidSerialFormat(s));
    assert.ok(!seen.has(s)); seen.add(s);
  }
  const s = issuerLib.generateSerial();
  assert.ok(issuerLib.isValidSerialFormat(s.toLowerCase().replace(/-/g, ' ')), 'case/space/hyphen tolerant');
  // every single-character substitution in the first 19 characters is caught by the check character
  const flat = s.replace(/-/g, '');
  const alphabet = issuerLib.SERIAL_ALPHABET;
  for (let i = 0; i < 19; i++) for (const c of alphabet) {
    if (c === flat[i]) continue;
    assert.ok(!issuerLib.isValidSerialFormat(flat.slice(0, i) + c + flat.slice(i + 1)), `substitution at ${i}`);
  }
  // adjacent transpositions of different characters (the other classic typo) are caught
  let transpositions = 0;
  for (let i = 0; i < 19; i++) {
    if (flat[i] === flat[i + 1]) continue;
    const t = flat.slice(0, i) + flat[i + 1] + flat[i] + flat.slice(i + 2);
    if (issuerLib.isValidSerialFormat(t)) continue;
    transpositions++;
  }
  assert.ok(transpositions >= 15, `luhn-mod-32 should catch most transpositions (caught ${transpositions}/18)`);
  assert.ok(!issuerLib.isValidSerialFormat(''));
  assert.ok(!issuerLib.isValidSerialFormat('x'.repeat(100)));
  // stored hashed, never in clear
  const created = issuerLib.createSerial(db, 'demo-synth', { seats: 4, email: 'a@b.test' });
  const raw = fs.readFileSync(db, 'utf8');
  assert.ok(!raw.includes(created.serial) && !raw.includes(created.serial.replace(/-/g, '')), 'serial must not be stored in clear');
  assert.ok(raw.includes(issuerLib.serialHash(created.serial)));
  assert.equal(issuerLib.maskSerial(created.serial).includes('*'), true);
  assert.throws(() => issuerLib.createSerial(db, 'demo-synth', { seats: 0 }));
  assert.throws(() => issuerLib.createSerial(db, 'other-product', {}), /belongs to product/);
});

test('serial CLI: create / list / revoke / reset', () => {
  const dir = tmp('sc'); const db = path.join(dir, 'db.json');
  const r = apc(['serial', '--db', db, '--product', 'demo-synth', '--seats', '3', '--email', 'a@b.test', '--order', 'W-1', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const serial = r.json().serial;
  assert.ok(issuerLib.isValidSerialFormat(serial));
  const ls = apc(['serial', '--db', db, '--product', 'demo-synth', '--list', '--json']).json().serials;
  assert.equal(ls.length, 1); assert.equal(ls[0].seats, 3); assert.equal(ls[0].status, 'active');
  assert.ok(!JSON.stringify(ls).includes(serial));
  assert.equal(apc(['serial', '--db', db, '--product', 'demo-synth', '--revoke', serial]).status, 0);
  assert.equal(apc(['serial', '--db', db, '--product', 'demo-synth', '--list', '--json']).json().serials[0].status, 'revoked');
  assert.equal(apc(['serial', '--db', db, '--product', 'demo-synth', '--restore', serial]).status, 0);
  assert.equal(apc(['serial', '--db', db, '--product', 'demo-synth', '--revoke', 'AAAAA-AAAAA-AAAAA-AAAAA']).status, 1);
  assert.equal(apc(['serial', '--db', db]).status, 2);
  assert.equal(apc(['serial', '--db', db, '--product', 'demo-synth', '--type', 'subscription']).status, 2);
});

// ---------------------------------------------------------------------------------------------------------------
// reference issuer over HTTP
// ---------------------------------------------------------------------------------------------------------------

function call(addr, method, p, body, headers, rawBody) {
  return new Promise((resolve, reject) => {
    const payload = rawBody !== undefined ? rawBody : (body === undefined ? null : Buffer.from(JSON.stringify(body)));
    const h = Object.assign({ Connection: 'close' }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}, headers);
    const req = http.request({ host: addr.address, port: addr.port, method, path: p, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startIssuer(opts) {
  const dir = (opts && opts.dir) || tmp('is');
  const keyDir = (opts && opts.keyDir) || path.join(dir, 'keys');
  const k = opts && opts.k ? opts.k : keygen(keyDir);
  const dbFile = path.join(dir, 'db.json');
  const priv = release.loadPrivateKey(k.priv);
  const issuer = issuerLib.createIssuer(Object.assign({ dbFile, product: 'demo-synth', privateKey: priv }, opts && opts.issuer));
  const addr = await issuer.listen(0);
  return { issuer, addr, k, dbFile, dir, close: () => issuer.close(), serial: (o) => issuerLib.createSerial(dbFile, 'demo-synth', o).serial };
}

const M1 = [H1, H2, H3]; const M2 = ['1111111111111111', '2222222222222222', '3333333333333333'];
const M3 = ['4444444444444444', '5555555555555555', '6666666666666666'];
const act = (S, serial, machine, extra) => call(S.addr, 'POST', '/v1/activate', Object.assign({ serial, machine_components: machine, product: 'demo-synth', plugin_version: '1.0.0' }, extra));

test('issuer: loopback bind, health, no CORS, content-type enforced, unknown routes, methods', async () => {
  const S = await startIssuer();
  try {
    assert.equal(S.addr.address, '127.0.0.1');
    const h = await call(S.addr, 'GET', '/v1/health', undefined, { Origin: 'https://evil.example' });
    assert.equal(h.status, 200);
    assert.deepEqual(apiErrors('healthResponse', h.json), []);
    for (const name of Object.keys(h.headers)) assert.ok(!name.toLowerCase().startsWith('access-control-'), `CORS header ${name}`);
    assert.equal(h.headers['cache-control'], 'no-store');
    const pre = await call(S.addr, 'OPTIONS', '/v1/activate', undefined, { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' });
    assert.equal(pre.status, 405);
    assert.ok(!Object.keys(pre.headers).some((n) => n.toLowerCase().startsWith('access-control-')));
    assert.equal((await call(S.addr, 'GET', '/v1/activate')).status, 405);
    assert.equal((await call(S.addr, 'GET', '/nope')).status, 404);
    assert.equal((await call(S.addr, 'POST', '/v1/health', {})).status, 405);
    const form = await call(S.addr, 'POST', '/v1/activate', undefined, { 'Content-Type': 'text/plain' }, Buffer.from('serial=x'));
    assert.equal(form.status, 415); assert.equal(form.json.error, 'unsupported_media_type');
    const notJson = await call(S.addr, 'POST', '/v1/activate', undefined, {}, Buffer.from('{oops'));
    assert.equal(notJson.status, 400); assert.equal(notJson.json.error, 'bad_request');
    assert.deepEqual(apiErrors('errorResponse', notJson.json), []);
    const arr = await call(S.addr, 'POST', '/v1/activate', [1]);
    assert.equal(arr.status, 400);
  } finally { await S.close(); }
});

test('issuer: activate returns a license that verifies; idempotent for the same machine; seat limit; deactivate frees', async () => {
  const S = await startIssuer();
  try {
    const serial = S.serial({ seats: 2, email: 'ada@example.test', name: 'Ada Lovelace', order: 'W-100' });
    const a = await act(S, serial, M1);
    assert.equal(a.status, 200, a.text);
    assert.deepEqual(apiErrors('licenseGranted', a.json), []);
    assert.equal(a.json.seats, 2); assert.equal(a.json.seats_used, 1); assert.equal(a.json.already_registered, false);
    const doc = a.json.license;
    assert.equal(doc.product, 'demo-synth'); assert.equal(doc.customer_name, 'Ada Lovelace'); assert.equal(doc.order_id, 'W-100');
    assert.equal(doc.allowed_seats, 2); assert.deepEqual(doc.machine_components, M1); assert.equal(doc.machine_min_match, 2);
    assert.deepEqual(lic.validateLicense(doc), []);
    assert.deepEqual(schemaErrors(LICENSE_SCHEMA, doc), []);
    // the response license_text is a file the CLI verifier accepts (end-to-end: server sign -> CLI verify)
    const f = path.join(S.dir, 'from-server.lic');
    fs.writeFileSync(f, a.json.license_text);
    const v = apc(['verify', f, '--pubkey', S.k.b64, '--product', 'demo-synth', '--machine-components', M1.join(','), '--json']);
    assert.equal(v.status, 0, v.stdout);
    assert.equal(apc(['verify', f, '--pubkey', S.k.b64, '--machine-components', M2.join(',')]).status, 1);
    assert.equal(apc(['verify', f, '--pubkey', keygen(path.join(S.dir, 'wrong')).b64]).status, 1);

    // idempotent: same machine again (also typed lower-case, without hyphens)
    const again = await act(S, serial.toLowerCase().replace(/-/g, ''), M1);
    assert.equal(again.status, 200);
    assert.equal(again.json.seats_used, 1); assert.equal(again.json.already_registered, true);
    // a machine with one swapped component is still the same seat (k-of-n), and its components are refreshed
    const drift = await act(S, serial, [H1, H2, H4]);
    assert.equal(drift.status, 200); assert.equal(drift.json.seats_used, 1); assert.equal(drift.json.already_registered, true);
    assert.deepEqual(drift.json.license.machine_components, [H1, H2, H4]);
    // second machine takes the second seat, third is refused
    const second = await act(S, serial, M2);
    assert.equal(second.status, 200); assert.equal(second.json.seats_used, 2);
    const third = await act(S, serial, M3);
    assert.equal(third.status, 409); assert.equal(third.json.error, 'seat_limit');
    assert.equal(third.json.seats, 2); assert.equal(third.json.seats_used, 2);
    assert.deepEqual(apiErrors('errorResponse', third.json), []);
    // the full key still re-issues to a registered machine
    assert.equal((await act(S, serial, M2)).status, 200);
    // deactivate frees a seat, is idempotent, and the third machine can then activate
    const d = await call(S.addr, 'POST', '/v1/deactivate', { serial, machine_components: M2 });
    assert.equal(d.status, 200); assert.equal(d.json.freed, true); assert.equal(d.json.seats_used, 1);
    assert.deepEqual(apiErrors('deactivateResponse', d.json), []);
    const d2 = await call(S.addr, 'POST', '/v1/deactivate', { serial, machine_components: M2 });
    assert.equal(d2.status, 200); assert.equal(d2.json.freed, false);
    assert.equal((await act(S, serial, M3)).status, 200);
    // another key is independent
    const other = S.serial({ seats: 1 });
    assert.equal((await act(S, other, M1)).status, 200);
  } finally { await S.close(); }
});

test('issuer: invalid serial / wrong email / product mismatch / revoked / bad bodies', async () => {
  const S = await startIssuer();
  try {
    const serial = S.serial({ seats: 1, email: 'ada@example.test' });
    const unknown = await act(S, issuerLib.generateSerial(), M1);
    assert.equal(unknown.status, 403); assert.equal(unknown.json.error, 'invalid_serial');
    assert.equal((await act(S, 'not-a-serial', M1)).json.error, 'invalid_serial');
    // a typo is rejected by the check character before any lookup, with the same answer as an unknown key
    const flat = serial.replace(/-/g, '');
    const typo = flat.slice(0, 3) + (flat[3] === 'A' ? 'B' : 'A') + flat.slice(4);
    assert.equal((await act(S, typo, M1)).json.error, 'invalid_serial');
    // email is a second factor when the record has one (case-insensitive)
    assert.equal((await act(S, serial, M1, { email: 'eve@example.test' })).json.error, 'invalid_serial');
    assert.equal((await act(S, serial, M1, { email: 'ADA@example.test' })).status, 200);
    const prod = await act(S, serial, M1, { product: 'other-product' });
    assert.equal(prod.status, 400); assert.equal(prod.json.error, 'product_mismatch');
    for (const bad of [
      { serial, machine_components: [], product: 'demo-synth' },
      { serial, machine_components: ['XYZ'], product: 'demo-synth' },
      { serial, machine_components: Array(17).fill(H1), product: 'demo-synth' },
      { serial, product: 'demo-synth' },
      { machine_components: M1, product: 'demo-synth' },
      { serial: 5, machine_components: M1, product: 'demo-synth' },
      { serial, machine_components: M1, product: 'demo-synth', email: 7 },
    ]) {
      const r = await call(S.addr, 'POST', '/v1/activate', bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.json.error, 'bad_request');
    }
    assert.equal((await call(S.addr, 'POST', '/v1/deactivate', { serial: issuerLib.generateSerial(), machine_components: M1 })).json.error, 'invalid_serial');
    // revoked keys cannot activate, but can still release their seats
    assert.equal(apc(['serial', '--db', S.dbFile, '--product', 'demo-synth', '--revoke', serial]).status, 0);
    const rev = await act(S, serial, M1);
    assert.equal(rev.status, 403); assert.equal(rev.json.error, 'revoked');
    assert.equal((await call(S.addr, 'POST', '/v1/deactivate', { serial, machine_components: M1 })).json.freed, true);
    // restoring it (CLI while the server runs: the db change is picked up) re-enables activation
    assert.equal(apc(['serial', '--db', S.dbFile, '--product', 'demo-synth', '--restore', serial]).status, 0);
    assert.equal((await act(S, serial, M1)).status, 200);
    // `serial --reset` frees every seat
    assert.equal(apc(['serial', '--db', S.dbFile, '--product', 'demo-synth', '--reset', serial]).status, 0);
    assert.equal((await act(S, serial, M2)).json.seats_used, 1);
  } finally { await S.close(); }
});

test('issuer: offline request code -> request (dry run) -> redeem returns the signed .lic', async () => {
  const S = await startIssuer();
  try {
    const serial = S.serial({ seats: 1, name: 'Ada', email: 'ada@example.test', order: 'W-7' });
    const code = issuerLib.encodeRequestCode({ product: 'demo-synth', serial, machine_components: M1, plugin_version: '1.2.3' });
    assert.match(code, /^[A-Za-z0-9_-]+$/, 'base64url, pasteable');
    const decoded = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(decoded).sort(), ['machine_components', 'plugin_version', 'product', 'serial', 'v']);
    assert.ok(!code.includes('CoolCPU'), 'only hashes travel');

    const req = await call(S.addr, 'POST', '/v1/offline/request', { request_code: code });
    assert.equal(req.status, 200, req.text);
    assert.deepEqual(apiErrors('offlineRequestResponse', req.json), []);
    assert.equal(req.json.seats_used, 0, 'request is a dry run: no seat consumed');
    assert.equal(req.json.machine_count, 3); assert.equal(req.json.already_registered, false);
    assert.ok(req.json.serial_hint.includes('*') && !req.json.serial_hint.includes(serial.slice(6, 11)));

    // whitespace/line breaks added by e-mail clients or the browser are tolerated
    const wrapped = code.replace(/(.{30})/g, '$1\n ');
    const red = await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: wrapped });
    assert.equal(red.status, 200, red.text);
    assert.deepEqual(apiErrors('licenseGranted', red.json), []);
    assert.equal(red.json.seats_used, 1); assert.equal(red.json.file_name, 'demo-synth.lic');
    const f = path.join(S.dir, 'offline.lic'); fs.writeFileSync(f, red.json.license_text);
    assert.equal(apc(['verify', f, '--pubkey', S.k.b64, '--product', 'demo-synth', '--machine-components', M1.join(',')]).status, 0);
    // redeeming again is idempotent
    const red2 = await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: code });
    assert.equal(red2.json.seats_used, 1); assert.equal(red2.json.already_registered, true);
    // a second machine is refused (1 seat); the dry run reports it too
    const code2 = issuerLib.encodeRequestCode({ product: 'demo-synth', serial, machine_components: M2, plugin_version: '1.2.3' });
    assert.equal((await call(S.addr, 'POST', '/v1/offline/request', { request_code: code2 })).json.error, 'seat_limit');
    assert.equal((await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: code2 })).status, 409);
    // plain (padded, standard-alphabet) base64 from a plugin that only has base64Encode() is accepted too
    const stdJson = JSON.stringify({ v: 1, product: 'demo-synth', serial, machine_components: M1, plugin_version: '>>>???~~~' });
    const std = Buffer.from(stdJson, 'utf8').toString('base64');
    assert.match(std, /[+/]/, 'fixture must exercise the standard alphabet');
    assert.equal((await call(S.addr, 'POST', '/v1/offline/request', { request_code: std })).status, 200);
    assert.equal((await call(S.addr, 'POST', '/v1/offline/request', { request_code: std + '==' })).status, 200, 'extra padding tolerated');
    // bad codes
    for (const bad of ['', '!!!', 'e30', Buffer.from('{"v":2}').toString('base64url'), Buffer.from('not json').toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, product: 'demo-synth', serial, machine_components: ['zz'] })).toString('base64url'), 'A'.repeat(5000)]) {
      const r = await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: bad });
      assert.equal(r.status, 400, bad.slice(0, 20));
      assert.equal(r.json.error, 'invalid_request_code');
    }
    const wrongProduct = issuerLib.encodeRequestCode({ product: 'other', serial, machine_components: M1 });
    assert.equal((await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: wrongProduct })).json.error, 'product_mismatch');
    const unknownSerial = issuerLib.encodeRequestCode({ product: 'demo-synth', serial: issuerLib.generateSerial(), machine_components: M1 });
    assert.equal((await call(S.addr, 'POST', '/v1/offline/redeem', { request_code: unknownSerial })).json.error, 'invalid_serial');
    // CLI builds/decodes the same format
    const cli = apc(['request-code', '--product', 'demo-synth', '--serial', serial, '--machine-components', M1.join(','), '--json']).json().requestCode;
    assert.equal(apc(['request-code', '--decode', cli, '--json']).json().request.serial, serial);
    assert.equal(apc(['request-code', '--decode', '%%%']).status, 1);
  } finally { await S.close(); }
});

test('issuer: request size cap (content-length and chunked) and malformed JSON', async () => {
  const S = await startIssuer({ issuer: { maxBodyBytes: 1024 } });
  try {
    const big = await call(S.addr, 'POST', '/v1/activate', undefined, {}, Buffer.from(JSON.stringify({ pad: 'x'.repeat(64 * 1024) })));
    assert.equal(big.status, 413); assert.equal(big.json.error, 'payload_too_large');
    assert.deepEqual(apiErrors('errorResponse', big.json), []);
    // chunked: no content-length to reject early on
    const chunked = await new Promise((resolve, reject) => {
      const req = http.request({ host: S.addr.address, port: S.addr.port, method: 'POST', path: '/v1/activate', agent: false, headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked', Connection: 'close' } }, (res) => {
        let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
      });
      req.on('error', reject);
      for (let i = 0; i < 8; i++) req.write('x'.repeat(512));
      req.end();
    });
    assert.equal(chunked.status, 413);
    // the issuer is still healthy
    assert.equal((await call(S.addr, 'GET', '/v1/health')).status, 200);
    // the default cap is 16 KiB
    assert.equal(issuerLib.DEFAULTS.maxBodyBytes, 16 * 1024);
  } finally { await S.close(); }
});

test('issuer: per-IP rate limit and failed-attempt limit (deterministic clock)', () => {
  let t = 1000000;
  const dir = tmp('rl'); const k = keygen(path.join(dir, 'k'));
  const issuer = issuerLib.createIssuer({ dbFile: path.join(dir, 'db.json'), product: 'demo-synth', privateKey: release.loadPrivateKey(k.priv), rateLimit: { max: 5, failures: 3, windowMs: 60000 }, now: () => t });
  const get = (ip) => issuer.handle('GET', '/v1/health', ip, undefined, Buffer.alloc(0));
  for (let i = 0; i < 5; i++) assert.equal(get('10.0.0.1').status, 200);
  assert.equal(get('10.0.0.1').status, 429);
  assert.equal(get('10.0.0.1').body.error, 'rate_limited');
  assert.equal(get('10.0.0.2').status, 200, 'other addresses are unaffected');
  t += 59999; assert.equal(get('10.0.0.1').status, 429);
  t += 2; assert.equal(get('10.0.0.1').status, 200, 'window elapsed');
  // failed serial attempts trip a stricter limit
  t += 120000;
  const body = Buffer.from(JSON.stringify({ serial: issuerLib.generateSerial(), machine_components: M1, product: 'demo-synth' }));
  const post = (ip) => issuer.handle('POST', '/v1/activate', ip, 'application/json', body);
  for (let i = 0; i < 3; i++) assert.equal(post('10.0.0.9').status, 403);
  assert.equal(post('10.0.0.9').status, 429, 'brute-forcing keys is throttled before the general limit');
  assert.equal(get('10.0.0.9').status, 429);
});

test('issuer: state survives a restart; writes are atomic (no temp files left), db holds no clear serials', async () => {
  const dir = tmp('ps'); const k = keygen(path.join(dir, 'k'));
  const S1 = await startIssuer({ dir, k });
  const serial = S1.serial({ seats: 2 });
  assert.equal((await act(S1, serial, M1)).json.seats_used, 1);
  assert.equal((await act(S1, serial, M2)).json.seats_used, 2);
  await S1.close();
  const files = fs.readdirSync(dir);
  assert.ok(!files.some((f) => f.includes('.tmp.')), `leftover temp files: ${files}`);
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes(serial.replace(/-/g, '')));
  assert.equal(JSON.parse(raw).schema, 'apc-issuer-db/1');

  const S2 = await startIssuer({ dir, k });
  try {
    const same = await act(S2, serial, M1);
    assert.equal(same.json.already_registered, true, 'machine 1 still registered after restart');
    assert.equal(same.json.seats_used, 2);
    assert.equal((await act(S2, serial, M3)).json.error, 'seat_limit', 'seat count persisted');
    assert.equal((await call(S2.addr, 'POST', '/v1/deactivate', { serial, machine_components: M2 })).json.freed, true);
  } finally { await S2.close(); }
  const S3 = await startIssuer({ dir, k });
  try { assert.equal((await act(S3, serial, M3)).status, 200, 'deactivation persisted'); } finally { await S3.close(); }
});

test('issuer: refuses a corrupt or foreign database instead of silently starting empty', async () => {
  const dir = tmp('bad'); const k = keygen(path.join(dir, 'k'));
  fs.writeFileSync(path.join(dir, 'db.json'), '{broken');
  const S = await startIssuer({ dir, k });
  try {
    const r = await act(S, issuerLib.generateSerial(), M1);
    assert.equal(r.status, 500); assert.equal(r.json.error, 'server_error');
    assert.ok(!r.text.includes(dir), 'internal paths are not leaked to clients');
  } finally { await S.close(); }
  const other = path.join(dir, 'other.json');
  issuerLib.createSerial(other, 'some-other-product', {});
  const iss = issuerLib.createIssuer({ dbFile: other, product: 'demo-synth', privateKey: release.loadPrivateKey(k.priv) });
  assert.equal(iss.handle('POST', '/v1/activate', '1.1.1.1', 'application/json', Buffer.from(JSON.stringify({ serial: issuerLib.generateSerial(), machine_components: M1, product: 'demo-synth' }))).status, 500);
});

test('API schema: every def referenced by x-bodies exists and rejects obviously wrong bodies', () => {
  for (const spec of Object.values(API_SCHEMA['x-bodies'])) for (const def of Object.values(spec)) assert.ok(API_SCHEMA.$defs[def], def);
  assert.ok(apiErrors('activateRequest', { serial: 's', product: 'p' }).length > 0);
  assert.ok(apiErrors('activateRequest', { serial: 's', product: 'p', machine_components: ['x'] }).length > 0);
  assert.deepEqual(apiErrors('activateRequest', { serial: 's', product: 'p', machine_components: [H1], email: 'e@x.test' }), []);
  assert.ok(apiErrors('errorResponse', { ok: false, error: 'teapot', message: 'm' }).length > 0);
  assert.ok(apiErrors('requestCodePayload', { v: 2, product: 'p', serial: 's', machine_components: [H1] }).length > 0);
  const payload = JSON.parse(Buffer.from(issuerLib.encodeRequestCode({ product: 'p', serial: 's', machine_components: [H1], plugin_version: '1' }), 'base64url').toString());
  assert.deepEqual(apiErrors('requestCodePayload', payload), []);
});

// ---------------------------------------------------------------------------------------------------------------
// `apc license serve` end to end (child process, ephemeral port)
// ---------------------------------------------------------------------------------------------------------------

test('serve: non-loopback needs --allow-remote; the CLI server starts, answers, warns on key reuse, stops', async () => {
  const dir = tmp('sv'); const k = keygen(path.join(dir, 'k'));
  const db = path.join(dir, 'db.json');
  assert.equal(apc(['serve', '--db', db, '--key', k.priv, '--product', 'demo-synth', '--host', '0.0.0.0']).status, 2);
  assert.equal(apc(['serve', '--db', db, '--key', path.join(dir, 'missing.pem'), '--product', 'demo-synth']).status, 1);
  fs.copyFileSync(k.pubB64File, path.join(dir, 'k', 'apc-update-public.b64'));   // same key as "update" key -> warning
  const serial = issuerLib.createSerial(db, 'demo-synth', { seats: 1 }).serial;
  const script = `process.exitCode=0;require(${JSON.stringify(path.join(REPO_ROOT, 'scripts', 'apc-license.js'))}).run(['serve','--db',${JSON.stringify(db)},'--key',${JSON.stringify(k.priv)},'--product','demo-synth','--port','0']).then(c=>process.exit(c));`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`serve did not start: ${stdout}${stderr}`)), 15000);
      const check = () => { const m = stdout.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/); if (m) { clearTimeout(timer); resolve(m[1]); } };
      child.stdout.on('data', check); child.on('exit', () => reject(new Error(`serve exited early: ${stdout}${stderr}`)));
    });
    assert.match(stdout, /WARNING: this LICENSE key is identical to the UPDATE key/);
    assert.ok(!stdout.includes('PRIVATE KEY') && !stderr.includes('PRIVATE KEY'));
    const u = new URL(url);
    const addr = { address: u.hostname, port: Number(u.port) };
    assert.equal((await call(addr, 'GET', '/v1/health')).status, 200);
    const a = await call(addr, 'POST', '/v1/activate', { serial, machine_components: M1, product: 'demo-synth' });
    assert.equal(a.status, 200, a.text);
    const f = path.join(dir, 'served.lic'); fs.writeFileSync(f, a.json.license_text);
    assert.equal(apc(['verify', f, '--pubkey', k.b64, '--product', 'demo-synth', '--machine-components', M1.join(',')]).status, 0);
  } finally { child.kill(); }
});
