use seedelf_cli::assets::{Asset, Assets};

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