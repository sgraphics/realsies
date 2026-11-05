// The language of a player's line, detected in the relay before a brain hears it (player_message.lang),
// and whether a persona can read it.
//
// Conservative by design: a line is called foreign only when it is clearly written in one language that
// is not English, so short or sloppy English chat (slang, typos, loanwords, famous phrases) is never
// flagged. Anything unsure returns undefined and the bot answers as usual; the persona prompt still says
// which languages the character reads (src/persona/prompt.ts).
//
//   other scripts  Cyrillic, Greek, Arabic, Hebrew, Indic, Thai, Hangul, kana, Han and more: enough letters
//                  of one script, most of the line -> that script's language
//   Latin script   word lists (src/bot/lexicon.ts): known foreign function words must make up a good part
//                  of the line, at least two different ones plus enough evidence (letters such as õ, ß, ñ
//                  count a little), with at most a quarter of the words English and a clear lead over the
//                  next language; well-known phrases (c'est la vie) and tourist words (hola, ciao) say nothing
import type { Languages } from './api.js';
import { ENGLISH, LETTERS, LEXICONS, NEUTRAL, PHRASES, TOURIST } from './lexicon.js';

/** Letters a line needs (outside neutral words) before it can be called foreign. */
export const MIN_LETTERS = 8;

const FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', ø: 'o', œ: 'oe', ł: 'l', đ: 'd', ı: 'i', þ: 'th', ð: 'd' };
/** Without accents: what people type on an English keyboard. */
export const bare = (s: string): string => s.normalize('NFD').replace(/\p{M}+/gu, '').replace(/[ßæøœłđıþð]/g, (c) => FOLD[c] ?? c).normalize('NFC');
const hasMarks = (s: string) => bare(s) !== s;

interface Index {
  exact: Set<string>;
  bare: Set<string>;
}
const INDEX: Record<string, Index> = Object.fromEntries(
  Object.entries(LEXICONS).map(([lang, words]) => {
    const exact = new Set<string>();
    const b = new Set<string>();
    for (const x of words) {
      exact.add(x);
      if (hasMarks(x)) b.add(bare(x));
    }
    return [lang, { exact, bare: b }];
  }),
);
const LANGS = Object.keys(INDEX);
const ENGLISH_BARE = new Set([...ENGLISH].map(bare));
const PHRASE_TOKENS = PHRASES.map((p) => p.split(' '));

/** Laughter in any language: haha, ahah, hehe, hihi, jaja, jeje, huehue, kkkk, rsrs, www, xd, lol, lmao. */
const LAUGH = /^(?:ha){2,}h?$|^a?(?:ha){2,}$|^h?(?:ah){2,}a?$|^(?:he){2,}h?$|^(?:hi){2,}h?$|^(?:ja){2,}j?$|^(?:je){2,}j?$|^(?:hue){2,}$|^k{3,}$|^(?:rs){2,}$|^w{3,}$|^x+d+$|^(?:lo)+l+$|^l+m+f*a+o+$/;

/** "sooo" -> "so", "holaaa" -> "hola"; and the double-letter variant for "kuuuluu" -> "kuuluu". */
const variants = (t: string): string[] => [...new Set([t, t.replace(/(\p{L})\1{2,}/gu, '$1'), t.replace(/(\p{L})\1{2,}/gu, '$1$1')])];

/** neutral: says nothing (lol, ciao); both: an English word that is also a foreign one (die, was, so), counted as text only */
type TokenClass = { kind: 'neutral' } | { kind: 'both' } | { kind: 'english' } | { kind: 'unknown' } | { kind: 'foreign'; hits: Map<string, number> };

function classifyWhole(t: string): TokenClass | null {
  for (const v of variants(t)) {
    if (NEUTRAL.has(v) || TOURIST.has(v) || LAUGH.test(v)) return { kind: 'neutral' };
    const english = ENGLISH.has(v) || (!hasMarks(v) && ENGLISH_BARE.has(v));
    const hits = new Map<string, number>();
    for (const l of LANGS) {
      if (INDEX[l].exact.has(v)) hits.set(l, 1);
      else if (!english && !hasMarks(v) && INDEX[l].bare.has(v)) hits.set(l, 0.7);
    }
    const exact = [...hits.values()].some((x) => x === 1);
    if (english && exact) return { kind: 'both' };
    if (english) return { kind: 'english' };
    if (hits.size) return { kind: 'foreign', hits };
  }
  return null;
}

function classify(t: string): TokenClass[] {
  if (/\p{N}/u.test(t)) return [{ kind: 'neutral' }];
  const whole = classifyWhole(t);
  if (whole) return [whole];
  if (t.includes("'")) {
    // French and Italian elision: qu'est, d'où, l'école; English possessives come out unknown
    const [head, ...rest] = t.split("'");
    const out: TokenClass[] = [];
    if (head) out.push(classifyWhole(`${head}'`) ?? (head.length > 1 ? classifyWhole(head) : null) ?? { kind: 'unknown' });
    const tail = rest.join("'");
    if (tail.length > 1) out.push(...classify(tail));
    return out.length ? out : [{ kind: 'unknown' }];
  }
  if (/^\p{L}+ing$/u.test(t) && t.length >= 5) return [{ kind: 'english' }];
  return [{ kind: 'unknown' }];
}

// ---------- other scripts ----------

const SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Hangul}/u, 'ko'], [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'kana'], [/\p{Script=Han}/u, 'han'],
  [/\p{Script=Cyrillic}/u, 'ru'], [/\p{Script=Greek}/u, 'el'], [/\p{Script=Arabic}/u, 'ar'], [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Devanagari}/u, 'hi'], [/\p{Script=Bengali}/u, 'bn'], [/\p{Script=Gurmukhi}/u, 'pa'], [/\p{Script=Gujarati}/u, 'gu'],
  [/\p{Script=Tamil}/u, 'ta'], [/\p{Script=Telugu}/u, 'te'], [/\p{Script=Kannada}/u, 'kn'], [/\p{Script=Malayalam}/u, 'ml'],
  [/\p{Script=Sinhala}/u, 'si'], [/\p{Script=Thai}/u, 'th'], [/\p{Script=Lao}/u, 'lo'], [/\p{Script=Khmer}/u, 'km'],
  [/\p{Script=Myanmar}/u, 'my'], [/\p{Script=Georgian}/u, 'ka'], [/\p{Script=Armenian}/u, 'hy'], [/\p{Script=Ethiopic}/u, 'am'],
];

function byScript(text: string): string | undefined {
  const counts = new Map<string, number>();
  let total = 0;
  for (const ch of text.match(/\p{L}/gu) ?? []) {
    total++;
    const s = SCRIPTS.find(([re]) => re.test(ch))?.[1] ?? 'latin';
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const kana = counts.get('kana') ?? 0;
  const han = counts.get('han') ?? 0;
  if (kana) counts.set('ja', kana + han), counts.delete('kana'), counts.delete('han');
  else if (han) counts.set('zh', han), counts.delete('han');
  let best: string | undefined;
  let n = 0;
  for (const [s, c] of counts) if (s !== 'latin' && c > n) [best, n] = [s, c];
  if (!best || n / Math.max(1, total) < 0.6) return undefined;
  if (n < (['ko', 'ja', 'zh'].includes(best) ? 3 : 5)) return undefined;
  if (best === 'ru' && /[іїєґІЇЄҐ]/.test(text)) return 'uk';
  if (best === 'ar' && /[پچژگ]/.test(text)) return 'fa';
  if (best === 'ar' && /[ٹڈڑںے]/.test(text)) return 'ur';
  return best;
}

// ---------- Latin script ----------

export interface Analysis {
  /** detected language (ISO 639-1), only when confident and not English */
  lang?: string;
  /** why not, or which rule decided */
  why: string;
  words: number;
  letters: number;
  english: number;
  scores: [string, number][];
}

/** The full analysis of one line (tests and debugging); detectLanguage is the verdict. */
export function analyzeLanguage(text: string): Analysis {
  const script = byScript(text);
  const base: Analysis = { why: '', words: 0, letters: 0, english: 0, scores: [] };
  if (script) return { ...base, lang: script, why: 'script' };
  const raw = text.toLowerCase().replace(/[’‘`´]/g, "'");
  const tokens = raw.match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  // well-known phrases go first, whole words only
  const drop = new Set<number>();
  const bares = tokens.map(bare);
  for (const p of PHRASE_TOKENS) {
    for (let i = 0; i + p.length <= bares.length; i++) {
      if (p.every((x, k) => bares[i + k] === x)) for (let k = 0; k < p.length; k++) drop.add(i + k);
    }
  }
  const hits = new Map<string, Map<string, number>>(); // lang -> token -> weight
  const occ = new Map<string, number>(); // lang -> token occurrences
  let words = 0, letters = 0, english = 0;
  const evidence: string[] = [];
  tokens.forEach((t, i) => {
    if (drop.has(i) || t.length < 2) return;
    const classes = classify(t).filter((c) => c.kind !== 'neutral');
    if (classes.length) letters += (t.match(/\p{L}/gu) ?? []).length;
    for (const c of classes) {
      words++;
      if (c.kind === 'english') english++;
      else if (c.kind !== 'both') {
        evidence.push(t);
        if (c.kind === 'foreign')
          for (const [l, wgt] of c.hits) {
            const m = hits.get(l) ?? new Map<string, number>();
            m.set(t, Math.max(m.get(t) ?? 0, wgt));
            hits.set(l, m);
            occ.set(l, (occ.get(l) ?? 0) + 1);
          }
      }
    }
  });
  const info = { ...base, words, letters, english };
  if (letters < MIN_LETTERS || words < 2) return { ...info, why: 'too short' };
  const foreignText = evidence.join(' ');
  const scores: [string, number][] = LANGS.map((l) => {
    const h = [...(hits.get(l)?.values() ?? [])].reduce((a, b) => a + b, 0);
    if (!h) return [l, 0] as [string, number];
    const L = LETTERS[l];
    let bonus = 0;
    if (L?.strong && [...L.strong].some((c) => foreignText.includes(c))) bonus += 1;
    if (L?.typical && [...L.typical].some((c) => foreignText.includes(c))) bonus += 0.5;
    if (l === 'es' && /[¿¡]/.test(text)) bonus += 1;
    return [l, h + Math.min(1.5, bonus)] as [string, number];
  }).sort((a, b) => b[1] - a[1]);
  const [[best, s1], [, s2]] = scores;
  const h1 = [...(hits.get(best)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const out = { ...info, scores: scores.filter(([, s]) => s > 0).slice(0, 4) };
  if (h1 < 2) return { ...out, why: 'fewer than two known words' };
  if (s1 < 2.5) return { ...out, why: 'not enough evidence' };
  if ((occ.get(best) ?? 0) < 0.45 * words) return { ...out, why: 'known words are too few of the line' };
  if (english > Math.floor(words / 4) || english * 2 >= h1) return { ...out, why: 'too much English' };
  if (s1 - s2 < 1 || s1 < 1.4 * s2) return { ...out, why: `no clear lead over ${scores[1][0]}` };
  return { ...out, lang: best, why: 'words' };
}

/** ISO 639-1 code of the line's language when it is clearly not English; undefined otherwise. */
export function detectLanguage(text: string): string | undefined {
  return analyzeLanguage(text).lang;
}

// ---------- who reads what ----------

/** Close enough that someone fluent in the first reads the second. */
export const MUTUAL: Record<string, readonly string[]> = {
  da: ['no', 'sv'], no: ['da', 'sv'], sv: ['no', 'da'], cs: ['sk'], sk: ['cs'], ms: ['id'], id: ['ms'], hr: ['sr', 'bs'], sr: ['hr', 'bs'],
  bs: ['hr', 'sr'], ru: ['uk', 'be'], uk: ['ru'], be: ['ru'], af: ['nl'], nl: ['af'], gl: ['pt'], pt: ['gl'], zh: ['yue'], yue: ['zh'],
};

/**
 * Whether someone with these languages reads `code`: listed at any level, or a close relative of a
 * language they speak natively or fluently. undefined when the persona does not say (remote prompts).
 */
export function readsLanguage(languages: Readonly<Languages> | undefined, code: string): boolean | undefined {
  if (!languages) return undefined;
  if (languages[code]) return true;
  return Object.entries(languages).some(([l, lv]) => (lv === 'native' || lv === 'fluent') && (MUTUAL[l] ?? []).includes(code));
}
