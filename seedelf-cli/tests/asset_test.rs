use seedelf_cli::assets::{Asset, Assets};
use seedelf_cli::transaction;

#[test]
fn assets_can_clone_and_compare() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 0);
    assert_eq!(a.clone(), a)
}

#[test]
fn assets_can_add() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let b: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let combined: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 2);

    let total: Assets = Assets::new().add(a).add(b);
    let answer: Assets = Assets::new().add(combined);

    assert_eq!(total, answer)
}

#[test]
fn assets_can_sub() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let b: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);

    let total: Assets = Assets::new().add(a).sub(b);
    let answer: Assets = Assets::new();

    assert_eq!(total, answer)
}

#[test]
fn min_utxo_with_assets() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let b: Asset = Asset::new("22af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "acabacabacabacabacabacabacabacab".to_string(), 1);

    let total: Assets = Assets::new().add(a).sub(b);
    let minimum: u64 = transaction::wallet_minimum_lovelace_with_assets(total);
    assert_eq!(minimum, 1_715_380)
}


#[test]
fn min_utxo_with_no_assets() {
    let total: Assets = Assets::new();
    let minimum: u64 = transaction::wallet_minimum_lovelace_with_assets(total);
    assert_eq!(minimum, 1_336_100)
}