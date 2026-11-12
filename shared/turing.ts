// Turing Hour (protocol v1.13): one hour a day, at the same UTC time, when real people are promised to be in the
// room. The web shows a line before and during it; the relay posts the hour's counts to Telegram when it ends. Both
// work the hour out here, from the same two settings, so they never disagree about when it is. No imports: the web
// and the relay load this file each in their own way.

const MIN = 60_000;
const DAY = 1440 * MIN;

/** The web's line shows from this long before the start. */
export const TURING_SOON_MS = 6 * 60 * MIN;

/** PublicConfig.turingHour: the start as "HH:MM" in UTC and how long it lasts. */
export interface TuringHourSetting {
  startUtc: string;
  minutes: number;
  /** v1.16: the hour's prize as its line shows it ("5 NEAR"), from TURING_PRIZE; absent: none. Not part of the clock. */
  prize?: string;
}

/** "20:00" -> minutes after midnight UTC; null for anything else ("8:00", "24:00", "20:60", "20:00Z"). */
export function parseHm(v: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The longest hour the settings allow: it ends well before the next day's line would show. */
export const TURING_MAX_MINUTES = 360;

/**
 * Where `now` stands: `on` during the hour (start and end of this one), else `soon` within TURING_SOON_MS of the next
 * start, else `off`; start and end are always the hour that is on or comes next. Null for unusable settings.
 */
export function turingNow(t: TuringHourSetting | null | undefined, now: number): { phase: 'on' | 'soon' | 'off'; start: number; end: number } | null {
  const hm = t ? parseHm(t.startUtc) : null;
  if (!t || hm === null || !(Number.isInteger(t.minutes) && t.minutes >= 1 && t.minutes <= TURING_MAX_MINUTES)) return null;
  const len = t.minutes * MIN;
  const today = Math.floor(now / DAY) * DAY + hm * MIN;
  const last = today <= now ? today : today - DAY;
  if (now < last + len) return { phase: 'on', start: last, end: last + len };
  const next = last + DAY;
  return { phase: next - now <= TURING_SOON_MS ? 'soon' : 'off', start: next, end: next + len };
}

/** The last hour that is over at `now` (its end at or before now), as start and end. Null for unusable settings. */
export function lastTuringHour(t: TuringHourSetting | null | undefined, now: number): { start: number; end: number } | null {
  const w = turingNow(t, now);
  if (!w) return null;
  // during the hour the last one over is yesterday's; otherwise it is the one before the next
  const start = w.start - DAY;
  return { start, end: start + (w.end - w.start) };
}
