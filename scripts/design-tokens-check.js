#!/usr/bin/env node
'use strict';
/**
 * Design token drift + contrast check (zero dependencies).
 *
 *   node scripts/design-tokens-check.js [design_library/<id>]      (default: design_library/apc-minimal)
 *
 * A design is a folder with
 *   tokens.css         the canonical token contract: a `:root, [data-theme="night"] { --x: v; }` block
 *                      plus a `[data-theme="day"] { ... }` block overriding some of the same names
 *   design-system.json documentation of the same values (`tokens.night` / `tokens.day` flat maps) and the
 *                      WCAG pairs it promises (`contrast.pairs`)
 * This script fails when the two disagree (a custom property missing, extra or with another value) or when
 * a documented contrast pair is below its minimum or its documented ratio is stale. Exit code 0 = clean.
 * It also validates the ELEMENT SPEC (design-system.json "elements", "groups", "tokenGroups"):
 *   - every token an element references (parts / states / sizes.default) exists in tokens.css
 *   - every APC.register("name") of the kit has an entry (explicit exceptions: ELEMENT_EXCEPTIONS); every entry is registered
 *     or one of PSEUDO_ELEMENTS (context-panel, tooltip, toast: styled by the kit but not data-apc elements)
 *   - each element has the required keys, a known group and only known state names
 *   - tokenGroups cover every tokens.css token exactly once and carry a description for each
 * Also used by test/design-tokens.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');

/** Custom properties of one `{ ... }` block as an ordered map name -> value (comments stripped, whitespace folded). */
function parseDecls(body) {
  const out = {};
  for (const d of body.split(';')) {
    const m = d.match(/^\s*(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/\s+/g, ' ');
  }
  return out;
}
function stripComments(css) { return String(css).replace(/\/\*[\s\S]*?\*\//g, ''); }

/** { night: {...}, day: {...overrides only} } from a tokens.css text. */
function parseTokensCss(css) {
  const clean = stripComments(css);
  const night = clean.match(/(?:^|\})\s*:root\s*,\s*\[data-theme=["']night["']\]\s*\{([^{}]*)\}/);
  const day = clean.match(/(?:^|\})\s*\[data-theme=["']day["']\]\s*\{([^{}]*)\}/);
  return { night: night ? parseDecls(night[1]) : {}, day: day ? parseDecls(day[1]) : {} };
}
/** Custom properties of the first `:root { ... }` block (apc-core.css defaults). */
function parseRootDefaults(css) {
  const m = stripComments(css).match(/(?:^|\})\s*:root\s*\{([^{}]*)\}/);
  return m ? parseDecls(m[1]) : {};
}
/** Resolved maps: night as declared, day = night overlaid with the day overrides. */
function resolveModes(parsed) {
  return { night: { ...parsed.night }, day: { ...parsed.night, ...parsed.day } };
}

// ─── colour maths (WCAG 2.x) ────────────────────────────────────────────────
function resolveVar(value, map, depth = 0) {
  const m = String(value).trim().match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (!m || depth > 8) return String(value).trim();
  return map[m[1]] === undefined ? String(value).trim() : resolveVar(map[m[1]], map, depth + 1);
}
function parseHex(v) {
  const m = String(v).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(rgb) {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function ratio(fg, bg) {
  const a = luminance(fg); const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Contrast of two token names within one resolved mode map; null when a value is not a solid #hex colour. */
function tokenRatio(map, fgName, bgName) {
  const fg = parseHex(resolveVar(map[fgName], map));
  const bg = parseHex(resolveVar(map[bgName], map));
  return fg && bg ? ratio(fg, bg) : null;
}

// element spec ---------------------------------------------------------------
const STATE_NAMES = ['default', 'hover', 'active', 'focus', 'disabled', 'selected', 'error', 'checked', 'open'];
const TOKEN_KINDS = ['color', 'length', 'font', 'number'];
/** kit components that are deliberately NOT in the element spec (none today) */
const ELEMENT_EXCEPTIONS = [];
/** spec entries that are not APC.register names: overlays the kit draws itself (not data-apc elements) */
const PSEUDO_ELEMENTS = ['context-panel', 'tooltip', 'toast'];

/** Names registered with APC.register("name", ...) in the *.js files of a kit folder -> { name: file }. */
function kitRegistrations(kitDir) {
  const out = {};
  if (!fs.existsSync(kitDir)) return out;
  for (const f of fs.readdirSync(kitDir).filter((n) => /\.js$/.test(n)).sort()) {
    const text = fs.readFileSync(path.join(kitDir, f), 'utf8');
    for (const m of text.matchAll(/APC\.register\(\s*["']([^"']+)["']/g)) out[m[1]] = f;
  }
  return out;
}
/** Custom-property names mentioned in a spec value ("--stroke solid --rule", "--viz-1 .. --viz-4"). */
function tokensIn(value) { return Array.from(String(value).matchAll(/--[a-z][a-z0-9-]*/g), (m) => m[0]); }

/** Validate spec.elements / spec.groups against the token set and the registered components. */
function checkElements(spec, tokenNames, registered) {
  const problems = [];
  const names = new Set(tokenNames);
  const groups = Array.isArray(spec.groups) ? spec.groups : [];
  if (!groups.length) problems.push('design-system.json: groups missing');
  const els = spec.elements;
  if (!els || typeof els !== 'object' || Array.isArray(els) || !Object.keys(els).length) return problems.concat('design-system.json: elements missing');
  const bad = (n, m) => problems.push('elements.' + n + ': ' + m);
  for (const [n, e] of Object.entries(els)) {
    if (!e || typeof e !== 'object') { bad(n, 'not an object'); continue; }
    for (const k of ['title', 'summary']) if (typeof e[k] !== 'string' || !e[k].trim()) bad(n, k + ' missing');
    if (!groups.includes(e.group)) bad(n, 'group "' + e.group + '" is not in groups');
    if (!e.parts || typeof e.parts !== 'object' || !Object.keys(e.parts).length) bad(n, 'parts missing');
    for (const [part, props] of Object.entries(e.parts || {})) {
      if (!props || typeof props !== 'object' || !Object.keys(props).length) { bad(n, 'part "' + part + '" has no properties'); continue; }
      for (const [label, v] of Object.entries(props)) {
        if (typeof v !== 'string' || !v.trim()) { bad(n, 'parts.' + part + '.' + label + ' must be a non-empty string'); continue; }
        for (const t of tokensIn(v)) if (!names.has(t)) bad(n, 'parts.' + part + '.' + label + ' references ' + t + ' which tokens.css does not define');
      }
    }
    if (!e.states || typeof e.states !== 'object' || Array.isArray(e.states)) bad(n, 'states must be an object (may be empty)');
    for (const [state, map] of Object.entries(e.states || {})) {
      if (!STATE_NAMES.includes(state)) bad(n, 'unknown state "' + state + '" (allowed: ' + STATE_NAMES.join(', ') + ')');
      if (!map || typeof map !== 'object' || !Object.keys(map).length) { bad(n, 'state "' + state + '" is empty'); continue; }
      for (const [key, v] of Object.entries(map)) {
        const m = key.match(/^([^.]+)\.(.+)$/);
        if (!m) { bad(n, 'states.' + state + ' key "' + key + '" must be "<part>.<property label>"'); continue; }
        if (!e.parts || !e.parts[m[1]]) bad(n, 'states.' + state + '.' + key + ': no such part');
        else if (!(m[2] in e.parts[m[1]])) bad(n, 'states.' + state + '.' + key + ': the part has no property "' + m[2] + '" in the default state');
        if (typeof v !== 'string' || !v.trim()) { bad(n, 'states.' + state + '.' + key + ' must be a non-empty string'); continue; }
        for (const t of tokensIn(v)) if (!names.has(t)) bad(n, 'states.' + state + '.' + key + ' references ' + t + ' which tokens.css does not define');
      }
    }
    const sz = e.sizes;
    if (!sz || typeof sz.default !== 'string' || !sz.default.trim() || !Array.isArray(sz.overridable)) bad(n, 'sizes needs {default: string, overridable: []}');
    else for (const t of tokensIn(sz.default)) if (!names.has(t)) bad(n, 'sizes.default references ' + t + ' which tokens.css does not define');
    if (!Array.isArray(e.options) || e.options.some((o) => typeof o !== 'string' || !o)) bad(n, 'options must be an array of strings');
    if (!e.a11y || typeof e.a11y.role !== 'string' || typeof e.a11y.keys !== 'string' || !e.a11y.role || !e.a11y.keys) bad(n, 'a11y needs {role, keys}');
  }
  if (registered) {
    for (const name of Object.keys(registered)) {
      if (!(name in els) && !ELEMENT_EXCEPTIONS.includes(name)) problems.push('APC.register("' + name + '") in ' + registered[name] + ' has no entry in design-system.json elements');
    }
    for (const n of Object.keys(els)) {
      if (!(n in registered) && !PSEUDO_ELEMENTS.includes(n)) problems.push('elements.' + n + ' is not an APC.register name and not a documented pseudo element');
    }
  }
  return problems;
}

/** tokenGroups must cover every token of tokens.css exactly once, with a valid kind and a description per token. */
function checkTokenGroups(spec, tokenNames) {
  const problems = [];
  const gs = spec.tokenGroups;
  if (!Array.isArray(gs) || !gs.length) return ['design-system.json: tokenGroups missing'];
  const seen = {};
  const ids = new Set();
  for (const g of gs) {
    if (!g || typeof g.id !== 'string' || !g.id) { problems.push('tokenGroups: a group has no id'); continue; }
    if (ids.has(g.id)) problems.push('tokenGroups: duplicate id ' + g.id);
    ids.add(g.id);
    if (typeof g.title !== 'string' || !g.title) problems.push('tokenGroups.' + g.id + ': title missing');
    if (!TOKEN_KINDS.includes(g.kind)) problems.push('tokenGroups.' + g.id + ': kind "' + g.kind + '" is not one of ' + TOKEN_KINDS.join('|'));
    if (!Array.isArray(g.tokens) || !g.tokens.length) { problems.push('tokenGroups.' + g.id + ': tokens missing'); continue; }
    for (const t of g.tokens) {
      seen[t] = (seen[t] || 0) + 1;
      if (!g.descriptions || typeof g.descriptions[t] !== 'string' || g.descriptions[t].length < 8) problems.push('tokenGroups.' + g.id + ': no description for ' + t);
    }
    for (const t of Object.keys(g.descriptions || {})) if (!g.tokens.includes(t)) problems.push('tokenGroups.' + g.id + ': description for ' + t + ' which is not in the group');
  }
  for (const t of tokenNames) if (!seen[t]) problems.push('tokenGroups: ' + t + ' (in tokens.css) is in no group');
  for (const [t, c] of Object.entries(seen)) {
    if (c > 1) problems.push('tokenGroups: ' + t + ' is in ' + c + ' groups');
    if (!tokenNames.includes(t)) problems.push('tokenGroups: ' + t + ' is not in tokens.css');
  }
  return problems;
}

/** Compare tokens.css with design-system.json; returns an array of problem strings (empty = clean). */
function checkDesign(dir) {
  const problems = [];
  const tokensFile = path.join(dir, 'tokens.css');
  const specFile = path.join(dir, 'design-system.json');
  if (!fs.existsSync(tokensFile)) return ['[NOT FOUND] ' + tokensFile];
  if (!fs.existsSync(specFile)) return ['[NOT FOUND] ' + specFile];
  const parsed = parseTokensCss(fs.readFileSync(tokensFile, 'utf8'));
  const modes = resolveModes(parsed);
  let spec;
  try { spec = JSON.parse(fs.readFileSync(specFile, 'utf8')); } catch (e) { return ['design-system.json: ' + e.message]; }
  if (!Object.keys(parsed.night).length) problems.push('tokens.css: no `:root, [data-theme="night"]` block with custom properties');
  for (const day of Object.keys(parsed.day)) {
    if (!(day in parsed.night)) problems.push('tokens.css: [data-theme="day"] overrides ' + day + ' which night does not define');
  }
  for (const mode of ['night', 'day']) {
    const doc = spec.tokens && spec.tokens[mode];
    if (!doc || typeof doc !== 'object') { problems.push('design-system.json: tokens.' + mode + ' missing'); continue; }
    for (const [name, value] of Object.entries(modes[mode])) {
      if (!(name in doc)) problems.push(mode + ': ' + name + ' is in tokens.css but not in design-system.json');
      else if (String(doc[name]).replace(/\s+/g, ' ') !== value) problems.push(mode + ': ' + name + ' tokens.css=' + value + ' design-system.json=' + doc[name]);
    }
    for (const name of Object.keys(doc)) if (!(name in modes[mode])) problems.push(mode + ': ' + name + ' is in design-system.json but not in tokens.css');
  }
  const pairs = (spec.contrast && spec.contrast.pairs) || [];
  if (!pairs.length) problems.push('design-system.json: contrast.pairs missing');
  for (const p of pairs) {
    const label = p.mode + ' ' + p.fg + ' on ' + p.bg;
    const map = modes[p.mode];
    if (!map) { problems.push(label + ': unknown mode'); continue; }
    const r = tokenRatio(map, p.fg, p.bg);
    const min = p.kind === 'text' ? 4.5 : 3;
    if (r === null) { problems.push(label + ': not resolvable to two solid #hex colours'); continue; }
    if (p.min !== min) problems.push(label + ': min must be ' + min + ' for kind ' + p.kind);
    /* A pair can be knowingly below its minimum, but only with a written reason in the spec:
       the ratio is still verified, so a waiver cannot hide a stale number. */
    if (r < min && !p.waiver) problems.push(label + ': contrast ' + r.toFixed(2) + ' < ' + min);
    if (Math.abs(r - p.ratio) > 0.011) problems.push(label + ': documented ratio ' + p.ratio + ' is stale (now ' + r.toFixed(2) + ')');
  }
  // element spec: runs for designs that ship one; the registered-components check needs the kit folder next to design_library
  if (spec.elements) {
    const tokenNames = Object.keys(modes.night);
    const kitDir = path.resolve(dir, '..', '..', 'templates', 'webview', 'apc-ui');
    problems.push(...checkElements(spec, tokenNames, fs.existsSync(kitDir) ? kitRegistrations(kitDir) : null));
    problems.push(...checkTokenGroups(spec, tokenNames));
  }
  return problems;
}

module.exports = {
  parseTokensCss, parseRootDefaults, resolveModes, resolveVar, parseHex, luminance, ratio, tokenRatio, checkDesign,
  checkElements, checkTokenGroups, kitRegistrations, tokensIn, STATE_NAMES, TOKEN_KINDS, ELEMENT_EXCEPTIONS, PSEUDO_ELEMENTS,
};

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'design_library', 'apc-minimal'));
  const problems = checkDesign(dir);
  if (problems.length) {
    for (const p of problems) console.error('[FAIL] ' + p);
    process.exit(1);
  }
  console.log('[OK] ' + path.relative(process.cwd(), dir) + ': tokens.css and design-system.json agree; all documented contrast pairs are met');
}
