'use strict';
/**
 * apc-preview - the instant preview loop.
 *
 *   apc watch <Plugin> [--once] [--json] [--port P] [--no-serve] [--poll]
 *                      [--debounce MS] [--restart-standalone <exe>]
 *   apc screenshot <Plugin> [--out F] [--width W --height H] [--scale S[,S..]|endpoints]
 *                      [--dpr N] [--html F] [--browser PATH] [--json]
 *                      [--compare baseline.png] [--tolerance N] [--max-mismatch PCT] [--diff F]
 *   apc screenshot --compare a.png --against b.png      (pure image diff, no browser)
 *
 * Loaded by bin/apc.js as a pluggable module: run(args, ctx) -> exit code
 * (number | Promise<number>), ctx = { root, resolvePaths, pluginPath, readConfig, cmd }.
 *
 * Zero dependencies, Node 18+. Guide: .agents/guides/preview-loop.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const DEFAULT_PORT = 4873;
const DEFAULT_DEBOUNCE_MS = 250;
const COMPOSE_SCRIPT = path.join(__dirname, 'ui-compose.js');
const LINT_SCRIPT = path.join(__dirname, 'ui-lint.js');
const STAMP_NAME = '.apc-reload';

// ─── args ───────────────────────────────────────────────────────────────────
const VALUE_FLAGS = new Set([
  '--out', '--width', '--height', '--scale', '--dpr', '--html', '--browser', '--compare', '--against',
  '--tolerance', '--max-mismatch', '--diff', '--port', '--debounce', '--restart-standalone', '--budget-ms', '--poll-ms',
]);
function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(0, eq)] = a.slice(eq + 1); continue; }
      if (VALUE_FLAGS.has(a) && i + 1 < args.length) { flags[a] = args[++i]; continue; }
      flags[a] = true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
function numFlag(flags, name, def) {
  if (flags[name] === undefined) return def;
  const n = Number(flags[name]);
  return Number.isFinite(n) ? n : NaN;
}

// ─── PNG (pure JS, zlib only) ───────────────────────────────────────────────
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA (Uint8Array/Buffer, 4 bytes per pixel) as an 8-bit RGBA PNG. */
function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: pixel buffer size mismatch');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Decode a non-interlaced PNG (gray / RGB / palette / gray+alpha / RGBA, 1-16 bit) -> {width,height,data:RGBA}. */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG file');
  let pos = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  if (ihdr.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const { width, height, depth, colorType } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported PNG colour type ' + colorType);
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error('unsupported PNG bit depth ' + depth);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('PNG data truncated');
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      switch (ft) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error('bad PNG filter type ' + ft);
      }
      out[dst + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (row, idx) => { // idx-th sample (0-based) of a scanline, scaled to 0..255
    if (depth === 8) return out[row + idx];
    if (depth === 16) return out[row + idx * 2];
    const perByte = 8 / depth;
    const byte = out[row + Math.floor(idx / perByte)];
    const shift = 8 - depth * ((idx % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const maxVal = depth === 16 ? 255 : (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        for (let k = 0; k < 4; k++) rgba[o + k] = sample(row, x * 4 + k);
      } else if (colorType === 2) {
        for (let k = 0; k < 3; k++) rgba[o + k] = sample(row, x * 3 + k);
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        const g = Math.round((sample(row, x) * 255) / maxVal);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = 255;
      } else if (colorType === 4) {
        const g = sample(row, x * 2);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = sample(row, x * 2 + 1);
      } else { // palette
        const i = sample(row, x);
        if (!plte || i * 3 + 2 >= plte.length) throw new Error('PNG palette index out of range');
        rgba[o] = plte[i * 3]; rgba[o + 1] = plte[i * 3 + 1]; rgba[o + 2] = plte[i * 3 + 2];
        rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
      }
    }
  }
  return { width, height, data: rgba };
}

/**
 * Pixel diff of two decoded images.
 * A pixel mismatches when any channel differs by more than `tolerance` (0-255).
 * -> { width, height, total, mismatched, percent, maxDelta, sizeMismatch, diff }
 * diff is an RGBA image (red = mismatch over a dimmed copy of the baseline) or null on size mismatch.
 */
function diffPng(a, b, opts) {
  const tolerance = opts && Number.isFinite(opts.tolerance) ? opts.tolerance : 0;
  if (a.width !== b.width || a.height !== b.height) {
    return {
      width: a.width, height: a.height, total: a.width * a.height, mismatched: a.width * a.height,
      percent: 100, maxDelta: 255, sizeMismatch: true, sizes: { baseline: [a.width, a.height], actual: [b.width, b.height] }, diff: null,
    };
  }
  const total = a.width * a.height;
  const diff = new Uint8Array(total * 4);
  let mismatched = 0;
  let maxDelta = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    let d = 0;
    for (let k = 0; k < 4; k++) {
      const delta = Math.abs(a.data[o + k] - b.data[o + k]);
      if (delta > d) d = delta;
    }
    if (d > maxDelta) maxDelta = d;
    if (d > tolerance) {
      mismatched++;
      diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 0; diff[o + 3] = 255;
    } else {
      const g = Math.round(a.data[o] * 0.299 + a.data[o + 1] * 0.587 + a.data[o + 2] * 0.114);
      const dim = Math.round(g * 0.35 + 255 * 0.65);
      diff[o] = diff[o + 1] = diff[o + 2] = dim; diff[o + 3] = 255;
    }
  }
  return {
    width: a.width, height: a.height, total, mismatched,
    percent: total ? (mismatched / total) * 100 : 0, maxDelta, sizeMismatch: false,
    diff: { width: a.width, height: a.height, data: diff },
  };
}

// ─── browser discovery ──────────────────────────────────────────────────────
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'chrome', 'msedge', 'brave-browser'];
const WIN_NAMES = ['msedge', 'chrome', 'chromium'];

/** Well-known install locations for a platform (strings only; nothing is touched on disk). */
function candidatePaths(platform, env) {
  env = env || process.env;
  const out = [];
  if (platform === 'win32') {
    const j = path.win32.join;
    const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432, env.LOCALAPPDATA].filter(Boolean);
    for (const b of bases) out.push(j(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const b of bases) out.push(j(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    for (const b of bases) out.push(j(b, 'Chromium', 'Application', 'chrome.exe'));
    for (const b of bases) out.push(j(b, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  } else if (platform === 'darwin') {
    const apps = ['/Applications', env.HOME ? path.posix.join(env.HOME, 'Applications') : null].filter(Boolean);
    for (const a of apps) {
      out.push(path.posix.join(a, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
      out.push(path.posix.join(a, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'));
      out.push(path.posix.join(a, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      out.push(path.posix.join(a, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'));
    }
  } else {
    out.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium', '/opt/google/chrome/chrome', '/opt/microsoft/msedge/msedge');
  }
  return out;
}

/**
 * Find a Chromium-family browser (Edge / Chrome / Chromium).
 * opts: { explicit, platform, env, exists } - all injectable for tests.
 * Order: --browser, $APC_BROWSER, well-known install paths, then PATH lookup.
 * -> { path: string|null, source: string|null, searched: string[] }
 */
function findBrowser(opts) {
  opts = opts || {};
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const exists = opts.exists || ((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  const searched = [];
  const tryPath = (p, source) => {
    if (!p) return null;
    searched.push(p);
    return exists(p) ? { path: p, source, searched } : null;
  };
  let hit = tryPath(opts.explicit, '--browser');
  if (hit) return hit;
  hit = tryPath(env.APC_BROWSER, 'APC_BROWSER');
  if (hit) return hit;
  for (const p of candidatePaths(platform, env)) {
    hit = tryPath(p, 'known install path');
    if (hit) return hit;
  }
  const delim = platform === 'win32' ? ';' : ':';
  const pathVar = env.PATH || env.Path || env.path || '';
  const dirs = pathVar.split(delim).filter(Boolean);
  const names = platform === 'win32' ? WIN_NAMES : LINUX_NAMES;
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const d of dirs) {
    for (const n of names) {
      for (const e of exts) {
        hit = tryPath(join(d, n + e), 'PATH');
        if (hit) return hit;
      }
    }
  }
  return { path: null, source: null, searched };
}

// ─── debounce + watching ────────────────────────────────────────────────────
/** Trailing-edge debounce. `timers` is injectable ({setTimeout, clearTimeout}) for tests. */
function debounce(fn, ms, timers) {
  const t = timers || { setTimeout, clearTimeout };
  let handle = null;
  const wrapped = (...a) => {
    if (handle !== null) t.clearTimeout(handle);
    handle = t.setTimeout(() => { handle = null; fn(...a); }, ms);
  };
  wrapped.cancel = () => { if (handle !== null) { t.clearTimeout(handle); handle = null; } };
  wrapped.pending = () => handle !== null;
  return wrapped;
}

function snapshotTree(dirs, ignoreDirs) {
  const snap = new Map();
  const skip = ignoreDirs || new Set(['node_modules', '.git']);
  const walkDir = (root, dir, depth) => {
    if (depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walkDir(root, full, depth + 1); continue; }
      try {
        const st = fs.statSync(full);
        snap.set(full, st.mtimeMs + ':' + st.size);
      } catch { /* vanished */ }
    }
  };
  for (const d of dirs) walkDir(d, d, 0);
  return snap;
}

/** Polling fallback (used where fs.watch recursive is unavailable, and by --poll). */
function createPollWatcher(dirs, onChange, opts) {
  const intervalMs = (opts && opts.intervalMs) || 500;
  let prev = snapshotTree(dirs);
  const timer = setInterval(() => {
    const next = snapshotTree(dirs);
    for (const [f, sig] of next) if (prev.get(f) !== sig) onChange(f);
    for (const f of prev.keys()) if (!next.has(f)) onChange(f);
    prev = next;
  }, intervalMs);
  if (timer.unref) timer.unref();
  return { mode: 'poll', close() { clearInterval(timer); } };
}

/** Recursive fs.watch where supported (Windows, macOS, Node >= 20 on Linux), else polling. */
function createWatcher(dirs, onChange, opts) {
  opts = opts || {};
  if (!opts.poll) {
    const watchers = [];
    try {
      for (const d of dirs) {
        const w = fs.watch(d, { recursive: true }, (evt, name) => { if (name) onChange(path.join(d, String(name))); });
        w.on('error', () => { /* directory removed: the poll fallback is not retried */ });
        watchers.push(w);
      }
      return { mode: 'fs.watch', close() { for (const w of watchers) { try { w.close(); } catch { /* closed */ } } } };
    } catch {
      for (const w of watchers) { try { w.close(); } catch { /* ignore */ } }
    }
  }
  return createPollWatcher(dirs, onChange, { intervalMs: opts.pollMs });
}

/** Paths the watcher must never react to (our own outputs would loop forever). */
function shouldIgnore(rel, ctx) {
  const p = rel.split(path.sep).join('/');
  const base = path.posix.basename(p);
  if (base === STAMP_NAME || base.startsWith('.apc-shot-')) return true;
  if (/(^|\/)(screenshots|node_modules|\.git)(\/|$)/.test(p)) return true;
  if (/\.(bak|tmp|swp|png)$/i.test(base) || base.endsWith('~')) return true;
  if (ctx && ctx.composing) {
    if (/(^|\/)apc-ui(\/|$)/.test(p)) return true; // vendored kit copy written by compose
    if (ctx.composeOutputs && ctx.composeOutputs.has(base)) return true;
  }
  return false;
}

// ─── compose + lint cycle ───────────────────────────────────────────────────
function pluginUiLayout(pluginDir) {
  const design = path.join(pluginDir, 'Design');
  const ui = path.join(pluginDir, 'Source', 'ui');
  const roots = [design, ui].filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
  return { design, ui, roots, hasDesign: roots.includes(design) };
}
function findUiMap(designDir) {
  try {
    const lib = require(COMPOSE_SCRIPT);
    return lib.findMapFile(designDir, null);
  } catch { return null; }
}
function composeOutputName(mapFile) {
  const m = path.basename(mapFile).match(/^v(\d+)-ui-map\.json$/);
  return m ? `v${m[1]}-test.html` : 'v1-test.html';
}
/** Newest Design/vN-test.html (the composed preview), else Source/ui/public/index.html. */
function findPreviewHtml(pluginDir, explicit) {
  if (explicit) {
    const f = path.isAbsolute(explicit) ? explicit : path.join(pluginDir, explicit);
    return fs.existsSync(f) ? f : null;
  }
  const design = path.join(pluginDir, 'Design');
  let best = null;
  try {
    const files = fs.readdirSync(design).filter((f) => /^v(\d+)-test\.html?$/i.test(f));
    files.sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
    if (files.length) best = path.join(design, files[0]);
  } catch { /* no Design dir */ }
  if (best) return best;
  const shipped = path.join(pluginDir, 'Source', 'ui', 'public', 'index.html');
  return fs.existsSync(shipped) ? shipped : null;
}

function runNode(script, args, root) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', env: { ...process.env, APC_ROOT: root }, timeout: 60000, windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

/**
 * One reload cycle: compose (when a ui-map exists) -> lint -> write the stamp.
 * Never throws; failures are reported in the result.
 */
function runCycle(ctx, pluginDir, opts) {
  opts = opts || {};
  const layout = pluginUiLayout(pluginDir);
  const res = { seq: opts.seq || 1, at: new Date().toISOString(), changed: opts.changed || [], compose: { ran: false }, lint: { ran: false }, ok: true };
  const mapFile = layout.hasDesign ? findUiMap(layout.design) : null;
  if (mapFile && opts.compose !== false) {
    const r = runNode(COMPOSE_SCRIPT, [pluginDir], ctx.root);
    res.compose = { ran: true, ok: r.status === 0, output: composeOutputName(mapFile), message: (r.stdout || r.stderr || (r.error && r.error.message) || '').trim().split(/\r?\n/)[0] };
    if (!res.compose.ok) res.ok = false;
  } else {
    res.compose = { ran: false, reason: mapFile ? 'disabled' : 'no ui-map (hand-written preview: reload only)' };
  }
  if (mapFile && opts.lint !== false) {
    const r = runNode(LINT_SCRIPT, [pluginDir, '--json'], ctx.root);
    let j = null;
    try { j = JSON.parse(r.stdout); } catch { /* not json */ }
    if (j) {
      res.lint = { ran: true, errors: j.errors.length, warnings: j.warnings.length, firstError: j.errors[0] || null };
      if (j.errors.length) res.lint.ok = false;
    } else {
      res.lint = { ran: true, errors: 1, warnings: 0, firstError: (r.stderr || r.stdout || 'ui-lint produced no JSON').trim().split(/\r?\n/)[0] };
    }
  } else {
    res.lint = { ran: false, reason: mapFile ? 'disabled' : 'no ui-map' };
  }
  const preview = findPreviewHtml(pluginDir);
  res.preview = preview ? path.relative(pluginDir, preview).split(path.sep).join('/') : null;
  const stampDir = layout.hasDesign ? layout.design : (layout.roots[0] || pluginDir);
  const stamp = path.join(stampDir, STAMP_NAME);
  try {
    fs.writeFileSync(stamp, JSON.stringify({ seq: res.seq, at: res.at, ok: res.ok, changed: res.changed.slice(0, 50), preview: res.preview }) + '\n');
    res.stamp = path.relative(pluginDir, stamp).split(path.sep).join('/');
  } catch (e) {
    res.stamp = null;
    res.stampError = e.message;
  }
  return res;
}

// ─── SSE reload server ──────────────────────────────────────────────────────
function reloadSnippet(port) {
  return '<script>/* apc watch live reload */(function(){try{var es=new EventSource("http://127.0.0.1:' + port +
    '/reload");es.onmessage=function(e){var d={};try{d=JSON.parse(e.data)}catch(x){}if(d.type==="reload")location.reload();};}catch(x){}})();</script>';
}
function injectSnippet(html, snippet) {
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, () => snippet + '</body>');
  return html + snippet;
}
function isLoopbackHost(h) {
  const m = String(h || '').toLowerCase().match(/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d+)?$/);
  return !!m && (m[1] === 'localhost' || m[1] === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(m[1]));
}
function corsOrigin(origin) {
  if (!origin) return null;
  if (origin === 'null') return 'null'; // file:// pages
  try { const u = new URL(origin); return isLoopbackHost(u.host) ? origin : null; } catch { return null; }
}
const SERVE_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/**
 * Tiny loopback server: GET /reload (SSE), GET / (preview page with the reload
 * snippet injected), GET /state (last cycle JSON), GET /<file> (static files next
 * to the preview). Read-only; GET/HEAD only; loopback Host only.
 * opts: { getPreviewFile: () => abs path|null, getState: () => object, port }
 */
function createReloadServer(opts) {
  const clients = new Set();
  let boundPort = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('GET only'); }
    if (!isLoopbackHost(req.headers.host)) { res.writeHead(403); return res.end('loopback only'); }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/reload') {
      const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' };
      const origin = corsOrigin(req.headers.origin);
      if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
      res.writeHead(200, headers);
      const st = opts.getState ? opts.getState() : {};
      res.write('retry: 1000\ndata: ' + JSON.stringify({ type: 'hello', seq: st.seq || 0 }) + '\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    if (url.pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(opts.getState ? opts.getState() : {}));
    }
    const previewFile = opts.getPreviewFile ? opts.getPreviewFile() : null;
    if (!previewFile) { res.writeHead(404); return res.end('no preview html yet'); }
    const baseDir = path.dirname(previewFile);
    let target;
    if (url.pathname === '/' || url.pathname === '/index.html') {
      target = previewFile;
    } else {
      let rel;
      try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('bad path'); }
      const segs = rel.split('/').filter(Boolean);
      if (segs.some((s) => s === '..' || s.startsWith('.') || s.includes('\\') || s.includes(':'))) { res.writeHead(403); return res.end('forbidden'); }
      target = path.resolve(baseDir, ...segs);
      if (target !== baseDir && !target.startsWith(baseDir + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
    }
    const ext = path.extname(target).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SERVE_TYPES, ext)) { res.writeHead(403); return res.end('forbidden type'); }
    fs.readFile(target, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      let body = data;
      if (target === previewFile) body = Buffer.from(injectSnippet(data.toString('utf8'), reloadSnippet(boundPort)), 'utf8');
      res.writeHead(200, { 'Content-Type': SERVE_TYPES[ext], 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    });
    return undefined;
  });
  const heartbeat = setInterval(() => { for (const c of clients) c.write(': keep-alive\n\n'); }, 15000);
  if (heartbeat.unref) heartbeat.unref();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port === undefined ? DEFAULT_PORT : opts.port, '127.0.0.1', () => {
      boundPort = server.address().port;
      resolve({
        server, port: boundPort, url: 'http://127.0.0.1:' + boundPort + '/',
        clientCount: () => clients.size,
        broadcast(payload) {
          const msg = 'data: ' + JSON.stringify(payload) + '\n\n';
          for (const c of clients) c.write(msg);
          return clients.size;
        },
        close() {
          clearInterval(heartbeat);
          for (const c of clients) { try { c.end(); } catch { /* gone */ } }
          clients.clear();
          return new Promise((r) => { server.close(() => r()); if (server.closeAllConnections) server.closeAllConnections(); });
        },
      });
    });
  });
}

// ─── optional Standalone restarter ──────────────────────────────────────────
function createRestarter(exe, deps) {
  const spawnFn = (deps && deps.spawn) || spawn;
  let child = null;
  const stop = () => new Promise((resolve) => {
    if (!child) return resolve();
    const c = child;
    child = null;
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    c.once('exit', fin);
    try { c.kill(); } catch { fin(); }
    const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } fin(); }, 2000);
    if (t.unref) t.unref();
  });
  const start = () => {
    child = spawnFn(exe, [], { stdio: 'ignore', detached: false, windowsHide: false });
    child.on('error', () => { child = null; });
    child.on('exit', () => { child = null; });
    return child;
  };
  return {
    start,
    stop,
    async restart() { await stop(); return start(); },
    running: () => child !== null,
  };
}

// ─── watch ──────────────────────────────────────────────────────────────────
function stamp() { return new Date().toTimeString().slice(0, 8); }
function summarize(cycle) {
  const c = cycle.compose.ran ? (cycle.compose.ok ? 'compose ok' : 'compose FAILED: ' + cycle.compose.message) : 'compose skipped';
  const l = cycle.lint.ran ? `lint ${cycle.lint.errors} error(s) ${cycle.lint.warnings} warning(s)` : 'lint skipped';
  return `cycle ${cycle.seq}: ${cycle.changed.length} file(s) changed | ${c} | ${l}`;
}

/**
 * Start the watch loop. Resolves with a handle:
 *   { cycles, lastCycle, url, port, mode, runNow(changed), close() }
 * opts: { poll, debounceMs, port|null (no server), restartStandalone, onCycle(cycle) }
 */
async function startWatch(ctx, pluginDir, opts) {
  opts = opts || {};
  const layout = pluginUiLayout(pluginDir);
  if (!layout.roots.length) throw new Error(`no WebView frontend source found in ${pluginDir} (expected Design/ or Source/ui/)`);
  const mapFile = layout.hasDesign ? findUiMap(layout.design) : null;
  const state = { seq: 0, last: null };
  const ignoreCtx = { composing: !!mapFile, composeOutputs: new Set(mapFile ? [composeOutputName(mapFile)] : []) };
  const restarter = opts.restartStandalone ? createRestarter(opts.restartStandalone, opts.deps) : null;
  let server = null;
  if (opts.port !== null && opts.port !== undefined) {
    server = await createReloadServer({
      port: opts.port,
      getState: () => ({ seq: state.seq, last: state.last }),
      getPreviewFile: () => findPreviewHtml(pluginDir, opts.html),
    });
  }
  const handle = { cycles: 0, lastCycle: null, url: server ? server.url : null, port: server ? server.port : null, mode: null };
  let busy = false;
  let queued = null;
  const cycleNow = async (changed) => {
    if (busy) { queued = (queued || []).concat(changed); return; }
    busy = true;
    try {
      state.seq += 1;
      const cycle = runCycle(ctx, pluginDir, { seq: state.seq, changed });
      state.last = cycle;
      handle.cycles = state.seq;
      handle.lastCycle = cycle;
      if (server) {
        cycle.clients = server.broadcast(cycle.ok ? { type: 'reload', seq: cycle.seq, at: cycle.at } : { type: 'error', seq: cycle.seq, message: cycle.compose.message || (cycle.lint.firstError || 'cycle failed') });
      }
      if (restarter && cycle.ok) await restarter.restart();
      if (opts.onCycle) opts.onCycle(cycle);
    } finally {
      busy = false;
    }
    if (queued) { const q = queued; queued = null; await cycleNow(q); }
  };
  const pending = new Set();
  const deb = debounce(() => {
    const changed = Array.from(pending);
    pending.clear();
    cycleNow(changed).catch(() => { /* cycle errors are reported in the result */ });
  }, opts.debounceMs === undefined ? DEFAULT_DEBOUNCE_MS : opts.debounceMs);
  const watcher = createWatcher(layout.roots, (abs) => {
    const rel = path.relative(pluginDir, abs).split(path.sep).join('/');
    if (shouldIgnore(rel, ignoreCtx)) return;
    pending.add(rel);
    deb();
  }, { poll: opts.poll, pollMs: opts.pollMs });
  handle.mode = watcher.mode;
  handle.roots = layout.roots;
  handle.runNow = (changed) => cycleNow(changed || []);
  handle.restarter = restarter;
  if (restarter) restarter.start();
  handle.close = async () => {
    deb.cancel();
    watcher.close();
    if (restarter) await restarter.stop();
    if (server) await server.close();
  };
  return handle;
}

async function runWatch(args, ctx) {
  const { positional, flags } = parseArgs(args);
  const name = positional[0];
  if (!name) {
    console.error('Usage: apc watch <Plugin> [--once] [--json] [--port P] [--no-serve] [--poll] [--debounce MS] [--restart-standalone <exe>]');
    return 2;
  }
  const pluginDir = ctx.pluginPath(name);
  if (!fs.existsSync(pluginDir)) { console.error(`Plugin '${name}' not found at ${pluginDir}`); return 2; }
  const status = readJson(path.join(pluginDir, 'status.json'));
  if (status && String(status.ui_framework || '').toLowerCase() === 'visage') {
    console.error(`'${name}' uses the Visage UI framework: apc watch reloads WebView frontends only.`);
    return 2;
  }
  const asJson = !!flags['--json'];
  const port = flags['--no-serve'] || flags['--once'] ? null : numFlag(flags, '--port', DEFAULT_PORT);
  if (Number.isNaN(port) || (port !== null && (port < 0 || port > 65535))) { console.error('--port must be 0-65535'); return 2; }
  const debounceMs = numFlag(flags, '--debounce', DEFAULT_DEBOUNCE_MS);
  if (Number.isNaN(debounceMs) || debounceMs < 0) { console.error('--debounce must be a number of milliseconds'); return 2; }
  let exe = flags['--restart-standalone'];
  if (exe === true) { console.error('--restart-standalone needs a path to the Standalone executable'); return 2; }
  if (exe) {
    exe = path.resolve(exe);
    if (!fs.existsSync(exe)) { console.error(`--restart-standalone: ${exe} does not exist`); return 2; }
  }
  const layout = pluginUiLayout(pluginDir);
  if (!layout.roots.length) { console.error(`no WebView frontend source found in ${pluginDir} (expected Design/ or Source/ui/)`); return 1; }

  if (flags['--once']) {
    const cycle = runCycle(ctx, pluginDir, { seq: 1, changed: [] });
    if (asJson) console.log(JSON.stringify(cycle, null, 2));
    else {
      console.log(summarize(cycle));
      if (cycle.preview) console.log(`preview: ${cycle.preview}  stamp: ${cycle.stamp || '(not written)'}`);
      if (!cycle.ok && cycle.lint.firstError) console.log(`lint: ${cycle.lint.firstError}`);
    }
    return cycle.ok && !(cycle.lint.ran && cycle.lint.errors) ? 0 : 1;
  }

  let handle;
  try {
    handle = await startWatch(ctx, pluginDir, {
      poll: !!flags['--poll'], debounceMs, port, restartStandalone: exe,
      onCycle: (cycle) => {
        if (asJson) console.log(JSON.stringify(cycle));
        else console.log(`[${stamp()}] ${summarize(cycle)}${cycle.clients !== undefined ? ` | ${cycle.clients} browser(s) notified` : ''}`);
      },
    });
  } catch (e) {
    console.error(e && e.code === 'EADDRINUSE' ? `port ${port} is in use (pick another with --port)` : (e.message || String(e)));
    return 1;
  }
  const info = { watching: handle.roots, mode: handle.mode, preview: handle.url, reloadEndpoint: handle.url ? handle.url + 'reload' : null };
  if (asJson) console.log(JSON.stringify({ event: 'ready', ...info }));
  else {
    console.log(`watching ${handle.roots.map((r) => path.relative(ctx.root, r) || r).join(', ')} (${handle.mode}, debounce ${debounceMs} ms)`);
    if (handle.url) {
      console.log(`live preview:   ${handle.url}   (page auto-reloads)`);
      console.log(`reload stream:  ${handle.url}reload   (add the snippet from .agents/guides/preview-loop.md to other preview pages)`);
    }
    console.log('Ctrl+C to stop.');
  }
  return new Promise((resolve) => {
    const stop = async () => { await handle.close(); resolve(0); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

// ─── screenshot ─────────────────────────────────────────────────────────────
const HOST_MIN_W = 640; // host window floor: above every clamp seen in headless Chromium/Edge
const HOST_MIN_H = 480;
const NO_ANIMATION_CSS = '<style data-apc-shot>*,*::before,*::after{animation:none!important;transition:none!important;animation-delay:0s!important;scroll-behavior:auto!important;caret-color:transparent!important}</style>';

function plateSize(pluginDir) {
  const design = path.join(pluginDir, 'Design');
  const mapFile = findUiMap(design);
  const map = mapFile ? readJson(mapFile) : null;
  const L = map && map.layout;
  const plate = L && L.plate;
  if (plate && plate.cols > 0 && plate.rows > 0) {
    const cell = Number(L.cell_px) > 0 ? Number(L.cell_px) : 16;
    return { width: Math.round(plate.cols * cell), height: Math.round(plate.rows * cell), range: Array.isArray(L.scale_range) ? L.scale_range : null, fromMap: true };
  }
  return { width: 800, height: 500, range: null, fromMap: false };
}

/** --scale "100" | "50,100,300" | "endpoints" -> sorted unique percent list, or null if invalid. */
function parseScales(value, range) {
  if (value === undefined) return [100];
  const raw = String(value).trim().toLowerCase();
  let list;
  if (raw === 'endpoints') {
    const lo = range ? range[0] : 0.5;
    const hi = range ? range[1] : 3;
    list = [Math.round(lo * 100), 100, Math.round(hi * 100)];
  } else {
    list = raw.split(',').map((s) => parseFloat(s.replace('%', '')));
  }
  if (!list.length || list.some((n) => !Number.isFinite(n) || n < 10 || n > 800)) return null;
  return Array.from(new Set(list)).sort((a, b) => a - b);
}

function suffixPath(file, label) {
  const ext = path.extname(file);
  const stem = ext ? file.slice(0, -ext.length) : file;
  return stem + '-' + label + (ext || '.png');
}
function withExt(file) { return /\.png$/i.test(file) ? file : file + '.png'; }

/** Chromium argv for one deterministic screenshot. Exported so tests can assert the flags. */
function buildChromeArgs(o) {
  return [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
    '--force-prefers-reduced-motion', '--run-all-compositor-stages-before-draw',
    `--virtual-time-budget=${o.budgetMs}`,
    `--force-device-scale-factor=${o.dpr}`,
    `--window-size=${o.width},${o.height}`,
    `--user-data-dir=${o.profileDir}`,
    `--screenshot=${o.out}`,
    o.url,
  ];
}

/**
 * Render one shot. The page is loaded inside an <iframe> of exactly W x H CSS px
 * inside a larger host window, then the capture is cropped to W*dpr x H*dpr.
 * Reason: headless Chromium/Edge clamps small window sizes (a 320x160 window lays
 * the page out at a wider viewport), which would make the 50 % endpoint shots lie.
 * The iframe's own viewport is exact, so vw/vh/media queries behave like a real resize.
 */
function renderOne(browserPath, htmlFile, out, o) {
  const dir = path.dirname(htmlFile);
  const tmpHtml = path.join(dir, `.apc-shot-${process.pid}-${Date.now()}.html`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-shot-profile-'));
  const wrapper = path.join(profileDir, 'host.html');
  const raw = path.join(profileDir, 'raw.png');
  let src = fs.readFileSync(htmlFile, 'utf8');
  src = /<\/head\s*>/i.test(src) ? src.replace(/<\/head\s*>/i, () => NO_ANIMATION_CSS + '</head>') : NO_ANIMATION_CSS + src;
  fs.writeFileSync(tmpHtml, src);
  fs.writeFileSync(wrapper, '<!DOCTYPE html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}' +
    `iframe{display:block;border:0;width:${o.width}px;height:${o.height}px}</style><iframe scrolling="no" src="${pathToFileURL(tmpHtml).href}"></iframe>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
  try {
    const win = { width: Math.max(o.width, HOST_MIN_W), height: Math.max(o.height, HOST_MIN_H) };
    const argv = buildChromeArgs({ ...o, ...win, profileDir, out: raw, url: pathToFileURL(wrapper).href });
    const r = spawnSync(browserPath, argv, { encoding: 'utf8', timeout: o.timeoutMs || 90000, windowsHide: true });
    if (r.error) return { ok: false, error: r.error.message };
    if (!fs.existsSync(raw) || fs.statSync(raw).size === 0) {
      return { ok: false, error: `browser exited ${r.status} without writing a screenshot${r.stderr ? ': ' + r.stderr.trim().split(/\r?\n/).slice(-2).join(' | ') : ''}` };
    }
    const full = decodePng(fs.readFileSync(raw));
    const cw = Math.round(o.width * o.dpr);
    const ch = Math.round(o.height * o.dpr);
    if (full.width < cw || full.height < ch) return { ok: false, error: `capture ${full.width}x${full.height}px is smaller than the requested ${cw}x${ch}px` };
    const crop = new Uint8Array(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      crop.set(full.data.subarray(y * full.width * 4, y * full.width * 4 + cw * 4), y * cw * 4);
      for (let x = 0; x < cw; x++) crop[(y * cw + x) * 4 + 3] = 255; // opaque, like a window capture
    }
    fs.writeFileSync(out, encodePng(cw, ch, crop));
    return { ok: true };
  } finally {
    try { fs.rmSync(tmpHtml, { force: true }); } catch { /* ignore */ }
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function compareFiles(baselinePath, actualPath, o) {
  const baseline = decodePng(fs.readFileSync(baselinePath));
  const actual = decodePng(fs.readFileSync(actualPath));
  const d = diffPng(baseline, actual, { tolerance: o.tolerance });
  const result = {
    baseline: baselinePath, actual: actualPath, tolerance: o.tolerance, maxMismatchPercent: o.maxMismatch,
    width: actual.width, height: actual.height, total: d.total, mismatched: d.mismatched,
    percent: Math.round(d.percent * 10000) / 10000, maxDelta: d.maxDelta, sizeMismatch: d.sizeMismatch,
    pass: !d.sizeMismatch && d.percent <= o.maxMismatch,
  };
  if (d.sizeMismatch) result.sizes = d.sizes;
  if (d.diff && d.mismatched > 0 && o.diffOut) {
    fs.mkdirSync(path.dirname(o.diffOut), { recursive: true });
    fs.writeFileSync(o.diffOut, encodePng(d.diff.width, d.diff.height, d.diff.data));
    result.diffImage = o.diffOut;
  }
  return result;
}

function printCompare(c) {
  if (c.sizeMismatch) {
    console.log(`  compare: SIZE MISMATCH baseline ${c.sizes.baseline.join('x')} vs actual ${c.sizes.actual.join('x')}`);
  } else {
    console.log(`  compare: ${c.mismatched}/${c.total} px differ (${c.percent}%), max channel delta ${c.maxDelta}, tolerance ${c.tolerance}, allowed ${c.maxMismatchPercent}% -> ${c.pass ? 'PASS' : 'FAIL'}`);
  }
  if (c.diffImage) console.log(`  diff image: ${c.diffImage}`);
}

async function runScreenshot(args, ctx) {
  const { positional, flags } = parseArgs(args);
  const asJson = !!flags['--json'];
  const tolerance = numFlag(flags, '--tolerance', 8);
  const maxMismatch = numFlag(flags, '--max-mismatch', 0.5);
  if (Number.isNaN(tolerance) || tolerance < 0 || tolerance > 255) { console.error('--tolerance must be 0-255 (per-channel difference)'); return 2; }
  if (Number.isNaN(maxMismatch) || maxMismatch < 0 || maxMismatch > 100) { console.error('--max-mismatch must be a percentage 0-100'); return 2; }

  // Pure image diff: no browser, no plugin.
  if (flags['--against']) {
    if (typeof flags['--compare'] !== 'string') { console.error('--against needs --compare <baseline.png>'); return 2; }
    for (const f of [flags['--compare'], flags['--against']]) if (!fs.existsSync(f)) { console.error(`file not found: ${f}`); return 2; }
    let c;
    try { c = compareFiles(path.resolve(flags['--compare']), path.resolve(flags['--against']), { tolerance, maxMismatch, diffOut: flags['--diff'] ? path.resolve(flags['--diff']) : suffixPath(path.resolve(flags['--against']), 'diff') }); }
    catch (e) { console.error('compare failed: ' + e.message); return 1; }
    if (asJson) console.log(JSON.stringify({ compare: c }, null, 2)); else printCompare(c);
    return c.pass ? 0 : 1;
  }

  const name = positional[0];
  if (!name) {
    console.error('Usage: apc screenshot <Plugin> [--out F] [--width W --height H] [--scale S[,S..]|endpoints] [--dpr N] [--html F] [--browser PATH] [--compare baseline.png] [--tolerance N] [--max-mismatch PCT] [--diff F] [--json]');
    return 2;
  }
  const pluginDir = ctx.pluginPath(name);
  if (!fs.existsSync(pluginDir)) { console.error(`Plugin '${name}' not found at ${pluginDir}`); return 2; }

  const found = findBrowser({ explicit: typeof flags['--browser'] === 'string' ? flags['--browser'] : undefined });
  if (!found.path) {
    console.error('No Chromium-family browser found (Edge, Chrome or Chromium is required for headless screenshots).');
    console.error('Searched: ' + (found.searched.length ? found.searched.slice(0, 8).join(', ') + (found.searched.length > 8 ? ', ...' : '') : '(no candidate locations)'));
    console.error('Install Microsoft Edge or Google Chrome, or point to one with --browser <path> or the APC_BROWSER environment variable.');
    return 2;
  }

  let html = findPreviewHtml(pluginDir, typeof flags['--html'] === 'string' ? flags['--html'] : undefined);
  if (!html && flags['--html'] === undefined) {
    // No composed preview yet: compose one if a ui-map exists.
    const cyc = runCycle(ctx, pluginDir, { seq: 0, lint: false });
    if (cyc.compose.ran && cyc.compose.ok) html = findPreviewHtml(pluginDir);
  }
  if (!html) {
    console.error(typeof flags['--html'] === 'string' ? `--html file not found: ${flags['--html']}` : `no preview HTML for '${name}' (expected Design/vN-test.html or Source/ui/public/index.html; run: apc ui-compose ${name})`);
    return 1;
  }

  const base = plateSize(pluginDir);
  const width0 = numFlag(flags, '--width', base.width);
  const height0 = numFlag(flags, '--height', base.height);
  if (!(width0 >= 100 && width0 <= 8000) || !(height0 >= 100 && height0 <= 8000)) { console.error('--width/--height must be 100-8000'); return 2; }
  const dpr = numFlag(flags, '--dpr', 1);
  if (!(dpr >= 0.5 && dpr <= 4)) { console.error('--dpr must be 0.5-4'); return 2; }
  const scales = parseScales(flags['--scale'], base.range);
  if (!scales) { console.error('--scale must be a percentage 10-800, a comma list (50,100,300) or "endpoints"'); return 2; }
  const budgetMs = numFlag(flags, '--budget-ms', 2000);

  const multi = scales.length > 1;
  const defaultOut = path.join(pluginDir, 'Design', 'screenshots', `${name}.png`);
  const outBase = path.resolve(withExt(typeof flags['--out'] === 'string' ? flags['--out'] : defaultOut));
  const compareArg = typeof flags['--compare'] === 'string' ? path.resolve(flags['--compare']) : null;
  if (compareArg && !fs.existsSync(compareArg)) { console.error(`--compare baseline not found: ${compareArg}`); return 2; }
  const compareIsDir = compareArg && fs.statSync(compareArg).isDirectory();

  const shots = [];
  let failed = false;
  if (!asJson) console.log(`browser: ${found.path} (${found.source})\nhtml:    ${path.relative(pluginDir, html)}`);
  for (const s of scales) {
    const w = Math.round(width0 * s / 100);
    const h = Math.round(height0 * s / 100);
    const out = multi ? suffixPath(outBase, String(s)) : outBase;
    const r = renderOne(found.path, html, out, { width: w, height: h, dpr, budgetMs });
    const shot = { scale: s, width: w, height: h, dpr, file: out, ok: r.ok };
    if (!r.ok) { shot.error = r.error; failed = true; shots.push(shot); if (!asJson) console.error(`scale ${s}%: ${r.error}`); continue; }
    try {
      const png = decodePng(fs.readFileSync(out));
      shot.pixels = { width: png.width, height: png.height };
      shot.sizeAsRequested = png.width === Math.round(w * dpr) && png.height === Math.round(h * dpr);
    } catch (e) { shot.decodeError = e.message; }
    if (compareArg) {
      const baseline = compareIsDir ? path.join(compareArg, path.basename(out))
        : (multi ? suffixPath(compareArg, String(s)) : compareArg);
      if (!fs.existsSync(baseline)) {
        shot.compare = { baseline, error: 'baseline not found', pass: false };
        failed = true;
      } else {
        try {
          shot.compare = compareFiles(baseline, out, { tolerance, maxMismatch, diffOut: flags['--diff'] && !multi ? path.resolve(flags['--diff']) : suffixPath(out, 'diff') });
          if (!shot.compare.pass) failed = true;
        } catch (e) { shot.compare = { baseline, error: e.message, pass: false }; failed = true; }
      }
    }
    shots.push(shot);
    if (!asJson) {
      console.log(`scale ${s}%: ${w}x${h} @${dpr}x -> ${out}${shot.pixels ? ` [${shot.pixels.width}x${shot.pixels.height}px${shot.sizeAsRequested ? '' : ', differs from requested'}]` : ''}`);
      if (shot.compare) { if (shot.compare.error) console.log(`  compare: ${shot.compare.error} (${shot.compare.baseline})`); else printCompare(shot.compare); }
    }
  }
  if (asJson) console.log(JSON.stringify({ browser: found.path, html, base: { width: width0, height: height0 }, shots }, null, 2));
  return failed ? 1 : 0;
}

// ─── entry ──────────────────────────────────────────────────────────────────
function run(args, ctx) {
  const cmd = (ctx && ctx.cmd) || 'watch';
  if (cmd === 'watch') return runWatch(args, ctx);
  if (cmd === 'screenshot') return runScreenshot(args, ctx);
  console.error(`apc-preview: unknown command '${cmd}'`);
  return 2;
}

module.exports = {
  run,
  // exported for tests and reuse
  parseArgs, parseScales, encodePng, decodePng, diffPng, crc32,
  findBrowser, candidatePaths, buildChromeArgs, debounce, createPollWatcher, createWatcher, shouldIgnore,
  runCycle, startWatch, createReloadServer, createRestarter, reloadSnippet, injectSnippet,
  findPreviewHtml, plateSize, STAMP_NAME, DEFAULT_PORT,
};
