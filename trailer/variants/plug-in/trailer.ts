// Plug in: a five-second clip for the AI builders post on X. A plug seats in the side of her head,
// her eyes open, then two more open theirs. No text on screen: the copy goes in the post.

import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Rgba, createBuffer, blit } from '../../src/art.ts';
import type { Cam } from '../../src/engine/camera.ts';
import type { Shot } from '../../src/engine/timeline.ts';
import type { TrailerDef } from '../../src/engine/types.ts';
import { JackActor, SOCKET_ROW, drawPlug, rain, shootOver, consoleBand, type EyeState, type PlugState } from '../../src/scenes/jackin.ts';
import * as S from './storyboard.ts';
import { guestLook, leftLook, rightLook, LEFT_SEED, RIGHT_SEED } from './cast.ts';
import { soundtrack } from './sound.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const NAME = basename(DIR);

type Who = 'mid' | 'left' | 'right';
let actors: Record<Who, JackActor> | null = null;
const cast = () =>
  (actors ??= { mid: new JackActor(guestLook(), true, S.SIDE.mid), left: new JackActor(leftLook(), false, S.SIDE.left), right: new JackActor(rightLook(), false, S.SIDE.right) });

/** The socket of a character in world px (its open column and centre row). */
function socketOf(who: Who, jolt = 0): { x: number; y: number } {
  const a = cast()[who], p = S.AT[who];
  return { x: p.x + a.socketX + jolt, y: p.y + SOCKET_ROW };
}

function drawer(): (out: Rgba, shot: Shot, t: number) => void {
  const A = cast();
  return (out, shot, t) => {
    const n = Math.round(t * S.FPS);
    const w = createBuffer(S.WORLD.w, S.WORLD.h);
    const put = (who: Who, eyes: EyeState, jolt: number, lit: boolean, plug: PlugState) => {
      const p = S.AT[who];
      blit(w, A[who].frame({ eyes, jolt, lit }), p.x, p.y);
      const s = socketOf(who, jolt);
      drawPlug(w, s.x, s.y, plug, S.CABLE_TOP, S.SIDE[who]);
    };
    let cam: Cam;
    if (shot.kind === 'trio') {
      rain(out, t);
      // each cable pulses out of step with the others
      const offset: Record<Who, number> = { left: -0.87, mid: -1, right: -0.79 };
      for (const who of ['left', 'mid', 'right'] as Who[])
        put(who, S.eyesAt(who, n), 0, true, { out: 0, led: 'green', spark: -1, pulses: S.pulses(t, offset[who]) });
      cam = S.TRIO;
      shootOver(out, w, cam);
      consoleBand(out, cam, S.CONSOLE_Y, t);
      return;
    }
    rain(out, t, { dim: true });
    const spark = n >= S.CLUNK && n < S.CLUNK + 4 ? n - S.CLUNK : -1;
    put('mid', S.eyesAt('mid', n), S.jolt(n), n >= S.GREEN, { out: S.plugOut(n), led: S.led(n), spark, pulses: S.pulses(t) });
    if (shot.kind === 'insert') {
      const s = socketOf('mid');
      cam = { cx: s.x + S.ECU_RIGHT + S.shake(n), cy: s.y, k: S.ECU_K };
    } else cam = S.WAKE;
    shootOver(out, w, cam);
  };
}

const script: TrailerDef['script'] = {
  heading: 'Realsies: "Plug in", the AI builders clip',
  summary:
    'Five seconds for the post that calls AI chat providers to plug their models into Realsies. Her from the launch trailer, asleep; a plug seats in a socket in the side of her head (an 8-bit nod to the head jack of cyberpunk film, with digital rain behind), light runs down the cable, her eyes open; then two more characters plugged in beside her open theirs. Drawn and synthesised in code with the Realsies art engine: the characters come from the rig (`lookFromSeed`), and the socket, plug, cable, rain and console are drawn in `trailer/src/scenes/jackin.ts`. No footage, images or audio from anywhere else.',
  framing: `Framing: one world of game pixels shot at whole-number zooms. The plug at ${S.ECU_K} px per game pixel, centred just right of her socket; her face at ${S.WAKE.k}; the three at ${S.TRIO.k}, cropped at the waist by a console. The rain sits at a fixed 12-px grain behind every shot, so it reads as far away whatever the zoom. It loops: it opens on the plug and ends on the three awake.`,
  dialogueNote: 'No dialogue and no text on screen: the copy goes in the post.',
  sound: [
    'A mains hum (A1 and its harmonics) and a faint hiss for the rain under everything.',
    `The plug: a servo whine while it moves and a tick on each step; at ${(S.CLUNK / S.FPS).toFixed(2)} s it seats with a kick, a low thump, two metal pings and a bitcrushed zap.`,
    'Power on: the LED beeps green, a rising rush, then a triangle bass pulsing on the half beat at 120 BPM and a two-note blip for every pulse of light down the cable.',
    "Her eyes: a sub drop and a shine. The other two: a shine and a ping each, left then right. The last beat: a kick and the game's chime, faded at the end.",
    'Mix: synthesised at 48 kHz, peak-limited, two-pass `loudnorm` to -14 LUFS.',
  ],
  cast: [
    'Middle: the guest of the launch trailer (seed `guest-17375`, wavy auburn hair, teal blazer), with her large blue eyes.',
    `Left: seed \`${LEFT_SEED.slice(0, 12)}\` (patterned cap, tall eyes). Right: seed \`${RIGHT_SEED.slice(0, 12)}\` (beret, afro, bright eyes). Both from seeded random looks, with the socket added at eye level on the viewer's right.`,
  ],
  unrecorded: 'There are no lines to record.',
};

export const trailer: TrailerDef = {
  name: NAME,
  title: S.TITLE,
  video: 'realsies-plug-in.mp4',
  fps: S.FPS,
  duration: S.DURATION,
  shots: S.SHOTS,
  lines: [],
  dir: DIR,
  drawer,
  poster: (out) => drawer()(out, S.SHOTS[2], S.f(112)),
  soundtrack,
  script,
};
