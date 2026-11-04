// Hashing, EIP-191 recovery and random hex, matching docs/spec.md section 3 and
// experiments/near-ai/verify_tee.py (eth-account recover_message).
import crypto from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const enc = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return enc.encode(s);
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('hex');
}

export function fromHex(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error('bad hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
}

/** sha256 of the UTF-8 bytes of a string (or of raw bytes), lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(typeof data === 'string' ? utf8(data) : data).digest('hex');
}

export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len(bytes) + bytes). */
export function eip191Digest(text: string): Uint8Array {
  const body = utf8(text);
  const prefix = utf8(`\x19Ethereum Signed Message:\n${body.length}`);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix, 0);
  all.set(body, prefix.length);
  return keccak256(all);
}

/** Ethereum address (lowercase 0x hex) of an uncompressed secp256k1 public key (65 bytes, 0x04 prefix). */
export function addressOfPublicKey(pub: Uint8Array): string {
  const raw = pub.length === 65 ? pub.subarray(1) : pub;
  if (raw.length !== 64) throw new Error('expected uncompressed public key');
  return '0x' + toHex(keccak256(raw).subarray(12));
}

/**
 * Recover the signer address of an EIP-191 signature over `text`.
 * `signature` is 0x + 130 hex: r (32) || s (32) || v (1), v in {27, 28} (or {0, 1}).
 * Returns null when the signature is malformed or does not recover.
 */
export function recoverEip191(text: string, signature: string): string | null {
  try {
    const sig = fromHex(signature);
    if (sig.length !== 65) return null;
    let v = sig[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return null;
    const recovered = new Uint8Array(65);
    recovered[0] = v;
    recovered.set(sig.subarray(0, 64), 1);
    const point = secp256k1.Signature.fromBytes(recovered, 'recovered').recoverPublicKey(eip191Digest(text));
    return addressOfPublicKey(point.toBytes(false));
  } catch {
    return null;
  }
}

/** Sign `text` with EIP-191 (used by the mock NEAR AI signer and tests only). Returns 0x + r||s||v. */
export function signEip191(text: string, privateKeyHex: string): string {
  const sk = fromHex(privateKeyHex);
  const sig = secp256k1.sign(eip191Digest(text), sk, { prehash: false, format: 'recovered' });
  // noble 'recovered' layout is recid || r || s; Ethereum wants r || s || (27 + recid).
  const out = new Uint8Array(65);
  out.set(sig.subarray(1, 65), 0);
  out[64] = 27 + sig[0];
  return '0x' + toHex(out);
}

export function addressOfPrivateKey(privateKeyHex: string): string {
  return addressOfPublicKey(secp256k1.getPublicKey(fromHex(privateKeyHex), false));
}
