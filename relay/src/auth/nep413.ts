// NEP-413 signed messages (github.com/near/NEPs, nep-0413.md): what a wallet signs to prove it controls an
// account, off chain, with no transaction and no gas. The wallet signs sha256 of the borsh payload
//   u32 tag (2^31 + 413) | message: string | nonce: [u8; 32] | recipient: string | callbackUrl: Option<string>
// with one of the account's keys; the relay checks the signature here and, separately, over RPC, that the
// key is a full-access key of the account (src/auth/service.ts).
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { baseDecode, baseEncode } from 'near-api-js';

export const NEP413_TAG = 2 ** 31 + 413; // 2147484061

export interface Nep413Payload {
  message: string;
  /** exactly 32 bytes */
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
}

/** The borsh bytes of a payload, tag first. */
export function serializeNep413(p: Nep413Payload): Uint8Array {
  if (!(p.nonce instanceof Uint8Array) || p.nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const cb = p.callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(p.callbackUrl)]);
  return new Uint8Array(Buffer.concat([u32(NEP413_TAG), str(p.message), Buffer.from(p.nonce), str(p.recipient), cb]));
}

/** What the key signs: sha256 of the serialized payload. */
export function nep413Hash(p: Nep413Payload): Uint8Array {
  return new Uint8Array(crypto.createHash('sha256').update(serializeNep413(p)).digest());
}

/** `ed25519:<base58 of 32 bytes>` to the raw key; throws on anything else (secp256k1 keys sign no NEP-413 here). */
export function parseEd25519PublicKey(s: unknown): Uint8Array {
  if (typeof s !== 'string') throw new Error('public key must be a string');
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,50})$/.exec(s.trim());
  if (!m) throw new Error('public key must be ed25519:<base58>');
  const raw = baseDecode(m[1]);
  if (raw.length !== 32) throw new Error('an ed25519 public key has 32 bytes');
  return raw;
}

export function formatEd25519PublicKey(raw: Uint8Array): string {
  return `ed25519:${baseEncode(raw)}`;
}

/**
 * A signature as wallets return it: base64 (NEP-413), base64url, `ed25519:<base58>` or hex. Always 64 bytes.
 */
export function decodeSignature(s: unknown): Uint8Array {
  if (typeof s !== 'string' || !s.trim()) throw new Error('signature must be a string');
  const t = s.trim();
  let raw: Uint8Array;
  if (t.startsWith('ed25519:')) raw = baseDecode(t.slice(8));
  else if (/^(0x)?[0-9a-fA-F]{128}$/.test(t)) raw = new Uint8Array(Buffer.from(t.replace(/^0x/, ''), 'hex'));
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) raw = new Uint8Array(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  else throw new Error('signature must be base64, ed25519:<base58> or hex');
  if (raw.length !== 64) throw new Error(`an ed25519 signature has 64 bytes, got ${raw.length}`);
  return raw;
}

/** A 32-byte nonce from base64, base64url or 64 hex. */
export function decodeNonce(s: unknown): Uint8Array {
  if (typeof s !== 'string') throw new Error('nonce must be a string');
  const t = s.trim();
  const raw = /^[0-9a-fA-F]{64}$/.test(t)
    ? Buffer.from(t, 'hex')
    : Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (raw.length !== 32) throw new Error('nonce must be 32 bytes');
  return new Uint8Array(raw);
}

/** True when `signature` is the ed25519 signature of the payload's hash by `publicKey`. Never throws. */
export function verifyNep413(p: Nep413Payload, publicKey: string, signature: string): boolean {
  try {
    return ed25519.verify(decodeSignature(signature), nep413Hash(p), parseEd25519PublicKey(publicKey));
  } catch {
    return false;
  }
}

/** Sign a payload with a raw 32-byte ed25519 secret key (tests and tools: stands in for a wallet). Base64. */
export function signNep413(p: Nep413Payload, secretKey: Uint8Array): string {
  return Buffer.from(ed25519.sign(nep413Hash(p), secretKey)).toString('base64');
}

/** NEAR account id rules (nomicon): 2 to 64 chars of lowercase a-z, 0-9, `-`, `_`, separated by `.`. */
export function isAccountId(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 2 && s.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(s);
}
