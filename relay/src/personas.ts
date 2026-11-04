// Bot personas from relay/personas/*.json, plus the generated ones of each round (src/persona/).
//
// Demo bots (brain "default") are written as attributes, a "person" block (docs/bot-api.md section 10):
//   id, levels, model                  required
//   person                             age, gender, mbti, temperament, mood, home, english, job, family,
//                                      commute, device, likes, details, quirks, scenes, interests, optional
//                                      style overrides (src/persona/model.ts parsePerson)
//   payout, brain                      optional, as below
// Their prompt (message 0), typing speed, brain dials and reveal card are derived from the attributes;
// the prompt also carries the local time of the round's start, so it is composed per round (atRound).
//
// Personas driven by a botmaster's remote brain may instead bring their own prompt, untouched:
//   id, levels, model, prompt          required; prompt is the exact committed string
//   typing.cps                         phone typing speed in characters a second (default 5)
//   traits.summary                     one line about the persona (not sent anywhere)
//   traits.chatty/fast/curious/guarded/drift   0..1 dials for the default brain when it stands in (default 0.5)
//   interests                          tangent topics, from TOPICS in src/bot/api.ts
//   payout                             account credited with the character's share (default: the bots account)
//   brain                              "default" or { "remote": "<botmaster name>" }
import fs from 'node:fs';
import path from 'node:path';
import type { Level } from '../../shared/protocol.js';
import { promptHash } from './formats.js';
import { MODELS } from './models.js';
import { TOPICS, type PersonaTraits, type Topic } from './bot/api.js';
import { createRng } from './bot/rng.js';
import { cardOf, deriveCps, deriveStyle, deriveTraits, parsePerson, summaryOf, type Person, type RevealCard, type Style } from './persona/model.js';
import { composePrompt } from './persona/prompt.js';
import type { GeneratedPersona } from './persona/generate.js';

export type BrainRef = { kind: 'default' } | { kind: 'remote'; botmaster: string };

export interface Persona {
  id: string;
  levels: Level[];
  model: string;
  prompt: string;
  promptHash: string;
  /** phone typing speed, characters a second */
  cps: number;
  traits: PersonaTraits;
  summary: string;
  interests: Topic[];
  brain: BrainRef;
  /** payout account for this persona's characters; undefined = the configured bots account */
  payout?: string;
  /** "attributes": hand-written person block; "generated": this round's generator; "prompt": a hand-written prompt (remote brains) */
  source: 'attributes' | 'generated' | 'prompt';
  /** demo bots: who they are, how they write, and the card revealed after settlement */
  person?: Person;
  style?: Style;
  card?: RevealCard;
}

const dial = (v: unknown, where: string): number => {
  if (v === undefined) return 0.5;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new Error(`${where} must be a number from 0 to 1`);
  return v;
};

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** A persona from its attributes, with the prompt for a round that starts at `at`. */
export function fromPerson(base: { id: string; levels: Level[]; model: string; brain: BrainRef; payout?: string; source: 'attributes' | 'generated' }, person: Person, at: number): Persona {
  const style = deriveStyle(person, createRng(`style|${base.id}`));
  const traits = deriveTraits(person);
  const prompt = composePrompt(person, style, at);
  return {
    ...base,
    prompt,
    promptHash: promptHash(prompt),
    cps: deriveCps(person, traits.fast, base.id),
    traits,
    summary: summaryOf(person),
    interests: [...person.interests],
    person,
    style,
    card: cardOf(person, style),
  };
}

/** This round's version of a persona: attribute personas get the prompt for the round's start time. */
export function atRound(p: Persona, at: number): Persona {
  if (!p.person) return p;
  return fromPerson({ id: p.id, levels: p.levels, model: p.model, brain: p.brain, payout: p.payout, source: p.source === 'generated' ? 'generated' : 'attributes' }, p.person, at);
}

/** A generated person as a persona serving one level. */
export function fromGenerated(g: GeneratedPersona, level: Level, at: number): Persona {
  return fromPerson({ id: g.id, levels: [level], model: g.model, brain: { kind: 'default' }, source: 'generated' }, g.person, at);
}

export function parsePersona(raw: any, where: string, at = Date.now()): Persona {
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(raw.id)) throw new Error(`${where} id`);
  if (!Array.isArray(raw.levels) || !raw.levels.length || raw.levels.some((l: unknown) => ![1, 2, 3].includes(l as number))) throw new Error(`${where} levels`);
  const m = MODELS[raw.model];
  if (!m) throw new Error(`${where} unknown model ${raw.model}`);
  if (!m.multiSystem) throw new Error(`${where} model ${raw.model} rejects a second system message (spec message 1)`);
  let brain: BrainRef = { kind: 'default' };
  if (raw.brain !== undefined && raw.brain !== 'default') {
    if (!raw.brain || typeof raw.brain.remote !== 'string' || !raw.brain.remote) throw new Error(`${where} brain must be "default" or {"remote": "<botmaster>"}`);
    brain = { kind: 'remote', botmaster: raw.brain.remote };
  }
  if (raw.payout !== undefined && (typeof raw.payout !== 'string' || raw.payout.length < 2 || raw.payout.length > 64 || !ACCOUNT.test(raw.payout)))
    throw new Error(`${where} payout must be a NEAR account id`);
  if (raw.person !== undefined) {
    for (const k of ['prompt', 'typing', 'traits', 'interests'])
      if (raw[k] !== undefined) throw new Error(`${where} ${k} is derived from the person block; remove it`);
    const person = parsePerson(raw.person, where);
    return fromPerson({ id: raw.id, levels: [...new Set(raw.levels as Level[])].sort(), model: raw.model, brain, payout: raw.payout, source: 'attributes' }, person, at);
  }
  if (brain.kind === 'default') throw new Error(`${where} a demo persona (default brain) needs a person block with the full attribute set; a bare prompt is for remote brains`);
  if (typeof raw.prompt !== 'string' || raw.prompt.length < 50) throw new Error(`${where} prompt`);
  const t = raw.traits && typeof raw.traits === 'object' ? raw.traits : {};
  const summary = typeof raw.traits === 'string' ? raw.traits : typeof t.summary === 'string' ? t.summary : '';
  const interests: Topic[] = raw.interests === undefined ? [...TOPICS] : raw.interests;
  if (!Array.isArray(interests) || !interests.length || interests.some((x) => !(TOPICS as readonly string[]).includes(x)))
    throw new Error(`${where} interests must be a non-empty list from ${TOPICS.join(', ')}`);
  const cps = raw.typing?.cps === undefined ? 5 : Number(raw.typing.cps);
  if (!(cps >= 2 && cps <= 9)) throw new Error(`${where} typing.cps must be from 2 to 9`);
  return {
    id: raw.id,
    levels: raw.levels,
    model: raw.model,
    prompt: raw.prompt,
    promptHash: promptHash(raw.prompt),
    cps,
    traits: {
      chatty: dial(t.chatty, `${where} traits.chatty`), fast: dial(t.fast, `${where} traits.fast`), curious: dial(t.curious, `${where} traits.curious`),
      guarded: dial(t.guarded, `${where} traits.guarded`), drift: dial(t.drift, `${where} traits.drift`),
    },
    summary,
    interests: [...new Set(interests)],
    brain,
    payout: raw.payout,
    source: 'prompt',
  };
}

/** The personas folder, with prompts composed for `at` (re-composed per round with atRound). */
export function loadPersonas(dir: string, at = Date.now()): Persona[] {
  if (!fs.existsSync(dir)) throw new Error(`personas folder not found: ${dir}`);
  const out: Persona[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    out.push(parsePersona(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), `${f}:`, at));
  }
  const ids = new Set<string>();
  for (const p of out) {
    if (ids.has(p.id)) throw new Error(`duplicate persona id ${p.id}`);
    ids.add(p.id);
  }
  return out;
}
