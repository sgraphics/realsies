// End card, low-angle hero shot: the curved REALSIES logo big across the top with a glint sweeping
// its letters and a sparkle or two; under it three characters, waist up and cropped by the bottom
// edge, looming over a low horizon (a planet's limb with the sun coming up behind them, rays
// fanning up the sky, a rim of backlight on every silhouette). The guest from the interview in the
// middle, two lobby regulars either side, all three smug. The tagline sits under the logo,
// realsies.lol on a dark foot band. Also the poster.

import { type Rgba, createBuffer, px, get } from '../../src/core/buffer.ts';
import { type Color, PAL, TRANSPARENT, lighter } from '../../src/core/palette.ts';
import { hash01 } from '../../src/core/rng.ts';
import { drawLogo, LOGO_W, LOGO_H } from '../../src/themes/logo.ts';
import { blitK, rectOut, OUT_W, OUT_H } from './camera.ts';
import { drawCentered } from './font.ts';
import { castLook, CAST } from './actor.ts';
import { SmugActor, type SmugState } from './smug.ts';
import { CUE, LINES, beat, typedCount, lineShown, lobbySeeds, END_SEATS, END } from './storyboard.ts';

const P = PAL;
const BG_K = 6; // field pixels
const BW = OUT_W / BG_K, BH = OUT_H / BG_K;
const LOGO_K = 12;
const LOGO_X = Math.round((OUT_W - LOGO_W * LOGO_K) / 2 / 2) * 2;
const LOGO_Y = 34;
const TAG_Y = 386;
const URL_Y = 992;
export const URL_TEXT = 'realsies.lol';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const th = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

// ---------------------------------------------------------------- the sky behind them

/** Horizon (the planet's limb) in field rows: low in frame, curving away at the sides. */
const limbAt = (x: number) => 141 + ((x - BW / 2) * (x - BW / 2)) / 1700;
const SUN = { x: BW / 2, y: 143 };
/** Top of the dark foreground crest the camera looks up past (field rows): highest in the middle. */
const crestAt = (x: number) => Math.round(160 + ((x - BW / 2) * (x - BW / 2)) / 3000);

function field(t: number): Rgba {
  const b = createBuffer(BW, BH);
  const spin = t * 0.025; // the rays turn, slowly
  for (let y = 0; y < BH; y++)
    for (let x = 0; x < BW; x++) {
      const limb = limbAt(x);
      let c: Color;
      if (y < limb) {
        // sky: black at the top to navy at the horizon
        const v = y / limb;
        c = v < 0.35 ? P.black : v < 0.75 ? (v - 0.35) / 0.4 > th(x, y) ? P.navyDark : P.black : (v - 0.75) / 0.25 > th(x, y) ? P.navy : P.navyDark;
        // rays fanning up from the sun behind the group
        const dx = x + 0.5 - SUN.x, dy = y + 0.5 - SUN.y;
        const d = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx) + spin;
        const lit = (Math.floor(((a + Math.PI) / (2 * Math.PI)) * 36) & 1) === 0;
        const reach = Math.max(0, 1 - d / 190);
        if (lit && reach * 1.6 > th(x, y) + 0.15) c = lighter(c, reach > 0.55 ? 2 : 1);
        // the sun's glow just over the limb
        const g = Math.max(0, 1 - d / 46);
        if (g > 0.08) {
          const warm: Color[] = [P.plum, P.brown, P.rust, P.orange, P.gold, P.yellow, P.white];
          const k = Math.min(warm.length - 1, Math.floor(g * warm.length + (th(x, y) - 0.5) * 0.9));
          if (k >= 0) c = warm[k];
        }
        // the atmosphere: a thin bright rim along the limb
        const above = limb - y;
        if (above < 1) c = P.cyan;
        else if (above < 2) c = (x & 1) ? P.blue : P.cyan;
        else if (above < 4 && th(x, y) < 0.5) c = P.blue;
        // stars, high up only, and never beside the tagline (they read as stray punctuation)
        const nearTag = y >= Math.floor(TAG_Y / BG_K) - 3 && y <= Math.floor(TAG_Y / BG_K) + 12;
        if (y < limb - 30 && !nearTag && hash01(61, x, y) < 0.012) c = hash01(62, x, y) < 0.3 ? P.white : P.slate;
      } else {
        // the planet: dark, a lit band right under the limb
        const below = y - limb;
        c = below < 2 ? P.navy : below < 6 && th(x, y) < 0.5 ? P.navyDark : P.black;
        if (Math.abs(x + 0.5 - SUN.x) < 26 && below < 3) c = below < 1 ? P.white : P.cyan;
      }
      px(b, x, y, c);
    }
  return b;
}

// ---------------------------------------------------------------- the trio

const seeds = lobbySeeds();
const trio = {
  // Coconut843, in his own shades, pushes them up with one finger
  left: new SmugActor(seeds[END_SEATS.left]),
  // the guest from the interview, arms crossed
  mid: new SmugActor(castLook(CAST.guest)),
  // Pebble242, smug as a cat, raises one eyebrow
  right: new SmugActor(seeds[END_SEATS.right]),
};

const MID_K = 17, SIDE_K = 15;
/** Box positions (top-left, output px): the middle one closer and bigger, cropped at its waist. */
const AT = {
  mid: { x: 960 - 16 * MID_K, y: OUT_H - 40 * MID_K },
  left: { x: 560 - 16 * SIDE_K, y: OUT_H - 41 * SIDE_K },
  right: { x: 1360 - 16 * SIDE_K, y: OUT_H - 41 * SIDE_K },
};

function states(t: number, still: boolean): { left: SmugState; mid: SmugState; right: SmugState } {
  const base: SmugState = { arms: 'crossed', push: 0, shadesUp: 0, lensGlint: false, eyes: 'lids', nod: 0, smirkLeft: false };
  const b = still ? 99 : (t - beat(0)) / ((beat(1) - beat(0)));
  const after = (n: number) => b >= n;
  // left: the push
  let push: 0 | 1 | 2 = 0;
  if (still) push = 2;
  else if (after(END.push[0]) && !after(END.push[3])) push = after(END.push[1]) && !after(END.push[2]) ? 2 : 1;
  const pushed = after(END.push[1]);
  const glint = still || (after(END.push[1]) && !after(END.push[2])) || (after(CUE.chime) && !after(CUE.chime + 1));
  const left: SmugState = { ...base, arms: 'push', eyes: 'shades', push, shadesUp: pushed ? 1 : 0, lensGlint: glint };
  // middle: a slow nod
  const nod = !still && after(END.nod[0]) && !after(END.nod[1]) ? 1 : 0;
  const mid: SmugState = { ...base, nod };
  // right: the eyebrow goes up, and stays up
  const right: SmugState = { ...base, eyes: after(END.brow) ? 'brow' : 'lids', smirkLeft: true };
  return { left, mid, right };
}

/** Rise into frame on the downbeat, a little overshoot, settle. */
function rise(age: number, delay: number): number {
  const f = Math.floor((age - delay) * 24);
  const curve = [420, 260, 120, 30, -18, -8, 0];
  if (f < 0) return 600;
  return f < curve.length ? curve[f] : 0;
}

// ---------------------------------------------------------------- the logo and its shine

/** Logo buffer at 1x with the glint band at column `g` (or none). */
function shinyLogo(now: number, g: number | null, frozen: boolean): Rgba {
  const lb = createBuffer(LOGO_W, LOGO_H);
  drawLogo(lb, 0, 0, now, 1, frozen);
  if (g === null) return lb;
  const FACE = new Set<Color>([P.yellow, P.gold, P.orange, P.rust, P.white, P.clay, P.brown]);
  for (let y = 0; y < LOGO_H; y++)
    for (let x = 0; x < LOGO_W; x++) {
      const c = get(lb, x, y);
      if (c === TRANSPARENT || !FACE.has(c)) continue;
      const d = x - (g - (LOGO_H - y) * 0.45);
      if (d >= 0 && d < 1) px(lb, x, y, lighter(c, 1));
      else if (d >= 1 && d < 2) px(lb, x, y, P.white);
      else if (d >= 2 && d < 3) px(lb, x, y, lighter(c, 1));
    }
  return lb;
}

/** A four-point sparkle at output (x, y) in logo-pixel blocks, phase 0..1. */
function sparkle(out: Rgba, x: number, y: number, ph: number, c: Color): void {
  const size = ph < 0.15 ? 0 : ph < 0.3 ? 1 : ph < 0.6 ? 2 : ph < 0.75 ? 1 : ph < 0.85 ? 0 : -1;
  if (size < 0) return;
  const k = LOGO_K;
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

/** Logo-pixel positions of the sparkles: the tip of the last S, the coin, the top of the first R. */
const SPARK_AT: [number, number, Color][] = [[LOGO_W - 7, 2, P.yellow], [6, 6, P.gold], [24, 1, P.cyan]];

// ---------------------------------------------------------------- the card

export function renderEndCard(out: Rgba, t: number, still = false): void {
  const t0 = beat(CUE.logo);
  const age = still ? 10 : t - t0;
  blitK(out, field(still ? t0 + 3 : t), 0, 0, BG_K);
  // the trio: sides first (they stand a step back), then her
  const st = states(t, still);
  for (const side of ['left', 'right'] as const) {
    const a = AT[side];
    blitK(out, trio[side].frame(st[side]), a.x, a.y + (still ? 0 : rise(age, 2 / 24)), SIDE_K);
  }
  blitK(out, trio.mid.frame(st.mid), AT.mid.x, AT.mid.y + (still ? 0 : rise(age, 0)), MID_K);
  // the dark crest in the foreground: the low camera looks up past it, and it cuts the three off
  // at the waist; its lit lip catches the sunrise
  for (let bx = 0; bx < BW; bx++) {
    const top = crestAt(bx);
    rectOut(out, bx * BG_K, top * BG_K, BG_K, OUT_H - top * BG_K, P.black);
    const near = Math.abs(bx + 0.5 - BW / 2) < 70;
    rectOut(out, bx * BG_K, top * BG_K, BG_K, BG_K, near ? P.slate : P.navy);
    if (hash01(63, bx) < 0.3) rectOut(out, bx * BG_K, (top + 1) * BG_K, BG_K, BG_K, P.navyDark);
  }
  // the logo drops in, then the shine sweeps it on the beats
  const drop = [-460, -300, -150, 14, 30, 10, -4, 0];
  const fi = Math.floor(age * 24);
  const dy = still ? 0 : fi < drop.length ? drop[Math.max(0, fi)] : 0;
  let g: number | null = still ? 44 : null;
  let sparkPh = -1;
  for (const gb of END.glints) {
    const ga = (t - beat(gb)) / 0.5; // sweep in half a second
    if (!still && ga >= 0 && ga < 1) g = -12 + ga * (LOGO_W + 30);
    if (!still && ga >= 0.75 && ga < 2.2) sparkPh = (ga - 0.75) / 1.45;
  }
  blitK(out, shinyLogo(still ? 0 : t * 1000, g, still), LOGO_X, LOGO_Y + dy, LOGO_K);
  if (still) sparkPh = 0.45;
  if (sparkPh >= 0)
    SPARK_AT.forEach(([lx, ly, c], i) => sparkle(out, LOGO_X + lx * LOGO_K, LOGO_Y + dy + ly * LOGO_K, Math.min(0.999, Math.max(0, sparkPh - i * 0.12)), c));
  // tagline under the logo, typed on
  const tag = LINES.find((l) => l.id === 'tagline')!;
  const n = still ? Infinity : typedCount(tag, t);
  drawCentered(out, lineShown(tag), OUT_W / 2, TAG_Y, { color: P.white, scale: 6, outline: P.black }, n);
  // the URL pops in on the foot band
  const ua = still ? 10 : t - beat(CUE.url);
  if (ua >= 0) {
    const k = ua < 1 / 24 ? 11 : ua < 2 / 24 ? 10 : 9;
    drawCentered(out, URL_TEXT, OUT_W / 2, URL_Y - (k - 9) * 4, { color: P.gold, scale: k, outline: P.black, extrude: P.rust });
  }
}
