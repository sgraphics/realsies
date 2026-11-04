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
    ...overrides,
  };
  if (!['auto', 'near', 'mock'].includes(cfg.chain)) throw new Error(`CHAIN must be auto, near or mock`);
  if (!['auto', 'real', 'mock'].includes(cfg.nearAi)) throw new Error(`NEAR_AI must be auto, real or mock`);
  return cfg;
}
