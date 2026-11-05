// Wallet sign-in in the mock (?mock=1&wallet=1), through the store, the mock relay and the mock wallet: every
// sign-in state (waiting, checking, rejected, resumed, expired, signed out), enabling coins (the key at
// sign-in, the AddKey fallback, a rejection, the wrong account), a wallet deposit and withdrawal, a paid
// chat whose play and call the browser signs and the mock relay checks, the store refusing to sign what
// the player did not ask for, and free play only while there is no coin.
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

// ---------- 2. enabling coins, deposit, a paid chat signed in the browser, withdraw, sign out ----------
console.log('coins with a wallet');
{
  const { client, wallet, store, done } = setup();
  try {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    await waitFor(store, (s) => s.welcomed, 'welcome');
    store.actions.enterRoom(1);
    const room = (await waitFor(store, (s) => !!s.rooms[1], 'room')).rooms[1]!;
    // coins need the play key first
    let faucetErr = '';
    await store.actions.faucet(50).catch((e) => (faucetErr = (e as { code?: string }).code ?? ''));
    ok(faucetErr === 'not_test_mode', 'no faucet without test mode: coins come from the wallet');
    ok(await store.actions.faucetToWallet(200), 'test coins into the wallet');
    ok(client.walletCoinsOf('sam.testnet') === 200, '200 in the wallet');
    const depPhases: string[] = [];
    const un = store.subscribe((s) => {
      if (depPhases[depPhases.length - 1] !== s.walletTx.phase) depPhases.push(s.walletTx.phase);
    });
    ok(await store.actions.walletDeposit(60), 'a deposit from the wallet');
    un();
    ok(depPhases.slice(-3).join(' ') === 'wallet checking done' && store.get().walletTx.kind === 'deposit' && !!store.get().walletTx.tx, `deposit phases: ${depPhases.join(' ')}`);
    ok(store.get().me?.balanceCoins === 60 && client.walletCoinsOf('sam.testnet') === 140, '60 coins in the game, 140 left in the wallet');
    ok(!store.actions.coinsEnabled(), 'coins not enabled yet');
    store.actions.pickSeat(1, room.seats[0].index, 'paid', 10);
    await waitFor(store, (s) => !!s.keyNeeded, 'the relay asks for a play key');
    ok(store.get().keyNeeded?.code === 'play_key_missing' && !store.get().search, 'a paid pick without a play key: the seat goes back, "Enable coins" opens');
    const keyPhases: string[] = [];
    const un2 = store.subscribe((s) => {
      if (keyPhases[keyPhases.length - 1] !== s.keySetup.phase) keyPhases.push(s.keySetup.phase);
    });
    ok(await store.actions.enableCoins(), 'enable coins');
    un2();
    ok(keyPhases.join(' ') === 'checking wallet checking done' && store.get().keySetup.via === 'sign-in', `key phases: ${keyPhases.join(' ')} via ${store.get().keySetup.via}`);
    const local = loadPlayKey('testnet', 'sam.testnet');
    ok(!!local && local.status === 'active' && store.get().session?.playKey?.publicKey === local.publicKey && store.actions.coinsEnabled(), 'the browser holds the play key, the relay knows it');
    ok(wallet.calls.filter((c) => c === 'key').length === 1, 'one approval: the key added at sign-in');

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

    // withdraw: the account is registered on the coin already (the faucet did it)
    const info = await store.actions.refreshWalletInfo();
    ok(info?.tokenRegistered === true && info.coinsOpen, 'wallet info: registered on the coin');
    ok(await store.actions.walletWithdraw(20), 'a withdrawal through the wallet');
    ok(store.get().me!.balanceCoins === 30 && client.walletCoinsOf('sam.testnet') === 160, '20 coins back in the wallet');
    ok(!(await store.actions.walletWithdraw(500)) && /Not enough/.test(store.get().walletTx.error ?? ''), 'not more than the balance');

    // sign out: the session ends and the browser forgets its play key
    await store.actions.signOut();
    ok(!store.get().session && !store.get().accountId && !loadPlayKey('testnet', 'sam.testnet') && !storage.getItem('realsies:session:testnet'), 'signed out: no session, no play key, nothing stored');
  } finally {
    done();
    storage.clear();
  }
}

// ---------- 3. play key fallbacks ----------
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
