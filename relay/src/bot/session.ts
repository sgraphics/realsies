// One bot side of a chat: runs a brain (default or remote) over the chat's event stream and executes
// its actions under the relay's limits (src/bot/api.ts LIMITS, docs/bot-api.md).
//
// The chat, and the brain's clock, start at the side's startedAt, after the countdown both players see:
// start() arms the session when the chat is announced and the brain hears chat_started only then.
//
// A `say` starts the typing indicator at once and sends one NEAR AI request: message 0 the committed
// persona prompt, message 1 the skin message with the chat tag, the signed history so far, the
// player's lines not yet in any request, and one fixed steering message for the intent. Each player line
// reaches the brain with its language when the relay is sure it is not English (player_message.lang). The reply
// appears when a person who started typing then would have finished it (src/bot/typing.ts), never
// before its enclave signature verifies. The history is kept in generation order: a kept say adds
// [its new player lines, its steering message, its reply], so every request is the previous request
// + the previous reply + new player lines + one steering message. A say dropped before any of it is
// shown (cancelled, failed, too late) adds nothing; its exact bytes go to the drafts table instead.
// Once a bubble of a say is shown the rest are shown too (flush() before the chat ends), so the signed
// record and the player's screen always agree. A paid chat whose last player lines are not in a kept
// request gets one more completion that is not shown (the seal), so the on-chain proof carries them.
import { Subject, type Subscription } from 'rxjs';
import type { ChatMessage } from '../../../shared/protocol.js';
import type { CompletionRow } from '../db.js';
import type { CompletionResult, NearAi } from '../nearai/client.js';
import { bubblesOf, checkSignature, cleanContent, type SignatureCheck } from '../nearai/verify.js';
import { buildRequest, type ChatTurn } from '../models.js';
import type { Persona } from '../personas.js';
import type { ChatSide } from '../game/types.js';
import type { SignaturePayload } from '../../../shared/protocol.js';
import { LIMITS, kindOf, type IntentKind, type Brain, type BrainAction, type BrainEvent, type DropReason, type PersonaCard, type SayIntent, type TypingMeta } from './api.js';
import { normalizeIntent, parseSayIntent, steeringId, steeringText } from './intents.js';
import { defaultBrain } from './brain.js';
import { detectLanguage } from './language.js';
import { realClock, sleepOn, type Clock } from './clock.js';
import { createRng, lerp, uniformR, type Rng } from './rng.js';
import { clampCps, planBubbles, type BubbleSlot } from './typing.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('bot');

/** A side message plus the index of the completion it came from (bot bubbles only). */
export type StoredMsg = ChatMessage & { ci?: number };

export interface DraftRow {
  chatId: string;
  sayId: number;
  at: number;
  steering: string;
  request: string;
  response: string;
  completionId: string | null;
  signature: string | null;
  verify: string | null;
  reason: string;
}

export interface TraceEntry {
  /** brain ms since the chat started */
  t: number;
  k: 'event' | 'action' | 'rejected' | 'say' | 'brain';
  d: unknown;
}

export interface BotStore {
  saveCompletion(row: CompletionRow): void;
  loadCompletions(chatId: string): CompletionRow[];
  saveDraft?(row: DraftRow): void;
  saveTrace?(chatId: string, trace: unknown): void;
}

export interface BotHost {
  readonly ai: NearAi;
  readonly db: BotStore;
  readonly botTimeScale: number;
  /** The chat is still in its chatting phase. */
  isChatting(side: ChatSide): boolean;
  /** Show one bubble; false if it could not be shown (chat over). */
  botSay(side: ChatSide, text: string, completionIndex: number): boolean;
  botTyping(side: ChatSide, on: boolean): void;
}

export interface BrainChoice {
  brain: Brain;
  kind: 'default' | 'remote';
  /** botmaster name for remote brains */
  name?: string;
  /** remote: no action for this long (brain ms) and the default brain takes over */
  silenceMs?: number;
  /** remote: called once when the default brain takes over */
  onFallback?: (why: string) => void;
}

export interface SessionOptions {
  brain?: BrainChoice;
  clock?: Clock;
  seed?: string;
  /** the NEAR AI client of this chat (a botmaster's own key); default the host's */
  ai?: NearAi;
}

interface SayRun {
  id: number;
  intent: ReturnType<typeof normalizeIntent>;
  steering: string;
  t0: number;
  cancelled: boolean;
  committed: boolean;
  waiters: Set<() => void>;
  idx: number;
  bubbles: string[];
  shown: string[];
  slots: BubbleSlot[];
  row?: CompletionRow;
  latencyMs?: number;
  readyAt?: number;
}

const clampN = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/** Validate an action from any brain (remote ones are untrusted JSON). Returns the action or why not. */
export function validateAction(raw: unknown): BrainAction | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not_an_object';
  const o = raw as Record<string, unknown>;
  const only = (keys: string[]) => Object.keys(o).find((k) => !keys.includes(k));
  switch (o.type) {
    case 'wait': {
      const bad = only(['type', 'ms']);
      return bad ? `unknown field ${bad}` : { type: 'wait', ms: typeof o.ms === 'number' ? o.ms : undefined };
    }
    case 'cancel': {
      const bad = only(['type']);
      return bad ? `unknown field ${bad}` : { type: 'cancel' };
    }
    case 'typing': {
      const bad = only(['type', 'on', 'ms']);
      if (bad) return `unknown field ${bad}`;
      if (typeof o.on !== 'boolean') return 'typing.on must be a boolean';
      if (o.ms !== undefined && (typeof o.ms !== 'number' || !Number.isFinite(o.ms))) return 'typing.ms must be a number';
      return { type: 'typing', on: o.on, ms: o.ms as number | undefined };
    }
    case 'say': {
      const s = parseSayIntent(o);
      if (typeof s === 'string') return s;
      let typing: TypingMeta | undefined;
      if (o.typing !== undefined) {
        if (!o.typing || typeof o.typing !== 'object') return 'typing must be an object';
        const t = o.typing as Record<string, unknown>;
        const bad = Object.keys(t).find((k) => !['cps', 'minMs', 'hesitate'].includes(k));
        if (bad) return `unknown typing field ${bad}`;
        if (t.hesitate !== undefined && typeof t.hesitate !== 'boolean') return 'typing.hesitate must be a boolean';
        typing = {
          cps: typeof t.cps === 'number' ? t.cps : undefined,
          minMs: typeof t.minMs === 'number' ? t.minMs : undefined,
          hesitate: t.hesitate as boolean | undefined,
        };
      }
      return { type: 'say', ...s, typing };
    }
    default:
      return `unknown action ${String(o.type)}`;
  }
}

/** Why a completion cannot be shown as is (re-rolled once), or null. */
export function unusable(content: string | null, bubbles: string[]): string | null {
  if (!bubbles.length) return 'empty';
  if (/<\/?think>/i.test(content ?? '')) return 'think_tags';
  if (/\[\s*steer/i.test(content ?? '')) return 'echoed_steering';
  if (bubbles.length > LIMITS.maxBubbles) return 'too_many_lines';
  if (bubbles.join('').length > LIMITS.maxChars) return 'too_long';
  return null;
}

export function personaCard(p: Persona): PersonaCard {
  return { id: p.id, model: p.model, traits: { ...p.traits }, interests: [...p.interests], cps: p.cps, ...(p.languages ? { languages: { ...p.languages } } : {}) };
}

export class BotSession {
  readonly trace: TraceEntry[] = [];
  readonly stats = {
    says: 0,
    kept: 0,
    shown: 0,
    fakeTyping: 0,
    cancels: 0,
    rejected: 0,
    fallbacks: 0,
    dropped: {} as Record<string, number>,
    /** steering ids of says started */
    steering: {} as Record<string, number>,
    /** kept says by kind (probe = own goal; direct and aside = answering) */
    kinds: { probe: 0, direct: 0, aside: 0 } as Record<IntentKind, number>,
  };
  private clock: Clock;
  private ai: NearAi;
  private rng: Rng;
  private scale: number;
  private choice: BrainChoice;
  private t0Real = 0;
  private chatMs = 120_000;
  private feed: Subject<BrainEvent> | null = null;
  private sub: Subscription | null = null;
  private brainKind: 'default' | 'remote' = 'default';
  private silenceTimer: unknown = null;
  private replaying = false;
  private eventLog: BrainEvent[] = [];
  private queue: BrainEvent[] = [];
  private draining = false;
  private tickTimer: unknown = null;
  private history: ChatTurn[] = [];
  private pendingPlayer: { id: string; text: string }[] = [];
  private nextIdx = 0;
  private signed = 0;
  private run: SayRun | null = null;
  private runPromise: Promise<void> | null = null;
  private lastBubbleAt: number | null = null;
  private typingOn = false;
  private fakeTimer: unknown = null;
  private actionTimes: number[] = [];
  private sayTimes: number[] = [];
  private toggleTimes: number[] = [];
  private lastRateNotice = -Infinity;
  private sayIds = 0;
  /** start() called: the chat is announced, the countdown may still run */
  private armed = false;
  private startTimer: unknown = null;
  /** the countdown is over and the brain runs */
  private started = false;
  private stopped = false;
  private paid = false;
  private sealPromise: Promise<void> | null = null;

  constructor(
    private host: BotHost,
    readonly side: ChatSide,
    private persona: Persona,
    private skinMessage: string,
    private attestedSigners: string[],
    opts: SessionOptions = {},
  ) {
    this.clock = opts.clock ?? realClock;
    this.ai = opts.ai ?? host.ai;
    this.rng = createRng(opts.seed);
    this.scale = host.botTimeScale > 0 ? host.botTimeScale : 1;
    this.choice = opts.brain ?? { brain: defaultBrain({ seed: opts.seed }), kind: 'default' };
    const prior = host.db.loadCompletions(side.chatId);
    this.nextIdx = prior.length ? prior[prior.length - 1].idx + 1 : 0;
  }

  /** brain ms since the chat started (0 during the countdown) */
  private bnow(): number {
    return Math.max(0, (this.clock.now() - this.t0Real) / this.scale);
  }

  private realMs(brainMs: number): number {
    return Math.max(0, brainMs * this.scale);
  }

  private note(k: TraceEntry['k'], d: unknown): void {
    if (this.trace.length < 2000) this.trace.push({ t: Math.round(this.bnow()), k, d });
  }

  get brainInUse(): 'default' | 'remote' {
    return this.brainKind;
  }

  // ---------- lifecycle ----------

  /**
   * Arm the session when the chat is announced. The chat (and the brain's clock) starts at the side's
   * startedAt, after the countdown both players see, so the bot never moves before a human could:
   * nobody can tell from the timing who is expected to speak first.
   */
  start(): void {
    if (this.armed || this.stopped) return;
    this.armed = true;
    this.t0Real = this.side.startedAt ?? this.clock.now();
    const endsAt = this.side.endsAt ?? this.t0Real + 120_000;
    this.chatMs = Math.max(1000, (endsAt - this.t0Real) / this.scale);
    const wait = this.t0Real - this.clock.now();
    if (wait > 0) this.startTimer = this.clock.setTimeout(() => this.begin(), wait);
    else this.begin();
  }

  /** The countdown is over: the brain gets chat_started (at 0) and ticks from here. */
  private begin(): void {
    if (this.started || this.stopped) return;
    if (this.startTimer) this.clock.clearTimeout(this.startTimer);
    this.startTimer = null;
    this.started = true;
    this.attach(this.choice.brain, this.choice.kind);
    this.emit({
      type: 'chat_started', at: 0, chatId: this.side.chatId, persona: personaCard(this.persona), level: this.side.level,
      gamertag: this.side.skin.name, chatMs: Math.round(this.chatMs),
    });
    this.scheduleTick();
  }

  /** A player line accepted at startedAt can race the start timer by a millisecond: begin first. */
  private beginIfDue(): void {
    if (!this.started && this.armed && !this.stopped && this.clock.now() >= this.t0Real - 50) this.begin();
  }

  private attach(brain: Brain, kind: 'default' | 'remote'): Subject<BrainEvent> {
    this.sub?.unsubscribe();
    const feed = new Subject<BrainEvent>();
    this.feed = feed;
    this.brainKind = kind;
    this.note('brain', { use: kind, name: kind === 'remote' ? this.choice.name : undefined });
    this.sub = brain(feed.asObservable()).subscribe({
      next: (a) => this.onAction(a, feed),
      error: (e) => this.onBrainGone(feed, errMsg(e)),
      complete: () => this.onBrainGone(feed, 'ended its stream'),
    });
    if (kind === 'remote') this.armSilence();
    return feed;
  }

  private onBrainGone(feed: Subject<BrainEvent>, why: string): void {
    if (feed !== this.feed || this.stopped) return;
    if (this.brainKind === 'remote') this.fallback(`remote brain ${this.choice.name}: ${why}`);
    else log.warn(`${this.side.chatId}: default brain ${why}`);
  }

  private armSilence(): void {
    if (this.silenceTimer) this.clock.clearTimeout(this.silenceTimer);
    const ms = this.choice.silenceMs ?? LIMITS.remoteSilenceMs;
    this.silenceTimer = this.clock.setTimeout(() => {
      this.silenceTimer = null;
      if (!this.stopped && this.brainKind === 'remote') this.fallback(`remote brain ${this.choice.name} sent no action for ${Math.round(ms / 1000)} s`);
    }, this.realMs(ms));
  }

  /** Replace the brain with the default one, replaying the chat so far into it. */
  private fallback(why: string): void {
    log.warn(`${this.side.chatId}: ${why}; the default brain takes over`);
    this.stats.fallbacks++;
    this.note('brain', { fallback: why });
    try {
      this.choice.onFallback?.(why);
    } catch {
      /* best effort */
    }
    if (this.silenceTimer) this.clock.clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    const feed = this.attach(defaultBrain({ seed: `${this.side.chatId}|fallback|${this.stats.fallbacks}` }), 'default');
    this.replaying = true;
    try {
      for (const e of this.eventLog) feed.next(e);
    } finally {
      this.replaying = false;
    }
  }

  private emit(e: BrainEvent): void {
    if (e.type !== 'tick') {
      // the replay log for a fallback brain: the chat's own events, not another brain's rejections
      if (e.type !== 'action_rejected' && this.eventLog.length < 1500) this.eventLog.push(e);
      this.note('event', e);
    }
    this.queue.push(e);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        this.feed?.next(next);
      }
    } finally {
      this.draining = false;
    }
  }

  private scheduleTick(): void {
    this.tickTimer = this.clock.setTimeout(() => {
      this.tickTimer = null;
      if (this.stopped) return;
      const at = this.bnow();
      this.emit({ type: 'tick', at: Math.round(at), remainingMs: Math.max(0, Math.round(this.chatMs - at)) });
      this.scheduleTick();
    }, this.realMs(LIMITS.tickMs));
  }

  onPlayerMessage(m: { id: string; text: string }): void {
    this.beginIfDue();
    if (this.stopped || !this.started) return;
    this.pendingPlayer.push({ id: m.id, text: m.text });
    // the line's language, only when clearly not English (src/bot/language.ts); brains decide what to do with it
    const lang = detectLanguage(m.text);
    this.emit({ type: 'player_message', at: Math.round(this.bnow()), id: m.id, text: m.text, ...(lang ? { lang } : {}) });
  }

  onPlayerTyping(on: boolean): void {
    this.beginIfDue();
    if (this.stopped || !this.started) return;
    this.emit({ type: 'player_typing', at: Math.round(this.bnow()), on });
  }

  // ---------- actions ----------

  private reject(action: unknown, reason: string): void {
    this.stats.rejected++;
    // echo at most a short summary: a hostile brain's junk must not grow the trace or bounce back in full
    let echo: unknown = action;
    try {
      const s = JSON.stringify(action) ?? String(action);
      if (s.length > 300) echo = `${s.slice(0, 300)}…`;
    } catch {
      echo = '(unserializable)';
    }
    this.note('rejected', { action: echo, reason });
    this.emit({ type: 'action_rejected', at: Math.round(this.bnow()), action: echo, reason });
  }

  private window(times: number[], now: number): number[] {
    while (times.length && times[0] <= now - 60_000) times.shift();
    return times;
  }

  private onAction(raw: unknown, feed: Subject<BrainEvent>): void {
    if (feed !== this.feed || this.stopped || this.replaying) return;
    if (this.brainKind === 'remote') this.armSilence();
    const now = this.bnow();
    // every action counts against the rate, valid or not; past it they are dropped with one notice per 5 s
    if (this.window(this.actionTimes, now).length >= LIMITS.maxActionsPerMinute) {
      if (now - this.lastRateNotice >= 5000) {
        this.lastRateNotice = now;
        this.reject(raw, 'rate_limited');
      } else this.stats.rejected++;
      return;
    }
    this.actionTimes.push(now);
    const a = validateAction(raw);
    if (typeof a === 'string') return this.reject(raw, a);
    this.note('action', a);
    switch (a.type) {
      case 'wait':
        return;
      case 'cancel': {
        const r = this.run;
        if (!r || r.committed || r.cancelled) return this.reject(a, 'nothing_to_cancel');
        r.cancelled = true;
        this.stats.cancels++;
        this.wake(r);
        return;
      }
      case 'typing': {
        if (this.run) return this.reject(a, 'say_in_progress');
        if (!a.on) {
          this.stopFake();
          return;
        }
        if (this.chatMs - now < 1000) return this.reject(a, 'chat_ending');
        if (this.window(this.toggleTimes, now).length >= LIMITS.maxTypingTogglesPerMinute) return this.reject(a, 'rate_limited');
        const ms = clampN(a.ms, 300, LIMITS.maxFakeTypingMs, 3000);
        if (this.fakeTimer) this.clock.clearTimeout(this.fakeTimer);
        this.setTyping(true);
        this.stats.fakeTyping++;
        this.fakeTimer = this.clock.setTimeout(() => {
          this.fakeTimer = null;
          if (!this.run) this.setTyping(false);
        }, this.realMs(ms));
        return;
      }
      case 'say': {
        if (this.run) return this.reject(a, 'busy');
        if (this.chatMs - now < 1500) return this.reject(a, 'chat_ending');
        if (this.window(this.sayTimes, now).length >= LIMITS.maxSaysPerMinute) return this.reject(a, 'rate_limited');
        this.sayTimes.push(now);
        if (this.fakeTimer) this.clock.clearTimeout(this.fakeTimer); // fake typing flows into the real say
        this.fakeTimer = null;
        const p: Promise<void> = this.runSay(a, a.typing)
          .catch((e) => log.error(`${this.side.chatId} say failed`, e))
          .finally(() => {
            if (this.runPromise === p) this.runPromise = null;
          });
        this.runPromise = p;
        return;
      }
    }
  }

  private stopFake(): void {
    if (this.fakeTimer) this.clock.clearTimeout(this.fakeTimer);
    this.fakeTimer = null;
    if (!this.run) this.setTyping(false);
  }

  private setTyping(on: boolean): void {
    if (this.typingOn === on) return;
    this.typingOn = on;
    this.toggleTimes.push(this.bnow());
    this.host.botTyping(this.side, on);
  }

  // ---------- one say ----------

  private base(): ChatTurn[] {
    return [
      { role: 'system', content: this.persona.prompt },
      { role: 'system', content: this.skinMessage },
    ];
  }

  private wake(r: SayRun): void {
    for (const w of [...r.waiters]) w();
    r.waiters.clear();
  }

  /** Wait until brain time `at`; false if the say was cancelled or the chat stopped first. */
  private until(at: number, r: SayRun): Promise<boolean> {
    return new Promise((resolve) => {
      if (r.cancelled || this.stopped) return resolve(false);
      const done = () => {
        this.clock.clearTimeout(h);
        resolve(false);
      };
      const h = this.clock.setTimeout(() => {
        r.waiters.delete(done);
        resolve(true);
      }, this.realMs(at - this.bnow()));
      r.waiters.add(done);
    });
  }

  /** Resolve `p`, or null when the say is cancelled, the chat stops, or `realMs` passes. */
  private raceRun<T>(p: Promise<T>, r: SayRun, realMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v: T | null) => {
        if (settled) return;
        settled = true;
        this.clock.clearTimeout(h);
        r.waiters.delete(stop);
        resolve(v);
      };
      const stop = () => finish(null);
      const h = this.clock.setTimeout(stop, realMs);
      if (r.cancelled || this.stopped) return finish(null);
      r.waiters.add(stop);
      p.then(finish, () => finish(null));
    });
  }

  private async completeTwice(request: string): Promise<CompletionResult | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await this.ai.complete(this.persona.model, request);
      if (res.ok && res.completionId) return res;
      log.warn(`${this.side.chatId} ${this.persona.model} attempt ${attempt} failed: ${res.status} ${res.error?.slice(0, 160)}`);
      if (attempt === 1) await sleepOn(this.clock, 400);
    }
    return null;
  }

  private draft(r: SayRun, request: string, res: CompletionResult, v: { sig: SignaturePayload | null; check: SignatureCheck } | null, reason: string): void {
    try {
      this.host.db.saveDraft?.({
        chatId: this.side.chatId, sayId: r.id, at: this.clock.now(), steering: steeringId(r.intent), request, response: res.response,
        completionId: res.completionId ?? null, signature: v?.sig ? JSON.stringify(v.sig) : null, verify: v ? JSON.stringify(v.check) : null, reason,
      });
    } catch (e) {
      log.warn(`${this.side.chatId} draft not stored: ${errMsg(e)}`);
    }
  }

  private dropped(r: SayRun, reason: DropReason, detail?: string): void {
    this.stats.dropped[reason] = (this.stats.dropped[reason] ?? 0) + 1;
    this.note('say', { sayId: r.id, steering: steeringId(r.intent), dropped: reason, detail, latencyMs: r.latencyMs });
    if (reason !== 'chat_over') log.info(`${this.side.chatId} say ${r.id} (${steeringId(r.intent)}) dropped: ${reason}${detail ? ` (${detail})` : ''}`);
    this.emit({ type: 'say_dropped', at: Math.round(this.bnow()), sayId: r.id, reason });
  }

  private async runSay(intent: SayIntent, meta: TypingMeta | undefined): Promise<void> {
    const n = normalizeIntent(intent);
    const r: SayRun = {
      id: ++this.sayIds, intent: n, steering: steeringText(n), t0: this.bnow(), cancelled: false, committed: false,
      waiters: new Set(), idx: -1, bubbles: [], shown: [], slots: [],
    };
    this.run = r;
    this.stats.says++;
    const sid = steeringId(n);
    this.stats.steering[sid] = (this.stats.steering[sid] ?? 0) + 1;
    const take = this.pendingPlayer.length;
    const turns: ChatTurn[] = [
      ...this.pendingPlayer.slice(0, take).map((m) => ({ role: 'user' as const, content: m.text })),
      { role: 'system', content: r.steering },
    ];
    const request = buildRequest(this.persona.model, [...this.base(), ...this.history, ...turns]);
    const cps = clampCps(meta?.cps ?? this.persona.cps * uniformR(this.rng, 0.9, 1.1));
    const hesitateP = meta?.hesitate === false ? 0 : meta?.hesitate ? 0.6 : lerp(0.25, 0.1, this.persona.traits.fast);
    this.setTyping(true);
    this.emit({ type: 'say_started', at: Math.round(r.t0), sayId: r.id, intent: n });
    try {
      let res: CompletionResult | null = null;
      let drop: DropReason | null = null;
      let detail: string | undefined;
      for (let roll = 0; roll < 2 && !res && !drop; roll++) {
        const got = await this.completeTwice(request);
        if (!got) {
          drop = 'model_failed';
          break;
        }
        r.latencyMs = (r.latencyMs ?? 0) + got.latencyMs;
        if (r.cancelled || this.stopped) {
          drop = r.cancelled ? 'cancelled' : 'chat_over';
          this.draft(r, request, got, null, drop);
          break;
        }
        const why = unusable(got.content, bubblesOf(got.content));
        if (why) {
          log.warn(`${this.side.chatId} say ${r.id} completion unusable (${why}): ${JSON.stringify((got.content ?? '').slice(0, 120))}`);
          this.draft(r, request, got, null, why);
          detail = why;
          continue;
        }
        res = got;
      }
      if (!res && !drop) drop = 'model_failed';
      let v: { sig: SignaturePayload | null; check: SignatureCheck } | null = null;
      if (res && !drop) {
        // never show text before its enclave signature verifies; keep typing while it arrives
        const left = this.realMs(this.chatMs - this.bnow());
        const sigP = this.ai.signature(res.completionId!, LIMITS.signatureWaitMs).then((sig) => ({
          sig, check: checkSignature(this.persona.model, request, res!.response, sig, this.attestedSigners),
        }));
        v = await this.raceRun(sigP, r, Math.min(LIMITS.signatureWaitMs, left));
        r.readyAt = this.bnow();
        if (r.cancelled || this.stopped) drop = r.cancelled ? 'cancelled' : 'chat_over';
        else if (!v?.check.validSignature) {
          drop = 'signature';
          detail = v ? 'did not verify' : 'late';
        }
      }
      let slots: BubbleSlot[] | null = null;
      if (res && !drop) {
        r.bubbles = bubblesOf(res.content);
        slots = planBubbles({
          bubbles: r.bubbles, cps, t0: r.t0, ready: r.readyAt!, prevShownAt: this.lastBubbleAt, endAt: this.chatMs, minMs: meta?.minMs,
          hesitateP: this.window(this.toggleTimes, this.bnow()).length < LIMITS.maxTypingTogglesPerMinute - 4 ? hesitateP : 0, rng: this.rng,
        });
        if (!slots) drop = 'too_late';
      }
      if (res && !drop && slots) {
        r.slots = slots;
        const h = slots[0].hesitation;
        if (h) {
          void this.until(h.from, r).then((ok) => ok && !r.committed && this.setTyping(false));
          void this.until(h.from + h.ms, r).then((ok) => ok && !r.committed && this.setTyping(true));
        }
        const reached = await this.until(slots[0].at, r);
        if (!reached || r.cancelled || this.stopped || !this.host.isChatting(this.side)) drop = r.cancelled ? 'cancelled' : 'chat_over';
      }
      if (drop || !res || !v) {
        if (res) this.draft(r, request, res, v, drop ?? 'model_failed');
        this.dropped(r, drop ?? 'model_failed', detail);
        return;
      }
      // keep it: from here on the whole reply is shown and the history includes it
      r.committed = true;
      r.idx = this.nextIdx++;
      this.history.push(...turns, { role: 'assistant', content: cleanContent(res.content) });
      this.pendingPlayer.splice(0, take);
      r.row = {
        chatId: this.side.chatId, idx: r.idx, completionId: res.completionId ?? null, model: this.persona.model, request, response: res.response,
        signature: v.sig ? JSON.stringify(v.sig) : null, verify: JSON.stringify(v.check), displayed: '[]', at: this.clock.now(), latencyMs: res.latencyMs, error: null,
      };
      this.host.db.saveCompletion(r.row);
      this.signed++;
      this.stats.kept++;
      this.stats.kinds[kindOf(n.intent)]++;
      this.showNext(r);
      for (let i = 1; i < r.bubbles.length; i++) {
        if (r.shown.length > i) continue; // flushed at the chat's end
        if (!(await this.until(r.slots[i].typingFrom, r))) break;
        if (r.shown.length <= i) this.setTyping(true);
        if (!(await this.until(r.slots[i].at, r))) break;
        if (r.shown.length <= i && !this.showNext(r)) break;
      }
      this.note('say', {
        sayId: r.id, steering: sid, idx: r.idx, t0: Math.round(r.t0), latencyMs: r.latencyMs, readyAt: Math.round(r.readyAt ?? 0), cps: Math.round(cps * 100) / 100,
        bubbles: r.bubbles.map((b, i) => ({ text: b, typingFrom: Math.round(r.slots[i].typingFrom), at: Math.round(r.slots[i].at), hesitation: r.slots[i].hesitation })),
        shown: r.shown.length,
      });
      this.emit({ type: 'say_done', at: Math.round(this.bnow()), sayId: r.id, bubbles: r.shown.length });
    } finally {
      if (this.run === r) this.run = null;
      if (!this.fakeTimer) this.setTyping(false);
    }
  }

  /** Show the next bubble of a kept say. */
  private showNext(r: SayRun): boolean {
    const i = r.shown.length;
    if (i >= r.bubbles.length) return false;
    const text = r.bubbles[i];
    this.setTyping(false);
    if (!this.host.isChatting(this.side) || !this.host.botSay(this.side, text, r.idx)) return false;
    r.shown.push(text);
    this.lastBubbleAt = this.bnow();
    this.stats.shown++;
    if (r.row) {
      r.row.displayed = JSON.stringify(r.shown);
      this.host.db.saveCompletion(r.row);
    }
    this.emit({ type: 'bot_message_shown', at: Math.round(this.bnow()), sayId: r.id, text, bubble: i + 1, bubbles: r.bubbles.length });
    return true;
  }

  /** The chat is about to end: show what is left of a kept say now, so screen and record agree. */
  flush(): void {
    const r = this.run;
    if (!r || !r.committed) return;
    while (r.shown.length < r.bubbles.length) if (!this.showNext(r)) break;
  }

  /**
   * Chat over. For a paid chat, make sure the last signed completion's request carries the whole
   * transcript up to the last player message (the on-chain proof): one more completion, not shown.
   */
  stop(paid: boolean): void {
    if (this.stopped) return;
    this.flush();
    if (this.started) this.emit({ type: 'chat_ended', at: Math.round(this.bnow()), reason: this.side.endReason ?? 'ended' });
    this.stopped = true;
    this.paid = paid;
    for (const t of [this.tickTimer, this.fakeTimer, this.silenceTimer, this.startTimer]) if (t) this.clock.clearTimeout(t);
    this.tickTimer = this.fakeTimer = this.silenceTimer = this.startTimer = null;
    if (this.run) this.wake(this.run);
    this.sub?.unsubscribe();
    this.sub = null;
    this.feed = null;
    this.setTyping(false);
    void (async () => {
      if (this.runPromise) await this.runPromise;
      await this.maybeSeal();
    })().finally(() => this.saveTrace());
  }

  private maybeSeal(): Promise<void> {
    if (!this.paid) return Promise.resolve();
    if (!this.sealPromise) this.sealPromise = (async () => {
      if (this.runPromise) await this.runPromise;
      await this.seal();
    })();
    return this.sealPromise;
  }

  private async seal(): Promise<void> {
    if (this.signed > 0 && this.pendingPlayer.length === 0) return;
    try {
      const request = buildRequest(this.persona.model, [...this.base(), ...this.history, ...this.pendingPlayer.map((m) => ({ role: 'user' as const, content: m.text }))]);
      const res = await this.completeTwice(request);
      if (!res) return;
      const sig = await this.ai.signature(res.completionId!, 60_000);
      const check = checkSignature(this.persona.model, request, res.response, sig, this.attestedSigners);
      const idx = this.nextIdx++;
      this.host.db.saveCompletion({
        chatId: this.side.chatId, idx, completionId: res.completionId ?? null, model: this.persona.model, request, response: res.response,
        signature: sig ? JSON.stringify(sig) : null, verify: JSON.stringify(check), displayed: '[]', at: this.clock.now(), latencyMs: res.latencyMs,
        error: sig ? null : 'no signature within 60 s',
      });
      if (check.validSignature) this.signed++;
      this.pendingPlayer = [];
      this.note('say', { seal: true, idx, latencyMs: res.latencyMs, validSignature: check.validSignature });
      log.info(`${this.side.chatId} sealed the transcript with a final signed completion`);
    } catch (e) {
      log.error(`${this.side.chatId} seal failed`, e);
    }
  }

  private saveTrace(): void {
    try {
      this.host.db.saveTrace?.(this.side.chatId, { persona: this.persona.id, brain: this.choice.kind, scale: this.scale, stats: this.stats, trace: this.trace });
    } catch (e) {
      log.warn(`${this.side.chatId} trace not stored: ${errMsg(e)}`);
    }
  }

  /** Resolves when the say in flight and the seal are done (settlement waits for it). */
  async settled(): Promise<void> {
    for (let i = 0; i < 900 && this.runPromise; i++) await Promise.race([this.runPromise, sleepOn(realClock, 100)]);
    if (this.stopped) await this.maybeSeal();
    this.saveTrace();
  }
}
