// The launch page's logic, without a DOM: when / shows it, its phase by the clock, the countdown's parts,
// times in the visitor's own zone, and the believable launch configs of the mock relay (?mock=1&launch=).

import type { LaunchConfig, PublicConfig } from '../../../shared/protocol.ts';

export type LaunchPhase = 'soon' | 'auction' | 'finalizing' | 'open';
export type MockLaunch = 'soon' | 'auction' | 'finalizing';
export const MOCK_LAUNCHES: MockLaunch[] = ['soon', 'auction', 'finalizing'];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The launch is over: coins are open on a relay without test mode (a test relay always has coins). */
export function launchOver(cfg: PublicConfig): boolean {
  return !cfg.testMode && cfg.coinsOpen === true;
}

/** `/` shows the launch page instead of the game. */
export function launchShown(cfg: PublicConfig | null | undefined): cfg is PublicConfig & { launch: LaunchConfig } {
  return !!cfg?.launch && !launchOver(cfg);
}

/** `/play` (and `/play/`): always the game, so the game can be tried while the launch page is up. */
export function isPlayPath(pathname: string): boolean {
  return /^\/play\/?$/i.test(pathname);
}

/** soon: before the auction; auction: while it runs; finalizing: after it, coins not open yet; open: the game is open. */
export function launchPhase(l: LaunchConfig, now: number, open = false): LaunchPhase {
  if (open) return 'open';
  if (l.auctionStart === undefined || now < l.auctionStart) return 'soon';
  if (l.auctionEnd === undefined || now < l.auctionEnd) return 'auction';
  return 'finalizing';
}

/** The moment the countdown of a phase runs to, if it has one. */
export function countdownTarget(l: LaunchConfig, phase: LaunchPhase): number | undefined {
  return phase === 'soon' ? l.auctionStart : phase === 'auction' ? l.auctionEnd : undefined;
}

/** "Get REAL": the meme.cooking page, else the relay's Buy link. */
export function tokenUrlOf(cfg: PublicConfig): string | undefined {
  return cfg.launch?.tokenUrl ?? cfg.buyUrl;
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
export function fmtUtc(at: number, o: { locale?: string; timeZone?: string } = {}): string {
  const zone = o.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (/^(UTC|Etc\/UTC|Etc\/GMT|GMT|Etc\/Universal|Universal)$/i.test(zone ?? '')) return '';
  const d = new Date(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** Short, for a button: "Sun 16:00" within six days, else "8 Nov 16:00" (the visitor's zone and clock style). */
export function fmtShort(at: number, now: number, o: { locale?: string; timeZone?: string } = {}): string {
  const near = at - now < 6 * DAY && at >= now - DAY;
  const f = new Intl.DateTimeFormat(o.locale ?? pageLocale(), {
    ...(near ? { weekday: 'short' } : { day: 'numeric', month: 'short' }), hour: 'numeric', minute: '2-digit', ...(o.timeZone ? { timeZone: o.timeZone } : {}),
  });
  return f.format(new Date(at)).replace(/ /g, ' ').replace(/,/g, '');
}

/**
 * The mock relay's launch (?mock=1&launch=soon|auction|finalizing), on the hour like the real one:
 * soon opens in two days and some hours, auction ends in about 17 hours, finalizing ended 6 minutes ago.
 */
export function mockLaunch(phase: MockLaunch, now = Date.now()): LaunchConfig {
  const hour = Math.floor(now / HOUR) * HOUR;
  const start = phase === 'soon' ? hour + 2 * DAY + 6 * HOUR : phase === 'auction' ? hour - 7 * HOUR : Math.floor((now - 6 * MIN) / MIN) * MIN - DAY;
  return {
    auctionStart: start,
    auctionEnd: start + DAY,
    tokenUrl: 'https://meme.cooking',
    demoUrl: 'https://test.realsies.lol',
    xUrl: 'https://x.com',
    trailer: '/trailer/realsies-trailer.mp4',
    poster: '/trailer/poster.png',
  };
}

/** ?mock=1&launch=... */
export function mockLaunchOf(search: string): MockLaunch | null {
  const v = new URLSearchParams(search).get('launch');
  return MOCK_LAUNCHES.includes(v as MockLaunch) ? (v as MockLaunch) : null;
}
