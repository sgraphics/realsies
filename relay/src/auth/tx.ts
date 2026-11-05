// Transactions a player's browser signs with its play key (a function-call access key limited to the game
// contract's `play` and `call`). The relay asks for exactly one transaction at a time (SignRequestTx: every
// field fixed by the relay) and accepts the signed bytes only when they are that transaction, byte for
// byte, under a valid ed25519 signature of the player's registered key. Then it broadcasts and tracks it.
// The relay never holds a player's key.
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { SignedTransaction, baseDecode, baseEncode, encodeTransaction } from 'near-api-js';
import type { SignRequestTx } from '../../../shared/protocol.js';
import { parseEd25519PublicKey } from './nep413.js';

export const PLAYER_METHODS = ['play', 'call'] as const;
export type PlayerMethod = (typeof PLAYER_METHODS)[number];

/** What the relay expects in a player-signed transaction: everything, exactly. */
export interface ExpectedTx {
  signerId: string;
  publicKey: string;
  receiverId: string;
  nonce: bigint;
  /** base58 */
  blockHash: string;
  methodName: PlayerMethod;
  /** the exact JSON the relay put in the request; its bytes are the call's args */
  args: string;
  gas: bigint;
}

export type TxCheck =
  | { ok: true; hash: string; signed: SignedTransaction; bytes: Uint8Array }
  | { ok: false; code: string; reason: string };

/** The sign request for an expected transaction (ServerMsg sign_tx). */
export function signRequestOf(e: ExpectedTx): SignRequestTx {
  return {
    signerId: e.signerId,
    publicKey: e.publicKey,
    nonce: e.nonce.toString(),
    receiverId: e.receiverId,
    blockHash: e.blockHash,
    actions: [{ type: 'FunctionCall', methodName: e.methodName, args: e.args, gas: e.gas.toString(), deposit: '0' }],
  };
}

export function txHashOf(txBytes: Uint8Array): string {
  return baseEncode(new Uint8Array(crypto.createHash('sha256').update(txBytes).digest()));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** Signed transaction bytes from base64 (the wire format of signed_tx). */
export function decodeSignedTxBase64(s: unknown): Uint8Array | null {
  if (typeof s !== 'string' || s.length < 100 || s.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/**
 * Checks a player-signed transaction against what the relay asked for: signer, key, receiver, one
 * FunctionCall of the expected method with the exact args, no deposit, the gas, the nonce and block hash,
 * the canonical encoding, and the signature. Returns the transaction hash when it passes.
 */
export function checkSignedTx(bytes: Uint8Array, want: ExpectedTx): TxCheck {
  const no = (code: string, reason: string): TxCheck => ({ ok: false, code, reason });
  let signed: SignedTransaction;
  try {
    signed = SignedTransaction.decode(bytes);
  } catch (e) {
    return no('bad_encoding', `not a signed NEAR transaction: ${e instanceof Error ? e.message : String(e)}`);
  }
  const tx = signed.transaction;
  if (tx.nonceIndex !== undefined || tx.nonceMode !== undefined) return no('bad_encoding', 'gas-key transactions are not accepted');
  if (tx.signerId !== want.signerId) return no('wrong_signer', `signed by ${tx.signerId}, expected ${want.signerId}`);
  const pk = tx.publicKey.toString();
  if (pk !== want.publicKey) return no('wrong_key', `signed with ${pk}, not this browser's play key`);
  if (tx.receiverId !== want.receiverId) return no('wrong_receiver', `sent to ${tx.receiverId}, expected ${want.receiverId}`);
  if (tx.actions.length !== 1) return no('wrong_action', `${tx.actions.length} actions, expected one function call`);
  const fc = tx.actions[0].functionCall;
  if (!fc) return no('wrong_action', `a ${tx.actions[0].enum} action, expected a function call`);
  if (fc.methodName !== want.methodName) return no('wrong_method', `calls ${fc.methodName}, expected ${want.methodName}`);
  if (fc.deposit !== 0n) return no('deposit', 'a play key attaches no deposit');
  if (fc.gas !== want.gas) return no('wrong_gas', `${fc.gas} gas, expected ${want.gas}`);
  const args = Buffer.from(fc.args).toString('utf8');
  if (args !== want.args) {
    let detail = 'not the requested arguments';
    try {
      const got = JSON.parse(args);
      const exp = JSON.parse(want.args);
      const keys = [...new Set([...Object.keys(got ?? {}), ...Object.keys(exp)])];
      const diff = keys.filter((k) => JSON.stringify(got?.[k]) !== JSON.stringify(exp[k]));
      detail = diff.length ? `arguments differ: ${diff.join(', ')}` : 'arguments are not byte for byte the requested JSON';
    } catch {
      detail = 'arguments are not JSON';
    }
    return no('wrong_args', detail);
  }
  if (tx.nonce !== want.nonce) return no('wrong_nonce', `nonce ${tx.nonce}, expected ${want.nonce}`);
  // borsh hands fixed-size arrays back as plain arrays
  if (baseEncode(Uint8Array.from(tx.blockHash)) !== want.blockHash) return no('wrong_block', 'not the requested block hash');
  const txBytes = encodeTransaction(tx);
  if (!sameBytes(encodeTransaction(signed), bytes)) return no('bad_encoding', 'not the canonical encoding');
  const sigData = signed.signature.ed25519Signature?.data;
  if (!sigData || sigData.length !== 64) return no('bad_signature', 'not an ed25519 signature');
  const sig = Uint8Array.from(sigData);
  const digest = crypto.createHash('sha256').update(txBytes).digest();
  let good = false;
  try {
    good = ed25519.verify(sig, new Uint8Array(digest), parseEd25519PublicKey(want.publicKey));
  } catch {
    good = false;
  }
  if (!good) return no('bad_signature', 'the signature does not verify under the play key');
  return { ok: true, hash: baseEncode(new Uint8Array(digest)), signed, bytes };
}

/** base58 block hash to bytes (32), or null. */
export function blockHashBytes(s: string): Uint8Array | null {
  try {
    const b = baseDecode(s);
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}
