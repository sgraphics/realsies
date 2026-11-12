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
//   &consent=1                     the terms already accepted (any screen past "Before you play" accepts them)
// A guest (no ?as): the room before signing in, and "Before you play" (Login.tsx) after a tap on seat 2 (&seat=N):
//   &qa=guest                      the room as a guest
//   &qa=consent                    the tap of a first-time visitor: the terms with the checkbox (&tick=1: ticked); with a
//                                  free try left the button is "Start free chat", the wallet a link under it
//   &qa=guest-tap                  the tap of a visitor who accepted them before: the sign-in step
//   &qa=guest-seat                 then signed in (a test player, or the mock wallet with &wallet=): the seat opens
//   &longnames=1                   every seat gets an 11-character gamertag
// The practice chat (protocol v1.14), a guest's free tries (&practice=5: five a day), the character on seat 2 (&seat=N):
//   &qa=guest-tap                  the sign-in step offers "Start free chat" next to the wallet (the HUD's Play free
//                                  with the terms accepted; a tap on a character then starts the chat at once)
//   &tried=1                       this browser had its free chat today: the try gives way to one line (&practicecap=1:
//                                  every free chat of the day is gone)
//   &qa=practice-chat              the practice chat running, a few lines in
//   &qa=practice&call=human|bot    the call made: the reveal ("It fooled you" for human, "You spotted it" for bot;
//                                  with &practice=5 a try is left: "Play again" first)
//   &nobots=1                      the bots are napping: every pick gets bots_unavailable (no new chats)
// Wallet sign-in (protocol v1.3), with &wallet=1 (a relay without test mode: no test users):
//   &qa=signin-wait&hold=signIn    the sign-in step waiting for the wallet
//   &qa=signin-error&reject=signIn the player closed the wallet
//   &as=sam&qa=key                 signed in as sam.testnet: the one approval a first paid play asks for (&hold=key: waiting)
//   &as=sam&qa=deposit             the wallet deposit dialog (200 test coins in the wallet, none in the game);
//                                  &wcoins=0|3 for an empty or a thin wallet, &dep=20 for 20 coins typed in
//   &as=sam&qa=coins               45 deposited (the play key came along in the same approval): deposit, withdraw
//   &coins=closed                  the contract has no coin yet: "Coins open when REAL launches"
//   &net=mainnet                   (with &wallet=1) the config says mainnet: REAL, "Buy REAL"
// The testnet airdrop (protocol v1.6; the TESTNET panel above the room while a player holds nothing at all):
//   &qa=airdrop                    it landed: the panel is gone, a note says where the tokens are
//   &qa=airdrop-wait               the account had one 3 minutes ago: the panel says when the next one opens
// Coins for NEAR on Rhea (protocol v1.12), with &wallet=test&swap=1 (or &wallet=1&net=mainnet&swap=1):
//   &as=sam&qa=swap&near=0.5       the coins dialog, 0.5 NEAR typed and its quote (&game=120&withdraw=40: coins in the
//                                  game and 40 typed to withdraw as NEAR; &wcoins=98: coins in the wallet itself)
//   &as=sam&qa=swap-done           a buy of 0.25 NEAR (&buy=) in the open dialog: done; &nowait=1 a wallet that sends
//                                  the batch at once (the coins wait in the wallet); &moved=1 the price moved past it;
//                                  &wait=1 the wallet never answers the buy ("Approve in your wallet.", after &game=)
//   &as=sam&qa=swap-sold&game=120  40 coins (&sell=) withdrawn as NEAR
//   &room=1                        (any swap step) no dialog: the room, its HUD with the coins (after the buy, if any)
// The launch (?mock=1&launch=soon|auction|finalizing): the coming-soon page, then the game with its auction banner; see src/net/index.ts.
// Turing Hour (protocol v1.13, &turing=soon|on): the line above the room 3 h 12 min before the hour, or during it;
// &prize=1 with its prize (v1.16, "5 NEAR prize", "prize" linking to /prize.html), &prize=<text> with that text.
// Only active together with ?mock=1.

import type { Level } from '../../shared/protocol.ts';
import type { Store, AppState } from './state/store.ts';
import { acceptTerms, forgetTerms } from './state/consent.ts';
import { markTried } from './state/practice.ts';
import { isCounting } from './state/countdown.ts';
import { EVIDENCE_CHAT_ID } from './net/mock/evidence.ts';
import { mockLaunchOf } from './launch/phase.ts';
import { parseNear } from './state/near.ts';
import type { MockWallet } from './wallet/mock.ts';

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

/**
 * Before the first render: screenshots past "Before you play" accept the terms first (a player the QA hooks sign
 * in, or any QA screen); `qa=consent` shows the step itself, as a first-time visitor sees it.
 */
export function qaConsent(search: string): void {
  const q = new URLSearchParams(search);
  if (q.get('mock') !== '1') return;
  const step = q.get('qa');
  if (step === 'consent') forgetTerms();
  else if (q.get('as') || q.get('consent') === '1' || q.get('deposit') === '1' || step) acceptTerms();
  // the practice chat (v1.14): this browser had its free chat today
  if (q.get('tried') === '1') markTried();
}

/** QA: the amount typed in the auction's deposit dialog (&near=0.1). */
export function qaAmount(search: string): string | undefined {
  const q = new URLSearchParams(search);
  return q.get('mock') === '1' ? q.get('near') ?? undefined : undefined;
}

/** QA: "Before you play" with its box already ticked (&tick=1). */
export function qaTicked(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('mock') === '1' && q.get('tick') === '1';
}

export async function runQa(store: Store, search: string, open: (what: string, arg?: unknown) => void): Promise<void> {
  const q = new URLSearchParams(search);
  if (q.get('mock') === '1' && q.get('qa') === 'terms' && !q.get('as')) {
    open('terms');
    return;
  }
  // a mainnet-like mock (&wallet=1, or &launch=: before REAL) signs in with the mock wallet
  const walletMode = q.get('mock') === '1' && (q.get('wallet') === '1' || q.get('wallet') === 'test' || mockLaunchOf(search) !== null);
  // &launch=auction&deposit=1: signed in with the mock wallet, the auction's deposit dialog open (&near=0.1 typed)
  if (walletMode && q.get('deposit') === '1') {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
    open('auction');
    return;
  }
  if (q.get('mock') === '1' && !q.get('as')) {
    // a guest: the room, then "Before you play" after a tap on a character, then signed in
    const step = q.get('qa') ?? '';
    if (!['consent', 'guest-tap', 'guest-seat', 'signin-wait', 'signin-error', 'practice', 'practice-chat'].includes(step)) return;
    await store.actions.loadConfig();
    const level = Math.min(3, Math.max(1, Number(q.get('level') ?? 1))) as Level;
    if (level !== 1) store.actions.enterRoom(level);
    await until(store, (s) => !!s.rooms[level]);
    if (step === 'practice' || step === 'practice-chat') {
      // the free try with the character on that seat, a few lines, then (practice) the call and the reveal
      const seat = store.get().rooms[level]!.seats[Number(q.get('seat') ?? 2)] ?? store.get().rooms[level]!.seats[0];
      await store.actions.startPractice({ level, skin: seat.skin });
      await until(store, (x) => x.chat?.phase === 'chatting' && !isCounting(x.chat));
      const mock = store.client as unknown as { qaScript?: (l: typeof LONG_CHAT) => void; qaPracticeToCall?: (l: typeof LONG_CHAT) => void };
      if (step === 'practice-chat') {
        mock.qaScript?.(LONG_CHAT.slice(0, 7));
        return;
      }
      mock.qaPracticeToCall?.(LONG_CHAT.slice(0, 7));
      await until(store, (x) => x.chat?.phase === 'calling');
      store.actions.call(q.get('call') !== 'bot');
      return;
    }
    open('login', { level, index: Number(q.get('seat') ?? 2) });
    if (step === 'signin-wait' || step === 'signin-error') void store.actions.walletSignIn();
    if (step === 'guest-seat') {
      await new Promise((r) => setTimeout(r, 300));
      if (walletMode) await store.actions.walletSignIn();
      else await store.actions.selectUser('ben.realsies.testnet');
    }
    return;
  }
  const plan = qaPlan(search);
  if (!plan) return;
  const as = q.get('as')!;
  if (walletMode) {
    await store.actions.loadConfig();
    await store.actions.walletSignIn();
  } else {
    const acct = as.includes('.') ? as : `${as}.realsies.testnet`;
    await store.actions.selectUser(acct);
  }
  await until(store, (s) => s.welcomed);
  if (walletMode && plan.step === 'key') {
    open('key');
    if (q.get('hold') === 'key') void store.actions.enableCoins();
    return;
  }
  if (walletMode && plan.step.startsWith('swap') && store.get().config?.swap) {
    // coins for NEAR on Rhea (&swap=1, protocol v1.12): &wcoins=N coins in the wallet itself, &game=N coins deposited
    // into the game first; the dialog opens with &near= and &withdraw= typed; swap-done buys &buy= NEAR (0.25) in the
    // open dialog, swap-sold withdraws &sell= coins (40) as NEAR
    const wcoins = Number(q.get('wcoins') ?? 0);
    const game = Number(q.get('game') ?? 0);
    if (game > 0) {
      await store.client.faucetToWallet?.(game);
      await store.actions.walletDeposit(game);
    }
    if (wcoins > 0) await store.client.faucetToWallet?.(wcoins);
    await store.actions.refreshWalletInfo();
    store.actions.resetFlow('walletTx');
    if (q.get('wait') === '1') (store.wallet as MockWallet).o.hold = 'tx';
    if (q.get('room') === '1') open('close');
    else open('deposit', { near: q.get('near') ?? undefined, withdraw: q.get('withdraw') ?? undefined, prefill: q.get('dep') ?? undefined });
    await new Promise((r) => setTimeout(r, 400));
    if (plan.step === 'swap-done') await store.actions.swapBuy(parseNear(q.get('buy') ?? '0.25') ?? 0n);
    if (plan.step === 'swap-sold') await store.actions.swapSell(Number(q.get('sell') ?? 40));
    return;
  }
  if (walletMode && (plan.step === 'deposit' || plan.step === 'coins') && store.get().config?.coinsOpen !== false) {
    // &wcoins=N: the wallet holds N test coins first (0: an empty wallet, not even registered on the coin)
    const wcoins = q.get('wcoins') === null ? 200 : Number(q.get('wcoins'));
    if (wcoins > 0) await store.client.faucetToWallet?.(wcoins);
    if (plan.step === 'coins') await store.actions.walletDeposit(45);
    await store.actions.refreshWalletInfo();
    store.actions.resetFlow('walletTx');
    // &dep=20: the deposit field holds 20 coins, as typed
    open('deposit', { prefill: q.get('dep') ?? undefined });
    return;
  }
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
    case 'airdrop':
    case 'airdrop-wait': {
      if (plan.step === 'airdrop-wait') {
        const mock = store.client as unknown as { setAirdropAt?: (account: string, at: number | null) => void };
        mock.setAirdropAt?.(store.get().accountId!, Date.now() - 3 * 60_000);
      }
      await store.actions.refreshAirdrop();
      if (plan.step === 'airdrop') await store.actions.airdrop();
      return;
    }
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
