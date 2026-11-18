'use strict';
// Hub standards page: GET /api/v1/standards + the global "standards" block on
// POST /api/v1/config. Zero deps: node:test + node:assert (Node 18+).
// Every test talks to a real hub/server.js child process on an ephemeral port
// (--port 0) against an isolated fixture root (APC_ROOT), so the repo is never
// touched.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'hub', 'server.js');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'apc-standards.json'), 'utf8'));

const procs = [];
const dirs = [];

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

function makeRoot({ registry = true, config = true, openOption = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-hub-std-'));
  dirs.push(root);
  writeJson(path.join(root, 'package.json'), { name: 'fixture', version: '0.0.0-test' });
  if (registry) {
    fs.mkdirSync(path.join(root, 'schemas'), { recursive: true });
    const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'apc-standards.json'), 'utf8'));
    if (openOption) {   // all shipped decisions are closed; inject one to keep the OPEN-marker path covered
      reg.options.push({ id: 'license.fixture_open', group: 'licensing', decision: 'L-99', scope: 'plugin',
        type: 'string', default: null, status: 'open', question: 'fixture', summary: 'fixture open decision' });
    }
    writeJson(path.join(root, 'schemas', 'apc-standards.json'), reg);
  }
  if (config) {
    writeJson(path.join(root, 'apc.config.json'), {
      version: 1,
      paths: { plugins_dir: 'plugins', build_dir: 'build', release_dir: 'release' },
      models: { profile: 'balanced' },
      setup: { completed: true },
      custom_key: 'must-survive',
      standards: { 'ux.theme': 'night' },
    });
  }
  writeJson(path.join(root, 'plugins', 'Alpha', 'status.json'), {
    plugin_name: 'Alpha', ui_framework: 'webview',
    standards: { 'preset.hierarchy': 'flat', 'module.undo_redo': true },
  });
  writeJson(path.join(root, 'plugins', 'Beta', 'status.json'), { plugin_name: 'Beta' });
  return root;
}

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

function request(hub, method, urlPath, { body, headers = {}, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host, port: hub.port, method, path: urlPath,
      headers: { ...(data !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (data !== null) req.write(data);
    req.end();
  });
}

const readCfg = (root) => JSON.parse(fs.readFileSync(path.join(root, 'apc.config.json'), 'utf8'));
const baseCfg = (root, standards) => ({ ...readCfg(root), standards });

after(() => {
  for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
});

let hub;
before(async () => { hub = await startHub(makeRoot()); });

test('GET /api/v1/standards lists every registry option, grouped, with sources', async () => {
  const r = await request(hub, 'GET', '/api/v1/standards');
  assert.equal(r.status, 200);
  const s = r.json;
  assert.equal(s.registryFound, true);
  assert.equal(s.schema, REGISTRY.schema);
  const listed = s.groups.flatMap((g) => g.options.map((o) => o.id)).sort();
  assert.deepEqual(listed, REGISTRY.options.map((o) => o.id).sort(), 'every option appears exactly once');
  const ux = s.groups.flatMap((g) => g.options).find((o) => o.id === 'ux.theme');
  assert.equal(ux.scope, 'global');
  assert.equal(ux.decision, 'U-07');
  assert.ok(ux.summary.length > 0);
  // effective values + source (default / global / plugin)
  assert.deepEqual(s.global.block, { 'ux.theme': 'night' });
  assert.equal(s.global.effective['ux.theme'].value, 'night');
  assert.equal(s.global.effective['ux.theme'].source, 'global');
  assert.equal(s.global.effective['ux.tooltips'].source, 'default');
  assert.equal(s.global.file, 'apc.config.json');
  const alpha = s.plugins.find((p) => p.name === 'Alpha');
  assert.equal(alpha.statusFile, 'Alpha/status.json');
  assert.equal(alpha.effective['preset.hierarchy'].value, 'flat');
  assert.equal(alpha.effective['preset.hierarchy'].source, 'plugin');
  assert.equal(alpha.effective['ux.theme'].value, 'night');
  assert.equal(alpha.effective['ux.theme'].source, 'global');
  assert.equal(alpha.effective['license.mode'].source, 'default');
  assert.ok(Array.isArray(alpha.issues));
  const beta = s.plugins.find((p) => p.name === 'Beta');
  assert.deepEqual(beta.block, {});
  assert.ok(beta.issues.some((i) => i.id === 'preset.hierarchy'), 'required plan answer missing is reported');
});

test('open decisions are flagged as placeholders in the payload', async () => {
  const h = await startHub(makeRoot({ openOption: true }));
  const r = await request(h, 'GET', '/api/v1/standards');
  const open = r.json.groups.flatMap((g) => g.options).filter((o) => o.status === 'open');
  assert.deepEqual(open.map((o) => o.id), ['license.fixture_open']);
  assert.ok(open.every((o) => o.scope === 'plugin'));
});

test('missing registry renders as NOT FOUND data with the expected path', async () => {
  const h = await startHub(makeRoot({ registry: false }));
  const r = await request(h, 'GET', '/api/v1/standards');
  assert.equal(r.status, 200);
  assert.equal(r.json.registryFound, false);
  assert.equal(r.json.expected, 'schemas/apc-standards.json');
  assert.ok(r.json.error);
  // a non-empty standards block cannot be validated without the registry
  const w = await request(h, 'POST', '/api/v1/config', { body: baseCfg(h.root, { 'ux.theme': 'night' }) });
  assert.equal(w.status, 400);
  assert.equal(w.json.error, 'standards-registry-missing');
});

test('POST /api/v1/config saves a valid global standards block (typed, backed up, rest preserved)', async () => {
  const h = await startHub(makeRoot());
  const block = { 'ux.theme': 'night', 'ux.tooltips': false, 'ux.tooltip_delay_ms': 800, 'ux.double_click': 'reset' };
  const r = await request(h, 'POST', '/api/v1/config', { body: baseCfg(h.root, block) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.backup, true);
  const saved = readCfg(h.root);
  assert.deepEqual(saved.standards, block);
  assert.equal(saved.custom_key, 'must-survive');
  assert.ok(fs.existsSync(path.join(h.root, 'apc.config.json.bak')));
  const g = await request(h, 'GET', '/api/v1/standards');
  assert.equal(g.json.global.effective['ux.tooltips'].value, false);
  assert.equal(g.json.global.effective['ux.tooltips'].source, 'global');
  assert.equal(g.json.global.issues.length, 0);
});

test('POST accepts removing an override (empty block) and a config without a standards key', async () => {
  const h = await startHub(makeRoot());
  let r = await request(h, 'POST', '/api/v1/config', { body: baseCfg(h.root, {}) });
  assert.equal(r.status, 200);
  assert.deepEqual(readCfg(h.root).standards, {});
  const cfg = readCfg(h.root);
  delete cfg.standards;
  r = await request(h, 'POST', '/api/v1/config', { body: cfg });
  assert.equal(r.status, 200, 'standards stays optional');
});

const BAD_BLOCKS = [
  ['unknown id', { 'ux.nope': true }, /unknown standard option/],
  ['wrong type (string for boolean)', { 'ux.tooltips': 'yes' }, /boolean/],
  ['wrong type (number for boolean)', { 'ux.tooltips': 1 }, /boolean/],
  ['wrong type (string for number)', { 'ux.tooltip_delay_ms': '400' }, /number/],
  ['wrong type (number for enum)', { 'ux.theme': 3 }, /string/],
  ['wrong type (object value)', { 'ux.theme': { a: 1 } }, /string/],
  ['null for a required-value option', { 'ux.tooltips': null }, /value is required/],
  ['enum value not allowed', { 'ux.theme': 'purple' }, /expected one of/],
  ['plugin-scope id in the global block', { 'preset.hierarchy': 'flat' }, /plugin-scope option/],
  ['plugin-scope boolean in the global block', { 'module.undo_redo': true }, /plugin-scope option/],
];
for (const [label, block, re] of BAD_BLOCKS) {
  test('POST rejects: ' + label, async () => {
    const h = await startHub(makeRoot());
    const before = fs.readFileSync(path.join(h.root, 'apc.config.json'), 'utf8');
    const r = await request(h, 'POST', '/api/v1/config', { body: baseCfg(h.root, block) });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, 'invalid-standards');
    assert.ok(r.json.issues.some((i) => re.test(i.message)), JSON.stringify(r.json.issues));
    assert.equal(fs.readFileSync(path.join(h.root, 'apc.config.json'), 'utf8'), before, 'file untouched on rejection');
    assert.ok(!fs.existsSync(path.join(h.root, 'apc.config.json.bak')), 'no backup written on rejection');
  });
}

test('POST rejects a standards value that is not an object', async () => {
  const h = await startHub(makeRoot());
  for (const bad of [[], 'ux.theme=dark', 7, null]) {
    const r = await request(h, 'POST', '/api/v1/config', { body: baseCfg(h.root, bad) });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.json.error, 'invalid-standards-shape');
  }
});

test('POST keeps the existing config shape validation', async () => {
  const r = await request(hub, 'POST', '/api/v1/config', { body: { version: 1 } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid-config-shape');
  const j = await request(hub, 'POST', '/api/v1/config', { body: '{not json' });
  assert.equal(j.status, 400);
  assert.equal(j.json.error, 'invalid-json');
});

test('only the documented POST paths exist; other methods and paths are refused', async () => {
  const before = fs.readFileSync(path.join(hub.root, 'apc.config.json'), 'utf8');
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const r = await request(hub, m, '/api/v1/config', { body: baseCfg(hub.root, {}) });
    assert.equal(r.status, 405, m);
  }
  // the standards endpoint itself is read-only: no second write path
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await request(hub, m, '/api/v1/standards', { body: { 'ux.theme': 'night' } });
    assert.equal(r.status, 405, m + ' /api/v1/standards');
  }
  const p = await request(hub, 'POST', '/api/v1/plugins/Alpha', { body: {} });
  assert.equal(p.status, 405);
  assert.equal(fs.readFileSync(path.join(hub.root, 'apc.config.json'), 'utf8'), before);
});

test('writes are refused for non-loopback Host and cross-site Origin headers', async () => {
  const before = fs.readFileSync(path.join(hub.root, 'apc.config.json'), 'utf8');
  const body = baseCfg(hub.root, { 'ux.theme': 'day' });
  const evilHost = await request(hub, 'POST', '/api/v1/config', { body, headers: { Host: 'evil.example:4872' } });
  assert.equal(evilHost.status, 403);
  assert.equal(evilHost.json.error, 'non-loopback-host');
  const evilOrigin = await request(hub, 'POST', '/api/v1/config', { body, headers: { Origin: 'https://evil.example' } });
  assert.equal(evilOrigin.status, 403);
  assert.equal(evilOrigin.json.error, 'foreign-origin');
  const nullOrigin = await request(hub, 'POST', '/api/v1/config', { body, headers: { Origin: 'null' } });
  assert.equal(nullOrigin.status, 403);
  assert.equal(fs.readFileSync(path.join(hub.root, 'apc.config.json'), 'utf8'), before);
  // the Hub's own page (loopback Origin) is accepted
  const okOrigin = await request(hub, 'POST', '/api/v1/config', {
    body: baseCfg(hub.root, { 'ux.theme': 'follow-os' }),
    headers: { Origin: 'http://localhost:' + hub.port },
  });
  assert.equal(okOrigin.status, 200, okOrigin.text);
});

test('the server is bound to loopback only (no answer on a LAN address)', async (t) => {
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
  }
  if (!lan.length) return t.skip('no non-loopback IPv4 interface on this machine');
  const outcome = await new Promise((resolve) => {
    const req = http.request({ host: lan[0], port: hub.port, path: '/api/v1/meta', timeout: 3000 }, () => resolve('answered'));
    req.on('error', (e) => resolve(e.code || 'error'));
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.end();
  });
  assert.notEqual(outcome, 'answered', 'hub must not answer on ' + lan[0]);
});

test('UI ships the STANDARDS section (nav entry, renderer, stylesheet)', async () => {
  const html = await request(hub, 'GET', '/');
  assert.match(html.text, /href="#09b-standards"/);
  assert.match(html.text, /css\/standards\.css/);
  const js = await request(hub, 'GET', '/app.js');
  assert.match(js.text, /function renderStandards/);
  assert.match(js.text, /\[OPEN\] placeholder/);
  const css = await request(hub, 'GET', '/css/standards.css');
  assert.equal(css.status, 200);
  assert.ok(!/border-radius\s*:\s*[1-9]/.test(css.text), 'rectangles only');
  assert.ok(!/https?:\/\//.test(css.text), 'no external network references in the stylesheet');
});
