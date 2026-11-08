// The testnet beta's NEAR AI spend cap (BETA_SPEND_CAP_USD): the relay closes the beta within one completion of
// the cap, pushes PublicConfig.betaClosed to every connection, refuses new chats and new sign-ins (beta_closed),
// lets running chats finish and the round settle, starts no new round, and reopens when the operator raises the cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, type App } from '../src/app.js';
import type { Config } from '../src/config.js';
import { MockChain } from '../src/chain/mock.js';
import { MockNearAi } from '../src/nearai/client.js';
import { WsClient } from './client.js';

const ADMIN = 'admin-token-for-beta-tests-0123456789';
const REDIRECT = 'https://realsies.lol';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(base: string, method: string, p: string, o: { token?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${base}${p}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const t = await r.text();
  let body: any = t;
  try {
    body = JSON.parse(t);
  } catch {
    /* text */
  }
  return { status: r.status, body };
}

async function until<T>(f: () => Promise<T> | T, ok: (v: T) => boolean, ms: number, label: string): Promise<T> {
  const end = Date.now() + ms;
  let v = await f();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(v)?.slice(0, 300)}`);
    await sleep(100);
    v = await f();
  }
  return v;
}

async function setup(extra: Partial<Config>): Promise<{ app: App; base: string; chain: MockChain }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-beta-'));
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const ai = new MockNearAi();
  ai.latencyMs = [20, 80];
  const app = await createApp(
    {
      port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 30, callSeconds: 5, countdownSeconds: 1, botTimeScale: 0.08,
      searchDelay: [0.3, 0.5], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'error', devTraces: true, webDist: path.join(dir, 'no-web'),
      botmastersDir: path.join(dir, 'botmasters'), castSize: 6, adminToken: ADMIN, betaSpendCapUsd: undefined, betaClosedRedirect: REDIRECT, ...extra,
    },
    { chain, ai },
  );
  return { app, base: `http://localhost:${app.port}`, chain };
}

const state = async (base: string) => (await api(base, 'GET', '/api/dev/state')).body;

async function players(base: string, accounts: string[]): Promise<WsClient[]> {
  const cs = await Promise.all(accounts.map((a) => WsClient.connect(base, a)));
  for (const c of cs) await c.waitT('welcome', 5000);
  await until(() => state(base), (s) => !!s.round?.ready && (s.characters['human-committed'] ?? 0) >= accounts.length, 15_000, 'round ready, humans committed');
  return cs;
}

test('the beta closes within one completion of its spend cap: config pushed, no new chats or sign-ins, running chats finish, no new round; reopen', { timeout: 120_000 }, async () => {
  // a cap of a millionth of a dollar: the bot's first completion crosses it
  const { app, base } = await setup({ betaSpendCapUsd: 0.000001 });
  const clients: WsClient[] = [];
  try {
    assert.equal((await api(base, 'GET', '/api/config')).body.betaClosed, undefined, 'open at the start');
    assert.deepEqual((await api(base, 'GET', '/api/admin/health', { token: ADMIN })).body.beta, { capUsd: 0.000001, spendUsd: 0, closed: false });
    const [A, B] = ['ana', 'ben'].map((u) => `${u}.realsies.testnet`);
    const [ca, cb] = await players(base, [A, B]);
    clients.push(ca, cb);
    const R = (await state(base)).round.roundId;

    // ana's bot chat: its first signed line costs more than the cap
    ca.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    const m = (await ca.waitT('matched', 10_000)).chat;
    await ca.waitChatStart(m.chatId, 10_000);
    ca.send({ t: 'say', chatId: m.chatId, text: 'hey, where are you from?' });
    await ca.waitT('message', 15_000, (x) => x.chatId === m.chatId && x.msg.from === 'them');

    // closed: every connection gets the new config with betaClosed
    for (const c of [ca, cb]) {
      const pushed = await c.waitT('config', 5000, (x) => !!x.config.betaClosed);
      assert.deepEqual(pushed.config.betaClosed, { redirect: REDIRECT, reason: 'spend_cap' });
    }
    assert.deepEqual((await api(base, 'GET', '/api/config')).body.betaClosed, { redirect: REDIRECT, reason: 'spend_cap' });
    const beta = (await api(base, 'GET', '/api/admin/health', { token: ADMIN })).body.beta;
    assert.equal(beta.closed, true);
    assert.ok(beta.spendUsd >= beta.capUsd && beta.spendUsd < 0.001, `closed within one completion of the cap (spent $${beta.spendUsd})`);

    // the running chat finishes as normal: the bot still answers
    const before = ca.msgs.filter((x) => x.t === 'message' && x.chatId === m.chatId && x.msg.from === 'them').length;
    ca.send({ t: 'say', chatId: m.chatId, text: 'still there?' });
    await until(() => ca.msgs.filter((x) => x.t === 'message' && x.chatId === m.chatId && x.msg.from === 'them').length, (n) => n > before, 15_000, 'the bot answers in the running chat');

    // no new chats: a pick gets beta_closed at once and the seat stays open; no new sign-ins either
    cb.send({ t: 'pick_seat', level: 2, seatIndex: 0, mode: 'free' });
    const err = await cb.waitT('error', 3000, (x) => x.code === 'beta_closed');
    assert.equal(err.message, 'The beta test is over. Thanks for playing! See you on mainnet.');
    assert.ok(!cb.msgs.some((x) => x.t === 'searching' || x.t === 'matched'));
    await cb.waitT('seat', 3000, (x) => x.level === 2 && x.seat.index === 0 && x.seat.state === 'open');
    const signIn = await api(base, 'POST', '/api/auth/challenge');
    assert.deepEqual([signIn.status, signIn.body.code], [403, 'beta_closed']);
    assert.equal((await api(base, 'POST', '/api/auth/verify', { body: {} })).body.code, 'beta_closed');

    // the round settles normally, and no new round starts
    ca.send({ t: 'dev_end_chat', chatId: m.chatId });
    await ca.waitT('chat_ended', 5000, (x) => x.chatId === m.chatId);
    ca.send({ t: 'call', chatId: m.chatId, human: false });
    await ca.waitT('call_recorded', 5000, (x) => x.chatId === m.chatId);
    await api(base, 'POST', '/api/dev/end-round');
    await ca.waitT('results_ready', 60_000, (x) => x.roundId === R);
    assert.equal((await api(base, 'GET', `/api/rounds/${R}/results/${A}`)).body.chats.find((x: any) => x.chatId === m.chatId)?.right, true, 'results as usual');
    await sleep(500);
    assert.equal((await state(base)).round, null, 'no new round');
    assert.equal((await api(base, 'GET', '/api/rounds')).body[0].roundId, R);

    // reopen: the operator raises the cap; the config is pushed without betaClosed and a new round starts
    assert.equal((await api(base, 'POST', '/api/admin/beta/reopen', { body: { addUsd: 5 } })).status, 401);
    assert.equal((await api(base, 'POST', '/api/admin/beta/reopen', { token: ADMIN, body: {} })).body.field, 'addUsd');
    assert.equal((await api(base, 'POST', '/api/admin/beta/reopen', { token: ADMIN, body: { addUsd: -1 } })).status, 400);
    const reopened = (await api(base, 'POST', '/api/admin/beta/reopen', { token: ADMIN, body: { addUsd: 5 } })).body.beta;
    assert.deepEqual([reopened.closed, reopened.capUsd], [false, 5.000001]);
    await cb.waitT('config', 5000, (x) => !x.config.betaClosed);
    assert.equal((await api(base, 'GET', '/api/config')).body.betaClosed, undefined);
    const s = await until(() => state(base), (x) => !!x.round && x.round.roundId > R && x.round.ready, 20_000, 'a new round');
    assert.ok(s.round.roundId > R);
    assert.equal(app.db.getKv('beta_cap_add_usd'), '5', 'the raise is kept across restarts');
    await until(() => state(base), (x) => (x.characters['human-committed'] ?? 0) >= 2, 15_000, 'humans committed');
    cb.send({ t: 'pick_seat', level: 2, seatIndex: 1, mode: 'free' });
    assert.ok((await cb.waitT('matched', 10_000)).chat.chatId, 'new chats again');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test('the beta cap: off without BETA_SPEND_CAP_USD; a search under way ends when the beta closes', { timeout: 60_000 }, async () => {
  const off = await setup({});
  try {
    assert.equal((await api(off.base, 'GET', '/api/config')).body.betaClosed, undefined);
    assert.equal((await api(off.base, 'GET', '/api/admin/health', { token: ADMIN })).body.beta, null);
    assert.deepEqual((await api(off.base, 'POST', '/api/admin/beta/reopen', { token: ADMIN, body: { addUsd: 1 } })).body.code, 'beta_cap_off');
  } finally {
    await off.app.close();
  }
  const { app, base } = await setup({ betaSpendCapUsd: 2, searchDelay: [1.5, 1.5] });
  const clients: WsClient[] = [];
  try {
    const [cd] = await players(base, ['dex.realsies.testnet']);
    clients.push(cd);
    cd.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    await cd.waitT('searching', 3000);
    app.credits.addSpend('house', 2.5, 1); // spend recorded while the search runs: the beta closes at once
    assert.equal((await cd.waitT('error', 3000, (x) => x.code === 'beta_closed')).code, 'beta_closed');
    await sleep(2000);
    assert.ok(!cd.msgs.some((x) => x.t === 'matched'), 'the search ended without a match');
    assert.deepEqual((await api(base, 'GET', '/api/config')).body.betaClosed?.reason, 'spend_cap');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});
