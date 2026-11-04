// The relay's game engine: rounds, characters and commitments, matchmaking, chats, calls,
// settlement on chain, results, ratings and verification bundles (docs/spec.md section 4).
import {
  LEVELS, themeFor,
  type ActiveChat, type ChatInfo, type ChatMessage, type ClientMsg, type LeaderRow, type Level, type Me, type Mode,
  type PublicConfig, type RoundResults, type RoundState, type RoundSummary, type Seat, type ServerMsg, type Skin,
  type TestUser, type VerifyBundle,
} from '../../../shared/protocol.js';
import { gamertag } from '../../../shared/names.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { ChainAdapter, ChainConfig, Opening } from '../chain/types.js';
import type { NearAi } from '../nearai/client.js';
import type { Persona } from '../personas.js';
import { chatCostUsd } from '../models.js';
import {
  avatarSeed, botPreimage, chatTag, commitmentOf, handleOf, humanPreimage, newCharacterId, newSalt, newSecret,
  normalizeSigners, seatSeed, secretHash, skinMessage,
} from '../formats.js';
import { randomHex } from '../crypto.js';
import { splitPlay } from '../settlement.js';
import { RATING_START } from '../scoring.js';
import { BotSession, type BotHost, type StoredMsg } from './bot.js';
import { buildBundle, lastSignedCompletion } from './bundle.js';
import { computeResults } from './results.js';
import type { AttestInfo, CharacterRec, ChatSide, RoundRec, Search, UserRec } from './types.js';
import { coinsToUnits, errMsg, pick, randomId, sleep, uniform, unitsToCoins, utcDay } from '../util.js';
import { logger } from '../log.js';

const log = logger('game');

export const PRESETS: Record<Level, [number, number, number]> = { 1: [5, 10, 25], 2: [25, 50, 100], 3: [100, 250, 500] };
const MAX_SAY = 280;
const SAY_INTERVAL_MS = 600;

export interface Conn {
  account: string;
  /** last level this connection entered; its room is re-sent when a new round starts */
  level?: Level;
  send(msg: ServerMsg): void;
  close(code?: number, reason?: string): void;
}

/** The deployed contract reports panics as a bare wasm trap; keep the raw text in the DB, show something readable. */
function friendlyChainError(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (/unreachable|wasm|trap/i.test(raw)) return `${fallback}: the game contract rejected it`;
  const m = raw.match(/Smart contract panicked: (.*)/);
  return m ? `${fallback}: ${m[1]}` : `${fallback}: ${raw.slice(0, 160)}`;
}

export class GameError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
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
  stopped = false;

  constructor(
    readonly cfg: Config,
    readonly db: Db,
    readonly chain: ChainAdapter,
    readonly ai: NearAi,
    readonly personas: Persona[],
  ) {
    this.botTimeScale = cfg.botTimeScale;
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
    this.publicConfig = {
      testMode: this.cfg.testMode,
      network: this.chain.network,
      contractId: this.chain.contractId,
      tokenId: this.chain.tokenId,
      tokenSymbol: this.chain.network === 'testnet' ? 'tREAL' : 'REAL',
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
      explorerTx: `https://${this.chain.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/{hash}`,
      explorerAccount: `https://${this.chain.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/address/{account}`,
    };
    this.loadUsers();
    await this.resume();
    if (!this.current) await this.startRound();
    this.housekeeping = setInterval(() => this.housekeep(), 30_000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.housekeeping) clearInterval(this.housekeeping);
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
    for (const t of this.chain.testUsers) {
      this.labels.set(t.accountId, t.label);
      if (!this.users.has(t.accountId)) {
        const u: UserRec = {
          account: t.accountId, label: t.label, rating: RATING_START, chats: 0, right: 0, wrong: 0, streak: 0, bestStreak: 0,
          lockedBonus: '0', freeDay: utcDay(), freeUsed: 0,
        };
        this.users.set(u.account, u);
        this.db.saveUser(u.account, u);
      }
    }
  }

  private saveUser(u: UserRec): void {
    this.db.saveUser(u.account, u);
  }

  isTestUser(account: string): boolean {
    return this.labels.has(account);
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
      if (this.current) this.db.pruneAttestationRaw(this.current.id - 30);
      for (const r of this.rounds.values()) if (r.status === 'settling' && !this.settling.has(r.id)) void this.settle(r);
      if (!this.current && !this.startingRound && !this.stopped) void this.startRound();
    } catch (e) {
      log.error('housekeeping', e);
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
          acceptingUntil: endsAt - (this.cfg.chatSeconds + this.cfg.callSeconds + 15) * 1000,
          status: 'open', ready: false, endedEarly: false, startOk: false, commitTxs: [], openTxs: [], resultsDone: false, attest: {},
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

    const models = [...new Set(this.personas.map((p) => p.model))];
    const missing = models.filter((m) => !r.attest[m]?.ok);
    await Promise.all(missing.map((m) => this.attest(r, m)));

    const cm = this.chars.get(r.id)!;
    const haveBots = [...cm.values()].some((c) => c.kind === 'bot');
    if (!haveBots) {
      for (const p of this.personas) {
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

  private addBotCharacter(r: RoundRec, p: Persona, level: Level, signers: string[]): CharacterRec {
    const id = newCharacterId();
    const salt = newSalt();
    const sorted = normalizeSigners(signers);
    const payout = this.chain.accounts.bots;
    const preimage = botPreimage({ roundId: r.id, characterId: id, model: p.model, promptHash: p.promptHash, signers: sorted, payout, salt });
    const c: CharacterRec = {
      id, roundId: r.id, kind: 'bot', level, personaId: p.id, model: p.model, prompt: p.prompt, promptHash: p.promptHash,
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

  /** First connect of a test user in a round: their human character (payout own account if balance > 0, else promo). */
  async ensureHuman(account: string): Promise<void> {
    const r = this.current;
    if (!r || (r.status !== 'open' && r.status !== 'closing') || Date.now() >= r.endsAt - 5000) return;
    if (!this.isTestUser(account) || this.humanChar(r, account) || this.creatingHuman.has(account)) return;
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
      if (!this.stopped) await this.startRound();
    }
    void this.settle(r);
  }

  /** Test mode: force-end chats with a short call window, end_round_now, start the next round, settle. */
  async devEndRound(): Promise<void> {
    if (!this.cfg.testMode || !this.chainCfg.testMode) throw new GameError('not_test_mode', 'dev end-round needs test mode', 403);
    const r = this.current;
    if (!r) throw new GameError('no_round', 'no open round', 409);
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
          await this.startRound();
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
        if (!r.resultsDone) await this.computeAndStore(r);
        r.status = 'settled';
        r.settledAt = r.settledAt ?? Date.now();
        r.lastError = undefined;
        this.saveRound(r);
        this.forgetRound(r);
        this.broadcast({ t: 'results_ready', roundId: r.id });
        for (const account of this.conns.keys()) void this.pushMe(account);
        log.info(`round ${r.id} results ready`);
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
    const paidSides = this.roundSides(r.id).filter((s) => s.characterId === c.id && s.playStatus === 'placed');
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

  private async computeAndStore(r: RoundRec): Promise<void> {
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
    const sql = this.db.sql;
    sql.exec('BEGIN');
    try {
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
        const persona = this.personas.find((p) => p.id === c.personaId);
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
    void this.ensureHuman(a).catch((e) => log.warn(`ensureHuman ${a}`, e));
    try {
      const me = await this.me(a);
      conn.send({ t: 'welcome', me, round: this.roundState(), config: this.publicConfig, activeChat: this.activeChatOf(a) });
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
          await this.pickSeat(a, msg.level, msg.seatIndex, msg.mode, msg.coins);
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

  async pickSeat(account: string, level: Level, seatIndex: number, mode: Mode, coins?: number): Promise<void> {
    this.assertLevel(level);
    const r = this.current;
    const now = Date.now();
    if (!r || r.status !== 'open' || now >= r.acceptingUntil) throw new GameError('round_closed', 'no new chats in this round; the next round starts soon');
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 9) throw new GameError('bad_seat', 'seatIndex must be 0..9');
    if (mode !== 'free' && mode !== 'paid') throw new GameError('bad_mode', 'mode must be free or paid');
    const user = this.users.get(account);
    if (!user) throw new GameError('unknown_user', 'not a test user', 403);
    if (level > this.levelUnlocked(user)) throw new GameError('level_locked', `level ${level} is locked`);
    if (this.searches.has(account)) throw new GameError('already_searching', 'already searching');
    const busy = [...this.sides.values()].find((s) => s.viewer === account && (s.phase === 'placing' || s.phase === 'chatting' || s.phase === 'calling'));
    if (busy) throw new GameError('busy', 'finish your current chat first');
    const seat = this.seatOf(r.id, account, level, seatIndex);
    if (seat.state !== 'open') throw new GameError('seat_taken', `seat is ${seat.state}`);
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
    const s: Search = { account, roundId: r.id, level, seatIndex, mode, coins: c, startedAt: now, deadline: now + delay, timer: null, resolving: false };
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
    const pendingHuman = (a: string) => {
      const c = this.humanChar(r, a);
      return !!c && (c.commitStatus === 'pending' || c.commitStatus === 'sending');
    };
    const others = [...this.searches.values()].filter((o) => o.account !== account && o.roundId === s.roundId);
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
    let bots = [...(this.chars.get(r.id)?.values() ?? [])].filter(
      (c) => c.kind === 'bot' && c.level === s.level && c.commitStatus === 'committed' && !this.viewerChatted(r.id, account, c.id),
    );
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
    this.startBotChat(r, s, pick(bots));
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
        res = await Promise.race([
          this.chain.play(side.viewer, side.roundId, side.handle, side.coins),
          sleep(45_000).then(() => ({ ok: false, hash: '', error: 'play timed out' })),
        ]);
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
    conv.started = true;
    const now = Date.now();
    const endsAt = now + this.cfg.chatSeconds * 1000;
    for (const s of ss) {
      s.phase = 'chatting';
      s.startedAt = now;
      s.endsAt = endsAt;
      this.saveSide(s);
      this.sendTo(s.viewer, { t: 'chat_started', chatId: s.chatId, startedAt: now, endsAt });
    }
    conv.endTimer = setTimeout(() => this.endConv(conv, 'time', this.cfg.callSeconds * 1000), endsAt - now);
    if (conv.kind === 'bot') {
      const side = ss[0];
      const c = this.chars.get(side.roundId)?.get(side.characterId);
      const persona = this.personas.find((p) => p.id === c?.personaId);
      const r = this.rounds.get(side.roundId);
      if (!c || !persona || !r) {
        log.error(`bot chat ${side.chatId}: persona missing`);
        return;
      }
      const session = new BotSession(this, side, persona, side.skinMessage!, r.attest[persona.model]?.attested ?? []);
      this.bots.set(side.chatId, session);
      session.start();
    }
  }

  isChatting(side: ChatSide): boolean {
    return side.phase === 'chatting' && !this.stopped;
  }

  private appendMessage(side: ChatSide, m: StoredMsg): void {
    side.messages.push(m);
    this.db.addMessage(side.chatId, side.messages.length - 1, m);
    this.sendTo(side.viewer, { t: 'message', chatId: side.chatId, msg: this.publicMsg(m) });
  }

  botSay(side: ChatSide, text: string, completionIndex: number): void {
    if (side.phase !== 'chatting') return;
    this.appendMessage(side, { id: randomId(6), from: 'them', text, at: Date.now(), ci: completionIndex });
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
      this.bots.get(side.chatId)?.onPlayerMessage();
    }
  }

  typing(account: string, chatId: string, on: boolean): void {
    const side = this.sideOf(account, chatId);
    if (side.partnerKind !== 'human' || !side.partnerChatId || side.phase !== 'chatting') return;
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
      const res = await this.chain.call(account, side.roundId, side.handle, human);
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
    if (!u) throw new GameError('unknown_user', `${account} is not a test user`, 404);
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
    };
  }

  async testUsers(): Promise<TestUser[]> {
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

  async faucet(account: string, coins = 100): Promise<{ tx: string; me: Me }> {
    if (!this.cfg.testMode) throw new GameError('not_test_mode', 'faucet is test mode only', 403);
    if (!this.isTestUser(account)) throw new GameError('unknown_user', `${account} is not a test user`, 404);
    const c = Number(coins);
    if (!Number.isFinite(c) || c <= 0 || c > 10_000) throw new GameError('bad_coins', 'coins must be between 0 and 10000');
    const res = await this.chain.faucetDeposit(account, coinsToUnits(c, this.coinUnit));
    if (!res.ok) throw new GameError('faucet_failed', res.error ?? 'deposit failed', 502);
    this.db.logTx({ at: Date.now(), roundId: null, kind: 'faucet', signer: this.chain.accounts.faucet, hash: res.hash, ok: true, error: null, ms: null });
    const u = this.users.get(account)!;
    const bonus = BigInt(u.lockedBonus || '0');
    if (bonus > 0n) {
      const t = await this.chain.transfer(this.chain.accounts.promo, account, bonus);
      if (t.ok) {
        u.lockedBonus = '0';
        this.saveUser(u);
        log.info(`locked Turing bonus of ${unitsToCoins(bonus, this.coinUnit)} coins paid to ${account} from promo: ${t.hash}`);
      } else log.warn(`locked bonus transfer to ${account} failed, kept for the next deposit: ${t.error}`);
    }
    this.balances.delete(account);
    const me = await this.me(account, 0);
    this.sendTo(account, { t: 'me', me });
    return { tx: res.hash, me };
  }

  async withdraw(account: string, coins: number): Promise<{ tx: string; me: Me }> {
    if (!this.isTestUser(account)) throw new GameError('unknown_user', `${account} is not a test user`, 404);
    const c = Number(coins);
    if (!Number.isFinite(c) || c <= 0) throw new GameError('bad_coins', 'coins must be positive');
    const bal = await this.balanceOf(account, 0);
    const balCoins = unitsToCoins(bal, this.coinUnit);
    const amount = c >= balCoins - 1e-9 ? bal : coinsToUnits(c, this.coinUnit);
    if (amount <= 0n || amount > bal) throw new GameError('insufficient_balance', 'not enough coins');
    const res = await this.chain.withdraw(account, amount);
    if (!res.ok) throw new GameError('withdraw_failed', res.error ?? 'withdraw failed', 502);
    this.balances.delete(account);
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
    if (!this.users.has(account)) throw new GameError('unknown_user', `${account} is not a test user`, 404);
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
      queues: this.chain.queueDepth(),
      ai: this.ai.kind,
      chain: this.chain.kind,
      completions: this.db.completionStats(),
    };
  }
}
