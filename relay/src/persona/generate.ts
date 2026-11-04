// Fresh demo personas for every round, from a seeded RNG (the round's castSeed, stored in the DB), so a
// player who plays round after round keeps meeting new people. Same seed, index and start time, same
// person. Every attribute is drawn so it fits the others: the job fits the age, names fit the culture and
// the age, the family fits the life stage, the scene fits the job and the local time of day, the food fits
// the culture and the hour, the temperament follows E/I with noise, interests follow job, hobbies, age
// and letters. The style is then derived from all of it (src/persona/model.ts) and stored with the person.
import type { Level } from '../../../shared/protocol.js';
import { TOPICS, type Topic } from '../bot/api.js';
import { chance, createRng, pickR, type Rng } from '../bot/rng.js';
import {
  CARS, COMMUTES, CULTURES, DETAILS, GENERIC_FOOD, HOBBIES, JOBS, NEUTRAL_NAMES, PETS, PLACES, QUIRKS, SCENES, SUBJECTS, TRIPS,
  type Culture, type Place,
} from './data.js';
import {
  deriveStyle, letters, localTime, MOODS, pickSome, pickW,
  type Device, type EnglishLevel, type Gender, type JobCat, type Person, type Slot, type Temperament,
} from './model.js';

export const GEN_MODELS: [string, number][] = [
  ['z-ai/glm-5.3-flash', 2],
  ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 1],
];

export interface GeneratedPersona {
  id: string;
  person: Person;
  model: string;
}

function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

/** 16 to 70, most of them 20 to 40. */
export function drawAge(rng: Rng): number {
  const r = rng.next();
  if (r < 0.08) return 16 + Math.floor(rng.next() * 4);
  if (r < 0.8) return 20 + Math.round(((rng.next() + rng.next()) / 2) * 20);
  return 41 + Math.floor(29.99 * rng.next() ** 1.3);
}

export function drawMbti(rng: Rng): string {
  return (chance(rng, 0.5) ? 'E' : 'I') + (chance(rng, 0.42) ? 'N' : 'S') + (chance(rng, 0.52) ? 'F' : 'T') + (chance(rng, 0.45) ? 'P' : 'J');
}

/** Correlated with E/I but noisy: some introverts are outgoing, some extroverts shy. */
export function drawTemperament(rng: Rng, extrovert: boolean): Temperament {
  const s = (extrovert ? 0.66 : 0.34) + gaussian(rng) * 0.17;
  return s < 0.2 ? 'shy' : s < 0.4 ? 'reserved' : s < 0.6 ? 'easygoing' : s < 0.8 ? 'outgoing' : 'loud';
}

function drawEnglish(rng: Rng, c: Culture, age: number): EnglishLevel {
  if (c.native) return 'native';
  const [f, g, b] = c.level ?? [0.35, 0.45, 0.2];
  const older = age >= 55;
  const young = age < 30;
  return pickW<EnglishLevel>(rng, [['fluent', f * (young ? 1.3 : older ? 0.7 : 1)], ['good', g], ['basic', b * (older ? 1.5 : young ? 0.8 : 1)]]);
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '').slice(0, 10) || 'x';

function nameFrom(rng: Rng, c: Culture, gender: 'w' | 'm', age: number, avoid: Set<string>): string {
  const old = gender === 'w' ? c.names.wOld : c.names.mOld;
  const pool = age >= 50 && old?.length ? old : c.names[gender];
  const fresh = pool.filter((n) => !avoid.has(n.toLowerCase()));
  return pickR(rng, fresh.length ? fresh : pool);
}

function firstName(rng: Rng, c: Culture, g: Gender, age: number, avoid: Set<string>): string {
  if (g === 'nonbinary') {
    const fresh = NEUTRAL_NAMES.filter((n) => !avoid.has(n.toLowerCase()));
    return pickR(rng, fresh.length ? fresh : NEUTRAL_NAMES);
  }
  return nameFrom(rng, c, g === 'woman' ? 'w' : 'm', age, avoid);
}

function drawJob(rng: Rng, age: number, english: EnglishLevel): { title: string; phrase: string; cat: JobCat; topics: Partial<Record<Topic, number>> } {
  const ok = JOBS.filter((j) => age >= j.ages[0] && age <= j.ages[1] && (!j.fluent || english === 'native' || english === 'fluent'));
  const job = pickW(rng, ok.map((j) => [j, j.w] as [typeof j, number]));
  const subject = pickR(rng, SUBJECTS);
  return { title: job.title.replace('{subject}', subject), phrase: job.phrase.replace('{subject}', subject), cat: job.cat, topics: job.topics ?? {} };
}

function partnerOf(rng: Rng, c: Culture, g: Gender, age: number, avoid: Set<string>): { word: string; name: string } {
  const same = chance(rng, 0.12);
  const theirs: 'w' | 'm' = g === 'nonbinary' ? (chance(rng, 0.5) ? 'w' : 'm') : (g === 'woman') !== same ? 'm' : 'w';
  const name = nameFrom(rng, c, theirs, age, avoid);
  const generic = g === 'nonbinary' || chance(rng, 0.25);
  const word = generic ? 'partner' : age < 30 ? (theirs === 'w' ? 'girlfriend' : 'boyfriend') : theirs === 'w' ? 'wife' : 'husband';
  return { word, name };
}

function drawFamily(rng: Rng, c: Culture, g: Gender, age: number, avoid: Set<string>): { text: string; pet?: string } {
  const p = chance(rng, age < 20 ? 0.35 : 0.45) ? pickR(rng, PETS) : null;
  const pet = p ? `a ${p.kind} called ${pickR(rng, p.names)}` : undefined;
  const kidName = () => nameFrom(rng, c, chance(rng, 0.5) ? 'w' : 'm', 20, avoid);
  if (age <= 19) {
    const sib = chance(rng, 0.5) ? `a little ${chance(rng, 0.5) ? 'brother' : 'sister'} called ${kidName()}` : `an older ${chance(rng, 0.5) ? 'brother' : 'sister'} who never lets you use the bathroom`;
    return { text: `You live with your parents and ${sib}${pet ? `, plus ${pet}` : ''}.`, pet };
  }
  if (age <= 29) {
    const r = rng.next();
    if (r < 0.38) return { text: `You share a flat with ${kidName()}${pet ? ` and ${pet}` : ''}.`, pet };
    if (r < 0.62) return { text: `You still live with your parents${pet ? ` and ${pet}` : ''}, which is cheaper.`, pet };
    if (r < 0.85) {
      const pt = partnerOf(rng, c, g, age, avoid);
      return { text: `You live with your ${pt.word} ${pt.name}${pet ? ` and ${pet}` : ''}.`, pet };
    }
    return { text: `You live on your own${pet ? ` with ${pet}` : ''}.`, pet };
  }
  if (age <= 49) {
    const r = rng.next();
    const pt = partnerOf(rng, c, g, age, avoid);
    if (r < 0.55) {
      const kids = chance(rng, 0.5) ? `two kids, ${kidName()} and ${kidName()}` : `a ${3 + Math.floor(rng.next() * 12)}-year-old called ${kidName()}`;
      return { text: `You live with your ${pt.word} ${pt.name} and ${kids}${pet ? `, and ${pet}` : ''}.`, pet };
    }
    if (r < 0.78) return { text: `You live with your ${pt.word} ${pt.name}${pet ? ` and ${pet}` : ''}.`, pet };
    if (r < 0.9) return { text: `You're divorced and have the kids every other weekend${pet ? `; ${pet} lives with you` : ''}.`, pet };
    return { text: `You live on your own${pet ? ` with ${pet}` : ''} and like it that way.`, pet };
  }
  const pt = partnerOf(rng, c, g, age, avoid);
  if (age <= 62) return { text: `Your kids have grown up and moved out, so it's you and your ${pt.word} ${pt.name} now${pet ? `, and ${pet}` : ''}.`, pet };
  return { text: `You live with your ${pt.word} ${pt.name}, and your grandkids visit most Sundays${pet ? `; ${pet} hides from them` : ''}.`, pet };
}

function drawCommute(rng: Rng, age: number, cat: JobCat): string {
  const ok = COMMUTES.filter((x) => (!x.ages || (age >= x.ages[0] && age <= x.ages[1])) && (!x.cats || x.cats.includes(cat)));
  return pickW(rng, ok.map((x) => [x.text, x.w ?? 1] as [string, number])).replace('{car}', pickR(rng, CARS));
}

function drawDevice(rng: Rng, age: number, cat: JobCat): Device {
  if (age >= 60) return pickW<Device>(rng, [['phone', 0.5], ['tablet', 0.3], ['computer', 0.2]]);
  if (cat === 'office' || cat === 'creative' || cat === 'student') return pickW<Device>(rng, [['phone', 0.75], ['laptop', 0.25]]);
  return chance(rng, 0.05) ? 'laptop' : 'phone';
}

function drawLikes(rng: Rng, age: number, mbti: string, place: Place, c: Culture): { likes: string[]; topics: Topic[] } {
  const ok = HOBBIES.filter((h) => !h.ages || (age >= h.ages[0] && age <= h.ages[1]));
  const n = chance(rng, 0.6) ? 2 : 3;
  const picked: typeof ok = [];
  for (let i = 0; i < n; i++) {
    const left = ok.filter((h) => !picked.includes(h));
    picked.push(pickW(rng, left.map((h) => [h, h.likes && [...h.likes].some((x) => mbti.includes(x)) ? 2 : 1] as [typeof h, number])));
  }
  const teams = place.teams?.length ? place.teams : c.teams ?? [];
  const team = teams.length ? pickR(rng, teams) : null;
  return { likes: picked.map((h) => (h.text.includes('{team}') ? (team ? h.text.replace('{team}', team) : 'watching football on TV') : h.text)), topics: picked.flatMap((h) => h.topics) };
}

function drawScene(rng: Rng, slot: Slot, cat: JobCat, age: number) {
  const fits = SCENES.filter((s) => s.slots.includes(slot) && (!s.cats || s.cats.includes(cat)) && (!s.ages || (age >= s.ages[0] && age <= s.ages[1])));
  // every job category has a scene for every time of day today; if the pools ever change, any scene of the hour will do
  const ok = fits.length ? fits : SCENES.filter((s) => s.slots.includes(slot));
  return pickW(rng, ok.map((s) => [s, s.cats ? 2.5 : 1] as [typeof s, number]));
}

function meal(rng: Rng, c: Culture, k: 'breakfast' | 'lunch' | 'dinner'): string {
  const own = c.food?.[k] ?? [];
  return own.length && chance(rng, 0.65) ? pickR(rng, own) : pickR(rng, GENERIC_FOOD[k]);
}

function drawAte(rng: Rng, c: Culture, slot: Slot): string {
  switch (slot) {
    case 'morning':
      return chance(rng, 0.25) ? 'nothing yet, just a coffee' : meal(rng, c, 'breakfast');
    case 'afternoon':
      return `${meal(rng, c, 'breakfast')} this morning and ${meal(rng, c, 'lunch')} for lunch`;
    case 'evening':
      return chance(rng, 0.5) ? `${meal(rng, c, 'lunch')} for lunch, and dinner is not sorted yet` : `${meal(rng, c, 'lunch')} for lunch and ${meal(rng, c, 'dinner')} for dinner`;
    case 'night':
      return `${meal(rng, c, 'dinner')} for dinner and ${pickR(rng, GENERIC_FOOD.snack)} just now`;
  }
}

function drawInterests(rng: Rng, age: number, mbti: string, job: Partial<Record<Topic, number>>, hobbyTopics: Topic[]): Topic[] {
  const l = letters(mbti);
  const w: Record<Topic, number> = { local: 1, news: 0.6, sport: 0.8, music: 0.8, food: 1, weather: 0.7, work: 1, hot_take: 0.8 };
  for (const [t, v] of Object.entries(job)) w[t as Topic] += v ?? 0;
  for (const t of hobbyTopics) w[t] += 1.2;
  if (age >= 55) Object.assign(w, { weather: w.weather + 0.8, news: w.news + 0.6, local: w.local + 0.5 });
  if (age < 25) Object.assign(w, { music: w.music + 0.6, hot_take: w.hot_take + 0.5 });
  if (l.N) Object.assign(w, { hot_take: w.hot_take + 0.5, news: w.news + 0.3 });
  else Object.assign(w, { food: w.food + 0.3, local: w.local + 0.3, weather: w.weather + 0.2 });
  if (l.E) Object.assign(w, { sport: w.sport + 0.2, music: w.music + 0.2 });
  const out: Topic[] = [];
  while (out.length < 4) out.push(pickW(rng, TOPICS.filter((t) => !out.includes(t)).map((t) => [t, w[t]] as [Topic, number])));
  return out;
}

function drawMood(rng: Rng, slot: Slot): { mood: string; why: string } {
  const mood = pickW(rng, Object.entries(MOODS).map(([k, m]) => [k, m.slots?.includes(slot) ? 2 : 1] as [string, number]));
  return { mood, why: pickR(rng, MOODS[mood].why) };
}

export interface GenOptions {
  /** the round's start (ms epoch): local time, scene and food follow it */
  at: number;
  /** first names already in the cast (lowercase) */
  avoidNames?: Set<string>;
}

/** One person from (seed, index). Deterministic. */
export function generatePersona(seed: string, index: number, opts: GenOptions): GeneratedPersona {
  const rng = createRng(`persona|${seed}|${index}`);
  const avoid = opts.avoidNames ?? new Set<string>();
  const age = drawAge(rng);
  const gender = pickW<Gender>(rng, [['woman', 0.48], ['man', 0.48], ['nonbinary', 0.04]]);
  const place = pickW(rng, PLACES.map((x) => [x, x.w] as [Place, number]));
  const c = CULTURES[place.culture];
  const english = drawEnglish(rng, c, age);
  const mbti = drawMbti(rng);
  const temperament = drawTemperament(rng, mbti[0] === 'E');
  const name = firstName(rng, c, gender, age, avoid);
  avoid.add(name.toLowerCase());
  const job = drawJob(rng, age, english);
  const family = drawFamily(rng, c, gender, age, avoid);
  const device = drawDevice(rng, age, job.cat);
  const { likes, topics } = drawLikes(rng, age, mbti, place, c);
  const { slot } = localTime(place.tz, opts.at);
  const scene = drawScene(rng, slot, job.cat, age);
  const { mood, why } = drawMood(rng, slot);
  const detail = DETAILS.filter((d) => !d.ages || (age >= d.ages[0] && age <= d.ages[1]));
  const details = chance(rng, 0.6) ? [pickR(rng, detail).text.replace('{city}', place.city).replace('{trip}', pickR(rng, TRIPS.filter((t) => t !== place.city)))] : [];
  const quirkPool = QUIRKS.filter((q) => (!q.ages || (age >= q.ages[0] && age <= q.ages[1])) && (q.text !== "You're very proud of your pet." || family.pet));
  const quirks = pickSome(rng, quirkPool.filter((q) => !q.letters || [...q.letters].some((x) => mbti.includes(x)) || chance(rng, 0.3)), chance(rng, 0.25) ? 2 : chance(rng, 0.75) ? 1 : 0).map((q) => q.text);
  const person: Person = {
    name, age, gender, mbti, temperament, mood, moodWhy: why,
    home: { city: place.city, region: place.region, country: place.country, tz: place.tz, culture: place.culture },
    english,
    language: english === 'native' ? undefined : place.language ?? c.language,
    job: { title: job.title, phrase: job.phrase, cat: job.cat },
    family: family.text,
    commute: drawCommute(rng, age, job.cat),
    device,
    likes,
    details,
    quirks,
    scenes: [{ when: [slot], now: scene.now, sees: scene.sees, ate: drawAte(rng, c, slot) }],
    interests: drawInterests(rng, age, mbti, job.topics, topics),
  };
  const id = `g${seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'x'}-${index}-${slug(name)}`;
  const model = pickW(rng, GEN_MODELS);
  // the style is derived once and stored, so the snapshot is self-contained
  person.style = deriveStyle({ ...person, style: undefined }, createRng(`style|${id}`));
  if (place.slang?.length && person.english === 'native' && chance(rng, 0.6)) person.style.slang = [...new Set([...(person.style.slang ?? []), pickR(rng, place.slang)])].slice(0, 3);
  return { id, person, model };
}

/** A round's generated cast: `count` people, one level each (1, 2, 3, 1, ...), no repeated first names. */
export function generateCast(seed: string, count: number, at: number, avoidNames: Iterable<string> = []): (GeneratedPersona & { level: Level })[] {
  const avoid = new Set([...avoidNames].map((n) => n.toLowerCase()));
  const out: (GeneratedPersona & { level: Level })[] = [];
  for (let i = 0; i < count; i++) out.push({ ...generatePersona(seed, i, { at, avoidNames: avoid }), level: ((i % 3) + 1) as Level });
  return out;
}
