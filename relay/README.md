# Realsies relay

Node service for the Realsies E2E test variant: HTTP API and WebSocket on one port (3960), the
round scheduler, matchmaking, two-minute chats, bots on NEAR AI Cloud enclave models with every
completion's exact bytes and signature kept, chain integration on NEAR testnet (operator, faucet,
promo and test-user keys), scoring and rating, verification bundles, persistence, and static
hosting of `../web/dist`. Spec: `docs/spec.md` sections 2 to 4 (v1.1). Protocol: `shared/protocol.ts`.

## Run

```
cd relay
npm install
npm run dev          # tsx watch src/index.ts, http://localhost:3960
npm run build        # esbuild -> dist/index.js (plain ESM, Node 22.13+)
npm start            # node dist/index.js
npm test             # unit + integration tests (mock chain, mock NEAR AI signer; no credits, no testnet)
npm run e2e          # the scenario against testnet; spawns a relay if none answers on RELAY_URL
npm run typecheck
```

With `relay/.secrets/testnet.json` present the relay talks to `game.realsies.testnet`; without it,
it runs on an in-memory mock chain with the same rules (snapshotted to the DB). Node 22 prints an
ExperimentalWarning for `node:sqlite`; that is expected.

## Environment

Read from the process env, then the repo-root `.env`, then `relay/.env` (never overriding).

| Var | Default | Notes |
|---|---|---|
| `PORT` | 3960 | HTTP and `/ws` |
| `TEST_MODE` | 1 | test-user screen, faucet, dev endpoints, all levels unlocked |
| `ROUND_MINUTES` / `CHAT_SECONDS` / `CALL_SECONDS` | 10 / 120 / 20 | |
| `FREE_CHATS_PER_DAY` | 0 | 0 = unlimited |
| `NEAR_AI_API_KEY` | | from the repo-root `.env` |
| `NEAR_AI_BASE` | https://cloud-api.near.ai/v1 | |
| `NEAR_AI` | auto | `real`, `mock`, or `auto` (real only when a key is set and the chain is real, so mock-chain dev never spends credits) |
| `SECRETS` | relay/.secrets/testnet.json | relative paths resolve from the repo root |
| `CHAIN` | auto | `near`, `mock`, or `auto` (near when the secrets file exists) |
| `DB` | relay/data/realsies.db | one SQLite file |
| `SKIN_SECRET` | random, stored in the DB | seat skin seeds |
| `USD_PER_COIN` | 0.01 | display constant |
| `WEB_DIST` | web/dist | static app; SPA fallback to index.html |
| `PERSONAS` | relay/personas | |
| `BOT_TIME_SCALE`, `SEARCH_MIN_SECONDS`, `SEARCH_MAX_SECONDS`, `PARTNER_LEFT_SECONDS`, `DEV_CALL_SECONDS`, `LOG_LEVEL` | 1, 2.5, 6, 15, 10, info | timing knobs for tests |

## Architecture

| File | Role |
|---|---|
| `src/index.ts`, `src/app.ts` | entry point and wiring |
| `src/server.ts` | HTTP routes, `/ws` upgrade (test users only), heartbeat, static files |
| `src/game/game.ts` | the engine: rounds, characters, commits, matchmaking, chats, calls, settlement, results, views |
| `src/game/bot.ts` | one bot side: opener 4 to 12 s, debounce 0.8 to 2.5 s, model call, typing 45 ms/char (1 to 7 s), bubbles per line, signature verified before display, final "seal" completion for paid chats |
| `src/game/results.ts` | ratings, coins deltas from chain plays, would-have, Turing and locked bonuses |
| `src/game/bundle.ts` | `VerifyBundle` per bot chat; the proof is the chat's last signed completion |
| `src/chain/near.ts` | near-api-js 7.4 adapter; one serial queue per key; signs once and resends the same bytes on 429 or network errors; re-signs on expiry or nonce errors; RPC failover |
| `src/chain/mock.ts` | in-memory contract with the same rules and error strings (replays the contract's own full-round test to the exact balances) |
| `src/nearai/client.ts`, `verify.ts` | attestation (nonce = round secret_hash), completions with exact bytes, signatures with retries; EIP-191 recovery, report_data binding, think-stripping |
| `src/formats.ts`, `settlement.ts`, `scoring.ts` | spec section 3 strings, contract settlement math, rating rules |
| `src/models.ts` | per-model request options (reasoning off) and prices |
| `personas/*.json` | 15 personas; `prompt` is the exact message 0 committed by sha256 |

Round lifecycle: start (secret, `start_round`, attestation per persona model, one bot character per
persona per level, `commit_characters` FINAL) -> humans committed on first connect (batched) ->
accepting until `endsAt - CHAT - CALL - 15 s` -> at `endsAt` the next round starts and the old one
settles in the background: wait for calls, `reveal_round` after `endsAt + 60 s`, wait for bot
signatures, `open_characters` (bots: one proof per paid viewer; humans: paid viewers; everyone else
with empty lists), `settle_round`, results from `get_round_plays`, ratings, bundles, `results_ready`.
`POST /api/dev/end-round` ends chats with a 10 s call window, waits for calls, `end_round_now`, then
the same path.

Bots: request = `{model, messages, stream: false, max_tokens: 120, ...reasoning option}`, message 0
the persona prompt, message 1 `Your gamertag in this chat is {name}; the game generated it, you did
not choose it. Game record: {tag}.` (tag = first 16 hex of the viewer's handle), then the transcript
as shown (one assistant turn per completion, its think-stripped trimmed content). Shown bubbles are
that content split on newlines, empty lines dropped; nothing is shown until its signature verifies.
When a paid chat ends with player lines not covered by a signed request, one more completion is made
and not shown, so the on-chain proof carries the whole transcript.

Reasoning off (measured with `tools/probe-nearai.mjs`): GLM 5.3 Flash `reasoning_effort: "low"`
(0 to 6 reasoning tokens, about 1 s), DeepSeek V4.1 Flash `chat_template_kwargs.enable_thinking:
false` (0 tokens, 1 to 2 s). Qwen 3.8 and 3.6 reject a second system message, so no persona uses them.

Extra fields beyond `shared/protocol.ts` (optional, backward compatible): `VerifyBundle` carries
`proofCompletionIndex`, `openReport` and `relayChecks`; HTTP error bodies are `{error, code, message}`;
a fresh `room` is pushed to each connection's last entered level when a new round starts;
`GET /api/dev/state` and `GET /api/health` exist for diagnostics.

## Tests

`npm test` (30 tests, about a minute, no network): formats byte for byte against
`contracts/game/tests/vectors.json`; the real enclave signature and attestation in
`experiments/near-ai/evidence/2026-11-04/`; settlement math with the contract's two-step rounding;
the mock chain replaying the contract's `full_round_settles_exactly` to the same balances; and three
in-process relay runs on the mock chain (the full scenario; natural round end with a seal completion
as the proof and silent model failures; partner_left, reload resume, input errors).

`npm run e2e` (about two minutes on testnet): human-human chat with one paid and one free side, a paid
and a free bot chat on NEAR AI, calls, dev end-round, settlement, results checked against
`get_round_plays` and `balance_of`, the locked Turing bonus paid from promo on the next deposit, and a
bundle verified with independent sha256, keccak and secp256k1 code. Passed on 2026-11-04 in rounds 2
(86 checks) and 5 (85 checks); reports in `relay/data/e2e-report-*.json`.
