// GameClient over the relay's HTTP API and WebSocket (spec section 4).

import type {
  AuthChallenge,
  AuthProof,
  AuthSession,
  ClientMsg,
  GameClient,
  LeaderRow,
  Me,
  PlayKeyInfo,
  PublicConfig,
  RoundResults,
  RoundSummary,
  ServerMsg,
  TestUser,
  VerifyBundle,
  WalletInfo,
} from '../../../shared/protocol.ts';

export type Status = 'connecting' | 'open' | 'closed';

export interface RealClientOptions {
  /** HTTP base, default same origin (''). */
  base?: string;
  /** WebSocket base like "wss://host", default derived from location. */
  wsBase?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  pingMs?: number;
}

const enc = encodeURIComponent;

export class RealGameClient implements GameClient {
  private base: string;
  private wsBase?: string;
  private fetchImpl: typeof fetch;
  private WS: typeof WebSocket;
  private pingMs: number;
  private ws: WebSocket | null = null;
  private account: string | null = null;
  private want = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private queue: ClientMsg[] = [];
  private handlers = new Set<(m: ServerMsg) => void>();
  private statusHandlers = new Set<(s: Status) => void>();
  private status: Status = 'closed';
  /** wallet session (v1.3): sent as Bearer on every request, traded for a one-time ticket per WebSocket */
  private session: { token: string; accountId: string } | null = null;

  constructor(o: RealClientOptions = {}) {
    this.base = o.base ?? '';
    this.wsBase = o.wsBase;
    this.fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.WS = o.WebSocketImpl ?? (globalThis as { WebSocket: typeof WebSocket }).WebSocket;
    this.pingMs = o.pingMs ?? 20_000;
  }

  // ---------- HTTP ----------

  private async http<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.session) headers.Authorization = `Bearer ${this.session.token}`;
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const d = data as { message?: string; error?: string; code?: string } | string | null;
      const msg = typeof d === 'string' ? d : d?.message ?? d?.error ?? `${res.status} ${res.statusText}`;
      const err = new Error(msg) as Error & { status?: number; code?: string };
      err.status = res.status;
      if (d && typeof d === 'object' && d.code) err.code = d.code;
      throw err;
    }
    return data as T;
  }

  getConfig(): Promise<PublicConfig> {
    return this.http('GET', '/api/config');
  }
  listTestUsers(): Promise<TestUser[]> {
    return this.http('GET', '/api/test-users');
  }
  faucet(accountId: string, coins?: number): Promise<{ tx: string; me: Me }> {
    return this.http('POST', `/api/test-users/${enc(accountId)}/faucet`, coins === undefined ? {} : { coins });
  }
  withdraw(accountId: string, coins: number): Promise<{ tx: string; me: Me }> {
    return this.http('POST', '/api/withdraw', { accountId, coins });
  }
  getMe(accountId: string): Promise<Me> {
    return this.http('GET', `/api/me/${enc(accountId)}`);
  }
  listRounds(): Promise<RoundSummary[]> {
    return this.http('GET', '/api/rounds');
  }
  getResults(roundId: number, accountId: string): Promise<RoundResults> {
    return this.http('GET', `/api/rounds/${roundId}/results/${enc(accountId)}`);
  }
  getVerify(chatId: string, accountId: string): Promise<VerifyBundle> {
    return this.http('GET', `/api/verify/${enc(chatId)}?account=${enc(accountId)}`);
  }
  leaderboard(): Promise<LeaderRow[]> {
    return this.http('GET', '/api/leaderboard');
  }
  async devEndRound(): Promise<void> {
    await this.http('POST', '/api/dev/end-round', {});
  }

  // ---------- wallet sign-in (v1.3) ----------

  authChallenge(): Promise<AuthChallenge> {
    return this.http('POST', '/api/auth/challenge', {});
  }
  async authVerify(proof: AuthProof): Promise<AuthSession> {
    const s = await this.http<AuthSession>('POST', '/api/auth/verify', proof);
    this.session = { token: s.token, accountId: s.accountId };
    return s;
  }
  async resumeSession(token: string): Promise<AuthSession | null> {
    const prev = this.session;
    this.session = { token, accountId: '' };
    try {
      const s = await this.http<AuthSession>('GET', '/api/session');
      this.session = { token, accountId: s.accountId };
      return { ...s, token };
    } catch (e) {
      this.session = prev;
      if ((e as { status?: number }).status === 401) return null;
      throw e;
    }
  }
  async signOut(): Promise<void> {
    try {
      if (this.session) await this.http('DELETE', '/api/session');
    } finally {
      this.session = null;
      this.disconnect();
    }
  }
  registerPlayKey(publicKey: string): Promise<PlayKeyInfo> {
    return this.http('POST', '/api/session/play-key', { publicKey });
  }
  walletInfo(): Promise<WalletInfo> {
    return this.http('GET', '/api/session/wallet');
  }
  reportDeposit(txHash: string): Promise<{ me: Me; bonusTx?: string }> {
    return this.http('POST', '/api/session/deposit', { txHash });
  }
  faucetToWallet(coins?: number): Promise<{ tx: string }> {
    return this.http('POST', '/api/session/faucet-wallet', coins === undefined ? {} : { coins });
  }

  // ---------- WebSocket ----------

  private wsUrl(query: string): string {
    let base = this.wsBase;
    if (!base) {
      if (this.base) base = this.base.replace(/^http/, 'ws');
      else {
        const loc = (globalThis as { location?: Location }).location;
        base = loc ? `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}` : 'ws://localhost:3960';
      }
    }
    return `${base}/ws?${query}`;
  }


  private setStatus(s: Status): void {
    if (this.status === s) return;
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  connect(accountId: string): void {
    if (this.want && this.account === accountId && this.ws) return;
    this.disconnect();
    this.account = accountId;
    this.want = true;
    this.retry = 0;
    this.open();
  }

  private open(): void {
    if (!this.want || !this.account) return;
    this.setStatus('connecting');
    const account = this.account;
    // a test user connects by name (test mode); a wallet session trades its token for a one-time ticket
    if (!this.session || this.session.accountId !== account) {
      this.openSocket(`account=${enc(account)}`);
      return;
    }
    this.http<{ ticket: string }>('POST', '/api/session/ticket', {}).then(
      (t) => {
        if (!this.want || this.account !== account || this.ws) return;
        this.openSocket(`ticket=${enc(t.ticket)}`);
      },
      (e: { status?: number }) => {
        if (!this.want || this.account !== account) return;
        if (e?.status === 401) {
          // the session ended (expired or signed out elsewhere): stop and say so
          this.want = false;
          this.setStatus('closed');
          for (const h of [...this.handlers]) h({ t: 'error', code: 'session_expired', message: 'Your session ended. Sign in again.' });
          return;
        }
        this.scheduleReconnect();
      },
    );
  }

  private openSocket(query: string): void {
    let ws: WebSocket;
    try {
      ws = new this.WS(this.wsUrl(query));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.setStatus('open');
      const q = this.queue;
      this.queue = [];
      for (const m of q) ws.send(JSON.stringify(m));
      this.stopPing();
      this.pingTimer = setInterval(() => this.rawSend({ t: 'ping' }), this.pingMs);
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (this.ws !== ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      for (const h of [...this.handlers]) {
        try {
          h(msg);
        } catch (e) {
          console.error('handler failed', e);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    if (!this.want) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const delay = Math.min(10_000, 1000 * 2 ** this.retry);
    this.retry++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private rawSend(m: ClientMsg): boolean {
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }

  disconnect(): void {
    this.want = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.setStatus('closed');
  }

  send(msg: ClientMsg): void {
    if (!this.rawSend(msg)) {
      if (msg.t === 'ping') return;
      this.queue.push(msg);
    }
  }

  on(handler: (msg: ServerMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(handler: (status: Status) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }
}
