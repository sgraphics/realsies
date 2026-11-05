// Remote brains: a registered botmaster's process connects to /bot/ws, authenticates with its token
// (the relay keeps only the token's sha256: in relay/botmasters/<name>.json, or in the DB for botmasters
// approved through the AI builders flow, src/agents/), receives the event stream of every chat played by
// its personas, and sends actions in the same JSON as the default brain. The relay validates and executes
// them under the same limits; if the botmaster is offline at chat start, disconnects, or stays silent, the
// session falls back to the default brain (src/bot/session.ts). A revoked or rotated token loses its
// connection at once (kick) or at the next heartbeat (changes made by tools/botmaster-admin.ts).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { Observable } from 'rxjs';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRAIN_PROTOCOL, INTENTS, LIMITS, TOPICS, type Brain, type BrainAction, type BrainEvent, type RemoteOut } from './api.js';
import { STEER_VERSION } from './intents.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';

const log = logger('botmaster');

export interface Botmaster {
  name: string;
  tokenSha256: string;
  personas: string[];
  /** brain ms without any action before the default brain takes over (default LIMITS.remoteSilenceMs) */
  silenceMs?: number;
  contact?: string;
  /** where the registration lives: relay/botmasters/*.json or the DB (approved AI builders) */
  source?: 'file' | 'db';
  /** account credited with the Turing bonus of its personas (DB botmasters; a file may set it too) */
  payoutAccount?: string;
  createdAt?: number;
}

/** Where the hub looks botmasters up. Read on every use, so registrations can change while the relay runs. */
export interface BotmasterSource {
  list(): Botmaster[];
  get(name: string): Botmaster | undefined;
  /** the botmaster whose token has this sha256 (active registrations only) */
  byTokenHash(hash: string): Botmaster | undefined;
}

/** A fixed list (relay/botmasters/*.json). */
export class StaticBotmasters implements BotmasterSource {
  constructor(private items: Botmaster[]) {}
  list(): Botmaster[] {
    return this.items;
  }
  get(name: string): Botmaster | undefined {
    return this.items.find((b) => b.name === name);
  }
  byTokenHash(hash: string): Botmaster | undefined {
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    const h = Buffer.from(hash, 'hex');
    return this.items.find((b) => crypto.timingSafeEqual(h, Buffer.from(b.tokenSha256, 'hex')));
  }
}

/** Several sources; the first that knows a name or a token wins (files before the DB). */
export class CompositeBotmasters implements BotmasterSource {
  constructor(private parts: BotmasterSource[]) {}
  list(): Botmaster[] {
    const seen = new Set<string>();
    const out: Botmaster[] = [];
    for (const p of this.parts) {
      for (const b of p.list()) {
        if (seen.has(b.name)) continue;
        seen.add(b.name);
        out.push(b);
      }
    }
    return out;
  }
  get(name: string): Botmaster | undefined {
    for (const p of this.parts) {
      const b = p.get(name);
      if (b) return b;
    }
    return undefined;
  }
  byTokenHash(hash: string): Botmaster | undefined {
    for (const p of this.parts) {
      const b = p.byTokenHash(hash);
      if (b) return b;
    }
    return undefined;
  }
}

export function loadBotmasters(dir: string): Botmaster[] {
  if (!fs.existsSync(dir)) return [];
  const out: Botmaster[] = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const where = `botmasters/${f}:`;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (typeof raw.name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(raw.name)) throw new Error(`${where} name`);
    if (typeof raw.tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.tokenSha256)) throw new Error(`${where} tokenSha256 must be 64 lowercase hex`);
    if (!Array.isArray(raw.personas) || raw.personas.some((p: unknown) => typeof p !== 'string')) throw new Error(`${where} personas`);
    if (raw.silenceMs !== undefined && !(typeof raw.silenceMs === 'number' && raw.silenceMs >= 3000 && raw.silenceMs <= 60_000)) throw new Error(`${where} silenceMs from 3000 to 60000`);
    if (raw.payoutAccount !== undefined && !isAccountId(raw.payoutAccount)) throw new Error(`${where} payoutAccount must be a NEAR account id`);
    out.push({
      name: raw.name, tokenSha256: raw.tokenSha256, personas: raw.personas, silenceMs: raw.silenceMs, contact: raw.contact, source: 'file',
      payoutAccount: raw.payoutAccount, createdAt: Math.round(fs.statSync(path.join(dir, f)).mtimeMs),
    });
  }
  const names = new Set<string>();
  for (const b of out) {
    if (names.has(b.name)) throw new Error(`duplicate botmaster ${b.name}`);
    names.add(b.name);
  }
  return out;
}

export const tokenHash = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
/** A NEAR account id (named or implicit), 2 to 64 characters. */
export const isAccountId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 64 && ACCOUNT_ID.test(v);

interface Link {
  chatId: string;
  personaId: string;
  conn: Conn;
  next: (a: BrainAction) => void;
  fail: (why: string) => void;
}

interface Conn {
  ws: WebSocket;
  bm: Botmaster;
  /** sha256 of the token this connection logged in with; re-checked at every heartbeat */
  tokenSha256: string;
  chats: Set<string>;
}

export class BotmasterHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private conns = new Map<string, Conn>();
  private links = new Map<string, Link>();
  readonly source: BotmasterSource;

  constructor(
    botmasters: Botmaster[] | BotmasterSource,
    /** brain ms of silence before the default brain takes over, for botmasters that set none */
    readonly defaultSilenceMs: number = LIMITS.remoteSilenceMs,
    /** heartbeat period of /bot/ws: a ping, and the re-check of the token */
    private heartbeatMs = 20_000,
  ) {
    this.source = Array.isArray(botmasters) ? new StaticBotmasters(botmasters) : botmasters;
  }

  /** every registered botmaster (files and DB) */
  get botmasters(): Botmaster[] {
    return this.source.list();
  }

  silenceMsOf(name: string): number {
    return this.get(name)?.silenceMs ?? this.defaultSilenceMs;
  }

  get(name: string): Botmaster | undefined {
    return this.source.get(name);
  }

  online(name: string): boolean {
    return this.conns.has(name);
  }

  /** The botmaster drives this persona and is connected now. */
  drives(name: string, personaId: string): boolean {
    const b = this.get(name);
    return !!b && b.personas.includes(personaId) && this.online(name);
  }

  /** The botmaster of a token (the same check the botmaster HTTP API makes). */
  auth(token: unknown): Botmaster | undefined {
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) return undefined;
    return this.source.byTokenHash(tokenHash(token));
  }

  /** Close a botmaster's live connection now (token revoked or rotated); its chats fall back to the default brain. */
  kick(name: string, code: string, message: string): boolean {
    const conn = this.conns.get(name);
    if (!conn) return false;
    this.send(conn.ws, { type: 'error', code, message });
    conn.ws.close(4001, code);
    this.dropConn(conn, code);
    return true;
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws, req));
  }

  private send(ws: WebSocket, m: RemoteOut): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }

  private onSocket(ws: WebSocket, req: http.IncomingMessage): void {
    let conn: Conn | null = null;
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''))?.[1]?.trim();
    const login = (token: unknown): boolean => {
      const bm = this.auth(token);
      if (!bm || typeof token !== 'string') {
        this.send(ws, { type: 'error', code: 'unauthorized', message: 'unknown botmaster token' });
        ws.close(4001, 'unauthorized');
        return false;
      }
      const old = this.conns.get(bm.name);
      if (old) {
        this.send(old.ws, { type: 'error', code: 'replaced', message: 'a newer connection for this botmaster took over' });
        old.ws.close(4000, 'replaced');
        this.dropConn(old, 'replaced by a newer connection');
      }
      conn = { ws, bm, tokenSha256: tokenHash(token), chats: new Set() };
      this.conns.set(bm.name, conn);
      log.info(`botmaster ${bm.name} connected (${bm.personas.length} personas)`);
      this.send(ws, {
        type: 'welcome', protocol: BRAIN_PROTOCOL, botmaster: bm.name, personas: bm.personas, steerVersion: STEER_VERSION,
        intents: INTENTS, topics: TOPICS, limits: LIMITS, silenceMs: this.silenceMsOf(bm.name),
      });
      return true;
    };
    const helloTimer = setTimeout(() => {
      if (!conn) {
        this.send(ws, { type: 'error', code: 'unauthorized', message: 'send {"type":"hello","token":"..."} first' });
        ws.close(4001, 'unauthorized');
      }
    }, 5000);
    helloTimer.unref?.();
    if (bearer && !login(bearer)) return;
    let alive = true;
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      // a token revoked or rotated elsewhere (tools/botmaster-admin.ts) ends the connection here
      if (conn && this.conns.get(conn.bm.name) === conn && this.source.byTokenHash(conn.tokenSha256)?.name !== conn.bm.name) {
        this.kick(conn.bm.name, 'revoked', 'this botmaster token is no longer valid');
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, this.heartbeatMs);
    beat.unref?.();
    ws.on('message', (data) => {
      alive = true;
      let m: any;
      try {
        m = JSON.parse(String(data));
      } catch {
        return this.send(ws, { type: 'error', code: 'bad_json', message: 'messages are JSON' });
      }
      if (!conn) {
        if (m?.type === 'hello') login(m.token);
        else {
          this.send(ws, { type: 'error', code: 'unauthorized', message: 'send {"type":"hello","token":"..."} first' });
          ws.close(4001, 'unauthorized');
        }
        return;
      }
      if (m?.type === 'ping') return this.send(ws, { type: 'pong' });
      if (m?.type === 'hello') return;
      if (m?.type !== 'action') return this.send(ws, { type: 'error', code: 'bad_message', message: `unknown message type ${String(m?.type)}` });
      const link = typeof m.chatId === 'string' ? this.links.get(m.chatId) : undefined;
      if (!link || link.conn !== conn) return this.send(ws, { type: 'error', code: 'unknown_chat', message: 'no live chat of yours with that id', chatId: m.chatId });
      // validated by the session like every other brain's actions
      link.next(m.action as BrainAction);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(beat);
      if (conn && this.conns.get(conn.bm.name) === conn) this.dropConn(conn, 'disconnected');
    });
    ws.on('error', (e) => log.debug(`botmaster socket: ${errMsg(e)}`));
  }

  private dropConn(conn: Conn, why: string): void {
    if (this.conns.get(conn.bm.name) === conn) this.conns.delete(conn.bm.name);
    log.warn(`botmaster ${conn.bm.name} ${why}; its ${conn.chats.size} live chat(s) fall back to the default brain`);
    for (const chatId of [...conn.chats]) this.links.get(chatId)?.fail(why);
  }

  /** A Brain that forwards this chat's events to the botmaster and its actions back. */
  brain(name: string, chatId: string, personaId: string): Brain {
    return (events: Observable<BrainEvent>) =>
      new Observable<BrainAction>((sub) => {
        const conn = this.conns.get(name);
        if (!conn) {
          sub.error(new Error('offline'));
          return;
        }
        const link: Link = { chatId, personaId, conn, next: (a) => sub.next(a), fail: (why) => sub.error(new Error(why)) };
        this.links.set(chatId, link);
        conn.chats.add(chatId);
        const s = events.subscribe({
          next: (event) => this.send(conn.ws, { type: 'event', chatId, personaId, event }),
          complete: () => sub.complete(),
        });
        return () => {
          s.unsubscribe();
          if (this.links.get(chatId) === link) this.links.delete(chatId);
          conn.chats.delete(chatId);
        };
      });
  }

  /** Tell the botmaster why its chat was taken over (best effort). */
  notice(chatId: string, name: string, code: string, message: string): void {
    const conn = this.conns.get(name);
    if (conn) this.send(conn.ws, { type: 'error', code, message, chatId });
  }

  close(): void {
    for (const c of this.conns.values()) c.ws.terminate();
    this.conns.clear();
    this.wss.close();
  }
}
