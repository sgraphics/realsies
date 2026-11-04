// Layouts in game pixels for every screen composition, both orientations, any logical size that
// chooseScale produces. Rects returned here are where the web app puts its DOM overlay.

import type { CallLayout, ChatLayout, HallLayout, LobbyLayout, Orientation, Point, Rect, SeatSlot } from './types.ts';
import { LOGO_H, LOGO_W } from '../themes/logo.ts';

/** Foreground frame thickness on every side. */
export const FRAME = 14;
/** Arch border thickness drawn outside each opening. */
export const ARCH_T = 8;
export const PED_W = 48;
export const PED_H = 24;
/** Character box top relative to the pedestal top (feet at row 45 land on the pedestal's top face). */
export const CHAR_ON_PED = 40;
/** Pedestal face plaque, relative to the pedestal: the DOM gamertag sits here. */
export const PLAQUE = { x: 7, y: 12, w: 34, h: 9 };

export const TABS_W = 104;
export const TABS_H = 18;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function innerRect(w: number, h: number): Rect {
  return { x: FRAME, y: FRAME, w: w - FRAME * 2, h: h - FRAME * 2 };
}

function orient(w: number, h: number): Orientation {
  return w >= h ? 'landscape' : 'portrait';
}

/** Text-safe rect on a canvas pillar: a tall column keeps clear of capital and base; a wide strip is a tablet. */
export function pillarTextRect(r: Rect, bottom?: number): Rect {
  if (r.w > r.h * 1.3) return { x: r.x + 6, y: r.y + 5, w: r.w - 12, h: r.h - 10 };
  const y = r.y + 16;
  const b = bottom ?? r.y + r.h - 12;
  return { x: r.x + 8, y, w: r.w - 16, h: Math.max(8, b - y) };
}

/** A seat on a pedestal whose top-left is (px, py); label sits on the pedestal plaque. */
export function seatAt(index: number, px: number, py: number, labelW = 64, labelH = 9, cellW = 60): SeatSlot {
  const cx = px + PED_W / 2;
  const lw = Math.min(labelW, Math.max(44, cellW - 2));
  return {
    index,
    pedestal: { x: px, y: py, w: PED_W, h: PED_H },
    char: { x: px + (PED_W - 32) / 2, y: py - CHAR_ON_PED },
    label: { x: Math.round(cx - lw / 2), y: py + PLAQUE.y, w: lw, h: labelH },
    hit: { x: Math.round(cx - Math.max(PED_W, cellW - 2) / 2), y: py - CHAR_ON_PED + 4, w: Math.max(PED_W, cellW - 2), h: CHAR_ON_PED - 4 + PED_H },
  };
}

/** The arch opening rect plus its cap height (rise). */
export interface ArchSpec {
  rect: Rect;
  rise: number;
}

/** Extra layout data the renderer needs (not used by the web app). */
export interface LayoutExtras {
  arches: ArchSpec[];
  /** Horizon of the deep floor inside the main arch. */
  floorY: number;
  /** Pillar-like canvas columns to draw. */
  pillars: Rect[];
  /** Plates drawn on canvas (banner). */
  plates: Rect[];
  /** Logo top-left, if drawn. */
  logoAt?: Point;
  /** Where wall-mounted props may go (left and right of the main arch). */
  wallSpots: Point[];
  /** Big empty wall areas a theme may decorate (shields, vines, murals). */
  decor: Rect[];
}

const EXTRAS = new WeakMap<object, LayoutExtras>();

/** Round every number in a layout tree in place (rects must be whole game pixels). */
function roundAll<T>(o: T): T {
  if (Array.isArray(o)) for (const v of o) roundAll(v);
  else if (o && typeof o === 'object')
    for (const k of Object.keys(o)) {
      const v = (o as any)[k];
      if (typeof v === 'number') (o as any)[k] = Math.round(v);
      else if (v && typeof v === 'object') roundAll(v);
    }
  return o;
}
function done<T extends object>(layout: T, extras: LayoutExtras): T {
  roundAll(layout);
  roundAll(extras);
  EXTRAS.set(layout, extras);
  return layout;
}
export function extrasOf(l: object): LayoutExtras {
  const e = EXTRAS.get(l);
  if (e) return e;
  // a cloned or hand-made layout: rebuild the extras from its kind and size
  const a = l as { kind?: string; w: number; h: number; seats?: unknown[] };
  const again =
    a.kind === 'lobby' ? layoutLobby(a.w, a.h, a.seats?.length ?? 10) :
    a.kind === 'chat' ? layoutChat(a.w, a.h) :
    a.kind === 'call' ? layoutCall(a.w, a.h) :
    layoutHall(a.w, a.h, a.seats?.length ?? 0);
  return EXTRAS.get(again)!;
}

// ---------------------------------------------------------------- lobby

export function layoutLobby(w: number, h: number, n = 10): LobbyLayout {
  return orient(w, h) === 'landscape' ? lobbyLandscape(w, h, n) : lobbyPortrait(w, h, n);
}

function gridSeats(arch: ArchSpec, n: number, cols: number, rows: number, bottom: number, minPitch: number, maxPitch: number): { seats: SeatSlot[]; pitch: number } {
  const a = arch.rect;
  const cell = (a.w - 6) / cols;
  const frontY = bottom - PED_H + 1; // pedestal base just above the frame
  // the back row's characters must clear the arch cap at the outer columns
  const capClear = a.y + Math.round(arch.rise * 0.42) - 4;
  const room = frontY - CHAR_ON_PED - capClear;
  const pitch = rows > 1 ? clamp(Math.floor(room / (rows - 1)), minPitch, maxPitch) : 0;
  const seats: SeatSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const py = frontY - (rows - 1 - r) * pitch;
    const inRow = Math.min(cols, n - r * cols);
    const rowOff = ((cols - inRow) * cell) / 2;
    for (let c = 0; c < inRow; c++) {
      const i = r * cols + c;
      const px = Math.round(a.x + 3 + rowOff + cell * (c + 0.5) - PED_W / 2);
      seats.push(seatAt(i, px, py, 72, 9, cell));
    }
  }
  return { seats, pitch };
}

function lobbyLandscape(w: number, h: number, n: number): LobbyLayout {
  const inner = innerRect(w, h);
  const hdr = LOGO_H + 6;
  const logo: Rect = { x: inner.x + 6, y: inner.y + 3, w: LOGO_W, h: LOGO_H };
  const tabs: Rect = { x: inner.x + inner.w - 6 - TABS_W, y: inner.y + 5, w: TABS_W, h: TABS_H };
  const bodyY = inner.y + hdr;
  const pillarW = clamp(Math.round(inner.w * 0.18), 70, 100);
  const pillar: Rect = { x: inner.x + 6, y: bodyY + 2, w: pillarW, h: inner.y + inner.h - 3 - (bodyY + 2) };
  const actions: Rect = { x: pillar.x + 5, y: pillar.y + pillar.h - 44, w: pillar.w - 10, h: 38 };
  const ax = pillar.x + pillar.w + 8 + ARCH_T;
  const aTop = bodyY + ARCH_T + 4;
  const aw = inner.x + inner.w - 4 - ARCH_T - ax;
  const bottom = inner.y + inner.h;
  const rows = n > 5 ? 2 : 1;
  const cols = Math.ceil(n / rows);
  let rise = clamp(Math.round(aw * 0.16), 20, 44);
  let arch: ArchSpec = { rect: { x: ax, y: aTop, w: aw, h: bottom + 6 - aTop }, rise };
  let g = gridSeats(arch, n, cols, rows, bottom, 50, 74);
  // flatten the arch if the back row is too high for it
  const need = (s: SeatSlot) => s.char.y + 4;
  if (rows > 1 && need(g.seats[0]) < aTop + rise * 0.42) {
    rise = Math.max(12, Math.floor((need(g.seats[0]) - aTop) / 0.42));
    arch = { rect: arch.rect, rise };
    g = gridSeats(arch, n, cols, rows, bottom, 50, 74);
  }
  const bannerW = clamp(Math.round(aw * 0.42), 112, 168);
  const banner: Rect = { x: Math.round(ax + aw / 2 - bannerW / 2), y: aTop - ARCH_T - 4, w: bannerW, h: 14 };
  const layout: LobbyLayout = { kind: 'lobby', w, h, orientation: 'landscape', inner, logo, banner, tabs, pillar, arch: arch.rect, seats: g.seats, actions, pillarText: pillarTextRect(pillar, actions.y - 4) };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(g.seats[0].pedestal.y + PED_H * 0.3 - (rows > 1 ? 6 : 0)),
    pillars: [pillar],
    plates: [banner],
    logoAt: { x: logo.x, y: logo.y },
    wallSpots: [
      { x: ax - ARCH_T - 5, y: aTop + 6 },
      { x: ax + aw + ARCH_T + 3, y: aTop + 6 },
    ],
    decor: [],
  });
}

function lobbyPortrait(w: number, h: number, n: number): LobbyLayout {
  const inner = innerRect(w, h);
  const logo: Rect = { x: Math.round(inner.x + inner.w / 2 - LOGO_W / 2), y: inner.y + 3, w: LOGO_W, h: LOGO_H };
  const tight = inner.h < 420;
  const stripH = tight ? 26 : 32;
  const pillar: Rect = { x: inner.x + 4, y: logo.y + logo.h + 2, w: inner.w - 8, h: stripH };
  const rowY = pillar.y + pillar.h + 3;
  const tabs: Rect = { x: inner.x + 4, y: rowY, w: TABS_W, h: TABS_H - (tight ? 2 : 0) };
  const actions: Rect = { x: tabs.x + tabs.w + 4, y: rowY, w: inner.x + inner.w - 4 - (tabs.x + tabs.w + 4), h: tabs.h };
  const aTop = rowY + tabs.h + 4 + ARCH_T + 2;
  const ax = inner.x + 2 + ARCH_T;
  const aw = inner.w - 4 - ARCH_T * 2;
  const bottom = inner.y + inner.h;
  const cols = n > 5 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  let rise = clamp(Math.round(aw * 0.22), 18, 46);
  let arch: ArchSpec = { rect: { x: ax, y: aTop, w: aw, h: bottom + 6 - aTop }, rise };
  let g = gridSeats(arch, n, cols, rows, bottom, 46, 76);
  if (rows > 1 && g.seats[0].char.y + 4 < aTop + rise * 0.42) {
    rise = Math.max(10, Math.floor((g.seats[0].char.y + 4 - aTop) / 0.42));
    arch = { rect: arch.rect, rise };
    g = gridSeats(arch, n, cols, rows, bottom, 46, 76);
  }
  const bannerW = clamp(aw - 24, 100, 150);
  const banner: Rect = { x: Math.round(ax + aw / 2 - bannerW / 2), y: aTop - ARCH_T - 3, w: bannerW, h: 13 };
  const layout: LobbyLayout = { kind: 'lobby', w, h, orientation: 'portrait', inner, logo, banner, tabs, pillar, arch: arch.rect, seats: g.seats, actions, pillarText: pillarTextRect(pillar) };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(g.seats[Math.max(0, g.seats.length - 2 * cols)]?.pedestal.y ?? aTop + 40),
    pillars: [pillar],
    plates: [banner],
    logoAt: { x: logo.x, y: logo.y },
    wallSpots: [],
    decor: [],
  });
}

// ---------------------------------------------------------------- chat

export function layoutChat(w: number, h: number): ChatLayout {
  return orient(w, h) === 'landscape' ? chatLandscape(w, h) : chatPortrait(w, h);
}

function chatLandscape(w: number, h: number): ChatLayout {
  const inner = innerRect(w, h);
  const lc = clamp(Math.round(inner.w * 0.25), 100, 150);
  const px = Math.round(inner.x + lc / 2 - PED_W / 2);
  const py = inner.y + 4 + CHAR_ON_PED;
  const partner = seatAt(0, px, py, Math.min(lc - 8, 96), 9, lc);
  const pillar: Rect = { x: inner.x + 6, y: py + PED_H + 4, w: lc - 12, h: inner.y + inner.h - 4 - (py + PED_H + 4) };
  const divX = inner.x + lc + ARCH_T;
  const cy = inner.y + 46;
  const rise = 84;
  const arch: ArchSpec = { rect: { x: divX, y: cy - rise, w: (w + 40 - divX) * 2, h: inner.y + inner.h + 6 - (cy - rise) }, rise };
  const right = inner.x + inner.w - 6;
  const input: Rect = { x: divX + 6, y: inner.y + inner.h - 24, w: right - (divX + 6), h: 20 };
  // the fuse runs along the top frame from the right corner to a bomb above the bubbles
  const fuseY = Math.round(FRAME / 2);
  const bombX = divX + 34;
  const fuse: Point[] = [];
  for (let x = w - FRAME - 4; x >= bombX + 2; x--) fuse.push({ x, y: fuseY });
  const timer: Rect = { x: bombX - 20, y: inner.y + 3, w: 40, h: 11 };
  const messages: Rect = { x: divX + 6, y: inner.y + 28, w: right - (divX + 6), h: input.y - 4 - (inner.y + 28) };
  const layout: ChatLayout = { kind: 'chat', w, h, orientation: 'landscape', inner, partner, pillar, timer, fuse, messages, input, pillarText: pillarTextRect(pillar) };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(inner.y + inner.h * 0.66),
    pillars: [pillar],
    plates: [],
    wallSpots: [{ x: inner.x + 6, y: inner.y + 8 }, { x: inner.x + lc - 10, y: inner.y + 8 }],
    decor: [],
  });
}

function chatPortrait(w: number, h: number): ChatLayout {
  const inner = innerRect(w, h);
  const px = inner.x + 4;
  const py = inner.y + 2 + CHAR_ON_PED;
  const partner = seatAt(0, px, py, 64, 9, 56);
  const sideX = px + PED_W + 6;
  const right = inner.x + inner.w - 4;
  const bombX = sideX + 12;
  const fuseY = Math.round(FRAME / 2);
  const fuse: Point[] = [];
  for (let x = w - FRAME - 4; x >= bombX + 2; x--) fuse.push({ x, y: fuseY });
  const timer: Rect = { x: bombX - 8, y: inner.y + 2, w: 44, h: 11 };
  const pillar: Rect = { x: sideX, y: inner.y + 16, w: right - sideX, h: py + PED_H - (inner.y + 16) - 2 };
  const dTop = py + PED_H + 4 + ARCH_T;
  const aw = inner.w - 4 - ARCH_T * 2;
  const arch: ArchSpec = { rect: { x: inner.x + 2 + ARCH_T, y: dTop, w: aw, h: inner.y + inner.h + 6 - dTop }, rise: clamp(Math.round(aw * 0.16), 14, 36) };
  const input: Rect = { x: inner.x + 4, y: inner.y + inner.h - 24, w: inner.w - 8, h: 20 };
  const mTop = dTop + Math.round(arch.rise * 0.6);
  const messages: Rect = { x: arch.rect.x + 2, y: mTop, w: aw - 4, h: input.y - 4 - mTop };
  const layout: ChatLayout = { kind: 'chat', w, h, orientation: 'portrait', inner, partner, pillar, timer, fuse, messages, input, pillarText: pillarTextRect(pillar) };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(inner.y + inner.h * 0.7),
    pillars: [pillar],
    plates: [],
    wallSpots: [],
    decor: [],
  });
}

// ---------------------------------------------------------------- call

/** Wall areas left and right of a central arch, minus a DOM rect, for decoration. */
function sideDecor(inner: Rect, arch: Rect, avoid: Rect): Rect[] {
  const out: Rect[] = [];
  const lw = arch.x - ARCH_T - 6 - (inner.x + 6);
  const rw = inner.x + inner.w - 6 - (arch.x + arch.w + ARCH_T + 6);
  const top = arch.y + 22, bot = Math.min(avoid.y - 4, inner.y + inner.h - 10);
  if (lw >= 34 && bot - top > 30) out.push({ x: inner.x + 6, y: top, w: lw, h: bot - top });
  if (rw >= 34 && bot - top > 30) out.push({ x: arch.x + arch.w + ARCH_T + 6, y: top, w: rw, h: bot - top });
  return out;
}

export interface CallLayoutX extends CallLayout {
  yes: Rect;
  no: Rect;
}

export function layoutCall(w: number, h: number): CallLayoutX {
  const o = orient(w, h);
  const inner = innerRect(w, h);
  const k = 2;
  const cx = Math.round(inner.x + inner.w / 2);
  const question: Rect = { x: inner.x + 10, y: inner.y + 3, w: inner.w - 20, h: 18 };
  const timer: Rect = { x: cx - 30, y: question.y + question.h, w: 60, h: 11 };
  const charTop = timer.y + timer.h + (o === 'portrait' ? 10 : 0);
  const pedH = PED_H * k;
  const pedY = charTop + CHAR_ON_PED * k;
  const pedX = cx - (PED_W * k) / 2;
  const partner: SeatSlot = {
    index: 0,
    pedestal: { x: pedX, y: pedY, w: PED_W * k, h: pedH },
    char: { x: pedX + ((PED_W - 32) / 2) * k, y: charTop },
    label: { x: cx - 50, y: pedY + PLAQUE.y * k, w: 100, h: 14 },
    hit: { x: pedX, y: charTop, w: PED_W * k, h: CHAR_ON_PED * k + pedH },
  };
  const bh = o === 'portrait' ? 30 : 28;
  let by = pedY + pedH - 6;
  by = Math.min(by, inner.y + inner.h - bh - 3);
  const bw = clamp(inner.w - 20, 180, 280);
  const buttons: Rect = { x: cx - bw / 2, y: by, w: bw, h: bh };
  const yes: Rect = { x: buttons.x, y: by, w: Math.floor(bw / 2) - 4, h: bh };
  const no: Rect = { x: cx + 4, y: by, w: Math.floor(bw / 2) - 4, h: bh };
  const aw = clamp(Math.round(inner.w * (o === 'portrait' ? 0.8 : 0.44)), 150, 250);
  const aTop = Math.min(charTop + 6, timer.y + 4);
  const arch: ArchSpec = { rect: { x: cx - Math.round(aw / 2), y: aTop, w: aw, h: inner.y + inner.h + 6 - aTop }, rise: Math.round(aw * 0.3) };
  const layout: CallLayoutX = { kind: 'call', w, h, orientation: o, inner, partner, partnerScale: k, question, buttons, timer, yes, no };
  return done(layout, {
    arches: [arch],
    floorY: pedY + 14,
    pillars: [],
    plates: [],
    wallSpots: [
      { x: arch.rect.x - ARCH_T - 5, y: aTop + 14 },
      { x: arch.rect.x + aw + ARCH_T + 3, y: aTop + 14 },
    ],
    decor: sideDecor(inner, arch.rect, buttons),
  });
}

// ---------------------------------------------------------------- hall

export interface HallLayoutX extends HallLayout {
  title: Rect;
}

export function layoutHall(w: number, h: number, n = 0): HallLayoutX {
  const o = orient(w, h);
  const inner = innerRect(w, h);
  const logo: Rect = { x: Math.round(inner.x + inner.w / 2 - LOGO_W / 2), y: inner.y + 3, w: LOGO_W, h: LOGO_H };
  const title: Rect = { x: inner.x + 10, y: logo.y + logo.h + 2, w: inner.w - 20, h: 14 };
  const top = title.y + title.h + 2;
  const seats: SeatSlot[] = [];
  const aTop = logo.y + logo.h + ARCH_T + 4;
  const aw = inner.w - 20 - ARCH_T * 2;
  const arch: ArchSpec = { rect: { x: inner.x + 10 + ARCH_T, y: aTop, w: aw, h: inner.y + inner.h + 6 - aTop }, rise: clamp(Math.round(aw * 0.12), 14, 40) };
  let content: Rect = { x: inner.x + 8, y: top, w: inner.w - 16, h: inner.y + inner.h - 6 - top };
  if (n > 0) {
    const labelH = 22;
    const perRow = o === 'landscape' ? Math.min(n, Math.max(1, Math.floor((aw - 8) / 62))) : Math.min(n, Math.max(1, Math.floor((aw - 4) / 70)));
    const rows = Math.ceil(n / perRow);
    const cell = (aw - 6) / perRow;
    const bottom = inner.y + inner.h;
    const rowH = CHAR_ON_PED + PED_H + labelH - 8;
    const avail = bottom - 4 - top - 8;
    const pitch = clamp(Math.floor(avail / rows), 56, rowH + 16);
    const startY = bottom - 2 - labelH - (rows - 1) * pitch - PED_H + 8;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(perRow, n - r * perRow);
      const off = ((perRow - inRow) * cell) / 2;
      for (let c = 0; c < inRow; c++) {
        const i = r * perRow + c;
        const pxx = Math.round(arch.rect.x + 3 + off + cell * (c + 0.5) - PED_W / 2);
        const pyy = startY + r * pitch;
        const s = seatAt(i, pxx, pyy, Math.min(cell - 2, 90), labelH, cell);
        s.label = { x: Math.round(pxx + PED_W / 2 - Math.min(cell - 2, 90) / 2), y: pyy + PED_H - 6, w: Math.min(cell - 2, 90), h: labelH };
        s.hit = { x: s.label.x, y: s.char.y + 4, w: s.label.w, h: s.label.y + labelH - (s.char.y + 4) };
        seats.push(s);
      }
    }
    content = { x: inner.x + 8, y: top, w: inner.w - 16, h: Math.max(10, seats[0].char.y - top) };
  }
  const layout: HallLayoutX = { kind: 'hall', w, h, orientation: o, inner, logo, content, seats, title };
  return done(layout, {
    arches: [arch],
    floorY: seats.length ? seats[seats.length - 1].pedestal.y + 4 : inner.y + inner.h - 40,
    pillars: [],
    plates: [],
    logoAt: { x: logo.x, y: logo.y },
    wallSpots: [
      { x: arch.rect.x - ARCH_T - 5, y: aTop + 8 },
      { x: arch.rect.x + aw + ARCH_T + 3, y: aTop + 8 },
    ],
    decor: [],
  });
}
