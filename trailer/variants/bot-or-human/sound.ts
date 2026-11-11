// "Bot or human?": the soundtrack, from the plan. A calm bed at 96 BPM from the trailer's synth kit (a soft pulse pad,
// a 12.5% pulse arpeggio, a stepped triangle bass, quiet hats), A minor round Am, F, C, G under the hook and the
// chat; the game's sounds on every action (key clicks while the player types, a chirp out, the partner's dots, a
// two-note blip in); the bed drops out for the pause: a heartbeat and the game's countdown beeps on 3, 2, 1; the
// reveal lands with a thump and the stamp, the card and the proof with blips; F, G into C and the trailer's chime on
// the end card. No voices. The order of the calls matters: every noise-based sound shares one deterministic source.

import { Mix, resetNoise, fadeTail, midi, nn, Pulse, Tri, OnePole, Biquad, ad, white, type Stereo } from '../../src/engine/audio/dsp.ts';
import { kick, snare, crash, beep, whoosh, chirp, ping, chime } from '../../src/engine/audio/instruments.ts';
import { BEAT, beat, type Plan } from './storyboard.ts';

const LOOP: [string[], string][] = [
  [['A3', 'C4', 'E4'], 'A2'],
  [['A3', 'C4', 'F4'], 'F2'],
  [['G3', 'C4', 'E4'], 'C3'],
  [['G3', 'B3', 'D4'], 'G2'],
];
const C_MAJ: [string[], string] = [['G3', 'C4', 'E4'], 'C3'];

/** The chord at a beat: the loop while the chat runs, then F, G and C over the end card. */
function chordAt(p: Plan, b: number): [string[], string] {
  const endB = p.times.endFrom / BEAT;
  if (b >= endB + 2) return C_MAJ;
  if (b >= endB) return LOOP[3];
  if (b >= p.times.revealFrom / BEAT) return LOOP[1];
  return LOOP[Math.floor(b / 4) % 4];
}

/** A soft pad: each chord tone as two slightly detuned 25% pulses through a low one-pole, one voice per chord held. */
function pad(m: Mix, p: Plan, from: number, to: number): void {
  let b = Math.ceil(from);
  while (b < to) {
    const chord = chordAt(p, b);
    let e = b + 1;
    while (e < to && chordAt(p, e) === chord) e++;
    const len = beat(e) - beat(b) + 0.25;
    chord[0].forEach((n, i) => {
      const f = midi(nn(n));
      for (const det of [0.997, 1.003]) {
        const o = new Pulse(0.25);
        const lp = OnePole.lp(700);
        const lp2 = OnePole.lp(700);
        m.add(beat(b), len, (i - 1) * 0.35 * (det > 1 ? 1 : -1), (_i, t) => {
          const env = Math.min(1, t / 0.3) * Math.min(1, Math.max(0, (len - t) / 0.3));
          return lp2.next(lp.next(o.next(f * det))) * env * 0.016;
        });
      }
    });
    b = e;
  }
}

/** Eighth-note arpeggio an octave up, 12.5% pulse, soft and filtered, panned left and right. */
function arp(m: Mix, p: Plan, from: number, to: number, gain = 0.04): void {
  const order = [0, 1, 2, 1, 0, 1, 2, 1];
  for (let e = from * 2; e < to * 2; e++) {
    const b = e / 2;
    const [notes] = chordAt(p, b);
    const f = midi(nn(notes[order[e % 8]]) + 12);
    const o = new Pulse(0.125);
    const lp = OnePole.lp(2600);
    const d = BEAT * 0.48;
    m.add(beat(b), d, e % 2 ? 0.3 : -0.3, (_i, t) => lp.next(o.next(f)) * ad(t, 0.003, d, 3) * gain);
  }
}

/** Stepped triangle bass: the root on one for two beats, the fifth on three, an octave pick-up on four. */
function bass(m: Mix, p: Plan, from: number, to: number): void {
  for (let bar = Math.floor(from / 4); bar * 4 < to; bar++) {
    for (const [o, iv, len] of [[0, 0, 2], [2, 7, 1.5], [3.5, 12, 0.5]] as [number, number, number][]) {
      const b = bar * 4 + o;
      if (b < from || b >= to) continue;
      const r = nn(chordAt(p, b)[1]);
      const tri = new Tri();
      const f = midi(r + iv);
      const dur = len * BEAT * 0.95;
      m.add(beat(b), dur, 0, (_i, t) => tri.next(f) * Math.min(1, t / 0.006) * Math.min(1, (dur - t) / 0.02) * 0.085);
    }
  }
}

function softHat(m: Mix, at: number, gain: number): void {
  const hp = Biquad.make('hp', 7500);
  m.add(at, 0.03, 0.15, (_i, t) => hp.next(white()) * ad(t, 0.0005, 0.03, 4) * gain);
}

/** A soft key click (typing into the input, or the partner's typing dots). */
function key(m: Mix, at: number, pan: number, gain: number, k: number): void {
  const bp = Biquad.make('bp', 3000 + (k % 3) * 450, 2);
  m.add(at, 0.02, pan, (_n, u) => bp.next(white()) * ad(u, 0.0005, 0.02, 6) * gain);
}

export function soundtrack(p: Plan): Stereo {
  resetNoise();
  const T = p.times;
  const m = new Mix(p.duration + 0.05);
  const chatB = T.chatTo / BEAT, revealB = T.revealFrom / BEAT, endB = T.endFrom / BEAT, outB = T.out / BEAT;

  // the bed: under the hook and the chat; back, lighter, for the reveal; full on the end card
  pad(m, p, 0, chatB);
  pad(m, p, revealB, outB);
  arp(m, p, 2, chatB);
  arp(m, p, revealB + 1, endB, 0.03);
  arp(m, p, endB, outB - 1);
  bass(m, p, 2, chatB);
  bass(m, p, endB, outB - 0.5);
  for (let b = 2; b < chatB; b += 0.5) {
    softHat(m, beat(b), b % 1 ? 0.03 : 0.045);
    if (b % 4 === 0) kick(m, beat(b), 0.45);
  }

  // the hook: a hit and a rising question
  kick(m, 0.02, 0.9);
  crash(m, 0.02, 0.55);
  chirp(m, 0.08, 0.32, 300, 2.6, 0.08, 0);
  beep(m, beat(1), midi(nn('E5')), 0.08, 0.08, 0.5);
  beep(m, beat(1.5), midi(nn('A5')), 0.16, 0.08, 0.5);
  whoosh(m, T.hookTo - 0.1, 0.3, 500, 6, 0.14);

  // the chat: the player's keys and the chirp out; the partner's dots and the blip in
  p.chat.forEach((msg, i) => {
    if (msg.from === 'me') {
      const dur = Math.max(0.2, msg.at - msg.typeFrom - 0.12);
      const step = dur / msg.text.length;
      [...msg.text].forEach((ch, k) => ch !== ' ' && key(m, msg.typeFrom + k * step, 0.3, 0.045, k + i));
      chirp(m, msg.at, 0.09, 700, 2, 0.09, 0.3);
    } else {
      for (let t = msg.typeFrom + 0.06, k = 0; t < msg.at - 0.05; t += 0.11 + ((k * 37) % 5) * 0.012, k++) key(m, t, -0.3, 0.025, k);
      beep(m, msg.at, midi(nn('G5')), 0.05, 0.09, 0.5, -0.25);
      beep(m, msg.at + 0.055, midi(nn('C6')), 0.09, 0.09, 0.5, -0.25);
    }
  });
  // time's up
  beep(m, T.chatTo, midi(nn('E5')), 0.1, 0.1, 0.5);
  beep(m, T.chatTo + 0.12, midi(nn('C5')), 0.22, 0.1, 0.5);

  // the pause: a heartbeat under the question, the game's countdown beep on 3, 2, 1
  for (let b = chatB; b < revealB; b++) {
    kick(m, beat(b), 0.34);
    kick(m, beat(b) + 0.18, 0.2);
  }
  for (const c of T.count) beep(m, c, midi(nn('G5')), 0.12, 0.13, 0.5);

  // the reveal: a whoosh in, a thump and a low hit for the stamp, a blip for the card, rising blips for the proof
  whoosh(m, T.revealFrom - 0.05, 0.3, 300, 6, 0.16);
  kick(m, T.stamp, 0.8);
  crash(m, T.stamp, 0.35);
  beep(m, T.stamp, 220, 0.09, 0.12, 0.5);
  beep(m, T.stamp + 0.05, p.transcript.verdict === 'bot' ? 165 : 330, 0.22, 0.1, 0.5);
  chirp(m, T.card, 0.08, 800, 1.6, 0.05, -0.2);
  ['C6', 'E6', 'G6'].forEach((n, i) => beep(m, T.proof + i * 0.07, midi(nn(n)), 0.05, 0.07, 0.25, 0.2));
  for (let b = revealB + 2; b < endB; b += 1) softHat(m, beat(b), 0.035);

  // the end card: the logo lands on a coin and a crash, the drums lift, the URL pops, the chime
  beep(m, T.endFrom, midi(nn('C6')), 0.07, 0.15, 0.5);
  beep(m, T.endFrom + 0.07, midi(nn('F6')), 0.42, 0.15, 0.5);
  crash(m, T.endFrom, 0.8);
  for (let b = endB; b < outB - 2; b++) {
    if (b % 2 === 0) kick(m, beat(b), 0.6);
    else snare(m, beat(b), 0.4);
    softHat(m, beat(b + 0.5), 0.04);
  }
  whoosh(m, T.endFrom, 0.3, 300, 7, 0.2, 1.6);
  beep(m, T.url, midi(nn('A6')), 0.07, 0.09, 0.25);
  for (const [f, g] of [[midi(nn('G7')), 0.05], [midi(nn('G7')) * 2.01, 0.02]] as [number, number][]) ping(m, T.free, f, 0.4, g, 0.3);
  chime(m, Math.min(T.free + BEAT, T.out - 1.2));
  fadeTail(m, p.duration, 0.4);
  return m;
}
