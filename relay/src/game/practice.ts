// The practice chat (protocol v1.14): one free try for a visitor without a wallet, so anyone can feel the game in two
// minutes before a sign-in. Visitors from a link left at the wallet; this lets them play first.
//
// The partner is always one of the house bots, run by the same bot engine as in a round (the same enclave models,
// signatures, typing rhythm, countdown, two minutes and call), but it is never a character of the running round: a
// hand-written persona that is not in this round's cast, or, when every one of them is, a person generated for this
// chat alone. The guest tapped a character of the room to start, and the partner wears that look, but nothing of the
// round reaches the guest: no round id, no skin the relay drew, no character, no attestation. No coins, no rating, no
// leaderboard row, nothing on chain, no round record: the chat lives in its own table (practice_chats), flagged as
// practice, and nothing serves it. Right after the call (or when the call window closes) comes the reveal: always a bot,
// with its persona card, the same card a round shows after it settles.
//
// The partner meets the visitor in their language: the browser's Accept-Language on POST /api/practice (every browser
// sends it, fetch included) names the visitor's first language, and when that is not English the partner is a free
// house persona who speaks it natively, else a person generated for this chat from a country where it is the first
// language, else a free house persona who speaks it fluently or well; English, an unknown language or no header: any
// free house persona, as before. Nothing changes once the chat runs: no swapping partners mid-chat (that would give it
// away), and a persona still reads only its own languages (src/persona/languages.ts).
//
// GUEST_CHATS_PER_DAY tries a day per device (an id the browser keeps; 0 = off) and GUEST_CHATS_PER_IP per IP for every
// device behind it together (default 4 times as many: many phones share one carrier address), whichever is reached
// first, and a cap a day for every guest together (GUEST_CHATS_DAILY_CAP) so NEAR AI credits stay safe. None while the
// bots are out of credits or the beta is closed. The try counts from the moment it is reserved (POST /api/practice),
// so asking for many tickets gets nothing more; a chat that could not start gives it back. The guest's id is random,
// issued here, bound to the IP that asked, and the socket takes a one-time ticket, like a wallet session's.
import crypto from 'node:crypto';
import { LEVELS, type ChatInfo, type ChatMessage, type ClientMsg, type Level, type PracticeRefusal, type PracticeResult, type PracticeStatus, type PracticeTicket, type ServerMsg, type Skin } from '../../../shared/protocol.js';
import { gamertag } from '../../../shared/names.js';
import { BETA_CLOSED, BOTS_UNAVAILABLE, GameError, type Conn, type Game } from './game.js';
import type { ChatSide } from './types.js';
import { BotSession, type BotHost, type StoredMsg } from '../bot/session.js';
import { defaultBrain } from '../bot/brain.js';
import { atRound, fromGenerated, ownerOf, type Persona } from '../personas.js';
import { generatePersona } from '../persona/generate.js';
import { COUNTRY_WEIGHTS, CULTURES, PLACES } from '../persona/data.js';
import { codeOfLanguage, LANGUAGE_NAMES } from '../persona/languages.js';
import type { LangLevel } from '../bot/api.js';
import { chatCostUsd } from '../models.js';
import { chatTag, skinMessage } from '../formats.js';
import { randomHex } from '../crypto.js';
import { errMsg, jsonStringify, pick, randomId, utcDay } from '../util.js';
import { logger } from '../log.js';

const log = logger('practice');

const MAX_SAY = 280;
const SAY_INTERVAL_MS = 600;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const SEED = /^[0-9a-f]{64}$/;
const TICKET_MS = 30_000;
/** a finished practice stays this long after its reveal: a socket that dropped just before still gets it */
const KEEP_MS = 10 * 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS practice_chats (
  chat_id TEXT PRIMARY KEY, day TEXT NOT NULL, device TEXT NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL,
  status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS practice_chats_day ON practice_chats(day);
`;

/** issued: reserved, the try counts; chatting: the chat (or its call) runs; done: revealed; aborted: never started, the try is given back */
type RunStatus = 'issued' | 'chatting' | 'done' | 'aborted';

/** One guest's practice, in memory while it runs (and KEEP_MS after). */
export interface PracticeRun {
  /** sha256 of the guest's token: never the token itself */
  id: string;
  chatId: string;
  /** the IP that reserved it: tickets work from there only */
  ip: string;
  /** a keyed hash of that IP, what the table keeps and counts by */
  ipKey: string;
  device: string;
  day: string;
  seed: string;
  level: Level;
  /** the visitor's first language from Accept-Language (an ISO 639 code), when the browser said */
  lang?: string;
  createdAt: number;
  status: RunStatus;
  side?: ChatSide;
  persona?: Persona;
  bot?: BotSession;
  conns: Set<Conn>;
  endTimer?: NodeJS.Timeout;
  missTimer?: NodeJS.Timeout;
  forgetTimer?: NodeJS.Timeout;
  lastSay: number;
  result?: PracticeResult;
}

/** A refusal as the HTTP error a client reads the code of. */
const REFUSED: Record<PracticeRefusal, { status: number; message: string }> = {
  practice_used: { status: 429, message: 'This device or this network had its free chat today. Sign in to play the rounds.' },
  practice_cap: { status: 429, message: 'The free chats for today are all gone. Sign in to play the rounds.' },
  practice_off: { status: 404, message: 'There are no free chats on this relay.' },
  bots_unavailable: { status: 503, message: BOTS_UNAVAILABLE },
  beta_closed: { status: 403, message: BETA_CLOSED },
};

const sha256hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** Old and alternative primary tags browsers still send, as the codes of src/persona/languages.ts. */
const TAG_ALIASES: Record<string, string> = { in: 'id', iw: 'he', nb: 'no', nn: 'no', fil: 'tl', cmn: 'zh', zsm: 'ms' };

/**
 * The visitor's languages from an Accept-Language header, most preferred first, as ISO 639 codes a persona may list
 * ("pt-BR,pt;q=0.9,en-US;q=0.8" -> ["pt", "en"]); unknown tags, "*" and q=0 are left out, a missing header is [].
 */
export function visitorLanguages(header: unknown): string[] {
  if (typeof header !== 'string') return [];
  const seen: { code: string; q: number; i: number }[] = [];
  header.slice(0, 512).split(',').slice(0, 24).forEach((part, i) => {
    const [tag, ...params] = part.split(';');
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    const code = Object.hasOwn(TAG_ALIASES, primary) ? TAG_ALIASES[primary] : primary;
    let q = 1;
    for (const x of params) {
      const m = /^\s*q\s*=\s*([01](?:\.\d{0,3})?)\s*$/i.exec(x);
      if (m) q = Number(m[1]);
    }
    if (q > 0 && Object.hasOwn(LANGUAGE_NAMES, code)) seen.push({ code, q, i });
  });
  seen.sort((a, b) => b.q - a.q || a.i - b.i);
  return [...new Set(seen.map((x) => x.code))];
}

/** The countries (COUNTRY_WEIGHTS keys, with their weights) where the generator's people have `code` as their first language. */
const speakersOf = new Map<string, [string, number][]>();
function countriesSpeaking(code: string): [string, number][] {
  let out = speakersOf.get(code);
  if (!out) {
    const m = new Map<string, number>();
    for (const pl of PLACES) {
      const c = CULTURES[pl.culture];
      if (!c || c.native || !COUNTRY_WEIGHTS[pl.country]) continue;
      if (codeOfLanguage(pl.language ?? c.language) === code) m.set(pl.country, COUNTRY_WEIGHTS[pl.country]);
    }
    out = [...m];
    speakersOf.set(code, out);
  }
  return out;
}

function weightedPick<T>(xs: readonly [T, number][]): T {
  let r = Math.random() * xs.reduce((a, [, w]) => a + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[xs.length - 1][0];
}

export class Practice implements BotHost {
  private runs = new Map<string, PracticeRun>();
  /** chat id -> run, for the bot engine's callbacks */
  private byChat = new Map<string, PracticeRun>();
  private tickets = new Map<string, { runId: string; expiresAt: number }>();
  private stopped = false;

  constructor(private game: Game) {
    game.db.sql.exec(SCHEMA);
    log.info(
      this.on
        ? `practice chats for guests: ${game.cfg.guestChatsPerDay} a day per device, ${this.perIp} a day per IP, ${game.cfg.guestChatsDailyCap} a day in all (GUEST_CHATS_PER_DAY, GUEST_CHATS_PER_IP, GUEST_CHATS_DAILY_CAP)`
        : 'practice chats for guests: off (GUEST_CHATS_PER_DAY or GUEST_CHATS_DAILY_CAP is 0)',
    );
  }

  // ---------- BotHost: the bot engine runs here exactly as in a round ----------

  get ai() {
    return this.game.ai;
  }
  get db() {
    return this.game.db;
  }
  get botTimeScale(): number {
    return this.game.botTimeScale;
  }
  isChatting(side: ChatSide): boolean {
    return side.phase === 'chatting' && !this.stopped;
  }
  botSay(side: ChatSide, text: string, completionIndex: number): boolean {
    const run = this.byChat.get(side.chatId);
    if (!run || side.phase !== 'chatting' || this.stopped) return false;
    this.append(run, { id: randomId(6), from: 'them', text, at: Date.now(), ci: completionIndex });
    return true;
  }
  botTyping(side: ChatSide, on: boolean): void {
    const run = this.byChat.get(side.chatId);
    if (!run || (side.phase !== 'chatting' && on)) return;
    this.send(run, { t: 'typing', chatId: side.chatId, on });
  }

  // ---------- limits ----------

  get on(): boolean {
    return this.game.cfg.guestChatsPerDay > 0 && this.game.cfg.guestChatsDailyCap > 0;
  }

  /** Tries a day from one IP, every device behind it together (GUEST_CHATS_PER_IP; 0: 4 times the device's). */
  get perIp(): number {
    return this.game.cfg.guestChatsPerIp || 4 * this.game.cfg.guestChatsPerDay;
  }

  /** The IP as the table keeps it: keyed with the relay's skin secret, so the database holds no address. */
  private ipKey(ip: string): string {
    return crypto.createHmac('sha256', this.game.skinSecret || 'realsies').update(`practice|${ip}`).digest('hex').slice(0, 32);
  }

  /** Tries counted today (reserved, running or done; one that never started is given back). */
  private count(day: string, by?: { device: string } | { ip: string }): number {
    const sql = this.game.db.sql;
    const q = "SELECT COUNT(*) AS n FROM practice_chats WHERE day = ? AND status != 'aborted'";
    const r = !by
      ? sql.prepare(q).get(day)
      : 'device' in by
        ? sql.prepare(`${q} AND device = ?`).get(day, by.device)
        : sql.prepare(`${q} AND ip = ?`).get(day, by.ip);
    return Number((r as { n: number } | undefined)?.n ?? 0);
  }

  /** Why a guest may not start one now, or null. Their own try first: "used" says more than "all gone". */
  private refusal(device: string, ipKey: string): PracticeRefusal | null {
    if (!this.on) return 'practice_off';
    if (this.game.betaClosed()) return 'beta_closed';
    if (!this.game.credits.usable('house')) return 'bots_unavailable';
    const day = utcDay();
    if (this.count(day, { device }) >= this.game.cfg.guestChatsPerDay || this.count(day, { ip: ipKey }) >= this.perIp) return 'practice_used';
    if (this.count(day) >= this.game.cfg.guestChatsDailyCap) return 'practice_cap';
    return null;
  }

  private device(v: unknown): string {
    if (typeof v !== 'string' || !DEVICE.test(v)) throw new GameError('invalid_request', 'device must be 16 to 64 of A-Z a-z 0-9 _ -', 400);
    return v;
  }

  /** GET /api/practice?device=: may this browser have its free chat now. */
  status(device: unknown, ip: string): PracticeStatus {
    const why = this.refusal(this.device(device), this.ipKey(ip));
    return why ? { ok: false, reason: why } : { ok: true };
  }

  /**
   * POST /api/practice: {device, seed, level} reserves a practice (the try counts from here) and returns its id and a
   * ticket; {guest} gets a new ticket for the same practice, from the IP that reserved it (a socket that dropped).
   */
  start(body: unknown, ip: string, acceptLanguage?: unknown): PracticeTicket {
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.guest !== undefined) return this.again(b.guest, ip);
    const device = this.device(b.device);
    if (typeof b.seed !== 'string' || !SEED.test(b.seed)) throw new GameError('invalid_request', 'seed must be 64 lowercase hex characters', 400);
    if (!LEVELS.includes(b.level as Level)) throw new GameError('invalid_request', 'level must be 1, 2 or 3', 400);
    const ipKey = this.ipKey(ip);
    const why = this.refusal(device, ipKey);
    if (why) throw new GameError(why, REFUSED[why].message, REFUSED[why].status);
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const run: PracticeRun = {
      id: sha256hex(token), chatId: randomId(10), ip, ipKey, device, day: utcDay(now), seed: b.seed, level: b.level as Level,
      lang: visitorLanguages(acceptLanguage)[0], createdAt: now, status: 'issued', conns: new Set(), lastSay: 0,
    };
    this.runs.set(run.id, run);
    this.byChat.set(run.chatId, run);
    this.save(run);
    // a reserved practice nobody connects to is forgotten after a while; the try stays counted
    run.forgetTimer = setTimeout(() => run.status === 'issued' && this.forget(run), KEEP_MS);
    run.forgetTimer.unref?.();
    log.info(`practice ${run.chatId} reserved (${this.count(run.day)} of ${this.game.cfg.guestChatsDailyCap} today)`);
    return { guest: token, ...this.ticketFor(run) };
  }

  private again(token: unknown, ip: string): PracticeTicket {
    const run = typeof token === 'string' && token.length <= 100 ? this.runs.get(sha256hex(token)) : undefined;
    if (!run || run.ip !== ip || run.status === 'aborted') throw new GameError('practice_over', 'That free chat is over. Sign in to play the rounds.', 404);
    return { guest: token as string, ...this.ticketFor(run) };
  }

  private ticketFor(run: PracticeRun): { ticket: string; expiresAt: number } {
    const now = Date.now();
    if (this.tickets.size > 10_000) for (const [k, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(k);
    const ticket = crypto.randomBytes(24).toString('base64url');
    const expiresAt = now + TICKET_MS;
    this.tickets.set(ticket, { runId: run.id, expiresAt });
    return { ticket, expiresAt };
  }

  /** A socket's ticket, once: its practice, or null (unknown, used, expired, another IP, or over). */
  redeem(ticket: string | null | undefined, ip: string): PracticeRun | null {
    if (!ticket || this.stopped) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    if (t.expiresAt <= Date.now()) return null;
    const run = this.runs.get(t.runId);
    if (!run || run.ip !== ip || run.status === 'aborted') return null;
    return run;
  }

  // ---------- the guest's socket ----------

  /** The first socket starts the chat; a later one (a reconnect) gets it replayed. */
  connect(conn: Conn, run: PracticeRun): void {
    run.conns.add(conn);
    if (run.status === 'issued') this.begin(run);
    else this.replay(run, conn);
  }

  /** The bot chat runs on without the socket, as in a round; the guest may come back with a new ticket. */
  disconnect(conn: Conn, run: PracticeRun): void {
    run.conns.delete(conn);
  }

  /** A guest may chat and call, nothing else: no picks, no rooms, nothing of the round. */
  onMessage(conn: Conn, run: PracticeRun, raw: unknown): void {
    const msg = raw as ClientMsg;
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') {
      conn.send({ t: 'error', code: 'bad_message', message: 'expected a JSON object with t' });
      return;
    }
    try {
      switch (msg.t) {
        case 'ping':
          conn.send({ t: 'pong' });
          return;
        case 'say':
          this.say(run, msg.chatId, msg.text);
          return;
        case 'typing':
          this.typing(run, msg.chatId, !!msg.on);
          return;
        case 'call':
          this.call(run, msg.chatId, msg.human);
          return;
        default:
          throw new GameError('not_in_practice', 'A free chat takes messages and one call, nothing else. Sign in to play the rounds.', 403);
      }
    } catch (e) {
      if (e instanceof GameError) conn.send({ t: 'error', code: e.code, message: e.message });
      else {
        log.error(`practice ${run.chatId}: ${msg.t}`, e);
        conn.send({ t: 'error', code: 'internal', message: errMsg(e) });
      }
    }
  }

  private send(run: PracticeRun, msg: ServerMsg): void {
    for (const c of run.conns) {
      try {
        c.send(msg);
      } catch (e) {
        log.debug(`practice ${run.chatId}: send failed: ${errMsg(e)}`);
      }
    }
  }

  // ---------- the chat ----------

  /**
   * A house persona that is not in this round's cast, on the cheapest model, as a free chat in a round gets; when
   * every one of them plays in this round, a person generated for this chat alone, so the reveal never names a
   * character of the running round. AI builders' personas never play here.
   *
   * `lang`, the visitor's first language: when it is not English, someone who speaks it, at random among the best
   * there are: a free house persona who speaks it natively, else a person generated for this chat from a country where
   * it is the first language, else a free house persona who speaks it fluently, then well. Nobody: as above.
   */
  pickPersona(level: Level, at: number, lang?: string): Persona {
    const house = this.game.personas.filter((p) => p.brain.kind === 'default' && !!p.person && !ownerOf(p));
    const r = this.game.current;
    const playing = new Set<string>();
    for (const c of r ? this.game.chars.get(r.id)?.values() ?? [] : []) if (c.kind === 'bot' && c.personaId) playing.add(c.personaId);
    const free = house.filter((p) => !playing.has(p.id));
    const cheapest = (ps: Persona[]): Persona => {
      const min = Math.min(...ps.map((p) => chatCostUsd(p.model)));
      return atRound(pick(ps.filter((p) => chatCostUsd(p.model) === min)), at);
    };
    if (lang && lang !== 'en') {
      const speaking = (lv: LangLevel) => free.filter((p) => p.languages?.[lang] === lv);
      const native = speaking('native');
      if (native.length) return cheapest(native);
      const generated = this.generatedSpeaker(lang, level, at);
      if (generated) return generated;
      for (const lv of ['fluent', 'good'] as const) {
        const xs = speaking(lv);
        if (xs.length) return cheapest(xs);
      }
    }
    if (free.length) return cheapest(free);
    return fromGenerated(generatePersona(randomHex(16), 0, { at }), level, at);
  }

  /** A person generated for this chat whose first language is `lang`; undefined when no country of the generator has it. */
  private generatedSpeaker(lang: string, level: Level, at: number): Persona | undefined {
    const countries = countriesSpeaking(lang);
    if (!countries.length) return undefined;
    // a country may have places with another first language (Belgium, India): a few draws until one fits
    for (let i = 0; i < 12; i++) {
      const g = generatePersona(randomHex(16), 0, { at, country: weightedPick(countries) });
      if (g.person.languages[lang] === 'native') return fromGenerated(g, level, at);
    }
    return undefined;
  }

  /** The look the guest tapped and the theme of that level in the room (public, as GET /api/round has it). */
  private chatInfo(s: ChatSide): ChatInfo {
    return { chatId: s.chatId, roundId: 0, level: s.level, seatIndex: 0, theme: s.theme, partner: s.skin, mode: 'free', coins: 0, startedAt: s.startedAt, endsAt: s.endsAt };
  }

  private begin(run: PracticeRun): void {
    // the bots ran out of credits, or the beta closed, since the ticket: no chat, and the try is given back
    const why: PracticeRefusal | null = this.game.betaClosed() ? 'beta_closed' : !this.game.credits.usable('house') ? 'bots_unavailable' : null;
    if (why) {
      run.status = 'aborted';
      this.save(run);
      this.send(run, { t: 'error', code: why, message: REFUSED[why].message });
      log.info(`practice ${run.chatId} did not start: ${why}; the try is given back`);
      this.forget(run);
      return;
    }
    const now = Date.now();
    const cfg = this.game.cfg;
    const persona = this.pickPersona(run.level, now, run.lang);
    const handle = randomHex(32);
    const tag = chatTag(handle);
    const skin: Skin = { seed: run.seed, name: gamertag(run.seed) };
    const startedAt = now + Math.round(cfg.countdownSeconds * 1000);
    const endsAt = startedAt + cfg.chatSeconds * 1000;
    const side: ChatSide = {
      chatId: run.chatId, convId: run.chatId, roundId: 0, viewer: `practice:${run.id.slice(0, 12)}`, level: run.level, seatIndex: 0,
      theme: this.game.roundState().themes[run.level], skin, characterId: 'practice', partnerKind: 'bot', personaId: persona.id, model: persona.model,
      requestedMode: 'free', mode: 'free', coins: 0, handle, tag, skinMessage: skinMessage(skin.name, tag), phase: 'chatting', createdAt: now,
      startedAt, endsAt, callStatus: 'none', playStatus: 'none', messages: [],
    };
    if (run.forgetTimer) clearTimeout(run.forgetTimer);
    run.forgetTimer = undefined;
    run.side = side;
    run.persona = persona;
    run.status = 'chatting';
    this.save(run);
    // the same countdown, the same two minutes as any chat: the bot's clock starts at startedAt
    this.send(run, { t: 'matched', chat: this.chatInfo(side) });
    this.send(run, { t: 'chat_started', chatId: side.chatId, startedAt, endsAt });
    run.endTimer = setTimeout(() => this.endChat(run), endsAt - now);
    run.bot = new BotSession(this, side, persona, side.skinMessage!, [], { brain: { kind: 'default', brain: defaultBrain({ seed: `${side.chatId}|${randomId(8)}` }) } });
    run.bot.start();
    log.info(`practice ${run.chatId}: a guest${run.lang ? ` (${run.lang})` : ''} with house bot ${persona.id} (${persona.model})`);
  }

  /** A socket that came back: the chat so far, then where it stands. */
  private replay(run: PracticeRun, conn: Conn): void {
    const s = run.side;
    if (!s) return;
    conn.send({ t: 'matched', chat: this.chatInfo(s) });
    conn.send({ t: 'chat_started', chatId: s.chatId, startedAt: s.startedAt!, endsAt: s.endsAt! });
    for (const m of s.messages as StoredMsg[]) conn.send({ t: 'message', chatId: s.chatId, msg: { id: m.id, from: m.from, text: m.text, at: m.at } });
    if (s.phase !== 'chatting') conn.send({ t: 'chat_ended', chatId: s.chatId, callDeadline: s.callDeadline ?? Date.now(), reason: 'time' });
    if (s.phase === 'called') conn.send({ t: 'call_recorded', chatId: s.chatId, human: !!s.myCall });
    if (s.phase === 'missed') conn.send({ t: 'call_missed', chatId: s.chatId });
    if (run.result) conn.send({ t: 'practice_result', result: run.result });
  }

  private sideOf(run: PracticeRun, chatId: unknown): ChatSide {
    const s = run.side;
    if (!s || chatId !== s.chatId) throw new GameError('unknown_chat', 'no such chat');
    return s;
  }

  private append(run: PracticeRun, m: StoredMsg): void {
    const s = run.side!;
    s.messages.push(m);
    this.save(run);
    this.send(run, { t: 'message', chatId: s.chatId, msg: { id: m.id, from: m.from, text: m.text, at: m.at } as ChatMessage });
  }

  private say(run: PracticeRun, chatId: unknown, text: unknown): void {
    const s = this.sideOf(run, chatId);
    if (s.phase !== 'chatting') throw new GameError('chat_not_active', 'the chat is not running');
    if (s.startedAt !== undefined && Date.now() < s.startedAt) throw new GameError('chat_not_started', 'the chat starts when the countdown ends');
    const t = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
    if (!t) throw new GameError('empty_message', 'message is empty');
    if (t.length > MAX_SAY) throw new GameError('message_too_long', `max ${MAX_SAY} characters`);
    const now = Date.now();
    if (now - run.lastSay < SAY_INTERVAL_MS) throw new GameError('rate_limited', 'slow down: one message per 600 ms');
    run.lastSay = now;
    const id = randomId(6);
    this.append(run, { id, from: 'me', text: t, at: now });
    run.bot?.onPlayerMessage({ id, text: t });
  }

  private typing(run: PracticeRun, chatId: unknown, on: boolean): void {
    const s = this.sideOf(run, chatId);
    if (s.phase !== 'chatting' || (s.startedAt !== undefined && Date.now() < s.startedAt)) return;
    run.bot?.onPlayerTyping(on);
  }

  private endChat(run: PracticeRun): void {
    const s = run.side;
    if (!s || s.phase !== 'chatting') return;
    // a bot reply that has started to appear is shown in full first, as in a round
    run.bot?.flush();
    const now = Date.now();
    const windowMs = this.game.cfg.callSeconds * 1000;
    s.phase = 'calling';
    s.endedAt = now;
    s.endReason = 'time';
    s.callDeadline = now + windowMs;
    this.save(run);
    this.send(run, { t: 'typing', chatId: s.chatId, on: false });
    this.send(run, { t: 'chat_ended', chatId: s.chatId, callDeadline: s.callDeadline, reason: 'time' });
    run.bot?.stop(false);
    run.missTimer = setTimeout(() => this.missed(run), windowMs + 750);
  }

  private call(run: PracticeRun, chatId: unknown, human: unknown): void {
    const s = this.sideOf(run, chatId);
    if (typeof human !== 'boolean') throw new GameError('bad_call', 'human must be true or false');
    if (s.phase === 'called') throw new GameError('already_called', 'you already called this chat');
    if (s.phase !== 'calling') throw new GameError('not_calling', 'calls open when the chat ends');
    if (Date.now() > (s.callDeadline ?? 0) + 1500) {
      this.missed(run);
      throw new GameError('call_closed', 'too late to call');
    }
    if (run.missTimer) clearTimeout(run.missTimer);
    run.missTimer = undefined;
    s.myCall = human;
    s.callAt = Date.now();
    s.phase = 'called';
    s.callStatus = 'stored';
    this.send(run, { t: 'call_recorded', chatId: s.chatId, human });
    this.reveal(run);
  }

  private missed(run: PracticeRun): void {
    const s = run.side;
    if (!s || s.phase !== 'calling') return;
    if (run.missTimer) clearTimeout(run.missTimer);
    run.missTimer = undefined;
    s.phase = 'missed';
    s.myCall = null;
    this.send(run, { t: 'call_missed', chatId: s.chatId });
    this.reveal(run);
  }

  /** At once, no settlement to wait for: it was a bot, who it was playing, and whether the call was right. */
  private reveal(run: PracticeRun): void {
    const s = run.side!;
    const p = run.persona!;
    const called = s.phase === 'called' && typeof s.myCall === 'boolean';
    run.result = {
      chatId: s.chatId, truth: 'bot', myCall: called ? (s.myCall as boolean) : null, right: called ? s.myCall === false : null, model: p.model,
      ...(p.card ? { persona: { ...p.card } } : {}),
    };
    run.status = 'done';
    this.save(run);
    this.send(run, { t: 'practice_result', result: run.result });
    log.info(`practice ${run.chatId}: ${!called ? 'no call' : run.result.right ? 'the guest spotted the bot' : 'the bot fooled the guest'}`);
    run.forgetTimer = setTimeout(() => this.forget(run), KEEP_MS);
    run.forgetTimer.unref?.();
  }

  private forget(run: PracticeRun): void {
    for (const t of [run.endTimer, run.missTimer, run.forgetTimer]) if (t) clearTimeout(t);
    run.bot?.stop(false);
    this.runs.delete(run.id);
    this.byChat.delete(run.chatId);
    for (const [k, t] of this.tickets) if (t.runId === run.id) this.tickets.delete(k);
    for (const c of [...run.conns]) c.close(1000, 'practice over');
    run.conns.clear();
  }

  /** The row: flagged as practice, the IP only as its keyed hash, the transcript with it. */
  private save(run: PracticeRun): void {
    const s = run.side;
    const doc = {
      practice: true, chatId: run.chatId, status: run.status, device: run.device, level: run.level, seed: run.seed, createdAt: run.createdAt,
      ...(run.lang ? { lang: run.lang } : {}),
      ...(run.persona ? { personaId: run.persona.id, model: run.persona.model, card: run.persona.card } : {}),
      ...(s
        ? {
            phase: s.phase, startedAt: s.startedAt, endsAt: s.endsAt, callDeadline: s.callDeadline, myCall: s.myCall, callAt: s.callAt,
            messages: (s.messages as StoredMsg[]).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, ...(m.ci !== undefined ? { ci: m.ci } : {}) })),
          }
        : {}),
      ...(run.result ? { result: run.result } : {}),
    };
    try {
      this.game.db.sql
        .prepare(
          `INSERT INTO practice_chats (chat_id, day, device, ip, created_at, status, data) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET status = excluded.status, data = excluded.data`,
        )
        .run(run.chatId, run.day, run.device, run.ipKey, run.createdAt, run.status, jsonStringify(doc));
    } catch (e) {
      log.warn(`practice ${run.chatId} not stored: ${errMsg(e)}`);
    }
  }

  /** The relay stops: every practice ends where it is (its row says how far it got). */
  stop(): void {
    this.stopped = true;
    for (const run of [...this.runs.values()]) {
      for (const t of [run.endTimer, run.missTimer, run.forgetTimer]) if (t) clearTimeout(t);
      run.bot?.stop(false);
      for (const c of [...run.conns]) c.close(1001, 'server stopping');
    }
    this.runs.clear();
    this.byChat.clear();
    this.tickets.clear();
  }

  /** Tests and the operator: how many practices are in memory, and today's count. */
  stats(): { running: number; today: number } {
    return { running: [...this.runs.values()].filter((r) => r.status === 'chatting').length, today: this.count(utcDay()) };
  }
}
