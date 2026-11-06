// The launch page (protocol v1.4): when / shows it, its phases by the clock, the countdown's parts and words,
// times in the visitor's zone and in UTC, the mock relay's launches (?mock=1&launch=) and the coin being set
// (&opens=), and the main entry's choice between the page and the game. Run by mock-flow.test.ts.

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

const L = await import('../src/launch/phase.ts');
const { MockGameClient, mockConfig } = await import('../src/net/mock.ts');
const { createClient, MOCK_BUY_URL } = await import('../src/net/index.ts');
const { clockScale, CELL, GROUP_GAP } = await import('../src/launch/BigClock.tsx');
import type { LaunchConfig, PublicConfig, ServerMsg } from '../../shared/protocol.ts';

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

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 8, 15);
const LAUNCH: LaunchConfig = { auctionStart: T0, auctionEnd: T0 + 24 * H, tokenUrl: 'https://meme.cooking/meme/1', demoUrl: 'https://test.realsies.lol', trailer: '/trailer/realsies-trailer.mp4', poster: '/trailer/poster.png' };
const base = (o: Partial<PublicConfig>): PublicConfig => ({ ...mockConfig(), ...o });

console.log('when / shows the launch page');
{
  ok(!L.launchShown(base({ testMode: false, coinsOpen: false })), 'no launch settings: the game');
  ok(L.launchShown(base({ testMode: false, coinsOpen: false, launch: LAUNCH })), 'mainnet before the coin: the page');
  ok(!L.launchShown(base({ testMode: false, coinsOpen: true, launch: LAUNCH })), 'coins open on a relay without test mode: the game takes over');
  ok(L.launchShown(base({ testMode: true, coinsOpen: true, launch: LAUNCH })), 'a test relay with launch settings: the page (its coins are always open)');
  ok(!L.launchShown(null) && !L.launchShown(undefined), 'no config: the game');
  ok(L.isPlayPath('/play') && L.isPlayPath('/play/') && L.isPlayPath('/PLAY'), '/play is the game');
  ok(!L.isPlayPath('/') && !L.isPlayPath('/players') && !L.isPlayPath('/play/x') && !L.isPlayPath('/agents'), 'nothing else is');
  ok(L.tokenUrlOf(base({ launch: LAUNCH, buyUrl: 'https://rhea.example' })) === LAUNCH.tokenUrl, 'Get REAL: the meme.cooking page first');
  ok(L.tokenUrlOf(base({ launch: { ...LAUNCH, tokenUrl: undefined }, buyUrl: 'https://rhea.example' })) === 'https://rhea.example', 'else the Buy link');
}

console.log('phases by the clock');
{
  ok(L.launchPhase(LAUNCH, T0 - 1) === 'soon', 'before the start: soon');
  ok(L.launchPhase(LAUNCH, T0) === 'auction' && L.launchPhase(LAUNCH, T0 + 24 * H - 1) === 'auction', 'from the start to the end: auction');
  ok(L.launchPhase(LAUNCH, T0 + 24 * H) === 'finalizing' && L.launchPhase(LAUNCH, T0 + 99 * H) === 'finalizing', 'after the end, coins not open: finalizing');
  ok(L.launchPhase(LAUNCH, T0 - 5 * H, true) === 'open' && L.launchPhase(LAUNCH, T0 + 99 * H, true) === 'open', 'coins open: open, whatever the clock says');
  ok(L.launchPhase({ ...LAUNCH, auctionStart: undefined, auctionEnd: undefined }, T0 + 99 * H) === 'soon', 'no date announced: soon');
  ok(L.countdownTarget(LAUNCH, 'soon') === T0 && L.countdownTarget(LAUNCH, 'auction') === T0 + 24 * H && L.countdownTarget(LAUNCH, 'finalizing') === undefined, 'counts down to the start, then the end');
  for (const p of L.MOCK_LAUNCHES) {
    const now = Date.now();
    const m = L.mockLaunch(p, now);
    ok(L.launchPhase(m, now) === p && m.auctionEnd! - m.auctionStart! === 24 * H, `mock launch "${p}" is in that phase, a 24-hour auction`);
  }
  const now = Date.UTC(2026, 10, 6, 9, 41, 20);
  ok(L.mockLaunch('soon', now).auctionStart! % H === 0 && L.mockLaunch('auction', now).auctionStart! % H === 0, 'mock auctions start on the hour');
  const left = L.mockLaunch('soon', now).auctionStart! - now;
  ok(left > 2 * 24 * H && left < 3 * 24 * H, 'soon: opens in two days and some hours');
  const ends = L.mockLaunch('auction', now).auctionEnd! - now;
  ok(ends > 16 * H && ends < 18 * H, 'auction: ends in about 17 hours');
  const ago = now - L.mockLaunch('finalizing', now).auctionEnd!;
  ok(ago >= 5 * 60_000 && ago <= 7 * 60_000, 'finalizing: ended about 6 minutes ago');
  ok(L.mockLaunchOf('?mock=1&launch=auction') === 'auction' && L.mockLaunchOf('?mock=1&launch=nope') === null && L.mockLaunchOf('') === null, '?launch= read');
}

console.log('the countdown');
{
  ok(JSON.stringify(L.countdownParts(1)) === '{"d":0,"h":0,"m":0,"s":1}', 'rounded up: one second shows until the very end');
  ok(JSON.stringify(L.countdownParts(90_061_000)) === '{"d":1,"h":1,"m":1,"s":1}', '1 day 1 hour 1 minute 1 second');
  ok(JSON.stringify(L.countdownParts(-5)) === '{"d":0,"h":0,"m":0,"s":0}', 'never negative');
  const g = L.countdownGroups(L.countdownParts(2 * 24 * H + 5 * H));
  ok(g.map((x) => x.label).join() === 'days,hrs,min,sec', 'days, hours, minutes, seconds');
  ok(L.countdownGroups(L.countdownParts(24 * H + 1000))[0].label === 'day', 'one day');
  ok(L.countdownGroups(L.countdownParts(5 * H)).map((x) => x.label).join() === 'hrs,min,sec', 'no days group on the last day');
  ok(L.spokenLeft(2 * 24 * H + 5 * H + 12 * 60_000 + 5000) === '2 days, 5 hours and 12 minutes', 'read out: ' + L.spokenLeft(2 * 24 * H + 5 * H + 12 * 60_000));
  ok(L.spokenLeft(H) === '1 hour' && L.spokenLeft(45 * 60_000) === '45 minutes' && L.spokenLeft(20_000) === 'under a minute', 'read out, short');
  // the clock fits its card: whole device pixels per sprite pixel, never above the cap
  const artW = 8 * CELL.w + 3 * GROUP_GAP;
  ok(clockScale(artW - 1, 1, 8, 4, 3) === 1, 'too narrow: still one device pixel');
  ok(clockScale(2 * artW, 1, 8, 4, 3) === 2 && clockScale(2 * artW - 1, 1, 8, 4, 3) === 1, 'two CSS px only when they fit');
  ok(clockScale(330, 3, 8, 4, 3) === 3 && clockScale(5000, 2, 8, 4, 3) === 6 && clockScale(5000, 2, 8, 4, 1) === 2, 'phones and the cap: ' + clockScale(330, 3, 8, 4, 3));
}

console.log('times');
{
  ok(L.fmtWhen(T0, { locale: 'en-GB', timeZone: 'UTC' }) === 'Sun 8 Nov, 15:00 UTC', 'British: ' + L.fmtWhen(T0, { locale: 'en-GB', timeZone: 'UTC' }));
  ok(L.fmtWhen(T0, { locale: 'en-US', timeZone: 'America/New_York' }) === 'Sun, Nov 8, 10:00 AM EST', 'American, in their zone: ' + L.fmtWhen(T0, { locale: 'en-US', timeZone: 'America/New_York' }));
  ok(L.fmtUtc(T0, { timeZone: 'Europe/Tallinn' }) === '15:00 UTC' && L.fmtUtc(T0, { timeZone: 'UTC' }) === '', 'UTC beside it, unless that is the zone already');
  ok(L.fmtShort(T0, T0 - 2 * 24 * H, { locale: 'en-GB', timeZone: 'UTC' }) === 'Sun 15:00', 'the button, this week: ' + L.fmtShort(T0, T0 - 2 * 24 * H, { locale: 'en-GB', timeZone: 'UTC' }));
  ok(L.fmtShort(T0, T0 - 9 * 24 * H, { locale: 'en-GB', timeZone: 'UTC' }) === '8 Nov 15:00', 'the button, further out');
  ok(L.pageLocale('en-US') === 'en-US' && L.pageLocale('de-DE') === 'en-GB' && L.pageLocale(undefined) === 'en-GB', 'English in the visitor\'s style, else British');
}

console.log('the mock relay before REAL is live');
{
  const c = createClient('?mock=1&launch=auction');
  const cfg = await c.getConfig();
  ok(c instanceof MockGameClient && cfg.testMode === false && cfg.coinsOpen === false && !!cfg.wallet, 'like a mainnet relay: no test mode, wallet sign-in, no coin yet');
  ok(cfg.buyUrl === MOCK_BUY_URL && cfg.launch?.tokenUrl === 'https://meme.cooking' && cfg.launch?.demoUrl === 'https://test.realsies.lol', 'Get REAL and the demo');
  ok(cfg.launch?.trailer === '/trailer/realsies-trailer.mp4' && cfg.launch?.poster === '/trailer/poster.png' && !!cfg.launch?.xUrl, 'the trailer, the poster and X');
  ok(L.launchShown(cfg) && L.launchPhase(cfg.launch!, Date.now()) === 'auction', 'the page, in the auction');
  (c as InstanceType<typeof MockGameClient>).dispose();
  const plain = createClient('?mock=1') as InstanceType<typeof MockGameClient>;
  ok(!L.launchShown(await plain.getConfig()), '?mock=1 alone: the game as before');
  plain.dispose();

  // the owner sets the coin: coins open, the launch settings go, a connection hears it
  const m = new MockGameClient({ wallet: true, coinsOpen: false, launch: L.mockLaunch('finalizing'), opensAfterMs: 200, storageKey: null });
  const heard: ServerMsg[] = [];
  m.on((x) => heard.push(x));
  ok(L.launchShown(await m.getConfig()), 'finalizing: still the page');
  await sleep(250);
  const after = await m.getConfig();
  ok(after.coinsOpen === true && !after.launch && !L.launchShown(after), 'the coin is set: coins open, no launch settings, the game');
  m.dispose();
  const t = new MockGameClient({ coinsOpen: false, launch: LAUNCH, storageKey: null });
  t.openCoins();
  ok((await t.getConfig()).launch !== undefined, 'a test relay keeps its launch settings');
  t.dispose();
  ok(heard.length === 0, 'nobody connected: nothing pushed');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
