// The chat timer: a braided fuse that burns from its far end toward a little bomb, with an
// animated spark, flying embers and a puff of smoke. Whole pixels, master palette only.

import type { Rgba } from '../core/buffer.ts';
import { px, get } from '../core/buffer.ts';
import { PAL, type Color, TRANSPARENT, lighter } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Point } from '../scene/types.ts';

/** Round bomb, 13x14, cap at the top right where the cord enters (cap tip at column 11, row 1). */
function bombPixel(i: number, j: number): string {
  // cap
  if (j <= 2 && i >= 8 && i <= 11) {
    if (j === 0) return i >= 9 && i <= 10 ? 'G' : '.';
    if (j === 1) return i === 8 || i === 11 ? 'g' : 'G';
    return i >= 8 && i <= 10 ? 'g' : '.';
  }
  const dx = i + 0.5 - 6, dy = j + 0.5 - 8.5;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 5.6) return '.';
  if (d < 2.2 && dx < -0.5 && dy < -0.5 && dx + dy < -2.2) return 'w';
  if (dx + dy > 3.2) return 'n';
  return 'k';
}
const BOMB: string[] = Array.from({ length: 14 }, (_, j) => Array.from({ length: 13 }, (_, i) => bombPixel(i, j)).join(''));

export function drawFuse(dst: Rgba, path: Point[], progress: number, now: number, rope: [Color, Color], frozen = false): void {
  if (!path.length) return;
  const p = Math.max(0, Math.min(1, progress));
  const n = path.length;
  const spark = Math.round((1 - p) * (n - 1));
  // rope from the spark to the bomb, with a shadow underneath
  for (let i = spark; i < n; i++) {
    const { x, y } = path[i];
    // dark casing above and below so the cord reads on light and dark frames alike
    px(dst, x, y - 1, PAL.plum);
    px(dst, x, y + 1, PAL.black);
    px(dst, x, y, ((i >> 1) & 1) === 0 ? rope[0] : rope[1]);
    if (i % 4 === 0) px(dst, x, y, PAL.brownLight); // braid twist
  }
  // ash where it already burnt (sparse dots)
  for (let i = 0; i < spark; i += 3) {
    const { x, y } = path[i];
    if (hash01(11, i) < 0.5) px(dst, x, y + 1, PAL.navy);
  }
  // bomb at the end
  const end = path[n - 1];
  const bx = end.x - 12, by = end.y - 1;
  const hot = p < 0.15 && !frozen && Math.floor(now / 160) % 2 === 0;
  const map: Record<string, Color> = { k: hot ? PAL.redDark : PAL.navy, w: PAL.white, g: PAL.slate, G: PAL.greyLight, n: PAL.navyDark };
  for (let j = 0; j < BOMB.length; j++)
    for (let i = 0; i < BOMB[j].length; i++) {
      const ch = BOMB[j][i];
      if (ch !== '.') px(dst, bx + i, by + j, map[ch]);
    }
  // outline the bomb
  for (let j = -1; j <= BOMB.length; j++)
    for (let i = -1; i <= 13; i++) {
      const inside = (jj: number, ii: number) => jj >= 0 && jj < BOMB.length && ii >= 0 && ii < 13 && BOMB[jj][ii] !== '.';
      if (inside(j, i)) continue;
      if (inside(j - 1, i) || inside(j + 1, i) || inside(j, i - 1) || inside(j, i + 1)) px(dst, bx + i, by + j, PAL.black);
    }
  if (p <= 0) return;
  // spark: a flickering star with embers
  const s = path[spark];
  const f = frozen ? 0 : Math.floor(now / 70) % 4;
  const core: Color = f % 2 ? PAL.white : PAL.yellow;
  px(dst, s.x, s.y, core);
  const arm = f === 0 ? 2 : f === 1 ? 1 : f === 2 ? 3 : 1;
  for (let a = 1; a <= arm; a++) {
    const c = a === 1 ? PAL.yellow : a === 2 ? PAL.gold : PAL.orange;
    px(dst, s.x - a, s.y, c);
    px(dst, s.x + a, s.y, c);
    px(dst, s.x, s.y - a, c);
    if (a < 3) px(dst, s.x, s.y + a, c);
  }
  if (f === 2) {
    px(dst, s.x - 1, s.y - 1, PAL.gold);
    px(dst, s.x + 1, s.y - 1, PAL.gold);
  }
  if (!frozen) {
    const tick = Math.floor(now / 90);
    for (let e = 0; e < 4; e++) {
      const age = (tick + e * 3) % 9;
      const seed = Math.floor((tick + e * 3) / 9) * 7 + e;
      const dx = Math.round((hash01(5, seed) - 0.5) * 2 * (1 + age));
      const dy = -Math.round(age * 0.8) + Math.round(age * age * 0.06);
      const c: Color = age < 3 ? PAL.yellow : age < 6 ? PAL.orange : PAL.rust;
      if (age < 8) px(dst, s.x + dx, s.y - 1 + dy, c);
    }
    // smoke wisp
    const sm = (tick >> 1) % 6;
    const sx = s.x + (sm % 2), sy = s.y - 4 - sm;
    const under = get(dst, sx, sy);
    if (under !== TRANSPARENT) px(dst, sx, sy, lighter(under, 1));
  }
}
