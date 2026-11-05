// For realsies?: the soundtrack. Room tone and a drone under the interview, a low swell under the
// push-in, quiet key ticks under the typing dots, the glitch, then an original chiptune in C major
// (C | G | Am | F || F | G) with the game's UI sounds on its beats and a final chime. No synthesised
// voices: the lines are silent until recorded (voice/<line-id>.wav), and each recording plays at
// its line; quiet typewriter ticks run under the card and the tagline either way.
// The order of the calls below matters: they share one deterministic noise source.

import { Mix, resetNoise, fadeTail, midi, nn, type Stereo } from '../../src/engine/audio/dsp.ts';
import { roomTone, drone, lowSwell, typingTicks, ticks, glitchSfx, leadLine, arpeggios, bassLine, kick, snare, hat, crash, beep, whoosh, chirp, shing, ping, chime, barAt, type Song } from '../../src/engine/audio/instruments.ts';
import { mixVoices, type VoiceClip } from '../../src/engine/audio/voice.ts';
import { BEAT, MUSIC_AT, CUE, END, DRONE, SWELL, PUSH, GLITCH, CLOSE_UPS, DURATION, LINES, beat } from './storyboard.ts';

/** Typing sounds at half the first cut's levels: key ticks under the chat's dots, the montage's typing, typewriter ticks on the card and the tagline. */
const TICKS = { keys: 0.05, montage: 0.025, card: 0.08, tagline: 0.035 };

/** Lead melody in 16ths per bar (bars 1..6), one chord and one bass root per bar. */
export const SONG: Song = {
  at: MUSIC_AT,
  step: BEAT / 4,
  lead: [
    [[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 2], [6, 'G5', 2], [8, 'E6', 3], [11, 'D6', 1], [12, 'C6', 2], [14, 'G5', 2]],
    [[0, 'D5', 2], [2, 'G5', 2], [4, 'B5', 2], [6, 'G5', 2], [8, 'D6', 3], [11, 'C6', 1], [12, 'B5', 2], [14, 'G5', 2]],
    [[0, 'C6', 2], [2, 'A5', 2], [4, 'E5', 2], [6, 'A5', 2], [8, 'C6', 2], [10, 'D6', 2], [12, 'E6', 4]],
    [[0, 'F6', 3], [3, 'E6', 1], [4, 'D6', 2], [6, 'C6', 2], [8, 'D6', 2], [10, 'E6', 2], [12, 'G6', 4]],
    [[0, 'F6', 6], [6, 'E6', 2], [8, 'C6', 4], [12, 'A5', 4]],
    [[0, 'B5', 4], [4, 'D6', 4], [8, 'G6', 6], [14, 'F6', 1], [15, 'D6', 1]],
  ],
  chords: [['C', 'E', 'G'], ['G', 'B', 'D'], ['A', 'C', 'E'], ['F', 'A', 'C'], ['F', 'A', 'C'], ['G', 'B', 'D']],
  roots: ['C3', 'G2', 'A2', 'F2', 'F2', 'G2'],
};

/** Kick on 1 and 3 (and the "and" of 3 every other bar), snare on 2 and 4, eighth hats, a fill into the end card. */
function drums(m: Mix): void {
  const STEP = SONG.step;
  // the pickup: two beats of snare sixteenths, rising
  for (let s = 0; s < 8; s++) snare(m, MUSIC_AT - (8 - s) * STEP, 0.35 + s * 0.09);
  kick(m, MUSIC_AT - 4 * STEP, 0.6);
  for (let b = 0; b < SONG.lead.length; b++) {
    for (let s = 0; s < 16; s++) {
      const at = barAt(SONG, b, s);
      if (s === 0 || s === 8 || (s === 10 && b % 2 === 1)) kick(m, at);
      if (s === 4 || s === 12) snare(m, at);
      if (s % 2 === 0) hat(m, at, s === 14);
    }
    // a fill into the end card
    if (b === 3) for (const s of [13, 14, 15]) snare(m, barAt(SONG, b, s), 0.7);
  }
  crash(m, MUSIC_AT, 1);
  crash(m, beat(CUE.logo), 1.2);
}

/** The game's sounds on the montage's and the end card's beats. */
function cues(m: Mix): void {
  const b = (n: number) => beat(n);
  // lobby: her pedestal lights up
  beep(m, b(CUE.lobbySelect), midi(nn('E6')), 0.05, 0.12, 0.25);
  beep(m, b(CUE.lobbySelect) + 0.05, midi(nn('G6')), 0.08, 0.12, 0.25);
  // countdown: 3, 2, 1, CHAT!
  for (const c of [CUE.count3, CUE.count2, CUE.count1]) beep(m, b(c), midi(nn('G5')), 0.12, 0.17, 0.5);
  beep(m, b(CUE.countGo), midi(nn('G6')), 0.3, 0.17, 0.5);
  // doors whoosh apart
  whoosh(m, b(CUE.doorsOpen), 0.45, 500, 8, 0.3);
  // chat: my message goes out, she types (quiet ticks), hers comes in
  chirp(m, b(CUE.bubbleMe), 0.09, 700, 2, 0.12, 0.2);
  for (let t = b(CUE.typingFrom); t < b(CUE.bubbleThem) - 0.05; t += 0.16) beep(m, t, 2400, 0.012, TICKS.montage, 0.5, -0.2);
  beep(m, b(CUE.bubbleThem), midi(nn('G5')), 0.05, 0.12, 0.5, -0.2);
  beep(m, b(CUE.bubbleThem) + 0.055, midi(nn('C6')), 0.09, 0.12, 0.5, -0.2);
  // call: the cursor ticks over each button
  for (const c of [CUE.hoverYes, CUE.hoverNo, CUE.hoverYes2]) beep(m, b(c) - 0.1, 1900, 0.014, 0.08, 0.5);
  // end card: the logo lands with a coin, the URL pops
  beep(m, b(CUE.logo), midi(nn('C6')), 0.07, 0.15, 0.5);
  beep(m, b(CUE.logo) + 0.07, midi(nn('F6')), 0.42, 0.15, 0.5);
  beep(m, b(CUE.url), midi(nn('A6')), 0.07, 0.09, 0.25);
  // end card: the three rise into frame with a whoosh
  whoosh(m, b(CUE.logo), 0.3, 300, 7, 0.22, 1.6);
  // a shing each time the shine sweeps the logo (the chime rings for itself on the last one)
  END.glints.filter((g) => g !== CUE.chime).forEach((g, i) => shing(m, b(g), midi(nn(i === 0 ? 'C7' : 'D7'))));
  // a ting off his sunglasses as the finger pushes them up
  for (const [f, g] of [[midi(nn('G7')), 0.06], [midi(nn('G7')) * 2.01, 0.02]] as [number, number][]) ping(m, b(END.push[1]), f, 0.4, g, -0.35);
  // a bwip for the eyebrow going up
  chirp(m, b(END.brow), 0.09, 600, 2.2, 0.07, 0.35);
}

export function soundtrack(voices: VoiceClip[]): Stereo {
  resetNoise();
  const m = new Mix(DURATION + 0.05);
  roomTone(m, { until: MUSIC_AT });
  drone(m, { from: DRONE.from, to: DRONE.to, closeUps: CLOSE_UPS });
  lowSwell(m, { from: SWELL.from, peak: PUSH.t1, to: SWELL.to });
  // typing sounds, quiet: key ticks under each chat line's dots, typewriter ticks on the card and the tagline
  for (const l of LINES) {
    if (l.speaker === 'host' || l.speaker === 'guest') typingTicks(m, l, TICKS.keys);
    else ticks(m, l, l.speaker === 'card' ? TICKS.card : TICKS.tagline);
  }
  // the recorded lines, if any (an unrecorded line has no voice)
  mixVoices(m, LINES, voices, DURATION);
  glitchSfx(m, GLITCH[0]);
  leadLine(m, SONG);
  arpeggios(m, SONG);
  bassLine(m, SONG);
  drums(m);
  cues(m);
  chime(m, beat(CUE.chime));
  // tail: fade the last half second
  fadeTail(m, DURATION, 0.5);
  return m;
}
