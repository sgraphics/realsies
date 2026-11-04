// Star Station: a bolted observation window in metal bulkheads looks out on a starfield, a nebula
// and a ringed planet over a glowing deck. Props: scrolling stars, console blink, airlock steam,
// a hovering drone.

import type { Rgba } from '../core/buffer.ts';
import { px as bpx, get as bget } from '../core/buffer.ts';
import { PAL, type Color } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME, ARCH_T } from '../scene/layout.ts';
import type { Prop, ScenePlan, ThemeDef } from './types.ts';
import {
  type Paint, type Opening, put, shade, bayer, ramp, fbm, forRing, forInside, outsideAll, visibleCenterX, capTopAt, glow,
  L_DEEP, L_FLOOR, L_WALL, L_ARCH, L_DECO, L_FRAME, layerAt, insideOpening,
} from './util.ts';
import { buildPedestals, cylinder, inTop, PED_TOP } from './pedestal.ts';
import { buildUi } from './ui.ts';
import { forFrame, frameFinish, perspectiveFloor, shadowRight } from './shared.ts';

const P = PAL;

function paintDeep(p: Paint, plan: ScenePlan): void {
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 30, plan.extras.floorY - 10);
  const cx = visibleCenterX(main, p.w);
  const vis = Math.min(r.w, p.w - 2 * FRAME);
  // space: deep gradient with a nebula band
  for (let y = 0; y < horizon; y++)
    for (let x = 0; x < p.w; x++) {
      const neb = fbm(201, x / 34, y / 20, 4);
      const band = Math.exp(-(((y - (r.y + (horizon - r.y) * 0.45)) / 26) ** 2) - ((x - cx) / (vis * 0.9)) ** 2 * 0.3);
      const v = neb * band;
      let c: Color = P.black;
      if (v > 0.5) c = P.purple;
      else if (v > 0.4) c = bayer(x, y) < (v - 0.4) * 10 ? P.purple : P.navyDark;
      else if (v > 0.28) c = P.navyDark;
      else if (v > 0.22) c = bayer(x, y) < (v - 0.22) * 16 ? P.navyDark : P.black;
      if (v > 0.58) c = bayer(x, y) < 0.5 ? P.magenta : P.purple;
      put(p, x, y, c, L_DEEP);
    }
  // static stars
  for (let i = 0; i < Math.round((p.w * horizon) / 90); i++) {
    const sx = Math.floor(hash01(202, i) * p.w), sy = Math.floor(hash01(203, i) * horizon);
    const b = hash01(204, i);
    const c: Color = b > 0.96 ? P.white : b > 0.8 ? P.greyLight : b > 0.6 ? P.grey : P.slate;
    put(p, sx, sy, c, L_DEEP);
    if (b > 0.985) {
      put(p, sx - 1, sy, P.grey, L_DEEP);
      put(p, sx + 1, sy, P.grey, L_DEEP);
      put(p, sx, sy - 1, P.grey, L_DEEP);
      put(p, sx, sy + 1, P.grey, L_DEEP);
    }
  }
  // ringed planet low on the right
  const pr = Math.max(14, Math.round(vis * 0.08));
  const pxc = Math.round(cx + vis * 0.3), pyc = Math.round(horizon - pr * 0.55);
  for (let y = pyc - pr - 6; y <= pyc + pr + 6; y++)
    for (let x = pxc - pr * 2; x <= pxc + pr * 2; x++) {
      const dx = x + 0.5 - pxc, dy = y + 0.5 - pyc;
      const d = Math.sqrt(dx * dx + dy * dy) / pr;
      // ring: a tilted ellipse in front of / behind the disc
      const rx = dx / (pr * 1.9), ry = (dy - dx * 0.18) / (pr * 0.45);
      const rd = Math.sqrt(rx * rx + ry * ry);
      const inRing = rd > 0.78 && rd < 1.0;
      const front = dy - dx * 0.18 > 0;
      if (d <= 1 && !(inRing && front)) {
        const band = Math.floor((dy / pr) * 3.5 + Math.sin(dx / 9) * 0.25 + 10);
        const lit = dx + dy < pr * 0.25;
        let c: Color = band % 2 === 0 ? (lit ? P.gold : P.orange) : lit ? P.clay : P.rust;
        if (d > 0.82 && !lit) c = P.brown;
        if (dx + dy > pr * 0.9) c = P.plum; // terminator shadow
        if (d > 0.92) c = lit ? P.orange : P.plum;
        put(p, x, y, c, L_DEEP);
      } else if (inRing && (front || d > 1)) {
        put(p, x, y, rd > 0.92 ? P.tan : rd > 0.85 ? P.cream : P.skinMid, L_DEEP);
      }
    }
  // a small moon
  const mx = Math.round(cx - vis * 0.36), my = Math.round(r.y + (horizon - r.y) * 0.3);
  for (let y = my - 5; y <= my + 5; y++)
    for (let x = mx - 5; x <= mx + 5; x++) {
      const dx = x + 0.5 - mx, dy = y + 0.5 - my;
      if (dx * dx + dy * dy > 25) continue;
      put(p, x, y, dx + dy < -2 ? P.white : dx + dy < 3 ? P.greyLight : P.grey, L_DEEP);
    }
  // window sill at the horizon, then the deck
  for (let x = 0; x < p.w; x++) {
    put(p, x, horizon - 3, P.grey, L_DEEP);
    put(p, x, horizon - 2, P.slate, L_DEEP);
    put(p, x, horizon - 1, P.navyDark, L_DEEP);
  }
  perspectiveFloor(p, horizon, cx, (x, y, row, v, u, depth) => {
    const colW = 14;
    const uu = ((u % colW) + colW) % colW;
    let c: Color = depth < 0.3 ? P.navyDark : P.navy;
    if (v === 0 || uu < 1) c = P.navyDark;
    else if (v === 1) c = depth < 0.3 ? P.navy : P.slate;
    if ((row % 4 === 2) && v === 0) c = P.blue; // light strips
    if (Math.abs(x + 0.5 - cx) < 1 + depth * 2 && v !== 0) c = P.cyan;
    put(p, x, y, c, L_FLOOR);
  });
  // window glass reflections (diagonal streaks, upper left of each opening)
  for (const o of plan.openings)
    forInside(p, o, (x, y, d) => {
      if (y >= horizon - 3) return;
      const u = x + y - (o.rect.x + o.rect.y);
      if ((u > 18 && u < 21) || (u > 26 && u < 28)) if (bayer(x, y) < 0.4 && y < o.rect.y + 60) shade(p, x, y, -1);
      if (d < 3 && (3 - d) / 3 > bayer(x, y)) shade(p, x, y, 1);
    });
}

function paintWall(p: Paint, plan: ScenePlan): void {
  const PW = 32, PH = 22;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const bx = Math.floor(x / PW), by = Math.floor(y / PH);
      const u = x - bx * PW, v = y - by * PH;
      const n = hash01(211, bx, by);
      let c: Color;
      if (u === 0 || v === 0) c = P.navyDark;
      else if (u === 1 || v === 1) c = P.grey;
      else if (u === PW - 1 || v === PH - 1) c = P.navy;
      else c = n > 0.8 ? P.grey : P.slate;
      // rivets
      if ((u === 3 || u === PW - 4) && (v === 3 || v === PH - 4)) c = P.greyLight;
      if ((u === 4 || u === PW - 3) && (v === 4 || v === PH - 3)) c = P.navy;
      // vents on some panels
      if (n < 0.25 && u > 6 && u < PW - 6 && v > 6 && v < PH - 6 && v % 3 === 0) c = P.navyDark;
      if (n < 0.25 && u > 6 && u < PW - 6 && v > 6 && v < PH - 6 && v % 3 === 1) c = P.navy;
      // a little status light on some panels
      if (n > 0.88 && u === PW - 7 && v === 5) c = n > 0.94 ? P.lime : P.red;
      put(p, x, y, c, L_WALL);
    }
  // a horizontal pipe pair and hazard stripes near the floor
  const pipeY = p.h - FRAME - 20;
  for (let x = 0; x < p.w; x++) {
    if (outsideAll(plan.openings, x, pipeY)) {
      put(p, x, pipeY, P.greyLight, L_WALL);
      put(p, x, pipeY + 1, P.grey, L_WALL);
      put(p, x, pipeY + 2, P.slate, L_WALL);
      put(p, x, pipeY + 3, P.navyDark, L_WALL);
      if (x % 40 === 0) for (let k = -1; k <= 4; k++) put(p, x, pipeY + k, P.navyDark, L_WALL);
    }
    for (let y = p.h - FRAME - 8; y < p.h - FRAME; y++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      put(p, x, y, ((x + y) >> 2) % 2 ? P.gold : P.black, L_WALL);
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
  const r = o.rect;
  forRing(p, o, T, (x, y, d, cap, ang) => {
    let c: Color;
    if (d < 1) c = P.cyan; // glass edge glint
    else if (d < 2) c = P.navyDark;
    else if (d >= T - 1) c = P.navyDark;
    else {
      const v = Math.floor(d);
      c = v === 2 ? P.greyLight : v >= T - 2 ? P.slate : P.grey;
      // bolts every so often around the ring
      const s = cap ? (ang + Math.PI) * (r.w / 2 + o.rise) * 0.6 : y;
      if (v === 4 && Math.floor(s) % 12 === 0) c = P.white;
      if (v === 4 && Math.floor(s) % 12 === 1) c = P.navy;
    }
    put(p, x, y, c, L_ARCH);
  });
  forRing(p, o, T + 1, (x, y, d) => {
    if (d >= T) put(p, x, y, P.black, L_ARCH);
  });
}

function paintFrame(p: Paint): void {
  forFrame(p, (x, y, side, along, depth, cx, cy) => {
    let c: Color;
    if (side === 'corner') {
      // hazard-striped corner plates
      const e = Math.min(cx, cy, FRAME - 1 - cx, FRAME - 1 - cy);
      c = e === 0 ? P.black : e === 1 ? P.grey : ((cx + cy) >> 1) % 2 ? P.gold : P.black;
      put(p, x, y, c, L_FRAME);
      return;
    }
    const bw = 40;
    const off = side === 'bottom' || side === 'right' ? 20 : 0;
    const u = (along + off) % bw;
    const lit = side === 'top' || side === 'left';
    const t = lit ? depth : FRAME - 1 - depth;
    if (depth === 0 || depth === FRAME - 1 || u === 0) c = P.black;
    else if (t === 1 || u === 1) c = P.greyLight;
    else if (t >= FRAME - 3 || u === bw - 1) c = P.navy;
    else c = P.grey;
    // rivets and a lit strip
    if ((u === 4 || u === bw - 5) && (depth === 4 || depth === FRAME - 5)) c = P.white;
    if (depth === Math.floor(FRAME / 2) && u > 10 && u < bw - 10) c = (along >> 1) % 2 ? P.cyan : P.blue;
    put(p, x, y, c, L_FRAME);
  });
  frameFinish(p, P.black);
}

function paintPillar(p: Paint, r: Rect): void {
  // a console tower: metal bezel, dark screen, buttons row
  const wide = r.w > r.h * 1.3;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
      let c: Color;
      if (e === 0) c = P.black;
      else if (e === 1) c = y === r.y + 1 || x === r.x + 1 ? P.greyLight : P.slate;
      else if (e <= 3) c = P.grey;
      else if (e === 4) c = P.cyan;
      else c = (y - r.y) % 2 ? P.black : P.navyDark; // scanlines
      put(p, x, y, c, L_DECO);
    }
  if (!wide) {
    // button row at the bottom bezel
    for (let i = 0; i < 4; i++) {
      const bx = r.x + 6 + i * Math.floor((r.w - 12) / 4);
      put(p, bx, r.y + r.h - 3, [P.red, P.gold, P.lime, P.cyan][i], L_DECO);
    }
  }
  shadowRight(p, r);
}

function paintPlate(p: Paint, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y);
      const c: Color = e === 0 ? P.black : e === 1 ? (y === r.y + 1 ? P.greyLight : P.grey) : e === 2 ? P.cyan : (y - r.y) % 2 ? P.black : P.navyDark;
      put(p, x, y, c, L_DECO);
    }
  // mounting struts
  for (const sx of [r.x + 8, r.x + r.w - 9]) for (let y = r.y - 4; y < r.y; y++) {
    put(p, sx, y, P.grey, L_DECO);
    put(p, sx + 1, y, P.navy, L_DECO);
  }
  shadowRight(p, r);
}

function paintPedestal(b: Rgba): void {
  // hover pad: metal disc with a glowing ring, emitter underneath
  cylinder(b, [P.grey, P.slate, P.navy, P.navyDark], [P.greyLight, P.grey, P.slate, P.navy], P.black, { bottom: 14 });
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 48; x++) {
      if (!inTop(x, y)) continue;
      const dx = (x + 0.5 - 24) / 21, dy = (y + 0.5 - 6) / 5;
      const rr = Math.sqrt(dx * dx + dy * dy);
      if (rr > 0.62 && rr < 0.8) bpx(b, x, y, P.cyan);
      else if (rr >= 0.8 && rr < 0.88) bpx(b, x, y, P.blue);
    }
  // face: panel lines and lights
  for (let x = 4; x < 44; x++) if (bget(b, x, 11) !== -1) bpx(b, x, 11, P.navyDark);
  // status lights across the face
  for (let x = 9; x <= 39; x += 6) bpx(b, x, 13, x === 21 ? P.red : x % 12 === 9 ? P.lime : P.cyan);
  // emitter glow under the pad (gives the hover look)
  for (let x = 10; x < 38; x++) {
    const e = Math.min(x - 10, 37 - x);
    bpx(b, x, 20, e < 3 ? P.navy : P.slate);
    if (e >= 2) bpx(b, x, 21, e < 6 ? P.blue : P.cyan);
    if (e >= 6 && x % 2 === 0) bpx(b, x, 22, P.blue);
  }
  void PED_TOP;
}

// ---------------------------------------------------------------- props

function starScrollProp(area: Rect, horizon: number, w: number): Prop {
  const n = Math.max(20, Math.round((area.w * (horizon - area.y)) / 260));
  return {
    layer: 'far',
    name: 'stars',
    lit: true,
    at: { x: area.x, y: area.y, w: Math.min(area.w, 120), h: Math.min(60, horizon - area.y) },
    draw(c, now) {
      if (!now) return;
      for (let i = 0; i < n; i++) {
        const layer = i % 3; // parallax: 3 speeds
        const speed = [0.006, 0.012, 0.024][layer];
        const y = Math.round(area.y + hash01(221, i) * Math.max(4, horizon - 4 - area.y));
        const x0 = hash01(222, i) * (w + 40);
        const x = Math.round(((x0 - now * speed) % (w + 40) + (w + 40)) % (w + 40)) - 20;
        const col: Color = layer === 2 ? P.white : layer === 1 ? P.greyLight : P.grey;
        if (c.ok(x, y) && c.get(x, y) !== P.black && c.get(x, y) !== P.navyDark && c.get(x, y) !== P.purple) continue; // stay behind planets
        c.px(x, y, col);
        if (layer === 2) c.px(x + 1, y, P.slate); // a short streak
      }
    },
  };
}

function consoleProp(x: number, y: number, seed: number): Prop {
  return {
    layer: 'mid',
    name: 'console',
    lit: true,
    at: { x: x - 3, y: y - 3, w: 26, h: 12 },
    draw(c, now) {
      const t = Math.floor(now / 260);
      const cols: Color[] = [P.red, P.lime, P.gold, P.cyan];
      for (let i = 0; i < 6; i++) {
        const on = now ? hash01(seed, i, Math.floor(t / (1 + (i % 3)))) > 0.4 : i % 2 === 0;
        c.px(x + (i % 3) * 3, y + Math.floor(i / 3) * 3, on ? cols[i % 4] : P.navyDark);
      }
      // a little screen with a moving line
      for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) c.px(x + 10 + i, y + j, P.black);
      const sx = now ? t % 9 : 4;
      for (let i = 0; i < 9; i++) c.px(x + 10 + i, y + 1 + Math.round(Math.sin((i + t) / 1.5)), i === sx ? P.white : P.lime);
    },
  };
}

function paintConsoleBody(p: Paint, x: number, y: number): void {
  for (let j = -2; j < 8; j++)
    for (let i = -2; i < 22; i++) {
      const e = Math.min(i + 2, j + 2, 21 - i, 7 - j);
      put(p, x + i, y + j, e === 0 ? P.black : e === 1 ? (j === -1 || i === -1 ? P.greyLight : P.slate) : P.navy, L_DECO);
    }
}

function steamProp(x: number, y: number): Prop {
  return {
    layer: 'near',
    name: 'steam',
    at: { x: x - 16, y: y - 22, w: 32, h: 26 },
    draw(c, now) {
      if (!now) return;
      const per = 3200;
      const t = (now % per) / per;
      if (t > 0.55) return;
      const u = t / 0.55;
      for (let k = 0; k < 7; k++) {
        const ang = -Math.PI / 2 + (k - 3) * 0.25;
        const rr = 2 + u * 14 + (k % 2) * 2;
        const px0 = Math.round(x + Math.cos(ang) * rr * 0.8), py0 = Math.round(y + Math.sin(ang) * rr);
        const size = 1 + Math.floor(u * 3);
        for (let j = 0; j < size; j++)
          for (let i = 0; i < size; i++) {
            if (u > 0.6 && bayer(px0 + i, py0 + j) < (u - 0.6) * 2.4) continue;
            c.px(px0 + i, py0 + j, u < 0.4 ? P.white : P.greyLight);
          }
      }
    },
  };
}

function paintVent(p: Paint, x: number, y: number): void {
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 10; i++) put(p, x + i, y + j, j === 0 ? P.greyLight : j === 3 ? P.navyDark : i % 2 ? P.black : P.navy, L_DECO);
}

const DRONE = [
  '..gGGg..',
  '.gGwwGg.',
  'gGwkkwGg',
  'gGkrrkGg',
  '.gGkkGg.',
  '..g..g..',
];
function droneProp(area: Rect): Prop {
  return {
    layer: 'near',
    name: 'drone',
    at: area,
    draw(c, now) {
      const t = now / 1000;
      const x = Math.round(area.x + area.w * (0.5 + 0.42 * Math.sin(t * 0.21)));
      const y = Math.round(area.y + area.h * (0.5 + 0.35 * Math.sin(t * 0.47 + 1)));
      const eye = now && Math.floor(now / 400) % 4 === 0;
      c.sprite(DRONE, x - 4, y - 3, { g: P.slate, G: P.grey, w: P.greyLight, k: P.black, r: eye ? P.white : P.red });
      // rotor blur
      const f = Math.floor(now / 60) % 2;
      for (let i = -5; i <= 5; i++) if ((i + f) % 2 === 0) c.px(x + i, y - 5, P.greyLight);
      c.px(x, y - 4, P.grey);
      // thruster flicker
      if (Math.floor(now / 90) % 2) c.px(x, y + 4, P.cyan);
    },
  };
}

function props(p: Paint, plan: ScenePlan): Prop[] {
  const out: Prop[] = [];
  const main = plan.openings[0];
  const r = main.rect;
  const horizon = Math.max(r.y + 30, plan.extras.floorY - 10);
  out.push(starScrollProp({ x: Math.max(FRAME, r.x), y: Math.max(FRAME, r.y), w: Math.min(r.w, p.w - 2 * FRAME), h: horizon - r.y }, horizon - 3, p.w));
  // consoles on the wall: spandrels or the chat wall
  const spots: { x: number; y: number }[] = [];
  if (plan.layout.kind === 'chat') for (const s of plan.extras.wallSpots) spots.push({ x: s.x - 2, y: s.y + 2 });
  else if (main.rise >= 20 && r.w >= 120) spots.push({ x: r.x + 4, y: r.y + 2 }, { x: r.x + r.w - 24, y: r.y + 2 });
  for (const s of spots) {
    if (layerAt(p, s.x + 10, s.y + 3) !== L_WALL || insideOpening(main, s.x + 10, s.y + 6)) continue;
    paintConsoleBody(p, s.x, s.y);
    out.push(consoleProp(s.x, s.y, s.x));
  }
  // steam vent low on the wall near the arch
  const vx = Math.round(r.x - ARCH_T - 14), vy = p.h - FRAME - 22;
  if (layerAt(p, vx + 5, vy) === L_WALL) {
    paintVent(p, vx, vy);
    out.push(steamProp(vx + 5, vy - 1));
  } else {
    const vx2 = Math.round(Math.min(p.w - FRAME - 14, r.x + r.w + ARCH_T + 3));
    if (layerAt(p, vx2 + 5, vy) === L_WALL) {
      paintVent(p, vx2, vy);
      out.push(steamProp(vx2 + 5, vy - 1));
    }
  }
  // drone patrolling the upper part of the window
  const area = { x: Math.max(FRAME, r.x) + 20, y: Math.max(FRAME, r.y) + Math.max(6, main.rise / 2), w: Math.min(r.w, p.w - 2 * FRAME) - 40, h: Math.max(16, (horizon - r.y) * 0.45) };
  out.push(droneProp(area));
  void glow; void capTopAt; void ramp;
  return out;
}

export const space: ThemeDef = {
  id: 'space',
  name: 'Star Station',
  colors: {
    text: '#c0cbdc', textDim: '#8b9bb4', accent: '#2ce8f5', panelText: '#c0cbdc',
    bubbleThemText: '#181425', bubbleMeText: '#181425', bg: '#181425', labelText: '#2ce8f5', plateText: '#2ce8f5', textShadow: '#181425',
    good: '#63c74d', bad: '#ff0044',
  },
  archRise: (r, s) => Math.min(Math.round(r.w / 2), Math.max(Math.round(s * 0.7), 14)),
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
      panelRim: [P.greyLight, P.grey, P.slate, P.navy],
      panelFill: P.navyDark,
      panelLine: P.cyan,
      rivet: P.white,
      button: [P.greyLight, P.grey, P.slate, P.navy],
      primary: [P.white, P.cyan, P.blue, P.blueDark],
      yes: [P.lime, P.green, P.greenDark, P.tealDark],
      no: [P.pink, P.hotRed, P.redDark, P.plum],
      bubbleThem: { fill: P.greyLight, shade: P.grey, line: P.black },
      bubbleMe: { fill: P.cyan, shade: P.blue, line: P.blueDark },
      plate: [P.greyLight, P.grey, P.slate, P.black],
      plateFill: P.navyDark,
    }),
  fuse: { rope: [P.greyLight, P.grey], burnt: P.navy },
  glow: [P.white, P.cyan, P.blue],
};
