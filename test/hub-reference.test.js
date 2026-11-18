'use strict';
// Hub KIT page: the canonical APC Minimal design source and the design document/tuning routes.
//   GET /kit-demo/_reference?surface=night|day      canonical annotated face, served unchanged
//   GET /kit-reference/<file>                         allow-listed reference/*.js|css|svg|png
//   GET /api/v1/design/<id>                           tokens.css text + parsed design-system.json
// Zero deps: node:test + node:assert (Node 18+). Server tests talk to a real hub/server.js child process (--port 0).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'hub', 'server.js');
const KIT_DIR = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui');
const REF_DIR = path.join(KIT_DIR, 'reference');
const procs = [];
const dirs = [];
after(() => {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

function startHub(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--port', '0', '--no-open'], {
      env: { ...process.env, APC_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
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
function get(hub, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: hub.port, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    }).on('error', reject);
  });
}
function request(hub, method, urlPath, payload, headers) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : payload === undefined ? '' : JSON.stringify(payload);
    const q = http.request({ host: '127.0.0.1', port: hub.port, method, path: urlPath,
      headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* non-JSON response */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    q.on('error', reject);
    q.end(body);
  });
}
function registeredNames() {
  const out = {};
  for (const f of fs.readdirSync(KIT_DIR).filter((n) => /\.js$/.test(n))) {
    const text = fs.readFileSync(path.join(KIT_DIR, f), 'utf8');
    for (const m of text.matchAll(/APC\.register\(\s*["']([^"']+)["']/g)) out[m[1]] = f;
  }
  return out;
}
function refMarkupKinds() {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'hub', '_design', 'apc_filter_f30_annotate_v006.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const kinds = {};
  for (const m of html.matchAll(/\bdata-el="([A-Za-z0-9_-]+)"/g)) kinds[m[1]] = (kinds[m[1]] || 0) + 1;
  return kinds;
}

let hub;
before(async () => { hub = await startHub(REPO_ROOT); });

// ─── (i) coverage: every kit element is on the plate or has a documented reason ──────────────────────────────
test('the APC Minimal reference documents its source-backed APC element set', () => {
  const reg = registeredNames(), kinds = refMarkupKinds();
  assert.ok(Object.keys(reg).length >= 40, 'the kit registers its components (' + Object.keys(reg).length + ')');
  const unknown = Object.keys(kinds).filter((n) => !reg[n]);
  assert.deepEqual(unknown, [], 'source elements map to APC.register names: ' + unknown.join(', '));
  assert.equal(Object.keys(kinds).length, 30, 'the source declares the documented 30/30 element coverage');
});

test('the v006 annotated face is the only APC Minimal reference source', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'hub', '_design', 'apc_filter_f30_annotate_v006.html'));
  const text = source.toString('utf8');
  assert.match(text, /--cols:120; --rows:70/);
  assert.match(text, /data-el="knob"/);
  assert.match(text, /URL:  \?surface=day  \?anatomy=1/);
  assert.doesNotMatch(text, /(?:src|href)="(?:https?:)?\/\//, 'the source has no external assets');
  assert.doesNotMatch(text, /(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'the source makes no network requests');
});

// ─── (ii) routes ────────────────────────────────────────────────────────────────────────────────────────────
test('GET /kit-demo/_reference serves the canonical source byte-for-byte with its inline-script CSP', async () => {
  const r = await get(hub, '/kit-demo/_reference?surface=day');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.match(r.headers['content-security-policy'], /script-src 'self' 'unsafe-inline'/);
  assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
  assert.deepEqual(Buffer.from(r.text, 'utf8'), fs.readFileSync(path.join(REPO_ROOT, 'hub', '_design', 'apc_filter_f30_annotate_v006.html')));
  assert.equal((await get(hub, '/kit-demo/_reference')).status, 200);
});

test('GET /kit-demo/_reference validates every parameter (400 / 404, never a crash)', async () => {
  const xss = encodeURIComponent('"><script>1</script>');
  const cases = [
    ['/kit-demo/_reference?surface=dusk', 400], ['/kit-demo/_reference?mode=dusk', 400],
    ['/kit-demo/_reference?theme=' + xss, 404], ['/kit-demo/_reference?theme=nope', 404],
    ['/kit-demo/_reference/extra', 404], ['/kit-demo/_reference.js', 404],
  ];
  for (const [p, want] of cases) assert.equal((await get(hub, p)).status, want, p);
});

test('GET /kit-reference/<file> serves only the allow-listed legacy support files', async () => {
  for (const [f, mime] of [['reference-plugin.js', /javascript/], ['reference-backend.js', /javascript/]]) {
    const r = await get(hub, '/kit-reference/' + f);
    assert.equal(r.status, 200, f);
    assert.match(r.headers['content-type'], mime);
    assert.equal(r.text, fs.readFileSync(path.join(REF_DIR, f), 'utf8'), f + ' is served byte for byte');
  }
  const denied = ['/kit-reference/index.html', '/kit-reference/apc-minimal.html', '/kit-reference/README.md', '/kit-reference/..%2freference-plugin.js', '/kit-reference/%2e%2e%2fapc-core.css',
    '/kit-reference/..%5capc-core.css', '/kit-reference/sub/reference.css', '/kit-reference/.hidden.js', '/kit-reference/', '/kit-reference/reference-plugin.js%00.png'];
  for (const p of denied) {
    const r = await get(hub, p);
    assert.ok([400, 403, 404].includes(r.status), p + ' -> ' + r.status);
    assert.ok(!/use strict/.test(r.text.slice(0, 400)), p + ' leaked file content');
  }
  assert.equal((await get(hub, '/kit-reference/nope.js')).status, 404);
  assert.equal((await get(hub, '/kit-reference/%E0%A4%A')).status, 400, 'malformed escape is a clean 400');
  const post = await new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: hub.port, method: 'POST', path: '/kit-reference/reference.css' }, (res) => { res.resume(); resolve(res.statusCode); });
    q.on('error', reject); q.end();
  });
  assert.equal(post, 405, 'GET only');
});

test('GET /api/v1/design/<id> returns tokens.css and the parsed design-system.json; bad ids are refused', async () => {
  const r = await get(hub, '/api/v1/design/apc-minimal');
  assert.equal(r.status, 200);
  assert.equal(r.json.id, 'apc-minimal');
  assert.equal(r.json.tokensFound, true);
  assert.equal(r.json.tokensCss, fs.readFileSync(path.join(REPO_ROOT, 'design_library', 'apc-minimal', 'tokens.css'), 'utf8'));
  assert.equal(r.json.specFound, true);
  assert.deepEqual(r.json.spec, JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'design_library', 'apc-minimal', 'design-system.json'), 'utf8')));
  assert.match(r.json.revision, /^[a-f0-9]{64}$/);
  assert.ok(r.json.tuningSchema.knob.some((c) => c.key === 'knobDiameter'));
  assert.ok(r.json.tuningSchema.knob.some((c) => c.key === 'lineThickness'));
  assert.ok(r.json.tuningSchema.slider.some((c) => c.key === 'sliderLength'));
  assert.equal(r.json.tokensFile, 'design_library/apc-minimal/tokens.css');
  for (const [p, want] of [['/api/v1/design/nope', 404], ['/api/v1/design/..%2fmanifest', 400], ['/api/v1/design/%2e%2e', 400], ['/api/v1/design/a%20b', 400], ['/api/v1/design', 400]]) {
    const q = await get(hub, p);
    assert.equal(q.status, want, p);
    assert.ok(q.json && q.json.error, p + ' answers JSON');
  }
});

test('POST /api/v1/design/<id>/tuning validates, revision-checks, backs up, and saves only allowlisted element settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-tuning-'));
  dirs.push(root);
  const designDir = path.join(root, 'design_library', 'apc-minimal');
  fs.mkdirSync(designDir, { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'design_library', 'apc-minimal', 'tokens.css'), path.join(designDir, 'tokens.css'));
  const initial = fs.readFileSync(path.join(REPO_ROOT, 'design_library', 'apc-minimal', 'design-system.json'), 'utf8');
  fs.writeFileSync(path.join(designDir, 'design-system.json'), initial);
  fs.writeFileSync(path.join(root, 'design_library', 'manifest.json'), JSON.stringify({ designs: [{ id: 'apc-minimal', name: 'APC Minimal', path: 'apc-minimal', tokens: 'tokens.css', spec: 'design-system.json' }] }));
  const h = await startHub(root);
  const pathName = '/api/v1/design/apc-minimal/tuning';
  const loaded = await get(h, '/api/v1/design/apc-minimal');
  const before = loaded.json.revision;
  const save = await request(h, 'POST', pathName, { revision: before, elements: {
    knob: { lineThickness: 1.5, knobDiameter: 3.5 }, slider: { sliderLength: 8 },
  } });
  assert.equal(save.status, 200, save.text);
  assert.equal(save.json.ok, true);
  const specFile = path.join(designDir, 'design-system.json');
  const saved = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  assert.deepEqual(saved.elementTuning, { knob: { lineThickness: 1.5, knobDiameter: 3.5 }, slider: { sliderLength: 8 } });
  assert.equal(fs.readFileSync(specFile + '.bak', 'utf8'), initial, 'the original spec is backed up before save');
  assert.notEqual(save.json.revision, before);

  const exact = fs.readFileSync(specFile, 'utf8');
  const badValue = await request(h, 'POST', pathName, { revision: save.json.revision, elements: { knob: { lineThickness: 9 } } });
  assert.equal(badValue.status, 400);
  assert.equal(fs.readFileSync(specFile, 'utf8'), exact, 'an out-of-range value does not write');
  const arbitrary = await request(h, 'POST', pathName, { revision: save.json.revision, elements: { knob: { cssText: 'display:none' } } });
  assert.equal(arbitrary.status, 400, 'clients cannot choose a CSS property');
  const stale = await request(h, 'POST', pathName, { revision: before, elements: { knob: { lineThickness: 2 } } });
  assert.equal(stale.status, 409, 'a stale browser cannot overwrite a newer library');
  const foreign = await request(h, 'POST', pathName, { revision: save.json.revision, elements: { knob: { lineThickness: 2 } } }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403, 'cross-site requests are refused');
  assert.equal((await request(h, 'PUT', pathName, {})).status, 405);

  const reset = await request(h, 'POST', pathName, { revision: save.json.revision, elements: { knob: {}, slider: {} } });
  assert.equal(reset.status, 200, reset.text);
  const cleared = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'elementTuning'), false, 'reset removes saved overrides that are back at defaults');
});

test('a hub without the canonical design source answers [NOT FOUND], not a substitute page', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-ref-'));
  dirs.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0-test' }));
  fs.writeFileSync(path.join(root, 'apc.config.json'), JSON.stringify({ version: 1, paths: { plugins_dir: 'plugins', build_dir: 'build', release_dir: 'release' }, setup: { completed: true } }));
  const dst = path.join(root, 'templates', 'webview', 'apc-ui');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(KIT_DIR).filter((n) => /\.(js|css)$/.test(n))) fs.copyFileSync(path.join(KIT_DIR, f), path.join(dst, f));
  const h = await startHub(root);
  const r = await get(h, '/kit-demo/_reference');
  assert.equal(r.status, 404);
  assert.match(r.text, /\[NOT FOUND\] hub\/_design\/apc_filter_f30_annotate_v006\.html/);
  assert.equal((await get(h, '/kit-reference/reference-plugin.js')).status, 404);
  assert.equal((await get(h, '/api/v1/design/apc-minimal')).status, 404);
});

// ─── (iii) real browser ─────────────────────────────────────────────────────────────────────────────────────
