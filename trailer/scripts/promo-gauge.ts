// npx tsx scripts/promo-gauge.ts --pct 38 --asof "Nov 11, 12:15 UTC" [--dashboard]
//   "Can people tell who's real?": the share of calls that were right as one large percentage over a meter, with the
//   time it was counted (src/scenes/promo/gauge.ts). can-people-tell.png (1920x1080, X) and can-people-tell-square.png
//   (1080x1080, Telegram) into out/promo/; --dashboard copies them into .bl0x/topics/near-hackathon/promo/.
//   The number comes from the game's own records: `python -I scripts/call-gauge.py` in the repo root counts it on
//   the server and runs this script with it.

import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { gauge, gaugeSquare } from '../src/scenes/promo/gauge.ts';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const pct = Number(arg('pct'));
const asOf = arg('asof');
if (!(pct >= 0 && pct <= 100) || !asOf) {
  console.error('usage: npx tsx scripts/promo-gauge.ts --pct <0..100> --asof "Nov 11, 12:15 UTC" [--dashboard]');
  process.exit(2);
}

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
mkdirSync(OUT, { recursive: true });

const stills: [string, number, number, typeof gauge][] = [
  ['can-people-tell.png', 1920, 1080, gauge],
  ['can-people-tell-square.png', 1080, 1080, gaugeSquare],
];
const written: string[] = [];
for (const [name, w, h, draw] of stills) {
  const b = createBuffer(w, h);
  draw(b, { pct, asOf });
  const f = join(OUT, name);
  writeRgbPng(f, b);
  written.push(f);
  console.log(`wrote ${f}`);
}
if (process.argv.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  for (const f of written) copyFileSync(f, join(DASHBOARD, basename(f)));
  console.log(`copied to ${DASHBOARD}`);
}
