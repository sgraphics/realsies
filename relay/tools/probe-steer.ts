// Dev probe: run steer-v1 templates (src/bot/intents.ts) against the NEAR AI enclave models in a sample
// chat and print what comes back, with latency and cost. Never prints the API key.
// Usage: npx tsx tools/probe-steer.ts [persona-id] [--models glm,deepseek] [--only probe,reply/multi,...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEERING } from '../src/bot/intents.js';
import { MODELS, buildRequest, type ChatTurn } from '../src/models.js';
import { loadConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const KEY = cfg.nearAiKey;
if (!KEY) throw new Error('NEAR_AI_API_KEY missing');
const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const personaId = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'mia-leeds';
const persona = JSON.parse(fs.readFileSync(path.resolve(here, '../personas', `${personaId}.json`), 'utf8'));
const models = (opt('--models') ?? 'glm').split(',').map((m) => (m === 'glm' ? 'z-ai/glm-5.3-flash' : m === 'deepseek' ? 'deepseek-ai/DeepSeek-V4.1-Flash-1017' : m));
const only = opt('--only')?.split(',');
const skin = 'Your gamertag in this chat is Pickle435; the game generated it, you did not choose it. Game record: 0123456789abcdef.';
const CTX: Record<string, ChatTurn[]> = {
  q: [
    { role: 'user', content: 'hey' },
    { role: 'assistant', content: 'hiya' },
    { role: 'user', content: 'so where are you from? and what do you do' },
  ],
  s: [
    { role: 'user', content: 'hey' },
    { role: 'assistant', content: 'hiya, where u from' },
    { role: 'user', content: 'portugal. just chilling at home lol, bored' },
    { role: 'assistant', content: 'nice, never been. jealous of the weather' },
    { role: 'user', content: 'haha yeah its sunny today' },
  ],
};
const history = CTX[opt('--ctx') ?? 'q'];
let usd = 0;
for (const model of models) {
  const custom = opt('--texts') ? JSON.parse(fs.readFileSync(opt('--texts')!, 'utf8')) as { id: string; text: string }[] : null;
  const entries = custom ? custom.map((c) => ({ ...c, intent: c.id })) : STEERING.filter((e) => !only || only.some((o) => e.id === o || e.id.startsWith(o + '/') || e.intent === o));
  for (const e of entries) {
    const msgs: ChatTurn[] = [{ role: 'system', content: persona.prompt }, { role: 'system', content: skin }];
    if (e.intent !== 'opener') msgs.push(...history);
    msgs.push({ role: 'system', content: e.text });
    const body = buildRequest(model, msgs);
    const t0 = Date.now();
    const r = await fetch(`${cfg.nearAiBase}/chat/completions`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true', Authorization: `Bearer ${KEY}` },
    });
    const t = await r.text();
    const ms = Date.now() - t0;
    let j: any = null;
    try { j = JSON.parse(t); } catch { /* not json */ }
    const u = j?.usage ?? {};
    const p = MODELS[model].price;
    const cost = ((u.prompt_tokens ?? 0) * p.input + (u.completion_tokens ?? 0) * p.output) / 1e6;
    usd += cost;
    console.log(`${model.split('/')[1].slice(0, 8)} ${e.id.padEnd(22)} ${String(ms).padStart(5)}ms ${r.ok ? JSON.stringify(j?.choices?.[0]?.message?.content) : t.slice(0, 200)}`);
  }
}
console.log(`total ~$${usd.toFixed(5)}`);
