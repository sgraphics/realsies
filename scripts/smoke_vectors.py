"""Vectors for an on-chain smoke round on a throwaway copy of the game contract.
Usage: python smoke_vectors.py <round_id> <ends_at_ms>  -> JSON on stdout
Viewers are ana and ben; the bot's "enclave" signer is a well-known throwaway test key.
"""
import hashlib
import json
import secrets
import sys

from eth_account import Account
from eth_account.messages import encode_defunct

KEY = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"
acct = Account.from_key(KEY)
ROUND = int(sys.argv[1])
SECRET = secrets.token_hex(32)
BOT = secrets.token_hex(16)
MODEL = "z-ai/glm-5.3-flash"
PROMPT = "You are a smoke-test persona."
PAYOUT = "bots.realsies.testnet"
SALT = secrets.token_hex(32)
VIEWERS = ["ana.realsies.testnet", "ben.realsies.testnet"]


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def handle(viewer: str) -> str:
    return sha(f"realsies:v1|handle|{ROUND}|{BOT}|{viewer}|{SECRET}")


signer = acct.address.lower()
pre = f"realsies:v1|bot|{ROUND}|{BOT}|{MODEL}|{sha(PROMPT)}|{signer}|{PAYOUT}|{SALT}"
proofs = []
for v in VIEWERS:
    req = json.dumps({"model": MODEL, "messages": [
        {"role": "system", "content": PROMPT},
        {"role": "system", "content": f"Your gamertag in this chat is BoldOtter42; the game generated it, you did not choose it. Game record: {handle(v)[:16]}."},
        {"role": "user", "content": "hi"}]}, separators=(",", ":"))
    text = f"{MODEL}:{sha(req)}:{sha('resp-' + v)}"
    sig = acct.sign_message(encode_defunct(text=text)).signature.hex()
    proofs.append({"viewer": v, "text": text, "signature": sig if sig.startswith("0x") else "0x" + sig, "request": req})

print(json.dumps({
    "round_id": ROUND, "secret": SECRET, "secret_hash": sha(SECRET), "ends_at_ms": int(sys.argv[2]),
    "commit": [{"character_id": BOT, "commitment": sha(pre)}],
    "handles": {v: handle(v) for v in VIEWERS},
    "opening": [{"character_id": BOT, "kind": "bot", "salt": SALT, "payout": PAYOUT, "model": MODEL,
                 "prompt_hash": sha(PROMPT), "signers": [signer], "proofs": proofs}],
}))
