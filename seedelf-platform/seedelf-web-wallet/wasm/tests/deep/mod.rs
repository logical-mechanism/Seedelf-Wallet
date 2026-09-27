//! A stranger's UTxO as Koios lists it, with a deeply nested datum or native
//! reference script: anyone can pay any address one, for about 1.5 ₳. Kept as
//! JSON text and spliced into a request, since a `serde_json::Value` that deep
//! can't be built or dropped without recursing.

#![allow(dead_code)]

/// A Koios `_extended` row at `address`, ADA only, with `inline_datum` and
/// `reference_script` given as JSON.
pub fn row(
    tx: u8,
    address: &str,
    payment_cred: &str,
    lovelace: u64,
    inline_datum: &str,
    reference_script: &str,
) -> String {
    format!(
        r#"{{"tx_hash":"{}","tx_index":0,"address":"{address}","value":"{lovelace}","stake_address":null,"payment_cred":"{payment_cred}","epoch_no":0,"block_height":0,"block_time":0,"datum_hash":null,"inline_datum":{inline_datum},"reference_script":{reference_script},"asset_list":[],"is_spent":false}}"#,
        hex::encode([tx; 32]),
    )
}

/// A Plutus list nested `levels` deep around 0: its CBOR, and its JSON in
/// Koios's detailed schema, two levels a level.
pub fn datum(levels: usize) -> String {
    format!(
        r#"{{"bytes":"{}00","value":{}{{"int":0}}{}}}"#,
        "81".repeat(levels),
        r#"{"list":["#.repeat(levels),
        "]}".repeat(levels),
    )
}

/// A native script nested `levels` deep, as Koios lists a reference script:
/// `value` is db-sync's JSON of it, two levels a level.
pub fn script(levels: usize) -> String {
    format!(
        r#"{{"hash":"{}","size":{},"type":"timelock","bytes":"{}00","value":{}{{"type":"sig","keyHash":"{}"}}{}}}"#,
        "ab".repeat(28),
        3 * levels + 1,
        "820181".repeat(levels),
        r#"{"type":"all","scripts":["#.repeat(levels),
        "cd".repeat(28),
        "]}".repeat(levels),
    )
}

/// `request` as JSON text, with each `"<name>"` placeholder string replaced
/// by the row given for it.
pub fn splice(request: &serde_json::Value, rows: &[(&str, &str)]) -> String {
    let mut text = request.to_string();
    for (name, row) in rows {
        let placeholder = format!("\"{name}\"");
        assert!(text.contains(&placeholder), "no {name} in the request");
        text = text.replace(&placeholder, row);
    }
    text
}
