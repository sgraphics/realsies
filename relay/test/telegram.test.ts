// Round summaries and the end of Turing Hour on Telegram (src/telegram.ts), and the Turing Hour settings: the
// thresholds, the lines left out when their number is zero, one message per round and per day's hour (also after a
// restart), a failing or slow Telegram that never holds up a round, and the bot token absent from every log line.
// Every sender here is a stub: no test calls Telegram.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Telegram, hourMessage, roundMessage, roundStats, telegramFromEnv, type RoundStats, type TelegramSend, type TelegramSettings } from '../src/telegram.js';
import { loadConfig, turingHourFromEnv } from '../src/config.js';
import { lastTuringHour, turingNow } from '../../shared/turing.js';
import type { CharacterRec, ChatSide } from '../src/game/types.js';
import type { ChainPlay } from '../src/chain/types.js';
import { createApp } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import { MockNearAi } from '../src/nearai/client.js';
import { WsClient } from './client.js';

const TOKEN = '7012345678:AAF-secret_token_value_0123456789xyz';
const SETTINGS: TelegramSettings = { token: TOKEN, chat: '@realsieslol', minChats: 3, minPlayers: 2, own: [] };
const SITE = 'https://realsies.lol';
const MIN = 60_000;
const H = 60 * MIN;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MemKv {
  m = new Map<string, string>();
  getKv(k: string) {
    return this.m.get(k);
  }
  setKv(k: string, v: string) {
    this.m.set(k, v);
  }
}

/** A sender that records every request and answers as Telegram does, or as `answer` says. */
function stubSender(answer: (n: number, signal: AbortSignal) => Promise<{ status: number; text: string }> = async () => ({ status: 200, text: '{"ok":true,"result":{}}' })) {
  const calls: { url: string; body: any }[] = [];
  const send: TelegramSend = async ({ url, body, signal }) => {
    calls.push({ url, body: JSON.parse(body) });
    return answer(calls.length, signal);
  };
  return { send, calls };
}

/** Every console line written while `f` runs. */
async function captureLogs<T>(f: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    return { value: await f(), lines };
  } finally {
    Object.assign(console, orig);
  }
}

const STATS: RoundStats = { roundId: 7, chats: 12, players: 5, outsidePlayers: 5, rightCalls: 7, fooledPlayers: 4, bestFooler: 'Paige', humanChats: 2, coinsMoved: 310 };

// ---------- settings ----------

test('settings: Telegram is off unless both the token and the chat are set; bad values stop the relay with a readable error and never the token', () => {
  assert.equal(telegramFromEnv({}), undefined);
  assert.equal(telegramFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN }), undefined, 'no chat: off');
  assert.equal(telegramFromEnv({ TELEGRAM_CHAT: '@realsieslol' }), undefined, 'no token: off');
  assert.deepEqual(telegramFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT: '@realsieslol' }), SETTINGS, 'defaults: 3 chats by 2 players');
  assert.deepEqual(telegramFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT: '@realsieslol', TELEGRAM_OWN_ACCOUNTS: 'owner.near, second.near' })?.own, ['owner.near', 'second.near'], 'the accounts of the owner');
  assert.deepEqual(telegramFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT: '-1001234567890', TELEGRAM_MIN_CHATS: '5', TELEGRAM_MIN_PLAYERS: '3' }), { ...SETTINGS, chat: '-1001234567890', minChats: 5, minPlayers: 3 });
  const bad = 'not-a-token-' + TOKEN.slice(12);
  assert.throws(() => telegramFromEnv({ TELEGRAM_BOT_TOKEN: bad, TELEGRAM_CHAT: '@realsieslol' }), (e: Error) => /TELEGRAM_BOT_TOKEN does not look like a bot token/.test(e.message) && !e.message.includes(bad));
  assert.throws(() => telegramFromEnv({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT: 'https://t.me/realsieslol' }), /TELEGRAM_CHAT must be a public channel or group as @name/);
  assert.throws(() => telegramFromEnv({ TELEGRAM_MIN_CHATS: '0' }), /TELEGRAM_MIN_CHATS must be a whole number from 1 to 1000 \(got 0\)/);
  assert.throws(() => telegramFromEnv({ TELEGRAM_MIN_PLAYERS: 'two' }), /TELEGRAM_MIN_PLAYERS must be a whole number/);
});

test('settings: TURING_HOUR_UTC as HH:MM and TURING_HOUR_MINUTES (default 60); unset: none; bad values stop the relay', () => {
  assert.equal(turingHourFromEnv({}), undefined);
  assert.deepEqual(turingHourFromEnv({ TURING_HOUR_UTC: '20:00' }), { startUtc: '20:00', minutes: 60 });
  assert.deepEqual(turingHourFromEnv({ TURING_HOUR_UTC: ' 07:30 ', TURING_HOUR_MINUTES: '90' }), { startUtc: '07:30', minutes: 90 });
  for (const v of ['8:00', '24:00', '20:60', '20', '20:00Z', '8pm'])
    assert.throws(() => turingHourFromEnv({ TURING_HOUR_UTC: v }), new RegExp(`TURING_HOUR_UTC must be a UTC time as HH:MM, for example 20:00 \\(got ${v}\\)`));
  for (const v of ['0', '361', '1.5', 'an hour'])
    assert.throws(() => turingHourFromEnv({ TURING_HOUR_UTC: '20:00', TURING_HOUR_MINUTES: v }), /TURING_HOUR_MINUTES must be a whole number of minutes from 1 to 360/);
  assert.throws(() => turingHourFromEnv({ TURING_HOUR_MINUTES: '60' }), /TURING_HOUR_MINUTES needs TURING_HOUR_UTC/);
  // and through loadConfig, the way the relay starts
  process.env.TURING_HOUR_UTC = '25:00';
  try {
    assert.throws(() => loadConfig({ telegram: undefined }), /TURING_HOUR_UTC must be a UTC time/);
    process.env.TURING_HOUR_UTC = '20:00';
    assert.deepEqual(loadConfig({ telegram: undefined }).turingHour, { startUtc: '20:00', minutes: 60 });
  } finally {
    delete process.env.TURING_HOUR_UTC;
  }
  assert.equal('turingHour' in loadConfig({ telegram: undefined }), false, 'unset: no turingHour at all');
});

test('settings: TURING_PRIZE (v1.16), free text of at most 80 characters, only with the hour; unset or empty: no prize', () => {
  const hour = { startUtc: '20:00', minutes: 60 };
  assert.deepEqual(turingHourFromEnv({ TURING_HOUR_UTC: '20:00', TURING_PRIZE: ' 5  NEAR ' }), { ...hour, prize: '5 NEAR' }, 'trimmed, one space between words');
  for (const v of ['', '   ']) assert.deepEqual(turingHourFromEnv({ TURING_HOUR_UTC: '20:00', TURING_PRIZE: v }), hour, `${JSON.stringify(v)}: no prize`);
  assert.equal(turingHourFromEnv({ TURING_HOUR_UTC: '20:00', TURING_PRIZE: '🏆'.repeat(80) })?.prize, '🏆'.repeat(80), '80 characters (counted as characters, not UTF-16 units): fine');
  assert.throws(() => turingHourFromEnv({ TURING_HOUR_UTC: '20:00', TURING_PRIZE: 'x'.repeat(81) }), /TURING_PRIZE must be at most 80 characters \(got 81\)/);
  assert.equal(turingHourFromEnv({ TURING_PRIZE: '5 NEAR' }), undefined, 'without the hour: left out, never a stop (both relays read one env file)');
  // and through loadConfig, the way the relay starts
  process.env.TURING_HOUR_UTC = '20:00';
  process.env.TURING_PRIZE = '5 NEAR';
  try {
    assert.deepEqual(loadConfig({ telegram: undefined }).turingHour, { ...hour, prize: '5 NEAR' });
    process.env.TURING_PRIZE = 'x'.repeat(81);
    assert.throws(() => loadConfig({ telegram: undefined }), /TURING_PRIZE must be at most 80 characters/);
  } finally {
    delete process.env.TURING_HOUR_UTC;
    delete process.env.TURING_PRIZE;
  }
});

test('the hour by the clock: on, soon from 6 hours before, off; the last hour over', () => {
  const t = { startUtc: '20:00', minutes: 60 };
  const day = Date.UTC(2026, 10, 10);
  const start = day + 20 * H;
  assert.deepEqual(turingNow(t, start), { phase: 'on', start, end: start + H });
  assert.deepEqual(turingNow(t, start + H - 1), { phase: 'on', start, end: start + H });
  assert.equal(turingNow(t, start + H)!.phase, 'off', 'over at the end');
  assert.equal(turingNow(t, start + H)!.start, start + 24 * H, 'and the next is tomorrow');
  assert.equal(turingNow(t, start - 6 * H)!.phase, 'soon');
  assert.equal(turingNow(t, start - 6 * H - 1)!.phase, 'off');
  assert.deepEqual(lastTuringHour(t, start + 30 * MIN), { start: start - 24 * H, end: start - 23 * H }, 'during the hour: yesterday\'s is the last one over');
  assert.deepEqual(lastTuringHour(t, start + H + 5 * MIN), { start, end: start + H });
  // an hour across midnight UTC
  const late = { startUtc: '23:30', minutes: 60 };
  assert.deepEqual(turingNow(late, day + 24 * H + 10 * MIN), { phase: 'on', start: day + 23.5 * H, end: day + 24.5 * H });
  assert.equal(turingNow({ startUtc: '20:00', minutes: 0 }, start), null);
  assert.equal(turingNow(undefined, start), null);
});

// ---------- the round's counts and message ----------

function side(o: Partial<ChatSide> & { chatId: string; viewer: string; characterId: string }): ChatSide {
  return {
    convId: o.chatId, roundId: 7, level: 1, seatIndex: 0, theme: 'jungle', skin: {} as ChatSide['skin'], partnerKind: 'bot', requestedMode: 'free', mode: 'free',
    coins: 0, handle: `h-${o.chatId}`, tag: '', phase: 'called', createdAt: 1, startedAt: 2, callStatus: 'ok', playStatus: 'none', messages: [], ...o,
  } as ChatSide;
}
const bot = (id: string, name?: string): CharacterRec => ({ id, roundId: 7, kind: 'bot', ...(name ? { card: { name } } : {}) }) as unknown as CharacterRec;
const human = (id: string, account: string): CharacterRec => ({ id, roundId: 7, kind: 'human', account }) as unknown as CharacterRec;
const COIN = 10n ** 18n;
const play = (handle: string, characterId: string | null, call: boolean | null, coins: number, credited: bigint | null): ChainPlay => ({
  handle, account: 'x', coins, amount: BigInt(coins) * COIN, locked: (BigInt(coins) * COIN * 95n) / 100n, call, characterId, credited,
});

test('a round\'s counts: started chats once each, different players, right calls, players fooled and the best fooler, human chats, coins', () => {
  const chars = [bot('b1', 'Paige'), bot('b2', 'Omar'), bot('b3'), human('h1', 'ana.near'), human('h2', 'ben.near')];
  const sides = [
    side({ chatId: 'c1', viewer: 'ana.near', characterId: 'b1', myCall: true }), // fooled by Paige
    side({ chatId: 'c2', viewer: 'ben.near', characterId: 'b1', myCall: true }), // fooled by Paige
    side({ chatId: 'c3', viewer: 'cleo.near', characterId: 'b2', myCall: true }), // fooled by Omar
    side({ chatId: 'c4', viewer: 'cleo.near', characterId: 'b3', myCall: false }), // right
    // ana and ben with each other: one chat, two sides
    side({ chatId: 'c5', convId: 'v5', viewer: 'ana.near', characterId: 'h2', partnerKind: 'human', partnerAccount: 'ben.near', myCall: true }), // right
    side({ chatId: 'c6', convId: 'v5', viewer: 'ben.near', characterId: 'h1', partnerKind: 'human', partnerAccount: 'ana.near', myCall: false }), // wrong
    // never started, and aborted: not chats
    side({ chatId: 'c7', viewer: 'dex.near', characterId: 'b2', startedAt: undefined, myCall: null }),
    side({ chatId: 'c8', viewer: 'eve.near', characterId: 'b2', aborted: 'bots_unavailable', myCall: true }),
  ];
  const plays = [
    play('h-c1', 'b1', true, 100, 0n), // wrong: 95 locked lost
    play('h-c4', 'b3', false, 50, 60n * COIN), // right
    play('h-c6', 'h1', false, 10, 0n), // wrong: 9.5 lost
    play('h-c9', null, true, 20, 20n * COIN), // unassigned, refunded
  ];
  const st = roundStats(7, sides, chars, plays, COIN);
  assert.deepEqual(st, { roundId: 7, chats: 5, players: 3, outsidePlayers: 3, rightCalls: 2, fooledPlayers: 3, bestFooler: 'Paige', humanChats: 1, coinsMoved: 104 });
  // a tie for the most players fooled: nobody is named; a bot without a card (an AI builder's) never is
  const tie = roundStats(7, sides.filter((s) => s.chatId !== 'c2'), chars, [], COIN);
  assert.equal(tie.bestFooler, undefined);
  assert.equal(roundStats(7, [side({ chatId: 'x', viewer: 'a', characterId: 'b3', myCall: true })], chars, [], COIN).bestFooler, undefined);
});

test('the round\'s message: plain short lines, only the numbers above zero, no player, the game\'s words', () => {
  const full = roundMessage(STATS, SITE, true);
  assert.equal(
    full,
    [
      'Round 7 on Realsies is settled.',
      '12 chats by 5 players. 7 calls were right.',
      'Bots fooled 4 players. Best fooler: Paige.',
      '2 chats were between two real people.',
      '310 coins changed hands.',
      'The next round is open: https://realsies.lol',
    ].join('\n'),
  );
  const thin = roundMessage({ roundId: 8, chats: 3, players: 2, outsidePlayers: 2, rightCalls: 0, fooledPlayers: 0, humanChats: 0, coinsMoved: 0 }, SITE, false);
  assert.equal(thin, ['Round 8 on Realsies is settled.', '3 chats by 2 players.', 'Play at https://realsies.lol'].join('\n'));
  assert.doesNotMatch(thin, /\b0\b/, 'no zero anywhere');
  const one = roundMessage({ roundId: 9, chats: 3, players: 2, outsidePlayers: 2, rightCalls: 1, fooledPlayers: 1, humanChats: 1, coinsMoved: 1 }, SITE, true);
  assert.match(one, /1 call was right\./);
  assert.match(one, /Bots fooled 1 player\.\n/);
  assert.match(one, /1 chat was between two real people\./);
  assert.match(one, /1 coin changed hands\./);
  for (const m of [full, thin, one]) {
    assert.doesNotMatch(m, /\b(bet|bets|stake|odds|wager|pool|market)\b/i);
    assert.doesNotMatch(m, /[*_`<>[\]]|\p{Extended_Pictographic}/u, 'no Markdown, HTML or emoji');
  }
  assert.equal(hourMessage(9, 31, 60), 'Turing Hour is over. 9 players, 31 chats in the last hour. Results come when the round settles.');
  assert.match(hourMessage(9, 31, 90), /in the last 90 minutes\./);
  assert.match(hourMessage(9, 31, 120), /in the last 2 hours\./);
});

// ---------- posting ----------

test('a round posts one message, only above both thresholds, never in test mode, never twice (also after a restart)', async () => {
  const kv = new MemKv();
  const { send, calls } = stubSender();
  const tg = new Telegram(SETTINGS, kv, { testMode: false, siteUrl: SITE, send });
  assert.equal(tg.enabled, true);
  assert.equal(await tg.roundSettled({ ...STATS, chats: 2 }, true), 'quiet', 'two chats: below 3');
  assert.equal(await tg.roundSettled({ ...STATS, players: 1 }, true), 'quiet', 'one player: below 2');
  assert.equal(await tg.roundSettled({ ...STATS, outsidePlayers: 0 }, true), 'quiet', 'only the accounts of the owner played: nothing to tell the channel');
  assert.equal(calls.length, 0);
  assert.equal(await tg.roundSettled(STATS, true), 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(calls[0].body, { chat_id: '@realsieslol', text: roundMessage(STATS, SITE, true), disable_web_page_preview: true });
  assert.equal(await tg.roundSettled(STATS, true), 'done', 'the same round again: nothing');
  const restarted = new Telegram(SETTINGS, kv, { testMode: false, siteUrl: SITE, send });
  assert.equal(await restarted.roundSettled(STATS, true), 'done', 'after a restart: nothing');
  assert.equal(calls.length, 1);

  const test = new Telegram(SETTINGS, new MemKv(), { testMode: true, siteUrl: SITE, send });
  assert.equal(test.enabled, false);
  assert.equal(await test.roundSettled(STATS, true), 'off', 'a test relay never posts');
  assert.equal(await new Telegram(undefined, new MemKv(), { testMode: false, siteUrl: SITE, send }).roundSettled(STATS, true), 'off');
  assert.equal(calls.length, 1);
  assert.match(test.describe({}), /test mode never posts/);
  assert.equal(new Telegram(undefined, kv, { testMode: false, siteUrl: SITE }).describe({ TELEGRAM_BOT_TOKEN: TOKEN }), 'telegram: off (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT are both needed)');
  assert.ok(!tg.describe().includes(TOKEN));
});

test('a failing Telegram: one retry, then a WARN; the token is in no log line; a refusal is the same', async () => {
  const kv = new MemKv();
  // the error a failed fetch might carry, with the URL and so the token in it
  const { send, calls } = stubSender(async () => {
    throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, reason: ECONNRESET`);
  });
  const tg = new Telegram(SETTINGS, kv, { testMode: false, siteUrl: SITE, send, retryDelayMs: 10 });
  const { value, lines } = await captureLogs(() => tg.roundSettled(STATS, true));
  assert.equal(value, 'failed');
  assert.equal(calls.length, 2, 'one try and one retry');
  assert.ok(lines.some((l) => /WARN .*\[telegram\] round 7 not posted to @realsieslol after 2 tries: .*ECONNRESET/.test(l)), lines.join('\n'));
  assert.ok(lines.every((l) => !l.includes(TOKEN) && !l.includes(TOKEN.split(':')[1])), 'no token in the log');
  assert.ok(!kv.m.get('telegram_round:7')!.includes(TOKEN.split(':')[1]), 'nor in the DB');
  assert.equal(await tg.roundSettled(STATS, true), 'done', 'a failed round is not tried again');

  // Telegram answers, but no: 400 with its description
  const refused = stubSender(async () => ({ status: 400, text: '{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}' }));
  const tg2 = new Telegram(SETTINGS, new MemKv(), { testMode: false, siteUrl: SITE, send: refused.send, retryDelayMs: 10 });
  const r2 = await captureLogs(() => tg2.roundSettled(STATS, true));
  assert.equal(r2.value, 'failed');
  assert.ok(r2.lines.some((l) => /HTTP 400: Bad Request: chat not found/.test(l)));
  // a first try that fails and a retry that works: one message
  const flaky = stubSender(async (n) => (n === 1 ? { status: 502, text: 'Bad Gateway' } : { status: 200, text: '{"ok":true}' }));
  assert.equal(await new Telegram(SETTINGS, new MemKv(), { testMode: false, siteUrl: SITE, send: flaky.send, retryDelayMs: 10 }).roundSettled(STATS, true), 'sent');
  assert.equal(flaky.calls.length, 2);
});

test('a slow Telegram: each try gives up after its timeout, also a sender that ignores the abort', async () => {
  let aborted = 0;
  const hang = stubSender(
    (_n, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted++;
          reject(new Error('aborted'));
        });
      }),
  );
  const tg = new Telegram(SETTINGS, new MemKv(), { testMode: false, siteUrl: SITE, send: hang.send, timeoutMs: 150, retryDelayMs: 10 });
  const t0 = Date.now();
  const { value, lines } = await captureLogs(() => tg.roundSettled(STATS, true));
  assert.equal(value, 'failed');
  assert.ok(Date.now() - t0 < 1500, `gave up in ${Date.now() - t0} ms`);
  assert.equal(aborted, 2, 'each try aborted');
  assert.ok(lines.some((l) => /no answer in 0.15 s/.test(l)));
  const deaf = stubSender(() => new Promise(() => {}));
  const t1 = Date.now();
  assert.equal(await new Telegram(SETTINGS, new MemKv(), { testMode: false, siteUrl: SITE, send: deaf.send, timeoutMs: 100, retryDelayMs: 10 }).roundSettled(STATS, true), 'failed');
  assert.ok(Date.now() - t1 < 1500);
});

test('the end of Turing Hour: chats started during it, one message after it ends if enough, one per day, nothing late', async () => {
  const hour = { startUtc: '20:00', minutes: 60 };
  const start = Date.UTC(2026, 10, 10, 20);
  const kv = new MemKv();
  const { send, calls } = stubSender();
  const tg = new Telegram(SETTINGS, kv, { testMode: false, siteUrl: SITE, send, turingHour: hour });
  tg.chatStarted(['early.near'], start - MIN); // before: not counted
  tg.chatStarted(['ana.near'], start + 1 * MIN);
  tg.chatStarted(['ana.near', 'ben.near'], start + 10 * MIN); // ana and ben with each other: one chat
  tg.chatStarted(['cleo.near'], start + 59 * MIN);
  tg.chatStarted(['late.near'], start + 61 * MIN); // after: not counted
  assert.equal(await tg.checkHour(start + 30 * MIN), 'quiet', 'during the hour: yesterday\'s is long past');
  assert.equal(calls.length, 0);
  // a restart during the hour keeps the counts: a new instance on the same DB
  const again = new Telegram(SETTINGS, kv, { testMode: false, siteUrl: SITE, send, turingHour: hour });
  assert.equal(await again.checkHour(start + H + 20_000), 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text, 'Turing Hour is over. 3 players, 3 chats in the last hour. Results come when the round settles.');
  assert.equal(await again.checkHour(start + H + 50_000), 'done', 'one per day');
  assert.equal(calls.length, 1);

  // the next day: too few chats, nothing; and a relay that comes back long after the end says nothing either
  const next = start + 24 * H;
  again.chatStarted(['ana.near'], next + MIN);
  again.chatStarted(['ben.near'], next + 2 * MIN);
  assert.equal(await again.checkHour(next + H + 1000), 'quiet', 'two chats: below 3');
  const day3 = start + 48 * H;
  for (const v of ['a', 'b', 'c']) again.chatStarted([v], day3 + MIN);
  assert.equal(await again.checkHour(day3 + H + 31 * MIN), 'quiet', 'over half an hour late');
  assert.equal(calls.length, 1);
  // off in test mode and without the hour
  const testRelay = new Telegram(SETTINGS, new MemKv(), { testMode: true, siteUrl: SITE, send, turingHour: hour });
  testRelay.chatStarted(['a'], start + MIN);
  assert.equal(await testRelay.checkHour(start + H + 1000), 'off');
  assert.equal(await new Telegram(SETTINGS, new MemKv(), { testMode: false, siteUrl: SITE, send }).checkHour(start + H + 1000), 'off');
});

// ---------- in a real round ----------

test('a slow Telegram does not hold up the round: results come at once, the summary follows in the background with the round\'s real counts', { timeout: 120_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-telegram-'));
  const chain = new MockChain();
  chain.callGraceMs = 1500;
  chain.txLatencyMs = 5;
  const ai = new MockNearAi();
  ai.latencyMs = [20, 80];
  // the first try hangs until its timeout, the retry works
  let resultsAt = 0;
  const tries: { at: number; text: string }[] = [];
  const send: TelegramSend = ({ body, signal }) => {
    tries.push({ at: Date.now(), text: JSON.parse(body).text });
    if (tries.length === 1) return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return Promise.resolve({ status: 200, text: '{"ok":true}' });
  };
  const app = await createApp(
    {
      port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 30, callSeconds: 5, countdownSeconds: 1, botTimeScale: 0.08,
      searchDelay: [0.3, 0.5], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'error', devTraces: true, webDist: path.join(dir, 'no-web'),
      botmastersDir: path.join(dir, 'botmasters'), castSize: 6, telegram: undefined,
    },
    {
      chain, ai,
      // stands in for a mainnet relay's poster (the test relay itself never posts): 2 chats by 2 players are enough
      telegram: (cfg, db) => new Telegram({ ...SETTINGS, minChats: 2, minPlayers: 2 }, db, { testMode: false, siteUrl: 'https://realsies.lol', send, timeoutMs: 2000, retryDelayMs: 10 }),
    },
  );
  const base = `http://localhost:${app.port}`;
  const get = async (p: string) => (await fetch(base + p)).json() as Promise<any>;
  const clients: WsClient[] = [];
  try {
    const accounts = ['ana', 'ben'].map((u) => `${u}.realsies.testnet`);
    for (const a of accounts) clients.push(await WsClient.connect(base, a));
    for (const c of clients) await c.waitT('welcome', 5000);
    for (let i = 0; i < 150; i++) {
      const s = await get('/api/dev/state');
      if (s.round?.ready && (s.characters['human-committed'] ?? 0) >= 2) break;
      await sleep(100);
    }
    const R = (await get('/api/dev/state')).round.roundId;
    // one after the other, so each meets a bot: ana calls hers human (fooled), ben calls his a bot (right)
    for (const [i, c] of clients.entries()) {
      c.send({ t: 'pick_seat', level: 1, seatIndex: i, mode: 'free' });
      const m = (await c.waitT('matched', 10_000)).chat;
      await c.waitChatStart(m.chatId, 10_000);
      c.send({ t: 'dev_end_chat', chatId: m.chatId });
      await c.waitT('chat_ended', 5000, (x) => x.chatId === m.chatId);
      c.send({ t: 'call', chatId: m.chatId, human: i === 0 });
      await c.waitT('call_recorded', 5000, (x) => x.chatId === m.chatId);
    }
    await fetch(`${base}/api/dev/end-round`, { method: 'POST' });
    await clients[0].waitT('results_ready', 60_000, (x) => x.roundId === R);
    resultsAt = Date.now();
    for (let i = 0; i < 100 && tries.length < 2; i++) await sleep(50);
    assert.equal(tries.length, 2, 'one try that hung, one retry');
    assert.ok(resultsAt < tries[1].at, "the results came while the first try still hung");
    assert.equal(
      tries[1].text,
      [`Round ${R} on Realsies is settled.`, '2 chats by 2 players. 1 call was right.', `Bots fooled 1 player. Best fooler: ${tries[1].text.match(/Best fooler: (.+)\./)?.[1]}.`, 'The next round is open: https://realsies.lol'].join('\n'),
    );
    assert.match(tries[1].text, /Best fooler: \S/);
    assert.ok(JSON.parse(app.db.getKv(`telegram_round:${R}`)!).state === 'sent');
    // the round flow went on: a new round is open
    const s = await get('/api/dev/state');
    assert.ok(s.round && s.round.roundId > R, 'a new round');
  } finally {
    for (const c of clients) c.close();
    await app.close();
  }
});

// ---------- the prize in the relay's config (v1.16; an app sets the log level for the whole file: keep it last) ----------

test('PublicConfig.turingHour carries the prize (v1.16), and none without it', { timeout: 60_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-prize-'));
  for (const turingHour of [{ startUtc: '20:00', minutes: 60, prize: '5 NEAR' }, { startUtc: '20:00', minutes: 60 }]) {
    const app = await createApp(
      {
        port: 0, dbPath: path.join(dir, `relay-${'prize' in turingHour ? 'prize' : 'none'}.db`), chain: 'mock', nearAi: 'mock', logLevel: 'error', idleMinutes: 0,
        webDist: path.join(dir, 'no-web'), botmastersDir: path.join(dir, 'botmasters'), telegram: undefined, turingHour,
      },
      { chain: new MockChain() },
    );
    try {
      const cfg = (await (await fetch(`http://localhost:${app.port}/api/config`)).json()) as { turingHour?: unknown };
      assert.deepEqual(cfg.turingHour, turingHour);
    } finally {
      await app.close();
    }
  }
});
