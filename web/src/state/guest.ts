// A guest watches the room before signing in: no session, nothing kept on the relay. The current round comes from
// the public GET /api/round (protocol v1.7), and the ten characters of each level are drawn here, for guests. A
// player's own characters are drawn by the relay for that player alone, so after sign-in the same seats show the
// player's own; the seat that was tapped is the one that opens.

import { LEVELS, themeFor, type Level, type RoundState, type Seat } from '../../../shared/protocol.ts';
import { gamertag } from '../../../shared/names.ts';
import { sha256Hex } from '../verify/crypto.ts';
import type { RoomView } from './store.ts';

/** The three rooms a guest sees in this round: every seat open, the same for every guest. */
export function guestRooms(round: RoundState): Partial<Record<Level, RoomView>> {
  const rooms: Partial<Record<Level, RoomView>> = {};
  for (const level of LEVELS) {
    const seats: Seat[] = [];
    for (let i = 0; i < 10; i++) {
      const seed = sha256Hex(`realsies:guest|${round.roundId}|${level}|${i}`);
      seats.push({ index: i, skin: { seed, name: gamertag(seed) }, state: 'open' });
    }
    rooms[level] = { roundId: round.roundId, theme: round.themes[level] ?? themeFor(level, round.roundId), seats };
  }
  return rooms;
}

/** A tapped seat waiting for sign-in: once the player's own room is in, its dialog opens. */
export interface PendingSeat {
  level: Level;
  index: number;
}
