use seedelf_core::assets::Assets;
use seedelf_core::transaction;

#[test]
fn test_seedelf_minimum_lovelace() {
    let minimum: u64 = transaction::seedelf_minimum_lovelace();
    assert_eq!(minimum, 1_749_860)
}

#[test]
fn test_wallet_minimum_lovelace() {
    let minimum: u64 = transaction::wallet_minimum_lovelace_with_assets(Assets::new());
    assert_eq!(minimum, 1_456_780)
}

#[test]
fn test_base_address_minimum_lovelace() {
    let address: &str = "addr_test1qrwejm9pza929cedhwkcsprtgs8l2carehs8z6jkse2qp344c43tmm0md55r4ufmxknr24kq6jkvt6spq60edeuhtf4sn2scds";
    let minimum: u64 = transaction::address_minimum_lovelace_with_assets(address, Assets::new());
    assert_eq!(minimum, 978_370)
}

#[test]
fn test_enterprise_address_minimum_lovelace() {
    let address: &str = "addr_test1wp4rlm30ulytuz4j2jrj35ma9maram24kw43cnewphndzsqgdm9k0";
    let minimum: u64 = transaction::address_minimum_lovelace_with_assets(address, Assets::new());
    assert_eq!(minimum, 857_690)
}
