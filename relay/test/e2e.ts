// Headless E2E against the real relay on NEAR testnet (spec section 4 "Tests").
// Uses the relay at RELAY_URL (default http://localhost:3960); if none answers, spawns one
// (CHAIN=near, real NEAR AI) and stops it at the end. Chain views are read directly from testnet.
// Every chat opens with the relay's countdown (PublicConfig.countdownSeconds): the scenario checks that a
// say during it is refused and waits it out (counted from receipt, so clock skew does not matter) before
// anyone writes; after settlement it checks the bot chats' persona cards in results and the bundle.
//
//   npm run e2e                      # spawn or reuse a relay, run the scenario
//   RELAY_URL=http://host:3960 npm run e2e
//   E2E_USERS=dex,eve,finn npm run e2e
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NearChain, readSecrets } from '../src/chain/near.js';
import { runScenario } from './scenario.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const relayRoot = path.resolve(here, '..');
const base = (process.env.RELAY_URL ?? 'http://localhost:3960').replace(/\/+$/, '');
const secretsPath = path.resolve(relayRoot, '..', process.env.SECRETS ?? 'relay/.secrets/testnet.json');
const t0 = Date.now();
const log = (s: string) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

let child: ChildProcess | null = null;
async function ensureRelay(): Promise<void> {
  if (await reachable()) {
    log(`using the relay at ${base}`);
    return;
  }
  const logFile = path.join(relayRoot, 'data', 'e2e-relay.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile);
  log(`spawning a relay (log: ${logFile})`);
  child = spawn(process.execPath, [path.join(relayRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'], {
    cwd: relayRoot,
    env: { ...process.env, CHAIN: 'near', PORT: new URL(base).port || '3960' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  child.on('exit', (code) => log(`relay exited with ${code}`));
  for (let i = 0; i < 120; i++) {
    if (await reachable()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('relay did not come up in 120 s');
}

async function main(): Promise<void> {
  const secrets = readSecrets(secretsPath);
  const views = new NearChain(secrets);
  const names = (process.env.E2E_USERS ?? 'ana,ben,cleo').split(',').map((s) => s.trim());
  const users = names.map((n) => (n.includes('.') ? n : `${n}.realsies.testnet`)) as [string, string, string];
  await ensureRelay();
  const report = await runScenario({
    base,
    views,
    users,
    promo: secrets.promo.accountId,
    timeouts: { ready: 180_000, match: 60_000, placed: 90_000, botReply: 60_000, results: 420_000 },
    log,
  });
  const explorer = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
  log(`PASSED: ${report.checks.length} checks in round ${report.roundId}`);
  for (const [k, h] of Object.entries(report.txs)) if (h) log(`  ${k.padEnd(14)} ${explorer(h)}`);
  log(`  bot said: ${report.botMessages.map((m) => JSON.stringify(m)).join(' | ')}`);
  for (const r of Object.values(report.results)) for (const c of r.chats) if (c.persona) log(`  bot ${c.chatId} was ${c.persona.age}, ${c.persona.gender}, ${c.persona.mbti}, ${c.persona.temperament}, ${c.persona.home}, ${c.persona.job}; ${c.persona.style}`);
  const file = path.join(relayRoot, 'data', `e2e-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  log(`report: ${file}`);
}

main()
  .then(() => {
    if (child) child.kill();
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[e2e] FAILED: ${e instanceof Error ? e.stack ?? e.message : e}`);
    if (child) child.kill();
    process.exit(1);
  });
