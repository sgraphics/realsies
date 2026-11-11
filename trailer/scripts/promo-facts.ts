// npx tsx scripts/promo-facts.ts [--dashboard]
//   The "$REAL facts" flyer (src/scenes/promo/facts.ts): real-facts.png (1920x1080, for X) and
//   real-facts-square.png (1080x1080, for Telegram) into out/promo/; --dashboard copies them into
//   .bl0x/topics/near-hackathon/promo/. The facts themselves live in facts.ts; change them only there.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { realFacts, realFactsSquare } from '../src/scenes/promo/facts.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
mkdirSync(OUT, { recursive: true });

const stills: [string, number, number, typeof realFacts][] = [
  ['real-facts.png', 1920, 1080, realFacts],
  ['real-facts-square.png', 1080, 1080, realFactsSquare],
];

const written: string[] = [];
for (const [name, w, h, draw] of stills) {
  const b = createBuffer(w, h);
  draw(b);
  const f = join(OUT, name);
  writeRgbPng(f, b);
  written.push(f);
  console.log(`wrote ${f}`);
}
if (process.argv.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  for (const f of written) copyFileSync(f, join(DASHBOARD, f.split(/[\\/]/).pop()!));
  console.log(`copied to ${DASHBOARD}`);
}
