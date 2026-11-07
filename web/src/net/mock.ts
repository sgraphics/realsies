// MockGameClient: a full in-browser simulation of the relay (selected with ?mock=1).
// Round clock, per-viewer rooms, matching with a 2.5-6 s search, lively canned bots that sign every
// reply with a simulated enclave key, a fake human-vs-human path, calls, settlement with the
// 70/20/10 split and 5% fee, results, ratings and Verify bundles (incl. the real 2026-11-04 evidence).

import {
  type ActiveChat, type ChatInfo, type ChatMessage, type ChatPhase, type ChatResult, type ClientMsg, type GameClient,
  type LeaderRow, type Level, type Me, type Mode, type PlayerStats, type PublicConfig, type RoundResults, type RoundState,
  type RoundStatus, type RoundSummary, type Seat, type ServerMsg, type Skin, type TestUser, type ThemeId, type Truth,
  type VerifyBundle, type VerifyCompletion, type VerifyMessage, LEVELS, themeFor,
  type AuthChallenge, type AuthProof, type AuthSession, type PlayKeyInfo, type SignRequestTx, type WalletInfo, type LaunchConfig,
  type AirdropResult, type AirdropStatus, AIRDROP,
} from '../../../shared/protocol.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyNep413 } from '../wallet/nep413.ts';
import { decodeSignedTransaction, publicKeyString, verifySignedTransaction } from '../wallet/tx.ts';
import { base58Encode, base64Decode, base64Encode } from '../wallet/base58.ts';
import type { KeyPermission, MockLedger } from '../wallet/mock.ts';
import type { WalletTx } from '../wallet/types.ts';
import { gamertag, WORDS } from '../../../shared/names.ts';
import { sha256Hex } from '../verify/crypto.ts';
import { bubblesOf, commitmentPreimage } from '../verify/checks.ts';
import { PERSONAS, HUMAN_NUDGE, HUMAN_OPENERS, humanReply, personaById, personaCard, personaOpener, personaReply } from './mock/personas.ts';
import { type Rand, c4, fakeTx, makeRand, randHex } from './mock/util.ts';
import { type PlayIn, applyRating, isRight, ratingDelta, settleCharacter, wouldHave } from './mock/settle.ts';
import { MOCK_GATEWAY, MOCK_SIGNER, type Turn, buildRequest, makeCompletion, skinMessage } from './mock/enclave.ts';
import { EVIDENCE_CHAT_ID, EVIDENCE_MODEL, type EvidenceLoader, evidenceBundle, viteEvidenceLoader } from './mock/evidence.ts';

type Status = 'connecting' | 'open' | 'closed';
type Timer = ReturnType<typeof setTimeout>;

export interface MockOptions {
  chatSeconds?: number;
  callSeconds?: number;
  /** Full-screen countdown before every chat (config.countdownSeconds; default 3, 0 = none). */
  countdownSeconds?: number;
  roundMinutes?: number;
  /** Search delay range in ms (default 2500-6000, times timeScale). */
  searchMs?: [number, number];
  /** Multiplies every simulated delay (search, typing, bots, placing); not chat or round lengths. */
  timeScale?: number;
  loadEvidence?: EvidenceLoader;
  now?: () => number;
  random?: () => number;
  /** Always match a fake human partner (also: localStorage['realsies:mock:human'] = '1'). */
  forceHuman?: boolean;
  /** Never match a fake human. */
  noHuman?: boolean;
  /** Make every paid play fail (also: localStorage['realsies:mock:playfail'] = '1'). */
  forcePlayFailed?: boolean;
  /** Chance that a paid play fails on its own (default 1/30). */
  playFailChance?: number;
  /** localStorage key for persistence; null disables it. */
  storageKey?: string | null;
  /** QA: give every seat the longest possible gamertag (an 8-letter word plus 3 digits, 11 characters). */
  longNames?: boolean;
  startRoundId?: number;
  /**
   * The bots are out of NEAR AI credits (also: localStorage['realsies:mock:nobots'] = '1'). Like the relay,
   * no new chats start at all, human to human included: every pick gets bots_unavailable at once and the
   * seat goes back. Chats already running finish as normal.
   */
  noBots?: boolean;
  /**
   * Like a mainnet relay (TEST_MODE=0): no test users, players sign in with a wallet (MockWallet) and their
   * browser signs every play and call with its play key (sign_tx).
   */
  wallet?: boolean;
  /** false: the contract has no coin yet (mainnet before REAL launches): free play only */
  coinsOpen?: boolean;
  buyUrl?: string;
  /** ms a browser has to answer sign_tx (default 20000) */
  signTimeoutMs?: number;
  /** the launch page (protocol v1.4): PublicConfig.launch, until coins open */
  launch?: LaunchConfig;
  /** the coin is set this many ms after start (coinsOpen turns true, the launch banner goes) */
  opensAfterMs?: number;
  /** the public config says mainnet (REAL, mainnet explorer links): the launch mock; the ledger is the same */
  mainnet?: boolean;
}

/** The relay's words for bots_unavailable on a search (the web shows its own calm note instead). */
const BOTS_UNAVAILABLE = 'The bots are out of NEAR AI credits: no new chats for a few minutes.';

const COIN_UNIT = 10n ** 18n;
const MOCK_BLOCK_HASH = base58Encode(sha256(new TextEncoder().encode('realsies mock block')));
const MOCK_ALLOWANCE = '250000000000000000000000';

function apiError(code: string, message: string, status = 400, data?: Record<string, unknown>): Error {
  const e = new Error(message) as Error & { code: string; status: number; data?: Record<string, unknown> };
  e.code = code;
  e.status = status;
  if (data) e.data = { code, message, ...data };
  return e;
}

/** The mock relay's public config (testnet, test coins); also used by the mock AI-builder API. */
export function mockConfig(opts: Pick<MockOptions, 'chatSeconds' | 'callSeconds' | 'roundMinutes' | 'countdownSeconds' | 'wallet' | 'coinsOpen' | 'buyUrl' | 'launch' | 'mainnet'> = {}): PublicConfig {
  return {
    testMode: !opts.wallet,
    network: opts.mainnet ? 'mainnet' : 'testnet',
    contractId: 'game.realsies.testnet',
    tokenId: 'real.realsies.testnet',
    tokenSymbol: opts.mainnet ? 'REAL' : 'tREAL',
    coinUnit: '1000000000000000000',
    usdPerCoin: 0.01,
    presets: { 1: [5, 10, 25], 2: [25, 50, 100], 3: [100, 250, 500] },
    minCoins: 5,
    maxCoins: 500,
    chatSeconds: opts.chatSeconds ?? 120,
    callSeconds: opts.callSeconds ?? 20,
    roundMinutes: opts.roundMinutes ?? 10,
    feeBps: 500,
    freeChatsPerDay: 0,
    countdownSeconds: opts.countdownSeconds ?? 3,
    explorerTx: `https://${opts.mainnet ? '' : 'testnet.'}nearblocks.io/txns/{hash}`,
    explorerAccount: `https://${opts.mainnet ? '' : 'testnet.'}nearblocks.io/address/{account}`,
    coinsOpen: opts.coinsOpen ?? true,
    ...(opts.buyUrl ? { buyUrl: opts.buyUrl } : {}),
    tokenDecimals: 18,
    wallet: {
      recipient: 'realsies.lol',
      playKey: { receiverId: 'game.realsies.testnet', methodNames: ['play', 'call'], allowance: MOCK_ALLOWANCE },
      gas: { deposit: '100000000000000', withdraw: '50000000000000', storage: '30000000000000' },
    },
    ...(opts.launch ? { launch: { ...opts.launch } } : {}),
  };
}

const TEST_USERS: { accountId: string; label: string; balance: number; rating: number; chats: number; right: number }[] = [
  { accountId: 'ana.realsies.testnet', label: 'Ana', balance: 120, rating: 1032, chats: 14, right: 9 },
  { accountId: 'ben.realsies.testnet', label: 'Ben', balance: 0, rating: 1000, chats: 0, right: 0 },
  { accountId: 'cleo.realsies.testnet', label: 'Cleo', balance: 45, rating: 1088, chats: 23, right: 16 },
  { accountId: 'dex.realsies.testnet', label: 'Dex', balance: 0, rating: 968, chats: 6, right: 2 },
  { accountId: 'eve.realsies.testnet', label: 'Eve', balance: 300, rating: 1121, chats: 31, right: 22 },
  { accountId: 'finn.realsies.testnet', label: 'Finn', balance: 15, rating: 1004, chats: 3, right: 2 },
];

const EXTRA_LEADERS: LeaderRow[] = [
  { label: 'Mia', rating: 1214, chats: 58, accuracy: 0.74 },
  { label: 'Tomás', rating: 1163, chats: 41, accuracy: 0.71 },
  { label: 'Ines', rating: 1097, chats: 19, accuracy: 0.68 },
  { label: 'Rafa', rating: 1012, chats: 12, accuracy: 0.58 },
];

interface UserRec {
  accountId: string;
  label: string;
  seed: string;
  balance: number;
  locked: number;
  rating: number;
  stats: PlayerStats;
  lockedBonus: number;
  payout: Record<string, 'self' | 'promo'>;
  /** signed in with a wallet (the browser signs plays and calls) */
  kind?: 'wallet';
}

interface MockSession {
  account: string;
  expiresAt: number;
  playKey: PlayKeyInfo | null;
}

interface PendingSign {
  reqId: string;
  chatId: string;
  viewer: string;
  purpose: 'play' | 'call';
  tx: SignRequestTx;
  timer: Timer;
  /** ok: info is the transaction hash; not ok: the reason */
  done(ok: boolean, info: string): void;
}

interface RoundRec {
  roundId: number;
  startedAt: number;
  endsAt: number;
  acceptingUntil: number;
  status: RoundStatus;
  secret: string;
  secretHash: string;
  startTx: string;
  commitTxs: string[];
  revealTx?: string;
  openTxs: string[];
  settleTx?: string;
  settledAt?: number;
  characters: number;
  chats: number;
  paidPlays: number;
  seeded?: boolean;
}

interface ChatRec {
  chatId: string;
  roundId: number;
  level: Level;
  seatIndex: number;
  theme: ThemeId;
  partner: Skin;
  viewer: string;
  mode: Mode;
  coins: number; // requested
  played: number; // actually played on chain (0 when free or failed)
  locked: number; // played minus the 5% fee
  kind: Truth;
  personaId?: string;
  humanAccount?: string;
  characterId: string;
  salt: string;
  handle: string;
  phase: ChatPhase;
  messages: ChatMessage[];
  startedAt?: number;
  endsAt?: number;
  callDeadline?: number;
  myCall?: boolean | null;
  playTx?: string;
  callTx?: string;
  playFailed?: string;
  endedReason?: string;
  completions: VerifyCompletion[];
  transcript: VerifyMessage[];
  history: Turn[];
  pendingUser: Turn[];
  partnerPaid?: boolean;
  partnerCoins?: number;
  partnerCall?: boolean | null;
}

interface SearchRec {
  viewer: string;
  roundId: number;
  level: Level;
  seatIndex: number;
  mode: Mode;
  coins: number;
  timer?: Timer;
}

interface Persisted {
  v: 1;
  users: Record<string, UserRec>;
  rounds: RoundRec[];
  current: number;
  chats: ChatRec[];
  results: Record<string, RoundResults>;
  bundles: Record<string, VerifyBundle>;
  unavailable: string[];
  // wallet sign-in (protocol v1.3); absent in state saved before it
  /** account -> public key -> key on the mock chain */
  keys?: Record<string, Record<string, { permission: KeyPermission; nonce: number }>>;
  /** coins held in wallets, outside the game */
  walletCoins?: Record<string, number>;
  registered?: string[];
  sessions?: Record<string, MockSession>;
  /** deposit tx hash -> account */
  deposits?: Record<string, string>;
  /** the testnet airdrop (v1.6): account -> when it last had one (ms) */
  airdrops?: Record<string, number>;
}

interface Brain {
  r: Rand;
  busy: boolean;
  pending: boolean;
  used: Set<string>;
  turn: number;
  wait?: Timer;
  typing: boolean;
}

const PAYOUT_BOTS = 'bots.realsies.testnet';

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}
function flag(name: string): boolean {
  try {
    return storage()?.getItem(name) === '1';
  } catch {
    return false;
  }
}

export class MockGameClient implements GameClient, MockLedger {
  readonly config: PublicConfig;
  /** the session this client holds (wallet sign-in), like the real client's Bearer token */
  private token: string | null = null;
  private challenges = new Map<string, { message: string; expiresAt: number }>();
  private spentNonces = new Set<string>();
  private signs = new Map<string, PendingSign>();
  private o: Required<Pick<MockOptions, 'timeScale'>> & MockOptions;
  private now: () => number;
  private r: Rand;
  private ts: number;
  private loadEvidence: EvidenceLoader;
  private st: Persisted;
  private key: string | null;
  private saveTimer: Timer | null = null;

  private handlers = new Set<(m: ServerMsg) => void>();
  private statusHandlers = new Set<(s: Status) => void>();
  private status: Status = 'closed';
  private account: string | null = null;
  private outbox: ServerMsg[] = [];
  private flushing: Timer | null = null;
  private inbox: ClientMsg[] = [];

  private timers = new Set<Timer>();
  private chatTimers = new Map<string, Set<Timer>>();
  private brains = new Map<string, Brain>();
  private search: SearchRec | null = null;
  private lastSay = new Map<string, number>();
  private disposed = false;

  constructor(opts: MockOptions = {}) {
    this.o = { timeScale: 1, ...opts };
    this.ts = this.o.timeScale;
    this.now = opts.now ?? (() => Date.now());
    this.r = makeRand(opts.random);
    this.loadEvidence = opts.loadEvidence ?? viteEvidenceLoader;
    this.key = opts.storageKey === undefined ? 'realsies:mock:v1' : opts.storageKey;
    this.config = mockConfig(opts);
    this.st = this.load() ?? this.fresh();
    this.resume();
    if (opts.opensAfterMs !== undefined && this.config.coinsOpen === false) this.later(opts.opensAfterMs, () => this.openCoins());
  }

  /** The owner sets the coin on the contract: coins open, the launch page goes (like a relay without test mode), every connection hears it. */
  openCoins(): void {
    if (this.config.coinsOpen === true && !this.config.launch) return;
    this.config.coinsOpen = true;
    if (!this.config.testMode) delete this.config.launch;
    this.emit({ t: 'config', config: { ...this.config } });
  }

  // ======================= persistence =======================

  private load(): Persisted | null {
    if (!this.key) return null;
    try {
      const raw = storage()?.getItem(this.key);
      if (!raw) return null;
      const p = JSON.parse(raw) as Persisted;
      if (p.v !== 1 || !p.rounds?.length) return null;
      return p;
    } catch {
      return null;
    }
  }

  private save(now = false): void {
    if (!this.key || this.disposed) return;
    const doSave = () => {
      this.saveTimer = null;
      try {
        // keep storage bounded
        const keepRounds = new Set(this.st.rounds.slice(-30).map((r) => r.roundId));
        this.st.rounds = this.st.rounds.filter((r) => keepRounds.has(r.roundId));
        const bundleIds = Object.keys(this.st.bundles);
        if (bundleIds.length > 40) for (const id of bundleIds.slice(0, bundleIds.length - 40)) delete this.st.bundles[id];
        storage()?.setItem(this.key!, JSON.stringify(this.st));
      } catch {
        /* quota: keep running in memory */
      }
    };
    if (now) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      doSave();
    } else if (!this.saveTimer) this.saveTimer = setTimeout(doSave, 250);
  }

  private fresh(): Persisted {
    const users: Record<string, UserRec> = {};
    for (const u of TEST_USERS)
      users[u.accountId] = {
        accountId: u.accountId,
        label: u.label,
        seed: sha256Hex(u.accountId),
        balance: u.balance,
        locked: 0,
        rating: u.rating,
        stats: { chats: u.chats, right: u.right, wrong: u.chats - u.right, streak: Math.min(2, u.right), bestStreak: Math.min(5, u.right) },
        lockedBonus: u.accountId.startsWith('ben') ? 3.4 : 0,
        payout: {},
      };
    const start = this.o.startRoundId ?? 7;
    const len = this.config.roundMinutes * 60_000;
    const t = this.now();
    const rounds: RoundRec[] = [];
    for (let k = 3; k >= 1; k--) {
      const startedAt = t - 60_000 - k * len;
      rounds.push({
        roundId: start - k, startedAt, endsAt: startedAt + len, acceptingUntil: startedAt + len - this.acceptMarginMs(), status: 'settled',
        secret: randHex(this.r, 64), secretHash: '', startTx: fakeTx(this.r), commitTxs: [fakeTx(this.r)], revealTx: fakeTx(this.r),
        openTxs: [fakeTx(this.r)], settleTx: fakeTx(this.r), settledAt: startedAt + len + 75_000,
        characters: 30 + this.r.int(5), chats: 8 + this.r.int(20), paidPlays: 3 + this.r.int(12), seeded: true,
      });
    }
    for (const r of rounds) r.secretHash = sha256Hex(r.secret);
    const st: Persisted = { v: 1, users, rounds, current: start, chats: [], results: {}, bundles: {}, unavailable: [] };
    st.rounds.push(this.makeRound(start, t - 60_000));
    return st;
  }

  private acceptMarginMs(): number {
    return (this.config.chatSeconds + this.config.callSeconds + 15) * 1000;
  }

  private makeRound(roundId: number, startedAt: number): RoundRec {
    const len = this.config.roundMinutes * 60_000;
    const secret = randHex(this.r, 64);
    return {
      roundId, startedAt, endsAt: startedAt + len, acceptingUntil: startedAt + len - this.acceptMarginMs(), status: 'open',
      secret, secretHash: sha256Hex(secret), startTx: fakeTx(this.r), commitTxs: [fakeTx(this.r)], openTxs: [],
      characters: PERSONAS.length * LEVELS.length, chats: 0, paidPlays: 0,
    };
  }

  private cur(): RoundRec {
    return this.st.rounds.find((r) => r.roundId === this.st.current)!;
  }
  private roundById(id: number): RoundRec | undefined {
    return this.st.rounds.find((r) => r.roundId === id);
  }

  /** Re-arm timers after construction (fresh or restored from storage). */
  private resume(): void {
    const t = this.now();
    // settle any unsettled past rounds
    for (const r of this.st.rounds) if (r.roundId !== this.st.current && r.status !== 'settled') this.later(10, () => this.settleRound(r.roundId));
    const cur = this.cur();
    if (cur.endsAt <= t) {
      this.later(10, () => this.endRound('time'));
    } else this.armRound();
    for (const c of this.st.chats) {
      if (c.roundId !== this.st.current) continue;
      if (c.phase === 'searching' || c.phase === 'placing') {
        c.phase = 'chatting';
        c.startedAt ??= t;
        c.endsAt ??= t + this.config.chatSeconds * 1000;
      }
      if (c.phase === 'chatting') {
        if ((c.endsAt ?? 0) > t) {
          this.chatLater(c.chatId, c.endsAt! - t, () => this.endChat(c.chatId, 'time'));
          this.brainFor(c);
          if (c.pendingUser.length) this.onPlayerMessage(c);
        } else {
          const deadline = (c.endsAt ?? t) + this.config.callSeconds * 1000;
          c.phase = 'calling';
          c.endedReason = 'time';
          c.callDeadline = deadline;
        }
      }
      if (c.phase === 'calling') {
        const left = (c.callDeadline ?? t) - t;
        this.chatLater(c.chatId, Math.max(0, left), () => this.missCall(c.chatId));
      }
    }
  }

  private armRound(): void {
    const cur = this.cur();
    const t = this.now();
    if (cur.acceptingUntil > t) this.later(cur.acceptingUntil - t, () => this.emitRound());
    this.later(Math.max(0, cur.endsAt - t), () => {
      if (this.st.current === cur.roundId) this.endRound('time');
    });
  }

  // ======================= timers =======================

  private later(ms: number, fn: () => void): Timer {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.disposed) fn();
    }, Math.max(0, ms));
    this.timers.add(t);
    return t;
  }

  private chatLater(chatId: string, ms: number, fn: () => void): Timer {
    const set = this.chatTimers.get(chatId) ?? new Set<Timer>();
    this.chatTimers.set(chatId, set);
    const t = this.later(ms, () => {
      set.delete(t);
      fn();
    });
    set.add(t);
    return t;
  }

  private clearChatTimers(chatId: string): void {
    const set = this.chatTimers.get(chatId);
    if (set) for (const t of set) {
      clearTimeout(t);
      this.timers.delete(t);
    }
    this.chatTimers.delete(chatId);
  }

  private d(ms: number): number {
    return ms * this.ts;
  }

  /** Stop every timer (tests). */
  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.flushing) clearTimeout(this.flushing);
  }

  // ======================= emission =======================

  private emit(msg: ServerMsg, viewer?: string): void {
    if (this.status !== 'open' || !this.account) return;
    if (viewer && viewer !== this.account) return;
    this.outbox.push(msg);
    if (!this.flushing)
      this.flushing = setTimeout(() => {
        this.flushing = null;
        const q = this.outbox;
        this.outbox = [];
        for (const m of q)
          for (const h of [...this.handlers]) {
            try {
              h(m);
            } catch (e) {
              console.error('mock handler failed', e);
            }
          }
      }, 0);
  }

  private setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    for (const h of [...this.statusHandlers]) h(s);
  }

  private emitRound(): void {
    this.emit({ t: 'round', round: this.roundState() });
  }

  private emitMe(viewer: string): void {
    this.emit({ t: 'me', me: this.meOf(viewer) }, viewer);
  }

  private err(code: string, message: string, viewer?: string): void {
    this.emit({ t: 'error', code, message }, viewer);
  }

  // ======================= views =======================

  private user(accountId: string): UserRec {
    const u = this.st.users[accountId];
    if (!u) throw new Error(`Unknown test user ${accountId}`);
    return u;
  }

  private meOf(accountId: string): Me {
    const u = this.user(accountId);
    return {
      accountId: u.accountId,
      label: u.label,
      balanceCoins: c4(u.balance),
      lockedCoins: c4(u.locked),
      rating: u.rating,
      stats: { ...u.stats },
      levelUnlocked: 3,
      lockedBonusCoins: c4(u.lockedBonus),
      freeChatsLeft: null,
      kind: u.kind === 'wallet' ? 'wallet' : 'test',
    };
  }

  private roundState(): RoundState {
    const r = this.cur();
    const status: RoundStatus = r.status === 'open' && this.now() >= r.acceptingUntil ? 'closing' : r.status;
    return {
      roundId: r.roundId,
      startedAt: r.startedAt,
      endsAt: r.endsAt,
      acceptingUntil: r.acceptingUntil,
      status,
      themes: { 1: themeFor(1, r.roundId), 2: themeFor(2, r.roundId), 3: themeFor(3, r.roundId) },
      chain: { startTx: r.startTx, commitTxs: [...r.commitTxs] },
    };
  }

  private seatSeed(roundId: number, viewer: string, level: Level, seat: number): string {
    return sha256Hex(`mock|${roundId}|${viewer}|${level}|${seat}`);
  }

  private skin(roundId: number, viewer: string, level: Level, seat: number): Skin {
    const seed = this.seatSeed(roundId, viewer, level, seat);
    if (this.o.longNames) {
      const long = WORDS.filter((w) => w.length === 8);
      return { seed, name: long[parseInt(seed.slice(0, 4), 16) % long.length] + String(100 + (parseInt(seed.slice(4, 8), 16) % 900)) };
    }
    return { seed, name: gamertag(seed) };
  }

  private seatOf(viewer: string, level: Level, index: number): Seat {
    const roundId = this.st.current;
    const skin = this.skin(roundId, viewer, level, index);
    const s = this.search;
    if (s && s.viewer === viewer && s.roundId === roundId && s.level === level && s.seatIndex === index)
      return { index, skin, state: 'searching', mode: s.mode, coins: s.mode === 'paid' ? s.coins : 0 };
    const c = this.st.chats.find((x) => x.viewer === viewer && x.roundId === roundId && x.level === level && x.seatIndex === index);
    if (c) {
      const done = c.phase === 'called' || c.phase === 'missed';
      return {
        index, skin, state: done ? 'called' : 'chatting', chatId: c.chatId, mode: c.played > 0 ? 'paid' : 'free', coins: c.played,
        ...(done ? { myCall: c.myCall ?? null } : {}),
      };
    }
    if (this.st.unavailable.includes(`${roundId}|${viewer}|${level}|${index}`)) return { index, skin, state: 'unavailable' };
    return { index, skin, state: 'open' };
  }

  private emitSeat(viewer: string, level: Level, index: number): void {
    this.emit({ t: 'seat', level, roundId: this.st.current, seat: this.seatOf(viewer, level, index) }, viewer);
  }

  private chatInfo(c: ChatRec): ChatInfo {
    return {
      chatId: c.chatId, roundId: c.roundId, level: c.level, seatIndex: c.seatIndex, theme: c.theme, partner: c.partner,
      mode: c.mode, coins: c.mode === 'paid' ? c.coins : 0, startedAt: c.startedAt, endsAt: c.endsAt,
    };
  }

  private activeChatOf(viewer: string): ActiveChat | undefined {
    const c = this.st.chats.find((x) => x.viewer === viewer && x.roundId === this.st.current && (x.phase === 'placing' || x.phase === 'chatting' || x.phase === 'calling'));
    if (!c) return undefined;
    return { ...this.chatInfo(c), phase: c.phase, messages: [...c.messages], callDeadline: c.callDeadline, myCall: c.myCall };
  }

  // ======================= HTTP-like API =======================

  private async tick<T>(fn: () => T): Promise<T> {
    await new Promise((res) => setTimeout(res, this.d(60)));
    return fn();
  }

  getConfig(): Promise<PublicConfig> {
    return this.tick(() => ({ ...this.config, presets: { ...this.config.presets } }));
  }

  // ======================= wallet sign-in (protocol v1.3) =======================

  private sessionOf(viewer: string): MockSession | null {
    const s = this.token ? this.st.sessions?.[this.token] : undefined;
    return s && s.account === viewer && s.expiresAt > this.now() ? s : null;
  }

  private isWallet(viewer: string): boolean {
    return this.st.users[viewer]?.kind === 'wallet';
  }

  private sessionView(token: string, s: MockSession): AuthSession {
    return { token, accountId: s.account, expiresAt: s.expiresAt, playKey: s.playKey ? { ...s.playKey } : null, me: this.meOf(s.account) };
  }

  authChallenge(): Promise<AuthChallenge> {
    return this.tick(() => {
      const nonce = new Uint8Array(32);
      for (let i = 0; i < 32; i++) nonce[i] = this.r.int(256);
      const n = base64Encode(nonce);
      const c = { message: `Sign in to Realsies at ${this.config.wallet!.recipient}.\n\nThis is a signature, not a transaction: it costs nothing and moves nothing.`, expiresAt: this.now() + 600_000 };
      this.challenges.set(n, c);
      return { nonce: n, message: c.message, recipient: this.config.wallet!.recipient, expiresAt: c.expiresAt };
    });
  }

  authVerify(proof: AuthProof): Promise<AuthSession> {
    return this.tick(() => {
      if (this.spentNonces.has(proof.nonce)) throw apiError('nonce_used', 'This sign-in request was already used; sign in again.', 401);
      const c = this.challenges.get(proof.nonce);
      if (!c) throw apiError('nonce_unknown', 'Unknown sign-in request; sign in again.', 401);
      this.challenges.delete(proof.nonce);
      this.spentNonces.add(proof.nonce);
      if (c.expiresAt <= this.now()) throw apiError('nonce_expired', 'The sign-in request expired; sign in again.', 401);
      const ok = verifyNep413({ message: c.message, nonce: base64Decode(proof.nonce), recipient: this.config.wallet!.recipient, callbackUrl: proof.callbackUrl ?? null }, proof.publicKey, proof.signature);
      if (!ok) throw apiError('bad_signature', `The signature does not match this sign-in for ${this.config.wallet!.recipient}.`, 401);
      const key = this.st.keys?.[proof.accountId]?.[proof.publicKey];
      if (!key) throw apiError('key_not_found', `${proof.publicKey} is not a key of ${proof.accountId}.`, 403);
      if (key.permission !== 'FullAccess') throw apiError('not_full_access', 'Sign in with a full-access key of the account.', 403);
      if (!this.st.users[proof.accountId]) {
        this.st.users[proof.accountId] = {
          accountId: proof.accountId, label: proof.accountId, seed: sha256Hex(proof.accountId), balance: 0, locked: 0, rating: 1000,
          stats: { chats: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0 }, lockedBonus: 0, payout: {}, kind: 'wallet',
        };
      } else if (!TEST_USERS.some((t) => t.accountId === proof.accountId)) this.st.users[proof.accountId].kind = 'wallet';
      const token = 'mst_' + randHex(this.r, 32);
      const s: MockSession = { account: proof.accountId, expiresAt: this.now() + 30 * 86_400_000, playKey: null };
      (this.st.sessions ??= {})[token] = s;
      this.token = token;
      this.save();
      return this.sessionView(token, s);
    });
  }

  resumeSession(token: string): Promise<AuthSession | null> {
    return this.tick(() => {
      const s = this.st.sessions?.[token];
      if (!s || s.expiresAt <= this.now() || !this.st.users[s.account]) return null;
      this.token = token;
      return this.sessionView(token, s);
    });
  }

  async signOut(): Promise<void> {
    await this.tick(() => {
      if (this.token && this.st.sessions) delete this.st.sessions[this.token];
      this.token = null;
      this.save();
    });
    this.disconnect();
  }

  registerPlayKey(publicKey: string): Promise<PlayKeyInfo> {
    return this.tick(() => {
      const s = this.token ? this.st.sessions?.[this.token] : undefined;
      if (!s) throw apiError('unauthorized', 'Sign in first.', 401);
      const k = this.st.keys?.[s.account]?.[publicKey];
      if (!k) throw apiError('play_key_not_found', `The key is not on ${s.account} yet; approve it in your wallet, then try again.`, 409);
      if (k.permission === 'FullAccess') throw apiError('play_key_full_access', 'A play key must be a function-call key.', 400);
      if (k.permission.receiverId !== this.config.contractId) throw apiError('play_key_wrong_contract', `The key is for ${k.permission.receiverId}.`, 400);
      const methods = [...k.permission.methodNames].sort().join(',');
      if (methods !== 'call,play') throw apiError('play_key_methods', 'A play key may call exactly play and call.', 400);
      s.playKey = { publicKey, receiverId: k.permission.receiverId, methodNames: ['play', 'call'], allowance: k.permission.allowance, status: 'active' };
      this.save();
      return { ...s.playKey };
    });
  }

  walletInfo(): Promise<WalletInfo> {
    return this.tick(() => {
      const s = this.token ? this.st.sessions?.[this.token] : undefined;
      if (!s) throw apiError('unauthorized', 'Sign in first.', 401);
      return this.walletInfoOf(s.account);
    });
  }

  private walletInfoOf(account: string): WalletInfo {
    const open = this.config.coinsOpen !== false;
    const held = open ? this.st.walletCoins?.[account] ?? 0 : 0;
    return {
      accountId: account, coinsOpen: open, tokenId: this.config.tokenId, tokenRegistered: open && (this.st.registered ?? []).includes(account),
      storageDeposit: open ? '1250000000000000000000' : '0', walletBalance: ((BigInt(Math.round(held * 10_000)) * COIN_UNIT) / 10_000n).toString(),
    };
  }

  reportDeposit(txHash: string): Promise<{ me: Me; bonusTx?: string }> {
    return this.tick(() => {
      const s = this.token ? this.st.sessions?.[this.token] : undefined;
      if (!s) throw apiError('unauthorized', 'Sign in first.', 401);
      const who = this.st.deposits?.[txHash];
      if (!who) throw apiError('tx_unknown', 'That deposit is not on chain yet.', 409);
      if (who !== s.account) throw apiError('not_your_tx', 'That deposit belongs to another account.', 403);
      const u = this.user(s.account);
      let bonusTx: string | undefined;
      if (u.lockedBonus > 0) {
        u.balance = c4(u.balance + u.lockedBonus);
        u.lockedBonus = 0;
        bonusTx = fakeTx(this.r);
      }
      delete this.st.deposits![txHash];
      this.save();
      const me = this.meOf(s.account);
      this.emit({ t: 'me', me }, s.account);
      return { me, bonusTx };
    });
  }

  /**
   * Tests and QA only: coins into the signed-in wallet, any amount, in any mode (what a wallet holds before a
   * screenshot). The screens use the airdrop; the relay's own route for this is the airdrop since v1.6.
   */
  faucetToWallet(coins = 100): Promise<{ tx: string }> {
    return this.tick(() => {
      const s = this.token ? this.st.sessions?.[this.token] : undefined;
      if (!s) throw apiError('unauthorized', 'Sign in first.', 401);
      const w = (this.st.walletCoins ??= {});
      w[s.account] = (w[s.account] ?? 0) + coins;
      const reg = (this.st.registered ??= []);
      if (!reg.includes(s.account)) reg.push(s.account);
      this.save();
      return { tx: fakeTx(this.r) };
    });
  }

  /** Coins in a wallet, outside the game (tests). */
  walletCoinsOf(account: string): number {
    return this.st.walletCoins?.[account] ?? 0;
  }

  // ======================= the testnet airdrop (protocol v1.6) =======================

  /** Who may have one, and where it lands; the relay's rules (src/game/game.ts airdrop). */
  private airdropTarget(accountId: string): 'wallet' | 'game' {
    if (!this.config.testMode || this.config.network !== 'testnet') throw apiError('not_test_mode', 'The airdrop is for the testnet demo only.', 403);
    if (this.config.coinsOpen === false) throw apiError('coins_closed', 'The game contract has no coin yet.', 409);
    if (this.isWallet(accountId)) {
      if (!this.sessionOf(accountId)) throw apiError('unauthorized', 'Sign in first.', 401);
      return 'wallet';
    }
    if (!this.st.users[accountId]) throw apiError('unknown_user', `${accountId} is not a player here.`, 404);
    return 'game';
  }

  private airdropStatusOf(accountId: string, to: 'wallet' | 'game'): AirdropStatus {
    const now = this.now();
    const lastAt = this.st.airdrops?.[accountId] ?? null;
    const nextAt = lastAt === null ? now : Math.max(now, lastAt + AIRDROP.everyMinutes * 60_000);
    // a test player has no wallet in the game: its game balance counts; a wallet player's wallet counts too
    const heldCoins = c4(this.user(accountId).balance + (to === 'wallet' ? this.st.walletCoins?.[accountId] ?? 0 : 0));
    const blocked = nextAt > now ? 'airdrop_too_soon' : heldCoins >= AIRDROP.enoughCoins ? 'airdrop_enough' : undefined;
    return {
      accountId, coins: AIRDROP.coins, to, heldCoins, enoughCoins: AIRDROP.enoughCoins, againBelowCoins: AIRDROP.againBelowCoins, lastAt, nextAt,
      ...(blocked ? { blocked } : {}),
    };
  }

  airdropStatus(accountId: string): Promise<AirdropStatus> {
    return this.tick(() => this.airdropStatusOf(accountId, this.airdropTarget(accountId)));
  }

  airdrop(accountId: string): Promise<AirdropResult> {
    return this.tick(() => {
      const to = this.airdropTarget(accountId);
      const st = this.airdropStatusOf(accountId, to);
      if (st.blocked === 'airdrop_too_soon') {
        const mins = Math.max(1, Math.ceil((st.nextAt - this.now()) / 60_000));
        throw apiError('airdrop_too_soon', `one airdrop per ${AIRDROP.everyMinutes} minutes: the next one in ${mins} min`, 429, { retryAt: st.nextAt });
      }
      if (st.blocked === 'airdrop_enough') throw apiError('airdrop_enough', `you hold ${st.heldCoins} already; the airdrop is for balances under ${AIRDROP.enoughCoins}`, 409, { heldCoins: st.heldCoins });
      (this.st.airdrops ??= {})[accountId] = this.now();
      const u = this.user(accountId);
      let wallet: WalletInfo | undefined;
      if (to === 'game') {
        // straight into the game balance; a locked Turing bonus comes with it, as with any deposit
        u.balance = c4(u.balance + AIRDROP.coins + u.lockedBonus);
        u.lockedBonus = 0;
      } else {
        // into the wallet itself, registered on the coin (the faucet pays the storage)
        const w = (this.st.walletCoins ??= {});
        w[accountId] = (w[accountId] ?? 0) + AIRDROP.coins;
        const reg = (this.st.registered ??= []);
        if (!reg.includes(accountId)) reg.push(accountId);
        wallet = this.walletInfoOf(accountId);
      }
      this.save();
      const me = this.meOf(accountId);
      this.emit({ t: 'me', me }, accountId);
      return { tx: fakeTx(this.r), coins: AIRDROP.coins, to, me, ...(wallet ? { wallet } : {}), status: this.airdropStatusOf(accountId, to) };
    });
  }

  /** Tests: whether the account is registered on the coin (NEP-145 storage). */
  setRegistered(account: string, on: boolean): void {
    const reg = (this.st.registered ??= []).filter((a) => a !== account);
    this.st.registered = on ? [...reg, account] : reg;
    this.save();
  }

  /** Tests and QA: when the account last had an airdrop (ms; null: never). */
  setAirdropAt(accountId: string, at: number | null): void {
    const a = (this.st.airdrops ??= {});
    if (at === null) delete a[accountId];
    else a[accountId] = at;
    this.save();
  }

  // ----- the mock chain the mock wallet talks to (MockLedger) -----

  ledgerAddKey(account: string, publicKey: string, permission: KeyPermission): void {
    const keys = (this.st.keys ??= {});
    (keys[account] ??= {})[publicKey] = { permission, nonce: 0 };
    this.save();
  }

  ledgerWalletTx(account: string, tx: WalletTx): string {
    const a = tx.actions[0];
    if (a?.type === 'AddKey' && tx.actions.length === 1) {
      // the browser's play key, added by the account itself (in the same approval as a deposit or withdrawal)
      if (tx.receiverId !== account) throw new Error('AddKey goes to your own account.');
      if (this.st.keys?.[account]?.[a.params.publicKey]) throw new Error('AddKeyAlreadyExists');
      const perm = a.params.accessKey.permission;
      this.ledgerAddKey(account, a.params.publicKey, { receiverId: perm.receiverId, methodNames: [...(perm.methodNames ?? [])], allowance: perm.allowance ?? null });
      return fakeTx(this.r);
    }
    if (!a || a.type !== 'FunctionCall' || tx.actions.length !== 1) throw new Error('The mock wallet sends one action per transaction.');
    const args = a.params.args as Record<string, unknown>;
    const hash = fakeTx(this.r);
    const coinsOf = (v: unknown) => Number(BigInt(String(v ?? '0')) * 10_000n / COIN_UNIT) / 10_000;
    if (tx.receiverId === this.config.tokenId && a.params.methodName === 'ft_transfer_call') {
      if (this.config.coinsOpen === false) throw new Error('The game has no coin yet.');
      if (args.receiver_id !== this.config.contractId) throw new Error('Deposits go to the game contract.');
      const n = coinsOf(args.amount);
      const w = (this.st.walletCoins ??= {});
      if ((w[account] ?? 0) + 1e-9 < n) throw new Error(`Your wallet has ${w[account] ?? 0} ${this.config.tokenSymbol}.`);
      w[account] = c4((w[account] ?? 0) - n);
      const u = this.user(account);
      u.balance = c4(u.balance + n);
      (this.st.deposits ??= {})[hash] = account;
      this.emitMe(account);
    } else if (tx.receiverId === this.config.contractId && a.params.methodName === 'withdraw') {
      const n = coinsOf(args.amount);
      const u = this.user(account);
      if (u.balance + 1e-9 < n) throw new Error('Not enough coins in the game.');
      if (!(this.st.registered ?? []).includes(account)) throw new Error('Your account is not registered on the coin yet; the coins stay in the game.');
      u.balance = c4(u.balance - n);
      const w = (this.st.walletCoins ??= {});
      w[account] = c4((w[account] ?? 0) + n);
      this.emitMe(account);
    } else if (tx.receiverId === this.config.tokenId && a.params.methodName === 'storage_deposit') {
      const reg = (this.st.registered ??= []);
      const who = String(args.account_id ?? account);
      if (!reg.includes(who)) reg.push(who);
    } else throw new Error(`The mock wallet does not send ${tx.receiverId}.${a.params.methodName}.`);
    this.save();
    return hash;
  }

  // ----- sign_tx: the browser signs this play or call with its play key -----

  private requestSign(c: ChatRec, purpose: 'play' | 'call', args: Record<string, unknown>, done: (ok: boolean, info: string) => void): void {
    const s = this.sessionOf(c.viewer);
    const key = s?.playKey;
    const k = key ? this.st.keys?.[c.viewer]?.[key.publicKey] : undefined;
    if (!key || !k) {
      done(false, 'No play key in this browser yet.');
      return;
    }
    const reqId = 'sr' + randHex(this.r, 12);
    const tx: SignRequestTx = {
      signerId: c.viewer, publicKey: key.publicKey, nonce: String(k.nonce + 1), receiverId: this.config.contractId, blockHash: MOCK_BLOCK_HASH,
      actions: [{ type: 'FunctionCall', methodName: purpose, args: JSON.stringify(args), gas: '30000000000000', deposit: '0' }],
    };
    const ms = this.o.signTimeoutMs ?? 20_000;
    const p: PendingSign = {
      reqId, chatId: c.chatId, viewer: c.viewer, purpose, tx,
      timer: this.later(ms, () => {
        this.signs.delete(reqId);
        done(false, 'Your browser did not sign in time.');
      }),
      done: (ok: boolean, info: string) => {
        clearTimeout(p.timer);
        this.timers.delete(p.timer);
        this.signs.delete(reqId);
        done(ok, info);
      },
    };
    this.signs.set(reqId, p);
    this.emit({ t: 'sign_tx', reqId, chatId: c.chatId, purpose, tx, expiresAt: this.now() + ms }, c.viewer);
  }

  /** The same checks as the relay (relay/src/auth/tx.ts): exactly the requested transaction, validly signed. */
  private onSigned(viewer: string, reqId: string, signedTx: string): void {
    const p = this.signs.get(reqId);
    if (!p || p.viewer !== viewer) return this.err('unknown_sign_request', 'No such signature request.', viewer);
    let why: string | null = null;
    let hash = '';
    try {
      const bytes = base64Decode(signedTx);
      const d = decodeSignedTransaction(bytes);
      const a = p.tx.actions[0];
      if (d.tx.signerId !== p.tx.signerId) why = 'wrong signer';
      else if (publicKeyString(d.tx.publicKey) !== p.tx.publicKey) why = 'wrong key';
      else if (d.tx.receiverId !== p.tx.receiverId) why = 'wrong receiver';
      else if (d.tx.methodName !== a.methodName) why = 'wrong method';
      else if (new TextDecoder().decode(d.tx.args) !== a.args) why = 'wrong arguments';
      else if (d.tx.deposit !== 0n || d.tx.gas !== BigInt(a.gas)) why = 'wrong gas or deposit';
      else if (d.tx.nonce !== BigInt(p.tx.nonce) || base58Encode(d.tx.blockHash) !== p.tx.blockHash) why = 'wrong nonce or block';
      else if (!verifySignedTransaction(bytes)) why = 'bad signature';
      hash = d.hash;
    } catch (e) {
      why = `not a signed transaction (${(e as Error).message})`;
    }
    if (why) {
      this.err('bad_signed_tx', why, viewer);
      p.done(false, `The signed ${p.purpose} was refused: ${why}.`);
      return;
    }
    const k = this.st.keys?.[viewer]?.[p.tx.publicKey];
    if (k) k.nonce = Number(p.tx.nonce);
    p.done(true, hash);
  }

  listTestUsers(): Promise<TestUser[]> {
    if (this.o.wallet) return this.tick(() => []);
    return this.tick(() =>
      TEST_USERS.map((t) => {
        const u = this.user(t.accountId);
        return { accountId: u.accountId, label: u.label, seed: u.seed, balanceCoins: c4(u.balance), rating: u.rating, chats: u.stats.chats, online: this.account === u.accountId && this.status === 'open' };
      }),
    );
  }

  faucet(accountId: string, coins = 100): Promise<{ tx: string; me: Me }> {
    return this.tick(() => {
      if (this.o.wallet) throw apiError('not_test_mode', 'The faucet is test mode only.', 403);
      const u = this.user(accountId);
      if (!(coins > 0) || coins > 10_000) throw new Error('The faucet gives between 1 and 10000 test coins.');
      u.balance = c4(u.balance + coins + u.lockedBonus);
      u.lockedBonus = 0;
      this.save();
      const me = this.meOf(accountId);
      this.emit({ t: 'me', me }, accountId);
      return { tx: fakeTx(this.r), me };
    });
  }

  withdraw(accountId: string, coins: number): Promise<{ tx: string; me: Me }> {
    return this.tick(() => {
      const u = this.user(accountId);
      if (!(coins > 0)) throw new Error('Choose how many coins to withdraw.');
      if (coins > u.balance + 1e-9) throw new Error('Not enough coins in the game.');
      u.balance = c4(u.balance - coins);
      this.save();
      const me = this.meOf(accountId);
      this.emit({ t: 'me', me }, accountId);
      return { tx: fakeTx(this.r), me };
    });
  }

  getMe(accountId: string): Promise<Me> {
    return this.tick(() => this.meOf(accountId));
  }

  listRounds(): Promise<RoundSummary[]> {
    return this.tick(() =>
      [...this.st.rounds]
        .sort((a, b) => b.roundId - a.roundId)
        .slice(0, 50)
        .map((r) => ({
          roundId: r.roundId, startedAt: r.startedAt, endsAt: r.endsAt,
          status: r.roundId === this.st.current ? this.roundState().status : r.status,
          characters: r.characters, chats: r.chats, paidPlays: r.paidPlays, settleTx: r.settleTx,
        })),
    );
  }

  getResults(roundId: number, accountId: string): Promise<RoundResults> {
    return this.tick(() => {
      this.user(accountId);
      const r = this.roundById(roundId);
      if (!r) throw new Error(`No round ${roundId}.`);
      const key = `${roundId}|${accountId}`;
      const have = this.st.results[key];
      if (have) return have;
      if (r.seeded && r.status === 'settled' && roundId === Math.max(...this.st.rounds.filter((x) => x.seeded).map((x) => x.roundId))) {
        const res = this.seededResults(r, accountId);
        this.st.results[key] = res;
        this.save();
        return res;
      }
      const u = this.user(accountId);
      return {
        roundId, status: roundId === this.st.current ? this.roundState().status : r.status, settledAt: r.settledAt, chats: [],
        calledRight: 0, calledTotal: 0, coinsDelta: 0, turingBonusCoins: 0, lockedBonusCoins: 0, wouldHaveCoins: 0,
        ratingBefore: u.rating, ratingAfter: u.rating, chain: { revealTx: r.revealTx, openTxs: [...r.openTxs], settleTx: r.settleTx },
      };
    });
  }

  async getVerify(chatId: string, accountId: string): Promise<VerifyBundle> {
    await new Promise((res) => setTimeout(res, this.d(120)));
    if (chatId === EVIDENCE_CHAT_ID) {
      const seededId = Math.max(...this.st.rounds.filter((x) => x.seeded).map((x) => x.roundId));
      return evidenceBundle(await this.loadEvidence(), seededId, accountId);
    }
    const b = this.st.bundles[chatId];
    if (b) {
      if (b.viewer !== accountId) throw new Error('This chat belongs to another player.');
      return b;
    }
    const c = this.st.chats.find((x) => x.chatId === chatId);
    if (c) {
      if (c.kind !== 'bot') throw new Error('Only bot chats carry enclave signatures.');
      throw new Error('Verification opens when the round settles.');
    }
    throw new Error('No verification bundle for this chat.');
  }

  leaderboard(): Promise<LeaderRow[]> {
    return this.tick(() =>
      [
        ...Object.values(this.st.users).map((u) => ({ label: u.label, accountId: u.accountId, rating: u.rating, chats: u.stats.chats, accuracy: u.stats.right + u.stats.wrong ? u.stats.right / (u.stats.right + u.stats.wrong) : 0 })),
        ...EXTRA_LEADERS,
      ].sort((a, b) => b.rating - a.rating),
    );
  }

  async devEndRound(): Promise<void> {
    if (this.o.wallet) throw apiError('not_test_mode', 'Test tools are off on this relay.', 403);
    await this.tick(() => this.endRound('dev'));
  }

  // ======================= WebSocket-like API =======================

  connect(accountId: string): void {
    if (this.account === accountId && this.status !== 'closed') return;
    this.disconnect();
    this.account = accountId;
    this.setStatus('connecting');
    this.later(this.d(120), () => {
      if (this.account !== accountId) return;
      // wallet accounts need this client's session (the real relay asks for a ticket); test users only in test mode
      const allowed = this.isWallet(accountId) ? !!this.sessionOf(accountId) : !this.o.wallet && !!this.st.users[accountId];
      if (!allowed) {
        this.setStatus('open');
        this.err('unknown_account', this.isWallet(accountId) ? 'Sign in again.' : `${accountId} is not a test user.`);
        this.later(20, () => this.disconnect());
        return;
      }
      this.setStatus('open');
      const u = this.user(accountId);
      u.payout[String(this.st.current)] ??= u.balance > 0 ? 'self' : 'promo';
      this.emit({ t: 'welcome', me: this.meOf(accountId), round: this.roundState(), config: { ...this.config }, activeChat: this.activeChatOf(accountId) });
      // a reload while a play or call waited for this browser's signature: ask again
      for (const p of this.signs.values()) if (p.viewer === accountId) this.emit({ t: 'sign_tx', reqId: p.reqId, chatId: p.chatId, purpose: p.purpose, tx: p.tx, expiresAt: this.now() + 5000 }, accountId);
      const q = this.inbox;
      this.inbox = [];
      for (const m of q) this.handle(accountId, m);
    });
  }

  disconnect(): void {
    this.account = null;
    this.inbox = [];
    this.outbox = [];
    this.setStatus('closed');
  }

  send(msg: ClientMsg): void {
    if (!this.account) return;
    if (this.status !== 'open') {
      if (msg.t !== 'ping') this.inbox.push(msg);
      return;
    }
    const viewer = this.account;
    // deliver like a network hop
    setTimeout(() => {
      if (!this.disposed && this.account === viewer) this.handle(viewer, msg);
    }, 0);
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: (status: Status) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // ======================= message handling =======================

  private handle(viewer: string, m: ClientMsg): void {
    switch (m.t) {
      case 'ping':
        this.emit({ t: 'pong' }, viewer);
        return;
      case 'enter_room': {
        const level = m.level;
        if (!LEVELS.includes(level)) return this.err('bad_level', 'No such level.', viewer);
        const seats = Array.from({ length: 10 }, (_, i) => this.seatOf(viewer, level, i));
        this.emit({ t: 'room', level, roundId: this.st.current, theme: themeFor(level, this.st.current), seats }, viewer);
        return;
      }
      case 'pick_seat':
        return this.pickSeat(viewer, m.level, m.seatIndex, m.mode, m.coins);
      case 'cancel_search': {
        const s = this.search;
        if (s && s.viewer === viewer) {
          if (s.timer) clearTimeout(s.timer);
          this.search = null;
          this.emitSeat(viewer, s.level, s.seatIndex);
        }
        return;
      }
      case 'say':
        return this.say(viewer, m.chatId, m.text);
      case 'typing':
        return; // nobody to relay to: bots ignore it, fake humans do not watch it
      case 'call':
        return this.call(viewer, m.chatId, m.human);
      case 'dev_end_chat': {
        if (this.o.wallet) return this.err('not_test_mode', 'Test tools are off.', viewer);
        const c = this.st.chats.find((x) => x.chatId === m.chatId && x.viewer === viewer);
        if (!c) return this.err('no_chat', 'No such chat.', viewer);
        this.endChat(c.chatId, 'dev');
        return;
      }
      case 'signed_tx':
        return this.onSigned(viewer, m.reqId, m.signedTx);
      case 'sign_declined': {
        const p = this.signs.get(m.reqId);
        if (p && p.viewer === viewer) p.done(false, `Your browser did not sign it: ${m.reason}`);
        return;
      }
    }
  }

  private pickSeat(viewer: string, level: Level, seatIndex: number, mode: Mode, coins?: number): void {
    const cur = this.cur();
    const t = this.now();
    if (!LEVELS.includes(level) || !(seatIndex >= 0 && seatIndex < 10)) return this.err('bad_seat', 'No such seat.', viewer);
    if (cur.status !== 'open' || t >= cur.acceptingUntil) {
      const left = Math.max(0, Math.ceil((cur.endsAt - t) / 1000));
      return this.err('round_closing', `This round is closing. Next round in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`, viewer);
    }
    if (this.search && this.search.viewer === viewer) return this.err('busy', 'You are already looking for a chat.', viewer);
    if (this.activeChatOf(viewer)) return this.err('busy', 'Finish your current chat first.', viewer);
    const seat = this.seatOf(viewer, level, seatIndex);
    if (seat.state !== 'open') return this.err('seat_taken', 'You already met this character this round.', viewer);
    let n = 0;
    if (mode === 'paid') {
      if (this.config.coinsOpen === false) return this.err('coins_closed', 'Coins open when $REAL launches. Play free for now.', viewer);
      if (this.isWallet(viewer)) {
        const key = this.sessionOf(viewer)?.playKey;
        if (!key) return this.err('play_key_missing', 'One approval in your wallet first, then your plays and calls run without popups.', viewer);
        if (key.status !== 'active') return this.err('play_key_exhausted', "This browser's play key used up its gas allowance: one approval in your wallet adds a fresh one.", viewer);
      }
      n = Math.floor(Number(coins));
      if (!Number.isFinite(n) || n < this.config.minCoins || n > this.config.maxCoins)
        return this.err('bad_coins', `Choose between ${this.config.minCoins} and ${this.config.maxCoins} coins.`, viewer);
      if (this.user(viewer).balance + 1e-9 < n) return this.err('insufficient_coins', 'Not enough coins. Deposit to play coins, or play free.', viewer);
    }
    // the bots are napping: no new chats at all, so the pick is refused at once and the seat goes back
    if (this.botsNapping()) {
      this.err('bots_unavailable', BOTS_UNAVAILABLE, viewer);
      this.emitSeat(viewer, level, seatIndex);
      return;
    }
    const s: SearchRec = { viewer, roundId: cur.roundId, level, seatIndex, mode, coins: n };
    this.search = s;
    this.emit({ t: 'searching', level, seatIndex }, viewer);
    this.emitSeat(viewer, level, seatIndex);
    const [lo, hi] = this.o.searchMs ?? [this.d(2500), this.d(6000)];
    s.timer = this.later(this.r.range(lo, hi), () => {
      if (this.search !== s) return;
      this.search = null;
      this.match(s);
    });
  }

  /** The bots are out of NEAR AI credits: the relay starts no new chats, human to human included. */
  private botsNapping(): boolean {
    return !!this.o.noBots || flag('realsies:mock:nobots');
  }

  private match(s: SearchRec): void {
    const { viewer, level, seatIndex } = s;
    const roundId = this.st.current;
    if (roundId !== s.roundId) return;
    // the bots ran out of credits during the search: nobody is matched, the seat goes back
    if (this.botsNapping()) {
      this.err('bots_unavailable', BOTS_UNAVAILABLE, viewer);
      this.emitSeat(viewer, level, seatIndex);
      return;
    }
    const mine = this.st.chats.filter((c) => c.viewer === viewer && c.roundId === roundId);
    const humanFlag = this.o.forceHuman || flag('realsies:mock:human');
    const humanChance = humanFlag ? 1 : this.o.noHuman ? 0 : s.mode === 'free' ? 0.4 : 0.25;
    const humans = TEST_USERS.map((u) => u.accountId).filter((a) => a !== viewer && !mine.some((c) => c.humanAccount === a));
    const bots = PERSONAS.filter((p) => !mine.some((c) => c.level === level && c.personaId === p.id));
    let kind: Truth;
    if (humans.length && this.r.chance(humanChance)) kind = 'human';
    else if (bots.length) kind = 'bot';
    else if (humans.length) kind = 'human';
    else {
      this.st.unavailable.push(`${roundId}|${viewer}|${level}|${seatIndex}`);
      this.err('room_empty', 'Nobody new is around in this room right now.', viewer);
      this.emitSeat(viewer, level, seatIndex);
      this.save();
      return;
    }
    const partner = this.skin(roundId, viewer, level, seatIndex);
    const round = this.cur();
    let characterId: string, personaId: string | undefined, humanAccount: string | undefined;
    if (kind === 'bot') {
      // free players meet the cheapest model when they meet a bot
      const pool = s.mode === 'free' ? bots.filter((p) => p.model === EVIDENCE_MODEL) : bots;
      const p = this.r.pick(pool.length ? pool : bots);
      personaId = p.id;
      characterId = sha256Hex(`mockchar|${roundId}|${level}|${p.id}`).slice(0, 32);
    } else {
      humanAccount = this.r.pick(humans);
      characterId = sha256Hex(`mockhuman|${roundId}|${humanAccount}`).slice(0, 32);
    }
    const handle = sha256Hex(`realsies:v1|handle|${roundId}|${characterId}|${viewer}|${round.secret}`);
    const c: ChatRec = {
      chatId: 'c' + randHex(this.r, 15), roundId, level, seatIndex, theme: themeFor(level, roundId), partner, viewer,
      mode: s.mode, coins: s.mode === 'paid' ? s.coins : 0, played: 0, locked: 0, kind, personaId, humanAccount,
      characterId, salt: sha256Hex(`mocksalt|${characterId}`), handle, phase: s.mode === 'paid' ? 'placing' : 'chatting',
      messages: [], completions: [], transcript: [], history: [], pendingUser: [],
    };
    this.st.chats.push(c);
    round.chats++;
    this.emit({ t: 'matched', chat: this.chatInfo(c) }, viewer);
    this.emitSeat(viewer, level, seatIndex);
    if (s.mode === 'paid') {
      this.emit({ t: 'placing', chatId: c.chatId }, viewer);
      // a wallet account's browser signs the play with its play key first (sign_tx); a test user's play the relay signs
      const sign = (go: (fail: string | null, tx?: string) => void) => {
        if (!this.isWallet(viewer)) return go(null);
        this.requestSign(c, 'play', { round_id: roundId, handle, coins: c.coins }, (ok, info) => go(ok ? null : info, ok ? info : undefined));
      };
      this.chatLater(c.chatId, this.r.range(this.d(800), this.d(1500)), () => sign((signFail, signedTx) => {
        const fail = this.o.forcePlayFailed || flag('realsies:mock:playfail') || !!signFail || (!signedTx && this.r.chance(this.o.playFailChance ?? 1 / 30));
        const u = this.user(viewer);
        if (fail || u.balance + 1e-9 < c.coins) {
          c.playFailed = signFail ? `${signFail} This chat continues free.` : fail ? 'The play transaction failed on chain. This chat continues free.' : 'Not enough coins. This chat continues free.';
          c.mode = 'free';
          c.coins = 0;
          this.emit({ t: 'play_failed', chatId: c.chatId, reason: c.playFailed }, viewer);
        } else {
          c.played = c.coins;
          c.locked = c4(c.coins * (1 - this.config.feeBps / 10_000));
          c.playTx = signedTx ?? fakeTx(this.r);
          u.balance = c4(u.balance - c.coins);
          u.locked = c4(u.locked + c.locked);
          round.paidPlays++;
          this.emit({ t: 'placed', chatId: c.chatId, tx: c.playTx }, viewer);
          this.emitMe(viewer);
        }
        this.chatLater(c.chatId, this.d(300), () => this.startChat(c));
      }));
    } else {
      c.phase = 'placing';
      this.chatLater(c.chatId, this.d(400), () => this.startChat(c));
    }
    this.save();
  }

  /**
   * Like the relay since protocol v1.1: startedAt lies countdownSeconds ahead (the full-screen 3, 2, 1),
   * `say` is refused until then, and bots and fake humans start their clocks at startedAt.
   */
  private startChat(c: ChatRec): void {
    const t = this.now();
    const cd = Math.max(0, (this.config.countdownSeconds ?? 0) * 1000);
    c.phase = 'chatting';
    c.startedAt = t + cd;
    c.endsAt = c.startedAt + this.config.chatSeconds * 1000;
    this.emit({ t: 'chat_started', chatId: c.chatId, startedAt: c.startedAt, endsAt: c.endsAt }, c.viewer);
    this.chatLater(c.chatId, c.endsAt - t, () => this.endChat(c.chatId, 'time'));
    const b = this.brainFor(c);
    if (c.kind === 'bot') {
      this.chatLater(c.chatId, cd + this.r.range(this.d(4000), this.d(12000)), () => {
        if (c.phase === 'chatting' && !b.busy && !c.messages.some((m) => m.from === 'me')) this.botRespond(c, true);
      });
    } else {
      if (this.r.chance(0.55))
        this.chatLater(c.chatId, cd + this.r.range(this.d(3000), this.d(9000)), () => {
          if (c.phase === 'chatting' && !b.busy && !c.messages.length) this.humanSay(c, [this.r.pick(HUMAN_OPENERS)]);
        });
      this.chatLater(c.chatId, cd + this.r.range(this.d(20000), this.d(30000)), () => {
        if (c.phase === 'chatting' && !b.busy && !c.messages.some((m) => m.from === 'me')) this.humanSay(c, [this.r.pick(HUMAN_NUDGE)]);
      });
    }
    this.save();
  }

  private brainFor(c: ChatRec): Brain {
    let b = this.brains.get(c.chatId);
    if (!b) {
      b = { r: makeRand(this.o.random), busy: false, pending: false, used: new Set(), turn: c.completions.length, typing: false };
      this.brains.set(c.chatId, b);
    }
    return b;
  }

  private say(viewer: string, chatId: string, raw: string): void {
    const c = this.st.chats.find((x) => x.chatId === chatId && x.viewer === viewer);
    if (!c || c.phase !== 'chatting') return this.err('not_chatting', 'This chat is not running.', viewer);
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (text.length > 280) return this.err('too_long', 'Messages are at most 280 characters.', viewer);
    const t = this.now();
    if (t < (c.startedAt ?? 0)) return this.err('chat_not_started', 'The chat starts in a moment.', viewer);
    const last = this.lastSay.get(viewer) ?? 0;
    if (t - last < this.d(600)) return this.err('rate_limited', 'Slow down a little.', viewer);
    this.lastSay.set(viewer, t);
    const msg: ChatMessage = { id: 'm' + randHex(this.r, 12), from: 'me', text, at: t };
    c.messages.push(msg);
    c.transcript.push({ from: 'player', text, at: t });
    c.pendingUser.push({ role: 'user', content: text });
    this.emit({ t: 'message', chatId, msg }, viewer);
    this.onPlayerMessage(c);
    this.save();
  }

  private onPlayerMessage(c: ChatRec): void {
    const b = this.brainFor(c);
    b.pending = true;
    if (b.busy) return;
    if (b.wait) {
      clearTimeout(b.wait);
      this.timers.delete(b.wait);
    }
    if (c.kind === 'bot') b.wait = this.chatLater(c.chatId, this.r.range(this.d(800), this.d(2500)), () => this.botRespond(c, false));
    else
      b.wait = this.chatLater(c.chatId, this.r.range(this.d(1500), this.d(4500)), () => {
        b.pending = false;
        const text = c.pendingUser.map((x) => x.content).join('\n');
        c.pendingUser = [];
        // real people sometimes just do not answer
        if (!/\?\s*$/.test(text) && b.r.chance(0.12)) return;
        this.humanSay(c, humanReply(b.r, text, b.used));
      });
  }

  /** One bot reply = one signed completion, shown as one or more bubbles. */
  private botRespond(c: ChatRec, opener: boolean): void {
    if (c.phase !== 'chatting') return;
    const p = personaById(c.personaId!)!;
    const b = this.brainFor(c);
    b.busy = true;
    b.pending = false;
    b.wait = undefined;
    const playerText = c.pendingUser.map((x) => x.content).join('\n');
    c.history.push(...c.pendingUser);
    c.pendingUser = [];
    const skin = skinMessage(c.partner.name, c.handle.slice(0, 16));
    const request = buildRequest(p.model, p.basePrompt, skin, c.history);
    const content = opener ? personaOpener(p, b.r) : personaReply(p, b.r, playerText, b.used, b.turn++);
    const latency = this.r.range(this.d(400), this.d(1200));
    this.chatLater(c.chatId, latency, () => {
      if (c.phase !== 'chatting') return;
      const comp = makeCompletion(c.completions.length, randHex(this.r, 32), p.model, request, content, this.now());
      c.completions.push(comp);
      const bubbles = bubblesOf(content);
      const step = (i: number) => {
        if (c.phase !== 'chatting') return;
        if (i >= bubbles.length) {
          c.history.push({ role: 'assistant', content });
          b.busy = false;
          this.save();
          if (b.pending || c.pendingUser.length) this.onPlayerMessage(c);
          return;
        }
        const text = bubbles[i];
        const typeMs = this.typingMs(text, p.msPerChar);
        b.typing = true;
        this.emit({ t: 'typing', chatId: c.chatId, on: true }, c.viewer);
        this.chatLater(c.chatId, typeMs, () => {
          if (c.phase !== 'chatting') return;
          const t = this.now();
          const msg: ChatMessage = { id: 'm' + randHex(this.r, 12), from: 'them', text, at: t };
          c.messages.push(msg);
          comp.displayed.push(text);
          c.transcript.push({ from: 'bot', text, at: t, completionIndex: comp.index });
          b.typing = false;
          this.emit({ t: 'typing', chatId: c.chatId, on: false }, c.viewer);
          this.emit({ t: 'message', chatId: c.chatId, msg }, c.viewer);
          this.chatLater(c.chatId, i + 1 < bubbles.length ? this.r.range(this.d(300), this.d(900)) : 0, () => step(i + 1));
        });
      };
      step(0);
    });
  }

  private humanSay(c: ChatRec, lines: string[]): void {
    const b = this.brainFor(c);
    b.busy = true;
    const step = (i: number) => {
      if (c.phase !== 'chatting') return;
      if (i >= lines.length) {
        b.busy = false;
        if (b.pending || c.pendingUser.length) this.onPlayerMessage(c);
        return;
      }
      const text = lines[i];
      const typeMs = this.typingMs(text, 200);
      this.emit({ t: 'typing', chatId: c.chatId, on: true }, c.viewer);
      this.chatLater(c.chatId, typeMs, () => {
        if (c.phase !== 'chatting') return;
        const t = this.now();
        const msg: ChatMessage = { id: 'm' + randHex(this.r, 12), from: 'them', text, at: t };
        c.messages.push(msg);
        c.transcript.push({ from: 'bot', text, at: t });
        this.emit({ t: 'typing', chatId: c.chatId, on: false }, c.viewer);
        this.emit({ t: 'message', chatId: c.chatId, msg }, c.viewer);
        this.chatLater(c.chatId, this.r.range(this.d(400), this.d(1500)), () => step(i + 1));
      });
    };
    step(0);
  }

  /**
   * Human typing speed for bots and fake humans alike (the relay's bots type like people too):
   * about 200 ms per character with jitter, a per-message pace, and a short pause before typing.
   */
  private typingMs(text: string, msPerChar = 200): number {
    const pace = this.r.range(0.82, 1.22);
    let ms = this.r.range(300, 900);
    for (let i = 0; i < text.length; i++) ms += msPerChar * pace * this.r.range(0.55, 1.45);
    return Math.min(this.d(30000), Math.max(this.d(900), this.d(ms)));
  }

  /**
   * QA screenshots only: append a scripted conversation to the viewer's running chat at once, as
   * if it had been typed (no bot completions are made for these lines).
   */
  qaScript(lines: { from: 'me' | 'them'; text: string }[]): void {
    const viewer = this.account;
    const c = viewer ? this.st.chats.find((x) => x.viewer === viewer && x.phase === 'chatting') : undefined;
    if (!c || !viewer) return;
    let t = this.now() - lines.length * 4000;
    for (const l of lines) {
      t += 4000;
      const msg: ChatMessage = { id: 'm' + randHex(this.r, 12), from: l.from, text: l.text, at: t };
      c.messages.push(msg);
      c.transcript.push({ from: l.from === 'me' ? 'player' : 'bot', text: l.text, at: t });
      this.emit({ t: 'message', chatId: c.chatId, msg }, viewer);
    }
  }

  private endChat(chatId: string, reason: 'time' | 'partner_left' | 'dev' | 'round_end', windowMs?: number): void {
    const c = this.st.chats.find((x) => x.chatId === chatId);
    if (!c || !(c.phase === 'chatting' || c.phase === 'placing' || c.phase === 'searching')) return;
    this.clearChatTimers(chatId);
    const b = this.brains.get(chatId);
    if (b?.typing) this.emit({ t: 'typing', chatId, on: false }, c.viewer);
    this.brains.delete(chatId);
    // a completion never shown to the player is not part of this chat
    c.completions = c.completions.filter((x) => x.displayed.length > 0);
    const t = this.now();
    c.startedAt ??= t;
    c.endsAt = Math.min(c.endsAt ?? t, t);
    c.phase = 'calling';
    c.endedReason = reason;
    c.callDeadline = t + (windowMs ?? this.config.callSeconds * 1000);
    if (c.kind === 'human') {
      // the partner calls on you too
      c.partnerPaid = this.r.chance(0.55);
      c.partnerCoins = c.partnerPaid ? this.r.pick(this.config.presets[c.level]) : 0;
      c.partnerCall = this.r.chance(0.06) ? null : this.r.chance(0.62);
    }
    this.emit({ t: 'chat_ended', chatId, callDeadline: c.callDeadline, reason }, c.viewer);
    this.chatLater(chatId, c.callDeadline - t, () => this.missCall(chatId));
    this.save();
  }

  private missCall(chatId: string): void {
    const c = this.st.chats.find((x) => x.chatId === chatId);
    if (!c || c.phase !== 'calling') return;
    this.clearChatTimers(chatId);
    c.phase = 'missed';
    c.myCall = null;
    this.emit({ t: 'call_missed', chatId }, c.viewer);
    if (c.roundId === this.st.current) this.emitSeat(c.viewer, c.level, c.seatIndex);
    this.save();
  }

  private call(viewer: string, chatId: string, human: boolean): void {
    const c = this.st.chats.find((x) => x.chatId === chatId && x.viewer === viewer);
    if (!c) return this.err('no_chat', 'No such chat.', viewer);
    if (c.phase === 'called') return this.err('already_called', 'You already made your call.', viewer);
    if (c.phase !== 'calling' || this.now() > (c.callDeadline ?? 0) + 1000) return this.err('call_closed', 'The call window is closed.', viewer);
    this.clearChatTimers(chatId);
    c.myCall = !!human;
    c.phase = 'called';
    if (c.roundId === this.st.current) this.emitSeat(viewer, c.level, c.seatIndex);
    if (c.played > 0 && this.isWallet(viewer)) {
      // the browser signs the call with its play key; the call is on chain once that lands
      this.requestSign(c, 'call', { round_id: c.roundId, handle: c.handle, human: c.myCall }, (ok, info) => {
        if (ok) c.callTx = info;
        this.emit({ t: 'call_recorded', chatId, human: !!c.myCall, tx: c.callTx }, viewer);
        if (!ok) this.err('call_failed', `The call did not reach the chain: ${info}`, viewer);
        this.save();
      });
      this.save();
      return;
    }
    if (c.played > 0) c.callTx = fakeTx(this.r);
    this.emit({ t: 'call_recorded', chatId, human: c.myCall, tx: c.callTx }, viewer);
    this.save();
  }

  // ======================= rounds and settlement =======================

  private endRound(_reason: 'time' | 'dev'): void {
    const old = this.cur();
    if (old.status === 'settling' || old.status === 'settled') return;
    old.status = 'settling';
    if (_reason === 'dev') old.endsAt = Math.min(old.endsAt, this.now());
    if (this.search && this.search.roundId === old.roundId) {
      const s = this.search;
      if (s.timer) clearTimeout(s.timer);
      this.search = null;
      this.err('round_ended', 'The round ended before a match. Try again in the new round.', s.viewer);
    }
    let lastDeadline = this.now();
    for (const c of this.st.chats) {
      if (c.roundId !== old.roundId) continue;
      if (c.phase === 'chatting' || c.phase === 'placing' || c.phase === 'searching') this.endChat(c.chatId, 'round_end', 10_000);
      if (c.phase === 'calling') lastDeadline = Math.max(lastDeadline, c.callDeadline ?? 0);
    }
    // next round starts now; the old one settles once its call windows close
    const next = this.makeRound(old.roundId + 1, this.now());
    this.st.rounds.push(next);
    this.st.current = next.roundId;
    for (const u of Object.values(this.st.users)) delete u.payout[String(next.roundId)];
    if (this.account) this.user(this.account).payout[String(next.roundId)] ??= this.user(this.account).balance > 0 ? 'self' : 'promo';
    this.armRound();
    this.emitRound();
    this.save(true);
    this.later(Math.max(0, lastDeadline - this.now()) + this.d(1500), () => this.settleRound(old.roundId));
  }

  private settleRound(roundId: number): void {
    const round = this.roundById(roundId);
    if (!round || round.status === 'settled') return;
    for (const c of this.st.chats) if (c.roundId === roundId && c.phase === 'calling') this.missCall(c.chatId);
    round.revealTx = fakeTx(this.r);
    round.openTxs = [fakeTx(this.r)];
    round.settleTx = fakeTx(this.r);
    round.status = 'settled';
    round.settledAt = this.now();
    const chats = this.st.chats.filter((c) => c.roundId === roundId);
    const viewers = [...new Set(chats.map((c) => c.viewer))];
    for (const v of viewers) this.st.results[`${roundId}|${v}`] = this.settleViewer(round, v, chats.filter((c) => c.viewer === v));
    this.st.chats = this.st.chats.filter((c) => c.roundId !== roundId);
    this.save(true);
    for (const v of viewers) {
      this.emit({ t: 'results_ready', roundId }, v);
      this.emitMe(v);
    }
  }

  private settleViewer(round: RoundRec, viewer: string, chats: ChatRec[]): RoundResults {
    const u = this.user(viewer);
    const ratingBefore = u.rating;
    const results: ChatResult[] = [];
    let coinsDelta = 0, would = 0, right = 0, total = 0;
    let wMe = 0, rMe = 0;
    chats.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
    for (const c of chats) {
      const presets = this.config.presets[c.level];
      const truth = c.kind;
      const n = truth === 'bot' ? 3 + this.r.int(7) : 2 + this.r.int(5);
      const h = truth === 'bot' ? this.r.range(0.15, 0.85) : this.r.range(0.35, 0.9);
      const plays: PlayIn[] = [];
      for (let i = 0; i < n; i++) {
        const coins = this.r.pick(presets);
        plays.push({ id: 'crowd' + i, coins, locked: c4(coins * 0.95), call: this.r.chance(0.05) ? null : this.r.chance(h) });
      }
      const paid = c.played > 0;
      const myCall = c.myCall ?? null;
      if (paid) plays.push({ id: 'me', coins: c.played, locked: c.locked, call: myCall });
      const s = settleCharacter(plays, truth);
      const isR = isRight(myCall, truth);
      const credited = paid ? s.credited.get('me') ?? 0 : 0;
      const delta = paid ? c4(credited - c.played) : 0;
      const rd = ratingDelta(isR, s.p, paid);
      const wh = paid ? undefined : c4(wouldHave(isR, s.W, s.R, presets[0]));
      if (paid) {
        u.balance = c4(u.balance + credited);
        u.locked = c4(Math.max(0, u.locked - c.locked));
        coinsDelta += delta;
      } else would += wh ?? 0;
      u.rating = applyRating(u.rating, rd);
      total++;
      if (isR) right++;
      u.stats.chats++;
      if (isR === true) {
        u.stats.right++;
        u.stats.streak++;
        u.stats.bestStreak = Math.max(u.stats.bestStreak, u.stats.streak);
      } else if (isR === false || paid) {
        u.stats.wrong++;
        u.stats.streak = 0;
      }
      if (c.kind === 'human' && c.partnerPaid && c.partnerCoins) {
        const locked = c4(c.partnerCoins * 0.95);
        if (c.partnerCall === true) rMe += locked;
        else wMe += locked;
      }
      const persona = truth === 'bot' ? personaById(c.personaId!) : undefined;
      results.push({
        chatId: c.chatId, level: c.level, seatIndex: c.seatIndex, partner: c.partner, truth,
        model: persona?.model,
        partnerAccount: truth === 'human' ? c.humanAccount : undefined,
        mode: paid ? 'paid' : 'free', coins: c.played, myCall, right: isR, coinsDelta: delta, wouldHaveCoins: wh, ratingDelta: rd,
        roomSplit: { paidCalls: plays.filter((p) => p.call !== null).length, paidHumanShare: s.humanShare === null ? null : Math.round(s.humanShare * 1000) / 1000 },
        verifiable: truth === 'bot' && c.completions.length > 0,
        ...(persona ? { persona: personaCard(persona) } : {}),
      });
      if (truth === 'bot' && c.completions.length) this.st.bundles[c.chatId] = this.bundleOf(round, c);
    }
    // the viewer as a character: partners who called them wrong pay a Turing bonus
    let turing = 0, lockedBonus = 0;
    if (wMe > 0) {
      const payout = c4(rMe > 0 ? 0.2 * wMe : 0.9 * wMe);
      if ((u.payout[String(round.roundId)] ?? (u.balance > 0 ? 'self' : 'promo')) === 'self') {
        turing = payout;
        u.balance = c4(u.balance + payout);
      } else {
        lockedBonus = payout;
        u.lockedBonus = c4(u.lockedBonus + payout);
      }
    }
    return {
      roundId: round.roundId, status: 'settled', settledAt: round.settledAt, chats: results, calledRight: right, calledTotal: total,
      coinsDelta: c4(coinsDelta), turingBonusCoins: turing, lockedBonusCoins: lockedBonus, wouldHaveCoins: c4(would),
      ratingBefore, ratingAfter: u.rating, chain: { revealTx: round.revealTx, openTxs: [...round.openTxs], settleTx: round.settleTx },
    };
  }

  private bundleOf(round: RoundRec, c: ChatRec): VerifyBundle {
    const p = personaById(c.personaId!)!;
    const opening = { salt: c.salt, promptHash: sha256Hex(p.basePrompt), signers: [MOCK_SIGNER], payout: PAYOUT_BOTS, openTx: round.openTxs[0] };
    const preimage = commitmentPreimage({ roundId: round.roundId, characterId: c.characterId, model: p.model, opening });
    return {
      roundId: round.roundId,
      chatId: c.chatId,
      characterId: c.characterId,
      model: p.model,
      commitment: { preimage, hash: sha256Hex(preimage), commitTx: round.commitTxs[0] },
      opening,
      personaPrompt: p.basePrompt,
      skinMessage: skinMessage(c.partner.name, c.handle.slice(0, 16)),
      attestation: {
        nonce: round.secretHash,
        fetchedAt: round.startedAt + 1200,
        model: p.model,
        signers: [{ address: MOCK_SIGNER, reportDataOk: true, nonceOk: true }],
        gatewaySigner: MOCK_GATEWAY,
        note: 'Mock mode: a simulated enclave key signs every reply exactly like NEAR AI Cloud does, so every check below runs for real on these bytes. The attestation itself is simulated; the reference round shows a real one.',
      },
      completions: c.completions,
      transcript: c.transcript,
      roundSecret: round.secret,
      persona: personaCard(p),
      viewer: c.viewer,
      handle: c.handle,
      chain: { revealTx: round.revealTx, openTx: round.openTxs[0], settleTx: round.settleTx, playTx: c.playTx, callTx: c.callTx },
    };
  }

  /**
   * A settled bot chat for the seeded round with a short scripted conversation, every reply signed by
   * the mock enclave like a live one, so its Verify bundle passes and its persona card shows.
   */
  private seededBotChat(r: RoundRec, viewer: string, seat: number, personaId: string, script: [string, string][]): ChatRec {
    const p = personaById(personaId)!;
    const characterId = sha256Hex(`mockchar|${r.roundId}|1|${p.id}`).slice(0, 32);
    const c: ChatRec = {
      chatId: `seed-bot-${r.roundId}-${sha256Hex(viewer).slice(0, 10)}`, roundId: r.roundId, level: 1, seatIndex: seat, theme: themeFor(1, r.roundId),
      partner: this.skinFor(r.roundId, viewer, 1, seat), viewer, mode: 'paid', coins: 10, played: 10, locked: 9.5, kind: 'bot', personaId: p.id,
      characterId, salt: sha256Hex(`mocksalt|${characterId}`), handle: sha256Hex(`realsies:v1|handle|${r.roundId}|${characterId}|${viewer}|${r.secret}`),
      phase: 'called', messages: [], completions: [], transcript: [], history: [], pendingUser: [], myCall: false,
      playTx: fakeTx(this.r), callTx: fakeTx(this.r), startedAt: r.startedAt + 95_000,
    };
    const skin = skinMessage(c.partner.name, c.handle.slice(0, 16));
    let at = c.startedAt!;
    script.forEach(([mine, reply], i) => {
      at += 6000;
      c.transcript.push({ from: 'player', text: mine, at });
      c.history.push({ role: 'user', content: mine });
      at += 2500;
      const comp = makeCompletion(i, randHex(this.r, 32), p.model, buildRequest(p.model, p.basePrompt, skin, c.history), reply, at);
      comp.displayed = bubblesOf(reply);
      c.completions.push(comp);
      for (const text of comp.displayed) c.transcript.push({ from: 'bot', text, at: (at += 1800), completionIndex: i });
      c.history.push({ role: 'assistant', content: reply });
    });
    c.endsAt = at + 4000;
    return c;
  }

  /** Canned results for the newest seeded round: the real evidence chat plus a paid human chat. */
  private seededResults(r: RoundRec, viewer: string): RoundResults {
    const u = this.user(viewer);
    const skin = (seat: number) => this.skinFor(r.roundId, viewer, 1, seat);
    const other = TEST_USERS.find((x) => x.accountId !== viewer)!.accountId;
    const evW = 23.75, evR = 9.5;
    const evWould = c4(wouldHave(true, evW, evR, this.config.presets[1][0]));
    const evP = evR / (evR + evW);
    const huW = 14.25, huR = 19;
    const huCredited = 9.5 + (0.7 * huW * 9.5) / huR;
    const huP = huR / (huR + huW);
    // a persona bot met for 10 coins: three of the room said human (28.5 locked), one more said bot
    const pbW = 28.5, pbR = 19;
    const pbCredited = 9.5 + (0.7 * pbW * 9.5) / pbR;
    const pbP = pbR / (pbR + pbW);
    const pb = this.seededBotChat(r, viewer, 4, 'lucia', [
      ['hey! where are you from?', 'holaa\nbuenos aires! you?'],
      ['berlin. what do you do there?', 'art student, sculpture\nmy teacher hates my clay dog jajaja'],
      ['ok be honest, are you a bot?', 'me?? a bot?? my sculpture teacher would agree honestly'],
    ]);
    this.st.bundles[pb.chatId] = this.bundleOf(r, pb);
    const chats: ChatResult[] = [
      {
        chatId: EVIDENCE_CHAT_ID, level: 1, seatIndex: 2, partner: skin(2), truth: 'bot', model: EVIDENCE_MODEL, mode: 'free', coins: 0,
        myCall: false, right: true, coinsDelta: 0, wouldHaveCoins: evWould, ratingDelta: ratingDelta(true, evP, false),
        roomSplit: { paidCalls: 5, paidHumanShare: Math.round((evW / (evW + evR)) * 1000) / 1000 }, verifiable: true,
      },
      {
        chatId: pb.chatId, level: 1, seatIndex: pb.seatIndex, partner: pb.partner, truth: 'bot', model: personaById(pb.personaId!)!.model, mode: 'paid', coins: 10,
        myCall: false, right: true, coinsDelta: c4(pbCredited - 10), ratingDelta: ratingDelta(true, pbP, true),
        roomSplit: { paidCalls: 5, paidHumanShare: Math.round((pbW / (pbW + pbR)) * 1000) / 1000 }, verifiable: true,
        persona: personaCard(personaById(pb.personaId!)!),
      },
      {
        chatId: 'seed-human-' + r.roundId, level: 1, seatIndex: 6, partner: skin(6), truth: 'human', partnerAccount: other, mode: 'paid', coins: 10,
        myCall: true, right: true, coinsDelta: c4(huCredited - 10), ratingDelta: ratingDelta(true, huP, true),
        roomSplit: { paidCalls: 5, paidHumanShare: Math.round(huP * 1000) / 1000 }, verifiable: false,
      },
    ];
    const gained = chats.reduce((s, c) => s + c.ratingDelta, 0);
    return {
      roundId: r.roundId, status: 'settled', settledAt: r.settledAt, chats, calledRight: 3, calledTotal: 3, coinsDelta: c4(chats[1].coinsDelta + chats[2].coinsDelta),
      turingBonusCoins: 0, lockedBonusCoins: 0, wouldHaveCoins: evWould, ratingBefore: u.rating - gained, ratingAfter: u.rating,
      chain: { revealTx: r.revealTx, openTxs: [...r.openTxs], settleTx: r.settleTx },
    };
  }

  private skinFor(roundId: number, viewer: string, level: Level, seat: number): Skin {
    return this.skin(roundId, viewer, level, seat);
  }

  // ======================= debugging =======================

  /** Snapshot for tests and the console. */
  debug(): { round: RoundState; chats: number; search: boolean; users: Record<string, Me> } {
    return {
      round: this.roundState(),
      chats: this.st.chats.length,
      search: !!this.search,
      users: Object.fromEntries(Object.keys(this.st.users).map((a) => [a, this.meOf(a)])),
    };
  }
}

/** Wipe everything mock mode keeps in localStorage (state, transcripts, results badges). Reload afterwards. */
export function resetMockState(): void {
  const s = storage();
  if (!s) return;
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && (k.startsWith('realsies:mock:') || k.startsWith('realsies:transcript:') || k.startsWith('realsies:resultsReady:'))) keys.push(k);
  }
  for (const k of keys) s.removeItem(k);
}
