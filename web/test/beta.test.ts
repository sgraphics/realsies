// The testnet beta's end (protocol v1.9, PublicConfig.betaClosed; src/state/beta.ts): the redirect address with
// ?beta=over, the thank-you on arrival, when the game's note shows and when it may leave (never mid-chat), the store
// on beta_closed (a pick, a sign-in), and the mock states ?mock=1&betaclosed=1 and ?mock=1&launch=soon&beta=over.
// Run by mock-flow.test.ts.

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();

const B = await import('../src/state/beta.ts');
const { MockGameClient } = await import('../src/net/mock.ts');
const { createClient } = await import('../src/net/index.ts');
const { createStore } = await import('../src/state/store.ts');
const { comingSoon } = await import('../src/launch/phase.ts');
import type { AppState, Store } from '../src/state/store.ts';
import type { ServerMsg } from '../../shared/protocol.ts';

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

console.log('the beta is over: where the game goes, and the thank-you there');
ok(B.betaOverUrl('https://realsies.lol') === 'https://realsies.lol/?beta=over', 'the relay redirect with ?beta=over');
ok(B.betaOverUrl('https://realsies.lol/?ref=testnet#top') === 'https://realsies.lol/?ref=testnet&beta=over#top', 'its own parameters and anchor kept');
ok(B.betaOverUrl('/?mock=1&launch=soon', 'http://localhost:5173/play?mock=1&betaclosed=1') === 'http://localhost:5173/?mock=1&launch=soon&beta=over', 'a relative redirect (the mock) on this origin');
ok(B.betaOverUrl(undefined) === 'https://realsies.lol/?beta=over', 'no redirect known yet (a beta_closed error first): realsies.lol');
ok(B.betaOverUrl('javascript:alert(1)') === 'https://realsies.lol/?beta=over', 'never a script URL');
const took = B.takeBetaOver('https://realsies.lol/?mock=1&launch=soon&beta=over');
ok(took.notice && took.url === '/?mock=1&launch=soon', 'arriving with ?beta=over: the thank-you, and the address without it');
ok(B.takeBetaOver('https://realsies.lol/?beta=over').url === '/', 'the bare address when it was the only parameter');
ok(!B.takeBetaOver('https://realsies.lol/?mock=1').notice && !B.takeBetaOver('not a url').notice, 'no notice otherwise');
ok(B.consumeBetaOver() === false, 'outside a browser: nothing to consume');
ok(B.BETA_OVER === 'The beta test is over. Thanks for playing! See you on mainnet.', 'the game\'s note');
ok(B.BETA_OVER_LANDING === 'The testnet beta is over. Thanks for testing!', 'the launch page\'s line');
ok(B.BETA_REDIRECT_MS === 5000, 'five seconds');

console.log('when the note shows and when the game may leave');
const cfgClosed = { betaClosed: { redirect: 'https://realsies.lol', reason: 'spend_cap' as const } };
ok(B.betaEndOf({ config: cfgClosed as never })?.redirect === 'https://realsies.lol', 'the config says so: the note, with the relay\'s redirect');
ok(!!B.betaEndOf({ betaOver: { at: 1 } }) && B.betaEndOf({ betaOver: { at: 1 } })!.redirect === undefined, 'a beta_closed error first: the note too');
ok(B.betaEndOf({}) === null, 'otherwise no note');
const phase = (p: string) => ({ chat: { phase: p } as never });
ok(['placing', 'chatting', 'calling'].every((p) => B.chatRunning(phase(p))), 'a running chat and its call window hold the redirect back');
ok(['called', 'missed'].every((p) => !B.chatRunning(phase(p))) && !B.chatRunning({}), 'after the call (or without a chat) it goes');

console.log('mock states');
{
  const c = createClient('?mock=1&betaclosed=1');
  const cfg = await c.getConfig();
  ok(cfg.betaClosed?.reason === 'spend_cap' && cfg.betaClosed.redirect === '/?mock=1&launch=soon', '?mock=1&betaclosed=1: the config says the beta is over, the mock launch page is next');
  ok(B.betaOverUrl(cfg.betaClosed!.redirect, 'http://localhost:5173/?mock=1&betaclosed=1') === 'http://localhost:5173/?mock=1&launch=soon&beta=over', 'the redirect is the second mock state');
  const l = createClient('?mock=1&launch=soon&beta=over');
  const lc = await l.getConfig();
  ok(comingSoon(lc, Date.now()) && !lc.betaClosed, '?mock=1&launch=soon&beta=over: the coming-soon page, which then says thanks');
  ok(!(await createClient('?mock=1').getConfig()).betaClosed, 'no betaClosed otherwise');
}

console.log('the store on beta_closed');
{
  const client = new MockGameClient({ betaClosed: true, storageKey: null, timeScale: 0.02, searchMs: [30, 60], chatSeconds: 2, callSeconds: 1, countdownSeconds: 0 });
  const seen: ServerMsg[] = [];
  client.on((m) => seen.push(m));
  const store = createStore(client);
  await store.actions.loadConfig();
  await store.actions.selectUser('ana.realsies.testnet');
  await waitFor(store, (s) => (s.rooms[1]?.seats.length ?? 0) === 10, 'room 1');
  store.actions.pickSeat(1, 0, 'free');
  const s = await waitFor(store, (x) => !!x.betaOver, 'betaOver after a pick');
  ok(!s.search && !s.chat, 'a pick gets beta_closed: no search, no chat');
  ok(seen.some((m) => m.t === 'error' && m.code === 'beta_closed' && m.message === B.BETA_OVER), 'the relay\'s beta_closed with its message');
  ok(!seen.some((m) => m.t === 'searching' || m.t === 'matched'), 'never searching or matched');
  ok(!!B.betaEndOf(s), 'so the game shows the note');
  store.actions.logout();
}
{
  // a wallet sign-in on a closed beta: refused with beta_closed; the store shows the end instead of an error
  const client = new MockGameClient({ betaClosed: true, wallet: true, storageKey: null, timeScale: 0.02 });
  let code = '';
  try {
    await client.authChallenge();
  } catch (e) {
    code = (e as { code?: string }).code ?? '';
  }
  ok(code === 'beta_closed', 'the mock relay refuses new sign-ins with beta_closed');
  const fakeWallet = { signIn: async () => { throw new Error('never asked'); } } as never;
  const store = createStore(client, fakeWallet);
  const signed = await store.actions.walletSignIn();
  const s = store.get();
  ok(signed === false && !!s.betaOver && s.signIn.phase === 'idle', 'a sign-in on a closed beta: no error, the end of the beta instead');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
