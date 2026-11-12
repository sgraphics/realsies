// Turing Hour in the room (protocol v1.13, PublicConfig.turingHour), without a DOM: one slim line in the launch
// banner's place, from 6 hours before the start ("Turing Hour today at 22:00: real people in the room. Starts in
// 3 h 12 min.") and during the hour ("Turing Hour is on until 23:00: real people are here now."), times in the
// visitor's own zone; otherwise nothing. Never while the launch banner shows: the launch wins. The hour itself is
// worked out in shared/turing.ts, the same arithmetic the relay counts the hour's chats with. With a prize (v1.16,
// turingHour.prize, e.g. "5 NEAR") the line ends in " · 5 NEAR prize" ("Turing Hour in 3 h 12 min · 5 NEAR prize" and
// "Turing Hour is on · 5 NEAR prize" on a phone); the amount is only ever the relay's text.

import type { PublicConfig } from '../../../shared/protocol.ts';
import { turingNow } from '../../../shared/turing.ts';
import { bannerPhase, pageLocale } from './phase.ts';

/** The prize's words (v1.16): before its word "prize", that word (the link to the rules), and what follows it. */
export interface PrizeParts {
  lead: string;
  word: string;
  tail: string;
}

export interface TuringLine {
  phase: 'soon' | 'on';
  /** the hour this line is about (ms epoch); hiding the line is per hour */
  start: number;
  end: number;
  /** the line's own words; with a prize they stop before it (the whole line: lineWords) */
  text: string;
  /** the same in fewer words, for a phone held upright */
  short: string;
  /** v1.16: the prize, after the words and " · " */
  prize?: PrizeParts;
}

/**
 * The prize as the line shows it (PublicConfig.turingHour.prize): "5 NEAR" gets the word after it ("5 NEAR prize"); a
 * text with the word in it ("5 NEAR prize for the best callers") keeps its own. Null: no prize.
 */
export function prizeParts(prize: string | null | undefined): PrizeParts | null {
  const t = prize?.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /\bprizes?\b/i.exec(t);
  return m ? { lead: t.slice(0, m.index), word: m[0], tail: t.slice(m.index + m[0].length) } : { lead: `${t} `, word: 'prize', tail: '' };
}

/** The prize's parts on screen: on a phone what follows the word is left out, unless the word comes first. */
export function prizeShown(p: PrizeParts, narrow: boolean): PrizeParts {
  return narrow && p.lead ? { ...p, tail: '' } : p;
}

/** The whole line as it reads, the prize included: "Turing Hour in 3 h 12 min · 5 NEAR prize" on a phone. */
export function lineWords(line: TuringLine, narrow: boolean): string {
  const words = narrow ? line.short : line.text;
  if (!line.prize) return words;
  const p = prizeShown(line.prize, narrow);
  return `${words} · ${p.lead}${p.word}${p.tail}`;
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
  // v1.16: with a prize the words make room for it (no full stop before " · ", on a phone the fewest words)
  const prize = prizeParts(cfg.turingHour.prize);
  if (w.phase === 'on') {
    const until = fmtClock(w.end, o);
    if (prize) return { phase: 'on', start: w.start, end: w.end, text: `Turing Hour is on until ${until}: real people are here now`, short: 'Turing Hour is on', prize };
    return { phase: 'on', start: w.start, end: w.end, text: `Turing Hour is on until ${until}: real people are here now.`, short: `Turing Hour: real people here until ${until}` };
  }
  const at = fmtClock(w.start, o);
  const day = dayOf(w.start, o.timeZone) === dayOf(now, o.timeZone) ? 'today' : 'tomorrow';
  const left = fmtLeft(w.start - now);
  if (prize) return { phase: 'soon', start: w.start, end: w.end, text: `Turing Hour ${day} at ${at}: real people in the room. Starts in ${left}`, short: `Turing Hour in ${left}`, prize };
  return { phase: 'soon', start: w.start, end: w.end, text: `Turing Hour ${day} at ${at}: real people in the room. Starts in ${left}.`, short: `Turing Hour at ${at} · starts in ${left}` };
}

/**
 * The mock relay's Turing Hour (?mock=1&turing=soon|on): soon starts 3 h 12 min from now (to the minute), on started
 * 20 minutes ago; both an hour long. `prize` (&prize=, v1.16): the prize's text as the relay would send it.
 */
export function mockTuringHour(phase: string | null, now = Date.now(), prize?: string): { startUtc: string; minutes: number; prize?: string } | undefined {
  if (phase !== 'soon' && phase !== 'on') return undefined;
  const start = new Date(Math.floor((phase === 'soon' ? now + (3 * 60 + 12) * 60_000 : now - 20 * 60_000) / 60_000) * 60_000);
  return { startUtc: `${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`, minutes: 60, ...(prize ? { prize } : {}) };
}
