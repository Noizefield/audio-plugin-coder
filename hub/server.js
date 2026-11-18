'use strict';
/**
 * APC Hub - local dashboard server (zero dependencies, Node stdlib only).
 *
 * Serves hub/ui/ static files plus the JSON API under /api/v1/*, and the
 * read-only KIT gallery routes (/kit/<file>, /kit-theme/<id>.css, /kit-demo/<component>).
 * Binds loopback only. GET only, except the documented write paths
 * (POST /api/v1/config incl. the global "standards" block, and
 * POST /api/v1/plugins/:name/annotations, and
 * POST /api/v1/design/:id/tuning); those additionally require a
 * loopback peer/Host/Origin. Inline scripts run only on the repository-owned,
 * self-contained canonical design reference route; no arbitrary script or network access.
 *
 * Usage:
 *   node hub/server.js [--port 4872] [--no-open] [--repo <path>]
 *   (--port 0 = ephemeral port; APC_ROOT overrides the default repo root)
 *
 * Canonical paths resolve like scripts/lib/Get-ApcPaths.ps1:
 * relative apc.config.json paths resolve from the repo root.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const kitTuning = require('./kit-tuning');

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const PORT_ARG = parseInt(flag('--port', '4872'), 10);
const PORT = Number.isInteger(PORT_ARG) && PORT_ARG >= 0 ? PORT_ARG : 4872; // 0 = ephemeral (tests)
const NO_OPEN = args.includes('--no-open');
const HUB_DIR = __dirname;
// --repo wins, then APC_ROOT (same override bin/apc.js and the test suite use), then the checkout.
const REPO_ROOT = path.resolve(flag('--repo', process.env.APC_ROOT || path.join(HUB_DIR, '..')));
const STANDARDS_LIB = path.join(HUB_DIR, '..', 'scripts', 'apc-standards.js');
const UI_DIR = path.join(HUB_DIR, 'ui');
const VERSION = '1.1.0'; // hub server version (APC framework version comes from package.json)

// ─── Small helpers ──────────────────────────────────────────────────────────
function readJson(p, fallback) {
  try {
    // Strip UTF-8 BOM: PowerShell-written JSON (e.g. apc.config.json) starts
    // with EF BB BF, which JSON.parse rejects ("Unexpected token '﻿'").
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
function listFiles(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
// Safe dynamic segment: no separators, no "..", stays inside base.
function safeJoin(base, name) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(name)) return null;
  const full = path.resolve(base, name);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}
function resolveFromRoot(p) {
  if (!p || typeof p !== 'string') return null;
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(REPO_ROOT, p);
}

// ─── Config (mirrors Get-ApcPaths.ps1 resolution) ───────────────────────────
function loadConfig() {
  const livePath = path.join(REPO_ROOT, 'apc.config.json');
  const examplePath = path.join(REPO_ROOT, 'apc.config.example.json');
  let live = null;
  let liveError = 'file-missing';
  try {
    const raw = fs.readFileSync(livePath, 'utf8').replace(/^\uFEFF/, '');
    try {
      live = JSON.parse(raw);
      liveError = null;
    } catch (e) {
      liveError = 'parse-fail: ' + (e && e.message ? e.message : String(e)).slice(0, 120);
    }
  } catch {
    liveError = 'file-missing';
  }
  const example = readJson(examplePath, null);
  const cfg = live || example || {};
  const rel = (cfg.paths || {});
  const pluginsRel = rel.plugins_dir || 'plugins';
  const buildRel = rel.build_dir || 'build';
  const releaseRel = rel.release_dir || 'release';
  const resolved = {
    plugins: resolveFromRoot(pluginsRel),
    build: resolveFromRoot(buildRel),
    release: resolveFromRoot(releaseRel),
  };
  return {
    live, example,
    livePresent: !!live,
    liveError,
    rel: { plugins: pluginsRel, build: buildRel, release: releaseRel },
    resolved,
    exists: {
      plugins: !!resolved.plugins && isDir(resolved.plugins),
      build: !!resolved.build && isDir(resolved.build),
      release: !!resolved.release && isDir(resolved.release),
    },
  };
}
function packageVersion() {
  const pkg = readJson(path.join(REPO_ROOT, 'package.json'), {});
  return typeof pkg.version === 'string' ? pkg.version : 'dev';
}

// ─── Data builders ──────────────────────────────────────────────────────────
function pluginSummary(dir, name, source) {
  const statusPath = path.join(dir, name, 'status.json');
  const st = readJson(statusPath, null);
  if (!st) return { name, source, present: true, status: false };
  const v = st.validation || {};
  const keys = Object.keys(v);
  const ok = keys.filter((k) => v[k] === true).length;
  return {
    name: st.plugin_name || name,
    source,
    present: true,
    status: true,
    version: st.version || null,
    phase: st.current_phase || null,
    framework: st.ui_framework || null,
    complexity: typeof st.complexity_score === 'number' ? st.complexity_score : null,
    lastModified: st.last_modified || null,
    createdAt: st.created_at || null,
    phaseHistory: Array.isArray(st.phase_history) ? st.phase_history.length : 0,
    lastPhaseAt: Array.isArray(st.phase_history) && st.phase_history.length
      ? st.phase_history[st.phase_history.length - 1].completed_at || null
      : null,
    validation: { total: keys.length, passed: ok, flags: v },
    errors: Array.isArray((st.error_recovery || {}).error_log)
      ? st.error_recovery.error_log.length : 0,
  };
}

function getPlugins() {
  const cfg = loadConfig();
  const out = [];
  const seen = new Set();
  const repoLocal = path.join(REPO_ROOT, 'plugins');
  for (const n of listDirs(repoLocal)) {
    if (n.startsWith('.')) continue;
    seen.add(n);
    out.push(pluginSummary(repoLocal, n, 'repo-local:plugins/'));
  }
  if (cfg.resolved.plugins && path.resolve(cfg.resolved.plugins) !== path.resolve(repoLocal)) {
    for (const n of listDirs(cfg.resolved.plugins)) {
      if (n.startsWith('.') || seen.has(n)) continue;
      seen.add(n);
      out.push(pluginSummary(cfg.resolved.plugins, n, 'configured:' + cfg.rel.plugins));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { configuredDir: cfg.rel.plugins, resolvedDir: cfg.resolved.plugins, dirExists: cfg.exists.plugins, plugins: out };
}

function getPluginDetail(name) {
  const cfg = loadConfig();
  const repoLocal = path.join(REPO_ROOT, 'plugins');
  let dir = safeJoin(repoLocal, name);
  let source = 'repo-local:plugins/';
  if ((!dir || !exists(path.join(dir, 'status.json'))) && cfg.resolved.plugins) {
    const alt = safeJoin(cfg.resolved.plugins, name);
    if (alt && exists(path.join(alt, 'status.json'))) {
      dir = alt;
      source = 'configured:' + cfg.rel.plugins;
    }
  }
  if (!dir) return null;
  const st = readJson(path.join(dir, 'status.json'), null);
  if (!st) return null;
  return {
    source,
    status: st,
    artifacts: {
      ideas: listFiles(path.join(dir, '.ideas')),
      design: listFiles(path.join(dir, 'Design')),
      source: listFiles(path.join(dir, 'Source')),
    },
  };
}

const LEGACY_SKILLS = new Set([
  'skill_ideation', 'skill_planning', 'skill_design',
  'skill_implementation', 'skill_packaging', 'skill_debug',
]);
function isAliasStub(dir) {
  try {
    const first = (fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').split(/\r?\n/)[0] || '').trim();
    return first.startsWith('# Alias:');
  } catch {
    return false;
  }
}
function getSkills() {
  const base = path.join(REPO_ROOT, '.agents', 'skills');
  return listDirs(base).map((n) => {
    const dir = path.join(base, n);
    const has = exists(path.join(dir, 'SKILL.md'));
    const isLegacy = LEGACY_SKILLS.has(n);
    return {
      id: n,
      hasSkillMd: has,
      files: listFiles(dir),
      legacy: isLegacy,
      aliasStub: isLegacy && has && isAliasStub(dir),
    };
  });
}

function parseFrontmatter(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
      if (kv) out[kv[1]] = kv[2];
    }
    return out;
  } catch {
    return {};
  }
}
function getCommands() {
  const base = path.join(REPO_ROOT, '.agents', 'workflows');
  const files = listFiles(base).filter((f) => f.endsWith('.md'));
  const primaries = [];
  const aliases = [];
  for (const f of files) {
    const fm = parseFrontmatter(path.join(base, f));
    const name = '/' + f.replace(/\.md$/, '');
    const desc = fm.description || '';
    const body = (() => { try { return fs.readFileSync(path.join(base, f), 'utf8'); } catch { return ''; } })();
    const aliasTo = (body.match(/\.agents\/workflows\/(apc-[\w-]+)\.md/) || [])[1] || null;
    if (f.startsWith('apc-')) primaries.push({ command: '/apc-' + f.slice(4, -3), file: f, description: desc });
    else aliases.push({ command: name, file: f, description: desc, pointsTo: aliasTo ? '/apc-' + aliasTo.slice(4) : null, resolves: aliasTo ? exists(path.join(base, aliasTo + '.md')) : false });
  }
  primaries.sort((a, b) => a.command.localeCompare(b.command));
  aliases.sort((a, b) => a.command.localeCompare(b.command));
  return { primaries, aliases };
}

function findHtmlFiles(base, rel, depth, acc) {
  if (depth < 0) return acc;
  let entries = [];
  try { entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rp = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) findHtmlFiles(base, rp, depth - 1, acc);
    else if (/\.html?$/i.test(e.name)) acc.push(rp);
  }
  return acc;
}
function getDesigns() {
  const manifestPath = path.join(REPO_ROOT, 'design_library', 'manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) return { present: false, designs: [] };
  const designs = (manifest.designs || []).map((d) => {
    const dir = path.join(REPO_ROOT, 'design_library', d.path || d.id);
    const htmlFiles = findHtmlFiles(dir, '', 2, []).sort();
    const claimed = ((d.examples || {}).webview || []).concat((d.examples || {}).visage || []);
    const missingExamples = claimed.filter((f) => !exists(path.join(dir, f)));
    const tokens = typeof d.tokens === 'string' ? d.tokens : null;
    const spec = typeof d.spec === 'string' ? d.spec : null;
    return {
      ...d,
      tokens,
      spec,
      tokensExists: !!tokens && exists(path.join(dir, tokens)),
      specExists: !!spec && exists(path.join(dir, spec)),
      dirExists: isDir(dir),
      htmlFiles,
      missingExamples,
    };
  });
  return { present: true, version: manifest.version || null, lastUpdated: manifest.lastUpdated || null, totalDesigns: manifest.totalDesigns || designs.length, designs };
}

function firstCommentLine(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/).slice(0, 25)) {
      const line = raw.trim();
      if (!line) continue;
      if (/^REM\b/i.test(line) || line.startsWith('::')) return line.replace(/^(REM|::)\s*/i, '').slice(0, 120);
      if (line.startsWith('#') && !line.startsWith('#!')) return line.replace(/^#+\s*/, '').slice(0, 120);
      if (line.startsWith('<#')) return line.replace(/^<#+\s*/, '').slice(0, 120);
      if (/^(function|param|echo|@echo|set|if|for)\b/i.test(line)) continue;
      break;
    }
  } catch { /* ignore */ }
  return null;
}
function walkScripts(relDir, acc) {
  const abs = path.join(REPO_ROOT, 'scripts', relDir);
  for (const f of listFiles(abs)) {
    const ext = path.extname(f).toLowerCase();
    const platform = ext === '.ps1' ? 'ps1' : ext === '.sh' ? 'sh' : ext === '.bat' ? 'bat' : ext === '.exe' ? 'exe' : ext.slice(1) || 'file';
    let size = null;
    try { size = fs.statSync(path.join(abs, f)).size; } catch { /* ignore */ }
    acc.push({ group: relDir || 'root', file: f, platform, size, synopsis: firstCommentLine(path.join(abs, f)) });
  }
  if (!relDir) {
    for (const d of ['lib', 'installer', 'codex']) walkScripts(d, acc);
  }
  return acc;
}
function getScripts() {
  const entries = walkScripts('', []);
  entries.sort((a, b) => (a.group + a.file).localeCompare(b.group + b.file));
  return { root: 'scripts/', total: entries.length, entries };
}

function treeCounts(dir, depth) {
  const out = { files: 0, dirs: {} };
  if (depth < 0) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.dirs[e.name] = treeCounts(path.join(dir, e.name), depth - 1);
    else out.files += 1;
  }
  return out;
}
function getTemplates() {
  const base = path.join(REPO_ROOT, 'templates');
  const groups = {};
  for (const d of listDirs(base)) {
    const t = treeCounts(path.join(base, d), 2);
    groups[d] = { files: t.files + Object.values(t.dirs).reduce((n, s) => n + s.files, 0), subdirs: Object.keys(t.dirs).sort() };
  }
  const rootFiles = listFiles(base);
  return { root: 'templates/', rootFiles, groups };
}

let toolCache = null;
let toolCacheAt = 0;
function runVer(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const line = String(stdout || '').split(/\r?\n/).find((l) => l.trim());
      resolve(line ? line.trim().slice(0, 80) : null);
    });
  });
}
async function getTools() {
  const now = Date.now();
  if (toolCache && now - toolCacheAt < 60000) return toolCache;
  const cfg = loadConfig();
  const jucePin = (cfg.live && cfg.live.juce && cfg.live.juce.pin)
    || (cfg.example && cfg.example.juce && cfg.example.juce.pin) || null;
  const enableVisage = !!(cfg.live && cfg.live.defaults && cfg.live.defaults.enable_visage);
  const [python, cmake] = await Promise.all([
    runVer('python', ['--version']),
    runVer('cmake', ['--version']),
  ]);
  toolCache = {
    juce: { path: '_tools/JUCE', present: isDir(path.join(REPO_ROOT, '_tools', 'JUCE')), pin: jucePin },
    pluginval: pluginvalInfo(),
    visage: { path: '_tools/visage', present: isDir(path.join(REPO_ROOT, '_tools', 'visage')), enabled: enableVisage },
    debugView: { path: '_tools/DebugView', present: isDir(path.join(REPO_ROOT, '_tools', 'DebugView')) },
    toolchain: { node: process.version, python, cmake },
  };
  toolCacheAt = now;
  return toolCache;
}

// pluginval ships per-OS: Windows builds pluginval.exe from the
// _tools/pluginval submodule; macOS/Linux use the prebuilt release under
// _tools/pluginval_bin (see scripts/test-plugin.sh). A hardcoded .exe path
// reports MISSING forever on Mac/Linux.
function pluginvalInfo() {
  const segs = process.platform === 'win32'
    ? ['_tools', 'pluginval', 'pluginval.exe']
    : process.platform === 'darwin'
      ? ['_tools', 'pluginval_bin', 'pluginval.app', 'Contents', 'MacOS', 'pluginval']
      : ['_tools', 'pluginval_bin', 'pluginval'];
  return { path: segs.join('/'), present: exists(path.join(REPO_ROOT, ...segs)) };
}

function docHeadings(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { title: null, h2: [], h1h3: 0 }; }
  let title = null;
  const h2 = [];
  let h1h3 = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^#{1,3} /.test(line)) h1h3 += 1;
    if (!title && line.startsWith('# ')) title = line.slice(2).trim();
    const m = line.match(/^## (.+)$/);
    if (m) h2.push(m[1].trim());
  }
  return { title, h2, h1h3 };
}
function getDocs() {
  const base = path.join(REPO_ROOT, 'docs');
  const docs = listFiles(base)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { title, h2, h1h3 } = docHeadings(path.join(base, f));
      let size = null;
      try { size = fs.statSync(path.join(base, f)).size; } catch { /* ignore */ }
      return { id: f.replace(/\.md$/, ''), file: f, title: title || f, chapters: h2, chapterCount: h2.length, headingCount: h1h3, size };
    });
  docs.sort((a, b) => a.file.localeCompare(b.file));
  return { root: 'docs/', total: docs.length, totalChapters: docs.reduce((n, d) => n + d.chapterCount, 0), docs };
}
function getDocRaw(id) {
  const base = path.join(REPO_ROOT, 'docs');
  const full = safeJoin(base, id + '.md');
  if (!full || !exists(full)) return null;
  try {
    return { id, file: id + '.md', raw: fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '') };
  } catch {
    return null;
  }
}

let updateCache = null;
let updateCacheAt = 0;
function fetchLatestRelease() {
  return new Promise((resolve) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: '/repos/Noizefield/audio-plugin-coder/releases/latest',
      headers: { 'User-Agent': 'apc-hub', Accept: 'application/vnd.github+json' },
      timeout: 6000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const j = JSON.parse(body);
            return resolve({ tag: j.tag_name || null, url: j.html_url || null });
          } catch { return resolve({ error: 'bad-upstream-json' }); }
        }
        if (res.statusCode === 404) return resolve({ none: true });
        resolve({ error: 'upstream-http-' + res.statusCode });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: String((e && e.code) || 'network') }));
  });
}
function semverLess(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== x || y !== y) return null; // non-numeric
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
async function getUpdate() {
  const now = Date.now();
  if (updateCache && now - updateCacheAt < 24 * 3600 * 1000) return updateCache;
  const installed = packageVersion();
  const up = await fetchLatestRelease();
  let out;
  if (up.error) {
    out = { installed, upstream: null, state: 'UNCHECKED', reason: up.error };
  } else if (up.none || !up.tag) {
    // No releases published: nothing newer can exist, so the installed
    // version counts as current (green), with the reason shown.
    out = { installed, upstream: null, state: 'CURRENT', reason: 'no upstream releases' };
  } else {
    const norm = String(up.tag).replace(/^v/, '');
    const cmp = semverLess(installed, norm);
    if (cmp === null) out = { installed, upstream: up.tag, url: up.url, state: 'UNCHECKED', reason: 'non-semver-tag' };
    else if (cmp) out = { installed, upstream: up.tag, url: up.url, state: 'AVAILABLE' };
    else out = { installed, upstream: up.tag, url: up.url, state: 'CURRENT' };
  }
  updateCache = out;
  updateCacheAt = now;
  return out;
}

function getConsistency() {
  const checks = [];
  const commandsEmpty = listFiles(path.join(REPO_ROOT, 'commands')).length === 0
    && listDirs(path.join(REPO_ROOT, 'commands')).length === 0;
  checks.push({ id: 'root-commands', label: 'root commands/ empty → pointer: use .agents/workflows', level: commandsEmpty ? 'na' : 'warn' });
  const rootSkills = listFiles(path.join(REPO_ROOT, 'skills'));
  checks.push({ id: 'root-skills', label: 'root skills/ = ' + (rootSkills.length ? rootSkills.join(', ') : 'empty'), level: 'na' });
  const skillsBase = path.join(REPO_ROOT, '.agents', 'skills');
  const legacy = listDirs(skillsBase).filter((d) => LEGACY_SKILLS.has(d));
  const liveLegacy = legacy.filter((d) => !isAliasStub(path.join(skillsBase, d)));
  checks.push({ id: 'legacy-skills', label: liveLegacy.length ? 'legacy skill_* dirs with real content: ' + liveLegacy.join(', ') : (legacy.length ? 'legacy skill_* dirs, all alias stubs kept as redirects: ' + legacy.join(', ') : 'no legacy skill dirs'), level: liveLegacy.length ? 'warn' : 'ok' });
  const wfBase = path.join(REPO_ROOT, '.agents', 'workflows');
  const broken = [];
  for (const f of listFiles(wfBase).filter((f) => f.endsWith('.md') && !f.startsWith('apc-'))) {
    let body = '';
    try { body = fs.readFileSync(path.join(wfBase, f), 'utf8'); } catch { /* ignore */ }
    const m = body.match(/\.agents\/workflows\/(apc-[\w-]+)\.md/);
    if (!m || !exists(path.join(wfBase, m[1] + '.md'))) broken.push(f);
  }
  checks.push({ id: 'alias-refs', label: broken.length ? 'broken alias pointers: ' + broken.join(', ') : 'alias pointers resolve', level: broken.length ? 'warn' : 'ok' });
  const cfg = loadConfig();
  for (const k of ['plugins', 'build', 'release']) {
    checks.push({ id: 'dir-' + k, label: cfg.rel[k] + (cfg.exists[k] ? ' exists' : ' NOT FOUND'), level: cfg.exists[k] ? 'ok' : 'fail' });
  }
  let banner = null;
  try {
    const setupJs = fs.readFileSync(path.join(REPO_ROOT, 'bin', 'setup.js'), 'utf8');
    const hard = setupJs.match(/APC v(\d+\.\d+\.\d+)/);
    banner = hard ? hard[1] : (/package\.json/.test(setupJs) ? 'dynamic-from-package.json' : null);
  } catch { /* ignore */ }
  const installed = packageVersion();
  const match = banner === null ? null : (banner === 'dynamic-from-package.json' ? true : banner === installed);
  checks.push({
    id: 'version-match',
    label: 'package.json ' + installed + (banner === null ? ' vs setup.js banner unknown' : ' = setup.js banner (' + banner + ')'),
    level: match === null ? 'na' : (match ? 'ok' : 'fail'),
  });
  const manifest = readJson(path.join(REPO_ROOT, 'design_library', 'manifest.json'), null);
  for (const d of ((manifest && manifest.designs) || [])) {
    const claimed = ((d.examples || {}).webview || []).concat((d.examples || {}).visage || [])
      .concat([d.tokens, d.spec].filter((f) => typeof f === 'string' && f));
    const missing = claimed.filter((f) => !exists(path.join(REPO_ROOT, 'design_library', d.path || d.id, f)));
    if (missing.length) {
      checks.push({ id: 'design-' + d.id, label: 'manifest claims missing file(s): ' + missing.join(', '), level: 'warn' });
    }
  }
  return { checks };
}

// ─── Product standards (apc-standards/1.0) ──────────────────────────────────
// Registry: schemas/apc-standards.json. Global block: apc.config.json "standards".
// Per-plugin block: <plugin>/status.json "standards". All logic lives in
// scripts/apc-standards.js; the Hub only reads it (GET) and validates the
// global block on the single config write path.
const STANDARDS_REGISTRY_REL = 'schemas/apc-standards.json';
let standardsLib = null;
function loadStandardsLib() {
  if (standardsLib) return standardsLib;
  standardsLib = require(STANDARDS_LIB);
  return standardsLib;
}
function plainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function stripEffective(map) {
  const out = {};
  for (const [id, e] of Object.entries(map)) out[id] = { value: e.value, source: e.source };
  return out;
}
function getStandards() {
  let std;
  let registry;
  try {
    std = loadStandardsLib();
    registry = std.loadRegistry(REPO_ROOT);
  } catch (e) {
    return {
      registryFound: false,
      expected: STANDARDS_REGISTRY_REL,
      error: String((e && e.message) || e).slice(0, 200),
    };
  }
  const cfg = loadConfig();
  const globalBlock = plainObject(cfg.live && cfg.live.standards) ? cfg.live.standards : {};
  const globalValidation = std.validateBlock(registry, globalBlock, { scope: 'global', warnOpen: true });
  const sources = {
    default: STANDARDS_REGISTRY_REL,
    global: 'apc.config.json',
    plugin: '<plugin>/status.json',
  };
  const plugins = [];
  const seen = new Set();
  const dirs = [{ dir: path.join(REPO_ROOT, 'plugins'), source: 'repo-local:plugins/' }];
  if (cfg.resolved.plugins && path.resolve(cfg.resolved.plugins) !== path.resolve(dirs[0].dir)) {
    dirs.push({ dir: cfg.resolved.plugins, source: 'configured:' + cfg.rel.plugins });
  }
  for (const d of dirs) {
    for (const name of listDirs(d.dir)) {
      if (name.startsWith('.') || seen.has(name)) continue;
      const st = readJson(path.join(d.dir, name, 'status.json'), null);
      if (!st) continue;
      seen.add(name);
      const block = plainObject(st.standards) ? st.standards : {};
      const v = std.validateBlock(registry, block, { scope: 'plugin', requireRequired: true, warnOpen: true });
      plugins.push({
        name: st.plugin_name || name,
        dirName: name,
        source: d.source,
        statusFile: name + '/status.json',
        block,
        issues: v.issues,
        warnings: v.warnings,
        effective: stripEffective(std.resolveEffective(registry, globalBlock, block)),
      });
    }
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return {
    registryFound: true,
    registryFile: STANDARDS_REGISTRY_REL,
    schema: registry.schema || null,
    version: registry.version || null,
    locked: registry.locked || null,
    title: registry.title || null,
    fixedRules: Array.isArray(registry.fixed_rules) ? registry.fixed_rules : [],
    groups: std.groupedOptions(registry),
    sources,
    global: {
      file: 'apc.config.json',
      livePresent: cfg.livePresent,
      liveError: cfg.liveError,
      block: globalBlock,
      issues: globalValidation.issues,
      warnings: globalValidation.warnings,
      effective: stripEffective(std.resolveEffective(registry, globalBlock, {})),
    },
    plugins,
    writable: { scope: 'global', via: 'POST /api/v1/config', note: 'plugin-scope answers are decided in /apc-plan; change them with the CLI' },
  };
}

// Strict JSON-type check for values the Hub writes. validateBlock() coerces
// CLI strings ("yes", "1") - the Hub only ever stores typed JSON values.
function standardsTypeIssue(option, raw) {
  if (raw === null) return option.default === null ? null : 'a value is required';
  switch (option.type) {
    case 'boolean': return typeof raw === 'boolean' ? null : 'expected a JSON boolean';
    case 'number': return typeof raw === 'number' && Number.isFinite(raw) ? null : 'expected a JSON number';
    case 'enum':
    case 'string':
    default: return typeof raw === 'string' ? null : 'expected a JSON string';
  }
}
// Returns {ok:true, block} (normalised, typed) or {ok:false, error, issues}.
function validateStandardsForWrite(block) {
  if (!plainObject(block)) return { ok: false, error: 'invalid-standards-shape', issues: [{ id: null, message: '"standards" must be a JSON object' }] };
  let std;
  let registry;
  try {
    std = loadStandardsLib();
    registry = std.loadRegistry(REPO_ROOT);
  } catch (e) {
    if (Object.keys(block).length === 0) return { ok: true, block: {} };
    return { ok: false, error: 'standards-registry-missing', issues: [{ id: null, message: STANDARDS_REGISTRY_REL + ' not found - cannot validate' }] };
  }
  const issues = [];
  for (const [id, raw] of Object.entries(block)) {
    const option = std.optionById(registry, id);
    if (!option) continue; // validateBlock reports unknown ids
    const t = standardsTypeIssue(option, raw);
    if (t) issues.push({ id, message: '"' + id + '": ' + t });
  }
  const res = std.validateBlock(registry, block, { scope: 'global' });
  for (const i of res.issues) issues.push(i);
  if (issues.length) return { ok: false, error: 'invalid-standards', issues };
  const out = {};
  for (const [id, raw] of Object.entries(block)) {
    const c = std.coerceValue(std.optionById(registry, id), raw);
    out[id] = c.value;
  }
  return { ok: true, block: out };
}

// ─── UI kit gallery (KIT page) ──────────────────────────────────────────────
// Read-only presentation of templates/webview/apc-ui/ (the style-neutral WebView
// UI kit). Routes (all GET):
//   /api/v1/kit                     catalog JSON (hub/kit-catalog.json + facts derived from the kit files)
//   /kit/<file>                     allow-listed kit *.js / *.css only (no tests/, no .md)
//   /kit-theme/<id>.css             design_library/<id>/tokens.css served as-is (fallback: tokens derived from design-system.json)
//   /kit-demo/<component>?theme=&scenario=&mode=   self-contained demo page (CSP default-src 'self')
//   /kit-demo/_early.js|_setup.js|_post.js         the three tiny boot scripts of a demo page
// No write path, no script execution outside the demo's own sandboxed page.
const KIT_REL = 'templates/webview/apc-ui';
const KIT_CATALOG_REL = 'hub/kit-catalog.json';
const KIT_CATALOG_FILE = path.join(HUB_DIR, 'kit-catalog.json');
const KIT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(js|css)$/;
const KIT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const KIT_COMPONENT_RE = /^[a-z][a-z0-9-]*$/;
const KIT_CORE_SCRIPTS = ['apc-fit.js', 'apc-kit.js', 'apc-mock.js'];
// stylesheets of every demo page, in cascade order (the theme's tokens.css comes after them). The component scripts
// (apc-controls.js, apc-widgets.js, apc-viz.js, apc-mock-viz.js ...) are listed per component in the catalog demo.scripts.
const KIT_DEMO_CSS = ['apc-core.css', 'apc-components.css', 'apc-widgets.css', 'apc-viz.css'];
const KIT_FALLBACK_SCENARIOS = ['demo', 'trial', 'licensed', 'unverified', 'update-available', 'update-failed', 'io-error'];
const KIT_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
// The canonical annotated APC face is self-contained and has inline CSS/JS.
// Keep the normal component-demo CSP strict; allow inline scripts only on this
// exact, repository-owned design source route.
const KIT_REFERENCE_CSP = KIT_CSP.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline';");

function kitDir() {
  return path.join(REPO_ROOT, ...KIT_REL.split('/'));
}
// The allow-list IS the directory listing filtered by KIT_FILE_RE: plain files
// only (Dirent.isFile() is false for symlinks), root level only.
function kitFiles() {
  try {
    return fs.readdirSync(kitDir(), { withFileTypes: true })
      .filter((e) => e.isFile() && KIT_FILE_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
function kitReadText(rel) {
  try { return fs.readFileSync(path.join(kitDir(), rel), 'utf8'); } catch { return null; }
}
function kitRegistrations(files) {
  const out = {};
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const text = kitReadText(f) || '';
    const re = /\bAPC\.register\(\s*(["'])([A-Za-z0-9_-]+)\1/g;
    let m;
    while ((m = re.exec(text))) out[m[2]] = f;
  }
  return out;
}
function kitBridgeNames(text, re) {
  const set = new Set();
  let m;
  while ((m = re.exec(text || ''))) set.add(m[1]);
  return Array.from(set).sort();
}
function kitScenarios() {
  const text = kitReadText('apc-mock.js');
  const expected = KIT_REL + '/apc-mock.js';
  if (text === null) return { found: false, expected, names: KIT_FALLBACK_SCENARIOS.slice(), derived: false };
  const start = text.indexOf('var SCENARIOS = {');
  const end = start === -1 ? -1 : text.indexOf('\n  };', start);
  if (start === -1 || end === -1) return { found: true, expected, names: KIT_FALLBACK_SCENARIOS.slice(), derived: false };
  const block = text.slice(start, end);
  const names = [];
  const re = /^\s*"([a-z][a-z0-9-]*)"\s*:\s*function/gm;
  let m;
  while ((m = re.exec(block))) names.push(m[1]);
  return { found: true, expected, names: names.length ? names : KIT_FALLBACK_SCENARIOS.slice(), derived: names.length > 0 };
}

// Theme tokens: a design that ships design_library/<dir>/tokens.css (the APC Minimal
// contract) is served as-is. Older-style designs without tokens.css fall back to
// tokens derived from design-system.json (palette / typography / components)
// with the fixed mapping below, served as CSS on demand.
const KIT_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\)|[A-Za-z]{3,24})$/;
const KIT_FONT_RE = /^[A-Za-z0-9 ,'"._-]{1,200}$/;
const KIT_RADIUS_RE = /^\d+(\.\d+)?(px|rem|em)?$/;
function kitParseColor(v) {
  const s = String(v || '').trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function kitLuma(rgb) {
  const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
const KIT_TOKENS_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\.css$/;
// Custom properties declared in the first (:root / [data-theme="night"]) block of a tokens.css.
function kitParseTokensCss(text) {
  const clean = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  // The token contract is the first plain rule (normally `:root, [data-theme="night"]`)
  // that declares custom properties. @font-face and other at-rule blocks come first in
  // a design that ships its own fonts, so they must not be mistaken for it.
  let m = null;
  const blockRe = /([^{}]*)\{([^{}]*)\}/g;
  for (let b; (b = blockRe.exec(clean));) {
    if (b[1].trim().startsWith('@')) continue;
    if (/(^|;)\s*--[A-Za-z0-9_-]+\s*:/.test(b[2])) { m = [b[0], b[2]]; break; }
  }
  const tokens = [];
  if (m) {
    for (const d of m[1].split(';')) {
      const mm = d.match(/^\s*(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]+?)\s*$/);
      if (mm) tokens.push({ name: mm[1], value: mm[2].replace(/\s+/g, ' '), from: 'tokens.css' });
    }
  }
  return tokens;
}
function kitThemeEntries() {
  const manifestFile = 'design_library/manifest.json';
  const manifest = readJson(path.join(REPO_ROOT, 'design_library', 'manifest.json'), null);
  if (!manifest) return { manifestFound: false, expected: manifestFile, themes: [] };
  const themes = ((manifest.designs) || []).filter((d) => d && typeof d.id === 'string' && KIT_ID_RE.test(d.id)).map((d) => {
    const dirName = typeof d.path === 'string' && KIT_ID_RE.test(d.path) ? d.path : d.id;
    const abs = safeJoin(path.join(REPO_ROOT, 'design_library'), dirName);
    const tokensName = typeof d.tokens === 'string' && KIT_TOKENS_FILE_RE.test(d.tokens) ? d.tokens : 'tokens.css';
    const tokensRel = 'design_library/' + dirName + '/' + tokensName;
    if (abs && exists(path.join(abs, tokensName))) {
      let text = '';
      try { text = fs.readFileSync(path.join(abs, tokensName), 'utf8'); } catch { /* treated as empty */ }
      return { id: d.id, title: d.name || d.id, vibe: d.vibe || null, tokenFile: tokensRel, tokensFile: tokensRel, source: manifestFile,
        found: true, appearance: 'night', modes: ['night', 'day'], tokens: kitParseTokensCss(text), css: text, cssUrl: '/kit-theme/' + d.id + '.css', derived: false };
    }
    const tokenFile = 'design_library/' + dirName + '/design-system.json';
    const ds = abs ? readJson(path.join(abs, 'design-system.json'), null) : null;
    const base = { id: d.id, title: d.name || d.id, vibe: d.vibe || null, tokenFile, tokensFile: null, source: manifestFile, found: !!ds, derived: true };
    if (!ds || !plainObject(ds.palette)) return Object.assign(base, { found: false, appearance: null, tokens: [], cssUrl: null });
    const derived = kitDeriveTokens(ds);
    return Object.assign(base, { appearance: derived.appearance, modes: [derived.appearance], tokens: derived.tokens, css: derived.css, cssUrl: '/kit-theme/' + d.id + '.css' });
  });
  return { manifestFound: true, expected: manifestFile, themes };
}
function kitDeriveTokens(ds) {
  const p = plainObject(ds.palette) ? ds.palette : {};
  const t = plainObject(ds.typography) ? ds.typography : {};
  const c = plainObject(ds.components) ? ds.components : {};
  const col = (v) => (typeof v === 'string' && KIT_COLOR_RE.test(v.trim()) ? v.trim() : null);
  const bg = col(p.background);
  const rgb = bg ? kitParseColor(bg) : null;
  const appearance = rgb && kitLuma(rgb) >= 0.4 ? 'day' : 'night';
  const dark = appearance === 'night';
  const pick = (...pairs) => { for (const [v, from] of pairs) { const x = col(v); if (x) return { value: x, from }; } return null; };
  const defs = [
    ['--plate', dark ? pick([p.surface, 'palette.surface'], [p.background, 'palette.background']) : pick([p.background, 'palette.background'])],
    ['--plate-2', dark ? pick([p.surfaceHighlight, 'palette.surfaceHighlight'], [p.surface, 'palette.surface']) : pick([p.cap, 'palette.cap'], [p.surfaceHighlight, 'palette.surfaceHighlight'], [p.surface, 'palette.surface'])],
    ['--surface', dark ? pick([p.background, 'palette.background']) : pick([p.surface, 'palette.surface'])],
    ['--inset', dark ? pick([p.background, 'palette.background']) : pick([p.surface, 'palette.surface'])],
    ['--rule', pick([p.border, 'palette.border'])],
    ['--rule-2', pick([p.surfaceHighlight, 'palette.surfaceHighlight'], [p.border, 'palette.border'])],
    ['--ink', pick([p.textPrimary, 'palette.textPrimary'])],
    ['--ink-2', pick([p.textSecondary, 'palette.textSecondary'])],
    ['--accent', pick([p.accent, 'palette.accent'], [p.primary, 'palette.primary'])],
    ['--grip-ink', pick([p.border, 'palette.border'])],
  ];
  const tokens = [];
  for (const [name, hit] of defs) if (hit) tokens.push({ name, value: hit.value, from: hit.from });
  const radius = typeof c.borderRadius === 'string' && KIT_RADIUS_RE.test(c.borderRadius.trim()) ? c.borderRadius.trim() : null;
  if (radius) {
    tokens.push({ name: '--r-control', value: radius, from: 'components.borderRadius' });
    tokens.push({ name: '--r-panel', value: radius, from: 'components.borderRadius' });
  }
  const font = typeof t.fontFamilyBody === 'string' && KIT_FONT_RE.test(t.fontFamilyBody.trim()) ? t.fontFamilyBody.trim() : null;
  if (font) tokens.push({ name: '--font-ui', value: font + (/\b(sans-serif|serif|monospace)\b/i.test(font) ? '' : ', sans-serif'), from: 'typography.fontFamilyBody' });
  const css = '/* APC Hub kit gallery: tokens derived from design-system.json (the theme ships no token CSS).\n' +
    '   Applies to the theme\'s own ' + appearance + ' mode; the other mode keeps the kit fallback tokens. */\n' +
    '[data-theme="' + appearance + '"], :root:not([data-theme]) {\n  color-scheme: ' + (dark ? 'dark' : 'light') + ';\n' +
    tokens.map((x) => '  ' + x.name + ': ' + x.value + ';').join('\n') + '\n}\n';
  return { appearance, tokens, css };
}

function readKitCatalog() {
  const cat = readJson(KIT_CATALOG_FILE, null);
  return plainObject(cat) && Array.isArray(cat.components) ? cat : null;
}
function getKit() {
  const dir = kitDir();
  const kitFound = isDir(dir);
  const catalog = readKitCatalog();
  const themeInfo = kitThemeEntries();
  const scen = kitScenarios();
  const files = kitFiles();
  const registered = kitRegistrations(files);
  const mockText = kitReadText('apc-mock.js') || '';
  const mockFns = kitBridgeNames(mockText, /\bF\["(apc\.[A-Za-z.]+)"\]\s*=/g);
  const out = {
    kitFound,
    kitDir: KIT_REL,
    expected: kitFound ? null : KIT_REL + '/',
    catalogFound: !!catalog,
    catalogFile: KIT_CATALOG_REL,
    contract: KIT_REL + '/CONTRACT.md',
    contractFound: exists(path.join(dir, 'CONTRACT.md')),
    files: files.map((f) => ({ file: f, path: KIT_REL + '/' + f, url: '/kit/' + f })),
    registered,
    mockFunctions: mockFns,
    scenarios: {
      found: scen.found, expected: scen.expected, derived: scen.derived, source: KIT_REL + '/apc-mock.js',
      names: scen.names, notes: (catalog && catalog.scenarioNotes) || {},
    },
    themes: {
      manifestFound: themeInfo.manifestFound, expected: themeInfo.expected, source: themeInfo.expected,
      derivation: 'A design that ships <theme>/tokens.css (the APC Minimal contract) is served as-is. A design without tokens.css falls back to kit tokens (--plate, --ink, --accent ...) derived from <theme>/design-system.json (palette, typography.fontFamilyBody, components.borderRadius); each token lists its source key.',
      defaultTheme: { id: 'default', title: 'default tokens', source: KIT_REL + '/apc-core.css + apc-components.css + apc-widgets.css + apc-viz.css' },
      items: themeInfo.themes.map((t) => { const { css, ...rest } = t; return rest; }),
    },
    sources: (catalog && catalog.sources) || null,
    groups: (catalog && catalog.groups) || [],
    components: [],
    coverage: [],
    coverageSource: (catalog && catalog.coverageSource) || null,
    testPages: [],
    issues: [],
  };
  const issue = (m) => out.issues.push(m);
  if (!kitFound) issue('kit folder NOT FOUND: ' + KIT_REL + '/');
  if (!catalog) issue('catalog NOT FOUND or unreadable: ' + KIT_CATALOG_REL);
  if (!out.contractFound && kitFound) issue('NOT FOUND: ' + KIT_REL + '/CONTRACT.md');
  const testsDir = path.join(dir, 'tests');
  const testFiles = listFiles(testsDir).filter((f) => /\.html$/.test(f));
  out.testPages = testFiles.map((f) => ({ file: f, path: KIT_REL + '/tests/' + f }));
  if (catalog) {
    const seen = new Set();
    for (const c of catalog.components) {
      if (!plainObject(c) || typeof c.name !== 'string') continue;
      seen.add(c.name);
      const demo = plainObject(c.demo) ? c.demo : {};
      const scripts = Array.isArray(demo.scripts) ? demo.scripts : [];
      const missingScripts = scripts.filter((s) => !files.includes(s));
      const gestures = Array.isArray(c.gestures) ? c.gestures
        : (c.gestureSet && plainObject(catalog.gestureSets) && Array.isArray(catalog.gestureSets[c.gestureSet]) ? catalog.gestureSets[c.gestureSet] : []);
      const scenarios = c.scenarios === 'all' ? scen.names.slice() : (Array.isArray(c.scenarios) ? c.scenarios : []);
      const fileText = c.file ? kitReadText(String(c.file)) : null;
      const bridge = Array.isArray(c.bridge) ? c.bridge : [];
      const entry = {
        name: c.name, registered: c.registered !== false, via: c.via || null, group: c.group || null, title: c.title || c.name,
        summary: c.summary || '', guide: c.guide || null,
        file: c.file ? KIT_REL + '/' + c.file : null, fileFound: !!(c.file && files.includes(String(c.file))),
        registeredIn: registered[c.name] ? KIT_REL + '/' + registered[c.name] : null,
        markup: c.markup || '', options: Array.isArray(c.options) ? c.options : [], events: Array.isArray(c.events) ? c.events : [],
        bridge: bridge.map((n) => ({ name: n, inMock: mockFns.includes(n) })),
        bridgeInFile: fileText === null ? [] : kitBridgeNames(fileText, /"(apc\.[A-Za-z.]+)"/g),
        gestures, standards: Array.isArray(c.standards) ? c.standards : [],
        scenarios, defaultScenario: scenarios.length ? scenarios[0] : 'demo',
        demo: {
          url: c.demo ? '/kit-demo/' + c.name : null, cols: demo.cols || null, rows: demo.rows || null,
          scripts, missingScripts, hint: demo.hint || '', expect: Array.isArray(demo.expect) ? demo.expect : [],
        },
        tests: (Array.isArray(c.tests) ? c.tests : []).map((f) => ({ file: f, path: KIT_REL + '/tests/' + f, found: testFiles.includes(f) })),
      };
      if (entry.registered && kitFound && !registered[c.name]) issue('catalog lists "' + c.name + '" but no APC.register("' + c.name + '") exists in ' + KIT_REL + '/*.js');
      if (entry.registered && registered[c.name] && c.file && registered[c.name] !== c.file) issue('"' + c.name + '" is registered in ' + registered[c.name] + ', catalog says ' + c.file);
      if (!entry.registered && registered[c.name]) issue('"' + c.name + '" is registered in the kit but the catalog marks it as not registered');
      if (c.file && kitFound && !entry.fileFound) issue('NOT FOUND: ' + entry.file);
      for (const s of missingScripts) issue('demo script NOT FOUND for "' + c.name + '": ' + KIT_REL + '/' + s);
      for (const n of entry.bridge) if (!n.inMock && kitFound) issue('"' + c.name + '" lists bridge function ' + n.name + ' that apc-mock.js does not implement');
      for (const t of entry.tests) if (!t.found && kitFound) issue('NOT FOUND: ' + t.path);
      out.components.push(entry);
    }
    for (const name of Object.keys(registered)) {
      if (!seen.has(name)) issue('APC.register("' + name + '") in ' + registered[name] + ' has no catalog entry in ' + KIT_CATALOG_REL);
    }
    const names = new Set(out.components.map((c) => c.name));
    out.coverage = (Array.isArray(catalog.coverage) ? catalog.coverage : []).map((r) => {
      const comps = Array.isArray(r.components) ? r.components : [];
      for (const n of comps) if (!names.has(n)) issue('coverage row "' + r.item + '" names unknown component ' + n);
      return {
        section: r.section, item: r.item, decisions: r.decisions || [], components: comps, status: r.status || 'kit', note: r.note || '',
        tests: (Array.isArray(r.tests) ? r.tests : []).map((f) => ({ file: f, found: testFiles.includes(f) })),
      };
    });
  }
  return out;
}

// Demo pages -----------------------------------------------------------------
function htmlEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const KIT_EARLY_JS = [
  '(function () {',
  '  "use strict";',
  '  var q = (window.__apcDemoErrors = []);',
  '  function note(m) { q.push(m); }',
  '  window.addEventListener("error", function (e) {',
  '    var t = e && e.target;',
  '    if (t && t !== window && (t.src || t.href)) note("failed to load " + (t.src || t.href));',
  '    else note("script error: " + ((e && e.message) || "unknown"));',
  '  }, true);',
  '  window.addEventListener("unhandledrejection", function (e) { note("unhandled rejection: " + String(e && e.reason)); });',
  '})();',
  '',
].join('\n');
const KIT_SETUP_JS = [
  '(function () {',
  '  "use strict";',
  '  var d = document.documentElement, APC = window.APC;',
  '  if (!APC || !APC.mock) { window.__apcDemoErrors.push("apc-mock.js did not load"); return; }',
  '  try {',
  '    APC.mock.scenario(d.getAttribute("data-demo-scenario") || "demo");',
  '    APC.mock.call("apc.settings.set", { patch: { ui: { theme: d.getAttribute("data-theme") } } });',
  '  } catch (e) { window.__apcDemoErrors.push("demo setup failed: " + e); }',
  '})();',
  '',
].join('\n');
const KIT_POST_JS = [
  '(function () {',
  '  "use strict";',
  '  var d = document.documentElement, APC = window.APC;',
  '  function say(m) { if (APC && APC.toast) APC.toast.error(m); }',
  '  var early = window.__apcDemoErrors || [];',
  '  early.forEach(say);',
  '  window.__apcDemoErrors = { push: say };',
  '  if (!APC || !APC.mount) { d.setAttribute("data-demo-ready", "0"); return; }',
  '  try { APC.mount(document); } catch (e) { say("mount failed: " + e); }',
  '  var n = 0, all = document.querySelectorAll("[data-apc]");',
  '  for (var i = 0; i < all.length; i++) if (all[i].__apc) n++;',
  '  d.setAttribute("data-demo-mounted", String(n));',
  '  var actions = [];',
  '  try { actions = JSON.parse(d.getAttribute("data-demo-actions") || "[]"); } catch (e) { say("bad demo actions"); }',
  '  setTimeout(function () {',
  '    actions.forEach(function (a) {',
  '      try {',
  '        if (a.emit) { APC.emit(a.emit, a.data); return; }',
  '        var sel = a.click || a.contextmenu, el = sel ? document.querySelector(sel) : null;',
  '        if (!el) { say("demo action target not found: " + sel); return; }',
  '        if (a.click) el.click();',
  '        else { var r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2 })); }',
  '      } catch (e) { say("demo action failed: " + e); }',
  '    });',
  '    setTimeout(function () {',
  '      var want = [], miss = [];',
  '      try { want = JSON.parse(d.getAttribute("data-demo-expect") || "[]"); } catch (e) { say("bad demo expectations"); }',
  '      want.forEach(function (sel) { try { if (!document.querySelector(sel)) miss.push(sel); } catch (e) { miss.push(sel); } });',
  '      d.setAttribute("data-demo-missing", JSON.stringify(miss));',
  '      d.setAttribute("data-demo-ready", "1");',
  '    }, 150);',
  '  }, 60);',
  '})();',
  '',
].join('\n');
const KIT_BOOT = { '_early.js': KIT_EARLY_JS, '_setup.js': KIT_SETUP_JS, '_post.js': KIT_POST_JS };

function kitDemoHeaders() {
  return { 'Content-Security-Policy': KIT_CSP, 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer' };
}
function buildKitDemo(c, themeId, appearance, scenario, mode) {
  const demo = c.demo;
  const tag = (list) => list.map((s) => '<script src="/kit/' + htmlEsc(s) + '"></script>').join('\n') + '\n';
  const cols = Number(demo.cols) > 0 ? Number(demo.cols) : 40;
  const rows = Number(demo.rows) > 0 ? Number(demo.rows) : 20;
  const theme = themeId && themeId !== 'default' ? '<link rel="stylesheet" href="/kit-theme/' + htmlEsc(themeId) + '.css">\n' : '';
  const actions = Array.isArray(demo.actions) ? demo.actions : [];
  return '<!DOCTYPE html>\n<html lang="en" data-theme="' + htmlEsc(mode) + '" data-demo-component="' + htmlEsc(c.name) +
    '" data-demo-theme="' + htmlEsc(themeId || 'default') + '" data-demo-scenario="' + htmlEsc(scenario) +
    '" data-demo-actions="' + htmlEsc(JSON.stringify(actions)) +
    '" data-demo-expect="' + htmlEsc(JSON.stringify(Array.isArray(demo.expect) ? demo.expect : [])) + '">\n<head>\n<meta charset="utf-8">\n' +
    '<title>APC kit demo: ' + htmlEsc(c.name) + '</title>\n' +
    // widgets + viz sheets are low-specificity (:where) and optional: linked only when the kit folder ships them
    KIT_DEMO_CSS.filter((f, i) => i < 2 || kitFiles().includes(f)).map((f) => '<link rel="stylesheet" href="/kit/' + f + '">\n').join('') + theme +
    '<style>:root{--cols:' + cols + ';--rows:' + rows + ';--apc-letterbox:var(--surface,#000)}</style>\n</head>\n' +
    '<body>\n<script src="/kit-demo/_early.js"></script>\n<div class="apc-plate" id="apc-demo-plate">\n' + (demo.body || '') + '\n</div>\n' +
    // order matters: core + mock, then scenario/theme setup, then the components (chrome reads the theme pref at load), then mount
    tag(KIT_CORE_SCRIPTS) + '<script src="/kit-demo/_setup.js"></script>\n' + tag(demo.scripts || []) +
    '<script src="/kit-demo/_post.js"></script>\n</body>\n</html>\n';
}
function serveKitDemo(parts, query, res) {
  // parts: ['kit-demo', '<component>' | '_x.js']
  if (parts.length !== 2) return send(res, 404, 'not found');
  let name;
  try { name = decodeURIComponent(parts[1]); } catch { return send(res, 400, 'bad request'); }
  if (Object.prototype.hasOwnProperty.call(KIT_BOOT, name)) {
    return send(res, 200, KIT_BOOT[name], MIME['.js'], kitDemoHeaders());
  }
  if (!KIT_COMPONENT_RE.test(name)) return send(res, 404, 'unknown component');
  if (!isDir(kitDir())) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/ (kit folder missing)');
  const catalog = readKitCatalog();
  if (!catalog) return send(res, 404, '[NOT FOUND] ' + KIT_CATALOG_REL);
  const c = catalog.components.find((x) => plainObject(x) && x.name === name);
  if (!c || !plainObject(c.demo)) return send(res, 404, 'unknown component');
  const files = kitFiles();
  for (const s of KIT_CORE_SCRIPTS.concat(c.demo.scripts || [])) {
    if (!files.includes(s)) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/' + s);
  }
  let themeId = query.theme || 'default';
  let appearance = 'night';
  if (themeId !== 'default') {
    if (!KIT_ID_RE.test(themeId)) return send(res, 400, 'bad theme id');
    const t = kitThemeEntries().themes.find((x) => x.id === themeId);
    if (!t) return send(res, 404, '[NOT FOUND] theme ' + themeId + ' (design_library/manifest.json)');
    if (!t.found) return send(res, 404, '[NOT FOUND] ' + t.tokenFile);
    appearance = t.appearance;
  }
  const scenario = query.scenario || 'demo';
  if (!kitScenarios().names.includes(scenario)) return send(res, 400, 'unknown scenario');
  const mode = query.mode || appearance;
  if (mode !== 'night' && mode !== 'day') return send(res, 400, 'mode must be night or day');
  send(res, 200, buildKitDemo(c, themeId, appearance, scenario, mode), 'text/html; charset=utf-8', kitDemoHeaders());
}
function serveKitFile(urlPath, res) {
  if (!isDir(kitDir())) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/ (kit folder missing)');
  let name;
  try { name = decodeURIComponent(urlPath.slice('/kit/'.length)); } catch { return send(res, 400, 'bad request'); }
  // One path segment, a plain file name: separators, "..", leading dots, NUL,
  // drive letters and anything but *.js / *.css fail the pattern.
  // fonts/ is the one subfolder: apc-core.css declares @font-face url("fonts/x.woff2")
  // and a plugin's vendored copy keeps the same layout, so the Hub serves it too.
  if (/^fonts\//.test(name)) {
    const f = name.slice('fonts/'.length);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.woff2?$/i.test(f)) return send(res, 403, 'forbidden');
    return fs.readFile(path.join(kitDir(), 'fonts', f), (err, data) => {
      if (err) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/fonts/' + f);
      send(res, 200, data, /\.woff$/i.test(f) ? 'font/woff' : 'font/woff2');
    });
  }
  if (!KIT_FILE_RE.test(name)) return send(res, 403, 'forbidden');
  if (!kitFiles().includes(name)) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/' + name);
  fs.readFile(path.join(kitDir(), name), (err, data) => {
    if (err) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/' + name);
    send(res, 200, data, MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');
  });
}
function serveKitTheme(urlPath, res) {
  let file;
  try { file = decodeURIComponent(urlPath.slice('/kit-theme/'.length)); } catch { return send(res, 400, 'bad request'); }
  const m = file.match(/^([A-Za-z0-9][A-Za-z0-9_-]*)\.css$/);
  if (!m) return send(res, 403, 'forbidden');
  const info = kitThemeEntries();
  if (!info.manifestFound) return send(res, 404, '[NOT FOUND] ' + info.expected);
  const t = info.themes.find((x) => x.id === m[1]);
  if (!t) return send(res, 404, '[NOT FOUND] theme ' + m[1] + ' (' + info.expected + ')');
  if (!t.found) return send(res, 404, '[NOT FOUND] ' + t.tokenFile);
  /* tokens.css keeps a portable relative reference to its bundled fonts (url("fonts/x.woff2"))
     so a plugin can copy the design folder as-is. Served from /kit-theme/ that relative path
     would resolve to /kit-theme/fonts/..., where nothing exists. Point it at the kit's own copy
     when the file is there - the demo pages already load apc-core.css from /kit/, so the same
     URL means one download and one cache entry - and fall back to the design's folder
     (/preview/<design>/fonts/) for a design that ships fonts of its own. */
  const dir = /^design_library\/([^/]+)\//.exec(String(t.tokenFile || ''));
  const css = dir
    ? String(t.css).replace(/url\((['"]?)fonts\/([^)'"]+)\1\)/g, (all, q, file) => {
        const inKit = fs.existsSync(path.join(kitDir(), 'fonts', file));
        return 'url(' + q + (inKit ? '/kit/fonts/' : '/preview/' + dir[1] + '/fonts/') + file + q + ')';
      })
    : t.css;
  send(res, 200, css, MIME['.css']);
}

// ─── Reference plugin + design document routes (read-only) ──────────────────
// APC Minimal's sole visual source is the annotated F-30 reference in hub/_design.
// The Hub serves that document byte-for-byte at /kit-demo/_reference?surface=night|day.
// Its inline script is trusted only on this route; the source has no external assets or network access.
//   /kit-reference/<file>        allow-listed reference/*.js|css|svg|png (one path segment, no traversal)
//   /api/v1/design/<id>          design_library/<id>/design-system.json (parsed) + tokens.css text
const KIT_REFERENCE_DIR = 'reference';
const KIT_REFERENCE_SOURCE = path.join('hub', '_design', 'apc_filter_f30_annotate_v006.html');
const KIT_REFERENCE_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(js|css|svg|png)$/;
function kitReferenceDir() { return path.join(kitDir(), KIT_REFERENCE_DIR); }
function kitReferenceFiles() {
  try {
    return fs.readdirSync(kitReferenceDir(), { withFileTypes: true })
      .filter((e) => e.isFile() && KIT_REFERENCE_FILE_RE.test(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}
function serveKitReference(query, res) {
  if (!isDir(kitDir())) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/ (kit folder missing)');
  const sourceFile = path.join(REPO_ROOT, KIT_REFERENCE_SOURCE);
  if (!exists(sourceFile)) return send(res, 404, '[NOT FOUND] ' + KIT_REFERENCE_SOURCE.replace(/\\/g, '/'));
  const surface = query.surface || query.mode || 'night';
  if (surface !== 'night' && surface !== 'day') return send(res, 400, 'surface must be night or day');
  if (query.theme && query.theme !== 'default' && query.theme !== 'apc-minimal') return send(res, 404, '[NOT FOUND] design apc-minimal');
  let html;
  try { html = fs.readFileSync(sourceFile); } catch { return send(res, 404, '[NOT FOUND] ' + KIT_REFERENCE_SOURCE.replace(/\\/g, '/')); }
  send(res, 200, html, 'text/html; charset=utf-8', {
    'Content-Security-Policy': KIT_REFERENCE_CSP,
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
  });
}
function serveKitReferenceFile(urlPath, res) {
  let name;
  try { name = decodeURIComponent(urlPath.slice('/kit-reference/'.length)); } catch { return send(res, 400, 'bad request'); }
  if (!KIT_REFERENCE_FILE_RE.test(name)) return send(res, 403, 'forbidden');
  if (!kitReferenceFiles().includes(name)) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/' + KIT_REFERENCE_DIR + '/' + name);
  fs.readFile(path.join(kitReferenceDir(), name), (err, data) => {
    if (err) return send(res, 404, '[NOT FOUND] ' + KIT_REL + '/' + KIT_REFERENCE_DIR + '/' + name);
    send(res, 200, data, MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', kitDemoHeaders());
  });
}
// GET /api/v1/design/<id>: the design's spec document and token CSS for the KIT page (theme editor, element spec).
function getDesignDoc(id) {
  if (!KIT_ID_RE.test(String(id || ''))) return { status: 400, body: { error: 'bad-design-id' } };
  const m = readJson(path.join(REPO_ROOT, 'design_library', 'manifest.json'), null);
  const entry = m && Array.isArray(m.designs) ? m.designs.find((d) => d && d.id === id) : null;
  if (!entry) return { status: 404, body: { error: 'unknown-design' } };
  const dirName = typeof entry.path === 'string' && KIT_ID_RE.test(entry.path) ? entry.path : entry.id;
  const dir = safeJoin(path.join(REPO_ROOT, 'design_library'), dirName);
  if (!dir || !isDir(dir)) return { status: 404, body: { error: 'design-folder-missing', expected: 'design_library/' + dirName + '/' } };
  const tokensName = typeof entry.tokens === 'string' && KIT_TOKENS_FILE_RE.test(entry.tokens) ? entry.tokens : 'tokens.css';
  const specName = typeof entry.spec === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(entry.spec) ? entry.spec : 'design-system.json';
  const out = {
    id, name: entry.name || id, dir: 'design_library/' + dirName,
    tokensFile: 'design_library/' + dirName + '/' + tokensName, tokensFound: false, tokensCss: null,
    specFile: 'design_library/' + dirName + '/' + specName, specFound: false, spec: null, specError: null,
    revision: null, tuningSchema: {},
  };
  const tp = path.join(dir, tokensName);
  if (exists(tp)) { try { out.tokensCss = fs.readFileSync(tp, 'utf8'); out.tokensFound = true; } catch { /* unreadable: reported as not found */ } }
  const sp = path.join(dir, specName);
  if (exists(sp)) {
    out.specFound = true;
    try {
      const raw = fs.readFileSync(sp, 'utf8');
      out.spec = JSON.parse(raw);
      out.revision = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
      out.tuningSchema = kitTuning.schemaFor(out.spec.elements, out.tokensCss || '');
    } catch (e) { out.specError = 'invalid JSON: ' + (e && e.message ? e.message : e); }
  }
  return { status: 200, body: out };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
function send(res, code, body, type, extraHeaders) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(code, Object.assign({
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }, extraHeaders || {}));
  res.end(buf);
}
function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
}

async function handleApi(parts, query, res) {
  // parts[0] === 'api', parts[1] === 'v1'
  const seg = parts.slice(2);
  if (seg.length === 0) return sendJson(res, 200, { name: 'apc-hub', version: VERSION, api: 'v1' });
  const [resource, param] = seg;
  switch (resource) {
    case 'meta': {
      const cfg = loadConfig();
      return sendJson(res, 200, {
        hub: VERSION,
        framework: packageVersion(),
        repoRoot: REPO_ROOT,
        setupCompleted: !!(cfg.live && cfg.live.setup && cfg.live.setup.completed),
        setupPlatform: (cfg.live && cfg.live.setup && cfg.live.setup.platform) || null,
        modelProfile: (cfg.live && cfg.live.models && cfg.live.models.profile) || null,
        time: new Date().toISOString(),
      });
    }
    case 'config': {
      const cfg = loadConfig();
      return sendJson(res, 200, {
        livePresent: cfg.livePresent, liveError: cfg.liveError, live: cfg.live, example: cfg.example,
        rel: cfg.rel, resolved: cfg.resolved, exists: cfg.exists,
      });
    }
    case 'plugins': {
      if (param) {
        const d = getPluginDetail(param);
        if (!d) return sendJson(res, 404, { error: 'unknown-plugin' });
        return sendJson(res, 200, d);
      }
      return sendJson(res, 200, getPlugins());
    }
    case 'skills': return sendJson(res, 200, { root: '.agents/skills/', skills: getSkills() });
    case 'commands': return sendJson(res, 200, getCommands());
    case 'designs': return sendJson(res, 200, getDesigns());
    case 'scripts': return sendJson(res, 200, getScripts());
    case 'templates': return sendJson(res, 200, getTemplates());
    case 'tools': return sendJson(res, 200, await getTools());
    case 'docs': {
      if (param) {
        const d = getDocRaw(param);
        if (!d) return sendJson(res, 404, { error: 'unknown-doc' });
        return sendJson(res, 200, d);
      }
      return sendJson(res, 200, getDocs());
    }
    case 'update': {
      if (query.refresh) { updateCache = null; updateCacheAt = 0; }
      return sendJson(res, 200, await getUpdate());
    }
    case 'consistency': return sendJson(res, 200, getConsistency());
    case 'standards': return sendJson(res, 200, getStandards());
    case 'kit': return sendJson(res, 200, getKit());
    case 'design': { const d = getDesignDoc(param); return sendJson(res, d.status, d.body); }   // Reference/Theme-editor region
    default: return sendJson(res, 404, { error: 'unknown-resource' });
  }
}

function pluginDirFor(name) {
  // Resolve a plugin directory the same way getPluginDetail does, but without
  // requiring status.json — design files may exist before state is written.
  const cfg = loadConfig();
  const repoLocal = path.join(REPO_ROOT, 'plugins');
  let dir = safeJoin(repoLocal, name);
  if ((!dir || !exists(dir)) && cfg.resolved.plugins) {
    const alt = safeJoin(cfg.resolved.plugins, name);
    if (alt && exists(alt)) dir = alt;
  }
  return dir;
}

function servePluginDesign(parts, res, subdir) {
  // GET /pdesign/:plugin/<file...> - read-only files from <plugin>/Design/.
  // GET /pbuild/:plugin/<file...>  - read-only files from <plugin>/Source/ui/public/.
  // Same traversal guards as serveDesignPreview; nested paths allowed so
  // composed previews can reach Design/apc-ui/*.
  const designDir = (() => {
    const d = pluginDirFor(parts[1]);
    if (!d) return null;
    const dd = path.join(d, ...(subdir || ['Design']));
    return exists(dd) ? dd : null;
  })();
  if (!designDir) return send(res, 404, 'unknown plugin or no ' + (subdir ? subdir.join('/') : 'Design') + ' dir');
  const base = path.resolve(designDir);
  let full = base;
  for (const seg of parts.slice(2)) {
    if (!seg || seg === '.' || !/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(seg)) return send(res, 403, 'forbidden');
    full = path.resolve(full, seg);
    if (full !== base && !full.startsWith(base + path.sep)) return send(res, 403, 'forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(full).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(MIME, ext) && !['.webp', '.woff', '.woff2', '.map'].includes(ext)) {
      return send(res, 403, 'forbidden type');
    }
    const type = MIME[ext] || (ext === '.webp' ? 'image/webp' : 'font/woff2');
    send(res, 200, data, type);
  });
}

function serveToolPreview(res) {
  // GET /uipreview - the repo-level design preview/annotation tool.
  fs.readFile(path.join(REPO_ROOT, 'tools', 'ui-preview', 'index.html'), (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, 'text/html; charset=utf-8');
  });
}

function serveDesignPreview(parts, res) {
  // GET /preview/:design/<file> - read-only preview of design_library assets.
  // Design id must exist in manifest.json; path stays inside its directory.
  const manifest = readJson(path.join(REPO_ROOT, 'design_library', 'manifest.json'), null);
  const ids = new Set(((manifest && manifest.designs) || []).map((d) => d.id || d.path).filter(Boolean));
  const designId = parts[1];
  if (!designId || !ids.has(designId)) return send(res, 404, 'unknown design');
  const base = path.resolve(REPO_ROOT, 'design_library', designId);
  let full = base;
  for (const seg of parts.slice(2)) {
    if (!seg || seg === '.' || !/^[A-Za-z0-9_][A-Za-z0-9_.\-]*$/.test(seg)) return send(res, 403, 'forbidden');
    full = path.resolve(full, seg);
    if (full !== base && !full.startsWith(base + path.sep)) return send(res, 403, 'forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'not found');
    const ext = path.extname(full).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(MIME, ext) && !['.webp', '.woff', '.woff2'].includes(ext)) {
      return send(res, 403, 'forbidden type');
    }
    const type = MIME[ext] || (ext === '.webp' ? 'image/webp' : 'font/woff2');
    send(res, 200, data, type);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// POST /api/v1/design/<id>/tuning - the one design-library write (09c ELEMENT SPEC).
// Lives here with the other guarded POSTs (writeGuard: loopback peer/Host/Origin), not in
// the read-only KIT block. Allow-listed by hub/kit-tuning.js, revision-checked, atomic
// temp+rename with a .bak of the previous spec (gitignored: design_library/**/*.bak).
async function handleDesignTuningPost(req, res, id) {
  const doc = getDesignDoc(id);
  if (doc.status !== 200) return sendJson(res, doc.status, doc.body);
  if (!doc.body.specFound || !doc.body.spec || !doc.body.revision) return sendJson(res, 404, { ok: false, error: 'design-spec-missing' });
  let body;
  try { body = await readBody(req, 32 * 1024); }
  catch { return sendJson(res, 413, { ok: false, error: 'body-too-large' }); }
  let payload;
  try { payload = JSON.parse(String(body).replace(/^﻿/, '')); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid-json' }); }
  if (!plainObject(payload) || typeof payload.revision !== 'string')
    return sendJson(res, 400, { ok: false, error: 'invalid-tuning-shape' });
  if (payload.revision !== doc.body.revision) return sendJson(res, 409, { ok: false, error: 'revision-conflict', revision: doc.body.revision });
  const submitted = plainObject(payload.elements) ? payload.elements :
    (typeof payload.element === 'string' ? { [payload.element]: payload.values } : null);
  if (!submitted || Object.keys(submitted).length > 60) return sendJson(res, 400, { ok: false, error: 'invalid-tuning-elements' });
  const checkedElements = {};
  for (const [name, values] of Object.entries(submitted)) {
    if (!Object.prototype.hasOwnProperty.call(doc.body.spec.elements || {}, name)) return sendJson(res, 400, { ok: false, error: 'unknown-element', element: name });
    const checked = kitTuning.validateValues(name, values, doc.body.tuningSchema);
    if (!checked.ok) return sendJson(res, 400, { ok: false, error: checked.error, element: name, property: checked.property });
    checkedElements[name] = checked.values;
  }

  const target = path.join(REPO_ROOT, doc.body.specFile.replace(/^design_library\//, 'design_library' + path.sep).replace(/\//g, path.sep));
  let spec;
  try { spec = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { return sendJson(res, 409, { ok: false, error: 'design-spec-changed' }); }
  const all = plainObject(spec.elementTuning) ? spec.elementTuning : {};
  Object.keys(checkedElements).forEach((name) => {
    if (Object.keys(checkedElements[name]).length) all[name] = checkedElements[name];
    else delete all[name];
  });
  if (Object.keys(all).length) spec.elementTuning = all;
  else delete spec.elementTuning;
  const output = JSON.stringify(spec, null, 2) + '\n';
  const temp = target + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temp, output, 'utf8');
    fs.copyFileSync(target, target + '.bak');
    fs.renameSync(temp, target);
  } catch (e) {
    try { if (exists(temp)) fs.unlinkSync(temp); } catch { /* leave the source intact */ }
    return sendJson(res, 500, { ok: false, error: 'write-failed' });
  }
  const revision = crypto.createHash('sha256').update(output, 'utf8').digest('hex');
  return sendJson(res, 200, { ok: true, id, elements: checkedElements, revision, backup: doc.body.specFile + '.bak' });
}

async function handleAnnotationsPost(req, res, name) {
  // POST /api/v1/plugins/:name/annotations - persists review-tool output to
  // <plugin>/Design/annotations.json, the file the design phase consumes.
  const dir = pluginDirFor(name);
  if (!dir) return sendJson(res, 404, { ok: false, error: 'unknown-plugin' });
  const designDir = path.join(dir, 'Design');
  if (!exists(designDir)) return sendJson(res, 404, { ok: false, error: 'no-design-dir' });
  let body;
  try { body = await readBody(req, 512 * 1024); }
  catch { return sendJson(res, 413, { ok: false, error: 'body-too-large' }); }
  let payload;
  try { payload = JSON.parse(String(body).replace(/^﻿/, '')); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid-json' }); }
  if (!payload || !Array.isArray(payload.annotations))
    return sendJson(res, 400, { ok: false, error: 'invalid-annotations-shape' });
  const file = path.join(designDir, 'annotations.json');
  try { fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8'); }
  catch { return sendJson(res, 500, { ok: false, error: 'write-failed' }); }
  sendJson(res, 200, { ok: true, file: 'Design/annotations.json' });
}

async function handleConfigPost(req, res) {
  // POST /api/v1/config - the single hub write path (Settings editor).
  // Validates shape, backs up apc.config.json to .bak, then writes 2-space JSON.
  let body = '';
  try {
    body = await readBody(req, 1024 * 1024);
  } catch {
    return sendJson(res, 413, { ok: false, error: 'body-too-large' });
  }
  let cfg = null;
  try {
    cfg = JSON.parse(String(body).replace(/^﻿/, ''));
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: 'invalid-json' });
  }
  const bad = !cfg || typeof cfg !== 'object'
    || cfg.version !== 1
    || !cfg.paths || typeof cfg.paths.plugins_dir !== 'string'
    || typeof cfg.paths.build_dir !== 'string' || typeof cfg.paths.release_dir !== 'string'
    || typeof cfg.models !== 'object' || typeof cfg.setup !== 'object';
  if (bad) return sendJson(res, 400, { ok: false, error: 'invalid-config-shape' });
  // Optional global standards block (decision X-06): global-scope ids only,
  // typed values, validated against schemas/apc-standards.json.
  if (Object.prototype.hasOwnProperty.call(cfg, 'standards')) {
    const sv = validateStandardsForWrite(cfg.standards);
    if (!sv.ok) return sendJson(res, 400, { ok: false, error: sv.error, issues: sv.issues });
    cfg.standards = sv.block;
  }
  const target = path.join(REPO_ROOT, 'apc.config.json');
  let backup = false;
  try {
    if (exists(target)) {
      fs.copyFileSync(target, target + '.bak');
      backup = true;
    }
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'write-failed' });
  }
  updateCache = null; updateCacheAt = 0; toolCache = null; toolCacheAt = 0;
  return sendJson(res, 200, { ok: true, backup });
}

// Write requests must come from this machine AND from a page the Hub itself
// served: loopback peer, loopback Host header (DNS-rebinding guard) and, when a
// browser sends one, a loopback Origin (cross-site form/fetch guard).
function isLoopbackAddr(a) {
  if (!a) return false;
  const s = String(a).replace(/^::ffff:/i, '');
  return s === '::1' || s === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(s);
}
function isLoopbackHost(h) {
  if (!h) return false;
  const m = String(h).trim().toLowerCase().match(/^(\[[0-9a-f:]+\]|[a-z0-9.\-]+)(?::\d+)?$/);
  if (!m) return false;
  return m[1] === 'localhost' || m[1] === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(m[1]);
}
function writeGuard(req) {
  if (!isLoopbackAddr(req.socket && req.socket.remoteAddress)) return 'non-loopback-peer';
  if (!isLoopbackHost(req.headers.host)) return 'non-loopback-host';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* leave null */ }
    if (!host || !isLoopbackHost(host)) return 'foreign-origin';
  }
  return null;
}

function serveStatic(urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch { return send(res, 400, 'bad request'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const parts = rel.split('/').filter((p) => p && p !== '.');
  if (parts.includes('..')) return send(res, 403, 'forbidden');
  const full = path.resolve(UI_DIR, ...parts);
  if (full !== UI_DIR && !full.startsWith(UI_DIR + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, data, MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/';
  const qpos = rawUrl.indexOf('?');
  const urlPath = qpos === -1 ? rawUrl : rawUrl.slice(0, qpos);
  const query = {};
  if (qpos !== -1) {
    for (const [k, v] of new URLSearchParams(rawUrl.slice(qpos + 1))) query[k] = v;
  }
  const isConfigPost = req.method === 'POST' && urlPath === '/api/v1/config';
  const annotMatch = req.method === 'POST' &&
    urlPath.match(/^\/api\/v1\/plugins\/([^/?]+)\/annotations$/);
  const tuningMatch = req.method === 'POST' && urlPath.match(/^\/api\/v1\/design\/([^/?]+)\/tuning$/);
  if ((req.method !== 'GET' && req.method !== 'HEAD') && !isConfigPost && !annotMatch && !tuningMatch) {
    return send(res, 405, 'GET only (POST allowed: /api/v1/config, /api/v1/plugins/:name/annotations, /api/v1/design/:id/tuning)');
  }
  if (req.method === 'POST') {
    const denied = writeGuard(req);
    if (denied) return sendJson(res, 403, { ok: false, error: denied });
  }
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    const parts = urlPath.split('/').filter(Boolean);
    if (parts[1] !== 'v1') return sendJson(res, 404, { error: 'unknown-api-version' });
    if (isConfigPost) {
      handleConfigPost(req, res).catch(() => sendJson(res, 500, { error: 'internal' }));
      return;
    }
    if (annotMatch) {
      handleAnnotationsPost(req, res, decodeURIComponent(annotMatch[1]))
        .catch(() => sendJson(res, 500, { ok: false, error: 'internal' }));
      return;
    }
    if (tuningMatch) {
      let designId;
      try { designId = decodeURIComponent(tuningMatch[1]); } catch { return sendJson(res, 400, { ok: false, error: 'bad-design-id' }); }
      handleDesignTuningPost(req, res, designId).catch(() => sendJson(res, 500, { ok: false, error: 'internal' }));
      return;
    }
    handleApi(parts, query, res).catch(() => sendJson(res, 500, { error: 'internal' }));
    return;
  }
  if (urlPath === '/preview' || urlPath.startsWith('/preview/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveDesignPreview(urlPath.split('/').filter(Boolean), res);
    return;
  }
  if (urlPath === '/pdesign' || urlPath.startsWith('/pdesign/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    servePluginDesign(urlPath.split('/').filter(Boolean), res, null);
    return;
  }
  if (urlPath === '/pbuild' || urlPath.startsWith('/pbuild/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    servePluginDesign(urlPath.split('/').filter(Boolean), res, ['Source', 'ui', 'public']);
    return;
  }
  if (urlPath.startsWith('/kit/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveKitFile(urlPath, res);
    return;
  }
  if (urlPath.startsWith('/kit-theme/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveKitTheme(urlPath, res);
    return;
  }
  if (urlPath === '/kit-demo/_reference') {   // Reference Plugin page (region: reference routes)
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveKitReference(query, res);
    return;
  }
  if (urlPath.startsWith('/kit-reference/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveKitReferenceFile(urlPath, res);
    return;
  }
  if (urlPath.startsWith('/kit-demo/')) {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveKitDemo(urlPath.split('/').filter(Boolean), query, res);
    return;
  }
  if (urlPath === '/uipreview' || urlPath === '/uipreview/') {
    if (req.method !== 'GET') return send(res, 405, 'GET only');
    serveToolPreview(res);
    return;
  }
  if (req.method === 'HEAD') return send(res, 200, '', 'text/plain; charset=utf-8');
  serveStatic(urlPath, res);
});

server.listen(PORT, '127.0.0.1', () => {
  const boundPort = server.address().port; // differs from PORT when --port 0
  const url = 'http://localhost:' + boundPort + '/';
  console.log('');
  console.log('  +--------------------+');
  console.log('  | APC/HUB_           |');
  console.log('  | hub server ' + VERSION + '    |');
  console.log('  +--------------------+');
  console.log('');
  console.log('  -> ' + url);
  console.log('  repo: ' + REPO_ROOT);
  console.log('');
  if (!NO_OPEN) {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }
});
