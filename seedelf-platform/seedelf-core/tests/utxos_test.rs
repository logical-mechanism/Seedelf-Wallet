use seedelf_core::assets::{Asset, Assets, string_to_u64};
use seedelf_core::utxos;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{
    Asset as KoiosAsset, InlineDatum, ProtocolParameters, Ratio, UtxoResponse,
};

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        min_fee_a: 44,
        min_fee_b: 155_381,
        coins_per_utxo_size: 4_310,
        key_deposit: 2_000_000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
        min_fee_ref_script_cost_per_byte: Ratio::whole(15),
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
    let selected_utxos = utxos::select(&fixture_params(), utxo_vector, 5_000_000, tokens).unwrap();

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

fn token_utxo(tx_hash_byte: u8, lovelace: u64, tokens: &[(&str, &str, u64)]) -> UtxoResponse {
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
    let selected = utxos::select(&fixture_params(), Vec::new(), 1_000_000, Assets::new()).unwrap();
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
    assert!(
        smallest_picked >= 3_000_000,
        "1M UTxO should be left behind"
    );
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
    let utxos = vec![ada_utxo(0x01, 2_000_000), ada_utxo_none(0x02, 5_000_000)];
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

// ---------------------------------------------------------------------------
// utxos::fitting: what one transaction can hold together
//
// Anyone can send an address UTxOs whose tokens add past a u64, and no output
// can hold that much of one token: three of 2^63 − 1, or 2^64 − 1 and 1.
// ---------------------------------------------------------------------------

const JUNK: u64 = (1 << 63) - 1;

fn outpoints(utxos: &[UtxoResponse]) -> Vec<String> {
    utxos.iter().map(|u| u.tx_hash[..2].to_string()).collect()
}

#[test]
fn fitting_leaves_out_what_would_push_a_token_past_a_u64() {
    let rows = vec![
        token_utxo(0x01, 1_500_000, &[(PID_EXTRA, "aa", JUNK)]),
        ada_utxo(0x02, 20_000_000),
        token_utxo(0x03, 1_500_000, &[(PID_EXTRA, "aa", JUNK)]),
        token_utxo(0x04, 1_500_000, &[(PID_EXTRA, "aa", JUNK)]),
        token_utxo(0x05, 2_000_000, &[(PID_NEEDED, "aa", 7)]),
    ];
    // What adding them all up does, and what the builders used to.
    assert!(utxos::assets_of(rows.clone()).is_err());

    let (taken, left) = utxos::fitting(&rows, &Assets::new(), |_| false).unwrap();
    // Two of 2^63 − 1 fit (2^64 − 2); the third doesn't. Ties go by outpoint.
    assert_eq!(outpoints(&taken), vec!["01", "02", "03", "05"]);
    assert_eq!(outpoints(&left), vec!["04"]);
    let (lovelace, tokens) = utxos::assets_of(taken).unwrap();
    assert_eq!(lovelace, 25_000_000);
    assert_eq!(
        tokens
            .quantity_of(PID_EXTRA.to_string(), "aa".to_string())
            .unwrap(),
        Some(2 * JUNK)
    );
    // What's left fits on its own: a second transaction takes it.
    let (again, none) = utxos::fitting(&left, &Assets::new(), |_| false).unwrap();
    assert_eq!((again.len(), none.len()), (1, 0));

    // The pair that's as bad: 2^64 − 1 and 1.
    let pair = vec![
        token_utxo(0x06, 1_500_000, &[(PID_EXTRA, "aa", u64::MAX)]),
        token_utxo(0x07, 1_500_000, &[(PID_EXTRA, "aa", 1)]),
    ];
    let (taken, left) = utxos::fitting(&pair, &Assets::new(), |_| false).unwrap();
    assert_eq!(
        (outpoints(&taken), outpoints(&left)),
        (vec!["06".into()], vec!["07".into()])
    );

    // Nothing that adds up is ever left out.
    let fine = vec![
        ada_utxo(0x08, 5_000_000),
        token_utxo(0x09, 2_000_000, &[(PID_EXTRA, "aa", 5)]),
    ];
    let (taken, left) = utxos::fitting(&fine, &Assets::new(), |_| false).unwrap();
    assert_eq!((taken.len(), left.len()), (2, 0));
}

#[test]
fn fitting_takes_ada_only_then_its_own_then_the_most_lovelace() {
    let rows = vec![
        token_utxo(0x01, 9_000_000, &[(PID_EXTRA, "aa", JUNK)]),
        token_utxo(0x02, 1_500_000, &[(PID_EXTRA, "aa", JUNK)]),
        token_utxo(0x03, 1_200_000, &[(PID_EXTRA, "aa", JUNK)]),
    ];
    // By lovelace: the smallest is left.
    let (_, left) = utxos::fitting(&rows, &Assets::new(), |_| false).unwrap();
    assert_eq!(outpoints(&left), vec!["03"]);
    // Its own come first, whatever they hold.
    let own = |u: &UtxoResponse| u.tx_hash.starts_with("03");
    let (taken, left) = utxos::fitting(&rows, &Assets::new(), own).unwrap();
    assert_eq!(outpoints(&taken), vec!["01", "03"], "in the order given");
    assert_eq!(outpoints(&left), vec!["02"]);

    // What's there already (a Seedelf UTxO a return merges into) counts too.
    let base = Assets::new()
        .add(Asset::new(PID_EXTRA.to_string(), "aa".to_string(), JUNK).unwrap())
        .unwrap();
    let (taken, left) = utxos::fitting(&rows, &base, |_| false).unwrap();
    assert_eq!(
        (outpoints(&taken), outpoints(&left).len()),
        (vec!["01".into()], 2)
    );
}

// ---------------------------------------------------------------------------
// utxos::reference_script_size: what Conway charges a spent input's script for
// ---------------------------------------------------------------------------

/// A real Koios row holding a reference script: the Seedelf policy's mainnet
/// reference UTxO, 519 bytes, as `utxo_info` listed it on 2026-09-26.
fn recorded_script_row() -> UtxoResponse {
    let rows: Vec<UtxoResponse> =
        serde_json::from_str(include_str!("fixtures/reference_script_utxo.json")).unwrap();
    rows.into_iter().next().unwrap()
}

#[test]
fn a_reference_script_is_measured_from_its_bytes() {
    let row = recorded_script_row();
    assert_eq!(utxos::reference_script_size(&row).unwrap(), 519);
    // Koios's bytes are the script the ledger hashes, and so measures.
    let script = row.reference_script.as_ref().unwrap();
    let mut tagged = vec![0x03];
    tagged.extend(hex::decode(script.bytes.as_ref().unwrap()).unwrap());
    assert_eq!(
        hex::encode(pallas_crypto::hash::Hasher::<224>::hash(&tagged)),
        script.hash.clone().unwrap()
    );
    // A size Koios leaves out isn't needed.
    let mut unsized_row = row.clone();
    unsized_row.reference_script.as_mut().unwrap().size = None;
    assert_eq!(utxos::reference_script_size(&unsized_row).unwrap(), 519);
    // None is none.
    assert_eq!(utxos::reference_script_size(&ada_utxo(0x01, 1)).unwrap(), 0);
    let two = vec![row.clone(), ada_utxo(0x01, 1), row.clone()];
    assert_eq!(utxos::reference_script_bytes(&two).unwrap(), 1_038);
}

#[test]
fn a_reference_script_that_cant_be_measured_is_never_taken_for_none() {
    let row = recorded_script_row();
    let broken = |change: fn(&mut seedelf_koios::koios::ReferenceScript)| {
        let mut row = row.clone();
        change(row.reference_script.as_mut().unwrap());
        utxos::reference_script_size(&row).unwrap_err().to_string()
    };
    for err in [
        // No bytes: how Koios may list a native script.
        broken(|s| s.bytes = None),
        broken(|s| s.bytes = Some("not hex".into())),
        broken(|s| s.bytes = Some(String::new())),
        // Bytes and size that disagree.
        broken(|s| s.size = Some(518)),
        // A shape Koios never sends still counts as a script.
        broken(|s| *s = Default::default()),
    ] {
        assert!(
            err.contains(&format!("UTxO {}#1 holds a reference script", row.tx_hash)),
            "{err}"
        );
        assert!(err.contains("can't price spending it"), "{err}");
    }
    assert!(
        utxos::reference_script_bytes(&[row.clone(), {
            let mut r = row;
            r.reference_script.as_mut().unwrap().bytes = None;
            r
        }])
        .is_err()
    );
}

/// A wallet-contract row under `register`'s inline datum, as Koios returns it.
fn register_utxo(tx_hash_byte: u8, register: &Register) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([tx_hash_byte; 32]),
        value: "5000000".to_string(),
        inline_datum: Some(InlineDatum {
            bytes: hex::encode(register.to_vec().unwrap()),
            value: serde_json::json!({
                "constructor": 0,
                "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
            }),
        }),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

#[test]
fn wallet_scans_skip_an_identity_register() {
    // Anyone can pay the contract under (identity, identity), and anyone can
    // spend it back. It isn't this key's, and it doesn't stop the scan.
    let sk = random_scalar();
    let identity = format!("c0{}", "00".repeat(47));
    let rows = vec![
        register_utxo(0x01, &Register::new(identity.clone(), identity)),
        register_utxo(0x02, &Register::create(sk).unwrap().rerandomize().unwrap()),
    ];
    let hashes = |found: Vec<UtxoResponse>| -> Vec<String> {
        found.into_iter().map(|u| u.tx_hash).collect()
    };
    let owned = vec![hex::encode([0x02; 32])];
    let all = utxos::collect_all_wallet_utxos(sk, PID_EXTRA, rows.clone()).unwrap();
    assert_eq!(hashes(all), owned);
    let usable = utxos::collect_wallet_utxos(sk, PID_EXTRA, rows).unwrap();
    assert_eq!(hashes(usable), owned);
}
