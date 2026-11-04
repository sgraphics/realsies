// Layout of the full-screen countdown in CSS px for a viewport: the two VS doors (art-engine pixels
// of u device px each), the fighters standing at the bottom left and right on their doors with name
// plates beneath, VS between the plates, the "Chat starts in 3" banner at the top, and the numeral
// (and CHAT!) in the middle, every sprite at a whole number of device pixels. Pure, for the tests.

import { CHAR_H, CHAR_W } from '../../../art/src/rig/rig.ts';
import { CD_GO, CD_NUM, CD_VS } from '../../../art/src/ui/countdown.ts';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sprite {
  /** Centre in CSS px. */
  cx: number;
  cy: number;
  /** Device px per sprite pixel. */
  k: number;
}

export interface CountdownLayout {
  w: number;
  h: number;
  dpr: number;
  portrait: boolean;
  /** Device px per door and fighter pixel. */
  u: number;
  /** Door images in their own pixels (they cover the viewport, cropped at the right and bottom). */
  door: { w: number; h: number; cx: number; cy: number; seamTop: number; seamBottom: number };
  me: Box;
  them: Box;
  mePlate: Box;
  themPlate: Box;
  /** The banner's top edge and font size (it is centred and sized by its text). */
  banner: { y: number; h: number; font: number };
  num: Sprite;
  go: Sprite;
  vs: Sprite;
  /** Plate font sizes: the name, the line under it. */
  plateFont: number;
  subFont: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Longest plate line: "Real human?". */
export const TAG_CHARS = 11;

export function countdownLayout(w: number, h: number, dpr = 1): CountdownLayout {
  const portrait = h > w * 1.05;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const m = Math.max(8, Math.round(Math.min(w, h) * 0.03));
  const bannerH = clamp(Math.round(h * 0.07), 34, 110);
  const bannerFont = clamp(Math.round(Math.min(w * 0.034, bannerH * 0.42)), 11, 44);
  const plateH = clamp(Math.round(h * 0.085), 46, 140);
  const plateFont = clamp(Math.round(plateH * 0.36), 14, 48);
  let subFont = clamp(Math.round(plateFont * 0.62), 10, 28);

  // fighters: as big as the composition allows, a whole number of device px per pixel
  const fighterH = portrait ? h * 0.3 : h * 0.5;
  const fighterW = portrait ? w * 0.4 : w * 0.24;
  const u = Math.max(1, Math.floor(Math.min((fighterH * dpr) / CHAR_H, (fighterW * dpr) / CHAR_W)));
  const fw = (CHAR_W * u) / dpr, fh = (CHAR_H * u) / dpr;
  const plateW = Math.min(Math.max(fw * 1.15, 132), (w - 3 * m) / 2);
  const plateY = h - m - plateH;
  const fy = snap(plateY - fh + fh * 0.04); // feet just above the plate (the box has empty rows under the feet)
  const me: Box = { x: snap(m + Math.max(0, (plateW - fw) / 2)), y: fy, w: fw, h: fh };
  const them: Box = { x: snap(w - m - Math.max(0, (plateW - fw) / 2) - fw), y: fy, w: fw, h: fh };
  const mePlate: Box = { x: m, y: plateY, w: plateW, h: plateH };
  const themPlate: Box = { x: w - m - plateW, y: plateY, w: plateW, h: plateH };
  const gap = themPlate.x - (mePlate.x + mePlate.w);
  // the plate line "Real human?" (11 characters of the 1em-wide pixel font) fits its plate
  subFont = Math.max(8, Math.min(subFont, Math.floor((plateW - 26) / (TAG_CHARS * 1.06))));

  // VS: between the plates in landscape; in portrait the plates nearly touch and the fighters' big
  // heads fill the gap between them, so VS sits on the seam just above their heads
  let vs: Sprite;
  if (portrait) {
    const kvs = Math.max(1, Math.floor(Math.min((Math.min(w * 0.36, 220) * dpr) / CD_VS.w, (Math.min(h * 0.09, 120) * dpr) / CD_VS.h)));
    vs = { cx: w / 2, cy: fy + fh * 0.04 - (CD_VS.h * kvs) / dpr / 2, k: kvs };
  } else {
    const kvs = Math.max(1, Math.floor(Math.min((plateH * 1.3 * dpr) / CD_VS.h, (Math.max(24, gap - 8) * dpr) / CD_VS.w)));
    vs = { cx: w / 2, cy: plateY + plateH - (CD_VS.h * kvs) / dpr / 2, k: kvs };
  }
  const vsH = (CD_VS.h * vs.k) / dpr;

  // the numeral: between the banner and the fighters (portrait) or between the fighters (landscape)
  const top = m + bannerH + m;
  const bottom = vs.cy - vsH / 2 - m * 0.5;
  const areaH = Math.max(40, bottom - top);
  const areaW = portrait ? w - 2 * m : them.x - (me.x + fw) - 2 * m;
  const capH = portrait ? h * 0.34 : h * 0.52;
  const kn = Math.max(1, Math.floor(Math.min((Math.min(areaH * 0.96, capH) * dpr) / CD_NUM.h, (areaW * dpr) / CD_NUM.w)));
  const num: Sprite = { cx: w / 2, cy: top + areaH / 2, k: kn };
  // CHAT!: the doors fly apart, so it may use the full width
  const kg = Math.max(1, Math.floor(Math.min(((w - 2 * m) * 0.94 * dpr) / CD_GO.w, (Math.min(areaH, h * 0.4) * dpr) / CD_GO.h)));
  const go: Sprite = { cx: w / 2, cy: num.cy, k: kg };

  // doors in their own pixels, with the seam through the numeral and between the fighters' plates
  const dw = Math.ceil((w * dpr) / u), dh = Math.ceil((h * dpr) / u);
  const toDoor = (v: number) => (v * dpr) / u;
  const cx = toDoor(num.cx), cy = toDoor(num.cy);
  const room = toDoor(Math.max(8, gap / 2 - 4)); // half the gap between the plates, in door px
  const slant = Math.min(portrait ? 0.08 : 0.24, room / Math.max(1, dh - cy));
  return {
    w, h, dpr, portrait, u,
    door: { w: dw, h: dh, cx, cy, seamTop: cx + cy * slant, seamBottom: cx - (dh - cy) * slant },
    me, them, mePlate, themPlate,
    banner: { y: m, h: bannerH, font: bannerFont },
    num, go, vs, plateFont, subFont,
  };
}

/** CSS box of a sprite of (sw x sh) pixels drawn at its layout scale, on whole device pixels. */
export function spriteBox(s: Sprite, sw: number, sh: number, dpr: number): Box {
  const w = (sw * s.k) / dpr, h = (sh * s.k) / dpr;
  return { x: Math.round((s.cx - w / 2) * dpr) / dpr, y: Math.round((s.cy - h / 2) * dpr) / dpr, w, h };
}
