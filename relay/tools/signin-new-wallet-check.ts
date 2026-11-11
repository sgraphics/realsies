// A live check of the sign-in of a wallet that is brand new: a random ed25519 key whose implicit account (the key's
// own 64 hex) nobody has sent NEAR to, so it is not on chain. The relay must let it in by its signature (and still
// refuse the same key claiming someone else's account), give it a session, and answer the wallet view with zeros.
// Nothing is sent to the chain; the key lives only in this process. The session is signed out at the end.
//
//   RELAY_URL=https://testnet.realsies.lol npx tsx tools/signin-new-wallet-check.ts
import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { AuthChallenge, AuthSession } from '../../shared/protocol.js';
import { formatEd25519PublicKey, implicitAccountOf, signNep413 } from '../src/auth/nep413.js';

const base = (process.env.RELAY_URL ?? '').replace(/\/$/, '');
if (!base) {
  console.error('set RELAY_URL, e.g. https://testnet.realsies.lol');
  process.exit(2);
}
let failed = false;
function ok(cond: unknown, what: string): void {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failed = true;
}
async function api(method: string, p: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: r.status, body: json };
}
async function proof(accountId: string, secret: Uint8Array, publicKey: string) {
  const ch = (await api('POST', '/api/auth/challenge', {})).body as AuthChallenge;
  const nonce = new Uint8Array(Buffer.from(ch.nonce, 'base64'));
  return { accountId, publicKey, signature: signNep413({ message: ch.message, nonce, recipient: ch.recipient }, secret), nonce: ch.nonce };
}

const secret = ed25519.utils.randomSecretKey();
const publicKey = formatEd25519PublicKey(ed25519.getPublicKey(secret));
const account = implicitAccountOf(publicKey);
console.log(`${base}: a new wallet, ${account.slice(0, 12)}… (not on chain)`);

const stranger = crypto.randomBytes(32).toString('hex');
const wrong = await api('POST', '/api/auth/verify', await proof(stranger, secret, publicKey));
ok(wrong.status === 403 && wrong.body?.code === 'key_not_found', `the key claiming another key's account is refused (${wrong.status} ${wrong.body?.code})`);
const named = await api('POST', '/api/auth/verify', await proof(`nobody-${stranger.slice(0, 12)}.near`, secret, publicKey));
ok(named.status === 403 && named.body?.code === 'key_not_found', `the key claiming a named account that does not exist is refused (${named.status} ${named.body?.code})`);

const v = await api('POST', '/api/auth/verify', await proof(account, secret, publicKey));
const s = v.body as AuthSession;
ok(v.status === 200 && s?.accountId === account && typeof s?.token === 'string', `its own implicit account signs in (${v.status}${v.body?.code ? ' ' + v.body.code : ''})`);
if (v.status === 200) {
  const wi = await api('GET', '/api/session/wallet', undefined, s.token);
  ok(wi.status === 200, `GET /api/session/wallet answers for an account that is not on chain (${wi.status})`);
  if (wi.status === 200) console.log(`      ${JSON.stringify(wi.body).slice(0, 260)}`);
  const t = await api('POST', '/api/session/ticket', {}, s.token);
  ok(t.status === 200, `a WebSocket ticket is issued (${t.status})`);
  const me = await api('GET', '/api/session', undefined, s.token);
  ok(me.status === 200 && me.body?.accountId === account && !!me.body?.me, `GET /api/session: the player's own view (${me.status})`);
  const out = await api('DELETE', '/api/session', undefined, s.token);
  ok(out.status === 200, `signed out (${out.status})`);
  const gone = await api('GET', '/api/session', undefined, s.token);
  ok(gone.status === 401, `the session is gone (${gone.status})`);
}
console.log(failed ? 'CHECK FAILED' : 'all good');
process.exit(failed ? 1 : 0);
