// RGBA pixel buffers and drawing primitives. No DOM: runs in the browser and in Node.
// All coordinates are whole game pixels. Alpha is either 0 or 255 (pixel art, no blending),
// except `shadow` helpers which darken through the master palette instead of blending.

import { type Color, TRANSPARENT, darker, lighter } from './palette.ts';

export interface Rgba {
  w: number;
  h: number;
  data: Uint8ClampedArray; // w * h * 4
}

export function createBuffer(w: number, h: number): Rgba {
  return { w, h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
}

export function cloneBuffer(b: Rgba): Rgba {
  return { w: b.w, h: b.h, data: new Uint8ClampedArray(b.data) };
}

/** Copy src into dst (same size). Faster than blit for full-frame backgrounds. */
export function copyInto(dst: Rgba, src: Rgba): void {
  if (dst.w === src.w && dst.h === src.h) dst.data.set(src.data);
  else blit(dst, src, 0, 0, { opaque: true });
}

export function clear(b: Rgba, c: Color = TRANSPARENT): void {
  if (c === TRANSPARENT) {
    b.data.fill(0);
    return;
  }
  const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
  const d = b.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = bl;
    d[i + 3] = 255;
  }
}

export function inBounds(b: Rgba, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < b.w && y < b.h;
}

export function px(b: Rgba, x: number, y: number, c: Color): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const i = (y * b.w + x) * 4;
  if (c === TRANSPARENT) {
    b.data[i + 3] = 0;
    return;
  }
  b.data[i] = (c >> 16) & 255;
  b.data[i + 1] = (c >> 8) & 255;
  b.data[i + 2] = c & 255;
  b.data[i + 3] = 255;
}

export function get(b: Rgba, x: number, y: number): Color {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return TRANSPARENT;
  const i = (y * b.w + x) * 4;
  if (b.data[i + 3] === 0) return TRANSPARENT;
  return (b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2];
}

export function rect(b: Rgba, x: number, y: number, w: number, h: number, c: Color): void {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
  const x1 = Math.min(b.w, (x + w) | 0), y1 = Math.min(b.h, (y + h) | 0);
  if (x1 <= x0 || y1 <= y0) return;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255, a = c === TRANSPARENT ? 0 : 255;
  const d = b.data;
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * b.w + x0) * 4;
    for (let xx = x0; xx < x1; xx++, i += 4) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = bl;
      d[i + 3] = a;
    }
  }
}

export function strokeRect(b: Rgba, x: number, y: number, w: number, h: number, c: Color): void {
  hline(b, x, x + w - 1, y, c);
  hline(b, x, x + w - 1, y + h - 1, c);
  vline(b, x, y, y + h - 1, c);
  vline(b, x + w - 1, y, y + h - 1, c);
}

export function hline(b: Rgba, x0: number, x1: number, y: number, c: Color): void {
  if (x1 < x0) [x0, x1] = [x1, x0];
  rect(b, x0, y, x1 - x0 + 1, 1, c);
}

export function vline(b: Rgba, x: number, y0: number, y1: number, c: Color): void {
  if (y1 < y0) [y0, y1] = [y1, y0];
  rect(b, x, y0, 1, y1 - y0 + 1, c);
}

/** Bresenham line. */
export function line(b: Rgba, x0: number, y0: number, x1: number, y1: number, c: Color): void {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    px(b, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled ellipse inside the box (x, y, w, h). Pixel-centre test, so small sizes look round. */
export function ellipse(b: Rgba, x: number, y: number, w: number, h: number, c: Color): void {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const nx = (x + xx + 0.5 - cx) / rx, ny = (y + yy + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1.0) px(b, x + xx, y + yy, c);
    }
  }
}

export function circle(b: Rgba, cx: number, cy: number, r: number, c: Color): void {
  ellipse(b, Math.round(cx - r), Math.round(cy - r), Math.round(r * 2), Math.round(r * 2), c);
}

/** Ellipse outline only (1 px). */
export function ellipseRing(b: Rgba, x: number, y: number, w: number, h: number, c: Color): void {
  const tmp = createBuffer(w + 2, h + 2);
  ellipse(tmp, 1, 1, w, h, 0xffffff);
  for (let yy = 0; yy < h + 2; yy++)
    for (let xx = 0; xx < w + 2; xx++) {
      if (get(tmp, xx, yy) === TRANSPARENT) continue;
      if (
        get(tmp, xx - 1, yy) === TRANSPARENT || get(tmp, xx + 1, yy) === TRANSPARENT ||
        get(tmp, xx, yy - 1) === TRANSPARENT || get(tmp, xx, yy + 1) === TRANSPARENT
      ) px(b, x + xx - 1, y + yy - 1, c);
    }
}

export type DitherPattern = 'checker' | 'sparse' | 'dense' | 'hlines' | 'vlines';
/** True when pixel (x, y) takes the second colour of a dither pattern. */
export function ditherAt(p: DitherPattern, x: number, y: number): boolean {
  switch (p) {
    case 'checker': return ((x + y) & 1) === 0;
    case 'sparse': return (x & 1) === 0 && (y & 1) === 0 && (((x >> 1) + (y >> 1)) & 1) === 0; // 1 in 8
    case 'dense': return !((x & 1) === 0 && (y & 1) === 0); // 3 in 4
    case 'hlines': return (y & 1) === 0;
    case 'vlines': return (x & 1) === 0;
  }
}

export function ditherRect(b: Rgba, x: number, y: number, w: number, h: number, c1: Color, c2: Color, p: DitherPattern = 'checker'): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) px(b, xx, yy, ditherAt(p, xx, yy) ? c2 : c1);
}

/**
 * Vertical gradient through a list of palette colours with ordered dithering at the seams.
 * `stops` go top to bottom.
 */
export function vGradient(b: Rgba, x: number, y: number, w: number, h: number, stops: Color[]): void {
  if (stops.length === 1 || h <= 1) {
    rect(b, x, y, w, h, stops[0]);
    return;
  }
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const n = stops.length - 1;
  for (let yy = 0; yy < h; yy++) {
    const t = (yy / (h - 1)) * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i; // 0..1 between stops i and i+1
    for (let xx = 0; xx < w; xx++) {
      const th = (bayer[((yy + y) & 3) * 4 + ((xx + x) & 3)] + 0.5) / 16;
      px(b, x + xx, y + yy, f > th ? stops[i + 1] : stops[i]);
    }
  }
}

export interface BlitOpts {
  flipX?: boolean;
  flipY?: boolean;
  opaque?: boolean; // copy transparent pixels too
  /** Source sub-rectangle. */
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  /** Replace every opaque pixel with this colour (silhouettes, flashes). */
  tint?: Color;
}

/** Alpha-tested copy of src (or a sub-rect) into dst at (dx, dy). */
export function blit(dst: Rgba, src: Rgba, dx: number, dy: number, o: BlitOpts = {}): void {
  const sx = o.sx ?? 0, sy = o.sy ?? 0, sw = o.sw ?? src.w, sh = o.sh ?? src.h;
  dx |= 0;
  dy |= 0;
  const s = src.data, d = dst.data;
  const tr = o.tint !== undefined ? (o.tint >> 16) & 255 : 0;
  const tg = o.tint !== undefined ? (o.tint >> 8) & 255 : 0;
  const tb = o.tint !== undefined ? o.tint & 255 : 0;
  for (let yy = 0; yy < sh; yy++) {
    const ty = dy + yy;
    if (ty < 0 || ty >= dst.h) continue;
    const syy = sy + (o.flipY ? sh - 1 - yy : yy);
    for (let xx = 0; xx < sw; xx++) {
      const tx = dx + xx;
      if (tx < 0 || tx >= dst.w) continue;
      const sxx = sx + (o.flipX ? sw - 1 - xx : xx);
      const si = (syy * src.w + sxx) * 4;
      const a = s[si + 3];
      if (a === 0 && !o.opaque) continue;
      const di = (ty * dst.w + tx) * 4;
      if (o.tint !== undefined && a !== 0) {
        d[di] = tr; d[di + 1] = tg; d[di + 2] = tb; d[di + 3] = 255;
      } else {
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = a;
      }
    }
  }
}

/** Nearest-neighbour integer upscale (for sheets and big sprites). */
export function scaleUp(src: Rgba, k: number): Rgba {
  k = Math.max(1, k | 0);
  if (k === 1) return cloneBuffer(src);
  const out = createBuffer(src.w * k, src.h * k);
  const s = src.data, d = out.data;
  for (let y = 0; y < out.h; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < out.w; x++) {
      const si = (sy * src.w + ((x / k) | 0)) * 4;
      const di = (y * out.w + x) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
    }
  }
  return out;
}

/** Crop a region into a new buffer. */
export function crop(src: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const out = createBuffer(w, h);
  blit(out, src, 0, 0, { sx: x, sy: y, sw: w, sh: h, opaque: true });
  return out;
}

/** Darken (or lighten) existing opaque pixels through the master palette where mask(x, y) is true. */
export function shadePixels(b: Rgba, x: number, y: number, w: number, h: number, steps: number, mask?: (x: number, y: number) => boolean): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      if (mask && !mask(xx, yy)) continue;
      const c = get(b, xx, yy);
      if (c === TRANSPARENT) continue;
      px(b, xx, yy, steps >= 0 ? darker(c, steps) : lighter(c, -steps));
    }
}

/** Darkened ellipse (a cast shadow): darkens what is already there by one palette step. */
export function shadowEllipse(b: Rgba, x: number, y: number, w: number, h: number, steps = 1): void {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const nx = (x + xx + 0.5 - cx) / rx, ny = (y + yy + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const c = get(b, x + xx, y + yy);
      if (c !== TRANSPARENT) px(b, x + xx, y + yy, darker(c, steps));
    }
}

/**
 * Draw a 9-slice sprite stretched to (w, h) by tiling the edges and centre.
 * `slice` = width of the fixed border in source pixels (same on all sides), or [left, top, right, bottom].
 */
export function nineSlice(dst: Rgba, src: Rgba, slice: number | [number, number, number, number], x: number, y: number, w: number, h: number, fill = true): void {
  const [l, t, r, bt] = typeof slice === 'number' ? [slice, slice, slice, slice] : slice;
  const cw = src.w - l - r, ch = src.h - t - bt;
  const iw = w - l - r, ih = h - t - bt;
  // corners
  blit(dst, src, x, y, { sx: 0, sy: 0, sw: l, sh: t });
  blit(dst, src, x + w - r, y, { sx: src.w - r, sy: 0, sw: r, sh: t });
  blit(dst, src, x, y + h - bt, { sx: 0, sy: src.h - bt, sw: l, sh: bt });
  blit(dst, src, x + w - r, y + h - bt, { sx: src.w - r, sy: src.h - bt, sw: r, sh: bt });
  // edges, tiled
  for (let ox = 0; ox < iw; ox += cw) {
    const sw = Math.min(cw, iw - ox);
    blit(dst, src, x + l + ox, y, { sx: l, sy: 0, sw, sh: t });
    blit(dst, src, x + l + ox, y + h - bt, { sx: l, sy: src.h - bt, sw, sh: bt });
  }
  for (let oy = 0; oy < ih; oy += ch) {
    const sh = Math.min(ch, ih - oy);
    blit(dst, src, x, y + t + oy, { sx: 0, sy: t, sw: l, sh });
    blit(dst, src, x + w - r, y + t + oy, { sx: src.w - r, sy: t, sw: r, sh });
  }
  if (fill)
    for (let oy = 0; oy < ih; oy += ch)
      for (let ox = 0; ox < iw; ox += cw)
        blit(dst, src, x + l + ox, y + t + oy, { sx: l, sy: t, sw: Math.min(cw, iw - ox), sh: Math.min(ch, ih - oy) });
}

/** Add a 1-px outline around every opaque pixel group: transparent 4-neighbours get colour `c` (or darker(neighbour)). */
export function outline(b: Rgba, c?: Color, diagonal = false): void {
  const add: number[] = [];
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (get(b, x, y) !== TRANSPARENT) continue;
      const n = [get(b, x, y + 1), get(b, x, y - 1), get(b, x - 1, y), get(b, x + 1, y)];
      if (diagonal) n.push(get(b, x - 1, y - 1), get(b, x + 1, y - 1), get(b, x - 1, y + 1), get(b, x + 1, y + 1));
      const hit = n.find((v) => v !== TRANSPARENT);
      if (hit !== undefined) add.push(x, y, c ?? darker(hit, 2));
    }
  for (let i = 0; i < add.length; i += 3) px(b, add[i], add[i + 1], add[i + 2]);
}

/** Every opaque pixel's colour, for palette QA. */
export function colorsOf(b: Rgba): Set<Color> {
  const s = new Set<Color>();
  const d = b.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return s;
}
