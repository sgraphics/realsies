// The browser's play key: an ed25519 key made here, never sent anywhere. The wallet adds its public half
// to the account as a function-call key for the game contract (play and call only, a small gas allowance);
// from then on this browser signs plays and calls without popups. Kept in localStorage per network and
// account, like near-api-js keystores and NEAR Connect's function-call-key plugin do.

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode, base58Encode } from './base58.ts';
import { publicKeyString } from './tx.ts';

export interface PlayKey {
  publicKey: string;
  secretKey: Uint8Array;
  /** 'pending' between the wallet approval and the relay's check on chain */
  status: 'pending' | 'active';
  createdAt: number;
}

const KEY = (network: string, account: string) => `realsies:playkey:${network}:${account}`;

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function newPlayKey(): PlayKey {
  const secretKey = ed25519.utils.randomSecretKey();
  return { publicKey: publicKeyString(ed25519.getPublicKey(secretKey)), secretKey, status: 'pending', createdAt: Date.now() };
}

export function savePlayKey(network: string, account: string, k: PlayKey): void {
  try {
    ls()?.setItem(KEY(network, account), JSON.stringify({ publicKey: k.publicKey, secretKey: base58Encode(k.secretKey), status: k.status, createdAt: k.createdAt }));
  } catch {
    /* private mode: the key lives for this page only */
  }
}

export function loadPlayKey(network: string, account: string): PlayKey | null {
  try {
    const raw = ls()?.getItem(KEY(network, account));
    if (!raw) return null;
    const j = JSON.parse(raw);
    const secretKey = base58Decode(String(j.secretKey));
    if (secretKey.length !== 32) return null;
    const publicKey = publicKeyString(ed25519.getPublicKey(secretKey));
    if (publicKey !== j.publicKey) return null;
    return { publicKey, secretKey, status: j.status === 'active' ? 'active' : 'pending', createdAt: Number(j.createdAt) || 0 };
  } catch {
    return null;
  }
}

export function forgetPlayKey(network: string, account: string): void {
  try {
    ls()?.removeItem(KEY(network, account));
  } catch {
    /* ignore */
  }
}
