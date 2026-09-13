'use strict';
// apc CLI test suite. Zero deps: node:test + node:assert (Node 18+).
// Run: npm test  (== node --test test/)
// Every test runs the CLI against an isolated temp fixture via APC_ROOT,
// so the real repo is never touched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');

function makeRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(content)) fs.writeFileSync(full, content);
    else fs.writeFileSync(full, content, 'utf8');
  }
  return dir;
}

function run(args, root) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, APC_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function pkgFixture(version) {
  return JSON.stringify({ name: 'apc-fixture', version });
}

const GOOD_HEADER = `#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
class MyEditor : public juce::AudioProcessorEditor {
private:
    juce::WebSliderRelay gainRelay { "GAIN" };
    std::unique_ptr<juce::WebBrowserComponent> webView;
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
};
`;

const GOOD_CPP = `#include "PluginEditor.h"
// WebBrowserComponent withBackend(webview2) withUserDataFolder
// withNativeIntegrationEnabled withResourceProvider getResourceProviderRoot
// WebSliderRelay WebSliderParameterAttachment
// getResource juce::String url getZipFile BinaryData::getNamedResource
`;

const GOOD_CMAKE = `juce_add_plugin(P FORMATS VST3 Standalone NEEDS_WEBVIEW2 TRUE)
target_compile_definitions(P PUBLIC JUCE_WEB_BROWSER=1 JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
target_link_libraries(P PRIVATE juce::juce_gui_extra)
juce_add_binary_data(P_WebUI SOURCES Source/ui/public/index.html)
`;

const GOOD_HTML = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head>
<body><h1>x</h1><script>const Juce = window.Juce;</script></body></html>`;

function goodWebviewPlugin() {
  return {
    'plugins/Demo/CMakeLists.txt': GOOD_CMAKE,
    'plugins/Demo/Source/PluginEditor.h': GOOD_HEADER,
    'plugins/Demo/Source/PluginEditor.cpp': GOOD_CPP,
    'plugins/Demo/Source/ui/public/index.html': GOOD_HTML,
    'plugins/Demo/Source/ui/public/js/index.js': '// demo',
    'plugins/Demo/Source/ui/public/js/juce/index.js': '// juce interop',
  };
}

function goodStatus(name, phase) {
  return JSON.stringify({
    plugin_name: name, version: 'v0.0.1', current_phase: phase,
    ui_framework: 'webview', complexity_score: 2,
    created_at: '2026-01-01T00:00:00Z', last_modified: '2026-01-01T00:00:00Z',
    phase_history: [], validation: {}, framework_selection: {}, error_recovery: {},
  });
}

// ─── version ───────────────────────────────────────────────────────────────
test('version prints the fixture package.json version', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  const r = run(['version'], root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /apc 9\.9\.9/);
});

test('version --json reports version + source path', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  const r = run(['version', '--json'], root);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.version, '9.9.9');
  assert.ok(o.source.endsWith('package.json'));
});

test('--version and -v aliases work', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  assert.match(run(['--version'], root).stdout, /apc 9\.9\.9/);
  assert.match(run(['-v'], root).stdout, /apc 9\.9\.9/);
});

// ─── usage errors ──────────────────────────────────────────────────────────
test('unknown command exits 2', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  assert.equal(run(['frobnicate'], root).status, 2);
});

test('build without plugin exits 2', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  assert.equal(run(['build'], root).status, 2);
});

test('validate without kind exits 2; webview without --plugin exits 2', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  assert.equal(run(['validate'], root).status, 2);
  assert.equal(run(['validate', 'bogus', '--plugin', 'X'], root).status, 2);
  assert.equal(run(['validate', 'webview'], root).status, 2);
});

// ─── paths ─────────────────────────────────────────────────────────────────
test('paths resolves custom relative dirs against the root', () => {
  const root = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'apc.config.json': JSON.stringify({ paths: { plugins_dir: '../ext_p', build_dir: '../ext_b', release_dir: '../ext_r' } }),
  });
  const r = run(['paths', '--json', '--plugin', 'Demo'], root);
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.equal(o.pluginsDir, path.resolve(root, '../ext_p'));
  assert.equal(o.buildDir, path.resolve(root, '../ext_b'));
  assert.equal(o.releaseDir, path.resolve(root, '../ext_r'));
  assert.equal(o.pluginDir, path.join(path.resolve(root, '../ext_p'), 'Demo'));
});

test('paths falls back to in-repo defaults without config', () => {
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9') });
  const o = JSON.parse(run(['paths', '--json'], root).stdout);
  assert.equal(o.pluginsDir, path.join(root, 'plugins'));
});

test('paths tolerates a BOM-prefixed apc.config.json', () => {
  const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(JSON.stringify({ paths: { plugins_dir: 'p2' } }), 'utf8')]);
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9'), 'apc.config.json': bom });
  const o = JSON.parse(run(['paths', '--json'], root).stdout);
  assert.equal(o.pluginsDir, path.join(root, 'p2'));
});

// ─── native validators ─────────────────────────────────────────────────────
test('member-order passes on correct order, fails when swapped', () => {
  const good = makeRoot({ 'package.json': pkgFixture('9.9.9'), ...goodWebviewPlugin() });
  assert.equal(run(['validate', 'webview-order', '--plugin', 'Demo'], good).status, 0);

  const badHeader = `#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
class MyEditor : public juce::AudioProcessorEditor {
private:
    juce::WebSliderRelay gainRelay { "GAIN" };
    std::unique_ptr<juce::WebSliderParameterAttachment> gainAttachment;
    std::unique_ptr<juce::WebBrowserComponent> webView;
};
`;
  const bad = makeRoot({
    'package.json': pkgFixture('9.9.9'), ...goodWebviewPlugin(),
    'plugins/Demo/Source/PluginEditor.h': badHeader,
  });
  const r = run(['validate', 'webview-order', '--plugin', 'Demo'], bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /BEFORE WebView/);
});

test('webview validator flags missing binary-data, passes a good plugin', () => {
  const bad = makeRoot({
    'package.json': pkgFixture('9.9.9'), ...goodWebviewPlugin(),
    'plugins/Demo/CMakeLists.txt': 'juce_add_plugin(P FORMATS VST3 Standalone)\n',
  });
  const r = run(['validate', 'webview', '--plugin', 'Demo'], bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /juce_add_binary_data/);

  const good = makeRoot({ 'package.json': pkgFixture('9.9.9'), ...goodWebviewPlugin() });
  assert.equal(run(['validate', 'webview', '--plugin', 'Demo'], good).status, 0);
});

test('plugin validator flags missing schema fields, passes a good status', () => {
  const bad = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'plugins/Demo/status.json': JSON.stringify({ plugin_name: 'Demo' }),
  });
  const r = run(['validate', 'plugin', '--plugin', 'Demo'], bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Missing required field/);

  const good = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'plugins/Demo/.ideas/creative-brief.md': '# brief',
    'plugins/Demo/.ideas/parameter-spec.md': '# params',
    'plugins/Demo/.ideas/architecture.md': '# arch',
    'plugins/Demo/Design/v1-ui-spec.md': '# ui',
    'plugins/Demo/Source/PluginProcessor.cpp': '// dsp',
    'plugins/Demo/status.json': goodStatus('Demo', 'code_complete'),
  });
  assert.equal(run(['validate', 'plugin', '--plugin', 'Demo'], good).status, 0);
});

test('visage validator passes a good plugin, flags a missing link', () => {
  const base = {
    'package.json': pkgFixture('9.9.9'),
    'CMakeLists.txt': 'project(Foo VERSION 9.9.9)\n# APC_ENABLE_VISAGE\nadd_subdirectory("${VISAGE_DIR}")\n# visage::visage alias\n',
    'plugins/Vis/Source/VisageControls.h': '// controls',
    'plugins/Vis/Source/PluginEditor.h': '#include "VisageJuceHost.h"\nclass E : public VisagePluginEditor {};\n',
    'plugins/Vis/Source/PluginEditor.cpp': '// editor',
    'plugins/Vis/status.json': goodStatus('Vis', 'code_complete').replace('"ui_framework": "webview"', '"ui_framework": "visage"'),
  };
  const goodCmake = 'juce_add_plugin(V FORMATS VST3 Standalone)\ntarget_link_libraries(V PRIVATE visage::visage)\n';
  const good = makeRoot({ ...base, 'plugins/Vis/CMakeLists.txt': goodCmake });
  assert.equal(run(['validate', 'visage', '--plugin', 'Vis'], good).status, 0);

  const bad = makeRoot({ ...base, 'plugins/Vis/CMakeLists.txt': 'juce_add_plugin(V FORMATS VST3 Standalone)\n' });
  const r = run(['validate', 'visage', '--plugin', 'Vis'], bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /visage::visage/);
});

function shippedStatus(name, version) {
  return JSON.stringify({
    plugin_name: name, version, current_phase: 'ship_complete',
    ui_framework: 'webview', complexity_score: 3,
    created_at: '2026-01-01T00:00:00Z', last_modified: '2026-08-01T00:00:00Z',
    phase_history: [{ phase: 'shipped', version, completed_at: '2026-08-01T00:00:00Z' }],
    validation: {
      creative_brief_exists: true, parameter_spec_exists: true,
      architecture_defined: true, ui_framework_selected: true,
      design_complete: true, code_complete: true,
      tests_passed: true, ship_ready: true,
    },
    framework_selection: {}, error_recovery: { error_log: [] },
  });
}

function shippedRoot(name, version) {
  return makeRoot({
    'package.json': pkgFixture('9.9.9'),
    [`plugins/${name}/status.json`]: shippedStatus(name, version),
    [`plugins/${name}/.ideas/creative-brief.md`]: '# brief',
  });
}

function readStatusJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'plugins', name, 'status.json'), 'utf8'));
}

// ─── generations ───────────────────────────────────────────────────────────
test('patch opens on shipped: bump, pointer, flags, backfill, snapshot', () => {
  const root = shippedRoot('Demo', 'v1.0');
  const r = run(['patch', 'Demo'], root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /v1\.0\.1/);
  const s = readStatusJson(root, 'Demo');
  assert.equal(s.version, 'v1.0.1');
  assert.equal(s.current_phase, 'code');
  assert.equal(s.validation.design_complete, true); // design untouched
  assert.equal(s.validation.tests_passed, false);
  assert.equal(s.validation.ship_ready, false);
  assert.equal(s.current_generation.kind, 'patch');
  assert.equal(s.current_generation.status, 'open');
  assert.equal(s.generations.length, 1); // backfilled frozen v1.0
  assert.equal(s.generations[0].version, 'v1.0');
  assert.equal(s.generations[0].status, 'shipped');
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'Demo', s.current_generation.backup_file)));
  assert.ok(!s.current_generation.brief); // patch writes no brief
});

test('evolve opens with codename, brief stub, and reset design flags', () => {
  const root = shippedRoot('Demo', 'v1.0');
  const r = run(['evolve', 'Demo', '--codename', 'Warmth'], root);
  assert.equal(r.status, 0);
  const s = readStatusJson(root, 'Demo');
  assert.equal(s.version, 'v1.1');
  assert.equal(s.current_phase, 'plan');
  assert.equal(s.current_generation.codename, 'Warmth');
  assert.equal(s.validation.design_complete, false);
  assert.equal(s.validation.creative_brief_exists, true); // foundation intact
  assert.ok(s.current_generation.brief.endsWith('-brief.md'));
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'Demo', s.current_generation.brief)));
});

test('second open while one is open exits 1; open on unshipped exits 1', () => {
  const root = shippedRoot('Demo', 'v1.0');
  assert.equal(run(['patch', 'Demo'], root).status, 0);
  assert.equal(run(['evolve', 'Demo'], root).status, 1);

  const early = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'plugins/Early/status.json': goodStatus('Early', 'code'),
  });
  const r = run(['patch', 'Early'], early);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /not shipped/);
});

test('freeze records tag, returns machine to rest, keeps lineage', () => {
  const root = shippedRoot('Demo', 'v1.0');
  assert.equal(run(['patch', 'Demo'], root).status, 0);
  const r = run(['freeze', 'Demo'], root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /v1\.0\.1-Demo/);
  const s = readStatusJson(root, 'Demo');
  assert.equal(s.current_phase, 'ship_complete');
  assert.equal(s.current_generation, null);
  assert.equal(s.generations.length, 2);
  assert.equal(s.generations[1].status, 'shipped');
  // next patch continues the lineage, no duplicate backfill
  assert.equal(run(['patch', 'Demo'], root).status, 0);
  const s2 = readStatusJson(root, 'Demo');
  assert.equal(s2.version, 'v1.0.2');
  assert.equal(s2.generations.length, 2);
});

test('freeze with no open generation exits 1', () => {
  const root = shippedRoot('Demo', 'v1.0');
  assert.equal(run(['freeze', 'Demo'], root).status, 1);
});

test('version math: three-part versions and v0 base', () => {
  const a = shippedRoot('A', 'v1.0.0');
  assert.equal(run(['patch', 'A'], a).status, 0);
  assert.equal(readStatusJson(a, 'A').version, 'v1.0.1');
  const b = shippedRoot('B', 'v1.0.0');
  assert.equal(run(['evolve', 'B'], b).status, 0);
  assert.equal(readStatusJson(b, 'B').version, 'v1.1.0');
  const c = shippedRoot('C', 'v0.0.0');
  assert.equal(run(['evolve', 'C'], c).status, 0);
  assert.equal(readStatusJson(c, 'C').version, 'v0.1.0');
});

test('status --json reports frozen flag and lineage', () => {
  const root = shippedRoot('Demo', 'v1.0');
  const frozen = JSON.parse(run(['status', '--plugin', 'Demo', '--json'], root).stdout);
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.generations.length, 0);
  assert.equal(run(['patch', 'Demo'], root).status, 0);
  const open = JSON.parse(run(['status', '--plugin', 'Demo', '--json'], root).stdout);
  assert.equal(open.frozen, false);
  assert.equal(open.open_generation.kind, 'patch');
  assert.equal(open.generations.length, 1);
});

test('plugin validator skips hidden dirs in all-plugins mode', () => {
  const root = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'plugins/.git/HEAD': 'ref: refs/heads/main',
    'plugins/Demo/.ideas/creative-brief.md': '# brief',
    'plugins/Demo/.ideas/parameter-spec.md': '# params',
    'plugins/Demo/.ideas/architecture.md': '# arch',
    'plugins/Demo/Design/v1-ui-spec.md': '# ui',
    'plugins/Demo/Source/PluginProcessor.cpp': '// dsp',
    'plugins/Demo/status.json': goodStatus('Demo', 'code_complete'),
  });
  const r = run(['validate', 'plugin'], root);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /\.git/);
});

// ─── version sync ──────────────────────────────────────────────────────────
test('version sync detects drift and --fix aligns hub + cmake', () => {
  const root = makeRoot({
    'package.json': pkgFixture('9.9.9'),
    'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.22)\nproject(Foo VERSION 1.2.3 LANGUAGES C CXX)\n',
  });
  assert.equal(run(['version', 'sync'], root).status, 1);
  const r = run(['version', 'sync', '--fix'], root);
  assert.equal(r.status, 0);
  const hubJs = fs.readFileSync(path.join(root, 'hub', 'version.js'), 'utf8');
  assert.match(hubJs, /APC_VERSION = "9\.9\.9"/);
  const cmake = fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8');
  assert.match(cmake, /VERSION 9\.9\.9/);
  assert.equal(run(['version', 'sync'], root).status, 0);
});

// ─── backend dispatch (stubbed .ps1) ───────────────────────────────────────
test('build translates CLI flags to .ps1 parameters', () => {
  const stub = 'param([string]$PluginName,[switch]$NoInstall)\nWrite-Output "STUB build name=$PluginName noinstall=$NoInstall"\n';
  const root = makeRoot({ 'package.json': pkgFixture('9.9.9'), 'scripts/build-and-install.ps1': stub });
  if (process.platform !== 'win32') return; // .ps1 dispatch runs on Windows (powershell); .sh elsewhere
  const r = run(['build', 'Demo', '--no-install'], root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /STUB build name=Demo noinstall=True/);
});
