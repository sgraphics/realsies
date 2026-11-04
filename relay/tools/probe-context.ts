// Dev probe: steering wording in specific chat contexts (follow-ups without a reply, pending questions).
// Usage: npx tsx tools/probe-context.ts <cases.json>   cases: [{persona, model, context: ChatTurn[], steer, n}]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, buildRequest, type ChatTurn } from '../src/models.js';
import { loadConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
if (!cfg.nearAiKey) throw new Error('NEAR_AI_API_KEY missing');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as { label: string; persona: string; model: string; context: ChatTurn[]; steer: string; n?: number }[];
const skin = 'Your gamertag in this chat is Pickle435; the game generated it, you did not choose it. Game record: 0123456789abcdef.';
let usd = 0;
for (const c of cases) {
  const p = JSON.parse(fs.readFileSync(path.resolve(here, '../personas', `${c.persona}.json`), 'utf8'));
  for (let i = 0; i < (c.n ?? 1); i++) {
    const body = buildRequest(c.model, [{ role: 'system', content: p.prompt }, { role: 'system', content: skin }, ...c.context, { role: 'system', content: c.steer }]);
    const r = await fetch(`${cfg.nearAiBase}/chat/completions`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true', Authorization: `Bearer ${cfg.nearAiKey}` },
    });
    const j: any = await r.json().catch(() => null);
    const u = j?.usage ?? {};
    const pr = MODELS[c.model].price;
    usd += ((u.prompt_tokens ?? 0) * pr.input + (u.completion_tokens ?? 0) * pr.output) / 1e6;
    console.log(`${c.label.padEnd(26)} ${c.model.split('/')[1].slice(0, 8)} ${JSON.stringify(j?.choices?.[0]?.message?.content ?? j)}`);
  }
}
console.log(`total ~$${usd.toFixed(5)}`);
