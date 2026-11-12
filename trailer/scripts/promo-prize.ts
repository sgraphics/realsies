// npx tsx scripts/promo-prize.ts [--when "Tonight 20:00 UTC"] [--dashboard]
//   "Turing Hour prize": 5 NEAR for the three best callers (src/scenes/promo/prize.ts). turing-prize.png (1920x1080,
//   X) and turing-prize-square.png (1080x1080, Telegram) into out/promo/; --dashboard copies them into
//   .bl0x/topics/near-hackathon/promo/. The rules are at realsies.lol/prize.html.

import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { prize, prizeSquare, type PrizeOpts } from '../src/scenes/promo/prize.ts';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const o: PrizeOpts = {
  amount: '5 NEAR',
  forWhat: 'for the three best callers',
  places: [['1st', '3 NEAR'], ['2nd', '1.5 NEAR'], ['3rd', '0.5 NEAR']],
  when: arg('when') ?? 'Tonight 20:00 UTC',
};

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
mkdirSync(OUT, { recursive: true });
const written: string[] = [];
for (const [name, w, h, draw] of [['turing-prize.png', 1920, 1080, prize], ['turing-prize-square.png', 1080, 1080, prizeSquare]] as const) {
  const b = createBuffer(w, h);
  draw(b, o);
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
