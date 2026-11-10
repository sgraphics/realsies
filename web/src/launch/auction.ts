// Depositing into the REAL auction on meme.cooking from realsies.lol, while the platform's own page fails: one
// wallet approval for the batch the platform itself sends (read from a real deposit receipt), in this order:
//   storage_deposit {account_id, registration_only: true}  on meme-cooking.near, 0.02 NEAR    if not registered there
//   storage_deposit {account_id, registration_only: true}  on wrap.near, 0.00125 NEAR         if not registered there
//   near_deposit {}                                         on wrap.near, the amount           unless the wallet holds that much wNEAR
//   ft_transfer_call {receiver_id: meme-cooking.near, amount, msg: {"Deposit":{"meme_id":2313}}} on wrap.near, 1 yoctoNEAR, 100 Tgas
// The account's state comes from a public mainnet RPC (it answers browsers), the auction's from the relay
// (GET /api/auction). Mainnet only, while the auction runs.

import type { AuctionInfo, PublicConfig } from '../../../shared/protocol.ts';
import type { WalletTx } from '../wallet/types.ts';
import { bannerPhase } from './phase.ts';

export const MEME_ID = 2313;
export const MEME_CONTRACT = 'meme-cooking.near';
export const WRAP = 'wrap.near';
export const ONE_NEAR = 10n ** 24n;
/** meme-cooking.near storage_balance_bounds.min */
export const MEME_STORAGE = 20_000_000_000_000_000_000_000n;
/** wrap.near storage_balance_bounds.min */
export const WRAP_STORAGE = 1_250_000_000_000_000_000_000n;
export const MIN_DEPOSIT = ONE_NEAR / 10n;
/** meme.cooking keeps 0.5% of a deposit */
export const FEE_BPS = 50;
/** what the gas of the batch may cost at most, kept free in the wallet */
export const GAS_RESERVE = ONE_NEAR / 100n;
const TGAS = 1_000_000_000_000n;
export const RPC = 'https://rpc.mainnet.fastnear.com';

/** The account as the batch needs it. */
export interface AuctionAccount {
  /** NEAR the account can spend (its balance less what its storage holds), yocto */
  near: bigint;
  memeRegistered: boolean;
  wrapRegistered: boolean;
  /** wNEAR it holds, yocto */
  wnear: bigint;
}

function call(methodName: string, args: object, gas: bigint, deposit: bigint): WalletTx['actions'][number] {
  return { type: 'FunctionCall', params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } };
}

/** The deposit, as one batch of transactions in the order meme.cooking sends them. */
export function auctionDepositTxs(accountId: string, amount: bigint, a: Pick<AuctionAccount, 'memeRegistered' | 'wrapRegistered' | 'wnear'>, memeId = MEME_ID): WalletTx[] {
  const txs: WalletTx[] = [];
  if (!a.memeRegistered) txs.push({ receiverId: MEME_CONTRACT, actions: [call('storage_deposit', { account_id: accountId, registration_only: true }, 30n * TGAS, MEME_STORAGE)] });
  if (!a.wrapRegistered) txs.push({ receiverId: WRAP, actions: [call('storage_deposit', { account_id: accountId, registration_only: true }, 30n * TGAS, WRAP_STORAGE)] });
  if (a.wnear < amount) txs.push({ receiverId: WRAP, actions: [call('near_deposit', {}, 30n * TGAS, amount)] });
  txs.push({
    receiverId: WRAP,
    actions: [call('ft_transfer_call', { receiver_id: MEME_CONTRACT, amount: amount.toString(), msg: JSON.stringify({ Deposit: { meme_id: memeId } }) }, 100n * TGAS, 1n)],
  });
  return txs;
}

/** NEAR the batch takes from the wallet: the storage it registers, the NEAR it wraps, and a little for gas. */
export function nearNeeded(amount: bigint, a: Pick<AuctionAccount, 'memeRegistered' | 'wrapRegistered' | 'wnear'>): bigint {
  return (a.memeRegistered ? 0n : MEME_STORAGE) + (a.wrapRegistered ? 0n : WRAP_STORAGE) + (a.wnear < amount ? amount : 0n) + GAS_RESERVE;
}

// "1.25" -> yocto and yocto -> "1.2345": shared with the coins dialog's buy with NEAR (state/near.ts)
import { fmtNear, parseNear } from '../state/near.ts';
export { fmtNear, parseNear };

/** "Auction: 37.5 of 100 NEAR soft cap, 21 h left" */
export function auctionLine(a: AuctionInfo, now: number): string {
  const left = a.endMs - now;
  const time = left <= 0 ? 'ended' : left >= 3_600_000 ? `${Math.floor(left / 3_600_000)} h left` : `${Math.max(1, Math.ceil(left / 60_000))} min left`;
  return `Auction: ${fmtNear(BigInt(a.totalDeposit), 2)} of ${fmtNear(BigInt(a.softCap), 0)} NEAR soft cap, ${time}`;
}

/** The deposit is offered on mainnet only, while the auction runs. */
export function auctionDepositOn(cfg: PublicConfig | undefined, now: number): boolean {
  return cfg?.network === 'mainnet' && bannerPhase(cfg, now) === 'auction';
}

/** What the dialog reads about the account: a public RPC, or the mock chain in ?mock=1. */
export interface AuctionViews {
  account(accountId: string): Promise<AuctionAccount>;
}

async function rpcQuery<T>(rpc: string, params: Record<string, unknown>): Promise<T> {
  const r = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'realsies', method: 'query', params: { finality: 'final', ...params } }) });
  const j = (await r.json()) as { result?: T & { error?: string }; error?: { message?: string; data?: string } };
  if (j.error || !j.result || j.result.error) throw new Error(j.error?.data ?? j.error?.message ?? j.result?.error ?? 'the NEAR RPC did not answer');
  return j.result;
}

async function rpcView<T>(rpc: string, contract: string, method: string, args: object): Promise<T> {
  const r = await rpcQuery<{ result: number[] }>(rpc, { request_type: 'call_function', account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** Mainnet, from the public RPC. */
export function rpcViews(rpc = RPC): AuctionViews {
  return {
    async account(accountId) {
      const [acct, meme, wrap, wnear] = await Promise.all([
        rpcQuery<{ amount: string; storage_usage: number }>(rpc, { request_type: 'view_account', account_id: accountId }),
        rpcView<unknown>(rpc, MEME_CONTRACT, 'storage_balance_of', { account_id: accountId }),
        rpcView<unknown>(rpc, WRAP, 'storage_balance_of', { account_id: accountId }),
        rpcView<string | null>(rpc, WRAP, 'ft_balance_of', { account_id: accountId }),
      ]);
      // the balance less what the account's own storage holds (1e19 yocto a byte)
      const near = BigInt(acct.amount) - BigInt(acct.storage_usage) * 10n ** 19n;
      return { near: near > 0n ? near : 0n, memeRegistered: meme !== null, wrapRegistered: wrap !== null, wnear: BigInt(wnear ?? '0') };
    },
  };
}
