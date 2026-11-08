// "Beta open": the trailer's end-card scene (sunrise and rays, stars, the smug three, the logo on
// top) with as little text as possible: a gold rubber stamp, a short tagline under the logo and
// the testnet URL in the end card's gold. 1920x1080 for X, 1080x1080 for Telegram.

import { type Rgba, type Color, type Look, createBuffer, px, get, PAL, TRANSPARENT, hash01 } from '../../art.ts';
import { blitK } from '../../engine/camera.ts';
import { drawText, drawTextC, textW } from './text.ts';
import { even } from './ui.ts';
import { sky, crest, logo, url, Trio, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;

export interface BetaOpts {
  trio: { left: string | Look; mid: string | Look; right: string | Look };
  /** The stamp's lines, e.g. ['BETA', 'OPEN']. */
  badge: string[];
  tagline: string;
  url: string;
}

// ---------------------------------------------------------------- the stamp

/** Inside a w x h rect with its corners cut by a stair of radius r. */
const inside = (w: number, h: number, x: number, y: number, r: number) => {
  const cx = x < r ? r - x : x > w - 1 - r ? x - (w - 1 - r) : 0;
  const cy = y < r ? r - y : y > h - 1 - r ? y - (h - 1 - r) : 0;
  return !cx || !cy || cx + cy <= r;
};

/**
 * The stamp in its own pixels: a black edge, a thick gold rim (worn in places, like rubber ink), a
 * thin inner rim, the lines in gold on a dark plate. `fk` stamp pixels per font pixel.
 */
function stampSprite(lines: string[], fk: number): Rgba {
  const tw = Math.max(...lines.map(textW)) * fk;
  const lineGap = 3 * fk;
  const th = lines.length * 7 * fk + (lines.length - 1) * lineGap;
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
  // rubber-stamp wear: a few gold pixels of the outer rim missing
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (get(b, x, y) === P.gold && hash01(71, x, y) < 0.06 && (x < inset - PAD || y < inset - PAD || x >= w - inset + PAD || y >= h - inset + PAD)) px(b, x, y, P.plum);
  // the lines, centred, in gold
  let y = inset;
  for (const l of lines) {
    const lw = textW(l) * fk;
    drawText(b, l, inset + Math.round((tw - lw) / 2), y, { color: P.gold, scale: fk });
    y += 7 * fk + lineGap;
  }
  return b;
}

/** Nearest-neighbour rotation in the sprite's own pixels, so the stamp's steps match its pixel size. */
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

/** The stamp centred on (cx, cy), tilted `deg` degrees (negative: rising to the right), with a drop shadow. */
function stamp(out: Rgba, lines: string[], cx: number, cy: number, o: { k: number; fk: number; deg: number }): void {
  const r = rotate(stampSprite(lines, o.fk), (o.deg * Math.PI) / 180);
  const x = even(cx - (r.w * o.k) / 2), y = even(cy - (r.h * o.k) / 2);
  blitK(out, r, x + 3 * o.k, y + 3 * o.k, o.k, { tint: P.black });
  blitK(out, r, x, y, o.k);
}

// ---------------------------------------------------------------- the two cards

const TAG = (scale: number) => ({ color: P.white, scale, outline: P.black });

/** 1920x1080: the end card's composition, the stamp slapped on the top right beside the logo. */
export function betaOpen(out: Rgba, o: BetaOpts): void {
  const K = 6, BW = out.w / K;
  const lk = 11, ly = 30, lx = even((out.w - LOGO_W * lk) / 2);
  const tagY = ly + LOGO_H * lk + 22, tagS = 10;
  const urlY = 990, urlS = 9;
  const clear = [
    // no stars on the tagline's row: beside it they read as punctuation
    { x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 },
    { x: 1500, y: 40, w: 420, h: 360 },
  ];
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [560, 960, 1360], waist: 968, kMid: 17, kSide: 15 });
  crest(out, { k: K, top: 160, cx: BW / 2 });
  logo(out, lx, ly, lk);
  drawTextC(out, o.tagline, out.w / 2, tagY, TAG(tagS));
  stamp(out, o.badge, 1728, 214, { k: 3, fk: 3, deg: -10 });
  url(out, o.url, out.w / 2, urlY, urlS);
}

/** 1080x1080: logo, tagline, the stamp in the middle, the three, the URL. */
export function betaOpenSquare(out: Rgba, o: BetaOpts): void {
  const K = 6, BW = out.w / K;
  const lk = 8, ly = 34, lx = even((out.w - LOGO_W * lk) / 2);
  const tagY = ly + LOGO_H * lk + 26, tagS = 10;
  const clear = [{ x: 0, y: tagY - 24, w: out.w, h: 7 * tagS + 48 }];
  blitK(out, sky({ w: out.w, h: out.h, k: K, sun: { x: BW / 2, y: 143 }, limb: { y: 141, cx: BW / 2 }, clear }), 0, 0, K);
  new Trio(o.trio).draw(out, { cx: [300, 540, 780], waist: 962, kMid: 9, kSide: 8 });
  crest(out, { k: K, top: 160, cx: BW / 2, litHalf: 40 });
  logo(out, lx, ly, lk);
  drawTextC(out, o.tagline, out.w / 2, tagY, TAG(tagS));
  stamp(out, o.badge, out.w / 2, 516, { k: 3, fk: 3, deg: -10 });
  url(out, o.url, out.w / 2, 990, 9);
}
