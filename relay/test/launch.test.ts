// The launch page (protocol v1.4): LAUNCH_* settings into PublicConfig.launch, the checks on them, and an
// in-process relay that sends `launch` while the contract has no coin and drops it (and tells every connection)
// once the coin is set; a test relay keeps it while LAUNCH_* is set; no LAUNCH_* means no change; /play is the
// app's index like any other path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthChallenge, LaunchConfig, PublicConfig } from '../../shared/protocol.js';
import { AUCTION_HOURS, LAUNCH_DEFAULTS, LAUNCH_VARS, checkLaunch, launchFromEnv, loadConfig, parseIsoTime } from '../src/config.js';
import { createApp, type App } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import { WsClient } from './client.js';
import { newKey, signChallenge } from './wallet-helpers.js';

const START = '2026-11-08T15:00:00Z';
const T0 = Date.UTC(2026, 10, 8, 15);
const H = 3_600_000;

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startApp(extra: Record<string, unknown>, chain: MockChain): Promise<App> {
  return createApp(
    {
      port: 0, dbPath: path.join(tmpDir('realsies-launch-'), 'relay.db'), chain: 'mock', nearAi: 'mock', countdownSeconds: 0, botTimeScale: 0.05,
      logLevel: 'warn', idleMinutes: 0, pruneDelaySeconds: 3600, webDist: path.join(os.tmpdir(), 'no-web-dist'), ...extra,
    },
    { chain },
  );
}

async function getConfig(base: string): Promise<PublicConfig> {
  const r = await fetch(base + '/api/config');
  assert.equal(r.status, 200);
  return (await r.json()) as PublicConfig;
}

test('LAUNCH_* into the launch page: nothing set, defaults, a 24-hour auction by default, every field', () => {
  assert.equal(launchFromEnv({}), undefined, 'no LAUNCH_*: no page');
  assert.equal(launchFromEnv({ LAUNCH_X_URL: '  ', LAUNCH_TOKEN_URL: '' }), undefined, 'empty values count as unset');
  assert.deepEqual(launchFromEnv({ LAUNCH_X_URL: 'https://x.com/realsies' }), { demoUrl: LAUNCH_DEFAULTS.demoUrl, xUrl: 'https://x.com/realsies', trailer: LAUNCH_DEFAULTS.trailer, poster: LAUNCH_DEFAULTS.poster }, 'any one variable turns the page on; no times: not announced yet');
  const l = launchFromEnv({ LAUNCH_AUCTION_START: START })!;
  assert.equal(l.auctionStart, T0);
  assert.equal(l.auctionEnd, T0 + AUCTION_HOURS * H, 'the end defaults to 24 hours after the start');
  assert.equal(l.demoUrl, 'https://test.realsies.lol');
  assert.equal(l.trailer, '/trailer/realsies-trailer.mp4');
  assert.equal(l.poster, '/trailer/poster.png');
  assert.ok(!('tokenUrl' in l) && !('xUrl' in l), 'no token page and no X link unless given');
  const all = launchFromEnv({
    LAUNCH_AUCTION_START: '2026-11-08T16:00:00+01:00', LAUNCH_AUCTION_END: '2026-11-09T15:30Z', LAUNCH_TOKEN_URL: 'https://meme.cooking/meme/123',
    LAUNCH_DEMO_URL: 'https://demo.example', LAUNCH_X_URL: 'https://x.com/realsies', LAUNCH_TRAILER: 'https://cdn.example/t.mp4', LAUNCH_POSTER: '/p.png',
  })!;
  assert.deepEqual(all, {
    auctionStart: T0, auctionEnd: T0 + 24.5 * H, tokenUrl: 'https://meme.cooking/meme/123', demoUrl: 'https://demo.example', xUrl: 'https://x.com/realsies', trailer: 'https://cdn.example/t.mp4', poster: '/p.png',
  });
  assert.equal(LAUNCH_VARS.length, 7);
});

test('the launch settings are checked: times with a zone, the end after the start, https links, site paths for the media', () => {
  assert.equal(parseIsoTime('X', '2026-11-08T15:00:00.000Z'), T0);
  assert.equal(parseIsoTime('X', '2026-11-08T17:00+0200'), T0);
  for (const bad of ['2026-11-08T15:00:00', '2026-11-08', 'Sunday 3pm', '2026-11-08 15:00Z', ''])
    assert.throws(() => parseIsoTime('LAUNCH_AUCTION_START', bad), /LAUNCH_AUCTION_START must be an ISO time with its zone/, bad);
  assert.throws(() => launchFromEnv({ LAUNCH_AUCTION_END: START }), /LAUNCH_AUCTION_END needs LAUNCH_AUCTION_START/);
  const ok: LaunchConfig = { auctionStart: T0, auctionEnd: T0 + H, demoUrl: 'https://test.realsies.lol', trailer: '/trailer/realsies-trailer.mp4', poster: '/trailer/poster.png' };
  checkLaunch(ok);
  assert.throws(() => checkLaunch({ ...ok, auctionEnd: T0 }), /must be after/);
  assert.throws(() => checkLaunch({ ...ok, auctionStart: undefined }), /needs LAUNCH_AUCTION_START/);
  assert.throws(() => checkLaunch({ ...ok, auctionStart: 1_000 }), /plausible/);
  assert.throws(() => checkLaunch({ ...ok, tokenUrl: 'http://meme.cooking' }), /LAUNCH_TOKEN_URL must be an https URL/);
  assert.throws(() => checkLaunch({ ...ok, xUrl: 'javascript:alert(1)' }), /LAUNCH_X_URL must be an https URL/);
  assert.throws(() => checkLaunch({ ...ok, demoUrl: 'test.realsies.lol' }), /LAUNCH_DEMO_URL/);
  assert.throws(() => checkLaunch({ ...ok, trailer: '//evil.example/t.mp4' }), /LAUNCH_TRAILER must be a path on this site/);
  assert.throws(() => checkLaunch({ ...ok, poster: 'poster.png' }), /LAUNCH_POSTER/);
  checkLaunch({ ...ok, trailer: 'https://cdn.example/t.mp4', poster: '/p.png?v=2' });
});

test('loadConfig reads LAUNCH_* from the env and refuses a bad one at boot', () => {
  const saved = Object.fromEntries(LAUNCH_VARS.map((k) => [k, process.env[k]]));
  try {
    for (const k of LAUNCH_VARS) delete process.env[k];
    assert.equal(loadConfig({}).launch, undefined, 'nothing set: no launch page');
    assert.ok(!('launch' in loadConfig({})), 'and no key either');
    process.env.LAUNCH_AUCTION_START = START;
    process.env.LAUNCH_TOKEN_URL = 'https://meme.cooking/meme/123';
    const cfg = loadConfig({});
    assert.equal(cfg.launch?.auctionStart, T0);
    assert.equal(cfg.launch?.auctionEnd, T0 + 24 * H);
    assert.equal(cfg.launch?.tokenUrl, 'https://meme.cooking/meme/123');
    assert.equal(loadConfig({ launch: undefined }).launch, undefined, 'an override wins over the env');
    process.env.LAUNCH_AUCTION_END = '2026-11-08T14:00:00Z';
    assert.throws(() => loadConfig({}), /LAUNCH_AUCTION_END must be after LAUNCH_AUCTION_START/);
    process.env.LAUNCH_AUCTION_END = '2026-11-09T15:00';
    assert.throws(() => loadConfig({}), /LAUNCH_AUCTION_END must be an ISO time with its zone/);
  } finally {
    for (const k of LAUNCH_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

const LAUNCH: LaunchConfig = {
  auctionStart: T0, auctionEnd: T0 + 24 * H, tokenUrl: 'https://meme.cooking/meme/123', demoUrl: 'https://test.realsies.lol',
  xUrl: 'https://x.com/realsies', trailer: '/trailer/realsies-trailer.mp4', poster: '/trailer/poster.png',
};

test('a mainnet-like relay sends the launch page until the coin is set, then drops it and tells every connection', { timeout: 60_000 }, async () => {
  const chain = new MockChain();
  chain.txLatencyMs = 5;
  chain.coinsOpen = false;
  chain.testMode = false;
  const app = await startApp({ testMode: false, roundMinutes: 5, buyUrl: 'https://meme.cooking/meme/123', launch: LAUNCH }, chain);
  const base = `http://localhost:${app.port}`;
  try {
    const cfg = await getConfig(base);
    assert.equal(cfg.coinsOpen, false);
    assert.deepEqual(cfg.launch, LAUNCH, 'the launch page, times as ms epoch');
    assert.equal(app.game.launchOn(), true);
    // a wallet player on the game at /play meanwhile: free play, and the socket hears about the coin
    const acct = 'early.testnet';
    const key = newKey();
    chain.addKey(acct, key.publicKey, 'FullAccess');
    const ch = (await (await fetch(base + '/api/auth/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()) as AuthChallenge;
    const v = await fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signChallenge(ch, acct, key)) });
    assert.equal(v.status, 200);
    const token = ((await v.json()) as { token: string }).token;
    const t = (await (await fetch(base + '/api/session/ticket', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json()) as { ticket: string };
    const ws = await WsClient.connectTicket(base, t.ticket, acct);
    const welcome = await ws.waitT('welcome', 5000);
    assert.deepEqual(welcome.config.launch, LAUNCH, 'the welcome carries the same config');
    // the owner sets the coin: within a minute the relay notices; here at once
    chain.coinsOpen = true;
    await app.game.refreshChainConfig();
    const pushed = await ws.waitT('config', 5000);
    assert.equal(pushed.config.coinsOpen, true);
    assert.ok(!('launch' in pushed.config), 'coins are open: no launch page in the pushed config');
    const after = await getConfig(base);
    assert.ok(!('launch' in after), 'nor in /api/config: the game takes over /');
    assert.equal(app.game.launchOn(), false);
    ws.close();
  } finally {
    await app.close();
  }
});

test('a test relay keeps the launch page while LAUNCH_* is set (its coins are always open); without LAUNCH_* nothing changes', { timeout: 60_000 }, async () => {
  const chain = new MockChain();
  const app = await startApp({ testMode: true, launch: LAUNCH }, chain);
  try {
    const cfg = await getConfig(`http://localhost:${app.port}`);
    assert.equal(cfg.testMode, true);
    assert.equal(cfg.coinsOpen, true);
    assert.deepEqual(cfg.launch, LAUNCH, 'to try the page on a test relay');
  } finally {
    await app.close();
  }
  const plain = await startApp({ testMode: false, launch: undefined }, (() => {
    const c = new MockChain();
    c.coinsOpen = false;
    c.testMode = false;
    return c;
  })());
  try {
    const cfg = await getConfig(`http://localhost:${plain.port}`);
    assert.equal(cfg.coinsOpen, false);
    assert.ok(!('launch' in cfg), 'no LAUNCH_*: no launch page, even before the coin');
    assert.equal(plain.game.launchOn(), false);
  } finally {
    await plain.close();
  }
});

test('/play is the web app like / (the game stays reachable while the launch page is up)', { timeout: 60_000 }, async () => {
  const dist = tmpDir('realsies-launch-dist-');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Realsies</title><div id="app"></div>');
  const app = await startApp({ testMode: false, launch: LAUNCH, webDist: dist }, new MockChain());
  try {
    for (const p of ['/', '/play', '/play/', '/agents']) {
      const r = await fetch(`http://localhost:${app.port}${p}`);
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /<div id="app">/, p);
    }
  } finally {
    await app.close();
  }
});
