'use strict';
// WebView UI kit, part B: apc-mock.js / apc-settings.js / apc-presets.js / apc-license-ui.js / apc-update-ui.js.
//  - node-level checks that need no browser: contract coverage of the mock, vocabulary parity with
//    schemas/pmx1-vocabulary.json, mock semantics (gating, license + update state machines, determinism, filter/sort),
//    ES5/no-network/token-only static rules;
//  - the real DOM tests (templates/webview/apc-ui/tests/kit-b-*.html) through scripts/apc-kit-test.js when a
//    Chromium-family browser is installed (otherwise that one test is reported as SKIPPED, not passed).
// Zero deps: node:test + node:assert (Node 18+).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const UI = path.join(REPO_ROOT, 'templates', 'webview', 'apc-ui');
const read = (f) => fs.readFileSync(path.join(UI, f), 'utf8');
const KIT_B_FILES = ['apc-mock.js', 'apc-settings.js', 'apc-presets.js', 'apc-license-ui.js', 'apc-update-ui.js'];

/** Evaluate a kit script in a sandbox with a stub APC (no DOM): enough to load the mock and read exported tables. */
function load(file, extra) {
  const registered = {};
  const APC = Object.assign({
    dom: { el() { return {}; }, append() {}, clear() {}, focusables() { return []; } },
    on() {}, off() {}, emit() {}, register(n) { registered[n] = true; }, toast: {},
  }, extra || {});
  const sandbox = { window: { APC }, document: {}, console, setTimeout, clearTimeout, Promise, JSON, Math };
  sandbox.window.window = sandbox.window;
  vm.runInNewContext(read(file), sandbox, { filename: file });
  return { APC: sandbox.window.APC, registered };
}
/** JSON round-trip: values created inside the vm sandbox have foreign prototypes that deepEqual rejects. */
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function freshMock() {
  const m = load('apc-mock.js').APC.mock;
  return {
    call: (fn, args) => m.call(fn, plain(args)).then(plain),
    on: m.on, off: m.off, emit: m.emit, functions: () => plain(m.functions()), scenario: (n) => m.scenario(n), scenarios: () => plain(m.scenarios()),
    config: (p) => plain(m.config(plain(p))), seed: (n) => m.seed(n), newInstance: () => plain(m.newInstance()), loadBank: (n) => m.loadBank(n),
    meter: m.meter, emitError: m.emitError, vocab: plain(m.vocab),
  };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- contract coverage
test('the mock implements every bridge function named in CONTRACT.md', () => {
  const contract = fs.readFileSync(path.join(UI, 'CONTRACT.md'), 'utf8');
  const block = /## Bridge functions[\s\S]*?```\n([\s\S]*?)```/.exec(contract)[1];
  // names appear as `apc.x.y`; the "apc.mod.set {id, route} / apc.mod.remove ..." lines list several
  const names = new Set((block.match(/\bapc\.[A-Za-z]+(?:\.[A-Za-z]+)*/g) || []).map((n) => n.replace(/\.$/, '')));
  assert.ok(names.size >= 40, `parsed ${names.size} names from the contract`);
  const m = freshMock();
  const have = new Set(m.functions());
  const missing = [...names].filter((n) => !have.has(n));
  assert.deepEqual(missing, [], 'missing from the mock: ' + missing.join(', '));
});

test('the mock can emit every contract event (param, preset, license, update, meter, error)', async () => {
  const m = freshMock(); m.config({ tickMs: 1 });
  const seen = {};
  for (const e of ['param', 'preset', 'license', 'update', 'meter', 'error']) m.on(e, (d) => { seen[e] = d; });
  await m.call('apc.param.set', { id: 'gain_db', value: 3 });
  m.meter('cutoff_hz', 0.5); m.emitError('boom', 'detail');
  m.scenario('licensed');
  await m.call('apc.update.check');
  assert.deepEqual(plain(seen.param), { id: 'gain_db', value: 3 });
  assert.ok(seen.preset.state && seen.preset.state.current, 'preset event is {state:{current,...}}');
  assert.ok(seen.license.status && seen.license.status.state, 'license event is {status:{...}}');
  assert.ok(seen.update.state && seen.update.state.state, 'update event is {state:{state,...}}');
  assert.deepEqual(plain(seen.meter), { id: 'cutoff_hz', value: 0.5 });
  assert.equal(seen.error.message, 'boom'); assert.equal(seen.error.source, 'mock');
});

test('the mock registers itself as the fallback bridge only when no native bridge exists', () => {
  const a = load('apc-mock.js').APC;
  assert.equal(a.bridge, a.mock);
  const native = { call() {}, on() {} };
  const b = load('apc-mock.js', { bridge: native }).APC;
  assert.equal(b.bridge, native, 'an existing (native) bridge is never replaced');
  assert.ok(b.mock, 'APC.mock still available for tests');
});

// ---------------------------------------------------------------- vocabulary parity
test('embedded PMX/1 vocabulary (mock + presets UI) equals schemas/pmx1-vocabulary.json', () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'pmx1-vocabulary.json'), 'utf8'));
  const mock = freshMock().vocab;
  const ui = load('apc-presets.js', { __kb: undefined }).APC;
  // apc-presets.js needs the shared helper at load: stubbed APC.dom.el returns {} which is enough for KB creation
  const pv = plain(ui.presetsUI.vocab);
  const cats = v.categories.map((c) => [c.slug, c.label, c.code]);
  assert.deepEqual(mock.categories, cats.slice(0, mock.categories.length), 'mock categories (prefix of the vocabulary, same order)');
  assert.deepEqual(pv.categories, cats, 'UI categories');
  const axes = v.axes.map((a) => [a.key, a.label, a.words]);
  assert.deepEqual(pv.axes, axes, 'UI axes (ordered words are the filter semantics)');
  for (const a of v.axes) assert.deepEqual(mock.axes[a.key], a.words, 'mock axis ' + a.key);
  assert.deepEqual(pv.moods, v.moods.map((x) => x.slug)); assert.deepEqual(mock.moods, v.moods.map((x) => x.slug));
  assert.deepEqual(pv.genres, v.genres.map((g) => [g.slug, g.label]));
});

test('mock preset data: ~30 presets in 3 packs, PMX/1 slugs only, typed and flat modes', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'pmx1-vocabulary.json'), 'utf8'));
  const catSlugs = new Set(v.categories.map((c) => c.slug)), moods = new Set(v.moods.map((x) => x.slug)), genres = new Set(v.genres.map((g) => g.slug));
  const m = freshMock();
  const all = await m.call('apc.presets.list', { sort: 'name' });
  assert.ok(all.total >= 28 && all.total <= 34, 'about 30 presets: ' + all.total);
  assert.deepEqual([...new Set(all.items.map((i) => i.pack))].sort(), ['Expansion One', 'Factory', 'User']);
  assert.deepEqual([...new Set(all.items.map((i) => i.kind))].sort(), ['kit', 'patch', 'sequence', 'sound']);
  for (const it of all.items) {
    if (it.meta.category) assert.ok(catSlugs.has(it.meta.category), 'category slug ' + it.meta.category);
    for (const mo of it.meta.moods) assert.ok(moods.has(mo), 'mood slug ' + mo);
    for (const g of it.meta.genre) assert.ok(genres.has(g), 'genre slug ' + g);
    for (const [k, w] of Object.entries(it.meta.axes)) assert.ok(v.axes.find((a) => a.key === k).words.includes(w), `axis word ${k}=${w}`);
    assert.ok(it.meta.tags.length <= 8);
  }
  assert.ok(all.items.some((i) => Object.keys(i.meta.axes).length === 0), 'contains untagged items');
  assert.ok(all.items.some((i) => i.missing && i.missing.length), 'contains a missing-asset patch');
  m.config({ hierarchy: 'flat' });
  const flat = await m.call('apc.presets.list', {});
  assert.deepEqual([...new Set(flat.items.map((i) => i.kind))], ['preset']);
  assert.equal((await m.call('apc.info')).features.presetHierarchy, 'flat');
});

// ---------------------------------------------------------------- mock semantics
test('filters: OR within a group, AND across groups, thresholds on ordered axes, untagged only pass ANY (tagging-filtering.md section 7)', async () => {
  const m = freshMock();
  const names = async (f) => (await m.call('apc.presets.list', { filters: f, sort: 'name' })).items.map((i) => i.name);
  assert.deepEqual(await names({ category: ['bass'], mood: ['dark', 'tense'], axes: { bri: { op: 'gte', word: 'muted' } } }), ['Broken Link', 'Reese Tension', 'Sub Distort']);
  assert.ok((await names({ category: ['bass'], mood: ['dark', 'tense'] })).includes('Unknown Bass'), 'ANY on the axis passes untagged');
  assert.ok(!(await names({ category: ['bass'], axes: { bri: { op: 'gte', word: 'dark' } } })).includes('Unknown Bass'), 'a strict axis (even the lowest word) excludes untagged');
  assert.deepEqual(await names({ category: ['bass'], axes: { bri: { op: 'eq', word: 'bright' } } }), ['Reese Tension']);
  assert.deepEqual((await names({ category: ['pad'], axes: { bri: { op: 'lte', word: 'muted' } } })), ['Evening Song', 'Night Choir']);
  assert.deepEqual(await names({ mood: ['ethereal'], category: ['pad', 'bells'] }), ['Glass Halo', 'Ice Cathedral']);
});

test('search is case-insensitive over name+subcategory+desc+category+author+tags+mood and capped at 64 chars; sorts are true sorts', async () => {
  const m = freshMock();
  const q = async (s) => (await m.call('apc.presets.list', { search: s, sort: 'name' })).items.map((i) => i.name);
  assert.deepEqual(await q('REESE'), ['Reese Tension', 'Sub Distort']);
  assert.deepEqual(await q('e-piano'), ['Tape Keys']);
  assert.ok((await q('x'.repeat(200))).length === 0);
  const rating = (await m.call('apc.presets.list', { sort: 'rating' })).items;
  for (let i = 1; i < rating.length; i++) assert.ok(rating[i - 1].rating >= rating[i].rating);
  const type = (await m.call('apc.presets.list', { sort: 'type' })).items.map((i) => i.meta.category || '~');
  assert.deepEqual(type, [...type].sort());
  const bpm = (await m.call('apc.presets.list', { sort: 'bpm' })).items.filter((i) => i.meta.tempo_bpm).map((i) => i.meta.tempo_bpm);
  assert.deepEqual(bpm, [90, 128, 140, 174]);
});

test('determinism: same seed -> same data; different seed -> different usage counters; scenario() rebuilds a clean world', async () => {
  const a = freshMock(), b = freshMock();
  const la = await a.call('apc.presets.list', { sort: 'uses' }), lb = await b.call('apc.presets.list', { sort: 'uses' });
  assert.deepEqual(la, lb);
  b.seed(99);
  assert.notDeepEqual((await b.call('apc.presets.list', { sort: 'uses' })).items.map((i) => i.uses), la.items.map((i) => i.uses));
  a.loadBank(500); const big = await a.call('apc.presets.list', {}); assert.equal(big.total, 530);
  a.scenario('demo'); assert.equal((await a.call('apc.presets.list', {})).total, 30, 'scenario() restores the stock bank');
  const x = freshMock(); const y = freshMock();
  assert.equal((await x.call('apc.license.offlineRequest')).requestCode, (await y.call('apc.license.offlineRequest')).requestCode, 'request codes are seeded');
});

test('gated verbs return {error:"gated"} in DEMO/UNVERIFIED and work in TRIAL/LICENSED', async () => {
  const m = freshMock();
  for (const sc of ['demo', 'unverified']) {
    m.scenario(sc);
    assert.equal((await m.call('apc.presets.save', { name: 'x' })).error, 'gated', sc + ' save');
    assert.equal((await m.call('apc.presets.exportPack', { ids: ['x'] })).error, 'gated', sc + ' export');
    assert.equal((await m.call('apc.presets.import', { path: '/p.pack' })).error, 'gated', sc + ' import');
    assert.equal((await m.call('apc.presets.state')).current.name, 'INIT', 'audio/host state unaffected: Init/A-B/rating stay available');
    assert.equal((await m.call('apc.presets.ab', { action: 'toggle' })).ab.active, 'B');
  }
  for (const sc of ['trial', 'licensed']) {
    m.scenario(sc);
    assert.ok((await m.call('apc.presets.save', { name: 'Mine' })).ok, sc + ' save');
  }
});

test('license state machine: activate / loadFile / offlineRequest / deactivate with fake serials', async () => {
  const m = freshMock();
  assert.equal((await m.call('apc.license.status')).state, 'DEMO');
  assert.equal((await m.call('apc.license.activate', { serial: 'FULL-1111' })).error, 'seat_limit');
  assert.equal((await m.call('apc.license.activate', { serial: 'wrong' })).error, 'invalid_serial');
  assert.equal((await m.call('apc.license.activate', { serial: '' })).error, 'missing_serial');
  assert.equal((await m.call('apc.license.activate', { serial: 'TEST-0000-A', email: 'bad' })).error, 'invalid_email');
  m.config({ offline: true });
  assert.equal((await m.call('apc.license.activate', { serial: 'TEST-0000-A' })).error, 'network');
  m.config({ offline: false });
  const ok = await m.call('apc.license.activate', { serial: 'test-0000-abcd', email: 'zed@example.test' });
  assert.equal(ok.ok, true); assert.equal(ok.status.state, 'LICENSED'); assert.equal(ok.status.name, 'zed');
  assert.equal((await m.call('apc.license.deactivate')).status.state, 'DEMO');
  assert.equal((await m.call('apc.license.deactivate')).error, 'not_active');
  const good = JSON.stringify({ schema: 'apc-license/1.0', customer_name: 'Q', allowed_seats: 2, signature_ed25519: 'TEST-x' });
  assert.equal((await m.call('apc.license.loadFile', { text: good })).status.name, 'Q');
  const bad = JSON.stringify({ schema: 'apc-license/1.0', customer_name: 'M', signature_ed25519: 'TAMPERED' });
  assert.equal((await m.call('apc.license.loadFile', { text: bad })).error, 'unverified');
  assert.equal((await m.call('apc.license.status')).name, 'Q', 'a bad file never replaces a good license');
  assert.equal((await m.call('apc.license.loadFile', { text: 'nope' })).error, 'invalid_file');
  m.config({ licenseMode: 'signed-file' });
  assert.equal((await m.call('apc.license.activate', { serial: 'TEST-0000-A' })).error, 'unsupported');
  assert.equal((await m.call('apc.license.offlineRequest')).error, 'unsupported');
  m.scenario('trial'); const t = await m.call('apc.license.status');
  assert.deepEqual([t.state, t.daysLeft], ['TRIAL', 27]);
});

test('update state machine: Idle -> Checking -> UpToDate | UpdateAvailable -> Downloading -> Verifying -> ReadyToInstall; failure variant retries', async () => {
  const m = freshMock(); m.config({ tickMs: 1 });
  const seq = []; m.on('update', (e) => seq.push(e.state.state));
  assert.equal((await m.call('apc.update.state')).state, 'Idle');
  assert.equal((await m.call('apc.update.download')).error, 'invalid_state', 'no download without an update');
  await m.call('apc.update.check'); await tick(20);
  assert.equal((await m.call('apc.update.state')).state, 'UpToDate');
  m.scenario('update-available'); seq.length = 0;
  assert.equal((await m.call('apc.update.state')).state, 'UpdateAvailable');
  assert.equal((await m.call('apc.update.revealInstaller')).error, 'invalid_state');
  await m.call('apc.update.download'); await tick(60);
  const dedup = seq.filter((s, i) => s !== seq[i - 1]);
  assert.deepEqual(dedup, ['Downloading', 'Verifying', 'ReadyToInstall']);
  const done = await m.call('apc.update.state');
  assert.match(done.message, /Close your DAW, then run the installer/); assert.ok(done.installerPath);
  assert.ok((await m.call('apc.update.revealInstaller')).ok);
  m.scenario('update-failed'); m.config({ tickMs: 1 }); seq.length = 0;
  await m.call('apc.update.download'); await tick(40);
  const failed = await m.call('apc.update.state');
  assert.equal(failed.state, 'Failed'); assert.ok(failed.message && failed.error);
  await m.call('apc.update.download'); await tick(60);
  assert.equal((await m.call('apc.update.state')).state, 'ReadyToInstall', 'retry works');
  m.scenario('update-available'); m.config({ tickMs: 20 });
  await m.call('apc.update.download'); await tick(30);
  assert.equal((await m.call('apc.update.cancel')).state, 'UpdateAvailable');
  await tick(100); assert.equal((await m.call('apc.update.state')).state, 'UpdateAvailable', 'cancel stops the timers');
});

test('settings: deep merge keeps unknown keys; engine per-instance edits do NOT change the machine default (X-08)', async () => {
  const m = freshMock();
  await m.call('apc.settings.set', { patch: { custom: { keep: 1 }, ui: { tooltips: false } } });
  await m.call('apc.settings.set', { patch: { ui: { scale: 1.5 } } });
  const s = await m.call('apc.settings.get');
  assert.equal(s.ui.tooltips, false); assert.equal(s.ui.scale, 1.5); assert.deepEqual(s.custom, { keep: 1 }); assert.equal(s.ui.double_click, 'reset');
  assert.equal((await m.call('apc.settings.set', { patch: { ui: { tooltip_delay_ms: 333 } } })).error, 'invalid');
  const e0 = await m.call('apc.engine.get');
  assert.equal(e0.values.oversampling, 2, 'new instance starts from the machine default');
  await m.call('apc.engine.set', { patch: { oversampling: 8 } });
  assert.equal((await m.call('apc.settings.get')).engine.oversampling, 2, 'machine default untouched');
  assert.equal((await m.call('apc.engine.get')).latencySamples, 256);
  m.newInstance(); assert.equal((await m.call('apc.engine.get')).values.oversampling, 2);
  await m.call('apc.settings.set', { patch: { engine: { oversampling: 4 } } }); m.newInstance();
  assert.equal((await m.call('apc.engine.get')).values.oversampling, 4);
});

test('dirty tracking, revert, init and A/B semantics', async () => {
  const m = freshMock(); m.scenario('licensed');
  const list = (await m.call('apc.presets.list', { search: 'Soft Keys' })).items;
  await m.call('apc.presets.load', { id: list[0].id });
  let st = await m.call('apc.presets.state');
  assert.equal(st.current.dirty, false); assert.equal(st.current.name, 'Soft Keys');
  const base = (await m.call('apc.params.get', { id: 'cutoff_hz' })).value;
  await m.call('apc.param.set', { id: 'cutoff_hz', value: base + 100 });
  assert.equal((await m.call('apc.presets.state')).current.dirty, true);
  await m.call('apc.param.set', { id: 'cutoff_hz', value: base });
  assert.equal((await m.call('apc.presets.state')).current.dirty, false, 'setting the value back is clean again');
  await m.call('apc.param.set', { id: 'cutoff_hz', value: 5000 });
  await m.call('apc.presets.revert');
  assert.equal((await m.call('apc.params.get', { id: 'cutoff_hz' })).value, base); assert.equal((await m.call('apc.presets.state')).current.dirty, false);
  // alt-click reset: base value only, modulation untouched
  const mods = (await m.call('apc.params.get', { id: 'cutoff_hz' })).modulation.length;
  await m.call('apc.param.reset', { id: 'cutoff_hz' });
  assert.equal((await m.call('apc.params.get', { id: 'cutoff_hz' })).value, 1200);
  assert.equal((await m.call('apc.params.get', { id: 'cutoff_hz' })).modulation.length, mods);
  // A/B
  await m.call('apc.presets.init'); await m.call('apc.param.set', { id: 'gain_db', value: 6 });
  let ab = await m.call('apc.presets.ab', { action: 'toggle' });
  assert.deepEqual(ab.ab, { active: 'B', hasB: true });
  await m.call('apc.param.set', { id: 'gain_db', value: -6 });
  await m.call('apc.presets.ab', { action: 'toggle' });
  assert.equal((await m.call('apc.params.get', { id: 'gain_db' })).value, 6);
  await m.call('apc.presets.ab', { action: 'copyAtoB' });
  await m.call('apc.presets.ab', { action: 'toggle' });
  assert.equal((await m.call('apc.params.get', { id: 'gain_db' })).value, 6, 'B received a copy of A');
});

test('io-error scenario: preset and settings I/O fail with a path; unknown functions answer {error}', async () => {
  const m = freshMock(); m.scenario('io-error');
  for (const [fn, args] of [['apc.settings.set', { patch: { ui: { tooltips: true } } }], ['apc.presets.save', { name: 'x' }], ['apc.presets.rescan', {}], ['apc.license.loadFile', { text: '{}' }]]) {
    const r = await m.call(fn, args);
    assert.equal(r.error, 'io', fn); assert.ok(r.path && r.message.includes(r.path), fn + ' message names the path');
  }
  assert.equal((await m.call('apc.nope')).error, 'unknown_function');
  assert.throws(() => m.scenario('nope'), /Unknown mock scenario/);
});

// ---------------------------------------------------------------- static rules
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/.*$/gm, '$1').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}
test('kit-B scripts are classic ES5-style scripts: no modules, optional chaining, ??, arrows, template literals, let/const, async, network', () => {
  for (const f of KIT_B_FILES.concat(['tests/harness-b.js'])) {
    const src = strip(read(f));
    assert.doesNotMatch(src, /^\s*import\s+[\w{*]/m, f + ': import'); assert.doesNotMatch(src, /^\s*export\s+(default|const|function|\{)/m, f + ': export');
    assert.doesNotMatch(src, /\?\.[A-Za-z_$[(]/, f + ': optional chaining'); assert.doesNotMatch(src, /\?\?/, f + ': nullish');
    assert.doesNotMatch(src, /=>/, f + ': arrow function'); assert.doesNotMatch(src, /`/, f + ': template literal');
    assert.doesNotMatch(src, /\b(let|const)\s+[\w{[]/, f + ': let/const'); assert.doesNotMatch(src, /\basync\s+function|\bawait\s/, f + ': async/await');
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, f + ': network API');
    assert.match(read(f), /"use strict"/, f + ': strict mode');
    new vm.Script(read(f), { filename: f });        // parses
  }
});

test('kit-B scripts only ever extend window.APC (never replace it) and expose dispose() on every component', () => {
  for (const f of KIT_B_FILES) {
    const src = read(f);
    assert.match(src, /var APC = \(window\.APC = window\.APC \|\| \{\}\)/, f);
    assert.doesNotMatch(src, /window\.APC\s*=\s*\{/, f + ' replaces APC');
  }
  const regs = { 'apc-settings.js': ['settings'], 'apc-presets.js': ['presets', 'preset-chip'], 'apc-license-ui.js': ['license'], 'apc-update-ui.js': ['update'] };
  for (const [f, names] of Object.entries(regs)) for (const n of names) assert.match(read(f), new RegExp(`APC\\.register\\("${n}"`), `${f} registers ${n}`);
  for (const f of ['apc-settings.js', 'apc-presets.js', 'apc-license-ui.js', 'apc-update-ui.js']) assert.match(read(f), /dispose/, f);
});

test('the kit-B CSS block is token-only (hardcoded colors only as var(--x, fallback)) and appears once', () => {
  const css = read('apc-components.css');
  const marks = css.match(/\/\* ==== kit-B ==== /g) || [];
  assert.equal(marks.length, 1, 'exactly one kit-B block');
  const block = css.slice(css.indexOf('/* ==== kit-B ==== '));
  const noVars = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\(\s*--[\w-]+\s*(?:,\s*(?:[^()]|\([^()]*\))*)?\)/g, 'var()');
  const colors = noVars.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) || [];
  assert.deepEqual(colors, [], 'raw colors outside var(--x, fallback): ' + colors.join(' '));
  for (const sel of ['.apc-sx', '.apc-pb', '.apc-lc', '.apc-up', '.apc-kb-sheet', '.apc-pc']) assert.ok(block.includes(sel), 'styles for ' + sel);
  assert.match(block, /prefers-reduced-motion/);
});

test('kit-B markup honors a11y rules: roles, labels, visible Save, tabs', () => {
  const s = read('apc-settings.js'), p = read('apc-presets.js'), l = read('apc-license-ui.js');
  assert.match(s, /role: "tablist"/); assert.match(s, /role: "tab"/); assert.match(s, /role: "tabpanel"/);
  assert.match(p, /role: "listbox"/); assert.match(p, /"data-k": "save"/); assert.match(p, /Save As…/); assert.match(p, /"data-k": "ab"/);
  assert.match(l, /role: kind === "err" \? "alert" : "status"/);
});

// ---------------------------------------------------------------- the real thing
test('kit-B DOM tests (kit-b-settings / kit-b-presets / kit-b-dialogs) pass in a headless Chromium-family browser', (t) => {
  const runner = require(path.join(REPO_ROOT, 'scripts', 'apc-kit-test.js'));
  const rep = runner.runAll({ only: 'kit-b-', budget: runner.DEFAULT_BUDGET_MS, timeout: 120000 }, {});
  if (rep.skipped) { t.skip('no Chromium-family browser installed: ' + rep.reason); return; }
  assert.deepEqual(rep.pages.map((p) => p.name), ['kit-b-dialogs', 'kit-b-presets', 'kit-b-settings']);
  const details = rep.pages.map((p) => `${p.name}: ${p.pass} passed, ${p.fail} failed ${(p.failures || []).join(' | ')} ${p.error || ''}`).join('\n');
  assert.equal(rep.ok, true, details);
  assert.ok(rep.pass >= 55, 'expected the full kit-B suite to run: ' + rep.pass + ' tests\n' + details);
});
