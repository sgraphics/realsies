// How you win: the soundtrack, all synthesised. A light chiptune bed at 120 BPM (C, G, Am, F; a
// 12.5% pulse arpeggio, a stepped triangle bass, a soft kick and hats) and the game's sounds on each
// step: a whoosh as your partner slides in, a chirp for every call, coins clinking into the chest,
// the reveal (a glitch for a bot, a warm ping for a human), ticks as the marks land, coins moving
// across the table, a crash and the chime on WIN; the chime again on the outro.
// The order of the calls below matters: noise-based sounds share one deterministic source.

import { Mix, resetNoise, fadeTail, midi, nn, type Stereo } from '../../src/engine/audio/dsp.ts';
import { arpeggios, bassLine, kick, hat, crash, beep, whoosh, chirp, shing, ping, chime, glitchSfx, type Song } from '../../src/engine/audio/instruments.ts';
import type { VoiceClip } from '../../src/engine/audio/voice.ts';
import { T, settle } from '../../src/scenes/promo/howwin.ts';
import { CASES, CASE_T0, OUTRO_AT, DURATION } from './storyboard.ts';

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

/** A few coins clinking in, `n` of them from `at`. */
function clink(m: Mix, at: number, n: number, pan = 0): void {
  for (let k = 0; k < n; k++) beep(m, at + k * 0.06, 1900 + (k % 3) * 320, 0.03, 0.045, 0.5, pan);
}

function cases(m: Mix): void {
  CASES.forEach((c, i) => {
    const t0 = CASE_T0[i];
    const s = settle(c);
    whoosh(m, t0 + T.partnerIn[0], 0.6, 250, 6, 0.1);
    chirp(m, t0 + T.youCall, 0.09, 700, 2, 0.11, 0.3);
    clink(m, t0 + T.youCoins[1] - 0.15, 5, 0);
    c.callers.slice(1).forEach((_k, j) => {
      const p = t0 + T.player(j);
      whoosh(m, p, 0.4, 400, 5, 0.06);
      chirp(m, p + 0.6, 0.08, 800, 2, 0.09, 0.4);
      clink(m, p + 1.35, 4, 0.1);
    });
    // the reveal
    crash(m, t0 + T.reveal, 0.35);
    if (c.truth === 'bot') {
      glitchSfx(m, t0 + T.reveal + 0.3);
      shing(m, t0 + T.reveal + 0.4, midi(nn('E7')));
    } else {
      ping(m, t0 + T.reveal + 0.3, midi(nn('E6')), 0.6, 0.08, -0.3);
      ping(m, t0 + T.reveal + 0.38, midi(nn('A6')), 0.6, 0.07, -0.3);
    }
    // the table: marks, then coins moving
    c.callers.forEach((_k, j) => beep(m, t0 + T.marks + j * 0.05, j === 0 ? midi(nn('C6')) : midi(nn('G5')), 0.05, 0.06, 0.5));
    clink(m, t0 + T.move[0] + 0.5, 6, 0);
    // WIN
    if (s.net[0] > 0) {
      ['C6', 'E6', 'G6', 'C7'].forEach((n, k) => beep(m, t0 + T.win + k * 0.05, midi(nn(n)), 0.08, 0.08, 0.25, 0.3));
      chime(m, t0 + T.win + 0.25);
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
  chime(m, OUTRO_AT + 1.3);
  fadeTail(m, DURATION, 0.6);
  return m;
}
