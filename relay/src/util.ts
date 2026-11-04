// Small shared helpers: timing, randomness, coin/base-unit conversion, serial queues.
import crypto from 'node:crypto';

/** Unref'd: a pending sleep never keeps the process alive on its own (the HTTP server does). */
export const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, Math.max(0, ms));
    t.unref?.();
  });

export function uniform(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pick<T>(arr: readonly T[]): T {
  return arr[crypto.randomInt(arr.length)];
}

export function randomId(bytes = 8): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Coins (a JS number, possibly fractional) to base units, exact for up to `decimals` fraction digits. */
export function coinsToUnits(coins: number | string, coinUnit: bigint): bigint {
  const s = typeof coins === 'number' ? numberToPlain(coins) : coins.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`bad coin amount ${coins}`);
  const neg = s.startsWith('-');
  const [ip, fp = ''] = (neg ? s.slice(1) : s).split('.');
  // coinUnit is 10^d for tREAL; handle arbitrary units by scaling the fraction.
  const scale = 10n ** BigInt(fp.length);
  const v = (BigInt(ip) * scale + BigInt(fp || '0')) * coinUnit / scale;
  return neg ? -v : v;
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`bad number ${n}`);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(18).replace(/\.?0+$/, '');
}

/** Base units to coins as a JS number (display precision). */
export function unitsToCoins(units: bigint | string, coinUnit: bigint): number {
  const u = typeof units === 'string' ? BigInt(units) : units;
  const neg = u < 0n;
  const a = neg ? -u : u;
  const whole = a / coinUnit;
  const frac = a % coinUnit;
  const v = Number(whole) + Number(frac) / Number(coinUnit);
  const r = Math.round(v * 1e9) / 1e9;
  return neg ? -r : r;
}

/** Runs async jobs one at a time, in order. One instance per signing key keeps nonces in sequence. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;
  run<T>(job: () => Promise<T>): Promise<T> {
    this.depth++;
    const p = this.tail.then(job, job);
    this.tail = p.then(
      () => { this.depth--; },
      () => { this.depth--; },
    );
    return p;
  }
  get pending(): number {
    return this.depth;
  }
}

export function jsonStringify(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
}

export function utcDay(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** A promise with its resolve function exposed. */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
