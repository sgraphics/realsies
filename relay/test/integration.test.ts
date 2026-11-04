// The full scenario against a real relay process (in-process) on the mock chain and mock NEAR AI
// signer, with fast timings. The same scenario runs against testnet in test/e2e.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, type App } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import { MockNearAi } from '../src/nearai/client.js';
import type { ChainAdapter } from '../src/chain/types.js';
import type { NearAi } from '../src/nearai/client.js';
import { runScenario } from './scenario.js';
import { WsClient, http } from './client.js';

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-relay-'));
  return path.join(dir, 'relay.db');
}

async function startApp(extra: Record<string, unknown> = {}, deps: { chain?: ChainAdapter; ai?: NearAi } = {}): Promise<App> {
  return createApp({
    port: 0,
    dbPath: tmpDb(),
    chain: 'mock',
    nearAi: 'mock',
    chatSeconds: 30,
    callSeconds: 5,
    botTimeScale: 0.08,
    searchDelay: [0.2, 0.5],
    devCallSeconds: 2,
    partnerLeftSeconds: 1,
    logLevel: 'warn',
    webDist: path.join(os.tmpdir(), 'no-web-dist'),
    ...extra,
  }, deps);
}

test('full scenario on the mock chain', { timeout: 120_000 }, async () => {
  const app = await startApp();
  try {
    const base = `http://localhost:${app.port}`;
    const report = await runScenario({
      base,
      views: app.chain,
      users: ['ana.realsies.testnet', 'ben.realsies.testnet', 'cleo.realsies.testnet'],
      promo: app.chain.accounts.promo,
      timeouts: { ready: 20_000, match: 15_000, placed: 15_000, botReply: 15_000, results: 60_000 },
      log: () => {},
    });
    assert.ok(report.checks.length > 60, `ran ${report.checks.length} checks`);
  } finally {
    await app.close();
  }
});

test('natural round end, seal completion as the proof, model failures stay silent', { timeout: 90_000 }, async () => {
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const ai = new MockNearAi();
  const app = await startApp({ roundMinutes: 0.6, chatSeconds: 6, callSeconds: 2 }, { chain, ai });
  try {
    const base = `http://localhost:${app.port}`;
    const C = 'finn.realsies.testnet';
    await http(base, 'POST', `/api/test-users/${C}/faucet`, { coins: 150 });
    const c = await WsClient.connect(base, C);
    const w = await c.waitT('welcome', 5000);
    const R = w.round.roundId;
    c.send({ t: 'enter_room', level: 3 });
    await c.waitT('room', 3000);
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // paid bot chat: the player speaks and the chat ends before any reply, so a final unshown completion seals the transcript
    c.send({ t: 'pick_seat', level: 3, seatIndex: 0, mode: 'paid', coins: 100 });
    const m = (await c.waitT('matched', 10_000)).chat;
    await c.waitT('chat_started', 10_000, (x) => x.chatId === m.chatId);
    c.send({ t: 'say', chatId: m.chatId, text: 'quick question, are you a bot?' });
    c.send({ t: 'dev_end_chat', chatId: m.chatId });
    await c.waitT('chat_ended', 3000, (x) => x.chatId === m.chatId);
    c.send({ t: 'call', chatId: m.chatId, human: false });
    assert.ok((await c.waitT('call_recorded', 5000, (x) => x.chatId === m.chatId)).tx);
    // free bot chat with two model failures: the opener attempt fails twice and the bot stays silent
    await new Promise((r) => setTimeout(r, 1500)); // let the seal completion finish first
    ai.failNext = 2;
    c.send({ t: 'pick_seat', level: 3, seatIndex: 1, mode: 'free' });
    const f = (await c.waitT('matched', 10_000)).chat;
    await c.waitT('chat_started', 10_000, (x) => x.chatId === f.chatId);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(c.msgs.filter((x) => x.t === 'message' && x.chatId === f.chatId).length, 0, 'silent after two failures');
    c.send({ t: 'say', chatId: f.chatId, text: 'hello?' });
    await c.waitT('message', 8000, (x) => x.chatId === f.chatId && x.msg.from === 'them');
    // the room closes at acceptingUntil, the round ends on its own, the next one starts and pushes a fresh room
    const closing = await c.waitT('round', 30_000, (x) => x.round.roundId === R && x.round.status === 'closing');
    assert.equal(closing.round.status, 'closing');
    c.send({ t: 'pick_seat', level: 3, seatIndex: 2, mode: 'free' });
    assert.equal((await c.waitT('error', 3000, (x) => x.code === 'round_closed')).code, 'round_closed');
    const next = await c.waitT('round', 40_000, (x) => x.round.roundId === R + 1);
    assert.equal(next.round.status, 'open');
    const room = await c.waitT('room', 5000, (x) => x.roundId === R + 1);
    assert.equal(room.seats[0].state, 'open');
    await c.waitT('results_ready', 40_000, (x) => x.roundId === R);
    const res = await http<any>(base, 'GET', `/api/rounds/${R}/results/${C}`);
    const paid = res.chats.find((x: any) => x.mode === 'paid');
    assert.equal(paid.right, true);
    assert.equal(paid.coinsDelta, -5, 'refund minus the 5% fee of 100 coins');
    const b = await http<any>(base, 'GET', `/api/verify/${m.chatId}?account=${C}`);
    const last = b.completions[b.completions.length - 1];
    assert.deepEqual(last.displayed, [], 'the seal completion is not shown');
    assert.equal(b.proofCompletionIndex, last.index, 'the proof is the last signed completion');
    assert.ok(JSON.parse(last.request).messages.some((x: any) => x.content === 'quick question, are you a bot?'), 'it carries the last player line');
    const plays = await chain.getRoundPlays(R);
    assert.equal(plays[0].characterId !== null, true, 'the seal proof assigned the play on chain');
    c.close();
  } finally {
    await app.close();
  }
});

test('partner_left, reconnect resumes the chat, room_empty, bad input', { timeout: 60_000 }, async () => {
  const app = await startApp({ chatSeconds: 60 });
  try {
    const base = `http://localhost:${app.port}`;
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const a = await WsClient.connect(base, 'dex.realsies.testnet');
    const b = await WsClient.connect(base, 'eve.realsies.testnet');
    await a.waitT('welcome', 5000);
    await b.waitT('welcome', 5000);
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if ((s.characters['human-committed'] ?? 0) >= 2) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    // bad input is reported, not fatal
    a.send({ t: 'pick_seat', level: 1, seatIndex: 12, mode: 'free' });
    assert.equal((await a.waitT('error', 3000)).code, 'bad_seat');
    a.send({ t: 'pick_seat', level: 1, seatIndex: 3, mode: 'paid', coins: 5 });
    assert.equal((await a.waitT('error', 3000)).code, 'insufficient_balance');

    a.send({ t: 'pick_seat', level: 2, seatIndex: 3, mode: 'free' });
    b.send({ t: 'pick_seat', level: 2, seatIndex: 4, mode: 'free' });
    const ma = (await a.waitT('matched', 10_000)).chat;
    const mb = (await b.waitT('matched', 10_000)).chat;
    await a.waitT('chat_started', 5000);
    await b.waitT('chat_started', 5000);
    a.send({ t: 'say', chatId: ma.chatId, text: 'brb' });
    await b.waitT('message', 3000, (m) => m.chatId === mb.chatId);
    // A reloads: welcome resumes the chat with its messages
    a.close();
    const a2 = await WsClient.connect(base, 'dex.realsies.testnet');
    const w = await a2.waitT('welcome', 5000);
    assert.equal(w.activeChat?.chatId, ma.chatId);
    assert.equal(w.activeChat?.phase, 'chatting');
    assert.equal(w.activeChat?.messages[0].text, 'brb');
    // B leaves for longer than PARTNER_LEFT_SECONDS
    b.close();
    const ended = await a2.waitT('chat_ended', 8000, (m) => m.chatId === ma.chatId);
    assert.equal(ended.reason, 'partner_left');
    a2.send({ t: 'call', chatId: ma.chatId, human: true });
    assert.equal((await a2.waitT('call_recorded', 3000)).human, true);
    // the room seat now shows the call
    a2.send({ t: 'enter_room', level: 2 });
    const room = await a2.waitT('room', 3000);
    assert.equal(room.seats[3].state, 'called');
    assert.equal(room.seats[3].myCall, true);
    assert.equal(room.seats.length, 10);
    a2.send({ t: 'ping' });
    await a2.waitT('pong', 2000);
    a2.close();
  } finally {
    await app.close();
  }
});
