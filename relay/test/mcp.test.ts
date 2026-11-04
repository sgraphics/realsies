// The botmaster MCP server (tools/mcp-botmaster.mjs) over stdio: initialize, tools/list, the docs tool,
// and request_persona writing a pending request (and refusing bad input and raw tokens).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('MCP: docs tool and request_persona', { timeout: 30_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'realsies-mcp-'));
  const child = spawn(process.execPath, [path.resolve(here, '../tools/mcp-botmaster.mjs')], { env: { ...process.env, REALSIES_REQUESTS_DIR: dir }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, (m: any) => void>();
  readline.createInterface({ input: child.stdout! }).on('line', (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let id = 0;
  const call = (method: string, params?: unknown) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'realsies-botmaster');
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = (await call('tools/list')).result.tools.map((t: any) => t.name);
    assert.deepEqual(tools, ['bot_api_docs', 'request_persona']);
    const all = (await call('tools/call', { name: 'bot_api_docs', arguments: {} })).result.content[0].text;
    assert.match(all, /realsies-brain\/1/);
    const remote = (await call('tools/call', { name: 'bot_api_docs', arguments: { section: 'remote brains' } })).result.content[0].text;
    assert.match(remote, /^## 11\. Remote brains/);
    const prompt = JSON.parse(fs.readFileSync(path.resolve(here, '../personas/mia-leeds.json'), 'utf8')).prompt;
    const persona = { id: 'zed-oslo', levels: [1], model: 'z-ai/glm-5.3-flash', prompt, typing: { cps: 5 }, interests: ['music'] };
    const bad = await call('tools/call', { name: 'request_persona', arguments: { botmaster: 'acme', contact: 'ops@acme.example', token: 'secret', persona: { ...persona, model: 'gpt-9' } } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /persona\.model[\s\S]*only tokenSha256/);
    assert.equal(fs.readdirSync(dir).length, 0, 'nothing filed for a bad request');
    const ok = await call('tools/call', { name: 'request_persona', arguments: { botmaster: 'acme', contact: 'ops@acme.example', tokenSha256: 'ab'.repeat(32), persona } });
    assert.ok(!ok.result.isError, ok.result.content[0].text);
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    const req = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.equal(req.status, 'pending');
    assert.deepEqual(req.persona.brain, { remote: 'acme' });
    assert.equal(req.persona.prompt, prompt);
    assert.equal((await call('nope')).error.code, -32601);
  } finally {
    child.kill();
  }
});
