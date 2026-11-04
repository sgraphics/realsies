// DOM-facing UI kit sprites built from a few theme colours: panels, buttons, bubbles, plates, tabs.
// Every edge row/column is uniform along its run so CSS border-image can stretch it cleanly.

import { type Rgba, createBuffer, px, get } from '../core/buffer.ts';
import { type Color, type Ramp, TRANSPARENT, PAL } from '../core/palette.ts';
import type { ButtonSet, NineSlice, UiKit } from './types.ts';

export interface UiSpec {
  /** Darkest outline used around everything. */
  outline: Color;
  /** Panel: rim ramp [hi, base, lo, dark], inner fill, inner line, optional rivet colour. */
  panelRim: Ramp;
  panelFill: Color;
  panelLine: Color;
  rivet?: Color;
  button: Ramp;
  primary: Ramp;
  yes: Ramp;
  no: Ramp;
  bubbleThem: { fill: Color; shade: Color; line: Color };
  bubbleMe: { fill: Color; shade: Color; line: Color };
  plate: Ramp;
  plateFill: Color;
}

function rounded(w: number, h: number, x: number, y: number, r: number): boolean {
  // true if (x, y) is inside a w x h rect with corners cut by radius r (pixel stair)
  const cx = x < r ? r - x : x > w - 1 - r ? x - (w - 1 - r) : 0;
  const cy = y < r ? r - y : y > h - 1 - r ? y - (h - 1 - r) : 0;
  if (!cx || !cy) return true;
  return cx + cy <= r; // diamond-ish corner, crisp at small sizes
}

function panelSprite(s: UiSpec): NineSlice {
  const W = 18, H = 18;
  const b = createBuffer(W, H);
  const [hi, base, lo] = s.panelRim;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rounded(W, H, x, y, 2)) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let c: Color;
      if (e === 0) c = s.outline;
      else if (e === 1 || e === 2) {
        // rim band, lit from the top-left
        const topLeft = y <= 2 || x <= 2;
        const botRight = y >= H - 3 || x >= W - 3;
        c = topLeft && !botRight ? (e === 1 ? hi : base) : botRight && !topLeft ? (e === 1 ? base : lo) : base;
        if (topLeft && botRight) c = base;
      } else if (e === 3) c = s.panelLine;
      else c = s.panelFill;
      px(b, x, y, c);
    }
  // corner rounding outline fix
  outlineAround(b, s.outline);
  if (s.rivet) {
    for (const [x, y] of [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]] as const) px(b, x, y, s.rivet);
  }
  return { img: b, slice: 6, pad: 6 };
}

function outlineAround(b: Rgba, c: Color): void {
  // make sure the diagonal cut corners get an outline pixel too
  const add: [number, number][] = [];
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (get(b, x, y) !== TRANSPARENT) continue;
      const n = (get(b, x + 1, y) !== TRANSPARENT && get(b, x + 1, y) !== c) || (get(b, x - 1, y) !== TRANSPARENT && get(b, x - 1, y) !== c) ||
        (get(b, x, y + 1) !== TRANSPARENT && get(b, x, y + 1) !== c) || (get(b, x, y - 1) !== TRANSPARENT && get(b, x, y - 1) !== c);
      if (n) add.push([x, y]);
    }
  for (const [x, y] of add) px(b, x, y, c);
}

function buttonSprite(r: Ramp, outline: Color, state: 'up' | 'down' | 'disabled'): NineSlice {
  const W = 16, H = 16;
  const b = createBuffer(W, H);
  let [hi, base, lo, dk] = r;
  if (state === 'disabled') {
    hi = PAL.grey;
    base = PAL.slate;
    lo = PAL.navy;
    dk = PAL.navyDark;
  }
  const down = state === 'down';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rounded(W, H, x, y, 2)) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let c: Color;
      if (e === 0) c = outline;
      else if (!down) {
        if (y >= H - 4) c = y >= H - 3 ? dk : lo; // 3D lip
        else if (y === 1 || x === 1) c = hi;
        else if (x === W - 2) c = lo;
        else c = base;
      } else {
        if (y === 1 || y === 2) c = dk; // pressed: inset shadow at the top
        else if (y >= H - 2) c = lo;
        else if (x === 1) c = lo;
        else c = base;
      }
      px(b, x, y, c);
    }
  // a pixel of shine on the top-left of raised buttons
  if (!down && state !== 'disabled') {
    px(b, 2, 2, PAL.white);
    px(b, 3, 2, hi);
  }
  return { img: b, slice: 5, pad: 4 };
}

function buttonSet(r: Ramp, outline: Color): ButtonSet {
  return { up: buttonSprite(r, outline, 'up'), down: buttonSprite(r, outline, 'down'), disabled: buttonSprite(r, outline, 'disabled') };
}

function bubbleSprite(fill: Color, shade: Color, line: Color): NineSlice {
  const W = 14, H = 14;
  const b = createBuffer(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rounded(W, H, x, y, 3)) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let c: Color;
      if (e === 0) c = line;
      else if (x === W - 2 && y > 2 && y < H - 3) c = shade; // soft right side, keeps the bottom flat for the tail
      else c = fill;
      px(b, x, y, c);
    }
  outlineAround(b, line);
  return { img: b, slice: 5, pad: 4 };
}

/**
 * Speech tail, 8x6. Its first row overlaps the bubble's bottom outline (place it 1 px up), so the
 * bubble opens into the tail. them: points down-left; me: mirrored, points down-right.
 */
function tailSprite(fill: Color, _shade: Color, line: Color, right: boolean): Rgba {
  const rows = ['.lffffl.', '.lfffl..', 'lfffl...', 'lffl....', 'lfl.....', 'll......'];
  const map: Record<string, Color> = { f: fill, l: line };
  const b = createBuffer(8, 6);
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 8; x++) {
      const ch = rows[y][right ? 7 - x : x];
      if (ch !== '.') px(b, x, y, map[ch]);
    }
  return b;
}

function plateSprite(r: Ramp, fill: Color, outline: Color): NineSlice {
  const W = 14, H = 12;
  const b = createBuffer(W, H);
  const [hi, base, lo, dk] = r;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rounded(W, H, x, y, 1)) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let c: Color;
      if (e === 0) c = outline;
      else if (e === 1) c = y === 1 || x === 1 ? hi : y === H - 2 || x === W - 2 ? lo : base;
      else if (e === 2) c = dk;
      else c = fill;
      px(b, x, y, c);
    }
  px(b, 1, 1, base);
  px(b, W - 2, 1, base);
  return { img: b, slice: 4, pad: 4 };
}

function tabSprite(r: Ramp, outline: Color, active: boolean): NineSlice {
  const W = 14, H = 14;
  const b = createBuffer(W, H);
  const [hi, base, lo, dk] = r;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!rounded(W, H, x, y, 2)) continue;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let c: Color;
      if (e === 0) c = outline;
      else if (active) c = y === 1 ? PAL.white : y >= H - 3 ? lo : x === 1 ? hi : base;
      else c = y === 1 ? base : y >= H - 3 ? dk : lo;
      px(b, x, y, c);
    }
  return { img: b, slice: 5, pad: 3 };
}

export function buildUi(s: UiSpec): UiKit {
  return {
    panel: panelSprite(s),
    button: buttonSet(s.button, s.outline),
    buttonPrimary: buttonSet(s.primary, s.outline),
    buttonYes: buttonSet(s.yes, s.outline),
    buttonNo: buttonSet(s.no, s.outline),
    bubbleThem: bubbleSprite(s.bubbleThem.fill, s.bubbleThem.shade, s.bubbleThem.line),
    bubbleMe: bubbleSprite(s.bubbleMe.fill, s.bubbleMe.shade, s.bubbleMe.line),
    tailThem: tailSprite(s.bubbleThem.fill, s.bubbleThem.shade, s.bubbleThem.line, false),
    tailMe: tailSprite(s.bubbleMe.fill, s.bubbleMe.shade, s.bubbleMe.line, true),
    plate: plateSprite(s.plate, s.plateFill, s.outline),
    tab: { up: tabSprite(s.button, s.outline, false), active: tabSprite(s.primary, s.outline, true) },
  };
}
