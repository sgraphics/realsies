// Demo bot personas as attributes: who the character is (age, gender, Myers-Briggs type, temperament,
// today's mood, home, English, job, life details, interests) and everything that follows from it:
//
//   deriveStyle    how they text: case, punctuation, length, questions, exclamations, emoji (an
//                  age-appropriate set), emoticons, laughter, abbreviations, slang, typos, and how they
//                  take "are you a bot"
//   deriveTraits   the default brain's dials (chatty, fast, curious, guarded, drift)
//   deriveCps      typing speed
//   cardOf         the card revealed after settlement (shared/protocol.ts PersonaCard)
//
// The four letters each move both the writing and the dials: E chattier, more questions and
// exclamations, opens sooner; I terse, guarded, slower to start; S concrete; N ideas and tangents;
// T blunt and guarded; F warm; J tidy and on topic; P messy and drifting. Hand-written personas live
// in relay/personas/*.json ("person" block, style overrides allowed); generated ones come from
// src/persona/generate.ts. src/persona/prompt.ts turns a person into the committed persona prompt.
import type { PersonaCard } from '../../../shared/protocol.js';
import { TOPICS, type PersonaTraits, type Topic } from '../bot/api.js';
import { weighted, type Rng } from '../bot/rng.js';
import { sha256Hex } from '../crypto.js';
import { CULTURES } from './data.js';

export const SLOTS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type Slot = (typeof SLOTS)[number];
export const JOB_CATS = ['school', 'student', 'shift', 'office', 'care', 'trade', 'driver', 'creative', 'shop', 'teacher', 'home', 'night', 'retired'] as const;
export type JobCat = (typeof JOB_CATS)[number];
export const GENDERS = ['woman', 'man', 'nonbinary'] as const;
export type Gender = (typeof GENDERS)[number];
export const TEMPERAMENTS = ['shy', 'reserved', 'easygoing', 'outgoing', 'loud'] as const;
export type Temperament = (typeof TEMPERAMENTS)[number];
export const ENGLISH_LEVELS = ['native', 'fluent', 'good', 'basic'] as const;
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];
export const DEVICES = ['phone', 'laptop', 'tablet', 'computer'] as const;
export type Device = (typeof DEVICES)[number];
export const MBTI_RE = /^[EI][SN][TF][JP]$/;

/** Where the character is and what is around them, for the time slots it fits. */
export interface Scene {
  when: Slot[];
  /** second person without the subject: "on the bus home after an early shift" */
  now: string;
  /** what they can see or hear right now */
  sees: string[];
  /** what they have eaten today, in this scene */
  ate?: string;
}

export interface Person {
  name: string;
  /** what everyone calls them, if not their name */
  nickname?: string;
  age: number;
  /** independent of the avatar's look */
  gender: Gender;
  mbti: string;
  temperament: Temperament;
  /** today's mood, a MOODS key */
  mood: string;
  /** why they feel that way today (second person clause); default from MOODS */
  moodWhy?: string;
  home: { city: string; region?: string; country: string; tz: string; culture: string };
  english: EnglishLevel;
  /** first language when English is not */
  language?: string;
  /** how their English slips; default from the culture */
  slips?: string;
  job: { title: string; phrase: string; cat: JobCat };
  /** a pet, sibling, partner or kids, as a sentence */
  family: string;
  commute: string;
  device: Device;
  likes: string[];
  details: string[];
  quirks: string[];
  scenes: Scene[];
  /** what they ate today when the scene does not say */
  ate?: string;
  interests: Topic[];
  /** overrides of the derived style */
  style?: Partial<Style>;
}

export interface Style {
  case: 'lower' | 'normal' | 'erratic';
  punctuation: 'none' | 'light' | 'full' | 'dots';
  exclaim: 'none' | 'some' | 'lots';
  questions: 'rare' | 'some' | 'often';
  length: 'terse' | 'short' | 'full';
  emoji: 'none' | 'rare' | 'often';
  emojis: string[];
  emoticons: string[];
  laugh: string[];
  abbreviations: string[];
  slang: string[];
  typos: 'rare' | 'some' | 'often';
  /** how they take "are you a bot" (second person clause) */
  botReaction: string;
}

/** The card revealed after settlement: shared/protocol.ts PersonaCard plus name and mood (extra fields). */
export type RevealCard = PersonaCard & { name: string; mood: string };

// ---------- moods ----------

export interface MoodT {
  label: string;
  why: string[];
  d: Partial<Record<'chatty' | 'fast' | 'curious' | 'guarded' | 'drift' | 'emoji' | 'typos' | 'cps', number>>;
  /** likelier at these times of day */
  slots?: Slot[];
}

export const MOODS: Record<string, MoodT> = {
  tired: { label: 'tired', why: ['you slept badly', "it's been a long week", 'you were up late'], d: { chatty: -0.08, fast: -0.1, typos: 1, emoji: -0.05, cps: 0.95 } },
  sleepy: { label: 'half asleep', why: ['you only just woke up', "it's way past your bedtime"], d: { chatty: -0.1, fast: -0.14, typos: 1, cps: 0.93 }, slots: ['morning', 'night'] },
  cheerful: { label: 'in a good mood', why: ['you got paid', 'the weather is nice for once', 'things went your way'], d: { chatty: 0.08, emoji: 0.1, guarded: -0.05 } },
  giddy: { label: 'hyper', why: ['you just got some good news', 'you had way too much coffee'], d: { chatty: 0.12, fast: 0.08, emoji: 0.12, drift: 0.05, cps: 1.04 } },
  bored: { label: 'bored', why: ['nothing is happening', "you're killing time"], d: { chatty: 0.04, curious: 0.06, drift: 0.05 }, slots: ['afternoon', 'evening'] },
  grumpy: { label: 'grumpy', why: ['your bus was late', 'someone took your parking spot', 'your boss annoyed you'], d: { chatty: -0.06, guarded: 0.1, emoji: -0.1 } },
  stressed: { label: 'stressed', why: ['you have a deadline coming up', 'money is tight this month'], d: { fast: 0.05, guarded: 0.05, typos: 1, drift: 0.05 } },
  chill: { label: 'relaxed', why: ['nothing much is going on', 'you finally got everything done'], d: { fast: -0.05, guarded: -0.06 } },
  distracted: { label: 'distracted', why: ["you're doing three things at once", "there's a lot going on around you"], d: { typos: 1, drift: 0.1, fast: -0.05 } },
  restless: { label: 'restless', why: ["you've been stuck inside all day", "you can't sit still"], d: { fast: 0.08, chatty: 0.05, cps: 1.03 } },
  down: { label: 'a bit down', why: ["it's been a rough week", 'you miss home'], d: { chatty: -0.08, emoji: -0.08, guarded: 0.04 } },
  chatty: { label: 'in a chatty mood', why: ["you haven't talked to anyone all day", "you're procrastinating"], d: { chatty: 0.12, curious: 0.04 } },
  hungry: { label: 'hungry', why: ['you skipped a meal', "your next meal isn't ready yet"], d: { drift: 0.04, chatty: -0.02 } },
  nosy: { label: 'nosy', why: ['you love meeting new people', "you're curious who's out there"], d: { curious: 0.1, chatty: 0.04 } },
};

// ---------- helpers ----------

export interface Letters {
  E: boolean;
  N: boolean;
  F: boolean;
  P: boolean;
}
export const letters = (mbti: string): Letters => ({ E: mbti[0] === 'E', N: mbti[1] === 'N', F: mbti[2] === 'F', P: mbti[3] === 'P' });

/** 0 shy .. 1 loud */
export const TEMPERAMENT_SCORE: Record<Temperament, number> = { shy: 0.1, reserved: 0.3, easygoing: 0.5, outgoing: 0.7, loud: 0.9 };

const clamp = (v: number, lo = 0.05, hi = 0.95) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Deterministic noise in [-1, 1] from a key. */
export function noise(key: string): number {
  return (parseInt(sha256Hex(key).slice(0, 8), 16) / 0xffffffff) * 2 - 1;
}

export function pickSome<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng.next() * pool.length) % pool.length, 1)[0]);
  return out;
}

export const pickW = <T>(rng: Rng, items: [T, number][]): T => weighted(rng, items) ?? items[0][0];

/** Age band: 0 under 25, 1 under 35, 2 under 50, 3 under 60, 4 sixty and over. */
export const ageBand = (age: number) => (age < 25 ? 0 : age < 35 ? 1 : age < 50 ? 2 : age < 60 ? 3 : 4);

// ---------- local time ----------

export interface LocalTime {
  hour: number;
  minute: number;
  weekday: string;
  month: string;
  slot: Slot;
}

export function slotOf(hour: number): Slot {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export function localTime(tz: string, at: number): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'long', month: 'long', hourCycle: 'h23' }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return { hour, minute: Number(get('minute')), weekday: get('weekday'), month: get('month'), slot: slotOf(hour) };
}

// ---------- style ----------

/** Emoji by age band: what a teenager reaches for is not what a grandparent does. */
export const EMOJI_SETS: readonly (readonly string[])[] = [
  ['💀', '😭', '🫠', '😩', '🙏', '✨', '🤭', '🥲', '😳'],
  ['😂', '🙃', '😅', '🤷', '👀', '🙄', '🥲', '😬', '🔥'],
  ['😂', '😅', '🙈', '👍', '😊', '🤦', '😎', '🙄'],
  ['👍', '😊', '🙂', '😉', '😂', '🤣'],
  ['👍', '😊', '🙂', '😉', '😀', '❤️'],
];
/** Gen-Z emoji an older person would not use. */
export const YOUNG_EMOJI: readonly string[] = ['💀', '😭', '🫠', '😩', '🥲', '😳', '🤭'];
const EMOTICON_SETS: { p: number; set: string[] }[] = [
  { p: 0.12, set: ['xD', ':/', '<3'] },
  { p: 0.18, set: [':)', ':D', 'xD', ':/'] },
  { p: 0.35, set: [':)', ':D', ';)'] },
  { p: 0.55, set: [':)', ':-)', ';-)', ':D'] },
  { p: 0.65, set: [':)', ':-)', ';-)'] },
];
const ABBREVIATIONS: string[][] = [
  ['idk', 'tbh', 'ngl', 'fr', 'rn', 'u', 'ur', 'bc', 'wyd', 'omg', 'istg'],
  ['idk', 'tbh', 'omg', 'btw', 'u', 'rn', 'ngl'],
  ['btw', 'idk', 'omg', 'thx', 'u'],
  ['btw', 'thx'],
  ['btw'],
];

/** How they take "are you a bot": weighted by letters, temperament and age. */
function botReactionOf(p: Person, rng: Rng): string {
  const l = letters(p.mbti);
  const shy = TEMPERAMENT_SCORE[p.temperament] < 0.4;
  return pickW(rng, [
    ['laugh it off and throw the question straight back at them', l.E && l.F ? 3 : 1],
    ['act mock-offended for a second, then tease them back', l.E && !l.F ? 3 : 0.8],
    ['say a short, dry no and change the subject', !l.E && !l.F ? 3 : 0.6],
    ['get a little flustered, say no, and ask what made them think that', !l.E && l.F ? 2.5 : shy ? 1.5 : 0.5],
    ['get suspicious of them instead, since that is exactly what a bot would ask', !l.F && l.N ? 2 : 0.6],
    ['joke along for a second, then say obviously not', l.N && l.P && p.age < 40 ? 1.5 : 0.3],
    ['react like it is the most ridiculous question ever, then move on', p.age < 25 ? 2.5 : 0.3],
    ['be a bit puzzled by the question, say of course you are a real person, and laugh about it', p.age >= 55 ? 3 : 0.1],
  ]);
}

/** The writing style that follows from the attributes; `p.style` overrides any field. */
export function deriveStyle(p: Person, rng: Rng): Style {
  const l = letters(p.mbti);
  const t = TEMPERAMENT_SCORE[p.temperament];
  const m = MOODS[p.mood]?.d ?? {};
  const band = ageBand(p.age);
  const culture = CULTURES[p.home.culture];
  const native = p.english === 'native';

  // case: the young type in lowercase; J tidies it up, P lets it go
  const caseBase: [number, number, number][] = [[0.68, 0.14, 0.18], [0.42, 0.38, 0.2], [0.18, 0.62, 0.2], [0.08, 0.7, 0.22], [0.06, 0.66, 0.28]];
  const [cl, cn, ce] = caseBase[band];
  const kase = pickW<Style['case']>(rng, [
    ['lower', cl * (l.P ? 1.3 : 0.7)],
    ['normal', cn * (l.P ? 0.7 : 1.6)],
    ['erratic', ce * (l.P ? 1.3 : 0.9)],
  ]);

  const punctBase: [number, number, number, number][] = [[0.42, 0.48, 0.1, 0], [0.18, 0.57, 0.25, 0], [0.06, 0.48, 0.4, 0.06], [0.04, 0.34, 0.44, 0.18], [0.03, 0.22, 0.4, 0.35]];
  const [pn, pl, pf, pd] = punctBase[band];
  const punctuation = pickW<Style['punctuation']>(rng, [
    ['none', pn * (l.P ? 1.4 : 0.6)],
    ['light', pl],
    ['full', pf * (l.P ? 0.7 : 1.6) * (kase === 'lower' ? 0.4 : 1)],
    ['dots', pd],
  ]);

  // E exclaims, I hardly; F softens it upwards, T downwards
  const giddy = p.mood === 'giddy' || p.mood === 'cheerful';
  const exBase: [number, number, number] = l.E ? [0.12, 0.48, 0.4] : [0.55, 0.38, 0.07];
  const exclaim = pickW<Style['exclaim']>(rng, [
    ['none', exBase[0] * (l.F ? 0.8 : 1.25)],
    ['some', exBase[1]],
    ['lots', exBase[2] * (l.F ? 1.3 : 0.7) * (giddy ? 1.4 : 1)],
  ]);

  const q = 0.5 + (l.E ? 0.18 : -0.18) + (l.F ? 0.08 : -0.04) + (l.N ? 0.06 : 0) + (m.curious ?? 0) + (rng.next() - 0.5) * 0.12;
  const questions: Style['questions'] = q < 0.38 ? 'rare' : q > 0.62 ? 'often' : 'some';

  const len = 0.45 + (l.E ? 0.15 : -0.15) + (p.age >= 50 ? 0.15 : p.age >= 35 ? 0.05 : 0) + (p.english === 'basic' ? -0.2 : 0) + (t - 0.5) * 0.2 + (rng.next() - 0.5) * 0.1;
  const length: Style['length'] = len < 0.33 ? 'terse' : len < 0.62 ? 'short' : 'full';

  const genderEmoji = p.gender === 'woman' ? 0.05 : p.gender === 'man' ? -0.04 : 0;
  const es = [0.62, 0.5, 0.42, 0.38, 0.36][band] + (l.E ? 0.1 : -0.08) + (l.F ? 0.1 : -0.1) + genderEmoji + (m.emoji ?? 0) + (t - 0.5) * 0.16 + (rng.next() - 0.5) * 0.16;
  const emoji: Style['emoji'] = es < 0.3 ? 'none' : es < 0.58 ? 'rare' : 'often';
  const emojis = emoji === 'none' ? [] : pickSome(rng, EMOJI_SETS[band], emoji === 'often' ? 3 : 2);
  const own = culture?.emoticons;
  const emoticons = own && rng.next() < 0.6 ? pickSome(rng, own, 1) : rng.next() < EMOTICON_SETS[band].p ? pickSome(rng, EMOTICON_SETS[band].set, 2) : [];

  const laughPool = band <= 1 ? culture?.laughYoung ?? ['haha'] : culture?.laughOld ?? ['haha'];
  const laugh = pickSome(rng, laughPool, band <= 1 && laughPool.length > 1 ? 2 : 1);

  let nAbbr = [4, 3, 2, 1, 0][band] + (l.P ? 1 : -1);
  if (!native) nAbbr = Math.floor(nAbbr / (p.english === 'basic' ? 3 : 1.5));
  if (band >= 3 && rng.next() < 0.6) nAbbr = 0;
  const abbreviations = pickSome(rng, ABBREVIATIONS[band], Math.max(0, nAbbr));

  const slang = [
    ...pickSome(rng, culture?.slang ?? [], culture?.slang?.length ? 1 + Math.floor(rng.next() * 2) : 0),
    ...(p.age < 30 ? pickSome(rng, culture?.slangYoung ?? [], culture?.slangYoung?.length ? 1 : 0) : []),
  ];

  const ty = 0.4 + (l.P ? 0.15 : -0.12) + (m.typos ? 0.2 : 0) + (p.device === 'phone' ? 0.05 : -0.1) + (p.age >= 60 ? 0.08 : 0) + (rng.next() - 0.5) * 0.14;
  const typos: Style['typos'] = ty < 0.33 ? 'rare' : ty < 0.6 ? 'some' : 'often';

  const derived: Style = {
    case: kase, punctuation, exclaim, questions, length, emoji, emojis, emoticons, laugh, abbreviations, slang, typos, botReaction: botReactionOf(p, rng),
  };
  const given: Partial<Style> = p.style ?? {};
  const out: Style = { ...derived, ...given };
  // keep the merged style coherent where the person did not say otherwise
  if (out.punctuation === 'none' && out.exclaim === 'lots' && given.exclaim === undefined) out.exclaim = 'some';
  if (out.emoji === 'none' && given.emojis === undefined) out.emojis = [];
  if (out.emoji !== 'none' && !out.emojis.length && given.emojis === undefined) out.emojis = pickSome(rng, EMOJI_SETS[band], 2);
  return out;
}

// ---------- brain dials and typing speed ----------

/**
 * The default brain's dials (src/bot/brain.ts) from the attributes:
 *   chatty  temperament (itself E/I with noise), E, F, mood: double texts, multi-bubble replies, opening first, shorter silences
 *   fast    age, P (impulsive) vs J, E vs I (slower to start), mood: reaction time, hesitations, the opener's delay
 *   curious N, E, F, mood: the share of turns that test the partner, challenges, closing verdicts
 *   guarded I, T, J, a shy temperament, mood: fake typing, deleted drafts, accusations, waiting for the other to open
 *   drift   P, N, mood: out-of-order remarks over direct replies, tangents and afterthoughts
 */
export function deriveTraits(p: Person): PersonaTraits {
  const l = letters(p.mbti);
  const t = TEMPERAMENT_SCORE[p.temperament];
  const m = MOODS[p.mood]?.d ?? {};
  const age = Math.min(70, Math.max(16, p.age));
  return {
    chatty: r2(clamp(0.08 + 0.6 * t + (l.E ? 0.1 : -0.04) + (l.F ? 0.05 : -0.03) + (m.chatty ?? 0))),
    fast: r2(clamp(0.92 - 0.0135 * (age - 16) + (l.P ? 0.05 : -0.03) + (l.E ? 0.04 : -0.04) + (m.fast ?? 0))),
    curious: r2(clamp(0.5 + (l.N ? 0.12 : -0.08) + (l.E ? 0.08 : -0.06) + (l.F ? 0.04 : -0.02) + (m.curious ?? 0))),
    guarded: r2(clamp(0.5 + (l.E ? -0.12 : 0.13) + (l.F ? -0.09 : 0.09) + (l.P ? -0.04 : 0.04) + (0.5 - t) * 0.3 + (m.guarded ?? 0))),
    drift: r2(clamp(0.5 + (l.P ? 0.18 : -0.15) + (l.N ? 0.12 : -0.09) + (m.drift ?? 0))),
  };
}

/** Characters a second: slower with age, faster on a keyboard (for the young), slower in a second language, a little personal noise. */
export function deriveCps(p: Person, fast: number, key: string): number {
  const a = Math.min(70, Math.max(18, p.age)) - 18;
  let cps = 6.1 - 0.028 * a - 0.00035 * a * a;
  if (p.device === 'laptop') cps *= p.age < 55 ? 1.2 : 1;
  else if (p.device === 'computer') cps *= p.age < 55 ? 1.15 : 0.95;
  else if (p.device === 'tablet') cps *= 0.92;
  cps *= { native: 1, fluent: 0.97, good: 0.92, basic: 0.85 }[p.english];
  cps *= 0.94 + 0.12 * fast;
  cps *= MOODS[p.mood]?.d.cps ?? 1;
  cps *= 1 + noise(`cps|${key}`) * 0.06;
  return r2(Math.min(7.6, Math.max(2.8, cps)));
}

// ---------- the card ----------

export function homeOf(p: Person): string {
  return `${p.home.city}, ${p.home.region ?? p.home.country}`;
}

/** One line for the card, e.g. "all lowercase, no punctuation, lol and lmao, lots of 💀 and 😭". */
export function styleLine(p: Person, s: Style): string {
  const parts: string[] = [{ lower: 'all lowercase', normal: 'proper capitals', erratic: 'random capitals' }[s.case]];
  if (s.punctuation === 'none') parts.push('no punctuation');
  else if (s.punctuation === 'dots') parts.push('lots of ...');
  else if (s.punctuation === 'full') parts.push('full stops and commas');
  if (s.exclaim === 'lots') parts.push('lots of !!');
  if (s.length === 'terse') parts.push('very short replies');
  else if (s.length === 'full') parts.push('full sentences');
  if (s.laugh.length) parts.push(s.laugh.slice(0, 2).join(' and '));
  if (s.emoji === 'often' && s.emojis.length) parts.push(`lots of ${s.emojis.slice(0, 2).join(' and ')}`);
  else if (s.emoji === 'rare' && s.emojis.length) parts.push(`the odd ${s.emojis[0]}`);
  else if (s.emoji === 'none' && !s.emoticons.length) parts.push('no emoji');
  if (s.emoticons.length) parts.push(s.emoticons.slice(0, 2).join(' and '));
  if (s.slang.length) parts.push(`says ${s.slang.slice(0, 2).join(' and ')}`);
  else if (s.abbreviations.length) parts.push(s.abbreviations.slice(0, 3).join(', '));
  if (p.english !== 'native') parts.push(p.english === 'basic' ? 'simple second-language English' : 'second-language slips');
  if (s.typos === 'often') parts.push('plenty of typos');
  return parts.join(', ');
}

export function cardOf(p: Person, s: Style): RevealCard {
  return {
    age: p.age,
    gender: p.gender === 'nonbinary' ? 'non-binary' : p.gender,
    mbti: p.mbti,
    temperament: `${p.temperament} ${letters(p.mbti).E ? 'extrovert' : 'introvert'}`,
    home: homeOf(p),
    job: p.job.title,
    style: styleLine(p, s),
    emoji: s.emoji,
    name: p.nickname ?? p.name,
    mood: MOODS[p.mood]?.label ?? p.mood,
  };
}

export function summaryOf(p: Person): string {
  return `${p.age}, ${p.job.title} in ${p.home.city}; ${p.mbti}, ${p.temperament}, ${MOODS[p.mood]?.label ?? p.mood}`;
}

// ---------- validation (relay/personas/*.json "person" blocks) ----------

const STYLE_ENUMS: Partial<Record<keyof Style, readonly string[]>> = {
  case: ['lower', 'normal', 'erratic'], punctuation: ['none', 'light', 'full', 'dots'], exclaim: ['none', 'some', 'lots'],
  questions: ['rare', 'some', 'often'], length: ['terse', 'short', 'full'], emoji: ['none', 'rare', 'often'], typos: ['rare', 'some', 'often'],
};
const STYLE_LISTS: (keyof Style)[] = ['emojis', 'emoticons', 'laugh', 'abbreviations', 'slang'];

const str = (v: unknown, what: string, min = 1, max = 400): string => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new Error(`${what} must be a string of ${min} to ${max} characters`);
  return v.trim();
};
const strs = (v: unknown, what: string, min = 0, max = 8): string[] => {
  if (v === undefined && min === 0) return [];
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error(`${what} must be a list of ${min} to ${max} strings`);
  return v.map((x, i) => str(x, `${what}[${i}]`));
};
const oneOf = <T extends string>(v: unknown, xs: readonly T[], what: string): T => {
  if (!xs.includes(v as T)) throw new Error(`${what} must be one of ${xs.join(', ')}`);
  return v as T;
};

/** Validate a "person" block. Every attribute is required except nickname, moodWhy, slips, ate and style. */
export function parsePerson(raw: any, where: string): Person {
  if (!raw || typeof raw !== 'object') throw new Error(`${where} person must be an object`);
  const allowed = new Set(['name', 'nickname', 'age', 'gender', 'mbti', 'temperament', 'mood', 'moodWhy', 'home', 'english', 'language', 'slips', 'job', 'family', 'commute', 'device', 'likes', 'details', 'quirks', 'scenes', 'ate', 'interests', 'style']);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) throw new Error(`${where} person.${k} is not an attribute`);
  const w = (k: string) => `${where} person.${k}`;
  if (!Number.isInteger(raw.age) || raw.age < 16 || raw.age > 85) throw new Error(`${w('age')} must be a whole number from 16 to 85`);
  if (typeof raw.mbti !== 'string' || !MBTI_RE.test(raw.mbti)) throw new Error(`${w('mbti')} must be a Myers-Briggs type like ENFP`);
  if (typeof raw.mood !== 'string' || !MOODS[raw.mood]) throw new Error(`${w('mood')} must be one of ${Object.keys(MOODS).join(', ')}`);
  const h = raw.home ?? {};
  if (!CULTURES[h.culture]) throw new Error(`${w('home.culture')} must be one of ${Object.keys(CULTURES).join(', ')}`);
  try {
    localTime(str(h.tz, w('home.tz')), 0);
  } catch {
    throw new Error(`${w('home.tz')} is not a time zone`);
  }
  const english = oneOf(raw.english, ENGLISH_LEVELS, w('english'));
  if (english !== 'native' && typeof raw.language !== 'string') throw new Error(`${w('language')} is required when english is not native`);
  const j = raw.job ?? {};
  const scenes = Array.isArray(raw.scenes) && raw.scenes.length ? raw.scenes : null;
  if (!scenes) throw new Error(`${w('scenes')} must list at least one scene`);
  const interests = strs(raw.interests, w('interests'), 2, 6) as Topic[];
  if (interests.some((x) => !(TOPICS as readonly string[]).includes(x))) throw new Error(`${w('interests')} must come from ${TOPICS.join(', ')}`);
  let style: Partial<Style> | undefined;
  if (raw.style !== undefined) {
    if (!raw.style || typeof raw.style !== 'object') throw new Error(`${w('style')} must be an object`);
    style = {};
    for (const [k, v] of Object.entries(raw.style)) {
      const key = k as keyof Style;
      if (STYLE_ENUMS[key]) (style as any)[key] = oneOf(v, STYLE_ENUMS[key]!, w(`style.${k}`));
      else if (STYLE_LISTS.includes(key)) (style as any)[key] = strs(v, w(`style.${k}`), 0, 12);
      else if (key === 'botReaction') style.botReaction = str(v, w('style.botReaction'));
      else throw new Error(`${w(`style.${k}`)} is not a style field`);
    }
  }
  return {
    name: str(raw.name, w('name'), 1, 30),
    nickname: raw.nickname === undefined ? undefined : str(raw.nickname, w('nickname'), 1, 30),
    age: raw.age,
    gender: oneOf(raw.gender, GENDERS, w('gender')),
    mbti: raw.mbti,
    temperament: oneOf(raw.temperament, TEMPERAMENTS, w('temperament')),
    mood: raw.mood,
    moodWhy: raw.moodWhy === undefined ? undefined : str(raw.moodWhy, w('moodWhy')),
    home: { city: str(h.city, w('home.city'), 1, 60), region: h.region === undefined ? undefined : str(h.region, w('home.region'), 1, 60), country: str(h.country, w('home.country'), 1, 60), tz: h.tz, culture: h.culture },
    english,
    language: raw.language === undefined ? undefined : str(raw.language, w('language'), 1, 40),
    slips: raw.slips === undefined ? undefined : str(raw.slips, w('slips')),
    job: { title: str(j.title, w('job.title'), 1, 60), phrase: str(j.phrase, w('job.phrase')), cat: oneOf(j.cat, JOB_CATS, w('job.cat')) },
    family: str(raw.family, w('family')),
    commute: str(raw.commute, w('commute')),
    device: oneOf(raw.device, DEVICES, w('device')),
    likes: strs(raw.likes, w('likes'), 1, 6),
    details: strs(raw.details, w('details')),
    quirks: strs(raw.quirks, w('quirks')),
    scenes: scenes.map((s: any, i: number) => ({
      when: (Array.isArray(s?.when) && s.when.length ? s.when : (() => { throw new Error(`${w(`scenes[${i}].when`)} must list time slots`); })()).map((x: unknown) => oneOf(x, SLOTS, w(`scenes[${i}].when`))),
      now: str(s.now, w(`scenes[${i}].now`)),
      sees: strs(s.sees, w(`scenes[${i}].sees`), 1, 4),
      ate: s.ate === undefined ? undefined : str(s.ate, w(`scenes[${i}].ate`)),
    })),
    ate: raw.ate === undefined ? undefined : str(raw.ate, w('ate')),
    interests: [...new Set(interests)],
    style,
  };
}
