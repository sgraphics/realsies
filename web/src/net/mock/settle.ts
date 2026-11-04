// Settlement and rating rules (spec sections 3 and 4), as pure functions over coins.

import type { Truth } from '../../../../shared/protocol.ts';
import { floor6 } from './util.ts';

export interface PlayIn {
  id: string;
  coins: number; // played, fee included
  locked: number; // coins after the 5% fee
  call: boolean | null; // true = human, false = bot, null = missed
}

export interface SettleOut {
  credited: Map<string, number>;
  W: number; // wrong locked coins
  R: number; // right locked coins
  character: number; // to the character's payout account
  house: number;
  /** Coin-weighted share of paid calls that were right; 0.5 when there were none. */
  p: number;
  /** Coin-weighted share of paid calls (made) that said human; null when none. */
  humanShare: number | null;
}

export const isRight = (call: boolean | null, truth: Truth): boolean | null => (call === null ? null : call === (truth === 'human'));

export function settleCharacter(plays: PlayIn[], truth: Truth): SettleOut {
  let W = 0, R = 0, saidHuman = 0, called = 0;
  for (const p of plays) {
    const r = isRight(p.call, truth);
    if (r) R += p.locked;
    else W += p.locked;
    if (p.call !== null) {
      called += p.locked;
      if (p.call) saidHuman += p.locked;
    }
  }
  const credited = new Map<string, number>();
  let character = 0, house = 0;
  if (W === 0) {
    for (const p of plays) credited.set(p.id, p.locked);
  } else if (R > 0) {
    let extra = 0;
    for (const p of plays) {
      if (isRight(p.call, truth)) {
        const bonus = floor6((0.7 * W * p.locked) / R);
        extra += bonus;
        credited.set(p.id, floor6(p.locked + bonus));
      } else credited.set(p.id, 0);
    }
    character = floor6(0.2 * W);
    house = floor6(W - extra - character);
  } else {
    for (const p of plays) credited.set(p.id, 0);
    character = floor6(0.9 * W);
    house = floor6(W - character);
  }
  return { credited, W, R, character, house, p: W + R > 0 ? R / (W + R) : 0.5, humanShare: called > 0 ? saidHuman / called : null };
}

/** Rating change for one call (spec: missed is wrong for paid, ignored for free). */
export function ratingDelta(right: boolean | null, p: number, paid: boolean): number {
  if (right === null) return paid ? -Math.round(32 * p) : 0;
  return right ? Math.round(32 * (1 - p)) : -Math.round(32 * p);
}

/** "Would have won" for a free call at the level's lowest preset. */
export function wouldHave(right: boolean | null, W: number, R: number, presetLow: number): number {
  if (right === null) return 0;
  if (!right) return -presetLow;
  return (presetLow * 0.7 * W) / (R + presetLow);
}

export function applyRating(rating: number, delta: number): number {
  return Math.max(100, rating + delta);
}
