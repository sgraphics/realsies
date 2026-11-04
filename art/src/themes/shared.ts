// Building blocks shared by several themes: frame iteration, pillars, banner plates, perspective
// floors, and animated props (flames, torches, bats, drips, chains, fireflies, embers).

import { PAL, type Color, darker, lighter } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME } from '../scene/layout.ts';
import type { Prop } from './types.ts';
import { type Paint, type Clip, put, fill, shade, bayer, sprite, L_DECO, L_FRAME, L_WALL, layerAt } from './util.ts';

const P = PAL;

// ---------------------------------------------------------------- frame

export type FrameSide = 'top' | 'bottom' | 'left' | 'right' | 'corner';

/**
 * Visit every frame pixel. `along` runs along the edge (x for top/bottom, y for left/right),
 * `depth` is 0 at the screen edge and FRAME-1 at the inner edge. Corners report side 'corner'
 * with (cx, cy) = position inside the corner square.
 */
export function forFrame(p: Paint, fn: (x: number, y: number, side: FrameSide, along: number, depth: number, cx: number, cy: number) => void): void {
  const F = FRAME;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const l = x < F, r = x >= p.w - F, t = y < F, b = y >= p.h - F;
      if (!l && !r && !t && !b) continue;
      if ((l || r) && (t || b)) {
        const cx = l ? x : p.w - 1 - x, cy = t ? y : p.h - 1 - y;
        fn(x, y, 'corner', 0, Math.min(cx, cy), cx, cy);
      } else if (t) fn(x, y, 'top', x, y, 0, 0);
      else if (b) fn(x, y, 'bottom', x, p.h - 1 - y, 0, 0);
      else if (l) fn(x, y, 'left', y, x, 0, 0);
      else fn(x, y, 'right', y, p.w - 1 - x, 0, 0);
    }
}

/** Shadow the frame casts on the room (light from the top-left) plus a dark inner rim. */
export function frameFinish(p: Paint, rim: Color): void {
  const F = FRAME;
  for (let x = F; x < p.w - F; x++) {
    put(p, x, F - 1, rim, L_FRAME);
    put(p, x, p.h - F, rim, L_FRAME);
    for (let k = 0; k < 3; k++) if (k < 2 || bayer(x, k) < 0.5) shade(p, x, F + k, 1);
  }
  for (let y = F; y < p.h - F; y++) {
    put(p, F - 1, y, rim, L_FRAME);
    put(p, p.w - F, y, rim, L_FRAME);
    for (let k = 0; k < 3; k++) if (k < 2 || bayer(k, y) < 0.5) shade(p, F + k, y, 1);
  }
}

/** Corner square of a frame: a bevelled plate with a diamond boss in the centre. */
export function cornerBoss(cx: number, cy: number, plate: [Color, Color, Color, Color], boss: [Color, Color, Color]): Color {
  const F = FRAME;
  const e = Math.min(cx, cy, F - 1 - cx, F - 1 - cy);
  const [hi, base, lo, dk] = plate;
  const m = Math.abs(cx - (F - 1) / 2) + Math.abs(cy - (F - 1) / 2);
  if (m <= 4.5) {
    if (m > 3.5) return dk;
    const lit = cx + cy < F - 1;
    if (m <= 1) return lit ? P.white : boss[0];
    return lit ? boss[0] : m > 2.5 ? boss[2] : boss[1];
  }
  if (e === 0) return dk;
  if (e === 1) return cx === 1 || cy === 1 ? hi : lo;
  return (cx + cy) % 7 === 0 ? lo : base;
}

/** Big bevelled blocks with metal corner plates (castle, desert-like stone frames). */
export function paintStdFrame(p: Paint, o: { block: [Color, Color, Color, Color]; corner: [Color, Color, Color]; blockW: number; blockH: number }): void {
  const [hi, base, lo, dk] = o.block;
  forFrame(p, (x, y, side, along, depth, cx, cy) => {
    let c: Color;
    if (side === 'corner') {
      put(p, x, y, cornerBoss(cx, cy, o.block, o.corner), L_FRAME);
      return;
    }
    const bw = side === 'top' || side === 'bottom' ? o.blockW : o.blockH;
    const off = side === 'bottom' || side === 'right' ? Math.round(bw / 2) : 0;
    const u = (along + off) % bw;
    const id = Math.floor((along + off) / bw);
    if (depth === 0 || depth === FRAME - 1 || u === 0) c = dk;
    else {
      // lit from the top-left: which inner edge faces the light depends on the side
      const litEdge = side === 'top' || side === 'left' ? depth === 1 : depth === FRAME - 2;
      const darkEdge = side === 'top' || side === 'left' ? depth === FRAME - 2 : depth === 1;
      if (u === 1 || litEdge) c = hi;
      else if (u === bw - 1 || darkEdge) c = lo;
      else {
        c = base;
        const n = hash01(77, x, y);
        if (n < 0.08) c = lo;
        else if (n > 0.96) c = hi;
        if (hash01(78, id, side.length) > 0.7 && (u + depth) % 9 === 4) c = lo; // a crack
      }
    }
    put(p, x, y, c, L_FRAME);
  });
  frameFinish(p, dk);
}

// ---------------------------------------------------------------- pillars and plates

/**
 * A stone column with capital and base and a recessed dark panel for DOM text. Wide rects
 * (portrait stat strips) become a horizontal tablet.
 */
export function paintStonePillar(p: Paint, r: Rect, o: { stone: [Color, Color, Color, Color]; inset: Color; trim: Color; outline: Color }): void {
  const [hi, base, lo, dk] = o.stone;
  const L = L_DECO;
  if (r.w > r.h * 1.3) {
    // tablet
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
        let c: Color;
        if (e === 0) c = o.outline;
        else if (e === 1) c = y === r.y + 1 || x === r.x + 1 ? hi : lo;
        else if (e === 2) c = base;
        else if (e === 3) c = dk;
        else c = o.inset;
        if (e === 2 && (x - r.x) % 6 === 3 && (y === r.y + 2 || y === r.y + r.h - 3)) c = o.trim;
        put(p, x, y, c, L);
      }
    shadowRight(p, r);
    return;
  }
  const capH = 8, baseH = 8;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const yy = y - r.y, fromBot = r.y + r.h - 1 - y;
      const inCap = yy < capH, inBase = fromBot < baseH;
      let x0 = r.x, x1 = r.x + r.w - 1;
      if (!inCap && !inBase) {
        x0 += 3;
        x1 -= 3;
      }
      if (x < x0 || x > x1) continue;
      let c: Color;
      const edgeX = x === x0 || x === x1;
      if (inCap || inBase) {
        const v = inCap ? yy : baseH - 1 - fromBot;
        const top = inCap ? yy === 0 : fromBot === baseH - 1;
        const bottom = inCap ? yy === capH - 1 : fromBot === 0;
        if (edgeX || top || bottom) c = o.outline;
        else if ((inCap && yy === 1) || (inBase && v === 1)) c = hi;
        else if ((inCap && yy === capH - 2) || (inBase && v === baseH - 2)) c = lo;
        else if (x === x0 + 1) c = hi;
        else if (x === x1 - 1) c = lo;
        else c = (inCap && yy === 3) || (inBase && v === 4) ? o.trim : base;
      } else {
        // shaft: fluted sides around a recessed panel
        const sx = x - x0;
        const sw = x1 - x0 + 1;
        if (edgeX) c = o.outline;
        else if (sx < 4 || sx >= sw - 4) c = sx === 1 ? hi : sx === sw - 2 ? lo : sx % 2 ? base : lo;
        else {
          const py = y - (r.y + capH), ph = r.h - capH - baseH;
          const pe = Math.min(sx - 4, sw - 5 - sx, py - 2, ph - 3 - py);
          if (py < 2 || py > ph - 3) c = base;
          else if (pe === 0) c = py === 2 || sx === 4 ? dk : hi; // inset bevel: dark top/left, light bottom/right
          else c = o.inset;
        }
      }
      put(p, x, y, c, L);
    }
  shadowRight(p, r);
}

/** Cast shadow to the right and below a decoration rect (light from the top-left). */
export function shadowRight(p: Paint, r: Rect): void {
  for (let y = r.y + 2; y < r.y + r.h + 2; y++) {
    for (let k = 0; k < 2; k++) {
      const x = r.x + r.w + k;
      if (layerAt(p, x, y) === L_WALL) shade(p, x, y, 1);
    }
  }
  for (let x = r.x + 2; x < r.x + r.w + 2; x++) {
    const y = r.y + r.h;
    if (layerAt(p, x, y) === L_WALL) shade(p, x, y, 1);
  }
}

/** A hanging cloth banner with trim and swallowtail ends (castle) or a generic plaque. */
export function paintBannerPlate(p: Paint, r: Rect, o: { cloth: [Color, Color, Color, Color]; trim: Color; outline: Color }): void {
  const [hi, base, lo] = o.cloth;
  // hanging cords
  for (const cx of [r.x + 8, r.x + r.w - 9]) {
    for (let y = r.y - 4; y < r.y; y++) put(p, cx, y, (y & 1) ? P.gold : P.orange, L_DECO);
  }
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const yy = y - r.y;
      const notch = Math.abs(yy - (r.h - 1) / 2) <= 2 - Math.min(x - r.x, r.x + r.w - 1 - x);
      if (notch) continue;
      const e = Math.min(yy, r.h - 1 - yy);
      let c: Color;
      if (e === 0) c = o.outline;
      else if (e === 1) c = o.trim;
      else c = yy === 2 ? hi : yy === r.h - 3 ? lo : base;
      const side = Math.min(x - r.x, r.x + r.w - 1 - x);
      if (side === 0 && e > 0) c = o.outline;
      put(p, x, y, c, L_DECO);
    }
  // notch outlines
  for (let y = r.y; y < r.y + r.h; y++) {
    const yy = y - r.y;
    for (const left of [true, false]) {
      const depthIn = Math.max(0, 2 - Math.abs(yy - (r.h - 1) / 2));
      const x = left ? r.x + Math.ceil(depthIn) : r.x + r.w - 1 - Math.ceil(depthIn);
      if (depthIn > 0) put(p, x, y, o.outline, L_DECO);
    }
  }
  shadowRight(p, r);
}

// ---------------------------------------------------------------- floors

/** Perspective floor rows from `horizon` to the bottom. fn gets the stone grid coordinates. */
export function perspectiveFloor(p: Paint, horizon: number, cx: number, fn: (x: number, y: number, row: number, v: number, u: number, depth: number, rowH: number) => void): void {
  let y = horizon, row = 0;
  const span = Math.max(1, p.h - horizon);
  while (y < p.h) {
    const depth = (y - horizon) / span;
    const rowH = 3 + Math.floor(depth * 10);
    for (let v = 0; v < rowH && y + v < p.h; v++) {
      const d = (y + v - horizon) / span;
      for (let x = 0; x < p.w; x++) fn(x, y + v, row, v, (x + 0.5 - cx) / (0.55 + d * 1.7), d, rowH);
    }
    y += rowH;
    row++;
  }
}

/** Two wall points in the spandrels of an arch (above the cap, inside its rect), for mounted props. */
export function spandrels(o: { rect: Rect; rise: number }): { x: number; y: number }[] {
  const r = o.rect;
  if (o.rise < 20 || r.w < 120) return [];
  return [
    { x: Math.round(r.x + 6), y: Math.round(r.y + 1) },
    { x: Math.round(r.x + r.w - 11), y: Math.round(r.y + 1) },
  ];
}

// ---------------------------------------------------------------- flames, torches, braziers

const FLAMES = [
  ['....r....', '....r....', '...ror...', '...ror...', '..rogor..', '..ogygo..', '.rogyygor', '.ogyywygo', 'rogywwygo', '.ogyyyyo.', '..ogggo..', '...ooo...'],
  ['.....r...', '....rr...', '....or...', '...rog...', '..rogor..', '..ogyyo..', '.rogyygo.', '.ogyywgor', 'rogyywygo', '.ogyyyyo.', '..ogggo..', '...ooo...'],
  ['...r.....', '...rr....', '...ro..r.', '..rogr.o.', '..ogyor..', '.rogyygo.', '.ogyywgor', 'rogywwygo', 'rogyyyygo', '.ogyyyyo.', '..ogggo..', '...ooo...'],
  ['.........', '....r....', '...rro...', '...rgr...', '..rogor..', '.rogyyor.', 'rogywygor', 'rogywwgo.', '.ogyyyygo', '.ogyyyyo.', '..ogggo..', '...ooo...'],
];
const FLAME_MAP: Record<string, Color> = { r: P.red, o: P.orange, g: P.gold, y: P.yellow, w: P.white };
const FLAME_MAP_BLUE: Record<string, Color> = { r: P.blueDark, o: P.blue, g: P.cyan, y: P.white, w: P.white };

/** Draw an animated flame whose base centre is at (x, y). */
export function drawFlame(c: Clip, x: number, y: number, now: number, seed: number, blue = false, big = false): void {
  const f = Math.floor((now + seed * 137) / 110) % 4;
  const fr = FLAMES[(f + seed) % 4];
  const map = blue ? FLAME_MAP_BLUE : FLAME_MAP;
  const H = fr.length;
  if (!big) c.sprite(fr, x - 4, y - H + 1, map);
  else {
    // big flame: the same shape stretched 1.5x by repeating every other row/column
    for (let j = 0; j < Math.round(H * 1.5); j++)
      for (let i = 0; i < 13; i++) {
        const ch = fr[Math.min(H - 1, Math.floor(j / 1.5))][Math.min(8, Math.floor(i / 1.45))];
        if (ch === '.') continue;
        c.px(x - 6 + i, y - Math.round(H * 1.5) + 1 + j, map[ch]);
      }
  }
  // embers
  for (let e = 0; e < 2; e++) {
    const per = 900 + e * 340;
    const t = ((now + seed * 311 + e * 457) % per) / per;
    const k = Math.floor((now + seed * 311 + e * 457) / per);
    const ex = x + Math.round((hash01(seed, k, e) - 0.5) * 6 + Math.sin(t * 6) * 1.2);
    const ey = y - H - Math.round(t * (big ? 20 : 12));
    if (t < 0.85) c.px(ex, ey, t < 0.4 ? (blue ? P.cyan : P.yellow) : blue ? P.blue : P.orange);
  }
}

/** Static iron (or gold) sconce for a wall torch; the flame sits at (x+2, y). */
export function paintTorchSconce(p: Paint, x: number, y: number, kind: 'iron' | 'gold' | 'wood'): void {
  const m: Record<string, Color> =
    kind === 'gold' ? { n: P.brown, N: P.gold, h: P.yellow, b: P.brownLight, d: P.plum } : kind === 'wood' ? { n: P.plum, N: P.brownLight, h: P.skinMid, b: P.brown, d: P.plum } : { n: P.navyDark, N: P.slate, h: P.grey, b: P.brown, d: P.black };
  sprite(p, ['nnnnn', 'nhNNn', '.nNn.', '..b..', '..b..', '.nbn.', 'nNhNn', 'n...n', 'n...n'], x, y, m, L_DECO);
  // shadow on the wall to the right
  for (let j = 1; j < 9; j++) if (layerAt(p, x + 5, y + j) === L_WALL) shade(p, x + 5, y + j, 1);
}

export function torchProp(x: number, y: number, seed: number, blue = false): Prop {
  return {
    layer: 'mid',
    name: 'torch',
    at: { x: x - 5, y: y - 18, w: 16, h: 28 },
    draw(c, now) {
      // flickering halo on the wall, then the flame
      const fl = Math.floor((now + seed * 50) / 130) % 3;
      c.minLayer = L_WALL;
      if (now && fl) c.glow(x + 2.5, y - 5, 5 + fl, 0.8);
      c.minLayer = 0;
      drawFlame(c, x + 2, y, now, seed, blue);
    },
  };
}

export function paintBrazier(p: Paint, x: number, y: number, metal: [Color, Color, Color, Color]): void {
  // x, y = bowl top-left; bowl 13 wide, stand below
  const [hi, base, lo, dk] = metal;
  const rows = ['ddddddddddddd', 'dhbbbbbbbbbld', '.dhbbbbbbbld.', '..ddbbbbbdd..', '....dbbbd....', '.....dbd.....', '.....dbd.....', '....dbbbd....', '...dbbbbbd...', '..ddddddddd..'];
  sprite(p, rows, x, y, { d: dk, h: hi, b: base, l: lo }, L_DECO);
  // coals
  sprite(p, ['.rooorooro.'], x + 1, y, { r: P.red, o: P.orange }, L_DECO);
}

export function brazierProp(x: number, y: number, seed: number): Prop {
  return {
    layer: 'mid',
    name: 'brazier',
    at: { x: x - 4, y: y - 26, w: 22, h: 36 },
    draw(c, now) {
      const fl = Math.floor((now + seed * 50) / 120) % 3;
      if (now) c.glow(x + 6.5, y - 6, 12 + fl, 1);
      drawFlame(c, x + 6, y + 1, now, seed, false, true);
    },
  };
}

// ---------------------------------------------------------------- creatures and drips

const BAT = [
  ['k.......k', 'kk.....kk', '.kkkkkkk.', '...kek...', '....k....'],
  ['.........', '...kkk...', '.kkkekkk.', 'kk..k..kk', 'k.......k'],
];

/** A bat that crosses the opening every `period` ms along a wavy path (far layer). */
export function batProp(area: Rect, floorY: number, period: number, colors: [Color, Color, Color]): Prop {
  const map: Record<string, Color> = { k: colors[0], e: colors[2] };
  return {
    layer: 'far',
    name: 'bat',
    at: { x: area.x, y: Math.max(area.y, floorY - 74), w: area.w, h: 40 },
    draw(c, now) {
      if (!now) return;
      const k = Math.floor(now / period);
      const t = (now % period) / period;
      const fly = 0.45;
      if (t > fly) return;
      const u = t / fly;
      const dir = k % 2 ? -1 : 1;
      const x0 = area.x - 12, x1 = area.x + area.w + 12;
      const x = Math.round(dir > 0 ? x0 + (x1 - x0) * u : x1 - (x1 - x0) * u);
      const top = Math.max(area.y + 6, floorY - 70);
      const yBase = top + hash01(41, k) * Math.max(6, floorY - 50 - top);
      const y = Math.round(yBase + Math.sin(u * 14) * 4);
      const fr = BAT[Math.floor(now / 120) % 2];
      c.sprite(fr, x - 4, y - 2, map, dir < 0);
      void colors[1];
    },
  };
}

/** Water drop forming at (x, top), falling to `floor` and splashing. */
export function dripProp(x: number, top: number, floor: number, colors: [Color, Color, Color], period: number, seed = 0): Prop {
  const [mid, dark, light] = colors;
  return {
    layer: 'far',
    name: 'drip',
    at: { x: x - 5, y: top - 2, w: 11, h: floor - top + 4 },
    draw(c, now) {
      const t = ((now + seed * 733) % period) / period;
      if (!now) {
        c.px(x, top, mid);
        return;
      }
      if (t < 0.45) {
        c.px(x, top, mid);
        if (t > 0.2) c.px(x, top + 1, t > 0.35 ? light : dark);
      } else if (t < 0.75) {
        const u = (t - 0.45) / 0.3;
        const y = Math.round(top + 1 + (floor - top - 1) * u * u);
        c.px(x, y, light);
        c.px(x, y - 1, mid);
      } else if (t < 0.9) {
        const s = Math.floor(((t - 0.75) / 0.15) * 3);
        c.px(x - 1 - s, floor - 1 - (s === 1 ? 1 : 0), light);
        c.px(x + 1 + s, floor - 1 - (s === 1 ? 1 : 0), light);
        if (s === 0) c.px(x, floor - 2, mid);
      }
    },
  };
}

/** A chain hanging from (x, top), swaying like a pendulum (whole pixels). */
export function chainProp(x: number, top: number, len: number, phase: number, colors: [Color, Color, Color] = [P.greyLight, P.grey, P.slate]): Prop {
  return {
    layer: 'mid',
    name: 'chain',
    at: { x: x - 7, y: top - 1, w: 15, h: len + 6 },
    draw(c, now) {
      const th = now ? 0.11 * Math.sin(now / 520 + phase) : 0;
      const sn = Math.sin(th), cs = Math.cos(th);
      for (let s = 0; s <= len; s++) {
        const px = Math.round(x + sn * s), py = Math.round(top + cs * s);
        const link = s % 4;
        if (link === 0) {
          c.px(px - 1, py, colors[2]);
          c.px(px + 1, py, colors[2]);
        } else if (link === 1 || link === 3) {
          c.px(px - 1, py, colors[1]);
          c.px(px + 1, py, colors[2]);
        } else c.px(px, py, colors[0]);
      }
      // shackle at the end
      const ex = Math.round(x + sn * (len + 2)), ey = Math.round(top + cs * (len + 2));
      c.px(ex - 1, ey, colors[1]);
      c.px(ex + 1, ey, colors[2]);
      c.px(ex - 1, ey + 1, colors[1]);
      c.px(ex + 1, ey + 1, colors[2]);
      c.px(ex, ey + 2, colors[2]);
    },
  };
}

/** Drifting, blinking fireflies or sparkles inside an area. */
export function firefliesProp(area: Rect, n: number, seed: number, colors: [Color, Color], layer: 'far' | 'near' = 'near'): Prop {
  return {
    layer,
    name: 'fireflies',
    at: area,
    draw(c, now) {
      for (let i = 0; i < n; i++) {
        const sx = hash01(seed, i, 1), sy = hash01(seed, i, 2);
        const per = 5000 + hash01(seed, i, 3) * 4000;
        const t = (now / per) * Math.PI * 2;
        const x = Math.round(area.x + sx * area.w + Math.sin(t + i) * 6 + Math.sin(t * 2.3 + i * 2) * 2);
        const y = Math.round(area.y + sy * area.h + Math.cos(t * 1.3 + i) * 4);
        const blink = (now + i * 700) % 2600;
        if (now && blink > 1900) continue;
        c.px(x, y, colors[0]);
        if (blink < 500 || !now) {
          c.shade(x - 1, y, -1);
          c.shade(x + 1, y, -1);
          c.shade(x, y - 1, -1);
          c.shade(x, y + 1, -1);
        } else c.px(x + 1, y, colors[1]);
      }
    },
  };
}

export { darker, lighter, fill };
