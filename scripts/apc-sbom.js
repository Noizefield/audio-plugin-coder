'use strict';

/**
 * apc-sbom - CycloneDX 1.5 SBOM + SLSA-style provenance record for a plugin.
 *
 *   node bin/apc.js sbom <Plugin> [--out F] [--json] [--release-dir D]
 *                         [--deterministic] [--no-git] [--no-artifacts]
 *
 * Writes two files (default next to each other in paths.release_dir):
 *   <Plugin>-sbom.cdx.json         CycloneDX 1.5 JSON
 *   <Plugin>-provenance.json       in-toto Statement v1 with a SLSA provenance v1 predicate
 *
 * Components: JUCE (version from the module declaration, commit from git),
 * clap-juce-extensions (only if status.json formats.clap is true), visage (only for
 * ui_framework visage), pluginval (when present; scope "excluded" = test tool, not shipped),
 * and every package in a WebView frontend's package-lock.json (lockfile v1/v2/v3).
 *
 * Output is deterministic and diffable: components/dependencies are sorted by bom-ref,
 * object keys are emitted in a fixed order, serialNumber is a UUID derived from the content
 * hash (timestamp excluded). The timestamp honours SOURCE_DATE_EPOCH, and --deterministic
 * omits it entirely.
 *
 * The provenance record is SELF-GENERATED and UNSIGNED. It documents what this machine
 * produced; it is not a SLSA-certified attestation. Sign it (see
 * .agents/guides/signing-and-provenance.md) before treating it as evidence.
 *
 * Zero dependencies, Node 18+. Exports run(args, ctx) plus the pure helpers used by
 * test/sbom.test.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const BOM_SPEC = '1.5';
const PROVENANCE_BUILD_TYPE = 'https://github.com/Noizefield/audio-plugin-coder/blob/main/.agents/guides/signing-and-provenance.md#build-v1';

// ─── helpers ───────────────────────────────────────────────────────────────

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
function readTextSafe(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }

function defaultExec(file, args, opts = {}) {
  const r = cp.spawnSync(file, args, { encoding: 'utf8', timeout: opts.timeout || 30000, cwd: opts.cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? String(r.error.message || r.error) : null };
}

/** Recursively sort object keys so JSON.stringify output is stable. Arrays keep their order. */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** UUID-formatted value derived from a sha256 (not a random v4; stable per content). */
function uuidFromHash(hex) {
  const h = hex.slice(0, 32).split('');
  h[12] = '5'; // version nibble: name-based
  h[16] = ['8', '9', 'a', 'b'][parseInt(h[16], 16) % 4]; // RFC 4122 variant
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Remove any user:password@ from a git remote URL before it lands in a published file. */
function sanitizeUrl(u) {
  return String(u || '').replace(/^(https?:\/\/)[^/@\s]+@/i, '$1').replace(/^(ssh:\/\/)[^/@\s]+:[^/@\s]+@/i, '$1');
}

function purlEscape(s) { return encodeURIComponent(s).replace(/%2F/g, '/').replace(/%40/g, '%40'); }

/** pkg:github/<owner>/<repo>[@version] from a git URL, or null for non-GitHub remotes. */
function githubPurl(url, version) {
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(String(url || ''));
  if (!m) return null;
  return `pkg:github/${m[1].toLowerCase()}/${m[2].toLowerCase()}${version ? `@${version}` : ''}`;
}

/** SPDX-ish id from a LICENSE file header; null when not recognised (never guessed). */
function detectLicense(text) {
  if (!text) return null;
  const t = text.slice(0, 2000);
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0-only';
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2\.1/i.test(t) ? 'LGPL-2.1-only' : 'LGPL-3.0-only';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2/i.test(t) ? 'GPL-2.0-only' : 'GPL-3.0-only';
  if (/Apache License/i.test(t) && /Version 2\.0/i.test(t)) return 'Apache-2.0';
  if (/Mozilla Public License/i.test(t)) return 'MPL-2.0';
  if (/\bMIT License\b/i.test(t) || /Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return null;
}

// ─── git ───────────────────────────────────────────────────────────────────

function git(exec, dir, args) {
  const r = exec('git', ['-C', dir, ...args], { timeout: 20000 });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

function gitInfo(exec, dir) {
  const sha = git(exec, dir, ['rev-parse', 'HEAD']);
  if (!sha) return null;
  const porcelain = git(exec, dir, ['status', '--porcelain']);
  return {
    sha,
    dirty: porcelain == null ? null : porcelain.length > 0,
    branch: git(exec, dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
    remote: sanitizeUrl(git(exec, dir, ['config', '--get', 'remote.origin.url'])),
    describe: git(exec, dir, ['describe', '--tags', '--always']),
  };
}

/** Parse .gitmodules into { 'path': 'url' }. */
function parseGitmodules(text) {
  const out = {}; let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const mp = /^\s*path\s*=\s*(.+?)\s*$/.exec(line);
    const mu = /^\s*url\s*=\s*(.+?)\s*$/.exec(line);
    if (/^\s*\[submodule/.test(line)) cur = {};
    else if (mp && cur) { cur.path = mp[1]; }
    else if (mu && cur) { cur.url = mu[1]; }
    if (cur && cur.path && cur.url) { out[cur.path] = cur.url; }
  }
  return out;
}

// ─── JUCE & friends ────────────────────────────────────────────────────────

function readJuceModuleDecl(root) {
  const text = readTextSafe(path.join(root, '_tools', 'JUCE', 'modules', 'juce_core', 'juce_core.h'));
  if (!text) return null;
  const v = /^\s*version:\s*([0-9][^\s]*)/m.exec(text);
  const l = /^\s*license:\s*(.+?)\s*$/m.exec(text);
  return { version: v ? v[1] : null, license: l ? l[1] : null };
}

/** SPDX id, SPDX expression, or free-text name - whichever the input actually is. */
function licenseEntry(text) {
  if (!text) return undefined;
  const t = String(text).trim();
  if (/^(MIT|ISC|0BSD|Unlicense|[A-Za-z0-9.+]+-[0-9][A-Za-z0-9.+-]*)$/.test(t)) return [{ license: { id: t } }];
  if (/^\(?[A-Za-z0-9.+-]+( (OR|AND|WITH) [A-Za-z0-9.+-]+)+\)?$/.test(t)) return [{ expression: t.replace(/^\(|\)$/g, '') }];
  return [{ license: { name: t } }];
}

function submoduleComponent({ ref, name, url, version, commit, scope, description, license, extraProps }) {
  const props = [];
  if (commit) props.push({ name: 'apc:git-commit', value: commit });
  if (url) props.push({ name: 'apc:source-url', value: sanitizeUrl(url) });
  for (const p of (extraProps || [])) props.push(p);
  const purl = githubPurl(url, commit || version);
  return {
    type: 'library', 'bom-ref': ref, name, version: version || commit || 'unknown',
    ...(description ? { description } : {}),
    ...(scope ? { scope } : {}),
    ...(purl ? { purl } : {}),
    ...(license ? { licenses: licenseEntry(license) } : {}),
    ...(props.length ? { properties: props.sort((a, b) => a.name.localeCompare(b.name)) } : {}),
    ...(url ? { externalReferences: [{ type: 'vcs', url: sanitizeUrl(url) }] } : {}),
  };
}

function buildToolchainComponents({ root, status, exec, useGit }) {
  const comps = [];
  const mods = parseGitmodules(readTextSafe(path.join(root, '.gitmodules')));
  const info = (rel) => {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) return null;
    const g = useGit ? gitInfo(exec, dir) : null;
    return { dir, git: g, url: mods[rel.split(path.sep).join('/')] || (g && g.remote) || null,
      license: detectLicense(readTextSafe(path.join(dir, 'LICENSE')) || readTextSafe(path.join(dir, 'LICENSE.md')) || readTextSafe(path.join(dir, 'LICENSE.txt'))) };
  };

  const juce = info(path.join('_tools', 'JUCE'));
  const decl = readJuceModuleDecl(root);
  if (juce) {
    comps.push(submoduleComponent({
      ref: 'juce', name: 'JUCE', version: decl && decl.version, commit: juce.git && juce.git.sha, url: juce.url,
      description: 'JUCE application framework (plugin client, DSP, GUI)', license: decl && decl.license,
      extraProps: juce.git && juce.git.describe ? [{ name: 'apc:git-describe', value: juce.git.describe }] : [],
    }));
  }

  if (status && status.formats && status.formats.clap === true) {
    const c = info(path.join('_tools', 'clap-juce-extensions'));
    if (c) comps.push(submoduleComponent({ ref: 'clap-juce-extensions', name: 'clap-juce-extensions', version: c.git && c.git.describe, commit: c.git && c.git.sha, url: c.url, description: 'CLAP wrapper for JUCE plugins', license: c.license }));
  }
  if (status && String(status.ui_framework).toLowerCase() === 'visage') {
    const v = info(path.join('_tools', 'visage'));
    if (v) comps.push(submoduleComponent({ ref: 'visage', name: 'visage', version: v.git && v.git.describe, commit: v.git && v.git.sha, url: v.url, description: 'Visage UI framework', license: v.license }));
  }
  const pv = info(path.join('_tools', 'pluginval'));
  if (pv) comps.push(submoduleComponent({ ref: 'pluginval', name: 'pluginval', version: pv.git && pv.git.describe, commit: pv.git && pv.git.sha, url: pv.url, scope: 'excluded', description: 'Plugin validator - test tool, not shipped in the plugin binary', license: pv.license }));
  return comps;
}

// ─── npm lockfile ──────────────────────────────────────────────────────────

const LOCK_SKIP_DIRS = new Set(['node_modules', '_state_backups', '.git', 'build', 'dist', 'release']);

/** package-lock.json files anywhere under the plugin folder (depth <= 5), sorted. */
function findLockfiles(pluginDir) {
  const found = [];
  const walk = (dir, depth) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isFile() && e.name === 'package-lock.json') found.push(path.join(dir, e.name));
      else if (e.isDirectory() && depth < 5 && !LOCK_SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(pluginDir, 0);
  return found.sort();
}

function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const [scope, rest] = name.slice(1).split('/');
    return `pkg:npm/%40${encodeURIComponent(scope)}/${encodeURIComponent(rest)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

/** sha512-<base64> | sha1-<base64> -> CycloneDX hash entry. */
function integrityToHash(integrity) {
  const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(String(integrity || ''));
  if (!m) return null;
  const alg = { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]];
  try { return { alg, content: Buffer.from(m[2], 'base64').toString('hex') }; } catch { return null; }
}

/** Flatten lockfile v1/v2/v3 into [{name, version, resolved, integrity, license, dev}]. */
function parseNpmLock(lock) {
  const out = new Map();
  const add = (name, e) => {
    if (!name || !e || !e.version) return;
    const key = `${name}@${e.version}`;
    if (!out.has(key)) out.set(key, { name, version: e.version, resolved: e.resolved, integrity: e.integrity, license: e.license, dev: !!(e.dev || e.devOptional) });
    else if (!(e.dev || e.devOptional)) out.get(key).dev = false;
  };
  if (lock && lock.packages && typeof lock.packages === 'object') {
    for (const [k, e] of Object.entries(lock.packages)) {
      if (k === '' || e.link) continue;
      const idx = k.lastIndexOf('node_modules/');
      if (idx === -1) continue;
      add(k.slice(idx + 'node_modules/'.length), e);
    }
  } else if (lock && lock.dependencies) {
    const walk = (deps) => {
      for (const [name, e] of Object.entries(deps || {})) { add(name, e); if (e.dependencies) walk(e.dependencies); }
    };
    walk(lock.dependencies);
  }
  return [...out.values()];
}

function npmComponents(pluginDir) {
  const comps = []; const locks = findLockfiles(pluginDir);
  for (const lf of locks) {
    const lock = readJsonSafe(lf);
    if (!lock) continue;
    for (const p of parseNpmLock(lock)) {
      const h = integrityToHash(p.integrity);
      comps.push({
        type: 'library', 'bom-ref': npmPurl(p.name, p.version), name: p.name, version: p.version,
        scope: p.dev ? 'optional' : 'required', purl: npmPurl(p.name, p.version),
        ...(h ? { hashes: [h] } : {}),
        ...(p.license ? { licenses: licenseEntry(typeof p.license === 'string' ? p.license : null) } : {}),
        ...(p.resolved ? { externalReferences: [{ type: 'distribution', url: sanitizeUrl(p.resolved) }] } : {}),
        properties: [{ name: 'apc:lockfile', value: path.relative(pluginDir, lf).split(path.sep).join('/') }, { name: 'apc:dev-dependency', value: String(!!p.dev) }],
      });
    }
  }
  return { components: comps, lockfiles: locks.map((l) => path.relative(pluginDir, l).split(path.sep).join('/')) };
}

// ─── artifacts ─────────────────────────────────────────────────────────────

/** Files in the release dir belonging to this plugin (name prefix, or inside a folder with that prefix). */
function listReleaseArtifacts(releaseDir, plugin, skipNames = []) {
  const out = [];
  if (!releaseDir || !fs.existsSync(releaseDir)) return out;
  const prefix = plugin.toLowerCase();
  const walk = (dir, depth, inside) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      const match = inside || e.name.toLowerCase().startsWith(prefix);
      if (e.isDirectory()) { if (depth < 3) walk(full, depth + 1, match); }
      else if (e.isFile() && match && !skipNames.includes(e.name)) out.push(full);
    }
  };
  walk(releaseDir, 0, false);
  return out
    .map((f) => path.relative(releaseDir, f).split(path.sep).join('/'))
    .sort()
    .map((rel) => ({ name: rel, sha256: sha256File(path.join(releaseDir, rel)), bytes: fs.statSync(path.join(releaseDir, rel)).size }));
}

// ─── BOM & provenance ──────────────────────────────────────────────────────

function pluginVersion(status) {
  if (!status) return '0.0.0';
  const v = status.version || (status.current_generation && status.current_generation.version);
  return String(v || '0.0.0').replace(/^v/i, '');
}

/**
 * Build the CycloneDX document. `inputs`: { plugin, status, apcVersion, components[], timestamp|null,
 * pluginGit, toolVersions }
 */
function buildBom(inputs) {
  const { plugin, status, apcVersion } = inputs;
  const pluginRef = `plugin:${plugin}`;
  const metaProps = [
    { name: 'apc:ui-framework', value: String((status && status.ui_framework) || 'unknown') },
    { name: 'apc:formats', value: ['vst3', ...(status && status.formats && status.formats.clap ? ['clap'] : [])].join(',') },
  ];
  if (inputs.pluginGit) {
    metaProps.push({ name: 'apc:git-commit', value: inputs.pluginGit.sha });
    if (inputs.pluginGit.dirty != null) metaProps.push({ name: 'apc:git-dirty', value: String(inputs.pluginGit.dirty) });
  }
  const components = [...inputs.components].sort((a, b) => String(a['bom-ref']).localeCompare(String(b['bom-ref'])));
  const seen = new Set();
  const unique = components.filter((c) => (seen.has(c['bom-ref']) ? false : (seen.add(c['bom-ref']), true)));

  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: BOM_SPEC,
    version: 1,
    metadata: {
      ...(inputs.timestamp ? { timestamp: inputs.timestamp } : {}),
      tools: { components: [{ type: 'application', name: 'apc sbom', version: apcVersion || 'unknown', group: 'audio-plugin-coder' }] },
      component: {
        type: 'application', 'bom-ref': pluginRef, name: plugin, version: pluginVersion(status),
        properties: metaProps.sort((a, b) => a.name.localeCompare(b.name)),
      },
    },
    components: unique,
    dependencies: [
      { ref: pluginRef, dependsOn: unique.filter((c) => c.scope !== 'excluded').map((c) => c['bom-ref']) },
      ...unique.map((c) => ({ ref: c['bom-ref'], dependsOn: [] })),
    ],
  };
  const sorted = sortKeys(bom);
  // serialNumber from the content (without timestamp) so identical inputs give identical BOMs.
  const basis = JSON.stringify({ ...sorted, metadata: { ...sorted.metadata, timestamp: undefined } });
  sorted.serialNumber = `urn:uuid:${uuidFromHash(crypto.createHash('sha256').update(basis).digest('hex'))}`;
  return sortKeys(sorted);
}

/** in-toto Statement v1 + SLSA provenance v1 predicate (self-generated, unsigned). */
function buildProvenance(inputs) {
  const { plugin, artifacts, timestamp, git: g, toolVersions, builderId, env } = inputs;
  const subject = artifacts.map((a) => ({ name: a.name, digest: { sha256: a.sha256 } }));
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: PROVENANCE_BUILD_TYPE,
        externalParameters: { plugin, plugin_version: inputs.pluginVersion, ui_framework: inputs.uiFramework, formats: inputs.formats },
        internalParameters: {
          git_dirty: g ? g.dirty : null,
          git_branch: g ? g.branch : null,
          os: env.os, arch: env.arch,
          tool_versions: toolVersions,
        },
        resolvedDependencies: [
          ...(g ? [{ uri: `git+${g.remote || 'local'}`, digest: { gitCommit: g.sha }, name: 'source' }] : []),
          ...inputs.dependencies,
        ],
      },
      runDetails: {
        builder: { id: builderId, version: { apc: toolVersions.apc || 'unknown', node: toolVersions.node } },
        metadata: { ...(timestamp ? { finishedOn: timestamp } : {}), invocationId: env.invocationId || undefined },
        byproducts: [{ name: 'sbom', annotations: { format: 'CycloneDX', specVersion: BOM_SPEC } }],
      },
      apc: {
        generated_by: 'apc sbom',
        unsigned: true,
        note: 'Self-generated record; not a SLSA-certified attestation. Sign it before treating it as evidence.',
        artifact_count: artifacts.length,
      },
    },
  };
  return sortKeys(statement);
}

function toolVersion(exec, cmd, args) {
  const r = exec(cmd, args, { timeout: 15000 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout.split(/\r?\n/)[0] || '').trim() || null;
}

function collect(opts, deps) {
  const { root, plugin, pluginDir, releaseDir } = opts;
  const exec = deps.exec; const env = deps.env;
  const status = readJsonSafe(path.join(pluginDir, 'status.json'));
  const pkg = readJsonSafe(path.join(root, 'package.json'));
  const useGit = !opts.noGit;

  const toolchain = buildToolchainComponents({ root, status, exec, useGit });
  const npm = npmComponents(pluginDir);
  const pluginGit = useGit ? gitInfo(exec, root) : null;

  const skip = opts.skipNames || [];
  const artifacts = opts.noArtifacts ? [] : listReleaseArtifacts(releaseDir, plugin, skip);

  let ts = null;
  if (!opts.deterministic) {
    if (env.SOURCE_DATE_EPOCH && /^\d+$/.test(env.SOURCE_DATE_EPOCH)) ts = new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString();
    else ts = (deps.now ? deps.now() : new Date()).toISOString();
  }

  const gitVersion = useGit ? (toolVersion(exec, 'git', ['--version']) || null) : null;
  const cmakeVersion = toolVersion(exec, 'cmake', ['--version']);
  const toolVersions = {
    apc: pkg && pkg.version, node: process.version,
    ...(gitVersion ? { git: gitVersion } : {}),
    ...(cmakeVersion ? { cmake: cmakeVersion } : {}),
    ...(toolchain.find((c) => c['bom-ref'] === 'juce') ? { juce: toolchain.find((c) => c['bom-ref'] === 'juce').version } : {}),
  };

  const bom = buildBom({ plugin, status, apcVersion: pkg && pkg.version, components: [...toolchain, ...npm.components], timestamp: ts, pluginGit });
  const ci = env.GITHUB_ACTIONS === 'true';
  const prov = buildProvenance({
    plugin, artifacts, timestamp: ts, git: pluginGit, toolVersions,
    pluginVersion: pluginVersion(status), uiFramework: status && status.ui_framework, formats: ['vst3', ...(status && status.formats && status.formats.clap ? ['clap'] : [])],
    builderId: ci ? `https://github.com/actions/runner#${env.GITHUB_WORKFLOW || 'workflow'}` : 'urn:apc:builder:local',
    env: { os: `${os.platform()} ${os.release()}`, arch: os.arch(), invocationId: ci && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null },
    dependencies: toolchain.filter((c) => c.properties && c.properties.some((p) => p.name === 'apc:git-commit')).map((c) => ({
      name: c.name, uri: (c.externalReferences && c.externalReferences[0] && c.externalReferences[0].url) || c.name,
      digest: { gitCommit: c.properties.find((p) => p.name === 'apc:git-commit').value },
    })).sort((a, b) => a.name.localeCompare(b.name)),
  });
  return { bom, provenance: prov, artifacts, lockfiles: npm.lockfiles, gitAvailable: !!pluginGit };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

const USAGE = [
  'Usage: apc sbom <Plugin> [--out F] [--json] [--release-dir D] [--deterministic] [--no-git] [--no-artifacts]',
  '  --out F           SBOM path (default <release_dir>/<Plugin>-sbom.cdx.json); provenance goes to <Plugin>-provenance.json beside it',
  '  --json            print the SBOM to stdout instead of a summary (files are still written unless --out - is given)',
  '  --release-dir D   directory whose <Plugin>* files are hashed into the provenance subjects',
  '  --deterministic   omit timestamps (byte-identical output for identical inputs)',
  '  --no-git          do not call git (no commits / dirty flag)',
  '  --no-artifacts    skip hashing release artifacts',
  'Honours SOURCE_DATE_EPOCH for the timestamp.',
].join('\n');

function parseArgs(args) {
  const o = { plugin: null, out: null, json: false, releaseDir: null, deterministic: false, noGit: false, noArtifacts: false, help: false, errors: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const val = () => { if (i + 1 >= args.length) { o.errors.push(`${a} needs a value`); return null; } return args[++i]; };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--json') o.json = true;
    else if (a === '--deterministic') o.deterministic = true;
    else if (a === '--no-git') o.noGit = true;
    else if (a === '--no-artifacts') o.noArtifacts = true;
    else if (a === '--out') o.out = val();
    else if (a === '--release-dir') o.releaseDir = val();
    else if (a.startsWith('--')) o.errors.push(`unknown option ${a}`);
    else if (!o.plugin) o.plugin = a;
    else o.errors.push(`unexpected argument ${a}`);
  }
  return o;
}

function run(args, ctx) {
  const o = parseArgs(args || []);
  if (o.help) { console.log(USAGE); return 0; }
  if (!o.plugin) { console.error('apc sbom: missing <Plugin>\n' + USAGE); return 2; }
  if (o.errors.length) { console.error('apc sbom: ' + o.errors.join('; ') + '\n' + USAGE); return 2; }
  if (!/^[A-Za-z0-9_.-]+$/.test(o.plugin)) { console.error('apc sbom: invalid plugin name'); return 2; }

  const deps = { exec: defaultExec, env: process.env, ...(ctx && ctx.deps) };
  const root = ctx.root;
  const pluginDir = ctx.pluginPath(o.plugin);
  if (!fs.existsSync(pluginDir)) { console.error(`apc sbom: plugin folder not found: ${pluginDir}`); return 2; }

  const releaseDir = path.resolve(o.releaseDir || ctx.resolvePaths().releaseDir);
  const bomPath = path.resolve(o.out || path.join(releaseDir, `${o.plugin}-sbom.cdx.json`));
  const provenancePath = /-sbom\.cdx\.json$/i.test(bomPath)
    ? bomPath.replace(/-sbom\.cdx\.json$/i, '-provenance.json')
    : bomPath.replace(/\.json$/i, '') + '.provenance.json';

  const result = collect({
    root, plugin: o.plugin, pluginDir, releaseDir, deterministic: o.deterministic, noGit: o.noGit, noArtifacts: o.noArtifacts,
    skipNames: [path.basename(bomPath), path.basename(provenancePath)],
  }, deps);

  const bomText = JSON.stringify(result.bom, null, 2) + '\n';
  const provText = JSON.stringify(result.provenance, null, 2) + '\n';

  if (o.out !== '-') {
    fs.mkdirSync(path.dirname(bomPath), { recursive: true });
    fs.writeFileSync(bomPath, bomText, 'utf8');
    fs.writeFileSync(provenancePath, provText, 'utf8');
  }
  if (o.json) { process.stdout.write(bomText); return 0; }

  console.log(`apc sbom: ${o.plugin}`);
  console.log(`  components : ${result.bom.components.length} (${result.lockfiles.length} npm lockfile(s))`);
  console.log(`  artifacts  : ${result.artifacts.length} hashed from ${releaseDir}`);
  if (!result.gitAvailable && !o.noGit) console.log('  note       : git unavailable or not a repository - commits and dirty flag omitted');
  if (!result.artifacts.length && !o.noArtifacts) console.log('  note       : no release artifacts found, provenance has no subjects (run /apc-ship first)');
  if (o.out !== '-') { console.log(`  sbom       : ${bomPath}`); console.log(`  provenance : ${provenancePath}  (unsigned, self-generated)`); }
  return 0;
}

module.exports = {
  run, collect, buildBom, buildProvenance, parseArgs, parseNpmLock, npmComponents, integrityToHash, npmPurl,
  listReleaseArtifacts, sanitizeUrl, githubPurl, detectLicense, parseGitmodules, gitInfo, sortKeys, uuidFromHash,
  readJuceModuleDecl, sha256File, BOM_SPEC,
};
