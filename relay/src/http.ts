// Small HTTP helpers shared by the game routes (src/server.ts) and the AI builders API (src/agents/api.ts).
import type http from 'node:http';
import { GameError } from './game/game.js';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(s);
}

/** The JSON body of a request (at most 64 KB); {} when empty. */
export async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new GameError('body_too_large', 'request body too large', 413);
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  const t = Buffer.concat(chunks).toString('utf8').trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    throw new GameError('bad_json', 'body must be JSON');
  }
}

/** `Authorization: Bearer <token>`, trimmed, or undefined. */
export function bearerToken(req: http.IncomingMessage): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''));
  const t = m?.[1]?.trim();
  return t ? t : undefined;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The client's IP. Forwarded headers are trusted only when the TCP peer is a local proxy (nginx on the
 * same host, which sits behind Cloudflare): CF-Connecting-IP, then X-Real-IP, then the first X-Forwarded-For.
 */
export function clientIp(req: http.IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? '';
  if (!LOOPBACK.has(peer)) return peer || 'unknown';
  const h = (k: string) => {
    const v = req.headers[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  return h('cf-connecting-ip') ?? h('x-real-ip') ?? h('x-forwarded-for')?.split(',')[0]?.trim() ?? peer;
}
