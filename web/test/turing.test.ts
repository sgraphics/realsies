// Turing Hour in the room (protocol v1.13): the line's three states from (now, config) alone: from 6 hours before
// the start with a countdown, during the hour, otherwise nothing; times in the visitor's zone, "today" or "tomorrow"
// by the visitor's calendar; never while the launch banner shows; and the mock relay's hours for the QA shots. The
// prize (v1.16): " · 5 NEAR prize" after the line, before and during the hour, its text only from the config.

const T = await import('../src/launch/turing.ts');
const { mockConfig } = await import('../src/net/mock.ts');
const { turingNow } = await import('../../shared/turing.ts');
import type { PublicConfig } from '../../shared/protocol.ts';
import { readFileSync } from 'node:fs';

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
  eq('prize' in soon, false, 'no &prize: no prize');
  const prized = T.mockTuringHour('on', now, '5 NEAR')!;
  eq(prized.prize, '5 NEAR', '&prize: the hour carries the prize text');
  eq(mockConfig({ turingHour: prized }).turingHour?.prize, '5 NEAR', 'and so does the mock config');
}

console.log('the prize (v1.16): after the line, before and during the hour');
{
  const withPrize = (prize: string) => cfg({ turingHour: { startUtc: '20:00', minutes: 60, prize } });
  const soon = T.turingLine(withPrize('5 NEAR'), START - (3 * H + 12 * MIN), BERLIN)!;
  eq(T.lineWords(soon, true), 'Turing Hour in 3 h 12 min · 5 NEAR prize', 'soon, on a phone: the countdown and the prize');
  eq(T.lineWords(soon, false), 'Turing Hour today at 21:00: real people in the room. Starts in 3 h 12 min · 5 NEAR prize', 'soon, wide: the whole line, then the prize');
  eq(soon.short, 'Turing Hour in 3 h 12 min', 'the words stop before the prize');
  ok(soon.prize?.lead === '5 NEAR ' && soon.prize.word === 'prize' && soon.prize.tail === '', 'the word "prize" (the link to the rules) is a part of its own');
  const on = T.turingLine(withPrize('5 NEAR'), START + 20 * MIN, BERLIN)!;
  eq(on.phase, 'on', 'during the hour: on');
  eq(T.lineWords(on, true), 'Turing Hour is on · 5 NEAR prize', 'on, on a phone');
  eq(T.lineWords(on, false), 'Turing Hour is on until 22:00: real people are here now · 5 NEAR prize', 'on, wide');
  eq(T.turingLine(withPrize('5 NEAR'), START + H, UTC), null, 'the hour over: nothing, prize or not');
  eq(T.turingLine(withPrize('5 NEAR'), START - 6 * H - 1, UTC), null, 'more than 6 hours before: nothing');

  // without a prize the line is as it was
  const plain = T.turingLine(cfg(), START - (3 * H + 12 * MIN), BERLIN)!;
  eq(plain.prize, undefined, 'no prize: no prize part');
  eq(T.lineWords(plain, true), 'Turing Hour at 21:00 · starts in 3 h 12 min', 'no prize, soon, on a phone: as before');
  eq(T.lineWords(plain, false), 'Turing Hour today at 21:00: real people in the room. Starts in 3 h 12 min.', 'no prize, soon, wide: as before');
  const plainOn = T.turingLine(cfg(), START + 20 * MIN, BERLIN)!;
  eq(T.lineWords(plainOn, true), 'Turing Hour: real people here until 22:00', 'no prize, on, on a phone: as before');
  eq(T.lineWords(plainOn, false), 'Turing Hour is on until 22:00: real people are here now.', 'no prize, on, wide: as before');
  for (const p of ['', '   ']) eq(T.turingLine(withPrize(p), START, UTC)?.prize, undefined, `prize ${JSON.stringify(p)}: none`);

  // the text is the relay's: any amount, the word never doubled, on a phone what follows the word left out
  eq(T.lineWords(T.turingLine(withPrize('10 NEAR'), START, UTC)!, true), 'Turing Hour is on · 10 NEAR prize', 'another amount: the config\'s');
  eq(T.lineWords(T.turingLine(withPrize('5 NEAR prize'), START, UTC)!, true), 'Turing Hour is on · 5 NEAR prize', 'a text with the word: not doubled');
  const long = T.turingLine(withPrize('5 NEAR prize for the three best callers'), START, UTC)!;
  eq(T.lineWords(long, false), 'Turing Hour is on until 21:00: real people are here now · 5 NEAR prize for the three best callers', 'wide: the whole text');
  eq(T.lineWords(long, true), 'Turing Hour is on · 5 NEAR prize', 'on a phone: up to the word, the rest left out');
  eq(T.lineWords(T.turingLine(withPrize('Prize: 5 NEAR'), START, UTC)!, true), 'Turing Hour is on · Prize: 5 NEAR', 'the word first: nothing left out');
  eq(JSON.stringify(T.prizeParts('  5   NEAR  ')), JSON.stringify({ lead: '5 NEAR ', word: 'prize', tail: '' }), 'spaces tidied');
  eq(JSON.stringify(T.prizeParts('5 NEAR in prizes')), JSON.stringify({ lead: '5 NEAR in ', word: 'prizes', tail: '' }), '"prizes" is the word too');
  eq(T.prizeParts(undefined), null, 'no text: no prize');

  // the launch banner still wins
  const launch = { auctionStart: START - 2 * H, auctionEnd: START + 22 * H };
  const mainnet = cfg({ ...mockConfig({ wallet: true, coinsOpen: false, mainnet: true }), turingHour: { startUtc: '20:00', minutes: 60, prize: '5 NEAR' }, launch });
  eq(T.turingLine(mainnet, START, UTC), null, 'the auction banner is up: no line, no prize');

  // no amount in the web's own code: the prize's words come from the config only (comments may give examples)
  const code = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[^]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const f of ['../src/launch/turing.ts', '../src/ui/TuringBanner.tsx']) ok(!/\bNEAR\b/.test(code(f)), `${f.slice(7)}: no amount of its own`);
}

console.log('the rules page (web/public/prize.html)');
{
  const page = readFileSync(new URL('../public/prize.html', import.meta.url), 'utf8');
  ok(/<title>Turing Hour prize<\/title>/.test(page) && /<h1>Turing Hour prize<\/h1>/.test(page), 'its title');
  ok(!/\b(bet|bets|betting|stake|staking|odds|wager|pool|market)\b/i.test(page), 'no banned vocabulary');
  ok(page.includes('href="/terms.html"') && page.includes('https://x.com/realsieslol') && page.includes('https://t.me/realsieslol'), 'the Terms of Use, X and Telegram linked');
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
