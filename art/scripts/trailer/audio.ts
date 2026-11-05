// The soundtrack, synthesised sample by sample: room tone, a low drone under the interview, a
// typewriter blip voice per speaker, the glitch, and an original chiptune (pulse lead, pulse
// arpeggio, stepped triangle bass, noise drums) with the game's UI sounds and a final chime.
// Recorded voices (voice/<line-id>.wav, decoded by the build) replace a line's blips.

import { writeFileSync } from 'node:fs';
import { BEAT, CUE, DRONE, DURATION, GLITCH, LINES, MUSIC_AT, beat, lineTimes, type Line } from './storyboard.ts';

export const SR = 48000;

export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

// ---------------------------------------------------------------- tiny DSP kit

let seed = 0x9e3779b9;
function rnd(): number {
  // xorshift32, deterministic across runs
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 4294967296;
}
const white = () => rnd() * 2 - 1;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** "C5" -> MIDI number. */
function nn(name: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return NOTE[m[1]] + (parseInt(m[2]) + 1) * 12;
}

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
class Pulse {
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
class Tri {
  ph = 0;
  next(f: number): number {
    this.ph = (this.ph + f / SR) % 1;
    const step = Math.floor(this.ph * 32);
    const v = step < 16 ? step : 31 - step;
    return v / 7.5 - 1;
  }
}

class OnePole {
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
class Biquad {
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
class Svf {
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

class Mix implements Stereo {
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
function ad(t: number, a: number, dur: number, curve = 4): number {
  if (t < a) return t / a;
  const u = (t - a) / Math.max(1e-4, dur - a);
  return u >= 1 ? 0 : Math.exp(-curve * u) * (1 - u);
}

// ---------------------------------------------------------------- the interview

function roomTone(m: Mix): void {
  // soft brown air, decorrelated per channel; it fades up from silence and gives way to the music
  for (const ch of [m.L, m.R]) {
    let b = 0;
    const hp = Biquad.make('hp', 40), lp = Biquad.make('lp', 700);
    const end = MUSIC_AT + 0.4;
    for (let i = 0; i < Math.min(ch.length, end * SR); i++) {
      const t = i / SR;
      b = 0.996 * b + 0.06 * white();
      const v = lp.next(hp.next(b));
      const env = Math.min(1, t / 1.6) * (t > MUSIC_AT ? Math.max(0, 1 - (t - MUSIC_AT) / 0.4) : 1);
      ch[i] += v * 0.02 * env;
    }
  }
}

function drone(m: Mix): void {
  const f = [55, 82.41, 110];
  const saw = new Pulse(0.5);
  const lp1 = OnePole.lp(260), lp2 = OnePole.lp(260);
  const dur = DRONE.to - DRONE.from;
  let p0 = 0, p1 = 0, p2 = 0, s0 = 0, s1 = 0;
  m.add(DRONE.from, dur + 0.01, 0, (_i, t) => {
    const abs = DRONE.from + t;
    p0 += (2 * Math.PI * f[0]) / SR;
    p1 += (2 * Math.PI * f[1]) / SR;
    // a buzzy body an octave up so small speakers hear it (saw from two detuned pulses)
    const body = lp2.next(lp1.next(saw.next(f[2]) * 0.5 + Math.sin(p2 += (2 * Math.PI * 110.6) / SR) * 0.5));
    // unease up high in the close-ups: two sines beating
    s0 += (2 * Math.PI * 659.25) / SR;
    s1 += (2 * Math.PI * 662.1) / SR;
    const hi = abs > 19.5 ? Math.min(1, (abs - 19.5) / 2.5) * (Math.sin(s0) + Math.sin(s1)) * 0.006 : 0;
    const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.11 * abs);
    const swell = Math.min(1, t / 3.5) * (0.55 + 0.45 * Math.min(1, Math.max(0, (abs - 7) / 19)));
    const cut = Math.min(1, (dur - t) / 0.008); // dead stop at the glitch, no click
    return ((Math.sin(p0) * 0.055 + Math.sin(p1) * 0.025 + body * 0.035) * lfo + hi * 0.7) * swell * Math.max(0, cut);
  });
}

const VOWEL = /[aeiouyAEIOUY]/;

/** The blip voice for one typed line. */
function blips(m: Mix, l: Line): void {
  const { chars, times } = lineTimes(l);
  const host = l.speaker === 'host';
  const base = host ? 150 : 320;
  const pan = host ? -0.22 : 0.22;
  const letters = chars.map((c, i) => ({ c, i })).filter((x) => /[A-Za-z]/.test(x.c));
  const question = l.text.trim().endsWith('?');
  letters.forEach(({ c, i }, k) => {
    let semi = l.tune ? l.tune[i] ?? 0 : (VOWEL.test(c) ? 2 : 0) + ((c.charCodeAt(0) * 7) % 3) - 1;
    const fromEnd = letters.length - 1 - k;
    if (!l.tune && question && fromEnd < 4) semi += (4 - fromEnd) * 1.4;
    if (!l.tune && !question && fromEnd < 2) semi -= 2 - fromEnd;
    const f = base * Math.pow(2, semi / 12);
    const hum = c === 'm' || c === 'M' || c === 'h';
    const dur = Math.min(0.085, 0.95 / l.cps);
    const osc = new Pulse(host ? 0.5 : 0.25);
    const tri = new Tri();
    const lp = OnePole.lp(host ? 2200 : 3800);
    m.add(times[i], dur, pan, (_n, t) => {
      const v = hum ? tri.next(f) * 0.8 : osc.next(f);
      return lp.next(v) * ad(t, 0.004, dur, 3) * (host ? 0.24 : 0.19);
    });
  });
}

/** A typewriter tick per character (card and tagline). */
function ticks(m: Mix, l: Line, gain: number): void {
  const { chars, times } = lineTimes(l);
  chars.forEach((c, i) => {
    if (c === ' ') return;
    const bp = Biquad.make('bp', 2600 + (i % 3) * 400, 1.8);
    const lp = OnePole.lp(9000);
    m.add(times[i], 0.03, ((i % 5) - 2) * 0.08, (_n, t) => lp.next(bp.next(white())) * ad(t, 0.0008, 0.03, 6) * gain * 2.4);
    // the carriage thunk under it
    let ph = 0;
    m.add(times[i], 0.04, 0, (_n, t) => Math.sin((ph += (2 * Math.PI * 140) / SR)) * ad(t, 0.001, 0.04, 6) * gain * 0.5);
  });
}

function glitchSfx(m: Mix): void {
  const t0 = GLITCH[0];
  // bitcrushed noise (sample-and-hold at 3.2 kHz, 3 bits) over both frames
  let hold = 0;
  m.add(t0, 0.095, 0, (i, t) => {
    if (i % 15 === 0) hold = Math.round(white() * 3) / 3;
    return hold * 0.42 * (t < 0.085 ? 1 : (0.095 - t) / 0.01);
  });
  // a pitch-diving square chirp and a stuttering high bleep
  const sq = new Pulse(0.5), bl = new Pulse(0.125);
  m.add(t0, 0.09, -0.3, (_i, t) => sq.next(2400 * Math.pow(0.05, t / 0.09)) * 0.22 * (1 - t / 0.09));
  m.add(t0 + 0.042, 0.05, 0.35, (_i, t) => (Math.floor(t * 120) % 2 ? bl.next(1760) : 0) * 0.16);
  // a dull thump
  let ph = 0;
  m.add(t0, 0.12, 0, (_i, t) => Math.sin((ph += (2 * Math.PI * (90 - 40 * t / 0.12)) / SR)) * ad(t, 0.002, 0.12, 3) * 0.4);
}

// ---------------------------------------------------------------- the chiptune

type Ev = [step: number, note: string, len: number];

/** Lead melody in 16ths per bar (bars 1..6), C major: C | G | Am | F || F | G. */
const LEAD: Ev[][] = [
  [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 2], [6, 'G5', 2], [8, 'E6', 3], [11, 'D6', 1], [12, 'C6', 2], [14, 'G5', 2]],
  [[0, 'D5', 2], [2, 'G5', 2], [4, 'B5', 2], [6, 'G5', 2], [8, 'D6', 3], [11, 'C6', 1], [12, 'B5', 2], [14, 'G5', 2]],
  [[0, 'C6', 2], [2, 'A5', 2], [4, 'E5', 2], [6, 'A5', 2], [8, 'C6', 2], [10, 'D6', 2], [12, 'E6', 4]],
  [[0, 'F6', 3], [3, 'E6', 1], [4, 'D6', 2], [6, 'C6', 2], [8, 'D6', 2], [10, 'E6', 2], [12, 'G6', 4]],
  [[0, 'F6', 6], [6, 'E6', 2], [8, 'C6', 4], [12, 'A5', 4]],
  [[0, 'B5', 4], [4, 'D6', 4], [8, 'G6', 6], [14, 'F6', 1], [15, 'D6', 1]],
];
const CHORDS: string[][] = [
  ['C', 'E', 'G'], ['G', 'B', 'D'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['F', 'A', 'C'], ['G', 'B', 'D'],
];
const ROOTS = ['C3', 'G2', 'A2', 'F2', 'F2', 'G2'];
const BARS = LEAD.length;
const STEP = BEAT / 4;
const barAt = (bar: number, step = 0) => MUSIC_AT + (bar * 16 + step) * STEP;

function lead(m: Mix): void {
  LEAD.forEach((bar, b) =>
    bar.forEach(([st, note, len]) => {
      const f = midi(nn(note));
      const dur = len * STEP;
      const osc = new Pulse(0.25);
      const lp = OnePole.lp(6000);
      m.add(barAt(b, st), dur + 0.03, 0.05, (_i, t) => {
        // a touch of delayed vibrato on long notes
        const vib = t > 0.14 ? 1 + 0.006 * Math.sin(2 * Math.PI * 6 * t) : 1;
        const env = t < 0.005 ? t / 0.005 : t < dur ? 1 - 0.3 * Math.min(1, (t - 0.005) / 0.25) : Math.max(0, 0.7 * (1 - (t - dur) / 0.03));
        return lp.next(osc.next(f * vib)) * env * 0.13;
      });
    }),
  );
}

function arps(m: Mix): void {
  for (let b = 0; b < BARS; b++) {
    const ch = CHORDS[b].map((n, i) => midi(NOTE[n] + 12 * 6 + (i > 0 && NOTE[n] < NOTE[CHORDS[b][0]] ? 12 : 0)));
    const order = [0, 1, 2, 1];
    for (let s = 0; s < 16; s++) {
      const f = ch[order[s % 4]];
      const osc = new Pulse(0.125);
      const pan = s % 2 ? 0.35 : -0.35;
      m.add(barAt(b, s), STEP * 0.9, pan, (_i, t) => osc.next(f) * ad(t, 0.002, STEP * 0.9, 2.5) * 0.045);
    }
  }
}

function bass(m: Mix): void {
  const pattern = [0, 0, 12, 0, 0, 12, 7, 12];
  for (let b = 0; b < BARS; b++) {
    const root = nn(ROOTS[b]);
    pattern.forEach((off, k) => {
      const f = midi(root + off);
      const tri = new Tri();
      const dur = STEP * 2 * 0.92;
      m.add(barAt(b, k * 2), dur, 0, (_i, t) => tri.next(f) * (t < dur - 0.01 ? 1 : (dur - t) / 0.01) * 0.2);
    });
  }
}

function kick(m: Mix, at: number, gain = 1): void {
  let ph = 0;
  m.add(at, 0.16, 0, (_i, t) => {
    const f = 55 + 140 * Math.exp(-t * 38);
    ph += (2 * Math.PI * f) / SR;
    return (Math.sin(ph) * ad(t, 0.001, 0.16, 3.2) + white() * ad(t, 0.0005, 0.012, 4) * 0.3) * 0.42 * gain;
  });
}
function snare(m: Mix, at: number, gain = 1): void {
  const bp = Biquad.make('bp', 1800, 0.8);
  let hold = 0, ph = 0;
  m.add(at, 0.16, 0, (i, t) => {
    if (i % 3 === 0) hold = white();
    ph += (2 * Math.PI * 190) / SR;
    return (bp.next(hold) * 1.6 * ad(t, 0.001, 0.16, 4) + Math.sin(ph) * ad(t, 0.001, 0.06, 4) * 0.5) * 0.3 * gain;
  });
}
function hat(m: Mix, at: number, open = false): void {
  const hp = Biquad.make('hp', 7000);
  const d = open ? 0.12 : 0.03;
  m.add(at, d, 0.15, (_i, t) => hp.next(white()) * ad(t, 0.0005, d, 4) * 0.09);
}
function crash(m: Mix, at: number, gain = 1): void {
  const hp = Biquad.make('hp', 4500);
  let hold = 0;
  m.add(at, 1.4, -0.1, (i, t) => {
    if (i % 2 === 0) hold = white();
    return hp.next(hold) * ad(t, 0.002, 1.4, 3.5) * 0.11 * gain;
  });
}

function drums(m: Mix): void {
  // the pickup: two beats of snare sixteenths, rising
  for (let s = 0; s < 8; s++) snare(m, MUSIC_AT - (8 - s) * STEP, 0.35 + s * 0.09);
  kick(m, MUSIC_AT - 4 * STEP, 0.6);
  for (let b = 0; b < BARS; b++) {
    for (let s = 0; s < 16; s++) {
      const at = barAt(b, s);
      if (s === 0 || s === 8 || (s === 10 && b % 2 === 1)) kick(m, at);
      if (s === 4 || s === 12) snare(m, at);
      if (s % 2 === 0) hat(m, at, s === 14);
    }
    // a fill into the end card
    if (b === 3) for (const s of [13, 14, 15]) snare(m, barAt(b, s), 0.7);
  }
  crash(m, MUSIC_AT, 1);
  crash(m, beat(CUE.logo), 1.2);
}

/** Square beep (UI). */
function beep(m: Mix, at: number, f: number, dur: number, gain: number, duty = 0.5, pan = 0): void {
  const o = new Pulse(duty);
  m.add(at, dur, pan, (_i, t) => o.next(f) * (t < dur - 0.008 ? 1 : (dur - t) / 0.008) * ad(t, 0.002, dur + 0.2, 1.2) * gain);
}

function uiSounds(m: Mix): void {
  const b = (n: number) => beat(n);
  // lobby: her pedestal lights up
  beep(m, b(CUE.lobbySelect), midi(nn('E6')), 0.05, 0.12, 0.25);
  beep(m, b(CUE.lobbySelect) + 0.05, midi(nn('G6')), 0.08, 0.12, 0.25);
  // countdown: 3, 2, 1, CHAT!
  for (const c of [CUE.count3, CUE.count2, CUE.count1]) beep(m, b(c), midi(nn('G5')), 0.12, 0.17, 0.5);
  beep(m, b(CUE.countGo), midi(nn('G6')), 0.3, 0.17, 0.5);
  // doors whoosh apart
  {
    const sv = new Svf();
    const dur = 0.45;
    m.add(b(CUE.doorsOpen), dur, 0, (_i, t) => sv.next(white(), 500 * Math.pow(8, t / dur)) * Math.sin((Math.PI * t) / dur) * 0.3);
  }
  // chat: my message goes out, she types, hers comes in
  {
    const o = new Pulse(0.25);
    m.add(b(CUE.bubbleMe), 0.09, 0.2, (_i, t) => o.next(700 * Math.pow(2, t / 0.09)) * ad(t, 0.003, 0.09, 2) * 0.12);
  }
  for (let t = b(CUE.typingFrom); t < b(CUE.bubbleThem) - 0.05; t += 0.16) beep(m, t, 2400, 0.012, 0.05, 0.5, -0.2);
  beep(m, b(CUE.bubbleThem), midi(nn('G5')), 0.05, 0.12, 0.5, -0.2);
  beep(m, b(CUE.bubbleThem) + 0.055, midi(nn('C6')), 0.09, 0.12, 0.5, -0.2);
  // call: the cursor ticks over each button
  for (const c of [CUE.hoverYes, CUE.hoverNo, CUE.hoverYes2]) beep(m, b(c) - 0.1, 1900, 0.014, 0.08, 0.5);
  // end card: the logo lands with a coin, the URL pops
  beep(m, b(CUE.logo), midi(nn('C6')), 0.07, 0.15, 0.5);
  beep(m, b(CUE.logo) + 0.07, midi(nn('F6')), 0.42, 0.15, 0.5);
  beep(m, b(CUE.url), midi(nn('A6')), 0.07, 0.09, 0.25);
}

/** The final chime: a fast arpeggio into a ringing C major bell over the last bass note. */
function chime(m: Mix): void {
  const at = beat(CUE.chime);
  ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => {
    const f = midi(nn(n));
    const o = new Pulse(0.25);
    const lp = OnePole.lp(5000);
    m.add(at + i * 0.045, 1.8, (i - 1.5) * 0.25, (_i, t) => lp.next(o.next(f)) * ad(t, 0.003, 1.8, 4.5) * 0.07);
  });
  // bell partials an octave down
  const partials: [number, number][] = [[1, 0.12], [2, 0.05], [2.76, 0.035], [5.4, 0.018]];
  for (const [r, g] of partials) {
    let ph = 0;
    const f = midi(nn('C5')) * r;
    m.add(at, 2.2, 0, (_i, t) => Math.sin((ph += (2 * Math.PI * f) / SR)) * ad(t, 0.002, 2.2, 3 + r) * g);
  }
  const tri = new Tri();
  m.add(at, 1.2, 0, (_i, t) => tri.next(midi(nn('C3'))) * ad(t, 0.003, 1.2, 2) * 0.2);
  kick(m, at);
  crash(m, at, 0.9);
}

// ---------------------------------------------------------------- master

export interface VoiceClip {
  id: string;
  samples: Float32Array; // mono, SR
}

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

export function synthesize(voices: VoiceClip[] = []): Stereo {
  seed = 0x9e3779b9;
  const m = new Mix(DURATION + 0.05);
  roomTone(m);
  drone(m);
  const voiced = new Set(voices.map((v) => v.id));
  for (const l of LINES) {
    if (voiced.has(l.id)) continue;
    if (l.speaker === 'host' || l.speaker === 'guest') blips(m, l);
    else ticks(m, l, l.speaker === 'card' ? 0.16 : 0.07);
  }
  for (const v of voices) {
    const l = LINES.find((x) => x.id === v.id);
    if (!l) continue;
    const pan = l.speaker === 'host' ? -0.15 : l.speaker === 'guest' ? 0.15 : 0;
    const dur = v.samples.length / SR;
    m.add(l.at, Math.min(dur, DURATION - l.at), pan, (i) => v.samples[i] * 0.9);
  }
  glitchSfx(m);
  lead(m);
  arps(m);
  bass(m);
  drums(m);
  uiSounds(m);
  chime(m);
  // tail: fade the last half second
  const n = m.L.length, f0 = Math.round((DURATION - 0.5) * SR);
  for (let i = f0; i < n; i++) {
    const g = Math.max(0, 1 - (i - f0) / (n - f0));
    m.L[i] *= g;
    m.R[i] *= g;
  }
  return m;
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

void beat;
