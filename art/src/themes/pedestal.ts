// Pedestal sprites: a shared 48x24 footprint (top face, front face, plinth) painted per theme, plus
// generic state variants (empty, occupied, dim, hover, selected glow). There is no name plate: the
// lower part dissolves into the floor with an ordered dither and the DOM gamertag sits beneath.

import { type Rgba, createBuffer, get, px, cloneBuffer } from '../core/buffer.ts';
import { type Color, type Ramp, TRANSPARENT, darker, lighter } from '../core/palette.ts';
import type { PedestalSprites } from './types.ts';
import { PED_W, PED_H } from '../scene/layout.ts';
import { bayer } from './util.ts';

/** Top face ellipse of every pedestal (feet of a 32x48 character at row 45 land at y = 5). */
export const PED_TOP = { x: 3, y: 1, w: 42, h: 10 };

export function inTop(x: number, y: number, grow = 0): boolean {
  const rx = PED_TOP.w / 2 + grow, ry = PED_TOP.h / 2 + grow * 0.5;
  const cx = PED_TOP.x + PED_TOP.w / 2, cy = PED_TOP.y + PED_TOP.h / 2;
  const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
  return nx * nx + ny * ny <= 1;
}

export interface PedPaint {
  b: Rgba;
}

/** Standard cylinder body: front face shaded left-light to right-dark, curved bottom. */
export function cylinder(b: Rgba, side: Ramp, top: Ramp, outline: Color, o: { bottom?: number; top?: number; flatBottom?: boolean } = {}): void {
  const yTop = PED_TOP.y + PED_TOP.h / 2;
  const yBot = o.bottom ?? 18;
  const x0 = PED_TOP.x, x1 = PED_TOP.x + PED_TOP.w - 1;
  const cx = (x0 + x1) / 2, rx = (x1 - x0 + 1) / 2;
  for (let x = x0; x <= x1; x++) {
    const nx = (x + 0.5 - (cx + 0.5)) / rx;
    const by = yBot + (o.flatBottom ? 0 : Math.round(3 * Math.sqrt(Math.max(0, 1 - nx * nx))));
    for (let y = Math.floor(yTop); y <= by; y++) {
      // cylinder shading by column
      const t = (nx + 1) / 2; // 0 left .. 1 right
      let c: Color;
      if (t < 0.12) c = side[1];
      else if (t < 0.3) c = (t - 0.12) / 0.18 > bayer(x, y) ? side[0] : side[1];
      else if (t < 0.55) c = side[0];
      else if (t < 0.7) c = (t - 0.55) / 0.15 > bayer(x, y) ? side[1] : side[0];
      else if (t < 0.86) c = side[1];
      else c = side[2];
      px(b, x, y, c);
    }
  }
  // top face
  for (let y = 0; y < PED_H; y++)
    for (let x = 0; x < PED_W; x++) {
      if (!inTop(x, y)) continue;
      const edge = !inTop(x, y - 1) || !inTop(x - 1, y);
      const back = !inTop(x, y + 1) || !inTop(x + 1, y);
      let c = top[1];
      if (edge && y < PED_TOP.y + 4) c = top[2]; // far rim reads darker (seen from above)
      if (back && y > PED_TOP.y + 5) c = top[0]; // near lip catches the light
      px(b, x, y, c);
    }
  outlineSprite(b, outline);
}

/** First row of the fade: rows above stay solid (top face and the upper front face). */
export const FADE_FROM = 12;
/** Rows from here down are fully transparent. */
export const FADE_TO = 22;

/**
 * Dissolve the lower part of a pedestal sprite into whatever is behind it: an ordered (Bayer)
 * dither drops more pixels row by row, so the floor shows through, like a semi-transparent base.
 */
export function fadeBase(b: Rgba): void {
  for (let y = FADE_FROM; y < b.h; y++) {
    const t = Math.min(1, (y - FADE_FROM + 1) / (FADE_TO - FADE_FROM + 1)); // 0 solid .. 1 gone
    for (let x = 0; x < b.w; x++) if (bayer(x, y) < t) px(b, x, y, TRANSPARENT);
  }
}

/** Outline every opaque group with a darker shade or the given colour (4-neighbour). */
export function outlineSprite(b: Rgba, c?: Color): void {
  const add: [number, number, Color][] = [];
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (get(b, x, y) !== TRANSPARENT) continue;
      const n = [get(b, x, y - 1), get(b, x - 1, y), get(b, x + 1, y), get(b, x, y + 1)].find((v) => v !== TRANSPARENT);
      if (n !== undefined) add.push([x, y, c ?? darker(n, 2)]);
    }
  for (const [x, y, col] of add) px(b, x, y, col);
}

function mapAll(src: Rgba, f: (c: Color, x: number, y: number) => Color): Rgba {
  const out = cloneBuffer(src);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = get(src, x, y);
      if (c !== TRANSPARENT) px(out, x, y, f(c, x, y));
    }
  return out;
}

/**
 * Build all states from a painter. `glow` = [light, mid, dark] accent colours for selection.
 */
export function buildPedestals(paint: (b: Rgba) => void, glow: [Color, Color, Color]): PedestalSprites {
  const base = createBuffer(PED_W, PED_H);
  paint(base);
  fadeBase(base);
  const occupied = base;
  const empty = mapAll(base, (c, x, y) => (inTop(x, y) ? darker(c, 1) : c));
  const dim = mapAll(base, (c) => darker(c, 1));
  const hover = mapAll(base, (c, x, y) => (inTop(x, y) ? lighter(c, 1) : c));
  const selected: Rgba[] = [];
  for (let f = 0; f < 4; f++) {
    const s = mapAll(base, (c, x, y) => {
      if (!inTop(x, y)) return c;
      // glowing top face: rim in light accent, inside brightened in a pulsing ring
      const rim = !inTop(x, y - 1) || !inTop(x, y + 1) || !inTop(x - 1, y) || !inTop(x + 1, y);
      if (rim) return f % 2 === 0 ? glow[0] : glow[1];
      return lighter(c, f === 1 || f === 2 ? 2 : 1);
    });
    // light spill on the face just under the top
    for (let x = PED_TOP.x + 2; x < PED_TOP.x + PED_TOP.w - 2; x++) {
      const y = PED_TOP.y + PED_TOP.h;
      if (get(s, x, y) !== TRANSPARENT && (x + f) % 2 === 0) px(s, x, y, lighter(get(s, x, y), 1));
    }
    selected.push(s);
  }
  return { empty, occupied, dim, hover, selected };
}
