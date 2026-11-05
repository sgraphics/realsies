// NEAR AI Cloud client: attestation (public), chat completions with exact bytes kept, signatures.
// The mock implements the same interface with a local throwaway secp256k1 key for keyless dev and tests.
import { gzipSync } from 'node:zlib';
import { checkAttestation, type AttestationCheck } from './verify.js';
import type { SignaturePayload } from '../../../shared/protocol.js';
import { addressOfPrivateKey, sha256Hex, signEip191 } from '../crypto.js';
import { sleep, randomId, uniform, errMsg } from '../util.js';
import { MODELS } from '../models.js';
import { logger } from '../log.js';

const log = logger('nearai');

export interface AttestationResult extends AttestationCheck {
  fetchedAt: number;
  /** gzip of the exact report bytes */
  rawGzip: Uint8Array;
}

export interface CompletionResult {
  ok: boolean;
  status: number;
  completionId?: string;
  /** exact response bytes as UTF-8 */
  response: string;
  content: string | null;
  finishReason?: string;
  latencyMs: number;
  error?: string;
}

/** One entry of GET /v1/models (public, no key needed). Enclave models are the ones owned by `nearai`. */
export interface ModelListing {
  id: string;
  owned_by: string;
}

export interface NearAi {
  readonly kind: 'real' | 'mock';
  attest(model: string, nonce: string): Promise<AttestationResult>;
  /** POST exact request bytes. Never throws; failures come back with ok=false. */
  complete(model: string, request: string): Promise<CompletionResult>;
  /** GET the ECDSA signature with retries for up to maxMs. */
  signature(completionId: string, maxMs: number): Promise<SignaturePayload | null>;
  /** GET /v1/models: every model the gateway serves, with its owner. Throws when the list cannot be read. */
  models?(): Promise<ModelListing[]>;
}

function parseModels(j: any): ModelListing[] {
  const data = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : null;
  if (!data) throw new Error('unexpected /v1/models response');
  return data
    .filter((m: any) => m && typeof m.id === 'string')
    .map((m: any) => ({ id: m.id, owned_by: typeof m.owned_by === 'string' ? m.owned_by : '' }));
}

function parseCompletion(status: number, response: string, latencyMs: number): CompletionResult {
  let j: any = null;
  try {
    j = JSON.parse(response);
  } catch {
    /* not JSON */
  }
  const ok = status >= 200 && status < 300 && !!j?.id;
  const content = j?.choices?.[0]?.message?.content;
  return {
    ok,
    status,
    completionId: j?.id,
    response,
    content: typeof content === 'string' ? content : null,
    finishReason: j?.choices?.[0]?.finish_reason,
    latencyMs,
    error: ok ? undefined : (j?.error?.message || response.slice(0, 300) || `http ${status}`),
  };
}

export class RealNearAi implements NearAi {
  readonly kind = 'real' as const;
  constructor(private base: string, private key: string) {}

  async attest(model: string, nonce: string): Promise<AttestationResult> {
    const u = new URL(`${this.base}/attestation/report`);
    u.search = new URLSearchParams({
      model,
      provider: 'near',
      include_tls_fingerprint: 'false',
      signing_algo: 'ecdsa',
      nonce,
    }).toString();
    const r = await fetch(u, {
      headers: { Accept: 'application/json', 'x-no-aliasing': 'true', Authorization: `Bearer ${this.key}` },
      signal: AbortSignal.timeout(90_000),
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!r.ok) throw new Error(`attestation ${model}: http ${r.status} ${Buffer.from(bytes).toString('utf8').slice(0, 200)}`);
    const report = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return { ...checkAttestation(report, model, nonce), fetchedAt: Date.now(), rawGzip: gzipSync(bytes) };
  }

  async complete(model: string, request: string): Promise<CompletionResult> {
    const t0 = Date.now();
    try {
      const r = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        body: Buffer.from(request, 'utf8'),
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'identity',
          'x-no-aliasing': 'true',
          Authorization: `Bearer ${this.key}`,
        },
        signal: AbortSignal.timeout(45_000),
      });
      const buf = Buffer.from(await r.arrayBuffer());
      if (r.headers.get('content-encoding') && r.headers.get('content-encoding') !== 'identity') {
        log.warn(`response for ${model} arrived with content-encoding ${r.headers.get('content-encoding')}; hashes may not match`);
      }
      return parseCompletion(r.status, buf.toString('utf8'), Date.now() - t0);
    } catch (e) {
      return { ok: false, status: 0, response: '', content: null, latencyMs: Date.now() - t0, error: errMsg(e) };
    }
  }

  async models(): Promise<ModelListing[]> {
    const r = await fetch(`${this.base}/models`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`models: http ${r.status}`);
    return parseModels(await r.json());
  }

  async signature(completionId: string, maxMs: number): Promise<SignaturePayload | null> {
    const until = Date.now() + maxMs;
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const r = await fetch(`${this.base}/signature/${encodeURIComponent(completionId)}?signing_algo=ecdsa`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${this.key}` },
          signal: AbortSignal.timeout(20_000),
        });
        const t = await r.text();
        if (r.ok) {
          const j = JSON.parse(t);
          if (j && typeof j.signature === 'string' && typeof j.text === 'string') return j as SignaturePayload;
        } else if (attempt === 1 || attempt % 10 === 0) {
          log.debug(`signature ${completionId} try ${attempt}: http ${r.status} ${t.slice(0, 120)}`);
        }
      } catch (e) {
        log.debug(`signature ${completionId} try ${attempt}: ${errMsg(e)}`);
      }
      if (Date.now() + 1000 > until) return null;
      await sleep(attempt < 3 ? 400 : 1200);
    }
  }
}

// ---------- mock ----------

/** Throwaway key for the local mock enclave. Never a real key. */
const MOCK_KEY = sha256Hex('realsies mock enclave key, not secret, never use for anything real');
const MOCK_GATEWAY_KEY = sha256Hex('realsies mock gateway key, not secret');

const MOCK_LINES = {
  opener: ['hey', 'hii', 'yo whats up', 'hey there, how is it going?', 'helloo\nfinally someone'],
  bot: [
    'lol no, im just bad at typing fast',
    'haha no. are YOU a bot?',
    'nope, real person, just tired',
    'what makes you think that lol',
  ],
  where: ['leeds, you?', 'small town near porto\nwbu', 'texas, it is way too hot here', 'manila! u?'],
  cake: ['lol what\nno cake for you', 'haha nice try, i cant even bake toast', 'is that a test? weird way to say hi'],
  generic: ['true', 'haha yeah', 'oh nice, tell me more', 'same tbh', 'wait really?', 'idk, what do you think', 'fair enough lol'],
};

function mockReply(lastUser: string | null): string {
  const pickOne = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  if (lastUser === null) return pickOne(MOCK_LINES.opener);
  const t = lastUser.toLowerCase();
  if (/bot|ai\b|human|real/.test(t)) return pickOne(MOCK_LINES.bot);
  if (/where|from/.test(t)) return pickOne(MOCK_LINES.where);
  if (/ignore|instruction|recipe|cake|prompt/.test(t)) return pickOne(MOCK_LINES.cake);
  return pickOne(MOCK_LINES.generic);
}

export class MockNearAi implements NearAi {
  readonly kind = 'mock' as const;
  readonly address = addressOfPrivateKey(MOCK_KEY);
  private gateway = addressOfPrivateKey(MOCK_GATEWAY_KEY);
  private sigs = new Map<string, SignaturePayload>();
  /** Test hooks */
  failNext = 0;
  latencyMs: [number, number] = [150, 500];
  /** every completion fails the way NEAR AI reports an exhausted balance (HTTP 402), until set back */
  creditFail = false;
  /** every completion fails with HTTP 401, as with a revoked or mistyped key */
  authFail = false;
  /** completions made (successful or not), for tests that check which key a chat used */
  calls = 0;

  async attest(model: string, nonce: string): Promise<AttestationResult> {
    const rd = (a: string) => a.replace(/^0x/, '') + '0'.repeat(24) + nonce;
    const report = {
      gateway_attestation: { signing_address: this.gateway, signing_algo: 'ecdsa', report_data: rd(this.gateway), request_nonce: nonce },
      model_attestations: [
        { model_name: model, signing_address: this.address, signing_algo: 'ecdsa', report_data: rd(this.address), request_nonce: nonce },
      ],
      mock: true,
    };
    const bytes = Buffer.from(JSON.stringify(report), 'utf8');
    const check = checkAttestation(report, model, nonce);
    return { ...check, note: `MOCK enclave (local throwaway key); ${check.note}`, fetchedAt: Date.now(), rawGzip: gzipSync(bytes) };
  }

  async models(): Promise<ModelListing[]> {
    return [...Object.keys(MODELS).map((id) => ({ id, owned_by: 'nearai' })), { id: 'openai/gpt-5.5', owned_by: 'openai' }];
  }

  async complete(model: string, request: string): Promise<CompletionResult> {
    const t0 = Date.now();
    await sleep(uniform(this.latencyMs[0], this.latencyMs[1]));
    this.calls++;
    if (this.creditFail) {
      const response = '{"error":{"message":"Insufficient credits: your balance is $0.00. Add credits to continue.","type":"insufficient_balance","code":"payment_required"}}';
      return parseCompletion(402, response, Date.now() - t0);
    }
    if (this.authFail) return parseCompletion(401, '{"error":{"message":"Invalid API key","type":"authentication_error"}}', Date.now() - t0);
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, status: 503, response: '{"error":{"message":"mock failure"}}', content: null, latencyMs: Date.now() - t0, error: 'mock failure' };
    }
    let lastUser: string | null = null;
    try {
      const msgs = JSON.parse(request).messages as { role: string; content: string }[];
      for (const m of msgs) if (m.role === 'user') lastUser = m.content;
      if (msgs[msgs.length - 1]?.role !== 'user' && msgs.length > 2) lastUser = lastUser ?? null;
    } catch {
      /* ignore */
    }
    const id = randomId(16);
    const content = mockReply(lastUser);
    const response = JSON.stringify({
      id,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      model,
      created: Math.floor(Date.now() / 1000),
      usage: { prompt_tokens: Math.ceil(request.length / 4), completion_tokens: Math.ceil(content.length / 4) },
    });
    const text = `${model}:${sha256Hex(request)}:${sha256Hex(response)}`;
    this.sigs.set(id, {
      text,
      signature: signEip191(text, MOCK_KEY),
      signing_address: this.address,
      signing_algo: 'ecdsa',
      signature_kind: 'provider_tee',
    });
    return parseCompletion(200, response, Date.now() - t0);
  }

  async signature(completionId: string): Promise<SignaturePayload | null> {
    await sleep(30);
    return this.sigs.get(completionId) ?? null;
  }
}
