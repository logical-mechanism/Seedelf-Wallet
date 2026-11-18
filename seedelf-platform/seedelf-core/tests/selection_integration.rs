//! Integration tests for the core transaction pipeline: coin selection feeding
//! asset accounting feeding change separation and min-UTxO sizing — the exact
//! sequence the `fund` / `transfer` / `sweep` commands run between Koios calls.
//!
//! The network orchestration and the Pallas `StagingTransaction` assembly stay
//! manual-test territory (the command `run()` functions interleave Koios calls
//! with the build, and CLAUDE.md forbids re-extracting builder functions), but
//! the value/token math those commands depend on is exercised here end to end.

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_core::utxos;
use seedelf_koios::koios::{Asset as KoiosAsset, ProtocolParameters, Ratio, UtxoResponse};

const PID: &str = "11111111111111111111111111111111111111111111111111111111";

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        min_fee_a: 44,
        min_fee_b: 155_381,
        coins_per_utxo_size: 4_310,
        key_deposit: 2_000_000,
        drep_deposit: Some(500_000_000),
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
        cost_model_v1: Vec::new(),
        cost_model_v2: Vec::new(),
        min_fee_ref_script_cost_per_byte: Ratio::whole(15),
    }
}

fn ada_utxo(byte: u8, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

fn token_utxo(byte: u8, lovelace: u64, tokens: &[(&str, &str, u64)]) -> UtxoResponse {
    let asset_list: Vec<KoiosAsset> = tokens
        .iter()
        .map(|(pid, name, qty)| KoiosAsset {
            policy_id: (*pid).to_string(),
            asset_name: (*name).to_string(),
            quantity: qty.to_string(),
            ..Default::default()
        })
        .collect();
    UtxoResponse {
        tx_hash: hex::encode([byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(asset_list),
        ..Default::default()
    }
}

/// select -> assets_of -> change min-UTxO for a pure-ADA spend: the selected
/// lovelace must cover both the send goal and a wallet change output.
#[test]
fn pure_ada_selection_covers_goal_and_change() {
    let params = fixture_params();
    let wallet = vec![
        ada_utxo(0x01, 3_000_000),
        ada_utxo(0x02, 6_000_000),
        ada_utxo(0x03, 2_000_000),
    ];
    let goal: u64 = 4_000_000;

    let selected = utxos::select(&params, wallet, goal, Assets::new()).unwrap();
    assert!(
        !selected.is_empty(),
        "11 ADA on hand, a 4 ADA send must select"
    );

    let (total, tokens) = utxos::assets_of(selected).unwrap();
    assert!(tokens.is_empty(), "no native tokens involved");

    let change_min = wallet_minimum_lovelace_with_assets(&params, Assets::new()).unwrap();
    assert!(
        total >= goal + change_min,
        "selected {total} must cover goal {goal} + change min-UTxO {change_min}",
    );
}

/// select -> assets_of -> separate for a token spend: change must be exactly
/// the gathered tokens minus what is sent, with nothing created or lost.
#[test]
fn token_selection_change_conserves_every_token() {
    let params = fixture_params();
    // one UTxO carries the asset being sent (aa) plus an unrelated token (bb)
    let wallet = vec![
        token_utxo(0x01, 5_000_000, &[(PID, "aa", 10), (PID, "bb", 7)]),
        ada_utxo(0x02, 8_000_000),
    ];
    let send: Assets = Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 4).unwrap())
        .unwrap();

    let selected = utxos::select(&params, wallet, 2_000_000, send.clone()).unwrap();
    assert!(
        !selected.is_empty(),
        "wallet holds the token and enough ADA"
    );

    let (total, found) = utxos::assets_of(selected).unwrap();
    assert!(
        found.contains(send.clone()),
        "selection must hold what is sent"
    );

    // change == gathered tokens minus what is sent
    let change = found.separate(send).unwrap();
    let amount_of = |name: &str| {
        change
            .items
            .iter()
            .find(|a| a.token_name == hex::decode(name).unwrap())
            .map(|a| a.amount)
    };
    assert_eq!(amount_of("aa"), Some(6), "aa change is 10 - 4");
    assert_eq!(amount_of("bb"), Some(7), "bb is untouched, stays in change");

    let change_min = wallet_minimum_lovelace_with_assets(&params, change).unwrap();
    assert!(
        total >= 2_000_000 + change_min,
        "selected {total} must cover goal + token-change min-UTxO {change_min}",
    );
}

/// A wallet that cannot satisfy the change min-UTxO must select nothing — the
/// guard that stops a command from building a sub-minimum change output.
#[test]
fn selection_refuses_when_change_min_unsatisfiable() {
    let params = fixture_params();
    // single UTxO: the needed token, a residual token, and only just enough
    // lovelace for the goal — nothing left for the mandatory change output.
    let wallet = vec![token_utxo(
        0x01,
        2_000_000,
        &[(PID, "aa", 5), (PID, "bb", 3)],
    )];
    let send: Assets = Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 2).unwrap())
        .unwrap();

    let selected = utxos::select(&params, wallet, 2_000_000, send).unwrap();
    assert!(
        selected.is_empty(),
        "no lovelace left for the bb change output — selection must decline",
    );
}

/// `fund`'s own steps (fund.rs: `collect_address_utxos`, which leaves out a
/// pure 5 ₳ UTxO as the assumed collateral, then `select`) on an address whose
/// ADA sits in a UTxO holding another token, larger than the one holding the
/// token sent. `select` passed that UTxO for good while the token was still
/// to find, so it picked nothing, and `fund` said "Not Enough
/// Lovelace/Tokens" (chunk 51, r2b#2).
#[test]
fn fund_takes_ada_from_a_token_utxo_sorted_ahead_of_the_one_holding_the_token() {
    const OTHER: &str = "22222222222222222222222222222222222222222222222222222222";
    let params = fixture_params();
    // A holds 50 ₳ and 1 of an unrelated token, B 1.5 ₳ and the 100 being
    // sent, C is a pure 5 ₳ UTxO, left out: 51.5 ₳ and the token are usable.
    let address = vec![
        token_utxo(0x01, 50_000_000, &[(OTHER, "bb", 1)]),
        token_utxo(0x02, 1_500_000, &[(PID, "aa", 100)]),
        ada_utxo(0x03, 5_000_000),
    ];
    let usable = utxos::collect_address_utxos(address).unwrap();
    assert_eq!(usable.len(), 2, "fund leaves out only the pure 5 ₳ UTxO");
    let sent: Assets = Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 100).unwrap())
        .unwrap();

    // `fund --lovelace 10000000 --asset <PID>.aa=100`, and the same with no
    // --lovelace, where the goal is the token output's minimum.
    let token_minimum = wallet_minimum_lovelace_with_assets(&params, sent.clone()).unwrap();
    for goal in [10_000_000, token_minimum] {
        let picked = utxos::select(&params, usable.clone(), goal, sent.clone()).unwrap();
        assert!(
            !picked.is_empty(),
            "the address holds 51.5 ₳ and the token, yet nothing was picked for {goal} lovelace"
        );
        // What select promises when it picks: the token, the goal, and a
        // change output at its minimum.
        let (total, found) = utxos::assets_of(picked).unwrap();
        assert!(
            found.contains(sent.clone()),
            "the pick holds the token sent"
        );
        let change = found.separate(sent.clone()).unwrap();
        let change_minimum = wallet_minimum_lovelace_with_assets(&params, change).unwrap();
        assert!(
            total >= goal + change_minimum,
            "picked {total} lovelace, short of the goal {goal} and the change's {change_minimum}"
        );
    }
}

/// The names of `picked`, by the byte their hashes are made of.
fn labels(picked: &[UtxoResponse]) -> Vec<String> {
    picked
        .iter()
        .map(|u| format!("U{}", u8::from_str_radix(&u.tx_hash[..2], 16).unwrap()))
        .collect()
}

/// What select promises when it picks: the tokens, the goal, and a change
/// output at its minimum.
fn assert_pays(params: &ProtocolParameters, picked: &[UtxoResponse], goal: u64, sent: &Assets) {
    let (total, found) = utxos::assets_of(picked.to_vec()).unwrap();
    assert!(
        found.contains(sent.clone()),
        "the pick holds the tokens sent"
    );
    let change = found.separate(sent.clone()).unwrap();
    let change_minimum = wallet_minimum_lovelace_with_assets(params, change).unwrap();
    assert!(
        total >= goal + change_minimum,
        "picked {total} lovelace, short of the goal {goal} and the change's {change_minimum}"
    );
}

/// Those holding the token sent lead only until they hold all of it (chunk
/// 51, r2cli#2). After them came every other holder, so one holding 1 of it,
/// 60 other tokens and 9.4 ₳ was taken for its ADA ahead of 100 ₳ of ADA
/// alone. Its 61 tokens went to the change, whose floor (4 outputs' worth at
/// 20 tokens each, 41.6 ₳) took the goal past the 129.4 ₳ the address holds:
/// `fund` said "Not Enough Lovelace/Tokens" for a payment U1 and U3 make, and
/// spent the holder needlessly for a smaller one.
#[test]
fn fund_takes_ada_alone_before_another_holder_of_the_token_sent() {
    let params = fixture_params();
    // U1: 20 ₳ and the 100 T sent. U2: 9.4 ₳, 1 T and 60 NFTs of 60
    // policies. U3: 100 ₳ alone.
    let policies: Vec<String> = (0..60u8).map(|i| hex::encode([0x40 + i; 28])).collect();
    let mut u2_tokens: Vec<(&str, &str, u64)> = vec![(PID, "aa", 1)];
    u2_tokens.extend(policies.iter().map(|p| (p.as_str(), "01", 1)));
    let address = vec![
        token_utxo(0x01, 20_000_000, &[(PID, "aa", 100)]),
        token_utxo(0x02, 9_400_000, &u2_tokens),
        ada_utxo(0x03, 100_000_000),
    ];
    // fund.rs: no pure 5 ₳ UTxO, no reference script, nothing overflows.
    let usable = utxos::collect_address_utxos(address).unwrap();
    let (usable, left) = utxos::fitting(&usable, &Assets::new(), |_| false).unwrap();
    assert_eq!(
        (usable.len(), left.len()),
        (3, 0),
        "fund hands select all three"
    );
    let sent: Assets = Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 100).unwrap())
        .unwrap();

    // `fund -l 100000000 --asset <PID>.aa=100`, and the same with -l 50000000.
    for goal in [100_000_000, 50_000_000] {
        let picked = utxos::select(&params, usable.clone(), goal, sent.clone()).unwrap();
        assert_eq!(
            labels(&picked),
            ["U1", "U3"],
            "the token's holder, then ADA alone, for {goal} lovelace"
        );
        assert_pays(&params, &picked, goal, &sent);
    }
}

/// With two tokens sent, only the holders each needs lead: A's that brings
/// most, then B's. A second holder of A, with 40 other tokens, stays put,
/// where taking every holder until both were found spent it and put its 41
/// tokens in the change (chunk 51, r2cli#2).
#[test]
fn fund_of_two_tokens_takes_only_the_holders_it_needs() {
    const B: &str = "33333333333333333333333333333333333333333333333333333333";
    let params = fixture_params();
    let policies: Vec<String> = (0..40u8).map(|i| hex::encode([0x40 + i; 28])).collect();
    let mut second_tokens: Vec<(&str, &str, u64)> = vec![(PID, "aa", 5)];
    second_tokens.extend(policies.iter().map(|p| (p.as_str(), "01", 1)));
    let address = vec![
        token_utxo(0x01, 30_000_000, &[(PID, "aa", 10)]),
        token_utxo(0x02, 20_000_000, &second_tokens),
        token_utxo(0x03, 2_000_000, &[(B, "bb", 10)]),
        ada_utxo(0x04, 100_000_000),
    ];
    let sent: Assets = Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 10).unwrap())
        .unwrap()
        .add(Asset::new(B.to_string(), "bb".to_string(), 10).unwrap())
        .unwrap();

    let picked = utxos::select(&params, address, 50_000_000, sent.clone()).unwrap();
    assert_eq!(
        labels(&picked),
        ["U1", "U3", "U4"],
        "A's holder, B's, then ADA alone"
    );
    assert_pays(&params, &picked, 50_000_000, &sent);
}

/// `count` one-of tokens, each of a policy of its own made from `first`.
fn nfts(first: u8, count: u8) -> Vec<(String, String, u64)> {
    (0..count)
        .map(|i| (hex::encode([first + i; 28]), "01".to_string(), 1))
        .collect()
}

/// A UTxO holding `held` of the token being sent beside `others`.
fn holder(byte: u8, lovelace: u64, held: u64, others: &[(String, String, u64)]) -> UtxoResponse {
    let mut tokens: Vec<(&str, &str, u64)> = vec![(PID, "aa", held)];
    tokens.extend(others.iter().map(|(p, n, q)| (p.as_str(), n.as_str(), *q)));
    token_utxo(byte, lovelace, &tokens)
}

/// `--asset <PID>.aa=100`.
fn hundred_sent() -> Assets {
    Assets::new()
        .add(Asset::new(PID.to_string(), "aa".to_string(), 100).unwrap())
        .unwrap()
}

/// `fund`'s own steps over `address` (fund.rs: no pure 5 ₳ UTxO, nothing
/// that overflows), then select for `goal`.
fn fund_picks(address: Vec<UtxoResponse>, goal: u64, sent: &Assets) -> Vec<UtxoResponse> {
    let usable = utxos::collect_address_utxos(address).unwrap();
    let (usable, _) = utxos::fitting(&usable, &Assets::new(), |_| false).unwrap();
    utxos::select(&fixture_params(), usable, goal, sent.clone()).unwrap()
}

/// Of those holding the token sent, the one that brings most leads: its ADA
/// less what the change of its other tokens needs (chunk 51, l3money#1). By
/// how much of the token each held, U1's 150 T beside 40 of the user's NFTs,
/// on 2 ₳, led U2's 100 T on 50 ₳: its 41 kinds put the change's floor at
/// 22 ₳, so `fund -l 45 ₳` was refused, where U2 pays alone, and `-l 10 ₳`
/// spent both.
#[test]
fn fund_takes_the_holder_of_the_token_sent_that_brings_most() {
    let address = vec![
        holder(0x01, 2_000_000, 150, &nfts(0x40, 40)),
        holder(0x02, 50_000_000, 100, &[]),
    ];
    for goal in [45_000_000, 10_000_000] {
        let picked = fund_picks(address.clone(), goal, &hundred_sent());
        assert_eq!(
            labels(&picked),
            ["U2"],
            "U2 pays alone, for {goal} lovelace"
        );
        assert_pays(&fixture_params(), &picked, goal, &hundred_sent());
    }
}

/// Anyone can pay the payer's address a UTxO holding more of the token sent
/// than the user's own holder, with a pile of other tokens beside it, on
/// little ADA. It led, and its pile put the change's floor past all the
/// address held, or went to change on the user's ADA. It comes last now, as
/// one that brings less than nothing (chunk 51, l3cli#2 and l3money#1).
#[test]
fn a_strangers_bigger_holder_of_the_token_sent_comes_last() {
    // l3cli#2's: the user's U1, 10 ₳ and 5,000 SNEK, and U2, 3 ₳ alone; the
    // stranger's S, 10,000 SNEK and 100 tokens of its own at about its least.
    const SNEK: &str = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f";
    let snek = hex::encode("SNEK");
    let mut s_tokens: Vec<(&str, &str, u64)> = vec![(SNEK, snek.as_str(), 10_000)];
    let names: Vec<String> = (0..100u16).map(|i| hex::encode(i.to_be_bytes())).collect();
    let junk = "cd".repeat(28);
    s_tokens.extend(names.iter().map(|n| (junk.as_str(), n.as_str(), 1)));
    let snek_sent: Assets = Assets::new()
        .add(Asset::new(SNEK.to_string(), snek.clone(), 100).unwrap())
        .unwrap();
    let goal = wallet_minimum_lovelace_with_assets(&fixture_params(), snek_sent.clone()).unwrap();
    let address = vec![
        token_utxo(0x01, 10_000_000, &[(SNEK, snek.as_str(), 5_000)]),
        ada_utxo(0x02, 3_000_000),
        token_utxo(0x09, 3_017_000, &s_tokens),
    ];
    let picked = fund_picks(address, goal, &snek_sent);
    assert_eq!(labels(&picked), ["U1"], "the user's holder pays");
    assert_pays(&fixture_params(), &picked, goal, &snek_sent);

    // l3money#1's: the user's U1, 20 ₳ and 100 T, and U3, 100 ₳ alone; the
    // stranger's 1.5 ₳ with 60 NFTs and as much T, its hash ground below
    // U1's, or one more T.
    for (case, stranger) in [
        (
            "as much T, listed first",
            holder(0x00, 1_500_000, 100, &nfts(0x40, 60)),
        ),
        ("one more T", holder(0x09, 1_500_000, 101, &nfts(0x40, 60))),
    ] {
        let address = vec![
            stranger,
            holder(0x01, 20_000_000, 100, &[]),
            ada_utxo(0x03, 100_000_000),
        ];
        for (goal, expected) in [(100_000_000, vec!["U1", "U3"]), (10_000_000, vec!["U1"])] {
            let picked = fund_picks(address.clone(), goal, &hundred_sent());
            assert_eq!(labels(&picked), expected, "{case}, for {goal} lovelace");
            assert_pays(&fixture_params(), &picked, goal, &hundred_sent());
        }
    }
}
