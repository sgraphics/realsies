// Deterministic PRNG seeded from any string (hex seeds in practice). sfc32 over a cyrb128 hash.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number;
  /** Float in [lo, hi). */
  float(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  /** Pick with weights (same length as arr). */
  weighted<T>(arr: readonly T[], weights: readonly number[]): T;
  chance(p: number): boolean;
  /** A child generator with an independent stream. */
  fork(label: string): Rng;
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function rngFrom(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed);
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const r: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo, hi) => lo + next() * (hi - lo),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (arr, w) => {
      let total = 0;
      for (const x of w) total += x;
      let t = next() * total;
      for (let i = 0; i < arr.length; i++) {
        t -= w[i];
        if (t < 0) return arr[i];
      }
      return arr[arr.length - 1];
    },
    chance: (p) => next() < p,
    fork: (label) => rngFrom(seed + '/' + label),
  };
  return r;
}

/** Stateless hash of (seed, ints) to [0, 1): handy for per-pixel noise in procedural backdrops. */
export function hash01(seed: number, x: number, y = 0, z = 0): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A random 64-hex seed (QA and demos only; the game's seeds come from the relay). */
export function randomSeed(rng?: Rng): string {
  let s = '';
  for (let i = 0; i < 64; i++) s += Math.floor((rng ? rng.next() : Math.random()) * 16).toString(16);
  return s;
}
