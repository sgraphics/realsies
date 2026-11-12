# Rhea (Ref) DCL pool rehearsal on testnet: token-only liquidity

2026-11-10, NEAR testnet only. Question: can a fixed-supply NEP-141 token go into a Rhea concentrated-liquidity (DCL) pool with only the token and no NEAR, starting at a chosen price, and can anyone then buy it with wNEAR and sell it back with `ft_transfer_call`?

**Answer: yes.** 800,000,000 tokens went in as one position with 0 wNEAR (paid_token_y "0"). A fresh account with no storage deposit on the DCL bought with 1 wNEAR and sold half back. Both trades paid out exactly what the `quote` view said. The owner removed part of the position and moved the position to another account as an NFT.

Two catches. First, the pool's starting point must be **below** the position's left point (left_point - 1). If the position starts exactly at the current point, the contract needs some wNEAR. Second, on the testnet contract (2.3.14) every `"Deposit"` costs about 920 Tgas (needs 1000 Tgas prepaid). Mainnet (2.4.2) does not show this: a user deposit burns about 3.7 Tgas. Mainnet also has a `register_tokens` method, which launchpads call before depositing and which testnet does not have.

## Accounts (all fresh, faucet-created)

| Role | Account |
|---|---|
| LP owner (holds the supply) | rhea-try-891ea1.testnet (faucet, 10 NEAR) |
| Token contract | trh.rhea-try-891ea1.testnet (sub-account, 3.5 NEAR; near-examples FT wasm from contracts/test-token) |
| Buyer | rhea-buy-891ea1.testnet (faucet, 10 NEAR; never registered on the DCL) |
| Position receiver (transfer test) | heir.rhea-try-891ea1.testnet (sub-account, 1 NEAR) |
| DCL contract | dclv2.ref-dev.testnet, `get_metadata` version 2.3.14, owner ref-dev.testnet, wnear_id wrap.testnet, protocol_fee_rate 2000 (20% of swap fees), 11,668 pools |

Token: tRH "Rhea Rehearsal Token", 18 decimals, total supply 1,000,000,000 (1e27 base units) minted to the owner. Deploy and init: GsJTqvuedaJFYneqG1MjGSNV6izVwM8oMhUi5dHUUYjB.

Other DCL deployments: ref-ui's config also names `refv2-dev.ref-dev.testnet` (version 2.3.7, 44 pools, older). The Ref SDK and ref-ui pub-testnet configs point at `dclv2.ref-dev.testnet`, which is the one closest to mainnet. Mainnet is `dclv2.ref-labs.near`, version 2.4.2. The DCL contract source is not public; the call shapes below come from ref-sdk/ref-ui (`src/services/swapV3.ts`), mainnet transactions and testing.

## Price and points

- The pool id is `<token_x>|<token_y>|<fee>`, with the two token account ids sorted as strings. `trh.rhea-try-891ea1.testnet` sorts before `wrap.testnet`, so **the token is x and wNEAR is y**. Any token id that sorts before `wrap.near` (for example `real...`) will also be x on mainnet.
- The raw price of y per x is `1.0001^point` (yocto-wNEAR per smallest token unit). For an 18-decimal token, wNEAR per token = `1.0001^point / 1e6`, and point = `ln(price_in_wNEAR * 1e6) / ln(1.0001)`.
- Fee to point_delta: 100→1, 400→8, 2000→40, 10000→200. Fee 2000 was accepted (point_delta 40). Fee 10000 was also accepted (point_delta 200).
- Start price 0.00000025 wNEAR per token is point -13863.6. The nearest grid point at delta 40 is **-13880**, which is 2.4959e-7 wNEAR per token, 0.16% under the target. The pool was created at **init_point -13881**, one point below the position.
- `init_point` does not need to be on the grid. Position edges do need to be multiples of point_delta.

## Range limits (found with the free `predict_add_liquidity` view, then confirmed by a transaction)

- `right_point` must be **below 800000**, so with delta 40 the highest allowed is 799960. A position ending at 800000 fails with `E202: illegal point`, both as a transaction (A8vxnQnNKh4RSX5bz6qk5PUenejBaPaHLvHRHV3UhunK) and as a view.
- `right_point - left_point` must be **below 800000**. Width 800000 fails and width 799960 works. From left -13880, the widest single position therefore ends at **786080**.
- The cut-off has no practical effect. The liquidity for 800M tokens is 1.99821456079e22 whether the position ends at 500000, 600000 or 786080. Mainnet launchpads use 500000. Point 786080 is a price of about 1e28 wNEAR per token.
- A position that includes the current point needs wNEAR. With amount_y 0 the view panics (`attempt to subtract with overflow`, pool.rs:1138). For a fee-10000 pool created at init_point -13800, a position from -13800 needs 0.01006 wNEAR for 800M tokens. **So create the pool at left_point - 1 and start the position at left_point.** Mainnet launchpads do the same (init_point 3399, left_point 3400).

## The calls that worked, in order (testnet values; near-cli-rs 0.30.1)

`near` is `.tooling\bin\near.exe`. Every call ends with `network-config testnet sign-with-legacy-keychain send`.

1. Register the DCL contract on the token (0.00125 NEAR). Tx 6pCGJa49BU3j3cD711aCr1yBDCMwLGBW2K7pWNgyL679
```
near contract call-function as-transaction trh.rhea-try-891ea1.testnet storage_deposit json-args '{"account_id":"dclv2.ref-dev.testnet","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
2. Create the pool (attach 0.1 NEAR; the contract kept 0.00921 and refunded 0.09079). It returns the pool id. Tx 5y7ZhBXAaFMhNSdjHDDQicA7x7kz4zeqXApmGVUp1s5B
```
near contract call-function as-transaction dclv2.ref-dev.testnet create_pool json-args '{"token_a":"trh.rhea-try-891ea1.testnet","token_b":"wrap.testnet","fee":2000,"init_point":-13881}' prepaid-gas '180 Tgas' attached-deposit '0.1 NEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
3. Owner storage on the DCL (minimum 0.5 NEAR per `storage_balance_bounds`, same on mainnet). This gives 0.1 NEAR for assets plus 40 position slots at 0.01 NEAR each. Tx BdCjS9wgVAkxUcmbrzxtJ8RQnrBrgY4CvE1h8N3tb3ee
```
near contract call-function as-transaction dclv2.ref-dev.testnet storage_deposit json-args '{"account_id":"rhea-try-891ea1.testnet","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.5 NEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
4. Deposit the tokens into the owner's DCL balance. **On testnet this needs 1000 Tgas** (see Failures). Tx 2DSyfhRhizpr5gH8xKAXcLhRLVxEziCgYX4NXvZGdhAV (799,999,998 tRH; two earlier 1-token test deposits made the balance exactly 800,000,000; `list_user_assets` showed "800000000000000000000000000").
```
near contract call-function as-transaction trh.rhea-try-891ea1.testnet ft_transfer_call json-args '{"receiver_id":"dclv2.ref-dev.testnet","amount":"800000000000000000000000000","msg":"\"Deposit\""}' prepaid-gas '1000 Tgas' attached-deposit '1 yoctoNEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
5. Optional free preview (view call):
```
near contract call-function as-read-only dclv2.ref-dev.testnet predict_add_liquidity json-args '{"pool_id":"trh.rhea-try-891ea1.testnet|wrap.testnet|2000","left_point":-13880,"right_point":786080,"amount_x":"800000000000000000000000000","amount_y":"0"}' network-config testnet now
```
It returned need_x 799999999999999997405484150, need_y 0, liquidity_amount 19982145607910443770428.

6. **Add the liquidity. This is the step that was in question, and it worked.** It burned 9.9 Tgas. Tx FSSfGZqt8vbTPyKkZAwyfg8d9s1jTMWiGJHaQcDynBtD
```
near contract call-function as-transaction dclv2.ref-dev.testnet add_liquidity json-args '{"pool_id":"trh.rhea-try-891ea1.testnet|wrap.testnet|2000","left_point":-13880,"right_point":786080,"amount_x":"800000000000000000000000000","amount_y":"0","min_amount_x":"0","min_amount_y":"0"}' prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
It returned `trh.rhea-try-891ea1.testnet|wrap.testnet|2000#2566`, and the `liquidity_added` event showed paid_token_x 799999999999999997405484150 and paid_token_y "0". The unused 2594515850 base units (2.6e-9 tRH) were sent back to the owner automatically, so no `withdraw_asset` was needed.

Pool after the add: current_point -13881, liquidity 0 at the current point, total_liquidity 1.99821e22, total_x 799,999,999.9999999974 tRH, total_y 0.

## Buy and sell from an account with no DCL storage

The buyer only registered on wrap.testnet (H6hSsxwkBuQjjXqyYmbVhazWbPSZYtPDDeaxVnNhTx78, 0.00125) and on the token (E4ZUJ2XVFYKZkP2v9K2CWXxoCUc3dThVZgEZeZn3Nz2j, 0.00125). It then wrapped 1 NEAR with `near_deposit` (DwFR2RTsbEwqonpUNRJr18hcoSfwGipUNW2snnnt3181). `get_user_storage_detail` for the buyer stayed `null` throughout.

Quote view (free):
```
near contract call-function as-read-only dclv2.ref-dev.testnet quote json-args '{"pool_ids":["trh.rhea-try-891ea1.testnet|wrap.testnet|2000"],"input_token":"wrap.testnet","output_token":"trh.rhea-try-891ea1.testnet","input_amount":"1000000000000000000000000","tag":"buy1"}' network-config testnet now
```

**Buy, 1 wNEAR, 300 Tgas, DCL used 16.35 Tgas.** Tx EvAiKebF68tn33QUCpyWb5Z2hn1GDAupuhY9kbuLEPer
```
near contract call-function as-transaction wrap.testnet ft_transfer_call json-args '{"receiver_id":"dclv2.ref-dev.testnet","amount":"1000000000000000000000000","msg":"{\"Swap\":{\"pool_ids\":[\"trh.rhea-try-891ea1.testnet|wrap.testnet|2000\"],\"output_token\":\"trh.rhea-try-891ea1.testnet\",\"min_output_amount\":\"3939060302473732401786669\",\"skip_unwrap_near\":true}}"}' prepaid-gas '300 Tgas' attached-deposit '1 yoctoNEAR' sign-as rhea-buy-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```

| | tRH out for 1 wNEAR |
|---|---|
| Brief's rough figure, 800M × 1/(200+1) | 3,980,100 |
| Constant product with virtual wNEAR reserve 199.673 (start point -13880) and 0.2% fee | 3,978,651 |
| `quote` view | 3,978,848.790377507 |
| **Received** | **3,978,848.790377507** (exactly the quote) |

The fee was 0.002 wNEAR, of which 0.0004 went to the protocol. The average price paid was 2.5133e-7 wNEAR per token. Pool after the buy: current_point -13781 (2.5207e-7 wNEAR per token), liquidity 1.99821e22, total_x 796,021,151.21, total_y 1.0 wNEAR.

**Sell half (1,989,424.395188753738276095 tRH), 300 Tgas, DCL used 13.92 Tgas.** Tx AUrVymH3m1cifW8V58P7SANVi79VGjmPbjeoeJcKWUFq
```
near contract call-function as-transaction trh.rhea-try-891ea1.testnet ft_transfer_call json-args '{"receiver_id":"dclv2.ref-dev.testnet","amount":"1989424395188753738276095","msg":"{\"Swap\":{\"pool_ids\":[\"trh.rhea-try-891ea1.testnet|wrap.testnet|2000\"],\"output_token\":\"wrap.testnet\",\"min_output_amount\":\"494253543131703787181543\",\"skip_unwrap_near\":true}}"}' prepaid-gas '300 Tgas' attached-deposit '1 yoctoNEAR' sign-as rhea-buy-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```

| | wNEAR out |
|---|---|
| Constant-product estimate with fee | 0.49927 |
| `quote` view | 0.499246003163337 |
| **Received** | **0.499246003163337** wNEAR (exactly the quote) |

The fee was 3,978.85 tRH, of which 795.77 went to the protocol. With `skip_unwrap_near: true` the seller gets wNEAR. With false the DCL unwraps and pays native NEAR, as it did on removal below. The round trip lost 0.15% on the half that was sold. Pool after the sell: current_point -13831, total_x 798,010,575.60, total_y 0.500754.

## What the position owner can do

- **List** with `list_liquidities {"account_id":...}`, `get_liquidity {"lpt_id":...}`, or the NFT views `nft_tokens_for_owner` and `nft_token`. Positions are NEP-171 NFTs named "REF DCL LIQUIDITY NFT", symbol RDL. After the trades, the position showed unclaimed_fee_x 3,183.08 tRH and unclaimed_fee_y 0.0016 wNEAR.
- **Remove part** (worked, 1% of liquidity). Tx 8SngeDxTMNECgUDw4jfakEQobDSydoLNthw8x4Vvxxrg
```
near contract call-function as-transaction dclv2.ref-dev.testnet remove_liquidity json-args '{"lpt_id":"trh.rhea-try-891ea1.testnet|wrap.testnet|2000#2566","amount":"199821456079104437704","min_amount_x":"0","min_amount_y":"0"}' prepaid-gas '300 Tgas' attached-deposit '0 NEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
The owner received 7,983,209.06 tRH (the 1% share plus all claimed fees) by ft_transfer, and 0.0065976 NEAR. The wNEAR part was unwrapped and sent as native NEAR without being asked. Liquidity is now 1.97823e22. `predict_remove_liquidity {"lpt_id","amount"}` is a free view that predicted exactly these amounts.
- **Transfer the position**: `nft_transfer` works, but the receiver must first have DCL storage. Without it the call fails with `E100: account not registered` (C2wNpLUep7fimVBZsu7yAZN9DSR2SDkYU6T6djfz428u). After the owner paid 0.5 NEAR of DCL storage for the heir (3eUXJ45bMAXuZKmVJ8RAgs7PsDsXen7YX1mX98H6DRiD), the transfer worked (24JTHApcosgYZNUbgCRuC7wNmyy29yAs9VxqsKyjeeMn). The slot moved with it. The old owner's `remove_liquidity` then failed with `E215: not liquidity owner` (Ezz1RNfnHS6usFwyqtFgsnPWTebXEwZjtft19G985nu2). The heir sent it back (HNbDCDTp9Z32ycQT4XUN857ySmxCahfvU1kkA49SP1S5). The owner holds #2566 again.
```
near contract call-function as-transaction dclv2.ref-dev.testnet nft_transfer json-args '{"receiver_id":"heir.rhea-try-891ea1.testnet","token_id":"trh.rhea-try-891ea1.testnet|wrap.testnet|2000#2566"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as rhea-try-891ea1.testnet network-config testnet sign-with-legacy-keychain send
```
- Not tested: `batch_remove_liquidity`, `append_liquidity`, `withdraw_asset` (removals pay out automatically), `storage_withdraw` and `storage_unregister` (both exist), and fee-only claims. ref-ui claims fees with `remove_liquidity`.

## Costs (NEAR; "kept" = deposit not refunded; gas = tokens burnt)

| Step | Tx | Kept | Gas |
|---|---|---|---|
| Fund token account (contract storage stays there) | 4k99J69T... | 3.5 | 0.0071 |
| Deploy and init token | GsJTqvue... | 0 | 0.0023 |
| Register DCL on token | 6pCGJa49... | 0.00125 | 0.0002 |
| create_pool (0.1 attached) | 5y7ZhBXA... | 0.00921 | 0.0004 |
| DCL storage, owner | BdCjS9wg... | 0.5 | 0.0003 |
| Deposit 800M (testnet, 920 Tgas) | 2DSyfhRh... | 0 | 0.0924 |
| add_liquidity | FSSfGZqt... | 0 | 0.0014 |
| Buyer: wrap.testnet + token registration | H6hSsxwk..., E4ZUJ2XV... | 0.0025 | 0.0004 |
| Buyer: buy | EvAiKebF... | 0 | 0.0025 |
| Buyer: sell | AUrVymH3... | 0 | 0.0023 |
| remove_liquidity 1% | 8SngeDxT... | (received 0.0066) | 0.0020 |
| DCL storage for heir (transfer test) | 3eUXJ45b... | 0.5 | 0.0003 |
| nft_transfer, each way | 24JTHApc..., HNbDCDTp... | 0 | 0.00045 |

Launch path (steps 1 to 6) without the token account: about 0.51 NEAR kept (0.5 of it is DCL storage, held rather than spent) plus about 0.1 NEAR of gas on testnet. On mainnet the gas is likely under 0.01 NEAR, and `register_tokens` adds 0.01. Failed tries and diagnostics cost about 0.29 NEAR of gas in total: four out-of-gas deposits about 0.10, two 1-token test deposits at 920 Tgas about 0.18, the rest small. The owner went from 10 to 4.0754 NEAR, including 3.5 for the token account and 1 for the heir account. The buyer spent 1.0078 NEAR, of which 1 became wNEAR and 0.499 wNEAR is still held.

## Failures and why

1. **Depositing the token with `"Deposit"` ran out of gas** at 150 Tgas (BmtuDYi8GePYr5kbXihn5u2gAGk2JXSRQBSozTTg5uzu) and at 300 Tgas (7TnNuPHvaB5yfrMWAf6tcZJqzGtnTKJXXVDfsoou3gWd). A 1-token deposit also failed at 300 Tgas (BSFi89JERY2wY9uzPe8whuSwpUqpWBSRatixzVuBVgyJ). The DCL's `ft_on_transfer` failed and the tokens came back via `ft_resolve_transfer`. The transaction still shows "success" at the top level; only the receipt and `list_user_assets` show the failure. With 1000 Tgas it works but burns 920 Tgas every time (C9PnJEtT..., 84zo2GTj..., 2DSyfhRh...). A `"Deposit"` of wNEAR from the same account also runs out at 300 Tgas (7Q2hwHWGkqEGrz5YXScXFkHEg6o5Kn6ojZJn9pz7w3AK), so this is the testnet contract's Deposit path, not this token. Swaps of the same token cost only 14-16 Tgas.
   - On mainnet a user's `"Deposit"` burned 3.65 Tgas (9RFmadvQarmDatdfgag7hKbr156tGLx6BArmrHjMxNLD, prl.omft.near, 900 Tgas prepaid). A launchpad's 1e27 deposit of a brand-new token burned 3.76 Tgas after `register_tokens` (ZAeAwfvnhAWndLvMxFgXPtZT6oZoMYE8XkM5W5Y1JpC). Both networks allow up to 1000 Tgas per transaction (protocol 88).
2. **`register_tokens` does not exist on testnet 2.3.14**: MethodNotFound, tx 35xgM5JSHAVRGUQ5N5RUjkhUibSK9ToCx7M9ZfQsFYLu.
3. **Position to right_point 800000**: `E202: illegal point` (A8vxnQnNKh4RSX5bz6qk5PUenejBaPaHLvHRHV3UhunK). See Range limits.
4. **nft_transfer to an account without DCL storage**: `E100: account not registered`.
5. **Second `create_pool` for the same pair and fee**, sent by the buyer at init_point 0: `E405: pool already exist` (2K6P2xvDVPF1g6AyHrS6AYUQfxg5xLS1AMPwWoNFuYPB). The first creator sets the start point.

## How mainnet launchpads do it (read from mainnet chain data, no transactions sent)

v2-launchpad.justhoot.near with v2-pool-creator.justhoot.near, for example token kimtrenche, tx ZAeAwfvnhAWndLvMxFgXPtZT6oZoMYE8XkM5W5Y1JpC:
1. `create_pool {"token_a":TOKEN,"token_b":"wrap.near","fee":10000,"init_point":3399}` with 0.00977 NEAR
2. `storage_deposit {"account_id":"v2-pool-creator.justhoot.near","registration_only":false}` with 0.01 (one more slot)
3. `register_tokens {"token_ids":[TOKEN]}` with 0.02 (0.01 was refunded)
4. TOKEN `ft_transfer_call {"receiver_id":"dclv2.ref-labs.near","amount":"1000000000000000000000000000","msg":"\"Deposit\""}`
5. `add_liquidity {"pool_id":"TOKEN|wrap.near|10000","left_point":3400,"right_point":500000,"amount_x":"999999999999000000000000000","amount_y":"0","min_amount_x":"0","min_amount_y":"0"}`
6. `withdraw_asset {"token_id":TOKEN,"skip_unwrap_near":true}` for the dust

`register_tokens` on mainnet is also called by ordinary accounts (truekale619.near, nearon-pool.near, an implicit account), with 0.01 NEAR per token. Mainnet `add_liquidity` also accepts an optional `"skip_refund_transfer": true`.

## Mainnet recipe (to adapt; DCL = dclv2.ref-labs.near)

1. TOKEN `storage_deposit {"account_id":"dclv2.ref-labs.near","registration_only":true}`, using the amount from the token's `storage_balance_bounds`
2. DCL `create_pool {"token_a":TOKEN,"token_b":"wrap.near","fee":2000,"init_point":LEFT-1}` with 0.1 NEAR (most is refunded). Then check `get_pool`: point_delta 40, current_point LEFT-1.
3. DCL `storage_deposit {"account_id":OWNER,"registration_only":true}` with 0.5 NEAR
4. DCL `register_tokens {"token_ids":[TOKEN]}` with 0.01 NEAR (attach 0.02 as the launchpads do)
5. TOKEN `ft_transfer_call {"receiver_id":"dclv2.ref-labs.near","amount":AMOUNT,"msg":"\"Deposit\""}` with 1 yocto and 300 Tgas. If it fails, check `list_user_assets` and retry at up to 1000 Tgas.
6. View `predict_add_liquidity` first, then DCL `add_liquidity {"pool_id":"TOKEN|wrap.near|2000","left_point":LEFT,"right_point":RIGHT,"amount_x":AMOUNT,"amount_y":"0","min_amount_x":"0","min_amount_y":"0"}`. Use RIGHT ≤ 799960 with RIGHT - LEFT < 800000, or 500000 as the launchpads do.
7. Check `list_user_assets` for dust and `withdraw_asset` if any is left.

LEFT for a price p in wNEAR per token (18-decimal token) = floor(ln(p × 1e6) / ln(1.0001) / 40) × 40.

## Open questions for mainnet

1. **Pool race.** Once the token exists, anyone can create TOKEN|wrap.near|2000 first, at any init_point (E405 then blocks us). The launchpads avoid this by creating the pool from the same contract call chain that creates the token. Plan: create the pool right after the token, ideally in the same batch. If someone gets in first with a lower point, a position above it is still token-only. If they set a higher point, the position must start above their point, or use another fee tier.
2. **Is `register_tokens` required before `"Deposit"` on mainnet 2.4.2**, and what happens without it (rejected, or as slow as testnet)? It cannot be tested on testnet. It costs 0.01 NEAR and ordinary accounts call it, so call it.
3. Version gap 2.3.14 vs 2.4.2. The range rules (E202) and the left-equals-current behaviour come from testnet. Check them with the free `predict_add_liquidity` view on mainnet before sending.
4. Token id ordering. The token must sort before `wrap.near` to be token_x. If it sorts after, everything mirrors: amount_y, a range below the current point, and init_point = right_point + 1.
5. Not checked: whether Rhea's web UI lists a new token's pool without any whitelisting. Swapping by contract call works either way.
6. Not tested: storage refunds (`storage_withdraw`, `storage_unregister`), and fee-only claims.

## Follow-up the same day: three more findings and the tREAL pool

1. **Use right_point 500000, not the widest range.** For a second pool (tREAL, left_point 78240) `add_liquidity` up to 799960 panicked with `attempt to subtract with overflow` (dcl_liquidity_api.rs:209): the contract rounded the tokens it needs to a hair MORE than the amount offered. `predict_add_liquidity` shows it in advance: `need_x` greater than `amount_x` means the transaction will panic. Up to 700000 it was over, up to 600000 and below it was fine. With right_point 500000 the add worked (5JX6j1Rk1oQCHKyoCdnjgPgGkvk5RRjAzMTVfVdAhyXo). The liquidity is the same to nine digits. On mainnet: preview first, and send only when need_x ≤ amount_x.
2. **A sale can pay plain NEAR.** `"skip_unwrap_near": false` in the Swap message made the pool contract unwrap and send native NEAR to the seller (B6SvUtQdc9nrXu8QPvNB6pSCjPS7HRKoDm9vBcwqucQt: 500,000 tRH sold, log "Withdraw 125083720323171711946841 yoctoNEAR", the wNEAR balance did not move).
3. **Wrap and buy fit in one transaction.** Two actions on wrap.testnet, `near_deposit` (0.2 NEAR attached) then `ft_transfer_call` to the pool contract with the Swap message, bought 795,970 tRH (D7TEawyWHJ9CoyPUVBNT1vX5eVRFVMXxEwjb8YDASuTW).

**The testnet game's pool** (for trying the buy and withdraw flow on testnet.realsies.lol):

| Item | Value |
|---|---|
| Pool | `real.realsies.testnet|wrap.testnet|2000` on dclv2.ref-dev.testnet, created at point 78239 (7bfLaHJrA5seXooMJJiqX2oWVkCqbuRRmFEQHzD4UTyQ) |
| Position | #2567, points 78240 to 500000, 80,000 tREAL and no wNEAR, owned by realsies-pool.testnet (faucet account, key in the legacy keychain) |
| Start price | 0.0025 NEAR per tREAL, so 400 coins per NEAR (1 coin = 1 tREAL on testnet), the same coins per NEAR as planned for mainnet |
| Depth | behaves like 200 NEAR against the tokens, the same as 800M REAL at 4,000,000 REAL per NEAR |
| Quotes at creation | 1 NEAR buys 397.41 tREAL, 0.25 NEAR buys 99.72 tREAL |

## Dress rehearsal of the whole launch (same day)

`scripts/launch-real.mjs` ran end to end on testnet under a faucet account, `realdress-105904.testnet`, with the mainnet numbers (1 billion supply, 20% to the vault, 4,000,000 per NEAR, fee 2000, points -13880 to 500000):

| Step | What happened |
|---|---|
| pool | The pool was created BEFORE the token account existed (3ZU6B23BnL5RHDJQ9YrGpcNyWr9VLro988uaHXcHvsng). On testnet `create_pool` does not look at the token, so the start price can be fixed before anyone knows the token's name. Whether mainnet allows the same is untested; the script falls back to creating the pool right after the deploy |
| token | real.realdress-105904.testnet deployed with the 160 px coin icon (5,978 characters), the whole supply minted to the liquidity account (Dn2NpNRJMFsNgUcjc6rdo1AkbTeJD1CJDdDSC6VoTUPx) |
| liquidity | 800,000,000 deposited and added as position #2568 with 0 wNEAR (2KNmxwt9y6E2D1FXVZ4SfA3XUfU9nwBcu9mawcs9fBwo). 31,778 smallest units of rounding dust came back to the liquidity account |
| vault | vault.realdress-105904.testnet deployed (code hash 97YKNAXyRZmKX6zUZgU6RbBuynY8Wp8gxaByXQKiSszG) and funded with 200,000,000 by ft_transfer_call (6mC9byFyg4P7Tzv6w9qfLbCFVYV55HyNHpTBxNouTHph) |
| lock | The liquidity account sent its spare 1.0012 NEAR home, then the token, the vault and the liquidity account each deleted their only key. All three now have no keys |
| after the lock | A buy with 0.2 NEAR from another account still worked (798,948.70 tokens, mKAgouAhusPHFt6jWodGBSJk4bdzMu5m9qKYXjeKAqC). A vault claim before the cliff was refused with "nothing to claim". Part-way through the schedule a claim sent by an outsider paid the team account 31,412,500 (8rdkUu1rxBsWq3xCbCoxah4ZtgPboCnbFmYXVZ2SzQ4J), exactly total × elapsed / vesting; after the end another paid the rest (4RPGrPdLJ86JATZh1Ft5ehrXTdVSCg17aKwWvRVsPfEk): team 200,000,000, vault 0 |

One thing the first run taught: a call with 1000 Tgas prepaid needs about 1 NEAR lying in the account for a moment (gas is charged up front at a pessimistic price and mostly refunded). The script now tops the liquidity account up from the owner before such a call.

## 2026-11-11: the game's buy as an exact-input Swap, so chart sites see it

Why: the pool contract logs a `SwapByOutput` (exact coins out) as the event `swap_desire` and a `Swap` (exact NEAR in) as `swap`. DexScreener and GeckoTerminal count only `swap`, so after a day of in-game buys and one sale on mainnet both showed "0 buys, 1 sell". Since protocol v1.15 the game's buy is a `Swap` of the quote's `swapIn` (the cost of the whole coins plus the 1% allowance, never more than the NEAR offered) with `min_output_amount` = those coins; the deposit still moves exactly the whole coins and the little more stays in the wallet. An older relay's quote has no `swapIn`, and the web then sends the `SwapByOutput` as before.

Measured on testnet with `relay/tools/swap-proof.ts` (dclv2.ref-dev.testnet, pool `real.realsies.testnet|wrap.testnet|2000`, account swapproof-02f825.testnet), events read back with the RPC `tx` method:

| What | Tx | Pool event | Result |
|---|---|---|---|
| `SwapByOutput` buy (the 2026-11-10 proof) | EAQAG6omaaJSrsJwutmDADu36UKK6TWo3cD7cndmiGGt | `dcl.ref` `swap_desire` | exactly 98 coins |
| `Swap` buy, 0.249320 NEAR in, at least 96 coins | 95dK72x962fMZQT8dunbBz7NQqVeUpiTErdqbMLvrkTf | `dcl.ref` `swap` | 96.9685 coins out. The deposit (HswAzbFGML3vyvVL9SzuboCVL5DMJDSReGhBBF6AdNkn) moved exactly 96 into the game. 0.9685 stayed in the wallet: 1.0088% of 96, under the allowance's 0.9696 |
| `Swap` buy of 0.01 NEAR asking one unit more than it buys | 6xRy5AESKF5xGeaZZfZPwMSXbbSfoGxprJ454mzZ2yJU | `dcl.ref` `swap`, in the failed receipt only | `E204: slippage error`. wrap.testnet refunded the 0.01 wNEAR, which stayed with the player as wNEAR, and no coin moved. The transaction's own status is a success |
| Sale of the 96 coins (`Swap`, skip_unwrap_near false) | AwomnZCQbmYoSEygCR4iL4BS6xKAR45Kj3dw2t2vQrQh | `dcl.ref` `swap` | exactly the quoted 0.245847 NEAR |

Three findings:

1. **The pool contract keeps all of what a `Swap` sends** (its `ft_on_transfer` returns "0"), but the event's `amount_in` can be a few yocto less: 49, 18 and 8 yocto in three buys (73T8WnJyds8zj2eaVzV2APc1JJRfzN8qh3wshZ9ia8Py, BTFxkJhd9Jrebd1JHQaYAkc5wiQavnJrLoNRGHAuQXi6, 95dK72x9...). Nothing comes back as wNEAR, so a buy leaves no wNEAR.
2. **A refused swap still logs `swap`.** The pool contract writes the event, then panics with E204; the failed receipt keeps the log (also HTqxDebnXTjpFBmxowBJYYtsYzfZCH6Zx3vUkPccR5qk). An indexer that reads failed receipts would count a buy that never happened. Whether DexScreener and GeckoTerminal skip failed receipts was not checked.
3. **The little more is about the allowance.** Three 0.25 NEAR buys each gave 96.968 coins for 96 deposited. A larger buy leaves more than one whole coin in the wallet (about 1% of the coins bought).

Clean-up of the throwaway account: the 192 coins left in the game by the first two runs (each stopped on a check that was then corrected) were withdrawn with the near CLI and sold from the wallet together with the 2.9 coins of leftovers (HPCGdZraWRYA7PJEokpsnNK99SwphNFZuGvkajaVChVX, `swap`). The account holds no coin, no wNEAR and nothing in the game.

## Current testnet state (left in place)

Pool `trh.rhea-try-891ea1.testnet|wrap.testnet|2000` at current_point -13831, holding position #2566 owned by rhea-try-891ea1.testnet (liquidity 1.97823e22, about 790.03M tRH and 0.494 wNEAR). An empty fee-10000 pool `trh.rhea-try-891ea1.testnet|wrap.testnet|10000` at -13800 (9ayebPEnWZLUyUwDG5M2M67VdRYcpt7mSj9eU9Jt41mx). Keys for all four accounts are in the legacy keychain `~/.near-credentials/testnet/`.
