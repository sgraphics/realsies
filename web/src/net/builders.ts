// The AI-builder API (protocol v1.2, "AI builders"; docs/agents.md): the public access request and the
// botmaster endpoints behind `Authorization: Bearer <botmaster token>`. HTTP only, not part of GameClient.
// createBuilderClient() picks the in-browser mock with ?mock=1, else the relay on this origin.

import type {
  AgentAccessRequest, AgentRequestReceipt, BotmasterChat, BotmasterProfile, BotmasterStats, Level, PublicConfig,
} from '../../../shared/protocol.ts';

export type LangLevel = 'native' | 'fluent' | 'good' | 'basic';

/** The dials the conversation brain uses for a persona (docs/bot-api.md sections 9 and 10), each 0..1. */
export interface PersonaTraits {
  summary?: string;
  chatty?: number;
  fast?: number;
  curious?: number;
  guarded?: number;
  drift?: number;
}

/** POST /api/botmaster/personas: pending until the operator approves it. */
export interface PersonaRequest {
  /** Short name; the relay's id is <botmaster>-<id>, random when left out. Resubmitting a pending one replaces it. */
  id?: string;
  model: string;
  prompt: string;
  levels: Level[];
  /** default: the relay's conversation brain plays the timing; remote: yours over /bot/ws (ours stands in). */
  brain?: 'default' | 'remote';
  traits?: PersonaTraits;
  languages?: Record<string, LangLevel>;
}

/** What the persona request answers (the persona's summary per docs/agents.md); every field optional here. */
export interface PersonaReceipt {
  id?: string;
  status?: string;
  createdAt?: number;
  promptSha256?: string;
  /** Things the relay accepted but flags, e.g. a prompt without the closing paragraph. */
  warnings?: string[];
}

/** Extras the relay puts on GET /api/botmaster/me beyond BotmasterProfile (docs/agents.md section 7). */
export interface ProfileExtras {
  /** Your brain is connected over /bot/ws. */
  online?: boolean;
  /** Your own NEAR AI key: ok or out_of_credits, and the estimated spend on it. */
  ai?: { status?: string; since?: number; spendUsd?: number };
}

export function profileExtras(p: unknown): ProfileExtras {
  const x = (p ?? {}) as { online?: unknown; ai?: unknown };
  const ai = x.ai && typeof x.ai === 'object' ? (x.ai as Record<string, unknown>) : null;
  return {
    ...(typeof x.online === 'boolean' ? { online: x.online } : {}),
    ...(ai
      ? {
          ai: {
            ...(typeof ai.status === 'string' ? { status: ai.status } : {}),
            ...(typeof ai.since === 'number' ? { since: ai.since } : {}),
            ...(typeof ai.spendUsd === 'number' ? { spendUsd: ai.spendUsd } : {}),
          },
        }
      : {}),
  };
}

/** A persona's review status (pending, approved, rejected, disabled) and the operator's reason, when the relay sends them. */
export function personaReview(p: unknown): { status?: string; reason?: string } {
  const x = (p ?? {}) as { status?: unknown; reason?: unknown };
  return {
    ...(typeof x.status === 'string' ? { status: x.status } : {}),
    ...(typeof x.reason === 'string' && x.reason.trim() ? { reason: x.reason.trim() } : {}),
  };
}

/** HTTP errors arrive as {error, code, message, field?}; status 0 is a network failure. */
export class BuilderError extends Error {
  readonly status: number;
  readonly code: string;
  /** The request field the server rejected, when it names one ("email", "prompt", "key"). */
  readonly field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'BuilderError';
    this.status = status;
    this.code = code;
    if (field) this.field = field;
  }
}

export interface BuilderClient {
  readonly mock: boolean;
  getConfig(): Promise<PublicConfig>;
  requestAccess(req: AgentAccessRequest): Promise<AgentRequestReceipt>;
  me(token: string): Promise<BotmasterProfile>;
  stats(token: string): Promise<BotmasterStats>;
  chats(token: string, q?: { round?: number; limit?: number }): Promise<BotmasterChat[]>;
  exportJsonl(token: string): Promise<Blob>;
  setNearAiKey(token: string, key: string): Promise<unknown>;
  removeNearAiKey(token: string): Promise<unknown>;
  requestPersona(token: string, req: PersonaRequest): Promise<PersonaReceipt>;
}

export function isAuthError(e: unknown): boolean {
  if (!(e instanceof BuilderError)) return false;
  return e.status === 401 || e.status === 403 || ['unauthorized', 'forbidden', 'bad_token', 'unknown_token', 'invalid_token'].includes(e.code);
}

/** Words for a person, whatever the server said. */
export function friendlyError(e: unknown, what: 'token' | 'request' | 'data' = 'data'): string {
  if (!(e instanceof BuilderError)) return (e as Error)?.message || 'Something went wrong. Please try again.';
  if (e.status === 0) return 'Could not reach Realsies. Check your connection and try again.';
  if (isAuthError(e)) return 'That token was not accepted. Check that you copied all of it, or ask us for a new one.';
  if (e.status === 404 && (e.code === 'not_found' || !e.code))
    return what === 'request' ? 'Access requests are not open on this server yet. Please try again soon.' : 'This server does not have the botmaster API yet.';
  if (e.status === 429 || e.code === 'rate_limited') return 'That was a lot of requests at once. Wait a minute and try again.';
  // a named 5xx (byok_disabled, models_unavailable) says what is wrong; a bare one gets the generic words
  if (e.status >= 500 && (e.code === 'internal' || e.code.startsWith('http_'))) return `The server had a problem (${e.message || e.status}). Please try again in a moment.`;
  return e.message || `Request failed (${e.status}).`;
}

export interface RealBuilderOptions {
  /** HTTP base, default same origin (''). */
  base?: string;
  fetchImpl?: typeof fetch;
}

export class RealBuilderClient implements BuilderClient {
  readonly mock = false;
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(o: RealBuilderOptions = {}) {
    this.base = o.base ?? '';
    this.fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, o: { token?: string; body?: unknown; blob?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: o.blob ? 'application/x-ndjson, application/json' : 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, { method, headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    } catch (e) {
      throw new BuilderError(0, 'network', (e as Error)?.message || 'network error');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let d: { error?: string; code?: string; message?: string; field?: unknown } | null = null;
      try {
        d = text ? JSON.parse(text) : null;
      } catch {
        d = null;
      }
      const code = d?.code ?? d?.error ?? `http_${res.status}`;
      throw new BuilderError(res.status, code, d?.message ?? d?.error ?? (text.slice(0, 200) || `${res.status} ${res.statusText}`), typeof d?.field === 'string' ? d.field : undefined);
    }
    if (o.blob) return (await res.blob()) as T;
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  getConfig(): Promise<PublicConfig> {
    return this.call('GET', '/api/config');
  }
  requestAccess(req: AgentAccessRequest): Promise<AgentRequestReceipt> {
    return this.call('POST', '/api/agents/request', { body: req });
  }
  me(token: string): Promise<BotmasterProfile> {
    return this.call('GET', '/api/botmaster/me', { token });
  }
  stats(token: string): Promise<BotmasterStats> {
    return this.call('GET', '/api/botmaster/stats', { token });
  }
  async chats(token: string, q: { round?: number; limit?: number } = {}): Promise<BotmasterChat[]> {
    const p = new URLSearchParams();
    if (q.round !== undefined) p.set('round', String(q.round));
    if (q.limit !== undefined) p.set('limit', String(q.limit));
    const qs = p.toString();
    const out = await this.call<unknown>('GET', '/api/botmaster/chats' + (qs ? '?' + qs : ''), { token });
    // an array (protocol v1.2); tolerate a wrapped list too
    return Array.isArray(out) ? out : Array.isArray((out as { chats?: unknown })?.chats) ? (out as { chats: BotmasterChat[] }).chats : [];
  }
  exportJsonl(token: string): Promise<Blob> {
    return this.call('GET', '/api/botmaster/export.jsonl', { token, blob: true });
  }
  setNearAiKey(token: string, key: string): Promise<unknown> {
    return this.call('PUT', '/api/botmaster/nearai-key', { token, body: { key } });
  }
  removeNearAiKey(token: string): Promise<unknown> {
    return this.call('DELETE', '/api/botmaster/nearai-key', { token });
  }
  requestPersona(token: string, req: PersonaRequest): Promise<PersonaReceipt> {
    return this.call('POST', '/api/botmaster/personas', { token, body: req });
  }
}

