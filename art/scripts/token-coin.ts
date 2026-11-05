// Renders the REAL token image: an 8-bit gold coin with a big R in the centre and REALSIES around the rim.
// Usage: npx tsx scripts/token-coin.ts [outDir]   (default out/token). Pure code, ENDESGA-32 palette only.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createBuffer, get, px, type Rgba } from '../src/core/buffer.ts';
import { PAL, TRANSPARENT, type Color } from '../src/core/palette.ts';
import { writePng } from './png.ts';

const N = 160;
const K = N / 128; // geometry was designed at 128 px
const C = (N - 1) / 2; // centre
const R_OUT = 62.5 * K; // outer edge
const R_RIM = R_OUT - 1.1; // inside the outline ring
const R_WALL = 46.6 * K; // inner wall of the raised rim
const R_FACE = R_WALL - 1; // recessed face
const R_BEADS = 42 * K; // ring of beads on the face

// 4x4 Bayer matrix for pixel-art dithering
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Pick from a dark-to-light ramp by brightness 0..1 with ordered dithering. */
function shade(ramp: Color[], t: number, x: number, y: number): Color {
  const v = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1);
  const i = Math.floor(v);
  return v - i > dither(x, y) ? ramp[Math.min(i + 1, ramp.length - 1)] : ramp[i];
}

const LIGHT = Math.atan2(-1, -1); // from the top left
const RIM_RAMP = [PAL.brown, PAL.rust, PAL.orange, PAL.gold, PAL.yellow];
const FACE_RAMP = [PAL.orange, PAL.gold, PAL.gold, PAL.yellow];

// ---------- glyphs ----------
const G: Record<string, string[]> = {
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  '*': ['..#..', '..#..', '#####', '.###.', '.#.#.', '#...#', '.....'],
  '.': ['.....', '.....', '..#..', '.###.', '..#..', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
const BIG_R = [
  '######..',
  '##...##.',
  '##....##',
  '##...##.',
  '######..',
  '##.##...',
  '##..##..',
  '##...##.',
  '##....##',
  '##....##',
];

function inGlyph(ch: string, gx: number, gy: number): boolean {
  const g = G[ch] ?? G[' '];
  const row = g[Math.floor(gy)];
  return !!row && row[Math.floor(gx)] === '#';
}

/**
 * Rim text by polar mapping: each rim pixel maps to (arc position, radial position) in text space and samples the
 * glyph there, so letters curve with the coin. Text is centred on `centerAngle`, tops of letters facing outward.
 */
function rimTextMask(text: string, centerAngle: number, rMid: number): (x: number, y: number) => boolean {
  const cellW = 2.45 * K; // px of arc per glyph cell
  const cellH = 1.65 * K; // px of radius per glyph cell
  const gap = 1.7 * K; // px of arc between letters
  const glyphW = 5 * cellW;
  const total = text.length * glyphW + (text.length - 1) * gap;
  const top = rMid + (7 * cellH) / 2; // outer radius of the letters
  return (x, y) => {
    const dx = x + 0.5 - (C + 0.5), dy = y + 0.5 - (C + 0.5);
    const r = Math.hypot(dx, dy);
    const v = (top - r) / cellH; // 0 at the letter tops
    if (v < 0 || v >= 7) return false;
    let a = Math.atan2(dy, dx) - centerAngle;
    a = Math.atan2(Math.sin(a), Math.cos(a)); // wrap to -pi..pi
    const s = a * rMid + total / 2; // arc position, left to right as seen when the letter tops face out
    if (s < 0 || s >= total) return false;
    const k = Math.floor(s / (glyphW + gap));
    const within = s - k * (glyphW + gap);
    if (within >= glyphW) return false;
    return inGlyph(text[k], within / cellW, v);
  };
}

function bigRMask(): (x: number, y: number) => boolean {
  const s = 5;
  const w = BIG_R[0].length * s, h = BIG_R.length * s;
  const x0 = Math.round(C - w / 2) + 1, y0 = Math.round(C - h / 2);
  return (x, y) => {
    const gx = Math.floor((x - x0) / s), gy = Math.floor((y - y0) / s);
    return gy >= 0 && gy < BIG_R.length && gx >= 0 && gx < BIG_R[0].length && BIG_R[gy][gx] === '#';
  };
}

// ---------- render ----------
function renderCoin(variant: 'top' | 'ring'): Rgba {
  const b = createBuffer(N, N);
  const rMidText = (R_RIM + R_WALL) / 2;
  const masks =
    variant === 'top'
      ? [rimTextMask('REALSIES', -Math.PI / 2, rMidText), rimTextMask('* . *', Math.PI / 2, rMidText)]
      : [rimTextMask('REALSIES *', -Math.PI / 2, rMidText), rimTextMask('REALSIES *', Math.PI / 2, rMidText)];
  const onRimText = (x: number, y: number) => masks.some((m) => m(x, y));
  const bigR = bigRMask();

  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x - C, dy = y - C;
      const r = Math.hypot(dx, dy);
      if (r > R_OUT) continue; // transparent
      const lit = Math.cos(Math.atan2(dy, dx) - LIGHT); // 1 facing the light
      let c: Color;
      if (r > R_RIM) c = PAL.plum; // outline
      else if (r > R_WALL) c = shade(RIM_RAMP, 0.55 + 0.42 * lit, x, y); // raised rim, convex
      else if (r > R_FACE) c = shade(RIM_RAMP, 0.45 - 0.4 * lit, x, y); // inner wall faces away from the light
      else {
        const g = 0.62 + 0.3 * (-(dx + dy) / (2 * R_FACE)); // recessed face, brighter to the top left
        c = shade(FACE_RAMP, g, x, y);
      }
      px(b, x, y, c);
    }

  // beads: a dotted inner circle on the face, like a minted coin
  for (let k = 0; k < 56; k++) {
    const a = (k / 56) * Math.PI * 2;
    const bx = Math.round(C + Math.cos(a) * R_BEADS), by = Math.round(C + Math.sin(a) * R_BEADS);
    const lit = Math.cos(a - LIGHT);
    px(b, bx, by, lit > 0.2 ? PAL.yellow : PAL.rust);
    px(b, bx + 1, by + 1, PAL.orange);
  }

  // rim letters: raised and outlined, like the big R
  const outline = (inside: (x: number, y: number) => boolean, c: Color) => {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (inside(x, y)) continue;
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (inside(x + ox, y + oy)) { near = true; break; }
        if (near) px(b, x, y, c);
      }
  };
  outline(onRimText, PAL.plum);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!onRimText(x, y)) continue;
      const topLeftEdge = !onRimText(x - 1, y) || !onRimText(x, y - 1);
      px(b, x, y, topLeftEdge ? PAL.white : PAL.yellow);
    }

  // big R: drop shadow, outline, body, bevel highlights
  const inR = (x: number, y: number) => bigR(x, y);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inR(x - 2, y - 2) || inR(x, y)) continue;
      px(b, x, y, (x + y) % 2 ? PAL.orange : PAL.rust);
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (inR(x, y)) continue;
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) if (inR(x + ox, y + oy)) { near = true; break; }
      if (near) px(b, x, y, PAL.plum);
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inR(x, y)) continue;
      const topLeftEdge = !inR(x - 1, y) || !inR(x, y - 1);
      const bottomRightEdge = !inR(x + 1, y) || !inR(x, y + 1);
      px(b, x, y, topLeftEdge ? PAL.white : bottomRightEdge ? PAL.gold : PAL.yellow);
    }

  // shine: a sparkle on the rim and a glint on the face
  const spark = (sx: number, sy: number, len: number) => {
    for (let i = -len; i <= len; i++) {
      px(b, sx + i, sy, Math.abs(i) === len ? PAL.yellow : PAL.white);
      px(b, sx, sy + i, Math.abs(i) === len ? PAL.yellow : PAL.white);
    }
  };
  spark(Math.round(17 * K), Math.round(48 * K), 3);
  for (let i = 0; i < 9; i++) px(b, 36 + i, 66 - i, PAL.white);
  for (let i = 0; i < 5; i++) px(b, 39 + i, 67 - i, PAL.yellow);
  return b;
}

function upscale(src: Rgba, k: number, bg: Color = TRANSPARENT): Rgba {
  const out = createBuffer(src.w * k, src.h * k);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const c = get(src, Math.floor(x / k), Math.floor(y / k));
      if (c !== TRANSPARENT) px(out, x, y, c);
      else if (bg !== TRANSPARENT) px(out, x, y, bg);
    }
  return out;
}

const outDir = process.argv[2] ?? join(process.cwd(), 'out', 'token');
mkdirSync(outDir, { recursive: true });
const top = renderCoin('top');
const ring = renderCoin('ring');
writePng(join(outDir, 'realsies-coin-640.png'), upscale(top, 4));
writePng(join(outDir, 'realsies-coin-1280.png'), upscale(top, 8));
writePng(join(outDir, 'realsies-coin-640-on-navy.png'), upscale(top, 4, PAL.navyDark));
writePng(join(outDir, 'realsies-coin-ring-640.png'), upscale(ring, 4));
writePng(join(outDir, 'realsies-coin-160.png'), top);
console.log('wrote coin images to', outDir);
