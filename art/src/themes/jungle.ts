// Lost Jungle: a hollow in a giant tree opens onto layered, hazy jungle with a waterfall and a
// dirt path; log frame wrapped in vines. Props: waterfall, fireflies, swaying vines, a parrot.

import type { Rgba } from '../core/buffer.ts';
import { px as bpx, get as bget } from '../core/buffer.ts';
import { PAL, type Color } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME, ARCH_T } from '../scene/layout.ts';
import type { Prop, ScenePlan, ThemeDef } from './types.ts';
import {
  type Paint, type Opening, put, fill, shade, bayer, ramp, fbm, n1, forRing, forInside, outsideAll, visibleCenterX, capTopAt,
  L_DEEP, L_FLOOR, L_WALL, L_ARCH, L_DECO, L_FRAME, sprite, layerAt,
} from './util.ts';
import { buildPedestals, cylinder, plaque, inTop, PED_TOP } from './pedestal.ts';
import { buildUi } from './ui.ts';
import { forFrame, frameFinish, perspectiveFloor, firefliesProp, shadowRight, spandrels } from './shared.ts';

const P = PAL;

/** A leafy clump test: dense foliage where noise is high. Returns 0 (none) or a shade 1..4. */
function leafShade(seed: number, x: number, y: number, dens: number): number {
  const v = fbm(seed, x / 11, y / 9, 3);
  if (v < dens) return 0;
  // light from the top-left: compare with a sample up-left
  const up = fbm(seed, (x - 2) / 11, (y - 2) / 9, 3);
  const k = v - up;
  if (k < -0.03) return 1; // lit edge
  if (k > 0.05) return 4; // shadowed underside
  return v > dens + 0.12 ? 2 : 3;
}

function paintDeep(p: Paint, plan: ScenePlan): void {
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 24, plan.extras.floorY - 6);
  const cx = visibleCenterX(main, p.w);
  const top = Math.max(0, r.y - 4);
  // hazy light sky band behind everything
  for (let y = 0; y < horizon; y++)
    for (let x = 0; x < p.w; x++) {
      const t = (y - top) / Math.max(1, horizon - top);
      put(p, x, y, ramp([P.lime, P.lime, P.green], t * 1.2, x, y), L_DEEP);
    }
  // far tree line (pale), mid canopy (dark), then near foliage
  for (let x = 0; x < p.w; x++) {
    const far = horizon - 40 - Math.round(fbm(3, x / 22, 0, 3) * 30);
    const mid = horizon - 18 - Math.round(fbm(8, x / 15, 4, 3) * 28);
    for (let y = far; y < horizon; y++) {
      if (y < 0) continue;
      const edge = y - far;
      let c: Color = edge < 1 ? P.lime : P.green;
      if (edge > 1 && hash01(4, x, y) < 0.08) c = P.lime;
      put(p, x, y, c, L_DEEP);
    }
    for (let y = mid; y < horizon; y++) {
      if (y < 0) continue;
      const edge = y - mid;
      let c: Color = edge < 1 ? P.green : edge < 3 ? P.greenDark : (y + x) % 9 === 0 ? P.green : P.greenDark;
      if (edge > 6) c = ramp([P.greenDark, P.tealDark], (edge - 6) / 20, x, y);
      put(p, x, y, c, L_DEEP);
    }
  }
  // background trunks between the layers
  for (let i = 0; i < 6; i++) {
    const tx = Math.round(r.x + (i + 0.5) * (r.w / 6) + (hash01(12, i) - 0.5) * 20);
    if (Math.abs(tx - (cx - 58)) < 18) continue; // keep the waterfall clear
    const tw = 3 + (i % 3);
    for (let y = r.y - 4; y < horizon - 6; y++)
      for (let x = tx; x < tx + tw; x++) {
        if (layerAt(p, x, y) !== L_DEEP) continue;
        const cur = bget(p.b, x, y);
        if (cur === P.greenDark || cur === P.tealDark) continue; // behind the mid canopy
        put(p, x, y, x === tx ? P.green : x === tx + tw - 1 ? P.tealDark : P.greenDark, L_DEEP);
      }
  }
  // waterfall cliff: an irregular mossy outcrop rising from the far canopy
  const wx = Math.round(cx - 58);
  const cliffTop = Math.round(top + (horizon - top) * 0.32);
  for (let y = cliffTop; y < horizon; y++) {
    const k = Math.min(1, (y - cliffTop) / 10);
    const lw = Math.round((12 + fbm(14, y / 9, 1, 2) * 8) * (0.55 + 0.45 * k) + (y - cliffTop) * 0.12), rw = Math.round((14 + fbm(15, y / 8, 2, 2) * 9) * (0.55 + 0.45 * k) + (y - cliffTop) * 0.15);
    for (let x = wx + 6 - lw; x < wx + 6 + rw; x++) {
      const fromL = x - (wx + 6 - lw), fromR = wx + 6 + rw - 1 - x;
      const n = fbm(16, x / 5, y / 7, 2);
      let c: Color = fromL < 3 ? P.green : n > 0.58 ? P.greenDark : n > 0.38 ? P.tealDark : P.black;
      if (fromL < 1 || fromR < 1) c = P.tealDark;
      if (fromL >= 3 && fromL < 6 && n > 0.45) c = P.greenDark;
      if (fromR < 4 && n < 0.5) c = P.black;
      if (hash01(17, x, y) < 0.04 && fromL < 8) c = P.lime;
      if (y - cliffTop < 2) c = y === cliffTop ? P.lime : P.green; // mossy top edge
      put(p, x, y, c, L_DEEP);
    }
  }
  // pool at the base
  for (let y = horizon - 4; y < horizon + 2; y++)
    for (let x = wx - 12; x < wx + 26; x++) put(p, x, y, (x + y) % 3 === 0 ? P.cyan : P.blue, L_DEEP);
  // light shafts from the top-left
  for (let y = top; y < horizon + 30 && y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const u = x - (y - top) * 0.6;
      const band = ((u - r.x) % 70 + 70) % 70;
      if (band < 10 && (1 - band / 10) * 0.4 * (1 - (y - top) / (horizon + 30 - top)) > bayer(x, y)) shade(p, x, y, -1);
    }
  // ground: grass with a dirt path
  perspectiveFloor(p, horizon, cx, (x, y, row, v, u, depth) => {
    const pathHalf = Math.max(2, r.w * 0.03) + depth * Math.min(34, r.w * 0.1);
    const e = pathHalf - Math.abs(x + 0.5 - cx + Math.sin(depth * 5) * 6 * depth);
    let c: Color;
    if (e > 0) {
      c = e < 1.5 ? P.brown : ramp([P.brownLight, P.skinMid], depth, x, y);
      if (hash01(6, x, y) < 0.07) c = P.tan;
      if (hash01(7, x, y) < 0.05) c = P.brown;
    } else {
      const n = fbm(17, u / 10, (y - horizon) / (2 + depth * 6), 3);
      c = n > 0.6 ? P.lime : n > 0.36 ? P.green : P.greenDark;
      if (depth < 0.18 && n < 0.5) c = P.greenDark;
      const tuft = hash01(8, Math.floor(u / 2), Math.floor((y - horizon) / 2));
      if (tuft < 0.05 && c === P.green) c = P.lime;
      const f = hash01(9, x, y);
      if (f < 0.006) c = P.pink;
      else if (f < 0.011) c = P.yellow;
      else if (f < 0.013 && depth > 0.3) c = P.white;
    }
    put(p, x, y, c, L_FLOOR);
  });
  // near foliage hanging into the opening from the top corners
  for (const o of plan.openings)
    forInside(p, o, (x, y, d) => {
      const nearTop = y - capTopAt(o, x);
      if (nearTop > 16 + fbm(21, x / 9, 0) * 14) return;
      const k = leafShade(23, x, y, 0.5 + nearTop / 60);
      if (!k) {
        if (d < 3 && (3 - d) / 3 > bayer(x, y)) shade(p, x, y, 1);
        return;
      }
      put(p, x, y, k === 1 ? P.lime : k === 2 ? P.green : k === 3 ? P.greenDark : P.tealDark, L_DEEP);
    });
}

function paintWall(p: Paint, plan: ScenePlan): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      // giant trunk bark: wavy vertical grooves
      const u = x + fbm(31, x / 40, y / 26, 2) * 10;
      const g = ((Math.floor(u) % 9) + 9) % 9;
      let c: Color = g === 0 ? P.plum : g === 1 ? P.brown : g < 6 ? P.brownLight : g < 8 ? P.brown : P.skinMid;
      if (g >= 2 && g < 6 && hash01(32, x, Math.floor(y / 3)) < 0.12) c = P.brown;
      if (fbm(33, x / 6, y / 30, 2) > 0.7) c = P.plum; // deep cracks
      put(p, x, y, c, L_WALL);
      // moss and leaves over the bark
      const k = leafShade(34, x, y, 0.6 - (y < p.h * 0.35 ? 0.06 : 0));
      if (k) put(p, x, y, k === 1 ? P.lime : k === 2 ? P.green : k === 3 ? P.greenDark : P.tealDark, L_WALL);
    }
  // hanging vines on the wall
  for (let i = 0; i < 9; i++) {
    const vx = Math.round(hash01(35, i) * p.w);
    const len = 30 + Math.round(hash01(36, i) * 60);
    for (let y = FRAME; y < FRAME + len; y++) {
      const x = vx + Math.round(Math.sin(y / 7 + i) * 1.5);
      if (layerAt(p, x, y) !== L_WALL) continue;
      put(p, x, y, P.green, L_WALL);
      if (y % 6 === 0) {
        put(p, x + 1, y, P.lime, L_WALL);
        put(p, x + 2, y + 1, P.green, L_WALL);
      }
      if (y % 6 === 3) {
        put(p, x - 1, y, P.lime, L_WALL);
        put(p, x - 2, y + 1, P.greenDark, L_WALL);
      }
    }
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
  forRing(p, o, T, (x, y, d, cap, ang) => {
    let c: Color;
    if (d < 1) c = P.cream;
    else if (d < 2.2) c = cap && ang < -Math.PI / 2 ? P.tan : P.skinMid; // cut wood rim
    else if (d < 3) c = P.brownLight;
    else if (d >= T - 1) c = P.plum;
    else {
      // bark running along the ring
      const s = cap ? (ang + Math.PI) * 60 : y;
      const g = Math.floor(s / 3 + d * 0.7) % 4;
      c = g === 0 ? P.brown : g === 3 ? P.plum : P.brownLight;
      if (d > T - 2.5) c = P.brown;
    }
    put(p, x, y, c, L_ARCH);
  });
  forRing(p, o, T + 1, (x, y, d) => {
    if (d >= T) put(p, x, y, P.plum, L_ARCH);
  });
  // leaves draped over the cap
  const r = o.rect;
  for (let x = r.x - T; x < r.x + r.w + T; x++) {
    const ty = Math.round(capTopAt(o, x)) - T;
    const len = 4 + Math.round(fbm(41, x / 7, 0, 2) * 10);
    for (let y = ty - 3; y < ty + len; y++) {
      const k = leafShade(42, x, y, 0.38);
      if (!k) continue;
      put(p, x, y, k === 1 ? P.lime : k === 2 ? P.green : k === 3 ? P.greenDark : P.tealDark, L_ARCH);
    }
  }
}

function paintFrame(p: Paint): void {
  forFrame(p, (x, y, side, along, depth, cx, cy) => {
    let c: Color;
    if (side === 'corner') {
      // log end: concentric rings
      const dx = cx - 6.5, dy = cy - 6.5, rr = Math.sqrt(dx * dx + dy * dy);
      if (rr > 7) c = P.plum;
      else if (rr > 6) c = P.brown;
      else if (rr > 5.2) c = P.brownLight;
      else c = Math.floor(rr) % 2 ? P.skinMid : P.tan;
      if (rr < 1) c = P.brown;
      if (rr <= 6 && rr > 1 && dx + dy < -3 && Math.floor(rr) % 2 === 0) c = P.cream;
      put(p, x, y, c, L_FRAME);
      return;
    }
    // a log: shaded across its thickness, lit on the side facing the top-left
    const lit = side === 'top' || side === 'left';
    const t = lit ? depth : FRAME - 1 - depth;
    if (depth === 0 || depth === FRAME - 1) c = P.plum;
    else if (t <= 2) c = P.skinMid;
    else if (t <= 6) c = P.brownLight;
    else if (t <= 10) c = P.brown;
    else c = P.plum;
    // bark streaks
    if (c !== P.plum && hash01(51, Math.floor(along / 5), depth) < 0.18) c = c === P.skinMid ? P.brownLight : P.brown;
    // knots
    const knot = ((along * 7 + depth * 3) % 97) === 0;
    if (knot) c = P.plum;
    // vines wrapping the log
    const vu = (along + depth * (lit ? 1 : -1)) % 34;
    if (vu === 0 || vu === 1) c = vu === 0 ? P.green : P.greenDark;
    if ((vu === 2 || vu === 33) && (depth === 3 || depth === 9)) c = P.lime;
    put(p, x, y, c, L_FRAME);
  });
  frameFinish(p, P.plum);
  // leaf tufts at a few spots on the frame
  const tufts = [[FRAME + 20, 2], [p.w - FRAME - 30, 1], [3, Math.round(p.h / 2)], [p.w - 12, Math.round(p.h * 0.3)]];
  for (const [tx, ty] of tufts)
    sprite(p, ['..gl...', '.gGgl..', 'gGlGGg.', '.dgGgd.', '..dgd..'], tx, ty, { g: P.green, G: P.lime, l: P.lime, d: P.greenDark }, L_FRAME);
}

function paintPillar(p: Paint, r: Rect): void {
  // wooden signboard: plank frame, dark inset, leaves on top
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
      let c: Color;
      if (e === 0) c = P.plum;
      else if (e <= 3) {
        const grain = hash01(61, Math.floor((x + y) / 4), e) < 0.25;
        c = e === 1 ? P.skinMid : grain ? P.brown : P.brownLight;
        if ((y === r.y + 1 || x === r.x + 1) && e === 1) c = P.tan;
      } else if (e === 4) c = P.plum;
      else c = P.plum;
      put(p, x, y, c, L_DECO);
    }
  // dark inset wants a hint of plank seams
  for (let y = r.y + 5; y < r.y + r.h - 5; y += 11) for (let x = r.x + 5; x < r.x + r.w - 5; x++) if (x % 3) put(p, x, y, P.black, L_DECO);
  // nails
  for (const [nx, ny] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) put(p, nx, ny, P.greyLight, L_DECO);
  // leaves over the top corners
  for (const lx of [r.x - 2, r.x + r.w - 9])
    sprite(p, ['..gGg....', '.gGGlgg..', 'gGlGGGgd.', '.dgGgGdd.', '..ddgdd..', '....d....'], lx, r.y - 3, { g: P.green, G: P.lime, l: P.lime, d: P.greenDark }, L_DECO);
  shadowRight(p, r);
}

function paintPlate(p: Paint, r: Rect): void {
  // a plank sign hanging from two vines
  for (const vx of [r.x + 6, r.x + r.w - 7]) for (let y = r.y - 5; y < r.y; y++) put(p, vx + (y % 2), y, P.green, L_DECO);
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
      let c: Color = e === 0 ? P.plum : y === r.y + 1 ? P.tan : y === r.y + r.h - 2 ? P.brown : P.brownLight;
      if (e > 0 && hash01(62, Math.floor(x / 6), y) < 0.12) c = P.brown;
      if (e > 0 && y === r.y + Math.floor(r.h / 2)) c = hash01(63, x) < 0.3 ? P.brown : c;
      put(p, x, y, c, L_DECO);
    }
  shadowRight(p, r);
}

function paintPedestal(b: Rgba): void {
  // tree stump: bark sides, ringed top, moss, roots
  cylinder(b, [P.brownLight, P.brown, P.plum, P.black], [P.cream, P.tan, P.skinMid, P.brown], P.plum, { bottom: 18 });
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 48; x++) {
      if (!inTop(x, y)) continue;
      const dx = (x + 0.5 - 24) / 21, dy = (y + 0.5 - 6) / 5;
      const rr = Math.sqrt(dx * dx + dy * dy);
      if (rr > 0.86) continue;
      const ring = Math.floor(rr * 7);
      bpx(b, x, y, rr < 0.12 ? P.brownLight : ring % 2 ? P.tan : P.skinMid);
      if (rr < 0.86 && dx + dy < -0.5 && ring % 2) bpx(b, x, y, P.cream);
    }
  // bark grooves on the side
  for (let x = 4; x < 44; x += 3)
    for (let y = 11; y < 20; y++) {
      const c = bget(b, x, y);
      if (c !== -1 && hash01(64, x, Math.floor(y / 3)) < 0.6) bpx(b, x, y, c === P.brownLight ? P.brown : P.plum);
    }
  // moss lip
  for (let x = PED_TOP.x + 1; x < PED_TOP.x + PED_TOP.w - 1; x++) {
    const y = 10 + (x % 3 === 0 ? 1 : 0);
    if (hash01(65, x) < 0.75) bpx(b, x, y, hash01(66, x) < 0.4 ? P.lime : P.green);
  }
  plaque(b, P.plum, P.black, P.brownLight);
  // roots
  for (const [rx, dir] of [[3, -1], [44, 1]] as const) {
    bpx(b, rx, 18, P.brown);
    bpx(b, rx + dir, 19, P.brown);
    bpx(b, rx + dir * 2, 20, P.brownLight);
    bpx(b, rx + dir * 2, 21, P.plum);
    bpx(b, rx, 19, P.plum);
  }
  for (let x = 6; x < 42; x++) bpx(b, x, 22, P.greenDark);
}

// ---------------------------------------------------------------- props

function waterfallProp(x: number, top: number, bottom: number): Prop {
  return {
    layer: 'far',
    name: 'waterfall',
    at: { x: x - 6, y: Math.max(top, bottom - 40), w: 24, h: Math.min(40, bottom - top) + 2 },
    draw(c, now) {
      const t = Math.floor(now / 70);
      for (let y = top; y < bottom; y++)
        for (let i = 0; i < 12; i++) {
          const k = (y - t + i * 3 + (i % 3) * 5) % 9;
          const col: Color = k < 2 ? P.white : k < 5 ? P.cyan : k < 7 ? P.blue : P.cyan;
          c.px(x + i + (i > 9 ? 0 : 0), y, i === 0 || i === 11 ? P.blue : col);
        }
      // foam and spray
      for (let s = 0; s < 14; s++) {
        const fx = x - 3 + ((s * 5 + t) % 18);
        const fy = bottom - 1 - ((s * 3 + t * 2) % 4);
        c.px(fx, fy, s % 3 ? P.white : P.cyan);
      }
    },
  };
}

const VINE_LEAF_L = ['.Gg', 'Ggd'];
const VINE_LEAF_R = ['gG.', 'dgG'];
function vineProp(x: number, top: number, len: number, phase: number): Prop {
  return {
    layer: 'mid',
    name: 'vine',
    at: { x: x - 6, y: top, w: 13, h: len + 4 },
    draw(c, now) {
      const sway = now ? Math.sin(now / 900 + phase) : 0;
      for (let s = 0; s < len; s++) {
        const px = Math.round(x + sway * 2.5 * (s / len) + Math.sin(s / 5 + phase) * 1);
        const py = top + s;
        c.px(px, py, s % 4 === 0 ? P.greenDark : P.green);
        if (s % 6 === 2) c.sprite(VINE_LEAF_L, px - 3, py, { G: P.lime, g: P.green, d: P.greenDark });
        if (s % 6 === 5) c.sprite(VINE_LEAF_R, px + 1, py, { G: P.lime, g: P.green, d: P.greenDark });
      }
      const ex = Math.round(x + sway * 2.5), ey = top + len;
      c.sprite(['.p.', 'pPp', '.p.'], ex - 1, ey, { p: P.magenta, P: P.pink }); // a flower at the tip
    },
  };
}

const PARROT = [
  '..rrr...',
  '.rrrrr..',
  'rrwkrrY.',
  'rrrrrYY.',
  '.rrrrr..',
  '.gbrrr..',
  '.gbbrr..',
  '..gbbr..',
  '..gbb...',
  '...bb...',
  '...b.b..',
];
function parrotProp(x: number, y: number, flip: boolean): Prop {
  return {
    layer: 'mid',
    name: 'parrot',
    at: { x: x - 7, y: y - 2, w: 20, h: 16 },
    draw(c, now) {
      const blink = now % 3400 < 160 || (now % 3400 > 400 && now % 3400 < 520 && Math.floor(now / 3400) % 3 === 0);
      const bob = now && Math.floor(now / 2600) % 2 === 0 && now % 2600 < 600 ? 1 : 0;
      const map: Record<string, Color> = { r: P.red, w: blink ? P.red : P.white, k: blink ? P.redDark : P.black, Y: P.gold, g: P.gold, b: P.blue };
      // branch
      for (let i = -6; i < 12; i++) c.px(x + i, y + 11, i % 4 === 0 ? P.brown : P.brownLight);
      for (let i = -6; i < 12; i++) c.px(x + i, y + 12, P.plum);
      c.sprite(PARROT, x, y + bob, map, flip);
      // outline: darken around the body
      for (let j = -1; j <= PARROT.length; j++)
        for (let i = -1; i <= 8; i++) {
          const ii = flip ? 7 - i : i;
          const inside = (jj: number, iii: number) => jj >= 0 && jj < PARROT.length && iii >= 0 && iii < 8 && PARROT[jj][iii] !== '.';
          if (inside(j, ii)) continue;
          const n = inside(j - 1, ii) || inside(j + 1, ii) || inside(j, ii - 1) || inside(j, ii + 1);
          if (n) c.px(x + i, y + j + bob, P.plum);
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
  out.push(waterfallProp(Math.round(cx - 58), Math.round(Math.max(0, r.y - 4) + (horizon - Math.max(0, r.y - 4)) * 0.32) + 1, horizon - 2));
  // vines from the cap
  if (plan.layout.kind !== 'chat') {
    for (const [fx, len, ph] of [[0.12, 26, 0], [0.27, 14, 1.3], [0.75, 18, 2.2], [0.9, 30, 0.7]] as const) {
      const vx = Math.round(r.x + r.w * fx);
      out.push(vineProp(vx, Math.round(capTopAt(main, vx)) - 2, len, ph));
    }
  } else {
    for (const [fx, len, ph] of [[0.18, 34, 0], [0.42, 20, 1.3], [0.7, 26, 2.2]] as const) {
      const x0 = Math.max(r.x, FRAME), x1 = Math.min(r.x + r.w, p.w - FRAME);
      const vx = Math.round(x0 + (x1 - x0) * fx);
      out.push(vineProp(vx, Math.max(FRAME, Math.round(capTopAt(main, vx)) - 2), len, ph));
    }
  }
  // parrot on a spandrel branch (or the chat wall)
  const sp = spandrels(main);
  if (sp.length) out.push(parrotProp(sp[1].x - 6, sp[1].y - 2, true));
  else if (plan.extras.wallSpots.length) out.push(parrotProp(plan.extras.wallSpots[1].x - 4, plan.extras.wallSpots[1].y + 2, true));
  // fireflies inside the opening
  const area = { x: Math.max(r.x, FRAME) + 6, y: Math.max(r.y, FRAME) + 10, w: Math.min(r.w, p.w - 2 * FRAME) - 12, h: Math.max(20, horizon - Math.max(r.y, FRAME)) };
  out.push(firefliesProp(area, 12, 71, [P.yellow, P.lime], 'near'));
  return out;
}

export const jungle: ThemeDef = {
  id: 'jungle',
  name: 'Lost Jungle',
  colors: {
    text: '#ead4aa', textDim: '#c28569', accent: '#fee761', panelText: '#ead4aa',
    bubbleThemText: '#3e2731', bubbleMeText: '#193c3e', bg: '#193c3e', labelText: '#ead4aa', plateText: '#ead4aa', textShadow: '#3e2731',
    good: '#63c74d', bad: '#e43b44',
  },
  archRise: (r, s) => Math.min(Math.round(r.w / 2), Math.max(s + 8, 20)),
  paintDeep,
  paintWall,
  paintArch: (p, o) => paintArch(p, o),
  paintFrame,
  paintPillar: (p, r) => paintPillar(p, r),
  paintPlate,
  props,
  pedestalSprites: () => buildPedestals(paintPedestal, [P.yellow, P.lime, P.green]),
  ui: () =>
    buildUi({
      outline: P.plum,
      panelRim: [P.tan, P.brownLight, P.brown, P.plum],
      panelFill: P.tealDark,
      panelLine: P.black,
      rivet: P.greyLight,
      button: [P.tan, P.brownLight, P.brown, P.plum],
      primary: [P.yellow, P.lime, P.green, P.greenDark],
      yes: [P.lime, P.green, P.greenDark, P.tealDark],
      no: [P.pink, P.red, P.redDark, P.plum],
      bubbleThem: { fill: P.cream, shade: P.tan, line: P.plum },
      bubbleMe: { fill: P.lime, shade: P.green, line: P.tealDark },
      plate: [P.tan, P.brownLight, P.brown, P.plum],
      plateFill: P.brownLight,
    }),
  fuse: { rope: [P.tan, P.skinMid], burnt: P.brown },
  glow: [P.yellow, P.lime, P.green],
};

void n1; void fill;
