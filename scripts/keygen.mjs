// Generates ed25519 key pairs in NEAR's string format.
// Usage: node scripts/keygen.mjs <name> [<name> ...]  -> JSON {name: {publicKey, privateKey}}
import { generateKeyPairSync } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}

export function nearKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  return {
    publicKey: 'ed25519:' + base58(pub),
    privateKey: 'ed25519:' + base58(Buffer.concat([seed, pub])),
  };
}

const names = process.argv.slice(2);
const out = {};
for (const n of names) out[n] = nearKeyPair();
process.stdout.write(JSON.stringify(out, null, 2));
