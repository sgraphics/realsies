// App state over a GameClient: framework-agnostic, one subscribe, plain actions.
// Keeps the player's own transcript copy in localStorage as messages arrive (Verify drawer check).

import type {
  ActiveChat, ChatMessage, GameClient, LeaderRow, Level, Me, Mode, PublicConfig, RoundResults, RoundState,
  RoundSummary, Seat, ServerMsg, TestUser, ThemeId, VerifyBundle,
} from '../../../shared/protocol.ts';
import { removeTranscriptMessage, replaceTranscriptMessage, saveTranscriptMessage } from '../net/transcript.ts';
import { countdownFor, isCounting } from './countdown.ts';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

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
  /** True once the welcome for the current account arrived. */
  welcomed: boolean;
}

export interface StoreActions {
  loadConfig(): Promise<PublicConfig>;
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
  markResultsSeen(roundId: number): void;
  getResults(roundId: number): Promise<RoundResults>;
  getVerify(chatId: string): Promise<VerifyBundle>;
  listRounds(): Promise<RoundSummary[]>;
  leaderboard(): Promise<LeaderRow[]>;
}

export interface Store {
  get(): AppState;
  subscribe(fn: (s: AppState) => void): () => void;
  actions: StoreActions;
  client: GameClient;
}

const RESULTS_KEY = (a: string) => `realsies:resultsReady:${a}`;

function ls(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function createStore(client: GameClient): Store {
  let state: AppState = { status: 'idle', level: 1, rooms: {}, resultsReady: [], welcomed: false };
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

  const onMsg = (m: ServerMsg) => {
    switch (m.t) {
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
        const searchErrors = ['room_empty', 'round_closing', 'round_closed', 'busy', 'seat_taken', 'bad_coins', 'insufficient_coins', 'insufficient_balance', 'round_ended', 'level_locked', 'bad_seat', 'bad_level', 'bad_mode', 'free_limit', 'already_searching', 'no_round'];
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

  const actions: StoreActions = {
    async loadConfig() {
      const config = await client.getConfig();
      set({ config });
      return config;
    },
    async loadTestUsers() {
      const testUsers = await client.listTestUsers();
      set({ testUsers });
      return testUsers;
    },
    selectUser(accountId) {
      if (state.accountId && state.accountId !== accountId) actions.logout();
      set({ accountId, status: 'connecting', welcomed: false, rooms: {}, chat: undefined, search: undefined, me: undefined, resultsReady: loadResultsReady(accountId) });
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
      set({ accountId: undefined, me: undefined, round: undefined, rooms: {}, chat: undefined, search: undefined, status: 'idle', welcomed: false, resultsReady: [], lastError: undefined });
    },
    enterRoom(level) {
      set({ level });
      client.send({ t: 'enter_room', level });
    },
    pickSeat(level, seatIndex, mode, coins) {
      set({ search: { level, seatIndex, mode, coins: mode === 'paid' ? coins ?? 0 : 0, startedAt: Date.now() }, lastError: undefined });
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
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    actions,
    client,
  };
}
