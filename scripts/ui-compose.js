#!/usr/bin/env node
/* =============================================================================
   ui-compose.js — render a WebView design preview from Design/ui-map.json.

   The composer is the ONLY thing allowed to write layout code: it stamps
   catalog components onto absolute rem cells — the AI never authors CSS for
   the plate. See .agents/rules/ui-layout-system.md.

   Usage:
     node scripts/ui-compose.js <PluginName|pluginDir> [--map ui-map.json]
                                [--out v1-test.html] [--plugins-dir DIR]

   Zero dependencies, Node 18+. CommonJS so bin/apc.js can require it too.
   ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- repo + plugin resolution ---------- */

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

function pluginsDir(repoRoot, cliDir) {
  if (cliDir) return path.resolve(cliDir);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apc.config.json'), 'utf8'));
    if (cfg.paths && cfg.paths.plugins_dir)
      return path.resolve(repoRoot, cfg.paths.plugins_dir);
  } catch { /* fall through */ }
  return path.join(repoRoot, 'plugins');
}

function resolvePluginDir(arg, pdir) {
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return path.resolve(arg);
  const candidate = path.join(pdir, arg);
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

/* ---------- manifest discovery ---------- */

function findMapFile(designDir, explicit) {
  if (explicit) {
    const f = path.join(designDir, explicit);
    return fs.existsSync(f) ? f : null;
  }
  const canonical = path.join(designDir, 'ui-map.json');
  if (fs.existsSync(canonical)) return canonical;
  const versioned = fs.readdirSync(designDir)
    .filter(f => /^v(\d+)-ui-map\.json$/.test(f))
    .sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
  return versioned.length ? path.join(designDir, versioned[0]) : null;
}

/* ---------- component renderers ---------- */

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cellStyle = c => `left:${c.x}rem;top:${c.y}rem;width:${c.w}rem;height:${c.h}rem;`;
const labelHtml = l => l ? `<div class="apc-ctl-label">${esc(l)}</div>` : '';

const COMPONENTS = {
  knob:    (ctl, cls, style) =>
    `<div class="${cls} apc-knob"${attrs(ctl)} style="${style}">` +
    `<div class="apc-knob-dial"><div class="apc-knob-pointer"></div></div>${labelHtml(ctl.label)}</div>`,
  flip:    (ctl, cls, style) =>
    `<div class="${cls} apc-flip"${attrs(ctl)} style="${style}">` +
    `<button class="apc-flip-cap"><span class="apc-flip-value">${esc(ctl.value || (ctl.options && ctl.options[0]) || '')}</span></button>${labelHtml(ctl.label)}</div>`,
  psw:     (ctl, cls, style) =>
    `<button class="${cls} apc-psw"${attrs(ctl)} aria-checked="false" style="${style}">` +
    `<span class="led"></span><span>${esc(ctl.label || ctl.id)}</span></button>`,
  fader:   (ctl, cls, style) =>
    `<div class="${cls} apc-fader"${attrs(ctl)} style="${style}">` +
    `<div class="apc-fader-track"><div class="apc-fader-cap"></div></div>${labelHtml(ctl.label)}</div>`,
  screen:  (ctl, cls, style) =>
    `<div class="${cls} apc-screen"${attrs(ctl)} style="${style}">${esc(ctl.value || '—')}</div>`,
  chip:    (ctl, cls, style) =>
    `<button class="${cls} apc-chip"${attrs(ctl)} style="${style}">${esc(ctl.label || ctl.id)}</button>`,
  well:    (ctl, cls, style) =>
    `<div class="${cls} apc-well"${attrs(ctl)} style="${style}"><canvas${ctl.kind ? ` data-fit="fit_${ctl.id.replace(/-/g, '_')}"` : ''}></canvas></div>`,
  grip:    (ctl, cls, style) =>
    `<div class="${cls} apc-grip"${attrs(ctl)} style="${style}" title="Drag to resize"></div>`,
  section: (ctl, cls, style) =>
    `<div class="${cls} apc-section"${attrs(ctl)} style="${style}">${labelHtml(ctl.label)}</div>`,
  label:   (ctl, cls, style) =>
    `<div class="${cls} apc-ctl-label"${attrs(ctl)} style="${style}">${esc(ctl.label || ctl.value || ctl.id)}</div>`,
  custom:  (ctl, cls, style) =>
    `<div class="${cls} apc-custom"${attrs(ctl)} style="${style}"></div>`,
};

function attrs(ctl) {
  const bits = [` id="ctl-${ctl.id}"`];
  if (ctl.param) bits.push(` data-param="${esc(ctl.param)}"`);
  return bits.join('');
}

/* ---------- compose ---------- */

function compose(map) {
  const L = map.layout || {};
  const cols = L.plate && L.plate.cols, rows = L.plate && L.plate.rows;
  const cellPx = L.cell_px || 16;
  const letterbox = (L.letterbox_fill || '--surface').replace(/^--/, '--');
  const tokens = map.tokens || {};

  const varLines = [`  --cols: ${cols};`, `  --rows: ${rows};`];
  if (/^-/.test(letterbox)) varLines.push(`  --apc-letterbox: var(${letterbox});`);
  else varLines.push(`  --apc-letterbox: ${letterbox};`);
  for (const [k, v] of Object.entries(tokens))
    varLines.push(`  ${k.startsWith('--') ? k : '--' + k}: ${v};`);

  const rootStyle = `:root {\n${varLines.join('\n')}\n}`;
  const fixedCss = L.mode === 'fixed' ? `\nhtml { font-size: ${cellPx}px; }` : '';

  const parts = [];
  for (const s of (map.sections || []))
    parts.push(`    <div class="apc-cell apc-section" id="sec-${esc(s.id)}" style="${cellStyle(s.cell)}">${esc(s.label || '')}</div>`);
  for (const c of (map.canvases || []))
    parts.push(`    <div class="apc-cell apc-well" id="cv-${esc(c.id)}" style="${cellStyle(c.cell)}"><canvas${c.kind ? ` data-fit="fit_${c.id.replace(/-/g, '_')}"` : ''}></canvas></div>`);
  for (const ctl of (map.controls || [])) {
    const render = COMPONENTS[ctl.component] || COMPONENTS.custom;
    parts.push('    ' + render(ctl, 'apc-cell', cellStyle(ctl.cell)));
  }
  if ((L.resize_handle || 'corner-gripper') === 'corner-gripper' &&
      !(map.controls || []).some(c => c.component === 'grip'))
    parts.push('    <div class="apc-grip" id="ctl-grip" title="Drag to resize"></div>');

  const notes = (map.annotations || []).map(a => `  [note] ${a.note}${a.target ? ` (on ${a.target})` : ''}`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(map.name)} — APC design preview</title>
<link rel="stylesheet" href="apc-ui/apc-core.css">
<link rel="stylesheet" href="apc-ui/apc-components.css">
<style>
${rootStyle}
${fixedCss}
</style>
</head>
<body>
  <!-- composed from ui-map.json — do not hand-edit layout; edit the map -->
<div class="apc-plate">
${parts.join('\n')}
</div>
<script src="apc-ui/apc-fit.js"></script>
<script>
  document.addEventListener("DOMContentLoaded", function () {
    if (window.APC) APC.mountKit(document);
  });
</script>
${notes ? `<!--\n${notes}\n-->\n` : ''}</body>
</html>
`;
}

/* ---------- kit vendoring ---------- */

function vendorKit(repoRoot, destDir) {
  const src = path.join(repoRoot, 'templates', 'webview', 'apc-ui');
  const dst = path.join(destDir, 'apc-ui');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src))
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  return dst;
}

/* ---------- CLI ---------- */

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || /^-/.test(args[0])) {
    console.error('Usage: node scripts/ui-compose.js <PluginName|pluginDir> [--map ui-map.json] [--out file.html] [--plugins-dir DIR]');
    process.exit(2);
  }
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const repo = findRepoRoot();
  const dir = resolvePluginDir(args[0], pluginsDir(repo, opt('--plugins-dir')));
  if (!dir) { console.error(`plugin not found: ${args[0]}`); process.exit(2); }

  const designDir = path.join(dir, 'Design');
  const mapFile = findMapFile(designDir, opt('--map'));
  if (!mapFile) { console.error(`no ui-map in ${designDir}`); process.exit(1); }
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

  vendorKit(repo, designDir);

  const versioned = path.basename(mapFile).match(/^v(\d+)-ui-map\.json$/);
  const outName = opt('--out') || (versioned ? `v${versioned[1]}-test.html` : 'v1-test.html');
  const outFile = path.join(designDir, outName);
  fs.writeFileSync(outFile, compose(map));
  console.log(`composed ${outFile}  (${path.relative(repo, mapFile)} → ${outName}, kit → Design/apc-ui/)`);
}

if (require.main === module) main(process.argv);
module.exports = { compose, vendorKit, findMapFile, findRepoRoot, pluginsDir };
