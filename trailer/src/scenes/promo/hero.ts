// The trailer's end-card art (src/scenes/endcard.ts) as parts, for stills laid out in other ways: the
// sunrise sky over a planet's limb (with or without the sun), the dark foreground crest, the smug
// trio as the end card's poster shows them, the logo with its shine and sparkles, the gold URL.
// Same drawing as the end card, with the sun, the crest and the sizes as parameters; works at any
// output size.

import { type Rgba, type Color, type Look, createBuffer, px, get, PAL, TRANSPARENT, lighter, hash01, drawLogo, LOGO_W, LOGO_H } from '../../art.ts';
import { blitK, rectOut } from '../../engine/camera.ts';
import { SmugActor, type SmugState } from '../../engine/expressions.ts';
import { drawTextC } from './text.ts';

const P = PAL;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const th = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

export interface SkyOpts {
  /** Output size and field pixel size (output px per field px). */
  w: number;
  h: number;
  k: number;
  /** The sun just over the limb, in field px (none: no sun, no rays). */
  sun?: { x: number; y: number };
  /** Horizon row at the curve's centre (field px) and the curve's centre column; none: no planet. */
  limb?: { y: number; cx: number; curve?: number };
  /** Keep stars out of these output rects (text). */
  clear?: { x: number; y: number; w: number; h: number }[];
  /** Star density (the end card's is 0.012). */
  stars?: number;
  /** Ray turn (the end card turns them slowly with time). */
  spin?: number;
  /** The sky's three tones, top to horizon (the end card's: black, navy-dark, navy). */
  tones?: [Color, Color, Color];
}

/** The sky behind the trio: black at the top to navy at the horizon, rays from the sun, a lit limb, the planet. */
export function sky(o: SkyOpts): Rgba {
  const BW = Math.ceil(o.w / o.k), BH = Math.ceil(o.h / o.k);
  const b = createBuffer(BW, BH);
  const limbAt = (x: number) => (o.limb ? o.limb.y + ((x - o.limb.cx) * (x - o.limb.cx)) / (o.limb.curve ?? 1700) : BH + 40);
  const starP = o.stars ?? 0.012;
  const spin = o.spin ?? 0;
  const clearAt = (x: number, y: number) => (o.clear ?? []).some((r) => x * o.k + o.k > r.x && x * o.k < r.x + r.w && y * o.k + o.k > r.y && y * o.k < r.y + r.h);
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      const limb = limbAt(x);
      let c: Color;
      if (y < limb) {
        const v = y / Math.min(limb, BH);
        const [t0, t1, t2] = o.tones ?? [P.black, P.navyDark, P.navy];
        c = v < 0.35 ? t0 : v < 0.75 ? (v - 0.35) / 0.4 > th(x, y) ? t1 : t0 : (v - 0.75) / 0.25 > th(x, y) ? t2 : t1;
        if (o.sun) {
          const dx = x + 0.5 - o.sun.x, dy = y + 0.5 - o.sun.y;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx) + spin;
          const lit = (Math.floor(((a + Math.PI) / (2 * Math.PI)) * 36) & 1) === 0;
          const reach = Math.max(0, 1 - d / 190);
          if (lit && reach * 1.6 > th(x, y) + 0.15) c = lighter(c, reach > 0.55 ? 2 : 1);
          const g = Math.max(0, 1 - d / 46);
          if (g > 0.08) {
            const warm: Color[] = [P.plum, P.brown, P.rust, P.orange, P.gold, P.yellow, P.white];
            const k = Math.min(warm.length - 1, Math.floor(g * warm.length + (th(x, y) - 0.5) * 0.9));
            if (k >= 0) c = warm[k];
          }
        }
        if (o.limb) {
          const above = limb - y;
          if (above < 1) c = P.cyan;
          else if (above < 2) c = (x & 1) ? P.blue : P.cyan;
          else if (above < 4 && th(x, y) < 0.5) c = P.blue;
        }
        if (y < limb - 30 && !clearAt(x, y) && hash01(61, x, y) < starP) c = hash01(62, x, y) < 0.3 ? P.white : P.slate;
      } else {
        const below = y - limb;
        c = below < 2 ? P.navy : below < 6 && th(x, y) < 0.5 ? P.navyDark : P.black;
        if (o.sun && Math.abs(x + 0.5 - o.sun.x) < 26 && below < 3) c = below < 1 ? P.white : P.cyan;
      }
      px(b, x, y, c);
    }
  return b;
}

/** The dark foreground crest the low camera looks past: highest at `cx`, its lip catching the light near it. */
export function crest(out: Rgba, o: { k: number; top: number; cx: number; curve?: number; litHalf?: number }): void {
  const BW = Math.ceil(out.w / o.k);
  for (let bx = 0; bx < BW; bx++) {
    const top = Math.round(o.top + ((bx - o.cx) * (bx - o.cx)) / (o.curve ?? 3000));
    rectOut(out, bx * o.k, top * o.k, o.k, out.h - top * o.k, P.black);
    const near = Math.abs(bx + 0.5 - o.cx) < (o.litHalf ?? 70);
    rectOut(out, bx * o.k, top * o.k, o.k, o.k, near ? P.slate : P.navy);
    if (hash01(63, bx) < 0.3) rectOut(out, bx * o.k, (top + 1) * o.k, o.k, o.k, P.navyDark);
  }
}

/** The end card's poster poses: left pushes up his sunglasses (glint), middle crosses her arms, right raises a brow. */
const BASE: SmugState = { arms: 'crossed', push: 0, shadesUp: 0, lensGlint: false, eyes: 'lids', nod: 0, smirkLeft: false };
export const POSES = {
  left: { ...BASE, arms: 'push', eyes: 'shades', push: 2, shadesUp: 1, lensGlint: true } as SmugState,
  mid: { ...BASE } as SmugState,
  right: { ...BASE, eyes: 'brow', smirkLeft: true } as SmugState,
};

export class Trio {
  private a: { left: SmugActor; mid: SmugActor; right: SmugActor };
  constructor(trio: { left: string | Look; mid: string | Look; right: string | Look }) {
    this.a = { left: new SmugActor(trio.left), mid: new SmugActor(trio.mid), right: new SmugActor(trio.right) };
  }
  /**
   * The three, waist up: centres in output x, the waist row (where the crest cuts them) in output y,
   * the middle one at kMid and the sides at kSide, a step back. Sides first, then her.
   */
  draw(out: Rgba, o: { cx: [number, number, number]; waist: number; kMid: number; kSide: number }): void {
    const WAIST = 33.5;
    for (const [side, cx] of [['left', o.cx[0]], ['right', o.cx[2]]] as const) {
      blitK(out, this.a[side].frame(POSES[side]), Math.round(cx - 16 * o.kSide), Math.round(o.waist + 6 - WAIST * o.kSide), o.kSide);
    }
    blitK(out, this.a.mid.frame(POSES.mid), Math.round(o.cx[1] - 16 * o.kMid), Math.round(o.waist - WAIST * o.kMid), o.kMid);
  }
}

/** The logo at k with the shine frozen mid-sweep and the end card's sparkles. Returns its output size. */
export function logo(out: Rgba, x: number, y: number, k: number, o: { glint?: number | null; sparkles?: boolean } = {}): { w: number; h: number } {
  const lb = createBuffer(LOGO_W, LOGO_H);
  drawLogo(lb, 0, 0, 0, 1, true);
  const g = o.glint === undefined ? 44 : o.glint;
  if (g !== null) {
    const FACE = new Set<Color>([P.yellow, P.gold, P.orange, P.rust, P.white, P.clay, P.brown]);
    for (let yy = 0; yy < LOGO_H; yy++)
      for (let xx = 0; xx < LOGO_W; xx++) {
        const c = get(lb, xx, yy);
        if (c === TRANSPARENT || !FACE.has(c)) continue;
        const d = xx - (g - (LOGO_H - yy) * 0.45);
        if (d >= 0 && d < 1) px(lb, xx, yy, lighter(c, 1));
        else if (d >= 1 && d < 2) px(lb, xx, yy, P.white);
        else if (d >= 2 && d < 3) px(lb, xx, yy, lighter(c, 1));
      }
  }
  blitK(out, lb, x, y, k);
  if (o.sparkles ?? true) {
    const SPARK: [number, number, Color][] = [[LOGO_W - 7, 2, P.yellow], [6, 6, P.gold], [24, 1, P.cyan]];
    SPARK.forEach(([lx, ly, c], i) => sparkle(out, x + lx * k, y + ly * k, k, Math.min(0.999, Math.max(0, 0.45 - i * 0.12)), c));
  }
  return { w: LOGO_W * k, h: LOGO_H * k };
}

function sparkle(out: Rgba, x: number, y: number, k: number, ph: number, c: Color): void {
  const size = ph < 0.15 ? 0 : ph < 0.3 ? 1 : ph < 0.6 ? 2 : ph < 0.75 ? 1 : ph < 0.85 ? 0 : -1;
  if (size < 0) return;
  const dot = (dx: number, dy: number, cc: Color) => rectOut(out, x + dx * k - k / 2, y + dy * k - k / 2, k, k, cc);
  dot(0, 0, P.white);
  for (let d = 1; d <= size; d++) {
    const cc = d === size && size > 1 ? c : P.white;
    dot(-d, 0, cc);
    dot(d, 0, cc);
    dot(0, -d, cc);
    dot(0, d, cc);
  }
}

/** The URL in gold, extruded in rust, centred on cx. */
export function url(out: Rgba, text: string, cx: number, y: number, k: number): void {
  drawTextC(out, text, cx, y, { color: P.gold, scale: k, outline: P.black, extrude: P.rust });
}

export { LOGO_W, LOGO_H };
