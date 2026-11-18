'use strict';
// Tests for scripts/apc-docs.js (apc docs check). Zero deps: node:test + node:assert.
// Run: node --test test/docs-check.test.js   (also part of `npm test`)
// Fixtures are temp roots; the final test also asserts the REAL repo is clean.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'bin', 'apc.js');
const docs = require(path.join(REPO_ROOT, 'scripts', 'apc-docs.js'));

const dirs = [];
function makeRoot(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-docs-test-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return dir;
}
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const rules = (res) => res.findings.map((f) => f.rule).sort();
const fence = (lang, body) => '```' + lang + '\n' + body + '\n```\n';

function have(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
const HAS_BASH = have('bash', ['-c', 'echo ok']);
const HAS_PS = have('pwsh', ['-NoProfile', '-Command', '1']) || have('powershell', ['-NoProfile', '-Command', '1']);

// ----------------------------------------------------------------- links
test('links: valid relative links and anchors pass, duplicates get -1 suffixes', () => {
  const root = makeRoot({
    'README.md': '# Title\n\nSee [guide](docs/guide.md), [section](docs/guide.md#second-part), [again](docs/guide.md#second-part-1), [self](#title), [dir](docs/), [root](/docs/guide.md).\n',
    'docs/guide.md': '# Guide\n\n## Second part\n\ntext\n\n## Second part\n\n## What\'s new? (v2)\n\n<a name="legacy-anchor"></a>\n',
    'docs/other.md': '[ok](guide.md#whats-new-v2) [legacy](guide.md#legacy-anchor)\n',
  });
  const res = docs.check(root, { only: ['links'] });
  assert.deepEqual(res.findings, []);
});

test('links: broken file, broken anchor, case mismatch and gitignored plans/ are errors', () => {
  const root = makeRoot({
    'README.md': '[a](docs/nope.md) [b](docs/guide.md#missing) [c](docs/GUIDE.md) [d](plans/secret.md)\n',
    'docs/guide.md': '# Guide\n',
    'plans/secret.md': '# local plan with [broken](nothing.md)\n',
  });
  const res = docs.check(root, { only: ['links'] });
  assert.deepEqual(rules(res), ['broken-anchor', 'broken-link', 'link-case-mismatch', 'link-to-gitignored']);
  assert.ok(res.findings.every((f) => f.file === 'README.md'), 'plans/ itself is not scanned');
});

test('links: code fences, inline code, placeholders and external links are not checked as files', () => {
  const root = makeRoot({
    'README.md': [
      'Inline `[x](nope.md)` is code.',
      '```md',
      '[fenced](nope.md)',
      '```',
      '[ph](plugins/<Name>/status.json) [tpl](${HOME}/x) [web](https://example.com/a) [mail](mailto:a@b.c)',
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['links'] });
  assert.deepEqual(res.findings, []);
  assert.equal(res.external.length, 1);
  assert.equal(res.external[0].url, 'https://example.com/a');
  assert.equal(res.skipped.filter((s) => s.check === 'links').length, 2);
});

test('links: reference definitions and html href/src are checked', () => {
  const root = makeRoot({
    'README.md': '[r][1]\n\n[1]: docs/nope.md\n\n<img src="assets/missing.png"> <a href="docs/ok.md">x</a>\n',
    'docs/ok.md': '# ok\n',
  });
  const res = docs.check(root, { only: ['links'] });
  assert.equal(res.findings.length, 2);
});

// -------------------------------------------------------------- snippets
test('snippets: json must parse; jsonc, placeholders and no-check are tolerated', () => {
  const root = makeRoot({
    'docs/a.md': [
      fence('json', '{"ok": true}'),
      fence('json', '{"broken": }'),
      fence('jsonc', '{\n  // a comment\n  "ok": 1,\n}'),
      fence('json', '{\n  "list": [1, 2, ...]\n}'),
      fence('json', '{ "path": <PluginPath> }'),
      fence('json', '{ "a": "<Name>" }'),
      fence('json no-check', '{ "template": 1-5 }'),
      fence('json', '{\n  // comment makes it invalid json\n  "a": 1\n}'),
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['snippets'] });
  const fails = res.findings.filter((f) => f.rule === 'json-invalid');
  assert.equal(fails.length, 2, JSON.stringify(res.findings));
  assert.ok(fails.some((f) => /mark the fence `jsonc`/.test(f.message)), 'comment case hints at jsonc');
  assert.equal(res.skipped.filter((s) => /placeholder/.test(s.reason)).length, 2);
  assert.equal(res.skipped.filter((s) => /no-check/.test(s.reason)).length, 1);
});

test('snippets: fences outside docs/ and .agents/ are not in scope', () => {
  const root = makeRoot({ 'README.md': fence('json', '{"broken": }'), 'CONTRIBUTING.md': fence('bash', 'if then fi fi') });
  const res = docs.check(root, { only: ['snippets'] });
  assert.deepEqual(res.findings, []);
  assert.equal(res.stats.snippets, 0);
});

test('snippets: bash syntax errors are caught, <Placeholders> substituted', { skip: !HAS_BASH && 'bash not available' }, () => {
  const root = makeRoot({
    'docs/a.md': [
      fence('bash', 'echo "hello"\nfor f in *; do echo $f; done\nscripts/build.sh <Name> --flag'),
      fence('sh', 'if [ -f x ]; then\n  echo yes\n'),
      fence('bash', 'cat <file name> | wc -l'),
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['snippets'] });
  const bad = res.findings.filter((f) => f.rule === 'bash-syntax');
  assert.equal(bad.length, 1, JSON.stringify(res.findings));
  assert.equal(bad[0].line, 7, 'points at the second fence');
});

test('snippets: PowerShell parse errors are caught, <Placeholders> and @{...} substituted', { skip: !HAS_PS && 'no PowerShell available' }, () => {
  const root = makeRoot({
    'docs/a.md': [
      fence('powershell', 'Write-Host "hi"\n.\\scripts\\build.ps1 -PluginName <Name>\nUpdate-State -Updates @{...}'),
      fence('powershell', 'if ($x -eq 1 {\n  Write-Host "unclosed"\n'),
      fence('ps1', 'Get-ChildItem | Where-Object { $_.Name -like "*.md" }'),
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['snippets'] });
  const bad = res.findings.filter((f) => f.rule === 'powershell-syntax');
  assert.equal(bad.length, 1, JSON.stringify(res.findings));
  assert.equal(bad[0].file, 'docs/a.md');
});

// ----------------------------------------------------------------- stale
test('stale: every rule fires on a fixture', () => {
  const root = makeRoot({
    'docs/stale.md': [
      'Run /dream to start.',
      'Look in .agent/troubleshooting for fixes.',
      'We use JUCE 8 here.',
      'Visage support is not yet implemented.',
      'Put plugins under ./plugins by default.',
      '    file(GLOB PLUGIN_DIRS "plugins/*")',
      '| Platform | Windows | macOS | Linux |',
      '|---|---|---|---|',
      '| Local build | ✅ | ❌ | ❌ |',
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['stale'] });
  const byRule = res.summary.byRule;
  assert.equal(byRule['bare-primary-command'], 1);
  assert.equal(byRule['singular-agent-dir'], 1);
  assert.equal(byRule['juce-8'], 1);
  assert.equal(byRule['visage-not-implemented'], 1);
  assert.equal(byRule['plugins-dir-assumption'], 1);
  assert.equal(byRule['cmake-glob-plugins'], 1);
  assert.equal(byRule['platform-local-build-unsupported'], 2, 'macOS and Linux cells');
});

test('stale: noted aliases, negations, host-folder lists and JUCE 8 -> 9 migration notes are not stale', () => {
  const root = makeRoot({
    'docs/ok.md': [
      '`/apc-plan` (deprecated alias `/plan`)',
      '`/apc-design` also reachable as /design.',
      'Do not use /plan in Codex; it is reserved.',
      'Host folders: `.claude/`, `.kilocode/`, `.agent/` legacy.',
      'Never hardcode `./plugins`.',
      'Migrating from JUCE 8 to JUCE 9 changes headers.',
      'The path .agents/skills/plan/SKILL.md and docs/plan/ and https://x.y/status are fine.',
      'Write plan.md or /plan.md? No: see skills/plan.',
      '',
    ].join('\n'),
  });
  const res = docs.check(root, { only: ['stale'] });
  assert.deepEqual(res.findings, [], JSON.stringify(res.findings));
});

test('stale: allow-list entries suppress, debt is counted separately and --strict re-enables it', () => {
  const root = makeRoot({
    'docs/a.md': 'Run /ship now.\nJUCE 8 forever.\n',
    'docs/.stale-allowlist.json': JSON.stringify({
      allow: [
        { rule: 'juce-8', file: 'docs/a.md', contains: 'forever', reason: 'fixture' },
        { rule: 'bare-primary-command', file: 'docs/**', debt: true, reason: 'known debt' },
        { rule: 'juce-8', reason: 'bare rule entries never match' },
        { rule: 'singular-agent-dir', file: 'docs/none.md', reason: 'stale entry' },
      ],
    }),
  });
  const res = docs.check(root, { only: ['stale'] });
  assert.equal(res.summary.errors, 0);
  assert.equal(res.stats.allowed, 1);
  assert.equal(res.stats.allowedDebt, 1);
  assert.equal(res.debt[0].rule, 'bare-primary-command');
  assert.ok(res.findings.every((f) => f.severity === 'warning'));
  const strict = docs.check(root, { only: ['stale'], strict: true });
  assert.equal(strict.summary.errors, 1, 'debt becomes an error under --strict');
});

test('stale: invalid allow-list JSON is itself an error; unused entries only warn on full runs', () => {
  const bad = makeRoot({ 'docs/a.md': '# a\n', 'docs/.stale-allowlist.json': '{ nope' });
  assert.deepEqual(rules(docs.check(bad, { only: ['stale'] })), ['allowlist-invalid']);
  const unused = makeRoot({ 'docs/a.md': '# a\n', 'docs/.stale-allowlist.json': JSON.stringify({ allow: [{ rule: 'juce-8', file: 'docs/a.md', reason: 'x' }] }) });
  assert.deepEqual(rules(docs.check(unused, { only: ['stale'] })), [], 'partial run: no unused warning');
  const full = docs.check(unused, { only: ['links', 'snippets', 'stale', 'version'] });
  assert.deepEqual(rules(full), ['allowlist-unused']);
  assert.equal(full.summary.errors, 0);
});

// --------------------------------------------------------------- version
test('version: hub/version.js drift is reported via `apc version sync`; README static badge compared', () => {
  const root = makeRoot({
    'package.json': JSON.stringify({ name: 'x', version: '1.2.3' }),
    'CMakeLists.txt': '# reads package.json\nproject(X)\n',
    'hub/version.js': 'var APC_VERSION = "1.0.0";\n',
    'README.md': '![v](https://img.shields.io/badge/Version-1.1.0-blue)\n',
  });
  const res = docs.check(root, { only: ['version'] });
  assert.deepEqual(rules(res), ['readme-badge', 'version-sync']);
  assert.match(res.findings.find((f) => f.rule === 'version-sync').message, /exited 1/);
});

test('version: agreeing files are clean; dynamic badge ignored', () => {
  const root = makeRoot({
    'package.json': JSON.stringify({ name: 'x', version: '1.2.3' }),
    'CMakeLists.txt': '# reads package.json\nproject(X)\n',
    'hub/version.js': `// AUTO-GENERATED by \`apc version sync\` — do not edit by hand.\n// Canonical source: package.json ("version"). The Hub web UI reads\n// window.APC_VERSION from this file via a <script> tag (works over\n// file:// where fetch() of JSON is blocked). If this file is missing the\n// Hub must render [NOT FOUND] + this path (read-only honesty).\nvar APC_VERSION = "1.2.3";\nif (typeof window !== "undefined") { window.APC_VERSION = APC_VERSION; }\n`,
    'README.md': '![v](https://img.shields.io/github/package-json/v/o/r)\n![b](https://img.shields.io/badge/Version-1.2.3-blue)\n',
  });
  const res = docs.check(root, { only: ['version'] });
  assert.deepEqual(res.findings, [], JSON.stringify(res.findings));
});

// ------------------------------------------------------------- fix-safe
test('--fix-safe rewrites .agent/ -> .agents/ on stale lines and nothing else', () => {
  const root = makeRoot({ 'docs/a.md': 'See .agent/troubleshooting/x.md here.\nHost list: .claude/ .agent/ stays.\n' });
  const ctx = { root };
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let code;
  try { code = docs.run(['check', '--fix-safe', '--only', 'stale'], ctx); } finally { console.log = orig; }
  assert.equal(code, 0, logs.join('\n'));
  assert.equal(fs.readFileSync(path.join(root, 'docs/a.md'), 'utf8'), 'See .agents/troubleshooting/x.md here.\nHost list: .claude/ .agent/ stays.\n');
});

// ------------------------------------------------------------------ CLI
test('cli: `apc docs check --json` shape and exit codes on a fixture root', () => {
  const root = makeRoot({ 'README.md': '[bad](nope.md)\n', 'package.json': '{"name":"x","version":"1.0.0"}', 'scripts/.keep': '' });
  const r = spawnSync(process.execPath, [CLI, 'docs', 'check', '--json', '--only', 'links'], { encoding: 'utf8', env: { ...process.env, APC_ROOT: root } });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema, 'apc-docs-check/1');
  assert.equal(out.summary.errors, 1);
  assert.equal(out.findings[0].rule, 'broken-link');

  fs.writeFileSync(path.join(root, 'README.md'), 'clean\n');
  assert.equal(spawnSync(process.execPath, [CLI, 'docs', 'check', '--only', 'links'], { encoding: 'utf8', env: { ...process.env, APC_ROOT: root } }).status, 0);
  assert.equal(spawnSync(process.execPath, [CLI, 'docs', 'check', '--only', 'bogus'], { encoding: 'utf8', env: { ...process.env, APC_ROOT: root } }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, 'docs', 'frobnicate'], { encoding: 'utf8', env: { ...process.env, APC_ROOT: root } }).status, 2);
});

test('--external lists http(s) links without fetching them', () => {
  const root = makeRoot({ 'README.md': '[a](https://example.com/a) and <https://example.com/b> [c](http://example.org)\n' });
  const res = docs.check(root, { only: ['links'] });
  assert.equal(res.external.length, 2, 'autolinks in angle brackets are not markdown links; inline links are listed');
});

// ----------------------------------------------------------- real repo
test('the real repository docs are clean (links, snippets, stale strings, version SSOT)', () => {
  const res = docs.check(REPO_ROOT, {});
  const errors = res.findings.filter((f) => f.severity === 'error');
  assert.deepEqual(errors.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`), []);
});

// ------------------------------------------------- onboarding scripts
// scripts/lib/juce-shallow-clone.{sh,ps1} against a LOCAL fake JUCE origin
// (file:// URL so --depth 1 is honoured). No network, no real JUCE.
const HAS_GIT = have('git', ['--version']);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function fakeJuceOrigin() {
  const dir = makeRoot({ 'CMakeLists.txt': '# fake juce\n' });
  const header = (v) => `#define JUCE_MAJOR_VERSION ${v[0]}\n#define JUCE_MINOR_VERSION ${v[1]}\n#define JUCE_BUILDNUMBER ${v[2]}\n`;
  git(dir, 'init', '-q');
  const commit = (tag, hv) => {
    fs.mkdirSync(path.join(dir, 'modules', 'juce_core', 'system'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'modules', 'juce_core', 'system', 'juce_StandardHeader.h'), header(hv));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', tag);
    git(dir, 'tag', tag);
  };
  commit('9.0.1', [9, 0, 1]);
  commit('9.0.2', [9, 0, 2]);
  commit('9.0.3', [9, 0, 9]); // lying header: tag says 9.0.3, header says 9.0.9
  const p = dir.split(path.sep).join('/');
  return { dir, url: 'file://' + (p.startsWith('/') ? p : '/' + p) };
}

const SH = path.join(REPO_ROOT, 'scripts', 'lib', 'juce-shallow-clone.sh');
const PS1 = path.join(REPO_ROOT, 'scripts', 'lib', 'juce-shallow-clone.ps1');
const runners = [
  { name: 'bash', ok: HAS_BASH && HAS_GIT, run: (args) => spawnSync('bash', [SH, ...args], { encoding: 'utf8' }) },
  {
    name: 'powershell', ok: HAS_PS && HAS_GIT && process.platform === 'win32',
    run: (args) => {
      const map = { '--tag': '-Tag', '--dest': '-Dest', '--repo': '-Repo', '--force': '-Force', '--quiet': '-Quiet' };
      return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, ...args.map((a) => map[a] || a)], { encoding: 'utf8' });
    },
  },
];

for (const r of runners) {
  test(`juce-shallow-clone (${r.name}): clone, idempotent re-run, mismatch refusal, --force, bad tag, header lie`, { skip: !r.ok && `${r.name}/git unavailable` }, () => {
    const origin = fakeJuceOrigin();
    const dest = path.join(makeRoot({}), 'tools', 'JUCE');

    let out = r.run(['--tag', '9.0.1', '--dest', dest, '--repo', origin.url]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(fs.existsSync(path.join(dest, 'CMakeLists.txt')));
    assert.equal(git(dest, 'describe', '--tags', '--exact-match', 'HEAD'), '9.0.1');
    assert.equal(git(dest, 'rev-list', '--count', 'HEAD'), '1', 'depth 1: a single commit was fetched');

    out = r.run(['--tag', '9.0.1', '--dest', dest, '--repo', 'file:///does/not/exist']);
    assert.equal(out.status, 0, 'idempotent: no network needed when already at the tag');
    assert.match(out.stdout, /already present/);

    out = r.run(['--tag', '9.0.2', '--dest', dest, '--repo', origin.url]);
    assert.equal(out.status, 1, 'a different version is never overwritten silently');
    assert.match(out.stderr, /--force|-Force/i);
    assert.equal(git(dest, 'describe', '--tags', '--exact-match', 'HEAD'), '9.0.1');

    out = r.run(['--tag', '9.0.2', '--dest', dest, '--repo', origin.url, '--force']);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.equal(git(dest, 'describe', '--tags', '--exact-match', 'HEAD'), '9.0.2');

    out = r.run(['--tag', '9.9.9', '--dest', path.join(makeRoot({}), 'x'), '--repo', origin.url]);
    assert.equal(out.status, 1, 'unknown tag fails');

    out = r.run(['--tag', 'not-a-tag', '--dest', path.join(makeRoot({}), 'y'), '--repo', origin.url]);
    assert.equal(out.status, 1, 'malformed tag rejected before any network call');

    out = r.run(['--tag', '9.0.3', '--dest', path.join(makeRoot({}), 'z'), '--repo', origin.url]);
    assert.equal(out.status, 1, 'header/tag disagreement is a verification failure');
    assert.match(out.stderr, /verification failed|reports 9\.0\.9/);
  });
}

test('devcontainer: devcontainer.json parses, points at the Dockerfile, runs apc doctor; Dockerfile installs the JUCE Linux deps', () => {
  const dc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.devcontainer', 'devcontainer.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(REPO_ROOT, '.devcontainer', dc.build.dockerfile)));
  assert.match(dc.postCreateCommand, /node bin\/apc\.js doctor/);
  assert.match(dc.postCreateCommand, /juce-shallow-clone\.sh/);
  const docker = fs.readFileSync(path.join(REPO_ROOT, '.devcontainer', 'Dockerfile'), 'utf8');
  assert.match(docker, /^FROM ubuntu:\d\d\.04/m);
  for (const pkg of ['cmake', 'ninja-build', 'build-essential', 'libasound2-dev', 'libx11-dev', 'libxrandr-dev', 'libxinerama-dev', 'libxcursor-dev', 'libfreetype-dev', 'libfontconfig1-dev', 'libgl1-mesa-dev', 'libwebkit2gtk-4.1-dev', 'libcurl4-openssl-dev', 'xvfb', 'nodejs', 'pluginval']) {
    assert.ok(docker.includes(pkg), `Dockerfile mentions ${pkg}`);
  }
  // every instruction keyword is real and continuations terminate (docker itself is not required)
  const known = new Set(['FROM', 'RUN', 'ARG', 'ENV', 'USER', 'WORKDIR', 'COPY', 'ADD', 'LABEL', 'CMD', 'ENTRYPOINT', 'EXPOSE', 'VOLUME']);
  let cont = false;
  for (const line of docker.split(/\r?\n/)) {
    if (!cont && (line.trim() === '' || line.trim().startsWith('#'))) continue;
    if (!cont) assert.ok(known.has(line.trim().split(/\s+/)[0].toUpperCase()), `instruction: ${line}`);
    cont = /\\\s*$/.test(line);
  }
  assert.equal(cont, false);
});

test('snippets: a json fragment made of object members is accepted', () => {
  const root = makeRoot({ 'docs/a.md': fence('json', '"perf_budget": {\n  "meter_hz": 30\n}') });
  assert.deepEqual(docs.check(root, { only: ['snippets'] }).findings, []);
});

test('juce-shallow-clone: bash twin parses; the example config carries a MAJOR.MINOR.PATCH pin the scripts accept', () => {
  if (HAS_BASH) assert.equal(spawnSync('bash', ['-n', SH], { encoding: 'utf8' }).status, 0);
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apc.config.example.json'), 'utf8'));
  assert.match(cfg.juce.pin, /^\d+\.\d+\.\d+$/);
});

test('juce-shallow-clone (bash): with no --tag the default pin is read from the config', { skip: !(HAS_BASH && HAS_GIT) && 'bash/git unavailable' }, () => {
  // Fake an APC root with its own config so the test does not depend on the machine's apc.config.json.
  const root = makeRoot({ 'apc.config.example.json': JSON.stringify({ juce: { required_major: 9, pin: '9.0.2' } }, null, 2) });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(SH, path.join(root, 'scripts', 'lib', 'juce-shallow-clone.sh'));
  const origin = fakeJuceOrigin();
  const dest = path.join(root, '_tools', 'JUCE');
  const r = spawnSync('bash', [path.join(root, 'scripts', 'lib', 'juce-shallow-clone.sh'), '--repo', origin.url], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(git(dest, 'describe', '--tags', '--exact-match', 'HEAD'), '9.0.2');
});
