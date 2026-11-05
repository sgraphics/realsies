// Input checks for the AI builders API: access requests (POST /api/agents/request) and persona
// submissions (POST /api/botmaster/personas). Both are untrusted JSON from the internet.
import type { AgentAccessRequest, BuilderKind, Level } from '../../../shared/protocol.js';
import { GameError } from '../game/game.js';
import { MODELS } from '../models.js';
import { TOPICS, type Languages, type PersonaTraits, type Topic } from '../bot/api.js';
import { parseLanguages } from '../persona/languages.js';
import { STEER_PARAGRAPH } from '../persona/prompt.js';
import { isAccountId } from '../bot/remote.js';
import type { ModelListing } from '../nearai/client.js';

/** An HTTP error with the field it is about (the body carries `field` when set). */
export class ApiError extends GameError {
  constructor(code: string, message: string, status = 400, readonly field?: string) {
    super(code, message, status);
  }
}

export const BUILDER_KINDS: BuilderKind[] = ['llm_operator', 'chat_vendor', 'voice_vendor', 'researcher', 'other'];

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
// control characters other than tab and newline
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/;

const bad = (field: string, message: string) => new ApiError('invalid_request', `${field}: ${message}`, 400, field);

function text(raw: unknown, field: string, o: { max: number; required?: boolean; multiline?: boolean }): string | undefined {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '' && !o.required)) {
    if (o.required) throw bad(field, 'is required');
    return undefined;
  }
  if (typeof raw !== 'string') throw bad(field, 'must be a string');
  const s = raw.replace(/\r\n?/g, '\n').trim();
  if (!s) throw bad(field, 'is required');
  if (s.length > o.max) throw bad(field, `at most ${o.max} characters`);
  if (CONTROL.test(s) || (!o.multiline && /[\n\t]/.test(s))) throw bad(field, o.multiline ? 'contains control characters' : 'must be one line of text');
  return s;
}

/** A normalized AgentAccessRequest, or an ApiError naming the first bad field. */
export function validateAccessRequest(raw: unknown): AgentAccessRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('invalid_request', 'the body must be a JSON object (AgentAccessRequest)');
  const b = raw as Record<string, unknown>;
  const name = text(b.name, 'name', { max: 100, required: true })!;
  const email = text(b.email, 'email', { max: 254, required: true })!.toLowerCase();
  if (!EMAIL.test(email)) throw bad('email', 'is not an email address');
  const company = text(b.company, 'company', { max: 100 });
  const website = text(b.website, 'website', { max: 200 });
  if (website !== undefined) {
    let u: URL | null = null;
    try {
      u = new URL(website);
    } catch {
      /* below */
    }
    if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.')) throw bad('website', 'must be an http or https address');
  }
  if (typeof b.kind !== 'string' || !(BUILDER_KINDS as string[]).includes(b.kind)) throw bad('kind', `must be one of ${BUILDER_KINDS.join(', ')}`);
  const models = text(b.models, 'models', { max: 1000, required: true, multiline: true })!;
  const goal = text(b.goal, 'goal', { max: 2000, required: true, multiline: true })!;
  const volume = text(b.volume, 'volume', { max: 200 });
  let payoutAccount: string | undefined;
  if (b.payoutAccount !== undefined && b.payoutAccount !== null && b.payoutAccount !== '') {
    if (typeof b.payoutAccount !== 'string' || !isAccountId(b.payoutAccount.trim().toLowerCase())) throw bad('payoutAccount', 'must be a NEAR account id, e.g. acme.testnet');
    payoutAccount = b.payoutAccount.trim().toLowerCase();
  }
  if (b.agreeTerms !== true) throw bad('agreeTerms', 'you must agree to the terms (true)');
  const out: AgentAccessRequest = { name, email, kind: b.kind as BuilderKind, models, goal, agreeTerms: true };
  if (company !== undefined) out.company = company;
  if (website !== undefined) out.website = website;
  if (volume !== undefined) out.volume = volume;
  if (payoutAccount !== undefined) out.payoutAccount = payoutAccount;
  return out;
}

export interface PersonaSubmission {
  /** the botmaster's own short name for it; the relay's id is `<botmaster>-<slug>` */
  slug?: string;
  model: string;
  prompt: string;
  levels: Level[];
  brain: 'default' | 'remote';
  cps?: number;
  traits?: Partial<PersonaTraits>;
  summary?: string;
  interests?: Topic[];
  languages?: Languages;
}

const PERSONA_FIELDS = ['id', 'model', 'prompt', 'levels', 'brain', 'typing', 'cps', 'traits', 'interests', 'languages'];
const DIALS = ['chatty', 'fast', 'curious', 'guarded', 'drift'] as const;
export const PROMPT_MIN = 200;
export const PROMPT_MAX = 6000;
export const SLUG = /^[a-z][a-z0-9-]{1,30}$/;

/** A persona submission, checked field by field (the model is checked against NEAR AI in checkModel). */
export function validatePersona(raw: unknown): { sub: PersonaSubmission; warnings: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('invalid_request', 'the body must be a JSON object (a persona)');
  const b = raw as Record<string, unknown>;
  const unknown = Object.keys(b).find((k) => !PERSONA_FIELDS.includes(k));
  if (unknown) throw bad(unknown, `unknown field; a persona has ${PERSONA_FIELDS.join(', ')}`);
  const warnings: string[] = [];
  let slug: string | undefined;
  if (b.id !== undefined) {
    if (typeof b.id !== 'string' || !SLUG.test(b.id)) throw bad('id', 'lowercase letters, digits and dashes, starting with a letter, 2 to 31 characters');
    slug = b.id;
  }
  if (typeof b.model !== 'string' || !b.model) throw bad('model', 'is required: a NEAR AI enclave model id, e.g. z-ai/glm-5.3-flash');
  if (typeof b.prompt !== 'string') throw bad('prompt', 'is required: the exact system prompt of the persona');
  const prompt = b.prompt.replace(/\r\n?/g, '\n');
  if (prompt.trim().length < PROMPT_MIN || prompt.length > PROMPT_MAX) throw bad('prompt', `${PROMPT_MIN} to ${PROMPT_MAX} characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(prompt)) throw bad('prompt', 'contains control characters');
  if (!prompt.includes(STEER_PARAGRAPH)) warnings.push('the prompt does not contain the steering paragraph (docs/bot-api.md section 5); without it the model may mention the steering notes');
  if (/\[\s*steer/i.test(prompt)) warnings.push('the prompt contains "[steer": a reply that echoes it is dropped');
  if (!Array.isArray(b.levels) || !b.levels.length || b.levels.some((l) => ![1, 2, 3].includes(l as number))) throw bad('levels', 'a non-empty list of 1, 2 and 3');
  const levels = [...new Set(b.levels as Level[])].sort() as Level[];
  let brain: 'default' | 'remote' = 'default';
  if (b.brain !== undefined) {
    if (b.brain !== 'default' && b.brain !== 'remote') throw bad('brain', '"default" (the relay\'s brain) or "remote" (your brain over /bot/ws)');
    brain = b.brain;
  }
  let cps: number | undefined;
  const rawCps = b.cps ?? (b.typing && typeof b.typing === 'object' ? (b.typing as Record<string, unknown>).cps : undefined);
  if (b.typing !== undefined && (typeof b.typing !== 'object' || b.typing === null || Object.keys(b.typing).some((k) => k !== 'cps'))) throw bad('typing', 'only {"cps": number}');
  if (rawCps !== undefined) {
    if (typeof rawCps !== 'number' || !(rawCps >= 2 && rawCps <= 9)) throw bad('cps', 'typing speed from 2 to 9 characters a second');
    cps = rawCps;
  }
  let traits: Partial<PersonaTraits> | undefined;
  let summary: string | undefined;
  if (b.traits !== undefined) {
    if (!b.traits || typeof b.traits !== 'object' || Array.isArray(b.traits)) throw bad('traits', `an object of dials (${DIALS.join(', ')}, each 0 to 1) and an optional summary`);
    const t = b.traits as Record<string, unknown>;
    const extra = Object.keys(t).find((k) => k !== 'summary' && !(DIALS as readonly string[]).includes(k));
    if (extra) throw bad(`traits.${extra}`, `unknown dial; dials are ${DIALS.join(', ')}`);
    traits = {};
    for (const k of DIALS) {
      if (t[k] === undefined) continue;
      if (typeof t[k] !== 'number' || !((t[k] as number) >= 0 && (t[k] as number) <= 1)) throw bad(`traits.${k}`, 'a number from 0 to 1');
      traits[k] = t[k] as number;
    }
    if (t.summary !== undefined) summary = text(t.summary, 'traits.summary', { max: 200 });
  }
  let interests: Topic[] | undefined;
  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests) || !b.interests.length || b.interests.some((x) => !(TOPICS as readonly string[]).includes(x as string))) throw bad('interests', `a non-empty list from ${TOPICS.join(', ')}`);
    interests = [...new Set(b.interests as Topic[])];
  }
  let languages: Languages | undefined;
  if (b.languages !== undefined) {
    try {
      languages = parseLanguages(b.languages, 'languages');
    } catch (e) {
      throw new ApiError('invalid_request', (e as Error).message, 400, 'languages');
    }
  }
  return { sub: { slug, model: b.model, prompt, levels, brain, cps, traits, summary, interests, languages }, warnings };
}

/** Why a model cannot be used for a persona, or null: owned by nearai in /v1/models, known to the relay, two system messages. */
export function modelProblem(model: string, listing: ModelListing[]): string | null {
  const supported = Object.values(MODELS).filter((m) => m.multiSystem).map((m) => m.id);
  const l = listing.find((m) => m.id === model);
  if (!l) return `${model} is not served by NEAR AI Cloud (/v1/models); use one of ${supported.join(', ')}`;
  if (l.owned_by !== 'nearai') return `${model} is owned by ${l.owned_by || 'someone else'}, not nearai: only NEAR AI's own enclave models sign every completion inside the enclave`;
  const m = MODELS[model];
  if (!m) return `${model} is an enclave model the relay does not run yet (its request options are not measured); use one of ${supported.join(', ')}`;
  if (!m.multiSystem) return `${model} rejects a second system message, which every chat needs (the per-chat tag); use one of ${supported.join(', ')}`;
  return null;
}
