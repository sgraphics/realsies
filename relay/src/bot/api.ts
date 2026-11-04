// The bot engine's public API (protocol realsies-brain/1), documented in docs/bot-api.md.
//
// A brain decides WHEN the bot types and WHAT KIND of message it sends; it never writes text.
// It reads a stream of events (chat started, ticks, the player typing and writing, its own
// messages shown) and emits actions (say an intent, fake typing, cancel, wait). The relay executes
// the actions: every `say` becomes one NEAR AI enclave completion whose request is the committed
// persona prompt, the per-chat skin message, the transcript, and one fixed steering message for the
// intent (src/bot/intents.ts). Nothing is shown before its enclave signature verifies.
//
// All times are milliseconds since the chat started, in the brain's time base (the relay scales
// real time by BOT_TIME_SCALE in tests; in production one brain millisecond is one real millisecond).
import type { Observable } from 'rxjs';

export const BRAIN_PROTOCOL = 'realsies-brain/1';

// ---------- intents ----------

/** Pursue the bot's own goal: find out whether the partner is human. */
export const PROBE_INTENTS = ['opener', 'probe', 'challenge', 'accuse', 'nudge', 'verdict'] as const;
/** Answer, directly. */
export const DIRECT_INTENTS = ['reply', 'react'] as const;
/** Answer, out of order: afterthought, clarification, late answer, tangent. */
export const ASIDE_INTENTS = ['afterthought', 'clarify', 'late_answer', 'tangent'] as const;
export const INTENTS = [...PROBE_INTENTS, ...DIRECT_INTENTS, ...ASIDE_INTENTS] as const;
export type Intent = (typeof INTENTS)[number];

/** Topics for `tangent` (pick from the persona's `interests`). */
export const TOPICS = ['local', 'news', 'sport', 'music', 'food', 'weather', 'work', 'hot_take'] as const;
export type Topic = (typeof TOPICS)[number];

/** `one`: one short line. `multi`: two or three very short lines, shown as separate bubbles. */
export const LENGTHS = ['one', 'multi'] as const;
export type Length = (typeof LENGTHS)[number];

export type IntentGoal = 'probe' | 'answer';
export type IntentKind = 'probe' | 'direct' | 'aside';

export function kindOf(intent: Intent): IntentKind {
  if ((PROBE_INTENTS as readonly string[]).includes(intent)) return 'probe';
  if ((DIRECT_INTENTS as readonly string[]).includes(intent)) return 'direct';
  return 'aside';
}

export function goalOf(intent: Intent): IntentGoal {
  return kindOf(intent) === 'probe' ? 'probe' : 'answer';
}

export interface SayIntent {
  intent: Intent;
  /** `tangent` only; required there. */
  topic?: Topic;
  /** Default `one`. `react` is always `one`. */
  length?: Length;
}

/** Optional timing hints for a `say`. The relay clamps every value to LIMITS. */
export interface TypingMeta {
  /** Typing speed for this message in characters per second (default: the persona's). */
  cps?: number;
  /** Show the first bubble no earlier than this many ms after the say starts. */
  minMs?: number;
  /** Allow (true) or forbid (false) a mid-message pause where the typing indicator drops. */
  hesitate?: boolean;
}

// ---------- persona card ----------

/**
 * 0..1 dials. chatty: terse 0 .. chatty 1. fast: slow 0 .. fast 1. curious: incurious 0 .. testing the
 * partner 1. guarded: open 0 .. guarded 1 (types and stops, deletes drafts, accuses, waits for the other
 * to open). drift: tidy and on topic 0 .. messy and drifting 1 (asides, tangents, afterthoughts).
 * Demo personas derive them from their attributes (src/persona/model.ts deriveTraits).
 */
export interface PersonaTraits {
  chatty: number;
  fast: number;
  curious: number;
  guarded: number;
  drift: number;
}

/** What a brain learns about the persona it plays (never the prompt text). */
export interface PersonaCard {
  id: string;
  model: string;
  traits: PersonaTraits;
  interests: Topic[];
  /** characters per second on a phone keyboard */
  cps: number;
}

// ---------- events (relay -> brain) ----------

export type DropReason =
  | 'model_failed' // two attempts failed, or the model returned nothing usable
  | 'signature' // the enclave signature did not verify in time
  | 'cancelled' // the brain cancelled before anything was shown
  | 'too_late' // the text could not be shown before the chat ends
  | 'chat_over';

export type BrainEvent =
  | { type: 'chat_started'; at: number; chatId: string; persona: PersonaCard; level: 1 | 2 | 3; gamertag: string; chatMs: number }
  | { type: 'tick'; at: number; remainingMs: number }
  | { type: 'player_typing'; at: number; on: boolean }
  | { type: 'player_message'; at: number; id: string; text: string }
  /** the relay accepted a say: typing indicator on, model call in flight */
  | { type: 'say_started'; at: number; sayId: number; intent: SayIntent }
  /** one bubble of a say is now on the player's screen */
  | { type: 'bot_message_shown'; at: number; sayId: number; text: string; bubble: number; bubbles: number }
  | { type: 'say_done'; at: number; sayId: number; bubbles: number }
  | { type: 'say_dropped'; at: number; sayId: number; reason: DropReason }
  | { type: 'action_rejected'; at: number; action: unknown; reason: string }
  | { type: 'chat_ended'; at: number; reason: string };

export type BrainEventType = BrainEvent['type'];

// ---------- actions (brain -> relay) ----------

export type BrainAction =
  /** Start typing now and send one signed completion for this intent. One say at a time. */
  | ({ type: 'say'; typing?: TypingMeta } & SayIntent)
  /** Typing indicator only, no text: on for `ms` (default 3000, max LIMITS.maxFakeTypingMs), or off now. */
  | { type: 'typing'; on: boolean; ms?: number }
  /** Abandon the say in progress if none of it is shown yet ("typed, then deleted"). */
  | { type: 'cancel' }
  /** Deliberately idle; a remote brain uses it as a keepalive. */
  | { type: 'wait'; ms?: number };

export type BrainActionType = BrainAction['type'];

/** A brain: events in, actions out. One subscription per chat. */
export type Brain = (events: Observable<BrainEvent>) => Observable<BrainAction>;

// ---------- limits the relay enforces on every brain ----------

export const LIMITS = {
  /** tick period */
  tickMs: 500,
  /** all actions of one chat, sliding minute */
  maxActionsPerMinute: 40,
  /** says of one chat, sliding minute */
  maxSaysPerMinute: 8,
  /** typing speed bounds (characters per second) */
  minCps: 2,
  maxCps: 9,
  /** the shortest time any bubble takes to "type" */
  minBubbleMs: 700,
  /** one bubble's typing indicator, continuous (longer texts type faster, up to maxCps) */
  maxTypingMs: 20_000,
  maxFakeTypingMs: 8_000,
  /** indicator off between two bubbles of one say */
  bubbleGapMs: [250, 900] as const,
  /** from the last bubble of one say to the first bubble of the next */
  minSayGapMs: 700,
  /** a completion with more lines than this is re-rolled once, then dropped */
  maxBubbles: 4,
  maxChars: 280,
  /** typing-indicator toggles per sliding minute (fake typing and hesitations included) */
  maxTypingTogglesPerMinute: 24,
  /** a remote brain that sends no action (wait counts) for this long is replaced by the default brain */
  remoteSilenceMs: 20_000,
  /** how long a say waits for its enclave signature before it is dropped */
  signatureWaitMs: 20_000,
} as const;

// ---------- remote brain wire format (WebSocket /bot/ws, JSON text frames) ----------

export type RemoteIn =
  | { type: 'hello'; token: string; protocol?: string }
  | { type: 'action'; chatId: string; action: BrainAction }
  | { type: 'ping' };

export type RemoteOut =
  | {
      type: 'welcome'; protocol: string; botmaster: string; personas: string[]; steerVersion: string; intents: readonly string[]; topics: readonly string[];
      limits: typeof LIMITS;
      /** send some action (wait counts) at least this often per chat, or the default brain takes over */
      silenceMs: number;
    }
  | { type: 'event'; chatId: string; personaId: string; event: BrainEvent }
  | { type: 'error'; code: string; message: string; chatId?: string }
  | { type: 'pong' };
