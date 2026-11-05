# Third-party notices

The Realsies code, contracts, art and texts are proprietary (see LICENSE). The components below belong to
their authors and keep their own licenses.

## Included in this repository

### contracts/test-token/fungible_token.wasm

A compiled build of the NEAR fungible-token example, https://github.com/near-examples/FT, used only as the
testnet test coin (tREAL). Licensed under MIT or Apache-2.0. MIT notice:

```
Copyright 2020 NEAR Inc

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### experiments/near-ai/evidence/

Responses recorded from NEAR AI Cloud (an attestation report, one completion and its signature) on
2026-11-04, kept unmodified because their hashes are signed by the enclave.

### Test vectors

`contracts/game/tests/gen_vectors.py` and `scripts/smoke_vectors.py` sign test data with the well-known
example private key from the eth-account documentation. It is public, holds nothing, and is used for
nothing else.

## Installed by package managers, not included

These are fetched at build time from their registries under their own licenses (mostly MIT, ISC,
Apache-2.0 and BSD; fonts under the SIL Open Font License 1.1). The lockfiles list exact versions.

| Where | Main dependencies |
|---|---|
| `contracts/game` | near-sdk, uint (MIT or Apache-2.0) |
| `relay` | near-api-js, ws, rxjs, @noble/curves, @noble/hashes |
| `web` | preact, @noble/curves, @noble/hashes, @fontsource/press-start-2p and @fontsource/pixelify-sans (fonts, OFL-1.1), vite |
| `art`, `trailer` | TypeScript tooling; vite for `art` |
