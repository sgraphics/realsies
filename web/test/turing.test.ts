// Turing Hour in the room (protocol v1.13): the line's three states from (now, config) alone: from 6 hours before
// the start with a countdown, during the hour, otherwise nothing; times in the visitor's zone, "today" or "tomorrow"
// by the visitor's calendar; never while the launch banner shows; and the mock relay's hours for the QA shots.

const T = await import('../src/launch/turing.ts');
const { mockConfig } = await import('../src/net/mock.ts');
const { turingNow } = await import('../../shared/turing.ts');
import type { PublicConfig } from '../../shared/protocol.ts';

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
function eq(a: unknown, b: unknown, label: string): void {
  ok(a === b, a === b ? label : `${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const MIN = 60_000;
const H = 60 * MIN;
const START = Date.UTC(2026, 10, 10, 20); // 20:00 UTC
const cfg = (o: Partial<PublicConfig> = {}): PublicConfig => ({ ...mockConfig({}), turingHour: { startUtc: '20:00', minutes: 60 }, ...o });
const BERLIN = { locale: 'en-GB', timeZone: 'Europe/Berlin' }; // 20:00 UTC is 21:00 there in November
const UTC = { locale: 'en-GB', timeZone: 'UTC' };

console.log('the three states');
{
  const soon = T.turingLine(cfg(), START - (3 * H + 12 * MIN), BERLIN);
  eq(soon?.phase, 'soon', '3 h 12 min before: soon');
  eq(soon?.text, 'Turing Hour today at 21:00: real people in the room. Starts in 3 h 12 min.', 'soon: the time in the visitor\'s zone and the countdown');
  eq(soon?.short, 'Turing Hour at 21:00 · starts in 3 h 12 min', 'soon, on a phone: fewer words');
  eq(T.turingLine(cfg(), START - 6 * H, UTC)?.text, 'Turing Hour today at 20:00: real people in the room. Starts in 6 h.', 'exactly 6 hours before: shown');
  eq(T.turingLine(cfg(), START - 6 * H - 1, UTC), null, 'earlier: nothing');
  eq(T.turingLine(cfg(), START - 30_000, UTC)?.text, 'Turing Hour today at 20:00: real people in the room. Starts in 1 min.', 'half a minute to go: 1 min, never 0');
  eq(T.turingLine(cfg(), START - 59 * MIN - 30_000, UTC)?.text.endsWith('Starts in 1 h.'), true, '59.5 min: rounded up to 1 h');

  const on = T.turingLine(cfg(), START, BERLIN);
  eq(on?.phase, 'on', 'at the start: on');
  eq(on?.text, 'Turing Hour is on until 22:00: real people are here now.', 'on: until the end, in the visitor\'s zone');
  eq(on?.short, 'Turing Hour: real people here until 22:00', 'on, on a phone');
  eq(T.turingLine(cfg(), START + H - 1, UTC)?.phase, 'on', 'the last moment: still on');
  eq(T.turingLine(cfg(), START + H, UTC), null, 'at the end: nothing');
  eq(T.turingLine(cfg(), START + 3 * H, UTC), null, 'three hours on: nothing');
  ok(T.turingLine(cfg(), START + 18 * H, UTC)?.phase === 'soon', 'the next day\'s hour 6 hours before: soon again');
}

console.log('the visitor\'s day and clock');
{
  // 20:00 UTC is 05:00 the next morning in Tokyo: at 01:00 Tokyo time it is "today", at 23:30 the evening before "tomorrow"
  const tokyo = { locale: 'en-GB', timeZone: 'Asia/Tokyo' };
  eq(T.turingLine(cfg(), START - 4 * H, tokyo)?.text, 'Turing Hour today at 5:00: real people in the room. Starts in 4 h.', 'after midnight there: today');
  eq(T.turingLine(cfg(), START - 5.5 * H, tokyo)?.text, 'Turing Hour tomorrow at 5:00: real people in the room. Starts in 5 h 30 min.', 'before midnight there: tomorrow');
  const us = T.turingLine(cfg(), START - H, { locale: 'en-US', timeZone: 'Europe/Berlin' })?.text ?? '';
  ok(/^Turing Hour today at 0?9:00\s?PM: /i.test(us), `an American English browser: its own clock style (${us})`);
  eq(T.fmtLeft(3 * H + 12 * MIN), '3 h 12 min', 'fmtLeft: hours and minutes');
  eq(T.fmtLeft(2 * H), '2 h', 'fmtLeft: whole hours');
  eq(T.fmtLeft(12 * MIN - 1), '12 min', 'fmtLeft: rounded up');
}

console.log('nothing without the setting, never with the launch banner');
{
  eq(T.turingLine(mockConfig({}), START, UTC), null, 'no turingHour: nothing');
  eq(T.turingLine(null, START, UTC), null, 'no config: nothing');
  const launch = { auctionStart: START - 2 * H, auctionEnd: START + 22 * H };
  const mainnet = (o: Partial<PublicConfig>) => cfg({ ...mockConfig({ wallet: true, coinsOpen: false, mainnet: true }), turingHour: { startUtc: '20:00', minutes: 60 }, ...o });
  eq(T.turingLine(mainnet({ launch }), START, UTC), null, 'the auction banner is up: the launch wins');
  eq(T.turingLine(mainnet({ launch, coinsOpen: true }), START, UTC)?.phase, 'on', 'coins open, the launch banner gone: Turing Hour shows');
  eq(T.turingLine(mainnet({ launch: { ...launch, auctionStart: START + H, auctionEnd: START + 25 * H } }), START, UTC)?.phase, 'on', 'before the auction starts (no banner in the game yet): Turing Hour shows');
}

console.log('the mock relay\'s hours (QA: &turing=soon|on)');
{
  const now = Date.UTC(2026, 10, 10, 9, 41, 27);
  const soon = T.mockTuringHour('soon', now)!;
  eq(soon.startUtc, '12:53', 'soon: 3 h 12 min from now, to the minute');
  eq(T.turingLine(cfg({ turingHour: soon }), now, UTC)?.text, 'Turing Hour today at 12:53: real people in the room. Starts in 3 h 12 min.', 'soon: the QA shot\'s words');
  const on = T.mockTuringHour('on', now)!;
  eq(turingNow(on, now)?.phase, 'on', 'on: started 20 minutes ago');
  eq(T.mockTuringHour(null, now), undefined, 'no &turing: no hour');
  eq(mockConfig({ turingHour: soon }).turingHour?.startUtc, '12:53', 'mockConfig carries it');
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
