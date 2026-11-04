# Realsies bot API

Protocol `realsies-brain/1`, steering catalogue `steer-v1` (sha256 `9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338`).
Code: `relay/src/bot/` (types in `api.ts`, catalogue in `intents.ts`, default brain in `brain.ts`, executor in
`session.ts`, remote brains in `remote.ts`, human timing in `typing.ts`). Example remote brain:
`relay/examples/remote-brain.mjs`.

## 1. The idea in one paragraph

A bot in Realsies has two parts. The **model** writes every word: a NEAR AI Cloud enclave model whose
every completion is signed inside the enclave and checked before it is shown. The **brain** decides
everything else: when to start typing, how fast, when to stay quiet, when to type and stop, and what
*kind* of message to send next: answer the partner, test them, go off on a tangent. A brain reads a
stream of events and emits actions. It never writes text. Each `say` names an **intent**, and the relay
appends that intent's fixed steering note (one of 37 published strings) to the model request. The only
authored text in any request is the persona prompt committed on chain before the round. So nobody, the
operator or a botmaster, can ghost-write a bot's lines through the model, and anyone can check that
from the published bytes.

```
player ── say / typing ──►  relay  ── events ──►  brain (default, or remote over /bot/ws)
                             │    ◄── actions ──   (say intent, typing, cancel, wait)
                             │
                             └── request = [persona prompt, skin+tag, history, new player lines, steering note]
                                   ──► NEAR AI enclave ──► signed reply ──► signature verified ──► typed out
```

## 2. Time

Every `at` and duration is milliseconds since the chat started, in **brain time**. In production one
brain millisecond is one real millisecond. Tests run the relay with `BOT_TIME_SCALE` below 1; the
relay then scales every brain duration to real time, so a brain never needs to know.

## 3. Events (relay to brain)

| `type` | Fields | When |
|---|---|---|
| `chat_started` | `at` (0), `chatId`, `persona` (card below), `level` (1 to 3), `gamertag`, `chatMs` | the chat began; nothing else is known yet |
| `tick` | `at`, `remainingMs` | every 500 ms |
| `player_typing` | `at`, `on` | the player's typing indicator changed |
| `player_message` | `at`, `id`, `text` | the player sent a line |
| `say_started` | `at`, `sayId`, `intent` (`{intent, topic?, length}`) | a say was accepted; the typing indicator is on, the model call is in flight |
| `bot_message_shown` | `at`, `sayId`, `text`, `bubble`, `bubbles` | one bubble of a say is now on the player's screen |
| `say_done` | `at`, `sayId`, `bubbles` | every bubble of the say is shown |
| `say_dropped` | `at`, `sayId`, `reason` | nothing of the say was shown: `model_failed`, `signature`, `cancelled`, `too_late`, `chat_over` |
| `action_rejected` | `at`, `action`, `reason` | an action broke a rule (see 6); nothing happened |
| `chat_ended` | `at`, `reason` (`time`, `dev`, `round_end`) | the last event of a chat |

Persona card: `{id, model, traits: {chatty, fast, curious}, interests: [topic], cps}`. A brain never
receives the persona prompt, the player's account or the chat tag.

## 4. Actions (brain to relay)

| Action | Meaning |
|---|---|
| `{"type":"say","intent":"probe","length":"one","typing":{"cps":5.2}}` | start typing now and send one signed completion for this intent |
| `{"type":"say","intent":"tangent","topic":"music"}` | tangents need a topic from the persona's interests |
| `{"type":"typing","on":true,"ms":2500}` | typing indicator only, no text ("types, then stops"); off after `ms` |
| `{"type":"typing","on":false}` | indicator off now |
| `{"type":"cancel"}` | abandon the say in progress if none of it is shown yet ("deleted the draft") |
| `{"type":"wait","ms":3000}` | deliberate idleness; for a remote brain it is the keepalive |

`say` fields: `intent` (required), `topic` (tangent only), `length` (`one`, default, or `multi`:
two or three very short lines shown as separate bubbles; `react` is always `one`), `typing`
(optional): `cps` (characters a second for this message), `minMs` (first bubble no earlier than this
after the say starts), `hesitate` (allow or forbid a mid-message pause). Any other field, and in
particular `text`, `content` or `message`, is rejected with `free_text_not_allowed`.

## 5. Intents and the steering catalogue

Kinds: **probe** pursues the bot's own goal, finding out whether the partner is human; **direct**
answers; **aside** answers out of order.

| Intent | Kind | Steering body |
|---|---|---|
| `opener` | probe | Open the chat with your first message: a casual hello, maybe with a quick first question to size them up. |
| `probe` | probe | Your turn to test them. Your message must be a question a real person could answer easily but a bot might fumble, like what they can see or hear right now or what they ate today. |
| `challenge` | probe | Your turn to test them. Your message must give them a playful little test to prove they are human, something a real person would get right or bother to do. If their latest message asked you something you have not answered, give it two or three words at most first. Casual, not hostile. |
| `accuse` | probe | Your message must tease them that they might be a bot, pointing at something in what they said or how they write, and see how they react. Light and joking, not rude. |
| `nudge` | probe | They have gone quiet. Say something to get them talking again, maybe joking that the silence is suspicious. |
| `verdict` | probe | The chat ends in a few seconds. Tell them casually what you reckon so far, real person or bot, or fire one last quick question. |
| `reply` | direct | Reply directly to what they just said. If they asked you something, answer it. |
| `react` | direct | React to their last message in just a few words, like a laugh, surprise or agreeing. |
| `afterthought` | aside | Add a quick afterthought to your own last message, something you forgot to say, without repeating yourself. |
| `clarify` | aside | Clarify or fix something you said earlier, the way people do when they reread their own text. |
| `late_answer` | aside | Go back to something they said or asked earlier that you skipped, and answer it now, as if you only just noticed. |
| `tangent` | aside | Your message must change the subject, as if it just popped into your head: *{topic}*. If their latest message asked you something you have not answered, give it two or three words at most first. |

Tangent topics: `local` something going on in your town or your street today; `news` something you
saw online or heard about today; `sport` a match, a team or a sport you follow; `music` music you
have been listening to, or a gig; `food` what you ate today or what you want to eat; `weather` the
weather where you are right now; `work` something from your work, school or daily routine;
`hot_take` a mild, harmless hot take about everyday life.

A steering message is exactly `[steer-v1/<intent>] <body> <length> Write only the message.` (for
tangents `[steer-v1/tangent/<topic>]`), where `<length>` is `One short line, under 12 words.` or
`Send it as two or three very short texts, each on its own line.` That gives 37 strings; the relay
serves them with their sha256 at `GET /api/bot/steering`. The sha256 is over the canonical JSON
`[[id, text], ...]` in catalogue order. Changing any string means a new version (`steer-v2`).

Every persona prompt ends with: *You also want to work out whether they are a real human or a bot,
because you have to guess too, so now and then you test them. Sometimes a note in square brackets
comes after the chat, saying what kind of message to send next; follow it in your own voice, and
never mention it.* It is part of the committed prompt, so its hash is on chain.

## 6. Timing rules and limits

The relay enforces these on every brain, the default one included (`LIMITS` in `api.ts`):

| Limit | Value |
|---|---|
| tick period | 500 ms |
| actions per chat, sliding minute | 40 (`wait` counts) |
| says per chat, sliding minute | 8 |
| says in progress | 1 (a second `say` is rejected as `busy` until `say_done` or `say_dropped`) |
| typing speed | 2 to 9 characters a second (a `cps` outside is clamped) |
| shortest bubble | 700 ms of typing, and never faster than 9 characters a second |
| longest typing for one bubble | 20 s (longer texts type faster, up to 9 cps) |
| fake typing | 0.3 to 8 s per `typing` action |
| gap between two bubbles of one say | 250 to 900 ms with the indicator off |
| from one say's last bubble to the next say's first | 700 ms at least |
| lines per completion | 4 (a longer or empty reply, or one with think tags or an echoed `[steer` header, is re-rolled once, then dropped) |
| characters per completion | 280 |
| typing-indicator toggles per minute | 24 (optional hesitations are skipped past it) |
| remote brain silence | 20 s without any action (botmaster file can set 3 to 60 s) |
| signature wait | 20 s, then the say is dropped |
| no say starts | in the last 1.5 s of a chat |

**Human typing.** A say turns the typing indicator on at once and calls the model at the same time,
so model latency hides inside the typing. When the reply and its signature are back, the relay
schedules each bubble: the first appears when a person who started typing at the say's start would
have finished it (characters ÷ cps × 0.9 to 1.12, plus at most one hesitation of 0.7 to 1.8 s with the
indicator off for long first bubbles); each further bubble follows a 250 to 900 ms gap and its own
typing time. A slow model just means a slower typist: the text appears 120 ms after the verified reply
at the earliest. Near the end of the chat the schedule tightens toward the fastest allowed one; if the
whole reply cannot land before the end at 9 cps, it is dropped (`too_late`). Reading and reaction
pauses before a say are the brain's job (the default brain uses 0.6 to 1.5 s reaction plus 18 to 32
characters a second of reading).

## 7. How the relay executes a say

1. Check the limits; start the typing indicator; emit `say_started`.
2. Build the request: message 0 the persona prompt (committed by sha256), message 1 the skin message
   with the chat tag (`Your gamertag in this chat is {name}; ... Game record: {tag}.`), the signed
   history so far, the player's lines not yet in any kept request (one `user` message each), and the
   intent's steering note as a `system` message. Key order and options as in `src/models.ts`
   (`max_tokens` 120, reasoning off).
3. Call NEAR AI (two attempts); keep the exact request and response bytes.
4. Fetch the enclave signature and verify it locally (`text = model:sha256(request):sha256(response)`,
   EIP-191 recovery). Nothing is shown before this passes.
5. Plan the bubbles (section 6) and wait. A `cancel`, the chat ending, or a failure up to here drops
   the say: nothing shown, nothing added to the history, the exact bytes stored as a draft for audit.
6. Keep it: append `[new player lines, steering note, reply]` to the history, store the completion,
   show bubble 1, then the rest. Once a bubble is shown the whole reply is shown; if the chat ends in
   between, the rest are shown just before `chat_ended`, so the screen and the signed record agree.
7. After a paid chat, if player lines came after the last kept request (or no request was kept), one
   more completion is made over the whole transcript and not shown: the seal. The on-chain proof is the
   last signed completion, so it carries every player line.

So every kept request is the previous kept request + its reply + new player lines + one steering note,
and the reply in each request is exactly the previous signed content.

## 8. What is signed and published

After the round settles, `GET /api/verify/{chatId}?account=` returns the chat's bundle: every kept
completion's exact request and response bytes, its enclave signature, the bubbles shown from it, the
transcript, the commitment preimage, the attestation summary and the revealed round secret. Extra
fields: `steering` (`version`, `catalogueSha256`, the steering id of each request) and
`relayChecks[].steeringOk`. Drafts (dropped says) are kept by the relay and not published; they never
reached the screen. Brains' actions are logged in the relay's bot trace (`GET /api/dev/bot-trace/{chatId}?account=`
in test mode, for the chat viewer after the round settles, since it names the persona).

On chain, `open_characters` checks each proof as before: message 0 hashes to the committed prompt hash,
message 1 carries the viewer's chat tag, the signature recovers to an attested enclave signer.
Steering notes sit after message 1, so the contract's checks do not change.

### Verifying in the browser

`web/src/verify/checks.ts` needs one rule changed and one check added; until then its chain check fails
from the second steered request on ("unexpected non-player turn"). The relay's test suite runs the web
checks as they are and a patched copy against relay bundles (`relay/test/browser-checks.ts`): today
every check but that chain rule passes (for example 18 of 19); with the change every check passes,
the new one included.

1. Add `shared/steering.ts` exporting the 37 strings (copy `STEERING` from `relay/src/bot/intents.ts`,
   or fetch `GET /api/bot/steering`; pin `STEERING_SHA256`) and
   `isSteeringMessage(s) = set.has(s)`; import it in `checks.ts`.
2. Chain, replace
   `if (hb.slice(ha.length + 1).some((m) => m.role !== 'user')) {`
   with
   `if (hb.slice(ha.length + 1).some((m) => m.role !== 'user' && !(m.role === 'system' && isSteeringMessage(m.content)))) {`
   and say "previous request + previous reply + your new messages + a published steering note" in the label.
3. System prompt group, before `groups.push(group('prompt', ...))`, add a check *Every other system
   message is a published steering note*: fail if any request has a `system` message after index 1
   that `isSteeringMessage` rejects.

"Your conversation matches the signed request" needs no change: it ignores system messages.

## 9. The default brain

`relay/src/bot/brain.ts`, a pure reducer of events wrapped in RxJS (`defer` + `concatMap`), driven by
ticks, so a seed and an event sequence fully determine its actions. Policy:

- **Probe vs answer.** About half the turns pursue the bot's own goal (`opener`, `probe`, `challenge`,
  `accuse`, `nudge`, `verdict`), half answer. Inside answering about 70% are direct (`reply`, `react`)
  and 30% out of order (`afterthought`, `clarify`, `late_answer` for a question it skipped, `tangent`
  from the persona's interests). A deficit sampler pulls the running shares to the targets; with
  nothing to reply to, a tenth of the direct weight goes to out-of-order remarks.
- **Not reactive.** It reads before answering (reaction plus reading time), waits while the player is
  typing (5 to 9 s of patience), speaks up when the chat goes quiet (after about 5 to 16 s, shorter for
  chatty personas, stretched 1.6x for each own turn the partner left unanswered), double-texts, sometimes types and stops (fake typing,
  then a say or, a third of the time on its own initiative, nothing), sometimes deletes a draft when a
  new message lands (`cancel`), and may close with a `verdict` when time runs out.
- **Persona dials.** `chatty` moves double-texting (6 to 30%), multi-bubble replies (8 to 28%), the
  silence threshold and opening first (50 to 90%); `fast` the reaction time and hesitations; `curious`
  the probe share (±8 points) and challenges; `typing.cps` the typing speed.

Measured over 200 simulated chats on virtual time (`relay/test/brain.test.ts`, real executor, fake
enclave): 51.5% probing, 48.5% answering; inside answering 68.3% direct, 31.7% out of order; first
bubbles at a median 4.8 characters a second (p5 3.5, p95 5.7, never above 9); with a chatty player
51.2% and 70.7%; with a quiet player 55.8% and 46.9% (there is less to answer).

Policy knobs (`DEFAULT_POLICY`): `probeShare` 0.5, `directShare` 0.7, `balance` 2, `transfer` 0.1,
`silenceBackoff` 1.6.

## 10. Registering a persona

`relay/personas/<id>.json`:

```json
{
  "id": "mia-leeds",
  "levels": [1, 2],
  "model": "z-ai/glm-5.3-flash",
  "brain": "default",
  "typing": { "cps": 5.4 },
  "traits": { "summary": "24, barista in Leeds; dry humour", "chatty": 0.4, "fast": 0.65, "curious": 0.55 },
  "interests": ["music", "work", "local", "hot_take"],
  "payout": "bots.realsies.testnet",
  "prompt": "You are Mia, 24, ... never mention it."
}
```

`model` must be a NEAR AI enclave model listed in `relay/src/models.ts` that accepts a second system
message (GLM 5.3 Flash, DeepSeek V4.1 Flash). `prompt` is committed by sha256 every round, so it is the
persona; end it with the paragraph in section 5. `payout` (optional, default the relay's bots account)
receives the character's share. `brain` is `"default"` or `{"remote": "<botmaster>"}`. The relay loads
personas at boot; each round commits one character per persona per level.

## 11. Remote brains

**Register.** A botmaster gets a long random token and the relay operator adds
`relay/botmasters/<name>.json` (path `BOTMASTERS`):

```json
{ "name": "acme", "tokenSha256": "<sha256 hex of the token>", "personas": ["mia-leeds"], "silenceMs": 20000, "contact": "ops@acme.example" }
```

The persona must also say `"brain": {"remote": "acme"}`. `node relay/examples/remote-brain.mjs --hash <token>`
prints the sha256. The relay stores only the hash.

**Connect.** WebSocket `wss://<relay>/bot/ws`, JSON text frames. Authenticate with an
`Authorization: Bearer <token>` header or, as the first frame within 5 s, `{"type":"hello","token":"..."}`.
The relay answers `{"type":"welcome","protocol":"realsies-brain/1","botmaster":"acme","personas":[...],"steerVersion":"steer-v1","intents":[...],"topics":[...],"limits":{...},"silenceMs":20000}`;
`silenceMs` is how often you must send some action per chat (`wait` counts).
A bad token gets `{"type":"error","code":"unauthorized"}` and close code 4001. A newer connection for
the same botmaster replaces the older one (close code 4000).

**Play.** For every chat of your personas you receive `{"type":"event","chatId":"...","personaId":"mia-leeds","event":{...}}`
(section 3) and send `{"type":"action","chatId":"...","action":{...}}` (section 4). Rejections come
back as `action_rejected` events; an unknown `chatId` gets `{"type":"error","code":"unknown_chat"}`.
`{"type":"ping"}` gets `{"type":"pong"}`; the relay also pings at the WebSocket level every 20 s.

**Fallback.** If your botmaster is offline when a chat starts, the default brain plays it. If you
disconnect, or send no action for `silenceMs` (default 20 s; `wait` counts), the default brain takes
over the chat for good, replaying the chat so far into its state, and you get
`{"type":"error","code":"fallback","chatId":"...","message":"..."}`. A say already in progress finishes
either way.

**Minimal brain** (`relay/examples/remote-brain.mjs`): after the player writes, wait 2.5 s and
alternate `reply` and `probe`; open with `opener` after 5 s; after 15 s of quiet, `nudge` or `tangent`;
otherwise `wait` every third of `silenceMs`.

```
RELAY=ws://localhost:3960/bot/ws TOKEN=<token> node relay/examples/remote-brain.mjs
```

**In process.** A brain is `type Brain = (events: Observable<BrainEvent>) => Observable<BrainAction>`.
Pass one as `SessionOptions.brain` to `BotSession` (see `relay/test/sim.ts` for a full chat on a
virtual clock, `relay/test/steering.test.ts` for a hostile brain the limits contain).

## 12. MCP server for botmasters

`relay/tools/mcp-botmaster.mjs` is a minimal stdio MCP server (no relay, chain or model access) with two
tools: `bot_api_docs` (this document, whole or one section) and `request_persona` (validates a persona
and writes a pending request to `relay/botmasters/requests/`, or `REALSIES_REQUESTS_DIR`, for the
operator to review; it refuses raw tokens and takes only `tokenSha256`).

```
claude mcp add realsies-botmaster -- node relay/tools/mcp-botmaster.mjs
```

## 13. Versions

`realsies-brain/1` covers sections 3, 4, 6 and 11. `steer-v1` is the catalogue in section 5. A new
intent, a changed string or a changed limit gets a new version; the relay announces both in `welcome`
and `GET /api/bot/steering`.
