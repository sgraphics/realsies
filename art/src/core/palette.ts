// Master palette: ENDESGA 32 (by ENDESGA, free to use). Every pixel the engine draws is one of these.
// Colours are packed 0xRRGGBB numbers. -1 means transparent.

export type Color = number;
export const TRANSPARENT = -1;

export const PAL = {
  rust: 0xbe4a2f,
  clay: 0xd77643,
  cream: 0xead4aa,
  tan: 0xe4a672,
  brownLight: 0xb86f50,
  brown: 0x733e39,
  plum: 0x3e2731, // darkest warm
  redDark: 0xa22633,
  red: 0xe43b44,
  orange: 0xf77622,
  gold: 0xfeae34,
  yellow: 0xfee761,
  lime: 0x63c74d,
  green: 0x3e8948,
  greenDark: 0x265c42,
  tealDark: 0x193c3e,
  blueDark: 0x124e89,
  blue: 0x0099db,
  cyan: 0x2ce8f5,
  white: 0xffffff,
  greyLight: 0xc0cbdc,
  grey: 0x8b9bb4,
  slate: 0x5a6988,
  navy: 0x3a4466,
  navyDark: 0x262b44,
  black: 0x181425, // darkest cool
  hotRed: 0xff0044,
  purple: 0x68386c,
  magenta: 0xb55088,
  pink: 0xf6757a,
  peach: 0xe8b796,
  skinMid: 0xc28569,
} as const;

export type PalName = keyof typeof PAL;
export const MASTER: Color[] = Object.values(PAL);
const MASTER_SET = new Set<number>(MASTER);
export function isMaster(c: Color): boolean {
  return MASTER_SET.has(c);
}

/** A ramp: [highlight, base, shadow, dark/outline]. */
export type Ramp = readonly [Color, Color, Color, Color];

const P = PAL;
export const RAMPS = {
  // cloth / general
  red: [P.pink, P.red, P.redDark, P.plum],
  crimson: [P.red, P.redDark, P.plum, P.black],
  hotpink: [P.pink, P.hotRed, P.redDark, P.plum],
  orange: [P.gold, P.orange, P.rust, P.brown],
  gold: [P.yellow, P.gold, P.orange, P.brown],
  lemon: [P.white, P.yellow, P.gold, P.clay],
  lime: [P.yellow, P.lime, P.green, P.greenDark],
  green: [P.lime, P.green, P.greenDark, P.tealDark],
  forest: [P.green, P.greenDark, P.tealDark, P.black],
  sky: [P.cyan, P.blue, P.blueDark, P.navyDark],
  royal: [P.blue, P.blueDark, P.navyDark, P.black],
  navy: [P.slate, P.navy, P.navyDark, P.black],
  purple: [P.magenta, P.purple, P.plum, P.black],
  magenta: [P.pink, P.magenta, P.purple, P.plum],
  grey: [P.greyLight, P.grey, P.slate, P.navy],
  white: [P.white, P.greyLight, P.grey, P.slate],
  charcoal: [P.slate, P.navy, P.navyDark, P.black],
  black: [P.navy, P.navyDark, P.black, P.black],
  brown: [P.skinMid, P.brownLight, P.brown, P.plum],
  chocolate: [P.brownLight, P.brown, P.plum, P.black],
  khaki: [P.cream, P.tan, P.skinMid, P.brown],
  cream: [P.white, P.cream, P.tan, P.brownLight],
  rust: [P.clay, P.rust, P.brown, P.plum],
  teal: [P.cyan, P.blue, P.tealDark, P.black],
  // skin tones
  skin1: [P.cream, P.peach, P.skinMid, P.brown],
  skin2: [P.peach, P.tan, P.skinMid, P.brown],
  skin3: [P.tan, P.skinMid, P.brownLight, P.brown],
  skin4: [P.skinMid, P.brownLight, P.brown, P.plum],
  skin5: [P.brownLight, P.brown, P.plum, P.black],
  // metals
  steel: [P.white, P.greyLight, P.grey, P.slate],
  iron: [P.grey, P.slate, P.navy, P.navyDark],
  brass: [P.yellow, P.gold, P.clay, P.brown],
} as const satisfies Record<string, Ramp>;

export type RampName = keyof typeof RAMPS;

export const SKIN_RAMPS: RampName[] = ['skin1', 'skin2', 'skin3', 'skin4', 'skin5'];
export const HAIR_RAMPS_NATURAL: RampName[] = ['black', 'chocolate', 'brown', 'rust', 'gold', 'cream', 'white', 'charcoal'];
export const HAIR_RAMPS_FUN: RampName[] = ['sky', 'magenta', 'lime', 'red', 'purple', 'hotpink', 'teal'];
export const CLOTH_RAMPS: RampName[] = [
  'red', 'crimson', 'hotpink', 'orange', 'gold', 'lemon', 'lime', 'green', 'forest', 'sky', 'royal', 'navy',
  'purple', 'magenta', 'grey', 'white', 'charcoal', 'black', 'brown', 'chocolate', 'khaki', 'cream', 'rust', 'teal',
];

// ---------- colour maths over the master palette ----------

function rgb(c: Color): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
function lum(c: Color): number {
  const [r, g, b] = rgb(c);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function nearest(c: Color): Color {
  const [r, g, b] = rgb(c);
  let best = MASTER[0];
  let bd = Infinity;
  for (const m of MASTER) {
    const [mr, mg, mb] = rgb(m);
    // weighted distance, roughly perceptual
    const d = 2 * (r - mr) ** 2 + 4 * (g - mg) ** 2 + 3 * (b - mb) ** 2;
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

// Hand-picked darker neighbour of every master colour (same hue family, one step down).
const DARKER: Record<number, Color> = {
  [P.rust]: P.brown,
  [P.clay]: P.rust,
  [P.cream]: P.tan,
  [P.tan]: P.skinMid,
  [P.brownLight]: P.brown,
  [P.brown]: P.plum,
  [P.plum]: P.black,
  [P.redDark]: P.plum,
  [P.red]: P.redDark,
  [P.orange]: P.rust,
  [P.gold]: P.orange,
  [P.yellow]: P.gold,
  [P.lime]: P.green,
  [P.green]: P.greenDark,
  [P.greenDark]: P.tealDark,
  [P.tealDark]: P.black,
  [P.blueDark]: P.navyDark,
  [P.blue]: P.blueDark,
  [P.cyan]: P.blue,
  [P.white]: P.greyLight,
  [P.greyLight]: P.grey,
  [P.grey]: P.slate,
  [P.slate]: P.navy,
  [P.navy]: P.navyDark,
  [P.navyDark]: P.black,
  [P.black]: P.black,
  [P.hotRed]: P.redDark,
  [P.purple]: P.plum,
  [P.magenta]: P.purple,
  [P.pink]: P.magenta,
  [P.peach]: P.skinMid,
  [P.skinMid]: P.brownLight,
};
const LIGHTER: Record<number, Color> = {
  [P.rust]: P.clay,
  [P.clay]: P.tan,
  [P.cream]: P.white,
  [P.tan]: P.cream,
  [P.brownLight]: P.skinMid,
  [P.brown]: P.brownLight,
  [P.plum]: P.brown,
  [P.redDark]: P.red,
  [P.red]: P.pink,
  [P.orange]: P.gold,
  [P.gold]: P.yellow,
  [P.yellow]: P.white,
  [P.lime]: P.yellow,
  [P.green]: P.lime,
  [P.greenDark]: P.green,
  [P.tealDark]: P.greenDark,
  [P.blueDark]: P.blue,
  [P.blue]: P.cyan,
  [P.cyan]: P.white,
  [P.white]: P.white,
  [P.greyLight]: P.white,
  [P.grey]: P.greyLight,
  [P.slate]: P.grey,
  [P.navy]: P.slate,
  [P.navyDark]: P.navy,
  [P.black]: P.navyDark,
  [P.hotRed]: P.pink,
  [P.purple]: P.magenta,
  [P.magenta]: P.pink,
  [P.pink]: P.peach,
  [P.peach]: P.cream,
  [P.skinMid]: P.tan,
};

/** One step darker inside the master palette. */
export function darker(c: Color, steps = 1): Color {
  let x = isMaster(c) ? c : nearest(c);
  for (let i = 0; i < steps; i++) x = DARKER[x] ?? x;
  return x;
}
/** One step lighter inside the master palette. */
export function lighter(c: Color, steps = 1): Color {
  let x = isMaster(c) ? c : nearest(c);
  for (let i = 0; i < steps; i++) x = LIGHTER[x] ?? x;
  return x;
}
export function luminance(c: Color): number {
  return lum(c);
}

export function hex(c: Color): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}
