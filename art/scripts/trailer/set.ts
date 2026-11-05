// The interview set, drawn in code: a dark muslin backdrop with a soft pool of light, a softbox on a
// stand at the left, a fiddle-leaf fig and a warm floor lamp behind, a boom mic dipping in, a rug,
// two leather lounge chairs angled toward each other, a side table with two glasses of water, a
// small LED backlight, and a cinema camera on a tripod as a foreground silhouette. One world in
// game pixels; every shot is a window into it at an integer zoom.

import { type Rgba, createBuffer, px, get, rect, line, ellipse, blit } from '../../src/core/buffer.ts';
import { type Color, PAL, TRANSPARENT, darker, lighter, nearest } from '../../src/core/palette.ts';
import { hash01 } from '../../src/core/rng.ts';

const P = PAL;
export const WORLD_W = 320;
export const WORLD_H = 180;
/** Seated actors: top-left of each 32x48 box. */
export const HOST_AT = { x: 92, y: 66 };
export const GUEST_AT = { x: 196, y: 66 };
/** Where the backdrop sweeps into the floor. */
const SWEEP_Y = 101;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** Pick between two colours by an amount 0..1 with ordered dither. */
function mix(a: Color, b: Color, t: number, x: number, y: number): Color {
  return t > bayer(x, y) ? b : a;
}

function poly(b: Rgba, pts: [number, number][], c: Color | ((x: number, y: number) => Color)): void {
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const yy = y + 0.5;
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) px(b, x, y, typeof c === 'number' ? c : c(x, y));
  }
}

function outlineOpaque(b: Rgba, c: Color, from?: Rgba): void {
  const src = from ?? b;
  const add: [number, number][] = [];
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (get(src, x, y) !== TRANSPARENT) continue;
      if (get(src, x - 1, y) !== TRANSPARENT || get(src, x + 1, y) !== TRANSPARENT || get(src, x, y - 1) !== TRANSPARENT || get(src, x, y + 1) !== TRANSPARENT) add.push([x, y]);
    }
  for (const [x, y] of add) px(b, x, y, c);
}

// ---------------------------------------------------------------- backdrop and floor

/** Light on the backdrop at (x, y), 0..1: a pool behind each chair plus the softbox's spill. */
function backdropLight(x: number, y: number): number {
  const pool = (cx: number, cy: number, rx: number, ry: number) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    return Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny));
  };
  let v = Math.max(pool(110, 70, 62, 44), pool(214, 66, 60, 42) * 0.95, pool(160, 72, 150, 60) * 0.55);
  v = Math.max(v, 0.85 * pool(40, 58, 54, 50));
  return v;
}

function paintBackdrop(b: Rgba, clean = false): void {
  for (let y = 0; y < WORLD_H; y++)
    for (let x = 0; x < WORLD_W; x++) {
      // muslin mottling (wide shots only)
      const n = clean ? 0 : hash01(11, x >> 2, y >> 2) * 0.12 + hash01(12, x >> 3, y >> 3) * 0.12 - 0.12;
      const v = backdropLight(x, y) * 1.3 + n;
      let c: Color;
      if (y < SWEEP_Y) {
        if (clean) c = v < 0.3 ? P.black : v < 0.72 ? P.navyDark : P.navy; // clean rings for the defocus
        else c = v < 0.32 ? P.black : v < 0.62 ? mix(P.black, P.navyDark, (v - 0.32) / 0.3, x, y) : mix(P.navyDark, P.navy, Math.min(1, (v - 0.62) / 0.5), x, y);
      } else {
        // floor: concrete, darker toward the camera, a little of the light reflected
        const d = (y - SWEEP_Y) / (WORLD_H - SWEEP_Y);
        const f = v * (1 - d * 0.6) - d * 0.15;
        c = f < 0.18 ? P.black : mix(P.black, P.navyDark, Math.min(1, (f - 0.18) / 0.3), x, y);
        if (!clean && hash01(13, x, y) < 0.025 && f > 0.25) c = P.navy;
      }
      px(b, x, y, c);
    }
  // the seam where the paper sweep meets the floor: one soft darker row
  for (let x = 0; x < WORLD_W; x++) {
    const c = get(b, x, SWEEP_Y);
    px(b, x, SWEEP_Y, darker(c, 1));
  }
  if (clean) return;
  // floor dressing: gaffer-tape marks for the chairs and two cables
  const tape = (x: number, y: number, c: Color) => {
    rect(b, x - 2, y, 5, 1, c);
    rect(b, x, y - 1, 1, 3, c);
  };
  tape(96, 131, P.gold);
  tape(224, 131, P.gold);
  tape(160, 134, P.greyLight);
  for (let x = 30; x < 330; x++) {
    const y = Math.round(140 + Math.sin(x / 23) * 4 + x * 0.03);
    px(b, x, y, P.black);
    if ((x & 7) === 0) px(b, x, y - 1, P.navyDark);
  }
  for (let y = 112; y < 180; y++) {
    const x = Math.round(248 + Math.sin(y / 9) * 3 + (y - 112) * 0.5);
    px(b, x, y, P.black);
  }
}

// ---------------------------------------------------------------- softbox (left)

function paintSoftbox(b: Rgba): void {
  // stand: pole, three legs, a sandbag
  vline(b, 31, 74, 111, P.slate);
  vline(b, 32, 74, 111, P.navy);
  line(b, 31, 104, 21, 113, P.slate);
  line(b, 32, 104, 44, 113, P.navy);
  line(b, 31, 105, 33, 115, P.slate);
  rect(b, 23, 110, 7, 3, P.brown);
  rect(b, 23, 110, 7, 1, P.brownLight);
  // speed ring and the black housing tapering back to it
  poly(b, [[19, 52], [36, 33], [36, 81], [19, 64]], (x, y) => (x < 22 ? P.navyDark : mix(P.black, P.navyDark, (y - 33) / 48 < 0.2 ? 0.6 : 0.15, x, y)));
  rect(b, 17, 54, 3, 8, P.slate);
  rect(b, 17, 54, 1, 8, P.grey);
  // the diffusion face, turned toward the chairs: a bright trapezoid with a soft edge
  const face: [number, number][] = [[36, 33], [48, 38], [48, 76], [36, 81]];
  poly(b, face, (x, y) => {
    const u = (x - 36) / 12;
    const top = 33 + u * 5, bot = 81 - u * 5;
    const v = (y - top) / (bot - top);
    const e = Math.min(x - 36, 48 - x, (y - top) * 0.6, (bot - y) * 0.6);
    if (e < 1) return P.greyLight;
    if (e < 2.2) return mix(P.greyLight, P.white, 0.5, x, y);
    return v > 0.15 && v < 0.85 ? P.white : mix(P.white, P.cream, 0.3, x, y);
  });
  // rim of the housing
  line(b, 36, 33, 48, 38, P.grey);
  line(b, 36, 81, 48, 76, P.slate);
  vline(b, 35, 34, 80, P.slate);
}

// ---------------------------------------------------------------- plant (behind the table)

function paintPlant(b: Rgba): void {
  // pot
  poly(b, [[151, 90], [169, 90], [167, 104], [153, 104]], (x) => (x < 156 ? P.slate : x > 165 ? P.navyDark : P.navy));
  rect(b, 150, 89, 21, 2, P.grey);
  rect(b, 150, 89, 3, 1, P.greyLight);
  // trunk
  for (let y = 46; y <= 90; y++) {
    const x = Math.round(160 + Math.sin(y / 7) * 1.5);
    px(b, x, y, P.brown);
    px(b, x + 1, y, P.plum);
  }
  // a dense canopy of violin-shaped leaves, back to front, lit from the left (the softbox)
  const n = 34;
  const leaves: { x: number; y: number; rx: number; ry: number; a: number; depth: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = hash01(41, i) * Math.PI * 2;
    const r = Math.sqrt(hash01(42, i));
    const x = 160 + Math.cos(ang) * r * 17;
    const y = 60 + Math.sin(ang) * r * 24 - (1 - r) * 4;
    const rx = 2.6 + hash01(43, i) * 1.6, ry = 4.2 + hash01(44, i) * 2;
    leaves.push({ x, y, rx, ry, a: Math.atan2(y - 74, x - 160) + Math.PI / 2 + (hash01(45, i) - 0.5) * 0.8, depth: hash01(46, i) });
  }
  leaves.sort((p, q) => p.depth - q.depth);
  for (const lf of leaves) {
    const ca = Math.cos(lf.a), sa = Math.sin(lf.a);
    const front = lf.depth > 0.55;
    for (let y = Math.floor(lf.y - 7); y <= lf.y + 7; y++)
      for (let x = Math.floor(lf.x - 7); x <= lf.x + 7; x++) {
        const dx = x + 0.5 - lf.x, dy = y + 0.5 - lf.y;
        const u = (dx * ca + dy * sa) / lf.rx, v = (-dx * sa + dy * ca) / lf.ry;
        // egg shape: broader toward the tip
        const w = 1 + 0.25 * v;
        if (u * u * w * w + v * v > 1) continue;
        const edge = u * u * w * w + v * v > 0.55;
        const lit = dx < -0.4 && edge;
        let c: Color = front ? P.greenDark : P.tealDark;
        if (lit) c = front ? P.green : P.greenDark;
        else if (edge && dx > 0.6) c = front ? P.tealDark : P.black;
        if (Math.abs(u) < 0.18 && front) c = P.tealDark; // midrib
        px(b, x, y, c);
      }
  }
}

// ---------------------------------------------------------------- floor lamp (behind the guest, right)

function paintLampGlow(b: Rgba): void {
  // warm light on the backdrop around the shade
  const cx = 247, cy = 56;
  for (let y = cy - 40; y < cy + 44; y++)
    for (let x = cx - 40; x < cx + 40; x++) {
      if (y >= SWEEP_Y + 6) continue;
      const nx = (x - cx) / 38, ny = (y - cy) / (y < cy ? 34 : 46);
      const d = Math.sqrt(nx * nx + ny * ny);
      if (d >= 1) continue;
      const t = 1 - d;
      const c = get(b, x, y);
      let w: Color = c;
      if (t > 0.62) w = mix(P.brown, P.rust, (t - 0.62) / 0.38, x, y);
      else if (t > 0.32) w = mix(P.plum, P.brown, (t - 0.32) / 0.3, x, y);
      else if (t > 0.1) w = mix(c, P.plum, (t - 0.1) / 0.22, x, y);
      px(b, x, y, w);
    }
}

function paintLamp(b: Rgba): void {
  vline(b, 247, 62, 111, P.grey);
  vline(b, 248, 62, 111, P.slate);
  ellipse(b, 242, 110, 12, 3, P.navyDark);
  rect(b, 243, 110, 10, 1, P.slate);
  // drum shade, glowing from inside
  poly(b, [[241, 47], [254, 47], [256, 61], [239, 61]], (x, y) => {
    if (y === 47) return P.gold;
    if (y >= 59) return P.yellow;
    const u = (x - 239) / 17;
    return u < 0.3 ? P.cream : u > 0.78 ? P.tan : mix(P.cream, P.tan, 0.4, x, y);
  });
  rect(b, 241, 61, 14, 1, P.white);
}

// ---------------------------------------------------------------- boom mic (top), LED backlight (right)

function paintBoom(b: Rgba): void {
  line(b, 330, 20, 232, 41, P.slate);
  line(b, 330, 21, 232, 42, P.navy);
  // fuzzy windscreen on the end
  for (let y = 38; y <= 47; y++)
    for (let x = 211; x <= 233; x++) {
      const nx = (x - 222) / 11.5, ny = (y - 42.5) / 4.5;
      const d = nx * nx + ny * ny;
      if (d > 1.15) continue;
      if (d > 0.8 && hash01(5, x, y) < 0.5) continue;
      px(b, x, y, d < 0.35 && nx < 0 ? P.grey : hash01(6, x, y) < 0.35 ? P.navy : P.slate);
    }
}

function paintBacklight(b: Rgba): void {
  // a small LED panel on a stand at the back right, aimed at the guest: we see its dark housing
  // and the lit edge of its face
  vline(b, 300, 56, 112, P.navy);
  line(b, 300, 106, 292, 113, P.navy);
  line(b, 300, 106, 309, 113, P.navyDark);
  poly(b, [[294, 45], [304, 42], [304, 57], [294, 56]], (x, y) => (y === 45 || x === 303 ? P.slate : P.navyDark));
  vline(b, 294, 45, 56, P.cyan);
  vline(b, 295, 46, 55, P.blue);
  // a little spill on the backdrop
  for (let y = 38; y < 62; y++)
    for (let x = 280; x < 294; x++) {
      const d = Math.hypot((x - 294) / 14, (y - 50) / 12);
      if (d < 1 && bayer(x, y) < (1 - d) * 0.5) px(b, x, y, lighter(get(b, x, y), 1));
    }
}

// ---------------------------------------------------------------- rug, chairs, table

function paintRug(b: Rgba): void {
  // trapezoid in perspective: back edge y 105, front edge y 126
  const back = 105, front = 128;
  for (let y = back; y <= front; y++) {
    const t = (y - back) / (front - back);
    const x0 = Math.round(86 - t * 22), x1 = Math.round(234 + t * 22);
    for (let x = x0; x <= x1; x++) {
      const e = Math.min(x - x0, x1 - x, (y - back) * 2.2, (front - y) * 2.2);
      let c: Color;
      if (e < 1) c = P.plum;
      else if (e < 3) c = (x + y) % 3 === 0 ? P.rust : P.redDark;
      else if (e < 4) c = P.plum;
      else {
        // field: a dim medallion pattern
        const u = (x - 160) / ((x1 - x0) / 2), v = (y - (back + front) / 2) / ((front - back) / 2);
        const m = Math.abs(u) * 1.4 + Math.abs(v);
        c = m < 0.5 ? (m < 0.2 ? P.rust : P.redDark) : (Math.floor(m * 6) & 1) ? P.redDark : P.plum;
      }
      // the rug is in the dim part of the room: one step down
      px(b, x, y, darker(c, 1));
    }
  }
}

/** A mid-century leather lounge chair for a seated actor whose box is at (bx, by); `face` = which way it turns. */
function paintChair(b: Rgba, bx: number, by: number, face: 1 | -1): void {
  const L: Color[] = [P.green, P.greenDark, P.tealDark, P.black]; // bottle-green leather, lit from the left
  const W: Color[] = [P.brownLight, P.brown, P.plum, P.black]; // walnut frame
  const tmp = createBuffer(40, 50);
  const ox = 4; // tmp x of the box's x 0
  // back cushion, wider than the actor, rounded top; it turns toward the other chair, so the
  // outer edge (away from the other chair) is a little taller
  for (let y = 25; y <= 41; y++)
    for (let x = 2; x <= 29; x++) {
      const outer = face === 1 ? x < 16 : x >= 16;
      const topY = 25 + (outer ? 0 : 1) + (x < 4 || x > 27 ? 1 : 0);
      if (y < topY) continue;
      const edgeL = x === 2, edgeR = x === 29;
      let c = L[1];
      if (y === topY) c = L[0];
      else if (edgeL) c = L[0];
      else if (edgeR) c = L[2];
      if (y > 31 && (x === 9 || x === 22)) c = L[2]; // tufting seams
      px(tmp, ox + x, y, c);
    }
  // seat cushion front, below the lap
  for (let y = 39; y <= 42; y++)
    for (let x = 3; x <= 28; x++) px(tmp, ox + x, y, y === 39 ? L[1] : y === 42 ? L[3] : L[2]);
  // armrests (walnut) outside the arms
  for (const [x0, x1] of [[0, 5], [26, 31]] as [number, number][]) {
    for (let y = 31; y <= 40; y++)
      for (let x = x0; x <= x1; x++) {
        let c = W[1];
        if (y === 31) c = W[0];
        else if (x === x0) c = W[0];
        else if (x === x1) c = W[2];
        px(tmp, ox + x, y, c);
      }
  }
  // tapered legs
  for (const lx of [1, 28]) {
    for (let y = 41; y <= 46; y++) {
      const dx = y > 43 ? (lx < 16 ? -1 : 1) : 0;
      px(tmp, ox + lx + dx, y, W[1]);
      px(tmp, ox + lx + dx + 1, y, W[2]);
    }
  }
  outlineOpaque(tmp, P.black);
  // the turn: the chair's inner side (toward the other chair) gets a strip of its side panel
  const inner = face === 1 ? 31 + ox + 1 : ox - 2;
  for (let y = 27; y <= 42; y++) {
    px(tmp, inner, y, y < 31 ? L[2] : W[2]);
  }
  // shadow on the floor under the chair
  for (let y = 45; y <= 48; y++)
    for (let x = 0; x < 40; x++) {
      const nx = (x - 20) / 19, ny = (y - 46.5) / 2.2;
      if (nx * nx + ny * ny <= 1 && get(tmp, x, y) === TRANSPARENT) px(tmp, x, y, P.black);
    }
  blit(b, tmp, bx - ox, by);
}

function paintTable(b: Rgba): void {
  const cx = 160;
  // pedestal and base
  rect(b, cx - 2, 101, 4, 9, P.brown);
  rect(b, cx - 2, 101, 1, 9, P.brownLight);
  rect(b, cx + 1, 101, 1, 9, P.plum);
  ellipse(b, cx - 8, 109, 16, 4, P.plum);
  ellipse(b, cx - 7, 109, 14, 2, P.brown);
  // round top, seen a little from above
  ellipse(b, cx - 12, 95, 24, 7, P.plum);
  ellipse(b, cx - 12, 94, 24, 6, P.brownLight);
  ellipse(b, cx - 10, 95, 20, 4, P.brown);
  rect(b, cx - 9, 95, 8, 1, P.tan);
  // floor shadow
  for (let x = cx - 12; x < cx + 12; x++) {
    const c = get(b, x, 112);
    if (c !== TRANSPARENT) px(b, x, 112, darker(c, 1));
  }
}

/** Two glasses of water: his half drunk, hers untouched. */
function paintGlasses(b: Rgba): void {
  const glass = (x: number, level: number) => {
    const top = 89, bottom = 96;
    for (let y = top; y <= bottom; y++) {
      px(b, x, y, P.grey);
      px(b, x + 4, y, P.slate);
      for (let xx = x + 1; xx <= x + 3; xx++) {
        const water = y >= bottom - level;
        px(b, xx, y, water ? (y === bottom - level ? P.cyan : P.blue) : y === top ? P.grey : P.navy);
      }
    }
    rect(b, x, bottom + 1, 5, 1, P.greyLight);
    px(b, x + 1, top + 1, P.white);
    px(b, x + 1, top + 2, P.greyLight);
  };
  glass(151, 3);
  glass(164, 6);
}

// ---------------------------------------------------------------- the camera (foreground silhouette)

function paintCamera(b: Rgba): void {
  const K = P.black, R = P.navy;
  const sil = createBuffer(WORLD_W, WORLD_H);
  const bar = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    for (let i = 0; i < w; i++) line(sil, x0 + i, y0, x1 + i, y1, K);
  };
  // tripod legs, splayed, running off the bottom of frame
  bar(30, 104, -12, 192, 5);
  bar(31, 104, 30, 192, 5);
  bar(34, 104, 80, 192, 5);
  // fluid head and the pan handle sloping off to the left
  rect(sil, 20, 96, 26, 10, K);
  bar(22, 100, -8, 114, 3);
  // camera body pointing right, at the guest
  rect(sil, 8, 70, 46, 27, K);
  rect(sil, 1, 74, 8, 19, K); // battery
  rect(sil, 54, 75, 12, 17, K); // lens barrel
  poly(sil, [[66, 74], [76, 66], [76, 101], [66, 93]], K); // matte box
  rect(sil, 14, 63, 30, 3, K); // top handle
  rect(sil, 16, 63, 3, 8, K);
  rect(sil, 39, 63, 3, 8, K);
  rect(sil, 12, 48, 24, 15, K); // monitor
  rect(sil, 22, 62, 4, 3, K);
  blit(b, sil, 0, 0);
  // rim light: the softbox and the set light the top and right-facing edges
  for (let y = 0; y < WORLD_H; y++)
    for (let x = 0; x < WORLD_W; x++) {
      if (get(sil, x, y) === TRANSPARENT) continue;
      const right = get(sil, x + 1, y) === TRANSPARENT, top = get(sil, x, y - 1) === TRANSPARENT;
      if (top && y < 110) px(b, x, y, R);
      else if (right && y < 112) px(b, x, y, P.navyDark);
    }
  // the monitor shows the shot: the guest, tiny, in teal
  rect(b, 13, 49, 22, 13, P.navyDark);
  rect(b, 14, 50, 20, 11, P.blueDark);
  rect(b, 22, 52, 4, 3, P.peach);
  rect(b, 21, 51, 6, 1, P.rust);
  rect(b, 21, 52, 1, 4, P.rust);
  rect(b, 26, 52, 1, 4, P.rust);
  rect(b, 21, 55, 6, 5, P.blue);
  rect(b, 23, 55, 2, 5, P.greyLight);
  rect(b, 15, 51, 2, 1, P.hotRed); // REC dot on the monitor
}

// ---------------------------------------------------------------- layers

export interface SetLayers {
  /** Everything behind the actors' plane (defocused in tight shots). Opaque. */
  back: Rgba;
  /** Rug, chairs, table, glasses: the actors' plane, always sharp. Transparent elsewhere. */
  mid: Rgba;
  /** The camera on its tripod: wide shot only. */
  front: Rgba;
}

let cached: SetLayers | null = null;
let tightBack: Rgba | null = null;
export function setLayers(): SetLayers {
  if (cached) return cached;
  const back = createBuffer(WORLD_W, WORLD_H);
  paintBack(back, false);
  const mid = createBuffer(WORLD_W, WORLD_H);
  paintRug(mid);
  paintChair(mid, HOST_AT.x, HOST_AT.y, 1);
  paintChair(mid, GUEST_AT.x, GUEST_AT.y, -1);
  paintTable(mid);
  paintGlasses(mid);
  const front = createBuffer(WORLD_W, WORLD_H);
  paintCamera(front);
  cached = { back, mid, front };
  return cached;
}

function paintBack(b: Rgba, clean: boolean): void {
  paintBackdrop(b, clean);
  paintLampGlow(b);
  paintSoftbox(b);
  paintBacklight(b);
  paintPlant(b);
  paintLamp(b);
  paintBoom(b);
}

/** The back layer for tight shots: drawn without fabric mottling, then defocused. Cached. */
export function tightBackLayer(): Rgba {
  if (tightBack) return tightBack;
  const b = createBuffer(WORLD_W, WORLD_H);
  paintBack(b, true);
  tightBack = defocus(b, 4);
  return tightBack;
}

/**
 * Shallow depth of field for tight shots: box-blur the back layer and snap it back onto the master
 * palette without dither, so the room melts into big soft shapes behind the face.
 */
export function defocus(src: Rgba, r: number, dim = 0): Rgba {
  const { w, h } = src;
  const out = createBuffer(w, h);
  const acc = new Float32Array(w * h * 3);
  const tmp = new Float32Array(w * h * 3);
  const d = src.data;
  // horizontal pass
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const i = (y * w + xx) * 4;
        r0 += d[i];
        g0 += d[i + 1];
        b0 += d[i + 2];
        n++;
      }
      const j = (y * w + x) * 3;
      tmp[j] = r0 / n;
      tmp[j + 1] = g0 / n;
      tmp[j + 2] = b0 / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const j = (yy * w + x) * 3;
        r0 += tmp[j];
        g0 += tmp[j + 1];
        b0 += tmp[j + 2];
        n++;
      }
      const j = (y * w + x) * 3;
      acc[j] = r0 / n;
      acc[j + 1] = g0 / n;
      acc[j + 2] = b0 / n;
    }
  const memo = new Map<number, Color>();
  for (let i = 0; i < w * h; i++) {
    // quantise in steps of 4 per channel so neighbouring pixels agree (no speckle)
    const r1 = Math.round(acc[i * 3] / 4) * 4, g1 = Math.round(acc[i * 3 + 1] / 4) * 4, b1 = Math.round(acc[i * 3 + 2] / 4) * 4;
    const key = (r1 << 16) | (g1 << 8) | b1;
    let c = memo.get(key);
    if (c === undefined) {
      c = nearest(key);
      if (dim) c = darker(c, dim);
      memo.set(key, c);
    }
    px(out, i % w, (i / w) | 0, c);
  }
  return out;
}

/** Dynamic bits of the set: the camera's tally light and dust motes in the softbox's beam. */
export function drawSetLife(b: Rgba, t: number, wide: boolean): void {
  if (!wide) return;
  // dust motes drifting through the light, very slowly
  for (let i = 0; i < 14; i++) {
    const per = 9 + hash01(21, i) * 7;
    const ph = (t / per + hash01(22, i)) % 1;
    const x = Math.round(52 + hash01(23, i) * 120 + ph * 26);
    const y = Math.round(40 + hash01(24, i) * 50 + Math.sin(ph * 6.28 + i) * 3);
    if (hash01(25, i, Math.floor(t * 3)) < 0.25) continue; // twinkle
    const c = get(b, x, y);
    if (c !== TRANSPARENT && c !== P.white) px(b, x, y, lighter(c, 1));
  }
  // red tally light on the camera: blinking while it records
  const on = Math.floor(t / 0.55) % 2 === 0;
  if (on) {
    px(b, 50, 72, P.hotRed);
    px(b, 49, 72, P.redDark);
    px(b, 50, 73, P.redDark);
  }
}

function vline(b: Rgba, x: number, y0: number, y1: number, c: Color): void {
  rect(b, x, y0, 1, y1 - y0 + 1, c);
}
