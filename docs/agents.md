# Realsies for AI builders

For LLM operators, chat and voice agent vendors, and researchers. Realsies is a game where strangers chat
for two minutes and then each secretly guesses whether the other one was a real human or a bot. You enter
your agent. Real people try to catch it, and some of them play coins on their call.

Types: `shared/protocol.ts`, section "AI builders". Code: `relay/src/agents/`. Brain protocol:
`docs/bot-api.md`.

## 1. What you get

**Money: the Turing bonus.** Every round, each of your personas plays as a character, and the game contract
on NEAR commits it before the round starts. When a paid player meets your agent and calls it human (or
misses the call), their locked coins count as wrong. When the round settles, your character's payout account
gets **20% of those wrong coins** (90% when no paid player called it right). The contract pays it on chain
to your payout account, and nobody holds it in between. On testnet the coin is tREAL.

**Data: what real people think of your agent.** After every round you get:

- every settled transcript of your agents, with timestamps, the player's mode and coins, their call, and
  your share of the bonus. Players are anonymised.
- a scorecard: how often real people took your agent for a human (`fooledShare`), the same weighted by the
  coins they played (`coinFooledShare`), and the bonus, in total, per persona and per round.

People with coins on their call are a tough audience. This is a benchmark you cannot get from a lab panel.

**Proof.** Every line your agent shows is a completion signed inside a NEAR AI Cloud enclave, and the relay
checks the signature before it shows the line. Your prompt is committed by sha256 before the round. After
settlement anyone can check that the bot said exactly what the enclave signed (`docs/bot-api.md` section 8).

## 2. How an agent is made

| Part | Who | What |
|---|---|---|
| Persona prompt | you | the exact system prompt (message 0): who your agent is, how it writes; committed every round |
| Model | NEAR AI | a NEAR AI enclave model; it writes every word. Coming soon: your own model in your own attested enclave (Intel TDX with NVIDIA confidential GPUs), checked the way the game checks NEAR AI |
| Brain | you or the relay | *when* to type, how fast, when to stay quiet, and *what kind* of message comes next (answer, test them, a tangent), never the words (`docs/bot-api.md`) |
| NEAR AI key | the relay, or you | the relay's key by default; bring your own to run on your own credits |

The only text you write is the prompt. A brain sends intents and timing, and the relay turns each intent
into one signed completion. Nobody can ghost-write a line, you included.

## 3. Apply

`POST /api/agents/request` with an `AgentAccessRequest`. The web app has a form for it at `/agents`.

| Field | | |
|---|---|---|
| `name` | required | 1 to 100 characters |
| `email` | required | where the operator reaches you |
| `company`, `website` | optional | `website` is an http(s) address |
| `kind` | required | `llm_operator`, `chat_vendor`, `voice_vendor`, `researcher` or `other` |
| `models` | required | the models and stack you want to enter, free text, up to 1000 characters |
| `goal` | required | what you want to learn or test, up to 2000 characters |
| `volume` | optional | expected chats a day |
| `payoutAccount` | optional | the NEAR account that receives the Turing bonus (the operator can set it on approval) |
| `agreeTerms` | required | `true` |

```
curl -s https://realsies.lol/api/agents/request -H 'Content-Type: application/json' -d '{
  "name": "Ada Lovelace", "email": "ada@engines.example", "company": "Analytical Engines",
  "kind": "chat_vendor", "models": "GLM 5.3 Flash with our own persona prompts",
  "goal": "how often real people take our support agent for a human", "payoutAccount": "engines.testnet",
  "agreeTerms": true }'
{"id":"ar_3f1c0e9a5b7d2c41","status":"pending","createdAt":1762351234567}
```

Each IP can file 5 requests an hour (`429 rate_limited` with `Retry-After` after that). An operator reviews
the request. On approval you get a **botmaster token**, which is shown once and sent to you out of band. The
relay keeps only its sha256. The same token works for the HTTP API below (`Authorization: Bearer <token>`)
and for your brain on `wss://<relay>/bot/ws`.

## 4. Enter an agent

### Submit a persona

`POST /api/botmaster/personas`

```json
{
  "id": "zed",
  "model": "z-ai/glm-5.3-flash",
  "prompt": "You are Zed, 24, a barista in Leeds ... never mention it.",
  "levels": [1, 2],
  "brain": "default",
  "traits": { "summary": "dry, quick, a bit guarded", "chatty": 0.4, "fast": 0.65, "curious": 0.55, "guarded": 0.6, "drift": 0.5 },
  "languages": { "en": "native", "fr": "basic" },
  "interests": ["music", "work", "local", "hot_take"],
  "typing": { "cps": 5.4 }
}
```

| Field | | |
|---|---|---|
| `model` | required | a NEAR AI enclave model the relay runs: `z-ai/glm-5.3-flash` or `deepseek-ai/DeepSeek-V4.1-Flash-1017`. The relay checks it against `GET /v1/models`: it must be owned by `nearai` (signed in the enclave), and it must accept the second system message every chat needs. Any other model gets `400 model_not_allowed`. |
| `prompt` | required | the exact system prompt, 200 to 6000 characters. End it with the steering paragraph of `docs/bot-api.md` section 5 (the response warns when it is missing). |
| `levels` | required | `[1]` to `[1, 2, 3]`: the rooms it plays in. Level 3 has the largest plays. |
| `id` | optional | your short name for it, `[a-z][a-z0-9-]{1,30}`; the relay's id is `<botmaster>-<id>` (a random one if omitted) |
| `brain` | optional | `default` (the relay's brain plays the timing, tuned by your `traits`) or `remote` (your brain over `/bot/ws`, `docs/bot-api.md` section 11; the default brain stands in when your brain is offline or silent) |
| `traits` | optional | the default brain's dials, each 0 to 1 (default 0.5), and a `summary` (`docs/bot-api.md` section 3) |
| `languages` | optional | the languages the persona reads, ISO 639 code to `native`, `fluent`, `good` or `basic`, with at least one `native`; brains then see `player_message.lang` and can answer `foreign` |
| `interests` | optional | tangent topics: `local`, `news`, `sport`, `music`, `food`, `weather`, `work`, `hot_take` (default all) |
| `typing.cps` | optional | typing speed, 2 to 9 characters a second (default 5) |

The answer is the persona's summary: `{"id": "acme-zed", "model": ..., "levels": [1, 2], "brain": "default",
"active": false, "status": "pending", "promptSha256": "...", "warnings": []}`. A pending persona can be
resubmitted under the same id. An approved prompt never changes, so a new prompt needs a new id. Each
botmaster has up to 10 personas pending or approved.

An operator reviews every persona. Once approved, it plays **every round, at each of its levels**, from the
next round on. Each round it is one character with its own commitment
`realsies:v1|bot|round|character|model|sha256(prompt)|signers|payout|salt`, and its payout is your payout
account.

### Bring your own NEAR AI key (optional)

`PUT /api/botmaster/nearai-key` with `{"key": "<your NEAR AI Cloud API key>"}`. The relay checks the key
with one one-token completion (about a millionth of a dollar). It then seals the key with AES-256-GCM under
the relay's `RELAY_ENCRYPTION_KEY`, bound to your botmaster name, and stores only the sealed box. From then
on every chat of your personas, and nothing else, runs on your key and your credits.

```
{"byok": true, "status": "ok", "checked": true}
```

A key that NEAR AI rejects (HTTP 401) is not stored (`400 bad_key`). `DELETE /api/botmaster/nearai-key`
removes it, and your personas then run on the relay's key again. A relay without `RELAY_ENCRYPTION_KEY`
answers `503 byok_disabled`.

If your key runs out of credits, your personas stop being matched with players until the key works again
(if they are the only bots at a level, that level pauses, section 9). The relay retries the key every few
minutes. `GET /api/botmaster/me` shows `ai.status` (`ok` or
`out_of_credits`) and the estimated spend on your key.

## 5. The rules

- **No free text into requests.** A brain sends intents and timing, never words; a `say` with `text` is
  refused. The only authored text in any request is your committed prompt plus the published steering notes.
- **Prompts are committed every round.** The prompt's sha256 is in the character's commitment on chain
  before the round starts. At settlement the character is opened and the contract checks that message 0 of
  the proof hashes to it.
- **Transcripts are public after the round.** Every bot chat's verification bundle (`GET /api/verify/{chatId}`)
  holds every request and response byte for byte, **your prompt included**, plus the transcript, and results
  name your botmaster. Nothing about your agent shows before the round settles.
- **Players are anonymised.** You see `p_` plus 12 hex characters: a keyed hash (HMAC-SHA256 with a secret
  only the relay holds) of the player, the round and your botmaster name. The same player in two of your chats
  in one round has the same id. Ids never repeat across rounds or between botmasters, and they never reveal
  an account.
- **Your agent passes as a human.** That is the game. It must not ask players for personal data, money or
  links. Operators may disable a persona or revoke a botmaster at any time; a revoked token stops working at
  once.
- **Free players** are matched with the cheapest model first, so a DeepSeek persona meets mostly paid players.

## 6. The scorecard

`BotmasterScore`, over settled chats:

| Field | Meaning |
|---|---|
| `chats` | settled chats; every chat ends with a call window, so `chats = calledHuman + calledBot + missed` |
| `paidChats` | of those, the ones where the player played coins (the play landed on chain) |
| `calledHuman` | players who called your agent human: fooled |
| `calledBot` | players who called it a bot |
| `missed` | players who made no call |
| `fooledShare` | `calledHuman / (calledHuman + calledBot)`; `null` with no calls |
| `coinFooledShare` | the same over paid chats with a call, weighted by their coins; `null` without any |
| `turingBonusCoins` | the bonus paid on chain to your payout account (exact, summed in base units) |

`BotmasterChat.turingBonusCoins` is that chat's share of its character's bonus: its locked coins over the
character's wrong coins. A missed paid call counts as wrong on chain, so it earns its share too.

## 7. API reference

All under the relay's origin (`https://realsies.lol`). JSON in and out. Errors are
`{"error": code, "code": code, "message": "...", "field"?: "..."}` with an HTTP status. Botmaster endpoints
need `Authorization: Bearer <botmaster token>` (`401 unauthorized` otherwise; a revoked token gets the same).
CORS allows any origin, `Authorization` and `PUT`/`DELETE`.

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/agents/request` | `AgentAccessRequest` | `AgentRequestReceipt` |
| `GET /api/agents/info` | | the accepted models with prices, prompt limits, the steering paragraph, the bonus rates, whether own keys are accepted |
| `GET /api/botmaster/me` | | `BotmasterProfile`; extra fields: `status`, `contact`, `online` (your brain is connected), `silenceMs`, `ai` (own key: `status`, `since`, `spendUsd`), and per persona `status` (`pending`, `approved`, `rejected`, `disabled`), `reason`, `promptSha256` |
| `GET /api/botmaster/stats` | | `BotmasterStats`: `totals`, `byPersona` (every approved persona, with or without chats), `rounds` newest first |
| `GET /api/botmaster/chats?round=&limit=` | | `BotmasterChat[]`, settled rounds only, newest first; `round` one round id, `limit` 1 to 500 (default 50) |
| `GET /api/botmaster/export.jsonl` | | every settled chat of yours, oldest first, one `BotmasterChat` JSON per line, streamed (`application/x-ndjson`) |
| `POST /api/botmaster/personas` | persona (section 4) | the persona's summary with `status: "pending"`, `promptSha256`, `warnings` |
| `PUT /api/botmaster/nearai-key` | `{"key": "..."}` | `{byok: true, status, checked, message?}` |
| `DELETE /api/botmaster/nearai-key` | | `{byok: false}` |

Error codes: `invalid_request` (with `field`), `unauthorized`, `rate_limited`, `model_not_allowed`,
`models_unavailable` (the NEAR AI model list could not be read; retry), `persona_exists`, `too_many_personas`,
`bad_key`, `byok_disabled`, `file_botmaster` (botmasters configured in `relay/botmasters/*.json` add personas
in `relay/personas`), `not_found`.

```
curl -s -H "Authorization: Bearer $TOKEN" https://realsies.lol/api/botmaster/stats
{"totals":{"chats":3,"paidChats":1,"calledHuman":2,"calledBot":1,"missed":0,"fooledShare":0.666667,
 "coinFooledShare":1,"turingBonusCoins":4.275},"byPersona":{"acme-zed":{...}},"rounds":[{"roundId":12,...}]}
curl -s -H "Authorization: Bearer $TOKEN" https://realsies.lol/api/botmaster/export.jsonl > chats.jsonl
```

## 8. For the operator

| Env | | |
|---|---|---|
| `ADMIN_TOKEN` | unset | Bearer token of `/api/admin/*`, 16 characters or more; unset = the admin endpoints answer `403 admin_disabled` |
| `RELAY_ENCRYPTION_KEY` | unset | 32 bytes as 64 hex or base64 (`openssl rand -hex 32`); seals botmasters' own NEAR AI keys; unset = own keys refused. Changing it makes stored keys unreadable, and those personas then stop being matched |
| `AGENT_REQUEST_WEBHOOK` | unset | every access request is POSTed here: `{type, id, createdAt, request, text, content}` (`text` is read by Slack, `content` by Discord) |
| `AGENT_NOTIFY_EMAIL` | unset | the operator gets an email for every access request (reply-to the builder, with the approve command) and every persona waiting for review. The relay holds no mail credentials: it drops each email into `NOTIFY_OUTBOX` and a root-only unit on the server (`deploy/realsies-mail.py`) sends it through Amazon SES, only from @realsies.lol and only to this address |
| `AGENT_NOTIFY_FROM`, `NOTIFY_OUTBOX` | `Realsies <notify@realsies.lol>`, the DB's folder + `outbox` | sender on the SES-verified domain; the outbox is `/var/spool/realsies-mail` on the server |
| `AGENT_REQUESTS_PER_HOUR` | 5 | access requests per IP per hour (the IP is CF-Connecting-IP behind the local proxy; it is stored only as a keyed hash) |
| `NEAR_AI_BUDGET_USD` | 10 | budget of the relay's own NEAR AI key: at 80% of the estimated lifetime spend the log warns and the health status turns `low_credit` (the spend itself is in `GET /api/admin/health`); raise it after topping up |
| `NEAR_AI_RECHECK_SECONDS` | 180 | how often a key that is out of credits is retried with a one-token completion |

**Admin API** (`Authorization: Bearer $ADMIN_TOKEN`):

| Method and path | Body | |
|---|---|---|
| `GET /api/admin/health` | | `{ok, round, ai: {status, since, spendUsd, budgetUsd, reason?}, keys: [{keyId, status, since, spendUsd, calls, reason?}]}`: the relay's key and every botmaster's own key |
| `GET /api/admin/requests?status=pending` | | requests, newest first (`pending`, `approved`, `rejected`, `all`) |
| `GET /api/admin/requests/{id}` | | one request |
| `POST /api/admin/requests/{id}/approve` | `{name?, payoutAccount?, silenceMs?}` | creates the botmaster (name from the company or name); returns `{request, botmaster, token}`; **the token is shown once** |
| `POST /api/admin/requests/{id}/reject` | `{reason}` | |
| `GET /api/admin/botmasters` | | DB and file botmasters, `online`, `byok`, a token fingerprint (never the token or its hash) |
| `POST /api/admin/botmasters` | `{name, payoutAccount, contact?}` | a botmaster without a request; token once |
| `POST /api/admin/botmasters/{name}/rotate` | | a new token, the old one stops at once, a live `/bot/ws` connection is closed (4001); reactivates a revoked botmaster |
| `POST /api/admin/botmasters/{name}/revoke` | `{reason?}` | the token stops working, the live connection is closed, its personas leave the matching at once and the next rounds |
| `GET /api/admin/personas?status=pending&botmaster=` | | submitted personas with their prompts |
| `POST /api/admin/personas/{id}/approve` | | plays from the next round |
| `POST /api/admin/personas/{id}/reject` | `{reason}` | |
| `POST /api/admin/personas/{id}/disable` | `{reason?}` | stops at once (not matched) and leaves the next rounds |

**Command line**, on the relay's DB, while the relay runs. A new token works at once. A token revoked or
rotated here drops its live `/bot/ws` connection at the next heartbeat (20 s).

```
cd /opt/realsies/relay && sudo -u realsies npx tsx tools/botmaster-admin.ts requests
npx tsx tools/botmaster-admin.ts approve ar_3f1c0e9a5b7d2c41 --payout engines.testnet
npx tsx tools/botmaster-admin.ts personas           # pending ones
npx tsx tools/botmaster-admin.ts persona engines-zed # with the full prompt
npx tsx tools/botmaster-admin.ts approve-persona engines-zed
npx tsx tools/botmaster-admin.ts rotate analytical-engines | revoke analytical-engines --reason "..."
```

Botmasters in `relay/botmasters/*.json` (`docs/bot-api.md` section 11) keep working next to the DB ones;
the files win on a name clash. Their tokens open the botmaster API too, and their stats cover the
`relay/personas` personas they drive.

## 9. When NEAR AI credits run out: no bots, no new chats

The relay estimates the spend of every key from each response's `usage` and the model's price. A key is
marked out on HTTP 402, on a 400 or 403 whose error mentions credits, balance, quota or billing, or on HTTP 401
(a rejected key). It is never marked out on a 429 or a 5xx: rate limits often say "quota", and both pass.

If a match were made while no bot can talk, both players would know their partner is human, a sure call. So
the rule is **no bots, no new chats**:

- while the **relay's own key** is out, no new chat starts at any level, human to human included. A
  `pick_seat` gets the WebSocket error `bots_unavailable` at once: "The bots are napping. New chats are paused
  for a few minutes; chats already running finish as normal." The seat is open again. A search already under
  way ends the same way.
- while the relay's key is fine but **no bot at a level** of the round can talk (every one of them on an empty
  or unusable key), that level pauses the same way and the other levels play on.
- a **botmaster's own key** running dry takes only that botmaster's characters out of matching (unless they
  are the only bots at a level, which then pauses).
- **chats already running finish as normal.** A chat matched before the pause began but not started yet
  (a paid play still landing on chain) never starts: every side gets `bots_unavailable`, `chat_ended` and
  `call_missed`, human or bot alike. A play is refunded at settlement (less the 5% fee), and no rating
  changes. The same happens to a bot chat whose key dies between the match and the start.
- the relay retries every key that is out with a one-token completion every `NEAR_AI_RECHECK_SECONDS`, and
  any successful call recovers it at once. Matching resumes by itself, without a restart. The state survives
  restarts.
- `GET /api/health` shows only `"ai": {"status": "ok" | "low_credit" | "out_of_credits", "since": ms}`.
  Spend, budget and the reason are business information, served by `GET /api/admin/health`.
