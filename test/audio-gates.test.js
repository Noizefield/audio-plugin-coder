'use strict';
// apc audio gate orchestration tests. Zero deps: node:test + node:assert (Node 18+).
// Run: node --test test/audio-gates.test.js
// No built plugin, pluginval or JUCE harness is needed: executables are replaced by an
// injected `exec` that emulates pluginval / apc_audio_harness. What is verified here is the
// ORCHESTRATION (skip-not-pass semantics, thresholds, compare math, report schema), not DSP.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const audio = require('../scripts/apc-audio.js');

const isWin = process.platform === 'win32';
const EXE = (n) => (isWin ? `${n}.exe` : n);

// ─── fixtures ──────────────────────────────────────────────────────────────

const tmpDirs = [];
function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-audio-test-'));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

function touch(file, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Build a throwaway repo root with plugin Demo and selectable artefacts/tools. */
function fixture(opts = {}) {
  const root = mkTmp();
  const status = opts.status || { plugin_name: 'Demo', formats: { clap: false } };
  touch(path.join(root, 'plugins', 'Demo', 'status.json'), JSON.stringify(status));
  const buildDir = path.join(root, 'build');
  const art = path.join(buildDir, 'plugins', 'Demo', 'Demo_artefacts', 'Release');
  if (opts.vst3 !== false) touch(path.join(art, 'VST3', 'Demo.vst3'));
  if (opts.clap) touch(path.join(art, 'CLAP', 'Demo.clap'));
  const harness = path.join(buildDir, 'audio-harness', 'apc_audio_harness_artefacts', 'Release', EXE('apc_audio_harness'));
  if (opts.harness !== false) touch(harness);
  const pluginval = path.join(root, '_tools', 'pluginval-bin', EXE('pluginval'));
  if (opts.pluginval !== false) touch(pluginval);
  const clapVal = path.join(root, '_tools', 'clap-validator-bin', EXE('clap-validator'));
  if (opts.clapValidator) touch(clapVal);
  return { root, buildDir, pluginDir: path.join(root, 'plugins', 'Demo'), harness, pluginval, clapVal, status };
}

/** PATH-less env so real pluginval / clap-validator on the dev machine are never picked up. */
const CLEAN_ENV = { PATH: '' };

function flagsOf(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) o[k] = args[++i]; else o[k] = true;
    }
  }
  return o;
}

/** Deterministic fake plugin output: depends on signal and sample rate, not on block size. */
function fakeChannels(a, extra = 0) {
  const frames = Math.round(Number(a.seconds) * Number(a.sr)) + (a.signal === 'silence-after-signal' ? Math.round((Number(a.tail) || 0) * Number(a.sr)) : 0);
  const sig = [...String(a.signal)].reduce((s, c) => s + c.charCodeAt(0), 0);
  const ch = new Float32Array(Math.min(frames, 2000));
  for (let i = 0; i < ch.length; i++) ch[i] = 0.25 * Math.sin(i * 0.05 + sig) + extra;
  return [ch, ch];
}

/**
 * Emulates apc_audio_harness. `model(a)` returns overrides:
 *   { exit, metrics:{...}, extra }  (extra shifts the waveform to simulate drift)
 */
function fakeHarness(model = () => ({})) {
  return (args) => {
    const f = flagsOf(args);
    const a = { signal: f.signal, sr: f.sr, block: Number(f.block), seconds: f.seconds, tail: f['tail-seconds'], sanitize: !!f.sanitize };
    const m = model(a, f) || {};
    if (m.exit != null && m.exit !== 0) return { status: m.exit, signal: null, stdout: '', stderr: m.stderr || 'boom', error: null };
    const channels = fakeChannels(a, m.extra || 0);
    fs.writeFileSync(f.out, JSON.stringify({
      schema: 'apc-audio-harness/1', ok: true, plugin: 'Demo', signal: a.signal, sample_rate: Number(a.sr), block_size: a.block,
      frames: channels[0].length, peak_db: -12, rms_db: -18 - (a.signal === 'impulse' ? 3 : 0), nan_count: 0, inf_count: 0, denormal_count: 0,
      tail_db: a.signal === 'silence-after-signal' ? -120 : null, plugin_tail_seconds: 0, realtime_factor: 100, ...(m.metrics || {}),
    }));
    if (f['write-wav']) fs.writeFileSync(f['write-wav'], audio.writeWavFloat32(channels, Number(a.sr)));
    return { status: 0, signal: null, stdout: '', stderr: '', error: null };
  };
}

function fakePluginval(result) {
  return (args) => ({ status: 0, signal: null, stdout: 'Starting tests...\nSUCCESS\n', stderr: '', error: null, ...result, args });
}

function makeExec(handlers) {
  const calls = [];
  const fn = (file, args, o) => {
    const base = path.basename(file).replace(/\.(exe|cmd)$/i, '');
    calls.push({ base, file, args, opts: o });
    const h = handlers[base];
    if (!h) return { status: null, signal: null, stdout: '', stderr: '', error: `ENOENT: ${base}` };
    return h(args, file);
  };
  fn.calls = calls;
  return fn;
}

function opts(fx, over = {}) {
  return {
    root: fx.root, plugin: 'Demo', pluginDir: fx.pluginDir, buildDir: fx.buildDir,
    gates: audio.GATE_IDS, flags: {}, thresholds: audio.mergeThresholds(), status: fx.status, overrides: {}, ...over,
  };
}

const gateById = (report, id) => report.gates.find((g) => g.id === id);

function captureRun(args, ctx) {
  const out = []; const err = [];
  const ol = console.log; const oe = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try { code = audio.run(args, ctx); } finally { console.log = ol; console.error = oe; }
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function ctxFor(fx, exec, env = CLEAN_ENV) {
  return {
    root: fx.root,
    pluginPath: (n) => path.join(fx.root, 'plugins', n),
    resolvePaths: () => ({ buildDir: fx.buildDir, releaseDir: path.join(fx.root, 'release') }),
    readConfig: () => ({}),
    deps: { exec, env },
  };
}

// ─── pure helpers ──────────────────────────────────────────────────────────

test('parseArgs: plugin, gate lists, flags and validation', () => {
  const a = audio.parseArgs(['Demo', '--gate', 'nan,tail', '--gate', 'null', '--json', '--baseline-update', '--build-dir', 'X', '--runs', '3', '--tail-seconds', '1.5']);
  assert.equal(a.plugin, 'Demo');
  assert.deepEqual(a.gates, ['null', 'nan', 'tail']); // canonical order, deduped
  assert.equal(a.json, true);
  assert.equal(a.flags.baselineUpdate, true);
  assert.equal(a.flags.runs, 3);
  assert.equal(a.flags.tailSeconds, 1.5);
  assert.equal(a.buildDir, 'X');
  assert.deepEqual(audio.parseArgs(['Demo']).gates, audio.GATE_IDS);
  assert.deepEqual(audio.parseArgs(['Demo', '--gate', 'all']).gates, audio.GATE_IDS);
  assert.match(audio.parseArgs(['Demo', '--gate', 'bogus']).errors.join(), /unknown gate/);
  assert.match(audio.parseArgs(['Demo', '--wat']).errors.join(), /unknown option/);
  assert.match(audio.parseArgs(['Demo', '--runs', '0']).errors.join(), /--runs/);
});

test('mergeThresholds: defaults < config.audio < status.audio', () => {
  const t = audio.mergeThresholds({ bench: { min_realtime_factor: 10 }, tail: { max_db: -80 } }, { bench: { min_realtime_factor: 50 } });
  assert.equal(t.bench.min_realtime_factor, 50);
  assert.equal(t.tail.max_db, -80);
  assert.equal(t.nan.max_denormals, 0);
  assert.equal(audio.DEFAULTS.tail.max_db, -90);
  assert.equal(audio.DEFAULTS.bench.min_realtime_factor, 20);
  assert.equal(audio.DEFAULTS.pluginval.strictness_level, 10);
  assert.equal(audio.mergeThresholds().bench.min_realtime_factor, 20); // defaults not mutated
});

test('WAV: float32 roundtrip and 16-bit PCM parse', () => {
  const ch = [Float32Array.from([0, 0.5, -0.25]), Float32Array.from([1, -1, 0])];
  const w = audio.readWav(audio.writeWavFloat32(ch, 48000));
  assert.equal(w.sampleRate, 48000);
  assert.equal(w.numChannels, 2);
  assert.equal(w.frames, 3);
  assert.deepEqual(Array.from(w.channels[0]), [0, 0.5, -0.25]);
  assert.deepEqual(Array.from(w.channels[1]), [1, -1, 0]);

  // hand-built 16-bit mono PCM
  const pcm = Buffer.alloc(44 + 4);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(40, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(44100, 24); pcm.writeUInt32LE(88200, 28);
  pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(4, 40);
  pcm.writeInt16LE(16384, 44); pcm.writeInt16LE(-32768, 46);
  const p = audio.readWav(pcm);
  assert.equal(p.sampleRate, 44100);
  assert.equal(p.channels[0][0], 0.5);
  assert.equal(p.channels[0][1], -1);
  assert.throws(() => audio.readWav(Buffer.from('not a wav file at all')), /RIFF/);
});

test('compareBuffers: max diff, RMS and null depth math', () => {
  const mk = (arr, sr = 48000) => audio.readWav(audio.writeWavFloat32([Float32Array.from(arr)], sr));
  const ref = mk(new Array(100).fill(0.5));
  const same = audio.compareBuffers(ref, mk(new Array(100).fill(0.5)));
  assert.equal(same.max_abs_diff, 0);
  assert.equal(same.null_depth_db, -300);
  assert.equal(same.shape_ok, true);

  const cand = mk(new Array(100).fill(0.51));
  const c = audio.compareBuffers(ref, cand);
  assert.ok(Math.abs(c.max_abs_diff - 0.01) < 1e-6);
  assert.ok(Math.abs(c.rms_diff - 0.01) < 1e-6);
  assert.ok(Math.abs(c.null_depth_db - 20 * Math.log10(0.01 / 0.5)) < 1e-3); // about -33.98 dB

  const spike = new Array(100).fill(0.5); spike[40] = 0.9;
  assert.ok(Math.abs(audio.compareBuffers(ref, mk(spike)).max_abs_diff - 0.4) < 1e-6);

  assert.equal(audio.compareBuffers(ref, mk(new Array(99).fill(0.5))).shape_ok, false); // length differs
  assert.equal(audio.compareBuffers(ref, mk(new Array(100).fill(0.5), 44100)).shape_ok, false); // rate differs
  assert.equal(audio.compareBuffers(mk(new Array(10).fill(0)), mk(new Array(10).fill(0.1))).null_depth_db, null); // silent reference
  const nan = audio.compareBuffers(ref, mk(new Array(100).fill(NaN)));
  assert.ok(Number.isNaN(nan.max_abs_diff) || !(nan.max_abs_diff <= 1e-3)); // NaN never compares as "close"
});

test('summarize / exitCodeFor: skipped is not a pass', () => {
  const s = (statuses) => { const r = audio.summarize(statuses.map((status, i) => ({ id: String(i), status }))); return { ...r }; };
  assert.equal(s(['skipped', 'skipped']).overall, 'skipped');
  assert.equal(s(['pass', 'skipped']).overall, 'pass');
  assert.equal(s(['pass', 'fail']).overall, 'fail');
  assert.equal(s(['pass', 'error']).overall, 'fail');
  assert.equal(audio.exitCodeFor(s(['skipped']), false), 3);
  assert.equal(audio.exitCodeFor(s(['pass', 'skipped']), false), 0);
  assert.equal(audio.exitCodeFor(s(['pass', 'skipped']), true), 1); // --fail-on-skip
  assert.equal(audio.exitCodeFor(s(['fail']), false), 1);
});

test('findPluginBinary: locates Release artefacts, null when absent', () => {
  const fx = fixture({ clap: true });
  assert.ok(audio.findPluginBinary(fx.buildDir, 'Demo', 'VST3').endsWith('Demo.vst3'));
  assert.ok(audio.findPluginBinary(fx.buildDir, 'Demo', 'CLAP').endsWith('Demo.clap'));
  assert.equal(audio.findPluginBinary(fx.buildDir, 'Nope', 'VST3'), null);
});

// ─── skip-not-pass semantics ───────────────────────────────────────────────

test('no built plugin: every gate is skipped with a reason, overall skipped, exit 3', () => {
  const fx = fixture({ vst3: false });
  const exec = makeExec({});
  const report = audio.runGates(opts(fx), { exec, env: CLEAN_ENV });
  assert.equal(report.overall, 'skipped');
  for (const g of report.gates) {
    assert.equal(g.status, 'skipped', `${g.id} must be skipped`);
    assert.ok(g.reason && g.reason.length > 10, `${g.id} needs a reason`);
  }
  assert.equal(exec.calls.length, 0, 'nothing may be executed without a binary');
  assert.equal(audio.exitCodeFor(report, false), 3);
});

test('missing harness and pluginval: those gates skip, never pass', () => {
  const fx = fixture({ harness: false, pluginval: false });
  const report = audio.runGates(opts(fx), { exec: makeExec({}), env: CLEAN_ENV });
  assert.equal(gateById(report, 'pluginval').status, 'skipped');
  assert.match(gateById(report, 'pluginval').reason, /pluginval not found/);
  for (const id of ['null', 'nan', 'tail', 'bench']) {
    assert.equal(gateById(report, id).status, 'skipped');
    assert.match(gateById(report, id).reason, /harness/);
  }
  assert.equal(report.counts.pass, 0);
});

test('harness build failure message is carried into the skip reason', () => {
  const fx = fixture({ harness: false });
  const report = audio.runGates(opts(fx, { gates: ['nan'], harnessBuildError: 'cmake not found on PATH' }), { exec: makeExec({}), env: CLEAN_ENV });
  assert.match(gateById(report, 'nan').reason, /cmake not found on PATH/);
});

test('clap gate: skipped unless opted in, binary built and validator present', () => {
  // not opted in
  let fx = fixture({ clap: true, clapValidator: true });
  let r = audio.runGates(opts(fx, { gates: ['clap'] }), { exec: makeExec({}), env: CLEAN_ENV });
  assert.equal(gateById(r, 'clap').status, 'skipped');
  assert.match(gateById(r, 'clap').reason, /did not opt into CLAP/);

  // opted in, no .clap
  fx = fixture({ status: { formats: { clap: true } }, clapValidator: true });
  r = audio.runGates(opts(fx, { gates: ['clap'] }), { exec: makeExec({}), env: CLEAN_ENV });
  assert.match(gateById(r, 'clap').reason, /CLAP binary not found/);

  // opted in, built, no validator
  fx = fixture({ status: { formats: { clap: true } }, clap: true });
  r = audio.runGates(opts(fx, { gates: ['clap'] }), { exec: makeExec({}), env: CLEAN_ENV });
  assert.match(gateById(r, 'clap').reason, /clap-validator not found/);
  assert.equal(gateById(r, 'clap').status, 'skipped');
});

test('clap gate: pass, fail, and known upstream failures (clap-001) are ignored only when named', () => {
  const fx = fixture({ status: { formats: { clap: true } }, clap: true, clapValidator: true });
  const run = (res) => gateById(audio.runGates(opts(fx, { gates: ['clap'] }), { exec: makeExec({ 'clap-validator': () => res }), env: CLEAN_ENV }), 'clap');
  assert.equal(run({ status: 0, stdout: '44 tests run, 44 passed, 0 failed', stderr: '' }).status, 'pass');
  assert.equal(run({ status: 1, stdout: 'plugin-features\n  FAILED -- 3ms', stderr: '' }).status, 'fail');
  const known = run({ status: 1, stdout: 'state-reproducibility-basic\n  \u001b[31mFAILED\u001b[0m -- 5ms\n', stderr: '' });
  assert.equal(known.status, 'pass');
  assert.equal(known.metrics.ignored_known_failures, 1);
  const mixed = run({ status: 1, stdout: 'state-reproducibility-basic\n  FAILED\nparams-flush\n  FAILED', stderr: '' });
  assert.equal(mixed.status, 'fail');
});

// ─── pluginval gate ────────────────────────────────────────────────────────

test('pluginval gate: strictness 10, pass / fail / no-SUCCESS / exec error', () => {
  const fx = fixture();
  const go = (h) => {
    const exec = makeExec({ pluginval: h });
    const g = gateById(audio.runGates(opts(fx, { gates: ['pluginval'] }), { exec, env: CLEAN_ENV }), 'pluginval');
    return { g, call: exec.calls[0] };
  };
  const ok = go(fakePluginval({}));
  assert.equal(ok.g.status, 'pass');
  const args = ok.call.args;
  assert.equal(args[args.indexOf('--strictness-level') + 1], '10');
  assert.equal(args[args.indexOf('--validate') + 1].endsWith('Demo.vst3'), true);

  const bad = go(fakePluginval({ status: 1, stdout: 'FAILED: Open plugin (cold)\n' }));
  assert.equal(bad.g.status, 'fail');
  assert.match(bad.g.reason, /exited 1/);

  const noMarker = go(fakePluginval({ status: 0, stdout: 'done' }));
  assert.equal(noMarker.g.status, 'fail');
  assert.match(noMarker.g.reason, /no SUCCESS/);

  const broken = go(() => ({ status: null, stdout: '', stderr: '', error: 'spawn EPERM' }));
  assert.equal(broken.g.status, 'error');
});

// ─── render-harness gates ──────────────────────────────────────────────────

test('nan gate: clean render passes; NaN, Inf and denormals fail; crash fails; load error is an error', () => {
  const fx = fixture();
  const go = (model, flags = {}, thr) => {
    const exec = makeExec({ apc_audio_harness: fakeHarness(model) });
    const o = opts(fx, { gates: ['nan'], flags });
    if (thr) o.thresholds = audio.mergeThresholds({ nan: thr });
    return { g: gateById(audio.runGates(o, { exec, env: CLEAN_ENV }), 'nan'), exec };
  };
  assert.equal(go(() => ({})).g.status, 'pass');
  const nan = go((a) => (a.signal === 'sweep' ? { metrics: { nan_count: 4 } } : {}));
  assert.equal(nan.g.status, 'fail');
  assert.equal(nan.g.metrics.nan_count, 4);
  assert.equal(go(() => ({ metrics: { inf_count: 1 } })).g.status, 'fail');
  assert.equal(go(() => ({ metrics: { denormal_count: 7 } })).g.status, 'fail');
  assert.equal(go(() => ({ metrics: { denormal_count: 7 } }), {}, { max_denormals: 40 }).g.status, 'pass');
  const crash = go(() => ({ exit: 3221225477, stderr: 'access violation' }));
  assert.equal(crash.g.status, 'fail');
  assert.match(crash.g.reason, /crashed/);
  const loadErr = go(() => ({ exit: 3, stderr: 'could not instantiate plugin' }));
  assert.equal(loadErr.g.status, 'error');
  const san = go(() => ({}), { sanitize: true });
  assert.ok(san.exec.calls.every((c) => c.args.includes('--sanitize')), '--sanitize forwarded to every nan render');
});

test('tail gate: threshold -90 dBFS, declared tail from status.json, plugin-reported fallback', () => {
  const run = (fx, model, flags = {}) => {
    const exec = makeExec({ apc_audio_harness: fakeHarness(model) });
    return { g: gateById(audio.runGates(opts(fx, { gates: ['tail'], flags }), { exec, env: CLEAN_ENV }), 'tail'), exec };
  };
  let fx = fixture({ status: { audio: { tail_seconds: 3 } } });
  let r = run(fx, () => ({ metrics: { tail_db: -95 } }));
  assert.equal(r.g.status, 'pass');
  assert.equal(r.g.thresholds.declared_tail_seconds, 3);
  assert.match(r.g.thresholds.declared_tail_source, /status\.json/);
  assert.equal(r.exec.calls[0].args[r.exec.calls[0].args.indexOf('--tail-seconds') + 1], '3');

  r = run(fx, () => ({ metrics: { tail_db: -60 } }));
  assert.equal(r.g.status, 'fail');
  assert.match(r.g.reason, /-60/);

  r = run(fx, () => ({ metrics: { tail_db: -95 } }), { tailSeconds: 1.25 }); // CLI beats status.json
  assert.equal(r.g.thresholds.declared_tail_seconds, 1.25);

  fx = fixture();
  r = run(fx, () => ({ metrics: { tail_db: -120, plugin_tail_seconds: 4.5 } }));
  assert.equal(r.g.status, 'pass');
  assert.equal(r.g.thresholds.declared_tail_seconds, 4.5);
  assert.match(r.g.thresholds.declared_tail_source, /getTailLengthSeconds/);

  r = run(fx, () => ({ metrics: { tail_db: -120, plugin_tail_seconds: -1 } })); // unbounded tail reported
  assert.equal(r.g.thresholds.declared_tail_seconds, audio.DEFAULTS.tail.default_tail_seconds);

  r = run(fx, () => ({ metrics: { tail_db: null } }));
  assert.equal(r.g.status, 'error');
});

test('bench gate: median of N runs against the realtime budget', () => {
  const fx = fixture();
  const go = (factors, flags = {}, thr) => {
    let i = 0;
    const exec = makeExec({ apc_audio_harness: fakeHarness(() => ({ metrics: { realtime_factor: factors[i++ % factors.length] } })) });
    const o = opts(fx, { gates: ['bench'], flags });
    if (thr) o.thresholds = audio.mergeThresholds({ bench: thr });
    return { g: gateById(audio.runGates(o, { exec, env: CLEAN_ENV }), 'bench'), exec };
  };
  const ok = go([10, 30, 25, 5, 26]); // median 25 >= 20
  assert.equal(ok.g.status, 'pass');
  assert.equal(ok.g.metrics.realtime_factor_median, 25);
  assert.equal(ok.exec.calls.length, 5, 'default 5 runs');
  const slow = go([10, 12, 30]);      // median 12 < 20
  assert.equal(slow.g.status, 'fail');
  assert.match(slow.g.reason, /12/);
  assert.equal(go([10, 12, 30], { runs: 3 }, { min_realtime_factor: 5 }).g.status, 'pass');
  assert.equal(go([100], { runs: 2 }).exec.calls.length, 2);
  assert.equal(go([0]).g.status, 'error'); // a zero factor is a tooling problem, not a pass
});

test('null gate: baseline write, compare, drift detection, missing baseline is not a pass', () => {
  const fx = fixture();
  const exec = (model) => makeExec({ apc_audio_harness: fakeHarness(model) });
  const gate = (model, flags = {}, over = {}) => gateById(audio.runGates(opts(fx, { gates: ['null'], flags, ...over }), { exec: exec(model), env: CLEAN_ENV }), 'null');
  const baseDir = path.join(fx.pluginDir, 'Tests', 'audio-baseline');

  // 1. no baseline yet: invariance checks pass, but the gate must NOT claim a full pass
  let g = gate(() => ({}));
  assert.equal(g.status, 'skipped');
  assert.match(g.reason, /baseline/);
  assert.ok(g.details.some((d) => d.check === 'block-size-invariance' && d.status === 'pass'));
  assert.ok(g.details.some((d) => d.check === 'baseline' && d.status === 'skipped'));

  // 2. --baseline-update writes baseline WAVs
  g = gate(() => ({}), { baselineUpdate: true });
  assert.equal(g.status, 'pass');
  const files = fs.readdirSync(baseDir).sort();
  assert.deepEqual(files, ['impulse-48000-512.wav', 'pink-48000-512.wav', 'sweep-48000-512.wav']);
  assert.ok(g.notes.some((n) => /3 baseline/.test(n)));

  // 3. identical render compares clean
  g = gate(() => ({}));
  assert.equal(g.status, 'pass');
  assert.equal(g.details.filter((d) => d.check === 'baseline' && d.status === 'pass').length, 3);

  // 4. drift above baseline_tolerance (1e-3) fails; below passes
  g = gate(() => ({ extra: 0.01 }));
  assert.equal(g.status, 'fail');
  assert.ok(g.details.some((d) => d.check === 'baseline' && d.status === 'fail' && d.max_abs_diff > 1e-3));
  g = gate(() => ({ extra: 0.0001 }));
  assert.equal(g.status, 'pass');

  // 5. block-size dependent output fails the invariance check even with a fresh baseline
  g = gate((a) => ({ extra: a.block === 64 ? 0.05 : 0 }), { baselineUpdate: true });
  assert.equal(g.status, 'fail');
  const inv = g.details.filter((d) => d.check === 'block-size-invariance' && d.status === 'fail');
  assert.ok(inv.length >= 1);
  assert.ok(inv.every((d) => d.block_size === 64));
});

test('null gate: renders every configured sample rate x block size pair', () => {
  const fx = fixture();
  const seen = new Set();
  const exec = makeExec({ apc_audio_harness: fakeHarness((a) => { seen.add(`${a.sr}/${a.block}`); return {}; }) });
  audio.runGates(opts(fx, { gates: ['null'], flags: { baselineUpdate: true } }), { exec, env: CLEAN_ENV });
  for (const sr of [44100, 48000, 96000]) for (const b of [64, 512, 1024]) assert.ok(seen.has(`${sr}/${b}`), `missing render ${sr}/${b}`);
});

test('null gate: harness crash is a fail, not a skip', () => {
  const fx = fixture();
  const exec = makeExec({ apc_audio_harness: fakeHarness(() => ({ exit: 139, stderr: 'segfault' })) });
  const g = gateById(audio.runGates(opts(fx, { gates: ['null'] }), { exec, env: CLEAN_ENV }), 'null');
  assert.equal(g.status, 'fail');
});

// ─── report + CLI ──────────────────────────────────────────────────────────

test('report schema and CLI: file written next to the plugin, --json parses, exit codes', () => {
  const fx = fixture({ status: { formats: { clap: false }, audio: { tail_seconds: 2 } } });
  const exec = makeExec({ pluginval: fakePluginval({}), apc_audio_harness: fakeHarness() });
  const c = captureRun(['Demo', '--gate', 'pluginval,nan,tail,bench', '--json', '--runs', '2'], ctxFor(fx, exec));
  assert.equal(c.code, 0, c.err);

  const printed = JSON.parse(c.out);
  const onDisk = JSON.parse(fs.readFileSync(path.join(fx.pluginDir, '_audio-report.json'), 'utf8'));
  assert.deepEqual(printed, onDisk);
  assert.equal(onDisk.schema, 'apc-audio-report/1');
  assert.equal(onDisk.plugin, 'Demo');
  assert.match(onDisk.generated_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(onDisk.overall, 'pass');
  assert.deepEqual(Object.keys(onDisk.counts).sort(), ['error', 'fail', 'pass', 'skipped']);
  assert.deepEqual(onDisk.gates.map((g) => g.id), ['pluginval', 'nan', 'tail', 'bench']);
  for (const g of onDisk.gates) {
    assert.ok(['pass', 'fail', 'error', 'skipped'].includes(g.status));
    assert.equal(typeof g.duration_ms, 'number');
  }
  assert.ok(onDisk.thresholds.tail && onDisk.thresholds.bench && onDisk.thresholds.null);
  assert.ok(onDisk.inputs.vst3.endsWith('Demo.vst3'));
  assert.equal(onDisk.inputs.clap, null);
});

test('CLI exit codes: fail=1, all-skipped=3, --fail-on-skip=1, usage=2; --report overrides path', () => {
  const fx = fixture();
  const failing = makeExec({ pluginval: fakePluginval({ status: 1, stdout: 'FAILED' }), apc_audio_harness: fakeHarness() });
  assert.equal(captureRun(['Demo', '--gate', 'pluginval', '--json'], ctxFor(fx, failing)).code, 1);

  const bare = fixture({ vst3: false });
  assert.equal(captureRun(['Demo', '--json'], ctxFor(bare, makeExec({}))).code, 3);
  assert.equal(captureRun(['Demo', '--json', '--fail-on-skip'], ctxFor(bare, makeExec({}))).code, 1);

  const half = fixture({ harness: false });
  const exec = makeExec({ pluginval: fakePluginval({}) });
  assert.equal(captureRun(['Demo', '--json'], ctxFor(half, exec)).code, 0, 'a pass plus skips is exit 0');
  assert.equal(captureRun(['Demo', '--json', '--fail-on-skip'], ctxFor(half, exec)).code, 1);

  assert.equal(captureRun([], ctxFor(fx, makeExec({}))).code, 2);
  assert.equal(captureRun(['Demo', '--gate', 'nope'], ctxFor(fx, makeExec({}))).code, 2);
  assert.equal(captureRun(['Missing', '--json'], ctxFor(fx, makeExec({}))).code, 2);

  const custom = path.join(mkTmp(), 'sub', 'r.json');
  assert.equal(captureRun(['Demo', '--gate', 'pluginval', '--json', '--report', custom], ctxFor(fx, makeExec({ pluginval: fakePluginval({}) }))).code, 0);
  assert.ok(fs.existsSync(custom));
});

test('config audio section and status.json audio override thresholds through the CLI', () => {
  const fx = fixture({ status: { audio: { bench: { min_realtime_factor: 500 } } } });
  const ctx = ctxFor(fx, makeExec({ apc_audio_harness: fakeHarness(() => ({ metrics: { realtime_factor: 100 } })) }));
  ctx.readConfig = () => ({ audio: { bench: { min_realtime_factor: 5, runs: 2 } } });
  const c = captureRun(['Demo', '--gate', 'bench', '--json'], ctx);
  const r = JSON.parse(c.out);
  assert.equal(r.thresholds.bench.min_realtime_factor, 500); // status.json beats config
  assert.equal(r.gates[0].status, 'fail');                   // 100x < 500x
  assert.equal(r.gates[0].metrics.runs, 2);                  // runs came from config
});

// ─── shipped artifacts ─────────────────────────────────────────────────────

test('harness template and sanitizer module exist with the documented surface', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'templates', 'audio-test-harness', 'Main.cpp'), 'utf8');
  for (const needle of ['addHeadlessDefaultFormatsToManager', '--sanitize', 'nan_count', 'denormal_count', 'tail_db', 'max_abs_diff', 'ms_per_block', 'realtime_factor', 'silence-after-signal', 'impulse', 'sweep', 'pink']) {
    assert.ok(main.includes(needle), `Main.cpp should mention ${needle}`);
  }
  const cm = fs.readFileSync(path.join(root, 'templates', 'audio-test-harness', 'CMakeLists.txt'), 'utf8');
  assert.match(cm, /juce_add_console_app\(apc_audio_harness/);
  assert.match(cm, /apc_enable_sanitizers\(apc_audio_harness\)/);
  const san = fs.readFileSync(path.join(root, 'cmake', 'apc-sanitizers.cmake'), 'utf8');
  assert.match(san, /function\(apc_enable_sanitizers/);
  assert.match(san, /APC_SANITIZE/);
  assert.match(san, /fsanitize=address/);
  assert.match(san, /tsan is not supported with MSVC/);
});
