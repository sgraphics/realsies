// Quote cards: one real exchange from a chat as a still, with the question that makes people want to answer.
//
//   npx tsx scripts/quote-card.ts <transcript.json> --lines 12,13 --name <out-name> [--dashboard]
//     <transcript.json>  a chat transcript of the "Bot or human?" clips (variants/bot-or-human/chats/*.json; the
//                        format is in variants/bot-or-human/storyboard.ts)
//     --lines            two to four 1-based positions in its "lines" array, rising (skipped lines count too);
//                        shown in that order as the game's bubbles, word for word
//     --name             the file name: out/promo/<name>.png (1920x1080, X) and <name>-square.png (1080x1080, Telegram)
//     --dashboard        also copies the two into .bl0x/topics/near-hackathon/promo/
//
// The card shows the room of the chat (its theme), the partner and its gamertag, the lines, the logo, "Human or bot?"
// and "Find out at realsies.lol"; never the verdict, the persona or the model (src/scenes/promo/quotecard.ts). It
// refuses a line the pixel font cannot draw, and a card whose lines do not fit at a readable size (bubble text at 7
// output px per font px or more); it writes nothing then.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBuffer } from '../src/art.ts';
import { writeRgbPng } from '../src/engine/png.ts';
import { QuoteCard, QuoteFitError, CARD_SIZES, type CardShape, type QuoteLine, type QuoteOpts } from '../src/scenes/promo/quotecard.ts';
import { BANNED, DRAWABLE, forFont, type Transcript } from '../variants/bot-or-human/storyboard.ts';
import { URL_TEXT } from '../variants/for-realsies/storyboard.ts';
import { THEMES } from '../../shared/protocol.ts';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'out', 'promo');
const DASHBOARD = join(PKG, '..', '.bl0x', 'topics', 'near-hackathon', 'promo');

/** The card's own words. */
const QUOTE_TEXT = { question: 'Human or bot?', cta: 'Find out at', url: URL_TEXT };

const USAGE = 'usage: npx tsx scripts/quote-card.ts <transcript.json> --lines 12,13 --name <out-name> [--dashboard]';
const args = process.argv.slice(2);
const opt = (k: string) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : undefined);
const fail = (why: string): never => {
  console.error(why);
  process.exit(1);
};

const file = args.find((a, i) => !a.startsWith('--') && !['--lines', '--name'].includes(args[i - 1] ?? ''));
const linesArg = opt('lines');
const name = opt('name');
if (!file || !linesArg || !name) fail(USAGE);
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name!)) fail(`--name ${JSON.stringify(name)}: letters, digits, dot, dash and underscore only`);

// ---------------------------------------------------------------- the transcript and the lines

let tr: Transcript;
try {
  tr = JSON.parse(readFileSync(resolve(file!), 'utf8')) as Transcript;
} catch (e) {
  fail(`${file}: ${e instanceof Error ? e.message : String(e)}`);
}
const where = basename(file!);
if (!tr!.partner || typeof tr!.partner.name !== 'string' || !tr!.partner.name.trim() || !/^[0-9a-zA-Z:_-]{4,}$/.test(String(tr!.partner.seed))) fail(`${where}: partner needs a name and a seed`);
if (tr!.theme !== undefined && !THEMES.includes(tr!.theme)) fail(`${where}: theme must be one of ${THEMES.join(', ')}`);
if (!Array.isArray(tr!.lines) || !tr!.lines.length) fail(`${where}: no lines`);
if (!DRAWABLE.test(forFont(tr!.partner.name))) fail(`${where}: the pixel font cannot draw the gamertag ${JSON.stringify(tr!.partner.name)}`);

const picks = linesArg!.split(',').map((s) => s.trim());
if (picks.some((p) => !/^\d+$/.test(p))) fail(`--lines ${JSON.stringify(linesArg)}: comma-separated line numbers, e.g. 12,13`);
const at = picks.map(Number);
if (at.length < 2 || at.length > 4) fail(`--lines: two to four lines, not ${at.length}`);
for (const n of at) if (n < 1 || n > tr!.lines.length) fail(`--lines: ${where} has lines 1 to ${tr!.lines.length}, not ${n}`);
for (let i = 1; i < at.length; i++) if (at[i] <= at[i - 1]) fail(`--lines: in the order they were said (rising), not ${linesArg}`);

const notes: string[] = [];
const lines: QuoteLine[] = at.map((n) => {
  const l = tr!.lines[n - 1];
  if (l.from !== 'me' && l.from !== 'them') fail(`${where} line ${n}: from must be "me" or "them"`);
  if (typeof l.text !== 'string' || !l.text.trim()) fail(`${where} line ${n}: empty`);
  const text = l.text.trim();
  // the same words; only typography the font has no glyph for is drawn in its plain form (’ as ')
  const drawn = forFont(text);
  if (!DRAWABLE.test(drawn)) fail(`${where} line ${n}: the pixel font cannot draw ${JSON.stringify(text)} (${[...new Set([...drawn].filter((ch) => !DRAWABLE.test(ch)))].join(' ')}); choose another line`);
  if (drawn !== text) notes.push(`line ${n} is drawn in the pixel font as ${JSON.stringify(drawn)}`);
  if (BANNED.test(drawn)) notes.push(`line ${n} has a token word: ${JSON.stringify(text)}`);
  return { from: l.from, text: drawn };
});
if (!lines.some((l) => l.from === 'them')) fail('--lines: none of them is the partner\'s; a quote card needs at least one');

// ---------------------------------------------------------------- the two cards

const opts: QuoteOpts = { theme: tr!.theme ?? 'space', partner: { name: forFont(tr!.partner.name), seed: tr!.partner.seed }, lines, ...QUOTE_TEXT };
const shapes: [CardShape, string][] = [['wide', ''], ['square', '-square']];
let cards: [QuoteCard, string][];
try {
  cards = shapes.map(([shape, suffix]) => [new QuoteCard(opts, shape), suffix]);
} catch (e) {
  if (e instanceof QuoteFitError) fail(`${where} lines ${at.join(',')}: ${e.message}`);
  throw e;
}

console.log(`quote card ${name}: ${where} lines ${at.join(', ')}, theme ${opts.theme}, partner ${opts.partner.name}`);
for (const [i, l] of lines.entries()) console.log(`  ${String(at[i]).padStart(2)}  ${l.from === 'me' ? 'ME  ' : 'THEM'}  ${l.text}`);
for (const n of notes) console.log(`  note: ${n}`);
mkdirSync(OUT, { recursive: true });
const written: string[] = [];
for (const [card, suffix] of cards!) {
  const { w, h } = CARD_SIZES[card.shape];
  const b = createBuffer(w, h);
  card.render(b);
  const f = join(OUT, `${name}${suffix}.png`);
  writeRgbPng(f, b);
  written.push(f);
  const bl = card.bubbles;
  console.log(`  ${card.shape} ${w}x${h}, bubble text at ${bl.k} (cap height ${7 * bl.k} px): ${bl.rows.map((r) => r.map((x) => JSON.stringify(x)).join(' / ')).join('  |  ')}`);
  console.log(`wrote ${f}`);
}
if (args.includes('--dashboard')) {
  mkdirSync(DASHBOARD, { recursive: true });
  for (const f of written) copyFileSync(f, join(DASHBOARD, basename(f)));
  console.log(`copied to ${DASHBOARD}`);
}
