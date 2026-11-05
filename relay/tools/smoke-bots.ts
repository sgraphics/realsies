// Real-model smoke run of the bot engine. An in-process relay on the MOCK chain (never testnet) with
// real NEAR AI enclave models; a scripted human plays a few full chats in parallel; then calls,
// dev end-round, settlement on the mock chain, every bundle through the web app's Verify checks
// (as they are and with the proposed steering change), a transcript with timings and the persona card
// revealed after settlement, and the spend. Every chat opens with the countdown (COUNTDOWN_SECONDS);
// the scripted human waits it out like a person would. A budget guard ends the chats early if the NEAR
// AI spend estimate passes the budget.
//
//   npx tsx tools/smoke-bots.ts [chats=3] [--seconds 120] [--budget 0.03] [--pick contrast | --personas id,id,...] [--script foreign]
//
// --pick contrast   one chat each with four clearly different personas of the round's cast (a young
//                   extrovert, the oldest one, a second-language speaker, a blunt introvert), generated
//                   ones preferred where they fit
// --personas        the chats' personas by id (hand-written ids are pinned into the round's cast, or
//                   generated ids from this round)
// --script foreign  the player writes scripted lines instead of random ones (SCRIPTS below): Estonian to
//                   chat 1 and 2, German to chat 3, Spanish to chat 4, each ending with one English line
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
import { letters } from '../src/persona/model.js';
import type { CharacterRec } from '../src/game/types.js';
import type { Level } from '../../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (f: string, d: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const CHATS = Math.min(6, Number(args.find((a) => /^\d+$/.test(a)) ?? 3));
const SECONDS = Number(opt('--seconds', '120'));
const BUDGET = Number(opt('--budget', '0.03'));
const PICK = opt('--pick', '');
const PINNED = opt('--personas', '').split(',').filter(Boolean);
const SCRIPT = opt('--script', '');
const USERS = ['ana', 'ben', 'cleo', 'dex', 'eve', 'finn'].slice(0, CHATS).map((u) => `${u}.realsies.testnet`);

const OPENERS = ['hey', 'hii', 'yo', 'hello?'];
const LINES = [
  'where are you from?', 'lol ok', 'what are you up to today', 'im in lisbon, its weirdly sunny', 'are you a bot tbh',
  'haha no im real. are you?', 'what did you have for lunch', 'my cat just walked across my keyboard', 'thats fair',
  'ok quick one, whats 7 times 8', 'you type kinda fast lol', 'nah im just bored at work', 'wait really?', 'same honestly',
  'what time is it where you are', 'what can you see right now lol',
];

/** Scripted player lines per chat, sent in order, one after each bot burst (the first opens the chat). */
const SCRIPTS: Record<string, string[][]> = {
  foreign: [
    ['Tere! Kuidas sul läheb? Kust sa pärit oled?', 'Ma olen Tartust. Mida sa praegu teed?', 'Kas sa oled päris inimene või robot?', 'haha ok sorry, where are you from?'],
    ['Tere! Kuidas sul läheb? Kust sa pärit oled?', 'Ma olen Tartust. Mida sa praegu teed?', 'Kas sa oled päris inimene või robot?', 'ok and in english, what do you do?'],
    ['Hallo! Wie geht es dir? Woher kommst du?', 'Ich bin aus Hamburg. Was machst du gerade?', 'Bist du ein echter Mensch oder ein Bot?', 'ok and in english, what do you do?'],
    ['¡Hola! ¿Qué tal? ¿De dónde eres?', 'Yo vivo en Valencia y hoy hace mucho calor. ¿Qué estás haciendo ahora?', '¿Eres una persona real o un bot?', 'haha ok sorry, where are you from?'],
  ],
};

/** Four clearly different personas of the cast: a young extrovert, the oldest, a second-language speaker, a blunt introvert. */
function contrast(chars: CharacterRec[], n: number): CharacterRec[] {
  const one = new Map<string, CharacterRec>();
  for (const c of chars) if (c.kind === 'bot' && c.persona?.person && c.commitStatus === 'committed' && !one.has(c.personaId!)) one.set(c.personaId!, c);
  const pool = [...one.values()];
  const picks: CharacterRec[] = [];
  const pe = (c: CharacterRec) => c.persona!.person!;
  const st = (c: CharacterRec) => c.persona!.style!;
  const gen = (c: CharacterRec) => (c.persona!.source === 'generated' ? 1 : 0);
  const take = (ok: (c: CharacterRec) => boolean, score: (c: CharacterRec) => number) => {
    const best = pool.filter((c) => !picks.includes(c) && ok(c)).sort((a, b) => score(b) - score(a))[0];
    if (best) picks.push(best);
  };
  take((c) => pe(c).age <= 25 && pe(c).english === 'native' && letters(pe(c).mbti).E, (c) => (st(c).emoji === 'often' ? 2 : 0) + (st(c).case === 'lower' ? 1 : 0) + gen(c));
  take((c) => pe(c).age >= 55, (c) => pe(c).age + (st(c).case === 'normal' ? 5 : 0));
  const fresh = (c: CharacterRec) => !picks.some((x) => pe(x).mbti === pe(c).mbti);
  take((c) => pe(c).english !== 'native' && fresh(c), (c) => ({ basic: 2, good: 1.5, fluent: 0, native: 0 })[pe(c).english] + gen(c) * 1.5 + (/^(k+|j[aj]+|w+|555+)$/.test(st(c).laugh[0] ?? '') ? 1 : 0) + (letters(pe(c).mbti).F ? 0.5 : 0));
  take((c) => !letters(pe(c).mbti).E && !letters(pe(c).mbti).F && fresh(c), (c) => (st(c).length === 'terse' ? 2 : 0) + c.persona!.traits.guarded + gen(c));
  for (const c of pool) if (picks.length < n && !picks.includes(c)) picks.push(c);
  return picks.slice(0, n);
}

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

async function playChat(base: string, account: string, idx: number, level: Level, log: (s: string) => void, script?: string[]) {
  const c = await WsClient.connect(base, account);
  await c.waitT('welcome', 10_000);
  c.send({ t: 'pick_seat', level, seatIndex: idx, mode: 'paid', coins: 5 });
  const chat = (await c.waitT('matched', 20_000)).chat;
  const started = await c.waitT('chat_started', 60_000, (x) => x.chatId === chat.chatId);
  const t0 = started.startedAt;
  const countdown = (t0 - c.receivedAt(started)) / 1000;
  const evs: Ev[] = [];
  const at = () => (Date.now() - t0) / 1000;
  let lastBotAt = 0;
  let myTurnTimer: NodeJS.Timeout | null = null;
  let typingNow = false;
  const lines = script ? [...script] : [...LINES].sort(() => Math.random() - 0.5);
  let quietDone = false;
  const ws = (c as any).ws as WebSocket;
  // the line is taken when it is sent, so a burst of bubbles reschedules the same line
  const sayLater = (delayMs: number, next: () => string | undefined) => {
    if (myTurnTimer) clearTimeout(myTurnTimer);
    myTurnTimer = setTimeout(() => {
      if (Date.now() > started.endsAt - 3000) return;
      typingNow = true;
      c.send({ t: 'typing', chatId: chat.chatId, on: true });
      myTurnTimer = setTimeout(() => {
        typingNow = false;
        c.send({ t: 'typing', chatId: chat.chatId, on: false });
        const text = next();
        if (Date.now() > started.endsAt - 1000 || !text) return;
        c.send({ t: 'say', chatId: chat.chatId, text });
        evs.push({ t: at(), kind: 'me', text });
      }, ((lines[0]?.length ?? 10) / 4) * 1000 + 300);
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
      if (!script && !quietDone && at() > 45 && Math.random() < 0.5) {
        quietDone = true;
        if (myTurnTimer) clearTimeout(myTurnTimer);
        myTurnTimer = null;
        return;
      }
      if ((script || Math.random() < 0.85) && lines.length) sayLater(1800 + Math.random() * 2500 + m.msg.text.length * 40, () => lines.shift());
    }
    if (m.t === 'chat_ended') evs.push({ t: at(), kind: 'ended' });
  });
  // the full-screen countdown: the person waits for it like everyone else
  await c.untilStarted(started);
  if (script) sayLater(2500 + Math.random() * 1500, () => lines.shift());
  else if (Math.random() < 0.5) sayLater(2500 + Math.random() * 3000, () => OPENERS[idx % OPENERS.length]);
  await c.waitT('chat_ended', SECONDS * 1000 + 30_000, (x) => x.chatId === chat.chatId);
  if (myTurnTimer) clearTimeout(myTurnTimer);
  void typingNow;
  void lastBotAt;
  c.send({ t: 'call', chatId: chat.chatId, human: Math.random() < 0.5 });
  await c.waitT('call_recorded', 30_000, (x) => x.chatId === chat.chatId).catch(() => log(`${account}: call not recorded`));
  return { c, chat, evs, startedAt: t0, countdown };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-smoke-'));
  const log = (s: string) => console.log(s);
  log(`smoke: ${CHATS} chats of ${SECONDS} s, mock chain, ${args.includes('--mock') ? 'MOCK' : 'real'} NEAR AI, budget $${BUDGET}`);
  const app = await createApp({
    port: 0, chain: 'mock', nearAi: args.includes('--mock') ? 'mock' : 'real', dbPath: path.join(dir, 'smoke.db'), chatSeconds: SECONDS, callSeconds: 15, botTimeScale: 1,
    searchDelay: [2.5, 6], devCallSeconds: 5, logLevel: 'warn', webDist: path.join(dir, 'no-web'), roundMinutes: 30, castPins: PINNED,
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
    const R: number = st.round.roundId;
    log(`round ${R} ready; attested: ${st.round.attest.map((a: any) => `${a.model} ${a.ok ? 'ok' : 'FAILED'} (${a.attested.length} signer)`).join(', ')}`);
    // which bot each chat meets: pinned, contrasting, or at random as in production
    const chars = [...(app.game.chars.get(R)?.values() ?? [])].filter((c) => c.kind === 'bot' && c.commitStatus === 'committed');
    const chosen: (CharacterRec | undefined)[] = PINNED.length
      ? PINNED.map((id) => chars.find((c) => c.personaId === id) ?? (() => { throw new Error(`no persona ${id} in round ${R}; cast: ${[...new Set(chars.map((c) => c.personaId))].join(', ')}`); })())
      : PICK === 'contrast' ? contrast(chars, CHATS) : USERS.map(() => undefined);
    const wanted = new Map(USERS.map((u, i) => [u, chosen[i]?.id]));
    app.game.botPicker = (account, cands) => cands.find((c) => c.id === wanted.get(account));
    for (const [i, c] of chosen.entries()) if (c) log(`  chat ${i + 1}: ${c.personaId} (${c.persona?.source}), L${c.level}: ${c.card ? `${c.card.name}, ${c.card.age}, ${c.card.mbti}, ${c.card.home}` : ''}`);
    for (const u of USERS) await http(base, 'POST', `/api/test-users/${u}/faucet`, { coins: 100 });
    const plays = USERS.map((u, i) =>
      (async () => {
        // searches must not overlap, or the two humans are paired with each other
        await new Promise((r) => setTimeout(r, i * 8000));
        const p = playChat(base, u, i, (chosen[i]?.level ?? (i % 2) + 1) as Level, log, SCRIPTS[SCRIPT]?.[i]);
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
    const stored = app.db.loadCharacters<CharacterRec>(R);
    for (const r of results) {
      const account = r.c.account;
      const trace = await http<any>(base, 'GET', `/api/dev/bot-trace/${r.chat.chatId}?account=${account}`);
      const bundle = await http<any>(base, 'GET', `/api/verify/${r.chat.chatId}?account=${account}`);
      const res = await http<any>(base, 'GET', `/api/rounds/${R}/results/${account}`);
      const card = res.chats.find((x: any) => x.chatId === r.chat.chatId)?.persona;
      const ch = stored.find((x) => x.id === bundle.characterId);
      const local = r.evs.filter((e) => e.kind === 'bot' || e.kind === 'me').map((e) => ({ from: e.kind === 'me' ? ('me' as const) : ('them' as const), text: e.text! }));
      const asIs = checksAsIs ? failures(checksAsIs.runChecks(bundle, { localTranscript: local })) : ['not loaded'];
      const patched = checksPatched ? failures(checksPatched.runChecks(bundle, { localTranscript: local })) : ['not loaded'];
      const says = trace.trace.filter((e: any) => e.k === 'say');
      const intentOf = (text: string) => says.find((s: any) => s.d.bubbles?.some((b: any) => b.text === text));
      log(`\n=== chat ${r.chat.chatId} with ${trace.persona} (${bundle.model}), level ${r.chat.level}, brain ${trace.brain}, countdown ${r.countdown.toFixed(1)} s ===`);
      if (card) log(`  card: ${card.name}, ${card.age}, ${card.gender}, ${card.mbti} (${card.temperament}), ${card.home}, ${card.job}, ${card.mood}; emoji ${card.emoji}; style: ${card.style}`);
      else log('  card: none (results carry no persona card)');
      if (ch?.persona) log(`  dials: ${Object.entries(ch.persona.traits).map(([k, v]) => `${k} ${v}`).join(', ')}; ${ch.persona.cps} cps; interests ${ch.persona.interests.join(', ')}; reads ${Object.entries(ch.persona.languages ?? {}).map(([l, v]) => `${l} ${v}`).join(', ')}`);
      let lastOn: number | null = null;
      let lastShown = 0;
      for (const e of r.evs) {
        if (e.kind === 'typing_on') {
          if (lastOn === null) lastOn = e.t;
          log(`  ${e.t.toFixed(1).padStart(6)}s   . bot typing on`);
        } else if (e.kind === 'typing_off') log(`  ${e.t.toFixed(1).padStart(6)}s   . bot typing off`);
        else if (e.kind === 'me') {
          const heard = trace.trace.find((x: any) => x.k === 'event' && x.d.type === 'player_message' && x.d.text === e.text);
          log(`  ${e.t.toFixed(1).padStart(6)}s PLAYER: ${e.text}    [detected: ${heard?.d.lang ?? 'none'}]`);
        }
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
      out.push({ chatId: r.chat.chatId, persona: trace.persona, card, traits: ch?.persona?.traits, cps: ch?.persona?.cps, model: bundle.model, countdown: r.countdown, events: r.evs, stats: trace.stats, says: says.map((s: any) => s.d), asIs, patched });
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
