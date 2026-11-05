// Remote brains over /bot/ws against an in-process relay (mock chain, mock NEAR AI signer):
// token auth, the event stream of the botmaster's chats, intent-only actions, free text rejected,
// unknown chats rejected, and the default brain taking over on disconnect and on silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { createApp, type App } from '../src/app.js';
import { tokenHash } from '../src/bot/remote.js';
import { WsClient, http } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = 'acme-test-token-0123456789abcdef';

class Botmaster {
  msgs: any[] = [];
  closed = false;
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  private used = new Set<number>();
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      const i = this.msgs.push(m) - 1;
      for (const w of [...this.waiters]) {
        if (!this.used.has(i) && w.pred(m)) {
          this.used.add(i);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
          break;
        }
      }
    });
    ws.on('close', () => (this.closed = true));
  }
  static open(base: string, headers: Record<string, string> = {}): Promise<Botmaster> {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/bot/ws', { headers });
    const b = new Botmaster(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
    });
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  wait(pred: (m: any) => boolean, ms: number, label: string): Promise<any> {
    for (let i = 0; i < this.msgs.length; i++) {
      if (!this.used.has(i) && pred(this.msgs[i])) {
        this.used.add(i);
        return Promise.resolve(this.msgs[i]);
      }
    }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m: any) => (clearTimeout(t), resolve(m)) };
      const t = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`botmaster: timed out waiting for ${label}; last: ${this.msgs.slice(-5).map((m) => JSON.stringify(m).slice(0, 140)).join(' | ')}`));
      }, ms);
      this.waiters.push(w);
    });
  }
  /** `wait` actions as a keepalive, so the relay does not hand the chat to the default brain. */
  keepalive(chatId: string, everyMs: number): () => void {
    const t = setInterval(() => {
      if (!this.closed) this.send({ type: 'action', chatId, action: { type: 'wait' } });
    }, everyMs);
    return () => clearInterval(t);
  }
  event(chatId: string, type: string, ms: number, extra: (e: any) => boolean = () => true): Promise<any> {
    return this.wait((m) => m.type === 'event' && m.chatId === chatId && m.event.type === type && extra(m.event), ms, `${type} in ${chatId}`).then((m) => m.event);
  }
  close(): void {
    this.ws.close();
  }
}

async function setup(): Promise<{ app: App; base: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-remote-'));
  const personas = path.join(dir, 'personas');
  const botmasters = path.join(dir, 'botmasters');
  fs.mkdirSync(personas);
  fs.mkdirSync(botmasters);
  const mia = JSON.parse(fs.readFileSync(path.resolve(here, '../personas/mia-leeds.json'), 'utf8'));
  fs.writeFileSync(path.join(personas, 'mia-leeds.json'), JSON.stringify({ ...mia, brain: { remote: 'acme' } }));
  fs.writeFileSync(path.join(botmasters, 'acme.json'), JSON.stringify({ name: 'acme', tokenSha256: tokenHash(TOKEN), personas: ['mia-leeds'], silenceMs: 8000 }));
  const app = await createApp({
    port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 40, callSeconds: 5, botTimeScale: 0.25,
    searchDelay: [0.2, 0.4], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'error', devTraces: true, webDist: path.join(dir, 'no-web'),
    personasDir: personas, botmastersDir: botmasters, castSize: 0, countdownSeconds: 1,
  });
  const base = `http://localhost:${app.port}`;
  for (let i = 0; i < 40; i++) {
    const s = await http<any>(base, 'GET', '/api/dev/state');
    if (s.round?.ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return { app, base };
}

async function botChat(base: string, account: string, level: 1 | 2): Promise<{ c: WsClient; chatId: string }> {
  const c = await WsClient.connect(base, account);
  await c.waitT('welcome', 5000);
  for (let i = 0; i < 40; i++) {
    const s = await http<any>(base, 'GET', '/api/dev/state');
    if (s.online.includes(account) && (s.characters['human-committed'] ?? 0) >= 1) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  c.send({ t: 'pick_seat', level, seatIndex: 0, mode: 'free' });
  const m = await c.waitT('matched', 10_000);
  await c.waitChatStart(m.chat.chatId, 10_000);
  return { c, chatId: m.chat.chatId };
}

test('the example remote brain (examples/remote-brain.mjs) plays a chat', { timeout: 90_000 }, async () => {
  const { app, base } = await setup();
  const child = spawn(process.execPath, [path.resolve(here, '../examples/remote-brain.mjs')], {
    env: { ...process.env, RELAY: base.replace(/^http/, 'ws') + '/bot/ws', TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  try {
    for (let i = 0; i < 50 && !out.includes('connected as acme'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /connected as acme, driving mia-leeds \(steer-v1\)/);
    const { c, chatId } = await botChat(base, 'dex.realsies.testnet', 1);
    const until = async (re: RegExp, label: string) => {
      for (let i = 0; i < 200 && !re.test(out); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(out, re, label);
    };
    await until(/say opener[\s\S]*say 1 done/, 'the opener was said');
    c.send({ t: 'say', chatId, text: 'hi! where are you from?' });
    await until(/player: hi! where are you from\?[\s\S]*say (reply|probe)[\s\S]*say 2 done/, 'then a reply or probe');
    c.send({ t: 'dev_end_chat', chatId });
    await c.waitT('chat_ended', 3000);
    await new Promise((r) => setTimeout(r, 300));
    const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${chatId}`);
    assert.equal(trace.brain, 'remote');
    assert.equal(trace.stats.fallbacks, 0, `no fallback; brain log:\n${out}`);
    assert.ok(trace.stats.kept >= 2);
    assert.match(out, /player: hi! where are you from\?/);
    c.close();
  } finally {
    child.kill();
    await app.close();
  }
});

test('remote brain: auth, events, intent-only actions, fallback on disconnect and on silence', { timeout: 120_000 }, async () => {
  const { app, base } = await setup();
  try {
    // a wrong token is refused
    const bad = await Botmaster.open(base);
    bad.send({ type: 'hello', token: 'not-the-token-at-all-000000' });
    assert.equal((await bad.wait((m) => m.type === 'error', 3000, 'unauthorized')).code, 'unauthorized');
    for (let i = 0; i < 20 && !bad.closed; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(bad.closed, 'socket closed after a bad token');

    // the right token as a bearer header
    const bm = await Botmaster.open(base, { Authorization: `Bearer ${TOKEN}` });
    const welcome = await bm.wait((m) => m.type === 'welcome', 3000, 'welcome');
    assert.equal(welcome.botmaster, 'acme');
    assert.deepEqual(welcome.personas, ['mia-leeds']);
    assert.equal(welcome.steerVersion, 'steer-v1');
    assert.equal(welcome.silenceMs, 8000, 'the botmaster file sets its silence limit');
    assert.ok(welcome.intents.includes('probe') && welcome.limits.maxSaysPerMinute > 0);

    // a chat with the remote persona streams its events to the botmaster
    const { c, chatId } = await botChat(base, 'ana.realsies.testnet', 1);
    const started = await bm.event(chatId, 'chat_started', 5000);
    const stopKeepalive = bm.keepalive(chatId, 800);
    assert.equal(started.persona.id, 'mia-leeds');
    assert.ok(started.chatMs > 100_000, 'brain time: 40 s at scale 0.25 is a 160 s chat');
    assert.equal(started.persona.prompt, undefined, 'the prompt is never sent to a brain');
    await bm.event(chatId, 'tick', 3000);

    // free text is refused: a say carries an intent, never words
    bm.send({ type: 'action', chatId, action: { type: 'say', intent: 'opener', text: 'hello from a human ghost-writer' } });
    const rej = await bm.event(chatId, 'action_rejected', 3000);
    assert.match(rej.reason, /free_text_not_allowed/);
    bm.send({ type: 'action', chatId, action: { type: 'say', intent: 'sing_a_song' } });
    assert.match((await bm.event(chatId, 'action_rejected', 3000)).reason, /unknown intent/);
    bm.send({ type: 'action', chatId: 'not-a-chat', action: { type: 'wait' } });
    assert.equal((await bm.wait((m) => m.type === 'error' && m.code === 'unknown_chat', 3000, 'unknown_chat')).code, 'unknown_chat');

    // fake typing, then a real say: typing reaches the player, then the signed text
    bm.send({ type: 'action', chatId, action: { type: 'typing', on: true, ms: 1500 } });
    await c.waitT('typing', 3000, (x) => x.chatId === chatId && x.on);
    await c.waitT('typing', 3000, (x) => x.chatId === chatId && !x.on);
    bm.send({ type: 'action', chatId, action: { type: 'say', intent: 'opener', typing: { cps: 6 } } });
    const sayStarted = await bm.event(chatId, 'say_started', 3000);
    assert.equal(sayStarted.intent.intent, 'opener');
    await c.waitT('typing', 3000, (x) => x.chatId === chatId && x.on);
    const shown = await bm.event(chatId, 'bot_message_shown', 15_000);
    const msg = await c.waitT('message', 3000, (x) => x.chatId === chatId && x.msg.from === 'them');
    assert.equal(msg.msg.text, shown.text);
    await bm.event(chatId, 'say_done', 10_000);
    // a second say while one runs is refused as busy
    bm.send({ type: 'action', chatId, action: { type: 'say', intent: 'probe' } });
    bm.send({ type: 'action', chatId, action: { type: 'say', intent: 'probe' } });
    assert.equal((await bm.event(chatId, 'action_rejected', 3000)).reason, 'busy');
    await bm.event(chatId, 'say_done', 15_000);

    // the player writes; the botmaster sees it
    c.send({ t: 'typing', chatId, on: true });
    assert.equal((await bm.event(chatId, 'player_typing', 3000)).on, true);
    c.send({ t: 'say', chatId, text: 'hey are you a bot' });
    assert.equal((await bm.event(chatId, 'player_message', 3000)).text, 'hey are you a bot');

    // the botmaster disconnects: the default brain takes over and answers
    stopKeepalive();
    bm.close();
    const before = c.msgs.filter((x) => x.t === 'message' && x.chatId === chatId && x.msg.from === 'them').length;
    await c.waitT('message', 20_000, (x) => x.chatId === chatId && x.msg.from === 'them' && c.msgs.filter((y) => y.t === 'message' && y.chatId === chatId && y.msg.from === 'them').length > before);
    c.send({ t: 'dev_end_chat', chatId });
    await c.waitT('chat_ended', 3000, (x) => x.chatId === chatId);
    await new Promise((r) => setTimeout(r, 300));
    const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${chatId}`);
    assert.equal(trace.brain, 'remote');
    assert.equal(trace.stats.fallbacks, 1);
    assert.ok(trace.trace.some((e: any) => e.k === 'brain' && /disconnected/.test(e.d.fallback ?? '')), 'fallback after the disconnect');
    c.close();

    // a connected botmaster that stays silent is replaced after silenceMs (8 s brain = 2 s here)
    const bm2 = await Botmaster.open(base);
    bm2.send({ type: 'hello', token: TOKEN });
    await bm2.wait((m) => m.type === 'welcome', 3000, 'welcome');
    const second = await botChat(base, 'ben.realsies.testnet', 1);
    await bm2.event(second.chatId, 'chat_started', 5000);
    const notice = await bm2.wait((m) => m.type === 'error' && m.code === 'fallback' && m.chatId === second.chatId, 8000, 'fallback notice');
    assert.match(notice.message, /no action for 8 s/);
    await second.c.waitT('message', 20_000, (x) => x.chatId === second.chatId && x.msg.from === 'them');
    second.c.send({ t: 'dev_end_chat', chatId: second.chatId });
    await second.c.waitT('chat_ended', 3000);
    second.c.close();
    bm2.close();

    // offline botmaster at chat start: the default brain plays from the first second
    await new Promise((r) => setTimeout(r, 200));
    const third = await botChat(base, 'cleo.realsies.testnet', 2);
    await third.c.waitT('message', 20_000, (x) => x.chatId === third.chatId && x.msg.from === 'them');
    third.c.send({ t: 'dev_end_chat', chatId: third.chatId });
    await third.c.waitT('chat_ended', 3000);
    await new Promise((r) => setTimeout(r, 300));
    const t3 = await http<any>(base, 'GET', `/api/dev/bot-trace/${third.chatId}`);
    assert.equal(t3.brain, 'default');
    third.c.close();
  } finally {
    await app.close();
  }
});
