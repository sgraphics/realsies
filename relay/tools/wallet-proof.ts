// End-to-end proof of wallet sign-in and the browser's play key on a real chain (testnet), against a relay
// that runs on a throwaway deployment (its own token and game contract). Refuses game.realsies.testnet and
// game.realsies.near: their only operator is the server.
//
// The wallet's part is played by the account's own full-access key from the legacy keychain
// (~/.near-credentials/<network>/<PLAYER>.json): near-api-js signs the NEP-413 sign-in with it, and the near CLI
// (near-cli-rs) sends what a wallet popup would: the AddKey of the browser's key, the deposit (ft_transfer_call)
// and the withdrawal. The test tokens come from the testnet airdrop (protocol v1.6), as in the game. The browser's part runs the web app's own transaction encoder (web/src/wallet/tx.ts).
// No key is ever printed.
//
//   RELAY_URL=http://localhost:3961 PLAYER=p1.<owner>.testnet npx tsx tools/wallet-proof.ts
//   env: NEAR_CLI (../.tooling/bin/near.exe), CLI_CONN (testnet-fast), RPC_URL (https://rpc.testnet.fastnear.com),
//        COINS (deposit, 60; the airdrop brings 100), PLAY_COINS (10)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyPair, KeyPairSigner, baseDecode } from 'near-api-js';
import type { AuthChallenge, AuthSession, PublicConfig, ServerMsg } from '../../shared/protocol.js';
import { WsClient } from '../test/client.js';
import { loadWebTx, newKey, signRequest } from '../test/wallet-helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.RELAY_URL ?? 'http://localhost:3961').replace(/\/+$/, '');
const player = process.env.PLAYER ?? '';
const NEAR_CLI = process.env.NEAR_CLI ?? path.resolve(here, '../../.tooling/bin/near.exe');
const CONN = process.env.CLI_CONN ?? 'testnet-fast';
const RPC = process.env.RPC_URL ?? 'https://rpc.testnet.fastnear.com';
const COINS = Number(process.env.COINS ?? 60);
const PLAY = Number(process.env.PLAY_COINS ?? 10);
const UNIT = 10n ** 18n;
const t0 = Date.now();
const log = (s: string) => console.log(`[proof +${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const report: Record<string, unknown> = { player, relay: base, startedAt: new Date().toISOString() };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sign = (m: ServerMsg) => m.t === 'sign_tx';

function fail(msg: string): never {
  throw new Error(`PROOF FAILED: ${msg}`);
}
function check(cond: unknown, what: string): void {
  if (!cond) fail(what);
  log(`  ok  ${what}`);
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

async function rpc(method: string, params: unknown): Promise<any> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'p', method, params }) });
    if (r.status === 429 || r.status >= 500) {
      await sleep(800 * (i + 1));
      continue;
    }
    const j: any = await r.json();
    if (j.error) {
      if (/TIMEOUT|UNKNOWN_TRANSACTION/.test(JSON.stringify(j.error)) && i < 5) {
        await sleep(1500);
        continue;
      }
      throw new Error(JSON.stringify(j.error));
    }
    return j.result;
  }
  throw new Error(`${method}: RPC kept failing`);
}

async function view(contract: string, method: string, args: object): Promise<any> {
  const r = await rpc('query', { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (r.error) throw new Error(r.error);
  const s = Buffer.from(r.result).toString('utf8');
  return s ? JSON.parse(s) : null;
}

async function accessKey(account: string, publicKey: string): Promise<any> {
  const r = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey });
  if (r.error) return null;
  return r;
}

/** A transaction by hash: success, signer, receiver, method, the key that signed, NEAR burnt. */
async function tx(hash: string, signer: string) {
  const r = await rpc('tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' });
  const t = r.transaction;
  const fc = t.actions?.[0]?.FunctionCall;
  const outcomes = [r.transaction_outcome, ...(r.receipts_outcome ?? [])];
  const gas = outcomes.reduce((a: bigint, o: any) => a + BigInt(o.outcome.gas_burnt), 0n);
  const burnt = outcomes.reduce((a: bigint, o: any) => a + BigInt(o.outcome.tokens_burnt), 0n);
  const failed = 'Failure' in (r.status ?? {}) || (r.receipts_outcome ?? []).some((o: any) => o.outcome.status && 'Failure' in o.outcome.status);
  return { ok: !failed, signer: t.signer_id, receiver: t.receiver_id, method: fc?.method_name, publicKey: t.public_key, prepaidGas: BigInt(fc?.gas ?? 0), gasBurnt: gas, nearBurnt: burnt };
}

/** The near CLI in place of the wallet popup; its output is parsed for the transaction id, never echoed. */
function cli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(NEAR_CLI, args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
      const m = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(out);
      if (m) resolve(m[1]);
      else reject(new Error(`near CLI ${args.slice(0, 3).join(' ')}: no transaction id${err ? ` (${err.message.split('\n')[0]})` : ''}; ${out.split('\n').filter((l) => /error/i.test(l) && !/private|secret|seed/i.test(l)).slice(0, 2).join(' | ')}`));
    });
  });
}

const nearOf = (yocto: bigint) => (Number(yocto / 10n ** 18n) / 1e6).toFixed(6);

async function main(): Promise<void> {
  if (!player) fail('set PLAYER=<testnet account with a full-access key in the legacy keychain>');
  const cfg = (await api('GET', '/api/config')).body as PublicConfig;
  if (/^game\.realsies\.(testnet|near)$/.test(cfg.contractId)) fail(`refusing to run against ${cfg.contractId}: the server is its only operator`);
  if (cfg.network !== 'testnet') fail('testnet only');
  log(`relay ${base}: ${cfg.contractId}, coin ${cfg.tokenId}, test mode ${cfg.testMode}`);
  report.contract = cfg.contractId;
  report.token = cfg.tokenId;
  const credFile = path.join(os.homedir(), '.near-credentials', cfg.network, `${player}.json`);
  const cred = JSON.parse(fs.readFileSync(credFile, 'utf8')) as { private_key: string };
  const wallet = new KeyPairSigner(KeyPair.fromString(cred.private_key as any));
  const links: Record<string, string> = {};
  const link = (k: string, h: string) => (links[k] = `https://testnet.nearblocks.io/txns/${h}`);

  // 1. sign-in: the wallet signs the relay's NEP-413 challenge; no transaction
  const ch = (await api('POST', '/api/auth/challenge', {})).body as AuthChallenge;
  const nonce = new Uint8Array(Buffer.from(ch.nonce, 'base64'));
  const sm = await wallet.signNep413Message(player, { message: ch.message, recipient: ch.recipient, nonce });
  const v = await api('POST', '/api/auth/verify', { accountId: player, publicKey: sm.publicKey.toString(), signature: Buffer.from(sm.signature).toString('base64'), nonce: ch.nonce });
  check(v.status === 200, `NEP-413 sign-in for ${ch.recipient}, the key checked on chain as a full-access key (${v.status} ${v.status === 200 ? '' : JSON.stringify(v.body)})`);
  const session = v.body as AuthSession;
  const token = session.token;
  const replay = await api('POST', '/api/auth/verify', { accountId: player, publicKey: sm.publicKey.toString(), signature: Buffer.from(sm.signature).toString('base64'), nonce: ch.nonce });
  check(replay.status === 401 && replay.body.code === 'nonce_used', 'the same signed sign-in again is refused');

  // 2. the browser's play key, added by the "wallet" (the CLI) as a function-call key: play and call, 0.25 NEAR
  const k = newKey();
  const addKey = await cli([
    'account', 'add-key', player, 'grant-function-call-access', '--allowance', '0.25 NEAR', '--contract-account-id', cfg.contractId,
    '--function-names', 'play, call', 'use-manually-provided-public-key', k.publicKey, 'network-config', CONN, 'sign-with-legacy-keychain', 'send',
  ]);
  link('addKey', addKey);
  log(`AddKey ${addKey}`);
  let reg = { status: 0, body: {} as any };
  for (let i = 0; i < 10; i++) {
    reg = await api('POST', '/api/session/play-key', { publicKey: k.publicKey }, token);
    if (reg.status !== 409) break;
    await sleep(2000);
  }
  check(reg.status === 200 && reg.body.status === 'active' && reg.body.methodNames.join() === 'play,call', `the relay checked the play key on chain: ${JSON.stringify(reg.body)}`);
  const ak0 = await accessKey(player, k.publicKey);
  const allowance0 = BigInt(ak0.permission.FunctionCall.allowance);
  report.playKey = { publicKey: k.publicKey, allowance: allowance0.toString(), methods: ak0.permission.FunctionCall.method_names };

  // 3. the testnet airdrop: 100 tREAL into the wallet (the faucet registers the account on the coin), then a deposit
  const st = await api('GET', `/api/airdrop/${player}`, undefined, token);
  check(st.status === 200 && st.body.to === 'wallet', `the airdrop status: ${JSON.stringify(st.body)}`);
  const ad = await api('POST', `/api/airdrop/${player}`, {}, token);
  if (ad.status === 200) {
    check(ad.body.to === 'wallet' && ad.body.wallet?.tokenRegistered === true && BigInt(ad.body.wallet?.walletBalance ?? '0') >= 100n * UNIT, '100 tREAL airdropped into the wallet, registered on the coin');
    link('airdrop', ad.body.tx);
    const twice = await api('POST', `/api/airdrop/${player}`, {}, token);
    check(twice.status === 429 && twice.body.code === 'airdrop_too_soon' && twice.body.retryAt > Date.now(), 'a second airdrop at once: airdrop_too_soon, with the time of the next');
  } else {
    // a rerun with the same account: the limits say no; the wallet still holds enough for the deposit below
    check(ad.body.code === 'airdrop_enough' || ad.body.code === 'airdrop_too_soon', `the airdrop refused by its limits (${ad.body.code}): ${ad.body.message}`);
  }
  const meBefore = (await api('GET', `/api/me/${player}`, undefined, token)).body;
  const dep = await cli([
    'contract', 'call-function', 'as-transaction', cfg.tokenId, 'ft_transfer_call', 'json-args',
    JSON.stringify({ receiver_id: cfg.contractId, amount: (BigInt(COINS) * UNIT).toString(), msg: '' }),
    'prepaid-gas', '100 Tgas', 'attached-deposit', '1 yoctoNEAR', 'sign-as', player, 'network-config', CONN, 'sign-with-legacy-keychain', 'send',
  ]);
  link('deposit', dep);
  let rep = { status: 0, body: {} as any };
  for (let i = 0; i < 8; i++) {
    rep = await api('POST', '/api/session/deposit', { txHash: dep }, token);
    if (rep.status !== 409) break;
    await sleep(2500);
  }
  check(rep.status === 200 && Math.abs(rep.body.me.balanceCoins - meBefore.balanceCoins - COINS) < 1e-6, `the wallet deposit checked on chain by the relay: ${meBefore.balanceCoins} -> ${rep.body.me.balanceCoins} coins`);

  // 4. a paid chat: the relay asks, the browser signs, the relay checks and broadcasts
  const tk = (await api('POST', '/api/session/ticket', {}, token)).body;
  const ws = await WsClient.connectTicket(base, tk.ticket, player);
  const welcome = await ws.waitT('welcome', 15_000);
  check(welcome.me.kind === 'wallet', 'socket with a one-time ticket; welcomed as a wallet player');
  ws.send({ t: 'enter_room', level: 1 });
  const room = await ws.waitT('room', 15_000);
  const seat = room.seats.find((x) => x.state === 'open')!;
  ws.send({ t: 'pick_seat', level: 1, seatIndex: seat.index, mode: 'paid', coins: PLAY });
  const matched = await ws.waitT('matched', 120_000);
  const req = (await ws.wait(sign, 60_000, 'sign_tx play')) as Extract<ServerMsg, { t: 'sign_tx' }>;
  const args = JSON.parse(req.tx.actions[0].args);
  check(req.tx.signerId === player && req.tx.publicKey === k.publicKey && req.tx.receiverId === cfg.contractId && args.coins === PLAY, `sign_tx: play ${PLAY} coins on ${cfg.contractId} with the play key, nonce ${req.tx.nonce}`);
  ws.send({ t: 'signed_tx', reqId: req.reqId, signedTx: await signRequest(req.tx, k) });
  const placed = await ws.waitT('placed', 90_000);
  link('play', placed.tx);
  const pt = await tx(placed.tx, player);
  check(pt.ok && pt.signer === player && pt.receiver === cfg.contractId && pt.method === 'play' && pt.publicKey === k.publicKey, `the play is on chain, signed by ${player} with the browser's key`);
  await ws.waitChatStart(matched.chat.chatId, 30_000, (cfg.countdownSeconds ?? 3) * 1000);
  ws.send({ t: 'say', chatId: matched.chat.chatId, text: 'hey! where are you from?' });
  await sleep(3000);
  ws.send({ t: 'dev_end_chat', chatId: matched.chat.chatId });
  await ws.waitT('chat_ended', 30_000, (m) => m.chatId === matched.chat.chatId);
  ws.send({ t: 'call', chatId: matched.chat.chatId, human: false });
  const creq = (await ws.wait(sign, 30_000, 'sign_tx call')) as Extract<ServerMsg, { t: 'sign_tx' }>;
  ws.send({ t: 'signed_tx', reqId: creq.reqId, signedTx: await signRequest(creq.tx, k) });
  const called = await ws.waitT('call_recorded', 90_000, (m) => m.chatId === matched.chat.chatId);
  check(!!called.tx, 'call_recorded with its transaction');
  link('call', called.tx!);
  const ct = await tx(called.tx!, player);
  check(ct.ok && ct.method === 'call' && ct.publicKey === k.publicKey, 'the call is on chain, signed with the browser\'s key');
  const chainPlay = await view(cfg.contractId, 'get_play', { round_id: matched.chat.roundId, handle: args.handle });
  check(chainPlay?.account === player && chainPlay?.call === false && chainPlay?.coins === PLAY, `get_play: ${player}, ${PLAY} coins, called bot`);

  // 5. what it cost
  const ak1 = await accessKey(player, k.publicKey);
  const allowance1 = BigInt(ak1.permission.FunctionCall.allowance);
  const spent = allowance0 - allowance1;
  report.gas = {
    play: { prepaidTgas: Number(pt.prepaidGas / 10n ** 12n), burntTgas: Number(pt.gasBurnt) / 1e12, nearBurnt: nearOf(pt.nearBurnt) },
    call: { prepaidTgas: Number(ct.prepaidGas / 10n ** 12n), burntTgas: Number(ct.gasBurnt) / 1e12, nearBurnt: nearOf(ct.nearBurnt) },
    allowanceSpentForPlayAndCall: nearOf(spent),
    allowanceLeft: nearOf(allowance1),
    chatsPerAllowance: spent > 0n ? Number(allowance0 / spent) : null,
  };
  log(`gas: play burnt ${(Number(pt.gasBurnt) / 1e12).toFixed(2)} Tgas (${nearOf(pt.nearBurnt)} NEAR), call ${(Number(ct.gasBurnt) / 1e12).toFixed(2)} Tgas (${nearOf(ct.nearBurnt)} NEAR); allowance charged ${nearOf(spent)} NEAR for both, about ${spent > 0n ? Number(allowance0 / spent) : '?'} paid chats per 0.25 NEAR`);

  // 6. the play key cannot withdraw: sign withdraw with it and send it straight to NEAR
  const w = await loadWebTx();
  const ak = await accessKey(player, k.publicKey);
  const { signed } = w.signTransaction({
    signerId: player, publicKey: baseDecode(k.publicKey.slice(8)), nonce: BigInt(ak.nonce) + 1n, receiverId: cfg.contractId, blockHash: baseDecode(ak.block_hash),
    methodName: 'withdraw', args: new TextEncoder().encode(JSON.stringify({ amount: '1' })), gas: 30n * 10n ** 12n, deposit: 0n,
  }, k.secret);
  let refused = '';
  try {
    await rpc('send_tx', { signed_tx_base64: Buffer.from(signed).toString('base64'), wait_until: 'EXECUTED_OPTIMISTIC' });
  } catch (e) {
    refused = String((e as Error).message);
  }
  check(/MethodNameMismatch/.test(refused), 'NEAR itself refuses a withdraw signed with the play key (MethodNameMismatch)');

  // 7. settlement (test mode: end the round now), results for the session's account
  const dev = await api('POST', '/api/dev/end-round', {});
  check(dev.status === 200, 'dev end-round');
  const ready = await ws.waitT('results_ready', 300_000, (m) => m.roundId === matched.chat.roundId);
  const res = await api('GET', `/api/rounds/${ready.roundId}/results/${player}`, undefined, token);
  const mine = res.body.chats?.find((c: any) => c.chatId === matched.chat.chatId);
  check(res.status === 200 && mine?.mode === 'paid' && mine?.truth === 'bot' && mine?.right === true, `results: the paid chat, a bot, called right, coins ${mine?.coinsDelta}`);
  const settledPlay = await view(cfg.contractId, 'get_play', { round_id: matched.chat.roundId, handle: args.handle });
  check(settledPlay?.outcome && settledPlay.credited !== undefined, `settled on chain: outcome ${JSON.stringify(settledPlay?.outcome)}, credited ${settledPlay?.credited}`);
  report.results = { roundId: ready.roundId, coinsDelta: mine?.coinsDelta, outcome: settledPlay?.outcome };

  // 8. withdraw everything from the "wallet" (the CLI), the coins arrive on the coin contract
  const bal = BigInt(await view(cfg.contractId, 'balance_of', { account_id: player }));
  const walletBefore = BigInt(await view(cfg.tokenId, 'ft_balance_of', { account_id: player }));
  const wd = await cli([
    'contract', 'call-function', 'as-transaction', cfg.contractId, 'withdraw', 'json-args', JSON.stringify({ amount: bal.toString() }),
    'prepaid-gas', '50 Tgas', 'attached-deposit', '0 NEAR', 'sign-as', player, 'network-config', CONN, 'sign-with-legacy-keychain', 'send',
  ]);
  link('withdraw', wd);
  await sleep(2500);
  const walletAfter = BigInt(await view(cfg.tokenId, 'ft_balance_of', { account_id: player }));
  check(walletAfter - walletBefore === bal, `withdrew ${Number(bal) / 1e18} coins to the wallet`);

  // 9. sign out
  const out = await api('DELETE', '/api/session', undefined, token);
  for (let i = 0; i < 40 && !ws.isClosed; i++) await sleep(50);
  check(out.status === 200 && ws.isClosed && (await api('GET', '/api/session', undefined, token)).status === 401, 'signed out: the socket closed, the token stopped working');

  report.links = links;
  report.finishedAt = new Date().toISOString();
  const file = path.join(here, '..', 'data', `wallet-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, (_k, val) => (typeof val === 'bigint' ? val.toString() : val), 2));
  log('PASSED');
  for (const [k2, l] of Object.entries(links)) log(`  ${k2.padEnd(15)} ${l}`);
  log(`report: ${file}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
