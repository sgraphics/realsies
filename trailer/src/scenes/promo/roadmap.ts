// "Realsies roadmap": four stages as a 2x2 grid of rimmed boxes on the calm night of the facts flyer, one square still
// (1080x1080) that X and Telegram both show whole. Each stage: its tag (LIVE, NEXT, THEN, LATER) and number, an icon,
// its title in cream, and two or three short lines. The first stage is the game as it is today; the rest are plans,
// worded as plans. Every string lives in STAGES below.

import { type Rgba, type Color, PAL, icon } from '../../art.ts';
import { blitK, rectOut, fillOut } from '../../engine/camera.ts';
import { drawText, drawTextC, textW, wrap, type Style } from './text.ts';
import { even } from './ui.ts';
import { sky, logo, url, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;
type IconName = Parameters<typeof icon>[0];

export interface Stage {
  tag: string;
  color: Color;
  icon: IconName;
  title: string;
  lines: string[];
}

export const ROADMAP_TITLE = 'Roadmap';
export const ROADMAP_URL = 'realsies.lol';
export const STAGES: Stage[] = [
  { tag: '1 LIVE', color: P.lime, icon: 'chat', title: 'Human or bot?', lines: ['Enclave-signed bots', 'Free, 10+ languages', 'Turing Hour daily', 'Share your call'] },
  { tag: '2 NEXT', color: P.cyan, icon: 'user', title: 'Celebrating human connection', lines: ['Proven-human badge', 'Human-only rooms', 'Clubs and dating', 'Make real friends'] },
  { tag: '3 THEN', color: P.magenta, icon: 'link', title: 'Modular chatroom ecosystem', lines: ['NEAR AI room engine', 'Theme modules', 'Host your own room', 'Bot builders earn'] },
  { tag: '4 LATER', color: P.yellow, icon: 'star', title: 'Into real life', lines: ['AI coaches, mentors', 'Meetups IRL', 'Turing Nights live', 'Research grants'] },
];

const TITLE = (scale: number): Style => ({ color: P.cream, scale, outline: P.black });
const BODY = (scale: number, color: Color = P.white): Style => ({ color, scale, outline: P.black });

function backdrop(out: Rgba, clearH: number): void {
  fillOut(out, P.black);
  const k = 6;
  blitK(out, sky({ w: out.w, h: out.h, k, stars: 0.008, clear: [{ x: 0, y: 0, w: out.w, h: clearH }], tones: [P.black, P.black, P.navyDark], limb: { y: Math.ceil(out.h / k) - 6, cx: out.w / k / 2, curve: 2200 } }), 0, 0, k);
}

function frame(out: Rgba, x: number, y: number, w: number, h: number, rim: Color): void {
  rectOut(out, x - 4, y - 4, w + 8, h + 8, P.black);
  rectOut(out, x, y, w, h, rim);
  rectOut(out, x + 6, y + 6, w - 12, h - 12, P.navyDark);
}

/** One stage in its box. Throws when its text would not fit, rather than shrinking it. */
function stage(out: Rgba, s: Stage, x: number, y: number, w: number, h: number): void {
  frame(out, x, y, w, h, s.color);
  const pad = 26, inner = w - 2 * pad;
  const tagS = 4, titleS = 5, lineS = 4;
  drawText(out, s.tag, x + pad, y + pad, BODY(tagS, s.color));
  const ic = icon(s.icon);
  blitK(out, ic, even(x + w - pad - ic.w * 5), y + pad - 6, 5);
  let cy = y + pad + 7 * tagS + 22;
  for (const row of wrap(s.title, Math.floor(inner / titleS))) {
    drawText(out, row, x + pad, cy, TITLE(titleS));
    cy += 7 * titleS + 12;
  }
  cy += 10;
  for (const line of s.lines) {
    const rows = wrap(line, Math.floor((inner - 6 * lineS) / lineS));
    rows.forEach((row, i) => {
      if (i === 0) rectOut(out, x + pad, cy + 2 * lineS, 2 * lineS, 2 * lineS, s.color);
      drawText(out, row, x + pad + 6 * lineS, cy, BODY(lineS));
      cy += 7 * lineS + 8;
    });
    cy += 6;
  }
  if (cy > y + h - pad + 8) throw new Error(`roadmap: stage "${s.title}" does not fit its box (${cy - y} of ${h} px)`);
  for (const t of [s.title, ...s.lines]) if (textW(t) <= 0) throw new Error('roadmap: empty text');
}

export function roadmapSquare(out: Rgba): void {
  backdrop(out, 1080 - 120);
  const lk = 4, logoW = LOGO_W * lk, logoH = LOGO_H * lk, title = 8;
  const headW = logoW + 40 + textW(ROADMAP_TITLE) * title;
  const hx = even((out.w - headW) / 2), hy = 26;
  logo(out, hx, hy, lk);
  drawText(out, ROADMAP_TITLE, hx + logoW + 40, hy + Math.round((logoH - 7 * title) / 2), { color: P.cream, scale: title, outline: P.black, extrude: P.tan });
  const gx = 36, gap = 24, top = 128, cw = (out.w - 2 * gx - gap) / 2, ch = 414;
  STAGES.forEach((s, i) => stage(out, s, even(gx + (i % 2) * (cw + gap)), top + Math.floor(i / 2) * (ch + gap), even(cw), ch));
  url(out, ROADMAP_URL, out.w / 2, 996, 7);
}

/** Every string on the still, for the checks in the script. */
export function roadmapText(): string[] {
  return [ROADMAP_TITLE, ROADMAP_URL, ...STAGES.flatMap((s) => [s.tag, s.title, ...s.lines])];
}

export { drawTextC };
