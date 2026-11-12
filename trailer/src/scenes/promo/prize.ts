// "Turing Hour prize": a still for X (1920x1080) and Telegram (1080x1080) in the look of the gauge and the facts
// flyer: the calm night over the planet's lit limb, the logo, the cream title, then the prize as one large gold
// number, the three places, when, and the gold URL. The rules live at realsies.lol/prize.html.

import { type Rgba, type Color, PAL } from '../../art.ts';
import { blitK, rectOut, fillOut } from '../../engine/camera.ts';
import { drawText, drawTextC, textW, type Style } from './text.ts';
import { even } from './ui.ts';
import { sky, logo, url, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;

export interface PrizeOpts {
  /** The prize as it reads big: "5 NEAR". */
  amount: string;
  /** The places: [["1st", "3 NEAR"], ...]. */
  places: [string, string][];
  /** When: "Tonight 20:00 UTC". */
  when: string;
  /** What it is for, under the amount. */
  forWhat: string;
}

export const PRIZE_TITLE = 'Turing Hour prize';
export const PRIZE_URL = 'realsies.lol';

// no extrusion: at these sizes it swallows the dot of the i ("Turlng")
const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black });
const BODY = (scale: number, color: Color = P.white): Style => ({ color, scale, outline: P.black });
const GOLD = (scale: number): Style => ({ color: P.yellow, scale, outline: P.black, extrude: P.orange });

function backdrop(out: Rgba, clearH: number): void {
  fillOut(out, P.black);
  const k = 6;
  blitK(out, sky({ w: out.w, h: out.h, k, stars: 0.008, clear: [{ x: 0, y: 0, w: out.w, h: clearH }], tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(out.h / k) - 6, cx: out.w / k / 2, curve: 2200 } }), 0, 0, k);
}

/** The three places side by side in rimmed boxes: the place small on top, the amount large under it. */
function places(out: Rgba, o: PrizeOpts, cx: number, y: number, boxW: number, gap: number, s: number, ls: number): void {
  const n = o.places.length;
  const total = n * boxW + (n - 1) * gap;
  let x = even(cx - total / 2);
  const h = 7 * ls + 7 * s + 3 * 16;
  const rims: Color[] = [P.yellow, P.greyLight, P.orange];
  o.places.forEach(([place, amount], i) => {
    rectOut(out, x - 4, y - 4, boxW + 8, h + 8, P.black);
    rectOut(out, x, y, boxW, h, rims[i] ?? P.grey);
    rectOut(out, x + 6, y + 6, boxW - 12, h - 12, P.navyDark);
    drawTextC(out, place, x + boxW / 2, y + 16, BODY(ls, P.greyLight));
    drawTextC(out, amount, x + boxW / 2, y + 16 + 7 * ls + 16, BODY(s, P.white));
    x += boxW + gap;
  });
}

export function prize(out: Rgba, o: PrizeOpts): void {
  backdrop(out, 1080 - 150);
  const lk = 5, logoW = LOGO_W * lk, logoH = LOGO_H * lk, title = 8;
  const titleW = textW(PRIZE_TITLE) * title;
  const headW = logoW + 56 + titleW;
  const hx = even((out.w - headW) / 2), hy = 36;
  logo(out, hx, hy, lk);
  drawText(out, PRIZE_TITLE, hx + logoW + 56, hy + Math.round((logoH - 7 * title) / 2), TITLE(title));
  drawTextC(out, o.amount, out.w / 2, 190, GOLD(30));
  drawTextC(out, o.forWhat, out.w / 2, 190 + 7 * 30 + 2 * 30 + 6, BODY(8));
  places(out, o, out.w / 2, 560, 420, 60, 9, 6);
  drawTextC(out, o.when, out.w / 2, 840, BODY(8, P.cyan));
  url(out, PRIZE_URL, out.w / 2, 966, 9);
}

export function prizeSquare(out: Rgba, o: PrizeOpts): void {
  backdrop(out, 1080 - 140);
  const lk = 5, logoW = LOGO_W * lk;
  logo(out, even((out.w - logoW) / 2), 28, lk);
  drawTextC(out, PRIZE_TITLE, out.w / 2, 28 + LOGO_H * lk + 22, TITLE(6));
  // the amount's outline and extrusion reach one of its own pixels above and below: it starts well under the title
  drawTextC(out, o.amount, out.w / 2, 300, GOLD(19));
  drawTextC(out, o.forWhat, out.w / 2, 300 + 7 * 19 + 2 * 19 + 18, BODY(6));
  places(out, o, out.w / 2, 590, 300, 24, 6, 5);
  drawTextC(out, o.when, out.w / 2, 846, BODY(6, P.cyan));
  url(out, PRIZE_URL, out.w / 2, 966, 8);
}
