// Real chain adapter on near-api-js 7.x (contracts/game/README.md for args and views).
// One serial queue per signing key keeps nonces in order. Each transaction is signed once with a
// fresh block hash and the same signed bytes are re-sent on rate limits or network errors (same
// hash, so idempotent); "expired" or nonce errors re-sign with a fresh nonce lookup.
import fs from 'node:fs';
import { Account, JsonRpcProvider, KeyPairSigner, SignedTransaction, actions, baseEncode } from 'near-api-js';
import type {
  AccessKeyView, ChainAccounts, ChainAdapter, ChainCharacter, ChainConfig, ChainPlay, ChainRound, CommitItem, OpenReport, Opening,
  TestUserKey, TxDetails, TxOutcome,
} from './types.js';
import { SerialQueue, sleep, errMsg } from '../util.js';
import { txHashOf } from '../auth/tx.js';
import { logger } from '../log.js';

const log = logger('near');
const TGAS = 1_000_000_000_000n;

interface KeyEntry {
  accountId: string;
  privateKey: string;
}

/**
 * relay/.secrets/<network>.json. Testnet (test mode): every key below. Mainnet: no faucet and no test users;
 * the coin (`tokenId`) may be left out while the contract has none, it is read from the contract's get_config.
 */
export interface Secrets {
  network: 'testnet' | 'mainnet';
  rpc: string[];
  contractId: string;
  tokenId?: string;
  tokenDecimals: number;
  operator: KeyEntry;
  /** test mode only: holds test coins and sends them (full-access key: ft_transfer_call needs 1 yoctoNEAR) */
  faucet?: KeyEntry;
  promo: KeyEntry;
  accounts: { fund: string; house: string; bots: string };
  /** test mode only: accounts whose plays and calls the relay signs */
  testUsers?: (KeyEntry & { label: string })[];
}

export function readSecrets(file: string): Secrets {
  const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Secrets;
  for (const k of ['contractId', 'operator', 'promo', 'accounts'] as const) {
    if (!s[k]) throw new Error(`secrets file is missing ${k}`);
  }
  if (!Array.isArray(s.testUsers)) s.testUsers = [];
  const mainnet = s.network === 'mainnet';
  if (!Array.isArray(s.rpc) || s.rpc.length === 0) {
    s.rpc = mainnet ? ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'] : ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];
  }
  return s;
}

/** A NEAR RPC error that means "no such account, key or transaction" rather than trouble. */
function notFound(e: unknown): boolean {
  return /does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|UNKNOWN_TRANSACTION|doesn't exist|AccessKeyDoesNotExist/i.test(errMsg(e));
}

type Wait = 'NONE' | 'INCLUDED' | 'EXECUTED_OPTIMISTIC' | 'INCLUDED_FINAL' | 'EXECUTED' | 'FINAL';

interface Signing {
  accountId: string;
  signer: KeyPairSigner;
  queue: SerialQueue;
  account: Account | null; // recreated after nonce or expiry errors (fresh nonce lookup)
  providerIndex: number;
}

function classify(e: unknown): 'rate' | 'network' | 'expired' | 'nonce' | 'timeout' | 'other' {
  const m = `${errMsg(e)} ${(e as any)?.cause ?? ''} ${(e as any)?.type ?? ''} ${(e as any)?.name ?? ''}`.toLowerCase();
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) return 'rate';
  if (m.includes('expired')) return 'expired';
  if (m.includes('nonce')) return 'nonce';
  if (m.includes('timeout') || m.includes('408')) return 'timeout';
  if (
    m.includes('fetch failed') || m.includes('econnreset') || m.includes('etimedout') || m.includes('socket') ||
    m.includes('unavailable') || m.includes('bad gateway') || m.includes('internal server error') || m.includes('retriesexceeded') ||
    m.includes('exceeded') || m.includes('enotfound') || m.includes('eai_again') || m.includes('network') || m.includes('aborted')
  ) return 'network';
  return 'other';
}

/** Human-readable failure from a transaction status, e.g. "Smart contract panicked: round is closed". */
function failureText(f: unknown): string {
  try {
    const fe = (f as any)?.ActionError?.kind?.FunctionCallError;
    if (fe?.ExecutionError) return String(fe.ExecutionError);
    if (fe) return JSON.stringify(fe);
    return JSON.stringify(f);
  } catch {
    return String(f);
  }
}

function decodeSuccess(v: string | undefined): unknown {
  if (!v) return undefined;
  const s = Buffer.from(v, 'base64').toString('utf8');
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export class NearChain implements ChainAdapter {
  readonly kind = 'near' as const;
  readonly network: 'testnet' | 'mainnet';
  readonly contractId: string;
  tokenId: string;
  readonly tokenDecimals: number;
  readonly accounts: ChainAccounts;
  readonly testUsers: TestUserKey[];
  private rpc: string[];
  private providers: JsonRpcProvider[];
  private keys = new Map<string, Signing>();
  /** one queue per player: their signed transactions go out in nonce order, one at a time */
  private playerQueues = new Map<string, SerialQueue>();
  private storageMin: string | null = null;
  private viewIndex = 0;
  /** Called for every transaction attempt result, for the tx log. */
  onTx?: (t: { method: string; signer: string; hash: string | null; ok: boolean; error?: string; ms: number }) => void;

  /** `withTestUsers` false (TEST_MODE=0): the secrets file's test users are ignored, keys and all. */
  constructor(private secrets: Secrets, opts: { withTestUsers?: boolean } = {}) {
    this.network = secrets.network || 'testnet';
    this.contractId = secrets.contractId;
    this.tokenId = secrets.tokenId ?? '';
    this.tokenDecimals = secrets.tokenDecimals ?? 18;
    this.accounts = {
      operator: secrets.operator.accountId,
      faucet: secrets.faucet?.accountId ?? '',
      promo: secrets.promo.accountId,
      fund: secrets.accounts.fund,
      house: secrets.accounts.house,
      bots: secrets.accounts.bots,
    };
    const users = opts.withTestUsers === false ? [] : secrets.testUsers ?? [];
    this.testUsers = users.map((u) => ({ accountId: u.accountId, label: u.label }));
    this.rpc = secrets.rpc;
    // near-api-js retries 500/503/408 on its own; keep that short, we fail over ourselves.
    this.providers = this.rpc.map((url) => new JsonRpcProvider({ url }, { retries: 3, wait: 400, backoff: 1.6 }));
    const add = (k: KeyEntry) =>
      this.keys.set(k.accountId, {
        accountId: k.accountId,
        signer: KeyPairSigner.fromSecretKey(k.privateKey as any),
        queue: new SerialQueue(),
        account: null,
        providerIndex: 0,
      });
    add(secrets.operator);
    if (secrets.faucet) add(secrets.faucet);
    add(secrets.promo);
    for (const u of users) add(u);
  }

  async init(): Promise<void> {
    const cfg = await this.getConfig();
    log.info(
      `connected to ${this.contractId} on ${this.network}: coin ${cfg.token ?? 'not set'}, coin_unit ${cfg.coinsOpen ? cfg.coinUnit : 'not set'}, ` +
        `test_mode ${cfg.testMode}, latest_round ${(cfg.raw as any)?.latest_round}`,
    );
  }

  queueDepth(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [a, k] of this.keys) if (k.queue.pending) out[a] = k.queue.pending;
    return out;
  }

  // ---------- views over raw JSON-RPC with failover ----------
  private async rpcCall(method: string, params: unknown): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      const url = this.rpc[this.viewIndex % this.rpc.length];
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'r', method, params }),
          signal: AbortSignal.timeout(15_000),
        });
        if (r.status === 429 || r.status >= 500) {
          lastErr = new Error(`${url} http ${r.status} ${(await r.text()).slice(0, 120)}`);
          this.viewIndex++;
          await sleep(300 * (attempt + 1));
          continue;
        }
        const j: any = await r.json();
        if (j.error) {
          const msg = JSON.stringify(j.error);
          if (/rate limit|too many/i.test(msg)) {
            lastErr = new Error(msg);
            this.viewIndex++;
            await sleep(300 * (attempt + 1));
            continue;
          }
          throw new Error(msg);
        }
        if (j.result?.error) throw new Error(String(j.result.error));
        return j.result;
      } catch (e) {
        lastErr = e;
        const c = classify(e);
        if (c === 'other') throw e;
        this.viewIndex++;
        await sleep(300 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async view<T = unknown>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.rpcCall('query', {
      request_type: 'call_function',
      finality: 'optimistic',
      account_id: contractId,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    });
    const bytes = Buffer.from(result.result as number[]);
    const s = bytes.toString('utf8');
    return (s ? JSON.parse(s) : null) as T;
  }

  async getConfig(): Promise<ChainConfig> {
    const c = await this.view<any>(this.contractId, 'get_config', {});
    // the contract's coin wins over the secrets file (on mainnet it is set at the token launch)
    if (c.token) this.tokenId = c.token;
    return {
      coinUnit: BigInt(c.coin_unit ?? '1000000000000000000'),
      feeBps: c.params.fee_bps,
      rightBps: c.params.right_bps,
      characterBps: c.params.character_bps,
      minCoins: c.params.min_coins,
      maxCoins: c.params.max_coins,
      callGraceMs: c.params.call_grace_ms,
      openWindowMs: c.params.open_window_ms,
      testMode: !!c.test_mode,
      token: c.token ?? undefined,
      coinsOpen: !!c.token && !!c.coin_unit,
      raw: c,
    };
  }

  async viewAccessKey(accountId: string, publicKey: string, _hint?: 'full' | 'play'): Promise<AccessKeyView | null> {
    let r: any;
    try {
      r = await this.rpcCall('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
    const p = r.permission;
    const fc = p && typeof p === 'object' ? p.FunctionCall : null;
    return {
      nonce: BigInt(r.nonce),
      blockHash: r.block_hash,
      blockHeight: r.block_height,
      permission: p === 'FullAccess' ? 'FullAccess' : { receiverId: fc?.receiver_id ?? '', methodNames: fc?.method_names ?? [], allowance: fc?.allowance ?? null },
    };
  }

  async tokenStorage(accountId: string): Promise<{ registered: boolean; minDeposit: string }> {
    if (!this.tokenId) return { registered: false, minDeposit: '0' };
    if (!this.storageMin) {
      const b = await this.view<any>(this.tokenId, 'storage_balance_bounds', {}).catch(() => null);
      this.storageMin = b?.min ?? '1250000000000000000000';
    }
    const bal = await this.view<any>(this.tokenId, 'storage_balance_of', { account_id: accountId });
    return { registered: bal !== null && bal !== undefined, minDeposit: this.storageMin! };
  }

  async txDetails(hash: string, signerId: string): Promise<TxDetails | null> {
    let r: any;
    try {
      r = await this.rpcCall('tx', { tx_hash: hash, sender_account_id: signerId, wait_until: 'EXECUTED_OPTIMISTIC' });
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
    const t = r.transaction ?? {};
    const st = r.status;
    const failed = st && typeof st === 'object' && 'Failure' in st;
    const receiptFail = (r.receipts_outcome ?? []).find((x: any) => x?.outcome?.status && typeof x.outcome.status === 'object' && 'Failure' in x.outcome.status);
    const logs = [...(r.transaction_outcome?.outcome?.logs ?? []), ...(r.receipts_outcome ?? []).flatMap((x: any) => x?.outcome?.logs ?? [])];
    return {
      hash: t.hash ?? hash,
      ok: !failed && !receiptFail,
      signerId: t.signer_id,
      receiverId: t.receiver_id,
      actions: (t.actions ?? []).map((a: any) => {
        const fc = a?.FunctionCall;
        if (!fc) return {};
        let args: unknown = undefined;
        try {
          args = JSON.parse(Buffer.from(fc.args ?? '', 'base64').toString('utf8'));
        } catch {
          args = undefined;
        }
        return { method: fc.method_name, args, deposit: String(fc.deposit ?? '0') };
      }),
      logs,
      error: failed ? failureText(st.Failure) : receiptFail ? failureText(receiptFail.outcome.status.Failure) : undefined,
    };
  }
  async balanceOf(account: string): Promise<bigint> {
    const v = await this.view<string>(this.contractId, 'balance_of', { account_id: account });
    return BigInt(v ?? '0');
  }
  async getRound(roundId: number): Promise<ChainRound | null> {
    const r = await this.view<any>(this.contractId, 'get_round', { round_id: roundId });
    if (!r) return null;
    return {
      roundId: r.round_id,
      secretHash: r.secret_hash,
      endsAtMs: r.ends_at_ms,
      revealed: r.status === 'revealed' || r.status === 'settled',
      settled: r.status === 'settled',
      plays: typeof r.plays === 'number' ? r.plays : undefined,
      characters: Array.isArray(r.characters) ? r.characters.length : undefined,
      raw: r,
    };
  }
  async getCharacter(roundId: number, characterId: string): Promise<ChainCharacter | null> {
    const c = await this.view<any>(this.contractId, 'get_character', { round_id: roundId, character_id: characterId });
    if (!c) return null;
    return { characterId: c.character_id, commitment: c.commitment, opened: !!c.opened, kind: c.opened?.kind, payout: c.opened?.payout, raw: c };
  }
  private playOf(p: any): ChainPlay {
    const settled = p.outcome !== null && p.outcome !== undefined;
    return {
      handle: p.handle,
      account: p.account,
      coins: p.coins,
      amount: BigInt(p.locked) + BigInt(p.fee),
      locked: BigInt(p.locked),
      call: p.call === null || p.call === undefined ? null : !!p.call,
      characterId: p.character ?? null,
      credited: settled ? BigInt(p.credited) : null,
    };
  }
  async getPlay(roundId: number, handle: string): Promise<ChainPlay | null> {
    const p = await this.view<any>(this.contractId, 'get_play', { round_id: roundId, handle });
    return p ? this.playOf(p) : null;
  }
  async getRoundPlays(roundId: number): Promise<ChainPlay[]> {
    const out: ChainPlay[] = [];
    for (let from = 0; ; from += 100) {
      const page = await this.view<any[]>(this.contractId, 'get_round_plays', { round_id: roundId, from_index: from, limit: 100 });
      for (const p of page ?? []) out.push(this.playOf(p));
      if (!page || page.length < 100) break;
    }
    return out;
  }

  // ---------- transactions ----------
  private signing(accountId: string): Signing {
    const k = this.keys.get(accountId);
    if (!k) throw new Error(`no key for ${accountId}`);
    return k;
  }

  private accountFor(k: Signing): Account {
    if (!k.account) k.account = new Account(k.accountId, this.providers[k.providerIndex % this.providers.length], k.signer);
    return k.account;
  }

  private switchProvider(k: Signing): void {
    k.providerIndex = (k.providerIndex + 1) % this.providers.length;
    k.account = null; // new provider, fresh nonce lookup
  }

  /** Sign and send one function call; never throws for contract failures (ok=false with the panic text). */
  private send(
    signerId: string,
    receiverId: string,
    method: string,
    args: Record<string, unknown>,
    gasTgas: number,
    deposit: bigint,
    waitUntil: Wait,
  ): Promise<TxOutcome> {
    const k = this.signing(signerId);
    return k.queue.run(async () => {
      const t0 = Date.now();
      let lastErr = 'unknown error';
      for (let signAttempt = 0; signAttempt < 5; signAttempt++) {
        let signed: any;
        let hash: string;
        try {
          const acct = this.accountFor(k);
          const pk = await k.signer.getPublicKey();
          const tx = await acct.createTransaction({
            receiverId,
            actions: [actions.functionCall(method, args, BigInt(gasTgas) * TGAS, deposit)],
            publicKey: pk,
          });
          const s = await k.signer.signTransaction(tx);
          signed = s.signedTransaction;
          hash = baseEncode(s.txHash);
        } catch (e) {
          lastErr = errMsg(e);
          const c = classify(e);
          log.warn(`${method} by ${signerId}: build failed (${c}): ${lastErr.slice(0, 160)}`);
          if (c === 'other') break;
          this.switchProvider(k);
          await sleep(500 * (signAttempt + 1));
          continue;
        }
        // send the same signed bytes until it lands, fails, or expires
        for (let sendAttempt = 0; sendAttempt < 6; sendAttempt++) {
          const provider = this.providers[k.providerIndex % this.providers.length];
          try {
            const res: any = await provider.sendTransactionUntil(signed, waitUntil as any);
            return this.outcome(method, signerId, hash, res, t0);
          } catch (e) {
            lastErr = errMsg(e);
            const c = classify(e);
            log.warn(`${method} by ${signerId} ${hash}: send failed (${c}): ${lastErr.slice(0, 160)}`);
            if (c === 'expired' || c === 'nonce') {
              k.account = null; // fresh nonce lookup and block hash on the next signing attempt
              break;
            }
            if (c === 'other') {
              this.onTx?.({ method, signer: signerId, hash, ok: false, error: lastErr, ms: Date.now() - t0 });
              return { hash, ok: false, error: lastErr };
            }
            // rate limit, network or timeout: it may have landed; ask for its status, then resend
            const landed = await this.statusOf(hash, signerId, waitUntil);
            if (landed) return this.outcome(method, signerId, hash, landed, t0);
            k.providerIndex = (k.providerIndex + 1) % this.providers.length;
            await sleep(c === 'rate' ? 1500 * (sendAttempt + 1) : 800 * (sendAttempt + 1));
          }
        }
      }
      this.onTx?.({ method, signer: signerId, hash: null, ok: false, error: lastErr, ms: Date.now() - t0 });
      return { hash: '', ok: false, error: lastErr };
    });
  }

  private async statusOf(hash: string, signerId: string, waitUntil: Wait): Promise<any | null> {
    for (const p of this.providers) {
      try {
        const r: any = await p.viewTransactionStatus({ txHash: hash, accountId: signerId, waitUntil: waitUntil as any });
        if (r && r.status && (typeof r.status !== 'object' || 'SuccessValue' in r.status || 'Failure' in r.status)) return r;
      } catch {
        /* unknown yet or rate limited */
      }
    }
    return null;
  }

  private outcome(method: string, signer: string, hash: string, res: any, t0: number): TxOutcome {
    const st = res?.status;
    let out: TxOutcome;
    if (st && typeof st === 'object' && 'Failure' in st) {
      out = { hash, ok: false, error: failureText(st.Failure) };
    } else {
      // a later receipt may have failed (for example a callback); report the first failure
      let receiptFailure: string | undefined;
      for (const r of res?.receipts_outcome ?? []) {
        const s = r?.outcome?.status;
        if (s && typeof s === 'object' && 'Failure' in s) {
          receiptFailure = failureText(s.Failure);
          break;
        }
      }
      out = { hash, ok: true, value: decodeSuccess(st?.SuccessValue) };
      if (receiptFailure) out.error = `receipt failed: ${receiptFailure}`;
    }
    this.onTx?.({ method, signer, hash, ok: out.ok, error: out.error, ms: Date.now() - t0 });
    if (!out.ok) log.warn(`${method} by ${signer} failed on chain ${hash}: ${out.error}`);
    else log.debug(`${method} by ${signer} ok ${hash} in ${Date.now() - t0} ms`);
    return out;
  }

  private op(method: string, args: Record<string, unknown>, gasTgas: number, wait: Wait = 'EXECUTED_OPTIMISTIC') {
    return this.send(this.accounts.operator, this.contractId, method, args, gasTgas, 0n, wait);
  }

  startRound(roundId: number, secretHash: string, endsAtMs: number) {
    return this.op('start_round', { round_id: roundId, secret_hash: secretHash, ends_at_ms: endsAtMs }, 30, 'FINAL');
  }
  commitCharacters(roundId: number, items: CommitItem[]) {
    // FINAL: plays must land in later blocks than the commitment (spec: match only after the commit is final)
    return this.op('commit_characters', { round_id: roundId, items }, Math.min(300, 40 + 4 * items.length), 'FINAL');
  }
  endRoundNow(roundId: number) {
    return this.op('end_round_now', { round_id: roundId }, 30, 'FINAL');
  }
  revealRound(roundId: number, secret: string) {
    return this.op('reveal_round', { round_id: roundId, secret }, 30, 'FINAL');
  }
  async openCharacters(roundId: number, openings: Opening[]): Promise<TxOutcome & { reports?: OpenReport[] }> {
    const proofs = openings.reduce((n, o) => n + (o.proofs?.length ?? 0), 0);
    const gas = Math.min(300, 60 + 30 * proofs + 5 * openings.length);
    const out = await this.op('open_characters', { round_id: roundId, openings }, gas, 'FINAL');
    return { ...out, reports: out.ok && Array.isArray(out.value) ? (out.value as OpenReport[]) : undefined };
  }
  settleRound(roundId: number) {
    return this.op('settle_round', { round_id: roundId }, 300, 'FINAL');
  }
  async pruneRound(roundId: number, limit = 200): Promise<TxOutcome & { remaining?: number }> {
    const out = await this.op('prune_round', { round_id: roundId, limit }, 300, 'FINAL');
    const n = typeof out.value === 'number' ? out.value : Number(out.value);
    return { ...out, remaining: out.ok && Number.isFinite(n) ? n : undefined };
  }

  play(account: string, roundId: number, handle: string, coins: number) {
    return this.send(account, this.contractId, 'play', { round_id: roundId, handle, coins }, 30, 0n, 'EXECUTED_OPTIMISTIC');
  }
  call(account: string, roundId: number, handle: string, human: boolean) {
    return this.send(account, this.contractId, 'call', { round_id: roundId, handle, human }, 30, 0n, 'EXECUTED_OPTIMISTIC');
  }
  async withdraw(account: string, amount: bigint) {
    const out = await this.send(account, this.contractId, 'withdraw', { amount: amount.toString() }, 50, 0n, 'EXECUTED');
    if (out.ok && out.value === false) return { ...out, ok: false, error: 'token transfer failed; coins re-credited' };
    return out;
  }
  transfer(from: string, to: string, amount: bigint) {
    return this.send(from, this.contractId, 'transfer', { to, amount: amount.toString() }, 30, 0n, 'EXECUTED_OPTIMISTIC');
  }
  async faucetDeposit(account: string, amount: bigint) {
    if (!this.secrets.faucet) return { hash: '', ok: false, error: 'no faucet on this relay' };
    const out = await this.send(
      this.accounts.faucet,
      this.tokenId,
      'ft_transfer_call',
      { receiver_id: this.contractId, amount: amount.toString(), msg: JSON.stringify({ for: account }) },
      100,
      1n,
      'EXECUTED',
    );
    // ft_transfer_call returns the used amount; "0" means the game refused it and the faucet got it back
    if (out.ok && (out.value === '0' || out.value === 0)) return { ...out, ok: false, error: 'game contract refused the deposit' };
    return out;
  }

  async faucetToWallet(account: string, amount: bigint): Promise<TxOutcome> {
    if (!this.secrets.faucet) return { hash: '', ok: false, error: 'no faucet on this relay' };
    const st = await this.tokenStorage(account);
    if (!st.registered) {
      const reg = await this.send(this.accounts.faucet, this.tokenId, 'storage_deposit', { account_id: account, registration_only: true }, 30, BigInt(st.minDeposit), 'EXECUTED');
      if (!reg.ok) return reg;
    }
    return this.send(this.accounts.faucet, this.tokenId, 'ft_transfer', { receiver_id: account, amount: amount.toString(), memo: 'realsies test coins' }, 30, 1n, 'EXECUTED');
  }

  /**
   * A player's own signed transaction (src/auth/tx.ts checked it): sent as is, the same bytes again on rate
   * limits and network errors (same hash, so at most one lands), one at a time per player so nonces stay in
   * order. Never re-signed: a stale nonce or block hash comes back as code 'nonce' or 'expired' for the
   * caller to ask the browser again.
   */
  sendSignedTx(bytes: Uint8Array, signerId: string, method: string): Promise<TxOutcome & { code?: 'nonce' | 'expired' | 'allowance' | 'key'; akNonce?: bigint }> {
    let q = this.playerQueues.get(signerId);
    if (!q) this.playerQueues.set(signerId, (q = new SerialQueue()));
    return q.run(async () => {
      const t0 = Date.now();
      let hash: string;
      try {
        // a V0 SignedTransaction is the transaction's bytes, then 1 + 64 bytes of ed25519 signature
        const signed = SignedTransaction.decode(bytes);
        if (signed.signature.ed25519Signature?.data?.length !== 64) throw new Error('not an ed25519 signature');
        hash = txHashOf(bytes.subarray(0, bytes.length - 65));
      } catch (e) {
        return { hash: '', ok: false, error: `not a signed transaction: ${errMsg(e)}` };
      }
      const b64 = Buffer.from(bytes).toString('base64');
      let lastErr = 'unknown error';
      for (let attempt = 0; attempt < 6; attempt++) {
        const url = this.rpc[(this.viewIndex + attempt) % this.rpc.length];
        let retry: 'rate' | 'network' | null = null;
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // the exact bytes the player signed, never re-encoded
            body: JSON.stringify({ jsonrpc: '2.0', id: 'tx', method: 'send_tx', params: { signed_tx_base64: b64, wait_until: 'EXECUTED_OPTIMISTIC' } }),
            signal: AbortSignal.timeout(30_000),
          });
          if (r.status === 429 || r.status >= 500) {
            lastErr = `${url} http ${r.status}`;
            retry = r.status === 429 ? 'rate' : 'network';
          } else {
            const j: any = await r.json();
            if (!j.error) {
              const out = this.outcome(method, signerId, hash, j.result, t0);
              return !out.ok && /allowance/i.test(out.error ?? '') ? { ...out, code: 'allowance' as const } : out;
            }
            lastErr = JSON.stringify(j.error);
            if (/TIMEOUT_ERROR|timeout/i.test(lastErr)) retry = 'network';
            else if (/rate limit|too many/i.test(lastErr)) retry = 'rate';
            else {
              // the transaction itself was refused: say why, so the caller can ask the browser again
              const code = /NotEnoughAllowance/i.test(lastErr) ? 'allowance' : /AccessKeyNotFound|AccessKeyDoesNotExist/i.test(lastErr) ? 'key' : /InvalidNonce|NonceTooLarge/i.test(lastErr) ? 'nonce' : /Expired/i.test(lastErr) ? 'expired' : undefined;
              log.warn(`${method} by ${signerId} ${hash}: refused (${code ?? 'invalid'}): ${lastErr.slice(0, 200)}`);
              this.onTx?.({ method, signer: signerId, hash, ok: false, error: lastErr, ms: Date.now() - t0 });
              // InvalidNonce tells the key's current nonce: the next request starts above it
              const ak = /"ak_nonce"\s*:\s*(\d+)/.exec(lastErr);
              return { hash, ok: false, error: lastErr, code, ...(ak ? { akNonce: BigInt(ak[1]) } : {}) };
            }
          }
        } catch (e) {
          lastErr = errMsg(e);
          retry = 'network';
        }
        // rate limit, network or timeout: it may have landed; ask for its status, then resend the same bytes
        log.warn(`${method} by ${signerId} ${hash}: send failed (${retry}): ${lastErr.slice(0, 160)}`);
        const landed = await this.statusOf(hash, signerId, 'EXECUTED_OPTIMISTIC');
        if (landed) return this.outcome(method, signerId, hash, landed, t0);
        await sleep(retry === 'rate' ? 1500 * (attempt + 1) : 800 * (attempt + 1));
      }
      this.onTx?.({ method, signer: signerId, hash, ok: false, error: lastErr, ms: Date.now() - t0 });
      return { hash, ok: false, error: lastErr };
    });
  }
}
