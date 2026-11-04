// Small helpers for the mock relay.

export interface Rand {
  next(): number;
  int(n: number): number;
  range(lo: number, hi: number): number; // float in [lo, hi)
  pick<T>(a: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRand(random: () => number = Math.random): Rand {
  return {
    next: random,
    int: (n) => Math.floor(random() * n),
    range: (lo, hi) => lo + random() * (hi - lo),
    pick: (a) => a[Math.floor(random() * a.length)],
    chance: (p) => random() < p,
  };
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** A NEAR-looking transaction hash (base58, 44 chars). */
export function fakeTx(r: Rand): string {
  let s = '';
  for (let i = 0; i < 44; i++) s += B58[r.int(B58.length)];
  return s;
}

export function randHex(r: Rand, chars: number): string {
  let s = '';
  for (let i = 0; i < chars; i++) s += r.int(16).toString(16);
  return s;
}

/** Round to 4 decimals (coins are fractional after the 5% fee). */
export function c4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Floor to 1e-6 coins, mirroring the contract's integer floor in base units closely enough. */
export function floor6(n: number): number {
  return Math.floor(n * 1e6 + 1e-7) / 1e6;
}
