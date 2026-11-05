// HTTP API, WebSocket (/ws), the AI builders API (src/agents/api.ts), /bot/ws for remote brains, and static
// hosting of web/dist with an SPA fallback, on one port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMsg } from '../../shared/protocol.js';
import { Game, GameError, type Conn } from './game/game.js';
import type { BotmasterHub } from './bot/remote.js';
import { BRAIN_PROTOCOL, INTENTS, LENGTHS, LIMITS, TOPICS } from './bot/api.js';
import { STEERING, STEERING_SHA256, STEER_VERSION } from './bot/intents.js';
import { errMsg } from './util.js';
import { logger } from './log.js';
import { CORS, readBody, sendJson } from './http.js';

const log = logger('http');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

type Handler = (m: RegExpMatchArray, req: http.IncomingMessage, url: URL) => Promise<unknown> | unknown;

/** Routes mounted before the game's: /api/agents, /api/admin, /api/botmaster (src/agents/api.ts). */
export interface ApiMount {
  handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean>;
}

export function createServer(game: Game, opts: { webDist: string; testMode: boolean; hub?: BotmasterHub; agents?: ApiMount }) {
  const routes: { method: string; re: RegExp; fn: Handler }[] = [];
  const route = (method: string, re: RegExp, fn: Handler) => routes.push({ method, re, fn });

  route('GET', /^\/api\/config$/, () => game.publicConfig);
  route('GET', /^\/api\/test-users$/, () => game.testUsers());
  route('POST', /^\/api\/test-users\/([^/]+)\/faucet$/, async (m, req) => {
    const body = await readBody(req);
    return game.faucet(decodeURIComponent(m[1]), body?.coins === undefined ? 100 : Number(body.coins));
  });
  route('POST', /^\/api\/withdraw$/, async (_m, req) => {
    const body = await readBody(req);
    return game.withdraw(String(body?.accountId ?? ''), Number(body?.coins));
  });
  route('GET', /^\/api\/me\/([^/]+)$/, (m) => game.me(decodeURIComponent(m[1])));
  route('GET', /^\/api\/rounds$/, () => game.listRounds());
  route('GET', /^\/api\/rounds\/(\d+)\/results\/([^/]+)$/, (m) => game.results(Number(m[1]), decodeURIComponent(m[2])));
  route('GET', /^\/api\/verify\/([^/]+)$/, (m, _req, url) => game.verify(decodeURIComponent(m[1]), url.searchParams.get('account') ?? ''));
  route('GET', /^\/api\/leaderboard$/, () => game.leaderboard());
  route('POST', /^\/api\/dev\/end-round$/, async () => {
    if (!opts.testMode) throw new GameError('not_test_mode', 'test mode only', 403);
    await game.devEndRound();
    return { ok: true };
  });
  // the bot engine's published steering catalogue (docs/bot-api.md): what verifiers check system messages against
  route('GET', /^\/api\/bot\/steering$/, () => ({
    protocol: BRAIN_PROTOCOL, version: STEER_VERSION, sha256: STEERING_SHA256, intents: INTENTS, topics: TOPICS, lengths: LENGTHS, limits: LIMITS,
    entries: STEERING.map((e) => ({ id: e.id, kind: e.kind, text: e.text })),
  }));
  route('GET', /^\/api\/dev\/bot-trace\/([^/]+)$/, (m, _req, url) => {
    if (!opts.testMode) throw new GameError('not_test_mode', 'test mode only', 403);
    return game.botTrace(decodeURIComponent(m[1]), url.searchParams.get('account') ?? '');
  });
  route('GET', /^\/api\/dev\/state$/, () => {
    if (!opts.testMode) throw new GameError('not_test_mode', 'test mode only', 403);
    return game.debugState();
  });
  // ai: the relay's own NEAR AI key, {status: ok | low_credit | out_of_credits, since}; spend, budget and the
  // reason are business information, served by GET /api/admin/health (src/agents/api.ts)
  route('GET', /^\/api\/health$/, () => ({ ok: true, round: game.current?.id ?? null, ai: game.aiHealth() }));

  const distRoot = path.resolve(opts.webDist);
  const hasDist = fs.existsSync(path.join(distRoot, 'index.html'));
  if (!hasDist) log.warn(`no web build at ${distRoot}; serving a placeholder at /`);

  function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    if (!hasDist) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>Realsies relay</title><p>Realsies relay is running. The web app is not built yet (web/dist). API at <code>/api/config</code>, WebSocket at <code>/ws</code>.</p>');
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(distRoot, '.' + rel);
    const inside = file === distRoot || file.startsWith(distRoot + path.sep);
    const target = inside && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(distRoot, 'index.html');
    const ext = path.extname(target).toLowerCase();
    const immutable = target.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(target).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '600' });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (opts.agents && (await opts.agents.handle(req, res, url))) return;
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        sendJson(res, 404, { error: 'not_found', code: 'not_found', message: `${req.method} ${url.pathname}` });
        return;
      }
      try {
        const out = await r.fn(url.pathname.match(r.re)!, req, url);
        sendJson(res, 200, out ?? { ok: true });
      } catch (e) {
        if (e instanceof GameError) sendJson(res, e.status, { error: e.code, code: e.code, message: e.message });
        else {
          log.error(`${req.method} ${url.pathname}`, e);
          sendJson(res, 500, { error: 'internal', code: 'internal', message: errMsg(e) });
        }
      }
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url);
      return;
    }
    sendJson(res, 405, { error: 'method_not_allowed', code: 'method_not_allowed', message: req.method });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/bot/ws') {
      if (!opts.hub) {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n\r\nno remote brains on this relay\r\n');
        socket.destroy();
        return;
      }
      opts.hub.handleUpgrade(req, socket, head);
      return;
    }
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const account = url.searchParams.get('account') ?? '';
    if (!game.isTestUser(account)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nunknown test user\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, account));
  });

  function onSocket(ws: WebSocket, account: string): void {
    let alive = true;
    const conn: Conn = {
      account,
      send: (msg: ServerMsg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (code?: number, reason?: string) => ws.close(code, reason),
    };
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closed */
      }
    }, 30_000);
    ws.on('message', (data) => {
      alive = true;
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        conn.send({ t: 'error', code: 'bad_json', message: 'messages are JSON' });
        return;
      }
      void game.onMessage(conn, msg);
    });
    ws.on('close', () => {
      clearInterval(beat);
      game.disconnect(conn);
    });
    ws.on('error', (e) => log.debug(`ws ${account}: ${errMsg(e)}`));
    void game.connect(conn);
  }

  return {
    server,
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      });
    },
    close(): Promise<void> {
      for (const c of wss.clients) c.terminate();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
