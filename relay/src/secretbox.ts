// Encryption at rest for secrets the relay must use later (botmasters' own NEAR AI keys):
// AES-256-GCM with a random 96-bit IV per secret, the 128-bit tag, and additional data that binds each
// ciphertext to its owner, so a stored box cannot be moved to another botmaster's row. The key comes
// from env RELAY_ENCRYPTION_KEY (32 bytes as 64 hex or base64; e.g. `openssl rand -hex 32`); without it the
// relay refuses to store such secrets at all.
import crypto from 'node:crypto';

export interface SealedBox {
  v: 1;
  alg: 'aes-256-gcm';
  /** first 8 hex of sha256(encryption key): which key sealed it, so a changed key is detected, not guessed */
  kid: string;
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  ct: string; // base64
}

/** RELAY_ENCRYPTION_KEY as 32 key bytes; undefined when unset. Throws when set but malformed. */
export function parseEncryptionKey(raw: string | undefined): Buffer | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === 32) return b;
  }
  throw new Error('RELAY_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or base64 (openssl rand -hex 32)');
}

export const keyIdOf = (key: Buffer): string => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

export function seal(key: Buffer, plaintext: string, aad: string): SealedBox {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { v: 1, alg: 'aes-256-gcm', kid: keyIdOf(key), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** Decrypt and authenticate; throws when the key, the additional data or any byte of the box is wrong. */
export function open(key: Buffer, box: SealedBox, aad: string): string {
  if (!box || box.v !== 1 || box.alg !== 'aes-256-gcm') throw new Error('unknown box format');
  if (box.kid !== keyIdOf(key)) throw new Error('sealed with a different RELAY_ENCRYPTION_KEY');
  const iv = Buffer.from(box.iv, 'base64');
  const tag = Buffer.from(box.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('malformed box');
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8');
}
