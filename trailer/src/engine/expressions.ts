// Smug pose pieces for the end card, composed from the rig's own layer sprites (buildSprites), so
// the game's look is untouched: half-lidded eyes, a raised eyebrow, smirks, crossed arms, a finger
// pushing sunglasses up, a slow nod, and a backlight rim along the top of the silhouette.

import { type Rgba, createBuffer, blit, get, px, outline } from '../art.ts';
import { type Color, PAL, RAMPS, type Ramp, TRANSPARENT, lighter } from '../art.ts';
import { lookFromSeed, type Look } from '../art.ts';
import { buildSprites, type LayerSprites } from '../art.ts';
import { torsoSpan, TORSOS } from '../art.ts';
import { MOUTHS } from '../art.ts';

const K = PAL.black;
const idx = <T extends { id: string }>(arr: T[], id: string) => Math.max(0, arr.findIndex((x) => x.id === id));

export type ArmPose = 'crossed' | 'push';
export type EyePose = 'lids' | 'brow' | 'shades';

export interface SmugState {
  arms: ArmPose;
  /** Push: 0 arm down, 1 halfway, 2 finger on the bridge. */
  push: 0 | 1 | 2;
  /** Sunglasses nudged up this many px. */
  shadesUp: number;
  /** A glint across the lenses. */
  lensGlint: boolean;
  eyes: EyePose;
  /** Head drop for the nod (px). */
  nod: number;
  /** Mirror the smirk to the other side of the mouth. */
  smirkLeft: boolean;
}

export class SmugActor {
  readonly look: Look;
  private s: LayerSprites;
  private skin: Ramp;
  private sleeve: Ramp;
  private sleeves: 'long' | 'short' | 'none';
  private span: [number, number];
  private buf = createBuffer(32, 48);
  private head = createBuffer(32, 48);

  constructor(seedOrLook: string | Look, pin?: (l: Look) => void) {
    const l = typeof seedOrLook === 'string' ? lookFromSeed(seedOrLook) : seedOrLook;
    pin?.(l);
    l.mouth = idx(MOUTHS, 'smirk');
    l.front = -1; // hands are busy being smug
    this.look = l;
    this.s = buildSprites(l);
    this.skin = (RAMPS as Record<string, Ramp>)[l.ramps.skin];
    this.sleeve = (RAMPS as Record<string, Ramp>)[l.ramps.top];
    this.sleeves = TORSOS[l.torso].sleeves;
    this.span = torsoSpan(l.build);
  }

  /** The 32x48 standing frame (legs omitted: the shot crops at the waist). */
  frame(st: SmugState): Rgba {
    const b = this.buf;
    b.data.fill(0);
    const s = this.s;
    if (s.back) blit(b, s.back[0], 0, 0);
    if (s.hairBack) blit(b, s.hairBack, 0, st.nod);
    blit(b, s.torso, 0, 0);
    if (st.arms === 'crossed') blit(b, this.crossedArms(), 0, 0);
    else {
      blit(b, s.armR[0], 0, 0);
      if (st.push === 0) blit(b, s.armL[0], 0, 0);
    }
    // head group
    const h = this.head;
    h.data.fill(0);
    blit(h, s.head, 0, 0);
    if (st.eyes === 'shades') {
      blit(h, this.shades(), 0, -st.shadesUp);
    }
    blit(h, s.mouth[0], 0, 0, { flipX: st.smirkLeft });
    blit(h, s.hair[0], 0, 0);
    if (s.hat) blit(h, s.hat[0], 0, 0);
    if (st.eyes === 'lids' || st.eyes === 'brow') this.smugEyes(h, st.eyes === 'brow');
    if (st.eyes === 'shades' && st.lensGlint) {
      // a white streak across both lenses
      for (const x0 of [11, 17]) {
        px(h, x0 + 1, 16 - st.shadesUp, PAL.white);
        px(h, x0 + 2, 15 - st.shadesUp, PAL.white);
      }
    }
    blit(b, h, 0, st.nod);
    if (st.arms === 'push' && st.push !== 0) blit(b, this.pushArm(st.push), 0, 0);
    rimLight(b);
    return b;
  }

  private shadesBuf: Rgba | null = null;
  /** The look's sunglasses with the lenses blacked out (they read as eyes in blue at this size). */
  private shades(): Rgba {
    if (this.shadesBuf) return this.shadesBuf;
    const b = createBuffer(32, 48);
    blit(b, this.s.eyes[0], 0, 0);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 32; x++) {
        const c = get(b, x, y);
        if (c === PAL.blueDark || c === PAL.navyDark) px(b, x, y, K);
      }
    this.shadesBuf = b;
    return b;
  }

  /** Half-lidded eyes looking down at the camera; `brow`: the right eye opens under a raised brow. */
  private smugEyes(h: Rgba, brow: boolean): void {
    const sk = get(h, 12, 19) === TRANSPARENT ? this.skin[1] : get(h, 12, 19);
    const lid = this.skin[2];
    for (const [x0, side] of [[11, 0], [17, 1]] as const) {
      for (let y = 15; y <= 18; y++) for (let x = x0; x < x0 + 4; x++) px(h, x, y, sk);
      if (brow && side === 1) {
        // the skeptical eye: wide open, the brow arched well above it
        px(h, x0 + 1, 13, K);
        px(h, x0 + 2, 13, K);
        px(h, x0 + 3, 14, K);
        px(h, x0, 14, K);
        px(h, x0 + 1, 16, PAL.white);
        px(h, x0 + 2, 16, K);
        px(h, x0 + 1, 17, K);
        px(h, x0 + 2, 17, K);
        px(h, x0 + 1, 18, K);
        px(h, x0 + 2, 18, K);
        continue;
      }
      // a heavy lid: a skin-shadow lid over a flat lash line, the pupil peeking out under it
      for (let x = x0; x < x0 + 4; x++) px(h, x, 16, lid);
      for (let x = x0; x < x0 + 4; x++) px(h, x, 17, K);
      const p = side === 0 ? x0 + 2 : x0 + 1; // pupils lean in toward the lens
      px(h, p, 18, K);
      px(h, p + (side === 0 ? -1 : 1), 18, K);
    }
  }

  private crossedArms(): Rgba {
    const a = createBuffer(32, 48);
    const [l, r] = this.span;
    const sl = this.sleeves === 'none' ? this.skin : this.sleeve;
    const fore = this.sleeves === 'long' ? this.sleeve : this.skin;
    const hand = this.skin;
    // upper arms hang from the shoulders; the elbows poke out a pixel
    for (let y = 26; y <= 32; y++) {
      const c = this.sleeves === 'short' && y > 28 ? this.skin : sl;
      for (let i = 0; i < 3; i++) {
        px(a, l - 3 + i, y, i === 2 ? c[2] : c[1]);
        px(a, r + 1 + i, y, i === 0 ? c[2] : c[1]);
      }
    }
    for (const y of [31, 32]) {
      px(a, l - 4, y, fore[1]);
      px(a, r + 4, y, fore[2]);
    }
    // a 2-px band along a line (x0, y0) -> (x1, y1)
    const band = (x0: number, y0: number, x1: number, y1: number, top: Color, low: Color) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
        px(a, x, y, top);
        px(a, x, y + 1, low);
      }
    };
    // the back forearm: from the right elbow, rising to the left; its hand at the left biceps
    band(r + 2, 32, l, 29, fore[2], fore[2]);
    px(a, l - 1, 28, hand[1]);
    px(a, l, 28, hand[0]);
    px(a, l - 1, 29, hand[2]);
    // the front forearm, on top: from the left elbow, rising to the right; its hand at the right biceps
    band(l - 2, 32, r, 29, fore[0], fore[1]);
    px(a, r + 1, 28, hand[0]);
    px(a, r + 2, 28, hand[1]);
    px(a, r + 1, 29, hand[1]);
    px(a, r + 2, 29, hand[2]);
    outline(a, K);
    // a dark crease where the front arm crosses over the back one
    const mid = Math.round((l + r) / 2);
    px(a, mid + 1, 31, fore[3]);
    return a;
  }

  /** The viewer's-left arm raised so one finger pushes the sunglasses up at the bridge. */
  private pushArm(phase: 1 | 2): Rgba {
    const a = createBuffer(32, 48);
    const [l] = this.span;
    const sl = this.sleeves === 'none' ? this.skin : this.sleeve;
    const fore = this.sleeves === 'long' ? this.sleeve : this.skin;
    const hand = this.skin;
    // upper arm: from the shoulder, folded up beside the body
    for (let y = 25; y <= 30; y++) for (let i = 0; i < 3; i++) px(a, l - 3 + i, y, i === 2 ? sl[2] : sl[1]);
    // forearm: a diagonal from the elbow up toward the face
    const hx = phase === 2 ? 15 : 12, hy = phase === 2 ? 17 : 22;
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const x = Math.round(l - 2 + (hx - 1 - (l - 2)) * u), y = Math.round(27 + (hy + 2 - 27) * u);
      px(a, x, y, fore[1]);
      px(a, x + 1, y, fore[1]);
      px(a, x, y + 1, fore[2]);
      px(a, x + 1, y + 1, fore[2]);
    }
    // the hand, one finger up on the bridge
    px(a, hx - 1, hy + 1, hand[1]);
    px(a, hx, hy + 1, hand[1]);
    px(a, hx - 1, hy + 2, hand[2]);
    px(a, hx, hy + 2, hand[1]);
    px(a, hx, hy, hand[0]);
    outline(a, K);
    return a;
  }
}

/**
 * Backlight: the light sits behind and above the group, so the first pixel inside the outline
 * along the top of every column, and along both outer sides, lifts a palette step.
 */
function rimLight(b: Rgba): void {
  const src = new Uint8ClampedArray(b.data);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < b.w && y < b.h && src[(y * b.w + x) * 4 + 3] > 0;
  const lift = (x: number, y: number) => {
    const c = get(b, x, y);
    if (c !== TRANSPARENT && c !== K) px(b, x, y, lighter(c, 1));
  };
  for (let x = 0; x < b.w; x++)
    for (let y = 0; y < b.h; y++)
      if (at(x, y)) {
        if (at(x, y + 1)) lift(x, y + 1);
        break;
      }
  for (let y = 0; y < 30; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < b.w; x++)
      if (at(x, y)) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    if (x0 < 0) continue;
    if (at(x0 + 1, y)) lift(x0 + 1, y);
    if (at(x1 - 1, y)) lift(x1 - 1, y);
  }
}

export const SMUG_COLOR: Color = PAL.yellow;
