// A proportional 5x7 pixel font with lowercase and descenders, drawn for the trailer (the engine's
// own font is 3x5 capitals only). Cap height 7, x-height 5, two descender rows. Every glyph is
// authored here as ASCII; nothing is copied from another font.

import { type Rgba, px } from '../art.ts';
import type { Color } from '../art.ts';

/** Rows per glyph box: 7 above the baseline (caps), 2 below (descenders). */
export const FONT_ROWS = 9;
export const CAP_H = 7;

// Each glyph is a list of rows, top (ascender line) first; short lists are padded with blank rows.
const G: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.###.', '#...#', '#....', '.###.', '....#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['....', '....', '.###', '#...', '#...', '#...', '.###'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  j: ['..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '####.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['....', '....', '#.##', '##..', '#...', '#...', '#...'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#..', '.#..', '####', '.#..', '.#..', '.#..', '..##'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],

  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],

  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '.#', '#.'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '-': ['....', '....', '....', '....', '####', '....', '....'],
  ':': ['.', '.', '.', '#', '.', '.', '#'],
  '/': ['..#', '..#', '.#.', '.#.', '.#.', '#..', '#..'],
  '(': ['.#', '#.', '#.', '#.', '#.', '#.', '.#'],
  ')': ['#.', '.#', '.#', '.#', '.#', '.#', '#.'],
  '_': ['....', '....', '....', '....', '....', '....', '....', '####'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
};

interface Glyph {
  w: number;
  on: boolean[]; // FONT_ROWS * w
}
const CACHE = new Map<string, Glyph>();
function glyph(ch: string): Glyph {
  let g = CACHE.get(ch);
  if (!g) {
    const rows = G[ch] ?? G['?'];
    const w = rows[0].length;
    const on: boolean[] = [];
    for (let y = 0; y < FONT_ROWS; y++) {
      const r = rows[y] ?? '.'.repeat(w);
      for (let x = 0; x < w; x++) on.push(r[x] === '#');
    }
    g = { w, on };
    CACHE.set(ch, g);
  }
  return g;
}

/** Width of a string in font pixels (1 px between glyphs). */
export function measure(text: string): number {
  let w = 0;
  for (const ch of text) w += glyph(ch).w + 1;
  return Math.max(0, w - 1);
}

export interface TextStyle {
  color: Color;
  /** 1-font-pixel outline on all eight sides. */
  outline?: Color;
  /** Drop shadow one font pixel down and right (drawn under the outline). */
  shadow?: Color;
  /** A one-pixel 3D extrusion under the face (inside the outline), like the logo's. */
  extrude?: Color;
  /** Output pixels per font pixel. */
  scale: number;
}

/**
 * Draw `text` with its top-left (ascender line) at (x, y) in output pixels. `count` limits the
 * number of characters shown (typewriter); layout always uses the full string.
 */
export function drawString(b: Rgba, text: string, x: number, y: number, st: TextStyle, count = Infinity): void {
  const s = st.scale;
  const chars = [...text];
  const cells: [number, number][] = [];
  let cx = 0;
  chars.forEach((ch, i) => {
    const g = glyph(ch);
    if (i < count)
      for (let gy = 0; gy < FONT_ROWS; gy++) for (let gx = 0; gx < g.w; gx++) if (g.on[gy * g.w + gx]) cells.push([cx + gx, gy]);
    cx += g.w + 1;
  });
  const dot = (fx: number, fy: number, c: Color) => {
    const ox = x + fx * s, oy = y + fy * s;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) px(b, ox + xx, oy + yy, c);
  };
  if (st.shadow !== undefined) {
    const o = st.outline !== undefined ? 1 : 0;
    for (const [fx, fy] of cells) for (let d = 1; d <= 1 + o; d++) dot(fx + d, fy + d, st.shadow);
  }
  const solid = st.extrude !== undefined ? [...cells, ...cells.map(([fx, fy]) => [fx, fy + 1] as [number, number])] : cells;
  if (st.outline !== undefined)
    for (const [fx, fy] of solid)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) dot(fx + dx, fy + dy, st.outline);
  if (st.extrude !== undefined) for (const [fx, fy] of cells) dot(fx, fy + 1, st.extrude);
  for (const [fx, fy] of cells) dot(fx, fy, st.color);
}

/** Draw a line centred on `cx` (output px). Returns the left edge used. */
export function drawCentered(b: Rgba, text: string, cx: number, y: number, st: TextStyle, count = Infinity): number {
  const w = measure(text) * st.scale;
  const x = Math.round((cx - w / 2) / st.scale) * st.scale;
  drawString(b, text, x, y, st, count);
  return x;
}

/** Where the n-th character ends (font px from the line start): for a typing cursor. */
export function advanceTo(text: string, n: number): number {
  let w = 0;
  [...text].slice(0, n).forEach((ch) => (w += glyph(ch).w + 1));
  return w;
}
