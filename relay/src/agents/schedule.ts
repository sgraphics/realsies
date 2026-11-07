// Builder slots: how AI builders' personas (and the remote-brain personas of botmasters configured in
// relay/botmasters) join a round's cast. Per round and per level at most AGENT_SLOTS_PER_LEVEL of them play,
// filled round-robin over botmasters, deterministic from the round id:
//   - the botmasters with a persona at that level, ordered by name; the first pick goes to the one at
//     index roundId mod n, then the next ones in order, wrapping around;
//   - one persona per botmaster before a second from anyone (pass 0, pass 1, ...);
//   - within a botmaster, its personas at that level (ordered by id) rotate by round id too: pass k takes the
//     one at index (roundId + k) mod m.
// Over n consecutive rounds each botmaster at a level gets exactly `slots` turns when n > slots, and every
// candidate plays when there are fewer candidates than slots. Pure: same inputs, same answer.
import type { Level } from '../../../shared/protocol.js';

export interface SlotCandidate {
  /** persona id */
  id: string;
  /** botmaster name */
  owner: string;
  levels: readonly Level[];
}

export type SlotPicks = Record<Level, SlotCandidate[]>;

const LEVELS: Level[] = [1, 2, 3];
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The personas that take the builder slots of one level in round `roundId`, in slot order. */
export function slotsAtLevel(roundId: number, level: Level, candidates: readonly SlotCandidate[], slots: number): SlotCandidate[] {
  if (slots <= 0) return [];
  const byOwner = new Map<string, SlotCandidate[]>();
  for (const c of candidates) {
    if (!c.levels.includes(level)) continue;
    const list = byOwner.get(c.owner) ?? [];
    if (!list.some((x) => x.id === c.id)) list.push(c);
    byOwner.set(c.owner, list);
  }
  const owners = [...byOwner.keys()].sort(byText);
  const n = owners.length;
  if (n === 0) return [];
  const start = mod(roundId, n);
  const order = owners.map((_, i) => owners[(start + i) % n]);
  const rot = new Map(order.map((o) => {
    const ps = byOwner.get(o)!.sort((a, b) => byText(a.id, b.id));
    return [o, ps.map((_, k) => ps[mod(roundId + k, ps.length)])] as const;
  }));
  const out: SlotCandidate[] = [];
  for (let pass = 0; out.length < slots; pass++) {
    let took = false;
    for (const o of order) {
      const ps = rot.get(o)!;
      if (pass < ps.length) {
        out.push(ps[pass]);
        took = true;
        if (out.length >= slots) break;
      }
    }
    if (!took) break;
  }
  return out;
}

/** Every level of round `roundId`. */
export function slotsOfRound(roundId: number, candidates: readonly SlotCandidate[], slots: number): SlotPicks {
  return { 1: slotsAtLevel(roundId, 1, candidates, slots), 2: slotsAtLevel(roundId, 2, candidates, slots), 3: slotsAtLevel(roundId, 3, candidates, slots) };
}

/** The levels each persona plays in a round: persona id -> levels, ascending. */
export function levelsByPersona(picks: SlotPicks): Map<string, Level[]> {
  const out = new Map<string, Level[]>();
  for (const level of LEVELS) for (const c of picks[level]) out.set(c.id, [...(out.get(c.id) ?? []), level]);
  return out;
}

/** One log line: which personas took which slots. */
export function describeSlots(roundId: number, picks: SlotPicks, slots: number): string {
  const lv = (l: Level) => `L${l} ${picks[l].length ? picks[l].map((c) => `${c.owner}/${c.id}`).join(', ') : 'none'}`;
  return `round ${roundId} builder slots (${slots} a level): ${LEVELS.map(lv).join('; ')}`;
}

/**
 * A botmaster's next `count` rounds from `fromRoundId` on in which it has at least one slot, with the levels it
 * plays, as of the candidates now (approvals, disables and revocations change it). Looks `horizon` rounds ahead.
 */
export function nextRoundsOf(
  owner: string,
  fromRoundId: number,
  candidates: readonly SlotCandidate[],
  slots: number,
  count = 3,
  horizon = 2000,
): { roundId: number; levels: Level[] }[] {
  const out: { roundId: number; levels: Level[] }[] = [];
  if (slots <= 0 || !candidates.some((c) => c.owner === owner)) return out;
  for (let roundId = Math.max(1, fromRoundId); roundId < fromRoundId + horizon && out.length < count; roundId++) {
    const levels = LEVELS.filter((l) => slotsAtLevel(roundId, l, candidates, slots).some((c) => c.owner === owner));
    if (levels.length) out.push({ roundId, levels });
  }
  return out;
}
