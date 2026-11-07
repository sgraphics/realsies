// One wallet approval for what the player asked for, with what it needs riding along: the browser's play key
// (an AddKey on the player's own account, while this browser has none) and the coin's storage registration
// (while the account is not registered), then the deposit or the withdrawal itself. NEAR Connect 0.12 sends
// them with signAndSendTransactions, one approval for all: every wallet in its manifest declares it, and
// actions in its own format (AddKey with a function-call permission included) pass through to the wallet
// unchanged. A wallet that refuses the batch gets them one approval at a time, the player's own transaction
// first and the play key last, skipping whatever landed already; a play key the wallet will not add is left
// for the first paid play, which asks for it on its own. No extra buttons either way.

import type { PublicConfig } from '../../../shared/protocol.ts';
import { WalletError, type WalletApi, type WalletTx } from './types.ts';

const TGAS = 1_000_000_000_000n;

/** The browser's play key on the player's account: play and call on the game contract, a small gas allowance. */
export function addPlayKeyTx(accountId: string, publicKey: string, pk: { receiverId: string; methodNames: string[]; allowance: string }): WalletTx {
  return {
    receiverId: accountId,
    actions: [{ type: 'AddKey', params: { publicKey, accessKey: { permission: { receiverId: pk.receiverId, allowance: pk.allowance, methodNames: [...pk.methodNames] } } } }],
  };
}

/** NEP-145: the account registers on the coin (it can hold it, and receive withdrawals). */
export function storageTx(cfg: PublicConfig, accountId: string, deposit: string): WalletTx {
  return {
    receiverId: cfg.tokenId,
    actions: [{ type: 'FunctionCall', params: { methodName: 'storage_deposit', args: { account_id: accountId, registration_only: true }, gas: cfg.wallet?.gas.storage ?? (30n * TGAS).toString(), deposit } }],
  };
}

/** A deposit: the coin moves from the wallet into the game (ft_transfer_call to the game contract). */
export function depositTx(cfg: PublicConfig, amount: bigint): WalletTx {
  return {
    receiverId: cfg.tokenId,
    actions: [{ type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args: { receiver_id: cfg.contractId, amount: amount.toString(), msg: '' }, gas: cfg.wallet?.gas.deposit ?? (100n * TGAS).toString(), deposit: '1' } }],
  };
}

/** A withdrawal: the game pays the coin back to the wallet. */
export function withdrawTx(cfg: PublicConfig, amount: bigint): WalletTx {
  return {
    receiverId: cfg.contractId,
    actions: [{ type: 'FunctionCall', params: { methodName: 'withdraw', args: { amount: amount.toString() }, gas: cfg.wallet?.gas.withdraw ?? (50n * TGAS).toString(), deposit: '0' } }],
  };
}

export interface Step {
  tx: WalletTx;
  /** the play key: when the wallet will not add it, the rest goes on without it */
  optional?: boolean;
  /** after a refused batch: whether this one landed anyway, so it is not sent twice */
  landed?: () => Promise<boolean>;
}

export interface SendResult {
  /** a hash per step, in the steps' order; null where a step was skipped or had landed already */
  hashes: (string | null)[];
  /** the wallet took them all in one approval */
  batched: boolean;
}

/** Codes after which the game never asks the wallet again on its own. */
const FINAL = new Set(['rejected', 'wrong_account', 'unavailable', 'tx_failed']);

/**
 * The steps in one approval. When the wallet refuses the batch itself (not the player: a closed wallet is an
 * answer), one approval each, the optional ones last; an optional step that fails is skipped.
 */
export async function sendSteps(w: WalletApi, accountId: string, steps: Step[]): Promise<SendResult> {
  try {
    return { hashes: await w.send(accountId, steps.map((s) => s.tx)), batched: true };
  } catch (e) {
    if (steps.length < 2 || (e instanceof WalletError && FINAL.has(e.code))) throw e;
  }
  const hashes: (string | null)[] = steps.map(() => null);
  const order = steps.map((_, i) => i).sort((a, b) => Number(!!steps[a].optional) - Number(!!steps[b].optional));
  for (const i of order) {
    const st = steps[i];
    if (st.landed && (await st.landed().catch(() => false))) continue;
    try {
      hashes[i] = (await w.send(accountId, [st.tx]))[0];
    } catch (e) {
      if (st.optional) continue;
      throw e;
    }
  }
  return { hashes, batched: false };
}
