// Human timing: phone typing at 4 to 6 characters a second with jitter, reading and reaction
// pauses scaled to the partner's message, hesitations, gaps between bubbles. Brain milliseconds.
import { LIMITS } from './api.js';
import { chance, lerp, uniformR, type Rng } from './rng.js';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const charsOf = (s: string) => [...s].length;

/** Clamp a typing speed to the relay's bounds. */
export const clampCps = (cps: number) => clamp(Number.isFinite(cps) ? cps : 5, LIMITS.minCps, LIMITS.maxCps);

/** The fastest any bubble may appear after its typing starts: LIMITS.maxCps, never under minBubbleMs. */
export function minTypingMs(text: string): number {
  return Math.max(LIMITS.minBubbleMs, (charsOf(text) / LIMITS.maxCps) * 1000);
}

/** Time to thumb-type `text` at about `cps` characters a second, with jitter, within the relay's bounds. */
export function typeMs(text: string, cps: number, rng: Rng): number {
  const base = (charsOf(text) / clampCps(cps)) * 1000 * uniformR(rng, 0.9, 1.12);
  const floor = minTypingMs(text);
  return Math.max(floor, Math.min(base, LIMITS.maxTypingMs));
}

/** Notice, read and react to a partner message: 0.6 to 1.5 s reaction plus 18 to 32 characters a second of reading. */
export function readMs(text: string, fast: number, rng: Rng): number {
  const reaction = uniformR(rng, 600, 1500) * lerp(1.4, 0.8, fast);
  return reaction + (charsOf(text) / uniformR(rng, 18, 32)) * 1000;
}

export interface BubbleSlot {
  /** typing indicator on from here */
  typingFrom: number;
  /** the bubble appears here */
  at: number;
  /** indicator drops for `ms` from `from` (a hesitation), then comes back */
  hesitation?: { from: number; ms: number };
}

export interface BubblePlanInput {
  bubbles: string[];
  cps: number;
  /** say started: typing indicator on since then */
  t0: number;
  /** completion back and its signature verified */
  ready: number;
  /** last bubble of the previous say, if any */
  prevShownAt: number | null;
  /** the chat ends here */
  endAt: number;
  minMs?: number;
  /** probability of one hesitation in a long first bubble */
  hesitateP: number;
  rng: Rng;
}

/**
 * When each bubble of one say appears. The first bubble lands when a person who started typing at t0
 * would have finished it (never before the completion and its signature are ready); later bubbles
 * follow with a short gap and their own typing time. Near the end of the chat the schedule tightens
 * toward the fastest allowed one (LIMITS.maxCps, minimum gaps) so every bubble lands in time; no
 * bubble ever types faster than that. Returns null when the say cannot land in full before the end.
 */
export function planBubbles(p: BubblePlanInput): BubbleSlot[] | null {
  const limit = p.endAt - 400;
  const minGap = 200;
  const tailMin = p.bubbles.slice(1).reduce((s, b) => s + minGap + minTypingMs(b), 0);
  const earliest = Math.max(p.t0 + minTypingMs(p.bubbles[0]), p.ready + 120, p.prevShownAt === null ? 0 : p.prevShownAt + LIMITS.minSayGapMs);
  const latest = limit - tailMin;
  if (earliest > latest) return null;
  const t1 = typeMs(p.bubbles[0], p.cps, p.rng);
  let at = p.t0 + Math.max(t1, Math.min(p.minMs ?? 0, LIMITS.maxTypingMs));
  let hesitation: BubbleSlot['hesitation'];
  if (t1 >= 3500 && chance(p.rng, p.hesitateP)) {
    const ms = uniformR(p.rng, 700, 1800);
    const from = Math.max(p.ready + 200, p.t0 + t1 * uniformR(p.rng, 0.3, 0.6));
    if (from + ms < at - 300) {
      hesitation = { from, ms };
      at += ms;
    }
  }
  at = Math.max(at, earliest);
  if (at > latest) {
    at = latest;
    hesitation = undefined;
  }
  const planned: BubbleSlot[] = [{ typingFrom: p.t0, at, hesitation }];
  const fastest: BubbleSlot[] = [{ typingFrom: p.t0, at }];
  for (let i = 1; i < p.bubbles.length; i++) {
    const gap = uniformR(p.rng, LIMITS.bubbleGapMs[0], LIMITS.bubbleGapMs[1]);
    const typingFrom = planned[i - 1].at + gap;
    planned.push({ typingFrom, at: typingFrom + typeMs(p.bubbles[i], p.cps, p.rng) });
    const fFrom = fastest[i - 1].at + minGap;
    fastest.push({ typingFrom: fFrom, at: fFrom + minTypingMs(p.bubbles[i]) });
  }
  const last = planned[planned.length - 1].at;
  if (planned.length === 1 || last <= limit) return planned;
  // blend toward the fastest schedule: every gap stays >= minGap and every bubble >= its minimum typing time
  const fLast = fastest[fastest.length - 1].at;
  const k = Math.max(0, Math.min(1, (limit - fLast) / (last - fLast)));
  return planned.map((s, i) =>
    i === 0 ? s : { typingFrom: fastest[i].typingFrom + k * (s.typingFrom - fastest[i].typingFrom), at: fastest[i].at + k * (s.at - fastest[i].at) },
  );
}
