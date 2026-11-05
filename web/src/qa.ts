// Mock-mode QA hooks for screenshots without a browser driver:
//   ?mock=1&as=ana                 sign in as a test user
//   &level=2                       open that level
//   &round=10                      start the mock at this round (themes rotate per round: 7 = jungle,
//                                  desert, cave; 10 = space, castle, jungle)
//   &qa=seat|deposit|search|countdown|chat|call|locked|results|results-persona|verify|verify-persona|rounds|terms
//                                  drive to a screen (results-persona scrolls to the persona card,
//                                  verify-persona opens the bot chat that carries one)
//   &cd=3|2|1|go                   countdown: hold that beat (Countdown.tsx reads it)
//   &mode=paid&coins=10&seat=3     how to pick the seat
//   &long=1                        chat: a long scripted conversation
//   &kb=300                        pretend a phone keyboard of this many CSS px is open
//   &menu=1                        open the HUD menu
//   &consent=1                     the 18+ / terms box already ticked (who are you)
//   &longnames=1                   every seat gets an 11-character gamertag
//   &nobots=1                      the bots are napping: every pick gets bots_unavailable (no new chats)
// Only active together with ?mock=1.

import type { Level } from '../../shared/protocol.ts';
import type { Store, AppState } from './state/store.ts';
import { acceptTerms } from './state/consent.ts';
import { isCounting } from './state/countdown.ts';
import { EVIDENCE_CHAT_ID } from './net/mock/evidence.ts';

export interface QaPlan {
  step: string;
  level: Level;
  seat: number;
  mode: 'free' | 'paid';
  coins: number;
}

export function qaPlan(search: string): QaPlan | null {
  const q = new URLSearchParams(search);
  if (q.get('mock') !== '1' || !q.get('as')) return null;
  return {
    step: q.get('qa') ?? 'lobby',
    level: (Math.min(3, Math.max(1, Number(q.get('level') ?? 1))) as Level),
    seat: Number(q.get('seat') ?? 2),
    mode: q.get('mode') === 'paid' ? 'paid' : 'free',
    coins: Number(q.get('coins') ?? 10),
  };
}

function until(store: Store, pred: (s: AppState) => boolean, ms = 20000): Promise<AppState> {
  return new Promise((res, rej) => {
    if (pred(store.get())) return res(store.get());
    const t = setTimeout(() => {
      un();
      rej(new Error('qa timeout'));
    }, ms);
    const un = store.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(t);
        un();
        res(s);
      }
    });
  });
}

/** A long, natural conversation for the chat screenshots (bubbles of every length). */
export const LONG_CHAT: { from: 'me' | 'them'; text: string }[] = [
  { from: 'them', text: 'heyy' },
  { from: 'me', text: 'hi! where are you from?' },
  { from: 'them', text: 'lisbon, you?' },
  { from: 'me', text: 'berlin. how is the weather there' },
  { from: 'them', text: 'honestly too hot for november lol. i was at the beach this morning' },
  { from: 'me', text: 'jealous' },
  { from: 'them', text: 'what do you do?' },
  { from: 'me', text: 'i teach maths to teenagers, which is a lot like this game: you never know who is actually listening' },
  { from: 'them', text: 'haha thats dark' },
  { from: 'me', text: 'ok be honest. are you a bot?' },
  { from: 'them', text: 'would a bot say no?' },
  { from: 'me', text: 'that is exactly what a bot would say' },
];

export async function runQa(store: Store, search: string, open: (what: string, arg?: unknown) => void): Promise<void> {
  const q = new URLSearchParams(search);
  if (q.get('mock') === '1' && q.get('consent') === '1') acceptTerms();
  if (q.get('mock') === '1' && q.get('qa') === 'terms' && !q.get('as')) {
    open('terms');
    return;
  }
  const plan = qaPlan(search);
  if (!plan) return;
  const as = q.get('as')!;
  const acct = as.includes('.') ? as : `${as}.realsies.testnet`;
  await store.actions.selectUser(acct);
  await until(store, (s) => s.welcomed);
  store.actions.enterRoom(plan.level);
  const s = await until(store, (x) => !!x.rooms[plan.level]);
  const room = s.rooms[plan.level]!;
  const seat = room.seats[plan.seat] ?? room.seats[0];
  switch (plan.step) {
    case 'seat':
      open('seat', { level: plan.level, seat });
      return;
    case 'deposit':
      open('deposit');
      return;
    case 'rounds':
      open('rounds');
      return;
    case 'terms':
      open('terms');
      return;
    case 'results':
    case 'results-persona':
    case 'verify':
    case 'verify-persona': {
      const rounds = await store.actions.listRounds();
      const settled = rounds.find((r) => r.status === 'settled');
      if (!settled) return;
      open('results', settled.roundId);
      const r = await store.actions.getResults(settled.roundId);
      if (plan.step === 'verify') {
        // the real 2026-11-04 enclave evidence (no persona card: it predates them)
        const bot = r.chats.find((c) => c.chatId === EVIDENCE_CHAT_ID) ?? r.chats.find((c) => c.verifiable);
        if (bot) open('verify', bot.chatId);
      }
      if (plan.step === 'verify-persona') {
        const bot = r.chats.find((c) => c.verifiable && c.persona);
        if (bot) open('verify', bot.chatId);
      }
      if (plan.step === 'results-persona') {
        // bring the first persona card into view (the results panel scrolls on small screens)
        for (let i = 0; i < 60; i++) {
          const el = document.querySelector('.px-results .persona');
          if (el) {
            el.closest('.px-result-row')?.scrollIntoView({ block: 'center' });
            break;
          }
          await new Promise((res) => setTimeout(res, 50));
        }
      }
      return;
    }
  }
  if (!['chat', 'call', 'locked', 'search', 'countdown'].includes(plan.step)) return;
  store.actions.pickSeat(plan.level, seat.index, plan.mode, plan.mode === 'paid' ? plan.coins : undefined);
  if (plan.step === 'search') return;
  // the countdown screen holds a beat (&cd=); everything else waits for the chat to open
  if (plan.step === 'countdown') return;
  await until(store, (x) => x.chat?.phase === 'chatting' && !isCounting(x.chat));
  if (q.get('long') === '1') {
    const mock = store.client as unknown as { qaScript?: (l: typeof LONG_CHAT) => void };
    mock.qaScript?.(LONG_CHAT);
    await new Promise((r) => setTimeout(r, 600));
    store.actions.say('prove it. what did you have for breakfast?');
    if (plan.step === 'chat') return;
  } else {
    const lines = (q.get('say') ?? 'hey! where are you from?|lol nice. are you a bot?').split('|');
    for (const line of lines) {
      await new Promise((r) => setTimeout(r, 1500));
      store.actions.say(line);
      await until(store, (x) => (x.chat?.messages.filter((m) => m.from === 'them').length ?? 0) > 0, 25000).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 4000));
    if (plan.step === 'chat') return;
  }
  store.actions.devEndChat();
  await until(store, (x) => x.chat?.phase === 'calling');
  if (plan.step === 'call') return;
  store.actions.call(q.get('call') !== 'bot');
}
