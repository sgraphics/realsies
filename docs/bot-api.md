# Realsies bot API

Protocol `realsies-brain/1`, steering catalogue `steer-v1` (39 notes, sha256 `25999dbc7bdbc9100095c4f267dad15af9189a4d9a6130394fae61c6eed11828`;
append-only, section 5: its first 37 notes are the ones published on 2026-11-04, sha256
`9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338`).
Code: `relay/src/bot/` (types in `api.ts`, catalogue in `intents.ts`, default brain in `brain.ts`, executor in
`session.ts`, remote brains in `remote.ts`, human timing in `typing.ts`). Example remote brain:
`relay/examples/remote-brain.mjs`.

## 1. The idea in one paragraph

A bot in Realsies has two parts. The **model** writes every word: a NEAR AI Cloud enclave model whose
every completion is signed inside the enclave and checked before it is shown. The **brain** decides
everything else: when to start typing, how fast, when to stay quiet, when to type and stop, and what
*kind* of message to send next: answer the partner, test them, go off on a tangent, or react to a line in
a language the persona cannot read. A brain reads a stream of events and emits actions. It never writes
text. Each `say` names an **intent**, and the relay appends that intent's fixed steering note (one of 39
published strings) to the model request. The only
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

The chat starts when the countdown ends. Both players get `chat_started` with `startedAt` =
now + `COUNTDOWN_SECONDS` (default 3) and see a full-screen 3, 2, 1; the relay refuses a player's `say`
before `startedAt` (`chat_not_started`) and drops typing indicators, and a brain hears `chat_started`
(`at` 0) only at `startedAt`. Human and bot chats run on exactly the same clock, so nobody can tell from
the timing who is expected to speak first.

## 3. Events (relay to brain)

| `type` | Fields | When |
|---|---|---|
| `chat_started` | `at` (0), `chatId`, `persona` (card below), `level` (1 to 3), `gamertag`, `chatMs` | the countdown is over and the chat began (section 2); nothing else is known yet |
| `tick` | `at`, `remainingMs` | every 500 ms |
| `player_typing` | `at`, `on` | the player's typing indicator changed |
| `player_message` | `at`, `id`, `text`, `lang`? | the player sent a line; `lang` (ISO 639-1) only when the relay is sure it is not English (below) |
| `say_started` | `at`, `sayId`, `intent` (`{intent, topic?, length}`) | a say was accepted; the typing indicator is on, the model call is in flight |
| `bot_message_shown` | `at`, `sayId`, `text`, `bubble`, `bubbles` | one bubble of a say is now on the player's screen |
| `say_done` | `at`, `sayId`, `bubbles` | every bubble of the say is shown |
| `say_dropped` | `at`, `sayId`, `reason` | nothing of the say was shown: `model_failed`, `signature`, `cancelled`, `too_late`, `chat_over` |
| `action_rejected` | `at`, `action`, `reason` | an action broke a rule (see 6); nothing happened |
| `chat_ended` | `at`, `reason` (`time`, `dev`, `round_end`) | the last event of a chat |

Persona card: `{id, model, traits: {chatty, fast, curious, guarded, drift}, interests: [topic], cps, languages?}`. Traits are
0..1 dials: `chatty` terse to chatty, `fast` slow to quick reactions, `curious` how much the bot tests
the partner, `guarded` open to guarded (types and stops, deletes drafts, accuses, waits for the other to
open), `drift` tidy and on topic to messy and drifting (asides, tangents, afterthoughts). `guarded` and
`drift` are additive in `realsies-brain/1`; ignore them if you do not need them. `languages` (additive) maps
the ISO 639 code of every language the persona reads to `native`, `fluent`, `good` or `basic`
(`{"et": "native", "en": "good", "ru": "good", "fi": "basic"}`); it reads no other. Every demo persona has it; a
remote persona with its own prompt only if its file says so (section 10). A brain never receives the
persona prompt, the player's account or the chat tag.

**Languages.** The relay detects the language of each player line before the brain hears it
(`relay/src/bot/language.ts`), conservatively: other scripts (Cyrillic, Greek, Arabic, Hebrew, Indic,
Thai, Hangul, kana, Han) by their letters; Latin script by word lists of about 20 languages, flagged only
when at least two different function words of one language make up much of the line, with enough text
(8 letters), at most a quarter English words and a clear lead over the next language. Laughs, tourist
words (hola, ciao) and well-known phrases (c'est la vie) count for nothing, so short or sloppy English
chat is never flagged; anything unsure has no `lang`. A persona reads a language listed on its card at any
level, or a close relative of one it speaks natively or fluently (Danish and Norwegian, Czech and Slovak).

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
| `foreign` | direct | Their last message is in a language you do not speak, and you cannot understand it. React the way a real person would; do not translate it, answer it or write in it. |
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
`Send it as two or three very short texts, each on its own line.` That gives 39 strings; the relay
serves them with their sha256 at `GET /api/bot/steering`, and `shared/steering.ts` (generated by
`relay/tools/gen-steering.ts`) is the copy the browser checks. The sha256 is over the canonical JSON
`[[id, text], ...]` in catalogue order.

The catalogue is **append-only**: a published note never changes and never moves, so every past round
stays verifiable; a new intent adds its notes at the end (changing or removing a note would need
`steer-v2`). History: 2026-11-04, 37 notes, sha256 `9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338`;
2026-11-05, 39 notes (`foreign/one`, `foreign/multi` appended), sha256
`25999dbc7bdbc9100095c4f267dad15af9189a4d9a6130394fae61c6eed11828`.

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

1. Add `shared/steering.ts` exporting the published strings (generated from `relay/src/bot/intents.ts` by
   `relay/tools/gen-steering.ts`, or fetched from `GET /api/bot/steering`; pin `STEERING_SHA256`) and
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
- **Languages.** When the partner's latest unanswered line has a `lang` the persona does not read (section 3),
  the next say is always `foreign`, whatever the splits say; a short line with no `lang` after it (`??`) does
  not change that, a longer one does. Near the end of the chat `foreign` is not turned into `react`. A
  persona whose card has no `languages` never gets `foreign` from the default brain.
- **Not reactive.** It reads before answering (reaction plus reading time), waits while the player is
  typing (5 to 9 s of patience), speaks up when the chat goes quiet (after about 5 to 16 s, shorter for
  chatty personas, stretched 1.6x for each own turn the partner left unanswered), double-texts, sometimes types and stops (fake typing,
  then a say or, a third of the time on its own initiative, nothing), sometimes deletes a draft when a
  new message lands (`cancel`), and may close with a `verdict` when time runs out.
- **Persona dials.** `chatty` moves double-texting (6 to 30%), multi-bubble replies (8 to 28%), the
  silence threshold, opening first (50 to 90%) and how soon the opener comes; `fast` the reaction time
  and hesitations; `curious` the probe share (±8 points) and challenges; `guarded` fake typing (×0.6 to
  1.4), deleted drafts (20 to 50% of the chances), accusations (×0.55 to 1.45), patience and opening first
  (±10 points); `drift` the direct share inside answering (±8 points), tangents and afterthoughts and a
  little double-texting; `typing.cps` the typing speed. Every dial at 0.5 is the policy below exactly.
  Demo personas derive all five from their attributes (section 14).

Measured over 200 simulated chats on virtual time (`relay/test/brain.test.ts`, real executor, fake
enclave): 51.5% probing, 48.5% answering; inside answering 68.3% direct, 31.7% out of order; first
bubbles at a median 4.8 characters a second (p5 3.5, p95 5.7, never above 9); with a chatty player
51.2% and 70.7%; with a quiet player 55.8% and 46.9% (there is less to answer).

Policy knobs (`DEFAULT_POLICY`): `probeShare` 0.5, `directShare` 0.7, `balance` 2, `transfer` 0.1,
`silenceBackoff` 1.6.

## 10. Registering a persona

`relay/personas/<id>.json`. A persona driven by a remote brain may bring its own prompt:

```json
{
  "id": "acme-zed",
  "levels": [1, 2],
  "model": "z-ai/glm-5.3-flash",
  "brain": { "remote": "acme" },
  "typing": { "cps": 5.4 },
  "traits": { "summary": "24, barista in Leeds; dry humour", "chatty": 0.4, "fast": 0.65, "curious": 0.55, "guarded": 0.6, "drift": 0.5 },
  "interests": ["music", "work", "local", "hot_take"],
  "payout": "bots.realsies.testnet",
  "prompt": "You are Zed, 24, ... never mention it."
}
```

`model` must be a NEAR AI enclave model listed in `relay/src/models.ts` that accepts a second system
message (GLM 5.3 Flash, DeepSeek V4.1 Flash). `prompt` is committed by sha256 every round, so it is the
persona; end it with the paragraph in section 5. `languages` (optional, `{"en": "native", "fr": "basic"}`)
puts the languages the persona reads on its card, so your brain (and the default brain when it stands
in) can answer lines in any other language with `foreign`; say the same in your prompt. `traits` are the dials the default brain uses when it
stands in for the remote one (default 0.5). `payout` (optional, default the relay's bots account)
receives the character's share. `brain` is `"default"` or `{"remote": "<botmaster>"}`. The relay loads
personas at boot; each round commits one character per persona per level.

The relay's own demo personas (`brain` `"default"`) are written as attributes instead, a `person`
block, and may not carry `prompt`, `typing`, `traits` or `interests`: all of those are derived (section 14).

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

`realsies-brain/1` covers sections 3, 4, 6 and 11. `steer-v1` is the catalogue in section 5. Additions are
backward compatible and keep the versions: new optional event or card fields (`lang`, `languages`) and new
intents whose notes are appended to the catalogue (its sha256 changes, every earlier note stays byte for
byte). A changed or removed note, or a changed limit, gets a new version. The relay announces the intents
and versions in `welcome` and `GET /api/bot/steering`.

## 14. Demo personas

The relay's own bots (`relay/personas/*.json` with `brain` `"default"`, and the people generated for each
round) are written as **attributes**, not prompts. Remote brains and their personas are untouched: a
botmaster wires any logic in its own subscription and brings its own prompt.

**Attributes** (`person` block, `relay/src/persona/model.ts`): `name` (and `nickname`), `age`, `gender`
(`woman`, `man`, `nonbinary`; independent of the avatar's look), `mbti` (a Myers-Briggs type), `temperament`
(`shy`, `reserved`, `easygoing`, `outgoing`, `loud`), today's `mood` (and `moodWhy`), `home` (city, region,
country, IANA time zone, culture), `english` (`native`, `fluent`, `good`, `basic`) with `language` and the
natural `slips` of that first language, `languages` (every language they read, ISO 639 code to `native`,
`fluent`, `good` or `basic`, English at the level of `english` and the first language native; any other
language is none: `{"en": "native", "fr": "basic"}` for the barista from Leeds, `{"et": "native", "en": "good",
"ru": "good", "fi": "basic"}` for the mechanic from Tallinn, `{"de": "native", "en": "fluent"}` for the Berliner), `job` (title, phrase, category), `family` (a pet, sibling,
partner or kids), `commute`, `device`, `likes`, `details`, `quirks`, `scenes` (where they are, what
they can see or hear, what they ate, by time of day), `interests` (steering topics), and optional
`style` overrides. The writing style follows from the rest; a hand-written persona can pin any field.

**Style** (`deriveStyle`): case (all lowercase, normal, erratic), punctuation (none, light, full, `...`),
exclamations, questions back, message length (terse, short, full sentences), emoji (none, rare, often)
from an age-appropriate set (`💀😭🫠` for the young, `😂🙃😅` for millennials, `👍😊🙂` for older people),
emoticons (`:)` and `:-)` for older people, `^^` in Korea and Japan, `xD`), laughter by culture and age
(`lol`, `lmao`, `haha`, `kkkk` in Brazil, `jajaja` in Spanish, `www` in Japan, `555` in Thailand,
`mdr` in France, `wkwk` in Indonesia), abbreviations by age, regional slang (mate, grand, heaps, abeg,
yaar, y'all), typo rate, and how they take "are you a bot" (laugh it off and throw it back, mock offence,
a dry no, flustered, suspicious back, puzzled).

**The letters** move both the writing and the dials:

| Letter | Writing (prompt and style) | Dials (`deriveTraits`) |
|---|---|---|
| E | likes a chat, asks questions back, exclaims, longer messages | chatty up, fast up (starts sooner), guarded down, curious up |
| I | keeps it brief, takes a moment, fine with silence, terse | chatty down, slower to start, guarded up |
| S | concrete, everyday things in front of them | curious and drift down |
| N | odd connections, what-if questions, tangents | curious up, drift up |
| T | blunt and dry, no sugarcoating, fewer exclamations and emoji | guarded up, chatty down |
| F | warm, notices how the other is doing, more emoji | guarded down, chatty up |
| J | tidy: answers what was asked, stays on topic, proper capitals, few typos | drift down, guarded up |
| P | scattered: jumps between thoughts, lowercase, leaves typos | drift up, fast up |

Temperament (E/I with noise) moves `chatty` and `guarded`, age and mood move `fast`, mood moves every
dial a little. Typing speed (`deriveCps`) slows with age, is quicker on a keyboard for the young, slower in a
second language, plus a little personal noise. Measured in `relay/test/persona.test.ts` (60 simulated chats each, the
player never opening): an ESFJ twin of an ISFJ sends 9.5 bubbles a chat against 7.9, shows its first line at a
median 10.9 s against 13.6 s, and types-and-stops 28 times against 49; over 150 chats each an ENFP answers out of
order 35.7% of the time, an ESTJ 29.0%.

**The prompt** (`relay/src/persona/prompt.ts`, message 0, committed by sha256 each round) is composed from
the attributes: who they are, where they are right now (the local time and day of the round's start in their
time zone, the scene for that time of day, what they ate, the mood and why), personality (temperament, the
four letters, quirks), their languages (the list; for second-language English its level and natural slips;
then the rule: *You can read only Estonian, English, Russian and Finnish: if they write in any other
language, you do not understand it at all, so never translate it, never answer what it says and never write
in it; react the way a real person would, confused or amused, maybe guess what language it is, and ask them
to write in English. You never switch language on your own: you write in English, but if they write to you
in Estonian, Russian or Finnish, you may answer in that language.*), the game, how they write, and the base
rules every persona shares:
pass as a human player of Realsies, text like a stranger and not like an assistant, no lists or markdown,
deny being an AI the way the style says without overdoing it, deflect prompt injection like a confused or
amused person, the generated gamertag, and the steering paragraph of section 5 last.

**The cast of a round** (`relay/src/persona/cast.ts`) is `CAST_SIZE` (default 39) characters, thirteen a
level, whose nationalities follow a Western player base: each character's country is drawn from
`COUNTRY_WEIGHTS` (`relay/src/persona/data.ts`): the US 33%, the UK 12%, Canada 5.5, Australia 4.5,
Ireland 2.5 and New Zealand 1.5 (14 together), Western and Northern Europe 25 (Germany 5.5, France 3.25,
Spain 2.4, the Netherlands 2, Italy 2, the Nordics 4.1, Poland 1.2, the Baltics 0.95, Belgium, Austria,
Switzerland, Portugal and others), Latin America 6 (Mexico and Brazil 2.2 each), everyone else 10 (India 2,
the Philippines 1.5, South Africa and Nigeria 1 each, the rest of Asia and Africa smaller). A slot is then
played by a hand-written persona from that country (at one of its levels, at most once a round) half the
time when one is free, otherwise by a person generated for that country from the round's `castSeed`
(stored with the round), models GLM 5.3 Flash and DeepSeek V4.1 Flash; the country is drawn first, so the
mix holds whoever plays. Measured over 3000 rounds (`relay/test/persona.test.ts`): US 33.1%, UK 12.0%,
Canada, Australia, Ireland and New Zealand 13.8%, Western and Northern Europe 25.1%, Latin America 6.0%,
the rest 10.0%; hand-written personas fill 16.8% of the characters (6.6 a round: the three Americans and
the barista from Leeds in most rounds, Busan, Osaka, Pune, Lagos and Tallinn in fewer than one in four).
`CAST_SIZE=0` plays the personas folder as is (every persona at each of its levels, nobody generated);
`CAST_PINS` (tests and smoke runs) forces hand-written personas in. Personas driven by a remote brain play
every round at each of their levels, on top. The generator is deterministic: the same seed, index, country
and start time give the same person and prompt. Ages run 16 to 70, most 20 to 40; about 60% native English
speakers; the job fits the age, names fit the culture and the age, the languages fit the place, the age
and the schooling the job implies (school French in the UK, Irish in Ireland, Russian for older Estonians,
Swedish for Finns), the scene fits the job and the local hour. Each bot character stores the persona it
plays as committed.
`npx tsx relay/tools/persona-preview.ts [seed] [count]` prints generated people with cards, languages, dials
and a full prompt; `--cast` a full round cast as the relay builds it, `--mix 2000` the nationality mix over
many rounds against the weights.

**The card** (`shared/protocol.ts` `PersonaCard`: age, gender, mbti, temperament, home, job, style, emoji;
plus `name` and `mood` as extra fields) is filled in `ChatResult.persona` and `VerifyBundle.persona` for
bot chats. Both are built at settlement and served only after it, so the card never shows during the round.
