// npx tsx scripts/promo-posts.ts [--dashboard]
//   Stills for the daily posts after the launch, in the LIVE card's look (src/scenes/promo/live.ts): the stamp's
//   lines, the tagline and the URL differ. 1920x1080 for X and 1080x1080 for Telegram, into out/promo/;
//   --dashboard copies them into .bl0x/topics/near-hackathon/promo/.
//     turing-hour-tonight   "TURING HOUR", "Tonight 20:00 UTC"       the day's first announcement
//     turing-hour           "TURING HOUR", "Every day 20:00 UTC"     any day
//     turing-hour-now       "TURING HOUR", "Real people are here now" at the start of the hour
//     free-chat             "FREE CHAT", "No wallet needed"           the free practice chat
//     real-live             "$REAL LIVE", "Play coins. Win coins."    REAL is live

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { castLook } from '../src/engine/actor.ts';
import { live, liveSquare, type LiveOpts } from '../src/scenes/promo/live.ts';
import { CAST, END_SEATS, lobbySeeds } from '../variants/for-realsies/cast.ts';
import { URL_TEXT } from '../variants/for-realsies/storyboard.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');
mkdirSync(OUT, { recursive: true });

const seeds = lobbySeeds();
const trio = { left: seeds[END_SEATS.left], mid: castLook(CAST.guest), right: seeds[END_SEATS.right] };
const card = (stamp: [string, number][], tagline: string): LiveOpts => ({ trio, stamp: stamp.map(([text, fk]) => ({ text, fk })), tagline, url: URL_TEXT });
// Turing Hour has its own mark, a round clock dial in the cool colours, so nobody takes it for the LIVE stamp
const turing = (tagline: string): LiveOpts => ({ trio, stamp: [], tagline, url: URL_TEXT, emblem: 'dial' });

// the stamp sits where LIVE NOW sits: its widest line must not be wider than "LIVE" at 4, or the wide card clips it
const cards: [string, LiveOpts][] = [
  ['turing-hour-tonight', turing('Tonight 20:00 UTC')],
  ['turing-hour', turing('Every day 20:00 UTC')],
  ['turing-hour-now', turing('Real people are here now')],
  ['free-chat', card([['FREE', 4], ['CHAT', 4]], 'No wallet needed')],
  ['real-live', card([['$REAL', 3], ['LIVE', 4]], 'Play coins. Win coins.')],
];

const written: string[] = [];
for (const [name, o] of cards) {
  for (const [suffix, w, h, draw] of [['', 1920, 1080, live], ['-square', 1080, 1080, liveSquare]] as const) {
    const b = createBuffer(w, h);
    draw(b, o);
    const f = join(OUT, `${name}${suffix}.png`);
    writeRgbPng(f, b);
    written.push(f);
    console.log(`wrote ${f}`);
  }
}
if (process.argv.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  for (const f of written) copyFileSync(f, join(DASHBOARD, f.split(/[\\/]/).pop()!));
  console.log(`copied to ${DASHBOARD}`);
}
