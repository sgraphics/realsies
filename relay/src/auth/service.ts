// Wallet sign-in and sessions (protocol v1.3).
//
//   challenge  -> a 32-byte nonce and the message to sign, one use, AUTH_CHALLENGE_SECONDS to live
//   verify     -> NEP-413 signature over {message, nonce, recipient = AUTH_RECIPIENT} by the given key, then
//                 view_access_key over RPC: the key must be a full-access key of the account. A new wallet's
//                 implicit account (the key's own 64 hex) is let in before it is on chain. The nonce is
//                 spent on the first attempt, right or wrong. Then a session: a random 32-byte token, of
//                 which only the sha256 is stored; SESSION_DAYS to live.
//   ticket     -> a one-time WebSocket ticket (30 s) for a session, so the token never sits in a URL
//   play key   -> the browser's own function-call key for plays and calls, checked on chain (game contract,
//                 exactly play and call) and kept on the session; the relay never sees its private half
import crypto from 'node:crypto';
import type { AuthChallenge, PlayKeyInfo } from '../../../shared/protocol.js';
import type { Db } from '../db.js';
import type { ChainAdapter } from '../chain/types.js';
import { decodeNonce, decodeSignature, implicitAccountOf, isAccountId, parseEd25519PublicKey, verifyNep413 } from './nep413.js';
import { PLAYER_METHODS } from './tx.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  token_sha256 TEXT PRIMARY KEY, account TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account);
`;

export class AuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 401) {
    super(message);
  }
}

export interface PlayKeyRec extends PlayKeyInfo {
  addedAt: number;
}

export interface SessionRec {
  /** sha256 of the token, hex: the session's id (safe to log and to keep on a connection) */
  id: string;
  account: string;
  /** the full-access key that signed in */
  signInKey: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  playKey: PlayKeyRec | null;
}

export interface AuthOptions {
  /** NEP-413 recipient, e.g. realsies.lol */
  recipient: string;
  sessionDays: number;
  contractId: string;
  challengeTtlMs?: number;
  ticketTtlMs?: number;
}

const sha256hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export function signInMessage(recipient: string, at: number): string {
  return `Sign in to Realsies at ${recipient}.\n\nThis is a signature, not a transaction: it costs nothing and moves nothing.\n\n${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export class AuthService {
  private challenges = new Map<string, { message: string; expiresAt: number }>();
  /** nonces already spent, until they would have expired */
  private spent = new Map<string, number>();
  private tickets = new Map<string, { sessionId: string; expiresAt: number }>();
  private sweeper: NodeJS.Timeout;
  readonly recipient: string;
  private challengeTtl: number;
  private ticketTtl: number;

  constructor(private db: Db, private chain: ChainAdapter, private opts: AuthOptions) {
    this.db.sql.exec(SCHEMA);
    this.recipient = opts.recipient;
    this.challengeTtl = opts.challengeTtlMs ?? 10 * 60_000;
    this.ticketTtl = opts.ticketTtlMs ?? 30_000;
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  close(): void {
    clearInterval(this.sweeper);
  }

  private sweep(now = Date.now()): void {
    for (const [k, c] of this.challenges) if (c.expiresAt <= now) this.challenges.delete(k);
    for (const [k, t] of this.spent) if (t <= now) this.spent.delete(k);
    for (const [k, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(k);
    this.db.sql.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  }

  // ---------- sign-in ----------

  challenge(now = Date.now()): AuthChallenge {
    if (this.challenges.size >= 50_000) this.sweep(now);
    if (this.challenges.size >= 50_000) throw new AuthError('busy', 'too many sign-ins at once; try again in a minute', 503);
    const nonce = crypto.randomBytes(32);
    const c = { message: signInMessage(this.recipient, now), expiresAt: now + this.challengeTtl };
    this.challenges.set(nonce.toString('hex'), c);
    return { nonce: nonce.toString('base64'), message: c.message, recipient: this.recipient, expiresAt: c.expiresAt };
  }

  /**
   * Checks a signed challenge. Order: input shapes, the nonce (unknown, spent or expired: refused, and a
   * known one is spent now whatever happens next), the NEP-413 signature for this relay's recipient, then
   * the key on chain (it must exist on the account and be a full-access key). Returns a new session.
   */
  async verify(proof: unknown, now = Date.now()): Promise<{ token: string; session: SessionRec }> {
    const p = (proof ?? {}) as Record<string, unknown>;
    if (!isAccountId(p.accountId)) throw new AuthError('invalid_request', 'accountId must be a NEAR account id', 400);
    const accountId = p.accountId;
    let nonce: Uint8Array;
    try {
      parseEd25519PublicKey(p.publicKey);
      decodeSignature(p.signature);
      nonce = decodeNonce(p.nonce);
    } catch (e) {
      throw new AuthError('invalid_request', errMsg(e), 400);
    }
    if (p.callbackUrl !== undefined && (typeof p.callbackUrl !== 'string' || p.callbackUrl.length > 512)) throw new AuthError('invalid_request', 'callbackUrl must be a short string', 400);
    const key = Buffer.from(nonce).toString('hex');
    if (this.spent.has(key)) throw new AuthError('nonce_used', 'this sign-in request was already used; sign in again');
    const c = this.challenges.get(key);
    if (!c) throw new AuthError('nonce_unknown', 'unknown sign-in request; sign in again');
    this.challenges.delete(key);
    this.spent.set(key, c.expiresAt);
    if (c.expiresAt <= now) throw new AuthError('nonce_expired', 'the sign-in request expired; sign in again');
    const publicKey = String(p.publicKey).trim();
    const ok = verifyNep413(
      { message: c.message, nonce, recipient: this.recipient, callbackUrl: (p.callbackUrl as string | undefined) ?? null },
      publicKey,
      String(p.signature),
    );
    if (!ok) throw new AuthError('bad_signature', `the signature does not match this sign-in for ${this.recipient}`);
    let ak;
    try {
      ak = await this.chain.viewAccessKey(accountId, publicKey, 'full');
    } catch (e) {
      log.warn(`view_access_key ${accountId}: ${errMsg(e)}`);
      throw new AuthError('rpc_unavailable', 'could not reach NEAR to check the key; try again', 503);
    }
    if (!ak) {
      // A new wallet's account (64 hex: the key itself) is not on chain until someone sends it NEAR, so there is
      // no key to find. The signature proves the key and the key is the account: let it in. Once the account is
      // on chain its keys are what count, like any other account (the owner may have replaced this one).
      if (!(await this.newImplicitAccount(accountId, publicKey))) throw new AuthError('key_not_found', `${publicKey} is not a key of ${accountId}`, 403);
      log.info(`${accountId.slice(0, 12)}… is a new wallet account, not on chain yet: signed in by its own key`);
    } else if (ak.permission !== 'FullAccess') {
      throw new AuthError('not_full_access', 'sign in with a full-access key of the account, not a function-call key', 403);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const s: SessionRec = {
      id: sha256hex(token), account: accountId, signInKey: publicKey, createdAt: now, expiresAt: now + this.opts.sessionDays * 86_400_000, lastSeenAt: now, playKey: null,
    };
    this.save(s);
    log.info(`session for ${accountId} (${s.id.slice(0, 8)})`);
    return { token, session: s };
  }

  /** The account is the key's own implicit account and nobody has sent it NEAR yet (it is not on chain). */
  private async newImplicitAccount(accountId: string, publicKey: string): Promise<boolean> {
    if (implicitAccountOf(publicKey) !== accountId) return false;
    try {
      return !(await this.chain.accountExists(accountId));
    } catch (e) {
      log.warn(`view_account ${accountId}: ${errMsg(e)}`);
      throw new AuthError('rpc_unavailable', 'could not reach NEAR to check the account; try again', 503);
    }
  }

  // ---------- sessions ----------

  private save(s: SessionRec): void {
    const { id, account, createdAt, expiresAt, ...data } = s;
    this.db.sql
      .prepare('INSERT INTO sessions (token_sha256, account, created_at, expires_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(token_sha256) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at')
      .run(id, account, createdAt, expiresAt, JSON.stringify(data));
  }

  byId(id: string | undefined, now = Date.now()): SessionRec | null {
    if (!id) return null;
    const r = this.db.sql.prepare('SELECT * FROM sessions WHERE token_sha256 = ?').get(id) as Record<string, any> | undefined;
    if (!r || r.expires_at <= now) return null;
    const data = JSON.parse(r.data);
    return { id: r.token_sha256, account: r.account, createdAt: r.created_at, expiresAt: r.expires_at, ...data };
  }

  /** The session of a Bearer token, or null (unknown, expired or signed out). */
  session(token: string | undefined, now = Date.now()): SessionRec | null {
    if (!token || token.length > 200) return null;
    const s = this.byId(sha256hex(token), now);
    if (s && now - s.lastSeenAt > 60_000) {
      s.lastSeenAt = now;
      this.save(s);
    }
    return s;
  }

  revoke(token: string | undefined): boolean {
    if (!token) return false;
    const id = sha256hex(token);
    for (const [k, t] of this.tickets) if (t.sessionId === id) this.tickets.delete(k);
    return Number(this.db.sql.prepare('DELETE FROM sessions WHERE token_sha256 = ?').run(id).changes) > 0;
  }

  ticket(s: SessionRec, now = Date.now()): { ticket: string; expiresAt: number } {
    if (this.tickets.size >= 50_000) this.sweep(now);
    const ticket = crypto.randomBytes(24).toString('base64url');
    const expiresAt = now + this.ticketTtl;
    this.tickets.set(ticket, { sessionId: s.id, expiresAt });
    return { ticket, expiresAt };
  }

  /** A WebSocket ticket, once: its session, or null (unknown, used, expired, or the session ended). */
  redeemTicket(ticket: string | null | undefined, now = Date.now()): SessionRec | null {
    if (!ticket) return null;
    const t = this.tickets.get(ticket);
    if (!t) return null;
    this.tickets.delete(ticket);
    if (t.expiresAt <= now) return null;
    return this.byId(t.sessionId, now);
  }

  // ---------- play keys ----------

  /**
   * The browser's play key, after its wallet added it: on chain it must be a function-call key of the
   * session's account for the game contract, allowed exactly `play` and `call` (a key that may call more,
   * withdraw or transfer for instance, is refused). Kept on the session.
   */
  async registerPlayKey(s: SessionRec, publicKey: unknown): Promise<PlayKeyRec> {
    try {
      parseEd25519PublicKey(publicKey);
    } catch (e) {
      throw new AuthError('invalid_request', errMsg(e), 400);
    }
    const pk = String(publicKey).trim();
    if (pk === s.signInKey) throw new AuthError('play_key_full_access', 'that is your wallet key; the play key is a new key this browser makes', 400);
    let ak;
    try {
      ak = await this.chain.viewAccessKey(s.account, pk, 'play');
    } catch (e) {
      log.warn(`view_access_key ${s.account}: ${errMsg(e)}`);
      throw new AuthError('rpc_unavailable', 'could not reach NEAR to check the key; try again', 503);
    }
    if (!ak) throw new AuthError('play_key_not_found', `the key is not on ${s.account} yet; approve it in your wallet, then try again`, 409);
    if (ak.permission === 'FullAccess') throw new AuthError('play_key_full_access', 'a play key must be a function-call key, never a full-access key', 400);
    const perm = ak.permission;
    if (perm.receiverId !== this.opts.contractId) throw new AuthError('play_key_wrong_contract', `the key is for ${perm.receiverId}, not ${this.opts.contractId}`, 400);
    const methods = [...perm.methodNames].sort();
    const want = [...PLAYER_METHODS].sort();
    if (methods.length !== want.length || methods.some((m, i) => m !== want[i])) {
      throw new AuthError('play_key_methods', `a play key may call exactly ${want.join(' and ')}; this one ${methods.length ? `calls ${methods.join(', ')}` : 'may call any method'}`, 400);
    }
    const rec: PlayKeyRec = {
      publicKey: pk, receiverId: perm.receiverId, methodNames: [...PLAYER_METHODS], allowance: perm.allowance,
      status: perm.allowance !== null && BigInt(perm.allowance) === 0n ? 'exhausted' : 'active', addedAt: Date.now(),
    };
    s.playKey = rec;
    this.save(s);
    log.info(`play key for ${s.account} (${s.id.slice(0, 8)}): ${pk}, allowance ${perm.allowance ?? 'unlimited'}`);
    return rec;
  }

  /** The play key's gas allowance ran out (NotEnoughAllowance): the browser needs a new one. */
  markPlayKey(sessionId: string, status: PlayKeyInfo['status']): void {
    const s = this.byId(sessionId);
    if (!s?.playKey) return;
    s.playKey.status = status;
    this.save(s);
  }

  forgetPlayKey(s: SessionRec): void {
    s.playKey = null;
    this.save(s);
  }

  /** Every live session of an account (to reach the browsers that hold its play keys). */
  sessionsOf(account: string, now = Date.now()): SessionRec[] {
    return (this.db.sql.prepare('SELECT token_sha256 FROM sessions WHERE account = ? AND expires_at > ?').all(account, now) as { token_sha256: string }[])
      .map((r) => this.byId(r.token_sha256, now))
      .filter((x): x is SessionRec => !!x);
  }
}

export function publicPlayKey(k: PlayKeyRec | null): PlayKeyInfo | null {
  if (!k) return null;
  return { publicKey: k.publicKey, receiverId: k.receiverId, methodNames: [...k.methodNames], allowance: k.allowance, status: k.status };
}
