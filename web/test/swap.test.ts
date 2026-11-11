// Coins for NEAR on Rhea (protocol v1.12) in the mock (?mock=1&swap=1), through the store, the mock relay and the mock
// wallet: the transactions a buy and a sale are made of; a buy in one approval (play key, registrations, the wrap
// transaction with the swap, the deposit) and the next one spending the wNEAR left over; a withdrawal as NEAR in one
// approval with the leftover wNEAR unwrapped; a price that moved past a buy or a sale; a wallet that sends a batch all
// at once (the coins wait in the wallet, offered on their own); a wallet that takes one transaction at a time, and one
// whose batch partly ran (never a second swap); a buy the wallet cannot cover; the coin's value in NEAR.
// Run by test/mock-flow.test.ts in its own process (npm test).

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
const storage = new MemStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const { MockGameClient, MOCK_SWAP } = await import('../src/net/mock.ts');
const { createStore, PRICE_MOVED_BUY, PRICE_MOVED_SELL } = await import('../src/state/store.ts');
const { MockWallet } = await import('../src/wallet/mock.ts');
const { WalletError } = await import('../src/wallet/types.ts');
const S = await import('../src/wallet/swap.ts');
const { coinValue, fmtNearNum, parseNear } = await import('../src/state/near.ts');
import type { PublicConfig } from '../../shared/protocol.ts';
import type { WalletApi, WalletTx } from '../src/wallet/types.ts';

let failures = 0;
let passes = 0;
function ok(cond: unknown, label: string): void {
  if (cond) {
    passes++;
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label);
  }
}

const NEAR = 10n ** 24n;
const UNIT = 10n ** 18n;
const ACCT = 'sam.testnet';
const methods = (t: WalletTx) => t.actions.map((a) => (a.type === 'AddKey' ? 'AddKey' : a.params.methodName)).join('+');

type MockOpts = ConstructorParameters<typeof MockGameClient>[0];
function setup(o: MockOpts = {}, w: ConstructorParameters<typeof MockWallet>[1] = {}) {
  const client = new MockGameClient({ wallet: true, swap: true, storageKey: null, timeScale: 0.02, noHuman: true, ...o });
  const wallet = new MockWallet(client, { accountId: ACCT, delayMs: 2, ...w });
  const store = createStore(client, wallet);
  return { client, wallet, store, done: () => { store.actions.logout(); client.dispose(); storage.clear(); } };
}

// ---------- 1. the transactions ----------
console.log('the transactions of a buy and a sale');
{
  const cfg = { contractId: 'game.realsies.testnet', tokenId: 'real.realsies.testnet', coinUnit: UNIT.toString(), swap: MOCK_SWAP } as PublicConfig;
  const fresh = { tokenRegistered: false, storageDeposit: 1_250_000_000_000_000_000_000n, wrapRegistered: false, wrapStorage: S.WRAP_STORAGE, wnear: 0n, near: 5n * NEAR };
  // v1.15: the quote's swapIn (0.248 NEAR of the 0.25 offered) goes in, at least 98 coins come out (Swap)
  const swapIn = 248n * 10n ** 21n;
  const txs = S.buyTxs(cfg, ACCT, { maxIn: NEAR / 4n, units: 98n * UNIT, swapIn }, fresh);
  ok(txs.map((t) => t.step).join() === 'coin_storage,buy,deposit', 'a first buy: the registration on the coin, the swap, the deposit');
  ok(txs[0].tx.receiverId === 'real.realsies.testnet' && methods(txs[0].tx) === 'storage_deposit', 'registered on the coin first: the bought coins arrive by ft_transfer');
  const w = txs[1].tx;
  ok(w.receiverId === 'wrap.testnet' && methods(w) === 'storage_deposit+near_deposit+ft_transfer_call', 'one transaction to the wrap contract: register, wrap, swap');
  const [reg, wrap, swap] = w.actions.map((a) => (a.type === 'FunctionCall' ? a.params : null))!;
  ok(reg!.deposit === S.WRAP_STORAGE.toString() && JSON.stringify(reg!.args) === JSON.stringify({ account_id: ACCT, registration_only: true }), 'the wrap registration: 0.00125 NEAR');
  ok(wrap!.deposit === swapIn.toString(), 'swapIn wrapped, not the whole 0.25 NEAR offered');
  const sargs = swap!.args as { receiver_id: string; amount: string; msg: string };
  ok(swap!.deposit === '1' && sargs.receiver_id === 'dclv2.ref-dev.testnet' && sargs.amount === swapIn.toString(), 'the swap: 1 yoctoNEAR, exactly swapIn to the pool contract');
  ok(
    sargs.msg === JSON.stringify({ Swap: { pool_ids: ['real.realsies.testnet|wrap.testnet|2000'], output_token: 'real.realsies.testnet', min_output_amount: (98n * UNIT).toString(), skip_unwrap_near: true } }),
    'Swap (exact input, the event the chart sites count): at least 98 coins',
  );
  const gas = w.actions.reduce((g, a) => g + (a.type === 'FunctionCall' ? BigInt(a.params.gas) : 0n), 0n);
  ok(gas <= 300n * 10n ** 12n && BigInt(swap!.gas) === 250n * 10n ** 12n, `the wrap transaction asks ${gas / 10n ** 12n} Tgas, under 300; the swap 250`);
  const dep = txs[2].tx;
  ok(dep.receiverId === 'real.realsies.testnet' && methods(dep) === 'ft_transfer_call' && JSON.stringify((dep.actions[0] as { params: { args: object } }).params.args) === JSON.stringify({ receiver_id: 'game.realsies.testnet', amount: (98n * UNIT).toString(), msg: '' }), 'the deposit: exactly the 98 whole coins into the game, as any deposit');
  const part = S.buyTxs(cfg, ACCT, { maxIn: NEAR / 4n, units: 98n * UNIT, swapIn }, { ...fresh, tokenRegistered: true, wrapRegistered: true, wnear: NEAR / 100n });
  ok(part.length === 2 && methods(part[0].tx) === 'near_deposit+ft_transfer_call' && (part[0].tx.actions[0] as { params: { deposit: string } }).params.deposit === (swapIn - NEAR / 100n).toString(), 'registered, 0.01 wNEAR held: only what the wNEAR lacks of swapIn is wrapped');
  const covered = S.buyTxs(cfg, ACCT, { maxIn: NEAR / 4n, units: 98n * UNIT, swapIn }, { ...fresh, tokenRegistered: true, wrapRegistered: true, wnear: swapIn });
  ok(methods(covered[0].tx) === 'ft_transfer_call', 'wNEAR covers swapIn: no wrap at all');
  ok(S.buyNearNeeded(NEAR / 4n, fresh) === NEAR / 4n + 1_250_000_000_000_000_000_000n * 2n + S.NEAR_RESERVE && S.NEAR_RESERVE === NEAR / 20n, 'what a buy takes: the registrations, the NEAR offered (at least swapIn) and 0.05 NEAR for gas');

  // an older relay (no swapIn): the exact-output buy as before
  const old = S.buyTxs(cfg, ACCT, { maxIn: NEAR / 4n, units: 98n * UNIT }, fresh);
  ok(old.map((t) => t.step).join() === 'coin_storage,buy,deposit' && methods(old[1].tx) === 'storage_deposit+near_deposit+ft_transfer_call', 'without swapIn: the same three transactions');
  const [, owrap, oswap] = old[1].tx.actions.map((a) => (a.type === 'FunctionCall' ? a.params : null))!;
  const oargs = oswap!.args as { receiver_id: string; amount: string; msg: string };
  ok(owrap!.deposit === (NEAR / 4n).toString() && oargs.amount === (NEAR / 4n).toString() && oargs.receiver_id === 'dclv2.ref-dev.testnet', 'without swapIn: the NEAR offered, wrapped, all of it to the pool contract');
  ok(
    oargs.msg === JSON.stringify({ SwapByOutput: { pool_ids: ['real.realsies.testnet|wrap.testnet|2000'], output_token: 'real.realsies.testnet', output_amount: (98n * UNIT).toString(), skip_unwrap_near: true } }),
    'without swapIn: SwapByOutput, exactly 98 coins',
  );
  const opart = S.buyTxs(cfg, ACCT, { maxIn: NEAR / 4n, units: 98n * UNIT }, { ...fresh, tokenRegistered: true, wrapRegistered: true, wnear: NEAR / 100n });
  ok((opart[0].tx.actions[0] as { params: { deposit: string } }).params.deposit === ((NEAR * 24n) / 100n).toString(), 'without swapIn: only what the wNEAR lacks of the NEAR offered is wrapped');

  const sell = S.sellTxs(cfg, ACCT, { units: 40n * UNIT, minOut: 99n * 10n ** 21n }, { tokenRegistered: false, storageDeposit: 1n, wnear: 5n * 10n ** 21n }, 'game');
  ok(sell.map((t) => t.step).join() === 'coin_storage,withdraw,sell,unwrap', 'a withdrawal as NEAR: the registration, the withdrawal, the sale, the leftover wNEAR unwrapped');
  const sa = (sell[2].tx.actions[0] as { params: { args: { receiver_id: string; amount: string; msg: string }; deposit: string } }).params;
  ok(sell[2].tx.receiverId === 'real.realsies.testnet' && sa.deposit === '1' && sa.args.receiver_id === 'dclv2.ref-dev.testnet' && sa.args.amount === (40n * UNIT).toString(), 'the sale: exactly the withdrawn coins to the pool contract');
  ok(sa.args.msg === JSON.stringify({ Swap: { pool_ids: ['real.realsies.testnet|wrap.testnet|2000'], output_token: 'wrap.testnet', min_output_amount: (99n * 10n ** 21n).toString(), skip_unwrap_near: false } }), 'Swap with its minimum, skip_unwrap_near false: plain NEAR arrives');
  ok(sell[3].tx.receiverId === 'wrap.testnet' && methods(sell[3].tx) === 'near_withdraw' && JSON.stringify((sell[3].tx.actions[0] as { params: { args: object } }).params.args) === JSON.stringify({ amount: (5n * 10n ** 21n).toString() }), 'near_withdraw of all the wNEAR');
  const fromWallet = S.sellTxs(cfg, ACCT, { units: 98n * UNIT, minOut: 1n }, { tokenRegistered: true, storageDeposit: 1n, wnear: 0n }, 'wallet');
  ok(fromWallet.map((t) => t.step).join() === 'sell', 'selling what the wallet holds: the sale alone');
  ok(coinValue({ nearPerCoin: 0.0025, usdPerCoin: 0.01 }, 45) === '0.11 NEAR' && coinValue({ usdPerCoin: 0.01 }, 45) === '$0.45' && coinValue({ nearPerCoin: 0.0025, usdPerCoin: 0.01 }, -5) === '0.013 NEAR', 'coins are worth NEAR at the current price, dollars without it');
  ok(fmtNearNum(1234.5) === '1,235' && fmtNearNum(12.345) === '12.35' && fmtNearNum(0.0025) === '0.0025' && fmtNearNum(0) === '0', 'NEAR amounts read short');
}

// ---------- 2. a buy, the next buy, a withdrawal as NEAR ----------
console.log('a buy and a withdrawal, one approval each');
{
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    ok(store.get().config?.swap?.dex === 'dclv2.ref-dev.testnet' && store.get().config?.nearPerCoin === 0.0025, 'the config has swap and the price');
    await store.actions.walletSignIn();
    const q = await store.actions.swapQuote({ side: 'buy', near: (NEAR / 4n).toString() });
    ok(q.coins === 98 && BigInt(q.cost!) <= (NEAR * 99n) / 400n, `0.25 NEAR: ${q.coins} coins for ${Number(BigInt(q.cost!) / 10n ** 18n) / 1e6} NEAR`);
    const swapIn = BigInt(q.swapIn ?? '0');
    ok(swapIn === (BigInt(q.cost!) * 10_000n + 9_899n) / 9_900n && swapIn < NEAR / 4n, `v1.15: the swap sends ${Number(swapIn / 10n ** 18n) / 1e6} NEAR, the cost plus 1%, under the 0.25 offered`);
    const byCoins = await store.actions.swapQuote({ side: 'buy', coins: 25 });
    ok(byCoins.coins! >= 25 && BigInt(byCoins.amountIn) % 10n ** 21n === 0n && BigInt(byCoins.swapIn!) <= BigInt(byCoins.amountIn), `25 coins: ${Number(BigInt(byCoins.amountIn) / 10n ** 21n) / 1000} NEAR buys ${byCoins.coins}, the swap sends ${Number(BigInt(byCoins.swapIn!) / 10n ** 18n) / 1e6}`);
    const a0 = client.swapAccountOf(ACCT);
    ok(await store.actions.swapBuy(NEAR / 4n), 'the buy');
    const f = store.get().walletTx;
    ok(f.phase === 'done' && f.kind === 'buy' && f.coins === 98 && !f.left && !!f.tx, 'done: 98 coins, with the transaction (not "in your wallet": the little more stays there quietly)');
    ok(wallet.calls.filter((c) => c === 'tx').length === 1, 'one wallet approval');
    ok(JSON.stringify(wallet.sent[0]) === JSON.stringify(['AddKey', 'storage_deposit', 'storage_deposit+near_deposit+ft_transfer_call', 'ft_transfer_call']), `in order: the play key, the coin registration, the wrap transaction, the deposit (${wallet.sent[0].join(', ')})`);
    const dust = client.walletCoinsOf(ACCT);
    ok(store.get().me?.balanceCoins === 98 && dust > 0 && dust < 98 * 0.0102, `exactly 98 coins in the game; the little more the swap gave stays in the wallet (${dust}, about 1% of them)`);
    ok(store.actions.coinsEnabled(), 'the play key came along');
    const a1 = client.swapAccountOf(ACCT);
    ok(a1.wrap && a1.wnear === 0n, 'no wNEAR left: the swap spent all it was sent');
    ok(a0.near - a1.near === swapIn + 2n * 1_250_000_000_000_000_000_000n, 'the wallet paid swapIn and two registrations; the rest of the 0.25 NEAR never left it');

    // the next buy registers nothing; the coins in the wallet before it (the little left over) stay out of its count
    const q2 = await store.actions.swapQuote({ side: 'buy', near: (NEAR / 4n).toString() });
    ok(await store.actions.swapBuy(NEAR / 4n), 'a second buy');
    ok(JSON.stringify(wallet.sent[1]) === JSON.stringify(['near_deposit+ft_transfer_call', 'ft_transfer_call']), 'no key, no registrations: the wrap transaction and the deposit');
    ok(client.swapAccountOf(ACCT).near === a1.near - BigInt(q2.swapIn!), 'only swapIn was wrapped');
    ok(store.get().me?.balanceCoins === 196 && !store.get().walletTx.left, '196 coins in the game');
    ok(Math.abs(client.walletCoinsOf(ACCT) - 2 * dust) < 0.001, `the little more of both buys in the wallet (${client.walletCoinsOf(ACCT)})`);

    // withdraw 40 as NEAR: the withdrawal and the sale, one approval; no wNEAR to unwrap
    const sq = await store.actions.swapQuote({ side: 'sell', units: (40n * UNIT).toString() });
    const b = client.swapAccountOf(ACCT);
    const wb = client.walletCoinsOf(ACCT);
    ok(await store.actions.swapSell(40), 'the withdrawal as NEAR');
    const g = store.get().walletTx;
    ok(g.phase === 'done' && g.kind === 'sell' && g.coins === 40 && g.near === sq.amountOut && !g.left, 'done: 40 coins as about the quoted NEAR');
    ok(JSON.stringify(wallet.sent[2]) === JSON.stringify(['withdraw', 'ft_transfer_call']), 'one approval: withdraw, sale');
    const c = client.swapAccountOf(ACCT);
    ok(c.wnear === 0n && c.near === b.near + BigInt(sq.amountOut), 'the NEAR came back');
    ok(store.get().me?.balanceCoins === 156 && client.walletCoinsOf(ACCT) === wb, '156 coins left in the game; the wallet as it was');
  } finally {
    done();
  }
}
{
  // an older relay (quotes without swapIn): the exact-output buy as before, its unused NEAR as wNEAR, unwrapped with
  // the next withdrawal
  const { client, wallet, store, done } = setup({ swapByOutput: true });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    const q = await store.actions.swapQuote({ side: 'buy', near: (NEAR / 4n).toString() });
    ok(q.coins === 98 && !('swapIn' in q), 'an older relay: no swapIn in the quote');
    const a0 = client.swapAccountOf(ACCT);
    ok(await store.actions.swapBuy(NEAR / 4n), 'the buy');
    ok(JSON.stringify(wallet.sent[0]) === JSON.stringify(['AddKey', 'storage_deposit', 'storage_deposit+near_deposit+ft_transfer_call', 'ft_transfer_call']), 'the same approval');
    ok(store.get().me?.balanceCoins === 98 && client.walletCoinsOf(ACCT) === 0 && !store.get().walletTx.left, 'exactly 98 coins, all in the game, none in the wallet');
    const a1 = client.swapAccountOf(ACCT);
    const leftover = a1.wnear;
    ok(leftover > 0n && leftover < NEAR / 100n && a0.near - a1.near === NEAR / 4n + 2n * 1_250_000_000_000_000_000_000n, `all the NEAR offered wrapped, the unused part waits as wNEAR (${Number(leftover / 10n ** 18n) / 1e6})`);
    ok(await store.actions.swapBuy(NEAR / 4n) && client.swapAccountOf(ACCT).near === a1.near - (NEAR / 4n - leftover), 'the next buy spends the wNEAR first');
    const b = client.swapAccountOf(ACCT);
    const sq = await store.actions.swapQuote({ side: 'sell', units: (40n * UNIT).toString() });
    ok(await store.actions.swapSell(40), 'the withdrawal as NEAR');
    ok(JSON.stringify(wallet.sent[2]) === JSON.stringify(['withdraw', 'ft_transfer_call', 'near_withdraw']), 'one approval: withdraw, sale, unwrap');
    const c = client.swapAccountOf(ACCT);
    ok(c.wnear === 0n && c.near === b.near + BigInt(sq.amountOut) + b.wnear && store.get().me?.balanceCoins === 156, 'the NEAR came back, the leftover wNEAR with it');
  } finally {
    done();
  }
}

// ---------- 3. the price moved ----------
console.log('a price that moved past the swap');
{
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    client.priceMoves = true;
    const q = await store.actions.swapQuote({ side: 'buy', near: (NEAR / 2n).toString() });
    ok(!(await store.actions.swapBuy(NEAR / 2n)), 'the buy did not go through');
    const f = store.get().walletTx;
    ok(f.phase === 'error' && f.error === PRICE_MOVED_BUY, `said plainly: "${f.error}"`);
    const a = client.swapAccountOf(ACCT);
    ok(a.wnear === BigInt(q.swapIn!) && (store.get().me?.balanceCoins ?? 0) === 0 && client.walletCoinsOf(ACCT) === 0, 'nothing bought; the NEAR the swap was sent waits as wNEAR');
    client.priceMoves = false;
    ok(await store.actions.swapBuy(NEAR / 4n), 'the next try');
    ok(wallet.sent[wallet.sent.length - 1].join() === 'ft_transfer_call,ft_transfer_call', 'spends that wNEAR: no new wrap');
    ok(store.get().me?.balanceCoins === 98, 'and buys');
    const dust = client.walletCoinsOf(ACCT);
    client.priceMoves = true;
    ok(await store.actions.swapSell(10), 'a withdrawal whose sale the price moved past');
    const g = store.get().walletTx;
    ok(g.phase === 'done' && g.left === true && Math.abs(client.walletCoinsOf(ACCT) - dust - 10) < 1e-6, 'withdrawn but not sold: the 10 coins wait in the wallet, offered on their own');
    ok(client.swapAccountOf(ACCT).wnear === 0n && wallet.sent[wallet.sent.length - 1].join() === 'withdraw,ft_transfer_call,near_withdraw', 'the wNEAR left from the buys went back to NEAR in the same approval');
    ok(!(await store.actions.swapSell(0, 'wallet')) && store.get().walletTx.error === PRICE_MOVED_SELL, 'and selling them while the price still moves says so');
    client.priceMoves = false;
    ok(await store.actions.swapSell(0, 'wallet'), 'Swap to NEAR from the wallet');
    ok(client.walletCoinsOf(ACCT) === 0 && wallet.sent[wallet.sent.length - 1].join() === 'ft_transfer_call', 'sold from the wallet: the sale alone');
  } finally {
    done();
  }
}

// ---------- 4. wallets that do not send one batch in order ----------
console.log('a wallet that sends the batch at once, one that sends one at a time, one whose batch partly ran');
{
  const { client, wallet, store, done } = setup({}, { noWait: true });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    ok(await store.actions.swapBuy(NEAR / 4n), 'the buy');
    const f = store.get().walletTx;
    ok(f.phase === 'done' && f.left === true && f.coins === 98, 'the deposit ran before the swap had finished: done, the coins wait in the wallet');
    const held = client.walletCoinsOf(ACCT);
    ok(held >= 98 && held < 99 && (store.get().me?.balanceCoins ?? 0) === 0, `98 coins and the little more in the wallet (${held}), none in the game`);
    ok(await store.actions.walletDeposit(98), 'Put in the game: the existing deposit');
    ok(store.get().me?.balanceCoins === 98 && Math.abs(client.walletCoinsOf(ACCT) - (held - 98)) < 1e-6, 'now they are in the game; the fraction stays in the wallet');
    ok(await store.actions.swapSell(30), 'a withdrawal as NEAR');
    ok(store.get().walletTx.left === true && Math.abs(client.walletCoinsOf(ACCT) - (held - 98) - 30) < 1e-6, 'the sale ran before the withdrawal: the coins wait in the wallet');
    wallet.o.noWait = false;
    ok(await store.actions.swapSell(0, 'wallet') && client.walletCoinsOf(ACCT) === 0, 'Swap to NEAR sells them');
  } finally {
    done();
  }
}
{
  const { client, wallet, store, done } = setup({}, { noBatch: true });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    ok(await store.actions.swapBuy(NEAR / 4n), 'one transaction per approval: the buy');
    const sends = wallet.sent.slice(1).map((x) => x.join());
    ok(JSON.stringify(sends) === JSON.stringify(['storage_deposit', 'storage_deposit+near_deposit+ft_transfer_call', 'ft_transfer_call', 'AddKey']), `each step once, the play key last (${sends.join(' | ')})`);
    ok(store.get().me?.balanceCoins === 98 && client.walletCoinsOf(ACCT) < 1 && !store.get().walletTx.left, 'bought and deposited: the deposit counted as landed with the fraction left in the wallet');
  } finally {
    done();
  }
}
{
  // the wallet ran the first transactions of the batch, then gave up on the rest: the rest goes one at a time, and
  // what landed is not sent again
  const client = new MockGameClient({ wallet: true, swap: true, storageKey: null, timeScale: 0.02, noHuman: true });
  const inner = new MockWallet(client, { accountId: ACCT, delayMs: 2 });
  const sent: string[] = [];
  let partial = 3;
  const wallet: WalletApi = {
    kind: 'mock',
    signIn: (m) => inner.signIn(m),
    canAddKeyAtSignIn: () => inner.canAddKeyAtSignIn(),
    addPlayKey: (a, v) => inner.addPlayKey(a, v),
    signOut: () => inner.signOut(),
    async send(acct, txs) {
      if (txs.length > 1 && partial > 0) {
        for (const t of txs.slice(0, partial)) {
          sent.push(methods(t));
          client.ledgerWalletTx(acct, t);
        }
        partial = 0;
        throw new WalletError('failed', 'The wallet gave up halfway.');
      }
      sent.push(...txs.map(methods));
      return inner.send(acct, txs);
    },
  };
  const store = createStore(client, wallet);
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    ok(await store.actions.swapBuy(NEAR / 4n), 'a batch that partly ran (the key, the registration, the swap)');
    ok(sent.filter((x) => x === 'storage_deposit+near_deposit+ft_transfer_call' || x === 'near_deposit+ft_transfer_call').length === 1, 'the swap went out once, never twice');
    ok(sent[sent.length - 1] === 'ft_transfer_call' && store.get().me?.balanceCoins === 98 && client.walletCoinsOf(ACCT) < 1, 'only the deposit followed; 98 coins in the game');
  } finally {
    store.actions.logout();
    client.dispose();
    storage.clear();
  }
}

// ---------- 5. refused before any popup; the player closes the wallet ----------
console.log('refusals');
{
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    client.setSwapAccount(ACCT, { near: NEAR / 5n });
    ok(!(await store.actions.swapBuy(NEAR / 4n)), 'more than the wallet can cover');
    ok(/^That needs 0\.303 NEAR with storage and gas; your wallet has 0\.2\.$/.test(store.get().walletTx.error ?? ''), `said plainly: "${store.get().walletTx.error}"`);
    ok(wallet.calls.filter((c) => c === 'tx').length === 0, 'no wallet popup');
    ok(!(await store.actions.swapBuy(parseNear('0.001')!)) && /less than one coin/.test(store.get().walletTx.error ?? ''), 'less than one coin: refused');
    client.setSwapAccount(ACCT, { near: 5n * NEAR });
    wallet.o.reject = 'tx';
    ok(!(await store.actions.swapBuy(NEAR / 4n)) && /closed the wallet/.test(store.get().walletTx.error ?? ''), 'the player closed the wallet: its own words');
    ok(client.swapAccountOf(ACCT).wnear === 0n && (store.get().me?.balanceCoins ?? 0) === 0, 'and nothing moved');
  } finally {
    done();
  }
}
{
  // a relay without swap: the store refuses, the client has no quote
  const { store, done } = setup({ swap: false });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    ok(!store.get().config?.swap && !('nearPerCoin' in (store.get().config ?? {})), 'no swap in the config');
    ok(!(await store.actions.swapBuy(NEAR / 4n)) && /not on here/.test(store.get().walletTx.error ?? ''), 'no buy with NEAR');
    const info = await store.actions.refreshWalletInfo();
    ok(info !== undefined && !('nearBalance' in info) && !('wnearBalance' in info), 'WalletInfo as before');
  } finally {
    done();
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
