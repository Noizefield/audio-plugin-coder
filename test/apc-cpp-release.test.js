'use strict';
// Compiles and runs the C++17 header tests in common/apc/tests (updater, license seam, settings
// store, semver, canonical JSON). Zero deps: node:test + node:assert (Node 18+).
//
//   * Windows: MSVC found via vswhere -> VC\Auxiliary\Build\vcvars64.bat (or `cl` already on PATH).
//   * Elsewhere / MinGW: g++, clang++ or c++ on PATH.
//   * No compiler: the suite is SKIPPED (reported as skipped, never as a failure).
//   * Set APC_SKIP_CPP=1 to skip on purpose.
//   * All build output goes to a fresh directory under os.tmpdir(); it is removed afterwards.
//
// The golden vectors in test/fixtures/release/canonical-vectors.json are shared with test/release.test.js.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const INC = path.join(REPO_ROOT, 'common', 'apc');
const TESTS = path.join(INC, 'tests');
const FIXTURES = path.join(__dirname, 'fixtures', 'release');
const PREFIXES = ['test_update_', 'test_license_', 'test_settings_', 'test_semver_'];

function sources() {
  return fs.readdirSync(TESTS).filter((f) => f.endsWith('.cpp') && PREFIXES.some((p) => f.startsWith(p))).sort();
}

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
const OUT = TOOLCHAIN.skip ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cpp-release-'));
const built = new Map();   // source -> { exe } | { error }

after(() => { if (OUT) { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* best effort */ } } });

function exeName(src) { return path.join(OUT, path.basename(src, '.cpp') + (process.platform === 'win32' ? '.exe' : '')); }

function compileAll(files) {
  if (TOOLCHAIN.kind === 'msvc') {
    const lines = ['@echo off'];
    if (TOOLCHAIN.vcvars) lines.push(`call "${TOOLCHAIN.vcvars}" >nul 2>&1`, 'if errorlevel 1 exit /b 9');
    for (const f of files) {
      const src = path.join(TESTS, f);
      lines.push(`echo === ${f}`,
        `cl /nologo /std:c++17 /EHsc /W4 /permissive- /utf-8 /I "${INC}" "${src}" /Fo"${OUT}\\\\" /Fe"${exeName(src)}" || exit /b 1`);
    }
    const bat = path.join(OUT, 'build.bat');
    fs.writeFileSync(bat, lines.join('\r\n') + '\r\n');
    const r = spawnSync('cmd.exe', ['/d', '/c', bat], { encoding: 'utf8', cwd: OUT, maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, log: (r.stdout || '') + (r.stderr || '') };
  }
  let log = '';
  for (const f of files) {
    const src = path.join(TESTS, f);
    const r = spawnSync(TOOLCHAIN.cxx, ['-std=c++17', '-O1', '-Wall', '-Wextra', '-pthread', '-I', INC, src, '-o', exeName(src)], { encoding: 'utf8', cwd: OUT, maxBuffer: 64 * 1024 * 1024 });
    log += `=== ${f}\n${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) return { ok: false, log };
  }
  return { ok: true, log };
}

if (TOOLCHAIN.skip) {
  test('C++ updater/license/settings header tests', { skip: TOOLCHAIN.skip }, () => {});
} else {
  const files = sources();

  test(`C++ tests: sources exist and follow the naming convention (${TOOLCHAIN.label})`, () => {
    assert.ok(files.length >= 6, `expected at least 6 test sources, found ${files.length}`);
    for (const p of PREFIXES) assert.ok(files.some((f) => f.startsWith(p)), `a ${p}*.cpp test is required`);
  });

  test('C++ tests: all compile cleanly (MSVC /W4 or -Wall -Wextra, zero warnings)', { timeout: 600000 }, () => {
    const r = compileAll(files);
    for (const f of files) built.set(f, fs.existsSync(exeName(f)) ? { exe: exeName(f) } : { error: 'not built' });
    assert.ok(r.ok, `compilation failed:\n${r.log}`);
    assert.ok(!/warning C\d+/.test(r.log) && !/warning:/.test(r.log), `compiler warnings:\n${r.log}`);
  });

  for (const f of files) {
    test(`C++ ${f.replace(/\.cpp$/, '')}`, { timeout: 180000 }, () => {
      const b = built.get(f);
      assert.ok(b && b.exe, `${f} was not built`);
      let out;
      try {
        out = execFileSync(b.exe, [FIXTURES], { encoding: 'utf8', timeout: 170000, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        assert.fail(`${f} failed (exit ${e.status}):\n${e.stdout || ''}${e.stderr || ''}`);
      }
      assert.match(out, /\d+ checks?, 0 failed/, out);
    });
  }
}
