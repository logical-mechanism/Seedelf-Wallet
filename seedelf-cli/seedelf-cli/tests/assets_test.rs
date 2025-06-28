use hex;
use seedelf_cli::assets::{Asset, Assets};

#[test]
fn default_assets_is_new_assets() {
    let a = Assets::new();
    let b = Assets::default();
    assert_eq!(a, b)
}

#[test]
fn assets_can_clone_and_compare() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        0,
    );
    assert_eq!(a.clone(), a)
}

#[test]
fn assets_can_add() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let b: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let combined: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        2,
    );

    let total: Assets = Assets::new().add(a).add(b);
    let answer: Assets = Assets::new().add(combined);

    assert_eq!(total, answer)
}

#[test]
fn assets_can_sub() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let b: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );

    let total: Assets = Assets::new().add(a).sub(b);
    let answer: Assets = Assets::new();

    assert_eq!(total, answer)
}

#[test]
fn assets_can_split1() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let b: Asset = Asset::new(
        "a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let c: Asset = Asset::new(
        "b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );

    let total: Vec<Assets> = Assets::new().add(a).add(b).add(c).split(1);
    // Print the resulting parts
    for (i, part) in total.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
    assert_eq!(total.len(), 3)
}

#[test]
fn assets_can_split2() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let b: Asset = Asset::new(
        "a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );
    let c: Asset = Asset::new(
        "b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    );

    let total: Vec<Assets> = Assets::new().add(a).add(b).add(c).split(3);
    // Print the resulting parts
    for (i, part) in total.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
    assert_eq!(total.len(), 1)
}

#[test]
fn assets_split_empty() {
    let total: Vec<Assets> = Assets::new().split(3);
    assert_eq!(total, Vec::new())
}

#[test]
fn asset_can_separate() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        22414,
    );
    let total: Assets = Assets::new().add(a);
    let change: Assets = total.separate(total.clone());
    assert_eq!(change, Assets::new());
    assert_eq!(change.items.len(), 0)
}

#[test]
fn asset_to_hex() {
    let name = "logic.mech";
    let hex_name = "6c6f6769632e6d656368";
    assert_eq!(hex::encode(name), hex_name)
}
