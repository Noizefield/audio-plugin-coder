'use strict';
// apc release (scripts/apc-release.js) test suite. Zero deps: node:test + node:assert (Node 18+).
// Run: npm test  (== node --test test/)
// Everything runs in-process against temp directories; the real repo is never touched.
// Shares test/fixtures/release/canonical-vectors.json with the C++ tests in common/apc/tests/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const release = require(path.join(REPO_ROOT, 'scripts', 'apc-release.js'));
const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'release', 'canonical-vectors.json'), 'utf8'));

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `apc-release-${prefix}-`)); }

/** Runs release.run in-process and captures stdout/stderr. */
function apc(args, ctx) {
  let stdout = ''; let stderr = '';
  const status = release.run(args, Object.assign({
    stdout: (s) => { stdout += s; },
    stderr: (s) => { stderr += s; },
  }, ctx));
  return { status, stdout, stderr, json: () => JSON.parse(stdout) };
}

/** A fake repo root with release/<Plugin>/ and plugins/<Plugin>/status.json. */
function makeProject(name, version, files) {
  const root = tmp('proj');
  fs.mkdirSync(path.join(root, 'plugins', name), { recursive: true });
  // status.json with a UTF-8 BOM and a leading 'v' (as written by the PowerShell state scripts)
  fs.writeFileSync(path.join(root, 'plugins', name, 'status.json'), '﻿' + JSON.stringify({ plugin_name: name, version: `v${version}` }));
  const rel = path.join(root, 'release', name);
  fs.mkdirSync(rel, { recursive: true });
  for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(rel, f), content);
  const ctx = {
    root,
    resolvePaths: () => ({ root, releaseDir: path.join(root, 'release'), pluginsDir: path.join(root, 'plugins') }),
    pluginPath: (n) => path.join(root, 'plugins', n),
    readConfig: () => ({ paths: {} }),
  };
  return { root, rel, ctx };
}

function keygen(dir) {
  const r = apc(['keygen', '--out', dir, '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r.json();
}

// ---------------------------------------------------------------------------
// Golden vectors (shared with the C++ tests)
// ---------------------------------------------------------------------------

test('canonical JSON: golden vectors produce the exact expected bytes', () => {
  for (const v of VECTORS.vectors) {
    const got = release.canonicalize(release.parseStrict(v.input));
    assert.equal(got, v.canonical, `vector "${v.name}"`);
    assert.deepEqual(Buffer.from(got, 'utf8'), Buffer.from(v.canonical, 'utf8'), `bytes of "${v.name}"`);
  }
});

test('canonical JSON: reject vectors are refused by the strict parser', () => {
  for (const v of VECTORS.reject) {
    assert.throws(() => release.canonicalize(release.parseStrict(v.input)), `vector "${v.name}" must be rejected`);
  }
});

test('canonical JSON: refuses floats and unsafe integers when built programmatically', () => {
  assert.throws(() => release.canonicalize({ a: 1.5 }));
  assert.throws(() => release.canonicalize({ a: 2 ** 53 }));
  assert.throws(() => release.canonicalize({ a: -0 }));
  assert.throws(() => release.canonicalize({ a: undefined }));
});

test('fixtures: sha256 / hmac / base64 reference values agree with node:crypto', () => {
  for (const v of VECTORS.sha256) assert.equal(crypto.createHash('sha256').update(v.input).digest('hex'), v.hex);
  for (const v of VECTORS.hmac_sha256) assert.equal(crypto.createHmac('sha256', v.key).update(v.message).digest('hex'), v.hex);
  for (const v of VECTORS.base64) assert.equal(Buffer.from(v.input).toString('base64'), v.b64);
});

test('semver: ordering, equality and invalid inputs (shared with the C++ test)', () => {
  const parsed = VECTORS.semver_order.map((s) => release.parseSemver(s));
  parsed.forEach((p, i) => assert.ok(p, `${VECTORS.semver_order[i]} must parse`));
  for (let i = 0; i < parsed.length; i++) {
    for (let j = 0; j < parsed.length; j++) {
      const want = Math.sign(i - j);
      assert.equal(release.compareSemver(parsed[i], parsed[j]), want, `${VECTORS.semver_order[i]} vs ${VECTORS.semver_order[j]}`);
    }
  }
  for (const [a, b] of VECTORS.semver_equal) assert.equal(release.compareSemver(release.parseSemver(a), release.parseSemver(b)), 0, `${a} == ${b}`);
  for (const bad of VECTORS.semver_invalid) assert.equal(release.parseSemver(bad), null, `"${bad}" must be invalid`);
});

test('Ed25519: node reproduces the RFC 8032 test 1 key and signature', () => {
  const v = VECTORS.ed25519_rfc8032_test1;
  const key = release.privateKeyFromSeed(Buffer.from(v.seed_hex, 'hex'));
  const pub = release.rawPublicKey(crypto.createPublicKey(key));
  assert.equal(pub.toString('hex'), v.public_key_hex);
  assert.equal(crypto.sign(null, Buffer.alloc(0), key).toString('hex'), v.message_empty_signature_hex);
});

test('cross-check: `apc release sign` output is byte-identical to the golden canonical bytes and signature', () => {
  const s = VECTORS.signed;
  const dir = tmp('golden');
  const keyFile = path.join(dir, 'golden.pem');
  fs.writeFileSync(keyFile, release.privateKeyFromSeed(Buffer.from(s.seed_b64, 'base64')).export({ type: 'pkcs8', format: 'pem' }));
  const file = path.join(dir, 'm.json');
  fs.writeFileSync(file, JSON.stringify(s.document, null, 2));
  // canonical bytes of the document == the hand-derived string the C++ test also checks
  assert.equal(release.canonicalize(release.parseStrict(fs.readFileSync(file, 'utf8'))), s.canonical);
  assert.equal(apc(['sign', file, '--key', keyFile]).status, 0);
  const signed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(signed.signature, s.signature_b64, 'CLI signature must equal the golden signature');
  // and the golden public key verifies it, through the CLI
  assert.equal(apc(['verify', file, '--pubkey', s.public_key_b64]).status, 0);
  // the signed bytes exclude the signature member
  assert.equal(release.canonicalBytesWithout(signed, 'signature').toString('utf8'), s.canonical);
});

// ---------------------------------------------------------------------------
// keygen
// ---------------------------------------------------------------------------

test('keygen: writes PEM pair, raw base64 public key and a C++ include; refuses to overwrite', () => {
  const dir = path.join(tmp('kg'), 'keys');
  const info = keygen(dir);
  for (const f of ['apc-update-private.pem', 'apc-update-public.pem', 'apc-update-public.b64', 'apc-update-public-key.inc']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
  }
  const b64 = fs.readFileSync(path.join(dir, 'apc-update-public.b64'), 'utf8').trim();
  assert.equal(Buffer.from(b64, 'base64').length, 32);
  assert.equal(b64, info.publicKeyBase64);
  const pubFromPem = release.rawPublicKey(crypto.createPublicKey(fs.readFileSync(path.join(dir, 'apc-update-public.pem'), 'utf8')));
  assert.equal(pubFromPem.toString('base64'), b64);
  const inc = fs.readFileSync(path.join(dir, 'apc-update-public-key.inc'), 'utf8');
  assert.match(inc, /kApcUpdatePublicKey\[32\]/);
  assert.equal((inc.match(/0x[0-9a-f]{2}/g) || []).length, 32);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'apc-update-private.pem')).mode & 0o777, 0o600);

  const before = fs.readFileSync(path.join(dir, 'apc-update-private.pem'), 'utf8');
  const again = apc(['keygen', '--out', dir]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(dir, 'apc-update-private.pem'), 'utf8'), before, 'existing key untouched');
});

test('keygen: partial pre-existing files also block (nothing is written)', () => {
  const dir = tmp('kg2');
  fs.writeFileSync(path.join(dir, 'apc-update-public.b64'), 'x');
  const r = apc(['keygen', '--out', dir]);
  assert.equal(r.status, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'apc-update-private.pem')));
});

test('keygen without --out is a usage error (exit 2)', () => {
  const r = apc(['keygen']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out/);
});

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

test('manifest: scans artifacts, hashes them, reads version from status.json, skips stale/unknown files', () => {
  const win = Buffer.from('windows installer bytes');
  const mac = Buffer.from('macos installer bytes!!');
  const { rel, ctx } = makeProject('DemoSynth', '1.3.0', {
    'DemoSynth-1.3.0-Windows-Setup.exe': win,
    'DemoSynth-1.3.0-macOS.pkg': mac,
    'DemoSynth-1.2.0-Windows-Setup.exe': 'stale',
    'DemoSynth-1.3.0-VST3.zip': 'ambiguous zip',
    'README.txt': 'ignored',
  });
  const notes = path.join(rel, 'notes.txt');
  fs.writeFileSync(notes, 'Fixes.\r\nNew: A/B.\r\n');
  const r = apc(['manifest', '--plugin', 'DemoSynth', '--base-url', 'https://dl.example.test/demo/', '--notes', notes, '--min-supported', '1.0.0', '--published-at', '2026-11-07T12:00:00Z', '--json'], ctx);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = r.json();
  assert.equal(out.version, '1.3.0');
  assert.equal(out.versionSource, 'status.json');
  assert.equal(out.signed, false);
  const m = JSON.parse(fs.readFileSync(path.join(rel, 'update-manifest.json'), 'utf8'));
  assert.equal(m.schema, 'apc-update/1.0');
  assert.equal(m.product, 'DemoSynth');
  assert.equal(m.notes, 'Fixes.\nNew: A/B.');
  assert.equal(m.min_supported, '1.0.0');
  assert.equal(m.artifacts.length, 2);
  const w = m.artifacts.find((a) => a.platform === 'windows-x64');
  assert.equal(w.kind, 'installer');
  assert.equal(w.size, win.length);
  assert.equal(w.sha256, crypto.createHash('sha256').update(win).digest('hex'));
  assert.equal(w.url, 'https://dl.example.test/demo/DemoSynth-1.3.0-Windows-Setup.exe');
  assert.equal(m.artifacts.find((a) => a.platform === 'macos-universal').size, mac.length);
  const skippedFiles = out.skipped.map((s) => s.file).sort();
  assert.deepEqual(skippedFiles, ['DemoSynth-1.2.0-Windows-Setup.exe', 'DemoSynth-1.3.0-VST3.zip']);
  assert.ok(out.warnings.some((x) => /NOT signed/.test(x)));
});

test('manifest --key writes a signed manifest that verify accepts; the hashes are re-checked on disk', () => {
  const { rel, ctx } = makeProject('DemoSynth', '1.3.0', { 'DemoSynth-1.3.0-Windows-Setup.exe': 'payload-1' });
  const keys = path.join(tmp('mk'), 'k');
  const info = keygen(keys);
  const r = apc(['manifest', '--plugin', 'DemoSynth', '--base-url', 'https://dl.example.test', '--key', path.join(keys, 'apc-update-private.pem'), '--json'], ctx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json().signed, true);
  const file = path.join(rel, 'update-manifest.json');
  assert.equal(apc(['verify', file, '--pubkey', path.join(keys, 'apc-update-public.pem'), '--json']).status, 0);
  assert.equal(apc(['verify', file, '--pubkey', info.publicKeyBase64]).status, 0, 'raw base64 public key also accepted');
  assert.equal(apc(['verify', file, '--pubkey', path.join(keys, 'apc-update-public.b64')]).status, 0, 'file holding base64 also accepted');
  // artifact tampered on disk after the manifest was made
  fs.writeFileSync(path.join(rel, 'DemoSynth-1.3.0-Windows-Setup.exe'), 'payload-X');
  const bad = apc(['verify', file, '--pubkey', info.publicKeyBase64, '--json']);
  assert.equal(bad.status, 1);
  assert.ok(bad.json().checks.some((c) => /artifact/.test(c.name) && !c.ok));
});

test('manifest: falls back to CMake VERSION, honours --version, errors clearly when nothing is found', () => {
  const { root, ctx } = makeProject('CmakeOnly', '9.9.9', { 'CmakeOnly-2.0.1-Windows-Setup.exe': 'x' });
  fs.rmSync(path.join(root, 'plugins', 'CmakeOnly', 'status.json'));
  fs.writeFileSync(path.join(root, 'plugins', 'CmakeOnly', 'CMakeLists.txt'), 'project(CmakeOnly VERSION 2.0.1)\n');
  const r = apc(['manifest', '--plugin', 'CmakeOnly', '--json'], ctx);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.json().version, '2.0.1');
  assert.equal(r.json().versionSource, 'CMakeLists.txt');

  const none = makeProject('Empty', '1.0.0', {});
  const e = apc(['manifest', '--plugin', 'Empty', '--json'], none.ctx);
  assert.equal(e.status, 1);
  assert.match(e.json().error, /no release artifacts/);
});

test('manifest: two installers for one platform is an error; non-https base url is refused', () => {
  const { ctx } = makeProject('Dup', '1.0.0', { 'Dup-1.0.0-Windows-Setup.exe': 'a', 'Dup-1.0.0-Win64-Setup.msi': 'b' });
  const d = apc(['manifest', '--plugin', 'Dup', '--json'], ctx);
  assert.equal(d.status, 1);
  assert.match(d.json().error, /ambiguous/);
  const h = apc(['manifest', '--plugin', 'Dup', '--base-url', 'http://insecure.example.test', '--json'], ctx);
  assert.equal(h.status, 1);
  assert.match(h.json().error, /https/);
});

test('manifest: shared release dir fallback only takes files that start with the plugin name', () => {
  const root = tmp('shared');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugins', 'Mine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugins', 'Mine', 'status.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'release', 'Mine-1.0.0-Windows-Setup.exe'), 'mine');
  fs.writeFileSync(path.join(root, 'release', 'Other-1.0.0-Windows-Setup.exe'), 'other');
  const ctx = { root, resolvePaths: () => ({ releaseDir: path.join(root, 'release') }), pluginPath: (n) => path.join(root, 'plugins', n) };
  const r = apc(['release', 'manifest', '--plugin', 'Mine', '--json'], ctx);   // a leading "release" is tolerated
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.json().artifacts.length, 1);
  assert.equal(r.json().artifacts[0].url, 'Mine-1.0.0-Windows-Setup.exe');
});

// ---------------------------------------------------------------------------
// sign / verify / tamper / downgrade
// ---------------------------------------------------------------------------

function sampleManifest(overrides) {
  return Object.assign({
    schema: 'apc-update/1.0',
    product: 'DemoSynth',
    version: '1.3.0',
    published_at: '2026-11-07T12:00:00Z',
    artifacts: [{ platform: 'windows-x64', kind: 'installer', url: 'https://dl.example.test/DemoSynth-1.3.0-Windows-Setup.exe', sha256: 'a'.repeat(64), size: 1000 }],
  }, overrides);
}

function setup() {
  const dir = tmp('sv');
  const keys = path.join(dir, 'keys');
  const info = keygen(keys);
  const file = path.join(dir, 'update-manifest.json');
  fs.writeFileSync(file, JSON.stringify(sampleManifest(), null, 2));
  return { dir, keys, info, file, priv: path.join(keys, 'apc-update-private.pem'), pub: path.join(keys, 'apc-update-public.pem') };
}

test('sign + verify round trip; verify of an unsigned manifest fails', () => {
  const s = setup();
  assert.equal(apc(['verify', s.file, '--pubkey', s.pub]).status, 1, 'unsigned must not verify');
  const sg = apc(['sign', s.file, '--key', s.priv, '--json']);
  assert.equal(sg.status, 0, sg.stderr);
  const doc = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  assert.equal(Buffer.from(doc.signature, 'base64').length, 64);
  assert.equal(apc(['verify', s.file, '--pubkey', s.pub, '--json']).status, 0);
  // signing again (re-sign) replaces the old signature and still verifies
  assert.equal(apc(['sign', s.file, '--key', s.priv]).status, 0);
  assert.equal(apc(['verify', s.file, '--pubkey', s.pub]).status, 0);
});

test('verify: any tampered signed field is detected', () => {
  const s = setup();
  assert.equal(apc(['sign', s.file, '--key', s.priv]).status, 0);
  const good = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  const mutations = {
    version: (d) => { d.version = '9.9.9'; },
    product: (d) => { d.product = 'Other'; },
    sha256: (d) => { d.artifacts[0].sha256 = 'b'.repeat(64); },
    size: (d) => { d.artifacts[0].size = 1001; },
    url: (d) => { d.artifacts[0].url = 'https://evil.example.test/x.exe'; },
    'extra member': (d) => { d.injected = true; },
    notes: (d) => { d.notes = 'phish'; },
    'artifact removed': (d) => { d.artifacts.push(d.artifacts[0]); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const d = JSON.parse(JSON.stringify(good));
    mutate(d);
    const f = path.join(s.dir, 'tampered.json');
    fs.writeFileSync(f, JSON.stringify(d));
    const r = apc(['verify', f, '--pubkey', s.pub, '--json']);
    assert.equal(r.status, 1, `tamper "${name}" must fail`);
    assert.ok(r.json().checks.some((c) => c.name === 'signature' && !c.ok) || r.json().checks.some((c) => c.name === 'parse' && !c.ok), name);
  }
  // key order / whitespace changes are NOT tampering (canonical form is stable)
  const reordered = Object.fromEntries(Object.entries(good).reverse());
  const f2 = path.join(s.dir, 'reordered.json');
  fs.writeFileSync(f2, JSON.stringify(reordered));
  assert.equal(apc(['verify', f2, '--pubkey', s.pub]).status, 0);
});

test('verify: wrong key fails; bad key input is reported', () => {
  const s = setup();
  assert.equal(apc(['sign', s.file, '--key', s.priv]).status, 0);
  const other = keygen(path.join(s.dir, 'other'));
  assert.equal(apc(['verify', s.file, '--pubkey', other.publicKeyBase64]).status, 1);
  const bad = apc(['verify', s.file, '--pubkey', 'not-a-key', '--json']);
  assert.equal(bad.status, 1);
  assert.ok(bad.json().checks.some((c) => c.name === 'public-key' && !c.ok));
});

test('verify --current: blocks downgrade, reports same version as no update', () => {
  const s = setup();
  assert.equal(apc(['sign', s.file, '--key', s.priv]).status, 0);
  const down = apc(['verify', s.file, '--pubkey', s.pub, '--current', '1.4.0', '--json']);
  assert.equal(down.status, 1);
  assert.match(down.json().checks.find((c) => c.name === 'downgrade').detail, /downgrade blocked/);
  const same = apc(['verify', s.file, '--pubkey', s.pub, '--current', 'v1.3.0', '--json']);
  assert.equal(same.status, 0);
  assert.match(same.json().checks.find((c) => c.name === 'downgrade').detail, /no update/);
  assert.equal(apc(['verify', s.file, '--pubkey', s.pub, '--current', '1.2.9']).status, 0);
  // pre-release ordering: 1.3.0-rc.1 manifest is a downgrade from installed 1.3.0
  const pre = path.join(s.dir, 'pre.json');
  fs.writeFileSync(pre, JSON.stringify(sampleManifest({ version: '1.3.0-rc.1' })));
  assert.equal(apc(['sign', pre, '--key', s.priv]).status, 0);
  assert.equal(apc(['verify', pre, '--pubkey', s.pub, '--current', '1.3.0']).status, 1);
  assert.equal(apc(['verify', pre, '--pubkey', s.pub, '--current', '1.2.0']).status, 0);
});

test('sign/verify: floats and duplicate keys are rejected (they have no canonical form)', () => {
  const s = setup();
  const f = path.join(s.dir, 'float.json');
  fs.writeFileSync(f, JSON.stringify(sampleManifest()).replace('"size":1000', '"size":1000.5'));
  const r = apc(['sign', f, '--key', s.priv, '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().error, /floating point/);
  const d = path.join(s.dir, 'dup.json');
  fs.writeFileSync(d, '{"schema":"apc-update/1.0","schema":"apc-update/1.0"}');
  assert.equal(apc(['sign', d, '--key', s.priv]).status, 1);
  assert.equal(apc(['verify', d, '--pubkey', s.pub]).status, 1);
});

test('sign refuses an invalid manifest (does not sign garbage)', () => {
  const s = setup();
  fs.writeFileSync(s.file, JSON.stringify(sampleManifest({ version: 'not-a-version', artifacts: [] })));
  const r = apc(['sign', s.file, '--key', s.priv, '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json().error, /invalid manifest/);
  assert.ok(!('signature' in JSON.parse(fs.readFileSync(s.file, 'utf8'))));
});

test('usage errors: unknown subcommand/option -> exit 2, help -> exit 0', () => {
  assert.equal(apc(['bogus']).status, 2);
  assert.equal(apc(['verify']).status, 2);
  assert.equal(apc(['verify', 'x.json', '--wat']).status, 2);
  assert.equal(apc([]).status, 2);
  const h = apc(['help']);
  assert.equal(h.status, 0);
  assert.match(h.stdout, /keygen/);
});

// ---------------------------------------------------------------------------
// schema <-> validator consistency
// ---------------------------------------------------------------------------

test('schema: required members and patterns match what the validator enforces', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'apc-update-manifest.schema.json'), 'utf8'));
  assert.deepEqual([...schema.required].sort(), [...release.MANIFEST_REQUIRED, 'signature'].sort());
  assert.equal(schema.properties.schema.const, release.SCHEMA);
  const art = schema.properties.artifacts.items;
  assert.deepEqual([...art.required].sort(), ['kind', 'platform', 'sha256', 'size', 'url']);
  // every platform the CLI can infer matches the schema's pattern
  const re = new RegExp(art.properties.platform.pattern);
  for (const f of ['A-1.0.0-Windows-Setup.exe', 'A-1.0.0-macOS.pkg', 'A-1.0.0-macOS-arm64.dmg', 'A-1.0.0-Linux.deb', 'A-1.0.0-Linux-arm64.AppImage']) {
    const p = release.inferPlatform(f);
    assert.ok(p, f);
    assert.match(p.platform, re, f);
  }
  // the signature pattern accepts a real signature
  const s = setup();
  assert.equal(apc(['sign', s.file, '--key', s.priv]).status, 0);
  assert.match(JSON.parse(fs.readFileSync(s.file, 'utf8')).signature, new RegExp(schema.properties.signature.pattern));
  assert.equal(release.validateManifest(sampleManifest()).length, 0);
});
