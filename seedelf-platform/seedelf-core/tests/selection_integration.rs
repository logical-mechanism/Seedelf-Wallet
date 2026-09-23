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
use seedelf_koios::koios::{Asset as KoiosAsset, ProtocolParameters, UtxoResponse};

const PID: &str = "11111111111111111111111111111111111111111111111111111111";

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        coins_per_utxo_size: 4_310,
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
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
