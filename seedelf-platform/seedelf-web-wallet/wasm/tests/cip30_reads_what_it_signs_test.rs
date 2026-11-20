//! Chunk 51, sign#1. The sign window's metadata check, its warning for a register already on chain, and the note of
//! what a site's transaction pays into the user's own Seedelf were read from a second decode, Transaction details'
//! (`decode_tx`), which the worker ran beside the read WebAssembly signs from (`inspect`). Where that second decode
//! failed, all three went silent, and a site could make it fail at will: one byte after the transaction's end, which
//! `inspect` never looked for (Pallas reads the first item and stops), or a redeemer written in a way only Pallas read
//! (sign#2). Now `inspect` refuses bytes after the end, as Transaction details, `attach_witnesses` and the node do, in
//! one shared check, and it gives the readings itself, from the bytes it signs: whether the metadata is what the body
//! commits to (`metadataMismatch`), and each payment's output index and register (`paid[].txIndex`, `.register`).
//! Their JSON names are what the worker reads (rpc.ts `DappTxSummary`).

use pallas_addresses::Address;
use pallas_crypto::hash::Hasher;
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_wasm::cip30::{self, KeyPath, KoiosRow, TxRequest};
use seedelf_wasm::decode::decode_tx;
use serde_json::Value;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";
/// A register datum: constructor 0 with the G1 generator and a test vector's public value (`cip30_test.rs`'s).
const REGISTER_DATUM: &str = "d8799f583097f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb583082dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475ff";
const PREFIX: &str = "The wallet can't read this transaction";

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

fn ours(role: Role, index: u32) -> Address {
    account().base_address(true, role, index).unwrap()
}

/// Someone else's key address: the same phrase's account 1.
fn theirs() -> Address {
    CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap()
}

/// The account's 10 ₳ at `0/0`, which every transaction here spends.
fn funds() -> KoiosRow {
    serde_json::from_value(serde_json::json!({
        "tx_hash": TX_A,
        "tx_index": 0,
        "address": ours(Role::Receive, 0).to_bech32().unwrap(),
        "value": "10000000",
        "asset_list": [],
    }))
    .unwrap()
}

fn request(tx: &str) -> TxRequest {
    TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.into(),
        keys: (0..3)
            .flat_map(|index| [KeyPath { role: 0, index }, KeyPath { role: 1, index }])
            .collect(),
        inputs: vec![funds()],
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    }
}

/// A CBOR byte string's head and bytes, for fewer than 65,536 bytes.
fn bytes_of(hex: &str) -> String {
    let n = hex.len() / 2;
    let head = match n {
        0..24 => format!("{:02x}", 0x40 + n),
        24..256 => format!("58{n:02x}"),
        _ => format!("59{n:04x}"),
    };
    format!("{head}{hex}")
}

/// A CBOR text string of fewer than 24 bytes.
fn text_of(s: &str) -> String {
    format!("{:02x}{}", 0x60 + s.len(), hex::encode(s))
}

/// CIP-20's message: `{674: {"msg": [line]}}`.
fn note(line: &str) -> String {
    format!("a11902a2a1{}81{}", text_of("msg"), text_of(line))
}

/// `[body, {}, true, aux]`: the body spends TX_A#0 and has `outputs` (each written whole), a 0.2 ₳ fee and, with
/// `committed`, the hash of that metadata (key 7). It carries `carried` as its auxiliary data, null without.
fn tx(outputs: &[String], committed: Option<&str>, carried: Option<&str>) -> String {
    tx_with(outputs, committed, carried, "a0")
}

/// The same with `witnesses` as its witness set, which isn't signed: the site's to write, and to rewrite once it has
/// the signature.
fn tx_with(
    outputs: &[String],
    committed: Option<&str>,
    carried: Option<&str>,
    witnesses: &str,
) -> String {
    let fields = format!(
        "0081825820{TX_A}0001{:02x}{}021a00030d40",
        0x80 + outputs.len(),
        outputs.concat()
    );
    let body = match committed {
        Some(metadata) => {
            let hash = Hasher::<256>::hash(&hex::decode(metadata).unwrap());
            format!("a4{fields}075820{}", hex::encode(hash))
        }
        None => format!("a3{fields}"),
    };
    format!("84{body}{witnesses}f5{}", carried.unwrap_or("f6"))
}

/// `[address, coin]`, a coin under 2^32.
fn legacy(address: &Address, lovelace: u32) -> String {
    format!("82{}1a{lovelace:08x}", bytes_of(&address.to_hex()))
}

/// Seedelf Wallet's contract on preprod.
fn contract() -> Address {
    wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    )
}

/// `{0: the contract, 1: coin, 2: [1, #6.24(datum)]}`, and a reference script (key 3, a Plutus V3 script of four
/// bytes) with `script`.
fn to_contract(datum: &str, script: bool) -> String {
    let fields = format!(
        "00{}011a01312d00028201d818{}",
        bytes_of(&contract().to_hex()),
        bytes_of(datum)
    );
    if script {
        format!("a4{fields}03d8184782034401020304")
    } else {
        format!("a3{fields}")
    }
}

fn summary(tx: &str) -> Value {
    serde_json::to_value(cip30::inspect_tx(&account(), &request(tx)).unwrap()).unwrap()
}

#[test]
fn bytes_after_the_transactions_end_are_refused_by_every_reader_as_the_node_refuses_them() {
    let whole = tx(&[legacy(&theirs(), 4_000_000)], None, None);
    // Read and signed whole.
    assert!(cip30::inspect_tx(&account(), &request(&whole)).is_ok());
    assert!(cip30::sign_tx(&account(), &request(&whole)).is_ok());
    assert!(decode_tx("preprod", &whole).is_ok());

    for trailing in ["00", "f6", "84a0a0f5f6"] {
        let appended = format!("{whole}{trailing}");
        let refused = |read: Result<(), String>, who: &str| {
            assert!(
                read.as_ref().is_err_and(|e| e.starts_with(PREFIX)),
                "{who} of the transaction with {trailing} after it: {read:?}"
            )
        };
        refused(
            cip30::inspect_tx(&account(), &request(&appended))
                .map(drop)
                .map_err(|e| e.to_string()),
            "the sign window's read",
        );
        refused(
            cip30::sign_tx(&account(), &request(&appended))
                .map(drop)
                .map_err(|e| e.to_string()),
            "the signature",
        );
        refused(
            decode_tx("preprod", &appended)
                .map(drop)
                .map_err(|e| e.to_string()),
            "Transaction details",
        );
        refused(
            cip30::attach_witnesses(&appended, "a10080")
                .map(drop)
                .map_err(|e| e.to_string()),
            "adding witnesses",
        );
    }
}

#[test]
fn the_summary_says_when_the_metadata_isnt_what_the_body_commits_to() {
    let pays = [legacy(&theirs(), 4_000_000)];
    let (shown, committed) = (note("Thanks for order 77"), note("I agree to pay 500 ADA"));
    for (name, built) in [
        (
            "shows one note while its body commits to another",
            tx(&pays, Some(&committed), Some(&shown)),
        ),
        (
            "commits to metadata it doesn't carry",
            tx(&pays, Some(&committed), None),
        ),
        (
            "carries a note its body commits to nothing of",
            tx(&pays, None, Some(&shown)),
        ),
    ] {
        assert_eq!(summary(&built)["metadataMismatch"], true, "{name}");
    }
    for (name, built) in [
        (
            "commits to just what it carries",
            tx(&pays, Some(&shown), Some(&shown)),
        ),
        ("neither commits to nor carries any", tx(&pays, None, None)),
    ] {
        // Left out, as the worker's `metadataMismatch?: true` reads it.
        assert!(summary(&built).get("metadataMismatch").is_none(), "{name}");
    }
}

#[test]
fn each_payment_says_which_output_it_is_and_a_seedelf_payments_register() {
    let built = tx(
        &[
            legacy(&ours(Role::Change, 0), 1_000_000),
            to_contract(REGISTER_DATUM, false),
            to_contract(REGISTER_DATUM, true),
            to_contract("d87980", false),
        ],
        None,
        None,
    );
    let read = summary(&built);
    let (generator, public_value) = (&REGISTER_DATUM[10..106], &REGISTER_DATUM[110..206]);
    let register = serde_json::json!({ "generator": generator, "publicValue": public_value });
    let paid: Vec<(Value, Value, Value)> = read["paid"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["txIndex"].clone(),
                p["seedelf"].clone(),
                p["register"].clone(),
            )
        })
        .collect();
    assert_eq!(
        paid,
        vec![
            (1.into(), "register".into(), register.clone()),
            (2.into(), "script-ref".into(), register),
            (3.into(), "none".into(), Value::Null),
        ]
    );
    // The account's own output is no payment.
    assert_eq!(read["ownOutputs"][0]["txIndex"], 0);
}

#[test]
fn the_readings_hold_whatever_transaction_details_makes_of_the_witness_set() {
    // A redeemer key of three fields, [spend, 0, 0]: Pallas reads it, skipping the third, and so signs over it, but
    // Transaction details refuses it, as the ledger does. The site can show it, then send the signature with a witness
    // set of its choosing.
    let witnesses = "a105a1830000008200820000";
    let (shown, committed) = (note("Thanks for order 77"), note("I agree to pay 500 ADA"));
    let built = tx_with(
        &[to_contract(REGISTER_DATUM, false)],
        Some(&committed),
        Some(&shown),
        witnesses,
    );
    assert!(
        decode_tx("preprod", &built)
            .is_err_and(|e| e.to_string().starts_with("a redeemer isn't readable"))
    );
    let signed = cip30::sign_tx(&account(), &request(&built)).unwrap();
    let read = serde_json::to_value(&signed.summary).unwrap();
    assert_eq!(read["metadataMismatch"], true);
    assert_eq!(read["paid"][0]["txIndex"], 0);
    assert_eq!(
        read["paid"][0]["register"]["generator"],
        &REGISTER_DATUM[10..106]
    );
    assert_eq!(read["scripts"], true);
}
