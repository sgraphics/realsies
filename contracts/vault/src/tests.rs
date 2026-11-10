use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde_json;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;

const UNIT: u128 = 1_000_000_000_000_000_000;
const T0: u64 = 1_800_000_000_000;
const CLIFF: u64 = 120_000;
const VEST: u64 = 240_000;
const TOKEN: &str = "token.testnet";
const BEN: &str = "team.testnet";
const VAULT: &str = "vault.testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, ts_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(VAULT))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .block_timestamp(ts_ms * 1_000_000);
    testing_env!(b.build());
}

fn vault(cliff: u64, vesting: u64) -> Vault {
    ctx(VAULT, T0);
    Vault::new(acc(TOKEN), acc(BEN), U64(cliff), U64(vesting), None)
}

fn fund(v: &mut Vault, amount: u128, ts: u64) {
    ctx(TOKEN, ts);
    match v.ft_on_transfer(acc("funder.testnet"), U128(amount), String::new()) {
        PromiseOrValue::Value(unused) => assert_eq!(unused.0, 0, "the vault keeps everything"),
        PromiseOrValue::Promise(_) => panic!("expected a value"),
    }
}

fn released(v: &Vault, ts: u64) -> u128 {
    ctx("anyone.testnet", ts);
    v.get_info().released_now.0
}

fn claim(v: &mut Vault, ts: u64) -> u128 {
    ctx("anyone.testnet", ts);
    let before = v.claimed;
    let _ = v.claim();
    v.claimed - before
}

// ---------- schedule ----------

#[test]
fn schedule_before_at_mid_end_after() {
    let mut v = vault(CLIFF, VEST);
    let total = 1_000_000 * UNIT;
    fund(&mut v, total, T0);
    assert_eq!(v.start_ms, T0, "start defaults to the block time");
    assert_eq!(released(&v, T0), 0);
    assert_eq!(released(&v, T0 + CLIFF - 1), 0, "before the cliff");
    assert_eq!(released(&v, T0 + CLIFF), 0, "exactly at the cliff the linear part starts from zero");
    assert_eq!(released(&v, T0 + CLIFF + 1), total / VEST as u128, "1 ms after the cliff");
    assert_eq!(released(&v, T0 + CLIFF + VEST / 4), total / 4);
    assert_eq!(released(&v, T0 + CLIFF + VEST / 2), total / 2, "midway");
    assert_eq!(released(&v, T0 + CLIFF + VEST - 1), total - total.div_ceil(VEST as u128), "1 ms before the end");
    assert_eq!(released(&v, T0 + CLIFF + VEST), total, "at the end");
    assert_eq!(released(&v, T0 + CLIFF + VEST + 1), total, "after the end");
    assert_eq!(released(&v, T0 + 100 * 365 * 86_400_000), total, "long after the end");
    ctx("anyone.testnet", T0);
    assert_eq!(v.get_info().fully_released_at_ms, T0 + CLIFF + VEST);
}

#[test]
fn vesting_zero_releases_everything_at_the_cliff_end() {
    let mut v = vault(CLIFF, 0);
    fund(&mut v, 777 * UNIT, T0);
    assert_eq!(released(&v, T0 + CLIFF - 1), 0);
    assert_eq!(released(&v, T0 + CLIFF), 777 * UNIT);
    assert_eq!(released(&v, T0 + CLIFF + 1), 777 * UNIT);
    ctx("anyone.testnet", T0);
    assert_eq!(v.get_info().fully_released_at_ms, T0 + CLIFF);
}

#[test]
fn no_cliff_and_no_vesting_releases_at_start() {
    let mut v = vault(0, 0);
    fund(&mut v, 5, T0);
    assert_eq!(released(&v, T0 - 1), 0);
    assert_eq!(released(&v, T0), 5);
}

#[test]
fn explicit_start_in_the_past() {
    ctx(VAULT, T0);
    let mut v = Vault::new(acc(TOKEN), acc(BEN), U64(CLIFF), U64(VEST), Some(U64(T0 - CLIFF - VEST / 2)));
    fund(&mut v, 1000, T0);
    assert_eq!(v.start_ms, T0 - CLIFF - VEST / 2);
    assert_eq!(released(&v, T0), 500, "already midway when funded");
}

#[test]
fn top_up_midway_vests_on_the_same_schedule() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST / 4), 250 * UNIT);
    fund(&mut v, 1000 * UNIT, T0 + CLIFF + VEST / 2);
    assert_eq!(v.total, 2000 * UNIT);
    ctx("anyone.testnet", T0 + CLIFF + VEST / 2);
    let info = v.get_info();
    assert_eq!(info.released_now.0, 1000 * UNIT, "half of the new total");
    assert_eq!(info.claimable_now.0, 750 * UNIT);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST), 1750 * UNIT);
    // A top-up after the end is released at once.
    fund(&mut v, 3 * UNIT, T0 + CLIFF + VEST + 10);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST + 10), 3 * UNIT);
    assert_eq!(v.claimed, v.total);
}

#[test]
fn mul_div_is_exact_and_cannot_overflow() {
    // 1e27 over ten years in milliseconds.
    let total = 1_000_000_000 * UNIT;
    let ten_years = 10 * 365 * 86_400_000u64;
    assert_eq!(mul_div(total, ten_years / 2, ten_years), total / 2);
    assert_eq!(mul_div(total, ten_years - 1, ten_years), total - total.div_ceil(ten_years as u128));
    // The extreme: u128::MAX / u64::MAX = 2^64 + 1 exactly.
    assert_eq!(mul_div(u128::MAX, u64::MAX, u64::MAX), u128::MAX);
    assert_eq!(mul_div(u128::MAX, u64::MAX - 1, u64::MAX), u128::MAX - (1u128 << 64) - 1);
    assert_eq!(mul_div(u128::MAX, 0, u64::MAX), 0);
    // Against the naive formula where it does not overflow.
    for a in [0u128, 1, 7, 999_999, 1_000_000_007, 123_456_789_012_345_678_901] {
        for c in [1u64, 3, 240_000, 86_400_000] {
            for b in [0, 1, c / 3, c / 2, c - 1, c] {
                assert_eq!(mul_div(a, b, c), a * b as u128 / c as u128, "{a} {b} {c}");
            }
        }
    }
}

#[test]
fn large_total_on_a_long_schedule() {
    let year = 365 * 86_400_000u64;
    let mut v = vault(year, 3 * year);
    let total = 200_000_000 * UNIT; // 20% of 1e27
    fund(&mut v, total, T0);
    assert_eq!(released(&v, T0 + year - 1), 0);
    assert_eq!(released(&v, T0 + year + year), total / 3);
    assert_eq!(released(&v, T0 + 4 * year), total);
}

#[test]
#[should_panic(expected = "schedule overflows")]
fn schedule_that_overflows_is_rejected() {
    ctx(VAULT, T0);
    let _ = Vault::new(acc(TOKEN), acc(BEN), U64(u64::MAX - T0), U64(1), None);
}

// ---------- deposits ----------

#[test]
fn deposit_adds_to_total_and_emits_an_event() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 40, T0);
    fund(&mut v, 2, T0 + 1);
    assert_eq!(v.total, 42);
    assert_eq!(
        get_logs(),
        vec![r#"EVENT_JSON:{"standard":"realsies_vault","version":"1.0.0","event":"deposit","data":[{"from":"funder.testnet","amount":"2","total":"42"}]}"#]
    );
}

#[test]
#[should_panic(expected = "only the vault token is accepted")]
fn ft_on_transfer_from_another_token_panics() {
    let mut v = vault(CLIFF, VEST);
    ctx("other-token.testnet", T0);
    let _ = v.ft_on_transfer(acc("funder.testnet"), U128(1000), String::new());
}

#[test]
#[should_panic(expected = "only the vault token is accepted")]
fn ft_on_transfer_called_directly_by_an_account_panics() {
    let mut v = vault(CLIFF, VEST);
    ctx(BEN, T0);
    let _ = v.ft_on_transfer(acc(BEN), U128(1000), String::new());
}

// ---------- claims ----------

#[test]
#[should_panic(expected = "nothing to claim")]
fn claim_before_the_cliff_panics() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000, T0);
    ctx(BEN, T0 + CLIFF - 1);
    let _ = v.claim();
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn claim_with_nothing_deposited_panics() {
    let mut v = vault(0, 0);
    ctx(BEN, T0 + 1);
    let _ = v.claim();
}

#[test]
fn claim_marks_claimed_and_sends_ft_transfer_to_the_beneficiary() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    ctx("stranger.testnet", T0 + CLIFF + VEST / 2);
    let _ = v.claim();
    assert_eq!(v.claimed, 500 * UNIT, "marked before the transfer");
    assert_eq!(
        get_logs(),
        vec![r#"EVENT_JSON:{"standard":"realsies_vault","version":"1.0.0","event":"claim","data":[{"beneficiary":"team.testnet","amount":"500000000000000000000","claimed":"500000000000000000000"}]}"#]
    );
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, acc(TOKEN));
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => {
            assert_eq!(method_name, b"ft_transfer");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            let args: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(args["receiver_id"], BEN, "always the beneficiary, never the caller");
            assert_eq!(args["amount"], "500000000000000000000");
        }
        other => panic!("unexpected action {other:?}"),
    }
    assert_eq!(receipts[1].receiver_id, acc(VAULT));
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight { method_name, args, .. } => {
            assert_eq!(method_name, b"on_claim");
            let args: Value = serde_json::from_slice(args).unwrap();
            assert_eq!(args["amount"], "500000000000000000000");
        }
        other => panic!("unexpected action {other:?}"),
    }
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn second_claim_in_the_same_block_panics() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    let ts = T0 + CLIFF + VEST / 2;
    assert_eq!(claim(&mut v, ts), 500 * UNIT);
    ctx(BEN, ts);
    let _ = v.claim();
}

#[test]
fn failed_transfer_restores_claimed() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    let ts = T0 + CLIFF + VEST / 2;
    assert_eq!(claim(&mut v, ts), 500 * UNIT);
    ctx(VAULT, ts + 1);
    assert!(!v.on_claim(U128(500 * UNIT), Err(PromiseError::Failed)));
    assert_eq!(v.claimed, 0);
    assert_eq!(
        get_logs(),
        vec![r#"EVENT_JSON:{"standard":"realsies_vault","version":"1.0.0","event":"claim_failed","data":[{"beneficiary":"team.testnet","amount":"500000000000000000000","claimed":"0"}]}"#]
    );
    // The same tokens can be claimed again.
    assert_eq!(claim(&mut v, ts + 2), mul_div(1000 * UNIT, VEST / 2 + 2, VEST));
}

#[test]
fn failed_transfer_after_a_later_claim_only_restores_its_own_amount() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST / 4), 250 * UNIT);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST / 2), 250 * UNIT);
    // The first transfer's callback arrives late and reports failure.
    ctx(VAULT, T0 + CLIFF + VEST / 2);
    assert!(!v.on_claim(U128(250 * UNIT), Err(PromiseError::Failed)));
    assert_eq!(v.claimed, 250 * UNIT);
    assert_eq!(claim(&mut v, T0 + CLIFF + VEST / 2), 250 * UNIT);
}

#[test]
fn successful_transfer_keeps_claimed() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    let ts = T0 + CLIFF + VEST;
    assert_eq!(claim(&mut v, ts), 1000 * UNIT);
    ctx(VAULT, ts + 1);
    assert!(v.on_claim(U128(1000 * UNIT), Ok(())));
    assert_eq!(v.claimed, 1000 * UNIT);
    assert!(get_logs().is_empty());
}

// ---------- view ----------

#[test]
fn get_info_json() {
    let mut v = vault(CLIFF, VEST);
    fund(&mut v, 1000 * UNIT, T0);
    claim(&mut v, T0 + CLIFF + VEST / 4);
    ctx("anyone.testnet", T0 + CLIFF + VEST / 2);
    let json = serde_json::to_value(v.get_info()).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "token": TOKEN, "beneficiary": BEN,
            "start_ms": T0, "cliff_ms": CLIFF, "vesting_ms": VEST,
            "total": "1000000000000000000000", "claimed": "250000000000000000000",
            "released_now": "500000000000000000000", "claimable_now": "250000000000000000000",
            "fully_released_at_ms": T0 + CLIFF + VEST
        })
    );
}
