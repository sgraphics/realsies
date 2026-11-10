// App state over a GameClient: framework-agnostic, one subscribe, plain actions.
// Keeps the player's own transcript copy in localStorage as messages arrive (Verify drawer check).

import type {
  ActiveChat, AirdropStatus, AuthChallenge, AuthFailure, AuthSession, ChatMessage, GameClient, LeaderRow, Level, Me, Mode, PlayKeyInfo, PublicConfig,
  RoundResults, RoundState, RoundSummary, Seat, ServerMsg, SwapQuestion, SwapQuote, TestUser, ThemeId, VerifyBundle, WalletInfo,
} from '../../../shared/protocol.ts';
import { removeTranscriptMessage, replaceTranscriptMessage, saveTranscriptMessage } from '../net/transcript.ts';
import { countdownFor, isCounting } from './countdown.ts';
import { BOTS_NAPPING } from './notices.ts';
import type { WalletApi, WalletError, WalletSignIn } from '../wallet/types.ts';
import { forgetPlayKey, loadPlayKey, newPlayKey, savePlayKey, type PlayKey } from '../wallet/keys.ts';
import { addPlayKeyTx, depositTx, sendSteps, storageTx, withdrawTx, type SendResult, type Step } from '../wallet/batch.ts';
import { buyNearNeeded, buyTxs, sellTxs, swapWalletOf, type SwapStep } from '../wallet/swap.ts';
import { fmtNear } from './near.ts';
import { parsePublicKey, signTransaction } from '../wallet/tx.ts';
import { base58Decode, base64Decode, base64Encode } from '../wallet/base58.ts';
import { depositCheck, emptyWalletText, shortWalletText, symbolOf } from './walletFunds.ts';
import { AIRDROP_IDLE, airdropErrorText, airdropOn, landedNote, type AirdropView } from './airdrop.ts';
import { guestRooms } from './guest.ts';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

/** A wallet session (protocol v1.3): the relay's Bearer token for this browser. */
export interface SessionView {
  accountId: string;
  token: string;
  expiresAt: number;
  playKey: PlayKeyInfo | null;
}

/** A wallet step on screen: getting ready (sign-in only), waiting for the wallet, checking on chain, done or failed. */
export interface Flow {
  phase: 'idle' | 'preparing' | 'wallet' | 'checking' | 'done' | 'error';
  error?: string;
  /** a friendly line under the step, e.g. why a second approval is needed */
  note?: string;
  tx?: string;
}

export interface RoomView {
  roundId: number;
  theme: ThemeId;
  seats: Seat[];
}

export interface ChatView extends ActiveChat {
  partnerTyping: boolean;
  endedReason?: 'time' | 'partner_left' | 'dev' | 'round_end';
  playTx?: string;
  callTx?: string;
  playFailed?: string;
  /** A call was sent and not yet recorded. */
  callPending?: boolean;
  /** Client-clock ms when the input opens after the full-screen countdown (chat_started ahead of now). */
  countdownUntil?: number;
  /** Countdown length in ms from when it began on this device. */
  countdownMs?: number;
  /** True until countdownUntil: the input stays shut (see isCounting for a timer-proof check). */
  counting?: boolean;
  /** Client minus relay ms for this chat's startedAt/endsAt; non-zero only when the countdown was clamped. */
  clockShift?: number;
  /** Text the relay refused before the start (chat_not_started), handed back to the input. */
  draft?: { text: string; n: number };
}

export interface SearchView {
  level: Level;
  seatIndex: number;
  mode: Mode;
  coins: number;
  startedAt: number;
}

export interface AppState {
  status: ConnStatus;
  config?: PublicConfig;
  testUsers?: TestUser[];
  accountId?: string;
  me?: Me;
  round?: RoundState;
  /** The room level the player is in (last enterRoom). */
  level: Level;
  rooms: Partial<Record<Level, RoomView>>;
  chat?: ChatView;
  search?: SearchView;
  /** Round ids whose results arrived and have not been opened yet. */
  resultsReady: number[];
  lastError?: { code: string; message: string; at: number };
  /** A friendly note for the room that is not an error (the bots are napping). */
  notice?: { code: string; message: string; at: number };
  /** the relay said beta_closed (a pick or a sign-in): the testnet beta is over (src/state/beta.ts) */
  betaOver?: { at: number };
  /** True once the welcome for the current account arrived. */
  welcomed: boolean;
  // ----- wallet sign-in (v1.3) -----
  session?: SessionView;
  signIn: Flow;
  keySetup: Flow & { via?: 'sign-in' | 'transaction' };
  /**
   * A deposit or withdrawal of the coin, or (v1.12) a buy with NEAR or a sale for NEAR: `coins` bought or sold, `near`
   * (yocto) about what a sale paid, `left` the coins landed in the wallet but the step after did not happen (the
   * deposit of a buy, the sale of a withdrawal): the coins dialog offers that step on its own.
   */
  walletTx: Flow & { kind?: 'deposit' | 'withdraw' | 'buy' | 'sell'; coins?: number; near?: string; left?: boolean };
  walletInfo?: WalletInfo;
  /** the relay refused a paid pick for want of a play key: the one-approval sheet opens, then the pick goes on */
  keyNeeded?: { code: string; at: number; pick?: { level: Level; seatIndex: number; coins: number } };
  // ----- the testnet airdrop (v1.6) -----
  airdrop: AirdropView;
}

export interface StoreActions {
  loadConfig(): Promise<PublicConfig>;
  /** A guest (not signed in) watches the room: the current round, public, no session (protocol v1.7). */
  loadGuest(): Promise<RoundState | null>;
  loadTestUsers(): Promise<TestUser[]>;
  selectUser(accountId: string): Promise<void>;
  logout(): void;
  enterRoom(level: Level): void;
  pickSeat(level: Level, seatIndex: number, mode: Mode, coins?: number): void;
  cancelSearch(): void;
  say(text: string): void;
  setTyping(on: boolean): void;
  call(human: boolean): void;
  devEndChat(): void;
  devEndRound(): Promise<void>;
  faucet(coins?: number): Promise<{ tx: string; me: Me }>;
  withdraw(coins: number): Promise<{ tx: string; me: Me }>;
  refreshMe(): Promise<Me | undefined>;
  clearChat(): void;
  clearError(): void;
  clearNotice(): void;
  markResultsSeen(roundId: number): void;
  getResults(roundId: number): Promise<RoundResults>;
  getVerify(chatId: string): Promise<VerifyBundle>;
  listRounds(): Promise<RoundSummary[]>;
  leaderboard(): Promise<LeaderRow[]>;
  // ----- wallet sign-in (v1.3) -----
  /**
   * Sign in with a NEAR wallet: one approval, a signed message, no gas. Call it straight from the tap: with a
   * challenge in hand (prepareSignIn) the wallet opens in the tap's own turn; without one it is fetched first
   * ("preparing"). A failure is reported to the relay (v1.11).
   */
  walletSignIn(): Promise<boolean>;
  /** The sign-in's challenge ahead of the tap: fetched when there is none or it is 5 minutes old (the prompt opens). */
  prepareSignIn(): Promise<boolean>;
  /** A session stored in this browser, if the relay still knows it. */
  resumeSession(): Promise<boolean>;
  signOut(): Promise<void>;
  /** This browser's play key: one wallet approval, then plays and calls without popups. */
  enableCoins(): Promise<boolean>;
  /** True when this browser holds an active play key for the session. */
  coinsEnabled(): boolean;
  walletDeposit(coins: number): Promise<boolean>;
  walletWithdraw(coins: number): Promise<boolean>;
  // ----- coins for NEAR on Rhea (v1.12, PublicConfig.swap) -----
  /** What NEAR buys or coins sell for now (the relay's quote). */
  swapQuote(q: SwapQuestion): Promise<SwapQuote>;
  /** Coins for `near` yoctoNEAR, into the game, in one wallet approval (wallet/swap.ts); then reads what landed. */
  swapBuy(near: bigint): Promise<boolean>;
  /** Coins from the game sold for NEAR in one approval; `from: 'wallet'` sells what the wallet itself holds. */
  swapSell(coins: number, from?: 'game' | 'wallet'): Promise<boolean>;
  refreshWalletInfo(): Promise<WalletInfo | undefined>;
  resetFlow(which: 'signIn' | 'keySetup' | 'walletTx'): void;
  clearKeyNeeded(): void;
  // ----- the testnet airdrop (v1.6) -----
  /** What an airdrop would do for this account now (the testnet demo only); null when there is none to be had. */
  refreshAirdrop(): Promise<AirdropStatus | null>;
  /** 100 test tokens in one tap: into a wallet player's wallet, into a test player's game balance. */
  airdrop(): Promise<boolean>;
}

export interface Store {
  get(): AppState;
  subscribe(fn: (s: AppState) => void): () => void;
  actions: StoreActions;
  client: GameClient;
  wallet?: WalletApi;
}

const SESSION_KEY = (network: string) => `realsies:session:${network}`;
/** A sign-in challenge is used for a tap while under this age (the relay keeps one 10 minutes), then fetched again. */
export const CHALLENGE_FRESH_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IDLE: Flow = { phase: 'idle' };

/** An Error from the client (HTTP code) or the wallet, as one line for the screen. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function errCode(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

const RESULTS_KEY = (a: string) => `realsies:resultsReady:${a}`;

/** Coins (a number with up to 4 decimals, as Me has them) in the coin's base units. */
function coinsToUnits(coins: number, unit: bigint): bigint {
  return (BigInt(Math.round(coins * 10_000)) * unit) / 10_000n;
}

/** v1.12: what the screen says when the price moved past a buy (the pool contract gave every wNEAR back). */
export const PRICE_MOVED_BUY = 'The price moved before your buy went through, so nothing was bought. Your NEAR waits in your wallet as wNEAR, and your next buy uses it first.';
export const PRICE_MOVED_SELL = 'The price moved before the sale went through, so nothing was sold.';

/** A wallet account's coins in its wallet and in the game, and its wNEAR, in base units (v1.12). */
interface Holdings {
  coin: bigint;
  game: bigint;
  wnear: bigint;
}

/** A buy the wallet cannot cover, in plain words. */
export function nearShortText(need: bigint, have: bigint): string {
  return `That needs ${fmtNear(need, 3)} NEAR with storage and gas; your wallet has ${fmtNear(have, 3)}.`;
}

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function createStore(client: GameClient, wallet?: WalletApi, opts: { now?: () => number } = {}): Store {
  const now = opts.now ?? Date.now;
  let state: AppState = { status: 'idle', level: 1, rooms: {}, resultsReady: [], welcomed: false, signIn: IDLE, keySetup: IDLE, walletTx: IDLE, airdrop: AIRDROP_IDLE };
  /** the coins the player chose at the last pick: a play to sign must be for exactly these */
  let pickedCoins: number | null = null;
  const subs = new Set<(s: AppState) => void>();
  let welcomeWaiters: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  let localSeq = 0;
  let draftSeq = 0;
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;

  const set = (patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    for (const f of [...subs]) f(state);
  };
  const patchChat = (chatId: string, fn: (c: ChatView) => Partial<ChatView>) => {
    const c = state.chat;
    if (!c || c.chatId !== chatId) return;
    set({ chat: { ...c, ...fn(c) } });
  };
  const persistResults = (list: number[]) => {
    if (!state.accountId) return;
    try {
      ls()?.setItem(RESULTS_KEY(state.accountId), JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };
  const loadResultsReady = (accountId: string): number[] => {
    try {
      const raw = ls()?.getItem(RESULTS_KEY(accountId));
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
    } catch {
      return [];
    }
  };

  /** Open the input exactly when the countdown ends (the overlay keeps its own beat). */
  const armCountdown = (chatId: string, ms: number) => {
    if (countdownTimer) clearTimeout(countdownTimer);
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      patchChat(chatId, (c) => (c.counting ? { counting: false } : {}));
    }, Math.max(0, ms));
  };
  const countdownFields = (startedAt: number | undefined, late: 'clamp' | 'none', seconds = state.config?.countdownSeconds): Partial<ChatView> => {
    if (startedAt === undefined) return {};
    const now = Date.now();
    const cd = countdownFor(startedAt, now, seconds, late);
    if (!cd) return {};
    return { counting: true, countdownUntil: cd.until, countdownMs: cd.ms, clockShift: cd.shift };
  };

  const fromActive = (a: ActiveChat, cfg?: PublicConfig): ChatView => {
    // a reconnect during the countdown picks it up again; a running chat does not restart it
    const cd = a.phase === 'chatting' && a.startedAt !== undefined && a.startedAt > Date.now() ? countdownFields(a.startedAt, 'none', cfg?.countdownSeconds ?? state.config?.countdownSeconds) : {};
    if (cd.countdownUntil) armCountdown(a.chatId, cd.countdownUntil - Date.now());
    return { ...a, messages: [...a.messages], partnerTyping: false, ...cd };
  };

  /**
   * The relay asks this browser to sign a play or call with its play key. Signed only when it is exactly what
   * the player asked for: their account and this browser's key, the game contract, play or call only, no
   * deposit, the chat on screen, the coins they chose, the call they made. Anything else is declined.
   */
  const onSignTx = (m: Extract<ServerMsg, { t: 'sign_tx' }>) => {
    const decline = (reason: string) => client.send({ t: 'sign_declined', reqId: m.reqId, reason });
    const s = state.session;
    const cfg = state.config;
    if (!s || !cfg) return decline('not signed in');
    const key = loadPlayKey(cfg.network, s.accountId);
    if (!key || key.publicKey !== m.tx.publicKey) return decline('this browser does not hold that play key');
    const a = m.tx.actions[0];
    if (m.tx.actions.length !== 1 || !a || a.type !== 'FunctionCall') return decline('one function call expected');
    if (m.tx.signerId !== s.accountId) return decline('that is another account');
    if (m.tx.receiverId !== cfg.contractId) return decline('not the game contract');
    if (a.methodName !== m.purpose || (a.methodName !== 'play' && a.methodName !== 'call')) return decline('a play key signs play and call only');
    if (a.deposit !== '0') return decline('a play key attaches no deposit');
    let gas: bigint, nonce: bigint, args: { round_id?: unknown; coins?: unknown; human?: unknown; handle?: unknown };
    try {
      gas = BigInt(a.gas);
      nonce = BigInt(m.tx.nonce);
      args = JSON.parse(a.args);
    } catch {
      return decline('malformed request');
    }
    if (gas <= 0n || gas > 100_000_000_000_000n) return decline('unexpected gas');
    const c = state.chat;
    if (!c || c.chatId !== m.chatId) return decline('not the chat on screen');
    if (args.round_id !== c.roundId || typeof args.handle !== 'string') return decline('not this chat');
    if (m.purpose === 'play') {
      const want = pickedCoins ?? c.coins;
      if (c.mode !== 'paid' || args.coins !== want || c.coins !== want) return decline(`not the ${want} coins you chose`);
    } else if (typeof args.human !== 'boolean' || args.human !== c.myCall) return decline('not the call you made');
    try {
      const { signed } = signTransaction(
        {
          signerId: m.tx.signerId, publicKey: parsePublicKey(m.tx.publicKey), nonce, receiverId: m.tx.receiverId, blockHash: base58Decode(m.tx.blockHash),
          methodName: a.methodName, args: new TextEncoder().encode(a.args), gas, deposit: 0n,
        },
        key.secretKey,
      );
      client.send({ t: 'signed_tx', reqId: m.reqId, signedTx: base64Encode(signed) });
    } catch (e) {
      decline(`could not sign: ${errText(e)}`);
    }
  };

  const onMsg = (m: ServerMsg) => {
    switch (m.t) {
      case 'sign_tx':
        onSignTx(m);
        return;
      case 'config':
        set({ config: m.config });
        return;
      case 'welcome': {
        const chat = m.activeChat ? fromActive(m.activeChat, m.config) : state.chat && state.chat.phase !== 'called' && state.chat.phase !== 'missed' ? undefined : state.chat;
        if (m.activeChat) for (const msg of m.activeChat.messages) saveTranscriptMessage(m.activeChat.chatId, msg);
        set({ me: m.me, round: m.round, config: m.config, chat, welcomed: true, status: 'open' });
        const w = welcomeWaiters;
        welcomeWaiters = [];
        for (const x of w) {
          clearTimeout(x.timer);
          x.resolve();
        }
        client.send({ t: 'enter_room', level: state.level });
        return;
      }
      case 'round': {
        const prev = state.round;
        set({ round: m.round });
        if (!prev || prev.roundId !== m.round.roundId) {
          set((s) => ({ rooms: {}, search: s.search && s.round?.roundId === m.round.roundId ? s.search : undefined }));
          client.send({ t: 'enter_room', level: state.level });
        }
        return;
      }
      case 'room':
        set((s) => ({ rooms: { ...s.rooms, [m.level]: { roundId: m.roundId, theme: m.theme, seats: m.seats } } }));
        return;
      case 'seat':
        set((s) => {
          const r = s.rooms[m.level];
          if (!r || r.roundId !== m.roundId) return {};
          const seats = r.seats.map((x) => (x.index === m.seat.index ? m.seat : x));
          return { rooms: { ...s.rooms, [m.level]: { ...r, seats } } };
        });
        return;
      case 'searching':
        set((s) => ({ search: s.search ?? { level: m.level, seatIndex: m.seatIndex, mode: 'free', coins: 0, startedAt: Date.now() } }));
        return;
      case 'matched': {
        const c = m.chat;
        set({
          search: undefined,
          chat: { ...c, phase: c.mode === 'paid' ? 'placing' : 'searching', messages: [], partnerTyping: false },
        });
        return;
      }
      case 'placing':
        patchChat(m.chatId, () => ({ phase: 'placing' }));
        return;
      case 'placed':
        patchChat(m.chatId, () => ({ playTx: m.tx }));
        return;
      case 'play_failed':
        patchChat(m.chatId, () => ({ playFailed: m.reason, mode: 'free', coins: 0 }));
        return;
      case 'chat_started': {
        const c0 = state.chat;
        if (!c0 || c0.chatId !== m.chatId) return;
        // a repeated chat_started for a running chat must not start the countdown again
        const cd = c0.phase === 'chatting' ? {} : countdownFields(m.startedAt, 'clamp');
        patchChat(m.chatId, () => ({ phase: 'chatting', startedAt: m.startedAt, endsAt: m.endsAt, ...cd }));
        if (cd.countdownUntil) armCountdown(m.chatId, cd.countdownUntil - Date.now());
        return;
      }
      case 'message': {
        const c0 = state.chat;
        const opt = c0 && c0.chatId === m.chatId && m.msg.from === 'me' ? c0.messages.find((x) => x.id.startsWith('local-') && x.text === m.msg.text) : undefined;
        if (opt) replaceTranscriptMessage(m.chatId, opt.id, m.msg);
        else saveTranscriptMessage(m.chatId, m.msg);
        patchChat(m.chatId, (c) => {
          if (c.messages.some((x) => x.id === m.msg.id)) return {};
          if (opt) return { messages: c.messages.map((x) => (x.id === opt.id ? m.msg : x)) };
          return { messages: [...c.messages, m.msg], partnerTyping: m.msg.from === 'them' ? false : c.partnerTyping };
        });
        return;
      }
      case 'typing':
        patchChat(m.chatId, () => ({ partnerTyping: m.on }));
        return;
      case 'chat_ended':
        patchChat(m.chatId, () => ({ phase: 'calling', callDeadline: m.callDeadline, endedReason: m.reason, partnerTyping: false }));
        return;
      case 'call_recorded':
        patchChat(m.chatId, () => ({ phase: 'called', myCall: m.human, callTx: m.tx, callPending: false }));
        return;
      case 'call_missed':
        patchChat(m.chatId, () => ({ phase: 'missed', myCall: null, callPending: false }));
        return;
      case 'me':
        set({ me: m.me });
        return;
      case 'results_ready': {
        if (state.resultsReady.includes(m.roundId)) return;
        const list = [...state.resultsReady, m.roundId];
        set({ resultsReady: list });
        persistResults(list);
        return;
      }
      case 'error': {
        if (m.code === 'session_expired') {
          // the relay no longer knows this browser's session: back to sign-in
          clearSession();
          actions.logout();
          set({ signIn: { phase: 'error', error: m.message } });
          return;
        }
        if (m.code === 'play_key_missing' || m.code === 'play_key_exhausted') {
          // a paid pick without a usable play key: the seat goes back, the one-approval sheet opens, then the same pick
          if (m.code === 'play_key_exhausted' && state.session && state.config) forgetPlayKey(state.config.network, state.session.accountId);
          const sr = state.search;
          set((s) => ({
            search: undefined,
            keyNeeded: { code: m.code, at: Date.now(), ...(sr && sr.mode === 'paid' ? { pick: { level: sr.level, seatIndex: sr.seatIndex, coins: sr.coins } } : {}) },
            session: s.session ? { ...s.session, playKey: m.code === 'play_key_exhausted' && s.session.playKey ? { ...s.session.playKey, status: 'exhausted' } : m.code === 'play_key_missing' ? null : s.session.playKey } : s.session,
          }));
          return;
        }
        if (m.code === 'beta_closed') {
          // the testnet beta is over: no new chats; the app says so and moves on (the config says where)
          set({ search: undefined, betaOver: { at: Date.now() } });
          void actions.loadConfig().catch(() => undefined);
          return;
        }
        const running = state.chat && (state.chat.phase === 'searching' || state.chat.phase === 'placing' || state.chat.phase === 'chatting');
        if (m.code === 'bots_unavailable' && !running) {
          // the bots are out of credits, so no new chats start for now: the search ends, the seat goes back
          // and the room gets one calm note. (With a chat running, the code means that matched chat could not
          // start; the relay's own message is shown below as before.)
          set({ search: undefined, notice: { code: m.code, message: BOTS_NAPPING, at: Date.now() } });
          return;
        }
        const searchErrors = ['room_empty', 'round_closing', 'round_closed', 'busy', 'seat_taken', 'bad_coins', 'insufficient_coins', 'insufficient_balance', 'round_ended', 'level_locked', 'bad_seat', 'bad_level', 'bad_mode', 'free_limit', 'already_searching', 'no_round', 'coins_closed', 'unknown_user'];
        const sayErrors = ['rate_limited', 'too_long', 'message_too_long', 'not_chatting', 'chat_not_active', 'empty_message'];
        const c = state.chat;
        if (c && m.code === 'chat_not_started') {
          // the input opened a moment before the relay's start (clock skew): not an error for the
          // player; the text goes back into the input to send again
          const last = [...c.messages].reverse().find((x) => x.id.startsWith('local-'));
          if (last) removeTranscriptMessage(c.chatId, last.id);
          set({ chat: { ...c, messages: last ? c.messages.filter((x) => x.id !== last.id) : c.messages, draft: last ? { text: last.text, n: ++draftSeq } : c.draft } });
          return;
        }
        if (c && sayErrors.includes(m.code)) {
          // the relay dropped our last optimistic message
          const last = [...c.messages].reverse().find((x) => x.id.startsWith('local-'));
          if (last) {
            removeTranscriptMessage(c.chatId, last.id);
            set({ chat: { ...c, messages: c.messages.filter((x) => x.id !== last.id) } });
          }
        }
        set((s) => ({
          lastError: { code: m.code, message: m.message, at: Date.now() },
          search: searchErrors.includes(m.code) ? undefined : s.search,
          chat: s.chat && m.code === 'call_closed' ? { ...s.chat, callPending: false } : s.chat,
        }));
        return;
      }
      case 'pong':
        return;
    }
  };

  client.on(onMsg);
  client.onStatus((st) => {
    if (!state.accountId) return;
    set({ status: st, ...(st !== 'open' ? { welcomed: false } : {}) });
  });

  const need = (): string => {
    if (!state.accountId) throw new Error('Pick a test user first.');
    return state.accountId;
  };

  // ----- wallet session plumbing -----
  const storeSession = (s: SessionView | undefined) => {
    const net = state.config?.network;
    if (!net) return;
    try {
      if (s) ls()?.setItem(SESSION_KEY(net), JSON.stringify({ token: s.token, accountId: s.accountId, expiresAt: s.expiresAt }));
      else ls()?.removeItem(SESSION_KEY(net));
    } catch {
      /* private mode: the session lasts for this page */
    }
  };
  const clearSession = () => {
    storeSession(undefined);
    set({ session: undefined, walletInfo: undefined, keyNeeded: undefined });
  };
  /**
   * A session from the relay. If this browser still holds an active play key the relay has not seen for
   * this session (a new sign-in), it is registered again quietly: the key is on chain already, no approval.
   */
  const adoptSession = (s: AuthSession) => {
    const view: SessionView = { accountId: s.accountId, token: s.token, expiresAt: s.expiresAt, playKey: s.playKey };
    set({ session: view, me: s.me });
    storeSession(view);
    const net = state.config?.network;
    const local = net ? loadPlayKey(net, s.accountId) : null;
    if (local && (!s.playKey || s.playKey.publicKey !== local.publicKey) && client.registerPlayKey) {
      client.registerPlayKey(local.publicKey).then(
        (info) => {
          savePlayKey(net!, s.accountId, { ...local, status: 'active' });
          set((x) => (x.session?.accountId === s.accountId ? { session: { ...x.session, playKey: info } } : {}));
        },
        () => {
          /* not on chain (removed in the wallet, or never approved): the next wallet transaction adds a new one */
        },
      );
    }
  };
  /** The play key is on chain: the relay checks it and keeps it for the session (polls while finality catches up). */
  const registerKey = async (publicKey: string, tries: number): Promise<PlayKeyInfo | null> => {
    for (let i = 0; i < tries; i++) {
      try {
        return await client.registerPlayKey!(publicKey);
      } catch (e) {
        if (errCode(e) !== 'play_key_not_found') throw e;
        if (i < tries - 1) await sleep(2000);
      }
    }
    return null;
  };
  /** This browser's key, checked on chain by the relay: kept as active, and the session knows it. */
  const activateKey = (network: string, accountId: string, key: PlayKey, info: PlayKeyInfo) => {
    savePlayKey(network, accountId, { ...key, status: 'active' });
    set((x) => (x.session?.accountId === accountId ? { session: { ...x.session, playKey: info } } : {}));
  };
  /**
   * The play key's step in the player's next wallet transaction (deposit or withdrawal), so the key needs no
   * approval of its own. Null when this browser holds a working key already, or one it made earlier turns out
   * to be on chain (approved, then the page reloaded).
   */
  const playKeyStep = async (s: SessionView, cfg: PublicConfig): Promise<{ key: PlayKey; step: Step } | null> => {
    const pk = cfg.wallet?.playKey;
    if (!pk || !client.registerPlayKey || actions.coinsEnabled()) return null;
    const old = loadPlayKey(cfg.network, s.accountId);
    if (old && s.playKey?.status !== 'exhausted') {
      const info = await registerKey(old.publicKey, 1).catch(() => null);
      if (info && info.status !== 'exhausted') {
        activateKey(cfg.network, s.accountId, old, info);
        return null;
      }
    }
    const key = newPlayKey();
    savePlayKey(cfg.network, s.accountId, key);
    return {
      key,
      step: { tx: addPlayKeyTx(s.accountId, key.publicKey, pk), optional: true, landed: async () => !!(await registerKey(key.publicKey, 1).catch(() => null)) },
    };
  };
  /** After the wallet sent the key: the relay checks it on chain (finality can trail by a few seconds). */
  const settleKey = async (network: string, accountId: string, key: PlayKey, sent: boolean): Promise<void> => {
    const info = await registerKey(key.publicKey, sent ? 8 : 1).catch(() => null);
    if (info) activateKey(network, accountId, key, info);
  };
  const walletReady = (): { s: SessionView; cfg: PublicConfig; w: WalletApi } => {
    const s = state.session;
    const cfg = state.config;
    if (!s || !cfg) throw new Error('Sign in with your wallet first.');
    if (!wallet) throw new Error('No wallet in this browser.');
    return { s, cfg, w: wallet };
  };
  /** A deposit sent from the wallet: the relay checks it on chain (finality can trail a few seconds); Me after it. */
  const reportDep = async (hash: string): Promise<Me | undefined> => {
    for (let i = 0; i < 6 && client.reportDeposit; i++) {
      try {
        return (await client.reportDeposit(hash)).me;
      } catch (e) {
        if (errCode(e) !== 'tx_unknown' || i === 5) throw e;
        await sleep(2000);
      }
    }
    return undefined;
  };
  /**
   * v1.12: what a wallet account holds, read again: the coin in its wallet and in the game (base units), and its
   * wNEAR. A read that fails counts as no change, never as coins that arrived.
   */
  const holdings = async (unit: bigint, prev: Holdings): Promise<Holdings> => {
    const [info, me] = await Promise.all([actions.refreshWalletInfo(), actions.refreshMe().catch(() => undefined)]);
    return {
      coin: info?.walletBalance !== undefined ? BigInt(info.walletBalance) : prev.coin,
      game: me ? coinsToUnits(me.balanceCoins, unit) : prev.game,
      wnear: info?.wnearBalance !== undefined ? BigInt(info.wnearBalance) : prev.wnear,
    };
  };

  // ----- the sign-in's challenge, ahead of the tap -----
  // A phone opens a wallet (its window, or the switch to its app) only from the tap itself: anything awaited between
  // the tap and NEAR Connect's wallet list loses that. So the challenge is fetched when the prompt opens and kept
  // while under 5 minutes old; it is spent once it goes to the relay with a signature.
  let prepared: { ch: AuthChallenge; at: number } | null = null;
  let preparing: Promise<AuthChallenge> | null = null;
  const freshChallenge = (): AuthChallenge | null => (prepared && now() - prepared.at < CHALLENGE_FRESH_MS ? prepared.ch : null);
  const fetchChallenge = (): Promise<AuthChallenge> => {
    if (preparing) return preparing;
    const p = (async () => {
      if (!state.config) await actions.loadConfig();
      if (!wallet || !client.authChallenge || !client.authVerify) throw new Error('Wallet sign-in is not available here.');
      const at = now();
      const ch = await client.authChallenge();
      prepared = { ch, at };
      return ch;
    })();
    preparing = p;
    const done = () => {
      if (preparing === p) preparing = null;
    };
    p.then(done, done);
    return p;
  };
  /** A failed sign-in for the operator's log (v1.11): where, which wallet, its own words, this browser; fire and forget. */
  const reportSignIn = (e: unknown, stage: AuthFailure['stage'], t0: number, prefetched: boolean, walletId?: string) => {
    if (!client.reportSignInFailure) return;
    const w = e as Partial<WalletError> | null;
    const words = w?.detail ?? errText(e);
    const id = w?.walletId ?? walletId;
    const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
    const f: AuthFailure = {
      stage, ...(id ? { walletId: id } : {}), message: (w?.code ? `${w.code}: ${words}` : words).slice(0, 300), ua: ua.slice(0, 240),
      ms: Math.max(0, Math.round(now() - t0)), prefetched,
    };
    client.reportSignInFailure(f).catch(() => {});
  };
  /** The reason on screen (a closed beta is no failure), the report, and a challenge ready for "Try again". */
  const signInFailed = (e: unknown, stage: AuthFailure['stage'], t0: number, prefetched: boolean, walletId?: string): false => {
    if (errCode(e) === 'beta_closed') {
      // the beta is over: no new sign-ins; the app says so and moves on
      set({ signIn: IDLE, betaOver: { at: Date.now() } });
      void actions.loadConfig().catch(() => undefined);
      return false;
    }
    set({ signIn: { phase: 'error', error: errText(e) } });
    reportSignIn(e, stage, t0, prefetched, walletId);
    void actions.prepareSignIn();
    return false;
  };
  /**
   * The sign-in with a challenge in hand. Up to the wallet's own call it runs in the caller's turn, so a tap with
   * the challenge ready reaches NEAR Connect with nothing awaited.
   */
  const signInWith = async (ch: AuthChallenge, t0: number, prefetched: boolean): Promise<boolean> => {
    set({ signIn: { phase: 'wallet' } });
    let signed: WalletSignIn;
    try {
      signed = await wallet!.signIn({ message: ch.message, recipient: ch.recipient, nonce: base64Decode(ch.nonce) });
    } catch (e) {
      // the relay never saw this challenge: it stays for "Try again" while it is fresh
      return signInFailed(e, (e as Partial<WalletError> | null)?.stage ?? 'sign', t0, prefetched);
    }
    // the relay spends the nonce on this attempt, whatever its answer
    if (prepared?.ch === ch) prepared = null;
    try {
      set({ signIn: { phase: 'checking' } });
      const s = await client.authVerify!({ accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: ch.nonce });
      adoptSession(s);
      set({ signIn: IDLE });
      await actions.selectUser(s.accountId);
      return true;
    } catch (e) {
      return signInFailed(e, 'verify', t0, prefetched, signed.walletId);
    }
  };

  const actions: StoreActions = {
    async loadConfig() {
      const config = await client.getConfig();
      set({ config });
      return config;
    },
    async loadGuest() {
      if (state.accountId || !client.currentRound) return null;
      const round = await client.currentRound().catch(() => null);
      // signed in meanwhile: the player's own round and rooms come over the socket
      if (state.accountId || !round || round.roundId < 1) return null;
      const same = state.round?.roundId === round.roundId && state.rooms[1]?.roundId === round.roundId;
      if (!same) set({ round, rooms: guestRooms(round) });
      else if (state.round!.status !== round.status || state.round!.endsAt !== round.endsAt) set({ round });
      return round;
    },
    async loadTestUsers() {
      const testUsers = await client.listTestUsers();
      set({ testUsers });
      return testUsers;
    },
    selectUser(accountId) {
      if (state.accountId && state.accountId !== accountId) actions.logout();
      set({ accountId, status: 'connecting', welcomed: false, rooms: {}, chat: undefined, search: undefined, me: undefined, resultsReady: loadResultsReady(accountId), airdrop: AIRDROP_IDLE });
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          welcomeWaiters = welcomeWaiters.filter((w) => w.timer !== timer);
          reject(new Error('The relay did not answer. Is it running?'));
        }, 15_000);
        welcomeWaiters.push({ resolve, reject, timer });
        client.connect(accountId);
      });
    },
    logout() {
      client.disconnect();
      for (const w of welcomeWaiters) {
        clearTimeout(w.timer);
        w.reject(new Error('Logged out.'));
      }
      welcomeWaiters = [];
      if (countdownTimer) clearTimeout(countdownTimer);
      countdownTimer = null;
      set({ accountId: undefined, me: undefined, round: undefined, rooms: {}, chat: undefined, search: undefined, status: 'idle', welcomed: false, resultsReady: [], lastError: undefined, notice: undefined, airdrop: AIRDROP_IDLE });
    },
    enterRoom(level) {
      set({ level });
      // a guest has no socket: its rooms are drawn from the round (loadGuest)
      if (state.accountId) client.send({ t: 'enter_room', level });
    },
    pickSeat(level, seatIndex, mode, coins) {
      pickedCoins = mode === 'paid' ? coins ?? 0 : null;
      set({ search: { level, seatIndex, mode, coins: mode === 'paid' ? coins ?? 0 : 0, startedAt: Date.now() }, lastError: undefined, notice: undefined, keyNeeded: undefined });
      client.send(mode === 'paid' ? { t: 'pick_seat', level, seatIndex, mode, coins } : { t: 'pick_seat', level, seatIndex, mode });
    },
    cancelSearch() {
      if (!state.search) return;
      client.send({ t: 'cancel_search' });
      set({ search: undefined });
    },
    say(text) {
      const c = state.chat;
      const t = text.trim();
      // nobody speaks before the countdown ends (the relay would refuse it with chat_not_started)
      if (!c || c.phase !== 'chatting' || isCounting(c) || !t) return;
      const msg: ChatMessage = { id: `local-${++localSeq}`, from: 'me', text: t.slice(0, 280), at: Date.now() };
      // keep our own copy even if the relay does not echo our messages back
      saveTranscriptMessage(c.chatId, msg);
      set({ chat: { ...c, messages: [...c.messages, msg] } });
      client.send({ t: 'say', chatId: c.chatId, text: msg.text });
    },
    setTyping(on) {
      const c = state.chat;
      if (c && c.phase === 'chatting' && !isCounting(c)) client.send({ t: 'typing', chatId: c.chatId, on });
    },
    call(human) {
      const c = state.chat;
      if (!c || c.phase !== 'calling' || c.callPending) return;
      set({ chat: { ...c, myCall: human, callPending: true } });
      client.send({ t: 'call', chatId: c.chatId, human });
    },
    devEndChat() {
      const c = state.chat;
      if (c) client.send({ t: 'dev_end_chat', chatId: c.chatId });
    },
    async devEndRound() {
      await client.devEndRound();
    },
    async faucet(coins) {
      const r = await client.faucet(need(), coins);
      set({ me: r.me });
      return r;
    },
    async withdraw(coins) {
      const r = await client.withdraw(need(), coins);
      set({ me: r.me });
      return r;
    },
    async refreshMe() {
      if (!state.accountId) return undefined;
      const me = await client.getMe(state.accountId);
      set({ me });
      return me;
    },
    clearChat() {
      set({ chat: undefined });
    },
    clearError() {
      set({ lastError: undefined });
    },
    clearNotice() {
      set({ notice: undefined });
    },
    markResultsSeen(roundId) {
      const list = state.resultsReady.filter((r) => r !== roundId);
      set({ resultsReady: list });
      persistResults(list);
    },
    getResults(roundId) {
      return client.getResults(roundId, need());
    },
    getVerify(chatId) {
      return client.getVerify(chatId, need());
    },
    listRounds() {
      return client.listRounds();
    },
    leaderboard() {
      return client.leaderboard();
    },

    // ----- wallet sign-in (v1.3) -----
    walletSignIn() {
      const phase = state.signIn.phase;
      if (phase === 'preparing' || phase === 'wallet' || phase === 'checking') return Promise.resolve(false);
      const t0 = now();
      const ready = freshChallenge();
      // the challenge came ahead of the tap: the wallet opens in this very turn
      if (ready) return signInWith(ready, t0, true);
      // none yet, or it is 5 minutes old: fetched now, "Preparing…" on the button meanwhile (Cancel drops it)
      set({ signIn: { phase: 'preparing' } });
      return fetchChallenge().then(
        (ch) => (state.signIn.phase === 'preparing' ? signInWith(ch, t0, false) : false),
        (e) => (state.signIn.phase === 'preparing' ? signInFailed(e, 'connect', t0, false) : false),
      );
    },
    prepareSignIn() {
      if (freshChallenge()) return Promise.resolve(true);
      return fetchChallenge().then(
        () => true,
        () => false,
      );
    },
    async resumeSession() {
      const cfg = state.config ?? (await actions.loadConfig().catch(() => undefined));
      if (!cfg || !client.resumeSession) return false;
      let saved: { token?: string } | null = null;
      try {
        saved = JSON.parse(ls()?.getItem(SESSION_KEY(cfg.network)) ?? 'null');
      } catch {
        saved = null;
      }
      if (!saved?.token) return false;
      const s = await client.resumeSession(saved.token).catch(() => null);
      if (!s) {
        storeSession(undefined);
        return false;
      }
      adoptSession(s);
      await actions.selectUser(s.accountId).catch(() => {});
      return true;
    },
    async signOut() {
      const s = state.session;
      const net = state.config?.network;
      try {
        await client.signOut?.();
      } catch {
        /* the relay forgets the session anyway when it expires */
      }
      await wallet?.signOut().catch(() => {});
      // the browser forgets its play key too: on a shared computer nobody else can play your coins
      if (s && net) forgetPlayKey(net, s.accountId);
      clearSession();
      set({ signIn: IDLE, keySetup: IDLE, walletTx: IDLE });
      actions.logout();
    },
    coinsEnabled() {
      const s = state.session;
      const cfg = state.config;
      if (!s || !cfg || s.playKey?.status !== 'active') return false;
      const local = loadPlayKey(cfg.network, s.accountId);
      return !!local && local.publicKey === s.playKey.publicKey;
    },
    async enableCoins() {
      if (state.keySetup.phase === 'wallet' || state.keySetup.phase === 'checking') return false;
      try {
        const { s, cfg, w } = walletReady();
        const pk = cfg.wallet?.playKey;
        if (!pk || !client.registerPlayKey) throw new Error('This relay does not take play keys.');
        set({ keySetup: { phase: 'checking' }, keyNeeded: undefined });
        // a key made earlier in this browser may be on chain already (approved, then the page reloaded)
        let key = loadPlayKey(cfg.network, s.accountId);
        let info: PlayKeyInfo | null = null;
        if (key && s.playKey?.status !== 'exhausted') info = await registerKey(key.publicKey, 1).catch(() => null);
        if (info?.status === 'exhausted') info = null;
        if (!info) {
          key = newPlayKey();
          savePlayKey(cfg.network, s.accountId, key);
          let req = { accountId: s.accountId, publicKey: key.publicKey, contractId: pk.receiverId, methodNames: pk.methodNames, allowance: pk.allowance };
          const atSignIn = await w.canAddKeyAtSignIn();
          set({ keySetup: { phase: 'wallet', via: atSignIn ? 'sign-in' : 'transaction' } });
          let added = true;
          try {
            await w.addPlayKey(req, atSignIn ? 'sign-in' : 'transaction');
          } catch (e) {
            if (!atSignIn || errCode(e) === 'rejected' || errCode(e) === 'wrong_account') throw e;
            added = false;
          }
          set({ keySetup: { phase: 'checking', via: atSignIn ? 'sign-in' : 'transaction' } });
          // a wallet may add a broader key than asked (any method, another contract): the relay refuses it
          let mismatch = false;
          if (added) {
            try {
              info = await registerKey(key.publicKey, 8);
            } catch (e) {
              if (!atSignIn || !['play_key_methods', 'play_key_wrong_contract', 'play_key_full_access'].includes(errCode(e) ?? '')) throw e;
              mismatch = true;
            }
          }
          if (!info && atSignIn) {
            // the sign-in added no key, or the wrong one: one AddKey transaction with exactly play and call instead
            if (mismatch) {
              key = newPlayKey();
              savePlayKey(cfg.network, s.accountId, key);
              req = { ...req, publicKey: key.publicKey };
            }
            const note = mismatch
              ? 'Your wallet added a broader key than asked (you can delete it in your wallet). One more approval sends the right one as a transaction.'
              : 'Your wallet did not add the key while signing in. One more approval sends it as a transaction.';
            set({ keySetup: { phase: 'wallet', via: 'transaction', note } });
            await w.addPlayKey(req, 'transaction');
            set({ keySetup: { phase: 'checking', via: 'transaction' } });
            info = await registerKey(key.publicKey, 8);
          }
          if (!info) throw new Error('The key did not show up on your account. Try again in a minute.');
        }
        savePlayKey(cfg.network, s.accountId, { ...key!, status: 'active' });
        set((x) => ({ session: x.session ? { ...x.session, playKey: info } : x.session, keySetup: { phase: 'done', via: x.keySetup.via } }));
        return true;
      } catch (e) {
        set((x) => ({ keySetup: { phase: 'error', via: x.keySetup.via, error: errText(e) } }));
        return false;
      }
    },
    async walletDeposit(coins) {
      try {
        const { s, cfg, w } = walletReady();
        const n = Math.floor(coins);
        if (!(n > 0)) throw new Error('Choose how many coins to deposit.');
        if (cfg.coinsOpen === false) throw new Error('Coins open when $REAL launches.');
        const amount = BigInt(n) * BigInt(cfg.coinUnit);
        // never send a deposit that can only fail: the wallet must hold the coins (an empty wallet is not even
        // registered on the coin, and the token panics)
        set({ walletTx: { phase: 'checking', kind: 'deposit' } });
        const info = await actions.refreshWalletInfo();
        const chk = depositCheck(info, n, cfg.coinUnit);
        if (!chk.ok) {
          const sym = symbolOf(cfg);
          throw new Error(chk.reason === 'empty' ? emptyWalletText(sym) : shortWalletText(sym, chk.walletUnits!, cfg.tokenDecimals ?? 18, chk.fits!));
        }
        const held = info?.walletBalance !== undefined ? BigInt(info.walletBalance) : null;
        // one approval: the play key (while this browser has none), the registration (while the account has
        // none), the deposit
        const key = await playKeyStep(s, cfg);
        const steps: Step[] = [];
        if (key) steps.push(key.step);
        if (info && !info.tokenRegistered) steps.push({ tx: storageTx(cfg, s.accountId, info.storageDeposit), landed: async () => (await actions.refreshWalletInfo())?.tokenRegistered === true });
        steps.push({
          tx: depositTx(cfg, amount),
          landed: async () => {
            const now = await actions.refreshWalletInfo();
            return held !== null && now?.walletBalance !== undefined && BigInt(now.walletBalance) + amount <= held;
          },
        });
        set({ walletTx: { phase: 'wallet', kind: 'deposit' } });
        const { hashes } = await sendSteps(w, s.accountId, steps);
        const hash = hashes[hashes.length - 1];
        set({ walletTx: { phase: 'checking', kind: 'deposit', ...(hash ? { tx: hash } : {}) } });
        let me: Me | undefined;
        for (let i = 0; hash && i < 6 && client.reportDeposit; i++) {
          try {
            me = (await client.reportDeposit(hash)).me;
            break;
          } catch (e) {
            if (errCode(e) !== 'tx_unknown' || i === 5) throw e;
            await sleep(2000);
          }
        }
        if (me) set({ me });
        else await actions.refreshMe().catch(() => undefined);
        if (key) await settleKey(cfg.network, s.accountId, key.key, hashes[0] !== null);
        await actions.refreshWalletInfo();
        void actions.refreshAirdrop();
        set({ walletTx: { phase: 'done', kind: 'deposit', ...(hash ? { tx: hash } : {}) } });
        return true;
      } catch (e) {
        set((x) => ({ walletTx: { ...x.walletTx, phase: 'error', kind: 'deposit', error: errText(e) } }));
        return false;
      }
    },
    async walletWithdraw(coins) {
      try {
        const { s, cfg, w } = walletReady();
        const n = Math.floor(coins);
        if (!(n > 0)) throw new Error('Choose how many coins to withdraw.');
        const before = state.me?.balanceCoins ?? 0;
        if (n > before + 1e-9) throw new Error('Not enough coins in the game.');
        set({ walletTx: { phase: 'checking', kind: 'withdraw' } });
        const info = await actions.refreshWalletInfo();
        const amount = BigInt(n) * BigInt(cfg.coinUnit);
        // one approval: the play key (while this browser has none), the registration on the coin (it pays out
        // only to registered accounts), the withdrawal
        const key = await playKeyStep(s, cfg);
        const steps: Step[] = [];
        if (key) steps.push(key.step);
        if (info && !info.tokenRegistered) steps.push({ tx: storageTx(cfg, s.accountId, info.storageDeposit), landed: async () => (await actions.refreshWalletInfo())?.tokenRegistered === true });
        steps.push({
          tx: withdrawTx(cfg, amount),
          landed: async () => {
            const me = await actions.refreshMe().catch(() => undefined);
            return !!me && me.balanceCoins <= before - n + 1e-6;
          },
        });
        set({ walletTx: { phase: 'wallet', kind: 'withdraw' } });
        const { hashes } = await sendSteps(w, s.accountId, steps);
        const hash = hashes[hashes.length - 1];
        set({ walletTx: { phase: 'checking', kind: 'withdraw', ...(hash ? { tx: hash } : {}) } });
        for (let i = 0; i < 6; i++) {
          const me = await actions.refreshMe().catch(() => undefined);
          if (me && me.balanceCoins <= before - n + 1e-6) break;
          await sleep(1500);
        }
        if (key) await settleKey(cfg.network, s.accountId, key.key, hashes[0] !== null);
        await actions.refreshWalletInfo();
        void actions.refreshAirdrop();
        set({ walletTx: { phase: 'done', kind: 'withdraw', ...(hash ? { tx: hash } : {}) } });
        return true;
      } catch (e) {
        set((x) => ({ walletTx: { ...x.walletTx, phase: 'error', kind: 'withdraw', error: errText(e) } }));
        return false;
      }
    },

    // ----- coins for NEAR on Rhea (v1.12) -----
    swapQuote(q) {
      if (!client.swapQuote) return Promise.reject(new Error('Buying coins with NEAR is not on here.'));
      return client.swapQuote(q);
    },
    async swapBuy(near) {
      try {
        const { s, cfg, w } = walletReady();
        if (!cfg.swap || !client.swapQuote) throw new Error('Buying coins with NEAR is not on here.');
        if (cfg.coinsOpen === false) throw new Error('Coins open when $REAL launches.');
        const unit = BigInt(cfg.coinUnit);
        set({ walletTx: { phase: 'checking', kind: 'buy' } });
        const [info, me, q] = await Promise.all([actions.refreshWalletInfo(), actions.refreshMe().catch(() => undefined), client.swapQuote({ side: 'buy', near: near.toString() })]);
        const wal = swapWalletOf(info);
        if (!info || !wal || info.walletBalance === undefined || !me) throw new Error('Your wallet could not be read just now. Try again in a moment.');
        const coins = q.coins ?? 0;
        if (coins < 1 || !q.coinUnits) throw new Error('That buys less than one coin. Try a little more NEAR.');
        // never send a buy the wallet cannot cover: the registrations, the NEAR it wraps, and some left for gas
        const need = buyNearNeeded(near, wal);
        if (wal.near !== null && need > wal.near) throw new Error(nearShortText(need, wal.near));
        const units = BigInt(q.coinUnits);
        const before: Holdings = { coin: BigInt(info.walletBalance), game: coinsToUnits(me.balanceCoins, unit), wnear: wal.wnear };
        // the coins that came in, wherever they are now (the wallet, or on into the game)
        const up = (h: Holdings) => h.coin - before.coin + (h.game - before.game);
        // after a refused batch each step goes alone and only if it did not land meanwhile: never a second buy
        let buySent = false;
        const landed = (step: SwapStep) => async (): Promise<boolean> => {
          if (step === 'coin_storage') return (await actions.refreshWalletInfo())?.tokenRegistered === true;
          let h = await holdings(unit, before);
          if (step === 'buy') {
            // the coins came in, or the wrap transaction ran and the price moved past it (its NEAR waits as wNEAR)
            const done = up(h) >= units || h.wnear > before.wnear;
            buySent = !done;
            return done;
          }
          // the deposit: the bought coins sit in the wallet until it runs; a buy sent a moment ago may still be showing up
          for (let i = 0; buySent && i < 5 && h.coin < before.coin + units; i++) {
            await sleep(1500);
            h = await holdings(unit, before);
          }
          return h.coin < before.coin + units;
        };
        // one approval: the play key (while this browser has none), the registration on the coin, the swap, the deposit
        const key = await playKeyStep(s, cfg);
        const txs = buyTxs(cfg, s.accountId, { maxIn: near, units }, wal);
        const steps: Step[] = [...(key ? [key.step] : []), ...txs.map((t) => ({ tx: t.tx, landed: landed(t.step) }))];
        set({ walletTx: { phase: 'wallet', kind: 'buy', coins } });
        let sent: SendResult | null = null;
        let failure: unknown = null;
        try {
          sent = await sendSteps(w, s.accountId, steps);
        } catch (e) {
          failure = e;
        }
        const buyHash = sent?.hashes[steps.length - 2] ?? undefined;
        const depHash = sent?.hashes[steps.length - 1] ?? undefined;
        const tx = depHash ?? buyHash;
        set({ walletTx: { phase: 'checking', kind: 'buy', coins, ...(tx ? { tx } : {}) } });
        // the relay checks the deposit on chain, as with any deposit (and pays a locked bonus with it)
        if (depHash) {
          const m = await reportDep(depHash).catch(() => undefined);
          if (m) set({ me: m });
        }
        // what landed, from the balances: a swap the price moved past still reads as a success in the wallet
        let after = await holdings(unit, before);
        for (let i = 0; i < 5 && !failure && up(after) < units; i++) {
          await sleep(1500);
          after = await holdings(unit, before);
        }
        if (key) await settleKey(cfg.network, s.accountId, key.key, !!sent && sent.hashes[0] !== null);
        void actions.refreshAirdrop();
        if (up(after) >= units) {
          // bought; when the deposit did not follow (a wallet that sent it before the swap had finished), the coins wait
          // in the wallet and the dialog offers to put them in the game
          const left = after.coin >= before.coin + units;
          set({ walletTx: { phase: 'done', kind: 'buy', coins, ...(left ? { left: true } : {}), ...(tx ? { tx } : {}) } });
          return true;
        }
        // nothing bought: the wallet's own reason when nothing ran on chain (the player closed it), else the price moved
        if (failure && errCode(failure) !== 'tx_failed' && after.wnear <= before.wnear) throw failure;
        throw new Error(PRICE_MOVED_BUY + (after.game > before.game ? ' The coins your wallet already held went into the game.' : ''));
      } catch (e) {
        set((x) => ({ walletTx: { ...x.walletTx, phase: 'error', kind: 'buy', error: errText(e) } }));
        return false;
      }
    },
    async swapSell(coins, from = 'game') {
      try {
        const { s, cfg, w } = walletReady();
        if (!cfg.swap || !client.swapQuote) throw new Error('Selling coins for NEAR is not on here.');
        const unit = BigInt(cfg.coinUnit);
        set({ walletTx: { phase: 'checking', kind: 'sell' } });
        const [info, me] = await Promise.all([actions.refreshWalletInfo(), actions.refreshMe().catch(() => undefined)]);
        const wal = swapWalletOf(info);
        if (!info || !wal || info.walletBalance === undefined || !me) throw new Error('Your wallet could not be read just now. Try again in a moment.');
        const before: Holdings = { coin: BigInt(info.walletBalance), game: coinsToUnits(me.balanceCoins, unit), wnear: wal.wnear };
        let units: bigint;
        if (from === 'game') {
          const n = Math.floor(coins);
          if (!(n > 0)) throw new Error('Choose how many coins to withdraw.');
          if (n > me.balanceCoins + 1e-9) throw new Error('Not enough coins in the game.');
          units = BigInt(n) * unit;
        } else {
          units = before.coin;
          if (units <= 0n) throw new Error('Your wallet holds no coins.');
        }
        const shown = Number((units * 10_000n) / unit) / 10_000;
        const q = await client.swapQuote({ side: 'sell', units: units.toString() });
        // from the game the coins pass through the wallet: withdrawn, then sold
        const extra = from === 'game' ? units : 0n;
        const withdrawn = (h: Holdings) => from === 'wallet' || h.game <= before.game - units;
        const sold = (h: Holdings) => withdrawn(h) && h.coin + units <= before.coin + extra;
        let withdrawSent = false;
        const landed = (step: SwapStep) => async (): Promise<boolean> => {
          if (step === 'coin_storage') return (await actions.refreshWalletInfo())?.tokenRegistered === true;
          let h = await holdings(unit, before);
          if (step === 'withdraw') {
            withdrawSent = !withdrawn(h);
            return !withdrawSent;
          }
          if (step === 'sell') {
            // a withdrawal sent a moment ago may still be showing up in the wallet
            for (let i = 0; withdrawSent && i < 5 && h.coin < before.coin + extra; i++) {
              await sleep(1500);
              h = await holdings(unit, before);
            }
            return h.coin < before.coin + extra;
          }
          return h.wnear < before.wnear;
        };
        // one approval: the play key with a withdrawal (while this browser has none), the registration on the coin, the
        // withdrawal, the sale, and wNEAR left from earlier buys back to NEAR
        const key = from === 'game' ? await playKeyStep(s, cfg) : null;
        const txs = sellTxs(cfg, s.accountId, { units, minOut: BigInt(q.minOut) }, wal, from);
        const steps: Step[] = [...(key ? [key.step] : []), ...txs.map((t) => ({ tx: t.tx, landed: landed(t.step) }))];
        const saleAt = (key ? 1 : 0) + txs.findIndex((t) => t.step === 'sell');
        set({ walletTx: { phase: 'wallet', kind: 'sell', coins: shown } });
        let sent: SendResult | null = null;
        let failure: unknown = null;
        try {
          sent = await sendSteps(w, s.accountId, steps);
        } catch (e) {
          failure = e;
        }
        const tx = sent?.hashes[saleAt] ?? undefined;
        set({ walletTx: { phase: 'checking', kind: 'sell', coins: shown, ...(tx ? { tx } : {}) } });
        let after = await holdings(unit, before);
        for (let i = 0; i < 5 && !failure && !sold(after); i++) {
          await sleep(1500);
          after = await holdings(unit, before);
        }
        if (key) await settleKey(cfg.network, s.accountId, key.key, !!sent && sent.hashes[0] !== null);
        void actions.refreshAirdrop();
        if (sold(after)) {
          set({ walletTx: { phase: 'done', kind: 'sell', coins: shown, near: q.amountOut, ...(tx ? { tx } : {}) } });
          return true;
        }
        if (from === 'game' && withdrawn(after)) {
          // withdrawn but not sold (the price moved, or the wallet sent the sale before the withdrawal had finished):
          // the coins wait in the wallet and the dialog offers the sale on its own
          set({ walletTx: { phase: 'done', kind: 'sell', coins: shown, left: true, ...(tx ? { tx } : {}) } });
          return true;
        }
        if (failure && errCode(failure) !== 'tx_failed') throw failure;
        throw new Error(PRICE_MOVED_SELL);
      } catch (e) {
        set((x) => ({ walletTx: { ...x.walletTx, phase: 'error', kind: 'sell', error: errText(e) } }));
        return false;
      }
    },
    async refreshWalletInfo() {
      if (!state.session || !client.walletInfo) return undefined;
      try {
        const walletInfo = await client.walletInfo();
        set({ walletInfo });
        return walletInfo;
      } catch {
        return undefined;
      }
    },
    resetFlow(which) {
      set({ [which]: IDLE } as Partial<AppState>);
    },
    clearKeyNeeded() {
      set({ keyNeeded: undefined });
    },

    // ----- the testnet airdrop (v1.6) -----
    async refreshAirdrop() {
      const acct = state.accountId;
      if (!acct || !airdropOn(state.config)) return null;
      if (!client.airdropStatus) {
        if (state.airdrop.status === undefined) set((x) => ({ airdrop: { ...x.airdrop, status: null } }));
        return null;
      }
      try {
        const status = await client.airdropStatus(acct);
        if (state.accountId !== acct) return null;
        set((x) => ({ airdrop: { ...x.airdrop, status } }));
        return status;
      } catch {
        // an older relay, or it did not answer: the panel stays a slim tag
        if (state.accountId === acct && state.airdrop.status === undefined) set((x) => ({ airdrop: { ...x.airdrop, status: null } }));
        return null;
      }
    },
    async airdrop() {
      const acct = state.accountId;
      if (!acct || state.airdrop.phase === 'busy') return false;
      const symbol = symbolOf(state.config);
      set((x) => ({ airdrop: { ...x.airdrop, phase: 'busy', error: undefined } }));
      try {
        if (!airdropOn(state.config) || !client.airdrop) throw Object.assign(new Error('The airdrop is for the testnet demo only.'), { code: 'not_test_mode' });
        const r = await client.airdrop(acct);
        if (state.accountId !== acct) return false;
        // the panel is gone now (the player holds tokens); a short note says where they landed
        set({
          me: r.me,
          ...(r.wallet ? { walletInfo: r.wallet } : {}),
          airdrop: { phase: 'idle', status: r.status },
          notice: { code: 'airdrop', message: landedNote(r.to, r.coins, symbol), at: Date.now() },
        });
        return true;
      } catch (e) {
        if (state.accountId !== acct) return false;
        const code = errCode(e) ?? 'error';
        // the relay's view again (when the next one opens, what is held), for the reason on screen
        await actions.refreshAirdrop();
        if (state.accountId !== acct) return false;
        set((x) => ({ airdrop: { ...x.airdrop, phase: 'error', error: { code, text: airdropErrorText(code, e, x.airdrop.status, symbol) } } }));
        return false;
      }
    },
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    actions,
    client,
    wallet,
  };
}
