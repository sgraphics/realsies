// Scene contract shared by the art engine and the web app.
// The world is drawn at a small logical resolution ("game pixels") and scaled up by an integer
// number of device pixels. Layout functions return rects in game pixels; the web app places
// DOM overlays (text, buttons, inputs) at rect * cssPx.

import type { ThemeId } from '../../../shared/protocol.ts';
import type { Rig } from '../rig/rig.ts';

export type { ThemeId };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Orientation = 'landscape' | 'portrait';

/** Minimum logical size per orientation; the scale is the largest integer that keeps both dims at or above it. */
export const MIN_LANDSCAPE = { w: 400, h: 225 };
export const MIN_PORTRAIT = { w: 225, h: 400 };

export interface ScaleInfo {
  /** Device pixels per game pixel (integer >= 1). */
  scale: number;
  /** CSS pixels per game pixel (scale / devicePixelRatio). */
  cssPx: number;
  /** Logical size in game pixels (covers the whole viewport, the last column/row may be partly off-screen). */
  w: number;
  h: number;
  orientation: Orientation;
}

export function chooseScale(cssW: number, cssH: number, dpr = 1): ScaleInfo {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  const orientation: Orientation = cssW >= cssH ? 'landscape' : 'portrait';
  const min = orientation === 'landscape' ? MIN_LANDSCAPE : MIN_PORTRAIT;
  const scale = Math.max(1, Math.floor(Math.min(devW / min.w, devH / min.h)));
  return { scale, cssPx: scale / dpr, w: Math.ceil(devW / scale), h: Math.ceil(devH / scale), orientation };
}

/** One seat in a room composition. `char` is the top-left of the 32x48 character box. */
export interface SeatSlot {
  index: number;
  pedestal: Rect; // pedestal sprite rect
  char: Point; // top-left of the character box (feet land on the pedestal top)
  label: Rect; // where the DOM gamertag goes (under or beside the pedestal)
  hit: Rect; // tap target covering character + pedestal
}

export interface LobbyLayout {
  kind: 'lobby';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect; // inside the foreground frame
  logo: Rect; // canvas-drawn REALSIES logo
  banner: Rect; // level banner plate (DOM text: "Level 1 · Castle Dungeon")
  tabs: Rect; // level tabs 1-3 (DOM buttons)
  pillar: Rect; // stat pillar (canvas column, DOM text on top)
  arch: Rect; // the arch opening housing the pedestals
  seats: SeatSlot[];
  actions: Rect; // Results / Past rounds buttons (DOM)
  /** Text-safe area on the pillar's dark panel (above `actions` in landscape). */
  pillarText?: Rect;
}

export interface ChatLayout {
  kind: 'chat';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  partner: SeatSlot; // partner on a pedestal (top left; top on phones)
  pillar: Rect; // stats under the partner (landscape) or beside it (portrait)
  timer: Rect; // DOM "1:42" label
  fuse: Point[]; // fuse path in game pixels, from the burning end at progress 1 to the bomb at progress 0
  messages: Rect; // DOM bubble list
  input: Rect; // DOM input row
  /** Text-safe area on the pillar's dark panel. */
  pillarText?: Rect;
}

export interface CallLayout {
  kind: 'call';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  partner: SeatSlot; // drawn at 2x
  partnerScale: number;
  question: Rect; // DOM "Real human?"
  buttons: Rect; // DOM YES / NO
  timer: Rect;
}

/** A plain themed room for overlay screens (who are you, results, past rounds). */
export interface HallLayout {
  kind: 'hall';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  logo: Rect;
  content: Rect; // DOM panel area
  seats: SeatSlot[]; // optional characters (e.g. six test users)
}

export type AnyLayout = LobbyLayout | ChatLayout | CallLayout | HallLayout;

export type PedestalState = 'empty' | 'occupied' | 'selected';
/** How a seat is drawn: idle character, glowing selection, dimmed (already called), or empty pedestal. */
export type SeatLook = 'idle' | 'selected' | 'dim' | 'empty';

export interface SceneSeat {
  rig: Rig | null;
  look: SeatLook;
  hover?: boolean;
}

export interface SceneState {
  now: number; // ms
  reducedMotion?: boolean;
  seats?: SceneSeat[]; // lobby and hall, by slot index
  partner?: Rig | null; // chat and call
  /** Chat timer, 1 = full fuse, 0 = burnt out. */
  fuse?: number;
}
