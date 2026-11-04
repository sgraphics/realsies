// Character rig: public API. A Rig owns one character's look and procedural idle state and
// draws whole-pixel frames into RGBA buffers. Same seed, same character everywhere.
// 14 layers, back to front: shadow, back item, (back hair), legs, feet, torso (+decal), arm L,
// arm R, head, eyes, mouth, hair, hat, front item.

import { type Rgba, createBuffer, blit, shadowEllipse, ellipse } from '../core/buffer.ts';
import { type Color, PAL } from '../core/palette.ts';
import { rngFrom } from '../core/rng.ts';
import { type Look, lookFromSeed, describeLook } from './look.ts';
import { buildSprites, type LayerSprites } from './build.ts';
import { poseAt, type Pose, type Reaction, type LookDir } from './anim.ts';

export { lookFromSeed, describeLook };
export type { Look, Pose, Reaction, LookDir };

export const CHAR_W = 32;
export const CHAR_H = 48;
/** Feet rest on this row of the 32x48 box (the shadow sits just below). */
export const CHAR_FEET_Y = 45;

export interface RigOptions {
  reducedMotion?: boolean;
}

// Recently built looks, so re-mounting a thumbnail does not rebuild its sprites.
const CACHE = new Map<string, LayerSprites>();
function lookKey(look: Look): string {
  const { anim: _a, ...parts } = look;
  return JSON.stringify(parts);
}
function spritesFor(look: Look): LayerSprites {
  const key = lookKey(look);
  let s = CACHE.get(key);
  if (!s) {
    s = buildSprites(look);
    CACHE.set(key, s);
    if (CACHE.size > 96) CACHE.delete(CACHE.keys().next().value as string);
  } else {
    CACHE.delete(key);
    CACHE.set(key, s);
  }
  return s;
}

export interface FrameOpts {
  /** Draw a solid shadow under the feet (for canvases without a floor). */
  shadow?: boolean;
}

export class Rig {
  readonly look: Look;
  private sprites: LayerSprites;
  private buf = createBuffer(CHAR_W, CHAR_H);
  private talking = false;
  private bias: LookDir = 0;
  private reduced: boolean;
  private reaction: { kind: Reaction; start: number } | null = null;
  private seedNum: number;
  private lastPose: Pose | null = null;

  constructor(seedOrLook: string | Look, opts: RigOptions = {}) {
    this.look = typeof seedOrLook === 'string' ? lookFromSeed(seedOrLook) : seedOrLook;
    this.sprites = spritesFor(this.look);
    this.reduced = !!opts.reducedMotion;
    this.seedNum = rngFrom('num:' + this.look.seed).int(0x7fffffff);
  }

  get seed(): string {
    return this.look.seed;
  }
  setTalking(on: boolean): void {
    this.talking = on;
  }
  get isTalking(): boolean {
    return this.talking;
  }
  /** Bias glances toward a side: -1 viewer's left, 1 viewer's right, 0 none. */
  lookToward(dir: LookDir): void {
    this.bias = dir;
  }
  /** One short gesture: nod, shrug, wave or jump. */
  react(kind: Reaction, now: number = Date.now()): void {
    this.reaction = { kind, start: now };
  }
  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  pose(now: number): Pose {
    if (this.reaction && now - this.reaction.start > 8 * this.look.anim.tickMs) this.reaction = null;
    return poseAt(this.look.anim, this.seedNum, { now, talking: this.talking, bias: this.bias, reduced: this.reduced, reaction: this.reaction });
  }

  /** The 32x48 frame at time `now` (ms). The returned buffer is reused between calls. */
  frame(now: number, o: FrameOpts = {}): Rgba {
    const p = this.pose(now);
    this.lastPose = p;
    const b = this.buf;
    b.data.fill(0);
    if (o.shadow) ellipse(b, 16 - (p.shadowW >> 1), 44, p.shadowW, 4, PAL.navyDark);
    this.compose(b, p);
    return b;
  }

  /** Compose the layers for a pose into a 32x48 buffer (cleared by the caller). */
  compose(b: Rgba, p: Pose): void {
    const s = this.sprites;
    const w = p.wiggle;
    const torsoDy = p.bodyDy + p.breath;
    if (s.back) blit(b, s.back[w % s.back.length], 0, torsoDy);
    if (s.hairBack) blit(b, s.hairBack, 0, p.headDy);
    blit(b, s.legs[p.bent ? 1 : 0], 0, p.feetDy);
    blit(b, s.feet, 0, p.feetDy);
    blit(b, s.torso, 0, torsoDy);
    blit(b, s.armL[p.armL], p.armLdx, torsoDy);
    blit(b, s.armR[p.armR], 0, torsoDy);
    blit(b, s.head, 0, p.headDy);
    blit(b, s.eyes[p.blink ? 1 : 0], p.look, p.headDy);
    blit(b, s.mouth[p.mouthOpen ? 1 : 0], p.look, p.headDy);
    blit(b, s.hair[w % s.hair.length], 0, p.headDy);
    if (s.hat) blit(b, s.hat[w % s.hat.length], 0, p.headDy);
    if (s.front) {
      const dx = p.armR === 1 ? 1 : 0;
      blit(b, s.front[w % s.front.length], dx, torsoDy);
      if (s.frontFx) blit(b, s.frontFx[w % s.frontFx.length], dx, torsoDy);
    }
  }

  /**
   * Draw with the 32x48 box's top-left at (x, y). The cast shadow darkens whatever is under
   * the feet through the master palette (no blending).
   */
  draw(dst: Rgba, x: number, y: number, now: number, o: { flipX?: boolean; tint?: Color; noShadow?: boolean } = {}): void {
    const f = this.frame(now);
    const p = this.lastPose!;
    if (!o.noShadow) shadowEllipse(dst, x + 16 - (p.shadowW >> 1), y + 44, p.shadowW, 4, 1);
    blit(dst, f, x, y, { flipX: o.flipX, tint: o.tint });
  }
}
