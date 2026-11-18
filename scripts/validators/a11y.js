'use strict';
/**
 * a11y + perf-budget validator  (`apc validate a11y --plugin <Name>`)
 *
 *   validate(pluginDir, opts) -> { checks: [{ check, status, message }] }
 *   status: 'pass' | 'fail' | 'warn' | 'info'
 *
 * Static analysis only - zero dependencies, Node 18+. Nothing is executed or
 * rendered; the plugin's UI source is parsed with small purpose-built parsers.
 * See .agents/guides/a11y-perf.md for the rule set, thresholds and heuristics.
 *
 * opts: { args?: string[], root?: string, html?: string }
 *   --html <file>   analyse this HTML file (relative to the plugin dir) instead
 *                   of auto-detecting the UI entry document
 *
 * Plugin inputs read: status.json (ui_framework, optional perf_budget),
 * Source/ui/** and Design/** (html/css/js), Source/** C++ (timer rates), and
 * Design/ui-map.json tokens (Visage contrast).
 */

const fs = require('fs');
const path = require('path');

// ─── thresholds (documented in .agents/guides/a11y-perf.md) ─────────────────
const LIMITS = {
  textContrast: 4.5,        // WCAG 2.1 SC 1.4.3
  largeTextContrast: 3,     // large text (>= 24px, or >= 18.66px bold)
  nonTextContrast: 3,       // WCAG 2.1 SC 1.4.11
  maxMeterHz: 60,
  defaultWebviewMb: 120,
  maxAnimatedElements: 12,
  maxBackdropFilters: 2,
  largeShadowBlurPx: 24,
  maxLargeShadows: 4,
};

// ─── colour maths ───────────────────────────────────────────────────────────
const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], lime: [0, 255, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255],
  fuchsia: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  orange: [255, 165, 0], green: [0, 128, 0], navy: [0, 0, 128], maroon: [128, 0, 0],
  purple: [128, 0, 128], teal: [0, 128, 128], olive: [128, 128, 0],
};

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function parseChannel(tok) {
  const t = tok.trim();
  if (t.endsWith('%')) return clamp(parseFloat(t) * 2.55, 0, 255);
  return clamp(parseFloat(t), 0, 255);
}
function parseAlpha(tok) {
  if (tok === undefined) return 1;
  const t = tok.trim();
  const n = t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parse a CSS colour literal -> {r,g,b,a} (0-255, a 0-1) or null. */
function parseColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/\s*!important$/, '');
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  m = s.match(/^rgba?\(\s*([^)]*)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map(parseChannel);
    if (ch.some((n) => !Number.isFinite(n))) return null;
    return { r: ch[0], g: ch[1], b: ch[2], a: parseAlpha(parts[3]) };
  }
  m = s.match(/^hsla?\(\s*([^)]*)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const lig = parseFloat(parts[2]) / 100;
    if (![h, sat, lig].every(Number.isFinite)) return null;
    const [r, g, b] = hslToRgb(h, clamp(sat, 0, 1), clamp(lig, 0, 1));
    return { r, g, b, a: parseAlpha(parts[3]) };
  }
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) {
    const [r, g, b] = NAMED[s];
    return { r, g, b, a: 1 };
  }
  return null;
}

function channelLin(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(c) {
  return 0.2126 * channelLin(c.r) + 0.7152 * channelLin(c.g) + 0.0722 * channelLin(c.b);
}
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Composite a (possibly translucent) colour over an opaque background. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  };
}
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
const colorHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b);

// ─── CSS parsing ────────────────────────────────────────────────────────────
function matchBrace(css, open, limit) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < limit; i++) {
    const ch = css[i];
    if (quote) { if (ch === quote && css[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return limit;
}
function splitTop(str, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) { cur += ch; if (ch === quote && str[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parseDecls(body) {
  let flat = body;
  // drop nested blocks (CSS nesting) - not analysed
  for (let guard = 0; guard < 50; guard++) {
    const o = flat.indexOf('{');
    if (o === -1) break;
    flat = flat.slice(0, o) + flat.slice(matchBrace(flat, o, flat.length) + 1);
  }
  const decls = {};
  for (const part of splitTop(flat, ';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    let prop = part.slice(0, i).trim();
    if (!prop.startsWith('--')) prop = prop.toLowerCase();
    const val = part.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (prop) decls[prop] = val;
  }
  return decls;
}
/** Minimal CSS parser: style rules (with at-rule context), keyframes, no nesting. */
function parseCss(src) {
  const css = String(src).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const keyframes = [];
  function walk(from, to, ctx) {
    let i = from;
    while (i < to) {
      let j = i;
      let quote = null;
      while (j < to) {
        const ch = css[j];
        if (quote) { if (ch === quote && css[j - 1] !== '\\') quote = null; j++; continue; }
        if (ch === '"' || ch === "'") { quote = ch; j++; continue; }
        if (ch === '{' || ch === ';') break;
        j++;
      }
      if (j >= to) break;
      if (css[j] === ';') { i = j + 1; continue; }
      const prelude = css.slice(i, j).trim();
      const end = matchBrace(css, j, to);
      if (/^@(media|supports|layer|container|document)\b/i.test(prelude)) walk(j + 1, end, ctx.concat(prelude));
      else if (/^@(-\w+-)?keyframes\b/i.test(prelude)) keyframes.push(prelude.replace(/^@(-\w+-)?keyframes\s*/i, '').trim());
      else if (!prelude.startsWith('@') && prelude) rules.push({ selector: prelude, decls: parseDecls(css.slice(j + 1, end)), ctx });
      i = end + 1;
    }
  }
  walk(0, css.length, []);
  return { rules, keyframes };
}

const ROOT_SEL = /^(?::root|html|body|\*|\.apc-plate|\.plate|#app|#root|main)(?![\w-])/i;
const THEME_NAME_RES = [
  /\[data-(?:apc-)?(?:theme|mode|skin)\s*[~|^$*]?=\s*["']?([\w-]+)["']?\s*\]/i,
  /\.(?:apc-)?theme[-_]([\w]+)/i,
  /\.(night|day|dark|light)(?![\w-])/i,
  /\[class[~*^]?=["']?([\w-]*(?:night|day|dark|light)[\w-]*)["']?\]/i,
];
function themeOfPart(part, ctx) {
  for (const re of THEME_NAME_RES) {
    const m = part.match(re);
    if (m) return m[1].toLowerCase();
  }
  for (const c of ctx || []) {
    const m = c.match(/prefers-color-scheme\s*:\s*(dark|light)/i);
    if (m) return 'media-' + m[1].toLowerCase();
  }
  return null;
}
function rootish(part) {
  const t = part.trim().replace(/\[[^\]]*\]|\.[\w-]*(?:night|day|dark|light|theme)[\w-]*/gi, '').trim();
  return t === '' || ROOT_SEL.test(t);
}

/** Flatten rules into per-selector-part entries with theme tagging. */
function expandRules(parsed) {
  const out = [];
  for (const r of parsed.rules) {
    for (const part of splitTop(r.selector, ',')) {
      const sel = part.trim();
      if (!sel) continue;
      out.push({ selector: sel, decls: r.decls, ctx: r.ctx, theme: themeOfPart(sel, r.ctx), root: rootish(sel) });
    }
  }
  return out;
}

function varMaps(entries) {
  const base = {};
  const baseOther = {};
  const overlay = {};
  const themes = new Set();
  for (const e of entries) {
    const customs = Object.entries(e.decls).filter(([p]) => p.startsWith('--'));
    if (e.theme) themes.add(e.theme);
    if (!customs.length) continue;
    if (e.theme) {
      overlay[e.theme] = overlay[e.theme] || {};
      for (const [p, v] of customs) overlay[e.theme][p] = v;
    } else if (e.root) {
      for (const [p, v] of customs) base[p] = v;
    } else {
      for (const [p, v] of customs) baseOther[p] = v;
    }
  }
  return { base: { ...baseOther, ...base }, overlay, themes: Array.from(themes) };
}

/** Resolve a CSS colour value (literal, var() chain, simple fallback) -> {r,g,b,a} | null. */
function resolveColor(raw, vars, depth = 0) {
  if (typeof raw !== 'string' || depth > 8) return null;
  const v = raw.trim();
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/);
  if (m) {
    if (Object.prototype.hasOwnProperty.call(vars, m[1])) {
      const r = resolveColor(vars[m[1]], vars, depth + 1);
      if (r) return r;
    }
    return m[2] !== undefined ? resolveColor(m[2], vars, depth + 1) : null;
  }
  if (/^(inherit|initial|unset|currentcolor|revert)$/i.test(v)) return null;
  return parseColor(v);
}

/** First colour-like token inside a shorthand (background / border / outline). */
function colorFromShorthand(value) {
  if (typeof value !== 'string') return null;
  if (/gradient\(|url\(/i.test(value)) return null;
  const toks = splitTop(value.replace(/\s+/g, ' '), ' ');
  for (const t of toks) {
    if (/^(var\(|#|rgb|hsl)/i.test(t) || Object.prototype.hasOwnProperty.call(NAMED, t.toLowerCase()) || t.toLowerCase() === 'transparent') return t;
  }
  return null;
}
function bgOf(decls) {
  if (decls['background-color']) return decls['background-color'];
  if (decls.background) return colorFromShorthand(decls.background);
  return null;
}

// ─── HTML parsing ───────────────────────────────────────────────────────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_RE = /<!--[\s\S]*?-->|<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>|<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(str) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str))) {
    const name = m[1].toLowerCase();
    if (name === '/') continue;
    attrs[name] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  }
  return attrs;
}
const decodeEnt = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function parseHtml(src) {
  const elements = [];
  const styles = [];
  const scripts = [];
  const stack = [];
  let last = 0;
  let m;
  const addText = (txt) => {
    const t = decodeEnt(txt).replace(/\s+/g, ' ');
    if (!t.trim()) return;
    for (const el of stack) el.text += t;
  };
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    addText(src.slice(last, m.index));
    last = TAG_RE.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const attrs = parseAttrs(m[2] || '');
      const el = { tag: m[1].toLowerCase(), attrs, text: '', parent: stack[stack.length - 1] || null, inTemplate: stack.some((s) => s.tag === 'template') };
      elements.push(el);
      if (el.tag === 'style') styles.push(m[3]);
      else scripts.push({ src: attrs.src || null, code: m[3] });
      continue;
    }
    const closing = !!m[4];
    const tag = m[5].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = parseAttrs(m[6] || '');
    const el = { tag, attrs, text: '', parent: stack[stack.length - 1] || null, inTemplate: stack.some((s) => s.tag === 'template') };
    elements.push(el);
    if (tag === 'img' && attrs.alt) addText(' ' + attrs.alt + ' ');
    const selfClosed = /\/\s*$/.test(m[6] || '');
    if (!VOID.has(tag) && !selfClosed) stack.push(el);
  }
  addText(src.slice(last));
  return { elements, styles, scripts };
}

const INTERACTIVE_ROLES = new Set(['button', 'slider', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'spinbutton', 'combobox', 'link', 'option', 'textbox', 'scrollbar', 'searchbox', 'treeitem']);

function isHidden(el) {
  for (let e = el; e; e = e.parent) {
    if (e.attrs.hidden !== undefined || String(e.attrs['aria-hidden']).toLowerCase() === 'true') return true;
    if (e.attrs.type && e.tag === 'input' && e.attrs.type.toLowerCase() === 'hidden') return true;
    if (/display\s*:\s*none/i.test(e.attrs.style || '')) return true;
  }
  return false;
}
function isNativeInteractive(el) {
  const t = el.tag;
  if (t === 'button' || t === 'select' || t === 'textarea' || t === 'summary') return true;
  if (t === 'input') return (el.attrs.type || 'text').toLowerCase() !== 'hidden';
  if (t === 'a') return el.attrs.href !== undefined;
  if ((t === 'audio' || t === 'video') && el.attrs.controls !== undefined) return true;
  return el.attrs.contenteditable !== undefined && el.attrs.contenteditable !== 'false';
}
function isInteractive(el) {
  if (el.inTemplate || isHidden(el)) return false;
  if (isNativeInteractive(el)) return true;
  const role = (el.attrs.role || '').toLowerCase();
  return INTERACTIVE_ROLES.has(role) || el.attrs.onclick !== undefined || el.attrs['data-param'] !== undefined || el.attrs.tabindex !== undefined;
}
function describeEl(el) {
  const bits = ['<' + el.tag];
  if (el.attrs.id) bits.push('#' + el.attrs.id);
  if (el.attrs.class) bits.push('.' + el.attrs.class.trim().split(/\s+/).slice(0, 2).join('.'));
  if (el.attrs['data-param']) bits.push('data-param=' + el.attrs['data-param']);
  if (el.attrs.role) bits.push('role=' + el.attrs.role);
  return bits.join(' ') + '>';
}
function listShort(items, n = 6) {
  return items.slice(0, n).join('; ') + (items.length > n ? ` (+${items.length - n} more)` : '');
}

function accessibleName(el, byId, labelsFor) {
  const aria = (el.attrs['aria-label'] || '').trim();
  if (aria) return 'aria-label';
  const lb = (el.attrs['aria-labelledby'] || '').trim();
  if (lb && lb.split(/\s+/).some((id) => byId[id] && byId[id].text.trim())) return 'aria-labelledby';
  const type = (el.attrs.type || '').toLowerCase();
  if (el.tag === 'input' && ['button', 'submit', 'reset'].includes(type) && (el.attrs.value || '').trim()) return 'value';
  if (el.tag === 'input' && type === 'image' && (el.attrs.alt || '').trim()) return 'alt';
  if (['input', 'select', 'textarea'].includes(el.tag)) {
    if (el.attrs.id && labelsFor[el.attrs.id]) return 'label';
    for (let p = el.parent; p; p = p.parent) if (p.tag === 'label' && p.text.trim()) return 'label';
  } else if (el.text.trim()) {
    return 'text';
  }
  if ((el.attrs.title || '').trim()) return 'title';
  return null;
}

// ─── selector matching (last compound only; approximate by design) ──────────
function compoundOf(selector) {
  const parts = selector.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  let last = parts[parts.length - 1] || '';
  last = last.replace(/::?[\w-]+(\([^)]*\))?/g, '');
  return last;
}
function matchesCompound(el, compound) {
  if (!compound) return false;
  const tag = compound.match(/^[a-zA-Z][\w-]*/);
  if (tag && tag[0].toLowerCase() !== el.tag) return false;
  for (const m of compound.matchAll(/#([\w-]+)/g)) if (el.attrs.id !== m[1]) return false;
  const classes = (el.attrs.class || '').split(/\s+/);
  for (const m of compound.matchAll(/\.([\w-]+)/g)) if (!classes.includes(m[1])) return false;
  for (const m of compound.matchAll(/\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]/g)) {
    const have = el.attrs[m[1].toLowerCase()];
    if (have === undefined) return false;
    if (m[2] === '=' && have !== m[3]) return false;
  }
  return true;
}

// ─── source discovery ───────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'Documentation', 'Assets', 'screenshots']);
function walk(dir, exts, depth, acc) {
  if (depth < 0) return acc;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, depth - 1, acc);
    else if (exts.includes(path.extname(e.name).toLowerCase())) acc.push(full);
  }
  return acc;
}
function readText(file) {
  try {
    const st = fs.statSync(file);
    if (st.size > 4 * 1024 * 1024) return null;
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch { return null; }
}
function readJson(file) {
  const t = readText(file);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return null; }
}
const versionNum = (f) => { const m = path.basename(f).match(/^v(\d+)/); return m ? parseInt(m[1], 10) : -1; };

function findEntryHtml(pluginDir, explicit) {
  if (explicit) {
    const f = path.isAbsolute(explicit) ? explicit : path.join(pluginDir, explicit);
    return fs.existsSync(f) ? { file: f, why: '--html' } : null;
  }
  const shipped = path.join(pluginDir, 'Source', 'ui', 'public', 'index.html');
  if (fs.existsSync(shipped)) return { file: shipped, why: 'shipped UI' };
  const ui = walk(path.join(pluginDir, 'Source', 'ui'), ['.html', '.htm'], 4, []);
  const idx = ui.find((f) => /index\.html?$/i.test(f)) || ui[0];
  if (idx) return { file: idx, why: 'Source/ui' };
  const design = walk(path.join(pluginDir, 'Design'), ['.html', '.htm'], 2, [])
    .filter((f) => !f.includes(path.sep + 'apc-ui' + path.sep))
    .sort((a, b) => versionNum(b) - versionNum(a) || a.localeCompare(b));
  if (design.length) return { file: design[0], why: 'newest Design/ preview' };
  const any = walk(pluginDir, ['.html', '.htm'], 3, []);
  return any.length ? { file: any[0], why: 'first *.html found' } : null;
}

function loadWebviewSources(pluginDir, opts) {
  const notes = [];
  const entry = findEntryHtml(pluginDir, opts.html);
  const css = [];
  const js = [];
  let doc = null;
  const root = opts.root || null;
  if (entry) {
    const html = readText(entry.file) || '';
    doc = parseHtml(html);
    doc.file = entry.file;
    doc.why = entry.why;
    const baseDir = path.dirname(entry.file);
    const resolveAsset = (href) => {
      if (!href || /^(https?:)?\/\//i.test(href) || /^data:/i.test(href)) return null;
      const clean = href.split(/[?#]/)[0];
      const direct = path.resolve(baseDir, clean);
      if (fs.existsSync(direct)) return direct;
      const kit = clean.match(/(?:^|\/)apc-ui\/([\w.-]+)$/);
      if (kit && root) {
        const k = path.join(root, 'templates', 'webview', 'apc-ui', kit[1]);
        if (fs.existsSync(k)) return k;
      }
      return undefined; // unresolved local file
    };
    for (const el of doc.elements) {
      if (el.tag === 'link' && /stylesheet/i.test(el.attrs.rel || '')) {
        const f = resolveAsset(el.attrs.href);
        if (f) css.push({ file: f, text: readText(f) || '' });
        else if (f === undefined) notes.push('unresolved stylesheet ' + el.attrs.href);
      }
    }
    for (const t of doc.styles) css.push({ file: entry.file + '<style>', text: t });
    for (const s of doc.scripts) {
      if (s.src) {
        const f = resolveAsset(s.src);
        if (f) js.push({ file: f, text: readText(f) || '' });
        else if (f === undefined) notes.push('unresolved script ' + s.src);
      } else {
        js.push({ file: entry.file + '<script>', text: s.code });
      }
    }
  } else {
    for (const f of walk(path.join(pluginDir, 'Source', 'ui'), ['.css'], 4, []).concat(walk(path.join(pluginDir, 'Design'), ['.css'], 3, []))) {
      css.push({ file: f, text: readText(f) || '' });
    }
    for (const f of walk(path.join(pluginDir, 'Source', 'ui'), ['.js'], 4, [])) js.push({ file: f, text: readText(f) || '' });
  }
  return { entry, doc, css, js, notes };
}

// ─── analysis helpers ───────────────────────────────────────────────────────
function normSel(e) {
  return e.selector.replace(/\[[^\]]*\]/g, '').replace(/\.(?:apc-)?theme[-_][\w]+|\.(?:night|day|dark|light)(?![\w-])/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function pageBackground(entries, vars, themeName) {
  const order = ['.apc-plate', '.plate', '#app', '#root', 'main', 'body', 'html', ':root'];
  for (const sel of order) {
    const cands = entries.filter((e) => { const n = normSel(e); return n === sel || n.endsWith(' ' + sel); });
    const themed = cands.filter((e) => themeName && e.theme === themeName);
    const plain = cands.filter((e) => !e.theme);
    for (const list of [themed.reverse(), plain.reverse()]) {
      for (const e of list) {
        const raw = bgOf(e.decls);
        const c = raw && resolveColor(raw, vars);
        if (c && c.a > 0) return { color: c, from: sel };
      }
    }
  }
  for (const name of ['--plate', '--surface', '--bg', '--background', '--paper', '--panel', '--inset']) {
    const c = vars[name] && resolveColor(vars[name], vars);
    if (c && c.a > 0) return { color: over(c, { r: 0, g: 0, b: 0, a: 1 }), from: name };
  }
  return null;
}

function fontIsLarge(decls) {
  const fs_ = decls['font-size'];
  if (!fs_) return false;
  const m = fs_.match(/^([\d.]+)px$/);
  if (!m) return false;
  const px = parseFloat(m[1]);
  const bold = /^(bold|[7-9]00)$/i.test((decls['font-weight'] || '').trim());
  return px >= 24 || (bold && px >= 18.66);
}

const NONTEXT_SELECTOR = /(?:^|[\s>+~.#\[])(?:button|input|select|textarea|knob|btn|chip|slider|fader|switch|toggle|psw|flip|thumb|pointer|cap|led|meter|track|handle|indicator|progress|dial|checkbox|radio)(?![a-z])/i;

/** Collect text + non-text colour pairs, as unresolved raw values, per rule. */
function collectPairs(entries) {
  const text = [];
  const ui = [];
  for (const e of entries) {
    const sel = e.selector;
    if (/:disabled|\[disabled\]|\.disabled|::selection|::placeholder/i.test(sel)) continue;
    const d = e.decls;
    const bg = bgOf(d);
    if (d.color && !/^(inherit|initial|unset|currentcolor)$/i.test(d.color.trim())) {
      text.push({ selector: sel, fg: d.color, bg, theme: e.theme, large: fontIsLarge(d) });
    }
    if (/:focus/i.test(sel)) {
      const oc = d['outline-color'] || (d.outline && colorFromShorthand(d.outline));
      if (oc && !/^(none|0)$/i.test((d.outline || '').trim())) ui.push({ selector: sel, fg: oc, bg: bg, theme: e.theme, kind: 'focus-ring' });
    } else if (NONTEXT_SELECTOR.test(sel) && !/:hover|:active/i.test(sel)) {
      const bc = d['border-color'] || (d.border && colorFromShorthand(d.border)) || (d['border-left'] && colorFromShorthand(d['border-left']));
      if (bc && !/^(none|0|transparent)$/i.test(bc.trim()) && !(d.border && /^(none|0)\b/.test(d.border.trim()))) {
        ui.push({ selector: sel, fg: bc, bg, theme: e.theme, kind: 'boundary' });
      }
      const fill = d.fill || d.stroke;
      if (fill && !/^(none|currentcolor)$/i.test(fill.trim())) ui.push({ selector: sel, fg: fill, bg, theme: e.theme, kind: 'graphic' });
    }
  }
  return { text, ui };
}

const TEXT_TOKENS = ['--ink', '--text', '--fg', '--foreground', '--on-surface', '--ink-2', '--muted', '--label'];
const SURFACE_TOKENS = ['--plate', '--plate-2', '--surface', '--inset', '--bg', '--background', '--paper', '--panel'];

function evalTheme(themeName, entries, maps, pairs) {
  const vars = { ...maps.base };
  if (themeName && maps.overlay[themeName]) Object.assign(vars, maps.overlay[themeName]);
  const page = pageBackground(entries, vars, themeName);
  const pageBg = page ? page.color : null;
  const textRes = [];
  const uiRes = [];
  let unresolved = 0;
  const applies = (p) => !p.theme || p.theme === themeName;
  const resolvePair = (p) => {
    const fg0 = resolveColor(p.fg, vars);
    if (!fg0) return null;
    let bg = p.bg ? resolveColor(p.bg, vars) : null;
    if (bg && bg.a < 1 && pageBg) bg = over(bg, pageBg);
    if (!bg || bg.a < 1) bg = pageBg;
    if (!bg) return null;
    return { fg: over(fg0, bg), bg };
  };
  for (const p of pairs.text) {
    if (!applies(p)) continue;
    const r = resolvePair(p);
    if (!r) { unresolved++; continue; }
    textRes.push({ ...p, ...r, ratio: contrastRatio(r.fg, r.bg), min: p.large ? LIMITS.largeTextContrast : LIMITS.textContrast });
  }
  for (const p of pairs.ui) {
    if (!applies(p)) continue;
    const r = resolvePair(p);
    if (!r) { unresolved++; continue; }
    uiRes.push({ ...p, ...r, ratio: contrastRatio(r.fg, r.bg), min: LIMITS.nonTextContrast });
  }
  // Token fallback: pages composed purely from tokens with no explicit colour rules.
  let fallbackUsed = false;
  if (!textRes.length && pageBg) {
    for (const t of TEXT_TOKENS) {
      const c = vars[t] && resolveColor(vars[t], vars);
      if (!c) continue;
      textRes.push({ selector: 'token ' + t, fg: over(c, pageBg), bg: pageBg, ratio: contrastRatio(over(c, pageBg), pageBg), min: LIMITS.textContrast });
      fallbackUsed = true;
    }
  }
  if (!uiRes.length && pageBg) {
    const c = vars['--accent'] && resolveColor(vars['--accent'], vars);
    if (c) { uiRes.push({ selector: 'token --accent', kind: 'accent', fg: over(c, pageBg), bg: pageBg, ratio: contrastRatio(over(c, pageBg), pageBg), min: LIMITS.nonTextContrast }); fallbackUsed = true; }
  }
  return { theme: themeName, textRes, uiRes, unresolved, pageBg: page, fallbackUsed };
}

function fmtPair(r) {
  return `${r.selector.length > 48 ? r.selector.slice(0, 45) + '...' : r.selector}: ${colorHex(r.fg)} on ${colorHex(r.bg)} = ${r.ratio.toFixed(2)}:1 (needs ${r.min}:1)`;
}

function contrastChecks(checks, css, label) {
  const entries = [];
  const parsedAll = [];
  for (const c of css) {
    const parsed = parseCss(c.text);
    parsedAll.push(parsed);
    entries.push(...expandRules(parsed));
  }
  const maps = varMaps(entries);
  const pairs = collectPairs(entries);
  const named = maps.themes.slice().sort();
  const themeRuns = [null].concat(named);
  const declared = named.length > 0;
  const results = themeRuns.map((t) => evalTheme(t, entries, maps, pairs));
  const themeLabel = (r) => r.theme || (declared ? 'default' : 'single theme');
  const themesNote = declared ? ` [themes evaluated: ${results.map(themeLabel).join(', ')}]` : '';

  if (!entries.length) {
    checks.push({ check: 'contrast-text', status: 'info', message: `no CSS found${label ? ' (' + label + ')' : ''}: contrast not checked` });
    return { entries, maps, parsedAll };
  }
  for (const kind of ['text', 'ui']) {
    const name = kind === 'text' ? 'contrast-text' : 'contrast-ui';
    const minLabel = kind === 'text' ? '4.5:1 text' : '3:1 non-text';
    const fails = [];
    const warns = [];
    let total = 0;
    let worst = null;
    let unresolved = 0;
    for (const r of results) {
      const list = kind === 'text' ? r.textRes : r.uiRes;
      unresolved += r.unresolved;
      for (const p of list) {
        total++;
        if (!worst || p.ratio < worst.ratio) worst = { ...p, theme: themeLabel(r) };
        if (p.ratio + 1e-9 < p.min) {
          const line = (declared ? `[${themeLabel(r)}] ` : '') + fmtPair(p);
          if (kind === 'ui' && !(p.kind === 'focus-ring' || p.kind === 'accent')) warns.push(line);
          else fails.push(line);
        }
      }
    }
    if (!total) {
      checks.push({ check: name, status: 'info', message: `no resolvable ${kind === 'text' ? 'text/background' : 'non-text'} colour pairs found${themesNote}` });
    } else if (fails.length) {
      checks.push({ check: name, status: 'fail', message: `${fails.length} of ${total} ${minLabel} pair(s) below WCAG 2.1 minimum: ${listShort(fails, 5)}${themesNote}` });
    } else if (warns.length) {
      checks.push({ check: name, status: 'warn', message: `${warns.length} component boundary/graphic colour(s) under 3:1 (heuristic): ${listShort(warns, 5)}${themesNote}` });
    } else {
      checks.push({ check: name, status: 'pass', message: `${total} ${minLabel} pair(s) meet WCAG 2.1; lowest ${worst.ratio.toFixed(2)}:1 (${worst.selector}${declared ? ', ' + worst.theme : ''})${themesNote}` });
    }
    if (unresolved && kind === 'ui') {
      checks.push({ check: 'contrast-unresolved', status: 'info', message: `${unresolved} colour pair(s) skipped: value not statically resolvable (gradient, color-mix, JS-set)` });
    }
  }
  return { entries, maps, parsedAll };
}

// ─── DOM checks ─────────────────────────────────────────────────────────────
function domChecks(checks, doc, entries) {
  const els = doc.elements.filter((e) => !['script', 'style', 'head', 'meta', 'link', 'title', 'html'].includes(e.tag));
  const byId = {};
  const labelsFor = {};
  for (const e of doc.elements) {
    if (e.attrs.id) byId[e.attrs.id] = e;
    if (e.tag === 'label' && e.attrs.for && e.text.trim()) labelsFor[e.attrs.for] = true;
  }
  const interactive = els.filter(isInteractive);
  if (!interactive.length) {
    checks.push({ check: 'keyboard-reach', status: 'info', message: 'no interactive elements found in the static HTML (controls created by JS are not visible to this check)' });
    checks.push({ check: 'accessible-names', status: 'info', message: 'no interactive elements found in the static HTML' });
  } else {
    // keyboard reach
    const unreachable = [];
    const positive = [];
    const negNative = [];
    for (const el of interactive) {
      const tab = el.attrs.tabindex;
      const n = tab === undefined ? null : parseInt(tab, 10);
      const native = isNativeInteractive(el);
      const disabled = el.attrs.disabled !== undefined;
      if (n !== null && n > 0) positive.push(describeEl(el));
      if (native) {
        if (!disabled && n !== null && n < 0) negNative.push(describeEl(el));
      } else if (n === null || n < 0) {
        unreachable.push(describeEl(el));
      }
    }
    if (unreachable.length) {
      checks.push({ check: 'keyboard-reach', status: 'fail', message: `${unreachable.length} interactive element(s) not keyboard reachable (custom control without tabindex>=0 or native element): ${listShort(unreachable)}` });
    } else if (negNative.length || positive.length) {
      checks.push({ check: 'keyboard-reach', status: 'warn', message: [negNative.length ? `tabindex=-1 removes ${negNative.length} native control(s) from tab order: ${listShort(negNative, 3)}` : '', positive.length ? `positive tabindex distorts tab order: ${listShort(positive, 3)}` : ''].filter(Boolean).join(' | ') });
    } else {
      checks.push({ check: 'keyboard-reach', status: 'pass', message: `${interactive.length} interactive element(s) keyboard reachable` });
    }
    // accessible names
    const unnamed = [];
    const titleOnly = [];
    for (const el of interactive) {
      const via = accessibleName(el, byId, labelsFor);
      if (!via) unnamed.push(describeEl(el));
      else if (via === 'title') titleOnly.push(describeEl(el));
    }
    if (unnamed.length) {
      checks.push({ check: 'accessible-names', status: 'fail', message: `${unnamed.length} interactive element(s) without an accessible name (aria-label / label text / title): ${listShort(unnamed)}` });
    } else {
      checks.push({ check: 'accessible-names', status: 'pass', message: `${interactive.length} interactive element(s) have accessible names${titleOnly.length ? ` (${titleOnly.length} only via title - see hover-only-info)` : ''}` });
    }
    doc._titleOnlyInteractive = titleOnly;
  }

  // information only in title / hover
  const infoOnlyTitle = els.filter((e) => !isInteractive(e) && !e.inTemplate && !isHidden(e) && (e.attrs.title || '').trim()
    && !e.text.trim() && !(e.attrs['aria-label'] || '').trim() && !(e.attrs['aria-labelledby'] || '').trim()
    && !['html', 'body', 'svg', 'canvas'].includes(e.tag) && !/\bapc-grip\b/.test(e.attrs.class || ''));
  const hoverOnly = [];
  for (const e of entries) {
    if (!/:hover/i.test(e.selector)) continue;
    const reveals = (e.decls.display && !/^none$/i.test(e.decls.display))
      || /^visible$/i.test(e.decls.visibility || '') || (e.decls.opacity !== undefined && parseFloat(e.decls.opacity) > 0.5 && /(tip|tooltip|popover|hint|help|info)/i.test(e.selector))
      || (e.decls.content && /(tip|tooltip|popover|hint|help|info|attr\()/i.test(e.selector + e.decls.content));
    if (!reveals) continue;
    const twin = e.selector.replace(/:hover/gi, ':focus-visible');
    const twin2 = e.selector.replace(/:hover/gi, ':focus-within');
    const hasFocus = entries.some((o) => o !== e && (o.selector.replace(/\s+/g, '') === twin.replace(/\s+/g, '') || o.selector.replace(/\s+/g, '') === twin2.replace(/\s+/g, '')
      || (/:focus(-visible|-within)?/i.test(o.selector) && o.selector.replace(/:focus(-visible|-within)?/gi, ':hover').replace(/\s+/g, '') === e.selector.replace(/\s+/g, ''))));
    if (!hasFocus) hoverOnly.push(e.selector.length > 50 ? e.selector.slice(0, 47) + '...' : e.selector);
  }
  const probs = [];
  let status = 'pass';
  if (infoOnlyTitle.length) { status = 'fail'; probs.push(`${infoOnlyTitle.length} non-interactive element(s) carry information only in title: ${listShort(infoOnlyTitle.map(describeEl), 4)}`); }
  if (hoverOnly.length) { if (status === 'pass') status = 'warn'; probs.push(`${hoverOnly.length} :hover reveal rule(s) with no :focus/:focus-visible equivalent: ${listShort(hoverOnly, 4)}`); }
  if ((doc._titleOnlyInteractive || []).length) { if (status === 'pass') status = 'warn'; probs.push(`${doc._titleOnlyInteractive.length} control(s) named only by title (hover tooltip): ${listShort(doc._titleOnlyInteractive, 4)}`); }
  checks.push({ check: 'hover-only-info', status, message: probs.length ? probs.join(' | ') : 'no information is conveyed only by title/hover' });

  // non-text alternatives for canvases (meters, scopes)
  const canvases = els.filter((e) => e.tag === 'canvas' && !e.inTemplate && !isHidden(e));
  if (canvases.length) {
    const bare = canvases.filter((e) => !(e.attrs['aria-label'] || '').trim() && !(e.attrs['aria-labelledby'] || '').trim()
      && !((e.attrs.role || '').toLowerCase() === 'img' && (e.attrs.title || '').trim()) && !e.text.trim() && !isHidden(e.parent || e));
    // A canvas inside a labelled control (e.g. .apc-well with role/aria-label) is covered by its ancestor.
    const uncovered = bare.filter((c) => {
      for (let p = c.parent; p; p = p.parent) if ((p.attrs['aria-label'] || '').trim() || (p.attrs['aria-labelledby'] || '').trim()) return false;
      return true;
    });
    checks.push({ check: 'non-text-alternatives', status: uncovered.length ? 'warn' : 'pass',
      message: uncovered.length ? `${uncovered.length} <canvas> without aria-label/role=img or fallback text (meters/scopes are invisible to assistive tech): ${listShort(uncovered.map(describeEl), 4)}` : `${canvases.length} <canvas> element(s) have a text alternative` });
  }
}

// ─── focus + motion + perf (CSS / JS driven) ────────────────────────────────
function isNoOutline(d) {
  const v = (d.outline || d['outline-style'] || '').trim();
  return /^(none|0|0px)(\s|$)/i.test(v);
}
function focusCheck(checks, entries, hasInteractive) {
  const resets = entries.filter((e) => isNoOutline(e.decls) && !/:not\(\s*:focus-visible\s*\)|:active/i.test(e.selector));
  const visible = entries.filter((e) => /:focus-visible|:focus-within|:focus/i.test(e.selector) && !/:not\(\s*:focus/i.test(e.selector)
    && ((e.decls.outline && !isNoOutline(e.decls)) || e.decls['outline-color'] || e.decls['outline-width']
      || (e.decls['box-shadow'] && !/^none$/i.test(e.decls['box-shadow'].trim())) || e.decls.border || e.decls['border-color']
      || e.decls.background || e.decls['background-color'] || e.decls.filter));
  if (resets.length && !visible.length) {
    checks.push({ check: 'focus-visible', status: 'fail', message: `focus outline removed by ${listShort(resets.map((r) => r.selector), 3)} and no :focus-visible replacement style is defined` });
  } else if (visible.length) {
    checks.push({ check: 'focus-visible', status: 'pass', message: `${visible.length} :focus/:focus-visible style rule(s)${resets.length ? ' replace the removed default outline' : '; default outline kept'}` });
  } else if (hasInteractive) {
    checks.push({ check: 'focus-visible', status: 'info', message: 'no custom focus style and no outline removal: relies on the browser default focus ring (WebView2 draws one for focusable elements)' });
  } else {
    checks.push({ check: 'focus-visible', status: 'info', message: 'no focus styles found (and no interactive elements)' });
  }
}

function numberOfMs(v) {
  const m = String(v).match(/^([\d.]+)(ms|s)?$/);
  if (!m) return null;
  return m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
}

function motionAndPerf(checks, ctx) {
  const { entries, parsedAll, doc, jsText, status, kind } = ctx;
  const allCss = ctx.cssText;
  const keyframes = parsedAll.reduce((n, p) => n + p.keyframes.length, 0);
  const animRules = entries.filter((e) => {
    const a = e.decls.animation || e.decls['animation-name'];
    return a && !/^none\b/i.test(a.trim());
  });
  const transRules = entries.filter((e) => e.decls.transition && !/^none$/i.test(e.decls.transition.trim()) && !/\b0s\b/.test(e.decls.transition) && !/^all\s+0/i.test(e.decls.transition));
  const jsAnim = /requestAnimationFrame\s*\(|\.animate\s*\(/.test(jsText);
  const reduceMq = entries.filter((e) => e.ctx.some((c) => /prefers-reduced-motion\s*:\s*reduce/i.test(c)));
  const reduceNoPref = entries.filter((e) => e.ctx.some((c) => /prefers-reduced-motion\s*:\s*no-preference/i.test(c)));
  const jsReduce = /matchMedia\s*\(\s*['"`]\(prefers-reduced-motion/.test(jsText);
  const hasAnim = keyframes > 0 || animRules.length > 0;

  if (!hasAnim && !transRules.length && !jsAnim) {
    checks.push({ check: 'reduced-motion', status: 'pass', message: 'no CSS animations, transitions or JS animation loops found' });
  } else {
    const what = [hasAnim ? `${keyframes} @keyframes / ${animRules.length} animation rule(s)` : '', transRules.length ? `${transRules.length} transition rule(s)` : '', jsAnim ? 'JS animation loop (requestAnimationFrame/animate)' : ''].filter(Boolean).join(', ');
    const neutralises = reduceMq.some((e) => Object.keys(e.decls).some((k) => /^(animation|transition|scroll-behavior)/.test(k)));
    const honours = neutralises || reduceNoPref.length > 0 || jsReduce;
    if (honours) {
      checks.push({ check: 'reduced-motion', status: 'pass', message: `prefers-reduced-motion is honoured (${what})` });
    } else if (hasAnim) {
      checks.push({ check: 'reduced-motion', status: 'fail', message: `animations present (${what}) but no @media (prefers-reduced-motion: reduce) override or matchMedia check` });
    } else {
      checks.push({ check: 'reduced-motion', status: 'warn', message: `motion present (${what}) without a prefers-reduced-motion override` });
    }
  }

  // perf: animated elements
  const animatedSet = new Set();
  let infinite = 0;
  for (const r of animRules) {
    if (/\binfinite\b/i.test(r.decls.animation || '') || /^infinite$/i.test(r.decls['animation-iteration-count'] || '')) infinite++;
    if (doc && doc.elements.length) {
      const comp = compoundOf(r.selector);
      doc.elements.forEach((el, i) => { if (!el.inTemplate && matchesCompound(el, comp)) animatedSet.add(i); });
    }
  }
  const animatedN = doc && doc.elements.length ? animatedSet.size : animRules.length;
  checks.push({
    check: 'perf-animated-elements',
    status: animatedN > LIMITS.maxAnimatedElements ? 'warn' : (animRules.length ? 'info' : 'pass'),
    message: animRules.length
      ? `${animatedN} element(s) matched by ${animRules.length} animation rule(s), ${infinite} infinite (budget hint: <= ${LIMITS.maxAnimatedElements} animated elements)`
      : 'no CSS-animated elements',
  });

  // perf: backdrop-filter
  const backdrop = entries.filter((e) => e.decls['backdrop-filter'] || e.decls['-webkit-backdrop-filter']).length;
  checks.push({
    check: 'perf-backdrop-filter',
    status: backdrop > LIMITS.maxBackdropFilters ? 'warn' : (backdrop ? 'info' : 'pass'),
    message: backdrop ? `${backdrop} backdrop-filter rule(s) (each forces an offscreen composite layer; budget hint: <= ${LIMITS.maxBackdropFilters})` : 'no backdrop-filter',
  });

  // perf: large shadows
  let large = 0;
  for (const e of entries) {
    const vals = [e.decls['box-shadow'], e.decls['text-shadow'], e.decls.filter && /drop-shadow/.test(e.decls.filter) ? e.decls.filter.replace(/.*drop-shadow\(([^)]*)\).*/, '$1') : null].filter(Boolean);
    for (const v of vals) {
      for (const layer of splitTop(v, ',')) {
        if (/^\s*none\s*$/i.test(layer)) continue;
        const lens = (layer.replace(/(rgba?|hsla?)\([^)]*\)/gi, '').match(/-?[\d.]+(?:px|rem|em)?(?=\s|$)/g) || [])
          .filter((t) => /px|rem|em|^0$/.test(t) || /^-?[\d.]+$/.test(t));
        const blur = lens.length >= 3 ? lens[2] : null;
        if (blur) {
          const n = parseFloat(blur);
          const px = /rem|em/.test(blur) ? n * 16 : n;
          if (px > LIMITS.largeShadowBlurPx) large++;
        }
      }
    }
  }
  checks.push({
    check: 'perf-shadows',
    status: large > LIMITS.maxLargeShadows ? 'warn' : (large ? 'info' : 'pass'),
    message: large ? `${large} shadow layer(s) with blur > ${LIMITS.largeShadowBlurPx}px (budget hint: <= ${LIMITS.maxLargeShadows})` : `no shadow blur > ${LIMITS.largeShadowBlurPx}px`,
  });

  // perf: meter update rate
  const rates = [];
  const rateRe = /\b([A-Za-z_]*(?:meter|level|vu|peak|rms)[A-Za-z_]*)\s*[:=]\s*(\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = rateRe.exec(jsText))) {
    const name = m[1];
    if (!/(hz|rate|fps|interval|period|ms)/i.test(name)) continue;
    const n = parseFloat(m[2]);
    const hz = /(interval|period|ms)/i.test(name) && !/hz/i.test(name) ? (n > 0 ? 1000 / n : null) : n;
    if (hz) rates.push({ src: name, hz });
  }
  const iv = /setInterval\s*\([^;]*?,\s*(\d+)\s*\)/g;
  while ((m = iv.exec(jsText))) { const ms = parseInt(m[1], 10); if (ms > 0 && ms < 16) rates.push({ src: `setInterval(${ms}ms)`, hz: 1000 / ms }); }
  if (doc) for (const el of doc.elements) {
    if (el.attrs['data-meter-hz']) rates.push({ src: describeEl(el) + ' data-meter-hz', hz: parseFloat(el.attrs['data-meter-hz']) });
  }
  const pb = status && status.perf_budget && typeof status.perf_budget === 'object' ? status.perf_budget : null;
  if (pb && Number.isFinite(Number(pb.meter_hz))) rates.push({ src: 'status.json perf_budget.meter_hz', hz: Number(pb.meter_hz) });
  for (const t of ctx.cppTimers || []) rates.push(t);
  const meterish = (doc && doc.elements.some((e) => /meter|vu|level|scope/i.test((e.attrs.class || '') + ' ' + (e.attrs.id || '')) || e.tag === 'canvas')) || /meter/i.test(jsText);
  const over60 = rates.filter((r) => r.hz > LIMITS.maxMeterHz + 1e-9);
  if (over60.length) {
    checks.push({ check: 'perf-meter-rate', status: 'fail', message: `meter/UI update rate above ${LIMITS.maxMeterHz} Hz: ${listShort(over60.map((r) => `${r.src} = ${Math.round(r.hz * 10) / 10} Hz`), 4)}` });
  } else if (rates.length) {
    checks.push({ check: 'perf-meter-rate', status: 'pass', message: `declared update rate(s) <= ${LIMITS.maxMeterHz} Hz: ${listShort(rates.map((r) => `${r.src} = ${Math.round(r.hz * 10) / 10} Hz`), 4)}` });
  } else {
    checks.push({ check: 'perf-meter-rate', status: meterish ? 'warn' : 'info', message: `no meter update rate declared${meterish ? ' although meters/canvases exist' : ''} - add perf_budget.meter_hz (<= ${LIMITS.maxMeterHz}) to status.json or a METER_HZ constant` });
  }

  // perf: WebView overhead budget
  if (kind === 'visage') {
    checks.push({ check: 'perf-webview-overhead', status: 'info', message: 'not applicable: Visage renders natively (no WebView2 process)' });
  } else {
    const budget = pb ? (typeof pb.webview_overhead_mb === 'number' ? pb.webview_overhead_mb : (Number.isFinite(Number(pb.webview_mb)) ? Number(pb.webview_mb) : null)) : (typeof (status && status.perf_budget) === 'number' ? status.perf_budget : null);
    const limit = budget !== null && budget > 0 ? budget : LIMITS.defaultWebviewMb;
    const meas = pb ? (pb.measured && typeof pb.measured === 'object' ? pb.measured.webview_overhead_mb : pb.measured_webview_mb !== undefined ? pb.measured_webview_mb : pb.measured) : null;
    const src = budget !== null ? 'status.json perf_budget' : `default ${LIMITS.defaultWebviewMb} MB`;
    if (meas !== null && meas !== undefined && Number.isFinite(Number(meas))) {
      const n = Number(meas);
      checks.push({ check: 'perf-webview-overhead', status: n <= limit ? 'pass' : 'fail', message: `measured WebView overhead ${n} MB ${n <= limit ? '<=' : '>'} budget ${limit} MB (${src})` });
    } else {
      checks.push({ check: 'perf-webview-overhead', status: 'info', message: `budget ${limit} MB (${src}); no measured value recorded - add perf_budget.measured.webview_overhead_mb after measuring the Standalone/host process` });
    }
  }
  void allCss;
}

function cppTimerRates(pluginDir) {
  const files = walk(path.join(pluginDir, 'Source'), ['.cpp', '.h', '.hpp', '.mm'], 4, []).filter((f) => !f.includes(path.sep + 'ui' + path.sep + 'public' + path.sep));
  const rates = [];
  for (const f of files) {
    const t = readText(f);
    if (!t) continue;
    for (const m of t.matchAll(/startTimerHz\s*\(\s*(\d+)\s*\)/g)) rates.push({ src: `${path.basename(f)} startTimerHz(${m[1]})`, hz: parseInt(m[1], 10) });
    for (const m of t.matchAll(/startTimer\s*\(\s*(\d+)\s*\)/g)) { const ms = parseInt(m[1], 10); if (ms > 0) rates.push({ src: `${path.basename(f)} startTimer(${ms}ms)`, hz: 1000 / ms }); }
  }
  return { rates, files };
}

// ─── Visage (C++) path ──────────────────────────────────────────────────────
function visageChecks(checks, pluginDir, status, root) {
  checks.push({ check: 'a11y-framework', status: 'info', message: 'ui_framework=visage: native canvas UI. DOM-based checks (accessible names, tab order, CSS focus/motion rules) cannot be verified statically - test with the host/OS accessibility tools. Statically possible checks follow.' });
  const mapFile = ['ui-map.json'].map((f) => path.join(pluginDir, 'Design', f)).find((f) => fs.existsSync(f))
    || walk(path.join(pluginDir, 'Design'), ['.json'], 1, []).filter((f) => /ui-map\.json$/.test(f)).sort((a, b) => versionNum(b) - versionNum(a))[0];
  const map = mapFile ? readJson(mapFile) : null;
  if (map && map.tokens && typeof map.tokens === 'object') {
    const css = ':root{' + Object.entries(map.tokens).map(([k, v]) => `${k.startsWith('--') ? k : '--' + k}:${v};`).join('') + '}';
    contrastChecks(checks, [{ file: mapFile, text: css }], 'ui-map tokens');
  } else {
    checks.push({ check: 'contrast-text', status: 'info', message: 'no Design/ui-map.json tokens to evaluate: colour contrast of Visage widgets is not checked statically' });
  }
  const { rates, files } = cppTimerRates(pluginDir);
  const sources = files.map((f) => readText(f) || '').join('\n');
  if (rates.length) {
    const over60 = rates.filter((r) => r.hz > LIMITS.maxMeterHz);
    checks.push({ check: 'perf-meter-rate', status: over60.length ? 'fail' : 'pass', message: over60.length ? `update timer above ${LIMITS.maxMeterHz} Hz: ${listShort(over60.map((r) => `${r.src} = ${Math.round(r.hz)} Hz`))}` : `timer rate(s) <= ${LIMITS.maxMeterHz} Hz: ${listShort(rates.map((r) => `${r.src}`))}` });
  } else {
    checks.push({ check: 'perf-meter-rate', status: 'info', message: 'no startTimerHz()/startTimer() found in Source/: declare the meter rate (<= 60 Hz) in perf_budget.meter_hz' });
  }
  const kb = /keyPressed|keyStateChanged|onKey\w*|setWantsKeyboardFocus|isKeyboardFocus|handleKey/.test(sources);
  checks.push({ check: 'keyboard-reach', status: kb ? 'info' : 'warn', message: kb ? 'keyboard handling code found in Source/ (behaviour not verifiable statically)' : 'no keyboard handling (keyPressed / setWantsKeyboardFocus) found in Source/: controls may be mouse-only' });
  const rm = /reduce[_-]?motion|reducedMotion|prefersReducedMotion|isAnimationDisabled/i.test(sources);
  checks.push({ check: 'reduced-motion', status: rm ? 'pass' : 'info', message: rm ? 'reduced-motion handling found in Source/' : 'no reduced-motion handling found in Source/ (applies only if the UI animates)' });
  checks.push({ check: 'perf-webview-overhead', status: 'info', message: 'not applicable: Visage renders natively (no WebView2 process)' });
  void status; void root;
}

// ─── entry point ────────────────────────────────────────────────────────────
function argAfter(args, name) {
  const i = (args || []).indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function validate(pluginDir, opts) {
  opts = opts || {};
  const checks = [];
  const status = readJson(path.join(pluginDir, 'status.json'));
  if (!status) checks.push({ check: 'a11y-source', status: 'info', message: 'status.json not found or unreadable: assuming a WebView plugin, no perf_budget' });
  const kind = status && String(status.ui_framework || '').toLowerCase() === 'visage' ? 'visage' : 'webview';

  if (kind === 'visage') {
    visageChecks(checks, pluginDir, status, opts.root);
    return { checks };
  }

  const html = opts.html || argAfter(opts.args, '--html');
  const src = loadWebviewSources(pluginDir, { html, root: opts.root });
  const where = src.entry ? `${path.relative(pluginDir, src.entry.file) || src.entry.file} (${src.entry.why})` : 'no HTML entry document';
  if (!src.entry && !src.css.length) {
    checks.push({ check: 'a11y-source', status: 'warn', message: `no WebView UI source found under ${pluginDir} (looked in Source/ui, Design, *.html): nothing to check` });
    return { checks };
  }
  checks.push({ check: 'a11y-source', status: 'info', message: `analysed ${where}; ${src.css.length} stylesheet(s), ${src.js.length} script(s)${src.notes.length ? '; ' + listShort(src.notes, 3) : ''}. Static analysis: controls built by JS at runtime are not visible.` });

  const c = contrastChecks(checks, src.css, '');
  const entries = c.entries;
  if (src.doc) domChecks(checks, src.doc, entries);
  else checks.push({ check: 'keyboard-reach', status: 'info', message: 'no HTML document: DOM checks skipped' });
  const hasInteractive = !!(src.doc && src.doc.elements.some((e) => isInteractive(e)));
  focusCheck(checks, entries, hasInteractive);
  const cpp = cppTimerRates(pluginDir);
  motionAndPerf(checks, {
    entries, parsedAll: c.parsedAll, doc: src.doc, status, kind,
    jsText: src.js.map((j) => j.text).join('\n'), cssText: src.css.map((x) => x.text).join('\n'), cppTimers: cpp.rates,
  });
  return { checks };
}

module.exports = {
  validate, LIMITS,
  // exported for tests / reuse
  parseColor, contrastRatio, luminance, parseCss, parseHtml, resolveColor,
};
