use hex;
use seedelf_core::assets::{Asset, Assets};

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
    )
    .unwrap();
    assert_eq!(a.clone(), a)
}

#[test]
fn assets_can_add() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let b: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let combined: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        2,
    )
    .unwrap();

    let total: Assets = Assets::new().add(a).unwrap().add(b).unwrap();
    let answer: Assets = Assets::new().add(combined).unwrap();

    assert_eq!(total, answer)
}

#[test]
fn assets_can_sub() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let b: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();

    let total: Assets = Assets::new().add(a).unwrap().sub(b).unwrap();
    let answer: Assets = Assets::new();

    assert_eq!(total, answer)
}

#[test]
fn assets_can_split1() {
    let a: Asset = Asset::new(
        "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let b: Asset = Asset::new(
        "a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let c: Asset = Asset::new(
        "b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();

    let total: Vec<Assets> = Assets::new()
        .add(a)
        .unwrap()
        .add(b)
        .unwrap()
        .add(c)
        .unwrap()
        .split(1);
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
    )
    .unwrap();
    let b: Asset = Asset::new(
        "a2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();
    let c: Asset = Asset::new(
        "b2af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5".to_string(),
        "74657374".to_string(),
        1,
    )
    .unwrap();

    let total: Vec<Assets> = Assets::new()
        .add(a)
        .unwrap()
        .add(b)
        .unwrap()
        .add(c)
        .unwrap()
        .split(3);
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
    )
    .unwrap();
    let total: Assets = Assets::new().add(a).unwrap();
    let change: Assets = total.separate(total.clone()).unwrap();
    assert_eq!(change, Assets::new());
    assert_eq!(change.items.len(), 0)
}

#[test]
fn asset_to_hex() {
    let name = "logic.mech";
    let hex_name = "6c6f6769632e6d656368";
    assert_eq!(hex::encode(name), hex_name)
}

// ---------------------------------------------------------------------------
// Asset::parse / Assets::parse
//
// User-facing CLI grammar. Errors must be loud — silently dropping a typo
// would let a user pay fees for a tx that doesn't move what they intended.

const PID: &str = "52af77cf39fd08cf872f04dccf90f27b4fbf09252901f5e88f564ae5";

#[test]
fn asset_parse_round_trips() {
    let a = Asset::parse(&format!("{PID}.74657374=42")).unwrap();
    let b = Asset::new(PID.to_string(), "74657374".to_string(), 42).unwrap();
    assert_eq!(a, b);
}

#[test]
fn asset_parse_trims_whitespace() {
    let a = Asset::parse(&format!("  {PID} . 74657374 = 42  ")).unwrap();
    assert_eq!(a.amount, 42);
}

#[test]
fn asset_parse_rejects_missing_separators() {
    assert!(Asset::parse(&format!("{PID}74657374=1")).is_err()); // no dot
    assert!(Asset::parse(&format!("{PID}.74657374")).is_err()); // no equals
    assert!(Asset::parse("=1").is_err()); // empty lhs hits hex decode
}

#[test]
fn asset_parse_rejects_zero_amount() {
    assert!(Asset::parse(&format!("{PID}.74657374=0")).is_err());
}

#[test]
fn asset_parse_rejects_bad_amount() {
    assert!(Asset::parse(&format!("{PID}.74657374=banana")).is_err());
    assert!(Asset::parse(&format!("{PID}.74657374=-1")).is_err());
}

#[test]
fn asset_parse_rejects_bad_hex() {
    assert!(Asset::parse("zz.74657374=1").is_err());
    assert!(Asset::parse(&format!("{PID}.zz=1")).is_err());
}

#[test]
fn assets_parse_accepts_comma_list() {
    let pid2 = "11".repeat(28);
    let parsed = Assets::parse(&format!("{PID}.aa=1, {pid2}.bb=2")).unwrap();
    assert_eq!(parsed.items.len(), 2);
}

#[test]
fn assets_parse_empty_string_is_empty() {
    let parsed = Assets::parse("").unwrap();
    assert!(parsed.items.is_empty());
}

#[test]
fn assets_parse_whitespace_and_trailing_commas_are_tolerated() {
    let parsed = Assets::parse(&format!("  {PID}.aa=1, ,, ")).unwrap();
    assert_eq!(parsed.items.len(), 1);
}

#[test]
fn assets_parse_propagates_first_error() {
    // The second entry is malformed; the parser must surface it instead of
    // returning the first valid asset only.
    let result = Assets::parse(&format!("{PID}.aa=1,not-a-real-spec"));
    assert!(result.is_err());
}

#[test]
fn assets_parse_merges_duplicate_assets() {
    // Two entries with the same policy_id+token_name accumulate amounts.
    let parsed = Assets::parse(&format!("{PID}.aa=3,{PID}.aa=5")).unwrap();
    assert_eq!(parsed.items.len(), 1);
    assert_eq!(parsed.items[0].amount, 8);
}
