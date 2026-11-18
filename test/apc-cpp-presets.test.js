'use strict';
// Compiles and runs the C++ reference code in common/apc/ (ApcAtomicFile.h, ApcPaths.h,
// ApcDefaultsFirst.h) with whatever C++17 compiler the machine has:
//   Windows: MSVC found via vswhere -> vcvars64.bat      Others: c++ / g++ / clang++ on PATH
// Skips cleanly when no compiler is found. Build output goes to the OS temp dir, never the repo.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'common', 'apc', 'tests', 'test_presets_backend.cpp');

function findMsvcVcvars() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  try {
    const out = execFileSync(vswhere, [
      '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { encoding: 'utf8' }).trim();
    if (!out) return null;
    const bat = path.join(out.split(/\r?\n/)[0], 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    return fs.existsSync(bat) ? bat : null;
  } catch { return null; }
}

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function detectCompiler() {
  if (process.platform === 'win32') {
    const vcvars = findMsvcVcvars();
    if (vcvars) return { kind: 'msvc', vcvars };
    if (which('cl')) return { kind: 'msvc-path' };
  }
  for (const c of ['c++', 'g++', 'clang++']) {
    const p = which(c);
    if (p) return { kind: 'gcc-like', cxx: c };
  }
  return null;
}

const compiler = detectCompiler();

test('common/apc C++ reference code compiles warning-clean and passes its tests', { skip: compiler ? false : 'no C++ compiler found (MSVC via vswhere, or c++/g++/clang++ on PATH)' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cpp-'));
  try {
    let run;
    if (compiler.kind === 'msvc' || compiler.kind === 'msvc-path') {
      const exe = path.join(out, 'apc_presets_tests.exe');
      const lines = ['@echo off'];
      if (compiler.vcvars) lines.push(`call "${compiler.vcvars}" >nul 2>&1`);
      lines.push(`cl /nologo /std:c++17 /EHsc /W4 /WX /permissive- /Fo"${out}\\\\" /Fe"${exe}" "${SOURCE}"`);
      lines.push('if errorlevel 1 exit /b 1');
      const bat = path.join(out, 'build.bat');
      fs.writeFileSync(bat, lines.join('\r\n') + '\r\n');
      const build = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${bat}"`], { encoding: 'utf8', windowsVerbatimArguments: true });
      assert.equal(build.status, 0, `compile failed:\n${build.stdout}\n${build.stderr}`);
      run = spawnSync(exe, [], { encoding: 'utf8' });
    } else {
      const exe = path.join(out, 'apc_presets_tests');
      const build = spawnSync(compiler.cxx, ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-o', exe, SOURCE], { encoding: 'utf8' });
      assert.equal(build.status, 0, `compile failed:\n${build.stdout}\n${build.stderr}`);
      run = spawnSync(exe, [], { encoding: 'utf8' });
    }
    assert.equal(run.status, 0, `C++ tests failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /0 failure\(s\)/);
    assert.match(run.stdout, /\[ ok \] kill-mid-save fault injection/);
    assert.match(run.stdout, /\[ ok \] collision-safe import/);
    assert.doesNotMatch(run.stdout, /\[FAIL\]/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
