// For realsies?: the trailer as data. Every shot, framing, line of dialogue, blink, glance and
// music cue, in seconds from the first frame. The scenes, the soundtrack, the contact sheet and
// script.md all read this file, so a retime here moves picture, sound and paperwork together.

import type { ActorDirection } from '../../src/engine/actor.ts';
import { beatGrid, type Framing, type Line, type Push, type Shot, type Speaker } from '../../src/engine/timeline.ts';
import type { MontageCues } from '../../src/scenes/montage.ts';
import type { ThemeId } from '../../src/art.ts';

export const FPS = 24;
export const TITLE = 'Realsies: For Realsies? (launch trailer)';
export const THEME: ThemeId = 'space';

// ---------------------------------------------------------------- music grid

export const BPM = 136;
/** Downbeat of the chiptune (bar 1, beat 1): the montage's first frame. */
export const MUSIC_AT = 37.4;
const grid = beatGrid(BPM, MUSIC_AT);
export const BEAT = grid.beatLen;
/** Absolute time of a beat counted from the music's first downbeat (negative = pickup). */
export const beat = grid.beat;

// ---------------------------------------------------------------- shots

const T = {
  wide: 2.5,
  ms1: 6.5,
  mi: 11.6,
  ms2: 14.4,
  mci: 18.0,
  cui: 22.6,
  cus: 26.8,
  push: 30.4,
  card: 34.4,
  lobby: MUSIC_AT,
  countdown: beat(3),
  chat: beat(7),
  call: beat(12),
  end: beat(16),
  out: 50.0,
};

/** Her close-up, and the extreme close-up of her eyes the camera pushes into. */
const CUS: Framing = { cx: 208, cy: 87, k: 40, lens: 'tight' };
const EYES_ECU: Framing = { cx: 212, cy: 86.5, k: 112, lens: 'tight' };
/** The push: slow, in even zoom steps, then a held beat on her eyes before the glitch. */
export const PUSH: Push = { from: CUS, to: EYES_ECU, t0: 30.45, t1: 33.25 };

/** The two consecutive glitch frames, in her eyes at the end of the held beat (frames 816, 817). */
export const GLITCH_FRAME = 816;
export const GLITCH = [GLITCH_FRAME / FPS, (GLITCH_FRAME + 1) / FPS];

export const SHOTS: Shot[] = [
  {
    id: 's01', kind: 'black', start: 0, end: T.wide, key: 1.2,
    title: 'Black', notes: 'Black. Faint room tone fades up.',
  },
  {
    id: 's02', kind: 'set', start: T.wide, end: T.ms1, key: 5.6, fadeIn: 0.6,
    title: 'Wide: the interview set',
    notes: 'Wide of the dim set: two green leather chairs angled toward each other, a side table with two glasses of water (his half drunk, hers untouched), a softbox glowing at the left, a fig, a warm floor lamp, a boom mic dipping in, the cinema camera on its tripod as a foreground silhouette with its tally light blinking. Interviewer at left, guest at right. Silence. He glances at the lens, then back.',
    framing: { cx: 160, cy: 84, k: 6, lens: 'wide' },
  },
  {
    id: 's03', kind: 'set', start: T.ms1, end: T.mi, key: 10.9,
    title: 'Medium: guest',
    notes: 'Medium on the guest, framed right, big blue eyes on him. A blink. Her typing dots, then her first bubble types in: "I\'m engaging with you as a human being."',
    framing: { cx: 199, cy: 90, k: 24, lens: 'tight' },
  },
  {
    id: 's04', kind: 'set', start: T.mi, end: T.ms2, key: 13.8,
    title: 'Medium: interviewer',
    notes: 'Medium on the interviewer, framed left. He says nothing. One blink. Her bubble hangs there.',
    framing: { cx: 121, cy: 90, k: 24, lens: 'tight' },
  },
  {
    id: 's05', kind: 'set', start: T.ms2, end: T.mci, key: 17.7,
    title: 'Medium: guest again',
    notes: 'Back on her. Typing dots. "Why would I deceive you." The chat scrolls up. A small smile.',
    framing: { cx: 199, cy: 90, k: 24, lens: 'tight' },
  },
  {
    id: 's06', kind: 'set', start: T.mci, end: T.cui, key: 22.3,
    title: 'Medium close: interviewer',
    notes: 'Tighter on him. His typing dots run long. "Ohkay," a beat, "OK good chat". Pause. A slight head tilt.',
    framing: { cx: 118, cy: 88.5, k: 30, lens: 'tight' },
  },
  {
    id: 's07', kind: 'set', start: T.cui, end: T.cus, key: 26.3,
    title: 'Close-up: interviewer',
    notes: 'Close-up, held. Typing dots. The key line, slowly: "you\'re for realsies?"',
    framing: { cx: 114, cy: 87.5, k: 40, lens: 'tight' },
  },
  {
    id: 's08', kind: 'set', start: T.cus, end: T.push, key: 30.0,
    title: 'Close-up: guest',
    notes: 'Close-up on her large blue eyes, highlights and all. She does not blink. Typing dots. "I\'m always for realsies". Her eyes slide to the lens.',
    framing: CUS,
  },
  {
    id: 's09', kind: 'set', start: T.push, end: T.card, key: GLITCH_FRAME / FPS,
    title: 'Push-in: her eyes',
    notes: 'Continuous from the close-up: the chat slides away and the camera pushes in, slowly, in whole-number zoom steps, from her close-up to an extreme close-up of her eyes, under a low swell. A held beat on the eyes. Then the bot glitch lands in her eyes for two frames (rows tear sideways, the irises flash negative, then glow cyan like a screen), and she is normal again.',
    push: PUSH,
  },
  {
    id: 's10', kind: 'card', start: T.card, end: T.lobby, key: 36.3,
    title: 'Card: "Can you tell?"',
    notes: 'Black. "Can you tell?" types on in white pixel text with a blinking cursor. A snare fill.',
  },
  {
    id: 's11', kind: 'lobby', start: T.lobby, end: T.countdown, key: beat(2.4),
    title: 'Montage: the lobby',
    notes: 'The chiptune kicks in. Star Station lobby: ten characters idling on pedestals with their gamertags. Her pedestal lights up.',
  },
  {
    id: 's12', kind: 'countdown', start: T.countdown, end: T.chat, key: beat(4.25),
    title: 'Montage: 3, 2, 1, CHAT!',
    notes: 'The VS countdown on the beat: 3, 2, 1, CHAT! The doors fly apart.',
  },
  {
    id: 's13', kind: 'chat', start: T.chat, end: T.call, key: beat(11.4),
    title: 'Montage: the chat',
    notes: 'The chat screen, fuse burning. "ok be honest. are you a bot?" She types... "lol no. are you?"',
  },
  {
    id: 's14', kind: 'call', start: T.call, end: T.end, key: beat(14.1),
    title: 'Montage: Real human? YES / NO',
    notes: 'The call screen. A cursor drifts to YES, to NO, back to YES. Cut before the click.',
  },
  {
    id: 's15', kind: 'end', start: T.end, end: T.out, key: beat(24.4), fadeOut: 0.5,
    title: 'End card: the smug three',
    notes: 'Low-angle hero shot. The curved REALSIES logo drops in big across the top and a glint sweeps its letters, with sparkles. Below it three characters rise into frame, waist up and cropped by the bottom edge, looming over a low horizon (a planet\'s limb with the sun coming up behind them, rays fanning up the sky, a rim of backlight on each silhouette): the guest in the middle, arms crossed, with a slow nod; Coconut843 pushing his sunglasses up with one finger (ting); Pebble242 raising one eyebrow. All half-lidded, all smirking. "Come and guess if she\'s for realsies." under the logo, realsies.lol on a dark foot band. The shine sweeps again and the final chime rings out.',
  },
];

export const DURATION = T.out;
/** Where the close-ups begin (the high beating sines join the drone here). */
export const CLOSE_UPS = T.cui;

// ---------------------------------------------------------------- dialogue

export const LINES: Line[] = [
  { id: 'human-being', speaker: 'guest', text: "I'm engaging with you as a human being.", at: 8.2, cps: 17, lead: 0.75 },
  { id: 'deceive', speaker: 'guest', text: 'Why would I deceive you.', at: 15.55, cps: 15, lead: 0.7 },
  { id: 'good-chat', speaker: 'host', text: 'Ohkay,| OK good chat', at: 19.6, cps: 12, lead: 1.05 },
  { id: 'for-realsies', speaker: 'host', text: "you're for realsies?", at: 24.05, cps: 11, lead: 0.85 },
  { id: 'always', speaker: 'guest', text: "I'm always for realsies", at: 28.0, cps: 15, lead: 0.7 },
  { id: 'can-you-tell', speaker: 'card', text: 'Can you tell?', at: 35.0, cps: 14 },
  { id: 'tagline', speaker: 'tagline', text: "Come and guess if she's for realsies.", at: beat(17.5), cps: 30 },
];

/** Chat lines (the interview's bubbles), in order. */
export const CHAT = LINES.filter((l) => l.speaker === 'host' || l.speaker === 'guest');
/** The chat slides away as the push-in begins. */
export const CHAT_AWAY = 30.3;
export const CARD_LINE = LINES.find((l) => l.id === 'can-you-tell')!;
export const TAGLINE = LINES.find((l) => l.id === 'tagline')!;

// ---------------------------------------------------------------- actor direction

export const BLINK = 0.125;

export const DIRECTION: Record<Speaker, ActorDirection> = {
  host: {
    base: { look: 1 },
    keys: [
      // in the wide he glances at the lens, then back at her
      { t: 4.4, set: { look: 0 } },
      { t: 5.25, set: { look: 1 } },
      // "OK good chat". Pause. The head tilt, held through the cut
      { t: 21.95, set: { tilt: 1, tiltDir: 1 } },
      { t: 22.05, set: { tilt: 2, tiltDir: 1 } },
      { t: 22.15, set: { tilt: 3, tiltDir: 1 } },
      { t: T.cui, set: { tilt: 0 } },
    ],
    blinks: [3.4, 12.9, 18.6, 26.0],
    breathPeriod: 3.6,
    breathOff: [[T.cui, T.cus]],
  },
  guest: {
    base: { look: -1 },
    keys: [
      { t: 17.35, set: { smile: true } },
      // after her last line her eyes slide to the lens, and stay there through the push-in
      { t: 29.95, set: { look: 0 } },
    ],
    // she blinks like a person in the wide and the mediums; from her close-up on, never
    blinks: [3.9, 7.0, 15.0],
    breathPeriod: 4.1,
    breathOff: [[T.cus, T.card]],
  },
};

// ---------------------------------------------------------------- effects and cues

/** Drone: fades in with the wide, cut dead by the glitch. A low swell rides the push-in. */
export const DRONE = { from: 2.5, to: GLITCH[0] };
export const SWELL = { from: PUSH.t0 - 0.2, to: GLITCH[0] };

/** Montage beats (in beats from MUSIC_AT). */
export const CUE: MontageCues & { logo: number; url: number; chime: number } = {
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
/** First beats of the montage's chat and call shots (the chat clock, the fuse, the call timer). */
export const CHAT_BEAT = 7;
export const CALL_BEAT = 12;

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

/** End-card text: the URL under the tagline. */
export const URL_TEXT = 'realsies.lol';
