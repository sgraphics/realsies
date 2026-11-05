// Operator emails through Resend (src/agents/notify.ts): off without a key and an address, the request shape,
// reply-to the builder, the admin commands in the text, and failures that never throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FROM, Notifier, RESEND_URL, accessRequestEmail, personaEmail } from '../src/agents/notify.js';
import type { AccessRequestRec, AgentPersonaRec } from '../src/agents/store.js';

const REQ: AccessRequestRec = {
  id: 'ar_0123456789abcdef', createdAt: 1, status: 'pending', ipHash: 'x',
  request: {
    name: 'Ada Lovelace', email: 'ada@engines.example', company: 'Analytical Engines', kind: 'chat_vendor',
    models: 'GLM 5.3 Flash', goal: 'how often people take our agent for a human', agreeTerms: true,
  },
};

const PERSONA = {
  id: 'engines-zed', botmaster: 'analytical-engines', status: 'pending', createdAt: 1, model: 'z-ai/glm-5.3-flash',
  prompt: 'You are Zed. '.repeat(200), promptSha256: 'ab'.repeat(32), levels: [1, 2], brain: 'default',
} as unknown as AgentPersonaRec;

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('notifier is off without both a key and an address, and sends nothing', async () => {
  const f = fakeFetch(200, '{"id":"x"}');
  for (const cfg of [{}, { resendApiKey: 're_x' }, { notifyEmail: 'silver@example.com' }]) {
    const n = new Notifier(cfg, f.fn);
    assert.equal(n.enabled, false);
    assert.equal(await n.accessRequest(REQ), undefined);
  }
  assert.equal(f.calls.length, 0);
});

test('an access request becomes one Resend email to the operator, replying to the builder', async () => {
  const f = fakeFetch(200, '{"id":"em_1"}');
  const n = new Notifier({ resendApiKey: 're_test', notifyEmail: 'silver@example.com' }, f.fn);
  assert.equal(await n.accessRequest(REQ), 'em_1');
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, RESEND_URL);
  assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer re_test');
  const body = JSON.parse(String(init.body));
  assert.equal(body.from, DEFAULT_FROM);
  assert.deepEqual(body.to, ['silver@example.com']);
  assert.equal(body.reply_to, 'ada@engines.example');
  assert.match(body.subject, /Ada Lovelace \(Analytical Engines\)/);
  assert.match(body.text, /approve ar_0123456789abcdef --payout <their NEAR account>/);
  assert.match(body.text, /reject ar_0123456789abcdef/);
});

test('a persona waiting for review is emailed with its review commands and a trimmed prompt', () => {
  const m = personaEmail(PERSONA);
  assert.match(m.subject, /engines-zed from analytical-engines/);
  assert.match(m.text, /approve-persona engines-zed/);
  assert.match(m.text, /more characters\]/);
  assert.equal(m.replyTo, undefined);
});

test('a custom sender is used, and failures return undefined instead of throwing', async () => {
  const bad = fakeFetch(403, '{"message":"You can only send testing emails to your own email address"}');
  const n = new Notifier({ resendApiKey: 're_x', notifyEmail: 'a@b.co', notifyFrom: 'Realsies <agents@realsies.lol>' }, bad.fn);
  assert.equal(await n.send(accessRequestEmail(REQ)), undefined);
  assert.equal(JSON.parse(String(bad.calls[0].init.body)).from, 'Realsies <agents@realsies.lol>');
  const throwing = new Notifier({ resendApiKey: 're_x', notifyEmail: 'a@b.co' }, (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch);
  assert.equal(await throwing.send({ subject: 's', text: 't' }), undefined);
});
