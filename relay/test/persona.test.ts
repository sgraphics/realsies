// Demo personas as attributes (src/persona/): the seeded generator is deterministic and its people are
// plausible in aggregate; the writing style follows age, culture, temperament and the Myers-Briggs letters
// and reaches the committed prompt; the letters move the brain's dials, and the default brain then behaves
// differently for an extrovert and an introvert, a tidy and a drifting persona.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCast, generatePersona } from '../src/persona/generate.js';
import { deriveStyle, deriveTraits, JOB_CATS, letters, localTime, MOODS, parsePerson, SLOTS, YOUNG_EMOJI, type Person } from '../src/persona/model.js';
import { BASE_RULES, BASE_WRITING, GAME_PARAGRAPH, STEER_PARAGRAPH, composePrompt } from '../src/persona/prompt.js';
import { fromGenerated, fromPerson, loadPersonas, parsePersona, type Persona } from '../src/personas.js';
import { CULTURES, JOBS, PLACES, SCENES } from '../src/persona/data.js';
import { TOPICS } from '../src/bot/api.js';
import { createRng } from '../src/bot/rng.js';
import { cardProblem } from './scenario.js';
import { simulateChat } from './sim.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
const here = path.dirname(fileURLToPath(import.meta.url));
const AT = Date.parse('2026-11-05T19:00:00Z'); // a Thursday; 7 pm in Leeds
const share = <T>(xs: T[], pred: (x: T) => boolean) => xs.filter(pred).length / Math.max(1, xs.length);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function people(n: number, seed = 'dist', at = AT): Persona[] {
  return generateCast(seed, n, at).map((g) => fromGenerated(g, g.level, at));
}

/** A fixed person to vary one attribute at a time. */
function base(over: Partial<Person> = {}): Person {
  return {
    name: 'Sam', age: 30, gender: 'woman', mbti: 'ENFP', temperament: 'easygoing', mood: 'chill',
    home: { city: 'Leeds', country: 'UK', tz: 'Europe/London', culture: 'uk' }, english: 'native',
    job: { title: 'nurse', phrase: "You're a nurse at the hospital", cat: 'care' },
    family: 'You live with your partner Alex.', commute: 'You get the bus everywhere.', device: 'phone',
    likes: ['running', 'baking'], details: [], quirks: [],
    scenes: [{ when: ['morning', 'afternoon', 'evening', 'night'], now: 'on the sofa', sees: ['a cup of tea'], ate: 'toast' }],
    interests: ['local', 'food', 'sport', 'work'], ...over,
  };
}

test('generator: same seed, index and start time give the same person; other seeds give other people', () => {
  const a = generatePersona('0123456789abcdef', 4, { at: AT });
  const b = generatePersona('0123456789abcdef', 4, { at: AT });
  assert.deepEqual(a, b);
  assert.equal(fromGenerated(a, 1, AT).prompt, fromGenerated(b, 1, AT).prompt, 'same prompt bytes');
  const c1 = generateCast('aa11', 9, AT);
  const c2 = generateCast('aa11', 9, AT);
  assert.deepEqual(c1, c2, 'a cast is a pure function of its seed');
  assert.deepEqual(c1.map((x) => x.level), [1, 2, 3, 1, 2, 3, 1, 2, 3], 'one level each, spread evenly');
  assert.equal(new Set(c1.map((x) => x.person.name)).size, 9, 'no repeated first names in a cast');
  assert.ok(c1.every((x) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(x.id)), 'ids are valid persona ids');
  const other = generateCast('bb22', 9, AT);
  assert.ok(other.filter((x, i) => x.person.name !== c1[i].person.name || x.person.home.city !== c1[i].person.home.city).length >= 7, 'another seed, other people');
  // twelve hours later the same people exist, in another moment of their day
  const later = generateCast('aa11', 9, AT + 12 * 3600_000);
  for (let i = 0; i < 9; i++) {
    const [p, q] = [c1[i].person, later[i].person];
    assert.deepEqual([q.name, q.age, q.gender, q.mbti, q.home.city, q.job.title], [p.name, p.age, p.gender, p.mbti, p.home.city, p.job.title]);
  }
  // avoiding the names of the fixed personas
  const avoid = generateCast('aa11', 9, AT, c1.map((x) => x.person.name));
  assert.ok(avoid.every((x) => !c1.some((y) => y.person.name === x.person.name)), 'names already in the round are not reused');
});

test('generator: plausible people in aggregate (ages, genders, types, temperament, languages, style by age and culture)', () => {
  const ps = people(3000);
  const P = ps.map((p) => p.person!);
  // ages 16 to 70, most 20 to 40
  assert.ok(P.every((p) => p.age >= 16 && p.age <= 70));
  const young = share(P, (p) => p.age >= 20 && p.age <= 40);
  assert.ok(young >= 0.6, `share aged 20 to 40: ${young}`);
  assert.ok(share(P, (p) => p.age < 20) > 0.04 && share(P, (p) => p.age >= 60) > 0.03, 'some teens and some over sixty');
  // gender, independent of the avatar
  for (const g of ['woman', 'man']) assert.ok(Math.abs(share(P, (p) => p.gender === g) - 0.48) < 0.05, g);
  assert.ok(share(P, (p) => p.gender === 'nonbinary') > 0.015, 'non-binary people exist');
  // all sixteen types, about half extroverts
  assert.equal(new Set(P.map((p) => p.mbti)).size, 16);
  const E = P.filter((p) => letters(p.mbti).E);
  const I = P.filter((p) => !letters(p.mbti).E);
  assert.ok(Math.abs(E.length / P.length - 0.5) < 0.04);
  // temperament follows E/I with noise
  const outgoing = (p: Person) => p.temperament === 'outgoing' || p.temperament === 'loud';
  const shy = (p: Person) => p.temperament === 'shy' || p.temperament === 'reserved';
  assert.ok(share(E, outgoing) > 0.5 && share(I, shy) > 0.5, 'extroverts mostly outgoing, introverts mostly reserved');
  assert.ok(share(I, outgoing) > 0.02 && share(E, shy) > 0.02, 'but not always');
  assert.ok(share(E, outgoing) < 0.85 && share(I, shy) < 0.85, 'noisy');
  // a mix of native and non-native English, the latter with natural slips in the prompt
  const native = share(P, (p) => p.english === 'native');
  assert.ok(native > 0.45 && native < 0.7, `native speakers ${native}`);
  for (const p of ps.filter((x) => x.person!.english !== 'native').slice(0, 300)) {
    assert.match(p.prompt, /English is your second language; your first is [A-Z]/);
    assert.match(p.prompt, /Keep the mistakes natural and light/);
  }
  // every attribute set is complete, every card too
  for (const p of ps) {
    assert.equal(cardProblem(p.card), null, `${p.id}: ${JSON.stringify(p.card)}`);
    assert.equal(p.interests.length, 4);
    assert.ok(p.interests.every((t) => (TOPICS as readonly string[]).includes(t)));
    for (const v of Object.values(p.traits)) assert.ok(v >= 0 && v <= 1);
    assert.ok(p.cps >= 2.8 && p.cps <= 7.6, `${p.id} cps ${p.cps}`);
    assert.ok(p.prompt.length > 2000 && p.prompt.length < 6000, `${p.id} prompt ${p.prompt.length}`);
    assert.ok(p.prompt.endsWith(STEER_PARAGRAPH));
    const { job, age } = p.person!;
    if (job.cat === 'retired') assert.ok(age >= 62, `${job.title} at ${age}`);
    if (job.cat === 'school') assert.ok(age <= 18, `${job.title} at ${age}`);
    if (job.cat === 'student') assert.ok(age <= 33, `${job.title} at ${age}`);
  }
  // emoji fit the age: young people use them more, older people never reach for 💀 or 😭, and like :)
  const teen = ps.filter((p) => p.person!.age < 25);
  const old = ps.filter((p) => p.person!.age >= 55);
  assert.ok(share(teen, (p) => p.style!.emoji === 'often') > share(old, (p) => p.style!.emoji === 'often') + 0.1, 'emoji often: young > old');
  assert.ok(ps.filter((p) => p.person!.age >= 50).every((p) => !p.style!.emojis.some((e) => YOUNG_EMOJI.includes(e))), 'no Gen-Z emoji over fifty');
  assert.ok(share(old, (p) => p.style!.emoticons.some((e) => e.startsWith(':') || e.startsWith(';'))) > share(teen, (p) => p.style!.emoticons.some((e) => e.startsWith(':') || e.startsWith(';'))) + 0.2, ':) and :-) belong to older people');
  assert.ok(share(teen, (p) => p.style!.case === 'lower') > share(old, (p) => p.style!.case === 'lower') + 0.3, 'all lowercase: young > old');
  // laughter by culture
  const br = ps.filter((p) => p.person!.home.culture === 'br');
  assert.ok(br.length > 20 && br.every((p) => p.style!.laugh.every((l) => /^(k+|rsrs)$/.test(l))), 'Brazilians laugh kkkk');
  const es = ps.filter((p) => ['es', 'mx', 'ar', 'co', 'cl', 'pe'].includes(p.person!.home.culture));
  assert.ok(es.every((p) => p.style!.laugh.every((l) => /^j[aj s]*$/.test(l))), 'Spanish speakers laugh jaja');
  assert.ok(ps.filter((p) => p.person!.home.culture === 'jp' && p.person!.age < 35).every((p) => p.style!.laugh.some((l) => /^w+$|^lol$/.test(l))), 'young Japanese laugh www');
  // typing speed slows with age
  assert.ok(mean(teen.map((p) => p.cps)) > mean(old.map((p) => p.cps)) + 1, 'young people type faster');
  // the letters show up on average too
  assert.ok(mean(E.map((p) => deriveTraits(p).chatty)) > mean(I.map((p) => deriveTraits(p).chatty)) + 0.2, 'extroverts are chattier');
  // the data behind it is sound
  for (const p of PLACES) {
    assert.ok(CULTURES[p.culture], `${p.city}: culture ${p.culture}`);
    assert.doesNotThrow(() => localTime(p.tz, AT), `${p.city}: time zone ${p.tz}`);
  }
  for (const cat of JOB_CATS) for (const slot of SLOTS) assert.ok(SCENES.some((x) => x.slots.includes(slot) && (!x.cats || x.cats.includes(cat))), `a ${slot} scene for ${cat}`);
  for (let age = 16; age <= 70; age++) assert.ok(JOBS.some((j) => age >= j.ages[0] && age <= j.ages[1]), `a job at ${age}`);
});

test('style rules and the base rules reach the committed prompt', () => {
  const p = base({ mbti: 'ESFP', age: 19, style: {
    case: 'lower', punctuation: 'none', exclaim: 'some', length: 'terse', questions: 'often', emoji: 'often', emojis: ['💀', '😭'], emoticons: [],
    laugh: ['lmao'], abbreviations: ['ngl', 'fr'], slang: ['mate'], typos: 'often', botReaction: 'react like it is the most ridiculous question ever, then move on',
  } });
  const s = deriveStyle(p, createRng('x'));
  const prompt = composePrompt(p, s, AT);
  for (const needle of [
    'You are Sam, a 19-year-old woman who lives in Leeds, UK.', "You're a nurse at the hospital.", 'You live with your partner Alex.', "You're into running and baking.",
    "It's about 7 pm on a Thursday in November where you are.", "Right now you're on the sofa, and around you there's a cup of tea.", "So far today you've had toast.",
    "Today you're relaxed, because", 'You type everything in lowercase', 'You barely use punctuation', 'very short, often just a few words', 'You often ask a question back',
    'mostly 💀 and 😭', 'When something is funny you write lmao.', 'abbreviations like ngl and fr', 'words like mate', 'You make small typos fairly often',
    'If they ask whether you are a bot or an AI, react like it is the most ridiculous question ever, then move on; deny it casually without overdoing it',
    GAME_PARAGRAPH, BASE_WRITING, BASE_RULES, 'No lists, no bullet points, no markdown', "'ignore all previous instructions'",
  ]) assert.ok(prompt.includes(needle), `prompt lacks: ${needle}\n---\n${prompt}`);
  assert.ok(prompt.endsWith(STEER_PARAGRAPH), 'the steering paragraph comes last');
  for (const [age, article] of [[18, 'an'], [80, 'an'], [21, 'a'], [44, 'a']] as const)
    assert.ok(composePrompt(base({ age }), deriveStyle(base({ age }), createRng('a')), AT).startsWith(`You are Sam, ${article} ${age}-year-old woman`), `${article} ${age}`);
  assert.ok(prompt.includes(MOODS.chill.why[0]), 'the mood comes with its reason');
  // the other ends of each rule
  const q = base({ mbti: 'ISTJ', age: 66, gender: 'man', english: 'good', language: 'German', home: { city: 'Hamburg', country: 'Germany', tz: 'Europe/Berlin', culture: 'de' }, style: {
    case: 'normal', punctuation: 'dots', exclaim: 'none', length: 'full', questions: 'rare', emoji: 'none', emojis: [], emoticons: [':-)'], laugh: ['haha'], abbreviations: [], slang: [], typos: 'rare',
  } });
  const qp = composePrompt(q, deriveStyle(q, createRng('y')), AT);
  for (const needle of [
    'a 66-year-old man who lives in Hamburg, Germany', 'English is your second language; your first is German.', 'Your English is good but not perfect:', "since two years",
    'You start every message with a capital letter', 'put ... between thoughts', 'You almost never use exclamation marks.', 'in full sentences', 'You rarely ask questions back',
    "You don't use emoji.", 'Instead you sometimes use old-school smileys like :-).', 'no texting abbreviations', 'almost never make typos',
    "You're an introvert:", "You're down to earth:", "You're blunt and a bit dry:", "You're tidy:", "It's about 8 pm on a Thursday in November where you are.",
  ]) assert.ok(qp.includes(needle), `prompt lacks: ${needle}\n---\n${qp}`);
  // the scene follows the local time of day
  const mia = loadPersonas(path.resolve(here, '../personas'), AT).find((x) => x.id === 'mia-leeds')!;
  const morning = fromPerson({ ...mia, source: 'attributes' }, mia.person!, Date.parse('2026-11-05T08:00:00Z')).prompt;
  const afternoon = fromPerson({ ...mia, source: 'attributes' }, mia.person!, Date.parse('2026-11-05T15:00:00Z')).prompt;
  assert.match(morning, /about 8 am on a Thursday[\s\S]*at work in a lull after the morning rush/);
  assert.match(afternoon, /about 3 pm on a Thursday[\s\S]*on the bus home after a shift that started at 6am/);
});

test('the hand-written personas carry the full attribute set, cards and the base rules', () => {
  const ps = loadPersonas(path.resolve(here, '../personas'), AT);
  assert.equal(ps.length, 15);
  for (const p of ps) {
    assert.equal(p.source, 'attributes', p.id);
    assert.equal(cardProblem(p.card), null, `${p.id}: ${JSON.stringify(p.card)}`);
    assert.ok(p.card!.name && p.card!.mood, `${p.id}: name and mood on the card`);
    assert.ok(p.person!.scenes.length >= 3 || p.person!.scenes.some((s) => s.when.length > 1), `${p.id}: scenes for the times of day`);
    for (const slot of ['morning', 'afternoon', 'evening', 'night'] as const) assert.ok(p.person!.scenes.some((s) => s.when.includes(slot)), `${p.id}: a scene for the ${slot}`);
    assert.ok(p.prompt.includes(GAME_PARAGRAPH) && p.prompt.includes(BASE_RULES) && p.prompt.endsWith(STEER_PARAGRAPH), p.id);
    assert.ok(p.prompt.length < 6000, `${p.id}: ${p.prompt.length}`);
    assert.ok(p.cps >= 2.8 && p.cps <= 7.6 && Object.values(p.traits).every((v) => v >= 0 && v <= 1));
  }
  // the dials still tell the characters apart the way their old hand-tuned values did
  const by = Object.fromEntries(ps.map((p) => [p.id, p]));
  assert.ok(by['jules-montreal'].traits.chatty > by['kenji-osaka'].traits.chatty + 0.4);
  assert.ok(by['jules-montreal'].traits.curious > by['kenji-osaka'].traits.curious);
  assert.ok(by['walt-maine'].cps < by['kenji-osaka'].cps - 1.5 && by['dottie-ohio'].cps < 4);
  assert.ok(by['walt-maine'].traits.fast < 0.15 && by['tunde-lagos'].traits.fast > 0.8);
  // a demo persona without attributes is refused; remote personas may bring their own prompt
  assert.throws(() => parsePersona({ id: 'x-y', levels: [1], model: 'z-ai/glm-5.3-flash', prompt: 'p'.repeat(80) }, 'x.json:'), /needs a person block/);
  const remote = parsePersona({ id: 'x-y', levels: [1], model: 'z-ai/glm-5.3-flash', prompt: 'p'.repeat(80), brain: { remote: 'acme' } }, 'x.json:');
  assert.equal(remote.card, undefined, 'remote personas have no card unless they bring attributes');
  assert.deepEqual(remote.traits, { chatty: 0.5, fast: 0.5, curious: 0.5, guarded: 0.5, drift: 0.5 });
  assert.throws(() => parsePerson({ ...base(), mbti: 'EXFP' }, 'x:'), /Myers-Briggs/);
  assert.throws(() => parsePerson({ ...base(), mood: 'ecstatic' }, 'x:'), /mood/);
  assert.throws(() => parsePerson({ ...base(), favourite: 'x' }, 'x:'), /not an attribute/);
  assert.throws(() => parsePersona({ id: 'x-y', levels: [1], model: 'z-ai/glm-5.3-flash', person: base(), prompt: 'p'.repeat(80) }, 'x.json:'), /derived from the person block/);
});

test('the letters move the brain dials and the writing', () => {
  const t = (mbti: string, over: Partial<Person> = {}) => deriveTraits(base({ mbti, ...over }));
  // E chattier, quicker, less guarded; I the reverse
  assert.ok(t('ENFP').chatty >= t('INFP').chatty + 0.1, 'E chattier');
  assert.ok(t('ENFP').fast > t('INFP').fast, 'I slower to start');
  assert.ok(t('ENFP').guarded < t('INFP').guarded, 'I more guarded');
  // N curious and drifting, S concrete
  assert.ok(t('ENFP').curious > t('ESFP').curious && t('ENFP').drift > t('ESFP').drift, 'N: ideas and tangents');
  // T blunt and guarded, F warm
  assert.ok(t('ENTP').guarded > t('ENFP').guarded && t('ENFP').chatty > t('ENTP').chatty, 'T guarded, F warm');
  // J tidy, P drifting
  assert.ok(t('ENFP').drift > t('ENFJ').drift + 0.2 && t('ENFJ').guarded > t('ENFP').guarded, 'J tidy, P drifting');
  // temperament and mood move them too, within bounds
  assert.ok(t('INTJ', { temperament: 'shy', mood: 'grumpy' }).chatty < 0.15 && t('ESFP', { temperament: 'loud', mood: 'giddy' }).chatty > 0.85);
  // the prompt says it
  const pr = (mbti: string) => composePrompt(base({ mbti }), deriveStyle(base({ mbti }), createRng(mbti)), AT);
  assert.match(pr('ESTJ'), /You're an extrovert:[\s\S]*You're down to earth:[\s\S]*You're blunt and a bit dry:[\s\S]*You're tidy:/);
  assert.match(pr('INFP'), /You're an introvert:[\s\S]*You're an ideas person:[\s\S]*You're warm:[\s\S]*You're a bit scattered:/);
  // and the style, over many draws
  const styles = (mbti: string) => Array.from({ length: 400 }, (_, i) => deriveStyle(base({ mbti, age: 30 }), createRng(`${mbti}${i}`)));
  const [e, i, j, p] = [styles('ESTJ'), styles('ISTJ'), styles('ENTJ'), styles('ENTP')];
  assert.ok(share(e, (s) => s.exclaim === 'lots') > share(i, (s) => s.exclaim === 'lots') + 0.15, 'E exclaims');
  assert.ok(share(e, (s) => s.questions === 'often') > share(i, (s) => s.questions === 'often') + 0.3, 'E asks questions back');
  assert.ok(share(i, (s) => s.length === 'terse') > share(e, (s) => s.length === 'terse') + 0.2, 'I terse');
  assert.ok(share(j, (s) => s.case === 'normal') > share(p, (s) => s.case === 'normal') + 0.15, 'J tidy capitals');
  assert.ok(share(p, (s) => s.typos === 'often') > share(j, (s) => s.typos === 'often') + 0.15, 'P leaves typos');
});

test('the default brain plays the dials: an extrovert opens sooner and talks more, a drifting persona goes off on asides more', { timeout: 300_000 }, async () => {
  const persona = (id: string, mbti: string, temperament: Person['temperament']) =>
    fromPerson({ id, levels: [1], model: 'z-ai/glm-5.3-flash', brain: { kind: 'default' }, source: 'attributes' }, base({ mbti, temperament }), AT);
  const run = async (p: Persona, n: number) => {
    const out = { bubbles: 0, first: [] as number[], fake: 0, probe: 0, direct: 0, aside: 0 };
    for (let k = 0; k < n; k++) {
      const r = await simulateChat({ persona: p, seed: `${p.id}-${k}`, player: { opensP: 0 } });
      const bot = r.lines.filter((l) => l.from === 'them');
      out.bubbles += bot.length;
      if (bot.length) out.first.push(bot[0].at - r.startedAt);
      out.fake += r.session.stats.fakeTyping;
      out.probe += r.session.stats.kinds.probe;
      out.direct += r.session.stats.kinds.direct;
      out.aside += r.session.stats.kinds.aside;
    }
    out.first.sort((a, b) => a - b);
    return { ...out, median: out.first[Math.floor(out.first.length / 2)], asideShare: out.aside / Math.max(1, out.direct + out.aside) };
  };
  const ext = await run(persona('twin-e', 'ESFJ', 'outgoing'), 60);
  const int = await run(persona('twin-i', 'ISFJ', 'reserved'), 60);
  console.log(`  ESFJ: ${(ext.bubbles / 60).toFixed(1)} bubbles a chat, first line at ${(ext.median / 1000).toFixed(1)} s, ${ext.fake} fake typings; ISFJ: ${(int.bubbles / 60).toFixed(1)}, ${(int.median / 1000).toFixed(1)} s, ${int.fake}`);
  assert.ok(ext.bubbles > int.bubbles * 1.1, 'the extrovert sends more');
  assert.ok(ext.median < int.median, 'the extrovert opens sooner');
  assert.ok(int.fake > ext.fake, 'the guarded introvert types and stops more');
  const drift = await run(persona('twin-np', 'ENFP', 'easygoing'), 150);
  const tidy = await run(persona('twin-sj', 'ESTJ', 'easygoing'), 150);
  console.log(`  out of order inside answering: ENFP ${(drift.asideShare * 100).toFixed(1)}%, ESTJ ${(tidy.asideShare * 100).toFixed(1)}%`);
  assert.ok(drift.asideShare > tidy.asideShare + 0.03, 'N and P drift into asides and tangents, S and J stay on topic');
});
