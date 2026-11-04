// Hair styles. Built from a dome profile plus a per-column fringe line, then style extras.
// Front hair sits over the head (rows ~4-24); some styles add BACK hair drawn behind head and torso.

import { Grid, code } from '../grid.ts';

const H = code('H', 1), Hs = code('H', 2), Hh = code('H', 0), Hd = code('H', 3);

export interface HairStyle {
  id: string;
  /** Has volume above row 8 (spikes, afro, mohawk, bun): hats clip it. */
  tall?: boolean;
  front(g: Grid): void;
  back?(g: Grid): void;
  /** Animated bit (ponytail swish): frame 0/1. */
  wiggle?(g: Grid, f: number): void;
}

// dome top per column for x 7..15 (left half), mirrored
const DOME = [11, 9, 8, 8, 7, 7, 7, 7, 7];

/** Fill columns x 7..24 from the dome down to bottom[x] (left half given, mirrored unless full). */
function cap(g: Grid, bottom: number[], o: { dome?: number[]; full?: boolean; lift?: number } = {}): void {
  const dome = o.dome ?? DOME;
  const lift = o.lift ?? 0;
  for (let i = 0; i < 18; i++) {
    const x = 7 + i;
    const half = i < 9 ? i : 17 - i;
    const top = dome[half] - lift;
    const bot = o.full ? bottom[i] : bottom[half];
    for (let y = top; y <= bot; y++) g.set(x, y, H);
  }
}

/** Shine streak top-left and darker fringe tips. */
function finish(g: Grid, o: { shine?: boolean; tips?: boolean } = {}): void {
  if (o.shine !== false) {
    for (const [x, y] of [[10, 9], [11, 8], [12, 8], [9, 10]] as const) if (g.get(x, y) === H) g.set(x, y, Hh);
  }
  if (o.tips !== false) {
    for (let x = 7; x <= 24; x++) {
      for (let y = 24; y >= 10; y--) {
        if (g.get(x, y) === H && !g.get(x, y + 1)) {
          if (y >= 12) g.set(x, y, Hs);
          break;
        }
      }
    }
  }
  // right side in shadow
  for (let y = 0; y < 48; y++) for (let x = 31; x >= 16; x--) {
    if (g.get(x, y) === H && !g.get(x + 1, y)) {
      g.set(x, y, Hs);
      break;
    }
  }
}

function longBack(g: Grid, to: number, wavy = false): void {
  for (let y = 11; y <= to; y++) {
    const inset = y >= to - 1 ? 1 : 0;
    for (let x = 6 + inset; x <= 25 - inset; x++) {
      let c = x > 18 ? Hs : H;
      if (wavy && (x + y) % 4 === 0) c = Hs;
      g.set(x, y, c);
    }
  }
  if (wavy) for (let x = 6; x <= 25; x += 3) g.set(x, to + 1, Hs);
}

export const HAIRS: HairStyle[] = [
  {
    id: 'crop',
    front(g) {
      cap(g, [15, 14, 12, 13, 12, 13, 12, 12, 12]);
      finish(g);
    },
  },
  {
    id: 'bowl',
    front(g) {
      cap(g, [16, 15, 13, 13, 13, 13, 13, 13, 13]);
      finish(g, { tips: false });
      for (let x = 9; x <= 22; x++) g.set(x, 13, Hs);
    },
  },
  {
    id: 'sidepart',
    front(g) {
      // swept: low on the viewer's left, high on the right
      cap(g, [16, 15, 14, 14, 13, 13, 12, 12, 11, 11, 11, 11, 11, 11, 11, 12, 13, 14], { full: true });
      g.set(16, 8, Hd);
      g.set(16, 7, Hd);
      finish(g);
      g.set(9, 13, Hh);
    },
  },
  {
    id: 'spiky', tall: true,
    front(g) {
      cap(g, [15, 14, 13, 12, 13, 12, 13, 12, 13]);
      // spikes
      const spikes: [number, number][] = [[8, 6], [10, 4], [13, 3], [16, 3], [19, 4], [22, 6]];
      for (const [sx, sy] of spikes) {
        for (let y = sy; y <= 8; y++) {
          const w = Math.floor((y - sy) / 2);
          for (let x = sx - w; x <= sx + w + 1; x++) g.set(x, y, H);
        }
      }
      finish(g);
      g.set(10, 5, Hh); g.set(13, 4, Hh); g.set(16, 4, Hh);
    },
  },
  {
    id: 'long',
    front(g) {
      cap(g, [24, 21, 13, 12, 12, 13, 13, 12, 12]);
      for (let y = 13; y <= 24; y++) { g.set(6, y, H); g.set(25, y, Hs); }
      finish(g);
    },
    back(g) {
      longBack(g, 31);
    },
  },
  {
    id: 'ponytail',
    front(g) {
      cap(g, [15, 14, 13, 12, 12, 12, 13, 13, 12]);
      finish(g);
      // hair tie
      g.set(24, 11, code('A', 1));
      g.set(24, 12, code('A', 2));
    },
    wiggle(g, f) {
      const dx = f ? 1 : 0;
      for (let y = 10; y <= 21; y++) {
        const x0 = 25 + (y > 15 ? dx : 0) + (y > 18 ? dx : 0);
        const w = y < 12 ? 2 : y > 19 ? 1 : 3;
        for (let x = x0; x < x0 + w; x++) g.set(x, y, x === x0 ? H : Hs);
      }
    },
  },
  {
    id: 'pigtails',
    front(g) {
      cap(g, [16, 15, 13, 13, 12, 12, 13, 13, 13]);
      finish(g);
    },
    wiggle(g, f) {
      const dy = f ? 1 : 0;
      for (const side of [0, 1]) {
        const xs = side ? [25, 26, 27] : [4, 5, 6];
        for (let y = 13 + dy; y <= 21 + dy; y++) {
          const edge = y === 13 + dy || y === 21 + dy;
          for (const x of xs) if (!(edge && (x === xs[side ? 2 : 0]))) g.set(x, y, side ? Hs : H);
        }
        g.set(side ? 24 : 7, 13, code('A', 1)); // bobbles
      }
    },
  },
  {
    id: 'afro', tall: true,
    front(g) {
      for (let y = 2; y <= 19; y++)
        for (let x = 4; x <= 27; x++) {
          const nx = (x + 0.5 - 16) / 12, ny = (y + 0.5 - 11) / 9.5;
          if (nx * nx + ny * ny <= 1) g.set(x, y, H);
        }
      // face window
      for (let y = 13; y <= 24; y++) for (let x = 8; x <= 23; x++) g.set(x, y, 0);
      for (let x = 9; x <= 22; x++) g.set(x, 12, 0);
      // texture
      for (let y = 3; y <= 18; y++) for (let x = 4; x <= 27; x++) if (g.get(x, y) === H && (x * 3 + y * 5) % 7 === 0) g.set(x, y, Hs);
      finish(g, { tips: false });
      g.set(9, 5, Hh); g.set(10, 4, Hh); g.set(8, 6, Hh); g.set(11, 4, Hh);
    },
  },
  {
    id: 'mohawk', tall: true,
    front(g) {
      // shaved sides in hair shadow, crest in the middle
      cap(g, [12, 11, 11, 11, 11, 11, 11, 11, 11]);
      for (let y = 7; y <= 12; y++) for (let x = 7; x <= 24; x++) if (g.get(x, y)) g.set(x, y, Hs);
      // spiky crest down the middle: three spikes, lit on the left
      for (let y = 4; y <= 11; y++) for (let x = 14; x <= 17; x++) g.set(x, y, x === 14 ? Hh : x === 17 ? Hs : H);
      for (const [x, y] of [[15, 0], [15, 1], [16, 1], [15, 2], [16, 2], [15, 3], [16, 3], [14, 3], [13, 2], [13, 3], [17, 3], [18, 2], [18, 3], [18, 4]] as const) g.set(x, y, x <= 14 ? Hh : x >= 17 ? Hs : H);
    },
  },
  {
    id: 'bun', tall: true,
    front(g) {
      cap(g, [15, 14, 13, 13, 12, 12, 12, 12, 12]);
      for (let y = 2; y <= 7; y++) for (let x = 12; x <= 19; x++) {
        const nx = (x + 0.5 - 16) / 4, ny = (y + 0.5 - 4.5) / 3;
        if (nx * nx + ny * ny <= 1) g.set(x, y, H);
      }
      finish(g);
      g.set(13, 3, Hh); g.set(14, 3, Hh);
      g.set(13, 7, Hd); g.set(18, 7, Hd);
    },
  },
  {
    id: 'curly',
    front(g) {
      cap(g, [19, 17, 13, 14, 13, 14, 13, 14, 13], { lift: 1 });
      // bumpy outline
      for (const [x, y] of [[6, 9], [5, 12], [5, 15], [6, 18], [9, 6], [12, 5], [15, 5]] as const) {
        g.sym(x, y, H); g.sym(x + 1, y, H); g.sym(x, y + 1, H);
      }
      for (let y = 7; y <= 18; y++) for (let x = 5; x <= 26; x++) if (g.get(x, y) === H && ((x + y * 2) % 5 === 0)) g.set(x, y, Hs);
      finish(g);
    },
  },
  {
    id: 'buzz',
    front(g) {
      cap(g, [14, 13, 11, 11, 11, 11, 11, 11, 11], { dome: [11, 10, 9, 9, 9, 9, 9, 9, 9] });
      for (let y = 8; y <= 14; y++) for (let x = 7; x <= 24; x++) if (g.get(x, y) && (x + y) % 2 === 0) g.set(x, y, Hs);
    },
  },
  {
    id: 'bob',
    front(g) {
      cap(g, [22, 22, 13, 13, 13, 12, 12, 12, 12]);
      for (let y = 13; y <= 22; y++) { g.set(6, y, H); g.set(25, y, Hs); }
      g.set(6, 22, 0); g.set(25, 22, 0);
      finish(g);
    },
    back(g) {
      longBack(g, 23);
    },
  },
  {
    id: 'wavy',
    front(g) {
      cap(g, [24, 22, 14, 13, 12, 12, 13, 12, 12], { lift: 1 });
      for (let y = 12; y <= 25; y++) {
        const w = (y >> 1) & 1;
        g.set(6 - w, y, H); g.set(25 + w, y, Hs);
      }
      finish(g);
    },
    back(g) {
      longBack(g, 33, true);
    },
  },
  {
    id: 'quiff', tall: true,
    front(g) {
      cap(g, [15, 14, 12, 12, 12, 12, 12, 12, 12]);
      for (let y = 3; y <= 8; y++) for (let x = 10; x <= 21 - (8 - y); x++) g.set(x, y, H);
      for (let x = 12; x <= 18; x++) g.set(x, 3, H);
      g.set(11, 4, Hh); g.set(12, 4, Hh); g.set(13, 4, Hh);
      finish(g);
    },
  },
  {
    id: 'bald',
    front(g) {
      // nothing on top; a tiny shine is added on the head instead
      g.set(11, 11, code('S', 0));
      g.set(12, 11, code('S', 0));
      g.set(11, 12, code('S', 0));
    },
  },
];

export function hair(style: HairStyle, frame = 0): { front: Grid; back: Grid | null } {
  const front = new Grid();
  style.front(front);
  if (style.wiggle) style.wiggle(front, frame);
  let back: Grid | null = null;
  if (style.back) {
    back = new Grid();
    style.back(back);
  }
  return { front, back };
}
