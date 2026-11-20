//! l6still#1, case B end to end, through the function the worker's Send calls (`buildTransferParts`): K, a plain way
//! back of 4.71 ₳; T, a token pool's way back of 6.0 ₳ and its token; 21 payments received of 5 ₳. 108 ₳ to one
//! Seedelf went as one transaction of T and the 21 (550a368f); it must still go as one. 54 ₳ to each of two Seedelfs
//! must build too.

use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_koios::koios::{Asset as KAsset, UtxoResponse};
use seedelf_wasm::api::{self, ClassIn, Classes, SeedelfPayment, TransferRequest};
use serde_json::Value;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

fn fixture(path: &str) -> Value {
    let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn params() -> Value {
    fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
}

/// One of the phrase's own contract UTxOs, as Koios returns it: every UTxO below is a copy, at its register.
fn base() -> UtxoResponse {
    let owned: Vec<UtxoResponse> = serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
    )
    .unwrap();
    owned[0].clone()
}

fn utxo(n: u64, lovelace: u64, token: bool) -> UtxoResponse {
    UtxoResponse {
        tx_hash: format!("{n:064x}"),
        tx_index: 0,
        value: lovelace.to_string(),
        asset_list: Some(if token {
            vec![KAsset {
                decimals: 0,
                quantity: "1".into(),
                policy_id: TOKEN_POLICY.into(),
                asset_name: hex::encode("pooltoken"),
                fingerprint: String::new(),
            }]
        } else {
            vec![]
        }),
        ..base()
    }
}

fn at(u: &UtxoResponse) -> String {
    format!("{}#{}", u.tx_hash, u.tx_index)
}

#[test]
fn a_token_pools_way_back_beside_payments_at_the_input_limit_goes_as_one_transaction() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let recorded = fixture("../extension/tests/fixtures/transfer-preprod.json");
    let k = utxo(0x61, 4_710_000, false);
    let t = utxo(0x70, 6_000_000, true);
    let received: Vec<UtxoResponse> = (0..21u64).map(|i| utxo(0x100 + i, 5_000_000, false)).collect();
    let mut utxos = vec![k.clone(), t.clone()];
    utxos.extend(received.iter().cloned());
    let mut wrong = Vec::new();
    for t_origin in ["mixed", "lovejoin"] {
        let mut classes: Classes = Classes::new();
        classes.insert(at(&k), ClassIn { id: format!("box:{}", k.tx_hash), origin: "lovejoin".into() });
        classes.insert(at(&t), ClassIn { id: format!("box:{}", t.tx_hash), origin: t_origin.into() });
        for r in &received {
            classes.insert(at(r), ClassIn { id: format!("received:{}", r.tx_hash), origin: "received".into() });
        }
        let payment = |lovelace: u64| SeedelfPayment {
            to: recorded["to"].as_str().unwrap().into(),
            recipient: serde_json::from_value(recorded["recipient"].clone()).unwrap(),
            lovelace: Some(lovelace.to_string()),
            tokens: vec![],
        };
        for (name, payments) in [
            ("108 ₳ to one Seedelf", vec![payment(108_000_000)]),
            ("54 ₳ to each of two Seedelfs", vec![payment(54_000_000), payment(54_000_000)]),
        ] {
            let request = TransferRequest {
                network: "preprod".into(),
                params: params(),
                utxos: utxos.clone(),
                payments,
                classes: classes.clone(),
                carry: false,
                most: false,
                seed: None,
                evaluation: None,
            };
            let line = match api::build_transfer_parts(sk, request) {
                Ok(parts) if parts.len() == 1 => {
                    println!("{name}, T {t_origin}: one transaction of {} inputs", parts[0].inputs.len());
                    continue;
                }
                Ok(parts) => format!(
                    "{name}, T {t_origin}: sent in {} parts, of {:?} inputs",
                    parts.len(),
                    parts.iter().map(|p| p.inputs.len()).collect::<Vec<_>>()
                ),
                Err(e) => format!("{name}, T {t_origin}: refused: {e}"),
            };
            println!("{line}");
            wrong.push(line);
        }
    }
    assert!(
        wrong.is_empty(),
        "what went as one transaction now goes in parts, or is refused:\n{}",
        wrong.join("\n")
    );
}
