// Bring your own NEAR AI key: a botmaster may store its own key, sealed with RELAY_ENCRYPTION_KEY
// (src/secretbox.ts, AES-256-GCM, bound to the botmaster's name), and every chat of its personas then runs
// on that key, and only those chats. Without RELAY_ENCRYPTION_KEY the relay refuses to store keys. A stored
// key the relay cannot open (the encryption key changed or is gone) makes its personas unavailable rather
// than silently moving their cost to the relay's own key.
import crypto from 'node:crypto';
import type { NearAi } from '../nearai/client.js';
import { CreditMonitor, TrackedAi, cheapestModel, keyFailure, tinyRequest, type AiStatus } from '../nearai/credits.js';
import { open, seal } from '../secretbox.js';
import { errMsg } from '../util.js';
import { logger } from '../log.js';
import { ApiError } from './validate.js';
import type { AgentStore } from './store.js';

const log = logger('byok');

export const fingerprintOf = (key: string): string => crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 12);
const aadOf = (botmaster: string) => `realsies:byok:v1|${botmaster}`;

export interface ByokResult {
  byok: boolean;
  /** the key's credit state after the check */
  status?: AiStatus;
  /** a one-token completion was made with the key to check it */
  checked?: boolean;
  message?: string;
}

export class ByokKeys {
  private cache = new Map<string, { fp: string; raw: NearAi; tracked: TrackedAi }>();
  private warned = new Set<string>();

  constructor(
    private store: AgentStore,
    /** RELAY_ENCRYPTION_KEY, 32 bytes; undefined = BYOK refused */
    private encKey: Buffer | undefined,
    /** a raw NEAR AI client for a key (the real gateway, or the mock signer in tests and keyless dev) */
    private aiForKey: (key: string) => NearAi,
    private credits: CreditMonitor,
  ) {}

  get enabled(): boolean {
    return !!this.encKey;
  }

  keyIdOf(botmaster: string): string {
    return `byok:${botmaster}`;
  }

  has(botmaster: string): boolean {
    return !!this.store.getKey(botmaster);
  }

  private entry(botmaster: string): { fp: string; raw: NearAi; tracked: TrackedAi } | null | undefined {
    const rec = this.store.getKey(botmaster);
    if (!rec) {
      this.cache.delete(botmaster);
      return undefined;
    }
    const hit = this.cache.get(botmaster);
    if (hit && hit.fp === rec.fingerprint) return hit;
    if (!this.encKey) {
      if (!this.warned.has(botmaster)) log.error(`botmaster ${botmaster} has a stored NEAR AI key but RELAY_ENCRYPTION_KEY is not set; its personas are not matched`);
      this.warned.add(botmaster);
      return null;
    }
    let key: string;
    try {
      key = open(this.encKey, rec.box, aadOf(botmaster));
    } catch (e) {
      if (!this.warned.has(botmaster)) log.error(`the stored NEAR AI key of botmaster ${botmaster} cannot be opened (${errMsg(e)}); its personas are not matched`);
      this.warned.add(botmaster);
      return null;
    }
    const raw = this.aiForKey(key);
    const keyId = this.keyIdOf(botmaster);
    this.credits.bind(keyId, rec.fingerprint);
    const e = { fp: rec.fingerprint, raw, tracked: new TrackedAi(raw, keyId, this.credits) };
    this.cache.set(botmaster, e);
    this.warned.delete(botmaster);
    return e;
  }

  /** The client a botmaster's chats use: undefined = no key stored (the relay's key), null = stored but unusable. */
  client(botmaster: string): TrackedAi | null | undefined {
    const e = this.entry(botmaster);
    return e === undefined ? undefined : e === null ? null : e.tracked;
  }

  /** The raw client, for the credit monitor's one-token recheck. */
  raw(botmaster: string): NearAi | undefined {
    return this.entry(botmaster)?.raw;
  }

  /** Store (or replace) a botmaster's key after a one-token check that NEAR AI accepts it. */
  async put(botmaster: string, key: unknown): Promise<ByokResult> {
    if (!this.encKey) throw new ApiError('byok_disabled', 'this relay cannot store NEAR AI keys: RELAY_ENCRYPTION_KEY is not set', 503);
    if (typeof key !== 'string' || key.length < 16 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) {
      throw new ApiError('invalid_request', 'key must be your NEAR AI API key: 16 to 512 printable characters, no spaces', 400, 'key');
    }
    const fp = fingerprintOf(key);
    const keyId = this.keyIdOf(botmaster);
    const raw = this.aiForKey(key);
    const model = cheapestModel();
    const res = await raw.complete(model, tinyRequest(model));
    const f = res.ok ? null : keyFailure(res.status, res.response);
    if (f?.kind === 'auth') throw new ApiError('bad_key', `NEAR AI did not accept this key (${f.detail}); nothing was stored`, 400, 'key');
    this.store.saveKey({ botmaster, fingerprint: fp, box: seal(this.encKey, key, aadOf(botmaster)), createdAt: Date.now() });
    this.cache.delete(botmaster);
    this.credits.bind(keyId, fp);
    this.credits.observe(keyId, model, res);
    const status = this.credits.status(keyId);
    log.info(`botmaster ${botmaster} stored its own NEAR AI key (${f ? f.detail : res.ok ? 'checked' : `unchecked: ${res.error ?? `HTTP ${res.status}`}`})`);
    return {
      byok: true,
      status,
      checked: res.ok || !!f,
      message: status === 'out_of_credits' ? 'stored, but NEAR AI reports no credits on it: your personas are not matched until it has credits' : undefined,
    };
  }

  remove(botmaster: string): ByokResult {
    const had = this.store.deleteKey(botmaster);
    this.cache.delete(botmaster);
    this.credits.drop(this.keyIdOf(botmaster));
    if (had) log.info(`botmaster ${botmaster} removed its own NEAR AI key; its personas run on the relay's key`);
    return { byok: false };
  }
}
