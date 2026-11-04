use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const VECTORS: &str = include_str!("../tests/vectors.json");
const EVIDENCE_SIG: &str = include_str!("../../../experiments/near-ai/evidence/2026-11-04/signature.json");
const EVIDENCE_REQ: &[u8] = include_bytes!("../../../experiments/near-ai/evidence/2026-11-04/request.json");
const EVIDENCE_RESP: &[u8] = include_bytes!("../../../experiments/near-ai/evidence/2026-11-04/response.json");

const COIN: u128 = 1_000_000_000_000_000_000;
const T0: u64 = 1_800_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, ts_ms: u64, height: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("game.testnet"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .block_timestamp(ts_ms * 1_000_000)
        .block_height(height);
    testing_env!(b.build());
}

fn v() -> Value {
    serde_json::from_str(VECTORS).unwrap()
}

fn s(v: &Value, path: &[&str]) -> String {
    let mut cur = v;
    for p in path {
        cur = &cur[*p];
    }
    cur.as_str().unwrap_or_else(|| panic!("missing {:?}", path)).to_string()
}

fn proof(v: &Value, viewer: &str) -> BotProof {
    let p = &v["bot"]["proofs"][viewer];
    BotProof {
        viewer: acc(viewer),
        text: p["text"].as_str().unwrap().into(),
        signature: p["signature"].as_str().unwrap().into(),
        request: p["request"].as_str().unwrap().into(),
    }
}

fn new_game() -> Game {
    ctx("owner.testnet", T0, 1);
    Game::new(
        acc("owner.testnet"),
        acc("ops.testnet"),
        acc("fund.testnet"),
        acc("house.testnet"),
        Some(acc("token.testnet")),
        Some(U128(COIN)),
        true,
        None,
    )
}

fn deposit(g: &mut Game, who: &str, coins: u128, ts: u64, h: u64) {
    ctx("token.testnet", ts, h);
    let msg = format!("{{\"for\":\"{}\"}}", who);
    let _ = g.ft_on_transfer(acc("faucet.testnet"), U128(coins * COIN), msg);
}

fn bal(g: &Game, who: &str) -> u128 {
    g.balance_of(acc(who)).0
}

/// Sets up round 1 with one committed bot and one committed human, as in tests/vectors.json.
fn round_with_characters(g: &mut Game, v: &Value) {
    for who in ["alice.testnet", "bob.testnet", "carol.testnet", "erin.testnet"] {
        deposit(g, who, 100, T0, 2);
    }
    ctx("ops.testnet", T0 + 1_000, 10);
    g.start_round(1, s(v, &["secret_hash"]), T0 + 600_000);
    ctx("ops.testnet", T0 + 2_000, 11);
    g.commit_characters(
        1,
        vec![
            CommitItem { character_id: s(v, &["bot", "character_id"]), commitment: s(v, &["bot", "commitment"]) },
            CommitItem { character_id: s(v, &["human", "character_id"]), commitment: s(v, &["human", "commitment"]) },
        ],
    );
}

fn signers(v: &Value) -> Vec<String> {
    v["bot"]["signers"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect()
}

fn bot_opening_fixed(v: &Value, proofs: Vec<BotProof>) -> Opening {
    Opening {
        character_id: s(v, &["bot", "character_id"]),
        kind: Kind::Bot,
        salt: s(v, &["bot", "salt"]),
        payout: acc(&s(v, &["bot", "payout"])),
        model: Some(s(v, &["bot", "model"])),
        prompt_hash: Some(s(v, &["bot", "prompt_hash"])),
        signers: Some(signers(v)),
        account: None,
        proofs: Some(proofs),
        viewers: None,
    }
}

fn human_opening(v: &Value, viewers: Vec<&str>) -> Opening {
    Opening {
        character_id: s(v, &["human", "character_id"]),
        kind: Kind::Human,
        salt: s(v, &["human", "salt"]),
        payout: acc(&s(v, &["human", "payout"])),
        model: None,
        prompt_hash: None,
        signers: None,
        account: Some(acc(&s(v, &["human", "account"]))),
        proofs: None,
        viewers: Some(viewers.into_iter().map(acc).collect()),
    }
}

#[test]
fn recovers_the_real_near_ai_enclave_signature() {
    ctx("anyone.testnet", T0, 1);
    let sig: Value = serde_json::from_str(EVIDENCE_SIG).unwrap();
    let text = sig["text"].as_str().unwrap();
    let addr = recover_eth_address(text, sig["signature"].as_str().unwrap()).expect("recovers");
    assert_eq!(addr, sig["signing_address"].as_str().unwrap().to_lowercase());
    assert_eq!(addr, "0x3b753b4406613c5e70ae640508632b600424fa0c");
    let parts: Vec<&str> = text.rsplitn(3, ':').collect();
    assert_eq!(parts[1], sha256_hex(EVIDENCE_REQ), "request hash in the signed text matches the exact request bytes");
    assert_eq!(parts[0], sha256_hex(EVIDENCE_RESP), "response hash matches the exact response bytes");
}

#[test]
fn tampered_text_recovers_a_different_address() {
    ctx("anyone.testnet", T0, 1);
    let sig: Value = serde_json::from_str(EVIDENCE_SIG).unwrap();
    let text = sig["text"].as_str().unwrap().replace("glm-5.3-flash", "glm-5.3-flasH");
    let addr = recover_eth_address(&text, sig["signature"].as_str().unwrap());
    assert_ne!(addr.as_deref(), Some("0x3b753b4406613c5e70ae640508632b600424fa0c"));
}

#[test]
fn formats_match_the_spec_vectors() {
    ctx("anyone.testnet", T0, 1);
    let v = v();
    let secret = s(&v, &["secret"]);
    assert_eq!(sha256_hex(secret.as_bytes()), s(&v, &["secret_hash"]));
    let signers = signers(&v);
    let pre = bot_preimage(
        1,
        &s(&v, &["bot", "character_id"]),
        &s(&v, &["bot", "model"]),
        &s(&v, &["bot", "prompt_hash"]),
        &signers,
        &s(&v, &["bot", "payout"]),
        &s(&v, &["bot", "salt"]),
    );
    assert_eq!(pre, s(&v, &["bot", "preimage"]));
    assert_eq!(sha256_hex(pre.as_bytes()), s(&v, &["bot", "commitment"]));
    let hpre = human_preimage(1, &s(&v, &["human", "character_id"]), &s(&v, &["human", "account"]), &s(&v, &["human", "payout"]), &s(&v, &["human", "salt"]));
    assert_eq!(hpre, s(&v, &["human", "preimage"]));
    assert_eq!(handle_for(1, &s(&v, &["bot", "character_id"]), "alice.testnet", &secret), s(&v, &["handles", "alice_bot"]));
}

#[test]
fn full_round_settles_exactly() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);

    // Plays at height 20+, after the commit at height 11.
    let h = |k: &str| s(&v, &["handles", k]);
    ctx("alice.testnet", T0 + 10_000, 20);
    g.play(1, h("alice_bot"), 10);
    ctx("bob.testnet", T0 + 10_000, 21);
    g.play(1, h("bob_bot"), 20);
    ctx("carol.testnet", T0 + 10_000, 22);
    g.play(1, h("carol_bot"), 10);
    g.play(1, h("carol_human"), 10);
    ctx("erin.testnet", T0 + 10_000, 23);
    g.play(1, h("erin_human"), 30);

    ctx("alice.testnet", T0 + 130_000, 30);
    g.call(1, h("alice_bot"), true); // wrong: it is a bot
    ctx("bob.testnet", T0 + 130_000, 31);
    g.call(1, h("bob_bot"), false); // right
    ctx("carol.testnet", T0 + 130_000, 32);
    g.call(1, h("carol_bot"), false); // right, but no proof will be given: refunded
    g.call(1, h("carol_human"), true); // right
    // erin never calls: counts as wrong

    assert_eq!(bal(&g, "fund.testnet"), 4 * COIN, "5% of 80 coins");

    ctx("ops.testnet", T0 + 140_000, 40);
    g.end_round_now(1);
    ctx("ops.testnet", T0 + 141_000, 41);
    g.reveal_round(1, s(&v, &["secret"]));

    // A proof reused for another viewer must be rejected: its message 1 carries alice's chat tag.
    let mut reused = proof(&v, "alice.testnet");
    reused.viewer = acc("bob.testnet");
    ctx("ops.testnet", T0 + 142_000, 42);
    let reports = g.open_characters(
        1,
        vec![
            bot_opening_fixed(&v, vec![proof(&v, "alice.testnet"), reused, proof(&v, "bob.testnet")]),
            human_opening(&v, vec!["carol.testnet", "erin.testnet"]),
        ],
    );
    assert!(reports[0].ok, "{:?}", reports[0].rejected);
    assert_eq!(reports[0].assigned, 2);
    assert_eq!(reports[0].rejected.len(), 1);
    assert!(reports[0].rejected[0].contains("tag"), "{}", reports[0].rejected[0]);
    assert!(reports[1].ok);
    assert_eq!(reports[1].assigned, 2);

    ctx("ops.testnet", T0 + 143_000, 43);
    g.settle_round(1);

    let c = |x: f64| (x * 1e6) as u128 * COIN / 1_000_000;
    assert_eq!(bal(&g, "alice.testnet"), c(90.0));
    assert_eq!(bal(&g, "bob.testnet"), c(105.65));
    assert_eq!(bal(&g, "carol.testnet"), c(118.95));
    assert_eq!(bal(&g, "erin.testnet"), c(70.0));
    assert_eq!(bal(&g, "bots.testnet"), c(1.9));
    assert_eq!(bal(&g, "dave.testnet"), c(5.7));
    assert_eq!(bal(&g, "house.testnet"), c(3.8));
    assert_eq!(bal(&g, "fund.testnet"), c(4.0));
    let total: u128 = ["alice", "bob", "carol", "erin", "bots", "dave", "house", "fund"]
        .iter()
        .map(|w| bal(&g, &format!("{}.testnet", w)))
        .sum();
    assert_eq!(total, 400 * COIN, "no coins created or lost");

    let carol_bot = g.get_play(1, h("carol_bot")).unwrap();
    assert_eq!(carol_bot.outcome, Some(Outcome::Refund));
    let erin = g.get_play(1, h("erin_human")).unwrap();
    assert_eq!(erin.outcome, Some(Outcome::Wrong));
    let bot = g.get_character(1, s(&v, &["bot", "character_id"])).unwrap();
    assert_eq!(bot.opened.unwrap().kind, Kind::Bot);
    assert_eq!(g.get_round(1).unwrap().status, RoundStatus::Settled);
}

#[test]
fn everyone_fooled_pays_the_character_ninety_percent() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    let h = |k: &str| s(&v, &["handles", k]);
    ctx("alice.testnet", T0 + 10_000, 20);
    g.play(1, h("alice_bot"), 10);
    g.call(1, h("alice_bot"), true);
    ctx("bob.testnet", T0 + 10_000, 21);
    g.play(1, h("bob_bot"), 10);
    g.call(1, h("bob_bot"), true);
    ctx("ops.testnet", T0 + 140_000, 40);
    g.end_round_now(1);
    ctx("ops.testnet", T0 + 141_000, 41);
    g.reveal_round(1, s(&v, &["secret"]));
    let r = g.open_characters(1, vec![bot_opening_fixed(&v, vec![proof(&v, "alice.testnet"), proof(&v, "bob.testnet")])]);
    assert_eq!(r[0].assigned, 2, "{:?}", r[0].rejected);
    g.settle_round(1);
    // 19 coins wrong: 90% to the bot's payout account, 10% to the house.
    assert_eq!(bal(&g, "bots.testnet"), 19 * COIN * 9 / 10);
    assert_eq!(bal(&g, "house.testnet"), 19 * COIN / 10);
}

#[test]
fn nobody_wrong_refunds_the_right_callers() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    let h = |k: &str| s(&v, &["handles", k]);
    ctx("carol.testnet", T0 + 10_000, 20);
    g.play(1, h("carol_human"), 10);
    g.call(1, h("carol_human"), true);
    ctx("ops.testnet", T0 + 140_000, 40);
    g.end_round_now(1);
    ctx("ops.testnet", T0 + 141_000, 41);
    g.reveal_round(1, s(&v, &["secret"]));
    g.open_characters(1, vec![human_opening(&v, vec!["carol.testnet"])]);
    g.settle_round(1);
    assert_eq!(bal(&g, "carol.testnet"), 100 * COIN - COIN / 2, "only the 5% fee is gone");
    assert_eq!(bal(&g, "dave.testnet"), 0);
}

#[test]
fn wrong_commitment_is_reported_not_opened() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("ops.testnet", T0 + 140_000, 40);
    g.end_round_now(1);
    ctx("ops.testnet", T0 + 141_000, 41);
    g.reveal_round(1, s(&v, &["secret"]));
    let mut o = human_opening(&v, vec![]);
    o.kind = Kind::Bot; // claim the human was a bot
    o.model = Some("z-ai/glm-5.3-flash".into());
    o.prompt_hash = Some(s(&v, &["bot", "prompt_hash"]));
    o.signers = Some(vec![]);
    let r = g.open_characters(1, vec![o]);
    assert!(!r[0].ok);
    assert_eq!(r[0].rejected[0], "commitment mismatch");
    assert!(g.get_character(1, s(&v, &["human", "character_id"])).unwrap().opened.is_none());
}

#[test]
#[should_panic(expected = "calls are still open")]
fn cannot_reveal_while_calls_are_open() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("ops.testnet", T0 + 300_000, 40);
    g.reveal_round(1, s(&v, &["secret"]));
}

#[test]
#[should_panic(expected = "not your play")]
fn cannot_call_someone_elses_play() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    let h = s(&v, &["handles", "alice_bot"]);
    ctx("alice.testnet", T0 + 10_000, 20);
    g.play(1, h.clone(), 10);
    ctx("bob.testnet", T0 + 10_000, 21);
    g.call(1, h, false);
}

#[test]
#[should_panic(expected = "round is closed for plays")]
fn cannot_play_after_the_round_ends() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("alice.testnet", T0 + 700_000, 20);
    g.play(1, s(&v, &["handles", "alice_bot"]), 10);
}

#[test]
#[should_panic(expected = "not enough coins")]
fn cannot_play_more_than_the_balance() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("alice.testnet", T0 + 10_000, 20);
    g.play(1, s(&v, &["handles", "alice_bot"]), 101);
}

#[test]
#[should_panic(expected = "operator only")]
fn only_the_operator_starts_rounds() {
    let mut g = new_game();
    ctx("alice.testnet", T0, 5);
    g.start_round(9, "00".repeat(32), T0 + 1000);
}

#[test]
fn unopened_round_refunds_after_the_window() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("alice.testnet", T0 + 10_000, 20);
    g.play(1, s(&v, &["handles", "alice_bot"]), 10);
    // Operator disappears. Anyone can settle after ends_at + open_window.
    ctx("stranger.testnet", T0 + 600_000 + 3_600_001, 99);
    g.settle_round(1);
    assert_eq!(bal(&g, "alice.testnet"), 100 * COIN - COIN / 2);
}

#[test]
fn transfer_moves_internal_balance() {
    let mut g = new_game();
    deposit(&mut g, "promo.testnet", 10, T0, 2);
    ctx("promo.testnet", T0, 3);
    g.transfer(acc("ana.testnet"), U128(3 * COIN));
    assert_eq!(bal(&g, "ana.testnet"), 3 * COIN);
    assert_eq!(bal(&g, "promo.testnet"), 7 * COIN);
}

#[test]
fn prune_frees_a_settled_round() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    let h = |k: &str| s(&v, &["handles", k]);
    ctx("carol.testnet", T0 + 10_000, 20);
    g.play(1, h("carol_human"), 10);
    g.call(1, h("carol_human"), true);
    ctx("ops.testnet", T0 + 140_000, 40);
    g.end_round_now(1);
    ctx("ops.testnet", T0 + 141_000, 41);
    g.reveal_round(1, s(&v, &["secret"]));
    g.open_characters(1, vec![human_opening(&v, vec!["carol.testnet"])]);
    g.settle_round(1);
    let before = bal(&g, "carol.testnet");
    // one play and two characters: prune one entry at a time
    assert_eq!(g.prune_round(1, Some(1)), 2);
    assert_eq!(g.prune_round(1, Some(1)), 1);
    assert_eq!(g.prune_round(1, None), 0);
    assert!(g.get_play(1, h("carol_human")).is_none());
    assert!(g.get_character(1, s(&v, &["human", "character_id"])).is_none());
    let r = g.get_round(1).unwrap();
    assert_eq!(r.status, RoundStatus::Settled);
    assert_eq!(r.plays, 0);
    assert_eq!(bal(&g, "carol.testnet"), before, "balances are untouched");
}

#[test]
#[should_panic(expected = "round is not settled")]
fn cannot_prune_an_open_round() {
    let v = v();
    let mut g = new_game();
    round_with_characters(&mut g, &v);
    ctx("ops.testnet", T0 + 20_000, 30);
    g.prune_round(1, None);
}
