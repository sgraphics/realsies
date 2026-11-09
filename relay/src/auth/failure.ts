// POST /api/auth/failed (protocol v1.11): a browser reports a sign-in that failed, so the operator sees why (a phone
// that never gets to its wallet, a wallet that throws, a signature the relay refused). Everything in it comes from
// the browser: one line of the operator's log at most, control characters out, every field cut short.
import type { AuthFailure } from '../../../shared/protocol.js';
import { GameError } from '../game/game.js';

const STAGES: ReadonlySet<string> = new Set(['connect', 'sign', 'verify']);

/** A string from the browser as one short line, or undefined when there is nothing in it. */
function line(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

/** The report as it goes in the log; `uaHeader` (the request's User-Agent) when the body has none. Throws invalid_request. */
export function signInFailure(body: unknown, uaHeader?: string | string[]): AuthFailure {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.stage !== 'string' || !STAGES.has(b.stage)) throw new GameError('invalid_request', 'stage must be connect, sign or verify');
  const walletId = line(b.walletId, 64);
  const ms = typeof b.ms === 'number' && Number.isFinite(b.ms) && b.ms >= 0 ? Math.min(Math.round(b.ms), 86_400_000) : undefined;
  return {
    stage: b.stage as AuthFailure['stage'],
    ...(walletId && /^[\w.-]+$/.test(walletId) ? { walletId } : {}),
    message: line(b.message, 300) ?? '',
    ua: line(b.ua, 240) ?? line(Array.isArray(uaHeader) ? uaHeader[0] : uaHeader, 240) ?? '',
    ...(ms !== undefined ? { ms } : {}),
    ...(typeof b.prefetched === 'boolean' ? { prefetched: b.prefetched } : {}),
  };
}
