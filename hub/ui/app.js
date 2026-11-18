'use strict';
/* APC Hub live UI - vanilla JS, zero dependencies.
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
    (src ? ' - src: ' + esc(src) : '') + '</p>';
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
      ? (update.state === 'CURRENT' ? mono('v' + update.installed + (update.reason ? ' - ' + update.reason : ' - current'))
        : update.state === 'AVAILABLE' ? '<span class="tok-warn">[!!] UPDATE ' + esc(update.upstream) + ' AVAILABLE</span>' + (update.url ? ' <a href="' + esc(update.url) + '" target="_blank" rel="noopener">OPEN -&gt;</a>' : '')
        : mono('check: ' + (update.reason || '?')))
      : mutTok('[..]'), (update && update.state === 'CURRENT' ? okTok() : update && update.state === 'AVAILABLE' ? warnTok() : mutTok('[..]')) +
      ' <button class="mono minibtn" id="btn-recheck" title="Ask GitHub for the latest release now">[RE-CHECK]</button>'],
  ];
  if (window.__pluginCounts) rows.push(['Plugins tracked', esc(window.__pluginCounts), okTok()]);
  const t = window.__tools;
  if (t) {
    rows.push(['JUCE pin', esc(t.juce.pin || '?') + ' - ' + mono('_tools/JUCE') + (t.juce.present ? ' present' : ' MISSING'), t.juce.present ? okTok() : warnTok()]);
    rows.push(['pluginval', mono(t.pluginval.path) + (t.pluginval.present ? ' present' : ' MISSING'), t.pluginval.present ? okTok() : warnTok()]);
    rows.push(['Configured dirs', mono([cfg.rel.plugins, cfg.rel.build, cfg.rel.release].join(' · ')) + (cfg.exists.plugins && cfg.exists.build && cfg.exists.release ? ' - all exist' : ' - CHECK'), (cfg.exists.plugins && cfg.exists.build && cfg.exists.release) ? okTok() : warnTok('[!!]')]);
  } else {
    rows.push(['System', mutTok('tools endpoint unreachable'), mutTok('[..]')]);
  }
  return kicker('01', 'OVERVIEW', 'apc.config.json + package.json') +
    table(['Metric', 'Value', 'Status'], rows) +
    pager(null, null, '02-projects');
}

async function refreshUpdate() {
  const btn = document.getElementById('btn-recheck');
  if (btn) btn.textContent = '[CHECKING..]';
  const u = await api('update?refresh=1');
  if (u) {
    window.__update = u;
    setRel(window.__meta, u);
    const sec = document.getElementById('01-overview');
    if (sec) {
      sec.innerHTML = renderOverview(window.__meta, window.__cfg, u);
      wireRecheck();
    }
  } else if (btn) btn.textContent = '[RE-CHECK]';
}
function wireRecheck() {
  const btn = document.getElementById('btn-recheck');
  if (btn) btn.onclick = refreshUpdate;
}

function stageOf(phase) {
  const ph = String(phase || '').toLowerCase();
  if (/ship/.test(ph)) return 4;
  if (/test|code|impl/.test(ph)) return 3;
  if (/design/.test(ph)) return 2;
  if (/plan/.test(ph)) return 1;
  return 0;
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
  const stages = ['DREAM', 'PLAN', 'DESIGN', 'IMPL', 'SHIP'];
  const cards = ps.map((p) => {
    const st = stageOf(p.phase);
    const stage = stages.map((s, i) =>
      '<span class="' + (i < st ? 'done' : i === st ? 'cur' : '') + '">' + s + '</span>').join('');
    const flags = p.validation ? Object.entries(p.validation.flags || {}) : [];
    const failed = flags.filter(([, v]) => !v).map(([k]) => k);
    const vnum = p.validation && p.validation.total
      ? '<span class="vn ' + (failed.length ? 'bad' : 'ok') + '">' + p.validation.passed + '/' + p.validation.total + ' checks</span>'
      : '<span class="mut">no validation</span>';
    const failChips = failed.map((f) => '<span class="flagx">' + esc(f) + '</span>').join(' ');
    const when = p.lastPhaseAt ? '<span class="when">last ' + esc(String(p.lastPhaseAt).slice(0, 10)) + '</span>' : '';
    return '<div class="pcard">' +
      '<div class="ph"><b>' + esc(p.name) + '</b>' +
        '<span class="meta">' + esc(p.version || '?') + ' &middot; ' + esc((p.framework || '?').toUpperCase()) + '</span>' +
        (p.phase ? '<span class="chip cur">' + esc(p.phase.replace(/_complete$/, '').toUpperCase()) + '</span>' : '') +
      '</div>' +
      '<div class="stage">' + stage + '</div>' +
      '<div class="vrow">' + vnum + failChips + when + '</div>' +
      '<div class="dlinks mono" data-dl="' + esc(p.name) + '"></div>' +
    '</div>';
  }).join('');
  const note = data.resolvedDir && !data.dirExists
    ? '<div class="banner mono">' + warnTok() + ' configured dir missing: ' + esc(data.resolvedDir) + '</div>' : '';
  return kicker('02', 'PROJECTS', '<plugins_dir>/*/status.json') + note +
    (ps.length ? table(['Plugin', 'Ver', 'Phase', 'UI', 'Cx', 'Validation', 'Next'], rows) +
        '<div class="pcards">' + cards + '</div>'
      : '<div class="banner mono">' + warnTok() + ' no plugins found in ' + esc(data.configuredDir) + '</div>') +
    pager('01-overview', null, '03-skills');
}

/* Lazily fills each plugin's design links: raw previews open via /pdesign,
   [annotate] opens the repo-level review tool (/uipreview) in a new tab. */
function enrichPluginDesignLinks(ps) {
  (ps || []).forEach((p) => {
    const host = document.querySelector('.dlinks[data-dl="' + p.name.replace(/"/g, '') + '"]');
    if (!host) return;
    api('plugins/' + encodeURIComponent(p.name)).then((d) => {
      const files = (d && d.artifacts && d.artifacts.design) || [];
      const html = files.filter((f) => /\.html?$/i.test(f) && !/^test-local/i.test(f));
      const hasMap = files.some((f) => /(^|v\d+-)ui-map\.json$/i.test(f));
      const prodLink = '<a class="ann" href="/uipreview?plugin=' + encodeURIComponent(p.name) +
        '&amp;prod=1" target="_blank" rel="noopener">[as-built]</a>';
      host.innerHTML = (html.length ? html.map((f) => {
        const fe = encodeURIComponent(f);
        return '<a href="/pdesign/' + encodeURIComponent(p.name) + '/' + fe + '" target="_blank" rel="noopener">' + esc(f) + '</a>' +
          ' <a class="ann" href="/uipreview?plugin=' + encodeURIComponent(p.name) + '&amp;file=' + fe + '" target="_blank" rel="noopener">[annotate]</a>';
      }).join(' · ') + ' ' : '') +
        prodLink +
        (hasMap ? ' <span class="good">· ui-map</span>' : ' <span class="mut">· no ui-map</span>');
    }).catch(() => {});
  });
}

function renderSkills(skills) {
  const rows = (skills || []).map((s) => [
    mono(s.id),
    s.id === 'audio-plugin-coder' ? 'Codex package (SKILL.md)'
      : s.aliasStub ? 'alias - keep as redirect'
      : s.legacy ? 'legacy - needs decision'
      : /^skill_/.test(s.id) ? 'domain' : 'phase',
    s.hasSkillMd ? (s.aliasStub ? okTok('[ALIAS]') : s.legacy ? warnTok('[LEGACY?]') + ' confirm in tidy-up' : okTok()) : warnTok('[!!]') + ' SKILL.md missing',
  ]);
  return kicker('03', 'SKILLS', '.agents/skills/ (' + (skills || []).length + ' dirs, single source of truth)') +
    table(['Skill dir', 'Kind', 'Flag'], rows) + pager('02-projects', null, '04-commands');
}

const CMD_ORDER = ['setup', 'dream', 'plan', 'design', 'impl', 'implement', 'test', 'debug', 'ship', 'status', 'resume', 'new', 'hub'];
function renderCommands(cmds) {
  const primaries = (cmds.primaries || []).slice();
  primaries.push({ command: '/apc-hub', description: 'Open the APC Hub live dashboard (read-only command center)' });
  const aliasByTarget = {};
  (cmds.aliases || []).forEach((a) => {
    if (a.pointsTo) {
      (aliasByTarget[a.pointsTo] = aliasByTarget[a.pointsTo] || []).push(a);
    }
  });
  primaries.sort((a, b) => {
    const ia = CMD_ORDER.indexOf(a.command.replace('/apc-', ''));
    const ib = CMD_ORDER.indexOf(b.command.replace('/apc-', ''));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const rows = primaries.map((c) => {
    const action = c.command.replace('/apc-', '');
    const al = (aliasByTarget[c.command] || []).map((a) => mono(a.command) + (a.resolves ? '' : ' ' + warnTok('[!!]'))).join('<br>') || mutTok('-');
    return [
      mono(c.command),
      al,
      mono('$audio-plugin-coder:audio-plugin-coder ' + action),
      esc(c.description || 'see workflow file'),
    ];
  });
  return kicker('04', 'COMMANDS', '.agents/workflows/ (' + primaries.length + ' primary + ' + (cmds.aliases || []).length + ' deprecated aliases)') +
    table(['Command', 'Alias', 'Codex action', 'What it does'], rows) +
    '<p class="mono mut" style="font-size:13px">Codex form: $audio-plugin-coder:audio-plugin-coder &lt;action&gt; [Name] - aliases are deprecated, prefer /apc-*.</p>' +
    pager('03-skills', null, '05-designs');
}

function renderDesigns(d) {
  const rows = (d.designs || []).map((g) => {
    const files = (g.htmlFiles || []).map((f) => {
      const fe = String(f).split('/').map(encodeURIComponent).join('/');
      return '<a href="/preview/' + encodeURIComponent(g.id) + '/' + fe + '" target="_blank" rel="noopener">' + esc(f) + '</a>' +
        ' <a class="mut" href="/uipreview?design=' + encodeURIComponent(g.id) + '&amp;file=' + fe + '" target="_blank" rel="noopener">[annotate]</a>';
    }).join('<br>') || mutTok('no HTML files');
    const miss = (g.missingExamples || []).length
      ? '<br>' + warnTok('[!!]') + ' <span class="mut">manifest lists missing: ' + esc(g.missingExamples.join(', ')) + '</span>' : '';
    /* a design may ship a thumbnail of its plugin surface (design_library/<id>/<file>) */
    const thumb = g.thumbnail
      ? '<img class="design-thumb" loading="lazy" alt="' + esc((g.name || g.id) + ' - plugin surface') + '"' +
        ' src="/preview/' + encodeURIComponent(g.id) + '/' + String(g.thumbnail).split('/').map(encodeURIComponent).join('/') + '">'
      : '';
    const name = thumb + '<b>' + esc(g.id) + '</b> - ' + esc(g.name || '') + '<br>' + files + miss;
    const present = (ok, file) => (file ? (ok ? okTok('[OK]') : warnTok('[NOT FOUND]')) + ' ' + mono(file) : mutTok('not declared'));
    const fileCell = '<span style="font-size:12.5px;white-space:nowrap">tokens: ' + present(g.tokensExists, g.tokens) + '<br>spec: ' + present(g.specExists, g.spec) + '</span>' +
      '<br><a class="mono" href="#09c-kit" data-kit-open="' + esc(g.id) + '" title="Reference plugin, theme editor and element spec of this design">[open in KIT]</a>';
    return [
      name,
      esc(g.category || ''),
      Object.entries(g.colors || {}).map(([k, v]) => '<span class="sw" style="background:' + esc(v) + '"></span>' + mono(v)).join(' · '),
      esc(Object.entries(g.supports || {}).filter(([, v]) => v).map(([k]) => k).join(', ').toUpperCase() || '?'),
      esc((g.bestFor || []).join(', ')),
      fileCell,
    ];
  });
  return kicker('05', 'DESIGNS', 'design_library/manifest.json' + (d.present ? ' (v' + d.version + ', ' + d.totalDesigns + ' designs)' : ' MISSING')) +
    '<div class="banner mono design-note"><b>Define, preview and tweak designs in <a href="#09c-kit">09c KIT</a></b>: reference plugin, theme editor, element spec. This page indexes design_library/.</div>' +
    (d.present ? table(['Design', 'Category', 'Colors', 'UI', 'Best for', 'Files'], rows)
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
    [mono(t.pluginval.path), t.pluginval.present ? 'prebuilt binary present' : 'MISSING', t.pluginval.present ? okTok() : warnTok()],
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
  const live = cfg.live || {};
  const cx = live.models && live.models.codex ? live.models.codex : {};
  const PHASES = ['dream', 'plan', 'design', 'impl', 'test', 'debug', 'ship', 'status', 'resume', 'setup'];
  const TIERS = ['luna', 'terra', 'sol', 'astra'];
  const fin = (id, v) => '<input class="mono" id="' + id + '" value="' + esc(v == null ? '' : v) + '">';
  const fchk = (id, b) => '<input type="checkbox" id="' + id + '"' + (b ? ' checked' : '') + '>';
  const fsel = (id, v, opts) => '<select class="mono" id="' + id + '">' + opts.map((o) =>
    '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>';
  const ph = (live.models && live.models.phases) || {};
  const phaseRows = PHASES.map((p) => {
    const o = ph[p] || {};
    return '<tr><td>' + mono(p) + '</td><td>' + fin('f-ph-' + p + '-provider', o.provider || 'auto') + '</td><td>' + fin('f-ph-' + p + '-model', o.model || '') + '</td></tr>';
  }).join('');
  const tierRows = TIERS.map((t) => {
    const o = (cx.tiers || {})[t] || {};
    return '<tr><td>' + mono(t) + '</td><td>' + fin('f-tier-' + t + '-model', o.model || '') + '</td><td>' +
      fin('f-tier-' + t + '-profile', o.profile || t) + '</td><td>' + fin('f-tier-' + t + '-reasoning', o.reasoning || '') + '</td><td>' +
      fin('f-tier-' + t + '-max', o.max_attempts == null ? '' : o.max_attempts) + '</td></tr>';
  }).join('');
  const esc2 = cx.escalation || {};
  return kicker('09', 'SETTINGS', 'apc.config.json (live) vs .example.json') +
    (cfg.livePresent ? '' : '<div class="banner mono">' + warnTok() + ' no live apc.config.json (' + esc(cfg.liveError || 'unknown') + ') - form starts from defaults</div>') +
    table(['Key', 'Live', 'Example'], rows.map((r) => [r[0], r[1], r[2]])) +
    '<h3>EDIT ALL SETTINGS - writes apc.config.json (backup .bak first)</h3>' +
    '<fieldset><legend>PATHS</legend>' +
    '<div class="frow"><span class="mono">plugins_dir</span>' + fin('f-plugins_dir', (live.paths || {}).plugins_dir) + '</div>' +
    '<div class="frow"><span class="mono">build_dir</span>' + fin('f-build_dir', (live.paths || {}).build_dir) + '</div>' +
    '<div class="frow"><span class="mono">release_dir</span>' + fin('f-release_dir', (live.paths || {}).release_dir) + '</div></fieldset>' +
    '<fieldset><legend>DEFAULTS</legend>' +
    '<div class="frow"><span class="mono">ui_framework_preference</span>' + fsel('f-ui', ((live.defaults || {}).ui_framework_preference) || 'webview', ['webview', 'visage']) + '</div>' +
    '<div class="frow"><span class="mono">enable_visage</span><span>' + fchk('f-visage', !!((live.defaults || {}).enable_visage)) + '</span></div></fieldset>' +
    '<fieldset><legend>MODELS</legend>' +
    '<div class="frow"><span class="mono">profile</span>' + fin('f-profile', (live.models || {}).profile || 'balanced') + '</div>' +
    '<div class="scrollx"><table><tr><th>Phase</th><th>Provider</th><th>Model</th></tr>' + phaseRows + '</table></div></fieldset>' +
    '<fieldset><legend>CODEX</legend>' +
    '<div class="frow"><span class="mono">enabled</span><span>' + fchk('f-cx-enabled', !!cx.enabled) + '</span></div>' +
    '<div class="frow"><span class="mono">default_tier</span>' + fin('f-cx-tier', cx.default_tier || 'terra') + '</div>' +
    '<div class="scrollx"><table><tr><th>Tier</th><th>Model</th><th>Profile</th><th>Reasoning</th><th>Max attempts</th></tr>' + tierRows + '</table></div>' +
    '<div class="frow"><span class="mono">escalation.enabled</span><span>' + fchk('f-esc-enabled', !!esc2.enabled) + '</span></div>' +
    '<div class="frow"><span class="mono">escalation.order</span>' + fin('f-esc-order', (esc2.order || []).join(', ')) + '</div>' +
    '<div class="frow"><span class="mono">escalation.on_build_fail</span><span>' + fchk('f-esc-onfail', esc2.on_build_fail !== false) + '</span></div></fieldset>' +
    '<fieldset><legend>SETUP</legend>' +
    '<div class="frow"><span class="mono">completed</span><span>' + fchk('f-setup-completed', !!((live.setup || {}).completed)) + '</span></div>' +
    '<div class="frow"><span class="mono">completed_at / platform</span><span class="mono mut">' + esc(((live.setup || {}).completed_at) || '-') + ' / ' + esc(((live.setup || {}).platform) || '-') + ' (kept)</span></div></fieldset>' +
    '<p class="mono"><button class="mono minibtn" id="cfg-save">[SAVE]</button> <button class="mono minibtn" id="cfg-reset">[RESET]</button> <span id="cfg-msg"></span></p>' +
    pager('08-tools', null, '09b-standards');
}

function wireSettings() {
  const save = document.getElementById('cfg-save');
  if (!save) return;
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const chk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
  document.getElementById('cfg-reset').onclick = () => {
    document.getElementById('09-settings').innerHTML = renderSettings(window.__cfg);
    wireSettings();
  };
  save.onclick = async () => {
    const msg = document.getElementById('cfg-msg');
    const live = (window.__cfg && window.__cfg.live) || {};
    const out = JSON.parse(JSON.stringify(live));
    out.version = 1;
    out.juce = out.juce || { required_major: 9, pin: '9.0.1' };
    out.paths = { plugins_dir: val('f-plugins_dir') || 'plugins', build_dir: val('f-build_dir') || 'build', release_dir: val('f-release_dir') || 'release' };
    out.defaults = { ui_framework_preference: val('f-ui') || 'webview', enable_visage: chk('f-visage') };
    out.models = out.models || {};
    out.models.profile = val('f-profile') || 'balanced';
    out.models.phases = out.models.phases || {};
    ['dream', 'plan', 'design', 'impl', 'test', 'debug', 'ship', 'status', 'resume', 'setup'].forEach((p) => {
      out.models.phases[p] = { provider: val('f-ph-' + p + '-provider') || 'auto', model: val('f-ph-' + p + '-model') || '' };
    });
    out.models.codex = out.models.codex || {};
    out.models.codex.enabled = chk('f-cx-enabled');
    out.models.codex.default_tier = val('f-cx-tier') || 'terra';
    out.models.codex.tiers = out.models.codex.tiers || {};
    ['luna', 'terra', 'sol', 'astra'].forEach((t) => {
      const prev = out.models.codex.tiers[t] || {};
      const mx = parseInt(val('f-tier-' + t + '-max'), 10);
      out.models.codex.tiers[t] = {
        model: val('f-tier-' + t + '-model') || prev.model || '',
        profile: val('f-tier-' + t + '-profile') || t,
        reasoning: val('f-tier-' + t + '-reasoning') || prev.reasoning || 'medium',
        max_attempts: isNaN(mx) ? (prev.max_attempts == null ? 1 : prev.max_attempts) : mx,
      };
    });
    out.models.codex.escalation = out.models.codex.escalation || {};
    out.models.codex.escalation.enabled = chk('f-esc-enabled');
    out.models.codex.escalation.order = val('f-esc-order').split(',').map((s) => s.trim()).filter(Boolean);
    out.models.codex.escalation.on_build_fail = chk('f-esc-onfail');
    out.setup = out.setup || {};
    const wasCompleted = !!out.setup.completed;
    out.setup.completed = chk('f-setup-completed');
    if (out.setup.completed && !wasCompleted && !out.setup.completed_at) {
      out.setup.completed_at = new Date().toISOString();
    }
    msg.innerHTML = ' <span class="mut">[SAVING..]</span>';
    try {
      const r = await fetch('/api/v1/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(out),
      });
      const j = await r.json();
      if (j && j.ok) {
        msg.innerHTML = ' ' + okTok('[OK]') + ' saved' + (j.backup ? ' (backup .bak)' : '') + ' - reloading..';
        setTimeout(() => location.reload(), 900);
      } else {
        msg.innerHTML = ' ' + warnTok('[!!]') + ' rejected: ' + esc((j && j.error) || r.status);
      }
    } catch {
      msg.innerHTML = ' ' + warnTok('[!!]') + ' request failed';
    }
  };
}

/* ─── 09b STANDARDS (decision X-06) ───
   Lists every option from schemas/apc-standards.json. Global-scope options are
   editable (saved through the one write path, POST /api/v1/config, with the
   rest of apc.config.json untouched). Plugin-scope options are READ-ONLY here:
   those answers are decided once in /apc-plan and changed with the CLI. */
function stdFmt(o, v) {
  if (v === null || v === undefined) return '(unset)';
  if (o.type === 'boolean') return v ? 'on' : 'off';
  return String(v);
}
function stdSrcFile(src, plugin) {
  if (src === 'plugin') return (plugin ? plugin.statusFile : '<plugin>/status.json');
  if (src === 'global') return 'apc.config.json';
  return 'schemas/apc-standards.json';
}
function stdCli(o) {
  const hint = o.type === 'enum' ? '<' + (o.values || []).join('|') + '>'
    : o.type === 'boolean' ? '<true|false>' : o.type === 'number' ? '<number>' : '<text>';
  return 'apc standards set ' + o.id + ' ' + hint + ' --plugin <Name>';
}
function stdControl(o, cur) {
  const lbl = ' aria-label="' + esc(o.id) + '"';
  if (o.type === 'boolean') {
    return '<label><input type="checkbox" data-sid="' + esc(o.id) + '"' + lbl + (cur ? ' checked' : '') + '>' +
      '<span class="state mono">' + (cur ? '[ON]' : '[OFF]') + '</span></label>';
  }
  if (o.type === 'enum') {
    return '<select class="mono" data-sid="' + esc(o.id) + '"' + lbl + '>' + (o.values || []).map((v) =>
      '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>';
  }
  if (o.type === 'number') {
    return '<input type="number" class="mono" data-sid="' + esc(o.id) + '"' + lbl +
      (o.minimum !== undefined ? ' min="' + esc(o.minimum) + '"' : '') +
      (o.maximum !== undefined ? ' max="' + esc(o.maximum) + '"' : '') +
      ' value="' + esc(cur == null ? '' : cur) + '">';
  }
  return '<input type="text" class="mono" data-sid="' + esc(o.id) + '"' + lbl + ' value="' + esc(cur == null ? '' : cur) + '">';
}
function renderStdOption(o, S) {
  const eff = S.global.effective[o.id] || { value: o.default, source: 'default' };
  const isGlobal = o.scope === 'global';
  const open = o.status === 'open';
  const edit = (S.edits || {})[o.id];
  let cur = eff.value;
  let srcLabel = eff.source;
  if (edit) {
    cur = edit.op === 'set' ? edit.value : o.default;
    srcLabel = edit.op === 'set' ? 'edited (unsaved)' : 'default (override removed, unsaved)';
  }
  const head = '<div class="idl mono">' + esc(o.id) +
    ' <span class="chip">' + esc(o.decision || '?') + '</span> <span class="chip' + (isGlobal ? ' cur' : '') + '">' + esc(String(o.scope).toUpperCase()) + '</span>' +
    (o.required ? ' <span class="chip">REQUIRED</span>' : '') +
    (open ? '<span class="tok-open mono">[OPEN] placeholder</span>' : '') +
    ' <button type="button" class="mono minibtn std-more" data-std-more="' + esc(o.id) + '" aria-expanded="false"' +
    ' title="What this decision is about: ' + esc(o.decision || o.id) + '">[?]</button></div>';
  let ctl;
  if (isGlobal) {
    const hasOverride = Object.prototype.hasOwnProperty.call(S.global.block, o.id) || (edit && edit.op === 'set');
    ctl = stdControl(o, cur) +
      (hasOverride ? ' <button class="mono minibtn" data-sunset="' + esc(o.id) + '" aria-label="Remove override for ' + esc(o.id) + ' (use default)">[DEFAULT]</button>' : '');
  } else {
    ctl = '<span class="mono">default: ' + esc(stdFmt(o, o.default)) + '</span><br><span class="mut mono">read-only here [PLUGIN]</span>';
  }
  const src = isGlobal
    ? 'value ' + esc(stdFmt(o, cur)) + ' &middot; source: ' + esc(srcLabel) + ' &rarr; ' + esc(stdSrcFile(edit ? 'default' : eff.source)) +
      ' &middot; registry default ' + esc(stdFmt(o, o.default))
    : 'scope plugin &middot; asked once in /apc-plan &middot; stored in &lt;plugin&gt;/status.json &rarr; standards &middot; registry default ' + esc(stdFmt(o, o.default));
  const cli = isGlobal ? '' : '<div class="cli mono">CLI: ' + esc(stdCli(o)) + '</div>';
  const openNote = open
    ? '<div class="src mono"><span class="tok-warn">[!!]</span> decision ' + esc(o.decision) + ' is still OPEN - treat the value as a placeholder, not a commitment.</div>' : '';
  return '<div class="std-opt ' + (isGlobal ? 'global' : 'plugin') + (open ? ' open' : '') + (edit ? ' dirty' : '') + '" data-id="' + esc(o.id) + '">' +
    head + '<div class="ctl">' + ctl + '</div>' +
    '<div class="sum">' + esc(o.summary || '') + '</div>' +
    '<div class="src mono">' + src + '</div>' + cli + openNote + '</div>';
}
function renderStdPlugin(p, S) {
  const plugOpts = [];
  S.groups.forEach((g) => g.options.forEach((o) => { if (o.scope === 'plugin') plugOpts.push(o); }));
  const setN = plugOpts.filter((o) => Object.prototype.hasOwnProperty.call(p.block, o.id)).length;
  const missingReq = p.issues.filter((i) => /required at plan time/.test(i.message)).length;
  const otherIssues = p.issues.filter((i) => !/required at plan time/.test(i.message));
  const rows = plugOpts.map((o) => {
    const e = p.effective[o.id] || { value: o.default, source: 'default' };
    const set = e.source === 'plugin';
    return [
      mono(o.id) + (o.status === 'open' ? ' <span class="tok-open mono">[OPEN]</span>' : ''),
      mono(stdFmt(o, e.value)),
      (set ? okTok('[SET]') : (o.required ? warnTok('[REQUIRED]') : mutTok('[ -- ]'))) + ' ' + mono(stdSrcFile(e.source, p)),
    ];
  });
  const sum = setN + '/' + plugOpts.length + ' answered' + (missingReq ? ' - ' + missingReq + ' required missing' : '') +
    (otherIssues.length ? ' - ' + otherIssues.length + ' issue(s)' : '');
  return '<details class="std-pl"><summary class="mono"><b>' + esc(p.name) + '</b> <span class="mut">- ' + esc(sum) + ' - ' + esc(p.statusFile) + '</span></summary>' +
    (otherIssues.length || p.warnings.length ? '<pre class="screen">' +
      otherIssues.map((i) => '[!!] ' + esc(i.message)).concat(p.warnings.map((w) => '[..] ' + esc(w.message))).join('\n') + '</pre>' : '') +
    table(['Option', 'Effective value', 'State / source file'], rows) +
    '<p class="mono mut" style="font-size:12.5px">Read-only. Answer in /apc-plan or run: apc standards set &lt;id&gt; &lt;value&gt; --plugin ' + esc(p.name) + '</p></details>';
}
function renderStandards(S) {
  const src = 'schemas/apc-standards.json + apc.config.json + &lt;plugin&gt;/status.json';
  const k = '<p class="kicker"><span class="n">09b</span>// STANDARDS - src: ' + src + '</p>';
  if (!S) {
    return k + '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' /api/v1/standards unreachable - expected endpoint of this hub</div>' +
      pager('09-settings', null, '09c-kit');
  }
  if (!S.registryFound) {
    return k + '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' ' + esc(S.expected || 'schemas/apc-standards.json') +
      '<br><span class="mut">' + esc(S.error || '') + '</span></div>' + pager('09-settings', null, '09c-kit');
  }
  const all = [];
  S.groups.forEach((g) => g.options.forEach((o) => all.push(o)));
  const nGlobal = all.filter((o) => o.scope === 'global').length;
  const open = all.filter((o) => o.status === 'open');
  const live = S.global.livePresent;
  const rules = (S.fixedRules || []).map((r) => '<li>' + esc(r.rule) + ' <span class="mut mono">(' + esc(r.decision) + ')</span></li>').join('');
  const groupsFor = (scope) => S.groups.map((g) => ({ title: g.title, options: g.options.filter((o) => o.scope === scope) }))
    .filter((g) => g.options.length)
    .map((g) => '<h3 class="std-grp">' + esc(g.title) + ' <span class="mut mono" style="font-size:12px">(' + g.options.length + ')</span></h3>' +
      g.options.map((o) => renderStdOption(o, S)).join('')).join('');
  const dirtyN = Object.keys(S.edits || {}).length;
  const openDecisions = open.map((o) => o.decision).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return k +
    '<div class="banner mono">registry ' + esc(S.schema) + ' v' + esc(S.version) + ' (locked ' + esc(S.locked) + ') &middot; ' + all.length + ' options: ' +
    nGlobal + ' global (editable here) + ' + (all.length - nGlobal) + ' plugin (read-only here)' +
    (open.length ? '<br>' + warnTok('[!!]') + ' ' + open.length + ' option(s) follow OPEN decisions (' + esc(openDecisions) + ') - placeholders' : '') +
    '</div>' +
    (live ? '' : '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' apc.config.json (' + esc(S.global.liveError || 'missing') + ') - global values show registry defaults; run /apc-setup before editing</div>') +
    ((S.global.issues || []).length ? '<pre class="screen">' + S.global.issues.map((i) => '[!!] apc.config.json: ' + esc(i.message)).join('\n') + '</pre>' : '') +
    '<p class="full">Global options are APC-wide defaults and are saved to apc.config.json (backup .bak first). Plugin options are answered once per plugin in /apc-plan and are shown read-only.</p>' +
    '<h3>FIXED IN STONE (no option, all products)</h3><ul class="mono" style="font-size:13px">' + rules + '</ul>' +
    '<h3>GLOBAL OPTIONS (' + nGlobal + ') - editable here</h3>' + groupsFor('global') +
    '<p class="mono std-act"><button class="mono minibtn" id="std-save"' + (live && dirtyN ? '' : ' disabled') + '>[SAVE GLOBAL]</button> ' +
    '<button class="mono minibtn" id="std-reset"' + (dirtyN ? '' : ' disabled') + '>[DISCARD EDITS]</button> ' +
    '<span id="std-msg" role="status">' + (dirtyN ? '<span class="mut">' + dirtyN + ' unsaved change(s)</span>' : '') + '</span></p>' +
    '<h3>PLUGIN OPTIONS (' + (all.length - nGlobal) + ') - read-only here, decided per plugin in /apc-plan</h3>' + groupsFor('plugin') +
    '<h3>PER-PLUGIN ANSWERS (read-only)</h3>' +
    (S.plugins.length ? S.plugins.map((p) => renderStdPlugin(p, S)).join('')
      : '<div class="banner mono">' + warnTok() + ' no plugins with status.json found</div>') +
    pager('09-settings', null, '09c-kit');
}
function stdRerender() {
  const sec = document.getElementById('09b-standards');
  if (!sec) return;
  const box = $('.content');
  const y = box ? box.scrollTop : 0;
  sec.innerHTML = renderStandards(window.__std);
  wireStandards();
  if (box) box.scrollTop = y;
}
function stdOptionById(id) {
  let found = null;
  ((window.__std && window.__std.groups) || []).forEach((g) => g.options.forEach((o) => { if (o.id === id) found = o; }));
  return found;
}
function stdReadControl(el, o) {
  if (o.type === 'boolean') return el.checked;
  if (o.type === 'number') return el.value === '' ? NaN : Number(el.value);
  return el.value;
}
/* ─── decision details: the "what is this about" panel ─────────────────────── */
function stdOption(id) {
  const S = window.__std; if (!S || !S.groups) return null;
  for (const g of S.groups) for (const o of (g.options || [])) if (o.id === id) return o;
  return null;
}
function stdDrawer() {
  let d = document.getElementById('std-drawer');
  if (d) return d;
  d = document.createElement('aside');
  d.id = 'std-drawer';
  d.className = 'std-drawer';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-label', 'Decision details');
  d.hidden = true;
  d.innerHTML = '<div class="sd-head"><span class="mono sd-title">DECISION</span>' +
    '<button type="button" class="mono minibtn" id="std-drawer-x">[CLOSE]</button></div>' +
    '<div class="sd-body" id="std-drawer-body"></div>';
  document.body.appendChild(d);
  d.querySelector('#std-drawer-x').addEventListener('click', stdDrawerClose);
  return d;
}
function stdDrawerClose() {
  const d = document.getElementById('std-drawer');
  if (d) d.hidden = true;
  const b = document.querySelector('[data-std-more][aria-expanded="true"]');
  if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
}
function stdDetailsHtml(o, S) {
  const eff = (S.global && S.global.effective && S.global.effective[o.id]) || { value: o.default, source: 'default' };
  const edit = (S.edits || {})[o.id];
  const cur = edit ? (edit.op === 'set' ? edit.value : o.default) : eff.value;
  const srcLabel = edit ? 'edited (unsaved)' : eff.source;
  const notes = o.valueNotes || {};
  let choices = '';
  if (o.type === 'enum') {
    choices = (o.values || []).map((v) => [v, notes[v] || '', v === o.default]);
  } else if (o.type === 'boolean') {
    choices = [['on', notes['true'] || '', o.default === true], ['off', notes['false'] || '', o.default === false]];
  } else if (o.type === 'number') {
    choices = [['range', (o.minimum != null ? o.minimum : '?') + ' … ' + (o.maximum != null ? o.maximum : '?') + ', default ' + o.default, true]];
  }
  return '<div class="sd-top mono"><span class="chip">' + esc(o.decision || '?') + '</span> <b>' + esc(o.id) + '</b> ' +
      '<span class="chip">' + esc(String(o.scope).toUpperCase()) + '</span>' + (o.required ? ' <span class="chip">REQUIRED</span>' : '') +
      (o.status === 'open' ? ' <span class="tok-open mono">[OPEN]</span>' : '') + '</div>' +
    '<p class="sd-q">' + esc(o.question || '') + '</p>' +
    '<p class="sd-sum">' + esc(o.summary || '') + '</p>' +
    '<h4>WHY THIS EXISTS</h4>' +
    (o.why ? '<p>' + esc(o.why) + '</p>'
           : '<p class="mut">No extended note yet. Add a <code>why</code> string to this option in <code>schemas/apc-standards.json</code>.</p>') +
    (choices.length ? '<h4>CHOICES</h4><ul class="sd-choices">' + choices.map(([v, note, dflt]) =>
      '<li' + (dflt ? ' class="is-default"' : '') + '><code>' + esc(String(v)) + '</code>' +
      (dflt ? ' <span class="chip">DEFAULT</span>' : '') +
      (note ? '<span class="sd-note">' + esc(note) + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
    '<h4>ENFORCED BY</h4>' +
    (o.enforced && o.enforced.length
      ? '<ul class="sd-list">' + o.enforced.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
      : '<p class="mut">Not documented yet.</p>') +
    '<h4>CURRENT VALUE</h4><p class="mono">' + esc(stdFmt(o, cur)) +
      ' <span class="mut">&middot; source: ' + esc(srcLabel) + ' &rarr; ' + esc(stdSrcFile(edit ? 'default' : eff.source)) + '</span></p>' +
    '<h4>STORED IN</h4><p class="mono">' +
      (o.scope === 'global' ? 'apc.config.json &rarr; standards &rarr; ' + esc(o.id)
                            : '&lt;plugin&gt;/status.json &rarr; standards &rarr; ' + esc(o.id)) + '</p>';
}
function stdDrawerOpen(id) {
  const S = window.__std, o = stdOption(id);
  if (!S || !o) return;
  const d = stdDrawer();
  document.getElementById('std-drawer-body').innerHTML = stdDetailsHtml(o, S);
  d.hidden = false;
  document.querySelectorAll('[data-std-more]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.stdMore === id)));
  const x = d.querySelector('#std-drawer-x');
  if (x) x.focus();
}

function wireStandards() {
  const sec = document.getElementById('09b-standards');
  const S = window.__std;
  if (!sec || !S || !S.registryFound) return;
  S.edits = S.edits || {};
  $$('[data-sid]', sec).forEach((el) => {
    el.addEventListener('change', () => {
      const o = stdOptionById(el.dataset.sid);
      if (!o) return;
      const v = stdReadControl(el, o);
      if (o.type === 'number' && Number.isNaN(v)) delete S.edits[o.id];
      else S.edits[o.id] = { op: 'set', value: v };
      stdRerender();
    });
  });
  $$('[data-sunset]', sec).forEach((b) => {
    b.addEventListener('click', () => { S.edits[b.dataset.sunset] = { op: 'unset' }; stdRerender(); });
  });
  const reset = document.getElementById('std-reset');
  if (reset) reset.onclick = () => { S.edits = {}; stdRerender(); };
  /* [?] on any decision opens the details panel */
  sec.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-std-more]') : null;
    if (b) stdDrawerOpen(b.dataset.stdMore);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stdDrawerClose(); });
  const save = document.getElementById('std-save');
  if (save) save.onclick = async () => {
    const msg = document.getElementById('std-msg');
    msg.innerHTML = '<span class="mut">[SAVING..]</span>';
    // Re-read first: never overwrite a newer apc.config.json with a stale copy.
    const fresh = await api('config');
    if (!fresh || !fresh.livePresent) { msg.innerHTML = warnTok('[!!]') + ' no live apc.config.json - run /apc-setup first'; return; }
    const out = JSON.parse(JSON.stringify(fresh.live));
    const block = (out.standards && typeof out.standards === 'object' && !Array.isArray(out.standards)) ? out.standards : {};
    Object.entries(S.edits).forEach(([id, e]) => { if (e.op === 'set') block[id] = e.value; else delete block[id]; });
    out.standards = block;
    try {
      const r = await fetch('/api/v1/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
      const j = await r.json();
      if (j && j.ok) {
        window.__cfg = (await api('config')) || window.__cfg;
        const next = await api('standards');
        if (next) { next.edits = {}; window.__std = next; }
        stdRerender();
        const m2 = document.getElementById('std-msg');
        if (m2) m2.innerHTML = okTok('[OK]') + ' saved to apc.config.json' + (j.backup ? ' (backup .bak)' : '');
      } else {
        msg.innerHTML = warnTok('[!!]') + ' rejected: ' + esc((j && j.error) || r.status) +
          (j && j.issues ? '<br>' + j.issues.map((i) => esc(i.message)).join('<br>') : '');
      }
    } catch { msg.innerHTML = warnTok('[!!]') + ' request failed'; }
  };
}

/* ─── 09c KIT: reference plugin, theme editor, element spec, component gallery: see kit.js ─── */

function renderVideos() {
  return kicker('11', 'VIDEOS', 'YouTube tutorial series - 7 episodes and more to come') +
    '<div class="vidwrap"><iframe src="https://www.youtube.com/embed/videoseries?list=PLEOCbFL_Mq4o" title="APC YouTube tutorial series" allow="picture-in-picture" allowfullscreen></iframe></div>' +
    '<p class="mono"><a href="https://www.youtube.com/playlist?list=PLEOCbFL_Mq4o" target="_blank" rel="noopener">OPEN PLAYLIST ON YOUTUBE -&gt;</a></p>' +
    '<p class="mut" style="font-size:13px">Explains the framework in detail: setup, workflow, plugins, and more.</p>' +
    pager('doc-webview-framework', null, '11-consistency');
}

function renderConsistency(c) {
  const lvl = { ok: '<span class="good">[OK]</span>', warn: '<span class="tok-warn">[!!]</span>', fail: '<span class="tok-warn">[!!]</span>', na: '<span class="mut">[ -- ]</span>' };
  return kicker('++', 'CONSISTENCY', 'live checks (display only)') +
    '<pre class="screen">' + (c.checks || []).map((x) => (lvl[x.level] || lvl.na) + ' ' + esc(x.id) + ' - ' + esc(x.label)).join('\n') + '</pre>' +
    pager('11-videos', null, null);
}

/* ─── docs ─── */
function renderDocsIndex(docs) {
  const items = (docs.docs || []).map((d) =>
    '<details class="doc"' + (d.id === 'README' ? ' open' : '') + '><summary><b>' + esc(d.title) + '</b> <span class="p">- docs/' + esc(d.file) + ' · ' + d.chapterCount + ' §</span></summary>' +
    '<ol class="mono">' + d.chapters.map((c) => '<li>§ ' + esc(c) + '</li>').join('') + '</ol>' +
    '<p class="mono full"><a href="#' + docSlug(d) + '">OPEN AS SECTION -&gt;</a></p></details>'
  ).join('');
  return kicker('10', 'DOCUMENTATION', 'docs/*.md · live (' + (docs.total || 0) + ' files, ' + (docs.totalChapters || 0) + ' chapters)') +
    '<p><input class="docsearch mono" id="docsearch" placeholder="FILTER DOCUMENTS + CHAPTERS - live"></p>' +
    '<div id="doclist">' + items + '</div>' +
    pager('09c-kit', null, 'doc-readme');
}

function renderDocSection(id, force) {
  const sec = document.getElementById(id);
  if (!sec || (sec.dataset.loaded && !force)) return;
  const meta = (window.__docsMeta || {})[id];
  if (!meta) return;
  const raw = (docCache[id] || {}).raw;
  const bm = getBookmarks().has(id) ? '[*BOOKMARK]' : '[BOOKMARK]';
  sec.innerHTML =
    '<p class="kicker"><span class="n">DOC</span>// docs/' + esc(meta.file) + ' - live</p>' +
    '<h3>' + esc(meta.title) + ' <button class="mono" id="bm-' + id + '" style="font-size:12px;background:transparent;color:var(--ink);border:1px solid var(--rule);padding:0 8px;cursor:pointer">' + bm + '</button></h3>' +
    '<p class="mono mut" style="font-size:13px">' + meta.chapterCount + ' § · <a href="#10-documentation">BACK TO INDEX</a></p>' +
    '<div class="reader">' + (raw == null ? '<p class="mono mut">fetch failed - server unreachable? [..]</p>' : md(raw)) + '</div>' +
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

function docSlug(d) {
  return 'doc-' + String(d.id || d).toLowerCase().replace(/_/g, '-');
}

function buildDocMeta(docs) {
  const order = (docs.docs || []).map(docSlug);
  const meta = {};
  order.forEach((id, i) => {
    const d = docs.docs[i];
    meta[id] = { real: d.id, file: d.file, title: d.title, chapterCount: d.chapterCount, prev: i === 0 ? '10-documentation' : order[i - 1], next: i === order.length - 1 ? '11-videos' : order[i + 1] };
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
    '<a class="badge amber" href="https://github.com/Noizefield/audio-plugin-coder" target="_blank" rel="noopener">APC v' + esc(meta.framework) + '</a>';
  $('#foot').innerHTML = '=== APC HUB - LIVE ===<br>APC v' + esc(meta.framework) + ' - hub server v' + esc(meta.hub) + ' - ' + esc(meta.time.slice(0, 10)) + ' - dark default - zero deps, system fonts, no images';
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
  const [meta, cfg, plugins, skills, commands, designs, scripts, templates, tools, docs, update, consistency, standards, kit] =
    await Promise.all([api('meta'), api('config'), api('plugins'), api('skills'), api('commands'), api('designs'), api('scripts'), api('templates'), api('tools'), api('docs'), api('update'), api('consistency'), api('standards'), api('kit')]);
  window.__std = standards ? Object.assign(standards, { edits: {} }) : null;
  window.__tools = tools;
  window.__meta = meta || {};
  window.__cfg = cfg || {};
  window.__update = update;
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
    '<section id="09b-standards">' + renderStandards(window.__std) + '</section>' +
    '<section id="09c-kit">' + renderKit(kit) + '</section>' +
    '<section id="10-documentation">' + renderDocsIndex(docs || { docs: [] }) + '</section>' +
    renderDocShell(order) +
    '<section id="11-videos">' + renderVideos() + '</section>' +
    '<section id="11-consistency">' + renderConsistency(consistency || { checks: [] }) + '</section>';
  enrichPluginDesignLinks((plugins || {}).plugins || []);
  // docs search (live filter)
  const q = $('#docsearch');
  if (q) q.addEventListener('input', () => {
    const needle = q.value.trim().toLowerCase();
    $$('#doclist details.doc').forEach((d) => {
      d.style.display = !needle || d.textContent.toLowerCase().includes(needle) ? '' : 'none';
    });
  });
  // lazy doc bodies + submenu active paint (covers every doc id, incl. future ones)
  const load = () => {
    const h = (location.hash || '').replace('#', '');
    /* older links used #09c-kit/theme; fold them into ?kit=theme#09c-kit, otherwise they
       would match no section and fall through to 01-overview */
    if (h.indexOf('/') > 0) {
      const [b, s] = h.split('/');
      if (b === '09c-kit' && s) {
        const q = new URLSearchParams(location.search);
        q.set('kit', s);
        location.replace(location.pathname + '?' + q.toString() + '#' + b);
        return;
      }
    }
    const base = h.split('/')[0];
    if (h.startsWith('doc-')) ensureDoc(h);
    if (base === '09c-kit') {
      kitActivate();   // the demo iframe loads only once the page is opened
      /* the four KIT sections are subpages; they travel in the query because a section is
         shown by CSS :target and an id can never be "09c-kit/theme" */
      const sub = new URLSearchParams(location.search).get('kit');
      if (sub && window.__kit && typeof window.kitSetTab === 'function') {
        window.kitSetTab(window.__kit, sub, { noUrl: true });
      }
    }
    /* a decision can be linked: #09b-standards/ux.theme opens its details panel */
    if (base === '09b-standards' && h.indexOf('/') > 0) {
      if (window.__std && window.__std.registryFound) stdDrawerOpen(h.split('/')[1]);
    }
    paintDocActive(base);
  };
  window.addEventListener('hashchange', load);
  window.addEventListener('popstate', load);   // back/forward across ?kit=<section>
  wireRecheck();
  wireSettings();
  wireStandards();
  wireKit();
  paintDocActive((location.hash || '').replace('#', ''));
  load();
  if (!location.hash) location.hash = '#01-overview';
  else { // deep link (e.g. /#09b-standards): sections only exist now, so re-apply :target
    const h = location.hash;
    location.hash = '';
    location.hash = h;
  }
}

function paintDocActive(hash) {
  $$('#docnav a[data-doc]').forEach((a) => {
    const on = a.dataset.doc === hash;
    a.classList.toggle('on', on);
  });
}
window.__docShort = { 'doc-readme': 'README', 'doc-build-system': 'BUILD', 'doc-codex-compatibility': 'CODEX COMPAT', 'doc-codex-orchestration': 'CODEX ORCH', 'doc-command-reference': 'COMMANDS', 'doc-faq': 'FAQ', 'doc-github-actions': 'ACTIONS', 'doc-icon-management-guide': 'ICONS', 'doc-installer-creation': 'INSTALLER', 'doc-model-routing': 'MODELS', 'doc-plugin-development-lifecycle': 'LIFECYCLE', 'doc-project-structure': 'STRUCTURE', 'doc-ship-workflow': 'SHIP', 'doc-state-management-deep-dive': 'STATE', 'doc-troubleshooting-guide': 'TROUBLESHOOT', 'doc-webview-framework': 'WEBVIEW' };
document.addEventListener('DOMContentLoaded', boot);
