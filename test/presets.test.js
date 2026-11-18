'use strict';
// apc presets backend tests. Zero deps: node:test + node:assert (Node 18+).
// Run: node --test test/presets.test.js
// CLI tests run `bin/apc.js presets ...` against isolated temp roots (APC_ROOT); fixtures under
// test/fixtures/presets/ are copied to temp before any command that writes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const FIX = path.join(__dirname, 'fixtures', 'presets');
const presets = require(path.join(REPO_ROOT, 'scripts', 'apc-presets.js'));

function tmp(prefix = 'apc-presets-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function cli(args, opts = {}) {
  const root = opts.root || tmp('apc-root-');
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'presets', ...args], {
      encoding: 'utf8',
      env: { ...process.env, APC_ROOT: root, ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function json(args, opts) {
  const r = cli([...args, '--json'], opts);
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* leave null */ }
  return { ...r, data };
}

function copyFixture(rel) {
  const dest = tmp('apc-fix-');
  fs.cpSync(path.join(FIX, rel), dest, { recursive: true });
  return dest;
}

function pluginRoot(status, config) {
  const root = tmp('apc-plug-');
  fs.mkdirSync(path.join(root, 'plugins', 'Demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugins', 'Demo', 'status.json'), JSON.stringify({ plugin_name: 'Demo', version: 'v1.2.0', ...status }));
  if (config) fs.writeFileSync(path.join(root, 'apc.config.json'), JSON.stringify(config));
  return root;
}

const codes = (data) => [...new Set(data.issues.map((i) => i.code))].sort();
const errorCodes = (data) => [...new Set(data.issues.filter((i) => i.severity === 'error').map((i) => i.code))].sort();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// ---------------------------------------------------------------------------------------------
// vocabulary + schema
// ---------------------------------------------------------------------------------------------

test('PMX/1 vocabulary: shape, counts, slugs, append-only markers', () => {
  const v = readJson(path.join(REPO_ROOT, 'schemas', 'pmx1-vocabulary.json'));
  const slug = new RegExp(v.rules.slug_pattern);
  assert.equal(v.moods.length, 18);
  assert.equal(v.axes.length, 10);
  assert.deepEqual(v.axes.filter((a) => a.mandatory).map((a) => a.key), ['bri', 'war', 'agg', 'wid', 'dep', 'mov']);
  assert.deepEqual(v.rules.mandatory_axes_for_factory, ['bri', 'war', 'agg', 'wid', 'dep', 'mov']);
  assert.equal(v.articulations.length, 6);
  assert.deepEqual(Object.keys(v.temporal), ['attack', 'sustain', 'evolution', 'release', 'rhythm']);

  const original = v.categories.slice(0, 11);
  assert.deepEqual(original.map((c) => c.code), ['PD', 'BA', 'LD', 'KY', 'BE', 'PL', 'IM', 'DR', 'DN', 'SC', 'VC']);
  assert.ok(original.every((c) => c.since === '1.0.0' && c.group === 'instrument'));
  const extra = v.categories.slice(11);
  assert.ok(extra.length >= 8);
  assert.ok(extra.every((c) => c.group === 'effect' && c.appended === true && c.since === '1.1.0'), 'effect categories must be flagged as appended');
  for (const want of ['reverb', 'delay', 'modulation', 'dynamics', 'eq-filter', 'distortion', 'utility']) {
    assert.ok(v.categories.some((c) => c.slug === want), `effect category ${want}`);
  }

  const codesSeen = new Set(); const slugsSeen = new Set();
  for (const c of v.categories) {
    assert.match(c.code, /^[A-Z]{2}$/);
    assert.ok(!codesSeen.has(c.code), `duplicate code ${c.code}`); codesSeen.add(c.code);
    assert.match(c.slug, slug); assert.ok(!slugsSeen.has(c.slug)); slugsSeen.add(c.slug);
    c.subcategories.forEach((s) => assert.match(s, slug));
  }
  for (const list of [v.moods, v.genres, v.articulations]) list.forEach((e) => assert.match(e.slug, slug));
  assert.ok(v.genres.find((g) => g.slug === 'drum-and-bass').aliases.includes('drum&bass'));
  assert.equal(v.genres.find((g) => g.slug === 'world-tribal').label, 'World / Tribal');

  // append-only: 'since' never decreases along any ordered array
  const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  for (const list of [v.categories, v.axes, v.moods, v.genres, v.articulations]) {
    for (let i = 1; i < list.length; i++) assert.ok(cmp(list[i].since, list[i - 1].since) >= 0, `since order broken at ${list[i].slug || list[i].key}`);
  }

  // contradiction tables only reference real words
  const axisMap = new Map(v.axes.map((a) => [a.key, a.words]));
  for (const c of v.contradictions.axis) c.words.forEach((w) => assert.ok(axisMap.get(c.axis).includes(w), `${c.axis}:${w}`));
  const moodSlugs = new Set(v.moods.map((m) => m.slug));
  for (const pair of v.contradictions.mood) pair.forEach((m) => assert.ok(moodSlugs.has(m), m));
});

test('preset schema: hand validator accepts a chunk with engine/state_version/samples and rejects bad shapes', () => {
  const schema = presets.loadSchema({ root: REPO_ROOT });
  const chunk = {
    schema: 'apc-preset/1.0', kind: 'patch', id: 'pat_00000000-0000-4000-8000-000000000001', name: 'Current State',
    state_version: 3, app_version: '1.0.0',
    engine: { oversampling: 4, quality: 'high', voices: 16 },
    params: { filter_cutoff_hz: 1200.0, osc1_wave: 'saw' },
    samples: [{ ref: 'samples/kick.wav', sha256: 'a'.repeat(64), pack: 'Factory' }],
  };
  const errs = []; presets.validateSchema(chunk, schema, '', errs);
  assert.deepEqual(errs, []);

  const bad = JSON.parse(JSON.stringify(chunk));
  bad.engine.voices = 0; bad.samples[0].sha256 = 'XYZ'; bad.state_version = 'three'; bad.id = 'nope'; bad.params.x = [1];
  const e2 = []; presets.validateSchema(bad, schema, '', e2);
  const at = e2.map((e) => e.at);
  for (const p of ['engine.voices', 'samples[0].sha256', 'state_version', 'id', 'params.x']) assert.ok(at.includes(p), `expected error at ${p}, got ${at}`);
});

test('sanitizeFilename matches the documented rule', () => {
  const s = presets.sanitizeFilename;
  assert.equal(s('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j');
  assert.equal(s(''), 'untitled');
  assert.equal(s('...'), 'untitled');
  assert.equal(s('  lead  '), 'lead');
  assert.equal(s('CON'), '_CON');
  assert.equal(s('con.txt'), '_con.txt');
  assert.equal(s('console'), 'console');
  assert.ok(Buffer.byteLength(s('é'.repeat(200))) <= 120);
});

// ---------------------------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------------------------

test('validate: valid flat and typed packs pass with zero issues', () => {
  for (const rel of ['flat-valid', 'typed-valid']) {
    const r = json(['validate', path.join(FIX, rel)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.data.ok, true);
    assert.deepEqual(r.data.issues, [], rel);
  }
  const typed = json(['validate', path.join(FIX, 'typed-valid')]).data;
  assert.equal(typed.packs[0].layout, 'typed');
  assert.equal(typed.files, 6);
  assert.equal(json(['validate', path.join(FIX, 'flat-valid')]).data.packs[0].layout, 'flat');
});

test('validate: a single file and an app root are accepted', () => {
  const file = path.join(FIX, 'typed-valid', 'presets', 'Typed_Factory', 'kits', 'Heavy_Impacts.kit');
  const r = json(['validate', file]);
  assert.equal(r.status, 0, r.stdout);
  const viaRoot = json(['validate', path.join(FIX, 'typed-valid')]);
  assert.equal(viaRoot.data.packs.length, 1);
});

// case -> [expected exit, codes that must be present, extra args]
const BAD_CASES = {
  'bad-json':            [1, ['json-invalid']],
  'schema':              [1, ['schema', 'kind-folder-mismatch']],
  'schema-version':      [1, ['schema-version']],
  'incomplete-meta':     [1, ['axes-incomplete', 'moods-count', 'desc-missing']],
  'contradiction':       [1, ['contradiction']],
  'too-many-tags':       [1, ['tags-too-many']],
  'vocab':               [1, ['category-invalid', 'axis-word-invalid', 'mood-invalid']],
  'duplicate-name':      [1, ['name-duplicate']],
  'duplicate-id':        [1, ['id-duplicate']],
  'missing-ref':         [1, ['ref-missing']],
  'ref-escape':          [1, ['ref-escape']],
  'ref-absolute':        [1, ['ref-absolute']],
  'ref-wrong-kind':      [1, ['ref-kind-mismatch']],
  'sample-hash':         [1, ['sample-hash-mismatch']],
  'sample-missing':      [1, ['sample-missing']],
  'mixed-layout':        [1, ['mixed-layout']],
  'wrong-folder':        [1, ['kind-folder-mismatch']],
  'pack-manifest':       [1, ['pack-id', 'pack-version', 'pack-license']],
  'param-id-format':     [1, ['param-id-format']],
  'choice-index':        [1, ['choice-not-string'], ['--manifest', path.join(FIX, 'bad', 'choice-index', 'manifest.json')]],
  // warnings only -> exit 0
  'rebind-ref':          [0, ['ref-rebound']],
  'noncanonical-vocab':  [0, ['vocab-noncanonical']],
  'normalized-hz':       [0, ['normalized-looking']],
  'engine-in-asset':     [0, ['engine-in-asset']],
  'sample-no-hash':      [0, ['sample-no-hash']],
  'orphan-sample':       [0, ['sample-orphan']],
};

for (const [name, [exit, want, extra]] of Object.entries(BAD_CASES)) {
  test(`validate: bad case "${name}" -> exit ${exit}, reports ${want.join(', ')}`, () => {
    const r = json(['validate', path.join(FIX, 'bad', name), ...(extra || [])]);
    assert.equal(r.status, exit, r.stdout + r.stderr);
    assert.ok(r.data, 'json output');
    for (const c of want) assert.ok(codes(r.data).includes(c), `expected ${c}, got ${codes(r.data)}`);
    assert.equal(r.data.ok, exit === 0);
    if (exit === 0) assert.deepEqual(errorCodes(r.data), []);
    else assert.ok(errorCodes(r.data).length > 0);
  });
}

test('validate: every bad fixture is covered by the table', () => {
  const dirs = fs.readdirSync(path.join(FIX, 'bad')).sort();
  assert.deepEqual(dirs, Object.keys(BAD_CASES).sort());
});

test('validate: --strict turns warnings into failures', () => {
  const r = json(['validate', path.join(FIX, 'bad', 'rebind-ref'), '--strict']);
  assert.equal(r.status, 1);
  assert.equal(r.data.ok, false);
});

test('validate: non-factory packs only need valid values, not completeness', () => {
  const dir = copyFixture('typed-valid');
  const pj = path.join(dir, 'presets', 'Typed_Factory', 'pack.json');
  const m = readJson(pj); m.license = 'CC-BY'; fs.writeFileSync(pj, JSON.stringify(m));
  const sound = path.join(dir, 'presets', 'Typed_Factory', 'sounds', 'Sub_Distort.snd');
  const d = readJson(sound); d.meta = { category: 'bass' }; fs.writeFileSync(sound, JSON.stringify(d));
  assert.equal(json(['validate', dir]).status, 0);
  const strictFactory = json(['validate', dir, '--factory']);
  assert.equal(strictFactory.status, 1);
  assert.ok(codes(strictFactory.data).includes('axes-incomplete'));
});

test('validate: lint rejects unsafe filenames (synthetic pack, names Windows cannot store)', () => {
  const vocab = presets.loadVocab({ root: REPO_ROOT });
  const schema = presets.loadSchema({ root: REPO_ROOT });
  const doc = { schema: 'apc-preset/1.0', kind: 'preset', id: 'pre_00000000-0000-4000-8000-000000000001', name: 'X', meta: {}, params: {} };
  const pack = {
    dir: path.join(os.tmpdir(), 'apc-synthetic'), name: 'Synthetic', hasManifest: false, manifest: null, layout: 'flat', strayDirs: [], samples: [],
    assets: ['Bad:Name.preset', 'CON.preset', 'trail.preset'].map((n) => ({ abs: path.join(os.tmpdir(), 'apc-synthetic', n), rel: n, doc, parseError: null, folderKind: 'preset', layoutSlot: 'flat' })),
  };
  const rep = new presets.Report();
  presets.lintPacks([pack], { vocab, schema, factory: false }, rep);
  const unsafe = rep.issues.filter((i) => i.code === 'filename-unsafe').map((i) => i.file);
  assert.deepEqual(unsafe.sort(), ['Synthetic/Bad:Name.preset', 'Synthetic/CON.preset']);
});

test('validate: missing path is a usage error (exit 2)', () => {
  assert.equal(cli(['validate', path.join(os.tmpdir(), 'definitely-not-here-xyz')]).status, 2);
  assert.equal(cli(['validate']).status, 2);
});

// ---------------------------------------------------------------------------------------------
// golden file: apc-preset/1.0 written today still loads under defaults-first logic
// ---------------------------------------------------------------------------------------------

test('golden: a file written with manifest v1 validates and loads under v2 (defaults-first, append-only)', () => {
  const golden = path.join(FIX, 'golden');
  const file = path.join(golden, 'presets', 'Golden', 'sounds', 'Written_Today.snd');
  const v1 = path.join(golden, 'param-manifest-v1.json');
  const v2 = path.join(golden, 'param-manifest-v2.json');

  // structurally valid against both manifests (single file: pack context is its folder)
  for (const m of [v1, v2]) {
    const r = json(['validate', file, '--manifest', m]);
    assert.equal(r.status, 0, r.stdout);
  }
  // the manifest check passes for the append-only evolution and fails for a breaking one
  assert.equal(cli(['check-manifest', v1, v2]).status, 0);
  const broken = json(['check-manifest', v2, path.join(golden, 'param-manifest-broken.json')]);
  assert.equal(broken.status, 1);
  assert.ok(broken.data.violations.some((v) => v.id === 'filter_res'));
  assert.ok(broken.data.violations.some((v) => /reordered/.test(v.reason)));
  assert.deepEqual(json(['check-manifest', v1, v2]).data.added, ['osc1_sub_level', 'unison_on']);

  // defaults-first load
  const doc = readJson(file);
  assert.equal(doc.schema, 'apc-preset/1.0');
  const m2 = presets.loadManifest(v2);
  const { values, report } = presets.resolveDefaultsFirst(m2.params, doc.params);
  assert.equal(values.osc1_wave, 'saw');
  assert.equal(values.filter_cutoff_hz, 95.5);
  assert.equal(values.filter_res, 0.35);
  assert.equal(values.drive_amount, 0.62);
  assert.equal(values.osc1_sub_level, 0.25, 'parameter added after the file was written comes up at its default');
  assert.equal(values.unison_on, false);
  assert.deepEqual(report.defaulted.sort(), ['osc1_sub_level', 'unison_on']);
  assert.deepEqual(report.unknown, { legacy_removed_param: 1.5 }, 'unknown keys are preserved, not dropped');
  assert.deepEqual(report.invalid, []);

  // choice stored as an index is rejected and falls back to the default
  const idx = presets.resolveDefaultsFirst(m2.params, { osc1_wave: 1 });
  assert.equal(idx.values.osc1_wave, 'saw');
  assert.equal(idx.report.invalid.length, 1);
  // empty params == INIT == pure defaults
  const init = presets.resolveDefaultsFirst(m2.params, {});
  assert.equal(init.report.defaulted.length, m2.params.length);
});

// ---------------------------------------------------------------------------------------------
// index
// ---------------------------------------------------------------------------------------------

test('index: builds rows, joins ratings by id, reuses on unchanged, removes ghost rows', () => {
  const app = copyFixture('typed-valid');
  const sndId = 'snd_00000000-0000-4000-8000-000000000010';
  fs.writeFileSync(path.join(app, 'user-data.json'), JSON.stringify({
    schema: 'apc-user-data/1.0', assets: { [sndId]: { rating: 4, favorite: true, uses: 7 }, snd_orphan: { rating: 2 } },
  }));

  const first = json(['index', app]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(first.data.rows, 6);
  assert.equal(first.data.stats.reparsed, 6);
  assert.equal(first.data.stats.orphan_user_data, 1);
  const indexFile = path.join(app, 'cache', '_index.json');
  const idx = readJson(indexFile);
  assert.equal(idx.schema, 'apc-index/1.0');
  const row = idx.rows.find((r) => r.id === sndId);
  for (const k of ['id', 'kind', 'name', 'pack', 'path', 'meta', 'mtime', 'size', 'hash']) assert.ok(k in row, `row.${k}`);
  assert.equal(row.rating, 4); assert.equal(row.favorite, true); assert.equal(row.uses, 7);
  assert.equal(row.pack, 'Typed_Factory');
  assert.equal(row.path, 'Typed_Factory/sounds/Sub_Distort.snd');
  assert.match(row.hash, /^[0-9a-f]{64}$/);
  assert.equal(idx.rows.find((r) => r.kind === 'patch').rating, 0);
  assert.ok(!fs.readdirSync(path.join(app, 'cache')).some((n) => n.includes('.tmp-')), 'atomic write leaves no temp file');

  const second = json(['index', app]);
  assert.equal(second.data.stats.reused, 6);
  assert.equal(second.data.stats.reparsed, 0);

  // mtime+size invalidation
  const glass = path.join(app, 'presets', 'Typed_Factory', 'sounds', 'Glass_Pluck.snd');
  const gd = readJson(glass); gd.name = 'Glass Pluck Renamed'; fs.writeFileSync(glass, JSON.stringify(gd, null, 2));
  const future = new Date(Date.now() + 5000); fs.utimesSync(glass, future, future);
  const third = json(['index', app]);
  assert.equal(third.data.stats.reparsed, 1);
  assert.equal(third.data.stats.reused, 5);
  assert.equal(readJson(indexFile).rows.find((r) => r.id === 'snd_00000000-0000-4000-8000-000000000011').name, 'Glass Pluck Renamed');

  // rename (move) keeps the id, so the rating follows; the old path is a ghost row and must go
  const sub = path.join(app, 'presets', 'Typed_Factory', 'sounds', 'Sub_Distort.snd');
  const moved = path.join(app, 'presets', 'Typed_Factory', 'sounds', 'Renamed_Sub.snd');
  fs.renameSync(sub, moved);
  const fourth = json(['index', app]);
  assert.equal(fourth.data.stats.removed, 1);
  const rows = readJson(indexFile).rows;
  assert.ok(!rows.some((r) => r.path.endsWith('Sub_Distort.snd')));
  assert.equal(rows.find((r) => r.id === sndId).rating, 4, 'ratings key by id, not by file name or path');

  // deleting the index is harmless: it rebuilds identically
  fs.rmSync(indexFile);
  assert.equal(json(['index', app]).data.rows, 6);
});

test('index: unreadable assets are reported, not fatal; missing presets/ is a usage error', () => {
  const app = copyFixture('typed-valid');
  fs.writeFileSync(path.join(app, 'presets', 'Typed_Factory', 'sounds', 'Broken.snd'), '{ nope');
  const r = json(['index', app]);
  assert.equal(r.status, 0);
  assert.equal(r.data.errors.length, 1);
  assert.equal(r.data.rows, 6);
  assert.equal(cli(['index', os.tmpdir()]).status, 2);
});

// ---------------------------------------------------------------------------------------------
// promote
// ---------------------------------------------------------------------------------------------

function wipRoot() {
  const app = tmp('apc-promote-');
  fs.cpSync(path.join(FIX, 'typed-valid', 'presets', 'Typed_Factory'), path.join(app, 'presets', '_wip'), { recursive: true });
  fs.mkdirSync(path.join(app, 'presets', 'Factory'), { recursive: true });
  const pj = readJson(path.join(app, 'presets', '_wip', 'pack.json'));
  fs.writeFileSync(path.join(app, 'presets', 'Factory', 'pack.json'), JSON.stringify({ ...pj, name: 'Factory' }));
  return app;
}
const PATCH_ID = 'pat_00000000-0000-4000-8000-000000000040';

test('promote: lint gate refuses and writes nothing when content fails', () => {
  const app = wipRoot();
  const sound = path.join(app, 'presets', '_wip', 'sounds', 'Sub_Distort.snd');
  const d = readJson(sound); delete d.meta.axes.agg; d.meta.tags = new Array(9).fill('x').map((x, i) => `t${i}`); fs.writeFileSync(sound, JSON.stringify(d));
  const before = fs.readdirSync(path.join(app, 'presets', 'Factory'));
  const r = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.data.ok, false);
  assert.ok(errorCodes(r.data).includes('axes-incomplete'));
  assert.deepEqual(fs.readdirSync(path.join(app, 'presets', 'Factory')), before, 'destination untouched');
  assert.ok(!fs.existsSync(path.join(app, 'cache')), 'no index regenerated on refusal');
});

test('promote: --ids pulls in dependencies, copies atomically, writes changelog + index', () => {
  const app = wipRoot();
  const r = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--ids', PATCH_ID]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.data.ok, true);
  const factory = path.join(app, 'presets', 'Factory');
  for (const f of ['patches/Dark_Obsidian.pat', 'kits/Heavy_Impacts.kit', 'sounds/Sub_Distort.snd', 'sequences/Halftime_174.seq']) {
    assert.ok(fs.existsSync(path.join(factory, f)), f);
  }
  assert.ok(!fs.existsSync(path.join(factory, 'sounds', 'Glass_Pluck.snd')), 'unrelated asset not promoted');
  assert.equal(r.data.included_dependencies.length, 3);
  assert.deepEqual(fs.readdirSync(factory, { recursive: true }).filter((n) => String(n).includes('.tmp-') || String(n).includes('promote-bak')), []);

  const cl = readJson(path.join(factory, 'changelog.json'));
  assert.equal(cl.entries.length, 1);
  assert.equal(cl.entries[0].added.length, 4);
  assert.equal(cl.entries[0].from, '_wip');
  const idx = readJson(path.join(app, 'cache', '_index.json'));
  assert.ok(idx.rows.some((x) => x.pack === 'Factory' && x.id === PATCH_ID));

  // the promoted pack is itself lint-clean as factory content (refs resolve in the new location)
  assert.equal(json(['validate', factory, '--factory']).status, 0);

  // promoting the same content again is a no-op update
  const again = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--ids', PATCH_ID]);
  assert.equal(again.status, 0);
  assert.equal(again.data.promoted.length, 0);
  assert.equal(again.data.unchanged.length, 4);

  // changed content is an update, recorded as such
  const sound = path.join(app, 'presets', '_wip', 'sounds', 'Sub_Distort.snd');
  const d = readJson(sound); d.params.drive_amount = 0.9; fs.writeFileSync(sound, JSON.stringify(d, null, 2));
  const upd = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--ids', PATCH_ID]);
  assert.equal(upd.status, 0, upd.stdout);
  assert.deepEqual(upd.data.promoted.map((p) => p.action), ['update']);
  assert.equal(readJson(path.join(factory, 'changelog.json')).entries.length, 2, 'a no-op promote writes no changelog entry');
  assert.equal(readJson(path.join(factory, 'sounds', 'Sub_Distort.snd')).params.drive_amount, 0.9);
});

test('promote: whole pack, --dry-run writes nothing, --move removes the staged copies', () => {
  const app = wipRoot();
  const dry = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--dry-run']);
  assert.equal(dry.status, 0);
  assert.equal(dry.data.dry_run, true);
  assert.ok(!fs.existsSync(path.join(app, 'presets', 'Factory', 'sounds')));
  const r = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--move']);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.data.promoted.length, 6);
  assert.ok(fs.existsSync(path.join(app, 'presets', 'Factory', 'samples', 'kick_raw.wav')));
  assert.ok(!fs.existsSync(path.join(app, 'presets', '_wip', 'sounds', 'Init.snd')));
});

test('promote: unknown id, name clash with a different id, and missing destination manifest are refused', () => {
  const app = wipRoot();
  const unknown = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--ids', 'snd_00000000-0000-4000-8000-00000000dead']);
  assert.equal(unknown.status, 1);
  assert.ok(errorCodes(unknown.data).includes('id-not-found'));

  // destination already holds a different asset with the same display name
  const factory = path.join(app, 'presets', 'Factory');
  fs.mkdirSync(path.join(factory, 'sounds'), { recursive: true });
  const other = readJson(path.join(app, 'presets', '_wip', 'sounds', 'Sub_Distort.snd'));
  other.id = 'snd_00000000-0000-4000-8000-0000000000aa';
  fs.writeFileSync(path.join(factory, 'sounds', 'Sub_Distort.snd'), JSON.stringify(other));
  const clash = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app, '--ids', 'snd_00000000-0000-4000-8000-000000000010']);
  assert.equal(clash.status, 1);
  assert.ok(errorCodes(clash.data).includes('name-duplicate'));

  // destination without pack.json and source without one to derive from
  const app2 = wipRoot();
  fs.rmSync(path.join(app2, 'presets', 'Factory', 'pack.json'));
  fs.rmSync(path.join(app2, 'presets', '_wip', 'pack.json'));
  const noManifest = json(['promote', '--from', '_wip', '--to', 'Factory', '--root', app2]);
  assert.equal(noManifest.status, 1);
  assert.ok(errorCodes(noManifest.data).includes('pack-manifest-missing'));
});

// ---------------------------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------------------------

test('init (typed): extensions come from standards, never hardcoded; output is factory-lint clean', () => {
  const root = pluginRoot({
    manufacturer: 'Example Audio',
    standards: { 'preset.hierarchy': 'typed', 'preset.sound_ext': '.zzs', 'preset.kit_ext': 'zzk', 'preset.seq_ext': '.zzq', 'preset.patch_ext': '.zzp', 'preset.pack_ext': '.zzpack' },
  });
  const r = json(['init', '--plugin', 'Demo'], { root });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.data.hierarchy, 'typed');
  assert.deepEqual(r.data.extensions, { sound: '.zzs', kit: '.zzk', sequence: '.zzq', patch: '.zzp' });
  const presetsDir = path.join(root, 'plugins', 'Demo', 'Assets', 'presets');
  const pack = readJson(path.join(presetsDir, 'Factory', 'pack.json'));
  assert.equal(pack.schema, 'apc-pack/1.0');
  assert.equal(pack.license, 'factory');
  assert.equal(pack.plugin, 'Demo');
  assert.equal(pack.layout, 'typed');
  assert.equal(pack.pack_ext, '.zzpack');
  assert.equal(pack.app_version_min, '1.2.0');
  assert.equal(pack.author, 'Example Audio');
  assert.match(pack.id, /^pack_[0-9a-f-]{36}$/);
  const init = readJson(path.join(presetsDir, 'Factory', 'sounds', 'Init.zzs'));
  assert.equal(init.kind, 'sound'); assert.match(init.id, /^snd_[0-9a-f-]{36}$/);
  assert.equal(init.schema, 'apc-preset/1.0'); assert.deepEqual(init.params, {}); assert.equal(init.meta.role, 'init');
  assert.ok(fs.existsSync(path.join(presetsDir, '_wip')));
  assert.equal(r.data.options['engine.state_scope'], 'chunk');
  assert.equal(r.data.options['preset.factory_install'], 'user-folder');

  const lint = json(['validate', presetsDir, '--factory', '--plugin', 'Demo'], { root });
  assert.equal(lint.status, 0, lint.stdout);

  // idempotent: second run keeps existing files (and ids); --force rewrites
  const again = json(['init', '--plugin', 'Demo'], { root });
  assert.equal(again.data.written.length, 0);
  assert.equal(again.data.skipped.length, 2);
  assert.equal(readJson(path.join(presetsDir, 'Factory', 'sounds', 'Init.zzs')).id, init.id);
  const forced = json(['init', '--plugin', 'Demo', '--force'], { root });
  assert.equal(forced.data.written.length, 2);
  assert.notEqual(readJson(path.join(presetsDir, 'Factory', 'sounds', 'Init.zzs')).id, init.id);
});

test('init (flat): one preset extension, flat layout, pack name and out dir overridable', () => {
  const root = pluginRoot({ standards: { 'preset.hierarchy': 'flat', 'preset.preset_ext': '.zzf' } });
  const out = path.join(tmp('apc-out-'), 'presets');
  const r = json(['init', '--plugin', 'Demo', '--pack', 'My Factory', '--out', out, '--author', 'Somebody'], { root });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.data.extensions, { preset: '.zzf' });
  assert.ok(fs.existsSync(path.join(out, 'My Factory', 'Init.zzf')));
  assert.ok(!fs.existsSync(path.join(out, 'My Factory', 'sounds')), 'flat packs have no kind folders');
  const init = readJson(path.join(out, 'My Factory', 'Init.zzf'));
  assert.equal(init.kind, 'preset'); assert.match(init.id, /^pre_/);
  assert.equal(readJson(path.join(out, 'My Factory', 'pack.json')).layout, 'flat');
  assert.equal(json(['validate', out, '--factory', '--plugin', 'Demo'], { root }).status, 0);
  // a typed-looking pack is rejected for a flat plugin
  const typed = json(['validate', path.join(FIX, 'typed-valid'), '--plugin', 'Demo'], { root });
  assert.equal(typed.status, 1);
  assert.ok(codes(typed.data).includes('hierarchy-mismatch'));
});

test('init: global defaults apply, plugin answers win, unanswered extensions are a clear error', () => {
  const root = pluginRoot(
    { standards: { 'preset.sound_ext': '.pls' } },
    { standards: { 'preset.hierarchy': 'typed', 'preset.sound_ext': '.gls', 'preset.kit_ext': '.glk', 'preset.seq_ext': '.glq', 'preset.patch_ext': '.glp' } },
  );
  const r = json(['init', '--plugin', 'Demo'], { root });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.data.extensions.sound, '.pls', 'plugin answer beats global default');
  assert.equal(r.data.extensions.kit, '.glk');

  const empty = pluginRoot({ standards: {} });
  const bad = cli(['init', '--plugin', 'Demo'], { root: empty });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /preset\.sound_ext/);
  assert.match(bad.stderr, /apc standards set/);
  assert.ok(!fs.existsSync(path.join(empty, 'plugins', 'Demo', 'Assets')), 'nothing written on error');

  assert.equal(cli(['init', '--plugin', 'NoSuchPlugin'], { root }).status, 1);
  assert.equal(cli(['init'], { root }).status, 2);
  const badExt = pluginRoot({ standards: { 'preset.hierarchy': 'flat', 'preset.preset_ext': '.bad ext' } });
  assert.equal(cli(['init', '--plugin', 'Demo'], { root: badExt }).status, 1);
});

// ---------------------------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------------------------

test('paths: per-OS layouts, machine-wide scope, env override, factory install mode', () => {
  const root = pluginRoot({ manufacturer: 'Example Audio', standards: { 'preset.factory_install': 'shared-seed' } });
  const host = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const noEnv = { APC_PRESET_ROOT: '' };
  const P = (osName) => (osName === 'win' ? path.win32 : path.posix);
  // Layouts for the host OS resolve real environment variables; every other OS prints templates.
  const foreign = ['win', 'mac', 'linux'].filter((o) => o !== host);

  const win = json(['paths', '--plugin', 'Demo', '--os', 'win'], { root, env: noEnv });
  assert.equal(win.status, 0, win.stdout + win.stderr);
  const tail = '\\Example Audio\\Demo';
  if (host !== 'win') {
    assert.equal(win.data.root, `%LOCALAPPDATA%${tail}`);
    assert.equal(win.data.presets, `%LOCALAPPDATA%${tail}\\presets`);
    assert.equal(win.data.wip, `%LOCALAPPDATA%${tail}\\presets\\_wip`);
    assert.equal(win.data.user, `%LOCALAPPDATA%${tail}\\presets\\User`);
    assert.equal(win.data.index, `%LOCALAPPDATA%${tail}\\cache\\_index.json`);
    assert.equal(win.data.settings, `%LOCALAPPDATA%${tail}\\settings.json`);
    assert.equal(win.data.user_data, `%LOCALAPPDATA%${tail}\\user-data.json`);
    assert.equal(win.data.license, `%LOCALAPPDATA%${tail}\\license.lic`);
    assert.equal(win.data.factory_install.target, '%PROGRAMDATA%\\Example Audio\\Demo\\factory');
  } else {
    assert.ok(win.data.root.endsWith(tail), win.data.root);
    assert.ok(path.win32.isAbsolute(win.data.root));
  }
  assert.deepEqual(win.data.pack_shape.typed.map((p) => path.win32.basename(p)), ['sounds', 'kits', 'sequences', 'patches', 'samples']);
  assert.equal(win.data.factory_install.mode, 'shared-seed');
  assert.ok(!/Program Files/i.test(JSON.stringify(win.data)), 'never Program Files (P-03)');

  if (foreign.includes('mac')) {
    const mac = json(['paths', '--plugin', 'Demo', '--os', 'mac'], { root, env: noEnv }).data;
    assert.equal(mac.root, '~/Library/Application Support/Example Audio/Demo');
    assert.equal(mac.index, '~/Library/Application Support/Example Audio/Demo/cache/_index.json');
  }
  if (foreign.includes('linux')) {
    const lin = json(['paths', '--plugin', 'Demo', '--os', 'linux'], { root, env: noEnv }).data;
    assert.equal(lin.root, '~/.local/share/Example Audio/Demo');
    assert.equal(lin.index, '~/.local/share/Example Audio/Demo/cache/_index.json');
  }
  // machine-wide roots do not depend on the user's home
  assert.equal(json(['paths', '--plugin', 'Demo', '--os', 'mac', '--scope', 'machine-wide'], { root, env: noEnv }).data.root, '/Library/Application Support/Example Audio/Demo');
  assert.equal(json(['paths', '--plugin', 'Demo', '--os', 'linux', '--scope', 'machine-wide'], { root, env: noEnv }).data.root, '/usr/local/share/Example Audio/Demo');

  // APC_PRESET_ROOT replaces the base on the host OS only
  const base = path.join(os.tmpdir(), 'portable-root');
  const ov = json(['paths', '--plugin', 'Demo', '--os', host], { root, env: { APC_PRESET_ROOT: base } }).data;
  assert.equal(ov.env_override, 'APC_PRESET_ROOT');
  assert.equal(ov.root, P(host).join(base, 'Example Audio', 'Demo'));
  assert.equal(ov.presets, P(host).join(base, 'Example Audio', 'Demo', 'presets'));
  assert.equal(json(['paths', '--plugin', 'Demo', '--os', foreign[0]], { root, env: { APC_PRESET_ROOT: base } }).data.env_override, null);

  // flags and defaults
  assert.equal(json(['paths', '--plugin', 'Other', '--os', 'linux', '--manufacturer', 'Maker/Co', '--scope', 'machine-wide'], { root, env: noEnv }).data.root, '/usr/local/share/Maker-Co/Other');
  assert.equal(json(['paths', '--plugin', 'Nope', '--os', 'linux'], { root }).data.manufacturer_is_placeholder, true);
  assert.equal(cli(['paths', '--plugin', 'Demo', '--os', 'beos'], { root }).status, 2);
  assert.equal(cli(['paths'], { root }).status, 2);
});

test('paths: machine-wide data_root option is honoured', () => {
  const root = pluginRoot({ manufacturer: 'Example Audio', standards: { 'preset.data_root': 'machine-wide' } });
  const r = json(['paths', '--plugin', 'Demo', '--os', 'mac'], { root, env: { APC_PRESET_ROOT: '' } }).data;
  assert.equal(r.scope, 'machine-wide');
  assert.equal(r.root, '/Library/Application Support/Example Audio/Demo');
});

test('presets: unknown subcommand and help', () => {
  assert.equal(cli(['frobnicate']).status, 2);
  assert.equal(cli(['help']).status, 0);
});
