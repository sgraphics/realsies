// The jack-in: a cable plug seats in a socket in the side of a character's head (at eye level on the
// viewer's right, where the hair meets the background), its LED turns green, light runs down the
// cable into the head, and the eyes open. Characters are composed from the rig's own layer sprites
// (buildSprites), so the game's look is untouched; the socket, plug, cable, digital rain and the
// console in the foreground are drawn here.

import { type Rgba, type Color, type Ramp, type Look, type LayerSprites, createBuffer, blit, get, px, px as setPx, outline, PAL, RAMPS, TRANSPARENT, hash01, buildSprites } from '../art.ts';
import { blitK, rectOut, fillOut, camOrigin, OUT_W, OUT_H, type Cam } from '../engine/camera.ts';
import { drawBigEyes } from '../engine/actor.ts';

const K = PAL.black;
/** Head-local row of the socket's centre (eye level). */
export const SOCKET_ROW = 18;

export type EyeState = 'closed' | 'half' | 'open' | 'glow';

export interface JackActorState {
  eyes: EyeState;
  /** The head knocked sideways this many px (the plug seating). */
  jolt: number;
  /** The socket's rim lit (power on). */
  lit: boolean;
}

export interface PlugState {
  /** How far the plug still is from seated, in px (0 = in). */
  out: number;
  led: 'red' | 'green' | 'off';
  /** Frames since the plug seated (sparks for the first few), or -1. */
  spark: number;
  /** Light pulses on the cable, 0 = at the top of the frame, 1 = at the plug. */
  pulses: number[];
}

// ---------------------------------------------------------------- the character

export class JackActor {
  readonly look: Look;
  /** Head-local column of the socket: the outermost column of the head's silhouette at eye level, on `side`. */
  readonly socketX: number;
  private s: LayerSprites;
  private skin: Ramp;
  private buf = createBuffer(32, 48);
  private head = createBuffer(32, 48);
  private eyeBox: { x0: number; x1: number; y0: number; y1: number }[];

  /**
   * `bigEyes`: the trailer's large blue eyes with highlights instead of the look's own. `side`: the
   * socket on the viewer's right (1) or left (-1).
   */
  constructor(look: Look, readonly bigEyes = false, readonly side: 1 | -1 = 1) {
    look.front = -1; // hands at the sides
    this.look = look;
    this.s = buildSprites(look);
    this.skin = (RAMPS as Record<string, Ramp>)[look.ramps.skin];
    const sil = createBuffer(32, 48);
    if (this.s.hairBack) blit(sil, this.s.hairBack, 0, 0);
    blit(sil, this.s.head, 0, 0);
    blit(sil, this.s.hair[0], 0, 0);
    if (this.s.hat) blit(sil, this.s.hat[0], 0, 0);
    let x0 = 31, x1 = 0;
    for (let x = 0; x < 32; x++)
      if (get(sil, x, SOCKET_ROW) !== TRANSPARENT) {
        x0 = Math.min(x0, x);
        x1 = x;
      }
    this.socketX = side === 1 ? x1 : x0;
    // the two eyes' boxes in the open-eye sprite (left half, right half of the face)
    const e = this.s.eyes[0];
    this.eyeBox = [[0, 15], [16, 31]].map(([a, b]) => {
      const box = { x0: 99, x1: -1, y0: 99, y1: -1 };
      for (let y = 0; y < 48; y++)
        for (let x = a; x <= b; x++)
          if (get(e, x, y) !== TRANSPARENT) {
            box.x0 = Math.min(box.x0, x);
            box.x1 = Math.max(box.x1, x);
            box.y0 = Math.min(box.y0, y);
            box.y1 = Math.max(box.y1, y);
          }
      return box;
    }).filter((b) => b.x1 >= 0);
  }

  /** The 32x48 standing frame (the legs are there, the shots crop them). */
  frame(st: JackActorState): Rgba {
    const b = this.buf;
    b.data.fill(0);
    const s = this.s;
    if (s.back) blit(b, s.back[0], 0, 0);
    if (s.hairBack) blit(b, s.hairBack, st.jolt, 0);
    blit(b, s.legs[0], 0, 0);
    blit(b, s.feet, 0, 0);
    blit(b, s.torso, 0, 0);
    blit(b, s.armL[0], 0, 0);
    blit(b, s.armR[0], 0, 0);
    const h = this.head;
    h.data.fill(0);
    blit(h, s.head, 0, 0);
    if (!this.bigEyes) this.eyes(h, st.eyes);
    blit(h, s.mouth[0], 0, 0);
    blit(h, s.hair[0], 0, 0);
    if (s.hat) blit(h, s.hat[0], 0, 0);
    if (this.bigEyes) this.big(h, st.eyes);
    this.socket(h, st.lit);
    blit(b, h, st.jolt, 0);
    return b;
  }

  private eyes(h: Rgba, e: EyeState): void {
    const s = this.s;
    if (e === 'closed') return blit(h, s.eyes[1], 0, 0);
    blit(h, s.eyes[0], 0, 0);
    if (e === 'glow') {
      // the irises light up like a screen: everything but the whites goes cyan
      for (const bx of this.eyeBox)
        for (let y = bx.y0; y <= bx.y1; y++)
          for (let x = bx.x0; x <= bx.x1; x++) {
            const c = get(s.eyes[0], x, y);
            if (c !== TRANSPARENT) px(h, x, y, c === PAL.white ? PAL.white : PAL.cyan);
          }
    } else if (e === 'half') {
      // a heavy lid over the top half, a lash line under it
      const lid = this.skin[2];
      for (const bx of this.eyeBox) {
        const n = bx.y1 - bx.y0 + 1;
        if (n < 2) {
          for (let x = bx.x0; x <= bx.x1; x++) px(h, x, bx.y0, K);
          continue;
        }
        const cover = Math.max(1, Math.floor(n / 2));
        for (let y = bx.y0; y < bx.y0 + cover; y++)
          for (let x = bx.x0; x <= bx.x1; x++) px(h, x, y, y === bx.y0 + cover - 1 ? K : lid);
      }
    }
  }

  private big(h: Rgba, e: EyeState): void {
    drawBigEyes(h, e === 'closed', 0, this.skin);
    if (e === 'half') {
      for (const x0 of [10, 17])
        for (let x = x0; x < x0 + 5; x++) {
          px(h, x, 14, this.skin[2]);
          px(h, x, 15, this.skin[2]);
          px(h, x, 16, K);
        }
    } else if (e === 'glow') {
      for (const x0 of [10, 17])
        for (let y = 14; y <= 18; y++)
          for (let x = x0; x < x0 + 5; x++) {
            const c = get(h, x, y);
            if (c === PAL.blueDark || c === PAL.blue || c === PAL.navyDark) px(h, x, y, PAL.cyan);
            else if (c === PAL.cyan) px(h, x, y, PAL.white);
          }
    }
  }

  /** A round metal port sunk into the side of the head: a ring three columns wide, open at the edge. */
  private socket(h: Rgba, lit: boolean): void {
    const y = SOCKET_ROW;
    // drawn for a socket on the right; mirrored about the socket's column for one on the left
    const px = (xx: number, yy: number, c: Color) => setPx(h, this.socketX + (xx - this.socketX) * this.side, yy, c);
    const x = this.socketX;
    const ring: Color = lit ? PAL.cyan : PAL.greyLight;
    const ringLow: Color = lit ? PAL.blue : PAL.grey;
    px(x - 1, y - 2, ring);
    px(x, y - 2, ring);
    px(x - 2, y - 1, ring);
    px(x - 2, y, ringLow);
    px(x - 2, y + 1, ringLow);
    for (let r = y - 1; r <= y + 1; r++) {
      px(x - 1, r, K);
      px(x, r, K);
    }
    px(x - 1, y + 2, ringLow);
    px(x, y + 2, ringLow);
  }
}

// ---------------------------------------------------------------- plug and cable

/**
 * The plug, its cable and the light on it, into a world buffer. `sx, sy`: world position of the
 * socket's open column and centre row. The cable leaves the plug to the right, bends up and runs to
 * world row `top`.
 */
export function drawPlug(w: Rgba, sx: number, sy: number, st: PlugState, top: number, side: 1 | -1 = 1): void {
  if (side === -1) {
    // draw it for a socket on the right in a scratch buffer, mirror the buffer, lay it over the world
    const tmp = createBuffer(w.w, w.h);
    drawPlug(tmp, w.w - 1 - sx, sy, st, top, 1);
    blit(w, tmp, 0, 0, { flipX: true });
    return;
  }
  const base = sx + 1 + st.out; // the flange's column
  // the cable: a 2-px line stamped along a path, outlined, then the light running down it
  const path = cablePath(base + 9, sy, top);
  const cb = createBuffer(w.w, w.h);
  for (const [x, y] of path)
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) px(cb, x + dx, y + dy, PAL.navy);
  for (const [x, y] of path) px(cb, x, y, PAL.slate);
  outline(cb, K);
  for (const p of st.pulses) {
    if (p < 0 || p > 1) continue;
    const i = Math.round(p * (path.length - 1));
    const glow = (j: number, c: Color) => {
      const q = path[path.length - 1 - j];
      if (!q) return;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) px(cb, q[0] + dx, q[1] + dy, c);
    };
    glow(i - 2, PAL.blue);
    glow(i - 1, PAL.cyan);
    glow(i, PAL.white);
  }
  blit(w, cb, 0, 0);

  // the plug, pointing left, in a small buffer with a 1-px margin for its outline. Local columns:
  // 0-2 the spike, 3 the flange, 4-9 the body, 10-11 the strain relief; local row 5 = the socket's row.
  const pb = createBuffer(15, 13);
  const P = (col: number, row: number, c: Color) => {
    if (col < 3 && base - 3 + col <= sx) return; // the part of the spike already in the socket
    px(pb, col + 1, row + 1, c);
  };
  P(0, 5, PAL.greyLight);
  for (const c of [1, 2]) {
    P(c, 4, PAL.white);
    P(c, 5, PAL.greyLight);
    P(c, 6, PAL.grey);
  }
  P(3, 1, PAL.white);
  for (let r = 2; r <= 8; r++) P(3, r, r < 4 ? PAL.greyLight : PAL.grey);
  P(3, 9, PAL.slate);
  for (let c = 4; c <= 9; c++) {
    const rib = c === 5 || c === 7;
    P(c, 2, PAL.white);
    P(c, 3, rib ? PAL.grey : PAL.greyLight);
    P(c, 4, rib ? PAL.slate : PAL.grey);
    P(c, 5, rib ? PAL.slate : PAL.grey);
    P(c, 6, rib ? PAL.navy : PAL.grey);
    P(c, 7, PAL.slate);
    P(c, 8, PAL.navy);
  }
  // the status LED, two pixels on the back of the body
  const led: Color = st.led === 'green' ? PAL.lime : st.led === 'red' ? PAL.red : PAL.navy;
  P(8, 4, led);
  P(9, 4, led);
  P(8, 5, st.led === 'green' ? PAL.green : st.led === 'red' ? PAL.redDark : PAL.navy);
  P(9, 5, st.led === 'green' ? PAL.green : st.led === 'red' ? PAL.redDark : PAL.navy);
  // strain relief, tapering into the cable
  for (let r = 3; r <= 7; r++) P(10, r, r === 3 ? PAL.slate : PAL.navy);
  for (let r = 4; r <= 6; r++) P(11, r, r === 4 ? PAL.slate : PAL.navy);
  outline(pb, K);
  // the moment it seats the flange flashes white
  if (st.spark === 0) for (let r = 1; r <= 9; r++) px(pb, 4, r + 1, PAL.white);
  blit(w, pb, base - 4, sy - 6);
  // join the cable to the strain relief over the plug's outline
  for (const [x, y] of path.slice(0, 2)) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) px(w, x + dx, y + dy, PAL.navy);
    px(w, x, y, PAL.slate);
  }
  px(w, base + 8, sy - 1, PAL.slate);

  // sparks off the socket for a few frames
  if (st.spark >= 0 && st.spark < 4) {
    const f = st.spark;
    const dirs: [number, number][] = [[0, -1], [0, 1], [1, -1], [1, 1], [-1, -1], [-1, 1]];
    const col: Color = f === 0 ? PAL.white : f === 1 ? PAL.yellow : f === 2 ? PAL.gold : PAL.orange;
    dirs.forEach(([dx, dy], i) => {
      const r = 2 + f * 1.5 + (i % 2);
      px(w, Math.round(sx + 1 + dx * r * 0.8), Math.round(sy + dy * r), col);
    });
  }
}

/** The cable's centre line: right from the plug, a quarter bend up, then straight up to `top`. */
function cablePath(x0: number, y: number, top: number): [number, number][] {
  const pts: [number, number][] = [];
  const seen = new Set<string>();
  const add = (x: number, yy: number) => {
    const k = `${x},${yy}`;
    if (seen.has(k)) return;
    seen.add(k);
    pts.push([x, yy]);
  };
  const bx = x0 + 2, r = 4;
  for (let x = x0; x <= bx; x++) add(x, y);
  for (let a = 0; a <= 90; a += 6) {
    const t = (a * Math.PI) / 180;
    add(Math.round(bx + r * Math.sin(t)), Math.round(y - r + r * Math.cos(t)));
  }
  for (let yy = y - r; yy >= top; yy--) add(bx + r, yy);
  return pts; // from the plug up
}

// ---------------------------------------------------------------- backdrop and foreground

/** Digital rain on black, at a fixed output grain (it reads as far behind, whatever the zoom). */
export function rain(out: Rgba, t: number, o: { grain?: number; density?: number; dim?: boolean } = {}): void {
  fillOut(out, PAL.black);
  const G = o.grain ?? 16;
  const cols = Math.ceil(OUT_W / G), rows = Math.ceil(OUT_H / G);
  const density = o.density ?? 0.45;
  for (let c = 0; c < cols; c++) {
    if (hash01(301, c) > density) continue;
    const speed = 7 + hash01(302, c) * 12; // cells a second
    const trail = 8 + Math.floor(hash01(303, c) * 14);
    const head = ((t * speed + hash01(304, c) * (rows + trail)) % (rows + trail)) | 0;
    for (let r = Math.max(0, head - trail); r <= Math.min(rows - 1, head); r++) {
      const d = head - r;
      // glyph cells flicker on and off
      if (d > 0 && hash01(305, c * 977 + r, Math.floor(t * 10 + c)) < 0.3) continue;
      let col: Color = d === 0 ? PAL.lime : d < 3 ? PAL.green : d < trail * 0.6 ? PAL.greenDark : PAL.tealDark;
      if (o.dim) col = d === 0 ? PAL.green : d < 3 ? PAL.greenDark : PAL.tealDark;
      rectOut(out, c * G + 2, r * G + 2, G - 4, G - 2, col);
    }
  }
}

/** A world buffer through a camera, over whatever is already in the frame (transparent stays). */
export function shootOver(out: Rgba, world: Rgba, cam: Cam): void {
  const { ox, oy } = camOrigin(cam);
  blitK(out, world, ox, oy, cam.k);
}

/** The console in the foreground: a lit lip, a dark face with a row of screens and blinking lights. */
export function consoleBand(out: Rgba, cam: Cam, y: number, t: number): void {
  const { oy } = camOrigin(cam);
  const k = cam.k;
  const top = oy + y * k;
  rectOut(out, 0, top, OUT_W, OUT_H - top, PAL.navyDark);
  rectOut(out, 0, top, OUT_W, k, PAL.slate);
  rectOut(out, 0, top + k, OUT_W, k, PAL.navy);
  rectOut(out, 0, top + 2 * k, OUT_W, k / 2, PAL.black);
  // screens: dark panels, each with a few lines of green readout scrolling up
  const n = 6, sw = Math.round(OUT_W / n / 2) * 2;
  for (let i = 0; i < n; i++) {
    const x0 = i * sw + 2 * k, y0 = top + 3 * k, w = sw - 4 * k, hgt = 4 * k;
    if (y0 + hgt > OUT_H) break;
    rectOut(out, x0 - k / 2, y0 - k / 2, w + k, hgt + k, PAL.black);
    rectOut(out, x0, y0, w, hgt, PAL.tealDark);
    for (let r = 0; r < 3; r++) {
      const len = Math.floor(hash01(321, i * 7 + r, Math.floor(t * 4 + i)) * (w / k - 2)) + 2;
      rectOut(out, x0 + k / 2, y0 + k / 2 + r * k * 1.25, len * k * 0.5, k / 2, r === 0 ? PAL.lime : PAL.green);
    }
  }
  // status lights along the lip, blinking out of step
  for (let i = 0; i < 24; i++) {
    const x = Math.round(((i + 0.5) * OUT_W) / 24 / 2) * 2;
    const on = hash01(311, i, Math.floor(t * 3 + i * 0.37)) < 0.55;
    if (on) rectOut(out, x - k / 4, top + k * 1.25, k / 2, k / 2, i % 3 === 0 ? PAL.lime : PAL.cyan);
  }
}
