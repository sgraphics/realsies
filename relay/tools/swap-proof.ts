// Proof on real testnet contracts, without a browser, of coins for NEAR and back on Rhea (protocol v1.12): the very
// transactions the web builds (web/src/wallet/swap.ts and batch.ts, loaded as they are), quoted with the relay's own
// code (src/swap.ts), sent from a throwaway account in the order a wallet sends them, one at a time, each waited for.
// Then the balances are checked where they live: the wallet's coin and NEAR and wNEAR, the game contract's balance_of.
//   1. buy with NEAR_IN (0.25) NEAR: the coin registration and the wrap transaction (register, wrap, SwapByOutput) as
//      needed, then the deposit into the game: the game balance rose by exactly the coins the quote promised
//   2. withdraw them from the game and sell them (Swap, skip_unwrap_near false), unwrapping the wNEAR left over from
//      the buy: the coins are gone from the game and the wallet, and the NEAR came back
// With SELL_WALLET=1 it only sells what the wallet itself holds (the dialog's "Swap to NEAR").
// Testnet only: it refuses a mainnet RPC or account and the project's accounts (*.realsies.testnet,
// realsies-pool.testnet). No relay runs: the server is the only operator of game.realsies.testnet, and a deposit and a
// withdrawal are the player's own calls. The key comes from the near CLI's legacy keychain and is never printed.
//
//   PLAYER=<throwaway>.testnet npx tsx tools/swap-proof.ts
//   env: RPC_URL (https://rpc.testnet.fastnear.com), NEAR_IN (0.25), GAME (game.realsies.testnet),
//        SWAP_DEX (dclv2.ref-dev.testnet), SWAP_POOL (real.realsies.testnet|wrap.testnet|2000), SWAP_WRAP (wrap.testnet),
//        SWAP_SLIPPAGE_BPS (100), SELL_WALLET (unset)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from 'near-api-js';
import type { PublicConfig, SwapConfig, WalletInfo } from '../../shared/protocol.js';
import { checkPoolNames, nearPerCoin, quoteBuy, quoteSell, swapWallet, type SwapPool, type ViewFn } from '../src/swap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL ?? 'https://rpc.testnet.fastnear.com';
const PLAYER = process.env.PLAYER ?? '';
const GAME = process.env.GAME ?? 'game.realsies.testnet';
const SWAP: SwapConfig = {
  dex: process.env.SWAP_DEX ?? 'dclv2.ref-dev.testnet',
  poolId: process.env.SWAP_POOL ?? 'real.realsies.testnet|wrap.testnet|2000',
  wrapId: process.env.SWAP_WRAP ?? 'wrap.testnet',
  slippageBps: Number(process.env.SWAP_SLIPPAGE_BPS ?? 100),
};
const NEAR = 10n ** 24n;
const t0 = Date.now();
const log = (s: string) => console.log(`[swap-proof +${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const near = (y: bigint) => (Number(y / 10n ** 18n) / 1e6).toFixed(6);
const report: Record<string, unknown> = { player: PLAYER, rpc: RPC, game: GAME, swap: SWAP, startedAt: new Date().toISOString() };

function fail(msg: string): never {
  throw new Error(`PROOF FAILED: ${msg}`);
}
function check(cond: unknown, what: string): void {
  if (!cond) fail(what);
  log(`  ok  ${what}`);
}

/** The web's own builders (web/src/wallet/swap.ts), loaded as the browser runs them. */
interface WalletTx {
  receiverId: string;
  actions: { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }[];
}
interface WebSwap {
  buyTxs(cfg: PublicConfig, accountId: string, q: { maxIn: bigint; units: bigint }, w: unknown): { step: string; tx: WalletTx }[];
  sellTxs(cfg: PublicConfig, accountId: string, q: { units: bigint; minOut: bigint }, w: unknown, from: 'game' | 'wallet'): { step: string; tx: WalletTx }[];
  swapWalletOf(info: WalletInfo): unknown;
  buyNearNeeded(maxIn: bigint, w: unknown): bigint;
}

async function rpc(method: string, params: unknown): Promise<any> {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'p', method, params }) });
    if (r.status === 429 || r.status >= 500) {
      await sleep(800 * (i + 1));
      continue;
    }
    const j: any = await r.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.result;
  }
  throw new Error(`${method}: the RPC kept failing`);
}

const view: ViewFn = async <T,>(contract: string, method: string, args: Record<string, unknown>): Promise<T> => {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (r.error) throw new Error(r.error);
  const s = Buffer.from(r.result).toString('utf8');
  return (s ? JSON.parse(s) : null) as T;
};

async function nearBalance(account: string): Promise<bigint> {
  const r = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: account });
  return BigInt(r.amount) - BigInt(r.storage_usage) * 10n ** 19n;
}

/** The account's state the way the relay's WalletInfo has it, plus the game balance. */
async function state(coin: string): Promise<{ info: WalletInfo; game: bigint; wnear: bigint; near: bigint; coin: bigint }> {
  const [reg, bounds, bal, game, extra] = await Promise.all([
    view<unknown>(coin, 'storage_balance_of', { account_id: PLAYER }),
    view<{ min: string }>(coin, 'storage_balance_bounds', {}),
    view<string | null>(coin, 'ft_balance_of', { account_id: PLAYER }),
    view<string>(GAME, 'balance_of', { account_id: PLAYER }),
    swapWallet(view, nearBalance, SWAP.wrapId, PLAYER),
  ]);
  const info: WalletInfo = { accountId: PLAYER, coinsOpen: true, tokenId: coin, tokenRegistered: reg !== null, storageDeposit: bounds.min, walletBalance: bal ?? '0', ...extra };
  return { info, game: BigInt(game ?? '0'), wnear: BigInt(extra.wnearBalance ?? '0'), near: BigInt(extra.nearBalance ?? '0'), coin: BigInt(bal ?? '0') };
}

/** One transaction as a wallet sends it: signed with the account's key, waited for until final; its receipts read back. */
async function send(account: Account, step: string, tx: WalletTx): Promise<{ hash: string; logs: string[]; failures: string[]; gasTgas: number }> {
  const acts = tx.actions.map((a) => actions.functionCall(a.params.methodName, a.params.args as Record<string, unknown>, BigInt(a.params.gas), BigInt(a.params.deposit)));
  const r: any = await account.signAndSendTransaction({ receiverId: tx.receiverId, actions: acts, waitUntil: 'FINAL', throwOnFailure: false });
  const hash = r.transaction?.hash ?? r.transaction_outcome?.id;
  const outcomes = [r.transaction_outcome, ...(r.receipts_outcome ?? [])];
  const failures = outcomes.map((o: any) => o?.outcome?.status).filter((s: any) => s && typeof s === 'object' && 'Failure' in s).map((s: any) => JSON.stringify(s.Failure).slice(0, 240));
  if (r.status && typeof r.status === 'object' && 'Failure' in r.status) failures.unshift(JSON.stringify(r.status.Failure).slice(0, 240));
  const logs = outcomes.flatMap((o: any) => o?.outcome?.logs ?? []);
  const gasTgas = outcomes.reduce((g: number, o: any) => g + Number(o?.outcome?.gas_burnt ?? 0), 0) / 1e12;
  log(`${step.padEnd(12)} ${tx.receiverId} ${tx.actions.map((a) => a.params.methodName).join('+')}: ${hash} (${gasTgas.toFixed(1)} Tgas burnt)${failures.length ? ` FAILED: ${failures[0]}` : ''}`);
  return { hash, logs, failures, gasTgas };
}

/** The swap event of the pool contract in a transaction's logs: what went in and came out. */
function swapEvent(logs: string[]): { amount_in: string; amount_out: string; event: string } | null {
  for (const l of logs) {
    if (!l.startsWith('EVENT_JSON:')) continue;
    try {
      const e = JSON.parse(l.slice(11));
      if (e.standard?.startsWith('dcl') && (e.event === 'swap' || e.event === 'swap_desire')) return { ...e.data[0], event: e.event };
    } catch {
      /* not ours */
    }
  }
  return null;
}

async function main(): Promise<void> {
  // ---------- testnet and a throwaway account only ----------
  if (!/testnet/.test(RPC)) fail(`testnet only: ${RPC} is not a testnet RPC`);
  if (!/^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.testnet$/.test(PLAYER)) fail('set PLAYER=<a throwaway account>.testnet');
  if (/(^|\.)realsies\.testnet$/.test(PLAYER) || PLAYER === 'realsies-pool.testnet') fail(`${PLAYER} is a project account: use a throwaway one`);
  const status = await rpc('status', []);
  if (status.chain_id !== 'testnet') fail(`the RPC is on ${status.chain_id}, not testnet`);
  const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.near-credentials', 'testnet', `${PLAYER}.json`), 'utf8')) as { private_key: string };
  const account = new Account(PLAYER, new JsonRpcProvider({ url: RPC }), new KeyPairSigner(KeyPair.fromString(cred.private_key as any)));
  const web = (await import(pathToFileURL(path.resolve(here, '../../web/src/wallet/swap.ts')).href)) as WebSwap;

  // ---------- the game's coin and the pool, as the relay checks them at start ----------
  const gc = await view<{ token: string; coin_unit: string }>(GAME, 'get_config', {});
  const coin = gc.token;
  const unit = BigInt(gc.coin_unit);
  checkPoolNames(SWAP.poolId, coin, SWAP.wrapId);
  const pool: SwapPool = { ...SWAP, coin, coinUnit: unit };
  const price = await nearPerCoin(view, pool);
  check(price !== null, `${SWAP.poolId} on ${SWAP.dex}: ${price} NEAR per coin (${coin}, coin unit ${unit})`);
  const cfg = { contractId: GAME, tokenId: coin, coinUnit: unit.toString(), swap: SWAP, wallet: undefined } as unknown as PublicConfig;
  const hashes: Record<string, string> = {};

  if (process.env.SELL_WALLET === '1') {
    const s0 = await state(coin);
    check(s0.coin > 0n, `the wallet holds ${Number(s0.coin / 10n ** 14n) / 1e4} coins; wrap registered: ${s0.info.wrapRegistered}`);
    const sq = await quoteSell(view, pool, s0.coin);
    const txs = web.sellTxs(cfg, PLAYER, { units: s0.coin, minOut: BigInt(sq.minOut) }, web.swapWalletOf(s0.info), 'wallet');
    for (const t of txs) {
      const r = await send(account, t.step, t.tx);
      hashes[`wallet_${t.step}`] = r.hash;
      check(r.failures.length === 0, `${t.step}: no receipt failed`);
    }
    const s1 = await state(coin);
    check(s1.coin === 0n && s1.near - s0.near >= BigInt(sq.minOut) - NEAR / 100n, `sold from the wallet: ${near(s1.near - s0.near)} NEAR came back (quote ${near(BigInt(sq.amountOut))})`);
    report.sellWallet = { quote: sq, before: s0.info, after: s1.info, hashes };
    return finish(hashes);
  }

  // ---------- 1. buy with NEAR, deposit into the game ----------
  const s0 = await state(coin);
  log(`before: ${near(s0.near)} NEAR, ${near(s0.wnear)} wNEAR, ${Number(s0.coin / 10n ** 14n) / 1e4} coins in the wallet, ${Number(s0.game / 10n ** 14n) / 1e4} in the game; registered on the coin ${s0.info.tokenRegistered}, on wrap ${s0.info.wrapRegistered}`);
  const maxIn = BigInt(Math.round(Number(process.env.NEAR_IN ?? '0.25') * 1e6)) * 10n ** 18n;
  const q = await quoteBuy(view, pool, maxIn);
  const units = BigInt(q.coinUnits!);
  check(q.coins! >= 1, `the quote: ${near(maxIn)} NEAR buys exactly ${q.coins} coins for ${near(BigInt(q.cost!))} NEAR (allowance ${SWAP.slippageBps / 100}%)`);
  const w0 = web.swapWalletOf(s0.info);
  check(web.buyNearNeeded(maxIn, w0) <= s0.near, `the wallet covers it: needs ${near(web.buyNearNeeded(maxIn, w0))} NEAR with the reserve, has ${near(s0.near)}`);
  const buy = web.buyTxs(cfg, PLAYER, { maxIn, units }, w0);
  log(`the batch: ${buy.map((t) => `${t.step} (${t.tx.actions.map((a) => a.params.methodName).join('+')})`).join(', ')}`);
  let ev: ReturnType<typeof swapEvent> = null;
  for (const t of buy) {
    const r = await send(account, t.step, t.tx);
    hashes[t.step] = r.hash;
    check(r.failures.length === 0, `${t.step}: no receipt failed`);
    if (t.step === 'buy') ev = swapEvent(r.logs);
  }
  check(ev && BigInt(ev.amount_out) === units && BigInt(ev.amount_in) === BigInt(q.cost!), `the pool contract's ${ev?.event}: ${near(BigInt(ev?.amount_in ?? 0))} NEAR in, exactly ${Number(units / 10n ** 14n) / 1e4} coins out, as quoted`);
  await sleep(1500);
  const s1 = await state(coin);
  check(s1.game - s0.game === units, `game.realsies.testnet balance_of: +${Number(units / 10n ** 14n) / 1e4} coins (${Number(s0.game / 10n ** 14n) / 1e4} -> ${Number(s1.game / 10n ** 14n) / 1e4})`);
  check(s1.coin === s0.coin, 'nothing stranded in the wallet: its coin is where it was');
  const wrapped = s0.wnear < maxIn ? maxIn - s0.wnear : 0n;
  check(s1.wnear === s0.wnear + wrapped - BigInt(ev!.amount_in), `the unused NEAR waits as wNEAR: ${near(s1.wnear)}`);
  const spentBuy = s0.near - s1.near;
  log(`  the buy took ${near(spentBuy)} NEAR from the wallet (offered ${near(maxIn)}, registrations ${near((s0.info.tokenRegistered ? 0n : BigInt(s0.info.storageDeposit)) + (s0.info.wrapRegistered ? 0n : BigInt(s0.info.wrapStorageDeposit ?? '0')))}, the rest gas)`);

  // ---------- 2. withdraw and sell, unwrap the leftover ----------
  const sq = await quoteSell(view, pool, units);
  check(BigInt(sq.amountOut) > 0n, `the sale's quote: ${q.coins} coins for ${near(BigInt(sq.amountOut))} NEAR, at least ${near(BigInt(sq.minOut))}`);
  const sell = web.sellTxs(cfg, PLAYER, { units, minOut: BigInt(sq.minOut) }, web.swapWalletOf(s1.info), 'game');
  log(`the batch: ${sell.map((t) => `${t.step} (${t.tx.actions.map((a) => a.params.methodName).join('+')})`).join(', ')}`);
  let sev: ReturnType<typeof swapEvent> = null;
  for (const t of sell) {
    const r = await send(account, `sell_${t.step}`, t.tx);
    hashes[`sell_${t.step}`] = r.hash;
    check(r.failures.length === 0, `${t.step}: no receipt failed`);
    if (t.step === 'sell') sev = swapEvent(r.logs);
  }
  check(sev && BigInt(sev.amount_in) === units && BigInt(sev.amount_out) === BigInt(sq.amountOut), `the pool contract's swap: ${q.coins} coins in, ${near(BigInt(sev?.amount_out ?? 0))} NEAR out, exactly as quoted`);
  await sleep(1500);
  const s2 = await state(coin);
  check(s2.game === s0.game && s2.coin === s0.coin, 'the coins left the game and the wallet: both back where they started');
  check(s2.wnear === 0n, 'no wNEAR left: unwrapped in the same approval');
  const back = s2.near - s1.near;
  check(back >= BigInt(sq.amountOut) + s1.wnear - NEAR / 100n, `the NEAR came back: +${near(back)} NEAR (sale ${near(BigInt(sq.amountOut))} + unwrapped ${near(s1.wnear)}, less gas)`);
  // NEAR and wNEAR together: wNEAR the wallet held before the buy came back as NEAR, and is no cost
  const roundTrip = s0.near + s0.wnear - (s2.near + s2.wnear);
  log(`round trip: ${near(roundTrip)} NEAR in all, counting wNEAR as NEAR (two pool fees of 0.2%, the registrations of a first buy, gas)`);
  report.buy = { quote: q, before: s0.info, after: s1.info, event: ev, spent: spentBuy.toString() };
  report.sell = { quote: sq, after: s2.info, event: sev, back: back.toString(), roundTrip: roundTrip.toString() };
  return finish(hashes);
}

function finish(hashes: Record<string, string>): void {
  report.hashes = hashes;
  report.finishedAt = new Date().toISOString();
  const file = path.join(here, '..', 'data', `swap-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  log('PASSED');
  for (const [k, h] of Object.entries(hashes)) log(`  ${k.padEnd(18)} https://testnet.nearblocks.io/txns/${h}`);
  log(`report: ${file}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
