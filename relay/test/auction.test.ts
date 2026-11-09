// GET /api/auction's source (protocol v1.10): meme.cooking's meme, read through a 15 s cache, the meme id from the
// launch's token page, the last view when meme.cooking does not answer, and nothing without a meme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AuctionView, memeIdOf } from '../src/auction.js';

const MEME = {
  meme: {
    meme_id: 2313, start_timestamp_ms: 1794236400000, end_timestamp_ms: 1794322800000, deposit_token_id: 'wrap.near',
    soft_cap: '100000000000000000000000000', hard_cap: '500000000000000000000000000', total_deposit: '37500000000000000000000000', is_finalized: false,
  },
};

test('the auction view: meme id, cache, fallback, off', async () => {
  assert.equal(memeIdOf('https://meme.cooking/meme/2313'), 2313);
  assert.equal(memeIdOf('https://example.com/meme/2313'), null);
  assert.equal(memeIdOf(undefined), null);
  let calls = 0;
  let fail = false;
  const fakeFetch = (async (url: string) => {
    calls++;
    assert.equal(url, 'https://api.meme.cooking/meme/2313');
    if (fail) throw new Error('down');
    return new Response(JSON.stringify(MEME), { status: 200 });
  }) as unknown as typeof fetch;
  const v = new AuctionView(() => 2313, fakeFetch);
  const a = await v.get(1000);
  assert.deepEqual(a, { memeId: 2313, totalDeposit: '37500000000000000000000000', softCap: '100000000000000000000000000', hardCap: '500000000000000000000000000', startMs: 1794236400000, endMs: 1794322800000, finalized: false });
  await v.get(Date.now());
  assert.equal(calls, 1, 'cached for 15 s');
  fail = true;
  const b = await v.get(Date.now() + 20_000);
  assert.equal(calls, 2, 'asked again after 15 s');
  assert.equal(b.totalDeposit, a.totalDeposit, 'meme.cooking down: the last view');
  await assert.rejects(new AuctionView(() => null, fakeFetch).get(), (e: any) => e.code === 'auction_off' && e.status === 404);
  await assert.rejects(new AuctionView(() => 2313, fakeFetch).get(), (e: any) => e.code === 'auction_unavailable' && e.status === 502, 'down and nothing cached');
});
