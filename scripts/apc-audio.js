'use strict';

/**
 * apc-audio - automated audio validation gates for a BUILT plugin.
 *
 *   node bin/apc.js audio <Plugin> [--gate pluginval|clap|null|nan|tail|bench|all]
 *                          [--json] [--build-dir D] [--baseline-update]
 *
 * Gates (see .agents/guides/audio-validation.md for thresholds):
 *   pluginval  pluginval --strictness-level 10 on the VST3
 *   clap       clap-validator on the .clap (only when status.json formats.clap === true)
 *   null       render baseline compare + block-size invariance (offline harness)
 *   nan        NaN / Inf / denormal scan over several signals (offline harness)
 *   tail       output must decay below -90 dBFS within the declared tail (harness)
 *   bench      CPU benchmark: median realtime factor of N runs >= budget (harness)
 *
 * Result semantics - there is NEVER a fake pass:
 *   pass     gate ran and every check was within threshold
 *   fail     gate ran and a check was out of threshold (or the plugin crashed)
 *   error    gate could not run to a verdict because of a tooling error
 *   skipped  prerequisite missing (binary, harness, validator, opt-in, baseline);
 *            the reason is always recorded
 *
 * Exit code: 0 = no failures and at least one pass, 1 = any fail/error,
 *            3 = nothing validated (everything skipped), 2 = usage error.
 *            --fail-on-skip turns skipped gates into exit 1 (CI).
 *
 * The render harness is templates/audio-test-harness (JUCE 9 console app).
 * Zero dependencies, Node 18+. Exports run(args, ctx) plus the pure helpers
 * used by test/audio-gates.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SCHEMA = 'apc-audio-report/1';
const REPORT_NAME = '_audio-report.json';
const GATE_IDS = ['pluginval', 'clap', 'null', 'nan', 'tail', 'bench'];

const DEFAULTS = {
  pluginval: { strictness_level: 10, timeout_ms: 120000, skip_gui_tests: false },
  clap: { known_failures: ['state-reproducibility'] }, // clap-001, see juce-build-protocols.md
  null: {
    baseline_tolerance: 1e-3,      // max |sample diff| vs stored baseline (about -60 dBFS)
    invariance_tolerance: 1e-4,    // max |sample diff| between block sizes at the same rate (-80 dBFS)
    invariance: true,
    sample_rates: [44100, 48000, 96000],
    block_sizes: [64, 512, 1024],
    reference_block_size: 512,
    seconds: 1,
    baseline_signals: ['impulse', 'sweep', 'pink'],
    baseline_sample_rate: 48000,
    baseline_block_size: 512,
  },
  nan: {
    signals: ['impulse', 'sweep', 'pink', 'fullscale', 'silence-after-signal'],
    sample_rate: 48000,
    block_size: 512,
    seconds: 2,
    max_denormals: 0,
  },
  tail: { max_db: -90, signal_seconds: 0.5, default_tail_seconds: 2, sample_rate: 48000, block_size: 512, max_tail_seconds: 30 },
  bench: { min_realtime_factor: 20, runs: 5, seconds: 10, sample_rate: 48000, block_size: 512 },
};

// ─── small utilities ───────────────────────────────────────────────────────

const isWin = process.platform === 'win32';
const exe = (n) => (isWin ? `${n}.exe` : n);

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/** Shallow-per-gate merge: defaults < config.audio < status.json audio < overrides. */
function mergeThresholds(...layers) {
  const out = {};
  for (const id of GATE_IDS) out[id] = { ...DEFAULTS[id] };
  for (const layer of layers) {
    if (!isObject(layer)) continue;
    for (const id of GATE_IDS) if (isObject(layer[id])) Object.assign(out[id], layer[id]);
  }
  return out;
}

function stripAnsi(s) { return String(s || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''); }

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round(n, d = 6) { return n == null || !Number.isFinite(n) ? n : Number(n.toFixed(d)); }

function findOnPath(name, env) {
  const dirs = String((env || process.env).PATH || (env || process.env).Path || '').split(path.delimiter).filter(Boolean);
  const names = isWin ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const d of dirs) for (const n of names) {
    const p = path.join(d, n);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

function defaultExec(file, args, opts = {}) {
  const r = cp.spawnSync(file, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 600000,
    cwd: opts.cwd,
    env: opts.env,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    status: r.status,
    signal: r.signal || null,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error ? String(r.error.message || r.error) : null,
  };
}

// ─── WAV I/O and comparison (pure, tested) ─────────────────────────────────

/** Parse RIFF/WAVE: PCM 8/16/24/32, IEEE float 32/64, WAVE_FORMAT_EXTENSIBLE. */
function readWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let fmt = null; let dataOff = -1; let dataLen = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(body);
      if (tag === 0xFFFE && size >= 26) tag = buf.readUInt16LE(body + 24);
      fmt = { tag, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      dataOff = body;
      if (body + size > buf.length) size = buf.length - body; // tolerate streaming/truncated headers
      dataLen = size;
      break;
    }
    off = body + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV has no fmt chunk');
  if (dataOff < 0) throw new Error('WAV has no data chunk');
  const bytes = fmt.bits / 8;
  if (!Number.isInteger(bytes) || fmt.channels < 1) throw new Error('unsupported WAV layout');
  const frames = Math.floor(dataLen / (bytes * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + (i * fmt.channels + c) * bytes;
      let v;
      if (fmt.tag === 3 && fmt.bits === 32) v = buf.readFloatLE(p);
      else if (fmt.tag === 3 && fmt.bits === 64) v = buf.readDoubleLE(p);
      else if (fmt.tag === 1 && fmt.bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (fmt.tag === 1 && fmt.bits === 24) v = (buf.readIntLE(p, 3)) / 8388608;
      else if (fmt.tag === 1 && fmt.bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else if (fmt.tag === 1 && fmt.bits === 8) v = (buf.readUInt8(p) - 128) / 128;
      else throw new Error(`unsupported WAV format tag=${fmt.tag} bits=${fmt.bits}`);
      channels[c][i] = v;
    }
  }
  return { sampleRate: fmt.sampleRate, numChannels: fmt.channels, frames, channels };
}

/** Write a 32-bit float WAV from per-channel arrays (used by tests / fakes). */
function writeWavFloat32(channels, sampleRate) {
  const nch = channels.length;
  const frames = nch ? channels[0].length : 0;
  const dataLen = frames * nch * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * nch * 4, 28); buf.writeUInt16LE(nch * 4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) buf.writeFloatLE(channels[c][i], 44 + (i * nch + c) * 4);
  return buf;
}

/**
 * Compare two decoded WAVs sample by sample (no resampling - the caller only
 * pairs renders made at the same sample rate).
 *   max_abs_diff  largest |a-b| over the common region
 *   rms_diff      RMS of the difference
 *   null_depth_db 20*log10(rms_diff / rms_ref): how deep a null test cancels (null if ref is silent)
 *   shape_ok      same channel count, frame count and sample rate
 */
function compareBuffers(ref, cand) {
  const channels = Math.min(ref.numChannels, cand.numChannels);
  const frames = Math.min(ref.frames, cand.frames);
  let maxAbs = 0; let sumDiff = 0; let sumRef = 0; let n = 0;
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < frames; i++) {
      const a = ref.channels[c][i]; const b = cand.channels[c][i];
      const d = Math.abs(a - b);
      if (!(d <= maxAbs)) maxAbs = d; // also propagates NaN
      sumDiff += d * d; sumRef += a * a; n++;
    }
  }
  const rmsDiff = n ? Math.sqrt(sumDiff / n) : 0;
  const rmsRef = n ? Math.sqrt(sumRef / n) : 0;
  return {
    max_abs_diff: maxAbs,
    rms_diff: rmsDiff,
    null_depth_db: rmsRef > 1e-12 ? (rmsDiff > 1e-15 ? 20 * Math.log10(rmsDiff / rmsRef) : -300) : null,
    shape_ok: ref.numChannels === cand.numChannels && ref.frames === cand.frames && ref.sampleRate === cand.sampleRate,
    channels_ref: ref.numChannels, channels_cand: cand.numChannels,
    frames_ref: ref.frames, frames_cand: cand.frames,
  };
}

function compareWavFiles(refPath, candPath) {
  return compareBuffers(readWav(fs.readFileSync(refPath)), readWav(fs.readFileSync(candPath)));
}

// ─── tool / artifact discovery ─────────────────────────────────────────────

function findPluginval(root, env, override) {
  const e = env || process.env;
  const cands = [override, e.APC_PLUGINVAL,
    path.join(root, '_tools', 'pluginval-bin', exe('pluginval')),
    path.join(root, '_tools', 'pluginval-bin', 'pluginval.app', 'Contents', 'MacOS', 'pluginval'),
    path.join(root, '_tools', 'pluginval', exe('pluginval')),
    path.join(root, '_tools', 'pluginval', 'build', 'pluginval_artefacts', 'Release', exe('pluginval')),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return findOnPath('pluginval', e);
}

function findClapValidator(root, env, override) {
  const e = env || process.env;
  const cands = [override, e.APC_CLAP_VALIDATOR,
    path.join(root, '_tools', 'clap-validator-bin', exe('clap-validator')),
    path.join(root, '_tools', 'clap-validator', exe('clap-validator')),
    path.join(root, '_tools', 'clap-validator', 'target', 'release', exe('clap-validator')),
    path.join(os.homedir(), '.cargo', 'bin', exe('clap-validator')),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return findOnPath('clap-validator', e);
}

function harnessSearchDir(buildDir) { return path.join(buildDir, 'audio-harness'); }

function findHarness(buildDir, env, override) {
  const e = env || process.env;
  const name = exe('apc_audio_harness');
  const base = harnessSearchDir(buildDir);
  const cands = [override, e.APC_AUDIO_HARNESS];
  for (const cfg of ['Release', 'RelWithDebInfo', 'MinSizeRel', 'Debug', '']) {
    cands.push(path.join(base, 'apc_audio_harness_artefacts', cfg, name));
  }
  for (const c of cands.filter(Boolean)) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}

/** Locate <Name>.vst3 / <Name>.clap under <buildDir>/plugins/<Name>/<Name>_artefacts/<cfg>/<FORMAT>/. */
function findPluginBinary(buildDir, name, kind) {
  const ext = kind === 'CLAP' ? '.clap' : '.vst3';
  const roots = [path.join(buildDir, 'plugins', name, `${name}_artefacts`), path.join(buildDir, `${name}_artefacts`)];
  const cfgs = ['Release', 'RelWithDebInfo', 'MinSizeRel', 'Debug', ''];
  for (const r of roots) for (const cfg of cfgs) {
    const p = path.join(r, cfg, kind, `${name}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  for (const r of roots) for (const cfg of cfgs) { // product name may differ from target name
    const dir = path.join(r, cfg, kind);
    try {
      const hit = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(ext));
      if (hit) return path.join(dir, hit);
    } catch { /* next */ }
  }
  return null;
}

// ─── harness driver ────────────────────────────────────────────────────────

function harnessArgs(o) {
  const a = ['--plugin', o.plugin, '--signal', o.signal, '--sr', String(o.sr), '--block', String(o.block),
    '--seconds', String(o.seconds), '--out', o.out];
  if (o.tail != null) a.push('--tail-seconds', String(o.tail));
  if (o.wav) a.push('--write-wav', o.wav);
  if (o.reference) a.push('--reference', o.reference);
  if (o.seed != null) a.push('--seed', String(o.seed));
  if (o.sanitize) a.push('--sanitize');
  return a;
}

/**
 * Run one harness render. Returns
 *   { ok:true, metrics } | { ok:false, kind:'crash'|'error', message }
 * Exit 3 (plugin failed to load) / 2 / 4 are tooling errors; any other
 * non-zero status or a signal means the plugin (or an attached sanitizer)
 * crashed the render, which is a genuine gate failure.
 */
function runHarness(env, o) {
  const out = path.join(env.workDir, `m-${env.counter.n++}.json`);
  const r = env.deps.exec(env.bin.harness, harnessArgs({ ...o, plugin: env.bin.vst3, out }), { timeout: env.harnessTimeoutMs });
  const metrics = readJsonSafe(out);
  if (r.error) return { ok: false, kind: 'error', message: `harness could not be executed: ${r.error}` };
  if (r.status !== 0) {
    const msg = (metrics && metrics.error) || stripAnsi(r.stderr).trim().split(/\r?\n/).slice(-3).join(' | ') || `exit ${r.status}`;
    const tooling = r.status === 2 || r.status === 3 || r.status === 4;
    return { ok: false, kind: tooling ? 'error' : 'crash', message: tooling ? msg : `harness crashed (exit ${r.status}${r.signal ? `, ${r.signal}` : ''}): ${msg}` };
  }
  if (!metrics || metrics.ok !== true) return { ok: false, kind: 'error', message: 'harness produced no valid metrics JSON' };
  return { ok: true, metrics, out };
}

// ─── gates ─────────────────────────────────────────────────────────────────

function gateResult(id, status, extra = {}) { return { id, status, ...extra }; }
const skipped = (id, reason) => gateResult(id, 'skipped', { reason });

function needHarness(env, id) {
  if (!env.bin.vst3) return skipped(id, `VST3 binary not found under ${env.buildDir} - build the plugin first (node bin/apc.js build ${env.plugin})`);
  if (!env.bin.harness) {
    return skipped(id, env.harnessBuildError
      ? `audio harness unavailable: ${env.harnessBuildError}`
      : 'audio harness not built - run: node bin/apc.js audio ' + env.plugin + ' --build-harness (or set APC_AUDIO_HARNESS)');
  }
  return null;
}

/** Map a failed runHarness() to a gate result. */
function harnessFailure(id, r, details) {
  return gateResult(id, r.kind === 'crash' ? 'fail' : 'error', { reason: r.message, details });
}

function gatePluginval(env) {
  const id = 'pluginval'; const t = env.thr.pluginval;
  if (!env.bin.vst3) return skipped(id, `VST3 binary not found under ${env.buildDir} - build the plugin first`);
  if (!env.bin.pluginval) return skipped(id, 'pluginval not found (_tools/pluginval-bin, _tools/pluginval, PATH or APC_PLUGINVAL)');
  const args = ['--strictness-level', String(t.strictness_level), '--timeout-ms', String(t.timeout_ms)];
  if (t.skip_gui_tests) args.push('--skip-gui-tests');
  args.push('--validate', env.bin.vst3);
  const started = Date.now();
  const r = env.deps.exec(env.bin.pluginval, args, { timeout: Number(t.timeout_ms) + 120000 });
  const out = stripAnsi(r.stdout + '\n' + r.stderr);
  const base = { duration_ms: Date.now() - started, thresholds: { strictness_level: t.strictness_level }, command: [path.basename(env.bin.pluginval), ...args.slice(0, -1), path.basename(env.bin.vst3)].join(' ') };
  if (r.error) return gateResult(id, 'error', { ...base, reason: `pluginval could not be executed: ${r.error}` });
  const summary = out.split(/\r?\n/).filter((l) => /(FAIL|ERROR|SUCCESS)/i.test(l)).slice(-10);
  const passed = r.status === 0 && /SUCCESS/i.test(out);
  return gateResult(id, passed ? 'pass' : 'fail', {
    ...base,
    metrics: { exit_code: r.status },
    reason: passed ? undefined : (r.status === 0 ? 'pluginval exited 0 but printed no SUCCESS line' : `pluginval exited ${r.status}${r.signal ? ` (${r.signal})` : ''}`),
    details: summary,
  });
}

function gateClap(env) {
  const id = 'clap';
  if (!env.status || !env.status.formats || env.status.formats.clap !== true) {
    return skipped(id, 'plugin did not opt into CLAP (status.json formats.clap is not true)');
  }
  if (!env.bin.clap) return skipped(id, `CLAP binary not found under ${env.buildDir} - build the <Name>_CLAP target (node bin/apc.js build ${env.plugin})`);
  if (!env.bin.clapValidator) return skipped(id, 'clap-validator not found (_tools/clap-validator-bin, PATH, ~/.cargo/bin or APC_CLAP_VALIDATOR)');
  const started = Date.now();
  const args = ['validate', '--only-failed', env.bin.clap];
  const r = env.deps.exec(env.bin.clapValidator, args, { timeout: 300000 });
  const base = { duration_ms: Date.now() - started, command: `${path.basename(env.bin.clapValidator)} ${args.slice(0, -1).join(' ')} ${path.basename(env.bin.clap)}` };
  if (r.error) return gateResult(id, 'error', { ...base, reason: `clap-validator could not be executed: ${r.error}` });
  const lines = stripAnsi(r.stdout + '\n' + r.stderr).split(/\r?\n/);
  const failedIdx = [];
  lines.forEach((l, i) => { if (/\bFAILED\b/.test(l)) failedIdx.push(i); });
  const known = (env.thr.clap.known_failures || []).map((k) => String(k).toLowerCase());
  const ignored = []; const real = [];
  for (const i of failedIdx) {
    // clap-validator prints the test name on the line(s) just above the FAILED marker.
    const ctxText = lines.slice(Math.max(0, i - 2), i + 1).join(' ').toLowerCase();
    (known.some((k) => k && ctxText.includes(k)) ? ignored : real).push(lines[i].trim());
  }
  const passed = r.status === 0 ? real.length === 0 : (failedIdx.length > 0 && real.length === 0);
  return gateResult(id, passed ? 'pass' : 'fail', {
    ...base,
    metrics: { exit_code: r.status, failed_markers: failedIdx.length, ignored_known_failures: ignored.length },
    reason: passed ? undefined : (real.length ? `${real.length} clap-validator test(s) FAILED` : `clap-validator exited ${r.status}`),
    details: ignored.length ? [`ignored ${ignored.length} known upstream failure(s) matching ${JSON.stringify(known)} (clap-001)`] : [],
  });
}

function renderTo(env, o, tag) {
  const wav = path.join(env.workDir, `${tag}.wav`);
  const r = runHarness(env, { ...o, wav });
  return r.ok ? { ...r, wav } : r;
}

function gateNull(env) {
  const id = 'null'; const t = env.thr.null;
  const pre = needHarness(env, id); if (pre) return pre;
  const details = []; const sr0 = t.baseline_sample_rate; const b0 = t.baseline_block_size;
  const rmsBySr = {};

  if (t.invariance !== false) {
    const refBlock = t.reference_block_size;
    for (const sr of t.sample_rates) {
      const ref = renderTo(env, { signal: 'pink', sr, block: refBlock, seconds: t.seconds, seed: 1 }, `inv-${sr}-${refBlock}`);
      if (!ref.ok) return harnessFailure(id, ref, details);
      rmsBySr[sr] = ref.metrics.rms_db;
      for (const block of t.block_sizes.filter((b) => b !== refBlock)) {
        const cand = renderTo(env, { signal: 'pink', sr, block, seconds: t.seconds, seed: 1 }, `inv-${sr}-${block}`);
        if (!cand.ok) return harnessFailure(id, cand, details);
        const c = compareWavFiles(ref.wav, cand.wav);
        const ok = c.shape_ok && c.max_abs_diff <= t.invariance_tolerance;
        details.push({ check: 'block-size-invariance', sample_rate: sr, block_size: block, reference_block_size: refBlock,
          status: ok ? 'pass' : 'fail', max_abs_diff: round(c.max_abs_diff, 9), null_depth_db: round(c.null_depth_db, 2),
          tolerance: t.invariance_tolerance, ...(c.shape_ok ? {} : { reason: 'rendered length/channels differ between block sizes' }) });
      }
    }
  }

  for (const signal of t.baseline_signals) {
    const cand = renderTo(env, { signal, sr: sr0, block: b0, seconds: t.seconds, seed: 1 }, `base-${signal}`);
    if (!cand.ok) return harnessFailure(id, cand, details);
    const baseFile = path.join(env.baselineDir, `${signal}-${sr0}-${b0}.wav`);
    if (env.flags.baselineUpdate) {
      fs.mkdirSync(env.baselineDir, { recursive: true });
      fs.copyFileSync(cand.wav, baseFile);
      details.push({ check: 'baseline', signal, status: 'updated', file: path.relative(env.pluginDir, baseFile).split(path.sep).join('/') });
      continue;
    }
    if (!fs.existsSync(baseFile)) {
      details.push({ check: 'baseline', signal, status: 'skipped', reason: `no stored baseline (${path.basename(baseFile)}); re-run with --baseline-update to create it` });
      continue;
    }
    let c;
    try { c = compareWavFiles(baseFile, cand.wav); } catch (e) {
      details.push({ check: 'baseline', signal, status: 'fail', reason: `baseline unreadable: ${e.message}` }); continue;
    }
    const ok = c.shape_ok && c.max_abs_diff <= t.baseline_tolerance;
    details.push({ check: 'baseline', signal, status: ok ? 'pass' : 'fail', max_abs_diff: round(c.max_abs_diff, 9),
      null_depth_db: round(c.null_depth_db, 2), tolerance: t.baseline_tolerance,
      ...(c.shape_ok ? {} : { reason: `shape differs from baseline (${c.channels_ref}ch/${c.frames_ref} vs ${c.channels_cand}ch/${c.frames_cand})` }) });
  }

  const rmsVals = Object.values(rmsBySr).filter((v) => Number.isFinite(v));
  const metrics = rmsVals.length ? { rms_db_by_sample_rate: rmsBySr, rms_spread_db: round(Math.max(...rmsVals) - Math.min(...rmsVals), 2) } : {};
  const checked = details.filter((d) => d.status === 'pass' || d.status === 'fail');
  const failed = details.filter((d) => d.status === 'fail');
  const updated = details.filter((d) => d.status === 'updated');
  const thresholds = { baseline_tolerance: t.baseline_tolerance, invariance_tolerance: t.invariance_tolerance };
  if (failed.length) return gateResult(id, 'fail', { thresholds, metrics, reason: `${failed.length} null/invariance check(s) out of tolerance`, details });
  const missing = details.filter((d) => d.check === 'baseline' && d.status === 'skipped');
  if (missing.length) {
    // Part of the gate could not run: never report that as a pass.
    return gateResult(id, 'skipped', { thresholds, metrics, details,
      reason: `${missing.length} baseline(s) missing (${checked.length} other check(s) passed) - run with --baseline-update once the render is reviewed` });
  }
  if (checked.length) return gateResult(id, 'pass', { thresholds, metrics, details, ...(updated.length ? { notes: [`${updated.length} baseline(s) written`] } : {}) });
  return gateResult(id, 'skipped', { thresholds, metrics, reason: updated.length ? 'baselines written but no comparison checks ran' : 'no comparison checks could run (no baselines stored and invariance disabled)', details });
}

function gateNan(env) {
  const id = 'nan'; const t = env.thr.nan;
  const pre = needHarness(env, id); if (pre) return pre;
  const details = []; let nan = 0; let inf = 0; let den = 0;
  for (const signal of t.signals) {
    const isTail = signal === 'silence-after-signal';
    const r = runHarness(env, { signal, sr: t.sample_rate, block: t.block_size, seconds: isTail ? 0.5 : t.seconds, tail: isTail ? 2 : undefined, seed: 1, sanitize: env.flags.sanitize });
    if (!r.ok) return harnessFailure(id, r, details);
    const m = r.metrics;
    nan += m.nan_count; inf += m.inf_count; den += m.denormal_count;
    details.push({ signal, nan_count: m.nan_count, inf_count: m.inf_count, denormal_count: m.denormal_count, peak_db: m.peak_db });
  }
  const bad = nan + inf > 0 || den > t.max_denormals;
  return gateResult(id, bad ? 'fail' : 'pass', {
    thresholds: { max_nan_inf: 0, max_denormals: t.max_denormals },
    metrics: { nan_count: nan, inf_count: inf, denormal_count: den, sanitize_mode: !!env.flags.sanitize },
    reason: bad ? `${nan} NaN, ${inf} Inf, ${den} denormal output samples` : undefined,
    details,
  });
}

function gateTail(env) {
  const id = 'tail'; const t = env.thr.tail;
  const pre = needHarness(env, id); if (pre) return pre;
  let tail = null; let source = null;
  if (Number.isFinite(env.flags.tailSeconds)) { tail = env.flags.tailSeconds; source = '--tail-seconds'; }
  else if (env.status && env.status.audio && Number.isFinite(env.status.audio.tail_seconds)) { tail = env.status.audio.tail_seconds; source = 'status.json audio.tail_seconds'; }
  // First render also yields the plugin's own getTailLengthSeconds() when nothing is declared.
  const run = (tailSec) => runHarness(env, { signal: 'silence-after-signal', sr: t.sample_rate, block: t.block_size, seconds: t.signal_seconds, tail: tailSec, seed: 1 });
  let r = run(tail != null ? tail : t.default_tail_seconds);
  if (!r.ok) return harnessFailure(id, r, []);
  if (tail == null) {
    const reported = r.metrics.plugin_tail_seconds;
    if (Number.isFinite(reported) && reported >= 0 && reported <= t.max_tail_seconds) { tail = reported; source = 'plugin getTailLengthSeconds()'; }
    else { tail = t.default_tail_seconds; source = reported < 0 ? `default (plugin reports an unbounded tail; capped at ${t.default_tail_seconds}s)` : 'default'; }
    if (tail !== t.default_tail_seconds) { r = run(tail); if (!r.ok) return harnessFailure(id, r, []); }
  }
  const db = r.metrics.tail_db;
  const notes = [];
  if (Number.isFinite(r.metrics.plugin_tail_seconds) && r.metrics.plugin_tail_seconds > tail + 1e-9) notes.push(`plugin reports a ${r.metrics.plugin_tail_seconds}s tail, longer than the ${tail}s checked`);
  if (!Number.isFinite(db)) return gateResult(id, 'error', { reason: 'harness returned no tail_db' });
  const ok = db <= t.max_db;
  return gateResult(id, ok ? 'pass' : 'fail', {
    thresholds: { max_tail_db: t.max_db, declared_tail_seconds: tail, declared_tail_source: source },
    metrics: { tail_db: db, plugin_tail_seconds: r.metrics.plugin_tail_seconds, peak_db: r.metrics.peak_db },
    reason: ok ? undefined : `output is ${db} dBFS ${tail}s after input stopped (limit ${t.max_db} dBFS)`,
    ...(notes.length ? { notes } : {}),
  });
}

function gateBench(env) {
  const id = 'bench'; const t = env.thr.bench;
  const pre = needHarness(env, id); if (pre) return pre;
  const runs = Number.isFinite(env.flags.runs) ? env.flags.runs : t.runs;
  const factors = [];
  for (let i = 0; i < runs; i++) {
    const r = runHarness(env, { signal: 'pink', sr: t.sample_rate, block: t.block_size, seconds: t.seconds, seed: 1 });
    if (!r.ok) return harnessFailure(id, r, []);
    if (!Number.isFinite(r.metrics.realtime_factor) || r.metrics.realtime_factor <= 0) return gateResult(id, 'error', { reason: 'harness returned no realtime_factor' });
    factors.push(r.metrics.realtime_factor);
  }
  const med = median(factors);
  const ok = med >= t.min_realtime_factor;
  return gateResult(id, ok ? 'pass' : 'fail', {
    thresholds: { min_realtime_factor: t.min_realtime_factor, runs },
    metrics: { realtime_factor_median: round(med, 2), realtime_factor_min: round(Math.min(...factors), 2), realtime_factor_max: round(Math.max(...factors), 2), runs: factors.length, sample_rate: t.sample_rate, block_size: t.block_size },
    reason: ok ? undefined : `median ${round(med, 1)}x realtime < budget ${t.min_realtime_factor}x`,
    notes: ['realtime factor depends on the host CPU; compare like with like (override budget with apc.config.json audio.bench.min_realtime_factor)'],
  });
}

const GATE_FUNCS = { pluginval: gatePluginval, clap: gateClap, null: gateNull, nan: gateNan, tail: gateTail, bench: gateBench };

// ─── orchestration ─────────────────────────────────────────────────────────

function summarize(gates) {
  const counts = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const g of gates) counts[g.status] = (counts[g.status] || 0) + 1;
  let overall;
  if (counts.fail || counts.error) overall = 'fail';
  else if (counts.pass) overall = 'pass';
  else overall = 'skipped';
  return { overall, counts };
}

function exitCodeFor(report, failOnSkip) {
  const { overall, counts } = report;
  if (overall === 'fail') return 1;
  if (failOnSkip && counts.skipped) return 1;
  if (overall === 'skipped') return 3;
  return 0;
}

/**
 * Run the selected gates. `opts`:
 *   root, plugin, pluginDir, buildDir, gates[], flags{}, thresholds (merged), status (status.json or null)
 *   overrides{ pluginval, clapValidator, harness }
 * `deps`: { exec, env }  (injectable for tests)
 */
function runGates(opts, deps) {
  deps = { exec: defaultExec, env: process.env, ...deps };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-audio-'));
  const env = {
    plugin: opts.plugin, pluginDir: opts.pluginDir, buildDir: opts.buildDir, status: opts.status || null,
    thr: opts.thresholds, flags: opts.flags || {}, deps, workDir, counter: { n: 0 },
    baselineDir: path.join(opts.pluginDir, 'Tests', 'audio-baseline'),
    harnessTimeoutMs: 600000, harnessBuildError: opts.harnessBuildError || null,
    bin: {
      vst3: findPluginBinary(opts.buildDir, opts.plugin, 'VST3'),
      clap: findPluginBinary(opts.buildDir, opts.plugin, 'CLAP'),
      pluginval: findPluginval(opts.root, deps.env, opts.overrides && opts.overrides.pluginval),
      clapValidator: findClapValidator(opts.root, deps.env, opts.overrides && opts.overrides.clapValidator),
      harness: findHarness(opts.buildDir, deps.env, opts.overrides && opts.overrides.harness),
    },
  };
  const gates = [];
  try {
    for (const id of opts.gates) {
      const started = Date.now();
      let g;
      try { g = GATE_FUNCS[id](env); } catch (e) { g = gateResult(id, 'error', { reason: `gate threw: ${e && e.message ? e.message : e}` }); }
      if (g.duration_ms == null) g.duration_ms = Date.now() - started;
      gates.push(g);
    }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  const { overall, counts } = summarize(gates);
  return {
    schema: SCHEMA,
    plugin: opts.plugin,
    generated_at: (deps.now ? deps.now() : new Date()).toISOString(),
    overall, counts,
    inputs: {
      build_dir: opts.buildDir,
      vst3: env.bin.vst3, clap: env.bin.clap, pluginval: env.bin.pluginval,
      clap_validator: env.bin.clapValidator, harness: env.bin.harness,
      baseline_update: !!(opts.flags && opts.flags.baselineUpdate),
      sanitize: !!(opts.flags && opts.flags.sanitize),
    },
    thresholds: opts.thresholds,
    gates,
  };
}

// ─── harness build (the one sanctioned cmake call outside build-and-install) ──

function buildHarness({ root, buildDir, sanitizer, exec, env }) {
  const cmake = findOnPath('cmake', env);
  if (!cmake) return { ok: false, message: 'cmake not found on PATH' };
  const src = path.join(root, 'templates', 'audio-test-harness');
  const bin = harnessSearchDir(buildDir);
  if (!fs.existsSync(path.join(src, 'CMakeLists.txt'))) return { ok: false, message: `harness sources missing: ${src}` };
  if (!fs.existsSync(path.join(root, '_tools', 'JUCE', 'CMakeLists.txt'))) return { ok: false, message: '_tools/JUCE missing (git submodule update --init)' };
  const cfgArgs = ['-S', src, '-B', bin, `-DAPC_ROOT=${root}`, `-DAPC_SANITIZE=${sanitizer || 'none'}`];
  let r = exec(cmake, cfgArgs, { timeout: 900000 });
  if (r.error || r.status !== 0) return { ok: false, message: `cmake configure failed: ${r.error || stripAnsi(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join(' | ')}` };
  r = exec(cmake, ['--build', bin, '--config', 'Release', '--target', 'apc_audio_harness'], { timeout: 3600000 });
  if (r.error || r.status !== 0) return { ok: false, message: `cmake build failed: ${r.error || stripAnsi(r.stdout + r.stderr).trim().split(/\r?\n/).slice(-8).join(' | ')}` };
  const found = findHarness(buildDir, env);
  return found ? { ok: true, path: found } : { ok: false, message: 'build finished but apc_audio_harness binary not found' };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const USAGE = [
  'Usage: apc audio <Plugin> [--gate pluginval|clap|null|nan|tail|bench|all] [--json]',
  '                          [--build-dir D] [--baseline-update] [--report F]',
  '  --gate G              repeatable or comma-separated; default all',
  '  --json                print the full report JSON to stdout (human summary otherwise)',
  '  --build-dir D         build tree holding plugins/<Name>/<Name>_artefacts (default paths.build_dir)',
  '  --baseline-update     write/overwrite stored null-test baselines (Tests/audio-baseline/)',
  '  --report F            report path (default <plugin>/_audio-report.json)',
  '  --build-harness       build templates/audio-test-harness into <build_dir>/audio-harness first',
  '  --harness-sanitize S  asan|ubsan|tsan: configure the harness with -DAPC_SANITIZE=S (with --build-harness)',
  '  --sanitize            nan gate in stress mode (random block sizes, re-prepare, bypass)',
  '  --harness P / --pluginval P / --clap-validator P   binary overrides',
  '  --tail-seconds N      declared tail for the tail gate (else status.json audio.tail_seconds)',
  '  --runs N              bench runs (default 5)',
  '  --fail-on-skip        exit 1 if any gate was skipped (CI)',
  'Exit: 0 pass, 1 fail/error, 2 usage, 3 nothing validated (all skipped).',
].join('\n');

function parseArgs(args) {
  const o = { plugin: null, gates: [], json: false, flags: {}, overrides: {}, buildDir: null, report: null, buildHarness: false, harnessSanitize: null, failOnSkip: false, help: false, errors: [] };
  const takeVal = (i, name) => { if (i + 1 >= args.length || String(args[i + 1]).startsWith('--')) { o.errors.push(`${name} needs a value`); return null; } return args[i + 1]; };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--json': o.json = true; break;
      case '--baseline-update': o.flags.baselineUpdate = true; break;
      case '--sanitize': o.flags.sanitize = true; break;
      case '--build-harness': o.buildHarness = true; break;
      case '--fail-on-skip': o.failOnSkip = true; break;
      case '--gate': { const v = takeVal(i, a); i++; if (v) o.gates.push(...v.split(',').map((s) => s.trim()).filter(Boolean)); break; }
      case '--build-dir': { const v = takeVal(i, a); i++; if (v) o.buildDir = v; break; }
      case '--report': { const v = takeVal(i, a); i++; if (v) o.report = v; break; }
      case '--harness': { const v = takeVal(i, a); i++; if (v) o.overrides.harness = v; break; }
      case '--pluginval': { const v = takeVal(i, a); i++; if (v) o.overrides.pluginval = v; break; }
      case '--clap-validator': { const v = takeVal(i, a); i++; if (v) o.overrides.clapValidator = v; break; }
      case '--harness-sanitize': { const v = takeVal(i, a); i++; if (v) o.harnessSanitize = v; break; }
      case '--tail-seconds': { const v = takeVal(i, a); i++; if (v != null) { const n = Number(v); if (!Number.isFinite(n) || n < 0) o.errors.push('--tail-seconds must be a number >= 0'); else o.flags.tailSeconds = n; } break; }
      case '--runs': { const v = takeVal(i, a); i++; if (v != null) { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 100) o.errors.push('--runs must be an integer 1..100'); else o.flags.runs = n; } break; }
      default:
        if (a.startsWith('--')) o.errors.push(`unknown option ${a}`);
        else if (!o.plugin) o.plugin = a;
        else o.errors.push(`unexpected argument ${a}`);
    }
  }
  if (!o.gates.length || o.gates.includes('all')) o.gates = [...GATE_IDS];
  const bad = o.gates.filter((g) => !GATE_IDS.includes(g));
  if (bad.length) o.errors.push(`unknown gate(s): ${bad.join(', ')} (valid: ${GATE_IDS.join(', ')}, all)`);
  o.gates = GATE_IDS.filter((g) => o.gates.includes(g)); // canonical order, deduped
  if (o.harnessSanitize && !['asan', 'ubsan', 'tsan', 'none'].includes(o.harnessSanitize)) o.errors.push('--harness-sanitize must be asan|ubsan|tsan|none');
  return o;
}

const ICON = { pass: 'PASS', fail: 'FAIL', error: 'ERR ', skipped: 'SKIP' };

function printHuman(report, reportPath, log) {
  log(`apc audio: ${report.plugin}`);
  for (const g of report.gates) {
    const ms = g.duration_ms != null ? ` (${(g.duration_ms / 1000).toFixed(1)}s)` : '';
    log(`  [${ICON[g.status] || g.status}] ${g.id}${ms}${g.reason ? ` - ${g.reason}` : ''}`);
    for (const d of (g.details || [])) {
      if (isObject(d) && (d.status === 'fail' || d.status === 'skipped' || d.status === 'updated')) {
        const where = [d.signal, d.sample_rate ? `${d.sample_rate} Hz` : null, d.block_size ? `block ${d.block_size}` : null].filter(Boolean).join(' ');
        log(`         ${d.check || ''} ${where} ${d.status}${d.reason ? `: ${d.reason}` : ''}${d.max_abs_diff != null ? ` (max diff ${d.max_abs_diff}, limit ${d.tolerance})` : ''}`);
      }
    }
  }
  const c = report.counts;
  log(`  overall: ${report.overall.toUpperCase()}  (pass ${c.pass || 0}, fail ${c.fail || 0}, error ${c.error || 0}, skipped ${c.skipped || 0})`);
  if (reportPath) log(`  report: ${reportPath}`);
  if (report.overall === 'skipped') log('  nothing was validated - skipped gates are NOT passes.');
}

function run(args, ctx) {
  const o = parseArgs(args || []);
  const out = (m) => console.log(m);
  const errOut = (m) => console.error(m);
  if (o.help) { out(USAGE); return 0; }
  if (!o.plugin) { errOut('apc audio: missing <Plugin>\n' + USAGE); return 2; }
  if (o.errors.length) { errOut('apc audio: ' + o.errors.join('; ') + '\n' + USAGE); return 2; }

  const deps = { exec: defaultExec, env: process.env, ...(ctx && ctx.deps) };
  const root = ctx.root;
  const pluginDir = ctx.pluginPath(o.plugin);
  if (!fs.existsSync(pluginDir)) { errOut(`apc audio: plugin folder not found: ${pluginDir}`); return 2; }
  const status = readJsonSafe(path.join(pluginDir, 'status.json'));
  let cfg = {};
  try { cfg = ctx.readConfig() || {}; } catch { cfg = {}; }
  const thresholds = mergeThresholds(cfg.audio, status && status.audio);
  const buildDir = path.resolve(o.buildDir || ctx.resolvePaths().buildDir);

  let harnessBuildError = null;
  if (o.buildHarness) {
    if (!o.json) out(`apc audio: building harness in ${harnessSearchDir(buildDir)}${o.harnessSanitize && o.harnessSanitize !== 'none' ? ` (APC_SANITIZE=${o.harnessSanitize})` : ''} ...`);
    const b = buildHarness({ root, buildDir, sanitizer: o.harnessSanitize, exec: deps.exec, env: deps.env });
    if (!b.ok) { harnessBuildError = b.message; errOut(`apc audio: harness build failed: ${b.message}`); }
  }

  const report = runGates({
    root, plugin: o.plugin, pluginDir, buildDir, gates: o.gates, flags: o.flags, thresholds, status,
    overrides: o.overrides, harnessBuildError,
  }, deps);

  const reportPath = path.resolve(o.report || path.join(pluginDir, REPORT_NAME));
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  } catch (e) {
    errOut(`apc audio: could not write report ${reportPath}: ${e.message}`);
  }

  if (o.json) out(JSON.stringify(report, null, 2));
  else printHuman(report, reportPath, out);
  return exitCodeFor(report, o.failOnSkip);
}

module.exports = {
  run, runGates, parseArgs, mergeThresholds, summarize, exitCodeFor,
  readWav, writeWavFloat32, compareBuffers, compareWavFiles,
  findPluginBinary, findPluginval, findClapValidator, findHarness, buildHarness,
  harnessArgs, DEFAULTS, GATE_IDS, SCHEMA, REPORT_NAME,
};
