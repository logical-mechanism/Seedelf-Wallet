use seedelf_core::assets::{Asset, Assets, string_to_u64};
use seedelf_core::utxos;
use seedelf_koios::koios::{Asset as KoiosAsset, ProtocolParameters, UtxoResponse};

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        coins_per_utxo_size: 4_310,
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
    }
}

#[tokio::test]
async fn find_first_large_utxo() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let every_utxo = utxos::get_address_utxos(addr, true).await.unwrap();
    let utxo_vector = utxos::collect_address_utxos(every_utxo).unwrap();
    let selected_utxos =
        utxos::select(&fixture_params(), utxo_vector, 4_446_456, Assets::new()).unwrap();
    for utxo in selected_utxos {
        println!("large {:?}", string_to_u64(utxo.value));
    }
}

#[tokio::test]
async fn find_many_utxos() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let every_utxo = utxos::get_address_utxos(addr, true).await.unwrap();
    let utxo_vector = utxos::collect_address_utxos(every_utxo).unwrap();
    let selected_utxos =
        utxos::select(&fixture_params(), utxo_vector, 2_000_000_000, Assets::new()).unwrap();
    for utxo in selected_utxos {
        println!("many {:?}", string_to_u64(utxo.value));
    }
}

#[tokio::test]
async fn find_nft_and_ada() {
    let addr: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let every_utxo = utxos::get_address_utxos(addr, true).await.unwrap();
    let utxo_vector = utxos::collect_address_utxos(every_utxo).unwrap();
    let tokens: Assets = Assets::new()
        .add(
            Asset::new(
                "b0cbd7cde289d6aa694214fcd95a39e7f3ef52fc94d1171664210677".to_string(),
                "acab".to_string(),
                1,
            )
            .unwrap(),
        )
        .unwrap();
    let selected_utxos =
        utxos::select(&fixture_params(), utxo_vector, 5_000_000, tokens).unwrap();

    for utxo in selected_utxos {
        println!("nft {:?}", string_to_u64(utxo.value));
    }
}

#[test]
fn parse_utxos_correct() {
    let inputs = vec![
        "f33b03d7230e333fb8f26a09b428ab1b3cb6074b1432e773aac353574f29e888#2".to_string(),
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#0".to_string(),
    ];
    let parsed = utxos::parse_tx_utxos(inputs).unwrap();
    println!("{parsed:?}");

    assert_eq!(parsed.len(), 2)
}

// ---------------------------------------------------------------------------
// utxos::select pure-input tests
//
// `select` is the only complex pure algorithm in the codebase: largest-first
// lovelace selection with token-aware change accounting and a recursive
// top-up when the change min-UTxO would push us back below the goal.
// Without unit tests the algorithm was only exercised by live-network smoke
// tests above.

const PID_NEEDED: &str = "11111111111111111111111111111111111111111111111111111111";
const PID_EXTRA: &str = "22222222222222222222222222222222222222222222222222222222";

/// Pure-ada UTxO with `Some(vec![])` (the shape produced by Koios for an
/// outpoint with no native tokens). Used to exercise the "empty asset list
/// sorts first" branch of `select`.
fn ada_utxo(tx_hash_byte: u8, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([tx_hash_byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

fn token_utxo(
    tx_hash_byte: u8,
    lovelace: u64,
    tokens: &[(&str, &str, u64)],
) -> UtxoResponse {
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
        tx_hash: hex::encode([tx_hash_byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(asset_list),
        ..Default::default()
    }
}

fn need_token() -> Assets {
    Assets::new()
        .add(Asset::new(PID_NEEDED.to_string(), "aa".to_string(), 1).unwrap())
        .unwrap()
}

#[test]
fn select_empty_utxos_returns_empty() {
    let selected =
        utxos::select(&fixture_params(), Vec::new(), 1_000_000, Assets::new()).unwrap();
    assert!(selected.is_empty());
}

#[test]
fn select_insufficient_lovelace_returns_empty() {
    // Two small UTxOs that together don't cover the goal.
    let utxos = vec![ada_utxo(0x01, 500_000), ada_utxo(0x02, 300_000)];
    let selected = utxos::select(&fixture_params(), utxos, 2_000_000, Assets::new()).unwrap();
    assert!(selected.is_empty());
}

#[test]
fn select_single_pure_ada_utxo_when_sufficient() {
    let utxos = vec![ada_utxo(0x01, 5_000_000)];
    let selected = utxos::select(&fixture_params(), utxos, 1_000_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(string_to_u64(selected[0].value.clone()).unwrap(), 5_000_000);
}

#[test]
fn select_prefers_largest_ada_utxo_first() {
    // Three pure-ada UTxOs; the largest alone (plus the implicit change
    // buffer of ~1.46M for the datum-bearing wallet change output) covers
    // a small goal, so the algorithm should stop at one UTxO.
    let utxos = vec![
        ada_utxo(0x01, 1_000_000),
        ada_utxo(0x02, 5_000_000),
        ada_utxo(0x03, 3_000_000),
    ];
    let selected = utxos::select(&fixture_params(), utxos, 1_500_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(string_to_u64(selected[0].value.clone()).unwrap(), 5_000_000);
}

#[test]
fn select_combines_multiple_ada_utxos_for_lovelace() {
    // No single UTxO covers a 6M target (with the ~1.46M change buffer); the
    // two largest are pulled in. Smallest UTxO stays untouched.
    let utxos = vec![
        ada_utxo(0x01, 1_000_000),
        ada_utxo(0x02, 5_000_000),
        ada_utxo(0x03, 3_000_000),
    ];
    let selected = utxos::select(&fixture_params(), utxos, 6_000_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 2);
    let total: u64 = selected
        .iter()
        .map(|u| string_to_u64(u.value.clone()).unwrap())
        .sum();
    assert!(total >= 6_000_000);
    let smallest_picked = selected
        .iter()
        .map(|u| string_to_u64(u.value.clone()).unwrap())
        .min()
        .unwrap();
    assert!(smallest_picked >= 3_000_000, "1M UTxO should be left behind");
}

#[test]
fn select_picks_token_bearing_utxo_for_required_token() {
    // Pure-ada UTxO has plenty of lovelace but no required token; token UTxO
    // has the asset. Both should end up selected.
    let utxos = vec![
        ada_utxo(0x01, 5_000_000),
        token_utxo(0x02, 2_000_000, &[(PID_NEEDED, "aa", 1)]),
    ];
    let selected = utxos::select(&fixture_params(), utxos, 1_000_000, need_token()).unwrap();
    let has_token = selected.iter().any(|u| {
        u.asset_list
            .as_ref()
            .is_some_and(|list| list.iter().any(|a| a.policy_id == PID_NEEDED))
    });
    assert!(has_token, "selection must include the token-bearing UTxO");
}

#[test]
fn select_recurses_and_returns_empty_when_change_min_unsatisfiable() {
    // A single UTxO with the needed token *and* a residual "extra" token, with
    // lovelace exactly at the goal. The first pass succeeds on lovelace but
    // the change min-UTxO for the extra token forces a recursion bumping the
    // goal — no more UTxOs to satisfy that, so select returns empty.
    //
    // This is the path that protects callers from building a tx whose change
    // output is below min-UTxO.
    let utxos = vec![token_utxo(
        0x01,
        2_000_000,
        &[(PID_NEEDED, "aa", 1), (PID_EXTRA, "bb", 1)],
    )];
    let selected = utxos::select(&fixture_params(), utxos, 2_000_000, need_token()).unwrap();
    assert!(
        selected.is_empty(),
        "should refuse to select when change can't meet min-UTxO"
    );
}

#[test]
fn select_no_tokens_needed_ignores_token_utxos_when_pure_ada_sufficient() {
    // With only ada needed, the sort puts pure-ada UTxOs first. If they cover
    // the goal, token UTxOs aren't dragged in.
    let utxos = vec![
        ada_utxo(0x01, 5_000_000),
        token_utxo(0x02, 3_000_000, &[(PID_EXTRA, "bb", 1)]),
    ];
    let selected = utxos::select(&fixture_params(), utxos, 1_000_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 1);
    // Confirmed it was the pure-ada UTxO, not the token-bearing one.
    assert!(
        selected[0]
            .asset_list
            .as_ref()
            .is_some_and(|list| list.is_empty()),
        "should have picked the pure-ada UTxO"
    );
}

// ---------------------------------------------------------------------------
// Edge cases that were previously broken.

/// `asset_list: None` represents "no native tokens" the same way
/// `Some(vec![])` does. Build it directly so tests stay honest.
fn ada_utxo_none(tx_hash_byte: u8, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([tx_hash_byte; 32]),
        value: lovelace.to_string(),
        asset_list: None,
        ..Default::default()
    }
}

#[test]
fn select_treats_none_asset_list_as_pure_ada_for_sorting() {
    // A larger UTxO with `None` asset_list and a smaller pure-ada UTxO with
    // `Some(vec![])`. Both mean "no native tokens"; the larger one should win
    // the largest-first sort regardless of how the no-token state is encoded.
    let utxos = vec![
        ada_utxo(0x01, 2_000_000),
        ada_utxo_none(0x02, 5_000_000),
    ];
    let selected = utxos::select(&fixture_params(), utxos, 1_500_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(
        string_to_u64(selected[0].value.clone()).unwrap(),
        5_000_000,
        "the larger UTxO should be picked even when its asset_list is None"
    );
}

#[test]
fn select_uses_none_asset_list_utxo_when_no_tokens_needed() {
    // A wallet whose only UTxO returns `asset_list: None` should still be
    // selectable for a no-tokens search.
    let utxos = vec![ada_utxo_none(0x01, 5_000_000)];
    let selected = utxos::select(&fixture_params(), utxos, 1_000_000, Assets::new()).unwrap();
    assert_eq!(selected.len(), 1);
}

#[test]
fn select_does_not_panic_when_change_min_exceeds_gathered_lovelace() {
    // Degenerate token UTxO: very little ADA but many accessory tokens. After
    // selecting it the change-min math is `multiplier * minimum` > the
    // gathered lovelace, which previously underflowed `current_lovelace_sum -
    // multiplier * minimum`. The function must surface this as a normal
    // "not enough" empty result, not a panic.
    let mut extras: Vec<(&str, &str, u64)> = Vec::new();
    // 30 distinct accessory tokens trip the >MAXIMUM_TOKENS_PER_UTXO (20)
    // branch so the multiplier becomes 2; with realistic min-UTxO values for
    // 20-token outputs (~2M lovelace), 2 * minimum easily exceeds 1M.
    let names: Vec<String> = (0u8..30).map(|i| format!("{:02x}", i)).collect();
    for name in &names {
        extras.push((PID_EXTRA, name.as_str(), 1));
    }
    let mut tokens_vec = vec![(PID_NEEDED, "aa", 1)];
    tokens_vec.extend(extras);
    let utxos = vec![token_utxo(0x01, 1_000_000, &tokens_vec)];
    let selected = utxos::select(&fixture_params(), utxos, 1_000_000, need_token()).unwrap();
    assert!(
        selected.is_empty(),
        "should bail out cleanly instead of underflowing"
    );
}
