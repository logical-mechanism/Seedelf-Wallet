//! Local script evaluation (`seedelf_core::eval`) against transactions that
//! are on preprod: every budget must equal the one the chain accepted.

use hex_literal::hex;
use pallas_addresses::Address;
use seedelf_core::build::Budgets;
use seedelf_core::eval::{self, Resolved};
use seedelf_koios::koios::UtxoResponse;
use serde_json::{Value, json};

fn cases() -> Vec<Value> {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/eval-preprod.json")).expect("fixture");
    doc["cases"].as_array().expect("cases").clone()
}

fn resolved(case: &Value) -> Vec<Resolved> {
    case["utxos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| Resolved {
            tx_hash: hex::decode(u["tx_hash"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap(),
            index: u["index"].as_u64().unwrap(),
            output: hex::decode(u["output"].as_str().unwrap()).unwrap(),
        })
        .collect()
}

fn cost_model(case: &Value) -> Vec<i64> {
    case["cost_model_v3"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_i64().unwrap())
        .collect()
}

#[test]
fn budgets_match_the_chain_exactly() {
    for case in cases() {
        let name = case["name"].as_str().unwrap();
        let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
        let answer = eval::evaluate(&tx, &resolved(&case), &cost_model(&case), true).unwrap();
        let rows = answer["result"]
            .as_array()
            .unwrap_or_else(|| panic!("{name}: {answer}"));
        let mut got: Vec<String> = rows
            .iter()
            .map(|r| format!("{},{}", r["budget"]["cpu"], r["budget"]["memory"]))
            .collect();
        got.sort();
        let declared: Vec<String> = case["declared"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d.as_str().unwrap().to_string())
            .collect();
        assert_eq!(got, declared, "{name}");
        // The answer reads as Ogmios's does, a script withdrawal included.
        Budgets::from_ogmios(&answer).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
}

#[test]
fn lovejoin_withdraws_are_measured_as_withdrawals() {
    let case = cases()
        .into_iter()
        .find(|c| {
            c["name"]
                .as_str()
                .unwrap()
                .starts_with("lovejoin mix N=3 wallet")
        })
        .unwrap();
    let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let answer = eval::evaluate(&tx, &resolved(&case), &cost_model(&case), true).unwrap();
    let budgets = Budgets::from_ogmios(&answer).unwrap();
    let mix = budgets.withdraw(0).expect("mix_logic's withdraw-zero");
    assert!(
        mix.steps > 5_000_000_000,
        "a 3-box mix costs billions of steps"
    );
}

#[test]
fn a_missing_utxo_is_named() {
    let case = &cases()[0];
    let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let mut known = resolved(case);
    let gone = known.remove(0);
    let err = eval::evaluate(&tx, &known, &cost_model(case), true)
        .unwrap_err()
        .to_string();
    assert!(err.contains(&hex::encode(gone.tx_hash)), "{err}");
}

#[test]
fn a_failing_script_reads_as_ogmios_failure() {
    // The withdraw proves the owner knows each box's key. Change a byte of a
    // box's datum and the proof no longer verifies.
    let case = cases()
        .into_iter()
        .find(|c| c["name"].as_str().unwrap().starts_with("lovejoin withdraw"))
        .unwrap();
    let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let mut known = resolved(&case);
    let mix_box = hex::decode("67ffe4ed7f0ccd0a3e3069fddc26d9bccde3fe63d3d58c5e84f7ecc5").unwrap();
    let boxed = known
        .iter_mut()
        .find(|r| find(&r.output, &mix_box).is_some())
        .expect("a box among the inputs");
    let last = boxed.output.len() - 1;
    boxed.output[last] ^= 0x01;
    let answer = eval::evaluate(&tx, &known, &cost_model(&case), true).unwrap();
    assert!(answer.get("error").is_some(), "{answer}");
    let err = Budgets::from_ogmios(&answer).unwrap_err().to_string();
    assert!(err.contains("withdraw 0"), "{err}");
    assert!(
        err.starts_with("A script refused"),
        "not the Seedelf contract: {err}"
    );
}

#[test]
fn the_bundled_references_are_the_ones_on_chain() {
    let case = cases()
        .into_iter()
        .find(|c| c["name"].as_str().unwrap().starts_with("seedelf spend"))
        .unwrap();
    let recorded = resolved(&case);
    for reference in eval::seedelf_references(true).unwrap() {
        if let Some(r) = recorded
            .iter()
            .find(|r| r.tx_hash == reference.tx_hash && r.index == reference.index)
        {
            assert_eq!(r.output, reference.output);
        }
    }
    // The Seedelf spend evaluates with the bundled wallet reference in place
    // of the recorded one.
    let mut known: Vec<Resolved> = recorded
        .into_iter()
        .filter(|r| {
            !eval::seedelf_references(true)
                .unwrap()
                .iter()
                .any(|b| b.tx_hash == r.tx_hash)
        })
        .collect();
    known.extend(eval::seedelf_references(true).unwrap());
    let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let answer = eval::evaluate(&tx, &known, &cost_model(&case), true).unwrap();
    assert_eq!(answer["result"].as_array().unwrap().len(), 6);
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[test]
fn the_networks_measure_is_checked_against_what_a_transaction_declares() {
    for case in cases() {
        let name = case["name"].as_str().unwrap();
        let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
        // Recorded transactions declare exactly what they use.
        let answer = eval::evaluate(&tx, &resolved(&case), &cost_model(&case), true).unwrap();
        assert_eq!(
            eval::declared_covers(&tx, &answer).unwrap(),
            Ok(()),
            "{name}"
        );
        // A network that measures more, or refuses a script, isn't covered.
        let mut more = answer.clone();
        let first = &mut more["result"][0]["budget"]["cpu"];
        *first = serde_json::json!(first.as_u64().unwrap() + 1);
        assert!(
            eval::declared_covers(&tx, &more).unwrap().is_err(),
            "{name}"
        );
        let refused = serde_json::json!({ "error": { "code": 3010, "message": "Some scripts of the transaction terminated with error(s).", "data": [] } });
        assert!(
            eval::declared_covers(&tx, &refused).unwrap().is_err(),
            "{name}"
        );
    }
}

#[test]
fn outputs_go_to_ogmios_as_its_utxos() {
    let case = cases()
        .into_iter()
        .find(|c| {
            c["name"]
                .as_str()
                .unwrap()
                .starts_with("lovejoin mix N=3 wallet")
        })
        .unwrap();
    let tx = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let utxos = eval::ogmios_utxos(&tx).unwrap();
    let rows = utxos.as_array().unwrap();
    let decoded = pallas_traverse::MultiEraTx::decode(&tx).unwrap();
    assert_eq!(rows.len(), decoded.outputs().len());
    // A box: 10 ₳ at mix_box, its datum inline.
    let first = &rows[0];
    assert_eq!(first["transaction"]["id"], hex::encode(decoded.hash()));
    assert_eq!(first["index"], 0);
    assert_eq!(first["value"]["ada"]["lovelace"], 10_000_000);
    assert!(
        first["address"]
            .as_str()
            .unwrap()
            .starts_with("addr_test1w")
    );
    assert!(first["datum"].as_str().unwrap().starts_with("d879"));
}

/// A key address's UTxO listing one token once for each of `quantities`. The
/// chain lists a token once an output; a data layer that lies, or a bug in
/// one, could list it twice, as a Lovejoin pool's reference.
fn row_naming_a_token(quantities: &[&str]) -> UtxoResponse {
    let address = Address::from_bytes(&[&[0x60][..], &[7; 28]].concat()).unwrap();
    let asset_list: Vec<Value> = quantities
        .iter()
        .map(|quantity| {
            json!({
                "decimals": 0, "quantity": quantity, "fingerprint": "",
                "policy_id": hex::encode([0xc5; 28]), "asset_name": hex::encode("lovejoin"),
            })
        })
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([7; 32]), "tx_index": 0,
        "address": address.to_bech32().unwrap(),
        "value": "1719690", "stake_address": null, "payment_cred": "", "epoch_no": 0,
        "block_height": 0, "block_time": 0, "datum_hash": null, "inline_datum": null,
        "reference_script": null, "asset_list": asset_list, "is_spent": false,
    }))
    .unwrap()
}

#[test]
fn a_row_naming_a_token_past_what_an_output_holds_is_refused_in_words() {
    // 1.7.0's release review, x-overflow#0: since #332 the store's module
    // checks core's overflow, and this sum trapped there, which locked the
    // wallet at every read of a pool list naming such a pool. Before #332 it
    // wrapped to 1, so the NFT named twice read as one, and the pool verified.
    let row = row_naming_a_token(&[&u64::MAX.to_string(), "2"]);
    let err = eval::resolve_row(&row).unwrap_err().to_string();
    assert_eq!(
        err,
        format!(
            "UTxO {}#0 holds more of a token than one output can",
            row.tx_hash
        )
    );
    // A pool's script rows go through the same reading.
    let script = hex!("4e4d01000033222220051200120011");
    assert_eq!(
        eval::resolve_reference(&row, 3, &script)
            .unwrap_err()
            .to_string(),
        err
    );
    // Within what a u64 holds, the two are one amount, as before.
    let most = row_naming_a_token(&[&(u64::MAX - 2).to_string(), "2"]);
    let output = eval::resolve_row(&most).unwrap().output;
    assert!(find(&output, &hex!("1b ffffffffffffffff")).is_some());
}
