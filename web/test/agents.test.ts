// The AI-builder side: form checks, the mock and real builder clients (protocol v1.2 "AI builders"),
// routing, the hero lineup fit, bots_unavailable in the store and the mock relay, and vocabulary.
// Run by npm test (spawned from mock-flow.test.ts).

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();

const V = await import('../src/agents/validate.ts');
const { routeOf, keepMock } = await import('../src/agents/route.ts');
const { MockBuilderClient, MOCK_TOKEN, scoreOf } = await import('../src/net/mock/builders.ts');
const { BuilderError, RealBuilderClient, isAuthError, friendlyError } = await import('../src/net/builders.ts');
const { MockGameClient } = await import('../src/net/mock.ts');
const { createStore } = await import('../src/state/store.ts');
const { BOTS_NAPPING } = await import('../src/state/notices.ts');
import type { GameClient, ServerMsg } from '../../shared/protocol.ts';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0, passes = 0;
function ok(cond: unknown, label: string): void {
  if (cond) {
    passes++;
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label);
  }
}
async function rejects(p: Promise<unknown>): Promise<InstanceType<typeof BuilderError> | Error | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as Error;
  }
}

// ---------- 1. the access request form ----------
console.log('access request checks');
{
  const empty = V.validateAccess(V.EMPTY_ACCESS);
  const keys = Object.keys(empty.errors).sort().join(',');
  ok(!empty.request && keys === 'agreeTerms,email,goal,kind,models,name', 'empty form: name, email, kind, models, goal and the terms are required: ' + keys);
  const good: typeof V.EMPTY_ACCESS = {
    name: '  Mira Okafor ', email: 'mira@acme.ai', company: '', website: 'acme.ai', kind: 'voice_vendor',
    models: 'Llama 3.3 70B behind a planner', goal: 'How often people take it for a person', volume: '', payoutAccount: ' Acme-Voice.Testnet ', agreeTerms: true,
  };
  const r = V.validateAccess(good);
  ok(!!r.request && r.request.name === 'Mira Okafor' && r.request.website === 'https://acme.ai' && r.request.payoutAccount === 'acme-voice.testnet', 'trimmed, website gets https://, payout account lower case');
  ok(r.request !== undefined && !('company' in r.request) && !('volume' in r.request) && r.request.agreeTerms === true && r.request.kind === 'voice_vendor', 'empty optional fields are left out');
  ok(!!V.validateAccess({ ...good, email: 'mira@acme' }).errors.email && !!V.validateAccess({ ...good, email: 'mira acme.ai' }).errors.email, 'email checked');
  ok(!!V.validateAccess({ ...good, website: 'not a site' }).errors.website && !!V.validateAccess({ ...good, website: 'ftp://acme.ai' }).errors.website && !V.validateAccess({ ...good, website: 'https://acme.ai/agents' }).errors.website, 'website checked');
  ok(!!V.validateAccess({ ...good, payoutAccount: 'acme..near' }).errors.payoutAccount && !!V.validateAccess({ ...good, goal: 'test' }).errors.goal, 'payout account and a too-short goal flagged');
  ok(!!V.validateAccess({ ...good, models: 'x'.repeat(V.ACCESS_MAX.models + 1) }).errors.models, 'length limits');
  const near = ['acme.near', 'acme-voice.testnet', 'a_b.c-d.near', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', '0x' + 'ab'.repeat(20)];
  const notNear = ['a', 'Acme.near', 'acme..near', '-acme.near', 'acme.near.', 'acme near', 'x'.repeat(65)];
  ok(near.every(V.isNearAccount) && !notNear.some(V.isNearAccount), 'NEAR account ids: named, implicit, Ethereum-style; no capitals, empty parts or edge separators');
}

// ---------- 2. persona requests ----------
console.log('persona request checks');
{
  const base = V.emptyPersona();
  const prompt = 'You are Zed, 24, a barista in Leeds. You text in lowercase with dry humour and short lines, and you never write like an assistant.';
  ok(!!V.validatePersona(base).errors.prompt, 'a prompt is required');
  ok(/200/.test(V.validatePersona({ ...base, prompt }).errors.prompt ?? ''), 'prompts are at least 200 characters (the relay takes 200 to 6000)');
  const long = prompt + ' You mention the weather a lot, you hate small talk about football, and you sign off with "right then".';
  ok(long.length >= 200 && !!V.validatePersona({ ...base, prompt: long }).request, 'a prompt without the closing paragraph is allowed (the relay only warns)');
  ok(!!V.validatePersona({ ...base, prompt: long + 'x'.repeat(6000) }).errors.prompt, 'at most 6000 characters');
  const full = V.withClosing(prompt);
  ok(V.endsWithClosing(full) && V.withClosing(full) === full && full.endsWith(V.CLOSING_PARAGRAPH), 'withClosing adds the paragraph once');
  ok(/at least/.test(V.validatePersona({ ...base, prompt: V.withClosing('You are Zed.') }).errors.prompt ?? ''), 'a prompt of only the closing paragraph is too short');
  const r = V.validatePersona({ ...base, prompt: full, levels: [2, 1, 2] });
  ok(!!r.request && r.request.levels.join() === '1,2' && !('traits' in r.request) && !('languages' in r.request) && !('id' in r.request) && r.request.model === 'z-ai/glm-5.3-flash' && r.request.brain === 'default', 'levels deduped and sorted; our brain; no name, dials or languages unless asked');
  const named = V.validatePersona({ ...base, prompt: full, name: ' Zed-2 ', brain: 'remote' });
  ok(named.request?.id === 'zed-2' && named.request.brain === 'remote' && !!V.validatePersona({ ...base, prompt: full, name: 'zed!' }).errors.name && !!V.validatePersona({ ...base, prompt: full, name: '2zed' }).errors.name, 'short name like the relay’s ids, and the brain choice');
  ok(!!V.validatePersona({ ...base, prompt: full, languages: [{ code: 'fr', level: 'basic' }] }).errors.languages, 'languages need at least one native');
  ok(!!V.validatePersona({ ...base, prompt: full, levels: [] }).errors.levels, 'at least one level');
  const withDials = V.validatePersona({ ...base, prompt: full, useTraits: true, summary: ' 24, barista ', traits: { chatty: 0.42, fast: 1.3, curious: 0.555, guarded: -1, drift: 0.5 } });
  ok(JSON.stringify(withDials.request?.traits) === '{"summary":"24, barista","chatty":0.42,"fast":1,"curious":0.56,"guarded":0,"drift":0.5}', 'dials clamped to 0..1, two decimals, with the summary: ' + JSON.stringify(withDials.request?.traits));
  const langs = V.validatePersona({ ...base, prompt: full, languages: [{ code: 'EN', level: 'native' }, { code: 'fr', level: 'basic' }, { code: '', level: 'good' }] });
  ok(JSON.stringify(langs.request?.languages) === '{"en":"native","fr":"basic"}', 'languages as code -> level, blank rows skipped');
  ok(!!V.validatePersona({ ...base, prompt: full, languages: [{ code: 'english', level: 'native' }] }).errors.languages && !!V.validatePersona({ ...base, prompt: full, languages: [{ code: 'en', level: 'native' }, { code: 'en', level: 'good' }] }).errors.languages, 'bad or repeated language codes flagged');
  ok(V.validateNearAiKey('') !== null && V.validateNearAiKey('sk-short') !== null && V.validateNearAiKey('sk-abc def 1234567890') !== null && V.validateNearAiKey('sk-1234567890abcdef') === null, 'NEAR AI key checks');
  ok(V.validateToken(' ') !== null && V.validateToken('a b') !== null && V.validateToken('rbm_abc') === null, 'token checks');
  ok(V.modelLabel('deepseek-ai/DeepSeek-V4.1-Flash-1017') === 'DeepSeek V4.1 Flash' && V.modelLabel('acme/zed-1') === 'zed-1', 'model labels');
}

// ---------- 3. the mock builder API ----------
console.log('mock builder API');
{
  const m = new MockBuilderClient({ storageKey: null, delayMs: [0, 0] });
  const req = { name: 'Mira', email: 'mira@acme.ai', kind: 'chat_vendor' as const, models: 'GLM 5.3 Flash', goal: 'How often we pass', agreeTerms: true };
  const receipt = await m.requestAccess(req);
  ok(/^ar_[0-9a-f]{16}$/.test(receipt.id) && receipt.status === 'pending' && typeof receipt.createdAt === 'number', 'access request -> receipt ' + receipt.id);
  const bad = await rejects(m.requestAccess({ ...req, email: 'nope' }));
  ok(bad instanceof BuilderError && bad.status === 400 && bad.field === 'email', 'a bad email comes back with field "email"');
  const anon = await rejects(m.me('bad-token'));
  ok(anon instanceof BuilderError && anon.status === 401 && isAuthError(anon) && /token was not accepted/.test(friendlyError(anon, 'token')), 'a bad token: 401, said kindly');
  const me = await m.me(MOCK_TOKEN);
  ok(me.name === 'Acme Voice' && me.personas.length === 3 && me.personas.some((p) => !p.active) && me.byok === false, 'profile with three personas, one not active yet');
  const st = await m.stats(MOCK_TOKEN);
  const t = st.totals;
  const sum = (k: 'chats' | 'calledHuman' | 'calledBot' | 'missed' | 'paidChats') => Object.values(st.byPersona).reduce((a, s) => a + s[k], 0);
  ok(t.chats === sum('chats') && t.calledHuman === sum('calledHuman') && t.paidChats === sum('paidChats'), `totals add up over personas (${t.chats} chats)`);
  ok(t.chats === st.rounds.reduce((a, r) => a + r.chats, 0) && t.chats === t.calledHuman + t.calledBot + t.missed, 'and over rounds; chats counts every settled chat, missed included');
  ok(Math.abs((t.fooledShare ?? -1) - t.calledHuman / (t.calledHuman + t.calledBot)) < 1e-9 && t.coinFooledShare! > 0 && t.coinFooledShare! < 1, `called-human share ${Math.round(t.fooledShare! * 100)}%, by coins ${Math.round(t.coinFooledShare! * 100)}%`);
  ok(st.rounds.length === 12 && st.rounds.every((r, i) => i === 0 || r.roundId < st.rounds[i - 1].roundId) && st.rounds.every((r) => (r.settledAt ?? 0) < Date.now()), 'twelve settled rounds, newest first');
  // the endpoint caps limit at 200; collect every chat round by round
  const all = (await Promise.all(st.rounds.map((r) => m.chats(MOCK_TOKEN, { round: r.roundId, limit: 200 })))).flat();
  ok((await m.chats(MOCK_TOKEN)).length === 50 && (await m.chats(MOCK_TOKEN, { limit: 1000 })).length === Math.min(500, t.chats) && all.length === t.chats, 'limit 50 by default, at most 500; per round every chat comes back');
  ok(Math.abs(all.reduce((a, c) => a + c.turingBonusCoins, 0) - t.turingBonusCoins) < 0.01 && all.every((c, i) => i === 0 || c.startedAt <= all[i - 1].startedAt), 'chats newest first; their bonuses add up to the total');
  ok(all.every((c) => c.transcript.length > 2 && c.transcript.every((l, i) => i === 0 || l.at >= c.transcript[i - 1].at) && /^p_[0-9a-f]{12}$/.test(c.player)), 'every chat has a transcript in time order and an anonymous player tag (p_ and 12 hex)');
  ok(all.every((c) => c.fooled === c.playerCall && (c.playerMode === 'free' ? c.coins === 0 && c.turingBonusCoins === 0 : c.coins > 0) && (c.playerCall === false ? c.turingBonusCoins === 0 : true)), 'free chats move no coins; a bot call earns no bonus');
  const r42 = await m.chats(MOCK_TOKEN, { round: st.rounds[0].roundId, limit: 5 });
  ok(r42.length === 5 && r42.every((c) => c.roundId === st.rounds[0].roundId), 'round filter and limit');
  ok(JSON.stringify(scoreOf(all.filter((c) => c.roundId === st.rounds[0].roundId))) === JSON.stringify((({ roundId, settledAt, ...s }) => s)(st.rounds[0])), 'a round row is the score of its chats');
  const blob = await m.exportJsonl(MOCK_TOKEN);
  const lines = (await blob.text()).trim().split('\n');
  ok(lines.length === all.length && JSON.parse(lines[0]).chatId === all[all.length - 1].chatId && JSON.parse(lines[lines.length - 1]).chatId === all[0].chatId && Array.isArray(JSON.parse(lines[0]).transcript), `export: one chat per JSON line, oldest first (${lines.length})`);
  const shortKey = await rejects(m.setNearAiKey(MOCK_TOKEN, 'sk-1'));
  ok(shortKey instanceof BuilderError && shortKey.field === 'key', 'a short key comes back with field "key"');
  await m.setNearAiKey(MOCK_TOKEN, 'sk-0123456789abcdef');
  const byok = (await m.me(MOCK_TOKEN)).byok;
  await m.removeNearAiKey(MOCK_TOKEN);
  ok(byok === true && (await m.me(MOCK_TOKEN)).byok === false, 'own NEAR AI key on and off');
  const badPrompt = await rejects(m.requestPersona(MOCK_TOKEN, { model: 'z-ai/glm-5.3-flash', prompt: 'You are Zed.', levels: [1] }));
  ok(badPrompt instanceof BuilderError && badPrompt.code === 'invalid_request' && badPrompt.field === 'prompt', 'a too-short prompt comes back with field "prompt"');
  const otherModel = await rejects(m.requestPersona(MOCK_TOKEN, { model: 'Qwen/Qwen3.8-27B', prompt: V.withClosing('You are Zed, a barista in Leeds with a dry sense of humour.'), levels: [1] }));
  ok(otherModel instanceof BuilderError && otherModel.code === 'model_not_allowed' && otherModel.field === 'model', 'a model that cannot take the second system message: model_not_allowed');
  const plain = 'You are Kit, 19, a student in Accra who types fast, laughs a lot and asks questions back. You like football, Afrobeats and your little brother.'.repeat(2);
  const warned = await m.requestPersona(MOCK_TOKEN, { id: 'kit2', model: 'z-ai/glm-5.3-flash', prompt: plain, levels: [1] });
  const again = await m.requestPersona(MOCK_TOKEN, { id: 'kit2', model: 'z-ai/glm-5.3-flash', prompt: V.withClosing(plain), levels: [1, 2], brain: 'remote' });
  const kits = (await m.me(MOCK_TOKEN)).personas.filter((p) => p.id === 'acme-kit2');
  ok(warned.id === 'acme-kit2' && warned.warnings?.length === 1 && again.warnings?.length === 0 && kits.length === 1 && kits[0].brain === 'remote' && kits[0].levels.join() === '1,2', 'no closing paragraph: accepted with a warning; resent under the same name: replaced');
  const taken = await rejects(m.requestPersona(MOCK_TOKEN, { id: 'zed', model: 'z-ai/glm-5.3-flash', prompt: V.withClosing(plain), levels: [1] }));
  ok(taken instanceof BuilderError && taken.status === 409 && taken.code === 'persona_exists' && taken.field === 'id', 'an approved persona’s name: persona_exists');
  const { personaState } = await import('../src/agents/Setup.tsx');
  const card = { id: 'acme-x', model: 'z-ai/glm-5.3-flash', levels: [1 as const], brain: 'default' as const, active: false };
  ok(personaState({ ...card, status: 'rejected', reason: 'impersonates a real person' } as typeof card, null).label === 'Rejected' && personaState({ ...card, status: 'pending' } as typeof card, null).label === 'Pending review' && personaState({ ...card, status: 'approved' } as typeof card, null).label === 'Next round' && personaState({ ...card, active: true }, null).label === 'Active', 'persona labels follow the relay’s review status');
  ok(me.personas.some((p) => (p as { status?: string }).status === 'approved') && (await m.me(MOCK_TOKEN) as { online?: boolean }).online === true, 'profile extras: review status per persona, brain online');
  const pr = await m.requestPersona(MOCK_TOKEN, { model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', prompt: V.withClosing('You are Rosa, 38, a physiotherapist in Porto.'), levels: [3, 2] });
  const after = await m.me(MOCK_TOKEN);
  const added = after.personas.find((p) => p.id === pr.id);
  ok(pr.status === 'pending' && !!added && !added.active && added.levels.join() === '2,3', 'a persona request is pending and listed, not active');
}

// ---------- 4. the real builder client ----------
console.log('real builder client');
{
  const calls: { method: string; url: string; auth?: string; body?: string }[] = [];
  let next: Response | null = null;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method: init?.method ?? 'GET', url: url.replace('http://relay', ''), auth: h.Authorization, body: init?.body as string | undefined });
    if (next) {
      const r = next;
      next = null;
      return r;
    }
    if (url.includes('export.jsonl')) return new Response('{"chatId":"c1"}\n{"chatId":"c2"}\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    if (url.includes('/chats')) return new Response(JSON.stringify([{ chatId: 'c1' }]), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const rc = new RealBuilderClient({ base: 'http://relay', fetchImpl: fakeFetch });
  const req = { name: 'Mira', email: 'mira@acme.ai', kind: 'llm_operator' as const, models: 'm', goal: 'g', agreeTerms: true };
  await rc.requestAccess(req);
  await rc.me('tok');
  await rc.stats('tok');
  const list = await rc.chats('tok', { round: 42, limit: 10 });
  await rc.chats('tok');
  const blob = await rc.exportJsonl('tok');
  await rc.setNearAiKey('tok', 'sk-xyz');
  await rc.removeNearAiKey('tok');
  await rc.requestPersona('tok', { model: 'z-ai/glm-5.3-flash', prompt: 'p', levels: [1] });
  const got = calls.map((c) => `${c.method} ${c.url}`);
  const want = [
    'POST /api/agents/request', 'GET /api/botmaster/me', 'GET /api/botmaster/stats', 'GET /api/botmaster/chats?round=42&limit=10', 'GET /api/botmaster/chats',
    'GET /api/botmaster/export.jsonl', 'PUT /api/botmaster/nearai-key', 'DELETE /api/botmaster/nearai-key', 'POST /api/botmaster/personas',
  ];
  ok(JSON.stringify(got) === JSON.stringify(want), 'paths and methods per protocol v1.2');
  ok(!calls[0].auth && calls.slice(1).every((c) => c.auth === 'Bearer tok'), 'the access request is public; every botmaster call sends the bearer token');
  ok(JSON.parse(calls[0].body!).email === 'mira@acme.ai' && calls[6].body === '{"key":"sk-xyz"}' && JSON.parse(calls[8].body!).levels[0] === 1, 'request bodies');
  ok(list.length === 1 && (await blob.text()).split('\n').filter(Boolean).length === 2, 'chats array and the JSONL export as a blob');
  next = new Response(JSON.stringify({ chats: [{ chatId: 'w1' }, { chatId: 'w2' }] }), { status: 200 });
  ok((await rc.chats('tok')).length === 2, 'a wrapped chat list is tolerated');
  next = new Response(JSON.stringify({ error: 'unauthorized', code: 'unauthorized', message: 'unknown token', field: 'token' }), { status: 401 });
  const e1 = await rejects(rc.me('nope'));
  ok(e1 instanceof BuilderError && e1.status === 401 && e1.code === 'unauthorized' && e1.message === 'unknown token' && e1.field === 'token' && isAuthError(e1), 'HTTP errors: {error, code, message, field}');
  next = new Response('upstream down', { status: 502 });
  const e2 = await rejects(rc.stats('tok'));
  ok(e2 instanceof BuilderError && e2.status === 502 && /problem/.test(friendlyError(e2)), 'a non-JSON 502 becomes a readable error');
  const offline = new RealBuilderClient({ fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
  const e3 = await rejects(offline.me('t'));
  ok(e3 instanceof BuilderError && e3.status === 0 && /reach Realsies/.test(friendlyError(e3)), 'offline: status 0, said kindly');
  next = new Response(JSON.stringify({ error: 'not_found', code: 'not_found', message: 'GET /api/botmaster/me' }), { status: 404 });
  ok(/does not have the botmaster API/.test(friendlyError(await rejects(rc.me('t')))), 'a relay without the endpoints says so');
}

// ---------- 5. routes and the hero lineup ----------
console.log('routes and layout');
{
  ok(routeOf('/agents') === 'agents' && routeOf('/agents/') === 'agents' && routeOf('/agents/dashboard') === 'dashboard' && routeOf('/AGENTS/Dashboard/') === 'dashboard', 'agents and dashboard routes');
  ok(routeOf('/') === 'game' && routeOf('/agentsx') === 'game' && routeOf('/agents/x') === 'game', 'everything else is the game');
  ok(keepMock('/agents#apply', '?mock=1&qa=x') === '/agents?mock=1#apply' && keepMock('/agents?x=1', '?mock=1') === '/agents?x=1&mock=1' && keepMock('/agents', '') === '/agents' && keepMock('/agents', '?mock=0') === '/agents', 'links keep mock mode');
  const { lineupFit, pageUpx, lineupSeeds } = await import('../src/agents/parts.tsx');
  const sizes: [number, number, number][] = [[360, 640, 2], [390, 844, 3], [430, 932, 3], [844, 390, 3], [768, 1024, 2], [1024, 768, 2], [1280, 720, 1], [1440, 900, 1], [1920, 1080, 1], [2560, 1440, 1]];
  const bad: string[] = [];
  for (const [w, h, dpr] of sizes) {
    const inner = Math.min(w >= 1800 ? 1440 : 1160, w - (w >= 700 ? 56 : 32));
    const f = lineupFit(inner, h, dpr);
    const used = f.n * ((64 * f.k) / dpr) + (f.n - 1) * f.gap;
    if (used > inner + 0.5) bad.push(`${w}x${h} lineup ${Math.round(used)} > ${inner}`);
    if (f.n < 4) bad.push(`${w}x${h} only ${f.n} characters`);
    if (f.k < 2 || !Number.isInteger(f.k)) bad.push(`${w}x${h} scale ${f.k}`);
    if ((76 * f.k) / dpr > h * 0.3 + 1) bad.push(`${w}x${h} lineup too tall`);
    if (!Number.isInteger(pageUpx(w, dpr) * dpr)) bad.push(`${w}x${h} kit pixel not whole device pixels`);
  }
  ok(bad.length === 0, 'the hero lineup fits every QA size at whole pixels' + (bad.length ? ': ' + bad.join('; ') : ''));
  const seeds = lineupSeeds();
  ok(seeds.length === 5 && seeds.every((s) => s.name.length <= 8 && /^[0-9a-f]{64}$/.test(s.seed)), 'five lineup characters with short gamertags: ' + seeds.map((s) => s.name).join(' '));
}

// ---------- 6. bots_unavailable: no bots, no new chats ----------
console.log('bots_unavailable');
{
  let handler: ((m: ServerMsg) => void) | null = null;
  const sent: unknown[] = [];
  const stub = {
    on: (h: (m: ServerMsg) => void) => ((handler = h), () => {}),
    onStatus: () => () => {},
    send: (m: unknown) => sent.push(m),
    connect() {},
    disconnect() {},
  } as unknown as GameClient;
  const s = createStore(stub);
  s.actions.pickSeat(1, 3, 'paid', 10);
  handler!({ t: 'searching', level: 1, seatIndex: 3 });
  handler!({ t: 'error', code: 'bots_unavailable', message: 'Nobody is free to chat in this room right now.' });
  const st = s.get();
  ok(!st.search && st.notice?.code === 'bots_unavailable' && st.notice.message === BOTS_NAPPING && !st.lastError, 'a search ends at once with one calm note, no error toast');
  ok(/paused/.test(BOTS_NAPPING) && !/human/i.test(BOTS_NAPPING), 'the note says new chats are paused and nothing about who else is around');
  s.actions.clearNotice();
  const info = { chatId: 'cz', roundId: 1, level: 1 as const, seatIndex: 4, theme: 'castle' as const, partner: { seed: 'a'.repeat(64), name: 'Pickle435' }, mode: 'paid' as const, coins: 10 };
  handler!({ t: 'matched', chat: info });
  handler!({ t: 'error', code: 'bots_unavailable', message: 'This chat could not start. If you played coins, they come back when the round settles.' });
  const st2 = s.get();
  ok(!st2.notice && /could not start/.test(st2.lastError?.message ?? '') && !!st2.chat, 'a matched chat that could not start keeps the relay’s own message');
  s.actions.logout();

  // the mock relay pauses every new chat the same way, human to human included
  const m = new MockGameClient({ storageKey: null, timeScale: 0.02, searchMs: [10, 20], countdownSeconds: 0, forceHuman: true, noBots: true });
  const seen: ServerMsg[] = [];
  m.on((x) => seen.push(x));
  m.connect('ana.realsies.testnet');
  const wait = async (pred: () => boolean, ms = 3000) => {
    for (let t = 0; t < ms && !pred(); t += 10) await new Promise((r) => setTimeout(r, 10));
    return pred();
  };
  await wait(() => seen.some((x) => x.t === 'welcome'));
  m.send({ t: 'enter_room', level: 1 });
  await wait(() => seen.some((x) => x.t === 'room'));
  m.send({ t: 'pick_seat', level: 1, seatIndex: 2, mode: 'free' });
  await wait(() => seen.some((x) => x.t === 'error'));
  await new Promise((r) => setTimeout(r, 120));
  const err = seen.find((x) => x.t === 'error') as Extract<ServerMsg, { t: 'error' }> | undefined;
  const seat = [...seen].reverse().find((x) => x.t === 'seat') as Extract<ServerMsg, { t: 'seat' }> | undefined;
  ok(err?.code === 'bots_unavailable' && !seen.some((x) => x.t === 'searching' || x.t === 'matched'), 'mock, no bots: the pick is refused at once, even with a human about');
  ok(seat?.seat.index === 2 && seat.seat.state === 'open', 'and the seat goes back');
  m.dispose();
}

// ---------- 6b. who entered a bot (relay extra on ChatResult and VerifyBundle) ----------
{
  const { botmasterOf } = await import('../src/state/format.ts');
  ok(botmasterOf({ botmaster: ' acme ' }) === 'acme' && botmasterOf({}) === null && botmasterOf({ botmaster: 5 }) === null && botmasterOf(null) === null, 'botmaster shown only when the relay names one');
}

// ---------- 7. vocabulary ----------
console.log('vocabulary');
{
  const banned = /\b(bet|bets|betting|stake|staked|staking|odds|wager|pool|market)\b/i;
  const dir = join(here, '..', 'src', 'agents');
  const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => join(dir, f));
  files.push(join(here, '..', 'src', 'net', 'builders.ts'), join(here, '..', 'src', 'net', 'mock', 'builders.ts'), join(here, '..', 'src', 'state', 'notices.ts'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!banned.test(src), `${f.split(/[\\/]/).slice(-2).join('/')}: no banned vocabulary`);
  }
  const bu = ['state/store.ts', 'state/notices.ts', 'screens/Chat.tsx', 'net/mock.ts', 'hud.css'].map((f) => readFileSync(join(here, '..', 'src', f), 'utf8')).join('\n');
  ok(!/human may|still come|still looking for a human|only a human/i.test(bu), 'nothing says a human may still come while the bots nap');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
