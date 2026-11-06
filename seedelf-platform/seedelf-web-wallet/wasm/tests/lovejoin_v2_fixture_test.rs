//! A v2 token pool for the tests (web wallet chunk 44): Lovejoin's preprod
//! token pool's launch (`fixtures/lovejoin-token-pool-preprod.json`) with its
//! scripts derived on v2 and put at the holder, as every launch the wallet
//! makes puts them. Its seed makes the same NFT policy on either set, so only
//! the datum's `mix_box` and `mix_logic` and the two scripts change. Never on
//! chain: it stands in for a v2 pool where a test needs one verified.
//!
//! `RECORD_LOVEJOIN_V2_FIXTURE=1` writes it; the test holds the committed file
//! to what it would write.

use pallas_crypto::hash::Hasher;
use seedelf_core::lovejoin::templates::{self, Set};
use serde_json::{Value, json};

const FROM: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-token-pool-preprod.json"
);
const FILE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-v2-token-pool-preprod.json"
);

fn fixture() -> Value {
    let mut pool: Value = serde_json::from_str(&std::fs::read_to_string(FROM).unwrap()).unwrap();
    let seed_tx: [u8; 32] = hex::decode(pool["seed"]["txHash"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let seed_index = pool["seed"]["txIndex"].as_u64().unwrap();
    let v1 = templates::derive_in(Set::V1, &seed_tx, seed_index).unwrap();
    let v2 = templates::derive_in(Set::V2, &seed_tx, seed_index).unwrap();
    assert_eq!(v1.policy(), v2.policy());

    // The datum names v2's M and L where it named 8131b1d's.
    let swap = |text: &str| {
        text.replace(&hex::encode(v1.mix_box.hash), &hex::encode(v2.mix_box.hash))
            .replace(
                &hex::encode(v1.mix_logic.hash),
                &hex::encode(v2.mix_logic.hash),
            )
    };
    let reference = &mut pool["reference"];
    let datum = swap(reference["inline_datum"]["bytes"].as_str().unwrap());
    let fields = reference["inline_datum"]["value"]["fields"]
        .as_array_mut()
        .unwrap();
    for field in [5, 6] {
        let named = swap(fields[field]["bytes"].as_str().unwrap());
        fields[field]["bytes"] = json!(named);
    }
    reference["datum_hash"] = json!(hex::encode(
        Hasher::<256>::hash(&hex::decode(&datum).unwrap()).as_ref()
    ));
    reference["inline_datum"]["bytes"] = json!(datum);

    // Its two scripts at the holder, in the launch's own transaction, as the wallet's launches put them.
    let (holder, tx) = (reference["address"].clone(), reference["tx_hash"].clone());
    let cred = hex::encode(templates::REFERENCE_HOLDER_HASH);
    let scripts = pool["scripts"].as_array_mut().unwrap();
    for (i, (row, script)) in scripts
        .iter_mut()
        .zip([&v2.mix_box, &v2.mix_logic])
        .enumerate()
    {
        row["tx_hash"] = tx.clone();
        row["tx_index"] = json!(i + 1);
        row["address"] = holder.clone();
        row["payment_cred"] = json!(cred);
        row["stake_address"] = Value::Null;
        row["reference_script"]["hash"] = json!(hex::encode(script.hash));
        row["reference_script"]["bytes"] = json!(hex::encode(&script.cbor));
        row["reference_script"]["size"] = json!(script.cbor.len());
    }
    pool["about"] = json!(
        "A v2 token pool, never on chain (web wallet chunk 44): Lovejoin's preprod token-pool launch (lovejoin-token-pool-preprod.json) with its scripts derived on v2 (Lovejoin 29573c5) and put at the holder in its launch's transaction. The seed makes the same NFT policy on either set. Written by lovejoin_v2_fixture_test.rs (RECORD_LOVEJOIN_V2_FIXTURE=1); never edit by hand."
    );
    pool
}

#[test]
fn the_v2_pool_fixture_is_its_derivation() {
    let pool = fixture();
    if std::env::var_os("RECORD_LOVEJOIN_V2_FIXTURE").is_some() {
        std::fs::write(FILE, serde_json::to_string_pretty(&pool).unwrap() + "\n").unwrap();
    }
    let committed: Value = serde_json::from_str(&std::fs::read_to_string(FILE).unwrap()).unwrap();
    assert_eq!(committed, pool);
}

/// The worker's WebAssembly verifies it as a v2 pool, both scripts read from the holder.
#[test]
fn the_v2_pool_fixture_verifies_as_v2() {
    let pool = fixture();
    let pool_ref: seedelf_wasm::lovejoin::PoolRef = serde_json::from_value(json!({
        "reference": pool["reference"],
        "seed": pool["seed"],
        "scripts": pool["scripts"],
    }))
    .unwrap();
    let view = seedelf_wasm::lovejoin::verify_pool(seedelf_wasm::lovejoin::VerifyPoolRequest {
        network: "preprod".into(),
        pool: pool_ref,
    })
    .unwrap();
    let (tx, index) = (
        hex::decode(pool["seed"]["txHash"].as_str().unwrap()).unwrap(),
        pool["seed"]["txIndex"].as_u64().unwrap(),
    );
    let v2 = templates::derive_in(Set::V2, &tx.try_into().unwrap(), index).unwrap();
    assert_eq!(view.version, "v2");
    assert_eq!(view.id, hex::encode(v2.policy()));
    assert_eq!(view.mix_box_hash, hex::encode(v2.mix_box.hash));
    assert_eq!(view.mix_logic_hash, hex::encode(v2.mix_logic.hash));
    assert_eq!(view.scripts_inline, 0);
}
