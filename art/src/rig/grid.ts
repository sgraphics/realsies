// Role grids: parts are authored as maps of palette ROLES (skin base, hair shadow, primary
// highlight, fixed white...), not colours. A look binds roles to ramps, so one part map yields
// every palette swap. Pipeline per part: author -> mirror -> bevel (light from top-left) ->
// colourise -> 1-px outline in the darker shade -> RGBA sprite.

import { type Rgba, createBuffer } from '../core/buffer.ts';
import { type Color, PAL, type Ramp, darker } from '../core/palette.ts';

export const GW = 32;
export const GH = 48;

/** Ramp slots a part can reference. S = skin, H = hair, P/Q/A = the layer's primary/secondary/accent, I = item. */
export type Slot = 'S' | 'H' | 'P' | 'Q' | 'A' | 'I';
export const SLOTS: Slot[] = ['S', 'H', 'P', 'Q', 'A', 'I'];

// code 0 = empty; 1..24 = ramp slot * 4 + shade + 1 (shade 0 hi, 1 base, 2 shadow, 3 dark); 100+ = fixed colour
const FIXED: Color[] = [
  PAL.white, PAL.greyLight, PAL.grey, PAL.slate, PAL.black, PAL.navyDark, PAL.red, PAL.redDark, PAL.yellow, PAL.gold,
  PAL.orange, PAL.brownLight, PAL.brown, PAL.plum, PAL.pink, PAL.blue, PAL.blueDark, PAL.cyan, PAL.lime, PAL.green,
  PAL.purple, PAL.magenta, PAL.tan, PAL.cream, PAL.hotRed, PAL.peach, PAL.skinMid, PAL.greenDark, PAL.navy, PAL.rust,
];
const FIXED_CHARS = 'WwGgKkRrYyONnMmBbCLlVXTcZFfDUJ';

export function code(slot: Slot, shade: 0 | 1 | 2 | 3): number {
  return 1 + SLOTS.indexOf(slot) * 4 + shade;
}
export function fixedCode(c: Color): number {
  const i = FIXED.indexOf(c);
  if (i < 0) throw new Error('not a fixed colour');
  return 100 + i;
}
export function slotOf(c: number): Slot | null {
  return c >= 1 && c <= 24 ? SLOTS[((c - 1) / 4) | 0] : null;
}
export function shadeOf(c: number): number {
  return c >= 1 && c <= 24 ? (c - 1) % 4 : -1;
}
function withShade(c: number, shade: number): number {
  return c >= 1 && c <= 24 ? c - ((c - 1) % 4) + shade : c;
}

// Character -> role code. '.' and ' ' are transparent (skipped when stamping).
const CHAR_CODES: Record<string, number> = {};
const RAMP_CHARS: [string, Slot, number][] = [
  ['S', 'S', 1], ['s', 'S', 2], ['^', 'S', 0], ['x', 'S', 3],
  ['H', 'H', 1], ['h', 'H', 2], ['"', 'H', 0], ['j', 'H', 3],
  ['P', 'P', 1], ['p', 'P', 2], ['*', 'P', 0], ['t', 'P', 3],
  ['Q', 'Q', 1], ['q', 'Q', 2], ['+', 'Q', 0], ['u', 'Q', 3],
  ['A', 'A', 1], ['a', 'A', 2], ['!', 'A', 0], ['v', 'A', 3],
  ['I', 'I', 1], ['i', 'I', 2], ['~', 'I', 0], ['e', 'I', 3],
];
for (const [ch, slot, shade] of RAMP_CHARS) CHAR_CODES[ch] = code(slot, shade as 0 | 1 | 2 | 3);
for (let i = 0; i < FIXED_CHARS.length; i++) CHAR_CODES[FIXED_CHARS[i]] = 100 + i;
// 'o' = the dark shade of the part's main slot (resolved when stamping)

export interface StampOpts {
  mirror?: boolean; // rows are the left part; mirror around the canvas centre (x -> 31 - x)
  main?: Slot; // slot for 'o'
  flipX?: boolean; // flip the stamped rows around the canvas centre (no copy)
}

export class Grid {
  cells = new Uint8Array(GW * GH);
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return 0;
    return this.cells[y * GW + x];
  }
  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return;
    this.cells[y * GW + x] = c;
  }
  /** Set (x, y) and its mirror (31 - x, y). */
  sym(x: number, y: number, c: number): void {
    this.set(x, y, c);
    this.set(GW - 1 - x, y, c);
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  rectSym(x: number, y: number, w: number, h: number, c: number): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.sym(xx, yy, c);
  }
  hline(x0: number, x1: number, y: number, c: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }
  /** Stamp ASCII rows with the top-left at (x0, y0). */
  stamp(x0: number, y0: number, rows: readonly string[], o: StampOpts = {}): this {
    const main = o.main ?? 'P';
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        let c = ch === 'o' ? code(main, 3) : ch === '_' ? 0 : CHAR_CODES[ch];
        if (c === undefined) throw new Error(`unknown role char '${ch}'`);
        const x = x0 + i, y = y0 + r;
        if (o.flipX) this.set(GW - 1 - x, y, c);
        else if (o.mirror) this.sym(x, y, c);
        else this.set(x, y, c);
      }
    }
    return this;
  }
  /** Replace every cell of one slot with another slot (same shade). */
  reslot(from: Slot, to: Slot): this {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (slotOf(c) === from) this.cells[i] = code(to, shadeOf(c) as 0 | 1 | 2 | 3);
    }
    return this;
  }
  clearAbove(y: number): this {
    this.cells.fill(0, 0, Math.max(0, y) * GW);
    return this;
  }
  clone(): Grid {
    const g = new Grid();
    g.cells.set(this.cells);
    return g;
  }
  /** Copy non-empty cells of g on top of this. */
  over(g: Grid): this {
    for (let i = 0; i < this.cells.length; i++) if (g.cells[i]) this.cells[i] = g.cells[i];
    return this;
  }
  flipped(): Grid {
    const g = new Grid();
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) g.set(GW - 1 - x, y, this.get(x, y));
    return g;
  }
  shifted(dx: number, dy: number): Grid {
    const g = new Grid();
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const c = this.get(x, y);
      if (c) g.set(x + dx, y + dy, c);
    }
    return g;
  }
  isEmpty(): boolean {
    return !this.cells.some((c) => c !== 0);
  }
  /**
   * Directional light from the top-left: base-shade cells on right/bottom edges go to shadow,
   * on top/left edges to highlight. Only base cells change, so authored shading wins.
   */
  bevel(o: { right?: number; bottom?: number; top?: number; left?: number; only?: Slot[] } = {}): this {
    const src = this.cells.slice();
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= GW || y >= GH ? 0 : src[y * GW + x]);
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        const c = src[y * GW + x];
        if (shadeOf(c) !== 1) continue;
        const slot = slotOf(c)!;
        if (o.only && !o.only.includes(slot)) continue;
        let edge = (dx: number, dy: number, n: number) => {
          for (let k = 1; k <= n; k++) if (!at(x + dx * k, y + dy * k)) return true;
          return false;
        };
        if (o.right && edge(1, 0, o.right)) this.cells[y * GW + x] = withShade(c, 2);
        else if (o.bottom && edge(0, 1, o.bottom)) this.cells[y * GW + x] = withShade(c, 2);
        else if (o.top && edge(0, -1, o.top)) this.cells[y * GW + x] = withShade(c, 0);
        else if (o.left && edge(-1, 0, o.left)) this.cells[y * GW + x] = withShade(c, 0);
      }
    return this;
  }
}

export type Bindings = Record<Slot, Ramp>;

export interface RenderOpts {
  outline?: boolean; // default true
  /** Outline colour override for every outline pixel. */
  outlineColor?: Color;
  /** Skip outline pixels that would land where this predicate is true (e.g. inside the face). */
  noOutlineAt?: (x: number, y: number) => boolean;
}

/** Colourise a grid with ramp bindings and add the 1-px outline. */
export function renderGrid(g: Grid, b: Bindings, o: RenderOpts = {}): Rgba {
  const out = createBuffer(GW, GH);
  const d = out.data;
  const colorOf = (c: number): Color => {
    if (c >= 100) return FIXED[c - 100];
    const slot = slotOf(c)!;
    return b[slot][shadeOf(c)];
  };
  const darkOf = (c: number): Color => {
    if (c >= 100) return darker(FIXED[c - 100], 2);
    const slot = slotOf(c)!;
    return b[slot][3];
  };
  const put = (i: number, col: Color) => {
    d[i * 4] = (col >> 16) & 255;
    d[i * 4 + 1] = (col >> 8) & 255;
    d[i * 4 + 2] = col & 255;
    d[i * 4 + 3] = 255;
  };
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) put(i, colorOf(g.cells[i]));
  if (o.outline !== false) {
    for (let y = 0; y < GH; y++)
      for (let x = 0; x < GW; x++) {
        if (g.get(x, y)) continue;
        if (o.noOutlineAt?.(x, y)) continue;
        const n = g.get(x, y - 1) || g.get(x, y + 1) || g.get(x - 1, y) || g.get(x + 1, y);
        if (n) put(y * GW + x, o.outlineColor ?? darkOf(n));
      }
  }
  return out;
}

/** Bounding box of opaque pixels, for fast blits. */
export interface Sprite {
  img: Rgba;
  x: number;
  y: number;
  w: number;
  h: number;
}
export function toSprite(img: Rgba): Sprite {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { img, x: 0, y: 0, w: 0, h: 0 };
  return { img, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
