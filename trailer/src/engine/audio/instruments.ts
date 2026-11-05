// Reusable sound pieces on the DSP kit: room tone, a drone, a low swell, chat typing ticks, the
// per-speaker blip voice, typewriter ticks, a glitch, a chiptune band (pulse lead, pulse
// arpeggios, stepped triangle bass, noise kick, snare, hat, crash) and UI one-shots (beeps,
// whooshes, chirps, shings, pings, a chime). A variant's sound.ts places them in time.

import { type Mix, SR, Pulse, Tri, OnePole, Biquad, Svf, ad, white, midi, nn, NOTE } from './dsp.ts';
import { lineTimes, type Line } from '../timeline.ts';

// ---------------------------------------------------------------- beds

/** Soft brown air, decorrelated per channel: fades up from silence, gives way at `until`. */
export function roomTone(m: Mix, o: { until: number }): void {
  for (const ch of [m.L, m.R]) {
    let b = 0;
    const hp = Biquad.make('hp', 40), lp = Biquad.make('lp', 700);
    const end = o.until + 0.4;
    for (let i = 0; i < Math.min(ch.length, end * SR); i++) {
      const t = i / SR;
      b = 0.996 * b + 0.06 * white();
      const v = lp.next(hp.next(b));
      const env = Math.min(1, t / 1.6) * (t > o.until ? Math.max(0, 1 - (t - o.until) / 0.4) : 1);
      ch[i] += v * 0.02 * env;
    }
  }
}

/**
 * A low drone (A1 and E2 sines and a buzzy body an octave up) from `from`, swelling slowly, with
 * two high beating sines from `closeUps`; cut dead at `to`.
 */
export function drone(m: Mix, o: { from: number; to: number; closeUps: number }): void {
  const f = [55, 82.41, 110];
  const saw = new Pulse(0.5);
  const lp1 = OnePole.lp(260), lp2 = OnePole.lp(260);
  const dur = o.to - o.from;
  const CLOSE_UPS = o.closeUps;
  let p0 = 0, p1 = 0, p2 = 0, s0 = 0, s1 = 0;
  m.add(o.from, dur + 0.01, 0, (_i, t) => {
    const abs = o.from + t;
    p0 += (2 * Math.PI * f[0]) / SR;
    p1 += (2 * Math.PI * f[1]) / SR;
    // a buzzy body an octave up so small speakers hear it (saw from two detuned pulses)
    const body = lp2.next(lp1.next(saw.next(f[2]) * 0.5 + Math.sin(p2 += (2 * Math.PI * 110.6) / SR) * 0.5));
    // unease up high in the close-ups: two sines beating
    s0 += (2 * Math.PI * 659.25) / SR;
    s1 += (2 * Math.PI * 662.1) / SR;
    const hi = abs > CLOSE_UPS ? Math.min(1, (abs - CLOSE_UPS) / 2.5) * (Math.sin(s0) + Math.sin(s1)) * 0.006 : 0;
    const lfo = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.11 * abs);
    const swell = Math.min(1, t / 3.5) * (0.55 + 0.45 * Math.min(1, Math.max(0, (abs - 7) / (CLOSE_UPS + 3 - 7))));
    const cut = Math.min(1, (dur - t) / 0.008); // dead stop, no click
    return ((Math.sin(p0) * 0.055 + Math.sin(p1) * 0.025 + body * 0.035) * lfo + hi * 0.7) * swell * Math.max(0, cut);
  });
}

/**
 * A low swell: E1 and B1 sines and an octave of buzz rising from `from` to full at `peak`, a slow
 * filtered rush on top, cut dead at `to`.
 */
export function lowSwell(m: Mix, o: { from: number; peak: number; to: number }): void {
  const dur = o.to - o.from;
  const hold = o.peak - o.from;
  let a = 0, b = 0, c = 0;
  const sv = new Svf();
  m.add(o.from, dur + 0.01, 0, (_i, t) => {
    a += (2 * Math.PI * 41.2) / SR;
    b += (2 * Math.PI * 61.74) / SR;
    c += (2 * Math.PI * 82.4 * (1 + 0.004 * Math.sin(t * 5))) / SR;
    const rise = Math.min(1, t / hold);
    const env = rise * rise * (3 - 2 * rise);
    const rush = sv.next(white(), 120 + 900 * env, 2.2) * 0.05 * env;
    const cut = Math.max(0, Math.min(1, (dur - t) / 0.008));
    return (Math.sin(a) * 0.16 + Math.sin(b) * 0.07 + Math.tanh(Math.sin(c) * 3) * 0.035 + rush) * env * cut;
  });
}

// ---------------------------------------------------------------- voices and typing

/** Soft keyboard ticks under a chat line's typing dots, on the speaker's side. */
export function typingTicks(m: Mix, l: Line): void {
  const from = l.at - (l.lead ?? 0.7);
  const pan = l.speaker === 'host' ? -0.4 : 0.4;
  for (let k = 0, t = from + 0.06; t < l.at - 0.05; k++, t += 0.11 + ((k * 37) % 5) * 0.012) {
    const bp = Biquad.make('bp', 3200 + (k % 3) * 500, 2);
    m.add(t, 0.02, pan, (_n, u) => bp.next(white()) * ad(u, 0.0005, 0.02, 6) * 0.1);
  }
}

const VOWEL = /[aeiouyAEIOUY]/;

/** The blip voice for one typed line: low square for the host, a thinner pulse for the guest. */
export function blips(m: Mix, l: Line): void {
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

/** A typewriter tick per character (cards, taglines). */
export function ticks(m: Mix, l: Line, gain: number): void {
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

/** Two frames of glitch: bitcrushed noise, a pitch-diving square chirp, a stutter, a thump. */
export function glitchSfx(m: Mix, t0: number): void {
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

// ---------------------------------------------------------------- the chiptune band

/** A note in a bar: [16th step, note name, length in 16ths]. */
export type Ev = [step: number, note: string, len: number];

/** A short song on a 16-step grid: a lead line, one chord and one bass root per bar. */
export interface Song {
  /** Downbeat of bar 1 (seconds) and the length of a 16th. */
  at: number;
  step: number;
  lead: Ev[][];
  chords: string[][];
  roots: string[];
}

export const barAt = (s: Song, bar: number, step = 0) => s.at + (bar * 16 + step) * s.step;

/** 25% pulse lead with a touch of delayed vibrato. */
export function leadLine(m: Mix, s: Song): void {
  const STEP = s.step;
  s.lead.forEach((bar, b) =>
    bar.forEach(([st, note, len]) => {
      const f = midi(nn(note));
      const dur = len * STEP;
      const osc = new Pulse(0.25);
      const lp = OnePole.lp(6000);
      m.add(barAt(s, b, st), dur + 0.03, 0.05, (_i, t) => {
        // a touch of delayed vibrato on long notes
        const vib = t > 0.14 ? 1 + 0.006 * Math.sin(2 * Math.PI * 6 * t) : 1;
        const env = t < 0.005 ? t / 0.005 : t < dur ? 1 - 0.3 * Math.min(1, (t - 0.005) / 0.25) : Math.max(0, 0.7 * (1 - (t - dur) / 0.03));
        return lp.next(osc.next(f * vib)) * env * 0.13;
      });
    }),
  );
}

/** 12.5% pulse sixteenths cycling each bar's chord tones, panned left and right. */
export function arpeggios(m: Mix, s: Song): void {
  const STEP = s.step;
  for (let b = 0; b < s.chords.length; b++) {
    const ch = s.chords[b].map((n, i) => midi(NOTE[n] + 12 * 6 + (i > 0 && NOTE[n] < NOTE[s.chords[b][0]] ? 12 : 0)));
    const order = [0, 1, 2, 1];
    for (let st = 0; st < 16; st++) {
      const f = ch[order[st % 4]];
      const osc = new Pulse(0.125);
      const pan = st % 2 ? 0.35 : -0.35;
      m.add(barAt(s, b, st), STEP * 0.9, pan, (_i, t) => osc.next(f) * ad(t, 0.002, STEP * 0.9, 2.5) * 0.045);
    }
  }
}

/** Stepped triangle bass: root, root, octave, root, root, octave, fifth, octave. */
export function bassLine(m: Mix, s: Song): void {
  const STEP = s.step;
  const pattern = [0, 0, 12, 0, 0, 12, 7, 12];
  for (let b = 0; b < s.roots.length; b++) {
    const root = nn(s.roots[b]);
    pattern.forEach((off, k) => {
      const f = midi(root + off);
      const tri = new Tri();
      const dur = STEP * 2 * 0.92;
      m.add(barAt(s, b, k * 2), dur, 0, (_i, t) => tri.next(f) * (t < dur - 0.01 ? 1 : (dur - t) / 0.01) * 0.2);
    });
  }
}

export function kick(m: Mix, at: number, gain = 1): void {
  let ph = 0;
  m.add(at, 0.16, 0, (_i, t) => {
    const f = 55 + 140 * Math.exp(-t * 38);
    ph += (2 * Math.PI * f) / SR;
    return (Math.sin(ph) * ad(t, 0.001, 0.16, 3.2) + white() * ad(t, 0.0005, 0.012, 4) * 0.3) * 0.42 * gain;
  });
}
export function snare(m: Mix, at: number, gain = 1): void {
  const bp = Biquad.make('bp', 1800, 0.8);
  let hold = 0, ph = 0;
  m.add(at, 0.16, 0, (i, t) => {
    if (i % 3 === 0) hold = white();
    ph += (2 * Math.PI * 190) / SR;
    return (bp.next(hold) * 1.6 * ad(t, 0.001, 0.16, 4) + Math.sin(ph) * ad(t, 0.001, 0.06, 4) * 0.5) * 0.3 * gain;
  });
}
export function hat(m: Mix, at: number, open = false): void {
  const hp = Biquad.make('hp', 7000);
  const d = open ? 0.12 : 0.03;
  m.add(at, d, 0.15, (_i, t) => hp.next(white()) * ad(t, 0.0005, d, 4) * 0.09);
}
export function crash(m: Mix, at: number, gain = 1): void {
  const hp = Biquad.make('hp', 4500);
  let hold = 0;
  m.add(at, 1.4, -0.1, (i, t) => {
    if (i % 2 === 0) hold = white();
    return hp.next(hold) * ad(t, 0.002, 1.4, 3.5) * 0.11 * gain;
  });
}

// ---------------------------------------------------------------- UI one-shots

/** Square beep (UI). */
export function beep(m: Mix, at: number, f: number, dur: number, gain: number, duty = 0.5, pan = 0): void {
  const o = new Pulse(duty);
  m.add(at, dur, pan, (_i, t) => o.next(f) * (t < dur - 0.008 ? 1 : (dur - t) / 0.008) * ad(t, 0.002, dur + 0.2, 1.2) * gain);
}

/** A band-passed noise sweep from `f0` up by `ratio` over `dur`, shaped by a half sine. */
export function whoosh(m: Mix, at: number, dur: number, f0: number, ratio: number, gain: number, q?: number): void {
  const sv = new Svf();
  if (q === undefined) m.add(at, dur, 0, (_i, t) => sv.next(white(), f0 * Math.pow(ratio, t / dur)) * Math.sin((Math.PI * t) / dur) * gain);
  else m.add(at, dur, 0, (_i, t) => sv.next(white(), f0 * Math.pow(ratio, t / dur), q) * Math.sin((Math.PI * t) / dur) * gain);
}

/** A 25% pulse chirp from `f0` up by `ratio` over `dur` (a message going out, an eyebrow). */
export function chirp(m: Mix, at: number, dur: number, f0: number, ratio: number, gain: number, pan: number): void {
  const o = new Pulse(0.25);
  m.add(at, dur, pan, (_i, t) => o.next(f0 * Math.pow(ratio, t / dur)) * ad(t, 0.003, dur, 2) * gain);
}

/** A shine: a bright noise hiss and a sine ping at `f`. */
export function shing(m: Mix, at: number, f: number): void {
  const hp = Biquad.make('hp', 6500);
  m.add(at, 0.32, 0.25, (_n, t) => hp.next(white()) * ad(t, 0.004, 0.32, 5) * 0.12);
  let ph = 0;
  m.add(at + 0.02, 0.45, 0.25, (_n, t) => Math.sin((ph += (2 * Math.PI * f) / SR)) * ad(t, 0.002, 0.45, 5) * 0.05);
}

/** A sine ping. */
export function ping(m: Mix, at: number, f: number, dur: number, gain: number, pan: number): void {
  let ph = 0;
  m.add(at, dur, pan, (_n, t) => Math.sin((ph += (2 * Math.PI * f) / SR)) * ad(t, 0.001, dur, 5) * gain);
}

/** The final chime: a fast C major arpeggio into a ringing bell over a last bass note, a kick and a crash. */
export function chime(m: Mix, at: number): void {
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
