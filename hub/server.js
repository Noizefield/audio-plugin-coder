'use strict';
/**
 * APC Hub — read-only local dashboard server (zero dependencies, Node stdlib only).
 *
 * Serves hub/ui/ static files plus a read-only JSON API under /api/v1/*.
 * Binds loopback only. GET only. No writes, no script execution.
 *
 * Usage:
 *   node hub/server.js [--port 4872] [--no-open] [--repo <path>]
 *
 * Canonical paths resolve like scripts/lib/Get-ApcPaths.ps1:
 * relative apc.config.json paths resolve from the repo root.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ─── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const PORT = parseInt(flag('--port', '4872'), 10) || 4872;
const NO_OPEN = args.includes('--no-open');
const HUB_DIR = __dirname;
const REPO_ROOT = path.resolve(flag('--repo', path.join(HUB_DIR, '..')));
const UI_DIR = path.join(HUB_DIR, 'ui');
const VERSION = '1.0.0'; // hub server version (APC framework version comes from package.json)

// ─── Small helpers ──────────────────────────────────────────────────────────
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
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
  const live = readJson(livePath, null);
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
function getSkills() {
  const base = path.join(REPO_ROOT, '.agents', 'skills');
  return listDirs(base).map((n) => ({
    id: n,
    hasSkillMd: exists(path.join(base, n, 'SKILL.md')),
    files: listFiles(path.join(base, n)),
    legacy: LEGACY_SKILLS.has(n),
  }));
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

function getDesigns() {
  const manifestPath = path.join(REPO_ROOT, 'design_library', 'manifest.json');
  const manifest = readJson(manifestPath, null);
  if (!manifest) return { present: false, designs: [] };
  const designs = (manifest.designs || []).map((d) => ({
    ...d,
    dirExists: isDir(path.join(REPO_ROOT, 'design_library', d.path || d.id)),
  }));
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
    pluginval: { path: '_tools/pluginval/pluginval.exe', present: exists(path.join(REPO_ROOT, '_tools', 'pluginval', 'pluginval.exe')) },
    visage: { path: '_tools/visage', present: isDir(path.join(REPO_ROOT, '_tools', 'visage')), enabled: enableVisage },
    debugView: { path: '_tools/DebugView', present: isDir(path.join(REPO_ROOT, '_tools', 'DebugView')) },
    toolchain: { node: process.version, python, cmake },
  };
  toolCacheAt = now;
  return toolCache;
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
    return { id, file: id + '.md', raw: fs.readFileSync(full, 'utf8') };
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
    out = { installed, upstream: null, state: 'UNCHECKED', reason: 'no-releases' };
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
  checks.push({ id: 'legacy-skills', label: legacy.length ? 'legacy skill_* dirs: ' + legacy.join(', ') : 'no legacy skill dirs', level: legacy.length ? 'warn' : 'ok' });
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
  return { checks };
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
function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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
        livePresent: cfg.livePresent, live: cfg.live, example: cfg.example,
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
    case 'update': return sendJson(res, 200, await getUpdate());
    case 'consistency': return sendJson(res, 200, getConsistency());
    default: return sendJson(res, 404, { error: 'unknown-resource' });
  }
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
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
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'GET only');
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    const parts = urlPath.split('/').filter(Boolean);
    if (parts[1] !== 'v1') return sendJson(res, 404, { error: 'unknown-api-version' });
    handleApi(parts, null, res).catch(() => sendJson(res, 500, { error: 'internal' }));
    return;
  }
  if (req.method === 'HEAD') return send(res, 200, '', 'text/plain; charset=utf-8');
  serveStatic(urlPath, res);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://localhost:' + PORT + '/';
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
