// Procedural idle: whole-pixel moves on a slow tick, all derived from time and the look's seed,
// so it is stateless, deterministic (sheets) and never in lockstep between characters.

import { hash01 } from '../core/rng.ts';
import type { AnimParams } from './look.ts';
import type { ArmFrame } from './parts/body.ts';

export type Reaction = 'nod' | 'shrug' | 'wave' | 'jump';
export type LookDir = -1 | 0 | 1;

export interface Pose {
  bent: boolean; // knee frame
  bodyDy: number; // torso, arms, back item, front item
  headDy: number; // head, face, hair, hat
  feetDy: number; // legs + feet (jumps)
  breath: number; // extra torso/arms drop
  armL: ArmFrame;
  armR: ArmFrame;
  armLdx: number;
  look: LookDir;
  blink: boolean;
  mouthOpen: boolean;
  wiggle: number;
  shadowW: number; // cast shadow width
}

export interface AnimInput {
  now: number;
  talking: boolean;
  bias: LookDir;
  reduced: boolean;
  reaction?: { kind: Reaction; start: number } | null;
}

export function poseAt(a: AnimParams, seedNum: number, inp: AnimInput): Pose {
  const t = inp.now + a.phaseMs;
  const tick = Math.floor(t / a.tickMs);
  const p: Pose = { bent: false, bodyDy: 0, headDy: 0, feetDy: 0, breath: 0, armL: 0, armR: 0, armLdx: 0, look: 0, blink: false, mouthOpen: false, wiggle: 0, shadowW: 16 };

  if (!inp.reduced) {
    // bob: half the cycle up, half down with bent knees
    const cyc = Math.floor(tick / a.bobTicks);
    const down = tick % a.bobTicks >= a.bobTicks / 2;
    p.bent = down;
    p.bodyDy = down ? 1 : 0;
    p.headDy = p.bodyDy;
    // breathing: an extra pixel on alternate cycles, only on the low half
    p.breath = down && cyc % 2 === 1 ? 1 : 0;
    // hands: every few cycles one arm swings out 1 px and back
    const ap = Math.floor(cyc / a.armCycles) % 4;
    p.armL = ap === 1 ? 1 : 0;
    p.armR = ap === 3 ? 1 : 0;
    // accessory wiggle on its own 3-tick cycle
    p.wiggle = Math.floor(tick / a.wiggleTicks) % 2;
    // glances: at most one per slot, held 1-2.5 s; biased toward `bias` (e.g. the chat bubbles)
    const slot = Math.floor(t / a.lookSlotMs);
    const off = t - slot * a.lookSlotMs;
    const chance = inp.bias ? Math.min(0.9, a.glanceChance + 0.25) : a.glanceChance;
    if (hash01(seedNum, slot, 7) < chance) {
      const start = hash01(seedNum, slot, 8) * a.lookSlotMs * 0.45;
      const hold = 1000 + hash01(seedNum, slot, 9) * 1500;
      if (off >= start && off < start + hold) {
        const toward = inp.bias && hash01(seedNum, slot, 10) < 0.8;
        p.look = toward ? inp.bias : hash01(seedNum, slot, 11) < 0.5 ? -1 : 1;
      }
    }
  }

  // blink: one per slot (3-5 s), 1 tick long; one in five is a double blink. Kept in reduced motion.
  {
    const slot = Math.floor(t / a.blinkSlotMs);
    const off = t - slot * a.blinkSlotMs;
    const start = a.blinkSlotMs * (0.15 + 0.6 * hash01(seedNum, slot, 3));
    const len = a.tickMs * 0.9;
    const dbl = hash01(seedNum, slot, 4) < 0.2;
    if ((off >= start && off < start + len) || (dbl && off >= start + len * 2.2 && off < start + len * 3.2)) p.blink = true;
  }

  // talking mouth: open/closed in an irregular rhythm while a message arrives
  if (inp.talking) {
    const mt = Math.floor(inp.now / 110);
    p.mouthOpen = hash01(seedNum, mt, 21) < a.talkBias;
  }

  // reactions (6-8 ticks)
  const r = inp.reaction;
  if (r) {
    const k = Math.floor((inp.now - r.start) / a.tickMs);
    if (k >= 0 && k < 8) {
      switch (r.kind) {
        case 'nod':
          p.headDy += k === 1 || k === 2 || k === 4 || k === 5 ? 1 : 0;
          p.look = 0;
          break;
        case 'jump': {
          const h = [0, 2, 3, 3, 2, 0, 0, 0][k];
          p.bent = k === 0 || k === 5;
          p.bodyDy = (p.bent ? 1 : 0) - h;
          p.headDy = p.bodyDy;
          p.feetDy = -h;
          p.breath = 0;
          p.shadowW = 16 - h * 2;
          break;
        }
        case 'wave':
          p.armL = 2;
          p.armLdx = k % 2 === 0 ? 0 : -1;
          break;
        case 'shrug':
          if (k < 6) {
            p.armL = 1;
            p.armR = 1;
            p.bodyDy -= k > 0 && k < 5 ? 1 : 0;
            p.breath = 0;
            p.look = 0;
          }
          break;
      }
    }
  }
  return p;
}
