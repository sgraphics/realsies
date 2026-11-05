// NEAR AI spend and credit state per key: the relay's own key ("house") and every botmaster's own key
// ("byok:<botmaster>"). Spend is the response's `usage` times the model's price (src/models.ts), kept in the
// DB across restarts. NEAR_AI_BUDGET_USD applies to the house key: crossing 80% of it logs a warning and the
// health status turns `low_credit`. A credit or billing failure from NEAR AI (HTTP 402, or a 400 or 403 that
// mentions credits, balance, quota or billing; never a 429 or a 5xx) or a rejected key (HTTP 401) marks the
// key out: from then on the game matches no player with a bot that uses it (with the house key out, no new
// chat starts at all), and the monitor retries a one-token completion every NEAR_AI_RECHECK_SECONDS until
// the key works again. Any successful call with the key recovers it at once.
import type { Db } from '../db.js';
import type { AttestationResult, CompletionResult, ModelListing, NearAi } from './client.js';
import type { SignaturePayload } from '../../../shared/protocol.js';
import { MODELS, chatCostUsd, modelInfo } from '../models.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('credits');

export type AiStatus = 'ok' | 'low_credit' | 'out_of_credits';

export interface KeyFailure {
  kind: 'credits' | 'auth';
  detail: string;
}

const CREDIT_WORDS = /\b(credits?|balance|quota|billing|insufficient[_ ]funds|payment[_ ]required)\b/i;

/**
 * Why a failed NEAR AI response means the key cannot be used, or null: HTTP 402, or a 400 or 403 whose error
 * mentions credits, balance, quota or billing (out of credits); HTTP 401 (the key is rejected). Never a 429 or
 * a 5xx, whatever they say: rate limits often mention "quota", and both pass on their own.
 */
export function keyFailure(status: number, response: string): KeyFailure | null {
  if (status >= 200 && status < 300) return null;
  // network trouble says nothing about the key; rate limits and server errors are transient
  if (status === 0 || status === 429 || status >= 500) return null;
  let text = '';
  try {
    const j = JSON.parse(response);
    const e = j?.error && typeof j.error === 'object' ? j.error : j;
    text = [e?.message, e?.type, e?.code, typeof j?.error === 'string' ? j.error : undefined, j?.detail, j?.message]
      .filter((x) => typeof x === 'string')
      .join(' ');
  } catch {
    /* not JSON */
  }
  if (!text) text = String(response ?? '').slice(0, 400);
  const detail = `HTTP ${status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;
  if (status === 402 || ((status === 400 || status === 403) && CREDIT_WORDS.test(text))) return { kind: 'credits', detail };
  if (status === 401) return { kind: 'auth', detail };
  return null;
}

/** prompt and completion tokens from exact response bytes */
export function usageOf(response: string): { input: number; output: number } | null {
  try {
    const u = JSON.parse(response)?.usage;
    if (!u || typeof u !== 'object') return null;
    const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0);
    const output = Number(u.completion_tokens ?? u.output_tokens ?? 0);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    return { input: Math.max(0, input), output: Math.max(0, output) };
  } catch {
    return null;
  }
}

/** USD of one completion at the model's list price (cached input is billed lower; this errs high). */
export function costUsd(model: string, usage: { input: number; output: number } | null): number {
  const m = MODELS[model];
  if (!m || !usage) return 0;
  return (usage.input * m.price.input + usage.output * m.price.output) / 1e6;
}

/** The cheapest model a persona may use: the one-token recheck goes there. */
export function cheapestModel(): string {
  return Object.values(MODELS).filter((m) => m.multiSystem).sort((a, b) => chatCostUsd(a.id) - chatCostUsd(b.id))[0].id;
}

/** The smallest useful completion (about 15 input tokens, 1 output token: a millionth of a dollar). */
export function tinyRequest(model = cheapestModel()): string {
  return JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the word ok.' }], stream: false, max_tokens: 1, ...modelInfo(model).request });
}

export interface KeyState {
  keyId: string;
  /** first 12 hex of sha256(key): a different key under the same id starts a fresh record */
  fingerprint: string;
  spendUsd: number;
  calls: number;
  /** from a credit failure (or a rejected key) until a call with the key succeeds again */
  out: boolean;
  outKind?: KeyFailure['kind'];
  outReason?: string;
  status: AiStatus;
  /** when the current status began */
  since: number;
  createdAt: number;
  lastCheckAt?: number;
  nextCheckAt?: number;
  warned80?: boolean;
  warned100?: boolean;
}

export interface AiHealth {
  status: AiStatus;
  since: number;
  spendUsd: number;
  budgetUsd: number;
  /** why the key is out (extra) */
  reason?: string;
}

export interface CreditOptions {
  budgetUsd: number;
  recheckMs: number;
  now?: () => number;
}

export class CreditMonitor {
  readonly budgetUsd: number;
  readonly recheckMs: number;
  private now: () => number;
  private states = new Map<string, KeyState>();
  private checking = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** the raw client of a key, for the one-token recheck (the game registers house and BYOK keys) */
  clientFor: (keyId: string) => NearAi | undefined = () => undefined;
  /** a key went out, recovered, or crossed into low credit */
  onChange?: (s: KeyState, before: AiStatus) => void;

  constructor(private db: Db, opts: CreditOptions) {
    this.budgetUsd = opts.budgetUsd;
    this.recheckMs = Math.max(200, opts.recheckMs);
    this.now = opts.now ?? Date.now;
  }

  private budgetOf(keyId: string): number | undefined {
    return keyId === 'house' && this.budgetUsd > 0 ? this.budgetUsd : undefined;
  }

  private load(keyId: string): KeyState | undefined {
    const raw = this.db.getKv(`ai_credit:${keyId}`);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as KeyState;
    } catch {
      return undefined;
    }
  }

  private save(s: KeyState, now = false): void {
    this.dirty.add(s.keyId);
    if (now) return this.flush();
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 1000);
    this.flushTimer.unref?.();
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const id of this.dirty) {
      const s = this.states.get(id);
      if (s) this.db.setKv(`ai_credit:${id}`, JSON.stringify(s));
    }
    this.dirty.clear();
  }

  /** Attach a key id to a key; a key with another fingerprint than the stored one starts fresh. */
  bind(keyId: string, fingerprint: string): KeyState {
    let s = this.states.get(keyId) ?? this.load(keyId);
    if (!s || s.fingerprint !== fingerprint) {
      const t = this.now();
      s = { keyId, fingerprint, spendUsd: 0, calls: 0, out: false, status: 'ok', since: t, createdAt: t };
      this.states.set(keyId, s);
      this.save(s, true);
    } else this.states.set(keyId, s);
    if (s.out && !s.nextCheckAt) s.nextCheckAt = this.now();
    return s;
  }

  /** Forget a key (a botmaster removed its own key). */
  drop(keyId: string): void {
    this.states.delete(keyId);
    this.dirty.delete(keyId);
    this.db.setKv(`ai_credit:${keyId}`, '');
  }

  state(keyId: string): KeyState | undefined {
    const s = this.states.get(keyId);
    if (s) return s;
    const l = this.load(keyId);
    if (l) this.states.set(keyId, l);
    return l;
  }

  /** A bot that uses this key may be matched: the key is not out of credits. */
  usable(keyId: string): boolean {
    return !this.state(keyId)?.out;
  }

  status(keyId: string): AiStatus {
    return this.state(keyId)?.status ?? 'ok';
  }

  private statusOf(s: KeyState): AiStatus {
    if (s.out) return 'out_of_credits';
    const b = this.budgetOf(s.keyId);
    return b !== undefined && s.spendUsd >= 0.8 * b ? 'low_credit' : 'ok';
  }

  private refresh(s: KeyState): void {
    const before = s.status;
    const st = this.statusOf(s);
    const b = this.budgetOf(s.keyId);
    if (b !== undefined) {
      if (!s.warned80 && s.spendUsd >= 0.8 * b) {
        s.warned80 = true;
        log.warn(`NEAR AI spend on the ${s.keyId} key is $${s.spendUsd.toFixed(4)}, 80% of the $${b} budget (NEAR_AI_BUDGET_USD); add credits or expect bots to stop`);
      }
      if (!s.warned100 && s.spendUsd >= b) {
        s.warned100 = true;
        log.warn(`NEAR AI spend on the ${s.keyId} key passed the $${b} budget ($${s.spendUsd.toFixed(4)}); bots keep running until NEAR AI refuses a call`);
      }
    }
    if (st !== before) {
      s.status = st;
      s.since = this.now();
      this.save(s, true);
      try {
        this.onChange?.(s, before);
      } catch (e) {
        log.warn(`credit change hook: ${errMsg(e)}`);
      }
    } else this.save(s);
  }

  private ensure(keyId: string): KeyState {
    return this.state(keyId) ?? this.bind(keyId, 'unbound');
  }

  /** Every completion made with a key passes through here (TrackedAi). */
  observe(keyId: string, model: string, res: CompletionResult): void {
    const s = this.ensure(keyId);
    if (res.ok) {
      s.spendUsd += costUsd(model, usageOf(res.response));
      s.calls++;
      if (s.out) this.recover(s, 'a call succeeded');
      this.refresh(s);
      return;
    }
    const f = keyFailure(res.status, res.response);
    if (f) this.markOut(keyId, f);
  }

  markOut(keyId: string, f: KeyFailure): void {
    const s = this.ensure(keyId);
    s.outReason = f.detail;
    s.outKind = f.kind;
    if (!s.out) {
      s.out = true;
      s.nextCheckAt = this.now() + this.recheckMs;
      log.warn(
        `NEAR AI key ${keyId} ${f.kind === 'credits' ? 'is out of credits' : 'was rejected'} (${f.detail}); no player is matched with a bot that uses it ` +
          `until it works again (rechecked every ${+(this.recheckMs / 1000).toFixed(1)} s)`,
      );
    }
    this.refresh(s);
  }

  private recover(s: KeyState, how: string): void {
    s.out = false;
    s.outReason = undefined;
    s.outKind = undefined;
    s.nextCheckAt = undefined;
    log.info(`NEAR AI key ${s.keyId} works again (${how}); its bots are matched again`);
  }

  /** Add spend recorded elsewhere (the one-time backfill from stored completions). */
  addSpend(keyId: string, usd: number, calls: number): void {
    const s = this.ensure(keyId);
    s.spendUsd += usd;
    s.calls += calls;
    this.refresh(s);
  }

  /** The one-token completion: back to ok when it succeeds. */
  async recheck(keyId: string): Promise<boolean> {
    const s = this.state(keyId);
    if (!s || !s.out) return true;
    if (this.checking.has(keyId)) return false;
    const client = this.clientFor(keyId);
    s.lastCheckAt = this.now();
    s.nextCheckAt = this.now() + this.recheckMs;
    if (!client) {
      this.save(s);
      return false;
    }
    this.checking.add(keyId);
    try {
      const model = cheapestModel();
      const res = await client.complete(model, tinyRequest(model));
      this.observe(keyId, model, res);
      if (!res.ok) log.info(`NEAR AI key ${keyId} recheck: still unusable (${keyFailure(res.status, res.response)?.detail ?? res.error ?? `HTTP ${res.status}`})`);
      return res.ok;
    } catch (e) {
      log.info(`NEAR AI key ${keyId} recheck failed: ${errMsg(e)}`);
      return false;
    } finally {
      this.checking.delete(keyId);
      this.save(s);
    }
  }

  private tick(): void {
    const now = this.now();
    for (const s of this.states.values()) if (s.out && (s.nextCheckAt ?? 0) <= now) void this.recheck(s.keyId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), Math.min(15_000, Math.max(100, Math.floor(this.recheckMs / 4))));
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  health(keyId = 'house'): AiHealth {
    const s = this.state(keyId);
    const out: AiHealth = {
      status: s?.status ?? 'ok',
      since: s?.since ?? 0,
      spendUsd: Math.round((s?.spendUsd ?? 0) * 1e6) / 1e6,
      budgetUsd: this.budgetUsd,
    };
    if (s?.out && s.outReason) out.reason = s.outReason;
    return out;
  }

  /** What anyone may see (GET /api/health): the status and since when; spend, budget and reasons are the operator's. */
  publicHealth(keyId = 'house'): Pick<AiHealth, 'status' | 'since'> {
    const h = this.health(keyId);
    return { status: h.status, since: h.since };
  }

  /** Every key the relay has tracked, the house key first (GET /api/admin/health). */
  all(): { keyId: string; status: AiStatus; since: number; spendUsd: number; calls: number; reason?: string }[] {
    const ids = (this.db.sql.prepare("SELECT key FROM kv WHERE key LIKE 'ai_credit:%' AND value != '' ORDER BY key").all() as { key: string }[]).map((r) => r.key.slice('ai_credit:'.length));
    for (const id of this.states.keys()) if (!ids.includes(id)) ids.push(id);
    return ids
      .sort((a, b) => (a === 'house' ? -1 : b === 'house' ? 1 : a.localeCompare(b)))
      .map((keyId) => {
        const s = this.state(keyId);
        const h = this.health(keyId);
        return { keyId, status: h.status, since: h.since, spendUsd: h.spendUsd, calls: s?.calls ?? 0, ...(h.reason ? { reason: h.reason } : {}) };
      });
  }
}

/** A NearAi whose completions feed the monitor (spend, credit failures, recovery) under one key id. */
export class TrackedAi implements NearAi {
  readonly models?: () => Promise<ModelListing[]>;
  constructor(readonly inner: NearAi, readonly keyId: string, private monitor: CreditMonitor) {
    if (inner.models) this.models = () => inner.models!();
  }
  get kind(): 'real' | 'mock' {
    return this.inner.kind;
  }
  attest(model: string, nonce: string): Promise<AttestationResult> {
    return this.inner.attest(model, nonce);
  }
  async complete(model: string, request: string): Promise<CompletionResult> {
    const res = await this.inner.complete(model, request);
    this.monitor.observe(this.keyId, model, res);
    return res;
  }
  signature(completionId: string, maxMs: number): Promise<SignaturePayload | null> {
    return this.inner.signature(completionId, maxMs);
  }
}

/**
 * Spend already made with the house key before tracking began: usage of every stored completion and draft.
 * Runs once (kv ai_credit_backfilled), on the real NEAR AI only.
 */
export function backfillSpend(db: Db): { usd: number; calls: number } {
  let usd = 0;
  let calls = 0;
  // completions keep their model in a column; drafts in the request bytes
  const queries = [
    'SELECT rowid AS r, model, NULL AS request, response FROM completions WHERE rowid > ? ORDER BY rowid LIMIT 500',
    'SELECT rowid AS r, NULL AS model, request, response FROM bot_drafts WHERE rowid > ? ORDER BY rowid LIMIT 500',
  ];
  for (const q of queries) {
    let after = 0;
    for (;;) {
      const rows = db.sql.prepare(q).all(after) as { r: number; model: string | null; request: string | null; response: string }[];
      if (!rows.length) break;
      for (const row of rows) {
        after = row.r;
        let model = row.model ?? '';
        if (!model) {
          try {
            model = String(JSON.parse(row.request ?? '{}')?.model ?? JSON.parse(row.response)?.model ?? '');
          } catch {
            continue;
          }
        }
        const c = costUsd(model, usageOf(row.response));
        if (c > 0) {
          usd += c;
          calls++;
        }
      }
    }
  }
  return { usd, calls };
}
