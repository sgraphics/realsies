// Scene contract shared by the art engine and the web app.
// The world is drawn at a small logical resolution ("game pixels") and scaled up by an integer
// number of device pixels. Layout functions return rects in game pixels; the web app places
// DOM overlays (text, buttons, inputs) at rect * cssPx. The scale itself is chosen by
// chooseScale() in layout.ts: the largest integer at which the lobby composition fits.

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

export interface ScaleInfo {
  /** Device pixels per game pixel (integer >= 1). */
  scale: number;
  /** CSS pixels per game pixel (scale / devicePixelRatio). */
  cssPx: number;
  /** Logical size in game pixels (covers the world box; the last column/row may be partly off-screen). */
  w: number;
  h: number;
  /** Composition: 5 x 2 pedestals (landscape) or 2 x 5 (portrait). */
  orientation: Orientation;
  /**
   * CSS px from the top of the window to the top of the canvas. With a HUD the top frame bar sits
   * under the HUD, so this is the HUD height minus the frame (negative when the frame is taller).
   */
  top: number;
}

/** One seat in a room composition. `char` is the top-left of the 32x48 character box. */
export interface SeatSlot {
  index: number;
  pedestal: Rect; // pedestal sprite rect (48 x 24 times `scale`)
  char: Point; // top-left of the character box (feet land on the pedestal top)
  label: Rect; // where the DOM gamertag tag goes: centred beneath the pedestal
  hit: Rect; // tap target covering character + pedestal + tag
  /** Integer upscale of character and pedestal (2 for the big partner in chat and call). */
  scale?: number;
}

/** How a gamertag tag is sized: height in game px and 1 or 2 lines (word, then digits). */
export interface LabelSpec {
  h: number;
  lines: 1 | 2;
}

export interface LobbyLayout {
  kind: 'lobby';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect; // inside the foreground frame (its top edge sits right under the HUD)
  arch: Rect; // the arch opening housing the pedestals
  seats: SeatSlot[];
  label: LabelSpec;
  /** True when the composition fits without squeezing rows into each other. */
  fit: boolean;
}

export interface ChatLayout {
  kind: 'chat';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  partner: SeatSlot; // partner on a pedestal (left in landscape, top-left on phones)
  partnerScale: number;
  /** The left box: chat facts, a DOM panel sized to its content, aligned to the top of this rect. */
  info: Rect;
  /** Bubbles and the input row (DOM column: messages grow, input at the bottom). */
  chat: Rect;
  fuse: Point[]; // fuse path in game pixels, from the burning end at progress 1 to the bomb at progress 0
  label: LabelSpec;
}

export interface CallLayout {
  kind: 'call';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  partner: SeatSlot;
  partnerScale: number;
  question: Rect; // DOM "Real human?" panel with the countdown
  buttons: Rect; // DOM YES / NO
  yes: Rect;
  no: Rect;
  /** Where the "Locked until the round ends" panel goes (under the partner). */
  locked: Rect;
  label: LabelSpec;
}

/** A plain themed room for the test-user picker (who are you). */
export interface HallLayout {
  kind: 'hall';
  w: number;
  h: number;
  orientation: Orientation;
  inner: Rect;
  seats: SeatSlot[]; // the six test users, top-aligned
  /** Free area under the characters for a DOM panel. */
  content: Rect;
  label: LabelSpec;
  /** True when every character and tag fits. */
  fit: boolean;
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
