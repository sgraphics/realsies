// Plug in: who is in it. Her from the "For realsies?" trailer in the middle (the same seed and pins,
// her large blue eyes), and two characters from seeded random looks either side. Nobody here is
// modelled on a real person.

import { MOUTHS, HAIRS, lookFromSeed, type Look } from '../../src/art.ts';
import { idx } from '../../src/engine/actor.ts';

/** Wavy auburn hair, teal blazer over a white shirt: the guest of the launch trailer. */
export function guestLook(): Look {
  const l = lookFromSeed('guest-17375');
  l.mouth = idx(MOUTHS, 'line');
  l.hair = idx(HAIRS, 'wavy');
  l.ramps.hair = 'rust';
  l.ramps.skin = 'skin2';
  l.front = -1;
  return l;
}

/** Left: the patterned cap and tall eyes. Right: the beret, the afro and bright eyes. */
export const LEFT_SEED = 'd4e142a845ca827a69e2b539ce8de89ae6c80748c48916d45e140644f9a0dbd0';
export const RIGHT_SEED = 'f2fa82747a4332921f4499f64ae639d91f63b5e223f3cebd7371ea79c12070bf';

export const leftLook = (): Look => lookFromSeed(LEFT_SEED);
export const rightLook = (): Look => lookFromSeed(RIGHT_SEED);
