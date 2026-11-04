// HTTP API, WebSocket (/ws) and static hosting of web/dist with an SPA fallback, on one port.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMsg } from '../../shared/protocol.js';
import { Game, GameError, type Conn } from './game/game.js';
import { errMsg } from './util.js';
import { logger } from './log.js';

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

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(s);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new GameError('body_too_large', 'request body too large', 413);
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  const t = Buffer.concat(chunks).toString('utf8').trim();
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    throw new GameError('bad_json', 'body must be JSON');
  }
}

type Handler = (m: RegExpMatchArray, req: http.IncomingMessage, url: URL) => Promise<unknown> | unknown;

export function createServer(game: Game, opts: { webDist: string; testMode: boolean }) {
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
  route('GET', /^\/api\/dev\/state$/, () => {
    if (!opts.testMode) throw new GameError('not_test_mode', 'test mode only', 403);
    return game.debugState();
  });
  route('GET', /^\/api\/health$/, () => ({ ok: true, round: game.current?.id ?? null }));

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
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
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
