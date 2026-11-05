// Operator actions on AI builders, shared by the admin HTTP API (Bearer ADMIN_TOKEN) and the command line
// (tools/botmaster-admin.ts): approve or reject access requests, create botmasters, revoke and rotate their
// tokens, approve, reject or disable their personas. A token is returned once, when it is made; the relay
// keeps only its sha256.
import crypto from 'node:crypto';
import type { BuilderKind } from '../../../shared/protocol.js';
import { isAccountId, tokenHash } from '../bot/remote.js';
import { logger } from '../log.js';
import { ApiError } from './validate.js';
import type { AccessRequestRec, AgentPersonaRec, AgentStore, BotmasterRec } from './store.js';

const log = logger('agents');

export interface AdminContext {
  store: AgentStore;
  /** names taken by relay/botmasters/*.json */
  fileBotmasters: () => string[];
  /** a botmaster's live /bot/ws connection is closed (revoked or rotated) */
  kick?: (name: string, code: string, message: string) => void;
  now?: () => number;
}

export const NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** A new botmaster token: 32 random bytes, base64url, with a recognisable prefix. */
export function newToken(): string {
  return `rlsbm_${crypto.randomBytes(32).toString('base64url')}`;
}

/** Lowercase letters, digits and dashes from free text, 2 to 30 characters. */
export function slugify(s: string): string {
  const x = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return x.length >= 2 ? x : `bm-${x || 'x'}`;
}

function nameTaken(ctx: AdminContext, name: string): boolean {
  return !!ctx.store.getBotmaster(name) || ctx.fileBotmasters().includes(name);
}

/** The first free name from the request (company, else name), with -2, -3 ... if needed. */
export function suggestName(ctx: AdminContext, req: { company?: string; name: string }): string {
  const base = slugify(req.company || req.name);
  for (let i = 1; i < 1000; i++) {
    const n = i === 1 ? base : `${base.slice(0, 26)}-${i}`;
    if (!nameTaken(ctx, n)) return n;
  }
  return `${base.slice(0, 20)}-${crypto.randomBytes(3).toString('hex')}`;
}

/** What admin lists show of a botmaster: never its token, only a short fingerprint of the hash. */
export function adminView(b: BotmasterRec) {
  const { tokenSha256, ...rest } = b;
  return { ...rest, tokenFingerprint: tokenSha256.slice(0, 8) };
}

export interface CreateOpts {
  name: string;
  payoutAccount: string;
  contact?: string;
  displayName?: string;
  company?: string;
  kind?: BuilderKind;
  requestId?: string;
  silenceMs?: number;
}

function checkCreate(ctx: AdminContext, o: CreateOpts): void {
  if (!NAME.test(o.name)) throw new ApiError('invalid_request', 'name: lowercase letters, digits and dashes, 2 to 41 characters', 400, 'name');
  if (nameTaken(ctx, o.name)) throw new ApiError('name_taken', `a botmaster named ${o.name} exists`, 409, 'name');
  if (!isAccountId(o.payoutAccount)) throw new ApiError('payout_required', 'payoutAccount: a NEAR account id that receives the Turing bonus', 400, 'payoutAccount');
  if (o.silenceMs !== undefined && !(Number.isInteger(o.silenceMs) && o.silenceMs >= 3000 && o.silenceMs <= 60_000))
    throw new ApiError('invalid_request', 'silenceMs: 3000 to 60000', 400, 'silenceMs');
}

function insert(ctx: AdminContext, o: CreateOpts): { botmaster: BotmasterRec; token: string } {
  const token = newToken();
  const now = (ctx.now ?? Date.now)();
  const b: BotmasterRec = {
    name: o.name, tokenSha256: tokenHash(token), status: 'active', payoutAccount: o.payoutAccount, contact: o.contact, displayName: o.displayName,
    company: o.company, kind: o.kind, requestId: o.requestId, silenceMs: o.silenceMs, createdAt: now, tokenIssuedAt: now,
  };
  ctx.store.saveBotmaster(b);
  return { botmaster: b, token };
}

export function createBotmaster(ctx: AdminContext, o: CreateOpts): { botmaster: BotmasterRec; token: string } {
  checkCreate(ctx, o);
  const out = ctx.store.tx(() => insert(ctx, o));
  log.info(`botmaster ${o.name} created (payout ${o.payoutAccount})`);
  return out;
}

export function approveRequest(
  ctx: AdminContext,
  id: string,
  opts: { name?: string; payoutAccount?: string; silenceMs?: number } = {},
): { request: AccessRequestRec; botmaster: BotmasterRec; token: string } {
  const req = ctx.store.getRequest(id);
  if (!req) throw new ApiError('not_found', `no access request ${id}`, 404);
  if (req.status !== 'pending') throw new ApiError('already_decided', `request ${id} is ${req.status}`, 409);
  const o: CreateOpts = {
    name: opts.name ?? suggestName(ctx, req.request),
    payoutAccount: opts.payoutAccount ?? req.request.payoutAccount ?? '',
    contact: req.request.email,
    displayName: req.request.name,
    company: req.request.company,
    kind: req.request.kind,
    requestId: id,
    silenceMs: opts.silenceMs,
  };
  checkCreate(ctx, o);
  const out = ctx.store.tx(() => {
    const fresh = ctx.store.getRequest(id);
    if (!fresh || fresh.status !== 'pending') throw new ApiError('already_decided', `request ${id} is ${fresh?.status ?? 'gone'}`, 409);
    const made = insert(ctx, o);
    const decided: AccessRequestRec = { ...fresh, status: 'approved', decidedAt: made.botmaster.createdAt, botmaster: o.name };
    ctx.store.saveRequest(decided);
    return { request: decided, ...made };
  });
  log.info(`access request ${id} approved: botmaster ${o.name} (payout ${o.payoutAccount})`);
  return out;
}

export function rejectRequest(ctx: AdminContext, id: string, reason: unknown): AccessRequestRec {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new ApiError('invalid_request', 'reason: 1 to 500 characters', 400, 'reason');
  return ctx.store.tx(() => {
    const req = ctx.store.getRequest(id);
    if (!req) throw new ApiError('not_found', `no access request ${id}`, 404);
    if (req.status !== 'pending') throw new ApiError('already_decided', `request ${id} is ${req.status}`, 409);
    const decided: AccessRequestRec = { ...req, status: 'rejected', decidedAt: (ctx.now ?? Date.now)(), reason: reason.trim() };
    ctx.store.saveRequest(decided);
    log.info(`access request ${id} rejected`);
    return decided;
  });
}

function getBm(ctx: AdminContext, name: string): BotmasterRec {
  const b = ctx.store.getBotmaster(name);
  if (!b) throw new ApiError('not_found', ctx.fileBotmasters().includes(name) ? `${name} is configured in relay/botmasters/${name}.json; edit that file` : `no botmaster ${name}`, 404);
  return b;
}

export function revokeBotmaster(ctx: AdminContext, name: string, reason?: unknown): BotmasterRec {
  const b = getBm(ctx, name);
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) throw new ApiError('invalid_request', 'reason: at most 500 characters', 400, 'reason');
  const out: BotmasterRec = { ...b, status: 'revoked', revokedAt: (ctx.now ?? Date.now)(), reason: typeof reason === 'string' && reason.trim() ? reason.trim() : b.reason };
  ctx.store.saveBotmaster(out);
  ctx.kick?.(name, 'revoked', 'this botmaster was revoked by the operator');
  log.info(`botmaster ${name} revoked: its token stops working and its personas leave the rounds`);
  return out;
}

/** A fresh token; the old one stops working at once. Rotating a revoked botmaster reactivates it. */
export function rotateToken(ctx: AdminContext, name: string): { botmaster: BotmasterRec; token: string } {
  const b = getBm(ctx, name);
  const token = newToken();
  const out: BotmasterRec = { ...b, tokenSha256: tokenHash(token), status: 'active', tokenIssuedAt: (ctx.now ?? Date.now)(), revokedAt: undefined };
  ctx.store.saveBotmaster(out);
  ctx.kick?.(name, 'rotated', 'this botmaster token was replaced; connect with the new one');
  log.info(`botmaster ${name}: token rotated${b.status === 'revoked' ? ' (reactivated)' : ''}`);
  return { botmaster: out, token };
}

export type PersonaAction = 'approve' | 'reject' | 'disable';

export function decidePersona(ctx: AdminContext, id: string, action: PersonaAction, reason?: unknown): AgentPersonaRec {
  const p = ctx.store.getPersona(id);
  if (!p) throw new ApiError('not_found', `no persona ${id}`, 404);
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 500)) throw new ApiError('invalid_request', 'reason: at most 500 characters', 400, 'reason');
  if (action === 'reject' && (typeof reason !== 'string' || !reason.trim())) throw new ApiError('invalid_request', 'reason: say why the persona is rejected', 400, 'reason');
  const allowed: Record<PersonaAction, AgentPersonaRec['status'][]> = { approve: ['pending', 'disabled'], reject: ['pending'], disable: ['approved'] };
  if (!allowed[action].includes(p.status)) throw new ApiError('already_decided', `persona ${id} is ${p.status}`, 409);
  const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'disabled';
  const out: AgentPersonaRec = { ...p, status, decidedAt: (ctx.now ?? Date.now)(), reason: typeof reason === 'string' && reason.trim() ? reason.trim() : action === 'approve' ? undefined : p.reason };
  ctx.store.savePersona(out);
  log.info(`persona ${id} of ${p.botmaster} ${status}${status === 'approved' ? ': it plays from the next round' : ''}`);
  return out;
}
