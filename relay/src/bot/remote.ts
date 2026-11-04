// Remote brains: a registered botmaster's process connects to /bot/ws, authenticates with its token
// (relay/botmasters/<name>.json holds only the token's sha256), receives the event stream of every
// chat played by its personas, and sends actions in the same JSON as the default brain. The relay
// validates and executes them under the same limits; if the botmaster is offline at chat start,
// disconnects, or stays silent, the session falls back to the default brain (src/bot/session.ts).
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
    out.push({ name: raw.name, tokenSha256: raw.tokenSha256, personas: raw.personas, silenceMs: raw.silenceMs, contact: raw.contact });
  }
  const names = new Set<string>();
  for (const b of out) {
    if (names.has(b.name)) throw new Error(`duplicate botmaster ${b.name}`);
    names.add(b.name);
  }
  return out;
}

export const tokenHash = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

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
  chats: Set<string>;
}

export class BotmasterHub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private conns = new Map<string, Conn>();
  private links = new Map<string, Link>();
  private byHash = new Map<string, Botmaster>();

  constructor(
    readonly botmasters: Botmaster[],
    /** brain ms of silence before the default brain takes over, for botmasters that set none */
    readonly defaultSilenceMs: number = LIMITS.remoteSilenceMs,
  ) {
    for (const b of botmasters) this.byHash.set(b.tokenSha256, b);
  }

  silenceMsOf(name: string): number {
    return this.get(name)?.silenceMs ?? this.defaultSilenceMs;
  }

  get(name: string): Botmaster | undefined {
    return this.botmasters.find((b) => b.name === name);
  }

  online(name: string): boolean {
    return this.conns.has(name);
  }

  /** The botmaster drives this persona and is connected now. */
  drives(name: string, personaId: string): boolean {
    const b = this.get(name);
    return !!b && b.personas.includes(personaId) && this.online(name);
  }

  private auth(token: unknown): Botmaster | undefined {
    if (typeof token !== 'string' || token.length < 16 || token.length > 512) return undefined;
    const h = tokenHash(token);
    for (const b of this.botmasters) {
      if (crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(b.tokenSha256, 'hex'))) return b;
    }
    return undefined;
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
      if (!bm) {
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
      conn = { ws, bm, chats: new Set() };
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
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, 20_000);
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
