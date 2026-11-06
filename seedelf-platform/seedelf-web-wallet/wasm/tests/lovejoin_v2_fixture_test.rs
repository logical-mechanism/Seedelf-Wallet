//! Two v2 pools for the tests (web wallet chunk 44), never on chain: each
//! stands in for a v2 pool where a test needs one verified.
//!
//! - A token pool: Lovejoin's preprod token pool's launch
//!   (`fixtures/lovejoin-token-pool-preprod.json`) with its scripts derived on
//!   v2 and put at the holder, as every launch the wallet makes puts them. Its
//!   seed makes the same NFT policy on either set, so only the datum's
//!   `mix_box` and `mix_logic` and the two scripts change.
//! - The 5 ₳ ADA pool a return's spare ADA and its collateral go into from
//!   1.8.0 (the owner's call 4 of 2026-11-05): that launch's rows again, from
//!   another seed and a launch transaction of its own, so a test may read both
//!   pools, with an ADA pool's datum.
//!
//! `RECORD_LOVEJOIN_V2_FIXTURE=1` writes them; the tests hold the committed
//! files to what they would write.

use pallas_crypto::hash::Hasher;
use seedelf_core::lovejoin::templates::{self, Set};
use seedelf_core::lovejoin::{BoxValue, ReferenceDatum};
use serde_json::{Value, json};

const FROM: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-token-pool-preprod.json"
);
const FILE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-v2-token-pool-preprod.json"
);
const ADA_FILE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/lovejoin-v2-ada-pool-preprod.json"
);

/// What every box of the ADA pool holds: the 5 ₳ a session's collateral is.
const ADA_BOX: u64 = 5_000_000;

/// Where `reference`'s row sits on chain, which the launch's script rows
/// take too: one transaction's outputs are in one block. They kept the
/// blocks of the rows they're made from, so a launch's three outputs sat in
/// three blocks (1.8.0's release review, tests-e2e#6).
fn in_block(reference: &Value) -> [(&'static str, Value); 3] {
    ["block_height", "block_time", "epoch_no"].map(|key| (key, reference[key].clone()))
}

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
    let block = in_block(reference);
    let cred = hex::encode(templates::REFERENCE_HOLDER_HASH);
    let scripts = pool["scripts"].as_array_mut().unwrap();
    for (i, (row, script)) in scripts
        .iter_mut()
        .zip([&v2.mix_box, &v2.mix_logic])
        .enumerate()
    {
        for (key, value) in &block {
            row[*key] = value.clone();
        }
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

/// The ADA pool: the launch's rows, at its seed's index 3 (the token pool's is
/// 2) and in a launch transaction of its own, with an ADA pool's datum, its
/// NFT, and its two scripts at the holder.
fn ada_fixture() -> Value {
    let mut pool: Value = serde_json::from_str(&std::fs::read_to_string(FROM).unwrap()).unwrap();
    let seed_tx: [u8; 32] = hex::decode(pool["seed"]["txHash"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let v2 = templates::derive_in(Set::V2, &seed_tx, 3).unwrap();
    pool["seed"]["txIndex"] = json!(3);
    let tx = hex::encode(Hasher::<256>::hash(
        b"web wallet chunk 44: a v2 ADA pool of 5 ADA a box",
    ));
    let reference = &mut pool["reference"];
    let max_fee = reference["inline_datum"]["value"]["fields"][4]["int"]
        .as_u64()
        .unwrap();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: ADA_BOX,
            token: None,
        },
        max_fee,
        mix_box_hash: v2.mix_box.hash,
        mix_logic_hash: v2.mix_logic.hash,
        fee_hash: v2.fee_contract.hash,
    }
    .encode();
    let bytes = |b: &[u8]| json!({ "bytes": hex::encode(b) });
    reference["inline_datum"] = json!({
        "bytes": hex::encode(&datum),
        "value": {
            "constructor": 0,
            "fields": [
                { "int": ADA_BOX },
                bytes(&[]),
                bytes(&[]),
                { "int": 0 },
                { "int": max_fee },
                bytes(&v2.mix_box.hash),
                bytes(&v2.mix_logic.hash),
                bytes(&v2.fee_contract.hash),
            ],
        },
    });
    reference["datum_hash"] = json!(hex::encode(Hasher::<256>::hash(&datum).as_ref()));
    reference["tx_hash"] = json!(tx);
    // Its NFT: P's `lovejoin`, which a row the wallet makes up names with no fingerprint.
    reference["asset_list"][0]["policy_id"] = json!(hex::encode(v2.policy()));
    reference["asset_list"][0]["fingerprint"] = json!("");
    let (holder, tx) = (reference["address"].clone(), reference["tx_hash"].clone());
    let block = in_block(reference);
    let cred = hex::encode(templates::REFERENCE_HOLDER_HASH);
    let scripts = pool["scripts"].as_array_mut().unwrap();
    for (i, (row, script)) in scripts
        .iter_mut()
        .zip([&v2.mix_box, &v2.mix_logic])
        .enumerate()
    {
        for (key, value) in &block {
            row[*key] = value.clone();
        }
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
        "A v2 ADA pool of 5 ₳ a box, never on chain (web wallet chunk 44): the pool a return's spare ADA and its collateral go into from 1.8.0. Lovejoin's preprod token-pool launch's rows (lovejoin-token-pool-preprod.json) from another seed index and a launch transaction of their own, an ADA pool's datum, and its scripts derived on v2 (Lovejoin 29573c5) at the holder. Written by lovejoin_v2_fixture_test.rs (RECORD_LOVEJOIN_V2_FIXTURE=1); never edit by hand."
    );
    pool
}

/// Writes `pool` to `file` when asked, and holds the committed file to it.
fn held_to(pool: &Value, file: &str) {
    if std::env::var_os("RECORD_LOVEJOIN_V2_FIXTURE").is_some() {
        std::fs::write(file, serde_json::to_string_pretty(pool).unwrap() + "\n").unwrap();
    }
    let committed: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
    assert_eq!(&committed, pool);
}

/// The worker's WebAssembly's view of `pool`, verified.
fn view_of(pool: &Value) -> seedelf_wasm::lovejoin::PoolView {
    let pool_ref: seedelf_wasm::lovejoin::PoolRef = serde_json::from_value(json!({
        "reference": pool["reference"],
        "seed": pool["seed"],
        "scripts": pool["scripts"],
    }))
    .unwrap();
    seedelf_wasm::lovejoin::verify_pool(seedelf_wasm::lovejoin::VerifyPoolRequest {
        network: "preprod".into(),
        pool: pool_ref,
    })
    .unwrap()
}

#[test]
fn the_v2_pool_fixture_is_its_derivation() {
    held_to(&fixture(), FILE);
}

#[test]
fn the_v2_ada_pool_fixture_is_its_derivation() {
    held_to(&ada_fixture(), ADA_FILE);
}

/// Each committed pool's launch, its reference and its two scripts, sits in
/// one block, as one transaction's outputs do: a test that scans the holder
/// from these rows starts from a launch that could be (1.8.0's release
/// review, tests-e2e#6).
#[test]
fn each_launch_is_in_one_block() {
    for file in [FILE, ADA_FILE] {
        let pool: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        let reference = &pool["reference"];
        for row in pool["scripts"].as_array().unwrap() {
            assert_eq!(row["tx_hash"], reference["tx_hash"], "{file}");
            for key in ["block_height", "block_time", "epoch_no"] {
                assert_eq!(row[key], reference[key], "{file} {key}");
            }
        }
    }
}

/// The worker's WebAssembly verifies the ADA pool as v2's, of 5 ₳ a box and no token, its scripts read from the
/// holder, and never as the token pool.
#[test]
fn the_v2_ada_pool_fixture_verifies_as_v2() {
    let pool = ada_fixture();
    let view = view_of(&pool);
    let seed_tx: [u8; 32] = hex::decode(pool["seed"]["txHash"].as_str().unwrap())
        .unwrap()
        .try_into()
        .unwrap();
    let v2 = templates::derive_in(Set::V2, &seed_tx, 3).unwrap();
    assert_eq!(view.version, "v2");
    assert_eq!(view.id, hex::encode(v2.policy()));
    assert_eq!(view.box_lovelace, ADA_BOX.to_string());
    assert!(view.token.is_none());
    assert_eq!(view.mix_box_hash, hex::encode(v2.mix_box.hash));
    assert_eq!(view.scripts_inline, 0);
    assert_ne!(view.id, view_of(&fixture()).id);
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
