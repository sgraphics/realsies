// The REALSIES pixel logo: chunky gold letters with a highlight, a red 3D extrusion, a plum outline and
// a drop shadow, a spinning-coin glyph at the left (as in the owner's mockup). Letters bob 1 px in a wave.

import { type Rgba, createBuffer, get, px } from '../core/buffer.ts';
import { PAL, type Color, TRANSPARENT } from '../core/palette.ts';

const GLYPHS: Record<string, string[]> = {
  R: [
    '#########.',
    '##########',
    '###....###',
    '###....###',
    '###....###',
    '###...####',
    '#########.',
    '########..',
    '###.####..',
    '###..####.',
    '###...###.',
    '###...####',
    '###....###',
    '###....###',
  ],
  E: [
    '#########',
    '#########',
    '###......',
    '###......',
    '###......',
    '########.',
    '########.',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '#########',
    '#########',
  ],
  A: [
    '...####...',
    '..######..',
    '.###..###.',
    '.###..###.',
    '###....###',
    '###....###',
    '###....###',
    '##########',
    '##########',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
  ],
  L: [
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '###......',
    '#########',
    '#########',
  ],
  S: [
    '..#######.',
    '.#########',
    '###....###',
    '###.......',
    '####......',
    '.#######..',
    '..#######.',
    '......####',
    '.......###',
    '.......###',
    '###....###',
    '##########',
    '.########.',
    '..######..',
  ],
  I: ['####', '####', '####', '####', '####', '####', '####', '####', '####', '####', '####', '####', '####', '####'],
};

const WORD = 'REALSIES';
const GAP = 2; // between letter fills (outlines touch)
const COIN = 16;
const GH = 14; // glyph fill height

// fill gradient top -> bottom
const FILL_ROWS: Color[] = [
  PAL.yellow, PAL.yellow, PAL.yellow, PAL.yellow, PAL.yellow, PAL.gold, PAL.gold, PAL.gold, PAL.gold, PAL.gold, PAL.orange, PAL.orange, PAL.orange, PAL.orange,
];

function wordWidth(): number {
  let w = 0;
  for (const ch of WORD) w += GLYPHS[ch][0].length + GAP;
  return w - GAP;
}

/** Logo size in game pixels at scale 1 (includes outline, extrusion, shadow and 1 px of bob room). */
export const LOGO_W = 2 + COIN + 4 + wordWidth() + 4;
export const LOGO_H = 1 + GH + 2 + 2 + 2 + 1;

let base: Rgba | null = null;
const letterOffsets: { x: number; w: number }[] = [];

/** Build the letter mask layer by layer: shadow, extrusion, outline, fill, highlight. */
function letterSprite(ch: string): Rgba {
  const g = GLYPHS[ch];
  const gw = g[0].length;
  const out = createBuffer(gw + 5, GH + 6);
  const isFill = (x: number, y: number) => y >= 0 && y < GH && x >= 0 && x < gw && g[y][x] === '#';
  const ox = 1, oy = 1;
  // 1) drop shadow + extrusion: fill shifted down 1..2, then outline of everything
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < gw; x++) {
      if (!isFill(x, y)) continue;
      px(out, ox + x + 1, oy + y + 3, PAL.plum); // shadow
      px(out, ox + x, oy + y + 2, PAL.redDark); // extrusion
      px(out, ox + x, oy + y + 1, PAL.red);
    }
  // 2) outline around fill + extrusion union
  const solid = (x: number, y: number) => {
    const c = get(out, x, y);
    return c !== TRANSPARENT && c !== PAL.plum;
  };
  const add: [number, number][] = [];
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push([x, y]);
    }
  // fill outline also around the top glyph itself
  for (let y = -1; y <= GH; y++)
    for (let x = -1; x <= gw; x++) {
      if (isFill(x, y)) continue;
      if (isFill(x - 1, y) || isFill(x + 1, y) || isFill(x, y - 1) || isFill(x, y + 1)) add.push([ox + x, oy + y]);
    }
  for (const [x, y] of add) px(out, x, y, PAL.plum);
  // 3) the face
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < gw; x++) {
      if (!isFill(x, y)) continue;
      let c = FILL_ROWS[y];
      // bevel: top-left edge highlight, bottom-right inner edge shade
      const top = !isFill(x, y - 1), left = !isFill(x - 1, y), right = !isFill(x + 1, y), bottom = !isFill(x, y + 1);
      if ((top || left) && y < 9) c = PAL.white;
      else if (top || left) c = PAL.yellow;
      else if ((right || bottom) && y > 8) c = PAL.rust;
      else if (right || bottom) c = PAL.orange;
      px(out, ox + x, oy + y, c);
    }
  // sparkle on the first letter rows
  return out;
}

const coinFrames: Rgba[] = [];
function coinSprite(f: number): Rgba {
  // a coin that turns: widths 14, 10, 4, 10
  const widths = [14, 12, 8, 4, 8, 12];
  const w = widths[f % widths.length];
  const out = createBuffer(COIN + 2, COIN + 4);
  const cx = (COIN + 2) / 2, cy = 1 + COIN / 2;
  const rx = w / 2, ry = 7;
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const nx = (x + 0.5 - cx) / Math.max(0.5, rx), ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      let c: Color = PAL.gold;
      if (d > 0.62) c = nx < 0 && ny < 0.3 ? PAL.yellow : PAL.orange; // rim
      else if (nx < -0.25 && ny < -0.1) c = PAL.yellow;
      else if (nx > 0.3 || ny > 0.45) c = PAL.orange;
      px(out, x, y, c);
    }
  // emboss: a little "R" bar when facing
  if (w >= 12) {
    for (let y = -3; y <= 3; y++) px(out, Math.floor(cx) - 1, Math.floor(cy) + y, PAL.clay);
    for (let x = 0; x < 3; x++) px(out, Math.floor(cx) + x - 1, Math.floor(cy) - 3, PAL.clay);
    px(out, Math.floor(cx) + 2, Math.floor(cy) - 2, PAL.clay);
    px(out, Math.floor(cx) + 1, Math.floor(cy) - 1, PAL.clay);
    px(out, Math.floor(cx) + 1, Math.floor(cy) + 1, PAL.clay);
    px(out, Math.floor(cx) + 2, Math.floor(cy) + 2, PAL.clay);
    px(out, Math.floor(cx) + 2, Math.floor(cy) + 3, PAL.clay);
    px(out, Math.floor(cx) - 2, Math.floor(cy) - 3, PAL.white);
    px(out, Math.floor(cx) - 4, Math.floor(cy) - 2, PAL.white);
  } else if (w >= 8) {
    for (let y = -3; y <= 3; y++) px(out, Math.floor(cx), Math.floor(cy) + y, PAL.clay);
  }
  // outline + shadow
  const add: [number, number, Color][] = [];
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      if (get(out, x, y) !== TRANSPARENT) continue;
      const n = get(out, x - 1, y) !== TRANSPARENT || get(out, x + 1, y) !== TRANSPARENT || get(out, x, y - 1) !== TRANSPARENT || get(out, x, y + 1) !== TRANSPARENT;
      if (n) add.push([x, y, PAL.brown]);
    }
  for (const [x, y, c] of add) px(out, x, y, c);
  const sh: [number, number][] = [];
  for (let y = 0; y < out.h - 1; y++)
    for (let x = 0; x < out.w - 1; x++) if (get(out, x, y) !== TRANSPARENT && get(out, x + 1, y + 1) === TRANSPARENT) sh.push([x + 1, y + 1]);
  for (const [x, y] of sh) px(out, x, y, PAL.plum);
  return out;
}

const letters: Rgba[] = [];
function ensure(): void {
  if (base) return;
  base = createBuffer(1, 1);
  let x = 2 + COIN + 4;
  for (const ch of WORD) {
    const s = letterSprite(ch);
    letters.push(s);
    letterOffsets.push({ x, w: GLYPHS[ch][0].length });
    x += GLYPHS[ch][0].length + GAP;
  }
  for (let f = 0; f < 6; f++) coinFrames.push(coinSprite(f));
}

function blitA(dst: Rgba, src: Rgba, x: number, y: number, k: number): void {
  for (let sy = 0; sy < src.h; sy++)
    for (let sx = 0; sx < src.w; sx++) {
      const c = get(src, sx, sy);
      if (c === TRANSPARENT) continue;
      for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) px(dst, x + sx * k + xx, y + sy * k + yy, c);
    }
}

/**
 * Draw the logo with its top-left at (x, y). `now` animates the letter wave and the coin turn;
 * pass a constant (e.g. 0) to freeze it. `scale` is an integer upscale for big standalone uses.
 */
export function drawLogo(dst: Rgba, x: number, y: number, now: number, scale = 1, frozen = false): void {
  ensure();
  const k = Math.max(1, scale | 0);
  // coin: turns every few seconds, rests facing most of the time
  const cyc = frozen ? 0 : now % 4200;
  const f = cyc < 3000 ? 0 : Math.min(5, Math.floor((cyc - 3000) / 200) + 1) % 6;
  const coinBob = frozen ? 0 : Math.round(Math.sin(now / 520)) > 0 ? -1 : 0;
  blitA(dst, coinFrames[f], x, y + (2 + coinBob) * k, k);
  for (let i = 0; i < letters.length; i++) {
    // a travelling wave: one or two letters lifted at a time
    const ph = frozen ? 0 : Math.sin(now / 260 - i * 0.75);
    const dy = ph > 0.72 ? -1 : 0;
    blitA(dst, letters[i], x + (letterOffsets[i].x - 1) * k, y + (1 + dy) * k, k);
  }
  // twinkle on the letters every so often
  if (!frozen) {
    const t = Math.floor(now / 140) % 40;
    if (t < 4) {
      const li = Math.floor(now / 5600) % letters.length;
      const sx = x + (letterOffsets[li].x + 1) * k, sy = y + 3 * k;
      const star: [number, number][] = t === 1 || t === 2 ? [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] : [[0, 0]];
      for (const [dx, dy] of star) for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) px(dst, sx + dx * k + xx, sy + dy * k + yy, PAL.white);
    }
  }
}
