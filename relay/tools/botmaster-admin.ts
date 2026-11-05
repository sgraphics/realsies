// Operator command line for AI builders (docs/agents.md), straight on the relay's DB: the same tables and
// rules as the admin HTTP API. The running relay sees every change at once: a new token works right away,
// a new or approved persona plays from the next round, and a revoked or rotated token's live /bot/ws
// connection is dropped at its next heartbeat (within 20 s). Tokens are printed once, when made.
//
//   npx tsx tools/botmaster-admin.ts <command> [args] [--db relay/data/realsies.db]
//   on the server: cd /opt/realsies/relay && sudo -u realsies npx tsx tools/botmaster-admin.ts requests
//
//   requests [--status pending|approved|rejected|all]      access requests, newest first (default pending)
//   request <id>                                           one request in full
//   approve <requestId> [--name n] [--payout acct] [--silence-ms ms]
//   reject <requestId> --reason "..."
//   botmasters                                             DB botmasters (and the names in relay/botmasters)
//   create <name> --payout acct [--contact email]          a botmaster without a request
//   revoke <name> [--reason "..."]
//   rotate <name>                                          new token (reactivates a revoked botmaster)
//   personas [--status pending|...|all] [--botmaster n]    submitted personas (default pending)
//   persona <id>                                           one persona with its full prompt
//   approve-persona <id> | reject-persona <id> --reason "..." | disable-persona <id> [--reason "..."]
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';
import { AgentStore, type PersonaStatus, type RequestStatus } from '../src/agents/store.js';
import { adminView, approveRequest, createBotmaster, decidePersona, rejectRequest, revokeBotmaster, rotateToken, type AdminContext } from '../src/agents/admin.js';
import { loadBotmasters } from '../src/bot/remote.js';
import { GameError } from '../src/game/game.js';
import { setLogLevel } from '../src/log.js';

const argv = process.argv.slice(2);
const flags = new Map<string, string>();
const pos: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(a.slice(2), next);
      i++;
    } else flags.set(a.slice(2), 'true');
  } else pos.push(a);
}
const [cmd, arg] = pos;
const flag = (k: string) => flags.get(k);
const need = (v: string | undefined, what: string): string => {
  if (!v) throw new GameError('usage', `missing ${what}`);
  return v;
};

function usage(): never {
  const head = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, ''));
  console.log(head.join('\n'));
  process.exit(cmd ? 1 : 0);
}

if (!cmd || cmd === 'help' || flags.has('help')) usage();

setLogLevel('warn');
const cfg = loadConfig();
const dbPath = flag('db') ? path.resolve(flag('db')!) : cfg.dbPath;
if (!fs.existsSync(dbPath)) {
  console.error(`no relay DB at ${dbPath} (start the relay once, or pass --db <file>)`);
  process.exit(1);
}
const db = new Db(dbPath);
const store = new AgentStore(db);
const fileNames = (() => {
  try {
    return loadBotmasters(cfg.botmastersDir).map((b) => b.name);
  } catch {
    return [];
  }
})();
const ctx: AdminContext = { store, fileBotmasters: () => fileNames };
const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const when = (t?: number) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) : '-');
const tokenOnce = (name: string, token: string) => {
  console.log(`\nbotmaster ${name}: token (shown once, the relay keeps only its sha256):\n\n  ${token}\n`);
  console.log('It works for GET /api/botmaster/* (Authorization: Bearer <token>) and for /bot/ws.');
};

try {
  switch (cmd) {
    case 'requests': {
      const st = flag('status') ?? 'pending';
      const list = store.listRequests(st === 'all' ? undefined : (st as RequestStatus));
      if (!list.length) console.log(`no ${st === 'all' ? '' : `${st} `}requests`);
      for (const r of list) {
        console.log(`${r.id}  ${r.status.padEnd(8)} ${when(r.createdAt)}  ${r.request.kind.padEnd(12)} ${r.request.name}${r.request.company ? ` (${r.request.company})` : ''} <${r.request.email}>${r.botmaster ? `  -> ${r.botmaster}` : ''}`);
      }
      break;
    }
    case 'request': {
      const r = store.getRequest(need(arg, 'request id'));
      if (!r) throw new GameError('not_found', `no request ${arg}`);
      out(r);
      break;
    }
    case 'approve': {
      const silence = flag('silence-ms');
      const r = approveRequest(ctx, need(arg, 'request id'), { name: flag('name'), payoutAccount: flag('payout')?.toLowerCase(), silenceMs: silence ? Number(silence) : undefined });
      console.log(`approved ${r.request.id}: botmaster ${r.botmaster.name}, payout ${r.botmaster.payoutAccount}, contact ${r.botmaster.contact ?? '-'}`);
      tokenOnce(r.botmaster.name, r.token);
      break;
    }
    case 'reject': {
      const r = rejectRequest(ctx, need(arg, 'request id'), need(flag('reason'), '--reason'));
      console.log(`rejected ${r.id}: ${r.reason}`);
      break;
    }
    case 'botmasters': {
      const list = store.listBotmasters();
      if (!list.length) console.log('no botmasters in the DB');
      for (const b of list.map(adminView)) {
        const personas = store.listPersonas({ botmaster: b.name });
        const byStatus = personas.reduce((m: Record<string, number>, p) => ((m[p.status] = (m[p.status] ?? 0) + 1), m), {});
        console.log(`${b.name.padEnd(24)} ${b.status.padEnd(8)} payout ${b.payoutAccount}  token ${b.tokenFingerprint}... issued ${when(b.tokenIssuedAt)}  personas ${JSON.stringify(byStatus)}${store.getKey(b.name) ? '  own NEAR AI key' : ''}`);
      }
      if (fileNames.length) console.log(`in relay/botmasters (edit those files): ${fileNames.join(', ')}`);
      break;
    }
    case 'create': {
      const r = createBotmaster(ctx, { name: need(arg, 'name'), payoutAccount: need(flag('payout'), '--payout').toLowerCase(), contact: flag('contact') });
      console.log(`created botmaster ${r.botmaster.name}, payout ${r.botmaster.payoutAccount}`);
      tokenOnce(r.botmaster.name, r.token);
      break;
    }
    case 'revoke': {
      const b = revokeBotmaster(ctx, need(arg, 'name'), flag('reason'));
      console.log(`revoked ${b.name}: its token stopped working; a live /bot/ws connection drops within 20 s; its personas leave the next round`);
      break;
    }
    case 'rotate': {
      const r = rotateToken(ctx, need(arg, 'name'));
      console.log(`rotated ${r.botmaster.name}: the old token stopped working`);
      tokenOnce(r.botmaster.name, r.token);
      break;
    }
    case 'personas': {
      const st = flag('status') ?? 'pending';
      const list = store.listPersonas({ status: st === 'all' ? undefined : (st as PersonaStatus), botmaster: flag('botmaster') });
      if (!list.length) console.log(`no ${st === 'all' ? '' : `${st} `}personas`);
      for (const p of list) {
        console.log(`${p.id.padEnd(32)} ${p.status.padEnd(9)} ${when(p.createdAt)}  ${p.model}  L${p.levels.join(',')}  ${p.brain} brain  prompt ${p.prompt.length} chars sha256 ${p.promptSha256.slice(0, 12)}...${p.reason ? `  (${p.reason})` : ''}`);
      }
      break;
    }
    case 'persona': {
      const p = store.getPersona(need(arg, 'persona id'));
      if (!p) throw new GameError('not_found', `no persona ${arg}`);
      const { prompt, ...rest } = p;
      out(rest);
      console.log(`\n--- prompt (message 0, committed by sha256 every round) ---\n${prompt}\n---`);
      break;
    }
    case 'approve-persona':
    case 'reject-persona':
    case 'disable-persona': {
      const action = cmd.split('-')[0] as 'approve' | 'reject' | 'disable';
      const p = decidePersona(ctx, need(arg, 'persona id'), action, flag('reason'));
      console.log(`${p.id}: ${p.status}${p.status === 'approved' ? ' (plays from the next round)' : ''}`);
      break;
    }
    default:
      usage();
  }
} catch (e) {
  console.error(e instanceof GameError ? `error: ${e.message}` : e);
  process.exitCode = 1;
} finally {
  db.close();
}
