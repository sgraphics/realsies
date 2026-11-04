// The mock chain replays the contract's own full_round_settles_exactly test with the lead's signed
// vectors and must land on the same balances, so mock and contract agree on the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockChain } from '../src/chain/mock.js';
import type { Opening } from '../src/chain/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(fs.readFileSync(path.resolve(here, '../../contracts/game/tests/vectors.json'), 'utf8'));
const COIN = 10n ** 18n;
const c = (x: number) => (BigInt(Math.round(x * 1e6)) * COIN) / 1_000_000n;

function setup() {
  const chain = new MockChain({ accounts: { fund: 'fund.testnet', house: 'house.testnet', operator: 'ops.testnet' } });
  chain.txLatencyMs = 0;
  let t = 1_793_800_000_000;
  chain.now = () => t;
  const at = (ms: number) => (t = 1_793_800_000_000 + ms);
  return { chain, at };
}

const botOpening = (proofs: unknown[]): Opening => ({
  character_id: V.bot.character_id, kind: 'bot', salt: V.bot.salt, payout: V.bot.payout,
  model: V.bot.model, prompt_hash: V.bot.prompt_hash, signers: V.bot.signers, proofs: proofs as any,
});
const humanOpening = (viewers: string[]): Opening => ({
  character_id: V.human.character_id, kind: 'human', salt: V.human.salt, payout: V.human.payout, account: V.human.account, viewers,
});

test('full round settles exactly like the contract test', async () => {
  const { chain, at } = setup();
  for (const who of ['alice.testnet', 'bob.testnet', 'carol.testnet', 'erin.testnet']) assert.ok((await chain.faucetDeposit(who, 100n * COIN)).ok);
  at(1000);
  assert.ok((await chain.startRound(1, V.secret_hash, 1_793_800_000_000 + 600_000)).ok);
  at(2000);
  assert.ok((await chain.commitCharacters(1, [
    { character_id: V.bot.character_id, commitment: V.bot.commitment },
    { character_id: V.human.character_id, commitment: V.human.commitment },
  ])).ok);
  at(10_000);
  assert.ok((await chain.play('alice.testnet', 1, V.handles.alice_bot, 10)).ok);
  assert.ok((await chain.play('bob.testnet', 1, V.handles.bob_bot, 20)).ok);
  assert.ok((await chain.play('carol.testnet', 1, V.handles.carol_bot, 10)).ok);
  assert.ok((await chain.play('carol.testnet', 1, V.handles.carol_human, 10)).ok);
  assert.ok((await chain.play('erin.testnet', 1, V.handles.erin_human, 30)).ok);
  at(130_000);
  assert.ok((await chain.call('alice.testnet', 1, V.handles.alice_bot, true)).ok);
  assert.ok((await chain.call('bob.testnet', 1, V.handles.bob_bot, false)).ok);
  assert.ok((await chain.call('carol.testnet', 1, V.handles.carol_bot, false)).ok);
  assert.ok((await chain.call('carol.testnet', 1, V.handles.carol_human, true)).ok);
  assert.equal(await chain.balanceOf('fund.testnet'), 4n * COIN);

  at(140_000);
  assert.ok((await chain.endRoundNow(1)).ok);
  at(141_000);
  assert.ok((await chain.revealRound(1, V.secret)).ok);
  const reused = { ...V.bot.proofs['alice.testnet'], viewer: 'bob.testnet' };
  at(142_000);
  const open = await chain.openCharacters(1, [
    botOpening([V.bot.proofs['alice.testnet'], reused, V.bot.proofs['bob.testnet']]),
    humanOpening(['carol.testnet', 'erin.testnet']),
  ]);
  assert.ok(open.ok, open.error ?? '');
  assert.equal(open.reports![0].ok, true);
  assert.equal(open.reports![0].assigned, 2);
  assert.equal(open.reports![0].rejected.length, 1);
  assert.match(open.reports![0].rejected[0], /tag/);
  assert.equal(open.reports![1].assigned, 2);
  at(143_000);
  assert.ok((await chain.settleRound(1)).ok);

  const bal = (a: string) => chain.balanceOf(a);
  assert.equal(await bal('alice.testnet'), c(90));
  assert.equal(await bal('bob.testnet'), c(105.65));
  assert.equal(await bal('carol.testnet'), c(118.95));
  assert.equal(await bal('erin.testnet'), c(70));
  assert.equal(await bal('bots.testnet'), c(1.9));
  assert.equal(await bal('dave.testnet'), c(5.7));
  assert.equal(await bal('house.testnet'), c(3.8));
  assert.equal(await bal('fund.testnet'), c(4));
  const carol = await chain.getPlay(1, V.handles.carol_bot);
  assert.equal(carol!.characterId, null);
  assert.equal(carol!.credited, c(9.5), 'refunded');
});

test('guards: no reveal while calls are open, no foreign calls, no late plays', async () => {
  const { chain, at } = setup();
  await chain.faucetDeposit('alice.testnet', 100n * COIN);
  at(1000);
  await chain.startRound(1, V.secret_hash, 1_793_800_000_000 + 600_000);
  await chain.commitCharacters(1, [{ character_id: V.bot.character_id, commitment: V.bot.commitment }]);
  at(5000);
  assert.ok((await chain.play('alice.testnet', 1, V.handles.alice_bot, 10)).ok);
  const foreign = await chain.call('bob.testnet', 1, V.handles.alice_bot, false);
  assert.equal(foreign.ok, false);
  assert.match(foreign.error!, /not your play/);
  const early = await chain.revealRound(1, V.secret);
  assert.equal(early.ok, false);
  assert.match(early.error!, /calls are still open/);
  const tooMuch = await chain.play('alice.testnet', 1, V.handles.alice_human ?? 'ab'.repeat(32), 101);
  assert.equal(tooMuch.ok, false);
  at(700_000);
  const late = await chain.play('alice.testnet', 1, V.handles.bob_bot, 10);
  assert.equal(late.ok, false);
  assert.match(late.error!, /closed for plays/);
});

test('a bad commitment is reported, not opened; snapshot round-trips', async () => {
  const { chain, at } = setup();
  at(1000);
  await chain.startRound(1, V.secret_hash, 1_793_800_000_000 + 600_000);
  await chain.commitCharacters(1, [{ character_id: V.bot.character_id, commitment: V.bot.commitment }]);
  await chain.endRoundNow(1);
  at(2000);
  assert.ok((await chain.revealRound(1, V.secret)).ok);
  const bad = await chain.openCharacters(1, [{ ...botOpening([]), salt: '00'.repeat(32) }]);
  assert.equal(bad.reports![0].ok, false);
  assert.equal(bad.reports![0].rejected[0], 'commitment mismatch');
  const copy = new MockChain({ accounts: { fund: 'fund.testnet', house: 'house.testnet' } });
  copy.restore(chain.snapshot());
  assert.deepEqual(await copy.getRound(1), await chain.getRound(1));
});

test('prune_round: like the contract, settled rounds only, plays then characters, until 0', async () => {
  const { chain, at } = setup();
  await chain.faucetDeposit('carol.testnet', 100n * COIN);
  at(1000);
  await chain.startRound(1, V.secret_hash, 1_793_800_000_000 + 600_000);
  at(2000);
  await chain.commitCharacters(1, [
    { character_id: V.bot.character_id, commitment: V.bot.commitment },
    { character_id: V.human.character_id, commitment: V.human.commitment },
  ]);
  at(10_000);
  assert.ok((await chain.play('carol.testnet', 1, V.handles.carol_human, 10)).ok);
  assert.ok((await chain.call('carol.testnet', 1, V.handles.carol_human, true)).ok);
  assert.equal((await chain.pruneRound(2)).error, 'no such round');
  assert.equal((await chain.pruneRound(1)).error, 'round is not settled', 'an open round cannot be pruned');
  at(140_000);
  await chain.endRoundNow(1);
  at(141_000);
  await chain.revealRound(1, V.secret);
  assert.equal((await chain.pruneRound(1)).error, 'round is not settled', 'a revealed round cannot be pruned');
  await chain.openCharacters(1, [humanOpening(['carol.testnet'])]);
  assert.ok((await chain.settleRound(1)).ok);
  const before = await chain.balanceOf('carol.testnet');
  assert.deepEqual([(await chain.getRound(1))?.plays, (await chain.getRound(1))?.characters], [1, 2]);
  // one play and two characters, one entry at a time (limit 0 clamps to 1, as in the contract)
  assert.equal((await chain.pruneRound(1, 1)).remaining, 2);
  assert.equal(await chain.getPlay(1, V.handles.carol_human), null, 'plays go first');
  assert.ok(await chain.getCharacter(1, V.bot.character_id), 'characters still there');
  assert.equal((await chain.pruneRound(1, 0)).remaining, 1);
  assert.equal((await chain.pruneRound(1)).remaining, 0);
  assert.equal((await chain.pruneRound(1, 500)).remaining, 0, 'pruning an empty round is a no-op');
  assert.deepEqual(await chain.getRoundPlays(1), []);
  assert.equal(await chain.getCharacter(1, V.human.character_id), null);
  const r = await chain.getRound(1);
  assert.ok(r?.settled, 'the round record stays, settled');
  assert.deepEqual([r?.plays, r?.characters], [0, 0]);
  assert.equal(await chain.balanceOf('carol.testnet'), before, 'balances are untouched');
  // survives a snapshot
  const copy = new MockChain();
  copy.restore(chain.snapshot());
  assert.deepEqual([(await copy.getRound(1))?.plays, (await copy.getRound(1))?.characters], [0, 0]);
});
