// The practice chat (protocol v1.14): one free try for a guest, in the store and the mock relay (no DOM). The try is
// asked about, started with the character tapped, chatted, called, and revealed at once: "It fooled you" for a human
// call, "You spotted it" for a bot call, no verdict for a missed one. Then this browser has had it (and the mock relay
// knows the device), the day's cap, the napping bots and "off" refuse it, a guest's socket takes nothing of the round,
// and a sign-in ends a practice. Five a day: "Play again" from the reveal with another character until none is left.
// The real client: the HTTP and socket wiring with fakes. Run by mock-flow.test.ts.

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

const { MockGameClient, mockConfig } = await import('../src/net/mock.ts');
const { RealGameClient } = await import('../src/net/real.ts');
const { createStore } = await import('../src/state/store.ts');
const P = await import('../src/state/practice.ts');
const { BOTS_NAPPING } = await import('../src/state/notices.ts');
const { isCounting } = await import('../src/state/countdown.ts');
import type { AppState, Store } from '../src/state/store.ts';
import type { Seat, ServerMsg } from '../../shared/protocol.ts';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fresh = () => {
  // a first visit: no device id, no try had
  localStorage.clear();
};
const quick = { chatSeconds: 1.2, callSeconds: 0.6, countdownSeconds: 0.2, timeScale: 0.02, storageKey: null };

/** A guest's store on the mock relay, watching the room. */
async function guest(o: ConstructorParameters<typeof MockGameClient>[0] = {}) {
  const client = new MockGameClient({ ...quick, ...o });
  const store = createStore(client);
  await store.actions.loadConfig();
  await store.actions.loadGuest();
  return { client, store };
}

/** One practice chat to its call: the store with the reveal, or the chat if `call` is 'none'. */
async function playOnce(store: Store, call: boolean | 'none'): Promise<AppState> {
  const seat = store.get().rooms[1]!.seats[2];
  const a = await store.actions.startPractice({ level: 1, skin: seat.skin });
  ok(a.ok, 'the try starts');
  await waitFor(store, (s) => s.chat?.phase === 'chatting' && !isCounting(s.chat), 'the chat open after the countdown');
  store.actions.say('hey, where are you from?');
  await waitFor(store, (s) => s.chat?.phase === 'calling', 'the call', 8000);
  if (call !== 'none') store.actions.call(call);
  return waitFor(store, (s) => s.practice?.phase === 'over', 'the reveal', 6000);
}

console.log('practice chat: the config and the words');
{
  ok(JSON.stringify(mockConfig({}).practice) === '{"perDay":1}', 'the mock relay offers the free try, one a day, like the relay by default');
  ok(mockConfig({ practicePerDay: 0 }).practice === undefined, 'practicePerDay 0: off');
  ok(P.TRY_FREE === 'Start free chat' && P.REVEAL_TITLE === 'That was a bot' && P.SPOTTED === 'You spotted it' && P.FOOLED === 'It fooled you', 'the words of the try and the reveal');
  ok(P.HINT_FREE === "Tap anyone to chat. It's free: no wallet needed" && P.WALLET_LINK === 'I have a NEAR wallet: sign in' && P.PLAY_AGAIN === 'Play again', 'the room hint, the wallet link and Play again');
  ok(P.PRACTICE_USED === "You've had your free chats for today." && P.PRACTICE_CAP === 'The free chats are all gone for today.', 'the lines with no try left: true for one a day and for five');
  const counter = /\b(one|first|1|2|3|4|5)\b|\d+ (left|of)/i;
  ok(![P.HINT_FREE, P.TRY_FREE, P.PRACTICE_USED, P.PRACTICE_CAP, P.PLAY_AGAIN].some((t) => counter.test(t)), 'no "one" or "first" chat, and no counter');
  ok(P.TELEGRAM_URL === 'https://t.me/realsieslol' && P.X_URL === 'https://x.com/realsieslol', 'where to follow: Telegram and X');
  ok(P.refusalLine('practice_used') === P.PRACTICE_USED && P.refusalLine('practice_cap') === P.PRACTICE_CAP && P.refusalLine('bots_unavailable') === BOTS_NAPPING, 'one plain line for used, all gone, and napping bots (the existing words)');
  ok(P.refusalLine('practice_off') === null && P.refusalLine('beta_closed') === null, 'no line when it is simply off, or the beta is over (the app says that)');
  const banned = /\b(bet|bets|betting|stake|staking|odds|wager|pool|market)\b/i;
  ok(![P.TRY_FREE, P.PRACTICE_USED, P.PRACTICE_CAP, P.REVEAL_TITLE, P.SPOTTED, P.FOOLED, P.NO_CALL, P.INVITE, P.HINT_FREE, P.WALLET_LINK, P.PLAY_AGAIN].some((t) => banned.test(t)), 'no banned vocabulary');
  fresh();
  const id = P.deviceId();
  ok(/^[A-Za-z0-9_-]{16,64}$/.test(id) && P.deviceId() === id, 'a device id, made once and kept');
  ok(!P.triedToday(1), 'no try yet');
  P.markTried();
  ok(P.triedToday(1) && !P.triedToday(2), 'one try marked: used at one a day, not at two');
  P.forgetPractice();
  ok(!P.triedToday(1), 'forgotten (QA)');
  // five a day: a try left after one, two, ... four; none after five
  const five = mockConfig({ practicePerDay: 5 });
  ok(P.tryLeft(five) && P.tryLeft(mockConfig({})) && !P.tryLeft(mockConfig({ practicePerDay: 0 })) && !P.tryLeft(undefined), 'a try left on a first visit (on), none when off');
  const left: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    P.markTried();
    left.push(P.tryLeft(five));
  }
  ok(left.join() === 'true,true,true,true,false', 'five a day: tries left after 1 to 4, none after 5 (' + left.join() + ')');
  ok(!P.tryLeft({ ...five, betaClosed: { redirect: 'https://x', reason: 'spend_cap' } } as never), 'none once the beta is over');
  P.forgetPractice();
  P.markTried(Date.now(), true, 5);
  ok(!P.tryLeft(five), 'the relay said used (this network had its tries): none left here either');
  P.forgetPractice();
  // Play again: another open character of the room, never the one just played
  const seat = (i: number, state: 'open' | 'called' = 'open') => ({ index: i, state, skin: { seed: String(i).repeat(64).slice(0, 64), name: 'N' + i } }) as never as Seat;
  const room = [seat(0), seat(1), seat(2, 'called'), seat(3)];
  const picks = new Set(Array.from({ length: 60 }, (_, k) => P.againSeat(room, room[1].skin.seed, () => (k % 10) / 10)?.index));
  ok([...picks].sort().join() === '0,3', 'Play again: another open character, never the one just played or a called one (' + [...picks].join() + ')');
  ok(P.againSeat([room[1]], room[1].skin.seed) === undefined, 'nobody else open: none');
}

console.log('practice chat: a guest tries one, calls human, and the reveal comes at once');
{
  fresh();
  const { client, store } = await guest();
  const st = await store.actions.practiceStatus();
  ok(st.ok, 'first visit: the try is offered');
  const tapped = store.get().rooms[1]!.seats[2].skin;
  const over = await playOnce(store, true);
  const r = over.practice!.result!;
  ok(over.chat?.partner.seed === tapped.seed && over.chat.partner.name === tapped.name, 'the partner wore the look of the character tapped');
  ok(over.chat?.mode === 'free' && over.chat.coins === 0 && over.chat.roundId === 0, 'free, no coins, in no round');
  ok(over.chat!.messages.some((m) => m.from === 'them'), 'the bot talked');
  ok(r.truth === 'bot' && r.myCall === true && r.right === false, 'it was a bot; called human: it fooled the guest');
  ok(!!r.persona && typeof r.persona.age === 'number' && !!r.persona.job, 'the reveal carries the persona card');
  ok(!over.accountId && !over.me && over.status === 'idle', 'still a guest: no account, no player');
  await sleep(20);
  ok(P.triedToday(1), 'this browser had its try today');
  ok((await store.actions.practiceStatus()).reason === 'practice_used', 'asked again: used, without asking the relay');
  P.forgetPractice();
  ok((await store.actions.practiceStatus()).reason === 'practice_used', 'the mock relay knows the device too (its own record forgotten)');
  const again = await store.actions.startPractice({ level: 1, skin: tapped });
  ok(!again.ok && again.reason === 'practice_used' && !store.get().practice, 'a second try is refused: used');
  ok(P.triedToday(1), 'and the browser remembers it again');
  store.actions.endPractice();
  ok(!store.get().practice && !store.get().chat, 'back to the room');
  client.dispose();
}

console.log('practice chat: called bot (spotted), and no call at all');
{
  fresh();
  const a = await guest();
  const spotted = (await playOnce(a.store, false)).practice!.result!;
  ok(spotted.myCall === false && spotted.right === true, 'called bot: you spotted it');
  a.client.dispose();
  fresh();
  const b = await guest();
  const missed = (await playOnce(b.store, 'none')).practice!.result!;
  ok(missed.myCall === null && missed.right === null && !!missed.persona, 'no call in time: the reveal without a verdict, card and all');
  b.client.dispose();
}

console.log('practice chat: five a day, "Play again" from the reveal with another character, then none left');
{
  fresh();
  const { client, store } = await guest({ practicePerDay: 5 });
  const cfg = store.get().config;
  ok(cfg?.practice?.perDay === 5, 'the relay offers five a day');
  let s = await playOnce(store, true);
  ok(P.tryLeft(cfg) && s.practice?.phase === 'over', 'one played: a try left, the reveal on screen');
  const partners = [s.chat!.partner.seed];
  let others = true;
  for (let n = 2; n <= 5; n++) {
    // as app.tsx does it: another open character of the same room, straight from the reveal, no prompt
    const pr = s.practice!;
    const seat = P.againSeat(store.get().rooms[pr.level]!.seats, pr.skin.seed)!;
    const a = await store.actions.startPractice({ level: pr.level, skin: seat.skin });
    if (!a.ok) {
      ok(false, `play again ${n}: refused (${a.reason ?? a.error})`);
      break;
    }
    await waitFor(store, (x) => x.chat?.phase === 'chatting' && x.chat.partner.seed === seat.skin.seed && !isCounting(x.chat), `chat ${n} open`);
    store.actions.say('hi again');
    await waitFor(store, (x) => x.chat?.phase === 'calling', `call ${n}`, 8000);
    store.actions.call(false);
    s = await waitFor(store, (x) => x.practice?.phase === 'over', `reveal ${n}`, 6000);
    others &&= s.chat!.partner.seed !== partners[partners.length - 1];
    partners.push(s.chat!.partner.seed);
    ok(P.tryLeft(cfg) === n < 5, `after ${n}: ${n < 5 ? 'a try left, Play again shows' : 'none left, the reveal as before'}`);
  }
  ok(partners.length === 5 && others, 'each Play again with another character than the one just played');
  const sixth = await store.actions.startPractice({ level: 1, skin: store.get().rooms[1]!.seats[0].skin });
  ok(!sixth.ok && sixth.reason === 'practice_used' && !P.tryLeft(cfg), 'a sixth is refused: used');
  client.dispose();
}

console.log('practice chat: refused when the day is full, the bots nap, or it is off');
{
  fresh();
  const cap = await guest({ practiceCap: true });
  ok((await cap.store.actions.practiceStatus()).reason === 'practice_cap', 'the day is full: practice_cap');
  const r = await cap.store.actions.startPractice({ level: 1, skin: cap.store.get().rooms[1]!.seats[0].skin });
  ok(!r.ok && r.reason === 'practice_cap' && !cap.store.get().practice && !P.triedToday(1), 'a try refused for the cap counts nothing here');
  cap.client.dispose();
  const nap = await guest({ noBots: true });
  ok((await nap.store.actions.practiceStatus()).reason === 'bots_unavailable', 'the bots are napping: no practice chat either');
  nap.client.dispose();
  const off = await guest({ practicePerDay: 0 });
  ok((await off.store.actions.practiceStatus()).reason === 'practice_off', 'off: nothing to offer');
  ok((await off.store.actions.startPractice({ level: 1, skin: off.store.get().rooms[1]!.seats[0].skin })).reason === 'practice_off', 'and nothing starts');
  off.client.dispose();
}

console.log('practice chat: a guest socket takes nothing of the round; a sign-in ends a practice');
{
  fresh();
  const { client, store } = await guest();
  await store.actions.startPractice({ level: 1, skin: store.get().rooms[1]!.seats[1].skin });
  await waitFor(store, (s) => s.chat?.phase === 'chatting', 'chatting');
  client.send({ t: 'pick_seat', level: 1, seatIndex: 0, mode: 'free' });
  const e = await waitFor(store, (s) => !!s.lastError, 'the refusal');
  ok(e.lastError?.code === 'not_in_practice' && !e.search, 'a pick from a practice socket: not_in_practice, no search');
  await store.actions.selectUser('ana.realsies.testnet');
  ok(store.get().welcomed && !store.get().practice && !store.get().chat, 'signed in: the practice is gone, the player is in');
  store.actions.logout();
  client.dispose();
}

console.log('practice chat: the store ends a practice the relay could not start');
{
  fresh();
  let handler: ((m: ServerMsg) => void) | null = null;
  let disconnects = 0;
  const fake = {
    getConfig: async () => mockConfig({}),
    on(h: (m: ServerMsg) => void) {
      handler = h;
      return () => {};
    },
    onStatus: () => () => {},
    disconnect: () => disconnects++,
    practiceStatus: async () => ({ ok: true }),
    startPractice: async () => {},
  } as never;
  const store = createStore(fake);
  await store.actions.loadConfig();
  const skin = { seed: 'ab'.repeat(32), name: 'Pixie44' };
  ok((await store.actions.startPractice({ level: 1, skin })).ok && store.get().practice?.phase === 'on', 'started');
  handler!({ t: 'error', code: 'bots_unavailable', message: 'napping' });
  const s = store.get();
  ok(!s.practice && !s.chat && s.notice?.message === BOTS_NAPPING && disconnects >= 1, 'the bots ran out since the tap: back to the room, the calm note, the socket closed');
  ok(P.triedToday(1), 'this browser counts the try as had (the relay gives it back; asking again finds that out)');
}

console.log('practice chat: the real client (HTTP and socket wiring)');
{
  const calls: { method: string; url: string; body?: string }[] = [];
  let ticketN = 0;
  let over = false;
  const fakeFetch = (async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, statusText: '', text: async () => JSON.stringify(b) });
    if (url.startsWith('http://relay/api/practice?')) return json(200, { ok: true });
    if (url === 'http://relay/api/practice') {
      if (over) return json(404, { error: 'practice_over', code: 'practice_over', message: 'That free chat is over.' });
      return json(200, { guest: 'g-token', ticket: `t${++ticketN}`, expiresAt: Date.now() + 30_000 });
    }
    return json(404, { error: 'not_found', code: 'not_found', message: url });
  }) as unknown as typeof fetch;
  const sockets: FakeWS[] = [];
  class FakeWS {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
      sockets.push(this);
    }
    send(s: string) { this.sent.push(s); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
  }
  const rc = new RealGameClient({ base: 'http://relay', fetchImpl: fakeFetch, WebSocketImpl: FakeWS as unknown as typeof WebSocket, pingMs: 10_000 });
  const got: ServerMsg[] = [];
  rc.on((m) => got.push(m));
  ok((await rc.practiceStatus('device-0000000001')).ok && calls[0].url === 'http://relay/api/practice?device=device-0000000001', 'GET /api/practice?device=');
  await rc.startPractice({ device: 'device-0000000001', seed: 'ab'.repeat(32), level: 2 });
  ok(calls[1].method === 'POST' && JSON.parse(calls[1].body!).seed === 'ab'.repeat(32) && JSON.parse(calls[1].body!).level === 2, 'POST /api/practice with the device, the look and the level');
  ok(sockets[0]?.url === 'ws://relay/ws?practice=t1', 'the socket with the one-time ticket');
  sockets[0].open();
  sockets[0].close();
  await sleep(1150);
  ok(calls[2]?.method === 'POST' && JSON.parse(calls[2].body!).guest === 'g-token' && sockets[1]?.url === 'ws://relay/ws?practice=t2', 'a dropped socket: a new ticket for the same practice');
  sockets[1].open();
  over = true;
  sockets[1].close();
  await sleep(1150);
  ok(got.some((m) => m.t === 'error' && m.code === 'practice_over') && sockets.length === 2, 'the relay forgot it: practice_over, and no more sockets');
  await rc.startPractice({ device: 'device-0000000001', seed: 'ab'.repeat(32), level: 1 }).catch(() => undefined);
  rc.connect('ana.realsies.testnet');
  ok(sockets[sockets.length - 1].url === 'ws://relay/ws?account=ana.realsies.testnet', 'connect() ends a practice: the player socket');
  rc.disconnect();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
