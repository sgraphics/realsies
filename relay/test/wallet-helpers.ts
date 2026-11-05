// Test stand-ins for a player's wallet and browser (protocol v1.3): ed25519 keys made here, NEP-413 sign-ins
// signed with them, and play and call transactions signed with the browser's own encoder
// (web/src/wallet/tx.ts, loaded as is at run time: it is the code the browser runs, read only from here).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { KeyPair, baseDecode, baseEncode } from 'near-api-js';
import type { AuthChallenge, SignRequestTx } from '../../shared/protocol.js';
import { formatEd25519PublicKey, signNep413 } from '../src/auth/nep413.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface FunctionCallTx {
  signerId: string;
  publicKey: Uint8Array;
  nonce: bigint;
  receiverId: string;
  blockHash: Uint8Array;
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

/** web/src/wallet/tx.ts, the browser's transaction encoder. */
export interface WebTx {
  encodeTransaction(tx: FunctionCallTx): Uint8Array;
  signTransaction(tx: FunctionCallTx, secretKey: Uint8Array): { signed: Uint8Array; hash: string };
  decodeSignedTransaction(bytes: Uint8Array): { tx: FunctionCallTx; txBytes: Uint8Array; signature: Uint8Array; hash: string };
}

let webTx: WebTx | null = null;
export async function loadWebTx(): Promise<WebTx> {
  webTx ??= (await import(pathToFileURL(path.resolve(here, '../../web/src/wallet/tx.ts')).href)) as WebTx;
  return webTx;
}

export interface TestKey {
  secret: Uint8Array;
  publicKey: string;
  /** the same key as near-api-js holds it */
  nearKeyPair: KeyPair;
}

export function newKey(): TestKey {
  const secret = ed25519.utils.randomSecretKey();
  const pub = ed25519.getPublicKey(secret);
  const full = new Uint8Array(64);
  full.set(secret, 0);
  full.set(pub, 32);
  return { secret, publicKey: formatEd25519PublicKey(pub), nearKeyPair: KeyPair.fromString(`ed25519:${baseEncode(full)}` as any) };
}

/** What a wallet returns for a challenge: the NEP-413 signature of {message, nonce, recipient}. */
export function signChallenge(ch: AuthChallenge, accountId: string, key: TestKey, recipient = ch.recipient): { accountId: string; publicKey: string; signature: string; nonce: string } {
  const nonce = new Uint8Array(Buffer.from(ch.nonce, 'base64'));
  return { accountId, publicKey: key.publicKey, signature: signNep413({ message: ch.message, nonce, recipient }, key.secret), nonce: ch.nonce };
}

export function txOfRequest(t: SignRequestTx): FunctionCallTx {
  const a = t.actions[0];
  return {
    signerId: t.signerId, publicKey: baseDecode(t.publicKey.replace(/^ed25519:/, '')), nonce: BigInt(t.nonce), receiverId: t.receiverId,
    blockHash: baseDecode(t.blockHash), methodName: a.methodName, args: new TextEncoder().encode(a.args), gas: BigInt(a.gas), deposit: BigInt(a.deposit),
  };
}

/** The browser's answer to sign_tx: the requested transaction signed with its play key, base64. */
export async function signRequest(tx: SignRequestTx, key: TestKey, tamper?: (t: FunctionCallTx) => FunctionCallTx): Promise<string> {
  const w = await loadWebTx();
  const t = txOfRequest(tx);
  const { signed } = w.signTransaction(tamper ? tamper(t) : t, key.secret);
  return Buffer.from(signed).toString('base64');
}
