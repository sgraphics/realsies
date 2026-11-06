// How it plays: the soundtrack. A calm bed at 96 BPM from the trailer's synth kit (a soft pulse pad,
// a 12.5% pulse arpeggio in eighths, a stepped triangle bass, quiet hats and a soft kick), A minor
// going round Am, F, C, G, resolving F, G, C into the end card; the game's UI sounds on every action
// (clicks, the coin, the countdown beeps, typing, messages, the call, the reveal, each check
// passing); and the trailer's end-card cues and chime. No voices. The order of the calls below
// matters: every noise-based sound shares one deterministic source.

import { Mix, resetNoise, fadeTail, midi, nn, Pulse, Tri, OnePole, Biquad, ad, white, type Stereo } from '../../src/engine/audio/dsp.ts';
import { kick, snare, crash, beep, whoosh, chirp, shing, ping, chime, ticks } from '../../src/engine/audio/instruments.ts';
import { mixVoices, type VoiceClip } from '../../src/engine/audio/voice.ts';
import { BEAT, beat, TIMES, CHAT, END, DURATION, LINES, TAGLINE, NOTES } from './storyboard.ts';

const BAR = 4 * BEAT;
const barAt = (bar: number, b = 0) => beat(bar * 4 + b);

/** Chords by bar: Am, F, C, G round and round, then F, G into C on the chime. */
const LOOP: [string[], string][] = [
  [['A3', 'C4', 'E4'], 'A2'],
  [['A3', 'C4', 'F4'], 'F2'],
  [['G3', 'C4', 'E4'], 'C3'],
  [['G3', 'B3', 'D4'], 'G2'],
];
const BARS = 20;
function chordAt(bar: number): [string[], string] {
  if (bar === 17) return LOOP[1];
  if (bar === 18) return LOOP[3];
  if (bar >= 19) return LOOP[2];
  return LOOP[bar % 4];
}

// ---------------------------------------------------------------- the bed

/** A soft pad: each chord tone as two slightly detuned 25% pulses through a low one-pole, slow in and out. */
function pad(m: Mix): void {
  for (let bar = 0; bar < BARS; bar++) {
    const [notes] = chordAt(bar);
    const t0 = barAt(bar);
    const len = bar >= 19 ? 2.4 : BAR + 0.25;
    notes.forEach((n, i) => {
      const f = midi(nn(n));
      for (const det of [0.997, 1.003]) {
        const o = new Pulse(0.25);
        const lp = OnePole.lp(700);
        const lp2 = OnePole.lp(700);
        m.add(t0, len, (i - 1) * 0.35 * (det > 1 ? 1 : -1), (_i, t) => {
          const env = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (len - t) / 0.3));
          return lp2.next(lp.next(o.next(f * det))) * env * 0.016;
        });
      }
    });
  }
}

/** Eighth-note arpeggio an octave up, 12.5% pulse, soft and filtered, panned left and right. */
function arp(m: Mix, from: number, to: number): void {
  const order = [0, 1, 2, 1, 0, 1, 2, 1];
  for (let bar = Math.floor(from / 4); bar < Math.ceil(to / 4); bar++) {
    const [notes] = chordAt(bar);
    for (let e = 0; e < 8; e++) {
      const b = bar * 4 + e / 2;
      if (b < from || b >= to) continue;
      const f = midi(nn(notes[order[e]]) + 12);
      const o = new Pulse(0.125);
      const lp = OnePole.lp(2600);
      const d = BEAT * 0.48;
      m.add(beat(b), d, e % 2 ? 0.3 : -0.3, (_i, t) => lp.next(o.next(f)) * ad(t, 0.003, d, 3) * 0.042);
    }
  }
}

/** Stepped triangle bass: the root on one for two beats, the fifth on three, an octave pick-up on four. */
function bass(m: Mix, from: number, to: number): void {
  for (let bar = Math.floor(from / 4); bar < Math.ceil(to / 4); bar++) {
    const [, root] = chordAt(bar);
    const r = nn(root);
    const notes: [number, number, number][] = bar >= 19 ? [[0, r, 3.5]] : [[0, r, 2], [2, r + 7, 1.5], [3.5, r + 12, 0.5]];
    for (const [b, n, len] of notes) {
      const at = bar * 4 + b;
      if (at < from || at >= to) continue;
      const tri = new Tri();
      const f = midi(n);
      const dur = len * BEAT * 0.95;
      m.add(beat(at), dur, 0, (_i, t) => tri.next(f) * Math.min(1, t / 0.006) * Math.min(1, (dur - t) / 0.02) * 0.085);
    }
  }
}

/** A quiet closed hat (the trailer's, at a gain). */
function softHat(m: Mix, at: number, gain: number): void {
  const hp = Biquad.make('hp', 7500);
  m.add(at, 0.03, 0.15, (_i, t) => hp.next(white()) * ad(t, 0.0005, 0.03, 4) * gain);
}

function drums(m: Mix): void {
  const T = TIMES;
  const callFrom = T.callFrom / BEAT, resultsFrom = T.resultsFrom / BEAT;
  for (let b = 0; b < END.logo; b += 0.5) {
    const at = beat(b);
    const inCall = b >= callFrom && b < resultsFrom;
    // hats from the second bar, off while the player makes the call
    if (b >= 8 && !inCall) softHat(m, at, b % 1 ? 0.035 : 0.05);
    // a soft kick on each bar from the chat on, on one and three after the reveal
    if (b >= 16 && !inCall && b % 4 === 0) kick(m, at, 0.5);
    if (b >= resultsFrom && b % 4 === 2) kick(m, at, 0.35);
    // while deciding: a slow heartbeat
    if (inCall && b % 2 === 0) {
      kick(m, at, 0.32);
      kick(m, at + 0.18, 0.2);
    }
  }
  // the end card lifts: kick on one and three, snare on two and four, a crash as the logo lands
  for (let b = END.logo; b < END.chime; b += 1) {
    if (b % 2 === 0) kick(m, beat(b), 0.7);
    else snare(m, beat(b), 0.45);
    softHat(m, beat(b), 0.06);
    softHat(m, beat(b + 0.5), 0.04);
  }
  crash(m, beat(END.logo), 0.9);
}

/** A sparse lead over the reveal and the proof: one calm four-bar phrase, twice. */
function lead(m: Mix): void {
  const phrase: [number, string, number][] = [
    [0, 'E5', 2], [2, 'C5', 1], [3, 'D5', 1],
    [4, 'C5', 3], [7, 'A4', 1],
    [8, 'G4', 2], [10, 'C5', 1], [11, 'E5', 1],
    [12, 'D5', 4],
    [16, 'C5', 2], [18, 'A4', 2],
  ];
  for (const start of [48]) {
    for (const [b, n, len] of phrase) {
      const at = start + b;
      if (at >= END.logo) continue;
      const f = midi(nn(n));
      const o = new Pulse(0.25);
      const lp = OnePole.lp(2400);
      const dur = len * BEAT * 0.92;
      m.add(beat(at), dur + 0.05, 0.05, (_i, t) => {
        const vib = t > 0.2 ? 1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t) : 1;
        const env = Math.min(1, t / 0.02) * (t < dur ? 1 - 0.35 * Math.min(1, t / 0.6) : Math.max(0, 0.65 * (1 - (t - dur) / 0.05)));
        return lp.next(o.next(f * vib)) * env * 0.055;
      });
    }
  }
}

// ---------------------------------------------------------------- the game's sounds

/** A soft key click (typing into the input, or her typing dots). */
function key(m: Mix, at: number, pan: number, gain: number, k: number): void {
  const bp = Biquad.make('bp', 3000 + (k % 3) * 450, 2);
  m.add(at, 0.02, pan, (_n, u) => bp.next(white()) * ad(u, 0.0005, 0.02, 6) * gain);
}

function click(m: Mix, at: number): void {
  beep(m, at, 1700, 0.016, 0.09, 0.5);
  beep(m, at + 0.018, 900, 0.02, 0.06, 0.5);
}

function cues(m: Mix): void {
  const T = TIMES;
  // lobby: hover, tap, her pedestal lights up
  beep(m, T.hover, 1900, 0.014, 0.06, 0.5);
  click(m, T.click);
  beep(m, T.click + 0.06, midi(nn('E6')), 0.05, 0.1, 0.25);
  beep(m, T.click + 0.11, midi(nn('G6')), 0.09, 0.1, 0.25);
  // the dialog opens
  chirp(m, T.dialog, 0.08, 520, 1.8, 0.06, 0);
  // 5 coins: the hover, the click, a coin
  beep(m, T.onCoins, 1900, 0.014, 0.06, 0.5);
  click(m, T.clickCoins);
  beep(m, T.clickCoins + 0.05, midi(nn('B5')), 0.06, 0.11, 0.5);
  beep(m, T.clickCoins + 0.11, midi(nn('E6')), 0.32, 0.11, 0.5);
  // on the table, matched
  beep(m, T.placing + 0.1, midi(nn('A5')), 0.05, 0.05, 0.25);
  beep(m, T.matched, midi(nn('C6')), 0.05, 0.08, 0.25);
  beep(m, T.matched + 0.06, midi(nn('G6')), 0.08, 0.08, 0.25);
  // 3, 2, 1, CHAT!, the doors
  for (const c of [T.count3, T.count2, T.count1]) beep(m, c, midi(nn('G5')), 0.12, 0.13, 0.5);
  beep(m, T.go, midi(nn('G6')), 0.3, 0.13, 0.5);
  whoosh(m, T.doors, 0.45, 500, 8, 0.24);
  // the chat: her typing into the input, sent; her dots, her messages
  CHAT.forEach((msg, i) => {
    if (msg.from === 'me') {
      const dur = Math.max(0.2, msg.at - msg.typeFrom - 0.2);
      const step = dur / msg.text.length;
      [...msg.text].forEach((ch, k) => ch !== ' ' && key(m, msg.typeFrom + k * step, 0.3, 0.04, k + i));
      chirp(m, msg.at, 0.09, 700, 2, 0.09, 0.3);
    } else {
      for (let t = msg.typeFrom + 0.08, k = 0; t < msg.at - 0.06; t += 0.12 + ((k * 37) % 5) * 0.012, k++) key(m, t, -0.3, 0.022, k);
      beep(m, msg.at, midi(nn('G5')), 0.05, 0.09, 0.5, -0.25);
      beep(m, msg.at + 0.055, midi(nn('C6')), 0.09, 0.09, 0.5, -0.25);
    }
  });
  // time's up
  beep(m, T.chatTo, midi(nn('E5')), 0.1, 0.1, 0.5);
  beep(m, T.chatTo + 0.12, midi(nn('C5')), 0.22, 0.1, 0.5);
  // the call: the cursor over YES, over NO, the click, the lock
  beep(m, T.hoverYes - 0.1, 1900, 0.014, 0.06, 0.5);
  beep(m, T.hoverNo - 0.1, 1900, 0.014, 0.06, 0.5);
  click(m, T.clickNo);
  beep(m, T.clickNo + 0.04, 110, 0.12, 0.14, 0.5);
  ping(m, T.clickNo + 0.2, midi(nn('A6')), 0.5, 0.05, 0.2);
  ping(m, T.clickNo + 0.2, midi(nn('A6')) * 2.01, 0.3, 0.015, 0.2);
  // the round clock spins down, ticking faster, a ding at 0:00
  for (let k = 0, t = T.spinFrom; t < T.spinTo; k++, t += Math.max(0.035, 0.11 - k * 0.006)) beep(m, t, 2300 + (k % 2) * 300, 0.01, 0.035, 0.5);
  ping(m, T.spinTo, midi(nn('E6')), 0.6, 0.06, 0);
  // the results: the panel, the stamp, Right, the coins counting up
  whoosh(m, T.resultsFrom, 0.3, 300, 6, 0.16);
  kick(m, T.stamp, 0.55);
  beep(m, T.stamp, 220, 0.09, 0.12, 0.5);
  ['C6', 'E6', 'G6'].forEach((n, i) => beep(m, T.right + i * 0.06, midi(nn(n)), 0.05, 0.08, 0.25));
  for (let k = 0, t = T.coinsFrom; t < T.coinsTo; k++, t += 0.075) beep(m, t, midi(nn(k % 2 ? 'E6' : 'B5')), 0.03, 0.045, 0.5);
  beep(m, T.coinsTo, midi(nn('C6')), 0.07, 0.1, 0.5);
  beep(m, T.coinsTo + 0.07, midi(nn('F6')), 0.36, 0.1, 0.5);
  // the Turing bonus callout
  chirp(m, NOTES.turing.from, 0.07, 800, 1.6, 0.05, -0.2);
  // to Verify, the drawer, each check passing, the verdict
  beep(m, T.clickVerify - 0.25, 1900, 0.014, 0.06, 0.5);
  click(m, T.clickVerify);
  whoosh(m, T.verifyFrom, 0.25, 900, 4, 0.14);
  T.checks.forEach((c, i) => beep(m, c, 880 * Math.pow(2, (i * 2) / 12), 0.04, 0.06, 0.25, 0.2));
  ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => ping(m, T.verdict + i * 0.05, midi(nn(n)), 0.9, 0.035, (i - 1.5) * 0.2));
  // the frames on the proof
  for (const at of [NOTES.signed.from, NOTES.chain.from]) chirp(m, at, 0.07, 900, 1.5, 0.045, 0.2);
}

/** The trailer's end-card sounds, on this grid. */
function endCard(m: Mix): void {
  const b = (n: number) => beat(n);
  beep(m, b(END.logo), midi(nn('C6')), 0.07, 0.15, 0.5);
  beep(m, b(END.logo) + 0.07, midi(nn('F6')), 0.42, 0.15, 0.5);
  beep(m, b(END.url), midi(nn('A6')), 0.07, 0.09, 0.25);
  whoosh(m, b(END.logo), 0.3, 300, 7, 0.22, 1.6);
  END.glints.filter((g) => g !== END.chime).forEach((g, i) => shing(m, b(g), midi(nn(i === 0 ? 'C7' : 'D7'))));
  for (const [f, g] of [[midi(nn('G7')), 0.06], [midi(nn('G7')) * 2.01, 0.02]] as [number, number][]) ping(m, b(END.push[1]), f, 0.4, g, -0.35);
  chirp(m, b(END.brow), 0.09, 600, 2.2, 0.07, 0.35);
  // the tagline types on, quietly
  ticks(m, TAGLINE, 0.03);
  chime(m, b(END.chime));
}

export function soundtrack(voices: VoiceClip[]): Stereo {
  resetNoise();
  const m = new Mix(DURATION + 0.05);
  pad(m);
  arp(m, 0, END.chime);
  bass(m, 0, END.chime + 4);
  lead(m);
  drums(m);
  cues(m);
  endCard(m);
  mixVoices(m, LINES, voices, DURATION);
  fadeTail(m, DURATION, 0.5);
  return m;
}
