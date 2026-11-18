'use strict';
// Tests for scripts/validators/rt.js (static real-time-safety scanner).
// Zero deps: node:test + node:assert. Fixture plugins are written to OS temp dirs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const rt = require(path.join(REPO_ROOT, 'scripts', 'validators', 'rt.js'));

function makePlugin(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-rt-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return dir;
}

function scan(files) {
  const dir = makePlugin(files);
  try { return rt.validate(dir, {}).checks; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const by = (checks, status) => checks.filter((c) => c.status === status);
const has = (checks, check, status) => checks.some((c) => c.check === check && c.status === status);

// Wrap a processBlock body in a minimal JUCE-style processor (guard included unless told otherwise).
function proc(body, { guard = true, extra = '', header = '' } = {}) {
  return {
    'Source/PluginProcessor.cpp': `#include "PluginProcessor.h"
${header}
${extra}
void MyProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
${guard ? '    juce::ScopedNoDenormals noDenormals;' : ''}
${body}
}
`,
  };
}

const GOOD = {
  'Source/PluginProcessor.cpp': `#include "PluginProcessor.h"
// Note: we never call new or delete or std::mutex here, and DBG is banned.
static const char* kDoc = "std::mutex, new float[4], printf(\\"x\\")";

void MyProcessor::applyGain (juce::AudioBuffer<float>& buffer, float g)
{
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        buffer.applyGain (ch, 0, buffer.getNumSamples(), g);
}

void MyProcessor::prepareToPlay (double sr, int block)
{
    scratch.resize (static_cast<size_t> (block)); // allowed: not in the audio path
    auto* p = new int[4];                         // allowed: not in the audio path
    delete[] p;
    setLatencySamples (0);
}

void MyProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const float g = apvts.getRawParameterValue ("gain")->load();
    smoothed.setTargetValue (g);
    applyGain (buffer, smoothed.getNextValue());
}
`,
  'Source/PluginProcessor.h': '#pragma once\nclass MyProcessor { void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override; };\n',
};

test('good plugin: no failures, no warnings', () => {
  const checks = scan(GOOD);
  assert.deepEqual(by(checks, 'fail'), []);
  assert.deepEqual(by(checks, 'warn'), []);
  assert.ok(has(checks, 'rt-process-block', 'pass'));
  assert.ok(has(checks, 'rt-denormals', 'pass'));
  assert.ok(has(checks, 'rt-forbidden', 'pass'));
});

const BAD_CASES = [
  ['new', 'auto* p = new float[64]; (void) p;', 'rt-alloc-new'],
  ['delete', 'float* p = scratchPtr;\n    delete[] p;', 'rt-alloc-delete'],
  ['malloc', 'void* p = malloc (64); (void) p;', 'rt-alloc-c'],
  ['free', 'free (scratchPtr);', 'rt-alloc-c'],
  ['std::free', 'std::free (scratchPtr);', 'rt-alloc-c'],
  ['make_unique', 'auto p = std::make_unique<Voice>();', 'rt-alloc-smart'],
  ['push_back', 'voices.push_back (Voice{});', 'rt-vector-growth'],
  ['emplace_back', 'voices.emplace_back();', 'rt-vector-growth'],
  ['resize', 'scratch.resize (buffer.getNumSamples());', 'rt-vector-growth'],
  ['reserve', 'scratch.reserve (4096);', 'rt-vector-growth'],
  ['std::string', 'std::string s ("x"); (void) s;', 'rt-string'],
  ['std::to_string', 'auto s = std::to_string (buffer.getNumSamples());', 'rt-string'],
  ['juce::String', 'juce::String s = "gain"; (void) s;', 'rt-string'],
  ['string concat', 'auto id = name + "_gain"; (void) id;', 'rt-string-concat'],
  ['std::mutex', 'std::mutex m; (void) m;', 'rt-lock'],
  ['lock_guard', 'std::lock_guard<std::mutex> lk (mtx);', 'rt-lock'],
  ['unique_lock', 'std::unique_lock<std::mutex> lk (mtx);', 'rt-lock'],
  ['CriticalSection', 'juce::CriticalSection cs; (void) cs;', 'rt-lock'],
  ['ScopedLock', 'const juce::ScopedLock sl (lock);', 'rt-lock'],
  ['juce::File', 'juce::File f ("C:/x"); (void) f;', 'rt-io'],
  ['FileInputStream', 'juce::FileInputStream in (file);', 'rt-io'],
  ['URL', 'juce::URL u ("http://x");', 'rt-io'],
  ['Logger', 'juce::Logger::writeToLog ("hi");', 'rt-io'],
  ['DBG', 'DBG ("level " << level);', 'rt-io'],
  ['printf', 'printf ("%d", 1);', 'rt-io'],
  ['std::cout', 'std::cout << 1;', 'rt-io'],
  ['callSync', 'juce::MessageManager::callSync ([] {});', 'rt-message-thread'],
  ['std::thread', 'std::thread t ([] {}); t.detach();', 'rt-thread'],
  ['sleep', 'std::this_thread::sleep_for (std::chrono::milliseconds (1));', 'rt-blocking'],
];

for (const [name, body, check] of BAD_CASES) {
  test(`fails on ${name}`, () => {
    const checks = scan(proc(`    ${body}`));
    assert.ok(has(checks, check, 'fail'), `expected ${check} fail for "${body}", got:\n${JSON.stringify(checks, null, 1)}`);
    assert.ok(!has(checks, 'rt-forbidden', 'pass'));
  });
}

const WARN_CASES = [
  ['std::map', 'std::map<int, float> m; (void) m;', 'rt-container'],
  ['std::unordered_map', 'std::unordered_map<int, float> m; (void) m;', 'rt-container'],
  ['dynamic_cast', 'auto* p = dynamic_cast<Foo*> (base); (void) p;', 'rt-dynamic-cast'],
  ['throw', 'if (buffer.getNumSamples() < 0) throw std::runtime_error ("x");', 'rt-throw'],
];

for (const [name, body, check] of WARN_CASES) {
  test(`warns (not fails) on ${name}`, () => {
    const checks = scan(proc(`    ${body}`));
    assert.ok(has(checks, check, 'warn'), `expected ${check} warn, got ${JSON.stringify(checks)}`);
    assert.deepEqual(by(checks, 'fail').filter((c) => c.check !== 'rt-string'), [], 'no hard failures expected');
  });
}

test('AudioBuffer::setSize warns unless avoidReallocating = true; one finding per rule per line', () => {
  const loud = scan(proc('    wet.setSize (2, buffer.getNumSamples());'));
  assert.ok(has(loud, 'rt-buffer-setsize', 'warn'));
  const quiet = scan(proc('    wet.setSize (2, buffer.getNumSamples(), false, false, true);'));
  assert.ok(!quiet.some((c) => c.check === 'rt-buffer-setsize'));
  const dup = scan(proc('    const juce::String id = "a" + juce::String (1);'));
  assert.equal(dup.filter((c) => c.check === 'rt-string').length, 1);
});

test('fails when ScopedNoDenormals / DenormalGuard is missing', () => {
  const checks = scan(proc('    buffer.clear();', { guard: false }));
  assert.ok(has(checks, 'rt-denormals', 'fail'));
});

test('accepts apc::dsp::DenormalGuard', () => {
  const files = proc('    apc::dsp::DenormalGuard guard;\n    buffer.clear();', { guard: false });
  assert.ok(has(scan(files), 'rt-denormals', 'pass'));
});

test('denormal guard in a helper called from processBlock counts', () => {
  const files = proc('    run (buffer);', {
    guard: false,
    extra: 'void MyProcessor::run (juce::AudioBuffer<float>& b)\n{\n    juce::ScopedNoDenormals nd;\n    b.clear();\n}\n',
  });
  assert.ok(has(scan(files), 'rt-denormals', 'pass'));
});

test('violation inside a helper called from processBlock is reported with file:line and the caller', () => {
  const files = proc('    process (buffer);', {
    extra: 'void MyProcessor::process (juce::AudioBuffer<float>& b)\n{\n    b.clear();\n    scratch.push_back (1.0f);\n}\n',
  });
  const checks = scan(files);
  const f = checks.find((c) => c.check === 'rt-vector-growth');
  assert.ok(f, JSON.stringify(checks));
  assert.equal(f.status, 'fail');
  assert.match(f.message, /Source\/PluginProcessor\.cpp:\d+/);
  assert.match(f.message, /process\(\) reached from processBlock\(\)/);
  // line number points at the push_back line
  const src = proc('    process (buffer);', { extra: 'void MyProcessor::process (juce::AudioBuffer<float>& b)\n{\n    b.clear();\n    scratch.push_back (1.0f);\n}\n' })['Source/PluginProcessor.cpp'].split('\n');
  const line = src.findIndex((l) => l.includes('push_back')) + 1;
  assert.ok(f.message.includes(`Source/PluginProcessor.cpp:${line} `), `${f.message} (expected line ${line})`);
});

test('transitive helper chain (processBlock -> a -> b) is followed', () => {
  const files = proc('    a (buffer);', {
    extra: 'void MyProcessor::a (juce::AudioBuffer<float>& b)\n{\n    this->b2 (b);\n}\nvoid MyProcessor::b2 (juce::AudioBuffer<float>& b)\n{\n    auto* p = new int; delete p;\n}\n',
  });
  assert.ok(has(scan(files), 'rt-alloc-new', 'fail'));
});

test('helpers NOT reachable from processBlock are not flagged', () => {
  const files = proc('    buffer.clear();', {
    extra: 'void MyProcessor::loadPreset()\n{\n    std::mutex m; std::string s = "x" + name; auto* p = new int[3]; v.push_back (1); DBG ("x");\n}\n',
  });
  const checks = scan(files);
  assert.deepEqual(by(checks, 'fail'), []);
});

test('comments and string literals are ignored (line numbers preserved)', () => {
  const files = proc(`    // new float[4]; std::mutex; DBG("x"); malloc(1)
    /* delete p; std::thread t; */
    const char* a = "std::lock_guard new delete printf(";
    const char c = '"';
    const char* r = R"raw(std::mutex "quoted" new)raw";
    const int big = 1'000'000;
    (void) a; (void) c; (void) r; (void) big;
    buffer.clear(); // push_back in a trailing comment`);
  assert.deepEqual(by(scan(files), 'fail'), []);
});

test('apc-rt-ok: reason suppresses (same line and line above); bare marker does not', () => {
  const same = scan(proc('    auto* p = new int; // apc-rt-ok: pre-sized pool, placement only\n    (void) p;'));
  assert.ok(!has(same, 'rt-alloc-new', 'fail'));
  assert.ok(same.some((c) => c.check === 'rt-suppression' && c.status === 'info'));

  const above = scan(proc('    // apc-rt-ok: measured, bounded, one-off\n    scratch.reserve (4);'));
  assert.ok(!has(above, 'rt-vector-growth', 'fail'));

  const bare = scan(proc('    auto* p = new int; // apc-rt-ok\n    (void) p;'));
  assert.ok(has(bare, 'rt-alloc-new', 'fail'));
  assert.ok(has(bare, 'rt-suppression', 'warn'));
});

test('denormal check can be suppressed on the processBlock line', () => {
  const files = {
    'Source/PluginProcessor.cpp': '// apc-rt-ok: guard is installed by the host wrapper\nvoid MyProcessor::processBlock (juce::AudioBuffer<float>& b, juce::MidiBuffer&) { b.clear(); }\n',
  };
  const checks = scan(files);
  assert.ok(!has(checks, 'rt-denormals', 'fail'));
  assert.ok(has(checks, 'rt-denormals', 'info'));
});

test('latency: INFO when oversampling is mentioned but setLatencySamples is absent', () => {
  const absent = scan(proc('    buffer.clear(); // oversampling happens in wrapper', { header: '// uses 2x oversampling' }));
  assert.ok(has(absent, 'rt-latency', 'info'));
  const present = scan({
    ...proc('    buffer.clear();', { header: '// uses 2x oversampling' }),
    'Source/Other.cpp': 'void X::prepare() { setLatencySamples (31); }\n',
  });
  assert.ok(has(present, 'rt-latency', 'pass'));
});

test('bare juce type names are recognised with using namespace juce', () => {
  const files = proc('    File f ("x"); String s; (void) f; (void) s;', { header: 'using namespace juce;' });
  const checks = scan(files);
  assert.ok(has(checks, 'rt-io', 'fail'));
  assert.ok(has(checks, 'rt-string', 'fail'));
});

test('in-class (header) processBlock definition is found', () => {
  const checks = scan({
    'Source/PluginProcessor.h': 'class P {\npublic:\n  void processBlock (juce::AudioBuffer<float>& b, juce::MidiBuffer&) override\n  {\n    juce::ScopedNoDenormals nd;\n    v.push_back (1);\n  }\n};\n',
  });
  assert.ok(has(checks, 'rt-vector-growth', 'fail'));
});

test('declarations and call sites are not mistaken for definitions', () => {
  const checks = scan({ 'Source/PluginProcessor.h': 'class P { void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override; };\n' });
  assert.ok(has(checks, 'rt-process-block', 'fail'));
});

test('missing Source/ directory is a warning, missing processBlock is a failure', () => {
  const dir = makePlugin({ 'status.json': '{}' });
  try {
    const checks = rt.validate(dir, {}).checks;
    assert.ok(has(checks, 'rt-sources', 'warn'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const none = scan({ 'Source/Util.cpp': 'void f() {}\n' });
  assert.ok(has(none, 'rt-process-block', 'fail'));
});

test('every check has the contract shape', () => {
  for (const c of scan(proc('    auto* p = new int; std::map<int,int> m; (void) p;'))) {
    assert.equal(typeof c.check, 'string');
    assert.ok(['pass', 'fail', 'warn', 'info'].includes(c.status), c.status);
    assert.equal(typeof c.message, 'string');
  }
});

// ---- CLI integration -------------------------------------------------------

function cli(args, root) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, APC_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('CLI: apc validate rt --plugin <Name> (exit codes + --json)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-rt-cli-'));
  try {
    for (const [rel, content] of Object.entries(GOOD)) {
      const f = path.join(root, 'plugins', 'GoodOne', rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    }
    for (const [rel, content] of Object.entries(proc('    scratch.push_back (1.0f);'))) {
      const f = path.join(root, 'plugins', 'BadOne', rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    }
    assert.equal(cli(['validate', 'rt', '--plugin', 'GoodOne'], root).status, 0);
    const bad = cli(['validate', 'rt', '--plugin', 'BadOne', '--json'], root);
    assert.equal(bad.status, 1);
    const report = JSON.parse(bad.stdout);
    assert.ok(report.checks.some((c) => c.check === 'rt-vector-growth' && c.status === 'fail'));
    assert.equal(cli(['validate', 'rt'], root).status, 2); // --plugin required
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
