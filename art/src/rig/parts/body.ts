// Body parts on the 32x48 rig: torso styles, arms (2 sway frames + wave), legs (straight + bent), feet.
// Rows: head 10-24, torso 25-36, legs 37-42, feet 43-45. Centre line between x 15 and 16.

import { Grid, code, type Slot } from '../grid.ts';

export type Build = 'slim' | 'regular' | 'broad';
export const BUILDS: Build[] = ['slim', 'regular', 'broad'];

const C = (s: Slot, shade: 0 | 1 | 2 | 3 = 1) => code(s, shade);

export function torsoSpan(b: Build): [number, number] {
  const hw = b === 'slim' ? 5 : b === 'regular' ? 6 : 7;
  return [16 - hw, 15 + hw];
}
export const TORSO_TOP = 25;
export const TORSO_BOTTOM = 36;

export type SleeveKind = 'long' | 'short' | 'none';

export interface TorsoStyle {
  id: string;
  sleeves: SleeveKind;
  /** Covers the upper legs (dresses, robes): legs only show below this row. */
  skirtTo?: number;
  draw(g: Grid, b: Build): void;
}

/** The plain torso silhouette filled with slot P. */
function base(g: Grid, b: Build, fill = C('P')): void {
  const [l] = torsoSpan(b);
  for (let y = TORSO_TOP; y <= TORSO_BOTTOM; y++) {
    const inset = y === TORSO_TOP ? 2 : y === TORSO_TOP + 1 ? 1 : 0;
    for (let x = l + inset; x <= 15; x++) g.sym(x, y, fill);
  }
}
/** Skin showing at the neck under the chin. */
function neck(g: Grid, w = 2): void {
  for (let x = 16 - w; x <= 15; x++) g.sym(x, TORSO_TOP, C('S', 2));
}

export const TORSOS: TorsoStyle[] = [
  {
    id: 'tee', sleeves: 'short',
    draw(g, b) {
      base(g, b);
      neck(g, 2);
      g.sym(13, TORSO_TOP, C('P', 2));
      g.rectSym(10, 36, 6, 1, C('P', 2));
    },
  },
  {
    id: 'hoodie', sleeves: 'long',
    draw(g, b) {
      base(g, b);
      const [l] = torsoSpan(b);
      // hood rim around the neck
      for (let x = l + 2; x <= 15; x++) g.sym(x, TORSO_TOP, C('P', 2));
      neck(g, 1);
      // strings
      g.sym(14, 26, C('A', 1)); g.sym(14, 27, C('A', 1)); g.sym(14, 28, C('A', 2));
      // kangaroo pocket
      g.rectSym(12, 32, 4, 1, C('P', 2));
      g.sym(12, 33, C('P', 2)); g.sym(12, 34, C('P', 2));
      // ribbed hem
      for (let x = l; x <= 15; x++) g.sym(x, 36, C('P', 2));
    },
  },
  {
    id: 'jacket', sleeves: 'long',
    draw(g, b) {
      base(g, b);
      // inner shirt down the middle
      for (let y = TORSO_TOP; y <= 36; y++) g.rectSym(14, y, 2, 1, C('Q'));
      neck(g, 1);
      // lapels
      g.sym(13, 26, C('P', 0)); g.sym(13, 27, C('P', 0)); g.sym(14, 28, C('P', 0));
      // zipper edge
      for (let y = 29; y <= 36; y++) g.sym(13, y, C('P', 2));
      g.sym(11, 31, C('P', 2)); g.sym(12, 31, C('P', 2)); // pocket flaps
    },
  },
  {
    id: 'overalls', sleeves: 'short',
    draw(g, b) {
      base(g, b, C('Q'));
      neck(g, 2);
      // bib + straps in P (legs carry the same P via bindings)
      g.rectSym(12, 30, 4, 7, C('P'));
      g.rectSym(12, 26, 1, 4, C('P'));
      g.sym(12, 30, C('A', 0)); // buttons
      g.rectSym(14, 31, 2, 1, C('P', 2)); // bib pocket
      g.rectSym(13, 32, 1, 1, C('P', 2));
    },
  },
  {
    id: 'tank', sleeves: 'none',
    draw(g, b) {
      base(g, b);
      const [l] = torsoSpan(b);
      // bare shoulders
      for (let y = TORSO_TOP; y <= 27; y++) for (let x = l; x <= 12; x++) if (g.get(x, y)) g.sym(x, y, C('S'));
      neck(g, 3);
      g.sym(13, TORSO_TOP, C('P')); // straps
      g.sym(13, 26, C('P'));
      g.rectSym(10, 36, 6, 1, C('P', 2));
    },
  },
  {
    id: 'sweater', sleeves: 'long',
    draw(g, b) {
      base(g, b);
      // shirt collar points
      g.sym(14, TORSO_TOP, C('Q', 0)); g.sym(15, TORSO_TOP, C('Q', 0)); g.sym(14, 26, C('Q', 1));
      // knit pattern band
      for (let x = 10; x <= 15; x++) if ((x & 1) === 0) g.sym(x, 29, C('Q'));
      for (let x = 10; x <= 15; x++) g.sym(x, 30, C('Q', 2));
      for (let x = 10; x <= 15; x++) if ((x & 1) === 1) g.sym(x, 31, C('Q'));
      // ribbed hem
      for (let x = 9; x <= 15; x++) if (g.get(x, 36)) g.sym(x, 36, (x & 1) ? C('P', 2) : C('P', 1));
    },
  },
  {
    id: 'suit', sleeves: 'long',
    draw(g, b) {
      base(g, b);
      // white shirt V and a tie in accent
      for (let y = TORSO_TOP; y <= 30; y++) {
        const w = Math.max(1, 3 - Math.floor((y - TORSO_TOP) / 2));
        g.rectSym(16 - w, y, w, 1, C('Q', 0));
      }
      g.set(15, 26, C('A', 0)); g.set(16, 26, C('A', 1));
      g.set(15, 27, C('A', 1)); g.set(16, 27, C('A', 1));
      g.set(15, 28, C('A', 1)); g.set(16, 28, C('A', 2));
      g.set(15, 29, C('A', 1)); g.set(16, 29, C('A', 2));
      g.set(15, 30, C('A', 2)); g.set(16, 30, C('A', 2));
      // lapel lines and buttons
      g.sym(13, 27, C('P', 2)); g.sym(14, 29, C('P', 2)); g.sym(14, 31, C('P', 2));
      g.set(15, 33, C('P', 3)); g.set(15, 35, C('P', 3));
    },
  },
  {
    id: 'armor', sleeves: 'long',
    draw(g, b) {
      base(g, b);
      neck(g, 1);
      // breastplate highlight and plates
      g.rectSym(12, 27, 3, 3, C('P', 0));
      g.rectSym(13, 28, 1, 1, C('P', 1));
      for (let x = 10; x <= 15; x++) g.sym(x, 31, C('P', 3));
      for (let x = 10; x <= 15; x++) g.sym(x, 34, C('P', 3));
      g.sym(11, 32, C('P', 0)); g.sym(11, 35, C('P', 0));
      // gold trim
      g.rectSym(14, 26, 2, 1, C('A'));
      g.set(15, 32, C('A', 0)); g.set(16, 32, C('A'));
    },
  },
  {
    id: 'stripes', sleeves: 'short',
    draw(g, b) {
      base(g, b);
      neck(g, 2);
      for (let y = 27; y <= 36; y += 3) for (let x = 8; x <= 15; x++) if (g.get(x, y)) g.sym(x, y, C('Q'));
      for (let y = 28; y <= 36; y += 3) for (let x = 8; x <= 15; x++) if (g.get(x, y)) g.sym(x, y, C('Q', 2));
    },
  },
  {
    id: 'vest', sleeves: 'long',
    draw(g, b) {
      base(g, b, C('Q'));
      const [l] = torsoSpan(b);
      // vest panels on the sides in P, open in the middle
      for (let y = 26; y <= 36; y++) for (let x = l; x <= 12 + (y > 31 ? 1 : 0); x++) g.sym(x, y, C('P'));
      neck(g, 1);
      g.sym(13, 33, C('A', 0)); g.sym(13, 35, C('A', 0)); // buttons
      g.sym(11, 30, C('P', 2)); g.sym(12, 30, C('P', 2)); // pocket
    },
  },
  {
    id: 'tunic', sleeves: 'long', skirtTo: 39,
    draw(g, b) {
      base(g, b);
      neck(g, 2);
      // V neck lacing
      g.set(15, 26, C('Q')); g.set(16, 26, C('Q')); g.set(15, 27, C('Q', 2));
      // belt with buckle
      for (let x = 9; x <= 15; x++) if (g.get(x, 34)) g.sym(x, 34, C('A', 2));
      g.set(15, 34, C('A', 0)); g.set(16, 34, C('A', 0));
      // flared hem over the thighs
      const [l] = torsoSpan(b);
      for (let y = 37; y <= 39; y++) for (let x = l - (y - 36 > 1 ? 1 : 0); x <= 15; x++) g.sym(x, y, C('P'));
      for (let x = l - 1; x <= 15; x += 2) g.sym(x, 39, C('P', 2));
    },
  },
  {
    id: 'robe', sleeves: 'long', skirtTo: 41,
    draw(g, b) {
      base(g, b);
      neck(g, 1);
      const [l] = torsoSpan(b);
      for (let y = 37; y <= 41; y++) for (let x = l - Math.min(2, (y - 36) >> 1); x <= 15; x++) g.sym(x, y, C('P'));
      // trim down the front and at the hem
      for (let y = 26; y <= 41; y++) g.set(15, y, C('Q'));
      for (let y = 26; y <= 41; y++) g.set(16, y, C('Q', 2));
      for (let x = l - 2; x <= 15; x++) if (g.get(x, 41)) g.sym(x, 41, C('Q', 2));
      g.rectSym(10, 33, 6, 1, C('A'));
    },
  },
];

// ---------- arms ----------

export type ArmFrame = 0 | 1 | 2; // 0 down, 1 swung out 1 px, 2 raised (wave)

/** Left arm (viewer's left). The right arm is the mirror. */
export function arm(b: Build, sleeves: SleeveKind, frame: ArmFrame, gloves: boolean): Grid {
  const g = new Grid();
  const [l] = torsoSpan(b);
  const ax = l - 3; // arm columns ax..ax+2
  const sleeve = (y: number) => (sleeves === 'none' ? false : sleeves === 'short' ? y <= 28 : y <= 32);
  const hand = gloves ? C('A') : C('S');
  const handSh = gloves ? C('A', 2) : C('S', 2);
  if (frame === 2) {
    // raised: forearm up beside the head, hand at the top
    const cells: [number, number][] = [];
    for (let y = 26; y <= 28; y++) cells.push([ax + 1, y], [ax + 2, y]);
    for (let y = 20; y <= 25; y++) cells.push([ax, y], [ax + 1, y]);
    for (const [x, y] of cells) g.set(x, y, sleeves === 'none' || (sleeves === 'short' && y < 26) ? C('S') : C('P'));
    g.rect(ax - 1, 17, 3, 3, hand);
    g.set(ax + 1, 19, handSh);
    return g;
  }
  const out = frame === 1 ? 1 : 0;
  g.set(ax + 1, 26, sleeve(26) ? C('P') : C('S'));
  g.set(ax + 2, 26, sleeve(26) ? C('P') : C('S'));
  for (let y = 27; y <= 32; y++) {
    const dx = y >= 30 ? -out : 0;
    for (let x = 0; x < 3; x++) g.set(ax + x + dx, y, sleeve(y) ? C('P') : C('S'));
    // inner fold shadow
    g.set(ax + 2 + dx, y, sleeve(y) ? C('P', 2) : C('S', 2));
  }
  if (sleeves === 'short') for (let x = 0; x < 3; x++) g.set(ax + x, 28, C('P', 2));
  if (sleeves === 'long') for (let x = 0; x < 3; x++) g.set(ax + x - out, 32, C('P', 2));
  // hand
  for (let y = 33; y <= 34; y++) for (let x = 0; x < 3; x++) g.set(ax + x - out, y, hand);
  g.set(ax + 2 - out, 34, handSh);
  return g;
}

/** Where the viewer's-right hand is (for held items), per build and frame. */
export function rightHand(b: Build, frame: ArmFrame): { x: number; y: number } {
  const [, r] = torsoSpan(b);
  if (frame === 2) return { x: r + 2, y: 18 };
  return { x: r + 2 + (frame === 1 ? 1 : 0), y: 33 };
}

// ---------- legs ----------

export interface LegStyle {
  id: string;
  draw(g: Grid, bent: boolean): void;
}

// leg columns: left leg x 11..13, right leg x 18..20 (3 px), hips joined at the top row
function legCells(bent: boolean): [number, number][] {
  const cells: [number, number][] = [];
  const top = bent ? 38 : 37;
  for (let y = top; y <= 42; y++) {
    const knee = bent && (y === 39 || y === 40) ? -1 : 0;
    for (let x = 11; x <= 13; x++) cells.push([x + knee, y]);
  }
  // crotch join on the first row
  cells.push([14, top], [15, top]);
  return cells;
}

function legsFill(g: Grid, bent: boolean, pick: (y: number, x: number) => number): void {
  for (const [x, y] of legCells(bent)) g.sym(x, y, pick(y, x));
}

export const LEGS: LegStyle[] = [
  { id: 'trousers', draw: (g, bent) => legsFill(g, bent, (y, x) => (x === 13 && y > 38 ? C('P', 2) : C('P'))) },
  {
    id: 'shorts',
    draw: (g, bent) => legsFill(g, bent, (y, x) => (y <= (bent ? 39 : 38) ? (y === (bent ? 39 : 38) ? C('P', 2) : C('P')) : x === 13 ? C('S', 2) : C('S'))),
  },
  { id: 'jeans', draw: (g, bent) => legsFill(g, bent, (y, x) => (y === 42 ? C('P', 0) : x === 12 && y > 39 ? C('P', 2) : C('P'))) },
  {
    id: 'skirt',
    draw(g, bent) {
      legsFill(g, bent, (_y, x) => (x === 13 ? C('S', 2) : C('S')));
      const top = bent ? 38 : 37;
      for (let y = top; y <= top + 2; y++) for (let x = 10 - (y - top >> 1); x <= 15; x++) g.sym(x, y, y === top + 2 ? C('P', 2) : C('P'));
    },
  },
  {
    id: 'striped',
    draw: (g, bent) => legsFill(g, bent, (y) => ((y & 1) ? C('P') : C('Q'))),
  },
  {
    id: 'baggy',
    draw(g, bent) {
      legsFill(g, bent, (y, x) => (x === 13 ? C('P', 2) : C('P')));
      const top = bent ? 38 : 37;
      for (let y = top + 1; y <= 42; y++) g.sym(bent && (y === 39 || y === 40) ? 9 : 10, y, C('P'));
      g.sym(12, 41, C('P', 2));
    },
  },
];

// ---------- feet ----------

export interface FootStyle {
  id: string;
  rows: string[]; // left foot, 5 cols at x 9..13, rows 42..45 (row 42 overlaps the leg bottom)
}

export const FEET: FootStyle[] = [
  { id: 'sneakers', rows: ['.....', '..PPP', '.PPPP', 'WWWWW'] },
  { id: 'boots', rows: ['..PPP', '..PPP', '.PPPP', 'ppppp'] },
  { id: 'shoes', rows: ['.....', '..PPP', '*PPPP', 'ttttt'] },
  { id: 'hightops', rows: ['..PPP', '..WPW', '.PPPP', 'WWWWW'] },
  { id: 'sandals', rows: ['.....', '..SSS', '.PSSS', 'ppppp'] },
  { id: 'slippers', rows: ['.....', '.PPPP', 'PPPPP', 'ppppp'] },
  { id: 'pointy', rows: ['.....', '..PPP', '.PPPP', 'PPPPp'] },
  { id: 'clogs', rows: ['.....', '.PPPP', '.PPPP', 'NNNNN'] },
];

export function foot(style: FootStyle): Grid {
  const g = new Grid();
  g.stamp(9, 42, style.rows, { mirror: true });
  if (style.id === 'pointy') {
    g.sym(8, 44, C('P'));
    g.sym(8, 43, C('P', 2));
  }
  return g;
}
