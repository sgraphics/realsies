// Bot personas from relay/personas/*.json. The prompt is the exact committed string (message 0).
import fs from 'node:fs';
import path from 'node:path';
import type { Level } from '../../shared/protocol.js';
import { promptHash } from './formats.js';
import { MODELS } from './models.js';

export interface Persona {
  id: string;
  levels: Level[];
  model: string;
  prompt: string;
  promptHash: string;
  typing: { msPerChar: number };
  replyLength: 'short' | 'medium' | 'long';
  traits: string;
}

export function loadPersonas(dir: string): Persona[] {
  if (!fs.existsSync(dir)) throw new Error(`personas folder not found: ${dir}`);
  const out: Persona[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const where = `${f}:`;
    if (typeof raw.id !== 'string' || !raw.id) throw new Error(`${where} id`);
    if (!Array.isArray(raw.levels) || raw.levels.some((l: unknown) => ![1, 2, 3].includes(l as number))) throw new Error(`${where} levels`);
    if (typeof raw.prompt !== 'string' || raw.prompt.length < 50) throw new Error(`${where} prompt`);
    const m = MODELS[raw.model];
    if (!m) throw new Error(`${where} unknown model ${raw.model}`);
    if (!m.multiSystem) throw new Error(`${where} model ${raw.model} rejects a second system message (spec message 1)`);
    out.push({
      id: raw.id,
      levels: raw.levels,
      model: raw.model,
      prompt: raw.prompt,
      promptHash: promptHash(raw.prompt),
      typing: { msPerChar: Number(raw.typing?.msPerChar) || 45 },
      replyLength: raw.replyLength ?? 'short',
      traits: raw.traits ?? '',
    });
  }
  const ids = new Set<string>();
  for (const p of out) {
    if (ids.has(p.id)) throw new Error(`duplicate persona id ${p.id}`);
    ids.add(p.id);
  }
  return out;
}
