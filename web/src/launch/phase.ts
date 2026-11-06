// The launch's logic, without a DOM. REAL's meme.cooking auction and the mainnet game open at the same moment:
// before it `/` is the coming-soon page (a countdown and Get REAL), from it `/` is the game with a banner while the
// auction runs and after it until coins open. Also the countdown's parts and words, times in the visitor's zone,
// and the mock relay's believable launches (?mock=1&launch=soon|auction|finalizing).

import type { LaunchConfig, PublicConfig } from '../../../shared/protocol.ts';

export type LaunchPhase = 'soon' | 'auction' | 'finalizing' | 'open';
export type MockLaunch = 'soon' | 'auction' | 'finalizing';
export const MOCK_LAUNCHES: MockLaunch[] = ['soon', 'auction', 'finalizing'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The launch applies: a relay without test mode sends it, and coins are not open yet (the testnet demo never). */
export function launchActive(cfg: PublicConfig | null | undefined): cfg is PublicConfig & { launch: LaunchConfig } {
  return !!cfg?.launch && !cfg.testMode && cfg.coinsOpen !== true;
}

/** `/` is the coming-soon page: the launch applies and its moment has not come (or has no date yet). */
export function comingSoon(cfg: PublicConfig | null | undefined, now: number): boolean {
  return launchActive(cfg) && (cfg.launch.auctionStart === undefined || now < cfg.launch.auctionStart);
}

/** `/play` (and `/play/`): always the game, so it can be tried before the start. */
export function isPlayPath(pathname: string): boolean {
  return /^\/play\/?$/i.test(pathname);
}

/** soon: before the start; auction: while it runs; finalizing: after it, coins not open yet; open: coins are open. */
export function launchPhase(l: LaunchConfig, now: number, open = false): LaunchPhase {
  if (open) return 'open';
  if (l.auctionStart === undefined || now < l.auctionStart) return 'soon';
  if (l.auctionEnd === undefined || now < l.auctionEnd) return 'auction';
  return 'finalizing';
}

/** The banner in the game: during the auction and after it until coins open; nothing before the start or after. */
export function bannerPhase(cfg: PublicConfig | null | undefined, now: number): 'auction' | 'finalizing' | null {
  if (!launchActive(cfg)) return null;
  const p = launchPhase(cfg.launch, now);
  return p === 'auction' || p === 'finalizing' ? p : null;
}

/** "Get REAL": the meme.cooking page, else the relay's Buy link. */
export function tokenUrlOf(cfg: PublicConfig | null | undefined): string | undefined {
  return cfg?.launch?.tokenUrl ?? cfg?.buyUrl;
}

/** The video card on the coming-soon page: where it opens and what it says. */
export interface TeaserLink {
  href: string;
  /** the launch tweet (true) or, until there is one, the account */
  tweet: boolean;
  caption: string;
}

/** The account's handle from its X link ("https://x.com/realsieslol" -> "realsieslol"), or null. */
export function xHandle(url: string): string | null {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg && /^[A-Za-z0-9_]{1,15}$/.test(seg) ? seg : null;
  } catch {
    return null;
  }
}

/** The launch tweet ("Watch the trailer on X"), else the account ("Follow @realsieslol on X"), else no card. */
export function teaserOf(l: LaunchConfig | null | undefined): TeaserLink | null {
  if (l?.videoUrl) return { href: l.videoUrl, tweet: true, caption: 'Watch the trailer on X' };
  if (l?.xUrl) {
    const h = xHandle(l.xUrl);
    return { href: l.xUrl, tweet: false, caption: h ? `Follow @${h} on X` : 'Follow us on X' };
  }
  return null;
}

export interface Parts {
  d: number;
  h: number;
  m: number;
  s: number;
}

/** Whole days, hours, minutes and seconds left, rounded up so 00:00:01 shows until the very end. */
export function countdownParts(ms: number): Parts {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return { d: Math.floor(t / 86_400), h: Math.floor(t / 3600) % 24, m: Math.floor(t / 60) % 60, s: t % 60 };
}

/** The clock's groups: days only while there are any. */
export function countdownGroups(p: Parts): { v: number; label: string; long: string }[] {
  const g = [
    { v: p.h, label: 'hrs', long: 'hours' },
    { v: p.m, label: 'min', long: 'minutes' },
    { v: p.s, label: 'sec', long: 'seconds' },
  ];
  return p.d > 0 ? [{ v: p.d, label: p.d === 1 ? 'day' : 'days', long: 'days' }, ...g] : g;
}

/** "2 days, 5 hours and 12 minutes" for screen readers (minutes only; it is not read every second). */
export function spokenLeft(ms: number): string {
  if (ms < 60_000) return 'under a minute';
  const p = countdownParts(ms);
  const n = (v: number, w: string) => `${v} ${w}${v === 1 ? '' : 's'}`;
  const xs = [p.d ? n(p.d, 'day') : '', p.h ? n(p.h, 'hour') : '', p.m || (!p.d && !p.h) ? n(p.m, 'minute') : ''].filter(Boolean);
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
}

/** "16:48" (hours and minutes, rounded up to the minute so it never says 00:00 while time is left). */
export function fmtHm(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / MIN));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** English formatting in the visitor's own way when the browser speaks English, else British English. */
export function pageLocale(lang: string | undefined = (globalThis as { navigator?: Navigator }).navigator?.language): string {
  return lang && /^en\b/i.test(lang) ? lang : 'en-GB';
}

/** "Sun 8 Nov, 16:00 CET" in the visitor's zone (or the zone given, for tests). */
export function fmtWhen(at: number, o: { locale?: string; timeZone?: string } = {}): string {
  const f = new Intl.DateTimeFormat(o.locale ?? pageLocale(), {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(o.timeZone ? { timeZone: o.timeZone } : {}),
  });
  return f.format(new Date(at)).replace(/ /g, ' ');
}

/** "15:00 UTC", or nothing when the visitor's own zone is UTC already. */
export function fmtUtc(at: number, o: { timeZone?: string } = {}): string {
  const zone = o.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (/^(UTC|Etc\/UTC|Etc\/GMT|GMT|Etc\/Universal|Universal)$/i.test(zone ?? '')) return '';
  const d = new Date(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** The mock's X links: the account the owner named, and a stand-in for the launch tweet. */
export const MOCK_X_URL = 'https://x.com/realsieslol';
export const MOCK_VIDEO_URL = 'https://x.com/realsieslol/status/1';

/**
 * The mock relay's launch (?mock=1&launch=soon|auction|finalizing), on the hour like the real one: soon opens in
 * two days and some hours (or `startInMs` from now: QA of the moment it goes live), auction ends in about 17 hours,
 * finalizing ended 6 minutes ago. `token: false`: no meme.cooking page yet; `tweet: false`: no launch tweet yet
 * (the card goes to the account); `x: false`: no X link at all (no card).
 */
export function mockLaunch(phase: MockLaunch, now = Date.now(), o: { startInMs?: number; token?: boolean; tweet?: boolean; x?: boolean } = {}): LaunchConfig {
  const hour = Math.floor(now / HOUR) * HOUR;
  const start =
    phase === 'soon' ? (o.startInMs !== undefined ? now + o.startInMs : hour + 2 * DAY + 6 * HOUR)
    : phase === 'auction' ? hour - 7 * HOUR
    : Math.floor((now - 6 * MIN) / MIN) * MIN - DAY;
  const x = o.x !== false;
  return {
    auctionStart: start,
    auctionEnd: start + DAY,
    ...(o.token === false ? {} : { tokenUrl: 'https://meme.cooking' }),
    ...(x && o.tweet !== false ? { videoUrl: MOCK_VIDEO_URL } : {}),
    ...(x ? { xUrl: MOCK_X_URL } : {}),
  };
}

/** ?mock=1&launch=... */
export function mockLaunchOf(search: string): MockLaunch | null {
  const v = new URLSearchParams(search).get('launch');
  return MOCK_LAUNCHES.includes(v as MockLaunch) ? (v as MockLaunch) : null;
}
