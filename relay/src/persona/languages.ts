// The languages of a demo persona: which ones they know and how well (native, fluent, good, basic), as
// ISO 639 codes, and the part of the committed prompt that pins them down. A persona reads only these;
// in any other language it understands nothing, so it never translates, answers or writes it, and reacts
// the way a real person would. It writes in English and never switches language on its own; it may
// answer in a language it speaks when the partner writes in it.
import { LANG_LEVELS, type LangLevel, type Languages } from '../bot/api.js';

/** ISO 639 code -> English name, for every language a persona may list (and every one the detector returns). */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English', et: 'Estonian', fi: 'Finnish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  sv: 'Swedish', da: 'Danish', no: 'Norwegian', is: 'Icelandic', pl: 'Polish', cs: 'Czech', sk: 'Slovak', ro: 'Romanian', hu: 'Hungarian',
  el: 'Greek', tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', be: 'Belarusian', lv: 'Latvian', lt: 'Lithuanian', ga: 'Irish', cy: 'Welsh',
  gd: 'Scottish Gaelic', mi: 'Māori', af: 'Afrikaans', zu: 'Zulu', xh: 'Xhosa', yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa', pcm: 'Nigerian Pidgin',
  sw: 'Swahili', ki: 'Kikuyu', hi: 'Hindi', mr: 'Marathi', kn: 'Kannada', ml: 'Malayalam', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', si: 'Sinhala', tl: 'Tagalog', ceb: 'Cebuano', ms: 'Malay', id: 'Indonesian', zh: 'Mandarin',
  yue: 'Cantonese', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese', th: 'Thai', lo: 'Lao', km: 'Khmer', my: 'Burmese', ar: 'Arabic',
  he: 'Hebrew', fa: 'Persian', ca: 'Catalan', gl: 'Galician', eu: 'Basque', hr: 'Croatian', sr: 'Serbian', bs: 'Bosnian', bg: 'Bulgarian',
  sl: 'Slovenian', sq: 'Albanian', ka: 'Georgian', hy: 'Armenian', am: 'Amharic', lb: 'Luxembourgish',
};

const ALIASES: Record<string, string> = { chinese: 'zh', flemish: 'nl', 'swiss german': 'de', farsi: 'fa', pidgin: 'pcm', 'te reo māori': 'mi' };

/** "Estonian" -> "et" (names as the persona files and cultures write them). */
export function codeOfLanguage(name: string): string | undefined {
  const n = name.trim().toLowerCase();
  if (LANGUAGE_NAMES[n]) return n;
  return ALIASES[n] ?? Object.entries(LANGUAGE_NAMES).find(([, v]) => v.toLowerCase() === n)?.[0];
}

export const languageName = (code: string): string => LANGUAGE_NAMES[code] ?? code;

const RANK: Record<LangLevel, number> = { native: 0, fluent: 1, good: 2, basic: 3 };

/** Languages best first: the native ones, then fluent, good, basic (English first within a level). */
export function orderedLanguages(ls: Languages): [string, LangLevel][] {
  return Object.entries(ls).sort((a, b) => RANK[a[1]] - RANK[b[1]] || (a[0] === 'en' ? -1 : b[0] === 'en' ? 1 : 0));
}

const and = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "Estonian is your first language, you speak good English and Russian, and you know a little Finnish, just simple words and phrases" */
export function languagesSentence(ls: Languages): string {
  const all = orderedLanguages(ls);
  const of = (lv: LangLevel) => all.filter(([, l]) => l === lv).map(([c]) => languageName(c));
  const natives = of('native');
  if (all.length === 1) return `${natives[0] ?? languageName(all[0][0])} is the only language you speak`;
  const parts: string[] = [];
  if (natives.length === 1) parts.push(`${natives[0]} is your first language`);
  else if (natives.length > 1) parts.push(`you grew up speaking ${and(natives)}`);
  if (of('fluent').length) parts.push(`you speak ${and(of('fluent'))} fluently`);
  if (of('good').length) parts.push(`you speak good ${and(of('good'))}`);
  if (of('basic').length) parts.push(`you know a little ${and(of('basic'))}, just simple words and phrases`);
  const s = parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts.join(', and ');
  return s[0].toUpperCase() + s.slice(1);
}

/** The fixed core of the rule, in every demo persona's committed prompt. */
export const LANGUAGE_RULE_CORE =
  'you do not understand it at all, so never translate it, never answer what it says and never write in it; react the way a real person would, confused or amused, maybe guess what language it is, and ask them to write in English';

const or = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/**
 * The firm rule after the list, naming the languages (a bare "any other language" after a sentence about
 * their English reads as "other than English"): only these; anything else is not understood, translated,
 * answered or written; English unless the partner writes in one of the others.
 */
export function languageRule(ls: Languages): string {
  const all = orderedLanguages(ls).map(([c]) => languageName(c));
  const others = orderedLanguages(ls).filter(([c]) => c !== 'en').map(([c]) => languageName(c));
  const only = `You can read only ${and(all)}: if they write in any other language, ${LANGUAGE_RULE_CORE}.`;
  const sw = others.length
    ? `You never switch language on your own: you write in English, but if they write to you in ${or(others)}, you may answer in ${others.length > 1 ? 'that language' : others[0]}.`
    : 'You always write in English.';
  return `${only} ${sw}`;
}

/** Validate a languages object from a persona file: known codes, known levels, at least one native. */
export function parseLanguages(raw: unknown, where: string): Languages {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where} must be an object of language code to level, e.g. {"en": "native", "fr": "basic"}`);
  const out: Languages = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > 8) throw new Error(`${where} must list 1 to 8 languages`);
  for (const [code, level] of entries) {
    if (!LANGUAGE_NAMES[code]) throw new Error(`${where}.${code} is not a known language code (see src/persona/languages.ts)`);
    if (!(LANG_LEVELS as readonly string[]).includes(level as string)) throw new Error(`${where}.${code} must be one of ${LANG_LEVELS.join(', ')}`);
    out[code] = level as LangLevel;
  }
  if (!Object.values(out).includes('native')) throw new Error(`${where} needs at least one native language`);
  return out;
}
