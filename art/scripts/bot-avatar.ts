// Renders the avatar of the game's Telegram bot (@realsiesbot): an 8-bit robot head in the game's palette, front
// on, with the gold R on its chest. Drawn on a 32 px grid and scaled up, so every pixel stays square. Telegram crops
// avatars to a circle: the head sits inside it, only the shoulders are cut.
// Usage: npx tsx scripts/bot-avatar.ts [outDir]   (default out/bot). Writes realsiesbot-avatar.png (silver robot)
// and realsiesbot-avatar-gold.png (gold robot), both 640 x 640.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createBuffer, get, px, rect, type Rgba } from '../src/core/buffer.ts';
import { PAL, type Color } from '../src/core/palette.ts';
import { writePng } from './png.ts';

const P = PAL;
const N = 32;

interface Metal {
  light: Color; // the lit top edge
  base: Color;
  shade: Color; // the lower and right side
}

function robot(m: Metal): Rgba {
  const b = createBuffer(N, N);
  const box = (x: number, y: number, w: number, h: number, fill: Color) => {
    rect(b, x, y, w, h, P.black);
    rect(b, x + 1, y + 1, w - 2, h - 2, fill);
  };
  // backdrop: night blue with a lighter disc behind the head
  rect(b, 0, 0, N, N, P.navyDark);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 14.5 ** 2) px(b, x, y, P.navy);

  // shoulders and chest (high enough that the circle crop keeps the R whole)
  box(5, 24, 22, 9, m.base);
  rect(b, 6, 25, 20, 1, m.light);
  rect(b, 6, 30, 20, 2, m.shade);
  // the gold R on a dark plate
  rect(b, 12, 25, 8, 7, P.black);
  const R = ['###.', '#..#', '###.', '#.#.', '#..#'];
  R.forEach((row, j) => [...row].forEach((c, i) => c === '#' && px(b, 14 + i, 26 + j, P.gold)));
  // neck
  box(13, 22, 6, 3, m.shade);

  // antenna: a stem and a glowing bulb
  px(b, 15, 5, m.base);
  px(b, 16, 5, m.shade);
  rect(b, 14, 1, 4, 4, P.black);
  rect(b, 15, 2, 2, 2, P.gold);
  px(b, 15, 2, P.yellow);

  // ears
  box(4, 12, 4, 6, m.shade);
  box(24, 12, 4, 6, m.shade);
  px(b, 5, 13, m.base);
  px(b, 25, 13, m.base);

  // head: a box with the corners cut, lit from the top left
  box(7, 6, 18, 17, m.base);
  for (const [x, y] of [[7, 6], [24, 6], [7, 22], [24, 22]]) px(b, x, y, get(b, x < 16 ? x - 1 : x + 1, y));
  for (const [x, y] of [[8, 7], [23, 7], [8, 21], [23, 21]]) px(b, x, y, P.black);
  rect(b, 9, 7, 14, 1, m.light);
  rect(b, 8, 8, 1, 6, m.light);
  rect(b, 9, 20, 14, 2, m.shade);
  rect(b, 23, 8, 1, 13, m.shade);

  // visor with two cyan eyes
  rect(b, 9, 10, 14, 6, P.black);
  for (const ex of [11, 18]) {
    rect(b, ex, 11, 3, 4, P.cyan);
    rect(b, ex, 14, 3, 1, P.blue);
    px(b, ex, 11, P.white);
  }
  // blush, like every character in the room
  px(b, 9, 17, P.pink);
  px(b, 10, 17, P.pink);
  px(b, 21, 17, P.pink);
  px(b, 22, 17, P.pink);
  // mouth: a small grille
  rect(b, 12, 18, 8, 2, P.black);
  for (const x of [13, 15, 17]) px(b, x, 18, P.white);
  for (const x of [13, 15, 17]) px(b, x, 19, P.greyLight);
  return b;
}

function upscale(src: Rgba, k: number): Rgba {
  const out = createBuffer(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) px(out, x, y, get(src, Math.floor(x / k), Math.floor(y / k)));
  return out;
}

const outDir = process.argv[2] ?? join(process.cwd(), 'out', 'bot');
mkdirSync(outDir, { recursive: true });
const variants: [string, Metal][] = [
  ['realsiesbot-avatar.png', { light: P.white, base: P.greyLight, shade: P.grey }],
  ['realsiesbot-avatar-gold.png', { light: P.yellow, base: P.gold, shade: P.orange }],
];
for (const [name, m] of variants) {
  writePng(join(outDir, name), upscale(robot(m), 20));
  console.log(`wrote ${join(outDir, name)}`);
}
