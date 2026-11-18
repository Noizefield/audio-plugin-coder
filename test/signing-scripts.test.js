'use strict';
// Signing / packaging script tests. Zero deps: node:test + node:assert (Node 18+).
// Run: node --test test/signing-scripts.test.js
//
// These check SYNTAX (PowerShell parser, bash -n) and --dry-run behaviour (exact commands,
// secret masking, skip-with-message, --require). Real signing is NOT exercised: no
// certificate, Apple account or Linux packaging host is involved. Tests skip cleanly when
// the interpreter they need is not installed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(ROOT, 'scripts', 'installer');
const WIN_SCRIPT = path.join(INSTALLER, 'sign-windows.ps1');
const MAC_SCRIPT = path.join(INSTALLER, 'sign-macos.sh');
const LIN_SCRIPT = path.join(INSTALLER, 'create-linux-packages.sh');
const README = path.join(INSTALLER, 'README.md');

// ─── interpreter discovery ─────────────────────────────────────────────────

function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const d of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const e of exts) { const p = path.join(d, name + e); try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  }
  return null;
}

function findBash() {
  if (process.env.APC_TEST_BASH) return process.env.APC_TEST_BASH;
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      if (!base) continue;
      const p = path.join(base, 'Git', 'bin', 'bash.exe');
      if (fs.existsSync(p)) return p;
    }
    const p = onPath('bash'); // avoid the WSL launcher in System32
    return p && !/system32/i.test(p) ? p : null;
  }
  return onPath('bash');
}

function findPowerShell() {
  return onPath('pwsh') || (process.platform === 'win32' ? onPath('powershell') : null);
}

const BASH = findBash();
const PWSH = findPowerShell();
const skipBash = BASH ? false : 'bash not available';
const skipPwsh = PWSH ? false : 'PowerShell not available';

/** Environment with every signing/packaging variable removed, so the host config cannot leak in. */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^APC_(SIGN|NOTARY|PKG|ENTITLEMENTS)/.test(k)) delete env[k];
  return { ...env, ...extra };
}

function bash(script, args, env) {
  const rel = path.relative(ROOT, script).split(path.sep).join('/');
  const r = spawnSync(BASH, [rel, ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv(env), timeout: 60000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' };
}

function pwshRun(args, env) {
  const r = spawnSync(PWSH, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WIN_SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv(env), timeout: 120000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ─── syntax ────────────────────────────────────────────────────────────────

test('bash -n accepts sign-macos.sh and create-linux-packages.sh', { skip: skipBash }, () => {
  for (const f of [MAC_SCRIPT, LIN_SCRIPT]) {
    const r = spawnSync(BASH, ['-n', path.relative(ROOT, f).split(path.sep).join('/')], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.basename(f)}: ${r.stderr}`);
  }
});

test('PowerShell parser accepts sign-windows.ps1', { skip: skipPwsh }, () => {
  const cmd = `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${WIN_SCRIPT.replace(/'/g, "''")}',[ref]$t,[ref]$e); if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { 'OK' }`;
  const r = spawnSync(PWSH, ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK/);
});

test('scripts are present, documented and carry no embedded credentials', () => {
  for (const f of [WIN_SCRIPT, MAC_SCRIPT, LIN_SCRIPT, README]) assert.ok(fs.existsSync(f), f);
  const readme = fs.readFileSync(README, 'utf8');
  assert.match(readme, /NOT exercised/i);
  for (const f of [WIN_SCRIPT, MAC_SCRIPT, LIN_SCRIPT]) {
    const text = fs.readFileSync(f, 'utf8');
    const vars = new Set(text.match(/\bAPC_(?:SIGN|NOTARY|PKG)[A-Z0-9_]*\b|\bAPC_ENTITLEMENTS\b/g) || []);
    assert.ok(vars.size > 0, path.basename(f));
    for (const v of vars) assert.ok(readme.includes(v), `README.md must document ${v} (used by ${path.basename(f)})`);
    assert.doesNotMatch(text, /(password|secret|token)\s*=\s*["'][^"'$]{6,}["']/i, `${path.basename(f)} must not hardcode credentials`);
    assert.match(text, /dry[- ]?run/i);
  }
});

// ─── sign-windows.ps1 ──────────────────────────────────────────────────────

test('sign-windows: no configuration -> SKIPPED exit 0; -Require -> exit 1', { skip: skipPwsh }, () => {
  let r = pwshRun(['-DryRun', 'a.exe']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /SKIPPED \(artifacts NOT signed\)/);
  assert.match(r.out, /APC_SIGN_PFX_PATH/);
  assert.doesNotMatch(r.out, /\[dry-run\]/);
  r = pwshRun(['-Require', 'a.exe']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /-Require/);
});

test('sign-windows: pfx dry-run prints the exact signtool command and masks the password', { skip: skipPwsh }, () => {
  const r = pwshRun(['-DryRun', 'C:\\x\\My Plug.vst3', 'b.dll'], { APC_SIGN_PFX_PATH: 'C:\\certs\\my cert.pfx', APC_SIGN_PFX_PASSWORD: 'dummy-pass-12345', APC_SIGNTOOL: 'C:\\fake\\signtool.exe' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Signing method: pfx/);
  assert.ok(r.out.includes('C:\\fake\\signtool.exe sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f "C:\\certs\\my cert.pfx" /p ******** "C:\\x\\My Plug.vst3"'), r.out);
  assert.ok(r.out.includes('C:\\fake\\signtool.exe verify /pa /v b.dll'), r.out);
  assert.equal(r.out.includes('dummy-pass-12345'), false, 'password must never be printed');
  assert.match(r.out, /DRY RUN complete/);
});

test('sign-windows: certstore and Azure Trusted Signing dry-runs, custom timestamp', { skip: skipPwsh }, () => {
  let r = pwshRun(['-DryRun', 'c.exe'], { APC_SIGN_CERT_SHA1: 'ABCDEF0123', APC_SIGN_MACHINE_STORE: '1', APC_SIGN_TIMESTAMP_URL: 'http://ts.example.invalid', APC_SIGNTOOL: 'signtool.exe' });
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes('signtool.exe sign /fd SHA256 /tr http://ts.example.invalid /td SHA256 /sha1 ABCDEF0123 /sm c.exe'), r.out);

  r = pwshRun(['-DryRun', 'c.exe'], { APC_SIGN_AZURE_DLIB: 'd.dll', APC_SIGN_AZURE_ENDPOINT: 'https://eus.codesigning.azure.net', APC_SIGN_AZURE_ACCOUNT: 'acct', APC_SIGN_AZURE_PROFILE: 'prof', APC_SIGNTOOL: 'signtool.exe' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Signing method: azure/);
  assert.ok(r.out.includes('/dlib d.dll /dmdf '), r.out);
  assert.match(r.out, /"CodeSigningAccountName":\s+"acct"/);
  assert.match(r.out, /"CertificateProfileName":\s+"prof"/);

  // forced method with incomplete config is a skip that names the missing variables
  r = pwshRun(['-DryRun', '-Method', 'azure', 'c.exe'], { APC_SIGN_AZURE_DLIB: 'd.dll' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /SKIPPED/);
  assert.match(r.out, /APC_SIGN_AZURE_ENDPOINT/);
});

test('sign-windows: a real (non dry) run with a missing file fails instead of pretending', { skip: skipPwsh }, () => {
  const r = pwshRun(['definitely-missing-file.exe'], { APC_SIGN_CERT_SHA1: 'ABCDEF0123', APC_SIGNTOOL: process.execPath });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /file not found/);
});

// ─── sign-macos.sh ─────────────────────────────────────────────────────────

test('sign-macos: no identity -> SKIPPED exit 0; --require -> exit 1; usage errors -> 2', { skip: skipBash }, () => {
  let r = bash(MAC_SCRIPT, ['--dry-run', '/x/a.vst3']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /SKIPPED \(artifacts NOT signed\).*APC_SIGN_IDENTITY/);
  assert.doesNotMatch(r.out, /\[dry-run\]/);
  r = bash(MAC_SCRIPT, ['--require', '/x/a.vst3']);
  assert.equal(r.status, 1, r.out);
  assert.equal(bash(MAC_SCRIPT, []).status, 2);
  assert.equal(bash(MAC_SCRIPT, ['--bogus', 'x']).status, 2);
  r = bash(MAC_SCRIPT, ['--dry-run', '/x/Setup.pkg'], { APC_SIGN_IDENTITY: 'Developer ID Application: T (ABCDE12345)' });
  assert.match(r.out, /APC_SIGN_INSTALLER_IDENTITY/); // .pkg needs the installer identity
});

test('sign-macos: dry-run command sequence for a bundle (sign, verify, notarize, staple, spctl) with masked password', { skip: skipBash }, () => {
  const r = bash(MAC_SCRIPT, ['--dry-run', '/x/My Plug.vst3'], {
    APC_SIGN_IDENTITY: 'Developer ID Application: Test (ABCDE12345)', APC_ENTITLEMENTS: '/x/e.plist',
    APC_NOTARY_APPLE_ID: 'dev@example.invalid', APC_NOTARY_TEAM_ID: 'ABCDE12345', APC_NOTARY_PASSWORD: 'app-specific-pass-xyz',
  });
  assert.equal(r.status, 0, r.out);
  const lines = r.out.split(/\r?\n/).filter((l) => l.startsWith('[dry-run]')).map((l) => l.replace('[dry-run] ', ''));
  const idx = (re) => lines.findIndex((l) => re.test(l));
  const sign = idx(/^codesign --force --options runtime --timestamp --sign "Developer ID Application: Test \(ABCDE12345\)" --entitlements \/x\/e\.plist "\/x\/My Plug\.vst3"$/);
  const verify = idx(/^codesign --verify --deep --strict --verbose=2 "\/x\/My Plug\.vst3"$/);
  const zip = idx(/^ditto -c -k --keepParent "\/x\/My Plug\.vst3" .*\.zip"?$/);
  const notarize = idx(/^xcrun notarytool submit .* --apple-id dev@example\.invalid --team-id ABCDE12345 --password \*{8} --wait$/);
  const staple = idx(/^xcrun stapler staple "\/x\/My Plug\.vst3"$/);
  const spctl = idx(/^spctl --assess --type execute -vv "\/x\/My Plug\.vst3"$/);
  for (const [n, v] of Object.entries({ sign, verify, zip, notarize, staple, spctl })) assert.ok(v >= 0, `missing dry-run step: ${n}\n${r.out}`);
  assert.ok(sign < verify && verify < zip && zip < notarize && notarize < staple && staple < spctl, 'steps out of order');
  assert.equal(r.out.includes('app-specific-pass-xyz'), false, 'notary password must never be printed');
});

test('sign-macos: keychain profile, dmg and --no-notarize', { skip: skipBash }, () => {
  let r = bash(MAC_SCRIPT, ['--dry-run', '/x/Setup.dmg'], { APC_SIGN_IDENTITY: 'Developer ID Application: T (ABCDE12345)', APC_NOTARY_PROFILE: 'apc-notary' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /codesign --force --timestamp --sign "Developer ID Application: T \(ABCDE12345\)" \/x\/Setup\.dmg/);
  assert.match(r.out, /xcrun notarytool submit \/x\/Setup\.dmg --keychain-profile apc-notary --wait/);
  assert.match(r.out, /spctl --assess --type open --context context:primary-signature -vv \/x\/Setup\.dmg/);

  r = bash(MAC_SCRIPT, ['--dry-run', '--no-notarize', '/x/a.app'], { APC_SIGN_IDENTITY: 'Developer ID Application: T (ABCDE12345)', APC_NOTARY_PROFILE: 'apc-notary' });
  assert.match(r.out, /notarization will be skipped: --no-notarize/);
  assert.doesNotMatch(r.out, /notarytool/);

  r = bash(MAC_SCRIPT, ['--dry-run', '/x/a.app'], { APC_SIGN_IDENTITY: 'Developer ID Application: T (ABCDE12345)' });
  assert.match(r.out, /no notarization credentials/);
});

test('sign-macos: a non-dry run off macOS skips rather than pretending to sign', { skip: skipBash || process.platform === 'darwin' }, () => {
  const r = bash(MAC_SCRIPT, ['/x/a.vst3'], { APC_SIGN_IDENTITY: 'Developer ID Application: T (ABCDE12345)' });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /SKIPPED.*not running on macOS/);
});

// ─── create-linux-packages.sh ──────────────────────────────────────────────

test('create-linux-packages: dry-run DEB + RPM with VST3 and CLAP install paths', { skip: skipBash }, () => {
  const r = bash(LIN_SCRIPT, ['My_Plugin', '--version', '1.2.3-beta.1', '--dry-run', '--url', 'https://example.invalid', '--maintainer', 'Dev <dev@example.invalid>', '--arch', 'amd64']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /DRY RUN complete/);
  // DEB
  assert.match(r.out, /would write .*\/DEBIAN\/control:/);
  assert.match(r.out, /Package: my-plugin\b/);
  assert.match(r.out, /Version: 1\.2\.3-beta\.1/);
  assert.match(r.out, /Architecture: amd64/);
  assert.match(r.out, /Maintainer: Dev <dev@example\.invalid>/);
  assert.match(r.out, /Homepage: https:\/\/example\.invalid/);
  assert.match(r.out, /dpkg-deb --root-owner-group --build \S+ \S+my-plugin_1\.2\.3-beta\.1_amd64\.deb/);
  assert.match(r.out, /\/usr\/lib\/vst3\/My_Plugin\.vst3/);
  assert.match(r.out, /\/usr\/lib\/clap\/My_Plugin\.clap/);
  // RPM: '-' is illegal in Version, so the suffix moves to Release
  assert.match(r.out, /Version:\s+1\.2\.3\n/);
  assert.match(r.out, /Release:\s+0\.beta\.1/);
  assert.match(r.out, /BuildArch:\s+x86_64/);
  assert.match(r.out, /%files\s+\/usr\/lib\/vst3\/My_Plugin\.vst3\s+\/usr\/lib\/clap\/My_Plugin\.clap/);
  assert.match(r.out, /rpmbuild -bb --define _topdir \S+ --define _rpmdir \S+ \S+my-plugin\.spec/);
});

test('create-linux-packages: --format deb only, explicit artifact paths, usage errors', { skip: skipBash }, () => {
  let r = bash(LIN_SCRIPT, ['Foo', '--version', '1.0.0', '--format', 'deb', '--dry-run', '--vst3', '/b/Foo.vst3', '--clap', '/b/Foo.clap', '--out', '/o']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /cp -a \/b\/Foo\.vst3 \S+\/usr\/lib\/vst3\/Foo\.vst3/);
  assert.match(r.out, /cp -a \/b\/Foo\.clap \S+\/usr\/lib\/clap\/Foo\.clap/);
  assert.match(r.out, /\/o\/foo_1\.0\.0_amd64\.deb|\/o\/foo_1\.0\.0_[a-z0-9]+\.deb/);
  assert.doesNotMatch(r.out, /rpmbuild/);

  assert.equal(bash(LIN_SCRIPT, []).status, 2);
  assert.equal(bash(LIN_SCRIPT, ['Foo']).status, 2); // --version required
  assert.equal(bash(LIN_SCRIPT, ['Foo', '--version', '1.0', '--format', 'zip']).status, 2);
  assert.equal(bash(LIN_SCRIPT, ['../x', '--version', '1.0']).status, 2);
});

test('create-linux-packages: missing build artifact is an error, not a silent skip', { skip: skipBash }, () => {
  const r = bash(LIN_SCRIPT, ['Foo', '--version', '1.0.0', '--vst3', '/definitely/not/here/Foo.vst3', '--out', '/tmp/apc-never']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /VST3 artifact not found/);
});
