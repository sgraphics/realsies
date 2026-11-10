// A read-only look at a deployed relay's coins-for-NEAR side (protocol v1.12), the way a signed-in wallet player's
// browser sees it: the public config (swap, nearPerCoin), a NEP-413 sign-in with a throwaway account's key from the
// near CLI's legacy keychain, GET /api/session/wallet with the fields a buy is built from, the quotes, and the very
// transactions the web would hand the wallet for a buy and a withdrawal (web/src/wallet/swap.ts, loaded as it is).
// It sends nothing to the chain and the key is never printed. swap-proof.ts sends the transactions; this checks that
// the live relay feeds the builders what they need.
//
//   RELAY_URL=https://testnet.realsies.lol PLAYER=<throwaway>.testnet npx tsx tools/swap-live-check.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KeyPair, KeyPairSigner } from 'near-api-js';
import type { AuthChallenge, AuthSession, PublicConfig, SwapQuote, WalletInfo } from '../../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.RELAY_URL ?? '').replace(/\/$/, '');
const player = process.env.PLAYER ?? '';
const NEAR = 10n ** 24n;
const near = (y: bigint | string) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);

function fail(msg: string): never {
  console.error(`CHECK FAILED: ${msg}`);
  process.exit(1);
}
function ok(cond: unknown, what: string): void {
  if (!cond) fail(what);
  console.log(`  ok  ${what}`);
}

async function api(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t };
  }
}

interface WalletTx {
  receiverId: string;
  actions: { type: string; params: { methodName?: string; gas?: string; deposit?: string } }[];
}
interface WebSwap {
  buyTxs(cfg: PublicConfig, accountId: string, q: { maxIn: bigint; units: bigint }, w: unknown): { step: string; tx: WalletTx }[];
  sellTxs(cfg: PublicConfig, accountId: string, q: { units: bigint; minOut: bigint }, w: unknown, from: 'game' | 'wallet'): { step: string; tx: WalletTx }[];
  swapWalletOf(info: WalletInfo): unknown;
  buyNearNeeded(maxIn: bigint, w: unknown): bigint;
}
const shape = (txs: { step: string; tx: WalletTx }[]) =>
  txs.map((t) => `${t.step}: ${t.tx.receiverId} [${t.tx.actions.map((a) => `${a.params.methodName ?? a.type} ${Number(BigInt(a.params.gas ?? '0') / 10n ** 12n)} Tgas`).join(', ')}]`).join('\n        ');

async function main(): Promise<void> {
  if (!base || !player) fail('set RELAY_URL and PLAYER (a throwaway account with a key in the legacy keychain)');
  if (/(^|\.)realsies\.(testnet|near)$/.test(player) || player === 'realsies-pool.testnet') fail(`${player} is a project account: use a throwaway one`);
  const cfg = (await api('GET', '/api/config')).body as PublicConfig;
  console.log(`relay ${base}: ${cfg.network}, ${cfg.contractId}, coin ${cfg.tokenId}`);
  ok(!!cfg.swap && cfg.coinsOpen !== false, `the config offers the swap: ${cfg.swap?.poolId} on ${cfg.swap?.dex}`);
  ok(typeof cfg.nearPerCoin === 'number' && cfg.nearPerCoin > 0, `nearPerCoin ${cfg.nearPerCoin}`);

  const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.near-credentials', cfg.network, `${player}.json`), 'utf8')) as { private_key: string };
  const wallet = new KeyPairSigner(KeyPair.fromString(cred.private_key as any));
  const ch = (await api('POST', '/api/auth/challenge', {})).body as AuthChallenge;
  const sm = await wallet.signNep413Message(player, { message: ch.message, recipient: ch.recipient, nonce: new Uint8Array(Buffer.from(ch.nonce, 'base64')) });
  const v = await api('POST', '/api/auth/verify', { accountId: player, publicKey: sm.publicKey.toString(), signature: Buffer.from(sm.signature).toString('base64'), nonce: ch.nonce });
  ok(v.status === 200, `signed in as ${player} for ${ch.recipient} (${v.status}${v.status === 200 ? '' : ` ${JSON.stringify(v.body)}`})`);
  const token = (v.body as AuthSession).token;

  const wi = await api('GET', '/api/session/wallet', undefined, token);
  ok(wi.status === 200, `GET /api/session/wallet (${wi.status})`);
  const info = wi.body as WalletInfo;
  console.log(`      registered on the coin ${info.tokenRegistered}, coin in the wallet ${info.walletBalance}, NEAR ${info.nearBalance === undefined ? '?' : near(info.nearBalance)}, registered on wrap ${info.wrapRegistered}, wNEAR ${info.wnearBalance === undefined ? '?' : near(info.wnearBalance)}`);
  ok(info.nearBalance !== undefined && info.wrapRegistered !== undefined && info.wnearBalance !== undefined && info.walletBalance !== undefined, 'the wallet info has everything a buy is built from');

  const web = (await import(pathToFileURL(path.resolve(here, '../../web/src/wallet/swap.ts')).href)) as WebSwap;
  const w = web.swapWalletOf(info);
  ok(w !== null, 'the web reads that wallet info');

  const maxIn = NEAR / 4n;
  const bq = await api('GET', `/api/swap/quote?side=buy&near=${maxIn}`);
  ok(bq.status === 200 && (bq.body as SwapQuote).coins! >= 1, `0.25 NEAR buys ${bq.body.coins} coins for ${near(bq.body.cost ?? '0')} NEAR (${bq.status})`);
  const q = bq.body as SwapQuote;
  const buy = web.buyTxs(cfg, player, { maxIn, units: BigInt(q.coinUnits!) }, w);
  console.log(`      a buy, as the wallet would get it (needs ${near(web.buyNearNeeded(maxIn, w))} NEAR in the wallet):\n        ${shape(buy)}`);
  ok(buy.at(-1)!.step === 'deposit' && buy.some((t) => t.step === 'buy'), 'the buy ends with the deposit into the game');

  const cq = await api('GET', '/api/swap/quote?side=buy&coins=25');
  ok(cq.status === 200 && cq.body.coins >= 25, `25 coins cost about ${near(cq.body.cost ?? '0')} NEAR; the dialog would offer ${near(cq.body.amountIn)} (${cq.status})`);

  const units = 10n * BigInt(cfg.coinUnit);
  const sq = await api('GET', `/api/swap/quote?side=sell&units=${units}`);
  if (sq.status === 200) {
    const sell = web.sellTxs(cfg, player, { units, minOut: BigInt(sq.body.minOut) }, w, 'game');
    console.log(`      10 coins sell for ${near(sq.body.amountOut)} NEAR; a withdrawal, as the wallet would get it:\n        ${shape(sell)}`);
    ok(sell.some((t) => t.step === 'withdraw') && sell.some((t) => t.step === 'sell'), 'the withdrawal leaves the game and sells');
  } else {
    // the pool holds only the NEAR buyers put in: a sale larger than that is refused, in words
    ok(sq.body?.code === 'swap_too_big', `selling 10 coins is refused for now: "${sq.body?.message}" (${sq.status})`);
  }
  console.log('all checks passed; nothing was sent to the chain');
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
