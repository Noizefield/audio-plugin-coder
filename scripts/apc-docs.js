'use strict';

/**
 * apc docs -- docs-as-truth checker (roadmap idea #3 follow-up).
 *
 *   apc docs check [files...] [--json] [--external] [--fix-safe]
 *                  [--only links,snippets,stale,version]
 *
 * Checks (zero dependencies, Node 18+):
 *   links     relative markdown links + #anchors resolve (case-exact, so a
 *             Windows checkout does not hide breakage that Linux CI will see)
 *   snippets  every fenced powershell / bash / sh / json block in docs/** and
 *             .agents/** parses (json: JSON.parse, bash: `bash -n`,
 *             powershell: the PowerShell language parser). Never executed.
 *   stale     lint for known-stale strings; exceptions live in
 *             docs/.stale-allowlist.json
 *   version   README badge / hub/version.js / CMake APC_VERSION agree with
 *             package.json (delegates to `apc version sync`)
 *
 * Exit codes: 0 clean (warnings allowed) - 1 findings - 2 usage error.
 * Contract: exports run(args, ctx) -> exit code, ctx = { root, resolvePaths,
 * pluginPath, readConfig, cmd } (see bin/apc.js MODULE_COMMANDS), plus
 * check(root, opts) -> result object (used by tests).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const SCHEMA = 'apc-docs-check/1';
const ALLOWLIST_REL = 'docs/.stale-allowlist.json';
const ALL_CHECKS = ['links', 'snippets', 'stale', 'version'];

// ---------------------------------------------------------------- file walking
const SKIP_DIRS = new Set(['node_modules', '.git', 'plans', 'build', 'release', '_tools']);

function walk(dir, out, filter) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, filter);
    else if (e.isFile() && filter(full)) out.push(full);
  }
}

/** Markdown files in scope. `plans/` is gitignored scratch -> never scanned. */
function collectFiles(root) {
  const files = [];
  for (const rel of ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'hub/README.md']) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) files.push(p);
  }
  for (const d of ['docs', '.agents']) {
    walk(path.join(root, d), files, (f) => /\.md$/i.test(f));
  }
  return files;
}

const toRel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function readText(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); } catch { return null; }
}

// ------------------------------------------------------------ markdown parsing
/**
 * Split markdown into lines tagged with fence state.
 * Returns { lines: [{n, text, fenced}], fences: [{lang, info, startLine, body}] }
 */
function parseMarkdown(text) {
  const raw = text.split(/\r?\n/);
  const lines = [];
  const fences = [];
  let open = null;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const m = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/.exec(line);
    if (!open) {
      if (m && !(m[2][0] === '`' && /`/.test(m[4]))) {
        open = { char: m[2][0], len: m[2].length, indent: m[1].length, lang: m[3].toLowerCase(), info: (m[3] + ' ' + m[4]).trim(), startLine: i + 1, body: [] };
        lines.push({ n: i + 1, text: line, fenced: true });
        continue;
      }
      lines.push({ n: i + 1, text: line, fenced: false });
    } else {
      const close = /^(\s*)(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[2][0] === open.char && close[2].length >= open.len) {
        fences.push({ lang: open.lang, info: open.info, startLine: open.startLine, body: open.body });
        open = null;
        lines.push({ n: i + 1, text: line, fenced: true });
        continue;
      }
      // strip the opening indent so indented (list) fences parse cleanly
      const stripped = line.replace(new RegExp('^\\s{0,' + open.indent + '}'), '');
      open.body.push(stripped);
      lines.push({ n: i + 1, text: line, fenced: true });
    }
  }
  if (open) fences.push({ lang: open.lang, info: open.info, startLine: open.startLine, body: open.body, unterminated: true });
  return { lines, fences };
}

/** GitHub-style heading slug (github-slugger algorithm, close enough for docs). */
function slugify(headingText) {
  let t = headingText
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/&[a-z]+;/gi, '')
    .trim()
    .toLowerCase();
  t = t.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '');
  return t.replace(/ /g, '-');
}

function collectAnchors(parsed) {
  const set = new Set();
  const seen = new Map();
  for (const l of parsed.lines) {
    if (l.fenced) continue;
    const h = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l.text);
    if (h) {
      const base = slugify(h[1]);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      set.add(count === 0 ? base : `${base}-${count}`);
    }
    const re = /<a\s+[^>]*?(?:name|id)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(l.text))) set.add(m[1]);
    const idRe = /\sid\s*=\s*["']([^"']+)["']/gi;
    while ((m = idRe.exec(l.text))) set.add(m[1]);
  }
  return set;
}

/** Extract link targets from a non-fenced line (inline code spans removed). */
function extractLinks(lineText) {
  const text = lineText.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
  const out = [];
  const inline = /\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  let m;
  while ((m = inline.exec(text))) out.push(m[1].replace(/^<|>$/g, ''));
  const refDef = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(text);
  if (refDef) out.push(refDef[1].replace(/^<|>$/g, ''));
  const html = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  while ((m = html.exec(text))) out.push(m[1]);
  return out;
}

// ------------------------------------------------------------------ fs helpers
const dirCache = new Map();
function listDir(dir) {
  if (!dirCache.has(dir)) {
    try { dirCache.set(dir, new Set(fs.readdirSync(dir))); } catch { dirCache.set(dir, null); }
  }
  return dirCache.get(dir);
}

/** Existence check that is case-EXACT even on case-insensitive filesystems. */
function existsExact(abs) {
  const parsed = path.parse(abs);
  const rest = abs.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  let cur = parsed.root;
  for (const seg of rest) {
    const names = listDir(cur);
    if (!names || !names.has(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}

/** Correct-case spelling of a path whose only problem is case, else null. */
function caseCorrected(abs) {
  const parsed = path.parse(abs);
  const rest = abs.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  let cur = parsed.root;
  const fixed = [];
  for (const seg of rest) {
    const names = listDir(cur);
    if (!names) return null;
    let hit = names.has(seg) ? seg : null;
    if (!hit) for (const n of names) if (n.toLowerCase() === seg.toLowerCase()) { hit = n; break; }
    if (!hit) return null;
    fixed.push(hit);
    cur = path.join(cur, hit);
  }
  return fixed.join('/');
}

// ----------------------------------------------------------------- link check
const PLACEHOLDER_RE = /[<>{}$*|]|\.\.\.|^%/;

function checkLinks(ctxs, root, result, opts) {
  const anchorCache = new Map();
  const anchorsFor = (abs) => {
    if (!anchorCache.has(abs)) {
      const t = readText(abs);
      anchorCache.set(abs, t === null ? null : collectAnchors(parseMarkdown(t)));
    }
    return anchorCache.get(abs);
  };
  for (const f of ctxs) {
    for (const l of f.parsed.lines) {
      if (l.fenced) continue;
      for (const rawTarget of extractLinks(l.text)) {
        const target = rawTarget.trim();
        if (!target) continue;
        if (/^(https?:)?\/\//i.test(target)) {
          result.external.push({ file: f.rel, line: l.n, url: target });
          continue;
        }
        if (/^(mailto:|tel:|data:|javascript:)/i.test(target)) continue;
        if (/^[A-Za-z]:[\\/]/.test(target)) { result.skipped.push({ check: 'links', file: f.rel, line: l.n, reason: `absolute OS path not checkable: ${target}` }); continue; }
        if (PLACEHOLDER_RE.test(target)) { result.skipped.push({ check: 'links', file: f.rel, line: l.n, reason: `placeholder target not checkable: ${target}` }); continue; }

        let [p, anchor] = target.split('#');
        let decoded = p;
        try { decoded = decodeURIComponent(p); } catch { /* keep raw */ }
        let abs;
        if (decoded === '') abs = f.abs;
        else if (decoded.startsWith('/')) abs = path.join(root, decoded);
        else abs = path.resolve(path.dirname(f.abs), decoded);
        abs = abs.replace(/[\\/]+$/, '');

        const relFromRoot = toRel(root, abs);
        if (decoded !== '' && !existsExact(abs)) {
          const fix = caseCorrected(abs);
          if (fix !== null && fs.existsSync(abs) === false) {
            result.findings.push({ check: 'links', rule: 'link-case-mismatch', severity: 'error', file: f.rel, line: l.n, message: `link case mismatch: "${target}" (actual: ${fix})`, fix: { kind: 'link-case', from: p, to: fix } });
          } else if (fix !== null) {
            result.findings.push({ check: 'links', rule: 'link-case-mismatch', severity: 'error', file: f.rel, line: l.n, message: `link case mismatch (breaks on Linux CI): "${target}"` });
          } else {
            result.findings.push({ check: 'links', rule: 'broken-link', severity: 'error', file: f.rel, line: l.n, message: `broken link: "${target}" (resolved ${relFromRoot})` });
          }
          continue;
        }
        if (/^plans(\/|$)/.test(relFromRoot)) {
          result.findings.push({ check: 'links', rule: 'link-to-gitignored', severity: 'error', file: f.rel, line: l.n, message: `link into gitignored path plans/: "${target}"` });
          continue;
        }
        if (anchor !== undefined && anchor !== '') {
          if (!/\.md$/i.test(abs) && decoded !== '') continue; // anchors only verifiable in markdown
          let a = anchor;
          try { a = decodeURIComponent(anchor); } catch { /* keep */ }
          if (/^L\d+(-L\d+)?$/.test(a)) continue; // GitHub line anchors
          const set = anchorsFor(abs);
          if (set && !set.has(a) && !set.has(a.toLowerCase())) {
            result.findings.push({ check: 'links', rule: 'broken-anchor', severity: 'error', file: f.rel, line: l.n, message: `broken anchor: "${target}" (no heading "#${a}" in ${toRel(root, abs)})` });
          }
        }
      }
    }
  }
}

// ----------------------------------------------------------- snippet checking
const PLACEHOLDER_ANGLE = /<[A-Za-z][A-Za-z0-9_.-]*(?: [A-Za-z0-9_.-]+)*>/g;

const LANG_MAP = {
  powershell: 'powershell', pwsh: 'powershell', ps1: 'powershell',
  bash: 'bash', sh: 'bash',
  json: 'json', jsonc: 'jsonc',
};

/**
 * JSON policy (conservative -- a doc example must never fail a build for being
 * an illustration):
 *  - ```jsonc            -> comments + trailing commas are accepted; still must be well-formed.
 *  - ```json containing placeholders (`...`, an ellipsis, or `<angle>` tokens outside
 *    the quoted-string-safe case) -> if strict parse fails, the block is SKIPPED, not failed.
 *  - any other ```json that fails JSON.parse -> FAIL; message hints `jsonc` when comments are the cause.
 */
function checkJson(body, lang) {
  const src = body.join('\n');
  const strictOk = () => { try { JSON.parse(src); return null; } catch (e) { return e.message; } };
  if (lang === 'jsonc') {
    const cleaned = stripJsonc(src);
    try { JSON.parse(cleaned); return { status: 'ok' }; } catch (e) {
      if (hasJsonPlaceholder(src)) return { status: 'skipped', reason: 'jsonc with placeholders' };
      return { status: 'fail', message: `invalid JSONC: ${e.message}` };
    }
  }
  const err = strictOk();
  if (err === null) return { status: 'ok' };
  // A fragment that is one or more object members ("key": value, ...) is valid once wrapped.
  if (/^\s*"[^"\n]*"\s*:/.test(src)) {
    try { JSON.parse('{' + src.replace(/,\s*$/, '') + '}'); return { status: 'ok' }; } catch { /* fall through */ }
  }
  // placeholders replaced inside strings still parse -> try that before skipping
  try { JSON.parse(src.replace(PLACEHOLDER_ANGLE, 'x')); return { status: 'ok' }; } catch { /* continue */ }
  if (hasJsonPlaceholder(src)) return { status: 'skipped', reason: 'contains placeholder (...,<name>)' };
  let hint = '';
  try { JSON.parse(stripJsonc(src)); hint = ' (comments/trailing commas -> mark the fence `jsonc`)'; } catch { /* no hint */ }
  return { status: 'fail', message: `invalid JSON: ${err}${hint}` };
}

function hasJsonPlaceholder(src) {
  return /(^|[\s,\[{:])(\.\.\.|…)(\s|,|\]|\}|$)/m.test(src) || PLACEHOLDER_ANGLE.test(src) || /<[A-Za-z][^>\n]*>/.test(src);
}

function stripJsonc(src) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += src[++i] || ''; } else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  return out.replace(/,(\s*[\]}])/g, '$1');
}

function substitutePlaceholders(body) {
  return body.join('\n').replace(PLACEHOLDER_ANGLE, 'Placeholder');
}

let bashProbe;
function bashAvailable() {
  if (bashProbe !== undefined) return bashProbe;
  try {
    const r = childProcess.spawnSync('bash', ['-c', 'echo apc-ok'], { encoding: 'utf8', timeout: 15000 });
    bashProbe = r.status === 0 && /apc-ok/.test(r.stdout || '');
  } catch { bashProbe = false; }
  return bashProbe;
}

function checkBashBatch(items, tmpDir) {
  // items: [{id, src}] -> Map id -> message (only failures)
  const failures = new Map();
  if (items.length === 0) return failures;
  const names = [];
  for (const it of items) {
    const name = `s${it.id}.sh`;
    fs.writeFileSync(path.join(tmpDir, name), it.src.replace(/\r\n/g, '\n'), 'utf8');
    names.push(name);
  }
  const script = 'for f in "$@"; do e=$(bash -n "$f" 2>&1) || { echo "@@FAIL $f"; echo "$e"; }; done';
  const r = childProcess.spawnSync('bash', ['-c', script, '_', ...names], { cwd: tmpDir, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '').split(/\r?\n/);
  let cur = null;
  for (const line of out) {
    const m = /^@@FAIL s(\d+)\.sh$/.exec(line);
    if (m) { cur = Number(m[1]); failures.set(cur, ''); continue; }
    if (cur !== null && line.trim()) {
      const prev = failures.get(cur);
      if (!prev) failures.set(cur, line.replace(/^s\d+\.sh:\s*/, '').trim());
    }
  }
  return failures;
}

let psProbe;
function powershellExe() {
  if (psProbe !== undefined) return psProbe;
  psProbe = null;
  for (const exe of ['pwsh', 'powershell']) {
    try {
      const r = childProcess.spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 30000 });
      if (r.status === 0 && /^\d+/.test((r.stdout || '').trim())) { psProbe = { exe, major: parseInt(r.stdout.trim(), 10) }; break; }
    } catch { /* try next */ }
  }
  return psProbe;
}

const PS_SCRIPT = `param([string]$In,[string]$Out)
$ErrorActionPreference = 'Stop'
$items = Get-Content -Raw -Encoding UTF8 -LiteralPath $In | ConvertFrom-Json
$res = New-Object System.Collections.ArrayList
foreach ($it in $items) {
  $tokens = $null; $errs = $null
  [void][System.Management.Automation.Language.Parser]::ParseInput([string]$it.src, [ref]$tokens, [ref]$errs)
  if ($errs -and $errs.Count -gt 0) {
    [void]$res.Add([pscustomobject]@{ id = [int]$it.id; message = [string]$errs[0].Message; line = [int]$errs[0].Extent.StartLineNumber })
  }
}
$json = ConvertTo-Json -InputObject @($res) -Compress
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
`;

function checkPowerShellBatch(items, tmpDir, ps) {
  const failures = new Map();
  if (items.length === 0) return failures;
  const inFile = path.join(tmpDir, 'ps-in.json');
  const outFile = path.join(tmpDir, 'ps-out.json');
  const scriptFile = path.join(tmpDir, 'ps-parse.ps1');
  fs.writeFileSync(inFile, JSON.stringify(items), 'utf8');
  fs.writeFileSync(scriptFile, '﻿' + PS_SCRIPT, 'utf8');
  const args = ['-NoProfile', '-NonInteractive'];
  if (process.platform === 'win32') args.push('-ExecutionPolicy', 'Bypass');
  args.push('-File', scriptFile, inFile, outFile);
  const r = childProcess.spawnSync(ps.exe, args, { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    throw new Error(`PowerShell parser run failed: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8').replace(/^﻿/, '') || '[]');
  for (const e of Array.isArray(parsed) ? parsed : [parsed]) failures.set(e.id, { message: e.message, line: e.line });
  return failures;
}

function checkSnippets(ctxs, root, result, opts) {
  const inScope = (rel) => rel.startsWith('docs/') || rel.startsWith('.agents/');
  const bash = [];
  const pwsh = [];
  let id = 0;
  for (const f of ctxs) {
    if (!inScope(f.rel)) continue;
    for (const fence of f.parsed.fences) {
      const lang = LANG_MAP[fence.lang];
      if (!lang) continue;
      result.stats.snippets += 1;
      if (fence.unterminated) {
        result.findings.push({ check: 'snippets', rule: 'unterminated-fence', severity: 'error', file: f.rel, line: fence.startLine, message: 'unterminated code fence' });
        continue;
      }
      if (/\bno-?check\b|\bapc-skip\b/i.test(fence.info)) {
        result.skipped.push({ check: 'snippets', file: f.rel, line: fence.startLine, reason: 'fence marked no-check' });
        continue;
      }
      if (lang === 'json' || lang === 'jsonc') {
        const r = checkJson(fence.body, lang);
        if (r.status === 'fail') result.findings.push({ check: 'snippets', rule: 'json-invalid', severity: 'error', file: f.rel, line: fence.startLine, message: r.message });
        else if (r.status === 'skipped') result.skipped.push({ check: 'snippets', file: f.rel, line: fence.startLine, reason: r.reason });
        continue;
      }
      if (fence.body.join('').trim() === '') continue;
      id += 1;
      let src = substitutePlaceholders(fence.body);
      if (lang === 'powershell') src = src.replace(/@{s*...s*}/g, '@{}'); // `@{...}` = elided hashtable
      const entry = { id, file: f.rel, startLine: fence.startLine, src };
      (lang === 'bash' ? bash : pwsh).push(entry);
    }
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-docs-'));
  try {
    if (bash.length > 0) {
      if (!bashAvailable()) {
        result.skipped.push({ check: 'snippets', reason: `bash not available: ${bash.length} bash/sh block(s) not syntax-checked` });
      } else {
        const fails = checkBashBatch(bash, tmp);
        for (const it of bash) {
          if (fails.has(it.id)) result.findings.push({ check: 'snippets', rule: 'bash-syntax', severity: 'error', file: it.file, line: it.startLine, message: `bash -n: ${fails.get(it.id) || 'syntax error'}` });
        }
        result.stats.bashChecked = bash.length;
      }
    }
    if (pwsh.length > 0) {
      const ps = powershellExe();
      if (!ps) {
        result.skipped.push({ check: 'snippets', reason: `no PowerShell (pwsh/powershell) available: ${pwsh.length} powershell block(s) not syntax-checked` });
      } else {
        const fails = checkPowerShellBatch(pwsh.map((p) => ({ id: p.id, src: p.src })), tmp, ps);
        for (const it of pwsh) {
          const fail = fails.get(it.id);
          if (!fail) continue;
          // Windows PowerShell 5.1 cannot parse PS7-only operators; that is not a doc bug.
          if (ps.major < 7 && /(&&|\|\||'\?\?'|'\?\.'|'\?'|ternary)/.test(fail.message) ) {
            result.skipped.push({ check: 'snippets', file: it.file, line: it.startLine, reason: `PowerShell 7 syntax (parsed with ${ps.exe} ${ps.major}): ${fail.message}` });
            continue;
          }
          result.findings.push({ check: 'snippets', rule: 'powershell-syntax', severity: 'error', file: it.file, line: it.startLine + fail.line, message: `PowerShell parser: ${fail.message}` });
        }
        result.stats.powershellChecked = pwsh.length;
        result.stats.powershellParser = `${ps.exe} ${ps.major}`;
      }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------- stale lint
const ALIAS_WORDS = /\balias(es)?\b|\bdeprecated\b|\blegacy\b|short[- ]forms?\b|\bbare\b|shorthand/i;
// "never hardcode ./plugins", "not .agent/", "do not use /plan": a warning against the stale form is not the stale form.
const NEGATION = /\b(?:do not|don't|never|avoid|instead of|rather than|reserved|hard-?code)\b|\bnot\s+[`"']?(?:\.\/plugins|\.agent\/|\/\w)/i;
// A line that enumerates the host-pointer folders (.claude/ .kilocode/ .agent/) names the legacy folder on purpose.
const HOST_LIST = /\.claude[\\/]|\.kilocode[\\/]/;
const BARE_CMD_RE = /(?<![\w/.\-:])\/(dream|plan|design|impl|test|ship|status|resume)(?![\w\-/]|\.\w)/g;

const STALE_RULES = [
  {
    rule: 'bare-primary-command',
    message: (m) => `bare "${m}" used as a primary command; primary form is /apc-${m.replace('/', '')} (mention it only as a noted alias)`,
    find(line) {
      const hits = [];
      let m;
      BARE_CMD_RE.lastIndex = 0;
      while ((m = BARE_CMD_RE.exec(line))) {
        const name = m[1];
        if (new RegExp('/apc-' + name + '\\b').test(line)) continue; // "/apc-plan (alias /plan)"
        if (ALIAS_WORDS.test(line) || NEGATION.test(line)) continue;
        hits.push('/' + name);
      }
      return hits;
    },
  },
  {
    rule: 'singular-agent-dir',
    message: () => 'singular ".agent/" path; canonical directory is ".agents/"',
    find: (line) => (!NEGATION.test(line) && !HOST_LIST.test(line) && /(?<![\w.])\.agent(?![s\w])[\\/]/.test(line) ? ['.agent/'] : []),
    fixable: true,
  },
  {
    rule: 'juce-8',
    message: () => 'stale "JUCE 8" reference; APC targets JUCE 9 (a line that also mentions JUCE 9 is treated as a migration note)',
    find: (line) => (/\bJUCE[ -]?8\b/i.test(line) && !/\bJUCE[ -]?9\b/i.test(line) ? ['JUCE 8'] : []),
  },
  {
    rule: 'visage-not-implemented',
    message: () => 'stale claim that Visage is "not yet implemented"',
    find: (line) => (/Visage[^\n]{0,80}not\s+yet\s+implemented|not\s+yet\s+implemented[^\n]{0,80}Visage/i.test(line) ? ['Visage not yet implemented'] : []),
  },
  {
    rule: 'plugins-dir-assumption',
    message: () => 'hardcoded "./plugins" assumption; resolve via apc.config.json paths.plugins_dir (Get-ApcPaths / apc paths)',
    find: (line) => (!NEGATION.test(line) && /(^|[\s"'`(=])\.\/plugins(?![\w-])/.test(line) ? ['./plugins'] : []),
  },
  {
    rule: 'cmake-glob-plugins',
    message: () => 'hardcoded `file(GLOB PLUGIN_DIRS "plugins/*")`; use APC_PLUGINS_DIR',
    find: (line) => (/file\(\s*GLOB\s+PLUGIN_DIRS\s+"plugins\/\*"\s*\)/i.test(line) ? ['GLOB PLUGIN_DIRS'] : []),
  },
];

function loadAllowlist(root) {
  const p = path.join(root, ALLOWLIST_REL);
  const raw = readText(p);
  if (raw === null) return { entries: [], error: null, path: ALLOWLIST_REL };
  try {
    const j = JSON.parse(raw);
    const entries = Array.isArray(j.allow) ? j.allow : [];
    return { entries, error: null, path: ALLOWLIST_REL };
  } catch (e) {
    return { entries: [], error: ALLOWLIST_REL + ' is not valid JSON: ' + e.message, path: ALLOWLIST_REL };
  }
}

function globToRegex(glob) {
  const esc = glob.replace(/[.+^$\{\}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp('^' + esc + '$');
}

/**
 * Allow-list entry: { rule, file (glob), contains, pattern, reason, debt }.
 * Matches a finding when every given field matches (rule against finding.rule,
 * file against the repo-relative path, contains/pattern against the offending
 * line text plus the message). An entry with no file/contains/pattern never
 * matches -- a bare rule entry would silence a rule globally.
 */
function matchAllow(allow, finding, strict) {
  const hay = (finding.text || '') + '\n' + (finding.message || '');
  for (const e of allow.entries) {
    if (e.debt === true && strict) continue; // --strict: known debt counts as an error again
    if (e.rule && e.rule !== '*' && e.rule !== finding.rule) continue;
    if (e.file && !globToRegex(e.file).test(finding.file)) continue;
    if (e.contains && !hay.includes(e.contains)) continue;
    if (e.pattern) { try { if (!new RegExp(e.pattern, 'i').test(hay)) continue; } catch { continue; } }
    if (!e.file && !e.contains && !e.pattern) continue;
    e.used = true;
    return e;
  }
  return null;
}

function applyAllowlist(result, root, opts) {
  const allow = loadAllowlist(root);
  const kept = [];
  if (allow.error) kept.push({ check: 'stale', rule: 'allowlist-invalid', severity: 'error', file: ALLOWLIST_REL, line: 1, message: allow.error });
  for (const e of allow.entries) {
    if (!e.reason) kept.push({ check: 'stale', rule: 'allowlist-no-reason', severity: 'warning', file: ALLOWLIST_REL, line: 1, message: 'allow-list entry without "reason": ' + JSON.stringify(e).slice(0, 120) });
  }
  for (const finding of result.findings) {
    const hit = finding.severity === 'error' ? matchAllow(allow, finding, result.strict) : null;
    if (!hit) { kept.push(finding); continue; }
    if (hit.debt === true) { result.stats.allowedDebt += 1; result.debt.push({ rule: finding.rule, file: finding.file, line: finding.line, reason: hit.reason || '' }); }
    else result.stats.allowed += 1;
  }
  // only a full run can say an entry is unused
  if (opts.full) {
    for (const e of allow.entries) {
      if (e.used !== true && !(e.debt === true && result.strict)) {
        kept.push({ check: 'stale', rule: 'allowlist-unused', severity: 'warning', file: ALLOWLIST_REL, line: 1, message: 'allow-list entry matched nothing (remove it?): ' + JSON.stringify({ rule: e.rule, file: e.file, contains: e.contains }) });
      }
    }
  }
  result.findings = kept;
}

function checkTables(f, result) {
  // macOS/Linux "local build X" in platform tables
  let header = null;
  let prevRow = null;
  for (const l of f.parsed.lines) {
    if (l.fenced) { header = null; prevRow = null; continue; }
    const isRow = /^\s*\|.*\|\s*$/.test(l.text);
    if (!isRow) { header = null; prevRow = null; continue; }
    const cells = l.text.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) { header = prevRow; continue; }
    prevRow = cells;
    if (!header) continue;
    if (/local\s+build/i.test(cells[0])) {
      cells.forEach((cell, i) => {
        if (i > 0 && /❌/.test(cell) && /mac|linux/i.test(header[i] || '')) {
          pushStale(result, f.rel, l.n, l.text, 'platform-local-build-unsupported', 'table says local build is unsupported on ' + header[i] + '; macOS and Linux build locally');
        }
      });
    }
  }
}

function pushStale(result, rel, n, lineText, rule, message, extra) {
  result.findings.push(Object.assign({ check: 'stale', rule, severity: 'error', file: rel, line: n, message, text: lineText.trim() }, extra || {}));
}

function checkStale(ctxs, root, result) {
  for (const f of ctxs) {
    for (const l of f.parsed.lines) {
      for (const r of STALE_RULES) {
        for (const hit of r.find(l.text)) {
          pushStale(result, f.rel, l.n, l.text, r.rule, r.message(hit), r.fixable ? { fixable: true } : undefined);
        }
      }
    }
    checkTables(f, result);
    // non-table prose: "local build ... X" for macOS/Linux
    for (const l of f.parsed.lines) {
      if (/^\s*\|/.test(l.text)) continue;
      if (/local\s+build/i.test(l.text) && /❌/.test(l.text) && /mac|linux/i.test(l.text)) {
        pushStale(result, f.rel, l.n, l.text, 'platform-local-build-unsupported', 'prose says local build is unsupported on macOS/Linux');
      }
    }
  }
}

// ------------------------------------------------------------------- version
function checkVersion(root, result) {
  const pkgRaw = readText(path.join(root, 'package.json'));
  if (pkgRaw === null) { result.skipped.push({ check: 'version', reason: 'package.json not found' }); return; }
  let version;
  try { version = JSON.parse(pkgRaw).version; } catch { result.findings.push({ check: 'version', rule: 'package-json-invalid', severity: 'error', file: 'package.json', line: 1, message: 'package.json is not valid JSON' }); return; }
  result.stats.version = version;

  // hub/version.js + CMake: delegate to the CLI's own sync logic (exit code is the contract)
  const cli = path.join(root, 'bin', 'apc.js');
  const fallbackCli = path.join(__dirname, '..', 'bin', 'apc.js');
  const cliPath = fs.existsSync(cli) ? cli : fallbackCli;
  if (fs.existsSync(path.join(root, 'hub')) || fs.existsSync(path.join(root, 'CMakeLists.txt'))) {
    const r = childProcess.spawnSync(process.execPath, [cliPath, 'version', 'sync'], { cwd: root, env: Object.assign({}, process.env, { APC_ROOT: root }), encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) {
      const detail = ((r.stderr || '') + (r.stdout || '')).trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ');
      result.findings.push({ check: 'version', rule: 'version-sync', severity: 'error', file: 'hub/version.js|CMakeLists.txt', line: 1, message: `apc version sync exited ${r.status}: ${detail}`, fix: { kind: 'version-sync' } });
    }
  } else {
    result.skipped.push({ check: 'version', reason: 'no hub/ or CMakeLists.txt in root' });
  }

  // README badge: dynamic shields badges (github/package-json/v) always agree; static ones are compared.
  const readme = readText(path.join(root, 'README.md'));
  if (readme !== null) {
    const re = /img\.shields\.io\/badge\/(?:[Vv]ersion|APC|apc)[-_]v?(\d+\.\d+\.\d+)/g;
    let m;
    while ((m = re.exec(readme))) {
      if (m[1] !== version) result.findings.push({ check: 'version', rule: 'readme-badge', severity: 'error', file: 'README.md', line: readme.slice(0, m.index).split('\n').length, message: `README version badge ${m[1]} != package.json ${version}` });
    }
  }
  // package-lock.json: advisory only
  const lockRaw = readText(path.join(root, 'package-lock.json'));
  if (lockRaw !== null) {
    try {
      const lock = JSON.parse(lockRaw);
      if (lock.version && lock.version !== version) result.findings.push({ check: 'version', rule: 'lockfile-version', severity: 'warning', file: 'package-lock.json', line: 1, message: `package-lock.json version ${lock.version} != package.json ${version} (npm install --package-lock-only)` });
    } catch { /* ignore */ }
  }
}

// ----------------------------------------------------------------- fix-safe
function applyFixSafe(root, result) {
  const applied = [];
  const byFile = new Map();
  for (const f of result.findings) {
    if (f.fixable && f.rule === 'singular-agent-dir') {
      if (!byFile.has(f.file)) byFile.set(f.file, new Set());
      byFile.get(f.file).add(f.line);
    }
  }
  for (const [rel, lineSet] of byFile) {
    const p = path.join(root, rel);
    const text = fs.readFileSync(p, 'utf8');
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    let changed = 0;
    for (const n of lineSet) {
      const before = lines[n - 1];
      const after = before.replace(/(?<![\w.])\.agent(?![s\w])([\\/])/g, '.agents$1');
      if (after !== before) { lines[n - 1] = after; changed += 1; }
    }
    if (changed) { fs.writeFileSync(p, lines.join(eol)); applied.push(`${rel}: .agent/ -> .agents/ on ${changed} line(s)`); }
  }
  for (const f of result.findings) {
    if (f.fix && f.fix.kind === 'link-case') {
      const p = path.join(root, f.file);
      const text = fs.readFileSync(p, 'utf8');
      const next = text.split('](' + f.fix.from).join('](' + f.fix.to);
      if (next !== text) { fs.writeFileSync(p, next); applied.push(`${f.file}: link case ${f.fix.from} -> ${f.fix.to}`); }
    }
  }
  if (result.findings.some((f) => f.fix && f.fix.kind === 'version-sync')) {
    const cli = path.join(root, 'bin', 'apc.js');
    const r = childProcess.spawnSync(process.execPath, [fs.existsSync(cli) ? cli : path.join(__dirname, '..', 'bin', 'apc.js'), 'version', 'sync', '--fix'], { cwd: root, env: Object.assign({}, process.env, { APC_ROOT: root }), encoding: 'utf8' });
    if (r.status === 0) applied.push('version sync --fix');
  }
  return applied;
}

// ---------------------------------------------------------------------- main
/**
 * @param {string} root
 * @param {{only?:string[], files?:string[]}} opts
 */
function check(root, opts) {
  opts = opts || {};
  dirCache.clear();
  const only = (opts.only && opts.only.length) ? opts.only : ALL_CHECKS;
  const result = {
    schema: SCHEMA, root, checks: only, strict: !!opts.strict, findings: [], skipped: [], external: [], debt: [],
    stats: { files: 0, snippets: 0, allowed: 0, allowedDebt: 0 },
  };
  let files = collectFiles(root);
  if (opts.files && opts.files.length) {
    const want = new Set(opts.files.map((f) => toRel(root, path.resolve(root, f))));
    files = files.filter((f) => want.has(toRel(root, f)));
  }
  const ctxs = files.map((abs) => ({ abs, rel: toRel(root, abs), parsed: parseMarkdown(readText(abs) || '') }));
  result.stats.files = ctxs.length;
  if (only.includes('links')) checkLinks(ctxs, root, result);
  if (only.includes('snippets')) checkSnippets(ctxs, root, result);
  if (only.includes('stale')) checkStale(ctxs, root, result);
  if (only.includes('version')) checkVersion(root, result);
  applyAllowlist(result, root, { full: !(opts.files && opts.files.length) && only.length === ALL_CHECKS.length });
  result.summary = {
    errors: result.findings.filter((f) => f.severity === 'error').length,
    warnings: result.findings.filter((f) => f.severity === 'warning').length,
    skipped: result.skipped.length,
    external: result.external.length,
    byRule: result.findings.reduce((acc, f) => { acc[f.rule] = (acc[f.rule] || 0) + 1; return acc; }, {}),
  };
  return result;
}

function usage() {
  return 'Usage: apc docs check [files...] [--json] [--external] [--fix-safe] [--strict] [--only links,snippets,stale,version]';
}

function run(args, ctx) {
  const root = (ctx && ctx.root) ? ctx.root : path.resolve(__dirname, '..');
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : 'check';
  const rest = args[0] && !args[0].startsWith('--') ? args.slice(1) : args;
  if (sub !== 'check') { console.error(usage()); return 2; }
  const asJson = rest.includes('--json');
  const showExternal = rest.includes('--external');
  const fixSafe = rest.includes('--fix-safe');
  const strict = rest.includes('--strict');
  let only = null;
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--only') { only = (rest[++i] || '').split(',').filter(Boolean); continue; }
    if (a.startsWith('--')) { if (!['--json', '--external', '--fix-safe', '--strict'].includes(a)) { console.error(`Unknown flag: ${a}\n${usage()}`); return 2; } continue; }
    files.push(a);
  }
  if (only && only.some((o) => !ALL_CHECKS.includes(o))) { console.error(`--only accepts: ${ALL_CHECKS.join(',')}\n${usage()}`); return 2; }

  let result = check(root, { only, files, strict });
  let applied = [];
  if (fixSafe) {
    applied = applyFixSafe(root, result);
    if (applied.length) result = check(root, { only, files, strict });
  }

  if (asJson) {
    const out = Object.assign({}, result, { fixesApplied: applied });
    if (!showExternal) out.external = [];
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`apc docs check -- ${result.stats.files} markdown file(s), ${result.stats.snippets} code snippet(s) [${result.checks.join(', ')}]`);
    for (const a of applied) console.log(`  fixed: ${a}`);
    const groups = new Map();
    for (const f of result.findings) {
      if (!groups.has(f.check)) groups.set(f.check, []);
      groups.get(f.check).push(f);
    }
    for (const [name, list] of groups) {
      console.log('');
      console.log(`${name.toUpperCase()} (${list.length})`);
      for (const f of list) console.log(`  ${f.severity === 'error' ? 'x' : '!'} ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
    }
    if (result.skipped.length) {
      const generic = result.skipped.filter((s) => !s.file);
      for (const s of generic) console.log(`\n  skipped: ${s.reason}`);
      const placeholders = result.skipped.filter((s) => s.file).length;
      if (placeholders) console.log(`\n  ${placeholders} item(s) skipped as non-checkable placeholders/PS7-only (use --json for the list)`);
    }
    if (showExternal) {
      console.log('');
      console.log(`EXTERNAL LINKS (${result.external.length}, not fetched)`);
      for (const e of result.external) console.log(`  ${e.file}:${e.line}  ${e.url}`);
    }
    console.log('');
    const s = result.summary;
    console.log(s.errors === 0 ? `OK: no errors (${s.warnings} warning(s), ${s.skipped} skipped, ${result.stats.allowed} allow-listed, ${result.stats.allowedDebt} known-debt)` : `FAIL: ${s.errors} error(s), ${s.warnings} warning(s), ${s.skipped} skipped, ${result.stats.allowed} allow-listed, ${result.stats.allowedDebt} known-debt`);
  }
  return result.summary.errors > 0 ? 1 : 0;
}

module.exports = { run, check, parseMarkdown, slugify, collectAnchors, checkJson, stripJsonc };
