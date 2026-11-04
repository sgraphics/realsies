// Reader rating and the free player's "would have won", per docs/spec.md section 4.

export const RATING_START = 1000;
export const RATING_FLOOR = 100;
export const K = 32;

export interface PaidCallWeight {
  coins: number;
  right: boolean; // a missed paid call counts as wrong
}

/** Coin-weighted share of a character's paid calls that were right; 0.5 when it has none. */
export function pRight(paid: PaidCallWeight[]): number {
  let total = 0;
  let right = 0;
  for (const c of paid) {
    total += c.coins;
    if (c.right) right += c.coins;
  }
  return total > 0 ? right / total : 0.5;
}

export function ratingDelta(right: boolean, p: number): number {
  return right ? Math.round(K * (1 - p)) : -Math.round(K * p);
}

export function applyRating(rating: number, delta: number): number {
  return Math.max(RATING_FLOOR, rating + delta);
}

/**
 * A free call judged as if the player had played the level's lowest preset at the margin.
 * W and R are the character's wrong and right paid coins (locked, in coins).
 */
export function wouldHaveCoins(presetLow: number, W: number, R: number, right: boolean): number {
  if (!right) return -presetLow;
  if (W <= 0) return 0;
  return (presetLow * 0.7 * W) / (R + presetLow);
}

export interface Stats {
  chats: number;
  right: number;
  wrong: number;
  streak: number;
  bestStreak: number;
}

export function applyOutcome(s: Stats, right: boolean): Stats {
  const streak = right ? s.streak + 1 : 0;
  return {
    chats: s.chats,
    right: s.right + (right ? 1 : 0),
    wrong: s.wrong + (right ? 0 : 1),
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
  };
}
