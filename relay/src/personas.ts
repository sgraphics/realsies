// Bot personas from relay/personas/*.json. The prompt is the exact committed string (message 0).
// Format (docs/bot-api.md "Registering a persona"):
//   id, levels, model, prompt          required
//   typing.cps                         phone typing speed in characters a second (default 5)
//   traits.summary                     one line about the persona (not sent anywhere)
//   traits.chatty / fast / curious     0..1 dials for the brain (default 0.5)
//   interests                          tangent topics, from TOPICS in src/bot/api.ts
//   payout                             account credited with the character's share (default: the bots account)
//   brain                              "default" or { "remote": "<botmaster name>" }
import fs from 'node:fs';
import path from 'node:path';
import type { Level } from '../../shared/protocol.js';
import { promptHash } from './formats.js';
import { MODELS } from './models.js';
import { TOPICS, type PersonaTraits, type Topic } from './bot/api.js';

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
}

const dial = (v: unknown, where: string): number => {
  if (v === undefined) return 0.5;
  if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new Error(`${where} must be a number from 0 to 1`);
  return v;
};

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function parsePersona(raw: any, where: string): Persona {
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(raw.id)) throw new Error(`${where} id`);
  if (!Array.isArray(raw.levels) || !raw.levels.length || raw.levels.some((l: unknown) => ![1, 2, 3].includes(l as number))) throw new Error(`${where} levels`);
  if (typeof raw.prompt !== 'string' || raw.prompt.length < 50) throw new Error(`${where} prompt`);
  const m = MODELS[raw.model];
  if (!m) throw new Error(`${where} unknown model ${raw.model}`);
  if (!m.multiSystem) throw new Error(`${where} model ${raw.model} rejects a second system message (spec message 1)`);
  const t = raw.traits && typeof raw.traits === 'object' ? raw.traits : {};
  const summary = typeof raw.traits === 'string' ? raw.traits : typeof t.summary === 'string' ? t.summary : '';
  const interests: Topic[] = raw.interests === undefined ? [...TOPICS] : raw.interests;
  if (!Array.isArray(interests) || !interests.length || interests.some((x) => !(TOPICS as readonly string[]).includes(x)))
    throw new Error(`${where} interests must be a non-empty list from ${TOPICS.join(', ')}`);
  let brain: BrainRef = { kind: 'default' };
  if (raw.brain !== undefined && raw.brain !== 'default') {
    if (!raw.brain || typeof raw.brain.remote !== 'string' || !raw.brain.remote) throw new Error(`${where} brain must be "default" or {"remote": "<botmaster>"}`);
    brain = { kind: 'remote', botmaster: raw.brain.remote };
  }
  if (raw.payout !== undefined && (typeof raw.payout !== 'string' || raw.payout.length < 2 || raw.payout.length > 64 || !ACCOUNT.test(raw.payout)))
    throw new Error(`${where} payout must be a NEAR account id`);
  const cps = raw.typing?.cps === undefined ? 5 : Number(raw.typing.cps);
  if (!(cps >= 2 && cps <= 9)) throw new Error(`${where} typing.cps must be from 2 to 9`);
  return {
    id: raw.id,
    levels: raw.levels,
    model: raw.model,
    prompt: raw.prompt,
    promptHash: promptHash(raw.prompt),
    cps,
    traits: { chatty: dial(t.chatty, `${where} traits.chatty`), fast: dial(t.fast, `${where} traits.fast`), curious: dial(t.curious, `${where} traits.curious`) },
    summary,
    interests: [...new Set(interests)],
    brain,
    payout: raw.payout,
  };
}

export function loadPersonas(dir: string): Persona[] {
  if (!fs.existsSync(dir)) throw new Error(`personas folder not found: ${dir}`);
  const out: Persona[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    out.push(parsePersona(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), `${f}:`));
  }
  const ids = new Set<string>();
  for (const p of out) {
    if (ids.has(p.id)) throw new Error(`duplicate persona id ${p.id}`);
    ids.add(p.id);
  }
  return out;
}
