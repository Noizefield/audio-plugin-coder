'use strict';

/**
 * apc-presets - backend tooling for the apc-preset/1.0 standard (roadmap #7,
 * decisions P-01..P-14).
 *
 *   apc presets validate <dir|file>   schema + PMX/1 lint + reference integrity
 *   apc presets index <root>          build cache/_index.json (mtime+size invalidation)
 *   apc presets promote --from --to   lint gate, atomic copy, index + changelog
 *   apc presets init --plugin <Name>  INIT preset + pack.json from the plugin's standards
 *   apc presets paths --plugin <Name> per-OS app-data layout
 *   apc presets check-manifest <released> <current>   append-only parameter check (X-01/P-07)
 *
 * Zero dependencies, Node 18+. Exports run(args, ctx) -> exit code; ctx =
 * { root, resolvePaths, pluginPath, readConfig, cmd } as passed by bin/apc.js.
 * Every subcommand accepts --json.
 *
 * Files store vocabulary SLUGS (schemas/pmx1-vocabulary.json), real-world units,
 * and choice LABELS - never indices (P-04). The C++ twins of the file-safety and
 * defaults-first logic live in common/apc/.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const STANDARD = 'apc-preset/1.0';
const PACK_STANDARD = 'apc-pack/1.0';
const INDEX_STANDARD = 'apc-index/1.0';
const USER_DATA_STANDARD = 'apc-user-data/1.0';
const MANIFEST_STANDARD = 'apc-param-manifest/1.0';

const KIND_PREFIX = { sound: 'snd', kit: 'kit', sequence: 'seq', patch: 'pat', preset: 'pre' };
const KIND_DIRS = { sounds: 'sound', kits: 'kit', sequences: 'sequence', patches: 'patch' };
const DIR_OF_KIND = { sound: 'sounds', kit: 'kits', sequence: 'sequences', patch: 'patches' };
const EXT_OPTION = {
  sound: 'preset.sound_ext', kit: 'preset.kit_ext', sequence: 'preset.seq_ext',
  patch: 'preset.patch_ext', preset: 'preset.preset_ext',
};
const NON_ASSET_EXT = new Set([
  '.wav', '.flac', '.aif', '.aiff', '.ogg', '.mp3', '.png', '.jpg', '.jpeg', '.svg',
  '.md', '.txt', '.zip', '.lic', '.bak', '.log',
]);
const NON_ASSET_NAMES = new Set(['pack.json', 'changelog.json', 'user-data.json', 'settings.json']);
const IGNORED_DIRS = new Set(['samples', '_history', 'cache', '.git', 'node_modules']);
const NON_FACTORY_PACKS = new Set(['_wip', 'User']);
const DEFAULT_SIZE_BUDGET_MB = 512;

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function posix(p) { return p.split(path.sep).join('/'); }

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function sha256Buf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/**
 * P-06 filename rule, mirrored by apc::sanitizeFilename in common/apc/ApcAtomicFile.h.
 * Illegal chars / \ : * ? " < > | and control chars -> '-', trim leading spaces and
 * trailing dots/spaces, Windows reserved device names get a '_' prefix, empty ->
 * 'untitled', capped at maxLen UTF-8 bytes (never cutting a code point).
 */
function sanitizeFilename(name, maxLen = 120) {
  let s = String(name === undefined || name === null ? '' : name)
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-');
  s = s.replace(/^ +/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s.split('.')[0])) s = '_' + s;
  if (!s) s = 'untitled';
  let buf = Buffer.from(s, 'utf8');
  if (buf.length > maxLen) {
    let cut = maxLen;
    while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
    s = buf.subarray(0, cut).toString('utf8').replace(/[. ]+$/, '');
    if (!s) s = 'untitled';
  }
  return s;
}

/** temp + flush + fsync + rename (P-06). Throws on failure; target is never truncated. */
function atomicWriteFileSync(target, data, opts = {}) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  let fd = -1;
  try {
    fd = fs.openSync(tmp, 'w');
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    try { fs.fsyncSync(fd); } catch { /* best effort */ }
    fs.closeSync(fd); fd = -1;
    if (opts.keepBackup && fs.existsSync(target)) {
      try { fs.copyFileSync(target, `${target}.bak`); } catch { /* best effort */ }
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw new Error(`cannot write ${target}: ${e.message}`);
  }
}

function writeJsonAtomic(target, obj) {
  atomicWriteFileSync(target, JSON.stringify(obj, null, 2) + '\n');
}

function walkFiles(dir, opts = {}) {
  const out = [];
  const skipDirs = opts.skipDirs || IGNORED_DIRS;
  (function rec(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) rec(full); }
      else if (e.isFile()) out.push(full);
    }
  })(dir);
  return out;
}

/** true when every path component matches the on-disk spelling (catches case-only refs). */
function existsExactCase(abs) {
  const parsed = path.parse(abs);
  const parts = path.relative(parsed.root, abs).split(path.sep).filter(Boolean);
  let cur = parsed.root;
  for (const part of parts) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return false; }
    if (!names.includes(part)) return false;
    cur = path.join(cur, part);
  }
  return true;
}

function parseArgs(argv, spec) {
  const valueFlags = new Set(spec.values || []);
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (valueFlags.has(key)) {
        if (eq !== -1) out.flags[key] = a.slice(eq + 1);
        else { out.flags[key] = argv[i + 1]; i++; }
      } else out.flags[key] = true;
    } else out._.push(a);
  }
  return out;
}

const VALUE_FLAGS = [
  'from', 'to', 'ids', 'plugin', 'os', 'out', 'pack', 'manufacturer', 'author', 'manifest',
  'root', 'scope', 'size-budget-mb', 'user-data', 'ext', 'version',
];

// ---------------------------------------------------------------------------
// schema + vocabulary loading
// ---------------------------------------------------------------------------

function resolveFramework(ctx, rel) {
  const candidates = [];
  if (ctx && ctx.root) candidates.push(path.join(ctx.root, rel));
  candidates.push(path.join(__dirname, '..', rel));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`framework file not found: ${rel}`);
}

function loadSchema(ctx) { return readJsonFile(resolveFramework(ctx, path.join('schemas', 'apc-preset.schema.json'))); }

function loadVocab(ctx) {
  const v = readJsonFile(resolveFramework(ctx, path.join('schemas', 'pmx1-vocabulary.json')));
  const idx = {
    raw: v,
    categories: new Map(v.categories.map((c) => [c.slug, c])),
    axes: new Map(v.axes.map((a) => [a.key, a])),
    moods: new Map(v.moods.map((m) => [m.slug, m])),
    genres: new Map(v.genres.map((g) => [g.slug, g])),
    articulations: new Set(v.articulations.map((a) => a.slug)),
    temporal: v.temporal,
    axisWordOwners: new Map(),
  };
  for (const a of v.axes) {
    for (const w of a.words) {
      if (!idx.axisWordOwners.has(w)) idx.axisWordOwners.set(w, []);
      idx.axisWordOwners.get(w).push(a.key);
    }
  }
  return idx;
}

/** Resolve a user string against a slug/label/alias table. -> {slug, canonical} | null */
function canonicalize(value, entries) {
  if (typeof value !== 'string') return null;
  const direct = entries.get(value);
  if (direct) return { slug: value, canonical: true };
  const norm = (s) => s.trim().toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/\s*\/\s*/g, ' ').replace(/[\s_]+/g, '-');
  const want = norm(value);
  for (const [slug, e] of entries) {
    const names = [slug, e.label, ...(e.aliases || [])].filter(Boolean);
    if (names.some((n) => norm(n) === want)) return { slug, canonical: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// minimal JSON Schema validator (subset used by apc-preset.schema.json)
// ---------------------------------------------------------------------------

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(v, t) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
}

function validateSchema(value, schema, at, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push({ at, message: `expected ${types.join('|')}, got ${typeOf(value)}` });
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ at, message: `must be ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => e === value)) {
    errors.push({ at, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ at, message: `must have at least ${schema.minLength} character(s)` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ at, message: `does not match pattern ${schema.pattern}` });
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ at, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ at, message: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateSchema(item, schema.items, `${at}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ at, message: `missing required property "${key}"` });
    }
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      const here = at ? `${at}.${key}` : key;
      if (Object.prototype.hasOwnProperty.call(props, key)) validateSchema(v, props[key], here, errors);
      else if (schema.additionalProperties === false) errors.push({ at: here, message: 'unexpected property' });
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateSchema(v, schema.additionalProperties, here, errors);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// issue reporting
// ---------------------------------------------------------------------------

class Report {
  constructor() { this.issues = []; }
  add(severity, code, file, message, extra) {
    this.issues.push({ severity, code, file: file || null, message, ...(extra || {}) });
  }
  error(code, file, message, extra) { this.add('error', code, file, message, extra); }
  warn(code, file, message, extra) { this.add('warning', code, file, message, extra); }
  get errors() { return this.issues.filter((i) => i.severity === 'error'); }
  get warnings() { return this.issues.filter((i) => i.severity === 'warning'); }
}

// ---------------------------------------------------------------------------
// discovery
// ---------------------------------------------------------------------------

function isAssetCandidateName(name) {
  if (name.startsWith('.')) return false;
  if (NON_ASSET_NAMES.has(name)) return false;
  if (/\.(tmp|promote-bak)-\d+$/.test(name)) return false;
  return !NON_ASSET_EXT.has(path.extname(name).toLowerCase());
}

/** Locate the presets directory from an app root, a presets dir or a pack dir. */
function resolveRoots(arg) {
  const abs = path.resolve(arg);
  if (fs.existsSync(path.join(abs, 'presets')) && fs.statSync(path.join(abs, 'presets')).isDirectory()) {
    return { appRoot: abs, presetsDir: path.join(abs, 'presets') };
  }
  if (path.basename(abs) === 'presets') return { appRoot: path.dirname(abs), presetsDir: abs };
  return null;
}

function isPackDir(dir) {
  if (fs.existsSync(path.join(dir, 'pack.json'))) return true;
  for (const k of Object.keys(KIND_DIRS)) {
    const p = path.join(dir, k);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return true;
  }
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  return entries.some((e) => e.isFile() && isAssetCandidateName(e.name));
}

function findPacks(dir) {
  if (isPackDir(dir)) return [dir];
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || e.name.startsWith('.') || IGNORED_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (isPackDir(p)) out.push(p);
  }
  return out;
}

function parseAssetFile(abs) {
  const st = fs.statSync(abs);
  const entry = { abs, size: st.size, mtimeMs: Math.floor(st.mtimeMs), doc: null, parseError: null, raw: null };
  try {
    entry.raw = fs.readFileSync(abs);
    entry.doc = JSON.parse(entry.raw.toString('utf8').replace(/^﻿/, ''));
  } catch (e) { entry.parseError = e.message; }
  return entry;
}

function scanPack(packDir) {
  const pack = {
    dir: packDir, name: path.basename(packDir), manifest: null, manifestError: null, hasManifest: false,
    layout: 'empty', assets: [], samples: [], strayDirs: [],
  };
  const mf = path.join(packDir, 'pack.json');
  if (fs.existsSync(mf)) {
    pack.hasManifest = true;
    try { pack.manifest = readJsonFile(mf); } catch (e) { pack.manifestError = e.message; }
  }
  let typed = 0; let flat = 0;
  const entries = fs.readdirSync(packDir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(packDir, e.name);
    if (e.isFile() && isAssetCandidateName(e.name)) {
      const a = parseAssetFile(full); a.folderKind = 'preset'; a.layoutSlot = 'flat'; pack.assets.push(a); flat++;
    } else if (e.isDirectory()) {
      if (Object.prototype.hasOwnProperty.call(KIND_DIRS, e.name)) {
        for (const f of walkFiles(full)) {
          if (!isAssetCandidateName(path.basename(f))) continue;
          const a = parseAssetFile(f); a.folderKind = KIND_DIRS[e.name]; a.layoutSlot = 'typed'; pack.assets.push(a); typed++;
        }
      } else if (e.name === 'samples') {
        for (const f of walkFiles(full, { skipDirs: new Set() })) pack.samples.push({ abs: f, rel: posix(path.relative(packDir, f)), size: fs.statSync(f).size });
      } else if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) pack.strayDirs.push(e.name);
    }
  }
  pack.layout = typed && flat ? 'mixed' : typed ? 'typed' : flat ? 'flat' : 'empty';
  for (const a of pack.assets) { a.rel = posix(path.relative(packDir, a.abs)); }
  return pack;
}

/** id -> {abs, kind, pack} for packs that are part of the tree but not being linted. */
function buildContextTable(presetsDir, excludeDirs) {
  const table = new Map();
  if (!presetsDir || !fs.existsSync(presetsDir)) return table;
  for (const p of findPacks(presetsDir)) {
    if (excludeDirs.has(p)) continue;
    const pack = scanPack(p);
    for (const a of pack.assets) {
      if (a.doc && typeof a.doc.id === 'string') table.set(a.doc.id, { abs: a.abs, kind: a.doc.kind, pack: pack.name, rel: a.rel });
    }
  }
  return table;
}

// ---------------------------------------------------------------------------
// parameter manifest (released / current)
// ---------------------------------------------------------------------------

function loadManifest(file) {
  const m = readJsonFile(file);
  if (!Array.isArray(m.params)) throw new Error(`manifest ${file}: "params" array missing`);
  const byId = new Map();
  for (const p of m.params) {
    if (!p || typeof p.id !== 'string') throw new Error(`manifest ${file}: param without id`);
    byId.set(p.id, p);
  }
  return { raw: m, params: m.params, byId };
}

/** Append-only rule (X-01, P-07). released/current: arrays of {id, type, choices?}. */
function checkAppendOnly(released, current) {
  const violations = [];
  const cur = new Map(current.map((p) => [p.id, p]));
  for (const r of released) {
    const c = cur.get(r.id);
    if (!c) { violations.push({ id: r.id, reason: 'removed or renamed (parameter ids are immutable)' }); continue; }
    if ((r.type || 'float') !== (c.type || 'float')) {
      violations.push({ id: r.id, reason: `type changed ${r.type} -> ${c.type}` });
      continue;
    }
    if (r.type === 'choice') {
      const rc = r.choices || []; const cc = c.choices || [];
      for (let i = 0; i < rc.length; i++) {
        if (cc[i] !== rc[i]) {
          violations.push({ id: r.id, reason: cc.includes(rc[i]) ? `choice "${rc[i]}" reordered (index ${i})` : `choice "${rc[i]}" removed or renamed` });
          break;
        }
      }
    }
  }
  return violations;
}

/**
 * Defaults-first restore (P-07), JS twin of apc::applyDefaultsFirst.
 * Every declared parameter starts at its default; the file's params are then
 * applied. Unknown keys are preserved, invalid values fall back to the default.
 */
function resolveDefaultsFirst(manifestParams, fileParams) {
  const values = {}; const report = { applied: [], defaulted: [], unknown: {}, invalid: [], clamped: [] };
  const given = fileParams && typeof fileParams === 'object' ? fileParams : {};
  const declared = new Set();
  for (const p of manifestParams) {
    declared.add(p.id);
    values[p.id] = p.default;
    if (!Object.prototype.hasOwnProperty.call(given, p.id)) { report.defaulted.push(p.id); continue; }
    const v = given[p.id];
    const kind = p.type || 'float';
    if (kind === 'choice') {
      if (typeof v === 'string' && (p.choices || []).includes(v)) { values[p.id] = v; report.applied.push(p.id); }
      else { report.invalid.push({ id: p.id, reason: typeof v === 'string' ? `unknown choice label "${v}"` : 'choice must be a label string, not an index' }); }
    } else if (kind === 'bool') {
      if (typeof v === 'boolean') { values[p.id] = v; report.applied.push(p.id); }
      else report.invalid.push({ id: p.id, reason: 'expected boolean' });
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      let x = kind === 'int' ? Math.round(v) : v;
      if (p.min !== undefined && x < p.min) { x = p.min; report.clamped.push(p.id); }
      if (p.max !== undefined && x > p.max) { x = p.max; report.clamped.push(p.id); }
      values[p.id] = x; report.applied.push(p.id);
    } else report.invalid.push({ id: p.id, reason: 'expected number' });
  }
  for (const [k, v] of Object.entries(given)) if (!declared.has(k)) report.unknown[k] = v;
  return { values, report };
}

// ---------------------------------------------------------------------------
// lint
// ---------------------------------------------------------------------------

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CHOICE_KEY_HINT = /(_wave|_waveform|_mode|_type|_shape|_algo|_algorithm|_choice|_style)$/;

function parseSchemaVersion(s) {
  const m = /^apc-preset\/(\d+)\.(\d+)$/.exec(String(s || ''));
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

function lintMeta(doc, file, ctx2, rep) {
  const { vocab, factory } = ctx2;
  const S = factory ? 'error' : 'warning';
  const sev = (code, msg) => rep.add(S, code, file, msg);
  const meta = doc.meta && typeof doc.meta === 'object' && !Array.isArray(doc.meta) ? doc.meta : {};
  const isInit = meta.role === 'init';
  const kind = doc.kind;

  // category
  if (meta.category !== undefined && meta.category !== null) {
    const c = canonicalize(meta.category, vocab.categories);
    if (!c) sev('category-invalid', `meta.category "${meta.category}" is not in the PMX/1 vocabulary (use a slug, e.g. "bass")`);
    else if (!c.canonical) rep.warn('vocab-noncanonical', file, `meta.category "${meta.category}" should be the slug "${c.slug}"`);
  }
  if (typeof meta.subcategory === 'string' && meta.subcategory) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.subcategory)) {
      rep.warn('subcategory-format', file, `meta.subcategory "${meta.subcategory}" should be lowercase and "-"-joined`);
    } else {
      const cat = typeof meta.category === 'string' ? canonicalize(meta.category, vocab.categories) : null;
      const known = cat ? vocab.categories.get(cat.slug).subcategories : null;
      if (known && !known.includes(meta.subcategory)) rep.warn('subcategory-unknown', file, `meta.subcategory "${meta.subcategory}" is not in the curated list for "${cat.slug}"`);
    }
  }
  // articulation
  if (typeof meta.articulation === 'string') {
    if (!vocab.articulations.has(meta.articulation)) {
      if (vocab.articulations.has(meta.articulation.toLowerCase())) rep.warn('vocab-noncanonical', file, `meta.articulation "${meta.articulation}" should be "${meta.articulation.toLowerCase()}"`);
      else sev('articulation-invalid', `meta.articulation "${meta.articulation}" is not in the PMX/1 vocabulary`);
    }
  }
  // axes
  const asserted = new Map(); // axis -> Set(words)
  const assert = (axis, w) => { if (!asserted.has(axis)) asserted.set(axis, new Set()); asserted.get(axis).add(w); };
  const axes = meta.axes && typeof meta.axes === 'object' && !Array.isArray(meta.axes) ? meta.axes : {};
  for (const [key, val] of Object.entries(axes)) {
    const axis = vocab.axes.get(key);
    if (!axis) { sev('axis-unknown', `meta.axes."${key}" is not a PMX/1 axis`); continue; }
    const words = Array.isArray(val) ? val : [val];
    if (Array.isArray(val)) sev('axis-multi-value', `meta.axes.${key} must hold exactly one word, found ${val.length}`);
    for (const w of words) {
      if (typeof w !== 'string') { sev('axis-word-invalid', `meta.axes.${key} word must be a string`); continue; }
      let slug = w;
      if (!axis.words.includes(w)) {
        if (axis.words.includes(w.toLowerCase())) { rep.warn('vocab-noncanonical', file, `meta.axes.${key} "${w}" should be "${w.toLowerCase()}"`); slug = w.toLowerCase(); }
        else { sev('axis-word-invalid', `meta.axes.${key} "${w}" is not one of: ${axis.words.join(', ')}`); continue; }
      }
      assert(key, slug);
    }
  }
  // temporal
  const temporal = meta.temporal && typeof meta.temporal === 'object' ? meta.temporal : {};
  for (const [key, w] of Object.entries(temporal)) {
    const t = vocab.temporal[key];
    if (!t) { sev('temporal-unknown', `meta.temporal."${key}" is not a PMX/1 temporal field`); continue; }
    if (typeof w !== 'string' || !t.words.includes(w)) sev('temporal-word-invalid', `meta.temporal.${key} "${w}" is not one of: ${t.words.join(', ')}`);
  }
  // moods
  const moodSlugs = [];
  if (meta.moods !== undefined) {
    if (!Array.isArray(meta.moods)) sev('moods-type', 'meta.moods must be an array');
    else {
      for (const m of meta.moods) {
        const c = canonicalize(m, vocab.moods);
        if (!c) sev('mood-invalid', `mood "${m}" is not in the PMX/1 vocabulary`);
        else {
          if (!c.canonical) rep.warn('vocab-noncanonical', file, `mood "${m}" should be the slug "${c.slug}"`);
          if (moodSlugs.includes(c.slug)) rep.warn('mood-duplicate', file, `mood "${c.slug}" listed twice`);
          else moodSlugs.push(c.slug);
        }
      }
      if (meta.moods.length > 2) rep.error('moods-count', file, `at most 2 moods allowed, found ${meta.moods.length}`);
    }
  }
  // genre
  if (meta.genre !== undefined && meta.genre !== null) {
    for (const g of Array.isArray(meta.genre) ? meta.genre : [meta.genre]) {
      const c = canonicalize(g, vocab.genres);
      if (!c) rep.warn('genre-unknown', file, `genre "${g}" is not in the PMX/1 vocabulary (per-product extensions are allowed)`);
      else if (!c.canonical) rep.warn('vocab-noncanonical', file, `genre "${g}" should be the slug "${c.slug}"`);
    }
  }
  // tags
  if (meta.tags !== undefined) {
    if (!Array.isArray(meta.tags)) sev('tags-type', 'meta.tags must be an array');
    else {
      if (meta.tags.length > 8) rep.error('tags-too-many', file, `at most 8 tags allowed, found ${meta.tags.length}`);
      const seen = new Set();
      for (const t of meta.tags) {
        if (typeof t !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) sev('tag-format', `tag ${JSON.stringify(t)} must be lowercase and "-"-joined`);
        else {
          if (seen.has(t)) rep.warn('tag-duplicate', file, `tag "${t}" listed twice`);
          seen.add(t);
          const owners = vocab.axisWordOwners.get(t);
          if (owners && owners.length === 1) assert(owners[0], t);
        }
      }
    }
  }
  // sequence/kit specifics
  if (meta.swing_pct !== undefined && meta.swing_pct !== null && typeof meta.swing_pct === 'number') {
    const r = vocab.raw.swing_pct;
    if (meta.swing_pct < r.min || meta.swing_pct > r.max) rep.warn('swing-range', file, `meta.swing_pct ${meta.swing_pct} outside ${r.min}-${r.max}`);
  }
  if (typeof meta.length_bars === 'number' && !vocab.raw.length_bars.includes(meta.length_bars)) {
    rep.warn('length-bars', file, `meta.length_bars ${meta.length_bars} is not one of ${vocab.raw.length_bars.join('/')}`);
  }
  if (typeof meta.feel === 'string' && !vocab.raw.feels.includes(meta.feel)) rep.warn('feel-unknown', file, `meta.feel "${meta.feel}" is not one of ${vocab.raw.feels.join('/')}`);

  // contradictions
  for (const c of vocab.raw.contradictions.axis) {
    const set = asserted.get(c.axis);
    if (set && set.has(c.words[0]) && set.has(c.words[1])) rep.error('contradiction', file, `contradictory ${c.axis} words: "${c.words[0]}" + "${c.words[1]}"`);
  }
  for (const [a, b] of vocab.raw.contradictions.mood) {
    if (moodSlugs.includes(a) && moodSlugs.includes(b)) rep.error('contradiction', file, `contradictory moods: "${a}" + "${b}"`);
  }

  // completeness (factory content only; INIT is exempt)
  if (factory && !isInit) {
    const need = [];
    if (kind === 'sound' || kind === 'preset') {
      if (!meta.category) rep.error('category-missing', file, 'meta.category is required for factory content');
      const miss = vocab.raw.rules.mandatory_axes_for_factory.filter((k) => !(k in axes));
      if (miss.length) rep.error('axes-incomplete', file, `factory content needs all 6 mandatory axes; missing: ${miss.join(', ')}`);
      need.push('moods', 'desc');
    } else if (kind === 'patch') {
      if (!meta.category) rep.error('category-missing', file, 'meta.category is required for factory content');
      need.push('moods', 'desc');
    } else if (kind === 'kit') {
      if (!meta.category) rep.error('category-missing', file, 'meta.category is required for factory content');
      need.push('desc');
    } else if (kind === 'sequence') need.push('desc');
    if (need.includes('moods') && !(Array.isArray(meta.moods) && meta.moods.length >= 1)) rep.error('moods-count', file, 'factory content needs 1-2 moods');
    if (need.includes('desc') && !(typeof meta.desc === 'string' && meta.desc.trim())) rep.error('desc-missing', file, 'factory content needs a one-line meta.desc');
  }
  if (typeof meta.desc === 'string' && (meta.desc.includes('\n') || meta.desc.length > 200)) {
    rep.warn('desc-long', file, 'meta.desc should be a single short line (<= 200 chars)');
  }
}

function lintParamBlock(block, where, file, ctx2, rep) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return;
  const { factory, manifest } = ctx2;
  const S = factory ? 'error' : 'warning';
  const numerics = [];
  let unitKeys = 0;
  for (const [k, v] of Object.entries(block)) {
    if (!/^[a-z][a-z0-9_]*$/.test(k)) rep.add(S, 'param-id-format', file, `${where}."${k}" is not a lowercase snake_case parameter id (X-01)`);
    const mp = manifest && where === 'params' ? manifest.byId.get(k) : null;
    if (manifest && where === 'params' && !mp) rep.add(S, 'param-unknown', file, `params."${k}" is not in the parameter manifest`);
    if (mp && mp.type === 'choice') {
      if (typeof v !== 'string') rep.error('choice-not-string', file, `params.${k} is a choice parameter and must store its label string, not ${JSON.stringify(v)} (P-04)`);
      else if (!(mp.choices || []).includes(v)) rep.add(S, 'choice-unknown-label', file, `params.${k} "${v}" is not a declared choice`);
      continue;
    }
    if (mp && mp.type === 'bool') { if (typeof v !== 'boolean') rep.error('bool-not-boolean', file, `params.${k} must be a boolean`); continue; }
    if (mp && (mp.type === 'float' || mp.type === 'int' || !mp.type)) {
      if (typeof v !== 'number') rep.error('param-not-number', file, `params.${k} must be a number in real-world units`);
      else if ((mp.min !== undefined && v < mp.min) || (mp.max !== undefined && v > mp.max)) rep.warn('param-out-of-range', file, `params.${k}=${v} outside declared range ${mp.min}..${mp.max} (will clamp on load)`);
    }
    if (!mp && typeof v === 'number' && CHOICE_KEY_HINT.test(k)) {
      rep.warn('choice-as-number', file, `${where}.${k}=${v} looks like a choice index; choice parameters store their label string (P-04)`);
    }
    if (typeof v === 'number') {
      numerics.push(v);
      if (/_hz$/.test(k)) { unitKeys++; if (v < 0) rep.error('unit-negative-hz', file, `${where}.${k}=${v}: frequency cannot be negative`); else if (v <= 1) rep.warn('normalized-looking', file, `${where}.${k}=${v} looks like a normalized 0..1 value but the key says Hz (values are real-world units, P-04)`); }
      else if (/_db$/.test(k)) { unitKeys++; if (v > 0 && v < 1 && !Number.isInteger(v)) rep.warn('normalized-looking', file, `${where}.${k}=${v} looks like a normalized 0..1 value but the key says dB`); }
      else if (/_(s|ms|st|pct|bpm)$/.test(k)) unitKeys++;
    }
  }
  if (unitKeys > 0 && numerics.length >= 6 && numerics.filter((n) => n >= 0 && n <= 1).length / numerics.length >= 0.9) {
    rep.warn('normalized-looking', file, `${where}: ${numerics.length} numeric values are all within 0..1 although some keys carry units; the file may store normalized values`);
  }
}

/** Resolve one reference. Returns {status, abs?, entry?, via?} */
function resolveReference(refObj, expectedKind, fileEntry, pack, tables, doc) {
  const ref = typeof refObj.ref === 'string' && refObj.ref ? refObj.ref : (typeof refObj.sound_ref === 'string' && refObj.sound_ref ? refObj.sound_ref : null);
  const id = typeof refObj.id === 'string' && refObj.id ? refObj.id : (typeof refObj.sound_id === 'string' && refObj.sound_id ? refObj.sound_id : null);
  const embedded = doc && doc.embedded && typeof doc.embedded === 'object' ? doc.embedded : {};
  if (!ref && !id) return { status: 'empty' };
  let problem = null;
  if (ref) {
    const norm = ref.replace(/\\/g, '/');
    if (norm !== ref) problem = { code: 'ref-separator', message: `reference "${ref}" uses backslashes; use "/"` };
    if (path.isAbsolute(ref) || /^[a-zA-Z]:/.test(ref) || norm.startsWith('/')) return { status: 'absolute', ref };
    const cands = [path.resolve(path.dirname(fileEntry.abs), norm), path.resolve(pack.dir, norm)];
    const inside = cands.filter((c) => isInside(pack.dir, c));
    if (!inside.length) return { status: 'escape', ref };
    for (const c of inside) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        if (!existsExactCase(c)) return { status: 'case', ref, abs: c };
        const entry = tables.byAbs.get(c);
        return { status: 'found', abs: c, entry: entry || null, problem, via: 'path' };
      }
    }
  }
  if (id) {
    const hit = tables.byId.get(id);
    if (hit) return { status: 'rebound', abs: hit.abs, entry: hit, ref, problem };
    if (Object.prototype.hasOwnProperty.call(embedded, id)) return { status: 'embedded', problem };
  }
  return { status: 'missing', ref, id, problem };
}

function lintReferences(doc, entry, pack, tables, ctx2, rep) {
  const S = ctx2.factory ? 'error' : 'warning';
  const file = entry.rel;
  const lists = [];
  if (doc.kind === 'kit' && Array.isArray(doc.slots)) {
    doc.slots.forEach((s, i) => { if (s && typeof s === 'object') lists.push({ where: `slots[${i}]`, obj: s, kind: 'sound' }); });
  }
  if (doc.kind === 'patch') {
    if (Array.isArray(doc.kits)) doc.kits.forEach((s, i) => { if (s && typeof s === 'object') lists.push({ where: `kits[${i}]`, obj: s, kind: 'kit' }); });
    if (Array.isArray(doc.sequences)) doc.sequences.forEach((s, i) => { if (s && typeof s === 'object') lists.push({ where: `sequences[${i}]`, obj: s, kind: 'sequence' }); });
  }
  for (const item of lists) {
    const r = resolveReference(item.obj, item.kind, entry, pack, tables, doc);
    const label = `${item.where} -> ${item.obj.ref || item.obj.sound_ref || item.obj.id || item.obj.sound_id}`;
    if (item.obj.missing === true) rep.warn('ref-flagged-missing', file, `${label}: reference is flagged missing`);
    if (r.problem) rep.warn(r.problem.code, file, `${item.where}: ${r.problem.message}`);
    switch (r.status) {
      case 'empty': break;
      case 'absolute': rep.error('ref-absolute', file, `${label}: absolute reference paths are not portable`); break;
      case 'escape': rep.error('ref-escape', file, `${label}: reference leaves the pack folder`); break;
      case 'case': rep.error('ref-case', file, `${label}: path differs from the on-disk spelling only by case (breaks on case-sensitive systems)`); break;
      case 'found': {
        const e = r.entry;
        if (e && e.doc) {
          if (e.doc.kind !== item.kind) rep.error('ref-kind-mismatch', file, `${label}: expected a ${item.kind}, found a ${e.doc.kind}`);
          const declared = item.obj.id || item.obj.sound_id;
          if (declared && e.doc.id !== declared) rep.warn('ref-id-mismatch', file, `${label}: file id ${e.doc.id} differs from the declared id ${declared}`);
        } else if (!e) rep.warn('ref-untracked', file, `${label}: target is not an apc-preset asset`);
        break;
      }
      case 'rebound': rep.warn('ref-rebound', file, `${label}: path not found, id resolves to ${posix(path.relative(pack.dir, r.abs))} (rewrite the reference on next save)`); break;
      case 'embedded': break;
      default: rep.add(S, 'ref-missing', file, `${label}: reference cannot be resolved (path and id lookup both failed)`);
    }
  }
}

function lintSamples(doc, entry, pack, referencedSamples, ctx2, rep) {
  const S = ctx2.factory ? 'error' : 'warning';
  const file = entry.rel;
  const checkRef = (ref, expectedHash, where, embedded) => {
    const norm = ref.replace(/\\/g, '/');
    if (norm !== ref) rep.warn('ref-separator', file, `${where}: use "/" in sample references`);
    if (path.isAbsolute(ref) || /^[a-zA-Z]:/.test(ref) || norm.startsWith('/')) { rep.error('sample-absolute', file, `${where}: absolute sample paths are not portable`); return; }
    const abs = path.resolve(pack.dir, norm);
    if (!isInside(pack.dir, abs)) { rep.error('sample-escape', file, `${where}: sample reference leaves the pack folder`); return; }
    referencedSamples.add(posix(path.relative(pack.dir, abs)));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      if (embedded) {
        if (expectedHash && sha256Buf(Buffer.from(embedded, 'base64')) !== expectedHash) rep.error('sample-embedded-hash', file, `${where}: embedded body does not match sha256`);
      } else rep.add(S, 'sample-missing', file, `${where}: sample "${ref}" not found and nothing embedded (will show [Missing])`);
      return;
    }
    if (!existsExactCase(abs)) { rep.error('ref-case', file, `${where}: sample path differs from the on-disk spelling only by case`); return; }
    if (expectedHash) {
      const actual = sha256File(abs);
      if (actual !== expectedHash) rep.add(S, 'sample-hash-mismatch', file, `${where}: sha256 of "${ref}" is ${actual.slice(0, 12)}..., file declares ${expectedHash.slice(0, 12)}...`);
    }
  };
  const hashed = new Set();
  if (Array.isArray(doc.samples)) {
    doc.samples.forEach((s, i) => {
      if (s && typeof s.ref === 'string') { hashed.add(s.ref); checkRef(s.ref, typeof s.sha256 === 'string' ? s.sha256 : null, `samples[${i}]`, typeof s.embedded_b64 === 'string' ? s.embedded_b64 : null); }
    });
  }
  if (typeof doc.sample_ref === 'string' && doc.sample_ref) {
    if (!hashed.has(doc.sample_ref)) checkRef(doc.sample_ref, null, 'sample_ref', null);
    if (!hashed.has(doc.sample_ref)) rep.warn('sample-no-hash', file, `sample_ref "${doc.sample_ref}" has no content hash in "samples" (a bare path is fragile inside host chunks)`);
  }
}

function lintStructure(doc, entry, ctx2, rep) {
  const file = entry.rel;
  if (doc.kind === 'kit' && Array.isArray(doc.slots)) {
    const seen = new Set();
    doc.slots.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      if (seen.has(s.slot)) rep.error('slot-duplicate', file, `slots[${i}]: slot ${s.slot} defined twice`);
      seen.add(s.slot);
      if (s.midi_note !== undefined && s.midi_note !== null && (s.midi_note < 0 || s.midi_note > 127)) rep.error('midi-note-range', file, `slots[${i}].midi_note ${s.midi_note} outside 0-127`);
      if (typeof s.pan === 'number' && (s.pan < -1 || s.pan > 1)) rep.warn('pan-range', file, `slots[${i}].pan ${s.pan} outside -1..1`);
    });
  }
  if (doc.kind === 'sequence' && Array.isArray(doc.lanes)) {
    doc.lanes.forEach((l, li) => {
      const seen = new Set();
      (l.steps || []).forEach((st, si) => {
        if (seen.has(st.step)) rep.error('step-duplicate', file, `lanes[${li}].steps[${si}]: step ${st.step} defined twice`);
        seen.add(st.step);
        for (const f of ['velocity', 'prob']) if (typeof st[f] === 'number' && (st[f] < 0 || st[f] > 1)) rep.warn('step-range', file, `lanes[${li}].steps[${si}].${f}=${st[f]} outside 0..1`);
      });
    });
  }
  if (doc.engine !== undefined) {
    rep.warn('engine-in-asset', file, 'the "engine" section belongs to the host chunk only (engine.state_scope=chunk); asset files must not carry it');
  }
}

function lintPackManifest(pack, ctx2, rep) {
  const file = 'pack.json';
  if (NON_FACTORY_PACKS.has(pack.name) && !pack.hasManifest) return;
  if (!pack.hasManifest) { rep.add(ctx2.factory ? 'error' : 'warning', 'pack-manifest-missing', `${pack.name}/${file}`, 'pack.json is missing (packs are folders + manifest, P-13)'); return; }
  if (pack.manifestError) { rep.error('pack-manifest-invalid', `${pack.name}/${file}`, `pack.json is not valid JSON: ${pack.manifestError}`); return; }
  const m = pack.manifest; const f = `${pack.name}/${file}`;
  if (!m || typeof m !== 'object' || Array.isArray(m)) { rep.error('pack-manifest-invalid', f, 'pack.json must be an object'); return; }
  if (m.schema !== PACK_STANDARD) rep.error('pack-schema', f, `schema must be "${PACK_STANDARD}"`);
  if (typeof m.name !== 'string' || !m.name) rep.error('pack-name', f, 'name is required');
  else if (m.name !== pack.name && sanitizeFilename(m.name) !== pack.name && m.name.replace(/ /g, '_') !== pack.name) rep.warn('pack-name-folder', f, `pack name "${m.name}" differs from folder "${pack.name}"`);
  if (typeof m.id !== 'string' || !/^pack_[0-9a-fA-F-]{36}$/.test(m.id)) rep.error('pack-id', f, 'id must look like pack_<uuid>');
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) rep.error('pack-version', f, 'version must be semver');
  if (m.app_version_min !== undefined && m.app_version_min !== null && !SEMVER.test(String(m.app_version_min))) rep.error('pack-app-version-min', f, 'app_version_min must be semver');
  if (typeof m.license !== 'string' || !m.license) rep.error('pack-license', f, 'license is required ("factory", an SPDX id or a EULA reference)');
  if (typeof m.plugin !== 'string' || !m.plugin) rep.warn('pack-plugin', f, 'plugin is missing');
  if (!m.author) rep.warn('pack-author', f, 'author is missing');
  if (m.layout !== undefined && m.layout !== 'flat' && m.layout !== 'typed') rep.error('pack-layout', f, 'layout must be "flat" or "typed"');
}

/**
 * Lint a set of packs. opts: {vocab, schema, factory, manifest, plugin: {hierarchy, exts}, budgetMb,
 * contextTable, onlyFiles, packFactory}
 */
function lintPacks(packs, opts, rep) {
  const vocab = opts.vocab;
  const globalIds = new Map(); // id -> first file
  const byId = new Map(opts.contextTable || []);
  const byAbs = new Map();
  for (const p of packs) {
    for (const a of p.assets) {
      if (a.doc && typeof a.doc.id === 'string') byId.set(a.doc.id, { abs: a.abs, kind: a.doc.kind, pack: p.name, rel: a.rel });
      byAbs.set(a.abs, a);
    }
  }
  const tables = { byId, byAbs };

  for (const pack of packs) {
    const factory = opts.factory || (pack.manifest && pack.manifest.license === 'factory');
    const ctx2 = { vocab, factory, manifest: opts.manifest };
    lintPackManifest(pack, ctx2, rep);
    const pfx = (a) => `${pack.name}/${a.rel}`;

    if (pack.layout === 'mixed') rep.error('mixed-layout', pack.name, 'pack mixes flat assets (pack root) with typed sub-folders; never mix them (P-03)');
    if (pack.manifest && (pack.manifest.layout === 'flat' || pack.manifest.layout === 'typed') && pack.layout !== 'empty' && pack.layout !== 'mixed' && pack.manifest.layout !== pack.layout) {
      rep.error('layout-mismatch', pack.name, `pack.json says layout "${pack.manifest.layout}" but files are laid out as "${pack.layout}"`);
    }
    if (opts.plugin && pack.layout !== 'empty' && pack.layout !== 'mixed' && opts.plugin.hierarchy !== pack.layout) {
      rep.error('hierarchy-mismatch', pack.name, `plugin option preset.hierarchy is "${opts.plugin.hierarchy}" but pack layout is "${pack.layout}"`);
    }
    for (const d of pack.strayDirs) rep.warn('stray-dir', `${pack.name}/${d}`, `unexpected folder "${d}" (expected sounds/kits/sequences/patches/samples)`);

    const names = new Map(); const fileLower = new Map();
    const referencedSamples = new Set();
    for (const a of pack.assets) {
      const file = pfx(a);
      a.reportFile = file;
      const sub = new Report();
      const entryForRep = { ...a, rel: file };
      lintOneAsset(a, entryForRep, pack, tables, ctx2, opts, sub, referencedSamples);
      for (const i of sub.issues) rep.issues.push(i);

      // case-insensitive filename collisions
      const lower = a.rel.toLowerCase();
      if (fileLower.has(lower) && fileLower.get(lower) !== a.rel) rep.error('filename-case-collision', file, `differs only by case from ${fileLower.get(lower)}`);
      fileLower.set(lower, a.rel);

      if (a.doc && typeof a.doc.name === 'string' && typeof a.doc.kind === 'string') {
        const key = `${a.doc.kind}|${a.doc.name.trim().toLowerCase()}`;
        if (names.has(key)) rep.add(factory ? 'error' : 'warning', 'name-duplicate', file, `display name "${a.doc.name}" is already used by ${names.get(key)} in this pack`);
        else names.set(key, a.rel);
      }
      if (a.doc && typeof a.doc.id === 'string') {
        if (globalIds.has(a.doc.id)) rep.error('id-duplicate', file, `id ${a.doc.id} is also used by ${globalIds.get(a.doc.id)} (copies must get a fresh id)`);
        else globalIds.set(a.doc.id, file);
      }
    }
    // orphan samples + size budget
    let total = 0;
    for (const s of pack.samples) {
      total += s.size;
      if (!referencedSamples.has(s.rel)) rep.warn('sample-orphan', `${pack.name}/${s.rel}`, 'sample is not referenced by any asset (pack export bundles referenced samples only)');
    }
    const budget = (opts.budgetMb || DEFAULT_SIZE_BUDGET_MB) * 1024 * 1024;
    if (total > budget) rep.warn('pack-size-budget', pack.name, `samples total ${(total / 1048576).toFixed(1)} MB, over the ${(budget / 1048576).toFixed(0)} MB budget`);
  }
  return rep;
}

function lintOneAsset(a, e, pack, tables, ctx2, opts, rep, referencedSamples) {
  const file = e.rel;
  if (a.parseError) { rep.error('json-invalid', file, `not valid JSON: ${a.parseError}`); return; }
  const doc = a.doc;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { rep.error('json-invalid', file, 'asset must be a JSON object'); return; }

  // schema version check first (clear message), then structure
  const ver = parseSchemaVersion(doc.schema);
  const structural = [];
  if (!ver) rep.error('schema-version', file, `schema must be "${STANDARD}", found ${JSON.stringify(doc.schema)}`);
  else if (ver.major !== 1) rep.error('schema-version', file, `unsupported schema major version ${ver.major} (this tooling understands apc-preset/1.x)`);
  else if (ver.minor > 0) rep.warn('schema-newer-minor', file, `schema ${doc.schema} is newer than 1.0; fields this tooling does not know are ignored (defaults-first load still works)`);
  validateSchema(doc, opts.schema, '', structural);
  for (const s of structural) {
    if (s.at === 'schema' && ver) continue; // reported above with a clearer message
    rep.error('schema', file, `${s.at || '(root)'}: ${s.message}`);
  }
  if (!ver) return;

  // kind vs location
  if (typeof doc.kind === 'string') {
    if (a.layoutSlot === 'typed' && doc.kind !== a.folderKind) rep.error('kind-folder-mismatch', file, `kind "${doc.kind}" does not belong in the "${DIR_OF_KIND[a.folderKind]}" folder`);
    if (a.layoutSlot === 'flat' && pack.layout === 'flat' && doc.kind !== 'preset') rep.error('kind-folder-mismatch', file, `flat packs hold kind "preset" only, found "${doc.kind}"`);
    if (a.layoutSlot === 'typed' && doc.kind === 'preset') rep.error('kind-folder-mismatch', file, 'kind "preset" is flat-mode only');
    const prefix = KIND_PREFIX[doc.kind];
    if (prefix && typeof doc.id === 'string' && !doc.id.startsWith(prefix + '_')) rep.error('id-prefix-kind', file, `id "${doc.id}" must start with "${prefix}_" for kind "${doc.kind}"`);
    if (opts.plugin && opts.plugin.exts && opts.plugin.exts[doc.kind]) {
      const want = opts.plugin.exts[doc.kind];
      if (path.extname(a.abs).toLowerCase() !== want.toLowerCase()) rep.warn('ext-mismatch', file, `extension should be "${want}" for kind "${doc.kind}"`);
    } else if (pack.manifest && pack.manifest.extensions && pack.manifest.extensions[doc.kind]) {
      const want = pack.manifest.extensions[doc.kind];
      if (path.extname(a.abs).toLowerCase() !== String(want).toLowerCase()) rep.warn('ext-mismatch', file, `extension should be "${want}" for kind "${doc.kind}" (pack.json extensions)`);
    }
  }

  // filename (P-06)
  const base = path.basename(a.abs, path.extname(a.abs));
  if (sanitizeFilename(base) !== base) rep.error('filename-unsafe', file, `filename "${base}" contains illegal characters or reserved names; sanitized form is "${sanitizeFilename(base)}"`);
  if (typeof doc.name === 'string') {
    const exp = sanitizeFilename(doc.name);
    if (base !== exp && base !== exp.replace(/ /g, '_')) rep.warn('filename-name-mismatch', file, `filename "${base}" does not match the sanitized display name "${exp}"`);
  }

  lintMeta(doc, file, ctx2, rep);
  lintParamBlock(doc.params, 'params', file, ctx2, rep);
  lintParamBlock(doc.global_fx, 'global_fx', file, ctx2, rep);
  lintParamBlock(doc.kit_master, 'kit_master', file, ctx2, rep);
  lintStructure(doc, e, ctx2, rep);
  lintReferences(doc, e, pack, tables, ctx2, rep);
  lintSamples(doc, e, pack, referencedSamples, ctx2, rep);
}

// ---------------------------------------------------------------------------
// plugin standards resolution (init / validate --plugin)
// ---------------------------------------------------------------------------

function readPluginStandards(ctx, pluginName) {
  const std = require('./apc-standards.js');
  let registry;
  try { registry = std.loadRegistry(ctx.root); } catch { registry = std.loadRegistry(path.join(__dirname, '..')); }
  const pluginDir = ctx.pluginPath(pluginName);
  const statusFile = path.join(pluginDir, 'status.json');
  if (!fs.existsSync(statusFile)) throw new Error(`status.json not found for plugin "${pluginName}": ${statusFile}`);
  const status = readJsonFile(statusFile);
  let config = {};
  try { config = ctx.readConfig() || {}; } catch { config = {}; }
  const eff = std.resolveEffective(registry, config.standards || {}, status.standards || {});
  const get = (id) => (eff[id] ? eff[id].value : undefined);
  return { std, registry, pluginDir, status, config, eff, get };
}

function pluginPresetConfig(info) {
  const hierarchy = info.get('preset.hierarchy') || 'typed';
  const exts = {};
  const missing = [];
  const kinds = hierarchy === 'flat' ? ['preset'] : ['sound', 'kit', 'sequence', 'patch'];
  for (const k of kinds) {
    const v = info.get(EXT_OPTION[k]);
    if (typeof v !== 'string' || !v.trim()) { missing.push(EXT_OPTION[k]); continue; }
    const ext = v.trim().startsWith('.') ? v.trim() : `.${v.trim()}`;
    if (!/^\.[A-Za-z0-9]{1,16}$/.test(ext)) throw new Error(`${EXT_OPTION[k]} "${v}" is not a valid file extension`);
    exts[k] = ext;
  }
  return { hierarchy, exts, missing };
}

// ---------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------

function emit(json, payload, textLines) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else for (const l of textLines) console.log(l);
}

function formatIssue(i) {
  const tag = i.severity === 'error' ? 'ERROR  ' : 'warning';
  return `${tag} [${i.code}] ${i.file ? i.file + ': ' : ''}${i.message}`;
}

// ---------------------------------------------------------------------------
// presets validate
// ---------------------------------------------------------------------------

function collectTargets(arg) {
  const abs = path.resolve(arg);
  if (!fs.existsSync(abs)) throw new Error(`path not found: ${abs}`);
  const st = fs.statSync(abs);
  if (st.isFile()) {
    let dir = path.dirname(abs);
    let packDir = null;
    for (let i = 0; i < 3; i++) {
      if (fs.existsSync(path.join(dir, 'pack.json'))) { packDir = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!packDir) {
      packDir = path.dirname(abs);
      if (Object.prototype.hasOwnProperty.call(KIND_DIRS, path.basename(packDir))) packDir = path.dirname(packDir);
    }
    return { packs: [packDir], onlyFile: abs, searchRoot: packDir };
  }
  const roots = resolveRoots(abs);
  const base = roots ? roots.presetsDir : abs;
  const packs = findPacks(base);
  return { packs, onlyFile: null, searchRoot: base };
}

function cmdValidate(argv, ctx) {
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  const target = a._[0];
  if (!target) { console.error('Usage: apc presets validate <dir|file> [--factory] [--plugin <Name>] [--manifest <file>] [--strict] [--size-budget-mb N] [--json]'); return 2; }
  let t;
  try { t = collectTargets(target); } catch (e) { console.error(e.message); return 2; }
  const rep = new Report();
  let schema; let vocab;
  try { schema = loadSchema(ctx); vocab = loadVocab(ctx); } catch (e) { console.error(e.message); return 2; }
  let manifest = null;
  if (a.flags.manifest) { try { manifest = loadManifest(path.resolve(a.flags.manifest)); } catch (e) { console.error(e.message); return 2; } }
  let plugin = null;
  if (a.flags.plugin) {
    try {
      const info = readPluginStandards(ctx, a.flags.plugin);
      const cfg = pluginPresetConfig(info);
      plugin = { hierarchy: cfg.hierarchy, exts: cfg.exts };
    } catch (e) { console.error(e.message); return 2; }
  }

  const packs = t.packs.map(scanPack);
  const parent = path.dirname(t.packs[0] || t.searchRoot);
  const contextTable = path.basename(parent) === 'presets' ? buildContextTable(parent, new Set(t.packs)) : new Map();
  lintPacks(packs, {
    vocab, schema, factory: !!a.flags.factory, manifest, plugin,
    budgetMb: a.flags['size-budget-mb'] ? Number(a.flags['size-budget-mb']) : undefined, contextTable,
  }, rep);
  if (!packs.length) rep.warn('no-packs', null, `no packs or assets found under ${t.searchRoot}`);

  let issues = rep.issues;
  if (t.onlyFile) {
    const rel = path.relative(packs[0].dir, t.onlyFile).split(path.sep).join('/');
    const want = `${packs[0].name}/${rel}`;
    issues = issues.filter((i) => i.file === want);
  }
  const strict = !!a.flags.strict;
  const errors = issues.filter((i) => i.severity === 'error').length + (strict ? issues.filter((i) => i.severity === 'warning').length : 0);
  const files = packs.reduce((n, p) => n + p.assets.length, 0);
  const payload = {
    ok: errors === 0,
    target: path.resolve(target),
    packs: packs.map((p) => ({ name: p.name, layout: p.layout, assets: p.assets.length, samples: p.samples.length })),
    files, errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warning').length,
    issues,
  };
  const lines = issues.map(formatIssue);
  lines.push(`${payload.ok ? 'OK' : 'FAILED'}: ${files} asset(s) in ${packs.length} pack(s), ${payload.errors} error(s), ${payload.warnings} warning(s)${strict ? ' (strict)' : ''}`);
  emit(json, payload, lines);
  return payload.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// presets index
// ---------------------------------------------------------------------------

function readUserData(appRoot, override, warnings) {
  const file = override ? path.resolve(override) : path.join(appRoot, 'user-data.json');
  if (!fs.existsSync(file)) return { file, assets: {} };
  try {
    const d = readJsonFile(file);
    return { file, assets: d && typeof d.assets === 'object' && d.assets ? d.assets : {} };
  } catch (e) {
    warnings.push({ code: 'user-data-invalid', message: `${file}: ${e.message}` });
    return { file, assets: {} };
  }
}

function buildIndex(appRoot, presetsDir, opts = {}) {
  const indexFile = path.join(appRoot, 'cache', '_index.json');
  const warnings = [];
  let old = new Map();
  if (!opts.rebuild && fs.existsSync(indexFile)) {
    try {
      const prev = readJsonFile(indexFile);
      if (prev && prev.schema === INDEX_STANDARD && Array.isArray(prev.rows)) old = new Map(prev.rows.map((r) => [r.path, r]));
    } catch { /* disposable: rebuild */ }
  }
  const userData = readUserData(appRoot, opts.userData, warnings);
  const rows = []; const errors = [];
  const stats = { scanned: 0, reused: 0, reparsed: 0, removed: 0, orphan_user_data: 0 };
  const seenPaths = new Set();
  for (const packDir of findPacks(presetsDir)) {
    const packName = path.basename(packDir);
    const files = [];
    for (const e of fs.readdirSync(packDir, { withFileTypes: true })) {
      const full = path.join(packDir, e.name);
      if (e.isFile() && isAssetCandidateName(e.name)) files.push(full);
      else if (e.isDirectory() && Object.prototype.hasOwnProperty.call(KIND_DIRS, e.name)) {
        for (const f of walkFiles(full)) if (isAssetCandidateName(path.basename(f))) files.push(f);
      }
    }
    for (const f of files) {
      stats.scanned++;
      const rel = posix(path.relative(presetsDir, f));
      seenPaths.add(rel);
      const st = fs.statSync(f);
      const mtime = Math.floor(st.mtimeMs);
      const prev = old.get(rel);
      let row;
      if (prev && prev.mtime === mtime && prev.size === st.size) { row = { ...prev }; stats.reused++; }
      else {
        let raw; let doc;
        try { raw = fs.readFileSync(f); doc = JSON.parse(raw.toString('utf8').replace(/^﻿/, '')); }
        catch (e) { errors.push({ path: rel, message: e.message }); continue; }
        if (!doc || typeof doc.schema !== 'string' || !doc.schema.startsWith('apc-preset/') || typeof doc.id !== 'string') {
          errors.push({ path: rel, message: 'not an apc-preset asset (missing schema/id)' }); continue;
        }
        row = {
          id: doc.id, kind: doc.kind, name: doc.name, pack: packName, path: rel,
          meta: doc.meta && typeof doc.meta === 'object' ? doc.meta : {},
          author: typeof doc.author === 'string' ? doc.author : '',
          mtime, size: st.size, hash: sha256Buf(raw),
        };
        stats.reparsed++;
      }
      rows.push(row);
    }
  }
  for (const p of old.keys()) if (!seenPaths.has(p)) stats.removed++;
  // ratings / favorites join (keyed by stable id, never by name)
  const ids = new Set();
  const dup = new Map(); const firstPath = new Map();
  for (const r of rows) {
    const u = userData.assets[r.id] || {};
    r.rating = Number.isFinite(u.rating) ? Math.max(0, Math.min(5, Math.round(u.rating))) : 0;
    r.favorite = u.favorite === true;
    if (Number.isFinite(u.uses)) r.uses = u.uses; else delete r.uses;
    ids.add(r.id);
    if (r.pack !== '_wip') {
      if (firstPath.has(r.id)) { if (!dup.has(r.id)) dup.set(r.id, [firstPath.get(r.id)]); dup.get(r.id).push(r.path); }
      else firstPath.set(r.id, r.path);
    }
  }
  for (const [id, ps] of dup) warnings.push({ code: 'id-duplicate', message: `id ${id} appears in several non-_wip files: ${ps.join(', ')}` });
  for (const id of Object.keys(userData.assets)) if (!ids.has(id)) stats.orphan_user_data++;
  rows.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  const index = {
    schema: INDEX_STANDARD, generated: new Date().toISOString(), root: 'presets',
    note: 'Disposable accelerator. Delete to rebuild. Ratings/favorites come from user-data.json keyed by asset id.',
    rows, errors, warnings, stats,
  };
  if (!opts.dryRun) writeJsonAtomic(indexFile, index);
  return { index, indexFile };
}

function cmdIndex(argv, ctx) {
  void ctx;
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  if (!a._[0]) { console.error('Usage: apc presets index <root> [--rebuild] [--user-data <file>] [--json]'); return 2; }
  const roots = resolveRoots(a._[0]);
  if (!roots) { console.error(`no presets/ folder found under ${path.resolve(a._[0])}`); return 2; }
  let res;
  try { res = buildIndex(roots.appRoot, roots.presetsDir, { rebuild: !!a.flags.rebuild, userData: a.flags['user-data'] }); }
  catch (e) { console.error(e.message); return 1; }
  const s = res.index.stats;
  const payload = { ok: true, index: res.indexFile, rows: res.index.rows.length, stats: s, errors: res.index.errors, warnings: res.index.warnings };
  const lines = [
    `indexed ${res.index.rows.length} asset(s) -> ${res.indexFile}`,
    `  scanned ${s.scanned}, reused ${s.reused}, reparsed ${s.reparsed}, ghost rows removed ${s.removed}`,
    ...res.index.errors.map((e) => `warning [unreadable] ${e.path}: ${e.message}`),
    ...res.index.warnings.map((w) => `warning [${w.code}] ${w.message}`),
  ];
  emit(json, payload, lines);
  return 0;
}

// ---------------------------------------------------------------------------
// presets promote
// ---------------------------------------------------------------------------

function resolvePackArg(value, roots) {
  if (path.isAbsolute(value) || /[\\/]/.test(value)) return path.resolve(value);
  if (roots) return path.join(roots.presetsDir, value);
  return path.resolve(value);
}

function copyFileAtomic(src, dest) {
  atomicWriteFileSync(dest, fs.readFileSync(src));
}

function cmdPromote(argv, ctx) {
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  if (!a.flags.from || !a.flags.to) { console.error('Usage: apc presets promote --from <_wip pack> --to <pack> [--ids a,b] [--root <appRoot>] [--move] [--dry-run] [--overwrite] [--json]'); return 2; }
  const roots = a.flags.root ? resolveRoots(a.flags.root) : null;
  if (a.flags.root && !roots) { console.error(`no presets/ folder found under ${path.resolve(a.flags.root)}`); return 2; }
  const fromDir = resolvePackArg(a.flags.from, roots);
  const toDir = resolvePackArg(a.flags.to, roots);
  if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) { console.error(`source pack not found: ${fromDir}`); return 2; }
  if (path.resolve(fromDir) === path.resolve(toDir)) { console.error('--from and --to are the same pack'); return 2; }

  let schema; let vocab;
  try { schema = loadSchema(ctx); vocab = loadVocab(ctx); } catch (e) { console.error(e.message); return 2; }
  let manifest = null;
  if (a.flags.manifest) { try { manifest = loadManifest(path.resolve(a.flags.manifest)); } catch (e) { console.error(e.message); return 2; } }

  const fromPack = scanPack(fromDir);
  const toExists = fs.existsSync(toDir);
  const toPack = toExists ? scanPack(toDir) : null;
  const rep = new Report();

  // selection
  let selected = fromPack.assets;
  if (a.flags.ids) {
    const wanted = String(a.flags.ids).split(',').map((s) => s.trim()).filter(Boolean);
    const byId = new Map(fromPack.assets.filter((x) => x.doc && x.doc.id).map((x) => [x.doc.id, x]));
    const unknown = wanted.filter((id) => !byId.has(id));
    if (unknown.length) { for (const id of unknown) rep.error('id-not-found', null, `id ${id} not found in ${fromPack.name}`); }
    selected = wanted.filter((id) => byId.has(id)).map((id) => byId.get(id));
  }
  if (!selected.length && !rep.errors.length) rep.error('nothing-to-promote', null, `no assets selected in ${fromPack.name}`);

  const parentPresets = path.dirname(fromDir);
  const contextTable = path.basename(parentPresets) === 'presets' ? buildContextTable(parentPresets, new Set([fromDir])) : new Map();
  // lint the whole source pack as factory content in the context of the destination
  const lintRep = new Report();
  if (toPack) for (const x of toPack.assets) if (x.doc && x.doc.id) contextTable.set(x.doc.id, { abs: x.abs, kind: x.doc.kind, pack: toPack.name, rel: x.rel });
  lintPacks([fromPack], { vocab, schema, factory: true, manifest, contextTable }, lintRep);
  if (fromPack.layout === 'mixed') rep.error('mixed-layout', fromPack.name, 'source pack mixes flat and typed layouts');
  const selRel = new Set(selected.map((x) => `${fromPack.name}/${x.rel}`));

  // dependency closure (refs + samples that must travel with the selection)
  const closure = new Map(selected.map((x) => [x.abs, x]));
  const sampleSet = new Set();
  const addDeps = (entry) => {
    const doc = entry.doc;
    if (!doc) return;
    const refs = [];
    if (doc.kind === 'kit' && Array.isArray(doc.slots)) for (const s of doc.slots) refs.push({ obj: s });
    if (doc.kind === 'patch') for (const s of [...(doc.kits || []), ...(doc.sequences || [])]) refs.push({ obj: s });
    const byAbs = new Map(fromPack.assets.map((x) => [x.abs, x]));
    const byId = new Map(fromPack.assets.filter((x) => x.doc && x.doc.id).map((x) => [x.doc.id, x]));
    for (const { obj } of refs) {
      const ref = obj.ref || obj.sound_ref; const id = obj.id || obj.sound_id;
      let hit = null;
      if (ref) {
        for (const c of [path.resolve(path.dirname(entry.abs), ref), path.resolve(fromDir, ref)]) if (byAbs.has(c)) { hit = byAbs.get(c); break; }
      }
      if (!hit && id && byId.has(id)) hit = byId.get(id);
      if (hit && !closure.has(hit.abs)) { closure.set(hit.abs, hit); addDeps(hit); }
    }
    if (typeof doc.sample_ref === 'string' && doc.sample_ref) sampleSet.add(doc.sample_ref.replace(/\\/g, '/'));
    if (Array.isArray(doc.samples)) for (const s of doc.samples) if (s && typeof s.ref === 'string') sampleSet.add(s.ref.replace(/\\/g, '/'));
  };
  for (const s of selected) addDeps(s);
  const toCopy = [...closure.values()];
  const included = toCopy.filter((x) => !selected.includes(x)).map((x) => x.rel);
  const relevant = new Set(toCopy.map((x) => `${fromPack.name}/${x.rel}`));

  for (const i of lintRep.issues) {
    // pack-level and unrelated-file issues in the source do not block; selected + dependency files do
    if (i.file && (relevant.has(i.file) || selRel.has(i.file))) rep.issues.push(i);
  }
  // layout compatibility
  if (toPack && toPack.layout !== 'empty' && fromPack.layout !== 'empty' && toPack.layout !== fromPack.layout) {
    rep.error('layout-mismatch', null, `source layout is "${fromPack.layout}" but destination is "${toPack.layout}"`);
  }
  // destination collisions
  const plan = []; const unchanged = [];
  const toById = new Map();
  if (toPack) for (const x of toPack.assets) if (x.doc && x.doc.id) toById.set(x.doc.id, x);
  const toNames = new Map();
  if (toPack) for (const x of toPack.assets) if (x.doc && x.doc.name) toNames.set(`${x.doc.kind}|${x.doc.name.trim().toLowerCase()}`, x);
  for (const x of toCopy) {
    const dest = path.join(toDir, x.rel);
    const existingById = x.doc && toById.get(x.doc.id);
    const nameHit = x.doc && toNames.get(`${x.doc.kind}|${String(x.doc.name).trim().toLowerCase()}`);
    if (existingById) {
      if (sha256File(existingById.abs) === sha256File(x.abs)) { unchanged.push(posix(path.relative(toDir, existingById.abs))); continue; }
      plan.push({ src: x.abs, dest: existingById.abs, rel: posix(path.relative(toDir, existingById.abs)), action: 'update', id: x.doc.id, kind: x.doc.kind, name: x.doc.name });
      continue;
    }
    if (nameHit) { rep.error('name-duplicate', x.rel, `destination already has a ${x.doc.kind} named "${x.doc.name}" with a different id`); continue; }
    if (fs.existsSync(dest) && !a.flags.overwrite) { rep.error('dest-collision', x.rel, `destination file exists with a different id; refusing to overwrite (use --overwrite to replace)`); continue; }
    plan.push({ src: x.abs, dest, rel: x.rel, action: fs.existsSync(dest) ? 'update' : 'add', id: x.doc && x.doc.id, kind: x.doc && x.doc.kind, name: x.doc && x.doc.name });
  }
  const samplePlan = [];
  for (const s of sampleSet) {
    const src = path.resolve(fromDir, s);
    if (!isInside(fromDir, src) || !fs.existsSync(src)) continue; // lint already reports missing/escaping samples
    const dest = path.join(toDir, s);
    if (fs.existsSync(dest) && sha256File(dest) !== sha256File(src) && !a.flags.overwrite) { rep.error('sample-collision', s, 'destination sample exists with different content'); continue; }
    if (!fs.existsSync(dest)) samplePlan.push({ src, dest, rel: s });
  }
  // destination manifest
  let manifestForDest = null;
  if (toPack && toPack.hasManifest) { if (toPack.manifestError) rep.error('pack-manifest-invalid', `${toPack.name}/pack.json`, toPack.manifestError); }
  else {
    if (fromPack.manifest && !fromPack.manifestError) {
      manifestForDest = { ...fromPack.manifest, name: path.basename(toDir) };
      delete manifestForDest.id; // fresh id below
      manifestForDest = { schema: PACK_STANDARD, id: `pack_${crypto.randomUUID()}`, ...manifestForDest };
      rep.warn('pack-manifest-created', null, `destination has no pack.json; one is derived from the source (new pack id)`);
    } else rep.error('pack-manifest-missing', null, 'destination pack has no pack.json and the source has none to derive it from (create the pack with "apc presets init")');
  }

  const failed = rep.errors.length > 0;
  const payload = {
    ok: !failed, dry_run: !!a.flags['dry-run'], from: fromDir, to: toDir,
    promoted: [], unchanged: [], included_dependencies: included, samples: samplePlan.map((s) => s.rel),
    issues: rep.issues, errors: rep.errors.length, warnings: rep.warnings.length,
  };
  if (failed) {
    emit(json, payload, [...rep.issues.map(formatIssue), `REFUSED: ${rep.errors.length} error(s); nothing was written`]);
    return 1;
  }
  payload.unchanged = unchanged;
  payload.promoted = plan.map((p) => ({ id: p.id, kind: p.kind, name: p.name, path: p.rel, action: p.action }));
  if (a.flags['dry-run']) {
    emit(json, payload, [...rep.issues.map(formatIssue), `dry run: would promote ${plan.length} asset(s) and ${samplePlan.length} sample(s) into ${toDir}`]);
    return 0;
  }

  if (!plan.length && !samplePlan.length) {
    if (a.flags.move) for (const x of closure.values()) { try { fs.unlinkSync(x.abs); } catch { /* ignore */ } }
    emit(json, payload, [...rep.issues.map(formatIssue), `nothing to promote: ${unchanged.length} asset(s) already up to date in ${toDir}`]);
    return 0;
  }
  // copy: samples, then leaves, then patches (so a failure never leaves a dangling ref); roll back on error
  const order = { sound: 0, sequence: 1, kit: 2, preset: 3, patch: 4 };
  plan.sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9));
  const created = []; const replaced = [];
  try {
    fs.mkdirSync(toDir, { recursive: true });
    if (manifestForDest) { const mf = path.join(toDir, 'pack.json'); writeJsonAtomic(mf, manifestForDest); created.push(mf); }
    for (const s of samplePlan) { copyFileAtomic(s.src, s.dest); created.push(s.dest); }
    for (const p of plan) {
      if (fs.existsSync(p.dest)) {
        const bak = `${p.dest}.promote-bak-${process.pid}`;
        fs.renameSync(p.dest, bak);
        replaced.push({ dest: p.dest, bak });
      } else created.push(p.dest);
      copyFileAtomic(p.src, p.dest);
    }
    // changelog entry
    const clFile = path.join(toDir, 'changelog.json');
    let changelog = { schema: 'apc-pack-changelog/1.0', entries: [] };
    if (fs.existsSync(clFile)) { try { const prev = readJsonFile(clFile); if (prev && Array.isArray(prev.entries)) changelog = prev; } catch { /* start fresh */ } }
    let packVersion = null;
    try { packVersion = readJsonFile(path.join(toDir, 'pack.json')).version || null; } catch { /* ignore */ }
    changelog.entries.push({
      date: new Date().toISOString(), pack_version: packVersion, from: fromPack.name,
      added: plan.filter((p) => p.action === 'add').map((p) => ({ id: p.id, kind: p.kind, name: p.name, path: p.rel })),
      changed: plan.filter((p) => p.action === 'update').map((p) => ({ id: p.id, kind: p.kind, name: p.name, path: p.rel })),
      samples: samplePlan.map((s) => s.rel),
    });
    if (fs.existsSync(clFile)) {
      const bak = `${clFile}.promote-bak-${process.pid}`;
      fs.copyFileSync(clFile, bak);
      replaced.push({ dest: clFile, bak });
    } else created.push(clFile);
    writeJsonAtomic(clFile, changelog);
    // index
    const idxRoots = roots || resolveRoots(path.dirname(toDir));
    if (idxRoots) buildIndex(idxRoots.appRoot, idxRoots.presetsDir, {});
    payload.index = idxRoots ? path.join(idxRoots.appRoot, 'cache', '_index.json') : null;
  } catch (e) {
    for (const f of created.reverse()) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    for (const r of replaced) { try { fs.renameSync(r.bak, r.dest); } catch { /* ignore */ } }
    payload.ok = false;
    emit(json, payload, [`FAILED: ${e.message}`, 'rolled back; destination restored']);
    return 1;
  }
  for (const r of replaced) { try { fs.unlinkSync(r.bak); } catch { /* ignore */ } }
  if (a.flags.move) for (const x of closure.values()) { try { fs.unlinkSync(x.abs); } catch { /* ignore */ } }
  emit(json, payload, [
    ...rep.issues.map(formatIssue),
    `promoted ${plan.length} asset(s) (${plan.filter((p) => p.action === 'add').length} added, ${plan.filter((p) => p.action === 'update').length} updated, ${unchanged.length} unchanged) and ${samplePlan.length} sample(s) into ${toDir}`,
    ...(included.length ? [`  dependencies included: ${included.join(', ')}`] : []),
    `  changelog entry written; index ${payload.index ? 'regenerated' : 'skipped (no presets/ root found)'}`,
  ]);
  return 0;
}

// ---------------------------------------------------------------------------
// presets init
// ---------------------------------------------------------------------------

function cmdInit(argv, ctx) {
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  const name = a.flags.plugin;
  if (!name || name === true) { console.error('Usage: apc presets init --plugin <Name> [--pack <Pack>] [--out <presets dir>] [--author <text>] [--force] [--json]'); return 2; }
  let info; let cfg;
  try { info = readPluginStandards(ctx, name); cfg = pluginPresetConfig(info); } catch (e) { console.error(e.message); return 1; }
  if (cfg.missing.length) {
    console.error(`cannot initialise presets: option(s) ${cfg.missing.join(', ')} have no value. Answer them with: apc standards set <id> <value> --plugin ${name}`);
    return 1;
  }
  const packName = sanitizeFilename(a.flags.pack && a.flags.pack !== true ? a.flags.pack : 'Factory');
  const presetsDir = a.flags.out && a.flags.out !== true ? path.resolve(a.flags.out) : path.join(info.pluginDir, 'Assets', 'presets');
  const packDir = path.join(presetsDir, packName);
  const wipDir = path.join(presetsDir, '_wip');
  const flat = cfg.hierarchy === 'flat';
  const kind = flat ? 'preset' : 'sound';
  const ext = cfg.exts[kind];
  const sub = flat ? packDir : path.join(packDir, 'sounds');
  const file = path.join(sub, `Init${ext}`);
  const rawVer = String(info.status.version || '1.0.0').replace(/^v/i, '');
  const appVersion = SEMVER.test(rawVer) ? rawVer : '1.0.0';
  const author = a.flags.author && a.flags.author !== true ? String(a.flags.author) : (info.status.manufacturer || info.status.company || null);
  const now = new Date().toISOString();
  const written = []; const skipped = [];

  const initDoc = {
    schema: STANDARD, kind, id: `${KIND_PREFIX[kind]}_${crypto.randomUUID()}`, name: 'Init',
    author, created: now, app_version: appVersion,
    meta: { role: 'init', tags: [], desc: 'Declared default state of every parameter.' },
    params: {},
  };
  const packManifest = {
    schema: PACK_STANDARD, id: `pack_${crypto.randomUUID()}`, name: packName, author,
    version: '1.0.0', license: 'factory', plugin: name, app_version_min: appVersion,
    layout: cfg.hierarchy, extensions: cfg.exts, artwork: null,
  };
  const pk = info.get('preset.pack_ext');
  if (typeof pk === 'string' && pk.trim()) packManifest.pack_ext = pk.trim().startsWith('.') ? pk.trim() : `.${pk.trim()}`;

  const put = (target, obj, label) => {
    if (fs.existsSync(target) && !a.flags.force) { skipped.push(label); return; }
    writeJsonAtomic(target, obj); written.push(label);
  };
  try {
    put(path.join(packDir, 'pack.json'), packManifest, `${packName}/pack.json`);
    put(file, initDoc, posix(path.relative(presetsDir, file)));
    if (!flat) for (const d of ['kits', 'sequences', 'patches']) fs.mkdirSync(path.join(packDir, d), { recursive: true });
    fs.mkdirSync(path.join(packDir, 'samples'), { recursive: true });
    fs.mkdirSync(wipDir, { recursive: true });
    const keep = path.join(wipDir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  } catch (e) { console.error(e.message); return 1; }

  const payload = {
    ok: true, plugin: name, presets_dir: presetsDir, pack: packName, hierarchy: cfg.hierarchy, extensions: cfg.exts,
    options: {
      'preset.factory_install': info.get('preset.factory_install'),
      'preset.factory_delivery': info.get('preset.factory_delivery'),
      'preset.host_program_list': info.get('preset.host_program_list'),
      'engine.state_scope': info.get('engine.state_scope'),
    },
    written, skipped, wip: wipDir,
  };
  const lines = [
    `presets initialised for ${name} (${cfg.hierarchy}) in ${presetsDir}`,
    ...written.map((w) => `  wrote   ${w}`), ...skipped.map((s) => `  exists  ${s} (use --force to overwrite)`),
    `  author: ${author || '(unset - edit pack.json)'}`,
    `  extensions: ${Object.entries(cfg.exts).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    `  factory_install=${payload.options['preset.factory_install']} state_scope=${payload.options['engine.state_scope']}`,
    'next: author assets in _wip/, then "apc presets validate <_wip> --factory" and "apc presets promote".',
  ];
  emit(json, payload, lines);
  return 0;
}

// ---------------------------------------------------------------------------
// presets paths
// ---------------------------------------------------------------------------

function layoutFor(osName, scope, manufacturer, plugin, env, hostOs) {
  const P = osName === 'win' ? path.win32 : path.posix;
  const same = osName === hostOs;
  const safe = (s) => sanitizeFilename(s);
  const home = same ? os.homedir() : '~';
  let template; let base;
  if (osName === 'win') {
    template = scope === 'machine-wide' ? '%PROGRAMDATA%' : '%LOCALAPPDATA%';
    base = same ? (scope === 'machine-wide' ? env.PROGRAMDATA : env.LOCALAPPDATA) || template : template;
  } else if (osName === 'mac') {
    template = scope === 'machine-wide' ? '/Library/Application Support' : '~/Library/Application Support';
    base = scope === 'machine-wide' ? template : P.join(home, 'Library', 'Application Support');
  } else {
    template = scope === 'machine-wide' ? '/usr/local/share' : '~/.local/share';
    base = scope === 'machine-wide' ? template : P.join(home, '.local', 'share');
  }
  let overridden = false;
  if (same && env.APC_PRESET_ROOT) { base = env.APC_PRESET_ROOT; template = '$APC_PRESET_ROOT'; overridden = true; }
  const root = P.join(base, safe(manufacturer), safe(plugin));
  const j = (...p) => P.join(root, ...p);
  const seed = osName === 'win' ? '%PROGRAMDATA%' : osName === 'mac' ? '/Library/Application Support' : '/usr/local/share';
  return {
    os: osName, scope, env_override: overridden ? 'APC_PRESET_ROOT' : null, base_template: template, root,
    presets: j('presets'), factory_pack: j('presets', '<Factory_Pack>'), wip: j('presets', '_wip'), user: j('presets', 'User'),
    pack_shape: {
      typed: ['sounds', 'kits', 'sequences', 'patches', 'samples'].map((d) => j('presets', '<Pack>', d)),
      flat: j('presets', '<Pack>', '<name><preset_ext>'),
      manifest: j('presets', '<Pack>', 'pack.json'),
    },
    index: j('cache', '_index.json'), settings: j('settings.json'), user_data: j('user-data.json'), license: j('license.lic'),
    factory_seed: P.join(seed, safe(manufacturer), safe(plugin), 'factory'),
  };
}

function cmdPaths(argv, ctx) {
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  const name = a.flags.plugin;
  if (!name || name === true) { console.error('Usage: apc presets paths --plugin <Name> [--os win|mac|linux] [--scope per-user|machine-wide] [--manufacturer <M>] [--json]'); return 2; }
  const host = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const osName = a.flags.os && a.flags.os !== true ? String(a.flags.os) : host;
  if (!['win', 'mac', 'linux'].includes(osName)) { console.error('--os must be win, mac or linux'); return 2; }

  let manufacturer = a.flags.manufacturer && a.flags.manufacturer !== true ? String(a.flags.manufacturer) : null;
  let scope = a.flags.scope && a.flags.scope !== true ? String(a.flags.scope) : null;
  let installMode = 'user-folder';
  try {
    const info = readPluginStandards(ctx, name);
    manufacturer = manufacturer || info.status.manufacturer || info.status.company || (info.config && info.config.manufacturer) || null;
    scope = scope || (info.get('preset.data_root') === 'machine-wide' ? 'machine-wide' : 'per-user');
    installMode = info.get('preset.factory_install') || installMode;
  } catch { /* plugin not created yet: layout is still printable */ }
  scope = scope || 'per-user';
  if (scope === 'per-user' || scope === 'machine-wide') { /* ok */ } else { console.error('--scope must be per-user or machine-wide'); return 2; }
  const placeholder = !manufacturer;
  manufacturer = manufacturer || '<Manufacturer>';
  const L = layoutFor(osName, scope, manufacturer, name, process.env, host);
  L.manufacturer_is_placeholder = placeholder;
  L.factory_install = {
    mode: installMode,
    target: installMode === 'shared-seed' ? L.factory_seed : L.factory_pack,
    note: installMode === 'shared-seed'
      ? 'installer writes a read-only seed; the plugin copies it into the user folder on first run'
      : 'installer writes into the INSTALLING user\'s folder; other accounts need "Restore Factory Layout"',
  };
  const lines = [
    `${name} preset data layout (${osName}, ${scope})${L.env_override ? ` [override ${L.env_override}]` : ''}`,
    `  root          ${L.root}`, `  presets       ${L.presets}`, `    factory     ${L.factory_pack}`, `    _wip        ${L.wip}`, `    User        ${L.user}`,
    `    typed shape ${L.pack_shape.typed.join(', ')}`, `    flat shape  ${L.pack_shape.flat}`,
    `  index         ${L.index}`, `  settings      ${L.settings}`, `  user-data     ${L.user_data}`, `  license       ${L.license}`,
    `  factory install (${L.factory_install.mode}) -> ${L.factory_install.target}`,
    ...(placeholder ? ['  note: manufacturer unknown; pass --manufacturer or set "manufacturer" in status.json'] : []),
  ];
  emit(json, L, lines);
  return 0;
}

// ---------------------------------------------------------------------------
// presets check-manifest
// ---------------------------------------------------------------------------

function cmdCheckManifest(argv) {
  const a = parseArgs(argv, { values: VALUE_FLAGS });
  const json = !!a.flags.json;
  if (a._.length < 2) { console.error('Usage: apc presets check-manifest <released.json> <current.json> [--json]'); return 2; }
  let rel; let cur;
  try { rel = loadManifest(path.resolve(a._[0])); cur = loadManifest(path.resolve(a._[1])); } catch (e) { console.error(e.message); return 2; }
  const violations = checkAppendOnly(rel.params, cur.params);
  const added = cur.params.filter((p) => !rel.byId.has(p.id)).map((p) => p.id);
  const payload = { ok: violations.length === 0, violations, added };
  emit(json, payload, [
    ...violations.map((v) => `ERROR  [append-only] ${v.id}: ${v.reason}`),
    `${payload.ok ? 'OK' : 'FAILED'}: ${violations.length} violation(s), ${added.length} new parameter(s)`,
  ]);
  return payload.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

const HELP = [
  'apc presets <subcommand>',
  '  validate <dir|file> [--factory] [--plugin N] [--manifest F] [--strict] [--json]',
  '  index <root> [--rebuild] [--user-data F] [--json]',
  '  promote --from <_wip pack> --to <pack> [--ids a,b] [--root R] [--move] [--dry-run] [--json]',
  '  init --plugin <Name> [--pack P] [--out DIR] [--author A] [--force] [--json]',
  '  paths --plugin <Name> [--os win|mac|linux] [--scope S] [--manufacturer M] [--json]',
  '  check-manifest <released.json> <current.json> [--json]',
];

async function run(args, ctx) {
  const [sub, ...rest] = args;
  try {
    switch (sub) {
      case 'validate': return cmdValidate(rest, ctx);
      case 'index': return cmdIndex(rest, ctx);
      case 'promote': return cmdPromote(rest, ctx);
      case 'init': return cmdInit(rest, ctx);
      case 'paths': return cmdPaths(rest, ctx);
      case 'check-manifest': return cmdCheckManifest(rest, ctx);
      case undefined: case 'help': case '--help': case '-h':
        for (const l of HELP) console.log(l);
        return sub ? 0 : 2;
      default:
        console.error(`unknown presets subcommand "${sub}"`);
        for (const l of HELP) console.error(l);
        return 2;
    }
  } catch (e) {
    console.error(e && e.message ? e.message : String(e));
    return 1;
  }
}

module.exports = {
  run,
  // exported for tests and sibling tooling
  sanitizeFilename, atomicWriteFileSync, validateSchema, canonicalize, loadVocab, loadSchema,
  scanPack, findPacks, lintPacks, Report, buildIndex, checkAppendOnly, resolveDefaultsFirst,
  layoutFor, loadManifest,
};
