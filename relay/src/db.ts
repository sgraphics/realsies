// Persistence on node:sqlite (DatabaseSync), one file, no native modules.
// Entities are stored as JSON documents with a few indexed columns; messages, completions,
// ratings and the tx log are append-only rows.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { jsonStringify } from './util.js';
import type { DraftRow } from './bot/session.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (account TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rounds (round_id INTEGER PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS characters (character_id TEXT PRIMARY KEY, round_id INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS characters_round ON characters(round_id);
CREATE TABLE IF NOT EXISTS attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id INTEGER NOT NULL, model TEXT NOT NULL, nonce TEXT NOT NULL,
  fetched_at INTEGER NOT NULL, summary TEXT NOT NULL, raw BLOB);
CREATE INDEX IF NOT EXISTS attestations_round ON attestations(round_id);
CREATE TABLE IF NOT EXISTS chats (
  chat_id TEXT PRIMARY KEY, round_id INTEGER NOT NULL, viewer TEXT NOT NULL, conv_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chats_round ON chats(round_id);
CREATE INDEX IF NOT EXISTS chats_viewer ON chats(viewer);
CREATE TABLE IF NOT EXISTS messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (chat_id, seq));
CREATE TABLE IF NOT EXISTS completions (
  chat_id TEXT NOT NULL, idx INTEGER NOT NULL, completion_id TEXT, model TEXT NOT NULL,
  request TEXT NOT NULL, response TEXT NOT NULL, signature TEXT, verify TEXT, displayed TEXT,
  at INTEGER NOT NULL, latency_ms INTEGER, error TEXT, PRIMARY KEY (chat_id, idx));
CREATE TABLE IF NOT EXISTS results (round_id INTEGER NOT NULL, account TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (round_id, account));
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, round_id INTEGER NOT NULL, account TEXT NOT NULL, chat_id TEXT NOT NULL,
  before INTEGER NOT NULL, after INTEGER NOT NULL, delta INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bundles (chat_id TEXT PRIMARY KEY, round_id INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS txs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, round_id INTEGER, kind TEXT NOT NULL,
  signer TEXT, hash TEXT, ok INTEGER NOT NULL, error TEXT, ms INTEGER);
CREATE TABLE IF NOT EXISTS bot_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, say_id INTEGER NOT NULL, at INTEGER NOT NULL, steering TEXT NOT NULL,
  request TEXT NOT NULL, response TEXT NOT NULL, completion_id TEXT, signature TEXT, verify TEXT, reason TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bot_drafts_chat ON bot_drafts(chat_id);
CREATE TABLE IF NOT EXISTS bot_traces (chat_id TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

export interface CompletionRow {
  chatId: string;
  idx: number;
  completionId: string | null;
  model: string;
  request: string;
  response: string;
  signature: string | null; // JSON of SignaturePayload
  verify: string | null; // JSON of SignatureCheck
  displayed: string | null; // JSON string[]
  at: number;
  latencyMs: number | null;
  error: string | null;
}

export interface TxRow {
  at: number;
  roundId: number | null;
  kind: string;
  signer: string | null;
  hash: string | null;
  ok: boolean;
  error: string | null;
  ms: number | null;
}

/** Stand-in after close(): late background writes during shutdown become no-ops. */
const CLOSED_DB = {
  prepare: () => ({ run: () => ({ changes: 0, lastInsertRowid: 0 }), get: () => undefined, all: () => [] }),
  exec: () => undefined,
  close: () => undefined,
} as unknown as DatabaseSync;

export class Db {
  private db: DatabaseSync;
  private closed = false;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  get sql(): DatabaseSync {
    return this.closed ? CLOSED_DB : this.db;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // kv
  getKv(key: string): string | undefined {
    const r = this.sql.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }
  setKv(key: string, value: string): void {
    this.sql.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // documents
  saveUser(account: string, data: unknown): void {
    this.sql.prepare('INSERT INTO users (account, data) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET data = excluded.data').run(account, jsonStringify(data));
  }
  loadUsers<T>(): T[] {
    return (this.sql.prepare('SELECT data FROM users').all() as { data: string }[]).map((r) => JSON.parse(r.data));
  }

  saveRound(roundId: number, status: string, data: unknown): void {
    this.sql
      .prepare('INSERT INTO rounds (round_id, status, data) VALUES (?, ?, ?) ON CONFLICT(round_id) DO UPDATE SET status = excluded.status, data = excluded.data')
      .run(roundId, status, jsonStringify(data));
  }
  loadRound<T>(roundId: number): T | undefined {
    const r = this.sql.prepare('SELECT data FROM rounds WHERE round_id = ?').get(roundId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  listRounds<T>(limit: number): T[] {
    return (this.sql.prepare('SELECT data FROM rounds ORDER BY round_id DESC LIMIT ?').all(limit) as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  unsettledRoundIds(): number[] {
    return (this.sql.prepare("SELECT round_id FROM rounds WHERE status != 'settled' ORDER BY round_id").all() as { round_id: number }[]).map((r) => r.round_id);
  }
  maxRoundId(): number {
    const r = this.sql.prepare('SELECT MAX(round_id) AS m FROM rounds').get() as { m: number | null };
    return r?.m ?? 0;
  }

  saveCharacter(characterId: string, roundId: number, data: unknown): void {
    this.sql
      .prepare('INSERT INTO characters (character_id, round_id, data) VALUES (?, ?, ?) ON CONFLICT(character_id) DO UPDATE SET data = excluded.data')
      .run(characterId, roundId, jsonStringify(data));
  }
  loadCharacters<T>(roundId: number): T[] {
    return (this.sql.prepare('SELECT data FROM characters WHERE round_id = ?').all(roundId) as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  countCharacters(roundId: number): number {
    return (this.sql.prepare('SELECT COUNT(*) AS n FROM characters WHERE round_id = ?').get(roundId) as { n: number }).n;
  }

  saveChat(chatId: string, roundId: number, viewer: string, convId: string, data: unknown): void {
    this.sql
      .prepare('INSERT INTO chats (chat_id, round_id, viewer, conv_id, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data')
      .run(chatId, roundId, viewer, convId, jsonStringify(data));
  }
  loadChats<T>(roundId: number): T[] {
    return (this.sql.prepare('SELECT data FROM chats WHERE round_id = ?').all(roundId) as { data: string }[]).map((r) => JSON.parse(r.data));
  }
  loadChat<T>(chatId: string): T | undefined {
    const r = this.sql.prepare('SELECT data FROM chats WHERE chat_id = ?').get(chatId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  countConversations(roundId: number): number {
    return (this.sql.prepare('SELECT COUNT(DISTINCT conv_id) AS n FROM chats WHERE round_id = ?').get(roundId) as { n: number }).n;
  }

  addMessage(chatId: string, seq: number, data: unknown): void {
    this.sql.prepare('INSERT OR REPLACE INTO messages (chat_id, seq, data) VALUES (?, ?, ?)').run(chatId, seq, jsonStringify(data));
  }
  loadMessages<T>(chatId: string): T[] {
    return (this.sql.prepare('SELECT data FROM messages WHERE chat_id = ? ORDER BY seq').all(chatId) as { data: string }[]).map((r) => JSON.parse(r.data));
  }

  saveCompletion(c: CompletionRow): void {
    this.sql
      .prepare(
        `INSERT INTO completions (chat_id, idx, completion_id, model, request, response, signature, verify, displayed, at, latency_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, idx) DO UPDATE SET completion_id = excluded.completion_id, response = excluded.response,
           signature = excluded.signature, verify = excluded.verify, displayed = excluded.displayed, latency_ms = excluded.latency_ms, error = excluded.error`,
      )
      .run(c.chatId, c.idx, c.completionId, c.model, c.request, c.response, c.signature, c.verify, c.displayed, c.at, c.latencyMs, c.error);
  }
  loadCompletions(chatId: string): CompletionRow[] {
    const rows = this.sql.prepare('SELECT * FROM completions WHERE chat_id = ? ORDER BY idx').all(chatId) as Record<string, any>[];
    return rows.map((r) => ({
      chatId: r.chat_id,
      idx: r.idx,
      completionId: r.completion_id,
      model: r.model,
      request: r.request,
      response: r.response,
      signature: r.signature,
      verify: r.verify,
      displayed: r.displayed,
      at: r.at,
      latencyMs: r.latency_ms,
      error: r.error,
    }));
  }
  /** Completions made for a say that was never shown (cancelled, unusable, late, unsigned): kept for audit, not in bundles. */
  saveDraft(d: DraftRow): void {
    this.sql
      .prepare('INSERT INTO bot_drafts (chat_id, say_id, at, steering, request, response, completion_id, signature, verify, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.chatId, d.sayId, d.at, d.steering, d.request, d.response, d.completionId, d.signature, d.verify, d.reason);
  }
  loadDrafts(chatId: string): DraftRow[] {
    const rows = this.sql.prepare('SELECT * FROM bot_drafts WHERE chat_id = ? ORDER BY id').all(chatId) as Record<string, any>[];
    return rows.map((r) => ({
      chatId: r.chat_id, sayId: r.say_id, at: r.at, steering: r.steering, request: r.request, response: r.response,
      completionId: r.completion_id, signature: r.signature, verify: r.verify, reason: r.reason,
    }));
  }
  /** The bot engine's event and action trace of one chat (diagnostics). */
  saveTrace(chatId: string, data: unknown): void {
    this.sql.prepare('INSERT INTO bot_traces (chat_id, data) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data').run(chatId, jsonStringify(data));
  }
  loadTrace(chatId: string): unknown {
    const r = this.sql.prepare('SELECT data FROM bot_traces WHERE chat_id = ?').get(chatId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }
  /** Settled rounds whose chain storage is not pruned yet, oldest first. */
  settledUnpruned<T>(limit = 50): T[] {
    return (
      this.sql
        .prepare("SELECT data FROM rounds WHERE status = 'settled' AND json_extract(data, '$.prunedAt') IS NULL ORDER BY round_id LIMIT ?")
        .all(limit) as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  completionStats(): { calls: number; promptChars: number; responseChars: number } {
    const r = this.sql.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(request)),0) AS q, COALESCE(SUM(LENGTH(response)),0) AS s FROM completions').get() as any;
    return { calls: r.n, promptChars: r.q, responseChars: r.s };
  }

  saveAttestation(roundId: number, model: string, nonce: string, fetchedAt: number, summary: unknown, raw: Uint8Array | null): void {
    this.sql
      .prepare('INSERT INTO attestations (round_id, model, nonce, fetched_at, summary, raw) VALUES (?, ?, ?, ?, ?, ?)')
      .run(roundId, model, nonce, fetchedAt, jsonStringify(summary), raw);
  }
  loadAttestations<T>(roundId: number): (T & { fetchedAt: number })[] {
    return (this.sql.prepare('SELECT summary, fetched_at FROM attestations WHERE round_id = ? ORDER BY id').all(roundId) as any[]).map((r) => ({
      ...JSON.parse(r.summary),
      fetchedAt: r.fetched_at,
    }));
  }
  /** Keep the full reports for recent rounds only; summaries stay. */
  pruneAttestationRaw(keepFromRound: number): void {
    this.sql.prepare('UPDATE attestations SET raw = NULL WHERE round_id < ? AND raw IS NOT NULL').run(keepFromRound);
  }

  saveResult(roundId: number, account: string, data: unknown): void {
    this.sql
      .prepare('INSERT INTO results (round_id, account, data) VALUES (?, ?, ?) ON CONFLICT(round_id, account) DO UPDATE SET data = excluded.data')
      .run(roundId, account, jsonStringify(data));
  }
  loadResult<T>(roundId: number, account: string): T | undefined {
    const r = this.sql.prepare('SELECT data FROM results WHERE round_id = ? AND account = ?').get(roundId, account) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }

  addRating(roundId: number, account: string, chatId: string, before: number, after: number, at: number): void {
    this.sql
      .prepare('INSERT INTO ratings (round_id, account, chat_id, before, after, delta, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(roundId, account, chatId, before, after, after - before, at);
  }

  saveBundle(chatId: string, roundId: number, data: unknown): void {
    this.sql
      .prepare('INSERT INTO bundles (chat_id, round_id, data) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET data = excluded.data')
      .run(chatId, roundId, jsonStringify(data));
  }
  loadBundle<T>(chatId: string): T | undefined {
    const r = this.sql.prepare('SELECT data FROM bundles WHERE chat_id = ?').get(chatId) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  }

  logTx(t: TxRow): void {
    this.sql
      .prepare('INSERT INTO txs (at, round_id, kind, signer, hash, ok, error, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.at, t.roundId, t.kind, t.signer, t.hash, t.ok ? 1 : 0, t.error, t.ms);
  }
  recentTxs(limit: number): TxRow[] {
    return (this.sql.prepare('SELECT * FROM txs ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({
      at: r.at,
      roundId: r.round_id,
      kind: r.kind,
      signer: r.signer,
      hash: r.hash,
      ok: !!r.ok,
      error: r.error,
      ms: r.ms,
    }));
  }
}
