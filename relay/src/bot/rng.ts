// Seeded randomness for the bot engine (sfc32), so simulations and tests are reproducible.
// Production seeds come from crypto; nothing here is security-sensitive.
import crypto from 'node:crypto';

export interface Rng {
  /** uniform in [0, 1) */
  next(): number;
}

export function createRng(seed?: string | number): Rng {
  const h = crypto.createHash('sha256').update(String(seed ?? crypto.randomBytes(16).toString('hex'))).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return { next };
}

export const uniformR = (r: Rng, lo: number, hi: number) => lo + r.next() * (hi - lo);
export const chance = (r: Rng, p: number) => r.next() < p;
export const pickR = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length) % xs.length];

/** Weighted pick; weights <= 0 never win. Returns undefined when nothing has weight. */
export function weighted<T>(r: Rng, items: readonly (readonly [T, number])[]): T | undefined {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (!(total > 0)) return undefined;
  let x = r.next() * total;
  for (const [v, w] of items) {
    if (w <= 0) continue;
    x -= w;
    if (x < 0) return v;
  }
  return items.filter(([, w]) => w > 0).at(-1)?.[0];
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
