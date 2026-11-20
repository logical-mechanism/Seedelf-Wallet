//! Chunk 51, sign#2 (its verifier's test, widened). gap-g8#5 had the readers take a transaction's list and its maps in
//! either length, but the transaction view's redeemer reader (`decode.rs` `redeemers`) still read each inner array as
//! a definite one: it read an array's head, dropped its count and never read a break. The ledger reads a redeemer's key
//! `[_ tag, index]` and a list-form record `[_ tag, index, data, ex_units]` either way (decodeRecordNamed), and so does
//! Pallas, which the wallet signs from. So Transaction details couldn't show such a transaction ("a redeemer isn't
//! readable"), and an open list whose first record was open lost its second redeemer: the record's break was read as
//! the list's. The witness set isn't signed, so a site can write it so at will. Each inner array is now closed as it's
//! written: its count reached, or its break read. A definite one with more or fewer fields than it has is refused,
//! as the ledger refuses it.

use std::ops::Deref;

use pallas_codec::minicbor;
use pallas_primitives::{Fragment, conway};
use seedelf_wasm::decode::decode_tx;

/// `[body, witnesses, true, null]`: the body a map of `entries`, each value's CBOR as given, the witness set as given.
fn tx(entries: &[(u64, &str)], witnesses: &str) -> String {
    let mut out = Vec::new();
    let mut e = minicbor::Encoder::new(&mut out);
    e.array(4).unwrap();
    e.map(entries.len() as u64).unwrap();
    for (key, value) in entries {
        e.u64(*key).unwrap();
        e.writer_mut()
            .extend_from_slice(&hex::decode(value).unwrap());
    }
    e.writer_mut()
        .extend_from_slice(&hex::decode(witnesses).unwrap());
    e.bool(true).unwrap();
    e.null().unwrap();
    hex::encode(out)
}

/// An outpoint `[id, index]`, of `byte` 32 times, its pair open-length when `open`.
fn input(byte: &str, index: &str, open: bool) -> String {
    let id = byte.repeat(32);
    if open {
        format!("9f5820{id}{index}ff")
    } else {
        format!("825820{id}{index}")
    }
}

/// One output of 2 ₳ to a key address, and the fee.
const OUTPUT: &str = "8182581d60a3d6d926176be50d7d03ecaf007932b670592111602201ae9c20d4381a001e8480";
const FEE: &str = "1a00030d40";

/// A transaction spending two inputs whose witness set holds `redeemers` (key 5, hex, spaces ignored) alone.
fn with_redeemers(redeemers: &str) -> String {
    let inputs = format!("82{}{}", input("11", "00", false), input("22", "01", false));
    let redeemers = redeemers.replace(' ', "");
    tx(
        &[(0, &inputs), (1, OUTPUT), (2, FEE)],
        &format!("a105{redeemers}"),
    )
}

/// How many redeemers Pallas reads in it: what the wallet signs from.
fn pallas_redeemers(cbor: &str) -> usize {
    let bytes = hex::decode(cbor).unwrap();
    let tx = conway::MintedTx::decode_fragment(&bytes).expect("Pallas reads the transaction");
    match tx
        .transaction_witness_set
        .redeemer
        .as_ref()
        .map(|r| r.deref().clone())
    {
        Some(conway::Redeemers::Map(m)) => m.iter().count(),
        Some(conway::Redeemers::List(l)) => l.iter().count(),
        None => 0,
    }
}

/// A redeemer as Transaction details shows it: its tag, index, argument (hex), memory and steps.
type Shown = (String, String, String, String, String);

/// What Transaction details shows of its redeemers.
fn shown(cbor: &str) -> Result<Vec<Shown>, String> {
    decode_tx("preprod", cbor)
        .map(|d| {
            d.redeemers
                .into_iter()
                .map(|r| (r.tag, r.index, r.data, r.mem, r.steps))
                .collect()
        })
        .map_err(|e| e.to_string())
}

fn redeemer(tag: &str, index: &str, data: &str, mem: &str, steps: &str) -> Shown {
    (
        tag.into(),
        index.into(),
        data.into(),
        mem.into(),
        steps.into(),
    )
}

#[test]
fn a_redeemer_key_written_open_length_is_read_as_pallas_and_the_ledger_read_it() {
    // Conway's map, `{[0, 0]: [d87980, [7, 9]]}`, then each inner array written open-length in turn.
    let definite = with_redeemers("a1820000 82d87980820709");
    let open_key = with_redeemers("a19f0000ff 82d87980820709");
    let open_value = with_redeemers("a1820000 9fd87980820709ff");
    let open_units = with_redeemers("a1820000 82d879809f0709ff");
    let one = vec![redeemer("spend", "0", "d87980", "7", "9")];
    for (name, cbor) in [
        ("definite", &definite),
        ("key", &open_key),
        ("value", &open_value),
        ("ex-units", &open_units),
    ] {
        let cbor = cbor.replace(' ', "");
        assert_eq!(pallas_redeemers(&cbor), 1, "{name}: Pallas reads it");
        assert_eq!(
            shown(&cbor),
            Ok(one.clone()),
            "{name}: Transaction details shows it"
        );
    }
    // Two entries, the first's key open: the second is read from where the first ends.
    let two = with_redeemers("a2 9f0000ff 82d87980820709 820001 8201820305");
    let two = two.replace(' ', "");
    assert_eq!(pallas_redeemers(&two), 2);
    assert_eq!(
        shown(&two),
        Ok(vec![
            redeemer("spend", "0", "d87980", "7", "9"),
            redeemer("spend", "1", "01", "3", "5"),
        ])
    );
}

#[test]
fn a_list_form_redeemer_written_open_length_is_neither_refused_nor_dropped() {
    let first = "9f000000820000ff";
    let second = "84000101820203";
    let both = vec![
        redeemer("spend", "0", "00", "0", "0"),
        redeemer("spend", "1", "01", "2", "3"),
    ];
    let definite_list = with_redeemers(&format!("82{first}{second}"));
    let open_list = with_redeemers(&format!("9f{first}{second}ff"));
    assert_eq!(pallas_redeemers(&definite_list), 2);
    assert_eq!(pallas_redeemers(&open_list), 2);
    assert_eq!(
        (shown(&definite_list), shown(&open_list)),
        (Ok(both.clone()), Ok(both)),
        "refused, or shown with a redeemer fewer than the transaction runs"
    );
}

#[test]
fn a_redeemer_array_with_more_fields_than_it_has_is_refused_as_the_ledger_refuses_it() {
    // Pallas reads each by skipping the extra field; the ledger counts them (decodeRecordNamed, decodeListLenOf 2) and
    // refuses each. The list-form record of five was shown before, its fifth field read as nothing.
    for (name, redeemers) in [
        ("a key of three", "a183000000 82d87980820709"),
        ("an open key of three", "a19f000000ff 82d87980820709"),
        ("a value of three", "a1820000 83d8798082070900"),
        ("ex-units of three", "a1820000 82d8798083070900"),
        ("a record of five", "8185 0000d87980820709 00"),
    ] {
        let cbor = with_redeemers(&redeemers.replace(' ', ""));
        assert_eq!(pallas_redeemers(&cbor), 1, "{name}: Pallas reads it");
        let read = shown(&cbor);
        assert!(
            read.as_ref()
                .is_err_and(|e| e.starts_with("a redeemer isn't readable")),
            "{name}: {read:?}"
        );
    }
}

#[test]
fn an_input_written_open_length_is_read_whole_by_webassembly() {
    let inputs = format!("82{}{}", input("11", "00", true), input("22", "01", false));
    let detail = decode_tx("preprod", &tx(&[(0, &inputs), (1, OUTPUT), (2, FEE)], "a0")).unwrap();
    let read: Vec<String> = detail
        .inputs
        .iter()
        .map(|o| format!("{}#{}", o.tx_hash, o.index))
        .collect();
    assert_eq!(
        read,
        vec![
            format!("{}#0", "11".repeat(32)),
            format!("{}#1", "22".repeat(32))
        ]
    );
}
