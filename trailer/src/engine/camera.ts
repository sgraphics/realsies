// Output-level helpers: the 1920x1080 frame, integer-zoom "shots" of a game-pixel buffer, nearest-
// neighbour blits at any integer scale, letterbox bars and palette-step fades. Every block edge
// lands on an even output pixel so 4:2:0 chroma never straddles a game pixel.

import { type Rgba, createBuffer } from '../art.ts';
import { type Color, darker } from '../art.ts';

export const OUT_W = 1920;
export const OUT_H = 1080;
/** Cinema bars for the interview (image 1920x800, 2.4:1). */
export const BAR = 140;

export function newFrame(): Rgba {
  return createBuffer(OUT_W, OUT_H);
}

const u32 = (b: Rgba) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.w * b.h);
/** Pack 0xRRGGBB as a little-endian RGBA uint32 (opaque). */
export const pack = (c: Color) => (0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff)) >>> 0;

export function fillOut(b: Rgba, c: Color | 'pure-black'): void {
  u32(b).fill(c === 'pure-black' ? 0xff000000 : pack(c));
}

export interface Cam {
  /** World point shown at the centre of the frame. */
  cx: number;
  cy: number;
  /** Output pixels per world pixel (even). */
  k: number;
}

/** Output position of world pixel (0, 0) for a camera, snapped to even output pixels. */
export function camOrigin(c: Cam): { ox: number; oy: number } {
  const ox = Math.round((OUT_W / 2 - c.cx * c.k) / 2) * 2;
  const oy = Math.round((OUT_H / 2 - c.cy * c.k) / 2) * 2;
  return { ox, oy };
}

/**
 * Draw a world buffer through a camera into the frame (rows y0..y1 of the output only). Transparent
 * or off-world pixels become `edge`.
 */
export function shoot(out: Rgba, world: Rgba, cam: Cam, y0 = 0, y1 = OUT_H, edge: Color = 0x000000): void {
  const { ox, oy } = camOrigin(cam);
  const k = cam.k;
  const o = u32(out), w = u32(world);
  const edgeP = pack(edge);
  const row = new Uint32Array(OUT_W);
  let lastWy = -99999;
  for (let y = y0; y < y1; y++) {
    const wy = Math.floor((y - oy) / k);
    if (wy !== lastWy) {
      lastWy = wy;
      for (let x = 0; x < OUT_W; x++) {
        const wx = Math.floor((x - ox) / k);
        let v = edgeP;
        if (wx >= 0 && wy >= 0 && wx < world.w && wy < world.h) {
          const s = w[wy * world.w + wx];
          if (s >>> 24) v = s;
        }
        row[x] = v;
      }
    }
    o.set(row, y * OUT_W);
  }
}

/** Nearest-neighbour blit of a game-pixel sprite at integer scale k, top-left at (x, y) output px. */
export function blitK(out: Rgba, src: Rgba, x: number, y: number, k: number, o: { tint?: Color; dark?: number } = {}): void {
  x = Math.round(x);
  y = Math.round(y);
  const s = u32(src), d = u32(out);
  const tint = o.tint !== undefined ? pack(o.tint) : 0;
  for (let sy = 0; sy < src.h; sy++) {
    const ty0 = y + sy * k;
    if (ty0 + k <= 0 || ty0 >= out.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      let v = s[sy * src.w + sx];
      if (!(v >>> 24)) continue;
      if (o.tint !== undefined) v = tint;
      else if (o.dark) {
        const c = ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
        v = pack(darker(c, o.dark));
      }
      const tx0 = x + sx * k;
      if (tx0 + k <= 0 || tx0 >= out.w) continue;
      const xa = Math.max(0, tx0), xb = Math.min(out.w, tx0 + k);
      for (let ty = Math.max(0, ty0); ty < Math.min(out.h, ty0 + k); ty++) d.fill(v, ty * out.w + xa, ty * out.w + xb);
    }
  }
}

export function rectOut(out: Rgba, x: number, y: number, w: number, h: number, c: Color | 'pure-black'): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const d = u32(out);
  const v = c === 'pure-black' ? 0xff000000 : pack(c);
  const x0 = Math.max(0, x), x1 = Math.min(out.w, x + w);
  for (let yy = Math.max(0, y); yy < Math.min(out.h, y + h); yy++) d.fill(v, yy * out.w + x0, yy * out.w + x1);
}

export function letterbox(out: Rgba): void {
  rectOut(out, 0, 0, OUT_W, BAR, 'pure-black');
  rectOut(out, 0, OUT_H - BAR, OUT_W, BAR, 'pure-black');
}

/** Darken every pixel of a game-pixel buffer `steps` palette steps (NES-style fades). */
export function fadeBuffer(b: Rgba, steps: number): void {
  if (steps <= 0) return;
  const d = b.data;
  const memo = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let v = memo.get(c);
    if (v === undefined) {
      v = steps >= 6 ? 0x000000 : darker(c, steps);
      memo.set(c, v);
    }
    d[i] = (v >> 16) & 255;
    d[i + 1] = (v >> 8) & 255;
    d[i + 2] = v & 255;
  }
}
