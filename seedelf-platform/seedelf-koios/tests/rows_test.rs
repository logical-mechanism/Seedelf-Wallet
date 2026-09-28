//! Koios rows as the wallet and the CLI read them. Anyone can pay any address
//! an output with a deeply nested datum or native reference script, so one
//! such row must never make a whole response unreadable, and a register is
//! read from a datum's CBOR alone.

use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{
    InlineDatum, UtxoResponse, extract_bytes_with_logging, register_of_datum,
};
use serde_json::{Value, json};

/// A Koios `_extended` row, with its `inline_datum` and `reference_script` as JSON.
fn row(tx: u8, inline_datum: &str, reference_script: &str) -> String {
    format!(
        r#"{{"tx_hash":"{}","tx_index":0,"address":"addr_test1","value":"1500000","stake_address":null,"payment_cred":"{}","epoch_no":0,"block_height":0,"block_time":0,"datum_hash":null,"inline_datum":{inline_datum},"reference_script":{reference_script},"asset_list":[],"is_spent":false}}"#,
        hex::encode([tx; 32]),
        "00".repeat(28),
    )
}

/// A register's datum as Koios lists it: its CBOR, and constructor 0 as JSON.
fn register_datum(register: &Register) -> String {
    json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    })
    .to_string()
}

/// A Plutus list nested `levels` deep around 0: its CBOR, and its JSON in
/// Koios's detailed schema, two levels a level.
fn deep_datum(levels: usize) -> String {
    format!(
        r#"{{"bytes":"{}00","value":{}{{"int":0}}{}}}"#,
        "81".repeat(levels),
        r#"{"list":["#.repeat(levels),
        "]}".repeat(levels),
    )
}

/// A native script nested `levels` deep, as Koios lists a reference script:
/// `value` is db-sync's JSON of it, two levels a level.
fn deep_script(levels: usize) -> String {
    format!(
        r#"{{"hash":"{}","size":{},"type":"timelock","bytes":"{}","value":{}{{"type":"sig","keyHash":"{}"}}{}}}"#,
        "ab".repeat(28),
        3 * levels + 31,
        "820181".repeat(levels),
        r#"{"type":"all","scripts":["#.repeat(levels),
        "cd".repeat(28),
        "]}".repeat(levels),
    )
}

#[test]
fn one_deep_row_leaves_the_rest_of_a_response_readable() {
    let register = Register::create(random_scalar()).unwrap();
    for levels in [70, 1_000, 100_000] {
        let page = format!(
            "[{},{},{}]",
            row(1, &register_datum(&register), "null"),
            row(2, &deep_datum(levels), "null"),
            row(3, "null", &deep_script(levels)),
        );
        // What reqwest's `.json()` does with a page of `credential_utxos`.
        let rows: Vec<UtxoResponse> = serde_json::from_slice(page.as_bytes()).unwrap();
        assert_eq!(rows.len(), 3);

        // The register's row reads as before, its JSON too.
        assert_eq!(
            extract_bytes_with_logging(&rows[0].inline_datum),
            Some(register.clone())
        );
        assert_eq!(
            rows[0].inline_datum.as_ref().unwrap().value["constructor"],
            0
        );
        assert!(rows[0].reference_script.is_none());

        // The deep datum's JSON is dropped, and it's no register.
        let datum = rows[1].inline_datum.as_ref().unwrap();
        assert_eq!(datum.value, Value::Null);
        assert_eq!(datum.bytes.len(), 2 * levels + 2);
        assert_eq!(extract_bytes_with_logging(&rows[1].inline_datum), None);

        // The deep script still counts as a script, with all but its JSON.
        let script = rows[2].reference_script.as_ref().expect("a script");
        assert_eq!(script.hash.as_deref(), Some("ab".repeat(28).as_str()));
        assert_eq!(script.size, Some(3 * levels as u64 + 31));
        assert_eq!(script.kind.as_deref(), Some("timelock"));
        assert_eq!(script.bytes.as_ref().unwrap().len(), 6 * levels);

        // The rows go back out, to the extension, no deeper than they came in.
        let back: Vec<UtxoResponse> =
            serde_json::from_str(&serde_json::to_string(&rows).unwrap()).unwrap();
        assert_eq!(back[2].reference_script, rows[2].reference_script);
        assert_eq!(
            extract_bytes_with_logging(&back[0].inline_datum),
            Some(register.clone())
        );
    }
}

#[test]
fn a_reference_script_in_a_shape_koios_never_sends_still_counts_as_one() {
    let odd = format!("[{}]", row(1, "null", r#"{"hash":7,"size":"big"}"#));
    let rows: Vec<UtxoResponse> = serde_json::from_str(&odd).unwrap();
    assert!(rows[0].reference_script.is_some());

    // A row without the field, or without a datum's JSON, reads too.
    let bare = r#"[{"tx_hash":"00","tx_index":0,"address":"","value":"0","stake_address":null,"payment_cred":"","epoch_no":0,"block_height":0,"block_time":0,"datum_hash":null,"inline_datum":{"bytes":"00"},"asset_list":null,"is_spent":false}]"#;
    let rows: Vec<UtxoResponse> = serde_json::from_str(bare).unwrap();
    assert!(rows[0].reference_script.is_none());
    assert_eq!(rows[0].inline_datum.as_ref().unwrap().value, Value::Null);
}

#[test]
fn a_register_is_read_from_its_cbor_however_it_is_spelled() {
    let register = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    let g = hex::decode(&register.generator).unwrap();
    let u = hex::decode(&register.public_value).unwrap();
    let spellings: Vec<Vec<u8>> = vec![
        // As the wallet writes it: an indefinite list.
        register.to_vec().unwrap(),
        // A definite list.
        [&[0xd8, 0x79, 0x82, 0x58, 0x30][..], &g, &[0x58, 0x30], &u].concat(),
        // Constructor 0's general form, 102([0, fields]).
        [
            &[0xd8, 0x66, 0x82, 0x00, 0x82, 0x58, 0x30][..],
            &g,
            &[0x58, 0x30],
            &u,
        ]
        .concat(),
        // Longer heads than needed.
        [
            &[0xd9, 0x00, 0x79, 0x9f, 0x59, 0x00, 0x30][..],
            &g,
            &[0x5a, 0x00, 0x00, 0x00, 0x30],
            &u,
            &[0xff],
        ]
        .concat(),
        // Bytes in chunks.
        [
            &[0xd8, 0x79, 0x82, 0x5f, 0x50][..],
            &g[..16],
            &[0x58, 0x20],
            &g[16..],
            &[0xff, 0x58, 0x30],
            &u,
        ]
        .concat(),
    ];
    for cbor in spellings {
        assert_eq!(
            register_of_datum(&cbor),
            Some(register.clone()),
            "{}",
            hex::encode(&cbor)
        );
    }

    // Only the CBOR is read: a datum whose JSON Koios left out is a register.
    let datum = InlineDatum {
        bytes: hex::encode(register.to_vec().unwrap()),
        value: Value::Null,
    };
    assert_eq!(extract_bytes_with_logging(&Some(datum)), Some(register));
}

#[test]
fn nothing_but_constructor_0_with_two_48_byte_fields_is_a_register() {
    let register = Register::create(random_scalar()).unwrap();
    let g = hex::decode(&register.generator).unwrap();
    let u = hex::decode(&register.public_value).unwrap();
    let good = [&[0xd8, 0x79, 0x82, 0x58, 0x30][..], &g, &[0x58, 0x30], &u].concat();
    assert!(register_of_datum(&good).is_some());

    let constructor_1 = [&[0xd8, 0x7a, 0x82, 0x58, 0x30][..], &g, &[0x58, 0x30], &u].concat();
    let not_registers: Vec<Vec<u8>> = vec![
        constructor_1.clone(),
        // Constructor 1 in the general form.
        [
            &[0xd8, 0x66, 0x82, 0x01, 0x82, 0x58, 0x30][..],
            &g,
            &[0x58, 0x30],
            &u,
        ]
        .concat(),
        // Three fields, or one.
        [
            &[0xd8, 0x79, 0x83, 0x58, 0x30][..],
            &g,
            &[0x58, 0x30],
            &u,
            &[0x00],
        ]
        .concat(),
        [&[0xd8, 0x79, 0x81, 0x58, 0x30][..], &g].concat(),
        // A field of 47 bytes, or 49.
        [
            &[0xd8, 0x79, 0x82, 0x58, 0x2f][..],
            &g[..47],
            &[0x58, 0x30],
            &u,
        ]
        .concat(),
        [
            &[0xd8, 0x79, 0x82, 0x58, 0x31][..],
            &g,
            &[0x00, 0x58, 0x30],
            &u,
        ]
        .concat(),
        // An indefinite list with no break, or a third field before it.
        [&[0xd8, 0x79, 0x9f, 0x58, 0x30][..], &g, &[0x58, 0x30], &u].concat(),
        [
            &[0xd8, 0x79, 0x9f, 0x58, 0x30][..],
            &g,
            &[0x58, 0x30],
            &u,
            &[0x00, 0xff],
        ]
        .concat(),
        // Something after it, or cut short.
        [&good[..], &[0x00]].concat(),
        good[..good.len() - 1].to_vec(),
        // A list with no constructor, an integer, nothing.
        [&[0x82, 0x58, 0x30][..], &g, &[0x58, 0x30], &u].concat(),
        vec![0x00],
        vec![],
        // Nested far too deep to decode recursively.
        [
            vec![0xd8, 0x79, 0x82],
            vec![0x81; 100_000],
            vec![0x00, 0x00],
        ]
        .concat(),
    ];
    for cbor in not_registers {
        assert_eq!(register_of_datum(&cbor), None, "{}", hex::encode(&cbor));
    }

    // Whatever the JSON says: it's never read.
    let lying = InlineDatum {
        bytes: hex::encode(&constructor_1),
        value: json!({ "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]}),
    };
    assert_eq!(extract_bytes_with_logging(&Some(lying)), None);
}
