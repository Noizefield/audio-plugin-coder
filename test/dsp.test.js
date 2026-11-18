'use strict';
// common/dsp (apc::dsp golden library) C++ test-suite driver. Zero deps: node:test + node:assert.
// Run: npm test  (== node --test test/)
//
// Finds a C++17 compiler (MSVC via vswhere/vcvars64 on Windows; c++/g++/clang++ elsewhere),
// compiles common/dsp/tests/apc_dsp_tests.cpp into an OS temp dir and runs it.
// If no compiler is available the tests are SKIPPED, not failed.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DSP_DIR = path.join(REPO_ROOT, 'common', 'dsp');
const TEST_CPP = path.join(DSP_DIR, 'tests', 'apc_dsp_tests.cpp');
const HEADERS = fs.readdirSync(DSP_DIR).filter((f) => f.endsWith('.h'));

const VSWHERE = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio', 'Installer', 'vswhere.exe');

function findMsvc() {
  if (process.platform !== 'win32' || !fs.existsSync(VSWHERE)) return null;
  const queries = [
    ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
    ['-latest', '-products', '*', '-property', 'installationPath'],
  ];
  for (const q of queries) {
    try {
      const root = execFileSync(VSWHERE, q, { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      if (!root) continue;
      const vcvars = path.join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
      if (fs.existsSync(vcvars)) return { kind: 'msvc', vcvars };
    } catch { /* try next */ }
  }
  return null;
}

function findUnixCompiler() {
  for (const cxx of ['c++', 'g++', 'clang++']) {
    const r = spawnSync(cxx, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return { kind: 'unix', cxx };
  }
  return null;
}

const compiler = findMsvc() || findUnixCompiler();
const skipReason = compiler ? null : 'no C++17 compiler found (MSVC via vswhere, or c++/g++/clang++)';
const work = compiler ? fs.mkdtempSync(path.join(os.tmpdir(), 'apc-dsp-')) : null;
const exe = work ? path.join(work, process.platform === 'win32' ? 'apc_dsp_tests.exe' : 'apc_dsp_tests') : null;
let compiled = false;

after(() => {
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

// Run a list of compiler commands (MSVC: inside a vcvars64 environment). Returns {status, output}.
function runBuild(commands) {
  if (compiler.kind === 'msvc') {
    const bat = path.join(work, `build-${Math.random().toString(36).slice(2)}.cmd`);
    const lines = ['@echo off', `call "${compiler.vcvars}" >nul`, 'if errorlevel 1 exit /b 1',
      ...commands.flatMap((c) => [c, 'if errorlevel 1 exit /b 1'])];
    fs.writeFileSync(bat, lines.join('\r\n') + '\r\n');
    const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${bat}"`], { encoding: 'utf8', windowsVerbatimArguments: true, timeout: 600000 });
    return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
  }
  let out = '';
  for (const c of commands) {
    const r = spawnSync(c.cmd, c.args, { encoding: 'utf8', timeout: 600000 });
    out += `${r.stdout || ''}${r.stderr || ''}`;
    if (r.status !== 0) return { status: r.status === null ? 1 : r.status, output: out };
  }
  return { status: 0, output: out };
}

test('every header compiles standalone (self-contained includes)', (t) => {
  if (!compiler) return t.skip(skipReason);
  const srcs = HEADERS.map((h) => {
    const f = path.join(work, `standalone_${h.replace('.h', '')}.cpp`);
    fs.writeFileSync(f, `#include "${h}"\nint main_${h.replace(/\W/g, '_')}() { return 0; }\n`);
    return f;
  });
  let cmds;
  if (compiler.kind === 'msvc') {
    cmds = [`cl /nologo /std:c++17 /EHsc /W4 /c /I"${DSP_DIR}" /Fo"${work}\\\\" ${srcs.map((s) => `"${s}"`).join(' ')}`];
  } else {
    cmds = srcs.map((s) => ({ cmd: compiler.cxx, args: ['-std=c++17', '-Wall', '-Wextra', '-pedantic', '-fsyntax-only', '-I', DSP_DIR, s] }));
  }
  const r = runBuild(cmds);
  assert.equal(r.status, 0, `standalone header compile failed:\n${r.output}`);
  assert.ok(HEADERS.includes('apc_dsp.h'));
});

test('apc_dsp_tests.cpp compiles', (t) => {
  if (!compiler) return t.skip(skipReason);
  let cmds;
  if (compiler.kind === 'msvc') {
    cmds = [`cl /nologo /std:c++17 /EHsc /O2 /W4 /permissive- /Fo"${work}\\\\" /Fe"${exe}" "${TEST_CPP}"`];
  } else {
    cmds = [{ cmd: compiler.cxx, args: ['-std=c++17', '-O2', '-Wall', '-Wextra', '-pthread', '-I', DSP_DIR, TEST_CPP, '-o', exe] }];
  }
  const r = runBuild(cmds);
  assert.equal(r.status, 0, `compile failed:\n${r.output}`);
  assert.ok(fs.existsSync(exe), 'test executable was not produced');
  compiled = true;
});

test('apc::dsp C++ tests pass', (t) => {
  if (!compiler) return t.skip(skipReason);
  if (!compiled) return assert.fail('test executable missing (compile step failed)');
  const r = spawnSync(exe, [], { encoding: 'utf8', timeout: 300000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `C++ tests failed:\n${out}`);
  assert.match(out, /\d+ checks, 0 failures/);
  for (const name of ['ParamSmoother', 'Biquad', 'Svf', 'LockFreeFifo', 'SoftClipper', 'DryWet', 'Oversampler2x', 'DenormalGuard']) {
    assert.match(out, new RegExp(`\\[PASS\\] ${name}`), `missing PASS line for ${name}\n${out}`);
  }
});
