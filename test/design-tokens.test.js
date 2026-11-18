'use strict';
// APC Minimal token contract: design_library/apc-minimal/tokens.css is canonical.
//  - apc-core.css :root defaults EQUAL the tokens.css night values (the kit looks like APC Minimal with no design loaded)
//  - design-system.json documents the same values (night + resolved day) and its WCAG pairs are met
//  - the manifest entry points at files that exist
// Zero deps: node:test + node:assert.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DESIGN = path.join(ROOT, 'design_library', 'apc-minimal');
const lib = require(path.join(ROOT, 'scripts', 'design-tokens-check.js'));

const tokensCss = fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8');
const coreCss = fs.readFileSync(path.join(ROOT, 'templates', 'webview', 'apc-ui', 'apc-core.css'), 'utf8');
const spec = JSON.parse(fs.readFileSync(path.join(DESIGN, 'design-system.json'), 'utf8'));
const parsed = lib.parseTokensCss(tokensCss);
const modes = lib.resolveModes(parsed);

test('tokens.css: parses, night block is the full contract, day only overrides existing names', () => {
  assert.ok(Object.keys(parsed.night).length >= 60, 'night tokens: ' + Object.keys(parsed.night).length);
  for (const n of Object.keys(parsed.day)) assert.ok(n in parsed.night, 'day overrides unknown token ' + n);
  for (const n of ['--accent', '--accent-ink', '--accent-text', '--ok', '--apc-danger', '--r-control', '--r-radio', '--r-led', '--font-ui', '--font-text', '--viz-1', '--t-label', '--ctl-h', '--knob-size', '--apc-viz-node', '--apc-logo-h']) {
    assert.ok(n in parsed.night, n + ' is part of the contract');
  }
});

test('depth by tokens: radii from the radius group, shadows only from the depth tokens, no network references in tokens.css', () => {
  /* v006 replaced "flat by construction": depth is now token-driven - 2-3px radii, three
     shadow tokens and a 10% cyan grid - but it is still all tokens, never ad-hoc values. */
  assert.equal(parsed.night['--r-control'], '2px');
  assert.equal(parsed.night['--r-panel'], '3px');
  assert.equal(parsed.night['--r-led'], '1px', 'lamps are square chips');
  assert.equal(parsed.night['--r-radio'], '2px', 'a radio uses the checkbox square mark');
  for (const n of ['--sh-recess', '--sh-raised', '--apc-shadow-pop', '--sh-knob']) {
    assert.ok(parsed.night[n] && parsed.night[n] !== 'none', n + ' is a real shadow token');
  }
  const code = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/@import|https?:\/\//i.test(code), 'no network references');
  /* the bundled families are local files, never a CDN */
  const fonts = [...code.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(fonts.length >= 5, 'the five bundled faces are declared');
  for (const f of fonts) assert.ok(/^fonts\/[a-z0-9-]+\.woff2$/.test(f), 'local font file only: ' + f);
});

test('apc-core.css :root defaults equal tokens.css night values (same names, same values)', () => {
  const defaults = lib.parseRootDefaults(coreCss);
  const diffs = [];
  for (const [name, value] of Object.entries(parsed.night)) {
    if (!(name in defaults)) diffs.push(name + ' missing in apc-core.css');
    else if (defaults[name] !== value) diffs.push(name + ': tokens.css=' + value + ' apc-core.css=' + defaults[name]);
  }
  assert.deepEqual(diffs, []);
});

test('apc-core.css [data-theme="day"] defaults equal the tokens.css day block', () => {
  const day = lib.parseTokensCss(coreCss).day;
  assert.deepEqual(day, parsed.day);
});

test('design-system.json matches tokens.css (night + resolved day) and documents every token', () => {
  assert.equal(spec.id, 'apc-minimal');
  assert.deepEqual(spec.tokens.night, modes.night, 'tokens.night == tokens.css night block');
  assert.deepEqual(spec.tokens.day, modes.day, 'tokens.day == night overlaid with the day block');
  assert.deepEqual(lib.checkDesign(DESIGN), []);
});

test('design-system.json: palette values equal the tokens, required sections exist', () => {
  for (const mode of ['night', 'day']) {
    for (const [name, p] of Object.entries(spec.palette[mode])) {
      assert.equal(p.value, modes[mode][name], mode + ' palette ' + name);
      assert.ok(p.role && p.role.length > 10, mode + ' ' + name + ' has a role description');
    }
  }
  for (const key of ['name', 'version', 'philosophy', 'principles', 'palette', 'contrast', 'typography', 'shape', 'spacing', 'sizing', 'motion', 'dataviz', 'tokens', 'elements']) {
    assert.ok(key in spec, 'section ' + key);
  }
  for (const key of ['groups', 'stateNames', 'elementsSchema', 'fontsets', 'scales', 'tokenGroups']) assert.ok(key in spec, 'section ' + key);
  assert.equal(spec.shape.radius['--r-control'], '0');
  assert.equal(spec.motion.default, 'none');
  assert.equal(spec.typography.families.ui.value, modes.night['--font-ui']);
  assert.equal(spec.typography.families.text.value, modes.night['--font-text']);
});

test('WCAG: every documented pair is met in its mode (text >= 4.5, graphics >= 3) and the ratios are current', () => {
  const pairs = spec.contrast.pairs;
  assert.ok(pairs.length >= 40);
  assert.ok(pairs.some((p) => p.mode === 'night') && pairs.some((p) => p.mode === 'day'), 'both modes are covered');
  for (const p of pairs) {
    const r = lib.tokenRatio(modes[p.mode], p.fg, p.bg);
    assert.ok(r !== null, p.mode + ' ' + p.fg + '/' + p.bg + ' resolves to solid colours');
    assert.equal(p.min, p.kind === 'text' ? 4.5 : 3);
    /* a pair may carry a written waiver for the approved palette; the ratio is still verified */
    if (!p.waiver) assert.ok(r >= p.min, p.mode + ' ' + p.fg + ' on ' + p.bg + ': ' + r.toFixed(2) + ' < ' + p.min);
    else assert.ok(typeof p.waiver === 'string' && p.waiver.length > 20, p.mode + ' ' + p.fg + ' on ' + p.bg + ': a waiver needs a written reason');
    assert.ok(Math.abs(r - p.ratio) <= 0.011, p.mode + ' ' + p.fg + ' on ' + p.bg + ': documented ' + p.ratio + ', actual ' + r.toFixed(2));
  }
  // the pairs that matter most are really in the list
  const has = (mode, fg, bg) => pairs.some((p) => p.mode === mode && p.fg === fg && p.bg === bg);
  for (const mode of ['night', 'day']) {
    for (const [fg, bg] of [['--ink', '--plate'], ['--ink-2', '--plate'], ['--ink-2', '--plate-2'], ['--accent', '--plate'], ['--accent-ink', '--accent'], ['--rule', '--plate'],
      ['--accent-text', '--plate'], ['--accent-text', '--plate-2'], ['--accent-text', '--inset'], ['--accent-text', '--surface']]) {
      assert.ok(has(mode, fg, bg), mode + ' documents ' + fg + ' on ' + bg);
    }
  }
  // --accent-text is TEXT: every one of its pairs is a text pair (>= 4.5:1), also in day mode on the darkest well
  for (const p of pairs.filter((x) => x.fg === '--accent-text')) assert.equal(p.kind, 'text');
});

test('accent-coloured TEXT uses --accent-text, never --accent (day --accent is not 4.5:1 on --plate-2 / --inset)', () => {
  const UI = path.join(ROOT, 'templates', 'webview', 'apc-ui');
  // text colour declarations only: "color: var(--accent)" that is not border-color / outline-color / background / fill
  const offenders = [];
  for (const f of ['apc-components.css', 'apc-widgets.css', 'apc-viz.css']) {
    const css = fs.readFileSync(path.join(UI, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    css.split('\n').forEach((line, i) => {
      if (/(?<![-\w])color:\s*var\(--accent\)/.test(line)) offenders.push(f + ':' + (i + 1) + ' ' + line.trim().slice(0, 90));
    });
  }
  // the two intentional graphic uses (glyphs on an accent surface): the open dropdown caret and the list check mark
  const allowed = offenders.filter((o) => /apc-dd__caret|apc-li__box/.test(o));
  assert.deepEqual(offenders.filter((o) => !allowed.includes(o)), [], 'accent text must use --accent-text');
  assert.equal(allowed.length, 2, 'only the caret and the list tick keep --accent');
  /* v006: --accent-text is its own text-safe tint in BOTH modes (night #FF7B64 on the plate
     is 7.6:1; day is a darker red) - it is no longer a copy of --accent at night. */
  assert.notEqual(modes.night['--accent-text'].toLowerCase(), modes.night['--accent'].toLowerCase(), 'night: accent text is its own tint');
  const rNight = lib.tokenRatio(modes.night, '--accent-text', '--plate');
  assert.ok(rNight !== null && rNight >= 4.5, 'night accent text on plate: ' + (rNight || 0).toFixed(2));
  assert.notEqual(modes.day['--accent-text'].toLowerCase(), modes.day['--accent'].toLowerCase(), 'day: accent text is a darker red');
});

test('apc-widgets.css day palette mirror equals the tokens.css day block (values only)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'templates', 'webview', 'apc-ui', 'apc-widgets.css'), 'utf8');
  assert.deepEqual(lib.parseTokensCss(css).day, parsed.day);
});

test('drift is detected: a changed token value or a missing token fails checkDesign (fixture)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-tokens-'));
  /* the fixture derives every literal from the file under test, so a palette change cannot
     silently turn these negative tests into no-ops */
  const lit = (name) => {
    const m = new RegExp('--' + name + ':\\s+(#[0-9A-Fa-f]{3,8});').exec(tokensCss);
    assert.ok(m, 'tokens.css has a literal --' + name);
    return m[0];
  };
  try {
    fs.copyFileSync(path.join(DESIGN, 'design-system.json'), path.join(dir, 'design-system.json'));
    fs.writeFileSync(path.join(dir, 'tokens.css'), tokensCss.replace(lit('accent'), '--accent: #FF9501;'));
    assert.ok(lib.checkDesign(dir).some((p) => /night: --accent tokens\.css=#FF9501/.test(p)), 'changed value');
    /* a token that the spec documents but the css no longer has */
    fs.writeFileSync(path.join(dir, 'tokens.css'), tokensCss.replace(/\n\s*--ink-3:[^\n]*\n/, '\n'));
    assert.ok(lib.checkDesign(dir).some((p) => /--ink-3 is in design-system\.json but not in tokens\.css/.test(p)), 'removed token');
    fs.writeFileSync(path.join(dir, 'tokens.css'), tokensCss.replace(lit('ink-2'), '--ink-2: #3A372E;'));
    assert.ok(lib.checkDesign(dir).some((p) => /contrast .* < 4\.5/.test(p)), 'low contrast');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('manifest: one design (apc-minimal) whose tokens / spec / examples exist', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'design_library', 'manifest.json'), 'utf8'));
  assert.equal(m.version, '2.0.0');
  assert.equal(m.totalDesigns, 1);
  assert.equal(m.designs.length, 1);
  const d = m.designs[0];
  assert.equal(d.id, 'apc-minimal');
  assert.equal(d.name, 'APC Minimal');
  assert.equal(d.tokens, 'tokens.css');
  assert.equal(d.spec, 'design-system.json');
  assert.deepEqual(d.supports, { visage: false, webview: true });
  for (const f of [d.tokens, d.spec, ...d.examples.webview]) assert.ok(fs.existsSync(path.join(ROOT, 'design_library', d.path, f)), f);
  assert.deepEqual(d.colors, { primary: '#FB543D', accent: '#5BC7D2', background: '#122935' });
  assert.equal(d.colors.primary.toLowerCase(), modes.night['--accent'].toLowerCase());
});

test('the removed designs are gone from design_library', () => {
  for (const id of ['rams60', 'amber-signal', 'neogrid-minimal']) assert.ok(!fs.existsSync(path.join(ROOT, 'design_library', id)), id);
});

test('preview.html is self-contained: loads tokens.css, no network references', () => {
  const html = fs.readFileSync(path.join(DESIGN, 'preview.html'), 'utf8');
  assert.match(html, /<(?:link|script)[^>]+(?:href|src)="[^"]*tokens\.css"/);
  const urls = Array.from(html.matchAll(/\b(?:src|href)="([^"]*)"/g), (m) => m[1]);
  assert.ok(urls.every((u) => !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(u)), 'only relative references: ' + urls.join(', '));
});

// ─── element spec: design-system.json "elements" / "groups" / "tokenGroups" / "fontsets" / "scales" ───────────────
const KIT_DIR = path.join(ROOT, 'templates', 'webview', 'apc-ui');
const registered = lib.kitRegistrations(KIT_DIR);
const tokenNames = Object.keys(modes.night);

test('element spec: every APC.register("name") of the kit has an entry (explicit exceptions only), and every entry is registered or a documented overlay', () => {
  assert.ok(Object.keys(registered).length >= 40, 'sanity: the kit registers its components (' + Object.keys(registered).length + ')');
  for (const n of ['knob', 'slider', 'selector', 'toggle', 'button', 'buttons', 'segmented', 'checkbox', 'radio', 'dropdown', 'menu', 'tabs', 'textfield', 'numberfield', 'label', 'readout',
    'panel', 'divider', 'led', 'progress', 'list', 'logo', 'graph', 'envelope', 'spectrum', 'waveform', 'scope', 'meter', 'stepseq', 'xypad', 'picture',
    'header', 'footer', 'scale', 'gripper', 'theme-switch', 'infobar', 'help-button', 'presets', 'preset-chip', 'settings', 'license', 'update']) {
    assert.ok(n in registered, n + ' is registered');
    assert.ok(n in spec.elements, n + ' has a spec entry');
  }
  assert.deepEqual(lib.ELEMENT_EXCEPTIONS, [], 'no component is exempt from the spec');
  assert.deepEqual(lib.PSEUDO_ELEMENTS, ['context-panel', 'tooltip', 'toast']);
  for (const n of lib.PSEUDO_ELEMENTS) assert.ok(n in spec.elements && !(n in registered), n + ' is a documented overlay entry');
  assert.deepEqual(lib.checkElements(spec, tokenNames, registered), []);
});

test('element spec: every token referenced by an element exists in tokens.css', () => {
  const used = new Set();
  const visit = (v) => { for (const t of lib.tokensIn(v)) used.add(t); };
  for (const e of Object.values(spec.elements)) {
    for (const props of Object.values(e.parts)) Object.values(props).forEach(visit);
    for (const map of Object.values(e.states)) Object.values(map).forEach(visit);
    visit(e.sizes.default);
  }
  assert.ok(used.size >= 40, 'the spec really uses tokens: ' + used.size);
  assert.deepEqual(Array.from(used).filter((t) => !tokenNames.includes(t)), []);
  for (const t of used) assert.ok(t in modes.day, t + ' is defined in day mode');
});

test('element spec: schema validity (required keys, known group, known states, state keys point to existing parts/properties)', () => {
  assert.deepEqual(spec.groups, ['Rotary & linear', 'Buttons & switches', 'Selection', 'Text & numbers', 'Containers', 'Display', 'Visualisation', 'Chrome', 'Overlays']);
  assert.deepEqual(spec.stateNames, lib.STATE_NAMES);
  for (const [n, e] of Object.entries(spec.elements)) {
    assert.deepEqual(Object.keys(e).sort(), ['a11y', 'group', 'options', 'parts', 'sizes', 'states', 'summary', 'title'], n + ': exactly the documented keys');
    assert.ok(spec.groups.includes(e.group), n + ': group');
    assert.ok(e.summary.length > 20 && e.summary.length < 320, n + ': one-sentence summary');
    assert.ok(Array.isArray(e.sizes.overridable), n + ': sizes.overridable');
    assert.ok(typeof e.a11y.role === 'string' && typeof e.a11y.keys === 'string');
    for (const st of Object.keys(e.states)) assert.ok(lib.STATE_NAMES.includes(st), n + ': state ' + st);
  }
  for (const g of spec.groups) assert.ok(Object.values(spec.elements).some((e) => e.group === g), 'group ' + g + ' is not empty');
  // the checker really rejects broken specs
  const clone = () => JSON.parse(JSON.stringify(spec));
  let bad = clone(); bad.elements.knob.parts.arc.stroke = '--no-such-token';
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /knob.*--no-such-token/.test(p)), 'unknown token');
  bad = clone(); bad.elements.knob.group = 'Nope';
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /group "Nope"/.test(p)), 'unknown group');
  bad = clone(); bad.elements.knob.states.pressed = { 'dial.border': '--accent' };
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /unknown state "pressed"/.test(p)), 'unknown state');
  bad = clone(); bad.elements.knob.states.hover = { 'nothing.border': '--accent' };
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /no such part/.test(p)), 'state points to a missing part');
  bad = clone(); delete bad.elements.meter;
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /APC\.register\("meter"\).*no entry/.test(p)), 'registered element without an entry');
  bad = clone(); bad.elements.ghost = bad.elements.knob;
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /elements\.ghost is not an APC\.register name/.test(p)), 'entry for an unknown element');
  bad = clone(); delete bad.elements.knob.a11y;
  assert.ok(lib.checkElements(bad, tokenNames, registered).some((p) => /knob: a11y/.test(p)), 'a11y required');
});

test('element spec: facts read from the real CSS (spot checks)', () => {
  const el = spec.elements;
  assert.equal(el.knob.parts.arc.stroke, '--accent');
  assert.equal(el.knob.parts.arc.width, '2px', 'the plate draws the value arc 2px wide');
  assert.equal(el.knob.parts.track.stroke, '--rule-2', 'the track is the quiet guide, not a ring');
  assert.equal(el.knob.parts.pointer.fill, '--ink');
  assert.equal(el.knob.sizes.default, '--knob-size');
  assert.deepEqual(el.knob.sizes.overridable, ['data-size', '--knob-size']);
  assert.equal(el.button.parts.body.fill, '--plate-3', 'controls sit on the raised control body');
  assert.match(el.button.parts.body.border, /--rule-2/, 'the default edge is the structural one');
  assert.equal(el.radio.parts.box.radius, '--r-radio', 'a radio uses the same square mark as a checkbox');
  assert.equal(el.led.parts.lamp.radius, '--r-led', 'the lamp is a square chip, not a dot');
  assert.equal(el.logo.parts.image.height, '--apc-logo-h');
  assert.equal(el.graph.parts.node.size, '--apc-viz-node');
  assert.equal(el.tooltip.parts.value.color, '--accent-text');
  assert.equal(el.footer.parts.badge.color, '--accent-text');
  assert.equal(el.meter.parts['zone-clip'].fill, '--meter-clip');
  assert.equal(el.stepseq.parts['step-on'].fill, '--step-on');
  assert.equal(el.checkbox.states.checked['mark.fill'], '--accent');
  assert.equal(el.toggle.states.checked['track.fill'], '--accent', 'on = the track fills with the signal colour');
  // a text colour in a spec is never plain --accent (that is --accent-text)
  for (const [n, e] of Object.entries(el)) {
    const texts = Object.entries(e.parts).flatMap(([p, props]) => Object.entries(props).filter(([k]) => k === 'color').map(([k, v]) => [p + '.' + k, v]))
      .concat(Object.entries(e.states).flatMap(([s, map]) => Object.entries(map).filter(([k]) => /\.color$/.test(k)).map(([k, v]) => [s + ':' + k, v])));
    for (const [k, v] of texts) assert.ok(v !== '--accent', n + ' ' + k + ': accent-coloured text must be --accent-text');
  }
});

test('tokenGroups: every tokens.css token is in exactly one group, with a kind and a description', () => {
  assert.deepEqual(lib.checkTokenGroups(spec, tokenNames), []);
  const all = spec.tokenGroups.flatMap((g) => g.tokens);
  assert.equal(all.length, tokenNames.length);
  assert.deepEqual(all.slice().sort(), tokenNames.slice().sort());
  assert.deepEqual(Array.from(new Set(spec.tokenGroups.map((g) => g.kind))).sort(), ['color', 'font', 'length', 'number']);
  // kind matches the value: colour groups hold colours (hex, rgba or var()), font groups font stacks, number groups plain numbers
  for (const g of spec.tokenGroups) {
    for (const t of g.tokens) {
      const v = modes.night[t];
      if (g.kind === 'color') assert.match(v, /^(#[0-9a-fA-F]{3,8}|rgba?\(|var\(--)/, g.id + ' ' + t);
      if (g.kind === 'font') assert.match(v, /,/, g.id + ' ' + t);
      if (g.kind === 'number') assert.match(v, /^[0-9.]+$/, g.id + ' ' + t);
    }
  }
  const bad = JSON.parse(JSON.stringify(spec));
  bad.tokenGroups[0].tokens.pop();
  assert.ok(lib.checkTokenGroups(bad, tokenNames).some((p) => /is in no group/.test(p)), 'a missing token is detected');
  bad.tokenGroups[1].tokens.push(bad.tokenGroups[2].tokens[0]);
  assert.ok(lib.checkTokenGroups(bad, tokenNames).some((p) => /is in 2 groups/.test(p)), 'a duplicate token is detected');
});

test('fontsets: system-safe stacks only (no web fonts, no urls), generic fallback at the end, defaults documented', () => {
  for (const kind of ['ui', 'text']) {
    assert.ok(spec.fontsets[kind].length >= 3, kind + ' offers alternatives');
    for (const f of spec.fontsets[kind]) {
      assert.ok(f.id && f.label && f.value && f.note, f.id);
      assert.ok(!/url\(|@import|https?:|\/\//i.test(f.value), f.id + ': no network font');
      assert.match(f.value.split(',').pop().trim(), /^(monospace|sans-serif|serif)$/, f.id + ': ends in a generic family');
    }
  }
  assert.equal(spec.fontsets.ui[0].value, modes.night['--font-ui'], 'first ui set = the default token');
  assert.equal(spec.fontsets.text[0].value, modes.night['--font-text'], 'first text set = the default token');
  assert.match(spec.fontsets.note, /never load a network font/i);
});

test('scales: --t-* ladder matches tokens.css, strictly increasing rem part, non-decreasing px floors', () => {
  const rows = spec.scales.tokens;
  assert.deepEqual(rows.map((r) => r.token), ['--t-micro', '--t-label', '--t-value', '--t-readout', '--t-title', '--t-head']);
  let prevRem = 0; let prevFloor = 0;
  for (const r of rows) {
    assert.equal(r.value, modes.night[r.token], r.token + ' value == tokens.css');
    const m = r.value.match(/^max\((\d+)px, ([\d.]+)rem\)$/);
    assert.ok(m, r.token + ' is max(<px>, <rem>)');
    assert.equal(Number(m[1]), r.floorPx);
    assert.equal(m[2] + 'rem', r.rem);
    assert.ok(Number(m[2]) > prevRem, r.token + ' rem part increases');
    assert.ok(r.floorPx >= prevFloor, r.token + ' floor does not decrease');
    assert.ok(r.floorPx >= 9, r.token + ' floor >= 9px');
    prevRem = Number(m[2]); prevFloor = r.floorPx;
  }
  assert.ok(spec.scales.rules.length >= 3 && /rem/.test(spec.scales.note) && /floor/.test(spec.scales.note));
});
