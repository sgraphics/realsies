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
import { cardProblem, runScenario } from './scenario.js';
import { WsClient, http } from './client.js';
import { failures, loadBrowserChecks } from './browser-checks.js';
import { STEERING_SHA256 } from '../src/bot/intents.js';
import { LIMITS } from '../src/bot/api.js';
import { charsOf } from '../src/bot/typing.js';
import type { CharacterRec, ChatSide } from '../src/game/types.js';

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
    countdownSeconds: 1,
    botTimeScale: 0.08,
    searchDelay: [0.2, 0.5],
    devCallSeconds: 2,
    partnerLeftSeconds: 1,
    logLevel: 'warn',
    devTraces: true,
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

    // the paid bot chat's bundle through the web app's own Verify checks (web/src/verify/checks.ts)
    const bundle = await http<any>(base, 'GET', `/api/verify/${report.bundleChatId}?account=cleo.realsies.testnet`);
    assert.equal(bundle.steering.version, 'steer-v1');
    assert.equal(bundle.steering.catalogueSha256, STEERING_SHA256);
    assert.ok(bundle.relayChecks.every((c: any) => c.ok && c.steeringOk), 'relay checks');
    const local = report.localTranscript;
    assert.ok(local.some((l) => l.from === 'them'), 'the player saw bot lines');
    const asIs = await loadBrowserChecks('as-is');
    if (asIs) {
      // today's checks pass everything except, once a request follows a steered one, the chain rule
      const groups = asIs.runChecks(bundle, { localTranscript: local });
      const f = failures(groups);
      const n = groups.flatMap((g) => g.checks).length;
      console.log(`  web checks as they are: ${n - f.length} of ${n} pass${f.length ? `; failing: ${f.join(' | ')}` : ''}`);
      assert.ok(f.every((x) => /Each request = previous request.*unexpected non-player turn/.test(x)), `only the chain rule may fail:\n${f.join('\n')}`);
    } else console.log('  web/src/verify/checks.ts not found: browser checks skipped');
    const patched = await loadBrowserChecks('patched');
    if (patched) {
      const groups = patched.runChecks(bundle, { localTranscript: local });
      console.log(`  web checks with the proposed steering change: ${groups.flatMap((g) => g.checks).filter((c) => c.status === 'pass').length} pass, ${failures(groups).length} fail`);
      assert.deepEqual(failures(groups), [], 'with the proposed change every browser check passes');
      const steer = groups.flatMap((g) => g.checks).find((c) => c.id === 'steering');
      assert.equal(steer?.status, 'pass');
      assert.equal(groups.find((g) => g.id === 'local')?.status, 'pass', 'your conversation matches the signed request');
    } else console.log('  checks.ts changed shape: the patched run is skipped');
  } finally {
    await app.close();
  }
});

test('a bot trace names the persona, so it is refused until the round settles', { timeout: 30_000 }, async () => {
  const app = await startApp({ devTraces: false });
  try {
    const base = `http://localhost:${app.port}`;
    const c = await WsClient.connect(base, 'eve.realsies.testnet');
    await c.waitT('welcome', 5000);
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    c.send({ t: 'pick_seat', level: 2, seatIndex: 0, mode: 'free' });
    const m = (await c.waitT('matched', 10_000)).chat;
    await c.waitT('chat_started', 10_000, (x) => x.chatId === m.chatId);
    c.send({ t: 'dev_end_chat', chatId: m.chatId });
    await c.waitT('chat_ended', 3000);
    await new Promise((r) => setTimeout(r, 300));
    await assert.rejects(http(base, 'GET', `/api/dev/bot-trace/${m.chatId}?account=eve.realsies.testnet`), /409.*not_settled/);
    await assert.rejects(http(base, 'GET', `/api/dev/bot-trace/${m.chatId}?account=ana.realsies.testnet`), /403.*forbidden/);
    const st = await http<any>(base, 'GET', '/api/bot/steering');
    assert.equal(st.entries.length, 37);
    assert.equal(st.sha256, STEERING_SHA256);
    c.close();
  } finally {
    await app.close();
  }
});

test('bot chats: typing shows before every bot line, at human speed; player typing reaches the bot', { timeout: 60_000 }, async () => {
  const scale = 0.25;
  const app = await startApp({ chatSeconds: 30, botTimeScale: scale });
  try {
    const base = `http://localhost:${app.port}`;
    const P = 'dex.realsies.testnet';
    const c = await WsClient.connect(base, P);
    await c.waitT('welcome', 5000);
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const seen: { t: string; on?: boolean; text?: string; at: number }[] = [];
    c.send({ t: 'pick_seat', level: 1, seatIndex: 5, mode: 'free' });
    const m = (await c.waitT('matched', 10_000)).chat;
    const st = await c.waitT('chat_started', 10_000, (x) => x.chatId === m.chatId);
    const t0 = st.startedAt;
    const off = (() => {
      const h = (ev: MessageEvent) => {
        const x = JSON.parse(String(ev.data));
        if (x.chatId !== m.chatId) return;
        if (x.t === 'typing') seen.push({ t: 'typing', on: x.on, at: Date.now() });
        if (x.t === 'message' && x.msg.from === 'them') seen.push({ t: 'message', text: x.msg.text, at: Date.now() });
      };
      (c as any).ws.addEventListener('message', h);
      return () => (c as any).ws.removeEventListener('message', h);
    })();
    await new Promise((r) => setTimeout(r, Math.max(0, t0 - Date.now()) + 4000));
    c.send({ t: 'typing', chatId: m.chatId, on: true });
    await new Promise((r) => setTimeout(r, 800));
    c.send({ t: 'say', chatId: m.chatId, text: 'hey, where are you from? what are you up to today' });
    await c.waitT('message', 15_000, (x) => x.chatId === m.chatId && x.msg.from === 'them' && x.msg.at > t0 + 4800);
    await new Promise((r) => setTimeout(r, 3000));
    off();
    c.send({ t: 'dev_end_chat', chatId: m.chatId });
    await c.waitT('chat_ended', 3000);
    await new Promise((r) => setTimeout(r, 300));
    const msgs = seen.filter((x) => x.t === 'message');
    assert.ok(msgs.length >= 2, `bot lines: ${msgs.length}`);
    let prev = t0;
    for (const msg of msgs) {
      // the first indicator-on since the previous bot line, and the indicator on right before this one
      const ons = seen.filter((x) => x.t === 'typing' && x.on && x.at >= prev && x.at <= msg.at);
      assert.ok(ons.length > 0, `typing shown before "${msg.text}"`);
      const typedMs = msg.at - ons[0].at;
      const floor = Math.max(LIMITS.minBubbleMs, (charsOf(msg.text!) / LIMITS.maxCps) * 1000) * scale;
      assert.ok(typedMs >= floor - 40, `"${msg.text}" after ${typedMs} ms of typing, floor ${floor}`);
      prev = msg.at;
    }
    const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${m.chatId}`);
    assert.ok(trace.trace.some((e: any) => e.k === 'event' && e.d.type === 'player_typing' && e.d.on), 'player typing reached the bot');
    assert.ok(trace.trace.some((e: any) => e.k === 'event' && e.d.type === 'player_message'), 'player message reached the bot');
    c.close();
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
    await c.waitChatStart(m.chatId, 10_000);
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
    await c.waitChatStart(f.chatId, 10_000);
    // the bot's first say (its opener) hits both failures; it shows nothing and backs off
    for (let i = 0; i < 100 && ai.failNext > 0; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(ai.failNext, 0, 'the bot tried to speak');
    await new Promise((r) => setTimeout(r, 400));
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
    await a.waitChatStart(ma.chatId, 5000);
    await b.waitChatStart(mb.chatId, 5000);
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

test('after results are stored the round is pruned on chain; results and bundles are still served', { timeout: 90_000 }, async () => {
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const app = await startApp({ chatSeconds: 8, pruneDelaySeconds: 0 }, { chain });
  try {
    const base = `http://localhost:${app.port}`;
    const C = 'finn.realsies.testnet';
    await http(base, 'POST', `/api/test-users/${C}/faucet`, { coins: 50 });
    const c = await WsClient.connect(base, C);
    const w = await c.waitT('welcome', 5000);
    const R = w.round.roundId;
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    c.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'paid', coins: 5 });
    const m = (await c.waitT('matched', 10_000)).chat;
    await c.waitChatStart(m.chatId, 10_000);
    c.send({ t: 'say', chatId: m.chatId, text: 'hi there' });
    await c.waitT('chat_ended', 20_000, (x) => x.chatId === m.chatId);
    c.send({ t: 'call', chatId: m.chatId, human: false });
    await c.waitT('call_recorded', 5000, (x) => x.chatId === m.chatId);
    const before = await chain.getRound(R);
    assert.ok((before?.characters ?? 0) > 1 && before?.plays === 1, `round ${R} stores characters and the play`);
    await http(base, 'POST', '/api/dev/end-round');
    await c.waitT('results_ready', 40_000, (x) => x.roundId === R);
    let after = await chain.getRound(R);
    for (let i = 0; i < 50 && (after?.plays !== 0 || after?.characters !== 0); i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = await chain.getRound(R);
    }
    assert.ok(after?.settled, 'the round record stays, settled');
    assert.deepEqual([after?.plays, after?.characters], [0, 0], 'plays and characters pruned');
    assert.deepEqual(await chain.getRoundPlays(R), []);
    assert.ok(chain.txLog.some((t) => t.method === 'prune_round' && t.ok));
    assert.ok(app.db.loadRound<any>(R)?.prunedAt, 'the relay recorded it');
    // everything the player sees comes from the relay's store, not from chain views
    const res = await http<any>(base, 'GET', `/api/rounds/${R}/results/${C}`);
    assert.equal(res.chats.find((x: any) => x.chatId === m.chatId)?.right, true);
    const b = await http<any>(base, 'GET', `/api/verify/${m.chatId}?account=${C}`);
    assert.ok(b.completions.length >= 1);
    // the next round is open and not pruned
    const next = await chain.getRound(R + 1);
    assert.ok(next && !next.settled && (next.characters ?? 0) > 0);
    c.close();
  } finally {
    await app.close();
  }
});

test('idle: no new round while nobody is connected; a connecting human starts one', { timeout: 90_000 }, async () => {
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  // 33 s rounds: setup sends start_round only while more than 30 s are left
  const app = await startApp({ roundMinutes: 0.55, chatSeconds: 5, callSeconds: 2, idleMinutes: 0.05 }, { chain });
  try {
    const base = `http://localhost:${app.port}`;
    let s = await http<any>(base, 'GET', '/api/dev/state');
    const R = s.round.roundId;
    assert.equal(s.idle, false, 'a fresh relay starts its first round');
    for (let i = 0; i < 40 && !(await chain.getRound(R)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await chain.getRound(R), 'round R went on chain');
    // nobody connects: round R ends and no round R + 1 starts
    const endsAt = s.round.endsAt;
    await new Promise((r) => setTimeout(r, Math.max(0, endsAt - Date.now()) + 2500));
    s = await http<any>(base, 'GET', '/api/dev/state');
    assert.equal(s.round, null, 'no current round');
    assert.equal(s.idle, true);
    assert.equal(await chain.getRound(R + 1), null, 'no start_round on chain');
    const txs = chain.txLog.length;
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(chain.txLog.filter((t, i) => i >= txs && (t.method === 'start_round' || t.method === 'commit_characters')).length, 0, 'no starts or commits while idle');
    // a human connects: a round starts right away and the welcome shows it
    const c = await WsClient.connect(base, 'ana.realsies.testnet');
    const w = await c.waitT('welcome', 10_000);
    assert.equal(w.round.roundId, R + 1);
    assert.equal(w.round.status, 'open');
    for (let i = 0; i < 40 && !(await chain.getRound(R + 1)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(await chain.getRound(R + 1), 'start_round sent');
    s = await http<any>(base, 'GET', '/api/dev/state');
    assert.equal(s.idle, false);
    c.close();
  } finally {
    await app.close();
  }
});

test('countdown: chat_started lies COUNTDOWN_SECONDS ahead; until then nobody types or speaks, human or bot, and timing is the same for both', { timeout: 60_000 }, async () => {
  const app = await startApp({ countdownSeconds: 3, chatSeconds: 20 });
  try {
    const base = `http://localhost:${app.port}`;
    assert.equal((await http<any>(base, 'GET', '/api/config')).countdownSeconds, 3);
    const [a, b, c] = await Promise.all(['dex', 'eve', 'finn'].map((u) => WsClient.connect(base, `${u}.realsies.testnet`)));
    for (const x of [a, b, c]) await x.waitT('welcome', 5000);
    for (let i = 0; i < 60; i++) {
      const st = await http<any>(base, 'GET', '/api/dev/state');
      if (st.round?.ready && (st.characters['human-committed'] ?? 0) >= 3) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // human to human
    a.send({ t: 'pick_seat', level: 2, seatIndex: 3, mode: 'free' });
    b.send({ t: 'pick_seat', level: 2, seatIndex: 4, mode: 'free' });
    const ma = (await a.waitT('matched', 10_000)).chat;
    const mb = (await b.waitT('matched', 10_000)).chat;
    const sa = await a.waitT('chat_started', 5000, (x) => x.chatId === ma.chatId);
    const sb = await b.waitT('chat_started', 5000, (x) => x.chatId === mb.chatId);
    assert.deepEqual([sa.startedAt, sa.endsAt], [sb.startedAt, sb.endsAt], 'one start and one end for both sides');
    assert.equal(sa.endsAt - sa.startedAt, 20_000, 'endsAt = startedAt + CHAT_SECONDS');
    const leadHuman = sa.startedAt - a.receivedAt(sa);
    assert.ok(leadHuman > 2500 && leadHuman <= 3050, `chat_started arrives the countdown ahead of startedAt (${leadHuman} ms)`);
    a.send({ t: 'typing', chatId: ma.chatId, on: true });
    a.send({ t: 'say', chatId: ma.chatId, text: 'too early?' });
    assert.equal((await a.waitT('error', 2000, (x) => x.code === 'chat_not_started')).code, 'chat_not_started');
    await a.untilStarted(sa);
    assert.ok(!b.msgs.some((x) => (x.t === 'typing' || x.t === 'message') && x.chatId === mb.chatId), 'typing and lines during the countdown never reach the partner');
    a.send({ t: 'typing', chatId: ma.chatId, on: true });
    assert.equal((await b.waitT('typing', 3000, (x) => x.chatId === mb.chatId)).on, true, 'after the countdown typing is relayed');
    a.send({ t: 'say', chatId: ma.chatId, text: 'ok now' });
    assert.equal((await b.waitT('message', 3000, (x) => x.chatId === mb.chatId)).msg.text, 'ok now');

    // a bot chat runs on the same clock: the bot cannot type or open before startedAt either
    c.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    const mc = (await c.waitT('matched', 10_000)).chat;
    const sc = await c.waitT('chat_started', 5000, (x) => x.chatId === mc.chatId);
    const leadBot = sc.startedAt - c.receivedAt(sc);
    assert.ok(Math.abs(leadBot - leadHuman) < 300, `same countdown for a bot chat (${leadBot} vs ${leadHuman} ms)`);
    assert.equal(sc.endsAt - sc.startedAt, 20_000);
    c.send({ t: 'say', chatId: mc.chatId, text: 'hello?' });
    assert.equal((await c.waitT('error', 2000, (x) => x.code === 'chat_not_started')).code, 'chat_not_started');
    c.send({ t: 'typing', chatId: mc.chatId, on: true });
    await c.untilStarted(sc);
    const early = c.msgs.filter((x) => (x.t === 'typing' || x.t === 'message') && x.chatId === mc.chatId && c.receivedAt(x) < sc.startedAt);
    assert.deepEqual(early, [], 'the bot neither typed nor spoke during the countdown');
    c.send({ t: 'say', chatId: mc.chatId, text: 'hi there, where are you from?' });
    const reply = await c.waitT('message', 15_000, (x) => x.chatId === mc.chatId && x.msg.from === 'them');
    assert.ok(reply.msg.at >= sc.startedAt, 'bot lines come after startedAt');
    c.send({ t: 'dev_end_chat', chatId: mc.chatId });
    await c.waitT('chat_ended', 3000, (x) => x.chatId === mc.chatId);
    await new Promise((r) => setTimeout(r, 300));
    const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${mc.chatId}`);
    const events = trace.trace.filter((e: any) => e.k === 'event').map((e: any) => e.d.type);
    assert.equal(events[0], 'chat_started', 'the brain hears of the chat first');
    // the only typing in this chat happened during the countdown
    assert.ok(!trace.trace.some((e: any) => e.k === 'event' && e.d.type === 'player_typing'), 'typing during the countdown never reached the brain');
    for (const x of [a, b, c]) x.close();
  } finally {
    await app.close();
  }
});

test('persona cards: every demo bot has one; results and bundles reveal it only after settlement', { timeout: 90_000 }, async () => {
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const app = await startApp({ chatSeconds: 8 }, { chain });
  try {
    const base = `http://localhost:${app.port}`;
    const C = 'finn.realsies.testnet';
    await http(base, 'POST', `/api/test-users/${C}/faucet`, { coins: 50 });
    const c = await WsClient.connect(base, C);
    const w = await c.waitT('welcome', 5000);
    const R = w.round.roundId;
    for (let i = 0; i < 40; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    // the round's cast: the personas folder plus fresh generated people, all with a full card
    const bots = [...app.game.chars.get(R)!.values()].filter((x: CharacterRec) => x.kind === 'bot');
    const gen = bots.filter((x) => x.persona?.source === 'generated');
    assert.equal(new Set(gen.map((x) => x.personaId)).size, app.cfg.genPersonas, 'GEN_PERSONAS generated personas, one character each');
    for (const x of bots) assert.equal(cardProblem(x.card), null, `${x.personaId}: card ${JSON.stringify(x.card)}`);
    assert.ok(app.db.loadRound<any>(R)?.castSeed, 'the cast seed is stored with the round');
    const again = app.game.castOf(app.game.rounds.get(R)!).filter((p) => p.source === 'generated');
    assert.deepEqual(again.map((p) => [p.id, p.promptHash]), gen.map((x) => [x.personaId, x.promptHash]), 'the seed regenerates the same people and prompts');

    c.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'paid', coins: 5 });
    const m = (await c.waitT('matched', 10_000)).chat;
    await c.waitChatStart(m.chatId, 10_000);
    c.send({ t: 'say', chatId: m.chatId, text: 'hey, where are you from?' });
    await c.waitT('message', 10_000, (x) => x.chatId === m.chatId && x.msg.from === 'them');
    c.send({ t: 'dev_end_chat', chatId: m.chatId });
    await c.waitT('chat_ended', 3000, (x) => x.chatId === m.chatId);
    c.send({ t: 'call', chatId: m.chatId, human: false });
    await c.waitT('call_recorded', 5000, (x) => x.chatId === m.chatId);

    // during the round: no card anywhere a player can look
    const early = await http<any>(base, 'GET', `/api/rounds/${R}/results/${C}`);
    assert.equal(early.chats.length, 0);
    assert.ok(!JSON.stringify(early).includes('mbti'));
    await assert.rejects(http(base, 'GET', `/api/verify/${m.chatId}?account=${C}`), /409.*not_settled/);
    assert.ok(!c.msgs.some((x) => JSON.stringify(x).includes('"mbti"')), 'no card over the socket');

    await http(base, 'POST', '/api/dev/end-round');
    await c.waitT('results_ready', 40_000, (x) => x.roundId === R);
    const res = await http<any>(base, 'GET', `/api/rounds/${R}/results/${C}`);
    const chat = res.chats.find((x: any) => x.chatId === m.chatId);
    assert.equal(cardProblem(chat.persona), null, JSON.stringify(chat.persona));
    const side = app.db.loadChat<ChatSide>(m.chatId)!;
    const ch = bots.find((x) => x.id === side.characterId)!;
    assert.deepEqual(chat.persona, ch.card, 'the card of the character the player met');
    const b = await http<any>(base, 'GET', `/api/verify/${m.chatId}?account=${C}`);
    assert.deepEqual(b.persona, chat.persona, 'the bundle carries the same card');
    assert.ok(b.personaPrompt.includes(`${b.persona.age}-year-old`) && b.personaPrompt.includes(b.persona.home), 'the card describes the committed prompt');
    c.close();
  } finally {
    await app.close();
  }
});
