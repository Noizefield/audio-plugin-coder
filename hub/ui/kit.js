'use strict';
/* APC Hub - 09c KIT page (vanilla JS, zero dependencies).
 *
 * TOP        the canonical APC Minimal reference from hub/_design/apc_filter_f30_annotate_v006.html
 *            served unchanged in a sandboxed iframe (/kit-demo/_reference).
 * TABS       COMPONENTS (the live gallery, one component per demo page), THEME EDITOR (live design tokens),
 *            ELEMENT SPEC (design-system.json -> elements as a spec sheet), COVERAGE (standards table).
 * Source of truth: GET /api/v1/kit (catalog + facts), GET /api/v1/design/<id> (tokens.css + design-system.json).
 * Theme-token drafts stay in localStorage and export as before. Validated element tuning can be saved to the
 * selected design's design-system.json through the loopback-only tuning endpoint.
 * Helpers ($, $$, esc, api, table, mono, okTok, warnTok, mutTok, pager) come from app.js (call-time globals). */

const KIT_KEY = 'apc-hub-kit';
const KIT_SCALES = [50, 100, 200, 300];            // component demo pages
const KIT_REF_SCALES = [50, 100, 150, 200];        // reference plugin: 100 % = the width of the stage
const KIT_CELL_PX = 16;                            // 1 rem = 1 grid cell = 16 px at 100 %
const KIT_TABS = [['components', 'COMPONENTS'], ['theme', 'THEME EDITOR'], ['spec', 'ELEMENT SPEC'], ['coverage', 'COVERAGE']];
const KIT_DRAFT_KEY = 'apc-hub-kit-theme-draft:';
const KIT_ELEMENT_DRAFT_KEY = 'apc-hub-kit-element-draft:';
// APC Minimal maps the library token names onto the canonical v006 face tokens.
// The source document itself is served byte-for-byte; these aliases are applied
// only as Hub preview overrides when someone edits a global token.
const KIT_SOURCE_TOKEN_MAP = {
  '--apc-letterbox': '--void', '--surface': '--void', '--plate-2': '--panel', '--plate-3': '--panel-2', '--inset': '--well',
  '--rule': '--rule-ctl', '--grip-ink': '--rule-ctl',
  '--accent': '--sig', '--accent-ink': '--on-sig', '--ok': '--sig-2', '--apc-danger': '--danger', '--apc-focus': '--sig',
  '--viz-line': '--ink', '--viz-accent': '--sig', '--viz-fill': '--soft', '--viz-grid': '--grid', '--viz-axis': '--ink-3',
  '--meter-ok': '--sig-2', '--meter-warn': '--warn', '--meter-clip': '--danger', '--led-on': '--sig', '--led-off': '--led-off',
  '--step-off': '--well', '--step-on': '--sig', '--step-accent': '--ink', '--step-playhead': '--sig-2',
  '--font-text': '--font-ui', '--t-label': '--t-cap', '--t-value': '--t-val', '--t-readout': '--t-val-s', '--label-spacing': '--tr-label',
  '--r-control': '--r-ctl', '--r-panel': '--r-block', '--stroke': '--hair', '--stroke-2': '--hair', '--sh-knob': '--knob-shadow',
  '--knob-size': '--apc-tune-knob-diameter', '--knob-arc': '--apc-tune-knob-arc', '--slider-len': '--apc-tune-slider-length',
  '--track-w': '--apc-tune-track-thickness', '--thumb': '--apc-tune-thumb-size',
  '--apc-shadow-pop': '--card-shadow',
};
const KIT_SOURCE_STYLE_TOKENS = new Set(['--knob-size', '--knob-arc', '--slider-len', '--track-w', '--thumb']);
function kitSourceTokenName(name) { return KIT_SOURCE_TOKEN_MAP[name] || name; }
function kitSourceTokenValue(value) {
  return String(value).replace(/var\(\s*(--[A-Za-z0-9_-]+)/g, (all, name) => 'var(' + kitSourceTokenName(name));
}

/* ─── state ─── */
function kitLoadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KIT_KEY) || 'null'); } catch { /* ignore */ }
  return s && typeof s === 'object' ? s : {};
}
function kitSaveState() {
  const K = window.__kit;
  if (!K) return;
  try {
    localStorage.setItem(KIT_KEY, JSON.stringify({ sel: K.sel, theme: K.theme, scenario: K.scenario, scale: K.scale, mode: K.mode,
      tab: K.tab, refScale: K.refScale }));
  } catch { /* ignore */ }
}
function kitComp(K, name) { return (K.data.components || []).find((c) => c.name === name) || null; }
function kitThemes(K) { return (K.data.themes.items || []); }
function kitThemeInfo(K, id) { return id === 'default' ? null : kitThemes(K).find((t) => t.id === id) || null; }
function kitThemeName(K) {
  if (K.theme === 'default') return 'kit defaults';
  const t = kitThemeInfo(K, K.theme);
  return t && t.title ? t.title : K.theme;
}
function kitModes(K) {                                  // the API field `modes` of the selected design
  const t = kitThemeInfo(K, K.theme);
  return t && Array.isArray(t.modes) && t.modes.length ? t.modes : ['night', 'day'];
}
function kitDemoUrl(K) {
  const c = kitComp(K, K.sel);
  if (!c || !c.demo.url) return null;
  const q = ['theme=' + encodeURIComponent(K.theme), 'mode=' + encodeURIComponent(K.mode)];
  if (c.scenarios.length) q.push('scenario=' + encodeURIComponent(K.scenario));
  return c.demo.url + '?' + q.join('&');
}
function kitRefUrl(K) {
  return '/kit-demo/_reference?surface=' + encodeURIComponent(K.mode);
}
function kitSelect(K, name) {
  const c = kitComp(K, name);
  if (!c) return;
  K.sel = name;
  if (!c.scenarios.length) K.scenario = 'demo';
  else if (c.scenarios.indexOf(K.scenario) < 0) K.scenario = c.defaultScenario;
  kitSaveState();
}
function kitStd(ids) {
  return (ids || []).length ? '<div class="kit-chips">' + ids.map((i) => '<span class="chip mono">' + esc(i) + '</span>').join('') + '</div>' : mutTok('none declared');
}
function kitFileItem(p, found, url) {
  return '<li>' + (found === false ? warnTok('[NOT FOUND]') + ' ' : '') + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(p) + '</a>' : mono(p)) + '</li>';
}
function kitModeButtons(K) {
  const modes = kitModes(K);
  const b = (m, lab) => '<button type="button" data-kit-mode="' + m + '" class="' + (K.mode === m ? 'on' : '') + '" aria-pressed="' + (K.mode === m) + '"' +
    (modes.indexOf(m) < 0 ? ' disabled title="this design defines no ' + m + ' mode (API field modes)"' : '') + '>' + (K.mode === m ? '[*' + lab + ']' : '[' + lab + ']') + '</button>';
  return '<span class="kit-seg" role="group" aria-label="Viewport day or night"><span>Viewport</span>' + b('night', 'NIGHT') + b('day', 'DAY') + '</span>';
}

/* ─── COMPONENTS tab (the gallery: list + one live demo page + docs) ─── */
function renderKitList(K) {
  const groups = K.data.groups && K.data.groups.length ? K.data.groups : Array.from(new Set(K.data.components.map((c) => c.group)));
  return '<nav class="kit-list" aria-label="Kit components">' + groups.map((g) => {
    const cs = K.data.components.filter((c) => c.group === g);
    if (!cs.length) return '';
    return '<div class="kit-grp">' + esc(g) + '</div>' + cs.map((c) =>
      '<button type="button" data-kit-sel="' + esc(c.name) + '" aria-current="' + (c.name === K.sel ? 'true' : 'false') + '">' + esc(c.name) +
      (c.registered ? '' : ' <span class="nr">(api)</span>') + '</button>').join('');
  }).join('') + '</nav>';
}
function renderKitBar(K, c) {
  const sopts = c.scenarios.length
    ? c.scenarios.map((s) => '<option value="' + esc(s) + '"' + (K.scenario === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('')
    : '<option>n/a</option>';
  const scopts = KIT_SCALES.map((n) => '<option value="' + n + '"' + (K.scale === n ? ' selected' : '') + '>' + n + ' %</option>').join('');
  return '<div class="kit-bar mono" role="group" aria-label="Demo options">' +
    '<span id="kit-design">Design: <b>' + esc(kitThemeName(K)) + '</b></span>' +
    '<label>Scenario <select id="kit-scn"' + (c.scenarios.length ? '' : ' disabled') + '>' + sopts + '</select></label>' +
    '<label>Scale <select id="kit-scale">' + scopts + '</select></label>' +
    kitModeButtons(K) +
    '<button type="button" class="mono minibtn" id="kit-reload" title="Reload the demo page">[RELOAD]</button></div>';
}
function kitThemeNote(K) {
  const t = kitThemeInfo(K, K.theme);
  if (!t) return 'No design selected: the kit falls back to the token defaults in templates/webview/apc-ui/apc-core.css.';
  if (!t.found) return '[NOT FOUND] ' + t.tokenFile;
  return 'Design ' + (t.title || t.id) + ': ' + (t.tokensFile ? 'tokens from ' + t.tokensFile + ' (' + t.tokens.length + ' in the first block), served as ' + t.cssUrl : 'derived tokens from ' + t.tokenFile) + '.';
}
function renderKitDocs(K, c) {
  const opt = c.options.length
    ? table(['Option', 'Values', 'Meaning'], c.options.map((o) => [mono(o.name) + (o.required ? ' ' + warnTok('[REQUIRED]') : ''), o.values ? mono(o.values) : mutTok('-'), esc(o.desc || '')]))
    : '<p class="mut mono" style="font-size:12.5px">no data-* options</p>';
  const ev = c.events.length
    ? table(['Event', 'Dir', 'Payload', 'Notes'], c.events.map((e) => [mono(e.name), mono(e.dir === 'in' ? 'in' : 'out'), mono(e.payload || '-'), esc(e.note || '')]))
    : '<p class="mut mono" style="font-size:12.5px">no bus events</p>';
  const bridge = c.bridge.length
    ? '<div class="kit-chips">' + c.bridge.map((b) => '<span class="chip mono' + (b.inMock ? '' : ' bad') + '" title="' + (b.inMock ? 'implemented by apc-mock.js' : 'NOT implemented by apc-mock.js') + '">' + esc(b.name) + '</span>').join('') + '</div>' +
      (c.bridgeInFile.length ? '<p class="mono mut" style="font-size:11.5px">scanned in ' + esc(c.file || '?') + ': ' + esc(c.bridgeInFile.join(' ')) + '</p>' : '')
    : mutTok('none');
  const gest = c.gestures.length
    ? table(['Input', 'Action'], c.gestures.map((g) => [mono(g.input), esc(g.action)]))
    : '<p class="mut mono" style="font-size:12.5px">no gesture or keyboard map for this component</p>';
  const files = [];
  if (c.file) files.push(kitFileItem(c.file, c.fileFound, null));
  c.demo.scripts.forEach((s) => files.push(kitFileItem('templates/webview/apc-ui/' + s, c.demo.missingScripts.indexOf(s) < 0, '/kit/' + s)));
  c.tests.forEach((t) => files.push(kitFileItem(t.path, t.found, null)));
  if (c.guide) files.push(kitFileItem(c.guide.split('#')[0], true, null));
  files.push(kitFileItem(K.data.contract, K.data.contractFound, null));
  files.push(kitFileItem(K.data.catalogFile, K.data.catalogFound, null));
  const reg = c.registered
    ? (c.registeredIn ? okTok('[OK]') + ' registered via APC.register("' + esc(c.name) + '") in ' + mono(c.registeredIn) : warnTok('[!!]') + ' no APC.register("' + esc(c.name) + '") found in the kit')
    : mutTok('[ -- ]') + ' not a data-apc component' + (c.via ? ' - belongs to: ' + esc(c.via.join(', ')) : '');
  return '<h3>' + esc(c.title.toUpperCase()) + ' <span class="chip mono">' + esc(c.group) + '</span></h3>' +
    '<p>' + esc(c.summary) + '</p><p class="mono" style="font-size:12.5px">' + reg + '</p>' +
    '<h4>Markup</h4><pre class="snip"><code id="kit-markup">' + esc(c.markup) + '</code></pre>' +
    '<p class="mono"><button type="button" class="mono minibtn" id="kit-copy">[COPY]</button> <span class="mut" style="font-size:11.5px">src: ' + esc(c.guide ? c.guide : K.data.catalogFile) + '</span></p>' +
    '<h4>Options</h4>' + opt + '<h4>Events</h4>' + ev + '<h4>Bridge functions it uses</h4>' + bridge +
    '<h4>Gestures and keys</h4>' + gest + '<h4>Standards implemented</h4>' + kitStd(c.standards) +
    '<p class="mono mut" style="font-size:11.5px">decision ids: .agents/rules/product-standards.md and schemas/apc-standards.json</p>' +
    '<h4>Source files</h4><ul class="kit-files mono">' + files.join('') + '</ul>';
}
function renderKitDetail(K) {
  const c = kitComp(K, K.sel);
  if (!c) return '<div class="banner mono">' + warnTok() + ' no component selected</div>';
  const px = (n) => Math.round(n * KIT_CELL_PX * K.scale / 100);
  const w = c.demo.cols ? px(c.demo.cols) : 640;
  const h = c.demo.rows ? px(c.demo.rows) : 360;
  return renderKitBar(K, c) +
    '<p class="kit-note mono" id="kit-themenote">' + esc(kitThemeNote(K)) + '</p>' +
    (c.demo.hint ? '<div class="kit-hint">' + esc(c.demo.hint) + '</div>' : '') +
    (c.demo.url
      ? '<div class="kit-stage"><iframe id="kit-frame" sandbox="allow-scripts allow-same-origin" title="Live demo: ' + esc(c.name) + '" width="' + w + '" height="' + h + '" data-w="' + w + '" data-h="' + h + '"></iframe></div>' +
        '<p class="kit-status mono" id="kit-status" role="status" aria-live="polite"><span class="mut">[..] demo not loaded yet</span></p>' +
        '<p class="kit-src mono" id="kit-src"></p>'
      : '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' no demo defined in ' + esc(K.data.catalogFile) + '</div>') +
    renderKitDocs(K, c);
}
function renderKitCoverage(K) {
  const L = (K.data.coverageSource && K.data.coverageSource.statusLegend) || {};
  const tok = { kit: okTok('[OK]'), partial: warnTok('[PART]'), native: mutTok('[NATIVE]'), 'not-in-kit': warnTok('[NONE]') };
  const rows = K.data.coverage.map((r) => [
    esc(r.section),
    esc(r.item) + (r.note ? '<br><span class="mut" style="font-size:12px">' + esc(r.note) + '</span>' : ''),
    (r.decisions || []).map((d) => '<span class="chip mono">' + esc(d) + '</span>').join(' ') || mutTok('-'),
    (r.components || []).map((n) => '<button type="button" class="mono minibtn" data-kit-go="' + esc(n) + '">' + esc(n) + '</button>').join('') || mutTok('-'),
    (r.tests || []).map((t) => (t.found ? '' : warnTok('[NOT FOUND]') + ' ') + mono(t.file)).join('<br>') || mutTok('no test page'),
    (tok[r.status] || mutTok(r.status)) + '<br><span class="mut" style="font-size:11px">' + esc(L[r.status] ? r.status : '') + '</span>',
  ]);
  const src = K.data.coverageSource || {};
  return '<h3>STANDARDS COVERAGE - baseline item -> kit component -> test page</h3>' +
    '<p class="mono mut" style="font-size:12px">src: ' + esc(K.data.catalogFile) + ' (' + esc((src.files || []).join(' + ')) + '). ' + esc(src.summary || '') + '</p>' +
    '<div class="kit-cov">' + table(['Section', 'Baseline item', 'Decisions', 'Kit component', 'Test page', 'Status'], rows) + '</div>' +
    '<p class="mono mut" style="font-size:12px">' + Object.keys(L).map((k) => esc(k) + ': ' + esc(L[k])).join(' &middot; ') + '</p>';
}

/* ─── REFERENCE PLUGIN stage ─── */
function renderKitRef(K) {
  const scopts = KIT_REF_SCALES.map((n) => '<option value="' + n + '"' + (K.refScale === n ? ' selected' : '') + '>' + n + ' %</option>').join('');
  const jump = '<option value="">choose...</option>' + Object.keys(K.data.registered || {}).sort()
    .map((n) => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
  return '<div class="ref" id="ref-box">' +
    '<div class="ref-bar mono" role="group" aria-label="Reference plugin viewport">' +
      '<span id="ref-design">Design library: <b>APC Minimal</b> &middot; source: <code>hub/_design/apc_filter_f30_annotate_v006.html</code></span>' +
      kitModeButtons(K) +
      '<label>Scale <select id="ref-scale">' + scopts + '</select></label>' +
      '<label>Element <select id="ref-jump" title="Find an element on the canonical reference plate">' + jump + '</select></label>' +
      '<button type="button" class="mono minibtn" id="ref-reload" title="Reload the reference plugin">[RELOAD]</button>' +
      '<a class="mono" id="ref-open" href="' + esc(kitRefUrl(K)) + '" target="_blank" rel="noopener" title="Open the source page alone">[OPEN SOURCE]</a>' +
    '</div>' +
    '<div class="ref-stage" id="ref-stage"><div class="ref-wrap" id="ref-wrap">' +
      '<iframe id="ref-frame" title="APC Minimal canonical design reference" width="1000" height="583"></iframe>' +
      '<div class="ref-hl" id="ref-hl" aria-hidden="true"></div></div></div>' +
    '<p class="kit-status mono" id="ref-status" role="status" aria-live="polite"><span class="mut">[..] canonical reference source not loaded yet</span></p>' +
  '</div>';
}
function kitRefDoc() {
  const f = document.getElementById('ref-frame');
  try { return f && f.contentDocument ? f.contentDocument : null; } catch { return null; }
}
function kitRefSize() {
  const K = window.__kit, st = document.getElementById('ref-stage'), f = document.getElementById('ref-frame'), wrap = document.getElementById('ref-wrap');
  if (!K || !st || !f || !wrap) return;
  const avail = st.clientWidth;
  if (avail < 40) return;                                // section hidden
  const w = Math.max(240, Math.floor(avail * K.refScale / 100));
  const h = Math.round(w * K.refRows / K.refCols);
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  f.width = String(w); f.height = String(h);
}
function kitRefLoad() {
  const K = window.__kit, f = document.getElementById('ref-frame');
  if (!K || !f) return;
  K.refOn = true;
  const url = kitRefUrl(K);
  const a = document.getElementById('ref-open');
  if (a) a.setAttribute('href', url);
  const st = document.getElementById('ref-status');
  if (st) st.innerHTML = '<span class="mut">[..] loading the canonical APC Minimal source</span>';
  kitRefSize();
  f.dataset.probeFor = url;
  f.src = url;
  let tries = 0;
  const probe = () => {
    const stEl = document.getElementById('ref-status');
    if (!stEl || f.dataset.probeFor !== url) return;
    let d = null;
    try { d = f.contentDocument && f.contentDocument.documentElement; } catch { d = null; }
    if (d && d.getAttribute('data-surface') !== null && f.contentDocument.querySelector('.plate')) {
      const win = f.contentWindow;
      const doc = f.contentDocument;
      const cols = parseFloat(win.getComputedStyle(d).getPropertyValue('--cols')) || 120, rows = parseFloat(win.getComputedStyle(d).getPropertyValue('--rows')) || 70;
      if (cols !== K.refCols || rows !== K.refRows) { K.refCols = cols; K.refRows = rows; kitRefSize(); }
      const kinds = {};
      Array.prototype.forEach.call(doc.querySelectorAll('[data-el]'), (e) => { const n = e.getAttribute('data-el'); kinds[n] = (kinds[n] || 0) + 1; });
      K.refKinds = kinds;
      kitApplyEdits(doc);
      kitRefPaintJump();
      const coverage = doc.getElementById('ro-el');
      stEl.innerHTML = okTok('[OK]') + ' <span class="mono">canonical source loaded from the unchanged reference route &middot; ' +
        Object.keys(kinds).length + ' element types &middot; ' + (coverage ? esc(coverage.textContent.trim()) + ' coverage' : 'element coverage in source') +
        ' &middot; ' + cols + ' x ' + rows + ' cells &middot; ' + esc(K.mode) + '</span>';
      return;
    }
    if (++tries < 60) setTimeout(probe, 150);
    else stEl.innerHTML = warnTok('[!!]') + ' <span class="mono">the canonical design source did not load</span>';
  };
  f.onload = () => { tries = 0; setTimeout(probe, 120); };
}
function kitRefPaintJump() {
  const K = window.__kit, sel = document.getElementById('ref-jump');
  if (!K || !sel || !K.refKinds) return;
  Array.prototype.forEach.call(sel.options, (o) => {
    if (!o.value) return;
    const n = K.refKinds[o.value] || 0;
    o.textContent = o.value + (n ? ' (' + n + ')' : ' (not on source plate)');
  });
}
function kitRefHighlight(kind) {
  const K = window.__kit, hl = document.getElementById('ref-hl'), f = document.getElementById('ref-frame'), st = document.getElementById('ref-stage');
  if (!K || !hl || !f) return;
  hl.innerHTML = '';
  const doc = kitRefDoc();
  const status = document.getElementById('ref-status');
  if (!kind || !doc) return;
  const k2 = kind.replace(/[^A-Za-z0-9_-]/g, '');
  const els = Array.prototype.slice.call(doc.querySelectorAll('[data-apc="' + k2 + '"],[data-el="' + k2 + '"]'));
  if (!els.length) {
    if (status) status.innerHTML = warnTok('[..]') + ' <span class="mono">' + esc(kind) + ' is not on the canonical source plate</span>';
    return;
  }
  if (status) status.innerHTML = okTok('[OK]') + ' <span class="mono">found ' + els.length + ' x ' + esc(kind) + ' on the canonical source plate</span>';
}
/* ─── component demo frame (unchanged behaviour) ─── */
function kitReloadFrame() {
  const K = window.__kit;
  const f = document.getElementById('kit-frame');
  if (!K || !f) return;
  const url = kitDemoUrl(K);
  if (!url) return;
  K.active = true;
  const src = document.getElementById('kit-src');
  if (src) src.innerHTML = 'demo: <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a> &middot; scenario list: ' + esc(K.data.scenarios.source) + ' &middot; theme list: ' + esc(K.data.themes.source);
  const st = document.getElementById('kit-status');
  if (st) st.innerHTML = '<span class="mut">[..] loading demo</span>';
  f.src = url;
  let tries = 0;
  const probe = () => {
    let d = null;
    try { d = f.contentDocument && f.contentDocument.documentElement; } catch { d = null; }
    const stEl = document.getElementById('kit-status');
    if (!stEl || f.dataset.probeFor !== url) return;
    if (d && d.getAttribute('data-demo-ready') !== null) {
      const miss = (() => { try { return JSON.parse(d.getAttribute('data-demo-missing') || '[]'); } catch { return ['?']; } })();
      const errs = f.contentDocument.querySelectorAll('.apc-toast--error').length;
      const n = d.getAttribute('data-demo-mounted');
      const ok = !miss.length && !errs && d.getAttribute('data-demo-ready') === '1';
      kitApplyEdits(f.contentDocument);
      stEl.innerHTML = (ok ? okTok('[OK]') : warnTok('[!!]')) + ' <span class="mono">mounted ' + esc(n) + ' kit element(s) &middot; ' +
        (miss.length ? 'missing: ' + esc(miss.join(', ')) : 'expected DOM present') + ' &middot; ' + errs + ' error toast(s)' +
        (errs ? ' (visible in the demo - the kit never fails silently)' : '') + '</span>';
      return;
    }
    if (++tries < 40) setTimeout(probe, 150);
    else stEl.innerHTML = warnTok('[!!]') + ' <span class="mono">demo did not report ready (blocked or failed to load)</span>';
  };
  f.dataset.probeFor = url;
  f.onload = () => { tries = 0; setTimeout(probe, 150); };
}
function kitRepaintDetail() {
  const K = window.__kit;
  const box = document.getElementById('kit-main');
  if (!K || !box) return;
  box.innerHTML = renderKitDetail(K);
  const list = document.getElementById('09c-kit').querySelector('.kit-list');
  if (list) $$('button[data-kit-sel]', list).forEach((b) => b.setAttribute('aria-current', b.dataset.kitSel === K.sel ? 'true' : 'false'));
  if (K.active && K.tab === 'components') kitReloadFrame();
}
function kitCopyText(text, btn) {
  const label = btn.dataset.label || btn.textContent;
  btn.dataset.label = label;
  const done = (ok) => { btn.textContent = ok ? '[COPIED]' : '[COPY FAILED]'; setTimeout(() => { btn.textContent = label; }, 1600); };
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(!!ok);
    } catch { done(false); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
  else fallback();
}
function kitDownload(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ─── DESIGN documents: tokens.css + design-system.json (GET /api/v1/design/<id>) ─── */
function kitSplitCss(text) {
  // night = everything before the [data-theme="day"] block; day = that block (a design without one has no day overrides)
  const m = /\n[ \t]*\[data-theme="day"\]\s*\{/.exec(text);
  if (!m) return { night: text, day: '', dayStart: -1 };
  const open = m.index + m[0].length - 1;
  const close = text.indexOf('}', open);
  return { night: text.slice(0, m.index + 1), day: text.slice(m.index + 1, close < 0 ? text.length : close + 1), dayStart: m.index + 1, tail: close < 0 ? '' : text.slice(close + 1) };
}
function kitParseDecls(block) {
  // -> [{name, value, section}] in file order; `section` = the last "/* ---- title ---- */" banner above the declaration
  const out = [];
  let section = '';
  const re = /\/\*\s*-{2,}\s*([^*]*?)\s*-{2,}[^*]*\*\/|(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]*?)\s*;/g;
  let m;
  while ((m = re.exec(block))) {
    if (m[1] !== undefined) section = m[1].replace(/\s+/g, ' ').trim();
    else out.push({ name: m[2], value: m[3].replace(/\s+/g, ' '), section });
  }
  return out;
}
function kitInferKind(name, value) {
  if (/^--font-(ui|text)$/.test(name) || /^--font/.test(name)) return 'font';
  if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value)) return 'color';
  const ref = /^var\((--[\w-]+)/.exec(value);
  if (ref && /color|accent|ink|rule|plate|inset|surface|ok|danger|focus|viz|meter|led|step|mod|grip|letterbox|overlay/.test(ref[1])) return 'color';
  if (/^-?[\d.]+$/.test(value) && !/^--(stroke|r-|ctl|pad|knob|track|thumb|check|t-)/.test(name)) return 'number';
  return 'length';
}
function kitBuildDesign(id, doc) {
  const spec = doc.spec && typeof doc.spec === 'object' ? doc.spec : {};
  const css = doc.tokensCss || '';
  const parts = css ? kitSplitCss(css) : { night: '', day: '' };
  const nd = kitParseDecls(parts.night), dd = kitParseDecls(parts.day);
  const st = spec.tokens && typeof spec.tokens === 'object' ? spec.tokens : {};
  const night = {}, dayOv = {}, order = [], sec = {};
  nd.forEach((d) => { night[d.name] = d.value; order.push(d.name); sec[d.name] = d.section; });
  dd.forEach((d) => { dayOv[d.name] = d.value; if (order.indexOf(d.name) < 0) { order.push(d.name); sec[d.name] = d.section; } });
  if (st.night && typeof st.night === 'object') Object.keys(st.night).forEach((n) => { if (night[n] === undefined) { night[n] = String(st.night[n]); if (order.indexOf(n) < 0) order.push(n); } });
  if (st.day && typeof st.day === 'object') Object.keys(st.day).forEach((n) => { if (dayOv[n] === undefined) dayOv[n] = String(st.day[n]); if (order.indexOf(n) < 0) order.push(n); });
  const day = Object.assign({}, night, dayOv);
  // groups: design-system.json -> tokenGroups, else the section banners of tokens.css, else one flat group
  let groups = [];
  if (Array.isArray(spec.tokenGroups)) {
    groups = spec.tokenGroups.filter((g) => g && typeof g === 'object' && Array.isArray(g.tokens)).map((g) => ({
      id: String(g.id || g.title), title: String(g.title || g.id), kind: g.kind || null, description: g.description || '', tokens: g.tokens.map(String) }));
  }
  const fromSpec = groups.length > 0;
  if (!fromSpec) {
    const by = {};
    order.forEach((n) => { const s = sec[n] || 'tokens'; if (!by[s]) { by[s] = { id: s, title: s.replace(/^./, (c) => c.toUpperCase()), kind: null, description: '', tokens: [] }; groups.push(by[s]); } by[s].tokens.push(n); });
  }
  const known = {};
  groups.forEach((g) => g.tokens.forEach((n) => { known[n] = true; }));
  const extra = order.filter((n) => !known[n]);
  if (extra.length && fromSpec) groups.push({ id: 'other', title: 'Other tokens', kind: null, description: 'In tokens.css but in no tokenGroups entry of design-system.json.', tokens: extra });
  const kindOf = {};
  groups.forEach((g) => g.tokens.forEach((n) => { kindOf[n] = g.kind && /^(color|length|font|number)$/.test(g.kind) ? g.kind : kitInferKind(n, night[n] !== undefined ? night[n] : (day[n] || '')); }));
  // which elements use which token (design-system.json -> element parts, states and size defaults)
  const uses = {};
  const els = spec.elements && typeof spec.elements === 'object' ? spec.elements : {};
  Object.keys(els).forEach((en) => {
    if (en.charAt(0) === '_' || !els[en] || typeof els[en] !== 'object') return;
    const hit = {};
    const scan = (o) => { if (typeof o === 'string') { (o.match(/--[A-Za-z0-9_-]+/g) || []).forEach((t) => { hit[t] = true; }); } else if (o && typeof o === 'object') Object.keys(o).forEach((k) => scan(o[k])); };
    scan(els[en].parts); scan(els[en].states); scan(els[en].sizes);
    Object.keys(hit).forEach((t) => { (uses[t] = uses[t] || []).push(en); });
  });
  // fontsets: { ui:[{id,label,value}], text:[...] } (or a flat array: used for both)
  const fsRaw = spec.fontsets;
  const fsList = (a) => (Array.isArray(a) ? a : []).map((f) => (typeof f === 'string' ? { name: f, value: f } : { name: String(f.label || f.name || f.id || f.value), value: String(f.value || f.stack || '') })).filter((f) => f.value);
  const fontsets = Array.isArray(fsRaw) ? { ui: fsList(fsRaw), text: fsList(fsRaw) } : { ui: fsList(fsRaw && fsRaw.ui), text: fsList(fsRaw && fsRaw.text) };
  const descs = {};
  (Array.isArray(spec.tokenGroups) ? spec.tokenGroups : []).forEach((g) => { if (g && g.descriptions && typeof g.descriptions === 'object') Object.keys(g.descriptions).forEach((n) => { descs[n] = String(g.descriptions[n]); }); });
  const tuningSaved = spec.elementTuning && typeof spec.elementTuning === 'object' ? JSON.parse(JSON.stringify(spec.elementTuning)) : {};
  return { id, doc, spec, css, parts, night, day, dayOv, order, groups, fromSpec, kindOf, uses, elements: els, fontsets, descs,
    tuningSchema: doc.tuningSchema || {}, tuningSaved, tuningEdits: JSON.parse(JSON.stringify(tuningSaved)),
    pairs: spec.contrast && Array.isArray(spec.contrast.pairs) ? spec.contrast.pairs : [] };
}
async function kitEnsureDesign(K) {
  if (K.theme === 'default') return null;
  K.designs = K.designs || {};
  if (K.designs[K.theme]) return K.designs[K.theme];
  const id = K.theme;
  const doc = await api('design/' + encodeURIComponent(id));
  if (!doc) { K.designs[id] = { id, missing: true }; return K.designs[id]; }
  K.designs[id] = kitBuildDesign(id, doc);
  kitLoadDraft(K.designs[id]);
  return K.designs[id];
}
function kitDesign(K) { return K.designs && K.designs[K.theme] && !K.designs[K.theme].missing ? K.designs[K.theme] : null; }

/* ─── drafts (localStorage) and live application ─── */
function kitLoadDraft(d) {
  d.edits = { night: {}, day: {} };
  try {
    const j = JSON.parse(localStorage.getItem(KIT_DRAFT_KEY + d.id) || 'null');
    ['night', 'day'].forEach((m) => { if (j && j[m] && typeof j[m] === 'object') Object.keys(j[m]).forEach((n) => { if (typeof j[m][n] === 'string' && d.kindOf[n]) d.edits[m][n] = j[m][n]; }); });
  } catch { /* ignore */ }
  try {
    const j = JSON.parse(localStorage.getItem(KIT_ELEMENT_DRAFT_KEY + d.id) || 'null');
    if (j && j.revision === d.doc.revision && j.elements && typeof j.elements === 'object') d.tuningEdits = j.elements;
  } catch { /* ignore */ }
}
function kitSaveDraft(d) {
  try {
    if (kitEditCount(d)) localStorage.setItem(KIT_DRAFT_KEY + d.id, JSON.stringify(d.edits));
    else localStorage.removeItem(KIT_DRAFT_KEY + d.id);
  } catch { /* ignore */ }
}
function kitEditCount(d, mode) { return (mode ? [mode] : ['night', 'day']).reduce((n, m) => n + Object.keys(d.edits[m]).length, 0); }
function kitValue(d, mode, name) {
  const e = d.edits[mode][name];
  if (e !== undefined) return e;
  return (mode === 'day' ? d.day : d.night)[name];
}
function kitBaseValue(d, mode, name) { return (mode === 'day' ? d.day : d.night)[name]; }
function kitApplyEdits(doc) {
  const K = window.__kit;
  if (!K || !doc || !doc.documentElement) return;
  const d = kitDesign(K);
  const root = doc.documentElement;
  const sourcePage = root.hasAttribute('data-surface');
  const had = root.__kitSet || [];
  const ed = d ? d.edits[K.mode] : {};
  had.forEach((n) => { if (ed[n] === undefined) root.style.removeProperty(n); });
  const set = {};
  Object.keys(ed).forEach((n) => {
    const name = sourcePage ? kitSourceTokenName(n) : n;
    root.style.setProperty(name, sourcePage ? kitSourceTokenValue(ed[n]) : ed[n]);
    set[name] = true;
  });
  root.__kitSet = Object.keys(set);
  kitApplyElementTuning(doc);
}
function kitApplyElementTuning(doc) {
  const K = window.__kit, d = K && kitDesign(K);
  if (!d || !doc || !doc.documentElement) return;
  const sourcePage = doc.documentElement.hasAttribute('data-surface');
  if (sourcePage) {
    const hasElementTuning = Object.keys(d.tuningEdits || {}).some((name) => Object.keys(d.tuningEdits[name] || {}).length > 0);
    const hasTokenTuning = Object.keys(d.edits[K.mode] || {}).some((name) => KIT_SOURCE_STYLE_TOKENS.has(name));
    const hasTuning = hasElementTuning || hasTokenTuning;
    if (hasTuning) kitEnsureSourceTuningStyle(doc);
    else {
      const injected = doc.getElementById('apc-hub-source-tuning');
      if (injected) injected.remove();
    }
  }
  Array.prototype.forEach.call(doc.querySelectorAll('[data-apc],[data-el]'), (el) => {
    const name = el.getAttribute('data-apc') || el.getAttribute('data-el'), values = d.tuningEdits[name] || {}, controls = d.tuningSchema[name] || [];
    const previous = el.__kitTuneProps || (el.__kitTuneProps = {});
    const active = {};
    controls.forEach((c) => {
      const value = values[c.key];
      if (value === undefined) return;
      if (c.target === 'dimension') {
        const dim = c.dimension;
        if (!el.__kitOriginalSize) el.__kitOriginalSize = { width: el.style.width, height: el.style.height };
        el.style[dim] = value + 'rem'; active['size:' + dim] = true;
      } else {
        c.cssVars.forEach((prop) => {
          if (!(prop in previous)) previous[prop] = el.style.getPropertyValue(prop);
          el.style.setProperty(prop, value + c.unit); active[prop] = true;
        });
      }
    });
    Object.keys(previous).forEach((prop) => {
      if (active[prop]) return;
      if (previous[prop]) el.style.setProperty(prop, previous[prop]); else el.style.removeProperty(prop);
      delete previous[prop];
    });
    ['width', 'height'].forEach((dim) => {
      if (el.__kitOriginalSize && !active['size:' + dim]) el.style[dim] = el.__kitOriginalSize[dim];
    });
  });
}
function kitEnsureSourceTuningStyle(doc) {
  if (doc.getElementById('apc-hub-source-tuning')) return;
  const style = doc.createElement('style');
  style.id = 'apc-hub-source-tuning';
  style.textContent = [
    '[data-el="knob"][style*="--apc-tune-knob-diameter"] .dial,html[style*="--apc-tune-knob-diameter"] [data-el="knob"] .dial{width:var(--apc-tune-knob-diameter)!important;aspect-ratio:1;flex:0 0 auto!important}',
    '[data-el="knob"][style*="--apc-tune-knob-arc"] svg .k-track,[data-el="knob"][style*="--apc-tune-knob-arc"] svg .k-arc,html[style*="--apc-tune-knob-arc"] [data-el="knob"] svg .k-track,html[style*="--apc-tune-knob-arc"] [data-el="knob"] svg .k-arc{stroke-width:var(--apc-tune-knob-arc)!important}',
    '[data-el="slider"][style*="--apc-tune-slider-length"],html[style*="--apc-tune-slider-length"] [data-el="slider"]{width:var(--apc-tune-slider-length)!important}',
    '[data-el="slider"][style*="--apc-tune-track-thickness"] .rail,[data-el="slider"][style*="--apc-tune-track-thickness"] .fill,html[style*="--apc-tune-track-thickness"] [data-el="slider"] .rail,html[style*="--apc-tune-track-thickness"] [data-el="slider"] .fill{height:var(--apc-tune-track-thickness)!important}',
    '[data-el="progress"][style*="--apc-tune-track-thickness"] .track,html[style*="--apc-tune-track-thickness"] [data-el="progress"] .track{height:var(--apc-tune-track-thickness)!important}',
    '[data-el="slider"][style*="--apc-tune-thumb-size"] .thumb,html[style*="--apc-tune-thumb-size"] [data-el="slider"] .thumb{width:var(--apc-tune-thumb-size)!important}',
  ].join('\\n');
  (doc.head || doc.documentElement).appendChild(style);
}
function kitTuneCount(d) {
  const names = new Set(Object.keys(d.tuningSaved || {}).concat(Object.keys(d.tuningEdits || {})));
  let count = 0;
  names.forEach((name) => {
    const a = d.tuningSaved[name] || {}, b = d.tuningEdits[name] || {};
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach((key) => { if (a[key] !== b[key]) count++; });
  });
  return count;
}
function kitTuneSnapshot(elements) {
  const out = {};
  Object.keys(elements || {}).sort().forEach((name) => {
    const values = elements[name] || {}, clean = {};
    Object.keys(values).sort().forEach((key) => { if (typeof values[key] === 'number') clean[key] = values[key]; });
    if (Object.keys(clean).length) out[name] = clean;
  });
  return out;
}
function kitTuneSaveDraft(d) {
  try {
    const elements = kitTuneSnapshot(d.tuningEdits);
    if (kitTuneCount(d)) localStorage.setItem(KIT_ELEMENT_DRAFT_KEY + d.id, JSON.stringify({ revision: d.doc.revision, elements }));
    else localStorage.removeItem(KIT_ELEMENT_DRAFT_KEY + d.id);
  } catch { /* browser storage can be disabled */ }
}
function kitTuneValue(d, name, control) {
  const current = d.tuningEdits[name] && d.tuningEdits[name][control.key];
  return current === undefined ? control.default : current;
}
function kitTuneControl(d, name, c) {
  const val = kitTuneValue(d, name, c), shown = c.key === 'elementWidth' || c.key === 'elementHeight' ? (val === 0 ? 'markup' : val + ' ' + c.unit) : val + ' ' + c.unit;
  return '<label class="sp-tune-control"><span>' + esc(c.label) + '</span>' +
    '<span class="sp-tune-input"><input type="range" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" value="' + val + '" data-sp-tune data-element="' + esc(name) + '" data-property="' + esc(c.key) + '" aria-label="' + esc(name + ' ' + c.label) + '">' +
    '<output data-sp-tune-output="' + esc(name + ':' + c.key) + '">' + esc(shown) + '</output></span>' +
    (c.help ? '<small class="mut">' + esc(c.help) + '</small>' : '') + '</label>';
}
function kitTuneInput(K, input) {
  const d = kitDesign(K), name = input.dataset.element, key = input.dataset.property;
  const c = d && (d.tuningSchema[name] || []).find((x) => x.key === key);
  if (!c) return;
  const val = Number(input.value);
  d.tuningEdits[name] = d.tuningEdits[name] || {};
  if (val === c.default) delete d.tuningEdits[name][key]; else d.tuningEdits[name][key] = val;
  if (!Object.keys(d.tuningEdits[name]).length) delete d.tuningEdits[name];
  const output = input.parentElement.querySelector('output');
  if (output) output.textContent = key === 'elementWidth' || key === 'elementHeight' ? (val === 0 ? 'markup' : val + ' ' + c.unit) : val + ' ' + c.unit;
  const card = input.closest('.sp-card');
  if (card) card.classList.toggle('is-tuned', !!(d.tuningEdits[name] && Object.keys(d.tuningEdits[name]).length));
  kitTuneSaveDraft(d);
  kitApplyAll();
  const count = document.getElementById('sp-tune-count');
  if (count) count.textContent = kitTuneCount(d) + ' unsaved tuning change(s)';
  const save = document.getElementById('sp-tune-save');
  if (save) save.disabled = !kitTuneCount(d);
}
async function kitTuneSave(K) {
  const d = kitDesign(K), status = document.getElementById('sp-tune-status'), button = document.getElementById('sp-tune-save');
  if (!d || !kitTuneCount(d)) return;
  if (button) button.disabled = true;
  if (status) status.textContent = 'Saving APC Minimal element settings...';
  const elements = {};
  Object.keys(d.tuningSchema).forEach((name) => { elements[name] = d.tuningEdits[name] || {}; });
  try {
    const r = await fetch('/api/v1/design/' + encodeURIComponent(d.id) + '/tuning', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: d.doc.revision, elements }),
    });
    const result = await r.json();
    if (!r.ok || !result.ok) throw new Error(result.error || 'save failed');
    d.doc.revision = result.revision;
    d.spec.elementTuning = result.elements;
    d.doc.spec = d.spec;
    d.tuningSaved = JSON.parse(JSON.stringify(result.elements));
    d.tuningEdits = JSON.parse(JSON.stringify(result.elements));
    kitTuneSaveDraft(d);
    kitApplyAll();
    if (status) status.textContent = 'Saved to ' + d.doc.specFile + ' (backup created).';
    await kitRepaintSpec();
  } catch (e) {
    if (status) status.textContent = e.message === 'revision-conflict' ? 'The library changed in another Hub session. Reload the page before saving.' : 'Save failed: ' + e.message;
    if (button) button.disabled = false;
  }
}
function kitTuneReset(K, name) {
  const d = kitDesign(K);
  if (!d) return;
  if (name) {
    if (d.tuningSaved[name]) d.tuningEdits[name] = JSON.parse(JSON.stringify(d.tuningSaved[name]));
    else delete d.tuningEdits[name];
  } else d.tuningEdits = JSON.parse(JSON.stringify(d.tuningSaved));
  kitTuneSaveDraft(d);
  kitRepaintSpec();
  kitApplyAll();
}
function kitLiveDocs() {
  const out = [];
  ['ref-frame', 'kit-frame'].forEach((id) => { const f = document.getElementById(id); try { if (f && f.contentDocument) out.push(f.contentDocument); } catch { /* not ready */ } });
  Array.prototype.forEach.call(document.querySelectorAll('iframe[data-kit-live]'), (f) => { try { if (f.contentDocument) out.push(f.contentDocument); } catch { /* not ready */ } });
  return out;
}
function kitApplyAll() { kitLiveDocs().forEach(kitApplyEdits); }

/* ─── colour maths (WCAG 2.x) ─── */
function kitParseColor(v) {
  const s = String(v || '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, (c) => c + c);
    if (h.length === 6 || h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4]) };
  return null;
}
function kitResolveColor(d, mode, v, depth) {
  v = String(v == null ? '' : v).trim();
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (ref && (depth || 0) < 8) return kitResolveColor(d, mode, kitValue(d, mode, ref[1]), (depth || 0) + 1);
  return kitParseColor(v);
}
function kitLum(c) {
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
function kitRatio(fg, bg) {
  const over = (a, b) => ({ r: a.r * a.a + b.r * (1 - a.a), g: a.g * a.a + b.g * (1 - a.a), b: a.b * a.a + b.b * (1 - a.a), a: 1 });
  const b = bg.a < 1 ? over(bg, { r: 0, g: 0, b: 0, a: 1 }) : bg;
  const f = fg.a < 1 ? over(fg, b) : fg;
  const l1 = kitLum(f), l2 = kitLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const KIT_FALLBACK_PAIRS = [
  { fg: '--ink', bg: '--plate', min: 4.5, kind: 'text', role: 'primary text on the plugin background' },
  { fg: '--ink', bg: '--plate-2', min: 4.5, kind: 'text', role: 'primary text on a raised panel' },
  { fg: '--ink-2', bg: '--plate', min: 4.5, kind: 'text', role: 'labels on the plugin background' },
  { fg: '--ink-2', bg: '--inset', min: 4.5, kind: 'text', role: 'labels inside wells' },
  { fg: '--accent', bg: '--plate', min: 3, kind: 'graphic', role: 'signal colour as a graphic' },
  { fg: '--accent-ink', bg: '--accent', min: 4.5, kind: 'text', role: 'text on an accent fill' },
  { fg: '--rule', bg: '--plate', min: 3, kind: 'graphic', role: 'control borders' },
  { fg: '--apc-danger', bg: '--plate', min: 3, kind: 'graphic', role: 'error / clip colour' },
  { fg: '--ok', bg: '--plate', min: 3, kind: 'graphic', role: 'ok colour' },
];
function kitContrastRows(d, mode) {
  const src = d.pairs.length ? d.pairs.filter((p) => !p.mode || p.mode === mode) : KIT_FALLBACK_PAIRS;
  return src.map((p) => {
    const fg = kitResolveColor(d, mode, kitValue(d, mode, p.fg), 0), bg = kitResolveColor(d, mode, kitValue(d, mode, p.bg), 0);
    const ratio = fg && bg ? kitRatio(fg, bg) : null;
    return { fg: p.fg, bg: p.bg, kind: p.kind || 'text', min: p.min || 4.5, role: p.role || '', doc: p.ratio, ratio, pass: ratio !== null && ratio + 0.005 >= (p.min || 4.5) };
  });
}

const KIT_THEME_PREVIEW_PRIORITY = {
  knob: ['knob', 'slider', 'button'],
  slider: ['slider', 'progress', 'meter'],
  track: ['slider', 'progress', 'meter'],
  thumb: ['slider', 'knob'],
  viz: ['meter', 'graph', 'slider'],
  meter: ['meter', 'progress', 'slider'],
  led: ['led', 'button', 'slider'],
  panel: ['panel', 'button', 'slider'],
  plate: ['panel', 'button', 'slider'],
  surface: ['panel', 'button', 'slider'],
  inset: ['slider', 'panel', 'button'],
  rule: ['slider', 'button', 'panel'],
  stroke: ['slider', 'button', 'panel'],
  font: ['readout', 'slider', 'button'],
  accent: ['knob', 'slider', 'button'],
  ink: ['readout', 'slider', 'button'],
};
function kitThemePreviewComponents(K) {
  return (K.data.components || []).filter((c) => c.demo && c.demo.url).slice().sort((a, b) => a.name.localeCompare(b.name));
}
function kitThemePreviewName(K, d) {
  const available = kitThemePreviewComponents(K);
  if (K.thPreview && K.thPreview !== 'auto' && available.some((c) => c.name === K.thPreview)) return K.thPreview;
  const token = String(K.thPreviewToken || '').replace(/^--/, '').toLowerCase();
  const uses = d && token ? (d.uses['--' + token] || []).filter((name) => available.some((c) => c.name === name)) : [];
  const preferred = Object.keys(KIT_THEME_PREVIEW_PRIORITY).find((key) => token.indexOf(key) >= 0);
  if (uses.length) {
    const order = preferred ? KIT_THEME_PREVIEW_PRIORITY[preferred] : ['slider', 'knob', 'button', 'panel'];
    const rank = (name) => { const i = order.indexOf(name); return i < 0 ? order.length + 1 : i; };
    uses.sort((a, b) => rank(a) - rank(b));
    return uses[0];
  }
  if (preferred) {
    const component = KIT_THEME_PREVIEW_PRIORITY[preferred].find((name) => available.some((c) => c.name === name));
    if (component) return component;
  }
  return available.some((c) => c.name === 'slider') ? 'slider' : (available[0] ? available[0].name : '');
}
function kitThemePreviewUrl(K, name) {
  const c = kitComp(K, name);
  if (!c || !c.demo || !c.demo.url) return '';
  const q = ['theme=' + encodeURIComponent(K.theme), 'mode=' + encodeURIComponent(K.mode)];
  if (c.scenarios && c.scenarios.length) q.push('scenario=' + encodeURIComponent(c.defaultScenario || c.scenarios[0]));
  return c.demo.url + '?' + q.join('&');
}
function kitThemePreviewStatus(K, d) {
  const status = document.getElementById('th-preview-status');
  const name = kitThemePreviewName(K, d), component = kitComp(K, name);
  if (!status) return;
  const title = component ? component.title : name || 'component';
  const nameEl = document.getElementById('th-preview-component-name');
  if (nameEl) nameEl.textContent = title;
  const token = K.thPreviewToken;
  const uses = token && d.uses[token] ? d.uses[token].filter((n) => { const c = kitComp(K, n); return c && c.demo && c.demo.url; }) : [];
  if (!token) status.textContent = 'Start with the slider. Focus a token to match the preview to a component that uses it.';
  else if (uses.length) status.textContent = 'Editing ' + token + ' · previewing ' + title + ' · also used by ' + uses.join(', ');
  else status.textContent = 'Editing ' + token + ' · previewing ' + title + ' (no direct component mapping in the spec).';
}
function kitThemePreviewResize() {
  const K = window.__kit, frame = document.getElementById('th-preview-frame'), stage = document.getElementById('th-preview-stage');
  if (!K || !frame || !stage) return;
  const c = kitComp(K, K.thPreviewName), demo = c && c.demo || {}, cols = demo.cols || 34, rows = demo.rows || 14;
  const width = Math.max(220, stage.clientWidth || 340);
  frame.width = String(width);
  frame.height = String(Math.round(width * rows / cols));
}
function kitThemePreviewLoad(K, d, name) {
  const frame = document.getElementById('th-preview-frame');
  if (!frame) return;
  const selected = name || kitThemePreviewName(K, d);
  const url = kitThemePreviewUrl(K, selected);
  if (!url) return;
  K.thPreviewName = selected;
  const c = kitComp(K, selected);
  frame.title = 'Live theme preview: ' + (c && c.title || selected);
  kitThemePreviewResize();
  if (frame.getAttribute('src') !== url) frame.src = url;
  else { try { if (frame.contentDocument) kitApplyEdits(frame.contentDocument); } catch { /* not ready */ } }
  kitThemePreviewStatus(K, d);
}
function kitThemePreviewReady(K, d) {
  const frame = document.getElementById('th-preview-frame');
  if (!frame) return;
  kitThemePreviewResize();
  let tries = 0;
  const apply = () => {
    if (!document.body.contains(frame)) return;
    try {
      const doc = frame.contentDocument;
      if (doc && doc.documentElement && doc.documentElement.getAttribute('data-demo-ready') !== null) {
        kitApplyEdits(doc);
        kitThemePreviewStatus(K, d);
        return;
      }
    } catch { /* wait for the local demo document */ }
    if (++tries < 40) setTimeout(apply, 125);
  };
  apply();
}
function kitThemePreviewFocus(K, d, token) {
  K.thPreviewToken = token;
  kitThemePreviewLoad(K, d);
}

/* ─── THEME EDITOR ─── */
function kitHex(c) { const h = (n) => ('0' + Math.max(0, Math.min(255, Math.round(n))).toString(16)).slice(-2); return '#' + h(c.r) + h(c.g) + h(c.b); }
function kitFmtColor(c, orig) {
  const alpha = Math.round(c.a * 1000) / 1000;
  if (alpha < 1 || /^rgba?\(/i.test(orig || '')) {
    const hasSpace = /,\s/.test(orig || '');
    return 'rgba(' + [Math.round(c.r), Math.round(c.g), Math.round(c.b), String(alpha).replace(/^0\./, '.')].join(hasSpace ? ', ' : ',') + ')';
  }
  return kitHex(c).toUpperCase();
}
function kitTokenControl(d, mode, name) {
  const val = kitValue(d, mode, name) || '';
  const kind = d.kindOf[name];
  const label = 'aria-label="' + esc(name) + ' value"';
  if (kind === 'color') {
    const c = kitResolveColor(d, mode, val, 0), isRef = /^var\(/.test(val.trim());
    const hexv = c ? kitHex(c) : '#000000';
    return '<input type="color" class="th-col" data-th-color="' + esc(name) + '" value="' + hexv + '" aria-label="' + esc(name) + ' colour picker"' + (isRef ? ' title="a reference: edit the text to change it, or pick to override"' : '') + '>' +
      '<input type="text" class="th-txt" data-th-text="' + esc(name) + '" value="' + esc(val) + '" spellcheck="false" ' + label + '>' +
      (c && !isRef && c.a < 1 ? '<label class="th-alpha" title="alpha">a <input type="number" min="0" max="1" step="0.01" data-th-alpha="' + esc(name) + '" value="' + Math.round(c.a * 100) / 100 + '" aria-label="' + esc(name) + ' alpha"></label>' : '');
  }
  if (kind === 'font') {
    const sets = name === '--font-text' ? d.fontsets.text : d.fontsets.ui;
    const opts = '<option value="">custom...</option>' + sets.map((f) => '<option value="' + esc(f.value) + '"' + (f.value === val ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    return (sets.length ? '<select class="th-sel" data-th-font="' + esc(name) + '" aria-label="' + esc(name) + ' font set">' + opts + '</select>' : '') +
      '<input type="text" class="th-txt th-wide" data-th-text="' + esc(name) + '" value="' + esc(val) + '" spellcheck="false" ' + label + '>';
  }
  return '<input type="text" class="th-txt" data-th-text="' + esc(name) + '" value="' + esc(val) + '" spellcheck="false" ' + label + '>' +
    (kind === 'length' ? '<span class="mut th-unit">length: px, rem, em or a CSS expression</span>' : '');
}
function kitTokenRow(d, mode, name) {
  const edited = d.edits[mode][name] !== undefined;
  const uses = d.uses[name] || [];
  const base = kitBaseValue(d, mode, name);
  return '<div class="th-row' + (edited ? ' is-edited' : '') + '" data-token="' + esc(name) + '" id="th-' + esc(name.replace(/^--/, '')) + '">' +
    '<span class="th-name"><code title="' + esc('default: ' + (base == null ? '' : base)) + '">' + esc(name) + '</code>' + (d.descs[name] ? '<span class="th-d mut">' + esc(d.descs[name]) + '</span>' : '') + '</span>' +
    '<span class="th-ctl">' + kitTokenControl(d, mode, name) + '</span>' +
    '<button type="button" class="mono minibtn th-reset" data-th-reset="' + esc(name) + '"' + (edited ? '' : ' hidden') + ' title="back to ' + esc(base == null ? '' : base) + '">[RESET]</button>' +
    '<span class="th-use">' + (uses.length ? '<button type="button" class="mono minibtn" data-th-uses="' + esc(name) + '" title="' + esc(uses.join(', ')) + '">used by ' + uses.length + '</button>' : '<span class="mut">-</span>') + '</span>' +
  '</div>';
}
function kitRenderContrast(K, d) {
  const rows = kitContrastRows(d, K.mode);
  const bad = rows.filter((r) => !r.pass).length;
  return '<div class="th-contrast-h mono">CONTRAST (' + esc(K.mode) + ') - ' + (bad ? warnTok('[!!] ' + bad + ' of ' + rows.length + ' below minimum') : okTok('[OK]') + ' all ' + rows.length + ' pairs pass') + '</div>' +
    '<div class="th-pairs">' + rows.map((r) =>
      '<div class="th-pair' + (r.pass ? '' : ' is-bad') + '" title="' + esc(r.kind + ' >= ' + r.min + ':1' + (r.role ? ' - ' + r.role : '')) + '"><span class="th-sample" style="background:' + esc(kitValue(d, K.mode, r.bg) || '') + ';color:' + esc(kitValue(d, K.mode, r.fg) || '') + '">Aa</span>' +
      '<span class="mono th-pt">' + esc(r.fg) + ' <span class="mut">on</span> ' + esc(r.bg) + ' <span class="mut">' + esc(r.kind) + ' &ge; ' + r.min + '</span></span>' +
      '<span class="mono th-ratio">' + (r.ratio === null ? '?' : r.ratio.toFixed(2) + ':1') + '</span>' +
      '<span class="th-chip ' + (r.pass ? 'ok' : 'bad') + '">' + (r.pass ? '[PASS]' : '[FAIL]') + '</span></div>').join('') + '</div>';
}
function kitExportCss(d) {
  const stamp = (n) => '/* edited in the APC Hub theme editor: ' + n + ' token value(s) changed. Save as design_library/<your-id>/tokens.css */\n';
  const n = kitEditCount(d);
  const apply = (block, mode) => {
    const ed = d.edits[mode], seen = {};
    const out = block.replace(/(--[A-Za-z0-9_-]+)(\s*:\s*)([^;{}]*?)(\s*;)/g, (m, name, colon, val, semi) => {
      seen[name] = true;
      return ed[name] !== undefined ? name + colon + ed[name] + semi : m;
    });
    return { out, missing: Object.keys(ed).filter((k) => !seen[k]) };
  };
  if (!d.css) {                                         // a design without tokens.css: write one from the spec maps
    const mk = (sel, map, mode) => sel + ' {\n' + Object.keys(map).map((k) => '  ' + k + ': ' + (d.edits[mode][k] !== undefined ? d.edits[mode][k] : map[k]) + ';').join('\n') + '\n}\n';
    const dayMap = {}; Object.keys(d.dayOv).forEach((k) => { dayMap[k] = d.dayOv[k]; }); Object.keys(d.edits.day).forEach((k) => { dayMap[k] = d.dayOv[k] !== undefined ? d.dayOv[k] : d.day[k]; });
    return stamp(n) + mk(':root,\n[data-theme="night"]', d.night, 'night') + '\n' + mk('[data-theme="day"]', dayMap, 'day');
  }
  const p = d.parts;
  const night = apply(p.night, 'night');
  let day = p.day ? apply(p.day, 'day') : { out: '', missing: Object.keys(d.edits.day) };
  let dayText = day.out;
  if (day.missing.length) {
    const lines = day.missing.map((k) => '  ' + k + ': ' + d.edits.day[k] + ';   /* edited */').join('\n') + '\n';
    if (dayText) { const i = dayText.lastIndexOf('}'); dayText = dayText.slice(0, i) + '\n' + lines + dayText.slice(i); }
    else dayText = '[data-theme="day"] {\n' + lines + '}\n';
  }
  return stamp(n) + night.out + dayText + (p.tail || '');
}
function kitExportJson(d) {
  const changed = (m) => { const o = {}; Object.keys(d.edits[m]).forEach((k) => { o[k] = d.edits[m][k]; }); return o; };
  const was = (m) => { const o = {}; Object.keys(d.edits[m]).forEach((k) => { o[k] = kitBaseValue(d, m, k); }); return o; };
  return JSON.stringify({ design: d.id, generatedBy: 'APC Hub 09c KIT theme editor', generated: new Date().toISOString(),
    note: 'Changed token maps in the design-system.json shape (tokens.night / tokens.day). Merge into design_library/<id>/design-system.json and tokens.css.',
    tokens: { night: changed('night'), day: changed('day') }, was: { night: was('night'), day: was('day') } }, null, 2) + '\n';
}
function renderKitTheme(K, d) {
  if (K.theme === 'default') return '<div class="banner mono">' + warnTok('[..]') + ' no design selected - the kit runs on its built-in token defaults; there is nothing to edit.</div>';
  if (!d) return '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' /api/v1/design/' + esc(K.theme) + ' - the design document could not be read.</div>';
  const mode = K.mode;
  const n = kitEditCount(d), nm = kitEditCount(d, mode);
  const previewName = kitThemePreviewName(K, d);
  K.thPreviewName = previewName;
  const groups = d.groups.map((g, i) => '<details class="th-grp" data-th-grp="' + esc(g.id) + '"' + (i === 0 ? ' open' : '') + '><summary><span class="th-grp-title">' + esc(g.title) + '</span><span class="mut">' + g.tokens.length + ' token(s)' + (g.kind ? ' &middot; ' + esc(g.kind) : '') + '</span></summary>' +
    (g.description ? '<p class="mut th-desc">' + esc(g.description) + '</p>' : '') +
    g.tokens.filter((t) => d.kindOf[t] && kitBaseValue(d, mode, t) !== undefined).map((t) => kitTokenRow(d, mode, t)).join('') + '</details>').join('');
  const warn = [];
  if (!d.doc.tokensFound) warn.push(warnTok('[NOT FOUND]') + ' ' + esc(d.doc.tokensFile) + ' - tokens come from design-system.json only; export writes a new tokens.css.');
  if (!d.doc.specFound) warn.push(warnTok('[NOT FOUND]') + ' ' + esc(d.doc.specFile));
  if (d.doc.specError) warn.push(warnTok('[!!]') + ' ' + esc(d.doc.specError));
  if (d.doc.specFound && !d.fromSpec) warn.push(mutTok('[..]') + ' design-system.json has no <code>tokenGroups</code>: tokens are grouped by the section banners of tokens.css and their kind is inferred from the value.');
  return '<div class="th">' +
    '<p class="mono mut th-lead">Edit the global design tokens of <b>' + esc(kitThemeName(K)) + '</b> (' + esc(d.doc.tokensFile) + ') for the <b>' + esc(mode) + '</b> mode. Changes preview live against the canonical reference source and component demos. Token drafts stay in this browser and export below; per-element geometry and line settings can be saved from ELEMENT SPEC.</p>' +
    warn.map((w) => '<p class="mono" style="font-size:12.5px">' + w + '</p>').join('') +
    '<div class="th-bar mono" role="group" aria-label="Theme editor actions">' +
      '<span>Editing: <b>' + esc(mode) + '</b> ' + kitModeButtons(K) + '</span>' +
      '<span class="th-find"><input type="search" id="th-filter" class="th-find-in" placeholder="filter tokens" aria-label="Filter tokens by name or value">' +
        '<button type="button" class="mono minibtn" id="th-changed" aria-pressed="false" title="Show only the tokens changed in this mode">[CHANGED ONLY]</button>' +
        '<span id="th-filtered" class="mut"></span></span>' +
      '<span id="th-count" class="mut">' + nm + ' changed in ' + esc(mode) + ' (' + n + ' total)</span>' +
      '<button type="button" class="mono minibtn" id="th-resetall">[RESET ALL]</button>' +
    '</div>' +
    '<div class="th-grid"><aside class="th-side">' +
      '<section class="th-live" aria-labelledby="th-live-title"><div class="th-live-head"><h4 id="th-live-title">LIVE COMPONENT PREVIEW</h4><span class="mono mut" id="th-preview-component-name"></span></div>' +
      '<label class="th-preview-pick">Preview <select id="th-preview-component" aria-label="Choose component for the live theme preview">' +
        '<option value="auto"' + (!K.thPreview || K.thPreview === 'auto' ? ' selected' : '') + '>Auto: component using focused token</option>' +
        kitThemePreviewComponents(K).map((c) => '<option value="' + esc(c.name) + '"' + (K.thPreview === c.name ? ' selected' : '') + '>' + esc(c.title || c.name) + '</option>').join('') +
      '</select></label>' +
      '<div class="th-live-stage" id="th-preview-stage"><iframe id="th-preview-frame" data-kit-live width="480" height="198" src="' + esc(kitThemePreviewUrl(K, previewName)) + '" title="Live theme preview" loading="eager"></iframe></div>' +
      '<p class="mono mut th-preview-status" id="th-preview-status" aria-live="polite"></p></section>' +
      '<details class="th-tools"><summary>CONTRAST AND EXPORT</summary><div id="th-contrast" class="th-contrast">' + kitRenderContrast(K, d) + '</div>' +
      '<div class="th-export"><h4>EXPORT</h4>' +
      '<p class="mono"><button type="button" class="mono minibtn" id="th-copy-css">[COPY tokens.css]</button> <button type="button" class="mono minibtn" id="th-dl-css">[DOWNLOAD tokens.css]</button><br>' +
      '<button type="button" class="mono minibtn" id="th-dl-json">[DOWNLOAD changes.json]</button> <button type="button" class="mono minibtn" id="th-show-css" aria-expanded="false">[SHOW tokens.css]</button></p>' +
      '<textarea id="th-css" class="th-css mono" readonly hidden spellcheck="false" aria-label="Generated tokens.css"></textarea>' +
      '<p class="th-how">Save the text as <code>design_library/&lt;your-id&gt;/tokens.css</code> (copy <code>design_library/' + esc(d.id) + '/</code> for the folder layout) and add the design to <code>design_library/manifest.json</code>. Or ask your agent: <code>"create a design from this theme"</code> and paste the exported changes.json.</p></div></details>' +
      '</aside><div class="th-tokens" id="th-tokens">' + groups + '</div></div></div>';
}
function kitThSync(K, d, name) {
  const row = document.querySelector('#th-tokens .th-row[data-token="' + name + '"]');
  if (!row) return;
  const mode = K.mode, val = kitValue(d, mode, name) || '', edited = d.edits[mode][name] !== undefined;
  row.classList.toggle('is-edited', edited);
  const rs = row.querySelector('.th-reset');
  if (rs) rs.hidden = !edited;
  const tx = row.querySelector('[data-th-text]');
  if (tx && document.activeElement !== tx) tx.value = val;
  const col = row.querySelector('[data-th-color]');
  if (col) { const c = kitResolveColor(d, mode, val, 0); if (c) col.value = kitHex(c); }
  const al = row.querySelector('[data-th-alpha]');
  if (al && document.activeElement !== al) { const c = kitResolveColor(d, mode, val, 0); if (c) al.value = String(Math.round(c.a * 100) / 100); }
  const fs = row.querySelector('[data-th-font]');
  if (fs) fs.value = Array.prototype.some.call(fs.options, (o) => o.value === val) ? val : '';
  /* the slider + stepper controls of kit-theme-plus.js have to follow the value too
     (length / number rows), otherwise a token changed from anywhere else goes stale */
  const num = row.querySelector('.tp-val');
  if (num && document.activeElement !== num) {
    const m = /^\s*(-?[\d.]+)\s*(px|rem|em)?\s*$/.exec(val);
    if (m) {
      num.value = String(parseFloat(m[1]));
      const rng = row.querySelector('.tp-range');
      if (rng && document.activeElement !== rng) rng.value = m[1];
    }
  }
}
function kitThFilter() {
  const box = document.getElementById('th-tokens');
  if (!box) return;
  const f = document.getElementById('th-filter');
  const btn = document.getElementById('th-changed');
  const needle = String(f ? f.value : '').trim().toLowerCase();
  const onlyChanged = !!(btn && btn.getAttribute('aria-pressed') === 'true');
  let shown = 0;
  box.querySelectorAll('.th-row').forEach((row) => {
    const hay = ((row.getAttribute('data-token') || '') + ' ' + row.textContent).toLowerCase();
    const show = (!needle || hay.indexOf(needle) >= 0) && (!onlyChanged || row.classList.contains('is-edited'));
    row.hidden = !show;
    if (show) shown += 1;
  });
  /* a group with nothing left in it should not leave its heading behind */
  box.querySelectorAll('.th-grp').forEach((g) => {
    let any = false;
    g.querySelectorAll('.th-row').forEach((r) => { if (!r.hidden) any = true; });
    g.hidden = !any;
    if (any && (needle || onlyChanged)) g.open = true;
  });
  const c = document.getElementById('th-filtered');
  if (c) c.textContent = (needle || onlyChanged) ? shown + ' shown' : '';
}
function kitThChanged(K, d, name) {
  // dependent colour rows (var(--x) references) follow their target
  d.order.forEach((n) => { if (n !== name && d.kindOf[n] === 'color' && /^var\(/.test(String(kitValue(d, K.mode, n)).trim())) kitThSync(K, d, n); });
  kitThSync(K, d, name);
  kitApplyAll();
  kitSaveDraft(d);
  const c = document.getElementById('th-count');
  if (c) c.textContent = kitEditCount(d, K.mode) + ' changed in ' + K.mode + ' (' + kitEditCount(d) + ' total)';
  const ct = document.getElementById('th-contrast');
  if (ct) ct.innerHTML = kitRenderContrast(K, d);
  const ta = document.getElementById('th-css');
  if (ta && !ta.hidden) ta.value = kitExportCss(d);
  kitThemePreviewStatus(K, d);
  kitThFilter();   /* the changed-only list has to follow the edit */
}
function kitThSet(K, d, name, value) {
  const mode = K.mode;
  value = String(value).trim();
  if (value === '' || value === kitBaseValue(d, mode, name)) delete d.edits[mode][name];
  else d.edits[mode][name] = value;
  kitThChanged(K, d, name);
}
function kitThInput(K, e) {
  const d = kitDesign(K), t = e.target;
  if (t.id === 'th-filter') { kitThFilter(); return; }
  if (!d) return;
  if (t.dataset.thText) {
    const v = t.value;
    if (v.trim() === '') return;                       // an empty field keeps the current value until you leave it
    kitThSet(K, d, t.dataset.thText, v);
  } else if (t.dataset.thColor) {
    const name = t.dataset.thColor, cur = kitResolveColor(d, K.mode, kitValue(d, K.mode, name), 0) || { r: 0, g: 0, b: 0, a: 1 };
    const nc = kitParseColor(t.value);
    if (nc) kitThSet(K, d, name, kitFmtColor({ r: nc.r, g: nc.g, b: nc.b, a: cur.a }, kitBaseValue(d, K.mode, name)));
  } else if (t.dataset.thAlpha) {
    const name = t.dataset.thAlpha, cur = kitResolveColor(d, K.mode, kitValue(d, K.mode, name), 0);
    const a = Math.max(0, Math.min(1, parseFloat(t.value)));
    if (cur && isFinite(a)) kitThSet(K, d, name, kitFmtColor({ r: cur.r, g: cur.g, b: cur.b, a }, 'rgba('));
  } else if (t.dataset.thFont) {
    if (t.value) kitThSet(K, d, t.dataset.thFont, t.value);
  }
}
function kitThClick(K, t) {
  const d = kitDesign(K);
  if (!d) return false;
  if (t.id === 'th-changed') {
    const on = t.getAttribute('aria-pressed') === 'true';
    t.setAttribute('aria-pressed', String(!on));
    t.textContent = on ? '[CHANGED ONLY]' : '[*CHANGED ONLY]';
    kitThFilter();
    return true;
  }
  if (t.dataset.thReset) { kitThSet(K, d, t.dataset.thReset, kitBaseValue(d, K.mode, t.dataset.thReset)); return true; }
  if (t.id === 'th-resetall') {
    if (!t.dataset.armed) {
      t.dataset.armed = '1'; t.textContent = '[CLICK AGAIN TO CONFIRM]';
      setTimeout(() => { if (document.body.contains(t)) { delete t.dataset.armed; t.textContent = '[RESET ALL]'; } }, 3000);
      return true;
    }
    d.edits = { night: {}, day: {} };
    kitSaveDraft(d); kitApplyAll(); kitRepaintTheme();
    return true;
  }
  if (t.id === 'th-copy-css') { kitCopyText(kitExportCss(d), t); return true; }
  if (t.id === 'th-dl-css') { kitDownload('tokens.css', 'text/css', kitExportCss(d)); return true; }
  if (t.id === 'th-dl-json') { kitDownload('changes.json', 'application/json', kitExportJson(d)); return true; }
  if (t.id === 'th-show-css') {
    const ta = document.getElementById('th-css');
    if (ta) { ta.hidden = !ta.hidden; if (!ta.hidden) ta.value = kitExportCss(d); t.setAttribute('aria-expanded', String(!ta.hidden)); t.textContent = ta.hidden ? '[SHOW tokens.css]' : '[HIDE tokens.css]'; }
    return true;
  }
  if (t.dataset.thUses) { kitSpecFilter(K, t.dataset.thUses); return true; }
  return false;
}
async function kitRepaintTheme() {
  const K = window.__kit, box = document.getElementById('kit-tab-theme');
  if (!K || !box) return;
  const d = await kitEnsureDesign(K);
  box.innerHTML = renderKitTheme(K, d && !d.missing ? d : null);
  if (d && !d.missing) {
    const frame = document.getElementById('th-preview-frame');
    const stage = document.getElementById('th-preview-stage');
    if (frame) frame.onload = () => kitThemePreviewReady(K, d);
    if (K.thPreviewRO) { K.thPreviewRO.disconnect(); K.thPreviewRO = null; }
    if (stage && window.ResizeObserver) {
      K.thPreviewRO = new ResizeObserver(() => kitThemePreviewResize());
      K.thPreviewRO.observe(stage);
    }
    kitThemePreviewResize();
    kitThemePreviewStatus(K, d);
  }
}
function kitThemeJump(name) {
  const K = window.__kit;
  kitSetTab(K, 'theme').then(() => {
    const row = document.querySelector('#th-tokens .th-row[data-token="' + name + '"]');
    if (!row) return;
    const group = row.closest('details.th-grp');
    if (group) group.open = true;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1800);
    const inp = row.querySelector('input[type="text"]');
    if (inp) inp.focus({ preventScroll: true });
  });
}

/* ─── ELEMENT SPEC ─── */
function kitSpecGroups(d) {
  const els = d.elements, names = Object.keys(els).filter((n) => n.charAt(0) !== '_' && els[n] && typeof els[n] === 'object');
  let order = d.spec.groups || d.spec.elementGroups || (els._groups) || null;
  order = Array.isArray(order) ? order.map((g) => (typeof g === 'string' ? g : String(g.id || g.title))) : [];
  names.forEach((n) => { const g = els[n].group || 'Other'; if (order.indexOf(g) < 0) order.push(g); });
  return order.map((g) => ({ id: g, items: names.filter((n) => (els[n].group || 'Other') === g) })).filter((g) => g.items.length);
}
function kitSpecTokenChip(d, mode, v) {
  const s = String(v);
  const toks = s.match(/--[A-Za-z0-9_-]+/g);
  if (!toks) return '<span class="mono">' + esc(s) + '</span>';
  return '<span class="mono">' + esc(s).replace(/--[A-Za-z0-9_-]+/g, (t) => {
    const cur = kitValue(d, mode, t), c = cur ? kitResolveColor(d, mode, cur, 0) : null;
    return '<button type="button" class="sp-tok" data-sp-token="' + t + '" title="' + esc(cur == null ? 'not a token of this design' : cur) + ' - open in the theme editor">' +
      (c ? '<i class="sw" style="background:' + esc(kitHex(c)) + '"></i>' : '') + t + '</button>';
  }) + '</span>';
}
function kitSpecCard(K, d, name) {
  const e = d.elements[name], comp = kitComp(K, name);
  const parts = e.parts && typeof e.parts === 'object' ? e.parts : {};
  const prop = (k, val) => '<span class="sp-prop"><span class="mut">' + esc(k) + '</span> ' + kitSpecTokenChip(d, K.mode, val) + '</span>';
  const prow = [];
  Object.keys(parts).forEach((p) => {
    const props = parts[p];
    prow.push([mono(p), props && typeof props === 'object' ? Object.keys(props).map((k) => prop(k, props[k])).join(' ') : kitSpecTokenChip(d, K.mode, props)]);
  });
  const srow = [];
  const states = e.states && typeof e.states === 'object' ? e.states : {};
  Object.keys(states).forEach((s) => {
    const m = states[s];
    srow.push([mono(s), m && typeof m === 'object' ? Object.keys(m).map((k) => prop(k, m[k])).join(' ') : kitSpecTokenChip(d, K.mode, m)]);
  });
  const sz = e.sizes && typeof e.sizes === 'object' ? e.sizes : null;
  const opts = Array.isArray(e.options) ? e.options : [];
  const a11y = e.a11y && typeof e.a11y === 'object' ? e.a11y : null;
  const tuning = d.tuningSchema[name] || [];
  const tuned = !!(d.tuningEdits[name] && Object.keys(d.tuningEdits[name]).length);
  const demo = comp && comp.demo && comp.demo.url ? comp : null;
  const SP = 0.7;   // the demo page keeps its exact 16 px cells; the frame is only shown smaller (CSS scale) so type never collides
  const pw = demo ? Math.round((demo.demo.cols || 30) * KIT_CELL_PX) : 0, ph = demo ? Math.round((demo.demo.rows || 12) * KIT_CELL_PX) : 0;
  return '<article class="sp-card' + (tuned ? ' is-tuned' : '') + '" data-sp-el="' + esc(name) + '" id="sp-' + esc(name) + '">' +
    '<header><h4>' + esc((e.title || name).toUpperCase()) + ' <span class="chip mono">' + esc(e.group || 'Other') + '</span> <code class="mut">data-apc="' + esc(name) + '"</code></h4>' +
    (e.summary ? '<p>' + esc(e.summary) + '</p>' : '') + '</header>' +
    '<div class="sp-body">' +
      (demo ? '<div class="sp-prev" style="width:' + Math.round(pw * SP) + 'px;height:' + Math.round(ph * SP) + 'px"><iframe style="transform:scale(' + SP + ')" data-kit-live data-src="' + esc(demo.demo.url + '?theme=' + encodeURIComponent(K.theme) + '&mode=' + K.mode) + '" sandbox="allow-scripts allow-same-origin" title="Preview: ' + esc(name) + '" width="' + pw + '" height="' + ph + '" loading="lazy"></iframe></div>'
        : '<div class="sp-prev sp-noprev mut mono">no demo page</div>') +
      '<div class="sp-tables">' +
        (prow.length ? '<h5>PARTS -> TOKENS</h5>' + table(['Part', 'Properties and tokens'], prow, false) : mutTok('no parts listed')) +
        (srow.length ? '<h5>STATES (replace the default while the state applies)</h5>' + table(['State', 'Part.property and value'], srow, false) : '') +
        (sz ? '<h5>SIZES</h5><p class="mono">default: ' + esc(typeof sz.default === 'object' ? JSON.stringify(sz.default) : String(sz.default == null ? '-' : sz.default)) +
          (Array.isArray(sz.overridable) && sz.overridable.length ? ' &middot; overridable: ' + sz.overridable.map((x) => '<code>' + esc(x) + '</code>').join(' ') : '') + '</p>' : '') +
        (opts.length ? '<h5>OPTIONS</h5><div class="kit-chips">' + opts.map((o) => '<span class="chip mono">' + esc(typeof o === 'string' ? o : (o.name || JSON.stringify(o))) + '</span>').join('') + '</div>' : '') +
        (a11y ? '<h5>A11Y</h5><p class="mono">role: <b>' + esc(a11y.role || '-') + '</b>' + (a11y.keys ? ' &middot; keys: ' + esc(Array.isArray(a11y.keys) ? a11y.keys.join(' / ') : String(a11y.keys)) : '') + '</p>' : '') +
      '</div></div>' +
    (tuning.length ? '<details class="sp-tune"><summary>ADJUST THIS ELEMENT <span class="mut">' + tuning.length + ' supported settings</span></summary>' +
      '<p class="mono mut">Geometry and line weight are element-level overrides. Colour stays in the global theme tokens above.</p>' +
      '<div class="sp-tune-grid">' + tuning.map((c) => kitTuneControl(d, name, c)).join('') + '</div>' +
      '<button type="button" class="mono minibtn" data-sp-tune-reset="' + esc(name) + '">[RESET TO SAVED LIBRARY VALUES]</button></details>' : '') +
    '</article>';
}
function renderKitSpec(K, d) {
  if (K.theme === 'default') return '<div class="banner mono">' + warnTok('[..]') + ' no design selected.</div>';
  if (!d) return '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' /api/v1/design/' + esc(K.theme) + '</div>';
  const groups = kitSpecGroups(d);
  if (!groups.length) {
    return '<div class="banner mono">' + warnTok('[..]') + ' ' + esc(d.doc.specFile) + ' has no <code>elements</code> specification yet' +
      (d.elements && d.elements._note ? ' (<span class="mut">' + esc(d.elements._note) + '</span>)' : '') +
      '. Until it is written, the global look comes from the THEME EDITOR tab. Element geometry can be tuned in the Hub and saved as validated numeric overrides in <code>elementTuning</code>.</div>';
  }
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const tuneDirty = kitTuneCount(d);
  return '<div class="sp">' +
    '<div class="sp-bar mono" role="group" aria-label="Element spec filters">' +
      '<label>Filter <input type="search" id="sp-q" value="' + esc(K.specQ || '') + '" placeholder="element, group or --token" spellcheck="false"></label>' +
      '<span class="mut" id="sp-count">' + total + ' elements in ' + groups.length + ' groups, from ' + esc(d.doc.specFile) + '</span>' +
      '<button type="button" class="mono minibtn" id="sp-tune-save"' + (tuneDirty ? '' : ' disabled') + '>[SAVE TO ' + esc(d.doc.name.toUpperCase()) + ' LIBRARY]</button>' +
      '<button type="button" class="mono minibtn" id="sp-tune-reset">[RESET UNSAVED TUNING]</button>' +
      '<span class="mut" id="sp-tune-count">' + tuneDirty + ' unsaved tuning change(s)</span>' +
    '</div>' +
    '<p class="mono mut sp-tune-note">Tune supported sizes, radii and line thickness per element, then save the values into the selected design library. Colours remain global design tokens. Saving is available only for a design with a writable element specification.</p>' +
    '<p class="mono mut" id="sp-tune-status" role="status" aria-live="polite"></p>' +
    groups.map((g) => '<div class="sp-grp" data-sp-grp="' + esc(g.id) + '"><h3>' + esc(g.id.toUpperCase()) + '</h3>' + g.items.map((n) => kitSpecCard(K, d, n)).join('') + '</div>').join('') +
  '</div>';
}
function kitSpecApplyFilter() {
  const K = window.__kit, q = String(K.specQ || '').trim().toLowerCase();
  const d = kitDesign(K);
  let shown = 0;
  Array.prototype.forEach.call(document.querySelectorAll('#kit-tab-spec .sp-card'), (c) => {
    const el = d && d.elements[c.dataset.spEl];
    const hay = (c.dataset.spEl + ' ' + (el ? JSON.stringify(el) : '')).toLowerCase();
    const on = !q || hay.indexOf(q) >= 0;
    c.hidden = !on;
    if (on) shown++;
  });
  Array.prototype.forEach.call(document.querySelectorAll('#kit-tab-spec .sp-grp'), (g) => { g.hidden = !g.querySelector('.sp-card:not([hidden])'); });
  const cnt = document.getElementById('sp-count');
  if (cnt) cnt.textContent = shown + ' element(s) match' + (q ? ' "' + K.specQ + '"' : '');
  kitSpecLazy();
}
function kitSpecFilter(K, q) {
  K.specQ = q;
  kitSetTab(K, 'spec').then(() => {
    const inp = document.getElementById('sp-q');
    if (inp) inp.value = q;
    kitSpecApplyFilter();
    const tb = document.getElementById('kit-tabbtn-spec');
    if (tb && tb.scrollIntoView) tb.scrollIntoView({ block: 'start' });
  });
}
function kitSpecLazy() {
  // one mini demo page per card, loaded when the card nears the viewport (and only on the SPEC tab)
  const K = window.__kit;
  if (!K || K.tab !== 'spec') return;
  const frames = Array.prototype.filter.call(document.querySelectorAll('#kit-tab-spec iframe[data-src]'), (f) => !f.closest('[hidden]'));
  if (!('IntersectionObserver' in window)) { frames.forEach((f) => { f.src = f.dataset.src; f.removeAttribute('data-src'); }); return; }
  if (!K.specIO) {
    K.specIO = new IntersectionObserver((ents) => {
      ents.forEach((en) => {
        const f = en.target;
        if (!en.isIntersecting || !f.dataset.src) return;
        f.onload = () => { try { kitApplyEdits(f.contentDocument); } catch { /* not ready */ } };
        f.src = f.dataset.src; f.removeAttribute('data-src'); K.specIO.unobserve(f);
      });
    }, { rootMargin: '300px' });
  }
  frames.forEach((f) => { if (f.dataset.src) K.specIO.observe(f); });
}
async function kitRepaintSpec() {
  const K = window.__kit, box = document.getElementById('kit-tab-spec');
  if (!K || !box) return;
  const d = await kitEnsureDesign(K);
  box.innerHTML = renderKitSpec(K, d && !d.missing ? d : null);
  if (K.specIO) { K.specIO.disconnect(); K.specIO = null; }
  if (K.specQ) kitSpecApplyFilter(); else kitSpecLazy();
}

/* ─── tabs ─── */
function renderKitTabs(K) {
  const multi = kitThemes(K).filter((t) => t.found).length > 1;
  const sel = multi ? '<label class="kit-design-sel">Design <select id="kit-theme" aria-label="Design">' +
    kitThemes(K).map((t) => '<option value="' + esc(t.id) + '"' + (K.theme === t.id ? ' selected' : '') + (t.found ? '' : ' disabled') + '>' + esc(t.title) + (t.found ? '' : ' [NOT FOUND]') + '</option>').join('') + '</select></label>' : '';
  return '<nav class="kit-tabs" role="tablist" aria-label="KIT sections">' + KIT_TABS.map(([id, lab]) =>
    '<a role="tab" class="kit-tab" id="kit-tabbtn-' + id + '" data-kit-tab="' + id + '" href="?kit=' + id + '#09c-kit"' +
    ' aria-controls="kit-tab-' + id + '" aria-selected="' + (K.tab === id) + '"' +
    (K.tab === id ? ' aria-current="page"' : '') + ' tabindex="' + (K.tab === id ? '0' : '-1') + '">' +
    (K.tab === id ? '[*' + lab + ']' : '[' + lab + ']') + '</a>').join('') + sel + '</nav>';
}
async function kitSetTab(K, id, opts) {
  if (!KIT_TABS.some((t) => t[0] === id)) id = 'components';
  K.tab = id;
  kitSaveState();
  /* The four sections are subpages, but the Hub shows a section purely by CSS :target
     (shell.css: section:target), and an id can never be "09c-kit/theme". So the subpage
     travels in the query string and the hash stays #09c-kit: deep links, reload and
     back/forward all keep pointing at a real element. */
  if (!(opts && opts.noUrl)) {
    const want = '?kit=' + id + '#09c-kit';
    if (location.search + location.hash !== want) {
      try { history.pushState(null, '', want); } catch (err) { /* file:// */ }
    }
  }
  KIT_TABS.forEach(([t, lab]) => {
    const b = document.getElementById('kit-tabbtn-' + t), p = document.getElementById('kit-tab-' + t);
    if (b) {
      b.setAttribute('aria-selected', String(t === id));
      if (t === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.tabIndex = t === id ? 0 : -1;
      b.textContent = t === id ? '[*' + lab + ']' : '[' + lab + ']';
    }
    if (p) p.hidden = t !== id;
  });
  if (id === 'components' && K.active) { const kf = document.getElementById('kit-frame'); if (kf && !kf.getAttribute('src')) kitReloadFrame(); }
  else if (id === 'theme') await kitRepaintTheme();
  else if (id === 'spec') await kitRepaintSpec();
}

/* ─── page ─── */
function renderKit(K0) {
  const k = '<p class="kicker"><span class="n">09c</span>// KIT - APC Minimal library: canonical face + source-backed component spec - source: hub/_design/apc_filter_f30_annotate_v006.html</p>';
  const pg = pager('09b-standards', null, '10-documentation');
  if (!K0) {
    return k + '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' /api/v1/kit unreachable - expected endpoint of this hub</div>' + pg;
  }
  if (!K0.kitFound) {
    return k + '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' ' + esc(K0.expected || K0.kitDir) + ' - the UI kit folder is missing; nothing to show.</div>' + pg;
  }
  if (!K0.catalogFound) {
    return k + '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' ' + esc(K0.catalogFile) + ' - component catalog missing.</div>' + pg;
  }
  const saved = kitLoadState();
  const K = window.__kit = { data: K0, sel: null, theme: 'default', scenario: 'demo', scale: 100, mode: 'night', active: false, tab: 'components',
    refScale: 100, refCols: 120, refRows: 70, designs: {}, specQ: '', thPreview: 'auto', thPreviewToken: null, thPreviewName: 'slider', thPreviewRO: null };
  const found = kitThemes(K).filter((t) => t.found);
  K.theme = found.some((t) => t.id === saved.theme) ? saved.theme : (found[0] ? found[0].id : 'default');   // a stale 'default tokens' choice migrates to the first design
  K.scale = KIT_SCALES.indexOf(saved.scale) >= 0 ? saved.scale : 100;
  K.refScale = KIT_REF_SCALES.indexOf(saved.refScale) >= 0 ? saved.refScale : 100;
  K.mode = saved.mode === 'day' || saved.mode === 'night' ? saved.mode : 'night';
  if (kitModes(K).indexOf(K.mode) < 0) K.mode = kitModes(K)[0];
  K.tab = KIT_TABS.some((t) => t[0] === saved.tab) ? saved.tab : 'components';
  K.scenario = saved.scenario || 'demo';
  const first = kitComp(K, saved.sel) ? saved.sel : (K0.components[0] || {}).name;
  if (first) kitSelect(K, first);
  const nReg = Object.keys(K0.registered || {}).length;
  const issues = K0.issues || [];
  const th = K0.themes;
  return k +
    '<div class="banner mono">' + K0.components.length + ' catalog entries &middot; ' + nReg + ' registered via APC.register in ' + esc(K0.kitDir) + '/ &middot; ' +
    K0.scenarios.names.length + ' mock scenarios &middot; ' + (th.items || []).length + ' design(s) in design_library/' +
    (issues.length ? '<br>' + warnTok('[!!]') + ' ' + issues.length + ' catalog issue(s) at the bottom of the page' : '<br>' + okTok('[OK]') + ' catalog and kit agree') + '</div>' +
    (th.manifestFound ? '' : '<div class="banner mono">' + warnTok('[NOT FOUND]') + ' ' + esc(th.expected) + ' - no design available: the kit shows its built-in token defaults</div>') +
    '<div class="kit">' + renderKitRef(K) + renderKitTabs(K) +
    '<div class="kit-panel" role="tabpanel" id="kit-tab-components" aria-labelledby="kit-tabbtn-components"' + (K.tab === 'components' ? '' : ' hidden') + '>' +
      '<p class="full">Every component of templates/webview/apc-ui/ on its own demo page, running on the kit\'s mock backend (apc-mock.js, no network). Demos are sandboxed pages served by this hub; nothing here writes anything.</p>' +
      '<div class="kit-grid">' + renderKitList(K) + '<div class="kit-main" id="kit-main">' + renderKitDetail(K) + '</div></div></div>' +
    '<div class="kit-panel" role="tabpanel" id="kit-tab-theme" aria-labelledby="kit-tabbtn-theme"' + (K.tab === 'theme' ? '' : ' hidden') + '><p class="mut mono">loading the design...</p></div>' +
    '<div class="kit-panel" role="tabpanel" id="kit-tab-spec" aria-labelledby="kit-tabbtn-spec"' + (K.tab === 'spec' ? '' : ' hidden') + '><p class="mut mono">loading the design...</p></div>' +
    '<div class="kit-panel" role="tabpanel" id="kit-tab-coverage" aria-labelledby="kit-tabbtn-coverage"' + (K.tab === 'coverage' ? '' : ' hidden') + '>' + renderKitCoverage(K) + '</div>' +
    (issues.length ? '<h3>CATALOG ISSUES</h3><pre class="screen">' + issues.map((i) => '[!!] ' + esc(i)).join('\n') + '</pre>' : '') +
    '</div>' + pg;
}
function kitActivate() {
  const K = window.__kit;
  if (!K || K.refOn) return;
  kitRefLoad();                                           // the iframes load only once the page is opened
  if (K.tab === 'components') kitReloadFrame();
  else kitSetTab(K, K.tab);
  if (window.ResizeObserver) {
    const st = document.getElementById('ref-stage');
    if (st) new ResizeObserver(() => kitRefSize()).observe(st);
  }
}
function kitModeChanged(K) {
  kitSaveState();
  // every mode button of the page (reference bar, components bar, theme editor) shows the same state
  $$('[data-kit-mode]', document.getElementById('09c-kit')).forEach((b) => {
    const m = b.dataset.kitMode, lab = m.toUpperCase();
    b.className = K.mode === m ? 'on' : '';
    b.setAttribute('aria-pressed', String(K.mode === m));
    b.textContent = K.mode === m ? '[*' + lab + ']' : '[' + lab + ']';
  });
  if (K.refOn) kitRefLoad();
  if (K.active && K.tab === 'components') kitReloadFrame();
  if (K.tab === 'theme') kitRepaintTheme();
  if (K.tab === 'spec') kitRepaintSpec();
}
function kitThemeChanged(K) {
  if (kitModes(K).indexOf(K.mode) < 0) K.mode = kitModes(K)[0];
  kitSaveState();
  const set = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  set('ref-design', 'Design library: <b>APC Minimal</b> &middot; source: <code>hub/_design/apc_filter_f30_annotate_v006.html</code>');
  kitModeChanged(K);
  kitRepaintDetail();
}
function wireKit() {
  const sec = document.getElementById('09c-kit');
  if (!sec || !window.__kit) return;
  const K = window.__kit;
  sec.addEventListener('click', (e) => {
    const t = e.target.closest ? e.target.closest('button, a[data-kit-tab]') : null;
    if (!t) return;
    if (t.dataset.kitTab) {
      if (t.tagName === 'A') e.preventDefault();   // in-page tab switch, not a navigation
      kitSetTab(K, t.dataset.kitTab);
      return;
    }
    if (t.dataset.kitSel || t.dataset.kitGo) {
      if (t.dataset.kitGo && K.tab !== 'components') kitSetTab(K, 'components');
      kitSelect(K, t.dataset.kitSel || t.dataset.kitGo);
      kitRepaintDetail();
      if (t.dataset.kitGo) { const el = document.getElementById('kit-tabbtn-components'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }
    } else if (t.dataset.kitMode) {
      if (K.mode !== t.dataset.kitMode) { K.mode = t.dataset.kitMode; kitModeChanged(K); }
    } else if (t.id === 'ref-reload') {
      kitRefLoad();
    } else if (t.id === 'kit-reload') {
      kitReloadFrame();
    } else if (t.id === 'kit-copy') {
      const c = kitComp(K, K.sel);
      if (c) kitCopyText(c.markup, t);
    } else if (t.id === 'sp-tune-save') {
      kitTuneSave(K);
    } else if (t.id === 'sp-tune-reset') {
      kitTuneReset(K);
    } else if (t.dataset.spTuneReset) {
      kitTuneReset(K, t.dataset.spTuneReset);
    } else if (t.dataset.spToken) {
      kitThemeJump(t.dataset.spToken);
    } else {
      kitThClick(K, t);
    }
  });
  sec.addEventListener('focusin', (e) => {
    if (K.tab !== 'theme' || !e.target.closest) return;
    const row = e.target.closest('.th-row[data-token]');
    const d = row && kitDesign(K);
    if (row && d) kitThemePreviewFocus(K, d, row.getAttribute('data-token'));
  });
  sec.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.kitTab || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End')) return;
    const ids = KIT_TABS.map((x) => x[0]);
    let i = ids.indexOf(t.dataset.kitTab);
    i = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
    e.preventDefault();
    kitSetTab(K, ids[i]).then(() => { const b = document.getElementById('kit-tabbtn-' + ids[i]); if (b) b.focus(); });
  });
  sec.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'sp-q') { K.specQ = t.value; kitSpecApplyFilter(); }
    else if (t.matches && t.matches('[data-sp-tune]')) kitTuneInput(K, t);
    else if (t.id === 'th-filter') kitThFilter();
    else if (t.dataset && (t.dataset.thText || t.dataset.thColor || t.dataset.thAlpha)) kitThInput(K, e);
  });
  sec.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'th-preview-component') {
      K.thPreview = t.value;
      const d = kitDesign(K);
      if (d) kitThemePreviewLoad(K, d);
      return;
    }
    if (t.dataset && t.dataset.thFont) { kitThInput(K, e); return; }
    if (t.dataset && t.dataset.thText && t.value.trim() === '') { const d = kitDesign(K); if (d) kitThSet(K, d, t.dataset.thText, ''); return; }
    if (t.id === 'kit-theme') {
      K.theme = t.value;
      kitThemeChanged(K);
    } else if (t.id === 'kit-scn') {
      K.scenario = t.value; kitSaveState(); kitRepaintDetail();
    } else if (t.id === 'ref-scale') {
      K.refScale = Number(t.value) || 100; kitSaveState(); kitRefSize();
    } else if (t.id === 'ref-jump') {
      kitRefHighlight(t.value);
    } else if (t.id === 'kit-scale') {
      K.scale = Number(t.value) || 100;
      kitSaveState();
      const f = document.getElementById('kit-frame');
      const c = kitComp(K, K.sel);
      if (f && c && c.demo.cols) {   // resize only: the demo keeps its state, the kit's own scaling engine re-fits
        f.width = String(Math.round(c.demo.cols * KIT_CELL_PX * K.scale / 100));
        f.height = String(Math.round(c.demo.rows * KIT_CELL_PX * K.scale / 100));
      }
    }
  });
  // 05 DESIGNS -> [open in KIT]
  document.addEventListener('click', (e) => {
    const a = e.target.closest ? e.target.closest('[data-kit-open]') : null;
    if (!a) return;
    const id = a.getAttribute('data-kit-open');
    if (id && kitThemes(K).some((t) => t.id === id && t.found) && K.theme !== id) {
      const sel = document.getElementById('kit-theme');
      if (sel) sel.value = id;
      K.theme = id;
      kitThemeChanged(K);
    }
  });
}
