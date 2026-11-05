// A round's demo cast: who the bots are and where they are from.
//
// Every round has CAST_SIZE demo characters (default 39), spread evenly over the three levels. Each
// character's country is drawn from COUNTRY_WEIGHTS (proportional to a Western player base: the US about a
// third, the UK 12%, ...). The character is then a hand-written persona from that country (relay/personas,
// at one of its levels, at most once a round) half the time when one is free, otherwise a person generated
// for that country from the round's castSeed. Whoever fills a slot, its country was drawn first, so the cast
// follows the weights in expectation. The same seed and personas folder give the same cast.
import type { Level } from '../../../shared/protocol.js';
import { chance, createRng, pickR } from '../bot/rng.js';
import { atRound, fromGenerated, type Persona } from '../personas.js';
import { COUNTRY_WEIGHTS } from './data.js';
import { generatePersona } from './generate.js';
import { pickW } from './model.js';

/** Chance that a slot is played by a free hand-written persona of its country rather than a generated one. */
export const HAND_SHARE = 0.5;

export interface CastSlot {
  index: number;
  level: Level;
  /** a COUNTRY_WEIGHTS key */
  country: string;
  /** the hand-written persona playing it; generated when absent */
  hand?: string;
}

export interface HandRef {
  id: string;
  country: string;
  levels: readonly Level[];
}

/**
 * The slots of a cast: levels 1, 2, 3, 1, ..., a country from the weights for each, a hand-written persona
 * where one of that country is free at that level (HAND_SHARE of the time). `pins` (tests and smoke runs
 * only) force hand-written personas in, each taking a generated slot at one of its levels.
 */
export function planCast(seed: string, size: number, hand: readonly HandRef[], pins: readonly string[] = []): CastSlot[] {
  const rng = createRng(`cast|${seed}`);
  const countries = Object.entries(COUNTRY_WEIGHTS);
  const used = new Set<string>();
  const slots: CastSlot[] = [];
  for (let i = 0; i < size; i++) {
    const level = ((i % 3) + 1) as Level;
    const country = pickW(rng, countries);
    const free = hand.filter((h) => h.country === country && h.levels.includes(level) && !used.has(h.id));
    const take = free.length && chance(rng, HAND_SHARE) ? pickR(rng, free) : undefined;
    if (take) used.add(take.id);
    slots.push({ index: i, level, country, hand: take?.id });
  }
  for (const id of pins) {
    const h = hand.find((x) => x.id === id);
    if (!h || used.has(id)) continue;
    used.add(id);
    const s = slots.find((x) => !x.hand && h.levels.includes(x.level));
    if (s) Object.assign(s, { hand: id, country: h.country });
    else slots.push({ index: slots.length, level: h.levels[0], country: h.country, hand: id });
  }
  return slots;
}

/** The personas of a cast, prompts composed for the round's start `at`; each serves the one level of its slot. */
export function buildCast(o: { seed: string; size: number; at: number; hand: readonly Persona[]; pins?: readonly string[] }): Persona[] {
  const hand = o.hand.filter((p) => p.person);
  const byId = new Map(hand.map((p) => [p.id, p]));
  const slots = planCast(o.seed, o.size, hand.map((p) => ({ id: p.id, country: p.person!.home.country, levels: p.levels })), o.pins);
  // generated people never share a first name with anyone else in the round
  const avoid = new Set<string>();
  for (const s of slots) {
    const p = s.hand ? byId.get(s.hand)?.person : undefined;
    if (p) for (const n of [p.name, p.nickname]) if (n) avoid.add(n.toLowerCase());
  }
  return slots.map((s) =>
    s.hand
      ? atRound({ ...byId.get(s.hand)!, levels: [s.level] }, o.at)
      : fromGenerated(generatePersona(o.seed, s.index, { at: o.at, avoidNames: avoid, country: s.country }), s.level, o.at),
  );
}
