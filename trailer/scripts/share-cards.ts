// npx tsx scripts/share-cards.ts [--web]
//   The link-preview cards a player shares after a call (web/public/s/<outcome>/index.html names them as og:image):
//   the LIVE card's look (src/scenes/promo/live.ts) with what happened as the big line. 2064x1080, which is 1.91:1,
//   the shape X shows a link card in: a 16:9 image would lose about 37 px at the top and the bottom, and with them the
//   feet of the URL.
//   Into out/share/; --web copies them into ../web/public/s/ as <outcome>.png.
//     fooled    "A bot fooled me"            called human, it was a bot
//     spotted   "I spotted the bot"          called bot, it was a bot
//     found     "I found the human"          called human, it was a human
//     missed    "I took a human for a bot"   called bot, it was a human

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { castLook } from '../src/engine/actor.ts';
import { live, type LiveOpts } from '../src/scenes/promo/live.ts';
import { CAST, END_SEATS, lobbySeeds } from '../variants/for-realsies/cast.ts';
import { URL_TEXT } from '../variants/for-realsies/storyboard.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'share');
const WEB = join(PKG, '..', 'web', 'public', 's');
mkdirSync(OUT, { recursive: true });

// 1.91:1, the shape X shows a link card in: nothing is cropped
const W = 2064;
const H = 1080;

const seeds = lobbySeeds();
const trio = { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] };
const card = (stamp: [string, number][], tagline: string): LiveOpts => ({ trio, stamp: stamp.map(([text, fk]) => ({ text, fk })), tagline, url: URL_TEXT });

// the stamp says what it was; its widest line must not be wider than "LIVE" at 4 (the wide card clips it otherwise)
const cards: [string, LiveOpts][] = [
  ['fooled', card([['IT WAS', 2], ['A BOT', 3]], 'A bot fooled me')],
  ['spotted', card([['IT WAS', 2], ['A BOT', 3]], 'I spotted the bot')],
  ['found', card([['A REAL', 2], ['HUMAN', 3]], 'I found the human')],
  ['missed', card([['A REAL', 2], ['HUMAN', 3]], 'I took a human for a bot')],
];

const written: [string, string][] = [];
for (const [name, o] of cards) {
  const b = createBuffer(W, H);
  live(b, o);
  const f = join(OUT, `${name}.png`);
  writeRgbPng(f, b);
  written.push([name, f]);
  console.log(`wrote ${f}`);
}
if (process.argv.includes('--web')) {
  mkdirSync(WEB, { recursive: true });
  for (const [name, f] of written) copyFileSync(f, join(WEB, `${name}.png`));
  console.log(`copied to ${WEB}`);
}
