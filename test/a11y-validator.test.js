'use strict';
// a11y + perf-budget validator (scripts/validators/a11y.js). Zero deps.
// Fixtures: test/fixtures/a11y/{good,bad,kit,visage,empty}.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const FIX = path.join(__dirname, 'fixtures', 'a11y');
const a11y = require(path.join(REPO_ROOT, 'scripts', 'validators', 'a11y.js'));

function run(name, opts) {
  return a11y.validate(path.join(FIX, name), { root: REPO_ROOT, ...(opts || {}) });
}
function byCheck(result) {
  const map = {};
  for (const c of result.checks) map[c.check] = c;
  return map;
}

test('contract: every check has {check, status, message} with a valid status', () => {
  for (const name of ['good', 'bad', 'kit', 'visage', 'empty']) {
    const { checks } = run(name);
    assert.ok(Array.isArray(checks) && checks.length > 0, name);
    for (const c of checks) {
      assert.equal(typeof c.check, 'string');
      assert.ok(['pass', 'fail', 'warn', 'info'].includes(c.status), `${name}/${c.check}: ${c.status}`);
      assert.equal(typeof c.message, 'string');
      assert.ok(c.message.length > 0);
    }
  }
});

test('colour maths: hex / rgb / hsl parsing and WCAG ratios', () => {
  const p = a11y.parseColor;
  assert.deepEqual(p('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(p('#000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(Math.round(p('#ff000080').a * 100), 50);
  assert.deepEqual(p('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(p('rgb(10 20 30 / 50%)'), { r: 10, g: 20, b: 30, a: 0.5 });
  const hsl = p('hsl(0, 100%, 50%)');
  assert.deepEqual([Math.round(hsl.r), Math.round(hsl.g), Math.round(hsl.b)], [255, 0, 0]);
  assert.equal(p('not-a-colour'), null);
  assert.equal(p('var(--x)'), null);
  const white = p('#fff');
  const black = p('#000');
  assert.equal(Math.round(a11y.contrastRatio(white, black) * 100) / 100, 21);
  // #767676 on white is the classic 4.54:1 boundary of AA
  const r = a11y.contrastRatio(p('#767676'), white);
  assert.ok(r > 4.5 && r < 4.6, String(r));
  assert.ok(a11y.contrastRatio(p('#777777'), white) < 4.5 + 0.1);
  assert.equal(a11y.resolveColor('var(--a)', { '--a': 'var(--b)', '--b': '#123456' }).r, 0x12);
  assert.equal(a11y.resolveColor('var(--missing, #fff)', {}).r, 255);
  assert.equal(a11y.resolveColor('var(--missing)', {}), null);
});

test('good WebView fixture: no failures or warnings, every check family reported', () => {
  const res = run('good');
  const bad = res.checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  assert.deepEqual(bad, [], JSON.stringify(bad, null, 2));
  const m = byCheck(res);
  for (const id of ['contrast-text', 'contrast-ui', 'keyboard-reach', 'accessible-names', 'focus-visible',
    'hover-only-info', 'reduced-motion', 'perf-animated-elements', 'perf-backdrop-filter', 'perf-shadows',
    'perf-meter-rate', 'perf-webview-overhead']) {
    assert.ok(m[id], 'missing check ' + id);
  }
  // both declared themes were evaluated
  assert.match(m['contrast-text'].message, /themes evaluated: default, day/);
  assert.match(m['perf-webview-overhead'].message, /92 MB <= budget 120 MB/);
  assert.match(m['perf-meter-rate'].message, /30 Hz/);
});

test('bad WebView fixture: contrast fails in BOTH themes', () => {
  const m = byCheck(run('bad'));
  assert.equal(m['contrast-text'].status, 'fail');
  assert.match(m['contrast-text'].message, /\[default\]/);
  assert.match(m['contrast-text'].message, /\[day\]/);
  assert.match(m['contrast-text'].message, /needs 4\.5:1/);
  assert.equal(m['contrast-ui'].status, 'warn'); // boundary colours are heuristic -> warn
  assert.match(m['contrast-ui'].message, /3:1/);
});

test('bad WebView fixture: keyboard reach, names, focus, hover/title, motion', () => {
  const m = byCheck(run('bad'));
  assert.equal(m['keyboard-reach'].status, 'fail');
  assert.match(m['keyboard-reach'].message, /knob/);
  assert.match(m['keyboard-reach'].message, /\.btn/);
  assert.equal(m['accessible-names'].status, 'fail');
  assert.match(m['accessible-names'].message, /<button \.icon>/);
  assert.equal(m['focus-visible'].status, 'fail');
  assert.equal(m['hover-only-info'].status, 'fail');
  assert.match(m['hover-only-info'].message, /title/);
  assert.match(m['hover-only-info'].message, /:hover/);
  assert.equal(m['non-text-alternatives'].status, 'warn');
  assert.equal(m['reduced-motion'].status, 'fail');
});

test('bad WebView fixture: perf budget hints', () => {
  const m = byCheck(run('bad'));
  assert.equal(m['perf-backdrop-filter'].status, 'warn');
  assert.match(m['perf-backdrop-filter'].message, /3 backdrop-filter/);
  assert.equal(m['perf-shadows'].status, 'warn');
  assert.equal(m['perf-meter-rate'].status, 'fail');
  assert.match(m['perf-meter-rate'].message, /120 Hz/);
  assert.equal(m['perf-webview-overhead'].status, 'fail');
  assert.match(m['perf-webview-overhead'].message, /210 MB > budget 120 MB/);
});

test('perf_budget: default 120 MB when absent; measured value optional', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-a11y-'));
  try {
    fs.cpSync(path.join(FIX, 'good'), tmp, { recursive: true });
    const sp = path.join(tmp, 'status.json');
    fs.writeFileSync(sp, JSON.stringify({ plugin_name: 'X', ui_framework: 'webview' }));
    let m = byCheck(a11y.validate(tmp, { root: REPO_ROOT }));
    assert.equal(m['perf-webview-overhead'].status, 'info');
    assert.match(m['perf-webview-overhead'].message, /budget 120 MB \(default 120 MB\)/);
    fs.writeFileSync(sp, JSON.stringify({ plugin_name: 'X', ui_framework: 'webview', perf_budget: { webview_overhead_mb: 80, measured: { webview_overhead_mb: 95 } } }));
    m = byCheck(a11y.validate(tmp, { root: REPO_ROOT }));
    assert.equal(m['perf-webview-overhead'].status, 'fail');
    assert.match(m['perf-webview-overhead'].message, /95 MB > budget 80 MB/);
    fs.writeFileSync(sp, JSON.stringify({ plugin_name: 'X', ui_framework: 'webview', perf_budget: 150 }));
    m = byCheck(a11y.validate(tmp, { root: REPO_ROOT }));
    assert.match(m['perf-webview-overhead'].message, /budget 150 MB/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('APC kit page: custom controls without tabindex are flagged; kit CSS resolved from templates/', () => {
  const m = byCheck(run('kit'));
  assert.match(m['a11y-source'].message, /3 stylesheet/);
  assert.equal(m['contrast-text'].status, 'pass');
  assert.equal(m['keyboard-reach'].status, 'fail');
  assert.match(m['keyboard-reach'].message, /apc-knob/);
  assert.equal(m['accessible-names'].status, 'pass'); // label text names the controls
});

test('--html selects a specific document', () => {
  const m = byCheck(run('bad', { args: ['--html', 'Source/ui/public/index.html'] }));
  assert.equal(m['keyboard-reach'].status, 'fail');
  const none = byCheck(run('good', { html: 'Nope/missing.html' }));
  assert.equal(none['a11y-source'].status === 'info' || none['a11y-source'].status === 'warn', true);
});

test('Visage plugin: INFO + the checks that are statically possible', () => {
  const res = run('visage');
  const m = byCheck(res);
  assert.equal(m['a11y-framework'].status, 'info');
  assert.match(m['a11y-framework'].message, /visage/i);
  assert.equal(m['contrast-text'].status, 'pass'); // from ui-map tokens
  assert.equal(m['perf-meter-rate'].status, 'pass');
  assert.match(m['perf-meter-rate'].message, /startTimerHz\(30\)/);
  assert.equal(m['keyboard-reach'].status, 'info');
  assert.equal(m['perf-webview-overhead'].status, 'info');
  assert.ok(!res.checks.some((c) => c.status === 'fail'));
});

test('plugin with no UI source gets one clear warning', () => {
  const { checks } = run('empty');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'warn');
  assert.match(checks[0].message, /no WebView UI source/);
});

test('Visage meter timer above 60 Hz fails', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-a11y-'));
  try {
    fs.cpSync(path.join(FIX, 'visage'), tmp, { recursive: true });
    const cpp = path.join(tmp, 'Source', 'PluginEditor.cpp');
    fs.writeFileSync(cpp, fs.readFileSync(cpp, 'utf8').replace('startTimerHz(30)', 'startTimerHz(120)'));
    const m = byCheck(a11y.validate(tmp, { root: REPO_ROOT }));
    assert.equal(m['perf-meter-rate'].status, 'fail');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('theme overlay via .theme-* class and prefers-color-scheme are evaluated', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-a11y-'));
  try {
    fs.mkdirSync(path.join(tmp, 'Source', 'ui', 'public'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'status.json'), '{"ui_framework":"webview"}');
    fs.writeFileSync(path.join(tmp, 'Source', 'ui', 'public', 'index.html'),
      '<html><head><link rel="stylesheet" href="s.css"></head><body><button aria-label="x">x</button></body></html>');
    fs.writeFileSync(path.join(tmp, 'Source', 'ui', 'public', 's.css'), [
      ':root{--bg:#000;--fg:#fff}',
      '@media (prefers-color-scheme: light){:root{--bg:#fff;--fg:#eee}}',
      'body{background:var(--bg);color:var(--fg)}',
    ].join('\n'));
    const m = byCheck(a11y.validate(tmp, { root: REPO_ROOT }));
    assert.equal(m['contrast-text'].status, 'fail');
    assert.match(m['contrast-text'].message, /media-light/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: apc validate a11y --plugin <Name> --json (plugs into the validator router)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-a11y-cli-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"0.0.0"}');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.cpSync(path.join(FIX, 'good'), path.join(root, 'plugins', 'GoodFixture'), { recursive: true });
    fs.cpSync(path.join(FIX, 'bad'), path.join(root, 'plugins', 'BadFixture'), { recursive: true });
    const call = (plugin) => {
      try {
        const stdout = execFileSync(process.execPath, [CLI, 'validate', 'a11y', '--plugin', plugin, '--json'], {
          encoding: 'utf8', env: { ...process.env, APC_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, json: JSON.parse(stdout) };
      } catch (e) {
        return { status: e.status, json: JSON.parse(e.stdout) };
      }
    };
    const good = call('GoodFixture');
    assert.equal(good.status, 0);
    assert.equal(good.json.kind, 'a11y');
    assert.equal(good.json.issues.length, 0);
    assert.ok(good.json.checks.length >= 10);
    const bad = call('BadFixture');
    assert.equal(bad.status, 1);
    assert.ok(bad.json.issues.length >= 5);
    assert.ok(bad.json.issues.some((i) => i.check === 'contrast-text'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
