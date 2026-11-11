// Coins for NEAR on Rhea (protocol v1.12): the SWAP_* settings and their checks, the pool id against the game's coin and
// the wrap contract, the quote math against a stubbed pool contract (whole coins after the slippage allowance, what the
// exact-input swap sends (v1.15 swapIn: their cost plus the allowance, never more than offered, all of it when that is
// short by rounding), the NEAR that surely buys n coins, a sale's minimum), the cache and the refusals, the price from
// the pool's point, and
// in-process relays: PublicConfig.swap and nearPerCoin, GET /api/swap/quote, the wallet's NEAR in WalletInfo, nothing
// without the settings, a wrong pool stopping the relay, and swap turning on when coins open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthChallenge, PublicConfig, SwapQuote, WalletInfo } from '../../shared/protocol.js';
import { loadConfig } from '../src/config.js';
import { createApp, type App } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import {
  SWAP_VARS, SwapError, SwapQuotes, checkPoolNames, nearPerCoin, parseQuoteAsk, quoteBuy, quoteBuyCoins, quoteSell, swapFromEnv, wrapIdOf,
  type SwapPool, type ViewFn,
} from '../src/swap.js';
import { newKey, signChallenge } from './wallet-helpers.js';

const NEAR = 10n ** 24n;
const UNIT = 10n ** 18n;
const POOL = 'real.realsies.testnet|wrap.testnet|2000';
const DEX = 'dclv2.ref-dev.testnet';
const P: SwapPool = { dex: DEX, poolId: POOL, wrapId: 'wrap.testnet', coin: 'real.realsies.testnet', coinUnit: UNIT, slippageBps: 100 };

/** A pool contract at 400 coins per NEAR with no fee: every view call is counted. */
function stubView(opts: { cap?: bigint } = {}) {
  const calls: { method: string; args: any }[] = [];
  const view: ViewFn = async <T,>(contract: string, method: string, args: Record<string, unknown>): Promise<T> => {
    calls.push({ method, args });
    assert.equal(contract, DEX);
    if (method === 'get_pool') return { pool_id: POOL, token_x: 'real.realsies.testnet', token_y: 'wrap.testnet', current_point: 78244 } as T;
    assert.deepEqual(args.pool_ids, [POOL]);
    const buy = args.input_token === 'wrap.testnet';
    if (method === 'quote') {
      const i = BigInt(String(args.input_amount));
      let out = buy ? (i * 400n * UNIT) / NEAR : (i * NEAR) / (400n * UNIT);
      if (opts.cap !== undefined && buy && out > opts.cap) out = opts.cap;
      return { amount: out.toString(), tag: args.tag } as T;
    }
    const o = BigInt(String(args.output_amount));
    if (opts.cap !== undefined && o > opts.cap) return { amount: '0', tag: args.tag } as T;
    return { amount: ((o * NEAR + 400n * UNIT - 1n) / (400n * UNIT)).toString(), tag: args.tag } as T;
  };
  return { view, calls };
}

test('SWAP_* settings: both or neither, a pool id of <token>|<token>|<fee>, the wrap contract by network, slippage 1 to 2000', () => {
  assert.equal(swapFromEnv({}), undefined, 'nothing set: no swap');
  assert.equal(swapFromEnv({ SWAP_DEX: ' ', SWAP_POOL: '' }), undefined, 'empty counts as unset');
  assert.throws(() => swapFromEnv({ SWAP_DEX: DEX }), /SWAP_DEX and SWAP_POOL go together/);
  assert.throws(() => swapFromEnv({ SWAP_POOL: POOL }), /SWAP_DEX and SWAP_POOL go together/);
  assert.deepEqual(swapFromEnv({ SWAP_DEX: DEX, SWAP_POOL: POOL }), { dex: DEX, poolId: POOL, slippageBps: 100 }, 'slippage defaults to 1%');
  assert.deepEqual(swapFromEnv({ SWAP_DEX: DEX, SWAP_POOL: POOL, SWAP_WRAP: 'wrap.testnet', SWAP_SLIPPAGE_BPS: '50' }), { dex: DEX, poolId: POOL, wrapId: 'wrap.testnet', slippageBps: 50 });
  for (const bad of ['real.realsies.testnet|wrap.testnet', 'real.realsies.testnet|wrap.testnet|x', 'Real|wrap.testnet|2000', 'a|b|c|d', 'real.realsies.testnet,wrap.testnet,2000'])
    assert.throws(() => swapFromEnv({ SWAP_DEX: DEX, SWAP_POOL: bad }), /SWAP_POOL must look like <token>\|<token>\|<fee>/, bad);
  assert.throws(() => swapFromEnv({ SWAP_DEX: 'https://rhea.finance', SWAP_POOL: POOL }), /SWAP_DEX must be a NEAR account id/);
  assert.throws(() => swapFromEnv({ SWAP_DEX: DEX, SWAP_POOL: POOL, SWAP_WRAP: 'wrap near' }), /SWAP_WRAP must be a NEAR account id/);
  for (const bad of ['0', '2001', '1.5', 'one', '-5'])
    assert.throws(() => swapFromEnv({ SWAP_DEX: DEX, SWAP_POOL: POOL, SWAP_SLIPPAGE_BPS: bad }), /SWAP_SLIPPAGE_BPS must be a whole number from 1 to 2000/, bad);
  assert.equal(wrapIdOf({ dex: DEX, poolId: POOL, slippageBps: 100 }, 'mainnet'), 'wrap.near');
  assert.equal(wrapIdOf({ dex: DEX, poolId: POOL, slippageBps: 100 }, 'testnet'), 'wrap.testnet');
  assert.equal(wrapIdOf({ dex: DEX, poolId: POOL, wrapId: 'w.example.testnet', slippageBps: 100 }, 'testnet'), 'w.example.testnet');
  assert.deepEqual([...SWAP_VARS], ['SWAP_DEX', 'SWAP_POOL', 'SWAP_WRAP', 'SWAP_SLIPPAGE_BPS']);
});

test('the pool id must name the game\'s coin and the wrap contract, sorted as the pool contract sorts them', () => {
  checkPoolNames(POOL, 'real.realsies.testnet', 'wrap.testnet');
  checkPoolNames('real.near|wrap.near|10000', 'real.near', 'wrap.near');
  checkPoolNames('wrap.near|zz.near|2000', 'zz.near', 'wrap.near');
  assert.throws(() => checkPoolNames('wrap.testnet|real.realsies.testnet|2000', 'real.realsies.testnet', 'wrap.testnet'), /must be real\.realsies\.testnet\|wrap\.testnet\|<fee>/);
  assert.throws(() => checkPoolNames('trh.rhea-try-891ea1.testnet|wrap.testnet|2000', 'real.realsies.testnet', 'wrap.testnet'), /is not a pool of the game's coin real\.realsies\.testnet against wrap\.testnet/);
  assert.throws(() => checkPoolNames('real.realsies.testnet|wrap.near|2000', 'real.realsies.testnet', 'wrap.testnet'), /against wrap\.testnet/);
});

test('loadConfig reads SWAP_* and refuses a bad one at boot', () => {
  const saved = Object.fromEntries(SWAP_VARS.map((k) => [k, process.env[k]]));
  try {
    for (const k of SWAP_VARS) delete process.env[k];
    assert.ok(!('swap' in loadConfig({})), 'nothing set: no swap');
    process.env.SWAP_DEX = DEX;
    process.env.SWAP_POOL = POOL;
    assert.deepEqual(loadConfig({}).swap, { dex: DEX, poolId: POOL, slippageBps: 100 });
    assert.equal(loadConfig({ swap: undefined }).swap, undefined, 'an override wins over the env');
    delete process.env.SWAP_POOL;
    assert.throws(() => loadConfig({}), /SWAP_DEX and SWAP_POOL go together/);
  } finally {
    for (const k of SWAP_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('quotes: a buy gets the whole coins its NEAR less the allowance covers; by coins, the NEAR that surely buys them; a sale its minimum', async () => {
  const { view, calls } = stubView();
  // 0.25 NEAR at 400 coins per NEAR: 100 coins; less 1% the quote is 99 coins: exactly 99 are bought, for 0.2475 NEAR
  // the swap sends their cost plus the allowance, 0.2475 / 0.99: exactly the 0.25 NEAR offered, which surely buys them
  const b = await quoteBuy(view, P, NEAR / 4n);
  assert.deepEqual(b, {
    side: 'buy', amountIn: (NEAR / 4n).toString(), amountOut: (100n * UNIT).toString(), minOut: (99n * UNIT).toString(),
    coins: 99, coinUnits: (99n * UNIT).toString(), cost: ((99n * NEAR) / 400n).toString(), swapIn: (NEAR / 4n).toString(), slippageBps: 100,
  });
  assert.deepEqual(calls.map((c) => c.method).sort(), ['quote', 'quote', 'quote_by_output'], 'swapIn is all of the NEAR offered: nothing more to ask');
  assert.equal(calls.find((c) => c.method === 'quote_by_output')!.args.output_amount, (99n * UNIT).toString(), 'the cost of exactly those coins');
  assert.equal(calls[0].args.input_token, 'wrap.testnet');
  assert.equal(calls[0].args.output_token, 'real.realsies.testnet');
  // a fraction of a coin is never promised; the swap sends the coin's cost plus 1%, less than offered, asked first
  calls.length = 0;
  const odd = await quoteBuy(view, P, (NEAR * 3n) / 1000n);
  assert.equal(odd.coins, 1, '0.003 NEAR: 1.2 coins, 1.188 after the allowance: 1 coin');
  assert.equal(odd.cost, (NEAR / 400n).toString());
  assert.equal(odd.swapIn, (((NEAR / 400n) * 10_000n + 9_899n) / 9_900n).toString(), 'swapIn: 0.0025 NEAR / 0.99, rounded up');
  assert.equal(calls.length, 4, 'one more view: what swapIn buys');
  assert.deepEqual(calls[3], { method: 'quote', args: { pool_ids: [POOL], input_token: 'wrap.testnet', output_token: 'real.realsies.testnet', input_amount: odd.swapIn, tag: 'realsies' } });
  const none = await quoteBuy(view, P, NEAR / 1000n);
  assert.equal(none.coins, 0, '0.001 NEAR: under one coin after the allowance');
  assert.ok(!('swapIn' in none), 'no coin: no swapIn');
  // swapIn never more than offered, and it always buys the coins at the price quoted
  for (const n of [1001n, 2_500n, 7_777n, 25_000n, 123_456n, 999_999n]) {
    const near = n * 10n ** 18n;
    const r = await quoteBuy(view, P, near);
    if (!r.coins) continue;
    const sIn = BigInt(r.swapIn!);
    const out = BigInt((await view<{ amount: string }>(DEX, 'quote', { pool_ids: [POOL], input_token: 'wrap.testnet', output_token: 'real.realsies.testnet', input_amount: sIn.toString() })).amount);
    assert.ok(sIn <= near && sIn >= BigInt(r.cost!) && out >= BigInt(r.coinUnits!), `${near} yocto: swapIn ${sIn}, buys ${out} >= ${r.coinUnits}`);
  }
  // rounding leaves swapIn a hair short of the coins: all of the NEAR offered instead
  const short: ViewFn = async <T,>(c: string, m: string, a: Record<string, unknown>) =>
    (m === 'quote' && a.input_amount === odd.swapIn ? { amount: (UNIT - 1n).toString() } : await stubView().view<T>(c, m, a)) as T;
  assert.equal((await quoteBuy(short, P, (NEAR * 3n) / 1000n)).swapIn, ((NEAR * 3n) / 1000n).toString(), 'short by one unit: swapIn is the 0.003 NEAR offered');
  // their cost with the allowance would be more than offered (the cost a hair under it): swapIn is what was offered
  const dear: ViewFn = async <T,>(c: string, m: string, a: Record<string, unknown>) =>
    (m === 'quote_by_output' ? { amount: ((NEAR * 3n) / 1000n - 1n).toString() } : await stubView().view<T>(c, m, a)) as T;
  const capd = await quoteBuy(dear, P, (NEAR * 3n) / 1000n);
  assert.equal(capd.swapIn, ((NEAR * 3n) / 1000n).toString(), 'never more than the NEAR offered');
  // asked by coins: 50 coins cost 0.125 NEAR; with the allowance 0.12626..., rounded up to 0.127 NEAR, which buys 50
  const c = await quoteBuyCoins(view, P, 50);
  assert.equal(c.amountIn, ((127n * NEAR) / 1000n).toString());
  assert.ok(c.coins! >= 50, `${c.coins} coins`);
  assert.ok(c.swapIn && BigInt(c.swapIn) <= BigInt(c.amountIn) && BigInt(c.swapIn) === (BigInt(c.cost!) * 10_000n + 9_899n) / 9_900n, `by coins too: swapIn ${c.swapIn}, the cost plus 1%`);
  for (const n of [1, 7, 10, 25, 99, 250, 500]) assert.ok((await quoteBuyCoins(view, P, n)).coins! >= n, `${n} coins: the amount buys at least that many`);
  // a sale: 10 coins for 0.025 NEAR, at least 0.02475 after the allowance
  const s = await quoteSell(view, P, 10n * UNIT);
  assert.deepEqual(s, { side: 'sell', amountIn: (10n * UNIT).toString(), amountOut: (NEAR / 40n).toString(), minOut: ((NEAR / 40n) * 99n / 100n).toString(), slippageBps: 100 });
  // only 1000 coins on offer: a big buy gets them all (the rest of the NEAR comes back); more by coins quotes 0: refused
  const capped = stubView({ cap: 1000n * UNIT });
  assert.equal((await quoteBuy(capped.view, P, 100n * NEAR)).coins, 1000);
  await assert.rejects(quoteBuyCoins(capped.view, P, 2000), (e: any) => e instanceof SwapError && e.code === 'swap_too_big');
  // the last coins cost more than offered (the top of the range): refused rather than sent to fail
  const steep: ViewFn = async <T,>(c: string, m: string, a: Record<string, unknown>) =>
    (m === 'quote_by_output' ? { amount: (1000n * NEAR).toString() } : await stubView().view<T>(c, m, a)) as T;
  await assert.rejects(quoteBuy(steep, P, NEAR), (e: any) => e instanceof SwapError && e.code === 'swap_too_big');
  const empty: ViewFn = async <T,>() => ({ amount: '0' }) as T;
  await assert.rejects(quoteSell(empty, P, 10n * UNIT), (e: any) => e instanceof SwapError && e.code === 'swap_too_big');
});

test('the price of a coin from the pool\'s point, whichever side the coin is on', async () => {
  const { view } = stubView();
  const p = await nearPerCoin(view, P);
  assert.ok(p !== null && Math.abs(p - 0.0025) < 0.0000025, `${p} NEAR per coin at point 78244`);
  // the coin as token_y: the price turns over
  const flipped: ViewFn = async <T,>() => ({ token_x: 'wrap.testnet', token_y: 'zz.testnet', current_point: -78244 }) as T;
  const q = await nearPerCoin(flipped, { ...P, coin: 'zz.testnet' });
  assert.ok(q !== null && Math.abs(q - 0.0025) < 0.0000025, `${q}`);
  assert.equal(await nearPerCoin(async <T,>() => null as T, P), null, 'no such pool: no price');
});

test('the quote cache: the same question within a few seconds is asked once, a failure is not kept; nonsense is refused', async () => {
  const { view, calls } = stubView();
  let t = 1_000_000;
  const q = new SwapQuotes(view, P, { now: () => t });
  const a = await q.quote({ side: 'buy', near: NEAR / 4n });
  const b = await q.quote({ side: 'buy', near: NEAR / 4n });
  assert.deepEqual(a, b);
  assert.equal(calls.length, 3, 'one buy quote is three views, asked once');
  t += 4000;
  await q.quote({ side: 'buy', near: NEAR / 4n });
  assert.equal(calls.length, 3, 'still cached after 4 s');
  t += 2000;
  await q.quote({ side: 'buy', near: NEAR / 4n });
  assert.equal(calls.length, 6, 'asked again after 5 s');
  await q.quote({ side: 'sell', units: 10n * UNIT });
  await q.quote({ side: 'sell', units: 10n * UNIT });
  assert.equal(calls.length, 7, 'a sale is one view, cached too');
  let fail = true;
  const flaky = new SwapQuotes(async <T,>(c: string, m: string, a: Record<string, unknown>) => {
    if (fail) throw new Error('rpc down');
    return view<T>(c, m, a);
  }, P, { now: () => t });
  await assert.rejects(flaky.quote({ side: 'sell', units: UNIT }), /rpc down/);
  fail = false;
  assert.equal((await flaky.quote({ side: 'sell', units: UNIT })).side, 'sell', 'a failed read is not kept');
  // the price: once a minute
  const n0 = calls.length;
  await q.nearPerCoin();
  await q.nearPerCoin();
  assert.equal(calls.length, n0 + 1);
  t += 61_000;
  await q.nearPerCoin();
  assert.equal(calls.length, n0 + 2);

  const ask = (s: string) => parseQuoteAsk(new URLSearchParams(s), UNIT);
  assert.deepEqual(ask('side=buy&near=250000000000000000000000'), { side: 'buy', near: NEAR / 4n });
  assert.deepEqual(ask('side=buy&coins=50'), { side: 'buy', coins: 50 });
  assert.deepEqual(ask('side=sell&units=10000000000000000000'), { side: 'sell', units: 10n * UNIT });
  for (const bad of [
    '', 'side=swap&near=1', 'side=buy', 'side=buy&near=1000&coins=5', 'side=buy&near=-5', 'side=buy&near=0.25', 'side=buy&near=999', 'side=buy&near=10000000000000000000000000001',
    'side=buy&near=abc', 'side=buy&coins=0', 'side=buy&coins=2.5', 'side=buy&coins=99999999', 'side=sell', 'side=sell&units=0', 'side=sell&units=1e18', 'side=sell&units=' + '9'.repeat(40),
  ])
    assert.throws(() => ask(bad), (e: any) => e instanceof SwapError && e.code === 'invalid_request' && e.status === 400, bad);
});

// ---------- in-process relays ----------

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-swap-')), 'relay.db');
}

async function startApp(extra: Record<string, unknown>, chain: MockChain): Promise<App> {
  return createApp(
    {
      port: 0, dbPath: tmpDb(), chain: 'mock', nearAi: 'mock', countdownSeconds: 0, botTimeScale: 0.05, logLevel: 'warn', idleMinutes: 0, pruneDelaySeconds: 3600,
      webDist: path.join(os.tmpdir(), 'no-web-dist'), swap: undefined, ...extra,
    },
    { chain },
  );
}

async function api(base: string, p: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) };
  const r = await fetch(base + p, { ...init, headers });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t };
  }
}

async function signIn(base: string, chain: MockChain, accountId: string): Promise<string> {
  const key = newKey();
  chain.addKey(accountId, key.publicKey, 'FullAccess');
  const ch = (await api(base, '/api/auth/challenge', { method: 'POST', body: '{}' })).body as AuthChallenge;
  const r = await api(base, '/api/auth/verify', { method: 'POST', body: JSON.stringify(signChallenge(ch, accountId, key)) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token as string;
}

/** The mock chain with its pool contract's views counted. */
class CountingChain extends MockChain {
  dexCalls = 0;
  override async view<T = unknown>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
    if (contractId === this.dexId) this.dexCalls++;
    return super.view<T>(contractId, method, args);
  }
}

const SWAP = { dex: 'dclv2.ref-dev.testnet', poolId: POOL, slippageBps: 100 };

test('a relay with SWAP_*: swap and nearPerCoin in the config, quotes over HTTP (cached, nonsense refused), the wallet\'s NEAR in WalletInfo', async () => {
  const chain = new CountingChain();
  chain.txLatencyMs = 0;
  const app = await startApp({ swap: SWAP }, chain);
  const base = `http://localhost:${app.port}`;
  try {
    const cfg = (await api(base, '/api/config')).body as PublicConfig;
    assert.deepEqual(cfg.swap, { dex: 'dclv2.ref-dev.testnet', poolId: POOL, wrapId: 'wrap.testnet', slippageBps: 100 }, 'wrap.testnet by default on testnet');
    assert.ok(cfg.nearPerCoin && Math.abs(cfg.nearPerCoin - 0.0025) < 0.0000025, `nearPerCoin ${cfg.nearPerCoin}`);

    // 0.25 NEAR: 0.2475 after the allowance, 0.247005 after the mock pool's 0.2% fee: 98.8 coins, so 98
    const q = await api(base, '/api/swap/quote?side=buy&near=250000000000000000000000');
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const buy = q.body as SwapQuote;
    assert.equal(buy.coins, 98);
    assert.equal(buy.coinUnits, (98n * UNIT).toString());
    assert.ok(BigInt(buy.cost!) <= (NEAR * 2475n) / 10000n && BigInt(buy.cost!) > 0n, `cost ${buy.cost}`);
    assert.ok(BigInt(buy.swapIn!) > BigInt(buy.cost!) && BigInt(buy.swapIn!) <= NEAR / 4n, `swapIn ${buy.swapIn}: the cost and the allowance, within the NEAR offered`);
    assert.equal(BigInt(buy.minOut), (BigInt(buy.amountOut) * 99n) / 100n);
    const n = chain.dexCalls;
    assert.deepEqual((await api(base, '/api/swap/quote?side=buy&near=250000000000000000000000')).body, buy);
    assert.equal(chain.dexCalls, n, 'the same question again: from the cache');
    const byCoins = (await api(base, '/api/swap/quote?side=buy&coins=25')).body as SwapQuote;
    assert.ok(byCoins.coins! >= 25 && BigInt(byCoins.amountIn) % 10n ** 21n === 0n, `25 coins: ${byCoins.amountIn} yocto buys ${byCoins.coins}`);
    const sell = (await api(base, '/api/swap/quote?side=sell&units=40000000000000000000')).body as SwapQuote;
    assert.equal(sell.side, 'sell');
    assert.ok(BigInt(sell.amountOut) > 0n && BigInt(sell.minOut) < BigInt(sell.amountOut));
    for (const bad of ['side=buy&near=-1', 'side=buy&near=12abc', 'side=sell&units=0', 'side=buy', 'side=steal&near=1000000000000000000000']) {
      const r = await api(base, '/api/swap/quote?' + bad);
      assert.equal(r.status, 400, bad);
      assert.equal(r.body.code, 'invalid_request', bad);
    }

    // the wallet's side: NEAR it can spend, the wrap registration and wNEAR, besides the coin
    const token = await signIn(base, chain, 'buyer.testnet');
    chain.setSwapAccount('buyer.testnet', { near: 3n * NEAR });
    let w = (await api(base, '/api/session/wallet', { token })).body as WalletInfo;
    assert.equal(w.nearBalance, (3n * NEAR).toString());
    assert.equal(w.wrapRegistered, false);
    assert.equal(w.wnearBalance, '0');
    assert.equal(w.wrapStorageDeposit, '1250000000000000000000');
    assert.equal(w.walletBalance, '0');
    chain.setSwapAccount('buyer.testnet', { wnear: NEAR / 100n, wrapRegistered: true });
    w = (await api(base, '/api/session/wallet', { token })).body as WalletInfo;
    assert.equal(w.wrapRegistered, true);
    assert.equal(w.wnearBalance, (NEAR / 100n).toString(), 'wNEAR left from an earlier buy');
  } finally {
    await app.close();
  }
});

test('without SWAP_* nothing changes; coins not open yet: swap waits and turns on when they open; a wrong pool stops the relay', async () => {
  // no settings: no swap, no price, no quotes, no NEAR in WalletInfo
  const plain = new MockChain();
  plain.txLatencyMs = 0;
  let app = await startApp({}, plain);
  let base = `http://localhost:${app.port}`;
  try {
    const cfg = (await api(base, '/api/config')).body as PublicConfig;
    assert.ok(!('swap' in cfg) && !('nearPerCoin' in cfg), 'no swap in the config');
    const q = await api(base, '/api/swap/quote?side=buy&near=250000000000000000000000');
    assert.equal(q.status, 404);
    assert.equal(q.body.code, 'swap_off');
    const token = await signIn(base, plain, 'plain.testnet');
    const w = (await api(base, '/api/session/wallet', { token })).body as WalletInfo;
    assert.deepEqual(Object.keys(w).sort(), ['accountId', 'coinsOpen', 'storageDeposit', 'tokenId', 'tokenRegistered', 'walletBalance'], 'WalletInfo as before');
  } finally {
    await app.close();
  }

  // mainnet before the coin: the pool waits; when the coin is set, swap appears without a restart
  const before = new MockChain();
  before.txLatencyMs = 0;
  before.coinsOpen = false;
  app = await startApp({ swap: SWAP }, before);
  base = `http://localhost:${app.port}`;
  try {
    assert.ok(!('swap' in (await api(base, '/api/config')).body), 'no coin yet: no swap');
    assert.equal((await api(base, '/api/swap/quote?side=sell&units=1')).body.code, 'swap_off');
    before.coinsOpen = true;
    await app.game.refreshChainConfig();
    const cfg = (await api(base, '/api/config')).body as PublicConfig;
    assert.equal(cfg.swap?.poolId, POOL, 'coins open: swap on');
    assert.ok(cfg.nearPerCoin! > 0);
    assert.equal((await api(base, '/api/swap/quote?side=sell&units=1000000000000000000')).status, 200);
  } finally {
    await app.close();
  }

  // a pool of another token, or one the pool contract does not have: the relay does not start, and says why
  await assert.rejects(
    startApp({ swap: { ...SWAP, poolId: 'trh.rhea-try-891ea1.testnet|wrap.testnet|2000' } }, new MockChain()),
    /SWAP_POOL trh\.rhea-try-891ea1\.testnet\|wrap\.testnet\|2000 is not a pool of the game's coin real\.realsies\.testnet against wrap\.testnet/,
  );
  await assert.rejects(startApp({ swap: { ...SWAP, poolId: 'real.realsies.testnet|wrap.testnet|400' } }, new MockChain()), /does not exist on dclv2\.ref-dev\.testnet/);
  await assert.rejects(startApp({ swap: { ...SWAP, wrapId: 'wrap.near' } }, new MockChain()), /against wrap\.near/);
});
