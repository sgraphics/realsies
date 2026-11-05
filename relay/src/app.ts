// Wiring: config, DB, chain adapter, NEAR AI client and its credit monitor, personas, botmasters (files and
// DB), the AI builders API, game engine, HTTP and WebSocket server.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig, type Config } from './config.js';
import { Db } from './db.js';
import type { ChainAdapter } from './chain/types.js';
import { MockChain } from './chain/mock.js';
import { NearChain, readSecrets } from './chain/near.js';
import { MockNearAi, RealNearAi, type ModelListing, type NearAi } from './nearai/client.js';
import { CreditMonitor, TrackedAi, backfillSpend } from './nearai/credits.js';
import { MODELS } from './models.js';
import { loadPersonas } from './personas.js';
import { BotmasterHub, CompositeBotmasters, StaticBotmasters, loadBotmasters } from './bot/remote.js';
import { AgentStore, DbBotmasters } from './agents/store.js';
import { ByokKeys } from './agents/byok.js';
import { createAgentApi } from './agents/api.js';
import type { AdminContext } from './agents/admin.js';
import { parseEncryptionKey } from './secretbox.js';
import { Game } from './game/game.js';
import { AuthService } from './auth/service.js';
import { createServer } from './server.js';
import { errMsg } from './util.js';
import { logger, setLogLevel } from './log.js';

const log = logger('app');

export async function createChain(cfg: Config, db: Db): Promise<ChainAdapter> {
  const useNear = cfg.chain === 'near' || (cfg.chain === 'auto' && fs.existsSync(cfg.secretsPath));
  if (useNear) {
    // TEST_MODE=0: the secrets file's test users are ignored (players are wallet accounts)
    const chain = new NearChain(readSecrets(cfg.secretsPath), { withTestUsers: cfg.testMode });
    chain.onTx = (t) => db.logTx({ at: Date.now(), roundId: null, kind: t.method, signer: t.signer, hash: t.hash, ok: t.ok, error: t.error ?? null, ms: t.ms });
    await chain.init();
    return chain;
  }
  const chain = new MockChain();
  const snap = db.getKv('mockchain');
  if (snap) chain.restore(snap);
  // local development with a real wallet in the browser: the mock has never seen its keys, so trust them
  if (process.env.MOCK_WALLETS === '1') {
    chain.trustUnknownKeys = true;
    log.warn('MOCK_WALLETS=1: the mock chain trusts any key a wallet signs with (local development only)');
  }
  let pending: NodeJS.Timeout | null = null;
  chain.onChange = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      db.setKv('mockchain', chain.snapshot());
    }, 200);
  };
  log.warn('using the in-memory MOCK chain (no secrets file); nothing goes on testnet');
  return chain;
}

export function createAi(cfg: Config, chain: ChainAdapter): NearAi {
  const real = cfg.nearAi === 'real' || (cfg.nearAi === 'auto' && !!cfg.nearAiKey && chain.kind === 'near');
  if (real) {
    if (!cfg.nearAiKey) throw new Error('NEAR_AI=real needs NEAR_AI_API_KEY');
    return new RealNearAi(cfg.nearAiBase, cfg.nearAiKey);
  }
  if (chain.kind === 'near') log.warn('MOCK NEAR AI signer on the real chain: bots are not real enclave models');
  else log.info('using the mock NEAR AI signer (set NEAR_AI=real to call NEAR AI Cloud)');
  return new MockNearAi();
}

/** GET /v1/models, cached for ten minutes (clients without a list accept the models the relay runs). */
function cachedModels(ai: NearAi): () => Promise<ModelListing[]> {
  let list: ModelListing[] | null = null;
  let at = 0;
  return async () => {
    if (!ai.models) return Object.keys(MODELS).map((id) => ({ id, owned_by: 'nearai' }));
    if (list && Date.now() - at < 600_000) return list;
    list = await ai.models();
    at = Date.now();
    return list;
  };
}

export interface App {
  cfg: Config;
  db: Db;
  chain: ChainAdapter;
  /** the relay's own NEAR AI client, tracked by the credit monitor */
  ai: NearAi;
  game: Game;
  port: number;
  hub: BotmasterHub;
  auth: AuthService;
  agents: AgentStore;
  credits: CreditMonitor;
  byok: ByokKeys;
  close(): Promise<void>;
}

export interface AppDeps {
  chain?: ChainAdapter;
  ai?: NearAi;
  /** the raw NEAR AI client for a botmaster's own key (tests pass mocks; default: the real gateway when the relay's is real) */
  aiForKey?: (key: string) => NearAi;
}

export async function createApp(overrides: Partial<Config> = {}, deps: AppDeps = {}): Promise<App> {
  const cfg = loadConfig(overrides);
  setLogLevel(cfg.logLevel);
  const db = new Db(cfg.dbPath);
  const chain = deps.chain ?? (await createChain(cfg, db));
  const rawAi = deps.ai ?? createAi(cfg, chain);

  // NEAR AI spend and credits per key; the house key is the relay's own
  const credits = new CreditMonitor(db, { budgetUsd: cfg.nearAiBudgetUsd, recheckMs: cfg.nearAiRecheckSeconds * 1000 });
  const tracked = !!db.getKv('ai_credit:house');
  const houseFp = rawAi.kind === 'real' && cfg.nearAiKey ? crypto.createHash('sha256').update(cfg.nearAiKey, 'utf8').digest('hex').slice(0, 12) : rawAi.kind;
  credits.bind('house', houseFp);
  if (!tracked && rawAi.kind === 'real' && !db.getKv('ai_credit_backfilled')) {
    const b = backfillSpend(db);
    credits.addSpend('house', b.usd, b.calls);
    db.setKv('ai_credit_backfilled', String(Date.now()));
    log.info(`NEAR AI spend tracking starts at $${b.usd.toFixed(4)} (${b.calls} stored completions)`);
  }
  const ai = new TrackedAi(rawAi, 'house', credits);

  const agents = new AgentStore(db);
  let encKey: Buffer | undefined;
  try {
    encKey = parseEncryptionKey(cfg.encryptionKey);
  } catch (e) {
    log.error(`${errMsg(e)}; botmasters cannot store their own NEAR AI keys`);
  }
  if (!encKey && agents.countKeys() > 0) log.error(`${agents.countKeys()} stored botmaster NEAR AI key(s) but no usable RELAY_ENCRYPTION_KEY: their personas are not matched`);
  const aiForKey = deps.aiForKey ?? ((key: string) => (rawAi.kind === 'real' ? new RealNearAi(cfg.nearAiBase, key) : new MockNearAi()));
  const byok = new ByokKeys(agents, encKey, aiForKey, credits);
  credits.clientFor = (keyId) => (keyId === 'house' ? rawAi : keyId.startsWith('byok:') ? byok.raw(keyId.slice(5)) : undefined);
  credits.start();

  const personas = loadPersonas(cfg.personasDir);
  if (process.env.GEN_PERSONAS !== undefined) log.warn('GEN_PERSONAS is no longer used; CAST_SIZE sets the demo characters per round (default 39)');
  const fileBotmasters = loadBotmasters(cfg.botmastersDir);
  for (const b of fileBotmasters) if (agents.getBotmaster(b.name)) log.warn(`botmaster ${b.name} is in relay/botmasters and in the DB; the file wins`);
  const hub = new BotmasterHub(new CompositeBotmasters([new StaticBotmasters(fileBotmasters), new DbBotmasters(agents)]), cfg.remoteSilenceSeconds * 1000);
  for (const p of personas) {
    if (p.brain.kind !== 'remote') continue;
    const bm = hub.get(p.brain.botmaster);
    if (!bm || !bm.personas.includes(p.id)) {
      log.warn(`persona ${p.id} names botmaster ${p.brain.botmaster}, which ${bm ? 'does not list it' : 'is not registered'}; it plays with the default brain`);
    }
  }
  const auth = new AuthService(db, chain, { recipient: cfg.authRecipient, sessionDays: cfg.sessionDays, contractId: chain.contractId });
  const game = new Game(cfg, db, chain, ai, personas, hub, { agents, credits, byok, auth });
  await game.start();
  const admin: AdminContext = { store: agents, fileBotmasters: () => fileBotmasters.map((b) => b.name), kick: (n, c, m) => hub.kick(n, c, m) };
  const agentApi = createAgentApi({ cfg, store: agents, game, hub, credits, byok, admin, models: cachedModels(ai) });
  const srv = createServer(game, { webDist: cfg.webDist, testMode: cfg.testMode, hub, agents: agentApi, auth });
  const port = await srv.listen(cfg.port);
  log.info(
    `relay on http://localhost:${port} (chain ${chain.kind} ${chain.contractId}, ai ${ai.kind}, ${personas.length} personas, ` +
      `${hub.botmasters.length} botmasters, ${game.agentPersonas().length} AI builder personas, admin ${cfg.adminToken && cfg.adminToken.length >= 16 ? 'on' : 'off'}, ` +
      `own keys ${encKey ? 'on' : 'off'}, test mode ${cfg.testMode}, wallet sign-in for ${cfg.authRecipient}, ` +
      `${game.chainCfg.coinsOpen ? 'coins open' : 'no coin yet: free play only'})`,
  );
  return {
    cfg, db, chain, ai, game, port, hub, agents, credits, byok, auth,
    async close() {
      await game.stop();
      hub.close();
      await srv.close();
      credits.stop();
      auth.close();
      db.close();
    },
  };
}
