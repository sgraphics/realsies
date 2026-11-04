// Crystal Cave: a jagged cave mouth in blue-grey rock opens onto a deep purple cavern with glowing
// crystals, stalactites and a lava pool. Props: crystal pulse, stalactite drips, lava bubbles, a bat.

import type { Rgba } from '../core/buffer.ts';
import { px as bpx, get as bget } from '../core/buffer.ts';
import { PAL, type Color } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME, ARCH_T } from '../scene/layout.ts';
import type { Prop, ScenePlan, ThemeDef } from './types.ts';
import {
  type Paint, type Opening, put, shade, bayer, ramp, fbm, n1, boulder, forRing, forInside, outsideAll, visibleCenterX, capTopAt,
  L_DEEP, L_FLOOR, L_WALL, L_ARCH, L_DECO, L_FRAME, glow, layerAt, insideOpening,
} from './util.ts';
import { buildPedestals, cylinder } from './pedestal.ts';
import { buildUi } from './ui.ts';
import { forFrame, frameFinish, perspectiveFloor, shadowRight, batProp, dripProp } from './shared.ts';

const P = PAL;

/** A crystal cluster: 3 shards, colours [light, mid, dark]. Returns the shard tips for glows. */
function crystal(p: Paint, x: number, y: number, size: number, col: [Color, Color, Color], layer: number, flip = false): void {
  const shards: [number, number, number][] = [[0, size, 3], [-4, Math.round(size * 0.65), 2], [4, Math.round(size * 0.75), 2]];
  for (const [dx0, h, hw] of shards) {
    const dx = flip ? -dx0 : dx0;
    for (let j = 0; j < h; j++) {
      const w = j < 2 ? 0 : Math.min(hw, Math.ceil((j / h) * hw * 2));
      for (let i = -w; i <= w; i++) {
        const c: Color = i < 0 ? col[0] : i === 0 ? (j < 2 ? P.white : col[0]) : i < w ? col[1] : col[2];
        put(p, x + dx + i, y - h + j, c, layer);
      }
    }
  }
}

function paintDeep(p: Paint, plan: ScenePlan): void {
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 24, plan.extras.floorY - 6);
  const cx = visibleCenterX(main, p.w);
  const top = Math.max(0, r.y);
  // cavern depth: far wall of big dark boulders, then ridges rising from the floor
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const k = boulder(121, x, y, 30, 1.4, 22);
      const t = Math.max(0, Math.min(1, (y - top) / Math.max(1, horizon - top)));
      let c: Color = k === 0 ? P.black : k === 1 ? P.purple : k === 3 ? ((x + y) & 1 ? P.black : P.plum) : P.plum;
      if (k === 1 && t < 0.35 && (x + y) & 1) c = P.plum; // far top stays dim
      if (k === 2 && t > 0.7 && bayer(x, y) < (t - 0.7) * 2) c = P.purple; // warm light near the floor
      put(p, x, y, c, L_DEEP);
    }
  for (let x = 0; x < p.w; x++) {
    const hgt = Math.round(fbm(123, x / 24, 1, 3) * 44) + 4;
    for (let y = horizon - hgt; y < horizon; y++) {
      const k = boulder(124, x, y, 14, 1.0, 10);
      const edge = y - (horizon - hgt);
      let c: Color = k === 0 ? P.plum : k === 1 ? P.magenta : k === 3 ? P.plum : P.purple;
      if (edge < 1) c = P.magenta;
      put(p, x, y, c, L_DEEP);
    }
  }
  // stalactites from the ceiling of the cavern
  for (let i = 0; i < Math.floor(r.w / 14); i++) {
    const sx = Math.round(r.x + (i + 0.5) * 14 + (hash01(125, i) - 0.5) * 8);
    const len = 6 + Math.round(hash01(126, i) * 20);
    const t0 = Math.round(capTopAt(main, sx));
    for (let j = 0; j < len; j++) {
      const w = Math.max(0, Math.round((1 - j / len) * 3));
      for (let k = -w; k <= w; k++) put(p, sx + k, t0 + j, k < 0 ? P.magenta : k === 0 ? P.purple : P.plum, L_DEEP);
    }
  }
  // big glowing crystal clusters in the far walls
  const vis = Math.min(r.w, p.w - 2 * FRAME);
  const spots: [number, number, number, boolean][] = [
    [cx - vis * 0.4, horizon + 1, 24, false],
    [cx - vis * 0.13, horizon - 12, 13, true],
    [cx + vis * 0.17, horizon - 8, 16, false],
    [cx + vis * 0.43, horizon + 1, 26, true],
  ];
  for (const [x, y, s, pink] of spots) {
    glow(p, x, y - s / 2, s * 1.8, 2, [L_DEEP]);
    crystal(p, Math.round(x), Math.round(y), s, pink ? [P.pink, P.magenta, P.purple] : [P.cyan, P.blue, P.blueDark], L_DEEP, pink);
  }
  // floor: rough rock with crystal shards and a lava pool in the middle distance
  perspectiveFloor(p, horizon, cx, (x, y, row, v, u, depth) => {
    const s = depth + 0.12;
    const X = (x + 0.5 - cx) / s / 3.2, Z = 26 / s;
    const k = boulder(127, Math.round(X), Math.round(Z), 13, 1.0, 9);
    let c: Color = k === 0 ? P.navyDark : k === 1 ? P.slate : k === 3 ? P.navyDark : P.navy;
    if (depth < 0.15 && c === P.slate) c = P.navy;
    if (hash01(128, x, y) < 0.0025) c = P.cyan;
    void row; void v; void u;
    put(p, x, y, c, L_FLOOR);
  });
  // a lava stream across the far floor
  const ly = horizon + 1;
  for (let x = 0; x < p.w; x++) {
    const wob = Math.round(Math.sin(x / 17) * 1.2 + Math.sin(x / 7.3) * 0.6);
    for (let k = 0; k < 4; k++) {
      const y = ly + wob + k;
      const c: Color = k === 0 ? P.redDark : k === 3 ? P.rust : (x + k * 3) % 7 === 0 ? P.yellow : k === 1 ? P.orange : P.red;
      put(p, x, y, c, L_FLOOR);
    }
  }
  for (let x = 0; x < p.w; x += 3) glow(p, x, ly + 1, 7, 1, [L_DEEP, L_FLOOR], 1.7);
  // ambient occlusion inside the mouth
  for (const o of plan.openings)
    forInside(p, o, (x, y, d) => {
      if (d < 5 && (5 - d) / 5 > bayer(x, y)) shade(p, x, y, 1);
    });
  void top;
}

function rockColor(x: number, y: number, seed: number, size = 15): Color {
  const k = boulder(seed, x, y, size, 1.1, Math.round(size * 0.8));
  if (k === 0) return P.black;
  const n = hash01(seed + 5, Math.floor(x / 3), Math.floor(y / 3));
  if (k === 1) return n < 0.15 ? P.slate : P.grey;
  if (k === 3) return P.navyDark;
  return n < 0.1 ? P.navyDark : P.slate === P.slate && n > 0.9 ? P.grey : P.slate;
}

function paintWall(p: Paint, plan: ScenePlan): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      put(p, x, y, rockColor(x, y, 131), L_WALL);
    }
  // crystal veins in the wall
  for (let i = 0; i < 10; i++) {
    const x = Math.round(FRAME + 10 + hash01(132, i) * (p.w - 2 * FRAME - 20));
    const y = Math.round(FRAME + 20 + hash01(133, i) * (p.h - 2 * FRAME - 30));
    if (layerAt(p, x, y) !== L_WALL || layerAt(p, x, y - 10) !== L_WALL) continue;
    glow(p, x, y - 4, 9, 1, [L_WALL]);
    crystal(p, x, y, 6 + (i % 3) * 2, i % 2 ? [P.pink, P.magenta, P.purple] : [P.cyan, P.blue, P.blueDark], L_WALL, i % 2 === 0);
  }
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const e = Math.min(x, y, p.w - 1 - x, p.h - 1 - y) - FRAME;
      if (e < 12 && (12 - e) / 16 > bayer(x, y)) shade(p, x, y, 1);
    }
}

function paintArch(p: Paint, o: Opening): void {
  const T = ARCH_T;
  forRing(p, o, T, (x, y, d) => {
    let c: Color;
    if (d < 1) c = P.black;
    else if (d < 2.5) c = P.grey; // lit rim of the cave mouth
    else if (d >= T - 1.2) c = P.navyDark;
    else {
      c = rockColor(x, y, 141);
      if (c === P.navyDark) c = P.navy;
      if (d < 4 && c === P.navy) c = P.slate;
    }
    put(p, x, y, c, L_ARCH);
  });
}

function paintFrame(p: Paint): void {
  forFrame(p, (x, y, side, along, depth) => {
    const k = boulder(151, x, y, 11, 1.2, 9);
    let c: Color = k === 0 ? P.black : k === 1 ? P.slate : k === 3 ? P.black : P.navy;
    if (k === 2 && hash01(152, Math.floor(x / 2), Math.floor(y / 2)) < 0.12) c = P.navyDark;
    if (depth === 0) c = P.black;
    void side; void along;
    put(p, x, y, c, L_FRAME);
  });
  frameFinish(p, P.black);
  // crystal clusters breaking out of the corners
  const F = FRAME;
  const corners: [number, number, boolean, boolean][] = [[F + 2, F + 4, false, false], [p.w - F - 3, F + 4, true, false], [F + 3, p.h - 3, false, true], [p.w - F - 4, p.h - 3, true, true]];
  for (const [x, y, flip, pink] of corners) crystal(p, x, y, pink ? 12 : 10, pink ? [P.pink, P.magenta, P.purple] : [P.cyan, P.blue, P.blueDark], L_FRAME, flip);
}

function paintPillar(p: Paint, r: Rect): void {
  // a rock slab with a dark polished face and crystal studs
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y) + Math.round((n1(161, (x + y) / 5) - 0.5) * 2);
      let c: Color;
      if (e <= 0) c = P.black;
      else if (e <= 3) c = rockColor(x, y, 162);
      else if (e === 4) c = P.black;
      else c = P.navyDark;
      put(p, x, y, c, L_DECO);
    }
  for (const [cx, cy] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) {
    put(p, cx, cy, P.cyan, L_DECO);
    put(p, cx, cy - 1, P.white, L_DECO);
  }
  shadowRight(p, r);
}

function paintPlate(p: Paint, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
      const c: Color = e === 0 ? P.black : e === 1 ? (y === r.y + 1 ? P.cyan : P.blue) : P.navyDark;
      put(p, x, y, c, L_DECO);
    }
  for (const sx of [r.x - 3, r.x + r.w + 1]) {
    put(p, sx + 1, r.y + 3, P.cyan, L_DECO);
    put(p, sx + 1, r.y + 4, P.blue, L_DECO);
    put(p, sx, r.y + 5, P.blue, L_DECO);
    put(p, sx + 1, r.y + 5, P.cyan, L_DECO);
    put(p, sx + 2, r.y + 5, P.blueDark, L_DECO);
  }
  shadowRight(p, r);
}

function paintPedestal(b: Rgba): void {
  cylinder(b, [P.slate, P.navy, P.navyDark, P.black], [P.grey, P.slate, P.navy, P.navyDark], P.black);
  // rough facets
  for (let y = 10; y < 20; y++)
    for (let x = 2; x < 46; x++) {
      const c = bget(b, x, y);
      if (c === -1 || c === P.black) continue;
      const n = fbm(171, x / 4, y / 3, 2);
      if (n > 0.66) bpx(b, x, y, P.slate);
      else if (n < 0.3) bpx(b, x, y, P.navyDark);
    }
  // glowing veins in the rock face
  for (const [x, y] of [[12, 12], [13, 13], [14, 13], [30, 12], [31, 12], [32, 13], [22, 14]]) bpx(b, x, y, P.blue);
  // crystal shards on the sides
  const shard = (x: number, y: number, h: number, pink: boolean) => {
    for (let j = 0; j < h; j++) {
      bpx(b, x, y - j, j === h - 1 ? P.white : pink ? P.pink : P.cyan);
      if (j < h - 2) bpx(b, x + 1, y - j, pink ? P.magenta : P.blue);
    }
  };
  shard(2, 17, 6, false);
  shard(4, 18, 4, false);
  shard(43, 17, 5, true);
  for (let x = 0; x < 48; x++) {
    const e = Math.min(x, 47 - x);
    if (e < 1) continue;
    bpx(b, x, 20, P.navyDark);
    bpx(b, x, 21, e < 3 ? P.black : P.navy);
    bpx(b, x, 22, P.black);
  }
}

// ---------------------------------------------------------------- props

function crystalPulseProp(spots: [number, number, number][]): Prop {
  return {
    layer: 'mid',
    name: 'crystals',
    lit: true,
    at: spots.length ? { x: spots[0][0] - 14, y: spots[0][1] - spots[0][2] - 12, w: 28, h: spots[0][2] + 16 } : undefined,
    draw(c, now) {
      if (!now) return;
      spots.forEach(([x, y, s], i) => {
        const t = (Math.sin(now / 700 + i * 1.7) + 1) / 2;
        if (t > 0.35) c.glow(x, y - s / 2, 4 + t * s * 0.9, 1);
        if (t > 0.92) {
          c.px(x, y - s - 1, P.white);
          c.px(x - 1, y - s, P.cyan);
          c.px(x + 1, y - s, P.cyan);
        }
      });
    },
  };
}

function lavaProp(x0: number, x1: number, y: number): Prop {
  return {
    layer: 'far',
    name: 'lava',
    lit: true,
    at: { x: x0 + 20, y: y - 8, w: 80, h: 14 },
    draw(c, now) {
      if (!now) return;
      // flowing highlights along the stream
      const t = Math.floor(now / 90);
      for (let x = x0; x < x1; x++) {
        const wob = Math.round(Math.sin(x / 17) * 1.2 + Math.sin(x / 7.3) * 0.6);
        if ((x + t) % 11 === 0) c.px(x, y + wob + 1, P.yellow);
        if ((x + t * 2) % 17 === 0) c.px(x, y + wob + 2, P.gold);
      }
      for (let i = 0; i < 6; i++) {
        const per = 1500 + i * 370;
        const ph = ((now + i * 611) % per) / per;
        const k = Math.floor((now + i * 611) / per);
        const bx = Math.round(x0 + 6 + hash01(181, i, k) * (x1 - x0 - 12));
        const wob = Math.round(Math.sin(bx / 17) * 1.2 + Math.sin(bx / 7.3) * 0.6);
        const by = y + wob;
        if (ph < 0.5) {
          c.px(bx, by + 1, P.yellow);
          if (ph > 0.25) {
            c.px(bx - 1, by, P.orange);
            c.px(bx + 1, by, P.orange);
            c.px(bx, by - 1, P.yellow);
          }
        } else if (ph < 0.65) {
          c.px(bx - 1, by - 1, P.orange);
          c.px(bx + 1, by - 1, P.orange);
          c.px(bx, by - 2, P.gold);
        } else if (ph < 0.8) c.px(bx, by - 4, P.rust);
      }
    },
  };
}

function props(p: Paint, plan: ScenePlan): Prop[] {
  const out: Prop[] = [];
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 24, plan.extras.floorY - 6);
  const cx = visibleCenterX(main, p.w);
  const vis = Math.min(r.w, p.w - 2 * FRAME);
  // wall crystals to pulse (re-found from the wall layout: put a few new ones near the opening)
  const pulse: [number, number, number][] = [];
  const cands: [number, number][] = [[r.x - ARCH_T - 6, r.y + 30], [r.x + r.w + ARCH_T + 5, r.y + 40], [FRAME + 8, p.h - FRAME - 12], [p.w - FRAME - 10, FRAME + 30]];
  for (const [x, y] of cands) {
    if (layerAt(p, x, y) !== L_WALL || layerAt(p, x, y - 12) !== L_WALL || insideOpening(main, x, y)) continue;
    crystal(p, x, y, 9, [P.cyan, P.blue, P.blueDark], L_DECO);
    pulse.push([x, y, 9]);
  }
  const deepSpots: [number, number, number][] = [[cx - vis * 0.4, horizon + 1, 24], [cx + vis * 0.43, horizon + 1, 26]];
  for (const s of deepSpots) pulse.push([Math.round(s[0]), Math.round(s[1]), s[2]]);
  out.push(crystalPulseProp(pulse));
  // drips from stalactite tips
  for (let i = 0; i < Math.floor(r.w / 14); i += 3) {
    const sx = Math.round(r.x + (i + 0.5) * 14 + (hash01(125, i) - 0.5) * 8);
    const len = 6 + Math.round(hash01(126, i) * 20);
    const t0 = Math.round(capTopAt(main, sx));
    if (sx < FRAME + 4 || sx > p.w - FRAME - 4) continue;
    out.push(dripProp(sx, t0 + len, horizon + 10 + (i % 4) * 6, [P.cyan, P.blue, P.white], 2300 + i * 260, i));
  }
  out.push(lavaProp(Math.max(FRAME, r.x), Math.min(p.w - FRAME, r.x + r.w), horizon + 1));
  out.push(batProp(r, plan.extras.floorY, 7600, [P.black, P.plum, P.cyan]));
  return out;
}

export const cave: ThemeDef = {
  id: 'cave',
  name: 'Crystal Cave',
  colors: {
    text: '#c0cbdc', textDim: '#8b9bb4', accent: '#2ce8f5', panelText: '#c0cbdc',
    bubbleThemText: '#181425', bubbleMeText: '#181425', bg: '#181425', labelText: '#c0cbdc', plateText: '#2ce8f5', textShadow: '#181425',
    good: '#63c74d', bad: '#e43b44',
  },
  archRise: (r, s) => Math.min(Math.round(r.w / 2), Math.max(s + 4, 18)),
  jag: 3,
  paintDeep,
  paintWall,
  paintArch: (p, o) => paintArch(p, o),
  paintFrame,
  paintPillar: (p, r) => paintPillar(p, r),
  paintPlate,
  props,
  pedestalSprites: () => buildPedestals(paintPedestal, [P.white, P.cyan, P.blue]),
  ui: () =>
    buildUi({
      outline: P.black,
      panelRim: [P.grey, P.slate, P.navy, P.navyDark],
      panelFill: P.navyDark,
      panelLine: P.black,
      rivet: P.cyan,
      button: [P.grey, P.slate, P.navy, P.navyDark],
      primary: [P.white, P.cyan, P.blue, P.blueDark],
      yes: [P.lime, P.green, P.greenDark, P.tealDark],
      no: [P.pink, P.red, P.redDark, P.plum],
      bubbleThem: { fill: P.greyLight, shade: P.grey, line: P.black },
      bubbleMe: { fill: P.cyan, shade: P.blue, line: P.blueDark },
      plate: [P.cyan, P.blue, P.blueDark, P.black],
      plateFill: P.navyDark,
    }),
  fuse: { rope: [P.tan, P.skinMid], burnt: P.navy },
  glow: [P.white, P.cyan, P.blue],
};

void ramp;
