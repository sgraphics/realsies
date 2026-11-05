// The trailer as data: every shot, framing, line of dialogue, blink, glance and music cue, in
// seconds from the first frame. The renderer, the audio synth, the contact sheet and script.md all
// read this file, so a retime here moves picture, sound and paperwork together.

import type { ThemeId } from '../../../shared/protocol.ts';
import { rngFrom, randomSeed } from '../../src/core/rng.ts';
import type { ActorState } from './actor.ts';

export const FPS = 24;
export const TITLE = 'Realsies: For Realsies? (launch trailer)';

// ---------------------------------------------------------------- music grid

export const BPM = 136;
export const BEAT = 60 / BPM;
/** Downbeat of the chiptune (bar 1, beat 1): the montage's first frame. */
export const MUSIC_AT = 30.5;
/** Absolute time of a beat counted from the music's first downbeat (negative = pickup). */
export const beat = (n: number) => MUSIC_AT + n * BEAT;

// ---------------------------------------------------------------- shots

export type ShotKind = 'black' | 'set' | 'card' | 'lobby' | 'countdown' | 'chat' | 'call' | 'end';

export interface Framing {
  /** World point at the centre of the frame and output pixels per world pixel. */
  cx: number;
  cy: number;
  k: number;
  /** wide = full detail and the foreground camera; tight = defocused room behind the faces. */
  lens: 'wide' | 'tight';
}

export interface Shot {
  id: string;
  kind: ShotKind;
  start: number;
  end: number;
  /** Shot list line for script.md. */
  title: string;
  notes: string;
  framing?: Framing;
  /** Fade in from black over this many seconds (palette steps). */
  fadeIn?: number;
  fadeOut?: number;
  /** Time used for the contact sheet (absolute). */
  key: number;
}

const T = {
  wide: 2.5,
  mi: 7.5,
  ms: 11.5,
  mci: 15.5,
  cui: 19.5,
  cus: 23.5,
  card: 27.5,
  lobby: MUSIC_AT,
  countdown: beat(3),
  chat: beat(7),
  call: beat(12),
  end: beat(16),
  out: 43.0,
};

export const SHOTS: Shot[] = [
  {
    id: 's01', kind: 'black', start: 0, end: T.wide, key: 1.2,
    title: 'Black', notes: 'Black. Faint room tone fades up.',
  },
  {
    id: 's02', kind: 'set', start: T.wide, end: T.mi, key: 6.3, fadeIn: 0.6,
    title: 'Wide: the interview set',
    notes: 'Wide of the dim set: two green leather chairs angled toward each other, a side table with two glasses of water (his half drunk, hers untouched), a softbox glowing at the left, a fig, a warm floor lamp, a boom mic dipping in, the cinema camera on its tripod as a foreground silhouette with its tally light blinking. Interviewer at left, guest at right. Silence. He glances at the lens, then back.',
    framing: { cx: 160, cy: 84, k: 6, lens: 'wide' },
  },
  {
    id: 's03', kind: 'set', start: T.mi, end: T.ms, key: 10.4,
    title: 'Medium: interviewer',
    notes: 'Medium on the interviewer, framed left, looking at her. A long pause. One blink. "So."',
    framing: { cx: 121, cy: 90, k: 24, lens: 'tight' },
  },
  {
    id: 's04', kind: 'set', start: T.ms, end: T.mci, key: 14.6,
    title: 'Medium: guest',
    notes: 'Medium on the guest, framed right. She blinks, then a small smile. "Mm-hmm."',
    framing: { cx: 199, cy: 90, k: 24, lens: 'tight' },
  },
  {
    id: 's05', kind: 'set', start: T.mci, end: T.cui, key: 18.9,
    title: 'Medium close: interviewer',
    notes: 'Tighter on the interviewer. "OK." A beat. "Good chat." Pause. A slight head tilt.',
    framing: { cx: 118, cy: 88.5, k: 30, lens: 'tight' },
  },
  {
    id: 's06', kind: 'set', start: T.cui, end: T.cus, key: 22.6,
    title: 'Close-up: interviewer',
    notes: 'Close-up, held. The key line: "For realsies?"',
    framing: { cx: 114, cy: 87.5, k: 40, lens: 'tight' },
  },
  {
    id: 's07', kind: 'set', start: T.cus, end: T.card, key: 645 / FPS,
    title: 'Close-up: guest',
    notes: '"I\'m always for realsies." She does not blink. Her eyes slide to the lens. A two-frame pixel glitch tears across her face (scanlines shift, the palette flashes, her eyes light up cyan), then she is normal again.',
    framing: { cx: 208, cy: 87, k: 40, lens: 'tight' },
  },
  {
    id: 's08', kind: 'card', start: T.card, end: T.lobby, key: 29.4,
    title: 'Card: "Can you tell?"',
    notes: 'Black. "Can you tell?" types on in white pixel text with a blinking cursor. A snare fill.',
  },
  {
    id: 's09', kind: 'lobby', start: T.lobby, end: T.countdown, key: beat(2.4),
    title: 'Montage: the lobby',
    notes: 'The chiptune kicks in. Star Station lobby: ten characters idling on pedestals with their gamertags. Her pedestal lights up.',
  },
  {
    id: 's10', kind: 'countdown', start: T.countdown, end: T.chat, key: beat(4.25),
    title: 'Montage: 3, 2, 1, CHAT!',
    notes: 'The VS countdown on the beat: 3, 2, 1, CHAT! The doors fly apart.',
  },
  {
    id: 's11', kind: 'chat', start: T.chat, end: T.call, key: beat(11.4),
    title: 'Montage: the chat',
    notes: 'The chat screen, fuse burning. "ok be honest. are you a bot?" She types... "lol no. are you?"',
  },
  {
    id: 's12', kind: 'call', start: T.call, end: T.end, key: beat(14.1),
    title: 'Montage: Real human? YES / NO',
    notes: 'The call screen. A cursor drifts to YES, to NO, back to YES. Cut before the click.',
  },
  {
    id: 's13', kind: 'end', start: T.end, end: T.out, key: beat(24.4), fadeOut: 0.5,
    title: 'End card: the smug three',
    notes: 'Low-angle hero shot. The curved REALSIES logo drops in big across the top and a glint sweeps its letters, with sparkles. Below it three characters rise into frame, waist up and cropped by the bottom edge, looming over a low horizon (a planet\'s limb with the sun coming up behind them, rays fanning up the sky, a rim of backlight on each silhouette): the guest in the middle, arms crossed, with a slow nod; Coconut843 pushing his sunglasses up with one finger (ting); Pebble242 raising one eyebrow. All half-lidded, all smirking. "Come and guess if she\'s for realsies." under the logo, realsies.lol on a dark foot band. The shine sweeps again and the final chime rings out.',
  },
];

export const DURATION = T.out;
export const THEME: ThemeId = 'space';

export function shotAt(t: number): Shot {
  for (const s of SHOTS) if (t >= s.start && t < s.end) return s;
  return SHOTS[SHOTS.length - 1];
}

// ---------------------------------------------------------------- dialogue

export type Speaker = 'host' | 'guest';

export interface Line {
  /** Voice file id: art/scripts/trailer/voice/<id>.wav replaces the blips for this line. */
  id: string;
  speaker: Speaker | 'card' | 'tagline';
  /** '|' marks a held pause while typing (not shown). */
  text: string;
  at: number;
  /** Characters per second while typing. */
  cps: number;
  /** When the subtitle leaves the screen (default: end of its shot). */
  until?: number;
  /** Semitone offsets per character for the blip voice (optional). */
  tune?: number[];
}

/** Seconds a '|' pause holds. */
export const PAUSE = 0.62;

export const LINES: Line[] = [
  { id: 'so', speaker: 'host', text: 'So.', at: 9.35, cps: 11 },
  { id: 'mm-hmm', speaker: 'guest', text: 'Mm-hmm.', at: 13.45, cps: 12, tune: [0, -2, 0, 5, 5, 3, 0] },
  { id: 'good-chat', speaker: 'host', text: 'OK.| Good chat.', at: 15.95, cps: 13 },
  { id: 'for-realsies', speaker: 'host', text: 'For realsies?', at: 20.5, cps: 10 },
  { id: 'always', speaker: 'guest', text: "I'm always for realsies.", at: 24.15, cps: 15 },
  { id: 'can-you-tell', speaker: 'card', text: 'Can you tell?', at: 28.15, cps: 14 },
  { id: 'tagline', speaker: 'tagline', text: "Come and guess if she's for realsies.", at: beat(17.5), cps: 30 },
];

/** Timeline of a line: when each visible character appears (pauses applied). */
export function lineTimes(l: Line): { chars: string[]; times: number[]; end: number } {
  const chars: string[] = [];
  const times: number[] = [];
  let t = l.at;
  for (const ch of l.text) {
    if (ch === '|') {
      t += PAUSE;
      continue;
    }
    chars.push(ch);
    times.push(t);
    t += 1 / l.cps;
  }
  return { chars, times, end: t };
}

/** Characters of a line visible at time t. */
export function typedCount(l: Line, t: number): number {
  const { times } = lineTimes(l);
  let n = 0;
  while (n < times.length && times[n] <= t) n++;
  return n;
}

export function lineShown(l: Line): string {
  return l.text.replace(/\|/g, '');
}

// ---------------------------------------------------------------- actor direction

export interface Direction {
  /** Base state, then timed changes (held until the next change). */
  base: Partial<ActorState>;
  keys: { t: number; set: Partial<ActorState> }[];
  /** Blink start times (each lasts BLINK seconds). */
  blinks: number[];
  /** Breathing: one 1-px drop per period, off inside these windows. */
  breathPeriod: number;
  breathOff: [number, number][];
}

export const BLINK = 0.125;

export const DIRECTION: Record<Speaker, Direction> = {
  host: {
    base: { look: 1 },
    keys: [
      // in the wide he glances at the lens, then back at her
      { t: 4.9, set: { look: 0 } },
      { t: 5.75, set: { look: 1 } },
      // "Good chat." Pause. The head tilt, held through the cut
      { t: 18.35, set: { tilt: 1, tiltDir: 1 } },
      { t: 18.45, set: { tilt: 2, tiltDir: 1 } },
      { t: 18.55, set: { tilt: 3, tiltDir: 1 } },
      { t: 19.5, set: { tilt: 0 } },
    ],
    blinks: [3.7, 8.6, 17.25, 22.75],
    breathPeriod: 3.6,
    breathOff: [[19.5, 23.5]],
  },
  guest: {
    base: { look: -1 },
    keys: [
      { t: 12.95, set: { smile: true } },
      // after the line her eyes slide to the lens
      { t: 26.25, set: { look: 0 } },
    ],
    // she blinks like a person in the wide and the medium; in her close-up she never does
    blinks: [4.4, 12.15],
    breathPeriod: 4.1,
    breathOff: [[23.5, 27.5]],
  },
};

// ---------------------------------------------------------------- effects and cues

/** The two consecutive glitch frames on her face (frames 645 and 646, as start times in seconds). */
export const GLITCH_FRAME = 645;
export const GLITCH = [GLITCH_FRAME / FPS, (GLITCH_FRAME + 1) / FPS];
/** Drone: fades in with the wide, cut dead by the glitch. */
export const DRONE = { from: 2.5, to: GLITCH[0] };

/** Montage beats (in beats from MUSIC_AT). */
export const CUE = {
  lobbySelect: 1.5,
  count3: 3,
  count2: 4,
  count1: 5,
  countGo: 6,
  doorsOpen: 6.5,
  bubbleMe: 7.25,
  typingFrom: 8.6,
  bubbleThem: 9.6,
  cursorIn: 12.2,
  hoverYes: 13.05,
  hoverNo: 14.05,
  hoverYes2: 15.1,
  logo: 16,
  url: 20.5,
  chime: 24,
};

export const CHAT_LINES = {
  me: 'ok be honest. are you a bot?',
  them: 'lol no. are you?',
};

/**
 * End card beats (counted from MUSIC_AT, like CUE): the logo's shine sweeps, her nod (down, up),
 * the sunglasses push (arm up, finger on the bridge, finger off, arm down), the eyebrow.
 */
export const END = {
  glints: [17, 22, 24],
  nod: [18.5, 19.25] as [number, number],
  push: [19.6, 19.8, 20.6, 21.15] as [number, number, number, number],
  brow: 21.5,
};

/** Gamertags for the lobby; index 2 is her. */
export const TAGS = ['Maple330', 'Kraken246', 'Juniper31', 'Coconut843', 'Pebble242', 'Lobster99', 'Acorn132', 'Lemon89', 'Rhino946', 'Walnut81'];
export const GUEST_SEAT = 2;
export const GUEST_TAG = TAGS[GUEST_SEAT];

/** The lobby's rig seeds by seat ('' at her seat), shared by the montage and the end card. */
export function lobbySeeds(): string[] {
  const r = rngFrom('trailer-lobby');
  return TAGS.map((_, i) => (i === GUEST_SEAT ? '' : randomSeed(r)));
}
/** The two lobby characters who join her on the end card. */
export const END_SEATS = { left: 3, right: 4 };
