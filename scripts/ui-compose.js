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
  knob:    (ctl, cls, style, ab) =>
    `<div class="${cls} apc-knob"${attrs(ctl, ab)} style="${style}">` +
    `<div class="apc-knob-dial"><div class="apc-knob-pointer"></div></div>${labelHtml(ctl.label)}</div>`,
  flip:    (ctl, cls, style, ab) =>
    `<div class="${cls} apc-flip"${attrs(ctl, ab)} style="${style}">` +
    `<button class="apc-flip-cap"><span class="apc-flip-value">${esc(ctl.value || (ctl.options && ctl.options[0]) || '')}</span></button>${labelHtml(ctl.label)}</div>`,
  psw:     (ctl, cls, style, ab) =>
    `<button class="${cls} apc-psw"${attrs(ctl, ab)} aria-checked="false" style="${style}">` +
    `<span class="led"></span><span>${esc(ctl.label || ctl.id)}</span></button>`,
  fader:   (ctl, cls, style, ab) =>
    `<div class="${cls} apc-fader"${attrs(ctl, ab)} style="${style}">` +
    `<div class="apc-fader-track"><div class="apc-fader-cap"></div></div>${labelHtml(ctl.label)}</div>`,
  screen:  (ctl, cls, style, ab) =>
    `<div class="${cls} apc-screen"${attrs(ctl, ab)} style="${style}">${esc(ctl.value || '—')}</div>`,
  chip:    (ctl, cls, style, ab) =>
    `<button class="${cls} apc-chip"${attrs(ctl, ab)} style="${style}">${esc(ctl.label || ctl.id)}</button>`,
  well:    (ctl, cls, style, ab) =>
    `<div class="${cls} apc-well"${attrs(ctl, ab)} style="${style}"><canvas${ctl.kind ? ` data-fit="fit_${ctl.id.replace(/-/g, '_')}"` : ''}></canvas></div>`,
  grip:    (ctl, cls, style, ab) =>
    `<div class="${cls} apc-grip"${attrs(ctl, ab)} style="${style}" title="Drag to resize"></div>`,
  section: (ctl, cls, style, ab) =>
    `<div class="${cls} apc-section"${attrs(ctl, ab)} style="${style}">${labelHtml(ctl.label)}</div>`,
  label:   (ctl, cls, style, ab) =>
    `<div class="${cls} apc-ctl-label"${attrs(ctl, ab)} style="${style}">${esc(ctl.label || ctl.value || ctl.id)}</div>`,
  custom:  (ctl, cls, style, ab) =>
    // as-built capture: a custom part renders as a labeled value box so the
    // preview shows the control's real footprint instead of an empty slot.
    `<div class="${cls} apc-flip"${attrs(ctl, ab)} style="${style}">` +
    `<button class="apc-flip-cap"><span class="apc-flip-value">${esc(ctl.value || (ctl.options && ctl.options[0]) || ctl.kind || ctl.id)}</span></button>${labelHtml(ctl.label)}</div>`,
};

function attrs(ctl, asBuilt) {
  // as-built manifests capture the production DOM — emit the real id so
  // preview annotations/parity target shipped elements, not ctl-* stubs.
  const bits = [` id="${asBuilt ? esc(ctl.id) : `ctl-${esc(ctl.id)}`}"`];
  if (ctl.param) bits.push(` data-param="${esc(ctl.param)}"`);
  return bits.join('');
}

/* ---------- compose ---------- */

/* Built-in preview painters for canvas.kind — let as-built maps show real
   meter/readout art without copying production draw code. Emitted as
   window.fit_<id> functions that apc-fit.js mounts via canvas[data-fit]. */
const CANVAS_PAINTERS = {
  'vu-meter': `function(ctx,w,h){
    var st=getComputedStyle(document.documentElement);
    var ink=st.getPropertyValue('--ink').trim()||'#28241d';
    var face=st.getPropertyValue('--day-meter-face').trim()||'#f2ecdc';
    var green=st.getPropertyValue('--accent').trim()||'#1f7a3d';
    var red='#d9531e', cx=w/2, cy=h*0.97, R=Math.min(w*0.46,h*0.88);
    var g=ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#f7f2e4'); g.addColorStop(1,face);
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
    function ang(db){return Math.PI*(1.15+0.7*(db+20)/23);}
    var ticks=[-20,-15,-10,-7,-5,-3,-2,-1,0,1,2,3];
    ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=R*0.008;
    ctx.beginPath();ctx.arc(cx,cy,R,ang(-20),ang(3));ctx.stroke();
    ctx.globalAlpha=.5;ctx.lineWidth=R*0.02;
    ctx.strokeStyle=green;ctx.beginPath();ctx.arc(cx,cy,R*0.90,ang(-7),ang(-1));ctx.stroke();
    ctx.globalAlpha=.25;ctx.strokeStyle=red;ctx.lineWidth=R*0.09;
    ctx.beginPath();ctx.arc(cx,cy,R*0.955,ang(0),ang(3));ctx.stroke();ctx.globalAlpha=1;
    ctx.strokeStyle=ink;ctx.lineWidth=R*0.012;
    ctx.font='bold '+Math.round(R*0.10)+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    for(var i=0;i<ticks.length;i++){var a=ang(ticks[i]),c1=Math.cos(a),s1=Math.sin(a);
      var maj=(ticks[i]===-20||ticks[i]===-10||ticks[i]===-7||ticks[i]===0||ticks[i]===3);
      ctx.beginPath();ctx.moveTo(cx+c1*R*(maj?0.86:0.91),cy+s1*R*(maj?0.86:0.91));
      ctx.lineTo(cx+c1*R,cy+s1*R);ctx.stroke();
      if(ticks[i]>-15&&ticks[i]<3&&ticks[i]%1===0){
        ctx.fillStyle=ticks[i]>=0?red:ink;
        ctx.fillText(ticks[i]>0?'+'+ticks[i]:''+ticks[i],cx+c1*R*0.74,cy+s1*R*0.74);}}
    ctx.fillStyle=ink;ctx.globalAlpha=.8;
    ctx.font='bold '+Math.round(R*0.16)+'px sans-serif';
    ctx.fillText('NOIZEFIELD',cx,cy-R*0.52);
    ctx.font=Math.round(R*0.075)+'px sans-serif';
    ctx.fillText('CHANNEL '+(label||''),cx,cy-R*0.36);
    ctx.globalAlpha=1;
    ctx.strokeStyle=ink;ctx.lineWidth=R*0.018;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(ang(-3))*R*0.82,cy+Math.sin(ang(-3))*R*0.82);ctx.stroke();
    ctx.fillStyle=ink;ctx.beginPath();ctx.arc(cx,cy,R*0.055,0,7);ctx.fill();
    ctx.fillStyle=red;ctx.beginPath();ctx.arc(w-R*0.12,h*0.10,R*0.035,0,7);ctx.fill();
    var sh=ctx.createLinearGradient(0,0,0,h*0.5);
    sh.addColorStop(0,'rgba(255,255,255,.28)');sh.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=sh;ctx.fillRect(0,0,w,h*0.5);
  }`,
  'led-readout': `function(ctx,w,h){
    ctx.fillStyle='#0a0906'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#4fc07a'; ctx.font='bold '+Math.floor(h*0.5)+'px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(label||'—',w/2,h/2);
  }`,
};

function compose(map) {
  const L = map.layout || {};
  const ab = map.kind === 'as-built';
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
  const hiddenCtls = [];
  for (const s of (map.sections || [])) {
    if (s.hidden) { hiddenCtls.push({ id: s.id, _sec: true }); continue; }
    parts.push(`    <div class="apc-cell apc-section" id="${ab ? esc(s.id) : `sec-${esc(s.id)}`}" style="${cellStyle(s.cell)}"><span class="apc-sec-tag">${esc(s.title || s.label || '')}</span></div>`);
  }
  for (const c of (map.canvases || []))
    parts.push(`    <div class="apc-cell apc-well" id="${ab ? esc(c.id) : `cv-${esc(c.id)}`}" style="${cellStyle(c.cell)}"><canvas${c.kind ? ` data-fit="fit_${c.id.replace(/-/g, '_')}"` : ''}></canvas></div>`);
  for (const ctl of (map.controls || [])) {
    if (ctl.hidden) { hiddenCtls.push(ctl); continue; } // real DOM element, not visible in this view
    const render = COMPONENTS[ctl.component] || COMPONENTS.custom;
    parts.push('    ' + render(ctl, 'apc-cell', cellStyle(ctl.cell), ab));
  }
  if ((L.resize_handle || 'corner-gripper') === 'corner-gripper' &&
      !(map.controls || []).some(c => c.component === 'grip'))
    parts.push('    <div class="apc-grip" id="ctl-grip" title="Drag to resize"></div>');

  const painterScript = (map.canvases || [])
    .filter(c => c.kind && CANVAS_PAINTERS[c.kind])
    .map(c => `window.fit_${c.id.replace(/-/g, '_')} = (function(label){ return ${CANVAS_PAINTERS[c.kind]}; })(${JSON.stringify(c.label || '')});`)
    .join('\n');

  const notes = (map.annotations || []).map(a => {
    if (typeof a === 'string') return `  [note] ${a}`;
    return `  [note] ${a.note}${a.target ? ` (on ${a.target})` : ''}`;
  }).join('\n');

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
</div>${hiddenCtls.length ? `
<!-- hidden in this view (e.g. settings sheet) — DOM ids kept for parity -->
<template id="apc-hidden">${hiddenCtls.map(c =>
  `<div id="${ab ? esc(c.id) : `ctl-${esc(c.id)}`}"${c.param ? ` data-param="${esc(c.param)}"` : ''}></div>`).join('')}</template>` : ''}
<script src="apc-ui/apc-fit.js"></script>
<script>
${painterScript}
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

  const versioned = path.basename(mapFile).match(/^v(\d+)-ui-map\.json$/);
  const outName = opt('--out') || (versioned ? `v${versioned[1]}-test.html` : 'v1-test.html');
  const outFile = path.join(designDir, outName);

  // as-built capture: the manifest documents a shipped UI, so the preview IS
  // the production file (pixel-faithful by definition). The map still drives
  // grid overlay / annotation / lint on top of it.
  if (map.kind === 'as-built' && map.source) {
    const src = path.resolve(dir, String(map.source));
    if (!fs.existsSync(src)) { console.error(`as-built source missing: ${src}`); process.exit(1); }
    fs.copyFileSync(src, outFile);
    console.log(`copied   ${outFile}  (${path.relative(repo, src)} → ${outName} — as-built verbatim)`);
    process.exit(0);
  }

  vendorKit(repo, designDir);
  fs.writeFileSync(outFile, compose(map));
  console.log(`composed ${outFile}  (${path.relative(repo, mapFile)} → ${outName}, kit → Design/apc-ui/)`);
}

if (require.main === module) main(process.argv);
module.exports = { compose, vendorKit, findMapFile, findRepoRoot, pluginsDir };
