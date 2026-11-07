// AI builders and NEAR AI credits against in-process relays (mock chain, mock NEAR AI signer): access
// requests, the admin API and the command line, botmaster tokens, an AI builder's persona from review to
// settled chats, stats and export, its own NEAR AI key, and what happens when a key runs out of credits.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createApp, type App, type AppDeps } from '../src/app.js';
import type { Config } from '../src/config.js';
import { MockChain } from '../src/chain/mock.js';
import { MockNearAi } from '../src/nearai/client.js';
import { loadPersonas } from '../src/personas.js';
import { tokenHash } from '../src/bot/remote.js';
import type { CharacterRec } from '../src/game/types.js';
import { WsClient } from './client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'admin-token-for-tests-0123456789';
const PROMPT = loadPersonas(path.resolve(here, '../personas')).find((p) => p.id === 'mia-leeds')!.prompt;
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Res {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

async function api(base: string, method: string, p: string, o: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${base}${p}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await r.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* text */
  }
  return { status: r.status, body, text, headers: r.headers };
}

async function setup(extra: Partial<Config> = {}, deps: AppDeps = {}): Promise<{ app: App; base: string; dir: string; chain: MockChain; ai: MockNearAi }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-agents-'));
  fs.mkdirSync(path.join(dir, 'botmasters'));
  const chain = (deps.chain as MockChain) ?? new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const ai = (deps.ai as MockNearAi) ?? new MockNearAi();
  ai.latencyMs = [20, 80];
  const app = await createApp(
    {
      port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 30, callSeconds: 5, countdownSeconds: 1, botTimeScale: 0.08,
      searchDelay: [0.2, 0.4], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'error', devTraces: true, webDist: path.join(dir, 'no-web'),
      botmastersDir: path.join(dir, 'botmasters'), castSize: 6, adminToken: undefined, encryptionKey: undefined, agentRequestWebhook: undefined,
      ...extra,
    },
    { ...deps, chain, ai },
  );
  return { app, base: `http://localhost:${app.port}`, dir, chain, ai };
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

const state = async (base: string) => (await api(base, 'GET', '/api/dev/state')).body;
const health = async (base: string) => (await api(base, 'GET', '/api/health')).body;

async function players(base: string, accounts: string[]): Promise<WsClient[]> {
  const cs = await Promise.all(accounts.map((a) => WsClient.connect(base, a)));
  for (const c of cs) await c.waitT('welcome', 5000);
  await until(() => state(base), (s) => !!s.round?.ready && (s.characters['human-committed'] ?? 0) >= accounts.length, 15_000, 'round ready and humans committed');
  return cs;
}

/** A bot chat from match to call; the player writes one line and waits for the bot. */
async function botChat(c: WsClient, level: 1 | 2 | 3, seat: number, mode: 'free' | 'paid', call: boolean | null): Promise<string> {
  c.send({ t: 'pick_seat', level, seatIndex: seat, mode, coins: mode === 'paid' ? 5 : undefined });
  const m = (await c.waitT('matched', 10_000)).chat;
  if (mode === 'paid') await c.waitT('placed', 10_000, (x) => x.chatId === m.chatId);
  await c.waitChatStart(m.chatId, 10_000);
  c.send({ t: 'say', chatId: m.chatId, text: `hey, where are you from? (${c.account.split('.')[0]})` });
  await c.waitT('message', 15_000, (x) => x.chatId === m.chatId && x.msg.from === 'them');
  c.send({ t: 'dev_end_chat', chatId: m.chatId });
  await c.waitT('chat_ended', 5000, (x) => x.chatId === m.chatId);
  if (call !== null) {
    c.send({ t: 'call', chatId: m.chatId, human: call });
    await c.waitT('call_recorded', 10_000, (x) => x.chatId === m.chatId);
  }
  return m.chatId;
}

async function newRound(base: string): Promise<number> {
  const before = (await state(base)).round?.roundId ?? 0;
  await api(base, 'POST', '/api/dev/end-round');
  const s = await until(() => state(base), (x) => !!x.round && x.round.roundId > before && x.round.ready, 20_000, 'next round ready');
  return s.round.roundId;
}

/** A botmaster's /bot/ws connection. */
class Brain {
  msgs: any[] = [];
  closeCode: number | null = null;
  constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => this.msgs.push(JSON.parse(String(d))));
    ws.on('close', (code) => (this.closeCode = code));
  }
  static open(base: string, token: string): Promise<Brain> {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/bot/ws', { headers: { Authorization: `Bearer ${token}` } });
    const b = new Brain(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(b));
      ws.once('error', reject);
    });
  }
  async wait(pred: (m: any) => boolean, ms: number, label: string): Promise<any> {
    return until(() => this.msgs.find(pred), (x) => !!x, ms, label);
  }
}

const REQ = {
  name: 'Ada Lovelace', email: 'ada@engines.example', company: 'Analytical Engines', website: 'https://engines.example', kind: 'chat_vendor',
  models: 'GLM 5.3 Flash with our own prompts', goal: 'how often real people take our agent for a human', volume: '100 a day', agreeTerms: true,
};

test('access requests: validation, a receipt, the webhook, a per-IP rate limit; admin and own keys off unless configured', { timeout: 60_000 }, async () => {
  const hooks: any[] = [];
  const hook = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      hooks.push({ path: req.url, body: JSON.parse(b) });
      res.end('ok');
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', () => r()));
  const hookPort = (hook.address() as { port: number }).port;
  const { app, base } = await setup({ agentRequestWebhook: `http://127.0.0.1:${hookPort}/hook`, agentRequestsPerHour: 2 });
  try {
    // bad input names its field; nothing is stored
    const bad = await api(base, 'POST', '/api/agents/request', { body: { ...REQ, email: 'ada-at-engines' } });
    assert.equal(bad.status, 400);
    assert.deepEqual([bad.body.code, bad.body.field], ['invalid_request', 'email']);
    assert.equal((await api(base, 'POST', '/api/agents/request', { body: { ...REQ, agreeTerms: false } })).body.field, 'agreeTerms');
    assert.equal((await api(base, 'POST', '/api/agents/request', { body: { ...REQ, kind: 'reseller' } })).body.field, 'kind');
    assert.equal((await api(base, 'POST', '/api/agents/request', { body: { ...REQ, goal: 'x'.repeat(5000) } })).body.field, 'goal');
    assert.equal(app.agents.listRequests().length, 0);

    // a good one: the receipt, a pending row, one webhook POST
    const ip = { 'CF-Connecting-IP': '203.0.113.5' };
    const ok = await api(base, 'POST', '/api/agents/request', { body: { ...REQ, email: 'Ada@Engines.Example' }, headers: ip });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(Object.keys(ok.body).sort(), ['createdAt', 'id', 'status']);
    assert.equal(ok.body.status, 'pending');
    assert.match(ok.body.id, /^ar_[0-9a-f]{16}$/);
    const row = app.agents.getRequest(ok.body.id)!;
    assert.equal(row.status, 'pending');
    assert.equal(row.request.email, 'ada@engines.example');
    assert.ok(row.ipHash && !JSON.stringify(row).includes('203.0.113.5'), 'the IP is kept only as a keyed hash');
    await until(() => hooks.length, (n) => n === 1, 5000, 'webhook');
    assert.equal(hooks[0].path, '/hook');
    assert.equal(hooks[0].body.id, ok.body.id);
    assert.equal(hooks[0].body.request.company, 'Analytical Engines');
    assert.match(hooks[0].body.text, /Analytical Engines/);

    // two per hour per IP; another IP has its own allowance
    assert.equal((await api(base, 'POST', '/api/agents/request', { body: REQ, headers: ip })).status, 200);
    const limited = await api(base, 'POST', '/api/agents/request', { body: REQ, headers: ip });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'rate_limited');
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await api(base, 'POST', '/api/agents/request', { body: REQ, headers: { 'CF-Connecting-IP': '203.0.113.6' } })).status, 200);
    assert.equal(app.agents.listRequests('pending').length, 3);

    // without ADMIN_TOKEN the admin API is off, whatever the token
    const off = await api(base, 'GET', '/api/admin/requests', { token: ADMIN });
    assert.deepEqual([off.status, off.body.code], [403, 'admin_disabled']);
    // without RELAY_ENCRYPTION_KEY no botmaster can store its own key
    const { createBotmaster } = await import('../src/agents/admin.js');
    const { token } = createBotmaster({ store: app.agents, fileBotmasters: () => [] }, { name: 'noenc', payoutAccount: 'noenc.testnet' });
    const put = await api(base, 'PUT', '/api/botmaster/nearai-key', { token, body: { key: 'sk-whatever-0123456789abcdef' } });
    assert.deepEqual([put.status, put.body.code], [503, 'byok_disabled']);
    assert.equal(app.agents.getKey('noenc'), undefined);
    // CORS preflight allows the botmaster API from a vendor's own dashboard
    const pre = await fetch(`${base}/api/botmaster/me`, { method: 'OPTIONS' });
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    assert.match(pre.headers.get('access-control-allow-methods') ?? '', /PUT.*DELETE/);
    // the public program info
    const info = await api(base, 'GET', '/api/agents/info');
    assert.deepEqual(info.body.models.map((m: any) => m.id).sort(), ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'z-ai/glm-5.3-flash']);
    assert.equal(info.body.turingBonus.characterBps, 2000);
    assert.equal(info.body.byok, false);
  } finally {
    await app.close();
    hook.close();
  }
});

const TSX = path.resolve(here, '../node_modules/tsx/dist/cli.mjs');
function cli(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TSX, path.resolve(here, '../tools/botmaster-admin.ts'), ...args], {
      cwd: path.resolve(here, '..'),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout!.on('data', (d) => (out += d));
    child.stderr!.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

test('approval: admin API and command line; a token is shown once, only its sha256 is kept; rotate and revoke cut live connections', { timeout: 90_000 }, async () => {
  const { app, base, dir } = await setup({ adminToken: ADMIN });
  try {
    const r1 = (await api(base, 'POST', '/api/agents/request', { body: REQ })).body;
    const r2 = (await api(base, 'POST', '/api/agents/request', { body: { ...REQ, name: 'Spam Bot', company: undefined, email: 'spam@spam.example' } })).body;
    // admin auth
    assert.equal((await api(base, 'GET', '/api/admin/requests')).status, 401);
    assert.equal((await api(base, 'GET', '/api/admin/requests', { token: 'wrong-admin-token-000000000' })).status, 401);
    const list = (await api(base, 'GET', '/api/admin/requests?status=pending', { token: ADMIN })).body;
    assert.deepEqual(list.map((x: any) => x.id).sort(), [r1.id, r2.id].sort());
    // reject needs a reason
    assert.equal((await api(base, 'POST', `/api/admin/requests/${r2.id}/reject`, { token: ADMIN, body: {} })).body.field, 'reason');
    const rej = (await api(base, 'POST', `/api/admin/requests/${r2.id}/reject`, { token: ADMIN, body: { reason: 'not a builder' } })).body;
    assert.deepEqual([rej.status, rej.reason], ['rejected', 'not a builder']);
    // approve: no payout account in the request, so the operator must give one
    const nopay = await api(base, 'POST', `/api/admin/requests/${r1.id}/approve`, { token: ADMIN, body: {} });
    assert.deepEqual([nopay.status, nopay.body.code], [400, 'payout_required']);
    const ap = await api(base, 'POST', `/api/admin/requests/${r1.id}/approve`, { token: ADMIN, body: { payoutAccount: 'engines.testnet' } });
    assert.equal(ap.status, 200, ap.text);
    const token: string = ap.body.token;
    assert.equal(ap.body.botmaster.name, 'analytical-engines', 'named after the company');
    assert.equal(ap.body.botmaster.tokenSha256, undefined, 'the hash is not even shown');
    assert.match(token, /^rlsbm_[A-Za-z0-9_-]{43}$/);
    assert.equal((await api(base, 'POST', `/api/admin/requests/${r1.id}/approve`, { token: ADMIN, body: { payoutAccount: 'engines.testnet' } })).status, 409, 'once');
    // only the sha256 is stored, the token is nowhere in the DB
    const bm = app.agents.getBotmaster('analytical-engines')!;
    assert.equal(bm.tokenSha256, tokenHash(token));
    const dump = (app.db.sql.prepare("SELECT group_concat(data, '|') AS d FROM (SELECT data FROM agent_botmasters UNION ALL SELECT data FROM agent_requests)").get() as { d: string }).d;
    assert.ok(!dump.includes(token) && !dump.includes(token.slice(6)), 'no token in the DB');
    assert.ok(!JSON.stringify((await api(base, 'GET', '/api/admin/botmasters', { token: ADMIN })).body).includes(token));
    assert.equal(app.agents.getRequest(r1.id)!.botmaster, 'analytical-engines');

    // the token opens the botmaster API and /bot/ws
    const me = (await api(base, 'GET', '/api/botmaster/me', { token })).body;
    assert.deepEqual([me.name, me.payoutAccount, me.byok, me.personas], ['analytical-engines', 'engines.testnet', false, []]);
    assert.ok(me.createdAt > 0);
    assert.equal((await api(base, 'GET', '/api/botmaster/me')).status, 401);
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: 'rlsbm_not-a-real-token-0000000000000' })).status, 401);
    const b1 = await Brain.open(base, token);
    assert.equal((await b1.wait((m) => m.type === 'welcome', 3000, 'welcome')).botmaster, 'analytical-engines');

    // rotate: the old token stops at once, its live connection is closed, the new one works
    const rot = (await api(base, 'POST', '/api/admin/botmasters/analytical-engines/rotate', { token: ADMIN })).body;
    assert.notEqual(rot.token, token);
    assert.equal((await b1.wait((m) => m.type === 'error' && m.code === 'rotated', 3000, 'rotated notice')).code, 'rotated');
    await until(() => b1.closeCode, (c) => c === 4001, 3000, 'closed');
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token })).status, 401);
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: rot.token })).status, 200);
    // revoke: the token stops, the connection is closed
    const b2 = await Brain.open(base, rot.token);
    await b2.wait((m) => m.type === 'welcome', 3000, 'welcome');
    const rev = (await api(base, 'POST', '/api/admin/botmasters/analytical-engines/revoke', { token: ADMIN, body: { reason: 'test' } })).body;
    assert.equal(rev.status, 'revoked');
    await until(() => b2.closeCode, (c) => c === 4001, 3000, 'closed on revoke');
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: rot.token })).status, 401);
    const refused = await Brain.open(base, rot.token);
    assert.equal((await refused.wait((m) => m.type === 'error', 3000, 'unauthorized')).code, 'unauthorized');

    // the command line on the same DB, while the relay runs
    const env = { BOTMASTERS: path.join(dir, 'botmasters'), LOG_LEVEL: 'warn' };
    const db = ['--db', app.cfg.dbPath];
    const r3 = (await api(base, 'POST', '/api/agents/request', { body: { ...REQ, company: 'Voice Corp', kind: 'voice_vendor', payoutAccount: 'voice.testnet' } })).body;
    const lsReq = await cli(['requests', ...db], env);
    assert.equal(lsReq.code, 0, lsReq.out);
    assert.match(lsReq.out, new RegExp(`${r3.id}\\s+pending.*voice_vendor.*Voice Corp`));
    const appr = await cli(['approve', r3.id, ...db], env);
    assert.equal(appr.code, 0, appr.out);
    const cliToken = /\n {2}(rlsbm_[A-Za-z0-9_-]{43})\n/.exec(appr.out)?.[1];
    assert.ok(cliToken, `a token printed once:\n${appr.out}`);
    const me2 = (await api(base, 'GET', '/api/botmaster/me', { token: cliToken })).body;
    assert.deepEqual([me2.name, me2.payoutAccount], ['voice-corp', 'voice.testnet'], 'the running relay accepts it at once');
    // a persona submitted over HTTP, approved on the command line
    const sub = await api(base, 'POST', '/api/botmaster/personas', { token: cliToken, body: { id: 'echo', model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels: [3], brain: 'remote' } });
    assert.equal(sub.status, 200, sub.text);
    assert.equal(sub.body.id, 'voice-corp-echo');
    const lsP = await cli(['personas', ...db], env);
    assert.match(lsP.out, /voice-corp-echo\s+pending/);
    const apP = await cli(['approve-persona', 'voice-corp-echo', ...db], env);
    assert.equal(apP.code, 0, apP.out);
    assert.equal(app.agents.getPersona('voice-corp-echo')!.status, 'approved');
    const vb = await Brain.open(base, cliToken!);
    assert.deepEqual((await vb.wait((m) => m.type === 'welcome', 3000, 'welcome')).personas, ['voice-corp-echo'], 'its remote-brain persona is announced');
    const bad = await cli(['approve', 'ar_nope', ...db], env);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /no access request ar_nope/);
    const revoked = await cli(['revoke', 'voice-corp', ...db], env);
    assert.equal(revoked.code, 0, revoked.out);
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: cliToken })).status, 401, 'revoked on the command line: refused at once');
    for (const b of [b1, b2, refused, vb]) b.ws.close();
  } finally {
    await app.close();
  }
});

test("an AI builder's agent plays like ours: review, its own NEAR AI key, settled chats, anonymous players, stats, export, the bonus on chain", { timeout: 150_000 }, async () => {
  const VENDOR_KEY = 'sk-acme-vendor-key-0123456789abcdef';
  const keyAis = new Map<string, MockNearAi>();
  const aiForKey = (key: string) => {
    let m = keyAis.get(key);
    if (!m) {
      m = new MockNearAi();
      m.latencyMs = [20, 60];
      keyAis.set(key, m);
    }
    return m;
  };
  const { app, base, chain, ai: houseAi } = await setup({ adminToken: ADMIN, encryptionKey: crypto.randomBytes(32).toString('hex'), nearAiRecheckSeconds: 0.5 }, { aiForKey });
  const clients: WsClient[] = [];
  try {
    const T = (await api(base, 'POST', '/api/admin/botmasters', { token: ADMIN, body: { name: 'acme', payoutAccount: 'acme.testnet', contact: 'ops@acme.example' } })).body.token;
    // submissions: enclave models only, known fields only
    const p = { id: 'zed', model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels: [1, 2], traits: { chatty: 0.6, summary: 'barista in Leeds' }, languages: { en: 'native', fr: 'basic' } };
    for (const [patch, code, field] of [
      [{ model: 'openai/gpt-5.5' }, 'model_not_allowed', 'model'],
      [{ model: 'Qwen/Qwen3.8-27B' }, 'model_not_allowed', 'model'],
      [{ text: 'hello from a ghost-writer' }, 'invalid_request', 'text'],
      [{ prompt: 'short' }, 'invalid_request', 'prompt'],
    ] as const) {
      const r = await api(base, 'POST', '/api/botmaster/personas', { token: T, body: { ...p, ...patch } });
      assert.deepEqual([r.status, r.body.code, r.body.field], [400, code, field], JSON.stringify(patch));
    }
    assert.equal((await api(base, 'POST', '/api/botmaster/personas', { body: p })).status, 401);
    const sub = await api(base, 'POST', '/api/botmaster/personas', { token: T, body: p });
    assert.equal(sub.status, 200, sub.text);
    assert.deepEqual([sub.body.id, sub.body.status, sub.body.active, sub.body.brain, sub.body.promptSha256, sub.body.warnings], ['acme-zed', 'pending', false, 'default', sha(PROMPT), []]);
    assert.deepEqual(app.game.agentPersonas(), [], 'pending: not in any round');
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: T })).body.personas[0].status, 'pending');
    const appr = (await api(base, 'POST', '/api/admin/personas/acme-zed/approve', { token: ADMIN })).body;
    assert.equal(appr.status, 'approved');
    assert.equal((await api(base, 'POST', '/api/botmaster/personas', { token: T, body: p })).body.code, 'persona_exists', 'an approved prompt is fixed');
    assert.deepEqual(app.game.agentPersonas().map((x) => [x.id, x.payout, x.owner, x.promptHash]), [['acme-zed', 'acme.testnet', 'acme', sha(PROMPT)]]);

    // its own NEAR AI key: checked with a one-token call, sealed at rest
    const put = (await api(base, 'PUT', '/api/botmaster/nearai-key', { token: T, body: { key: VENDOR_KEY } })).body;
    assert.deepEqual(put, { byok: true, status: 'ok', checked: true });
    const vendorAi = keyAis.get(VENDOR_KEY)!;
    assert.equal(vendorAi.calls, 1, 'the check');
    const keyRow = (app.db.sql.prepare('SELECT data FROM agent_keys').get() as { data: string }).data;
    assert.ok(!keyRow.includes(VENDOR_KEY) && !keyRow.includes('acme-vendor'), 'sealed');
    const kv = (app.db.sql.prepare("SELECT group_concat(value, '|') AS v FROM kv").get() as { v: string }).v;
    assert.ok(!kv.includes(VENDOR_KEY));
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: T })).body.byok, true);
    assert.equal((await api(base, 'PUT', '/api/botmaster/nearai-key', { token: T, body: { key: 'short' } })).body.field, 'key');

    // the next round: one character per level, the botmaster's payout, the prompt committed by sha256
    const R = await newRound(base);
    const mine = [...app.game.chars.get(R)!.values()].filter((c: CharacterRec) => c.personaId === 'acme-zed');
    assert.deepEqual(mine.map((c) => c.level).sort(), [1, 2]);
    for (const c of mine) {
      assert.deepEqual([c.payout, c.promptHash, c.commitStatus, c.persona?.owner], ['acme.testnet', sha(PROMPT), 'committed', 'acme']);
      assert.ok(c.preimage.includes(`|${sha(PROMPT)}|`) && c.preimage.includes('|acme.testnet|'));
    }

    // players meet it: ana paid at level 1 (calls human: fooled), ana free at level 2 (calls bot), ben free at level 1 (fooled)
    const A = 'ana.realsies.testnet';
    const B = 'ben.realsies.testnet';
    const C = 'cleo.realsies.testnet';
    await api(base, 'POST', `/api/test-users/${A}/faucet`, { body: { coins: 50 } });
    const [ca, cb, cc] = await players(base, [A, B, C]);
    clients.push(ca, cb, cc);
    let offered: CharacterRec[] = [];
    app.game.botPicker = (_a, cands) => ((offered = cands), cands.find((c) => c.personaId === 'acme-zed'));
    const houseBefore = houseAi.calls;
    const vendorBefore = vendorAi.calls;
    const chatA1 = await botChat(ca, 1, 0, 'paid', true);
    const chatA2 = await botChat(ca, 2, 0, 'free', false);
    const chatB1 = await botChat(cb, 1, 0, 'free', true);
    assert.ok(vendorAi.calls > vendorBefore, 'its chats ran on its own key');
    assert.equal(houseAi.calls, houseBefore, "and not on the relay's");
    // a demo bot (level 3: no agent there) runs on the relay's key, never on the agent's
    const vendorMid = vendorAi.calls;
    await botChat(cc, 3, 0, 'free', true);
    assert.equal(vendorAi.calls, vendorMid);
    assert.ok(houseAi.calls > houseBefore);
    // before settlement nothing is served
    assert.deepEqual((await api(base, 'GET', '/api/botmaster/chats', { token: T })).body, []);
    assert.equal((await api(base, 'GET', '/api/botmaster/stats', { token: T })).body.totals.chats, 0);

    await api(base, 'POST', '/api/dev/end-round');
    await ca.waitT('results_ready', 60_000, (x) => x.roundId === R);

    // its settled chats, newest first, players anonymised
    const chats = (await api(base, 'GET', '/api/botmaster/chats', { token: T })).body;
    assert.deepEqual(chats.map((x: any) => x.chatId).sort(), [chatA1, chatA2, chatB1].sort());
    const by = Object.fromEntries(chats.map((x: any) => [x.chatId, x]));
    assert.deepEqual([by[chatA1].playerMode, by[chatA1].coins, by[chatA1].playerCall, by[chatA1].fooled, by[chatA1].level], ['paid', 5, true, true, 1]);
    assert.deepEqual([by[chatA2].playerMode, by[chatA2].playerCall, by[chatA2].fooled, by[chatA2].turingBonusCoins], ['free', false, false, 0]);
    assert.equal(by[chatA1].player, by[chatA2].player, 'the same player within a round');
    assert.notEqual(by[chatA1].player, by[chatB1].player);
    assert.ok(!JSON.stringify(chats).includes('realsies.testnet'), 'no account anywhere');
    assert.deepEqual(Object.keys(by[chatA1]).sort(), ['chatId', 'coins', 'fooled', 'level', 'model', 'personaId', 'player', 'playerCall', 'playerMode', 'roundId', 'startedAt', 'transcript', 'turingBonusCoins']);
    assert.deepEqual(by[chatA1].transcript[0], { from: 'player', text: 'hey, where are you from? (ana)', at: by[chatA1].transcript[0].at });
    assert.ok(by[chatA1].transcript.some((m: any) => m.from === 'bot'));
    assert.equal((await api(base, 'GET', `/api/botmaster/chats?round=${R}&limit=2`, { token: T })).body.length, 2);
    assert.equal((await api(base, 'GET', '/api/botmaster/chats?limit=0', { token: T })).status, 400);

    // the scorecard, and the Turing bonus as the chain paid it: nobody called it right, so 90% of 4.75
    const st = (await api(base, 'GET', '/api/botmaster/stats', { token: T })).body;
    assert.deepEqual(st.totals, { chats: 3, paidChats: 1, calledHuman: 2, calledBot: 1, missed: 0, fooledShare: 0.666667, coinFooledShare: 1, turingBonusCoins: 4.275 });
    assert.deepEqual(st.byPersona['acme-zed'], st.totals);
    assert.deepEqual(st.rounds.map((x: any) => [x.roundId, x.chats]), [[R, 3]]);
    assert.ok(st.rounds[0].settledAt > 0);
    assert.equal(await chain.balanceOf('acme.testnet'), 4275n * 10n ** 15n, 'the payout account holds the bonus');
    assert.equal(by[chatA1].turingBonusCoins, 4.275);
    // results and the bundle say whose agent it was, and carry no demo card
    const res = (await api(base, 'GET', `/api/rounds/${R}/results/${A}`)).body;
    const rc = res.chats.find((x: any) => x.chatId === chatA1);
    assert.deepEqual([rc.truth, rc.botmaster, rc.persona, rc.right], ['bot', 'acme', undefined, false]);
    const bundle = (await api(base, 'GET', `/api/verify/${chatA1}?account=${A}`)).body;
    assert.equal(bundle.botmaster, 'acme');
    assert.equal(bundle.personaPrompt, PROMPT);

    // the export: every settled chat, one JSON object per line
    const ex = await api(base, 'GET', '/api/botmaster/export.jsonl', { token: T });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-type') ?? '', /application\/x-ndjson/);
    const lines = ex.text.trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((x) => x.chatId).sort(), chats.map((x: any) => x.chatId).sort());
    assert.deepEqual(lines.find((x) => x.chatId === chatA1), by[chatA1]);
    assert.equal((await api(base, 'GET', '/api/botmaster/export.jsonl')).status, 401);

    // its own key runs out of credits: its personas leave the matching; the relay's bots still play
    await until(() => state(base), (s) => !!s.round?.ready && (s.characters['human-committed'] ?? 0) >= 3, 15_000, 'next round with the humans');
    vendorAi.creditFail = true;
    cb.send({ t: 'pick_seat', level: 1, seatIndex: 1, mode: 'free' });
    const mb = (await cb.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(mb.chatId)?.personaId, 'acme-zed');
    await cb.waitChatStart(mb.chatId, 10_000);
    cb.send({ t: 'say', chatId: mb.chatId, text: 'hi, you there?' }); // the agent's next say gets HTTP 402
    const out = await until(async () => (await api(base, 'GET', '/api/botmaster/me', { token: T })).body.ai, (x) => x?.status === 'out_of_credits', 15_000, 'own key out');
    assert.match(out.reason, /402/);
    cb.send({ t: 'dev_end_chat', chatId: mb.chatId });
    await cb.waitT('chat_ended', 5000, (x) => x.chatId === mb.chatId);
    assert.equal((await health(base)).ai.status, 'ok', "the relay's own key is fine");
    offered = [];
    await botChat(cc, 1, 1, 'free', null);
    assert.ok(offered.length > 0 && !offered.some((c) => c.personaId === 'acme-zed'), 'never offered while its key is out');
    vendorAi.creditFail = false;
    await until(async () => (await api(base, 'GET', '/api/botmaster/me', { token: T })).body.ai, (x) => x?.status === 'ok', 10_000, 'own key recovered');
    // removing the key: its personas run on the relay's key again
    assert.deepEqual((await api(base, 'DELETE', '/api/botmaster/nearai-key', { token: T })).body, { byok: false });
    assert.equal((await api(base, 'GET', '/api/botmaster/me', { token: T })).body.byok, false);
    assert.equal(app.agents.getKey('acme'), undefined);
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test('no bots, no new chats: with the house key out of credits nothing new starts, human to human included; running chats finish; public health hides spend; recovery resumes matching', { timeout: 150_000 }, async () => {
  const { app, base, chain, ai } = await setup({ adminToken: ADMIN, nearAiRecheckSeconds: 0.5 });
  const clients: WsClient[] = [];
  try {
    // public health: status and since only; spend, budget and the reason are the operator's
    const pub0 = (await health(base)).ai;
    assert.deepEqual(Object.keys(pub0).sort(), ['since', 'status']);
    assert.equal(pub0.status, 'ok');
    assert.equal((await api(base, 'GET', '/api/admin/health')).status, 401);
    const adm0 = (await api(base, 'GET', '/api/admin/health', { token: ADMIN })).body;
    assert.deepEqual([adm0.ai.status, adm0.ai.budgetUsd, adm0.ai.spendUsd, adm0.keys[0].keyId], ['ok', 10, 0, 'house']);

    const [G, H, C, D, E, F] = ['ana', 'ben', 'cleo', 'dex', 'eve', 'finn'].map((u) => `${u}.realsies.testnet`);
    for (const u of [G, D]) await api(base, 'POST', `/api/test-users/${u}/faucet`, { body: { coins: 50 } });
    const [cg, ch, cc, cd, ce, cf] = await players(base, [G, H, C, D, E, F]);
    clients.push(cg, ch, cc, cd, ce, cf);

    // before the outage: eve and finn meet each other, cleo meets a bot
    ce.send({ t: 'pick_seat', level: 3, seatIndex: 0, mode: 'free' });
    cf.send({ t: 'pick_seat', level: 3, seatIndex: 1, mode: 'free' });
    const me = (await ce.waitT('matched', 10_000)).chat;
    const mf = (await cf.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(me.chatId)?.partnerChatId, mf.chatId);
    await ce.waitChatStart(me.chatId, 5000);
    await cf.waitChatStart(mf.chatId, 5000);
    cc.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    const mc = (await cc.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(mc.chatId)?.partnerKind, 'bot');
    await cc.waitChatStart(mc.chatId, 10_000);

    // the bot's next completion gets HTTP 402: the house key is out of credits
    ai.creditFail = true;
    cc.send({ t: 'say', chatId: mc.chatId, text: 'hey, are you there?' });
    await until(() => health(base), (x) => x.ai.status === 'out_of_credits', 15_000, 'out of credits');
    assert.deepEqual(Object.keys((await health(base)).ai).sort(), ['since', 'status'], 'still no spend and no reason in public');
    const adm = (await api(base, 'GET', '/api/admin/health', { token: ADMIN })).body;
    assert.match(adm.ai.reason, /HTTP 402/);
    assert.equal(adm.ai.budgetUsd, 10);
    assert.equal(typeof adm.ai.spendUsd, 'number');

    // chats already running finish as normal
    ce.send({ t: 'say', chatId: me.chatId, text: 'still here?' });
    assert.equal((await cf.waitT('message', 3000, (x) => x.chatId === mf.chatId)).msg.text, 'still here?');
    assert.equal(app.game.sides.get(mc.chatId)?.phase, 'chatting', 'the bot chat runs on');

    // a search gets bots_unavailable at once: no search, no wait, the seat stays open
    const t0 = Date.now();
    cd.send({ t: 'pick_seat', level: 2, seatIndex: 0, mode: 'free' });
    const err = await cd.waitT('error', 3000, (x) => x.code === 'bots_unavailable');
    assert.ok(Date.now() - t0 < 1000, `at once (${Date.now() - t0} ms)`);
    assert.equal(err.message, 'The bots are napping. New chats are paused for a few minutes; chats already running finish as normal.');
    assert.ok(!cd.msgs.some((x) => x.t === 'searching' || x.t === 'matched'));
    await cd.waitT('seat', 3000, (x) => x.level === 2 && x.seat.index === 0 && x.seat.state === 'open');

    // two humans looking at the same moment are not paired either
    cg.send({ t: 'pick_seat', level: 1, seatIndex: 1, mode: 'free' });
    ch.send({ t: 'pick_seat', level: 1, seatIndex: 1, mode: 'free' });
    for (const c of [cg, ch]) assert.equal((await c.waitT('error', 3000, (x) => x.code === 'bots_unavailable')).code, 'bots_unavailable');
    await sleep(800);
    assert.ok(![cg, ch].some((c) => c.msgs.some((x) => x.t === 'matched')), 'no human-to-human match during the outage');

    // the one-token recheck finds the key working: matching resumes by itself
    ai.creditFail = false;
    await until(() => health(base), (x) => x.ai.status === 'ok', 10_000, 'recovered');

    // ana (paid) and ben meet while all is fine; the pause begins while ana's play lands: neither chat starts
    chain.txLatencyMs = 1500;
    cg.send({ t: 'pick_seat', level: 2, seatIndex: 2, mode: 'paid', coins: 5 });
    ch.send({ t: 'pick_seat', level: 2, seatIndex: 2, mode: 'free' });
    const mg = (await cg.waitT('matched', 10_000)).chat;
    const mh = (await ch.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(mg.chatId)?.partnerChatId, mh.chatId, 'matching resumed: ana and ben meet');
    ai.creditFail = true;
    app.credits.markOut('house', { kind: 'credits', detail: 'HTTP 402: test' });
    await cg.waitT('placed', 10_000, (x) => x.chatId === mg.chatId);
    for (const [c, m] of [[cg, mg], [ch, mh]] as const) {
      await c.waitT('error', 5000, (x) => x.code === 'bots_unavailable');
      await c.waitT('chat_ended', 3000, (x) => x.chatId === m.chatId);
      await c.waitT('call_missed', 3000, (x) => x.chatId === m.chatId);
      assert.ok(!c.msgs.some((x) => x.t === 'chat_started' && x.chatId === m.chatId), `${c.account}: no chat_started`);
    }
    ai.creditFail = false;
    await until(() => health(base), (x) => x.ai.status === 'ok', 10_000, 'recovered again');

    // a paid bot chat whose key dies between the match and the start never starts either
    cd.send({ t: 'pick_seat', level: 1, seatIndex: 2, mode: 'paid', coins: 5 });
    const md = (await cd.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(md.chatId)?.partnerKind, 'bot');
    ai.creditFail = true;
    app.credits.markOut('house', { kind: 'credits', detail: 'HTTP 402: test' });
    await cd.waitT('placed', 10_000, (x) => x.chatId === md.chatId);
    chain.txLatencyMs = 5;
    await cd.waitT('error', 5000, (x) => x.code === 'bots_unavailable');
    await cd.waitT('chat_ended', 3000, (x) => x.chatId === md.chatId);
    await cd.waitT('call_missed', 3000, (x) => x.chatId === md.chatId);
    assert.equal(app.game.bots.has(md.chatId), false, 'no bot session');
    ai.creditFail = false;
    await until(() => health(base), (x) => x.ai.status === 'ok', 10_000, 'recovered once more');

    // bots are matched again
    cd.send({ t: 'pick_seat', level: 2, seatIndex: 3, mode: 'free' });
    const mb = (await cd.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(mb.chatId)?.partnerKind, 'bot');
    await cd.waitChatStart(mb.chatId, 5000);
    cd.send({ t: 'say', chatId: mb.chatId, text: 'hello again' });
    await cd.waitT('message', 15_000, (x) => x.chatId === mb.chatId && x.msg.from === 'them');
    assert.ok((await api(base, 'GET', '/api/admin/health', { token: ADMIN })).body.ai.spendUsd > 0, 'spend is tracked from usage');

    // the chats that never started move no rating; their plays are in no opening, so they are refunded (less the 5% fee)
    const before = await Promise.all([G, H].map(async (u) => (await api(base, 'GET', `/api/me/${u}`)).body.rating));
    const R = (await state(base)).round.roundId;
    await api(base, 'POST', '/api/dev/end-round');
    await cg.waitT('results_ready', 60_000, (x) => x.roundId === R);
    for (const [u, chatId, paid] of [[G, mg.chatId, true], [H, mh.chatId, false], [D, md.chatId, true]] as const) {
      const res = (await api(base, 'GET', `/api/rounds/${R}/results/${u}`)).body;
      const x = res.chats.find((y: any) => y.chatId === chatId);
      assert.deepEqual([x.myCall, x.right, x.ratingDelta, x.coinsDelta], [null, null, 0, paid ? -0.25 : 0], u);
    }
    const plays = await chain.getRoundPlays(R);
    assert.deepEqual(plays.filter((p) => p.account === G || p.account === D).map((p) => p.characterId), [null, null], 'the aborted plays were assigned to nobody');
    const after = await Promise.all([G, H].map(async (u) => (await api(base, 'GET', `/api/me/${u}`)).body.rating));
    assert.deepEqual(after, before, 'ana and ben kept their ratings');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test('a level where no bot can talk is paused on its own; the other levels play on; it resumes when the key recovers', { timeout: 120_000 }, async () => {
  // one demo persona at levels 1 and 2; an AI builder's agent alone at level 3, on its own key with no credits
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-level-'));
  const mia = JSON.parse(fs.readFileSync(path.resolve(here, '../personas/mia-leeds.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'mia-leeds.json'), JSON.stringify({ ...mia, levels: [1, 2] }));
  const vendorAi = new MockNearAi();
  vendorAi.latencyMs = [20, 60];
  vendorAi.creditFail = true;
  const { app, base } = await setup(
    { adminToken: ADMIN, encryptionKey: crypto.randomBytes(32).toString('hex'), castSize: 0, personasDir: dir, nearAiRecheckSeconds: 0.5 },
    { aiForKey: () => vendorAi },
  );
  const clients: WsClient[] = [];
  try {
    const T = (await api(base, 'POST', '/api/admin/botmasters', { token: ADMIN, body: { name: 'acme', payoutAccount: 'acme.testnet' } })).body.token;
    const sub = await api(base, 'POST', '/api/botmaster/personas', { token: T, body: { id: 'zed', model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels: [3] } });
    assert.equal(sub.status, 200, sub.text);
    assert.equal((await api(base, 'POST', '/api/admin/personas/acme-zed/approve', { token: ADMIN })).status, 200);
    const put = (await api(base, 'PUT', '/api/botmaster/nearai-key', { token: T, body: { key: 'sk-acme-empty-key-0123456789abcdef' } })).body;
    assert.deepEqual([put.byok, put.status, put.checked], [true, 'out_of_credits', true], 'stored, and out from the start');
    const R = await newRound(base);
    const bots = [...app.game.chars.get(R)!.values()].filter((c: CharacterRec) => c.kind === 'bot').map((c) => `${c.personaId}@L${c.level}`).sort();
    assert.deepEqual(bots, ['acme-zed@L3', 'mia-leeds@L1', 'mia-leeds@L2']);
    const [A, B, C] = ['ana', 'ben', 'cleo'].map((u) => `${u}.realsies.testnet`);
    const [ca, cb, cc] = await players(base, [A, B, C]);
    clients.push(ca, cb, cc);
    assert.equal((await health(base)).ai.status, 'ok', "the relay's own key is fine");

    // level 3: its only bot cannot talk, so nothing new starts there, not even two humans
    ca.send({ t: 'pick_seat', level: 3, seatIndex: 0, mode: 'free' });
    cb.send({ t: 'pick_seat', level: 3, seatIndex: 0, mode: 'free' });
    for (const c of [ca, cb]) assert.equal((await c.waitT('error', 3000, (x) => x.code === 'bots_unavailable')).code, 'bots_unavailable');
    await sleep(800);
    assert.ok(![ca, cb].some((c) => c.msgs.some((x) => x.t === 'matched')), 'level 3 is paused');

    // level 1 plays on
    cc.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
    const m1 = (await cc.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(m1.chatId)?.personaId, 'mia-leeds');

    // the key gets credits: level 3 resumes by itself
    vendorAi.creditFail = false;
    await until(async () => (await api(base, 'GET', '/api/botmaster/me', { token: T })).body.ai, (x) => x?.status === 'ok', 10_000, 'own key recovered');
    ca.send({ t: 'pick_seat', level: 3, seatIndex: 1, mode: 'free' });
    const m3 = (await ca.waitT('matched', 10_000)).chat;
    assert.equal(app.game.sides.get(m3.chatId)?.personaId, 'acme-zed', 'level 3 resumed');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

test('builder slots: round-robin over botmasters across real rounds, me.schedule predicts them, a disabled persona drops out', { timeout: 120_000 }, async () => {
  const { app, base } = await setup({ adminToken: ADMIN, agentSlotsPerLevel: 1 });
  try {
    const tokenOf = async (name: string) => (await api(base, 'POST', '/api/admin/botmasters', { token: ADMIN, body: { name, payoutAccount: `${name}.testnet` } })).body.token as string;
    const TA = await tokenOf('acme');
    const TB = await tokenOf('bolt');
    for (const [t, id, levels] of [[TA, 'zed', [1, 2]], [TB, 'ray', [1]]] as const) {
      const sub = await api(base, 'POST', '/api/botmaster/personas', { token: t, body: { id, model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels } });
      assert.equal(sub.status, 200, sub.text);
      assert.equal((await api(base, 'POST', `/api/admin/personas/${sub.body.id}/approve`, { token: ADMIN })).status, 200);
    }
    // one slot a level: at level 1 acme and bolt alternate by round id (acme on even ids); at level 2 acme is alone
    const meA = (await api(base, 'GET', '/api/botmaster/me', { token: TA })).body;
    const meB = (await api(base, 'GET', '/api/botmaster/me', { token: TB })).body;
    assert.equal(meA.schedule.slotsPerLevel, 1);
    assert.equal(meA.schedule.nextRounds.length, 3);
    const next = (await state(base)).round.roundId + 1;
    assert.deepEqual(meA.schedule.nextRounds, [0, 1, 2].map((k) => ({ roundId: next + k, levels: (next + k) % 2 === 0 ? [1, 2] : [2] })));
    assert.deepEqual(meB.schedule.nextRounds.map((x: any) => x.levels), [[1], [1], [1]]);
    assert.ok(meB.schedule.nextRounds.every((x: any) => x.roundId % 2 === 1 && x.roundId >= next));

    // the rounds as they run: one builder persona a level, as predicted
    const builders = (R: number) => [...app.game.chars.get(R)!.values()].filter((x: CharacterRec) => x.kind === 'bot' && x.persona?.owner).map((x) => `${x.personaId}@L${x.level}`).sort();
    const R1 = await newRound(base);
    const R2 = await newRound(base);
    assert.equal(R1, next);
    for (const R of [R1, R2]) {
      const want = R % 2 === 0 ? ['acme-zed@L1', 'acme-zed@L2'] : ['acme-zed@L2', 'bolt-ray@L1'];
      assert.deepEqual(builders(R), want, `round ${R}`);
    }
    assert.ok(new Set([R1, R2].map((R) => builders(R).find((x) => x.endsWith('@L1')))).size === 2, 'both botmasters got a turn at level 1');

    // bolt's only persona is disabled: no more turns for bolt; acme takes level 1 every round
    assert.equal((await api(base, 'POST', '/api/admin/personas/bolt-ray/disable', { token: ADMIN, body: { reason: 'test' } })).status, 200);
    assert.deepEqual((await api(base, 'GET', '/api/botmaster/me', { token: TB })).body.schedule.nextRounds, []);
    assert.ok((await api(base, 'GET', '/api/botmaster/me', { token: TA })).body.schedule.nextRounds.every((x: any) => x.levels.join() === '1,2'));
    const R3 = await newRound(base);
    assert.deepEqual(builders(R3), ['acme-zed@L1', 'acme-zed@L2']);
  } finally {
    await app.close();
  }
});
