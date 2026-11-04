"""Generate signed test vectors for the game contract's unit tests.

Run with the repo's tooling venv (eth-account installed):
  .tooling/venv/Scripts/python.exe -I contracts/game/tests/gen_vectors.py

Uses a well-known throwaway private key (eth-account docs example), never a real one.
Formats follow docs/spec.md section 3.
"""
import hashlib
import json
from pathlib import Path

from eth_account import Account
from eth_account.messages import encode_defunct

KEY = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
acct = Account.from_key(KEY)

ROUND = 1
SECRET = "ab" * 32
BOT = "b0" * 16
HUMAN = "a0" * 16
MODEL = "z-ai/glm-5.3-flash"
PROMPT = "You are a test persona. Keep it short."
BOT_PAYOUT = "bots.testnet"
HUMAN_ACCOUNT = "dave.testnet"
BOT_SALT = "5a" * 32
HUMAN_SALT = "6b" * 32


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def handle(cid: str, viewer: str) -> str:
    return sha(f"realsies:v1|handle|{ROUND}|{cid}|{viewer}|{SECRET}")


signer = acct.address.lower()
prompt_hash = sha(PROMPT)
bot_pre = f"realsies:v1|bot|{ROUND}|{BOT}|{MODEL}|{prompt_hash}|{signer}|{BOT_PAYOUT}|{BOT_SALT}"
human_pre = f"realsies:v1|human|{ROUND}|{HUMAN}|{HUMAN_ACCOUNT}|{HUMAN_ACCOUNT}|{HUMAN_SALT}"


def proof(viewer: str, said: str) -> dict:
    tag = handle(BOT, viewer)[:16]
    req = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "system", "content": f"Your gamertag in this chat is RedFox435; the game generated it, you did not choose it. Game record: {tag}."},
            {"role": "user", "content": said},
        ],
        "stream": False,
        "max_tokens": 120,
    }, separators=(",", ":"))
    resp = json.dumps({"id": "x", "choices": [{"message": {"role": "assistant", "content": "lol hi"}}]}, separators=(",", ":"))
    text = f"{MODEL}:{sha(req)}:{sha(resp)}"
    sig = acct.sign_message(encode_defunct(text=text)).signature.hex()
    if not sig.startswith("0x"):
        sig = "0x" + sig
    return {"viewer": viewer, "text": text, "signature": sig, "request": req}


vectors = {
    "round_id": ROUND,
    "secret": SECRET,
    "secret_hash": sha(SECRET),
    "bot": {
        "character_id": BOT, "model": MODEL, "prompt": PROMPT, "prompt_hash": prompt_hash,
        "signers": [signer], "payout": BOT_PAYOUT, "salt": BOT_SALT,
        "preimage": bot_pre, "commitment": sha(bot_pre),
        "proofs": {"alice.testnet": proof("alice.testnet", "hey are you real"),
                   "bob.testnet": proof("bob.testnet", "sup")},
    },
    "human": {
        "character_id": HUMAN, "account": HUMAN_ACCOUNT, "payout": HUMAN_ACCOUNT, "salt": HUMAN_SALT,
        "preimage": human_pre, "commitment": sha(human_pre),
    },
    "handles": {
        "alice_bot": handle(BOT, "alice.testnet"),
        "bob_bot": handle(BOT, "bob.testnet"),
        "carol_bot": handle(BOT, "carol.testnet"),
        "carol_human": handle(HUMAN, "carol.testnet"),
        "erin_human": handle(HUMAN, "erin.testnet"),
    },
}
out = Path(__file__).with_name("vectors.json")
out.write_text(json.dumps(vectors, indent=2))
print("wrote", out, "signer", signer)
