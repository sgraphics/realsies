//! Realsies game contract.
//!
//! Players hold coins (a NEP-141 token) inside the contract, play coins on a per-viewer handle before a chat,
//! and call "human" or "bot" after it. The operator commits every character at round start, reveals the round
//! secret at the end, and opens each character: bots with one enclave-signed NEAR AI completion per paid chat,
//! verified here with ecrecover; humans with the list of paid viewers. Settlement pays 70% of the wrong calls'
//! coins to the right callers, 20% to the character, 10% to the house; 5% of every play goes to the bot fund.
//!
//! Spec: docs/spec.md section 3. Kept deliberately small: no upgrades, no admin beyond the owner's
//! set-once token and coin unit, and an operator that can never move a player's coins.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};
use std::collections::BTreeMap;

const BPS: u128 = 10_000;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_ON_WITHDRAW: Gas = Gas::from_tgas(10);

uint::construct_uint! {
    pub struct U256(4);
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    if c == 0 {
        return 0;
    }
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Balances,
    Rounds,
    Characters,
    Plays,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Bot,
    Human,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RoundStatus {
    Open,
    Revealed,
    Settled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Right,
    Wrong,
    Refund,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Params {
    /// Share of every play that goes to the bot fund.
    pub fee_bps: u32,
    /// Share of a character's wrong coins that goes to the right callers.
    pub right_bps: u32,
    /// Share of a character's wrong coins that goes to the character (Turing bonus).
    pub character_bps: u32,
    pub min_coins: u32,
    pub max_coins: u32,
    /// Calls are accepted until ends_at + call_grace; reveal is allowed after it.
    pub call_grace_ms: u64,
    /// After ends_at + open_window anyone may settle; unopened characters are refunded.
    pub open_window_ms: u64,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            fee_bps: 500,
            right_bps: 7_000,
            character_bps: 2_000,
            min_coins: 5,
            max_coins: 500,
            call_grace_ms: 60_000,
            open_window_ms: 3_600_000,
        }
    }
}

#[near(serializers = [borsh])]
pub struct Round {
    pub secret_hash: String,
    pub started_ms: u64,
    pub ends_at_ms: u64,
    pub secret: Option<String>,
    pub status: RoundStatus,
    pub characters: Vec<String>,
    pub plays: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Opened {
    pub kind: Kind,
    pub payout: AccountId,
    pub model: Option<String>,
    pub prompt_hash: Option<String>,
    pub signers: Vec<String>,
    pub account: Option<AccountId>,
    pub opened_height: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CharacterResult {
    pub plays: u32,
    pub right_coins: U128,
    pub wrong_coins: U128,
    pub character_payout: U128,
    pub house: U128,
}

#[near(serializers = [borsh])]
pub struct Character {
    pub commitment: String,
    pub committed_height: u64,
    pub opened: Option<Opened>,
    pub result: Option<CharacterResult>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Play {
    pub account: AccountId,
    pub coins: u32,
    /// Base units locked after the fee.
    pub locked: U128,
    pub fee: U128,
    pub call: Option<bool>,
    pub played_height: u64,
    pub played_ms: u64,
    pub character: Option<String>,
    pub outcome: Option<Outcome>,
    /// Base units credited back at settlement (refund, or stake plus reward).
    pub credited: U128,
}

// ---------- inputs ----------

#[near(serializers = [json])]
pub struct CommitItem {
    pub character_id: String,
    pub commitment: String,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct BotProof {
    pub viewer: AccountId,
    pub text: String,
    pub signature: String,
    pub request: String,
}

#[near(serializers = [json])]
pub struct Opening {
    pub character_id: String,
    pub kind: Kind,
    pub salt: String,
    pub payout: AccountId,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub prompt_hash: Option<String>,
    #[serde(default)]
    pub signers: Option<Vec<String>>,
    #[serde(default)]
    pub account: Option<AccountId>,
    #[serde(default)]
    pub proofs: Option<Vec<BotProof>>,
    #[serde(default)]
    pub viewers: Option<Vec<AccountId>>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct DepositMsg {
    #[serde(rename = "for")]
    for_account: AccountId,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ReqMessage {
    role: String,
    content: Value,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ReqBody {
    model: String,
    messages: Vec<ReqMessage>,
}

// ---------- views ----------

#[near(serializers = [json])]
pub struct OpenReport {
    pub character_id: String,
    pub ok: bool,
    pub assigned: u32,
    pub rejected: Vec<String>,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub operator: AccountId,
    pub token: Option<AccountId>,
    pub coin_unit: Option<U128>,
    pub fund: AccountId,
    pub house: AccountId,
    pub test_mode: bool,
    pub params: Params,
    pub latest_round: Option<u64>,
}

#[near(serializers = [json])]
pub struct RoundView {
    pub round_id: u64,
    pub secret_hash: String,
    pub started_ms: u64,
    pub ends_at_ms: u64,
    pub secret: Option<String>,
    pub status: RoundStatus,
    pub characters: Vec<String>,
    pub plays: u32,
}

#[near(serializers = [json])]
pub struct CharacterView {
    pub character_id: String,
    pub commitment: String,
    pub committed_height: u64,
    pub opened: Option<Opened>,
    pub result: Option<CharacterResult>,
}

#[near(serializers = [json])]
pub struct PlayView {
    pub handle: String,
    pub account: AccountId,
    pub coins: u32,
    pub locked: U128,
    pub fee: U128,
    pub call: Option<bool>,
    pub played_height: u64,
    pub played_ms: u64,
    pub character: Option<String>,
    pub outcome: Option<Outcome>,
    pub credited: U128,
}

// ---------- helpers ----------

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = (bytes[i] as char).to_digit(16)?;
        let lo = (bytes[i + 1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
    }
    Some(out)
}

fn is_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn sha256_hex(data: &[u8]) -> String {
    hex_encode(&env::sha256(data))
}

pub fn handle_for(round_id: u64, character_id: &str, viewer: &str, secret: &str) -> String {
    sha256_hex(format!("realsies:v1|handle|{}|{}|{}|{}", round_id, character_id, viewer, secret).as_bytes())
}

fn normalize_signers(signers: &[String]) -> Vec<String> {
    let mut v: Vec<String> = signers.iter().map(|s| s.trim().to_lowercase()).collect();
    v.sort();
    v.dedup();
    v
}

pub fn bot_preimage(
    round_id: u64,
    character_id: &str,
    model: &str,
    prompt_hash: &str,
    signers: &[String],
    payout: &str,
    salt: &str,
) -> String {
    format!(
        "realsies:v1|bot|{}|{}|{}|{}|{}|{}|{}",
        round_id,
        character_id,
        model,
        prompt_hash,
        normalize_signers(signers).join(","),
        payout,
        salt
    )
}

pub fn human_preimage(round_id: u64, character_id: &str, account: &str, payout: &str, salt: &str) -> String {
    format!("realsies:v1|human|{}|{}|{}|{}|{}", round_id, character_id, account, payout, salt)
}

/// EIP-191 personal_sign recovery: returns the 0x-prefixed lowercase address.
pub fn recover_eth_address(text: &str, signature: &str) -> Option<String> {
    let sig = hex_decode(signature.trim().trim_start_matches("0x"))?;
    if sig.len() != 65 {
        return None;
    }
    let mut v = sig[64];
    if v >= 27 {
        v -= 27;
    }
    if v > 1 {
        return None;
    }
    let mut msg = format!("\x19Ethereum Signed Message:\n{}", text.len()).into_bytes();
    msg.extend_from_slice(text.as_bytes());
    let hash = env::keccak256(&msg);
    let pubkey = env::ecrecover(&hash, &sig[..64], v, false)?;
    let addr = env::keccak256(&pubkey);
    Some(format!("0x{}", hex_encode(&addr[12..])))
}

/// Checks one bot proof against the opened character, the viewer's handle tag and the committed signers.
pub fn verify_bot_proof(opened: &Opened, handle: &str, proof: &BotProof) -> Result<(), String> {
    let model = opened.model.as_deref().ok_or("no model")?;
    let prompt_hash = opened.prompt_hash.as_deref().ok_or("no prompt hash")?;
    let mut parts = proof.text.rsplitn(3, ':');
    let resp_hash = parts.next().unwrap_or("");
    let req_hash = parts.next().unwrap_or("");
    let text_model = parts.next().unwrap_or("");
    if text_model != model {
        return Err("signed model differs from the committed model".into());
    }
    if !is_hex(req_hash, 64) || !is_hex(resp_hash, 64) {
        return Err("signed text is not model:hash:hash".into());
    }
    if sha256_hex(proof.request.as_bytes()) != req_hash {
        return Err("request bytes do not match the signed request hash".into());
    }
    let body: ReqBody = serde_json::from_str(&proof.request).map_err(|_| "request is not chat JSON".to_string())?;
    if body.model != model {
        return Err("request model differs".into());
    }
    let m0 = body.messages.first().ok_or("request has no messages")?;
    let p0 = m0.content.as_str().ok_or("message 0 is not text")?;
    if m0.role != "system" || sha256_hex(p0.as_bytes()) != prompt_hash {
        return Err("message 0 is not the committed persona prompt".into());
    }
    let m1 = body.messages.get(1).ok_or("request has no skin message")?;
    let p1 = m1.content.as_str().ok_or("message 1 is not text")?;
    if m1.role != "system" || !p1.contains(&handle[..16]) {
        return Err("message 1 does not carry this chat's tag".into());
    }
    let addr = recover_eth_address(&proof.text, &proof.signature).ok_or("signature does not recover")?;
    if !opened.signers.iter().any(|s| *s == addr) {
        return Err(format!("signer {} is not a committed enclave signer", addr));
    }
    Ok(())
}

fn emit(event: &str, data: Value) {
    let line = json!({ "standard": "realsies", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{}", line));
}

fn ckey(round_id: u64, character_id: &str) -> String {
    format!("{}:{}", round_id, character_id)
}

fn pkey(round_id: u64, handle: &str) -> String {
    format!("{}:{}", round_id, handle)
}

// ---------- contract ----------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Game {
    owner: AccountId,
    operator: AccountId,
    token: Option<AccountId>,
    coin_unit: Option<U128>,
    fund: AccountId,
    house: AccountId,
    test_mode: bool,
    params: Params,
    latest_round: Option<u64>,
    balances: LookupMap<AccountId, u128>,
    rounds: LookupMap<u64, Round>,
    characters: LookupMap<String, Character>,
    plays: LookupMap<String, Play>,
}

#[near]
impl Game {
    #[init]
    pub fn new(
        owner: AccountId,
        operator: AccountId,
        fund: AccountId,
        house: AccountId,
        token: Option<AccountId>,
        coin_unit: Option<U128>,
        test_mode: bool,
        params: Option<Params>,
    ) -> Self {
        let params = params.unwrap_or_default();
        require!(params.right_bps + params.character_bps <= BPS as u32, "shares exceed 100%");
        require!(params.fee_bps < BPS as u32, "fee too high");
        require!(params.min_coins > 0 && params.min_coins <= params.max_coins, "bad coin limits");
        if let Some(u) = &coin_unit {
            require!(u.0 > 0, "coin unit must be positive");
        }
        Self {
            owner,
            operator,
            token,
            coin_unit,
            fund,
            house,
            test_mode,
            params,
            latest_round: None,
            balances: LookupMap::new(StorageKey::Balances),
            rounds: LookupMap::new(StorageKey::Rounds),
            characters: LookupMap::new(StorageKey::Characters),
            plays: LookupMap::new(StorageKey::Plays),
        }
    }

    // ----- owner, set once -----

    pub fn set_token(&mut self, token: AccountId) {
        self.assert_owner();
        require!(self.token.is_none(), "token already set");
        self.token = Some(token);
    }

    pub fn set_coin_unit(&mut self, coin_unit: U128) {
        self.assert_owner();
        require!(self.coin_unit.is_none(), "coin unit already set");
        require!(coin_unit.0 > 0, "coin unit must be positive");
        self.coin_unit = Some(coin_unit);
    }

    pub fn set_operator(&mut self, operator: AccountId) {
        self.assert_owner();
        self.operator = operator;
    }

    // ----- balances -----

    /// NEP-141 receiver. `msg` is empty (credit the sender) or `{"for": "<account>"}` (credit that account).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = self.token.clone().unwrap_or_else(|| env::panic_str("token not set"));
        require!(env::predecessor_account_id() == token, "only the game token is accepted");
        let target = if msg.trim().is_empty() {
            sender_id.clone()
        } else {
            serde_json::from_str::<DepositMsg>(&msg)
                .unwrap_or_else(|_| env::panic_str("msg must be empty or {\"for\": account}"))
                .for_account
        };
        self.credit(&target, amount.0);
        emit("deposit", json!({ "account": target, "from": sender_id, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let account = env::predecessor_account_id();
        let token = self.token.clone().unwrap_or_else(|| env::panic_str("token not set"));
        require!(amount.0 > 0, "nothing to withdraw");
        self.debit(&account, amount.0);
        emit("withdraw", json!({ "account": account, "amount": amount }));
        ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account.clone(), amount, Some("realsies withdraw".to_string()))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_WITHDRAW).on_withdraw(account, amount))
    }

    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_err() {
            self.credit(&account, amount.0);
            emit("withdraw_failed", json!({ "account": account, "amount": amount }));
            return false;
        }
        true
    }

    /// Internal balance move between accounts; the promo account uses it to pay locked bonuses.
    pub fn transfer(&mut self, to: AccountId, amount: U128) {
        let from = env::predecessor_account_id();
        require!(amount.0 > 0, "nothing to transfer");
        self.debit(&from, amount.0);
        self.credit(&to, amount.0);
        emit("transfer", json!({ "from": from, "to": to, "amount": amount }));
    }

    // ----- rounds -----

    pub fn start_round(&mut self, round_id: u64, secret_hash: String, ends_at_ms: u64) {
        self.assert_operator();
        require!(!self.rounds.contains_key(&round_id), "round exists");
        require!(is_hex(&secret_hash, 64), "secret_hash must be 64 hex");
        require!(ends_at_ms > now_ms(), "ends_at must be in the future");
        self.rounds.insert(
            round_id,
            Round {
                secret_hash: secret_hash.clone(),
                started_ms: now_ms(),
                ends_at_ms,
                secret: None,
                status: RoundStatus::Open,
                characters: vec![],
                plays: vec![],
            },
        );
        if self.latest_round.map_or(true, |r| round_id > r) {
            self.latest_round = Some(round_id);
        }
        emit("round_started", json!({ "round_id": round_id, "secret_hash": secret_hash, "ends_at_ms": ends_at_ms }));
    }

    pub fn commit_characters(&mut self, round_id: u64, items: Vec<CommitItem>) {
        self.assert_operator();
        let height = env::block_height();
        let round = self.rounds.get_mut(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
        require!(round.status == RoundStatus::Open && now_ms() < round.ends_at_ms, "round is closed");
        let mut ids = Vec::with_capacity(items.len());
        for item in &items {
            require!(is_hex(&item.character_id, 32), "character_id must be 32 hex");
            require!(is_hex(&item.commitment, 64), "commitment must be 64 hex");
            ids.push(item.character_id.clone());
        }
        round.characters.extend(ids.iter().cloned());
        for item in items {
            let key = ckey(round_id, &item.character_id);
            require!(!self.characters.contains_key(&key), "character already committed");
            self.characters.insert(
                key,
                Character { commitment: item.commitment, committed_height: height, opened: None, result: None },
            );
        }
        emit("characters_committed", json!({ "round_id": round_id, "characters": ids, "height": height }));
    }

    pub fn play(&mut self, round_id: u64, handle: String, coins: u32) {
        let account = env::predecessor_account_id();
        let unit = self.coin_unit.unwrap_or_else(|| env::panic_str("coin unit not set")).0;
        require!(coins >= self.params.min_coins && coins <= self.params.max_coins, "coins out of range");
        require!(is_hex(&handle, 64), "handle must be 64 hex");
        let key = pkey(round_id, &handle);
        require!(!self.plays.contains_key(&key), "handle already played");
        {
            let round = self.rounds.get(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
            require!(round.status == RoundStatus::Open && now_ms() < round.ends_at_ms, "round is closed for plays");
        }
        let amount = coins as u128 * unit;
        self.debit(&account, amount);
        let fee = mul_div(amount, self.params.fee_bps as u128, BPS);
        let fund = self.fund.clone();
        self.credit(&fund, fee);
        let locked = amount - fee;
        self.plays.insert(
            key,
            Play {
                account: account.clone(),
                coins,
                locked: U128(locked),
                fee: U128(fee),
                call: None,
                played_height: env::block_height(),
                played_ms: now_ms(),
                character: None,
                outcome: None,
                credited: U128(0),
            },
        );
        self.rounds.get_mut(&round_id).unwrap().plays.push(handle.clone());
        emit(
            "play",
            json!({ "round_id": round_id, "handle": handle, "account": account, "coins": coins, "locked": U128(locked), "fee": U128(fee) }),
        );
    }

    pub fn call(&mut self, round_id: u64, handle: String, human: bool) {
        let account = env::predecessor_account_id();
        {
            let round = self.rounds.get(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
            require!(
                round.status == RoundStatus::Open && now_ms() <= round.ends_at_ms + self.params.call_grace_ms,
                "round is closed for calls"
            );
        }
        let play = self.plays.get_mut(&pkey(round_id, &handle)).unwrap_or_else(|| env::panic_str("no such play"));
        require!(play.account == account, "not your play");
        require!(play.call.is_none(), "already called");
        play.call = Some(human);
        emit("call", json!({ "round_id": round_id, "handle": handle, "account": account, "human": human }));
    }

    /// Test mode only: close plays and calls now so the round can be revealed and settled.
    pub fn end_round_now(&mut self, round_id: u64) {
        self.assert_operator();
        require!(self.test_mode, "test mode only");
        let grace = self.params.call_grace_ms;
        let round = self.rounds.get_mut(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
        require!(round.status == RoundStatus::Open, "round is not open");
        round.ends_at_ms = now_ms().saturating_sub(grace + 1);
        emit("round_ended_early", json!({ "round_id": round_id, "ends_at_ms": round.ends_at_ms }));
    }

    pub fn reveal_round(&mut self, round_id: u64, secret: String) {
        self.assert_operator();
        let grace = self.params.call_grace_ms;
        let round = self.rounds.get_mut(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
        require!(round.status == RoundStatus::Open, "round is not open");
        require!(now_ms() > round.ends_at_ms + grace, "calls are still open");
        require!(sha256_hex(secret.as_bytes()) == round.secret_hash, "secret does not match");
        round.secret = Some(secret.clone());
        round.status = RoundStatus::Revealed;
        emit("round_revealed", json!({ "round_id": round_id, "secret": secret }));
    }

    pub fn open_characters(&mut self, round_id: u64, openings: Vec<Opening>) -> Vec<OpenReport> {
        self.assert_operator();
        let secret = {
            let round = self.rounds.get(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
            require!(round.status == RoundStatus::Revealed, "round must be revealed and not settled");
            round.secret.clone().unwrap()
        };
        openings.into_iter().map(|o| self.open_one(round_id, &secret, o)).collect()
    }

    pub fn settle_round(&mut self, round_id: u64) {
        let caller = env::predecessor_account_id();
        let (handles, status, ends_at) = {
            let round = self.rounds.get(&round_id).unwrap_or_else(|| env::panic_str("no such round"));
            (round.plays.clone(), round.status, round.ends_at_ms)
        };
        require!(status != RoundStatus::Settled, "already settled");
        let window_over = now_ms() > ends_at + self.params.open_window_ms;
        if caller == self.operator {
            require!(status == RoundStatus::Revealed || window_over, "reveal the round first");
        } else {
            require!(window_over, "only the operator can settle before the open window ends");
        }

        let mut groups: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut refunds: Vec<String> = vec![];
        for h in handles {
            let key = pkey(round_id, &h);
            match self.plays.get(&key).and_then(|p| p.character.clone()) {
                Some(c) => groups.entry(c).or_default().push(key),
                None => refunds.push(key),
            }
        }
        let refunded = refunds.len();
        for key in refunds {
            let (account, locked) = {
                let p = self.plays.get_mut(&key).unwrap();
                p.outcome = Some(Outcome::Refund);
                p.credited = p.locked;
                (p.account.clone(), p.locked.0)
            };
            self.credit(&account, locked);
        }
        let mut characters = 0u32;
        for (cid, keys) in groups {
            self.settle_character(round_id, &cid, keys);
            characters += 1;
        }
        self.rounds.get_mut(&round_id).unwrap().status = RoundStatus::Settled;
        emit("round_settled", json!({ "round_id": round_id, "characters": characters, "refunded_plays": refunded }));
    }

    // ----- views -----

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            operator: self.operator.clone(),
            token: self.token.clone(),
            coin_unit: self.coin_unit,
            fund: self.fund.clone(),
            house: self.house.clone(),
            test_mode: self.test_mode,
            params: self.params.clone(),
            latest_round: self.latest_round,
        }
    }

    pub fn balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_round(&self, round_id: u64) -> Option<RoundView> {
        self.rounds.get(&round_id).map(|r| RoundView {
            round_id,
            secret_hash: r.secret_hash.clone(),
            started_ms: r.started_ms,
            ends_at_ms: r.ends_at_ms,
            secret: r.secret.clone(),
            status: r.status,
            characters: r.characters.clone(),
            plays: r.plays.len() as u32,
        })
    }

    pub fn get_character(&self, round_id: u64, character_id: String) -> Option<CharacterView> {
        self.characters.get(&ckey(round_id, &character_id)).map(|c| CharacterView {
            character_id: character_id.clone(),
            commitment: c.commitment.clone(),
            committed_height: c.committed_height,
            opened: c.opened.clone(),
            result: c.result.clone(),
        })
    }

    pub fn get_play(&self, round_id: u64, handle: String) -> Option<PlayView> {
        self.plays.get(&pkey(round_id, &handle)).map(|p| Self::play_view(&handle, p))
    }

    pub fn get_round_plays(&self, round_id: u64, from_index: Option<u32>, limit: Option<u32>) -> Vec<PlayView> {
        let Some(round) = self.rounds.get(&round_id) else { return vec![] };
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).min(500) as usize;
        round
            .plays
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|h| self.plays.get(&pkey(round_id, h)).map(|p| Self::play_view(h, p)))
            .collect()
    }
}

impl Game {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn assert_operator(&self) {
        require!(env::predecessor_account_id() == self.operator, "operator only");
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let bal = self.balances.get(account).copied().unwrap_or(0);
        self.balances.insert(account.clone(), bal.checked_add(amount).unwrap_or_else(|| env::panic_str("overflow")));
    }

    fn debit(&mut self, account: &AccountId, amount: u128) {
        let bal = self.balances.get(account).copied().unwrap_or(0);
        require!(bal >= amount, "not enough coins");
        self.balances.insert(account.clone(), bal - amount);
    }

    fn play_view(handle: &str, p: &Play) -> PlayView {
        PlayView {
            handle: handle.to_string(),
            account: p.account.clone(),
            coins: p.coins,
            locked: p.locked,
            fee: p.fee,
            call: p.call,
            played_height: p.played_height,
            played_ms: p.played_ms,
            character: p.character.clone(),
            outcome: p.outcome,
            credited: p.credited,
        }
    }

    fn open_one(&mut self, round_id: u64, secret: &str, o: Opening) -> OpenReport {
        let fail = |cid: &str, why: &str| OpenReport {
            character_id: cid.to_string(),
            ok: false,
            assigned: 0,
            rejected: vec![why.to_string()],
        };
        let key = ckey(round_id, &o.character_id);
        let (commitment, committed_height, already) = match self.characters.get(&key) {
            Some(c) => (c.commitment.clone(), c.committed_height, c.opened.clone()),
            None => return fail(&o.character_id, "unknown character"),
        };
        let candidate = match o.kind {
            Kind::Bot => {
                let (Some(model), Some(prompt_hash), Some(signers)) = (&o.model, &o.prompt_hash, &o.signers) else {
                    return fail(&o.character_id, "bot opening needs model, prompt_hash and signers");
                };
                let pre = bot_preimage(round_id, &o.character_id, model, prompt_hash, signers, o.payout.as_str(), &o.salt);
                if sha256_hex(pre.as_bytes()) != commitment {
                    return fail(&o.character_id, "commitment mismatch");
                }
                Opened {
                    kind: Kind::Bot,
                    payout: o.payout.clone(),
                    model: Some(model.clone()),
                    prompt_hash: Some(prompt_hash.clone()),
                    signers: normalize_signers(signers),
                    account: None,
                    opened_height: env::block_height(),
                }
            }
            Kind::Human => {
                let Some(account) = &o.account else {
                    return fail(&o.character_id, "human opening needs account");
                };
                let pre = human_preimage(round_id, &o.character_id, account.as_str(), o.payout.as_str(), &o.salt);
                if sha256_hex(pre.as_bytes()) != commitment {
                    return fail(&o.character_id, "commitment mismatch");
                }
                Opened {
                    kind: Kind::Human,
                    payout: o.payout.clone(),
                    model: None,
                    prompt_hash: None,
                    signers: vec![],
                    account: Some(account.clone()),
                    opened_height: env::block_height(),
                }
            }
        };
        let opened = match already {
            Some(prev) => prev,
            None => {
                self.characters.get_mut(&key).unwrap().opened = Some(candidate.clone());
                emit(
                    "character_opened",
                    json!({ "round_id": round_id, "character_id": o.character_id, "kind": candidate.kind, "payout": candidate.payout, "model": candidate.model, "account": candidate.account }),
                );
                candidate
            }
        };

        let mut assigned = 0u32;
        let mut rejected = vec![];
        match opened.kind {
            Kind::Bot => {
                for proof in o.proofs.unwrap_or_default() {
                    let handle = handle_for(round_id, &o.character_id, proof.viewer.as_str(), secret);
                    let res = self
                        .check_assignable(round_id, &handle, &proof.viewer, committed_height)
                        .and_then(|_| verify_bot_proof(&opened, &handle, &proof));
                    match res {
                        Ok(()) => {
                            self.plays.get_mut(&pkey(round_id, &handle)).unwrap().character = Some(o.character_id.clone());
                            assigned += 1;
                        }
                        Err(e) => rejected.push(format!("{}: {}", proof.viewer, e)),
                    }
                }
            }
            Kind::Human => {
                for viewer in o.viewers.unwrap_or_default() {
                    let handle = handle_for(round_id, &o.character_id, viewer.as_str(), secret);
                    match self.check_assignable(round_id, &handle, &viewer, committed_height) {
                        Ok(()) => {
                            self.plays.get_mut(&pkey(round_id, &handle)).unwrap().character = Some(o.character_id.clone());
                            assigned += 1;
                        }
                        Err(e) => rejected.push(format!("{}: {}", viewer, e)),
                    }
                }
            }
        }
        OpenReport { character_id: o.character_id, ok: true, assigned, rejected }
    }

    fn check_assignable(&self, round_id: u64, handle: &str, viewer: &AccountId, committed_height: u64) -> Result<(), String> {
        let p = self.plays.get(&pkey(round_id, handle)).ok_or("no play on this chat's handle")?;
        if &p.account != viewer {
            return Err("handle was played by another account".into());
        }
        if p.character.is_some() {
            return Err("play already assigned".into());
        }
        if p.played_height <= committed_height {
            return Err("play is not after the character's commitment".into());
        }
        Ok(())
    }

    fn settle_character(&mut self, round_id: u64, character_id: &str, keys: Vec<String>) {
        let ckey = ckey(round_id, character_id);
        let opened = self.characters.get(&ckey).and_then(|c| c.opened.clone()).unwrap();
        let truth_human = opened.kind == Kind::Human;
        let mut right: Vec<(String, AccountId, u128)> = vec![];
        let mut wrong: Vec<String> = vec![];
        let (mut right_sum, mut wrong_sum) = (0u128, 0u128);
        for key in &keys {
            let p = self.plays.get(key).unwrap();
            if p.call == Some(truth_human) {
                right_sum += p.locked.0;
                right.push((key.clone(), p.account.clone(), p.locked.0));
            } else {
                wrong_sum += p.locked.0;
                wrong.push(key.clone());
            }
        }
        let mut char_amt = 0u128;
        let mut house_amt = 0u128;
        if wrong_sum == 0 {
            for (key, account, locked) in right {
                self.mark(&key, Outcome::Right, locked);
                self.credit(&account, locked);
            }
        } else if right_sum == 0 {
            char_amt = mul_div(wrong_sum, (self.params.right_bps + self.params.character_bps) as u128, BPS);
            house_amt = wrong_sum - char_amt;
        } else {
            let right_pot = mul_div(wrong_sum, self.params.right_bps as u128, BPS);
            char_amt = mul_div(wrong_sum, self.params.character_bps as u128, BPS);
            let mut distributed = 0u128;
            for (key, account, locked) in right {
                let share = mul_div(right_pot, locked, right_sum);
                distributed += share;
                self.mark(&key, Outcome::Right, locked + share);
                self.credit(&account, locked + share);
            }
            house_amt = wrong_sum - distributed - char_amt;
        }
        for key in wrong {
            self.mark(&key, Outcome::Wrong, 0);
        }
        let payout = opened.payout.clone();
        self.credit(&payout, char_amt);
        let house = self.house.clone();
        self.credit(&house, house_amt);
        self.characters.get_mut(&ckey).unwrap().result = Some(CharacterResult {
            plays: keys.len() as u32,
            right_coins: U128(right_sum),
            wrong_coins: U128(wrong_sum),
            character_payout: U128(char_amt),
            house: U128(house_amt),
        });
    }

    fn mark(&mut self, key: &str, outcome: Outcome, credited: u128) {
        let p = self.plays.get_mut(key).unwrap();
        p.outcome = Some(outcome);
        p.credited = U128(credited);
    }
}

#[cfg(test)]
mod tests;
