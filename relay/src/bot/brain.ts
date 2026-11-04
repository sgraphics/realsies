// The default brain: decides on its own schedule when to type and what kind of message to send.
//
// Policy (docs/bot-api.md): across a chat about half the bot's turns pursue its own goal, finding
// out whether the partner is human (opener, probe, challenge, accuse, nudge, verdict), and half
// answer; within answering about 70% reply directly (reply, react) and 30% go out of order
// (afterthought, clarify, late answer, tangent from the persona's interests). A deficit sampler pulls
// the running shares toward those targets, so they hold whatever the player does. The bot reads
// before it reacts, waits while the player is typing, speaks when the partner goes quiet, sometimes
// double-texts, sometimes types and stops, and now and then deletes a draft when a new message lands.
// Persona traits (chatty, fast, curious) move every dial.
//
// The brain is a pure reducer of events; it never touches timers (ticks drive it), so a seed and an
// event sequence fully determine its actions. RxJS wraps it as a Brain.
import { concatMap, defer, from, type Observable } from 'rxjs';
import {
  kindOf, type Brain, type BrainAction, type BrainEvent, type Intent, type IntentKind, type Length, type PersonaCard, type SayIntent,
  type Topic, TOPICS,
} from './api.js';
import { chance, createRng, lerp, pickR, uniformR, weighted, type Rng } from './rng.js';
import { readMs } from './typing.js';

export interface PolicyConfig {
  /** target share of turns that probe (own goal) */
  probeShare: number;
  /** within answering, target share of direct replies */
  directShare: number;
  /** pull toward the targets (0 = plain random draws) */
  balance: number;
  /** share of the direct-reply weight that goes to out-of-order remarks when there is nothing to reply to */
  transfer: number;
  /** each own turn the partner leaves unanswered stretches the next silence by this factor */
  silenceBackoff: number;
}

export const DEFAULT_POLICY: PolicyConfig = { probeShare: 0.5, directShare: 0.7, balance: 2, transfer: 0.1, silenceBackoff: 1.6 };

export interface DefaultBrainOptions {
  seed?: string | number;
  policy?: Partial<PolicyConfig>;
}

type Trigger = 'opener' | 'reply' | 'silence' | 'double' | 'verdict';

interface Plan {
  at: number;
  trigger: Trigger;
  fakeDone?: boolean;
}

interface PMsg {
  id: string;
  text: string;
  at: number;
}

const QUESTIONISH = /\?|\b(who|what|where|when|why|how|are you|r u|do you|did you|can you|you\s+a)\b/i;

export class DefaultBrainCore {
  private rng: Rng;
  private policy: PolicyConfig;
  private persona: PersonaCard | null = null;
  // dials
  private probeTarget = 0.5;
  private doubleP = 0.15;
  private multiP = 0.15;
  private fakeP = 0.09;
  private openFirstP = 0.7;
  private distractedP = 0.12;
  private cancelP = 0.35;
  private verdictP = 0.6;
  private patienceMs = 7000;
  private silenceBase = 9000;
  private fast = 0.5;
  // time
  private now = 0;
  private remaining = 120_000;
  private over = false;
  // conversation
  private playerCount = 0;
  private unanswered: PMsg[] = [];
  private skipped: PMsg[] = [];
  private lastPlayerAt: number | null = null;
  private playerTyping = false;
  private playerTypingSince = 0;
  private lastBotAt: number | null = null;
  private botShown = 0;
  private lastIntent: Intent | null = null;
  private recentTopics: Topic[] = [];
  private nudgedAt = -Infinity;
  private inFlight: { intent: SayIntent; kind: IntentKind; shown: number; cancelling?: boolean } | null = null;
  private plan: Plan | null = null;
  private backoffUntil = 0;
  private verdictChecked = false;
  private nextSilence = 9000;
  /** says since the partner last wrote */
  private selfStreak = 0;
  /** says started per kind (dropped ones taken back) */
  readonly counts: Record<IntentKind, number> = { probe: 0, direct: 0, aside: 0 };

  constructor(opts: DefaultBrainOptions = {}) {
    this.rng = createRng(opts.seed);
    this.policy = { ...DEFAULT_POLICY, ...opts.policy };
  }

  private u(lo: number, hi: number) {
    return uniformR(this.rng, lo, hi);
  }

  /** How long a lull lasts before the bot speaks up; longer each time the partner left it hanging. */
  private drawSilence(): number {
    return this.silenceBase * this.u(0.8, 1.25) * this.policy.silenceBackoff ** Math.min(3, this.selfStreak);
  }

  private setPersona(p: PersonaCard): void {
    this.persona = p;
    const { chatty, fast, curious } = p.traits;
    this.fast = fast;
    this.probeTarget = Math.min(0.7, Math.max(0.3, this.policy.probeShare + (curious - 0.5) * 0.16));
    this.doubleP = lerp(0.06, 0.3, chatty);
    this.multiP = lerp(0.08, 0.28, chatty);
    this.fakeP = lerp(0.12, 0.06, chatty);
    this.openFirstP = lerp(0.5, 0.9, chatty);
    this.verdictP = 0.45 + 0.3 * curious;
    this.patienceMs = this.u(5000, 9000);
    this.silenceBase = lerp(13_000, 6500, chatty);
    this.nextSilence = this.drawSilence();
  }

  /** One event in, zero or more actions out. */
  on(e: BrainEvent): BrainAction[] {
    if (this.over) return [];
    if (e.type !== 'chat_started') this.now = Math.max(this.now, e.at);
    return this.handle(e);
  }

  private handle(e: BrainEvent): BrainAction[] {
    switch (e.type) {
      case 'chat_started': {
        this.setPersona(e.persona);
        this.remaining = e.chatMs;
        if (chance(this.rng, this.openFirstP)) this.plan = { at: this.u(2000, 6000) * lerp(1.3, 0.75, this.fast), trigger: 'opener' };
        return [];
      }
      case 'tick':
        this.remaining = e.remainingMs;
        return this.step();
      case 'player_typing':
        this.playerTyping = e.on;
        if (e.on) this.playerTypingSince = e.at;
        return [];
      case 'player_message': {
        const m = { id: e.id, text: e.text, at: e.at };
        this.playerCount++;
        this.selfStreak = 0;
        this.unanswered.push(m);
        this.lastPlayerAt = e.at;
        this.playerTyping = false;
        const f = this.inFlight;
        if (f) {
          // typing something that no longer fits: sometimes delete it and answer instead
          if (f.shown === 0 && !f.cancelling && f.kind !== 'direct' && chance(this.rng, this.cancelP)) {
            f.cancelling = true;
            return [{ type: 'cancel' }];
          }
          return [];
        }
        const base = this.plan?.trigger === 'reply' ? Math.max(this.plan.at, e.at) : e.at;
        const distracted = chance(this.rng, this.distractedP) ? this.u(2000, 6000) : 0;
        this.plan = { at: base + readMs(e.text, this.fast, this.rng) + distracted, trigger: 'reply' };
        return [];
      }
      case 'say_started':
        if (!this.inFlight) this.inFlight = { intent: e.intent, kind: kindOf(e.intent.intent), shown: 0 };
        if (this.plan?.trigger === 'opener') this.plan = null;
        return [];
      case 'bot_message_shown':
        if (this.inFlight) this.inFlight.shown++;
        this.lastBotAt = e.at;
        this.botShown++;
        return [];
      case 'say_done':
        this.inFlight = null;
        this.lastBotAt = e.at;
        this.afterSay();
        return [];
      case 'say_dropped': {
        if (this.inFlight) this.counts[this.inFlight.kind] = Math.max(0, this.counts[this.inFlight.kind] - 1);
        this.inFlight = null;
        if (e.reason === 'model_failed' || e.reason === 'signature') this.backoffUntil = e.at + this.u(15_000, 25_000);
        if (this.unanswered.length) {
          const last = this.unanswered[this.unanswered.length - 1];
          const wait = e.reason === 'cancelled' ? readMs(last.text, this.fast, this.rng) * 0.6 : this.u(800, 2000);
          this.plan = { at: e.at + wait, trigger: 'reply' };
        }
        return [];
      }
      case 'action_rejected': {
        const a = e.action as { type?: string } | null;
        if (a?.type === 'say' && this.inFlight && this.inFlight.shown === 0) {
          this.counts[this.inFlight.kind] = Math.max(0, this.counts[this.inFlight.kind] - 1);
          this.inFlight = null;
          if (this.unanswered.length) this.plan = { at: e.at + this.u(1500, 3000), trigger: 'reply' };
        }
        return [];
      }
      case 'chat_ended':
        this.over = true;
        this.plan = null;
        return [];
    }
  }

  private afterSay(): void {
    if (this.unanswered.length) {
      // the player wrote while we were typing: read it (partly read already) and answer
      const last = this.unanswered[this.unanswered.length - 1];
      this.plan = { at: this.now + readMs(last.text, this.fast, this.rng) * 0.6, trigger: 'reply' };
    } else if (this.remaining > 12_000 && chance(this.rng, this.doubleP * 0.5 ** Math.max(0, this.selfStreak - 1))) {
      this.plan = { at: this.now + this.u(1200, 4500), trigger: 'double' };
    } else this.plan = null;
    this.nextSilence = this.drawSilence();
  }

  private step(): BrainAction[] {
    if (this.inFlight) return [];
    if (!this.plan) {
      const lastActivity = Math.max(this.lastPlayerAt ?? 0, this.lastBotAt ?? 0);
      if (!this.verdictChecked && this.remaining <= 16_000 && this.remaining >= 7000 && this.botShown > 0 && this.playerCount > 0) {
        // a closing verdict is one more probe: likely when probing is behind its share, rare when ahead
        this.verdictChecked = true;
        const n = this.counts.probe + this.counts.direct + this.counts.aside;
        const ahead = n > 0 && (this.counts.probe + 1) / (n + 1) > this.probeTarget + 0.02;
        if (chance(this.rng, ahead ? this.verdictP * 0.3 : this.verdictP)) this.plan = { at: this.now + this.u(0, 1500), trigger: 'verdict' };
      } else if (!this.playerTyping && this.now >= this.backoffUntil && this.now - lastActivity >= this.nextSilence) {
        this.plan = { at: this.now, trigger: 'silence' };
        this.nextSilence = this.drawSilence();
      }
    }
    const plan = this.plan;
    if (!plan || this.now < plan.at) return [];
    // a person watching the dots waits for the other's message, up to their patience
    if (this.playerTyping && this.now - this.playerTypingSince < this.patienceMs) {
      plan.at = this.now + 500;
      return [];
    }
    if (this.remaining < 4000 || (this.remaining < 6500 && !this.unanswered.length)) {
      this.plan = null;
      return [];
    }
    if (!plan.fakeDone && plan.trigger !== 'verdict' && this.remaining > 15_000 && chance(this.rng, this.fakeP)) {
      // types for a bit, stops; then goes on, or (for its own initiative) thinks better of it
      const ms = this.u(1200, 3500);
      plan.fakeDone = true;
      plan.at = this.now + ms + this.u(800, 2500);
      if ((plan.trigger === 'silence' || plan.trigger === 'double') && chance(this.rng, 0.35)) this.plan = null;
      return [{ type: 'typing', on: true, ms: Math.round(ms) }];
    }
    let say = this.choose(plan.trigger);
    if (this.remaining < 6500 && say.intent !== 'react') say = { intent: 'react', length: 'one' };
    this.plan = null;
    return [this.start(say)];
  }

  private start(say: SayIntent): BrainAction {
    const kind = kindOf(say.intent);
    this.counts[kind]++;
    if (kind === 'direct') this.unanswered = [];
    else {
      if (say.intent === 'late_answer') this.skipped = [];
      this.skipped.push(...this.unanswered.filter((m) => QUESTIONISH.test(m.text)));
      this.skipped = this.skipped.slice(-3);
      this.unanswered = [];
    }
    if (say.intent === 'nudge') this.nudgedAt = this.now;
    if (say.intent === 'tangent' && say.topic) this.recentTopics = [say.topic, ...this.recentTopics].slice(0, 3);
    this.lastIntent = say.intent;
    this.selfStreak++;
    this.inFlight = { intent: say, kind, shown: 0 };
    const cps = (this.persona?.cps ?? 5) * this.u(0.92, 1.08) * (say.intent === 'react' ? 1.15 : 1);
    return { type: 'say', ...say, typing: { cps: Math.round(cps * 100) / 100 } };
  }

  /** Deficit weight: the target share, pulled up when behind it and down when ahead. */
  private w(target: number, count: number, n: number): number {
    return target * Math.exp(this.policy.balance * (target * (n + 1) - count));
  }

  /**
   * Deficit sampling over the three kinds with joint targets: probe probeShare, direct
   * (1 - probeShare) x directShare, aside the rest. A direct reply needs an unanswered player message;
   * on the bot's own turns part of the direct weight (policy.transfer) goes to out-of-order remarks,
   * so answering keeps its half when the player gives little to reply to, while the direct deficit
   * built up meanwhile is paid back on the next turn that has something to answer.
   */
  private choose(trigger: Trigger): SayIntent {
    if (trigger === 'opener' || (this.playerCount === 0 && this.botShown === 0)) return { intent: 'opener', length: this.len('opener') };
    if (trigger === 'verdict') return { intent: 'verdict', length: 'one' };
    const pt = this.probeTarget;
    const ds = this.policy.directShare;
    const T: Record<IntentKind, number> = { probe: pt, direct: (1 - pt) * ds, aside: (1 - pt) * (1 - ds) };
    const n = this.counts.probe + this.counts.direct + this.counts.aside;
    const canDirect = this.unanswered.length > 0;
    const wDirect = this.w(T.direct, this.counts.direct, n);
    const kind =
      weighted(this.rng, [
        ['probe', this.w(T.probe, this.counts.probe, n)],
        ['direct', canDirect ? wDirect : 0],
        ['aside', this.w(T.aside, this.counts.aside, n) + (canDirect ? 0 : this.policy.transfer * wDirect)],
      ] as const) ?? 'probe';
    if (kind === 'direct') return this.chooseDirect();
    if (kind === 'aside') return this.chooseAside();
    return this.chooseProbe(trigger);
  }

  private len(intent: Intent): Length {
    if (intent === 'react' || intent === 'nudge' || intent === 'verdict') return 'one';
    return chance(this.rng, intent === 'opener' ? this.multiP * 0.6 : this.multiP) ? 'multi' : 'one';
  }

  private rep(intent: Intent, w: number): number {
    return this.lastIntent === intent ? w * 0.25 : w;
  }

  private chooseProbe(trigger: Trigger): SayIntent {
    const quietAfterBot = (this.lastBotAt ?? -1) > (this.lastPlayerAt ?? -1);
    if (trigger === 'silence' && quietAfterBot && this.now - this.nudgedAt > 25_000) return { intent: 'nudge', length: 'one' };
    const curious = this.persona?.traits.curious ?? 0.5;
    const intent =
      weighted<Intent>(this.rng, [
        ['probe', this.rep('probe', 0.5)],
        ['challenge', this.playerCount > 0 ? this.rep('challenge', 0.15 + 0.15 * curious) : 0],
        ['accuse', this.playerCount > 0 ? this.rep('accuse', this.playerCount >= 2 ? 0.3 : 0.15) : 0],
      ]) ?? 'probe';
    return { intent, length: this.len(intent) };
  }

  private chooseDirect(): SayIntent {
    const last = this.unanswered[this.unanswered.length - 1];
    const question = !!last && QUESTIONISH.test(last.text);
    const intent: Intent = !question && last && last.text.length <= 50 && chance(this.rng, 0.3) ? 'react' : 'reply';
    return { intent, length: this.len(intent) };
  }

  private chooseAside(): SayIntent {
    const spoke = this.botShown > 0;
    const intent =
      weighted<Intent>(this.rng, [
        ['late_answer', this.skipped.length ? 1.6 : 0],
        ['afterthought', spoke ? this.rep('afterthought', 0.8) : 0],
        ['clarify', spoke ? this.rep('clarify', 0.3) : 0],
        ['tangent', 1.0],
      ]) ?? 'tangent';
    if (intent !== 'tangent') return { intent, length: this.len(intent) };
    const pool = (this.persona?.interests.length ? this.persona.interests : [...TOPICS]).filter((t) => !this.recentTopics.includes(t));
    const topic = pickR(this.rng, pool.length ? pool : this.persona?.interests.length ? this.persona.interests : [...TOPICS]);
    return { intent, topic, length: this.len(intent) };
  }
}

/** The default brain as an RxJS operator over the event stream. One core per subscription. */
export function defaultBrain(opts: DefaultBrainOptions = {}): Brain & { lastCore?: DefaultBrainCore } {
  const brain = ((events: Observable<BrainEvent>): Observable<BrainAction> =>
    defer(() => {
      const core = new DefaultBrainCore(opts);
      brain.lastCore = core;
      return events.pipe(concatMap((e) => from(core.on(e))));
    })) as Brain & { lastCore?: DefaultBrainCore };
  return brain;
}
