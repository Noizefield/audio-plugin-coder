'use strict';
// Hub KIT page: GET /api/v1/kit, /kit/<file>, /kit-theme/<id>.css, /kit-demo/<component>.
// Zero deps: node:test + node:assert (Node 18+). Every test talks to a real hub/server.js
// child process on an ephemeral port (--port 0). Tests that need the real kit use
// APC_ROOT = this checkout (read-only); "missing / partial kit" tests use isolated fixture roots.
// The real-browser checks (Edge / Chrome / Chromium via findBrowser from scripts/apc-preview.js)
// skip cleanly when no browser is installed.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'hub', 'server.js');
const KIT_DIR = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui');
const CATALOG_FILE = path.join(REPO_ROOT, 'hub', 'kit-catalog.json');
const { findBrowser } = require(path.join(REPO_ROOT, 'scripts', 'apc-preview.js'));

const SCENARIOS = ['demo', 'trial', 'licensed', 'unverified', 'update-available', 'update-failed', 'io-error'];
const GROUPS = ['Controls', 'Widgets', 'Visualisation', 'Context & Help', 'Chrome', 'Settings', 'Presets', 'Dialogs'];
const THEME_IDS = ['apc-minimal'];   // the one shipped design (has tokens.css)

const procs = [];
const dirs = [];
after(() => {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

// ─── helpers ────────────────────────────────────────────────────────────────
function startHub(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--port', '0', '--no-open'], {
      env: { ...process.env, APC_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(child);
    let out = '';
    const timer = setTimeout(() => reject(new Error('hub did not start: ' + out)), 8000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)\//);
      if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), root, child }); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('hub exited ' + code + ': ' + out)); });
  });
}
function request(hub, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: hub.port, method, path: urlPath,
      headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, buf, json });
      });
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}
const get = (hub, p) => request(hub, 'GET', p);
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
function kitRootFiles() {
  return fs.readdirSync(KIT_DIR, { withFileTypes: true }).filter((e) => e.isFile() && /\.(js|css)$/.test(e.name)).map((e) => e.name).sort();
}
// Independent parse of APC.register("name", ...) over the real kit (does not reuse the server's code).
function realRegistrations() {
  const out = {};
  for (const f of kitRootFiles().filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(KIT_DIR, f), 'utf8');
    for (const m of text.matchAll(/APC\.register\(\s*["']([^"']+)["']/g)) out[m[1]] = f;
  }
  return out;
}
/**
 * Fixture root. kit: 'full' | 'none' | 'partial' (no apc-update-ui.js) | 'extra' (adds a registering file)
 * themes: 'full' | 'none' | 'ghost' (manifest lists a theme with neither tokens.css nor design-system.json)
 *         | 'legacy' (adds 'legacy-night' / 'legacy-day': designs WITHOUT tokens.css, only a design-system.json -> derived fallback)
 */
function makeRoot({ kit = 'full', themes = 'full' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-kit-'));
  dirs.push(root);
  writeJson(path.join(root, 'package.json'), { name: 'fixture', version: '0.0.0-test' });
  writeJson(path.join(root, 'apc.config.json'), {
    version: 1, paths: { plugins_dir: 'plugins', build_dir: 'build', release_dir: 'release' }, models: { profile: 'balanced' }, setup: { completed: true },
  });
  if (kit !== 'none') {
    const dst = path.join(root, 'templates', 'webview', 'apc-ui');
    fs.mkdirSync(dst, { recursive: true });
    for (const f of kitRootFiles()) {
      if (kit === 'partial' && f === 'apc-update-ui.js') continue;
      fs.copyFileSync(path.join(KIT_DIR, f), path.join(dst, f));
    }
    fs.copyFileSync(path.join(KIT_DIR, 'CONTRACT.md'), path.join(dst, 'CONTRACT.md'));
    if (kit === 'extra') fs.writeFileSync(path.join(dst, 'apc-extra.js'), '(function(){ window.APC.register("extra-widget", function(){ return {}; }); })();\n');
  }
  if (themes !== 'none') {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'design_library', 'manifest.json'), 'utf8'));
    if (themes === 'ghost') manifest.designs.push({ id: 'ghost-theme', name: 'Ghost', path: 'ghost-theme', colors: {} });
    writeJson(path.join(root, 'design_library', 'manifest.json'), manifest);
    if (themes === 'legacy') {
      manifest.designs.push({ id: 'legacy-night', name: 'Legacy Night', path: 'legacy-night', colors: {} });
      manifest.designs.push({ id: 'legacy-day', name: 'Legacy Day', path: 'legacy-day', colors: {} });
      writeJson(path.join(root, 'design_library', 'manifest.json'), manifest);
      writeJson(path.join(root, 'design_library', 'legacy-night', 'design-system.json'), {
        palette: { background: '#101014', surface: '#1a1a1f', surfaceHighlight: '#2a2a33', border: '#3a3a45', textPrimary: '#f0f0f5', textSecondary: '#a0a0a5', accent: '#12ab34' },
        typography: { fontFamilyBody: 'Georgia, serif' }, components: { borderRadius: '2px' },
      });
      writeJson(path.join(root, 'design_library', 'legacy-day', 'design-system.json'), {
        palette: { background: '#efe8d8', surface: '#e0d8c4', border: '#807860', textPrimary: '#222222', textSecondary: '#555555', primary: '#d9531e' },
      });
    }
    for (const id of THEME_IDS) {
      fs.mkdirSync(path.join(root, 'design_library', id), { recursive: true });
      for (const f of ['tokens.css', 'design-system.json']) fs.copyFileSync(path.join(REPO_ROOT, 'design_library', id, f), path.join(root, 'design_library', id, f));
    }
  }
  return root;
}

let hub;          // real checkout
let catalog;      // hub/kit-catalog.json
let api;          // /api/v1/kit of the real checkout
before(async () => {
  hub = await startHub(REPO_ROOT);
  catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  api = (await get(hub, '/api/v1/kit')).json;
});

// ─── catalog <-> kit consistency ────────────────────────────────────────────
test('GET /api/v1/kit: catalog and kit agree (no issues), kit + catalog + contract found', async () => {
  const r = await get(hub, '/api/v1/kit');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(api.kitFound, true);
  assert.equal(api.catalogFound, true);
  assert.equal(api.contractFound, true);
  assert.equal(api.kitDir, 'templates/webview/apc-ui');
  assert.equal(api.catalogFile, 'hub/kit-catalog.json');
  assert.deepEqual(api.issues, []);
});

test('every component registered via APC.register(...) is in the catalog, and vice-versa', () => {
  const real = realRegistrations();
  assert.ok(Object.keys(real).length >= 16, 'sanity: the kit registers its components (' + Object.keys(real).join(',') + ')');
  const registeredInCatalog = catalog.components.filter((c) => c.registered !== false).map((c) => c.name).sort();
  assert.deepEqual(registeredInCatalog, Object.keys(real).sort(), 'catalog registered entries == APC.register names');
  assert.deepEqual(Object.keys(api.registered).sort(), Object.keys(real).sort(), 'API reports the same registrations');
  for (const c of catalog.components.filter((x) => x.registered !== false)) {
    assert.equal(c.file, real[c.name], c.name + ' lives in the file the catalog names');
  }
  // entries that are not data-apc components must say which components provide them
  for (const c of catalog.components.filter((x) => x.registered === false)) {
    assert.ok(Array.isArray(c.via) && c.via.length && c.via.every((n) => real[n]), c.name + ' has a valid "via"');
    assert.ok(!real[c.name], c.name + ' must not be registered');
  }
  const names = catalog.components.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'component names are unique');
});

test('catalog entries are complete: group, docs, demo, scripts, tests, bridge functions, standards ids', () => {
  const mock = fs.readFileSync(path.join(KIT_DIR, 'apc-mock.js'), 'utf8');
  const mockFns = new Set(Array.from(mock.matchAll(/F\["(apc\.[A-Za-z.]+)"\]\s*=/g), (m) => m[1]));
  assert.ok(mockFns.size >= 40, 'sanity: mock implements the contract functions');
  assert.deepEqual(catalog.groups, GROUPS);
  const files = new Set(kitRootFiles());
  for (const c of catalog.components) {
    assert.ok(GROUPS.includes(c.group), c.name + ': group ' + c.group);
    for (const f of ['title', 'summary', 'markup', 'file']) assert.ok(typeof c[f] === 'string' && c[f].length > 0, c.name + ': ' + f);
    assert.ok(files.has(c.file), c.name + ': file ' + c.file + ' exists in the kit');
    assert.ok(Array.isArray(c.options), c.name + ': options');
    assert.ok(Array.isArray(c.events), c.name + ': events');
    assert.ok(Array.isArray(c.standards) && c.standards.length > 0, c.name + ': standards');
    for (const s of c.standards) assert.match(s, /^[A-Z]-\d\d$/, c.name + ': decision id ' + s);
    // widgets / viz elements that never touch the bridge (label, divider, spectrum ...) list none; every listed function must exist in the mock
    assert.ok(Array.isArray(c.bridge) && (c.bridge.length > 0 || ['Widgets', 'Visualisation'].includes(c.group)), c.name + ': bridge');
    for (const b of c.bridge) assert.ok(mockFns.has(b), c.name + ': bridge function ' + b + ' is implemented by apc-mock.js');
    assert.ok(c.demo && c.demo.cols > 0 && c.demo.rows > 0 && typeof c.demo.body === 'string' && c.demo.body.length > 0, c.name + ': demo scene');
    assert.ok(Array.isArray(c.demo.expect) && c.demo.expect.length > 0, c.name + ': demo.expect selectors');
    for (const s of c.demo.scripts) assert.ok(files.has(s), c.name + ': demo script ' + s);
    assert.ok(c.tests && c.tests.length > 0, c.name + ': test page(s)');
    for (const t of c.tests) assert.ok(fs.existsSync(path.join(KIT_DIR, 'tests', t)), c.name + ': test page ' + t);
    if (c.gestureSet) assert.ok(catalog.gestureSets[c.gestureSet], c.name + ': gestureSet ' + c.gestureSet);
    if (Array.isArray(c.scenarios)) for (const s of c.scenarios) assert.ok(SCENARIOS.includes(s), c.name + ': scenario ' + s);
  }
  // controls document their gesture map, the demo markup mounts what the entry says it mounts
  for (const n of ['knob', 'slider', 'selector', 'toggle']) {
    const c = api.components.find((x) => x.name === n);
    assert.ok(c.gestures.length >= 8, n + ' has a gesture/keyboard map');
    assert.ok(c.demo.url === '/kit-demo/' + n);
  }
});

test('mock scenarios are derived from apc-mock.js and documented', () => {
  assert.equal(api.scenarios.found, true);
  assert.equal(api.scenarios.derived, true);
  assert.deepEqual(api.scenarios.names, SCENARIOS);
  for (const s of SCENARIOS) assert.ok(api.scenarios.notes[s] && api.scenarios.notes[s].length > 10, 'note for scenario ' + s);
  assert.equal(api.scenarios.source, 'templates/webview/apc-ui/apc-mock.js');
  const footer = api.components.find((c) => c.name === 'footer');
  assert.ok(footer.scenarios.includes('update-available') && footer.defaultScenario === 'demo');
  assert.deepEqual(api.components.find((c) => c.name === 'knob').scenarios, [], 'controls have no scenarios');
  assert.deepEqual(api.components.find((c) => c.name === 'settings').scenarios, SCENARIOS, '"all" expands to every mock scenario');
});

test('themes: every design_library theme lists its tokens and a source file path', () => {
  const ids = api.themes.items.map((t) => t.id).sort();
  assert.deepEqual(ids, THEME_IDS.slice().sort());
  assert.equal(api.themes.manifestFound, true);
  assert.equal(api.themes.source, 'design_library/manifest.json');
  assert.equal(api.themes.defaultTheme.id, 'default');
  for (const t of api.themes.items) {
    assert.equal(t.found, true, t.id);
    assert.equal(t.tokensFile, 'design_library/' + t.id + '/tokens.css', 'a design with tokens.css points at it');
    assert.equal(t.tokenFile, t.tokensFile);
    assert.equal(t.derived, false);
    assert.deepEqual(t.modes, ['night', 'day']);
    assert.equal(t.cssUrl, '/kit-theme/' + t.id + '.css');
    assert.ok(['night', 'day'].includes(t.appearance), t.id + ' appearance');
    const names = t.tokens.map((x) => x.name);
    for (const n of ['--plate', '--ink', '--accent', '--rule']) assert.ok(names.includes(n), t.id + ' defines ' + n);
    for (const tok of t.tokens) assert.ok(tok.from && tok.value, t.id + ' ' + tok.name + ' shows its source key');
    const css = fs.readFileSync(path.join(REPO_ROOT, 'design_library', t.id, 'tokens.css'), 'utf8');
    for (const tok of t.tokens) assert.ok(css.includes(tok.name + ':'), t.id + ' ' + tok.name + ' is declared in tokens.css');
    assert.ok(t.tokens.length > 40, t.id + ': the whole token contract is listed');
  }
  assert.equal(api.themes.items.find((t) => t.id === 'apc-minimal').appearance, 'night', 'APC Minimal starts in night');
});

test('standards coverage: baseline items map to existing components and test pages', () => {
  assert.ok(api.coverage.length >= 25);
  const names = new Set(api.components.map((c) => c.name));
  const sections = new Set(api.coverage.map((r) => r.section));
  for (const s of ['Control gestures', 'Window chrome and scaling', 'Settings and help', 'Workflow safety', 'Branding']) assert.ok(sections.has(s), 'section ' + s);
  for (const r of api.coverage) {
    assert.ok(['kit', 'partial', 'native', 'not-in-kit'].includes(r.status), r.item + ': status ' + r.status);
    for (const n of r.components) assert.ok(names.has(n), r.item + ': component ' + n);
    for (const t of r.tests) assert.equal(t.found, true, r.item + ': test page ' + t.file);
    if (r.status === 'kit') assert.ok(r.components.length > 0 && r.tests.length > 0, r.item + ': a "kit" row names a component and a test page');
    for (const d of r.decisions) assert.match(d, /^[A-Z]-\d\d$/);
  }
  const decisions = new Set(api.coverage.flatMap((r) => r.decisions));
  for (const d of ['U-01', 'U-03', 'U-05', 'U-08', 'U-09', 'U-10', 'U-13', 'U-16', 'X-08', 'X-09']) assert.ok(decisions.has(d), 'coverage mentions ' + d);
});

// ─── /kit/<file>: allow-list + traversal ────────────────────────────────────
test('GET /kit/<file> serves every kit *.js / *.css with the right MIME and no-store', async () => {
  const files = kitRootFiles();
  assert.ok(files.length >= 14);
  for (const f of files) {
    const r = await get(hub, '/kit/' + f);
    assert.equal(r.status, 200, f);
    assert.equal(r.headers['cache-control'], 'no-store', f);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', f);
    assert.match(r.headers['content-type'], f.endsWith('.css') ? /^text\/css/ : /^text\/javascript/, f);
    assert.ok(r.buf.equals(fs.readFileSync(path.join(KIT_DIR, f))), f + ' is served byte for byte');
  }
  assert.deepEqual(api.files.map((x) => x.file).sort(), files, 'API lists exactly the served files');
});

test('GET /kit/ does not serve tests/, markdown, html or anything outside the allow-list', async () => {
  const refused = [
    '/kit/CONTRACT.md', '/kit/tests/harness-a.js', '/kit/tests/kit-a.html', '/kit/tests/', '/kit/tests', '/kit/', '/kit/index.html',
    '/kit/package.json', '/kit/apc-nope.js', '/kit/APC-CORE.CSS', '/kit/apc-core.css/', '/kit/apc-core.css.', '/kit/apc-core.css%20',
    '/kit/apc-core.css::$DATA', '/kit/APC-CO~1.CSS', '/kit/.apc-core.css', '/kit/-apc-core.css', '/kit/apc-core.css.map',
  ];
  for (const p of refused) {
    const r = await get(hub, p);
    assert.ok([403, 404].includes(r.status), p + ' -> ' + r.status);
    assert.ok(!/use strict/.test(r.text.slice(0, 400)), p + ' leaked file content');
  }
});

test('GET /kit/ rejects path traversal: "..", %2e%2e, backslashes, absolute paths, NUL, malformed escapes', async () => {
  const serverSrc = fs.readFileSync(SERVER, 'utf8');
  const bad = [
    '/kit/../hub/server.js', '/kit/..%2fhub%2fserver.js', '/kit/%2e%2e/hub/server.js', '/kit/%2e%2e%2fhub%2fserver.js',
    '/kit/%2E%2E%2Fhub%2Fserver.js', '/kit/..%5chub%5cserver.js', '/kit/..\\hub\\server.js', '/kit/%252e%252e%252fhub%252fserver.js',
    '/kit/./apc-core.css', '/kit//apc-core.css', '/kit/sub/../apc-core.css', '/kit/%2fetc%2fpasswd', '/kit//etc/passwd',
    '/kit/C:/Windows/win.ini', '/kit/C%3A%5CWindows%5Cwin.ini', '/kit/%5c%5cserver%5cshare%5cx.js', '/kit/..%00.js',
    '/kit/apc-core.css%00.js', '/kit/%00', '/kit/..%c0%afhub%c0%afserver.js', '/kit/..%ef%bc%8fhub%ef%bc%8fserver.js',
  ];
  for (const p of bad) {
    const r = await get(hub, p);
    assert.ok([400, 403, 404].includes(r.status), p + ' -> ' + r.status);
    assert.ok(!r.text.includes('APC Hub - read-only local dashboard server') && !r.text.includes(serverSrc.slice(0, 80)), p + ' leaked hub/server.js');
  }
  const malformed = await get(hub, '/kit/%E0%A4%A');
  assert.equal(malformed.status, 400, 'malformed escape is a clean 400 (not a crash)');
  assert.equal((await get(hub, '/%E0%A4%A')).status, 400, 'same for the static UI route (it used to throw an uncaught URIError)');
  assert.equal((await get(hub, '/api/v1/meta')).status, 200, 'the hub is still alive after the hostile requests');
});

test('GET /kit/ ignores symlinks and directories that look like kit files (fixture)', async (t) => {
  const root = makeRoot();
  const kit = path.join(root, 'templates', 'webview', 'apc-ui');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET-CONTENT');
  fs.mkdirSync(path.join(kit, 'trap.js'));
  let linked = false;
  try { fs.symlinkSync(path.join(root, 'secret.txt'), path.join(kit, 'evil.js')); linked = true; } catch { /* no symlink privilege (Windows) */ }
  const h = await startHub(root);
  const dir = await get(h, '/kit/trap.js');
  assert.equal(dir.status, 404, 'a directory named *.js is not served');
  if (linked) {
    const ln = await get(h, '/kit/evil.js');
    assert.equal(ln.status, 404, 'a symlink is not served');
    assert.ok(!ln.text.includes('TOP-SECRET'));
    assert.ok(!(await get(h, '/api/v1/kit')).json.files.some((f) => f.file === 'evil.js'), 'a symlink is not in the allow-list');
  } else {
    t.diagnostic('symlink creation not permitted here: symlink half of this test not exercised');
  }
  assert.equal((await get(h, '/kit/apc-core.css')).status, 200);
});

// ─── /kit-theme/<id>.css ────────────────────────────────────────────────────
test('GET /kit-theme/<id>.css serves the design tokens.css as-is; nothing else', async () => {
  for (const id of THEME_IDS) {
    const r = await get(hub, '/kit-theme/' + id + '.css');
    assert.equal(r.status, 200, id);
    assert.match(r.headers['content-type'], /^text\/css/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.match(r.text, /--plate:\s*#/);
    assert.match(r.text, /--accent:/);
    assert.match(r.text, /\[data-theme="day"\]/, 'both modes are in the served file');
    // the only url() allowed is a same-origin bundled font (rewritten from the portable `fonts/x.woff2`)
    const SAME_ORIGIN_FONT = /url\((['"]?)\/(?:kit|preview\/[A-Za-z0-9_-]+)\/fonts\/[A-Za-z0-9_.-]+\.woff2\1\)/g;
    const stripped = r.text.replace(SAME_ORIGIN_FONT, '');
    assert.ok(!/https?:\/\/|url\(|@import|expression\(/i.test(stripped), id + ': no external references');
    const file = fs.readFileSync(path.join(REPO_ROOT, 'design_library', id, 'tokens.css'), 'utf8');
    assert.equal(r.text.replace(SAME_ORIGIN_FONT, 'url(F)'), file.replace(/url\((['"]?)fonts\/[A-Za-z0-9_.-]+\.woff2\1\)/g, 'url(F)'),
      id + ': tokens.css is served verbatim apart from the font URL rewrite');
  }
  for (const p of ['/kit-theme/nope.css', '/kit-theme/manifest.json', '/kit-theme/..%2fmanifest.css', '/kit-theme/%2e%2e%2fmanifest.css', '/kit-theme/apc-minimal.css/x', '/kit-theme/', '/kit-theme/apc-minimal', '/kit-theme/%E0%A4%A']) {
    const r = await get(hub, p);
    assert.ok([400, 403, 404].includes(r.status), p + ' -> ' + r.status);
  }
});

test('fallback: a design WITHOUT tokens.css still gets tokens derived from its design-system.json (fixture)', async () => {
  const h = await startHub(makeRoot({ themes: 'legacy' }));
  const k = (await get(h, '/api/v1/kit')).json;
  const night = k.themes.items.find((t) => t.id === 'legacy-night');
  const day = k.themes.items.find((t) => t.id === 'legacy-day');
  for (const t of [night, day]) {
    assert.equal(t.found, true, t.id);
    assert.equal(t.derived, true, t.id);
    assert.equal(t.tokensFile, null, t.id + ': no tokens.css');
    assert.equal(t.tokenFile, 'design_library/' + t.id + '/design-system.json');
    assert.equal(t.cssUrl, '/kit-theme/' + t.id + '.css');
    assert.ok(t.tokens.every((x) => x.from !== 'tokens.css' && /^(palette|typography|components)\./.test(x.from)), t.id + ': tokens show their design-system.json source key');
  }
  assert.equal(night.appearance, 'night');
  assert.equal(day.appearance, 'day');
  assert.deepEqual(night.modes, ['night']);
  assert.equal(k.themes.items.find((t) => t.id === 'apc-minimal').derived, false, 'the shipped design is unaffected');
  const css = await get(h, '/kit-theme/legacy-night.css');
  assert.equal(css.status, 200);
  assert.match(css.text, /--accent:\s*#12ab34;/i);
  assert.match(css.text, /--font-ui:\s*Georgia, serif;/);
  assert.match(css.text, /--r-control:\s*2px;/);
  assert.match(css.text, /\[data-theme="night"\]/);
  assert.match((await get(h, '/kit-theme/legacy-day.css')).text, /--accent:\s*#d9531e;/i);
  assert.match((await get(h, '/kit-demo/knob?theme=legacy-day')).text, /<html lang="en" data-theme="day"/, 'a derived theme starts in its own appearance');
  assert.match((await get(h, '/kit-demo/knob?theme=legacy-day&mode=night')).text, /<html lang="en" data-theme="night"/);
  // the shipped design is still served verbatim (apart from the same-origin font URL rewrite) next to the derived ones
  const own = await get(h, '/kit-theme/apc-minimal.css');
  const fontUrl = /url\((['"]?)[^)'"]*fonts\/([A-Za-z0-9_.-]+\.woff2)\1\)/g;
  assert.equal(own.text.replace(fontUrl, 'url($2)'),
    fs.readFileSync(path.join(REPO_ROOT, 'design_library', 'apc-minimal', 'tokens.css'), 'utf8').replace(fontUrl, 'url($2)'));
});

test('GET /api/v1/designs exposes tokens / spec and whether the files exist', async () => {
  const d = (await get(hub, '/api/v1/designs')).json;
  assert.equal(d.totalDesigns, 1);
  assert.deepEqual(d.designs.map((x) => x.id), ['apc-minimal']);
  const x = d.designs[0];
  assert.equal(x.tokens, 'tokens.css');
  assert.equal(x.spec, 'design-system.json');
  assert.equal(x.tokensExists, true);
  assert.equal(x.specExists, true);
  assert.deepEqual(x.missingExamples, []);
  assert.ok(x.htmlFiles.includes('preview.html'));
});

// ─── /kit-demo/<component> ──────────────────────────────────────────────────
function demoRefs(html) {
  return Array.from(html.matchAll(/\b(?:src|href)="([^"]*)"/g), (m) => m[1]);
}
test('demo page generation: every component x (default + each theme) -> 200, CSP, no external URLs', async () => {
  const themes = ['default'].concat(THEME_IDS);
  let n = 0;
  for (const c of api.components) {
    for (const th of themes) {
      const r = await get(hub, '/kit-demo/' + c.name + '?theme=' + th);
      const label = c.name + ' / ' + th;
      assert.equal(r.status, 200, label);
      assert.match(r.headers['content-type'], /^text\/html/, label);
      assert.equal(r.headers['cache-control'], 'no-store', label);
      const csp = r.headers['content-security-policy'] || '';
      assert.ok(csp.startsWith("default-src 'self'"), label + ': CSP ' + csp);
      assert.ok(/connect-src 'none'/.test(csp) && /frame-ancestors 'self'/.test(csp), label + ': CSP locks down network + framing');
      assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', label);
      assert.ok(!/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(r.text), label + ': no external URLs in the page');
      for (const ref of demoRefs(r.text)) assert.match(ref, /^\/(kit|kit-demo|kit-theme)\//, label + ': reference ' + ref + ' stays on this origin');
      assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>[^<]/i.test(r.text), label + ': no inline script (CSP default-src has no unsafe-inline for scripts)');
      assert.match(r.text, new RegExp('data-demo-component="' + c.name + '"'), label);
      assert.equal(th === 'default' ? !r.text.includes('/kit-theme/') : r.text.includes('/kit-theme/' + th + '.css'), true, label + ': theme stylesheet link');
      n++;
    }
  }
  assert.equal(n, api.components.length * (1 + THEME_IDS.length));
});

test('demo page: boot order (mock -> setup -> components -> mount) and every referenced file is served', async () => {
  for (const c of api.components) {
    const r = await get(hub, '/kit-demo/' + c.name);
    const refs = demoRefs(r.text);
    const idx = (s) => refs.findIndex((x) => x === s);
    const order = ['/kit-demo/_early.js', '/kit/apc-fit.js', '/kit/apc-kit.js', '/kit/apc-mock.js', '/kit-demo/_setup.js']
      .concat(c.demo.scripts.map((s) => '/kit/' + s), ['/kit-demo/_post.js']);
    for (let i = 1; i < order.length; i++) {
      assert.ok(idx(order[i - 1]) >= 0 && idx(order[i]) > idx(order[i - 1]), c.name + ': ' + order[i - 1] + ' before ' + order[i]);
    }
    for (const ref of refs.filter((x) => /\.(js|css)$/.test(x))) {
      const f = await get(hub, ref);
      assert.equal(f.status, 200, c.name + ': ' + ref);
    }
  }
});

test('demo page options: scenario, mode, theme are validated and never echoed into the page', async () => {
  for (const s of SCENARIOS) {
    const r = await get(hub, '/kit-demo/footer?scenario=' + s);
    assert.equal(r.status, 200, s);
    assert.match(r.text, new RegExp('data-demo-scenario="' + s + '"'));
  }
  const day = await get(hub, '/kit-demo/knob?mode=day');
  assert.match(day.text, /<html lang="en" data-theme="day"/);
  const own = await get(hub, '/kit-demo/knob?theme=apc-minimal');
  assert.match(own.text, /<html lang="en" data-theme="night"/, 'a theme starts in its own appearance');
  const forced = await get(hub, '/kit-demo/knob?theme=apc-minimal&mode=day');
  assert.match(forced.text, /<html lang="en" data-theme="day"/, 'an explicit mode wins');
  const xss = '%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E';
  const cases = [
    ['/kit-demo/knob?scenario=nope', 400], ['/kit-demo/knob?scenario=' + xss, 400], ['/kit-demo/knob?mode=dusk', 400],
    ['/kit-demo/knob?theme=' + xss, 400], ['/kit-demo/knob?theme=nope', 404], ['/kit-demo/knob?theme=..%2fx', 400],
    ['/kit-demo/nope', 404], ['/kit-demo/KNOB', 404], ['/kit-demo/..%2f..%2fserver.js', 404], ['/kit-demo/%2e%2e', 404],
    ['/kit-demo/', 404], ['/kit-demo/knob/extra', 404], ['/kit-demo/%E0%A4%A', 400], ['/kit-demo/_evil.js', 404],
  ];
  for (const [p, status] of cases) {
    const r = await get(hub, p);
    assert.equal(r.status, status, p);
    assert.ok(!r.text.includes('<script>alert'), p + ' must not reflect input');
  }
});

// ─── missing / partial kit, themes (fixtures) ───────────────────────────────
test('kit folder missing: API says NOT FOUND + expected path, routes 404 with [NOT FOUND]', async () => {
  const h = await startHub(makeRoot({ kit: 'none' }));
  const r = await get(h, '/api/v1/kit');
  assert.equal(r.status, 200);
  assert.equal(r.json.kitFound, false);
  assert.equal(r.json.expected, 'templates/webview/apc-ui/');
  assert.ok(r.json.issues.some((i) => /NOT FOUND.*templates\/webview\/apc-ui/.test(i)), JSON.stringify(r.json.issues));
  assert.equal(r.json.catalogFound, true, 'the catalog lives with the hub, not with the kit');
  assert.deepEqual(r.json.files, []);
  assert.equal(r.json.scenarios.found, false, 'scenarios cannot be derived without apc-mock.js');
  assert.equal(r.json.scenarios.expected, 'templates/webview/apc-ui/apc-mock.js');
  for (const p of ['/kit/apc-core.css', '/kit/apc-kit.js', '/kit-demo/knob', '/kit-demo/footer?theme=apc-minimal']) {
    const x = await get(h, p);
    assert.equal(x.status, 404, p);
    assert.match(x.text, /\[NOT FOUND\]/, p);
    assert.match(x.text, /templates\/webview\/apc-ui/, p + ' names the expected path');
  }
  assert.equal((await get(h, '/kit-demo/_post.js')).status, 200, 'boot scripts are hub code, not kit files');
});

test('partial kit: a missing component file is reported, its demo 404s, the others still work', async () => {
  const h = await startHub(makeRoot({ kit: 'partial' }));
  const r = (await get(h, '/api/v1/kit')).json;
  assert.equal(r.kitFound, true);
  assert.ok(r.issues.some((i) => /NOT FOUND: templates\/webview\/apc-ui\/apc-update-ui\.js/.test(i)), JSON.stringify(r.issues));
  assert.ok(r.issues.some((i) => /catalog lists "update" but no APC\.register\("update"\)/.test(i)), JSON.stringify(r.issues));
  const upd = r.components.find((c) => c.name === 'update');
  assert.equal(upd.fileFound, false);
  assert.deepEqual(upd.demo.missingScripts, ['apc-update-ui.js']);
  const demo = await get(h, '/kit-demo/update');
  assert.equal(demo.status, 404);
  assert.match(demo.text, /\[NOT FOUND\] templates\/webview\/apc-ui\/apc-update-ui\.js/);
  assert.equal((await get(h, '/kit-demo/knob')).status, 200);
});

test('a component registered in the kit but missing from the catalog is flagged (catalog drift)', async () => {
  const h = await startHub(makeRoot({ kit: 'extra' }));
  const r = (await get(h, '/api/v1/kit')).json;
  assert.ok(r.issues.some((i) => /APC\.register\("extra-widget"\).*no catalog entry/.test(i)), JSON.stringify(r.issues));
  assert.equal(r.registered['extra-widget'], 'apc-extra.js');
});

test('theme missing: design_library manifest absent / theme without tokens.css / design-system.json -> NOT FOUND + expected path', async () => {
  const none = await startHub(makeRoot({ themes: 'none' }));
  const a = (await get(none, '/api/v1/kit')).json;
  assert.equal(a.themes.manifestFound, false);
  assert.equal(a.themes.expected, 'design_library/manifest.json');
  assert.deepEqual(a.themes.items, []);
  assert.equal((await get(none, '/kit-demo/knob')).status, 200, 'default tokens still work');
  assert.equal((await get(none, '/kit-demo/knob?theme=apc-minimal')).status, 404);
  assert.match((await get(none, '/kit-theme/apc-minimal.css')).text, /\[NOT FOUND\] design_library\/manifest\.json/);

  const ghost = await startHub(makeRoot({ themes: 'ghost' }));
  const b = (await get(ghost, '/api/v1/kit')).json;
  const g = b.themes.items.find((t) => t.id === 'ghost-theme');
  assert.equal(g.found, false);
  assert.equal(g.tokenFile, 'design_library/ghost-theme/design-system.json');
  assert.equal(g.cssUrl, null);
  const d = await get(ghost, '/kit-demo/knob?theme=ghost-theme');
  assert.equal(d.status, 404);
  assert.match(d.text, /\[NOT FOUND\] design_library\/ghost-theme\/design-system\.json/);
  assert.equal((await get(ghost, '/kit-theme/ghost-theme.css')).status, 404);
  assert.equal(b.themes.items.filter((t) => t.found).length, 1, 'the real theme is unaffected');
});

// ─── invariants ─────────────────────────────────────────────────────────────
test('GET-only invariant: no write method works on any KIT route and nothing is written', async () => {
  const root = makeRoot();
  const h = await startHub(root);
  const snapshot = () => fs.readdirSync(root, { recursive: true }).sort().join('\n');
  const cfgBefore = fs.readFileSync(path.join(root, 'apc.config.json'), 'utf8');
  const before = snapshot();
  const routes = ['/api/v1/kit', '/kit/apc-core.css', '/kit-demo/knob', '/kit-demo/_post.js', '/kit-theme/apc-minimal.css'];
  for (const p of routes) {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await request(h, m, p, { body: { x: 1 } });
      assert.equal(r.status, 405, m + ' ' + p);
    }
  }
  // a hostile cross-site POST to the only config write path is still refused for a foreign Origin
  const evil = await request(h, 'POST', '/api/v1/config', { body: { version: 1 }, headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(snapshot(), before, 'no file created or removed');
  assert.equal(fs.readFileSync(path.join(root, 'apc.config.json'), 'utf8'), cfgBefore);
  // the real hub: same story, and the source of the KIT routes has no fs write call
  const src = fs.readFileSync(SERVER, 'utf8');
  const kitBlock = src.slice(src.indexOf('// ─── UI kit gallery'), src.indexOf('// ─── HTTP ───'));
  assert.ok(kitBlock.length > 5000, 'sanity: found the kit block');
  assert.ok(!/writeFile|appendFile|createWriteStream|mkdirSync|unlinkSync|rmSync|copyFile|renameSync|child_process|execFile|execSync|spawn/.test(kitBlock), 'the KIT block never writes or executes anything');
});

test('the server is still loopback-only and the pre-existing routes are intact', async () => {
  for (const p of ['/api/v1/meta', '/api/v1/standards', '/api/v1/designs', '/']) assert.equal((await get(hub, p)).status, 200, p);
  const r = await get(hub, '/api/v1/meta');
  assert.equal(r.json.hub, '1.1.0');
  const addr = await new Promise((resolve) => {
    const s = http.request({ host: '127.0.0.1', port: hub.port, path: '/kit/apc-core.css', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    s.end();
  });
  assert.equal(addr, 200, 'GET routes do not depend on Host (read-only, loopback socket)');
  assert.match(fs.readFileSync(SERVER, 'utf8'), /server\.listen\(PORT, '127\.0\.0\.1'/, 'bound to loopback');
});

test('UI ships the KIT section (nav entry, renderer, stylesheet, sandboxed iframe, copy button)', async () => {
  const html = await get(hub, '/');
  assert.match(html.text, /href="#09c-kit"/);
  assert.match(html.text, /css\/kit\.css/);
  const js = { text: (await get(hub, '/app.js')).text + (await get(hub, '/kit.js')).text };   // the KIT page code lives in kit.js
  for (const s of ['function renderKit', 'sandbox="allow-scripts allow-same-origin"', 'data-kit-sel', 'kit-copy', 'STANDARDS COVERAGE', "api('kit')", '[NOT FOUND]']) {
    assert.ok(js.text.includes(s), 'app.js contains ' + s);
  }
  const css = await get(hub, '/css/kit.css');
  assert.equal(css.status, 200);
  assert.ok(!/border-radius\s*:\s*[1-9]/.test(css.text), 'rectangles only');
  assert.ok(!/https?:\/\//.test(css.text), 'no external references');
  const shell = await get(hub, '/css/shell.css');
  assert.ok(shell.text.includes('section[id="09c-kit"]:target'), 'nav highlight rule');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, '.agents', 'guides', 'hub-kit.md')), 'agent guide exists');
});

// ─── real browser (skips cleanly without Edge / Chrome / Chromium) ──────────
const BROWSER = findBrowser({});
const noBrowser = BROWSER.path ? false : 'no Edge / Chrome / Chromium found (set APC_BROWSER to run the real-browser checks)';

function dumpDom(url, { budget = 8000, timeout = 90000 } = {}) {
  return new Promise((resolve) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-kit-br-'));
    dirs.push(profile);
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
      '--disable-background-networking', '--hide-scrollbars', '--window-size=1000,700', '--user-data-dir=' + profile,
      '--virtual-time-budget=' + budget, '--dump-dom', url];
    execFile(BROWSER.path, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve({ err, dom: String(stdout || '') });
    });
  });
}
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
const errorToasts = (dom) => (dom.match(/class="apc-toast apc-toast--error"/g) || []).length;
const toastTexts = (dom) => Array.from(dom.matchAll(/apc-toast--error"[^>]*>\s*<span class="apc-toast__msg">([^<]*)/g), (m) => m[1]);

test('real browser: every component mounts on its demo page (default theme), no error toast', { skip: noBrowser, timeout: 600000 }, async () => {
  const results = await pool(api.components, 4, async (c) => {
    const { err, dom } = await dumpDom('http://127.0.0.1:' + hub.port + '/kit-demo/' + c.name);
    return { c, err, dom };
  });
  for (const { c, err, dom } of results) {
    assert.ok(dom.length > 500, c.name + ': browser produced a DOM' + (err ? ' (' + err.message + ')' : ''));
    assert.match(dom, /data-demo-ready="1"/, c.name + ': demo finished booting');
    assert.equal(errorToasts(dom), 0, c.name + ': error toast(s): ' + toastTexts(dom).join(' | '));
    const wanted = (c.demo.expect || []).length;
    assert.match(dom, /data-demo-missing="\[\]"/, c.name + ': expected DOM missing (' + (dom.match(/data-demo-missing="([^"]*)"/) || [])[1] + ')');
    const mounted = Number((dom.match(/data-demo-mounted="(\d+)"/) || [])[1]);
    const bodyMarkup = catalog.components.find((x) => x.name === c.name).demo.body;
    const declared = (bodyMarkup.match(/data-apc="/g) || []).length;
    assert.ok(mounted >= declared && mounted >= 1 && wanted >= 1, c.name + ': mounted ' + mounted + ' of ' + declared + ' declared kit elements');
  }
});

test('real browser: a themed demo and a day-mode demo render without error toasts; a broken kit file IS detected', { skip: noBrowser, timeout: 300000 }, async () => {
  const urls = THEME_IDS.map((id) => '/kit-demo/footer?theme=' + id + '&scenario=update-available').concat(['/kit-demo/knob?mode=day', '/kit-demo/presets?scenario=licensed']);
  const res = await pool(urls, 3, async (u) => ({ u, ...(await dumpDom('http://127.0.0.1:' + hub.port + u)) }));
  for (const { u, dom } of res) {
    assert.match(dom, /data-demo-ready="1"/, u);
    assert.equal(errorToasts(dom), 0, u + ': ' + toastTexts(dom).join(' | '));
    assert.match(dom, /data-demo-missing="\[\]"/, u);
  }
  assert.match(res[0].dom, /↑ update available/, 'scenario update-available reaches the footer');
  assert.match(res[THEME_IDS.length].dom, /data-theme="day"/);
  // negative control: if a kit script is broken the page must say so (never a silent blank)
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'templates', 'webview', 'apc-ui', 'apc-controls.js'), 'throw new Error("boom: broken kit file");\n');
  const h = await startHub(root);
  const broken = await dumpDom('http://127.0.0.1:' + h.port + '/kit-demo/knob');
  assert.ok(errorToasts(broken.dom) >= 1, 'a broken component script produces a visible error toast');
  assert.match(broken.dom, /boom: broken kit file|unknown APC component: knob/);
  assert.doesNotMatch(broken.dom, /data-demo-missing="\[\]"/, 'and the expected DOM is reported missing');
});

test('real browser: the Hub KIT page loads, lists every component and the live demo reports [OK]', { skip: noBrowser, timeout: 120000 }, async () => {
  const { dom } = await dumpDom('http://127.0.0.1:' + hub.port + '/#09c-kit', { budget: 15000 });
  assert.match(dom, /<section id="09c-kit"/);
  for (const c of api.components) assert.ok(dom.includes('data-kit-sel="' + c.name + '"'), 'list entry ' + c.name);
  for (const g of GROUPS) assert.ok(dom.includes('>' + g.replace('&', '&amp;') + '</div>'), 'group ' + g);
  assert.match(dom, /<iframe id="kit-frame" sandbox="allow-scripts allow-same-origin"/);
  assert.match(dom, /id="kit-status"[^>]*>\s*<span class="tok-ok">\[OK\]<\/span>[^<]*<span class="mono">mounted 4 kit element/, 'status line reports a mounted demo');
  assert.match(dom, /STANDARDS COVERAGE/);
  assert.match(dom, /id="kit-copy"/);
  assert.match(dom, /catalog and kit agree/);
});

// Drives the Hub KIT page like a user (theme, viewport, scale, scenario, selection, copy, persistence)
// through the Chrome DevTools protocol: --remote-debugging-port=0 + Node's global WebSocket (Node 22+).
test('real browser (DevTools protocol): the KIT page controls drive the live demo iframe', {
  skip: noBrowser || (typeof WebSocket === 'undefined' ? 'no global WebSocket (needs Node 22+)' : false), timeout: 180000,
}, async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-kit-cdp-'));
  dirs.push(profile);
  const br = spawn(BROWSER.path, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1340,1000', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  procs.push(br);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws;
  try {
    let port = null;
    for (let i = 0; i < 80 && !port; i++) {
      try { port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); } catch { await sleep(250); }
    }
    assert.ok(port > 0, 'the browser announced its DevTools port');
    const list = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: '/json' }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject));
    const page = list.find((x) => x.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let seq = 0;
    const waiting = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
    const send = (method, params) => new Promise((resolve) => { const i = ++seq; waiting.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      assert.ok(!r.result.exceptionDetails, 'page script threw: ' + JSON.stringify(r.result.exceptionDetails && r.result.exceptionDetails.exception));
      return r.result.result.value;
    };
    const until = async (expr, label) => {
      for (let i = 0; i < 60; i++) { if (await ev(expr)) return; await sleep(200); }
      assert.fail('timed out waiting for ' + label);
    };
    const change = (id, value) => ev("(()=>{const s=document.getElementById('" + id + "'); s.value='" + value + "'; s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    const frameSrc = () => ev("document.getElementById('kit-frame').getAttribute('src')");
    const statusOk = "/^\\[OK\\] mounted \\d+ kit element/.test(document.getElementById('kit-status').textContent)";

    await send('Page.navigate', { url: 'http://localhost:' + hub.port + '/#09c-kit' });
    await until("!!document.getElementById('kit-status') && " + statusOk, 'first demo [OK]');
    assert.equal(await frameSrc(), '/kit-demo/knob?theme=apc-minimal&mode=night', 'the one shipped design is selected (no design select with a single design)');
    assert.equal(await ev("document.getElementById('kit-theme')"), null, 'a design select appears only when design_library has more than one design');
    assert.equal(await ev("document.getElementById('kit-frame').width + 'x' + document.getElementById('kit-frame').height"), '544x224', '34x14 cells at 100 %');
    assert.equal(await ev("getComputedStyle(document.getElementById('kit-frame').contentDocument.getElementById('apc-demo-plate')).backgroundColor"), 'rgb(18, 41, 53)', 'the theme token reached the iframe (APC Minimal --plate #122935)');
    assert.match(await ev("document.getElementById('kit-themenote').textContent"), /design_library\/apc-minimal\/tokens\.css/, 'the note names the token source file');

    await ev("document.querySelector('[data-kit-mode=day]').click()");
    await until("document.getElementById('kit-frame').getAttribute('src') === '/kit-demo/knob?theme=apc-minimal&mode=day' && " + statusOk, 'day mode demo');
    assert.equal(await ev("getComputedStyle(document.getElementById('kit-frame').contentDocument.getElementById('apc-demo-plate')).backgroundColor"), 'rgb(227, 234, 236)', 'the day tokens reached the iframe (APC Minimal day --plate #E3EAEC)');
    await ev("document.querySelector('[data-kit-mode=night]').click()");
    await until("document.getElementById('kit-frame').getAttribute('src') === '/kit-demo/knob?theme=apc-minimal&mode=night' && " + statusOk, 'night mode demo');

    await change('kit-scale', '200');
    assert.equal(await ev("document.getElementById('kit-frame').width + 'x' + document.getElementById('kit-frame').height"), '1088x448', '200 % resizes the iframe');
    assert.equal(await frameSrc(), '/kit-demo/knob?theme=apc-minimal&mode=night', 'resizing does not reload the demo');

    await ev("document.querySelector('[data-kit-sel=footer]').click()");
    await until("document.getElementById('kit-frame').getAttribute('src').startsWith('/kit-demo/footer') && !!document.getElementById('kit-scn')", 'footer selected');
    await change('kit-scn', 'update-available');
    await until("document.getElementById('kit-frame').getAttribute('src').endsWith('&scenario=update-available') && " + statusOk, 'footer scenario [OK]');
    assert.match(await ev("document.getElementById('kit-frame').contentDocument.body.innerText"), /update available[\s\S]*v1\.2\.0/);

    await ev("document.querySelector('[data-kit-go=settings]').click()");
    await until("document.getElementById('kit-frame').getAttribute('src').startsWith('/kit-demo/settings') && " + statusOk, 'coverage link selects the component');
    assert.equal(await ev("document.querySelector('.kit-list [aria-current=true]').textContent.trim()"), 'settings');

    // copy needs a trusted gesture + focus: a real mouse event through the protocol
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: 'http://localhost:' + hub.port });
    const pt = JSON.parse(await ev("(()=>{const b=document.getElementById('kit-copy'); b.scrollIntoView({block:'center'}); const r=b.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()"));
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await until("document.getElementById('kit-copy').textContent === '[COPIED]'", 'copy button');
    assert.match(await ev('navigator.clipboard.readText()'), /data-apc="settings"/, 'the markup snippet is on the clipboard');

    const stored = JSON.parse(await ev("localStorage.getItem('apc-hub-kit')"));
    assert.deepEqual(stored, { sel: 'settings', theme: 'apc-minimal', scenario: 'update-available', scale: 200, mode: 'night', tab: 'components', refScale: 100 });
    await send('Page.reload', {});
    await until("!!document.getElementById('kit-frame') && document.getElementById('kit-frame').getAttribute('src') === '/kit-demo/settings?theme=apc-minimal&mode=night&scenario=update-available'", 'selection restored after reload');
    assert.equal(await ev("document.getElementById('kit-frame').getAttribute('sandbox')"), 'allow-scripts allow-same-origin');
  } finally {
    try { if (ws) ws.close(); } catch { /* closed */ }
    try { br.kill(); } catch { /* gone */ }
  }
  t.diagnostic('KIT UI driven through the DevTools protocol');
});

// ─── packaging: every kit file is vendored, or deliberately excluded from the plugin bundle ─────────────────────────
test('kit files: every *.js / *.css of the kit folder is vendored into the design preview; the plugin bundle excludes exactly the apc-mock*.js files', () => {
  const { vendorKit } = require(path.join(REPO_ROOT, 'scripts', 'ui-compose.js'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-vendor-'));
  dirs.push(dest);
  const vendoredDir = vendorKit(REPO_ROOT, dest);
  const vendored = fs.readdirSync(vendoredDir).sort();
  const kit = kitRootFiles();
  // 1. vendored: every kit js / css lands in <plugin>/Design/apc-ui (the CONTRACT and the self-test pages do not)
  for (const f of kit) assert.ok(vendored.includes(f), f + ' is vendored');
  assert.ok(!vendored.includes('CONTRACT.md') && !vendored.includes('tests'), 'docs and tests never ship');
  for (const f of ['apc-widgets.js', 'apc-widgets.css', 'apc-viz.js', 'apc-viz.css', 'apc-mock-viz.js']) assert.ok(kit.includes(f) && vendored.includes(f), f);

  // 2. the plugin bundle (CMake template): fit, kit, bridge first, the rest alphabetical, apc-mock*.js removed
  const cmake = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'webview', 'CMakeLists.txt.template'), 'utf8');
  const first = (cmake.match(/set\(_apc_kit_first ([^)]+)\)/) || [])[1].trim().split(/\s+/);
  assert.deepEqual(first, ['apc-fit.js', 'apc-kit.js', 'apc-bridge.js']);
  const rx = (cmake.match(/list\(FILTER _apc_kit_rest EXCLUDE REGEX "([^"]+)"\)/) || [])[1];
  assert.ok(rx, 'the template filters the glob with a regex');
  const excludeRe = new RegExp(rx.replace(/\\\\/g, '\\'));
  const js = kit.filter((f) => /^apc-.*\.js$/.test(f));
  const rest = js.filter((f) => !first.includes(f)).sort();
  const shipped = first.concat(rest.filter((f) => !excludeRe.test(f)));
  const excluded = rest.filter((f) => excludeRe.test(f));
  assert.deepEqual(excluded, ['apc-mock-viz.js', 'apc-mock.js'], 'only the demo / test data files are excluded from a plugin build');
  assert.ok(!shipped.some((f) => /apc-mock/.test(f)), 'no mock file ships in the plugin bundle');
  for (const f of ['apc-controls.js', 'apc-widgets.js', 'apc-viz.js', 'apc-chrome.js', 'apc-settings.js']) assert.ok(shipped.includes(f), f + ' ships');
  assert.ok(shipped.indexOf('apc-controls.js') < shipped.indexOf('apc-widgets.js'), 'apc-widgets.js loads after apc-controls.js (it needs APC.controls.Model)');
  assert.ok(shipped.indexOf('apc-kit.js') < shipped.indexOf('apc-viz.js') && shipped.indexOf('apc-bridge.js') < shipped.indexOf('apc-viz.js'), 'apc-viz.js loads after kit and bridge');
  // a new kit file that is neither shipped nor a mock would be a packaging hole: every js file is in exactly one of the two lists
  assert.deepEqual(shipped.concat(excluded).sort(), js.sort());

  // 3. the design preview composer links every kit stylesheet that a plugin may use
  const composer = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'ui-compose.js'), 'utf8');
  for (const f of kit.filter((n) => n.endsWith('.css'))) assert.ok(composer.includes('apc-ui/' + f), 'ui-compose links ' + f);
});

test('demo pages: every kit stylesheet is linked before the theme tokens, apc-mock-viz.js only on pages that need a feed', async () => {
  const css = kitRootFiles().filter((n) => n.endsWith('.css'));
  const knob = (await get(hub, '/kit-demo/knob')).text;
  const order = css.map((f) => knob.indexOf('/kit/' + f));
  for (let i = 0; i < css.length; i++) assert.ok(order[i] > 0, css[i] + ' linked in the demo page');
  const themed = (await get(hub, '/kit-demo/dropdown?theme=apc-minimal')).text;
  const lastCss = Math.max(...css.map((f) => themed.indexOf('/kit/' + f)));
  assert.ok(themed.indexOf('/kit-theme/apc-minimal.css') > lastCss, 'the design tokens load after every kit stylesheet');
  const viz = (await get(hub, '/kit-demo/meter')).text;
  assert.ok(viz.indexOf('/kit/apc-viz.js') > 0 && viz.indexOf('/kit/apc-mock-viz.js') > viz.indexOf('/kit/apc-viz.js'), 'mock feed loads after the viz script');
  assert.ok(!/apc-mock-viz/.test((await get(hub, '/kit-demo/button')).text), 'a widgets demo does not load the viz mock');
  for (const c of api.components.filter((x) => x.group === 'Widgets')) {
    const t = c.demo.scripts;
    assert.ok(t.indexOf('apc-controls.js') >= 0 && t.indexOf('apc-controls.js') < t.indexOf('apc-widgets.js'), c.name + ': apc-widgets.js after apc-controls.js');
  }
});
