// Round summaries and the end of Turing Hour, posted to the game's Telegram channel (TELEGRAM_BOT_TOKEN and
// TELEGRAM_CHAT). The owner's rule: no spamming, and only when real players played; a summary full of zeros reads as
// a dead game, so a round or an hour below TELEGRAM_MIN_CHATS chats by TELEGRAM_MIN_PLAYERS players posts nothing.
// A relay in test mode never posts. At most one message per round and per day's hour, also across restarts: the
// relay's kv table remembers each one before it is sent. Telegram can never hold up a round: every post runs in the
// background with a 10 s timeout and one retry, then a WARN and on with life. The bot token is in the URL only, and
// is scrubbed from anything that could reach a log line or an error.
import type { ChainPlay } from './chain/types.js';
import type { CharacterRec, ChatSide } from './game/types.js';
import { isRight } from './settlement.js';
import { lastTuringHour, turingNow, type TuringHourSetting } from '../../shared/turing.js';
import { errMsg, unitsToCoins } from './util.js';
import { logger } from './log.js';

const log = logger('telegram');

export interface TelegramSettings {
  /** the bot's token from @BotFather; never logged */
  token: string;
  /** "@realsieslol", or a numeric chat id */
  chat: string;
  /** a round or an hour posts only with at least this many chats ... */
  minChats: number;
  /** ... by at least this many different players */
  minPlayers: number;
}

const TOKEN = /^\d{3,}:[A-Za-z0-9_-]{20,}$/;
const CHAT = /^(@[A-Za-z][A-Za-z0-9_]{3,31}|-?\d{5,20})$/;

function wholeFromEnv(env: NodeJS.ProcessEnv, name: string, def: number): number {
  const v = env[name]?.trim();
  if (!v) return def;
  const n = Number(v);
  if (!(Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error(`${name} must be a whole number from 1 to 1000 (got ${v})`);
  return n;
}

/**
 * TELEGRAM_*: undefined (off) unless both the token and the chat are set. A value that cannot work stops the relay
 * with the reason; the token's own value is never in that reason.
 */
export function telegramFromEnv(env: NodeJS.ProcessEnv): TelegramSettings | undefined {
  const minChats = wholeFromEnv(env, 'TELEGRAM_MIN_CHATS', 3);
  const minPlayers = wholeFromEnv(env, 'TELEGRAM_MIN_PLAYERS', 2);
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chat = env.TELEGRAM_CHAT?.trim();
  if (!token || !chat) return undefined;
  if (!TOKEN.test(token)) throw new Error('TELEGRAM_BOT_TOKEN does not look like a bot token from @BotFather (digits, a colon, then letters and digits)');
  if (!CHAT.test(chat)) throw new Error(`TELEGRAM_CHAT must be a public channel or group as @name, or a numeric chat id (got ${chat})`);
  return { token, chat, minChats, minPlayers };
}

// ---------- what a round did ----------

/** The counts of a settled round that a summary may say: nothing about who played. */
export interface RoundStats {
  roundId: number;
  /** chats that started (a chat between two players counts once) */
  chats: number;
  /** different players in them */
  players: number;
  /** calls that were right */
  rightCalls: number;
  /** different players who called a bot human */
  fooledPlayers: number;
  /** the persona name of the bot that fooled the most players, when one fooled more than any other */
  bestFooler?: string;
  /** chats between two real people */
  humanChats: number;
  /** whole coins of the wrong calls, which went to the right callers, the characters' payouts and the bot fund */
  coinsMoved: number;
}

/** A settled round's counts from the relay's records and the chain's plays (pure). */
export function roundStats(roundId: number, sides: ChatSide[], characters: CharacterRec[], plays: ChainPlay[], coinUnit: bigint): RoundStats {
  // a chat that never started (no bot could talk, or the round closed first) is no chat
  const started = sides.filter((s) => s.startedAt !== undefined && !s.aborted);
  const players = new Set(started.map((s) => s.viewer));
  const rightCalls = started.filter((s) => (s.myCall === true || s.myCall === false) && s.myCall === (s.partnerKind === 'human')).length;
  const fooled = new Set<string>();
  const fooledBy = new Map<string, Set<string>>();
  for (const s of started) {
    if (s.partnerKind !== 'bot' || s.myCall !== true) continue;
    fooled.add(s.viewer);
    let set = fooledBy.get(s.characterId);
    if (!set) fooledBy.set(s.characterId, (set = new Set()));
    set.add(s.viewer);
  }
  // the persona cards are public once the round has settled; a bot without a card (an AI builder's) is not named
  const ranked = [...fooledBy].map(([id, set]) => ({ n: set.size, name: characters.find((c) => c.id === id)?.card?.name })).sort((a, b) => b.n - a.n);
  const top = ranked[0];
  const bestFooler = top && top.name && (ranked.length === 1 || ranked[1].n < top.n) ? top.name : undefined;
  const kind = new Map(characters.map((c) => [c.id, c.kind]));
  let lost = 0n;
  for (const p of plays) {
    const k = p.characterId ? kind.get(p.characterId) : undefined;
    if (k && p.credited !== null && !isRight(k, p.call)) lost += p.locked;
  }
  return {
    roundId,
    chats: new Set(started.map((s) => s.convId)).size,
    players: players.size,
    rightCalls,
    fooledPlayers: fooled.size,
    ...(bestFooler ? { bestFooler } : {}),
    humanChats: new Set(started.filter((s) => s.partnerKind === 'human').map((s) => s.convId)).size,
    coinsMoved: Math.floor(unitsToCoins(lost, coinUnit)),
  };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The round's message: plain text, short lines, only the lines whose number is above zero (pure). */
export function roundMessage(st: RoundStats, siteUrl: string, nextOpen: boolean): string {
  const lines = [`Round ${st.roundId} on Realsies is settled.`];
  lines.push(`${count(st.chats, 'chat', 'chats')} by ${count(st.players, 'player', 'players')}.${st.rightCalls > 0 ? ` ${count(st.rightCalls, 'call was', 'calls were')} right.` : ''}`);
  if (st.fooledPlayers > 0) lines.push(`Bots fooled ${count(st.fooledPlayers, 'player', 'players')}.${st.bestFooler ? ` Best fooler: ${st.bestFooler}.` : ''}`);
  if (st.humanChats > 0) lines.push(`${count(st.humanChats, 'chat was', 'chats were')} between two real people.`);
  if (st.coinsMoved > 0) lines.push(`${count(st.coinsMoved, 'coin', 'coins')} changed hands.`);
  lines.push(nextOpen ? `The next round is open: ${siteUrl}` : `Play at ${siteUrl}`);
  return lines.join('\n');
}

/**
 * The end of Turing Hour (pure). Only what is public at that moment: who was a bot stays secret until the round
 * settles, so nothing here about right or wrong calls.
 */
export function hourMessage(players: number, chats: number, minutes: number): string {
  const span = minutes === 60 ? 'the last hour' : minutes % 60 === 0 ? `the last ${minutes / 60} hours` : `the last ${minutes} minutes`;
  return `Turing Hour is over. ${count(players, 'player', 'players')}, ${count(chats, 'chat', 'chats')} in ${span}. Results come when the round settles.`;
}

// ---------- posting ----------

/** One HTTP POST; the default is fetch. Tests pass a stub: no test ever calls Telegram. */
export type TelegramSend = (req: { url: string; body: string; signal: AbortSignal }) => Promise<{ status: number; text: string }>;

const fetchSend: TelegramSend = async ({ url, body, signal }) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal });
  return { status: r.status, text: await r.text() };
};

/** The relay's kv table (src/db.ts), or a map in tests. */
export interface KvStore {
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
}

export interface TelegramOptions {
  testMode: boolean;
  turingHour?: TuringHourSetting;
  /** the game's address at the end of a round's message */
  siteUrl: string;
  send?: TelegramSend;
  /** per try; one retry after a failed or slow try */
  timeoutMs?: number;
  retryDelayMs?: number;
}

/** What a call did: off, below the thresholds, posted before, posted now, or failed twice. */
export type PostOutcome = 'off' | 'quiet' | 'done' | 'sent' | 'failed';

/** The hour's message is not sent more than this long after its end (a relay that was down at the end stays quiet). */
const HOUR_LATE_MS = 30 * 60_000;
const TALLY = 'telegram_turing_tally';

interface Tally {
  start: number;
  chats: number;
  players: string[];
}

export class Telegram {
  private readonly send: TelegramSend;

  constructor(private readonly s: TelegramSettings | undefined, private readonly kv: KvStore, private readonly o: TelegramOptions) {
    this.send = o.send ?? fetchSend;
  }

  /** On: token and chat set, and not a test relay. */
  get enabled(): boolean {
    return !!this.s && !this.o.testMode;
  }

  /** One line for the start-up log; never the token. */
  describe(env: NodeJS.ProcessEnv = process.env): string {
    if (!this.s) {
      const half = !!env.TELEGRAM_BOT_TOKEN?.trim() !== !!env.TELEGRAM_CHAT?.trim();
      return half ? 'telegram: off (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT are both needed)' : 'telegram: off';
    }
    if (this.o.testMode) return 'telegram: TELEGRAM_* is set, but a relay in test mode never posts';
    return (
      `telegram: round summaries${this.o.turingHour ? ' and the end of Turing Hour' : ''} go to ${this.s.chat} ` +
      `when at least ${this.s.minChats} chats by ${this.s.minPlayers} players`
    );
  }

  private enough(chats: number, players: number): boolean {
    return !!this.s && chats >= this.s.minChats && players >= this.s.minPlayers;
  }

  /** A round settled and its results are stored: one summary, if real players played enough. Never throws. */
  async roundSettled(st: RoundStats, nextOpen: boolean): Promise<PostOutcome> {
    try {
      if (!this.enabled) return 'off';
      if (!this.enough(st.chats, st.players)) {
        log.debug(`round ${st.roundId}: ${st.chats} chats by ${st.players} players, below the threshold; nothing posted`);
        return 'quiet';
      }
      return await this.post(`telegram_round:${st.roundId}`, `round ${st.roundId}`, roundMessage(st, this.o.siteUrl, nextOpen));
    } catch (e) {
      log.warn(`round ${st.roundId}: ${this.scrub(errMsg(e))}`);
      return 'failed';
    }
  }

  /** A chat started (both sides of a chat between two players, or the one player of a bot chat). Counts during the hour. */
  chatStarted(viewers: string[], at = Date.now()): void {
    try {
      if (!this.enabled || !this.o.turingHour) return;
      const w = turingNow(this.o.turingHour, at);
      if (!w || w.phase !== 'on') return;
      const prev = this.tally();
      const t: Tally = prev && prev.start === w.start ? prev : { start: w.start, chats: 0, players: [] };
      t.chats++;
      for (const v of viewers) if (!t.players.includes(v)) t.players.push(v);
      // kept in the DB: a restart during the hour loses no count
      this.kv.setKv(TALLY, JSON.stringify(t));
    } catch (e) {
      log.warn(`Turing Hour count: ${errMsg(e)}`);
    }
  }

  /** Called every half minute: once the day's hour is over, its one message, if enough happened in it. Never throws. */
  async checkHour(now = Date.now()): Promise<PostOutcome> {
    try {
      const th = this.o.turingHour;
      if (!this.enabled || !th) return 'off';
      const h = lastTuringHour(th, now);
      if (!h || now - h.end > HOUR_LATE_MS) return 'quiet';
      const key = `telegram_turing:${new Date(h.start).toISOString().slice(0, 10)}`;
      if (this.kv.getKv(key)) return 'done';
      const t = this.tally();
      const chats = t?.start === h.start ? t.chats : 0;
      const players = t?.start === h.start ? t.players.length : 0;
      if (!this.enough(chats, players)) {
        this.kv.setKv(key, JSON.stringify({ state: 'quiet', at: now, chats, players }));
        log.info(`Turing Hour of ${key.slice(-10)}: ${chats} chats by ${players} players, below the threshold; nothing posted`);
        return 'quiet';
      }
      return await this.post(key, `Turing Hour of ${key.slice(-10)}`, hourMessage(players, chats, th.minutes));
    } catch (e) {
      log.warn(`Turing Hour: ${this.scrub(errMsg(e))}`);
      return 'failed';
    }
  }

  private tally(): Tally | null {
    try {
      const v = this.kv.getKv(TALLY);
      return v ? (JSON.parse(v) as Tally) : null;
    } catch {
      return null;
    }
  }

  /** Remembered before the first try, so a crash or a restart mid-send never posts twice. */
  private async post(key: string, what: string, text: string): Promise<PostOutcome> {
    if (this.kv.getKv(key)) return 'done';
    this.kv.setKv(key, JSON.stringify({ state: 'sending', at: Date.now() }));
    let last = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.sendOnce(text);
        this.kv.setKv(key, JSON.stringify({ state: 'sent', at: Date.now() }));
        log.info(`${what} posted to ${this.s!.chat}`);
        return 'sent';
      } catch (e) {
        last = this.scrub(errMsg(e));
        if (attempt === 1) await new Promise((r) => setTimeout(r, this.o.retryDelayMs ?? 2000));
      }
    }
    this.kv.setKv(key, JSON.stringify({ state: 'failed', at: Date.now(), error: last }));
    log.warn(`${what} not posted to ${this.s!.chat} after 2 tries: ${last}`);
    return 'failed';
  }

  private async sendOnce(text: string): Promise<void> {
    const ms = this.o.timeoutMs ?? 10_000;
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    // the race also covers a sender that ignores the abort
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new Error(`no answer in ${ms / 1000} s`));
      }, ms);
    });
    try {
      const body = JSON.stringify({ chat_id: this.s!.chat, text, disable_web_page_preview: true });
      const r = await Promise.race([this.send({ url: `https://api.telegram.org/bot${this.s!.token}/sendMessage`, body, signal: ac.signal }), late]);
      let j: { ok?: boolean; description?: string } = {};
      try {
        j = JSON.parse(r.text);
      } catch {
        /* not JSON: the status says enough */
      }
      if (r.status !== 200 || j.ok !== true) throw new Error(`HTTP ${r.status}${j.description ? `: ${String(j.description).slice(0, 200)}` : ''}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Any text that may reach a log line, without the token (fetch errors can carry the URL). */
  private scrub(msg: string): string {
    const t = this.s?.token;
    return (t ? msg.split(t).join('<token>') : msg).replace(/bot\d{3,}:[A-Za-z0-9_-]{20,}/g, 'bot<token>');
  }
}
