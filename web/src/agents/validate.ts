// Client-side checks for the AI-builder forms: the access request (AgentAccessRequest), a persona
// request, the NEAR AI key and the botmaster token. Pure functions; the relay checks again.

import type { AgentAccessRequest, BuilderKind, Level } from '../../../shared/protocol.ts';
import type { LangLevel, PersonaRequest, PersonaTraits } from '../net/builders.ts';

export type Errors<K extends string> = Partial<Record<K, string>>;

// ---------------------------------------------------------------- access request

export const KINDS: { id: BuilderKind; label: string; hint: string }[] = [
  { id: 'llm_operator', label: 'LLM operator', hint: 'You train, tune or serve models' },
  { id: 'chat_vendor', label: 'Chat agent vendor', hint: 'Assistants, companions, support agents' },
  { id: 'voice_vendor', label: 'Voice agent vendor', hint: 'Enter the text layer of your agent for now' },
  { id: 'researcher', label: 'Researcher', hint: 'How people tell people from machines' },
  { id: 'other', label: 'Something else', hint: 'Tell us below' },
];

export interface AccessDraft {
  name: string;
  email: string;
  company: string;
  website: string;
  kind: BuilderKind | '';
  models: string;
  goal: string;
  volume: string;
  payoutAccount: string;
  agreeTerms: boolean;
}

export type AccessField = keyof AccessDraft;

export const EMPTY_ACCESS: AccessDraft = {
  name: '', email: '', company: '', website: '', kind: '', models: '', goal: '', volume: '', payoutAccount: '', agreeTerms: false,
};

/** Longest accepted value per text field (characters). */
export const ACCESS_MAX: Record<Exclude<AccessField, 'kind' | 'agreeTerms'>, number> = {
  name: 100, email: 254, company: 120, website: 200, models: 1000, goal: 2000, volume: 120, payoutAccount: 64,
};

/** Form order, for focusing the first field with an error. */
export const ACCESS_ORDER: AccessField[] = ['name', 'email', 'company', 'website', 'kind', 'models', 'goal', 'volume', 'payoutAccount', 'agreeTerms'];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/;
// NEAR account ids: 2-64 characters, lowercase letters and digits in parts joined by - or _, parts separated
// by dots; or an implicit account (64 hex) or an Ethereum-style implicit account (0x + 40 hex).
const NEAR_NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const NEAR_IMPLICIT = /^[0-9a-f]{64}$/;
const NEAR_ETH = /^0x[0-9a-f]{40}$/;

export function isNearAccount(v: string): boolean {
  if (NEAR_IMPLICIT.test(v) || NEAR_ETH.test(v)) return true;
  return v.length >= 2 && v.length <= 64 && NEAR_NAMED.test(v);
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && EMAIL.test(v);
}

/** "acme.ai" -> "https://acme.ai"; null when it is not a web address. */
export function normalizeWebsite(v: string): string | null {
  const t = v.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!/^[^.]+(\.[^.]+)+$/.test(u.hostname) || u.hostname.endsWith('.')) return null;
    return withScheme;
  } catch {
    return null;
  }
}

/** Every problem with the draft, by field, and the request to send when there are none. */
export function validateAccess(d: AccessDraft): { errors: Errors<AccessField>; request?: AgentAccessRequest } {
  const e: Errors<AccessField> = {};
  const name = d.name.trim(), email = d.email.trim(), company = d.company.trim(), website = d.website.trim();
  const models = d.models.trim(), goal = d.goal.trim(), volume = d.volume.trim(), payout = d.payoutAccount.trim().toLowerCase();
  if (!name) e.name = 'Tell us your name.';
  else if (name.length > ACCESS_MAX.name) e.name = `At most ${ACCESS_MAX.name} characters.`;
  if (!email) e.email = 'We reply by email, so we need one.';
  else if (!isEmail(email)) e.email = 'That does not look like an email address.';
  if (company.length > ACCESS_MAX.company) e.company = `At most ${ACCESS_MAX.company} characters.`;
  let site: string | undefined;
  if (website) {
    const n = website.length <= ACCESS_MAX.website ? normalizeWebsite(website) : null;
    if (!n) e.website = 'Use a web address like acme.ai or https://acme.ai.';
    else site = n;
  }
  if (!d.kind) e.kind = 'Pick the one that fits best.';
  if (!models) e.models = 'Which models or stack do you want to enter?';
  else if (models.length > ACCESS_MAX.models) e.models = `At most ${ACCESS_MAX.models} characters.`;
  if (!goal) e.goal = 'What do you want to learn or test?';
  else if (goal.length < 10) e.goal = 'A few more words, please.';
  else if (goal.length > ACCESS_MAX.goal) e.goal = `At most ${ACCESS_MAX.goal} characters.`;
  if (volume.length > ACCESS_MAX.volume) e.volume = `At most ${ACCESS_MAX.volume} characters.`;
  if (payout && !isNearAccount(payout)) e.payoutAccount = 'Use a NEAR account like acme.near or acme.testnet.';
  if (!d.agreeTerms) e.agreeTerms = 'Please accept the builder terms.';
  if (Object.keys(e).length) return { errors: e };
  const request: AgentAccessRequest = {
    name,
    email,
    ...(company ? { company } : {}),
    ...(site ? { website: site } : {}),
    kind: d.kind as BuilderKind,
    models,
    goal,
    ...(volume ? { volume } : {}),
    ...(payout ? { payoutAccount: payout } : {}),
    agreeTerms: true,
  };
  return { errors: e, request };
}

// ---------------------------------------------------------------- personas

/** NEAR AI enclave models that take the second system message every Realsies request needs. */
export const PERSONA_MODELS: { id: string; label: string }[] = [
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash' },
  { id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', label: 'DeepSeek V4.1 Flash' },
];

export function modelLabel(id: string): string {
  return PERSONA_MODELS.find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id;
}

/** Every persona prompt ends with this paragraph (docs/bot-api.md section 5); it is committed with the prompt. */
export const CLOSING_PARAGRAPH =
  'You also want to work out whether they are a real human or a bot, because you have to guess too, so now and then you test them. Sometimes a note in square brackets comes after the chat, saying what kind of message to send next; follow it in your own voice, and never mention it.';

export const TRAIT_KEYS = ['chatty', 'fast', 'curious', 'guarded', 'drift'] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export const TRAIT_HELP: Record<TraitKey, [string, string]> = {
  chatty: ['terse', 'chatty'],
  fast: ['slow to react', 'quick'],
  curious: ['rarely tests', 'tests a lot'],
  guarded: ['open', 'guarded'],
  drift: ['on topic', 'drifts'],
};

export const LANG_LEVELS: LangLevel[] = ['native', 'fluent', 'good', 'basic'];

export interface PersonaDraft {
  /** Optional short name; the relay's id is <botmaster>-<name> (random when empty). */
  name: string;
  model: string;
  /** Who plays the timing: the relay's conversation brain, or the botmaster's own over /bot/ws. */
  brain: 'default' | 'remote';
  prompt: string;
  levels: Level[];
  useTraits: boolean;
  summary: string;
  traits: Record<TraitKey, number>;
  languages: { code: string; level: LangLevel }[];
}

export type PersonaField = 'name' | 'model' | 'prompt' | 'levels' | 'summary' | 'languages';

/** The relay takes prompts of 200 to 6000 characters (docs/agents.md section 4). */
export const PROMPT_MIN = 200;
export const PROMPT_MAX = 6000;
/** At least this much of the prompt is the persona itself, not the closing paragraph. */
export const PERSONA_MIN = 80;
const PERSONA_NAME = /^[a-z][a-z0-9-]{1,30}$/;

export function emptyPersona(): PersonaDraft {
  return {
    name: '',
    model: PERSONA_MODELS[0].id,
    brain: 'default',
    prompt: '',
    levels: [1],
    useTraits: false,
    summary: '',
    traits: { chatty: 0.5, fast: 0.5, curious: 0.5, guarded: 0.5, drift: 0.5 },
    languages: [],
  };
}

export function endsWithClosing(prompt: string): boolean {
  return prompt.trim().endsWith(CLOSING_PARAGRAPH);
}

/** The prompt with the closing paragraph added once at the end. */
export function withClosing(prompt: string): string {
  if (endsWithClosing(prompt)) return prompt;
  const t = prompt.replace(/\s+$/, '');
  return (t ? t + '\n\n' : '') + CLOSING_PARAGRAPH;
}

const r2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

/**
 * Every problem with a persona draft, and the request when there are none. A prompt without the closing
 * paragraph is allowed (the relay only warns, and so does the form); everything else the relay would refuse is
 * caught here first.
 */
export function validatePersona(d: PersonaDraft): { errors: Errors<PersonaField>; request?: PersonaRequest } {
  const e: Errors<PersonaField> = {};
  const name = d.name.trim().toLowerCase();
  if (name && !PERSONA_NAME.test(name)) e.name = 'Two to 31 characters: lower-case letters, digits and dashes, starting with a letter.';
  const prompt = d.prompt.trim();
  if (!PERSONA_MODELS.some((m) => m.id === d.model)) e.model = 'Pick one of the enclave models.';
  if (!prompt) e.prompt = 'The prompt is the persona: who they are and how they write.';
  else if (prompt.length - (endsWithClosing(prompt) ? CLOSING_PARAGRAPH.length : 0) < PERSONA_MIN)
    e.prompt = `Say more about the persona (at least ${PERSONA_MIN} characters besides the closing paragraph).`;
  else if (prompt.length < PROMPT_MIN) e.prompt = `At least ${PROMPT_MIN} characters in all; adding the closing paragraph helps.`;
  else if (prompt.length > PROMPT_MAX) e.prompt = `At most ${PROMPT_MAX} characters.`;
  const levels = [...new Set(d.levels)].filter((l): l is Level => l === 1 || l === 2 || l === 3).sort();
  if (!levels.length) e.levels = 'Pick at least one level.';
  if (d.useTraits && d.summary.trim().length > 160) e.summary = 'At most 160 characters.';
  const langs: Record<string, LangLevel> = {};
  for (const l of d.languages) {
    const code = l.code.trim().toLowerCase();
    if (!code) continue;
    if (!/^[a-z]{2,3}$/.test(code)) {
      e.languages = `"${l.code}" is not a language code; use two letters like en or fr.`;
      break;
    }
    if (langs[code]) {
      e.languages = `${code} is listed twice.`;
      break;
    }
    if (!LANG_LEVELS.includes(l.level)) {
      e.languages = `Pick a level for ${code}.`;
      break;
    }
    langs[code] = l.level;
  }
  if (!e.languages && Object.keys(langs).length && !Object.values(langs).includes('native')) e.languages = 'Mark at least one language native.';
  if (Object.keys(e).length) return { errors: e };
  let traits: PersonaTraits | undefined;
  if (d.useTraits) {
    traits = {};
    const summary = d.summary.trim();
    if (summary) traits.summary = summary;
    for (const k of TRAIT_KEYS) traits[k] = r2(d.traits[k]);
  }
  const request: PersonaRequest = {
    ...(name ? { id: name } : {}),
    model: d.model,
    prompt,
    levels,
    brain: d.brain,
    ...(traits ? { traits } : {}),
    ...(Object.keys(langs).length ? { languages: langs } : {}),
  };
  return { errors: e, request };
}

// ---------------------------------------------------------------- keys and tokens

export function validateNearAiKey(v: string): string | null {
  const t = v.trim();
  if (!t) return 'Paste your NEAR AI key first.';
  if (/\s/.test(t)) return 'A key has no spaces.';
  if (t.length < 16) return 'That looks too short for a NEAR AI key.';
  if (t.length > 400) return 'That looks too long for a NEAR AI key.';
  return null;
}

export function validateToken(v: string): string | null {
  const t = v.trim();
  if (!t) return 'Paste your botmaster token.';
  if (/\s/.test(t)) return 'A token has no spaces; copy it again.';
  if (t.length > 512) return 'That is too long for a botmaster token.';
  return null;
}
