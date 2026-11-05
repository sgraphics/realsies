// The browser's own NEAR transactions: one FunctionCall, signed with the play key (an ed25519
// function-call access key the wallet added). Borsh, as nearcore encodes Transaction (V0) and
// SignedTransaction; the relay checks these bytes against what it asked for (relay/src/auth/tx.ts) and
// its tests check them against near-api-js byte for byte.

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58Decode, base58Encode } from './base58.ts';

export interface FunctionCallTx {
  signerId: string;
  /** ed25519 public key, 32 bytes */
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  /** 32 bytes */
  blockHash: Uint8Array;
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

class Writer {
  private parts: Uint8Array[] = [];
  bytes(b: Uint8Array): this {
    this.parts.push(b);
    return this;
  }
  u8(n: number): this {
    return this.bytes(new Uint8Array([n & 0xff]));
  }
  u32(n: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    return this.bytes(b);
  }
  u64(n: bigint): this {
    if (n < 0n || n >= 1n << 64n) throw new Error('u64 out of range');
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return this.bytes(b);
  }
  u128(n: bigint): this {
    if (n < 0n || n >= 1n << 128n) throw new Error('u128 out of range');
    return this.u64(n & ((1n << 64n) - 1n)).u64(n >> 64n);
  }
  str(s: string): this {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  vec(b: Uint8Array): this {
    return this.u32(b.length).bytes(b);
  }
  done(): Uint8Array {
    const n = this.parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

const ED25519 = 0;
const ACTION_FUNCTION_CALL = 2;

/** borsh(Transaction): signer, key, nonce, receiver, block hash, [FunctionCall]. */
export function encodeTransaction(tx: FunctionCallTx): Uint8Array {
  if (tx.publicKey.length !== 32) throw new Error('an ed25519 public key has 32 bytes');
  if (tx.blockHash.length !== 32) throw new Error('a block hash has 32 bytes');
  return new Writer()
    .str(tx.signerId)
    .u8(ED25519).bytes(tx.publicKey)
    .u64(tx.nonce)
    .str(tx.receiverId)
    .bytes(tx.blockHash)
    .u32(1)
    .u8(ACTION_FUNCTION_CALL).str(tx.methodName).vec(tx.args).u64(tx.gas).u128(tx.deposit)
    .done();
}

/** borsh(SignedTransaction) = borsh(Transaction) | ed25519 signature. */
export function encodeSignedTransaction(txBytes: Uint8Array, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) throw new Error('an ed25519 signature has 64 bytes');
  return new Writer().bytes(txBytes).u8(ED25519).bytes(signature).done();
}

/** Signs with a 32-byte ed25519 secret key: sha256 of the transaction bytes. */
export function signTransaction(tx: FunctionCallTx, secretKey: Uint8Array): { signed: Uint8Array; hash: string } {
  const txBytes = encodeTransaction(tx);
  const digest = sha256(txBytes);
  const sig = ed25519.sign(digest, secretKey);
  return { signed: encodeSignedTransaction(txBytes, sig), hash: base58Encode(digest) };
}

class Reader {
  o = 0;
  constructor(private b: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.o + n > this.b.length) throw new Error('truncated transaction');
    const out = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0];
  }
  u32(): number {
    const t = this.take(4);
    return new DataView(t.buffer, t.byteOffset, 4).getUint32(0, true);
  }
  u64(): bigint {
    const t = this.take(8);
    return new DataView(t.buffer, t.byteOffset, 8).getBigUint64(0, true);
  }
  u128(): bigint {
    const lo = this.u64();
    return lo | (this.u64() << 64n);
  }
  str(): string {
    return new TextDecoder().decode(this.take(this.u32()));
  }
  vec(): Uint8Array {
    return this.take(this.u32());
  }
  get end(): boolean {
    return this.o === this.b.length;
  }
}

/** The reverse, for single-FunctionCall transactions only (the mock relay and tests). */
export function decodeSignedTransaction(bytes: Uint8Array): { tx: FunctionCallTx; txBytes: Uint8Array; signature: Uint8Array; hash: string } {
  const r = new Reader(bytes);
  const signerId = r.str();
  if (r.u8() !== ED25519) throw new Error('not an ed25519 key');
  const publicKey = r.take(32);
  const nonce = r.u64();
  const receiverId = r.str();
  const blockHash = r.take(32);
  if (r.u32() !== 1) throw new Error('one action expected');
  if (r.u8() !== ACTION_FUNCTION_CALL) throw new Error('a function call expected');
  const methodName = r.str();
  const args = r.vec();
  const gas = r.u64();
  const deposit = r.u128();
  const txLen = r.o;
  if (r.u8() !== ED25519) throw new Error('not an ed25519 signature');
  const signature = r.take(64);
  if (!r.end) throw new Error('trailing bytes');
  const txBytes = bytes.subarray(0, txLen);
  return {
    tx: { signerId, publicKey: new Uint8Array(publicKey), nonce, receiverId, blockHash: new Uint8Array(blockHash), methodName, args: new Uint8Array(args), gas, deposit },
    txBytes: new Uint8Array(txBytes),
    signature: new Uint8Array(signature),
    hash: base58Encode(sha256(txBytes)),
  };
}

/** True when the signed transaction's signature verifies under its own public key. */
export function verifySignedTransaction(bytes: Uint8Array): boolean {
  try {
    const d = decodeSignedTransaction(bytes);
    return ed25519.verify(d.signature, sha256(d.txBytes), d.tx.publicKey);
  } catch {
    return false;
  }
}

export function publicKeyString(raw: Uint8Array): string {
  return 'ed25519:' + base58Encode(raw);
}

export function parsePublicKey(s: string): Uint8Array {
  const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]+)$/.exec(s);
  if (!m) throw new Error('not an ed25519 public key');
  const raw = base58Decode(m[1]);
  if (raw.length !== 32) throw new Error('an ed25519 public key has 32 bytes');
  return raw;
}
