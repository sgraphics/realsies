// Character QA sheets: 40 random characters, part catalogues, animation frames.
import type { SheetOut } from '../sheets.ts';
import { createBuffer, clear, blit, scaleUp, rect, type Rgba, vGradient } from '../../src/core/buffer.ts';
import { PAL } from '../../src/core/palette.ts';
import { rngFrom, randomSeed } from '../../src/core/rng.ts';
import { drawText } from '../../src/core/font.ts';
import { Rig, CHAR_W, CHAR_H } from '../../src/rig/rig.ts';
import { lookFromSeed, type Look } from '../../src/rig/look.ts';
import { HAIRS } from '../../src/rig/parts/hair.ts';
import { HATS } from '../../src/rig/parts/hats.ts';
import { EYES, MOUTHS, HEADS } from '../../src/rig/parts/head.ts';
import { TORSOS, LEGS, FEET } from '../../src/rig/parts/body.ts';
import { BACKS, FRONTS, DECALS } from '../../src/rig/parts/items.ts';

const BG = PAL.navy;
const FLOOR = PAL.slate;

function cell(img: Rgba, rig: Rig, x: number, y: number, now: number): void {
  // floor strip so the cast shadow shows
  rect(img, x, y + 42, CHAR_W, 6, FLOOR);
  rig.draw(img, x, y, now);
}

function grid(seeds: string[], cols: number, now = 0, label?: (i: number) => string, looks?: Look[]): Rgba {
  const cw = CHAR_W + 6, ch = CHAR_H + (label ? 10 : 4);
  const rows = Math.ceil(seeds.length / cols);
  const img = createBuffer(cols * cw + 4, rows * ch + 4);
  clear(img, BG);
  seeds.forEach((s, i) => {
    const x = 4 + (i % cols) * cw, y = 4 + Math.floor(i / cols) * ch;
    const rig = new Rig(looks ? looks[i] : s);
    cell(img, rig, x, y, now);
    if (label) drawText(img, label(i).slice(0, 9), x, y + CHAR_H + 2, PAL.greyLight);
  });
  return img;
}

/** A look forced to show one variant of a slot. */
function variantLooks(base: string, n: number, set: (l: Look, i: number) => void): Look[] {
  return Array.from({ length: n }, (_, i) => {
    const l = lookFromSeed(base + i);
    l.hat = -1;
    l.back = -1;
    l.front = -1;
    set(l, i);
    return l;
  });
}

export async function sheetsCharacters(out: SheetOut): Promise<void> {
  const rng = rngFrom('characters-sheet');
  const seeds = Array.from({ length: 40 }, () => randomSeed(rng));
  out('characters-40', scaleUp(grid(seeds, 10), 3));

  // a second batch, to judge variety
  const rng2 = rngFrom('characters-sheet-2');
  out('characters-40b', scaleUp(grid(Array.from({ length: 40 }, () => randomSeed(rng2)), 10), 3));

  // part catalogues (same body, one slot varied)
  const base = 'a7c3e1f0b2d4968574a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1';
  const cat = (name: string, n: number, set: (l: Look, i: number) => void, label: (i: number) => string) => {
    const looks = variantLooks(base, n, set);
    out('parts-' + name, scaleUp(grid(looks.map((l) => l.seed + name), Math.min(n, 12), 0, label, looks), 3));
  };
  cat('hair', HAIRS.length, (l, i) => { l.hair = i; }, (i) => HAIRS[i].id);
  cat('hats', HATS.length, (l, i) => { l.hat = i; l.hair = 0; }, (i) => HATS[i].id);
  cat('eyes', EYES.length, (l, i) => { l.eyes = i; }, (i) => EYES[i].id);
  cat('mouths', MOUTHS.length, (l, i) => { l.mouth = i; }, (i) => MOUTHS[i].id);
  cat('heads', HEADS.length, (l, i) => { l.head = i; l.hair = HAIRS.findIndex((h) => h.id === 'bald'); }, (i) => HEADS[i].id);
  cat('torsos', TORSOS.length, (l, i) => { l.torso = i; l.decal = -1; }, (i) => TORSOS[i].id);
  cat('legs', LEGS.length * 2, (l, i) => { l.legs = i >> 1; l.torso = 0; }, (i) => LEGS[i >> 1].id);
  cat('feet', FEET.length, (l, i) => { l.feet = i; }, (i) => FEET[i].id);
  cat('backs', BACKS.length, (l, i) => { l.back = i; }, (i) => BACKS[i].id);
  cat('fronts', FRONTS.length, (l, i) => { l.front = i; }, (i) => FRONTS[i].id);
  cat('decals', DECALS.length, (l, i) => { l.decal = i; l.torso = 0; }, (i) => DECALS[i].id);
  cat('skins', 10, (l, i) => { l.ramps.skin = (['skin1', 'skin2', 'skin3', 'skin4', 'skin5'] as const)[i % 5]; l.build = (['slim', 'regular', 'broad'] as const)[i % 3]; }, (i) => 'skin' + ((i % 5) + 1));

  // animation strip: 6 characters x 24 frames at 1/6 s
  const animSeeds = seeds.slice(0, 6);
  const frames = 24;
  const img = createBuffer(frames * (CHAR_W + 2) + 2, animSeeds.length * (CHAR_H + 2) + 2);
  clear(img, BG);
  animSeeds.forEach((s, r) => {
    const rig = new Rig(s);
    if (r === 1) rig.setTalking(true);
    if (r === 2) rig.lookToward(1);
    for (let f = 0; f < frames; f++) {
      const now = f * 170;
      if (r === 3 && f === 2) rig.react('jump', now);
      if (r === 4 && f === 2) rig.react('wave', now);
      if (r === 5 && f === 2) rig.react('nod', now);
      if (r === 5 && f === 12) rig.react('shrug', now);
      cell(img, rig, 2 + f * (CHAR_W + 2), 2 + r * (CHAR_H + 2), now);
    }
  });
  out('anim-frames', scaleUp(img, 3));

  // big close-ups for face readability (at 3x and 6x)
  const close = createBuffer(8 * (CHAR_W + 4), CHAR_H + 4);
  vGradient(close, 0, 0, close.w, close.h, [PAL.navyDark, PAL.navy]);
  seeds.slice(10, 18).forEach((s, i) => cell(close, new Rig(s), 2 + i * (CHAR_W + 4), 2, 0));
  out('closeup-6x', scaleUp(close, 6));
  void blit;
}
