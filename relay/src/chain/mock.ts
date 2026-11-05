// In-memory chain with the game contract's rules (spec section 3, v1.1), for unit tests and keyless dev.
// State can be snapshotted to JSON so a dev relay survives restarts.
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { SignedTransaction, baseEncode, encodeTransaction } from 'near-api-js';
import type {
  AccessKeyView, ChainAccounts, ChainAdapter, ChainCharacter, ChainConfig, ChainPlay, ChainRound, CommitItem, OpenReport, Opening,
  TestUserKey, TxDetails, TxOutcome,
} from './types.js';
import { sha256Hex, recoverEip191, randomHex } from '../crypto.js';
import { botPreimage, commitmentOf, handleOf, humanPreimage } from '../formats.js';
import { settleCharacter, splitPlay, DEFAULT_PARAMS } from '../settlement.js';

type KeyPermission = AccessKeyView['permission'];
interface MKey {
  nonce: bigint;
  permission: KeyPermission;
}

/** yoctoNEAR of gas allowance one mock transaction burns (roughly a play at 15 Tgas prepaid). */
export const MOCK_TX_ALLOWANCE = 1_600_000_000_000_000_000_000n;

interface MPlay {
  account: string;
  coins: number;
  amount: bigint;
  locked: bigint;
  height: number;
  call: boolean | null;
  character: string | null;
  credited: bigint | null;
}

interface MChar {
  commitment: string;
  height: number;
  opened: { kind: 'bot' | 'human'; payout: string; model?: string; promptHash?: string; signers?: string[] } | null;
}

interface MRound {
  secretHash: string;
  endsAt: number;
  secret: string | null;
  settled: boolean;
  chars: Map<string, MChar>;
  plays: Map<string, MPlay>;
}

export const DEFAULT_TEST_USERS: TestUserKey[] = [
  { accountId: 'ana.realsies.testnet', label: 'Ana' },
  { accountId: 'ben.realsies.testnet', label: 'Ben' },
  { accountId: 'cleo.realsies.testnet', label: 'Cleo' },
  { accountId: 'dex.realsies.testnet', label: 'Dex' },
  { accountId: 'eve.realsies.testnet', label: 'Eve' },
  { accountId: 'finn.realsies.testnet', label: 'Finn' },
];

export const DEFAULT_ACCOUNTS: ChainAccounts = {
  operator: 'ops.realsies.testnet',
  faucet: 'faucet.realsies.testnet',
  promo: 'promo.realsies.testnet',
  fund: 'fund.realsies.testnet',
  house: 'house.realsies.testnet',
  bots: 'bots.realsies.testnet',
};

export class ContractError extends Error {}

export class MockChain implements ChainAdapter {
  readonly kind = 'mock' as const;
  readonly network = 'testnet' as const;
  readonly contractId = 'game.realsies.testnet';
  readonly tokenId = 'real.realsies.testnet';
  readonly tokenDecimals = 18;
  readonly accounts: ChainAccounts;
  readonly testUsers: TestUserKey[];

  constructor(opts: { accounts?: Partial<ChainAccounts>; testUsers?: TestUserKey[] } = {}) {
    this.accounts = { ...DEFAULT_ACCOUNTS, ...opts.accounts };
    this.testUsers = opts.testUsers ?? DEFAULT_TEST_USERS;
  }

  coinUnit = 10n ** 18n;
  minCoins = 5;
  maxCoins = 500;
  callGraceMs = 60_000;
  openWindowMs = 3_600_000;
  testMode = true;
  /** false: the contract has no coin yet (mainnet before REAL launches); deposits and plays are refused */
  coinsOpen = true;
  /**
   * Keyless dev relays only (CHAIN=mock with a real wallet in the browser): an access key the mock has never
   * seen counts as what the caller expects (a full-access key at sign-in, a play key for plays and calls).
   * Tests leave it off: then only keys added with addKey exist.
   */
  trustUnknownKeys = false;
  /** Simulated latency per tx in ms (tests may set 0). */
  txLatencyMs = 40;
  now: () => number = () => Date.now();
  onChange?: () => void;

  private height = 1000;
  private balances = new Map<string, bigint>();
  private rounds = new Map<number, MRound>();
  /** account -> public key -> key */
  private keys = new Map<string, Map<string, MKey>>();
  /** coins held on the token by wallets (outside the game) */
  private walletBalances = new Map<string, bigint>();
  private tokenRegistered = new Set<string>();
  private txIndex = new Map<string, TxDetails>();
  readonly blockHash = baseEncode(new Uint8Array(crypto.createHash('sha256').update('realsies mock block').digest()));
  txLog: { hash: string; method: string; signer: string; ok: boolean; error?: string }[] = [];

  async init(): Promise<void> {}
  queueDepth(): Record<string, number> {
    return {};
  }

  // ---------- views ----------
  async getConfig(): Promise<ChainConfig> {
    return {
      coinUnit: this.coinUnit,
      feeBps: Number(DEFAULT_PARAMS.feeBps),
      rightBps: Number(DEFAULT_PARAMS.rightBps),
      characterBps: Number(DEFAULT_PARAMS.characterBps),
      minCoins: this.minCoins,
      maxCoins: this.maxCoins,
      callGraceMs: this.callGraceMs,
      openWindowMs: this.openWindowMs,
      testMode: this.testMode,
      token: this.coinsOpen ? this.tokenId : undefined,
      coinsOpen: this.coinsOpen,
      raw: { mock: true },
    };
  }

  // ---------- access keys (wallet accounts) ----------
  /** Puts a key on an account (tests: the wallet's full-access key, or a play key the wallet added). */
  addKey(accountId: string, publicKey: string, permission: KeyPermission, nonce = 0n): void {
    let m = this.keys.get(accountId);
    if (!m) this.keys.set(accountId, (m = new Map()));
    m.set(publicKey, { nonce, permission });
    this.onChange?.();
  }
  deleteKey(accountId: string, publicKey: string): void {
    this.keys.get(accountId)?.delete(publicKey);
  }
  private keyOf(accountId: string, publicKey: string, hint?: 'full' | 'play'): MKey | null {
    const k = this.keys.get(accountId)?.get(publicKey);
    if (k) return k;
    if (!this.trustUnknownKeys || !hint) return null;
    const trusted: MKey = {
      nonce: 0n,
      permission: hint === 'full' ? 'FullAccess' : { receiverId: this.contractId, methodNames: ['play', 'call'], allowance: '250000000000000000000000' },
    };
    this.addKey(accountId, publicKey, trusted.permission);
    return trusted;
  }
  async viewAccessKey(accountId: string, publicKey: string, hint?: 'full' | 'play'): Promise<AccessKeyView | null> {
    const k = this.keyOf(accountId, publicKey, hint);
    if (!k) return null;
    const p = k.permission;
    return { nonce: k.nonce, blockHash: this.blockHash, blockHeight: this.height, permission: p === 'FullAccess' ? 'FullAccess' : { ...p, methodNames: [...p.methodNames] } };
  }

  /**
   * A player-signed transaction with the protocol's checks for a function-call key: the key exists and
   * allows the receiver and method with no deposit, the nonce is fresh, the allowance covers the gas, the
   * signature verifies. Then the call runs as the signer.
   */
  async sendSignedTx(bytes: Uint8Array, signerId: string, method: string): Promise<TxOutcome & { code?: 'nonce' | 'expired' | 'allowance' | 'key'; akNonce?: bigint }> {
    if (this.txLatencyMs > 0) await new Promise((r) => setTimeout(r, this.txLatencyMs));
    let signed: SignedTransaction;
    try {
      signed = SignedTransaction.decode(bytes);
    } catch (e) {
      return { hash: '', ok: false, error: `InvalidTransaction: ${e instanceof Error ? e.message : String(e)}` };
    }
    const tx = signed.transaction;
    const txBytes = encodeTransaction(tx);
    const digest = new Uint8Array(crypto.createHash('sha256').update(txBytes).digest());
    const hash = baseEncode(digest);
    const reject = (error: string, code?: 'nonce' | 'expired' | 'allowance' | 'key', akNonce?: bigint) => {
      this.txLog.push({ hash, method, signer: signerId, ok: false, error });
      return { hash, ok: false, error, code, ...(akNonce !== undefined ? { akNonce } : {}) };
    };
    if (tx.signerId !== signerId) return reject('InvalidTxError: signer does not match');
    const pk = tx.publicKey.toString();
    const key = this.keyOf(tx.signerId, pk, 'play');
    if (!key) return reject(`InvalidTxError: AccessKeyNotFound ${pk}`, 'key');
    // borsh hands fixed-size arrays back as plain arrays
    const sig = signed.signature.ed25519Signature?.data;
    if (!sig || sig.length !== 64 || !ed25519.verify(Uint8Array.from(sig), digest, Uint8Array.from(tx.publicKey.data))) return reject('InvalidTxError: InvalidSignature');
    if (baseEncode(Uint8Array.from(tx.blockHash)) !== this.blockHash) return reject('InvalidTxError: Expired', 'expired');
    if (tx.nonce <= key.nonce) return reject(`InvalidTxError: InvalidNonce {"tx_nonce":${tx.nonce},"ak_nonce":${key.nonce}}`, 'nonce', key.nonce);
    if (tx.actions.length !== 1 || !tx.actions[0].functionCall) return reject('InvalidTxError: a function-call key signs one function call');
    const fc = tx.actions[0].functionCall;
    if (key.permission !== 'FullAccess') {
      const p = key.permission;
      if (tx.receiverId !== p.receiverId) return reject('InvalidTxError: ReceiverMismatch');
      if (p.methodNames.length && !p.methodNames.includes(fc.methodName)) return reject('InvalidTxError: MethodNameMismatch');
      if (fc.deposit !== 0n) return reject('InvalidTxError: DepositWithFunctionCall');
      if (p.allowance !== null) {
        const left = BigInt(p.allowance);
        if (left < MOCK_TX_ALLOWANCE) return reject('InvalidTxError: NotEnoughAllowance', 'allowance');
        p.allowance = (left - MOCK_TX_ALLOWANCE).toString();
      }
    }
    key.nonce = tx.nonce;
    let args: any;
    try {
      args = JSON.parse(Buffer.from(fc.args).toString('utf8'));
    } catch {
      args = null;
    }
    const out = await this.runAs(hash, tx.signerId, tx.receiverId, fc.methodName, args);
    return out;
  }

  /** Executes one call by `signer` (a wallet's own transaction, or a play key's), recorded for txDetails. */
  private async runAs(hash: string, signer: string, receiver: string, method: string, args: any): Promise<TxOutcome> {
    this.height += 1;
    const logs: string[] = [];
    let ok = true;
    let error: string | undefined;
    let value: unknown;
    try {
      if (receiver === this.contractId && method === 'play') this.doPlay(signer, Number(args?.round_id), String(args?.handle ?? ''), Number(args?.coins));
      else if (receiver === this.contractId && method === 'call') this.doCall(signer, Number(args?.round_id), String(args?.handle ?? ''), args?.human);
      else if (receiver === this.contractId && method === 'withdraw') {
        const amount = BigInt(String(args?.amount ?? '0'));
        if (amount <= 0n) throw new ContractError('nothing to withdraw');
        this.debit(signer, amount);
        logs.push(`EVENT_JSON:${JSON.stringify({ standard: 'realsies', version: '1.0.0', event: 'withdraw', data: [{ account: signer, amount: amount.toString() }] })}`);
        // like the contract: the ft_transfer fails for an account that is not registered on the token, and the coins come back
        if (this.tokenRegistered.has(signer)) this.walletBalances.set(signer, (this.walletBalances.get(signer) ?? 0n) + amount);
        else {
          this.credit(signer, amount);
          value = false;
          logs.push(`EVENT_JSON:${JSON.stringify({ standard: 'realsies', version: '1.0.0', event: 'withdraw_failed', data: [{ account: signer, amount: amount.toString() }] })}`);
        }
      } else if (receiver === this.tokenId && method === 'ft_transfer_call') {
        if (!this.coinsOpen) throw new ContractError('token not set');
        if (args?.receiver_id !== this.contractId) throw new ContractError('the mock token only transfers to the game');
        const amount = BigInt(String(args?.amount ?? '0'));
        const have = this.walletBalances.get(signer) ?? 0n;
        if (have < amount) throw new ContractError('The account does not have enough balance');
        this.walletBalances.set(signer, have - amount);
        let target = signer;
        if (typeof args?.msg === 'string' && args.msg.trim()) target = JSON.parse(args.msg).for;
        this.credit(target, amount);
        logs.push(`EVENT_JSON:${JSON.stringify({ standard: 'realsies', version: '1.0.0', event: 'deposit', data: [{ account: target, from: signer, amount: amount.toString() }] })}`);
      } else if (receiver === this.tokenId && method === 'storage_deposit') {
        this.tokenRegistered.add(String(args?.account_id ?? signer));
      } else throw new ContractError(`the mock does not run ${receiver}.${method}`);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }
    this.txLog.push({ hash, method, signer, ok, error });
    this.txIndex.set(hash, { hash, ok, signerId: signer, receiverId: receiver, actions: [{ method, args }], logs, error });
    this.onChange?.();
    return ok ? { hash, ok, value } : { hash, ok, error };
  }

  async txDetails(hash: string, signerId: string): Promise<TxDetails | null> {
    const t = this.txIndex.get(hash);
    return t && t.signerId === signerId ? { ...t, actions: t.actions.map((a) => ({ ...a })), logs: [...t.logs] } : null;
  }

  async tokenStorage(accountId: string): Promise<{ registered: boolean; minDeposit: string }> {
    return { registered: this.tokenRegistered.has(accountId), minDeposit: '1250000000000000000000' };
  }

  // ---------- a wallet's own transactions (tests: stand-ins for the wallet popup) ----------
  /** Coins on the token in the account's wallet, outside the game. */
  walletBalance(accountId: string): bigint {
    return this.walletBalances.get(accountId) ?? 0n;
  }
  /** Tokens arrive in a wallet (bought on Rhea, say); registers it on the token. */
  mintToWallet(accountId: string, amount: bigint): void {
    this.tokenRegistered.add(accountId);
    this.walletBalances.set(accountId, this.walletBalance(accountId) + amount);
  }
  registerOnToken(accountId: string): void {
    this.tokenRegistered.add(accountId);
  }
  /** The wallet signs ft_transfer_call to the game (msg ""), as the deposit screen asks it to. */
  walletDeposit(accountId: string, amount: bigint): Promise<TxOutcome> {
    return this.runAs('mock' + randomHex(20), accountId, this.tokenId, 'ft_transfer_call', { receiver_id: this.contractId, amount: amount.toString(), msg: '' });
  }
  /** The wallet signs withdraw on the game. */
  walletWithdraw(accountId: string, amount: bigint): Promise<TxOutcome> {
    return this.runAs('mock' + randomHex(20), accountId, this.contractId, 'withdraw', { amount: amount.toString() });
  }
  async faucetToWallet(account: string, amount: bigint): Promise<TxOutcome> {
    return this.tx(this.accounts.faucet, 'ft_transfer', () => this.mintToWallet(account, amount));
  }
  async balanceOf(account: string): Promise<bigint> {
    return this.balances.get(account) ?? 0n;
  }
  async getRound(roundId: number): Promise<ChainRound | null> {
    const r = this.rounds.get(roundId);
    if (!r) return null;
    return {
      roundId, secretHash: r.secretHash, endsAtMs: r.endsAt, revealed: r.secret !== null, settled: r.settled, plays: r.plays.size, characters: r.chars.size,
      raw: { mock: true, characters: [...r.chars.keys()], plays: r.plays.size },
    };
  }
  async getCharacter(roundId: number, characterId: string): Promise<ChainCharacter | null> {
    const c = this.rounds.get(roundId)?.chars.get(characterId);
    if (!c) return null;
    return { characterId, commitment: c.commitment, opened: !!c.opened, kind: c.opened?.kind, payout: c.opened?.payout, raw: { height: c.height } };
  }
  async getPlay(roundId: number, handle: string): Promise<ChainPlay | null> {
    const p = this.rounds.get(roundId)?.plays.get(handle);
    return p ? this.playView(handle, p) : null;
  }
  async getRoundPlays(roundId: number): Promise<ChainPlay[]> {
    const r = this.rounds.get(roundId);
    if (!r) return [];
    return [...r.plays.entries()].map(([h, p]) => this.playView(h, p));
  }
  private playView(handle: string, p: MPlay): ChainPlay {
    return { handle, account: p.account, coins: p.coins, amount: p.amount, locked: p.locked, call: p.call, characterId: p.character, credited: p.credited };
  }

  // ---------- tx plumbing ----------
  private async tx(signer: string, method: string, fn: () => unknown): Promise<TxOutcome> {
    if (this.txLatencyMs > 0) await new Promise((r) => setTimeout(r, this.txLatencyMs));
    const hash = 'mock' + randomHex(20);
    this.height += 1;
    try {
      const value = fn();
      this.txLog.push({ hash, method, signer, ok: true });
      this.onChange?.();
      return { hash, ok: true, value };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.txLog.push({ hash, method, signer, ok: false, error });
      return { hash, ok: false, error };
    }
  }
  private round(id: number): MRound {
    const r = this.rounds.get(id);
    if (!r) throw new ContractError('no such round');
    return r;
  }
  private credit(account: string, amount: bigint): void {
    if (amount === 0n) return;
    this.balances.set(account, (this.balances.get(account) ?? 0n) + amount);
  }
  private debit(account: string, amount: bigint): void {
    const b = this.balances.get(account) ?? 0n;
    if (b < amount) throw new ContractError('not enough coins');
    this.balances.set(account, b - amount);
  }

  // ---------- operator ----------
  startRound(roundId: number, secretHash: string, endsAtMs: number) {
    return this.tx(this.accounts.operator, 'start_round', () => {
      if (this.rounds.has(roundId)) throw new ContractError('round exists');
      if (endsAtMs <= this.now()) throw new ContractError('ends_at in the past');
      if (!/^[0-9a-f]{64}$/.test(secretHash)) throw new ContractError('bad secret_hash');
      this.rounds.set(roundId, { secretHash, endsAt: endsAtMs, secret: null, settled: false, chars: new Map(), plays: new Map() });
    });
  }
  commitCharacters(roundId: number, items: CommitItem[]) {
    return this.tx(this.accounts.operator, 'commit_characters', () => {
      const r = this.round(roundId);
      if (r.secret !== null || r.settled || this.now() >= r.endsAt) throw new ContractError('round is closed');
      for (const it of items) if (r.chars.has(it.character_id)) throw new ContractError('character already committed');
      for (const it of items) r.chars.set(it.character_id, { commitment: it.commitment, height: this.height, opened: null });
    });
  }
  endRoundNow(roundId: number) {
    return this.tx(this.accounts.operator, 'end_round_now', () => {
      if (!this.testMode) throw new ContractError('test mode only');
      const r = this.round(roundId);
      if (r.secret !== null || r.settled) throw new ContractError('round is not open');
      r.endsAt = Math.min(r.endsAt, this.now() - this.callGraceMs - 1);
    });
  }
  revealRound(roundId: number, secret: string) {
    return this.tx(this.accounts.operator, 'reveal_round', () => {
      const r = this.round(roundId);
      if (r.secret !== null || r.settled) throw new ContractError('round is not open');
      if (this.now() <= r.endsAt + this.callGraceMs) throw new ContractError('calls are still open');
      if (sha256Hex(secret) !== r.secretHash) throw new ContractError('secret does not match');
      r.secret = secret;
    });
  }
  async openCharacters(roundId: number, openings: Opening[]): Promise<TxOutcome & { reports?: OpenReport[] }> {
    const out = await this.tx(this.accounts.operator, 'open_characters', () => {
      const r = this.round(roundId);
      if (r.secret === null || r.settled) throw new ContractError('round must be revealed and not settled');
      return openings.map((o) => this.openOne(roundId, r, o));
    });
    return { ...out, reports: out.ok ? (out.value as OpenReport[]) : undefined };
  }
  private openOne(roundId: number, r: MRound, o: Opening): OpenReport {
    const rep: OpenReport = { character_id: o.character_id, ok: false, assigned: 0, rejected: [] };
    const c = r.chars.get(o.character_id);
    if (!c) {
      rep.rejected.push('unknown character');
      return rep;
    }
    let pre: string;
    if (o.kind === 'bot') {
      if (!o.model || !o.prompt_hash || !o.signers) {
        rep.rejected.push('bot opening needs model, prompt_hash and signers');
        return rep;
      }
      pre = botPreimage({ roundId, characterId: o.character_id, model: o.model, promptHash: o.prompt_hash, signers: o.signers, payout: o.payout, salt: o.salt });
    } else {
      if (!o.account) {
        rep.rejected.push('human opening needs account');
        return rep;
      }
      pre = humanPreimage({ roundId, characterId: o.character_id, account: o.account, payout: o.payout, salt: o.salt });
    }
    if (commitmentOf(pre) !== c.commitment) {
      rep.rejected.push('commitment mismatch');
      return rep;
    }
    // Like the contract: a re-opening keeps the first opening and only adds proofs or viewers.
    if (!c.opened) {
      c.opened = { kind: o.kind, payout: o.payout, model: o.model, promptHash: o.prompt_hash, signers: o.signers ? [...new Set(o.signers.map((s) => s.toLowerCase()))].sort() : [] };
    }
    const opened = c.opened;
    rep.ok = true;
    const secret = r.secret!;
    const claim = (viewer: string): MPlay | string => {
      const h = handleOf(roundId, o.character_id, viewer, secret);
      const p = r.plays.get(h);
      if (!p) return `${viewer}: no play on this chat's handle`;
      if (p.account !== viewer) return `${viewer}: handle was played by another account`;
      if (p.character !== null) return `${viewer}: play already assigned`;
      if (p.height <= c.height) return `${viewer}: play is not after the character's commitment`;
      return p;
    };
    if (opened.kind === 'human') {
      for (const v of o.viewers ?? []) {
        const p = claim(v);
        if (typeof p === 'string') rep.rejected.push(p);
        else {
          p.character = o.character_id;
          rep.assigned++;
        }
      }
      return rep;
    }
    for (const pr of o.proofs ?? []) {
      const p = claim(pr.viewer);
      if (typeof p === 'string') {
        rep.rejected.push(p);
        continue;
      }
      const why = this.checkProof(roundId, opened, o.character_id, pr, secret);
      if (why) {
        rep.rejected.push(`${pr.viewer}: ${why}`);
        continue;
      }
      p.character = o.character_id;
      rep.assigned++;
    }
    return rep;
  }
  /** Spec section 3 checks 2 to 5 for one bot proof (contract verify_bot_proof); returns the reason or null. */
  private checkProof(
    roundId: number,
    opened: NonNullable<MChar['opened']>,
    characterId: string,
    pr: { viewer: string; text: string; signature: string; request: string },
    secret: string,
  ): string | null {
    const parts = pr.text.split(':');
    const h2 = parts.pop() ?? '';
    const h1 = parts.pop() ?? '';
    if (parts.join(':') !== opened.model) return 'signed model differs from the committed model';
    if (!/^[0-9a-f]{64}$/.test(h1) || !/^[0-9a-f]{64}$/.test(h2)) return 'signed text is not model:hash:hash';
    if (sha256Hex(pr.request) !== h1) return 'request bytes do not match the signed request hash';
    let req: any;
    try {
      req = JSON.parse(pr.request);
    } catch {
      return 'request is not chat JSON';
    }
    if (typeof req?.model !== 'string' || !Array.isArray(req?.messages)) return 'request is not chat JSON';
    if (req.model !== opened.model) return 'request model differs';
    const m0 = req.messages[0];
    if (!m0) return 'request has no messages';
    if (typeof m0.content !== 'string') return 'message 0 is not text';
    if (m0.role !== 'system' || sha256Hex(m0.content) !== opened.promptHash) return 'message 0 is not the committed persona prompt';
    const m1 = req.messages[1];
    if (!m1) return 'request has no skin message';
    if (typeof m1.content !== 'string') return 'message 1 is not text';
    const tag = handleOf(roundId, characterId, pr.viewer, secret).slice(0, 16);
    if (m1.role !== 'system' || !m1.content.includes(tag)) return "message 1 does not carry this chat's tag";
    const addr = recoverEip191(pr.text, pr.signature);
    if (!addr) return 'signature does not recover';
    if (!(opened.signers ?? []).includes(addr)) return `signer ${addr} is not a committed enclave signer`;
    return null;
  }
  settleRound(roundId: number) {
    return this.tx(this.accounts.operator, 'settle_round', () => {
      const r = this.round(roundId);
      if (r.settled) throw new ContractError('already settled');
      const late = this.now() > r.endsAt + this.openWindowMs;
      if (r.secret === null && !late) throw new ContractError('reveal the round first');
      for (const [cid, c] of r.chars) {
        if (!c.opened) continue;
        const plays = [...r.plays.entries()].filter(([, p]) => p.character === cid);
        const s = settleCharacter(
          c.opened.kind,
          plays.map(([h, p]) => ({ key: h, account: p.account, locked: p.locked, call: p.call })),
        );
        for (const [h, p] of plays) {
          const cr = s.credits.get(h) ?? 0n;
          p.credited = cr;
          this.credit(p.account, cr);
        }
        this.credit(c.opened.payout, s.payoutCredit);
        this.credit(this.accounts.house, s.houseCredit);
      }
      for (const p of r.plays.values()) {
        if (p.character === null) {
          p.credited = p.locked;
          this.credit(p.account, p.locked);
        }
      }
      r.settled = true;
    });
  }

  /** Same rules as the contract: settled rounds only; up to `limit` (default 200, 1 to 500) plays, then characters. */
  async pruneRound(roundId: number, limit?: number): Promise<TxOutcome & { remaining?: number }> {
    const out = await this.tx(this.accounts.operator, 'prune_round', () => {
      const r = this.round(roundId);
      if (!r.settled) throw new ContractError('round is not settled');
      const lim = Math.min(500, Math.max(1, Math.floor(limit ?? 200)));
      let n = 0;
      for (const h of [...r.plays.keys()]) {
        if (n >= lim) break;
        r.plays.delete(h);
        n++;
      }
      for (const c of [...r.chars.keys()]) {
        if (n >= lim) break;
        r.chars.delete(c);
        n++;
      }
      return r.plays.size + r.chars.size;
    });
    return { ...out, remaining: out.ok ? (out.value as number) : undefined };
  }

  // ---------- players ----------
  private doPlay(account: string, roundId: number, handle: string, coins: number): void {
    if (!this.coinsOpen) throw new ContractError('coin unit not set');
    const r = this.round(roundId);
    if (r.secret !== null || r.settled || this.now() >= r.endsAt) throw new ContractError('round is closed for plays');
    if (!Number.isInteger(coins) || coins < this.minCoins || coins > this.maxCoins) throw new ContractError('coins out of range');
    if (!/^[0-9a-f]{64}$/.test(handle)) throw new ContractError('bad handle');
    if (r.plays.has(handle)) throw new ContractError('handle already played');
    const amount = BigInt(coins) * this.coinUnit;
    this.debit(account, amount);
    const { fee, locked } = splitPlay(amount);
    this.credit(this.accounts.fund, fee);
    r.plays.set(handle, { account, coins, amount, locked, height: this.height, call: null, character: null, credited: null });
  }
  private doCall(account: string, roundId: number, handle: string, human: unknown): void {
    if (typeof human !== 'boolean') throw new ContractError('human must be a boolean');
    const r = this.round(roundId);
    if (r.secret !== null || r.settled || this.now() > r.endsAt + this.callGraceMs) throw new ContractError('round is closed for calls');
    const p = r.plays.get(handle);
    if (!p) throw new ContractError('no play for handle');
    if (p.account !== account) throw new ContractError('not your play');
    if (p.call !== null) throw new ContractError('already called');
    p.call = human;
  }
  play(account: string, roundId: number, handle: string, coins: number) {
    return this.tx(account, 'play', () => this.doPlay(account, roundId, handle, coins));
  }
  call(account: string, roundId: number, handle: string, human: boolean) {
    return this.tx(account, 'call', () => this.doCall(account, roundId, handle, human));
  }
  withdraw(account: string, amount: bigint) {
    return this.tx(account, 'withdraw', () => {
      if (amount <= 0n) throw new ContractError('amount must be positive');
      this.debit(account, amount);
    });
  }
  transfer(from: string, to: string, amount: bigint) {
    return this.tx(from, 'transfer', () => {
      if (amount <= 0n) throw new ContractError('amount must be positive');
      this.debit(from, amount);
      this.credit(to, amount);
    });
  }
  faucetDeposit(account: string, amount: bigint) {
    return this.tx(this.accounts.faucet, 'ft_transfer_call', () => {
      if (!this.coinsOpen) throw new ContractError('token not set');
      this.credit(account, amount);
    });
  }

  // ---------- persistence ----------
  snapshot(): string {
    return JSON.stringify(
      {
        height: this.height,
        balances: [...this.balances],
        rounds: [...this.rounds].map(([id, r]) => [id, { ...r, chars: [...r.chars], plays: [...r.plays] }]),
        keys: [...this.keys].map(([a, m]) => [a, [...m]]),
        wallets: [...this.walletBalances],
        registered: [...this.tokenRegistered],
      },
      (_k, v) => (typeof v === 'bigint' ? `${v}n` : v),
    );
  }
  restore(json: string): void {
    const j = JSON.parse(json, (_k, v) => (typeof v === 'string' && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
    this.height = j.height;
    this.balances = new Map(j.balances);
    this.rounds = new Map(
      j.rounds.map(([id, r]: [number, any]) => [id, { ...r, chars: new Map(r.chars), plays: new Map(r.plays) }]),
    );
    this.keys = new Map((j.keys ?? []).map(([a, m]: [string, [string, MKey][]]) => [a, new Map(m)]));
    this.walletBalances = new Map(j.wallets ?? []);
    this.tokenRegistered = new Set(j.registered ?? []);
  }
}
