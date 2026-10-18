//! The vectors the data layer's own copy of the token-pool checks is held to
//! (chunk 34's 34c): `seedelf-data` can't depend on this crate, so it keeps
//! its own templates, seed application and datum decoder, written without
//! Pallas or uplc, and its tests read `fixtures/lovejoin-pool-vectors.json`.
//! This test is that file's source: what this crate's derive (uplc applying
//! the pinned templates) and `ReferenceDatum::decode` give.
//!
//! The file is committed. This test fails if this crate stops giving it;
//! `RECORD_LOVEJOIN_VECTORS=1` writes it again, which only a deliberate
//! change to the rules should ever need.

use hex_literal::hex;
use seedelf_core::lovejoin::{ReferenceDatum, templates};
use serde_json::{Value, json};

const FILE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-pool-vectors.json"
);

/// Lovejoin's own token-pool launch on preprod (PR #163), and seeds whose
/// indexes cross every CBOR integer width.
fn seeds() -> Vec<([u8; 32], u64)> {
    let lj = hex!("5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b");
    let mut seeds = vec![(lj, 2)];
    for (i, index) in [0u64, 1, 23, 24, 255, 256, 65_535, 65_536, 4_294_967_296]
        .into_iter()
        .enumerate()
    {
        let mut tx = [0u8; 32];
        for (j, b) in tx.iter_mut().enumerate() {
            *b = (i as u8)
                .wrapping_mul(37)
                .wrapping_add((j as u8).wrapping_mul(11));
        }
        seeds.push((tx, index));
    }
    seeds
}

fn head(major: u8, n: u64) -> Vec<u8> {
    let m = major << 5;
    match n {
        0..=23 => vec![m | n as u8],
        24..=0xff => vec![m | 24, n as u8],
        0x100..=0xffff => [vec![m | 25], (n as u16).to_be_bytes().to_vec()].concat(),
        0x1_0000..=0xffff_ffff => [vec![m | 26], (n as u32).to_be_bytes().to_vec()].concat(),
        _ => [vec![m | 27], n.to_be_bytes().to_vec()].concat(),
    }
}

fn int(n: u64) -> Vec<u8> {
    head(0, n)
}

fn bytes(b: &[u8]) -> Vec<u8> {
    [head(2, b.len() as u64), b.to_vec()].concat()
}

/// Constr 0 of `fields`, as an indefinite list (`serialise_data`'s form) or a definite one.
fn constr0(fields: &[Vec<u8>], indefinite: bool) -> Vec<u8> {
    let mut out = vec![0xd8, 0x79];
    if indefinite {
        out.push(0x9f);
    } else {
        out.extend(head(4, fields.len() as u64));
    }
    for f in fields {
        out.extend(f);
    }
    if indefinite {
        out.push(0xff);
    }
    out
}

const POLICY: [u8; 28] = hex!("02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa");
const M: [u8; 28] = hex!("b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4");
const L: [u8; 28] = hex!("ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953");
const F: [u8; 28] = hex!("69fca85ab7b867159465515d5c22dba7d2ea177c39c105a2a9eef332");

/// Lovejoin's preprod datum's fields, each as given, in order.
fn fields(
    lovelace: Vec<u8>,
    policy: Vec<u8>,
    name: Vec<u8>,
    q: Vec<u8>,
    fee: Vec<u8>,
) -> Vec<Vec<u8>> {
    vec![
        lovelace,
        policy,
        name,
        q,
        fee,
        bytes(&M),
        bytes(&L),
        bytes(&F),
    ]
}

fn lj(q: u64) -> Vec<Vec<u8>> {
    fields(
        int(2_000_000),
        bytes(&POLICY),
        bytes(b"LJTEST"),
        int(q),
        int(1_500_000),
    )
}

/// Every encoding the vectors hold, each with what it tries.
fn datums() -> Vec<(&'static str, Vec<u8>)> {
    let mut d = vec![
        (
            "Lovejoin's preprod pool, as serialise_data writes it",
            constr0(&lj(10_000_000_000_000_000), true),
        ),
        (
            "the same, its fields a definite list",
            constr0(&lj(10_000_000_000_000_000), false),
        ),
        (
            "Q at the ledger's ceiling, 2^64 − 1",
            constr0(&lj(u64::MAX), true),
        ),
        ("Q of 1", constr0(&lj(1), true)),
    ];
    // An integer in a wider form than it needs.
    let mut f = lj(100);
    f[0] = [vec![0x1b], 2_000_000u64.to_be_bytes().to_vec()].concat();
    d.push(("box_lovelace in eight bytes", constr0(&f, true)));
    // Bytes in chunks, an indefinite byte string.
    let mut f = lj(100);
    f[1] = [
        vec![0x5f],
        bytes(&POLICY[..10]),
        bytes(&POLICY[10..]),
        vec![0xff],
    ]
    .concat();
    d.push((
        "token_policy as an indefinite byte string of two chunks",
        constr0(&f, true),
    ));
    // A bignum is an integer to the ledger, not to the wallet.
    let mut f = lj(100);
    f[0] = [vec![0xc2], bytes(&2_000_000u64.to_be_bytes()[5..])].concat();
    d.push(("box_lovelace as a bignum (tag 2)", constr0(&f, true)));
    // Constructor 0 in its general form, tag 102.
    let mut general = vec![0xd8, 0x66, 0x82, 0x00, 0x9f];
    for x in lj(100) {
        general.extend(x);
    }
    general.push(0xff);
    d.push(("constructor 0 as tag 102", general));
    let mut c1 = constr0(&lj(100), true);
    c1[1] = 0x7a;
    d.push(("constructor 1", c1));
    d.push(("seven fields", constr0(&lj(100)[..7], true)));
    let mut nine = lj(100);
    nine.push(int(0));
    d.push(("nine fields", constr0(&nine, true)));
    d.push((
        "box_lovelace 0",
        constr0(
            &fields(int(0), bytes(&POLICY), bytes(b"LJTEST"), int(1), int(1)),
            true,
        ),
    ));
    d.push((
        "box_lovelace negative",
        constr0(
            &fields(vec![0x20], bytes(&POLICY), bytes(b"LJTEST"), int(1), int(1)),
            true,
        ),
    ));
    d.push((
        "max fee 0",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY),
                bytes(b"LJTEST"),
                int(1),
                int(0),
            ),
            true,
        ),
    ));
    d.push((
        "max fee equal to box_lovelace",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY),
                bytes(b"LJTEST"),
                int(1),
                int(2_000_000),
            ),
            true,
        ),
    ));
    d.push((
        "max fee just under box_lovelace",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY),
                bytes(b"LJTEST"),
                int(1),
                int(1_999_999),
            ),
            true,
        ),
    ));
    d.push((
        "a 27-byte policy",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY[..27]),
                bytes(b"LJTEST"),
                int(1),
                int(1),
            ),
            true,
        ),
    ));
    d.push((
        "a 32-byte name",
        constr0(
            &fields(
                int(4_500_000),
                bytes(&POLICY),
                bytes(&[0x4e; 32]),
                int(1),
                int(1),
            ),
            true,
        ),
    ));
    d.push((
        "a 33-byte name",
        constr0(
            &fields(
                int(4_500_000),
                bytes(&POLICY),
                bytes(&[0x4e; 33]),
                int(1),
                int(1),
            ),
            true,
        ),
    ));
    d.push((
        "an empty name",
        constr0(
            &fields(int(4_500_000), bytes(&POLICY), bytes(b""), int(7), int(1)),
            true,
        ),
    ));
    d.push((
        "Q of 0",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY),
                bytes(b"LJTEST"),
                int(0),
                int(1),
            ),
            true,
        ),
    ));
    d.push((
        "Q negative",
        constr0(
            &fields(
                int(2_000_000),
                bytes(&POLICY),
                bytes(b"LJTEST"),
                vec![0x20],
                int(1),
            ),
            true,
        ),
    ));
    d.push((
        "an ADA pool: no policy, no name, Q of 0",
        constr0(
            &fields(
                int(25_000_000),
                bytes(b""),
                bytes(b""),
                int(0),
                int(1_500_000),
            ),
            true,
        ),
    ));
    d.push((
        "an ADA pool at the classic pool's 10 ₳",
        constr0(
            &fields(
                int(10_000_000),
                bytes(b""),
                bytes(b""),
                int(0),
                int(1_500_000),
            ),
            true,
        ),
    ));
    d.push((
        "an ADA pool naming a token",
        constr0(
            &fields(int(25_000_000), bytes(b""), bytes(b"LJ"), int(0), int(1)),
            true,
        ),
    ));
    d.push((
        "an ADA pool with a Q",
        constr0(
            &fields(int(25_000_000), bytes(b""), bytes(b""), int(5), int(1)),
            true,
        ),
    ));
    let mut f = lj(100);
    f[5] = bytes(&M[..27]);
    d.push(("a 27-byte mix_box hash", constr0(&f, true)));
    let mut f = lj(100);
    f[7] = [head(4, 1), bytes(&F)].concat();
    d.push(("the fee hash in a list", constr0(&f, true)));
    let mut f = lj(100);
    f[2] = [head(3, 6), b"LJTEST".to_vec()].concat();
    d.push(("the name as text", constr0(&f, true)));
    d.push(("not a constructor", bytes(&[1, 2, 3])));
    d.push(("nothing", Vec::new()));
    // Nested past what the wallet reads, inside a field.
    let mut f = lj(100);
    f[2] = [vec![0x81; 200], int(0)].concat();
    d.push(("a field nested 200 deep", constr0(&f, true)));
    d
}

fn decoded(cbor: &[u8]) -> Value {
    match ReferenceDatum::decode(cbor) {
        Ok(d) => json!({
            "boxLovelace": d.box_value.lovelace.to_string(),
            "token": d.box_value.token.map(|t| json!({
                "policy": hex::encode(t.policy),
                "name": hex::encode(t.name),
                "quantity": t.quantity.to_string(),
            })),
            "maxFee": d.max_fee.to_string(),
            "mixBox": hex::encode(d.mix_box_hash),
            "mixLogic": hex::encode(d.mix_logic_hash),
            "fee": hex::encode(d.fee_hash),
        }),
        Err(_) => json!("rejected"),
    }
}

fn vectors() -> Value {
    let unapplied = templates::unapplied_hashes();
    json!({
        "//": "Written by seedelf-core/tests/lovejoin_vectors_test.rs (RECORD_LOVEJOIN_VECTORS=1) from seedelf-core's own derive and ReferenceDatum::decode. seedelf-data's copy of the token-pool checks is held to it. Never edit by hand.",
        "commit": templates::COMMIT,
        "holder": hex::encode(templates::REFERENCE_HOLDER_HASH),
        "templates": {
            "oneShotMint": hex::encode(unapplied[0]),
            "mixLogic": hex::encode(unapplied[1]),
            "mixBox": hex::encode(unapplied[2]),
            "feeContract": hex::encode(unapplied[3]),
        },
        "derive": seeds().into_iter().map(|(tx, index)| {
            let d = templates::derive(&tx, index).unwrap();
            json!({
                "seed": format!("{}#{index}", hex::encode(tx)),
                "oneShotMint": hex::encode(d.one_shot_mint.hash),
                "mixLogic": hex::encode(d.mix_logic.hash),
                "mixBox": hex::encode(d.mix_box.hash),
                "feeContract": hex::encode(d.fee_contract.hash),
            })
        }).collect::<Vec<_>>(),
        "datums": datums().into_iter().map(|(about, cbor)| json!({
            "about": about,
            "cbor": hex::encode(&cbor),
            "datum": decoded(&cbor),
        })).collect::<Vec<_>>(),
    })
}

#[test]
fn the_data_layers_vectors_are_this_crates_own() {
    let vectors = vectors();
    if std::env::var_os("RECORD_LOVEJOIN_VECTORS").is_some() {
        std::fs::write(FILE, serde_json::to_string_pretty(&vectors).unwrap() + "\n").unwrap();
    }
    let committed: Value = serde_json::from_str(&std::fs::read_to_string(FILE).unwrap()).unwrap();
    assert_eq!(committed, vectors);
}

#[test]
fn the_vectors_try_what_they_say() {
    let datums = datums();
    let verdict = |about: &str| decoded(&datums.iter().find(|(a, _)| *a == about).unwrap().1);
    // The two forms of the launch's own datum, a wider integer and chunked bytes read alike.
    for about in [
        "Lovejoin's preprod pool, as serialise_data writes it",
        "the same, its fields a definite list",
        "box_lovelace in eight bytes",
        "token_policy as an indefinite byte string of two chunks",
        "an ADA pool: no policy, no name, Q of 0",
        "an ADA pool at the classic pool's 10 ₳",
        "a 32-byte name",
        "an empty name",
        "Q at the ledger's ceiling, 2^64 − 1",
        "max fee just under box_lovelace",
    ] {
        assert_ne!(verdict(about), json!("rejected"), "{about}");
    }
    for about in [
        "box_lovelace as a bignum (tag 2)",
        "constructor 0 as tag 102",
        "constructor 1",
        "seven fields",
        "nine fields",
        "box_lovelace 0",
        "box_lovelace negative",
        "max fee 0",
        "max fee equal to box_lovelace",
        "a 27-byte policy",
        "a 33-byte name",
        "Q of 0",
        "Q negative",
        "an ADA pool naming a token",
        "an ADA pool with a Q",
        "a 27-byte mix_box hash",
        "the fee hash in a list",
        "the name as text",
        "not a constructor",
        "nothing",
        "a field nested 200 deep",
    ] {
        assert_eq!(verdict(about), json!("rejected"), "{about}");
    }
}
