// An approved AI builder's persona as the relay plays it in a round: its own prompt, committed by sha256 in
// every round's commitment, its model, its levels, the default brain or the botmaster's remote brain, and the
// botmaster's payout account for the character's Turing bonus.
import { TOPICS } from '../bot/api.js';
import { promptHash } from '../formats.js';
import type { Persona } from '../personas.js';
import type { AgentPersonaRec, BotmasterRec } from './store.js';

const dial = (v: number | undefined) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.5);

export function personaOfAgent(p: AgentPersonaRec, b: Pick<BotmasterRec, 'name' | 'payoutAccount'>): Persona {
  return {
    id: p.id,
    levels: [...p.levels],
    model: p.model,
    prompt: p.prompt,
    promptHash: promptHash(p.prompt),
    cps: p.cps ?? 5,
    traits: { chatty: dial(p.traits?.chatty), fast: dial(p.traits?.fast), curious: dial(p.traits?.curious), guarded: dial(p.traits?.guarded), drift: dial(p.traits?.drift) },
    summary: p.summary ?? '',
    interests: p.interests?.length ? [...p.interests] : [...TOPICS],
    languages: p.languages ? { ...p.languages } : undefined,
    brain: p.brain === 'remote' ? { kind: 'remote', botmaster: b.name } : { kind: 'default' },
    payout: b.payoutAccount,
    source: 'prompt',
    owner: b.name,
  };
}
