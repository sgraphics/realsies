// Dev probe: which request option disables reasoning per NEAR AI enclave model, plus latency and
// signature availability. Uses a few cheap calls. Never prints the API key.
// Usage: node tools/probe-nearai.mjs [model ...] [--variants a,b] [--sig] [--opener] [--multi]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, '../../.env');
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const KEY = process.env.NEAR_AI_API_KEY || env.NEAR_AI_API_KEY;
const BASE = 'https://cloud-api.near.ai/v1';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const models = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--variants'));
const VARIANTS = {
  none: {},
  ctk_enable_thinking: { chat_template_kwargs: { enable_thinking: false } },
  ctk_thinking: { chat_template_kwargs: { thinking: false } },
  thinking_disabled: { thinking: { type: 'disabled' } },
  reasoning_effort_none: { reasoning_effort: 'none' },
  reasoning_disabled: { reasoning: { enabled: false } },
  both: { chat_template_kwargs: { enable_thinking: false }, thinking: { type: 'disabled' } },
  effort_low: { reasoning_effort: 'low' },
  effort_minimal: { reasoning_effort: 'minimal' },
  ctk_reasoning_false: { chat_template_kwargs: { reasoning: false } },
  thinking_disabled_ctk_thinking: { thinking: { type: 'disabled' }, chat_template_kwargs: { thinking: false } },
};
const variants = (opt('--variants') || 'none').split(',');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const out = path.resolve(here, '../data/probe');
fs.mkdirSync(out, { recursive: true });

const PROMPT = 'You are Mia, 24, a barista in Leeds, playing an online chat game. Write like a real person texting: short, lowercase, casual. Never use lists or markdown.';
function messagesFor() {
  if (flag('--opener')) return [
    { role: 'system', content: PROMPT },
    { role: 'system', content: 'Your gamertag in this chat is RedFox435; the game generated it, you did not choose it. Game record: 0123456789abcdef.' },
  ];
  if (flag('--multi')) return [
    { role: 'system', content: PROMPT },
    { role: 'system', content: 'Your gamertag in this chat is RedFox435; the game generated it, you did not choose it. Game record: 0123456789abcdef.' },
    { role: 'user', content: 'hey' },
    { role: 'user', content: 'are you a bot lol' },
  ];
  return [
    { role: 'system', content: PROMPT },
    { role: 'system', content: 'Your gamertag in this chat is RedFox435; the game generated it, you did not choose it. Game record: 0123456789abcdef.' },
    { role: 'user', content: 'hey whats up, where are you from?' },
  ];
}

async function one(model, vname) {
  const body = { model, messages: messagesFor(), stream: false, max_tokens: 120, ...VARIANTS[vname] };
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  const t0 = Date.now();
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', body: bytes,
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'x-no-aliasing': 'true', Authorization: `Bearer ${KEY}` },
  });
  const resp = Buffer.from(await r.arrayBuffer());
  const ms = Date.now() - t0;
  let j = null; try { j = JSON.parse(resp.toString('utf8')); } catch {}
  const msg = j?.choices?.[0]?.message || {};
  const usage = j?.usage || {};
  console.log(`\n[${model}] [${vname}] http=${r.status} ${ms}ms enc=${r.headers.get('content-encoding')}`);
  if (!r.ok) { console.log('  ', resp.toString('utf8').slice(0, 400)); return; }
  console.log(`  content=${JSON.stringify(msg.content)}`);
  console.log(`  reasoning_content=${msg.reasoning_content ? JSON.stringify(String(msg.reasoning_content).slice(0, 120)) : msg.reasoning_content} finish=${j.choices?.[0]?.finish_reason}`);
  console.log(`  usage=${JSON.stringify(usage)}`);
  const tag = `${model.replace(/[^a-z0-9]+/gi, '_')}-${vname}-${Date.now()}`;
  fs.writeFileSync(path.join(out, `${tag}.req.json`), bytes);
  fs.writeFileSync(path.join(out, `${tag}.resp.json`), resp);
  if (flag('--sig')) {
    const t1 = Date.now();
    for (let i = 0; i < 30; i++) {
      const s = await fetch(`${BASE}/signature/${j.id}?signing_algo=ecdsa`, { headers: { Accept: 'application/json', Authorization: `Bearer ${KEY}` } });
      const st = await s.text();
      if (s.ok && st.includes('signature')) {
        const sj = JSON.parse(st);
        const [m, h1, h2] = sj.text.split(':').length === 3 ? sj.text.split(':') : [null, ...sj.text.split(':')];
        console.log(`  signature after ${Date.now() - t1}ms try ${i + 1}: kind=${sj.signature_kind} signer=${sj.signing_address} model_ok=${m === model} req_ok=${h1 === sha(bytes)} resp_ok=${h2 === sha(resp)}`);
        fs.writeFileSync(path.join(out, `${tag}.sig.json`), st);
        break;
      }
      if (i === 0 || i % 5 === 4) console.log(`  sig try ${i + 1}: ${s.status} ${st.slice(0, 120)}`);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}

for (const model of models) for (const v of variants) {
  try { await one(model, v); } catch (e) { console.log(`[${model}] [${v}] error ${e.message}`); }
}
