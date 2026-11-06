// The launch (protocol v1.4): when / is the coming-soon page and when the game, the phases by the clock and the
// game's banner, the countdown's parts and words, times in the visitor's zone and in UTC, and the mock relay's
// launches (?mock=1&launch=, &startin=, &notoken=, &opens=). Run by mock-flow.test.ts.

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
const { clockScale, clockRows, CELL, GROUP_GAP } = await import('../src/launch/BigClock.tsx');
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
const LAUNCH: LaunchConfig = { auctionStart: T0, auctionEnd: T0 + 24 * H, tokenUrl: 'https://meme.cooking/meme/1' };
const mainnet = (o: Partial<PublicConfig>): PublicConfig => ({ ...mockConfig({ wallet: true, coinsOpen: false }), ...o });

console.log('the coming-soon page or the game');
{
  ok(L.comingSoon(mainnet({ launch: LAUNCH }), T0 - 1), 'before the start: the coming-soon page');
  ok(!L.comingSoon(mainnet({ launch: LAUNCH }), T0) && !L.comingSoon(mainnet({ launch: LAUNCH }), T0 + 30 * H), 'from the start: the game');
  ok(L.comingSoon(mainnet({ launch: { tokenUrl: LAUNCH.tokenUrl } }), T0 + 99 * H), 'no date yet: coming soon');
  ok(!L.comingSoon(mainnet({}), T0 - 1), 'no launch settings: the game');
  ok(!L.comingSoon(mainnet({ launch: LAUNCH, coinsOpen: true }), T0 - 1), 'coins open: the game, whatever the clock says');
  ok(!L.comingSoon(mockConfig({ coinsOpen: false, launch: LAUNCH }), T0 - 1) && !L.launchActive(mockConfig({ launch: LAUNCH })), 'a test relay: never, even if it sends launch settings');
  ok(!L.comingSoon(null, T0) && !L.launchActive(undefined), 'no config: the game');
  ok(L.isPlayPath('/play') && L.isPlayPath('/play/') && L.isPlayPath('/PLAY'), '/play is the game');
  ok(!L.isPlayPath('/') && !L.isPlayPath('/players') && !L.isPlayPath('/play/x') && !L.isPlayPath('/agents'), 'nothing else is');
  ok(L.tokenUrlOf(mainnet({ launch: LAUNCH, buyUrl: 'https://rhea.example' })) === LAUNCH.tokenUrl, 'Get REAL: the meme.cooking page first');
  ok(L.tokenUrlOf(mainnet({ launch: {}, buyUrl: 'https://rhea.example' })) === 'https://rhea.example' && L.tokenUrlOf(mainnet({ launch: {} })) === undefined, 'else the Buy link, else none');
}

console.log('phases and the banner in the game');
{
  ok(L.launchPhase(LAUNCH, T0 - 1) === 'soon' && L.launchPhase(LAUNCH, T0) === 'auction' && L.launchPhase(LAUNCH, T0 + 24 * H) === 'finalizing', 'soon, auction, finalizing by the clock');
  ok(L.launchPhase(LAUNCH, T0 + 5 * H, true) === 'open', 'coins open: open');
  const cfg = mainnet({ launch: LAUNCH });
  ok(L.bannerPhase(cfg, T0 - 1) === null, 'before the start: no banner (the game at /play has none)');
  ok(L.bannerPhase(cfg, T0) === 'auction' && L.bannerPhase(cfg, T0 + 24 * H - 1) === 'auction', 'during the auction: the auction banner');
  ok(L.bannerPhase(cfg, T0 + 24 * H) === 'finalizing' && L.bannerPhase(cfg, T0 + 99 * H) === 'finalizing', 'after it, coins not open: coins open soon');
  ok(L.bannerPhase(mainnet({ launch: LAUNCH, coinsOpen: true }), T0 + 30 * H) === null && L.bannerPhase(mainnet({}), T0 + 1) === null, 'coins open, or no launch: no banner');
  ok(L.bannerPhase(mockConfig({ coinsOpen: false, launch: LAUNCH }), T0 + 1) === null, 'the testnet demo: never');
  ok(L.fmtHm(16 * H + 48 * 60_000) === '16:48' && L.fmtHm(16 * H + 47 * 60_000 + 1) === '16:48' && L.fmtHm(30_000) === '00:01' && L.fmtHm(-5) === '00:00', 'ends in hh:mm, rounded up to the minute');
  for (const p of L.MOCK_LAUNCHES) {
    const now = Date.now();
    const m = L.mockLaunch(p, now);
    ok(L.launchPhase(m, now) === p && m.auctionEnd! - m.auctionStart! === 24 * H && m.tokenUrl === 'https://meme.cooking', `mock launch "${p}" is in that phase, a 24-hour auction`);
  }
  const now = Date.UTC(2026, 10, 6, 9, 41, 20);
  ok(L.mockLaunch('soon', now).auctionStart! % H === 0 && L.mockLaunch('auction', now).auctionStart! % H === 0, 'mock auctions start on the hour');
  const left = L.mockLaunch('soon', now).auctionStart! - now;
  ok(left > 2 * 24 * H && left < 3 * 24 * H, 'soon: opens in two days and some hours');
  ok(L.mockLaunch('soon', now, { startInMs: 3000 }).auctionStart === now + 3000, 'soon, &startin=3: goes live 3 s in');
  ok(!('tokenUrl' in L.mockLaunch('soon', now, { token: false })), '&notoken=1: no token page');
  const ends = L.mockLaunch('auction', now).auctionEnd! - now;
  ok(ends > 16 * H && ends < 18 * H, 'auction: ends in about 17 hours');
  const ago = now - L.mockLaunch('finalizing', now).auctionEnd!;
  ok(ago >= 5 * 60_000 && ago <= 7 * 60_000, 'finalizing: ended about 6 minutes ago');
  ok(L.mockLaunchOf('?mock=1&launch=auction') === 'auction' && L.mockLaunchOf('?mock=1&launch=nope') === null && L.mockLaunchOf('') === null, '?launch= read');
}

console.log('the video card');
{
  ok(L.xHandle('https://x.com/realsieslol') === 'realsieslol' && L.xHandle('https://x.com/realsieslol/status/1') === 'realsieslol' && L.xHandle('https://x.com') === null && L.xHandle('nope') === null, 'the handle from an X link');
  const tweet = L.teaserOf({ ...LAUNCH, videoUrl: 'https://x.com/realsieslol/status/9', xUrl: 'https://x.com/realsieslol' });
  ok(tweet?.href === 'https://x.com/realsieslol/status/9' && tweet.tweet && tweet.caption === 'Watch the trailer on X', 'the launch tweet first: "Watch the trailer on X"');
  const account = L.teaserOf({ ...LAUNCH, xUrl: 'https://x.com/realsieslol' });
  ok(account?.href === 'https://x.com/realsieslol' && !account.tweet && account.caption === 'Follow @realsieslol on X', 'until then the account: ' + account?.caption);
  ok(L.teaserOf({ ...LAUNCH, xUrl: 'https://twitter.com' })?.caption === 'Follow us on X', 'an account link without a handle');
  ok(L.teaserOf(LAUNCH) === null && L.teaserOf(undefined) === null, 'neither: no card');
  const m = L.mockLaunch('soon', T0);
  ok(m.videoUrl === L.MOCK_VIDEO_URL && m.xUrl === L.MOCK_X_URL && L.MOCK_X_URL === 'https://x.com/realsieslol', 'the mock: the tweet and the account');
  ok(!('videoUrl' in L.mockLaunch('soon', T0, { tweet: false })) && L.mockLaunch('soon', T0, { tweet: false }).xUrl === L.MOCK_X_URL, '&tweet=0: the account only');
  const none = L.mockLaunch('soon', T0, { x: false });
  ok(!('videoUrl' in none) && !('xUrl' in none), '&nox=1: no X link');
}

console.log('the countdown');
{
  ok(JSON.stringify(L.countdownParts(1)) === '{"d":0,"h":0,"m":0,"s":1}', 'rounded up: one second shows until the very end');
  ok(JSON.stringify(L.countdownParts(90_061_000)) === '{"d":1,"h":1,"m":1,"s":1}', '1 day 1 hour 1 minute 1 second');
  ok(JSON.stringify(L.countdownParts(-5)) === '{"d":0,"h":0,"m":0,"s":0}', 'never negative');
  ok(L.countdownGroups(L.countdownParts(2 * 24 * H + 5 * H)).map((x) => x.label).join() === 'days,hrs,min,sec', 'days, hours, minutes, seconds');
  ok(L.countdownGroups(L.countdownParts(24 * H + 1000))[0].label === 'day', 'one day');
  ok(L.countdownGroups(L.countdownParts(5 * H)).map((x) => x.label).join() === 'hrs,min,sec', 'no days group on the last day');
  ok(L.spokenLeft(2 * 24 * H + 5 * H + 12 * 60_000 + 5000) === '2 days, 5 hours and 12 minutes', 'read out: ' + L.spokenLeft(2 * 24 * H + 5 * H + 12 * 60_000));
  ok(L.spokenLeft(H) === '1 hour' && L.spokenLeft(45 * 60_000) === '45 minutes' && L.spokenLeft(20_000) === 'under a minute', 'read out, short');
  // the clock fits its box: whole device pixels per sprite pixel, never above the cap; two rows on narrow screens
  const artW = 8 * CELL.w + 3 * GROUP_GAP;
  ok(clockScale(artW - 1, 1, 8, 4, 3) === 1, 'too narrow: still one device pixel');
  ok(clockScale(2 * artW, 1, 8, 4, 3) === 2 && clockScale(2 * artW - 1, 1, 8, 4, 3) === 1, 'two CSS px only when they fit');
  ok(clockScale(5000, 2, 8, 4, 3) === 6 && clockScale(5000, 2, 8, 4, 1) === 2, 'the cap');
  ok(clockRows(4, 358) === 2 && clockRows(4, 600) === 1 && clockRows(3, 358) === 1 && clockRows(4, 0) === 1, 'two rows of two groups on a phone held upright, while there are days');
  ok(clockScale(358, 3, 4, 2, 4) >= 2 * clockScale(358, 3, 8, 4, 4), 'and the digits at least twice as big there: ' + clockScale(358, 3, 4, 2, 4) + ' vs ' + clockScale(358, 3, 8, 4, 4));
}

console.log('times');
{
  ok(L.fmtWhen(T0, { locale: 'en-GB', timeZone: 'UTC' }) === 'Sun 8 Nov, 15:00 UTC', 'British: ' + L.fmtWhen(T0, { locale: 'en-GB', timeZone: 'UTC' }));
  ok(L.fmtWhen(T0, { locale: 'en-US', timeZone: 'America/New_York' }) === 'Sun, Nov 8, 10:00 AM EST', 'American, in their zone: ' + L.fmtWhen(T0, { locale: 'en-US', timeZone: 'America/New_York' }));
  ok(L.fmtUtc(T0, { timeZone: 'Europe/Tallinn' }) === '15:00 UTC' && L.fmtUtc(T0, { timeZone: 'UTC' }) === '', 'UTC beside it, unless that is the zone already');
  ok(L.pageLocale('en-US') === 'en-US' && L.pageLocale('de-DE') === 'en-GB' && L.pageLocale(undefined) === 'en-GB', 'English in the visitor\'s style, else British');
}

console.log('the mock relay before REAL is live');
{
  const c = createClient('?mock=1&launch=soon') as InstanceType<typeof MockGameClient>;
  const cfg = await c.getConfig();
  ok(cfg.testMode === false && cfg.coinsOpen === false && !!cfg.wallet && cfg.buyUrl === MOCK_BUY_URL, 'like a mainnet relay: no test mode, wallet sign-in, no coin yet, a Buy link');
  ok(L.comingSoon(cfg, Date.now()) && cfg.launch?.tokenUrl === 'https://meme.cooking', 'soon: the coming-soon page with Get REAL');
  c.dispose();
  const a = createClient('?mock=1&launch=auction') as InstanceType<typeof MockGameClient>;
  const ac = await a.getConfig();
  ok(!L.comingSoon(ac, Date.now()) && L.bannerPhase(ac, Date.now()) === 'auction', 'auction: the game, with the auction banner');
  a.dispose();
  const f = createClient('?mock=1&launch=finalizing') as InstanceType<typeof MockGameClient>;
  ok(L.bannerPhase(await f.getConfig(), Date.now()) === 'finalizing', 'finalizing: the game, coins open soon');
  f.dispose();
  const n = createClient('?mock=1&launch=soon&notoken=1') as InstanceType<typeof MockGameClient>;
  const nc = await n.getConfig();
  ok(L.tokenUrlOf(nc) === undefined && L.comingSoon(nc, Date.now()), '&notoken=1: no token page and no Buy link');
  n.dispose();
  const tw = createClient('?mock=1&launch=soon') as InstanceType<typeof MockGameClient>;
  const acc = createClient('?mock=1&launch=soon&tweet=0') as InstanceType<typeof MockGameClient>;
  const nx = createClient('?mock=1&launch=soon&nox=1') as InstanceType<typeof MockGameClient>;
  ok(L.teaserOf((await tw.getConfig()).launch)?.tweet === true && L.teaserOf((await acc.getConfig()).launch)?.tweet === false && L.teaserOf((await nx.getConfig()).launch) === null, 'soon: the card to the tweet; &tweet=0 to the account; &nox=1 none');
  tw.dispose();
  acc.dispose();
  nx.dispose();
  const g = createClient('?mock=1&launch=soon&startin=2') as InstanceType<typeof MockGameClient>;
  const gc = await g.getConfig();
  ok(L.comingSoon(gc, Date.now()) && !L.comingSoon(gc, Date.now() + 2500), '&startin=2: the game 2 s in');
  g.dispose();
  const plain = createClient('?mock=1') as InstanceType<typeof MockGameClient>;
  const pc = await plain.getConfig();
  ok(!L.comingSoon(pc, Date.now()) && L.bannerPhase(pc, Date.now()) === null, '?mock=1 alone: the game as before, no banner');
  plain.dispose();

  // the owner sets the coin: coins open, the launch settings go (the banner with them), a connection hears it
  const m = new MockGameClient({ wallet: true, coinsOpen: false, launch: L.mockLaunch('finalizing'), opensAfterMs: 200, storageKey: null });
  const heard: ServerMsg[] = [];
  m.on((x) => heard.push(x));
  ok(L.bannerPhase(await m.getConfig(), Date.now()) === 'finalizing', 'finalizing: the banner');
  await sleep(250);
  const after = await m.getConfig();
  ok(after.coinsOpen === true && !after.launch && L.bannerPhase(after, Date.now()) === null, 'the coin is set: coins open, no launch settings, no banner');
  m.dispose();
  ok(heard.length === 0, 'nobody connected: nothing pushed');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
