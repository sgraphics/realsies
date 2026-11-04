// Desert Tomb: a temple doorway with a painted cornice and a cartouche opens onto a dusk sky,
// a pulsing sun, pyramids and dunes. Props: sun pulse, braziers, sand drift, a scarab walking.

import type { Rgba } from '../core/buffer.ts';
import { px as bpx, get as bget } from '../core/buffer.ts';
import { PAL, type Color } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME, ARCH_T } from '../scene/layout.ts';
import type { Prop, ScenePlan, ThemeDef } from './types.ts';
import {
  type Paint, type Opening, put, shade, bayer, ramp, fbm, forRing, outsideAll, visibleCenterX, brickAt,
  L_DEEP, L_FLOOR, L_WALL, L_ARCH, L_DECO, L_FRAME, sprite, layerAt,
} from './util.ts';
import { buildPedestals, cylinder, plaque, inTop } from './pedestal.ts';
import { buildUi } from './ui.ts';
import { forFrame, frameFinish, perspectiveFloor, shadowRight, paintBrazier, brazierProp, cornerBoss } from './shared.ts';

const P = PAL;

const SKY: Color[] = [P.purple, P.purple, P.magenta, P.pink, P.orange, P.gold, P.yellow];

function sunOf(plan: ScenePlan, w: number): { x: number; y: number; r: number } {
  const main = plan.openings[0];
  const horizon = Math.max(main.rect.y + 30, plan.extras.floorY - 8);
  const cx = visibleCenterX(main, w);
  const vis = Math.min(main.rect.w, w - 2 * FRAME);
  return { x: Math.round(cx + vis * 0.18), y: horizon - 4, r: Math.max(10, Math.min(26, Math.round(vis * 0.07))) };
}

function paintDeep(p: Paint, plan: ScenePlan): void {
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 30, plan.extras.floorY - 8);
  const cx = visibleCenterX(main, p.w);
  const top = Math.max(0, r.y);
  // dusk sky, banded with ordered dither
  for (let y = 0; y < horizon; y++)
    for (let x = 0; x < p.w; x++) put(p, x, y, ramp(SKY, (y - top) / Math.max(1, horizon - top), x, y), L_DEEP);
  // a few early stars at the top
  for (let i = 0; i < 40; i++) {
    const sx = Math.round(hash01(81, i) * p.w), sy = Math.round(top + hash01(82, i) * (horizon - top) * 0.35);
    if (layerAt(p, sx, sy) === L_DEEP) put(p, sx, sy, i % 5 ? P.pink : P.white, L_DEEP);
  }
  // sun disc
  const sun = sunOf(plan, p.w);
  for (let y = sun.y - sun.r; y <= sun.y; y++)
    for (let x = sun.x - sun.r; x <= sun.x + sun.r; x++) {
      const dx = x + 0.5 - sun.x, dy = y + 0.5 - sun.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d > sun.r) continue;
      // retro bands cut into the lower half
      const band = y > sun.y - sun.r * 0.45 && (sun.y - y) % 4 === 0;
      let c: Color = d > sun.r - 1.5 ? P.gold : d < sun.r * 0.55 ? P.white : P.yellow;
      if (band) c = P.orange;
      put(p, x, y, c, L_DEEP);
    }
  // pyramids
  const vis = Math.min(r.w, p.w - 2 * FRAME);
  const pyr: [number, number][] = [[cx - vis * 0.22, vis * 0.11], [cx - vis * 0.02, vis * 0.07], [cx + vis * 0.36, vis * 0.05]];
  for (const [pxc, half] of pyr) {
    const h0 = Math.round(half * 0.9);
    for (let y = horizon - h0; y < horizon; y++) {
      const k = (y - (horizon - h0)) / h0;
      const hw = Math.round(half * k);
      for (let x = Math.round(pxc) - hw; x <= Math.round(pxc) + hw; x++) {
        const lit = x <= pxc;
        let c: Color = lit ? P.tan : P.rust;
        if ((horizon - y) % 3 === 0) c = lit ? P.skinMid : P.brown; // stepped courses
        if (lit && x === Math.round(pxc) - hw) c = P.cream;
        if (y === horizon - h0) c = P.gold; // capstone
        put(p, x, y, c, L_DEEP);
      }
    }
  }
  // palms
  for (const [tx, s] of [[cx - vis * 0.4, 1], [cx + vis * 0.24, 0.8]] as const) {
    const bx = Math.round(tx), h = Math.round(16 * s);
    for (let i = 0; i < h; i++) put(p, bx + Math.round(Math.sin(i / 6) * 2), horizon - i, i % 3 ? P.brown : P.plum, L_DEEP);
    const topY = horizon - h;
    const tipX = bx + Math.round(Math.sin(h / 6) * 2);
    for (const [dx, dy, len] of [[-1, 0, 7], [1, 0, 7], [-1, -1, 5], [1, -1, 5], [-1, 1, 5], [1, 1, 5]] as const)
      for (let i = 1; i <= len * s; i++) put(p, tipX + dx * i, topY + Math.round(dy * i * 0.4 + (i * i) / 14), i > len * s - 2 ? P.greenDark : P.tealDark, L_DEEP);
  }
  // dunes and sand floor
  perspectiveFloor(p, horizon, cx, (x, y, row, v, u, depth) => {
    const wave = Math.sin(u / 11 + Math.sin(u / 29) * 1.6 + (y - horizon) * 0.42) * 0.5 + 0.5;
    const t = depth * 0.95 + wave * 0.12;
    let c: Color = t < 0.16 ? P.rust : t < 0.42 ? P.clay : t < 0.86 ? P.tan : P.skinMid;
    if (wave > 0.95 && depth > 0.25 && depth < 0.85) c = P.cream; // thin ripple crests
    if (wave < 0.05 && depth > 0.3) c = depth > 0.8 ? P.brownLight : P.skinMid;
    // stone causeway
    const half = Math.max(2, r.w * 0.03) + depth * Math.min(36, r.w * 0.1);
    const e = half - Math.abs(x + 0.5 - cx);
    if (e > 0) {
      const slab = (Math.floor(u / 10) + row) & 1;
      c = v === 0 || e < 1 ? P.brownLight : slab ? P.cream : P.tan;
      if (e < 1) c = P.skinMid;
    }
    void row;
    put(p, x, y, c, L_FLOOR);
  });
  // heat-haze line at the horizon
  for (let x = 0; x < p.w; x++) if ((x >> 1) % 3 === 0) put(p, x, horizon, P.gold, L_FLOOR);
}

const GLYPHS = [
  ['.b.', 'bbb', '.b.', '.b.'], // ankh-ish
  ['rr.', 'r..', 'rrr', '..r'],
  ['.g.', 'ggg', 'g.g', '...'],
  ['b.b', 'bbb', '.b.', 'bbb'],
  ['.r.', 'r.r', '.r.', 'rrr'],
  ['ggg', '.g.', 'g.g', 'ggg'],
  ['b..', 'bb.', 'bbb', 'b..'], // bird-ish
  ['.k.', 'kkk', 'k.k', '.k.'], // eye
];
const GMAP: Record<string, Color> = { b: P.blueDark, r: P.redDark, g: P.green, k: P.plum };

function paintWall(p: Paint, plan: ScenePlan): void {
  const bandY0 = FRAME + 30, bandH = 12;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const b = brickAt(x, y, 24, 12);
      const n = hash01(91, b.bx, b.by);
      let c: Color;
      if (b.u === 0 || b.v === 0) c = P.brownLight;
      else {
        const tone = n < 0.2 ? 0 : n > 0.85 ? 2 : 1;
        const fillC = tone === 0 ? P.skinMid : tone === 2 ? P.cream : P.tan;
        c = b.v === 1 ? (tone === 2 ? P.white : P.cream) : b.v === 11 || b.u === 23 ? (tone === 0 ? P.brownLight : P.skinMid) : fillC;
        if (hash01(92, x, y) < 0.05) c = tone === 0 ? P.brownLight : P.skinMid;
      }
      put(p, x, y, c, L_WALL);
    }
  // carved glyphs on some blocks
  for (let by = 0; by < Math.ceil(p.h / 12); by++)
    for (let bx = 0; bx < Math.ceil(p.w / 24) + 1; bx++) {
      if (hash01(93, bx, by) > 0.22) continue;
      const off = by & 1 ? 12 : 0;
      const x0 = bx * 24 - off + 6, y0 = by * 12 + 4;
      for (let k = 0; k < 3; k++) {
        const g = GLYPHS[Math.floor(hash01(94, bx * 3 + k, by) * GLYPHS.length)];
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 3; i++)
            if (g[j][i] !== '.' && layerAt(p, x0 + k * 4 + i, y0 + j) === L_WALL) put(p, x0 + k * 4 + i, y0 + j, P.brownLight, L_WALL);
      }
    }
  // painted frieze band
  for (let y = bandY0; y < bandY0 + bandH; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const v = y - bandY0;
      let c: Color = v === 0 || v === bandH - 1 ? P.brown : v === 1 || v === bandH - 2 ? P.gold : P.cream;
      if (v >= 3 && v <= bandH - 4) {
        const cell = Math.floor(x / 7), cu = x % 7;
        const g = GLYPHS[cell % GLYPHS.length];
        if (cu >= 2 && cu < 5 && v - 3 < 4 && g[v - 3][cu - 2] !== '.') c = GMAP[g[v - 3][cu - 2]];
      }
      put(p, x, y, c, L_WALL);
    }
  // warm light from the doorway onto the wall
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const e = Math.min(x, y, p.w - 1 - x, p.h - 1 - y) - FRAME;
      if (e < 12 && (12 - e) / 16 > bayer(x, y)) shade(p, x, y, 1);
    }
}

function paintArch(p: Paint, o: Opening): void {
  const T = ARCH_T;
  const r = o.rect;
  forRing(p, o, T, (x, y, d) => {
    let c: Color;
    const isLintel = y < r.y;
    if (d >= T - 1) c = P.brown;
    else if (isLintel) {
      // cavetto cornice: painted vertical feathers over a torus moulding
      const v = Math.floor(d);
      if (v <= 1) c = v === 0 ? P.brown : (x >> 1) % 2 ? P.redDark : P.gold;
      else if (v === 2) c = P.brownLight;
      else {
        const k = Math.floor(x / 2) % 4;
        c = k === 0 ? P.blueDark : k === 1 ? P.cream : k === 2 ? P.redDark : P.gold;
        if (v === T - 2) c = P.cream;
      }
    } else {
      // jamb: cream stone with a column of glyphs between brown rules
      const v = Math.floor(d);
      if (v === 0) c = P.brownLight;
      else if (v === 1 || v === T - 2) c = P.gold;
      else {
        c = P.cream;
        const gi = Math.floor((y - r.y) / 6);
        const g = GLYPHS[(gi + (x < r.x ? 0 : 3)) % GLYPHS.length];
        const gy = (y - r.y) % 6, gx = v - 2;
        if (gy < 4 && gx >= 0 && gx < 3 && g[gy][gx] !== '.') c = GMAP[g[gy][gx]];
        if (gy === 5) c = P.tan;
      }
    }
    put(p, x, y, c, L_ARCH);
  });
  forRing(p, o, T + 1, (x, y, d) => {
    if (d >= T) put(p, x, y, P.brown, L_ARCH);
  });
  // winged sun across the lintel centre
  const cx = Math.round(r.x + r.w / 2), ly = r.y - T + 1;
  for (let i = 0; i < 46; i++) {
    for (const s of [-1, 1]) {
      const x = cx + s * (6 + i);
      const span = Math.max(1, 4 - Math.floor(i / 12));
      for (let j = 0; j < span; j++) put(p, x, ly + 1 + j + Math.floor(i / 16), j === 0 ? P.gold : i % 3 === 0 ? P.blueDark : P.blue, L_ARCH);
    }
  }
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (x * x + y * y <= 10) put(p, cx + x, ly + 3 + y, x * x + y * y > 6 ? P.orange : P.red, L_ARCH);
}

function paintFrame(p: Paint): void {
  forFrame(p, (x, y, side, along, depth, cx, cy) => {
    if (side === 'corner') {
      const m = cornerBoss(cx, cy, [P.blue, P.blueDark, P.navyDark, P.brown], [P.yellow, P.gold, P.orange]);
      put(p, x, y, m, L_FRAME);
      return;
    }
    const lit = side === 'top' || side === 'left';
    const bw = 28;
    const off = side === 'bottom' || side === 'right' ? 14 : 0;
    const u = (along + off) % bw;
    let c: Color;
    if (depth === 0 || depth === FRAME - 1) c = P.brown;
    else if (depth === FRAME - 3) c = P.gold; // inner gold trim
    else if (depth === FRAME - 2) c = P.blueDark; // lapis inlay
    else if (depth === FRAME - 4) c = P.orange;
    else if (u === 0) c = P.brownLight;
    else {
      const t = lit ? depth : FRAME - 1 - depth;
      c = u === 1 || t <= 1 ? P.cream : u === bw - 1 || t >= 8 ? P.skinMid : P.tan;
      // a cartouche ring on every other block
      const id = Math.floor((along + off) / bw);
      if (id % 2 === 0 && depth >= 3 && depth <= 8) {
        const cu = u - bw / 2, cv = depth - 5.5;
        const ell = (cu * cu) / 64 + (cv * cv) / 9;
        if (ell > 0.7 && ell < 1.15) c = P.brownLight;
        if (ell < 0.45 && (u + depth) % 3 === 0) c = P.blueDark;
      }
    }
    put(p, x, y, c, L_FRAME);
  });
  frameFinish(p, P.brown);
}

function paintPillar(p: Paint, r: Rect): void {
  if (r.w > r.h * 1.3) {
    // a painted stele lying across: lapis inset in sandstone with gold rules
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
        const c: Color = e === 0 ? P.brown : e === 1 ? (y === r.y + 1 ? P.cream : P.tan) : e === 2 ? P.gold : e === 3 ? P.brown : P.blueDark;
        put(p, x, y, c, L_DECO);
      }
    shadowRight(p, r);
    return;
  }
  const capH = 12, baseH = 6;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const yy = y - r.y, fb = r.y + r.h - 1 - y;
      let x0 = r.x, x1 = r.x + r.w - 1;
      let c: Color;
      if (yy < capH) {
        // papyrus capital flaring upward
        const flare = Math.round((capH - yy) * 0.25);
        x0 = r.x + 3 - flare;
        x1 = r.x + r.w - 4 + flare;
        if (x < x0 || x > x1) continue;
        if (yy === 0 || x === x0 || x === x1) c = P.brown;
        else if (yy < 3) c = P.gold;
        else {
          const k = Math.floor((x - x0) / 4) % 3;
          c = k === 0 ? P.green : k === 1 ? P.blue : P.cream;
          if ((x - x0) % 4 === 0) c = P.brownLight;
          if (yy === capH - 1) c = P.brown;
        }
      } else if (fb < baseH) {
        if (x < x0 + 1 || x > x1 - 1) continue;
        c = fb === 0 || x === x0 + 1 || x === x1 - 1 ? P.brown : fb === baseH - 1 ? P.cream : P.tan;
      } else {
        x0 = r.x + 3;
        x1 = r.x + r.w - 4;
        if (x < x0 || x > x1) continue;
        const sx = x - x0, sw = x1 - x0 + 1;
        if (sx === 0 || sx === sw - 1) c = P.brown;
        else if (sx < 4 || sx > sw - 5) c = sx === 1 ? P.cream : sx === sw - 2 ? P.skinMid : P.tan;
        else {
          const py = y - (r.y + capH), ph = r.h - capH - baseH;
          if (py < 3 || py > ph - 4) c = (py === 1 || py === ph - 2) ? P.redDark : P.gold;
          else {
            const pe = Math.min(sx - 4, sw - 5 - sx, py - 3, ph - 4 - py);
            c = pe === 0 ? P.gold : P.blueDark;
          }
        }
      }
      put(p, x, y, c, L_DECO);
    }
  shadowRight(p, r);
}

function paintPlate(p: Paint, r: Rect): void {
  // a gold cartouche
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const ex = Math.min(x - r.x, r.x + r.w - 1 - x), ey = Math.min(y - r.y, r.y + r.h - 1 - y);
      const round = ex < 4 && ey < 4 && (4 - ex) ** 2 + (4 - ey) ** 2 > 18;
      if (round) continue;
      const e = Math.min(ex, ey);
      const c: Color = e === 0 || (ex < 4 && ey < 4 && (4 - ex) ** 2 + (4 - ey) ** 2 > 10) ? P.brown : e === 1 ? (y < r.y + r.h / 2 ? P.yellow : P.orange) : e === 2 ? P.gold : P.cream;
      put(p, x, y, c, L_DECO);
    }
  // the cartouche tie at the right end
  for (let y = r.y + 2; y < r.y + r.h - 2; y++) put(p, r.x + r.w - 6, y, P.gold, L_DECO);
  shadowRight(p, r);
}

function paintPedestal(b: Rgba): void {
  cylinder(b, [P.cream, P.tan, P.skinMid, P.brownLight], [P.white, P.cream, P.tan, P.skinMid], P.brown);
  // gold band under the top and a painted base
  for (let x = 2; x < 46; x++) {
    if (bget(b, x, 11) !== -1) bpx(b, x, 11, P.gold);
    if (bget(b, x, 12) !== -1 && x % 4 === 0) bpx(b, x, 12, P.blueDark);
    else if (bget(b, x, 12) !== -1) bpx(b, x, 12, P.orange);
  }
  plaque(b, P.blueDark, P.navyDark, P.gold);
  for (let x = 0; x < 48; x++) {
    const e = Math.min(x, 47 - x);
    if (e < 1) continue;
    bpx(b, x, 19, e < 2 ? P.brown : P.cream);
    bpx(b, x, 20, e < 2 ? P.brown : x % 6 < 3 ? P.blueDark : P.redDark);
    bpx(b, x, 21, e < 2 ? P.brown : P.skinMid);
    bpx(b, x, 22, P.brown);
  }
  // inlaid lapis dots on the top rim
  for (let x = 6; x < 42; x += 6) if (inTop(x, 9)) bpx(b, x, 9, P.blue);
}

// ---------------------------------------------------------------- props

function sunPulseProp(sun: { x: number; y: number; r: number }): Prop {
  return {
    layer: 'far',
    name: 'sun',
    at: { x: sun.x - sun.r - 22, y: sun.y - sun.r - 22, w: (sun.r + 22) * 2, h: sun.r + 24 },
    draw(c, now) {
      if (!now) return;
      for (let k = 0; k < 2; k++) {
        const t = ((now / 2600 + k * 0.5) % 1);
        const rr = sun.r + 2 + t * 18;
        for (let a = 0; a < 360; a += 2) {
          const ang = (a * Math.PI) / 180;
          if (Math.sin(ang) > 0.05) continue; // above the horizon only
          const x = Math.round(sun.x + Math.cos(ang) * rr), y = Math.round(sun.y + Math.sin(ang) * rr);
          if ((a / 2 + Math.floor(t * 8)) % 3 === 0 || t > 0.7) continue;
          c.shade(x, y, -1);
        }
      }
      // core shimmer
      const f = Math.floor(now / 300) % 4;
      if (f === 0) for (let x = -2; x <= 2; x++) c.px(sun.x + x, sun.y - Math.round(sun.r * 0.6), P.white);
    },
  };
}

function sandDriftProp(area: Rect): Prop {
  return {
    layer: 'near',
    name: 'sand',
    at: area,
    draw(c, now) {
      if (!now) return;
      for (let i = 0; i < 26; i++) {
        const per = 2600 + hash01(101, i) * 2600;
        const t = ((now + hash01(102, i) * per) % per) / per;
        const x = Math.round(area.x + area.w - t * (area.w + 20));
        const y = Math.round(area.y + hash01(103, i) * area.h + Math.sin(t * 9 + i) * 2);
        const col: Color = i % 3 === 0 ? P.cream : i % 3 === 1 ? P.tan : P.gold;
        c.px(x, y, col);
        if (i % 4 === 0) c.px(x + 1, y, col);
        if (i % 7 === 0) {
          c.px(x + 2, y, P.tan);
          c.px(x + 3, y, P.tan);
        }
      }
    },
  };
}

const SCARAB = [
  ['.l.l.', 'lbbbl', '.bgb.', 'lbbbl', '.b.b.'],
  ['l...l', '.bbb.', 'lbgbl', '.bbb.', 'l...l'],
];
function scarabProp(x0: number, x1: number, y: number): Prop {
  return {
    layer: 'far',
    name: 'scarab',
    at: { x: x0 - 4, y: y - 8, w: Math.min(60, x1 - x0 + 8), h: 12 },
    draw(c, now) {
      const span = Math.max(10, x1 - x0);
      const per = span * 160;
      const t = (now % (per * 2)) / per;
      const dir = t < 1 ? 1 : -1;
      const u = t < 1 ? t : 2 - t;
      const x = Math.round(x0 + u * span);
      const f = Math.floor(now / 140) % 2;
      // walking sideways: rotate the 5x5 by drawing it as is (top view)
      c.sprite(SCARAB[now ? f : 0], x - 2, y - 4, { l: P.plum, b: P.blueDark, g: P.gold }, dir < 0);
      c.px(x + (dir > 0 ? 3 : -3), y - 2, P.plum); // head
    },
  };
}

function props(p: Paint, plan: ScenePlan): Prop[] {
  const out: Prop[] = [];
  const main = plan.openings[0];
  const r = main.rect;
  const sun = sunOf(plan, p.w);
  out.push(sunPulseProp(sun));
  const horizon = Math.max(r.y + 30, plan.extras.floorY - 8);
  // braziers on the jambs (lobby, call, hall) or on the chat wall
  const spots = plan.layout.kind === 'chat'
    ? plan.extras.wallSpots.map((s) => ({ x: s.x - 4, y: s.y + 6 }))
    : [{ x: r.x - ARCH_T - 3, y: r.y + 22 }, { x: r.x + r.w + ARCH_T - 10, y: r.y + 22 }];
  for (const s of spots) {
    paintBrazier(p, s.x, s.y, [P.yellow, P.gold, P.orange, P.brown]);
    out.push(brazierProp(s.x, s.y, s.x));
  }
  const x0 = Math.max(r.x, FRAME) + 10, x1 = Math.min(r.x + r.w, p.w - FRAME) - 10;
  out.push(scarabProp(x0 + 20, x0 + Math.min(120, x1 - x0 - 20), horizon + 3));
  out.push(sandDriftProp({ x: x0 - 10, y: horizon + 4, w: x1 - x0 + 20, h: Math.max(10, p.h - FRAME - horizon - 8) }));
  return out;
}

export const desert: ThemeDef = {
  id: 'desert',
  name: 'Desert Tomb',
  colors: {
    text: '#ead4aa', textDim: '#e4a672', accent: '#feae34', panelText: '#ead4aa',
    bubbleThemText: '#3e2731', bubbleMeText: '#3e2731', bg: '#3e2731', labelText: '#fee761', plateText: '#733e39', textShadow: '#3e2731',
    good: '#63c74d', bad: '#e43b44',
  },
  archRise: (r, s, kind) => (kind === 'chat' ? Math.min(Math.round(r.w / 2), s) : 0),
  paintDeep,
  paintWall,
  paintArch: (p, o) => paintArch(p, o),
  paintFrame,
  paintPillar: (p, r) => paintPillar(p, r),
  paintPlate,
  props,
  pedestalSprites: () => buildPedestals(paintPedestal, [P.cyan, P.blue, P.blueDark]),
  ui: () =>
    buildUi({
      outline: P.brown,
      panelRim: [P.cream, P.tan, P.skinMid, P.brownLight],
      panelFill: P.blueDark,
      panelLine: P.navyDark,
      rivet: P.gold,
      button: [P.cream, P.tan, P.skinMid, P.brownLight],
      primary: [P.yellow, P.gold, P.orange, P.rust],
      yes: [P.lime, P.green, P.greenDark, P.tealDark],
      no: [P.pink, P.red, P.redDark, P.plum],
      bubbleThem: { fill: P.cream, shade: P.tan, line: P.brown },
      bubbleMe: { fill: P.gold, shade: P.orange, line: P.brown },
      plate: [P.yellow, P.gold, P.orange, P.brown],
      plateFill: P.cream,
    }),
  fuse: { rope: [P.cream, P.tan], burnt: P.brown },
  glow: [P.white, P.yellow, P.gold],
};

void sprite;
