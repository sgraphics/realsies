// POST /api/auth/failed (protocol v1.11): a browser reports a failed sign-in; the relay writes one WARN line for it
// (the stage, the wallet, the message, the user agent, the IP), each field one short line, refuses a report it
// cannot read, and stops logging after 10 reports per IP in 10 minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { MockChain } from '../src/chain/mock.js';
import { signInFailure } from '../src/auth/failure.js';

async function post(base: string, body: unknown, ua?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ua) headers['User-Agent'] = ua;
  const r = await fetch(`${base}/api/auth/failed`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

test('the report as it goes in the log: stage checked, one short line per field, the header for a missing user agent', () => {
  assert.deepEqual(signInFailure({ stage: 'sign', walletId: 'intear-wallet', message: 'failed: Popup\nblocked', ua: 'iPhone', ms: 812.4, prefetched: true }), {
    stage: 'sign', walletId: 'intear-wallet', message: 'failed: Popup blocked', ua: 'iPhone', ms: 812, prefetched: true,
  });
  assert.deepEqual(signInFailure({ stage: 'connect', walletId: 'bad id"}', message: 'x'.repeat(500), ms: -1 }, 'Mozilla/5.0 (Linux; Android 14; SM-S918B)'), {
    stage: 'connect', message: 'x'.repeat(300), ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B)',
  });
  for (const bad of [{}, { stage: 'other' }, null, 'connect', { stage: 1 }]) {
    assert.throws(() => signInFailure(bad), (e: any) => e.code === 'invalid_request' && e.status === 400);
  }
});

test('POST /api/auth/failed: one WARN line per report, bad reports refused, 10 per IP in 10 minutes', { timeout: 30_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-failed-'));
  const chain = new MockChain();
  chain.testMode = false;
  const app = await createApp(
    {
      port: 0, dbPath: path.join(dir, 'relay.db'), chain: 'mock', nearAi: 'mock', chatSeconds: 3, callSeconds: 4, countdownSeconds: 0, botTimeScale: 0.05,
      searchDelay: [0.15, 0.3], devCallSeconds: 2, partnerLeftSeconds: 1, logLevel: 'warn', idleMinutes: 0, pruneDelaySeconds: 3600,
      signTimeoutSeconds: 3, webDist: path.join(dir, 'no-web'), testMode: false,
    } as never,
    { chain },
  );
  const base = `http://localhost:${app.port}`;
  const lines: string[] = [];
  const err = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  const reported = () => lines.filter((l) => l.includes('[http] sign-in failed'));
  try {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
    const r = await post(base, { stage: 'connect', walletId: 'intear-wallet', message: 'failed: Importing a module script failed.\nsecond line', ua: iphone, ms: 140, prefetched: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { ok: true });
    const [l1] = reported();
    assert.equal(reported().length, 1, 'one line');
    assert.match(l1, /WARN {2}\[http\] sign-in failed at connect with intear-wallet \{/);
    assert.ok(l1.includes('"message":"failed: Importing a module script failed. second line"') && l1.includes(iphone) && l1.includes('"ms":140') && l1.includes('"prefetched":true'), l1);
    assert.match(l1, /"ip":"[^"]+"/, 'the IP, to match the access log');
    assert.ok(!l1.includes('\n'), 'one line, whatever the browser sent');

    const bad = await post(base, { stage: 'wallet', message: 'x' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_request');
    assert.equal(reported().length, 1, 'nothing logged for a report it cannot read');

    // the user agent from the header when the body has none
    await post(base, { stage: 'verify', message: 'nonce_used: this sign-in request was already used' }, 'Mozilla/5.0 (Linux; Android 14; SM-S918B)');
    assert.ok(reported()[1]?.includes('SM-S918B') && reported()[1].includes('sign-in failed at verify {'), reported()[1]);

    // 10 per IP in 10 minutes, then refused and not logged
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await post(base, { stage: 'sign', message: `attempt ${i}`, ua: iphone })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 200, 200, 429]);
    assert.equal(reported().length, 10);
    const limited = await post(base, { stage: 'sign', message: 'more', ua: iphone });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, 'rate_limited');
    assert.equal(reported().length, 10, 'no line past the limit');
  } finally {
    console.error = err;
    await app.close();
  }
});
