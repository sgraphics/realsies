// Browser helpers over the pure core: canvases, data URLs, one shared animation ticker,
// and a character controller for small UI canvases.

import type { Rgba } from '../core/buffer.ts';
import { Rig, CHAR_W, CHAR_H, type Reaction, type LookDir } from '../rig/rig.ts';

// ---------- canvases and data URLs ----------

/** Copy an RGBA buffer into a canvas (resizing the canvas to the buffer). */
export function putRgba(canvas: HTMLCanvasElement, img: Rgba, ctx?: CanvasRenderingContext2D | null): void {
  if (canvas.width !== img.w) canvas.width = img.w;
  if (canvas.height !== img.h) canvas.height = img.h;
  const c = ctx ?? canvas.getContext('2d');
  if (!c) return;
  c.putImageData(new ImageData(img.data as unknown as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0);
}

const URL_CACHE = new Map<string, string>();
/** PNG data URL of a buffer; pass a key to cache it (sprites for CSS border-image and icons). */
export function toDataURL(img: Rgba, key?: string): string {
  if (key) {
    const hit = URL_CACHE.get(key);
    if (hit) return hit;
  }
  const c = document.createElement('canvas');
  putRgba(c, img);
  const url = c.toDataURL('image/png');
  if (key) URL_CACHE.set(key, url);
  return url;
}

// ---------- reduced motion ----------

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function onReducedMotionChange(fn: (on: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  const h = () => fn(mq.matches);
  mq.addEventListener('change', h);
  return () => mq.removeEventListener('change', h);
}

// ---------- one shared ticker ----------

type TickFn = (now: number) => void;
const tickers = new Set<TickFn>();
let raf = 0;
let last = 0;
const MIN_FRAME_MS = 1000 / 30;
function loop(t: number): void {
  raf = requestAnimationFrame(loop);
  if (t - last < MIN_FRAME_MS) return;
  last = t;
  const now = Date.now();
  for (const fn of tickers) {
    try {
      fn(now);
    } catch (e) {
      console.error(e);
    }
  }
}
/** Run fn on every animation frame (about 30 fps max). Returns a remover. Stops when the tab is hidden. */
export function addTicker(fn: TickFn): () => void {
  tickers.add(fn);
  if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);
  return () => {
    tickers.delete(fn);
    if (!tickers.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

// ---------- character controller ----------

export interface CharacterController {
  readonly rig: Rig;
  setTalking(on: boolean): void;
  lookToward(dir: LookDir): void;
  react(kind: Reaction): void;
  setSeed(seed: string): void;
  setReducedMotion(on: boolean): void;
  destroy(): void;
}

export interface CharacterOptions {
  reducedMotion?: boolean;
  /** Solid shadow under the feet (canvases without a floor). Default true. */
  shadow?: boolean;
  /** Mirror horizontally (partner facing the bubbles, etc.). */
  flipX?: boolean;
}

/**
 * Animate one character on its own canvas. The canvas is 32x48 game pixels; size it in CSS with an
 * integer multiple and `image-rendering: pixelated`.
 */
export function createCharacter(canvas: HTMLCanvasElement, seed: string, opts: CharacterOptions = {}): CharacterController {
  canvas.width = CHAR_W;
  canvas.height = CHAR_H;
  const ctx = canvas.getContext('2d');
  let rig = new Rig(seed, { reducedMotion: opts.reducedMotion ?? prefersReducedMotion() });
  let lastKey = '';
  const flip = opts.flipX ? { flipped: new Uint8ClampedArray(CHAR_W * CHAR_H * 4) } : null;
  const draw = (now: number) => {
    const f = rig.frame(now, { shadow: opts.shadow !== false });
    // skip identical frames (most ticks change nothing at 6 fps)
    let h = 0;
    const d = f.data;
    for (let i = 0; i < d.length; i += 16) h = (Math.imul(h, 31) + d[i] + d[i + 3] * 7) | 0;
    const key = String(h);
    if (key === lastKey) return;
    lastKey = key;
    if (!ctx) return;
    if (flip) {
      const o = flip.flipped;
      for (let y = 0; y < CHAR_H; y++)
        for (let x = 0; x < CHAR_W; x++) {
          const si = (y * CHAR_W + x) * 4, di = (y * CHAR_W + (CHAR_W - 1 - x)) * 4;
          o[di] = d[si]; o[di + 1] = d[si + 1]; o[di + 2] = d[si + 2]; o[di + 3] = d[si + 3];
        }
      ctx.putImageData(new ImageData(o as unknown as Uint8ClampedArray<ArrayBuffer>, CHAR_W, CHAR_H), 0, 0);
    } else ctx.putImageData(new ImageData(new Uint8ClampedArray(d) as unknown as Uint8ClampedArray<ArrayBuffer>, CHAR_W, CHAR_H), 0, 0);
  };
  draw(Date.now());
  const stop = addTicker(draw);
  return {
    get rig() {
      return rig;
    },
    setTalking: (on) => rig.setTalking(on),
    lookToward: (d) => rig.lookToward(d),
    react: (k) => rig.react(k, Date.now()),
    setSeed: (s) => {
      if (s === rig.seed) return;
      const r = new Rig(s, { reducedMotion: opts.reducedMotion ?? prefersReducedMotion() });
      rig = r;
      lastKey = '';
    },
    setReducedMotion: (on) => rig.setReducedMotion(on),
    destroy: () => stop(),
  };
}
