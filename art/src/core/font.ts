// Tiny 3x5 bitmap font for labels drawn into buffers (contact sheets, small canvas numerals).
// Real UI text is DOM text in a pixel web font; this is only for in-buffer labels.

import type { Rgba } from './buffer.ts';
import { px } from './buffer.ts';
import type { Color } from './palette.ts';

const G: Record<string, string> = {
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#.#|###|###|#.#|#.#', N: '##.|#.#|#.#|#.#|#.#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..',
  Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.',
  U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#.#|#.#|###|###|#.#', X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#', '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
  ' ': '...|...|...|...|...', '-': '...|...|###|...|...', '.': '...|...|...|...|.#.', ':': '...|.#.|...|.#.|...',
  '/': '..#|..#|.#.|#..|#..', '+': '...|.#.|###|.#.|...', '(': '.#.|#..|#..|#..|.#.', ')': '.#.|..#|..#|..#|.#.',
  '#': '#.#|###|#.#|###|#.#', '!': '.#.|.#.|.#.|...|.#.', '?': '##.|..#|.#.|...|.#.', '=': '...|###|...|###|...',
  _: '...|...|...|...|###', ',': '...|...|...|.#.|#..', "'": '.#.|.#.|...|...|...', x: '...|#.#|.#.|#.#|...',
  '<': '..#|.#.|#..|.#.|..#', '>': '#..|.#.|..#|.#.|#..', '%': '#.#|..#|.#.|#..|#.#', '$': '.##|##.|.#.|.##|##.',
};

const CACHE = new Map<string, boolean[]>();
function glyph(ch: string): boolean[] {
  let g = CACHE.get(ch);
  if (!g) {
    const src = G[ch] ?? G[ch.toUpperCase()] ?? G['?'];
    g = src.replace(/\|/g, '').split('').map((c) => c === '#');
    CACHE.set(ch, g);
  }
  return g;
}

export const FONT_W = 3;
export const FONT_H = 5;

export function textWidth(text: string, scale = 1): number {
  return text.length ? (text.length * (FONT_W + 1) - 1) * scale : 0;
}

/** Draw text; returns the width in pixels. */
export function drawText(b: Rgba, text: string, x: number, y: number, c: Color, o: { shadow?: Color; scale?: number } = {}): number {
  const s = o.scale ?? 1;
  let cx = x;
  for (const ch of text.toUpperCase() === text ? text : text.toUpperCase()) {
    const g = glyph(ch === 'x' ? 'x' : ch);
    for (let i = 0; i < 15; i++) {
      if (!g[i]) continue;
      const gx = i % 3, gy = (i / 3) | 0;
      for (let yy = 0; yy < s; yy++)
        for (let xx = 0; xx < s; xx++) {
          if (o.shadow !== undefined) px(b, cx + gx * s + xx + s, y + gy * s + yy + s, o.shadow);
        }
    }
    for (let i = 0; i < 15; i++) {
      if (!g[i]) continue;
      const gx = i % 3, gy = (i / 3) | 0;
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) px(b, cx + gx * s + xx, y + gy * s + yy, c);
    }
    cx += (FONT_W + 1) * s;
  }
  return cx - x - s;
}
