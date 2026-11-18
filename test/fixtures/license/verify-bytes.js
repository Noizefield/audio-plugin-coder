'use strict';
// TEST-ONLY helper for common/apc/tests/test_license_issued.cpp (live mode): Ed25519-verifies raw bytes.
//   node verify-bytes.js <public-key-base64> <message-file> <signature-file(base64 text)>
// Exit 0 = valid signature, 1 = invalid, 2 = usage / unreadable input. Prints nothing secret.
const fs = require('node:fs');
const crypto = require('node:crypto');

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
try {
  const [pubB64, msgFile, sigFile] = process.argv.slice(2);
  if (!pubB64 || !msgFile || !sigFile) process.exit(2);
  const raw = Buffer.from(pubB64, 'base64');
  if (raw.length !== 32) process.exit(2);
  const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  const msg = fs.readFileSync(msgFile);
  const sig = Buffer.from(fs.readFileSync(sigFile, 'utf8').trim(), 'base64');
  process.exit(sig.length === 64 && crypto.verify(null, msg, key, sig) ? 0 : 1);
} catch {
  process.exit(2);
}
