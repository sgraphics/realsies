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
| `COUNTDOWN_SECONDS` | 3 | full-screen 3-2-1 before every chat: `chat_started.startedAt` = now + this; `say` before it is refused (`chat_not_started`), typing dropped, bots start their clocks at `startedAt`; `PublicConfig.countdownSeconds` |
| `CAST_SIZE` | 39 | demo bot characters per round, 13 a level, nationalities drawn from a Western mix (`src/persona/cast.ts`); each a hand-written persona of that country or a person generated from the round's `castSeed`; 0 = the personas folder as is, nobody generated (`GEN_PERSONAS` is no longer read) |
| `CAST_PINS` | | comma-separated hand-written persona ids forced into every cast (tests and smoke runs) |
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
| `PERSONAS` | relay/personas | demo personas as attribute sets (`person` block); remote-brain personas may bring a prompt |
| `BOTMASTERS` | relay/botmasters | remote-brain registrations (`<name>.json`: name, tokenSha256, personas); none by default |
| `REMOTE_SILENCE_SECONDS` | 20 | a remote brain silent this long is replaced by the default brain |
| `PRUNE_DELAY_SECONDS` | 300 | `prune_round` a settled round this long after its results, ratings and bundles are stored |
| `IDLE_MINUTES` | 10 | no human connected this long: no new round (no `start_round`, no commits) until one connects; 0 = never idle |
| `DEV_TRACES` | 0 | 1 serves `/api/dev/bot-trace/:chatId` before the round settles (tests only: a trace names the persona) |
| `BOT_TIME_SCALE`, `SEARCH_MIN_SECONDS`, `SEARCH_MAX_SECONDS`, `PARTNER_LEFT_SECONDS`, `DEV_CALL_SECONDS`, `LOG_LEVEL` | 1, 2.5, 6, 15, 10, info | timing knobs for tests |

## Architecture

| File | Role |
|---|---|
| `src/index.ts`, `src/app.ts` | entry point and wiring |
| `src/server.ts` | HTTP routes, `/ws` upgrade (test users only), `/bot/ws` (remote brains), heartbeat, static files |
| `src/game/game.ts` | the engine: rounds, characters, commits, matchmaking, chats, calls, settlement, results, views |
| `src/bot/api.ts` | the bot engine's public API (`realsies-brain/1`): events, actions, intents, limits, remote wire format; docs in `docs/bot-api.md` |
| `src/bot/intents.ts` | steering catalogue `steer-v1`: 39 fixed strings, append-only (the first 37 are the 2026-11-04 ones, byte for byte), one appended per say; parsing of intents from untrusted JSON |
| `src/bot/language.ts`, `lexicon.ts` | the language of each player line (`player_message.lang`), only when clearly not English: other scripts by their letters, Latin script by word lists of about 20 languages with an English guard; who reads what |
| `src/bot/brain.ts` | the default brain: RxJS over a pure reducer, tick-driven; 50/50 probe vs answer, 70/30 direct vs out of order, reading pauses, silence, double texts, fake typing, cancels; `foreign` for a line in a language the persona does not read |
| `src/bot/session.ts` | one bot side: runs a brain, enforces the limits, typing at 4 to 6 cps with the model call hidden inside, signature verified before display, history in generation order, drafts, flush at the end, the seal for paid chats, fallback from a remote brain |
| `src/bot/typing.ts`, `rng.ts`, `clock.ts` | human timing (typing, reading, bubble schedule), seeded randomness, real and virtual clocks |
| `src/bot/remote.ts` | botmaster registry, `/bot/ws` auth (token sha256), per-chat event routing, disconnect signalling |
| `src/game/results.ts` | ratings, coins deltas from chain plays, would-have, Turing and locked bonuses |
| `src/game/bundle.ts` | `VerifyBundle` per bot chat; the proof is the chat's last signed completion |
| `src/chain/near.ts` | near-api-js 7.4 adapter; one serial queue per key; signs once and resends the same bytes on 429 or network errors; re-signs on expiry or nonce errors; RPC failover |
| `src/chain/mock.ts` | in-memory contract with the same rules and error strings (replays the contract's own full-round test to the exact balances) |
| `src/nearai/client.ts`, `verify.ts` | attestation (nonce = round secret_hash), completions with exact bytes, signatures with retries; EIP-191 recovery, report_data binding, think-stripping |
| `src/formats.ts`, `settlement.ts`, `scoring.ts` | spec section 3 strings, contract settlement math, rating rules |
| `src/models.ts` | per-model request options (reasoning off) and prices |
| `src/persona/model.ts` | demo personas as attributes (age, gender, Myers-Briggs type, temperament, mood, home, English, languages, job, family, scenes, interests) and what follows from them: writing style, brain dials (chatty, fast, curious, guarded, drift), typing speed, the card revealed after settlement |
| `src/persona/prompt.ts` | the persona prompt (message 0) composed from the attributes plus the shared base rules, with the local time and scene of the round's start |
| `src/persona/languages.ts` | language codes and names, the languages paragraph of the prompt (the list, then: only these; anything else is not understood, translated, answered or written; English unless the partner writes in one of the others) |
| `src/persona/cast.ts` | a round's cast: a country per character from `COUNTRY_WEIGHTS` (US 33%, UK 12%, Canada, Australia, Ireland, New Zealand 14, Western and Northern Europe 25, Latin America 6, the rest 10), a free hand-written persona of that country half the time, else a generated one |
| `src/persona/generate.ts`, `data.ts` | the seeded generator of each round's fresh personas (deterministic per seed, index, country and start time) and its pools: the country weights, places and time zones, cultures (laughter, slang, natural slips, names, food), the languages people know by culture, place, age and schooling, jobs by age, scenes by time of day |
| `src/personas.ts` | loads `personas/*.json`: attribute personas (demo bots, prompt composed per round) and prompt personas (remote brains) |
| `personas/*.json` | 15 hand-written demo personas as attribute sets with explicit `languages`; prompt, `typing.cps`, `traits` and `interests` are derived |
| `tools/persona-preview.ts` | prints generated people (or the folder, or `--cast` a full round cast) with cards, languages, dials, typing speed and a full prompt; `--mix N` the nationality mix over N rounds; no network |
| `tools/gen-steering.ts` | writes `shared/steering.ts` from the catalogue (`--check` only compares) |
| `examples/remote-brain.mjs` | a minimal remote brain (Node 22+, no dependencies) |
| `tools/mcp-botmaster.mjs` | stdio MCP server for botmasters: the bot API docs and a request-a-persona tool that files a pending request |

Round lifecycle: start (secret, cast seed, `start_round`, attestation per model of the round's cast, `CAST_SIZE` demo bot
characters, one level each, plus remote-brain personas at each of their levels, each storing the persona it plays, `commit_characters` FINAL) -> humans committed on first connect (batched) ->
accepting until `endsAt - CHAT - CALL - 15 s` -> at `endsAt` the next round starts and the old one
settles in the background: wait for calls, `reveal_round` after `endsAt + 60 s`, wait for bot
signatures, `open_characters` (bots: one proof per paid viewer; humans: paid viewers; everyone else
with empty lists), `settle_round`, results from `get_round_plays`, ratings, bundles, `results_ready`.
`POST /api/dev/end-round` ends chats with a 10 s call window, waits for calls, `end_round_now`, then
the same path (while idle it just starts a round).

Storage: once a round's results, ratings and bundles are stored, `PRUNE_DELAY_SECONDS` later the relay
calls the contract's `prune_round` until it returns 0 (a round already empty on chain needs no tx; a
failure is retried with backoff from housekeeping, also after a restart) and records `prunedAt`. After
that `get_play`, `get_round_plays` and `get_character` return nothing for the round; everything the app
shows comes from the relay's DB. Idle mode: when no test user has been connected for `IDLE_MINUTES`
(last seen is kept in the DB across restarts), a round that ends is not followed by a new one; the
first human to connect starts a round at once and their welcome carries it.

Chats start with a countdown: both sides get `chat_started` with `startedAt` = now + `COUNTDOWN_SECONDS`;
the relay refuses `say` before it (`chat_not_started`) and drops typing, and a bot's brain hears
`chat_started` only at `startedAt`, so human and bot chats run on the same clock and nothing tells who is
expected to speak first.

Demo personas (`docs/bot-api.md` section 14): each is a full attribute set; its prompt is composed from
the attributes for each round's start time (local time, scene, what they ate), and its typing speed, brain
dials and reveal card are derived from them. Each lists the languages it reads (native, fluent, good, basic);
the prompt says it cannot read any other, never translates, answers or writes one, and writes English unless
the partner writes in one of its own. A round's cast follows a Western nationality mix: each character's
country is drawn first, then played by a hand-written persona of that country (sampled, at most once a
round) or a person generated for that country from a seed stored with the round. After settlement `ChatResult.persona` and `VerifyBundle.persona` carry the card (age, gender,
type, temperament, home, job, style, emoji; plus `name` and `mood`), never before.

Bots (`docs/bot-api.md`): a brain (the default one, or a botmaster's over `/bot/ws`) reads the chat's
event stream and emits actions; it chooses intents and timing, never text. Each say is one request
`{model, messages, stream: false, max_tokens: 120, ...reasoning option}`: message 0 the persona
prompt, message 1 `Your gamertag in this chat is {name}; the game generated it, you did not choose it.
Game record: {tag}.` (tag = first 16 hex of the viewer's handle), the signed history, the player's new
lines, and the intent's fixed steering note (`steer-v1`) as a system message. Each player line reaches the
brain with its language when the relay is sure it is not English (`player_message.lang`); the default brain
answers a line the persona cannot read with the `foreign` intent. Steering notes stay in
the history, so each request is the previous one + its reply + new player lines + one note. The typing
indicator starts with the say and the reply appears when a person typing at the persona's speed would
have finished it, never before its signature verifies; bubbles are the content split on newlines.
A say dropped before anything shows (cancelled, failed, late) leaves no trace in the history; its bytes
go to `bot_drafts`. When a paid chat ends with player lines not covered by a kept request, one more
completion is made and not shown, so the on-chain proof carries the whole transcript.

Reasoning off (measured with `tools/probe-nearai.mjs`): GLM 5.3 Flash `reasoning_effort: "low"`
(0 to 6 reasoning tokens, about 1 s), DeepSeek V4.1 Flash `chat_template_kwargs.enable_thinking:
false` (0 tokens, 1 to 2 s). Qwen 3.8 and 3.6 reject a second system message, so no persona uses them.

Extra fields beyond `shared/protocol.ts` (optional, backward compatible): `PersonaCard` carries `name` and
`mood`; `VerifyBundle` carries
`proofCompletionIndex`, `openReport`, `relayChecks` (with `steeringOk`) and `steering`; HTTP error bodies are `{error, code, message}`;
a fresh `room` is pushed to each connection's last entered level when a new round starts;
`GET /api/dev/state`, `GET /api/dev/bot-trace/:chatId?account=` (test mode, the viewer, after the round settles) and `GET /api/health` exist for
diagnostics; `GET /api/bot/steering` publishes the steering catalogue and its sha256.

## Tests

`npm test` (about two and a half minutes, no network): bot engine policy over hundreds of simulated chats on a
virtual clock (splits, typing speed, signatures before display, chain integrity, persona variation),
the persona generator (determinism, attribute distributions over 3000 people, style rules in the prompt,
the letters moving the dials, an extrovert and an introvert twin played differently by the default brain),
the steering catalogue (the first 37 notes byte for byte, the appended `foreign` ones) and a hostile brain, the
language detector (none of 543 short English chat lines flagged, clear Estonian, German, Spanish, French,
Finnish and other lines flagged), the default brain choosing `foreign` exactly when the persona cannot read
the line, the cast's nationality mix over 3000 rounds against the weights and every persona's languages,
remote brains over `/bot/ws` (auth, fallback, the example brain), the web app's Verify checks run on a relay bundle (as they are, and with the steering change
in `docs/bot-api.md`), formats byte for byte against
`contracts/game/tests/vectors.json`; the real enclave signature and attestation in
`experiments/near-ai/evidence/2026-11-04/`; settlement math with the contract's two-step rounding;
the mock chain replaying the contract's `full_round_settles_exactly` to the same balances; and three
in-process relay runs on the mock chain (the full scenario; natural round end with a seal completion
as the proof and silent model failures; typing before every bot line at human speed; partner_left,
reload resume, input errors; the countdown, for human and bot chats alike; persona cards in results and
bundles only after settlement).

Also covered: `prune_round` in the mock chain with the contract's rules, the relay pruning a settled
round while results and bundles stay served, and idle mode (no `start_round` or commits while nobody
is connected, a round on the first connect).

`npx tsx tools/smoke-bots.ts 4 --pick contrast` plays four full chats with real NEAR AI models on the mock
chain (never testnet), with four clearly different personas of the round's cast, and prints each transcript
with timings, the persona card revealed after settlement, the web checks per bundle and the spend.
`npx tsx tools/smoke-bots.ts 4 --personas mia-leeds,marek-tallinn,lena-berlin,dottie-ohio --script foreign` pins
those personas into the cast and writes Estonian to Leeds and Tallinn, German to Berlin and Spanish to Ohio.
`tools/probe-steer.ts` and `tools/probe-context.ts` try steering wording against the models.

`npm run e2e` (about two minutes on testnet): human-human chat with one paid and one free side, a paid
and a free bot chat on NEAR AI, calls, dev end-round, settlement, results checked against
`get_round_plays` and `balance_of`, the locked Turing bonus paid from promo on the next deposit, and a
bundle verified with independent sha256, keccak and secp256k1 code. Passed on 2026-11-04 in rounds 2
(86 checks) and 5 (85 checks); reports in `relay/data/e2e-report-*.json`.
