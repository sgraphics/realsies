// npx tsx scripts/promo.ts [--dashboard]
//   Renders the X thread's stills into out/promo/: mechanics.png, ai-builders-and-tees.png,
//   summary.png (1920x1080) and summary-square.png (1080x1080), beta-open.png (1920x1080) and
//   beta-open-square.png (1080x1080). The demo video is a variant:
//   npm run render -- how-it-plays (out/how-it-plays/how-it-plays.mp4). --dashboard copies the
//   stills and, when it has been rendered, the video into .bl0x/topics/near-hackathon/promo/.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { castLook } from '../src/engine/actor.ts';
import { mechanics, builders, summary, summarySquare, type SummaryOpts } from '../src/scenes/promo/stills.ts';
import { betaOpen, betaOpenSquare, type BetaOpts } from '../src/scenes/promo/beta.ts';
import { CAST, END_SEATS, lobbySeeds } from '../variants/for-realsies/cast.ts';
import { URL_TEXT } from '../variants/for-realsies/storyboard.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
const VIDEO = join(PKG, 'out', 'how-it-plays', 'how-it-plays.mp4');

mkdirSync(OUT, { recursive: true });
const seeds = lobbySeeds();
const opts: SummaryOpts = {
  // the trailer's end-card trio and URL
  trio: { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] },
  url: URL_TEXT,
  bullets: [
    { icon: 'chat', text: 'Human-or-bot chat game' },
    { icon: 'trophy', text: 'Play coins, call, win' },
    { icon: 'shield', text: 'Bots signed in NEAR AI enclaves' },
    { icon: 'link', text: 'Proof on chain' },
    { icon: 'bot', text: 'AI builders earn and learn' },
    { icon: 'coin', text: 'REAL on meme.cooking' },
  ],
};

// "Beta open" for Telegram and X: the end-card scene, a stamp, a tagline and the testnet URL only
const beta: BetaOpts = { trio: opts.trio, badge: ['BETA', 'OPEN'], tagline: 'Real or not?', url: 'testnet.realsies.lol' };

const stills: [string, number, number, (b: ReturnType<typeof createBuffer>) => void][] = [
  ['mechanics.png', 1920, 1080, mechanics],
  ['ai-builders-and-tees.png', 1920, 1080, builders],
  ['summary.png', 1920, 1080, (b) => summary(b, opts)],
  ['summary-square.png', 1080, 1080, (b) => summarySquare(b, opts)],
  ['beta-open.png', 1920, 1080, (b) => betaOpen(b, beta)],
  ['beta-open-square.png', 1080, 1080, (b) => betaOpenSquare(b, beta)],
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
  for (const f of [...written, ...(existsSync(VIDEO) ? [VIDEO] : [])]) copyFileSync(f, join(DASHBOARD, f.split(/[\\/]/).pop()!));
  console.log(`copied to ${DASHBOARD}${existsSync(VIDEO) ? ' (with the video)' : ' (no video yet: npm run render -- how-it-plays)'}`);
}
