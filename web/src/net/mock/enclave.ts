// A simulated NEAR AI enclave for mock mode: a fixed secp256k1 key signs every completion the
// way the real enclave does (EIP-191 over "model:sha256(request):sha256(response)").

import type { SignaturePayload, VerifyCompletion } from '../../../../shared/protocol.ts';
import { addressOfSecretKey, sha256Hex, signEip191 } from '../../verify/crypto.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

const SK = sha256(utf8ToBytes('realsies mock enclave v1'));
const GW = sha256(utf8ToBytes('realsies mock gateway v1'));
export const MOCK_SIGNER = addressOfSecretKey(SK);
export const MOCK_GATEWAY = addressOfSecretKey(GW);

export interface Turn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function skinMessage(name: string, tag: string): string {
  return `Your gamertag in this chat is ${name}; the game generated it, you did not choose it. Game record: ${tag}.`;
}

/** Exact request bytes the relay would send. */
export function buildRequest(model: string, persona: string, skin: string, history: Turn[]): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: persona }, { role: 'system', content: skin }, ...history],
    stream: false,
    max_tokens: 120,
  });
}

export function buildResponse(id: string, model: string, content: string, createdMs: number, promptChars: number): string {
  const completion = Math.max(1, Math.round(content.length / 4));
  const prompt = Math.max(1, Math.round(promptChars / 4));
  return JSON.stringify({
    id,
    object: 'chat.completion',
    created: Math.floor(createdMs / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
  });
}

export function signCompletion(model: string, request: string, response: string): SignaturePayload {
  const text = `${model}:${sha256Hex(request)}:${sha256Hex(response)}`;
  return { text, signature: signEip191(text, SK), signing_address: MOCK_SIGNER, signing_algo: 'ecdsa', signature_kind: 'provider_tee' };
}

export function makeCompletion(index: number, id: string, model: string, request: string, content: string, at: number): VerifyCompletion {
  const response = buildResponse(id, model, content, at, request.length);
  return { index, completionId: id, request, response, signature: signCompletion(model, request, response), displayed: [], at };
}
