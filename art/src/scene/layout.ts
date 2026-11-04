// Layouts in game pixels for every screen composition, both orientations, any logical size.
// Rects returned here are where the web app puts its DOM overlay. chooseScale() picks the largest
// integer scale at which the lobby (or the test-user hall) fits under the HUD; the other screens
// use the same scale so the pixel size never jumps between screens.

import type { CallLayout, ChatLayout, HallLayout, LabelSpec, LobbyLayout, Orientation, Point, Rect, ScaleInfo, SeatSlot } from './types.ts';

/** Foreground frame thickness on every side (the top bar sits under the HUD when there is one). */
export const FRAME = 14;
/** Arch border thickness drawn outside each opening. */
export const ARCH_T = 8;
export const PED_W = 48;
export const PED_H = 24;
/** Character box top relative to the pedestal top (feet at row 45 land on the pedestal's top face). */
export const CHAR_ON_PED = 40;
/** Gamertag tag top relative to the pedestal top: just under the solid part, over the faded-out base. */
export const LABEL_DY = 18;
/** Rows at the top of a character box that may touch the tag of the row behind (the median head starts at row 3). */
const HEAD_SLACK = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function innerRect(w: number, h: number): Rect {
  return { x: FRAME, y: FRAME, w: w - FRAME * 2, h: h - FRAME * 2 };
}

function orient(w: number, h: number): Orientation {
  return w >= h ? 'landscape' : 'portrait';
}

export interface LayoutOpts {
  /** CSS px per game px: sizes the DOM tags and panels in game px. Default 2. */
  cssPx?: number;
  /** Composition (chooseScale decides it once for every screen). Default: from the aspect. */
  orientation?: Orientation;
  /** Call screen after the call: no question panel, the partner moves up. */
  locked?: boolean;
}

/**
 * Tag size for a gamertag under a pedestal, in game px. One line holds an 11-character tag
 * (Pickle435) at a readable size; when the cell is too narrow in CSS px it becomes two lines
 * (word, then digits).
 */
export function labelSpec(cellW: number, cssPx: number, lines?: 1 | 2): LabelSpec {
  const k = Math.max(0.25, cssPx);
  const one = clamp(Math.round(k * 9), 17, 38); // CSS px of a one-line tag (grows with the room's zoom)
  const n: 1 | 2 = lines ?? (cellW * k < 82 ? 2 : 1); // 11 characters need about 82 CSS px at 11 px
  const css = n === 1 ? one : Math.round(one * 1.8);
  return { h: Math.max(7, Math.ceil(css / k)), lines: n };
}

/** A seat on a pedestal whose top-left is (px, py); the tag is centred beneath the pedestal. */
export function seatAt(index: number, px: number, py: number, cellW: number, lab: LabelSpec, k = 1): SeatSlot {
  const pw = PED_W * k;
  const cx = px + pw / 2;
  const lw = Math.max(pw - 4, Math.floor(cellW - 2));
  const label: Rect = { x: Math.round(cx - lw / 2), y: py + LABEL_DY * k, w: lw, h: lab.h };
  const charTop = py - CHAR_ON_PED * k;
  const hw = Math.max(pw, Math.floor(cellW - 2));
  return {
    index,
    pedestal: { x: px, y: py, w: pw, h: PED_H * k },
    char: { x: px + 8 * k, y: charTop },
    label,
    hit: { x: Math.round(cx - hw / 2), y: charTop + 2 * k, w: hw, h: label.y + label.h - (charTop + 2 * k) },
    scale: k,
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
  /** Pillar-like canvas columns to draw (none since the HUD carries the stats). */
  pillars: Rect[];
  /** Plates drawn on canvas (none since the HUD carries the level banner). */
  plates: Rect[];
  /** Logo top-left, if drawn on the canvas (the HUD draws it now). */
  logoAt?: Point;
  /** Where wall-mounted props may go (chat: either side of the partner). */
  wallSpots: Point[];
  /** Big empty wall areas a theme may decorate (shields, vines, murals). */
  decor: Rect[];
  /** The area the eye should land on; the renderer dims the room away from it. */
  focus: Rect;
  /** Extra dimming behind DOM text that sits on the world (chat bubbles). */
  calm: Rect[];
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
  const a = l as { kind?: string; w: number; h: number; orientation?: Orientation; seats?: unknown[] };
  const o = { orientation: a.orientation };
  const again =
    a.kind === 'lobby' ? layoutLobby(a.w, a.h, a.seats?.length ?? 10, o) :
    a.kind === 'chat' ? layoutChat(a.w, a.h, o) :
    a.kind === 'call' ? layoutCall(a.w, a.h, o) :
    layoutHall(a.w, a.h, a.seats?.length ?? 0, o);
  return EXTRAS.get(again)!;
}

// ---------------------------------------------------------------- scale

/** Largest scale tried (4K monitors at 1 dppx land around 10 to 12). */
const MAX_SCALE = 12;

/**
 * The world scale for a window: the largest integer number of device pixels per game pixel at
 * which the composition fits in the box under the HUD (`hud` CSS px tall; its top frame bar
 * hides under the HUD). Lobby, chat and call share the lobby's scale; the hall checks its own.
 */
export function chooseScale(cssW: number, cssH: number, dpr = 1, hud = 0, kind: 'lobby' | 'hall' = 'lobby'): ScaleInfo {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(Math.max(1, cssH - hud) * dpr));
  const hidden = hud > 0 ? FRAME : 0;
  const pref: Orientation = cssW >= cssH - hud ? 'landscape' : 'portrait';
  const make = (s: number, orientation: Orientation): ScaleInfo => {
    const cssPx = s / dpr;
    return { scale: s, cssPx, w: Math.ceil(devW / s), h: Math.ceil(devH / s) + hidden, orientation, top: hud - hidden * cssPx };
  };
  const fits = (si: ScaleInfo, orientation: Orientation): boolean => {
    const o = { cssPx: si.cssPx, orientation };
    return kind === 'hall' ? layoutHall(si.w, si.h, 6, o).fit : layoutLobby(si.w, si.h, 10, o).fit;
  };
  for (let s = MAX_SCALE; s >= 1; s--) {
    const si = make(s, pref);
    const okL = fits(si, 'landscape');
    const okP = fits(si, 'portrait');
    if (!okL && !okP) continue;
    return make(s, okL && okP ? pref : okL ? 'landscape' : 'portrait');
  }
  return make(1, pref);
}

// ---------------------------------------------------------------- lobby

/**
 * Ten pedestals under an arch that spans the room: 5 x 2 in landscape, 2 x 5 in portrait. Rows
 * are spaced so the heads in front never sit under the tags of the row behind; spare height goes
 * mostly above the back row (under the arch) and a little below the front tags.
 */
export function layoutLobby(w: number, h: number, n = 10, o: LayoutOpts = {}): LobbyLayout {
  const orientation = o.orientation ?? orient(w, h);
  const cssPx = o.cssPx ?? 2;
  const land = orientation === 'landscape';
  const inner = innerRect(w, h);
  const cols = land ? (n > 5 ? Math.ceil(n / 2) : Math.max(1, n)) : n > 5 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(n / cols));
  const ax = inner.x + 2 + ARCH_T;
  const aw = inner.w - 4 - ARCH_T * 2;
  const aTop = inner.y + 2 + ARCH_T;
  const cell = Math.min(land ? 80 : 100, (aw - 6) / cols);
  const minCell = land ? 52 : 56;
  const lab = labelSpec(cell, cssPx);
  const lb = LABEL_DY + lab.h; // tag bottom below the pedestal top
  const minPitch = CHAR_ON_PED - HEAD_SLACK + lb;
  const maxPitch = minPitch + 10;
  const frontMax = inner.y + inner.h - 1 - lb;
  // heads of the outer back-row characters clear the arch cap
  const gridW = cell * cols;
  const gx = ax + 3 + (aw - 6 - gridW) / 2;
  const nx = Math.min(0.995, Math.abs(gx + cell / 2 - 12 - (ax + aw / 2)) / Math.max(1, aw / 2));
  const capK = 1 - Math.sqrt(1 - nx * nx);
  const riseMax = clamp(Math.round(aw * (land ? 0.14 : 0.22)), 14, 44);
  const riseMin = 10;
  const room = frontMax - (aTop + CHAR_ON_PED - HEAD_SLACK); // for (rows - 1) pitches + the cap depth
  let rise = riseMax;
  let pitch = rows > 1 ? Math.floor((room - capK * rise) / (rows - 1)) : 0;
  if (rows > 1 && pitch < minPitch) {
    rise = clamp(Math.floor((room - minPitch * (rows - 1)) / Math.max(0.05, capK)), riseMin, riseMax);
    pitch = Math.floor((room - capK * rise) / (rows - 1));
  }
  if (rows > 1) pitch = Math.min(pitch, maxPitch);
  const fit = cell >= minCell && (rows === 1 || pitch >= minPitch) && room - capK * rise >= 0;
  if (rows > 1) pitch = Math.max(pitch, 40);
  const slack = Math.max(0, room - capK * rise - pitch * (rows - 1));
  const frontY = Math.round(frontMax - slack * 0.35);
  const seats: SeatSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const py = frontY - (rows - 1 - r) * pitch;
    const inRow = Math.min(cols, n - r * cols);
    const rowOff = ((cols - inRow) * cell) / 2;
    for (let c = 0; c < inRow; c++) {
      const i = r * cols + c;
      const px = Math.round(gx + rowOff + cell * (c + 0.5) - PED_W / 2);
      seats.push(seatAt(i, px, py, cell, lab));
    }
  }
  const arch: ArchSpec = { rect: { x: ax, y: aTop, w: aw, h: inner.y + inner.h + 6 - aTop }, rise };
  const backY = seats[0]?.pedestal.y ?? frontY;
  const floorY = land ? backY + 4 : seats[Math.max(0, seats.length - 2 * cols)]?.pedestal.y ?? backY;
  const top = (seats[0]?.char.y ?? aTop) - 2;
  const focus: Rect = { x: gx, y: top, w: gridW, h: frontY + lb - top };
  const layout: LobbyLayout = { kind: 'lobby', w, h, orientation, inner, arch: arch.rect, seats, label: lab, fit };
  return done(layout, { arches: [arch], floorY, pillars: [], plates: [], wallSpots: [], decor: [], focus, calm: [] });
}

// ---------------------------------------------------------------- chat

export function layoutChat(w: number, h: number, o: LayoutOpts = {}): ChatLayout {
  const orientation = o.orientation ?? orient(w, h);
  return orientation === 'landscape' ? chatLandscape(w, h, o.cssPx ?? 2) : chatPortrait(w, h, o.cssPx ?? 2);
}

/** Fuse along the top of the room (just under the HUD), from the right end to a bomb at `bombX`. */
function fuseFrom(w: number, y: number, bombX: number): Point[] {
  const out: Point[] = [];
  for (let x = w - FRAME - 6; x >= bombX + 12; x--) out.push({ x, y });
  return out;
}

function chatLandscape(w: number, h: number, cssPx: number): ChatLayout {
  const inner = innerRect(w, h);
  // the bubbles keep at least 420 CSS px; the partner's column takes up to a third of the room
  const chatMin = Math.ceil(420 / cssPx);
  const lc = clamp(Math.min(Math.round(inner.w * 0.36), inner.w - 8 - ARCH_T - chatMin), 92, 150);
  const lab = labelSpec(lc - 8, cssPx);
  const infoMin = Math.ceil(72 / cssPx); // the left box needs about 72 CSS px
  const big = lc >= 104 && inner.h >= 2 + (CHAR_ON_PED + LABEL_DY) * 2 + Math.ceil(lab.h * 1.4) + 3 + infoMin;
  const k = big ? 2 : 1;
  const px = Math.round(inner.x + lc / 2 - (PED_W * k) / 2);
  const py = inner.y + (k === 2 ? 2 : 4) + CHAR_ON_PED * k;
  const tag = k === 2 ? { ...lab, h: Math.ceil(lab.h * 1.4) } : lab;
  const partner = seatAt(0, px, py, lc - 6, tag, k);
  const iy = partner.label.y + tag.h + 3;
  const info: Rect = { x: inner.x + 4, y: iy, w: lc - 8, h: inner.y + inner.h - 3 - iy };
  const divX = inner.x + lc + ARCH_T;
  const cy = inner.y + 34;
  const rise = 74;
  const arch: ArchSpec = { rect: { x: divX, y: cy - rise, w: (w + 40 - divX) * 2, h: inner.y + inner.h + 6 - (cy - rise) }, rise };
  const right = inner.x + inner.w - 4;
  const fuse = fuseFrom(w, inner.y + 6, divX + 6);
  const chat: Rect = { x: divX + 4, y: inner.y + 18, w: right - (divX + 4), h: inner.y + inner.h - 3 - (inner.y + 18) };
  const layout: ChatLayout = { kind: 'chat', w, h, orientation: 'landscape', inner, partner, partnerScale: k, info, chat, fuse, label: tag };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(inner.y + inner.h * 0.62),
    pillars: [],
    plates: [],
    wallSpots: [{ x: inner.x + 6, y: inner.y + 10 }, { x: inner.x + lc - 10, y: inner.y + 10 }],
    decor: [],
    focus: { x: inner.x, y: inner.y, w: inner.w, h: inner.h },
    calm: [chat],
  });
}

function chatPortrait(w: number, h: number, cssPx: number): ChatLayout {
  const inner = innerRect(w, h);
  const px = inner.x + 4;
  const py = inner.y + 4 + CHAR_ON_PED;
  const lab = labelSpec(PED_W + 10, cssPx);
  const partner = seatAt(0, px, py, PED_W + 10, lab, 1);
  partner.label.x = Math.max(inner.x + 1, partner.label.x);
  partner.hit.x = Math.max(inner.x, partner.hit.x);
  const sideX = px + PED_W + 6;
  const right = inner.x + inner.w - 4;
  const fuse = fuseFrom(w, inner.y + 6, sideX);
  const iy = inner.y + 20;
  const info: Rect = { x: sideX, y: iy, w: right - sideX, h: Math.max(16, partner.label.y + lab.h - iy) };
  const dTop = partner.label.y + lab.h + 4 + ARCH_T;
  const aw = inner.w - 4 - ARCH_T * 2;
  const arch: ArchSpec = { rect: { x: inner.x + 2 + ARCH_T, y: dTop, w: aw, h: inner.y + inner.h + 6 - dTop }, rise: clamp(Math.round(aw * 0.14), 12, 32) };
  const mTop = dTop + Math.round(arch.rise * 0.4);
  const chat: Rect = { x: inner.x + 4, y: mTop, w: inner.w - 8, h: inner.y + inner.h - 3 - mTop };
  const layout: ChatLayout = { kind: 'chat', w, h, orientation: 'portrait', inner, partner, partnerScale: 1, info, chat, fuse, label: lab };
  return done(layout, {
    arches: [arch],
    floorY: Math.round(inner.y + inner.h * 0.72),
    pillars: [],
    plates: [],
    wallSpots: [],
    decor: [],
    focus: { x: inner.x, y: inner.y, w: inner.w, h: inner.h },
    calm: [chat],
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

export type CallLayoutX = CallLayout;

export function layoutCall(w: number, h: number, o: LayoutOpts = {}): CallLayout {
  const orientation = o.orientation ?? orient(w, h);
  const cssPx = o.cssPx ?? 2;
  const land = orientation === 'landscape';
  const inner = innerRect(w, h);
  const cx = Math.round(inner.x + inner.w / 2);
  const qH = o.locked ? 0 : clamp(Math.ceil(76 / cssPx), 14, 44); // "Real human?" + countdown
  const question: Rect = { x: inner.x + 6, y: inner.y + 4, w: inner.w - 12, h: qH };
  // after the call the buttons' place holds the locked panel (about 220 CSS px tall when under the partner)
  const bH = o.locked && !land ? clamp(Math.ceil(220 / cssPx), 40, 140) : clamp(Math.ceil(64 / cssPx), 16, 40);
  const lab = labelSpec(120, cssPx);
  const avail = inner.y + inner.h - 4 - bH - 4 - (question.y + qH + 4);
  const need = (k: number) => (CHAR_ON_PED + LABEL_DY) * k + Math.ceil(lab.h * (k === 2 ? 1.4 : 1));
  const k = avail >= need(2) + 4 ? 2 : 1;
  const charTop = question.y + qH + 4 + Math.max(0, Math.floor((avail - need(k)) * 0.45));
  const pedY = charTop + CHAR_ON_PED * k;
  const pedX = cx - (PED_W * k) / 2;
  const big = k === 2 ? { ...lab, h: Math.ceil(lab.h * 1.4) } : lab; // a bigger tag under the big partner
  const partner = seatAt(0, pedX, pedY, Math.min(inner.w - 8, 160), big, k);
  const by = Math.min(partner.label.y + big.h + 4, inner.y + inner.h - 2 - bH);
  const bw = Math.min(inner.w - 20, 300, Math.max(150, Math.ceil(560 / cssPx))); // at most ~560 CSS px wide
  const buttons: Rect = { x: cx - bw / 2, y: by, w: bw, h: bH };
  const yes: Rect = { x: buttons.x, y: by, w: Math.floor(bw / 2) - 4, h: bH };
  const no: Rect = { x: cx + 4, y: by, w: Math.floor(bw / 2) - 4, h: bH };
  // the locked panel: beside the partner on wide screens, under it on tall ones
  const sideX = cx + (PED_W * k) / 2 + 10;
  const sideW = inner.x + inner.w - 6 - sideX;
  const lockedSide = land && sideW * cssPx >= 230;
  const locked: Rect = lockedSide
    ? { x: sideX, y: inner.y + 6, w: sideW, h: inner.h - 12 }
    : { x: inner.x + 6, y: by, w: inner.w - 12, h: inner.y + inner.h - 3 - by };
  const aw = clamp(Math.round(inner.w * (land ? 0.44 : 0.8)), 110, 260);
  const aTop = Math.max(inner.y + 2 + ARCH_T, charTop - 6);
  const arch: ArchSpec = { rect: { x: cx - Math.round(aw / 2), y: aTop, w: aw, h: inner.y + inner.h + 6 - aTop }, rise: Math.round(aw * 0.3) };
  const layout: CallLayout = { kind: 'call', w, h, orientation, inner, partner, partnerScale: k, question, buttons, yes, no, locked, label: big };
  return done(layout, {
    arches: [arch],
    floorY: pedY + 7 * k,
    pillars: [],
    plates: [],
    wallSpots: [
      { x: arch.rect.x - ARCH_T - 5, y: aTop + 14 },
      { x: arch.rect.x + aw + ARCH_T + 3, y: aTop + 14 },
    ],
    decor: sideDecor(inner, arch.rect, lockedSide ? { ...buttons, y: inner.y + inner.h } : buttons),
    focus: { x: pedX - 8, y: charTop, w: PED_W * k + 16, h: partner.label.y + big.h - charTop },
    calm: [],
  });
}

// ---------------------------------------------------------------- hall

/**
 * The test-user picker: six characters on pedestals right under the HUD (one row of six on
 * wide screens, 3 x 2 or 2 x 3 elsewhere), two-line tags (name, coins and rating), and a free
 * area under them for a DOM panel.
 */
export function layoutHall(w: number, h: number, n = 6, o: LayoutOpts = {}): HallLayout {
  const orientation = o.orientation ?? orient(w, h);
  const cssPx = o.cssPx ?? 2;
  const land = orientation === 'landscape';
  const inner = innerRect(w, h);
  const ax = inner.x + 2 + ARCH_T;
  const aw = inner.w - 4 - ARCH_T * 2;
  const aTop = inner.y + 2 + ARCH_T;
  const count = Math.max(1, n);
  let cols = land ? ((aw - 6) / count >= 60 ? count : Math.ceil(count / 2)) : (aw - 6) / 3 >= 60 && count > 4 ? 3 : 2;
  cols = Math.max(1, Math.min(cols, count));
  const rows = Math.ceil(count / cols);
  const cell = Math.min(land ? 104 : 120, (aw - 6) / cols);
  const lab = labelSpec(cell, cssPx, 2);
  const lb = LABEL_DY + lab.h;
  const pitch = CHAR_ON_PED - HEAD_SLACK + lb + 6;
  const rise = clamp(Math.round(aw * 0.1), 12, 30);
  const firstY = aTop + Math.round(rise * 0.5) + CHAR_ON_PED;
  const gridW = cell * cols;
  const gx = ax + 3 + (aw - 6 - gridW) / 2;
  const seats: SeatSlot[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, count - r * cols);
    const off = ((cols - inRow) * cell) / 2;
    for (let c = 0; c < inRow; c++) {
      const i = r * cols + c;
      seats.push(seatAt(i, Math.round(gx + off + cell * (c + 0.5) - PED_W / 2), firstY + r * pitch, cell, lab));
    }
  }
  const lastBottom = firstY + (rows - 1) * pitch + lb;
  const fit = n === 0 || (cell >= 54 && lastBottom <= inner.y + inner.h - 2);
  const cy = lastBottom + 6;
  const content: Rect = { x: inner.x + 8, y: cy, w: inner.w - 16, h: Math.max(0, inner.y + inner.h - 4 - cy) };
  const arch: ArchSpec = { rect: { x: ax, y: aTop, w: aw, h: inner.y + inner.h + 6 - aTop }, rise };
  const layout: HallLayout = { kind: 'hall', w, h, orientation, inner, seats, content, label: lab, fit };
  const top = (seats[0]?.char.y ?? aTop) - 2;
  return done(layout, {
    arches: [arch],
    floorY: seats.length ? seats[seats.length - 1].pedestal.y + 4 : inner.y + inner.h - 40,
    pillars: [],
    plates: [],
    wallSpots: [],
    decor: [],
    focus: { x: gx, y: top, w: gridW, h: lastBottom - top },
    calm: [],
  });
}

export type HallLayoutX = HallLayout;
