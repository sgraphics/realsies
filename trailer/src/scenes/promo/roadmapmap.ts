// "Roadmap to 2027" as an 8-bit overworld map, one square still (1080x1080) that X and Telegram both show whole.
// Drawn on a 180x180 game-pixel island (k = 6), all in our own palette and shapes: water with wave pixels around a
// grassy island, bushes and flowers, a sandy path that snakes in an S over three rows, one numbered tile per quarter
// and a gold star tile at the end. Over it, at full size: the logo and title, and a label box above each tile with
// the quarter and two products. Every string lives in STOPS below; a label that would not fit throws.

import { type Rgba, type Color, PAL, createBuffer, px, rect, hash01, icon } from '../../art.ts';
import { blitK, rectOut } from '../../engine/camera.ts';
import { drawText, drawTextC, textW, wrap, type Style } from './text.ts';
import { even } from './ui.ts';
import { logo, url, LOGO_W, LOGO_H } from './hero.ts';

const P = PAL;
const K = 6;
const G = 180;

export interface Stop {
  /** The quarter, e.g. "Q1 2027". */
  when: string;
  color: Color;
  lines: string[];
  /** Tile centre and label box, in output pixels. */
  tile: [number, number];
  box: [number, number, number, number];
}

export const MAP_TITLE = 'Roadmap to 2027';
export const MAP_URL = 'realsies.lol';
const ROWS = [52, 100, 148];
const LEFT = 12, RIGHT = 168;

export const STOPS: Stop[] = [
  { when: 'Q4 2026 · NOW', color: P.lime, lines: ['Human-or-bot game', 'Turing League'], tile: [40, 52], box: [30, 116, 470, 150] },
  { when: 'Q1 2027', color: P.cyan, lines: ['Clubs, human rooms', 'Proven-human badge'], tile: [124, 52], box: [550, 116, 470, 150] },
  { when: 'Q2 2027', color: P.pink, lines: ['Room engine SDK', 'Host your own room'], tile: [124, 100], box: [544, 400, 440, 150] },
  { when: 'Q3 2027', color: P.orange, lines: ['Realsies Dating', 'Proof-of-AI API'], tile: [40, 100], box: [100, 400, 420, 150] },
  { when: 'Q4 2027', color: P.yellow, lines: ['AI coach to mentor', 'Meetups IRL'], tile: [40, 148], box: [110, 686, 430, 150] },
];
export const GOAL = { title: 'GOAL', lines: ['Real human', 'connection'], tile: [124, 148] as [number, number], box: [610, 686, 370, 150] as [number, number, number, number] };

const BODY = (scale: number, color: Color = P.white): Style => ({ color, scale, outline: P.black });

// ---------------------------------------------------------------- the island (game pixels)

function island(): Rgba {
  const b = createBuffer(G, G);
  // the night band for the title, then the sea with a scatter of wave pixels
  rect(b, 0, 0, G, 18, P.navyDark);
  rect(b, 0, 18, G, G - 18, P.blueDark);
  for (let y = 19; y < G; y++) for (let x = 0; x < G; x++) {
    const h = hash01(7, x, y);
    if (h < 0.012) { px(b, x, y, P.blue); if (x + 1 < G) px(b, x + 1, y, P.blue); }
  }
  // the island: a rounded box with a ring of sand
  const x0 = 4, y0 = 22, x1 = 175, y1 = 172, r = 7;
  const inside = (x: number, y: number, pad: number) => {
    const ax = x0 + pad, ay = y0 + pad, bx = x1 - pad, by = y1 - pad, rr = r - pad;
    if (x < ax || x > bx || y < ay || y > by) return false;
    const cx = x < ax + rr ? ax + rr : x > bx - rr ? bx - rr : x;
    const cy = y < ay + rr ? ay + rr : y > by - rr ? by - rr : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
  };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!inside(x, y, 0)) continue;
    if (!inside(x, y, 2)) { px(b, x, y, P.tan); continue; }
    px(b, x, y, (x + y) % 2 === 0 && hash01(11, x, y) < 0.18 ? P.greenDark : P.green);
  }
  // bushes and flowers, kept off the path rows
  const nearPath = (x: number, y: number) => ROWS.some((ry) => Math.abs(y - ry) < 7) || ((x < LEFT + 6 || x > RIGHT - 6) && y > ROWS[0] - 4 && y < ROWS[2] + 4);
  for (let i = 0; i < 70; i++) {
    const x = 8 + Math.floor(hash01(13, i) * 162), y = 26 + Math.floor(hash01(17, i) * 140);
    if (nearPath(x, y) || !inside(x, y, 4)) continue;
    if (i % 3 === 0) { px(b, x, y, hash01(19, i) < 0.5 ? P.pink : P.yellow); continue; }
    rect(b, x - 1, y, 3, 2, P.greenDark);
    px(b, x, y - 1, P.greenDark);
    px(b, x, y, P.lime);
  }
  // the path: three rows joined at the right, then at the left
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const xa = Math.min(ax, bx), ya = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
    rect(b, xa - 3, ya - 3, w + 7, h + 7, P.brown);
    rect(b, xa - 2, ya - 2, w + 5, h + 5, P.tan);
  };
  seg(LEFT + 16, ROWS[0], RIGHT, ROWS[0]);
  seg(RIGHT, ROWS[0], RIGHT, ROWS[1]);
  seg(LEFT, ROWS[1], RIGHT, ROWS[1]);
  seg(LEFT, ROWS[1], LEFT, ROWS[2]);
  seg(LEFT, ROWS[2], GOAL.tile[0], ROWS[2]);
  // dots along the middle of the path
  for (const ry of ROWS) for (let x = LEFT; x <= RIGHT; x += 4) if (x > LEFT + 14 || ry !== ROWS[0]) if (ry !== ROWS[2] || x <= GOAL.tile[0]) px(b, x, ry, P.brownLight);
  for (let y = ROWS[0]; y <= ROWS[1]; y += 4) px(b, RIGHT, y, P.brownLight);
  for (let y = ROWS[1]; y <= ROWS[2]; y += 4) px(b, LEFT, y, P.brownLight);
  // the tiles: a black-rimmed square in the stop's colour, lit on top
  const tile = ([cx, cy]: [number, number], c: Color) => {
    rect(b, cx - 7, cy - 7, 15, 15, P.black);
    rect(b, cx - 6, cy - 6, 13, 13, c);
    rect(b, cx - 6, cy + 4, 13, 3, P.black);
    rect(b, cx - 6, cy + 4, 13, 2, P.brown);
    rect(b, cx - 5, cy - 5, 11, 1, P.white);
  };
  STOPS.forEach((s) => tile(s.tile, s.color));
  tile(GOAL.tile, P.gold);
  return b;
}

// ---------------------------------------------------------------- the labels (output pixels)

function label(out: Rgba, head: string, color: Color, lines: string[], box: [number, number, number, number]): void {
  const [x, y, w, h] = box;
  rectOut(out, x - 4, y - 4, w + 8, h + 8, P.black);
  rectOut(out, x, y, w, h, color);
  rectOut(out, x + 6, y + 6, w - 12, h - 12, P.navyDark);
  const pad = 16, s = 4, inner = w - 2 * pad;
  let cy = y + pad;
  drawText(out, head, x + pad, cy, BODY(s, color));
  cy += 7 * s + 16;
  for (const line of lines) {
    for (const row of wrap(line, Math.floor(inner / s))) {
      if (textW(row) * s > inner) throw new Error(`roadmap map: "${row}" is wider than its box`);
      drawText(out, row, x + pad, cy, BODY(s));
      cy += 7 * s + 10;
    }
  }
  if (cy - 10 > y + h - pad + 4) throw new Error(`roadmap map: the box of "${head}" is too small (${cy - y} of ${h} px)`);
}

export function roadmapMap(out: Rgba): void {
  blitK(out, island(), 0, 0, K);
  const lk = 4, logoW = LOGO_W * lk, logoH = LOGO_H * lk, title = 6;
  const headW = logoW + 36 + textW(MAP_TITLE) * title;
  const hx = even((out.w - headW) / 2), hy = 14;
  logo(out, hx, hy, lk);
  drawText(out, MAP_TITLE, hx + logoW + 36, hy + Math.round((logoH - 7 * title) / 2), { color: P.cream, scale: title, outline: P.black, extrude: P.tan });
  STOPS.forEach((s, i) => {
    label(out, s.when, s.color, s.lines, s.box);
    drawTextC(out, String(i + 1), s.tile[0] * K + 3, s.tile[1] * K - 30, { color: P.white, scale: 6, outline: P.black });
  });
  label(out, GOAL.title, P.yellow, GOAL.lines, GOAL.box);
  const star = icon('star');
  blitK(out, star, even(GOAL.tile[0] * K + 3 - (star.w * 6) / 2), GOAL.tile[1] * K - 30, 6);
  url(out, MAP_URL, out.w / 2, 948, 7);
}

/** Every string on the still, for the checks in the script. */
export function roadmapMapText(): string[] {
  return [MAP_TITLE, MAP_URL, GOAL.title, ...GOAL.lines, ...STOPS.flatMap((s) => [s.when, ...s.lines])];
}
