// Builder slots (src/agents/schedule.ts): at most N AI builders' personas a level a round, round-robin over
// botmasters by round id, one persona per botmaster before a second, personas rotating within a botmaster,
// deterministic, everyone playing when there are fewer candidates than slots.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Level } from '../../shared/protocol.js';
import { describeSlots, levelsByPersona, nextRoundsOf, slotsAtLevel, slotsOfRound, type SlotCandidate } from '../src/agents/schedule.js';

const c = (owner: string, id: string, levels: Level[]): SlotCandidate => ({ id: `${owner}-${id}`, owner, levels });
// level 1: acme (two personas), bolt, cove, echo; level 2: acme, dune; level 3: cove
const CANDS = [c('echo', 'e1', [1]), c('acme', 'p1', [1, 2]), c('bolt', 'b1', [1]), c('cove', 'c1', [1, 3]), c('dune', 'd1', [2]), c('acme', 'p2', [1])];

test('round-robin over botmasters: start at roundId mod n, deterministic, never over the slots, everyone gets turns', () => {
  const owners = (r: number, l: Level, slots = 2) => slotsAtLevel(r, l, CANDS, slots).map((x) => x.owner);
  // level 1 has four botmasters by name [acme, bolt, cove, echo]: round 5 starts at 5 mod 4 = 1
  assert.deepEqual(owners(5, 1), ['bolt', 'cove']);
  assert.deepEqual(owners(6, 1), ['cove', 'echo']);
  assert.deepEqual(owners(7, 1), ['echo', 'acme'], 'wraps around');
  assert.deepEqual(owners(8, 1), ['acme', 'bolt']);
  for (let r = 1; r <= 400; r++) {
    const picks = slotsOfRound(r, CANDS, 2);
    assert.deepEqual(slotsOfRound(r, [...CANDS].reverse(), 2), picks, `round ${r}: the same whatever the input order`);
    for (const l of [1, 2, 3] as Level[]) {
      assert.ok(picks[l].length <= 2, `round ${r} L${l}: at most the slots`);
      assert.equal(new Set(picks[l].map((x) => x.owner)).size, picks[l].length, `round ${r} L${l}: one persona per botmaster first`);
      for (const p of picks[l]) assert.ok(p.levels.includes(l), `${p.id} only at its own levels`);
    }
  }
  // fair: over any 4 rounds each of the 4 botmasters at level 1 plays exactly 2 times
  for (let r = 1; r <= 100; r++) {
    const turns = new Map<string, number>();
    for (let k = 0; k < 4; k++) for (const o of owners(r + k, 1)) turns.set(o, (turns.get(o) ?? 0) + 1);
    assert.deepEqual([...turns.entries()].sort(), [['acme', 2], ['bolt', 2], ['cove', 2], ['echo', 2]], `rounds ${r} to ${r + 3}`);
  }
  // level 2 has two botmasters and level 3 one, with two slots: they play every round
  for (let r = 1; r <= 20; r++) {
    assert.deepEqual(owners(r, 2).sort(), ['acme', 'dune']);
    assert.deepEqual(owners(r, 3), ['cove']);
  }
});

test("within a botmaster its personas rotate by round id; a second persona only after everyone's first", () => {
  // acme's two level-1 personas alternate with the round id whenever acme plays there
  const acmeAt = (r: number) => slotsAtLevel(r, 1, CANDS, 2).find((x) => x.owner === 'acme')?.id;
  assert.deepEqual([4, 7, 8, 11, 12].map(acmeAt), ['acme-p1', 'acme-p2', 'acme-p1', 'acme-p2', 'acme-p1']);
  // two botmasters, three slots: acme's second persona joins only after bolt's first
  const two = [c('acme', 'p1', [1]), c('acme', 'p2', [1]), c('acme', 'p3', [1]), c('bolt', 'b1', [1])];
  assert.deepEqual(slotsAtLevel(0, 1, two, 3).map((x) => x.id), ['acme-p1', 'bolt-b1', 'acme-p2']);
  assert.deepEqual(slotsAtLevel(1, 1, two, 3).map((x) => x.id), ['bolt-b1', 'acme-p2', 'acme-p3']);
  assert.deepEqual(slotsAtLevel(2, 1, two, 3).map((x) => x.id), ['acme-p3', 'bolt-b1', 'acme-p1']);
});

test('fewer candidates than slots: all of them play every round; no slots: nobody', () => {
  const few = [c('acme', 'p1', [1, 2]), c('bolt', 'b1', [1])];
  for (let r = 1; r <= 10; r++) {
    const picks = slotsOfRound(r, few, 3);
    assert.deepEqual(picks[1].map((x) => x.id).sort(), ['acme-p1', 'bolt-b1']);
    assert.deepEqual(picks[2].map((x) => x.id), ['acme-p1']);
    assert.deepEqual(picks[3], []);
    assert.deepEqual([...levelsByPersona(picks).entries()].sort(), [['acme-p1', [1, 2]], ['bolt-b1', [1]]]);
  }
  assert.deepEqual(slotsOfRound(3, few, 0), { 1: [], 2: [], 3: [] });
  assert.deepEqual(slotsOfRound(3, [], 3), { 1: [], 2: [], 3: [] });
});

test("a botmaster's next rounds with a slot, as GET /api/botmaster/me shows them; the log line", () => {
  // one slot at level 1 over [acme, bolt, cove, echo]: bolt plays when roundId mod 4 is 1
  const bolt = nextRoundsOf('bolt', 10, CANDS, 1);
  assert.deepEqual(bolt, [{ roundId: 13, levels: [1] }, { roundId: 17, levels: [1] }, { roundId: 21, levels: [1] }]);
  for (const x of bolt) assert.equal(slotsAtLevel(x.roundId, 1, CANDS, 1)[0].owner, 'bolt');
  // dune is one of two at level 2: every other round
  assert.deepEqual(nextRoundsOf('dune', 10, CANDS, 1).map((x) => x.roundId), [11, 13, 15]);
  assert.deepEqual(nextRoundsOf('nobody', 10, CANDS, 3), []);
  assert.deepEqual(nextRoundsOf('bolt', 10, CANDS, 0), []);
  assert.equal(
    describeSlots(5, slotsOfRound(5, CANDS, 2), 2),
    'round 5 builder slots (2 a level): L1 bolt/bolt-b1, cove/cove-c1; L2 dune/dune-d1, acme/acme-p1; L3 cove/cove-c1',
  );
});
