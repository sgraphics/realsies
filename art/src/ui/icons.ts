// Pixel icons for the DOM UI and canvas: coin, clock, rating star, check, cross, verified shield,
// lock, bolt, chat, human, bot, link, flame. Master palette, darker-shade outlines, light from the top-left.

import { type Rgba, createBuffer, px } from '../core/buffer.ts';
import { type Color, PAL } from '../core/palette.ts';

const CH: Record<string, Color> = {
  W: PAL.white, w: PAL.greyLight, G: PAL.grey, g: PAL.slate, k: PAL.navyDark, K: PAL.black, U: PAL.navy,
  Y: PAL.yellow, y: PAL.gold, O: PAL.orange, n: PAL.brown, N: PAL.brownLight, R: PAL.red, r: PAL.redDark, Z: PAL.hotRed,
  L: PAL.lime, l: PAL.green, D: PAL.greenDark, B: PAL.blue, b: PAL.blueDark, C: PAL.cyan, F: PAL.peach, f: PAL.skinMid,
  P: PAL.pink, M: PAL.magenta, V: PAL.purple, p: PAL.plum,
};

export type IconName = 'coin' | 'clock' | 'star' | 'check' | 'cross' | 'shield' | 'lock' | 'bolt' | 'chat' | 'user' | 'bot' | 'link' | 'flame' | 'trophy' | 'mask';

const ICONS: Record<IconName, string[]> = {
  coin: [
    '..nnn..',
    '.nYYyn.',
    'nYWYOyn',
    'nYWYOyn',
    'nYWYOyn',
    'nYWYOyn',
    'nYYYOyn',
    '.nyyyn.',
    '..nnn..',
  ],
  clock: [
    '..kkkkk..',
    '.kWWWWWk.',
    'kWWWKWWwk',
    'kWWWKWWwk',
    'kWWWKKKwk',
    'kWWWWWWwk',
    'kwWWWWWwk',
    '.kwwwwwk.',
    '..kkkkk..',
  ],
  star: [
    '.....n.....',
    '....nYn....',
    '....nYn....',
    'nnnnYWYnnnn',
    'nYYYYWYYYyn',
    '.nyYYYYYyn.',
    '..nyYYYyn..',
    '..nYYyYYn..',
    '.nYyn.nyYn.',
    '.nyn...nyn.',
    '.nn.....nn.',
  ],
  check: [
    '........DD',
    '.......DLD',
    '......DLLD',
    'DD...DLLD.',
    'DLD.DLLD..',
    'DLLDLLD...',
    '.DLLLD....',
    '..DLD.....',
    '...D......',
  ],
  cross: [
    'rr.....rr',
    'rRr...rRr',
    '.rRr.rRr.',
    '..rRrRr..',
    '...rRr...',
    '..rRrRr..',
    '.rRr.rRr.',
    'rRr...rRr',
    'rr.....rr',
  ],
  shield: [
    'bbbbbbbbb',
    'bCCBBBBBb',
    'bCBBBBBWb',
    'bCBBBBWWb',
    'bBWBBWWBb',
    'bBWWWWBBb',
    '.bBWWBBb.',
    '.bBBBBBb.',
    '..bBBBb..',
    '...bbb...',
  ],
  lock: [
    '..ggggg..',
    '.gG...Gg.',
    '.gG...Gg.',
    'nnnnnnnnn',
    'nYYYYYYyn',
    'nYWYnYYyn',
    'nYYYnYYyn',
    'nYYYYYYyn',
    'nyyyyyyyn',
    'nnnnnnnnn',
  ],
  bolt: [
    '....nnn',
    '...nYYn',
    '..nYYn.',
    '.nYYnnn',
    'nYYYYYn',
    'nnnYYn.',
    '..nYn..',
    '.nYn...',
    '.nn....',
  ],
  chat: [
    '.kkkkkkkk.',
    'kWWWWWWWwk',
    'kWWWWWWWwk',
    'kWKWWKWWKk',
    'kWWWWWWWwk',
    'kwwwwwwwwk',
    '.kkWkkkkk.',
    '..kWk.....',
    '..kk......',
  ],
  user: [
    '..nnnnn..',
    '.nFFFFFn.',
    'nFFFFFFfn',
    'nFKFFKFfn',
    'nFFFFFFfn',
    'nFPFFPFfn',
    'nFFKKFFfn',
    '.nfFFffn.',
    '..nnnnn..',
  ],
  bot: [
    '....k....',
    '....C....',
    '.kkkkkkk.',
    'kGGGGGGgk',
    'kGCCGCCgk',
    'kGGGGGGgk',
    'kGKKKKGgk',
    'kggggggk.',
    '.kkkkkkk.',
  ],
  link: [
    '...kkkkk',
    '...kWWWk',
    '....kWWk',
    '...kWkWk',
    '..kWk.kk',
    '.kWk....',
    'kWk.....',
    'kk......',
  ],
  flame: [
    '...r....',
    '..rRr...',
    '..rROr..',
    '.rROOr.r',
    'rROYORrR',
    'rROYYORr',
    'rRYYYYOr',
    '.rOYYOr.',
    '..rrrr..',
  ],
  trophy: [
    'nnnnnnnnn',
    'nYWYYYYyn',
    'nYWYYYYyn',
    '.nYYYYyn.',
    '..nYYyn..',
    '...nyn...',
    '...nyn...',
    '..nnnnn..',
    '.nyyyyyn.',
    '.nnnnnnn.',
  ],
  // a theatre mask: who a bot was playing (persona cards)
  mask: [
    '..nnnnn..',
    '.nYYYYYn.',
    'nYWYYYYyn',
    'nYKKYKKyn',
    'nYYYYYYyn',
    'nYKYYYKyn',
    '.nyKKKyn.',
    '..nyyyn..',
    '...nnn...',
  ],
};

const CACHE = new Map<string, Rgba>();

/** Icon as an RGBA buffer (transparent background). `scale` repeats pixels. */
export function icon(name: IconName, scale = 1): Rgba {
  const key = name + '@' + scale;
  let b = CACHE.get(key);
  if (b) return b;
  const rows = ICONS[name];
  const w = Math.max(...rows.map((r) => r.length));
  b = createBuffer(w * scale, rows.length * scale);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = CH[row[x]];
      if (c === undefined) continue;
      for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) px(b!, x * scale + xx, y * scale + yy, c);
    }
  });
  CACHE.set(key, b);
  return b;
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
