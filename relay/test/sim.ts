// Simulated bot chats on a virtual clock: the real BotSession and default brain, a simulated player,
// and a fake enclave that signs every completion with a throwaway key after a realistic delay.
// Used by test/brain.test.ts; `npx tsx test/sim.ts [persona-id] [seed]` prints one chat with timings.
import type { CompletionRow } from '../src/db.js';
import type { CompletionResult, NearAi, AttestationResult } from '../src/nearai/client.js';
import type { SignaturePayload } from '../../shared/protocol.js';
import type { ChatSide } from '../src/game/types.js';
import type { Persona } from '../src/personas.js';
import { addressOfPrivateKey, sha256Hex, signEip191 } from '../src/crypto.js';
import { BotSession, type BotHost, type BotStore, type BrainChoice, type DraftRow } from '../src/bot/session.js';
import { VirtualClock, sleepOn } from '../src/bot/clock.js';
import { chance, createRng, pickR, uniformR, type Rng } from '../src/bot/rng.js';
import { steeringEntry } from '../src/bot/intents.js';
import { skinMessage } from '../src/formats.js';

export const SIM_KEY = sha256Hex('realsies bot simulation key, throwaway');
export const SIM_SIGNER = addressOfPrivateKey(SIM_KEY);

const WORDS = 'yeah lol ok so i just got home and the bus was late again honestly what about you idk maybe later the weather is weird today did you eat'.split(' ');

function line(rng: Rng, lo: number, hi: number): string {
  const target = Math.round(uniformR(rng, lo, hi));
  let s = '';
  while (s.length < target) s += (s ? ' ' : '') + pickR(rng, WORDS);
  return s;
}

/** A NEAR AI stand-in on virtual time: latency, occasional failures, signatures that arrive later. */
export class SimAi implements NearAi {
  readonly kind = 'mock' as const;
  /** completionId -> virtual time its signature was handed out */
  readonly sigAt = new Map<string, number>();
  readonly requests: string[] = [];
  private sigs = new Map<string, { sig: SignaturePayload; at: number }>();
  private n = 0;
  failP = 0.03;
  slowP = 0.08;
  constructor(private clock: VirtualClock, private rng: Rng) {}

  async attest(): Promise<AttestationResult> {
    throw new Error('not used');
  }

  async complete(model: string, request: string): Promise<CompletionResult> {
    this.requests.push(request);
    const latency = chance(this.rng, this.slowP) ? uniformR(this.rng, 4000, 9000) : uniformR(this.rng, 500, 2400);
    await sleepOn(this.clock, latency);
    if (chance(this.rng, this.failP)) return { ok: false, status: 503, response: '{"error":{"message":"sim failure"}}', content: null, latencyMs: latency, error: 'sim failure' };
    const msgs = JSON.parse(request).messages as { role: string; content: string }[];
    const last = msgs[msgs.length - 1];
    const e = last.role === 'system' ? steeringEntry(last.content) : undefined;
    let content: string;
    if (e?.intent === 'react') content = line(this.rng, 3, 14);
    else if (e?.length === 'multi') content = Array.from({ length: chance(this.rng, 0.5) ? 2 : 3 }, () => line(this.rng, 6, 30)).join('\n');
    else content = line(this.rng, 8, 58);
    const id = `sim-${++this.n}`;
    const response = JSON.stringify({ id, object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    const text = `${model}:${sha256Hex(request)}:${sha256Hex(response)}`;
    const sig: SignaturePayload = { text, signature: signEip191(text, SIM_KEY), signing_address: SIM_SIGNER, signing_algo: 'ecdsa' };
    this.sigs.set(id, { sig, at: this.clock.now() + uniformR(this.rng, 80, 450) });
    return { ok: true, status: 200, completionId: id, response, content, finishReason: 'stop', latencyMs: latency };
  }

  async signature(completionId: string): Promise<SignaturePayload | null> {
    const s = this.sigs.get(completionId);
    if (!s) return null;
    await sleepOn(this.clock, Math.max(0, s.at - this.clock.now()));
    this.sigAt.set(completionId, this.clock.now());
    return s.sig;
  }
}

export class MemStore implements BotStore {
  rows = new Map<number, CompletionRow>();
  drafts: DraftRow[] = [];
  trace: unknown;
  saveCompletion(r: CompletionRow): void {
    this.rows.set(r.idx, { ...r });
  }
  loadCompletions(): CompletionRow[] {
    return [...this.rows.values()].sort((a, b) => a.idx - b.idx);
  }
  saveDraft(d: DraftRow): void {
    this.drafts.push(d);
  }
  saveTrace(_chatId: string, t: unknown): void {
    this.trace = t;
  }
}

export interface Shown {
  text: string;
  at: number;
  ci: number;
}

export interface SimLine {
  from: 'me' | 'them';
  text: string;
  at: number;
  ci?: number;
}

export interface SimResult {
  persona: string;
  session: BotSession;
  store: MemStore;
  ai: SimAi;
  lines: SimLine[];
  typing: { on: boolean; at: number }[];
  startedAt: number;
  endsAt: number;
}

export interface PlayerModel {
  /** probability the player writes first, 3 to 9 s in */
  opensP: number;
  /** probability the player answers a bot message */
  answerP: number;
  /** probability of a second message right after the first */
  doubleP: number;
  /** probability of going quiet for 15 to 25 s instead of answering */
  quietP: number;
  cps: [number, number];
  /** what the player writes, picked at random; default a mix of short English questions and statements */
  lines?: readonly string[];
}

export const DEFAULT_PLAYER: PlayerModel = { opensP: 0.4, answerP: 0.85, doubleP: 0.15, quietP: 0.1, cps: [3, 6] };

const QUESTIONS = ['where are you from?', 'are you a bot?', 'what do you do?', 'hows your day going?', 'what time is it there?', 'you real?'];
const STATEMENTS = ['lol same', 'im just at home', 'thats funny', 'nice', 'i had pasta earlier', 'its raining here', 'not much tbh', 'haha ok'];

/** Run one two-minute chat on virtual time and return everything that happened. */
export async function simulateChat(o: {
  persona: Persona;
  seed: string;
  chatMs?: number;
  player?: Partial<PlayerModel>;
  brain?: (clock: VirtualClock) => BrainChoice | undefined;
  ai?: (clock: VirtualClock, rng: Rng) => SimAi;
  paid?: boolean;
}): Promise<SimResult> {
  const rng = createRng(`player|${o.seed}`);
  const clock = new VirtualClock();
  const ai = o.ai ? o.ai(clock, createRng(`ai|${o.seed}`)) : new SimAi(clock, createRng(`ai|${o.seed}`));
  const store = new MemStore();
  const P = { ...DEFAULT_PLAYER, ...o.player };
  const chatMs = o.chatMs ?? 120_000;
  const startedAt = clock.now();
  const endsAt = startedAt + chatMs;
  const side = {
    chatId: `sim-${o.seed}`, convId: 'c', roundId: 1, viewer: 'p.testnet', level: 1, seatIndex: 0, theme: 'castle',
    skin: { seed: '0'.repeat(64), name: 'Pickle435' }, characterId: 'x', partnerKind: 'bot', requestedMode: 'paid', mode: 'paid',
    coins: 5, handle: 'ab'.repeat(32), tag: 'abababababababab', phase: 'chatting', createdAt: startedAt, startedAt, endsAt,
    callStatus: 'none', playStatus: 'placed', messages: [],
  } as unknown as ChatSide;
  const lines: SimLine[] = [];
  const typing: { on: boolean; at: number }[] = [];
  let session!: BotSession;
  let playerBusy = false;
  let n = 0;

  const playerSays = async (text: string) => {
    // the player types it (indicator on), then sends
    playerBusy = true;
    session.onPlayerTyping(true);
    await sleepOn(clock, (text.length / uniformR(rng, P.cps[0], P.cps[1])) * 1000);
    playerBusy = false;
    if (clock.now() >= endsAt) return;
    session.onPlayerTyping(false);
    const id = `m${++n}`;
    lines.push({ from: 'me', text, at: clock.now() });
    session.onPlayerMessage({ id, text });
  };
  const playerTurn = async (delay: number) => {
    await sleepOn(clock, delay);
    if (clock.now() >= endsAt || playerBusy) return;
    await playerSays(P.lines ? pickR(rng, P.lines) : chance(rng, 0.4) ? pickR(rng, QUESTIONS) : pickR(rng, STATEMENTS));
    if (chance(rng, P.doubleP)) {
      await sleepOn(clock, uniformR(rng, 400, 1500));
      if (clock.now() < endsAt && !playerBusy) await playerSays(pickR(rng, P.lines ?? STATEMENTS));
    }
  };

  const host: BotHost = {
    ai,
    db: store,
    botTimeScale: 1,
    isChatting: (s) => s.phase === 'chatting',
    botSay: (s, text, ci) => {
      if (s.phase !== 'chatting') return false;
      lines.push({ from: 'them', text, at: clock.now(), ci });
      // the player answers the last bubble of a burst: wait a little to see if more is coming
      if (chance(rng, P.answerP) && !playerBusy) {
        const quiet = chance(rng, P.quietP) ? uniformR(rng, 15_000, 25_000) : 0;
        void playerTurn(quiet + uniformR(rng, 1500, 4000) + (text.length / 25) * 1000);
      }
      return true;
    },
    botTyping: (_s, on) => typing.push({ on, at: clock.now() }),
  };
  session = new BotSession(host, side, o.persona, skinMessage('Pickle435', 'abababababababab'), [SIM_SIGNER], {
    clock, seed: o.seed, brain: o.brain?.(clock),
  });
  session.start();
  if (chance(rng, P.opensP)) void playerTurn(uniformR(rng, 3000, 9000));
  await clock.runUntil(endsAt);
  session.flush();
  (side as { phase: string }).phase = 'calling';
  session.stop(o.paid ?? true);
  await clock.advance(30_000);
  await session.settled();
  return { persona: o.persona.id, session, store, ai, lines, typing, startedAt, endsAt };
}

export function testPersona(over: Partial<Persona> = {}): Persona {
  return {
    id: 'sim-persona', levels: [1], model: 'z-ai/glm-5.3-flash', prompt: 'You are Sim, a test persona who texts like a person. '.repeat(2),
    promptHash: '', cps: 5, traits: { chatty: 0.5, fast: 0.5, curious: 0.5, guarded: 0.5, drift: 0.5 }, summary: '', interests: ['music', 'food', 'local'],
    brain: { kind: 'default' }, source: 'prompt', ...over,
  };
}

// CLI: print one simulated chat with timings
if (process.argv[1] && /sim\.ts$/.test(process.argv[1])) {
  const { loadPersonas } = await import('../src/personas.js');
  const path = await import('node:path');
  const ps = loadPersonas(path.resolve(import.meta.dirname, '../personas'));
  const p = ps.find((x) => x.id === (process.argv[2] ?? 'mia-leeds')) ?? ps[0];
  const r = await simulateChat({ persona: p, seed: process.argv[3] ?? 'cli' });
  for (const l of r.lines) console.log(`${((l.at - r.startedAt) / 1000).toFixed(1).padStart(6)}s ${l.from === 'me' ? 'player' : 'bot   '} ${l.text}`);
  console.log(JSON.stringify(r.session.stats));
}
