# Evidence: one signed NEAR AI enclave completion, 2026-11-04 17:33 UTC

Produced by `experiments/near-ai/verify_tee.py --model z-ai/glm-5.3-flash`.

- `request.json`: the exact request bytes sent. sha256 = c0a2b8b967e9a65419672ac86c2d4d75c95acc4f2d7b470330cb2bce4feae9c0
- `response.json`: the exact response bytes received. sha256 = bbfbf6054ccffb4f5d80c67af1a8de0b33b686ac4f495fb8c9102011fa7532ae
- `signature.json`: from GET /v1/signature/{id}; the EIP-191 signature recovers to 0x3b753b4406613c5e70ae640508632b600424fa0c
- `attestation.json`: the attestation report fetched just before, binding that address and our nonce into the Intel TDX quote
- `verdict.json`: the script's summary

The game contract's unit tests verify this signature on chain logic, and the web app's mock client uses it for the Verify drawer.
