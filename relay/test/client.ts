// Headless relay client for tests: HTTP helpers and a WebSocket wrapper with message waiting.
import type { ClientMsg, ServerMsg } from '../../shared/protocol.js';

export async function http<T = any>(base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    j = text;
  }
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${typeof j === 'string' ? j : JSON.stringify(j)}`);
  return j as T;
}

type Pred = (m: ServerMsg) => boolean;

export class WsClient {
  msgs: ServerMsg[] = [];
  /** local receipt time of each message in msgs */
  times: number[] = [];
  private used = new Set<number>();
  private waiters: { pred: Pred; resolve: (m: ServerMsg) => void; idx: number }[] = [];
  private closed = false;

  private constructor(readonly account: string, private ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as ServerMsg;
      this.times.push(Date.now());
      const i = this.msgs.push(m) - 1;
      for (const w of [...this.waiters]) {
        if (!this.used.has(i) && w.pred(m)) {
          this.used.add(i);
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
          break;
        }
      }
    });
    ws.addEventListener('close', () => (this.closed = true));
  }

  static connect(base: string, account: string): Promise<WsClient> {
    return WsClient.connectQuery(base, `account=${encodeURIComponent(account)}`, account);
  }

  /** A wallet session's socket: `/ws?ticket=` with a one-time ticket from POST /api/session/ticket. */
  static connectTicket(base: string, ticket: string, account: string): Promise<WsClient> {
    return WsClient.connectQuery(base, `ticket=${encodeURIComponent(ticket)}`, account);
  }

  private static connectQuery(base: string, query: string, account: string): Promise<WsClient> {
    const url = base.replace(/^http/, 'ws') + `/ws?${query}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new WsClient(account, ws);
      ws.addEventListener('open', () => resolve(c), { once: true });
      ws.addEventListener('error', () => reject(new Error(`ws connect failed for ${account}`)), { once: true });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(m: ClientMsg): void {
    if (this.closed) throw new Error(`${this.account}: socket closed`);
    this.ws.send(JSON.stringify(m));
  }

  /** First not-yet-consumed message matching pred, already received or arriving within timeoutMs. */
  wait<T extends ServerMsg = ServerMsg>(pred: Pred, timeoutMs: number, label: string): Promise<T> {
    for (let i = 0; i < this.msgs.length; i++) {
      if (!this.used.has(i) && pred(this.msgs[i])) {
        this.used.add(i);
        return Promise.resolve(this.msgs[i] as T);
      }
    }
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const w = {
        pred,
        resolve: (m: ServerMsg) => {
          if (timer) clearTimeout(timer);
          (resolve as (m: ServerMsg) => void)(m);
        },
        idx: this.msgs.length,
      };
      this.waiters.push(w);
      timer = setTimeout(() => {
        const at = this.waiters.indexOf(w);
        if (at >= 0) {
          this.waiters.splice(at, 1);
          const recent = this.msgs.slice(-8).map((m) => JSON.stringify(m).slice(0, 160)).join('\n    ');
          reject(new Error(`${this.account}: timed out after ${timeoutMs} ms waiting for ${label}; last messages:\n    ${recent}`));
        }
      }, timeoutMs);
    });
  }

  waitT<K extends ServerMsg['t']>(t: K, timeoutMs: number, extra?: (m: Extract<ServerMsg, { t: K }>) => boolean): Promise<Extract<ServerMsg, { t: K }>> {
    return this.wait((m) => m.t === t && (!extra || extra(m as any)), timeoutMs, t) as any;
  }

  /** When a message arrived (local clock). */
  receivedAt(m: ServerMsg): number {
    const i = this.msgs.indexOf(m);
    return i >= 0 ? this.times[i] : Date.now();
  }

  /**
   * chat_started for this chat, then wait out the countdown: the relay refuses `say` before startedAt.
   * With countdownMs (from /api/config) it waits that long after the message arrived, which is right even
   * when the relay's clock and ours differ; without it, until startedAt on our clock.
   */
  async waitChatStart(chatId: string, timeoutMs: number, countdownMs?: number): Promise<Extract<ServerMsg, { t: 'chat_started' }>> {
    const m = await this.waitT('chat_started', timeoutMs, (x) => x.chatId === chatId);
    await this.untilStarted(m, countdownMs);
    return m;
  }

  /** Sleep until the chat of this chat_started message has started (see waitChatStart). */
  async untilStarted(m: Extract<ServerMsg, { t: 'chat_started' }>, countdownMs?: number): Promise<void> {
    const until = countdownMs === undefined ? m.startedAt : this.receivedAt(m) + countdownMs;
    const left = until - Date.now();
    if (left > 0) await new Promise((r) => setTimeout(r, left + 30));
  }

  errors(): Extract<ServerMsg, { t: 'error' }>[] {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: 'error' }> => m.t === 'error');
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}
