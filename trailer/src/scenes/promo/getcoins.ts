// "Get coins in 20 seconds": the pieces drawn by the pixel engine for a clip made of the web app's own screens
// (scripts/get-coins-clip.ts shoots them with web/scripts/qa-shot.sh and composes the clip with ffmpeg). Here:
// the highlight ring around the control a step uses and the tapping hand (screen-sized RGBA overlays, so they
// zoom with the screen), the step captions in the look of the how-it-plays video (a gold step chip and white
// pixel type on a dark band), and the end card (the trailer's sunrise, the smug three, the logo, the URL).

import { type Rgba, type Color, createBuffer, px, PAL } from '../../art.ts';
import { blitK, rectOut } from '../../engine/camera.ts';
import { drawText, drawTextC, textW, type Style } from './text.ts';
import { even } from './ui.ts';
import { sky, crest, logo, url, Trio, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const th = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** Set one pixel to a colour at an alpha (0..1), straight into the buffer (rectOut only writes opaque pixels). */
function pxA(b: Rgba, x: number, y: number, c: Color, a: number): void {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  b.data[i] = (c >> 16) & 0xff;
  b.data[i + 1] = (c >> 8) & 0xff;
  b.data[i + 2] = c & 0xff;
  b.data[i + 3] = Math.round(a * 255);
}

/** A rect of transparent pixels (cuts the inside out of a filled ring). */
function clearRect(b: Rgba, x: number, y: number, w: number, h: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(b.h, y + h); yy++) b.data.fill(0, (yy * b.w + Math.max(0, x)) * 4, (yy * b.w + Math.min(b.w, x + w)) * 4);
}

// ---------------------------------------------------------------- the highlight and the hand

/**
 * The ring around the control in use, on a transparent buffer the size of the screenshot: black, a yellow
 * band with a gold inner edge, black again, `gap` UI pixels clear of the control, its corners stepped like the
 * game's panels. `u` is one UI pixel in screenshot px (the screenshot's device pixel ratio).
 */
export function ring(w: number, h: number, r: Rect, u: number, gap = 3): Rgba {
  const b = createBuffer(w, h);
  const pad = (5 + gap) * u;
  const x0 = Math.round(r.x * u) - pad, y0 = Math.round(r.y * u) - pad;
  const x1 = Math.round((r.x + r.w) * u) + pad, y1 = Math.round((r.y + r.h) * u) + pad;
  const layers: [number, Color][] = [[0, P.black], [u, P.yellow], [3 * u, P.gold], [4 * u, P.black]];
  for (const [d, c] of layers) {
    // a filled rect `d` in from the outer edge, its corners stepped by one UI pixel
    rectOut(b, x0 + d + u, y0 + d, x1 - x0 - 2 * d - 2 * u, y1 - y0 - 2 * d, c);
    rectOut(b, x0 + d, y0 + d + u, x1 - x0 - 2 * d, y1 - y0 - 2 * d - 2 * u, c);
  }
  clearRect(b, x0 + 5 * u, y0 + 5 * u, x1 - x0 - 10 * u, y1 - y0 - 10 * u);
  return b;
}

/** A pointing hand (white, black outline), its fingertip at column 5.5, row 0. */
const HAND = [
  '.....KK..........',
  '....KWWK.........',
  '....KWWK.........',
  '....KWWK.........',
  '....KWWK.........',
  '....KWWKKK.......',
  '....KWWKWWKKK....',
  '....KWWKWWKWWKK..',
  '.KK.KWWKWWKWWKWK.',
  'KWWKKWWWWWWWWKWWK',
  'KWWWKWWWWWWWWWWWK',
  '.KWWWWWWWWWWWWWWK',
  '..KWWWWWWWWWWWWWK',
  '..KWWWWWWWWWWWWK.',
  '...KWWWWWWWWWWWK.',
  '...KWWWWWWWWWWK..',
  '....KWWWWWWWWWK..',
  '....KWWWWWWWWWK..',
  '....KKKKKKKKKKK..',
];
const HAND_SPRITE = (() => {
  const b = createBuffer(HAND[0].length, HAND.length);
  HAND.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && px(b, x, y, ch === 'K' ? P.black : P.white)));
  return b;
})();

/** The hand with its fingertip at `tip` (CSS px), on a transparent buffer the size of the screenshot; k = sprite px in screenshot px. */
export function hand(w: number, h: number, tip: { x: number; y: number }, u: number, k: number): Rgba {
  const b = createBuffer(w, h);
  const x = Math.round(tip.x * u - 5.5 * k), y = Math.round(tip.y * u);
  blitK(b, HAND_SPRITE, x + k, y + k, k, { tint: P.black }); // a hard shadow, one sprite pixel down and right
  blitK(b, HAND_SPRITE, x, y, k);
  return b;
}

/** The tap: a square ring flashing out around the fingertip (as the trailer's cursor click draws it). */
export function tap(w: number, h: number, tip: { x: number; y: number }, u: number, size: number): Rgba {
  const b = createBuffer(w, h);
  const cx = Math.round(tip.x * u), cy = Math.round(tip.y * u), t = Math.max(4, 2 * u);
  for (const [r, c] of [[size, P.white], [size + t, P.black]] as [number, Color][]) {
    rectOut(b, cx - r, cy - r, 2 * r, t, c);
    rectOut(b, cx - r, cy + r - t, 2 * r, t, c);
    rectOut(b, cx - r, cy - r, t, 2 * r, c);
    rectOut(b, cx + r - t, cy - r, t, 2 * r, c);
  }
  return b;
}

// ---------------------------------------------------------------- captions

const TYPE = (scale: number): Style => ({ color: P.white, scale, outline: P.black });

/** The gold step chip (stills.ts' chip, the video's caption chip). */
function chip(out: Rgba, n: number, x: number, y: number, s: number): void {
  rectOut(out, x - 6, y - 6, s + 12, s + 12, P.black);
  rectOut(out, x, y, s, s, P.gold);
  rectOut(out, x, y, s, 6, P.yellow);
  rectOut(out, x, y + s - 8, s, 8, P.orange);
  const ns = String(n), k = Math.floor(s / 10);
  drawText(out, ns, even(x + s / 2 - (textW(ns) * k) / 2), Math.round(y + s / 2 - (7 * k) / 2), { color: P.black, scale: k });
}

/** Chip and lines, the group centred on cx, the block's top at y. */
function chipAndLines(out: Rgba, step: number, lines: string[], cx: number, y: number, o: { scale: number; chip: number; gap: number; lead: number }): void {
  const tw = Math.max(...lines.map((l) => textW(l))) * o.scale;
  const blockH = lines.length * 7 * o.scale + (lines.length - 1) * o.lead;
  const groupW = o.chip + o.gap + tw;
  const x0 = even(cx - groupW / 2);
  chip(out, step, x0, y + Math.round((blockH - o.chip) / 2), o.chip);
  lines.forEach((l, i) => drawText(out, l, x0 + o.chip + o.gap, y + i * (7 * o.scale + o.lead), TYPE(o.scale)));
}

export const WIDE_CAPTION = { scale: 9, chip: 84, gap: 30, top: 880, solid: 950, line: 966 };

/**
 * The wide clip's caption: a full-frame RGBA overlay, transparent above a dark band dithered in 4-px blocks
 * (clear at `top`, deepest from `solid` down), the chip and one line of white type on it.
 */
export function captionWide(w: number, h: number, step: number, text: string): Rgba {
  const C = WIDE_CAPTION;
  const b = createBuffer(w, h);
  const B = 4, MAX = 0.82;
  for (let by = Math.floor(C.top / B); by * B < h; by++) {
    const v = Math.min(1, ((by + 0.5) * B - C.top) / (C.solid - C.top));
    // four alpha levels, dithered between them
    const level = v * 4;
    for (let bx = 0; bx * B < w; bx++) {
      const s = Math.min(4, Math.floor(level) + (level - Math.floor(level) > th(bx, by) ? 1 : 0));
      if (s <= 0) continue;
      for (let yy = by * B; yy < Math.min(h, by * B + B); yy++) for (let xx = bx * B; xx < Math.min(w, bx * B + B); xx++) pxA(b, xx, yy, P.black, (s / 4) * MAX);
    }
  }
  chipAndLines(b, step, [text], w / 2, C.line, { scale: C.scale, chip: C.chip, gap: C.gap, lead: 0 });
  return b;
}

export const TALL_CAPTION = { h: 300, scale: 7, chip: 72, gap: 28, lead: 22 };

/** The vertical clip's caption band under the screen (opaque): the chip and one or two lines. */
export function captionTall(w: number, step: number, lines: string[]): Rgba {
  const C = TALL_CAPTION;
  const b = createBuffer(w, C.h);
  rectOut(b, 0, 0, w, C.h, P.black);
  rectOut(b, 0, 0, w, 6, P.navyDark);
  for (let x = 0; x < w; x += 12) rectOut(b, x, 6, 6, 4, P.navyDark);
  const blockH = lines.length * 7 * C.scale + (lines.length - 1) * C.lead;
  chipAndLines(b, step, lines, w / 2, 8 + Math.round((C.h - 8 - blockH) / 2), { scale: C.scale, chip: C.chip, gap: C.gap, lead: C.lead });
  return b;
}

// ---------------------------------------------------------------- the end card

const TAG = (scale: number): Style => ({ color: P.white, scale, outline: P.black });

/** 1920x1080: the trailer's end card (live.ts' composition without a stamp): logo, tagline, the three, the URL. */
export function endCardWide(out: Rgba, trio: ConstructorParameters<typeof Trio>[0], tagline: string, urlText: string): void {
  const K = 6, BW = out.w / K;
  const lk = 11, ly = 30, lx = even((out.w - LOGO_W * lk) / 2);
  const tagY = ly + LOGO_H * lk + 22, tagS = 10;
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear: [{ x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 }] }), 0, 0, K);
  new Trio(trio).draw(out, { cx: [560, 960, 1360], waist: 968, kMid: 17, kSide: 15 });
  crest(out, { k: K, top: 160, cx: BW / 2 });
  logo(out, lx, ly, lk);
  drawTextC(out, tagline, out.w / 2, tagY, TAG(tagS));
  url(out, urlText, out.w / 2, 990, 9);
}

/** 1080x1920: the same, stacked for a phone held upright. */
export function endCardTall(out: Rgba, trio: ConstructorParameters<typeof Trio>[0], tagline: string, urlText: string): void {
  const K = 6, BW = out.w / K;
  const waist = 1620, horizon = 1470 / K;
  const lk = 8, ly = 330, lx = even((out.w - LOGO_W * lk) / 2);
  const tagY = ly + LOGO_H * lk + 40, tagS = 9;
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: horizon + 2 }, limb: { y: horizon, cx: BW / 2, curve: 900 }, clear: [{ x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 }] }), 0, 0, K);
  new Trio(trio).draw(out, { cx: [250, 540, 830], waist, kMid: 18, kSide: 15 });
  crest(out, { k: K, top: Math.round(waist / K), cx: BW / 2, curve: 1600, litHalf: 40 });
  logo(out, lx, ly, lk);
  drawTextC(out, tagline, out.w / 2, tagY, TAG(tagS));
  url(out, urlText, out.w / 2, 1736, 10);
}
