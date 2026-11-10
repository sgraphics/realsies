// Coins for NEAR and back on Rhea (formerly Ref Finance), protocol v1.12. The relay only reads: the settings (SWAP_*),
// the check that the pool is the game's coin against wrapped NEAR, the pool contract's quotes for GET /api/swap/quote
// (the same question answered from a cache for a few seconds), the price of one coin for PublicConfig.nearPerCoin, and
// the wallet's NEAR and wNEAR for WalletInfo. The browser builds and the wallet sends the swaps (web/src/wallet/swap.ts);
// the testnet proof (tools/swap-proof.ts) quotes with these same functions.
//
// Verified on testnet (dclv2.ref-dev.testnet 2.3.14, .bl0x/topics/near-hackathon/experiments/rhea-pool-rehearsal.md):
// `quote` and `quote_by_output` match real swaps to the unit; an amount the pool cannot fill quotes as "0"; get_pool of
// an unknown pool is null.

import type { SwapQuote, WalletInfo } from '../../shared/protocol.js';

export interface SwapSettings {
  /** the pool contract (Rhea DCL): dclv2.ref-labs.near, dclv2.ref-dev.testnet */
  dex: string;
  /** "<token>|<token>|<fee>" */
  poolId: string;
  /** unset: wrap.near on mainnet, wrap.testnet on testnet */
  wrapId?: string;
  /** room for the price to move between the quote and the swap (100 = 1%) */
  slippageBps: number;
}

/** A refusal with its HTTP status; the game turns it into a GameError. */
export class SwapError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const SWAP_VARS = ['SWAP_DEX', 'SWAP_POOL', 'SWAP_WRAP', 'SWAP_SLIPPAGE_BPS'] as const;
export const DEFAULT_SLIPPAGE_BPS = 100;

/** "<a>|<b>|<fee>" into its parts; throws a readable error for anything else. */
export function parsePoolId(id: string): { a: string; b: string; fee: number } {
  const parts = id.split('|');
  const fee = Number(parts[2]);
  if (parts.length !== 3 || !ACCOUNT_ID.test(parts[0]) || !ACCOUNT_ID.test(parts[1]) || !/^\d{1,6}$/.test(parts[2] ?? '') || !(fee > 0)) {
    throw new Error(`SWAP_POOL must look like <token>|<token>|<fee>, for example real.realsies.testnet|wrap.testnet|2000 (got ${id})`);
  }
  return { a: parts[0], b: parts[1], fee };
}

/** Throws on settings the relay could not use. */
export function checkSwapSettings(s: SwapSettings): void {
  if (!ACCOUNT_ID.test(s.dex)) throw new Error(`SWAP_DEX must be a NEAR account id such as dclv2.ref-labs.near (got ${s.dex})`);
  parsePoolId(s.poolId);
  if (s.wrapId !== undefined && !ACCOUNT_ID.test(s.wrapId)) throw new Error(`SWAP_WRAP must be a NEAR account id such as wrap.near (got ${s.wrapId})`);
  if (!(Number.isInteger(s.slippageBps) && s.slippageBps >= 1 && s.slippageBps <= 2000)) throw new Error('SWAP_SLIPPAGE_BPS must be a whole number from 1 to 2000 (100 = 1%)');
}

/** SWAP_* from the env: undefined when neither SWAP_DEX nor SWAP_POOL is set (then nothing changes anywhere). */
export function swapFromEnv(env: NodeJS.ProcessEnv): SwapSettings | undefined {
  const get = (k: (typeof SWAP_VARS)[number]) => env[k]?.trim() || undefined;
  const dex = get('SWAP_DEX');
  const poolId = get('SWAP_POOL');
  if (!dex && !poolId) return undefined;
  if (!dex || !poolId) throw new Error('SWAP_DEX and SWAP_POOL go together: set both (the pool contract and the pool id) or neither');
  const wrapId = get('SWAP_WRAP');
  const slip = get('SWAP_SLIPPAGE_BPS');
  const s: SwapSettings = { dex, poolId, ...(wrapId ? { wrapId } : {}), slippageBps: slip === undefined ? DEFAULT_SLIPPAGE_BPS : Number(slip) };
  checkSwapSettings(s);
  return s;
}

export function wrapIdOf(s: SwapSettings, network: 'testnet' | 'mainnet'): string {
  return s.wrapId ?? (network === 'mainnet' ? 'wrap.near' : 'wrap.testnet');
}

/** The pool must be the game's coin against wrapped NEAR; the pool contract names the two ids sorted as strings. */
export function checkPoolNames(poolId: string, coin: string, wrap: string): void {
  const p = parsePoolId(poolId);
  const [x, y] = [coin, wrap].sort();
  if (p.a !== x || p.b !== y) {
    throw new Error(`SWAP_POOL ${poolId} is not a pool of the game's coin ${coin} against ${wrap}: it must be ${x}|${y}|<fee>`);
  }
}

/** A read-only call on a contract: the parsed JSON (null when the method returns nothing). */
export type ViewFn = <T = unknown>(contractId: string, method: string, args: Record<string, unknown>) => Promise<T>;

/** What a quote needs to know about the pool and the coin. */
export interface SwapPool {
  dex: string;
  poolId: string;
  wrapId: string;
  coin: string;
  /** coin base units per coin */
  coinUnit: bigint;
  slippageBps: number;
}

const BPS = 10_000n;
/** a buy asked by coins is rounded up to this much NEAR (0.001), so the amount reads well */
const NEAR_STEP = 10n ** 21n;
export const ONE_NEAR = 10n ** 24n;
/** the smallest and largest buy the quote answers: 0.001 to 10,000 NEAR */
export const MIN_BUY = NEAR_STEP;
export const MAX_BUY = 10_000n * ONE_NEAR;
export const MAX_COINS = 10_000_000;

const less = (v: bigint, bps: number) => (v * (BPS - BigInt(bps))) / BPS;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

async function amountOf(view: ViewFn, p: SwapPool, method: 'quote' | 'quote_by_output', input: string, output: string, amount: bigint): Promise<bigint> {
  if (amount <= 0n) return 0n;
  const args = method === 'quote' ? { input_amount: amount.toString() } : { output_amount: amount.toString() };
  const r = await view<{ amount?: string } | null>(p.dex, method, { pool_ids: [p.poolId], input_token: input, output_token: output, ...args, tag: 'realsies' });
  return BigInt(r?.amount ?? '0');
}

/**
 * What `near` buys: the coins it surely covers are those that `near` less the slippage allowance buys now, rounded
 * down to whole coins. The buy asks for exactly those (SwapByOutput) and offers all of `near`, so a price that moves
 * by up to the allowance still fills it, and the deposit that follows moves exactly what was bought.
 */
export async function quoteBuy(view: ViewFn, p: SwapPool, near: bigint): Promise<SwapQuote> {
  const [amountOut, covered] = await Promise.all([
    amountOf(view, p, 'quote', p.wrapId, p.coin, near),
    amountOf(view, p, 'quote', p.wrapId, p.coin, less(near, p.slippageBps)),
  ]);
  const coins = covered / p.coinUnit;
  const coinUnits = coins * p.coinUnit;
  const cost = coins > 0n ? await amountOf(view, p, 'quote_by_output', p.wrapId, p.coin, coinUnits) : 0n;
  // the pool cannot fill that many (quote_by_output says 0), or the last of them cost more than offered (the top of
  // the range): the swap could only fail
  if (coins > 0n && (cost === 0n || cost > near)) throw new SwapError('swap_too_big', 'that is more coins than are on offer right now; try a smaller amount', 400);
  return {
    side: 'buy', amountIn: near.toString(), amountOut: amountOut.toString(), minOut: less(amountOut, p.slippageBps).toString(),
    coins: Number(coins), coinUnits: coinUnits.toString(), cost: cost.toString(), slippageBps: p.slippageBps,
  };
}

/** The NEAR that surely buys `coins` (their cost plus the slippage allowance, up to the next 0.001 NEAR), and its quote. */
export async function quoteBuyCoins(view: ViewFn, p: SwapPool, coins: number): Promise<SwapQuote> {
  const cost = await amountOf(view, p, 'quote_by_output', p.wrapId, p.coin, BigInt(coins) * p.coinUnit);
  if (cost === 0n) throw new SwapError('swap_too_big', 'that is more coins than are on offer right now; try fewer', 400);
  let near = ceilDiv(ceilDiv(cost * BPS, BPS - BigInt(p.slippageBps)), NEAR_STEP) * NEAR_STEP;
  let q = await quoteBuy(view, p, near);
  // rounding can leave it a hair short of the last coin: one more step
  if ((q.coins ?? 0) < coins) q = await quoteBuy(view, p, (near += NEAR_STEP));
  return q;
}

/** What `units` of the coin sell for, and the least the sale may take (min_output_amount). */
export async function quoteSell(view: ViewFn, p: SwapPool, units: bigint): Promise<SwapQuote> {
  const out = await amountOf(view, p, 'quote', p.coin, p.wrapId, units);
  if (out === 0n) throw new SwapError('swap_too_big', 'that is more coins than can be sold right now; try fewer', 400);
  return { side: 'sell', amountIn: units.toString(), amountOut: out.toString(), minOut: less(out, p.slippageBps).toString(), slippageBps: p.slippageBps };
}

/**
 * NEAR per coin at the pool's current point. 1.0001^point is the price of token_y in token_x, both in base units
 * (yocto wNEAR per coin base unit when the coin is token_x). Null when the pool does not exist.
 */
export async function nearPerCoin(view: ViewFn, p: SwapPool): Promise<number | null> {
  const pool = await view<{ token_x?: string; token_y?: string; current_point?: number } | null>(p.dex, 'get_pool', { pool_id: p.poolId });
  if (!pool || typeof pool.current_point !== 'number') return null;
  const raw = Math.pow(1.0001, pool.current_point);
  const yoctoPerUnit = pool.token_x === p.coin ? raw : 1 / raw;
  const near = (yoctoPerUnit * Number(p.coinUnit)) / 1e24;
  return Number.isFinite(near) && near > 0 ? Number(near.toPrecision(6)) : null;
}

/** GET /api/swap/quote's query as a question; SwapError invalid_request for anything that is not a sane amount. */
export type QuoteAsk = { side: 'buy'; near: bigint } | { side: 'buy'; coins: number } | { side: 'sell'; units: bigint };

export function parseQuoteAsk(q: URLSearchParams, coinUnit: bigint): QuoteAsk {
  const bad = (m: string) => new SwapError('invalid_request', m, 400);
  const side = q.get('side');
  if (side === 'buy') {
    const near = q.get('near');
    const coins = q.get('coins');
    if ((near === null) === (coins === null)) throw bad('a buy is asked with near=<yoctoNEAR> or coins=<n>, one of them');
    if (near !== null) {
      if (!/^\d{1,31}$/.test(near)) throw bad('near: a whole number of yoctoNEAR');
      const n = BigInt(near);
      if (n < MIN_BUY || n > MAX_BUY) throw bad('near: from 0.001 to 10000 NEAR (in yoctoNEAR)');
      return { side: 'buy', near: n };
    }
    const c = Number(coins);
    if (!/^\d{1,8}$/.test(coins!) || !(c >= 1 && c <= MAX_COINS)) throw bad(`coins: a whole number from 1 to ${MAX_COINS}`);
    return { side: 'buy', coins: c };
  }
  if (side === 'sell') {
    const units = q.get('units');
    if (units === null || !/^\d{1,40}$/.test(units)) throw bad('a sale is asked with units=<coin base units>');
    const u = BigInt(units);
    if (u < 1n || u > BigInt(MAX_COINS) * coinUnit) throw bad(`units: more than 0 and at most ${MAX_COINS} coins`);
    return { side: 'sell', units: u };
  }
  throw bad('side must be buy or sell');
}

/**
 * The relay's quotes: the same question within `ttlMs` is answered once (the quick amounts in the dialog, several
 * tabs), a failed read is not kept. The price is read at most once a minute.
 */
export class SwapQuotes {
  private cache = new Map<string, { at: number; q: Promise<SwapQuote> }>();
  private price: { at: number; v: Promise<number | null> } | null = null;

  constructor(
    private view: ViewFn,
    readonly pool: SwapPool,
    private opts: { ttlMs?: number; priceMs?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  quote(ask: QuoteAsk): Promise<SwapQuote> {
    const key = ask.side === 'sell' ? `sell:${ask.units}` : 'near' in ask ? `buy:${ask.near}` : `coins:${ask.coins}`;
    const t = this.now();
    const hit = this.cache.get(key);
    if (hit && t - hit.at < (this.opts.ttlMs ?? 5000)) return hit.q;
    if (this.cache.size > 500) for (const [k, v] of this.cache) if (t - v.at >= (this.opts.ttlMs ?? 5000)) this.cache.delete(k);
    const q =
      ask.side === 'sell' ? quoteSell(this.view, this.pool, ask.units) : 'near' in ask ? quoteBuy(this.view, this.pool, ask.near) : quoteBuyCoins(this.view, this.pool, ask.coins);
    this.cache.set(key, { at: t, q });
    q.catch(() => {
      if (this.cache.get(key)?.q === q) this.cache.delete(key);
    });
    return q;
  }

  /** NEAR per coin, read at most once per `priceMs` (default a minute); null when unreadable. */
  nearPerCoin(): Promise<number | null> {
    const t = this.now();
    if (this.price && t - this.price.at < (this.opts.priceMs ?? 60_000)) return this.price.v;
    const v = nearPerCoin(this.view, this.pool).catch(() => null);
    this.price = { at: t, v };
    return v;
  }
}

/** The wallet's side of a buy for WalletInfo: NEAR it can spend, its wrap registration and wNEAR. */
export async function swapWallet(
  view: ViewFn,
  nearBalance: (account: string) => Promise<bigint>,
  wrapId: string,
  account: string,
): Promise<Pick<WalletInfo, 'nearBalance' | 'wrapRegistered' | 'wnearBalance' | 'wrapStorageDeposit'>> {
  const [near, reg, wnear, bounds] = await Promise.all([
    nearBalance(account).catch(() => null),
    view<unknown>(wrapId, 'storage_balance_of', { account_id: account }).then((v) => v !== null && v !== undefined, () => null),
    view<string | null>(wrapId, 'ft_balance_of', { account_id: account }).then((v) => BigInt(v ?? '0'), () => null),
    wrapBounds(view, wrapId),
  ]);
  return {
    ...(near !== null ? { nearBalance: near.toString() } : {}),
    ...(reg !== null ? { wrapRegistered: reg } : {}),
    ...(wnear !== null ? { wnearBalance: wnear.toString() } : {}),
    wrapStorageDeposit: bounds,
  };
}

const boundsCache = new Map<string, string>();
/** wrap.near and wrap.testnet ask 0.00125 NEAR; read once per wrap contract */
async function wrapBounds(view: ViewFn, wrapId: string): Promise<string> {
  const hit = boundsCache.get(wrapId);
  if (hit) return hit;
  const b = await view<{ min?: string } | null>(wrapId, 'storage_balance_bounds', {}).catch(() => null);
  if (b?.min && /^\d+$/.test(b.min)) {
    boundsCache.set(wrapId, b.min);
    return b.min;
  }
  return '1250000000000000000000';
}
