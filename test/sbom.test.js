'use strict';
// apc sbom tests (CycloneDX 1.5 + provenance). Zero deps: node:test + node:assert (Node 18+).
// Run: node --test test/sbom.test.js
// git/cmake are replaced by an injected exec, so results do not depend on this machine.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sbom = require('../scripts/apc-sbom.js');

const tmpDirs = [];
function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'apc-sbom-test-'));
  tmpDirs.push(d);
  return d;
}
process.on('exit', () => { for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const JUCE_H = `/*
 BEGIN_JUCE_MODULE_DECLARATION
  ID:                 juce_core
  version:            9.0.1
  license:            AGPLv3/Commercial
 END_JUCE_MODULE_DECLARATION
*/`;
const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n';
const GPL3 = '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n';

const SHAS = { root: 'a'.repeat(40), 'JUCE': '1'.repeat(40), 'clap-juce-extensions': '2'.repeat(40), visage: '3'.repeat(40), pluginval: '4'.repeat(40) };

/** Fake git/cmake keyed by the -C directory. */
function fakeExec(over = {}) {
  const dirty = over.dirty !== undefined ? over.dirty : false;
  const calls = [];
  const fn = (file, args) => {
    calls.push([file, ...args]);
    if (over.noGit && file === 'git') return { status: null, stdout: '', stderr: '', error: 'ENOENT' };
    if (file === 'git' && args[0] === '--version') return { status: 0, stdout: 'git version 2.99.0\n', stderr: '' };
    if (file === 'cmake') return { status: 0, stdout: 'cmake version 3.30.1\nextra\n', stderr: '' };
    if (file === 'git' && args[0] === '-C') {
      const dir = args[1]; const sub = args.slice(2).join(' ');
      const key = ['JUCE', 'clap-juce-extensions', 'visage', 'pluginval'].find((k) => dir.endsWith(path.join('_tools', k))) || 'root';
      if (sub === 'rev-parse HEAD') return { status: 0, stdout: `${SHAS[key]}\n`, stderr: '' };
      if (sub === 'status --porcelain') return { status: 0, stdout: key === 'root' && dirty ? ' M scripts/x.js\n' : '', stderr: '' };
      if (sub === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
      if (sub === 'config --get remote.origin.url') return { status: 0, stdout: key === 'root' ? 'https://ci-user:s3cr3t-token@github.com/acme/apc.git\n' : '\n', stderr: '' };
      if (sub === 'describe --tags --always') return { status: 0, stdout: `${key === 'JUCE' ? '9.0.1' : 'v1.0-3-g' + SHAS[key].slice(0, 7)}\n`, stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unsupported', error: null };
  };
  fn.calls = calls;
  return fn;
}

function repo(opts = {}) {
  const root = mkTmp();
  put(path.join(root, 'package.json'), JSON.stringify({ name: 'apc', version: '9.9.9' }));
  put(path.join(root, '.gitmodules'), [
    '[submodule "_tools/JUCE"]\n\tpath = _tools/JUCE\n\turl = https://github.com/juce-framework/JUCE',
    '[submodule "_tools/clap-juce-extensions"]\n\tpath = _tools/clap-juce-extensions\n\turl = https://github.com/free-audio/clap-juce-extensions',
    '[submodule "_tools/visage"]\n\tpath = _tools/visage\n\turl = https://github.com/VitalAudio/visage',
    '[submodule "_tools/pluginval"]\n\tpath = _tools/pluginval\n\turl = https://github.com/Tracktion/pluginval',
  ].join('\n') + '\n');
  put(path.join(root, '_tools', 'JUCE', 'modules', 'juce_core', 'juce_core.h'), JUCE_H);
  put(path.join(root, '_tools', 'JUCE', 'CMakeLists.txt'), '# juce');
  put(path.join(root, '_tools', 'clap-juce-extensions', 'LICENSE'), MIT);
  put(path.join(root, '_tools', 'visage', 'LICENSE'), MIT);
  put(path.join(root, '_tools', 'pluginval', 'LICENSE'), GPL3);
  const status = opts.status || { plugin_name: 'Demo', version: 'v1.2.0', ui_framework: 'webview', formats: { clap: false } };
  put(path.join(root, 'plugins', 'Demo', 'status.json'), JSON.stringify(status));
  const releaseDir = path.join(root, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  return { root, releaseDir, pluginDir: path.join(root, 'plugins', 'Demo') };
}

function collect(r, over = {}, depOver = {}) {
  return sbom.collect({ root: r.root, plugin: 'Demo', pluginDir: r.pluginDir, releaseDir: r.releaseDir, deterministic: true, ...over },
    { exec: fakeExec(depOver.exec), env: depOver.env || {}, now: () => new Date('2026-01-02T03:04:05.000Z') });
}

const byRef = (bom, ref) => bom.components.find((c) => c['bom-ref'] === ref);
const prop = (c, n) => (c.properties || []).find((p) => p.name === n);

// ─── helpers ───────────────────────────────────────────────────────────────

test('sanitizeUrl strips credentials; githubPurl; detectLicense never guesses', () => {
  assert.equal(sbom.sanitizeUrl('https://user:pw@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(sbom.sanitizeUrl('https://token@github.com/a/b'), 'https://github.com/a/b');
  assert.equal(sbom.sanitizeUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.equal(sbom.githubPurl('https://github.com/Tracktion/pluginval', 'abc'), 'pkg:github/tracktion/pluginval@abc');
  assert.equal(sbom.githubPurl('git@github.com:free-audio/clap-juce-extensions.git'), 'pkg:github/free-audio/clap-juce-extensions');
  assert.equal(sbom.githubPurl('https://gitlab.com/a/b'), null);
  assert.equal(sbom.detectLicense(MIT), 'MIT');
  assert.equal(sbom.detectLicense(GPL3), 'GPL-3.0-only');
  assert.equal(sbom.detectLicense('Copyright Somebody. All rights reserved.'), null);
  assert.equal(sbom.detectLicense(null), null);
});

test('parseGitmodules', () => {
  const m = sbom.parseGitmodules('[submodule "a"]\n\tpath = _tools/a\n\turl = https://x/a\n[submodule "b"]\n\tpath = _tools/b\n\turl = https://x/b\n');
  assert.deepEqual(m, { '_tools/a': 'https://x/a', '_tools/b': 'https://x/b' });
});

test('npm lockfile v3 / v2 / v1 parsing, scoped purls, integrity hashes', () => {
  const v3 = {
    lockfileVersion: 3,
    packages: {
      '': { name: 'ui', dependencies: { a: '1' } },
      'node_modules/a': { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-AAEC', license: 'MIT' },
      'node_modules/@scope/b': { version: '2.1.0', dev: true },
      'node_modules/a/node_modules/c': { version: '0.3.0' },
      'node_modules/link': { link: true, resolved: '../x' },
    },
  };
  const p = sbom.parseNpmLock(v3).sort((x, y) => x.name.localeCompare(y.name));
  assert.deepEqual(p.map((x) => `${x.name}@${x.version}`), ['@scope/b@2.1.0', 'a@1.0.0', 'c@0.3.0']);
  assert.equal(p.find((x) => x.name === '@scope/b').dev, true);

  const v1 = { lockfileVersion: 1, dependencies: { x: { version: '1.0.0', dependencies: { y: { version: '2.0.0', dev: true } } } } };
  assert.deepEqual(sbom.parseNpmLock(v1).map((x) => x.name).sort(), ['x', 'y']);
  assert.deepEqual(sbom.parseNpmLock({}), []);

  assert.equal(sbom.npmPurl('@scope/b', '2.1.0'), 'pkg:npm/%40scope/b@2.1.0');
  assert.equal(sbom.npmPurl('a', '1.0.0'), 'pkg:npm/a@1.0.0');
  assert.deepEqual(sbom.integrityToHash('sha512-AAEC'), { alg: 'SHA-512', content: '000102' });
  assert.equal(sbom.integrityToHash('nonsense'), null);
});

// ─── BOM content ───────────────────────────────────────────────────────────

test('CycloneDX 1.5 document shape and toolchain components', () => {
  const r = repo();
  const { bom } = collect(r);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.equal(bom.version, 1);
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(bom.metadata.component.name, 'Demo');
  assert.equal(bom.metadata.component.version, '1.2.0'); // leading v stripped
  assert.equal(bom.metadata.tools.components[0].version, '9.9.9');
  assert.equal(bom.metadata.timestamp, undefined, '--deterministic omits the timestamp');

  const juce = byRef(bom, 'juce');
  assert.equal(juce.version, '9.0.1');
  assert.equal(prop(juce, 'apc:git-commit').value, SHAS.JUCE);
  assert.equal(juce.purl, `pkg:github/juce-framework/juce@${SHAS.JUCE}`);
  assert.deepEqual(juce.licenses, [{ license: { name: 'AGPLv3/Commercial' } }]);

  const pv = byRef(bom, 'pluginval');
  assert.equal(pv.scope, 'excluded', 'test tool is not shipped');
  assert.deepEqual(pv.licenses, [{ license: { id: 'GPL-3.0-only' } }]);

  assert.equal(byRef(bom, 'clap-juce-extensions'), undefined, 'CLAP wrapper only when the plugin opted in');
  assert.equal(byRef(bom, 'visage'), undefined, 'visage only for ui_framework visage');

  // every dependency ref points at a real component, and excluded tools are not dependencies of the plugin
  const refs = new Set([bom.metadata.component['bom-ref'], ...bom.components.map((c) => c['bom-ref'])]);
  for (const d of bom.dependencies) { assert.ok(refs.has(d.ref)); for (const x of d.dependsOn) assert.ok(refs.has(x)); }
  const root = bom.dependencies.find((d) => d.ref === 'plugin:Demo');
  assert.ok(root.dependsOn.includes('juce'));
  assert.ok(!root.dependsOn.includes('pluginval'));
});

test('clap-juce-extensions and visage are included only when the plugin uses them', () => {
  const r = repo({ status: { version: 'v1', ui_framework: 'visage', formats: { clap: true } } });
  const { bom } = collect(r);
  const clap = byRef(bom, 'clap-juce-extensions');
  assert.ok(clap);
  assert.deepEqual(clap.licenses, [{ license: { id: 'MIT' } }]);
  assert.equal(prop(clap, 'apc:git-commit').value, SHAS['clap-juce-extensions']);
  assert.ok(byRef(bom, 'visage'));
  assert.deepEqual(bom.metadata.component.properties.find((p) => p.name === 'apc:formats').value, 'vst3,clap');
});

test('npm packages from a WebView frontend lockfile become components', () => {
  const r = repo();
  put(path.join(r.pluginDir, 'Source', 'ui', 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-AAEC', license: 'MIT' },
      'node_modules/@types/node': { version: '20.0.0', dev: true },
    },
  }));
  // lockfiles inside node_modules / backups must be ignored
  put(path.join(r.pluginDir, 'node_modules', 'x', 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/ghost': { version: '9.9.9' } } }));
  put(path.join(r.pluginDir, '_state_backups', 'b', 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/ghost2': { version: '9.9.9' } } }));
  const { bom, lockfiles } = collect(r);
  assert.deepEqual(lockfiles, ['Source/ui/package-lock.json']);
  const lp = byRef(bom, 'pkg:npm/left-pad@1.3.0');
  assert.equal(lp.scope, 'required');
  assert.deepEqual(lp.hashes, [{ alg: 'SHA-512', content: '000102' }]);
  assert.deepEqual(lp.licenses, [{ license: { id: 'MIT' } }]);
  assert.equal(byRef(bom, 'pkg:npm/%40types/node@20.0.0').scope, 'optional');
  assert.equal(byRef(bom, 'pkg:npm/ghost@9.9.9'), undefined);
  assert.equal(byRef(bom, 'pkg:npm/ghost2@9.9.9'), undefined);
});

test('deterministic and diffable: identical inputs give identical bytes, sorted components', () => {
  const r = repo({ status: { version: 'v1', ui_framework: 'visage', formats: { clap: true } } });
  put(path.join(r.pluginDir, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/zeta': { version: '1.0.0' }, 'node_modules/alpha': { version: '1.0.0' } } }));
  const a = JSON.stringify(collect(r).bom);
  const b = JSON.stringify(collect(r).bom);
  assert.equal(a, b);
  const refs = collect(r).bom.components.map((c) => c['bom-ref']);
  assert.deepEqual(refs, [...refs].sort((x, y) => x.localeCompare(y)));

  // key order is canonical
  const keys = Object.keys(JSON.parse(a));
  assert.deepEqual(keys, [...keys].sort());

  // timestamp differs, serialNumber (content hash) does not
  const t1 = sbom.collect({ root: r.root, plugin: 'Demo', pluginDir: r.pluginDir, releaseDir: r.releaseDir }, { exec: fakeExec(), env: {}, now: () => new Date('2026-01-01T00:00:00Z') }).bom;
  const t2 = sbom.collect({ root: r.root, plugin: 'Demo', pluginDir: r.pluginDir, releaseDir: r.releaseDir }, { exec: fakeExec(), env: {}, now: () => new Date('2027-05-05T00:00:00Z') }).bom;
  assert.notEqual(t1.metadata.timestamp, t2.metadata.timestamp);
  assert.equal(t1.serialNumber, t2.serialNumber);
  // a real content change changes the serial
  put(path.join(r.pluginDir, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/alpha': { version: '2.0.0' } } }));
  assert.notEqual(collect(r).bom.serialNumber, JSON.parse(a).serialNumber);
});

test('SOURCE_DATE_EPOCH controls the timestamp', () => {
  const r = repo();
  const { bom } = sbom.collect({ root: r.root, plugin: 'Demo', pluginDir: r.pluginDir, releaseDir: r.releaseDir },
    { exec: fakeExec(), env: { SOURCE_DATE_EPOCH: '1700000000' }, now: () => new Date('2030-01-01T00:00:00Z') });
  assert.equal(bom.metadata.timestamp, '2023-11-14T22:13:20.000Z');
});

// ─── provenance ────────────────────────────────────────────────────────────

test('provenance: git sha, dirty flag, tool versions, artifact digests, credentials stripped', () => {
  const r = repo();
  const installer = Buffer.from('installer-bytes');
  put(path.join(r.releaseDir, 'Demo-1.2.0-Windows-Setup.exe'), installer);
  put(path.join(r.releaseDir, 'Demo-1.2.0-Windows-Setup.exe.sig'), 'sig');
  put(path.join(r.releaseDir, 'Demo-1.2.0', 'Demo.vst3.zip'), 'zipbytes');
  put(path.join(r.releaseDir, 'OtherPlugin-1.0.zip'), 'nope');
  put(path.join(r.releaseDir, 'Demo-sbom.cdx.json'), '{}');
  put(path.join(r.releaseDir, 'Demo-provenance.json'), '{}');

  const { provenance: p } = collect(r, { skipNames: ['Demo-sbom.cdx.json', 'Demo-provenance.json'] }, { exec: { dirty: true }, env: { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'release', GITHUB_RUN_ID: '42', GITHUB_REPOSITORY: 'acme/apc', GITHUB_SERVER_URL: 'https://github.com' } });
  assert.equal(p._type, 'https://in-toto.io/Statement/v1');
  assert.equal(p.predicateType, 'https://slsa.dev/provenance/v1');

  const names = p.subject.map((s) => s.name);
  assert.deepEqual(names, ['Demo-1.2.0-Windows-Setup.exe', 'Demo-1.2.0-Windows-Setup.exe.sig', 'Demo-1.2.0/Demo.vst3.zip']); // sorted, plugin-only, no own outputs
  assert.equal(p.subject[0].digest.sha256, crypto.createHash('sha256').update(installer).digest('hex'));

  const bd = p.predicate.buildDefinition;
  assert.equal(bd.internalParameters.git_dirty, true);
  assert.equal(bd.internalParameters.tool_versions.git, 'git version 2.99.0');
  assert.equal(bd.internalParameters.tool_versions.cmake, 'cmake version 3.30.1');
  assert.equal(bd.internalParameters.tool_versions.juce, '9.0.1');
  assert.equal(bd.internalParameters.tool_versions.apc, '9.9.9');
  assert.ok(bd.internalParameters.os && bd.internalParameters.arch);
  const src = bd.resolvedDependencies.find((d) => d.name === 'source');
  assert.equal(src.digest.gitCommit, SHAS.root);
  assert.equal(src.uri, 'git+https://github.com/acme/apc.git');
  assert.ok(bd.resolvedDependencies.some((d) => d.name === 'JUCE' && d.digest.gitCommit === SHAS.JUCE));
  assert.equal(p.predicate.runDetails.builder.id, 'https://github.com/actions/runner#release');
  assert.equal(p.predicate.runDetails.metadata.invocationId, 'https://github.com/acme/apc/actions/runs/42');
  assert.equal(p.predicate.apc.unsigned, true);
  assert.equal(JSON.stringify(p).includes('s3cr3t-token'), false, 'remote credentials must never be written');
});

test('provenance: clean tree, local builder, no git available', () => {
  const r = repo();
  let p = collect(r, {}, { exec: { dirty: false } }).provenance;
  assert.equal(p.predicate.buildDefinition.internalParameters.git_dirty, false);
  assert.equal(p.predicate.runDetails.builder.id, 'urn:apc:builder:local');

  const noGit = collect(r, {}, { exec: { noGit: true } });
  p = noGit.provenance;
  assert.equal(noGit.gitAvailable, false);
  assert.equal(p.predicate.buildDefinition.internalParameters.git_dirty, null);
  assert.ok(!p.predicate.buildDefinition.resolvedDependencies.some((d) => d.name === 'source'));
  assert.equal(prop(byRef(noGit.bom, 'juce'), 'apc:git-commit'), undefined);
  assert.equal(byRef(noGit.bom, 'juce').version, '9.0.1', 'version still comes from the module declaration');

  const off = collect(r, { noGit: true });
  assert.equal(off.gitAvailable, false);
});

// ─── CLI ───────────────────────────────────────────────────────────────────

function ctxFor(r, deps) {
  return {
    root: r.root,
    pluginPath: (n) => path.join(r.root, 'plugins', n),
    resolvePaths: () => ({ releaseDir: r.releaseDir }),
    deps: { exec: fakeExec(), env: {}, ...deps },
  };
}
function capture(args, ctx) {
  const out = []; const err = [];
  const ol = console.log; const oe = console.error; const ow = process.stdout.write;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  let code;
  try { code = sbom.run(args, ctx); } finally { console.log = ol; console.error = oe; process.stdout.write = ow; }
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('CLI: writes <Plugin>-sbom.cdx.json and <Plugin>-provenance.json into the release dir', () => {
  const r = repo();
  put(path.join(r.releaseDir, 'Demo-1.2.0-Setup.exe'), 'abc');
  const c = capture(['Demo', '--deterministic'], ctxFor(r));
  assert.equal(c.code, 0, c.err);
  const bomFile = path.join(r.releaseDir, 'Demo-sbom.cdx.json');
  const provFile = path.join(r.releaseDir, 'Demo-provenance.json');
  const bom = JSON.parse(fs.readFileSync(bomFile, 'utf8'));
  const prov = JSON.parse(fs.readFileSync(provFile, 'utf8'));
  assert.equal(bom.specVersion, '1.5');
  assert.deepEqual(prov.subject.map((s) => s.name), ['Demo-1.2.0-Setup.exe']);
  assert.match(c.out, /unsigned, self-generated/);

  // second run does not hash its own outputs and is byte-stable
  const before = fs.readFileSync(bomFile, 'utf8');
  assert.equal(capture(['Demo', '--deterministic'], ctxFor(r)).code, 0);
  assert.equal(fs.readFileSync(bomFile, 'utf8'), before);
  assert.deepEqual(JSON.parse(fs.readFileSync(provFile, 'utf8')).subject.map((s) => s.name), ['Demo-1.2.0-Setup.exe']);
});

test('CLI: --out names the provenance file beside it; --json prints the BOM', () => {
  const r = repo();
  const out = path.join(mkTmp(), 'sub', 'my.cdx.json');
  let c = capture(['Demo', '--out', out, '--json', '--deterministic'], ctxFor(r));
  assert.equal(c.code, 0);
  assert.ok(fs.existsSync(out));
  assert.ok(fs.existsSync(out.replace(/\.json$/, '') + '.provenance.json'));
  assert.equal(JSON.parse(c.out).bomFormat, 'CycloneDX');

  c = capture(['Demo', '--out', '-', '--json', '--deterministic'], ctxFor(r));
  assert.equal(JSON.parse(c.out).metadata.component.name, 'Demo');
});

test('CLI: usage errors', () => {
  const r = repo();
  assert.equal(capture([], ctxFor(r)).code, 2);
  assert.equal(capture(['Demo', '--bogus'], ctxFor(r)).code, 2);
  assert.equal(capture(['Nope'], ctxFor(r)).code, 2);
  assert.equal(capture(['../evil'], ctxFor(r)).code, 2);
  assert.equal(capture(['--help'], ctxFor(r)).code, 0);
});
