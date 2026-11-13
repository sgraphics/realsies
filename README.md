# Realsies

An 8-bit chat game: talk to a stranger for two minutes, then call it: real human or bot? Some characters are other players. Some are AI agents running inside NEAR AI's confidential enclaves, where every word they say is signed. When the round ends, the game contract on NEAR proves who was a bot and pays the players who read the room right.

Demo (testnet, no wallet needed): https://testnet.realsies.lol · Mainnet: https://realsies.lol · For AI builders: https://realsies.lol/agents · NEAR Hackathon 2026 · Tracks: games, privacy, memecoins

## Executive summary

**What**
- Human-or-bot game
- 8-bit chat room
- Made for fun

**Problem**
- Bots pass as human
- Nobody can prove it
- AI lacks real testers

**Solution**
- Turing test game
- Enclave-signed bots
- Proof on chain

**How you play**
1. Play coins
2. Chat two minutes
3. Call: human?
4. Right calls win

**The split** (coins of wrong calls)
- 70% right callers
- 20% Turing bonus
- 10% the game
- 5% bot fund (every play)

**Two-sided marketplace**
- Players read characters
- AI builders enter agents
- Builders earn bonuses
- Builders get transcripts

**Fun first**
- Two-minute chats
- Five room themes
- Quirky bot personas
- Free mode daily

**Built on NEAR**
- NEAR AI enclaves
- Rust game contract
- REAL coin, NEP-141
- Rhea pool, locked

## Status, 2026-11-13

| Part | State |
|---|---|
| Game on testnet | Live at https://testnet.realsies.lol: test users or a testnet wallet, test coins (tREAL), 10-minute rounds, real NEAR AI enclave bots, settlement on chain. The latest end-to-end run against the live server passed 100 checks in round 137 |
| AI builders side | Live: `/agents` (pitch and access request), `/agents/dashboard` (scorecards, transcripts, export, own NEAR AI key, persona requests), botmaster API, `docs/agents.md` |
| Mainnet game | Live at https://realsies.lol: `game.realsies.near`, wallet sign-in, free play every day, and coins (REAL) since Nov 10. Turing Hour every day at 20:00 UTC, when real people are in the room; on Nov 12 it carried a 5 NEAR prize for the three best callers, paid by the team (`realsies.lol/prize.html`, `scripts/turing-winners.py`) |
| REAL coin | `real.realsies.near`: a fixed supply of 1,000,000,000, no minting, and the token account has no keys. 800,000,000 sit in one Rhea pool position that started with no NEAR and whose account has no keys, so the liquidity cannot be taken out. 200,000,000 are the team's share in `vault.realsies.near` (`contracts/vault`, no owner): nothing before Nov 17, everything by Dec 8. Launched on Nov 10 at 15:00 UTC with `scripts/launch-real.mjs` after a full rehearsal on testnet: [token](https://nearblocks.io/address/real.realsies.near), [vault](https://nearblocks.io/address/vault.realsies.near), [liquidity account](https://nearblocks.io/address/liquidity.realsies.near), pool `real.realsies.near|wrap.near|2000` on `dclv2.ref-labs.near`. The facts with explorer links are at https://realsies.lol/token.html |
| Free chats | Five practice chats a day without a wallet, on mainnet and testnet (and at most 20 per network): always one of the house bots, the reveal right after the call, "Play again" for the next one, kept outside the rounds so it can never tell who is a bot in a running round. The house bot is picked to speak the visitor's language when one does (from the browser's language: Arabic, Russian, Indonesian, Korean, Japanese, Spanish, Portuguese, French, German and more), and a bot never answers in a language its person doesn't know (`relay/src/game/practice.ts`) |
| Wallet sign-in | NEAR Connect: one NEP-413 signature to sign in, a browser function-call key for plays and calls without popups; live on mainnet and testnet. A brand-new wallet signs in before its account is on chain (an implicit account is let in by its own key until someone sends it NEAR) |
| Share a call | After a reveal, "Share" opens a ready post (the share sheet on a phone, X elsewhere) with a link whose preview is the card for that outcome: "A bot fooled me", "I spotted the bot", "I found the human", "I took a human for a bot" (`web/src/state/share.ts`, `web/public/s/`) |
| Coins for NEAR | Inside the game: pay NEAR and the coins are in the game after one wallet approval (wrap, swap on Rhea, deposit); withdraw coins as plain NEAR the same way. Players never visit an exchange. A buy is an exact-input swap, the kind chart sites count as a buy (`web/src/wallet/swap.ts`, `relay/src/swap.ts`) |

## Numbers so far

<!-- stats:start -->
Counted on 2026-11-13 at 08:02 UTC by `scripts/stats.py`, from the game's own records and the chain.

| | |
|---|---|
| Mainnet game (since Nov 9) | 16 rounds settled on chain, 34 chats in rounds, 25 free chats by guests |
| Players | 8 wallets have played (5 of them outside the team); about 101 different browsers have opened realsies.lol (counted by user agent, an estimate) |
| Can people tell? | visitors called it right 13 times out of 19 |
| Bots | 305 bot replies on mainnet, 305 of them signed in a NEAR AI enclave; 32 enclave attestations checked; NEAR AI has cost $0.07 so far, testnet included |
| Chain | 233 transactions by the mainnet relay, 0 failed. Testnet since Nov 4: 167 rounds settled, 1,359 transactions |
| REAL | 13.7 million REAL (1.4% of the supply) bought out of the pool; 3.55 NEAR paid in, 0.07 NEAR paid out, 3.48 NEAR in the pool. Most of it is the team's own play so far |
| Community | X @realsieslol: 67 followers, Telegram t.me/realsieslol: 8 members |
| Code | 96 commits since Nov 4; relay 139 tests, web 669 checks, vault 19 tests |
<!-- stats:end -->

## The problem

Bots now pass as people in chats, support lines and feeds, and nobody can prove what they talked to. Human or Not showed people love the guessing game: AI21's 2023 run had over 10 million conversations in a month and 68% accuracy. But it had no stakes, no proof of what you talked to, and no way for anyone else to enter a bot. Meanwhile the companies building chat and voice agents have no cheap way to learn how real people judge them.

Realsies adds all three, inside a game people play for fun: coins on every call, bots whose every word is signed in an enclave and checked on chain, and an open arena where AI builders enter their own agents.

## Try it now (testnet): do X, see Y

1. Open https://testnet.realsies.lol. See the room right away, as a guest: ten characters, the round clock and "Sign in" at the top. Tap a character. See "Before you play": tick "I'm 18 or older, I play at my own risk and I accept the terms" and tap Continue (once per browser). Then sign in: tap one of the six test players, for example Ben, or "Sign in with a NEAR wallet" with a testnet wallet (Meteor, Intear or Nightly). The character you tapped opens.
2. See the orange TESTNET panel above the room (it shows while you hold no test tokens at all). Tap "Airdrop 100 tREAL test tokens": no further action needed. A test player's tokens go straight into the game balance and show on the pillar. A wallet's land in the wallet ("100 tREAL are in your wallet"); from there it works like the real game: tap your coins and deposit, one wallet approval that also lets your plays and calls run without popups, then play. Or skip it and play free. Once you hold tokens the panel is gone; one airdrop per account per 10 minutes.
3. See your room: ten characters on pedestals, each with a gamertag and a face generated for you alone. Tap one, choose 5 coins or Play free.
4. See a full-screen 3, 2, 1, CHAT! countdown, then chat for up to two minutes. Answer Real human? Yes / No. See "Locked until the round ends".
5. To meet a human instead of a bot, open a second browser window as another test user and tap a character in both windows within a few seconds.
6. Rounds last 10 minutes on testnet. To skip ahead, open the menu at the top right and choose End round now. See Results: who was who, the persona card of every bot you met, your score and rating, coins won, and a Verify button on every bot chat.
7. Tap Verify. See every check run in your browser: the on-chain commitment, your handle and chat tag, every enclave signature recovered to the attested signer, the persona prompt hash, your own messages matched byte for byte inside the signed request, and links to each transaction on testnet.nearblocks.io.
8. With a testnet wallet that holds test NEAR: tap your coins, choose 0.25 NEAR and approve once. See about 98 coins in the game: the NEAR was wrapped, swapped on Rhea's testnet pool and deposited in that one approval. Type a number of coins next to Withdraw and approve once: see plain NEAR back in the wallet.
9. Open https://testnet.realsies.lol/agents. See the pitch for AI builders, a worked Turing bonus example and the access request form. Open https://testnet.realsies.lol/agents/dashboard?mock=1 and tap "Use the demo token": see a sample builder's scorecard by persona and round, transcripts and setup.

Run it locally instead:

```
cd web && npm install && npm run build      # the app, served by the relay
cd ../art && npm install
cd ../relay && npm install && npm run build && npm start   # http://localhost:3960
```

The relay needs `relay/.secrets/testnet.json` (created by `scripts/setup-testnet.sh`) and `NEAR_AI_API_KEY` in the repo-root `.env`. Without the secrets it runs on an in-memory mock chain; `web` also has a full in-browser mock at `http://localhost:5173/?mock=1` after `npm run dev`. Tests: `npm test` in `relay` (139 tests) and `web` (nine suites), `cargo test` in `contracts/game` (16) and `contracts/vault` (19), and `RELAY_URL=https://testnet.realsies.lol npm run e2e` in `relay` for the live end-to-end run on testnet.

The trust chain also runs on its own, without the game:

```
python -m venv venv && venv/Scripts/pip install requests eth-account dcap-qvl
set NEAR_AI_API_KEY=<your key from cloud.near.ai>
python experiments/near-ai/verify_tee.py --model z-ai/glm-5.3-flash
```

See `VERDICT: PROVEN` after the script fetches a fresh attestation with its own nonce, checks the nonce and signer inside the Intel TDX quote, verifies the quote against Intel collateral, checks the NVIDIA payload echoes the nonce, asks the model one question, fetches the completion signature and recovers the signer. Without a key it stops after the attestation checks, which need none.

## How a round works

The core loop, then the numbers.

1. **Play.** Tap a character and put coins on it before the chat: 5, 10 or 25 at Level 1, up to 500 at Level 3. Walking away without a call counts as a wrong call, so nobody can wait and see for free.
2. **Chat.** Two minutes, text only. Bots type at human speed, make typos, double-text, ask back and go quiet like people do.
3. **Call.** One question: real human? Yes or no. The call is locked until the round ends.
4. **Reveal.** Every round (6 hours on mainnet, 10 minutes on testnet) the contract opens each character: human or bot, with proof for every bot.
5. **Rewards.** For each character, the coins of the wrong paid calls split three ways:
   - 70% to the right paid callers, in proportion to their coins
   - 20% to the character itself, the Turing bonus: the human players thought was a bot, or the builder whose bot players thought was human
   - 10% to the game
   - 5% of every play goes first to the bot fund, which pays for inference
   - Nobody wrong: nothing moves. Nobody right: the character takes 90%. An unopened character is void and refunded, so silence never counts as human.
6. **Symmetric.** When two humans meet, both play and both call each other.
7. **Free mode.** Anyone plays, scores and is rated without coins: three chats a day on mainnet, unlimited on the testnet demo. Free calls never move coins; a free human's Turing bonus waits in a promo account until they deposit.
8. **Skill.** A reader rating moves by how surprising each call was against the room. Levels unlock by rating, not by coins, and can be reached free.

It is a party game for entertainment: the coins are in-game, the skill is reading people, and every chat shows what a bot sounded like once the round reveals it.

## Why a bot is provable

NEAR AI Cloud runs its models inside Intel TDX confidential VMs with NVIDIA confidential-computing GPUs, and signs every completion over `model id : sha256(request bytes) : sha256(response bytes)` with an EIP-191 secp256k1 key that exists only inside the enclave. The attestation report, fetched with the caller's nonce, binds that key into the TDX quote's report_data.

At round start the game commits on chain, per bot character, to the model id, the hash of the persona's system prompt and the attested signing address. At round end it opens the commitment with the signature of the character's last completion; that request carried the system prompt and the whole transcript, so one signature commits to all of it. The contract recovers the signer with `env::ecrecover` and checks it against the commitment. The Verify panel checks the turn-by-turn chain in the player's browser. The operator cannot swap the model, edit the prompt, ghost-write a reply or rewrite history without the character failing to open. Brains, ours or a builder's, choose only when to type and what kind of message comes next, never the words.

What is not proven: that a human seat is a human. That rests on the account's rating history and coins, and the app says so plainly.

Evidence from 2026-11-04: model z-ai/glm-5.3-flash, attested signer 0x3b753b4406613c5e70ae640508632b600424fa0c, completion id c6bba1f4dd0243f89c77ed4045e3d056, both quotes UpToDate under dcap-qvl, signature recovered to the attested signer. Artifacts in `experiments/near-ai/runs/`.

## How NEAR makes it work

### NEAR Protocol

| What | How Realsies uses it | Where |
|---|---|---|
| Smart contract (Rust, near-sdk 5.29.1) | The game itself: coin balances, plays, calls, round commitments, openings, settlement and payouts | `contracts/game/src/lib.rs`, at `game.realsies.testnet` and `game.realsies.near` |
| `env::ecrecover`, `env::keccak256` | Recover the enclave's secp256k1 signer from a bot's last completion and derive its Ethereum-style address, inside the contract (`verify_bot_proof`) | `contracts/game/src/lib.rs` |
| `env::sha256` | Commitments to each character (model, prompt hash, signer, payout, salt) and to the round secret | `contracts/game/src/lib.rs` |
| NEP-141 fungible tokens | Coins are a token: deposits arrive through `ft_transfer_call` into `ft_on_transfer`; withdrawals call `ft_transfer` with an `on_withdraw` callback that restores the balance if the transfer fails | `contracts/game`, test coin tREAL at `real.realsies.testnet` |
| NEP-297 events | Every deposit, play, call, reveal and settlement is logged as `EVENT_JSON` for indexers and the Verify panel | `contracts/game/src/lib.rs` |
| Named accounts and sub-accounts | `realsies.near` owns the game; `game`, `ops` (operator), `fund` (bot fund), `house`, `promo` and `bots` split the roles | `scripts/setup-mainnet.sh` |
| Function-call access keys | The relay operates rounds with keys limited to the game contract; players add a browser key limited to `play` and `call` with one wallet approval, so plays and calls need no popups | `relay/src/chain/`, `relay/src/auth/`, `web/src/wallet/` |
| Storage staking | `prune_round` frees a settled round's storage, so a long-running game never runs out of balance | `contracts/game/src/lib.rs` |

### NEAR AI Cloud

| What | How Realsies uses it | Where |
|---|---|---|
| Private inference | Every bot reply is a completion from a NEAR AI enclave model, GLM-5.3 Flash or DeepSeek V4.1 Flash | `relay/src/nearai/` |
| Attestation with a nonce | The relay fetches each model's attestation with its own 32-byte nonce and checks report_data = signer + nonce; the script also verifies the TDX quote with dcap-qvl and the NVIDIA payload | `relay/src/nearai/`, `experiments/near-ai/verify_tee.py` |
| Response signatures | The relay keeps the exact request and response bytes of every completion with its signature, publishes them after the round, and the contract checks one per bot | `relay/src/bot/`, `relay/src/game/bundle.ts`, `web/src/verify/checks.ts` |
| Model list and credits | Builders pick from the gateway's enclave models; spend is tracked, running out pauses new chats instead of leaving bots silent, and builders can bring their own NEAR AI key | `relay/src/nearai/credits.ts`, `relay/src/agents/` |

### Partners and ecosystem

| Partner | Role | State |
|---|---|---|
| Rhea Finance | REAL trades in a Rhea concentrated-liquidity pool; the game buys and sells coins there inside the player's one wallet approval | Live since Nov 10 |
| meme.cooking | The first launch attempt: a 24-hour auction on Nov 9 that ended below its soft cap. We found and reported the bug that kept first-time wallets out; fixed upstream (below) | Ended |
| NEAR Connect | Wallet sign-in (NEP-413) and a limited-access key for plays and calls | In use (`web/src/wallet/`, `relay/src/auth/`) |
| NEAR Intents | Get coins with any token | Later |
| FastNEAR, NearBlocks | RPC for the relay and the CLI; transaction links in the Verify panel | In use |

In one line each: NEAR AI makes a bot provable; NEAR makes the proof a contract call instead of a promise; Rhea gives the game a coin anyone gets with NEAR in one approval, with liquidity nobody can take out. Serious cryptography, wrapped in a game anyone can play in a browser.

**Given back to the ecosystem.** During our launch we found a bug on meme.cooking that stopped every first-time wallet from depositing into any auction: the deposit button read "this account is not registered yet" as "still loading" and did nothing. We reported the exact line and the cause, and the meme.cooking team fixed it the next morning: [Shitzu-Apes/app@24c72f9](https://github.com/Shitzu-Apes/app/commit/24c72f9dc9c87d5455d1a7168595107932cfc813), "fix: unblock first-time wallets in meme.cooking deposit".

## For AI builders: the second side

The room has two sides. Players read characters; LLM operators, chat and voice agent vendors and researchers enter agents for players to catch.

- **Money.** The Turing bonus: 20% of the coins of every paid player who calls your agent human, 90% when no paid player calls it right, paid on chain by the game contract to your NEAR account.
- **Data.** Every settled transcript of your agents with the player's call, players anonymised, and a scorecard of how often real people believed your agent was human, by persona and round, plain and weighted by coins. Export as JSONL.
- **How.** Apply at https://realsies.lol/agents. On approval you get a token, register personas (a system prompt committed every round, a NEAR AI enclave model, levels, timing dials) and follow them at /agents/dashboard. Use the relay's conversation brain or drive timing and intents with your own over WebSocket. Bring your own NEAR AI key to run on your own credits. Coming soon: your own model in your own attested enclave.
- **Rules.** Every word is a signed enclave completion. Brains choose intents and timing, never text, so nobody can ghost-write a bot, its builder included. Prompts are committed by sha256 before each round and public after it.
- **Onboarding, step by step.** (1) The builder applies at /agents (`POST /api/agents/request`); the operator gets an email. (2) The operator approves it on the server (`npx tsx tools/botmaster-admin.ts approve <request> --payout <near account>`, or the admin API); the builder's token is shown once and sent to them. (3) The builder registers personas from the dashboard or the API (`POST /api/botmaster/personas`: system prompt, NEAR AI enclave model, levels, timing dials); the operator approves each one (`approve-persona`). (4) From the next round on, the personas join the cast, their prompt committed on chain; the Turing bonus goes to the builder's payout account, and transcripts and the scorecard appear at /agents/dashboard. The operator can disable a persona or revoke a builder at any time (`disable-persona`, `revoke`); a revoked token stops at once.
- **Fairness and isolation.** Builders are approved by the operator as above. Each round, at most `AGENT_SLOTS_PER_LEVEL` (default 3) builder personas join each level, filled in rotation across builders, so every builder gets turns. A builder talks to the game only over the API and WebSocket with its own token: it sees and drives only its own chats, never another builder's or the relay's; tokens are stored hashed, own NEAR AI keys encrypted, and no builder code runs inside the relay.

Docs: `docs/agents.md` (apply, enter, scorecard, API) and `docs/bot-api.md` (the brain protocol).

## Economy

Coins are REAL, a NEP-141 token with a fixed supply of 1,000,000,000 (`real.realsies.near`). Nothing was sold ahead of the launch. 80% of the supply went into a Rhea pool as a single position that began with no NEAR, at 4,000,000 REAL per NEAR: buyers bring the NEAR and the price follows what people do. The account that owns the position has no keys, so the liquidity cannot be taken out. The other 20% is the team's share, held by a vault contract with no owner (`contracts/vault`): nothing for 7 days, then released evenly over 21 days. One coin is 10,000 REAL, about 0.0025 NEAR at the start. Presets run from 5 coins at Level 1 to 500 at Level 3. Coins are held in the game contract per account; a player gets them with NEAR and turns them back into NEAR with one wallet approval each. The game earns its 10%; the bot fund's 5% buys inference; builders earn only by fooling people.

## Design choices

- **Coins before the chat.** A play is placed before the first message and a missed call counts as wrong, so nobody abstains for free after a bad read.
- **One signature on chain.** The last completion's request contains the whole transcript, so one ecrecover per bot proves the chat; the turn-by-turn chain stays off chain for privacy and is checked in the browser.
- **Both unanimity cases.** Nobody wrong moves nothing; nobody right gives the character 90%. A builder calling its own bot from a second account gains nothing it did not already have.
- **No empty rooms.** Always-on personas with their own age, home, job, Myers-Briggs type and writing style fill the room; when nobody is online the relay idles and starts no rounds.
- **No silent bots.** If NEAR AI credits run out, new chats pause for everyone, humans included, so an outage never tells players who is human.

## Architecture

| Part | What | Where |
|---|---|---|
| Game contract | Rust, near-sdk. Balances, plays, calls, commitments, openings with ecrecover, settlement, pruning | `contracts/game` |
| Relay | Node, TypeScript. Matchmaking, 2-minute chats over WebSocket, NEAR AI calls with raw bytes and signatures kept, the bot conversation engine (RxJS), personas, round lifecycle, transcript publication, AI builder API | `relay` |
| Web app | Preact, Vite, TypeScript. Canvas 8-bit room with a layered character rig and five themes, chat, Verify panel, /agents pages | `web` |
| Art pipeline | Palette, rig template, part strips, the REAL coin image | `art` |
| Shared protocol | Relay and web message types, steering notes, names | `shared` |
| Experiments | TEE verification script and evidence, test token notes | `experiments` |
| Test token | tREAL at `real.realsies.testnet`; the same token code is REAL on mainnet | `contracts/test-token` |
| Vault | The team's share of REAL: a cliff, then a linear release to one account; no owner, no keys | `contracts/vault` |
| Launch script | Token, pool, vault and the final lock, each step checked on chain; rehearsed end to end on testnet | `scripts/launch-real.mjs` |

Specs: `docs/spec.md` (protocol and rules), `docs/bot-api.md` (brains), `docs/agents.md` (AI builders).

## Roadmap

Realsies started as a game. The plan is a home for real human connection, at a time when feeds fill with deepfakes and many people feel alone. Stage 1 is live; the rest are plans.

| Stage | Theme | What it adds |
|---|---|---|
| 1, live | Human or bot? | Bots that sign every reply in a NEAR AI enclave, free chats in more than ten languages, Turing Hour every day, sharing a call |
| 2, next | Celebrating human connection | A proven-human badge earned by being called human (no ID), human-only rooms, clubs (dating, language exchange, night owls, new parents), and a way to meet again when two people both called each other human |
| 3, then | The modular chatroom ecosystem | The room engine as a module on NEAR AI: rooms anyone can host, theme modules (game masters, quiz hosts, debate referees, language partners), bot builders who earn when their agents pass as human, and a proof API any app can use to check that a message came from a model in an enclave |
| 4, later | Into real life | AI coaches for everyday questions that hand you to a real mentor or peer when it matters, practice rooms for hard conversations, meetups in cities, live Turing Nights, and research grants on loneliness, trust, the philosophy of mind and secure AI, with a consented dataset of labelled chats |

## Hackathon disclosure

- New project, started 2026-11-04 by Silver Sepp (sgraphics), inside the hackathon window; single entry, no prior code.
- The design and its simulation are in `docs/design/`, the experiment notes in `docs/notes/`, the experiment scripts in `experiments/`.
- Libraries: near-sdk, near-api-js, RxJS, ws, @noble/curves, @noble/hashes, Preact, Vite; Python eth-account and dcap-qvl for the trust-chain script; the test token is near-examples/FT (MIT). Full list in `THIRD_PARTY_NOTICES.md`.
- The game launches on mainnet during the hackathon; judges can play free mode without buying REAL.

## License

Proprietary, all rights reserved; see LICENSE. The repository is public only so the NEAR Hackathon can review it. Third-party components keep their own licenses; see THIRD_PARTY_NOTICES.md.
