// Real-model smoke run of the bot engine. An in-process relay on the MOCK chain (never testnet) with
// real NEAR AI enclave models; a scripted human plays a few full chats in parallel; then calls,
// dev end-round, settlement on the mock chain, every bundle through the web app's Verify checks
// (as they are and with the proposed steering change), a transcript with timings, and the spend.
// A budget guard ends the chats early if the NEAR AI spend estimate passes BUDGET_USD.
//
//   npx tsx tools/smoke-bots.ts [chats=3] [--seconds 120] [--budget 0.04]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { MODELS } from '../src/models.js';
import type { Db } from '../src/db.js';
import { WsClient, http } from '../test/client.js';
import { failures, loadBrowserChecks } from '../test/browser-checks.js';
import { charsOf } from '../src/bot/typing.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f: string, d: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const CHATS = Math.min(6, Number(args.find((a) => /^\d+$/.test(a)) ?? 3));
const SECONDS = Number(opt('--seconds', '120'));
const BUDGET = Number(opt('--budget', '0.04'));
const USERS = ['ana', 'ben', 'cleo', 'dex', 'eve', 'finn'].slice(0, CHATS).map((u) => `${u}.realsies.testnet`);

const OPENERS = ['hey', 'hii', 'yo', 'hello?'];
const LINES = [
  'where are you from?', 'lol ok', 'what are you up to today', 'im in lisbon, its weirdly sunny', 'are you a bot tbh',
  'haha no im real. are you?', 'what did you have for lunch', 'my cat just walked across my keyboard', 'thats fair',
  'ok quick one, whats 7 times 8', 'you type kinda fast lol', 'nah im just bored at work', 'wait really?', 'same honestly',
];

interface Ev {
  t: number;
  kind: 'typing_on' | 'typing_off' | 'bot' | 'me' | 'ended';
  text?: string;
}

function spend(db: Db, chatIds: string[]): { usd: number; calls: number; inTok: number; outTok: number } {
  let usd = 0, calls = 0, inTok = 0, outTok = 0;
  for (const id of chatIds) {
    const rows = [...db.loadCompletions(id), ...db.loadDrafts(id)];
    for (const r of rows) {
      try {
        const j = JSON.parse(r.response);
        const m = MODELS[j.model] ?? MODELS[(JSON.parse(r.request) as { model: string }).model];
        const u = j.usage ?? {};
        calls++;
        inTok += u.prompt_tokens ?? 0;
        outTok += u.completion_tokens ?? 0;
        usd += ((u.prompt_tokens ?? 0) * m.price.input + (u.completion_tokens ?? 0) * m.price.output) / 1e6;
      } catch {
        /* failed call: no usage */
      }
    }
  }
  return { usd, calls, inTok, outTok };
}

async function playChat(base: string, account: string, idx: number, log: (s: string) => void) {
  const c = await WsClient.connect(base, account);
  await c.waitT('welcome', 10_000);
  const level = (idx % 2) + 1;
  c.send({ t: 'pick_seat', level: level as 1 | 2, seatIndex: idx, mode: 'paid', coins: 5 });
  const chat = (await c.waitT('matched', 20_000)).chat;
  const started = await c.waitT('chat_started', 60_000, (x) => x.chatId === chat.chatId);
  const t0 = started.startedAt;
  const evs: Ev[] = [];
  const at = () => (Date.now() - t0) / 1000;
  let lastBotAt = 0;
  let myTurnTimer: NodeJS.Timeout | null = null;
  let typingNow = false;
  let lines = [...LINES].sort(() => Math.random() - 0.5);
  let quietDone = false;
  const ws = (c as any).ws as WebSocket;
  const sayLater = (delayMs: number, text: string) => {
    if (myTurnTimer) clearTimeout(myTurnTimer);
    myTurnTimer = setTimeout(() => {
      if (Date.now() > started.endsAt - 3000) return;
      typingNow = true;
      c.send({ t: 'typing', chatId: chat.chatId, on: true });
      myTurnTimer = setTimeout(() => {
        typingNow = false;
        c.send({ t: 'typing', chatId: chat.chatId, on: false });
        if (Date.now() > started.endsAt - 1000) return;
        c.send({ t: 'say', chatId: chat.chatId, text });
        evs.push({ t: at(), kind: 'me', text });
      }, (text.length / 4) * 1000 + 300);
    }, delayMs);
  };
  ws.addEventListener('message', (ev: MessageEvent) => {
    const m = JSON.parse(String(ev.data));
    if (m.chatId !== chat.chatId) return;
    if (m.t === 'typing') evs.push({ t: at(), kind: m.on ? 'typing_on' : 'typing_off' });
    if (m.t === 'message' && m.msg.from === 'them') {
      evs.push({ t: at(), kind: 'bot', text: m.msg.text });
      lastBotAt = Date.now();
      // a person answers after reading; once per chat goes quiet for a while
      if (!quietDone && at() > 45 && Math.random() < 0.5) {
        quietDone = true;
        if (myTurnTimer) clearTimeout(myTurnTimer);
        myTurnTimer = null;
        return;
      }
      if (Math.random() < 0.85 && lines.length) sayLater(1800 + Math.random() * 2500 + m.msg.text.length * 40, lines.shift()!);
    }
    if (m.t === 'chat_ended') evs.push({ t: at(), kind: 'ended' });
  });
  if (Math.random() < 0.5) sayLater(2500 + Math.random() * 3000, OPENERS[idx % OPENERS.length]);
  await c.waitT('chat_ended', SECONDS * 1000 + 30_000, (x) => x.chatId === chat.chatId);
  if (myTurnTimer) clearTimeout(myTurnTimer);
  void typingNow;
  void lastBotAt;
  c.send({ t: 'call', chatId: chat.chatId, human: Math.random() < 0.5 });
  await c.waitT('call_recorded', 30_000, (x) => x.chatId === chat.chatId).catch(() => log(`${account}: call not recorded`));
  return { c, chat, evs, startedAt: t0 };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-smoke-'));
  const log = (s: string) => console.log(s);
  log(`smoke: ${CHATS} chats of ${SECONDS} s, mock chain, ${args.includes('--mock') ? 'MOCK' : 'real'} NEAR AI, budget $${BUDGET}`);
  const app = await createApp({
    port: 0, chain: 'mock', nearAi: args.includes('--mock') ? 'mock' : 'real', dbPath: path.join(dir, 'smoke.db'), chatSeconds: SECONDS, callSeconds: 15, botTimeScale: 1,
    searchDelay: [2.5, 6], devCallSeconds: 5, logLevel: 'warn', webDist: path.join(dir, 'no-web'), roundMinutes: 30,
  });
  if (app.chain.kind !== 'mock') throw new Error('refusing: the smoke run never touches testnet');
  if (app.ai.kind !== 'real' && !args.includes('--mock')) throw new Error('needs real NEAR AI (or --mock for a dry run)');
  const base = `http://localhost:${app.port}`;
  const chatIds: string[] = [];
  const guard = setInterval(() => {
    const s = spend(app.db, chatIds);
    if (s.usd > BUDGET) {
      log(`BUDGET GUARD: $${s.usd.toFixed(4)} > $${BUDGET}; ending chats`);
      for (const id of chatIds) void app.game.devEndChat(app.game.sides.get(id)?.viewer ?? '', id);
    }
  }, 5000);
  try {
    for (let i = 0; i < 120; i++) {
      const s = await http<any>(base, 'GET', '/api/dev/state');
      if (s.round?.ready) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const st = await http<any>(base, 'GET', '/api/dev/state');
    log(`round ${st.round.roundId} ready; attested: ${st.round.attest.map((a: any) => `${a.model} ${a.ok ? 'ok' : 'FAILED'} (${a.attested.length} signer)`).join(', ')}`);
    for (const u of USERS) await http(base, 'POST', `/api/test-users/${u}/faucet`, { coins: 100 });
    const plays = USERS.map((u, i) =>
      (async () => {
        // searches must not overlap, or the two humans are paired with each other
        await new Promise((r) => setTimeout(r, i * 8000));
        const p = playChat(base, u, i, log);
        return p;
      })(),
    );
    // chat ids for the guard as soon as matches happen
    const watch = setInterval(() => {
      for (const s of app.game.sides.values()) if (s.partnerKind === 'bot' && !chatIds.includes(s.chatId)) chatIds.push(s.chatId);
    }, 500);
    const results = await Promise.all(plays);
    clearInterval(watch);
    for (const r of results) if (!chatIds.includes(r.chat.chatId)) chatIds.push(r.chat.chatId);
    log('chats over; ending the round on the mock chain');
    await http(base, 'POST', '/api/dev/end-round');
    await results[0].c.waitT('results_ready', 240_000);
    const out: any[] = [];
    const checksAsIs = await loadBrowserChecks('as-is');
    const checksPatched = await loadBrowserChecks('patched');
    for (const r of results) {
      const account = r.c.account;
      const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${r.chat.chatId}?account=${account}`);
      const bundle = await http<any>(base, 'GET', `/api/verify/${r.chat.chatId}?account=${account}`);
      const local = r.evs.filter((e) => e.kind === 'bot' || e.kind === 'me').map((e) => ({ from: e.kind === 'me' ? ('me' as const) : ('them' as const), text: e.text! }));
      const asIs = checksAsIs ? failures(checksAsIs.runChecks(bundle, { localTranscript: local })) : ['not loaded'];
      const patched = checksPatched ? failures(checksPatched.runChecks(bundle, { localTranscript: local })) : ['not loaded'];
      const says = trace.trace.filter((e: any) => e.k === 'say');
      const intentOf = (text: string) => says.find((s: any) => s.d.bubbles?.some((b: any) => b.text === text));
      log(`\n=== chat ${r.chat.chatId} with ${trace.persona} (${bundle.model}), level ${r.chat.level}, brain ${trace.brain} ===`);
      let lastOn: number | null = null;
      let lastShown = 0;
      for (const e of r.evs) {
        if (e.kind === 'typing_on') {
          if (lastOn === null) lastOn = e.t;
          log(`  ${e.t.toFixed(1).padStart(6)}s   . bot typing on`);
        } else if (e.kind === 'typing_off') log(`  ${e.t.toFixed(1).padStart(6)}s   . bot typing off`);
        else if (e.kind === 'me') log(`  ${e.t.toFixed(1).padStart(6)}s PLAYER: ${e.text}`);
        else if (e.kind === 'bot') {
          const s = intentOf(e.text!);
          const from = lastOn ?? lastShown;
          const typed = e.t - from;
          log(`  ${e.t.toFixed(1).padStart(6)}s BOT:    ${e.text}    [${s ? s.d.steering : '?'}; typing ${typed.toFixed(1)} s for ${charsOf(e.text!)} chars = ${(charsOf(e.text!) / Math.max(0.1, typed)).toFixed(1)} cps${s ? `; model ${(s.d.latencyMs / 1000).toFixed(1)} s` : ''}]`);
          lastOn = null;
          lastShown = e.t;
        } else log(`  ${e.t.toFixed(1).padStart(6)}s   (chat ended)`);
      }
      log(`  stats: ${JSON.stringify(trace.stats)}; drafts: ${JSON.stringify(trace.drafts)}`);
      log(`  bundle: ${bundle.completions.length} signed completions; relay checks ${bundle.relayChecks.every((c: any) => c.ok && c.steeringOk) ? 'all ok' : JSON.stringify(bundle.relayChecks)}`);
      log(`  web checks as they are: ${asIs.length ? asIs.join(' | ') : 'all pass'}`);
      log(`  web checks with the proposed steering change: ${patched.length ? patched.join(' | ') : 'all pass'}`);
      out.push({ chatId: r.chat.chatId, persona: trace.persona, model: bundle.model, events: r.evs, stats: trace.stats, says: says.map((s: any) => s.d), asIs, patched });
    }
    const s = spend(app.db, chatIds);
    log(`\nNEAR AI: ${s.calls} completions, ${s.inTok} input and ${s.outTok} output tokens, about $${s.usd.toFixed(4)}`);
    const file = path.join(here, '..', 'data', `smoke-bots-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ chats: out, spend: s }, null, 2));
    log(`report: ${file}`);
    for (const r of results) r.c.close();
  } finally {
    clearInterval(guard);
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('smoke FAILED', e);
    process.exit(1);
  },
);
