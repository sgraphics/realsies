// Castle Dungeon: deep blue-black hall with moonlit windows, banners and a red carpet behind a
// grey stone arch; torches flicker on the wall, water drips, chains sway and a bat crosses.

import type { Rgba } from '../core/buffer.ts';
import { px as bpx, get as bget } from '../core/buffer.ts';
import { PAL, type Color, RAMPS, darker } from '../core/palette.ts';
import { hash01 } from '../core/rng.ts';
import type { Rect } from '../scene/types.ts';
import { FRAME, ARCH_T } from '../scene/layout.ts';
import type { Prop, ScenePlan, ThemeDef } from './types.ts';
import {
  type Paint, type Opening, put, fill, shade, glow, dim, bayer, ramp, fbm, n1, forRing, forInside, brickAt,
  outsideAll, visibleCenterX, L_DEEP, L_FLOOR, L_WALL, L_ARCH, L_DECO, L_FRAME, sprite, frameOf, Clip, capCenterY,
} from './util.ts';
import { buildPedestals, cylinder } from './pedestal.ts';
import { spandrels } from './shared.ts';
import { buildUi } from './ui.ts';
import { paintStdFrame, torchProp, paintTorchSconce, batProp, dripProp, chainProp, paintStonePillar, paintBannerPlate, perspectiveFloor } from './shared.ts';

const P = PAL;

function paintDeep(p: Paint, plan: ScenePlan): void {
  const main = plan.openings[0];
  const r = main.rect;
  const floorY = plan.extras.floorY;
  const horizon = Math.max(r.y + 20, floorY - 8);
  // far wall: big dark bricks, darker toward the top, one flat colour per brick
  for (let y = 0; y < horizon; y++)
    for (let x = 0; x < p.w; x++) {
      const b = brickAt(x, y, 20, 10);
      const mortar = b.u === 0 || b.v === 0;
      const t = Math.max(0, Math.min(1, (b.by * 10 + 5 - r.y) / Math.max(1, horizon - r.y)));
      const n = hash01(5, b.bx, b.by);
      let c: Color;
      if (mortar) c = P.black;
      else {
        const v = t * 0.9 + (n - 0.5) * 0.5;
        c = v < 0.3 ? P.black : v < 0.75 ? P.navyDark : P.navy;
        if (b.v === 1 && c !== P.black) c = c === P.navyDark ? P.navy : P.slate;
        if (b.v === 1 && c === P.black) c = P.navyDark;
      }
      put(p, x, y, c, L_DEEP);
    }
  // colonnade of tall arched windows across the far wall
  const step = 46;
  const winW = 14, winH = Math.max(18, Math.min(34, horizon - r.y - 30));
  const cx0 = visibleCenterX(main, p.w);
  const centred = Math.abs(r.x + r.w / 2 - cx0) < 4;
  const nWin = Math.max(1, Math.floor((r.w + 40) / step));
  for (let i = 0; i < nWin; i++) {
    const wx = Math.round(cx0 + (i - (nWin - 1) / 2) * step - winW / 2);
    const wy = horizon - winH - 14;
    const moon = i % 2 === 0;
    for (let y = wy; y < wy + winH; y++)
      for (let x = wx; x < wx + winW; x++) {
        const nx = (x + 0.5 - (wx + winW / 2)) / (winW / 2);
        const capH = winW / 2;
        if (y < wy + capH && nx * nx + ((y + 0.5 - (wy + capH)) / capH) ** 2 > 1) continue;
        const edge = x === wx || x === wx + winW - 1 || (y < wy + capH && nx * nx + ((y - 0.5 - (wy + capH)) / capH) ** 2 > 1);
        let c: Color = moon ? ramp([P.blue, P.blueDark, P.navyDark], (y - wy) / winH, x, y) : P.black;
        if (edge) c = P.navy;
        // window bars
        if (!edge && moon && ((x - wx) % 5 === 2 || (y - wy) % 8 === 7)) c = P.navyDark;
        put(p, x, y, c, L_DEEP);
      }
    // sill
    fill(p, wx - 2, wy + winH, winW + 4, 2, P.navy, L_DEEP);
    fill(p, wx - 2, wy + winH + 2, winW + 4, 1, P.black, L_DEEP);
    // moonlight shaft toward the floor
    if (moon) {
      for (let y = wy + winH + 3; y < Math.min(p.h, horizon + 60); y++) {
        const k = y - (wy + winH);
        for (let x = wx + 1 + Math.floor(k * 0.45); x < wx + winW - 1 + Math.floor(k * 0.45); x++) {
          const fade = 1 - k / 70;
          if (fade * 0.55 > bayer(x, y)) shade(p, x, y, -1);
        }
      }
    }
    // banners between windows
    if (i < nWin - 1) {
      const bx = Math.round(cx0 + (i + 0.5 - (nWin - 1) / 2) * step - 5);
      const by = wy - 4;
      const bh = winH + 2;
      for (let y = by; y < by + bh; y++)
        for (let x = bx; x < bx + 10; x++) {
          const tail = y >= by + bh - 3 && Math.abs(x - (bx + 4.5)) < (y - (by + bh - 4)) * 1.2;
          if (tail) continue;
          let c: Color = x === bx || x === bx + 9 ? P.redDark : (x + y) % 7 === 0 ? P.redDark : P.redDark;
          if (y === by || y === by + 1) c = P.gold;
          if (y === by + 2) c = P.orange;
          if (x === bx + 1 && y > by + 1) c = P.red;
          put(p, x, y, c, L_DEEP);
        }
      // emblem: a little gold crown
      sprite(p, ['g.g.g', 'ggggg', '.ggg.'], bx + 2, by + 7, { g: P.gold }, L_DEEP);
      fill(p, bx - 1, by - 1, 12, 1, P.slate, L_DEEP); // rod
    }
  }
  // floor: flagstones in perspective, carpet down the middle
  perspectiveFloor(p, horizon, cx0, (x, y, row, v, u, depth) => {
    const colW = 16;
    const off = row & 1 ? colW / 2 : 0;
    const uu = (((u + off) % colW) + colW) % colW;
    const joint = v === 0 || uu < 1;
    const carpetHalf = Math.max(3, r.w * 0.035) + depth * Math.min(40, r.w * 0.12);
    const e = carpetHalf - Math.abs(x + 0.5 - cx0);
    let c: Color;
    if (e > 0 && centred) {
      c = e < 2 ? P.gold : e < 3 ? P.orange : P.redDark;
      if (e >= 3 && e < 4 && depth > 0.4) c = P.red;
      if (e >= 5 && v === 1 && row % 3 === 0 && Math.abs(x - cx0) < 3) c = P.gold; // stitched pattern
    } else if (joint) c = P.black;
    else {
      const n = hash01(9, Math.floor((u + off) / colW), row);
      const v2 = depth * 0.9 + (n - 0.5) * 0.45;
      c = v2 < 0.25 ? P.navyDark : v2 < 0.7 ? P.navy : P.slate;
      if (v === 1) c = c === P.navyDark ? P.navy : c === P.navy ? P.slate : P.grey;
    }
    put(p, x, y, c, L_FLOOR);
  });
  // horizon skirting
  fill(p, 0, horizon - 2, p.w, 2, P.black, L_DEEP);
  fill(p, 0, horizon - 3, p.w, 1, P.navy, L_DEEP);
  // ambient occlusion along the inside of the arch
  for (const o of plan.openings)
    forInside(p, o, (x, y, d) => {
      if (d < 4 && (4 - d) / 4 > bayer(x, y)) shade(p, x, y, 1);
    });
}

function paintWall(p: Paint, plan: ScenePlan): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const b = brickAt(x, y, 16, 8);
      const n = hash01(21, b.bx, b.by);
      let c: Color;
      if (b.u === 0 || b.v === 0) c = P.navyDark;
      else {
        // most bricks slate; some darker, a few lighter; top edge lit, bottom edge shaded
        const tone = n < 0.22 ? 0 : n > 0.93 ? 2 : 1;
        const fillC = tone === 0 ? P.navy : tone === 2 ? P.grey : P.slate;
        const topC = tone === 0 ? P.slate : tone === 2 ? P.greyLight : P.grey;
        const botC = tone === 0 ? P.navyDark : P.navy;
        c = b.v === 1 ? topC : b.v === 7 || b.u === 15 ? botC : fillC;
        if (b.u === 1 && b.v > 1 && b.v < 7) c = tone === 0 ? P.navy : topC === P.grey && hash01(23, b.bx, b.by) > 0.5 ? P.grey : fillC;
        if (hash01(22, x, y) < 0.05 && b.v > 1) c = darker(c, 1);
        // cracks
        if (n > 0.6 && n < 0.64 && (b.u - 4 === b.v || b.u - 5 === b.v)) c = P.navyDark;
        // moss creeping on the lower bricks
        if (y > p.h * 0.58 && fbm(4, x / 9, y / 7) > 0.63 && b.v < 4) c = b.v === 1 ? P.green : P.greenDark;
      }
      put(p, x, y, c, L_WALL);
    }
  // vignette toward the frame
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!outsideAll(plan.openings, x, y)) continue;
      const e = Math.min(x, y, p.w - 1 - x, p.h - 1 - y) - FRAME;
      if (e < 12 && (12 - e) / 16 > bayer(x, y)) shade(p, x, y, 1);
    }
}

function paintArch(p: Paint, o: Opening): void {
  const T = ARCH_T;
  const cy = capCenterY(o);
  const r = o.rect;
  const arcLen = Math.PI * (r.w / 2 + o.rise) / 2; // approx half-perimeter of the cap
  const nStones = Math.max(7, Math.round(arcLen / 13) | 1);
  forRing(p, o, T, (x, y, d, cap, ang) => {
    let c: Color;
    if (cap) {
      const u = ((ang + Math.PI) / Math.PI) * nStones; // 0..n across the cap
      const si = Math.floor(u), f = u - si;
      const key = si === Math.floor(nStones / 2);
      if (f < 0.1 || d >= T - 1) c = P.navyDark;
      else if (d < 1) c = P.slate; // inner lip
      else if (d < 2) c = key ? P.grey : P.navy; // soffit in shadow
      else {
        c = key ? P.greyLight : P.grey;
        if (f < 0.25 || d > T - 2.2) c = key ? P.white : P.greyLight;
        else if (f > 0.82) c = P.slate;
        if (hash01(31, si, Math.floor(d)) < 0.12) c = darker(c, 1);
      }
    } else {
      // side blocks: alternating tall/short courses
      const yy = y - Math.floor(cy);
      const course = Math.floor(yy / 8);
      const v = yy - course * 8;
      const split = course & 1 ? 4 : 0;
      const u = Math.floor(d);
      if (v === 0 || d >= T - 1 || (split && u === split)) c = P.navyDark;
      else if (d < 1) c = P.slate;
      else if (d < 2) c = P.navy;
      else c = v === 1 ? P.greyLight : v === 7 ? P.slate : P.grey;
    }
    put(p, x, y, c, L_ARCH);
  });
  // outer outline
  forRing(p, o, T + 1, (x, y, d) => {
    if (d >= T) put(p, x, y, P.navyDark, L_ARCH);
  });
  // keystone carving: small gold rune
  const kx = Math.round(r.x + r.w / 2), ky = Math.round(r.y - T + 2);
  if (o.rise > 6) sprite(p, ['.y.', 'yyy', '.y.'], kx - 1, ky, { y: P.gold }, L_ARCH);
}

function paintPedestal(b: Rgba): void {
  cylinder(b, [P.grey, P.slate, P.navy, P.navyDark], [P.greyLight, P.grey, P.slate, P.navy], P.navyDark);
  // concentric ring on the top face
  for (let x = 12; x < 36; x++) {
    const nx = (x + 0.5 - 24) / 12;
    const yy = Math.round(6 + Math.sqrt(Math.max(0, 1 - nx * nx)) * 2.6);
    const yt = Math.round(6 - Math.sqrt(Math.max(0, 1 - nx * nx)) * 2.6);
    if (bget(b, x, yy) !== -1) bpx(b, x, yy, P.slate);
    if (bget(b, x, yt) !== -1 && x % 2 === 0) bpx(b, x, yt, P.slate);
  }
  // stone joints on the face
  for (const x of [9, 39]) for (let y = 11; y < 20; y++) if (bget(b, x, y) !== -1) bpx(b, x, y, P.navy);
  // a band of gold studs across the face (the base below dissolves into the floor)
  for (let x = 8; x <= 40; x += 8) {
    bpx(b, x, 13, P.gold);
    bpx(b, x, 14, P.orange);
  }
  // plinth
  for (let x = 0; x < 48; x++) {
    const e = Math.min(x, 47 - x);
    if (e < 1) continue;
    bpx(b, x, 19, e < 2 ? P.navyDark : P.grey);
    bpx(b, x, 20, e < 2 ? P.navyDark : P.slate);
    bpx(b, x, 21, e < 2 ? P.navyDark : P.navy);
    bpx(b, x, 22, P.navyDark);
  }
}

function props(p: Paint, plan: ScenePlan): Prop[] {
  const out: Prop[] = [];
  const main = plan.openings[0];
  const r = main.rect;
  // torches: in the arch spandrels (lobby, call, hall) or at the wall spots (chat)
  const spots = plan.layout.kind === 'chat' ? plan.extras.wallSpots : spandrels(main);
  for (const s of spots) {
    paintTorchSconce(p, s.x, s.y, 'iron');
    glow(p, s.x + 2, s.y - 4, 20, 1, [L_WALL, L_ARCH], 1.1);
    out.push(torchProp(s.x, s.y, 1 + Math.round(s.x)));
  }
  // chains hanging inside the arch
  if (plan.layout.kind !== 'chat') {
    const cy = capCenterY(main);
    const lx = Math.round(r.x + r.w * 0.16), rx = Math.round(r.x + r.w * 0.84);
    for (const [cx, len, ph] of [[lx, 22, 0], [rx, 16, 1.7]] as const) {
      const topY = Math.round(cy - main.rise * Math.sqrt(Math.max(0, 1 - ((cx - (r.x + r.w / 2)) / (r.w / 2)) ** 2))) - 1;
      out.push(chainProp(cx, topY, len, ph));
    }
    // drip from the cap near the left third
    const dx = Math.round(r.x + r.w * 0.3);
    const topY = Math.round(cy - main.rise * Math.sqrt(Math.max(0, 1 - ((dx - (r.x + r.w / 2)) / (r.w / 2)) ** 2))) + 1;
    out.push(dripProp(dx, topY, plan.extras.floorY + 18, [P.cyan, P.blue, P.white], 2600));
  } else {
    const dx = Math.round(r.x + 60);
    out.push(dripProp(dx, FRAME + 1, plan.extras.floorY + 30, [P.cyan, P.blue, P.white], 3100));
  }
  out.push(batProp(r, plan.extras.floorY, 9000, [P.purple, P.magenta, P.hotRed]));
  // heraldic shields on big wall areas
  for (const d of plan.extras.decor) paintShield(p, Math.round(d.x + d.w / 2 - 8), Math.round(d.y + d.h * 0.3), Math.round(d.x) % 3);
  return out;
}

const SHIELD = [
  'oooooooooooooooo',
  'oHHHHHHHHHHHHHHo',
  'oHAAAAAAQQQQQQso',
  'oHAAAAAAQQQQQQso',
  'oHAAAAAAQQQQQQso',
  'oHAAAAAAQQQQQQso',
  'oHAAAAAAQQQQQQso',
  'oHQQQQQQAAAAAAso',
  'oHQQQQQQAAAAAAso',
  '.oHQQQQQAAAAAso.',
  '.oHQQQQQAAAAAso.',
  '..oHQQQQAAAAso..',
  '...oHQQQAAAso...',
  '....ooHQAsoo....',
  '......oooo......',
];

/** A quartered heraldic shield with a gold rim. */
function paintShield(p: Paint, x: number, y: number, v: number): void {
  const pairs: [Color, Color][] = [[P.redDark, P.gold], [P.blueDark, P.greyLight], [P.green, P.gold]];
  const [a, q] = pairs[v % pairs.length];
  sprite(p, SHIELD, x, y, { o: P.navyDark, H: P.yellow, s: P.orange, A: a, Q: q }, L_DECO);
  // crossed swords behind
  for (let i = 0; i < 22; i++) {
    const sx = x - 3 + i, sy1 = y - 3 + i, sy2 = y + 18 - i;
    for (const sy of [sy1, sy2]) {
      if (sx >= x && sx < x + 16 && sy >= y && sy < y + 15 && SHIELD[sy - y][sx - x] !== '.') continue;
      put(p, sx, sy, i < 4 || i > 18 ? P.brown : P.greyLight, L_DECO);
    }
  }
}

export const castle: ThemeDef = {
  id: 'castle',
  name: 'Castle Dungeon',
  colors: {
    text: '#ead4aa', textDim: '#8b9bb4', accent: '#feae34', panelText: '#ead4aa',
    bubbleThemText: '#181425', bubbleMeText: '#181425', bg: '#181425', labelText: '#ead4aa', plateText: '#fee761', textShadow: '#181425',
    good: '#63c74d', bad: '#e43b44',
  },
  archRise: (r, s) => Math.min(Math.round(r.w / 2), Math.max(s, 16)),
  paintDeep,
  paintWall,
  paintArch: (p, o) => paintArch(p, o),
  paintFrame: (p) => paintStdFrame(p, { block: [P.slate, P.navy, P.navyDark, P.black], corner: [P.gold, P.orange, P.brown], blockW: 26, blockH: 22 }),
  paintPillar: (p, r) => paintStonePillar(p, r, { stone: [P.greyLight, P.grey, P.slate, P.navy], inset: P.navyDark, trim: P.gold, outline: P.navyDark }),
  paintPlate: (p, r) => paintBannerPlate(p, r, { cloth: [P.red, P.redDark, P.redDark, P.plum], trim: P.gold, outline: P.plum }),
  props,
  pedestalSprites: () => buildPedestals(paintPedestal, [P.yellow, P.gold, P.orange]),
  ui: () =>
    buildUi({
      outline: P.black,
      panelRim: [P.greyLight, P.grey, P.slate, P.navy],
      panelFill: P.navyDark,
      panelLine: P.black,
      rivet: P.gold,
      button: [P.greyLight, P.grey, P.slate, P.navy],
      primary: [P.yellow, P.gold, P.orange, P.rust],
      yes: [P.lime, P.green, P.greenDark, P.tealDark],
      no: [P.pink, P.red, P.redDark, P.plum],
      bubbleThem: { fill: P.cream, shade: P.tan, line: P.plum },
      bubbleMe: { fill: P.greyLight, shade: P.grey, line: P.navyDark },
      plate: [P.red, P.redDark, P.redDark, P.plum],
      plateFill: P.redDark,
    }),
  fuse: { rope: [P.tan, P.skinMid], burnt: P.navy },
  glow: [P.yellow, P.gold, P.orange],
};

void L_DECO; void L_FRAME; void n1; void dim; void frameOf; void Clip;
export type { Rect };
