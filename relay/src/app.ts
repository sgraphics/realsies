// Wiring: config, DB, chain adapter, NEAR AI client, personas, game engine, HTTP and WebSocket server.
import fs from 'node:fs';
import { loadConfig, type Config } from './config.js';
import { Db } from './db.js';
import type { ChainAdapter } from './chain/types.js';
import { MockChain } from './chain/mock.js';
import { NearChain, readSecrets } from './chain/near.js';
import { MockNearAi, RealNearAi, type NearAi } from './nearai/client.js';
import { loadPersonas } from './personas.js';
import { Game } from './game/game.js';
import { createServer } from './server.js';
import { logger, setLogLevel } from './log.js';

const log = logger('app');

export async function createChain(cfg: Config, db: Db): Promise<ChainAdapter> {
  const useNear = cfg.chain === 'near' || (cfg.chain === 'auto' && fs.existsSync(cfg.secretsPath));
  if (useNear) {
    const chain = new NearChain(readSecrets(cfg.secretsPath));
    chain.onTx = (t) => db.logTx({ at: Date.now(), roundId: null, kind: t.method, signer: t.signer, hash: t.hash, ok: t.ok, error: t.error ?? null, ms: t.ms });
    await chain.init();
    return chain;
  }
  const chain = new MockChain();
  const snap = db.getKv('mockchain');
  if (snap) chain.restore(snap);
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

export interface App {
  cfg: Config;
  db: Db;
  chain: ChainAdapter;
  ai: NearAi;
  game: Game;
  port: number;
  close(): Promise<void>;
}

export async function createApp(overrides: Partial<Config> = {}, deps: { chain?: ChainAdapter; ai?: NearAi } = {}): Promise<App> {
  const cfg = loadConfig(overrides);
  setLogLevel(cfg.logLevel);
  const db = new Db(cfg.dbPath);
  const chain = deps.chain ?? (await createChain(cfg, db));
  const ai = deps.ai ?? createAi(cfg, chain);
  const personas = loadPersonas(cfg.personasDir);
  const game = new Game(cfg, db, chain, ai, personas);
  await game.start();
  const srv = createServer(game, { webDist: cfg.webDist, testMode: cfg.testMode });
  const port = await srv.listen(cfg.port);
  log.info(`relay on http://localhost:${port} (chain ${chain.kind} ${chain.contractId}, ai ${ai.kind}, ${personas.length} personas, test mode ${cfg.testMode})`);
  return {
    cfg, db, chain, ai, game, port,
    async close() {
      await game.stop();
      await srv.close();
      db.close();
    },
  };
}
