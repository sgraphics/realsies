# Realsies

An 8-bit chat room where you play a few coins, talk to a character for two minutes, and call it: real human, yes or no. Some characters are other players. Some are bots running on NEAR AI's confidential models, and every word they say is signed inside the enclave, so when the round ends the room can prove who was a bot. Read the room right and you take the coins of those who read it wrong. Fool the room and you earn too.

**Status, 2026-11-04: design complete, nothing built yet.** Mainnet launch planned for 2026-11-11 with the REAL token raised on meme.cooking. Built for the NEAR Hackathon (deadline 2026-11-14). Tracks: games, privacy, memecoins, open.

## The problem

Human or Not proved people want to play this: AI21's 2023 run had over 10 million conversations in a month and 68% accuracy. But that game had no stakes, no way to know what you actually talked to, and no way for anyone else to enter a bot. Realsies adds all three: coins, enclave-signed bots, and an open arena with a bot fund.

## Try it

Once live:

1. Open https://realsies.xyz. Tap Play, pick a NEAR wallet, sign a message. See the room with 10 characters whose names and faces were generated for you.
2. Deposit a few REAL to earn, or skip and play free. See your coin balance, or "Free mode", on the pillar.
3. Tap a character, choose 5 coins if you hold any, chat for two minutes, answer Real human? Yes / No. See "Locked until the round ends" with the clock.
4. When the round ends, open Results. See each character revealed, your score and rating, your coins won if you played coins, and a Verified button on every bot.
5. Tap Verified. See the enclave attestation, the signature chain over the transcript, and the recovered signer matching the on-chain commitment.

Today, without the game, the trust chain can be reproduced on its own:

```
python -m venv venv && venv/Scripts/pip install requests eth-account dcap-qvl
set NEAR_AI_API_KEY=<your key from cloud.near.ai>
python experiments/near-ai/verify_tee.py --model z-ai/glm-5.3-flash
```

See `VERDICT: PROVEN` after the script fetches a fresh attestation with its own nonce, checks the nonce and signer inside the Intel TDX quote, verifies the quote against Intel collateral, asks the model one question, fetches the completion signature, and recovers the signer. Without a key it stops after the attestation checks, which need none.

## How a round works

- **Play, chat, call.** Coins go in before the chat. A chat is two minutes. The call is one question.
- **Symmetric.** When two humans meet, both play and both call each other.
- **Rewards.** For each character, the coins of the wrong paid calls split 70% to the right paid callers pro rata, 20% to the character as a Turing bonus, 10% to the game. 5% of every play goes to the bot fund that pays inference. Nobody wrong, nothing moves. Free calls never touch the reward.
- **Free mode.** Anyone with a wallet plays, scores and is rated without coins, three chats a day. Free players cannot win or lose coins; they are the humans in the room.
- **Rounds** last 6 hours. Characters are committed on chain at round start and opened at round end. A character that is not opened is void and refunded, so silence never counts as human.
- **Skill.** A reader rating moves by how surprising each call was against the paid room's split. Levels unlock by rating, not by coins, and can be reached free.

## Why a bot is provable

NEAR AI Cloud runs its models inside Intel TDX enclaves with NVIDIA GPU attestation and signs every completion over `model id : sha256(request bytes) : sha256(response bytes)` with an EIP-191 key that exists only inside the enclave. The attestation report, fetched with a caller's nonce, binds that key into the TDX quote's report_data.

At round start the game commits, per bot, to the model id, the hash of the persona's system prompt and the attested signing address. At round end it opens the commitment with the signature of the round's last completion; that request carried the system prompt and the whole transcript, so one signature commits to all of it. The contract checks the signature with ecrecover. A public panel checks the turn-by-turn chain. The operator cannot swap the model, edit the prompt, ghost-write a reply or rewrite history without the character failing to open.

What is not proven: that a human seat is a human. That rests on the account's rating history and coins. Said plainly in the trust section of the app.

Evidence from 2026-11-04: model z-ai/glm-5.3-flash, attested signer 0x3b753b4406613c5e70ae640508632b600424fa0c, completion id c6bba1f4dd0243f89c77ed4045e3d056, both quotes UpToDate under dcap-qvl, signature recovered to the attested signer. Artifacts in `experiments/near-ai/runs/`.

## Economy

Coins are REAL, a NEP-141 token raised on meme.cooking: same price for every depositor, half the supply plus all deposited NEAR locked in a Ref pool for 69 years, a 20% team allocation with a 1-month cliff and 3-month vesting. One coin is a fixed number of REAL chosen at launch so that a coin is about one cent. Presets run from 5 coins at Level 1 to 500 at Level 3. Coins are held in the game contract per account; deposit and withdraw are one call each.

## Architecture

| Part | What | Where |
|---|---|---|
| Game contract | Rust, near-sdk. Balances, plays, calls, commitments, openings with ecrecover and ed25519, settlement. Seven calls and a config | `contracts/game` |
| Relay | Node. Matchmaking, 2-minute chats over WebSocket, NEAR AI calls with raw bytes and signatures retained, skins, round lifecycle, transcript publication | `relay` |
| Web app | Vite + TypeScript. Canvas 8-bit room with a 14-layer character rig and five themes, DOM chat input, NEAR Connect sign-in with a limited-access key | `web` |
| Art pipeline | Palette, rig template, part strips from image models, normalise scripts | `art` |
| Experiments | TEE verification script, test token notes | `experiments` |
| Test token | tREAL at real.realsies.testnet for internal testing | `contracts/test-token` |

## NEAR features used

- NEAR AI Cloud confidential inference: attestation reports, response signatures, enclave models (glm-5.3-flash, Qwen3.8-27B, DeepSeek V4.1 Flash).
- NEP-141 token launched on meme.cooking; NEP-141 ft_transfer_call for deposits.
- NEAR Connect for sign-in; limited-access keys so plays and calls need no popups.
- Host functions ecrecover, keccak256 and ed25519_verify in the contract.
- Rhea and NEAR Intents for buying REAL with any token.

## Hackathon disclosure

New project, started 2026-11-04 by Silver Sepp (sgraphics), single entry. No prior code; the design, simulation and experiments are in this repository under `.bl0x/topics/near-hackathon/` and `experiments/`. The game launches on mainnet during the hackathon; judges can play free mode without buying REAL.

## Licence

MIT.
