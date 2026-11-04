// Per-model request options and prices for the NEAR AI enclave models (owner "nearai" in /v1/models).
// Measured 2026-11-04 with tools/probe-nearai.mjs (max_tokens 120, short chat):
//   z-ai/glm-5.3-flash: default reasoning eats all 120 tokens (content null). reasoning_effort "low"
//     gives clean content with 0 to 6 reasoning tokens, 0.8 to 1.4 s. chat_template_kwargs.enable_thinking
//     false leaks the reasoning into content ending in "</think>"; thinking.type "disabled" still reasons.
//   deepseek-ai/DeepSeek-V4.1-Flash-1017: chat_template_kwargs.enable_thinking false gives 0 reasoning
//     tokens, 0.8 to 2 s. Default reasons (~70 tokens).
//   Qwen/Qwen3.8-27B and Qwen/Qwen3.6-35B-A3B-FP8: HTTP 400 "System message must be at the beginning":
//     their chat template rejects a second system message, which spec message 1 requires. Not usable.
// Signatures (GET /v1/signature/{id}?signing_algo=ecdsa) were available on the first try (~150 ms).

export interface ModelInfo {
  id: string;
  /** Extra request fields appended after model, messages, stream, max_tokens. */
  request: Record<string, unknown>;
  /** USD per million tokens. */
  price: { input: number; output: number };
  /** Accepts two system messages in a row (required by the spec's message 0 and message 1). */
  multiSystem: boolean;
}

export const MODELS: Record<string, ModelInfo> = {
  'z-ai/glm-5.3-flash': {
    id: 'z-ai/glm-5.3-flash',
    request: { reasoning_effort: 'low' },
    price: { input: 0.08, output: 0.5 },
    multiSystem: true,
  },
  'deepseek-ai/DeepSeek-V4.1-Flash-1017': {
    id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    request: { chat_template_kwargs: { enable_thinking: false } },
    price: { input: 0.3, output: 1.2 },
    multiSystem: true,
  },
  'Qwen/Qwen3.8-27B': {
    id: 'Qwen/Qwen3.8-27B',
    request: { chat_template_kwargs: { enable_thinking: false } },
    price: { input: 0.04, output: 1.35 },
    multiSystem: false,
  },
  'Qwen/Qwen3.6-35B-A3B-FP8': {
    id: 'Qwen/Qwen3.6-35B-A3B-FP8',
    request: { chat_template_kwargs: { enable_thinking: false } },
    price: { input: 0.17, output: 1.1 },
    multiSystem: false,
  },
};

export const MAX_TOKENS = 120;

/** Typical two-minute chat: about 15k input and 1.2k output tokens with the growing history. */
export function chatCostUsd(model: string): number {
  const m = MODELS[model];
  if (!m) return Number.POSITIVE_INFINITY;
  return (15000 * m.price.input + 1200 * m.price.output) / 1e6;
}

export function modelInfo(model: string): ModelInfo {
  const m = MODELS[model];
  if (!m) throw new Error(`unknown model ${model}; add it to src/models.ts with its reasoning option`);
  return m;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Exact request bytes (as a UTF-8 string). Key order is fixed: model, messages, stream, max_tokens, options. */
export function buildRequest(model: string, messages: ChatTurn[]): string {
  const info = modelInfo(model);
  return JSON.stringify({ model, messages, stream: false, max_tokens: MAX_TOKENS, ...info.request });
}
