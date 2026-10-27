//! The depth check on CBOR from outside the wallet (`seedelf_core::cbor`),
//! and the readers of a Koios row's datum that use it.

use hex_literal::hex;
use pallas_addresses::Address;
use pallas_codec::minicbor::{self, data::Tag};
use seedelf_core::cbor::{MAX_DEPTH, output_within_depth, within_depth};
use seedelf_core::eval;
use seedelf_core::lovejoin::{PoolBox, Protocol, mix_datum};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::UtxoResponse;
use serde_json::json;

/// A list nested `levels` deep around 0.
fn lists(levels: usize) -> Vec<u8> {
    [vec![0x81; levels], vec![0x00]].concat()
}

/// The same, each list of indefinite length.
fn indefinite(levels: usize) -> Vec<u8> {
    [vec![0x9f; levels], vec![0x00], vec![0xff; levels]].concat()
}

/// Maps, each holding one pair: 0 and the next.
fn maps(levels: usize) -> Vec<u8> {
    [[0xa1, 0x00].repeat(levels), vec![0x00]].concat()
}

/// Tags, each on the next.
fn tags(levels: usize) -> Vec<u8> {
    [[0xd8, 0x79].repeat(levels), vec![0x00]].concat()
}

#[test]
fn real_datums_are_well_within_the_limit() {
    let register = Register::create(random_scalar()).unwrap();
    assert!(within_depth(&register.to_vec().unwrap(), 2));
    let datum = mix_datum(&[0xaa; 48], &[0xbb; 48]);
    assert!(within_depth(&datum, 2));
    assert!(!within_depth(&datum, 1));
}

#[test]
fn every_kind_of_nesting_counts_to_the_limit() {
    for nested in [lists, indefinite, maps, tags] {
        assert!(within_depth(&nested(MAX_DEPTH), MAX_DEPTH));
        assert!(!within_depth(&nested(MAX_DEPTH + 1), MAX_DEPTH));
    }
    // An empty list or map is a level too.
    assert!(within_depth(&hex!("8180"), 2));
    assert!(!within_depth(&hex!("8180"), 1));
    assert!(!within_depth(&hex!("81a0"), 1));
}

#[test]
fn far_too_deep_is_refused_without_recursing() {
    // A recursive decoder overflows the stack well before 100,000 levels.
    for nested in [lists, indefinite, maps, tags] {
        let deep = nested(100_000);
        assert!(!within_depth(&deep, MAX_DEPTH));
        // The walk itself doesn't recurse: with no limit, it reads to the end.
        assert!(within_depth(&deep, usize::MAX));
    }
}

#[test]
fn only_one_whole_item_passes() {
    // A list of every kind of item: numbers, bytes and text (whole and in
    // chunks), a map, simple values, floats, an indefinite map and a tag.
    let mixed = hex!(
        "8e 00 20 1b ffffffffffffffff 3b ffffffffffffffff 43 010203"
        "5f 41 01 42 0203 ff 63 616263 7f 61 61 ff a1 00 f5 f6 f9 3c00"
        "fb 3ff0000000000000 bf 01 02 ff d8 18 41 00"
    );
    assert!(within_depth(&mixed, 2));
    assert!(!within_depth(&mixed, 1));

    let bad: [&[u8]; 10] = [
        &[],
        &hex!("82 00"),               // cut short
        &hex!("00 00"),               // something after it
        &hex!("ff"),                  // a break with nothing to end
        &hex!("82 00 ff"),            // a break in a definite list
        &hex!("d8 79 ff"),            // a tag on a break
        &hex!("9f 00"),               // no break
        &hex!("5f 01 ff"),            // a chunk that isn't bytes
        &hex!("1c"),                  // a reserved head
        &hex!("5b ffffffffffffffff"), // longer than it is
    ];
    for cbor in bad {
        assert!(!within_depth(cbor, MAX_DEPTH), "{}", hex::encode(cbor));
    }
}

/// A key address's UTxO as Koios lists it, under `datum` (CBOR).
fn row_with_datum(datum: &[u8]) -> UtxoResponse {
    let address = Address::from_bytes(&[&[0x60][..], &[7; 28]].concat()).unwrap();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([7; 32]), "tx_index": 0,
        "address": address.to_bech32().unwrap(),
        "value": "1500000", "stake_address": null, "payment_cred": "", "epoch_no": 0,
        "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": { "bytes": hex::encode(datum), "value": null },
        "reference_script": null, "asset_list": [], "is_spent": false,
    }))
    .unwrap()
}

#[test]
fn the_evaluator_is_never_handed_a_datum_too_deep_to_read() {
    let row = row_with_datum(&lists(MAX_DEPTH));
    assert!(eval::resolve_row(&row).is_ok());
    assert_eq!(eval::refusal(&row), None);
    for datum in [lists(MAX_DEPTH + 1), lists(100_000), hex!("82 00").to_vec()] {
        let err = eval::resolve_row(&row_with_datum(&datum))
            .unwrap_err()
            .to_string();
        assert!(err.contains("holds a datum the wallet can't read"), "{err}");
        // Which is what a Seedelf spend's selection and a session's return ask first.
        assert_eq!(eval::refusal(&row_with_datum(&datum)), Some(err));
    }
    // A reference script isn't carried over, so it's refused the same way.
    let mut scripted = row;
    scripted.reference_script = Some(Default::default());
    let refused = eval::refusal(&scripted).unwrap();
    assert!(refused.contains("holds a reference script"), "{refused}");
    assert_eq!(
        eval::resolve_row(&scripted).unwrap_err().to_string(),
        refused
    );
}

#[test]
fn a_reference_scripts_row_is_never_resolved_under_a_datum_too_deep_to_read() {
    // 1.6.0's release review, 314-wasm#0: a Lovejoin pool's script rows went
    // through here with their datums unchecked, unlike every other row, and
    // anyone launching a pool can put a datum beside its scripts.
    let script = hex!("4e4d01000033222220051200120011");
    let readable = row_with_datum(&lists(MAX_DEPTH));
    assert!(eval::resolve_reference(&readable, 3, &script).is_ok());
    assert_eq!(eval::unreadable_datum(&readable), None);
    for datum in [lists(MAX_DEPTH + 1), lists(100_000), hex!("82 00").to_vec()] {
        let row = row_with_datum(&datum);
        let err = eval::resolve_reference(&row, 3, &script)
            .unwrap_err()
            .to_string();
        assert!(err.contains("holds a datum the wallet can't read"), "{err}");
        // What WebAssembly asks of a pool's script rows first, to pass such a row over.
        assert_eq!(eval::unreadable_datum(&row), Some(err));
    }
    // No datum, or one by its hash alone, is nothing to read.
    let mut none = readable;
    none.inline_datum = None;
    assert_eq!(eval::unreadable_datum(&none), None);
    none.datum_hash = Some(hex::encode([9; 32]));
    assert_eq!(eval::unreadable_datum(&none), None);
}

/// A post-Alonzo output as the ledger encodes one: an address, 1.5 ₳, then
/// `datum` inline and `script` (a reference script, `[kind, bytes]`) if given.
fn output(datum: Option<&[u8]>, script: Option<&[u8]>) -> Vec<u8> {
    let mut e = minicbor::Encoder::new(Vec::new());
    let fields = 2 + u64::from(datum.is_some()) + u64::from(script.is_some());
    e.map(fields).unwrap();
    e.u8(0).unwrap().bytes(&[0x60; 29]).unwrap();
    e.u8(1).unwrap().u64(1_500_000).unwrap();
    if let Some(datum) = datum {
        e.u8(2).unwrap().array(2).unwrap().u8(1).unwrap();
        e.tag(Tag::new(24)).unwrap().bytes(datum).unwrap();
    }
    if let Some(script) = script {
        e.u8(3)
            .unwrap()
            .tag(Tag::new(24))
            .unwrap()
            .bytes(script)
            .unwrap();
    }
    e.into_writer()
}

#[test]
fn an_outputs_datum_and_script_are_each_held_to_the_limit() {
    // 1.6.0's release review, 314-wasm#0: each sits in a byte string, one
    // item to `within_depth`, that a decoder of the output decodes in turn.
    let plutus = hex!("82 03 4e 4d01000033222220051200120011");
    assert!(output_within_depth(&output(None, None), MAX_DEPTH));
    assert!(output_within_depth(&output(None, Some(&plutus)), MAX_DEPTH));
    for nested in [lists, indefinite, maps, tags] {
        // A datum as deep as a Koios row's may be, held on its own.
        let datum = nested(MAX_DEPTH);
        assert!(output_within_depth(
            &output(Some(&datum), Some(&plutus)),
            MAX_DEPTH
        ));
        for levels in [MAX_DEPTH + 1, 100_000] {
            let deep = output(Some(&nested(levels)), Some(&plutus));
            // The walk alone sees one byte string.
            assert!(within_depth(&deep, MAX_DEPTH));
            assert!(!output_within_depth(&deep, MAX_DEPTH));
        }
    }
    // A native script nests as a datum does: `[0, script]`, two levels a level.
    let native = |levels: usize| {
        [
            hex!("82 00").to_vec(),
            hex!("82 01 81").repeat(levels),
            vec![0x00],
        ]
        .concat()
    };
    assert!(output_within_depth(
        &output(None, Some(&native(63))),
        MAX_DEPTH
    ));
    assert!(!output_within_depth(
        &output(None, Some(&native(64))),
        MAX_DEPTH
    ));
    assert!(!output_within_depth(
        &output(None, Some(&native(100_000))),
        MAX_DEPTH
    ));
    // A legacy output embeds nothing.
    let legacy = [
        hex!("82 58 1d").to_vec(),
        vec![0x60; 29],
        hex!("1a 0016e360").to_vec(),
    ]
    .concat();
    assert!(output_within_depth(&legacy, MAX_DEPTH));
    // Laid out as neither the ledger nor the wallet writes one: refused.
    let bad: [&[u8]; 4] = [
        &hex!("a1 02 83 01 d818 41 00 00"), // a datum option of three
        &hex!("bf 01 00 ff"),               // a map of indefinite length
        &hex!("a1 03 41 00"),               // a script not under a tag
        &hex!("a2 01 00"),                  // cut short
    ];
    for cbor in bad {
        assert!(
            !output_within_depth(cbor, MAX_DEPTH),
            "{}",
            hex::encode(cbor)
        );
    }
}

#[test]
fn a_box_too_deep_to_read_is_skipped() {
    let protocol = Protocol::of(true).unwrap();
    let boxed = |datum: &[u8]| -> UtxoResponse {
        let mut row = row_with_datum(datum);
        row.address = protocol.mix_box_address().to_bech32().unwrap();
        row.payment_cred = hex::encode(protocol.mix_box_hash);
        row.value = protocol.denom.to_string();
        row
    };
    let a = Register::create(random_scalar()).unwrap();
    let b = Register::create(random_scalar()).unwrap();
    let point = |hex: &str| -> [u8; 48] { hex::decode(hex).unwrap().try_into().unwrap() };
    let datum = mix_datum(&point(&a.public_value), &point(&b.public_value));
    assert!(PoolBox::from_row(&boxed(&datum), &protocol).is_some());
    // A recursive decoder would overflow the stack on this one.
    assert!(PoolBox::from_row(&boxed(&lists(100_000)), &protocol).is_none());
}
