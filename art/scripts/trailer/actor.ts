// Directed actors for the trailer: the rig's own layer sprites (buildSprites) composed by hand so a
// shot can script every blink, glance, mouth flap, breath and head tilt, and so the characters can
// sit. Standing frames still come from the stock Rig (lobby, chat, call, countdown).

import { type Rgba, createBuffer, blit, get, px } from '../../src/core/buffer.ts';
import { type Color, RAMPS, type Ramp, darker, lighter, TRANSPARENT } from '../../src/core/palette.ts';
import { lookFromSeed, type Look } from '../../src/rig/look.ts';
import { buildSprites, type LayerSprites } from '../../src/rig/build.ts';
import { torsoSpan } from '../../src/rig/parts/body.ts';
import { EYES, MOUTHS } from '../../src/rig/parts/head.ts';
import { HAIRS } from '../../src/rig/parts/hair.ts';
import { FRONTS } from '../../src/rig/parts/items.ts';

export interface CastMember {
  id: 'host' | 'guest';
  /** Rig seed; the look comes from lookFromSeed, then a few parts are pinned for the role. */
  seed: string;
  pin: (l: Look) => void;
  /** Mouth style used for the "small smile" beat. */
  smile: string;
}

const idx = <T extends { id: string }>(arr: T[], id: string) => Math.max(0, arr.findIndex((x) => x.id === id));

export const CAST: Record<'host' | 'guest', CastMember> = {
  // bald, glasses, moustache, red sweater, a notebook in hand: deadpan, and nobody real
  host: {
    id: 'host',
    seed: 'host-4843',
    pin: (l) => {
      l.eyes = idx(EYES, 'glasses');
      l.ramps.glasses = 'black';
      l.mouth = idx(MOUTHS, 'moustache');
      l.front = idx(FRONTS, 'book');
      l.ramps.item = 'royal';
    },
    smile: 'moustache',
  },
  // dark wavy hair, teal blazer over a white shirt: polished, media-trained, possibly a bot
  guest: {
    id: 'guest',
    seed: 'guest-17375',
    pin: (l) => {
      l.mouth = idx(MOUTHS, 'line');
      l.hair = idx(HAIRS, 'wavy');
      l.ramps.hair = 'rust';
      l.ramps.skin = 'skin2';
      l.front = -1;
    },
    smile: 'smile',
  },
};

export function castLook(c: CastMember, smile = false): Look {
  const l = lookFromSeed(c.seed);
  c.pin(l);
  if (smile) l.mouth = idx(MOUTHS, c.smile);
  return l;
}

/** Everything a shot can direct, per frame. */
export interface ActorState {
  blink: boolean;
  /** Eye and mouth offset: -1 viewer's left, 1 viewer's right, 0 at the camera. */
  look: -1 | 0 | 1;
  mouthOpen: boolean;
  smile: boolean;
  /** Extra drop of head and torso (breathing), px. */
  breath: number;
  /** Head tilt: the crown leans this many px toward `tiltDir`, the chin stays. */
  tilt: number;
  tiltDir: -1 | 1;
}

export const REST: ActorState = { blink: false, look: 0, mouthOpen: false, smile: false, breath: 0, tilt: 0, tiltDir: 1 };

/** Upper body drop when seated (px). */
export const SIT = 4;

export class Actor {
  readonly cast: CastMember;
  readonly look: Look;
  private s: LayerSprites;
  private sSmile: LayerSprites;
  private headBuf = createBuffer(32, 48);
  private lap: Rgba;
  /** Bald heads skip the hair layer (it only holds a shine whose outline reads as a dent up close). */
  private bald: boolean;
  /** Darkest outline colour of the trousers (for the knee gap). */
  constructor(c: CastMember) {
    this.cast = c;
    this.look = castLook(c);
    this.s = buildSprites(this.look);
    this.sSmile = buildSprites(castLook(c, true));
    this.lap = lapSprite(this.look);
    this.bald = HAIRS[this.look.hair].id === 'bald';
  }

  /** The 32x48 seated frame for a state, into `out` (cleared here). */
  seated(out: Rgba, st: ActorState): Rgba {
    out.data.fill(0);
    const s = st.smile ? this.sSmile : this.s;
    const up = SIT + st.breath;
    // shins (the bottom rows of the standing legs, one row lower) and the shoes
    blit(out, s.legs[0], 0, 41, { sx: 0, sy: 40, sw: 32, sh: 4 });
    blit(out, s.feet, 0, 0);
    if (s.back) blit(out, s.back[0], 0, up);
    if (s.hairBack) blit(out, s.hairBack, 0, up);
    blit(out, s.torso, 0, up);
    blit(out, this.lap, 0, 0);
    blit(out, s.armL[0], 0, up);
    blit(out, s.armR[0], 0, up);
    if (s.front) {
      blit(out, s.front[0], 0, up);
      if (s.frontFx) blit(out, s.frontFx[0], 0, up);
    }
    // head group, composed apart so it can tilt
    const h = this.headBuf;
    h.data.fill(0);
    blit(h, s.head, 0, 0);
    blit(h, s.eyes[st.blink ? 1 : 0], st.look, 0);
    blit(h, s.mouth[st.mouthOpen ? 1 : 0], st.look, 0);
    if (!this.bald) blit(h, s.hair[0], 0, 0);
    if (s.hat) blit(h, s.hat[0], 0, 0);
    if (st.tilt) shearHead(h, st.tilt, st.tiltDir);
    blit(out, h, 0, up);
    return out;
  }
}

/** Shear rows above the chin: the crown moves `amount` px sideways, the chin not at all. */
function shearHead(h: Rgba, amount: number, dir: -1 | 1): void {
  const chin = 25, crown = 4;
  const src = new Uint8ClampedArray(h.data);
  h.data.fill(0);
  for (let y = 0; y < h.h; y++) {
    const t = y >= chin ? 0 : Math.min(1, (chin - y) / (chin - crown));
    const dx = Math.round(t * amount) * dir;
    for (let x = 0; x < h.w; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= h.w) continue;
      const si = (y * h.w + sx) * 4, di = (y * h.w + x) * 4;
      if (src[si + 3]) h.data.set(src.subarray(si, si + 4), di);
    }
  }
}

/** Thighs coming toward the camera: a band in the trouser (or skirt) colour over the lower torso. */
function lapSprite(look: Look): Rgba {
  const r: Ramp = (RAMPS as Record<string, Ramp>)[look.ramps.bottom] ?? RAMPS.navy;
  const [l, rr] = torsoSpan(look.build);
  const b = createBuffer(32, 48);
  const top = 37, bot = 40;
  for (let y = top; y <= bot; y++)
    for (let x = l; x <= rr; x++) {
      const gap = (x === 15 || x === 16) && y >= bot - 1; // between the knees
      if (gap) continue;
      let c: Color = r[1];
      if (y === top) c = r[0];
      else if (y === bot) c = r[2];
      if (x === rr || x === 14) c = darker(c, 1) === c ? r[2] : r[2];
      px(b, x, y, c);
    }
  // outline in the trousers' darkest shade, except along the top (it meets the torso)
  const add: [number, number][] = [];
  for (let y = top; y <= bot + 1; y++)
    for (let x = l - 1; x <= rr + 1; x++) {
      if (get(b, x, y) !== TRANSPARENT) continue;
      if (get(b, x - 1, y) !== TRANSPARENT || get(b, x + 1, y) !== TRANSPARENT || get(b, x, y - 1) !== TRANSPARENT) add.push([x, y]);
    }
  for (const [x, y] of add) px(b, x, y, r[3]);
  return b;
}

// ---------------------------------------------------------------- light

/**
 * Set lighting on a seated frame: the outermost pixel on the shadow side (viewer's right) of each
 * row drops a palette step, the key side (left) catches a rim of light, and an optional hair light
 * from behind lifts the top and the right edge of the head rows (`hair` = last row of the head).
 */
export function keyLight(b: Rgba, o: { rim?: boolean; shade?: boolean; hair?: number } = {}): void {
  const src = new Uint8ClampedArray(b.data);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < b.w && y < b.h && src[(y * b.w + x) * 4 + 3] > 0;
  for (let y = 0; y < b.h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < b.w; x++)
      if (at(x, y)) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    if (x0 < 0) continue;
    if (o.shade) {
      const c = get(b, x1, y);
      if (c !== TRANSPARENT) px(b, x1, y, darker(c, 1));
    }
    if (o.rim) {
      const c = get(b, x0, y);
      if (c !== TRANSPARENT) px(b, x0, y, lighter(c, 1));
    }
  }
  if (o.hair !== undefined)
    for (let x = 0; x < b.w; x++)
      for (let y = 0; y <= o.hair; y++)
        if (at(x, y)) {
          // first opaque pixel from the top is the outline; light the one under it
          const c = get(b, x, y + 1);
          if (c !== TRANSPARENT && at(x, y + 1)) px(b, x, y + 1, lighter(c, 1));
          break;
        }
}
