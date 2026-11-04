// lookFromSeed: deterministic choice of every part, ramp and animation parameter from a 64-hex seed.

import { RAMPS, type RampName, SKIN_RAMPS, HAIR_RAMPS_NATURAL, HAIR_RAMPS_FUN, CLOTH_RAMPS, luminance } from '../core/palette.ts';
import { rngFrom, type Rng } from '../core/rng.ts';
import { BUILDS, type Build, TORSOS, LEGS, FEET } from './parts/body.ts';
import { HEADS, EYES, MOUTHS, NOSES, type Nose, type Cheeks } from './parts/head.ts';
import { HAIRS } from './parts/hair.ts';
import { HATS } from './parts/hats.ts';
import { BACKS, FRONTS, DECALS } from './parts/items.ts';

export interface LookRamps {
  skin: RampName;
  hair: RampName;
  top: RampName;
  top2: RampName;
  accent: RampName;
  bottom: RampName;
  bottom2: RampName;
  shoes: RampName;
  hat: RampName;
  hat2: RampName;
  back: RampName;
  back2: RampName;
  item: RampName;
  glasses: RampName;
  blush: RampName;
}

export interface AnimParams {
  tickMs: number; // one animation tick (about 6 fps)
  phaseMs: number; // per-character offset so ten characters never move in lockstep
  bobTicks: number; // ticks per bob cycle (half up, half down)
  armCycles: number; // bob cycles between hand sway changes
  blinkSlotMs: number; // one blink per slot, at a random offset
  lookSlotMs: number; // one possible glance per slot
  glanceChance: number;
  wiggleTicks: number; // accessory frame length
  talkBias: number; // how chatty the mouth looks while talking
}

export interface Look {
  seed: string;
  build: Build;
  head: number;
  nose: Nose;
  cheeks: Cheeks;
  eyes: number;
  mouth: number;
  hair: number;
  hat: number; // -1 none
  torso: number;
  legs: number;
  feet: number;
  back: number; // -1 none
  front: number; // -1 none
  decal: number; // -1 none
  decalNum: number;
  gloves: boolean;
  ramps: LookRamps;
  anim: AnimParams;
}

const PANTS: RampName[] = ['navy', 'royal', 'sky', 'black', 'charcoal', 'brown', 'chocolate', 'khaki', 'grey', 'forest', 'crimson', 'purple', 'cream', 'green', 'rust'];
const SHOES: RampName[] = ['brown', 'chocolate', 'black', 'white', 'red', 'navy', 'crimson', 'grey', 'royal', 'gold', 'cream'];
const ACCENTS: RampName[] = ['gold', 'red', 'lemon', 'lime', 'sky', 'hotpink', 'white', 'orange', 'teal', 'magenta'];
const ITEM_RAMPS: Record<string, RampName[]> = {
  mug: ['white', 'red', 'sky', 'gold', 'lime', 'magenta'],
  book: ['crimson', 'royal', 'green', 'purple', 'rust', 'navy'],
  balloon: ['red', 'sky', 'hotpink', 'lime', 'gold', 'magenta'],
  flower: ['red', 'hotpink', 'gold', 'magenta', 'white', 'sky'],
  icecream: ['hotpink', 'cream', 'chocolate', 'lime', 'sky'],
  wand: ['brown', 'chocolate', 'purple'],
};
const BACK_RAMPS: Record<string, RampName[]> = {
  cape: ['red', 'crimson', 'purple', 'royal', 'forest', 'gold', 'navy'],
  backpack: ['orange', 'red', 'forest', 'navy', 'sky', 'gold', 'magenta', 'lime'],
  tail: ['rust', 'orange', 'brown', 'grey', 'chocolate', 'cream'],
  wings: ['white', 'sky', 'cream', 'magenta', 'lime', 'hotpink'],
};

function contrastPick(r: Rng, from: readonly RampName[], against: RampName[], minDelta = 45): RampName {
  const ok = from.filter((n) => !against.includes(n) && against.every((a) => Math.abs(luminance(RAMPS[n][1]) - luminance(RAMPS[a][1])) >= minDelta));
  return r.pick(ok.length ? ok : from.filter((n) => !against.includes(n)));
}
function pickNot(r: Rng, from: readonly RampName[], not: RampName[]): RampName {
  const ok = from.filter((n) => !not.includes(n));
  return r.pick(ok.length ? ok : from);
}

const DECAL_TORSOS = new Set(['tee', 'hoodie', 'sweater', 'tank', 'tunic']);
const SMALL_HATS = new Set(['party', 'fez', 'antenna', 'bunny', 'catears']);
// everyday hats more often, costume pieces now and then
const HAT_WEIGHT: Record<string, number> = {
  cap: 2.2, beanie: 2, headband: 1.4, headphones: 1.6, beret: 1.2, cowboy: 1, bandana: 1.2, tophat: 0.9, flowers: 1,
  wizard: 0.7, crown: 0.5, helmet: 0.6, propeller: 0.7, party: 0.7, viking: 0.6, fez: 0.6, chef: 0.6, antenna: 0.6,
  bunny: 0.5, catears: 0.8, nemes: 0.35, bubble: 0.4, tricorn: 0.5,
};

export function lookFromSeed(seed: string): Look {
  const r = rngFrom('look:' + seed);
  const build = r.weighted(BUILDS, [3, 5, 3]);
  const head = r.int(HEADS.length);
  const nose = r.weighted(NOSES, [5, 3, 2, 2]);
  const cheeks: Cheeks = r.weighted(['none', 'blush', 'freckles'] as Cheeks[], [6, 3, 1.4]);
  // eyes: plain most of the time, glasses or shades now and then
  const plainEyes = EYES.map((e, i) => ({ e, i })).filter((x) => !x.e.glasses).map((x) => x.i);
  const glassEyes = EYES.map((e, i) => ({ e, i })).filter((x) => x.e.glasses).map((x) => x.i);
  const eyes = r.chance(0.14) ? r.pick(glassEyes) : r.pick(plainEyes);
  const hairStyle = r.int(HAIRS.length);
  const facial = MOUTHS.map((m, i) => ({ m, i })).filter((x) => x.m.hair).map((x) => x.i);
  const plainMouths = MOUTHS.map((m, i) => ({ m, i })).filter((x) => !x.m.hair).map((x) => x.i);
  const mouth = r.chance(0.12) ? r.pick(facial) : r.pick(plainMouths);
  const tall = !!HAIRS[hairStyle].tall;
  let hat = -1;
  if (r.chance(0.56)) {
    const choices = HATS.map((h, i) => ({ h, i })).filter((x) => !(tall && SMALL_HATS.has(x.h.id)));
    hat = r.weighted(choices.map((c) => c.i), choices.map((c) => HAT_WEIGHT[c.h.id] ?? 1));
  }
  const torso = r.int(TORSOS.length);
  const legs = r.weighted(LEGS.map((_, i) => i), [5, 3, 4, 2, 1, 2]);
  const feet = r.int(FEET.length);
  const back = r.chance(0.24) ? r.int(BACKS.length) : -1;
  const front = r.chance(0.32) ? r.int(FRONTS.length) : -1;
  const decal = DECAL_TORSOS.has(TORSOS[torso].id) && r.chance(0.55) ? r.int(DECALS.length) : -1;

  const skin = r.pick(SKIN_RAMPS);
  let hairRamp: RampName = r.chance(0.78) ? r.weighted(HAIR_RAMPS_NATURAL, [5, 5, 4, 2, 3, 1, 1.2, 1]) : r.pick(HAIR_RAMPS_FUN);
  // hair must read against the face: re-pick when its base tone is too close to the skin's
  const skinLum = luminance(RAMPS[skin][1]);
  if (Math.abs(luminance(RAMPS[hairRamp][1]) - skinLum) < 34) {
    const ok = [...HAIR_RAMPS_NATURAL, ...HAIR_RAMPS_FUN].filter((h) => Math.abs(luminance(RAMPS[h][1]) - skinLum) >= 34);
    hairRamp = r.pick(ok);
  }
  const top = pickNot(r, CLOTH_RAMPS, [skin]);
  const top2 = contrastPick(r, CLOTH_RAMPS, [top], 40);
  const accent = contrastPick(r, ACCENTS, [top], 35);
  let bottom = contrastPick(r, PANTS, [top], 30);
  const bottom2 = pickNot(r, CLOTH_RAMPS, [bottom]);
  const shoes = pickNot(r, SHOES, [bottom]);
  const hatR = pickNot(r, CLOTH_RAMPS, [hairRamp]);
  const hat2 = contrastPick(r, CLOTH_RAMPS, [hatR], 35);
  const backId = back >= 0 ? BACKS[back].id : '';
  const backRamp = BACKS[back]?.ramp as RampName | undefined;
  const backR: RampName = backRamp ?? (BACK_RAMPS[backId] ? r.pick(BACK_RAMPS[backId]) : r.pick(CLOTH_RAMPS));
  const back2 = pickNot(r, CLOTH_RAMPS, [backR]);
  const frontId = front >= 0 ? FRONTS[front].id : '';
  const itemR: RampName = (FRONTS[front]?.ramp as RampName | undefined) ?? (ITEM_RAMPS[frontId] ? r.pick(ITEM_RAMPS[frontId]) : backId === 'wings' ? backR : r.pick(CLOTH_RAMPS));
  const glasses = r.pick(['black', 'chocolate', 'red', 'royal', 'gold', 'purple'] as RampName[]);
  if (TORSOS[torso].id === 'overalls') bottom = contrastPick(r, ['sky', 'royal', 'red', 'forest', 'brown', 'navy', 'purple'], [top], 25);

  const a = rngFrom('anim:' + seed);
  const anim: AnimParams = {
    tickMs: a.range(150, 195),
    phaseMs: a.range(0, 20000),
    bobTicks: a.weighted([6, 8], [3, 2]),
    armCycles: a.range(2, 3),
    blinkSlotMs: a.range(3200, 5200),
    lookSlotMs: a.range(2600, 4600),
    glanceChance: a.float(0.45, 0.75),
    wiggleTicks: 3,
    talkBias: a.float(0.45, 0.65),
  };

  return {
    seed, build, head, nose, cheeks, eyes, mouth, hair: hairStyle, hat, torso, legs, feet, back, front, decal,
    decalNum: r.range(0, 99),
    gloves: r.chance(0.08),
    ramps: {
      skin, hair: hairRamp, top, top2, accent, bottom, bottom2, shoes, hat: hatR, hat2, back: backR, back2, item: itemR, glasses,
      blush: r.pick(['hotpink', 'red', 'magenta'] as RampName[]),
    },
    anim,
  };
}

/** Human-readable summary (QA sheets, debugging). */
export function describeLook(l: Look): string {
  return [
    l.build, HEADS[l.head].id, EYES[l.eyes].id, MOUTHS[l.mouth].id, HAIRS[l.hair].id, l.hat >= 0 ? HATS[l.hat].id : '-',
    TORSOS[l.torso].id, LEGS[l.legs].id, FEET[l.feet].id, l.back >= 0 ? BACKS[l.back].id : '-', l.front >= 0 ? FRONTS[l.front].id : '-',
    l.decal >= 0 ? DECALS[l.decal].id : '-',
  ].join(' ');
}
