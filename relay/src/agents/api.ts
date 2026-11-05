// The AI builders HTTP API (docs/agents.md, shared/protocol.ts "AI builders"):
//   POST /api/agents/request                 apply for access (public, rate-limited per IP)
//   GET  /api/agents/info                    what the relay accepts: models, prompt rules, the bonus (public)
//   /api/admin/...                           Bearer ADMIN_TOKEN: requests, botmasters, personas
//   /api/botmaster/...                       Bearer <botmaster token>, the token /bot/ws accepts: profile,
//                                            stats, settled chats, export, personas, own NEAR AI key
import crypto from 'node:crypto';
import { once } from 'node:events';
import type http from 'node:http';
import type { AgentRequestReceipt, BotmasterPersonaSummary, BotmasterProfile } from '../../../shared/protocol.js';
import type { Config } from '../config.js';
import { GameError, type Game } from '../game/game.js';
import type { Botmaster, BotmasterHub } from '../bot/remote.js';
import { TOPICS } from '../bot/api.js';
import type { CreditMonitor } from '../nearai/credits.js';
import type { ModelListing } from '../nearai/client.js';
import { MODELS } from '../models.js';
import { STEER_PARAGRAPH } from '../persona/prompt.js';
import { bearerToken, clientIp, readBody, sendJson } from '../http.js';
import { randomHex } from '../crypto.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';
import { ApiError, PROMPT_MAX, PROMPT_MIN, modelProblem, validateAccessRequest, validatePersona } from './validate.js';
import { adminView, approveRequest, createBotmaster, decidePersona, rejectRequest, revokeBotmaster, rotateToken, type AdminContext } from './admin.js';
import { publicChat, statsOf } from './stats.js';
import type { ByokKeys } from './byok.js';
import type { AccessRequestRec, AgentPersonaRec, AgentStore, PersonaStatus, RequestStatus } from './store.js';
import { Notifier } from './notify.js';

const log = logger('agents');

export interface AgentApiDeps {
  cfg: Config;
  store: AgentStore;
  game: Game;
  hub: BotmasterHub;
  credits: CreditMonitor;
  byok: ByokKeys;
  admin: AdminContext;
  /** the gateway's model list (GET /v1/models, public) */
  models: () => Promise<ModelListing[]>;
  /** operator emails (src/agents/notify.ts); default: from cfg, off without AGENT_NOTIFY_EMAIL */
  notifier?: Notifier;
}

/** at most this many personas (pending and approved) per botmaster */
export const MAX_PERSONAS = 10;
const STREAMED = Symbol('streamed');

type Handler = (m: RegExpMatchArray, req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<unknown> | unknown;

/** Sliding one-hour window per key. */
class RateLimit {
  private hits = new Map<string, number[]>();
  constructor(private perHour: number) {}
  private recent(key: string, now: number): number[] {
    const xs = (this.hits.get(key) ?? []).filter((t) => t > now - 3_600_000);
    if (xs.length) this.hits.set(key, xs);
    else this.hits.delete(key);
    return xs;
  }
  /** seconds until the next request is allowed, or 0 */
  wait(key: string, now = Date.now()): number {
    const xs = this.recent(key, now);
    if (xs.length < this.perHour) return 0;
    return Math.max(1, Math.ceil((xs[0] + 3_600_000 - now) / 1000));
  }
  hit(key: string, now = Date.now()): void {
    if (this.hits.size > 20_000) this.hits.clear();
    this.hits.set(key, [...this.recent(key, now), now]);
  }
}

const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest();

/** A path segment, decoded; a malformed escape is a bad request, not a server error. */
function dec(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    throw new ApiError('invalid_request', 'malformed path', 400);
  }
}

export function createAgentApi(d: AgentApiDeps) {
  const routes: { method: string; re: RegExp; fn: Handler }[] = [];
  const route = (method: string, re: RegExp, fn: Handler) => routes.push({ method, re, fn });
  const perIp = new RateLimit(Math.max(1, d.cfg.agentRequestsPerHour));
  const notifier = d.notifier ?? new Notifier({ notifyEmail: d.cfg.notifyEmail, notifyFrom: d.cfg.notifyFrom, outboxDir: d.cfg.notifyOutbox });
  const GLOBAL_PER_DAY = 500;
  if (d.cfg.adminToken && d.cfg.adminToken.length < 16) log.warn('ADMIN_TOKEN is shorter than 16 characters: admin endpoints stay disabled');

  // ---------- auth ----------

  function requireAdmin(req: http.IncomingMessage): void {
    const want = d.cfg.adminToken;
    if (!want || want.length < 16) throw new ApiError('admin_disabled', 'admin endpoints are disabled on this relay (ADMIN_TOKEN is not set)', 403);
    const got = bearerToken(req);
    if (!got || !crypto.timingSafeEqual(sha(got), sha(want))) {
      log.warn(`admin request with a wrong token from ${clientIp(req)}`);
      throw new ApiError('unauthorized', 'Authorization: Bearer <ADMIN_TOKEN> required', 401);
    }
  }

  function requireBotmaster(req: http.IncomingMessage): Botmaster {
    const bm = d.hub.auth(bearerToken(req));
    if (!bm) throw new ApiError('unauthorized', 'Authorization: Bearer <botmaster token> required (the token /bot/ws accepts)', 401);
    return bm;
  }

  // ---------- views ----------

  const summaryOf = (p: AgentPersonaRec, active: boolean): BotmasterPersonaSummary & Record<string, unknown> => ({
    id: p.id, model: p.model, levels: p.levels, brain: p.brain, active: active && p.status === 'approved',
    status: p.status, reason: p.reason, promptSha256: p.promptSha256, createdAt: p.createdAt, decidedAt: p.decidedAt,
  });

  function personasOf(bm: Botmaster): (BotmasterPersonaSummary & Record<string, unknown>)[] {
    const out: (BotmasterPersonaSummary & Record<string, unknown>)[] = [];
    if (bm.source === 'db') {
      const rec = d.store.getBotmaster(bm.name);
      const active = rec?.status === 'active';
      for (const p of d.store.listPersonas({ botmaster: bm.name })) out.push(summaryOf(p, active));
    } else {
      // relay/botmasters/<name>.json: the folder personas it drives
      for (const p of d.game.personas) {
        if (p.brain.kind === 'remote' && p.brain.botmaster === bm.name && bm.personas.includes(p.id)) {
          out.push({ id: p.id, model: p.model, levels: [...p.levels], brain: 'remote', active: true, status: 'approved', source: 'file' });
        }
      }
    }
    return out;
  }

  function profileOf(bm: Botmaster): BotmasterProfile & Record<string, unknown> {
    const rec = bm.source === 'db' ? d.store.getBotmaster(bm.name) : undefined;
    const byok = d.byok.has(bm.name);
    const filePayout = d.game.personas.find((p) => p.brain.kind === 'remote' && p.brain.botmaster === bm.name && p.payout)?.payout;
    const ai = byok ? d.credits.health(d.byok.keyIdOf(bm.name)) : undefined;
    return {
      name: bm.name,
      payoutAccount: rec?.payoutAccount ?? bm.payoutAccount ?? filePayout ?? d.game.chain.accounts.bots,
      personas: personasOf(bm),
      byok,
      createdAt: rec?.createdAt ?? bm.createdAt ?? 0,
      // extra fields
      status: rec?.status ?? 'active',
      source: bm.source ?? 'file',
      contact: rec?.contact ?? bm.contact,
      kind: rec?.kind,
      company: rec?.company,
      silenceMs: d.hub.silenceMsOf(bm.name),
      online: d.hub.online(bm.name),
      ai: ai ? { status: ai.status, since: ai.since, spendUsd: ai.spendUsd, reason: ai.reason } : undefined,
    };
  }

  function personaIdsOf(bm: Botmaster): string[] {
    return personasOf(bm).filter((p) => p.status === 'approved' || p.status === 'disabled').map((p) => p.id);
  }

  // ---------- public ----------

  route('POST', /^\/api\/agents\/request$/, async (_m, req, res) => {
    const ip = clientIp(req);
    const wait = perIp.wait(ip);
    if (wait > 0 || d.store.countRequestsSince(Date.now() - 86_400_000) >= GLOBAL_PER_DAY) {
      res.setHeader('Retry-After', String(wait || 3600));
      throw new ApiError('rate_limited', 'too many requests from here; try again later', 429);
    }
    const r = validateAccessRequest(await readBody(req));
    const rec: AccessRequestRec = {
      id: `ar_${randomHex(8)}`, createdAt: Date.now(), status: 'pending', request: r,
      ipHash: crypto.createHmac('sha256', d.store.anonSecret()).update(`ip|${ip}`).digest('hex').slice(0, 16),
    };
    d.store.addRequest(rec);
    perIp.hit(ip);
    log.info(`agent access request ${rec.id}: ${r.kind}, ${r.company ?? r.name} (${r.email.split('@')[1]})`);
    if (d.cfg.agentRequestWebhook) void postWebhook(d.cfg.agentRequestWebhook, rec);
    void notifier.accessRequest(rec);
    const receipt: AgentRequestReceipt = { id: rec.id, status: 'pending', createdAt: rec.createdAt };
    return receipt;
  });

  route('GET', /^\/api\/agents\/info$/, () => ({
    models: Object.values(MODELS).filter((m) => m.multiSystem).map((m) => ({ id: m.id, priceUsdPerMTokens: m.price })),
    prompt: { minChars: PROMPT_MIN, maxChars: PROMPT_MAX, steeringParagraph: STEER_PARAGRAPH },
    levels: [1, 2, 3],
    topics: TOPICS,
    maxPersonas: MAX_PERSONAS,
    turingBonus: {
      characterBps: d.game.chainCfg?.characterBps ?? 2000,
      nobodyRightBps: (d.game.chainCfg?.characterBps ?? 2000) + (d.game.chainCfg?.rightBps ?? 7000),
      note: 'of the locked coins of every paid player the character fools (or who misses the call), paid on chain at settlement; nobodyRightBps when no paid player called it right',
    },
    byok: d.byok.enabled,
  }));

  // ---------- admin ----------

  const statusParam = <T extends string>(url: URL, allowed: T[]): T | undefined => {
    const s = url.searchParams.get('status');
    if (!s || s === 'all') return undefined;
    if (!(allowed as string[]).includes(s)) throw new ApiError('invalid_request', `status: one of ${allowed.join(', ')} or all`, 400, 'status');
    return s as T;
  };

  // the operator's view of NEAR AI: spend, budget and why a key is out (GET /api/health shows only status and since)
  route('GET', /^\/api\/admin\/health$/, (_m, req) => {
    requireAdmin(req);
    return { ok: true, round: d.game.current?.id ?? null, ai: d.credits.health('house'), keys: d.credits.all() };
  });

  route('GET', /^\/api\/admin\/requests$/, (_m, req, _res, url) => {
    requireAdmin(req);
    return d.store.listRequests(statusParam<RequestStatus>(url, ['pending', 'approved', 'rejected']));
  });
  route('GET', /^\/api\/admin\/requests\/([^/]+)$/, (m, req) => {
    requireAdmin(req);
    const r = d.store.getRequest(dec(m[1]));
    if (!r) throw new ApiError('not_found', 'no such request', 404);
    return r;
  });
  route('POST', /^\/api\/admin\/requests\/([^/]+)\/approve$/, async (m, req) => {
    requireAdmin(req);
    const b = await readBody(req);
    const out = approveRequest(d.admin, dec(m[1]), {
      name: typeof b.name === 'string' ? b.name : undefined,
      payoutAccount: typeof b.payoutAccount === 'string' ? b.payoutAccount.trim().toLowerCase() : undefined,
      silenceMs: b.silenceMs === undefined ? undefined : Number(b.silenceMs),
    });
    return { request: out.request, botmaster: adminView(out.botmaster), token: out.token, note: 'the token is shown once; the relay keeps only its sha256' };
  });
  route('POST', /^\/api\/admin\/requests\/([^/]+)\/reject$/, async (m, req) => {
    requireAdmin(req);
    const b = await readBody(req);
    return rejectRequest(d.admin, dec(m[1]), b.reason);
  });
  route('GET', /^\/api\/admin\/botmasters$/, (_m, req) => {
    requireAdmin(req);
    const db = d.store.listBotmasters().map((b) => ({ ...adminView(b), online: d.hub.online(b.name), byok: d.byok.has(b.name), source: 'db' }));
    const files = d.hub.botmasters.filter((b) => b.source !== 'db').map((b) => ({ name: b.name, status: 'active', source: 'file', personas: b.personas, online: d.hub.online(b.name), byok: d.byok.has(b.name) }));
    return [...db, ...files];
  });
  route('POST', /^\/api\/admin\/botmasters$/, async (_m, req) => {
    requireAdmin(req);
    const b = await readBody(req);
    const out = createBotmaster(d.admin, {
      name: String(b.name ?? ''), payoutAccount: String(b.payoutAccount ?? '').trim().toLowerCase(), contact: typeof b.contact === 'string' ? b.contact : undefined,
      silenceMs: b.silenceMs === undefined ? undefined : Number(b.silenceMs),
    });
    return { botmaster: adminView(out.botmaster), token: out.token, note: 'the token is shown once; the relay keeps only its sha256' };
  });
  route('POST', /^\/api\/admin\/botmasters\/([^/]+)\/revoke$/, async (m, req) => {
    requireAdmin(req);
    const b = await readBody(req);
    return adminView(revokeBotmaster(d.admin, dec(m[1]), b.reason));
  });
  route('POST', /^\/api\/admin\/botmasters\/([^/]+)\/rotate$/, async (m, req) => {
    requireAdmin(req);
    const out = rotateToken(d.admin, dec(m[1]));
    return { botmaster: adminView(out.botmaster), token: out.token, note: 'the old token stopped working; this one is shown once' };
  });
  route('GET', /^\/api\/admin\/personas$/, (_m, req, _res, url) => {
    requireAdmin(req);
    const bm = url.searchParams.get('botmaster') ?? undefined;
    return d.store.listPersonas({ status: statusParam<PersonaStatus>(url, ['pending', 'approved', 'rejected', 'disabled']), botmaster: bm });
  });
  route('POST', /^\/api\/admin\/personas\/([^/]+)\/(approve|reject|disable)$/, async (m, req) => {
    requireAdmin(req);
    const b = await readBody(req);
    return decidePersona(d.admin, dec(m[1]), m[2] as 'approve' | 'reject' | 'disable', b.reason);
  });

  // ---------- botmasters ----------

  route('GET', /^\/api\/botmaster\/me$/, (_m, req) => profileOf(requireBotmaster(req)));

  route('GET', /^\/api\/botmaster\/stats$/, (_m, req) => {
    const bm = requireBotmaster(req);
    return statsOf(d.store.chatsOf(bm.name, { transcripts: false }), d.game.coinUnit, personaIdsOf(bm));
  });

  route('GET', /^\/api\/botmaster\/chats$/, (_m, req, _res, url) => {
    const bm = requireBotmaster(req);
    const r = url.searchParams.get('round');
    const l = url.searchParams.get('limit');
    const round = r === null || r === '' ? undefined : Number(r);
    if (round !== undefined && !(Number.isInteger(round) && round >= 1)) throw new ApiError('invalid_request', 'round: a round id', 400, 'round');
    const limit = l === null || l === '' ? 50 : Number(l);
    if (!(Number.isInteger(limit) && limit >= 1 && limit <= 500)) throw new ApiError('invalid_request', 'limit: 1 to 500', 400, 'limit');
    return d.store.chatsOf(bm.name, { round, limit }).map(publicChat);
  });

  route('GET', /^\/api\/botmaster\/export\.jsonl$/, async (_m, req, res) => {
    const bm = requireBotmaster(req);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `attachment; filename="realsies-${bm.name}-chats.jsonl"`,
    });
    let after = 0;
    for (;;) {
      if (res.destroyed) break;
      const page = d.store.chatPage(bm.name, after, 200);
      if (!page.length) break;
      for (const { rowid, rec } of page) {
        after = rowid;
        // a slow reader: wait for the buffer to drain, or for the client to go away
        if (!res.write(JSON.stringify(publicChat(rec)) + '\n')) await drained(res);
        if (res.destroyed) break;
      }
    }
    if (!res.destroyed) res.end();
    return STREAMED;
  });

  route('POST', /^\/api\/botmaster\/personas$/, async (_m, req) => {
    const bm = requireBotmaster(req);
    if (bm.source !== 'db') throw new ApiError('file_botmaster', `${bm.name} is configured in relay/botmasters/${bm.name}.json; its personas live in relay/personas`, 403);
    const rec0 = d.store.getBotmaster(bm.name)!;
    const { sub, warnings } = validatePersona(await readBody(req));
    const mine = d.store.listPersonas({ botmaster: bm.name });
    const slug = sub.slug ?? `p${randomHex(3)}`;
    const id = `${bm.name}-${slug}`;
    if (id.length > 64) throw new ApiError('invalid_request', 'id: too long with your botmaster name; use a shorter one', 400, 'id');
    if (d.game.personas.some((p) => p.id === id)) throw new ApiError('persona_exists', `persona id ${id} is taken`, 409, 'id');
    const existing = d.store.getPersona(id);
    if (existing && existing.botmaster !== bm.name) throw new ApiError('persona_exists', `persona id ${id} is taken`, 409, 'id');
    if (existing && (existing.status === 'approved' || existing.status === 'disabled'))
      throw new ApiError('persona_exists', `persona ${id} is ${existing.status}; a changed prompt is a new persona: submit it under a new id`, 409, 'id');
    if (!existing && mine.filter((p) => p.status === 'pending' || p.status === 'approved').length >= MAX_PERSONAS)
      throw new ApiError('too_many_personas', `at most ${MAX_PERSONAS} personas pending or approved per botmaster`, 409);
    let listing: ModelListing[];
    try {
      listing = await d.models();
    } catch (e) {
      throw new ApiError('models_unavailable', `could not read the NEAR AI model list (${errMsg(e)}); try again in a minute`, 503);
    }
    const problem = modelProblem(sub.model, listing);
    if (problem) throw new ApiError('model_not_allowed', problem, 400, 'model');
    const rec: AgentPersonaRec = {
      id, botmaster: bm.name, status: 'pending', createdAt: Date.now(), model: sub.model, prompt: sub.prompt,
      promptSha256: crypto.createHash('sha256').update(sub.prompt, 'utf8').digest('hex'), levels: sub.levels, brain: sub.brain,
      cps: sub.cps, traits: sub.traits, summary: sub.summary, interests: sub.interests, languages: sub.languages,
    };
    d.store.savePersona(rec);
    void notifier.personaSubmitted(rec);
    log.info(`persona ${id} submitted by ${bm.name} (${sub.model}, levels ${sub.levels.join(',')}, ${sub.brain} brain): pending review`);
    return { ...summaryOf(rec, rec0.status === 'active'), warnings };
  });

  route('PUT', /^\/api\/botmaster\/nearai-key$/, async (_m, req) => {
    const bm = requireBotmaster(req);
    const b = await readBody(req);
    return d.byok.put(bm.name, b.key);
  });

  route('DELETE', /^\/api\/botmaster\/nearai-key$/, (_m, req) => {
    const bm = requireBotmaster(req);
    return d.byok.remove(bm.name);
  });

  return {
    /** Handle /api/agents/*, /api/admin/* and /api/botmaster/*; false for any other path. */
    async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
      const p = url.pathname;
      if (!p.startsWith('/api/agents/') && !p.startsWith('/api/admin/') && !p.startsWith('/api/botmaster/')) return false;
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) {
        sendJson(res, 404, { error: 'not_found', code: 'not_found', message: `${req.method} ${p}` });
        return true;
      }
      try {
        const out = await r.fn(p.match(r.re)!, req, res, url);
        if (out !== STREAMED) sendJson(res, 200, out ?? { ok: true });
      } catch (e) {
        if (res.headersSent) {
          res.destroy();
          return true;
        }
        if (e instanceof GameError) {
          sendJson(res, e.status, { error: e.code, code: e.code, message: e.message, ...(e instanceof ApiError && e.field ? { field: e.field } : {}) });
        } else {
          log.error(`${req.method} ${p}`, e);
          sendJson(res, 500, { error: 'internal', code: 'internal', message: errMsg(e) });
        }
      }
      return true;
    },
  };
}

/** The response buffer drained, or the client went away (both listeners removed either way). */
async function drained(res: http.ServerResponse): Promise<void> {
  const ac = new AbortController();
  try {
    await Promise.race([once(res, 'drain', { signal: ac.signal }), once(res, 'close', { signal: ac.signal })]);
  } catch {
    /* an error on the socket: the caller sees res.destroyed */
  } finally {
    ac.abort();
  }
}

/** One POST per access request; Slack and Discord show `text` / `content`, anything else reads `request`. */
async function postWebhook(url: string, rec: AccessRequestRec): Promise<void> {
  const r = rec.request;
  const line = `New Realsies AI builder request ${rec.id}: ${r.name}${r.company ? ` (${r.company})` : ''}, ${r.kind}, ${r.email}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'realsies.agent_access_request', text: line, content: line, id: rec.id, createdAt: rec.createdAt, request: r }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) log.warn(`AGENT_REQUEST_WEBHOOK answered HTTP ${res.status} for ${rec.id}`);
  } catch (e) {
    log.warn(`AGENT_REQUEST_WEBHOOK failed for ${rec.id}: ${errMsg(e)}`);
  }
}
