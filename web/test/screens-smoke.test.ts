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
const { KeySetupDialog } = await import('../src/screens/KeySetup.tsx');
const { DepositDialog } = await import('../src/screens/Deposit.tsx');
const { MockWallet } = await import('../src/wallet/mock.ts');
const { LaunchPage } = await import('../src/launch/LaunchPage.tsx');
const { mockLaunch } = await import('../src/launch/phase.ts');
const { LaunchBanner } = await import('../src/ui/LaunchBanner.tsx');

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

  // wallet sign-in (protocol v1.3): the sign-in panel, "Enable coins", the wallet coins dialog
  const wc = new MockGameClient({ wallet: true, storageKey: null, timeScale: 0.02, searchMs: [20, 40], noHuman: true, loadEvidence: fsLoader, buyUrl: 'https://meme.cooking' });
  const ws = createStore(wc, new MockWallet(wc, { accountId: 'sam.testnet', delayMs: 2 }));
  await ws.actions.loadConfig();
  render(h(WalletSignInPanel, { store: ws, ok: true, onNeedConsent() {} }), root as unknown as Element);
  await sleep(20);
  const si = root.textContent;
  ok(/Sign in with a NEAR wallet/.test(si) && /no transaction, no gas/.test(si) && /Get a wallet/.test(si), 'sign-in panel: the button, free to play, get a wallet: ' + si.slice(0, 90));
  await ws.actions.walletSignIn();
  render(h(KeySetupDialog, { store: ws, onDone() {} }), root as unknown as Element);
  await sleep(20);
  const kt = root.textContent;
  ok(/Enable coins/.test(kt) && /sam\.testnet/.test(kt) && /play/.test(kt) && /call/.test(kt) && /0\.25 NEAR/.test(kt) && /never withdraw/.test(kt) && /Approve in wallet/.test(kt), 'enable coins: whose key, what it may do, the allowance, the approval');
  render(h(DepositDialog, { store: ws, gate: false, onDone() {}, onEnableCoins() {} }), root as unknown as Element);
  await sleep(40);
  const dt = root.textContent;
  ok(/Deposit to earn/.test(dt) && /Deposit from wallet/.test(dt) && /Buy tREAL/.test(dt) && /Enable coins/.test(dt) && !/Get 100 test coins/.test(dt), 'wallet deposit: from the wallet, Buy link, enable coins, no faucet without test mode');
  render(null, root as unknown as Element);
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
  render(null, root as unknown as Element);
  soonClient.dispose();
  const cardText = async (o: { tweet?: boolean; x?: boolean }) => {
    const c = new MockGameClient({ wallet: true, coinsOpen: false, launch: mockLaunch('soon', Date.now(), o), storageKey: null, timeScale: 0.02 });
    render(h(LaunchPage, { client: c, config: await c.getConfig(), onLive() {}, pollMs: 60_000 }), root as unknown as Element);
    await sleep(30);
    const t = root.textContent;
    const a = nodes(root).find((n) => String(n.attrs.class ?? n.className).split(' ').includes('ln-teaser'));
    render(null, root as unknown as Element);
    c.dispose();
    return { t, href: a?.attrs.href };
  };
  const acct = await cardText({ tweet: false });
  ok(/Follow @realsieslol on X/.test(acct.t) && acct.href === 'https://x.com/realsieslol' && !/Watch the trailer/.test(acct.t), 'no launch tweet yet: the card opens the account');
  const nox = await cardText({ x: false });
  ok(nox.href === undefined && !/on X/.test(nox.t) && /Get \$REAL/.test(nox.t), 'no X link: no card, the countdown and Get REAL as before');
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
for (const f of ['Countdown.tsx', 'Results.tsx', 'Verify.tsx', 'PastRounds.tsx', 'DevMenu.tsx', 'Terms.tsx', 'Who.tsx', 'Lobby.tsx', 'Chat.tsx', 'Call.tsx', 'SeatDialog.tsx', 'Deposit.tsx', 'SignIn.tsx', 'KeySetup.tsx', 'WalletCoins.tsx']) {
  const src = readFileSync(join(here, '..', 'src', 'screens', f), 'utf8');
  ok(!banned.test(src.replace(/\/\/.*$/gm, '')), `${f}: no banned vocabulary`);
}
for (const f of ['LaunchPage.tsx', 'BigClock.tsx', 'phase.ts', 'index.tsx', '../ui/LaunchBanner.tsx']) {
  const src = readFileSync(join(here, '..', 'src', 'launch', f), 'utf8');
  ok(!banned.test(src.replace(/\/\/.*$/gm, '')), `launch/${f}: no banned vocabulary`);
}
console.log(failures ? `${failures} failed` : 'screens smoke passed');
process.exit(failures ? 1 : 0);
