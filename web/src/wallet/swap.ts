// Coins for NEAR and back on Rhea, formerly Ref Finance (protocol v1.12): the transactions of a buy and a sale, built
// from the relay's quote (GET /api/swap/quote) and the wallet's state (WalletInfo). The store sends them in one wallet
// approval (batch.ts sendSteps); relay/tools/swap-proof.ts sends these very transactions on testnet.
//
// A buy, in order (the browser's play key goes first while this browser has none, see store.ts):
//   storage_deposit {account_id, registration_only: true}  on the coin           while not registered: the coins arrive by ft_transfer
//   one transaction to the wrap contract, three actions:
//     storage_deposit {account_id, registration_only: true}     0.00125 NEAR       while not registered there
//     near_deposit {}                                            what wNEAR lacks   unless the wallet's wNEAR covers it all
//     ft_transfer_call {receiver_id: <pool contract>, amount: <swapIn>, msg: {"Swap": {pool_ids, output_token: <coin>,
//       min_output_amount: <whole coins>, skip_unwrap_near: true}}}  1 yoctoNEAR, 250 Tgas
//   ft_transfer_call {receiver_id: <game>, amount: <those coins>, msg: ""}  on the coin: the deposit, as before
// The swap is exact-input (v1.15): it sends the quote's swapIn (the cost of the whole coins plus the slippage
// allowance, at most the NEAR offered; the rest of that NEAR is never wrapped) and wants at least those coins back.
// Why: the pool contract logs a Swap as the event `swap`, which DexScreener and GeckoTerminal count as a buy, and a
// SwapByOutput as `swap_desire`, which they do not, so exact-output buys were invisible on the charts. A Swap gives a
// little more of the coin than the whole coins (up to the allowance, about 1%); the deposit moves exactly the whole
// coins and that little stays in the wallet. Verified on testnet: a price that moved past the allowance fails inside
// the pool contract (E204: slippage error) and every wNEAR comes back, while the transaction itself still reads as a
// success; so the store reads the balances afterwards instead of trusting the wallet's answer.
// Without swapIn (an older relay) the buy is the earlier exact-output one: amount <NEAR offered>, msg {"SwapByOutput":
// {pool_ids, output_token: <coin>, output_amount: <whole coins>, skip_unwrap_near: true}}; what it does not use comes
// back as wNEAR, which the next buy spends first.
//
// A sale:
//   withdraw {amount}  on the game        (not when selling what the wallet itself holds)
//   ft_transfer_call {receiver_id: <pool contract>, amount, msg: {"Swap": {pool_ids, output_token: <wrap>, min_output_amount,
//     skip_unwrap_near: false}}}  on the coin, 1 yoctoNEAR, 250 Tgas: the pool contract unwraps and plain NEAR arrives
//   near_withdraw {amount}  on the wrap contract, 1 yoctoNEAR   wNEAR left from earlier buys, back to NEAR

import type { PublicConfig, SwapConfig, WalletInfo } from '../../../shared/protocol.ts';
import type { WalletTx } from './types.ts';
import { depositTx, storageTx, withdrawTx } from './batch.ts';

const TGAS = 1_000_000_000_000n;
export const ONE_NEAR = 10n ** 24n;
/** wrap.near and wrap.testnet: storage_balance_bounds.min */
export const WRAP_STORAGE = 1_250_000_000_000_000_000_000n;
/** NEAR a buy leaves in the wallet for the gas of the batch and storage (a buy is refused that would go below it) */
export const NEAR_RESERVE = ONE_NEAR / 20n;
/** the swap's ft_transfer_call: the pool contract used 14 to 18 Tgas on testnet; with storage and near_deposit at 10
 *  each a buy stays at 270 Tgas, under the 300 Tgas some wallets allow a transaction */
export const SWAP_GAS = 250n * TGAS;
const SMALL_GAS = 10n * TGAS;
const UNWRAP_GAS = 30n * TGAS;

/** What each transaction of a buy or a sale is, so the store knows how to tell whether it landed. */
export type SwapStep = 'coin_storage' | 'buy' | 'deposit' | 'withdraw' | 'sell' | 'unwrap';
export interface SwapTx {
  step: SwapStep;
  tx: WalletTx;
}

/** The wallet as a buy needs it (WalletInfo, v1.12). */
export interface SwapWallet {
  tokenRegistered: boolean;
  /** yoctoNEAR to register on the coin */
  storageDeposit: bigint;
  wrapRegistered: boolean;
  wrapStorage: bigint;
  wnear: bigint;
  /** NEAR it can spend; null when the relay could not say */
  near: bigint | null;
}

/** The wallet's state for a buy or a sale; null when the relay did not say enough (an older relay, or a read failed). */
export function swapWalletOf(info: WalletInfo | undefined): SwapWallet | null {
  if (!info || info.wrapRegistered === undefined || info.wnearBalance === undefined) return null;
  try {
    return {
      tokenRegistered: info.tokenRegistered,
      storageDeposit: BigInt(info.storageDeposit || '0'),
      wrapRegistered: info.wrapRegistered,
      wrapStorage: BigInt(info.wrapStorageDeposit ?? WRAP_STORAGE),
      wnear: BigInt(info.wnearBalance),
      near: info.nearBalance === undefined ? null : BigInt(info.nearBalance),
    };
  } catch {
    return null;
  }
}

function call(methodName: string, args: object, gas: bigint, deposit: bigint): WalletTx['actions'][number] {
  return { type: 'FunctionCall', params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } };
}

/** The swap message of a buy (v1.15): all the ft_transfer_call carries in, at least `units` of the coin out. */
export function buyMsg(s: SwapConfig, coin: string, units: bigint): string {
  return JSON.stringify({ Swap: { pool_ids: [s.poolId], output_token: coin, min_output_amount: units.toString(), skip_unwrap_near: true } });
}

/** The swap message of a buy on an older relay (no swapIn): exactly `units` of the coin, at most what the ft_transfer_call carries. */
export function buyByOutputMsg(s: SwapConfig, coin: string, units: bigint): string {
  return JSON.stringify({ SwapByOutput: { pool_ids: [s.poolId], output_token: coin, output_amount: units.toString(), skip_unwrap_near: true } });
}

/** The swap message of a sale: wNEAR out, unwrapped by the pool contract into plain NEAR, at least `minOut`. */
export function sellMsg(s: SwapConfig, minOut: bigint): string {
  return JSON.stringify({ Swap: { pool_ids: [s.poolId], output_token: s.wrapId, min_output_amount: minOut.toString(), skip_unwrap_near: false } });
}

/**
 * The one transaction to the wrap contract: register there if needed, wrap what the wallet's wNEAR lacks, swap. With
 * `swapIn` the swap sends exactly that for at least `units` (Swap); without it all of `maxIn` for exactly `units`
 * (SwapByOutput, an older relay).
 */
export function buySwapTx(
  s: SwapConfig,
  coin: string,
  accountId: string,
  maxIn: bigint,
  units: bigint,
  w: Pick<SwapWallet, 'wrapRegistered' | 'wrapStorage' | 'wnear'>,
  swapIn?: bigint,
): WalletTx {
  const amount = swapIn ?? maxIn;
  const actions: WalletTx['actions'] = [];
  if (!w.wrapRegistered) actions.push(call('storage_deposit', { account_id: accountId, registration_only: true }, SMALL_GAS, w.wrapStorage));
  if (w.wnear < amount) actions.push(call('near_deposit', {}, SMALL_GAS, amount - w.wnear));
  const msg = swapIn === undefined ? buyByOutputMsg(s, coin, units) : buyMsg(s, coin, units);
  actions.push(call('ft_transfer_call', { receiver_id: s.dex, amount: amount.toString(), msg }, SWAP_GAS, 1n));
  return { receiverId: s.wrapId, actions };
}

/** A sale of `units` of the coin for at least `minOut` yoctoNEAR. */
export function sellTx(cfg: PublicConfig, s: SwapConfig, units: bigint, minOut: bigint): WalletTx {
  return { receiverId: cfg.tokenId, actions: [call('ft_transfer_call', { receiver_id: s.dex, amount: units.toString(), msg: sellMsg(s, minOut) }, SWAP_GAS, 1n)] };
}

/** wNEAR back to NEAR. */
export function unwrapTx(s: SwapConfig, amount: bigint): WalletTx {
  return { receiverId: s.wrapId, actions: [call('near_withdraw', { amount: amount.toString() }, UNWRAP_GAS, 1n)] };
}

/**
 * A buy of `units` (whole coins), then their deposit into the game: with `swapIn` (the quote's, v1.15) a swap of
 * exactly that for at least `units`; without it a swap of exactly `units` for at most `maxIn`. The play key is not
 * here: the store puts it first when this browser has none.
 */
export function buyTxs(cfg: PublicConfig, accountId: string, q: { maxIn: bigint; units: bigint; swapIn?: bigint }, w: SwapWallet): SwapTx[] {
  const s = cfg.swap;
  if (!s) throw new Error('This relay does not buy coins with NEAR.');
  const out: SwapTx[] = [];
  if (!w.tokenRegistered) out.push({ step: 'coin_storage', tx: storageTx(cfg, accountId, w.storageDeposit.toString()) });
  out.push({ step: 'buy', tx: buySwapTx(s, cfg.tokenId, accountId, q.maxIn, q.units, w, q.swapIn) });
  out.push({ step: 'deposit', tx: depositTx(cfg, q.units) });
  return out;
}

/**
 * A sale of `units` for at least `minOut`: from the game (the withdrawal first, the coin registration before it if
 * needed) or from what the wallet holds; wNEAR left from earlier buys is unwrapped in the same approval.
 */
export function sellTxs(
  cfg: PublicConfig,
  accountId: string,
  q: { units: bigint; minOut: bigint },
  w: Pick<SwapWallet, 'tokenRegistered' | 'storageDeposit' | 'wnear'>,
  from: 'game' | 'wallet',
): SwapTx[] {
  const s = cfg.swap;
  if (!s) throw new Error('This relay does not sell coins for NEAR.');
  const out: SwapTx[] = [];
  if (from === 'game') {
    // the coin pays a withdrawal out only to registered accounts
    if (!w.tokenRegistered) out.push({ step: 'coin_storage', tx: storageTx(cfg, accountId, w.storageDeposit.toString()) });
    out.push({ step: 'withdraw', tx: withdrawTx(cfg, q.units) });
  }
  out.push({ step: 'sell', tx: sellTx(cfg, s, q.units, q.minOut) });
  if (w.wnear > 0n) out.push({ step: 'unwrap', tx: unwrapTx(s, w.wnear) });
  return out;
}

/**
 * NEAR a buy takes from the wallet: the registrations it makes, the NEAR it wraps, and the reserve for gas. Counted
 * with the NEAR offered (`maxIn`), which is at least the swapIn a v1.15 buy wraps: never less than it takes.
 */
export function buyNearNeeded(maxIn: bigint, w: Pick<SwapWallet, 'tokenRegistered' | 'storageDeposit' | 'wrapRegistered' | 'wrapStorage' | 'wnear'>): bigint {
  return (w.tokenRegistered ? 0n : w.storageDeposit) + (w.wrapRegistered ? 0n : w.wrapStorage) + (w.wnear < maxIn ? maxIn - w.wnear : 0n) + NEAR_RESERVE;
}
