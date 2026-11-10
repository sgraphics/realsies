// Turing Hour in the room (protocol v1.13, PublicConfig.turingHour), without a DOM: one slim line in the launch
// banner's place, from 6 hours before the start ("Turing Hour today at 22:00: real people in the room. Starts in
// 3 h 12 min.") and during the hour ("Turing Hour is on until 23:00: real people are here now."), times in the
// visitor's own zone; otherwise nothing. Never while the launch banner shows: the launch wins. The hour itself is
// worked out in shared/turing.ts, the same arithmetic the relay counts the hour's chats with.

import type { PublicConfig } from '../../../shared/protocol.ts';
import { turingNow } from '../../../shared/turing.ts';
import { bannerPhase, pageLocale } from './phase.ts';

export interface TuringLine {
  phase: 'soon' | 'on';
  /** the hour this line is about (ms epoch); hiding the line is per hour */
  start: number;
  end: number;
  text: string;
  /** the same in fewer words, for a phone held upright */
  short: string;
}

/** "3 h 12 min", "3 h", "12 min": rounded up to the minute, so it never says 0 min while time is left. */
export function fmtLeft(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}

/** "22:00" (or "10:00 PM" where the visitor's English says so) in the visitor's zone, or the zone given (tests). */
export function fmtClock(at: number, o: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(o.locale ?? pageLocale(), { hour: 'numeric', minute: '2-digit', ...(o.timeZone ? { timeZone: o.timeZone } : {}) }).format(new Date(at));
}

/** The visitor's calendar day of a moment, to say "today" or "tomorrow" right across midnight. */
function dayOf(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(at));
}

/** The line at `now`, or null: no Turing Hour, more than 6 hours to go, or the launch banner is up. */
export function turingLine(cfg: PublicConfig | null | undefined, now: number, o: { locale?: string; timeZone?: string } = {}): TuringLine | null {
  if (!cfg?.turingHour || bannerPhase(cfg, now)) return null;
  const w = turingNow(cfg.turingHour, now);
  if (!w || w.phase === 'off') return null;
  if (w.phase === 'on') {
    const until = fmtClock(w.end, o);
    return { phase: 'on', start: w.start, end: w.end, text: `Turing Hour is on until ${until}: real people are here now.`, short: `Turing Hour: real people here until ${until}` };
  }
  const at = fmtClock(w.start, o);
  const day = dayOf(w.start, o.timeZone) === dayOf(now, o.timeZone) ? 'today' : 'tomorrow';
  const left = fmtLeft(w.start - now);
  return { phase: 'soon', start: w.start, end: w.end, text: `Turing Hour ${day} at ${at}: real people in the room. Starts in ${left}.`, short: `Turing Hour at ${at} · starts in ${left}` };
}

/**
 * The mock relay's Turing Hour (?mock=1&turing=soon|on): soon starts 3 h 12 min from now (to the minute), on started
 * 20 minutes ago; both an hour long.
 */
export function mockTuringHour(phase: string | null, now = Date.now()): { startUtc: string; minutes: number } | undefined {
  if (phase !== 'soon' && phase !== 'on') return undefined;
  const start = new Date(Math.floor((phase === 'soon' ? now + (3 * 60 + 12) * 60_000 : now - 20 * 60_000) / 60_000) * 60_000);
  return { startUtc: `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`, minutes: 60 };
}
