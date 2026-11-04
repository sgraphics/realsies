// Hats. Each draws over the hair; `clipY` removes hair above that row (the hat covers the skull),
// `wiggle` frames animate feathers, tassels, propellers and pompoms (1 px on a 3-tick cycle).

import { Grid, code } from '../grid.ts';

const P = code('P', 1), Ps = code('P', 2), Ph = code('P', 0), Pd = code('P', 3);
const Q = code('Q', 1), Qs = code('Q', 2), Qh = code('Q', 0);
const A = code('A', 1), As = code('A', 2), Ah = code('A', 0);

export interface HatStyle {
  id: string;
  clipY?: number; // hair above this row is removed
  /** Ramp override for P (e.g. crowns are gold, helmets steel). */
  ramp?: string;
  /** Second ramp override for Q. */
  ramp2?: string;
  /** Hats that hide the top of tall hairstyles entirely. */
  draw(g: Grid, f: number): void;
}

function span(g: Grid, y: number, x0: number, x1: number, c: number): void {
  for (let x = x0; x <= x1; x++) g.set(x, y, c);
}
/** Symmetric span from x0 to the mirror of x0. */
function sspan(g: Grid, y: number, x0: number, c: number): void {
  span(g, y, x0, 31 - x0, c);
}
/** Light from the top-left: left column highlight, right column shadow, on rows y0..y1. */
function shadeSides(g: Grid, y0: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < 32; x++) if (g.get(x, y) === P) { if (l < 0) l = x; r = x; }
    if (l >= 0 && r - l > 3) { g.set(l + 1, y, Ph); g.set(r, y, Ps); }
  }
}

export const HATS: HatStyle[] = [
  {
    id: 'cap', clipY: 10,
    draw(g) {
      sspan(g, 5, 11, P); sspan(g, 6, 9, P); for (let y = 7; y <= 9; y++) sspan(g, y, 8, P);
      shadeSides(g, 6, 9);
      g.set(15, 4, A); g.set(16, 4, As); // button
      g.set(15, 7, A); g.set(16, 7, A); g.set(15, 8, As); g.set(16, 8, As); // patch
      sspan(g, 10, 7, Q); sspan(g, 11, 8, Qs); // brim
      g.set(8, 10, Qh); g.set(9, 10, Qh);
    },
  },
  {
    id: 'beanie', clipY: 11,
    draw(g, f) {
      sspan(g, 5, 12, P); sspan(g, 6, 10, P); sspan(g, 7, 9, P); sspan(g, 8, 8, P); sspan(g, 9, 8, P);
      shadeSides(g, 6, 9);
      for (let x = 7; x <= 24; x++) { g.set(x, 10, (x & 1) ? Q : Qs); g.set(x, 11, (x & 1) ? Qs : Q); }
      // pompom wobbles
      const dx = f ? 1 : 0;
      span(g, 2, 14 + dx, 17 + dx, A); span(g, 3, 13 + dx, 18 + dx, A); span(g, 4, 14 + dx, 17 + dx, As);
      g.set(14 + dx, 2, Ah); g.set(14 + dx, 3, Ah);
    },
  },
  {
    id: 'tophat', clipY: 10,
    draw(g) {
      for (let y = 0; y <= 6; y++) sspan(g, y, 10, P);
      sspan(g, 7, 10, A); sspan(g, 8, 10, As);
      sspan(g, 9, 6, P); sspan(g, 10, 7, Ps);
      shadeSides(g, 0, 6);
      g.set(11, 1, Ph); g.set(11, 2, Ph);
    },
  },
  {
    id: 'wizard', clipY: 10,
    draw(g, f) {
      const rows: [number, number, number][] = [[1, 15, 17], [2, 15, 17], [3, 14, 18], [4, 14, 18], [5, 13, 19], [6, 12, 19], [7, 11, 20], [8, 10, 21]];
      for (const [y, a, b] of rows) span(g, y, a, b, P);
      g.set(17 + (f ? 1 : 0), 0, P); g.set(18 + (f ? 1 : 0), 0, Ps); // floppy tip
      shadeSides(g, 3, 8);
      sspan(g, 9, 5, Q); sspan(g, 10, 6, Qs);
      // stars and moon
      g.set(13, 6, A); g.set(14, 4, Ah); g.set(18, 7, A); g.set(17, 5, Ah);
    },
  },
  {
    id: 'crown', clipY: 8, ramp: 'gold',
    draw(g, f) {
      for (let y = 8; y <= 10; y++) span(g, y, 9, 22, P);
      for (let y = 5; y <= 7; y++) { span(g, y, 9, 10, P); span(g, y, 21, 22, P); }
      for (let y = 4; y <= 7; y++) span(g, y, 15, 16, P);
      span(g, 7, 9, 22, P);
      g.set(9, 4, Ph); g.set(22, 4, Ps); g.set(15, 3, Ph); g.set(16, 3, Ph);
      span(g, 10, 9, 22, Ps);
      g.set(12, 9, A); g.set(19, 9, A); g.set(15, 9, 117); g.set(16, 9, 117); // cyan gem
      // glint
      if (f) g.set(10, 8, 100);
      else g.set(10, 8, Ph);
    },
  },
  {
    id: 'cowboy', clipY: 10,
    draw(g) {
      sspan(g, 4, 11, P); for (let y = 5; y <= 7; y++) sspan(g, y, 10, P);
      g.set(15, 4, Ps); g.set(16, 4, Ps); // dent
      sspan(g, 8, 10, A);
      // brim curling up at the ends
      sspan(g, 9, 4, P); sspan(g, 10, 5, Ps);
      g.sym(3, 8, P); g.sym(3, 7, P); g.sym(4, 8, P);
      shadeSides(g, 5, 7);
    },
  },
  {
    id: 'helmet', clipY: 13, ramp: 'steel',
    draw(g, f) {
      sspan(g, 5, 11, P); sspan(g, 6, 9, P); sspan(g, 7, 8, P); for (let y = 8; y <= 12; y++) sspan(g, y, 7, P);
      for (let y = 13; y <= 19; y++) { span(g, y, 7, 8, P); span(g, y, 23, 24, P); }
      sspan(g, 12, 7, Ps);
      shadeSides(g, 6, 12);
      g.set(10, 7, Ph); g.set(11, 6, Ph); g.set(9, 8, Ph);
      // plume
      const dx = f ? 1 : 0;
      for (let y = 0; y <= 4; y++) span(g, y, 14 + (y < 2 ? dx : 0), 17 + (y < 2 ? dx : 0), y < 4 ? A : As);
      g.set(14 + dx, 0, Ah);
      // rivets
      g.set(8, 11, Pd); g.set(23, 11, Pd);
    },
  },
  {
    id: 'headband',
    draw(g) {
      span(g, 11, 7, 24, P); span(g, 12, 7, 24, P);
      span(g, 11, 7, 24, Q);
      g.set(24, 12, Ps); g.set(25, 13, P); g.set(26, 14, Ps); // knot tail
    },
  },
  {
    id: 'propeller', clipY: 9,
    draw(g, f) {
      sspan(g, 5, 11, P); sspan(g, 6, 9, P); sspan(g, 7, 8, P); sspan(g, 8, 8, P); sspan(g, 9, 8, Ps);
      for (let y = 5; y <= 9; y++) for (let x = 8; x <= 23; x++) if (g.get(x, y) === P && (((x - 8) >> 2) & 1)) g.set(x, y, Q);
      g.set(15, 3, A); g.set(16, 3, A); g.set(15, 4, As); g.set(16, 4, As);
      if (f) { span(g, 2, 9, 14, 113 - 113 + A); span(g, 2, 17, 22, A); g.set(9, 2, Ah); }
      else { span(g, 2, 12, 19, A); g.set(12, 2, Ah); }
      g.set(15, 2, Ah); g.set(16, 2, A);
    },
  },
  {
    id: 'party',
    draw(g, f) {
      const rows: [number, number, number][] = [[3, 15, 16], [4, 15, 16], [5, 14, 17], [6, 14, 17], [7, 13, 18], [8, 13, 18], [9, 12, 19]];
      for (const [y, a, b] of rows) span(g, y, a, b, P);
      for (const [y, a, b] of rows) for (let x = a; x <= b; x++) if ((x + y) % 4 === 0) g.set(x, y, Q);
      for (const [y, , b] of rows) g.set(b, y, Ps);
      const dx = f ? 1 : 0;
      span(g, 1, 14 + dx, 17 + dx, A); span(g, 2, 14 + dx, 17 + dx, As); g.set(14 + dx, 1, Ah);
    },
  },
  {
    id: 'viking', clipY: 10, ramp: 'iron',
    draw(g, f) {
      sspan(g, 5, 11, P); sspan(g, 6, 9, P); sspan(g, 7, 8, P); sspan(g, 8, 8, P); sspan(g, 9, 8, P);
      sspan(g, 10, 7, A); sspan(g, 11, 7, As);
      for (let y = 5; y <= 9; y++) g.set(15, y, A), g.set(16, y, As);
      shadeSides(g, 6, 9);
      // horns (cream)
      const C1 = 123, C2 = 122; // cream, tan
      for (const [x, y] of [[6, 8], [5, 7], [5, 6], [4, 5], [4, 4], [4, 3]] as const) { g.set(x, y, C1); g.set(31 - x, y, C2); }
      g.set(5, 8, C1); g.set(26, 8, C2); g.set(6, 7, C2); g.set(25, 7, C2);
      if (f) { g.set(4, 2, C1); g.set(27, 2, C2); }
    },
  },
  {
    id: 'fez',
    draw(g, f) {
      for (let y = 4; y <= 9; y++) span(g, y, 12 - (y > 6 ? 1 : 0), 19 + (y > 6 ? 1 : 0), P);
      shadeSides(g, 4, 9);
      span(g, 9, 11, 20, Ps);
      // tassel
      g.set(16, 3, 104); g.set(17, 3, 104);
      const dx = f ? 1 : 0;
      for (let y = 4; y <= 7; y++) g.set(19 + dx + (y > 5 ? 1 : 0), y, A);
      g.set(20 + dx, 8, As); g.set(21 + dx, 8, As);
    },
  },
  {
    id: 'chef', clipY: 10,
    draw(g) {
      const W = 100, w = 101;
      for (let y = 1; y <= 7; y++) for (let x = 8; x <= 23; x++) {
        const bump = [[11, 3, 3.5], [16, 2, 4], [21, 3, 3.5], [16, 6, 7]] as const;
        if (bump.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r)) g.set(x, y, W);
      }
      for (let y = 8; y <= 10; y++) span(g, y, 9, 22, W);
      span(g, 10, 9, 22, w);
      for (let y = 1; y <= 10; y++) for (let x = 31; x >= 0; x--) if (g.get(x, y) === W) { g.set(x, y, w); break; }
      g.set(13, 5, w); g.set(19, 5, w); g.set(16, 8, w);
    },
  },
  {
    id: 'beret', clipY: 8,
    draw(g) {
      span(g, 6, 10, 22, P); span(g, 7, 8, 24, P); span(g, 8, 7, 24, P); span(g, 9, 8, 23, Ps);
      g.set(18, 5, Pd); g.set(18, 4, P);
      g.set(10, 7, Ph); g.set(11, 7, Ph); g.set(12, 6, Ph);
      span(g, 8, 20, 24, Ps);
    },
  },
  {
    id: 'bandana', clipY: 11,
    draw(g, f) {
      sspan(g, 7, 10, P); sspan(g, 8, 8, P); sspan(g, 9, 8, P); sspan(g, 10, 7, P); sspan(g, 11, 7, Ps);
      for (let y = 7; y <= 10; y++) for (let x = 8; x <= 23; x++) if (g.get(x, y) === P && (x + y * 3) % 5 === 0) g.set(x, y, Qh);
      shadeSides(g, 8, 10);
      // knot + tails at the side
      g.set(25, 10, P); g.set(25, 11, Ps); g.set(26, 11, P);
      g.set(26 + (f ? 1 : 0), 12, P); g.set(27 + (f ? 1 : 0), 13, Ps); g.set(26, 13, P);
    },
  },
  {
    id: 'flowers',
    draw(g, f) {
      const flowers: [number, number, number][] = [[8, 10, A], [12, 8, Q], [16, 7, A], [20, 8, Q], [23, 10, A]];
      span(g, 10, 7, 24, 119); // green vine
      for (const [x, y, c] of flowers) {
        g.set(x, y, c); g.set(x + 1, y, c); g.set(x, y + 1, c); g.set(x + 1, y + 1, c);
        g.set(x, y, 108 + (f && c === A ? 0 : 0)); // yellow centre
      }
    },
  },
  {
    id: 'headphones',
    draw(g) {
      for (const [x, y] of [[6, 13], [6, 12], [6, 11], [7, 10], [7, 9], [8, 8], [9, 7], [10, 6], [11, 6], [12, 5], [13, 5], [14, 5], [15, 5]] as const) {
        g.sym(x, y, P);
      }
      for (let y = 13; y <= 18; y++) { span(g, y, 4, 7, P); span(g, y, 24, 27, Ps); }
      for (let y = 14; y <= 17; y++) { g.set(5, y, Q); g.set(26, y, Qs); }
      g.set(4, 13, 0); g.set(27, 13, 0); g.set(4, 18, 0); g.set(27, 18, 0);
      g.set(9, 7, Ph); g.set(10, 6, Ph);
    },
  },
  {
    id: 'antenna',
    draw(g, f) {
      span(g, 9, 9, 22, P); g.sym(8, 10, P); g.sym(7, 11, P);
      const dy = f ? 1 : 0;
      for (let y = 3 + dy; y <= 8; y++) { g.set(11 - (y < 6 ? 1 : 0), y, Pd); g.set(20 + (y < 6 ? 1 : 0), y, Pd); }
      for (const cx of [9, 21]) {
        span(g, 1 + dy, cx, cx + 1, A); span(g, 2 + dy, cx, cx + 1, As);
        g.set(cx, 1 + dy, Ah);
      }
    },
  },
  {
    id: 'bunny',
    draw(g, f) {
      span(g, 10, 9, 22, P);
      for (const [x0, flop] of [[10, 0], [19, f]] as const) {
        for (let y = 0; y <= 9; y++) {
          const dx = flop && y < 4 ? 1 : 0;
          span(g, y, x0 + dx, x0 + 2 + dx, P);
          if (y > 1 && y < 8) g.set(x0 + 1 + dx, y, 114); // pink inside
        }
        g.set(x0 + 2 + (flop ? 1 : 0), 0, Ps);
      }
    },
  },
  {
    id: 'catears',
    draw(g) {
      span(g, 10, 8, 23, P);
      for (const [x, y] of [[8, 5], [8, 6], [9, 6], [8, 7], [9, 7], [10, 7], [8, 8], [9, 8], [10, 8], [11, 8], [8, 9], [9, 9], [10, 9], [11, 9], [12, 9]] as const) g.sym(x, y, P);
      g.sym(9, 8, 114); g.sym(9, 7, 114); g.sym(10, 8, 114);
    },
  },
  {
    id: 'nemes', clipY: 13, ramp: 'gold', ramp2: 'royal',
    draw(g) {
      sspan(g, 7, 10, P); sspan(g, 8, 9, P); sspan(g, 9, 8, P); for (let y = 10; y <= 12; y++) sspan(g, y, 7, P);
      // lappets down the sides to the shoulders
      for (let y = 13; y <= 27; y++) { span(g, y, 5 + (y > 20 ? 0 : 1), 8, P); span(g, y, 23, 26 - (y > 20 ? 0 : 1), P); }
      // stripes
      for (let y = 7; y <= 27; y++) if (y % 2 === 0) for (let x = 0; x < 32; x++) if (g.get(x, y) === P) g.set(x, y, Q);
      sspan(g, 12, 7, A); // headband
      g.set(15, 10, A); g.set(16, 10, A); g.set(15, 9, Ah); g.set(16, 9, As); // cobra
    },
  },
  {
    id: 'bubble',
    draw(g, f) {
      const ring: number[] = [];
      for (let y = 2; y <= 27; y++)
        for (let x = 3; x <= 28; x++) {
          const nx = (x + 0.5 - 16) / 12.5, ny = (y + 0.5 - 14.5) / 12.5;
          const d = nx * nx + ny * ny;
          if (d <= 1 && d > 0.84) ring.push(x, y);
        }
      for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i], y = ring[i + 1];
        if (y > 24) continue;
        g.set(x, y, x > 16 && y > 12 ? 101 : 117); // greyLight / cyan glass rim
      }
      // glints
      g.set(8, 6, 100); g.set(7, 7, 100); g.set(9, 5, 100); g.set(7, 9, 101);
      if (f) g.set(23, 6, 100);
      // collar
      span(g, 24, 8, 23, P); span(g, 25, 9, 22, Ps);
    },
  },
  {
    id: 'tricorn', clipY: 10, ramp: 'black',
    draw(g) {
      span(g, 4, 11, 20, P); for (let y = 5; y <= 7; y++) span(g, y, 9, 22, P);
      span(g, 8, 5, 26, P); span(g, 9, 4, 27, P); span(g, 10, 6, 25, Ps);
      g.set(4, 7, P); g.set(27, 7, P); g.set(3, 8, P); g.set(28, 8, P);
      span(g, 8, 5, 26, 109); // gold trim
      // skull badge
      g.set(15, 5, 100); g.set(16, 5, 100); g.set(15, 6, 101); g.set(16, 6, 101);
      shadeSides(g, 5, 7);
    },
  },
];

export function hat(style: HatStyle, frame = 0): Grid {
  const g = new Grid();
  style.draw(g, frame);
  return g;
}
