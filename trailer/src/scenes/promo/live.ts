// "Live": the beta-open card's scene (src/scenes/promo/beta.ts, the trailer's end card: sunrise and
// rays, stars, the smug three, the logo on top) for the launch, with a stamp whose lines can differ
// in size ("LIVE" big, "NOW" under it), the tagline and the URL. 1920x1080 and 1080x1080.

import { type Rgba, type Color, type Look, createBuffer, px, get, PAL, TRANSPARENT, hash01 } from '../../art.ts';
import { blitK } from '../../engine/camera.ts';
import { drawText, drawTextC, textW } from './text.ts';
import { even } from './ui.ts';
import { sky, crest, logo, url, Trio, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;

export interface LiveOpts {
  trio: { left: string | Look; mid: string | Look; right: string | Look };
  /** The stamp's lines, each at its own size (stamp pixels per font pixel). */
  stamp: { text: string; fk: number }[];
  tagline: string;
  url: string;
  /** 'dial': the round Turing Hour emblem instead of the gold stamp (the stamp's lines are not used then). */
  emblem?: 'dial';
}

// ---------------------------------------------------------------- the stamp

const inside = (w: number, h: number, x: number, y: number, r: number) => {
  const cx = x < r ? r - x : x > w - 1 - r ? x - (w - 1 - r) : 0;
  const cy = y < r ? r - y : y > h - 1 - r ? y - (h - 1 - r) : 0;
  return !cx || !cy || cx + cy <= r;
};

/** The beta stamp's look (black edge, worn gold rim, thin inner rim, dark plate), lines centred at their own sizes. */
function stampSprite(lines: { text: string; fk: number }[]): Rgba {
  // the lettering is inked one stamp pixel bolder, so diagonals (the V's tip) stay joined through the rotation
  const tw = Math.max(...lines.map((l) => textW(l.text) * l.fk)) + 1;
  const gaps = lines.slice(1).map((l) => 3 * l.fk);
  const th = lines.reduce((a, l) => a + 7 * l.fk, 0) + gaps.reduce((a, g) => a + g, 0);
  const EDGE = 2, RIM = 4, GAP = 3, INNER = 2, PAD = 6;
  const inset = EDGE + RIM + GAP + INNER + PAD;
  const w = tw + 2 * inset, h = th + 2 * inset;
  const b = createBuffer(w, h);
  const ring = (d: number, c: Color, r: number) => {
    for (let y = d; y < h - d; y++) for (let x = d; x < w - d; x++) if (inside(w - 2 * d, h - 2 * d, x - d, y - d, r)) px(b, x, y, c);
  };
  ring(0, P.black, 6);
  ring(EDGE, P.gold, 5);
  ring(EDGE + RIM, P.plum, 4);
  ring(EDGE + RIM + GAP, P.gold, 3);
  ring(EDGE + RIM + GAP + INNER, P.plum, 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (get(b, x, y) === P.gold && hash01(71, x, y) < 0.06 && (x < inset - PAD || y < inset - PAD || x >= w - inset + PAD || y >= h - inset + PAD)) px(b, x, y, P.plum);
  let y = inset;
  lines.forEach((l, i) => {
    if (i > 0) y += gaps[i - 1];
    const lx = inset + Math.round((tw - 1 - textW(l.text) * l.fk) / 2);
    drawText(b, l.text, lx, y, { color: P.gold, scale: l.fk });
    drawText(b, l.text, lx + 1, y, { color: P.gold, scale: l.fk });
    y += 7 * l.fk;
  });
  return b;
}

function rotate(src: Rgba, a: number): Rgba {
  const c = Math.cos(a), s = Math.sin(a);
  const W = Math.ceil(Math.abs(src.w * c) + Math.abs(src.h * s)) + 2;
  const H = Math.ceil(Math.abs(src.w * s) + Math.abs(src.h * c)) + 2;
  const out = createBuffer(W, H);
  const cx = src.w / 2, cy = src.h / 2, ox = W / 2, oy = H / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - ox, dy = y + 0.5 - oy;
      const sx = Math.floor(dx * c + dy * s + cx), sy = Math.floor(-dx * s + dy * c + cy);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const col = get(src, sx, sy);
      if (col !== TRANSPARENT) px(out, x, y, col);
    }
  return out;
}

function stamp(out: Rgba, lines: { text: string; fk: number }[], cx: number, cy: number, o: { k: number; deg: number }): void {
  const r = rotate(stampSprite(lines), (o.deg * Math.PI) / 180);
  const x = even(cx - (r.w * o.k) / 2), y = even(cy - (r.h * o.k) / 2);
  blitK(out, r, x + 3 * o.k, y + 3 * o.k, o.k, { tint: P.black });
  blitK(out, r, x, y, o.k);
}

// ---------------------------------------------------------------- the Turing Hour emblem

/**
 * Turing Hour's own mark, unlike the gold stamp at a glance: round, in the cool colours, a clock dial with twelve
 * ticks and the words inside. `r` is its radius in emblem pixels.
 */
function dialSprite(r: number): Rgba {
  const d = 2 * r + 1, c = r;
  const b = createBuffer(d, d);
  const disc = (rad: number, col: Color) => {
    for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) if ((x - c) * (x - c) + (y - c) * (y - c) <= rad * rad) px(b, x, y, col);
  };
  disc(r, P.black);
  disc(r - 2, P.cyan);
  disc(r - 7, P.blueDark);
  disc(r - 9, P.navyDark);
  // the dial: the four quarter ticks long, white and two wide, the eight between them short and grey
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6, main = i % 3 === 0;
    for (let t = 0; t < (main ? 7 : 4); t++) {
      const rr = r - 11 - t;
      const x = Math.round(c + Math.sin(a) * rr), y = Math.round(c - Math.cos(a) * rr);
      px(b, x, y, main ? P.white : P.grey);
      if (main) for (const [ax, ay] of [[1, 0], [0, 1], [1, 1]]) px(b, x + ax, y + ay, P.white);
    }
  }
  const lines: [string, number, Color][] = [['TURING', 2, P.white], ['HOUR', 3, P.cyan]];
  const GAP = 6;
  let y = c - Math.round((lines.reduce((h, l) => h + 7 * l[1], 0) + GAP * (lines.length - 1)) / 2) + 1;
  for (const [text, k, col] of lines) {
    const x = c - Math.round((textW(text) * k) / 2);
    // inked one pixel bolder, like the stamp's lettering
    drawText(b, text, x, y, { color: col, scale: k });
    drawText(b, text, x + 1, y, { color: col, scale: k });
    y += 7 * k + GAP;
  }
  return b;
}

/** The card's mark: the gold stamp, or the round dial for Turing Hour (tilted the other way). */
function mark(out: Rgba, o: LiveOpts, cx: number, cy: number, dialR: number): void {
  if (o.emblem !== 'dial') return stamp(out, o.stamp, cx, cy, { k: 3, deg: -10 });
  const k = 3;
  const r = rotate(dialSprite(dialR), (7 * Math.PI) / 180);
  const x = even(cx - (r.w * k) / 2), y = even(cy - (r.h * k) / 2);
  blitK(out, r, x + 3 * k, y + 3 * k, k, { tint: P.black });
  blitK(out, r, x, y, k);
}

// ---------------------------------------------------------------- the two cards

const TAG = (scale: number) => ({ color: P.white, scale, outline: P.black });

/**
 * 1920x1080: the end card's composition, the logo a step left so the stamp sits clear of it at the top right. A wider
 * buffer (the share cards are 2064 wide, 1.91:1) keeps the composition and gets more sky at both sides.
 */
export function live(out: Rgba, o: LiveOpts): void {
  const K = 6, BW = out.w / K;
  const dx = even((out.w - 1920) / 2);
  const lk = 11, ly = 30, lx = even((out.w - LOGO_W * lk) / 2) - 40;
  const tagY = ly + LOGO_H * lk + 22, tagS = 10;
  const clear = [
    { x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 },
    { x: 1480 + dx, y: 30, w: 440, h: 400 },
  ];
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [560 + dx, 960 + dx, 1360 + dx], waist: 968, kMid: 17, kSide: 15 });
  crest(out, { k: K, top: 160, cx: BW / 2 });
  logo(out, lx, ly, lk);
  drawTextC(out, o.tagline, out.w / 2, tagY, TAG(tagS));
  mark(out, o, 1716 + dx, 222, 62);
  url(out, o.url, out.w / 2, 990, 9);
}

/** 1080x1080: logo, tagline, the stamp in the middle, the three, the URL. */
export function liveSquare(out: Rgba, o: LiveOpts): void {
  const K = 6, BW = out.w / K;
  const lk = 8, ly = 34, lx = even((out.w - LOGO_W * lk) / 2);
  const tagY = ly + LOGO_H * lk + 26, tagS = 10;
  const clear = [{ x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 }];
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [300, 540, 780], waist: 962, kMid: 9, kSide: 8 });
  crest(out, { k: K, top: 160, cx: BW / 2, litHalf: 40 });
  logo(out, lx, ly, lk);
  drawTextC(out, o.tagline, out.w / 2, tagY, TAG(tagS));
  mark(out, o, out.w / 2, 524, 56);
  url(out, o.url, out.w / 2, 990, 9);
}
