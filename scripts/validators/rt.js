'use strict';
// Static real-time-safety scanner for plugin C++ sources.
//
//   apc validate rt --plugin <Name> [--json]
//
// Exports validate(pluginDir, opts) -> { checks: [{ check, status, message }] }
// where status is 'pass' | 'fail' | 'warn' | 'info' (picked up by bin/apc.js automatically).
//
// What it does
//   * Reads Source/**/*.{cpp,h,hpp}, strips comments / string / char literals (line numbers
//     are preserved) and locates the definition(s) of processBlock.
//   * Follows unqualified / this-> / Class:: calls to functions defined in the SAME FILE
//     (up to 4 levels) and scans those bodies too.
//   * FAIL  on allocation, vector growth, string construction, locks, file / console /
//     logging I/O, MessageManager::callSync, threads, blocking sleeps.
//   * WARN  on std::map-like containers, dynamic_cast, throw, AudioBuffer::setSize, callAsync.
//   * FAIL  if processBlock does not engage a denormal guard
//     (juce::ScopedNoDenormals or apc::dsp::DenormalGuard).
//   * INFO  if oversampling / lookahead is mentioned but setLatencySamples is never called.
//
// Suppression: put `// apc-rt-ok: <reason>` on the offending line or the line directly above.
// A reason is mandatory; a bare `apc-rt-ok` is ignored. For the denormal check, put it on the
// processBlock signature line (or the line above).
//
// This is a heuristic text scanner, not a compiler: it cannot see through virtual calls,
// other files, or macros. A clean pass means "no known-bad pattern", not "proven RT-safe".

const fs = require('node:fs');
const path = require('node:path');

const MAX_DEPTH = 4;
const SOURCE_EXT = /\.(cpp|h|hpp)$/i;

// ---------------------------------------------------------------------------
// Source preparation
// ---------------------------------------------------------------------------

/** Replace comments and string/char literal contents with spaces; keep newlines and offsets. */
function stripCommentsAndStrings(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && !(src[j] === '\n' && src[j - 1] !== '\\' && !(src[j - 1] === '\r' && src[j - 2] === '\\'))) j++;
      blank(i, j);
      i = j;
    } else if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      i = j;
    } else if (c === '"') {
      // raw string literal?  R"delim( ... )delim"
      if (/(?:^|[^\w])(?:u8|u|U|L)?R$/.test(src.slice(Math.max(0, i - 3), i))) {
        const open = src.indexOf('(', i + 1);
        if (open !== -1 && open - i <= 17) {
          const delim = src.slice(i + 1, open);
          const close = src.indexOf(`)${delim}"`, open + 1);
          const endQuote = close === -1 ? n - 1 : close + delim.length + 1;
          blank(i + 1, endQuote);
          i = endQuote + 1;
          continue;
        }
      }
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
    } else if (c === "'") {
      const prev = src[i - 1] || '';
      if (/[0-9a-fA-F]/.test(prev) && /[0-9a-fA-F]/.test(d || '')) {
        i++; // digit separator, e.g. 1'000'000
        continue;
      }
      let j = i + 1;
      while (j < n && src[j] !== "'" && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

function listSources(dir) {
  const result = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (SOURCE_EXT.test(e.name)) result.push(full);
    }
  };
  walk(dir);
  return result.sort();
}

function buildFile(pluginDir, full) {
  const raw = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  const stripped = stripCommentsAndStrings(raw);
  const lineStarts = [0];
  for (let i = 0; i < raw.length; i++) if (raw[i] === '\n') lineStarts.push(i + 1);
  const rawLines = raw.split(/\r?\n/);
  const suppressed = new Set(); // 1-based line numbers whose findings are suppressed
  const bare = [];              // apc-rt-ok without a reason
  rawLines.forEach((line, idx) => {
    const m = /(?:\/\/|\/\*).*?\bapc-rt-ok\b(:?)\s*([^*]*)/.exec(line);
    if (!m) return;
    const reason = (m[2] || '').replace(/\*\/\s*$/, '').trim();
    if (m[1] === ':' && reason) {
      suppressed.add(idx + 1);
      if (/^\s*(\/\/|\/\*)/.test(line)) suppressed.add(idx + 2); // standalone comment covers next line
    } else {
      bare.push(idx + 1);
    }
  });
  return {
    full,
    rel: path.relative(pluginDir, full).split(path.sep).join('/'),
    raw,
    stripped,
    lineStarts,
    suppressed,
    bare,
    defCache: new Map(),
  };
}

function lineOf(file, offset) {
  let lo = 0;
  let hi = file.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (file.lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

function matchClose(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** All function definitions named `name` in the file: [{ nameIdx, start, end }] (body = start..end). */
function findDefinitions(file, name) {
  if (file.defCache.has(name)) return file.defCache.get(name);
  const defs = [];
  const re = new RegExp(`(?<![\\w.])(?<!->)${name}\\s*\\(`, 'g');
  const t = file.stripped;
  let m;
  while ((m = re.exec(t))) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchClose(t, parenOpen, '(', ')');
    if (parenClose === -1) continue;
    let k = parenClose + 1;
    // skip cv/ref/noexcept/override/final qualifiers
    for (;;) {
      const rest = t.slice(k);
      const q = /^\s*(?:(?:const|noexcept(?:\s*\([^)]*\))?|override|final|volatile)(?!\w)|&&|&)/.exec(rest);
      if (q && q[0].length > 0) k += q[0].length; else break;
    }
    while (k < t.length && /\s/.test(t[k])) k++;
    if (t[k] !== '{') continue;
    const end = matchClose(t, k, '{', '}');
    if (end === -1) continue;
    defs.push({ nameIdx: m.index, start: k, end });
  }
  file.defCache.set(name, defs);
  return defs;
}

const NOT_FOLLOWED = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'catch', 'decltype', 'alignof',
  'static_cast', 'dynamic_cast', 'reinterpret_cast', 'const_cast', 'noexcept', 'assert', 'jassert', 'throw', 'new',
  'delete', 'else', 'do', 'case', 'static_assert', 'defined', 'void', 'float', 'double', 'int', 'bool']);

/** Names of functions called (unqualified, this->, or Class::) inside body text. */
function calledNames(body) {
  const names = new Set();
  const reUnq = /(?<![\w.>:])([A-Za-z_]\w*)\s*\(/g;
  const reThis = /\bthis\s*->\s*([A-Za-z_]\w*)\s*\(/g;
  const reQual = /(?<![\w.>])(?!std::|juce::)(?:[A-Za-z_]\w*::)+([A-Za-z_]\w*)\s*\(/g;
  for (const re of [reUnq, reThis, reQual]) {
    let m;
    while ((m = re.exec(body))) if (!NOT_FOLLOWED.has(m[1])) names.add(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function buildRules(usingJuce) {
  // `J(names)` = juce::Name always, bare Name only when `using namespace juce` is present.
  const J = (names) => (usingJuce ? `(?:juce::)?(?:${names})` : `juce::(?:${names})`);
  return [
    // --- FAIL: allocation -------------------------------------------------
    { id: 'alloc-new', sev: 'fail', re: /(?<![\w:])new\b(?!\s*\()/g, what: '`new` allocates' },
    { id: 'alloc-delete', sev: 'fail', re: /(?<!=\s*)(?<![\w:])delete\b(?!\s*;)/g, what: '`delete` frees memory' },
    { id: 'alloc-c', sev: 'fail', re: /(?<![\w.>])(?:std::|::)?(?:malloc|calloc|realloc|free|aligned_alloc)\s*\(/g, what: 'C heap call' },
    { id: 'alloc-smart', sev: 'fail', re: /\bstd::(?:make_unique|make_shared|allocate_shared)\b/g, what: 'smart-pointer factory allocates' },
    {
      id: 'vector-growth', sev: 'fail',
      re: /(?:\.|->)\s*(?:push_back|emplace_back|push_front|emplace_front|resize|reserve|shrink_to_fit)\s*\(/g,
      what: 'container growth (push_back/emplace_back/resize/reserve) allocates',
    },
    // --- FAIL: strings ----------------------------------------------------
    { id: 'string', sev: 'fail', re: /\bstd::(?:w|u8|u16|u32)?string\b(?!\s*[&*])(?!_view)/g, what: 'std::string construction allocates' },
    { id: 'string', sev: 'fail', re: /\bstd::(?:to_string|to_wstring|ostringstream|stringstream|istringstream)\b/g, what: 'string formatting allocates' },
    { id: 'string', sev: 'fail', re: new RegExp(`\\b${J('String|StringArray|MemoryBlock|XmlElement|var')}\\b(?!\\s*[&*])`, 'g'), what: 'juce::String/var-style type allocates' },
    { id: 'string-concat', sev: 'fail', re: /(?:\+\s*"|"\s*\+)/g, what: 'string concatenation with a literal allocates' },
    // --- FAIL: locks / blocking -------------------------------------------
    {
      id: 'lock', sev: 'fail',
      re: /\bstd::(?:mutex|recursive_mutex|timed_mutex|recursive_timed_mutex|shared_mutex|shared_timed_mutex|lock_guard|unique_lock|scoped_lock|shared_lock|condition_variable(?:_any)?|counting_semaphore|binary_semaphore|barrier|latch)\b/g,
      what: 'blocking synchronisation primitive',
    },
    { id: 'lock', sev: 'fail', re: new RegExp(`\\b${J('CriticalSection|ScopedLock|GenericScopedLock|ScopedUnlock|WaitableEvent|ReadWriteLock|ScopedReadLock|ScopedWriteLock|MessageManagerLock')}\\b`, 'g'), what: 'juce lock type' },
    { id: 'lock', sev: 'fail', re: /\bpthread_mutex_lock\s*\(/g, what: 'pthread mutex' },
    { id: 'blocking', sev: 'fail', re: /\bstd::this_thread::(?:sleep_for|sleep_until|yield)\b|\b(?:juce::)?Thread::(?:sleep|wait|yield)\s*\(|\b(?:Sleep|usleep|nanosleep)\s*\(/g, what: 'sleeping/blocking call' },
    // --- FAIL: I/O ---------------------------------------------------------
    {
      id: 'io', sev: 'fail',
      re: new RegExp(`\\b${J('File|FileInputStream|FileOutputStream|FileLogger|FileSearchPath|DirectoryIterator|URL|WebInputStream|Logger|InputStream|OutputStream|NativeMessageBox|AlertWindow')}\\b`, 'g'),
      what: 'file / network / logging type',
    },
    { id: 'io', sev: 'fail', re: /\bDBG\s*\(/g, what: 'DBG() logs (allocates + may block)' },
    { id: 'io', sev: 'fail', re: /(?<![\w.>])(?:std::)?(?:printf|fprintf|puts|fputs|fwrite|fflush|fopen|fread|perror)\s*\(/g, what: 'stdio call' },
    { id: 'io', sev: 'fail', re: /\bstd::(?:cout|cerr|clog|cin|ifstream|ofstream|fstream|getline)\b/g, what: 'iostream I/O' },
    // --- FAIL: threads / message thread -----------------------------------
    { id: 'message-thread', sev: 'fail', re: /\bMessageManager\s*::\s*callSync\s*\(|\bcallSync\s*\(/g, what: 'MessageManager::callSync blocks the audio thread' },
    { id: 'thread', sev: 'fail', re: /\bstd::(?:thread|jthread|async|promise|future|packaged_task)\b/g, what: 'thread creation / future' },
    { id: 'thread', sev: 'fail', re: new RegExp(`\\b${J('ThreadPool|Thread::launch')}\\b|\\bstartThread\\s*\\(`, 'g'), what: 'thread creation' },
    // --- WARN -------------------------------------------------------------
    { id: 'container', sev: 'warn', re: /\bstd::(?:map|unordered_map|multimap|unordered_multimap|set|unordered_set|multiset|list|deque)\b/g, what: 'node-based container (allocates on insert)' },
    { id: 'dynamic-cast', sev: 'warn', re: /\bdynamic_cast\b/g, what: 'dynamic_cast (RTTI, can be slow)' },
    { id: 'throw', sev: 'warn', re: /(?<![\w:])throw\b/g, what: 'throw (exceptions allocate and unwind unpredictably)' },
    { id: 'buffer-setsize', sev: 'warn', re: /(?:\.|->)\s*setSize\s*\((?![^;]*,\s*true\s*\)\s*;)/g, what: 'setSize may reallocate (pass avoidReallocating = true or size the buffer in prepareToPlay)' },
    { id: 'buffer-local', sev: 'warn', re: /\bAudioBuffer\s*<[^>]*>\s+\w+\s*[({]/g, what: 'local AudioBuffer with a size allocates (use a member buffer sized in prepareToPlay)' },
    { id: 'message-thread', sev: 'warn', re: /\bMessageManager\s*::\s*callAsync\s*\(/g, what: 'callAsync allocates a message' },
    { id: 'try-lock', sev: 'warn', re: new RegExp(`\\b${J('ScopedTryLock|SpinLock')}\\b`, 'g'), what: 'try-lock / spin-lock on the audio thread' },
  ];
}

const DENORMAL_RE = /\b(?:juce::)?ScopedNoDenormals\b|\b(?:apc::dsp::)?DenormalGuard\b|\b_MM_SET_FLUSH_ZERO_MODE\b|\b_mm_setcsr\b|\bdisableDenormalisedNumberSupport\b/;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function collectRegions(files) {
  /** @returns {{ roots: Region[], regions: Region[] }} Region = { file, name, start, end, via } */
  const roots = [];
  for (const f of files) {
    for (const rootName of ['processBlock', 'processBlockBypassed']) {
      for (const d of findDefinitions(f, rootName)) roots.push({ file: f, name: rootName, start: d.start, end: d.end, via: null, isMain: rootName === 'processBlock', sigIdx: d.nameIdx });
    }
  }
  const regions = [];
  const seen = new Set();
  const key = (f, s) => `${f.full}:${s}`;
  let frontier = roots.map((r) => ({ ...r, depth: 0 }));
  for (const r of frontier) seen.add(key(r.file, r.start));
  while (frontier.length) {
    const next = [];
    for (const r of frontier) {
      regions.push(r);
      if (r.depth >= MAX_DEPTH) continue;
      const body = r.file.stripped.slice(r.start, r.end + 1);
      for (const name of calledNames(body)) {
        for (const d of findDefinitions(r.file, name)) {
          const k = key(r.file, d.start);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ file: r.file, name, start: d.start, end: d.end, via: r.via || r.name, depth: r.depth + 1, isMain: false, rootIsMain: r.isMain || r.rootIsMain });
        }
      }
    }
    frontier = next;
  }
  return { roots, regions };
}

function scanRegion(region, rules, findings, suppressedHits) {
  const { file } = region;
  const body = file.stripped.slice(region.start, region.end + 1);
  const where = region.via ? `in ${region.name}() reached from ${region.via}()` : `in ${region.name}()`;
  const dedupe = new Set();
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(body))) {
      if (m[0].length === 0) { rule.re.lastIndex++; continue; }
      const line = lineOf(file, region.start + m.index);
      const k = `${rule.id}:${line}`; // one finding per rule family per line
      if (dedupe.has(k)) continue;
      dedupe.add(k);
      const hit = { file: file.rel, line, rule, token: m[0].trim().replace(/\s+/g, ' '), where };
      if (file.suppressed.has(line)) suppressedHits.push(hit);
      else findings.push(hit);
    }
  }
}

function validate(pluginDir, opts = {}) {
  const checks = [];
  const add = (check, status, message) => checks.push({ check, status, message });

  const sourceDir = path.join(pluginDir, 'Source');
  if (!fs.existsSync(sourceDir)) {
    add('rt-sources', 'warn', `No Source/ directory in ${pluginDir} - nothing to scan (implementation phase not done?).`);
    return { checks };
  }
  const paths = listSources(sourceDir);
  if (paths.length === 0) {
    add('rt-sources', 'warn', 'Source/ contains no .cpp/.h/.hpp files - nothing to scan.');
    return { checks };
  }
  const files = paths.map((p) => buildFile(pluginDir, p));
  const usingJuce = files.some((f) => /using\s+namespace\s+juce\b/.test(f.stripped));

  const { roots, regions } = collectRegions(files);
  const mainRoots = roots.filter((r) => r.isMain);
  if (mainRoots.length === 0) {
    add('rt-process-block', 'fail', `No definition of processBlock found in Source/ (${files.length} files scanned) - cannot verify real-time safety.`);
    return { checks };
  }
  add('rt-process-block', 'pass', `processBlock found: ${mainRoots.map((r) => `${r.file.rel}:${lineOf(r.file, r.sigIdx)}`).join(', ')}; scanned ${regions.length} function bod${regions.length === 1 ? 'y' : 'ies'}.`);

  // Forbidden / suspicious patterns
  const rules = buildRules(usingJuce);
  const findings = [];
  const suppressedHits = [];
  for (const region of regions) scanRegion(region, rules, findings, suppressedHits);
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));

  let fails = 0;
  let warns = 0;
  for (const f of findings) {
    const msg = `${f.file}:${f.line}  ${f.rule.what} ("${f.token}") ${f.where}`;
    add(`rt-${f.rule.id}`, f.rule.sev, msg);
    if (f.rule.sev === 'fail') fails++; else warns++;
  }
  if (fails === 0) add('rt-forbidden', 'pass', 'No allocation / lock / I/O / thread calls found in the audio path.');
  if (warns === 0) add('rt-warnings', 'pass', 'No suspicious constructs (std::map, dynamic_cast, throw, ...) found in the audio path.');

  // Denormal protection
  const denormalOk = [];
  let denormalSuppressed = false;
  for (const r of mainRoots) {
    const sigLine = lineOf(r.file, r.sigIdx);
    if (r.file.suppressed.has(sigLine)) denormalSuppressed = true;
  }
  for (const region of regions) {
    if (!(region.isMain || region.rootIsMain)) continue;
    const body = region.file.stripped.slice(region.start, region.end + 1);
    const m = DENORMAL_RE.exec(body);
    if (m) denormalOk.push(`${region.file.rel}:${lineOf(region.file, region.start + m.index)} (${m[0]})`);
  }
  if (denormalOk.length > 0) add('rt-denormals', 'pass', `Denormal protection engaged in the audio path: ${denormalOk[0]}.`);
  else if (denormalSuppressed) add('rt-denormals', 'info', 'Denormal check suppressed with apc-rt-ok.');
  else add('rt-denormals', 'fail', 'processBlock does not engage denormal protection - add `juce::ScopedNoDenormals noDenormals;` (or `apc::dsp::DenormalGuard guard;`) at the top of processBlock.');

  // Latency reporting
  const mentions = files.find((f) => /oversampl|look-?ahead/i.test(f.raw));
  const reportsLatency = files.some((f) => /\bsetLatencySamples\s*\(/.test(f.stripped));
  if (mentions && !reportsLatency) {
    add('rt-latency', 'info', `${mentions.rel} mentions oversampling/lookahead but setLatencySamples() is never called - report the added latency to the host.`);
  } else {
    add('rt-latency', 'pass', reportsLatency ? 'setLatencySamples() is called.' : 'No oversampling/lookahead mentioned; no latency report needed.');
  }

  // Suppression bookkeeping
  const bare = files.flatMap((f) => f.bare.map((l) => `${f.rel}:${l}`));
  if (bare.length > 0) add('rt-suppression', 'warn', `apc-rt-ok without a reason is ignored (write "apc-rt-ok: <reason>"): ${bare.join(', ')}`);
  if (suppressedHits.length > 0) {
    add('rt-suppression', 'info', `${suppressedHits.length} finding(s) suppressed via apc-rt-ok: ${suppressedHits.map((h) => `${h.file}:${h.line}`).join(', ')}`);
  }

  return { checks };
}

module.exports = { validate, stripCommentsAndStrings };
