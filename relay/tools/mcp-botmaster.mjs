#!/usr/bin/env node
// Minimal MCP server (stdio, JSON-RPC 2.0, one JSON message per line) for Realsies botmasters.
// Tools:
//   bot_api_docs      the bot API (docs/bot-api.md), whole or one section
//   request_persona   validate a persona and write a pending registration request for the operator
// Nothing here touches a relay, a chain or a model. The operator reviews requests in
// relay/botmasters/requests/ (or REALSIES_REQUESTS_DIR) and installs accepted ones by hand.
//
//   claude mcp add realsies-botmaster -- node relay/tools/mcp-botmaster.mjs
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(here, '../../docs/bot-api.md');
const REQUESTS = process.env.REALSIES_REQUESTS_DIR ?? path.resolve(here, '../botmasters/requests');
const MODELS = ['z-ai/glm-5.3-flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'];
const TOPICS = ['local', 'news', 'sport', 'music', 'food', 'weather', 'work', 'hot_take'];
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const STEER_PARAGRAPH = 'Sometimes a note in square brackets comes after the chat';

const TOOLS = [
  {
    name: 'bot_api_docs',
    description: 'The Realsies bot API (realsies-brain/1, steer-v1): events, actions, intents and their fixed steering notes, timing limits, how the relay executes a say, what is signed, persona registration and remote brains over /bot/ws. Pass a section heading to get just that section.',
    inputSchema: { type: 'object', properties: { section: { type: 'string', description: 'part of a section heading, e.g. "Remote brains" or "limits"' } } },
  },
  {
    name: 'request_persona',
    description: 'Ask the Realsies operator to register a bot persona driven by your remote brain. Validates the persona and writes a pending request file; the operator reviews it. Send only the sha256 of your botmaster token, never the token.',
    inputSchema: {
      type: 'object',
      required: ['botmaster', 'contact', 'persona'],
      properties: {
        botmaster: { type: 'string', description: 'your botmaster name, lowercase letters, digits and dashes' },
        contact: { type: 'string', description: 'how the operator reaches you' },
        tokenSha256: { type: 'string', description: 'sha256 hex of your botmaster token (node relay/examples/remote-brain.mjs --hash <token>)' },
        persona: {
          type: 'object',
          required: ['id', 'levels', 'model', 'prompt'],
          properties: {
            id: { type: 'string' },
            levels: { type: 'array', items: { type: 'integer', enum: [1, 2, 3] } },
            model: { type: 'string', enum: MODELS },
            prompt: { type: 'string', description: 'the exact system prompt; it is committed by sha256 every round' },
            typing: { type: 'object', properties: { cps: { type: 'number', minimum: 2, maximum: 9 } } },
            traits: { type: 'object', properties: { summary: { type: 'string' }, chatty: { type: 'number' }, fast: { type: 'number' }, curious: { type: 'number' }, guarded: { type: 'number' }, drift: { type: 'number' } } },
            interests: { type: 'array', items: { type: 'string', enum: TOPICS } },
            payout: { type: 'string', description: 'NEAR account credited with the character share' },
          },
        },
      },
    },
  },
];

function docs(section) {
  const text = fs.readFileSync(DOCS, 'utf8');
  if (!section) return text;
  const parts = text.split(/^(?=## )/m);
  const hit = parts.find((p) => p.split('\n')[0].toLowerCase().includes(String(section).toLowerCase()));
  return hit ?? `No section matches "${section}". Sections: ${parts.map((p) => p.split('\n')[0].replace(/^#+ /, '')).join('; ')}`;
}

function validate(a) {
  const errs = [];
  const warn = [];
  if (typeof a?.botmaster !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(a.botmaster)) errs.push('botmaster: lowercase letters, digits and dashes, 2 to 41 characters');
  if (typeof a?.contact !== 'string' || a.contact.trim().length < 3) errs.push('contact is required');
  if (a?.tokenSha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(a.tokenSha256))) errs.push('tokenSha256 must be 64 lowercase hex (the hash, never the token)');
  const p = a?.persona ?? {};
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(p.id)) errs.push('persona.id: lowercase letters, digits and dashes');
  if (!Array.isArray(p.levels) || !p.levels.length || p.levels.some((l) => ![1, 2, 3].includes(l))) errs.push('persona.levels: a list of 1, 2, 3');
  if (!MODELS.includes(p.model)) errs.push(`persona.model: one of ${MODELS.join(', ')}`);
  if (typeof p.prompt !== 'string' || p.prompt.length < 200 || p.prompt.length > 6000) errs.push('persona.prompt: 200 to 6000 characters');
  else if (!p.prompt.includes(STEER_PARAGRAPH)) warn.push('persona.prompt should end with the steering paragraph in docs/bot-api.md section 5');
  if (p.typing?.cps !== undefined && !(p.typing.cps >= 2 && p.typing.cps <= 9)) errs.push('persona.typing.cps: 2 to 9');
  for (const k of ['chatty', 'fast', 'curious', 'guarded', 'drift']) if (p.traits?.[k] !== undefined && !(p.traits[k] >= 0 && p.traits[k] <= 1)) errs.push(`persona.traits.${k}: 0 to 1`);
  if (p.interests !== undefined && (!Array.isArray(p.interests) || !p.interests.length || p.interests.some((t) => !TOPICS.includes(t)))) errs.push(`persona.interests: from ${TOPICS.join(', ')}`);
  if (p.payout !== undefined && (typeof p.payout !== 'string' || !ACCOUNT.test(p.payout) || p.payout.length > 64)) errs.push('persona.payout: a NEAR account id');
  if (JSON.stringify(a ?? {}).match(/"token"\s*:/)) errs.push('do not send the token itself, only tokenSha256');
  return { errs, warn };
}

function requestPersona(a) {
  const { errs, warn } = validate(a);
  if (errs.length) return { isError: true, content: [{ type: 'text', text: `Not filed:\n- ${errs.join('\n- ')}` }] };
  fs.mkdirSync(REQUESTS, { recursive: true });
  const at = new Date().toISOString();
  const file = path.join(REQUESTS, `${at.replace(/[:.]/g, '-')}-${a.botmaster}-${a.persona.id}.json`);
  const persona = { ...a.persona, brain: { remote: a.botmaster } };
  fs.writeFileSync(file, JSON.stringify({ status: 'pending', requestedAt: at, botmaster: a.botmaster, contact: a.contact, tokenSha256: a.tokenSha256 ?? null, persona }, null, 2) + '\n');
  return {
    content: [{
      type: 'text',
      text: `Filed ${file} (pending). The operator reviews it, adds relay/personas/${a.persona.id}.json and relay/botmasters/${a.botmaster}.json, and restarts the relay. Then connect your brain to wss://<relay>/bot/ws (docs section "Remote brains").${warn.length ? `\nWarnings:\n- ${warn.join('\n- ')}` : ''}`,
    }],
  };
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  const reply = (result) => m.id !== undefined && send({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => m.id !== undefined && send({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  try {
    switch (m.method) {
      case 'initialize':
        return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'realsies-botmaster', version: '0.1.0' } });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args } = m.params ?? {};
        if (name === 'bot_api_docs') return reply({ content: [{ type: 'text', text: docs(args?.section) }] });
        if (name === 'request_persona') return reply(requestPersona(args ?? {}));
        return fail(-32602, `unknown tool ${name}`);
      }
      default:
        return fail(-32601, `method not found: ${m.method}`);
    }
  } catch (e) {
    return fail(-32603, e instanceof Error ? e.message : String(e));
  }
});
