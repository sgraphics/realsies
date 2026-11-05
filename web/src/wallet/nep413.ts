// NEP-413 messages in the browser: what a wallet signs at sign-in. The real wallet does the signing; this
// module lets the mock wallet sign like one and the mock relay check it like the relay does
// (relay/src/auth/nep413.ts).

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58Decode, base64Decode, base64Encode } from './base58.ts';

export const NEP413_TAG = 2 ** 31 + 413;

export interface Nep413Payload {
  message: string;
  nonce: Uint8Array;
  recipient: string;
  callbackUrl?: string | null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function str(s: string): Uint8Array {
  const b = new TextEncoder().encode(s);
  return concat([u32(b.length), b]);
}

export function nep413Hash(p: Nep413Payload): Uint8Array {
  if (p.nonce.length !== 32) throw new Error('nonce must be 32 bytes');
  const cb = p.callbackUrl == null ? new Uint8Array([0]) : concat([new Uint8Array([1]), str(p.callbackUrl)]);
  return sha256(concat([u32(NEP413_TAG), str(p.message), p.nonce, str(p.recipient), cb]));
}

/** base64 signature, as NEP-413 wallets return it. */
export function signNep413(p: Nep413Payload, secretKey: Uint8Array): string {
  return base64Encode(ed25519.sign(nep413Hash(p), secretKey));
}

export function verifyNep413(p: Nep413Payload, publicKey: string, signature: string): boolean {
  try {
    const pk = base58Decode(publicKey.replace(/^ed25519:/, ''));
    const sig = signature.startsWith('ed25519:') ? base58Decode(signature.slice(8)) : base64Decode(signature);
    return pk.length === 32 && sig.length === 64 && ed25519.verify(sig, nep413Hash(p), pk);
  } catch {
    return false;
  }
}
