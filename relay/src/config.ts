// Relay configuration from env (with the repo-root .env read first), per docs/spec.md section 4.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findRelayRoot(): string {
  // Works from src/ (tsx) and from dist/ (bundled): walk up to the folder holding personas/.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'personas')) && fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export const RELAY_ROOT = findRelayRoot();
export const REPO_ROOT = path.resolve(RELAY_ROOT, '..');

/** Minimal .env parser: KEY=VALUE lines, optional quotes, # comments. Does not override set vars. */
export function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export interface Config {
  port: number;
  testMode: boolean;
  roundMinutes: number;
  chatSeconds: number;
  callSeconds: number;
  /** full-screen 3-2-1 before every chat: chat_started carries startedAt = now + this; say is refused until then */
  countdownSeconds: number;
  /**
   * demo bot characters per round, over the three levels: each one's country from the Western mix
   * (src/persona/data.ts COUNTRY_WEIGHTS), played by a hand-written persona of that country or a person
   * generated from the round's seed (src/persona/cast.ts); 0 = the personas folder as is, nobody generated
   */
  castSize: number;
  /** hand-written persona ids forced into every cast (tests and smoke runs) */
  castPins: string[];
  freeChatsPerDay: number;
  nearAiKey?: string;
  nearAiBase: string;
  /** 'auto': real NEAR AI when a key is set, else the local mock signer. */
  nearAi: 'auto' | 'real' | 'mock';
  secretsPath: string;
  dbPath: string;
  skinSecret?: string;
  usdPerCoin: number;
  /** 'auto': the NEAR adapter when the secrets file exists, else the in-memory mock chain. */
  chain: 'auto' | 'near' | 'mock';
  webDist: string;
  personasDir: string;
  /** botmaster registrations for remote brains (relay/botmasters/*.json) */
  botmastersDir: string;
  /** a remote brain silent this long (seconds of brain time) is replaced by the default brain */
  remoteSilenceSeconds: number;
  /** serve /api/dev/bot-trace before the round settles (tests only: a trace names the persona) */
  devTraces: boolean;
  /** prune_round a settled round this long after its results are stored (0 = at once) */
  pruneDelaySeconds: number;
  /** no human connected for this long: no new rounds until one connects (0 = never idle) */
  idleMinutes: number;
  /** Multiplies every bot delay (opener, debounce, typing). 1 in production; tests use less. */
  botTimeScale: number;
  /** Search delay range in seconds, [2.5, 6] per spec. */
  searchDelay: [number, number];
  /** Seconds a human may be disconnected before the chat ends with partner_left. */
  partnerLeftSeconds: number;
  /** Seconds of call window when the round is force-ended in test mode. */
  devCallSeconds: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  // ---------- AI builders (docs/agents.md) ----------
  /** Bearer token of the admin endpoints (/api/admin/*); unset (or shorter than 16 characters) = admin endpoints off */
  adminToken?: string;
  /** 32 bytes (64 hex or base64) sealing botmasters' own NEAR AI keys with AES-256-GCM; unset = BYOK refused */
  encryptionKey?: string;
  /** POSTed (JSON, with Slack and Discord friendly text) for every new access request */
  agentRequestWebhook?: string;
  /** Resend API key for operator emails (src/agents/notify.ts): new access requests, personas to review */
  resendApiKey?: string;
  /** where those emails go; both this and resendApiKey must be set */
  notifyEmail?: string;
  /** sender; default Realsies <onboarding@resend.dev>, which reaches only the Resend account's own address */
  notifyFrom?: string;
  /** access requests stored per IP per hour */
  agentRequestsPerHour: number;
  // ---------- NEAR AI credits ----------
  /** house key budget in USD: crossing 80% of the estimated spend warns in the log (health: low_credit) */
  nearAiBudgetUsd: number;
  /** a key marked out of credits is retried with a one-token completion this often */
  nearAiRecheckSeconds: number;
  // ---------- wallet sign-in (protocol v1.3) ----------
  /** NEP-413 recipient every sign-in message must name (the site's domain) */
  authRecipient: string;
  /** a session lives this long after sign-in */
  sessionDays: number;
  /** "Buy REAL" link: the meme.cooking page before the launch finalizes, the Rhea swap after; unset = no link */
  buyUrl?: string;
  /** gas allowance of the play key a browser asks its wallet to add, in NEAR */
  playKeyAllowanceNear: number;
  /**
   * prepaid gas of each player-signed play and call, in Tgas. Only burnt gas is charged, to the account and to the
   * key's allowance (measured on testnet: a play burns about 3 Tgas, a call 2.5), so headroom costs nothing
   */
  playGasTgas: number;
  /** seconds a browser has to sign a play or call before the play goes free (or the call is not on chain) */
  signTimeoutSeconds: number;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${v}`);
  return n;
}

function resolveFromRepo(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadDotEnv(path.join(REPO_ROOT, '.env'));
  loadDotEnv(path.join(RELAY_ROOT, '.env'));
  const env = process.env;
  const cfg: Config = {
    port: num('PORT', 3960),
    testMode: (env.TEST_MODE ?? '1') !== '0',
    roundMinutes: num('ROUND_MINUTES', 10),
    chatSeconds: num('CHAT_SECONDS', 120),
    callSeconds: num('CALL_SECONDS', 20),
    countdownSeconds: num('COUNTDOWN_SECONDS', 3),
    castSize: num('CAST_SIZE', 39),
    castPins: (env.CAST_PINS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    freeChatsPerDay: num('FREE_CHATS_PER_DAY', 0),
    nearAiKey: env.NEAR_AI_API_KEY || undefined,
    nearAiBase: (env.NEAR_AI_BASE || 'https://cloud-api.near.ai/v1').replace(/\/+$/, ''),
    nearAi: (env.NEAR_AI as Config['nearAi']) || 'auto',
    secretsPath: resolveFromRepo(env.SECRETS || 'relay/.secrets/testnet.json'),
    dbPath: resolveFromRepo(env.DB || 'relay/data/realsies.db'),
    skinSecret: env.SKIN_SECRET || undefined,
    usdPerCoin: num('USD_PER_COIN', 0.01),
    chain: (env.CHAIN as Config['chain']) || 'auto',
    webDist: resolveFromRepo(env.WEB_DIST || 'web/dist'),
    personasDir: resolveFromRepo(env.PERSONAS || 'relay/personas'),
    botmastersDir: resolveFromRepo(env.BOTMASTERS || 'relay/botmasters'),
    remoteSilenceSeconds: num('REMOTE_SILENCE_SECONDS', 20),
    devTraces: env.DEV_TRACES === '1',
    pruneDelaySeconds: num('PRUNE_DELAY_SECONDS', 300),
    idleMinutes: num('IDLE_MINUTES', 10),
    botTimeScale: num('BOT_TIME_SCALE', 1),
    searchDelay: [num('SEARCH_MIN_SECONDS', 2.5), num('SEARCH_MAX_SECONDS', 6)],
    partnerLeftSeconds: num('PARTNER_LEFT_SECONDS', 15),
    devCallSeconds: num('DEV_CALL_SECONDS', 10),
    logLevel: (env.LOG_LEVEL as Config['logLevel']) || 'info',
    adminToken: env.ADMIN_TOKEN || undefined,
    encryptionKey: env.RELAY_ENCRYPTION_KEY || undefined,
    agentRequestWebhook: env.AGENT_REQUEST_WEBHOOK || undefined,
    resendApiKey: env.RESEND_API_KEY || undefined,
    notifyEmail: env.AGENT_NOTIFY_EMAIL || undefined,
    notifyFrom: env.AGENT_NOTIFY_FROM || undefined,
    agentRequestsPerHour: num('AGENT_REQUESTS_PER_HOUR', 5),
    nearAiBudgetUsd: num('NEAR_AI_BUDGET_USD', 10),
    nearAiRecheckSeconds: num('NEAR_AI_RECHECK_SECONDS', 180),
    authRecipient: (env.AUTH_RECIPIENT || 'realsies.lol').trim(),
    sessionDays: num('SESSION_DAYS', 30),
    buyUrl: env.BUY_URL || undefined,
    playKeyAllowanceNear: num('PLAY_KEY_ALLOWANCE_NEAR', 0.25),
    playGasTgas: num('PLAY_GAS_TGAS', 30),
    signTimeoutSeconds: num('SIGN_TIMEOUT_SECONDS', 20),
    ...overrides,
  };
  if (!['auto', 'near', 'mock'].includes(cfg.chain)) throw new Error(`CHAIN must be auto, near or mock`);
  if (!['auto', 'real', 'mock'].includes(cfg.nearAi)) throw new Error(`NEAR_AI must be auto, real or mock`);
  if (!(cfg.countdownSeconds >= 0 && cfg.countdownSeconds <= 30)) throw new Error('COUNTDOWN_SECONDS must be from 0 to 30');
  if (!(Number.isInteger(cfg.castSize) && cfg.castSize >= 0 && cfg.castSize <= 60)) throw new Error('CAST_SIZE must be a whole number from 0 to 60');
  if (cfg.agentRequestWebhook && !/^https?:\/\//.test(cfg.agentRequestWebhook)) throw new Error('AGENT_REQUEST_WEBHOOK must be an http or https URL');
  if (cfg.notifyEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.notifyEmail)) throw new Error('AGENT_NOTIFY_EMAIL must be an email address');
  if (!(cfg.nearAiBudgetUsd >= 0)) throw new Error('NEAR_AI_BUDGET_USD must be 0 or more');
  if (!(cfg.nearAiRecheckSeconds > 0)) throw new Error('NEAR_AI_RECHECK_SECONDS must be more than 0');
  if (!/^[a-z0-9.-]{3,100}$/i.test(cfg.authRecipient)) throw new Error('AUTH_RECIPIENT must be a domain such as realsies.lol');
  if (!(cfg.sessionDays > 0 && cfg.sessionDays <= 365)) throw new Error('SESSION_DAYS must be from 1 to 365');
  if (cfg.buyUrl && !/^https:\/\//.test(cfg.buyUrl)) throw new Error('BUY_URL must be an https URL');
  if (!(cfg.playKeyAllowanceNear > 0 && cfg.playKeyAllowanceNear <= 5)) throw new Error('PLAY_KEY_ALLOWANCE_NEAR must be more than 0 and at most 5');
  if (!(cfg.playGasTgas >= 5 && cfg.playGasTgas <= 100)) throw new Error('PLAY_GAS_TGAS must be from 5 to 100');
  if (!(cfg.signTimeoutSeconds >= 3 && cfg.signTimeoutSeconds <= 120)) throw new Error('SIGN_TIMEOUT_SECONDS must be from 3 to 120');
  return cfg;
}
