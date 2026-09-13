'use strict';
/* APC Hub live UI — vanilla JS, zero dependencies.
 * Reads hub/server.js /api/v1/* and renders the approved v009 language.
 * Sections switch via :target (hash IS the state); docs load lazily. */

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
async function api(p) {
  try {
    const r = await fetch('/api/v1/' + p);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
const okTok = (t) => '<span class="tok-ok">' + esc(t || '[OK]') + '</span>';
const warnTok = (t) => '<span class="tok-warn">' + esc(t || '[!!]') + '</span>';
const mutTok = (t) => '<span class="mut">' + esc(t) + '</span>';
const mono = (t) => '<span class="mono">' + esc(t) + '</span>';
function kicker(n, label, src) {
  return '<p class="kicker"><span class="n">' + esc(n) + '</span>// ' + esc(label) +
    (src ? ' — src: ' + esc(src) : '') + '</p>';
}
function pager(prev, prevLabel, next, nextLabel) {
  const l = prev ? '<a href="#' + prev + '">&lt; PREV</a>' : '<span class="mut">START</span>';
  const r = next ? '<a href="#' + next + '">NEXT &gt;</a>' : '<span class="mut">END</span>';
  return '<p class="mono pager">' + l + ' <span class="mut">|</span> ' + r + '</p>';
}
function table(headers, rows, grid) {
  return '<div class="scrollx"><table' + (grid === false ? '' : ' class="grid"') + '><tr>' +
    headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>' +
    rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</table></div>';
}
function valCell(v) {
  if (!v || !v.total) return mutTok('[ -- ]');
  const pend = v.total - v.passed;
  return '<span class="check">' +
    (v.passed ? '<span class="good">[x] ' + v.passed + '</span>' : '') +
    (v.passed && pend ? ' · ' : '') +
    (pend ? '<span class="mut">[ ] ' + pend + '</span>' : '') + '</span>';
}
function nextCommand(p) {
  const map = {
    ideation: 'plan', dream: 'plan', plan_complete: 'design', plan: 'design',
    design_complete: 'impl', design: 'impl', code_complete: 'test',
    test_complete: 'ship', ship_complete: null,
  };
  const act = Object.prototype.hasOwnProperty.call(map, p.phase) ? map[p.phase] : 'resume';
  if (act === null) return mutTok('complete');
  return mono('/apc-' + act + ' ' + p.name);
}

/* ─── tiny markdown renderer (headings/tables/code/lists/links/bold) ─── */
function mdInline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" rel="noopener">$1</a>');
  return out;
}
function mdTable(rows) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => mdInline(c.trim()));
  const head = cells(rows[0]);
  const body = rows.slice(2).filter((r) => /\|/.test(r));
  return '<div class="scrollx"><table><tr>' + head.map((h) => '<th>' + h + '</th>').join('') +
    '</tr>' + body.map((r) => '<tr>' + cells(r).map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') +
    '</table></div>';
}
function md(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0, list = null, para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + mdInline(para.join(' ')) + '</p>'; para = []; } };
  const flushList = () => { if (list) { html += '<' + list.t + '>' + list.items.map((x) => '<li>' + mdInline(x) + '</li>').join('') + '</' + list.t + '>'; list = null; } };
  let n = 0;
  const slug = (t) => 'h' + (++n) + '-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  while (i < lines.length) {
    const line = lines[i];
    const fenced = line.match(/^```(\w*)\s*$/);
    if (fenced) {
      flushPara(); flushList();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      html += '<pre><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      flushPara(); flushList();
      const lvl = Math.min(hm[1].length + 3, 6);
      const id = slug(hm[2]);
      html += '<h' + lvl + ' id="' + id + '"><a href="#' + id + '" class="mut">§</a> ' + mdInline(hm[2]) + '</h' + lvl + '>';
      i++;
      continue;
    }
    if (/\|/.test(line)) {
      const next = lines[i + 1] || '';
      if (/^\s*\|?\s*:?-{3,}/.test(next)) {
        flushPara(); flushList();
        const rows = [line, next];
        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(lines[i]); i++; }
        html += mdTable(rows);
        continue;
      }
    }
    if (/^---+\s*$/.test(line)) { flushPara(); flushList(); html += '<hr>'; i++; continue; }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); html += '<blockquote><p>' + mdInline(line.replace(/^>\s?/, '')) + '</p></blockquote>'; i++; continue; }
    const ul = line.match(/^[-*]\s+(.+)$/);
    const ol = line.match(/^\d+[.)]\s+(.+)$/);
    if (ul || ol) {
      flushPara();
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) { flushList(); list = { t, items: [] }; }
      list.items.push((ul ? ul[1] : ol[1]));
      i++;
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); i++; continue; }
    flushList();
    para.push(line.trim());
    i++;
  }
  flushPara(); flushList();
  return html;
}

/* ─── bookmarks (localStorage) ─── */
const BM_KEY = 'apc-hub-bookmarks';
function getBookmarks() {
  try { return new Set(JSON.parse(localStorage.getItem(BM_KEY) || '[]')); }
  catch { return new Set(); }
}
function toggleBookmark(id) {
  const s = getBookmarks();
  if (s.has(id)) s.delete(id); else s.add(id);
  try { localStorage.setItem(BM_KEY, JSON.stringify(Array.from(s))); } catch { /* ignore */ }
  paintBookmarks();
  const sec = document.getElementById('sec-' + id);
  if (sec) renderDocSection(id, true);
}
function paintBookmarks() {
  const s = getBookmarks();
  $$('#docnav a[data-doc]').forEach((a) => {
    const base = a.textContent.replace(/^[* ]/, '');
    a.textContent = (s.has(a.dataset.doc) ? '*' : ' ') + base;
  });
}

/* ─── theme (same contract as mockups) ─── */
const THEME_KEY = 'apc-hub-theme';
function paintTheme() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  $('#t-dark').textContent = dark ? '[*DARK]' : '[DARK]';
  $('#t-light').textContent = dark ? '[LIGHT]' : '[*LIGHT]';
  $('#t-dark').className = dark ? 'on' : '';
  $('#t-light').className = dark ? '' : 'on';
}
function setTheme(n) {
  document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem(THEME_KEY, n); } catch { /* ignore */ }
  paintTheme();
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

/* ─── section renderers ─── */
const docOrder = ['doc-readme', 'doc-build-system', 'doc-codex-compatibility',
  'doc-codex-orchestration', 'doc-command-reference', 'doc-faq', 'doc-github-actions',
  'doc-icon-management-guide', 'doc-installer-creation', 'doc-model-routing',
  'doc-plugin-development-lifecycle', 'doc-project-structure', 'doc-ship-workflow',
  'doc-state-management-deep-dive', 'doc-troubleshooting-guide', 'doc-webview-framework'];
const docShort = { 'doc-readme': 'README', 'doc-build-system': 'BUILD', 'doc-codex-compatibility': 'CODEX COMPAT', 'doc-codex-orchestration': 'CODEX ORCH', 'doc-command-reference': 'COMMANDS', 'doc-faq': 'FAQ', 'doc-github-actions': 'ACTIONS', 'doc-icon-management-guide': 'ICONS', 'doc-installer-creation': 'INSTALLER', 'doc-model-routing': 'MODELS', 'doc-plugin-development-lifecycle': 'LIFECYCLE', 'doc-project-structure': 'STRUCTURE', 'doc-ship-workflow': 'SHIP', 'doc-state-management-deep-dive': 'STATE', 'doc-troubleshooting-guide': 'TROUBLESHOOT', 'doc-webview-framework': 'WEBVIEW' };
const docCache = {};

function renderOverview(meta, cfg, update) {
  const rows = [
    ['Framework', mono('APC v' + meta.framework + ' (src: package.json)'), okTok()],
    ['Upstream release', update
      ? (update.state === 'CURRENT' ? mono('v' + update.installed + ' — current')
        : update.state === 'AVAILABLE' ? '<span class="tok-warn">[!!] UPDATE ' + esc(update.upstream) + ' AVAILABLE</span>'
        : mono('live check failed: ' + (update.reason || '?')))
      : mutTok('[..]'), update && update.state === 'CURRENT' ? okTok() : update && update.state === 'AVAILABLE' ? warnTok() : mutTok('[..]')],
  ];
  if (window.__pluginCounts) rows.push(['Plugins tracked', esc(window.__pluginCounts), okTok()]);
  const t = window.__tools;
  if (t) {
    rows.push(['JUCE pin', esc(t.juce.pin || '?') + ' — ' + mono('_tools/JUCE') + (t.juce.present ? ' present' : ' MISSING'), t.juce.present ? okTok() : warnTok()]);
    rows.push(['pluginval', mono('_tools/pluginval/pluginval.exe') + (t.pluginval.present ? ' present' : ' MISSING'), t.pluginval.present ? okTok() : warnTok()]);
    rows.push(['Configured dirs', mono([cfg.rel.plugins, cfg.rel.build, cfg.rel.release].join(' · ')) + (cfg.exists.plugins && cfg.exists.build && cfg.exists.release ? ' — all exist' : ' — CHECK'), (cfg.exists.plugins && cfg.exists.build && cfg.exists.release) ? okTok() : warnTok('[!!]')]);
  } else {
    rows.push(['System', mutTok('tools endpoint unreachable'), mutTok('[..]')]);
  }
  return kicker('01', 'OVERVIEW', 'apc.config.json + package.json') +
    table(['Metric', 'Value', 'Status'], rows) +
    pager(null, null, '02-projects');
}

function renderProjects(data) {
  const ps = data.plugins || [];
  const counts = {};
  ps.forEach((p) => { counts[p.phase] = (counts[p.phase] || 0) + 1; });
  window.__pluginCounts = ps.length + ' (' + Object.entries(counts).map(([k, v]) => v + ' ' + k.replace(/_complete$/, '').toUpperCase()).join(' / ') + ')';
  const rows = ps.map((p) => [
    '<b>' + esc(p.name) + '</b><br>' + mutTok(p.source),
    esc(p.version || '?'),
    p.phase ? '<span class="chip cur">[ ' + esc(p.phase.toUpperCase()) + ' ]</span>' : mutTok('[ -- ]'),
    esc((p.framework || '?').toUpperCase()),
    p.complexity == null ? '?' : p.complexity + '/5',
    valCell(p.validation),
    nextCommand(p),
  ]);
  let detail = '';
  const done = ps.find((p) => p.phase === 'ship_complete') || ps[0];
  if (done) {
    detail = '<h3>' + esc(done.name) + ' — detail</h3>' +
      '<p class="pipe mono">DREAM -&gt; PLAN -&gt; DESIGN -&gt; IMPL -&gt; ' +
      (done.phase === 'ship_complete' ? '<span class="chip cur">[ SHIP ]</span>' : esc(done.phase || '?')) + '</p>' +
      '<pre class="screen">' + Object.entries(done.validation ? done.validation.flags : {}).map(([k, v]) => (v ? '<span class="good">[x]</span>' : '<span class="mut">[ ]</span>') + ' ' + esc(k)).join('  ') + '</pre>';
  }
  const note = data.resolvedDir && !data.dirExists
    ? '<div class="banner mono">' + warnTok() + ' configured dir missing: ' + esc(data.resolvedDir) + '</div>' : '';
  return kicker('02', 'PROJECTS', '&lt;plugins_dir&gt;/*/status.json') + note +
    (ps.length ? table(['Plugin', 'Ver', 'Phase', 'UI', 'Cx', 'Validation', 'Next'], rows) + detail
      : '<div class="banner mono">' + warnTok() + ' no plugins found in ' + esc(data.configuredDir) + '</div>') +
    pager('01-overview', null, '03-skills');
}

function renderSkills(skills) {
  const rows = (skills || []).map((s) => [
    mono(s.id),
    s.id === 'audio-plugin-coder' ? 'Codex package (SKILL.md)' : (/^skill_/.test(s.id) ? 'legacy' : (/apc-setup/.test(s.id) ? 'phase' : 'phase/domain')),
    s.hasSkillMd ? (s.legacy ? warnTok('[LEGACY?]') + ' confirm in tidy-up' : okTok()) : warnTok('[!!]') + ' SKILL.md missing',
  ]);
  return kicker('03', 'SKILLS', '.agents/skills/ (' + (skills || []).length + ' dirs, single source of truth)') +
    table(['Skill dir', 'Kind', 'Flag'], rows) + pager('02-projects', null, '04-commands');
}

function renderCommands(cmds) {
  const prim = (cmds.primaries || []).map((c) => mono(c.command)).join(' · ');
  const alia = (cmds.aliases || []).map((c) => mono(c.command) + (c.resolves ? '' : ' ' + warnTok())).join(' · ');
  return kicker('04', 'COMMANDS', '.agents/workflows/ (' + (cmds.primaries || []).length + ' primary + ' + (cmds.aliases || []).length + ' aliases)') +
    table(['Primary', 'Alias', 'Codex form'], [[
      prim || mutTok('[..]'),
      alia || mutTok('[..]'),
      mono('$audio-plugin-coder:audio-plugin-coder &lt;action&gt; [Name]'),
    ]]) + pager('03-skills', null, '05-designs');
}

function renderDesigns(d) {
  const rows = (d.designs || []).map((g) => [
    '<b>' + esc(g.id) + '</b> — ' + esc(g.name || ''),
    esc(g.category || ''),
    Object.entries(g.colors || {}).map(([k, v]) => '<span class="sw" style="background:' + esc(v) + '"></span>' + mono(v)).join(' · '),
    esc(Object.entries(g.supports || {}).filter(([, v]) => v).map(([k]) => k).join(', ').toUpperCase() || '?'),
    esc((g.bestFor || []).join(', ')),
  ]);
  return kicker('05', 'DESIGNS', 'design_library/manifest.json' + (d.present ? ' (v' + d.version + ', ' + d.totalDesigns + ' designs)' : ' MISSING')) +
    (d.present ? table(['Design', 'Category', 'Colors', 'UI', 'Best for'], rows)
      : '<div class="banner mono">' + warnTok() + ' manifest not found</div>') +
    pager('04-commands', null, '06-scripts');
}

function renderScripts(s) {
  const groups = {};
  (s.entries || []).forEach((e) => { (groups[e.group] = groups[e.group] || []).push(e.file); });
  const rows = Object.keys(groups).sort().map((g) => [esc(g === 'root' ? 'root' : g + '/'), mono(groups[g].join(' · '))]);
  return kicker('06', 'SCRIPTS', 'scripts/ (' + (s.total || 0) + ' entries)') +
    table(['Group', 'Members'], rows) + pager('05-designs', null, '07-templates');
}

function renderTemplates(t) {
  const rows = Object.keys(t.groups || {}).sort().map((g) => [
    mono(g + '/'), String(t.groups[g].files), esc((t.groups[g].subdirs || []).join(', ')),
  ]);
  rows.push([mono('root'), String((t.rootFiles || []).length), esc((t.rootFiles || []).join(', '))]);
  return kicker('07', 'TEMPLATES', 'templates/') +
    table(['Template', 'Files', 'Notes'], rows) + pager('06-scripts', null, '08-tools');
}

function renderTools(t) {
  const rows = [
    [mono('JUCE ' + (t.juce.pin || '?') + ' (_tools/JUCE)'), t.juce.present ? 'present, matches pin' : 'MISSING', t.juce.present ? okTok() : warnTok()],
    [mono('pluginval.exe'), t.pluginval.present ? 'prebuilt binary present' : 'MISSING', t.pluginval.present ? okTok() : warnTok()],
    [mono('visage (_tools/visage)'), 'source ' + (t.visage.present ? 'present' : 'MISSING') + ', enable_visage=' + t.visage.enabled, t.visage.present ? okTok() : warnTok()],
    [mono('node ' + (t.toolchain.node || '?') + ' · python ' + (t.toolchain.python || '?') + ' · ' + (t.toolchain.cmake || 'cmake ?')), 'sampled live', okTok()],
  ];
  return kicker('08', 'TOOLS', '_tools/ + live toolchain') +
    table(['Tool', 'State', 'Status'], rows) + pager('07-templates', null, '09-settings');
}

function renderSettings(cfg) {
  const ex = cfg.example || {};
  const rows = [
    [mono('paths.plugins_dir'), mono(cfg.rel.plugins) + (cfg.exists.plugins ? ' <span class="good">[OK]</span>' : ' ' + warnTok()), mono((ex.paths || {}).plugins_dir || '?')],
    [mono('paths.build_dir'), mono(cfg.rel.build) + (cfg.exists.build ? ' <span class="good">[OK]</span>' : ' ' + warnTok()), mono((ex.paths || {}).build_dir || '?')],
    [mono('paths.release_dir'), mono(cfg.rel.release) + (cfg.exists.release ? ' <span class="good">[OK]</span>' : ' ' + warnTok()), mono((ex.paths || {}).release_dir || '?')],
    [mono('defaults'), mono('webview · visage ' + (((cfg.live || {}).defaults || {}).enable_visage ? 'on' : 'off')), mono('same')],
    [mono('models.profile'), mono(((cfg.live || {}).models || {}).profile || '?'), mono(((ex.models || {}).profile || '?'))],
    [mono('models.codex'), mono((((cfg.live || {}).models || {}).codex || {}).enabled ? 'enabled' : 'disabled'), mono('disabled')],
    [mono('setup'), mono('completed ' + ((((cfg.live || {}).setup || {}).completed_at) || '?').slice(0, 10) + ' · ' + ((((cfg.live || {}).setup || {}).platform) || '?')), mono('false')],
  ];
  return kicker('09', 'SETTINGS', 'apc.config.json (live) vs .example.json') +
    (cfg.livePresent ? '' : '<div class="banner mono">' + warnTok() + ' no live apc.config.json — showing example/defaults</div>') +
    table(['Key', 'Live', 'Example'], rows.map((r) => [r[0], r[1], r[2]])) +
    pager('08-tools', null, '10-documentation');
}

function renderConsistency(c) {
  const lvl = { ok: '<span class="good">[OK]</span>', warn: '<span class="tok-warn">[!!]</span>', fail: '<span class="tok-warn">[!!]</span>', na: '<span class="mut">[ -- ]</span>' };
  return kicker('++', 'CONSISTENCY', 'live checks (display only)') +
    '<pre class="screen">' + (c.checks || []).map((x) => (lvl[x.level] || lvl.na) + ' ' + esc(x.id) + ' — ' + esc(x.label)).join('\n') + '</pre>' +
    pager('doc-webview-framework', null, null);
}

/* ─── docs ─── */
function renderDocsIndex(docs) {
  const items = (docs.docs || []).map((d) =>
    '<details class="doc"' + (d.id === 'README' ? ' open' : '') + '><summary><b>' + esc(d.title) + '</b> <span class="p">— docs/' + esc(d.file) + ' · ' + d.chapterCount + ' §</span></summary>' +
    '<ol class="mono">' + d.chapters.map((c) => '<li>§ ' + esc(c) + '</li>').join('') + '</ol>' +
    '<p class="mono full"><a href="#doc-' + d.id.toLowerCase() + '">OPEN AS SECTION →</a></p></details>'
  ).join('');
  return kicker('10', 'DOCUMENTATION', 'docs/*.md · live (' + (docs.total || 0) + ' files, ' + (docs.totalChapters || 0) + ' chapters)') +
    '<p><input class="docsearch mono" id="docsearch" placeholder="FILTER DOCUMENTS + CHAPTERS — live"></p>' +
    '<div id="doclist">' + items + '</div>' +
    pager('09-settings', null, 'doc-readme');
}

function renderDocSection(id, force) {
  const sec = document.getElementById(id);
  if (!sec || (sec.dataset.loaded && !force)) return;
  const meta = (window.__docsMeta || {})[id];
  if (!meta) return;
  const raw = (docCache[id] || {}).raw;
  const bm = getBookmarks().has(id) ? '[*BOOKMARK]' : '[BOOKMARK]';
  sec.innerHTML =
    '<p class="kicker"><span class="n">DOC</span>// docs/' + esc(meta.file) + ' — live</p>' +
    '<h3>' + esc(meta.title) + ' <button class="mono" id="bm-' + id + '" style="font-size:12px;background:transparent;color:var(--ink);border:1px solid var(--rule);padding:0 8px;cursor:pointer">' + bm + '</button></h3>' +
    '<p class="mono mut" style="font-size:13px">' + meta.chapterCount + ' § · <a href="#10-documentation">BACK TO INDEX</a></p>' +
    '<div class="reader">' + (raw == null ? '<p class="mono mut">fetch failed — server unreachable? [..]</p>' : md(raw)) + '</div>' +
    pager(meta.prev, null, meta.next);
  sec.dataset.loaded = '1';
  const btn = document.getElementById('bm-' + id);
  if (btn) btn.onclick = () => toggleBookmark(id);
}

async function ensureDoc(id) {
  if (docCache[id]) { renderDocSection(id); return; }
  const meta = (window.__docsMeta || {})[id];
  const real = meta ? meta.real : id.replace(/^doc-/, '');
  const d = await api('docs/' + real);
  docCache[id] = d || { raw: null };
  renderDocSection(id);
}

function buildDocMeta(docs) {
  const order = (docs.docs || []).map((d) => 'doc-' + d.id.toLowerCase());
  const meta = {};
  order.forEach((id, i) => {
    const d = docs.docs[i];
    meta[id] = { real: d.id, file: d.file, title: d.title, chapterCount: d.chapterCount, prev: i === 0 ? '10-documentation' : order[i - 1], next: i === order.length - 1 ? '11-consistency' : order[i + 1] };
  });
  // fix tail: last doc pager NEXT → 11-consistency handled by meta.next above
  window.__docsMeta = meta;
  window.__docOrder = order;
  return { order, meta };
}

function renderDocShell(order) {
  return order.map((id) =>
    '<section id="' + id + '"><p class="mono mut">LOADING ' + esc(id) + '… [..]</p></section>'
  ).join('');
}

/* ─── boot ─── */
function setBadges(meta, cfg) {
  $('#badges').innerHTML =
    (meta.setupCompleted ? '<span class="badge ok">[OK] SETUP</span>' : '<span class="badge">SETUP INCOMPLETE</span>') +
    '<span class="badge">' + esc((meta.setupPlatform || '?').toUpperCase()) + ' · ' + esc((meta.modelProfile || '?').toUpperCase()) + '</span>' +
    '<span class="badge">APC v' + esc(meta.framework) + '</span>';
  $('#mark').innerHTML = '+--------------------+<br>| APC v' + esc(meta.framework).padEnd(13) + ' |<br>| <span class="mut">HUB · LIVE</span>       |<br>+--------------------+';
  $('#foot').innerHTML = '=== APC HUB · LIVE ===<br>APC v' + esc(meta.framework) + ' · hub server v' + esc(meta.hub) + ' · ' + esc(meta.time.slice(0, 10)) + ' · dark default · zero deps, system fonts, no images';
}
function setRel(meta, update) {
  const up = !update ? '<br>UPSTREAM <span class="mut">[..]</span>'
    : update.state === 'CURRENT' ? '<br>UPSTREAM <span class="good">[OK] CURRENT</span>'
    : update.state === 'AVAILABLE' ? '<br>UPSTREAM <span class="tok-warn">[!!] ' + esc(update.upstream) + '</span>'
    : '<br>UPSTREAM <span class="mut">[..] ' + esc(update.reason || '') + '</span>';
  $('#rel').innerHTML = 'REL v' + esc(meta.framework) + ' <span class="mut">(PKG)</span>' + up;
}

async function boot() {
  paintTheme();
  $('#t-dark').onclick = () => setTheme('dark');
  $('#t-light').onclick = () => setTheme('light');
  const [meta, cfg, plugins, skills, commands, designs, scripts, templates, tools, docs, update, consistency] =
    await Promise.all([api('meta'), api('config'), api('plugins'), api('skills'), api('commands'), api('designs'), api('scripts'), api('templates'), api('tools'), api('docs'), api('update'), api('consistency')]);
  window.__tools = tools;
  if (meta) setBadges(meta, cfg || {});
  if (meta) setRel(meta, update);
  const { order } = buildDocMeta(docs || { docs: [] });
  // submenu
  const nav = $('#docnav');
  (order || []).forEach((id) => {
    const m = window.__docsMeta[id];
    const short = (window.__docShort && window.__docShort[id]) || m.file.replace(/\.md$/, '').toUpperCase().slice(0, 14);
    const a = document.createElement('a');
    a.href = '#' + id;
    a.dataset.doc = id;
    a.textContent = ' ' + short;
    nav.appendChild(a);
  });
  paintBookmarks();
  // sections
  const main = $('#main');
  main.innerHTML =
    '<section id="01-overview">' + renderOverview(meta || {}, cfg || {}, update) + '</section>' +
    '<section id="02-projects">' + renderProjects(plugins || { plugins: [] }) + '</section>' +
    '<section id="03-skills">' + renderSkills((skills || {}).skills) + '</section>' +
    '<section id="04-commands">' + renderCommands(commands || {}) + '</section>' +
    '<section id="05-designs">' + renderDesigns(designs || {}) + '</section>' +
    '<section id="06-scripts">' + renderScripts(scripts || {}) + '</section>' +
    '<section id="07-templates">' + renderTemplates(templates || {}) + '</section>' +
    '<section id="08-tools">' + (tools ? renderTools(tools) : '<p class="mono">tools unreachable [..]</p>') + '</section>' +
    '<section id="09-settings">' + renderSettings(cfg || {}) + '</section>' +
    '<section id="10-documentation">' + renderDocsIndex(docs || { docs: [] }) + '</section>' +
    renderDocShell(order) +
    '<section id="11-consistency">' + renderConsistency(consistency || { checks: [] }) + '</section>';
  // docs search (live filter)
  const q = $('#docsearch');
  if (q) q.addEventListener('input', () => {
    const needle = q.value.trim().toLowerCase();
    $$('#doclist details.doc').forEach((d) => {
      d.style.display = !needle || d.textContent.toLowerCase().includes(needle) ? '' : 'none';
    });
  });
  // lazy doc bodies
  const load = () => {
    const h = (location.hash || '').replace('#', '');
    if (h.startsWith('doc-')) ensureDoc(h);
  };
  window.addEventListener('hashchange', load);
  load();
  if (!location.hash) location.hash = '#01-overview';
}
window.__docShort = { 'doc-readme': 'README', 'doc-build-system': 'BUILD', 'doc-codex-compatibility': 'CODEX COMPAT', 'doc-codex-orchestration': 'CODEX ORCH', 'doc-command-reference': 'COMMANDS', 'doc-faq': 'FAQ', 'doc-github-actions': 'ACTIONS', 'doc-icon-management-guide': 'ICONS', 'doc-installer-creation': 'INSTALLER', 'doc-model-routing': 'MODELS', 'doc-plugin-development-lifecycle': 'LIFECYCLE', 'doc-project-structure': 'STRUCTURE', 'doc-ship-workflow': 'SHIP', 'doc-state-management-deep-dive': 'STATE', 'doc-troubleshooting-guide': 'TROUBLESHOOT', 'doc-webview-framework': 'WEBVIEW' };
document.addEventListener('DOMContentLoaded', boot);
