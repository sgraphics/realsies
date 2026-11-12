# Testnet coin: tREAL at real.realsies.testnet

2026-11-04. A plain NEP-141 token for building and testing the game against, with the same interface the meme.cooking token will have on mainnet. The game contract takes the token account as a parameter, so swapping to the mainnet coin is a config change.

## Accounts and transactions

| Item | Value |
|---|---|
| Owner account | realsies.testnet, created through the faucet with 10 NEAR, 5.5 NEAR left after the steps below |
| Token contract | real.realsies.testnet, funded with 4 NEAR; the code uses 281 KB of storage |
| Deploy and init | CJsYXbUgR2SyzX8ivD3Rm87QsKpPmk8qFNK8dWaFeAyR |
| Test player | p1.realsies.testnet, 0.5 NEAR, registered on the token with storage_deposit (2C2AU19AYP4R275c8kRPSKwQvJci8MkWSga4nQ7jNQQ7) |
| First transfer | 1,000 tREAL owner to p1 with memo "starter coins" (9qbTpohcWAP9B1vZCaHbfVUmU6F616TNVLfi7e5yxoPy), NEP-141 ft_transfer event emitted |
| Keys | legacy keychain, `~/.near-credentials/testnet/` (full-access keys for all three accounts) |

Metadata: spec ft-1.0.0, name "Realsies Test Coin", symbol tREAL, 18 decimals, total supply 1,000,000,000 (1e27 base units), a 16 × 16 pixel coin icon as an SVG data URI. Amounts in calls are base units: 1 tREAL = 1000000000000000000.

Source: near-examples/FT at the commit cloned on 2026-11-04 (near-sdk 5.29.1, near-contract-standards 5.29.1), built with `cargo build --release --target wasm32-unknown-unknown`. The wasm is kept at `contracts\test-token\fungible_token.wasm`, sha256 10c8af7a90dd4118dba92b563ba876a0e90a01309bae6b16f9363961d2e1e186.

## Commands

The CLI lives at `.tooling\bin\near.exe` (near-cli-rs 0.30.1); cargo-near 0.22.0 is in `~/.cargo/bin`.

Register an account on the token (once per account, 0.00125 NEAR):

```
near contract call-function as-transaction real.realsies.testnet storage_deposit json-args '{"account_id":"<account>"}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as realsies.testnet network-config testnet sign-with-legacy-keychain send
```

Send coins:

```
near contract call-function as-transaction real.realsies.testnet ft_transfer json-args '{"receiver_id":"<account>","amount":"1000000000000000000000","memo":"starter coins"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as realsies.testnet network-config testnet sign-with-legacy-keychain send
```

Read a balance:

```
near contract call-function as-read-only real.realsies.testnet ft_balance_of json-args '{"account_id":"<account>"}' network-config testnet now
```

The game contract will receive coins through `ft_transfer_call` with a msg, which this token supports as standard.

## Notes for the game contract build

- cargo-near's build fails on this machine because its ABI pass compiles the test dependencies, and near-sandbox pulls aws-lc-sys, which needs the NASM assembler on Windows. Either install NASM or build with plain cargo as above and skip the ABI.
- The near-examples repo pins Rust 1.97.1 in rust-toolchain.toml; rustup installs it on first build, and the wasm32 target has to be added to that toolchain separately.
- Testnet faucet accounts come with 10 NEAR. Contract storage costs 1 NEAR per 100 KB, so a 280 KB contract needs about 3 NEAR on its account.
