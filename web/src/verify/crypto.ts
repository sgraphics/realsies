// Hashing and signature helpers shared by the Verify drawer and the mock relay.
// sha256 and keccak_256 from @noble/hashes, secp256k1 recovery from @noble/curves. Runs in browser and Node.

import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

export { bytesToHex, hexToBytes, utf8ToBytes };

const enc = (s: string | Uint8Array): Uint8Array => (typeof s === 'string' ? utf8ToBytes(s) : s);

/** sha256 of UTF-8 text (or raw bytes), lowercase hex without 0x. */
export function sha256Hex(s: string | Uint8Array): string {
  return bytesToHex(sha256(enc(s)));
}

export function keccakHex(s: string | Uint8Array): string {
  return bytesToHex(keccak_256(enc(s)));
}

/** EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len(text) + text). */
export function eip191Digest(text: string): Uint8Array {
  const body = utf8ToBytes(text);
  const prefix = utf8ToBytes('\x19Ethereum Signed Message:\n' + body.length);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix, 0);
  all.set(body, prefix.length);
  return keccak_256(all);
}

/** Ethereum address (lowercase, 0x) of an uncompressed or compressed secp256k1 public key. */
export function addressOfPublicKey(pub: Uint8Array): string {
  const unc = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  return '0x' + bytesToHex(keccak_256(unc.subarray(1)).subarray(12));
}

export function addressOfSecretKey(sk: Uint8Array): string {
  return addressOfPublicKey(secp256k1.getPublicKey(sk, false));
}

function strip0x(h: string): string {
  return h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
}

/**
 * Recover the signer of an EIP-191 signature (0x + 130 hex, r || s || v with v = 27/28 or 0/1).
 * Returns the lowercase 0x address, or null when the signature is malformed.
 */
export function recoverEip191(text: string, signatureHex: string): string | null {
  try {
    const b = hexToBytes(strip0x(signatureHex));
    if (b.length !== 65) return null;
    let v = b[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return null;
    const rec = new Uint8Array(65);
    rec[0] = v;
    rec.set(b.subarray(0, 64), 1);
    const pub = secp256k1.recoverPublicKey(rec, eip191Digest(text), { prehash: false });
    return addressOfPublicKey(pub);
  } catch {
    return null;
  }
}

/** Sign text EIP-191 style; returns 0x + 130 hex (r || s || v, v = 27/28). */
export function signEip191(text: string, sk: Uint8Array): string {
  const rec = secp256k1.sign(eip191Digest(text), sk, { prehash: false, format: 'recovered' });
  const out = new Uint8Array(65);
  out.set(rec.subarray(1, 65), 0);
  out[64] = rec[0] + 27;
  return '0x' + bytesToHex(out);
}

/** Lowercase, 0x-prefixed form for address comparisons. */
export function normAddr(a: string): string {
  const x = a.trim().toLowerCase();
  return x.startsWith('0x') ? x : '0x' + x;
}
