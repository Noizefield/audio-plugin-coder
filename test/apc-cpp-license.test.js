'use strict';
// End-to-end C++ cross-check for licensing: licenses ISSUED BY scripts/apc-license.js (and by the reference
// issuer scripts/lib/license-issuer.js) are loaded and verified through common/apc/ApcLicense.h, with a REAL
// Ed25519 verification done by Node on the exact canonical bytes the C++ code computed.
//
// How the proof works (see common/apc/tests/test_license_issued.cpp):
//   1. this test generates a fresh key + licenses with the Node tool into a temp dir (live.json describes them)
//   2. the C++ test parses each .lic with ApcCanonicalJson.h, canonicalises it WITHOUT the signature member and
//      calls ISignatureVerifier::verify(canonicalBytes, signature)
//   3. the test-only verifier writes those bytes to a file and runs test/fixtures/license/verify-bytes.js
//      (crypto.verify = Ed25519). Valid only if C++ bytes == the bytes Node signed.
//   What it does NOT prove: it says nothing about which Ed25519 library you embed in a plugin (libsodium,
//   Monocypher-ed25519, OpenSSL ...) - that adapter is yours, and the skeletons in ApcCanonicalJson.h are untested.
// The committed-golden half (no Node needed at run time) also runs in test/apc-cpp-release.test.js.
//
// Compiler discovery and skip rules are the same as test/apc-cpp-release.test.js: MSVC via vswhere/vcvars64.bat,
// else g++/clang++/c++; no compiler => SKIPPED (never failed); APC_SKIP_CPP=1 skips on purpose.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INC = path.join(REPO_ROOT, 'common', 'apc');
const SRC = path.join(INC, 'tests', 'test_license_issued.cpp');
const FIXTURES_RELEASE = path.join(__dirname, 'fixtures', 'release');
const HELPER = path.join(__dirname, 'fixtures', 'license', 'verify-bytes.js');
const lic = require(path.join(REPO_ROOT, 'scripts', 'apc-license.js'));
const release = require(path.join(REPO_ROOT, 'scripts', 'apc-release.js'));
const issuerLib = require(path.join(REPO_ROOT, 'scripts', 'lib', 'license-issuer.js'));

function which(cmd) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function detectToolchain() {
  if (process.env.APC_SKIP_CPP === '1') return { skip: 'APC_SKIP_CPP=1' };
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
      const r = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
      const root = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : '';
      const vcvars = root ? path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat') : '';
      if (vcvars && fs.existsSync(vcvars)) return { kind: 'msvc', vcvars, label: `MSVC (${root})` };
    }
    if (which('cl')) return { kind: 'msvc', vcvars: null, label: 'MSVC (cl on PATH)' };
  }
  for (const cxx of ['g++', 'clang++', 'c++']) {
    const p = which(cxx);
    if (p) return { kind: 'gnu', cxx, label: `${cxx} (${p})` };
  }
  return { skip: 'no C++17 compiler found (MSVC via vswhere, or g++/clang++ on PATH)' };
}

const TOOLCHAIN = detectToolchain();
const WORK = TOOLCHAIN.skip ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cpp-license-'));
after(() => { if (WORK) { try { fs.rmSync(WORK, { recursive: true, force: true }); } catch { /* best effort */ } } });

function compile(exe) {
  if (TOOLCHAIN.kind === 'msvc') {
    const lines = ['@echo off'];
    if (TOOLCHAIN.vcvars) lines.push(`call "${TOOLCHAIN.vcvars}" >nul 2>&1`, 'if errorlevel 1 exit /b 9');
    lines.push(`cl /nologo /std:c++17 /EHsc /W4 /permissive- /utf-8 /I "${INC}" "${SRC}" /Fo"${WORK}\\\\" /Fe"${exe}" || exit /b 1`);
    const bat = path.join(WORK, 'build.bat');
    fs.writeFileSync(bat, lines.join('\r\n') + '\r\n');
    const r = spawnSync('cmd.exe', ['/d', '/c', bat], { encoding: 'utf8', cwd: WORK, maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, log: (r.stdout || '') + (r.stderr || '') };
  }
  const r = spawnSync(TOOLCHAIN.cxx, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-pthread', '-I', INC, SRC, '-o', exe], { encoding: 'utf8', cwd: WORK, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, log: (r.stdout || '') + (r.stderr || '') };
}

function apc(args) {
  let stdout = ''; let stderr = '';
  const status = lic.run(args, { stdout: (s) => { stdout += s; }, stderr: (s) => { stderr += s; } });
  assert.equal(status, 0, `apc license ${args.join(' ')}\n${stdout}${stderr}`);
  return stdout;
}

function post(addr, p, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: addr.address, port: addr.port, method: 'POST', path: p, agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, Connection: 'close' } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
    });
    req.on('error', reject); req.write(payload); req.end();
  });
}

if (TOOLCHAIN.skip) {
  test('C++ ApcLicense.h verifies licenses issued by the Node tool', { skip: TOOLCHAIN.skip }, () => {});
} else {
  test(`C++ ApcLicense.h verifies Node-issued licenses with real Ed25519 (${TOOLCHAIN.label})`, { timeout: 600000 }, async () => {
    const product = 'LiveSynth';
    const machine = [{ label: 'cpu', value: 'CoolCPU 9000' }, { label: 'machine-id', value: 'abc-123' }, { label: 'volume', value: 'VOL-777' }];
    const hashes = machine.map((m) => lic.machineComponentHash(product, m.label, m.value));
    const live = path.join(WORK, 'live'); fs.mkdirSync(live);

    // key pair + a license issued by `apc license issue` (machine-bound 2-of-3)
    const keyDir = path.join(live, 'keys');
    const kg = JSON.parse(apc(['keygen', '--out', keyDir, '--json']));
    apc(['issue', '--key', path.join(keyDir, 'apc-license-private.pem'), '--product', product, '--name', 'Zo\u00eb "Live" \u65e5\u672c', '--email', 'live@example.test', '--order', 'LIVE-1',
      '--seats', '3', '--machine-components', hashes.join(','), '--min-match', '2', '--out', path.join(live, 'issued.lic')]);

    // a tampered copy (seats edited)
    const text = fs.readFileSync(path.join(live, 'issued.lic'), 'utf8');
    assert.ok(text.includes('"allowed_seats": 3'));
    fs.writeFileSync(path.join(live, 'tampered.lic'), text.replace('"allowed_seats": 3', '"allowed_seats": 9'));

    // a license produced by the reference issuer over HTTP
    const dbFile = path.join(live, 'issuer-db.json');
    const issuer = issuerLib.createIssuer({ dbFile, product, privateKey: release.loadPrivateKey(path.join(keyDir, 'apc-license-private.pem')) });
    const addr = await issuer.listen(0);
    try {
      const serial = issuerLib.createSerial(dbFile, product, { seats: 3, name: 'Issuer Customer', email: 'c@example.test', order: 'W-1' }).serial;
      const r = await post(addr, '/v1/activate', { serial, machine_components: hashes, product, plugin_version: '1.0.0' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      fs.writeFileSync(path.join(live, 'from-issuer.lic'), r.json.license_text);
    } finally { await issuer.close(); }

    // an unrelated key (must be rejected)
    const other = JSON.parse(apc(['keygen', '--out', path.join(WORK, 'other-keys'), '--json']));

    fs.writeFileSync(path.join(live, 'live.json'), JSON.stringify({
      product, public_key_b64: kg.publicKeyBase64, other_public_key_b64: other.publicKeyBase64, machine,
      license_file: 'issued.lic', tampered_file: 'tampered.lic', issuer_license_file: 'from-issuer.lic',
    }, null, 2));

    const exe = path.join(WORK, 'test_license_issued' + (process.platform === 'win32' ? '.exe' : ''));
    const c = compile(exe);
    assert.ok(c.ok, `compilation failed:\n${c.log}`);
    assert.ok(!/warning C\d+/.test(c.log) && !/warning:/.test(c.log), `compiler warnings:\n${c.log}`);

    let out;
    try {
      out = execFileSync(exe, [FIXTURES_RELEASE, '--live', live, '--node', process.execPath, '--helper', HELPER], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      assert.fail(`test_license_issued failed (exit ${e.status}):\n${e.stdout || ''}${e.stderr || ''}`);
    }
    assert.match(out, /\d+ checks?, 0 failed/, out);
  });
}
