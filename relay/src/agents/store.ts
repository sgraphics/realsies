// Storage for AI builders (docs/agents.md): access requests, botmasters registered in the DB (token sha256
// only), the personas they enter (pending until an operator approves them), their own NEAR AI keys (sealed
// with RELAY_ENCRYPTION_KEY), and one record per settled chat of their personas, built at settlement with
// the player already anonymised. The server and tools/botmaster-admin.ts share these tables; nothing here
// is cached, so a change made by either is seen by the other at once.
import crypto from 'node:crypto';
import type { AgentAccessRequest, BotmasterChat, BuilderKind, Level } from '../../../shared/protocol.js';
import type { Db } from '../db.js';
import type { Languages, PersonaTraits, Topic } from '../bot/api.js';
import type { Botmaster, BotmasterSource } from '../bot/remote.js';
import type { SealedBox } from '../secretbox.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, email TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_botmasters (
  name TEXT PRIMARY KEY, token_sha256 TEXT NOT NULL UNIQUE, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_personas (
  id TEXT PRIMARY KEY, botmaster TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS agent_personas_bm ON agent_personas(botmaster);
CREATE TABLE IF NOT EXISTS agent_keys (botmaster TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_chats (
  chat_id TEXT PRIMARY KEY, botmaster TEXT NOT NULL, persona_id TEXT NOT NULL, round_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS agent_chats_bm ON agent_chats(botmaster, round_id);
`;

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequestRec {
  id: string;
  createdAt: number;
  status: RequestStatus;
  request: AgentAccessRequest;
  /** keyed hash of the sender's IP, for abuse review (never the IP itself) */
  ipHash?: string;
  decidedAt?: number;
  /** why it was rejected */
  reason?: string;
  /** the botmaster created on approval */
  botmaster?: string;
}

export type BotmasterStatus = 'active' | 'revoked';

export interface BotmasterRec {
  name: string;
  tokenSha256: string;
  status: BotmasterStatus;
  /** NEAR account credited with the Turing bonus of every character its personas play */
  payoutAccount: string;
  contact?: string;
  displayName?: string;
  company?: string;
  kind?: BuilderKind;
  requestId?: string;
  /** brain ms without any action before the default brain takes over a chat (3000 to 60000) */
  silenceMs?: number;
  createdAt: number;
  tokenIssuedAt: number;
  revokedAt?: number;
  reason?: string;
}

export type PersonaStatus = 'pending' | 'approved' | 'rejected' | 'disabled';

export interface AgentPersonaRec {
  /** `<botmaster>-<slug>`, unique across every persona the relay knows */
  id: string;
  botmaster: string;
  status: PersonaStatus;
  createdAt: number;
  decidedAt?: number;
  reason?: string;
  model: string;
  /** the exact system prompt (message 0), committed by sha256 every round */
  prompt: string;
  promptSha256: string;
  levels: Level[];
  brain: 'default' | 'remote';
  cps?: number;
  traits?: Partial<PersonaTraits>;
  summary?: string;
  interests?: Topic[];
  languages?: Languages;
}

export interface ByokRec {
  botmaster: string;
  /** first 12 hex of sha256(key) */
  fingerprint: string;
  box: SealedBox;
  createdAt: number;
}

/** A BotmasterChat as stored at settlement, plus the exact Turing bonus in base units. */
export interface AgentChatRec extends BotmasterChat {
  botmaster: string;
  turingBonusUnits: string;
  settledAt: number;
}

const parse = <T>(r: { data: string } | undefined): T | undefined => (r ? (JSON.parse(r.data) as T) : undefined);

export class AgentStore {
  constructor(readonly db: Db) {
    db.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.db.sql;
  }

  /** Run fn in one write transaction (BEGIN IMMEDIATE: the admin tool and the server may both write). */
  tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const v = fn();
      this.sql.exec('COMMIT');
      return v;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- access requests ----------

  addRequest(r: AccessRequestRec): void {
    this.sql.prepare('INSERT INTO agent_requests (id, created_at, status, email, data) VALUES (?, ?, ?, ?, ?)').run(r.id, r.createdAt, r.status, r.request.email, JSON.stringify(r));
  }
  saveRequest(r: AccessRequestRec): void {
    this.sql.prepare('UPDATE agent_requests SET status = ?, data = ? WHERE id = ?').run(r.status, JSON.stringify(r), r.id);
  }
  getRequest(id: string): AccessRequestRec | undefined {
    return parse(this.sql.prepare('SELECT data FROM agent_requests WHERE id = ?').get(id) as { data: string } | undefined);
  }
  listRequests(status?: RequestStatus, limit = 500): AccessRequestRec[] {
    const rows = status
      ? this.sql.prepare('SELECT data FROM agent_requests WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : this.sql.prepare('SELECT data FROM agent_requests ORDER BY created_at DESC LIMIT ?').all(limit);
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  countRequestsSince(t: number): number {
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM agent_requests WHERE created_at >= ?').get(t) as { n: number }).n;
  }

  // ---------- botmasters ----------

  getBotmaster(name: string): BotmasterRec | undefined {
    return parse(this.sql.prepare('SELECT data FROM agent_botmasters WHERE name = ?').get(name) as { data: string } | undefined);
  }
  botmasterByTokenHash(hash: string): BotmasterRec | undefined {
    return parse(this.sql.prepare("SELECT data FROM agent_botmasters WHERE token_sha256 = ? AND status = 'active'").get(hash) as { data: string } | undefined);
  }
  listBotmasters(status?: BotmasterStatus): BotmasterRec[] {
    const rows = status
      ? this.sql.prepare('SELECT data FROM agent_botmasters WHERE status = ? ORDER BY name').all(status)
      : this.sql.prepare('SELECT data FROM agent_botmasters ORDER BY name').all();
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  saveBotmaster(b: BotmasterRec): void {
    this.sql
      .prepare(
        'INSERT INTO agent_botmasters (name, token_sha256, status, data) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET token_sha256 = excluded.token_sha256, status = excluded.status, data = excluded.data',
      )
      .run(b.name, b.tokenSha256, b.status, JSON.stringify(b));
  }

  // ---------- personas ----------

  getPersona(id: string): AgentPersonaRec | undefined {
    return parse(this.sql.prepare('SELECT data FROM agent_personas WHERE id = ?').get(id) as { data: string } | undefined);
  }
  listPersonas(f: { botmaster?: string; status?: PersonaStatus } = {}): AgentPersonaRec[] {
    const where: string[] = [];
    const args: string[] = [];
    if (f.botmaster) {
      where.push('botmaster = ?');
      args.push(f.botmaster);
    }
    if (f.status) {
      where.push('status = ?');
      args.push(f.status);
    }
    const rows = this.sql.prepare(`SELECT data FROM agent_personas ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at`).all(...args);
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  savePersona(p: AgentPersonaRec): void {
    this.sql
      .prepare(
        'INSERT INTO agent_personas (id, botmaster, status, created_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET botmaster = excluded.botmaster, status = excluded.status, created_at = excluded.created_at, data = excluded.data',
      )
      .run(p.id, p.botmaster, p.status, p.createdAt, JSON.stringify(p));
  }
  /** Approved personas of active botmasters: what enters each round. */
  activePersonas(): { persona: AgentPersonaRec; botmaster: BotmasterRec }[] {
    const out: { persona: AgentPersonaRec; botmaster: BotmasterRec }[] = [];
    const bms = new Map(this.listBotmasters('active').map((b) => [b.name, b]));
    for (const p of this.listPersonas({ status: 'approved' })) {
      const b = bms.get(p.botmaster);
      if (b) out.push({ persona: p, botmaster: b });
    }
    return out;
  }

  // ---------- own NEAR AI keys ----------

  getKey(botmaster: string): ByokRec | undefined {
    return parse(this.sql.prepare('SELECT data FROM agent_keys WHERE botmaster = ?').get(botmaster) as { data: string } | undefined);
  }
  saveKey(k: ByokRec): void {
    this.sql.prepare('INSERT INTO agent_keys (botmaster, data) VALUES (?, ?) ON CONFLICT(botmaster) DO UPDATE SET data = excluded.data').run(k.botmaster, JSON.stringify(k));
  }
  deleteKey(botmaster: string): boolean {
    return Number(this.sql.prepare('DELETE FROM agent_keys WHERE botmaster = ?').run(botmaster).changes) > 0;
  }
  countKeys(): number {
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM agent_keys').get() as { n: number }).n;
  }

  // ---------- settled chats ----------

  saveChat(c: AgentChatRec): void {
    this.sql
      .prepare(
        'INSERT INTO agent_chats (chat_id, botmaster, persona_id, round_id, started_at, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data',
      )
      .run(c.chatId, c.botmaster, c.personaId, c.roundId, c.startedAt, JSON.stringify(c));
  }
  /** Newest first. `transcripts: false` leaves the transcripts out (the scorecard needs only the calls). */
  chatsOf(botmaster: string, f: { round?: number; limit?: number; transcripts?: boolean } = {}): AgentChatRec[] {
    const limit = f.limit ?? 1_000_000;
    const col = f.transcripts === false ? "json_set(data, '$.transcript', json('[]'))" : 'data';
    const rows =
      f.round !== undefined
        ? this.sql.prepare(`SELECT ${col} AS data FROM agent_chats WHERE botmaster = ? AND round_id = ? ORDER BY started_at DESC LIMIT ?`).all(botmaster, f.round, limit)
        : this.sql.prepare(`SELECT ${col} AS data FROM agent_chats WHERE botmaster = ? ORDER BY round_id DESC, started_at DESC LIMIT ?`).all(botmaster, limit);
    return (rows as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  /** Oldest first, in pages (the export streams these). */
  chatPage(botmaster: string, afterRowid: number, limit: number): { rowid: number; rec: AgentChatRec }[] {
    const rows = this.sql
      .prepare('SELECT rowid AS r, data FROM agent_chats WHERE botmaster = ? AND rowid > ? ORDER BY rowid LIMIT ?')
      .all(botmaster, afterRowid, limit) as { r: number; data: string }[];
    return rows.map((x) => ({ rowid: x.r, rec: JSON.parse(x.data) }));
  }

  /** Key of the players' anonymous ids (random, made on first use, kept in the DB). */
  anonSecret(): string {
    let s = this.db.getKv('anon_secret');
    if (!s) {
      s = crypto.randomBytes(32).toString('hex');
      this.db.setKv('anon_secret', s);
    }
    return s;
  }
}

/** Botmasters registered in the DB, for /bot/ws: active ones only, each with the remote-brain personas it drives. */
export class DbBotmasters implements BotmasterSource {
  constructor(private store: AgentStore) {}
  private view(b: BotmasterRec): Botmaster {
    const personas = this.store.listPersonas({ botmaster: b.name, status: 'approved' }).filter((p) => p.brain === 'remote').map((p) => p.id);
    return { name: b.name, tokenSha256: b.tokenSha256, personas, silenceMs: b.silenceMs, contact: b.contact, source: 'db', payoutAccount: b.payoutAccount, createdAt: b.createdAt };
  }
  list(): Botmaster[] {
    return this.store.listBotmasters('active').map((b) => this.view(b));
  }
  get(name: string): Botmaster | undefined {
    const b = this.store.getBotmaster(name);
    return b && b.status === 'active' ? this.view(b) : undefined;
  }
  byTokenHash(hash: string): Botmaster | undefined {
    const b = this.store.botmasterByTokenHash(hash);
    return b ? this.view(b) : undefined;
  }
}
