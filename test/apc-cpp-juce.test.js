'use strict';
// Native side of the WebView UI kit: common/apc/juce (ApcPresetStore.h, ApcWebBridge.h, ApcApvtsParams.h,
// ApcPendingSwap.h) + templates/webview/apc-ui/apc-bridge.js + the opt-in blocks of the webview templates.
//
//   1. apc-bridge.js against the REAL JUCE 9 interop library (no compiler needed)             -> always runs
//   2. templates still pass `apc validate webview-order` with the UI kit block                  -> always runs
//   3. C++ tests, really built with CMake + MSVC (or c++) and RUN (juce_core/juce_events)       -> skips if cmake/JUCE/compiler missing
//        + cross-check against `apc presets index` (identical rows, Node reuses the C++ cache)
//   4. APVTS-adapter tests (run) + WebBrowserComponent wiring (compile/link only, never run)
//
// Build output goes to an OS temp dir, never the repo. Set APC_SKIP_CPP_JUCE=1 to skip 3 and 4 explicitly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'common', 'apc', 'tests', 'juce');
const JUCE_DIR = path.join(REPO_ROOT, '_tools', 'JUCE');
const BRIDGE_JS = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui', 'apc-bridge.js');
const JUCE_INTEROP = path.join(JUCE_DIR, 'modules', 'juce_gui_extra', 'native', 'typescript', 'webview-interop', 'dist', 'index.js');

// =============================================================================================================
// 1. apc-bridge.js
// =============================================================================================================
const NATIVE_FUNCTIONS = ['apc.info', 'apc.params.list', 'apc.param.set', 'apc.presets.save', 'apc.presets.list'];

function makeSandbox({ native = true, functions = NATIVE_FUNCTIONS, answer } = {}) {
  const posted = [];
  const errors = [];
  const win = { console };
  win.window = win;
  win.setTimeout = setTimeout;
  win.clearTimeout = clearTimeout;
  win.Promise = Promise;
  win.APC = {
    emit(name, data) { if (name === 'error') errors.push(data); },
  };
  const ctx = vm.createContext(win);
  if (native) {
    win.__JUCE__ = {
      postMessage(str) {
        const msg = JSON.parse(str);          // the real wire format: JSON { eventId, payload }
        posted.push(msg);
        if (msg.eventId !== '__juce__invoke' || !answer) return;
        const result = answer(msg.payload);
        if (result === undefined) return;     // never answers (timeout test)
        setImmediate(() => win.__JUCE__.backend.emitByBackend('__juce__complete', JSON.stringify({ promiseId: msg.payload.resultId, result })));
      },
      initialisationData: { __juce__platform: [], __juce__functions: functions.slice(), __juce__registeredGlobalEventIds: [], __juce__sliders: [], __juce__toggles: [], __juce__comboBoxes: [] },
    };
  }
  if (native) {
    // the real JUCE 9 frontend library (it creates window.__JUCE__.backend), exactly as the repo inlines it: strip the trailing ES export block
    let lib = fs.readFileSync(JUCE_INTEROP, 'utf8');
    lib = lib.slice(0, lib.lastIndexOf('\nexport {')) + '\nwindow.Juce = { getNativeFunction };\n';
    vm.runInContext(lib, ctx, { filename: 'juce-interop-index.js' });
  }
  vm.runInContext(fs.readFileSync(BRIDGE_JS, 'utf8'), ctx, { filename: 'apc-bridge.js' });
  return { win, ctx, posted, errors, bridge: win.APC.bridge };
}

const juceAvailable = fs.existsSync(JUCE_INTEROP);
// objects created inside the vm context have another realm's prototypes: compare their JSON form
const J = (x) => JSON.parse(JSON.stringify(x));

test('apc-bridge.js: classic ES5 script (no modules, no ES6 syntax)', () => {
  const src = fs.readFileSync(BRIDGE_JS, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/^\s*(import|export)\b/m.test(code) && !/\bimport\s*\(/.test(code), 'no import/export statements');
  assert.ok(!/=>/.test(code), 'no arrow functions');
  assert.ok(!/\b(let|const|class)\b/.test(code), 'no let/const/class');
  assert.ok(!/\?\.|\?\?/.test(code), 'no optional chaining / nullish coalescing');
  assert.ok(!/`/.test(code), 'no template literals');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(code), 'no network');
  assert.match(src, /"use strict"/);
  assert.match(src, /window\.APC = window\.APC \|\| \{\}/, 'never replaces window.APC');
});

test('apc-bridge.js: talks the real JUCE 9 protocol (__juce__invoke / __juce__complete) next to the interop library',
  { skip: juceAvailable ? false : 'JUCE not found' }, async () => {
    const s = makeSandbox({
      answer: (p) => (p.name === 'apc.info' ? { product: 'Demo', version: '1.2.3' } : p.name === 'apc.param.set' ? { value: p.params[0].value } : { name: p.name }),
    });
    const { bridge, posted, win } = s;
    assert.equal(bridge.isNative, true);
    assert.deepEqual(J(bridge.functions()).sort(), NATIVE_FUNCTIONS.slice().sort());
    assert.equal(bridge.has('apc.info'), true);
    assert.equal(bridge.has('apc.nope'), false);

    const info = await bridge.call('apc.info');
    assert.deepEqual(J(info), { product: 'Demo', version: '1.2.3' });
    const msg = posted.find((m) => m.eventId === '__juce__invoke');
    assert.equal(msg.payload.name, 'apc.info');
    assert.deepEqual(msg.payload.params, [{}], 'ONE argument object, {} when none is given');
    assert.ok(msg.payload.resultId >= 1e9, 'ids can never collide with the library promise counter');

    const set = await bridge.call('apc.param.set', { id: 'cutoff_hz', value: 440.5 });
    assert.deepEqual(J(set), { value: 440.5 });
    assert.deepEqual(posted[posted.length - 1].payload.params, [{ id: 'cutoff_hz', value: 440.5 }]);

    // the JUCE library's own getNativeFunction (id 0,1,2...) and ours share the "__juce__complete" event: no cross-talk
    const viaLib = win.Juce.getNativeFunction('apc.params.list');
    const [a, b] = await Promise.all([viaLib(), bridge.call('apc.presets.list', { sort: 'name' })]);
    assert.deepEqual(J(a), { name: 'apc.params.list' });
    assert.deepEqual(J(b), { name: 'apc.presets.list' });
    assert.equal(s.errors.length, 0);
  });

test('apc-bridge.js: error model - plugin errors are values, infrastructure failures are visible, never rejects', { skip: juceAvailable ? false : 'JUCE not found' }, async () => {
  const s = makeSandbox({
    answer: (p) => {
      if (p.name === 'apc.presets.save') return { error: 'gated', verb: 'PresetSave', message: 'locked' };
      if (p.name === 'apc.param.set') return { error: 'invalid', message: 'needs a number', path: 'x.json' };
      return { ok: true };
    },
  });
  const { bridge, errors } = s;
  const bad = await bridge.call('apc.param.set', { id: 'x' });
  assert.equal(bad.error, 'invalid');
  assert.equal(bad.message, 'needs a number');
  assert.equal(bad.path, 'x.json');
  assert.equal(bad.infra, undefined, 'a plugin answer is not an infrastructure failure');
  assert.equal(bridge.isError(bad), true);
  assert.equal(errors.length, 0, 'plugin errors are returned as values: the calling component presents them (no double toast)');

  const gated = await bridge.call('apc.presets.save', { name: 'a' });
  assert.equal(gated.error, 'gated');
  assert.equal(gated.verb, 'PresetSave');
  assert.equal(errors.length, 0, 'gated opens the activation sheet, it is not a toast');

  assert.equal(bridge.isError([1, 2]), false);
  assert.equal(bridge.isError({ error: 5 }), false);
  assert.equal(bridge.isError(null), false);

  // a call with a bad function name is a programming error nobody else would report
  const badName = await bridge.call('nope.x');
  assert.equal(badName.error, 'invalid');
  assert.equal(badName.infra, true);
  assert.equal(errors.length, 1);
  await bridge.call('nope.y', {}, { quiet: true });
  assert.equal(errors.length, 1, 'quiet suppresses the infrastructure event');
});

test('apc-bridge.js: per-call timeout resolves a visible error; unknown functions never hang', { skip: juceAvailable ? false : 'JUCE not found' }, async () => {
  const s = makeSandbox({ answer: () => undefined });   // native never answers
  const t0 = Date.now();
  const r = await s.bridge.call('apc.info', {}, { timeoutMs: 60 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.error, 'timeout');
  assert.match(r.message, /apc\.info/);
  assert.equal(s.errors.length, 1);
  assert.equal(s.errors[0].source, 'bridge:apc.info');

  // an older plugin build that does not register the function: immediate error, nothing posted (JUCE would never answer)
  const before = s.posted.length;
  const u = await s.bridge.call('apc.update.check');
  assert.equal(u.error, 'unknown_function');
  assert.equal(s.posted.length, before);
  assert.equal(s.errors.length, 2);
});

test('apc-bridge.js: native -> JS events (apc.<name>), unsubscribe, handler errors are visible', { skip: juceAvailable ? false : 'JUCE not found' }, async () => {
  const s = makeSandbox({ answer: () => ({}) });
  const { bridge, win, errors } = s;
  const got = [];
  const off = bridge.on('param', (p) => got.push(p));
  bridge.on('meter', (p) => got.push({ meter: p }));
  win.__JUCE__.backend.emitByBackend('apc.param', JSON.stringify({ id: 'cutoff_hz', value: 12 }));
  win.__JUCE__.backend.emitByBackend('apc.meter', JSON.stringify({ id: 'out', value: 0.5 }));
  win.__JUCE__.backend.emitByBackend('apc.preset', JSON.stringify({ state: {} }));   // nobody listens: ignored
  assert.deepEqual(J(got), [{ id: 'cutoff_hz', value: 12 }, { meter: { id: 'out', value: 0.5 } }]);
  off();
  win.__JUCE__.backend.emitByBackend('apc.param', JSON.stringify({ id: 'x', value: 1 }));
  assert.equal(got.length, 2);
  bridge.on('license', () => { throw new Error('boom'); });
  win.__JUCE__.backend.emitByBackend('apc.license', JSON.stringify({ state: 'DEMO' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /handler failed: license/);
});

test('apc-bridge.js: outside a native WebView it falls back to APC.mock (loaded AFTER the bridge) or fails visibly', async () => {
  for (const variant of ['no __JUCE__', 'JUCE interop placeholder']) {
    const s = makeSandbox({ native: false });
    if (variant === 'JUCE interop placeholder') s.win.__JUCE__ = { postMessage() {}, initialisationData: { __juce__functions: [] }, backend: { emitEvent() {}, addEventListener() {} } };
    assert.equal(s.bridge.isNative, false, variant);
    const none = await s.bridge.call('apc.info');
    assert.equal(none.error, 'no_backend', variant);
    assert.equal(s.errors.length, 1, 'visible, not silent');

    // apc-mock.js arrives later: resolved lazily at call time
    const calls = [];
    const subs = {};
    s.win.APC.mock = {
      call(name, args) { calls.push([name, args]); return Promise.resolve({ mocked: name }); },
      on(evt, fn) { subs[evt] = fn; },
    };
    const ok = await s.bridge.call('apc.params.list', { a: 1 });
    assert.deepEqual(J(ok), { mocked: 'apc.params.list' });
    assert.deepEqual(J(calls[0]), ['apc.params.list', { a: 1 }]);
    const seen = [];
    s.bridge.on('update', (p) => seen.push(p));
    assert.equal(typeof subs.update, 'function', 'events are wired to mock.on');
    subs.update({ state: 'Idle' });
    s.bridge._dispatch('update', { state: 'Checking' });
    assert.deepEqual(J(seen), [{ state: 'Idle' }, { state: 'Checking' }]);

    s.win.APC.mock.call = () => { throw new Error('mock broke'); };
    const broke = await s.bridge.call('apc.info');
    assert.equal(broke.error, 'mock_error');
  }
});

test('apc-bridge.js + the real apc-mock.js in the documented load order: calls, events, error shapes', async () => {
  const MOCK_JS = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui', 'apc-mock.js');
  if (!fs.existsSync(MOCK_JS)) return;   // sibling file not present in this checkout
  const s = makeSandbox({ native: false });
  vm.runInContext(fs.readFileSync(MOCK_JS, 'utf8'), s.ctx, { filename: 'apc-mock.js' });
  const B = s.win.APC.bridge;
  assert.equal(B.__apcBridge, true, 'the bridge stays APC.bridge when the mock loads after it');
  assert.equal(B.isNative, false);
  const info = await B.call('apc.info');
  assert.equal(typeof info.product, 'string');
  const list = await B.call('apc.presets.list', { scope: 'all' });
  assert.ok(list.total > 0);
  const events = [];
  B.on('preset', (p) => events.push(p));
  const state = await B.call('apc.presets.load', { id: list.items[0].id });
  assert.ok(state.current && state.ab, 'load answers the flat preset state');
  assert.ok(events.length >= 1, 'mock events reach APC.bridge.on listeners');
  const unknown = await B.call('apc.nope.nope');
  assert.equal(unknown.error, 'unknown_function');
  assert.equal(s.errors.length, 0, 'answers from the (mock) plugin are values, not infrastructure errors');
});

// =============================================================================================================
// 2. templates keep passing the repo's validators with the UI kit block
// =============================================================================================================
test('CMakeLists.txt.template: the UI kit block configures and injects the kit bundle into index.html (webview-008)',
  { skip: which('cmake') ? false : 'cmake not found on PATH' }, () => {
    const cmakeTpl = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'webview', 'CMakeLists.txt.template'), 'utf8').replace(/\r\n/g, '\n');
    const start = cmakeTpl.indexOf('# ============================================\n# APC UI KIT BRIDGE (opt-in)');
    const end = cmakeTpl.indexOf('# CRITICAL: Embed web UI files into binary');
    assert.ok(start > 0 && end > start);
    const block = cmakeTpl.slice(start, end)
      .replace(/\{\{PLUGIN_NAME_LOWER\}\}/g, 'fixture').replace(/\{\{PLUGIN_DISPLAY_NAME\}\}/g, 'Fixture').replace(/\{\{APC_UI_KIT_ENABLED\}\}/g, 'ON');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-kit-cmake-'));
    try {
      fs.mkdirSync(path.join(tmp, 'Source', 'ui', 'public'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'Source', 'ui', 'public', 'index.html'), '<html><body>\n<!-- APC_KIT_SCRIPTS -->\n<p>after</p></body></html>\n');
      fs.writeFileSync(path.join(tmp, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.22)\nproject(KitBlock NONE)\n${block}\nmessage(STATUS "KIT_INDEX=\${APC_KIT_INDEX_HTML}")\nmessage(STATUS "KIT_EXTRA=[\${APC_KIT_WEBUI_SOURCES}]")\n`);
      const r = spawnSync('cmake', ['-S', tmp, '-B', path.join(tmp, 'b'), `-DAPC_ROOT=${REPO_ROOT.replace(/\\/g, '/')}`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout, /KIT_EXTRA=\[\]/, 'placeholder present: nothing is embedded as a separate JS resource');
      const gen = path.join(tmp, 'b', 'apc-ui', 'index.html');
      assert.ok(fs.existsSync(gen), 'generated index.html');
      const html = fs.readFileSync(gen, 'utf8').replace(/\r\n/g, '\n');
      assert.ok(!html.includes('APC_KIT_SCRIPTS'), 'placeholder replaced');
      assert.ok(html.startsWith('<html><body>\n<script>\n') && html.endsWith('</script>\n<p>after</p></body></html>\n'));
      const kitDir = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui');
      const order = ['apc-fit.js', 'apc-kit.js', 'apc-bridge.js'];
      for (const f of fs.readdirSync(kitDir).filter((n) => /^apc-.*\.js$/.test(n)).sort()) if (!order.includes(f) && !/^apc-mock/.test(f)) order.push(f);
      let last = -1;
      for (const f of order) {
        const body = fs.readFileSync(path.join(kitDir, f), 'utf8').replace(/\r\n/g, '\n');
        const at = html.indexOf(body.trim());
        assert.ok(at > last, `${f} is embedded verbatim, in load order`);
        last = at;
      }
      assert.ok(!html.includes('/* ---- apc-mock.js ----') && !html.includes('/* ---- apc-mock-viz.js ----'), 'the mocks (apc-mock*.js) are never shipped');
      // without the placeholder it falls back to a separate resource and warns
      fs.writeFileSync(path.join(tmp, 'Source', 'ui', 'public', 'index.html'), '<html></html>');
      const r2 = spawnSync('cmake', ['-S', tmp, '-B', path.join(tmp, 'b2'), `-DAPC_ROOT=${REPO_ROOT.replace(/\\/g, '/')}`], { encoding: 'utf8' });
      assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
      assert.match(r2.stdout + r2.stderr, /no <!-- APC_KIT_SCRIPTS --> placeholder/);
      assert.match(r2.stdout, /KIT_EXTRA=\[.*apc-kit\.bundle\.js\]/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

test('webview templates: UI kit blocks are guarded and `apc validate webview-order` still passes', () => {
  const tpl = (f) => fs.readFileSync(path.join(REPO_ROOT, 'templates', 'webview', f), 'utf8');
  const h = tpl('PluginEditor.h.template');
  const cpp = tpl('PluginEditor.cpp.template');
  const cmake = tpl('CMakeLists.txt.template');
  // every kit line sits inside #if APC_UI_KIT ... #endif (balanced, no stray use)
  for (const [name, text] of [['h', h], ['cpp', cpp]]) {
    const lines = text.split(/\r?\n/);
    let depth = 0; let inKit = false;
    for (const line of lines) {
      if (/^#if APC_UI_KIT/.test(line)) { assert.equal(inKit, false, `${name}: nested kit block`); inKit = true; depth++; continue; }
      if (inKit && /^#endif/.test(line)) { inKit = false; depth--; continue; }
      if (!inKit && /apcBridge|apc::web|apcBackend/.test(line) && !/^\s*\/\//.test(line) && !/^\/\//.test(line)) {
        assert.fail(`${name}: kit symbol outside #if APC_UI_KIT: ${line.trim()}`);
      }
    }
    assert.equal(depth, 0, `${name}: unbalanced #if APC_UI_KIT`);
  }
  assert.match(cmake, /option\(\{\{PLUGIN_NAME_LOWER\}\}_UI_KIT /);
  assert.match(cmake, /APC_UI_KIT=1/);
  assert.match(cmake, /<!-- APC_KIT_SCRIPTS -->/);
  assert.match(cpp, /apc::web::addApcNativeFunctions/);
  assert.match(cpp, /apcBridge\.attach \(\*webView\);/);
  assert.ok(cpp.indexOf('goToURL') < cpp.indexOf('apcBridge.attach'), 'attach comes AFTER goToURL');
  assert.ok(h.indexOf('apcBridge') > h.indexOf('{{ADDITIONAL_RELAYS}}') && h.indexOf('apcBridge') < h.indexOf('std::unique_ptr<juce::WebBrowserComponent> webView'),
    'bridge is declared after the relays and before the webView');

  // run the repo's own validator on the filled-in header. bin/apc.js resolves its root from cwd, so use a throw-away root.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-order-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.copyFileSync(path.join(REPO_ROOT, 'bin', 'apc.js'), path.join(root, 'bin', 'apc.js'));
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
    fs.writeFileSync(path.join(root, 'apc.config.json'), JSON.stringify({ paths: { plugins_dir: 'plugins' } }));
    const src = path.join(root, 'plugins', 'Fixture', 'Source');
    fs.mkdirSync(src, { recursive: true });
    const filled = h.replace(/\{\{PLUGIN_NAME_LOWER\}\}/g, 'fixture').replace(/\{\{PLUGIN_NAME\}\}/g, 'Fixture')
      .replace(/\{\{PLATE_W\}\}/, '600').replace(/\{\{PLATE_H\}\}/, '400').replace(/\{\{MIN_SCALE\}\}/, '0.5').replace(/\{\{MAX_SCALE\}\}/, '2.0')
      .replace(/\{\{PARAMETER_NAME\}\}/, 'drive').replace(/\{\{PARAMETER_ID\}\}/, 'DRIVE')
      .replace(/\{\{ADDITIONAL_RELAYS\}\}/, '').replace(/\{\{PARAMETER_ATTACHMENTS\}\}/, '');
    fs.writeFileSync(path.join(src, 'PluginEditor.h'), filled);
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'apc.js'), 'validate', 'webview-order', '--plugin', 'Fixture', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const rep = JSON.parse(r.stdout);
    assert.deepEqual(rep.issues, []);
    assert.ok(rep.checks.some((c) => c.check === 'relays-before-webview' && c.status === 'pass'));

    // negative control: the validator really does see a bridge-before-relay mistake class (relay AFTER webView)
    const broken = filled.replace('std::unique_ptr<juce::WebBrowserComponent> webView;', 'std::unique_ptr<juce::WebBrowserComponent> webView;\n    juce::WebSliderRelay lateRelay { "late" };');
    fs.writeFileSync(path.join(src, 'PluginEditor.h'), broken);
    const bad = spawnSync(process.execPath, [path.join(root, 'bin', 'apc.js'), 'validate', 'webview-order', '--plugin', 'Fixture', '--json'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================================================
// 3 + 4. C++ (real compile + run)
// =============================================================================================================
function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function findMsvcVcvars() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  try {
    const out = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
    if (!out) return null;
    const bat = path.join(out.split(/\r?\n/)[0], 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    return fs.existsSync(bat) ? bat : null;
  } catch { return null; }
}

function detectToolchain() {
  if (process.env.APC_SKIP_CPP_JUCE === '1') return { skip: 'APC_SKIP_CPP_JUCE=1' };
  if (!which('cmake')) return { skip: 'cmake not found on PATH' };
  if (!fs.existsSync(path.join(JUCE_DIR, 'CMakeLists.txt'))) return { skip: '_tools/JUCE missing (git submodule update --init)' };
  if (process.platform === 'win32') {
    const vcvars = findMsvcVcvars();
    if (vcvars) return { vcvars };
    if (which('cl')) return { vcvars: null };
    return { skip: 'MSVC not found (vswhere / cl)' };
  }
  for (const c of ['c++', 'g++', 'clang++']) if (which(c)) return { vcvars: null };
  return { skip: 'no C++ compiler found' };
}

const toolchain = detectToolchain();

// Run a command line, through vcvars64.bat on Windows so cl/link are on PATH whatever generator CMake picks.
function run(cmdline, opts = {}) {
  if (process.platform === 'win32' && toolchain.vcvars) {
    const bat = path.join(opts.dir, `step-${Math.random().toString(36).slice(2)}.bat`);
    fs.writeFileSync(bat, ['@echo off', `call "${toolchain.vcvars}" >nul 2>&1`, cmdline, 'exit /b %errorlevel%'].join('\r\n') + '\r\n');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${bat}"`], { encoding: 'utf8', windowsVerbatimArguments: true, maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout || 3600000 });
  }
  return spawnSync(cmdline, { shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout || 3600000 });
}

function tail(r, n = 40) {
  return (r.stdout + '\n' + r.stderr).split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
}

function findExe(buildDir, target) {
  const name = process.platform === 'win32' ? `${target}.exe` : target;
  for (const cfg of ['Release', '']) {
    const p = path.join(buildDir, `${target}_artefacts`, cfg, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function nodeIndex(dir) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'apc.js'), 'presets', 'index', dir, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `apc presets index failed: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

let shared = null;   // build dir shared by the two C++ tests (one configure, two targets)

function configureAndBuild() {
  if (shared) return shared;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-cpp-juce-'));
  const buildDir = path.join(tmp, 'build');
  const src = TESTS_DIR.replace(/\\/g, '/');
  const root = REPO_ROOT.replace(/\\/g, '/');
  const bd = buildDir.replace(/\\/g, '/');
  // The WebView2 SDK comes from NuGet; use it when CMake can get it (offline CI falls back to a variant without the resource provider).
  const attempts = process.platform === 'win32' ? ['ON', 'OFF'] : ['OFF'];
  let wv2 = 'OFF';
  let cfg = null;
  for (const mode of attempts) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    cfg = run(`cmake -S "${src}" -B "${bd}" -DAPC_ROOT="${root}" -DAPC_WEBVIEW2_STATIC=${mode}`, { dir: tmp, timeout: 900000 });
    if (cfg.status === 0) { wv2 = mode; break; }
  }
  assert.equal(cfg.status, 0, `cmake configure failed:\n${tail(cfg)}`);
  const b1 = run(`cmake --build "${bd}" --config Release --target apc_juce_tests`, { dir: tmp });
  assert.equal(b1.status, 0, `build apc_juce_tests failed:\n${tail(b1, 60)}`);
  shared = { tmp, buildDir, wv2, bd, b1 };
  return shared;
}

process.on('exit', () => { if (shared) { try { fs.rmSync(shared.tmp, { recursive: true, force: true }); } catch { /* ignore */ } } });

test('JUCE native store + bridge: build with CMake/MSVC, run all tests, cross-check against `apc presets index`',
  { skip: toolchain.skip || false, timeout: 3600000 }, () => {
    const s = configureAndBuild();
    const exe = findExe(s.buildDir, 'apc_juce_tests');
    assert.ok(exe, 'apc_juce_tests binary not found');

    // Node reference index of the SAME fixtures (+ seeded ratings/favorites), then the C++ cross-check
    const xc = path.join(s.tmp, 'xcheck');
    for (const [plug, fixture] of [['Typed', 'typed-valid'], ['Flat', 'flat-valid']]) {
      const dest = path.join(xc, 'Mfr', plug);
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(path.join(REPO_ROOT, 'test', 'fixtures', 'presets', fixture, 'presets'), path.join(dest, 'presets'), { recursive: true });
    }
    fs.writeFileSync(path.join(xc, 'Mfr', 'Typed', 'user-data.json'), JSON.stringify({
      schema: 'apc-user-data/1.0',
      assets: {
        'snd_00000000-0000-4000-8000-000000000010': { rating: 5, favorite: true, uses: 3 },
        'snd_00000000-0000-4000-8000-000000000011': { rating: 2 },
        'pat_00000000-0000-4000-8000-000000000040': { favorite: true },
        'ghost-id-without-a-file': { rating: 4 },
      },
    }));
    fs.writeFileSync(path.join(xc, 'Mfr', 'Flat', 'user-data.json'), JSON.stringify({ schema: 'apc-user-data/1.0', assets: { 'pre_00000000-0000-4000-8000-000000000002': { rating: 3, favorite: true } } }));
    const nodeTyped = nodeIndex(path.join(xc, 'Mfr', 'Typed'));
    const nodeFlat = nodeIndex(path.join(xc, 'Mfr', 'Flat'));
    assert.equal(nodeTyped.rows, 6);
    assert.equal(nodeFlat.rows, 3);

    const r = spawnSync(exe, ['--xcheck', xc], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
    assert.equal(r.status, 0, `C++ tests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /, 0 failure\(s\)/);
    assert.doesNotMatch(r.stdout, /\[FAIL\]/);
    assert.doesNotMatch(r.stdout, /\(skipped/);
    for (const name of [
      'scan_typed_pack', 'scan_flat_pack', 'index_invalidation_by_mtime_and_size', 'list_scope_filters_search_sort',
      'user_data_sidecar_ratings_favorites', 'load_applies_defaults_first_and_reports', 'save_roundtrip_copy_on_write_and_overwrite_rules',
      'atomic_write_kill_between_temp_and_rename', 'dirty_tracking_revert_init_and_ab_slots', 'reference_resolution_and_missing_placeholder',
      'defaults_first_golden_load', 'import_without_clobber_and_pack_zip_roundtrip', 'host_chunk_roundtrip_with_engine_section',
      'pending_swap_audio_thread_handoff', 'xcheck_identical_to_node_index', 'bridge_function_list_matches_contract_md',
      'bridge_open_url_allow_list', 'bridge_license_glue', 'bridge_update_glue_never_blocks_message_thread', 'bridge_diagnostics_are_local_and_redacted',
    ]) assert.match(r.stdout, new RegExp(`\\[ ok \\] ${name}\\b`), `missing/failed: ${name}`);

    // the cache the C++ store left behind is valid for the Node tool: every row is reused (same mtime+size semantics)
    for (const [plug, rows] of [['Typed', 6], ['Flat', 3]]) {
      const again = nodeIndex(path.join(xc, 'Mfr', plug));
      assert.equal(again.stats.reused, rows, `${plug}: Node did not reuse the C++ written cache`);
      assert.equal(again.stats.reparsed, 0);
    }
  });

test('JUCE native glue: APVTS adapter tests run; WebBrowserComponent wiring compiles and links (never run)',
  { skip: toolchain.skip || false, timeout: 3600000 }, () => {
    const s = configureAndBuild();
    const b2 = run(`cmake --build "${s.bd}" --config Release --target apc_juce_gui_tests`, { dir: s.tmp });
    assert.equal(b2.status, 0, `build apc_juce_gui_tests failed (WebView2 static=${s.wv2}):\n${tail(b2, 60)}`);
    const exe = findExe(s.buildDir, 'apc_juce_gui_tests');
    assert.ok(exe, 'apc_juce_gui_tests binary not found');
    const plain = spawnSync(exe, [], { encoding: 'utf8', timeout: 60000 });
    assert.equal(plain.status, 0, `${plain.stdout}\n${plain.stderr}`);
    assert.match(plain.stdout, /compile-check only/);
    const r = spawnSync(exe, ['--run-apvts'], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, `APVTS tests failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /, 0 failure\(s\)/);
    assert.doesNotMatch(r.stdout, /\[FAIL\]/);
    assert.match(r.stdout, /\[ ok \] apvts_golden_defaults_first_load_save_and_chunk/);
    // report which WebView variant was actually compiled (visible in the test log)
    console.log(`# apc_juce_gui_tests: WebBrowserComponent wiring compiled with WebView2 static linking = ${s.wv2} (resource provider ${s.wv2 === 'ON' ? 'included' : 'NOT compiled: UNVERIFIED in this run'})`);
  });
