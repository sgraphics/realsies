// The practice chat (protocol v1.14): one free try for a visitor without a wallet. A house bot that is not in the
// running round, the same bot engine, the reveal right after the call with the persona card; no rating, no balance, no
// round record, nothing on chain. One a day per device and per IP, a cap a day for all, off with 0; a guest's socket
// takes messages and one call, nothing of the round; no practice chat while the bots are out of credits. The partner
// speaks the visitor's language (Accept-Language): a native house persona, else someone generated who speaks it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp, type App } from '../src/app.js';
import type { Config } from '../src/config.js';
import { MockChain } from '../src/chain/mock.js';
import { MockNearAi } from '../src/nearai/client.js';
import { loadPersonas } from '../src/personas.js';
import { MODELS } from '../src/models.js';
import { RELAY_ROOT } from '../src/config.js';
import { WsClient } from './client.js';
import { visitorLanguages, type PracticeRun } from '../src/game/practice.js';
import { chatCostUsd } from '../src/models.js';
import type { Persona } from '../src/personas.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEED = 'ab'.repeat(32);
const dev = (n: number) => `device-${String(n).padStart(10, '0')}`;

async function api(base: string, method: string, p: string, o: { body?: unknown; ip?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  // the relay trusts a forwarded address from a local proxy only, and the test talks to it over loopback
  if (o.ip) headers['X-Real-IP'] = o.ip;
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

async function setup(extra: Partial<Config> = {}): Promise<{ app: App; base: string; chain: MockChain; ai: MockNearAi }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-practice-'));
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const ai = new MockNearAi();
  ai.latencyMs = [20, 80];
  const app = await createApp(
    {
      port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 8, callSeconds: 4, countdownSeconds: 0.5, botTimeScale: 0.08,
      searchDelay: [0.3, 0.5], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'error', webDist: path.join(dir, 'no-web'),
      botmastersDir: path.join(dir, 'botmasters'), castSize: 6, betaSpendCapUsd: undefined, guestChatsPerDay: 1, guestChatsDailyCap: 300, ...extra,
    },
    { chain, ai },
  );
  return { app, base: `http://localhost:${app.port}`, chain, ai };
}

const state = async (base: string) => (await api(base, 'GET', '/api/dev/state')).body;
const rows = (app: App, table: string): number => Number((app.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

const HOUSE = loadPersonas(path.join(RELAY_ROOT, 'personas')).filter((p) => p.brain.kind === 'default' && p.person);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

test('a practice chat: a house bot that is not in the round, the reveal at once, and nothing of the round, the chain or the ratings moves', { timeout: 90_000 }, async () => {
  const { app, base, chain } = await setup();
  let g: WsClient | null = null;
  try {
    const cfg = (await api(base, 'GET', '/api/config')).body;
    assert.deepEqual(cfg.practice, { perDay: 1 }, 'PublicConfig.practice says the free try is on');
    await until(() => state(base), (s) => !!s.round?.ready, 20_000, 'round ready');
    const round = app.game.current!;
    const cast = [...app.game.chars.get(round.id)!.values()].filter((c) => c.kind === 'bot');
    const playing = new Set(cast.map((c) => c.personaId));
    const free = HOUSE.filter((p) => !playing.has(p.id));
    assert.ok(free.length > 0 && free.length < HOUSE.length, 'some hand-written personas play in this round, some do not');

    // what must not move: ratings and stats, the chain, the round's records
    const users = JSON.stringify([...app.game.users.values()]);
    const leaders = JSON.stringify((await api(base, 'GET', '/api/leaderboard')).body);
    const txs = chain.txLog.length;
    const balances = JSON.parse(chain.snapshot()).balances;
    const before = { chats: rows(app, 'chats'), messages: rows(app, 'messages'), results: rows(app, 'results'), ratings: rows(app, 'ratings'), bundles: rows(app, 'bundles'), characters: rows(app, 'characters') };

    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(1)}`)).body, { ok: true });
    const t = await api(base, 'POST', '/api/practice', { body: { device: dev(1), seed: SEED, level: 2 } });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.ok(typeof t.body.guest === 'string' && typeof t.body.ticket === 'string' && t.body.expiresAt > Date.now());
    g = await WsClient.connectPractice(base, t.body.ticket);
    const m = (await g.waitT('matched', 5000)).chat;
    assert.equal(m.partner.seed, SEED, 'the partner wears the look the guest tapped');
    assert.deepEqual([m.roundId, m.mode, m.coins, m.theme], [0, 'free', 0, app.game.roundState().themes[2]], 'no round id, free, the room theme of that level');
    const started = await g.waitChatStart(m.chatId, 5000);
    assert.equal(started.endsAt - started.startedAt, 8000, 'the same two minutes (here: CHAT_SECONDS)');
    g.send({ t: 'say', chatId: m.chatId, text: 'hey, where are you from?' });
    await g.waitT('message', 5000, (x) => x.msg.from === 'me');
    await g.waitT('typing', 15_000, (x) => x.on);
    const reply = await g.waitT('message', 15_000, (x) => x.msg.from === 'them');
    assert.ok(reply.msg.text.length > 0, 'the bot answers, signed like any bot line');

    const ended = await g.waitT('chat_ended', 15_000, (x) => x.chatId === m.chatId);
    assert.equal(ended.reason, 'time');
    g.send({ t: 'call', chatId: m.chatId, human: true });
    assert.equal((await g.waitT('call_recorded', 3000)).human, true);
    const { result } = await g.waitT('practice_result', 3000);
    assert.deepEqual([result.chatId, result.truth, result.myCall, result.right], [m.chatId, 'bot', true, false], 'it was a bot, and it fooled the guest');
    assert.ok(MODELS[result.model], 'the model is one the relay runs');
    assert.ok(free.some((p) => same(p.card, result.persona)), 'the reveal carries the card of a house persona that is not in this round');
    for (const c of cast) assert.ok(!same(result.persona, c.card), `never the card of a round character (${c.personaId})`);
    const said = JSON.stringify(g.msgs);
    assert.ok(!said.includes(round.secretHash) && !cast.some((c) => said.includes(c.id)), 'no round secret, no character id on the guest socket');
    assert.ok(!g.msgs.some((x) => ['welcome', 'round', 'room', 'seat', 'me', 'results_ready', 'config'].includes(x.t)), 'nothing of the round or a player on the guest socket');

    // nothing moved
    assert.equal(chain.txLog.length, txs, 'nothing sent to the chain');
    assert.deepEqual(JSON.parse(chain.snapshot()).balances, balances, 'no balance moved');
    assert.equal(JSON.stringify([...app.game.users.values()]), users, 'no rating, no stats, no new player');
    assert.equal(JSON.stringify((await api(base, 'GET', '/api/leaderboard')).body), leaders, 'no leaderboard row');
    assert.deepEqual(
      { chats: rows(app, 'chats'), messages: rows(app, 'messages'), results: rows(app, 'results'), ratings: rows(app, 'ratings'), bundles: rows(app, 'bundles'), characters: rows(app, 'characters') },
      before,
      'no round record: no chat, message, result, rating, bundle or character',
    );
    assert.equal((await api(base, 'GET', `/api/verify/${m.chatId}`)).status, 404, 'no public bundle');
    // the transcript is kept, flagged as practice, without the IP
    const row = app.db.sql.prepare('SELECT * FROM practice_chats WHERE chat_id = ?').get(m.chatId) as Record<string, any>;
    const doc = JSON.parse(row.data);
    assert.equal(row.status, 'done');
    assert.equal(doc.practice, true);
    assert.ok(doc.messages.some((x: any) => x.from === 'me' && x.text === 'hey, where are you from?') && doc.messages.some((x: any) => x.from === 'them'), 'both sides of the transcript');
    assert.ok(!/127\.0\.0\.1|::1/.test(JSON.stringify(row)), 'the IP only as its keyed hash');
    assert.ok(app.db.loadCompletions(m.chatId).some((c) => !!c.signature), 'the bot lines came from signed completions');

    // the try is used now, for this device
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(1)}`)).body, { ok: false, reason: 'practice_used' });
    // a missed call reveals too: a second relay day is not needed, a second device from another IP is enough
    const t2 = await api(base, 'POST', '/api/practice', { body: { device: dev(2), seed: SEED, level: 1 }, ip: '198.51.100.7' });
    assert.equal(t2.status, 200);
  } finally {
    g?.close();
    await app.close();
  }
});

/** POST /api/practice with exactly these headers (fetch would add its own Accept-Language: *). */
function postRaw(base: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const u = new URL(`${base}/api/practice`);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let t = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (t += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(t) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

test("Accept-Language: the visitor's languages, most preferred first, as persona language codes", () => {
  assert.deepEqual(visitorLanguages('ar-EG,ar;q=0.9,en-US;q=0.8,en;q=0.7'), ['ar', 'en']);
  assert.deepEqual(visitorLanguages('ru-RU,ru;q=0.9'), ['ru']);
  assert.deepEqual(visitorLanguages('id-ID,id;q=0.9,en-US;q=0.8'), ['id', 'en']);
  assert.deepEqual(visitorLanguages('in-ID'), ['id'], 'the old code for Indonesian');
  assert.deepEqual(visitorLanguages('pt-BR'), ['pt']);
  assert.deepEqual(visitorLanguages('en-US,en;q=0.9'), ['en']);
  assert.deepEqual(visitorLanguages('en;q=0.5, ru'), ['ru', 'en'], 'by weight, not by order');
  assert.deepEqual(visitorLanguages('xx-YY, *;q=0.1, de;q=0, constructor, toString'), [], 'unknown tags, the wildcard and q=0 say nothing');
  assert.deepEqual(visitorLanguages(undefined), []);
  assert.deepEqual(visitorLanguages(''), []);
  assert.deepEqual(visitorLanguages(['ru'] as unknown), []);
});

test("the partner speaks the visitor's language: Accept-Language ar, ru, id, pt-BR pick a speaker; en-US or none pick as before", { timeout: 60_000 }, async () => {
  const { app, base } = await setup({ guestChatsPerDay: 100, chatSeconds: 4 });
  const clients: WsClient[] = [];
  try {
    await until(() => state(base), (s) => !!s.round?.ready, 20_000, 'round ready');
    const playing = new Set([...app.game.chars.get(app.game.current!.id)!.values()].filter((c) => c.kind === 'bot').map((c) => c.personaId));
    const free = HOUSE.filter((p) => !playing.has(p.id));
    const min = Math.min(...free.map((p) => chatCostUsd(p.model)));
    const asBefore = new Set(free.filter((p) => chatCostUsd(p.model) === min).map((p) => p.id));
    const speakers = (code: string, lv: string) => free.filter((p) => p.languages?.[code] === lv).map((p) => p.id);
    let n = 0;
    // the chat as a browser starts it: the header on POST /api/practice, then the socket; the partner it got
    const partner = async (headers: Record<string, string>): Promise<PracticeRun> => {
      const t = await postRaw(base, { device: dev(100 + n++), seed: SEED, level: 1 }, headers);
      assert.equal(t.status, 200, JSON.stringify(t.body));
      const g = await WsClient.connectPractice(base, t.body.ticket);
      clients.push(g);
      const m = (await g.waitT('matched', 5000)).chat;
      const run = (app.practice as unknown as { byChat: Map<string, PracticeRun> }).byChat.get(m.chatId)!;
      assert.ok(!playing.has(run.persona!.id), 'never a character of the round');
      const row = app.db.sql.prepare('SELECT data FROM practice_chats WHERE chat_id = ?').get(m.chatId) as { data: string };
      assert.equal(JSON.parse(row.data).lang, run.lang, "the row keeps the visitor's language");
      return run;
    };
    const speaksIt = (p: Persona, code: string) => {
      const native = speakers(code, 'native');
      if (native.length) assert.ok(native.includes(p.id), `${code}: a free house persona who speaks it natively (${native}), not ${p.id}`);
      else assert.ok(p.source === 'generated' && p.languages![code] === 'native', `${code}: busy in the round, so someone generated who speaks it natively, not ${p.id}`);
    };
    for (const [header, code] of [['ar-EG,ar;q=0.9,en;q=0.8', 'ar'], ['id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7', 'id'], ['pt-BR,pt;q=0.9,en-US;q=0.8', 'pt']]) {
      const run = await partner({ 'Accept-Language': header });
      assert.equal(run.lang, code);
      speaksIt(run.persona!, code);
    }
    // Russian: Katya in Riga; when she plays in the round, nobody generated has it first, so a free house persona
    // who speaks it (Marek in Tallinn speaks good Russian), else as before
    const ru = await partner({ 'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8' });
    assert.equal(ru.lang, 'ru');
    const ruBest = [speakers('ru', 'native'), speakers('ru', 'fluent'), speakers('ru', 'good')].find((x) => x.length);
    if (ruBest) assert.ok(ruBest.includes(ru.persona!.id), `ru: ${ruBest}, not ${ru.persona!.id}`);
    else assert.ok(asBefore.has(ru.persona!.id), `ru: nobody speaks it, as before (${ru.persona!.id})`);
    if (!playing.has('katya-riga')) assert.equal(ru.persona!.id, 'katya-riga');
    // English, or no header: a free house persona on the cheapest model, any of them
    const en = await partner({ 'Accept-Language': 'en-US,en;q=0.9' });
    assert.equal(en.lang, 'en');
    assert.ok(asBefore.has(en.persona!.id), en.persona!.id);
    const none = await partner({});
    assert.equal(none.lang, undefined);
    assert.ok(asBefore.has(none.persona!.id), none.persona!.id);
    // random among the matching: English and no header still meet every free house persona of the cheapest model
    const at = Date.now();
    for (const lang of ['en', undefined]) {
      const got = new Set(Array.from({ length: 400 }, () => app.practice.pickPersona(1, at, lang).id));
      assert.deepEqual([...got].sort(), [...asBefore].sort(), `${lang ?? 'no language'}: today's random pick`);
    }
    // a language nobody in the house speaks but the generator has (Thai): someone generated, different ones
    const th = Array.from({ length: 8 }, () => app.practice.pickPersona(1, at, 'th'));
    assert.ok(th.every((p) => p.source === 'generated' && p.languages!.th === 'native' && p.person!.home.country === 'Thailand'));
    assert.ok(new Set(th.map((p) => p.person!.name)).size > 1, 'at random');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test("every house persona in the round: a visitor's language still gets a speaker, generated for the chat", { timeout: 60_000 }, async () => {
  const { app, base } = await setup({ castSize: 0 });
  try {
    await until(() => state(base), (s) => !!s.round?.ready, 20_000, 'round ready');
    const at = Date.now();
    for (const [code, countries] of [['ar', ['Egypt', 'Morocco']], ['id', ['Indonesia']], ['pt', ['Brazil', 'Portugal']]] as const) {
      for (let i = 0; i < 10; i++) {
        const p = app.practice.pickPersona(2, at, code);
        assert.equal(p.source, 'generated', `${code}: every house persona plays`);
        assert.equal(p.languages![code], 'native', `${code}: ${JSON.stringify(p.languages)}`);
        assert.ok((countries as readonly string[]).includes(p.person!.home.country), `${code}: ${p.person!.home.country}`);
      }
    }
    // Russian: no generated first speakers, and Katya and Marek both play: someone generated, as before
    assert.equal(app.practice.pickPersona(2, at, 'ru').source, 'generated');
  } finally {
    await app.close();
  }
});

test('every house persona in the round: someone generated; a missed call reveals too; a dropped socket gets the chat back', { timeout: 60_000 }, async () => {
  // CAST_SIZE 0: the whole personas folder plays in the round
  const { app, base } = await setup({ chatSeconds: 3, callSeconds: 1, castSize: 0 });
  const clients: WsClient[] = [];
  try {
    await until(() => state(base), (s) => !!s.round?.ready, 20_000, 'round ready');
    const cast = [...app.game.chars.get(app.game.current!.id)!.values()].filter((c) => c.kind === 'bot');
    assert.ok(HOUSE.every((p) => cast.some((c) => c.personaId === p.id)), 'every hand-written persona plays');
    const t = (await api(base, 'POST', '/api/practice', { body: { device: dev(3), seed: SEED, level: 1 } })).body;
    const a = await WsClient.connectPractice(base, t.ticket);
    clients.push(a);
    const m = (await a.waitT('matched', 5000)).chat;
    await a.waitChatStart(m.chatId, 5000);
    a.send({ t: 'say', chatId: m.chatId, text: 'hi there' });
    await a.waitT('message', 5000, (x) => x.msg.from === 'me');
    a.close();
    // a used ticket does not open a second socket
    await assert.rejects(WsClient.connectPractice(base, t.ticket));
    const again = await api(base, 'POST', '/api/practice', { body: { guest: t.guest } });
    assert.equal(again.status, 200);
    assert.equal(again.body.guest, t.guest);
    const b = await WsClient.connectPractice(base, again.body.ticket);
    clients.push(b);
    assert.equal((await b.waitT('matched', 5000)).chat.chatId, m.chatId, 'the same chat');
    await b.waitT('message', 5000, (x) => x.msg.from === 'me' && x.msg.text === 'hi there');
    // no call in the window: call_missed, then the reveal with no verdict
    await b.waitT('chat_ended', 10_000);
    await b.waitT('call_missed', 5000);
    const { result } = await b.waitT('practice_result', 3000);
    assert.deepEqual([result.myCall, result.right, result.truth], [null, null, 'bot']);
    assert.ok(result.persona && typeof result.persona.age === 'number', 'a card');
    assert.ok(!HOUSE.some((p) => same(p.card, result.persona)) && !cast.some((c) => same(c.card, result.persona)), 'a person generated for this chat, nobody in the round');
    // another IP never gets a ticket for it
    assert.deepEqual((await api(base, 'POST', '/api/practice', { body: { guest: t.guest }, ip: '203.0.113.9' })).body.code, 'practice_over');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test('one a day per device and per IP, a daily cap for all, a ticket bound to its IP, a cap on asking; off with 0', { timeout: 60_000 }, async () => {
  const { app, base } = await setup({ guestChatsDailyCap: 2 });
  try {
    const post = (device: string, ip: string) => api(base, 'POST', '/api/practice', { body: { device, seed: SEED, level: 1 }, ip });
    const a = await post(dev(10), '192.0.2.1');
    assert.equal(a.status, 200);
    // the same device from another network: used
    const sameDevice = await post(dev(10), '192.0.2.2');
    assert.deepEqual([sameDevice.status, sameDevice.body.code], [429, 'practice_used']);
    // another device from the same network: used too, whichever is reached first
    const sameIp = await post(dev(11), '192.0.2.1');
    assert.deepEqual([sameIp.status, sameIp.body.code], [429, 'practice_used']);
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(11)}`, { ip: '192.0.2.1' })).body, { ok: false, reason: 'practice_used' });
    // a fresh device on a fresh network: the second and last of today's cap
    assert.equal((await post(dev(12), '192.0.2.3')).status, 200);
    const capped = await post(dev(13), '192.0.2.4');
    assert.deepEqual([capped.status, capped.body.code], [429, 'practice_cap']);
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(13)}`, { ip: '192.0.2.4' })).body, { ok: false, reason: 'practice_cap' });
    // its own try first: a device that had one hears "used", not "all gone"
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(10)}`, { ip: '192.0.2.9' })).body, { ok: false, reason: 'practice_used' });
    // the ticket works from the IP that got it only (this socket comes from loopback)
    await assert.rejects(WsClient.connectPractice(base, a.body.ticket));
    // malformed asks
    assert.equal((await api(base, 'GET', '/api/practice?device=short', { ip: '192.0.2.5' })).body.code, 'invalid_request');
    assert.equal((await api(base, 'POST', '/api/practice', { body: { device: dev(14), seed: 'nothex', level: 1 }, ip: '192.0.2.5' })).body.code, 'invalid_request');
    assert.equal((await api(base, 'POST', '/api/practice', { body: { device: dev(14), seed: SEED, level: 4 }, ip: '192.0.2.5' })).body.code, 'invalid_request');
    assert.equal((await api(base, 'POST', '/api/practice', { body: { guest: 'made-up' }, ip: '192.0.2.5' })).body.code, 'practice_over');
    // a cap per IP on asking at all
    let limited = 0;
    for (let i = 0; i < 32; i++) if ((await api(base, 'GET', `/api/practice?device=${dev(15)}`, { ip: '192.0.2.6' })).status === 429) limited++;
    assert.ok(limited >= 2, `asking is capped per IP (${limited} refused)`);
  } finally {
    await app.close();
  }
  // GUEST_CHATS_PER_DAY=0: off
  const off = await setup({ guestChatsPerDay: 0 });
  try {
    assert.equal((await api(off.base, 'GET', '/api/config')).body.practice, undefined, 'no PublicConfig.practice');
    assert.deepEqual((await api(off.base, 'GET', `/api/practice?device=${dev(20)}`)).body, { ok: false, reason: 'practice_off' });
    const r = await api(off.base, 'POST', '/api/practice', { body: { device: dev(20), seed: SEED, level: 1 } });
    assert.deepEqual([r.status, r.body.code], [404, 'practice_off']);
    assert.equal(off.app.practice.stats().today, 0);
  } finally {
    await off.app.close();
  }
});

test('a guest socket takes messages and one call, nothing of the round; no practice chat while the bots are out of credits', { timeout: 60_000 }, async () => {
  const { app, base } = await setup({ chatSeconds: 30 });
  let g: WsClient | null = null;
  try {
    await until(() => state(base), (s) => !!s.round?.ready, 20_000, 'round ready');
    const t = (await api(base, 'POST', '/api/practice', { body: { device: dev(30), seed: SEED, level: 1 } })).body;
    g = await WsClient.connectPractice(base, t.ticket);
    const m = (await g.waitT('matched', 5000)).chat;
    await g.waitChatStart(m.chatId, 5000);
    const tries: any[] = [
      { t: 'enter_room', level: 1 },
      { t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' },
      { t: 'pick_seat', level: 1, seatIndex: 1, mode: 'paid', coins: 5 },
      { t: 'cancel_search' },
      { t: 'dev_end_chat', chatId: m.chatId },
      { t: 'signed_tx', reqId: 'x', signedTx: 'AAAA' },
      { t: 'sign_declined', reqId: 'x', reason: 'no' },
    ];
    for (const x of tries) {
      g.send(x);
      const e: { code: string } = await g.waitT('error', 3000);
      assert.equal(e.code, 'not_in_practice', `${x.t} is refused`);
    }
    // another chat id is no chat of this guest
    g.send({ t: 'say', chatId: 'someone-else', text: 'hi' });
    assert.equal((await g.waitT('error', 3000)).code, 'unknown_chat');
    assert.equal(app.game.searches.size, 0, 'no search started');
    assert.ok(!g.msgs.some((x) => ['room', 'seat', 'searching', 'welcome', 'me'].includes(x.t)), 'no room, no seat');
    // a new round and results go to players, never to the guest
    const r0 = app.game.current!.id;
    await api(base, 'POST', '/api/dev/end-round');
    await until(() => state(base), (s) => !!s.round && s.round.roundId > r0, 15_000, 'the next round');
    await sleep(500);
    assert.ok(!g.msgs.some((x) => x.t === 'round' || x.t === 'results_ready'), 'no round broadcast reached the guest');
    // the chat itself goes on
    g.send({ t: 'say', chatId: m.chatId, text: 'still here' });
    await g.waitT('message', 3000, (x) => x.msg.from === 'me' && x.msg.text === 'still here');
    g.close();
    g = null;

    // the bots are out of credits: no practice chat, in the relay's existing words
    app.credits.markOut('house', { kind: 'credits', detail: 'HTTP 402: test' });
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(31)}`, { ip: '192.0.2.31' })).body, { ok: false, reason: 'bots_unavailable' });
    const r = await api(base, 'POST', '/api/practice', { body: { device: dev(31), seed: SEED, level: 1 }, ip: '192.0.2.31' });
    assert.deepEqual([r.status, r.body.code], [503, 'bots_unavailable']);
    assert.match(r.body.message, /The bots are napping/);
  } finally {
    g?.close();
    await app.close();
  }
});

test('the bots run out between the reservation and the socket: no chat, and the try is given back', { timeout: 30_000 }, async () => {
  const { app, base } = await setup();
  try {
    const t = (await api(base, 'POST', '/api/practice', { body: { device: dev(40), seed: SEED, level: 1 } })).body;
    assert.equal(app.practice.stats().today, 1);
    app.credits.markOut('house', { kind: 'credits', detail: 'HTTP 402: test' });
    const g = await WsClient.connectPractice(base, t.ticket);
    const e = await g.waitT('error', 3000);
    assert.equal(e.code, 'bots_unavailable');
    assert.ok(!g.msgs.some((x) => x.t === 'matched' || x.t === 'chat_started'), 'no chat');
    await until(() => g.isClosed, (x) => x, 3000, 'socket closed');
    assert.equal(app.practice.stats().today, 0, 'the try is given back');
    const row = app.db.sql.prepare("SELECT status FROM practice_chats WHERE device = ?").get(dev(40)) as { status: string };
    assert.equal(row.status, 'aborted');
  } finally {
    await app.close();
  }
});

test('a closed beta: no practice chat either', { timeout: 30_000 }, async () => {
  const { app, base } = await setup({ betaSpendCapUsd: 0.000001 });
  try {
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(50)}`)).body, { ok: true });
    app.credits.addSpend('house', 0.01, 1);
    assert.ok(app.game.betaClosed());
    assert.deepEqual((await api(base, 'GET', `/api/practice?device=${dev(50)}`)).body, { ok: false, reason: 'beta_closed' });
    const r = await api(base, 'POST', '/api/practice', { body: { device: dev(50), seed: SEED, level: 1 } });
    assert.deepEqual([r.status, r.body.code], [403, 'beta_closed']);
  } finally {
    await app.close();
  }
});
