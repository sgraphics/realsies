// Operator emails (src/agents/notify.ts): off without an address, one complete JSON file per email in the outbox
// for the root SES sender (deploy/realsies-mail.py), reply-to the builder, the admin commands in the text, and
// failures that never throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_FROM, Notifier, personaEmail, type OutboxMail } from '../src/agents/notify.js';
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

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-outbox-'));

test('notifier is off without an operator address and writes nothing', async () => {
  const dir = tmpDir();
  const n = new Notifier({ outboxDir: dir });
  assert.equal(n.enabled, false);
  assert.equal(await n.accessRequest(REQ), undefined);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an access request becomes one complete outbox file for the operator, replying to the builder', async () => {
  const dir = path.join(tmpDir(), 'outbox'); // made on first use
  const n = new Notifier({ outboxDir: dir, notifyEmail: 'silver@example.com' });
  const name = await n.accessRequest(REQ);
  assert.ok(name && /^\d+-[0-9a-f]{8}\.json$/.test(name));
  assert.deepEqual(fs.readdirSync(dir), [name]); // no temp file left behind
  const mail = JSON.parse(fs.readFileSync(path.join(dir, name!), 'utf8')) as OutboxMail;
  assert.equal(mail.v, 1);
  assert.equal(mail.from, DEFAULT_FROM);
  assert.equal(mail.to, 'silver@example.com');
  assert.equal(mail.replyTo, 'ada@engines.example');
  assert.match(mail.subject, /Ada Lovelace \(Analytical Engines\)/);
  assert.match(mail.text, /approve ar_0123456789abcdef --payout <their NEAR account>/);
  assert.match(mail.text, /reject ar_0123456789abcdef/);
});

test('a persona waiting for review is emailed with its review commands and a trimmed prompt', async () => {
  const m = personaEmail(PERSONA);
  assert.match(m.subject, /engines-zed from analytical-engines/);
  assert.match(m.text, /approve-persona engines-zed/);
  assert.match(m.text, /more characters\]/);
  assert.equal(m.replyTo, undefined);
  const dir = tmpDir();
  const n = new Notifier({ outboxDir: dir, notifyEmail: 'a@b.co', notifyFrom: 'Realsies <agents@realsies.lol>' });
  const name = await n.personaSubmitted(PERSONA);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, name!), 'utf8')).from, 'Realsies <agents@realsies.lol>');
});

test('an outbox that cannot be written returns undefined instead of throwing', async () => {
  const file = path.join(tmpDir(), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const n = new Notifier({ outboxDir: path.join(file, 'outbox'), notifyEmail: 'a@b.co' });
  assert.equal(await n.send({ subject: 's', text: 't' }), undefined);
});
