// "$REAL facts": the token's supply and where it sits, as one still for X (1920x1080) and one for Telegram
// (1080x1080), in the look of the X thread's diagrams (src/scenes/promo/stills.ts): the calm night over the
// planet's lit limb, the logo, the cream title, big coloured numbers, white type with a black outline, the
// gold URL. Only the facts below, word for word in substance: no price, no promises.

import { type Rgba, type Color, PAL, icon } from '../../art.ts';
import { blitK, rectOut, fillOut } from '../../engine/camera.ts';
import { drawText, textW, type Style } from './text.ts';
import { even } from './ui.ts';
import { sky, logo, url, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;
type IconName = Parameters<typeof icon>[0];

export interface Fact {
  icon: IconName;
  /** The big number and its colour. */
  big: string;
  color: Color;
  /** Its share of the supply, after the number. */
  pct?: string;
  /** What it is, as written. Lines are chosen per layout (wide: two at most; square: as they wrap). */
  wide: string[];
  square: string[];
}

export const FACTS: Fact[] = [
  { icon: 'coin', big: '1,000,000,000', color: P.gold, wide: ['Fixed supply.', 'No minting.'], square: ['Fixed supply. No minting.'] },
  {
    icon: 'shield', big: '800,000,000', color: P.lime, pct: '80%',
    wide: ['In the Rhea pool. The account', 'that holds it has no keys.'],
    square: ['In the Rhea pool. The account', 'that holds it has no keys.'],
  },
  {
    icon: 'lock', big: '200,000,000', color: P.cyan, pct: '20%',
    wide: ['Team share in a vault: nothing', 'before Nov 17, all by Dec 8.'],
    square: ['Team share in a vault: nothing', 'before Nov 17, all by Dec 8.'],
  },
];
export const TITLE_TEXT = '$REAL facts';
export const TOKEN = 'real.realsies.near';
export const URL_TEXT = 'realsies.lol';

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan });
const BODY = (scale: number, color: Color = P.white): Style => ({ color, scale, outline: P.black });

/** The diagrams' night (as stills.ts draws it): no sun, no rays, a few stars, the planet's lit limb low at the bottom. */
function backdrop(out: Rgba, clear: { x: number; y: number; w: number; h: number }[]): void {
  fillOut(out, P.black);
  const k = 6;
  blitK(out, sky({ w: out.w, h: out.h, k, stars: 0.008, clear, tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(out.h / k) - 6, cx: out.w / k / 2, curve: 2200 } }), 0, 0, k);
}

/** A dark box with a coloured rim (stills.ts' frame). */
function frame(out: Rgba, x: number, y: number, w: number, h: number, rim: Color, fill: Color = P.black, t = 6): void {
  rectOut(out, x - 4, y - 4, w + 8, h + 8, P.black);
  rectOut(out, x, y, w, h, rim);
  rectOut(out, x + t, y + t, w - 2 * t, h - 2 * t, fill);
}

/** An icon centred in a square of side `box` at (x, y). */
function iconIn(out: Rgba, name: IconName, x: number, y: number, box: number, k: number): void {
  const ic = icon(name);
  blitK(out, ic, even(x + box / 2 - (ic.w * k) / 2), even(y + box / 2 - (ic.h * k) / 2), k);
}

/** The number, then its share in white after a gap. Returns the width. */
function bigLine(out: Rgba, f: Fact, x: number, y: number, s: number, pctS: number): number {
  const w = drawText(out, f.big, x, y, BODY(s, f.color));
  if (!f.pct) return w;
  const px = x + w + 3 * s;
  drawText(out, f.pct, px, y + (7 * s - 7 * pctS), BODY(pctS, f.color));
  return px - x + textW(f.pct) * pctS;
}

/** The token's address in a gold-rimmed box with its label. Returns the box height. */
function tokenBox(out: Rgba, cx: number, y: number, s: number, labelS: number): number {
  const label = 'Token';
  const lw = textW(label) * labelS, tw = textW(TOKEN) * s;
  const gap = 4 * s, padX = 5 * s, padY = 3 * s + 6;
  const w = even(padX * 2 + lw + gap + tw), h = even(7 * s + 2 * padY);
  const x = even(cx - w / 2);
  frame(out, x, y, w, h, P.gold, P.navyDark, 6);
  drawText(out, label, x + padX, y + padY + (7 * s - 7 * labelS) - 2, BODY(labelS, P.greyLight));
  drawText(out, TOKEN, x + padX + lw + gap, y + padY, BODY(s, P.white));
  return h;
}

// ---------------------------------------------------------------- 1920x1080

/**
 * For X: the logo and title on top; three rows (the icon, the number right-aligned so the digit groups line up,
 * its share under it, what it is beside it in two lines); the token; the URL.
 */
export function realFacts(out: Rgba): void {
  const title = 11, lk = 5;
  const titleW = textW(TITLE_TEXT) * title;
  const logoW = LOGO_W * lk, logoH = LOGO_H * lk;
  const headW = logoW + 64 + titleW;
  const hx = even((out.w - headW) / 2), hy = 36;
  backdrop(out, [{ x: 0, y: 0, w: out.w, h: 1080 - 160 }]);
  logo(out, hx, hy, lk);
  drawText(out, TITLE_TEXT, hx + logoW + 64, hy + Math.round((logoH - 7 * title) / 2), TITLE(title));
  const S = 9, PS = 7, TS = 7, ICON_BOX = 84;
  const ix = 48;
  const nr = ix + ICON_BOX + 28 + Math.max(...FACTS.map((f) => textW(f.big))) * S; // the numbers' right edge
  const tx = nr + 56;
  const blockH = 2 * 7 * TS + 4 * TS;
  const pitch = 172;
  let y = 214;
  for (const f of FACTS) {
    const numH = 7 * S + (f.pct ? 14 + 7 * PS : 0);
    const rowH = Math.max(numH, blockH);
    const iy = y + Math.round((rowH - ICON_BOX) / 2);
    frame(out, ix, iy, ICON_BOX, ICON_BOX, f.color, P.black, 5);
    iconIn(out, f.icon, ix, iy, ICON_BOX, 6);
    const ny = y + Math.round((rowH - numH) / 2);
    drawText(out, f.big, nr - textW(f.big) * S, ny, BODY(S, f.color));
    if (f.pct) drawText(out, f.pct, nr - textW(f.pct) * PS, ny + 7 * S + 14, BODY(PS, f.color));
    // a dotted rule between the number and its words, so the share does not read on into the sentence
    for (let dy = 0; dy < rowH; dy += 22) rectOut(out, nr + 24, y + dy, 6, 12, P.slate);
    const ty = y + Math.round((rowH - blockH) / 2);
    f.wide.forEach((l, i) => drawText(out, l, tx, ty + i * 11 * TS, BODY(TS)));
    y += pitch;
  }
  tokenBox(out, out.w / 2, 746, 8, 6);
  url(out, URL_TEXT, out.w / 2, 962, 9);
}

// ---------------------------------------------------------------- 1080x1080

/** For Telegram: the logo and title on top, the three facts stacked (number, then what it is), the token, the URL. */
export function realFactsSquare(out: Rgba): void {
  const title = 8, lk = 4;
  const titleW = textW(TITLE_TEXT) * title;
  const logoW = LOGO_W * lk, logoH = LOGO_H * lk;
  const headW = logoW + 40 + titleW;
  const hx = even((out.w - headW) / 2), hy = 34;
  backdrop(out, [{ x: 0, y: 0, w: out.w, h: 1080 - 140 }]);
  logo(out, hx, hy, lk);
  drawText(out, TITLE_TEXT, hx + logoW + 40, hy + Math.round((logoH - 7 * title) / 2), TITLE(title));
  const S = 9, PS = 7, TS = 5, ICON_BOX = 66;
  const x = 64, tx = x + ICON_BOX + 30;
  let y = 196;
  for (const f of FACTS) {
    frame(out, x, y + Math.round((7 * S - ICON_BOX) / 2), ICON_BOX, ICON_BOX, f.color, P.black, 5);
    iconIn(out, f.icon, x, y + Math.round((7 * S - ICON_BOX) / 2), ICON_BOX, 5);
    bigLine(out, f, tx, y, S, PS);
    y += 7 * S + 26;
    f.square.forEach((l, i) => drawText(out, l, tx, y + i * 10 * TS, BODY(TS)));
    y += f.square.length * 10 * TS + 40;
  }
  tokenBox(out, out.w / 2, y + 8, 7, 5);
  url(out, URL_TEXT, out.w / 2, 976, 8);
}

/** Every string on the stills, for the checks in the script. */
export function factsText(): string[] {
  return [TITLE_TEXT, ...FACTS.flatMap((f) => [f.big, f.pct ?? '', ...f.wide, ...f.square]), 'Token', TOKEN, URL_TEXT].filter(Boolean);
}
