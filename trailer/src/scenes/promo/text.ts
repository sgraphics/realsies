// The trailer's 5x7 pixel font (engine/font.ts) plus the few glyphs the promo assets need on top:
// % + = < > # * $ ; [ ] | and a middle dot, an arrow, a check and a multiplication sign. The base
// glyphs are read back from the engine font (drawn once at scale 1), so the two never drift apart.
// Also: coloured runs in one line (outline under the whole line), centring, word wrap.

import { type Rgba, type Color, createBuffer, get, TRANSPARENT } from '../../art.ts';
import { rectOut } from '../../engine/camera.ts';
import { drawString, measure, FONT_ROWS } from '../../engine/font.ts';

/** Extra glyphs, authored here as ASCII like the engine's (top row = ascender line, 7 rows + 2 descender rows). */
const EXTRA: Record<string, string[]> = {
  '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
  '+': ['.....', '.....', '..#..', '..#..', '#####', '..#..', '..#..'],
  '=': ['....', '....', '....', '####', '....', '####', '....'],
  '<': ['....', '...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '>': ['....', '#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  ';': ['..', '..', '..', '.#', '..', '.#', '.#', '#.'],
  '[': ['##', '#.', '#.', '#.', '#.', '#.', '##'],
  ']': ['##', '.#', '.#', '.#', '.#', '.#', '##'],
  '|': ['#', '#', '#', '#', '#', '#', '#', '#', '#'],
  '·': ['.', '.', '.', '.', '#', '.', '.'],
  '→': ['.......', '.......', '....#..', '.....#.', '######.', '.....#.', '....#..'],
  '✓': ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
  '×': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  '−': ['....', '....', '....', '....', '####', '....', '....'],
  '–': ['....', '....', '....', '....', '####', '....', '....'],
  '’': ['#', '#', '.', '.', '.', '.', '.'],
  // a non-breaking space: as wide as a space, but wrap() keeps the words either side together
  '\u00a0': ['...', '...', '...', '...', '...', '...', '...'],
};

interface Glyph {
  w: number;
  on: boolean[]; // FONT_ROWS * w
}
const CACHE = new Map<string, Glyph>();

function glyph(ch: string): Glyph {
  let g = CACHE.get(ch);
  if (g) return g;
  const rows = EXTRA[ch];
  if (rows) {
    const w = rows[0].length;
    const on: boolean[] = [];
    for (let y = 0; y < FONT_ROWS; y++) {
      const r = rows[y] ?? '.'.repeat(w);
      for (let x = 0; x < w; x++) on.push(r[x] === '#');
    }
    g = { w, on };
  } else {
    // the engine font: draw the character once at scale 1 and read it back
    const w = Math.max(1, measure(ch));
    const b = createBuffer(w, FONT_ROWS);
    drawString(b, ch, 0, 0, { color: 0xffffff, scale: 1 });
    const on: boolean[] = [];
    for (let y = 0; y < FONT_ROWS; y++) for (let x = 0; x < w; x++) on.push(get(b, x, y) !== TRANSPARENT);
    g = { w, on };
  }
  CACHE.set(ch, g);
  return g;
}

/** Width of a string in font pixels (1 px between glyphs). */
export function textW(text: string): number {
  let w = 0;
  for (const ch of text) w += glyph(ch).w + 1;
  return Math.max(0, w - 1);
}

export interface Style {
  color: Color;
  /** Output px per font px. */
  scale: number;
  /** A one-font-pixel outline on all eight sides. */
  outline?: Color;
  /** A one-font-pixel 3D extrusion under the face (inside the outline). */
  extrude?: Color;
  /** Drop shadow one font pixel down and right (two with an outline). */
  shadow?: Color;
}

/** A run of text in its own colour, for lines with an accent. */
export interface Run {
  text: string;
  color?: Color;
}

/**
 * Draw runs left to right as one line, top-left (ascender line) at (x, y) output px. Shadows,
 * outlines and extrusions go under every face of the line. `count` limits the characters shown.
 * Returns the width in output px.
 */
export function drawRuns(out: Rgba, runs: Run[], x: number, y: number, st: Style, count = Infinity): number {
  const s = st.scale;
  const cells: [number, number, Color][] = [];
  let cx = 0, n = 0;
  for (const r of runs)
    for (const ch of r.text) {
      const g = glyph(ch);
      if (n < count) for (let gy = 0; gy < FONT_ROWS; gy++) for (let gx = 0; gx < g.w; gx++) if (g.on[gy * g.w + gx]) cells.push([cx + gx, gy, r.color ?? st.color]);
      cx += g.w + 1;
      n++;
    }
  const dot = (fx: number, fy: number, c: Color) => rectOut(out, x + fx * s, y + fy * s, s, s, c);
  if (st.shadow !== undefined) {
    const o = st.outline !== undefined ? 1 : 0;
    for (const [fx, fy] of cells) for (let d = 1; d <= 1 + o; d++) dot(fx + d, fy + d, st.shadow);
  }
  if (st.outline !== undefined) {
    const solid = st.extrude !== undefined ? [...cells, ...cells.map(([fx, fy, c]) => [fx, fy + 1, c] as [number, number, Color])] : cells;
    for (const [fx, fy] of solid) rectOut(out, x + (fx - 1) * s, y + (fy - 1) * s, 3 * s, 3 * s, st.outline);
  }
  if (st.extrude !== undefined) for (const [fx, fy] of cells) dot(fx, fy + 1, st.extrude);
  for (const [fx, fy, c] of cells) dot(fx, fy, c);
  return Math.max(0, cx - 1) * s;
}

export function drawText(out: Rgba, text: string, x: number, y: number, st: Style, count = Infinity): number {
  return drawRuns(out, [{ text }], x, y, st, count);
}

/** Centre a line on cx (snapped to the font grid of its scale). Returns the left edge. */
export function drawTextC(out: Rgba, text: string | Run[], cx: number, y: number, st: Style, count = Infinity): number {
  const runs = typeof text === 'string' ? [{ text }] : text;
  const w = textW(runs.map((r) => r.text).join('')) * st.scale;
  const x = Math.round((cx - w / 2) / 2) * 2;
  drawRuns(out, runs, x, y, st, count);
  return x;
}

/** Right-align a line to x1. Returns the left edge. */
export function drawTextR(out: Rgba, text: string, x1: number, y: number, st: Style): number {
  const x = x1 - textW(text) * st.scale;
  drawText(out, text, x, y, st);
  return x;
}

/** Greedy word wrap to at most `max` font px per row. */
export function wrap(text: string, max: number): string[] {
  const rows: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const cand = cur ? cur + ' ' + w : w;
    if (!cur || textW(cand) <= max) cur = cand;
    else {
      rows.push(cur);
      cur = w;
    }
  }
  if (cur) rows.push(cur);
  return rows;
}

/** Line height (output px) of a style: 7 cap rows + 2 descender rows + a gap. */
export const lineH = (scale: number, gap = 3) => (FONT_ROWS + gap) * scale;
