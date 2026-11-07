// Plug in: the clip as data. A cable plug seats in the side of her head, her eyes open, then two more
// open theirs. Five seconds for an X post; it loops cleanly (it starts on the plug and ends on the
// three awake). Every time is in seconds or frames from the first frame.

import type { Framing, Shot } from '../../src/engine/timeline.ts';
import type { EyeState } from '../../src/scenes/jackin.ts';

export const FPS = 24;
export const TITLE = 'Realsies: Plug in (AI builders clip)';
export const DURATION = 5.0;
export const f = (frame: number) => frame / FPS;

// ---------------------------------------------------------------- the world

/** Where the characters stand (the top-left of each 32x48 frame, in world px) and where cables come from. */
export const WORLD = { w: 160, h: 100 };
export const AT = { mid: { x: 54, y: 40 }, left: { x: 28, y: 40 }, right: { x: 97, y: 40 } };
/** The left one's socket faces out (the viewer's left), so no plug runs into a neighbour. */
export const SIDE = { mid: 1, left: -1, right: 1 } as const;
export const CABLE_TOP = 0;
/** The console in the trio shot covers from this world row down (their waists). */
export const CONSOLE_Y = 76;

// ---------------------------------------------------------------- shots

/** The extreme close-up of the socket is centred this far right of it (the plug's body). */
export const ECU_RIGHT = 5;
const T = { insert: 0, wake: f(42), trio: f(77), out: DURATION };

export const SHOTS: Shot[] = [
  {
    id: 's01', kind: 'insert', start: T.insert, end: T.wake, key: f(30),
    title: 'Extreme close-up: the plug',
    notes: 'The side of her head at eye level, her closed eye at the left edge, digital rain behind. A chunky silver plug on a black cable slides in from the right, a pixel at a time, pauses to line up, and seats in the socket with a clunk: the collar flashes white, sparks fly, her head knocks a pixel. Its LED turns from red to green, the socket rim lights cyan, and pulses of light run down the cable into her head.',
  },
  {
    id: 's02', kind: 'wake', start: T.wake, end: T.trio, key: f(66),
    title: 'Close-up: her eyes open',
    notes: 'Her face, eyes closed, the cable running out of the side of her head and up out of frame, light still pulsing down it. Her eyes open: half, then wide, the irises glowing cyan like a screen for a moment before they settle to blue.',
  },
  {
    id: 's03', kind: 'trio', start: T.trio, end: T.out, key: f(112),
    title: 'Medium wide: two more wake up',
    notes: 'Three of them side by side behind a console, each plugged in (the one on the left on his outer side), the cables rising out of frame, her in the middle already awake. The one on the left opens his eyes (a cyan flash), then the one on the right. On the last beat all three flash cyan together.',
  },
];

/** Framings: the socket's extreme close-up is set at render time (it follows her socket). */
export const WAKE: Omit<Framing, 'lens'> = { cx: AT.mid.x + 22, cy: AT.mid.y + 17, k: 40 };
export const TRIO: Omit<Framing, 'lens'> = { cx: 84, cy: 61, k: 18 };
export const ECU_K = 60;

// ---------------------------------------------------------------- the plug going in (shot 1, by frame)

/** The frame the plug seats. */
export const CLUNK = 21;
const OUT_BY_FRAME = [11, 11, 11, 11, 10, 9, 8, 7, 6, 5, 4, 3, 3, 3, 3, 3, 3, 2, 2, 2, 1];
/** How far the plug is from seated at frame n. */
export const plugOut = (n: number) => (n >= CLUNK ? 0 : OUT_BY_FRAME[Math.max(0, n)]);
/** Her head knocked a pixel by the plug, and the camera shake (world px). */
export const jolt = (n: number) => (n === CLUNK || n === CLUNK + 1 ? -1 : 0);
export const shake = (n: number) => (n === CLUNK ? 0.2 : n === CLUNK + 1 ? -0.14 : n === CLUNK + 2 ? 0.07 : 0);
/** The LED: red, then green with two flickers. */
export const GREEN = CLUNK + 6;
export const led = (n: number): 'red' | 'green' | 'off' => (n < GREEN ? 'red' : n === GREEN + 1 || n === GREEN + 3 ? 'off' : 'green');

/** Light pulses down a cable: one every `every` s from `from`, each taking `travel` s; offset per cable. */
export function pulses(t: number, offset = 0, from = f(GREEN) + 0.05, every = 0.3, travel = 0.42): number[] {
  const out: number[] = [];
  const t0 = from + offset;
  if (t < t0) return out;
  for (let n = Math.max(0, Math.floor((t - t0 - travel) / every)); t0 + n * every <= t; n++) out.push((t - t0 - n * every) / travel);
  return out;
}

// ---------------------------------------------------------------- the eyes (by frame)

/** Frame each pair of eyes starts to open: half (2 frames), a cyan glow (4 frames), then open. */
export const WAKE_AT = { mid: 55, left: 86, right: 96 };
/** The last beat: all three flash cyan together for these frames. */
export const FINALE = [107, 108, 109];

export function eyesAt(who: keyof typeof WAKE_AT, n: number): EyeState {
  if (FINALE.includes(n)) return 'glow';
  const w = WAKE_AT[who];
  if (n < w) return 'closed';
  if (n < w + 2) return 'half';
  if (n < w + 6) return 'glow';
  return 'open';
}
