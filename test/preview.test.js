'use strict';
// Preview loop (scripts/apc-preview.js): watcher debounce / --once cycle / SSE reload,
// browser discovery with a faked PATH, PNG decode + diff maths, and (when a
// Chromium-family browser is installed) a real headless screenshot.
// Zero deps: node:test + node:assert (Node 18+).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const FIX = path.join(__dirname, 'fixtures', 'preview');
const prev = require(path.join(REPO_ROOT, 'scripts', 'apc-preview.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000, step = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(step);
  }
}

const roots = [];
/** Isolated APC root with both preview fixtures installed under plugins/ and the UI kit under templates/. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-preview-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"0.0.0"}');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui'), path.join(root, 'templates', 'webview', 'apc-ui'), { recursive: true });
  fs.cpSync(path.join(FIX, 'composed'), path.join(root, 'plugins', 'PreviewFixture'), { recursive: true });
  fs.cpSync(path.join(FIX, 'handmade'), path.join(root, 'plugins', 'HandmadeFixture'), { recursive: true });
  return root;
}
test.after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ } } });

const ctxFor = (root, cmd) => ({
  root, cmd,
  resolvePaths: () => ({ root, pluginsDir: path.join(root, 'plugins') }),
  pluginPath: (n) => path.join(root, 'plugins', n),
  readConfig: () => ({ paths: {} }),
});
function apc(root, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, APC_ROOT: root } });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ─── debounce ───────────────────────────────────────────────────────────────
test('debounce: a burst collapses into one trailing call (fake timers)', () => {
  let now = 0;
  const queue = [];
  const timers = {
    setTimeout: (fn, ms) => { const h = { fn, at: now + ms }; queue.push(h); return h; },
    clearTimeout: (h) => { const i = queue.indexOf(h); if (i !== -1) queue.splice(i, 1); },
  };
  const advance = (ms) => {
    now += ms;
    for (const h of queue.filter((x) => x.at <= now)) { queue.splice(queue.indexOf(h), 1); h.fn(); }
  };
  const calls = [];
  const d = prev.debounce((x) => calls.push(x), 100, timers);
  d('a'); advance(40); d('b'); advance(40); d('c');
  assert.equal(calls.length, 0, 'nothing fires inside the window');
  assert.equal(d.pending(), true);
  advance(99);
  assert.equal(calls.length, 0);
  advance(1);
  assert.deepEqual(calls, ['c'], 'only the last call fires, once');
  d('d'); d.cancel(); advance(500);
  assert.deepEqual(calls, ['c'], 'cancel() drops the pending call');
});

test('shouldIgnore: own outputs never retrigger a cycle', () => {
  const ctx = { composing: true, composeOutputs: new Set(['v1-test.html']) };
  assert.equal(prev.shouldIgnore('Design/.apc-reload', ctx), true);
  assert.equal(prev.shouldIgnore('Design/v1-test.html', ctx), true);
  assert.equal(prev.shouldIgnore('Design/apc-ui/apc-core.css', ctx), true);
  assert.equal(prev.shouldIgnore('Design/screenshots/x.png', ctx), true);
  assert.equal(prev.shouldIgnore('Design/.apc-shot-1.html', ctx), true);
  assert.equal(prev.shouldIgnore('Design/ui-map.json', ctx), false);
  assert.equal(prev.shouldIgnore('Source/ui/public/index.html', ctx), false);
  // hand-written previews: the preview itself is the source
  assert.equal(prev.shouldIgnore('Design/v1-test.html', { composing: false }), false);
});

test('poll watcher reports added, changed and removed files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-poll-'));
  roots.push(dir);
  const seen = new Set();
  const w = prev.createPollWatcher([dir], (f) => seen.add(path.basename(f)), { intervalMs: 25 });
  try {
    assert.equal(w.mode, 'poll');
    fs.writeFileSync(path.join(dir, 'a.html'), '1');
    await waitFor(() => seen.has('a.html'));
    seen.clear();
    fs.writeFileSync(path.join(dir, 'a.html'), '22');
    await waitFor(() => seen.has('a.html'));
    seen.clear();
    fs.rmSync(path.join(dir, 'a.html'));
    await waitFor(() => seen.has('a.html'));
  } finally { w.close(); }
});

// ─── cycle / --once ─────────────────────────────────────────────────────────
test('runCycle: composes from ui-map, lints, writes the .apc-reload stamp', () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'PreviewFixture');
  const c = prev.runCycle(ctxFor(root, 'watch'), dir, { seq: 7, changed: ['Design/ui-map.json'] });
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.compose.ran, true);
  assert.equal(c.compose.ok, true);
  assert.equal(c.compose.output, 'v1-test.html');
  assert.ok(fs.existsSync(path.join(dir, 'Design', 'v1-test.html')));
  assert.ok(fs.existsSync(path.join(dir, 'Design', 'apc-ui', 'apc-core.css')), 'kit vendored');
  assert.equal(c.lint.ran, true);
  assert.equal(typeof c.lint.errors, 'number');
  assert.equal(c.preview, 'Design/v1-test.html');
  const stamp = JSON.parse(fs.readFileSync(path.join(dir, 'Design', '.apc-reload'), 'utf8'));
  assert.equal(stamp.seq, 7);
  assert.equal(stamp.ok, true);
  assert.deepEqual(stamp.changed, ['Design/ui-map.json']);
});

test('runCycle: hand-written preview (no ui-map) skips compose/lint but still stamps', () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'HandmadeFixture');
  const c = prev.runCycle(ctxFor(root, 'watch'), dir, { seq: 1 });
  assert.equal(c.ok, true);
  assert.equal(c.compose.ran, false);
  assert.equal(c.lint.ran, false);
  assert.ok(fs.existsSync(path.join(dir, 'Design', '.apc-reload')));
});

test('runCycle: a broken ui-map fails the cycle and reports why', () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'PreviewFixture');
  fs.writeFileSync(path.join(dir, 'Design', 'ui-map.json'), '{ not json');
  const c = prev.runCycle(ctxFor(root, 'watch'), dir, { seq: 1 });
  assert.equal(c.ok, false);
  assert.equal(c.compose.ok, false);
  assert.ok(c.compose.message.length > 0);
});

test('apc watch <Plugin> --once --json: exit codes and JSON via the real CLI', () => {
  const root = makeRoot();
  let r = apc(root, ['watch', 'PreviewFixture', '--once', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.compose.ok, true);
  assert.equal(j.lint.ran, true);
  r = apc(root, ['watch', 'HandmadeFixture', '--once']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /cycle 1/);
  r = apc(root, ['watch']);
  assert.equal(r.status, 2, 'usage error');
  r = apc(root, ['watch', 'Nope', '--once']);
  assert.equal(r.status, 2);
  fs.writeFileSync(path.join(root, 'plugins', 'PreviewFixture', 'Design', 'ui-map.json'), '{ not json');
  r = apc(root, ['watch', 'PreviewFixture', '--once']);
  assert.equal(r.status, 1, 'failed compose -> exit 1');
  // Visage plugins are not WebView: refuse clearly
  const vis = path.join(root, 'plugins', 'VisageThing');
  fs.mkdirSync(vis, { recursive: true });
  fs.writeFileSync(path.join(vis, 'status.json'), '{"ui_framework":"visage"}');
  r = apc(root, ['watch', 'VisageThing', '--once']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Visage/);
});

// ─── live watch + SSE ───────────────────────────────────────────────────────
function openSse(port, headers) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/reload', headers: headers || {} }, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const m = block.match(/^data: (.*)$/m);
          if (m) messages.push(JSON.parse(m[1]));
        }
      });
      resolve({ res, messages, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}
function httpGet(port, p, headers, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: method || 'GET', headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('startWatch: a burst of saves = one cycle; SSE client gets the reload; own stamp does not loop', async () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'HandmadeFixture');
  const cycles = [];
  const h = await prev.startWatch(ctxFor(root, 'watch'), dir, { poll: true, pollMs: 30, debounceMs: 200, port: 0, onCycle: (c) => cycles.push(c) });
  const sse = await openSse(h.port, { Origin: 'http://localhost:4872' });
  try {
    assert.equal(sse.res.headers['content-type'], 'text/event-stream');
    assert.equal(sse.res.headers['access-control-allow-origin'], 'http://localhost:4872');
    await waitFor(() => sse.messages.some((m) => m.type === 'hello'));
    const file = path.join(dir, 'Design', 'v1-test.html');
    const html = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < 5; i++) { fs.writeFileSync(file, html + `<!-- edit ${i} -->`); await sleep(20); }
    await waitFor(() => sse.messages.some((m) => m.type === 'reload'));
    await sleep(700); // long enough for any (wrong) second cycle caused by the stamp file or the burst
    assert.equal(h.cycles, 1, 'debounced burst + ignored stamp file -> exactly one cycle');
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].changed, ['Design/v1-test.html']);
    assert.equal(cycles[0].clients, 1);
    assert.equal(sse.messages.filter((m) => m.type === 'reload').length, 1);
    // the served preview carries the live-reload snippet
    const page = await httpGet(h.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /new EventSource|EventSource\("http:\/\/127\.0\.0\.1:\d+\/reload"\)/);
    assert.match(page.text, /edit 4/);
    const st = JSON.parse((await httpGet(h.port, '/state')).text);
    assert.equal(st.seq, 1);
  } finally {
    sse.close();
    await h.close();
  }
});

test('startWatch with the default watcher (fs.watch recursive, poll fallback) sees a nested edit', async () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'HandmadeFixture');
  fs.mkdirSync(path.join(dir, 'Source', 'ui', 'public', 'js'), { recursive: true });
  const h = await prev.startWatch(ctxFor(root, 'watch'), dir, { debounceMs: 60, port: null });
  try {
    assert.ok(['fs.watch', 'poll'].includes(h.mode), h.mode);
    if (process.platform === 'win32' || process.platform === 'darwin') assert.equal(h.mode, 'fs.watch', 'native recursive watching on Windows/macOS');
    assert.equal(h.roots.length, 2, 'Design/ and Source/ui/ are both watched');
    await sleep(150);
    fs.writeFileSync(path.join(dir, 'Source', 'ui', 'public', 'js', 'app.js'), 'console.log(1);');
    await waitFor(() => h.cycles >= 1, 8000);
    assert.ok(h.lastCycle.changed.some((c) => c.endsWith('Source/ui/public/js/app.js')), JSON.stringify(h.lastCycle.changed));
  } finally { await h.close(); }
});

test('reload server is read-only and loopback-only', async () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'HandmadeFixture');
  const h = await prev.startWatch(ctxFor(root, 'watch'), dir, { poll: true, pollMs: 200, port: 0 });
  try {
    assert.equal((await httpGet(h.port, '/', {}, 'POST')).status, 405);
    assert.equal((await httpGet(h.port, '/', { Host: 'evil.example' })).status, 403);
    for (const evil of ['/%2e%2e/status.json', '/..%2fstatus.json', '/..%5cstatus.json', '/Design/../../status.json']) {
      const r = await httpGet(h.port, evil);
      assert.ok(r.status === 403 || r.status === 404, evil + ' -> ' + r.status);
      assert.ok(!r.text.includes('HandmadeFixture') || !r.text.includes('ui_framework'), 'status.json must not leak: ' + evil);
    }
    assert.equal((await httpGet(h.port, '/status.json')).status, 404, 'files outside Design/ are not served');
    const evil = await openSse(h.port, { Origin: 'https://evil.example' });
    assert.equal(evil.res.headers['access-control-allow-origin'], undefined, 'no CORS grant for foreign origins');
    evil.close();
    const fileOrigin = await openSse(h.port, { Origin: 'null' });
    assert.equal(fileOrigin.res.headers['access-control-allow-origin'], 'null', 'file:// preview pages may subscribe');
    fileOrigin.close();
  } finally { await h.close(); }
});

test('startWatch refuses a plugin with no Design/ or Source/ui', async () => {
  const root = makeRoot();
  const dir = path.join(root, 'plugins', 'Bare');
  fs.mkdirSync(dir, { recursive: true });
  await assert.rejects(() => prev.startWatch(ctxFor(root, 'watch'), dir, { port: null }), /no WebView frontend source/);
});

test('standalone restarter: restart() stops the previous child before starting a new one', async () => {
  const spawned = [];
  const fakeSpawn = (exe) => {
    const c = new EventEmitter();
    c.exe = exe; c.killed = false;
    c.kill = () => { c.killed = true; setImmediate(() => c.emit('exit', 0)); };
    spawned.push(c);
    return c;
  };
  const r = prev.createRestarter('/x/Plugin.exe', { spawn: fakeSpawn });
  r.start();
  assert.equal(r.running(), true);
  await r.restart();
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].killed, true);
  assert.equal(spawned[1].killed, false);
  assert.equal(r.running(), true);
  await r.stop();
  assert.equal(spawned[1].killed, true);
  assert.equal(r.running(), false);
});

// ─── browser discovery ──────────────────────────────────────────────────────
test('findBrowser: PATH lookup with a faked PATH, explicit and APC_BROWSER precedence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-fakebin-'));
  roots.push(dir);
  const name = process.platform === 'win32' ? 'chrome.exe' : 'chromium';
  const fake = path.join(dir, name);
  fs.writeFileSync(fake, '');
  const other = path.join(dir, 'other-browser');
  fs.writeFileSync(other, '');
  const onlyFake = (p) => p.startsWith(dir) && fs.existsSync(p); // never touch real installs
  const found = prev.findBrowser({ platform: process.platform, env: { PATH: dir }, exists: onlyFake });
  assert.equal(path.normalize(found.path), path.normalize(fake));
  assert.equal(found.source, 'PATH');
  assert.ok(found.searched.length > 0);
  // APC_BROWSER beats PATH; --browser beats APC_BROWSER
  const viaEnv = prev.findBrowser({ platform: process.platform, env: { PATH: dir, APC_BROWSER: other }, exists: onlyFake });
  assert.equal(viaEnv.path, other);
  assert.equal(viaEnv.source, 'APC_BROWSER');
  const viaFlag = prev.findBrowser({ explicit: fake, platform: process.platform, env: { PATH: dir, APC_BROWSER: other }, exists: onlyFake });
  assert.equal(viaFlag.path, fake);
  assert.equal(viaFlag.source, '--browser');
  // an explicit path that does not exist falls through instead of crashing
  const fall = prev.findBrowser({ explicit: path.join(dir, 'missing'), platform: process.platform, env: { PATH: dir }, exists: onlyFake });
  assert.equal(path.normalize(fall.path), path.normalize(fake));
});

test('findBrowser: nothing installed -> path null with the searched locations listed', () => {
  const r = prev.findBrowser({ platform: 'linux', env: { PATH: '/nonexistent-apc-a:/nonexistent-apc-b' }, exists: () => false });
  assert.equal(r.path, null);
  assert.ok(r.searched.some((p) => p.includes('chromium')));
  assert.ok(r.searched.some((p) => p.startsWith('/nonexistent-apc-a')));
});

test('findBrowser: Windows PATH search appends .exe; Windows install dirs come from the environment', () => {
  const hits = [];
  const exists = (p) => { hits.push(p); return p === 'C:\\tools\\msedge.exe'; };
  const r = prev.findBrowser({ platform: 'win32', env: { PATH: 'C:\\nothing;C:\\tools' }, exists });
  assert.equal(r.path, 'C:\\tools\\msedge.exe');
  const cands = prev.candidatePaths('win32', { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
  assert.ok(cands.includes('C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe'));
  assert.ok(cands.includes('C:\\PF\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(cands.includes('C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'));
  assert.ok(cands.indexOf('C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe') < cands.findIndex((p) => p.endsWith('chrome.exe')), 'Edge is preferred on Windows');
  const mac = prev.candidatePaths('darwin', { HOME: '/Users/u' });
  assert.ok(mac.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(mac.includes('/Users/u/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'));
});

test('screenshot exits 2 with a clear message when no browser is found', (t) => {
  const root = makeRoot();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(path|programfiles.*|programw6432|localappdata|apc_browser|home)$/i.test(k)) delete env[k];
  env.APC_ROOT = root;
  if (process.platform === 'darwin') return t.skip('macOS install paths are absolute; cannot be faked away');
  const probe = prev.findBrowser({ env: {} });
  if (probe.path) return t.skip('a browser exists in a fixed system path: ' + probe.path);
  const r = spawnSync(process.execPath, [CLI, 'screenshot', 'HandmadeFixture'], { encoding: 'utf8', env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No Chromium-family browser found/);
  assert.match(r.stderr, /--browser|APC_BROWSER/);
});

// ─── PNG ────────────────────────────────────────────────────────────────────
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(prev.crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** Build a PNG from raw (unfiltered) scanline bytes, applying `filter` to every row. */
function makePng({ width, height, depth, colorType, rows, filter, plte, trns }) {
  const bits = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType] * depth;
  const bpp = Math.max(1, bits >> 3);
  const stride = rows[0].length;
  const out = [];
  for (let y = 0; y < height; y++) {
    const cur = rows[y];
    const up = y > 0 ? rows[y - 1] : Buffer.alloc(stride);
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = up[x];
      const c = x >= bpp ? up[x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (cur[x] - pred) & 0xff;
    }
    out.push(Buffer.from([filter]), line);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(plte ? [chunk('PLTE', plte)] : []),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(out))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function solid(w, h, [r, g, b, a = 255]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { width: w, height: h, data };
}

test('PNG: encode/decode round trip and CRC-valid output', () => {
  const img = solid(7, 5, [10, 20, 30, 255]);
  img.data.set([200, 100, 50, 128], (2 * 7 + 3) * 4);
  const png = prev.encodePng(img.width, img.height, img.data);
  const back = prev.decodePng(png);
  assert.equal(back.width, 7); assert.equal(back.height, 5);
  assert.deepEqual(Array.from(back.data), Array.from(img.data));
  assert.throws(() => prev.decodePng(Buffer.from('nope')), /not a PNG/);
});

test('PNG: all five scanline filters decode to the same pixels', () => {
  const w = 6; const h = 4;
  const rows = [];
  const expect = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 3);
    for (let x = 0; x < w; x++) {
      const px = [(x * 40 + y * 7) & 255, (x * 13 + y * 90) & 255, (x * y * 17) & 255];
      px.forEach((v, k) => { row[x * 3 + k] = v; });
      expect.push(...px, 255);
    }
    rows.push(row);
  }
  for (let filter = 0; filter <= 4; filter++) {
    const d = prev.decodePng(makePng({ width: w, height: h, depth: 8, colorType: 2, rows, filter }));
    assert.deepEqual(Array.from(d.data), expect, 'filter ' + filter);
  }
});

test('PNG: palette (4-bit + tRNS), 16-bit RGBA and 1-bit gray decode', () => {
  // 4-bit palette: indices 0,1,2,1 in one row
  const pal = makePng({
    width: 4, height: 1, depth: 4, colorType: 3, rows: [Buffer.from([0x01, 0x21])], filter: 0,
    plte: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), trns: Buffer.from([255, 128]),
  });
  const p = prev.decodePng(pal);
  assert.deepEqual(Array.from(p.data), [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 255, 0, 128]);
  // 16-bit RGBA: high byte is taken
  const rgba16 = makePng({ width: 1, height: 1, depth: 16, colorType: 6, rows: [Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])], filter: 0 });
  assert.deepEqual(Array.from(prev.decodePng(rgba16).data), [0x12, 0x56, 0x9a, 0xde]);
  // 1-bit gray: 10110000 -> 255,0,255,255 (first 4 px)
  const g1 = makePng({ width: 4, height: 1, depth: 1, colorType: 0, rows: [Buffer.from([0xb0])], filter: 0 });
  const g = prev.decodePng(g1);
  assert.deepEqual([g.data[0], g.data[4], g.data[8], g.data[12]], [255, 0, 255, 255]);
});

test('PNG diff maths: identical, one-pixel, tolerance, size mismatch', () => {
  const a = solid(10, 10, [50, 60, 70]);
  const b = solid(10, 10, [50, 60, 70]);
  let d = prev.diffPng(a, b);
  assert.equal(d.mismatched, 0);
  assert.equal(d.percent, 0);
  assert.equal(d.sizeMismatch, false);
  b.data.set([255, 60, 70, 255], 4 * (3 * 10 + 4)); // one pixel off by 205
  d = prev.diffPng(a, b);
  assert.equal(d.mismatched, 1);
  assert.equal(d.total, 100);
  assert.equal(d.percent, 1);
  assert.equal(d.maxDelta, 205);
  const at = 4 * (3 * 10 + 4);
  assert.deepEqual(Array.from(d.diff.data.slice(at, at + 4)), [255, 0, 0, 255], 'mismatching pixel is red in the diff image');
  assert.notDeepEqual(Array.from(d.diff.data.slice(0, 3)), [255, 0, 0]);
  // per-channel tolerance
  const c = solid(10, 10, [55, 60, 70]); // delta 5 everywhere
  assert.equal(prev.diffPng(a, c, { tolerance: 8 }).mismatched, 0);
  assert.equal(prev.diffPng(a, c, { tolerance: 4 }).mismatched, 100);
  assert.equal(prev.diffPng(a, c, { tolerance: 5 }).mismatched, 0, 'delta == tolerance is not a mismatch');
  // size mismatch is reported, never crashes
  const e = prev.diffPng(a, solid(10, 11, [50, 60, 70]));
  assert.equal(e.sizeMismatch, true);
  assert.equal(e.percent, 100);
  assert.equal(e.diff, null);
});

test('apc screenshot --compare a.png --against b.png: exit code, percent and diff image (no browser needed)', () => {
  const root = makeRoot();
  const a = solid(20, 10, [10, 10, 10]);
  const b = solid(20, 10, [10, 10, 10]);
  for (let x = 0; x < 4; x++) b.data.set([255, 255, 255, 255], 4 * x); // 4 of 200 px = 2 %
  const pa = path.join(root, 'a.png'); const pb = path.join(root, 'b.png'); const pd = path.join(root, 'd.png');
  fs.writeFileSync(pa, prev.encodePng(20, 10, a.data));
  fs.writeFileSync(pb, prev.encodePng(20, 10, b.data));
  let r = apc(root, ['screenshot', '--compare', pa, '--against', pb, '--diff', pd, '--json']);
  assert.equal(r.status, 1, r.stderr);
  const j = JSON.parse(r.stdout).compare;
  assert.equal(j.mismatched, 4);
  assert.equal(j.percent, 2);
  assert.equal(j.pass, false);
  const diffImg = prev.decodePng(fs.readFileSync(pd));
  assert.deepEqual(Array.from(diffImg.data.slice(0, 4)), [255, 0, 0, 255]);
  r = apc(root, ['screenshot', '--compare', pa, '--against', pb, '--max-mismatch', '5', '--diff', pd]);
  assert.equal(r.status, 0, '2% mismatch is inside a 5% allowance');
  r = apc(root, ['screenshot', '--compare', pa, '--against', pa]);
  assert.equal(r.status, 0);
  r = apc(root, ['screenshot', '--compare', pa, '--against', path.join(root, 'missing.png')]);
  assert.equal(r.status, 2);
});

test('screenshot argument helpers', () => {
  assert.deepEqual(prev.parseScales(undefined, null), [100]);
  assert.deepEqual(prev.parseScales('50,100,300', null), [50, 100, 300]);
  assert.deepEqual(prev.parseScales('300%,50,100,100', null), [50, 100, 300]);
  assert.deepEqual(prev.parseScales('endpoints', [0.5, 3]), [50, 100, 300]);
  assert.deepEqual(prev.parseScales('endpoints', [0.75, 2]), [75, 100, 200]);
  assert.equal(prev.parseScales('0', null), null);
  assert.equal(prev.parseScales('abc', null), null);
  assert.equal(prev.parseScales('5000', null), null);
  const p = prev.parseArgs(['Plug', '--once', '--out', 'x.png', '--scale=50,100', '--json']);
  assert.deepEqual(p.positional, ['Plug']);
  assert.equal(p.flags['--out'], 'x.png');
  assert.equal(p.flags['--scale'], '50,100');
  assert.equal(p.flags['--once'], true);
  const argv = prev.buildChromeArgs({ width: 800, height: 500, dpr: 2, budgetMs: 1500, profileDir: '/tmp/p', out: '/tmp/o.png', url: 'file:///x.html' });
  for (const needle of ['--headless=new', '--force-device-scale-factor=2', '--window-size=800,500', '--screenshot=/tmp/o.png', '--virtual-time-budget=1500', '--force-prefers-reduced-motion', '--hide-scrollbars']) {
    assert.ok(argv.includes(needle), needle);
  }
  assert.equal(argv[argv.length - 1], 'file:///x.html');
});

test('screenshot usage errors exit 2', () => {
  const root = makeRoot();
  assert.equal(apc(root, ['screenshot']).status, 2);
  assert.equal(apc(root, ['screenshot', 'Nope']).status, 2);
  assert.equal(apc(root, ['screenshot', '--against', 'x.png']).status, 2);
});

// ─── real browser (skips cleanly when none is installed) ────────────────────
const BROWSER = prev.findBrowser();
const realTest = BROWSER.path ? test : test.skip;

realTest('real headless screenshot: size, determinism, scales, dpr, compare/diff (browser: ' + (BROWSER.path || 'none installed') + ')', { timeout: 180000 }, () => {
  const root = makeRoot();
  const out = path.join(root, 'shots', 'hand.png');
  let r = apc(root, ['screenshot', 'HandmadeFixture', '--out', out, '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  let j = JSON.parse(r.stdout);
  assert.equal(j.shots.length, 1);
  assert.equal(j.shots[0].sizeAsRequested, true, JSON.stringify(j.shots[0]));
  const a = prev.decodePng(fs.readFileSync(out));
  assert.equal(a.width, 800);
  assert.equal(a.height, 500);
  // the page's amber box is really rendered at (10%,10%): pixel (100,60)
  const px = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
  assert.deepEqual(px(a, 100, 60), [255, 195, 0]);
  assert.deepEqual(px(a, 5, 5), [32, 40, 48]);
  // the CSS animation is frozen: the pulsing green box is fully opaque
  assert.deepEqual(px(a, 640, 400), [51, 255, 51]);

  // determinism: a second run is pixel-identical (tolerance 0)
  const out2 = path.join(root, 'shots', 'hand2.png');
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', out2]);
  assert.equal(r.status, 0, r.stderr);
  const d = prev.diffPng(a, prev.decodePng(fs.readFileSync(out2)), { tolerance: 0 });
  assert.equal(d.mismatched, 0, 'two renders of the same page must be identical');

  // small viewports are exact (headless windows clamp small sizes; the iframe host avoids that)
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', path.join(root, 'shots', 'small.png'), '--width', '320', '--height', '160', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const small = prev.decodePng(fs.readFileSync(path.join(root, 'shots', 'small.png')));
  assert.deepEqual([small.width, small.height], [320, 160]);
  assert.deepEqual(px(small, 250, 130), [51, 255, 51], 'pulse box sits at 70-90% of the 320x160 viewport');
  assert.deepEqual(px(small, 50, 30), [255, 195, 0]);

  // scale list -> one file per scale at the scaled viewport
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', path.join(root, 'shots', 's.png'), '--scale', '50,100,300', '--width', '400', '--height', '250', '--json']);
  assert.equal(r.status, 0, r.stderr);
  j = JSON.parse(r.stdout);
  assert.deepEqual(j.shots.map((s) => [s.scale, s.pixels.width, s.pixels.height]), [[50, 200, 125], [100, 400, 250], [300, 1200, 750]]);
  assert.ok(fs.existsSync(path.join(root, 'shots', 's-300.png')));

  // device scale factor multiplies pixels
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', path.join(root, 'shots', 'd.png'), '--dpr', '2', '--width', '400', '--height', '250', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const dd = prev.decodePng(fs.readFileSync(path.join(root, 'shots', 'd.png')));
  assert.deepEqual([dd.width, dd.height], [800, 500]);

  // visual diff: unchanged page passes, edited page fails with a diff image
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', path.join(root, 'shots', 'again.png'), '--compare', out, '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).shots[0].compare.mismatched, 0);
  const htmlFile = path.join(root, 'plugins', 'HandmadeFixture', 'Design', 'v1-test.html');
  fs.writeFileSync(htmlFile, fs.readFileSync(htmlFile, 'utf8').replace('#ffc300', '#ff00ff'));
  r = apc(root, ['screenshot', 'HandmadeFixture', '--out', path.join(root, 'shots', 'edited.png'), '--compare', out, '--json']);
  assert.equal(r.status, 1, 'changed pixels beyond the allowance -> exit 1');
  const cmp = JSON.parse(r.stdout).shots[0].compare;
  assert.ok(cmp.mismatched > 0 && cmp.percent > 5, JSON.stringify(cmp));
  assert.ok(fs.existsSync(cmp.diffImage));
  assert.deepEqual(px(prev.decodePng(fs.readFileSync(cmp.diffImage)), 100, 60), [255, 0, 0]);
});

realTest('real headless screenshot of a composed (ui-map) preview renders the kit knob', { timeout: 120000 }, () => {
  const root = makeRoot();
  const out = path.join(root, 'shots', 'kit.png');
  const r = apc(root, ['screenshot', 'PreviewFixture', '--out', out, '--json']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const img = prev.decodePng(fs.readFileSync(out));
  assert.deepEqual([img.width, img.height], [320, 160], 'default size = plate cols/rows x 16 px cell');
  assert.ok(fs.existsSync(path.join(root, 'plugins', 'PreviewFixture', 'Design', 'v1-test.html')), 'composed on demand');
  // not a blank page: APC Minimal draws the knob pointer in --ink (fixture: #f0f0f5), so the
  // dial area (cells x 2..6, y 3..6 at 16 px; the label row below is excluded) has near-white pixels
  let pointer = 0;
  for (let y = 48; y < 96; y++) {
    for (let x = 32; x < 96; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] > 200 && img.data[i + 1] > 200 && img.data[i + 2] > 200) pointer++;
    }
  }
  assert.ok(pointer > 2, 'expected near-white knob pointer pixels inside the dial, got ' + pointer);
});

test('no stray .apc-shot-* temp files are left in the plugin Design folder', () => {
  // (runs after the real-browser tests above; trivially true when they were skipped)
  for (const root of roots) {
    const design = path.join(root, 'plugins', 'HandmadeFixture', 'Design');
    if (!fs.existsSync(design)) continue;
    assert.deepEqual(fs.readdirSync(design).filter((f) => f.startsWith('.apc-shot-')), []);
  }
  void execFileSync; // (kept for parity with other suites)
});
