// Shared pieces for the promo assets: the game's DOM layer redrawn in the trailer's pixel style at
// the game's 1080p scale (HUD, name tags, panels, buttons, tags, check marks, the cursor and its
// click), palette-step dimming (scrims, the caption band), and the annotation kit: a lower-third
// step caption and pointer callouts. Everything stays inside the ENDESGA-32 palette.

import { type Rgba, type Color, type Rect, type ThemeId, createBuffer, nineSlice, px, PAL, darker, lighter, getThemeKit, drawLogo, LOGO_W, LOGO_H, icon } from '../../art.ts';
import { blitK, rectOut, OUT_W } from '../../engine/camera.ts';
import { drawRuns, drawText, textW, type Run, type Style } from './text.ts';

export const P = PAL;
/** Device px per game px at 1080p under the HUD (the game's own choice for a 1920x1080 window). */
export const S = 4;
export const HUD_H = 64;
/** Canvas top: its 14-px frame bar hides under the HUD. */
export const TOP = HUD_H - 14 * S;
export const GW = 480;
export const GH = 268;

/** Game rect -> output rect. */
export const O = (r: Rect) => ({ x: r.x * S, y: r.y * S + TOP, w: r.w * S, h: r.h * S });
export const even = (v: number) => Math.round(v / 2) * 2;
export const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const clamp01 = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u);
export const hexC = (h: string) => parseInt(h.slice(1), 16) as Color;
export const ms = (t: number) => t * 1000;

export type Kit = ReturnType<typeof getThemeKit>;
export interface NS {
  img: Rgba;
  slice: number;
}

/** A nine-slice at k output px per sprite px. */
export function nine(out: Rgba, ns: NS, x: number, y: number, w: number, h: number, k: number): void {
  const bw = Math.max(ns.slice * 2 + 1, Math.round(w / k)), bh = Math.max(ns.slice * 2 + 1, Math.round(h / k));
  const b = createBuffer(bw, bh);
  nineSlice(b, ns.img, ns.slice, 0, 0, bw, bh);
  blitK(out, b, x, y, k);
}

// ---------------------------------------------------------------- dimming

const memo = new Map<number, number>();
const u32 = (b: Rgba) => new Uint32Array(b.data.buffer, b.data.byteOffset, b.w * b.h);
/** Packed RGBA pixel -> the same pixel `steps` palette steps darker. */
function darkPx(v: number, steps: number): number {
  const key = (v & 0xffffff) * 8 + steps;
  let r = memo.get(key);
  if (r === undefined) {
    const c = ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
    const d = steps >= 6 ? PAL.black : darker(c, steps);
    r = (0xff000000 | ((d & 0xff) << 16) | (d & 0xff00) | ((d >> 16) & 0xff)) >>> 0;
    memo.set(key, r);
  }
  return r;
}

/** Darken a region `steps` palette steps (a scrim behind a dialog). */
export function dim(out: Rgba, steps: number, x = 0, y = 0, w = out.w, h = out.h): void {
  if (steps <= 0) return;
  const d = u32(out);
  const x0 = Math.max(0, Math.round(x)), x1 = Math.min(out.w, Math.round(x + w));
  const y0 = Math.max(0, Math.round(y)), y1 = Math.min(out.h, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) d[yy * out.w + xx] = darkPx(d[yy * out.w + xx], steps);
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const th = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/**
 * A dithered dark band from y0 (clear) down to y1 (`max` steps darker), in 4-px blocks so the
 * dither reads as game pixels: the lower third the captions sit on.
 */
export function shadeBand(out: Rgba, y0: number, y1: number, max = 4, solidFrom = 0.55): void {
  const d = u32(out);
  const B = 4;
  for (let by = Math.floor(y0 / B); by * B < Math.min(out.h, y1 + B); by++) {
    const v = Math.min(1, ((by + 0.5) * B - y0) / (y1 - y0));
    for (let bx = 0; bx * B < out.w; bx++) {
      const level = v >= solidFrom ? max : (v / solidFrom) * max;
      const steps = Math.floor(level) + (level - Math.floor(level) > th(bx, by) ? 1 : 0);
      if (steps <= 0) continue;
      for (let yy = by * B; yy < Math.min(out.h, by * B + B); yy++)
        for (let xx = bx * B; xx < Math.min(out.w, bx * B + B); xx++) d[yy * out.w + xx] = darkPx(d[yy * out.w + xx], steps);
    }
  }
}

// ---------------------------------------------------------------- HUD

export interface HudStat {
  label: string;
  value: string;
  icon?: Rgba;
  /** A small lock and amount after the value (coins locked until the round ends). */
  locked?: string;
}

function pill(out: Rgba, kit: Kit, x: number, y: number, st: HudStat): number {
  const vw = textW(st.value) * 3 + (st.locked ? 12 + 9 * 2 + 4 + textW(st.locked) * 2 : 0), lw = textW(st.label) * 2;
  const iw = st.icon ? st.icon.w * 3 + 9 : 0;
  const w = Math.max(vw, lw) + iw + 30;
  nine(out, kit.ui.panel, x, y, w, 56, 2);
  if (st.icon) blitK(out, st.icon, x + 15, y + 28 - Math.round((st.icon.h * 3) / 2), 3);
  drawText(out, st.label, x + 15 + iw, y + 10, { color: P.grey, scale: 2 });
  const vx = x + 15 + iw;
  drawText(out, st.value, vx, y + 26, { color: P.white, scale: 3 });
  if (st.locked) {
    const lx = vx + textW(st.value) * 3 + 12;
    blitK(out, icon('lock'), lx, y + 30, 2);
    drawText(out, st.locked, lx + 9 * 2 + 4, y + 32, { color: P.gold, scale: 2 });
  }
  return w;
}

export const pillW = (st: HudStat) => {
  const vw = textW(st.value) * 3 + (st.locked ? 12 + 9 * 2 + 4 + textW(st.locked) * 2 : 0), lw = textW(st.label) * 2;
  return Math.max(vw, lw) + (st.icon ? st.icon.w * 3 + 9 : 0) + 30;
};

/** The HUD bar: logo, level plate, stat pills right-aligned (as the trailer's montage draws it). */
export function hud(out: Rgba, kit: Kit, level: string, stats: HudStat[], t: number): void {
  rectOut(out, 0, 0, OUT_W, HUD_H, P.black);
  rectOut(out, 0, HUD_H - 2, OUT_W, 2, P.navyDark);
  const lb = createBuffer(LOGO_W, LOGO_H);
  drawLogo(lb, 0, 0, ms(t), 1);
  blitK(out, lb, 10, 4, 2);
  const pw = textW(level) * 3 + 36;
  nine(out, kit.ui.plate, 258, 8, pw, 48, 3);
  drawText(out, level, 276, 19, { color: P.cyan, scale: 3 });
  let x = OUT_W - 10;
  for (let i = stats.length - 1; i >= 0; i--) {
    x -= pillW(stats[i]);
    pill(out, kit, x, 4, stats[i]);
    x -= 8;
  }
}

/** A gamertag tag under a pedestal (game rect of the label). */
export function nameTag(out: Rgba, r: Rect, name: string, color: Color): void {
  const o = O(r);
  const tw = textW(name) * 3;
  const w = tw + 18, h = 33;
  const x = even(o.x + o.w / 2 - w / 2), y = o.y;
  rectOut(out, x, y, w, h, P.black);
  rectOut(out, x, y, w, 3, P.navyDark);
  drawText(out, name, x + 9, y + 6, { color, scale: 3 });
}

// ---------------------------------------------------------------- the cursor

/** A pixel arrow cursor (white with a black outline), game px; the same one the trailer uses. */
export const CURSOR = (() => {
  const rows = [
    'K..........',
    'KK.........',
    'KWK........',
    'KWWK.......',
    'KWWWK......',
    'KWWWWK.....',
    'KWWWWWK....',
    'KWWWWWWK...',
    'KWWWWWWWK..',
    'KWWWWWKKKK.',
    'KWWKWWK....',
    'KWK.KWWK...',
    'KK..KWWK...',
    'K....KWWK..',
    '.....KWWK..',
    '......KK...',
  ];
  const b = createBuffer(11, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && px(b, x, y, ch === 'K' ? P.black : P.white)));
  return b;
})();

/** The cursor with its tip at (x, y); `click` = seconds since a click (a ring flashes out, the arrow dips). */
export function cursor(out: Rgba, x: number, y: number, click = -1): void {
  if (click >= 0 && click < 0.25) {
    const r = 10 + Math.floor(click * 24) * 10;
    const c = click < 0.12 ? P.white : P.cyan;
    const s = 4;
    // a square pixel ring around the tip
    rectOut(out, x - r, y - r, 2 * r, s, c);
    rectOut(out, x - r, y + r - s, 2 * r, s, c);
    rectOut(out, x - r, y - r, s, 2 * r, c);
    rectOut(out, x + r - s, y - r, s, 2 * r, c);
  }
  const dip = click >= 0 && click < 0.1 ? 4 : 0;
  blitK(out, CURSOR, Math.round(x / 4) * 4, Math.round(y / 4) * 4 + dip, 4);
}

// ---------------------------------------------------------------- small widgets

/** A filled label box (BOT, HUMAN, Right): returns its width. */
export function tag(out: Rgba, text: string, x: number, y: number, o: { bg: Color; fg: Color; scale: number; icon?: Rgba; padX?: number; padY?: number }): number {
  const s = o.scale;
  const padX = o.padX ?? 2 * s, padY = o.padY ?? Math.round(1.5 * s);
  const iw = o.icon ? o.icon.w * s * 0.75 : 0;
  const ik = Math.max(1, Math.round(s * 0.75));
  const w = textW(text) * s + padX * 2 + (o.icon ? o.icon.w * ik + s : 0);
  const h = 7 * s + padY * 2;
  rectOut(out, x - s, y - s, w + 2 * s, h + 2 * s, P.black);
  rectOut(out, x, y, w, h, o.bg);
  rectOut(out, x, y, w, Math.max(2, Math.round(s / 2)), lighter(o.bg, 1));
  let tx = x + padX;
  if (o.icon) {
    blitK(out, o.icon, tx, y + Math.round(h / 2 - (o.icon.h * ik) / 2), ik);
    tx += o.icon.w * ik + s;
  }
  void iw;
  drawText(out, text, tx, y + padY, { color: o.fg, scale: s });
  return w;
}

/** A check mark box as in the Verify drawer (green square, white tick). */
export function checkBox(out: Rgba, x: number, y: number, size: number, status: 'pass' | 'na' | 'wait'): void {
  rectOut(out, x - 4, y - 4, size + 8, size + 8, P.black);
  rectOut(out, x, y, size, size, status === 'pass' ? P.green : status === 'na' ? P.slate : P.navy);
  if (status === 'pass') {
    const k = Math.max(2, Math.floor(size / 9));
    const tick = ['.......#', '......##', '#....##.', '##..##..', '.####...', '..##....'];
    const ox = x + Math.round((size - 8 * k) / 2), oy = y + Math.round((size - 6 * k) / 2);
    tick.forEach((r, ty) => [...r].forEach((ch, tx) => ch === '#' && rectOut(out, ox + tx * k, oy + ty * k, k, k, P.white)));
  } else if (status === 'na') rectOut(out, x + size / 4, y + size / 2 - 2, size / 2, 4, P.white);
}

/** A raised button from a theme button set, its content centred by `draw(x, y, w, h)`. */
export function button(out: Rgba, set: { up: NS; down: NS }, x: number, y: number, w: number, h: number, k: number, down = false): void {
  nine(out, down ? set.down : set.up, x, y, w, h, k);
}

/** A cyan selection frame around a rect (hover / highlight), `t` makes it breathe a little. */
export function highlight(out: Rgba, x: number, y: number, w: number, h: number, c: Color = P.cyan, pad = 8, thick = 4): void {
  rectOut(out, x - pad, y - pad, w + 2 * pad, thick, c);
  rectOut(out, x - pad, y + h + pad - thick, w + 2 * pad, thick, c);
  rectOut(out, x - pad, y - pad, thick, h + 2 * pad, c);
  rectOut(out, x + w + pad - thick, y - pad, thick, h + 2 * pad, c);
}

// ---------------------------------------------------------------- annotations

export interface CaptionSpec {
  /** Step number in the gold chip (none: no chip). */
  step?: number;
  text: string | Run[];
  /** When it comes in and goes (absolute seconds). */
  from: number;
  to: number;
}

const CAP = { scale: 8, chip: 84, gap: 28, y: 958 };

/**
 * The lower-third caption: a gold step chip and one line of big white type on the dark band. It
 * types on fast (in at `from`), holds, and is gone at `to`.
 */
export function caption(out: Rgba, c: CaptionSpec, t: number, maxScale = CAP.scale): void {
  if (t < c.from || t >= c.to) return;
  const runs = typeof c.text === 'string' ? [{ text: c.text }] : c.text;
  const full = runs.map((r) => r.text).join('');
  const chip = c.step !== undefined ? CAP.chip + CAP.gap : 0;
  // as big as fits between 56-px margins
  const scale = Math.min(maxScale, Math.floor((OUT_W - 112 - chip) / textW(full)));
  const tw = textW(full) * scale;
  const x0 = even((OUT_W - (tw + chip)) / 2);
  const capH = 7 * scale;
  const yText = CAP.y + Math.round((CAP.chip - capH) / 2);
  const age = t - c.from;
  if (c.step !== undefined) {
    // the chip pops in first
    const pop = age < 1 / 24 ? 6 : age < 2 / 24 ? -4 : 0;
    const s = CAP.chip + pop;
    const cx = x0 + (CAP.chip - s) / 2, cy = CAP.y + (CAP.chip - s) / 2;
    rectOut(out, cx - 6, cy - 6, s + 12, s + 12, P.black);
    rectOut(out, cx, cy, s, s, P.gold);
    rectOut(out, cx, cy, s, 6, P.yellow);
    rectOut(out, cx, cy + s - 8, s, 8, P.orange);
    const ns = String(c.step);
    const k = 8;
    drawText(out, ns, even(cx + s / 2 - (textW(ns) * k) / 2), cy + Math.round(s / 2 - (7 * k) / 2), { color: P.black, scale: k });
  }
  const n = Math.floor(Math.max(0, age - 0.08) * 70);
  drawRuns(out, runs, x0 + chip, yText, { color: P.white, scale, shadow: P.black }, n);
}

export interface CalloutSpec {
  lines: (string | Run[])[];
  /** Box position (top-left, output px). */
  x: number;
  y: number;
  /** Where the pointer goes (output px); none: no pointer. */
  to?: { x: number; y: number };
  /** Which side of the box the pointer leaves from. */
  side?: 'left' | 'right' | 'top' | 'bottom';
  from: number;
  until: number;
  scale?: number;
  rim?: Color;
}

/** Size of a callout box. */
const padOf = (s: number) => Math.round(3.5 * s) + 4;
export function calloutSize(c: { lines: (string | Run[])[]; scale?: number }): { w: number; h: number } {
  const s = c.scale ?? 5;
  const widest = Math.max(...c.lines.map((l) => textW(typeof l === 'string' ? l : l.map((r) => r.text).join(''))));
  return { w: even(widest * s + 2 * padOf(s)), h: even(c.lines.length * 10 * s - 3 * s + 2 * 4 * s) };
}

/**
 * A pointer callout: a dark box with a coloured rim and one or more lines of text, a pixel line to
 * the thing it names ending in a square dot. Pops in at `from`, the line draws out, gone at `until`.
 */
export function callout(out: Rgba, c: CalloutSpec, t: number): void {
  if (t < c.from || t >= c.until) return;
  const s = c.scale ?? 5;
  const rim = c.rim ?? P.gold;
  const age = t - c.from;
  const { w, h } = calloutSize(c);
  const x = even(c.x), y = even(c.y);
  // the pointer first, under the box
  if (c.to) {
    const side = c.side ?? 'bottom';
    const sx = side === 'left' ? x : side === 'right' ? x + w : even(Math.max(x + 24, Math.min(x + w - 24, c.to.x)));
    const sy = side === 'top' ? y : side === 'bottom' ? y + h : even(Math.max(y + 16, Math.min(y + h - 16, c.to.y)));
    const u = ease(age / 0.2);
    const ex = sx + (c.to.x - sx) * u, ey = sy + (c.to.y - sy) * u;
    // an elbow: along the leaving axis first, then across
    const horizontalFirst = side === 'left' || side === 'right';
    const mx = horizontalFirst ? ex : sx, my = horizontalFirst ? sy : ey;
    const T = 6;
    const seg = (ax: number, ay: number, bx: number, by: number) => {
      const x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
      rectOut(out, x0 - T / 2 - 3, y0 - T / 2 - 3, Math.abs(bx - ax) + T + 6, Math.abs(by - ay) + T + 6, P.black);
    };
    seg(sx, sy, mx, my);
    seg(mx, my, ex, ey);
    const segC = (ax: number, ay: number, bx: number, by: number) => {
      const x0 = Math.min(ax, bx), y0 = Math.min(ay, by);
      rectOut(out, x0 - T / 2, y0 - T / 2, Math.abs(bx - ax) + T, Math.abs(by - ay) + T, rim);
    };
    segC(sx, sy, mx, my);
    segC(mx, my, ex, ey);
    if (u >= 1) {
      rectOut(out, c.to.x - 11, c.to.y - 11, 22, 22, P.black);
      rectOut(out, c.to.x - 8, c.to.y - 8, 16, 16, rim);
      rectOut(out, c.to.x - 4, c.to.y - 4, 8, 8, P.white);
    }
  }
  const pop = age < 1 / 24 ? 0.92 : 1;
  const bw = even(w * pop), bh = even(h * pop);
  const bx = even(x + (w - bw) / 2), by = even(y + (h - bh) / 2);
  rectOut(out, bx - 6, by - 6, bw + 12, bh + 12, P.black);
  rectOut(out, bx, by, bw, bh, rim);
  rectOut(out, bx + 6, by + 6, bw - 12, bh - 12, P.black);
  rectOut(out, bx + 6, by + 6, bw - 12, 4, P.navyDark);
  if (pop < 1) return;
  const padX = padOf(s);
  c.lines.forEach((l, i) => {
    const runs = typeof l === 'string' ? [{ text: l }] : l;
    drawRuns(out, runs, x + padX, y + 4 * s + i * 10 * s, { color: P.white, scale: s });
  });
}

/** Text style shortcuts. */
export const ST = {
  body: (scale: number, color: Color = P.white): Style => ({ color, scale }),
  title: (scale: number): Style => ({ color: P.cream, scale, outline: P.black, extrude: P.tan }),
};

export type { ThemeId };
