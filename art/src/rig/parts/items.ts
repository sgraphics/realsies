// Back items (behind the body), front items (held in the viewer's-right hand) and torso decals.

import { Grid, code } from '../grid.ts';

const P = code('P', 1), Ps = code('P', 2), Ph = code('P', 0), Pd = code('P', 3);
const Q = code('Q', 1), Qs = code('Q', 2), Qh = code('Q', 0);
const A = code('A', 1), As = code('A', 2), Ah = code('A', 0);
const I = code('I', 1), Is = code('I', 2), Ih = code('I', 0), Id = code('I', 3);
const W = 100, w = 101, K = 104, Y = 108, y_ = 109, O = 110, R = 106, C = 117, M = 113;

function span(g: Grid, y: number, x0: number, x1: number, c: number): void {
  for (let x = x0; x <= x1; x++) g.set(x, y, c);
}

// ---------- back items ----------

export interface BackItem {
  id: string;
  ramp?: string;
  draw(g: Grid, f: number): void;
}

export const BACKS: BackItem[] = [
  {
    id: 'cape',
    draw(g, f) {
      for (let y = 24; y <= 43; y++) {
        const spread = Math.min(5, (y - 23) >> 1);
        const sway = y > 36 ? f : 0;
        span(g, y, 9 - spread + sway, 22 + spread + sway, P);
        g.set(22 + spread + sway, y, Ps);
        g.set(21 + spread + sway, y, Ps);
      }
      // folds
      for (let y = 30; y <= 43; y++) if (y % 3 !== 0) { g.set(6 + (y > 36 ? f : 0), y, Ph); }
      span(g, 43, 4 + f, 27 + f, Ps);
      span(g, 24, 10, 21, Q); span(g, 25, 9, 22, Q); // collar on the shoulders
    },
  },
  {
    id: 'backpack',
    draw(g) {
      for (let y = 26; y <= 36; y++) span(g, y, 8, 23, y === 26 || y === 36 ? Ps : P);
      span(g, 25, 10, 21, P);
      for (let y = 29; y <= 34; y++) { g.set(7, y, Q); g.set(24, y, Qs); }
      g.set(7, 28, Qh);
    },
  },
  {
    id: 'wings',
    draw(g, f) {
      const dy = f ? 1 : 0;
      const shape: [number, number, number][] = [[23, 3, 7], [24, 2, 8], [25, 2, 9], [26, 3, 9], [27, 4, 9], [28, 5, 9], [29, 6, 9], [30, 7, 9]];
      for (const [y, a, b] of shape) {
        for (let x = a; x <= b; x++) {
          g.set(x, y + dy, x === a ? Ih : I);
          g.set(31 - x, y + dy, x === a ? I : Is);
        }
      }
      for (const [y, a] of shape) if (y % 2 === 0) { g.set(a + 2, y + dy, Is); g.set(31 - a - 2, y + dy, Is); }
    },
  },
  {
    id: 'jetpack', ramp: 'steel',
    draw(g, f) {
      for (const x0 of [7, 21]) {
        for (let y = 25; y <= 36; y++) span(g, y, x0, x0 + 3, x0 === 7 ? P : Ps);
        g.set(x0 + 1, 26, Ph); g.set(x0 + 1, 27, Ph);
        span(g, 37, x0 + 1, x0 + 2, Pd);
        // flame flicker
        const fl = f ? [O, Y, O] : [Y, O, R];
        g.set(x0 + 1, 38, fl[0]); g.set(x0 + 2, 38, fl[1]);
        g.set(x0 + 1 + (f ? 1 : 0), 39, fl[2]);
        if (!f) g.set(x0 + 2, 40, O);
      }
      span(g, 28, 10, 21, A);
    },
  },
  {
    id: 'tail',
    draw(g, f) {
      const pts: [number, number][] = [[22, 36], [23, 37], [24, 37], [25, 36], [26, 35], [26, 34], [27, 33], [27, 32], [27 + f, 31], [27 + f, 30], [26 + f, 29]];
      for (const [x, y] of pts) { g.set(x, y, P); g.set(x, y + 1, Ps); }
      g.set(26 + f, 29, W); g.set(27 + f, 30, W); g.set(27 + f, 31, w); // white tip
    },
  },
  {
    id: 'quiver', ramp: 'brown',
    draw(g, f) {
      for (let y = 24; y <= 36; y++) span(g, y - Math.floor((y - 24) / 3), 21 + Math.floor((y - 24) / 3), 23 + Math.floor((y - 24) / 3), P);
      for (const [x, yy] of [[20, 20], [22, 19], [24, 20]] as const) {
        g.set(x, yy + f, Ih); g.set(x, yy + 1 + f, I); g.set(x, yy + 2, Id); g.set(x, yy + 3, Id);
      }
    },
  },
];

// ---------- front items, held at the right hand (hand box at hx..hx+2, hy..hy+1) ----------

export interface FrontItem {
  id: string;
  ramp?: string; // I slot ramp override
  draw(g: Grid, hx: number, hy: number, f: number, fx: Grid): void;
}

export const FRONTS: FrontItem[] = [
  {
    id: 'mug',
    draw(g, hx, hy, f, fx) {
      for (let y = hy - 3; y <= hy + 1; y++) span(g, y, hx + 1, hx + 4, I);
      span(g, hy - 3, hx + 1, hx + 4, Ih);
      g.set(hx + 4, hy - 2, Is); g.set(hx + 4, hy - 1, Is); g.set(hx + 4, hy, Is);
      g.set(hx + 5, hy - 2, I); g.set(hx + 5, hy - 1, Is); // handle
      span(g, hy - 4, hx + 2, hx + 3, M); // coffee
      fx.set(hx + 2 + f, hy - 6, w); fx.set(hx + 3 - f, hy - 7, w); fx.set(hx + 2 + f, hy - 8, w); // steam
    },
  },
  {
    id: 'book',
    draw(g, hx, hy) {
      for (let y = hy - 5; y <= hy + 1; y++) span(g, y, hx + 1, hx + 4, I);
      for (let y = hy - 5; y <= hy + 1; y++) g.set(hx + 1, y, Id);
      span(g, hy - 5, hx + 2, hx + 4, Ih);
      span(g, hy - 3, hx + 2, hx + 4, y_);
      span(g, hy + 1, hx + 2, hx + 4, W); // pages
    },
  },
  {
    id: 'sword', ramp: 'steel',
    draw(g, hx, hy) {
      const x = hx + 3;
      for (let y = hy - 13; y <= hy - 2; y++) { g.set(x, y, I); g.set(x + 1, y, Is); }
      g.set(x, hy - 14, Ih);
      for (let y = hy - 12; y <= hy - 4; y += 3) g.set(x, y, Ih);
      span(g, hy - 1, x - 2, x + 3, y_); // guard
      g.set(x - 2, hy - 1, Y);
      g.set(x, hy, code('A', 1)); g.set(x + 1, hy, code('A', 2)); // grip
      g.set(x, hy + 2, y_); g.set(x + 1, hy + 2, y_); // pommel
    },
  },
  {
    id: 'phone', ramp: 'charcoal',
    draw(g, hx, hy) {
      for (let y = hy - 4; y <= hy; y++) span(g, y, hx + 2, hx + 4, I);
      for (let y = hy - 3; y <= hy - 1; y++) g.set(hx + 3, y, C);
      g.set(hx + 3, hy - 3, W);
    },
  },
  {
    id: 'flower',
    draw(g, hx, hy, f) {
      for (let y = hy - 7; y <= hy; y++) g.set(hx + 3, y, 119);
      g.set(hx + 4, hy - 4, 118); g.set(hx + 5, hy - 5, 118); // leaf
      const cx = hx + 3 + (f ? 1 : 0), cy = hy - 9;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]] as const) g.set(cx + dx, cy + dy, I);
      g.set(cx - 1, cy - 1, Ih);
      g.set(cx, cy, Y);
    },
  },
  {
    id: 'balloon',
    draw(g, hx, hy, f, fx) {
      const bx = hx + 1 + f, by = hy - 26;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 7; x++) {
          const nx = (x + 0.5 - 3.5) / 3.5, ny = (y + 0.5 - 4) / 4;
          if (nx * nx + ny * ny <= 1) g.set(bx + x, by + y, x > 4 || y > 5 ? Is : I);
        }
      g.set(bx + 1, by + 2, Ih); g.set(bx + 2, by + 1, Ih);
      g.set(bx + 3, by + 8, Is); // knot
      // string down to the hand
      for (let y = by + 9; y < hy; y++) fx.set(hx + 3 + (y < by + 14 ? f : 0), y, w);
    },
  },
  {
    id: 'lantern', ramp: 'brass',
    draw(g, hx, hy, f) {
      const x0 = hx + 1, y0 = hy + 2;
      g.set(x0 + 2, hy + 1, I);
      span(g, y0, x0 + 1, x0 + 3, I);
      for (let y = y0 + 1; y <= y0 + 4; y++) { g.set(x0, y, I); g.set(x0 + 4, y, Is); span(g, y, x0 + 1, x0 + 3, f ? Y : 108); }
      g.set(x0 + 2, y0 + 2, f ? O : Y);
      span(g, y0 + 5, x0, x0 + 4, Is);
    },
  },
  {
    id: 'wand',
    draw(g, hx, hy, f, fx) {
      for (let i = 0; i < 8; i++) g.set(hx + 3 + (i >> 2), hy - i, i < 2 ? K : code('I', 1));
      const sx = hx + 5, sy = hy - 10;
      g.set(sx, sy, Y); g.set(sx - 1, sy, Y); g.set(sx + 1, sy, Y); g.set(sx, sy - 1, Y); g.set(sx, sy + 1, y_);
      if (f) { fx.set(sx + 2, sy - 2, W); fx.set(sx - 2, sy + 2, W); } else { fx.set(sx + 2, sy + 2, W); fx.set(sx - 2, sy - 2, W); }
    },
  },
  {
    id: 'icecream',
    draw(g, hx, hy, f) {
      // cone
      for (let y = 0; y < 5; y++) span(g, hy - 1 - y + 1, hx + 2 + (4 - y >> 1), hx + 4 - (4 - y >> 1) + (y > 2 ? 1 : 0), y_);
      g.set(hx + 3, hy - 1, O);
      // scoop
      span(g, hy - 5, hx + 1, hx + 5, I); span(g, hy - 6, hx + 1, hx + 5, I); span(g, hy - 7, hx + 2, hx + 4, Ih);
      g.set(hx + 5, hy - 5, Is); g.set(hx + 1 + f, hy - 4, I); // drip
      g.set(hx + 3, hy - 8, R); // cherry
    },
  },
];

// ---------- decals on the torso chest (x 13..18, y 27..32) ----------

export interface Decal {
  id: string;
  rows: string[]; // 6 cols from x 13, rows from y 28; A = accent
}

export const DECALS: Decal[] = [
  { id: 'star', rows: ['..A...', '.AAA..', '..A...'] },
  { id: 'heart', rows: ['.A.A..', '.AAA..', '..A...'] },
  { id: 'bolt', rows: ['...A..', '..A...', '.AAA..', '..A...', '.A....'] },
  { id: 'stripe', rows: ['', '', 'AAAAAA'] },
  { id: 'ring', rows: ['.AAA..', '.A.A..', '.AAA..'] },
  { id: 'dots', rows: ['..A...', '......', '..A...', '......', '..A...'] },
  { id: 'chevron', rows: ['A...A.', '.A.A..', '..A...'] },
  { id: 'pocket', rows: ['......', '......', '...aaa', '...a.a', '...aaa'] },
  { id: 'number', rows: [] }, // drawn from the seed: two digits
  { id: 'diamond', rows: ['..A...', '.A!A..', '..A...'] },
];

const DIGITS: Record<string, string[]> = {
  '0': ['AAA', 'A.A', 'A.A', 'AAA'], '1': ['.A.', 'AA.', '.A.', 'AAA'], '2': ['AA.', '..A', '.A.', 'AAA'],
  '3': ['AAA', '.AA', '..A', 'AAA'], '4': ['A.A', 'AAA', '..A', '..A'], '5': ['AAA', 'AA.', '..A', 'AA.'],
  '6': ['.AA', 'A..', 'AAA', 'AAA'], '7': ['AAA', '..A', '.A.', '.A.'], '8': ['AAA', 'AAA', 'A.A', 'AAA'], '9': ['AAA', 'AAA', '..A', 'AA.'],
};

export function decal(d: Decal, number: number, dy = 0): Grid {
  const g = new Grid();
  if (d.id === 'number') {
    const s = String(number % 100).padStart(2, '0');
    g.stamp(12, 28 + dy, DIGITS[s[0]], { main: 'A' });
    g.stamp(16, 28 + dy, DIGITS[s[1]], { main: 'A' });
    return g;
  }
  g.stamp(13, 28 + dy, d.rows, { main: 'A' });
  return g;
}
