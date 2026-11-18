'use strict';

/**
 * license-issuer - zero-dependency REFERENCE issuer for APC licensing method B
 * (`online-activation`). For development and testing; read "Production" below.
 *
 * The plugin only ever verifies a signed `apc-license/1.0` file. This issuer is the thing that
 * produces that file after counting machines against a key's seat limit. Your own server (a
 * WordPress/WooCommerce license-manager plugin, a hosted service, anything) can replace it as long
 * as it speaks the same small API and signs with the license key. Normative spec:
 *   schemas/apc-activation-api.schema.json   +   .agents/guides/licensing-methods.md
 *
 * API (JSON in, JSON out, Content-Type: application/json on every POST):
 *   GET  /v1/health
 *   POST /v1/activate        {serial, email?, machine_components[], product, plugin_version?}
 *                            -> 200 {ok:true, license, license_text, seats, seats_used, already_registered}
 *   POST /v1/deactivate      {serial, machine_components[], product?}
 *                            -> 200 {ok:true, freed, seats, seats_used}          (idempotent)
 *   POST /v1/offline/request {request_code}   validate a plugin request code, NO seat is consumed
 *                            -> 200 {ok:true, product, serial_hint, machine_count, seats, seats_used, already_registered, would_fit}
 *   POST /v1/offline/redeem  {request_code}   register the machine and return the signed license
 *                            -> 200 {ok:true, license, license_text, file_name, seats, seats_used, already_registered}
 *   errors: {ok:false, error: invalid_serial|revoked|seat_limit|product_mismatch|bad_request|
 *            invalid_request_code|payload_too_large|unsupported_media_type|rate_limited|not_found|
 *            method_not_allowed|server_error, message}
 *
 * Request code (what the plugin shows an offline customer): base64url (no padding) of the UTF-8 JSON
 *   {"v":1,"product":"<slug>","serial":"<key>","machine_components":["<16 hex>",...],"plugin_version":"1.2.3"}
 * It contains ONLY salted component hashes (never raw hardware data) and the key the customer typed.
 *
 * Seats: a "machine" is identified k-of-n (same rule as the plugin): a request whose components share at
 * least min(k, n) hashes with a registered machine IS that machine (idempotent re-activation, tolerates
 * one swapped disk or NIC; the stored components are refreshed). Otherwise it needs a free seat.
 *
 * Storage: one JSON file (schema apc-issuer-db/1), written atomically (temp file + fsync + rename),
 * re-read when it changes on disk (so `apc license serial` works while the server runs). Serials are
 * stored ONLY as SHA-256 hashes; a stolen DB file does not reveal usable keys.
 *
 * Hardening in this reference: loopback bind by default, request size cap, per-IP rate limit (plus a
 * stricter per-IP limit on failed serial attempts), constant-time serial comparison, no CORS headers,
 * POST requires application/json, request/header timeouts. Nothing about the client is trusted.
 *
 * PRODUCTION: this is a reference for development and testing. A real issuer belongs behind HTTPS
 * (TLS terminated by a reverse proxy or your hosting platform), with the license PRIVATE key held in a
 * secrets store (not in the repository), backups of the database, a real rate limiter that knows about
 * your proxy (this one keys on the socket address), and monitoring. There is no TLS here on purpose.
 *
 * Zero dependencies, Node 18+.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const DB_SCHEMA = 'apc-issuer-db/1';
const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I L O U
const SERIAL_LEN = 20; // 19 random chars + 1 check char = 95 bits of entropy
const HEX16 = /^[0-9a-f]{16}$/;
const MAX_COMPONENTS = 16;

const DEFAULTS = Object.freeze({
  host: '127.0.0.1',
  maxBodyBytes: 16 * 1024,
  rateLimit: { max: 60, failures: 10, windowMs: 60 * 1000 },
  minMatch: 2,
});

// lazy: scripts/apc-license.js requires this file, so requiring it at load time would be circular
const core = () => require('../apc-license.js');

// --------------------------------------------------------------------------
// Serials: 20 chars of Crockford base32 in groups of 5, last char is a Luhn mod-32 check
// --------------------------------------------------------------------------

function luhnCheckChar(body) {
  const n = SERIAL_ALPHABET.length;
  let factor = 2; let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const code = SERIAL_ALPHABET.indexOf(body[i]);
    if (code < 0) return null;
    let add = factor * code;
    factor = factor === 2 ? 1 : 2;
    add = Math.floor(add / n) + (add % n);
    sum += add;
  }
  return SERIAL_ALPHABET[(n - (sum % n)) % n];
}

/** Uppercases, drops spaces and hyphens, maps the ambiguous O->0 and I,L->1. Returns '' if unusable. */
function normalizeSerial(s) {
  if (typeof s !== 'string' || s.length > 64) return '';
  const t = s.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return t;
}

function isValidSerialFormat(s) {
  const t = normalizeSerial(s);
  if (t.length !== SERIAL_LEN) return false;
  for (const c of t) if (SERIAL_ALPHABET.indexOf(c) < 0) return false;
  return luhnCheckChar(t.slice(0, -1)) === t[t.length - 1];
}

function formatSerial(normalized) { return normalized.match(/.{5}/g).join('-'); }

function generateSerial() {
  const bytes = crypto.randomBytes(SERIAL_LEN - 1);
  let body = '';
  for (const b of bytes) body += SERIAL_ALPHABET[b & 31]; // 256 % 32 == 0: no modulo bias
  return formatSerial(body + luhnCheckChar(body));
}

function serialHash(serial) {
  return crypto.createHash('sha256').update('apc-serial/1\0' + normalizeSerial(serial)).digest('hex');
}

function maskSerial(serial) {
  const t = normalizeSerial(serial);
  return t.length === SERIAL_LEN ? `${t.slice(0, 5)}-*****-*****-${t.slice(15)}` : '';
}

// --------------------------------------------------------------------------
// Request codes
// --------------------------------------------------------------------------

function encodeRequestCode(o) {
  const body = {
    v: 1, product: o.product, serial: o.serial,
    machine_components: o.machine_components, plugin_version: o.plugin_version || '',
  };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

/** @returns {{ok:true, value:object}|{ok:false, message:string}} */
function decodeRequestCode(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > 4096) return { ok: false, message: 'request_code must be a string of at most 4096 characters' };
  // lenient on input: whitespace from e-mail/browsers, and standard-alphabet base64 ('+' '/' '=') from plugins that
  // only have a plain base64 encoder (ApcCanonicalJson.h base64Encode). Output of encodeRequestCode is strict base64url.
  const trimmed = code.replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return { ok: false, message: 'request_code is not base64url' };
  let o;
  try { o = JSON.parse(Buffer.from(trimmed, 'base64url').toString('utf8')); } catch { return { ok: false, message: 'request_code is not valid JSON' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, message: 'request_code payload must be an object' };
  if (o.v !== 1) return { ok: false, message: 'unsupported request_code version' };
  const err = checkMachineComponents(o.machine_components) || (typeof o.product !== 'string' || !o.product ? 'product missing' : null)
    || (typeof o.serial !== 'string' ? 'serial missing' : null)
    || (o.plugin_version !== undefined && (typeof o.plugin_version !== 'string' || o.plugin_version.length > 64) ? 'plugin_version invalid' : null);
  if (err) return { ok: false, message: err };
  return { ok: true, value: o };
}

function checkMachineComponents(c) {
  if (!Array.isArray(c) || c.length < 1 || c.length > MAX_COMPONENTS) return `machine_components must be an array of 1..${MAX_COMPONENTS} items`;
  for (const x of c) if (typeof x !== 'string' || !HEX16.test(x)) return 'machine_components items must be 16 lowercase hex characters';
  return null;
}

// --------------------------------------------------------------------------
// Database
// --------------------------------------------------------------------------

function nowIso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function writeFileAtomicSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, data); try { fs.fsyncSync(fd); } catch { /* best effort */ } } finally { fs.closeSync(fd); }
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } throw e; }
}

class Db {
  constructor(file, product) { this.file = file; this.product = product; this.data = null; this.stamp = ''; }

  static emptyDoc(product) { return { schema: DB_SCHEMA, product, serials: [] }; }

  _stamp() {
    try { const s = fs.statSync(this.file); return `${s.mtimeMs}:${s.size}`; } catch { return 'missing'; }
  }

  load() {
    const stamp = this._stamp();
    if (this.data && stamp === this.stamp) return this.data;
    if (stamp === 'missing') this.data = Db.emptyDoc(this.product);
    else {
      let doc;
      try { doc = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, '')); } catch (e) { throw new Error(`issuer database ${this.file} is unreadable: ${e.message}`); }
      if (!doc || doc.schema !== DB_SCHEMA || !Array.isArray(doc.serials)) throw new Error(`issuer database ${this.file} is not an ${DB_SCHEMA} file`);
      if (doc.product !== this.product) throw new Error(`issuer database ${this.file} belongs to product "${doc.product}", not "${this.product}"`);
      this.data = doc;
    }
    this.stamp = stamp;
    return this.data;
  }

  save() {
    writeFileAtomicSync(this.file, JSON.stringify(this.data, null, 2) + '\n');
    this.stamp = this._stamp();
  }

  /** Constant-time lookup: compares against EVERY record, never exits early on a match. */
  find(serial) {
    const doc = this.load();
    const want = Buffer.from(serialHash(serial), 'hex');
    let found = null;
    for (const rec of doc.serials) {
      const have = Buffer.from(rec.serial_hash, 'hex');
      if (have.length === want.length && crypto.timingSafeEqual(have, want) && found === null) found = rec;
    }
    return found;
  }
}

/**
 * Creates a serial for a customer. Returns the raw serial (shown ONCE; only its hash is stored).
 * opts: {seats, email, name, order, type, expires, minMatch}
 */
function createSerial(dbFile, product, opts) {
  const o = opts || {};
  const seats = o.seats === undefined ? 3 : o.seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > 9999) throw new Error('seats must be an integer between 1 and 9999');
  const db = new Db(dbFile, product);
  const doc = db.load();
  let serial; let h;
  do { serial = generateSerial(); h = serialHash(serial); } while (doc.serials.some((r) => r.serial_hash === h));
  const rec = {
    id: h.slice(0, 10), serial_hash: h, status: 'active', seats,
    customer_name: o.name || '', customer_email: o.email || '', order_id: o.order || '',
    license_type: o.type || 'commercial_perpetual', expires_at: o.expires || null,
    created_at: nowIso(Date.now()), machines: [],
  };
  if (!['commercial_perpetual', 'subscription', 'trial', 'nfr'].includes(rec.license_type)) throw new Error('unknown license type');
  doc.serials.push(rec);
  db.save();
  return { serial, id: rec.id, seats, hint: maskSerial(serial) };
}

/** Admin helpers used by `apc license serial --revoke / --reset / --list`. */
function adminUpdate(dbFile, product, serial, action) {
  const db = new Db(dbFile, product);
  const rec = db.find(serial);
  if (!rec) return { ok: false, error: 'invalid_serial' };
  if (action === 'revoke') rec.status = 'revoked';
  else if (action === 'restore') rec.status = 'active';
  else if (action === 'reset') rec.machines = [];
  else throw new Error(`unknown action ${action}`);
  db.save();
  return { ok: true, id: rec.id, status: rec.status, seats_used: rec.machines.length };
}

function listSerials(dbFile, product) {
  const doc = new Db(dbFile, product).load();
  return doc.serials.map((r) => ({
    id: r.id, status: r.status, seats: r.seats, seats_used: r.machines.length, license_type: r.license_type,
    customer_email: r.customer_email, order_id: r.order_id, created_at: r.created_at,
  }));
}

// --------------------------------------------------------------------------
// The issuer
// --------------------------------------------------------------------------

function matchMachine(rec, components, k) {
  const want = new Set(components);
  for (const m of rec.machines) {
    const need = Math.max(1, Math.min(k, m.components.length, components.length));
    let n = 0;
    for (const c of m.components) if (want.has(c)) n++;
    if (n >= need) return m;
  }
  return null;
}

/**
 * @param {object} o
 * @param {string} o.dbFile
 * @param {string} o.product            product slug the issuer signs for
 * @param {import('crypto').KeyObject} o.privateKey   Ed25519 LICENSE key (never the update key)
 * @param {number} [o.maxBodyBytes]
 * @param {{max:number,failures:number,windowMs:number}} [o.rateLimit]
 * @param {number} [o.minMatch]         k of the k-of-n machine match written into issued licenses
 * @param {()=>number} [o.now]          ms clock (tests)
 * @param {(msg:string)=>void} [o.log]  request log sink; never receives serials or keys
 */
function createIssuer(o) {
  if (!o || !o.dbFile || !o.product || !o.privateKey) throw new Error('createIssuer needs dbFile, product and privateKey');
  const now = o.now || (() => Date.now());
  const maxBody = o.maxBodyBytes || DEFAULTS.maxBodyBytes;
  const rl = Object.assign({}, DEFAULTS.rateLimit, o.rateLimit || {});
  const minMatch = o.minMatch || DEFAULTS.minMatch;
  const db = new Db(o.dbFile, o.product);
  const log = o.log || (() => {});
  const buckets = new Map(); // ip -> {count, fails, resetAt}

  function bucket(ip) {
    const t = now();
    let b = buckets.get(ip);
    if (!b || t >= b.resetAt) {
      if (buckets.size > 10000) for (const [k, v] of buckets) if (t >= v.resetAt) buckets.delete(k);
      b = { count: 0, fails: 0, resetAt: t + rl.windowMs };
      buckets.set(ip, b);
    }
    return b;
  }

  const err = (status, error, message, extra) => ({ status, body: Object.assign({ ok: false, error, message }, extra) });

  function licenseFor(rec, components, seats) {
    const k = Math.min(minMatch, components.length);
    return core().signLicense({
      product: o.product,
      customer_name: rec.customer_name, customer_email: rec.customer_email, order_id: rec.order_id,
      license_type: rec.license_type, expires_at: rec.expires_at, allowed_seats: seats,
      machine_components: components, machine_min_match: k,
    }, o.privateKey, nowIso(now()));
  }

  /** Shared by /activate and /offline/redeem. `commit=false` is the dry run used by /offline/request. */
  function register(serial, email, components, plugin_version, commit) {
    if (!isValidSerialFormat(serial)) return err(403, 'invalid_serial', 'The license key is not valid.', { fail: true });
    const rec = db.find(serial);
    if (!rec) return err(403, 'invalid_serial', 'The license key is not valid.', { fail: true });
    if (email !== undefined && rec.customer_email && String(email).trim().toLowerCase() !== rec.customer_email.toLowerCase())
      return err(403, 'invalid_serial', 'The license key is not valid.', { fail: true });
    if (rec.status === 'revoked') return err(403, 'revoked', 'This license key has been revoked.', { fail: true });
    const existing = matchMachine(rec, components, minMatch);
    const seats = Number.isInteger(rec.seats) ? rec.seats : (o.defaultSeats || 3); // defaultSeats: only for records without a seat count
    const info = { seats, seats_used: rec.machines.length };
    if (!existing && rec.machines.length >= seats)
      return err(409, 'seat_limit', `All ${seats} seat(s) of this key are in use. Deactivate another machine first.`, info);
    if (!commit) return { status: 200, body: Object.assign({ ok: true, already_registered: !!existing, would_fit: true }, info), rec };
    const t = nowIso(now());
    let machine = existing;
    if (machine) { machine.components = components.slice(); machine.last_seen = t; if (plugin_version) machine.plugin_version = plugin_version; }
    else { machine = { components: components.slice(), first_seen: t, last_seen: t, plugin_version: plugin_version || '' }; rec.machines.push(machine); }
    db.save();
    const license = licenseFor(rec, components, seats);
    return {
      status: 200,
      body: { ok: true, license, license_text: core().licenseText(license), seats, seats_used: rec.machines.length, already_registered: !!existing },
      rec,
    };
  }

  function stripInternal(r) { delete r.rec; if (r.body && r.body.fail) delete r.body.fail; return r; }
  const isFail = (r) => r.body && r.body.fail === true;

  function route(method, url, bodyObj) {
    const p = url.split('?')[0];
    if (p === '/v1/health') {
      if (method !== 'GET') return err(405, 'method_not_allowed', 'Use GET.');
      return { status: 200, body: { ok: true, service: 'apc-license-issuer', api: 'v1', product: o.product } };
    }
    const postRoutes = ['/v1/activate', '/v1/deactivate', '/v1/offline/request', '/v1/offline/redeem'];
    if (!postRoutes.includes(p)) return err(404, 'not_found', 'Unknown route.');
    if (method !== 'POST') return err(405, 'method_not_allowed', 'Use POST.');
    const b = bodyObj;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return err(400, 'bad_request', 'The body must be a JSON object.');

    if (p === '/v1/offline/request' || p === '/v1/offline/redeem') {
      const dec = decodeRequestCode(b.request_code);
      if (!dec.ok) return err(400, 'invalid_request_code', dec.message);
      const v = dec.value;
      if (v.product !== o.product) return err(400, 'product_mismatch', 'The request code is for a different product.');
      const r = register(v.serial, undefined, v.machine_components, v.plugin_version, p === '/v1/offline/redeem');
      if (r.status !== 200) return r;
      if (p === '/v1/offline/request') {
        return { status: 200, body: Object.assign({
          ok: true, product: o.product, serial_hint: maskSerial(v.serial), machine_count: v.machine_components.length,
        }, r.body), fail: false };
      }
      r.body.file_name = `${o.product}.lic`;
      return r;
    }

    // activate / deactivate
    if (typeof b.serial !== 'string') return err(400, 'bad_request', 'serial is required.');
    const cErr = checkMachineComponents(b.machine_components);
    if (cErr) return err(400, 'bad_request', cErr);
    if (p === '/v1/activate') {
      if (b.product !== o.product) return err(400, 'product_mismatch', 'This key server issues licenses for a different product.');
      if (b.email !== undefined && (typeof b.email !== 'string' || b.email.length > 320)) return err(400, 'bad_request', 'email must be a string.');
      if (b.plugin_version !== undefined && (typeof b.plugin_version !== 'string' || b.plugin_version.length > 64)) return err(400, 'bad_request', 'plugin_version must be a string.');
      return register(b.serial, b.email, b.machine_components, b.plugin_version, true);
    }
    // deactivate (idempotent; allowed for revoked keys so customers can always release seats)
    if (b.product !== undefined && b.product !== o.product) return err(400, 'product_mismatch', 'This key server issues licenses for a different product.');
    if (!isValidSerialFormat(b.serial)) return err(403, 'invalid_serial', 'The license key is not valid.', { fail: true });
    const rec = db.find(b.serial);
    if (!rec) return err(403, 'invalid_serial', 'The license key is not valid.', { fail: true });
    const m = matchMachine(rec, b.machine_components, minMatch);
    if (m) { rec.machines.splice(rec.machines.indexOf(m), 1); db.save(); }
    return { status: 200, body: { ok: true, freed: !!m, seats: Number.isInteger(rec.seats) ? rec.seats : (o.defaultSeats || 3), seats_used: rec.machines.length } };
  }

  /** Transport-independent entry point (also used by tests). */
  function handle(method, url, ip, contentType, rawBody) {
    const b = bucket(ip);
    b.count++;
    if (b.count > rl.max || b.fails >= rl.failures) return err(429, 'rate_limited', 'Too many requests. Try again later.');
    let bodyObj;
    if (method === 'POST') {
      if (!/^application\/json(\s*;|$)/i.test(contentType || '')) return err(415, 'unsupported_media_type', 'Content-Type must be application/json.');
      try { bodyObj = JSON.parse(rawBody.toString('utf8')); } catch { return err(400, 'bad_request', 'The body is not valid JSON.'); }
    }
    let r;
    try { r = route(method, url, bodyObj); } catch (e) {
      log(`error ${e.message}`);
      return err(500, 'server_error', 'The license server could not process the request.');
    }
    if (isFail(r)) b.fails++;
    return stripInternal(r);
  }

  const server = http.createServer((req, res) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const send = (r, closeAfter) => {
      const payload = Buffer.from(JSON.stringify(r.body) + '\n', 'utf8');
      const headers = {
        'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      };
      if (closeAfter) headers.Connection = 'close';
      res.writeHead(r.status, headers);
      res.end(payload);
      log(`${req.method} ${(req.url || '').split('?')[0]} ${r.status}${r.body.error ? ' ' + r.body.error : ''}`);
    };
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBody) {
      bucket(ip).count++;
      send(err(413, 'payload_too_large', `The request body may not exceed ${maxBody} bytes.`), true);
      req.resume(); // drain (bounded by the socket timeouts) so the client can read the answer
      return;
    }
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBody) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) { bucket(ip).count++; send(err(413, 'payload_too_large', `The request body may not exceed ${maxBody} bytes.`), true); return; }
      send(handle(req.method, req.url || '/', ip, req.headers['content-type'], Buffer.concat(chunks)));
    });
    req.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;

  return {
    server, handle, db,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port || 0, host || DEFAULTS.host, () => { server.removeListener('error', reject); resolve(server.address()); });
      });
    },
    close() {
      return new Promise((resolve) => { server.close(() => resolve()); if (server.closeAllConnections) server.closeAllConnections(); });
    },
  };
}

module.exports = {
  createIssuer, createSerial, adminUpdate, listSerials,
  generateSerial, isValidSerialFormat, normalizeSerial, serialHash, maskSerial, luhnCheckChar,
  encodeRequestCode, decodeRequestCode, checkMachineComponents,
  DB_SCHEMA, DEFAULTS, SERIAL_ALPHABET,
};
