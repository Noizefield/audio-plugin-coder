#!/usr/bin/env node
/* =============================================================================
   ui-lint.js — APC UI contract gate.

   Validates a plugin's Design/ui-map.json and (when present) its production
   Source/ui/public/index.html against the layout contract:
     - manifest schema-lite, cell bounds/0.25 snap, overlap
     - control params vs .ideas/parameter-spec.md (and contract docs)
     - forbidden scaling mechanisms in production HTML (zoom, JS scale fns,
       margin factors, raw px)
     - manifest ↔ DOM parity (no missing controls, no invented elements)
     - grip / aspect-lock / background-colour wiring per layout contract

   Usage:  node scripts/ui-lint.js <PluginName|pluginDir> [--plugins-dir DIR]
           [--map ui-map.json] [--json]
   Exposed as `apc validate ui --plugin <Name>` via bin/apc.js.
   Zero dependencies, Node 18+. CommonJS.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const composeLib = (() => { try { return require('./ui-compose.js'); } catch { return null; } })();

function findRepoRoot() {
  if (process.env.APC_ROOT) return path.resolve(process.env.APC_ROOT);
  for (const dir of [path.resolve(__dirname, '..'), process.cwd()]) {
    try {
      if (fs.existsSync(path.join(dir, 'package.json')) &&
          fs.existsSync(path.join(dir, 'scripts'))) return dir;
    } catch { /* keep looking */ }
  }
  return path.resolve(__dirname, '..');
}
const repoRoot = findRepoRoot();

/* ---------- helpers ---------- */

const SNAP = 0.25;
const snapped = n => Math.abs(n / SNAP - Math.round(n / SNAP)) < 1e-6;
const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function findMapFile(designDir, explicit) {
  if (composeLib) return composeLib.findMapFile(designDir, explicit);
  const f = path.join(designDir, explicit || 'ui-map.json');
  return fs.existsSync(f) ? f : null;
}

function paramIdsFromIdeas(ideasDir) {
  const ids = new Set();
  if (!fs.existsSync(ideasDir)) return ids;
  for (const f of fs.readdirSync(ideasDir)) {
    if (!/\.md$/i.test(f)) continue;
    const text = fs.readFileSync(path.join(ideasDir, f), 'utf8');
    for (const m of text.matchAll(/`([a-z][a-z0-9_]*)`/g)) ids.add(m[1]);
  }
  return ids;
}

/* ---------- main validator ---------- */

function validateUi(pluginDir, opts) {
  opts = opts || {};
  const res = { errors: [], warnings: [], infos: [], checks: [] };
  const ok   = (check, msg) => res.checks.push({ check, status: 'pass', msg });
  const err  = (check, msg) => { res.checks.push({ check, status: 'fail', msg }); res.errors.push(`${check}: ${msg}`); };
  const warn = (check, msg) => { res.checks.push({ check, status: 'warn', msg }); res.warnings.push(`${check}: ${msg}`); };
  const info = (check, msg) => { res.checks.push({ check, status: 'info', msg }); res.infos.push(`${check}: ${msg}`); };

  const designDir = path.join(pluginDir, 'Design');
  const mapFile = fs.existsSync(designDir) ? findMapFile(designDir, opts.map || null) : null;
  if (!mapFile) { err('ui-map', `no ui-map.json in ${designDir}`); return res; }
  ok('ui-map', path.basename(mapFile));

  let map;
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); }
  catch (e) { err('ui-map', `parse error: ${e.message}`); return res; }

  /* ---- layout block ---- */
  const L = map.layout || {};
  const cols = L.plate && L.plate.cols, rows = L.plate && L.plate.rows;
  if (!['fixed', 'scalable', 'adaptive'].includes(L.mode)) err('layout.mode', `invalid mode "${L.mode}"`);
  else ok('layout.mode', L.mode);
  if (!(cols > 0 && rows > 0)) err('layout.plate', 'plate.cols/rows missing or non-positive');
  else ok('layout.plate', `${cols} × ${rows} cells`);

  /* ---- cells: bounds + snap + overlap ---- */
  const placed = [
    ...(map.sections || []).map(x => ({ ...x, _kind: 'section' })),
    ...(map.canvases || []).map(x => ({ ...x, _kind: 'canvas' })),
    ...(map.controls || []).map(x => ({ ...x, _kind: 'control' })),
  ];
  let boundBad = 0, snapBad = 0;
  for (const it of placed) {
    const c = it.cell || {};
    if (!(c.w > 0 && c.h > 0) || c.x < 0 || c.y < 0 ||
        (cols && c.x + c.w > cols + 1e-6) || (rows && c.y + c.h > rows + 1e-6))
      { boundBad++; err('cell.bounds', `${it._kind} ${it.id}: cell ${JSON.stringify(c)} outside plate`); }
    for (const n of [c.x, c.y, c.w, c.h])
      if (typeof n === 'number' && !snapped(n)) { snapBad++; err('cell.snap', `${it._kind} ${it.id}: value ${n} not on 0.25 grid`); }
  }
  if (!boundBad) ok('cell.bounds', `${placed.length} placements inside plate`);
  if (!snapBad) ok('cell.snap', 'all cells on 0.25 grid');

  const solid = placed.filter(p => p._kind !== 'section' && !p.overlay);
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++)
      if (overlaps(solid[i].cell, solid[j].cell))
        err('cell.overlap', `${solid[i].id} overlaps ${solid[j].id}`);
  ok('cell.overlap', 'no control/canvas overlaps');

  /* ---- params vs spec ---- */
  const specIds = paramIdsFromIdeas(path.join(pluginDir, '.ideas'));
  const params = (map.controls || []).map(c => c.param).filter(Boolean);
  const specHasIds = specIds.size > 0;
  if (!specHasIds) warn('params.spec', 'no parameter ids found in .ideas/*.md — skipping cross-check');
  for (const p of params)
    if (specHasIds && !specIds.has(p)) warn('params.match', `control param "${p}" not found in spec docs`);
  const controlled = new Set(params);
  const unbound = [...specIds].filter(id => !controlled.has(id));
  if (specHasIds && unbound.length)
    info('params.coverage', `${unbound.length} spec params without controls (may be fine): ${unbound.slice(0, 8).join(', ')}${unbound.length > 8 ? '…' : ''}`);
  else if (specHasIds) ok('params.coverage', 'every spec param has a control');

  /* ---- production HTML (or an explicit preview via --html) ---- */
  const htmlFile = opts.html ? path.resolve(pluginDir, opts.html)
                             : path.join(pluginDir, 'Source', 'ui', 'public', 'index.html');
  if (fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8');

    if (/style\.zoom|documentElement\.style\.zoom/.test(html))
      err('forbidden.zoom', 'CSS zoom in production HTML (Chromium-ism; use rem units)');
    else ok('forbidden.zoom', 'no CSS zoom');

    if (/Math\.min\s*\(\s*innerWidth/.test(html))
      err('forbidden.jsscale', 'JS-computed scale (Math.min(innerWidth…)) — geometry must be CSS');
    else ok('forbidden.jsscale', 'no JS scale function');

    if (/\*\s*0?\.\d{2}/.test(html))
      err('forbidden.margin', 'decimal scale factor (*.NN) — plate must fill viewport per edge_policy');
    else ok('forbidden.margin', 'no margin factors');

    const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    if (/(^|[;{}\s])zoom\s*:/.test(styleBlocks)) warn('forbidden.csszoom', '`zoom:` property in <style> blocks');
    if (/transform[^;]*scale\s*\(/.test(html)) warn('mechanism.transform', 'transform: scale() present — verify it is not a layout-scale wrapper');
    const pxHits = [...styleBlocks.matchAll(/-?\d+(?:\.\d+)?px/g)]
      .filter(m => m[0] !== '1px' && m[0] !== '-1px' && m[0] !== '0px').length;
    if (pxHits > 0) warn('units.px', `${pxHits} raw px values in <style> (allowed: hairline 1px / catalog internals)`);
    else ok('units.px', 'no raw px outside hairlines');

    /* DOM ↔ manifest parity */
    const domIds = new Set([
      ...[...html.matchAll(/id="ctl-([a-z0-9_-]+)"/g)].map(m => m[1]),
      ...[...html.matchAll(/data-param="([a-z0-9_-]+)"/g)].map(m => m[1]),
    ]);
    const domSecs = new Set([...html.matchAll(/id="sec-([a-z0-9_-]+)"/g)].map(m => m[1]));
    const domCvs  = new Set([...html.matchAll(/id="cv-([a-z0-9_-]+)"/g)].map(m => m[1]));
    const missing = [], extra = [];
    for (const c of (map.controls || []))
      if (!domIds.has(c.id) && !(c.param && domIds.has(c.param))) missing.push(c.id);
    for (const id of domIds) {
      if (id === 'grip') continue; // auto-added by composer per resize_handle
      if (!(map.controls || []).some(c => c.id === id || c.param === id)) extra.push(id);
    }
    for (const s of (map.sections || []))
      if (!domSecs.has(s.id)) warn('dom.sections', `section "${s.id}" missing in DOM`);
    for (const cv of (map.canvases || []))
      if (!domCvs.has(cv.id)) warn('dom.canvases', `canvas "${cv.id}" missing in DOM`);
    if (missing.length) err('dom.parity', `controls missing in DOM: ${missing.join(', ')}`);
    if (extra.length)   err('dom.parity', `elements not in ui-map (invented): ${extra.join(', ')}`);
    if (!missing.length && !extra.length) ok('dom.parity', 'DOM controls match manifest exactly');

    /* grip + editor wiring */
    const handle = L.resize_handle || 'corner-gripper';
    if (handle === 'corner-gripper') {
      if (!/apc-grip/.test(html)) err('grip.dom', 'resize_handle=corner-gripper but no .apc-grip element in index.html');
      else ok('grip.dom', 'apc-grip present');
    }
  } else {
    info('dom.parity', `no ${opts.html || 'Source/ui/public/index.html'} yet — design-only checks ran`);
  }

  /* ---- C++ editor wiring ---- */
  const cppFile = path.join(pluginDir, 'Source', 'PluginEditor.cpp');
  if (fs.existsSync(cppFile)) {
    const cpp = fs.readFileSync(cppFile, 'utf8');
    if (L.aspect_lock !== false) {
      if (/setFixedAspectRatio\s*\(\s*0/.test(cpp)) err('cpp.aspect', 'setFixedAspectRatio(0) — aspect disabled while ui-map locks it');
      else if (!/setFixedAspectRatio/.test(cpp)) err('cpp.aspect', 'aspect_lock=true but no setFixedAspectRatio in PluginEditor.cpp');
      else ok('cpp.aspect', 'setFixedAspectRatio present');
      if (!/snapWindowToAspect|checkBounds/.test(cpp)) warn('cpp.snap', 'no host-resize re-assertion (snapWindowToAspect) — host resizes can bypass constrainer');
    } else if (!/setResizable/.test(cpp)) {
      info('cpp.aspect', 'aspect unlocked by contract; no setResizable found either');
    } else ok('cpp.aspect', 'aspect unlocked per contract');
    if ((L.resize_handle || 'corner-gripper') === 'corner-gripper') {
      if (!/resizeGrip/.test(cpp)) err('cpp.grip', 'corner-gripper declared but no resizeGrip native function in PluginEditor.cpp');
      else ok('cpp.grip', 'resizeGrip native fn present');
    }
    if (!/withBackgroundColour/.test(cpp)) warn('cpp.bg', 'no withBackgroundColour — expect drag-flash on resize');
    if (L.mode === 'fixed' && /setResizable\s*\(\s*true/.test(cpp)) warn('cpp.fixed', 'mode=fixed but setResizable(true)');
    if (L.mode !== 'fixed' && !/setResizable\s*\(\s*true/.test(cpp)) warn('cpp.resizable', `mode=${L.mode} but setResizable(true) not found`);
  } else {
    info('cpp', 'no Source/PluginEditor.cpp yet');
  }

  return res;
}

/* ---------- CLI ---------- */

function pluginsDir(cliDir) {
  if (cliDir) return path.resolve(cliDir);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apc.config.json'), 'utf8'));
    if (cfg.paths && cfg.paths.plugins_dir) return path.resolve(repoRoot, cfg.paths.plugins_dir);
  } catch { /* fall through */ }
  return path.join(repoRoot, 'plugins');
}

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || /^-/.test(args[0])) {
    console.error('Usage: node scripts/ui-lint.js <PluginName|pluginDir> [--plugins-dir DIR] [--map ui-map.json] [--html preview.html] [--json]');
    process.exit(2);
  }
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const json = args.includes('--json');
  let dir = path.resolve(args[0]);
  if (!fs.existsSync(dir)) dir = path.join(pluginsDir(opt('--plugins-dir')), args[0]);
  const res = validateUi(dir, { map: opt('--map'), html: opt('--html') });

  if (json) { console.log(JSON.stringify(res, null, 2)); process.exit(res.errors.length ? 1 : 0); }
  const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO' };
  console.log(`ui-lint: ${path.basename(dir)}`);
  for (const c of res.checks) console.log(`  ${icon[c.status]} ${c.check} — ${c.msg}`);
  console.log(`${res.errors.length} errors, ${res.warnings.length} warnings`);
  process.exit(res.errors.length ? 1 : 0);
}

if (require.main === module) main(process.argv);
module.exports = { validateUi };
