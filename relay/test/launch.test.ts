// The launch (protocol v1.4): LAUNCH_* settings into PublicConfig.launch, the checks on them, and in-process
// relays: without test mode `launch` is sent until the coin is set on the contract, then dropped and pushed to
// every connection; a test relay never sends it, whatever its env says; no LAUNCH_* means no change; /play is the
// app's index like any other path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthChallenge, LaunchConfig, PublicConfig } from '../../shared/protocol.js';
import { AUCTION_HOURS, LAUNCH_RETIRED, LAUNCH_VARS, checkLaunch, isTelegramUrl, isXUrl, launchFromEnv, loadConfig, parseIsoTime } from '../src/config.js';
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

/** A chain like mainnet before REAL: no test users, no coin on the contract yet. */
function mainnetBeforeCoin(): MockChain {
  const c = new MockChain();
  c.txLatencyMs = 5;
  c.coinsOpen = false;
  c.testMode = false;
  return c;
}

async function getConfig(base: string): Promise<PublicConfig> {
  const r = await fetch(base + '/api/config');
  assert.equal(r.status, 200);
  return (await r.json()) as PublicConfig;
}

test('LAUNCH_* into the launch: nothing set, a 24-hour auction by default, every field', () => {
  assert.equal(launchFromEnv({}), undefined, 'no LAUNCH_*: nothing');
  assert.equal(launchFromEnv({ LAUNCH_TOKEN_URL: '  ', LAUNCH_AUCTION_START: '' }), undefined, 'empty values count as unset');
  assert.deepEqual(launchFromEnv({ LAUNCH_TOKEN_URL: 'https://meme.cooking/meme/1' }), { tokenUrl: 'https://meme.cooking/meme/1' }, 'any one variable turns it on; no time: coming soon');
  assert.equal(launchFromEnv({ LAUNCH_DEMO_URL: 'https://test.realsies.lol', LAUNCH_TRAILER: '/t.mp4', LAUNCH_POSTER: '/p.png' }), undefined, 'the retired variables turn nothing on');
  assert.deepEqual(launchFromEnv({ LAUNCH_X_URL: 'https://x.com/realsieslol' }), { xUrl: 'https://x.com/realsieslol' }, 'the X account alone: coming soon with the video card');
  assert.deepEqual(
    launchFromEnv({ LAUNCH_VIDEO_URL: 'https://x.com/realsieslol/status/1', LAUNCH_X_URL: 'https://x.com/realsieslol' }),
    { videoUrl: 'https://x.com/realsieslol/status/1', xUrl: 'https://x.com/realsieslol' },
    'the launch tweet and the account',
  );
  assert.deepEqual(launchFromEnv({ LAUNCH_TELEGRAM_URL: ' https://t.me/realsieslol ' }), { telegramUrl: 'https://t.me/realsieslol' }, 'Telegram alone: coming soon, the link in the footer');
  assert.deepEqual(launchFromEnv({ LAUNCH_AUCTION_START: START }), { auctionStart: T0, auctionEnd: T0 + AUCTION_HOURS * H }, 'the end defaults to 24 hours after the start');
  assert.deepEqual(
    launchFromEnv({ LAUNCH_AUCTION_START: '2026-11-08T16:00:00+01:00', LAUNCH_AUCTION_END: '2026-11-09T15:30Z', LAUNCH_TOKEN_URL: 'https://meme.cooking/meme/123' }),
    { auctionStart: T0, auctionEnd: T0 + 24.5 * H, tokenUrl: 'https://meme.cooking/meme/123' },
  );
  assert.deepEqual([...LAUNCH_VARS], ['LAUNCH_AUCTION_START', 'LAUNCH_AUCTION_END', 'LAUNCH_TOKEN_URL', 'LAUNCH_VIDEO_URL', 'LAUNCH_X_URL', 'LAUNCH_TELEGRAM_URL']);
  assert.deepEqual([...LAUNCH_RETIRED], ['LAUNCH_DEMO_URL', 'LAUNCH_TRAILER', 'LAUNCH_POSTER']);
});

test('the launch settings are checked: times with their zone, the end after the start, an https token page, X links on X, Telegram on t.me', () => {
  assert.equal(parseIsoTime('X', '2026-11-08T15:00:00.000Z'), T0);
  assert.equal(parseIsoTime('X', '2026-11-08T17:00+0200'), T0);
  for (const bad of ['2026-11-08T15:00:00', '2026-11-08', 'Sunday 3pm', '2026-11-08 15:00Z', ''])
    assert.throws(() => parseIsoTime('LAUNCH_AUCTION_START', bad), /LAUNCH_AUCTION_START must be an ISO time with its zone/, bad);
  assert.throws(() => launchFromEnv({ LAUNCH_AUCTION_END: START }), /LAUNCH_AUCTION_END needs LAUNCH_AUCTION_START/);
  const ok: LaunchConfig = { auctionStart: T0, auctionEnd: T0 + H, tokenUrl: 'https://meme.cooking/meme/1' };
  checkLaunch(ok);
  checkLaunch({});
  assert.throws(() => checkLaunch({ ...ok, auctionEnd: T0 }), /must be after/);
  assert.throws(() => checkLaunch({ ...ok, auctionStart: undefined }), /needs LAUNCH_AUCTION_START/);
  assert.throws(() => checkLaunch({ ...ok, auctionStart: 1_000 }), /plausible/);
  assert.throws(() => checkLaunch({ ...ok, tokenUrl: 'http://meme.cooking' }), /LAUNCH_TOKEN_URL must be an https URL/);
  assert.throws(() => checkLaunch({ ...ok, tokenUrl: 'javascript:alert(1)' }), /LAUNCH_TOKEN_URL must be an https URL/);
  for (const good of ['https://x.com/realsieslol', 'https://x.com/realsieslol/status/1854000000000000000', 'https://twitter.com/realsieslol', 'https://www.x.com/a', 'https://mobile.twitter.com/a'])
    assert.ok(isXUrl(good), good);
  for (const bad of ['http://x.com/realsieslol', 'https://example.com/x.com', 'https://evilx.com/a', 'https://x.com.evil.io/a', 'https://x.com:8443/a', 'https://user@x.com/a', 'x.com/realsieslol', 'javascript:alert(1)'])
    assert.ok(!isXUrl(bad), bad);
  checkLaunch({ ...ok, videoUrl: 'https://x.com/realsieslol/status/1', xUrl: 'https://twitter.com/realsieslol' });
  assert.throws(() => checkLaunch({ ...ok, videoUrl: 'https://youtube.com/watch?v=1' }), /LAUNCH_VIDEO_URL must be an https link on x.com or twitter.com/);
  assert.throws(() => checkLaunch({ ...ok, xUrl: 'http://x.com/realsieslol' }), /LAUNCH_X_URL must be an https link on x.com or twitter.com/);
  for (const good of ['https://t.me/realsieslol', 'https://t.me/+AbCdEf123', 'https://telegram.me/realsieslol', 'https://realsieslol.t.me/'])
    assert.ok(isTelegramUrl(good), good);
  for (const bad of ['http://t.me/realsieslol', 'https://x.com/realsieslol', 'https://evilt.me/a', 'https://t.me.evil.io/a', 'https://t.me:8443/a', 'https://user@t.me/a', 't.me/realsieslol', 'tg://resolve?domain=realsieslol'])
    assert.ok(!isTelegramUrl(bad), bad);
  checkLaunch({ ...ok, telegramUrl: 'https://t.me/realsieslol' });
  assert.throws(() => checkLaunch({ ...ok, telegramUrl: 'https://discord.gg/realsies' }), /LAUNCH_TELEGRAM_URL must be an https link on t.me or telegram.me/);
});

test('loadConfig reads LAUNCH_* from the env and refuses a bad one at boot', () => {
  const names = [...LAUNCH_VARS, ...LAUNCH_RETIRED];
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  try {
    for (const k of names) delete process.env[k];
    assert.ok(!('launch' in loadConfig({})), 'nothing set: no launch');
    process.env.LAUNCH_AUCTION_START = START;
    process.env.LAUNCH_TOKEN_URL = 'https://meme.cooking/meme/123';
    process.env.LAUNCH_X_URL = 'https://x.com/realsieslol';
    process.env.LAUNCH_TELEGRAM_URL = 'https://t.me/realsieslol';
    process.env.LAUNCH_TRAILER = '/trailer/realsies-trailer.mp4';
    const cfg = loadConfig({});
    assert.deepEqual(
      cfg.launch,
      { auctionStart: T0, auctionEnd: T0 + 24 * H, tokenUrl: 'https://meme.cooking/meme/123', xUrl: 'https://x.com/realsieslol', telegramUrl: 'https://t.me/realsieslol' },
      'the X account and Telegram are read, a retired variable is not',
    );
    process.env.LAUNCH_VIDEO_URL = 'https://www.youtube.com/watch?v=1';
    assert.throws(() => loadConfig({}), /LAUNCH_VIDEO_URL must be an https link on x.com or twitter.com/);
    delete process.env.LAUNCH_VIDEO_URL;
    process.env.LAUNCH_TELEGRAM_URL = 'https://t.me.example.com/realsieslol';
    assert.throws(() => loadConfig({}), /LAUNCH_TELEGRAM_URL must be an https link on t.me or telegram.me/);
    delete process.env.LAUNCH_TELEGRAM_URL;
    assert.equal(loadConfig({ launch: undefined }).launch, undefined, 'an override wins over the env');
    process.env.LAUNCH_AUCTION_END = '2026-11-08T14:00:00Z';
    assert.throws(() => loadConfig({}), /LAUNCH_AUCTION_END must be after LAUNCH_AUCTION_START/);
    process.env.LAUNCH_AUCTION_END = '2026-11-09T15:00';
    assert.throws(() => loadConfig({}), /LAUNCH_AUCTION_END must be an ISO time with its zone/);
  } finally {
    for (const k of names) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

const LAUNCH: LaunchConfig = {
  auctionStart: T0,
  auctionEnd: T0 + 24 * H,
  tokenUrl: 'https://meme.cooking/meme/123',
  videoUrl: 'https://x.com/realsieslol/status/1',
  xUrl: 'https://x.com/realsieslol',
  telegramUrl: 'https://t.me/realsieslol',
};

test('a mainnet-like relay sends the launch until the coin is set, then drops it and tells every connection', { timeout: 60_000 }, async () => {
  const chain = mainnetBeforeCoin();
  const app = await startApp({ testMode: false, roundMinutes: 5, buyUrl: 'https://meme.cooking/meme/123', launch: LAUNCH }, chain);
  const base = `http://localhost:${app.port}`;
  try {
    const cfg = await getConfig(base);
    assert.equal(cfg.coinsOpen, false);
    assert.deepEqual(cfg.launch, LAUNCH, 'the launch, times as ms epoch');
    assert.equal(app.game.launchOn(), true);
    // a wallet player in the game meanwhile (free play, the auction banner): the socket hears about the coin
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
    assert.ok(!('launch' in pushed.config), 'coins are open: no launch in the pushed config (the banner goes)');
    assert.ok(!('launch' in (await getConfig(base))), 'nor in /api/config');
    assert.equal(app.game.launchOn(), false);
    ws.close();
  } finally {
    await app.close();
  }
});

test('a test relay never sends the launch, whatever its env says; without LAUNCH_* nothing changes', { timeout: 60_000 }, async () => {
  const testRelay = await startApp({ testMode: true, launch: LAUNCH }, new MockChain());
  try {
    const cfg = await getConfig(`http://localhost:${testRelay.port}`);
    assert.equal(cfg.testMode, true);
    assert.ok(!('launch' in cfg), 'the testnet demo shows none of it');
    assert.equal(testRelay.game.launchOn(), false);
  } finally {
    await testRelay.close();
  }
  const closed = mainnetBeforeCoin();
  closed.testMode = true;
  const testBeforeCoin = await startApp({ testMode: true, launch: LAUNCH }, closed);
  try {
    assert.ok(!('launch' in (await getConfig(`http://localhost:${testBeforeCoin.port}`))), 'not even with no coin on the contract');
  } finally {
    await testBeforeCoin.close();
  }
  const plain = await startApp({ testMode: false, launch: undefined }, mainnetBeforeCoin());
  try {
    const cfg = await getConfig(`http://localhost:${plain.port}`);
    assert.equal(cfg.coinsOpen, false);
    assert.ok(!('launch' in cfg), 'no LAUNCH_*: no launch, even before the coin');
    assert.equal(plain.game.launchOn(), false);
  } finally {
    await plain.close();
  }
});

test('/play is the web app like / (the game stays reachable before the start)', { timeout: 60_000 }, async () => {
  const dist = tmpDir('realsies-launch-dist-');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Realsies</title><div id="app"></div>');
  const app = await startApp({ testMode: false, launch: LAUNCH, webDist: dist }, mainnetBeforeCoin());
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
