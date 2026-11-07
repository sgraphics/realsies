# Realsies relay

Node service for the Realsies E2E test variant: HTTP API and WebSocket on one port (3960), the
round scheduler, matchmaking, two-minute chats, bots on NEAR AI Cloud enclave models with every
completion's exact bytes and signature kept, chain integration on NEAR testnet (operator, faucet,
promo and test-user keys), scoring and rating, verification bundles, persistence, and static
hosting of `../web/dist`, the AI builders API (access requests, botmasters, their agents' stats and
transcripts, their own NEAR AI keys; `docs/agents.md`), and wallet sign-in: NEP-413 sessions, the browser's
play key, plays and calls signed in the browser and checked here, deposits through the wallet (`docs/spec.md`
section 7), and the launch of REAL and the mainnet game (`LAUNCH_*`, `PublicConfig.launch`: the coming-soon page, then the auction banner). Spec: `docs/spec.md` sections 2 to 4 and 7 (v1.3). Protocol: `shared/protocol.ts` (v1.4).

## Run

```
cd relay
npm install
npm run dev          # tsx watch src/index.ts, http://localhost:3960
npm run build        # esbuild -> dist/index.js (plain ESM, Node 22.13+)
npm start            # node dist/index.js
npm test             # unit + integration tests (mock chain, mock NEAR AI signer; no credits, no testnet)
npm run e2e          # the scenario against testnet; spawns a relay if none answers on RELAY_URL
                     # (never spawn one on game.realsies.testnet: the server is its only operator; use
                     #  RELAY_URL=https://realsies.lol, or SECRETS/E2E_USERS of a throwaway deployment)
npx tsx tools/wallet-proof.ts   # wallet sign-in and the play key on testnet (PLAYER=..., a throwaway relay)
npm run typecheck
npm run botmaster-admin -- requests   # AI builders: access requests, botmasters, personas (tools/botmaster-admin.ts)
```

With `relay/.secrets/testnet.json` present the relay talks to `game.realsies.testnet`; without it,
it runs on an in-memory mock chain with the same rules (snapshotted to the DB). Node 22 prints an
ExperimentalWarning for `node:sqlite`; that is expected.

## Environment

Read from the process env, then the repo-root `.env`, then `relay/.env` (never overriding).

| Var | Default | Notes |
|---|---|---|
| `PORT` | 3960 | HTTP and `/ws` |
| `TEST_MODE` | 1 | test-user screen, faucet (test users, 20 calls per IP per 10 minutes), dev endpoints, relay-signed test users, all levels unlocked; wallet sign-in works too; on testnet the airdrop (100 test tokens per tap: a wallet's own wallet, a test user's game balance; one per account per 10 minutes, none at 50 or more held; `docs/spec.md` section 7). `0`: wallet accounts only (mainnet), no test users, no dev endpoints, no faucet, no airdrop |
| `AUTH_RECIPIENT` | realsies.lol | NEP-413 recipient every sign-in signature must name: the domain the players see (a testnet relay moved to testnet.realsies.lol says so here) |
| `SESSION_DAYS` | 30 | a wallet session lives this long |
| `BUY_URL` | | "Buy REAL": the meme.cooking page before the launch finalizes, the Rhea swap after; unset = no link |
| `LAUNCH_AUCTION_START`, `LAUNCH_AUCTION_END` | | the launch (protocol v1.4, `PublicConfig.launch`): REAL's meme.cooking auction, which opens with the mainnet game; ISO times with their zone (`2026-11-08T15:00:00Z`), the end defaulting to 24 hours after the start. Setting any `LAUNCH_*` turns it on. Until the start `/` is the coming-soon page (a countdown to the start and "Get REAL"; the game at `/play`); at the start the page hands over to the game in place, and from then `/` is the game with a banner: "REAL auction is live, ends in hh:mm, Get REAL", after the end "REAL is finalizing, coins open soon". Once the coin is set on the contract (`coinsOpen`, re-read every minute) the relay drops `launch`, pushes the config to every socket and the banner goes, no restart. Ignored with `TEST_MODE=1`: the testnet demo never shows any of it. A bad value stops the relay at boot |
| `LAUNCH_TOKEN_URL` | `BUY_URL` | "Get REAL" (https): the meme.cooking page of REAL, on the coming-soon page (meme.cooking shows its own countdown before the auction) and in the banner; unset and no `BUY_URL`: the page shows the start time instead |
| `LAUNCH_VIDEO_URL` | | the launch tweet with the trailer: the coming-soon page's video card (a silent teaser loop, `web/public/launch-teaser.mp4`, under a big PLAY icon) opens it in a new tab. An https link on x.com or twitter.com |
| `LAUNCH_X_URL` | | the game's X account (`https://x.com/realsieslol`): where the video card goes until `LAUNCH_VIDEO_URL` is set ("Follow @realsieslol on X"); neither set: no card. An https link on x.com or twitter.com. `LAUNCH_DEMO_URL`, `LAUNCH_TRAILER` and `LAUNCH_POSTER` are no longer read (the relay warns when one is set) |
| `PLAY_KEY_ALLOWANCE_NEAR` | 0.25 | gas allowance of the play key a browser asks its wallet to add |
| `PLAY_GAS_TGAS` | 30 | prepaid gas of each browser-signed play and call (only burnt gas is charged; a play burns about 3 Tgas) |
| `SIGN_TIMEOUT_SECONDS` | 20 | a browser has this long to sign a play or call (`sign_tx`); then the play goes free |
| `MOCK_WALLETS` | | `1` on a keyless dev relay (mock chain): any key a real wallet signs with counts, so a wallet works locally |
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
| `BOTMASTERS` | relay/botmasters | remote-brain registrations by hand (`<name>.json`: name, tokenSha256, personas, payoutAccount?); none by default. Approved AI builders live in the DB (`docs/agents.md`) |
| `ADMIN_TOKEN` | | Bearer token of `/api/admin/*` (16+ characters); unset = admin endpoints answer `403 admin_disabled` |
| `RELAY_ENCRYPTION_KEY` | | 32 bytes, 64 hex or base64 (`openssl rand -hex 32`): seals botmasters' own NEAR AI keys (AES-256-GCM); unset = own keys refused (`503 byok_disabled`) |
| `AGENT_REQUEST_WEBHOOK` | | every access request is POSTed here as JSON (with Slack `text` and Discord `content`) |
| `AGENT_NOTIFY_EMAIL`, `AGENT_NOTIFY_FROM`, `NOTIFY_OUTBOX` | | operator emails for every access request and every persona to review (`src/agents/notify.ts`): queued as files in the outbox, sent through Amazon SES by the root-only `deploy/realsies-mail.py`; off unless the address is set |
| `AGENT_REQUESTS_PER_HOUR` | 5 | access requests per IP per hour |
| `NEAR_AI_BUDGET_USD` | 10 | the relay's own key: 80% of the estimated spend warns in the log, `/api/health` `ai.status` `low_credit` (spend in `GET /api/admin/health`) |
| `NEAR_AI_RECHECK_SECONDS` | 180 | a key out of credits is retried with a one-token completion this often; any success recovers it |
| `REMOTE_SILENCE_SECONDS` | 20 | a remote brain silent this long is replaced by the default brain |
| `PRUNE_DELAY_SECONDS` | 300 | `prune_round` a settled round this long after its results, ratings and bundles are stored |
| `IDLE_MINUTES` | 10 | no human connected this long: no new round (no `start_round`, no commits) until one connects; 0 = never idle |
| `DEV_TRACES` | 0 | 1 serves `/api/dev/bot-trace/:chatId` before the round settles (tests only: a trace names the persona) |
| `BOT_TIME_SCALE`, `SEARCH_MIN_SECONDS`, `SEARCH_MAX_SECONDS`, `PARTNER_LEFT_SECONDS`, `DEV_CALL_SECONDS`, `LOG_LEVEL` | 1, 2.5, 6, 15, 10, info | timing knobs for tests |

## Architecture

| File | Role |
|---|---|
| `src/index.ts`, `src/app.ts` | entry point and wiring |
| `src/server.ts`, `src/http.ts` | HTTP routes, `/ws` upgrade (a wallet session's one-time ticket, or a test user by name in test mode), who may act as an account (a test user, or a session of that account), the wallet routes, `/bot/ws` (remote brains), heartbeat, static files; JSON, body, bearer and client-IP helpers |
| `src/auth/nep413.ts` | NEP-413 payloads (borsh with the 2^31+413 tag), ed25519 verification, the signature encodings wallets use (base64, base64url, `ed25519:` base58, hex), account id rules |
| `src/auth/service.ts` | sign-in: one-use 32-byte nonces, the signature for `AUTH_RECIPIENT`, `view_access_key` must say FullAccess; sessions (table `sessions`, token sha256 only), one-time WebSocket tickets, sign-out; the browser's play key checked on chain (the game contract, exactly `play` and `call`) and kept on the session |
| `src/auth/tx.ts` | the transaction a browser is asked to sign (`sign_tx`) and the check of what comes back: byte for byte that transaction, canonical, under the play key's ed25519 signature |
| `src/agents/` | AI builders (`docs/agents.md`): `store.ts` the tables (access requests, DB botmasters with token sha256 only, personas, sealed keys, settled chat records), `api.ts` the HTTP API (`/api/agents`, `/api/admin`, `/api/botmaster`), `admin.ts` operator actions shared with `tools/botmaster-admin.ts`, `validate.ts` input checks and the model check against `/v1/models`, `stats.ts` the settled chat records (anonymised players, the chat's share of the Turing bonus from chain plays) and scorecards, `byok.ts` botmasters' own NEAR AI keys, `persona.ts` an approved persona as a round persona |
| `src/nearai/credits.ts` | spend per key from `usage` times price, the house budget, credit-failure detection (402; 400 or 403 about credits, balance, quota or billing; 401; never 429 or 5xx), keys out of credits, one-token rechecks, recovery; `TrackedAi` wraps a client |
| `src/secretbox.ts` | AES-256-GCM sealing with RELAY_ENCRYPTION_KEY, bound to the owner |
| `src/game/game.ts` | the engine: rounds, characters, commits, matchmaking, chats, calls, settlement, results, views |
| `src/bot/api.ts` | the bot engine's public API (`realsies-brain/1`): events, actions, intents, limits, remote wire format; docs in `docs/bot-api.md` |
| `src/bot/intents.ts` | steering catalogue `steer-v1`: 39 fixed strings, append-only (the first 37 are the 2026-11-04 ones, byte for byte), one appended per say; parsing of intents from untrusted JSON |
| `src/bot/language.ts`, `lexicon.ts` | the language of each player line (`player_message.lang`), only when clearly not English: other scripts by their letters, Latin script by word lists of about 20 languages with an English guard; who reads what |
| `src/bot/brain.ts` | the default brain: RxJS over a pure reducer, tick-driven; 50/50 probe vs answer, 70/30 direct vs out of order, reading pauses, silence, double texts, fake typing, cancels; `foreign` for a line in a language the persona does not read |
| `src/bot/session.ts` | one bot side: runs a brain, enforces the limits, typing at 4 to 6 cps with the model call hidden inside, signature verified before display, history in generation order, drafts, flush at the end, the seal for paid chats, fallback from a remote brain |
| `src/bot/typing.ts`, `rng.ts`, `clock.ts` | human timing (typing, reading, bubble schedule), seeded randomness, real and virtual clocks |
| `src/bot/remote.ts` | botmaster registry (files and DB, read on every use), `/bot/ws` auth (token sha256), per-chat event routing, disconnect signalling, kick on rotate or revoke, token re-check at every heartbeat |
| `src/game/results.ts` | ratings, coins deltas from chain plays, would-have, Turing and locked bonuses |
| `src/game/bundle.ts` | `VerifyBundle` per bot chat; the proof is the chat's last signed completion |
| `src/chain/near.ts` | near-api-js 7.4 adapter; one serial queue per key; signs once and resends the same bytes on 429 or network errors; re-signs on expiry or nonce errors; RPC failover. Wallet players: `view_access_key`, player-signed bytes broadcast as is with `send_tx` (one at a time per player; a stale nonce, an expired block hash, an empty allowance or a deleted key come back as codes), transactions read back by hash (deposits), the coin's NEP-145 registration; the coin comes from the contract's `get_config` (mainnet: once set at the launch) |
| `src/chain/mock.ts` | in-memory contract with the same rules and error strings (replays the contract's own full-round test to the exact balances); access keys with NEAR's function-call rules (receiver, methods, no deposit, nonces, allowance), wallets' own deposits and withdrawals, registration on the coin, a contract without a coin (`coinsOpen`) |
| `src/nearai/client.ts`, `verify.ts` | attestation (nonce = round secret_hash), completions with exact bytes, signatures with retries; EIP-191 recovery, report_data binding, think-stripping |
| `src/formats.ts`, `settlement.ts`, `scoring.ts` | spec section 3 strings, contract settlement math, rating rules |
| `src/models.ts` | per-model request options (reasoning off) and prices |
| `src/persona/model.ts` | demo personas as attributes (age, gender, Myers-Briggs type, temperament, mood, home, English, languages, job, family, scenes, interests) and what follows from them: writing style, brain dials (chatty, fast, curious, guarded, drift), typing speed, the card revealed after settlement |
| `src/persona/prompt.ts` | the persona prompt (message 0) composed from the attributes plus the shared base rules, with the local time and scene of the round's start |
| `src/persona/languages.ts` | language codes and names, the languages paragraph of the prompt (the list, then: only these; anything else is not understood, translated, answered or written; English unless the partner writes in one of the others) |
| `src/persona/cast.ts` | a round's cast: a country per character from `COUNTRY_WEIGHTS` (US 33%, UK 12%, Canada, Australia, Ireland, New Zealand 14, Western and Northern Europe 25, Latin America 6, the rest 10), a free hand-written persona of that country half the time, else a generated one |
| `src/persona/generate.ts`, `data.ts` | the seeded generator of each round's fresh personas (deterministic per seed, index, country and start time) and its data: the country weights, places and time zones, cultures (laughter, slang, natural slips, names, food), the languages people know by culture, place, age and schooling, jobs by age, scenes by time of day |
| `src/personas.ts` | loads `personas/*.json`: attribute personas (demo bots, prompt composed per round) and prompt personas (remote brains) |
| `personas/*.json` | 15 hand-written demo personas as attribute sets with explicit `languages`; prompt, `typing.cps`, `traits` and `interests` are derived |
| `tools/persona-preview.ts` | prints generated people (or the folder, or `--cast` a full round cast) with cards, languages, dials, typing speed and a full prompt; `--mix N` the nationality mix over N rounds; no network |
| `tools/gen-steering.ts` | writes `shared/steering.ts` from the catalogue (`--check` only compares) |
| `examples/remote-brain.mjs` | a minimal remote brain (Node 22+, no dependencies) |
| `tools/mcp-botmaster.mjs` | stdio MCP server for botmasters: the bot API docs and a request-a-persona tool that files a pending request |
| `tools/botmaster-admin.ts` | the operator's command line on the DB: requests, approve or reject, botmasters, create, rotate, revoke, personas, approve, reject or disable; a token is printed once |
| `tools/wallet-proof.ts` | wallet sign-in and the play key end to end on testnet, against a relay on a throwaway deployment (it refuses `game.realsies.testnet` and `game.realsies.near`): the account's full-access key from the legacy keychain signs the NEP-413 sign-in, the near CLI does what a wallet popup would (AddKey, deposit, withdraw), the web app's encoder signs the play and the call; gas and allowance measured; a report in `data/` |

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

AI builders (`docs/agents.md`): an approved botmaster's personas play every round at each of their levels
like the remote-brain personas, the prompt committed by sha256 and the payout to the botmaster's account; at
settlement one record per chat of theirs is stored (`agent_chats`) with the player anonymised and the chat's
share of the bonus computed from `get_round_plays` before pruning. Matching skips characters of revoked
botmasters and disabled personas, and every bot whose NEAR AI key is out of credits (the relay's key, or the
botmaster's own). No bots, no new chats (`Game.chatsPaused`): while the relay's key is out, or no bot at a
level can talk, no new chat starts there, human to human included, since such a match would be known to be
human; `pick_seat` gets `bots_unavailable` at once ("The bots are napping..."), a search under way ends the
same way, chats already running finish, and matching resumes when the key recovers. A chat matched before the
pause (or a bot chat whose key died) but not started yet never starts (`bots_unavailable`, `chat_ended`,
`call_missed` to every side; its play is in no opening, so it is refunded; no rating change). `GET /api/health`
carries `ai: {status, since}` for the relay's key; spend, budget and the reason are in `GET /api/admin/health`.

Wallet sign-in is part of `shared/protocol.ts` v1.3: `PublicConfig.coinsOpen`, `buyUrl`, `tokenDecimals`, `wallet`; `Me.kind`;
`AuthChallenge`, `AuthProof`, `AuthSession`, `PlayKeyInfo`, `WalletInfo`, `SignRequestTx`; `sign_tx`, `config`, `signed_tx`,
`sign_declined`; the optional `GameClient` methods.

Extra fields beyond `shared/protocol.ts` (optional, backward compatible): `PersonaCard` carries `name` and
`mood`; `ChatResult` and `VerifyBundle` carry `botmaster` for an AI builder's agent; `VerifyBundle` carries
`proofCompletionIndex`, `openReport`, `relayChecks` (with `steeringOk`) and `steering`; HTTP error bodies are `{error, code, message}`;
a fresh `room` is pushed to each connection's last entered level when a new round starts;
`GET /api/dev/state`, `GET /api/dev/bot-trace/:chatId?account=` (test mode, the viewer, after the round settles) and `GET /api/health` exist for
diagnostics; `GET /api/bot/steering` publishes the steering catalogue and its sha256.

## Mainnet relay (not running yet)

Same code with `TEST_MODE=0`. It needs, next to the testnet relay (its own unit, port, DB and secrets):

| Env | Value |
|---|---|
| `TEST_MODE` | `0` |
| `SECRETS` | `relay/.secrets/mainnet.json` (shape below) |
| `DB` | its own file, for example `relay/data/mainnet.db`: never the testnet DB |
| `PORT` | its own port if it runs next to the testnet relay, for example 3962 |
| `AUTH_RECIPIENT` | `realsies.lol` (and `testnet.realsies.lol` on the testnet relay once it moves there) |
| `ROUND_MINUTES`, `FREE_CHATS_PER_DAY` | 360 and 3 |
| `BUY_URL` | the meme.cooking page of REAL now; the Rhea swap after the launch finalizes (a restart) |
| `LAUNCH_AUCTION_START` (`LAUNCH_AUCTION_END` if not 24 hours), `LAUNCH_TOKEN_URL`, `LAUNCH_X_URL`, then `LAUNCH_VIDEO_URL` once the launch tweet is up (a restart) | the coming-soon page at `/` until the start (the game at `/play`), then the game with the auction banner until the coin is set. In `.env.mainnet`, and realsies.lol pointed at this relay: a test relay ignores them |
| `NEAR_AI_API_KEY`, `NEAR_AI_BUDGET_USD`, `ADMIN_TOKEN`, `RELAY_ENCRYPTION_KEY` | as on testnet; its own NEAR AI budget |
| `CHAIN` | `near` (or `auto` with the secrets file present) |

`relay/.secrets/mainnet.json` (mode 600, never in git):

```json
{
  "network": "mainnet",
  "rpc": ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
  "contractId": "game.realsies.near",
  "tokenDecimals": 18,
  "operator": { "accountId": "ops.realsies.near", "privateKey": "ed25519:<function-call key on game.realsies.near: start_round, commit_characters, reveal_round, open_characters, settle_round, prune_round>" },
  "promo": { "accountId": "promo.realsies.near", "privateKey": "ed25519:<function-call key on game.realsies.near: transfer>" },
  "accounts": { "fund": "fund.realsies.near", "house": "house.realsies.near", "bots": "bots.realsies.near" }
}
```

No `faucet` and no `testUsers` (ignored anyway without test mode). `tokenId` may stay out: the relay reads the coin from
the contract's `get_config`, so until the owner calls `set_token` and `set_coin_unit` the game is free play only
("Coins open when REAL launches") and within a minute of them coins open everywhere, no restart. At the launch, also
register `game.realsies.near` on the REAL token (`storage_deposit`, or deposits fail), and fund, house, promo and bots
if they will ever withdraw. ops and promo need a little NEAR for gas; players pay their own plays, calls, deposits and
withdrawals. The relay never holds a player's key.

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

AI builders and credits (`test/agents-unit.test.ts`, `test/agents.test.ts`): sealing (round trip, wrong key,
another owner, a changed byte), credit-failure detection, the credit monitor (spend, 80% budget, out, rechecks,
recovery, restarts), input validation and the model check, the scorecard and the bonus split against the
contract's settlement, anonymous ids; then in-process relays: access requests (receipt, webhook, per-IP limit),
admin off without `ADMIN_TOKEN`, approval over HTTP and on the command line with the relay running, tokens shown
once and stored as sha256, rotate and revoke cutting `/bot/ws`, a persona from submission (enclave models only)
to approval, its characters committed with the botmaster's payout, chats on its own key only, settled chats with
anonymous players, stats, the export, the bonus on chain, its key out of credits taking only its personas out;
the relay's key at HTTP 402: `bots_unavailable` at once, no human-to-human match either, running chats finish,
chats matched before the pause never start (human and bot, plays refunded, no rating change), recovery by the
recheck resumes matching; a level whose only bot is on an empty key paused on its own; a 429 saying "quota
exceeded" never marks a key out; public health without spend, admin health with it.

Wallet sign-in (`test/wallet-unit.test.ts`, `test/wallet.test.ts`): NEP-413 against near-api-js's own `signNep413Message`
with keys made in the test (byte for byte the same signature; a wrong recipient, message, nonce, callback URL or key fails;
every encoding wallets use); the sign-in service (reused, unknown and expired nonces, a nonce spent by a failed attempt, a
function-call key, a key that is not the account's, a forged claim); sessions (token sha256 only, expiry, sign-out, one-time
and short-lived tickets); play keys (exactly play and call on the game contract; any-method, withdraw, transfer, another
contract or a full-access key refused); client-signed transactions (the web app's encoder equal to near-api-js byte for byte;
another signer, key, receiver, method, coins, handle, extra argument, reordered JSON, deposit, gas, nonce, block hash, a
spliced or flipped signature, two actions or an AddKey refused); mainnet secrets without faucet, test users or coin; the mock
chain's access-key rules. Then in-process relays: without test mode (no test users, dev endpoints or faucet; sign-in over
HTTP; my coins need my session; a ticketed socket; a wallet deposit counted once with the locked bonus; a paid chat whose
play and call the browser signs, on chain as the player's own; a tampered and a declined signature going free; the round
settling on its own with the player's results; sign-out closing the socket); before the coin exists (free play only, the
coin showing up pushed to every socket); and test mode (a wallet account next to the test users, browser-signed plays only;
the airdrop: 100 into the wallet itself, registered on the coin, a second at once refused with `retryAt`, the old wallet faucet
route refused the same way, still none ten minutes on while wallet plus game hold 100, the test users' faucet refused to a
wallet account; a test user's airdrop straight into its game balance, open again ten minutes on under 50, none at 130).

The launch (`test/launch.test.ts`): `LAUNCH_*` into `PublicConfig.launch` (nothing set, the 24-hour end, every field, the X links, the retired
variables read no more), the checks that stop a bad value at boot (a time without its zone, an end before the start or without one, X links not on X,
a token page that is not https); then in-process relays: without test mode `launch` is in `/api/config` and the welcome until the
coin is set, then dropped from both and pushed to every socket; a test relay never sends it, not even with no coin on the contract; no
`LAUNCH_*`, no `launch`; `/play` is the app's `index.html` like `/`.

`npx tsx tools/wallet-proof.ts` (testnet, a throwaway deployment; 2026-11-05 on `game.rlzw-134fbb.testnet` with its own coin
`token.rlzw-134fbb.testnet`): passed in about a minute: the sign-in, a replayed sign-in refused, the AddKey, the relay's
check of the key, the faucet into the wallet, the deposit, the play and the call signed by the browser's key and on chain as
the player's, NEAR itself refusing a `withdraw` signed with the play key (MethodNameMismatch), settlement, the withdrawal and
sign-out. A play burnt 3.02 Tgas (0.000279 NEAR), a call 2.47 Tgas (0.000224 NEAR), and the key's allowance dropped by
exactly what was burnt; a separate probe sent the same call at 10, 30 and 100 Tgas prepaid and was charged the same.
`npm run e2e` against a local relay on that deployment (its own test users) passed with 101 checks in round 3.

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
