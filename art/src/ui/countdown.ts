// The full-screen countdown before every chat (3, 2, 1, CHAT!): chunky numerals and words in the
// logo's style (banded face, bevel, extrusion, outline, drop shadow) in each theme's colours, a VS
// emblem, and the VS backdrop: two doors split by a slanted seam, a sunburst around the numeral.
// Pure: everything renders into RGBA buffers in the master palette.

import type { ThemeId } from '../../../shared/protocol.ts';
import { type Rgba, createBuffer, get, px, blit } from '../core/buffer.ts';
import { type Color, PAL, TRANSPARENT } from '../core/palette.ts';

const P = PAL;

/** Glyph rows: 16 tall, 4-px strokes; digits and letters 12 wide, "1" 10, "!" 4. */
const GLYPHS: Record<string, string[]> = {
  '0': ['..########..', '.##########.', '############', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '############', '.##########.', '..########..'],
  '1': ['...#####..', '..######..', '.#######..', '########..', '###.####..', '....####..', '....####..', '....####..', '....####..', '....####..', '....####..', '....####..', '....####..', '##########', '##########', '##########'],
  '2': ['..########..', '.##########.', '############', '####....####', '........####', '........####', '.......####.', '.....#####..', '...#####....', '..####......', '.####.......', '####........', '####........', '############', '############', '############'],
  '3': ['..########..', '.##########.', '############', '####....####', '........####', '........####', '.....######.', '.....#####..', '.....######.', '........####', '........####', '........####', '####....####', '############', '.##########.', '..########..'],
  '4': ['......######', '.....#######', '....########', '...####.####', '..####..####', '.####...####', '####....####', '####....####', '############', '############', '############', '........####', '........####', '........####', '........####', '........####'],
  '5': ['############', '############', '############', '####........', '####........', '##########..', '###########.', '############', '........####', '........####', '........####', '........####', '####....####', '############', '.##########.', '..########..'],
  '6': ['..#########.', '.##########.', '############', '####........', '####........', '##########..', '###########.', '############', '####....####', '####....####', '####....####', '####....####', '####....####', '############', '.##########.', '..########..'],
  '7': ['############', '############', '############', '........####', '.......####.', '......####..', '.....####...', '....####....', '....####....', '...####.....', '...####.....', '...####.....', '...####.....', '...####.....', '...####.....', '...####.....'],
  '8': ['..########..', '.##########.', '############', '####....####', '####....####', '####....####', '.##########.', '.##########.', '############', '####....####', '####....####', '####....####', '####....####', '############', '.##########.', '..########..'],
  '9': ['..########..', '.##########.', '############', '####....####', '####....####', '####....####', '####....####', '############', '.###########', '..##########', '........####', '........####', '........####', '############', '.##########.', '.#########..'],
  C: ['..########..', '.##########.', '############', '####....####', '####........', '####........', '####........', '####........', '####........', '####........', '####........', '####........', '####....####', '############', '.##########.', '..########..'],
  H: ['####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '############', '############', '############', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####'],
  A: ['..########..', '.##########.', '############', '####....####', '####....####', '####....####', '####....####', '############', '############', '############', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####'],
  T: ['############', '############', '############', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....', '....####....'],
  '!': ['####', '####', '####', '####', '####', '####', '####', '.##.', '....', '....', '....', '....', '####', '####', '####', '####'],
  V: ['####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '####....####', '.####..####.', '.####..####.', '..########..', '..########..', '...######...', '...######...', '....####....'],
  S: ['..########..', '.##########.', '############', '####....####', '####........', '#####.......', '.#########..', '..#########.', '.......#####', '........####', '........####', '........####', '####....####', '############', '.##########.', '..########..'],
};

/**
 * The glyph rows above are drawn at twice their size with EPX corner smoothing (diagonals become
 * clean 45-degree steps, convex corners round off), so a 4-pixel stroke is 8 pixels wide under a
 * 1-pixel outline and bevel: big on screen without looking like a blown-up icon.
 */
const UP = 2;
export const GLYPH_H = 16 * UP;
/** Space between two letters' faces (their outlines and shadows touch). */
const GAP = 3;
/** Extrusion depth of the numerals and CHAT!, and of VS. */
const DEPTH = 5;
const DEPTH_VS = 4;

type Mask = boolean[][];
const MASKS = new Map<string, Mask>();

/** EPX / Scale2x on a one-bit mask. */
function epx(m: Mask): Mask {
  const h = m.length, w = m[0].length;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y][x];
  const out: Mask = Array.from({ length: h * 2 }, () => new Array<boolean>(w * 2).fill(false));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
      out[2 * y][2 * x] = c === a && c !== d && a !== b ? a : p;
      out[2 * y][2 * x + 1] = a === b && a !== c && b !== d ? b : p;
      out[2 * y + 1][2 * x] = d === c && d !== b && c !== a ? c : p;
      out[2 * y + 1][2 * x + 1] = b === d && b !== a && d !== c ? d : p;
    }
  return out;
}

function maskOf(ch: string): Mask {
  let m = MASKS.get(ch);
  if (!m) {
    const g = GLYPHS[ch] ?? GLYPHS['0'];
    m = epx(g.map((row) => [...row].map((c) => c === '#')));
    MASKS.set(ch, m);
  }
  return m;
}

/** Width of a glyph's face in sprite pixels. */
const faceW = (ch: string) => (GLYPHS[ch] ?? GLYPHS['0'])[0].length * UP;

/** Size of a word drawn by bigText, in its own pixels. */
export function bigTextSize(text: string, depth = DEPTH): { w: number; h: number } {
  const chars = [...text.toUpperCase()].filter((c) => GLYPHS[c]);
  if (!chars.length) return { w: 1, h: 1 };
  return { w: chars.reduce((a, c) => a + faceW(c) + GAP, -GAP) + 3, h: GLYPH_H + depth + 3 };
}

export interface GlyphStyle {
  /** Face bands, top to bottom. */
  face: Color[];
  /** Bevel light on the top and left edges of the upper part. */
  hi: Color;
  /** Bevel shade on the right and bottom edges of the lower part. */
  lo: Color;
  /** Extrusion under the face: upper rows, last row. */
  side: [Color, Color];
  outline: Color;
  shadow: Color;
}

export interface CountdownStyle {
  digit: GlyphStyle;
  go: GlyphStyle;
  vs: GlyphStyle;
  /** The player's door, light to dark (light only in the glow around the numeral). */
  me: [Color, Color, Color, Color];
  /** The partner's door. */
  them: [Color, Color, Color, Color];
  /** Seam: core, glow. */
  seam: [Color, Color];
  /** Full-screen flash on every beat. */
  flash: Color;
  /** A sprinkle of stars on the dark rays (space). */
  stars?: boolean;
}

const GOLD: GlyphStyle = { face: [P.yellow, P.yellow, P.gold, P.gold, P.orange], hi: P.white, lo: P.rust, side: [P.red, P.redDark], outline: P.plum, shadow: P.black };
const LIME: GlyphStyle = { face: [P.yellow, P.lime, P.lime, P.lime, P.green], hi: P.white, lo: P.greenDark, side: [P.green, P.greenDark], outline: P.black, shadow: P.black };
const ICE: GlyphStyle = { face: [P.white, P.cyan, P.cyan, P.cyan, P.blue], hi: P.white, lo: P.blueDark, side: [P.blueDark, P.navyDark], outline: P.black, shadow: P.black };
const PINK: GlyphStyle = { face: [P.peach, P.pink, P.pink, P.pink, P.magenta], hi: P.white, lo: P.purple, side: [P.magenta, P.purple], outline: P.plum, shadow: P.black };
const FIRE: GlyphStyle = { face: [P.white, P.yellow, P.gold, P.orange], hi: P.white, lo: P.rust, side: [P.red, P.redDark], outline: P.black, shadow: P.black };
const LEMON: GlyphStyle = { face: [P.white, P.yellow, P.yellow, P.yellow, P.gold], hi: P.white, lo: P.clay, side: [P.orange, P.rust], outline: P.plum, shadow: P.black };
const EMBER: GlyphStyle = { face: [P.yellow, P.gold, P.orange, P.orange, P.rust], hi: P.white, lo: P.brown, side: [P.red, P.redDark], outline: P.plum, shadow: P.black };

const STYLES: Record<ThemeId, CountdownStyle> = {
  castle: {
    digit: GOLD, go: LIME, vs: FIRE,
    me: [P.blue, P.blueDark, P.navyDark, P.black], them: [P.red, P.redDark, P.plum, P.black],
    seam: [P.white, P.gold], flash: P.yellow,
  },
  jungle: {
    digit: LEMON, go: EMBER, vs: FIRE,
    me: [P.lime, P.green, P.greenDark, P.tealDark], them: [P.clay, P.rust, P.brown, P.plum],
    seam: [P.white, P.yellow], flash: P.yellow,
  },
  desert: {
    digit: GOLD, go: ICE, vs: FIRE,
    me: [P.blue, P.blueDark, P.navyDark, P.black], them: [P.orange, P.rust, P.brown, P.plum],
    seam: [P.white, P.yellow], flash: P.yellow,
  },
  cave: {
    digit: ICE, go: PINK, vs: FIRE,
    me: [P.blue, P.blueDark, P.navyDark, P.black], them: [P.magenta, P.purple, P.plum, P.black],
    seam: [P.white, P.cyan], flash: P.cyan,
  },
  space: {
    digit: ICE, go: GOLD, vs: FIRE,
    me: [P.slate, P.navy, P.navyDark, P.black], them: [P.magenta, P.purple, P.plum, P.black],
    seam: [P.white, P.cyan], flash: P.cyan, stars: true,
  },
};

export function countdownStyle(theme: ThemeId): CountdownStyle {
  return STYLES[theme] ?? STYLES.castle;
}

/** One letter: drop shadow, extrusion, outline, banded face with a one-pixel bevel. */
function glyphSprite(ch: string, st: GlyphStyle, depth: number): Rgba {
  const g = maskOf(ch);
  const gw = g[0].length, gh = g.length;
  const face = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && g[y][x];
  const out = createBuffer(gw + 3, gh + depth + 3);
  const ox = 1, oy = 1;
  // where the extrusion is: under a face pixel within `depth` rows
  const extr = (x: number, y: number): number => {
    for (let d = 1; d <= depth; d++) if (face(x, y - d)) return d;
    return 0;
  };
  const solid = (x: number, y: number) => face(x, y) || extr(x, y) > 0;
  const ring = (x: number, y: number) => !solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1));
  const shape = (x: number, y: number) => solid(x, y) || ring(x, y);
  // 1) drop shadow: the outlined shape, one pixel down and right
  for (let y = -1; y <= gh + depth; y++)
    for (let x = -1; x <= gw; x++) if (shape(x, y) && !shape(x + 1, y + 1)) px(out, ox + x + 1, oy + y + 1, st.shadow);
  // 2) outline and extrusion
  for (let y = -1; y <= gh + depth; y++)
    for (let x = -1; x <= gw; x++) {
      if (ring(x, y)) px(out, ox + x, oy + y, st.outline);
      else if (!face(x, y)) {
        const d = extr(x, y);
        if (d) px(out, ox + x, oy + y, d < depth ? st.side[0] : st.side[1]);
      }
    }
  // 3) the face: bands top to bottom, a light top edge, a lit left edge up top, a shaded bottom edge
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!face(x, y)) continue;
      let c = st.face[Math.min(st.face.length - 1, Math.floor((y / gh) * st.face.length))];
      const top = !face(x, y - 1), left = !face(x - 1, y), right = !face(x + 1, y), bottom = !face(x, y + 1);
      const upper = y < gh * 0.5;
      if (top) c = upper ? st.hi : st.face[0];
      else if (bottom) c = st.lo;
      else if (left && upper) c = st.face[0];
      else if (right && !upper) c = st.face[st.face.length - 1];
      px(out, ox + x, oy + y, c);
    }
  // 4) pin-holes: a few pixels of background trapped between an extrusion and a diagonal stroke
  fillPinholes(out, st.outline, 4);
  return out;
}

/** Fill pockets of at most `max` transparent pixels that the edge of the buffer cannot reach. */
function fillPinholes(b: Rgba, c: Color, max: number): void {
  const w = b.w, h = b.h;
  const seen = new Uint8Array(w * h);
  const open = (i: number) => b.data[i * 4 + 3] === 0;
  const next = (i: number): number[] => {
    const x = i % w, y = (i / w) | 0;
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
  };
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || !open(i)) continue;
    seen[i] = 1;
    for (const k of next(i)) if (k >= 0 && !seen[k] && open(k)) stack.push(k);
  }
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !open(i)) continue;
    const pocket: number[] = [];
    const todo = [i];
    seen[i] = 2;
    while (todo.length) {
      const j = todo.pop()!;
      pocket.push(j);
      for (const k of next(j)) if (k >= 0 && !seen[k] && open(k)) {
        seen[k] = 2;
        todo.push(k);
      }
    }
    if (pocket.length <= max) for (const j of pocket) px(b, j % w, (j / w) | 0, c);
  }
}

/** A word in big letters, left to right, each letter with its own outline and shadow. */
export function bigText(text: string, st: GlyphStyle, depth = DEPTH): Rgba {
  const chars = [...text.toUpperCase()].filter((c) => GLYPHS[c]);
  if (!chars.length) return createBuffer(1, 1);
  const size = bigTextSize(text, depth);
  const out = createBuffer(size.w, size.h);
  let x = 0;
  for (const c of chars) {
    blit(out, glyphSprite(c, st, depth), x, 0);
    x += faceW(c) + GAP;
  }
  return out;
}

export type CountdownSprite = 'go' | 'vs' | `${number}`;

const CACHE = new Map<string, Rgba>();
/** The numeral of a beat ("3", "2", "1"), CHAT! ("go") or VS, in a theme's colours. Cached. */
export function countdownSprite(theme: ThemeId, what: CountdownSprite): Rgba {
  const key = theme + ':' + what;
  let s = CACHE.get(key);
  if (!s) {
    const st = countdownStyle(theme);
    s = what === 'go' ? bigText('CHAT!', st.go) : what === 'vs' ? bigText('VS', st.vs, DEPTH_VS) : bigText(String(what).slice(0, 1), st.digit);
    CACHE.set(key, s);
  }
  return s;
}

/** Sprite sizes in their own pixels (a two-digit-wide numeral like "3", CHAT!, VS) for layouts. */
export const CD_NUM = bigTextSize('3');
export const CD_GO = bigTextSize('CHAT!');
export const CD_VS = bigTextSize('VS', DEPTH_VS);

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export interface VsDoorOpts {
  /** Sunburst centre (the numeral), in door pixels. */
  cx: number;
  cy: number;
  /** The seam's x at the top and at the bottom edge, in door pixels. */
  seamTop: number;
  seamBottom: number;
  /** Number of light rays (each followed by a dark one). */
  rays?: number;
}

/**
 * One door of the VS backdrop, w x h pixels, transparent beyond the seam: banded rays around the
 * numeral, darker toward the corners (ordered dither), a glow behind the numeral, and a two-pixel
 * seam edge (core, glow). The player's door is left of the seam, the partner's right of it.
 */
export function renderVsDoor(theme: ThemeId, side: 'me' | 'them', w: number, h: number, o: VsDoorOpts): Rgba {
  const st = countdownStyle(theme);
  const ramp = side === 'me' ? st.me : st.them;
  const out = createBuffer(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const rays = o.rays ?? 12;
  const maxD = Math.hypot(Math.max(o.cx, out.w - o.cx), Math.max(o.cy, out.h - o.cy)) || 1;
  for (let y = 0; y < out.h; y++) {
    const sx = o.seamTop + (o.seamBottom - o.seamTop) * ((y + 0.5) / out.h);
    for (let x = 0; x < out.w; x++) {
      const e = side === 'me' ? sx - (x + 0.5) : x + 0.5 - sx;
      if (e <= 0) continue;
      let c: Color;
      if (e < 1) c = st.seam[0];
      else if (e < 2) c = st.seam[1];
      else {
        const dx = x + 0.5 - o.cx, dy = y + 0.5 - o.cy;
        const d = Math.hypot(dx, dy) / maxD;
        const a = Math.atan2(dy, dx);
        const lit = (Math.floor(((a + Math.PI) / (2 * Math.PI)) * rays * 2) & 1) === 0;
        // lit rays tone 1, dark rays tone 2; the corners one tone darker, a glow behind the numeral
        let t = (lit ? 1 : 2) + Math.max(0, d - 0.55) * 2.2;
        if (d < 0.22) t -= (0.22 - d) * 6;
        const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        const tone = Math.max(0, Math.min(3, Math.floor(t + 0.5 + (th - 0.5) * 0.6)));
        c = ramp[tone];
        if (st.stars && tone >= 2) {
          const hsh = (Math.imul(x + 17, 73856093) ^ Math.imul(y + 5, 19349663)) >>> 0;
          if (hsh % 97 === 0) c = hsh % 3 ? P.greyLight : P.white;
        }
      }
      px(out, x, y, c);
    }
  }
  return out;
}

/** True when a sprite pixel is drawn (layout and QA helpers). */
export function opaqueAt(img: Rgba, x: number, y: number): boolean {
  return get(img, x, y) !== TRANSPARENT;
}
