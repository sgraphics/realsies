#!/usr/bin/env python
"""
Realsies experiment: prove that a NEAR AI Cloud completion came from an attested TEE model.

Mirrors docs.near.ai/cloud/verification and nearai/nearai-cloud-verifier (py/chat_verifier.py):
  1. attestation report with a fresh 32-byte nonce (public endpoint, no key needed)
     - nonce echoed; report_data == signing_address || zero pad || nonce (gateway and model)
     - NVIDIA payload nonce echoed
     - optional: Intel TDX quote verification with dcap-qvl (collateral from Phala PCCS / Intel PCS)
  2. chat completion (needs NEAR_AI_API_KEY): raw request bytes and raw response bytes kept
  3. GET /v1/signature/<chat id>?signing_algo=ecdsa
  4. text == "<model>:<sha256(request)>:<sha256(response)>", EIP-191 signer recovered and compared
     with the attested model signing_address from step 1.

Usage:
  python verify_tee.py [--model z-ai/glm-5.3-flash] [--prompt "..."] [--out runs/] [--no-dcap]
  env NEAR_AI_API_KEY=...   (without it, only step 1 runs)
"""
import argparse
import asyncio
import hashlib
import inspect
import json
import os
import secrets
import sys
import time
from pathlib import Path

import requests

BASE = "https://cloud-api.near.ai"


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def report_data_of(rep: dict) -> str:
    rd = rep.get("report_data")
    if rd:
        return rd.lower()
    quote = bytes.fromhex(rep["intel_quote"])
    # TDX quote v4: 48-byte header, report_data at body offset 520, 64 bytes
    return quote[48 + 520: 48 + 520 + 64].hex()


def check_binding(label: str, rep: dict, nonce: str) -> bool:
    addr = rep["signing_address"].lower().replace("0x", "")
    ok_nonce = rep.get("request_nonce") == nonce
    ok_rd = report_data_of(rep) == addr + "0" * 24 + nonce
    print(f"  [{label}] signer={rep['signing_address']} algo={rep['signing_algo']} "
          f"nonce_echoed={ok_nonce} report_data_binding={ok_rd}")
    return ok_nonce and ok_rd


async def dcap_verify(quote_hex: str) -> str:
    try:
        import dcap_qvl
    except ImportError:
        return "dcap-qvl not installed"
    quote = bytes.fromhex(quote_hex)
    last = "no PCCS reachable"
    for pccs in (dcap_qvl.PHALA_PCCS_URL, dcap_qvl.INTEL_PCS_URL):
        try:
            col = dcap_qvl.get_collateral(pccs, quote)
            col = await col if inspect.isawaitable(col) else col
            v = dcap_qvl.verify(quote, col, int(time.time()))
            v = await v if inspect.isawaitable(v) else v
            return f"status={getattr(v, 'status', v)} advisories={getattr(v, 'advisory_ids', None)} via {pccs}"
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {str(e)[:160]}"
    return f"FAILED {last}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="z-ai/glm-5.3-flash")
    ap.add_argument("--prompt", default="Reply in one short sentence: what is the capital of Estonia?")
    ap.add_argument("--out", default=str(Path(__file__).parent / "runs"))
    ap.add_argument("--no-dcap", action="store_true")
    a = ap.parse_args()
    run = Path(a.out) / time.strftime("%Y%m%d-%H%M%S")
    run.mkdir(parents=True, exist_ok=True)
    key = os.environ.get("NEAR_AI_API_KEY")
    auth = {"Authorization": f"Bearer {key}"} if key else {}

    # 1. attestation
    nonce = secrets.token_hex(32)
    print(f"1. attestation for {a.model}, nonce={nonce[:16]}...")
    r = requests.get(
        f"{BASE}/v1/attestation/report",
        params={"model": a.model, "provider": "near", "include_tls_fingerprint": "false",
                "signing_algo": "ecdsa", "nonce": nonce},
        headers={"Accept": "application/json", "x-no-aliasing": "true", **auth},
        timeout=120,
    )
    r.raise_for_status()
    att = r.json()
    (run / "attestation.json").write_bytes(r.content)
    gw = att["gateway_attestation"]
    models = att.get("model_attestations") or []
    if not models:
        sys.exit("no model_attestations in report; use the canonical model id")
    ok = check_binding("gateway", gw, nonce)
    cands = [m for m in models if m.get("model_name") == a.model]
    for m in cands:
        ok &= check_binding("model " + m["model_name"], m, nonce)
        nv = json.loads(m["nvidia_payload"]) if m.get("nvidia_payload") else {}
        print(f"  [model] nvidia nonce_echoed={nv.get('nonce') == nonce} "
              f"gpu_evidence={len(nv.get('evidence_list', []))}")
    if not a.no_dcap and cands:
        print("  [dcap] model quote:", asyncio.run(dcap_verify(cands[0]["intel_quote"])))
    attested = {m["signing_address"].lower() for m in cands if m["signing_algo"] == "ecdsa"}
    print(f"  attested model signer(s): {sorted(attested)}  binding_ok={ok}")

    if not key:
        print("\nNEAR_AI_API_KEY not set: stopping after attestation. "
              "Set it to run the signed completion check (steps 2-4).")
        return

    # 2. chat completion, raw bytes retained
    body = {
        "model": a.model,
        "messages": [
            {"role": "system", "content": "You are Pip, a cheerful pixel-art shopkeeper. Keep answers short."},
            {"role": "user", "content": a.prompt},
        ],
        "stream": False,
        "max_tokens": 80,
    }
    body_bytes = json.dumps(body, separators=(",", ":")).encode()
    print("\n2. chat completion")
    resp = requests.post(
        f"{BASE}/v1/chat/completions", data=body_bytes, timeout=120,
        headers={"Content-Type": "application/json", "Accept-Encoding": "identity",
                 "x-no-aliasing": "true", **auth},
    )
    resp.raise_for_status()
    resp_bytes = resp.content
    (run / "request.json").write_bytes(body_bytes)
    (run / "response.json").write_bytes(resp_bytes)
    chat = resp.json()
    chat_id = chat["id"]
    reply = chat["choices"][0]["message"]["content"]
    print(f"  id={chat_id} model={chat.get('model')} reply={reply[:120]!r}")
    req_hash, resp_hash = sha256_hex(body_bytes), sha256_hex(resp_bytes)

    # 3. signature (retry: the lookup may land on another node)
    print("3. signature")
    sig = None
    s = None
    for _ in range(10):
        s = requests.get(f"{BASE}/v1/signature/{chat_id}", params={"signing_algo": "ecdsa"},
                         headers={"Accept": "application/json", **auth}, timeout=60)
        if s.status_code == 200 and "signature" in s.json():
            sig = s.json()
            break
        time.sleep(1.5)
    if not sig:
        sys.exit(f"  no signature after retries: {s.status_code} {s.text[:200]}")
    (run / "signature.json").write_bytes(s.content)
    print(f"  kind={sig.get('signature_kind')} algo={sig.get('signing_algo')} signer={sig.get('signing_address')}")
    print(f"  text={sig['text']}")

    # 4. verify
    print("4. verify")
    parts = sig["text"].split(":")
    if sig.get("signature_kind") == "provider_tee":
        ok_model = parts[0] == a.model
        ok_req, ok_resp = parts[1] == req_hash, parts[2] == resp_hash
    else:
        ok_model = None
        ok_req, ok_resp = parts[0] == req_hash, parts[1] == resp_hash
    from eth_account import Account
    from eth_account.messages import encode_defunct
    recovered = Account.recover_message(encode_defunct(text=sig["text"]), signature=sig["signature"])
    ok_sig = recovered.lower() == sig["signing_address"].lower()
    ok_attested = sig["signing_address"].lower() in attested
    print(f"  model_id_in_text={ok_model} request_hash={ok_req} response_hash={ok_resp}")
    print(f"  signature_recovers_to_signer={ok_sig} signer_is_attested_model_tee={ok_attested}")
    checks = [x for x in (ok_model, ok_req, ok_resp, ok_sig, ok_attested, ok) if x is not None]
    proven = all(checks)
    print(f"\nVERDICT: {'PROVEN: reply came from attested TEE model ' + a.model if proven else 'NOT PROVEN'}")
    (run / "verdict.json").write_text(json.dumps({
        "model": a.model, "chat_id": chat_id, "request_hash": req_hash, "response_hash": resp_hash,
        "signer": sig["signing_address"], "attested": sorted(attested), "proven": proven}, indent=2))


if __name__ == "__main__":
    main()
