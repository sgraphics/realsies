// Build every layer sprite of a look once (recoloured and outlined), so a frame is just blits.

import type { Rgba } from '../core/buffer.ts';
import { RAMPS, type Ramp, type RampName } from '../core/palette.ts';
import { Grid, type Bindings, renderGrid, code, GW } from './grid.ts';
import type { Look } from './look.ts';
import { TORSOS, LEGS, FEET, arm, foot, rightHand, type ArmFrame, torsoSpan } from './parts/body.ts';
import { HEADS, EYES, MOUTHS, head, eyes, mouth } from './parts/head.ts';
import { HAIRS, hair } from './parts/hair.ts';
import { HATS, hat } from './parts/hats.ts';
import { BACKS, FRONTS, DECALS, decal } from './parts/items.ts';

export interface LayerSprites {
  back: Rgba[] | null; // wiggle frames
  hairBack: Rgba | null;
  legs: [Rgba, Rgba]; // straight, bent
  feet: Rgba;
  torso: Rgba;
  armL: [Rgba, Rgba, Rgba]; // down, out, raised
  armR: [Rgba, Rgba, Rgba];
  head: Rgba;
  eyes: [Rgba, Rgba]; // open, closed
  mouth: [Rgba, Rgba]; // closed, open
  hair: Rgba[]; // wiggle frames
  hat: Rgba[] | null;
  front: Rgba[] | null; // wiggle frames, at the arm-down hand position
  frontFx: Rgba[] | null; // un-outlined details (strings, steam)
  /** Rows covered by a skirt/robe: legs above this row are hidden by the torso. */
  skirtTo: number | null;
  hasWiggle: boolean;
}

const R = (n: RampName | string): Ramp => (RAMPS as Record<string, Ramp>)[n] ?? RAMPS.grey;

function bind(look: Look, P: string, Q: string, A: string, I: string = look.ramps.item): Bindings {
  return { S: R(look.ramps.skin), H: R(look.ramps.hair), P: R(P), Q: R(Q), A: R(A), I: R(I) };
}

export function buildSprites(look: Look): LayerSprites {
  const L = look.ramps;
  const torsoStyle = TORSOS[look.torso];
  const overalls = torsoStyle.id === 'overalls';
  const bTorso = overalls ? bind(look, L.bottom, L.top, L.accent, L.back) : bind(look, L.top, L.top2, L.accent, L.back);
  const bArms = bind(look, L.top, L.top2, look.gloves ? L.accent : L.accent);
  const bLegs = bind(look, L.bottom, L.bottom2, L.accent);
  const bFeet = bind(look, L.shoes, L.shoes, L.accent);
  const hatStyle = look.hat >= 0 ? HATS[look.hat] : null;
  const bHat = bind(look, hatStyle?.ramp ?? L.hat, hatStyle?.ramp2 ?? L.hat2, L.accent);
  const bHead = bind(look, L.top, L.top2, L.blush);
  const bEyes = bind(look, L.top, L.top2, L.glasses);
  const bHair = bind(look, L.hair, L.hair, L.accent);

  // ---- back item
  let back: Rgba[] | null = null;
  if (look.back >= 0) {
    const bi = BACKS[look.back];
    const bb = bind(look, bi.ramp ?? L.back, L.back2, L.accent, L.back);
    back = [0, 1].map((f) => {
      const g = new Grid();
      bi.draw(g, f);
      return renderGrid(g.bevel({ right: 1 }), bb);
    });
  }

  // ---- hair (front + back), clipped under a hat
  const hs = HAIRS[look.hair];
  const hairFrames: Rgba[] = [];
  let hairBack: Rgba | null = null;
  const frames = hs.wiggle ? [0, 1] : [0];
  for (const f of frames) {
    const { front: hf, back: hb } = hair(hs, f);
    if (hatStyle?.clipY !== undefined) {
      const clip = hatStyle.clipY;
      // remove hair rows above the hat line, except what pokes out at the far sides (afro puffs, pigtails)
      for (let y = 0; y < clip; y++) for (let x = 0; x < GW; x++) {
        if (hs.tall && (x < 6 || x > 25) && y >= clip - 4) continue;
        hf.set(x, y, 0);
      }
    }
    hairFrames.push(renderGrid(hf, bHair));
    if (hb && !hairBack) hairBack = renderGrid(hb.bevel({ right: 2 }), bHair);
  }

  // ---- legs
  const legStyle = LEGS[look.legs];
  const legs = [false, true].map((bent) => {
    const g = new Grid();
    legStyle.draw(g, bent);
    return renderGrid(g.bevel({ right: 1 }), bLegs);
  }) as [Rgba, Rgba];

  // ---- feet
  const feet = renderGrid(foot(FEET[look.feet]).bevel({ right: 1 }), bFeet);

  // ---- torso + decal
  const tg = new Grid();
  torsoStyle.draw(tg, look.build);
  tg.bevel({ right: 1, only: ['P', 'Q'] });
  if (look.back >= 0 && BACKS[look.back].id === 'backpack') {
    // shoulder straps over the chest, in the backpack's colour (slot I)
    const [l, r] = torsoSpan(look.build);
    for (let y = 25; y <= 31; y++) {
      tg.set(l + 2, y, code('I', y === 25 ? 0 : 1));
      tg.set(r - 2, y, code('I', 2));
    }
    tg.set(l + 2, 30, code('I', 0));
  }
  if (look.decal >= 0) {
    const dg = decal(DECALS[look.decal], look.decalNum, torsoStyle.id === 'hoodie' ? -1 : 0);
    tg.over(dg);
  }
  const torso = renderGrid(tg, bTorso);

  // ---- arms
  const armFrames = (mirror: boolean) =>
    ([0, 1, 2] as ArmFrame[]).map((f) => {
      let g = arm(look.build, torsoStyle.sleeves, f, look.gloves);
      if (mirror) g = g.flipped();
      return renderGrid(g.bevel({ right: 1 }), bArms);
    }) as [Rgba, Rgba, Rgba];
  const armL = armFrames(false);
  const armR = armFrames(true);

  // ---- head
  const hg = head(HEADS[look.head], look.nose, look.cheeks);
  hg.bevel({ right: 1, only: ['S'] });
  if (hs.id === 'bald') for (const [x, y] of [[11, 11], [12, 11], [11, 12]] as const) hg.set(x, y, code('S', 0));
  const headImg = renderGrid(hg, bHead);

  // ---- eyes and mouth (no outline: they sit inside the face)
  const es = EYES[look.eyes];
  const eyeImgs = [false, true].map((closed) => renderGrid(eyes(es, closed), bEyes, { outline: false })) as [Rgba, Rgba];
  const ms = MOUTHS[look.mouth];
  const mouthImgs = [false, true].map((open) => renderGrid(mouth(ms, open), bHair, { outline: !!ms.hair })) as [Rgba, Rgba];

  // ---- hat
  let hatImgs: Rgba[] | null = null;
  if (hatStyle) hatImgs = [0, 1].map((f) => renderGrid(hat(hatStyle, f), bHat));

  // ---- front item at the right hand (arm down)
  let front: Rgba[] | null = null;
  let frontFx: Rgba[] | null = null;
  if (look.front >= 0) {
    const fi = FRONTS[look.front];
    const bi = bind(look, L.item, L.top2, L.accent, fi.ramp ?? L.item);
    const hand = rightHand(look.build, 0);
    front = [];
    frontFx = [];
    for (const f of [0, 1]) {
      const g = new Grid();
      const fx = new Grid();
      fi.draw(g, hand.x - 2, hand.y, f, fx);
      front.push(renderGrid(g.bevel({ right: 1, only: ['I'] }), bi));
      frontFx.push(renderGrid(fx, bi, { outline: false }));
    }
  }

  return {
    back,
    hairBack,
    legs,
    feet,
    torso,
    armL,
    armR,
    head: headImg,
    eyes: eyeImgs,
    mouth: mouthImgs,
    hair: hairFrames,
    hat: hatImgs,
    front,
    frontFx,
    skirtTo: torsoStyle.skirtTo ?? null,
    hasWiggle: !!(hs.wiggle || hatStyle || look.back >= 0 || look.front >= 0),
  };
}
