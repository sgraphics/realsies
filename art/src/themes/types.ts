// Theme kit contract. Each theme paints the static room (deep backdrop, wall, arch border, frame,
// pillar, plates), provides pedestal sprites and a list of animated props for a layout, and a
// DOM-facing UI kit (9-slice sprites + CSS colours).

import type { ThemeId } from '../../../shared/protocol.ts';
import type { Rgba } from '../core/buffer.ts';
import type { Color } from '../core/palette.ts';
import type { AnyLayout, Point, Rect } from '../scene/types.ts';
import type { LayoutExtras } from '../scene/layout.ts';
import type { Clip, Opening, Paint } from './util.ts';

export interface NineSlice {
  img: Rgba;
  /** Border width in source pixels on every side (CSS border-image-slice). */
  slice: number;
  /** Suggested content padding in game pixels. */
  pad: number;
}

export interface ButtonSet {
  up: NineSlice;
  down: NineSlice;
  disabled: NineSlice;
}

export interface UiKit {
  panel: NineSlice;
  button: ButtonSet;
  buttonPrimary: ButtonSet;
  buttonYes: ButtonSet;
  buttonNo: ButtonSet;
  bubbleThem: NineSlice;
  bubbleMe: NineSlice;
  /** Tail sprites: them = bottom-left of the bubble pointing left, me = bottom-right pointing right. */
  tailThem: Rgba;
  tailMe: Rgba;
  plate: NineSlice;
  /** Small tab (level tabs): up and active. */
  tab: { up: NineSlice; active: NineSlice };
}

/** CSS-facing colours as #rrggbb strings. */
export interface ThemeColors {
  text: string;
  textDim: string;
  accent: string;
  panelText: string;
  bubbleThemText: string;
  bubbleMeText: string;
  bg: string;
  /** Text on the canvas banner plate (lobby level banner). */
  plateText: string;
  /** Gamertag text on the dark tags under the pedestals. */
  labelText: string;
  /** Outline/shadow colour for DOM text over the world. */
  textShadow: string;
  good: string;
  bad: string;
}

export interface ScenePlan {
  layout: AnyLayout;
  extras: LayoutExtras;
  openings: Opening[];
  /** Inside the main opening (pixels that show the deep layer). */
  inside: (x: number, y: number) => boolean;
}

export interface Prop {
  /** far = behind walls (deep layer only), mid = over walls, near = in front of characters. */
  layer: 'far' | 'mid' | 'near';
  /** For QA sheets: a name and the rough area the prop animates in. */
  name?: string;
  /** A light source (flame, glowing crystal, console lights, stars): drawn at full brightness in the dimmed room. */
  lit?: boolean;
  at?: Rect;
  draw(c: Clip, now: number): void;
}

export interface PedestalSprites {
  empty: Rgba;
  occupied: Rgba;
  dim: Rgba;
  /** Animated selection glow frames (pedestal included). */
  selected: Rgba[];
  /** Hover highlight. */
  hover: Rgba;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  colors: ThemeColors;
  /** Rise of an arch cap for an opening rect (0 = flat lintel). `kind` = layout kind. */
  archRise(r: Rect, suggested: number, kind: AnyLayout['kind']): number;
  /** Boundary roughness for openings (cave). */
  jag?: number;
  paintDeep(p: Paint, plan: ScenePlan): void;
  paintWall(p: Paint, plan: ScenePlan): void;
  paintArch(p: Paint, o: Opening, plan: ScenePlan): void;
  paintFrame(p: Paint): void;
  paintPillar(p: Paint, r: Rect, plan: ScenePlan): void;
  paintPlate(p: Paint, r: Rect): void;
  /** Build props for the plan; may paint their static parts into `p`. */
  props(p: Paint, plan: ScenePlan): Prop[];
  pedestalSprites(): PedestalSprites;
  ui(): UiKit;
  /** Fuse look. */
  fuse: { rope: [Color, Color]; burnt: Color };
  /** Glow colours (selected pedestal beam etc.), light to dark. */
  glow: [Color, Color, Color];
  /**
   * How far the room is dimmed behind the characters and bubbles, in palette steps per depth layer
   * (deep backdrop, wall, arch border, frame) plus a vignette away from the focus. Bright themes dim more.
   */
  dim?: Partial<RoomDim>;
}

export interface RoomDim {
  deep: number;
  wall: number;
  arch: number;
  frame: number;
  vignette: number;
}

export type { Point };
