// npx tsx scripts/promo-roadmap.ts [--dashboard]
//   "Realsies roadmap": four stages on one square still, roadmap.png (1080x1080; X and Telegram both show a square
//   whole), into out/promo/; --dashboard copies it into .bl0x/topics/near-hackathon/promo/. The stages and their
//   words live in src/scenes/promo/roadmap.ts (STAGES).

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { roadmapSquare, roadmapText } from '../src/scenes/promo/roadmap.ts';

const BANNED = /\b(bets?|betting|stakes?|staking|odds|wagers?|pools?|markets?|prices?)\b/i;
const bad = roadmapText().filter((t) => BANNED.test(t));
if (bad.length) {
  console.error(`words the game does not use: ${bad.join(' | ')}`);
  process.exit(1);
}

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
mkdirSync(OUT, { recursive: true });
const b = createBuffer(1080, 1080);
roadmapSquare(b);
const f = join(OUT, 'roadmap.png');
writeRgbPng(f, b);
console.log(`wrote ${f}`);
if (process.argv.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  copyFileSync(f, join(DASHBOARD, 'roadmap.png'));
  console.log(`copied to ${DASHBOARD}`);
}
