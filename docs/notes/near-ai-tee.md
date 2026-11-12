# Experiment: NEAR AI Cloud TEE attestation, verified locally

2026-11-04. Script: `experiments\near-ai\verify_tee.py` (Python, venv in `.tooling\venv` with requests, eth-account, dcap-qvl). Raw report saved as `.tooling\attestation-glm.json` (303 KB).

## What was tested

| Step | Needs key | Result |
|---|---|---|
| List models at `/v1/models` | no | 64 models. Enclave-hosted (owner `nearai`): z-ai/glm-5.3-flash, Qwen/Qwen3.8-27B, Qwen/Qwen3.6-35B-A3B-FP8, deepseek-ai/DeepSeek-V4.1-Flash-1017, plus abliterated variants, Qwen3-VL, whisper, embeddings, FLUX image. A second class `attested 3p` (deepseek-v3.2, kimi-k2.6, kimi-k3, qwen3.5-397b, glm-5.3) is third-party attested. Anthropic, OpenAI, Google, xAI ids are proxied |
| Attestation report at `/v1/attestation/report` with a fresh 32-byte nonce | **no**, the endpoint is public | HTTP 200. Gateway report plus one model report for z-ai/glm-5.3-flash, both with Intel TDX quotes, dstack event logs, app_compose manifests, and the model's NVIDIA GPU evidence (8 items) |
| Nonce echoed in gateway, model and GPU evidence | no | true, true, true |
| report_data binding: first 20 bytes = ecdsa signing address, 12 zero bytes, last 32 bytes = our nonce | no | true for the gateway (field given) and for the model (parsed from the quote at body offset 520) |
| Intel TDX quote verification with dcap-qvl against Phala's PCCS collateral | no | model quote: status UpToDate, no advisories. Gateway quote: status UpToDate, no advisories |
| Chat completion, signature fetch, EIP-191 recovery, match to the attested signer | **yes** | **PROVEN** on 2026-11-04 17:35 UTC with the owner's key: completion id c6bba1f4dd0243f89c77ed4045e3d056, signature kind provider_tee, text `z-ai/glm-5.3-flash:c0a2b8…:bbfbf6…`, request and response hashes matched the bytes we sent and received, signer recovered to 0x3b753b4406613c5e70ae640508632b600424fa0c, the attested model signer. The reply was "Tallinn, friend, lovely little capital by the sea!" |

Observed signers on 2026-11-04 (they change when the enclave restarts, so pin per round, never hard-code):

| Report | signing_address (ecdsa) | app |
|---|---|---|
| gateway | 0xb98a789cdc4817275f5155593ba73ef2a957e779 | dstack-0.5.12 |
| model z-ai/glm-5.3-flash | 0x3b753b4406613c5e70ae640508632b600424fa0c | dstack-nvidia-0.5.11 |

## Enclave model prices, per million tokens

| Model | Input | Output | Context |
|---|---|---|---|
| z-ai/glm-5.3-flash | $0.08 | $0.50 | 1M |
| Qwen/Qwen3.8-27B | $0.04 | $1.35 | 262k |
| Qwen/Qwen3.6-35B-A3B-FP8 | $0.17 | $1.10 | 262k |
| deepseek-ai/DeepSeek-V4.1-Flash-1017 | $0.30 | $1.20 | 1M |

A two-minute chat is about 20 turns of 60 tokens with a growing history: roughly 15k input and 1.2k output tokens, under a quarter of a cent on glm-5.3-flash. A room of 10 bots for a 6-hour round with 200 chats costs well under a dollar.

## What this means for the design

- The Verified panel can fetch the attestation in the browser with no secret: anyone can check the enclave, the nonce and the signer without trusting the game.
- The signature endpoint needs the key, so the game's relay fetches and stores every completion signature and publishes them with the round. Players and judges verify them offline with the script or in NEAR's Verification Center at cloud.near.ai/verify.
- Signed text is `model id:sha256(request bytes):sha256(response bytes)`, EIP-191 over the UTF-8 text, secp256k1, recovered with eth-account's `recover_message`. NEAR's own verifier does exactly this, so an on-chain check is `keccak256("\x19Ethereum Signed Message:\n" + len + text)` then `ecrecover`, both host functions in near-sdk.
- Requests must go out with `Accept-Encoding: identity` and `x-no-aliasing: true`, with the canonical model id, and the relay must hash the exact bytes it sent and received, never re-serialised JSON.
- The signer is rotated when the enclave restarts. A bot's commitment at round start therefore pins the signer observed in a fresh attestation; a restart mid-round makes later completions recover to a different address and the character voids. Acceptable for 6-hour rounds; worth a retry-on-restart rule later.

## How to run

```
set NEAR_AI_API_KEY=...            (optional; without it only the attestation steps run)
.tooling\venv\Scripts\python.exe -I experiments\near-ai\verify_tee.py --model z-ai/glm-5.3-flash
```

Outputs land in `experiments\near-ai\runs\<timestamp>\` as attestation.json, request.json, response.json, signature.json and verdict.json.
