// Head shapes, eyes (open/closed), mouths (closed/open), face extras.
// Head occupies rows 10-24, x 8-23 (16 px) plus ears; eyes at rows 16-18 (x 12-13 and 18-19), mouth at rows 21-22.

import { Grid, code } from '../grid.ts';

const S = code('S', 1);

export interface HeadShape {
  id: string;
  rows: string[]; // left half starting at x 7, rows from y 10
  ears: boolean;
}

// left halves, x 7..15 (9 columns), rows y 10..24
export const HEADS: HeadShape[] = [
  {
    id: 'round', ears: true,
    rows: [
      '....SSSSS', '..SSSSSSS', '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS',
      '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '..SSSSSSS', '...SSSSSS', '.....SSSS',
    ],
  },
  {
    id: 'square', ears: true,
    rows: [
      '...SSSSSS', '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS',
      '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '...SSSSSS',
    ],
  },
  {
    id: 'oval', ears: true,
    rows: [
      '.....SSSS', '...SSSSSS', '..SSSSSSS', '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS',
      '.SSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '..SSSSSSS', '..SSSSSSS', '...SSSSSS', '.....SSSS',
    ],
  },
  {
    id: 'heart', ears: true,
    rows: [
      '...SSSSSS', '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS',
      '.SSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '..SSSSSSS', '...SSSSSS', '....SSSSS', '......SSS',
    ],
  },
  {
    id: 'chubby', ears: false,
    rows: [
      '....SSSSS', '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', 'SSSSSSSSS', 'SSSSSSSSS',
      'SSSSSSSSS', 'SSSSSSSSS', 'SSSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '...SSSSSS', '.....SSSS',
    ],
  },
  {
    id: 'block', ears: true,
    rows: [
      '..SSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS',
      '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '.SSSSSSSS', '..SSSSSSS', '..SSSSSSS', '....SSSSS',
    ],
  },
];

export type Nose = 'none' | 'dot' | 'button' | 'long';
export const NOSES: Nose[] = ['dot', 'button', 'long', 'none'];
export type Cheeks = 'none' | 'blush' | 'freckles';

export function head(shape: HeadShape, nose: Nose, cheeks: Cheeks): Grid {
  const g = new Grid();
  g.stamp(7, 10, shape.rows, { mirror: true, main: 'S' });
  if (shape.ears) {
    g.sym(6, 16, S);
    g.sym(6, 17, S);
    g.sym(7, 17, code('S', 2));
    g.sym(6, 18, S);
  }
  // under-chin shade and a soft jaw shadow on the right (light comes from the top-left)
  for (let x = 8; x <= 23; x++) {
    if (g.get(x, 24) && !g.get(x, 25)) g.set(x, 24, code('S', 2));
  }
  if (nose === 'dot') g.set(16, 19, code('S', 2));
  if (nose === 'button') {
    g.set(15, 19, code('S', 0));
    g.set(16, 19, code('S', 2));
    g.set(16, 20, code('S', 2));
  }
  if (nose === 'long') {
    g.set(16, 18, code('S', 2));
    g.set(16, 19, code('S', 2));
    g.set(15, 19, code('S', 1));
    g.set(17, 19, code('S', 2));
  }
  if (cheeks === 'blush') {
    g.set(10, 20, code('A', 1)); g.set(11, 20, code('A', 1));
    g.set(20, 20, code('A', 1)); g.set(21, 20, code('A', 1));
  }
  if (cheeks === 'freckles') {
    g.set(10, 19, code('S', 2)); g.set(12, 20, code('S', 2)); g.set(11, 21, code('S', 2));
    g.set(21, 19, code('S', 2)); g.set(19, 20, code('S', 2)); g.set(20, 21, code('S', 2));
  }
  return g;
}

// ---------- eyes ----------
// Left eye box x 11..14, right eye box x 17..20; rows 15..19. Drawn explicitly per side so glints stay top-left.

export interface EyeStyle {
  id: string;
  left: string[]; // 4 cols starting x 11, rows from y 15
  right?: string[]; // 4 cols starting x 17; default = left shifted
  closed?: string[]; // blink frame, left side (mirrored placement)
  glasses?: boolean; // lenses do not blink
}

export const EYES: EyeStyle[] = [
  { id: 'dot', left: ['....', '....', '.KK.', '.KK.'], right: ['....', '....', '.KK.', '.KK.'] },
  { id: 'tall', left: ['....', '.WK.', '.KK.', '.KK.'], right: ['....', '.WK.', '.KK.', '.KK.'] },
  { id: 'bright', left: ['....', '.WW.', '.KW.', '.KK.'], right: ['....', '.WW.', '.KW.', '.KK.'] },
  { id: 'lash', left: ['K...', '.WK.', '.KK.', '.KK.'], right: ['...K', '.WK.', '.KK.', '.KK.'] },
  { id: 'sleepy', left: ['....', '.ss.', '.KK.', '.KK.'], right: ['....', '.ss.', '.KK.', '.KK.'] },
  { id: 'wide', left: ['....', 'WWK.', 'WKK.', '....'], right: ['....', '.WWK', '.WKK', '....'] },
  { id: 'brow', left: ['jj..', '.WK.', '.KK.', '.KK.'], right: ['..jj', '.WK.', '.KK.', '.KK.'] },
  { id: 'cross', left: ['.jj.', '..j.', '.WK.', '.KK.'], right: ['.jj.', '.j..', '.WK.', '.KK.'] },
  { id: 'happy', left: ['....', '.KK.', 'K..K', '....'], right: ['....', '.KK.', 'K..K', '....'], closed: ['....', '....', 'KKKK', '....'] },
  { id: 'glasses', glasses: true, left: ['AAAA', 'AWKA', 'AKKA', 'AAAA'], right: ['AAAA', 'AWKA', 'AKKA', 'AAAA'], closed: ['AAAA', 'A..A', 'AxxA', 'AAAA'] },
  { id: 'shades', glasses: true, left: ['kkkk', 'kWbk', 'kbbk', '.kk.'], right: ['kkkk', 'kWbk', 'kbbk', '.kk.'], closed: ['kkkk', 'kWbk', 'kbbk', '.kk.'] },
];

export function eyes(style: EyeStyle, closed: boolean): Grid {
  const g = new Grid();
  const y0 = 15;
  if (closed) {
    const rows = style.closed ?? ['....', '....', '....', '.xx.'];
    g.stamp(11, y0, rows, { main: 'S' });
    g.stamp(17, y0, rows, { main: 'S' });
  } else {
    g.stamp(11, y0, style.left, { main: 'H' });
    g.stamp(17, y0, style.right ?? style.left, { main: 'H' });
  }
  if (style.glasses) {
    g.set(15, 16, style.id === 'shades' ? code('A', 3) : code('A', 1));
    g.set(16, 16, style.id === 'shades' ? code('A', 3) : code('A', 1));
    if (style.id === 'shades') {
      g.set(15, 16, 105); // navyDark bridge
      g.set(16, 16, 105);
    }
  }
  return g;
}

// ---------- mouths ----------
// x 13..18, rows 20..23. Facial hair uses the hair ramp (H).

export interface MouthStyle {
  id: string;
  closed: string[]; // 6 cols from x 13, rows from y 20
  open: string[];
  hair?: boolean; // facial hair: outline it
}

export const MOUTHS: MouthStyle[] = [
  { id: 'smile', closed: ['......', '.x..x.', '..xx..'], open: ['......', '.MMMM.', '..Mm..'] },
  { id: 'line', closed: ['......', '..xx..', '......'], open: ['......', '..MM..', '..MM..'] },
  { id: 'grin', closed: ['......', '.MWWM.', '..MM..'], open: ['......', '.MWWM.', '.MmmM.', '..MM..'] },
  { id: 'smirk', closed: ['......', '...xx.', '....x.'], open: ['......', '...MM.', '...Mm.'] },
  { id: 'o', closed: ['......', '..MM..', '..MM..'], open: ['..MM..', '.MMMM.', '.MmmM.', '..MM..'] },
  { id: 'cat', closed: ['......', '.x.x..', '..x.x.'], open: ['......', '.MMMM.', '..mm..'] },
  { id: 'tongue', closed: ['......', '.xxxx.', '..mm..'], open: ['......', '.MMMM.', '..mm..'] },
  { id: 'moustache', hair: true, closed: ['.HHHH.', 'HHhhHH', '..xx..'], open: ['.HHHH.', 'HHhhHH', '..MM..', '..Mm..'] },
  { id: 'beard', hair: true, closed: ['......', 'H.xx.H', 'HHHHHH', '.HHHH.'], open: ['......', 'H.MM.H', 'HHMmHH', '.HHHH.'] },
];

export function mouth(style: MouthStyle, open: boolean): Grid {
  const g = new Grid();
  g.stamp(13, 20, open ? style.open : style.closed, { main: 'S' });
  if (style.id === 'beard') {
    // full beard along the jaw
    for (let y = 19; y <= 24; y++) {
      g.set(8, y, code('H', 1)); g.set(23, y, code('H', 2));
      if (y >= 21) { g.set(9, y, code('H', 1)); g.set(22, y, code('H', 2)); }
      if (y >= 22) for (let x = 10; x <= 21; x++) if (!g.get(x, y) || y >= 23) g.set(x, y, code('H', x > 16 ? 2 : 1));
    }
    if (open) { g.set(15, 22, 113); g.set(16, 22, 114); }
  }
  return g;
}
