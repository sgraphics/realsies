// Mock-mode QA hooks for screenshots without a browser driver:
//   ?mock=1&as=ana                 sign in as a test user
//   &level=2                       open that level
//   &qa=seat|deposit|chat|call|locked|results|verify|rounds   drive to a screen
//   &mode=paid&coins=10&seat=3     how to pick the seat
// Only active together with ?mock=1.

import type { Level } from '../../shared/protocol.ts';
import type { Store, AppState } from './state/store.ts';

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

export async function runQa(store: Store, search: string, open: (what: string, arg?: unknown) => void): Promise<void> {
  const q = new URLSearchParams(search);
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
    case 'results':
    case 'verify': {
      const rounds = await store.actions.listRounds();
      const settled = rounds.find((r) => r.status === 'settled');
      if (settled) open('results', settled.roundId);
      if (plan.step === 'verify' && settled) {
        const r = await store.actions.getResults(settled.roundId);
        const bot = r.chats.find((c) => c.verifiable);
        if (bot) open('verify', bot.chatId);
      }
      return;
    }
  }
  if (!['chat', 'call', 'locked', 'search'].includes(plan.step)) return;
  store.actions.pickSeat(plan.level, seat.index, plan.mode, plan.mode === 'paid' ? plan.coins : undefined);
  if (plan.step === 'search') return;
  await until(store, (x) => x.chat?.phase === 'chatting');
  const lines = (q.get('say') ?? 'hey! where are you from?|lol nice. are you a bot?').split('|');
  for (const line of lines) {
    await new Promise((r) => setTimeout(r, 1500));
    store.actions.say(line);
    await until(store, (x) => (x.chat?.messages.filter((m) => m.from === 'them').length ?? 0) > 0, 15000).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 4000));
  if (plan.step === 'chat') return;
  store.actions.devEndChat();
  await until(store, (x) => x.chat?.phase === 'calling');
  if (plan.step === 'call') return;
  store.actions.call(q.get('call') !== 'bot');
}
