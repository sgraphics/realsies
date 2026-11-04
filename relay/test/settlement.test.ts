// Settlement math (spec section 3) and the rating rules (section 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { settleCharacter, splitPlay } from '../src/settlement.js';
import { applyRating, pRight, ratingDelta, wouldHaveCoins, applyOutcome } from '../src/scoring.js';
import { coinsToUnits, unitsToCoins } from '../src/util.js';

const C = 10n ** 18n;
const coins = (x: number) => coinsToUnits(x, C);

test('a play pays 5% to the fund and locks the rest', () => {
  assert.deepEqual(splitPlay(10n * C), { fee: C / 2n, locked: 95n * C / 10n });
  assert.deepEqual(splitPlay(5n * C), { fee: C / 4n, locked: 475n * C / 100n });
});

test('no wrong coins: everyone gets their locked coins back', () => {
  const s = settleCharacter('human', [
    { key: 'a', account: 'a', locked: coins(9.5), call: true },
    { key: 'b', account: 'b', locked: coins(4.75), call: true },
  ]);
  assert.equal(s.credits.get('a'), coins(9.5));
  assert.equal(s.credits.get('b'), coins(4.75));
  assert.equal(s.payoutCredit, 0n);
  assert.equal(s.houseCredit, 0n);
});

test('wrong and right: 70% pro rata to right, 20% to the character, house the rest', () => {
  // the contract's full_round_settles_exactly bot character: alice wrong 9.5, bob right 19
  const s = settleCharacter('bot', [
    { key: 'alice', account: 'alice', locked: coins(9.5), call: true },
    { key: 'bob', account: 'bob', locked: coins(19), call: false },
  ]);
  assert.equal(s.wrongCoins, coins(9.5));
  assert.equal(s.rightCoins, coins(19));
  assert.equal(s.credits.get('alice'), 0n);
  assert.equal(s.credits.get('bob'), coins(19) + coins(6.65));
  assert.equal(s.payoutCredit, coins(1.9));
  assert.equal(s.houseCredit, coins(0.95));
});

test('a missing call counts as wrong; R = 0 pays the character 90%', () => {
  const s = settleCharacter('bot', [
    { key: 'x', account: 'x', locked: coins(9.5), call: true },
    { key: 'y', account: 'y', locked: coins(9.5), call: null },
  ]);
  assert.equal(s.rightCoins, 0n);
  assert.equal(s.payoutCredit, (coins(19) * 9n) / 10n);
  assert.equal(s.houseCredit, coins(19) - (coins(19) * 9n) / 10n);
  assert.equal(s.credits.get('x'), 0n);
  assert.equal(s.credits.get('y'), 0n);
});

test('rounding follows the contract: floor(floor(W * 0.7) * locked / R), dust to the house', () => {
  const plays = [
    { key: 'r1', account: 'r1', locked: 3n, call: false },
    { key: 'r2', account: 'r2', locked: 3n, call: false },
    { key: 'r3', account: 'r3', locked: 1n, call: false },
    { key: 'w', account: 'w', locked: 10n, call: true },
  ];
  const s = settleCharacter('bot', plays);
  // right_pot = floor(10 * 7000 / 10000) = 7; shares floor(7*3/7)=3, 3, floor(7*1/7)=1
  assert.equal(s.credits.get('r1'), 6n);
  assert.equal(s.credits.get('r2'), 6n);
  assert.equal(s.credits.get('r3'), 2n);
  assert.equal(s.payoutCredit, 2n);
  assert.equal(s.houseCredit, 10n - 7n - 2n);
  const total = [...s.credits.values()].reduce((a, b) => a + b, 0n) + s.payoutCredit + s.houseCredit;
  assert.equal(total, 17n, 'no units created or lost');
});

test('rating: surprise-weighted against the paid room', () => {
  assert.equal(pRight([]), 0.5);
  assert.equal(pRight([{ coins: 10, right: true }, { coins: 30, right: false }]), 0.25);
  assert.equal(ratingDelta(true, 0.25), 24);
  assert.equal(ratingDelta(false, 0.25), -8);
  assert.equal(ratingDelta(true, 0.5), 16);
  assert.equal(ratingDelta(false, 0.5), -16);
  assert.equal(ratingDelta(true, 1), 0);
  assert.equal(applyRating(110, -16), 100, 'floor 100');
  assert.equal(applyRating(1000, 16), 1016);
});

test('streaks', () => {
  let s = { chats: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0 };
  s = applyOutcome(s, true);
  s = applyOutcome(s, true);
  s = applyOutcome(s, false);
  s = applyOutcome(s, true);
  assert.deepEqual(s, { chats: 0, right: 3, wrong: 1, streak: 1, bestStreak: 2 });
});

test('would have won: presetLow at the margin', () => {
  // W = 19, R = 0 at level 1 (presetLow 5): 5 * 0.7 * 19 / 5 = 13.3
  assert.ok(Math.abs(wouldHaveCoins(5, 19, 0, true) - 13.3) < 1e-9);
  assert.equal(wouldHaveCoins(5, 0, 10, true), 0);
  assert.equal(wouldHaveCoins(25, 10, 10, false), -25);
});

test('coin conversions are exact', () => {
  assert.equal(coinsToUnits(4.275, C), 4275000000000000000n);
  assert.equal(coinsToUnits('0.000000000000000001', C), 1n);
  assert.equal(unitsToCoins(105650000000000000000n, C), 105.65);
  assert.equal(unitsToCoins(-250000000000000000n, C), -0.25);
});
