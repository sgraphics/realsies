// For realsies?: who is in it. Rig seeds and the parts pinned for each role, the lobby's seats and
// gamertags, the player in the countdown, and the trio on the end card. Nobody here is modelled on
// a real person.

import { EYES, MOUTHS, HAIRS, FRONTS, rngFrom, randomSeed } from '../../src/art.ts';
import { idx, type CastMember } from '../../src/engine/actor.ts';

export const CAST: Record<'host' | 'guest', CastMember> = {
  // bald, glasses, moustache, red sweater, a notebook in hand: deadpan, and nobody real
  host: {
    id: 'host',
    seed: 'host-4843',
    pin: (l) => {
      l.eyes = idx(EYES, 'glasses');
      l.ramps.glasses = 'black';
      l.mouth = idx(MOUTHS, 'moustache');
      l.front = idx(FRONTS, 'book');
      l.ramps.item = 'royal';
    },
    smile: 'moustache',
  },
  // wavy auburn hair, teal blazer over a white shirt: polished, media-trained, possibly a bot
  guest: {
    id: 'guest',
    seed: 'guest-17375',
    pin: (l) => {
      l.mouth = idx(MOUTHS, 'line');
      l.hair = idx(HAIRS, 'wavy');
      l.ramps.hair = 'rust';
      l.ramps.skin = 'skin2';
      l.front = -1;
    },
    smile: 'smile',
  },
};

/** In the interview she has large blue eyes with highlights (the game screens keep her usual eyes). */
export const GUEST_BIG_EYES = true;

/** Gamertags for the lobby; index 2 is her. */
export const TAGS = ['Maple330', 'Kraken246', 'Juniper31', 'Coconut843', 'Pebble242', 'Lobster99', 'Acorn132', 'Lemon89', 'Rhino946', 'Walnut81'];
export const GUEST_SEAT = 2;
export const GUEST_TAG = TAGS[GUEST_SEAT];

/** The lobby's rig seeds by seat ('' at her seat), shared by the montage and the end card. */
export function lobbySeeds(): string[] {
  const r = rngFrom('trailer-lobby');
  return TAGS.map((_, i) => (i === GUEST_SEAT ? '' : randomSeed(r)));
}

/** The player in the countdown: dark bob, headphones, orange sweater. */
export const ME = { seed: 'me-120', name: 'Ana' };

/** The two lobby characters who join her on the end card: Coconut843 (his own sunglasses) and Pebble242 (cat ears). */
export const END_SEATS = { left: 3, right: 4 };
