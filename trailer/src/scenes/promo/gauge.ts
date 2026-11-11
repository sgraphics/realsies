// "Can people tell who's real?": one number as a still, for X (1920x1080) and Telegram (1080x1080), in the look of
// the facts flyer (facts.ts): the calm night over the planet's lit limb, the logo, the cream title, then the share of
// calls that were right as one very large percentage over a meter (right in green from the left, fooled in red after
// it, cut into twenty blocks), the day and hour it was counted, the gold URL. No count of calls on it: the owner's
// choice while the count is small; the "as of" line says that it will be updated.

import { type Rgba, type Color, PAL } from '../../art.ts';
import { blitK, rectOut, fillOut } from '../../engine/camera.ts';
import { drawText, drawTextC, textW, type Style } from './text.ts';
import { even } from './ui.ts';
import { sky, logo, url, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;

export interface GaugeOpts {
  /** The share of calls that were right, 0 to 100 (drawn as a whole number). */
  pct: number;
  /** When it was counted, as it should read: "Nov 11, 12:15 UTC". */
  asOf: string;
}

export const GAUGE_TITLE = "Can people tell who's real?";
export const GAUGE_CAPTION = 'called it right';
export const GAUGE_LEFT = 'RIGHT';
export const GAUGE_RIGHT = 'FOOLED';
export const GAUGE_URL = 'realsies.lol';
export const asOfLine = (asOf: string) => `As of ${asOf}. We will update it.`;

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });
const BODY = (scale: number, color: Color = P.white): Style => ({ color, scale, outline: P.black });

function backdrop(out: Rgba, clearH: number): void {
  fillOut(out, P.black);
  const k = 6;
  blitK(out, sky({ w: out.w, h: out.h, k, stars: 0.008, clear: [{ x: 0, y: 0, w: out.w, h: clearH }], tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(out.h / k) - 6, cx: out.w / k / 2, curve: 2200 } }), 0, 0, k);
}

/**
 * The meter: a black-rimmed trough of twenty blocks, lit green up to `pct` and red after it, with a white marker
 * standing on the line between them.
 */
function meter(out: Rgba, x: number, y: number, w: number, h: number, pct: number): void {
  const rim = 8, gap = 6, n = 20;
  rectOut(out, x - rim - 4, y - rim - 4, w + 2 * rim + 8, h + 2 * rim + 8, P.black);
  rectOut(out, x - rim, y - rim, w + 2 * rim, h + 2 * rim, P.greyLight);
  rectOut(out, x - 2, y - 2, w + 4, h + 4, P.black);
  const cut = x + even((w * Math.max(0, Math.min(100, pct))) / 100);
  for (let i = 0; i < n; i++) {
    const bx = x + Math.round((w * i) / n) + gap / 2, bw = Math.round((w * (i + 1)) / n) - Math.round((w * i) / n) - gap;
    // a block the line runs through is lit in both colours, each on its side of the line
    const parts: [number, number, Color, Color][] = [
      [bx, Math.min(bx + bw, cut), P.lime, P.green],
      [Math.max(bx, cut), bx + bw, P.red, P.redDark],
    ];
    for (const [x0, x1, face, shade] of parts) {
      if (x1 <= x0) continue;
      rectOut(out, x0, y, x1 - x0, h, face);
      rectOut(out, x0, y + h - Math.round(h / 4), x1 - x0, Math.round(h / 4), shade);
      rectOut(out, x0, y, x1 - x0, Math.max(4, Math.round(h / 10)), P.white);
    }
  }
  // the marker
  rectOut(out, cut - 8, y - rim - 22, 16, h + 2 * rim + 44, P.black);
  rectOut(out, cut - 4, y - rim - 18, 8, h + 2 * rim + 36, P.white);
}

// ---------------------------------------------------------------- 1920x1080

export function gauge(out: Rgba, o: GaugeOpts): void {
  const pct = Math.round(o.pct);
  backdrop(out, 1080 - 150);
  const lk = 5, logoW = LOGO_W * lk, logoH = LOGO_H * lk, title = 8;
  const titleW = textW(GAUGE_TITLE) * title;
  const headW = logoW + 56 + titleW;
  const hx = even((out.w - headW) / 2), hy = 36;
  logo(out, hx, hy, lk);
  drawText(out, GAUGE_TITLE, hx + logoW + 56, hy + Math.round((logoH - 7 * title) / 2), TITLE(title));

  // the number, very large, with what it counts beside its foot
  const big = 40, cap = 9;
  const num = `${pct}%`;
  const numW = textW(num) * big, capW = textW(GAUGE_CAPTION) * cap;
  const nx = even((out.w - (numW + 48 + capW)) / 2), ny = 196;
  drawText(out, num, nx, ny, { color: P.lime, scale: big, outline: P.black, extrude: P.green });
  drawText(out, GAUGE_CAPTION, nx + numW + 48, ny + 7 * big - 7 * cap - 8, BODY(cap));

  const mx = 170, mw = out.w - 2 * mx, my = 560, mh = 120;
  meter(out, mx, my, mw, mh, pct);
  const lab = 7;
  drawText(out, GAUGE_LEFT, mx, my + mh + 40, BODY(lab, P.lime));
  drawText(out, GAUGE_RIGHT, mx + mw - textW(GAUGE_RIGHT) * lab, my + mh + 40, BODY(lab, P.red));

  drawTextC(out, asOfLine(o.asOf), out.w / 2, 826, BODY(6, P.greyLight));
  url(out, GAUGE_URL, out.w / 2, 962, 9);
}

// ---------------------------------------------------------------- 1080x1080

export function gaugeSquare(out: Rgba, o: GaugeOpts): void {
  const pct = Math.round(o.pct);
  backdrop(out, 1080 - 140);
  const lk = 5, logoW = LOGO_W * lk;
  logo(out, even((out.w - logoW) / 2), 30, lk);
  drawTextC(out, GAUGE_TITLE, out.w / 2, 30 + LOGO_H * lk + 26, TITLE(6));

  // the number's outline is one of its own (large) pixels wide: it starts well under the title's descenders
  const big = 30, cap = 8;
  const num = `${pct}%`;
  const ny = 286;
  drawTextC(out, num, out.w / 2, ny, { color: P.lime, scale: big, outline: P.black, extrude: P.green });
  drawTextC(out, GAUGE_CAPTION, out.w / 2, ny + 7 * big + 2 * big + 14, BODY(cap));

  const mx = 80, mw = out.w - 2 * mx, my = 668, mh = 92;
  meter(out, mx, my, mw, mh, pct);
  const lab = 6;
  drawText(out, GAUGE_LEFT, mx, my + mh + 36, BODY(lab, P.lime));
  drawText(out, GAUGE_RIGHT, mx + mw - textW(GAUGE_RIGHT) * lab, my + mh + 36, BODY(lab, P.red));

  drawTextC(out, asOfLine(o.asOf), out.w / 2, 886, BODY(4, P.greyLight));
  url(out, GAUGE_URL, out.w / 2, 976, 8);
}
