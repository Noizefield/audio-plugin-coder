'use strict';
/**
 * apc kit test - run the WebView UI kit self-test pages in a headless Chromium-family browser.
 *
 *   apc kit test [--json] [--only <name>] [--browser <path>] [--budget <ms>] [--timeout <ms>]
 *
 * Pages: templates/webview/apc-ui/tests/*.html. Each page loads the kit + apc-mock.js, runs DOM
 * assertions and writes `<pre id="apc-test-result">{"pass":n,"fail":n,"failures":[...]}</pre>`
 * (CONTRACT.md "Testing contract"). This runner opens every page with
 *   <browser> --headless=new --disable-gpu --virtual-time-budget=<ms> --dump-dom file://<page>
 * and parses that element out of the dumped DOM.
 *
 * Exit codes: 0 all pages passed OR skipped (no browser installed: says so, never a fake pass),
 *             1 at least one page failed / produced no result, 2 usage or missing pages.
 * --json prints one object: { ok, skipped, reason?, browser, pages:[{name,file,pass,fail,failures,error?}], pass, fail }.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUDGET_MS = 30000;
const DEFAULT_TIMEOUT_MS = 90000;

function parseArgs(argv) {
  const o = { sub: null, json: false, only: null, browser: null, budget: DEFAULT_BUDGET_MS, timeout: DEFAULT_TIMEOUT_MS, dir: null, unknown: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; return v; };
    if (a === '--json') o.json = true;
    else if (a === '--only') o.only = val();
    else if (a === '--browser') o.browser = val();
    else if (a === '--budget') o.budget = Number(val());
    else if (a === '--timeout') o.timeout = Number(val());
    else if (a === '--dir') o.dir = val();
    else if (a.startsWith('--only=')) o.only = a.slice(7);
    else if (a.startsWith('--browser=')) o.browser = a.slice(10);
    else if (a.startsWith('--budget=')) o.budget = Number(a.slice(9));
    else if (a.startsWith('--timeout=')) o.timeout = Number(a.slice(10));
    else if (a.startsWith('--dir=')) o.dir = a.slice(6);
    else if (a.startsWith('-')) o.unknown.push(a);
    else rest.push(a);
  }
  o.sub = rest[0] || null;
  return o;
}

/** Test pages in a directory: tests/*.html, sorted. -> [{ name, file }] */
function discoverPages(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir); } catch { return []; }
  return ents.filter((f) => /\.html?$/i.test(f)).sort().map((f) => ({ name: f.replace(/\.html?$/i, ''), file: path.join(dir, f) }));
}

function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/**
 * Parse the dumped DOM. -> { ok, pass, fail, failures, total?, error? }
 * A page without a parsable, internally consistent result is a FAILURE (a crashed/timed-out page must never pass).
 */
function parseResult(dom) {
  // A page may MENTION the element in a comment or documentation text: ignore comments and use the LAST real element.
  const text = String(dom || '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<pre\b[^>]*\bid=["']apc-test-result["'][^>]*>([\s\S]*?)<\/pre>/gi;
  let m = null, hit;
  while ((hit = re.exec(text)) !== null) m = hit;
  if (!m) return { ok: false, pass: 0, fail: 0, failures: [], error: 'no #apc-test-result element in the dumped DOM (page crashed, timed out, or never finished its tests)' };
  let j;
  try { j = JSON.parse(unescapeHtml(m[1]).trim()); } catch (e) { return { ok: false, pass: 0, fail: 0, failures: [], error: 'unparsable #apc-test-result JSON: ' + e.message }; }
  if (!j || typeof j !== 'object' || !Number.isFinite(j.pass) || !Number.isFinite(j.fail)) {
    return { ok: false, pass: 0, fail: 0, failures: [], error: 'malformed #apc-test-result (needs numeric pass and fail)' };
  }
  const failures = Array.isArray(j.failures) ? j.failures.map(String) : [];
  const out = { ok: j.fail === 0 && failures.length === 0, pass: j.pass, fail: Math.max(j.fail, failures.length), failures };
  if (Number.isFinite(j.total)) out.total = j.total;
  if (j.pass === 0 && j.fail === 0) { out.ok = false; out.error = 'page reported zero tests'; }
  return out;
}

function quoteWin(a) { return /[\s"&|<>^()]/.test(a) ? '"' + String(a).replace(/"/g, '\\"') + '"' : String(a); }

/** spawnSync wrapper that can also run .cmd/.bat "browsers" on Windows (used by the fake-browser tests). */
function spawnBrowser(exe, argv, opts, spawn) {
  const sp = spawn || spawnSync;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe)) {
    const line = '"' + [exe].concat(argv).map(quoteWin).join(' ') + '"';
    return sp(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], { ...opts, windowsVerbatimArguments: true });
  }
  return sp(exe, argv, opts);
}

function chromeArgs(o) {
  return [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--allow-file-access-from-files', '--hide-scrollbars', '--window-size=1280,800',
    '--user-data-dir=' + o.profileDir,
    '--virtual-time-budget=' + o.budget,
    '--dump-dom', o.url,
  ];
}

function findBrowserFn(ctx) {
  if (ctx && typeof ctx.findBrowser === 'function') return ctx.findBrowser;
  try { return require('./apc-preview.js').findBrowser; } catch { return null; }
}

/** Run every page. `deps` ({ spawn, findBrowser }) is injectable for tests. -> report object (see header). */
function runAll(opts, ctx) {
  ctx = ctx || {};
  const dir = opts.dir || ctx.testsDir || path.join((ctx.root || REPO_ROOT), 'templates', 'webview', 'apc-ui', 'tests');
  let pages = discoverPages(dir);
  const report = { ok: true, skipped: false, browser: null, dir, pages: [], pass: 0, fail: 0 };
  if (opts.only) {
    const want = String(opts.only).replace(/\.html?$/i, '');
    pages = pages.filter((p) => p.name === want || p.name.includes(want));
    if (!pages.length) { report.ok = false; report.error = `no test page matches --only ${opts.only}`; report.usage = true; return report; }
  }
  if (!pages.length) { report.ok = false; report.error = `no kit test pages found in ${dir}`; report.usage = true; return report; }

  const fb = findBrowserFn(ctx);
  const found = fb ? fb({ explicit: opts.browser || undefined }) : { path: null, searched: [] };
  if (!found || !found.path) {
    report.skipped = true;
    report.reason = 'no Chromium-family browser found (Edge, Chrome or Chromium); set APC_BROWSER or pass --browser <path>';
    report.pages = pages.map((p) => ({ name: p.name, file: p.file, skipped: true }));
    return report;
  }
  report.browser = found.path;

  for (const p of pages) {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-kit-test-'));
    const t0 = Date.now();
    let r;
    try {
      const url = pathToFileURL(p.file).href;
      const res = spawnBrowser(found.path, chromeArgs({ profileDir, budget: opts.budget, url }),
        { encoding: 'utf8', timeout: opts.timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, ctx.spawn);
      if (res.error) r = { ok: false, pass: 0, fail: 0, failures: [], error: `could not run the browser: ${res.error.code === 'ETIMEDOUT' ? 'timed out after ' + opts.timeout + ' ms' : res.error.message}` };
      else if (res.status !== 0 && !/apc-test-result/.test(res.stdout || '')) r = { ok: false, pass: 0, fail: 0, failures: [], error: `browser exited with code ${res.status}${res.stderr ? ': ' + String(res.stderr).trim().split(/\r?\n/).slice(-2).join(' | ') : ''}` };
      else r = parseResult(res.stdout);
    } finally {
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* temp profile; best effort */ }
    }
    const entry = { name: p.name, file: p.file, ms: Date.now() - t0, pass: r.pass, fail: r.fail, failures: r.failures };
    if (r.total !== undefined) entry.total = r.total;
    if (r.error) entry.error = r.error;
    entry.ok = !!r.ok;
    report.pages.push(entry);
    report.pass += r.pass; report.fail += r.fail;
    if (!r.ok) report.ok = false;
  }
  return report;
}

function printReport(rep, log) {
  if (rep.skipped) {
    log(`apc kit test: SKIPPED - ${rep.reason}`);
    log(`  ${rep.pages.length} page(s) NOT run: ${rep.pages.map((p) => p.name).join(', ')}`);
    log('  (skipped is not a pass: the kit self-tests did not execute on this machine)');
    return;
  }
  log(`browser: ${rep.browser}`);
  for (const p of rep.pages) {
    const status = p.ok ? 'PASS' : 'FAIL';
    log(`${status}  ${p.name}  (${p.pass} passed, ${p.fail} failed${p.ms !== undefined ? ', ' + p.ms + ' ms' : ''})`);
    if (p.error) log(`      ${p.error}`);
    for (const f of p.failures || []) log(`      - ${f}`);
  }
  log(`${rep.ok ? 'OK' : 'FAILED'}: ${rep.pass} passed, ${rep.fail} failed across ${rep.pages.length} page(s)`);
}

function usage(log) {
  log('Usage: apc kit test [--json] [--only <name>] [--browser <path>] [--budget <ms>] [--timeout <ms>]');
  log('  Runs templates/webview/apc-ui/tests/*.html in a headless Chromium-family browser.');
  log('  Exit 0 = all pass (or skipped: no browser installed), 1 = failures, 2 = usage / no pages.');
}

function run(args, ctx) {
  ctx = ctx || {};
  const log = ctx.log || ((s) => console.log(s));
  const elog = ctx.errlog || ((s) => console.error(s));
  const o = parseArgs(args || []);
  if (o.sub !== 'test' || o.unknown.length || !Number.isFinite(o.budget) || !Number.isFinite(o.timeout)) {
    if (o.unknown.length) elog(`apc kit: unknown option ${o.unknown.join(' ')}`);
    usage(elog);
    return 2;
  }
  const rep = runAll(o, ctx);
  if (rep.usage) {
    if (o.json) log(JSON.stringify({ ok: false, error: rep.error, dir: rep.dir }, null, 2)); else elog(`apc kit test: ${rep.error}`);
    return 2;
  }
  if (o.json) log(JSON.stringify(rep, null, 2)); else printReport(rep, log);
  return rep.ok ? 0 : 1;
}

module.exports = { run, runAll, parseArgs, parseResult, discoverPages, unescapeHtml, chromeArgs, spawnBrowser, printReport, DEFAULT_BUDGET_MS };
