# Realsies vesting vault

Holds one NEP-141 token (the team's REAL allocation) for one beneficiary and releases it on a fixed schedule. Rust, near-sdk 5.29.1, about 150 lines in `src/lib.rs`. There is no owner, no setter and no upgrade method. After deployment the vault account's access keys are deleted, so nobody can change the code, the schedule or the beneficiary, or take the tokens out early.

## Schedule

Times are block times in milliseconds. `total` is everything the vault has received, top-ups included.

```
cliff_end = start_ms + cliff_ms
released(t) = 0                                       if t < cliff_end
            = floor(total * (t - cliff_end) / vesting_ms)  if cliff_end <= t < cliff_end + vesting_ms
            = total                                   if t >= cliff_end + vesting_ms
claimable(t) = released(t) - claimed
```

Nothing is released before the cliff end. From then on the total is released linearly, and all of it by `start_ms + cliff_ms + vesting_ms` (`fully_released_at_ms`). With `vesting_ms` 0 everything is released at the cliff end. Rounding is down, so the last base units arrive at the end. A top-up vests on the same schedule: it raises `total`, so part of it is claimable at once if the vault is past the cliff. The mul-div is exact and cannot overflow for any u128 total and u64 durations (`mul_div` in `src/lib.rs`).

## Methods

| Method | Who | What |
|---|---|---|
| `new {"token","beneficiary","cliff_ms","vesting_ms","start_ms"?}` | the vault account, once (in the deploy transaction) | Sets everything. Durations and `start_ms` are strings (U64). `start_ms` defaults to the block time. |
| `ft_on_transfer` | the token only | Receiving end of `ft_transfer_call` on `token`. Adds the amount to `total` and keeps all of it. Any other caller panics, so other tokens bounce back. `msg` is ignored. Anyone may top up. |
| `claim {}` | anyone, 50 Tgas | Sends everything claimable to `beneficiary` with `ft_transfer` (1 yoctoNEAR from the vault's own balance). Panics with `nothing to claim` when there is nothing. `claimed` is raised before the transfer. |
| `on_claim` | the vault itself (private callback) | If the transfer failed (for example the beneficiary is not registered on the token), lowers `claimed` again so the tokens can be claimed later. |
| `get_info {}` | view | `token, beneficiary, start_ms, cliff_ms, vesting_ms, total, claimed, released_now, claimable_now, fully_released_at_ms`; amounts are strings, times are numbers. |

near-sdk also adds the read-only `contract_source_metadata` view (NEP-330) to every contract.

Events: `EVENT_JSON:{"standard":"realsies_vault","version":"1.0.0","event":…,"data":[…]}` with `deposit {from, amount, total}`, `claim {beneficiary, amount, claimed}` and `claim_failed {beneficiary, amount, claimed}`.

## Build and test

```
cargo test                                     # 19 unit tests; on Windows set AWS_LC_SYS_PREBUILT_NASM=1
RUSTFLAGS="--cfg near" cargo build --release --target wasm32-unknown-unknown
wasm-opt -Oz --enable-bulk-memory target/wasm32-unknown-unknown/release/realsies_vault.wasm -o realsies_vault.wasm
sha256sum realsies_vault.wasm                  # compare with realsies_vault.wasm.sha256
```

Same toolchain (Rust 1.97.1) and release profile as `contracts/game`. `--cfg near` is required with plain cargo (see the game README). Rust 1.97 emits bulk-memory instructions, so wasm-opt needs `--enable-bulk-memory`; the same command reproduces the game's committed wasm byte for byte. `realsies_vault.wasm` is 128,396 bytes, so the code needs about 1.28 NEAR of storage (the testnet account used 128,656 bytes in all after its key was deleted).

The code hash NEAR shows for an account is the base58 of the wasm's sha256. For this build it is `97YKNAXyRZmKX6zUZgU6RbBuynY8Wp8gxaByXQKiSszG`.

## Deploy, fund, lock (mainnet outline)

Replace `VAULT`, `TOKEN`, `TEAM` and the times. Every call ends with `network-config mainnet sign-with-legacy-keychain send` (or another signer).

1. Create `VAULT` with about 2 NEAR. It pays its storage (about 1.29 NEAR, code and state) and 1 yoctoNEAR per claim, forever. Anyone can still send it NEAR later with a plain transfer.
2. Register `VAULT` on the token, and make sure `TEAM` is registered too (a claim to an unregistered beneficiary fails and is restored, it is not lost):
   `near contract call-function as-transaction TOKEN storage_deposit json-args '{"account_id":"VAULT","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as VAULT ...` (use the amount from `storage_balance_bounds`)
3. Deploy and initialise in one transaction (`new` is private, so nobody else can initialise it first):
   `near contract deploy VAULT use-file realsies_vault.wasm with-init-call new json-args '{"token":"TOKEN","beneficiary":"TEAM","cliff_ms":"15552000000","vesting_ms":"31104000000"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' ...`
   (that example is a 180-day cliff and 360 days of vesting). Then check `get_info` and that the account's code hash is the one above.
4. Fund with `ft_transfer_call`, never plain `ft_transfer`. Tokens that arrive by plain `ft_transfer` are not counted in `total` and stay in the vault for good:
   `near contract call-function as-transaction TOKEN ft_transfer_call json-args '{"receiver_id":"VAULT","amount":"<base units>","msg":""}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as FUNDER ...`
   Check `get_info` (`total`) and `ft_balance_of {"account_id":"VAULT"}`.
5. Delete the vault's access keys: `near account list-keys VAULT network-config mainnet now`, then `near account delete-keys VAULT public-keys <each key> network-config mainnet sign-with-legacy-keychain send`, then `list-keys` again: it must be empty. From here on the vault is locked; only `claim` and top-ups do anything.
6. After the cliff, anyone claims: `near contract call-function as-transaction VAULT claim json-args '{}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' sign-as ANYONE ...`. The tokens always go to `TEAM`.

Choose `TEAM` with care: it can never be changed. If it loses its keys, the tokens still go to it and are stuck there.

## Testnet run (2026-11-10)

Throwaway accounts only. Vault `vault-try-505121.testnet` and beneficiary `vault-ben-505121.testnet` came from the faucet. The token was `trh.rhea-try-891ea1.testnet` (tRH, 18 decimals, the near-examples FT), funded by its owner `rhea-try-891ea1.testnet`. Schedule: `start_ms` 1794300040530 (deploy block), 2 minute cliff, 4 minutes of vesting, so the cliff ended at 1794300160530 and everything was released at 1794300400530. Funded with 1,000,000 tRH.

| Step | Tx | Result |
|---|---|---|
| Register the vault on the token | 7bbRN8MLUobwtzTvBPqfuUdvAyeKruRQaRUWP7oWZqVi | ok |
| Deploy and `new` in one transaction | 6DjKuo2N1Wtet7ocT74tsuNdrDrZtdFGR2a2A8r4TVs7 | code hash `97YKNAXy…` as above |
| `ft_transfer_call` 1,000,000 tRH | FwT7dXth7mvCGaQ37jFAuUdV2dPm175qF9KFS8TPd1iT | `deposit` event, total 1e24; vault balance 1e24, owner's balance down by exactly 1e24 |
| Claim before the cliff | 5SYZzmJwGSgC6NGpaeebCkuoMPjveT2X4Sycvkuf2TgR | at block time 1794300050198: `Smart contract panicked: nothing to claim` |
| `ft_on_transfer` called directly by an account | DeYWmoG9VtDDjb5hbRFyawQK3oppiutcxHDd63L159HB | `only the vault token is accepted` |
| `new` again, by another account | HtyDKb1GHdMNtKQSAVzQUknbtsBt3u8a4xbM46TCdiBu | `Method new is private` |
| Midway claim, beneficiary not yet registered on the token | zSuYvpKaYKRcMbfJa5BaWyKLghCL8TbSk99G4deLMdU | `claim` 522,562.5 tRH at block time 1794300285945 (125,415 ms after the cliff: 1e24 × 125415 / 240000, exact); `ft_transfer` failed (`not registered`); `claim_failed`, `claimed` back to 0, vault still held 1e24 |
| Beneficiary registers on the token | 3GT2UdwFpdf5fEV8UdNgz8Km2WkspwZvcYBW91YgbhJY | ok |
| Midway claim | 4wKGn73Tk6RoCf6EcPGWT1L6zq89WuoJgRW6FBnvtCK8 | 564,362.5 tRH at block time 1794300295977 (135,447 ms: 1e24 × 135447 / 240000, exact). Balances: beneficiary 564,362.5, vault 435,637.5 |
| Delete the vault's only access key | FbHAoFj5wSWUH38DDwQSE8hFp59qpn5B2Xd9mfoFTaxo | `view_access_key_list` empty |
| Claim after the end, sent by `rhea-try-891ea1.testnet` (not the vault, not the beneficiary) | 6FKWXZEfGZqG88JwdwyoW7QUdxDwXUbvMBytHEafp6ZG | 435,637.5 tRH to the beneficiary at block time 1794300407176. Balances: beneficiary 1,000,000, vault 0; `claimed` = `total` |
| Claim again | He3YCv3sZ826EsYp5WqkGYXzjL9Ync5xkEf1py1YFDUE | `nothing to claim` |

A claim burns about 5.3 Tgas in all (claim 2.1, `ft_transfer` 1.9, callback 1.3) and costs the vault 1 yoctoNEAR.
