// The full-screen countdown before every chat (protocol v1.1): chat_started may carry a startedAt in
// the future; the relay refuses `say` before it (chat_not_started), so the input stays shut and
// nobody is expected to speak first. These rules are pure so the store and the tests share them.

/** Default countdown length when the relay's config does not say (PublicConfig.countdownSeconds). */
export const COUNTDOWN_DEFAULT_S = 3;
/** How much longer than the configured countdown a remaining time may be before it counts as skew. */
export const COUNTDOWN_SLACK_MS = 1000;
/** How long the CHAT! frame stays up after the input opens. */
export const GO_MS = 760;
/** The same, calm version (prefers-reduced-motion). */
export const GO_MS_CALM = 600;

export interface CountdownPlan {
  /** Client-clock ms when the input opens. */
  until: number;
  /** Countdown length from now, ms. */
  ms: number;
  /** Client minus relay time for this chat's clocks: 0 unless the countdown was clamped. */
  shift: number;
}

/**
 * When the input opens, by the client clock: exactly at startedAt; but when the remaining time is
 * negative or implausibly long (a skewed client clock, a late message), the configured countdown
 * from now instead. `late: 'none'` skips the clamp for a start in the past (a reconnect mid-chat).
 */
export function countdownFor(startedAt: number, now: number, seconds: number | undefined = COUNTDOWN_DEFAULT_S, late: 'clamp' | 'none' = 'clamp'): CountdownPlan | null {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.min(9, seconds as number)) : COUNTDOWN_DEFAULT_S;
  const nominal = Math.round(s * 1000);
  const left = startedAt - now;
  if (left > 0 && left <= nominal + COUNTDOWN_SLACK_MS) return { until: startedAt, ms: left, shift: 0 };
  if (left <= 0 && late === 'none') return null;
  if (nominal <= 0) return null;
  return { until: now + nominal, ms: nominal, shift: now + nominal - startedAt };
}

export interface CountingChat {
  counting?: boolean;
  countdownUntil?: number;
}

/** True while the countdown runs (also when a throttled timer has not flipped `counting` yet). */
export function isCounting(c: CountingChat | null | undefined, now: number = Date.now()): boolean {
  return !!c?.counting && now < (c.countdownUntil ?? 0);
}

/** The beat on screen: seconds left (3, 2, 1 ...), 0 for CHAT!, null once the overlay is gone. */
export function beatAt(until: number, now: number, goMs = GO_MS): number | null {
  const left = until - now;
  if (left <= -goMs) return null;
  if (left <= 0) return 0;
  return Math.min(9, Math.ceil(left / 1000));
}

/** Ms until the beat changes (next whole second, CHAT!, or the end of CHAT!). */
export function msToNextBeat(until: number, now: number, goMs = GO_MS): number {
  const left = until - now;
  if (left <= 0) return Math.max(0, left + goMs);
  const frac = left % 1000;
  return frac === 0 ? 1000 : frac;
}
