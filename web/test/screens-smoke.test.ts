// Smoke render of Results, Verify, PastRounds, the dev menu and Terms against a minimal fake DOM,
// driven by the mock relay. Catches runtime errors in the screens without a browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ---------- minimal DOM ----------
class FNode {
  childNodes: FNode[] = [];
  parentNode: FNode | null = null;
  nodeType: number;
  nodeName: string;
  localName: string;
  data = '';
  attrs: Record<string, string> = {};
  style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {};
  listeners: Record<string, unknown> = {};
  ownerDocument: unknown;
  constructor(type: number, name: string) {
    this.nodeType = type;
    this.nodeName = name.toUpperCase();
    this.localName = name.toLowerCase();
    this.style.setProperty = (k: string, v: string) => {
      this.style[k] = v;
    };
  }
  get firstChild(): FNode | null { return this.childNodes[0] ?? null; }
  get nextSibling(): FNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[i + 1] ?? null;
  }
  appendChild(c: FNode) { return this.insertBefore(c, null); }
  insertBefore(c: FNode, ref: FNode | null) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c: FNode) {
    this.childNodes = this.childNodes.filter((x) => x !== c);
    c.parentNode = null;
    return c;
  }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(k: string, f: unknown) { this.listeners[k] = f; }
  removeEventListener(k: string) { delete this.listeners[k]; }
  get textContent(): string {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.childNodes = [];
    if (v) this.appendChild(doc.createTextNode(v));
  }
  getContext() {
    return { putImageData() {}, drawImage() {}, clearRect() {}, fillRect() {}, createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), imageSmoothingEnabled: false };
  }
  toDataURL() { return 'data:image/png;base64,'; }
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }; }
  querySelector() { return null; }
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  width = 0;
  height = 0;
  className = '';
}
const doc = {
  createElement: (n: string) => {
    const e = new FNode(1, n);
    e.ownerDocument = doc;
    return e;
  },
  createElementNS: (_ns: string, n: string) => doc.createElement(n),
  createTextNode: (t: string) => {
    const e = new FNode(3, '#text');
    e.data = String(t);
    e.ownerDocument = doc;
    return e;
  },
  createComment: () => new FNode(8, '#comment'),
  body: new FNode(1, 'body'),
  title: '',
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
};
const g = globalThis as Record<string, unknown>;
g.document = doc;
g.window = globalThis;
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
}
g.devicePixelRatio = 1;
g.innerWidth = 390;
g.innerHeight = 844;
(doc as Record<string, unknown>).documentElement = doc.createElement('html');
(doc as Record<string, unknown>).querySelector = () => null;
g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
g.requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(Date.now()), 16) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
g.localStorage = new MemStorage();

const { h, render } = await import('preact');
const { MockGameClient } = await import('../src/net/mock.ts');
const { createStore } = await import('../src/state/store.ts');
const { ResultsScreen } = await import('../src/screens/Results.tsx');
const { VerifyDrawer } = await import('../src/screens/Verify.tsx');
const { PastRounds } = await import('../src/screens/PastRounds.tsx');
const { DevMenu } = await import('../src/screens/DevMenu.tsx');
const { TermsScreen } = await import('../src/screens/Terms.tsx');
const consent = await import('../src/state/consent.ts');
const { Countdown, countdownHold } = await import('../src/screens/Countdown.tsx');
const { isCounting } = await import('../src/state/countdown.ts');
const { EVIDENCE_CHAT_ID } = await import('../src/net/mock/evidence.ts');
const { AgentsPage } = await import('../src/agents/AgentsPage.tsx');
const { Dashboard } = await import('../src/agents/Dashboard.tsx');
const { MockBuilderClient } = await import('../src/net/mock/builders.ts');
const { WalletSignInPanel } = await import('../src/screens/SignIn.tsx');
const { LoginModal, CONSENT_LINE } = await import('../src/screens/Login.tsx');
const { Hud } = await import('../src/ui/Hud.tsx');
const { KeySetupDialog, ONE_APPROVAL } = await import('../src/screens/KeySetup.tsx');
const { FIRST_DEPOSIT } = await import('../src/screens/WalletCoins.tsx');
const { SeatDialog } = await import('../src/screens/SeatDialog.tsx');
const { DepositDialog } = await import('../src/screens/Deposit.tsx');
const { MockWallet } = await import('../src/wallet/mock.ts');
const { LaunchPage } = await import('../src/launch/LaunchPage.tsx');
const { mockLaunch } = await import('../src/launch/phase.ts');
const { LaunchBanner } = await import('../src/ui/LaunchBanner.tsx');
const { TestnetPanel } = await import('../src/ui/TestnetPanel.tsx');

const here = dirname(fileURLToPath(import.meta.url));
const EV = join(here, '..', '..', 'experiments', 'near-ai', 'evidence', '2026-11-04');
const fsLoader = async () => ({
  request: readFileSync(join(EV, 'request.json'), 'utf8'),
  response: readFileSync(join(EV, 'response.json'), 'utf8'),
  signature: readFileSync(join(EV, 'signature.json'), 'utf8'),
  attestation: readFileSync(join(EV, 'attestation.json'), 'utf8'),
});

let failures = 0;
const ok = (c: unknown, label: string) => {
  console.log((c ? '  ok   ' : '  FAIL ') + label);
  if (!c) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errors: unknown[] = [];
process.on('uncaughtException', (e) => errors.push(e));

console.log('screens smoke');
const client = new MockGameClient({ chatSeconds: 1.5, callSeconds: 1, countdownSeconds: 0.25, roundMinutes: 2, timeScale: 0.02, searchMs: [20, 40], storageKey: null, noHuman: true, playFailChance: 0, loadEvidence: fsLoader });
const store = createStore(client);
try {
  await store.actions.loadConfig();
  await store.actions.selectUser('ana.realsies.testnet');
  const roundId = store.get().round!.roundId;
  // one bot chat to verify
  store.actions.pickSeat(1, 0, 'paid', 5);
  for (let i = 0; i < 200 && store.get().chat?.phase !== 'chatting'; i++) await sleep(5);
  // the countdown overlay while it runs, then each held beat (the QA screenshots use those)
  const cdRoot = doc.createElement('div');
  const live = store.get().chat!;
  ok(isCounting(live) && live.countdownUntil! > Date.now(), 'chat_started ahead of now: counting');
  const me = { seed: 'b'.repeat(64), label: 'Ana' };
  render(h(Countdown, { theme: live.theme, until: live.countdownUntil!, me, partner: live.partner }), cdRoot as unknown as Element);
  await sleep(10);
  const ct = cdRoot.textContent;
  ok(ct.includes('Chat starts in') && ct.includes('You') && ct.includes(live.partner.name) && ct.includes('Real human?'), 'Countdown renders the VS screen: ' + ct.slice(0, 80));
  const held: string[] = [];
  for (const hold of [3, 2, 1, 0]) {
    render(h(Countdown, { key: 'h' + hold, theme: live.theme, until: live.countdownUntil!, me, partner: live.partner, hold }), cdRoot as unknown as Element);
    await sleep(5);
    const t = cdRoot.textContent;
    held.push(t.includes('Say hi!') ? 'go' : t.includes('Chat starts in ' + hold) ? String(hold) : '?');
  }
  ok(held.join(' ') === '3 2 1 go', 'held beats: ' + held.join(' '));
  ok(countdownHold('?mock=1&as=ana&qa=countdown&cd=go') === 0 && countdownHold('?mock=1&qa=countdown&cd=2') === 2 && countdownHold('?qa=countdown&cd=2') === null, 'QA hold parameter');
  render(null, cdRoot as unknown as Element);
  for (let i = 0; i < 200 && isCounting(store.get().chat); i++) await sleep(5);
  store.actions.say('hello, where are you from?');
  for (let i = 0; i < 300 && store.get().chat?.phase !== 'calling'; i++) await sleep(10);
  store.actions.call(false);
  for (let i = 0; i < 100 && store.get().chat?.phase !== 'called'; i++) await sleep(10);
  const chatId = store.get().chat!.chatId;
  store.actions.clearChat();
  await store.actions.devEndRound();
  for (let i = 0; i < 300 && !store.get().resultsReady.includes(roundId); i++) await sleep(10);

  const root = doc.createElement('div');
  render(h(ResultsScreen, { store, roundId, onVerify() {}, onClose() {}, onDeposit() {} }), root as unknown as Element);
  await sleep(150);
  const t1 = root.textContent;
  ok(/Round \d+ results/.test(t1) && /You called/.test(t1) && /Rating/.test(t1), 'Results renders: ' + t1.slice(0, 90).replace(/\s+/g, ' '));
  ok(/Verify/.test(t1) && /BOT/.test(t1), 'Results shows the bot chat with Verify');

  render(h(ResultsScreen, { store, roundId: roundId - 1, onVerify() {}, onClose() {}, onDeposit() {} }), root as unknown as Element);
  await sleep(150);
  ok(/would have been about \+/.test(root.textContent), 'seeded round shows the free "would have" line');
  ok(/Was playing/.test(root.textContent) && /dramatic extrovert/.test(root.textContent) && /ESFP/.test(root.textContent) && /Lucía/.test(root.textContent) && /hyper/.test(root.textContent), 'seeded round reveals the persona card with name and mood: ' + (root.textContent.match(/Was playing.{0,90}/)?.[0] ?? 'none'));
  const seeded = await store.actions.getResults(roundId - 1);
  const personaChat = seeded.chats.find((c) => c.persona)!;
  render(h(VerifyDrawer, { store, chatId: personaChat.chatId, onClose() {} }), root as unknown as Element);
  await sleep(250);
  ok(/Who you talked to/.test(root.textContent) && /Was playing/.test(root.textContent) && /All \d+ checks pass/.test(root.textContent), 'Verify reveals the persona card above the checks');

  render(h(VerifyDrawer, { store, chatId, onClose() {} }), root as unknown as Element);
  await sleep(250);
  const t2 = root.textContent;
  ok(/All \d+ checks pass/.test(t2), 'Verify drawer: ' + (t2.match(/All \d+ checks pass[^A-Z]*/)?.[0] ?? t2.slice(0, 160)));
  ok(/Your conversation matches the signed request/.test(t2) && /Game record/.test(t2), 'Verify shows the conversation and tag checks');

  render(h(VerifyDrawer, { store, chatId: EVIDENCE_CHAT_ID, onClose() {} }), root as unknown as Element);
  await sleep(250);
  const t3 = root.textContent;
  ok(!/Who you talked to/.test(t3) && !/Was playing/.test(t3), 'no card, nothing extra (the reference evidence)');
  ok(/0x3b753b4406613c5e70ae640508632b600424fa0c/.test(t3) && /All \d+ checks pass/.test(t3), 'Verify renders the real evidence bundle');

  render(h(PastRounds, { store, onOpenResults() {}, onClose() {} }), root as unknown as Element);
  await sleep(150);
  ok(/Past rounds/.test(root.textContent) && /Round \d+/.test(root.textContent), 'Past rounds renders');

  render(h(DevMenu, { store }), root as unknown as Element);
  await sleep(50);
  ok(/End round now/.test(root.textContent) && /Contract/.test(root.textContent), 'Dev menu renders (end round now, contract)');

  render(h(TermsScreen, { onClose() {}, testnet: true }), root as unknown as Element);
  await sleep(30);
  const tt = root.textContent;
  ok(/18 or older/.test(tt) && /transcripts/.test(tt) && /coins/.test(tt) && /token/.test(tt), 'Terms: 18+, coins are the token, public transcripts');
  consent.forgetTerms();
  ok(!consent.termsAccepted(), 'terms not accepted on first entry');
  consent.acceptTerms();
  ok(consent.termsAccepted(), 'terms acceptance remembered');

  // the pages for AI builders, on the mock builder API
  const builders = new MockBuilderClient({ storageKey: null, delayMs: [0, 0] });
  render(h(AgentsPage, { client: builders }), root as unknown as Element);
  await sleep(80);
  const ta = root.textContent;
  ok(/Your agent vs\./.test(ta) && /real people\./.test(ta) && /Earn the Turing bonus/.test(ta) && /20%/.test(ta) && /scorecard/.test(ta), '/agents: headline, money and data');
  ok(/How it works/.test(ta) && /Why it is provable/.test(ta) && /Which models can I enter\?/.test(ta) && /Text only for now/.test(ta) && /Bring your own NEAR AI key/.test(ta) && /anonymised/.test(ta), '/agents: steps, proof and the FAQ');
  ok(/Request access/.test(ta) && /Work email/.test(ta) && /Voice agent vendor/.test(ta) && /NEAR account for payouts/.test(ta) && /builder terms/.test(ta) && /Send request/.test(ta), '/agents: the request form with every field');
  g.sessionStorage = new MemStorage();
  (g.sessionStorage as MemStorage).setItem('realsies:mock:botmaster:token', 'demo');
  render(h(Dashboard, { client: builders }), root as unknown as Element);
  await sleep(250);
  const td = root.textContent;
  ok(/Acme Voice/.test(td) && /Called human/.test(td) && /Turing bonus/.test(td) && /Export JSONL/.test(td), 'dashboard: profile and totals with a stored token: ' + td.slice(0, 80).replace(/\s+/g, ' '));
  ok(/Scorecard by persona/.test(td) && /acme-zed/.test(td) && /By round/.test(td) && /Round 42/.test(td) && /Chats/.test(td) && /vs/.test(td), 'dashboard: by persona, by round and the chats');
  ok(/Your personas/.test(td) && /Pending review/.test(td) && /Request a new persona/.test(td) && /NEAR AI key/.test(td) && /Game credits/.test(td), 'dashboard: personas, persona request and the own-key form');
  (g.sessionStorage as MemStorage).clear();
  render(h(Dashboard, { client: builders, key: 'fresh' }), root as unknown as Element);
  await sleep(50);
  ok(/Paste your botmaster token/.test(root.textContent) && /any token works/.test(root.textContent), 'dashboard without a token: the token screen');
  render(null, root as unknown as Element);

  // wallet sign-in (protocol v1.3): the sign-in panel, the one approval of a first paid play, the coins screen
  const findButton = (n: { childNodes: unknown[]; nodeName?: string; textContent: string; attrs?: Record<string, string> }, text: RegExp): { attrs: Record<string, string> } | null => {
    if (n.nodeName === 'BUTTON' && text.test(n.textContent)) return n as { attrs: Record<string, string> };
    for (const c of n.childNodes as (typeof n)[]) {
      const f = findButton(c, text);
      if (f) return f;
    }
    return null;
  };
  const disabled = (b: { attrs: Record<string, string> } | null) => !!b && b.attrs.disabled !== undefined && b.attrs.disabled !== 'false';
  /** a tap, through preact's own event handler */
  const click = (b: unknown) => {
    const f = (b as { listeners?: Record<string, unknown> } | null)?.listeners?.click;
    if (typeof f === 'function') f.call(b, { type: 'click', target: b, currentTarget: b, preventDefault() {}, stopPropagation() {} });
  };
  const wc = new MockGameClient({ wallet: true, storageKey: null, timeScale: 0.02, searchMs: [20, 40], noHuman: true, loadEvidence: fsLoader, buyUrl: 'https://meme.cooking' });
  const ws = createStore(wc, new MockWallet(wc, { accountId: 'sam.testnet', delayMs: 2 }));
  await ws.actions.loadConfig();
  render(h(WalletSignInPanel, { store: ws }), root as unknown as Element);
  await sleep(20);
  const si = root.textContent;
  ok(/Sign in with a NEAR wallet/.test(si) && /no transaction, no gas/.test(si) && /Get a wallet/.test(si), 'sign-in panel: the button, free to play, get a wallet: ' + si.slice(0, 90));

  // "Before you play" (Login.tsx), the one way in: the terms with one checkbox (compulsory), then the sign-in
  type El = { childNodes: unknown[]; nodeName?: string; textContent: string; attrs: Record<string, string>; listeners?: Record<string, unknown>; checked?: boolean };
  const findEl = (n: El, name: string, text?: RegExp): El | null => {
    if (n.nodeName === name && (!text || text.test(n.textContent))) return n;
    for (const c of n.childNodes as El[]) {
      const f = findEl(c, name, text);
      if (f) return f;
    }
    return null;
  };
  const change = (el: El | null, checked: boolean) => {
    if (!el) return;
    el.checked = checked;
    const f = el.listeners?.change;
    if (typeof f === 'function') f.call(el, { type: 'change', target: el, currentTarget: el });
  };
  consent.forgetTerms();
  let consents = 0;
  render(h(LoginModal, { key: 'first', store: ws, onConsent: () => consents++, onClose() {} }), root as unknown as Element);
  await sleep(20);
  const lt = root.textContent;
  ok(/Before you play/.test(lt) && /a game for entertainment/.test(lt) && /public/.test(lt) && lt.includes(CONSENT_LINE), 'the terms step: the short terms (the Terms list itself) and the one checkbox');
  ok(CONSENT_LINE === "I'm 18 or older, I play at my own risk and I accept the terms", 'the checkbox in those words');
  const full = findEl(root as never, 'A', /Full terms/);
  ok(full?.attrs.href === '/terms.html' && full.attrs.target === '_blank', 'Full terms: /terms.html, in a new tab');
  ok(disabled(findButton(root as never, /^Continue$/)) && !findButton(root as never, /Back|Close|Not now|×/), 'Continue is off until the box is ticked, and there is no way to close it');
  change(findEl(root as never, 'INPUT'), true);
  await sleep(10);
  ok(!disabled(findButton(root as never, /^Continue$/)), 'ticked: Continue is on');
  click(findButton(root as never, /^Continue$/));
  await sleep(30);
  const sst = root.textContent;
  ok(consent.termsAccepted() && consents === 1, 'Continue accepts the terms of this version');
  ok(/Sign in to play/.test(sst) && !!findButton(root as never, /Sign in with a NEAR wallet/) && !/test player/.test(sst) && !!findButton(root as never, /^Back$/), 'then the sign-in; without test mode the wallet only; this step can be left');
  render(null, root as unknown as Element);
  // a signed-in player whose accepted terms are older than this version: the terms step alone
  consent.forgetTerms();
  let again = 0;
  render(h(LoginModal, { key: 'again', store: ws, consentOnly: true, ticked: true, onConsent: () => again++, onClose() {} }), root as unknown as Element);
  await sleep(20);
  click(findButton(root as never, /^Continue$/));
  await sleep(20);
  ok(again === 1 && consent.termsAccepted() && !/Sign in to play/.test(root.textContent), 'the terms again, alone, for a player signed in before this version');
  render(null, root as unknown as Element);

  // a guest watches the room: the current round (public), three rooms of ten open seats, no socket
  const gc = new MockGameClient({ storageKey: null, timeScale: 0.02, buyUrl: 'https://meme.cooking' });
  const gs = createStore(gc, new MockWallet(gc, { accountId: 'gil.testnet', delayMs: 2 }));
  await gs.actions.loadConfig();
  const gr = await gs.actions.loadGuest();
  const rs = gs.get().rooms;
  ok(!!gr && [1, 2, 3].every((L) => rs[L as 1 | 2 | 3]?.seats.length === 10 && rs[L as 1 | 2 | 3]!.seats.every((x) => x.state === 'open' && /^[0-9a-f]{64}$/.test(x.skin.seed))), 'a guest: three rooms of ten open characters for this round');
  ok(!gs.get().accountId && gs.get().status === 'idle' && gs.get().round?.roundId === gr!.roundId, 'no account, no socket, the round clock from the public round');
  gs.actions.enterRoom(2);
  ok(gs.get().level === 2 && gs.get().status === 'idle', 'a guest changes level without a socket');
  gs.actions.enterRoom(1);
  let signIns = 0;
  render(h(Hud, { store: gs, kind: 'lobby', guest: true, onSignIn: () => signIns++ }), root as unknown as Element);
  await sleep(30);
  const ht = root.textContent;
  ok(/Sign in/.test(ht) && !/Results|Rating|Coins|Deposit/.test(ht) && /TESTNET/.test(ht), 'the HUD of a guest: Sign in where the coins and rating are, no results');
  click(findButton(root as never, /Sign in/));
  ok(signIns === 1, 'tapping Sign in opens the prompt');
  render(null, root as unknown as Element);
  // the terms are accepted now: a tap goes straight to the sign-in; on testnet the wallet and the six test players
  render(h(LoginModal, { key: 'testnet', store: gs, onConsent() {}, onClose() {} }), root as unknown as Element);
  for (let i = 0; i < 40 && !/Finn/.test(root.textContent); i++) await sleep(25);
  const gt = root.textContent;
  ok(/Sign in to play/.test(gt) && !!findButton(root as never, /Sign in with a NEAR wallet/) && /Or play as a test player:/.test(gt), 'testnet: the wallet, and the test players from the same prompt');
  ok(['Ana', 'Ben', 'Cleo', 'Dex', 'Eve', 'Finn'].every((n) => !!findButton(root as never, new RegExp('^' + n))), 'the six test players');
  click(findButton(root as never, /^Ben/));
  for (let i = 0; i < 40 && !gs.get().welcomed; i++) await sleep(25);
  ok(gs.get().accountId === 'ben.realsies.testnet' && gs.get().welcomed, 'a test player is one tap');
  render(null, root as unknown as Element);
  gs.actions.logout();
  gc.dispose();
  await ws.actions.walletSignIn();
  render(h(KeySetupDialog, { store: ws, onDone() {} }), root as unknown as Element);
  await sleep(20);
  const kt = root.textContent;
  ok(kt.includes(ONE_APPROVAL) && ONE_APPROVAL === 'One approval in your wallet, then your plays and calls run without popups.', 'the first paid play: one step, in those words');
  ok(!!findButton(root as never, /^\s*Approve$/) && !!findButton(root as never, /^Cancel$/) && !/Enable|NEAR of gas|browser makes/.test(kt), 'one Approve button and Cancel; no "Enable coins", no key facts');
  render(h(DepositDialog, { store: ws, gate: false, onDone() {} }), root as unknown as Element);
  for (let i = 0; i < 40 && !/In your wallet/.test(root.textContent); i++) await sleep(25);
  const dt = root.textContent;
  ok(/Deposit to earn/.test(dt) && !!findButton(root as never, /^\s*Deposit$/) && /Buy tREAL/.test(dt) && /Play free/.test(dt), 'the coins screen without test mode: the deposit row, Buy, Play free');
  ok(dt.includes(FIRST_DEPOSIT) && FIRST_DEPOSIT === 'First deposit: one wallet approval. After that, plays run without popups.', 'one small line about the first approval, under the deposit row');
  ok(!/Enable|Playing coins needs|approval for this browser|1 coin =|registers on|Free mode|test tokens|Airdrop/.test(dt), 'and nothing else: no Enable coins, no rate line, no explanations, no airdrop');
  ok(/Your wallet has no tREAL yet\./.test(dt), 'an empty wallet says so, pointed at Buy');
  render(null, root as unknown as Element);
  // the coins screen on the testnet relay (test mode), by what the wallet holds: empty, short for 20 coins, enough;
  // exactly the mainnet screen, except that an empty wallet is offered the airdrop where mainnet offers Buy
  const tc = new MockGameClient({ storageKey: null, timeScale: 0.02, buyUrl: 'https://meme.cooking' });
  const ts = createStore(tc, new MockWallet(tc, { accountId: 'tess.testnet', delayMs: 2 }));
  await ts.actions.loadConfig();
  await ts.actions.walletSignIn();
  const states: [string, number][] = [['empty', 0], ['short', 3], ['enough', 197]];
  for (const [state, add] of states) {
    if (add) await tc.faucetToWallet(add);
    await ts.actions.refreshWalletInfo();
    ts.actions.resetFlow('walletTx');
    render(h(DepositDialog, { key: state, store: ts, gate: false, onDone() {}, prefill: '20' }), root as unknown as Element);
    await sleep(40);
    const t = root.textContent;
    const dep = findButton(root as never, /^\s*Deposit$/);
    if (state === 'empty') ok(/In your wallet: 0 tREAL/.test(t) && /Your wallet has no tREAL yet\./.test(t) && !!findButton(root as never, /Airdrop 100 tREAL test tokens/) && disabled(dep), 'coins screen, empty wallet: says so, offers the airdrop, the deposit is off');
    if (state === 'short') ok(/In your wallet: 3 tREAL/.test(t) && /Your wallet holds 3 tREAL, enough for 3 coins\./.test(t) && disabled(dep), 'coins screen, 3 in the wallet and 20 typed: enough for 3 coins, the deposit is off');
    if (state === 'enough') ok(/In your wallet: 200 tREAL/.test(t) && !/no tREAL yet|enough for/.test(t) && !!dep && !disabled(dep), 'coins screen, 200 in the wallet: the deposit is on');
    ok(t.includes(FIRST_DEPOSIT) && !/test coins in the game|to test deposits|Get 100|Enable|Buy tREAL/.test(t) && (state === 'empty' || !/Airdrop/.test(t)), `coins screen (${state}): as on mainnet, no test buttons, no Buy on testnet`);
  }
  ok(await ts.actions.walletDeposit(20), 'the first deposit (the play key in the same approval)');
  render(h(DepositDialog, { key: 'keyed', store: ts, gate: false, onDone() {} }), root as unknown as Element);
  await sleep(40);
  const kd = root.textContent;
  ok(!kd.includes(FIRST_DEPOSIT) && /In the game: 20 coins/.test(kd) && /In your wallet: 180 tREAL/.test(kd) && !!findButton(root as never, /^Withdraw$/), 'with the key: the line is gone; the game balance, the wallet, withdraw');
  render(null, root as unknown as Element);
  ts.actions.logout();
  tc.dispose();

  // a first paid play without a play key in this browser: picking the coins opens the one approval, with the pick
  const kc = new MockGameClient({ storageKey: null, timeScale: 0.02, searchMs: [20, 40], noHuman: true, loadEvidence: fsLoader });
  const ks = createStore(kc, new MockWallet(kc, { accountId: 'kim.testnet', delayMs: 2 }));
  await ks.actions.loadConfig();
  await ks.actions.walletSignIn();
  await kc.faucet('kim.testnet', 30); // coins in the game that came without a wallet transaction in this browser
  await ks.actions.refreshMe();
  ks.actions.enterRoom(1);
  for (let i = 0; i < 40 && !ks.get().rooms[1]; i++) await sleep(25);
  const kseat = ks.get().rooms[1]!.seats.find((x) => x.state === 'open')!;
  const needs: number[] = [];
  render(h(SeatDialog, { store: ks, level: 1, seat: kseat, theme: 'castle', onClose() {}, onDeposit() {}, onNeedKey: (coins: number) => needs.push(coins) }), root as unknown as Element);
  await sleep(30);
  click(findButton(root as never, /^\s*5\$/));
  await sleep(20);
  ok(needs.join() === '5' && !ks.get().search, 'a paid pick without a key: the one approval opens with that pick, nothing sent yet');
  render(null, root as unknown as Element);
  ks.actions.logout();
  kc.dispose();

  // the TESTNET panel (protocol v1.6): testnet only, in the room, and only while the player holds nothing at all
  const panelOf = async (store: typeof ts, kind: 'lobby' | 'chat' | 'call' = 'lobby') => {
    render(h(TestnetPanel, { key: kind + Math.random(), store, kind }), root as unknown as Element);
    await sleep(30);
    return root.textContent;
  };
  const pc = new MockGameClient({ storageKey: null, timeScale: 0.02, buyUrl: 'https://meme.cooking' });
  const pw = createStore(pc, new MockWallet(pc, { accountId: 'pam.testnet', delayMs: 2 }));
  await pw.actions.loadConfig();
  await pw.actions.walletSignIn();
  await pw.actions.refreshAirdrop();
  const before = await panelOf(pw);
  ok(/TESTNET/.test(before) && /free test tokens, no real money/.test(before) && !!findButton(root as never, /Airdrop 100 tREAL test tokens/) && /No further action needed\./.test(before) && !/game balance/.test(before), 'panel, a wallet player holding nothing: TESTNET, free test tokens, one big button, no further action needed');
  ok(!/[×]/.test(before) && !findButton(root as never, /^OK$|Fold|Hide|Airdrop again/), 'no other buttons');
  ok((await panelOf(pw, 'chat')) === '' && (await panelOf(pw, 'call')) === '', 'never in a chat or a call');
  ok(await pw.actions.airdrop(), 'the airdrop in one tap');
  ok((await panelOf(pw)) === '', 'tokens in the wallet: the panel is gone');
  ok(pw.get().notice?.message === '100 tREAL are in your wallet. Tap your coins to deposit, then play.', 'a short note says where they landed');
  await pw.actions.signOut();
  // a test player: the airdrop goes straight into the game balance, and the panel says so
  await pw.actions.selectUser('ben.realsies.testnet');
  await pw.actions.refreshAirdrop();
  const tb = await panelOf(pw);
  ok(/Straight into your game balance\. No further action needed\./.test(tb) && !!findButton(root as never, /Airdrop 100 tREAL test tokens/), 'panel, a test player holding nothing: straight into the game balance');
  ok(await pw.actions.airdrop() && pw.get().me!.balanceCoins >= 100, '100 in the game balance (with any locked Turing bonus)');
  ok((await panelOf(pw)) === '' && pw.get().notice?.message === '100 tREAL are in your game balance. Tap a character to play.', 'coins in the game: the panel is gone, the note says so');
  // Ana holds 120 and Finn 15: no panel; Dex holds nothing but had one 3 minutes ago: the wait, no button
  await pw.actions.selectUser('ana.realsies.testnet');
  await pw.actions.refreshAirdrop();
  ok((await panelOf(pw)) === '', '120 held: no panel');
  await pw.actions.selectUser('finn.realsies.testnet');
  await pw.actions.refreshAirdrop();
  ok((await panelOf(pw)) === '', '15 held: no panel');
  pc.setAirdropAt('dex.realsies.testnet', Date.now() - 3 * 60_000);
  await pw.actions.selectUser('dex.realsies.testnet');
  await pw.actions.refreshAirdrop();
  const wt = await panelOf(pw);
  ok(/TESTNET/.test(wt) && /The next one opens in 7 min\./.test(wt) && !findButton(root as never, /Airdrop|Try again/), 'nothing held, one 3 minutes ago: when the next one opens, no button');
  // the test player's coins screen: the airdrop while the game holds nothing
  await pw.actions.selectUser('ben.realsies.testnet');
  await pw.actions.refreshAirdrop();
  render(h(DepositDialog, { key: 'ben', store: pw, gate: false, onDone() {} }), root as unknown as Element);
  await sleep(40);
  const bt = root.textContent;
  ok(!/Get 100 test coins/.test(bt) && !/Airdrop 100/.test(bt) && /Your coins/.test(bt) && !!findButton(root as never, /^Withdraw$/), 'a test player holding 100: the balance and withdraw, no airdrop');
  render(null, root as unknown as Element);
  await pw.actions.selectUser('dex.realsies.testnet');
  pc.setAirdropAt('dex.realsies.testnet', null);
  render(h(DepositDialog, { key: 'dex', store: pw, gate: false, onDone() {} }), root as unknown as Element);
  await sleep(60);
  ok(!!findButton(root as never, /Airdrop 100 tREAL test tokens/) && /In the game: 0 coins/.test(root.textContent) && !/Free mode|Turing bonus too/.test(root.textContent), 'a test player with nothing: the balance and the airdrop, nothing else');
  render(null, root as unknown as Element);
  pw.actions.logout();
  pc.dispose();
  // not on mainnet, not without test mode
  const mc = new MockGameClient({ wallet: true, mainnet: true, storageKey: null, timeScale: 0.02, buyUrl: 'https://meme.cooking' });
  const ms = createStore(mc, new MockWallet(mc, { accountId: 'sam.testnet', delayMs: 2 }));
  await ms.actions.loadConfig();
  await ms.actions.walletSignIn();
  ok((await panelOf(ms)) === '' && (await ms.actions.refreshAirdrop()) === null, 'mainnet: no panel, no airdrop');
  render(h(DepositDialog, { store: ms, gate: false, onDone() {} }), root as unknown as Element);
  for (let i = 0; i < 40 && !/In your wallet/.test(root.textContent); i++) await sleep(25);
  const mt = root.textContent;
  ok(/Your wallet has no REAL yet\./.test(mt) && /Buy REAL/.test(mt) && mt.includes(FIRST_DEPOSIT) && !/Airdrop|test tokens|Enable/.test(mt), 'the mainnet coins screen: Buy REAL, the first-deposit line, no airdrop');
  render(null, root as unknown as Element);
  ms.actions.logout();
  mc.dispose();
  ws.actions.logout();
  wc.dispose();
  const closedClient = new MockGameClient({ wallet: true, coinsOpen: false, storageKey: null, timeScale: 0.02, buyUrl: 'https://meme.cooking' });
  const cs = createStore(closedClient, new MockWallet(closedClient, { accountId: 'sam.testnet', delayMs: 2 }));
  await cs.actions.loadConfig();
  await cs.actions.walletSignIn();
  render(h(DepositDialog, { store: cs, gate: false, onDone() {} }), root as unknown as Element);
  await sleep(40);
  const ct2 = root.textContent;
  ok(/Coins open when \$REAL launches/.test(ct2) && /Get \$REAL at the launch/.test(ct2) && /everyone plays free/.test(ct2) && /Play free/.test(ct2) && !/Deposit from wallet/.test(ct2), 'no coin yet: free play only, no deposit form');
  render(null, root as unknown as Element);
  cs.actions.logout();
  closedClient.dispose();

  // the launch (protocol v1.4): the coming-soon page, minimal; the time instead of Get REAL without a token page;
  // the moment it goes live (CHAT!, then the game in place); then the banner in the game, phase by phase
  const soonClient = new MockGameClient({ wallet: true, coinsOpen: false, launch: mockLaunch('soon'), buyUrl: 'https://meme.cooking', storageKey: null, timeScale: 0.02 });
  let handed = 0;
  render(h(LaunchPage, { client: soonClient, config: await soonClient.getConfig(), onLive: () => handed++, pollMs: 20 }), root as unknown as Element);
  await sleep(60);
  const st = root.textContent;
  ok(/Real or not\?/.test(st) && /The game and \$REAL go live in/.test(st) && /days/.test(st) && /hrs/.test(st) && /Get \$REAL/.test(st) && /18\+/.test(st) && /Terms/.test(st), 'coming soon: the headline, the countdown, Get REAL, 18+ and terms: ' + st.slice(0, 90));
  ok(!/Try the demo|demo|For AI builders|Play coins|Chat two minutes|provable|enclave/i.test(st), 'and nothing else: no demo, AI builders, steps or proof');
  ok(!/wallet|Sign in/i.test(st) && handed === 0, 'no wallet prompt; still waiting for the start');
  // the video card: one link to the launch tweet, in a new tab; the teaser loop under it
  const nodes = (n: FNode, out: FNode[] = []): FNode[] => {
    out.push(n);
    for (const c of n.childNodes) nodes(c, out);
    return out;
  };
  const card = nodes(root).find((n) => String(n.attrs.class ?? n.className).split(' ').includes('ln-teaser'));
  const vid = card && nodes(card).find((n) => n.localName === 'video');
  ok(/Watch the trailer on X/.test(st) && card?.attrs.href === mockLaunch('soon').videoUrl && card?.attrs.target === '_blank' && card?.attrs.rel === 'noopener', 'the video card opens the launch tweet in a new tab, rel noopener: ' + card?.attrs.href);
  ok(vid?.attrs.src === '/launch-teaser.mp4' && vid?.attrs.poster === '/launch-teaser.png' && vid?.attrs.preload === 'metadata', 'the teaser and its poster, preload metadata');
  // the footer: a small row of links, Telegram · X · Terms; Telegram and X (the account) in a new tab
  const footOf = () => {
    const nav = nodes(root).find((n) => String(n.attrs.class ?? n.className).split(' ').includes('ln-links'));
    return nav ? nodes(nav).filter((n) => n.localName === 'a' || n.localName === 'button') : [];
  };
  const fl = footOf();
  ok(
    fl.map((n) => n.textContent).join(' · ') === 'Telegram · X · Terms' && fl[0].attrs.href === 'https://t.me/realsieslol' && fl[1].attrs.href === 'https://x.com/realsieslol' &&
      fl.slice(0, 2).every((n) => n.attrs.target === '_blank' && n.attrs.rel === 'noopener') && fl[2].localName === 'button',
    'the footer: Telegram · X · Terms, Telegram and X in a new tab: ' + fl.map((n) => `${n.textContent} ${n.attrs.href ?? ''}`).join(' · '),
  );
  render(null, root as unknown as Element);
  soonClient.dispose();
  const cardText = async (o: { tweet?: boolean; x?: boolean; telegram?: boolean }) => {
    const c = new MockGameClient({ wallet: true, coinsOpen: false, launch: mockLaunch('soon', Date.now(), o), storageKey: null, timeScale: 0.02 });
    render(h(LaunchPage, { client: c, config: await c.getConfig(), onLive() {}, pollMs: 60_000 }), root as unknown as Element);
    await sleep(30);
    const t = root.textContent;
    const a = nodes(root).find((n) => String(n.attrs.class ?? n.className).split(' ').includes('ln-teaser'));
    const foot = footOf().map((n) => n.textContent).join(' · ');
    render(null, root as unknown as Element);
    c.dispose();
    return { t, href: a?.attrs.href, foot };
  };
  const acct = await cardText({ tweet: false });
  ok(/Follow @realsieslol on X/.test(acct.t) && acct.href === 'https://x.com/realsieslol' && !/Watch the trailer/.test(acct.t) && acct.foot === 'Telegram · X · Terms', 'no launch tweet yet: the card opens the account');
  const nox = await cardText({ x: false });
  ok(nox.href === undefined && !/on X/.test(nox.t) && /Get \$REAL/.test(nox.t) && nox.foot === 'Telegram · Terms', 'no X link: no card and no X in the footer, the countdown and Get REAL as before: ' + nox.foot);
  const bare = await cardText({ x: false, telegram: false });
  ok(bare.foot === 'Terms' && /18\+/.test(bare.t), 'no X and no Telegram: 18+ and Terms alone: ' + bare.foot);
  const noToken = new MockGameClient({ wallet: true, coinsOpen: false, launch: mockLaunch('soon', Date.now(), { token: false }), storageKey: null, timeScale: 0.02 });
  render(h(LaunchPage, { client: noToken, config: await noToken.getConfig(), onLive() {}, pollMs: 60_000 }), root as unknown as Element);
  await sleep(40);
  const nt = root.textContent;
  ok(!/Get \$REAL/.test(nt) && /\d{1,2}:\d\d/.test(nt) && /The game and \$REAL go live in/.test(nt), 'no token page yet: the time instead of Get REAL: ' + (nt.match(/[A-Z][a-z]{2}[^]*?UTC|\d{1,2}:\d\d[^]{0,12}/)?.[0] ?? ''));
  render(null, root as unknown as Element);
  noToken.dispose();
  const goClient = new MockGameClient({ wallet: true, coinsOpen: false, launch: mockLaunch('soon', Date.now(), { startInMs: 150 }), storageKey: null, timeScale: 0.02 });
  let went = 0;
  render(h(LaunchPage, { client: goClient, config: await goClient.getConfig(), onLive: () => went++, pollMs: 60_000 }), root as unknown as Element);
  await sleep(40);
  ok(/The game and \$REAL go live in/.test(root.textContent) && went === 0, 'counting down to the start');
  await sleep(500);
  ok(/The game is open/.test(root.textContent) && went === 0, 'zero: "The game is open" and CHAT!, the page still up');
  ok(!/on X/.test(root.textContent), 'the video card is the coming-soon phase only');
  await sleep(1800);
  ok(went === 1, 'then it hands over to the game in place (no reload)');
  render(null, root as unknown as Element);
  goClient.dispose();

  const bannerText = async (o: { phase?: 'soon' | 'auction' | 'finalizing'; testMode?: boolean; chat?: boolean; open?: boolean }) => {
    const bc = new MockGameClient({ wallet: !o.testMode, coinsOpen: false, ...(o.phase ? { launch: mockLaunch(o.phase) } : {}), buyUrl: 'https://meme.cooking', storageKey: null, timeScale: 0.02 });
    if (o.open) bc.openCoins();
    const bs = createStore(bc);
    await bs.actions.loadConfig();
    render(h(LaunchBanner, { store: bs, chat: o.chat }), root as unknown as Element);
    await sleep(20);
    const t = root.textContent;
    render(null, root as unknown as Element);
    bc.dispose();
    return t;
  };
  const ba = await bannerText({ phase: 'auction' });
  ok(/\$REAL auction (is )?live/.test(ba) && /\d\d:\d\d/.test(ba) && /Get \$REAL/.test(ba), 'the game during the auction: "REAL auction is live, ends in hh:mm, Get REAL": ' + ba);
  const bf = await bannerText({ phase: 'finalizing' });
  ok(/\$REAL is finalizing/.test(bf) && /coins open soon/.test(bf) && !/Get \$REAL/.test(bf), 'after it: "REAL is finalizing, coins open soon": ' + bf);
  ok((await bannerText({ phase: 'soon' })) === '', 'before the start (the game at /play): no banner');
  ok((await bannerText({ phase: 'auction', open: true })) === '', 'coins open: the banner is gone');
  ok((await bannerText({ phase: 'auction', testMode: true })) === '', 'the testnet demo: never');
  ok((await bannerText({})) === '', 'no launch: no banner');
  g.innerWidth = 390;
  ok((await bannerText({ phase: 'auction', chat: true })) === '', 'in a chat on a phone it steps aside (the chat input keeps its room)');
  g.innerWidth = 1280;
  ok(/REAL auction is live/.test(await bannerText({ phase: 'auction', chat: true })), 'in a chat on a wide screen it stays');
  g.innerWidth = 390;
} catch (e) {
  failures++;
  console.log('  FAIL', e);
} finally {
  client.dispose();
  store.actions.logout();
}
ok(errors.length === 0, 'no uncaught errors' + (errors.length ? ': ' + String(errors[0]) : ''));
const banned = /\b(bet|bets|betting|stake|staking|odds|wager|pool|market)\b/i;
for (const f of ['Countdown.tsx', 'Results.tsx', 'Verify.tsx', 'PastRounds.tsx', 'DevMenu.tsx', 'Terms.tsx', 'Login.tsx', 'Lobby.tsx', 'Chat.tsx', 'Call.tsx', 'SeatDialog.tsx', 'Deposit.tsx', 'SignIn.tsx', 'KeySetup.tsx', 'WalletCoins.tsx']) {
  const src = readFileSync(join(here, '..', 'src', 'screens', f), 'utf8');
  ok(!banned.test(src.replace(/\/\/.*$/gm, '')), `${f}: no banned vocabulary`);
}
for (const f of ['LaunchPage.tsx', 'BigClock.tsx', 'phase.ts', 'index.tsx', '../ui/LaunchBanner.tsx', '../ui/TestnetPanel.tsx', '../state/airdrop.ts']) {
  const src = readFileSync(join(here, '..', 'src', 'launch', f), 'utf8');
  ok(!banned.test(src.replace(/\/\/.*$/gm, '')), `launch/${f}: no banned vocabulary`);
}
console.log(failures ? `${failures} failed` : 'screens smoke passed');
process.exit(failures ? 1 : 0);
