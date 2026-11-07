// Wallet players on an in-process relay (protocol v1.3), on the mock chain with its access-key rules and the
// mock NEAR AI signer. Without test mode: no test users, no dev endpoints; sign-in over HTTP with a NEP-413
// signature, a session, a ticketed WebSocket, a wallet deposit, the browser's play key, paid plays and calls
// signed by the browser (with the browser's own encoder) and checked by the relay, tampered and declined
// signatures, settlement, results, sign-out. With test mode: a wallet account next to the test users.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthChallenge, AuthSession, PublicConfig, ServerMsg } from '../../shared/protocol.js';
import { createApp, type App } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import { WsClient } from './client.js';
import { newKey, signChallenge, signRequest, type TestKey } from './wallet-helpers.js';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-wallet-')), 'relay.db');
}

async function startApp(extra: Record<string, unknown>, chain: MockChain): Promise<App> {
  return createApp(
    {
      port: 0, dbPath: tmpDb(), chain: 'mock', nearAi: 'mock', chatSeconds: 3, callSeconds: 4, countdownSeconds: 0, botTimeScale: 0.05,
      searchDelay: [0.15, 0.3], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'warn', idleMinutes: 0, pruneDelaySeconds: 3600,
      signTimeoutSeconds: 3, webDist: path.join(os.tmpdir(), 'no-web-dist'), ...extra,
    },
    { chain },
  );
}

/** HTTP with an optional Bearer session; returns status and JSON body, never throws on 4xx. */
async function api(base: string, method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j: any = t;
  try {
    j = JSON.parse(t);
  } catch {
    /* text */
  }
  return { status: r.status, body: j };
}

/** A wallet's sign-in: challenge, NEP-413 signature with a full-access key of the account, verify. */
async function signIn(base: string, chain: MockChain, accountId: string, key: TestKey = newKey()): Promise<{ session: AuthSession; key: TestKey }> {
  chain.addKey(accountId, key.publicKey, 'FullAccess');
  const ch = (await api(base, 'POST', '/api/auth/challenge', {})).body as AuthChallenge;
  const r = await api(base, 'POST', '/api/auth/verify', signChallenge(ch, accountId, key));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { session: r.body as AuthSession, key };
}

async function socket(base: string, token: string, accountId: string): Promise<WsClient> {
  const t = await api(base, 'POST', '/api/session/ticket', {}, token);
  assert.equal(t.status, 200);
  return WsClient.connectTicket(base, t.body.ticket, accountId);
}

/** The browser's play key: made here, added to the account (the wallet's approval), registered with the relay. */
async function enableCoins(base: string, chain: MockChain, token: string, accountId: string): Promise<TestKey> {
  const k = newKey();
  chain.addKey(accountId, k.publicKey, { receiverId: chain.contractId, methodNames: ['play', 'call'], allowance: '250000000000000000000000' });
  const r = await api(base, 'POST', '/api/session/play-key', { publicKey: k.publicKey }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'active');
  return k;
}

const sign = (m: ServerMsg) => m.t === 'sign_tx';

test('wallet players without test mode: sign-in, session, ticketed socket, wallet deposit, play key, browser-signed play and call, tampered and declined signatures, settlement, sign-out', { timeout: 150_000 }, async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 5;
  chain.callGraceMs = 1500;
  chain.testMode = false;
  const app = await startApp({ testMode: false, roundMinutes: 0.8 }, chain);
  const base = `http://localhost:${app.port}`;
  const acct = 'player.testnet';
  try {
    // ----- no test users, no dev tools -----
    const cfg = (await api(base, 'GET', '/api/config')).body as PublicConfig;
    assert.equal(cfg.testMode, false);
    assert.equal(cfg.coinsOpen, true);
    assert.equal(cfg.wallet?.recipient, 'realsies.lol');
    assert.deepEqual(cfg.wallet?.playKey.methodNames, ['play', 'call']);
    assert.equal(cfg.wallet?.playKey.receiverId, chain.contractId);
    assert.equal(cfg.wallet?.playKey.allowance, '250000000000000000000000', '0.25 NEAR');
    assert.deepEqual((await api(base, 'GET', '/api/test-users')).body, []);
    await assert.rejects(WsClient.connect(base, 'ana.realsies.testnet'), 'a test user cannot connect');
    assert.equal((await api(base, 'POST', '/api/dev/end-round', {})).status, 403);
    assert.equal((await api(base, 'POST', '/api/test-users/ana.realsies.testnet/faucet', {})).status, 401, 'no faucet for anyone');
    assert.equal((await api(base, 'GET', '/api/me/ana.realsies.testnet')).status, 401);

    // ----- sign-in -----
    const ch = (await api(base, 'POST', '/api/auth/challenge', {})).body as AuthChallenge;
    const fa = newKey();
    chain.addKey(acct, fa.publicKey, 'FullAccess');
    const wrong = await api(base, 'POST', '/api/auth/verify', signChallenge(ch, acct, fa, 'evil.example'));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'bad_signature', 'a signature for another site');
    const { session } = await signIn(base, chain, acct, fa);
    const token = session.token;
    assert.equal(session.accountId, acct);
    assert.equal(session.me.kind, 'wallet');
    assert.equal(session.playKey, null);
    assert.equal((await api(base, 'GET', `/api/me/${acct}`)).status, 401, 'my coins need my session');
    assert.equal((await api(base, 'GET', `/api/me/${acct}`, undefined, token)).body.accountId, acct);
    assert.equal((await api(base, 'GET', '/api/me/other.testnet', undefined, token)).status, 403, "another account's");
    assert.equal((await api(base, 'GET', '/api/session', undefined, token)).body.accountId, acct, 'the session again (a reload)');

    // ----- the socket: a one-time ticket -----
    const t1 = (await api(base, 'POST', '/api/session/ticket', {}, token)).body;
    const ws = await WsClient.connectTicket(base, t1.ticket, acct);
    const welcome = await ws.waitT('welcome', 5000);
    assert.equal(welcome.me.kind, 'wallet');
    await assert.rejects(WsClient.connectTicket(base, t1.ticket, acct), 'a ticket works once');
    assert.equal((await api(base, 'POST', '/api/session/ticket', {})).status, 401, 'no ticket without a session');

    // ----- what the wallet itself holds: nothing yet, not even registered on the coin -----
    const empty = (await api(base, 'GET', '/api/session/wallet', undefined, token)).body;
    assert.equal(empty.walletBalance, '0', 'an empty wallet');
    assert.equal(empty.tokenRegistered, false);

    // ----- a deposit from the wallet, and the locked Turing bonus it unlocks -----
    assert.ok((await chain.faucetDeposit(chain.accounts.promo, 50n * chain.coinUnit)).ok);
    app.game.users.get(acct)!.lockedBonus = (3n * chain.coinUnit).toString();
    chain.mintToWallet(acct, 200n * chain.coinUnit);
    assert.equal((await api(base, 'GET', '/api/session/wallet', undefined, token)).body.walletBalance, (200n * chain.coinUnit).toString(), 'the wallet holds 200 coins');
    const dep = await chain.walletDeposit(acct, 100n * chain.coinUnit);
    assert.ok(dep.ok);
    const rep = await api(base, 'POST', '/api/session/deposit', { txHash: dep.hash }, token);
    assert.equal(rep.status, 200, JSON.stringify(rep.body));
    assert.equal(rep.body.me.balanceCoins, 103, 'the deposit, plus the locked bonus from promo');
    assert.ok(rep.body.bonusTx);
    assert.equal((await api(base, 'POST', '/api/session/deposit', { txHash: dep.hash }, token)).body.me.balanceCoins, 103, 'a deposit counts once');
    const otherDep = await chain.walletDeposit('stranger.testnet', 0n);
    assert.equal((await api(base, 'POST', '/api/session/deposit', { txHash: otherDep.hash }, token)).body.code, 'tx_unknown', "someone else's transaction is not mine");
    const info = (await api(base, 'GET', '/api/session/wallet', undefined, token)).body;
    assert.equal(info.tokenRegistered, true);
    assert.equal(info.coinsOpen, true);
    assert.equal(info.walletBalance, (100n * chain.coinUnit).toString(), 'after the deposit: 100 coins left in the wallet');

    // ----- coins need the play key; the relay never signs for a wallet account -----
    ws.send({ t: 'enter_room', level: 1 });
    await ws.waitT('room', 5000);
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'paid', coins: 10 });
    assert.equal((await ws.waitT('error', 5000)).code, 'play_key_missing');
    const broad = newKey();
    chain.addKey(acct, broad.publicKey, { receiverId: chain.contractId, methodNames: [], allowance: null });
    assert.equal((await api(base, 'POST', '/api/session/play-key', { publicKey: broad.publicKey }, token)).body.code, 'play_key_methods', 'a key that may call anything');
    const pk = await enableCoins(base, chain, token, acct);
    assert.equal((await api(base, 'GET', '/api/session', undefined, token)).body.playKey.publicKey, pk.publicKey);
    assert.equal((await api(base, 'POST', '/api/withdraw', { accountId: acct, coins: 5 })).body.code, 'withdraw_in_wallet');

    // ----- a paid chat: the browser signs the play and the call -----
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'paid', coins: 10 });
    const matched = await ws.waitT('matched', 15_000);
    assert.equal(matched.chat.coins, 10);
    const req = (await ws.wait(sign, 10_000, 'sign_tx play')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    assert.equal(req.purpose, 'play');
    assert.equal(req.chatId, matched.chat.chatId);
    assert.equal(req.tx.signerId, acct);
    assert.equal(req.tx.publicKey, pk.publicKey);
    assert.equal(req.tx.receiverId, chain.contractId);
    assert.equal(req.tx.actions[0].deposit, '0');
    const playArgs = JSON.parse(req.tx.actions[0].args);
    assert.equal(playArgs.coins, 10);
    assert.equal(playArgs.round_id, matched.chat.roundId);
    assert.match(playArgs.handle, /^[0-9a-f]{64}$/);
    ws.send({ t: 'signed_tx', reqId: req.reqId, signedTx: await signRequest(req.tx, pk) });
    const placed = await ws.waitT('placed', 10_000);
    assert.ok(placed.tx.length >= 40, 'the hash of the browser-signed play');
    const onChain = await chain.getPlay(matched.chat.roundId, playArgs.handle);
    assert.equal(onChain?.account, acct, 'the play is on chain as the player\'s own');
    assert.equal(onChain?.coins, 10);
    await ws.waitChatStart(matched.chat.chatId, 10_000, 0);
    ws.send({ t: 'say', chatId: matched.chat.chatId, text: 'hey, are you a bot?' });
    await ws.waitT('chat_ended', 15_000, (m) => m.chatId === matched.chat.chatId);
    ws.send({ t: 'call', chatId: matched.chat.chatId, human: false });
    const callReq = (await ws.wait(sign, 10_000, 'sign_tx call')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    assert.equal(callReq.purpose, 'call');
    assert.deepEqual(JSON.parse(callReq.tx.actions[0].args), { round_id: matched.chat.roundId, handle: playArgs.handle, human: false });
    assert.ok(BigInt(callReq.tx.nonce) > BigInt(req.tx.nonce), 'the next nonce');
    ws.send({ t: 'signed_tx', reqId: callReq.reqId, signedTx: await signRequest(callReq.tx, pk) });
    const called = await ws.waitT('call_recorded', 10_000, (m) => m.chatId === matched.chat.chatId);
    assert.ok(called.tx, 'the call is on chain');
    assert.equal((await chain.getPlay(matched.chat.roundId, playArgs.handle))?.call, false);

    // ----- a tampered signature: refused, the chat goes on free -----
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 1, mode: 'paid', coins: 5 });
    const m2 = await ws.waitT('matched', 15_000);
    const r2 = (await ws.wait(sign, 10_000, 'sign_tx 2')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    const more = JSON.stringify({ ...JSON.parse(r2.tx.actions[0].args), coins: 500 });
    ws.send({ t: 'signed_tx', reqId: r2.reqId, signedTx: await signRequest(r2.tx, pk, (x) => ({ ...x, args: new TextEncoder().encode(more) })) });
    assert.equal((await ws.waitT('error', 5000, (e) => e.code === 'bad_signed_tx')).code, 'bad_signed_tx');
    const failed = await ws.waitT('play_failed', 5000, (m) => m.chatId === m2.chat.chatId);
    assert.match(failed.reason, /refused/);
    await ws.waitT('chat_ended', 15_000, (m) => m.chatId === m2.chat.chatId);
    ws.send({ t: 'call', chatId: m2.chat.chatId, human: true });
    const freeCall = await ws.waitT('call_recorded', 5000, (m) => m.chatId === m2.chat.chatId);
    assert.equal(freeCall.tx, undefined, 'a free call is not on chain');

    // ----- a declined signature: the chat goes on free -----
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 2, mode: 'paid', coins: 5 });
    const m3 = await ws.waitT('matched', 15_000);
    const r3 = (await ws.wait(sign, 10_000, 'sign_tx 3')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    ws.send({ t: 'sign_declined', reqId: r3.reqId, reason: 'not the 5 coins you chose' });
    assert.match((await ws.waitT('play_failed', 5000, (m) => m.chatId === m3.chat.chatId)).reason, /did not sign/);
    await ws.waitT('chat_ended', 15_000, (m) => m.chatId === m3.chat.chatId);
    ws.send({ t: 'call', chatId: m3.chat.chatId, human: false });
    await ws.waitT('call_recorded', 5000, (m) => m.chatId === m3.chat.chatId);
    assert.equal((await chain.getRoundPlays(matched.chat.roundId)).filter((p) => p.account === acct).length, 1, 'only the signed play is on chain');

    // ----- settlement: the round ends on its own (no dev tools), the results are the player's -----
    const ready = await ws.waitT('results_ready', 90_000, (m) => m.roundId === matched.chat.roundId);
    assert.equal(ready.roundId, matched.chat.roundId);
    const res = await api(base, 'GET', `/api/rounds/${ready.roundId}/results/${acct}`, undefined, token);
    assert.equal(res.status, 200);
    const paid = res.body.chats.find((c: any) => c.chatId === matched.chat.chatId);
    assert.equal(paid.mode, 'paid');
    assert.equal(paid.truth, 'bot');
    assert.equal(paid.right, true, 'called bot on a bot');
    assert.equal(paid.coinsDelta, -0.5, 'nobody called it wrong: the locked coins come back, less the 5% fee');
    assert.equal(res.body.chats.length, 3);
    assert.equal((await api(base, 'GET', `/api/rounds/${ready.roundId}/results/${acct}`)).status, 401, 'results need the session');

    // ----- a withdrawal from the wallet: walletInfo shows the coins back in the wallet -----
    const before = BigInt((await api(base, 'GET', '/api/session/wallet', undefined, token)).body.walletBalance);
    assert.ok((await chain.walletWithdraw(acct, 10n * chain.coinUnit)).ok);
    assert.equal(BigInt((await api(base, 'GET', '/api/session/wallet', undefined, token)).body.walletBalance), before + 10n * chain.coinUnit, 'after a withdrawal');

    // ----- sign out: the socket closes, the token stops working -----
    assert.equal((await api(base, 'DELETE', '/api/session', undefined, token)).status, 200);
    for (let i = 0; i < 40 && !ws.isClosed; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(ws.isClosed, 'the socket closed');
    assert.equal((await api(base, 'GET', '/api/session', undefined, token)).status, 401);
    assert.equal((await api(base, 'POST', '/api/session/ticket', {}, token)).status, 401);
  } finally {
    await app.close();
  }
});

test('before REAL launches: no coin on the contract means free play only, and the coin showing up opens coins without a restart', { timeout: 60_000 }, async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 5;
  chain.coinsOpen = false;
  chain.testMode = false;
  const app = await startApp({ testMode: false, roundMinutes: 5, buyUrl: 'https://meme.cooking/meme/realsies' }, chain);
  const base = `http://localhost:${app.port}`;
  try {
    const cfg = (await api(base, 'GET', '/api/config')).body as PublicConfig;
    assert.equal(cfg.coinsOpen, false);
    assert.equal(cfg.buyUrl, 'https://meme.cooking/meme/realsies');
    const { session } = await signIn(base, chain, 'early.testnet');
    const ws = await socket(base, session.token, 'early.testnet');
    await ws.waitT('welcome', 5000);
    ws.send({ t: 'enter_room', level: 1 });
    await ws.waitT('room', 5000);
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'paid', coins: 10 });
    assert.equal((await ws.waitT('error', 5000)).code, 'coins_closed');
    const closedInfo = (await api(base, 'GET', '/api/session/wallet', undefined, session.token)).body;
    assert.equal(closedInfo.coinsOpen, false);
    assert.equal(closedInfo.walletBalance, '0', 'no coin, nothing in the wallet');
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    assert.equal((await ws.waitT('matched', 15_000)).chat.mode, 'free', 'free play works');
    // the owner sets the coin at the launch: the relay notices and tells everyone
    chain.coinsOpen = true;
    await app.game.refreshChainConfig();
    const pushed = await ws.waitT('config', 5000);
    assert.equal(pushed.config.coinsOpen, true);
    assert.equal(pushed.config.tokenId, chain.tokenId);
    ws.close();
  } finally {
    await app.close();
  }
});

test('test mode: a wallet account plays next to the test users; the faucet serves it; its paid play is browser-signed, never relay-signed', { timeout: 90_000 }, async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 5;
  chain.callGraceMs = 1500;
  const app = await startApp({ testMode: true, roundMinutes: 10 }, chain);
  const base = `http://localhost:${app.port}`;
  const acct = 'tester.testnet';
  try {
    assert.equal(((await api(base, 'GET', '/api/test-users')).body as unknown[]).length, 6, 'the test users stay in test mode');
    const { session } = await signIn(base, chain, acct);
    const token = session.token;
    assert.equal((await api(base, 'POST', `/api/test-users/${acct}/faucet`, { coins: 20 })).status, 401, 'the faucet needs the session for a wallet account');
    const f = await api(base, 'POST', `/api/test-users/${acct}/faucet`, { coins: 20 }, token);
    assert.equal(f.status, 200, JSON.stringify(f.body));
    assert.equal(f.body.me.balanceCoins, 20);
    const fw = await api(base, 'POST', '/api/session/faucet-wallet', { coins: 30 }, token);
    assert.equal(fw.status, 200);
    assert.equal(chain.walletBalance(acct), 30n * chain.coinUnit, 'test coins into the wallet itself, to try a wallet deposit');
    assert.equal((await api(base, 'GET', '/api/session/wallet', undefined, token)).body.walletBalance, (30n * chain.coinUnit).toString(), 'walletInfo shows them');
    const pk = await enableCoins(base, chain, token, acct);
    const ws = await socket(base, token, acct);
    await ws.waitT('welcome', 5000);
    ws.send({ t: 'enter_room', level: 1 });
    await ws.waitT('room', 5000);
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 3, mode: 'paid', coins: 5 });
    const matched = await ws.waitT('matched', 15_000);
    const req = (await ws.wait(sign, 10_000, 'sign_tx')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    ws.send({ t: 'signed_tx', reqId: req.reqId, signedTx: await signRequest(req.tx, pk) });
    await ws.waitT('placed', 10_000);
    const signers = chain.txLog.filter((t) => t.method === 'play').map((t) => t.signer);
    assert.deepEqual(signers, [acct]);
    await ws.waitChatStart(matched.chat.chatId, 10_000, 0);
    ws.send({ t: 'dev_end_chat', chatId: matched.chat.chatId });
    await ws.waitT('chat_ended', 10_000);
    ws.send({ t: 'call', chatId: matched.chat.chatId, human: true });
    const cr = (await ws.wait(sign, 10_000, 'sign_tx call')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    ws.send({ t: 'signed_tx', reqId: cr.reqId, signedTx: await signRequest(cr.tx, pk) });
    assert.ok((await ws.waitT('call_recorded', 10_000)).tx);
    // the key was used elsewhere meanwhile (its nonce moved on): NEAR refuses the stale nonce, the relay asks again above it
    chain.addKey(acct, pk.publicKey, { receiverId: chain.contractId, methodNames: ['play', 'call'], allowance: '250000000000000000000000' }, 5000n);
    ws.send({ t: 'pick_seat', level: 1, seatIndex: 4, mode: 'paid', coins: 5 });
    await ws.waitT('matched', 15_000);
    const stale = (await ws.wait(sign, 10_000, 'sign_tx stale')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    assert.ok(BigInt(stale.tx.nonce) <= 5000n, 'the relay still counts from the old nonce');
    ws.send({ t: 'signed_tx', reqId: stale.reqId, signedTx: await signRequest(stale.tx, pk) });
    const again = (await ws.wait(sign, 10_000, 'sign_tx again')) as Extract<ServerMsg, { t: 'sign_tx' }>;
    assert.equal(again.tx.nonce, '5001', 'asked again just above the nonce NEAR reported');
    ws.send({ t: 'signed_tx', reqId: again.reqId, signedTx: await signRequest(again.tx, pk) });
    assert.ok((await ws.waitT('placed', 10_000)).tx, 'placed on the second try');
    // a test user is still relay-signed
    const ana = await WsClient.connect(base, 'ana.realsies.testnet');
    await ana.waitT('welcome', 5000);
    ana.close();
    ws.close();
  } finally {
    await app.close();
  }
});
