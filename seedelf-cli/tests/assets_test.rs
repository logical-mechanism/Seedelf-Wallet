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

#[test]
fn assets_can_split1() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let b: Asset = Asset::new("a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let c: Asset = Asset::new("b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);

    let total: Vec<Assets> = Assets::new().add(a).add(b).add(c).split(1);
    // Print the resulting parts
    for (i, part) in total.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
    assert_eq!(total.len(), 3)
}

#[test]
fn assets_can_split2() {
    let a: Asset = Asset::new("52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let b: Asset = Asset::new("a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    let c: Asset = Asset::new("b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(), "74657374".to_string(), 1);
    
    let total: Vec<Assets> = Assets::new().add(a).add(b).add(c).split(3);
    // Print the resulting parts
    for (i, part) in total.iter().enumerate() {
        println!("Part {}: {:?}", i + 1, part);
    }
    assert_eq!(total.len(), 1)

    
}