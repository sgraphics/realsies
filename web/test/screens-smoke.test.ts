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
};
const g = globalThis as Record<string, unknown>;
g.document = doc;
g.window = globalThis;
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
}
g.devicePixelRatio = 1;
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
const { EVIDENCE_CHAT_ID } = await import('../src/net/mock/evidence.ts');

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
const client = new MockGameClient({ chatSeconds: 1.5, callSeconds: 1, roundMinutes: 2, timeScale: 0.02, searchMs: [20, 40], storageKey: null, noHuman: true, playFailChance: 0, loadEvidence: fsLoader });
const store = createStore(client);
try {
  await store.actions.loadConfig();
  await store.actions.selectUser('ana.realsies.testnet');
  const roundId = store.get().round!.roundId;
  // one bot chat to verify
  store.actions.pickSeat(1, 0, 'paid', 5);
  for (let i = 0; i < 200 && store.get().chat?.phase !== 'chatting'; i++) await sleep(10);
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

  render(h(VerifyDrawer, { store, chatId, onClose() {} }), root as unknown as Element);
  await sleep(250);
  const t2 = root.textContent;
  ok(/All \d+ checks pass/.test(t2), 'Verify drawer: ' + (t2.match(/All \d+ checks pass[^A-Z]*/)?.[0] ?? t2.slice(0, 160)));
  ok(/Your conversation matches the signed request/.test(t2) && /Game record/.test(t2), 'Verify shows the conversation and tag checks');

  render(h(VerifyDrawer, { store, chatId: EVIDENCE_CHAT_ID, onClose() {} }), root as unknown as Element);
  await sleep(250);
  const t3 = root.textContent;
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
  render(null, root as unknown as Element);
} catch (e) {
  failures++;
  console.log('  FAIL', e);
} finally {
  client.dispose();
  store.actions.logout();
}
ok(errors.length === 0, 'no uncaught errors' + (errors.length ? ': ' + String(errors[0]) : ''));
const banned = /\b(bet|bets|betting|stake|staking|odds|wager|pool|market)\b/i;
for (const f of ['Results.tsx', 'Verify.tsx', 'PastRounds.tsx', 'DevMenu.tsx', 'Terms.tsx', 'Who.tsx', 'Lobby.tsx', 'Chat.tsx', 'Call.tsx', 'SeatDialog.tsx', 'Deposit.tsx']) {
  const src = readFileSync(join(here, '..', 'src', 'screens', f), 'utf8');
  ok(!banned.test(src.replace(/\/\/.*$/gm, '')), `${f}: no banned vocabulary`);
}
console.log(failures ? `${failures} failed` : 'screens smoke passed');
process.exit(failures ? 1 : 0);
