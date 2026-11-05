// AI builders and NEAR AI credits, without a relay: BYOK encryption, credit-failure detection, spend and
// the credit monitor (budget, out of credits, recheck, recovery, persistence), input validation, the
// scorecard math against the contract's settlement, and the players' anonymous ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, parseEncryptionKey, seal } from '../src/secretbox.js';
import { CreditMonitor, backfillSpend, costUsd, keyFailure, tinyRequest, usageOf, cheapestModel } from '../src/nearai/credits.js';
import type { CompletionResult, NearAi } from '../src/nearai/client.js';
import { Db } from '../src/db.js';
import { modelProblem, validateAccessRequest, validatePersona } from '../src/agents/validate.js';
import { agentChatsOf, anonPlayer, scoreOf, statsOf } from '../src/agents/stats.js';
import { slugify } from '../src/agents/admin.js';
import { STEER_PARAGRAPH } from '../src/persona/prompt.js';
import { MockNearAi } from '../src/nearai/client.js';
import type { CharacterRec, ChatSide, RoundRec } from '../src/game/types.js';
import type { ChainPlay } from '../src/chain/types.js';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-unit-')), 'relay.db');

test('BYOK sealing: AES-256-GCM round trip; a wrong key, another botmaster or one changed byte fails', () => {
  const k = crypto.randomBytes(32);
  const box = seal(k, 'sk-acme-secret-0123456789', 'realsies:byok:v1|acme');
  assert.ok(!JSON.stringify(box).includes('sk-acme'), 'no plaintext in the box');
  assert.equal(open(k, box, 'realsies:byok:v1|acme'), 'sk-acme-secret-0123456789');
  assert.notEqual(seal(k, 'same', 'a').iv, seal(k, 'same', 'a').iv, 'a fresh IV every time');
  assert.throws(() => open(crypto.randomBytes(32), box, 'realsies:byok:v1|acme'), /different RELAY_ENCRYPTION_KEY/);
  assert.throws(() => open(k, box, 'realsies:byok:v1|other'), 'bound to its botmaster');
  const ct = Buffer.from(box.ct, 'base64');
  ct[0] ^= 1;
  assert.throws(() => open(k, { ...box, ct: ct.toString('base64') }, 'realsies:byok:v1|acme'), 'tampered ciphertext');
  const tag = Buffer.from(box.tag, 'base64');
  tag[3] ^= 1;
  assert.throws(() => open(k, { ...box, tag: tag.toString('base64') }, 'realsies:byok:v1|acme'), 'tampered tag');
  // RELAY_ENCRYPTION_KEY: 64 hex or base64 of 32 bytes; unset is undefined; anything else throws
  assert.equal(parseEncryptionKey(undefined), undefined);
  assert.equal(parseEncryptionKey('  '), undefined);
  assert.deepEqual(parseEncryptionKey(k.toString('hex')), k);
  assert.deepEqual(parseEncryptionKey(k.toString('base64')), k);
  assert.deepEqual(parseEncryptionKey(k.toString('base64url')), k);
  assert.throws(() => parseEncryptionKey('correct horse battery staple'), /32 bytes/);
  assert.throws(() => parseEncryptionKey('ab'.repeat(31)), /32 bytes/);
});

test('credit failures: HTTP 402, and a 400 or 403 about credits, balance, quota or billing; 401 rejects the key; never a 429 or a 5xx', () => {
  assert.equal(keyFailure(402, '')?.kind, 'credits');
  assert.equal(keyFailure(402, '{"error":{"message":"Payment Required"}}')?.kind, 'credits');
  assert.equal(keyFailure(403, '{"error":{"message":"Insufficient balance"}}')?.kind, 'credits');
  assert.equal(keyFailure(400, '{"detail":"Not enough credits"}')?.kind, 'credits');
  assert.equal(keyFailure(400, '{"error":{"message":"Monthly quota exceeded for this key","type":"billing_error"}}')?.kind, 'credits');
  // rate limits often say "quota", server errors pass: neither ever marks a key out
  assert.equal(keyFailure(429, '{"error":{"message":"quota exceeded, retry in 20 s"}}'), null);
  assert.equal(keyFailure(429, '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}'), null);
  assert.equal(keyFailure(500, 'billing service unavailable'), null);
  assert.equal(keyFailure(503, '{"error":{"message":"Insufficient credits"}}'), null);
  assert.equal(keyFailure(404, '{"error":{"message":"no credits for this route"}}'), null, 'only 400, 402 and 403 are read for credit words');
  assert.equal(keyFailure(401, '{"error":{"message":"Invalid API key"}}')?.kind, 'auth');
  assert.equal(keyFailure(429, '{"error":{"message":"Rate limit reached, slow down"}}'), null);
  assert.equal(keyFailure(503, '{"error":{"message":"mock failure"}}'), null);
  assert.equal(keyFailure(400, '{"error":{"message":"System message must be at the beginning"}}'), null);
  assert.equal(keyFailure(0, ''), null, 'a network error says nothing about the key');
  assert.equal(keyFailure(200, '{"error":{"message":"credits"}}'), null);
  assert.match(keyFailure(402, '{"error":{"message":"Insufficient credits"}}')!.detail, /^HTTP 402: Insufficient credits/);
});

test('spend: usage times the model price; the recheck is a one-token request to the cheapest model', () => {
  const resp = JSON.stringify({ id: 'x', usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  assert.deepEqual(usageOf(resp), { input: 1000, output: 100 });
  assert.equal(costUsd('z-ai/glm-5.3-flash', usageOf(resp)), (1000 * 0.08 + 100 * 0.5) / 1e6);
  assert.equal(costUsd('deepseek-ai/DeepSeek-V4.1-Flash-1017', { input: 1e6, output: 1e6 }), 1.5);
  assert.equal(costUsd('unknown/model', usageOf(resp)), 0);
  assert.equal(usageOf('not json'), null);
  assert.equal(cheapestModel(), 'z-ai/glm-5.3-flash');
  const tiny = JSON.parse(tinyRequest());
  assert.equal(tiny.max_tokens, 1);
  assert.equal(tiny.model, 'z-ai/glm-5.3-flash');
  assert.equal(tiny.reasoning_effort, 'low', 'with the model\'s reasoning option');
});

const ok = (input: number, output: number): CompletionResult => ({
  ok: true, status: 200, completionId: 'c', response: JSON.stringify({ id: 'c', model: 'z-ai/glm-5.3-flash', usage: { prompt_tokens: input, completion_tokens: output } }), content: 'ok', latencyMs: 5,
});
const fail = (status: number, body: string): CompletionResult => ({ ok: false, status, response: body, content: null, latencyMs: 5, error: body });

test('credit monitor: spend, low credit at 80% of the budget, out of credits, rechecks, recovery, kept across restarts', async () => {
  const file = tmpDb();
  let db = new Db(file);
  let t = 1_000_000;
  // budget $0.001: 10 000 input tokens of GLM 5.3 Flash cost $0.0008
  let m = new CreditMonitor(db, { budgetUsd: 0.001, recheckMs: 60_000, now: () => t });
  m.bind('house', 'fp-house');
  assert.deepEqual(m.health(), { status: 'ok', since: t, spendUsd: 0, budgetUsd: 0.001 });
  m.observe('house', 'z-ai/glm-5.3-flash', ok(5000, 0));
  assert.equal(m.health().status, 'ok');
  t += 1000;
  m.observe('house', 'z-ai/glm-5.3-flash', ok(5000, 0));
  assert.equal(m.health().status, 'low_credit', '80% of the budget');
  assert.equal(m.health().since, t);
  assert.equal(m.health().spendUsd, 0.0008);
  assert.equal(m.usable('house'), true, 'low credit still plays');
  // a 503 is not about credits; a 402 is
  m.observe('house', 'z-ai/glm-5.3-flash', fail(503, '{"error":{"message":"overloaded"}}'));
  assert.equal(m.usable('house'), true);
  // a 429 that says "quota exceeded" is a rate limit: the key stays in
  m.observe('house', 'z-ai/glm-5.3-flash', fail(429, '{"error":{"message":"quota exceeded, retry in 20 s","type":"rate_limit"}}'));
  assert.equal(m.usable('house'), true, 'a 429 with "quota exceeded" does not mark the key out');
  assert.equal(m.health().status, 'low_credit');
  t += 1000;
  m.observe('house', 'z-ai/glm-5.3-flash', fail(402, '{"error":{"message":"Insufficient credits"}}'));
  assert.equal(m.usable('house'), false);
  const h = m.health();
  assert.equal(h.status, 'out_of_credits');
  assert.equal(h.since, t);
  assert.match(h.reason!, /402/);
  // what anyone may see: status and since, nothing about spend or why
  assert.deepEqual(m.publicHealth(), { status: 'out_of_credits', since: t });
  // other keys are independent
  m.bind('byok:acme', 'fp-acme');
  assert.equal(m.usable('byok:acme'), true);
  // the operator's list: every key, the house first, with spend and the reason
  const keys = m.all();
  assert.deepEqual(keys.map((k) => [k.keyId, k.status]), [['house', 'out_of_credits'], ['byok:acme', 'ok']]);
  assert.equal(keys[0].spendUsd, 0.0008);
  assert.match(keys[0].reason!, /402/);
  m.flush();
  db.close();

  // a restart keeps the state, and rechecks: still failing, then working again
  db = new Db(file);
  m = new CreditMonitor(db, { budgetUsd: 0.001, recheckMs: 60_000, now: () => t });
  m.bind('house', 'fp-house');
  assert.equal(m.usable('house'), false, 'still out after a restart');
  let next = fail(402, '{"error":{"message":"Insufficient credits"}}');
  const calls: string[] = [];
  const client = { kind: 'mock', complete: async (_model: string, req: string) => (calls.push(req), next) } as unknown as NearAi;
  m.clientFor = (k) => (k === 'house' ? client : undefined);
  assert.equal(await m.recheck('house'), false);
  assert.equal(JSON.parse(calls[0]).max_tokens, 1, 'the recheck is a one-token completion');
  assert.equal(m.usable('house'), false);
  next = ok(15, 1);
  t += 60_000;
  assert.equal(await m.recheck('house'), true);
  assert.equal(m.usable('house'), true);
  assert.equal(m.health().status, 'low_credit', 'back to the spend-based status');
  // any successful call recovers a key at once
  m.markOut('house', { kind: 'credits', detail: 'HTTP 402' });
  m.observe('house', 'z-ai/glm-5.3-flash', ok(1, 1));
  assert.equal(m.usable('house'), true);
  // a new key under the same id starts a fresh record
  m.bind('house', 'fp-new-key');
  assert.equal(m.health().spendUsd, 0);
  assert.equal(m.health().status, 'ok');
  m.stop();
  db.close();
});

test('spend backfill: the usage of every stored completion and draft, priced by its model, once', () => {
  const db = new Db(':memory:');
  const usage = (p: number, c: number) => JSON.stringify({ id: 'x', usage: { prompt_tokens: p, completion_tokens: c } });
  db.saveCompletion({ chatId: 'c1', idx: 0, completionId: 'x', model: 'z-ai/glm-5.3-flash', request: '{}', response: usage(10_000, 1000), signature: null, verify: null, displayed: null, at: 1, latencyMs: 1, error: null });
  db.saveCompletion({ chatId: 'c1', idx: 1, completionId: 'y', model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', request: '{}', response: usage(1000, 100), signature: null, verify: null, displayed: null, at: 2, latencyMs: 1, error: null });
  db.saveDraft({ chatId: 'c1', sayId: 3, at: 3, steering: 'reply/one', request: JSON.stringify({ model: 'z-ai/glm-5.3-flash' }), response: usage(2000, 0), completionId: 'z', signature: null, verify: null, reason: 'cancelled' });
  db.saveDraft({ chatId: 'c1', sayId: 4, at: 4, steering: 'reply/one', request: 'not json', response: '', completionId: null, signature: null, verify: null, reason: 'model_failed' });
  const b = backfillSpend(db);
  const want = (10_000 * 0.08 + 1000 * 0.5 + 1000 * 0.3 + 100 * 1.2 + 2000 * 0.08) / 1e6;
  assert.equal(b.calls, 3);
  assert.ok(Math.abs(b.usd - want) < 1e-12, `${b.usd} vs ${want}`);
  db.close();
});

test('credit monitor: the timer rechecks a key that is out', async () => {
  const db = new Db(':memory:');
  const m = new CreditMonitor(db, { budgetUsd: 10, recheckMs: 200 });
  const mock = new MockNearAi();
  mock.latencyMs = [1, 2];
  mock.creditFail = true;
  m.clientFor = () => mock;
  m.bind('house', 'x');
  m.observe('house', 'z-ai/glm-5.3-flash', await mock.complete('z-ai/glm-5.3-flash', tinyRequest()));
  assert.equal(m.health().status, 'out_of_credits');
  m.start();
  try {
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(m.usable('house'), false, 'still failing');
    mock.creditFail = false;
    for (let i = 0; i < 40 && !m.usable('house'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(m.usable('house'), true, 'recovered by the recheck');
  } finally {
    m.stop();
    db.close();
  }
});

const goodRequest = {
  name: '  Ada Lovelace ', email: 'Ada@Example.COM', company: 'Analytical Engines', website: 'https://engines.example', kind: 'chat_vendor',
  models: 'our own fine-tune of GLM\nand a voice stack', goal: 'see how often people think our agent is human', volume: '200 a day', payoutAccount: 'ada.testnet', agreeTerms: true,
};

test('access requests: lengths, email shape, kind, agreeTerms, payout account; strings trimmed', () => {
  const r = validateAccessRequest(goodRequest);
  assert.equal(r.name, 'Ada Lovelace');
  assert.equal(r.email, 'ada@example.com');
  assert.equal(r.models, 'our own fine-tune of GLM\nand a voice stack');
  const bad = (patch: Record<string, unknown>, field: RegExp) => assert.throws(() => validateAccessRequest({ ...goodRequest, ...patch }), (e: any) => e.code === 'invalid_request' && field.test(e.field) && e.status === 400);
  bad({ email: 'not-an-email' }, /^email$/);
  bad({ email: 'a@b' }, /^email$/);
  bad({ email: undefined }, /^email$/);
  bad({ name: 'x'.repeat(101) }, /^name$/);
  bad({ name: 'two\nlines' }, /^name$/);
  bad({ name: '' }, /^name$/);
  bad({ kind: 'spammer' }, /^kind$/);
  bad({ agreeTerms: false }, /^agreeTerms$/);
  bad({ agreeTerms: 'yes' }, /^agreeTerms$/);
  bad({ goal: 'g'.repeat(2001) }, /^goal$/);
  bad({ website: 'javascript:alert(1)' }, /^website$/);
  bad({ payoutAccount: 'Not An Account!' }, /^payoutAccount$/);
  bad({ models: 'bell\u0007' }, /^models$/);
  assert.throws(() => validateAccessRequest([]), /JSON object/);
  const minimal = validateAccessRequest({ name: 'Bo', email: 'bo@x.io', kind: 'other', models: 'm', goal: 'g', agreeTerms: true });
  assert.deepEqual(Object.keys(minimal).sort(), ['agreeTerms', 'email', 'goal', 'kind', 'models', 'name']);
});

const PROMPT = `You are Zed, 24, a barista in Leeds who plays chat games on a break. Text like a person: short lines, lowercase, the odd typo. ${STEER_PARAGRAPH}`;

test('persona submissions: fields, ranges, warnings; only nearai enclave models the relay runs', async () => {
  const { sub, warnings } = validatePersona({ id: 'zed', model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels: [2, 1, 2], traits: { chatty: 0.3, summary: 'barista' }, languages: { en: 'native' }, typing: { cps: 5.5 } });
  assert.deepEqual(sub.levels, [1, 2]);
  assert.equal(sub.slug, 'zed');
  assert.equal(sub.brain, 'default');
  assert.equal(sub.cps, 5.5);
  assert.deepEqual(sub.traits, { chatty: 0.3 });
  assert.equal(sub.summary, 'barista');
  assert.deepEqual(warnings, []);
  const p = (patch: Record<string, unknown>) => ({ model: 'z-ai/glm-5.3-flash', prompt: PROMPT, levels: [1], ...patch });
  const bad = (patch: Record<string, unknown>, field: RegExp) => assert.throws(() => validatePersona(p(patch)), (e: any) => e.status === 400 && field.test(e.field ?? ''));
  bad({ text: 'free text' }, /^text$/);
  bad({ prompt: 'too short' }, /^prompt$/);
  bad({ prompt: 'x'.repeat(6001) }, /^prompt$/);
  bad({ levels: [] }, /^levels$/);
  bad({ levels: [4] }, /^levels$/);
  bad({ brain: { remote: 'acme' } }, /^brain$/);
  bad({ traits: { chatty: 2 } }, /^traits\.chatty$/);
  bad({ traits: { charm: 1 } }, /^traits\.charm$/);
  bad({ languages: { en: 'fluent' } }, /^languages$/);
  bad({ languages: { xx: 'native' } }, /^languages$/);
  bad({ cps: 20 }, /^cps$/);
  bad({ id: '1bad' }, /^id$/);
  bad({ interests: ['crypto'] }, /^interests$/);
  const w = validatePersona(p({ prompt: 'You are Zed. '.repeat(30), brain: 'remote' }));
  assert.equal(w.sub.brain, 'remote');
  assert.match(w.warnings.join(' '), /steering paragraph/);
  const listing = await new MockNearAi().models();
  assert.equal(modelProblem('z-ai/glm-5.3-flash', listing), null);
  assert.equal(modelProblem('deepseek-ai/DeepSeek-V4.1-Flash-1017', listing), null);
  assert.match(modelProblem('openai/gpt-5.5', listing)!, /owned by openai, not nearai/);
  assert.match(modelProblem('Qwen/Qwen3.8-27B', listing)!, /second system message/);
  assert.match(modelProblem('nope/model', listing)!, /not served/);
  assert.match(modelProblem('deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated', [{ id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017-abliterated', owned_by: 'nearai' }])!, /does not run yet/);
  assert.equal(slugify('Analytical Engines, Ltd.'), 'analytical-engines-ltd');
  assert.equal(slugify('Ünïcode Café'), 'unicode-cafe');
});

const UNIT = 10n ** 18n;
const locked = (coins: number) => (BigInt(coins) * UNIT * 9500n) / 10000n;

function scenario() {
  const round = { id: 7, settledAt: 123, secret: 's' } as unknown as RoundRec;
  const vendor = { id: 'cv', roundId: 7, kind: 'bot', level: 1, personaId: 'acme-zed', model: 'z-ai/glm-5.3-flash', persona: { owner: 'acme', brain: { kind: 'default' } } } as unknown as CharacterRec;
  const house = { id: 'ch', roundId: 7, kind: 'bot', level: 1, personaId: 'mia-leeds', model: 'z-ai/glm-5.3-flash', persona: { brain: { kind: 'default' } } } as unknown as CharacterRec;
  const side = (chatId: string, viewer: string, characterId: string, paid: number, call: boolean | null, extra: Partial<ChatSide> = {}) =>
    ({
      chatId, viewer, characterId, roundId: 7, level: 1, partnerKind: 'bot', playStatus: paid ? 'placed' : 'none', mode: paid ? 'paid' : 'free', coins: paid,
      myCall: call, handle: `h-${chatId}`, startedAt: 1000, createdAt: 900,
      messages: [{ id: 'm1', from: 'me', text: `hi from ${viewer}`, at: 1001 }, { id: 'm2', from: 'them', text: 'hey', at: 1002, ci: 0 }], ...extra,
    }) as unknown as ChatSide;
  const sides = [
    side('s1', 'ana.testnet', 'cv', 10, true),
    side('s2', 'ben.testnet', 'cv', 20, true),
    side('s3', 'ana.testnet', 'cv', 30, false),
    side('s4', 'cleo.testnet', 'cv', 5, null),
    side('s5', 'dex.testnet', 'cv', 0, true),
    side('s6', 'eve.testnet', 'cv', 0, null),
    side('s7', 'finn.testnet', 'cv', 0, false, { aborted: 'bots_unavailable' }),
    side('s8', 'ana.testnet', 'ch', 25, true),
  ];
  const play = (s: ChatSide): ChainPlay => ({ handle: s.handle, account: s.viewer, coins: s.coins, amount: BigInt(s.coins) * UNIT, locked: locked(s.coins), call: s.myCall ?? null, characterId: s.characterId, credited: null });
  return { round, characters: [vendor, house], sides, chainPlays: sides.filter((s) => s.playStatus === 'placed').map(play) };
}

test('settled chats and scorecard: fooled shares, missed calls, and the Turing bonus split exactly as the contract pays it', () => {
  const sc = scenario();
  const recs = agentChatsOf({ ...sc, coinUnit: UNIT, anonSecret: 'k' });
  assert.deepEqual(recs.map((r) => r.chatId), ['s1', 's2', 's3', 's4', 's5', 's6'], 'the vendor\'s chats only; the aborted one and the house bot\'s are left out');
  // the contract: W = locked of wrong plays (called human, or missed) = 35 x 0.95; R = 30 x 0.95 > 0, so 20% of W
  const W = locked(10) + locked(20) + locked(5);
  const credit = (W * 2000n) / 10000n;
  const bonus = Object.fromEntries(recs.map((r) => [r.chatId, BigInt(r.turingBonusUnits)]));
  assert.equal(bonus.s1, (credit * locked(10)) / W);
  assert.equal(bonus.s2, (credit * locked(20)) / W);
  assert.equal(bonus.s4, (credit * locked(5)) / W, 'a missed paid call counts as wrong on chain, so it pays the bonus too');
  assert.equal(bonus.s3 + bonus.s5 + bonus.s6, 0n);
  assert.ok(credit - (bonus.s1 + bonus.s2 + bonus.s4) <= 2n, 'the shares add up to the payout (to the base unit)');
  const s1 = recs.find((r) => r.chatId === 's1')!;
  assert.deepEqual(
    { mode: s1.playerMode, coins: s1.coins, call: s1.playerCall, fooled: s1.fooled, bonus: s1.turingBonusCoins, level: s1.level, startedAt: s1.startedAt, model: s1.model, persona: s1.personaId },
    { mode: 'paid', coins: 10, call: true, fooled: true, bonus: 1.9, level: 1, startedAt: 1000, model: 'z-ai/glm-5.3-flash', persona: 'acme-zed' },
  );
  assert.deepEqual(s1.transcript, [{ from: 'player', text: 'hi from ana.testnet', at: 1001 }, { from: 'bot', text: 'hey', at: 1002 }]);
  assert.equal(recs.find((r) => r.chatId === 's6')!.fooled, null);
  const score = scoreOf(recs, UNIT);
  assert.deepEqual(score, {
    chats: 6, paidChats: 4, calledHuman: 3, calledBot: 1, missed: 2,
    fooledShare: 0.75, // 3 of the 4 calls
    coinFooledShare: 0.5, // (10 + 20) of the 60 coins of paid calls
    turingBonusCoins: 6.65, // 20% of 33.25
  });
  // nobody called it right: 90% of the wrong coins
  const lone = scenario();
  lone.sides = [lone.sides[0]];
  lone.chainPlays = [lone.chainPlays[0]];
  const r0 = agentChatsOf({ ...lone, coinUnit: UNIT, anonSecret: 'k' });
  assert.equal(r0[0].turingBonusCoins, 8.55);
  assert.deepEqual(scoreOf([], UNIT), { chats: 0, paidChats: 0, calledHuman: 0, calledBot: 0, missed: 0, fooledShare: null, coinFooledShare: null, turingBonusCoins: 0 });
  // per persona (listed ones even without chats) and per round, newest first
  const later = recs.map((r) => ({ ...r, roundId: 8, chatId: `${r.chatId}-8`, settledAt: 456 }));
  const st = statsOf([...recs, ...later.slice(0, 2)], UNIT, ['acme-zed', 'acme-new']);
  assert.deepEqual(st.rounds.map((r) => [r.roundId, r.chats, r.settledAt]), [[8, 2, 456], [7, 6, 123]]);
  assert.equal(st.totals.chats, 8);
  assert.equal(st.byPersona['acme-zed'].chats, 8);
  assert.equal(st.byPersona['acme-new'].chats, 0);
});

test('anonymous players: stable within a round for one botmaster, unlinkable across rounds and botmasters, no account in sight', () => {
  const sc = scenario();
  const recs = agentChatsOf({ ...sc, coinUnit: UNIT, anonSecret: 'secret-1' });
  const by = Object.fromEntries(recs.map((r) => [r.chatId, r.player]));
  assert.equal(by.s1, by.s3, 'ana twice in round 7: one id');
  assert.notEqual(by.s1, by.s2, 'ana and ben differ');
  assert.equal(new Set(Object.values(by)).size, 5, 'five players');
  assert.ok(Object.values(by).every((p) => /^p_[0-9a-f]{12}$/.test(p)));
  const json = JSON.stringify(recs.map((r) => ({ ...r, transcript: [] })));
  for (const a of ['ana.testnet', 'ben.testnet', 'cleo.testnet', 'dex.testnet', 'eve.testnet', '.testnet']) assert.ok(!json.includes(a), `no ${a} in the records`);
  assert.equal(anonPlayer('secret-1', 'acme', 7, 'ana.testnet'), by.s1);
  assert.notEqual(anonPlayer('secret-1', 'acme', 8, 'ana.testnet'), by.s1, 'another round');
  assert.notEqual(anonPlayer('secret-1', 'other', 7, 'ana.testnet'), by.s1, 'another botmaster');
  assert.notEqual(anonPlayer('secret-2', 'acme', 7, 'ana.testnet'), by.s1, 'keyed');
});
