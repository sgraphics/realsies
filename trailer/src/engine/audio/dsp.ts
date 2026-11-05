// Tiny DSP kit for synthesising a soundtrack sample by sample: a deterministic noise source,
// band-limited pulse, NES-style triangle, one-pole, biquad and state-variable filters, envelopes, a
// stereo mixer, a lookahead limiter and a float WAV writer. 48 kHz.

import { writeFileSync } from 'node:fs';

export const SR = 48000;

export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

// ---------------------------------------------------------------- noise

let seed = 0x9e3779b9;
/** Restart the noise source, so every render of a soundtrack is bit-identical. */
export function resetNoise(): void {
  seed = 0x9e3779b9;
}
function rnd(): number {
  // xorshift32, deterministic across runs
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
}
/** White noise in [-1, 1). The one shared source: call order matters for reproducibility. */
export const white = () => rnd() * 2 - 1;

// ---------------------------------------------------------------- notes

export const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** "C5" -> MIDI number. */
export function nn(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return NOTE[m[1]] + (parseInt(m[2]) + 1) * 12;
}

// ---------------------------------------------------------------- oscillators and filters

function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Band-limited pulse oscillator. */
export class Pulse {
  ph = 0;
  constructor(public duty = 0.5) {}
  next(f: number): number {
    const dt = f / SR;
    let v = this.ph < this.duty ? 1 : -1;
    v += polyBlep(this.ph, dt);
    v -= polyBlep((this.ph - this.duty + 1) % 1, dt);
    this.ph += dt;
    if (this.ph >= 1) this.ph -= 1;
    // zero-mean: a narrow pulse sits off-centre, which would thump at every note edge
    return v - (2 * this.duty - 1);
  }
}

/** NES-style triangle: 32 steps (4-bit). */
export class Tri {
  ph = 0;
  next(f: number): number {
    this.ph = (this.ph + f / SR) % 1;
    const step = Math.floor(this.ph * 32);
    const v = step < 16 ? step : 31 - step;
    return v / 7.5 - 1;
  }
}

export class OnePole {
  y = 0;
  constructor(public a: number) {}
  static lp(fc: number): OnePole {
    return new OnePole(1 - Math.exp((-2 * Math.PI * fc) / SR));
  }
  next(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** RBJ biquad. */
export class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private b0: number, private b1: number, private b2: number, private a1: number, private a2: number) {}
  static make(type: 'lp' | 'hp' | 'bp', f: number, q = 0.707): Biquad {
    const w = (2 * Math.PI * f) / SR, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0: number, b1: number, b2: number;
    if (type === 'lp') [b0, b1, b2] = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2];
    else if (type === 'hp') [b0, b1, b2] = [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
    else [b0, b1, b2] = [al, 0, -al];
    const a0 = 1 + al;
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, (-2 * cs) / a0, (1 - al) / a0);
  }
  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Chamberlin state-variable filter: band-pass output, cutoff may move every sample. */
export class Svf {
  private lo = 0;
  private bp = 0;
  next(x: number, fc: number, q = 1.2): number {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    this.lo += f * this.bp;
    const hi = x - this.lo - this.bp / q;
    this.bp += f * hi;
    return this.bp;
  }
}

// ---------------------------------------------------------------- mixing

export class Mix implements Stereo {
  L: Float32Array;
  R: Float32Array;
  constructor(seconds: number) {
    this.L = new Float32Array(Math.ceil(seconds * SR));
    this.R = new Float32Array(Math.ceil(seconds * SR));
  }
  /** Add a mono voice rendered by `fn(i, t)` from `start` for `dur` seconds, panned -1..1. */
  add(start: number, dur: number, pan: number, fn: (i: number, t: number) => number): void {
    const i0 = Math.max(0, Math.round(start * SR)), n = Math.round(dur * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < n && i0 + i < this.L.length; i++) {
      const v = fn(i, i / SR);
      this.L[i0 + i] += v * gl * Math.SQRT2;
      this.R[i0 + i] += v * gr * Math.SQRT2;
    }
  }
}

/** Attack-decay envelope (seconds), exponential decay to silence by `dur`. */
export function ad(t: number, a: number, dur: number, curve = 4): number {
  if (t < a) return t / a;
  const u = (t - a) / Math.max(1e-4, dur - a);
  return u >= 1 ? 0 : Math.exp(-curve * u) * (1 - u);
}

/** Fade the last `seconds` of a mix that runs to `duration` (plus its tail) down to silence. */
export function fadeTail(m: Stereo, duration: number, seconds: number): void {
  const n = m.L.length, f0 = Math.round((duration - seconds) * SR);
  for (let i = f0; i < n; i++) {
    const g = Math.max(0, 1 - (i - f0) / (n - f0));
    m.L[i] *= g;
    m.R[i] *= g;
  }
}

// ---------------------------------------------------------------- master

/**
 * Lookahead peak limiter (stereo-linked) to a linear ceiling: the gain is the minimum needed over
 * the next 4 ms (a monotonic deque), released over 90 ms. Keeps loudnorm in its linear mode.
 */
export function limit(m: Stereo, ceiling: number): void {
  const n = m.L.length;
  const look = Math.round(0.004 * SR);
  const rel = Math.exp(-1 / (0.09 * SR));
  const need = new Float32Array(n + look).fill(1);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(m.L[i]), Math.abs(m.R[i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  const dq = new Int32Array(n + look);
  let head = 0, tail = 0;
  let g = 1;
  for (let i = 0; i < n + look; i++) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] <= i - look) head++;
    const mn = need[dq[head]];
    g = mn < g ? mn : mn + (g - mn) * rel;
    const j = i - look + 1;
    if (j >= 0 && j < n) {
      m.L[j] *= g;
      m.R[j] *= g;
    }
  }
}

export function peakOf(m: Stereo): number {
  let p = 0;
  for (let i = 0; i < m.L.length; i++) p = Math.max(p, Math.abs(m.L[i]), Math.abs(m.R[i]));
  return p;
}

/** Mouth envelopes for recorded voices: RMS per 1/100 s, normalised to the clip's peak. */
export function envelope(samples: Float32Array, rate = 100): { rate: number; env: Float32Array } {
  const hop = Math.round(SR / rate);
  const env = new Float32Array(Math.ceil(samples.length / hop));
  let peak = 1e-6;
  for (let k = 0; k < env.length; k++) {
    let s = 0;
    for (let i = k * hop; i < Math.min(samples.length, (k + 1) * hop); i++) s += samples[i] * samples[i];
    env[k] = Math.sqrt(s / hop);
    peak = Math.max(peak, env[k]);
  }
  for (let k = 0; k < env.length; k++) env[k] /= peak;
  return { rate, env };
}

/** 32-bit float stereo WAV. */
export function writeWav(path: string, s: Stereo): void {
  const n = s.L.length;
  const data = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) {
    data.writeFloatLE(s.L[i], i * 8);
    data.writeFloatLE(s.R[i], i * 8 + 4);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); // IEEE float
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 8, 28);
  h.writeUInt16LE(8, 32);
  h.writeUInt16LE(32, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}
