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
    let minimum: u64 =
        transaction::address_minimum_lovelace_with_assets(&fixture_params(), address, Assets::new())
            .unwrap();
    assert_eq!(minimum, 978_370)
}

#[test]
fn test_enterprise_address_minimum_lovelace() {
    let address: &str = "addr_test1wp4rlm30ulytuz4j2jrj35ma9maram24kw43cnewphndzsqgdm9k0";
    let minimum: u64 =
        transaction::address_minimum_lovelace_with_assets(&fixture_params(), address, Assets::new())
            .unwrap();
    assert_eq!(minimum, 857_690)
}
