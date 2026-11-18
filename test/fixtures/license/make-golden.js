'use strict';
// Regenerates test/fixtures/license/golden.json (committed). Run: node test/fixtures/license/make-golden.js
//
// The licenses are signed with the RFC 8032 section 7.1 TEST 1 seed (same TEST-ONLY key as
// test/fixtures/release/canonical-vectors.json): NEVER use it for anything real. Ed25519 is deterministic and
// issued_at is fixed, so re-running reproduces the file byte for byte. The committed file is what
// common/apc/tests/test_license_issued.cpp reads; test/license.test.js re-verifies every signature with Node.

const fs = require('node:fs');
const path = require('node:path');
const release = require('../../../scripts/apc-release.js');
const lic = require('../../../scripts/apc-license.js');

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const priv = release.privateKeyFromSeed(Buffer.from(SEED_HEX, 'hex'));
const pubB64 = release.rawPublicKey(require('node:crypto').createPublicKey(priv)).toString('base64');

const PRODUCT = 'DemoSynth';
const machine = [
  { label: 'cpu', value: 'CoolCPU 9000' },
  { label: 'machine-id', value: 'abc-123' },
  { label: 'volume', value: 'VOL-777' },
].map((m) => Object.assign(m, { hash: lic.machineComponentHash(PRODUCT, m.label, m.value) }));
const hashes = machine.map((m) => m.hash);

const ISSUED = '2026-10-23T14:30:00Z';
const base = { product: PRODUCT, customer_email: 'ada@example.test', order_id: 'ORD-1', allowed_seats: 3 };
// the name exercises the canonicalisation rules: quote, backslash, tab, U+0001, non-BMP, non-ASCII, U+2028, DEL
const NASTY = 'Ada "Countess" Lovelace \\ \t\u0001 Zoë 日本 😀   \u007f';

const specs = [
  { name: 'bound-perpetual', expect_state: 'LICENSED', f: Object.assign({}, base, { customer_name: NASTY, license_type: 'commercial_perpetual', expires_at: null, machine_components: hashes, machine_min_match: 2 }) },
  { name: 'unbound-nfr', expect_state: 'LICENSED', f: Object.assign({}, base, { customer_name: 'Reviewer', license_type: 'nfr', expires_at: null }) },
  { name: 'subscription-expired', expect_state: 'DEMO', f: Object.assign({}, base, { customer_name: 'Ada', license_type: 'subscription', expires_at: '2026-12-01T00:00:00Z' }) },
  { name: 'signed-trial', expect_state: 'TRIAL', f: Object.assign({}, base, { customer_name: 'Tess', license_type: 'trial', expires_at: '2027-02-01T00:00:00Z' }) },
  { name: 'wrong-product', expect_state: 'UNVERIFIED', f: Object.assign({}, base, { product: 'OtherSynth', customer_name: 'Ada', license_type: 'commercial_perpetual', expires_at: null }) },
];

const cases = specs.map((s) => {
  const doc = lic.signLicense(s.f, priv, ISSUED);
  const canonical = release.canonicalBytesWithout(doc, 'signature_ed25519').toString('utf8');
  return { name: s.name, expect_state: s.expect_state, license_text: lic.licenseText(doc), canonical, signature_b64: doc.signature_ed25519 };
});

const golden = {
  schema: 'apc-license-golden/1',
  note: 'Committed golden licenses issued by scripts/apc-license.js with the RFC 8032 TEST 1 seed (TEST ONLY). C++ has no Ed25519, so common/apc/tests/test_license_issued.cpp checks that ApcLicense.h canonicalises each license to EXACTLY the "canonical" bytes below and hands the verifier that exact message plus this signature; test/license.test.js proves with Node that signature_b64 is a valid Ed25519 signature of "canonical" under public_key_b64. Regenerate with test/fixtures/license/make-golden.js.',
  seed_hex: SEED_HEX,
  public_key_b64: pubB64,
  product: PRODUCT,
  clock_unix: 1800000000,
  machine,
  cases,
};
fs.writeFileSync(path.join(__dirname, 'golden.json'), JSON.stringify(golden, null, 2) + '\n');
console.log(`wrote golden.json (${cases.length} cases)`);
