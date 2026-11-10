//! Realsies vesting vault.
//!
//! Holds one NEP-141 token for one beneficiary and releases it on a fixed schedule: nothing before
//! `start_ms + cliff_ms`, then linearly over `vesting_ms`, everything at `start_ms + cliff_ms + vesting_ms`.
//! Anyone may top up (a top-up vests on the same schedule) and anyone may call `claim`, which always pays
//! the beneficiary. There is no owner, no setter and no upgrade method. After deployment the account's
//! access keys are deleted, so the code and the schedule can never change.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_CLAIM: Gas = Gas::from_tgas(10);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// floor(a * b / c) for 0 < c and b <= c. Cannot overflow for any u128 `a` and u64 `b`, `c`:
/// with a = q*c + r, the result is q*b + r*b/c, where q*b <= a and r*b < c*c < 2^128.
fn mul_div(a: u128, b: u64, c: u64) -> u128 {
    let (b, c) = (b as u128, c as u128);
    (a / c) * b + (a % c) * b / c
}

fn emit(event: &str, data: Value) {
    let line = json!({ "standard": "realsies_vault", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", line));
}

#[near(serializers = [json])]
pub struct Info {
    pub token: AccountId,
    pub beneficiary: AccountId,
    pub start_ms: u64,
    pub cliff_ms: u64,
    pub vesting_ms: u64,
    pub total: U128,
    pub claimed: U128,
    pub released_now: U128,
    pub claimable_now: U128,
    pub fully_released_at_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    token: AccountId,
    beneficiary: AccountId,
    start_ms: u64,
    cliff_ms: u64,
    vesting_ms: u64,
    /// Tokens received so far.
    total: u128,
    /// Tokens sent to the beneficiary, including a transfer still in flight.
    claimed: u128,
}

#[near]
impl Vault {
    /// Runs once, in the deploy transaction. Private: only the vault account itself can call it.
    #[init]
    #[private]
    pub fn new(token: AccountId, beneficiary: AccountId, cliff_ms: U64, vesting_ms: U64, start_ms: Option<U64>) -> Self {
        let start_ms = start_ms.map_or_else(env::block_timestamp_ms, |s| s.0);
        let end = start_ms.checked_add(cliff_ms.0).and_then(|t| t.checked_add(vesting_ms.0));
        require!(end.is_some(), "schedule overflows");
        Self { token, beneficiary, start_ms, cliff_ms: cliff_ms.0, vesting_ms: vesting_ms.0, total: 0, claimed: 0 }
    }

    /// NEP-141 receiver. Only `token` is accepted: anything else panics, so the sending token refunds it.
    /// Keeps the whole amount, which vests on the same schedule. `msg` is ignored.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let _ = msg;
        require!(env::predecessor_account_id() == self.token, "only the vault token is accepted");
        self.total = self.total.checked_add(amount.0).unwrap_or_else(|| env::panic_str("total overflows"));
        emit("deposit", json!({ "from": sender_id, "amount": amount, "total": U128(self.total) }));
        PromiseOrValue::Value(U128(0))
    }

    /// Sends everything released and not yet claimed to the beneficiary. Anyone may call it.
    /// `claimed` is raised before the transfer, so a second call cannot pay the same tokens twice.
    pub fn claim(&mut self) -> Promise {
        let amount = self.claimable(env::block_timestamp_ms());
        require!(amount > 0, "nothing to claim");
        self.claimed += amount;
        emit("claim", json!({ "beneficiary": self.beneficiary, "amount": U128(amount), "claimed": U128(self.claimed) }));
        ext_ft::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(self.beneficiary.clone(), U128(amount), Some("vesting claim".to_string()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CLAIM).on_claim(U128(amount)))
    }

    /// Callback of `claim`. If the transfer failed (for example the beneficiary is not registered on the
    /// token), the tokens never left, so `claimed` goes back down and they can be claimed again.
    #[private]
    pub fn on_claim(&mut self, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if matches!(result, Err(PromiseError::Failed)) {
            self.claimed -= amount.0;
            emit("claim_failed", json!({ "beneficiary": self.beneficiary, "amount": amount, "claimed": U128(self.claimed) }));
            return false;
        }
        true
    }

    pub fn get_info(&self) -> Info {
        let now = env::block_timestamp_ms();
        Info {
            token: self.token.clone(),
            beneficiary: self.beneficiary.clone(),
            start_ms: self.start_ms,
            cliff_ms: self.cliff_ms,
            vesting_ms: self.vesting_ms,
            total: U128(self.total),
            claimed: U128(self.claimed),
            released_now: U128(self.released(now)),
            claimable_now: U128(self.claimable(now)),
            fully_released_at_ms: self.start_ms + self.cliff_ms + self.vesting_ms,
        }
    }
}

impl Vault {
    /// Released at `now_ms`: 0 before the cliff end, then total * elapsed / vesting_ms, then total.
    fn released(&self, now_ms: u64) -> u128 {
        let cliff_end = self.start_ms + self.cliff_ms;
        if now_ms < cliff_end {
            return 0;
        }
        let elapsed = now_ms - cliff_end;
        if elapsed >= self.vesting_ms {
            return self.total;
        }
        mul_div(self.total, elapsed, self.vesting_ms)
    }

    fn claimable(&self, now_ms: u64) -> u128 {
        self.released(now_ms).saturating_sub(self.claimed)
    }
}

#[cfg(test)]
mod tests;
