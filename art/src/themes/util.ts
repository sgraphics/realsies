// Shared drawing helpers for theme kits and scenes: a painter with a depth mask, value noise,
// arch geometry, glows and clipped prop drawing. Whole pixels and master palette only.

import { type Rgba, createBuffer, get } from '../core/buffer.ts';
import { type Color, TRANSPARENT, darker, lighter } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';

/** Depth of a pixel in a composed scene, so animated props can tuck behind walls. */
export const L_DEEP = 0; // deep background (inside arches, windows)
export const L_FLOOR = 1; // deep floor inside the arch
export const L_WALL = 2; // room wall around openings
export const L_ARCH = 3; // arch border stones
export const L_DECO = 4; // static decoration on the wall (pillar, plates, sconces)
export const L_FRAME = 6; // foreground frame

export interface Paint {
  b: Rgba;
  mask: Uint8Array;
  w: number;
  h: number;
}

export function newPaint(w: number, h: number): Paint {
  return { b: createBuffer(w, h), mask: new Uint8Array(w * h), w, h };
}

/** Set a pixel and its depth layer. */
export function put(p: Paint, x: number, y: number, c: Color, layer: number): void {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= p.w || y >= p.h || c === TRANSPARENT) return;
  const i = y * p.w + x;
  const d = p.b.data, j = i * 4;
  d[j] = (c >> 16) & 255;
  d[j + 1] = (c >> 8) & 255;
  d[j + 2] = c & 255;
  d[j + 3] = 255;
  p.mask[i] = layer;
}

export function fill(p: Paint, x: number, y: number, w: number, h: number, c: Color, layer: number): void {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
  const x1 = Math.min(p.w, (x + w) | 0), y1 = Math.min(p.h, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) put(p, xx, yy, c, layer);
}

export function getc(p: Paint, x: number, y: number): Color {
  return get(p.b, x, y);
}

export function layerAt(p: Paint, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return L_FRAME;
  return p.mask[(y | 0) * p.w + (x | 0)];
}

/** Darken (steps > 0) or lighten (steps < 0) an existing pixel, keeping its layer. */
export function shade(p: Paint, x: number, y: number, steps: number): void {
  if (x < 0 || y < 0 || x >= p.w || y >= p.h) return;
  const c = get(p.b, x, y);
  if (c === TRANSPARENT) return;
  put(p, x, y, steps > 0 ? darker(c, steps) : lighter(c, -steps), p.mask[(y | 0) * p.w + (x | 0)]);
}

// ---------- noise ----------

export function n1(seed: number, x: number): number {
  const i = Math.floor(x), f = x - i;
  const a = hash01(seed, i), b = hash01(seed, i + 1);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

export function n2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash01(seed, ix, iy), b = hash01(seed, ix + 1, iy), c = hash01(seed, ix, iy + 1), d = hash01(seed, ix + 1, iy + 1);
  const tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Fractal noise, roughly in [0, 1]. */
export function fbm(seed: number, x: number, y: number, oct = 3): number {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    v += amp * n2(seed + o * 101, x * f, y * f);
    tot += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / tot;
}

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold in (0, 1) for pixel (x, y). */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** Pick from a list of colours by t in [0, 1] with ordered dithering between neighbours. */
export function ramp(stops: readonly Color[], t: number, x: number, y: number): Color {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const s = t * (stops.length - 1);
  const i = Math.floor(s), f = s - i;
  return f > bayer(x, y) ? stops[Math.min(stops.length - 1, i + 1)] : stops[i];
}

// ---------- arch geometry ----------

/**
 * An opening: a rect whose top is an elliptical cap of height `rise` (0 = flat lintel).
 * `jag` > 0 roughens the boundary (cave mouths).
 */
export interface Opening {
  rect: Rect;
  rise: number;
  jag?: number;
  seed?: number;
}

export function capCenterY(o: Opening): number {
  return o.rect.y + o.rise;
}

function jagAt(o: Opening, x: number, y: number): number {
  if (!o.jag) return 0;
  const s = o.seed ?? 7;
  // roughness along the boundary, from the angle around the cap centre
  const cx = o.rect.x + o.rect.w / 2, cy = capCenterY(o);
  const u = y >= cy ? (x < cx ? -(y - cy) : 1000 + (y - cy)) : Math.atan2(y - cy, x - cx) * 60;
  return (n1(s, u / 7) - 0.5) * 2 * o.jag + (n1(s + 9, u / 2.3) - 0.5) * o.jag * 0.6;
}

/**
 * Signed "depth" of a point relative to the opening boundary, in pixels (approximate):
 * negative inside, positive outside.
 */
export function openingDist(o: Opening, x: number, y: number): number {
  const r = o.rect;
  const px = x + 0.5, py = y + 0.5;
  const cx = r.x + r.w / 2, cy = capCenterY(o);
  const a = r.w / 2;
  let d: number;
  if (py >= cy || o.rise <= 0) {
    // straight part: distance to the side walls / top lintel
    const dx = Math.max(r.x - px, px - (r.x + r.w));
    const dy = o.rise <= 0 ? r.y - py : -Infinity;
    const dBottom = py - (r.y + r.h);
    d = Math.max(dx, dy, dBottom);
  } else {
    const b = o.rise;
    const nx = (px - cx) / a, ny = (py - cy) / b;
    const rr = Math.sqrt(nx * nx + ny * ny);
    // first-order distance to the ellipse: f / |grad f| with f = rr - 1
    const g = Math.sqrt((nx / a) ** 2 + (ny / b) ** 2) / Math.max(1e-6, rr);
    d = (rr - 1) / Math.max(1e-6, g);
    d = Math.max(d, r.x - px, px - (r.x + r.w));
  }
  return d - jagAt(o, x, y);
}

export function insideOpening(o: Opening, x: number, y: number): boolean {
  return openingDist(o, x, y) < 0;
}

/**
 * Arc parameter along the boundary for border patterns: for the cap, the angle in [-PI, 0]
 * (left to right through the top); for the sides, the y coordinate.
 */
export function capAngle(o: Opening, x: number, y: number): number {
  const r = o.rect;
  const cx = r.x + r.w / 2, cy = capCenterY(o);
  return Math.atan2((y + 0.5 - cy) / Math.max(1, o.rise), (x + 0.5 - cx) / (r.w / 2));
}

// ---------- drawing helpers ----------

/** Lighten pixels in a radius with a dithered falloff (light pools, glows). Respects layer filter. */
export function glow(p: Paint, cx: number, cy: number, r: number, steps = 1, layers?: number[], flat = 1): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * flat;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (layers && !layers.includes(p.mask[y * p.w + x])) continue;
      const t = 1 - Math.sqrt(d2) / r; // 1 at centre
      const s = t * steps;
      const whole = Math.floor(s);
      const k = whole + (s - whole > bayer(x, y) ? 1 : 0);
      if (k > 0) shade(p, x, y, -k);
    }
}

/** Dithered darkening (shadows, ambient occlusion). */
export function dim(p: Paint, cx: number, cy: number, r: number, steps = 1, layers?: number[], flat = 1): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * flat;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (layers && !layers.includes(p.mask[y * p.w + x])) continue;
      const t = 1 - Math.sqrt(d2) / r;
      const s = t * steps;
      const whole = Math.floor(s);
      const k = whole + (s - whole > bayer(x, y) ? 1 : 0);
      if (k > 0) shade(p, x, y, k);
    }
}

/** Draw a small ASCII sprite. `map` maps chars to colours; '.' and ' ' are transparent. */
export function sprite(p: Paint, rows: readonly string[], x: number, y: number, map: Record<string, Color>, layer: number, flipX = false): void {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[flipX ? row.length - 1 - i : i];
      if (ch === '.' || ch === ' ') continue;
      const c = map[ch];
      if (c === undefined) continue;
      put(p, x + i, y + j, c, layer);
    }
  }
}

/** Integer-scaled alpha-tested blit without allocation. */
export function blitScaled(dst: Rgba, src: Rgba, x: number, y: number, k: number, darkSteps = 0): void {
  const s = src.data, d = dst.data;
  for (let sy = 0; sy < src.h; sy++)
    for (let sx = 0; sx < src.w; sx++) {
      const si = (sy * src.w + sx) * 4;
      if (s[si + 3] === 0) continue;
      let c = (s[si] << 16) | (s[si + 1] << 8) | s[si + 2];
      if (darkSteps) c = darker(c, darkSteps);
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      for (let yy = 0; yy < k; yy++) {
        const ty = y + sy * k + yy;
        if (ty < 0 || ty >= dst.h) continue;
        for (let xx = 0; xx < k; xx++) {
          const tx = x + sx * k + xx;
          if (tx < 0 || tx >= dst.w) continue;
          const di = (ty * dst.w + tx) * 4;
          d[di] = r;
          d[di + 1] = g;
          d[di + 2] = b;
          d[di + 3] = 255;
        }
      }
    }
}

/**
 * Per-frame drawing target for animated props: writes into the frame buffer only where the
 * static depth mask allows (far props stay behind walls, nothing draws on the frame).
 */
export class Clip {
  out!: Rgba;
  mask!: Uint8Array;
  w = 0;
  h = 0;
  /** Highest mask layer this prop may draw over. */
  maxLayer = L_DECO;
  minLayer = 0;
  /** Palette steps to darken each freshly drawn pixel by (the dimmed room), or null for light sources. */
  dim: Uint8Array | null = null;
  bind(out: Rgba, mask: Uint8Array, maxLayer: number, minLayer = 0, dim: Uint8Array | null = null): this {
    this.out = out;
    this.mask = mask;
    this.w = out.w;
    this.h = out.h;
    this.maxLayer = maxLayer;
    this.minLayer = minLayer;
    this.dim = dim;
    return this;
  }
  ok(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const m = this.mask[y * this.w + x];
    return m <= this.maxLayer && m >= this.minLayer;
  }
  px(x: number, y: number, c: Color): void {
    x |= 0;
    y |= 0;
    if (c === TRANSPARENT || !this.ok(x, y)) return;
    if (this.dim) {
      const s = this.dim[y * this.w + x];
      if (s) c = darker(c, s);
    }
    this.raw(x, y, c);
  }
  /** Write a pixel as is (shading of what is already there must not be dimmed twice). */
  private raw(x: number, y: number, c: Color): void {
    const i = (y * this.w + x) * 4, d = this.out.data;
    d[i] = (c >> 16) & 255;
    d[i + 1] = (c >> 8) & 255;
    d[i + 2] = c & 255;
    d[i + 3] = 255;
  }
  get(x: number, y: number): Color {
    return get(this.out, x, y);
  }
  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
  /** Shift an existing pixel through the palette (glows, flicker). */
  shade(x: number, y: number, steps: number): void {
    x |= 0;
    y |= 0;
    if (!this.ok(x, y)) return;
    const c = get(this.out, x, y);
    if (c === TRANSPARENT) return;
    this.raw(x, y, steps > 0 ? darker(c, steps) : lighter(c, -steps));
  }
  sprite(rows: readonly string[], x: number, y: number, map: Record<string, Color>, flipX = false): void {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        const ch = row[flipX ? row.length - 1 - i : i];
        if (ch === '.' || ch === ' ') continue;
        const c = map[ch];
        if (c !== undefined) this.px(x + i, y + j, c);
      }
    }
  }
  blit(src: Rgba, x: number, y: number, flipX = false): void {
    const s = src.data;
    for (let sy = 0; sy < src.h; sy++)
      for (let sx = 0; sx < src.w; sx++) {
        const si = (sy * src.w + (flipX ? src.w - 1 - sx : sx)) * 4;
        if (s[si + 3] === 0) continue;
        this.px(x + sx, y + sy, (s[si] << 16) | (s[si + 1] << 8) | s[si + 2]);
      }
  }
  glow(cx: number, cy: number, r: number, steps = 1): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const t = (1 - Math.sqrt(d2) / r) * steps;
        const whole = Math.floor(t);
        const k = whole + (t - whole > bayer(x, y) ? 1 : 0);
        if (k > 0) this.shade(x, y, -k);
      }
  }
}

/** Loop phase helpers. */
export function frameOf(now: number, ms: number, n: number, offset = 0): number {
  return Math.floor((now + offset) / ms) % n;
}
export function tri(t: number): number {
  const f = t - Math.floor(t);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}

export function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

/**
 * Visit every pixel of the border ring around an opening: 0 <= d < t, where d is the distance
 * outside the boundary. `cap` is true above the cap centre line; `ang` is the cap angle.
 */
export function forRing(p: Paint, o: Opening, t: number, fn: (x: number, y: number, d: number, cap: boolean, ang: number) => void): void {
  const r = o.rect;
  const x0 = Math.max(0, Math.floor(r.x - t - 2)), x1 = Math.min(p.w - 1, Math.ceil(r.x + r.w + t + 2));
  const y0 = Math.max(0, Math.floor(r.y - t - 2)), y1 = Math.min(p.h - 1, Math.ceil(r.y + r.h + t + 2));
  const cy = capCenterY(o);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = openingDist(o, x, y);
      if (d < 0 || d >= t) continue;
      fn(x, y, d, y + 0.5 < cy && o.rise > 0, capAngle(o, x, y));
    }
}

/** Visit every pixel inside an opening (within the screen). */
export function forInside(p: Paint, o: Opening, fn: (x: number, y: number, d: number) => void): void {
  const r = o.rect;
  const x0 = Math.max(0, Math.floor(r.x - 2)), x1 = Math.min(p.w - 1, Math.ceil(r.x + r.w + 2));
  const y0 = Math.max(0, Math.floor(r.y - 2)), y1 = Math.min(p.h - 1, Math.ceil(r.y + r.h + 2));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = openingDist(o, x, y);
      if (d < 0) fn(x, y, -d);
    }
}

/** Is (x, y) outside every opening of the plan? */
export function outsideAll(openings: Opening[], x: number, y: number): boolean {
  for (const o of openings) if (openingDist(o, x, y) < 0) return false;
  return true;
}

/** A brick/block grid lookup: brick id and position within the brick. */
export function brickAt(x: number, y: number, bw: number, bh: number, offset = 0.5): { bx: number; by: number; u: number; v: number; id: number } {
  const by = Math.floor(y / bh);
  const off = (by & 1) ? Math.round(bw * offset) : 0;
  const bx = Math.floor((x + off) / bw);
  const u = (x + off) - bx * bw, v = y - by * bh;
  return { bx, by, u, v, id: (bx * 73856093) ^ (by * 19349663) };
}

/** Horizontal centre of the visible part of an opening (inside the frame). */
export function visibleCenterX(o: Opening, w: number, frame = 14): number {
  const x0 = Math.max(o.rect.x, frame), x1 = Math.min(o.rect.x + o.rect.w, w - frame);
  return (x0 + x1) / 2;
}

/** y of the cap boundary at column x (top edge of the opening), or rect.y + rise below the cap. */
export function capTopAt(o: Opening, x: number): number {
  const r = o.rect;
  if (o.rise <= 0) return r.y;
  const a = r.w / 2, cx = r.x + a;
  const nx = (x + 0.5 - cx) / a;
  if (Math.abs(nx) >= 1) return r.y + o.rise;
  return capCenterY(o) - o.rise * Math.sqrt(1 - nx * nx);
}

/**
 * Jittered-grid Voronoi cells (boulders, stones). Returns distance to the nearest and second
 * nearest feature points, the nearest point and a cell id. Light faces = pixel up-left of centre.
 */
export function cells(seed: number, x: number, y: number, size: number, sy = size): { d1: number; d2: number; fx: number; fy: number; id: number } {
  const gx = Math.floor(x / size), gy = Math.floor(y / sy);
  let d1 = 1e9, d2 = 1e9, fx = 0, fy = 0, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cy = gy + j;
      const px = (cx + 0.15 + hash01(seed, cx, cy) * 0.7) * size;
      const py = (cy + 0.15 + hash01(seed + 1, cx, cy) * 0.7) * sy;
      const d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * (size / sy));
      if (d < d1) {
        d2 = d1;
        d1 = d;
        fx = px;
        fy = py;
        id = (cx * 73856093) ^ (cy * 19349663);
      } else if (d < d2) d2 = d;
    }
  return { d1, d2, fx, fy, id };
}

/**
 * Shade class for a boulder pixel: 0 crevice, 1 lit, 2 base, 3 shaded, from Voronoi cells.
 * `gap` is the crevice width in pixels.
 */
export function boulder(seed: number, x: number, y: number, size: number, gap = 1.1, sy = size): number {
  const c = cells(seed, x, y, size, sy);
  if (c.d2 - c.d1 < gap) return 0;
  const dx = x + 0.5 - c.fx, dy = y + 0.5 - c.fy;
  const facing = (dx + dy) / (size * 0.55); // negative = toward the top-left light
  if (c.d2 - c.d1 < gap + 1.2 && facing > 0.1) return 3; // shadowed rim near the crevice
  if (facing < -0.45) return 1;
  if (facing > 0.5) return 3;
  return 2;
}
