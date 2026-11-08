// How you win: the soundtrack, all synthesised. A light chiptune bed at 120 BPM (C, G, Am, F; a
// 12.5% pulse arpeggio and a stepped triangle bass, a soft kick and hats), and the game's sounds on
// every beat of every case: the bar sweeping in, your call, your coin joining the room, the reveal
// (a glitch for a bot), RIGHT or WRONG, coins landing, the counter; a crash and the chime on the big
// win, and the chime again on the outro. The order of the calls below matters: noise-based sounds
// share one deterministic source.

import { Mix, resetNoise, fadeTail, midi, nn, Pulse, ad, type Stereo } from '../../src/engine/audio/dsp.ts';
import { arpeggios, bassLine, kick, hat, crash, beep, whoosh, chirp, shing, ping, chime, glitchSfx, type Song } from '../../src/engine/audio/instruments.ts';
import type { VoiceClip } from '../../src/engine/audio/voice.ts';
import { BEATS, outcome } from '../../src/scenes/promo/scoring.ts';
import { SCENARIOS, STARTS, OUTRO_AT, DURATION } from './storyboard.ts';

const STEP = 0.125; // a 16th at 120 BPM: a bar is 2 s
const BARS = Math.ceil(DURATION / (16 * STEP));
const LOOP: [string[], string][] = [
  [['C', 'E', 'G'], 'C3'],
  [['G', 'B', 'D'], 'G2'],
  [['A', 'C', 'E'], 'A2'],
  [['F', 'A', 'C'], 'F2'],
];

function song(): Song {
  const chords: string[][] = [], roots: string[] = [];
  for (let b = 0; b < BARS; b++) {
    // resolve to C under the outro
    const [c, r] = OUTRO_AT <= b * 2 ? LOOP[0] : LOOP[b % 4];
    chords.push(c);
    roots.push(r);
  }
  return { at: 0, step: STEP, lead: [], chords, roots };
}

function drums(m: Mix): void {
  for (let b = 0; b < BARS; b++)
    for (let q = 0; q < 4; q++) {
      const t = b * 2 + q * 0.5;
      if (t >= DURATION - 0.3) continue;
      if (q === 0 || q === 2) kick(m, t, 0.45);
      hat(m, t + 0.25);
    }
}

/** A falling buzz for WRONG. */
function buzz(m: Mix, at: number): void {
  const o = new Pulse(0.5);
  m.add(at, 0.4, 0, (_i, t) => o.next(260 * Math.pow(0.5, t / 0.4)) * ad(t, 0.004, 0.4, 2) * 0.09);
}

function cases(m: Mix): void {
  SCENARIOS.forEach((s, i) => {
    const t0 = STARTS[i];
    const o = outcome(s);
    whoosh(m, t0 + BEATS.bar, 0.35, 400, 6, 0.08);
    chirp(m, t0 + BEATS.call, 0.09, 700, 2, 0.1, -0.3);
    beep(m, t0 + BEATS.join, midi(nn('G6')), 0.05, 0.08, 0.5, -0.2);
    beep(m, t0 + BEATS.joined, midi(nn('C7')), 0.09, 0.08, 0.5, 0.2);
    // the reveal: a glitch for a bot, a warm two-note ping for a human
    if (s.truth === 'bot') {
      glitchSfx(m, t0 + BEATS.reveal);
      shing(m, t0 + BEATS.reveal + 0.1, midi(nn('E7')));
    } else {
      ping(m, t0 + BEATS.reveal, midi(nn('E6')), 0.5, 0.07, 0.3);
      ping(m, t0 + BEATS.reveal + 0.07, midi(nn('A6')), 0.5, 0.06, 0.3);
    }
    // the verdict
    if (o.right) ['C6', 'E6', 'G6', 'C7'].forEach((n, k) => beep(m, t0 + BEATS.verdict + k * 0.05, midi(nn(n)), 0.08, 0.08, 0.25));
    else buzz(m, t0 + BEATS.verdict);
    // coins landing
    const n = o.right ? Math.max(3, Math.min(16, Math.round(o.net / 4) + 3)) : 10;
    for (let k = 0; k < n; k++) beep(m, t0 + BEATS.fly + BEATS.flyDur + k * 0.04, 1900 + (k % 3) * 300, 0.03, 0.04, 0.5, o.right ? -0.3 : 0.3);
    // the counter ticking
    for (let t = 0; t < BEATS.countDur; t += 0.05) beep(m, t0 + BEATS.count + t, 2600, 0.01, 0.025, 0.5);
    if (o.right && o.net >= 10) {
      crash(m, t0 + BEATS.verdict, 0.7);
      chime(m, t0 + BEATS.count + BEATS.countDur);
    }
  });
}

export function soundtrack(_voices: VoiceClip[]): Stereo {
  resetNoise();
  const m = new Mix(DURATION + 0.05);
  const s = song();
  arpeggios(m, s);
  bassLine(m, s);
  drums(m);
  cases(m);
  whoosh(m, OUTRO_AT, 0.5, 300, 8, 0.12);
  chime(m, OUTRO_AT + 1.4);
  fadeTail(m, DURATION, 0.6);
  return m;
}
