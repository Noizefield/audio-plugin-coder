'use strict';
// scripts/apc-kit-test.js: result parsing, page discovery, exit codes, the "skipped: no browser" path
// (never a fake pass) and a real fake-browser EXECUTABLE driven through the same spawn path as Edge/Chrome.
// Zero deps: node:test + node:assert (Node 18+).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const kit = require(path.join(REPO_ROOT, 'scripts', 'apc-kit-test.js'));

const dirs = [];
function tmp(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(d); return d; }
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const resultPre = (o) => `<pre id="apc-test-result">${JSON.stringify(o).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
function capture() {
  const out = [], err = [];
  return { out, err, log: (s) => out.push(String(s)), errlog: (s) => err.push(String(s)) };
}

// ---------- parse logic ----------
test('parseResult: reads {pass,fail,failures} from the dumped DOM and decodes HTML entities', () => {
  const dom = `<html><body>${resultPre({ pass: 3, fail: 1, failures: ['a & b <c> "q"'] })}</body></html>`;
  const r = kit.parseResult(dom);
  assert.equal(r.ok, false);
  assert.equal(r.pass, 3); assert.equal(r.fail, 1);
  assert.deepEqual(r.failures, ['a & b <c> "q"']);
});

test('parseResult: a clean page is ok; the browser-style &quot; escapes decode too', () => {
  const dom = '<pre id="apc-test-result">{&quot;pass&quot;:5,&quot;fail&quot;:0,&quot;failures&quot;:[]}</pre>';
  const r = kit.parseResult(dom);
  assert.equal(r.ok, true); assert.equal(r.pass, 5);
});

test('parseResult: mentions of the element in comments are ignored and the LAST real element wins', () => {
  const dom = `<!-- Result: <pre id="apc-test-result">. He says so. --><body>
    <pre id="apc-test-result">not json</pre> ${resultPre({ pass: 2, fail: 0, failures: [] })}</body>`;
  const r = kit.parseResult(dom);
  assert.equal(r.ok, true); assert.equal(r.pass, 2);
});

test('parseResult: missing / unparsable / malformed / zero-test results are FAILURES, never passes', () => {
  assert.equal(kit.parseResult('<html></html>').ok, false);
  assert.match(kit.parseResult('<html></html>').error, /no #apc-test-result/);
  assert.match(kit.parseResult('<pre id="apc-test-result">{oops</pre>').error, /unparsable/);
  assert.match(kit.parseResult('<pre id="apc-test-result">{"pass":"x"}</pre>').error, /malformed/);
  const zero = kit.parseResult(resultPre({ pass: 0, fail: 0, failures: [] }));
  assert.equal(zero.ok, false); assert.match(zero.error, /zero tests/);
  // fail=0 but failures listed: still a failure
  assert.equal(kit.parseResult(resultPre({ pass: 4, fail: 0, failures: ['hidden'] })).ok, false);
});

test('parseArgs / discoverPages / chromeArgs', () => {
  const o = kit.parseArgs(['test', '--json', '--only', 'kit-b', '--browser', 'C:\\x\\b.exe', '--budget=1234']);
  assert.equal(o.sub, 'test'); assert.equal(o.json, true); assert.equal(o.only, 'kit-b'); assert.equal(o.browser, 'C:\\x\\b.exe'); assert.equal(o.budget, 1234);
  assert.deepEqual(kit.parseArgs(['test', '--wat']).unknown, ['--wat']);
  const d = tmp('apc-kit-disc-');
  fs.writeFileSync(path.join(d, 'b.html'), ''); fs.writeFileSync(path.join(d, 'a.html'), ''); fs.writeFileSync(path.join(d, 'harness.js'), '');
  assert.deepEqual(kit.discoverPages(d).map((p) => p.name), ['a', 'b']);
  const args = kit.chromeArgs({ profileDir: '/p', budget: 5000, url: 'file:///x.html' });
  for (const want of ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', 'file:///x.html']) assert.ok(args.includes(want), `chrome args include ${want}`);
});

// ---------- skip path ----------
function pagesDir(map) {
  const d = tmp('apc-kit-pages-');
  for (const [name, html] of Object.entries(map)) fs.writeFileSync(path.join(d, name + '.html'), html);
  return d;
}

test('no browser installed: exit 0 with an explicit "skipped" (JSON: skipped:true) - never a fake pass', () => {
  const d = pagesDir({ one: '<html></html>', two: '<html></html>' });
  const c = capture();
  const code = kit.run(['test', '--json'], { testsDir: d, findBrowser: () => ({ path: null, searched: [] }), log: c.log, errlog: c.errlog });
  assert.equal(code, 0);
  const j = JSON.parse(c.out.join('\n'));
  assert.equal(j.skipped, true); assert.equal(j.ok, true);
  assert.equal(j.pass, 0); assert.equal(j.fail, 0);
  assert.match(j.reason, /no Chromium-family browser/);
  assert.deepEqual(j.pages.map((p) => [p.name, p.skipped]), [['one', true], ['two', true]]);

  const c2 = capture();
  assert.equal(kit.run(['test'], { testsDir: d, findBrowser: () => ({ path: null }), log: c2.log, errlog: c2.errlog }), 0);
  const text = c2.out.join('\n');
  assert.match(text, /SKIPPED/); assert.match(text, /not a pass/);
  assert.doesNotMatch(text, /\bPASS\b|\bOK:/, 'the human output must not look like a pass');
});

test('usage errors and missing pages exit 2', () => {
  const c = capture();
  assert.equal(kit.run([], { log: c.log, errlog: c.errlog }), 2);
  assert.equal(kit.run(['test', '--bogus'], { log: c.log, errlog: c.errlog }), 2);
  const empty = tmp('apc-kit-empty-');
  assert.equal(kit.run(['test'], { testsDir: empty, findBrowser: () => ({ path: 'x' }), log: c.log, errlog: c.errlog }), 2);
  assert.match(c.err.join('\n'), /no kit test pages found/);
  const d = pagesDir({ alpha: '' });
  assert.equal(kit.run(['test', '--only', 'zzz'], { testsDir: d, findBrowser: () => ({ path: 'x' }), log: c.log, errlog: c.errlog }), 2);
});

// ---------- a real fake browser executable ----------
/** Builds an executable that behaves like `chrome --headless --dump-dom <url>` for the pages below. */
function makeFakeBrowser() {
  const d = tmp('apc-kit-fake-');
  const argLog = path.join(d, 'args.log');
  const js = path.join(d, 'fake-browser.js');
  fs.writeFileSync(js, `
const fs = require('fs'); const { fileURLToPath } = require('url');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argLog)}, JSON.stringify(args) + '\\n');
const url = args[args.length - 1];
const html = fs.readFileSync(fileURLToPath(url), 'utf8');
const m = /<!--FAKE:(\\w+)-->/.exec(html);
const mode = m ? m[1] : 'crash';
const res = (o) => '<pre id="apc-test-result">' + JSON.stringify(o).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
let body = '';
if (mode === 'pass') body = res({ pass: 7, fail: 0, failures: [] });
else if (mode === 'fail') body = res({ pass: 2, fail: 1, failures: ['widget: expected 1 but got 2'] });
else if (mode === 'exit3') process.exit(3);
process.stdout.write('<html><body>' + body + '</body></html>');
`);
  let exe;
  if (process.platform === 'win32') {
    exe = path.join(d, 'fake-browser.cmd');
    fs.writeFileSync(exe, `@echo off\r\n"${process.execPath}" "%~dp0fake-browser.js" %*\r\n`);
  } else {
    exe = path.join(d, 'fake-browser.sh');
    fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    fs.chmodSync(exe, 0o755);
  }
  return { exe, argLog };
}

test('fake browser: pass page -> exit 0; per-page results printed; chromium flags are passed', () => {
  const fake = makeFakeBrowser();
  const d = pagesDir({ good: '<!--FAKE:pass--><html></html>' });
  const c = capture();
  const code = kit.run(['test', '--browser', fake.exe], { testsDir: d, log: c.log, errlog: c.errlog });
  assert.equal(code, 0, c.out.join('\n') + c.err.join('\n'));
  assert.match(c.out.join('\n'), /PASS\s+good\s+\(7 passed, 0 failed/);
  const argv = JSON.parse(fs.readFileSync(fake.argLog, 'utf8').trim().split('\n')[0]);
  assert.ok(argv.includes('--headless=new') && argv.includes('--disable-gpu') && argv.includes('--dump-dom'));
  assert.ok(argv.some((a) => /^--virtual-time-budget=\d+$/.test(a)), 'virtual time budget');
  assert.match(argv[argv.length - 1], /^file:\/\/.*good\.html$/);
  assert.ok(argv.some((a) => a.startsWith('--user-data-dir=')), 'isolated profile so a running browser is not reused');
});

test('fake browser: a failing page -> exit 1 with the failure text; --json carries counts', () => {
  const fake = makeFakeBrowser();
  const d = pagesDir({ good: '<!--FAKE:pass-->', bad: '<!--FAKE:fail-->' });
  const c = capture();
  assert.equal(kit.run(['test', '--browser', fake.exe], { testsDir: d, log: c.log, errlog: c.errlog }), 1);
  const text = c.out.join('\n');
  assert.match(text, /FAIL\s+bad/); assert.match(text, /widget: expected 1 but got 2/); assert.match(text, /FAILED: 9 passed, 1 failed/);
  const cj = capture();
  assert.equal(kit.run(['test', '--json', '--browser', fake.exe], { testsDir: d, log: cj.log, errlog: cj.errlog }), 1);
  const j = JSON.parse(cj.out.join('\n'));
  assert.equal(j.ok, false); assert.equal(j.skipped, false); assert.equal(j.pass, 9); assert.equal(j.fail, 1);
  assert.deepEqual(j.pages.map((p) => [p.name, p.ok]), [['bad', false], ['good', true]]);
});

test('fake browser: a page that produces no result element, or a browser that exits non-zero, FAILS (a crash is never a pass)', () => {
  const fake = makeFakeBrowser();
  const d = pagesDir({ crash: '<!--FAKE:crash-->', dead: '<!--FAKE:exit3-->' });
  const c = capture();
  assert.equal(kit.run(['test', '--browser', fake.exe], { testsDir: d, log: c.log, errlog: c.errlog }), 1);
  const text = c.out.join('\n');
  assert.match(text, /FAIL\s+crash/); assert.match(text, /no #apc-test-result/);
  assert.match(text, /FAIL\s+dead/); assert.match(text, /exited with code 3/);
});

test('--only selects pages by name or fragment', () => {
  const fake = makeFakeBrowser();
  const d = pagesDir({ 'kit-a': '<!--FAKE:fail-->', 'kit-b-x': '<!--FAKE:pass-->', 'kit-b-y': '<!--FAKE:pass-->' });
  const c = capture();
  assert.equal(kit.run(['test', '--only', 'kit-b', '--browser', fake.exe], { testsDir: d, log: c.log, errlog: c.errlog }), 0);
  assert.match(c.out.join('\n'), /kit-b-x/); assert.doesNotMatch(c.out.join('\n'), /kit-a/);
  const c2 = capture();
  assert.equal(kit.run(['test', '--only', 'kit-a.html', '--browser', fake.exe], { testsDir: d, log: c2.log, errlog: c2.errlog }), 1);
});

// ---------- through the real CLI router ----------
test('apc kit (CLI router): usage -> exit 2; `kit test --dir <pages> --browser <fake>` runs the same code path', () => {
  const r0 = spawnSync(process.execPath, [CLI, 'kit'], { encoding: 'utf8' });
  assert.equal(r0.status, 2);
  const fake = makeFakeBrowser();
  const d = pagesDir({ good: '<!--FAKE:pass-->' });
  const r1 = spawnSync(process.execPath, [CLI, 'kit', 'test', '--dir', d, '--browser', fake.exe, '--json'], { encoding: 'utf8' });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const j = JSON.parse(r1.stdout);
  assert.equal(j.ok, true); assert.equal(j.pass, 7);
  const d2 = pagesDir({ bad: '<!--FAKE:fail-->' });
  assert.equal(spawnSync(process.execPath, [CLI, 'kit', 'test', '--dir', d2, '--browser', fake.exe], { encoding: 'utf8' }).status, 1);
});
