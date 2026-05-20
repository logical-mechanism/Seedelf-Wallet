use pallas_crypto::hash::Hash;
use pallas_txbuilder::Input;
use seedelf_core::assets::Assets;
use seedelf_core::transaction;
use seedelf_koios::koios::ProtocolParameters;

/// A fixed parameter set so the lovelace assertions stay deterministic.
/// `coins_per_utxo_size` matches the value baked into the chain at the time
/// these expected numbers were captured; the other fields don't affect
/// `*_minimum_lovelace_*` and are set to plausible values.
fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        coins_per_utxo_size: 4_310,
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
    }
}

#[test]
fn test_seedelf_minimum_lovelace() {
    let minimum: u64 = transaction::seedelf_minimum_lovelace(&fixture_params()).unwrap();
    assert_eq!(minimum, 1_749_860)
}

#[test]
fn test_wallet_minimum_lovelace() {
    let minimum: u64 =
        transaction::wallet_minimum_lovelace_with_assets(&fixture_params(), Assets::new()).unwrap();
    assert_eq!(minimum, 1_456_780)
}

#[test]
fn test_base_address_minimum_lovelace() {
    let address: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let minimum: u64 = transaction::address_minimum_lovelace_with_assets(
        &fixture_params(),
        address,
        Assets::new(),
    )
    .unwrap();
    assert_eq!(minimum, 978_370)
}

#[test]
fn test_enterprise_address_minimum_lovelace() {
    let address: &str = "addr_test1wp4rlm30ulytuz4j2jrj35ma9maram24kw43cnewphndzsqgdm9k0";
    let minimum: u64 = transaction::address_minimum_lovelace_with_assets(
        &fixture_params(),
        address,
        Assets::new(),
    )
    .unwrap();
    assert_eq!(minimum, 857_690)
}

// ---------------------------------------------------------------------------
// seedelf_token_name
//
// The mint redeemer's token name has to match what the contract derives, which
// is deterministic in the smallest-lexicographic input outpoint. If that
// ordering ever changes, every new seedelf would mint under the wrong name and
// fail on-chain.

fn input(hash_byte: u8, index: u64) -> Input {
    Input::new(Hash::new([hash_byte; 32]), index)
}

#[test]
fn token_name_picks_lexicographically_smallest_input() {
    let inputs = vec![input(0x33, 5), input(0x11, 9), input(0x22, 1)];
    let name = transaction::seedelf_token_name("".to_string(), Some(&inputs)).unwrap();
    let hex = hex::encode(&name);
    // prefix + empty label + formatted index "09" + tx_hash (truncated to 64 hex total)
    assert!(hex.starts_with("5eed0e1f"));
    assert_eq!(
        &hex[8..10],
        "09",
        "index byte should be from the 0x11... input"
    );
    assert!(
        hex[10..].starts_with("1111"),
        "tx_hash bytes should be from the 0x11... input, got {hex}"
    );
}

#[test]
fn token_name_breaks_ties_on_txo_index() {
    let inputs = vec![input(0x11, 7), input(0x11, 2), input(0x11, 5)];
    let name = transaction::seedelf_token_name("".to_string(), Some(&inputs)).unwrap();
    let hex = hex::encode(&name);
    assert_eq!(&hex[8..10], "02", "tie should break on lowest txo_index");
}

#[test]
fn token_name_is_independent_of_input_ordering() {
    let a = input(0x11, 9);
    let b = input(0x22, 1);
    let c = input(0x33, 5);
    let n1 = transaction::seedelf_token_name(
        "label".to_string(),
        Some(&vec![a.clone(), b.clone(), c.clone()]),
    )
    .unwrap();
    let n2 = transaction::seedelf_token_name("label".to_string(), Some(&vec![c, b, a])).unwrap();
    assert_eq!(n1, n2);
}

#[test]
fn token_name_is_exactly_32_bytes() {
    let inputs = vec![input(0xab, 0)];
    let name = transaction::seedelf_token_name("seedelf-label".to_string(), Some(&inputs)).unwrap();
    assert_eq!(name.len(), 32);
}

#[test]
fn token_name_encodes_label_as_hex() {
    let inputs = vec![input(0xab, 0)];
    let name = transaction::seedelf_token_name("hi".to_string(), Some(&inputs)).unwrap();
    let hex = hex::encode(&name);
    // 5eed0e1f (8) + hex("hi") = "6869" (4) + index "00" + ab... hash
    assert_eq!(&hex[..14], "5eed0e1f686900");
}

#[test]
fn token_name_truncates_long_labels() {
    let inputs = vec![input(0xab, 0)];
    // a 16-char label hex-encodes to 32 chars; the function truncates label_hex at 30.
    let long_label = "abcdefghijklmnop";
    let name = transaction::seedelf_token_name(long_label.to_string(), Some(&inputs)).unwrap();
    let hex = hex::encode(&name);
    let label_hex_full = hex::encode(long_label);
    let label_hex_truncated = &label_hex_full[..30];
    assert_eq!(&hex[8..8 + 30], label_hex_truncated);
}

#[test]
fn token_name_rejects_missing_inputs() {
    assert!(transaction::seedelf_token_name("".to_string(), None).is_err());
    assert!(transaction::seedelf_token_name("".to_string(), Some(&vec![])).is_err());
}
