// Wallet sign-in in the mock (?mock=1&wallet=1), through the store, the mock relay and the mock wallet: every
// sign-in state (waiting, checking, rejected, resumed, expired, signed out), enabling coins (the key at
// sign-in, the AddKey fallback, a rejection, the wrong account), a wallet deposit and withdrawal, a paid
// chat whose play and call the browser signs and the mock relay checks, the store refusing to sign what
// the player did not ask for, free play only while there is no coin, and the testnet airdrop (v1.6): one tap,
// no wallet approval, then the real game; its limits, for a wallet player and a test player; never on mainnet.
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

const { MockGameClient } = await import('../src/net/mock.ts');
const { createStore } = await import('../src/state/store.ts');
const { MockWallet } = await import('../src/wallet/mock.ts');
const { loadPlayKey } = await import('../src/wallet/keys.ts');
const { decodeSignedTransaction, verifySignedTransaction, publicKeyString } = await import('../src/wallet/tx.ts');
const { base64Decode } = await import('../src/wallet/base58.ts');
const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
import type { AppState, Store } from '../src/state/store.ts';
import type { ClientMsg, GameClient, ServerMsg } from '../../shared/protocol.ts';

const here = dirname(fileURLToPath(import.meta.url));
const EV = join(here, '..', '..', 'experiments', 'near-ai', 'evidence', '2026-11-04');
const fsLoader = async () => ({
  request: readFileSync(join(EV, 'request.json'), 'utf8'),
  response: readFileSync(join(EV, 'response.json'), 'utf8'),
  signature: readFileSync(join(EV, 'signature.json'), 'utf8'),
  attestation: readFileSync(join(EV, 'attestation.json'), 'utf8'),
});

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function waitFor(store: Store, pred: (s: AppState) => boolean, label: string, ms = 8000): Promise<AppState> {
  return new Promise((resolve, reject) => {
    if (pred(store.get())) return resolve(store.get());
    const timer = setTimeout(() => {
      un();
      reject(new Error('timeout waiting for ' + label));
    }, ms);
    const un = store.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        un();
        resolve(s);
      }
    });
  });
}

type MockOpts = ConstructorParameters<typeof MockGameClient>[0];
function setup(o: MockOpts = {}, w: ConstructorParameters<typeof MockWallet>[1] = {}) {
  const client = new MockGameClient({
    wallet: true, chatSeconds: 1.2, callSeconds: 1, countdownSeconds: 0.1, roundMinutes: 3, timeScale: 0.02, searchMs: [20, 40],
    storageKey: null, noHuman: true, playFailChance: 0, loadEvidence: fsLoader, signTimeoutMs: 2000, buyUrl: 'https://meme.cooking', ...o,
  });
  const wallet = new MockWallet(client, { accountId: 'sam.testnet', delayMs: 5, ...w });
  const store = createStore(client, wallet);
  return { client, wallet, store, done: () => { store.actions.logout(); client.dispose(); } };
}

// ---------- 1. sign-in states ----------
console.log('wallet sign-in');
{
  const { client, wallet, store, done } = setup();
  try {
    const cfg = await store.actions.loadConfig();
    ok(cfg.testMode === false && cfg.wallet?.recipient === 'realsies.lol' && cfg.coinsOpen === true && cfg.buyUrl === 'https://meme.cooking', 'a relay without test mode: wallet config, coins open, Buy REAL link');
    ok((await client.listTestUsers()).length === 0, 'no test users');
    ok(store.get().signIn.phase === 'idle' && !store.get().session, 'starts signed out');
    const phases: string[] = [];
    const un = store.subscribe((s) => {
      if (phases[phases.length - 1] !== s.signIn.phase) phases.push(s.signIn.phase);
    });
    const signedIn = await store.actions.walletSignIn();
    un();
    const s = store.get();
    ok(signedIn && phases.join(' ') === 'wallet checking idle', `sign-in phases: ${phases.join(' ')}`);
    ok(s.session?.accountId === 'sam.testnet' && s.session.token.startsWith('mst_') && s.session.playKey === null, 'a session for the wallet account');
    ok(s.accountId === 'sam.testnet' && s.welcomed && s.me?.kind === 'wallet' && s.me.balanceCoins === 0, 'connected and welcomed as a wallet player with no coins');
    ok(wallet.calls.join(',') === 'signIn', 'one wallet approval');
    const saved = JSON.parse(storage.getItem('realsies:session:testnet') ?? '{}');
    ok(saved.token === s.session?.token && !('secret' in saved), 'the session token is kept for a reload, nothing else');
    // a reload: a new store on the same relay resumes the session without the wallet
    const store2 = createStore(client, new MockWallet(client, { accountId: 'sam.testnet', delayMs: 5 }));
    store.actions.logout();
    ok(await store2.actions.resumeSession(), 'a reload resumes the stored session');
    await waitFor(store2, (x) => x.welcomed, 'welcome after resume');
    ok(store2.get().session?.accountId === 'sam.testnet', 'same account, no wallet popup');
    // the relay forgets the session: back to sign-in with a note
    (store2.client as unknown as { on(h: (m: ServerMsg) => void): () => void });
    (client as unknown as { emit(m: ServerMsg): void }).emit({ t: 'error', code: 'session_expired', message: 'Your session ended. Sign in again.' });
    await waitFor(store2, (x) => !x.session && !x.accountId, 'signed out after session_expired');
    ok(store2.get().signIn.phase === 'error' && /Sign in again/.test(store2.get().signIn.error ?? ''), 'session_expired: back to sign-in with a note');
    store2.actions.logout();
  } finally {
    done();
    storage.clear();
  }
}
{
  const { store, done } = setup({}, { reject: 'signIn' });
  await store.actions.loadConfig();
  ok(!(await store.actions.walletSignIn()), 'a closed wallet: no sign-in');
  ok(store.get().signIn.phase === 'error' && /closed the wallet/.test(store.get().signIn.error ?? '') && !store.get().session, 'the error says the wallet was closed');
  done();
  storage.clear();
}
{
  const { store, done } = setup({}, { hold: 'signIn' });
  await store.actions.loadConfig();
  void store.actions.walletSignIn();
  await sleep(60);
  ok(store.get().signIn.phase === 'wallet', 'waiting for the wallet while it is open');
  ok(!(await store.actions.walletSignIn()), 'a second click while waiting does nothing');
  store.actions.resetFlow('signIn');
  ok(store.get().signIn.phase === 'idle', 'cancel');
  done();
  storage.clear();
}
{
  // a wallet signing with a key that is not the account's full-access key: refused by the relay
  const { client, store, done } = setup();
  await store.actions.loadConfig();
  const ch = await client.authChallenge!();
  let err = '';
  try {
    await client.authVerify!({ accountId: 'sam.testnet', publicKey: 'ed25519:' + '1'.repeat(44), signature: 'AAAA', nonce: ch.nonce });
  } catch (e) {
    err = (e as { code?: string }).code ?? '';
  }
  ok(err === 'bad_signature', 'a bad signature is refused: ' + err);
  let reuse = '';
  try {
    await client.authVerify!({ accountId: 'sam.testnet', publicKey: 'ed25519:x', signature: 'x', nonce: ch.nonce });
  } catch (e) {
    reuse = (e as { code?: string }).code ?? '';
  }
  ok(reuse === 'nonce_used', 'a nonce works once');
  done();
  storage.clear();
}

// ---------- 2. the first deposit brings the play key along (one approval), a paid chat signed in the browser, withdraw, sign out ----------
console.log('coins with a wallet');
{
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    store.actions.enterRoom(1);
    const room = (await waitFor(store, (s) => !!s.rooms[1], 'room')).rooms[1]!;
    let faucetErr = '';
    await store.actions.faucet(50).catch((e) => (faucetErr = (e as { code?: string }).code ?? ''));
    ok(faucetErr === 'not_test_mode', 'no faucet without test mode: coins come from the wallet');
    await client.faucetToWallet(200); // the mock's coins into the wallet (a relay without test mode has no airdrop)
    ok(client.walletCoinsOf('sam.testnet') === 200 && !store.actions.coinsEnabled(), '200 in the wallet, no play key yet');
    const depPhases: string[] = [];
    const un = store.subscribe((s) => {
      if (depPhases[depPhases.length - 1] !== s.walletTx.phase) depPhases.push(s.walletTx.phase);
    });
    ok(await store.actions.walletDeposit(60), 'the first deposit');
    un();
    ok(depPhases.slice(-3).join(' ') === 'wallet checking done' && store.get().walletTx.kind === 'deposit' && !!store.get().walletTx.tx, `deposit phases: ${depPhases.join(' ')}`);
    ok(store.get().me?.balanceCoins === 60 && client.walletCoinsOf('sam.testnet') === 140, '60 coins in the game, 140 left in the wallet');
    ok(JSON.stringify(wallet.sent) === JSON.stringify([['AddKey', 'ft_transfer_call']]) && !wallet.calls.includes('key'), 'one approval: the play key and the deposit together, no step of its own');
    const local = loadPlayKey('testnet', 'sam.testnet');
    ok(!!local && local.status === 'active' && store.get().session?.playKey?.publicKey === local.publicKey && store.get().session?.playKey?.methodNames.join() === 'play,call' && store.actions.coinsEnabled(), 'the browser holds the play key, the relay checked it on chain');

    // a paid chat: the browser signs the play and the call
    const sent: ClientMsg[] = [];
    const realSend = client.send.bind(client);
    client.send = (m: ClientMsg) => {
      sent.push(m);
      realSend(m);
    };
    store.actions.pickSeat(1, room.seats[1].index, 'paid', 10);
    const placed = await waitFor(store, (s) => !!s.chat?.playTx, 'placed', 10_000);
    const signedPlay = sent.find((m) => m.t === 'signed_tx') as Extract<ClientMsg, { t: 'signed_tx' }> | undefined;
    const d = signedPlay ? decodeSignedTransaction(base64Decode(signedPlay.signedTx)) : null;
    ok(!!d && d.tx.signerId === 'sam.testnet' && d.tx.receiverId === 'game.realsies.testnet' && d.tx.methodName === 'play' && d.tx.deposit === 0n, 'the browser signed one play on the game contract, no deposit');
    ok(!!d && JSON.parse(new TextDecoder().decode(d.tx.args)).coins === 10 && publicKeyString(d.tx.publicKey) === local!.publicKey, 'for the 10 coins chosen, with the play key');
    ok(!!signedPlay && verifySignedTransaction(base64Decode(signedPlay.signedTx)) && placed.chat!.playTx === d!.hash, 'a valid signature; the placed tx is its hash');
    await waitFor(store, (s) => s.chat?.phase === 'calling', 'chat ends', 10_000);
    store.actions.call(false);
    const called = await waitFor(store, (s) => s.chat?.phase === 'called' && !s.chat.callPending, 'call recorded', 10_000);
    const signedCall = sent.filter((m) => m.t === 'signed_tx')[1] as Extract<ClientMsg, { t: 'signed_tx' }> | undefined;
    const dc = signedCall ? decodeSignedTransaction(base64Decode(signedCall.signedTx)) : null;
    ok(!!dc && dc.tx.methodName === 'call' && JSON.parse(new TextDecoder().decode(dc.tx.args)).human === false && dc.tx.nonce > d!.tx.nonce, 'the call is signed too, human: false, the next nonce');
    ok(called.chat!.callTx === dc?.hash, 'call_recorded carries its hash');
    ok(!sent.some((m) => m.t === 'sign_declined'), 'nothing declined');
    store.actions.clearChat();
    ok(store.get().me!.balanceCoins === 50, '10 coins on the table');
    ok(wallet.sent.length === 1, 'the paid chat asked the wallet nothing');

    // a second deposit: the key is there, so the deposit alone
    ok(await store.actions.walletDeposit(5) && JSON.stringify(wallet.sent[1]) === JSON.stringify(['ft_transfer_call']), 'the next deposit: the deposit alone');
    // withdraw: registered on the coin (the faucet did it) and the key is there: the withdrawal alone
    const info = await store.actions.refreshWalletInfo();
    ok(info?.tokenRegistered === true && info.coinsOpen, 'wallet info: registered on the coin');
    ok(await store.actions.walletWithdraw(20), 'a withdrawal through the wallet');
    ok(JSON.stringify(wallet.sent[2]) === JSON.stringify(['withdraw']), 'the withdrawal alone');
    ok(store.get().me!.balanceCoins === 35 && client.walletCoinsOf('sam.testnet') === 155, '20 coins back in the wallet');
    ok(!(await store.actions.walletWithdraw(500)) && /Not enough/.test(store.get().walletTx.error ?? ''), 'not more than the balance');

    // sign out: the session ends and the browser forgets its play key
    await store.actions.signOut();
    ok(!store.get().session && !store.get().accountId && !loadPlayKey('testnet', 'sam.testnet') && !storage.getItem('realsies:session:testnet'), 'signed out: no session, no play key, nothing stored');
  } finally {
    done();
    storage.clear();
  }
}

// ---------- 2b. the batch for every case, and the fallback when a wallet refuses it ----------
console.log('one approval, every case');
{
  // a withdrawal with no key and no registration: key, registration and withdrawal in one approval
  const { client, wallet, store, done } = setup({ wallet: false }, { accountId: 'wes.testnet' });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome wes');
    await client.faucet('wes.testnet', 30); // coins in the game that came without a wallet transaction
    await store.actions.refreshMe();
    ok((await store.actions.refreshWalletInfo())?.tokenRegistered === false && !store.actions.coinsEnabled(), 'not registered on the coin, no play key');
    ok(await store.actions.walletWithdraw(10), 'a withdrawal');
    ok(JSON.stringify(wallet.sent) === JSON.stringify([['AddKey', 'storage_deposit', 'withdraw']]), 'one approval: key, registration, withdrawal');
    ok(store.get().walletInfo?.tokenRegistered === true && client.walletCoinsOf('wes.testnet') === 10 && store.get().me?.balanceCoins === 20 && store.actions.coinsEnabled(), 'registered, 10 in the wallet, 20 in the game, the key active');
    // a deposit while unregistered (the wallet registers too) with the key present
    client.setRegistered('wes.testnet', false);
    ok(await store.actions.walletDeposit(5) && JSON.stringify(wallet.sent[1]) === JSON.stringify(['storage_deposit', 'ft_transfer_call']), 'key present, not registered: registration and deposit');
    ok(store.get().me?.balanceCoins === 25, 'deposited');
  } finally {
    done();
    storage.clear();
  }
}
{
  // a wallet that signs one transaction at a time: the batch is refused, then one approval each, the key last
  const { client, wallet, store, done } = setup({}, { noBatch: true });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    await client.faucetToWallet(100);
    ok(await store.actions.walletDeposit(30), 'the deposit goes through');
    ok(JSON.stringify(wallet.sent) === JSON.stringify([['AddKey', 'ft_transfer_call'], ['ft_transfer_call'], ['AddKey']]), 'refused as a batch: the deposit, then the key, one approval each');
    ok(store.get().me?.balanceCoins === 30 && store.actions.coinsEnabled(), '30 in the game, the key active');
  } finally {
    done();
    storage.clear();
  }
}
{
  // a wallet that adds no keys for apps: the deposit still goes; the first paid play asks for the key on its own
  const { client, wallet, store, done } = setup({}, { noAddKeyTx: true });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    await client.faucetToWallet(100);
    ok(await store.actions.walletDeposit(30), 'the deposit goes through');
    ok(JSON.stringify(wallet.sent) === JSON.stringify([['AddKey', 'ft_transfer_call'], ['ft_transfer_call'], ['AddKey']]) && store.get().me?.balanceCoins === 30, 'the batch and the key alone refused, the deposit alone sent');
    ok(!store.actions.coinsEnabled() && loadPlayKey('testnet', 'sam.testnet')?.status === 'pending', 'no key yet');
    store.actions.enterRoom(1);
    const room = (await waitFor(store, (s) => !!s.rooms[1], 'room')).rooms[1]!;
    store.actions.pickSeat(1, room.seats[0].index, 'paid', 10);
    const kn = (await waitFor(store, (s) => !!s.keyNeeded, 'the relay asks for a play key')).keyNeeded!;
    ok(kn.code === 'play_key_missing' && kn.pick?.coins === 10 && kn.pick.seatIndex === room.seats[0].index && !store.get().search, 'the first paid pick: the seat goes back and the one-approval sheet gets the same pick');
    ok(await store.actions.enableCoins() && wallet.calls.filter((c) => c === 'key').length === 1 && store.actions.coinsEnabled(), 'one approval (the key at sign-in), then plays need no more');
  } finally {
    done();
    storage.clear();
  }
}
{
  // the player closes the wallet on the batch: nothing is sent, nothing asked again
  const { client, wallet, store, done } = setup({}, { reject: 'tx' });
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    await client.faucetToWallet(100);
    ok(!(await store.actions.walletDeposit(30)) && /closed the wallet/.test(store.get().walletTx.error ?? ''), 'a closed wallet: the deposit says so');
    ok(wallet.calls.filter((c) => c === 'tx').length === 1 && client.walletCoinsOf('sam.testnet') === 100 && !store.actions.coinsEnabled(), 'asked once, nothing moved, no key');
  } finally {
    done();
    storage.clear();
  }
}

// ---------- 3. play key fallbacks (the one-approval sheet of a first paid play) ----------
console.log('play key fallbacks');
{
  // the wallet signs in but adds no key: one AddKey transaction instead
  const { wallet, store, done } = setup({}, { ignoreKeyAtSignIn: true });
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  const notes: string[] = [];
  const un = store.subscribe((s) => {
    if (s.keySetup.note && notes[notes.length - 1] !== s.keySetup.note) notes.push(s.keySetup.note);
  });
  ok(await store.actions.enableCoins(), 'enabled with a second approval');
  un();
  ok(store.get().keySetup.via === 'transaction' && wallet.calls.filter((c) => c === 'key').length === 2 && notes.some((n) => /One more approval/.test(n)), 'sign-in first, then the AddKey transaction, with a note why');
  done();
  storage.clear();
}
{
  // the wallet adds a key that may call any method: refused; a fresh key goes by AddKey transaction instead
  const { wallet, store, done } = setup({}, { broadKeyAtSignIn: true });
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  const notes: string[] = [];
  const un = store.subscribe((s) => {
    if (s.keySetup.note && notes[notes.length - 1] !== s.keySetup.note) notes.push(s.keySetup.note);
  });
  ok(await store.actions.enableCoins(), 'enabled after a broader key');
  un();
  const pk = store.get().session?.playKey;
  ok(store.get().keySetup.via === 'transaction' && wallet.calls.filter((c) => c === 'key').length === 2 && notes.some((n) => /broader key/.test(n)), 'the broad key is refused, a fresh one goes by transaction, with a note');
  ok(!!pk && pk.methodNames.join() === 'play,call' && loadPlayKey('testnet', 'sam.testnet')?.publicKey === pk.publicKey, 'the key in use is the narrow one');
  done();
  storage.clear();
}
{
  const { wallet, store, done } = setup({}, { noKeyAtSignIn: true });
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  ok(await store.actions.enableCoins() && store.get().keySetup.via === 'transaction' && wallet.calls.filter((c) => c === 'key').length === 1, 'a wallet that cannot add a key at sign-in: one AddKey transaction');
  done();
  storage.clear();
}
{
  const { store, done } = setup({}, { reject: 'key' });
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  ok(!(await store.actions.enableCoins()) && store.get().keySetup.phase === 'error' && /closed the wallet/.test(store.get().keySetup.error ?? ''), 'a closed wallet: no key, the error says so');
  ok(!store.actions.coinsEnabled(), 'coins stay off');
  done();
  storage.clear();
}
{
  const { store, done } = setup({}, { wrongAccount: true });
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  ok(!(await store.actions.enableCoins()) && /Switch it back to sam\.testnet/.test(store.get().keySetup.error ?? ''), 'the wallet switched accounts: refused, with how to fix it');
  done();
  storage.clear();
}
{
  // a key approved, then the page reloaded before the relay heard of it: found again, no second approval
  const { client, wallet, store, done } = setup();
  await store.actions.loadConfig();
  await store.actions.walletSignIn();
  await store.actions.enableCoins();
  const pk = store.get().session!.playKey!.publicKey;
  const token = store.get().session!.token;
  store.actions.logout();
  const w2 = new MockWallet(client, { accountId: 'sam.testnet', delayMs: 5 });
  const store2 = createStore(client, w2);
  await store2.actions.loadConfig();
  ok(await store2.actions.resumeSession(), 'resumed');
  ok(store2.get().session?.token === token && store2.get().session?.playKey?.publicKey === pk && store2.actions.coinsEnabled(), 'the play key is still enabled after a reload');
  ok(wallet.calls.filter((c) => c === 'key').length === 1 && w2.calls.length === 0, 'no new approval');
  store2.actions.logout();
  done();
  storage.clear();
}

// ---------- 4. the store signs only what the player asked for ----------
console.log('what the browser signs');
{
  let handler: ((m: ServerMsg) => void) | null = null;
  const sent: ClientMsg[] = [];
  const mock = new MockGameClient({ wallet: true, storageKey: null, timeScale: 0.02 });
  const cfg = mock.config;
  const stub = {
    on: (h: (m: ServerMsg) => void) => ((handler = h), () => {}),
    onStatus: () => () => {},
    send: (m: ClientMsg) => sent.push(m),
    connect() {},
    disconnect() {},
    getConfig: async () => cfg,
    authChallenge: () => mock.authChallenge(),
    authVerify: (p: Parameters<NonNullable<GameClient['authVerify']>>[0]) => mock.authVerify(p),
    registerPlayKey: (pk: string) => mock.registerPlayKey(pk),
  } as unknown as GameClient;
  const s = createStore(stub, new MockWallet(mock, { accountId: 'sam.testnet', delayMs: 1 }));
  await s.actions.loadConfig();
  await s.actions.walletSignIn().catch(() => {});
  await s.actions.enableCoins();
  const key = loadPlayKey('testnet', 'sam.testnet')!;
  const info = { chatId: 'c1', roundId: 9, level: 1 as const, seatIndex: 0, theme: 'castle' as const, partner: { seed: 'a'.repeat(64), name: 'Pickle435' }, mode: 'paid' as const, coins: 10 };
  s.actions.pickSeat(1, 0, 'paid', 10);
  handler!({ t: 'matched', chat: info });
  const req = (over: Record<string, unknown> = {}, args: Record<string, unknown> = {}, purpose: 'play' | 'call' = 'play') => ({
    t: 'sign_tx' as const, reqId: 'r' + Math.random(), chatId: 'c1', purpose, expiresAt: Date.now() + 9000,
    tx: {
      signerId: 'sam.testnet', publicKey: key.publicKey, nonce: '5', receiverId: cfg.contractId, blockHash: '11111111111111111111111111111111',
      actions: [{ type: 'FunctionCall' as const, methodName: purpose, args: JSON.stringify({ round_id: 9, handle: 'ab'.repeat(32), ...(purpose === 'play' ? { coins: 10 } : { human: true }), ...args }), gas: '10000000000000', deposit: '0' as const }],
      ...over,
    },
  });
  const answer = (m: ServerMsg) => {
    sent.length = 0;
    handler!(m);
    return sent[0] as ClientMsg | undefined;
  };
  ok(answer(req())?.t === 'signed_tx', 'the play the player chose: signed');
  const cases: [string, ServerMsg][] = [
    ['more coins', req({}, { coins: 500 })],
    ['another account', req({ signerId: 'thief.testnet' })],
    ['another contract', req({ receiverId: 'evil.testnet' })],
    ['a deposit', req({ actions: [{ ...req().tx.actions[0], deposit: '1' }] })],
    ['another method', req({ actions: [{ ...req().tx.actions[0], methodName: 'withdraw' }] })],
    ['another round', req({}, { round_id: 8 })],
    ['another chat', { ...req(), chatId: 'c2' }],
    ['another key', req({ publicKey: 'ed25519:' + 'A'.repeat(43) })],
    ['a call the player did not make', req({}, {}, 'call')],
  ];
  for (const [label, m] of cases) {
    const a = answer(m);
    ok(a?.t === 'sign_declined', `declines ${label}: ${a?.t === 'sign_declined' ? a.reason : a?.t}`);
  }
  s.actions.logout();
  mock.dispose();
  storage.clear();
}

// ---------- 4b. what the wallet holds: an empty wallet, a short one, enough ----------
console.log('what the wallet holds');
{
  const { fmtTokens, depositCheck, shortWalletText } = await import('../src/state/walletFunds.ts');
  ok(fmtTokens(0n, 18) === '0' && fmtTokens(3n * 10n ** 18n, 18) === '3' && fmtTokens(35n * 10n ** 17n, 18) === '3.5' && fmtTokens(1_250_250_000_000_000_000_000n, 18) === '1,250.25', 'token amounts read like money: 0, 3, 3.5, 1,250.25');
  ok(shortWalletText('REAL', 10n ** 18n, 18, 1n) === 'Your wallet holds 1 REAL, enough for 1 coin.', 'one coin, singular');
  ok(depositCheck(undefined, 20, '1').ok && depositCheck({ accountId: 'a', coinsOpen: true, tokenId: 't', tokenRegistered: false, storageDeposit: '0' }, 20, '1').ok, 'an older relay without walletBalance blocks nothing');
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    const empty = await store.actions.refreshWalletInfo();
    ok(empty?.walletBalance === '0' && empty.tokenRegistered === false, 'a new wallet: nothing on the coin, not even registered');
    ok(!(await store.actions.walletDeposit(20)) && store.get().walletTx.error === 'Your wallet has no tREAL yet.', 'empty: the deposit is refused in place: ' + store.get().walletTx.error);
    ok(!wallet.calls.includes('tx'), 'and never sent to the wallet (it could only fail)');
    await client.faucetToWallet(3);
    await store.actions.refreshWalletInfo();
    ok(store.get().walletInfo?.walletBalance === (3n * 10n ** 18n).toString(), 'walletInfo says what the wallet holds');
    ok(!(await store.actions.walletDeposit(20)) && store.get().walletTx.error === 'Your wallet holds 3 tREAL, enough for 3 coins.', 'short: ' + store.get().walletTx.error);
    ok(!wallet.calls.includes('tx'), 'still nothing sent');
    await client.faucetToWallet(197);
    ok(await store.actions.walletDeposit(20), 'enough: the deposit goes to the wallet');
    ok(wallet.calls.filter((c) => c === 'tx').length === 1 && store.get().me?.balanceCoins === 20, 'one wallet approval, 20 coins in the game');
    ok(store.get().walletInfo?.walletBalance === (180n * 10n ** 18n).toString(), 'after the deposit: 180 left in the wallet, refreshed');
    ok(await store.actions.walletWithdraw(5), 'a withdrawal');
    ok(store.get().walletInfo?.walletBalance === (185n * 10n ** 18n).toString() && client.walletCoinsOf('sam.testnet') === 185, 'after the withdrawal: 185 in the wallet, refreshed');
  } finally {
    done();
    storage.clear();
  }
}

// ---------- 5. before REAL launches ----------
console.log('no coin yet');
{
  const { store, done } = setup({ coinsOpen: false });
  await store.actions.loadConfig();
  ok(store.get().config?.coinsOpen === false, 'config: coins closed');
  await store.actions.walletSignIn();
  await waitFor(store, (s) => s.welcomed, 'welcome');
  store.actions.enterRoom(1);
  await waitFor(store, (s) => !!s.rooms[1], 'room');
  store.actions.pickSeat(1, 0, 'paid', 10);
  const s = await waitFor(store, (x) => !!x.lastError, 'refused');
  ok(s.lastError?.code === 'coins_closed' && /REAL launches/.test(s.lastError.message) && !s.search, 'a paid pick: "Coins open when REAL launches", the seat goes back');
  ok(!(await store.actions.walletDeposit(5)) && /REAL launches/.test(store.get().walletTx.error ?? ''), 'no deposit either');
  store.actions.pickSeat(1, 0, 'free');
  ok((await waitFor(store, (x) => x.chat?.mode === 'free', 'free chat', 8000)).chat?.mode === 'free', 'free play works');
  done();
  storage.clear();
}

// ---------- 6. the testnet airdrop (protocol v1.6) ----------
console.log('the testnet airdrop');
{
  const { airdropOn, panelMode, holdsAny } = await import('../src/state/airdrop.ts');
  // a wallet player on the testnet relay (test mode): 100 tREAL into the wallet in one tap, no wallet approval
  const { client, wallet, store, done } = setup({ wallet: false });
  try {
    const cfg = await store.actions.loadConfig();
    ok(airdropOn(cfg) && cfg.testMode && cfg.network === 'testnet', 'test mode on testnet: the airdrop is on');
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    ok(panelMode(store.get(), 'lobby') === 'none', 'before the relay answers: no panel (it never flashes up)');
    const st = await store.actions.refreshAirdrop();
    ok(st?.to === 'wallet' && st.heldCoins === 0 && st.coins === 100 && !st.blocked, 'the relay: an empty account, 100 to the wallet, open');
    ok(panelMode(store.get(), 'lobby') === 'offer' && panelMode(store.get(), 'chat') === 'none' && panelMode(store.get(), 'call') === 'none', 'nothing held: the room offers it; never in a chat or a call');
    ok(panelMode(store.get(), 'lobby', Date.now() - 15_000) === 'offer', 'a screen clock a few seconds behind the relay still offers it (never had one: no wait)');
    const phases: string[] = [];
    const un = store.subscribe((s) => {
      if (phases[phases.length - 1] !== s.airdrop.phase) phases.push(s.airdrop.phase);
    });
    ok(await store.actions.airdrop(), 'one tap');
    un();
    const s = store.get();
    ok(phases.join(' ') === 'busy idle', `airdrop phases: ${phases.join(' ')}`);
    ok(client.walletCoinsOf('sam.testnet') === 100 && s.walletInfo?.walletBalance === (100n * 10n ** 18n).toString() && s.walletInfo.tokenRegistered, '100 tREAL in the wallet, registered on the coin, on screen at once');
    ok(!wallet.calls.includes('tx') && !wallet.calls.includes('key'), 'no wallet approval: the relay sends them');
    ok(s.me?.balanceCoins === 0 && holdsAny(s) && panelMode(s, 'lobby') === 'none', 'tokens held: the panel is gone');
    ok(s.notice?.code === 'airdrop' && s.notice.message === '100 tREAL are in your wallet. Tap your coins to deposit, then play.', 'a short note says where they are: ' + s.notice?.message);
    ok(!(await store.actions.airdrop()) && store.get().airdrop.error?.code === 'airdrop_too_soon' && /The next one opens in 10 min\./.test(store.get().airdrop.error?.text ?? ''), 'again at once: refused, with the reason: ' + store.get().airdrop.error?.text);
    ok(client.walletCoinsOf('sam.testnet') === 100 && panelMode(store.get(), 'lobby') === 'none', 'nothing more sent; still no panel');
    // from here it works like the real game: the first deposit, one approval with the play key in it
    ok(await store.actions.walletDeposit(40), 'a deposit of 40 from the wallet');
    ok(store.get().me?.balanceCoins === 40 && client.walletCoinsOf('sam.testnet') === 60 && JSON.stringify(wallet.sent) === JSON.stringify([['AddKey', 'ft_transfer_call']]) && store.actions.coinsEnabled(), '40 in the game, 60 in the wallet, one approval that brought the play key');
    // ten minutes on, 100 held (wallet plus game): still none
    client.setAirdropAt('sam.testnet', Date.now() - 11 * 60_000);
    ok(!(await store.actions.airdrop()) && store.get().airdrop.error?.code === 'airdrop_enough' && store.get().airdrop.error?.text === 'You hold 100 tREAL already. Airdrops are for balances under 50 tREAL.', 'enough held: ' + store.get().airdrop.error?.text);
  } finally {
    done();
    storage.clear();
  }
  // test players: the same panel while nothing is held; the airdrop goes straight into the game balance
  {
    const { client, store, done } = setup({ wallet: false });
    try {
      await store.actions.loadConfig();
      await store.actions.selectUser('dex.realsies.testnet');
      await waitFor(store, (s) => s.welcomed, 'welcome dex');
      const st = await store.actions.refreshAirdrop();
      ok(st?.to === 'game' && st.heldCoins === 0 && panelMode(store.get(), 'lobby') === 'offer', 'a test player holding nothing: the panel offers it');
      ok(await store.actions.airdrop() && store.get().me?.balanceCoins === 100 && client.walletCoinsOf('dex.realsies.testnet') === 0, '100 coins in the game, nothing in a wallet');
      ok(panelMode(store.get(), 'lobby') === 'none' && store.get().notice?.message === '100 tREAL are in your game balance. Tap a character to play.', 'the panel is gone, the note says so');
      // Finn holds 15: no panel at all
      await store.actions.selectUser('finn.realsies.testnet');
      await waitFor(store, (s) => s.welcomed, 'welcome finn');
      ok(store.get().airdrop.status === undefined, 'another player: its own view');
      await store.actions.refreshAirdrop();
      ok(panelMode(store.get(), 'lobby') === 'none', '15 held: no panel');
      // Ben holds nothing but had one 3 minutes ago: the panel says when the next one opens
      client.setAirdropAt('ben.realsies.testnet', Date.now() - 3 * 60_000);
      await store.actions.selectUser('ben.realsies.testnet');
      await waitFor(store, (s) => s.welcomed, 'welcome ben');
      await store.actions.refreshAirdrop();
      ok(panelMode(store.get(), 'lobby') === 'wait', 'nothing held, one 3 minutes ago: the panel waits (no button)');
      ok(panelMode(store.get(), 'lobby', Date.now() + 8 * 60_000) === 'offer', 'and offers it again once the 10 minutes are up');
    } finally {
      done();
      storage.clear();
    }
  }
  // not without test mode, not on mainnet
  {
    const { store, done } = setup();
    try {
      ok(!airdropOn(await store.actions.loadConfig()), 'no test mode: no airdrop');
      await store.actions.walletSignIn();
      await waitFor(store, (s) => s.welcomed, 'welcome');
      ok((await store.actions.refreshAirdrop()) === null && panelMode(store.get(), 'lobby') === 'none', 'no status, no panel');
      ok(!(await store.actions.airdrop()) && store.get().airdrop.error?.code === 'not_test_mode', 'and a direct try is refused');
    } finally {
      done();
      storage.clear();
    }
    const m = setup({ mainnet: true });
    try {
      const cfg = await m.store.actions.loadConfig();
      ok(cfg.network === 'mainnet' && !airdropOn(cfg), 'mainnet: never');
    } finally {
      m.done();
      storage.clear();
    }
  }
}

// ---------- 7. the REAL auction on meme.cooking: the deposit batch (protocol v1.10) ----------
console.log('the REAL auction deposit');
{
  const A = await import('../src/launch/auction.ts');
  const acct = 'sam.near';
  const one = 10n ** 24n;
  const kinds = (txs: { receiverId: string; actions: { type: string; params: unknown }[] }[]) => txs.map((t) => `${t.receiverId}:${t.actions.map((a) => (a.type === 'FunctionCall' ? (a.params as { methodName: string }).methodName : a.type)).join('+')}`).join(' ');
  // nothing registered, no wNEAR: register on both, wrap, transfer
  const all = A.auctionDepositTxs(acct, one / 10n, { memeRegistered: false, wrapRegistered: false, wnear: 0n });
  ok(kinds(all) === 'meme-cooking.near:storage_deposit wrap.near:storage_deposit wrap.near:near_deposit wrap.near:ft_transfer_call', 'new account: both registrations, the wrap, the transfer: ' + kinds(all));
  const [ms, ws, nd, ft] = all.map((t) => (t.actions[0] as { params: { args: Record<string, unknown>; gas: string; deposit: string } }).params);
  ok(JSON.stringify(ms.args) === JSON.stringify({ account_id: acct, registration_only: true }) && ms.deposit === '20000000000000000000000', 'meme-cooking.near storage_deposit: registration only, 0.02 NEAR');
  ok(JSON.stringify(ws.args) === JSON.stringify({ account_id: acct, registration_only: true }) && ws.deposit === '1250000000000000000000', 'wrap.near storage_deposit: registration only, 0.00125 NEAR');
  ok(JSON.stringify(nd.args) === '{}' && nd.deposit === (one / 10n).toString(), 'near_deposit: the amount attached');
  ok(ft.args.receiver_id === 'meme-cooking.near' && ft.args.amount === '100000000000000000000000' && ft.args.msg === '{"Deposit":{"meme_id":2313}}' && ft.deposit === '1' && ft.gas === '100000000000000', 'ft_transfer_call: to meme-cooking.near, the amount in yocto, {"Deposit":{"meme_id":2313}}, 1 yoctoNEAR, 100 Tgas');
  ok(kinds(A.auctionDepositTxs(acct, one, { memeRegistered: true, wrapRegistered: true, wnear: 0n })) === 'wrap.near:near_deposit wrap.near:ft_transfer_call', 'both registered: the wrap and the transfer');
  ok(kinds(A.auctionDepositTxs(acct, one, { memeRegistered: true, wrapRegistered: false, wnear: 0n })) === 'wrap.near:storage_deposit wrap.near:near_deposit wrap.near:ft_transfer_call', 'registered on meme.cooking only: the wNEAR registration first');
  ok(kinds(A.auctionDepositTxs(acct, one, { memeRegistered: false, wrapRegistered: true, wnear: 0n })) === 'meme-cooking.near:storage_deposit wrap.near:near_deposit wrap.near:ft_transfer_call', 'registered on wrap.near only: the meme.cooking registration first');
  ok(kinds(A.auctionDepositTxs(acct, one, { memeRegistered: true, wrapRegistered: true, wnear: 2n * one })) === 'wrap.near:ft_transfer_call', 'enough wNEAR already: the transfer alone');
  ok(kinds(A.auctionDepositTxs(acct, one, { memeRegistered: true, wrapRegistered: true, wnear: one / 2n })) === 'wrap.near:near_deposit wrap.near:ft_transfer_call', 'not enough wNEAR: the whole amount is wrapped');
  ok(A.parseNear('0.1') === one / 10n && A.parseNear('1') === one && A.parseNear('2,5') === (5n * one) / 2n && A.parseNear('abc') === null && A.parseNear('') === null, 'amounts in NEAR');
  ok(A.fmtNear(one / 10n) === '0.1' && A.fmtNear(12_345_678n * 10n ** 20n) === '1,234.5678' && A.fmtNear(0n) === '0', 'NEAR amounts read like money');
  ok(A.nearNeeded(one, { memeRegistered: false, wrapRegistered: false, wnear: 0n }) === one + A.MEME_STORAGE + A.WRAP_STORAGE + A.GAS_RESERVE, 'what the batch takes from the wallet');
  ok(A.auctionLine({ memeId: 2313, totalDeposit: ((375n * one) / 10n).toString(), softCap: (100n * one).toString(), startMs: 0, endMs: 21 * 3_600_000 + 5000, finalized: false }, 0) === 'Auction: 37.5 of 100 NEAR soft cap, 21 h left', 'the auction line');

  // the batch on the mock mainnet, one wallet approval
  const launch = { auctionStart: Date.now() - 3_600_000, auctionEnd: Date.now() + 20 * 3_600_000, tokenUrl: 'https://meme.cooking/meme/2313' };
  const { client, wallet, store, done } = setup({ mainnet: true, coinsOpen: false, launch }, { accountId: acct });
  try {
    const cfg = await store.actions.loadConfig();
    ok(A.auctionDepositOn(cfg, Date.now()) && !A.auctionDepositOn(cfg, launch.auctionEnd + 1) && !A.auctionDepositOn({ ...cfg, network: 'testnet' }, Date.now()), 'offered on mainnet while the auction runs only');
    await store.actions.walletSignIn();
    const before = await client.auctionInfo();
    const a0 = await client.auctionViews.account(acct);
    const txs = A.auctionDepositTxs(acct, one, a0);
    await wallet.send(acct, txs);
    const a1 = await client.auctionViews.account(acct);
    const after = await client.auctionInfo();
    ok(wallet.calls.filter((c) => c === 'tx').length === 1 && JSON.stringify(wallet.sent[0]) === JSON.stringify(['storage_deposit', 'storage_deposit', 'near_deposit', 'ft_transfer_call']), 'one wallet approval for the whole batch');
    ok(a1.memeRegistered && a1.wrapRegistered && a1.wnear === 0n && a1.near === a0.near - one - A.MEME_STORAGE - A.WRAP_STORAGE, 'registered on both, the NEAR wrapped and sent');
    ok(BigInt(after.totalDeposit) - BigInt(before.totalDeposit) === one, 'the auction counts the deposit');
    const again = A.auctionDepositTxs(acct, one / 2n, a1);
    ok(again.length === 2, 'a second deposit: the wrap and the transfer');
  } finally {
    done();
    storage.clear();
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
