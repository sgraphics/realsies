// End card: the curved REALSIES logo drops onto a dark field with twinkling sparkles, the tagline
// types on, realsies.lol pops in under it. Also the poster.

import { type Rgba, createBuffer, px } from '../../src/core/buffer.ts';
import { type Color, PAL } from '../../src/core/palette.ts';
import { hash01 } from '../../src/core/rng.ts';
import { drawLogo, LOGO_W, LOGO_H } from '../../src/themes/logo.ts';
import { blitK, rectOut, OUT_W, OUT_H } from './camera.ts';
import { drawCentered, measure } from './font.ts';
import { CUE, LINES, beat, typedCount, lineShown } from './storyboard.ts';

const P = PAL;
const BG_K = 6; // field pixels
const BW = OUT_W / BG_K, BH = OUT_H / BG_K;
const LOGO_K = 10;
const LOGO_Y = 250;
export const URL_TEXT = 'realsies.lol';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

let field: Rgba | null = null;
function fieldBuf(): Rgba {
  if (field) return field;
  const b = createBuffer(BW, BH);
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      // a soft glow behind the logo, fading to the darkest navy at the edges
      const nx = (x - BW / 2) / (BW * 0.52), ny = (y - BH * 0.4) / (BH * 0.62);
      const v = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny));
      const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      let c: Color = P.black;
      if (v > 0.55) c = (v - 0.55) / 0.3 > th ? P.navy : P.navyDark;
      else if (v > 0.2) c = (v - 0.2) / 0.35 > th ? P.navyDark : P.black;
      // a few far stars
      if (hash01(71, x, y) < 0.006) c = hash01(72, x, y) < 0.5 ? P.slate : P.grey;
      px(b, x, y, c);
    }
  field = b;
  return b;
}

/** A sparkle at output (x, y) in 10-px blocks, phase 0..1 (dot, small cross, big cross, small, dot). */
function sparkle(out: Rgba, x: number, y: number, ph: number, c: Color): void {
  const size = ph < 0.15 ? 0 : ph < 0.3 ? 1 : ph < 0.55 ? 2 : ph < 0.7 ? 1 : ph < 0.8 ? 0 : -1;
  if (size < 0) return;
  const K = LOGO_K;
  const dot = (dx: number, dy: number, cc: Color) => rectOut(out, x + dx * K, y + dy * K, K, K, cc);
  dot(0, 0, P.white);
  for (let d = 1; d <= size; d++) {
    const cc = d === size && size > 1 ? c : P.white;
    dot(-d, 0, cc);
    dot(d, 0, cc);
    dot(0, -d, cc);
    dot(0, d, cc);
  }
}

// hand-placed around the logo (it spans about x 405-1515, y 250-520), clear of the text below
const SPARK_AT: [number, number][] = [[330, 210], [1590, 220], [250, 470], [1670, 500], [560, 570], [1390, 580], [800, 160], [1170, 150], [120, 330], [1800, 360]];
const SPARKS = SPARK_AT.map(([x, y], i) => ({
  x: Math.round(x / LOGO_K) * LOGO_K,
  y: Math.round(y / LOGO_K) * LOGO_K,
  per: 1.1 + hash01(83, i) * 1.3,
  off: hash01(84, i),
  c: [P.yellow, P.cyan, P.pink, P.gold][i % 4],
}));

export function renderEndCard(out: Rgba, t: number, still = false): void {
  const f = createBuffer(BW, BH);
  f.data.set(fieldBuf().data);
  const t0 = beat(CUE.logo);
  const age = still ? 10 : t - t0;
  blitK(out, f, 0, 0, BG_K);
  for (const s of SPARKS) {
    const ph = ((age / s.per + s.off) % 1 + 1) % 1;
    if (age > 0.25) sparkle(out, s.x, s.y, still ? [0.4, 0.62, 0.2, 0.45][SPARKS.indexOf(s) % 4] : ph, s.c);
  }
  // logo: drops in from above with one bounce
  const lb = createBuffer(LOGO_W, LOGO_H);
  drawLogo(lb, 0, 0, still ? 0 : t * 1000, 1, still);
  const drop = [-420, -260, -110, 20, 34, 12, -6, 0];
  const fi = Math.floor(age * 24);
  const dy = fi < drop.length ? drop[Math.max(0, fi)] : 0;
  const lx = Math.round((OUT_W - LOGO_W * LOGO_K) / 2 / 2) * 2;
  blitK(out, lb, lx, LOGO_Y + dy, LOGO_K);
  // tagline
  const tag = LINES.find((l) => l.id === 'tagline')!;
  const n = still ? Infinity : typedCount(tag, t);
  drawCentered(out, lineShown(tag), OUT_W / 2, 640, { color: P.white, scale: 6, outline: P.black }, n);
  // the URL pops in with a two-frame overshoot
  const ua = still ? 10 : t - beat(CUE.url);
  if (ua >= 0) {
    const k = ua < 1 / 24 ? 11 : ua < 2 / 24 ? 10 : 9;
    const y = 760 - (k - 9) * 4;
    drawCentered(out, URL_TEXT, OUT_W / 2, y, { color: P.gold, scale: k, outline: P.black, extrude: P.rust });
    // a blinking cursor after it, like the "Can you tell?" card
    if (!still && Math.floor(ua / 0.35) % 2 === 0) {
      const w = measure(URL_TEXT) * k;
      const x = Math.round((OUT_W / 2 - w / 2) / k) * k + w + k * 2;
      blitK(out, cursorBlock(), x, y, k);
    }
  }
}

let cur: Rgba | null = null;
function cursorBlock(): Rgba {
  if (cur) return cur;
  cur = createBuffer(4, 7);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) px(cur, x, y, P.gold);
  return cur;
}
