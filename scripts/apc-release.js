'use strict';

/**
 * apc-release - release-side tooling for the APC updater (apc-updater module).
 *
 *   release keygen   --out <dir>
 *   release manifest --plugin <Name> [--base-url U] [--notes file] [--key pem]
 *                    [--version V] [--min-supported V] [--published-at ISO]
 *                    [--dir D] [--out file]
 *   release sign     <manifest> --key <pem> [--out file]
 *   release verify   <manifest> --pubkey <pem|b64|file> [--current V] [--artifacts-dir D]
 *
 * Every subcommand accepts --json (machine-readable result on stdout).
 * Exit codes: 0 ok, 1 failure (verification failed, refused to overwrite, nothing found ...),
 *             2 usage error.
 *
 * Trust model (.agents/guides/updater.md): the manifest is signed with a dedicated
 * Ed25519 UPDATE key that is separate from the license key; the plugin embeds only the
 * public key. Authenticode / notarization of the installer are OS-level and additional.
 *
 * CANONICAL JSON ("apc-canon/1") - MUST stay byte-identical with common/apc/ApcCanonicalJson.h:
 *   - object members sorted by the key's UTF-8 BYTES (code point order, NOT UTF-16 order)
 *   - no whitespace; strings escape only " \ and U+0000..U+001F (\b \f \n \r \t short, others
 *     \u00xx lowercase hex); everything else raw UTF-8
 *   - numbers: integers only, |n| <= 2^53-1, no -0; floats / exponents are REJECTED
 *   - signed bytes = canonical JSON of the document WITHOUT its "signature" member
 * Shared golden vectors: test/fixtures/release/canonical-vectors.json
 *
 * Zero dependencies, Node 18+.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'apc-update/1.0';
const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KEY_FILES = {
  private: 'apc-update-private.pem',
  public: 'apc-update-public.pem',
  b64: 'apc-update-public.b64',
  inc: 'apc-update-public-key.inc',
};
const PLATFORM_RE = /^(windows|macos|linux)-(x64|arm64|universal)$/;
const INSTALLER_EXT = new Set(['.exe', '.msi', '.pkg', '.dmg', '.deb', '.rpm', '.appimage']);
const ARCHIVE_EXT = new Set(['.zip', '.gz', '.tgz']);

class UsageError extends Error {}
class Fail extends Error {}

// --------------------------------------------------------------------------
// Strict JSON parser (mirrors the C++ parser: no dupes, no floats, no BOM, ...)
// --------------------------------------------------------------------------

function parseStrict(text, opts) {
  const o = Object.assign({ maxDepth: 64 }, opts);
  let pos = 0;
  const fail = (m) => { throw new Fail(`${m} at byte/char ${pos}`); };
  const ws = () => { while (pos < text.length && ' \t\n\r'.includes(text[pos])) pos++; };

  function value(depth) {
    if (depth > o.maxDepth) fail('nesting too deep');
    if (pos >= text.length) fail('unexpected end of input');
    const c = text[pos];
    if (c === '{') return object(depth);
    if (c === '[') return array(depth);
    if (c === '"') return string();
    if (text.startsWith('true', pos)) { pos += 4; return true; }
    if (text.startsWith('false', pos)) { pos += 5; return false; }
    if (text.startsWith('null', pos)) { pos += 4; return null; }
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    return fail('unexpected character');
  }
  function object(depth) {
    pos++;
    const out = Object.create(null);
    ws();
    if (text[pos] === '}') { pos++; return out; }
    for (;;) {
      ws();
      if (text[pos] !== '"') fail('object key must be a string');
      const k = string();
      ws();
      if (text[pos] !== ':') fail("expected ':'");
      pos++; ws();
      const v = value(depth + 1);
      if (Object.prototype.hasOwnProperty.call(out, k)) fail(`duplicate object key "${k}"`);
      out[k] = v;
      ws();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === '}') { pos++; return out; }
      fail("expected ',' or '}'");
    }
  }
  function array(depth) {
    pos++;
    const out = [];
    ws();
    if (text[pos] === ']') { pos++; return out; }
    for (;;) {
      ws();
      out.push(value(depth + 1));
      ws();
      if (text[pos] === ',') { pos++; continue; }
      if (text[pos] === ']') { pos++; return out; }
      fail("expected ',' or ']'");
    }
  }
  function hex4() {
    const h = text.substr(pos, 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape');
    pos += 4;
    return parseInt(h, 16);
  }
  function string() {
    pos++;
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('unterminated string');
      const c = text[pos];
      const code = c.charCodeAt(0);
      if (c === '"') { pos++; return out; }
      if (code < 0x20) fail('raw control character in string');
      if (c === '\\') {
        pos++;
        const e = text[pos++];
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            let cp = hex4();
            if (cp >= 0xd800 && cp <= 0xdbff) {
              if (text[pos] !== '\\' || text[pos + 1] !== 'u') fail('lone high surrogate');
              pos += 2;
              const lo = hex4();
              if (lo < 0xdc00 || lo > 0xdfff) fail('invalid low surrogate');
              cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
            } else if (cp >= 0xdc00 && cp <= 0xdfff) fail('lone low surrogate');
            out += String.fromCodePoint(cp);
            break;
          }
          default: pos--; fail('invalid escape');
        }
        continue;
      }
      out += c; pos++;
    }
  }
  function number() {
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(pos));
    if (!m) fail('bad number');
    const tok = m[0];
    if (/^-?0[0-9]/.test(text.slice(pos))) fail('leading zero in number');
    if (m[2] !== undefined || m[3] !== undefined) fail('floating point numbers are not allowed here');
    if (tok === '-0') fail('negative zero is not allowed');
    const n = Number(tok);
    if (!Number.isSafeInteger(n) || tok.replace('-', '').length > 16) fail('integer exceeds +/-(2^53-1)');
    pos += tok.length;
    return n;
  }

  ws();
  const v = value(0);
  ws();
  if (pos !== text.length) fail('trailing data after JSON value');
  return v;
}

/** Decode a file buffer: strip a UTF-8 BOM, require well-formed UTF-8. */
function decodeUtf8(buf) {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
}

// --------------------------------------------------------------------------
// Canonical JSON
// --------------------------------------------------------------------------

function escapeString(s) {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Fail('string contains a lone surrogate');
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (cp < 0x20) out += '\\u00' + (cp < 16 ? '0' : '') + cp.toString(16);
    else out += ch;
  }
  return out + '"';
}

function canonicalize(v) {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new Fail('only integers within +/-(2^53-1) can be canonicalized');
    return String(v);
  }
  if (typeof v === 'string') return escapeString(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
    return '{' + keys.map((k) => escapeString(k) + ':' + canonicalize(v[k])).join(',') + '}';
  }
  throw new Fail(`cannot canonicalize a value of type ${typeof v}`);
}

function canonicalBytes(v) { return Buffer.from(canonicalize(v), 'utf8'); }

/** Canonical bytes of an object without one member (the signature). */
function canonicalBytesWithout(doc, member) {
  const copy = Object.assign(Object.create(null), doc);
  delete copy[member];
  return canonicalBytes(copy);
}

// --------------------------------------------------------------------------
// SemVer 2.0 (mirrors ApcSemVer.h)
// --------------------------------------------------------------------------

function parseSemver(text) {
  let s = String(text);
  if (/^[vV]/.test(s)) s = s.slice(1);
  const m = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(s);
  if (!m) return null;
  const nums = [m[1], m[2], m[3]];
  if (nums.some((n) => n.length > 9 || Number(n) > 0x7fffffff)) return null;
  const pre = m[4] ? m[4].split('.') : [];
  if (pre.some((id) => /^[0-9]+$/.test(id) && id.length > 1 && id[0] === '0')) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre, build: m[5] || '' };
}

function semverToString(v) {
  return `${v.major}.${v.minor}.${v.patch}` + (v.pre.length ? '-' + v.pre.join('.') : '') + (v.build ? '+' + v.build : '');
}

function compareSemver(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  const n = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const x = a.pre[i]; const y = b.pre[i];
    const xn = /^[0-9]+$/.test(x); const yn = /^[0-9]+$/.test(y);
    if (xn && yn) {
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
      if (x !== y) return x < y ? -1 : 1;
    } else if (xn !== yn) return xn ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre.length !== b.pre.length) return a.pre.length < b.pre.length ? -1 : 1;
  return 0;
}

// --------------------------------------------------------------------------
// Keys
// --------------------------------------------------------------------------

function rawPublicKey(publicKeyObject) {
  return publicKeyObject.export({ type: 'spki', format: 'der' }).subarray(-32);
}

function publicKeyFromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 32) throw new Fail('an Ed25519 public key is exactly 32 bytes');
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

function privateKeyFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) throw new Fail('an Ed25519 seed is exactly 32 bytes');
  return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

function loadPrivateKey(file) {
  let pem;
  try { pem = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Fail(`cannot read private key ${file}: ${e.message}`); }
  let key;
  try { key = crypto.createPrivateKey(pem); } catch (e) { throw new Fail(`${file} is not a valid private key PEM`); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Fail(`${file} is not an Ed25519 key`);
  return key;
}

/** `arg` may be a PEM file, a file holding base64 of the raw 32 bytes, or the base64 text itself. */
function loadPublicKey(arg) {
  let text = arg;
  if (fs.existsSync(arg) && fs.statSync(arg).isFile()) text = fs.readFileSync(arg, 'utf8');
  text = text.trim();
  let key;
  try {
    if (text.includes('-----BEGIN')) key = crypto.createPublicKey(text);
    else {
      const raw = Buffer.from(text, 'base64');
      if (raw.length !== 32 || raw.toString('base64') !== text) throw new Error('bad base64');
      key = publicKeyFromRaw(raw);
    }
  } catch (e) {
    throw new Fail('--pubkey must be a PEM file or the base64 of the raw 32-byte Ed25519 public key');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Fail('--pubkey is not an Ed25519 key');
  return key;
}

function signBytes(privateKey, bytes) { return crypto.sign(null, bytes, privateKey); }
function verifyBytes(publicKey, bytes, sig) { return crypto.verify(null, bytes, publicKey, sig); }

/** Adds / replaces "signature" (base64 of 64 bytes over the canonical bytes without it). */
function signManifest(doc, privateKey) {
  const out = Object.assign(Object.create(null), doc);
  delete out.signature;
  const sig = signBytes(privateKey, canonicalBytes(out));
  out.signature = sig.toString('base64');
  return out;
}

function verifyManifestSignature(doc, publicKey) {
  if (typeof doc.signature !== 'string') return false;
  const sig = Buffer.from(doc.signature, 'base64');
  if (sig.length !== 64 || sig.toString('base64') !== doc.signature) return false;
  return verifyBytes(publicKey, canonicalBytesWithout(doc, 'signature'), sig);
}

// --------------------------------------------------------------------------
// Manifest validation (same rules as UpdateFlow::readManifest + the JSON schema)
// --------------------------------------------------------------------------

const MANIFEST_REQUIRED = ['schema', 'product', 'version', 'published_at', 'artifacts'];

function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest is not a JSON object'];
  for (const k of MANIFEST_REQUIRED) if (!(k in m)) errors.push(`missing "${k}"`);
  if (m.schema !== undefined && m.schema !== SCHEMA) errors.push(`schema must be "${SCHEMA}"`);
  if (typeof m.product !== 'string' || !m.product) errors.push('"product" must be a non-empty string');
  if (typeof m.version !== 'string' || !parseSemver(m.version)) errors.push('"version" is not a valid semver');
  if (m.min_supported !== undefined && (typeof m.min_supported !== 'string' || !parseSemver(m.min_supported))) errors.push('"min_supported" is not a valid semver');
  if (typeof m.published_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.published_at)) errors.push('"published_at" must be UTC ISO-8601 (YYYY-MM-DDTHH:MM:SSZ)');
  if (m.notes !== undefined && (typeof m.notes !== 'string' || Buffer.byteLength(m.notes) > 16384)) errors.push('"notes" must be a string of at most 16 KiB');
  if (!Array.isArray(m.artifacts) || m.artifacts.length === 0) errors.push('"artifacts" must be a non-empty array');
  else {
    m.artifacts.forEach((a, i) => {
      if (!a || typeof a !== 'object') { errors.push(`artifacts[${i}] is not an object`); return; }
      if (typeof a.platform !== 'string' || !PLATFORM_RE.test(a.platform)) errors.push(`artifacts[${i}].platform is invalid`);
      if (a.kind !== 'installer' && a.kind !== 'archive') errors.push(`artifacts[${i}].kind must be "installer" or "archive"`);
      if (typeof a.url !== 'string' || !a.url || /[\s\x00-\x1f\x7f]/.test(a.url) || a.url.length > 2048) errors.push(`artifacts[${i}].url is invalid`);
      else if (a.url.includes('://') && !a.url.startsWith('https://')) errors.push(`artifacts[${i}].url must be https`);
      if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) errors.push(`artifacts[${i}].sha256 must be 64 lowercase hex chars`);
      if (!Number.isSafeInteger(a.size) || a.size < 1) errors.push(`artifacts[${i}].size must be a positive integer`);
    });
  }
  return errors;
}

// --------------------------------------------------------------------------
// CLI plumbing
// --------------------------------------------------------------------------

function parseArgs(args, valueFlags, boolFlags) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (boolFlags.includes(name)) flags[name] = true;
      else if (valueFlags.includes(name)) {
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new UsageError(`--${name} needs a value`);
        flags[name] = args[++i];
      } else throw new UsageError(`unknown option --${name}`);
    } else positional.push(a);
  }
  return { flags, positional };
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let size = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n)); size += n;
    }
  } finally { fs.closeSync(fd); }
  return { sha256: h.digest('hex'), size };
}

function writeFileAtomic(file, data, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, data, opts);
  fs.renameSync(tmp, file);
}

function readJsonText(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { throw new Fail(`cannot read ${file}: ${e.message}`); }
  try { return decodeUtf8(buf); } catch { throw new Fail(`${file} is not valid UTF-8`); }
}

function readStrictJson(file) {
  const text = readJsonText(file);
  try { return parseStrict(text); } catch (e) { throw new Fail(`${file}: ${e.message}`); }
}

function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function pluginVersion(ctx, name) {
  const candidates = [];
  if (typeof ctx.pluginPath === 'function') candidates.push(ctx.pluginPath(name));
  for (const dir of candidates) {
    const sj = path.join(dir, 'status.json');
    if (fs.existsSync(sj)) {
      try {
        const st = JSON.parse(readJsonText(sj));
        if (st && typeof st.version === 'string' && parseSemver(st.version)) return { version: st.version.replace(/^[vV]/, ''), source: 'status.json' };
      } catch { /* fall through to CMake */ }
    }
    const cm = path.join(dir, 'CMakeLists.txt');
    if (fs.existsSync(cm)) {
      const t = fs.readFileSync(cm, 'utf8');
      const m = /\bVERSION\s+"?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]*)?)"?/.exec(t) || /set\s*\(\s*(?:PLUGIN_)?VERSION\s+"?(\d+\.\d+\.\d+)"?/i.exec(t);
      if (m && parseSemver(m[1])) return { version: m[1], source: 'CMakeLists.txt' };
    }
  }
  return null;
}

function inferPlatform(file) {
  const lower = file.toLowerCase();
  const ext = path.extname(lower) === '.gz' && lower.endsWith('.tar.gz') ? '.gz' : path.extname(lower);
  const arm = /arm64|aarch64/.test(lower);
  let os = null; let arch = arm ? 'arm64' : 'x64';
  if (/windows|win64|win32|(^|[^a-z])win([^a-z]|$)/.test(lower) || ext === '.exe' || ext === '.msi') os = 'windows';
  else if (/macos|osx|darwin|(^|[^a-z])mac([^a-z]|$)/.test(lower) || ext === '.pkg' || ext === '.dmg') { os = 'macos'; arch = arm ? 'arm64' : (/x64|x86_64|intel/.test(lower) ? 'x64' : 'universal'); }
  else if (/linux/.test(lower) || ext === '.deb' || ext === '.rpm' || ext === '.appimage') os = 'linux';
  if (!os) return null;
  let kind = null;
  if (INSTALLER_EXT.has(ext)) kind = 'installer'; else if (ARCHIVE_EXT.has(ext)) kind = 'archive';
  if (!kind) return null;
  return { platform: `${os}-${arch}`, kind };
}

/** Returns a reason string when the file name clearly belongs to a different version, else null. */
function versionMismatch(fileName, version) {
  const cores = fileName.match(/\d+\.\d+\.\d+/g);
  if (!cores) return null;                                   // no version in the name: cannot tell, accept
  const parsed = parseSemver(version);
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.pre.length) {                                   // pre-release manifest: the full version must appear
    return fileName.includes(version) ? null : `file name does not carry the pre-release version ${version}`;
  }
  const other = cores.find((c) => c !== core);
  if (other) return `file name carries version ${other}, manifest version is ${version}`;
  if (new RegExp(core.replace(/\./g, '\\.') + '-(alpha|beta|rc|pre|preview|dev|snapshot|nightly)', 'i').test(fileName)) return `file name looks like a pre-release of ${core}`;
  return null;
}

function findArtifactDir(ctx, name, version, explicitDir) {
  if (explicitDir) return { dir: path.resolve(explicitDir), filter: false };
  const paths = typeof ctx.resolvePaths === 'function' ? ctx.resolvePaths() : { releaseDir: path.resolve(ctx.root || process.cwd(), 'release') };
  const rel = paths.releaseDir;
  const candidates = [path.join(rel, name), path.join(rel, `${name}_v${version}`), path.join(rel, `${name}-${version}`), path.join(rel, `${name}_${version}`)];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return { dir: c, filter: false };
  if (fs.existsSync(rel)) return { dir: rel, filter: true };   // shared release dir: only files starting with <Name>
  return { dir: candidates[0], filter: false };
}

function out(ctx) { return ctx.stdout || ((s) => process.stdout.write(s)); }
function errOut(ctx) { return ctx.stderr || ((s) => process.stderr.write(s)); }

function emit(ctx, json, obj, lines) {
  if (json) out(ctx)(JSON.stringify(obj, null, 2) + '\n');
  else out(ctx)(lines.join('\n') + '\n');
}

// --------------------------------------------------------------------------
// Subcommands
// --------------------------------------------------------------------------

function cmdKeygen(args, ctx) {
  const { flags } = parseArgs(args, ['out'], ['json']);
  if (!flags.out) throw new UsageError('release keygen needs --out <dir>');
  const dir = path.resolve(flags.out);
  const files = Object.fromEntries(Object.entries(KEY_FILES).map(([k, v]) => [k, path.join(dir, v)]));
  const existing = Object.values(files).filter((f) => fs.existsSync(f));
  if (existing.length) throw new Fail(`refusing to overwrite existing key file(s): ${existing.join(', ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = rawPublicKey(publicKey);
  const b64 = raw.toString('base64');
  fs.writeFileSync(files.private, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(files.private, 0o600); } catch { /* not supported on this platform */ }
  fs.writeFileSync(files.public, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  fs.writeFileSync(files.b64, b64 + '\n', { flag: 'wx' });
  const bytes = [...raw].map((b) => '0x' + b.toString(16).padStart(2, '0'));
  const rows = []; for (let i = 0; i < 32; i += 8) rows.push('    ' + bytes.slice(i, i + 8).join(', '));
  fs.writeFileSync(files.inc,
    '// Generated by `apc release keygen`. UPDATE public key (Ed25519, 32 bytes). Public: safe to commit.\n' +
    'static const unsigned char kApcUpdatePublicKey[32] = {\n' + rows.join(',\n') + '\n};\n', { flag: 'wx' });

  const warnings = [];
  const root = ctx.root ? path.resolve(ctx.root) : null;
  if (root && (dir === root || dir.startsWith(root + path.sep))) warnings.push('the key directory is inside the repository: make sure the private key is git-ignored and NEVER committed');
  if (process.platform === 'win32') warnings.push('file mode 0600 is not enforced on Windows: keep the private key in a protected folder');
  emit(ctx, flags.json, { ok: true, command: 'keygen', dir, files, publicKeyBase64: b64, warnings },
    [`Update signing key pair written to ${dir}`, `  private: ${files.private}  (KEEP SECRET, back it up offline, never commit)`,
      `  public : ${files.public}`, `  base64 : ${b64}   (raw 32 bytes, embed in the plugin)`, `  C++    : ${files.inc}`, ...warnings.map((w) => `  WARNING: ${w}`)]);
  return 0;
}

function cmdManifest(args, ctx) {
  const { flags } = parseArgs(args, ['plugin', 'base-url', 'notes', 'key', 'version', 'min-supported', 'published-at', 'dir', 'out'], ['json']);
  if (!flags.plugin) throw new UsageError('release manifest needs --plugin <Name>');
  const name = flags.plugin;
  let version = flags.version ? flags.version.replace(/^[vV]/, '') : null;
  let versionSource = 'flag';
  if (!version) {
    const found = pluginVersion(ctx, name);
    if (!found) throw new Fail(`cannot determine the version of ${name}: no valid version in status.json or CMakeLists.txt (use --version)`);
    version = found.version; versionSource = found.source;
  }
  if (!parseSemver(version)) throw new Fail(`"${version}" is not a valid semantic version`);
  if (flags['min-supported'] && !parseSemver(flags['min-supported'])) throw new Fail('--min-supported is not a valid semantic version');
  if (flags['published-at'] && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(flags['published-at'])) throw new Fail('--published-at must be YYYY-MM-DDTHH:MM:SSZ (UTC)');
  let baseUrl = null;
  if (flags['base-url']) {
    baseUrl = flags['base-url'].replace(/\/+$/, '');
    if (!baseUrl.startsWith('https://')) throw new Fail('--base-url must start with https://');
  }

  const { dir, filter } = findArtifactDir(ctx, name, version, flags.dir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Fail(`artifact directory not found: ${dir}`);
  const warnings = []; const skipped = []; const artifacts = [];
  const seen = new Map();
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (f === 'update-manifest.json' || f.endsWith('.part')) continue;
    if (filter && !f.toLowerCase().startsWith(name.toLowerCase())) continue;
    const info = inferPlatform(f);
    if (!info) { if (/\.(exe|msi|pkg|dmg|zip|deb|rpm|appimage|gz|tgz)$/i.test(f)) skipped.push({ file: f, reason: 'cannot infer platform/kind from the file name' }); continue; }
    const mismatch = versionMismatch(f, version);
    if (mismatch) { skipped.push({ file: f, reason: mismatch }); continue; }
    const key = `${info.platform}/${info.kind}`;
    if (seen.has(key)) throw new Fail(`ambiguous artifacts for ${key}: ${seen.get(key)} and ${f} - remove one`);
    seen.set(key, f);
    const { sha256, size } = sha256File(full);
    if (size < 1) { skipped.push({ file: f, reason: 'empty file' }); continue; }
    const url = baseUrl ? `${baseUrl}/${encodeURIComponent(f)}` : f;
    artifacts.push({ platform: info.platform, kind: info.kind, url, sha256, size });
  }
  for (const s of skipped) warnings.push(`skipped ${s.file}: ${s.reason}`);
  if (artifacts.length === 0) throw new Fail(`no release artifacts for ${name} ${version} found in ${dir}${warnings.length ? ' (' + warnings.join('; ') + ')' : ''}`);
  if (!baseUrl) warnings.push('no --base-url: artifact urls are bare file names (the plugin resolves them next to the manifest URL)');

  let doc = Object.create(null);
  doc.schema = SCHEMA;
  doc.product = name;
  doc.version = version;
  if (flags['min-supported']) doc.min_supported = flags['min-supported'].replace(/^[vV]/, '');
  doc.published_at = flags['published-at'] || nowIso();
  if (flags.notes) {
    const notes = readJsonText(flags.notes).replace(/\r\n/g, '\n').trim();
    if (Buffer.byteLength(notes) > 16384) throw new Fail('release notes are longer than 16 KiB');
    if (notes) doc.notes = notes;
  }
  doc.artifacts = artifacts.sort((a, b) => (a.platform + a.kind).localeCompare(b.platform + b.kind));
  const errs = validateManifest(doc);
  if (errs.length) throw new Fail(`generated manifest is invalid: ${errs.join('; ')}`);
  const signed = !!flags.key;
  if (signed) doc = signManifest(doc, loadPrivateKey(flags.key));
  else warnings.push('manifest is NOT signed: the plugin will reject it. Run `apc release sign` or pass --key');

  const outFile = path.resolve(flags.out || path.join(dir, 'update-manifest.json'));
  writeFileAtomic(outFile, JSON.stringify(doc, null, 2) + '\n');
  emit(ctx, flags.json, { ok: true, command: 'manifest', file: outFile, version, versionSource, signed, artifacts, skipped, warnings },
    [`Manifest for ${name} ${version} (${versionSource}) -> ${outFile}`, ...artifacts.map((a) => `  ${a.platform} ${a.kind} ${a.size} bytes sha256 ${a.sha256.slice(0, 12)}...`),
      signed ? '  signed: yes' : '  signed: NO', ...warnings.map((w) => `  WARNING: ${w}`)]);
  return 0;
}

function cmdSign(args, ctx) {
  const { flags, positional } = parseArgs(args, ['key', 'out'], ['json']);
  if (positional.length !== 1) throw new UsageError('release sign needs exactly one <manifest> file');
  if (!flags.key) throw new UsageError('release sign needs --key <private.pem>');
  const file = path.resolve(positional[0]);
  const doc = readStrictJson(file);
  delete doc.signature;
  const errs = validateManifest(doc);
  if (errs.length) throw new Fail(`refusing to sign an invalid manifest: ${errs.join('; ')}`);
  const signed = signManifest(doc, loadPrivateKey(flags.key));
  const outFile = path.resolve(flags.out || file);
  writeFileAtomic(outFile, JSON.stringify(signed, null, 2) + '\n');
  emit(ctx, flags.json, { ok: true, command: 'sign', file: outFile, signature: signed.signature },
    [`Signed ${file} -> ${outFile}`, `  signature: ${signed.signature}`]);
  return 0;
}

function cmdVerify(args, ctx) {
  const { flags, positional } = parseArgs(args, ['pubkey', 'current', 'artifacts-dir'], ['json']);
  if (positional.length !== 1) throw new UsageError('release verify needs exactly one <manifest> file');
  if (!flags.pubkey) throw new UsageError('release verify needs --pubkey <pem|b64>');
  const file = path.resolve(positional[0]);
  const checks = [];
  const add = (name, ok, detail, skipped) => checks.push({ name, ok, detail: detail || '', skipped: !!skipped });
  let doc = null;
  try { doc = readStrictJson(file); add('parse', true, 'strict JSON, no floats'); } catch (e) { add('parse', false, e.message); }
  if (doc) {
    const errs = validateManifest(doc);
    add('structure', errs.length === 0, errs.join('; '));
    let key = null;
    try { key = loadPublicKey(flags.pubkey); } catch (e) { add('public-key', false, e.message); }
    if (key) {
      let sigOk = false;
      try { sigOk = verifyManifestSignature(doc, key); } catch (e) { add('signature', false, e.message); sigOk = null; }
      if (sigOk !== null) add('signature', sigOk, sigOk ? 'Ed25519 over canonical JSON' : 'signature does not match (tampered, wrong key, or unsigned)');
    }
    if (flags.current) {
      const cur = parseSemver(flags.current); const lat = parseSemver(doc.version);
      if (!cur) add('downgrade', false, `--current "${flags.current}" is not a valid version`);
      else if (!lat) add('downgrade', false, 'manifest version is invalid');
      else {
        const c = compareSemver(lat, cur);
        if (c < 0) add('downgrade', false, `downgrade blocked: manifest ${doc.version} is older than installed ${flags.current}`);
        else add('downgrade', true, c === 0 ? `no update: manifest ${doc.version} equals installed version` : `update ${flags.current} -> ${doc.version}`);
      }
    }
    if (Array.isArray(doc.artifacts)) {
      const base = path.resolve(flags['artifacts-dir'] || path.dirname(file));
      for (const a of doc.artifacts) {
        if (!a || typeof a.url !== 'string') continue;
        const leaf = decodeURIComponent(a.url.split(/[?#]/)[0].split('/').pop());
        const local = path.join(base, leaf);
        if (!leaf || !fs.existsSync(local)) { add(`artifact ${leaf || a.url}`, true, 'not present locally - hash not checked', true); continue; }
        const { sha256, size } = sha256File(local);
        add(`artifact ${leaf}`, sha256 === a.sha256 && size === a.size, sha256 === a.sha256 && size === a.size ? 'sha256 and size match' : `mismatch (local sha256 ${sha256.slice(0, 12)}..., ${size} bytes)`);
      }
    }
  }
  const ok = checks.every((c) => c.ok);
  emit(ctx, flags.json, { ok, command: 'verify', file, checks },
    [`${ok ? 'OK' : 'FAILED'}: ${file}`, ...checks.map((c) => `  [${c.skipped ? 'skip' : (c.ok ? ' ok ' : 'FAIL')}] ${c.name}${c.detail ? ' - ' + c.detail : ''}`)]);
  return ok ? 0 : 1;
}

const USAGE = [
  'Usage: apc release <subcommand> [options]   (all subcommands accept --json)',
  '  keygen   --out <dir>                         new Ed25519 update key pair (refuses to overwrite)',
  '  manifest --plugin <Name> [--base-url U] [--notes file] [--key pem] [--version V]',
  '           [--min-supported V] [--published-at ISO] [--dir D] [--out file]',
  '                                                scan release artifacts -> update-manifest.json',
  '  sign     <manifest> --key <private.pem> [--out file]',
  '  verify   <manifest> --pubkey <pem|b64> [--current V] [--artifacts-dir D]',
];

/**
 * @param {string[]} args  arguments after `release` (a leading "release" is tolerated)
 * @param {{root?:string, resolvePaths?:Function, pluginPath?:Function, readConfig?:Function, cmd?:any,
 *          stdout?:Function, stderr?:Function}} ctx
 * @returns {number} process exit code
 */
function run(args, ctx) {
  ctx = ctx || {};
  let a = Array.isArray(args) ? args.slice() : [];
  if (a[0] === 'release') a = a.slice(1);
  const sub = a[0];
  const rest = a.slice(1);
  const json = rest.includes('--json');
  try {
    switch (sub) {
      case 'keygen': return cmdKeygen(rest, ctx);
      case 'manifest': return cmdManifest(rest, ctx);
      case 'sign': return cmdSign(rest, ctx);
      case 'verify': return cmdVerify(rest, ctx);
      case undefined: case 'help': case '--help':
        out(ctx)(USAGE.join('\n') + '\n');
        return sub === undefined ? 2 : 0;
      default: throw new UsageError(`unknown subcommand "${sub}"`);
    }
  } catch (e) {
    const usage = e instanceof UsageError;
    if (!usage && !(e instanceof Fail)) throw e;
    if (json) out(ctx)(JSON.stringify({ ok: false, error: e.message, usage }, null, 2) + '\n');
    else {
      errOut(ctx)(`error: ${e.message}\n`);
      if (usage) errOut(ctx)(USAGE.join('\n') + '\n');
    }
    return usage ? 2 : 1;
  }
}

module.exports = {
  run, USAGE, SCHEMA,
  parseStrict, canonicalize, canonicalBytes, canonicalBytesWithout, decodeUtf8,
  parseSemver, compareSemver, semverToString,
  validateManifest, MANIFEST_REQUIRED,
  signManifest, verifyManifestSignature, rawPublicKey, publicKeyFromRaw, privateKeyFromSeed,
  loadPublicKey, loadPrivateKey, inferPlatform, sha256File,
};
