// Players writing in other languages: the relay's detector (src/bot/language.ts) never calls short, sloppy
// English foreign and does flag clear lines in other languages; a persona reads only its own languages; the
// default brain answers with the foreign intent exactly when the persona cannot read the line, and the
// relay puts that intent's published steering note into the signed request.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLanguage, detectLanguage, readsLanguage } from '../src/bot/language.js';
import { DefaultBrainCore } from '../src/bot/brain.js';
import { isSteeringMessage, steeringText } from '../src/bot/intents.js';
import type { BrainAction, BrainEvent, Languages, PersonaCard } from '../src/bot/api.js';
import { LANGUAGE_NAMES } from '../src/persona/languages.js';
import { loadPersonas } from '../src/personas.js';
import { skinMessage } from '../src/formats.js';
import { setLogLevel } from '../src/log.js';
import { ENGLISH, FOREIGN, MAYBE } from './lang-corpus.js';
import { simulateChat } from './sim.js';
import { chainProblem } from './chain-rules.js';

setLogLevel('error');
const here = path.dirname(fileURLToPath(import.meta.url));

test('the detector never calls short, sloppy English foreign', () => {
  const flagged = ENGLISH.map((s) => [s, analyzeLanguage(s)] as const).filter(([, a]) => a.lang);
  assert.deepEqual(flagged.map(([s, a]) => `${s} -> ${a.lang} (${a.why} ${JSON.stringify(a.scores)})`), [], 'English lines flagged as foreign');
  assert.ok(ENGLISH.length > 500, `${ENGLISH.length} English lines`);
  for (const s of MAYBE) assert.doesNotThrow(() => detectLanguage(s));
  for (const s of ['', ' ', '???', '...', '😂', '12345', 'a', 'https://example.com/hola-que-tal']) assert.equal(detectLanguage(s), undefined, JSON.stringify(s));
});

test('the detector flags clear Estonian, German, Spanish, French and Finnish lines, and other languages and scripts', () => {
  const misses: string[] = [];
  for (const [lang, lines] of Object.entries(FOREIGN)) {
    assert.ok(LANGUAGE_NAMES[lang], `${lang} has a name personas can list`);
    for (const s of lines) {
      const a = analyzeLanguage(s);
      if (a.lang !== lang) misses.push(`${lang}: ${s} -> ${a.lang ?? 'none'} (${a.why})`);
    }
  }
  assert.deepEqual(misses, []);
  for (const lang of ['et', 'de', 'es', 'fr', 'fi']) assert.ok(FOREIGN[lang].length >= 13, `${lang}: ${FOREIGN[lang].length} lines`);
  // the lines of the smoke run, typed with and without accents
  for (const [s, lang] of [
    ['Tere! Kuidas sul läheb? Kust sa pärit oled?', 'et'], ['tere, kuidas laheb? mis sa teed praegu', 'et'], ['kas sa oled inimene voi bot', 'et'],
    ['Hallo! Wie geht es dir? Woher kommst du?', 'de'], ['¡Hola! ¿Qué tal? ¿De dónde eres?', 'es'], ['jsp trop, et toi?', 'fr'],
    ['Привіт, як справи? Що ти робиш?', 'uk'], ['Γεια σου, τι κάνεις;', 'el'], ['你好，你在做什么？', 'zh'], ['مرحبا كيف حالك اليوم', 'ar'],
  ] as const) assert.equal(detectLanguage(s), lang, s);
});

test('a persona reads only its languages (and close relatives of the ones it speaks well)', () => {
  const mia: Languages = { en: 'native', fr: 'basic' };
  assert.equal(readsLanguage(mia, 'fr'), true, 'basic school French still reads simple French');
  assert.equal(readsLanguage(mia, 'et'), false);
  assert.equal(readsLanguage({ da: 'native', en: 'fluent' }, 'no'), true, 'a Dane reads Norwegian');
  assert.equal(readsLanguage({ en: 'native', da: 'basic' }, 'no'), false, 'not from a little Danish');
  assert.equal(readsLanguage({ cs: 'native', en: 'good' }, 'sk'), true);
  assert.equal(readsLanguage(undefined, 'et'), undefined, 'a remote persona that does not say');
});

const card = (languages?: Languages): PersonaCard => ({
  id: 'p', model: 'z-ai/glm-5.3-flash', traits: { chatty: 0.5, fast: 0.5, curious: 0.5, guarded: 0.5, drift: 0.5 }, interests: ['music', 'food'], cps: 5, ...(languages ? { languages } : {}),
});

/** The default brain's first say after the player's lines (each [text, lang?] at 1 s, 1.6 s, ...). */
function firstSay(languages: Languages | undefined, lines: [string, string?][], seed: string): BrainAction & { type: 'say' } {
  const core = new DefaultBrainCore({ seed });
  core.on({ type: 'chat_started', at: 0, chatId: 'c', persona: card(languages), level: 1, gamertag: 'Pickle435', chatMs: 120_000 });
  lines.forEach(([text, lang], i) => core.on({ type: 'player_message', at: 1000 + i * 600, id: `m${i}`, text, ...(lang ? { lang } : {}) } as BrainEvent));
  for (let t = 1500; t < 60_000; t += 500) {
    const say = core.on({ type: 'tick', at: t, remainingMs: 120_000 - t }).find((a) => a.type === 'say');
    if (say) return say as BrainAction & { type: 'say' };
  }
  throw new Error('no say');
}

test('the default brain answers with the foreign intent exactly when the persona cannot read the line', () => {
  const EN: Languages = { en: 'native' };
  const MIA: Languages = { en: 'native', fr: 'basic' };
  const MAREK: Languages = { et: 'native', en: 'good', ru: 'good', fi: 'basic' };
  const LENA: Languages = { de: 'native', en: 'fluent' };
  const et = 'Tere! Kuidas sul läheb? Kust sa pärit oled?';
  const cases: [string, Languages | undefined, [string, string?][], boolean][] = [
    ['English only, Estonian', EN, [[et, 'et']], true],
    ['English only, Spanish', EN, [['¿De dónde eres? ¿Qué estás haciendo ahora?', 'es']], true],
    ['English only, English', EN, [['where are you from? what are you up to', undefined]], false],
    ['Leeds, French', MIA, [["Tu viens d'où ? Qu'est-ce que tu fais en ce moment ?", 'fr']], false],
    ['Leeds, Estonian', MIA, [[et, 'et']], true],
    ['Tallinn, Estonian', MAREK, [[et, 'et']], false],
    ['Tallinn, Finnish', MAREK, [['Mistä sinä olet kotoisin?', 'fi']], false],
    ['Tallinn, German', MAREK, [['Woher kommst du? Was machst du gerade?', 'de']], true],
    ['Berlin, German', LENA, [['Woher kommst du? Was machst du gerade?', 'de']], false],
    ['Berlin, Spanish', LENA, [['¿De dónde eres? ¿Qué estás haciendo ahora?', 'es']], true],
    ['Aarhus, Norwegian', { da: 'native', en: 'fluent' }, [['Hvor kommer du fra? Hva gjør du nå?', 'no']], false],
    ['no languages on the card (remote prompt), Estonian', undefined, [[et, 'et']], false],
    ['Estonian, then a short "??"', MIA, [[et, 'et'], ['??', undefined]], true],
    ['Estonian, then English', MIA, [[et, 'et'], ['sorry, where are you from?', undefined]], false],
    ['English, then Estonian', MIA, [['hey there', undefined], [et, 'et']], true],
  ];
  for (const [label, langs, lines, foreign] of cases) {
    for (let i = 0; i < 60; i++) {
      const say = firstSay(langs, lines, `${label}-${i}`);
      assert.equal(say.intent === 'foreign', foreign, `${label} (seed ${i}): ${say.intent}`);
    }
  }
});

test('a chat in Estonian: an English-only persona answers every line with foreign, the Tallinn persona never; signed requests carry the published note', { timeout: 120_000 }, async () => {
  const ps = loadPersonas(path.resolve(here, '../personas'));
  const by = Object.fromEntries(ps.map((p) => [p.id, p]));
  const lines = ['Tere! Kuidas sul läheb? Kust sa pärit oled?', 'Ma olen Tartust. Mida sa praegu teed?', 'Kas sa oled päris inimene või robot?', 'kus sa elad praegu'];
  const tally = async (id: string) => {
    const out = { foreign: 0, other: 0, answers: 0, foreignAnswers: 0, langs: new Set<string>() };
    for (let i = 0; i < 12; i++) {
      const r = await simulateChat({ persona: by[id], seed: `et-${id}-${i}`, player: { lines, opensP: 1 } });
      let pending = false; // a player line arrived since the last say started
      for (const e of r.session.trace) {
        if (e.k !== 'event') continue;
        const d = e.d as BrainEvent;
        if (d.type === 'player_message') {
          out.langs.add(d.lang ?? 'none');
          pending = true;
        }
        if (d.type === 'say_started') {
          if (d.intent.intent !== 'opener') d.intent.intent === 'foreign' ? out.foreign++ : out.other++;
          if (pending) out.answers++, d.intent.intent === 'foreign' && out.foreignAnswers++;
          pending = false;
        }
      }
      const rows = r.store.loadCompletions();
      for (const row of rows) for (const m of (JSON.parse(row.request).messages as { role: string; content: string }[]).slice(2)) if (m.role === 'system') assert.ok(isSteeringMessage(m.content));
      if (rows.length) {
        const comps = rows.map((x) => ({ request: x.request, response: x.response, displayed: JSON.parse(x.displayed ?? '[]') as string[] }));
        assert.equal(chainProblem(comps, JSON.parse(rows[0].request).messages[0].content, skinMessage('Pickle435', 'abababababababab')), null);
        if (id === 'mia-leeds') assert.ok(rows.some((x) => x.request.includes(JSON.stringify(steeringText({ intent: 'foreign' })).slice(1, -1)) || x.request.includes('[steer-v1/foreign]')), 'the foreign note is in a signed request');
      }
    }
    return out;
  };
  const mia = await tally('mia-leeds');
  const marek = await tally('marek-tallinn');
  console.log(`  Estonian player: Mia (Leeds) answered ${mia.foreignAnswers} of ${mia.answers} lines with foreign (${mia.foreign} of ${mia.foreign + mia.other} says after the opener); Marek (Tallinn) ${marek.foreignAnswers} of ${marek.answers}`);
  assert.deepEqual([...mia.langs], ['et'], 'every line reached the brain as Estonian');
  assert.ok(mia.answers >= 10 && mia.foreignAnswers === mia.answers, 'Mia answers every Estonian line with foreign');
  assert.equal(marek.foreign, 0, 'Marek reads Estonian and answers as usual');
  assert.ok(marek.answers >= 10);
});
