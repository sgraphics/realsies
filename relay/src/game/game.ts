// The relay's game engine: rounds, characters and commitments, matchmaking, chats, calls,
// settlement on chain, results, ratings and verification bundles (docs/spec.md section 4).
import {
  AIRDROP, LEVELS, themeFor,
  type ActiveChat, type AirdropResult, type AirdropStatus, type ChatInfo, type ChatMessage, type ClientMsg, type LeaderRow, type Level, type Me, type Mode,
  type PublicConfig, type RoundResults, type RoundState, type RoundSummary, type Seat, type ServerMsg, type Skin,
  type SwapQuote, type TestUser, type VerifyBundle, type WalletInfo,
} from '../../../shared/protocol.js';
import { SwapError, SwapQuotes, checkPoolNames, parseQuoteAsk, swapWallet, wrapIdOf } from '../swap.js';
import { gamertag } from '../../../shared/names.js';
import { LAUNCH_RETIRED, type Config } from '../config.js';
import type { Db } from '../db.js';
import type { ChainAdapter, ChainConfig, Opening, TxOutcome } from '../chain/types.js';
import type { AuthService, SessionRec } from '../auth/service.js';
import { checkSignedTx, decodeSignedTxBase64, signRequestOf, type ExpectedTx, type PlayerMethod } from '../auth/tx.js';
import type { NearAi } from '../nearai/client.js';
import { CreditMonitor, type AiHealth } from '../nearai/credits.js';
import { atRound, ownerOf, type Persona } from '../personas.js';
import type { AgentStore } from '../agents/store.js';
import type { ByokKeys } from '../agents/byok.js';
import { personaOfAgent } from '../agents/persona.js';
import { agentChatsOf } from '../agents/stats.js';
import { describeSlots, levelsByPersona, nextRoundsOf, slotsOfRound, type SlotCandidate } from '../agents/schedule.js';
import { buildCast } from '../persona/cast.js';
import { MODELS, chatCostUsd } from '../models.js';
import {
  avatarSeed, botPreimage, chatTag, commitmentOf, handleOf, humanPreimage, newCharacterId, newSalt, newSecret,
  normalizeSigners, seatSeed, secretHash, skinMessage,
} from '../formats.js';
import { randomHex } from '../crypto.js';
import { splitPlay } from '../settlement.js';
import { RATING_START } from '../scoring.js';
import { BotSession, type BotHost, type BrainChoice, type StoredMsg } from '../bot/session.js';
import { defaultBrain } from '../bot/brain.js';
import type { BotmasterHub } from '../bot/remote.js';
import { buildBundle, lastSignedCompletion } from './bundle.js';
import { computeResults } from './results.js';
import { Telegram, roundStats, type RoundStats } from '../telegram.js';
import type { AttestInfo, CharacterRec, ChatSide, RoundRec, Search, UserRec } from './types.js';
import { coinsToUnits, errMsg, pick, randomId, sleep, uniform, unitsToCoins, utcDay } from '../util.js';
import { logger } from '../log.js';

const log = logger('game');

export const PRESETS: Record<Level, [number, number, number]> = { 1: [5, 10, 25], 2: [25, 50, 100], 3: [100, 250, 500] };
const MAX_SAY = 280;
const SAY_INTERVAL_MS = 600;
/**
 * error bots_unavailable: no bot can talk (the house key is out of credits, or every bot at the level is on an
 * empty key), so no new chat starts. Neutral on purpose: it never hints that a human may still come.
 */
export const BOTS_UNAVAILABLE = 'The bots are napping. New chats are paused for a few minutes; chats already running finish as normal.';
/** error beta_closed (new searches and sign-ins once the testnet beta's NEAR AI spend cap is reached) */
export const BETA_CLOSED = 'The beta test is over. Thanks for playing! See you on mainnet.';
const BOT_CHAT_ABORTED = 'The bots are napping, so this chat could not start. New chats are paused for a few minutes; if you played coins, your locked coins come back when the round settles.';

/** AI builders, NEAR AI credit tracking and wallet sessions (src/agents/, src/nearai/credits.ts, src/auth/); all optional. */
export interface GameExtras {
  agents?: AgentStore;
  credits?: CreditMonitor;
  byok?: ByokKeys;
  auth?: AuthService;
  /** round summaries and the end of Turing Hour on Telegram; default: from TELEGRAM_* (tests pass one with a stub sender) */
  telegram?: Telegram;
}

export interface Conn {
  account: string;
  /** wallet accounts: the session the connection's ticket was issued for (test users have none) */
  sessionId?: string;
  /** last level this connection entered; its room is re-sent when a new round starts */
  level?: Level;
  send(msg: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

const TGAS = 1_000_000_000_000n;
const YOCTO_PER_NEAR = 10n ** 24n;

/** A play or call waiting for the browser's signature (ServerMsg sign_tx). */
interface PendingSign {
  reqId: string;
  account: string;
  sessionId: string;
  chatId: string;
  want: ExpectedTx;
  msg: ServerMsg;
  resolve(r: { ok: true; bytes: Uint8Array; hash: string } | { ok: false; error: string }): void;
}

/** NEAR yoctoNEAR from a decimal amount of NEAR (config), exact to 1e-6 NEAR. */
function nearToYocto(near: number): bigint {
  return (BigInt(Math.round(near * 1e6)) * YOCTO_PER_NEAR) / 1_000_000n;
}

/** The deployed contract reports panics as a bare wasm trap; keep the raw text in the DB, show something readable. */
function friendlyChainError(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (/unreachable|wasm|trap/i.test(raw)) return `${fallback}: the game contract rejected it`;
  const m = raw.match(/Smart contract panicked: (.*)/);
  return m ? `${fallback}: ${m[1]}` : `${fallback}: ${raw.slice(0, 160)}`;
}

const slotCandidate = (p: Persona): SlotCandidate => ({ id: p.id, owner: ownerOf(p) ?? p.id, levels: p.levels });

export class GameError extends Error {
  /** `extra`: more fields for the JSON error body (an airdrop refusal says when the next one may run) */
  constructor(readonly code: string, message: string, readonly status = 400, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

interface Conv {
  id: string;
  roundId: number;
  kind: 'human' | 'bot';
  sides: string[];
  started: boolean;
  ended: boolean;
  endTimer: NodeJS.Timeout | null;
}

export class Game implements BotHost {
  readonly botTimeScale: number;
  skinSecret = '';
  chainCfg!: ChainConfig;
  coinUnit = 10n ** 18n;
  publicConfig!: PublicConfig;

  users = new Map<string, UserRec>();
  labels = new Map<string, string>();
  rounds = new Map<number, RoundRec>(); // live (unsettled) rounds
  current: RoundRec | null = null;
  chars = new Map<number, Map<string, CharacterRec>>();
  sides = new Map<string, ChatSide>(); // chatId -> side, live rounds
  seatIndex = new Map<string, string>(); // round|viewer|level|seat -> chatId
  convs = new Map<string, Conv>();
  searches = new Map<string, Search>();
  unavailable = new Set<string>();
  conns = new Map<string, Set<Conn>>();
  bots = new Map<string, BotSession>();
  missTimers = new Map<string, NodeJS.Timeout>();
  leftTimers = new Map<string, NodeJS.Timeout>();
  roundTimers = new Map<number, NodeJS.Timeout[]>();
  pending = new Map<number, Set<Promise<unknown>>>();
  playPromises = new Map<string, Promise<void>>();
  lastSay = new Map<string, number>();
  balances = new Map<string, { v: bigint; at: number }>();
  private commitChains = new Map<number, Promise<void>>();
  private commitTimers = new Map<number, NodeJS.Timeout>();
  private creatingHuman = new Set<string>();
  private settling = new Map<number, Promise<void>>();
  private housekeeping: NodeJS.Timeout | null = null;
  private startingRound: Promise<RoundRec> | null = null;
  /** last time any human (test user) was connected; persisted as kv last_human_at */
  private lastHumanAt = Date.now();
  private lastHumanSaved = 0;
  private pruning = false;
  /** round -> consecutive prune failures and when to try again */
  private pruneRetry = new Map<number, { n: number; at: number }>();
  stopped = false;
  /** In-process tools only (tools/smoke-bots.ts): choose the bot character for a search instead of at random. */
  botPicker?: (account: string, candidates: CharacterRec[]) => CharacterRec | undefined;
  /** AI builders: their botmasters, personas and settled chat records */
  readonly agents?: AgentStore;
  /** spend and credit state of every NEAR AI key the bots use */
  readonly credits: CreditMonitor;
  /** botmasters' own NEAR AI keys */
  readonly byok?: ByokKeys;
  /** the testnet beta reached its NEAR AI spend cap (BETA_SPEND_CAP_USD): no new chats, sign-ins or rounds */
  private betaClosedNow = false;
  /** wallet sign-in: sessions and their browsers' play keys */
  readonly auth?: AuthService;
  /** plays and calls waiting for a browser's signature, by request id */
  private signReqs = new Map<string, PendingSign>();
  /** per play key (account|key): the next nonce to ask for and a recent block hash to sign with */
  private keyNonces = new Map<string, { next: bigint; blockHash: string; at: number }>();
  private configTimer: NodeJS.Timeout | null = null;
  /** coins for NEAR on Rhea (v1.12): the quotes, once SWAP_* is set, coins are open and the pool checks out */
  swap: SwapQuotes | null = null;
  /** NEAR per coin in PublicConfig.nearPerCoin, re-read every minute */
  private swapPrice: number | null = null;
  private swapTimer: NodeJS.Timeout | null = null;
  /** posts to the game's Telegram channel, in the background; off without TELEGRAM_* and always in test mode */
  readonly telegram: Telegram;

  constructor(
    readonly cfg: Config,
    readonly db: Db,
    readonly chain: ChainAdapter,
    /** the relay's own NEAR AI client (the house key; src/app.ts wraps it to track spend and credits) */
    readonly ai: NearAi,
    readonly personas: Persona[],
    /** remote brains of registered botmasters (/bot/ws) */
    readonly hub?: BotmasterHub,
    ext: GameExtras = {},
  ) {
    this.botTimeScale = cfg.botTimeScale;
    this.agents = ext.agents;
    this.byok = ext.byok;
    this.auth = ext.auth;
    this.telegram = ext.telegram ?? new Telegram(cfg.telegram, db, { testMode: cfg.testMode, turingHour: cfg.turingHour, siteUrl: `https://${cfg.authRecipient}` });
    this.credits = ext.credits ?? new CreditMonitor(db, { budgetUsd: cfg.nearAiBudgetUsd, recheckMs: cfg.nearAiRecheckSeconds * 1000 });
    // the beta's spend cap is rechecked every time the house key's spend is recorded
    this.credits.onSpend = (keyId) => {
      if (keyId === 'house') this.checkBeta();
    };
  }

  // =====================================================================================
  // boot
  // =====================================================================================

  async start(): Promise<void> {
    this.skinSecret = this.cfg.skinSecret || this.db.getKv('skin_secret') || '';
    if (!this.skinSecret) {
      this.skinSecret = randomHex(32);
      this.db.setKv('skin_secret', this.skinSecret);
    }
    for (let i = 0; ; i++) {
      try {
        this.chainCfg = await this.chain.getConfig();
        break;
      } catch (e) {
        if (i >= 5) throw e;
        log.warn(`get_config failed, retrying: ${errMsg(e)}`);
        await sleep(2000);
      }
    }
    this.coinUnit = this.chainCfg.coinUnit;
    // a pool id that does not name the game's coin and the wrap contract stops the relay here
    await this.setupSwap(true);
    this.betaClosedNow = !!this.betaState()?.closed;
    if (this.betaClosedNow) log.warn(`beta closed: ${this.betaLine()}; no new chats, sign-ins or rounds`);
    this.publicConfig = this.makePublicConfig();
    if (!this.chainCfg.coinsOpen) log.warn(`${this.chain.contractId} has no coin set yet: free play only, "Coins open when REAL launches" (re-checked every minute)`);
    this.logLaunch();
    log.info(this.telegram.describe());
    if (this.cfg.turingHour) {
      const th = this.cfg.turingHour;
      log.info(`Turing Hour: every day at ${th.startUtc} UTC for ${th.minutes} min${th.prize ? `, prize "${th.prize}"` : ''} (PublicConfig.turingHour)`);
    }
    this.loadUsers();
    const seen = Number(this.db.getKv('last_human_at') ?? '');
    this.lastHumanAt = Number.isFinite(seen) && seen > 0 ? seen : Date.now();
    await this.resume();
    if (!this.current) {
      if (this.betaClosedNow) log.info('beta closed: no new round');
      else if (this.isIdle()) log.info(`idle: no human connected for ${this.cfg.idleMinutes} min; the next round starts when one connects`);
      else await this.startRound();
    }
    this.housekeeping = setInterval(() => this.housekeep(), 30_000);
    this.scheduleConfigRefresh();
  }

  private makePublicConfig(): PublicConfig {
    const net = this.chain.network;
    return {
      testMode: this.cfg.testMode,
      network: net,
      contractId: this.chain.contractId,
      tokenId: this.chainCfg.token ?? this.chain.tokenId,
      tokenSymbol: net === 'testnet' ? 'tREAL' : 'REAL',
      coinUnit: this.coinUnit.toString(),
      usdPerCoin: this.cfg.usdPerCoin,
      presets: PRESETS,
      minCoins: this.chainCfg.minCoins,
      maxCoins: this.chainCfg.maxCoins,
      chatSeconds: this.cfg.chatSeconds,
      callSeconds: this.cfg.callSeconds,
      roundMinutes: this.cfg.roundMinutes,
      feeBps: this.chainCfg.feeBps,
      freeChatsPerDay: this.cfg.freeChatsPerDay,
      countdownSeconds: this.cfg.countdownSeconds,
      explorerTx: `https://${net === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/{hash}`,
      explorerAccount: `https://${net === 'testnet' ? 'testnet.' : ''}nearblocks.io/address/{account}`,
      coinsOpen: this.chainCfg.coinsOpen,
      ...(this.cfg.buyUrl ? { buyUrl: this.cfg.buyUrl } : {}),
      tokenDecimals: this.chain.tokenDecimals,
      wallet: {
        recipient: this.cfg.authRecipient,
        playKey: { receiverId: this.chain.contractId, methodNames: ['play', 'call'], allowance: nearToYocto(this.cfg.playKeyAllowanceNear).toString() },
        gas: { deposit: (100n * TGAS).toString(), withdraw: (50n * TGAS).toString(), storage: (30n * TGAS).toString() },
      },
      ...(this.launchOn() ? { launch: { ...this.cfg.launch! } } : {}),
      ...(this.betaClosedNow ? { betaClosed: { redirect: this.cfg.betaClosedRedirect, reason: 'spend_cap' as const } } : {}),
      ...(this.swap && this.chainCfg.coinsOpen
        ? {
            swap: { dex: this.swap.pool.dex, poolId: this.swap.pool.poolId, wrapId: this.swap.pool.wrapId, slippageBps: this.swap.pool.slippageBps },
            ...(this.swapPrice !== null ? { nearPerCoin: this.swapPrice } : {}),
          }
        : {}),
      ...(this.cfg.turingHour ? { turingHour: { ...this.cfg.turingHour } } : {}),
      // v1.14: a visitor without a wallet may try a practice chat (src/game/practice.ts)
      ...(this.cfg.guestChatsPerDay > 0 && this.cfg.guestChatsDailyCap > 0 ? { practice: { perDay: this.cfg.guestChatsPerDay } } : {}),
    };
  }

  // =====================================================================================
  // coins for NEAR on Rhea (protocol v1.12, src/swap.ts)
  // =====================================================================================

  /**
   * SWAP_*: once coins are open, the pool id must name the game's coin and the wrap contract, and the pool must exist
   * on the pool contract. At start a wrong pool stops the relay with the reason; when coins open later (mainnet, at the
   * token launch) it only stays off, with the reason in the log. One line says what is on.
   */
  private async setupSwap(atStart: boolean): Promise<void> {
    const s = this.cfg.swap;
    if (!s || this.swap) return;
    if (!this.chainCfg.coinsOpen) {
      if (atStart) log.info(`swap: ${s.poolId} on ${s.dex} waits for the coin; checked when coins open`);
      return;
    }
    const coin = this.chainCfg.token ?? this.chain.tokenId;
    const wrapId = wrapIdOf(s, this.chain.network);
    try {
      checkPoolNames(s.poolId, coin, wrapId);
      const pool = await this.chain.view<unknown>(s.dex, 'get_pool', { pool_id: s.poolId }).catch((e) => {
        // NEAR not answering is no reason to stop: quotes fail until it answers
        log.warn(`swap: could not read ${s.poolId} on ${s.dex} (${errMsg(e)}); going on`);
        return undefined;
      });
      if (pool === null) throw new Error(`SWAP_POOL ${s.poolId} does not exist on ${s.dex} (SWAP_DEX)`);
    } catch (e) {
      if (atStart) throw e;
      log.error(`swap stays off: ${errMsg(e)}`);
      return;
    }
    this.swap = new SwapQuotes((c, m, a) => this.chain.view(c, m, a), { dex: s.dex, poolId: s.poolId, wrapId, coin, coinUnit: this.coinUnit, slippageBps: s.slippageBps });
    this.swapPrice = await this.swap.nearPerCoin();
    log.info(
      `swap: coins for NEAR on Rhea, pool ${s.poolId} on ${s.dex}, ${wrapId}, slippage ${s.slippageBps / 100}%, ` +
        `${this.swapPrice === null ? 'price not read yet' : `${this.swapPrice} NEAR per coin`}`,
    );
    this.swapTimer = setInterval(() => void this.refreshSwapPrice(), 60_000);
    this.swapTimer.unref?.();
  }

  /** The price, once a minute; every connection hears it when it moved enough to show (4 significant digits). */
  private async refreshSwapPrice(): Promise<void> {
    if (!this.swap || this.stopped) return;
    const p = await this.swap.nearPerCoin();
    if (p === null) return;
    const shown = (v: number | null) => (v === null ? '' : v.toPrecision(4));
    const moved = shown(p) !== shown(this.swapPrice);
    this.swapPrice = p;
    if (!moved || !this.publicConfig) return;
    this.publicConfig = this.makePublicConfig();
    this.broadcast({ t: 'config', config: this.publicConfig });
  }

  /** GET /api/swap/quote: what NEAR buys or coins sell for now (cached a few seconds); refusals with their code. */
  async swapQuote(q: URLSearchParams): Promise<SwapQuote> {
    if (!this.swap) throw new GameError('swap_off', 'buying coins with NEAR is not on here', 404);
    try {
      return await this.swap.quote(parseQuoteAsk(q, this.coinUnit));
    } catch (e) {
      if (e instanceof SwapError) throw new GameError(e.code, e.message, e.status);
      log.warn(`swap quote: ${errMsg(e)}`);
      throw new GameError('swap_unavailable', 'Rhea is not answering right now; try again in a moment', 502);
    }
  }

  // =====================================================================================
  // the testnet beta's spend cap (BETA_SPEND_CAP_USD)
  // =====================================================================================

  /** extra cap given by the operator (POST /api/admin/beta/reopen), kept in the DB */
  private betaExtraUsd(): number {
    const v = Number(this.db.getKv('beta_cap_add_usd') ?? '0');
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  /** The cap, the house key's lifetime spend, and whether the beta is closed; undefined without a cap. */
  betaState(): { capUsd: number; spendUsd: number; closed: boolean } | undefined {
    if (this.cfg.betaSpendCapUsd === undefined) return undefined;
    const capUsd = Math.round((this.cfg.betaSpendCapUsd + this.betaExtraUsd()) * 1e6) / 1e6;
    const spendUsd = Math.round((this.credits.state('house')?.spendUsd ?? 0) * 1e6) / 1e6;
    return { capUsd, spendUsd, closed: spendUsd >= capUsd };
  }

  private betaLine(): string {
    const b = this.betaState();
    return b ? `NEAR AI spend $${b.spendUsd.toFixed(4)} of the $${b.capUsd} cap (BETA_SPEND_CAP_USD)` : 'no cap';
  }

  /** The beta is closed: no new chats, sign-ins or rounds; running chats finish and the round settles. */
  betaClosed(): boolean {
    return this.betaClosedNow;
  }

  /**
   * After every house spend and on reopen: closes the beta when the spend reaches the cap, reopens it when the
   * cap moves above the spend. Either way the public config changes and every connection gets it.
   */
  checkBeta(): void {
    const closed = !!this.betaState()?.closed;
    if (closed === this.betaClosedNow) return;
    this.betaClosedNow = closed;
    if (closed) {
      log.warn(`beta closed: ${this.betaLine()}; no new chats, sign-ins or rounds; running chats finish; players go to ${this.cfg.betaClosedRedirect}`);
      // searches under way end here, like the ones refused from now on
      for (const sr of [...this.searches.values()]) {
        this.cancelSearch(sr.account, true);
        this.sendTo(sr.account, { t: 'error', code: 'beta_closed', message: BETA_CLOSED });
      }
    } else log.info(`beta reopened: ${this.betaLine()}`);
    if (!this.publicConfig) return; // before start(): the config is made there
    this.publicConfig = this.makePublicConfig();
    this.broadcast({ t: 'config', config: this.publicConfig });
    if (!closed && !this.current && !this.startingRound && !this.stopped && !this.isIdle()) void this.startRound();
  }

  /** The operator raises the cap by `addUsd` (kept across restarts); the beta reopens if the spend is below it now. */
  reopenBeta(addUsd: number): { capUsd: number; spendUsd: number; closed: boolean } {
    if (this.cfg.betaSpendCapUsd === undefined) throw new GameError('beta_cap_off', 'BETA_SPEND_CAP_USD is not set on this relay: there is no cap to raise', 409);
    if (!(typeof addUsd === 'number' && Number.isFinite(addUsd) && addUsd > 0 && addUsd <= 10_000)) throw new GameError('invalid_request', 'addUsd: a number of dollars above 0', 400);
    this.db.setKv('beta_cap_add_usd', String(this.betaExtraUsd() + addUsd));
    log.info(`beta cap raised by $${addUsd}`);
    this.checkBeta();
    return this.betaState()!;
  }

  /**
   * The launch (protocol v1.4): while LAUNCH_* is set, until the coin is set on the contract, and never with test
   * mode on (the testnet demo shows none of it, whatever its env says).
   */
  launchOn(): boolean {
    return !!this.cfg.launch && !this.cfg.testMode && !this.chainCfg.coinsOpen;
  }

  private logLaunch(): void {
    const retired = LAUNCH_RETIRED.filter((k) => process.env[k]?.trim());
    if (retired.length) log.warn(`${retired.join(', ')}: no longer read (the coming-soon page has no demo or trailer settings now)`);
    const l = this.cfg.launch;
    if (!l) return;
    const at = (t?: number) => (t === undefined ? 'not announced' : new Date(t).toISOString());
    if (this.cfg.testMode) log.warn('LAUNCH_* is ignored in test mode: the testnet demo never shows the coming-soon page or the auction banner');
    else if (this.launchOn()) {
      log.info(
        `launch: / is the coming-soon page until ${at(l.auctionStart)} (the game at /play meanwhile), then the game with the auction banner ` +
          `until ${at(l.auctionEnd)} and "coins open soon" until the coin is set; "Get REAL" ${l.tokenUrl ?? this.cfg.buyUrl ?? 'not set yet'}; video card ${l.videoUrl ?? l.xUrl ?? 'none (no LAUNCH_VIDEO_URL or LAUNCH_X_URL)'}; ` +
          `footer links: ${[l.telegramUrl && `Telegram ${l.telegramUrl}`, l.xUrl && `X ${l.xUrl}`, 'Terms'].filter(Boolean).join(', ')}`,
      );
    } else log.info('LAUNCH_* is set, but coins are open: no coming-soon page or banner, the game is at /');
  }

  /**
   * The contract's coin is set by the owner at the token launch (mainnet): re-read get_config every minute
   * while there is none, every 15 minutes after, and tell every connection when the public config changes.
   */
  private scheduleConfigRefresh(): void {
    if (this.stopped) return;
    const ms = this.chainCfg.coinsOpen ? 15 * 60_000 : 60_000;
    this.configTimer = setTimeout(() => void this.refreshChainConfig().finally(() => this.scheduleConfigRefresh()), ms);
    this.configTimer.unref?.();
  }

  async refreshChainConfig(): Promise<void> {
    try {
      const c = await this.chain.getConfig();
      const before = JSON.stringify(this.publicConfig);
      const opened = c.coinsOpen && !this.chainCfg.coinsOpen;
      this.chainCfg = c;
      this.coinUnit = c.coinUnit;
      if (opened) await this.setupSwap(false);
      this.publicConfig = this.makePublicConfig();
      if (opened) log.info(`coins are open: ${c.token}, coin unit ${c.coinUnit}${this.cfg.launch && !this.launchOn() ? '; the launch banner is gone' : ''}`);
      if (JSON.stringify(this.publicConfig) !== before) this.broadcast({ t: 'config', config: this.publicConfig });
    } catch (e) {
      log.debug(`get_config: ${errMsg(e)}`);
    }
  }

  /** No human connected for IDLE_MINUTES: no new rounds (no start_round, no commits) until one connects. */
  isIdle(): boolean {
    return this.cfg.idleMinutes > 0 && this.conns.size === 0 && Date.now() - this.lastHumanAt >= this.cfg.idleMinutes * 60_000;
  }

  private markHuman(persist = false): void {
    const now = Date.now();
    this.lastHumanAt = now;
    if (persist || now - this.lastHumanSaved > 15_000) {
      this.lastHumanSaved = now;
      this.db.setKv('last_human_at', String(now));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.housekeeping) clearInterval(this.housekeeping);
    if (this.configTimer) clearTimeout(this.configTimer);
    if (this.swapTimer) clearInterval(this.swapTimer);
    for (const p of [...this.signReqs.values()]) p.resolve({ ok: false, error: 'the relay is stopping' });
    for (const ts of this.roundTimers.values()) ts.forEach(clearTimeout);
    for (const t of this.missTimers.values()) clearTimeout(t);
    for (const t of this.leftTimers.values()) clearTimeout(t);
    for (const t of this.commitTimers.values()) clearTimeout(t);
    for (const s of this.searches.values()) if (s.timer) clearTimeout(s.timer);
    for (const c of this.convs.values()) if (c.endTimer) clearTimeout(c.endTimer);
    for (const b of this.bots.values()) b.stop(false);
    for (const set of this.conns.values()) for (const c of set) c.close(1001, 'server stopping');
  }

  private loadUsers(): void {
    for (const u of this.db.loadUsers<UserRec>()) this.users.set(u.account, u);
    // test users exist only in test mode (TEST_MODE=0: players are wallet accounts, nobody else)
    for (const t of this.cfg.testMode ? this.chain.testUsers : []) {
      this.labels.set(t.accountId, t.label);
      if (!this.users.has(t.accountId)) {
        const u: UserRec = {
          account: t.accountId, label: t.label, rating: RATING_START, chats: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0,
          lockedBonus: '0', freeDay: utcDay(), freeUsed: 0, kind: 'test',
        };
        this.users.set(u.account, u);
        this.db.saveUser(u.account, u);
      }
    }
  }

  private saveUser(u: UserRec): void {
    this.db.saveUser(u.account, u);
  }

  /** A test user in test mode: the relay holds its key and signs its plays, calls and withdrawals. */
  isTestUser(account: string): boolean {
    return this.cfg.testMode && this.labels.has(account);
  }

  /** The relay signs this account's transactions (test users only; never a wallet account). */
  relaySigns(account: string): boolean {
    return this.isTestUser(account);
  }

  /** Someone who may play: a test user (test mode) or an account that signed in with its wallet. */
  isPlayer(account: string): boolean {
    return this.isTestUser(account) || this.users.get(account)?.kind === 'wallet';
  }

  /** First sign-in of a wallet account: its player record (rating, stats). */
  ensureWalletUser(account: string): UserRec {
    let u = this.users.get(account);
    if (!u) {
      u = {
        account, label: account, rating: RATING_START, chats: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0,
        lockedBonus: '0', freeDay: utcDay(), freeUsed: 0, kind: 'wallet',
      };
      this.users.set(account, u);
      this.saveUser(u);
      log.info(`new wallet player ${account}`);
    } else if (u.kind !== 'wallet' && !this.isTestUser(account)) {
      u.kind = 'wallet';
      this.saveUser(u);
    }
    return u;
  }

  private async resume(): Promise<void> {
    const ids = this.db.unsettledRoundIds();
    const latest = this.db.maxRoundId();
    const now = Date.now();
    for (const id of ids) {
      const r = this.db.loadRound<RoundRec>(id);
      if (!r) continue;
      this.rounds.set(id, r);
      const cm = new Map<string, CharacterRec>();
      for (const c of this.db.loadCharacters<CharacterRec>(id)) {
        if (c.commitStatus === 'sending') c.commitStatus = 'pending';
        cm.set(c.id, c);
      }
      this.chars.set(id, cm);
      for (const side of this.db.loadChats<ChatSide>(id)) {
        side.messages = this.db.loadMessages<StoredMsg>(side.chatId);
        this.registerSide(side);
        let conv = this.convs.get(side.convId);
        if (!conv) {
          conv = { id: side.convId, roundId: id, kind: side.partnerKind, sides: [], started: !!side.startedAt, ended: false, endTimer: null };
          this.convs.set(conv.id, conv);
        }
        conv.sides.push(side.chatId);
      }
      // chats interrupted by the restart: close them and give a call window
      for (const conv of this.convs.values()) {
        if (conv.roundId !== id) continue;
        const ss = conv.sides.map((c) => this.sides.get(c)!);
        for (const s of ss) {
          if (s.playStatus === 'pending') {
            const pl = r.startOk ? await this.chain.getPlay(id, s.handle).catch(() => null) : null;
            s.playStatus = pl ? 'placed' : 'failed';
            if (!pl) s.mode = 'free';
          }
        }
        if (ss.some((s) => s.phase === 'placing' || s.phase === 'chatting')) {
          conv.ended = false;
          this.endConv(conv, 'round_end', this.cfg.callSeconds * 1000);
        }
        for (const s of ss) {
          if (s.phase === 'calling') {
            const left = (s.callDeadline ?? 0) - now;
            if (left <= 0) this.markMissed(s);
            else this.missTimers.set(s.chatId, setTimeout(() => this.markMissed(s), left + 500));
          }
        }
      }
      const live = (r.status === 'open' || r.status === 'closing') && now < r.endsAt - 5000 && id === latest && !r.endedEarly;
      if (live) {
        this.current = r;
        this.scheduleRoundTimers(r);
        log.info(`resumed round ${id}, ends in ${Math.round((r.endsAt - now) / 1000)} s`);
        void this.setupRound(r).catch((e) => log.error(`setup of round ${id} failed`, e));
      } else {
        if (r.status === 'open' || r.status === 'closing') {
          r.status = 'settling';
          this.saveRound(r);
        }
        log.info(`round ${id} needs settlement, resuming it in the background`);
        void this.settle(r);
      }
    }
  }

  private housekeep(): void {
    try {
      if (this.conns.size > 0) this.markHuman();
      if (this.current) this.db.pruneAttestationRaw(this.current.id - 30);
      for (const r of this.rounds.values()) if (r.status === 'settling' && !this.settling.has(r.id)) void this.settle(r);
      if (!this.current && !this.startingRound && !this.stopped && !this.isIdle() && !this.betaClosedNow) void this.startRound();
      void this.pruneSettled();
      // the end of Turing Hour on Telegram, in the background (never throws)
      void this.telegram.checkHour();
    } catch (e) {
      log.error('housekeeping', e);
    }
  }

  /**
   * prune_round every settled round whose results, ratings and bundles are stored, PRUNE_DELAY_SECONDS
   * after settlement (chain views stay readable for a while for anyone checking). Repeats until the
   * contract reports 0 left; a round already empty on chain (pruned by hand) needs no transaction.
   */
  private async pruneSettled(): Promise<void> {
    if (this.pruning || this.stopped) return;
    this.pruning = true;
    try {
      const delay = this.cfg.pruneDelaySeconds * 1000;
      for (const r of this.db.settledUnpruned<RoundRec>(50)) {
        if (this.stopped) return;
        if (!r.resultsDone || Date.now() < (r.settledAt ?? 0) + delay) continue;
        const retry = this.pruneRetry.get(r.id);
        if (retry && Date.now() < retry.at) continue;
        let left: number | null = null;
        if (r.startOk) {
          const view = await this.chain.getRound(r.id).catch(() => undefined);
          if (view === undefined) continue; // RPC trouble: next time
          if (view === null || (view.plays === 0 && view.characters === 0)) left = 0;
          else if (!view.settled) {
            log.warn(`round ${r.id} is settled here but not on chain; not pruning`);
            continue;
          }
          for (let i = 0; i < 20 && left !== 0; i++) {
            const res = await this.chain.pruneRound(r.id, 200);
            if (!res.ok || res.remaining === undefined) {
              const n = (retry?.n ?? 0) + 1;
              const wait = Math.min(30 * 60_000, 30_000 * 2 ** (n - 1));
              this.pruneRetry.set(r.id, { n, at: Date.now() + wait });
              log.warn(`prune_round ${r.id} failed (${n}x): ${res.error ?? 'no return value'}; next try in ${Math.round(wait / 1000)} s`);
              break;
            }
            left = res.remaining;
          }
        } else left = 0; // never started on chain: nothing stored there
        if (left !== 0) continue;
        r.prunedAt = Date.now();
        this.pruneRetry.delete(r.id);
        this.db.saveRound(r.id, r.status, r);
        log.info(`round ${r.id}: chain storage pruned`);
      }
    } catch (e) {
      log.warn(`pruning: ${errMsg(e)}`);
    } finally {
      this.pruning = false;
    }
  }

  // =====================================================================================
  // rounds
  // =====================================================================================

  private saveRound(r: RoundRec): void {
    this.db.saveRound(r.id, r.status, r);
  }

  private saveChar(c: CharacterRec): void {
    this.db.saveCharacter(c.id, c.roundId, c);
  }

  roundState(r: RoundRec | null = this.current): RoundState {
    const rr = r ?? this.latestRound();
    if (!rr) {
      const now = Date.now();
      return { roundId: 0, startedAt: now, endsAt: now, acceptingUntil: now, status: 'settling', themes: { 1: 'castle', 2: 'jungle', 3: 'desert' } };
    }
    return {
      roundId: rr.id,
      startedAt: rr.startedAt,
      endsAt: rr.endsAt,
      acceptingUntil: rr.acceptingUntil,
      status: rr.status,
      themes: { 1: themeFor(1, rr.id), 2: themeFor(2, rr.id), 3: themeFor(3, rr.id) },
      chain: { startTx: rr.startTx, commitTxs: [...rr.commitTxs] },
    };
  }

  private latestRound(): RoundRec | null {
    let best: RoundRec | null = null;
    for (const r of this.rounds.values()) if (!best || r.id > best.id) best = r;
    if (best) return best;
    const rows = this.db.listRounds<RoundRec>(1);
    return rows[0] ?? null;
  }

  private async nextRoundId(): Promise<number> {
    let latestOnChain = 0;
    try {
      const c = await this.chain.getConfig();
      latestOnChain = Number((c.raw as any)?.latest_round ?? 0) || 0;
    } catch {
      /* fall back to the DB */
    }
    let id = Math.max(this.db.maxRoundId(), latestOnChain) + 1;
    for (let i = 0; i < 20; i++) {
      const existing = await this.chain.getRound(id).catch(() => null);
      if (!existing) break;
      id++;
    }
    return id;
  }

  startRound(): Promise<RoundRec> {
    if (this.startingRound) return this.startingRound;
    this.startingRound = (async () => {
      try {
        const id = await this.nextRoundId();
        const now = Date.now();
        const endsAt = now + this.cfg.roundMinutes * 60_000;
        const secret = newSecret();
        const r: RoundRec = {
          id, secret, secretHash: secretHash(secret), startedAt: now, endsAt,
          acceptingUntil: endsAt - (this.cfg.chatSeconds + this.cfg.callSeconds + this.cfg.countdownSeconds + 15) * 1000,
          status: 'open', ready: false, endedEarly: false, startOk: false, commitTxs: [], openTxs: [], resultsDone: false, attest: {},
          castSeed: randomHex(16),
        };
        this.rounds.set(id, r);
        this.chars.set(id, new Map());
        this.current = r;
        this.saveRound(r);
        this.scheduleRoundTimers(r);
        log.info(`round ${id} started, ends ${new Date(endsAt).toISOString()}, accepting until ${new Date(r.acceptingUntil).toISOString()}`);
        this.broadcast({ t: 'round', round: this.roundState(r) });
        this.pushRooms();
        void this.setupRound(r).catch((e) => log.error(`setup of round ${id} failed`, e));
        return r;
      } finally {
        this.startingRound = null;
      }
    })();
    return this.startingRound;
  }

  private scheduleRoundTimers(r: RoundRec): void {
    for (const t of this.roundTimers.get(r.id) ?? []) clearTimeout(t);
    const now = Date.now();
    const ts: NodeJS.Timeout[] = [];
    ts.push(
      setTimeout(() => {
        if (r.status === 'open') {
          r.status = 'closing';
          this.saveRound(r);
          this.broadcast({ t: 'round', round: this.roundState(r) });
        }
      }, Math.max(0, r.acceptingUntil - now)),
    );
    ts.push(setTimeout(() => void this.endRound(r), Math.max(0, r.endsAt - now)));
    this.roundTimers.set(r.id, ts);
  }

  /** start_round, attestations with nonce = secret_hash, bot characters, human characters, commit. */
  private async setupRound(r: RoundRec): Promise<void> {
    while (!r.startOk) {
      if (this.stopped || this.current !== r || Date.now() > r.endsAt - 30_000) {
        log.error(`round ${r.id} could not be started on chain; it stays without characters`);
        return;
      }
      const res = await this.chain.startRound(r.id, r.secretHash, r.endsAt);
      if (res.ok) {
        r.startOk = true;
        r.startTx = res.hash;
      } else {
        const onChain = await this.chain.getRound(r.id).catch(() => null);
        if (onChain && onChain.secretHash === r.secretHash) r.startOk = true;
        else {
          r.lastError = `start_round: ${res.error}`;
          log.warn(`round ${r.id} start_round failed: ${res.error}; retrying`);
          await sleep(3000);
        }
      }
      this.saveRound(r);
    }
    this.broadcast({ t: 'round', round: this.roundState(r) });

    const cm = this.chars.get(r.id)!;
    const haveBots = [...cm.values()].some((c) => c.kind === 'bot');
    const cast = haveBots ? [] : this.castOf(r, true);
    const models = [...new Set([...cast.map((p) => p.model), ...[...cm.values()].filter((c) => c.kind === 'bot').map((c) => c.model!)])];
    const missing = models.filter((m) => !r.attest[m]?.ok);
    await Promise.all(missing.map((m) => this.attest(r, m)));

    if (!haveBots) {
      for (const p of cast) {
        const info = r.attest[p.model];
        if (!info?.ok) {
          log.warn(`round ${r.id}: persona ${p.id} skipped, model ${p.model} not attested`);
          continue;
        }
        for (const level of p.levels) this.addBotCharacter(r, p, level, info.attested);
      }
    }
    await Promise.all([...this.conns.keys()].map((a) => this.ensureHuman(a)));
    await this.flushCommits(r);
    r.ready = [...cm.values()].some((c) => c.kind === 'bot' && c.commitStatus === 'committed');
    this.saveRound(r);
    log.info(`round ${r.id} ready: ${[...cm.values()].filter((c) => c.commitStatus === 'committed').length} characters committed`);
    this.broadcast({ t: 'round', round: this.roundState(r) });
  }

  private async attest(r: RoundRec, model: string): Promise<void> {
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const a = await this.ai.attest(model, r.secretHash);
        const info: AttestInfo = {
          model, nonce: r.secretHash, fetchedAt: a.fetchedAt, signers: a.signers, attested: a.attested,
          gatewaySigner: a.gatewaySigner, gatewayOk: a.gatewayOk, note: a.note, ok: a.attested.length > 0,
          error: a.attested.length > 0 ? undefined : 'no model signer bound to the nonce',
        };
        this.db.saveAttestation(r.id, model, r.secretHash, a.fetchedAt, info, a.rawGzip);
        r.attest[model] = info;
        this.saveRound(r);
        log.info(`round ${r.id} attestation ${model}: signers ${a.attested.join(',') || 'none'}; ${a.note}`);
        if (info.ok) return;
      } catch (e) {
        lastErr = errMsg(e);
        log.warn(`attestation ${model} attempt ${attempt}: ${lastErr}`);
      }
      await sleep(2000 * attempt);
    }
    r.attest[model] = r.attest[model] ?? {
      model, nonce: r.secretHash, fetchedAt: Date.now(), signers: [], attested: [], gatewayOk: false, note: lastErr, ok: false, error: lastErr,
    };
    this.saveRound(r);
  }

  /**
   * This round's cast, prompts composed for the round's start (local time, scene). Demo bots: CAST_SIZE
   * characters whose countries follow the Western mix, each a hand-written persona of that country or a
   * person generated from the round's castSeed (src/persona/cast.ts), one level each. Botmasters' personas (AI
   * builders in the DB, and the remote-brain personas of relay/botmasters) take the builder slots: at most
   * AGENT_SLOTS_PER_LEVEL a level, round-robin over botmasters by round id (src/agents/schedule.ts).
   * CAST_SIZE 0: the personas folder as is (its remote-brain personas through the slots too).
   */
  castOf(r: RoundRec, logSlots = false): Persona[] {
    const slotted = this.slottedPersonas(r, logSlots);
    if (!r.castSeed || this.cfg.castSize <= 0) {
      return [...this.personas.filter((p) => p.brain.kind !== 'remote').map((p) => atRound(p, r.startedAt)), ...slotted];
    }
    const demo = this.personas.filter((p) => p.brain.kind === 'default' && p.person);
    return [...slotted, ...buildCast({ seed: r.castSeed, size: this.cfg.castSize, at: r.startedAt, hand: demo, pins: this.cfg.castPins })];
  }

  /** Every persona that may take a builder slot now: approved AI builders' personas and the folder's remote-brain ones. */
  slotCandidates(at = Date.now()): Persona[] {
    const remote = this.personas.filter((p) => p.brain.kind === 'remote').map((p) => atRound(p, at));
    return [...remote, ...this.agentPersonas()];
  }

  /** A round's builder slots: each candidate that took one, at the levels where it did. */
  private slottedPersonas(r: RoundRec, logSlots = false): Persona[] {
    const cands = this.slotCandidates(r.startedAt);
    const picks = slotsOfRound(r.id, cands.map(slotCandidate), this.cfg.agentSlotsPerLevel);
    if (logSlots && cands.length) log.info(describeSlots(r.id, picks, this.cfg.agentSlotsPerLevel));
    const levels = levelsByPersona(picks);
    return cands.filter((p) => levels.has(p.id)).map((p) => ({ ...p, levels: levels.get(p.id)! }));
  }

  /** A botmaster's next three rounds with a builder slot, and the levels, as of now (GET /api/botmaster/me). */
  scheduleOf(owner: string, count = 3): { slotsPerLevel: number; nextRounds: { roundId: number; levels: Level[] }[] } {
    const from = (this.current?.id ?? this.db.maxRoundId()) + 1;
    const cands = this.slotCandidates().map(slotCandidate);
    return { slotsPerLevel: this.cfg.agentSlotsPerLevel, nextRounds: nextRoundsOf(owner, from, cands, this.cfg.agentSlotsPerLevel, count) };
  }

  /**
   * AI builders' approved personas of active botmasters (docs/agents.md): candidates for the builder slots,
   * each with its own prompt committed by sha256 when it plays, its Turing bonus paid to its botmaster's
   * payout account.
   */
  agentPersonas(): Persona[] {
    if (!this.agents) return [];
    const taken = new Set(this.personas.map((p) => p.id));
    const out: Persona[] = [];
    for (const { persona, botmaster } of this.agents.activePersonas()) {
      if (taken.has(persona.id)) {
        log.warn(`persona ${persona.id} of ${botmaster.name} has the id of a folder persona; skipped`);
        continue;
      }
      if (!MODELS[persona.model]?.multiSystem) {
        log.warn(`persona ${persona.id} of ${botmaster.name}: model ${persona.model} is not one the relay runs; skipped`);
        continue;
      }
      out.push(personaOfAgent(persona, botmaster));
    }
    return out;
  }

  /** The persona a bot character plays: its committed snapshot, else (older rounds) the personas folder. */
  personaOf(c: CharacterRec): Persona | undefined {
    if (c.persona && c.prompt && c.promptHash) return { ...c.persona, prompt: c.prompt, promptHash: c.promptHash, card: c.card };
    const p = this.personas.find((x) => x.id === c.personaId);
    // a round committed before snapshots (or before a persona file changed): always the committed prompt,
    // and no card, since the folder's attributes may not describe that prompt
    return p && c.prompt && c.promptHash ? { ...p, prompt: c.prompt, promptHash: c.promptHash, card: c.card } : p;
  }

  private addBotCharacter(r: RoundRec, p: Persona, level: Level, signers: string[]): CharacterRec {
    const id = newCharacterId();
    const salt = newSalt();
    const sorted = normalizeSigners(signers);
    const payout = p.payout ?? this.chain.accounts.bots;
    const preimage = botPreimage({ roundId: r.id, characterId: id, model: p.model, promptHash: p.promptHash, signers: sorted, payout, salt });
    // the snapshot is what the bot runs on in this round, whatever happens to relay/personas meanwhile
    const { prompt: _prompt, promptHash: _hash, card, ...snapshot } = p;
    void _prompt;
    void _hash;
    const c: CharacterRec = {
      id, roundId: r.id, kind: 'bot', level, personaId: p.id, model: p.model, prompt: p.prompt, promptHash: p.promptHash, persona: snapshot, card,
      signers: sorted, payout, salt, preimage, commitment: commitmentOf(preimage), commitStatus: 'pending', createdAt: Date.now(),
    };
    this.chars.get(r.id)!.set(id, c);
    this.saveChar(c);
    return c;
  }

  humanChar(r: RoundRec, account: string): CharacterRec | undefined {
    for (const c of this.chars.get(r.id)?.values() ?? []) if (c.kind === 'human' && c.account === account) return c;
    return undefined;
  }

  /** First connect of a player in a round: their human character (payout own account if balance > 0, else promo). */
  async ensureHuman(account: string): Promise<void> {
    const r = this.current;
    if (!r || (r.status !== 'open' && r.status !== 'closing') || Date.now() >= r.endsAt - 5000) return;
    if (!this.isPlayer(account) || this.humanChar(r, account) || this.creatingHuman.has(account)) return;
    this.creatingHuman.add(account);
    try {
      let bal = 0n;
      try {
        bal = await this.balanceOf(account, 0);
      } catch (e) {
        log.warn(`balance of ${account} unavailable, payout to promo: ${errMsg(e)}`);
      }
      if (this.humanChar(r, account)) return;
      const id = newCharacterId();
      const salt = newSalt();
      const payout = bal > 0n ? account : this.chain.accounts.promo;
      const preimage = humanPreimage({ roundId: r.id, characterId: id, account, payout, salt });
      const c: CharacterRec = {
        id, roundId: r.id, kind: 'human', account, payout, salt, preimage, commitment: commitmentOf(preimage),
        commitStatus: 'pending', createdAt: Date.now(),
      };
      this.chars.get(r.id)!.set(id, c);
      this.saveChar(c);
      log.info(`round ${r.id}: human character for ${account}, payout ${payout}`);
      if (r.startOk) this.scheduleCommit(r);
    } finally {
      this.creatingHuman.delete(account);
    }
  }

  private scheduleCommit(r: RoundRec): void {
    if (this.commitTimers.has(r.id)) return;
    this.commitTimers.set(
      r.id,
      setTimeout(() => {
        this.commitTimers.delete(r.id);
        void this.flushCommits(r);
      }, 300),
    );
  }

  /** Commit every pending character of the round, in batches, one commit tx at a time. */
  private flushCommits(r: RoundRec): Promise<void> {
    const prev = this.commitChains.get(r.id) ?? Promise.resolve();
    const next = prev.then(() => this.doFlushCommits(r)).catch((e) => log.error(`commit round ${r.id}`, e));
    this.commitChains.set(r.id, next);
    return next;
  }

  private async doFlushCommits(r: RoundRec): Promise<void> {
    const cm = this.chars.get(r.id);
    if (!cm || !r.startOk) return;
    for (let guard = 0; guard < 20; guard++) {
      const pend = [...cm.values()].filter((c) => c.commitStatus === 'pending');
      if (pend.length === 0) return;
      if (Date.now() >= r.endsAt - 2000 || this.stopped) {
        for (const c of pend) c.commitStatus = 'failed';
        return;
      }
      const batch = pend.slice(0, 40);
      for (const c of batch) c.commitStatus = 'sending';
      const res = await this.chain.commitCharacters(r.id, batch.map((c) => ({ character_id: c.id, commitment: c.commitment })));
      if (res.ok) {
        for (const c of batch) {
          c.commitStatus = 'committed';
          c.commitTx = res.hash;
          this.saveChar(c);
        }
        r.commitTxs.push(res.hash);
        this.saveRound(r);
        this.broadcast({ t: 'round', round: this.roundState(r) });
        this.kickSearches();
      } else {
        log.warn(`round ${r.id} commit of ${batch.length} failed: ${res.error}`);
        // some may have landed in an earlier attempt
        for (const c of batch) {
          const onChain = await this.chain.getCharacter(r.id, c.id).catch(() => null);
          if (onChain && onChain.commitment === c.commitment) {
            c.commitStatus = 'committed';
            c.commitTx = c.commitTx ?? res.hash;
          } else c.commitStatus = 'pending';
          this.saveChar(c);
        }
        await sleep(3000);
      }
    }
  }

  private async endRound(r: RoundRec): Promise<void> {
    if (r.status === 'settling' || r.status === 'settled') return;
    for (const t of this.roundTimers.get(r.id) ?? []) clearTimeout(t);
    r.status = 'settling';
    this.saveRound(r);
    this.cancelRoundSearches(r, 'round_closed');
    const graceEnd = r.endsAt + this.chainCfg.callGraceMs - 8000;
    for (const conv of this.convs.values()) {
      if (conv.roundId !== r.id || conv.ended) continue;
      const window = Math.max(5000, Math.min(this.cfg.callSeconds * 1000, graceEnd - Date.now()));
      this.endConv(conv, 'round_end', window);
    }
    log.info(`round ${r.id} ended; settling in the background`);
    if (this.current === r) {
      this.current = null;
      if (this.stopped) {
        /* shutting down */
      } else if (this.betaClosedNow) log.info(`beta closed: round ${r.id} settles, no new round`);
      else if (this.isIdle()) log.info(`idle: no human connected for ${this.cfg.idleMinutes} min; no new round until one connects`);
      else await this.startRound();
    }
    void this.settle(r);
  }

  /** Test mode: force-end chats with a short call window, end_round_now, start the next round, settle. */
  async devEndRound(): Promise<void> {
    if (!this.cfg.testMode || !this.chainCfg.testMode) throw new GameError('not_test_mode', 'dev end-round needs test mode', 403);
    this.markHuman(true); // a tester is here
    const r = this.current;
    if (!r) {
      // idle: nothing to end; a fresh round is what the caller is after (not with the beta closed)
      if (!this.stopped && !this.betaClosedNow) await this.startRound();
      return;
    }
    if (r.endedEarly || r.status === 'settling' || r.status === 'settled') return;
    r.endedEarly = true;
    r.status = 'closing';
    for (const t of this.roundTimers.get(r.id) ?? []) clearTimeout(t);
    this.saveRound(r);
    this.broadcast({ t: 'round', round: this.roundState(r) });
    this.cancelRoundSearches(r, 'round_closed');
    const callMs = this.cfg.devCallSeconds * 1000;
    for (const conv of this.convs.values()) if (conv.roundId === r.id && !conv.ended) this.endConv(conv, 'round_end', callMs);
    log.info(`round ${r.id}: dev end-round requested`);
    void (async () => {
      try {
        const until = Date.now() + callMs + this.cfg.callSeconds * 1000 + 15_000;
        while (Date.now() < until && this.roundSides(r.id).some((s) => s.phase === 'calling' || s.phase === 'placing' || s.phase === 'chatting')) await sleep(250);
        await this.drainPending(r.id);
        if (r.startOk) {
          for (let i = 0; i < 5; i++) {
            const res = await this.chain.endRoundNow(r.id);
            if (res.ok) break;
            const cr = await this.chain.getRound(r.id).catch(() => null);
            if (cr && cr.endsAtMs + this.chainCfg.callGraceMs < Date.now()) break;
            log.warn(`end_round_now failed: ${res.error}`);
            await sleep(2000);
          }
        }
        r.status = 'settling';
        this.saveRound(r);
        if (this.current === r) {
          this.current = null;
          if (!this.betaClosedNow) await this.startRound();
        }
        await this.settle(r);
      } catch (e) {
        log.error(`dev end-round of ${r.id}`, e);
      }
    })();
  }

  private roundSides(roundId: number): ChatSide[] {
    return [...this.sides.values()].filter((s) => s.roundId === roundId);
  }

  private track(roundId: number, p: Promise<unknown>): void {
    let set = this.pending.get(roundId);
    if (!set) this.pending.set(roundId, (set = new Set()));
    set.add(p);
    void p.finally(() => set!.delete(p));
  }

  private async drainPending(roundId: number): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const set = this.pending.get(roundId);
      if (!set || set.size === 0) return;
      await Promise.allSettled([...set]);
    }
  }

  // =====================================================================================
  // settlement: reveal, open, settle, results, bundles
  // =====================================================================================

  settle(r: RoundRec): Promise<void> {
    const existing = this.settling.get(r.id);
    if (existing) return existing;
    const p = this.doSettle(r).finally(() => this.settling.delete(r.id));
    this.settling.set(r.id, p);
    return p;
  }

  private async doSettle(r: RoundRec): Promise<void> {
    for (let attempt = 0; !this.stopped; attempt++) {
      try {
        // calls finish: every side terminal and every play/call tx done
        const until = r.endedEarly ? Date.now() + 60_000 : r.endsAt + this.chainCfg.callGraceMs - 3000;
        while (Date.now() < until && this.roundSides(r.id).some((s) => s.phase !== 'called' && s.phase !== 'missed')) await sleep(500);
        for (const s of this.roundSides(r.id)) if (s.phase === 'calling') this.markMissed(s);
        for (const conv of this.convs.values()) if (conv.roundId === r.id && !conv.ended) this.endConv(conv, 'round_end', 1000);
        await this.drainPending(r.id);

        if (r.startOk) {
          const cr = await this.chain.getRound(r.id);
          if (!cr) throw new Error(`round ${r.id} is not on chain`);
          if (!cr.revealed) {
            const wait = cr.endsAtMs + this.chainCfg.callGraceMs + 2500 - Date.now();
            if (wait > 0) await sleep(wait);
            const res = await this.chain.revealRound(r.id, r.secret);
            if (!res.ok) throw new Error(`reveal_round: ${res.error}`);
            r.revealTx = res.hash;
            this.saveRound(r);
            log.info(`round ${r.id} revealed ${res.hash}`);
          }
          // bots finish their signatures and seal completions before the openings are built
          await Promise.all([...this.bots.values()].filter((b) => b.side.roundId === r.id).map((b) => b.settled()));
          if (!cr.settled) {
            await this.openAll(r);
            const res = await this.chain.settleRound(r.id);
            if (!res.ok) {
              const again = await this.chain.getRound(r.id);
              if (!again?.settled) throw new Error(`settle_round: ${res.error}`);
            } else r.settleTx = res.hash;
            this.saveRound(r);
            log.info(`round ${r.id} settled ${res.hash}`);
          }
        }
        let stats: RoundStats | undefined;
        if (!r.resultsDone) stats = await this.computeAndStore(r);
        r.status = 'settled';
        r.settledAt = r.settledAt ?? Date.now();
        r.lastError = undefined;
        this.saveRound(r);
        this.forgetRound(r);
        this.broadcast({ t: 'results_ready', roundId: r.id });
        for (const account of this.conns.keys()) void this.pushMe(account);
        log.info(`round ${r.id} results ready`);
        // the round's summary on Telegram, in the background: never waited for, never throws. A round whose results
        // were stored before a restart has no stats here, so it is never summed up twice
        if (stats) void this.telegram.roundSettled(stats, !!this.current && this.current.id > r.id);
        // results, ratings and bundles are stored: the chain may now free the round's storage
        setTimeout(() => void this.pruneSettled(), this.cfg.pruneDelaySeconds * 1000 + 200).unref?.();
        return;
      } catch (e) {
        r.lastError = errMsg(e);
        this.saveRound(r);
        const wait = Math.min(60_000, 3000 * 2 ** Math.min(attempt, 5));
        log.error(`settlement of round ${r.id} (attempt ${attempt + 1}) failed, retrying in ${wait} ms`, e);
        await sleep(wait);
      }
    }
  }

  private buildOpening(r: RoundRec, c: CharacterRec, proofIdx: Map<string, number>): Opening {
    // a chat that never started (aborted) is in no opening: its play stays unassigned and is refunded
    const paidSides = this.roundSides(r.id).filter((s) => s.characterId === c.id && s.playStatus === 'placed' && !s.aborted);
    if (c.kind === 'bot') {
      const proofs = [];
      for (const s of paidSides) {
        const last = lastSignedCompletion(this.db.loadCompletions(s.chatId));
        if (!last) {
          log.warn(`round ${r.id}: paid chat ${s.chatId} has no signed completion; its play will be refunded`);
          continue;
        }
        const sig = JSON.parse(last.signature!);
        proofs.push({ viewer: s.viewer, text: sig.text, signature: sig.signature, request: last.request });
        proofIdx.set(s.chatId, last.idx);
      }
      return { character_id: c.id, kind: 'bot', salt: c.salt, payout: c.payout, model: c.model, prompt_hash: c.promptHash, signers: c.signers, proofs };
    }
    return { character_id: c.id, kind: 'human', salt: c.salt, payout: c.payout, account: c.account, viewers: paidSides.map((s) => s.viewer) };
  }

  private async openAll(r: RoundRec): Promise<void> {
    const cm = this.chars.get(r.id) ?? new Map();
    const todo = [...cm.values()].filter((c) => c.commitStatus === 'committed' && !c.openReport);
    if (todo.length === 0) return;
    const proofIdx = new Map<string, number>();
    const openings = todo.map((c) => this.buildOpening(r, c, proofIdx));
    this.db.setKv(`proofs:${r.id}`, JSON.stringify([...proofIdx]));
    // batches bounded by proofs and bytes
    const batches: Opening[][] = [];
    let cur: Opening[] = [];
    let proofs = 0;
    let bytes = 0;
    for (const o of openings) {
      const n = o.proofs?.length ?? 0;
      const b = JSON.stringify(o).length;
      if (cur.length && (proofs + n > 6 || bytes + b > 150_000 || cur.length >= 30)) {
        batches.push(cur);
        cur = [];
        proofs = 0;
        bytes = 0;
      }
      cur.push(o);
      proofs += n;
      bytes += b;
    }
    if (cur.length) batches.push(cur);
    const queue = [...batches];
    while (queue.length) {
      const batch = queue.shift()!;
      const res = await this.chain.openCharacters(r.id, batch);
      if (res.ok && res.reports) {
        for (const rep of res.reports) {
          const c = cm.get(rep.character_id);
          if (!c) continue;
          c.openReport = rep;
          c.openTx = res.hash;
          this.saveChar(c);
          if (!rep.ok || rep.rejected.length) log.warn(`round ${r.id} open ${c.kind} ${c.id}: ok=${rep.ok} assigned=${rep.assigned} rejected=${JSON.stringify(rep.rejected)}`);
        }
        r.openTxs.push(res.hash);
        this.saveRound(r);
        log.info(`round ${r.id} opened ${batch.length} characters in ${res.hash}`);
      } else if (batch.length > 1) {
        log.warn(`round ${r.id} open batch of ${batch.length} failed (${res.error}); splitting`);
        const half = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, half), batch.slice(half));
      } else {
        const c = cm.get(batch[0].character_id);
        log.error(`round ${r.id} open of ${batch[0].character_id} failed: ${res.error}`);
        if (c) {
          c.openReport = { character_id: c.id, ok: false, assigned: 0, rejected: [`tx failed: ${res.error}`] };
          if (res.hash) c.openTx = res.hash;
          this.saveChar(c);
        }
      }
    }
  }

  /** Results, ratings and bundles in one transaction; returns the round's counts for its Telegram summary. */
  private async computeAndStore(r: RoundRec): Promise<RoundStats> {
    const characters = [...(this.chars.get(r.id)?.values() ?? [])];
    const sides = this.roundSides(r.id);
    const chainPlays = r.startOk ? await this.chain.getRoundPlays(r.id) : [];
    const verifiable = new Set<string>();
    for (const s of sides) if (s.partnerKind === 'bot' && lastSignedCompletion(this.db.loadCompletions(s.chatId))) verifiable.add(s.chatId);
    r.settledAt = r.settledAt ?? Date.now();
    const out = computeResults({
      round: r, characters, sides, chainPlays, users: this.users, coinUnit: this.coinUnit, presets: PRESETS,
      promo: this.chain.accounts.promo, verifiable,
    });
    const proofIdx = new Map<string, number>(JSON.parse(this.db.getKv(`proofs:${r.id}`) ?? '[]'));
    // AI builders: every settled chat of their personas, players anonymised, the chat's share of the Turing bonus
    const agentChats = this.agents
      ? agentChatsOf({ round: r, characters, sides, chainPlays, coinUnit: this.coinUnit, anonSecret: this.agents.anonSecret() })
      : [];
    const sql = this.db.sql;
    sql.exec('BEGIN');
    try {
      for (const a of agentChats) this.agents!.saveChat(a);
      for (const [account, res] of out.results) this.db.saveResult(r.id, account, res);
      for (const row of out.ratingRows) this.db.addRating(r.id, row.account, row.chatId, row.before, row.after, row.at);
      for (const [account, u] of out.users) {
        this.users.set(account, u);
        this.saveUser(u);
      }
      for (const s of sides) {
        if (s.partnerKind !== 'bot') continue;
        const c = characters.find((x) => x.id === s.characterId);
        if (!c) continue;
        const persona = this.personaOf(c);
        const bundle = buildBundle({
          round: r, side: s, character: c, personaPrompt: c.prompt ?? persona?.prompt ?? '',
          completions: this.db.loadCompletions(s.chatId), messages: s.messages as StoredMsg[],
          attest: c.model ? r.attest[c.model] : undefined, proofCompletionIndex: proofIdx.get(s.chatId),
        });
        this.db.saveBundle(s.chatId, r.id, bundle);
      }
      r.resultsDone = true;
      this.saveRound(r);
      sql.exec('COMMIT');
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
    for (const [account, amt] of out.lockedBonusAdded) log.info(`round ${r.id}: ${account} earned a locked Turing bonus of ${unitsToCoins(amt, this.coinUnit)} coins (held by promo)`);
    return roundStats(r.id, sides, characters, chainPlays, this.coinUnit, this.telegram.own);
  }

  /** Drop a settled round from memory; the DB keeps everything. */
  private forgetRound(r: RoundRec): void {
    for (const s of this.roundSides(r.id)) {
      this.sides.delete(s.chatId);
      this.seatIndex.delete(this.seatKey(r.id, s.viewer, s.level, s.seatIndex));
      this.bots.delete(s.chatId);
      this.lastSay.delete(s.chatId);
      const t = this.missTimers.get(s.chatId);
      if (t) clearTimeout(t);
      this.missTimers.delete(s.chatId);
    }
    for (const [id, c] of this.convs) if (c.roundId === r.id) this.convs.delete(id);
    for (const k of [...this.unavailable]) if (k.startsWith(`${r.id}|`)) this.unavailable.delete(k);
    this.chars.delete(r.id);
    this.rounds.delete(r.id);
    this.pending.delete(r.id);
    this.commitChains.delete(r.id);
  }

  // =====================================================================================
  // connections
  // =====================================================================================

  async connect(conn: Conn): Promise<void> {
    const a = conn.account;
    let set = this.conns.get(a);
    if (!set) this.conns.set(a, (set = new Set()));
    set.add(conn);
    const lt = this.leftTimers.get(a);
    if (lt) {
      clearTimeout(lt);
      this.leftTimers.delete(a);
    }
    const wasIdle = !this.current && this.cfg.idleMinutes > 0 && Date.now() - this.lastHumanAt >= this.cfg.idleMinutes * 60_000;
    this.markHuman(true);
    if (!this.current && !this.stopped && !this.betaClosedNow) {
      // idle (or between rounds): a human is here, so a round starts now and the welcome shows it
      if (wasIdle) log.info(`${a} connected while idle; starting a round`);
      await this.startRound().catch((e) => log.error(`round start on connect of ${a}`, e));
    }
    void this.ensureHuman(a).catch((e) => log.warn(`ensureHuman ${a}`, e));
    try {
      const me = await this.me(a);
      conn.send({ t: 'welcome', me, round: this.roundState(), config: this.publicConfig, activeChat: this.activeChatOf(a) });
      // a reload while a play or call waits for this browser's signature: ask again
      for (const p of this.signReqs.values()) if (p.account === a && p.sessionId === conn.sessionId) conn.send(p.msg);
    } catch (e) {
      log.error(`welcome for ${a}`, e);
      conn.send({ t: 'error', code: 'welcome_failed', message: errMsg(e) });
    }
  }

  disconnect(conn: Conn): void {
    const a = conn.account;
    const set = this.conns.get(a);
    set?.delete(conn);
    if (set && set.size > 0) return;
    this.conns.delete(a);
    this.markHuman(true); // connected until now: the idle clock starts here
    if (this.searches.has(a)) this.cancelSearch(a, false);
    const live = [...this.sides.values()].filter((s) => s.viewer === a && s.partnerKind === 'human' && (s.phase === 'placing' || s.phase === 'chatting'));
    if (live.length === 0) return;
    this.leftTimers.set(
      a,
      setTimeout(() => {
        this.leftTimers.delete(a);
        if (this.conns.has(a)) return;
        for (const s of live) {
          const conv = this.convs.get(s.convId);
          if (conv && !conv.ended) {
            log.info(`${a} left chat ${s.chatId} for ${this.cfg.partnerLeftSeconds} s: partner_left`);
            this.endConv(conv, 'partner_left', this.cfg.callSeconds * 1000);
          }
        }
      }, this.cfg.partnerLeftSeconds * 1000),
    );
  }

  /** Signed out: the session's sockets close and its pending signature requests end. */
  closeSession(account: string, sessionId: string): void {
    for (const p of [...this.signReqs.values()]) if (p.sessionId === sessionId) p.resolve({ ok: false, error: 'signed out' });
    for (const c of [...(this.conns.get(account) ?? [])]) if (c.sessionId === sessionId) c.close(4001, 'signed out');
  }

  sendTo(account: string, msg: ServerMsg): void {
    for (const c of this.conns.get(account) ?? []) {
      try {
        c.send(msg);
      } catch (e) {
        log.debug(`send to ${account} failed: ${errMsg(e)}`);
      }
    }
  }

  broadcast(msg: ServerMsg): void {
    for (const a of this.conns.keys()) this.sendTo(a, msg);
  }

  /** New round: every connection gets a fresh room (new skins) for the level it was looking at. */
  private pushRooms(): void {
    for (const [account, set] of this.conns) {
      for (const c of set) {
        if (!c.level) continue;
        try {
          c.send(this.roomMsg(account, c.level));
        } catch {
          /* closed */
        }
      }
    }
  }

  async pushMe(account: string): Promise<void> {
    if (!this.conns.has(account)) return;
    try {
      this.sendTo(account, { t: 'me', me: await this.me(account, 0) });
    } catch (e) {
      log.debug(`me for ${account}: ${errMsg(e)}`);
    }
  }

  async onMessage(conn: Conn, raw: unknown): Promise<void> {
    const a = conn.account;
    const msg = raw as ClientMsg;
    if (!msg || typeof msg !== 'object' || typeof (msg as any).t !== 'string') {
      conn.send({ t: 'error', code: 'bad_message', message: 'expected a JSON object with t' });
      return;
    }
    try {
      switch (msg.t) {
        case 'ping':
          conn.send({ t: 'pong' });
          return;
        case 'enter_room':
          this.assertLevel(msg.level);
          conn.level = msg.level;
          conn.send(this.roomMsg(a, msg.level));
          return;
        case 'pick_seat':
          await this.pickSeat(a, msg.level, msg.seatIndex, msg.mode, msg.coins, conn.sessionId);
          return;
        case 'signed_tx':
          this.onSigned(conn, msg.reqId, msg.signedTx);
          return;
        case 'sign_declined':
          this.onSignDeclined(conn, msg.reqId, msg.reason);
          return;
        case 'cancel_search':
          this.cancelSearch(a, true);
          return;
        case 'say':
          this.say(a, msg.chatId, msg.text);
          return;
        case 'typing':
          this.typing(a, msg.chatId, !!msg.on);
          return;
        case 'call':
          this.call(a, msg.chatId, msg.human);
          return;
        case 'dev_end_chat':
          this.devEndChat(a, msg.chatId);
          return;
        default:
          conn.send({ t: 'error', code: 'unknown_message', message: `unknown message type ${(msg as any).t}` });
      }
    } catch (e) {
      if (e instanceof GameError) conn.send({ t: 'error', code: e.code, message: e.message });
      else {
        log.error(`message ${msg.t} from ${a}`, e);
        conn.send({ t: 'error', code: 'internal', message: errMsg(e) });
      }
    }
  }

  // =====================================================================================
  // rooms and seats
  // =====================================================================================

  private assertLevel(level: unknown): asserts level is Level {
    if (!LEVELS.includes(level as Level)) throw new GameError('bad_level', 'level must be 1, 2 or 3');
  }

  private seatKey(roundId: number, viewer: string, level: number, seat: number): string {
    return `${roundId}|${viewer}|${level}|${seat}`;
  }

  seatSkin(roundId: number, viewer: string, level: Level, seat: number): Skin {
    const seed = seatSeed(this.skinSecret, roundId, viewer, level, seat);
    return { seed, name: gamertag(seed) };
  }

  seatOf(roundId: number, viewer: string, level: Level, index: number): Seat {
    const skin = this.seatSkin(roundId, viewer, level, index);
    const s = this.searches.get(viewer);
    if (s && s.roundId === roundId && s.level === level && s.seatIndex === index) return { index, skin, state: 'searching', mode: s.mode, coins: s.mode === 'paid' ? s.coins : 0 };
    const chatId = this.seatIndex.get(this.seatKey(roundId, viewer, level, index));
    const side = chatId ? this.sides.get(chatId) ?? this.db.loadChat<ChatSide>(chatId) : undefined;
    if (side) {
      if (side.phase === 'called' || side.phase === 'missed') return { index, skin, state: 'called', myCall: side.phase === 'missed' ? null : side.myCall ?? null, chatId: side.chatId, mode: side.mode, coins: side.coins };
      return { index, skin, state: 'chatting', chatId: side.chatId, mode: side.mode, coins: side.coins };
    }
    if (this.unavailable.has(this.seatKey(roundId, viewer, level, index))) return { index, skin, state: 'unavailable' };
    return { index, skin, state: 'open' };
  }

  roomMsg(viewer: string, level: Level): ServerMsg {
    const r = this.current ?? this.latestRound();
    const roundId = r?.id ?? 0;
    const seats: Seat[] = [];
    for (let i = 0; i < 10; i++) seats.push(this.seatOf(roundId, viewer, level, i));
    return { t: 'room', level, roundId, theme: themeFor(level, roundId || 1), seats };
  }

  private pushSeat(viewer: string, roundId: number, level: Level, index: number): void {
    this.sendTo(viewer, { t: 'seat', level, roundId, seat: this.seatOf(roundId, viewer, level, index) });
  }

  // =====================================================================================
  // matchmaking
  // =====================================================================================

  private levelUnlocked(u: UserRec | undefined): Level {
    if (this.cfg.testMode) return 3;
    if (!u) return 1;
    if (u.rating >= 1250) return 3;
    if (u.rating >= 1100 || u.chats >= 10) return 2;
    return 1;
  }

  private freeLeft(u: UserRec): number | null {
    if (this.cfg.freeChatsPerDay <= 0) return null;
    const used = u.freeDay === utcDay() ? u.freeUsed : 0;
    return Math.max(0, this.cfg.freeChatsPerDay - used);
  }

  async pickSeat(account: string, level: Level, seatIndex: number, mode: Mode, coins?: number, sessionId?: string): Promise<void> {
    this.assertLevel(level);
    const r = this.current;
    const now = Date.now();
    if (!r || r.status !== 'open' || now >= r.acceptingUntil) throw new GameError('round_closed', 'no new chats in this round; the next round starts soon');
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 9) throw new GameError('bad_seat', 'seatIndex must be 0..9');
    if (mode !== 'free' && mode !== 'paid') throw new GameError('bad_mode', 'mode must be free or paid');
    const user = this.users.get(account);
    if (!user || !this.isPlayer(account)) throw new GameError('unknown_user', 'sign in first', 403);
    if (mode === 'paid') {
      if (!this.chainCfg.coinsOpen) throw new GameError('coins_closed', 'Coins open when REAL launches. Play free for now.');
      // a wallet account's play and call are signed by its browser's play key, never by the relay
      if (!this.relaySigns(account)) {
        const key = this.auth?.byId(sessionId)?.playKey;
        if (!key) throw new GameError('play_key_missing', 'One approval in your wallet first, then your plays and calls run without popups.');
        if (key.status !== 'active') throw new GameError('play_key_exhausted', "This browser's play key used up its gas allowance: one approval in your wallet adds a fresh one.");
      }
    }
    if (level > this.levelUnlocked(user)) throw new GameError('level_locked', `level ${level} is locked`);
    if (this.searches.has(account)) throw new GameError('already_searching', 'already searching');
    const busy = [...this.sides.values()].find((s) => s.viewer === account && (s.phase === 'placing' || s.phase === 'chatting' || s.phase === 'calling'));
    if (busy) throw new GameError('busy', 'finish your current chat first');
    const seat = this.seatOf(r.id, account, level, seatIndex);
    if (seat.state !== 'open') throw new GameError('seat_taken', `seat is ${seat.state}`);
    // the beta is over (its NEAR AI spend cap): no new chats; the client shows the end and moves on
    if (this.betaClosedNow) {
      this.sendTo(account, { t: 'error', code: 'beta_closed', message: BETA_CLOSED });
      this.pushSeat(account, r.id, level, seatIndex);
      return;
    }
    // no bots, no new chats: nobody is matched while no bot could talk, humans included
    if (this.chatsPaused(r, level)) {
      this.sendTo(account, { t: 'error', code: 'bots_unavailable', message: BOTS_UNAVAILABLE });
      this.pushSeat(account, r.id, level, seatIndex);
      return;
    }
    let c = 0;
    if (mode === 'paid') {
      c = Number(coins);
      if (!Number.isInteger(c) || c < this.chainCfg.minCoins || c > this.chainCfg.maxCoins) {
        throw new GameError('bad_coins', `coins must be a whole number from ${this.chainCfg.minCoins} to ${this.chainCfg.maxCoins}`);
      }
      const bal = await this.balanceOf(account, 0);
      if (bal < BigInt(c) * this.coinUnit) throw new GameError('insufficient_balance', 'not enough coins; deposit first');
      if (this.searches.has(account)) throw new GameError('already_searching', 'already searching');
    } else {
      const left = this.freeLeft(user);
      if (left !== null && left <= 0) throw new GameError('free_limit', 'no free chats left today');
    }
    const [lo, hi] = this.cfg.searchDelay;
    const delay = uniform(lo * 1000, hi * 1000);
    const s: Search = { account, roundId: r.id, level, seatIndex, mode, coins: c, startedAt: now, deadline: now + delay, timer: null, resolving: false, sessionId };
    s.timer = setTimeout(() => void this.resolveSearch(account), delay);
    this.searches.set(account, s);
    this.sendTo(account, { t: 'searching', level, seatIndex });
    this.pushSeat(account, r.id, level, seatIndex);
  }

  cancelSearch(account: string, notify: boolean): void {
    const s = this.searches.get(account);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    this.searches.delete(account);
    if (notify) this.pushSeat(account, s.roundId, s.level, s.seatIndex);
  }

  private cancelRoundSearches(r: RoundRec, code: string): void {
    for (const s of [...this.searches.values()]) {
      if (s.roundId !== r.id) continue;
      this.cancelSearch(s.account, true);
      this.sendTo(s.account, { t: 'error', code, message: 'the round is closing; try again in the next round' });
    }
  }

  /** Re-check searches that were waiting for commitments. */
  private kickSearches(): void {
    for (const s of this.searches.values()) {
      if (Date.now() >= s.deadline && !s.resolving) {
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(() => void this.resolveSearch(s.account), 0);
      }
    }
  }

  private viewerChatted(roundId: number, viewer: string, characterId: string): boolean {
    for (const s of this.sides.values()) if (s.roundId === roundId && s.viewer === viewer && s.characterId === characterId) return true;
    return false;
  }

  private async resolveSearch(account: string): Promise<void> {
    const s = this.searches.get(account);
    if (!s || s.resolving) return;
    const r = this.rounds.get(s.roundId);
    if (!r || r !== this.current || r.status !== 'open' && r.status !== 'closing') {
      this.cancelSearch(account, true);
      this.sendTo(account, { t: 'error', code: 'round_closed', message: 'the round closed' });
      return;
    }
    if (this.chatsPaused(r, s.level)) {
      // the pause began during the search: it ends here, like one refused at pick_seat
      this.cancelSearch(account, false);
      this.sendTo(account, { t: 'error', code: 'bots_unavailable', message: BOTS_UNAVAILABLE });
      this.pushSeat(account, r.id, s.level, s.seatIndex);
      return;
    }
    const pendingHuman = (a: string) => {
      const c = this.humanChar(r, a);
      return !!c && (c.commitStatus === 'pending' || c.commitStatus === 'sending');
    };
    const others = [...this.searches.values()].filter((o) => o.account !== account && o.roundId === s.roundId && !this.chatsPaused(r, o.level));
    const waiting = !r.ready || pendingHuman(account) || others.some((o) => pendingHuman(o.account));
    if (waiting && Date.now() < s.deadline + 20_000) {
      s.timer = setTimeout(() => void this.resolveSearch(account), 500);
      return;
    }
    s.resolving = true;
    const mine = this.humanChar(r, account);
    const committed = (c?: CharacterRec) => !!c && c.commitStatus === 'committed';
    const humans = committed(mine)
      ? others.filter((o) => {
          const theirs = this.humanChar(r, o.account);
          return committed(theirs) && !this.viewerChatted(r.id, account, theirs!.id) && !this.viewerChatted(r.id, o.account, mine!.id);
        })
      : [];
    if (humans.length > 0) {
      const same = humans.filter((o) => o.level === s.level);
      const other = pick(same.length ? same : humans);
      this.pairHumans(r, s, other);
      return;
    }
    const eligible = [...(this.chars.get(r.id)?.values() ?? [])].filter(
      (c) => c.kind === 'bot' && c.level === s.level && c.commitStatus === 'committed' && !this.viewerChatted(r.id, account, c.id) && this.ownerActive(c),
    );
    // never a bot whose NEAR AI key is out of credits: it could not say a word
    let bots = eligible.filter((c) => this.botUsable(c));
    if (s.mode === 'free' && bots.length) {
      const cheapest = Math.min(...bots.map((c) => chatCostUsd(c.model!)));
      bots = bots.filter((c) => chatCostUsd(c.model!) === cheapest);
    }
    this.searches.delete(account);
    if (bots.length === 0) {
      this.unavailable.add(this.seatKey(r.id, account, s.level, s.seatIndex));
      this.sendTo(account, { t: 'error', code: 'room_empty', message: 'nobody left to meet in this room this round' });
      this.pushSeat(account, r.id, s.level, s.seatIndex);
      return;
    }
    this.startBotChat(r, s, this.botPicker?.(account, bots) ?? pick(bots));
  }

  // =====================================================================================
  // chats
  // =====================================================================================

  private registerSide(side: ChatSide): void {
    this.sides.set(side.chatId, side);
    this.seatIndex.set(this.seatKey(side.roundId, side.viewer, side.level, side.seatIndex), side.chatId);
  }

  private saveSide(side: ChatSide): void {
    const { messages, ...rest } = side;
    void messages;
    this.db.saveChat(side.chatId, side.roundId, side.viewer, side.convId, rest);
  }

  private newSide(r: RoundRec, s: Search, c: CharacterRec, convId: string): ChatSide {
    const skin = this.seatSkin(r.id, s.account, s.level, s.seatIndex);
    const handle = handleOf(r.id, c.id, s.account, r.secret);
    const tag = chatTag(handle);
    const side: ChatSide = {
      chatId: randomId(10),
      convId,
      roundId: r.id,
      viewer: s.account,
      level: s.level,
      seatIndex: s.seatIndex,
      theme: themeFor(s.level, r.id),
      skin,
      characterId: c.id,
      partnerKind: c.kind,
      partnerAccount: c.kind === 'human' ? c.account : undefined,
      personaId: c.personaId,
      model: c.model,
      requestedMode: s.mode,
      mode: s.mode,
      coins: s.mode === 'paid' ? s.coins : 0,
      handle,
      tag,
      skinMessage: c.kind === 'bot' ? skinMessage(skin.name, tag) : undefined,
      phase: 'placing',
      createdAt: Date.now(),
      callStatus: 'none',
      playStatus: s.mode === 'paid' ? 'pending' : 'none',
      messages: [],
      ...(s.sessionId ? { sessionId: s.sessionId } : {}),
    };
    if (s.mode === 'free') {
      const u = this.users.get(s.account);
      if (u) {
        if (u.freeDay !== utcDay()) {
          u.freeDay = utcDay();
          u.freeUsed = 0;
        }
        u.freeUsed++;
        this.saveUser(u);
      }
    }
    this.registerSide(side);
    this.saveSide(side);
    return side;
  }

  chatInfo(side: ChatSide): ChatInfo {
    return {
      chatId: side.chatId,
      roundId: side.roundId,
      level: side.level,
      seatIndex: side.seatIndex,
      theme: side.theme,
      partner: side.skin,
      mode: side.mode,
      coins: side.mode === 'paid' ? side.coins : 0,
      startedAt: side.startedAt,
      endsAt: side.endsAt,
    };
  }

  private publicMsg(m: StoredMsg): ChatMessage {
    return { id: m.id, from: m.from, text: m.text, at: m.at };
  }

  activeChatOf(account: string): ActiveChat | undefined {
    let best: ChatSide | undefined;
    for (const s of this.sides.values()) {
      if (s.viewer !== account) continue;
      if (s.phase !== 'placing' && s.phase !== 'chatting' && s.phase !== 'calling') continue;
      if (!best || s.createdAt > best.createdAt) best = s;
    }
    if (!best) return undefined;
    return {
      ...this.chatInfo(best),
      phase: best.phase,
      messages: (best.messages as StoredMsg[]).map((m) => this.publicMsg(m)),
      callDeadline: best.callDeadline,
      myCall: best.myCall,
    };
  }

  private startBotChat(r: RoundRec, s: Search, c: CharacterRec): void {
    const conv: Conv = { id: randomId(8), roundId: r.id, kind: 'bot', sides: [], started: false, ended: false, endTimer: null };
    const side = this.newSide(r, s, c, conv.id);
    conv.sides.push(side.chatId);
    this.convs.set(conv.id, conv);
    log.info(`match ${side.chatId}: ${s.account} (${s.mode}${s.mode === 'paid' ? ` ${s.coins}` : ''}) with bot ${c.personaId} at L${s.level}`);
    this.sendTo(side.viewer, { t: 'matched', chat: this.chatInfo(side) });
    this.pushSeat(side.viewer, r.id, side.level, side.seatIndex);
    if (side.playStatus === 'pending') this.placePlay(conv, side);
    else this.maybeStart(conv);
  }

  private pairHumans(r: RoundRec, a: Search, b: Search): void {
    if (b.timer) clearTimeout(b.timer);
    this.searches.delete(a.account);
    this.searches.delete(b.account);
    const ca = this.humanChar(r, a.account)!;
    const cb = this.humanChar(r, b.account)!;
    const conv: Conv = { id: randomId(8), roundId: r.id, kind: 'human', sides: [], started: false, ended: false, endTimer: null };
    const sa = this.newSide(r, a, cb, conv.id);
    const sb = this.newSide(r, b, ca, conv.id);
    sa.partnerChatId = sb.chatId;
    sb.partnerChatId = sa.chatId;
    this.saveSide(sa);
    this.saveSide(sb);
    conv.sides.push(sa.chatId, sb.chatId);
    this.convs.set(conv.id, conv);
    log.info(`match ${sa.chatId}/${sb.chatId}: ${a.account} (${a.mode}) with ${b.account} (${b.mode})`);
    for (const side of [sa, sb]) {
      this.sendTo(side.viewer, { t: 'matched', chat: this.chatInfo(side) });
      this.pushSeat(side.viewer, r.id, side.level, side.seatIndex);
    }
    for (const side of [sa, sb]) if (side.playStatus === 'pending') this.placePlay(conv, side);
    this.maybeStart(conv);
  }

  private placePlay(conv: Conv, side: ChatSide): void {
    this.sendTo(side.viewer, { t: 'placing', chatId: side.chatId });
    const p = (async () => {
      let res: { ok: boolean; hash: string; error?: string };
      try {
        // test users: the relay signs with their key; wallet accounts: their browser signs (sign_tx)
        const play = this.relaySigns(side.viewer)
          ? this.chain.play(side.viewer, side.roundId, side.handle, side.coins)
          : this.playerSigned(side, 'play', { round_id: side.roundId, handle: side.handle, coins: side.coins });
        res = await Promise.race([play, sleep(45_000 + this.cfg.signTimeoutSeconds * 1000).then(() => ({ ok: false, hash: '', error: 'play timed out' }))]);
      } catch (e) {
        res = { ok: false, hash: '', error: errMsg(e) };
      }
      if (res.ok) {
        side.playStatus = 'placed';
        side.playTx = res.hash;
        this.sendTo(side.viewer, { t: 'placed', chatId: side.chatId, tx: res.hash });
      } else {
        side.playStatus = 'failed';
        side.playError = res.error;
        side.mode = 'free';
        side.coins = 0;
        this.sendTo(side.viewer, { t: 'play_failed', chatId: side.chatId, reason: friendlyChainError(res.error, 'the play did not go through') });
      }
      this.balances.delete(side.viewer);
      this.saveSide(side);
      this.pushSeat(side.viewer, side.roundId, side.level, side.seatIndex);
      void this.pushMe(side.viewer);
      this.maybeStart(conv);
    })();
    this.playPromises.set(side.chatId, p);
    this.track(side.roundId, p);
  }

  private maybeStart(conv: Conv): void {
    if (conv.started || conv.ended) return;
    const ss = conv.sides.map((id) => this.sides.get(id)!);
    if (ss.some((s) => s.playStatus === 'pending' || s.phase !== 'placing')) return;
    // no bots, no new chats: a chat matched before the pause began (while a play was placed) does not start
    // either, human or bot alike, so a chat that starts never tells who is behind it
    const round = this.rounds.get(ss[0].roundId);
    if (round && ss.some((s) => this.chatsPaused(round, s.level))) {
      this.abortConv(conv, ss, 'new chats are paused');
      return;
    }
    // a bot chat runs on its persona's NEAR AI key; one that ran out since the match never starts, so no
    // player sits through a silent bot
    let key: { keyId: string; ai: NearAi } | null = null;
    if (conv.kind === 'bot') {
      const c = this.chars.get(ss[0].roundId)?.get(ss[0].characterId);
      const persona = c ? this.personaOf(c) : undefined;
      if (persona) {
        key = this.keyFor(persona);
        if (!key && ownerOf(persona) && this.credits.usable('house')) {
          log.warn(`bot chat ${ss[0].chatId}: the own NEAR AI key of ${ownerOf(persona)} is unusable since the match; this chat runs on the relay's key`);
          key = { keyId: 'house', ai: this.ai };
        }
        if (!key) {
          this.abortConv(conv, ss, 'its NEAR AI key is out of credits');
          return;
        }
      }
    }
    conv.started = true;
    // both sides see the same full-screen countdown; nobody, bot or human, can write before startedAt,
    // so the timing never tells who is expected to speak first. Human and bot chats are identical here.
    const now = Date.now();
    const startedAt = now + Math.round(this.cfg.countdownSeconds * 1000);
    const endsAt = startedAt + this.cfg.chatSeconds * 1000;
    for (const s of ss) {
      s.phase = 'chatting';
      s.startedAt = startedAt;
      s.endsAt = endsAt;
      this.saveSide(s);
      this.sendTo(s.viewer, { t: 'chat_started', chatId: s.chatId, startedAt, endsAt });
    }
    conv.endTimer = setTimeout(() => this.endConv(conv, 'time', this.cfg.callSeconds * 1000), endsAt - now);
    // counted for the end of Turing Hour (only who played and how often: nothing about who was a bot)
    this.telegram.chatStarted(ss.map((s) => s.viewer), now);
    if (conv.kind === 'bot') {
      const side = ss[0];
      const c = this.chars.get(side.roundId)?.get(side.characterId);
      const persona = c ? this.personaOf(c) : undefined;
      const r = this.rounds.get(side.roundId);
      if (!c || !persona || !r) {
        log.error(`bot chat ${side.chatId}: persona missing`);
        return;
      }
      const session = new BotSession(this, side, persona, side.skinMessage!, r.attest[persona.model]?.attested ?? [], {
        brain: this.brainFor(persona, side.chatId),
        ai: key?.ai,
      });
      this.bots.set(side.chatId, session);
      session.start();
    }
  }

  /**
   * A matched chat that cannot start (new chats are paused, or its bot's NEAR AI key ran out between the match
   * and now): every side gets the same bots_unavailable, chat_ended and call_missed, human or bot alike. A placed
   * play is refunded at settlement (it is in no opening), and no rating moves.
   */
  private abortConv(conv: Conv, sides: ChatSide[], why: string): void {
    conv.started = true;
    conv.ended = true;
    const now = Date.now();
    for (const side of sides) {
      side.phase = 'missed';
      side.myCall = null;
      side.aborted = 'bots_unavailable';
      side.endedAt = now;
      side.endReason = 'round_end';
      side.callDeadline = now;
      this.saveSide(side);
      log.warn(`${conv.kind} chat ${side.chatId} of ${side.viewer} did not start: ${why}${side.playStatus === 'placed' ? '; the play is refunded at settlement' : ''}`);
      this.sendTo(side.viewer, { t: 'error', code: 'bots_unavailable', message: BOT_CHAT_ABORTED });
      this.sendTo(side.viewer, { t: 'chat_ended', chatId: side.chatId, callDeadline: now, reason: 'round_end' });
      this.sendTo(side.viewer, { t: 'call_missed', chatId: side.chatId });
      this.pushSeat(side.viewer, side.roundId, side.level, side.seatIndex);
    }
  }

  /**
   * No bots, no new chats. While the house key is out of credits, or while no bot at this level of the round
   * can talk (every one on an empty or unusable key), no new chat starts there, human to human included: a
   * match made then would be known to be a human. Chats already running finish as normal; matching resumes by
   * itself when a key recovers. A level with no bots at all (not committed yet) is not paused.
   */
  chatsPaused(r: RoundRec, level: Level): boolean {
    if (!this.credits.usable('house')) return true;
    const bots = [...(this.chars.get(r.id)?.values() ?? [])].filter((c) => c.kind === 'bot' && c.level === level && c.commitStatus === 'committed' && this.ownerActive(c));
    return bots.length > 0 && !bots.some((c) => this.botUsable(c));
  }

  /**
   * The NEAR AI client and key id a persona's chats use now: its botmaster's own key when one is stored,
   * else the relay's. null: that key is out of credits (or a stored own key cannot be opened).
   */
  keyFor(p: Persona): { keyId: string; ai: NearAi } | null {
    const owner = ownerOf(p);
    if (owner && this.byok?.has(owner)) {
      const ai = this.byok.client(owner);
      const keyId = this.byok.keyIdOf(owner);
      return ai && this.credits.usable(keyId) ? { keyId, ai } : null;
    }
    return this.credits.usable('house') ? { keyId: 'house', ai: this.ai } : null;
  }

  /** A bot character may be matched: its key has credits. */
  botUsable(c: CharacterRec): boolean {
    const p = this.personaOf(c);
    return !!p && this.keyFor(p) !== null;
  }

  /** An AI builder's character plays only while its botmaster is active and its persona approved. */
  private ownerActive(c: CharacterRec): boolean {
    const owner = c.persona?.owner;
    if (!owner || !this.agents) return true;
    if (this.agents.getBotmaster(owner)?.status !== 'active') return false;
    return this.agents.getPersona(c.personaId ?? '')?.status === 'approved';
  }

  /** The relay's own NEAR AI key as anyone may see it (GET /api/health): status and since; spend is the operator's. */
  aiHealth(): Pick<AiHealth, 'status' | 'since'> {
    return this.credits.publicHealth('house');
  }

  /** The persona's remote brain when its botmaster drives it and is connected, else the default brain. */
  private brainFor(persona: Persona, chatId: string): BrainChoice {
    const seed = `${chatId}|${randomId(8)}`;
    if (persona.brain.kind === 'remote' && this.hub) {
      const name = persona.brain.botmaster;
      const bm = this.hub.get(name);
      if (bm && this.hub.drives(name, persona.id)) {
        log.info(`bot chat ${chatId}: persona ${persona.id} driven by botmaster ${name}`);
        return {
          kind: 'remote', name, brain: this.hub.brain(name, chatId, persona.id),
          silenceMs: this.hub.silenceMsOf(name),
          onFallback: (why) => this.hub?.notice(chatId, name, 'fallback', `the default brain took over this chat: ${why}`),
        };
      }
      log.info(`bot chat ${chatId}: botmaster ${name} of ${persona.id} is ${bm ? (bm.personas.includes(persona.id) ? 'offline' : 'not registered for it') : 'unknown'}; default brain`);
    }
    return { kind: 'default', brain: defaultBrain({ seed }) };
  }

  isChatting(side: ChatSide): boolean {
    return side.phase === 'chatting' && !this.stopped;
  }

  private appendMessage(side: ChatSide, m: StoredMsg): void {
    side.messages.push(m);
    this.db.addMessage(side.chatId, side.messages.length - 1, m);
    this.sendTo(side.viewer, { t: 'message', chatId: side.chatId, msg: this.publicMsg(m) });
  }

  botSay(side: ChatSide, text: string, completionIndex: number): boolean {
    if (side.phase !== 'chatting' || this.stopped) return false;
    this.appendMessage(side, { id: randomId(6), from: 'them', text, at: Date.now(), ci: completionIndex });
    return true;
  }

  botTyping(side: ChatSide, on: boolean): void {
    if (side.phase !== 'chatting' && on) return;
    this.sendTo(side.viewer, { t: 'typing', chatId: side.chatId, on });
  }

  private sideOf(account: string, chatId: unknown): ChatSide {
    const side = typeof chatId === 'string' ? this.sides.get(chatId) : undefined;
    if (!side || side.viewer !== account) throw new GameError('unknown_chat', 'no such chat');
    return side;
  }

  say(account: string, chatId: string, text: unknown): void {
    const side = this.sideOf(account, chatId);
    if (side.phase !== 'chatting') throw new GameError('chat_not_active', 'the chat is not running');
    if (side.startedAt !== undefined && Date.now() < side.startedAt) throw new GameError('chat_not_started', 'the chat starts when the countdown ends');
    const t = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
    if (!t) throw new GameError('empty_message', 'message is empty');
    if (t.length > MAX_SAY) throw new GameError('message_too_long', `max ${MAX_SAY} characters`);
    const now = Date.now();
    if (now - (this.lastSay.get(chatId) ?? 0) < SAY_INTERVAL_MS) throw new GameError('rate_limited', 'slow down: one message per 600 ms');
    this.lastSay.set(chatId, now);
    const id = randomId(6);
    this.appendMessage(side, { id, from: 'me', text: t, at: now });
    if (side.partnerKind === 'human' && side.partnerChatId) {
      const other = this.sides.get(side.partnerChatId);
      if (other && other.phase === 'chatting') this.appendMessage(other, { id, from: 'them', text: t, at: now });
    } else {
      this.bots.get(side.chatId)?.onPlayerMessage({ id, text: t });
    }
  }

  typing(account: string, chatId: string, on: boolean): void {
    const side = this.sideOf(account, chatId);
    if (side.phase !== 'chatting') return;
    // typing during the countdown would tell the partner who is about to speak first: dropped
    if (side.startedAt !== undefined && Date.now() < side.startedAt) return;
    if (side.partnerKind === 'bot') {
      this.bots.get(side.chatId)?.onPlayerTyping(on);
      return;
    }
    if (!side.partnerChatId) return;
    const other = this.sides.get(side.partnerChatId);
    if (other) this.sendTo(other.viewer, { t: 'typing', chatId: other.chatId, on });
  }

  devEndChat(account: string, chatId: string): void {
    if (!this.cfg.testMode) throw new GameError('not_test_mode', 'dev_end_chat needs test mode', 403);
    const side = this.sideOf(account, chatId);
    const conv = this.convs.get(side.convId);
    if (conv && !conv.ended) this.endConv(conv, 'dev', this.cfg.callSeconds * 1000);
  }

  private endConv(conv: Conv, reason: NonNullable<ChatSide['endReason']>, callWindowMs: number): void {
    if (conv.ended) return;
    conv.ended = true;
    if (conv.endTimer) clearTimeout(conv.endTimer);
    conv.endTimer = null;
    const now = Date.now();
    for (const id of conv.sides) {
      const s = this.sides.get(id);
      if (!s || (s.phase !== 'placing' && s.phase !== 'chatting')) continue;
      // a bot reply that has started to appear is shown in full, so screen and signed record agree
      this.bots.get(s.chatId)?.flush();
      s.phase = 'calling';
      s.endedAt = now;
      s.endReason = reason;
      s.callDeadline = now + callWindowMs;
      this.saveSide(s);
      this.sendTo(s.viewer, { t: 'typing', chatId: s.chatId, on: false });
      this.sendTo(s.viewer, { t: 'chat_ended', chatId: s.chatId, callDeadline: s.callDeadline, reason });
      const old = this.missTimers.get(s.chatId);
      if (old) clearTimeout(old);
      this.missTimers.set(s.chatId, setTimeout(() => this.markMissed(s), callWindowMs + 750));
      const bot = this.bots.get(s.chatId);
      if (bot) bot.stop(s.playStatus === 'placed');
    }
  }

  private markMissed(s: ChatSide): void {
    const t = this.missTimers.get(s.chatId);
    if (t) clearTimeout(t);
    this.missTimers.delete(s.chatId);
    if (s.phase !== 'calling') return;
    s.phase = 'missed';
    s.myCall = null;
    this.saveSide(s);
    this.sendTo(s.viewer, { t: 'call_missed', chatId: s.chatId });
    this.pushSeat(s.viewer, s.roundId, s.level, s.seatIndex);
  }

  call(account: string, chatId: string, human: unknown): void {
    const side = this.sideOf(account, chatId);
    if (typeof human !== 'boolean') throw new GameError('bad_call', 'human must be true or false');
    if (side.phase === 'called') throw new GameError('already_called', 'you already called this chat');
    if (side.phase !== 'calling') throw new GameError('not_calling', 'calls open when the chat ends');
    if (Date.now() > (side.callDeadline ?? 0) + 1500) {
      this.markMissed(side);
      throw new GameError('call_closed', 'too late to call');
    }
    side.myCall = human;
    side.callAt = Date.now();
    side.phase = 'called';
    const t = this.missTimers.get(side.chatId);
    if (t) clearTimeout(t);
    this.missTimers.delete(side.chatId);
    this.pushSeat(side.viewer, side.roundId, side.level, side.seatIndex);
    if (side.playStatus !== 'placed' && side.playStatus !== 'pending') {
      side.callStatus = 'stored';
      this.saveSide(side);
      this.sendTo(account, { t: 'call_recorded', chatId, human });
      return;
    }
    side.callStatus = 'pending';
    this.saveSide(side);
    const p = (async () => {
      const play = this.playPromises.get(side.chatId);
      if (play) await play;
      if (side.playStatus !== 'placed') {
        side.callStatus = 'stored';
        this.saveSide(side);
        this.sendTo(account, { t: 'call_recorded', chatId, human });
        return;
      }
      const res = this.relaySigns(account)
        ? await this.chain.call(account, side.roundId, side.handle, human)
        : await this.playerSigned(side, 'call', { round_id: side.roundId, handle: side.handle, human });
      if (res.ok) {
        side.callStatus = 'ok';
        side.callTx = res.hash;
        this.sendTo(account, { t: 'call_recorded', chatId, human, tx: res.hash });
      } else {
        side.callStatus = 'failed';
        side.callError = res.error;
        this.sendTo(account, { t: 'call_recorded', chatId, human });
        this.sendTo(account, { t: 'error', code: 'call_failed', message: friendlyChainError(res.error, 'the call did not reach the chain') });
      }
      this.saveSide(side);
    })();
    this.track(side.roundId, p);
  }

  // =====================================================================================
  // player-signed plays and calls (wallet accounts, protocol v1.3)
  // =====================================================================================

  /**
   * A wallet account's play or call: the relay fixes every field of the transaction (signer, the session's
   * play key, the game contract, the method and its exact args, the gas, the key's next nonce, a recent
   * block hash), asks the browser that picked the seat to sign it (sign_tx), checks the signed bytes are
   * exactly that transaction under a valid signature (src/auth/tx.ts), then broadcasts it and tracks the
   * outcome. A stale nonce or block hash is asked for again; a key out of allowance is marked exhausted.
   */
  private async playerSigned(side: ChatSide, method: PlayerMethod, args: Record<string, unknown>): Promise<TxOutcome> {
    const s = this.auth?.byId(side.sessionId);
    const key = s?.playKey;
    if (!s || !key) return { ok: false, hash: '', error: 'no play key for this browser yet' };
    if (key.status !== 'active') return { ok: false, hash: '', error: 'the play key is out of gas allowance' };
    let last: TxOutcome = { ok: false, hash: '', error: 'not sent' };
    for (let attempt = 0; attempt < 3; attempt++) {
      const base = await this.keyState(side.viewer, key.publicKey, attempt > 0).catch((e) => {
        log.warn(`view_access_key ${side.viewer}: ${errMsg(e)}`);
        return undefined;
      });
      if (base === undefined) return { ok: false, hash: '', error: 'could not reach NEAR' };
      if (base === null) {
        this.auth!.forgetPlayKey(s);
        this.sendToSession(side.viewer, s.id, { t: 'error', code: 'play_key_missing', message: "This browser's play key is gone from your account: one approval in your wallet adds a fresh one." });
        return { ok: false, hash: '', error: 'the play key is not on the account any more' };
      }
      const want: ExpectedTx = {
        signerId: side.viewer, publicKey: key.publicKey, receiverId: this.chain.contractId, nonce: base.nonce, blockHash: base.blockHash,
        methodName: method, args: JSON.stringify(args), gas: BigInt(this.cfg.playGasTgas) * TGAS,
      };
      const signed = await this.askToSign(side, s.id, method, want);
      if (!signed.ok) return { ok: false, hash: '', error: signed.error };
      const out = await this.chain.sendSignedTx(signed.bytes, side.viewer, method);
      this.db.logTx({ at: Date.now(), roundId: side.roundId, kind: `${method}:browser`, signer: side.viewer, hash: out.hash || signed.hash, ok: out.ok, error: out.error ?? null, ms: null });
      if (out.ok) return out;
      last = out;
      if (out.code === 'nonce' || out.code === 'expired') {
        const k = `${side.viewer}|${key.publicKey}`;
        const st = this.keyNonces.get(k);
        // the next attempt reads the key again (a fresh block hash), never below the nonce NEAR reported
        if (st && out.akNonce !== undefined && out.akNonce + 1n > st.next) st.next = out.akNonce + 1n;
        continue;
      }
      if (out.code === 'allowance') {
        this.auth!.markPlayKey(s.id, 'exhausted');
        this.sendToSession(side.viewer, s.id, { t: 'error', code: 'play_key_exhausted', message: "This browser's play key used up its gas allowance: one approval in your wallet adds a fresh one." });
      } else if (out.code === 'key') {
        this.auth!.forgetPlayKey(s);
        this.sendToSession(side.viewer, s.id, { t: 'error', code: 'play_key_missing', message: "This browser's play key is gone from your account: one approval in your wallet adds a fresh one." });
      }
      return out;
    }
    return last;
  }

  /** The next nonce of a play key and a block hash to sign with; null when the key is not on chain. */
  private async keyState(account: string, publicKey: string, fresh: boolean): Promise<{ nonce: bigint; blockHash: string } | null> {
    const k = `${account}|${publicKey}`;
    let st = this.keyNonces.get(k);
    // a block hash stays valid for about a day of blocks; refresh well before
    if (!st || fresh || Date.now() - st.at > 10 * 60_000) {
      const v = await this.chain.viewAccessKey(account, publicKey, 'play');
      if (!v) {
        this.keyNonces.delete(k);
        return null;
      }
      // the view is final (a block or two behind what just executed): never go below what was already asked for
      const next = st && st.next > v.nonce ? st.next : v.nonce + 1n;
      st = { next, blockHash: v.blockHash, at: Date.now() };
      this.keyNonces.set(k, st);
    }
    const nonce = st.next;
    st.next += 1n; // the next request gets the next nonce; a nonce asked for but never sent leaves a gap, which NEAR allows
    return { nonce, blockHash: st.blockHash };
  }

  private askToSign(side: ChatSide, sessionId: string, method: PlayerMethod, want: ExpectedTx): Promise<{ ok: true; bytes: Uint8Array; hash: string } | { ok: false; error: string }> {
    const reqId = randomId(9);
    const ms = this.cfg.signTimeoutSeconds * 1000;
    const msg: ServerMsg = { t: 'sign_tx', reqId, chatId: side.chatId, purpose: method, tx: signRequestOf(want), expiresAt: Date.now() + ms };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.signReqs.delete(reqId);
        log.warn(`${method} of ${side.viewer} in ${side.chatId}: no signature within ${this.cfg.signTimeoutSeconds} s`);
        resolve({ ok: false, error: 'your browser did not sign in time' });
      }, ms);
      this.signReqs.set(reqId, {
        reqId, account: side.viewer, sessionId, chatId: side.chatId, want, msg,
        resolve: (r) => {
          clearTimeout(timer);
          this.signReqs.delete(reqId);
          resolve(r);
        },
      });
      this.sendToSession(side.viewer, sessionId, msg);
    });
  }

  private sendToSession(account: string, sessionId: string, msg: ServerMsg): void {
    for (const c of this.conns.get(account) ?? []) {
      if (c.sessionId !== sessionId) continue;
      try {
        c.send(msg);
      } catch (e) {
        log.debug(`send to ${account} failed: ${errMsg(e)}`);
      }
    }
  }

  private onSigned(conn: Conn, reqId: unknown, signedTx: unknown): void {
    const p = typeof reqId === 'string' ? this.signReqs.get(reqId) : undefined;
    if (!p || p.account !== conn.account || p.sessionId !== conn.sessionId) throw new GameError('unknown_sign_request', 'no such signature request (it may have expired)');
    const bytes = decodeSignedTxBase64(signedTx);
    if (!bytes) {
      p.resolve({ ok: false, error: 'the browser sent something that is not a signed transaction' });
      throw new GameError('bad_signed_tx', 'signedTx must be a base64 borsh SignedTransaction');
    }
    const chk = checkSignedTx(bytes, p.want);
    if (!chk.ok) {
      log.warn(`${p.want.methodName} of ${p.account} in ${p.chatId}: signed transaction refused (${chk.code}: ${chk.reason})`);
      p.resolve({ ok: false, error: `the signed ${p.want.methodName} was refused: ${chk.reason}` });
      throw new GameError('bad_signed_tx', chk.reason);
    }
    p.resolve({ ok: true, bytes: chk.bytes, hash: chk.hash });
  }

  private onSignDeclined(conn: Conn, reqId: unknown, reason: unknown): void {
    const p = typeof reqId === 'string' ? this.signReqs.get(reqId) : undefined;
    if (!p || p.account !== conn.account || p.sessionId !== conn.sessionId) return;
    const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'no reason given';
    log.info(`${p.want.methodName} of ${p.account} in ${p.chatId}: the browser declined (${why})`);
    p.resolve({ ok: false, error: `your browser did not sign it: ${why}` });
  }

  // =====================================================================================
  // players, balances, HTTP views
  // =====================================================================================

  async balanceOf(account: string, maxAgeMs = 2000): Promise<bigint> {
    const c = this.balances.get(account);
    if (c && Date.now() - c.at <= maxAgeMs) return c.v;
    const v = await this.chain.balanceOf(account);
    this.balances.set(account, { v, at: Date.now() });
    return v;
  }

  async me(account: string, maxAgeMs = 2000): Promise<Me> {
    const u = this.users.get(account);
    if (!u || !this.isPlayer(account)) throw new GameError('unknown_user', `${account} is not a player here`, 404);
    const bal = await this.balanceOf(account, maxAgeMs);
    let locked = 0n;
    for (const s of this.sides.values()) {
      if (s.viewer !== account || s.playStatus !== 'placed') continue;
      const r = this.rounds.get(s.roundId);
      if (r && r.status === 'settled') continue;
      locked += splitPlay(BigInt(s.coins) * this.coinUnit, BigInt(this.chainCfg.feeBps)).locked;
    }
    return {
      accountId: account,
      label: this.labels.get(account) ?? u.label,
      balanceCoins: unitsToCoins(bal, this.coinUnit),
      lockedCoins: unitsToCoins(locked, this.coinUnit),
      rating: u.rating,
      stats: { chats: u.chats, right: u.right, wrong: u.wrong, streak: u.streak, bestStreak: u.bestStreak },
      levelUnlocked: this.levelUnlocked(u),
      lockedBonusCoins: unitsToCoins(BigInt(u.lockedBonus || '0'), this.coinUnit),
      freeChatsLeft: this.freeLeft(u),
      kind: this.relaySigns(account) ? 'test' : 'wallet',
    };
  }

  async testUsers(): Promise<TestUser[]> {
    if (!this.cfg.testMode) return [];
    return Promise.all(
      this.chain.testUsers.map(async (t) => {
        const u = this.users.get(t.accountId)!;
        let bal = 0n;
        try {
          bal = await this.balanceOf(t.accountId, 5000);
        } catch {
          /* show 0 */
        }
        return {
          accountId: t.accountId,
          label: t.label,
          seed: avatarSeed(t.accountId),
          balanceCoins: unitsToCoins(bal, this.coinUnit),
          rating: u.rating,
          chats: u.chats,
          online: this.conns.has(t.accountId),
        };
      }),
    );
  }

  /** Test mode, test users: test coins straight into the game balance (scripts and e2e; players use the airdrop). */
  async faucet(account: string, coins = 100): Promise<{ tx: string; me: Me }> {
    if (!this.cfg.testMode) throw new GameError('not_test_mode', 'faucet is test mode only', 403);
    if (!this.isPlayer(account)) throw new GameError('unknown_user', `${account} is not a player here`, 404);
    if (!this.relaySigns(account)) throw new GameError('use_airdrop', 'a wallet account gets test tokens from the airdrop', 403);
    if (!this.chainCfg.coinsOpen) throw new GameError('coins_closed', 'the game contract has no coin yet', 409);
    const c = Number(coins);
    if (!Number.isFinite(c) || c <= 0 || c > 10_000) throw new GameError('bad_coins', 'coins must be between 0 and 10000');
    return this.faucetIntoGame(account, coinsToUnits(c, this.coinUnit));
  }

  /** The faucet deposits for the account into the game; then any locked Turing bonus is paid. */
  private async faucetIntoGame(account: string, deposit: bigint): Promise<{ tx: string; me: Me }> {
    const before = await this.balanceOf(account, 0).catch(() => null);
    const res = await this.chain.faucetDeposit(account, deposit);
    if (!res.ok) throw new GameError('faucet_failed', res.error ?? 'deposit failed', 502);
    let expected = before === null ? null : before + deposit;
    this.db.logTx({ at: Date.now(), roundId: null, kind: 'faucet', signer: this.chain.accounts.faucet, hash: res.hash, ok: true, error: null, ms: null });
    const bonus = await this.payLockedBonus(account);
    if (expected !== null) expected += bonus.amount;
    await this.settleBalance(account, (b) => expected === null || b >= expected);
    const me = await this.me(account, 0);
    this.sendTo(account, { t: 'me', me });
    return { tx: res.hash, me };
  }

  /** On a deposit: the Turing bonus earned as a free human, held by promo until now (spec "locked Turing bonus"). */
  private async payLockedBonus(account: string): Promise<{ amount: bigint; tx?: string }> {
    const u = this.users.get(account);
    const bonus = BigInt(u?.lockedBonus || '0');
    if (!u || bonus <= 0n) return { amount: 0n };
    const t = await this.chain.transfer(this.chain.accounts.promo, account, bonus);
    if (!t.ok) {
      log.warn(`locked bonus transfer to ${account} failed, kept for the next deposit: ${t.error}`);
      return { amount: 0n };
    }
    u.lockedBonus = '0';
    this.saveUser(u);
    log.info(`locked Turing bonus of ${unitsToCoins(bonus, this.coinUnit)} coins paid to ${account} from promo: ${t.hash}`);
    return { amount: bonus, tx: t.hash };
  }

  /**
   * A wallet account's own deposit (ft_transfer_call on the coin, sent from its wallet): checked on chain by
   * hash, signer, receiver, method, the game as receiver_id and the game's deposit event for the account;
   * then any locked Turing bonus is paid. Each transaction counts once.
   */
  async reportDeposit(account: string, txHash: unknown): Promise<{ me: Me; bonusTx?: string }> {
    if (!this.isPlayer(account)) throw new GameError('unknown_user', `${account} is not a player here`, 404);
    if (typeof txHash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{30,50}$|^mock[0-9a-f]{40}$/.test(txHash)) throw new GameError('invalid_request', 'txHash must be a transaction hash');
    const seen = this.db.getKv(`deposit_tx:${txHash}`);
    if (seen && seen !== account) throw new GameError('not_your_tx', 'that deposit belongs to another account', 403);
    let bonusTx: string | undefined;
    if (!seen) {
      // a transaction just sent may need a moment to show up; the browser asks again after tx_unknown
      let d = null;
      for (let i = 0; i < 3 && !d; i++) {
        d = await this.chain.txDetails(txHash, account).catch(() => null);
        if (!d && i < 2) await sleep(700 * (i + 1));
      }
      if (!d) throw new GameError('tx_unknown', 'that deposit is not on chain yet; try again in a few seconds', 409);
      const fc = d.actions.find((a) => a.method === 'ft_transfer_call');
      const credited = d.logs.some((l) => {
        if (!l.startsWith('EVENT_JSON:')) return false;
        try {
          const e = JSON.parse(l.slice(11));
          return e.standard === 'realsies' && e.event === 'deposit' && Array.isArray(e.data) && e.data.some((x: any) => x?.account === account);
        } catch {
          return false;
        }
      });
      const ok = d.ok && d.signerId === account && d.receiverId === this.chain.tokenId && !!fc && (fc.args as any)?.receiver_id === this.chain.contractId && credited;
      if (!ok) throw new GameError('not_a_deposit', `that transaction is not a deposit of ${account} into the game`, 400);
      this.db.setKv(`deposit_tx:${txHash}`, account);
      bonusTx = (await this.payLockedBonus(account)).tx;
    }
    this.balances.delete(account);
    const me = await this.me(account, 0);
    this.sendTo(account, { t: 'me', me });
    return { me, bonusTx };
  }

  /**
   * The coin's view of a wallet account: what the wallet itself holds (so the screen never offers a deposit
   * that can only fail), whether it can receive withdrawals (registered), and what registering costs.
   */
  async walletInfo(account: string): Promise<WalletInfo> {
    if (!this.chainCfg.coinsOpen) return { accountId: account, coinsOpen: false, tokenId: this.chain.tokenId, tokenRegistered: false, storageDeposit: '0', walletBalance: '0' };
    const [st, bal, swap] = await Promise.all([
      this.chain.tokenStorage(account),
      this.chain.tokenBalance(account).catch((e) => {
        log.warn(`ft_balance_of ${account}: ${errMsg(e)}`);
        return null;
      }),
      // v1.12: a buy with NEAR is built from the account's NEAR, its wrap registration and its wNEAR
      this.swap ? swapWallet((c, m, a) => this.chain.view(c, m, a), (a) => this.chain.nearBalance(a), this.swap.pool.wrapId, account) : Promise.resolve({}),
    ]);
    return {
      accountId: account, coinsOpen: true, tokenId: this.chain.tokenId, tokenRegistered: st.registered, storageDeposit: st.minDeposit,
      ...(bal === null ? {} : { walletBalance: bal.toString() }),
      ...swap,
    };
  }

  // ---------- the testnet airdrop (protocol v1.6) ----------

  /** On only in test mode on testnet: never on mainnet, never on a relay without test users. */
  get airdropOn(): boolean {
    return this.cfg.testMode && this.chain.network === 'testnet';
  }

  /** Who may have one, and where it lands: a test user's game balance, a wallet account's own wallet. */
  private airdropTarget(account: string): 'wallet' | 'game' {
    if (!this.airdropOn) throw new GameError('not_test_mode', 'the airdrop is for the testnet demo only', 403);
    if (!this.isPlayer(account)) throw new GameError('unknown_user', `${account} is not a player here`, 404);
    if (!this.chainCfg.coinsOpen) throw new GameError('coins_closed', 'the game contract has no coin yet', 409);
    return this.relaySigns(account) ? 'game' : 'wallet';
  }

  /** What counts toward the cap: the game balance, plus the wallet's own coin for a wallet account. */
  private async airdropHeld(account: string, to: 'wallet' | 'game'): Promise<{ game: bigint; wallet: bigint }> {
    try {
      const [game, wallet] = await Promise.all([this.balanceOf(account, 0), to === 'wallet' ? this.chain.tokenBalance(account) : Promise.resolve(0n)]);
      return { game, wallet };
    } catch (e) {
      log.warn(`airdrop: the balances of ${account}: ${errMsg(e)}`);
      throw new GameError('rpc_unavailable', 'NEAR is not answering right now; try again in a minute', 503);
    }
  }

  private airdropLast(account: string): number | null {
    const v = Number(this.db.getKv(`airdrop_at:${account}`) ?? '');
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  private airdropStatusOf(account: string, to: 'wallet' | 'game', held: bigint, now: number): AirdropStatus {
    const lastAt = this.airdropLast(account);
    const nextAt = lastAt === null ? now : Math.max(now, lastAt + AIRDROP.everyMinutes * 60_000);
    const blocked = nextAt > now ? 'airdrop_too_soon' : held >= coinsToUnits(AIRDROP.enoughCoins, this.coinUnit) ? 'airdrop_enough' : undefined;
    return {
      accountId: account, coins: AIRDROP.coins, to, heldCoins: unitsToCoins(held, this.coinUnit), enoughCoins: AIRDROP.enoughCoins,
      againBelowCoins: AIRDROP.againBelowCoins, lastAt, nextAt, ...(blocked ? { blocked } : {}),
    };
  }

  async airdropStatus(account: string, now = Date.now()): Promise<AirdropStatus> {
    const to = this.airdropTarget(account);
    const h = await this.airdropHeld(account, to);
    return this.airdropStatusOf(account, to, h.game + h.wallet, now);
  }

  /**
   * 100 test tokens, one tap: a test user's go straight into its game balance (the faucet deposits for it); a
   * wallet account's go to its own wallet (the faucet registers it on the coin and pays the storage), and from
   * there everything works as on mainnet. One per account per 10 minutes; none while the account holds 50 or
   * more, wallet plus game balance (airdrop_too_soon, airdrop_enough).
   */
  async airdrop(account: string, now = Date.now()): Promise<AirdropResult> {
    const to = this.airdropTarget(account);
    const every = AIRDROP.everyMinutes * 60_000;
    const prev = this.airdropLast(account);
    if (prev !== null && now - prev < every) {
      const retryAt = prev + every;
      const mins = Math.max(1, Math.ceil((retryAt - now) / 60_000));
      throw new GameError('airdrop_too_soon', `one airdrop per ${AIRDROP.everyMinutes} minutes: the next one in ${mins} min`, 429, { retryAt });
    }
    // the slot is taken before anything is awaited, so a second tap meanwhile is refused; given back if nothing was sent
    const key = `airdrop_at:${account}`;
    this.db.setKv(key, String(now));
    let sent = false;
    try {
      const h = await this.airdropHeld(account, to);
      const held = h.game + h.wallet;
      if (held >= coinsToUnits(AIRDROP.enoughCoins, this.coinUnit)) {
        const heldCoins = unitsToCoins(held, this.coinUnit);
        throw new GameError('airdrop_enough', `you hold ${heldCoins} already; the airdrop is for balances under ${AIRDROP.enoughCoins}`, 409, { heldCoins });
      }
      const units = coinsToUnits(AIRDROP.coins, this.coinUnit);
      let tx: string;
      let me: Me;
      let wallet: WalletInfo | undefined;
      if (to === 'game') {
        const r = await this.faucetIntoGame(account, units);
        sent = true;
        tx = r.tx;
        me = r.me;
      } else {
        const res = await this.chain.faucetToWallet(account, units);
        if (!res.ok) throw new GameError('faucet_failed', res.error ?? 'the faucet transfer failed', 502);
        sent = true;
        tx = res.hash;
        this.db.logTx({ at: Date.now(), roundId: null, kind: 'airdrop', signer: this.chain.accounts.faucet, hash: res.hash, ok: true, error: null, ms: null });
        await this.settleWallet(account, h.wallet + units);
        me = await this.me(account, 0);
        wallet = await this.walletInfo(account);
      }
      log.info(`airdrop: ${AIRDROP.coins} coins to ${account} (${to}): ${tx}`);
      const walletNow = wallet?.walletBalance !== undefined ? BigInt(wallet.walletBalance) : h.wallet + (to === 'wallet' ? units : 0n);
      const after = walletNow + coinsToUnits(me.balanceCoins, this.coinUnit);
      return { tx, coins: AIRDROP.coins, to, me, ...(wallet ? { wallet } : {}), status: this.airdropStatusOf(account, to, after, Date.now()) };
    } catch (e) {
      if (!sent) this.db.setKv(key, prev === null ? '0' : String(prev));
      throw e;
    }
  }

  /** RPC nodes can trail a block right after a write: poll until the wallet holds what it should (max ~8 s). */
  private async settleWallet(account: string, want: bigint): Promise<void> {
    for (let i = 0; i < 12; i++) {
      const b = await this.chain.tokenBalance(account).catch(() => null);
      if (b !== null && b >= want) return;
      await sleep(700);
    }
    log.warn(`the wallet of ${account} did not show the airdrop within 8 s`);
  }

  /** RPC nodes can trail a block right after a write: poll until the balance reflects it (max ~8 s). */
  private async settleBalance(account: string, ok: (b: bigint) => boolean): Promise<void> {
    for (let i = 0; i < 12; i++) {
      this.balances.delete(account);
      const b = await this.balanceOf(account, 0).catch(() => null);
      if (b !== null && ok(b)) return;
      await new Promise((r) => setTimeout(r, 700));
    }
    this.balances.delete(account);
    log.warn(`balance of ${account} did not reflect the last write within 8 s`);
  }

  async withdraw(account: string, coins: number): Promise<{ tx: string; me: Me }> {
    // the relay signs withdrawals only for test users; a wallet account withdraws from its wallet
    if (!this.relaySigns(account)) {
      if (this.isPlayer(account)) throw new GameError('withdraw_in_wallet', 'withdraw from your wallet: it signs withdraw on the game contract', 403);
      throw new GameError('unknown_user', `${account} is not a test user`, 404);
    }
    const c = Number(coins);
    if (!Number.isFinite(c) || c <= 0) throw new GameError('bad_coins', 'coins must be positive');
    const bal = await this.balanceOf(account, 0);
    const balCoins = unitsToCoins(bal, this.coinUnit);
    const amount = c >= balCoins - 1e-9 ? bal : coinsToUnits(c, this.coinUnit);
    if (amount <= 0n || amount > bal) throw new GameError('insufficient_balance', 'not enough coins');
    const res = await this.chain.withdraw(account, amount);
    if (!res.ok) throw new GameError('withdraw_failed', res.error ?? 'withdraw failed', 502);
    await this.settleBalance(account, (b) => b <= bal - amount);
    const me = await this.me(account, 0);
    this.sendTo(account, { t: 'me', me });
    return { tx: res.hash, me };
  }

  listRounds(): RoundSummary[] {
    return this.db.listRounds<RoundRec>(50).map((r) => {
      const live = this.rounds.get(r.id) ?? r;
      const chats = this.db.loadChats<ChatSide>(r.id);
      return {
        roundId: live.id,
        startedAt: live.startedAt,
        endsAt: live.endsAt,
        status: live.status,
        characters: this.db.countCharacters(r.id),
        chats: this.db.countConversations(r.id),
        paidPlays: chats.filter((s) => s.playStatus === 'placed').length,
        settleTx: live.settleTx,
      };
    });
  }

  results(roundId: number, account: string): RoundResults {
    if (!this.users.has(account)) throw new GameError('unknown_user', `${account} is not a player here`, 404);
    const stored = this.db.loadResult<RoundResults>(roundId, account);
    if (stored) return stored;
    const r = this.rounds.get(roundId) ?? this.db.loadRound<RoundRec>(roundId);
    if (!r) throw new GameError('unknown_round', `no round ${roundId}`, 404);
    const u = this.users.get(account)!;
    return {
      roundId,
      status: r.status,
      settledAt: r.settledAt,
      chats: [],
      calledRight: 0,
      calledTotal: 0,
      coinsDelta: 0,
      turingBonusCoins: 0,
      lockedBonusCoins: 0,
      wouldHaveCoins: 0,
      ratingBefore: u.rating,
      ratingAfter: u.rating,
      chain: { revealTx: r.revealTx, openTxs: r.openTxs ?? [], settleTx: r.settleTx },
    };
  }

  /** The bot engine's trace of a chat. It names the persona, so like a bundle it is for the viewer after settlement (unless DEV_TRACES). */
  botTrace(chatId: string, account: string): unknown {
    const side = this.sides.get(chatId) ?? this.db.loadChat<ChatSide>(chatId);
    if (!side || side.partnerKind !== 'bot') throw new GameError('unknown_chat', 'no such bot chat', 404);
    if (!this.cfg.devTraces && side.viewer !== account) throw new GameError('forbidden', 'only the chat viewer can open its trace', 403);
    const r = this.rounds.get(side.roundId) ?? this.db.loadRound<RoundRec>(side.roundId);
    if (!this.cfg.devTraces && (!r || r.status !== 'settled')) throw new GameError('not_settled', 'bot traces are published after the round settles', 409);
    const trace = this.db.loadTrace(chatId);
    if (!trace) throw new GameError('not_found', 'no bot trace for that chat (yet)', 404);
    const drafts = this.db.loadDrafts(chatId).map((d) => ({ sayId: d.sayId, steering: d.steering, reason: d.reason }));
    return { chatId, ...(trace as object), completions: this.db.loadCompletions(chatId).length, drafts };
  }

  verify(chatId: string, account: string): VerifyBundle {
    const side = this.sides.get(chatId) ?? this.db.loadChat<ChatSide>(chatId);
    if (!side) throw new GameError('unknown_chat', 'no such chat', 404);
    if (this.cfg.testMode && side.viewer !== account) throw new GameError('forbidden', 'only the chat viewer can open its bundle', 403);
    if (side.partnerKind !== 'bot') throw new GameError('not_a_bot_chat', 'only bot chats have a verification bundle', 404);
    const r = this.rounds.get(side.roundId) ?? this.db.loadRound<RoundRec>(side.roundId);
    if (!r || r.status !== 'settled') throw new GameError('not_settled', 'the bundle is published after the round settles', 409);
    const b = this.db.loadBundle<VerifyBundle>(chatId);
    if (!b) throw new GameError('no_bundle', 'bundle not found', 404);
    return b;
  }

  leaderboard(): LeaderRow[] {
    return [...this.users.values()]
      .map((u) => ({
        label: this.labels.get(u.account) ?? u.label,
        accountId: u.account,
        rating: u.rating,
        chats: u.chats,
        accuracy: u.right + u.wrong > 0 ? u.right / (u.right + u.wrong) : 0,
      }))
      .sort((a, b) => b.rating - a.rating || b.chats - a.chats);
  }

  /** Test-mode diagnostics (no secrets of the open round). */
  debugState(): unknown {
    const r = this.current;
    return {
      round: r ? { ...this.roundState(r), ready: r.ready, startOk: r.startOk, lastError: r.lastError, attest: Object.values(r.attest).map((a) => ({ model: a.model, ok: a.ok, attested: a.attested })) } : null,
      settling: [...this.rounds.values()].filter((x) => x.status === 'settling').map((x) => ({ id: x.id, lastError: x.lastError })),
      characters: r ? [...(this.chars.get(r.id)?.values() ?? [])].map((c) => ({ kind: c.kind, level: c.level, status: c.commitStatus })).reduce(
        (acc: Record<string, number>, c) => {
          const k = `${c.kind}${c.level ? `-L${c.level}` : ''}-${c.status}`;
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        },
        {},
      ) : {},
      online: [...this.conns.keys()],
      searches: [...this.searches.values()].map((s) => ({ account: s.account, level: s.level, seat: s.seatIndex, mode: s.mode })),
      activeChats: [...this.sides.values()].filter((s) => s.phase !== 'called' && s.phase !== 'missed').length,
      idle: this.isIdle(),
      lastHumanAt: this.lastHumanAt,
      queues: this.chain.queueDepth(),
      ai: this.ai.kind,
      aiHealth: this.aiHealth(),
      chain: this.chain.kind,
      completions: this.db.completionStats(),
    };
  }
}
