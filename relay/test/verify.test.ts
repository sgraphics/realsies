// Signature and attestation verification against the real NEAR AI evidence of 2026-11-04 and the
// lead's signed vectors; think-stripping and bubble splitting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverEip191, sha256Hex, signEip191, addressOfPrivateKey } from '../src/crypto.js';
import { bubblesOf, checkAttestation, checkSignature, stripThink, contentOfResponse } from '../src/nearai/verify.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ev = path.resolve(here, '../../experiments/near-ai/evidence/2026-11-04');
const read = (f: string) => fs.readFileSync(path.join(ev, f), 'utf8');
const V = JSON.parse(fs.readFileSync(path.resolve(here, '../../contracts/game/tests/vectors.json'), 'utf8'));

test('evidence: request and response hashes are the ones in the signed text', () => {
  const sig = JSON.parse(read('signature.json'));
  const [model, h1, h2] = sig.text.split(':');
  assert.equal(model, 'z-ai/glm-5.3-flash');
  assert.equal(sha256Hex(read('request.json')), h1);
  assert.equal(sha256Hex(read('response.json')), h2);
  assert.equal(h1, 'c0a2b8b967e9a65419672ac86c2d4d75c95acc4f2d7b470330cb2bce4feae9c0');
});

test('evidence: EIP-191 signature recovers to the attested enclave signer', () => {
  const sig = JSON.parse(read('signature.json'));
  assert.equal(recoverEip191(sig.text, sig.signature), '0x3b753b4406613c5e70ae640508632b600424fa0c');
  // a one-character change recovers to someone else
  assert.notEqual(recoverEip191(sig.text.replace('z-ai', 'z-AI'), sig.signature), '0x3b753b4406613c5e70ae640508632b600424fa0c');
});

test('evidence: full check passes with the attested set and fails without it', () => {
  const sig = JSON.parse(read('signature.json'));
  const ok = checkSignature('z-ai/glm-5.3-flash', read('request.json'), read('response.json'), sig, ['0x3b753b4406613c5e70ae640508632b600424fa0c']);
  assert.equal(ok.ok, true);
  assert.equal(ok.validSignature, true);
  const notAttested = checkSignature('z-ai/glm-5.3-flash', read('request.json'), read('response.json'), sig, ['0x0000000000000000000000000000000000000001']);
  assert.equal(notAttested.validSignature, true);
  assert.equal(notAttested.ok, false);
  const tampered = checkSignature('z-ai/glm-5.3-flash', read('request.json') + ' ', read('response.json'), sig, ['0x3b753b4406613c5e70ae640508632b600424fa0c']);
  assert.equal(tampered.requestHashOk, false);
  assert.equal(tampered.ok, false);
  const wrongModel = checkSignature('deepseek-ai/DeepSeek-V4.1-Flash-1017', read('request.json'), read('response.json'), sig, ['0x3b753b4406613c5e70ae640508632b600424fa0c']);
  assert.equal(wrongModel.modelOk, false);
});

test('evidence: attestation binds the signer and the nonce in report_data (parsed from the TDX quote)', () => {
  const att = JSON.parse(read('attestation.json'));
  const nonce = att.model_attestations[0].request_nonce;
  const c = checkAttestation(att, 'z-ai/glm-5.3-flash', nonce);
  assert.equal(c.gatewayOk, true);
  assert.equal(c.gatewaySigner, '0xb98a789cdc4817275f5155593ba73ef2a957e779');
  assert.deepEqual(c.attested, ['0x3b753b4406613c5e70ae640508632b600424fa0c']);
  assert.equal(c.signers[0].reportDataOk, true);
  assert.equal(c.signers[0].nonceOk, true);
  assert.equal(c.signers[0].nvidiaNonceOk, true);
  const other = checkAttestation(att, 'z-ai/glm-5.3-flash', 'ab'.repeat(32));
  assert.deepEqual(other.attested, []);
  assert.equal(other.signers[0].reportDataOk, false);
});

test('vectors: the lead\'s throwaway-key proofs recover to the committed signer', () => {
  for (const viewer of ['alice.testnet', 'bob.testnet']) {
    const p = V.bot.proofs[viewer];
    assert.equal(recoverEip191(p.text, p.signature), V.bot.signers[0]);
    const [, h1] = p.text.split(':').slice(-3);
    assert.equal(sha256Hex(p.request), h1);
  }
});

test('local EIP-191 signing round-trips (mock enclave)', () => {
  const key = sha256Hex('test key');
  const sig = signEip191('model:aa:bb', key);
  assert.match(sig, /^0x[0-9a-f]{130}$/);
  assert.equal(recoverEip191('model:aa:bb', sig), addressOfPrivateKey(key));
  // the eth-account docs key used by the vectors
  assert.equal(addressOfPrivateKey('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'), V.bot.signers[0]);
});

test('think stripping and bubbles', () => {
  assert.equal(stripThink('<think>plan</think>hey there'), 'hey there');
  assert.equal(stripThink('reasoning leaked here</think>hey! im in leeds'), 'hey! im in leeds');
  assert.equal(stripThink('hi <think>unfinished'), 'hi ');
  assert.deepEqual(bubblesOf('lol no, just tired\n\nbeen pulling shots since 6am\n\nhow is your day going?'), [
    'lol no, just tired',
    'been pulling shots since 6am',
    'how is your day going?',
  ]);
  assert.deepEqual(bubblesOf('  <think>x</think>  one line  '), ['one line']);
  assert.deepEqual(bubblesOf(null), []);
  assert.equal(contentOfResponse(read('response.json')), 'Tallinn, friend—lovely little capital by the sea!');
});
