//! Chunk 51, finding w2#4: `getUtxos` handed a site the account's UTxO without
//! the reference script it carries on chain. The worker passes WebAssembly the
//! Koios row with its `reference_script` kept (`trimmed`, koios.ts), but
//! `KoiosRow` had no field for it and `utxo_cbor` wrote keys 0 to 2 only (or
//! the legacy array). A site that prices its fee from the UTxO it was handed
//! leaves out Conway's fee for a reference script on a spent input, and the
//! node refuses the signed transaction (`FeeTooSmallUTxO`). The first test is
//! the verifier's, as it failed while the bug was there; the others are its
//! class: a Plutus script as Koios and the data layer give one, a script that
//! can't be written (left out, never handed over without it), and an output of
//! the account's in a site's transaction, kept for its next one.

use pallas_codec::minicbor::{self, Encoder, data::Tag};
use pallas_codec::utils::CborWrap;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::{Fragment, TransactionInput, conway};
use seedelf_core::build::reference_script_fee;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_koios::koios::ProtocolParameters;
use seedelf_wasm::cip30::{self, KeyPath, KoiosRow, KoiosScript, TxRequest};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";
/// A Plutus script's bytes as the ledger keeps them: a byte string of its flat program.
const PLUTUS: &str = "4d01000033222220051200120011";

/// Mainnet's and preprod's fee parameters, 15 lovelace a byte of reference script.
fn params() -> ProtocolParameters {
    ProtocolParameters::from_koios(&serde_json::json!({
        "min_fee_a": 44, "min_fee_b": 155381, "coins_per_utxo_size": "4310",
        "key_deposit": "2000000", "price_mem": 0.0577, "price_step": 0.0000721,
        "min_fee_ref_script_cost_per_byte": 15,
        "cost_models": { "PlutusV3": [] },
    }))
    .unwrap()
}

#[test]
fn a_utxo_carrying_a_reference_script_is_handed_over_with_it() {
    // A stranger's native script: any of 15 keys, 483 bytes. Anyone can pay
    // the account's 0/0 an output carrying it, for its minimum ADA.
    let native = conway::NativeScript::ScriptAny(
        (1..=15u8)
            .map(|i| conway::NativeScript::ScriptPubkey(Hash::new([i; 28])))
            .collect(),
    );
    let script = native.encode_fragment().unwrap();
    assert_eq!(script.len(), 483);
    let address = CardanoAccount::from_phrase(PHRASE, 0)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();

    // The row as the worker hands it to `cip30Utxos` (dapp.ts `encode`): Koios's
    // `credential_utxos` row, `trimmed`, its reference script kept.
    let row: KoiosRow = serde_json::from_value(serde_json::json!({
        "tx_hash": TX_A,
        "tx_index": 0,
        "address": address.to_bech32().unwrap(),
        "value": "5000000",
        "stake_address": null,
        "payment_cred": null,
        "block_height": 1,
        "inline_datum": null,
        "datum_hash": null,
        "asset_list": [],
        "reference_script": {
            "hash": hex::encode(Hasher::<224>::hash_tagged(&script, 0)),
            "size": script.len(),
            "type": "timelock",
            "bytes": hex::encode(&script),
        },
    }))
    .unwrap();

    let bytes = cip30::utxo_cbor(&row).unwrap();
    let mut d = minicbor::Decoder::new(&bytes);
    assert_eq!(d.array().unwrap(), Some(2));
    let input: TransactionInput = d.decode().unwrap();
    assert_eq!(hex::encode(input.transaction_id), TX_A);
    let output: conway::TransactionOutput = d.decode().unwrap();
    let script_ref = match output {
        conway::PseudoTransactionOutput::PostAlonzo(o) => o.script_ref,
        conway::PseudoTransactionOutput::Legacy(_) => None,
    };

    // What a site's fee leaves out when it can't see the script (Conway's
    // reference-script fee, the wallet's own reckoning of it).
    let short = reference_script_fee(&params(), script.len() as u64).unwrap();
    assert_eq!(short, 7_245);
    let Some(CborWrap(conway::PseudoScript::NativeScript(handed))) = script_ref else {
        panic!(
            "getUtxos hands the site {} without the reference script it holds on chain: \
             a fee priced from it is {short} lovelace short, and the node refuses the transaction",
            hex::encode(&bytes)
        );
    };
    assert_eq!(handed.encode_fragment().unwrap(), script);
}

fn address(role: Role, index: u32) -> pallas_addresses::Address {
    CardanoAccount::from_phrase(PHRASE, 0)
        .unwrap()
        .base_address(true, role, index)
        .unwrap()
}

/// A row at `0/0` of 3 ₳, its transaction `n` repeated, carrying `script` (JSON, as the worker hands it over).
fn row_with(n: u8, script: serde_json::Value) -> KoiosRow {
    serde_json::from_value(serde_json::json!({
        "tx_hash": hex::encode([n; 32]),
        "tx_index": 0,
        "address": address(Role::Receive, 0).to_bech32().unwrap(),
        "value": "3000000",
        "asset_list": [],
        "reference_script": script,
    }))
    .unwrap()
}

/// The output of a CIP-30 `TransactionUnspentOutput`.
fn output_of(utxo: &[u8]) -> conway::TransactionOutput {
    let mut d = minicbor::Decoder::new(utxo);
    d.array().unwrap();
    d.skip().unwrap();
    d.decode().unwrap()
}

fn script_ref_of(output: conway::TransactionOutput) -> Option<CborWrap<conway::ScriptRef>> {
    match output {
        conway::PseudoTransactionOutput::PostAlonzo(o) => o.script_ref,
        conway::PseudoTransactionOutput::Legacy(_) => None,
    }
}

/// A Plutus script as Koios and the data layer give one: seedelf-core's recorded mainnet row, which both gave
/// byte for byte on 2026-11-18. Its bytes are the ledger's, a byte string of the flat program (`590204…`), its hash
/// theirs with the language's tag, so the UTxO is handed over with `[3, bytes]`.
#[test]
fn a_plutus_script_is_handed_over_as_both_data_sources_give_it() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/reference_script_utxo.json"
    ))
    .unwrap();
    let given = &rows[0]["reference_script"];
    assert_eq!(given["type"], "plutusV3");
    let bytes = hex::decode(given["bytes"].as_str().unwrap()).unwrap();
    assert_eq!(given["size"], bytes.len());
    let row: KoiosRow = serde_json::from_value(rows[0].clone()).unwrap();

    let handed = script_ref_of(output_of(&cip30::utxo_cbor(&row).unwrap()));
    let Some(CborWrap(conway::PseudoScript::PlutusV3Script(script))) = handed else {
        panic!("the Plutus V3 script is handed over with its UTxO, as the chain holds it");
    };
    assert_eq!(script.as_ref(), bytes.as_slice());
    assert_eq!(
        hex::encode(Hasher::<224>::hash_tagged(script.as_ref(), 3)),
        given["hash"].as_str().unwrap()
    );
}

/// A UTxO whose script can't be written as the ledger holds it is left out of what a site is handed, never handed
/// over without it: a native script as Koios and the data layer give one (no bytes, no size), a type the ledger has
/// no script of, bytes that aren't hex or that disagree with the size or hash given, a native script nested past
/// `MAX_DEPTH` (a site's decoder reads it by recursion), or a script in a shape no source writes. Every such row
/// still reads, so no request is refused over one.
#[test]
fn a_script_that_cant_be_written_leaves_its_utxo_out() {
    let key_hash = "ab".repeat(28);
    let native = hex::decode(format!("8201818200581c{key_hash}")).unwrap();
    let deep = hex::decode(format!("{}8200581c{key_hash}", "820181".repeat(70))).unwrap();
    let hashed = |bytes: &[u8], tag: u8| hex::encode(Hasher::<224>::hash_tagged(bytes, tag));
    let plutus = hex::decode(PLUTUS).unwrap();
    let script = |kind: &str, bytes: &[u8], tag: u8| {
        serde_json::json!({
            "hash": hashed(bytes, tag), "size": bytes.len(), "type": kind, "bytes": hex::encode(bytes),
        })
    };

    let kept = [
        row_with(1, serde_json::Value::Null),
        row_with(2, script("timelock", &native, 0)),
        row_with(3, script("plutusV3", &plutus, 3)),
    ];
    let left_out = [
        // As Koios and the data layer give a native script: its JSON alone, which the worker drops.
        row_with(
            4,
            serde_json::json!({ "hash": hashed(&native, 0), "size": null, "type": "timelock", "bytes": null }),
        ),
        row_with(
            5,
            serde_json::json!({ "hash": null, "size": 5, "type": "plutusV9", "bytes": "4401020304" }),
        ),
        row_with(
            6,
            serde_json::json!({ "hash": null, "size": 1, "type": "plutusV3", "bytes": "zz" }),
        ),
        row_with(
            7,
            serde_json::json!({ "hash": hashed(&plutus, 3), "size": 99, "type": "plutusV3", "bytes": PLUTUS }),
        ),
        row_with(
            8,
            serde_json::json!({ "hash": "00".repeat(28), "size": 14, "type": "plutusV3", "bytes": PLUTUS }),
        ),
        row_with(9, script("timelock", &deep, 0)),
        row_with(10, serde_json::json!("82008")),
        row_with(11, serde_json::json!({})),
    ];

    for row in &left_out {
        let refused = cip30::utxo_cbor(row).unwrap_err().to_string();
        assert!(
            refused.contains("can't hand over whole"),
            "{}: {refused}",
            row.tx_hash
        );
    }
    let rows: Vec<KoiosRow> = left_out.iter().chain(&kept).cloned().collect();
    let handed: Vec<String> = cip30::utxos_cbor(&rows)
        .unwrap()
        .iter()
        .map(|utxo| {
            let mut d = minicbor::Decoder::new(utxo);
            d.array().unwrap();
            let input: TransactionInput = d.decode().unwrap();
            hex::encode(input.transaction_id)
        })
        .collect();
    let expected: Vec<String> = kept.iter().map(|r| r.tx_hash.clone()).collect();
    assert_eq!(handed, expected);
}

/// A datum kept by hash beside a script: the map form, its datum `[0, hash]`, since the legacy array has no room for
/// the script.
#[test]
fn a_datum_by_hash_beside_a_script_is_written_in_the_map_form() {
    let plutus = hex::decode(PLUTUS).unwrap();
    let mut row = row_with(
        12,
        serde_json::json!({ "hash": null, "size": plutus.len(), "type": "plutusV2", "bytes": PLUTUS }),
    );
    row.datum_hash = Some("cd".repeat(32));
    let conway::PseudoTransactionOutput::PostAlonzo(o) =
        output_of(&cip30::utxo_cbor(&row).unwrap())
    else {
        panic!("a script needs the map form");
    };
    let Some(conway::PseudoDatumOption::Hash(hash)) = o.datum_option else {
        panic!("the datum's hash is kept");
    };
    assert_eq!(hex::encode(hash), "cd".repeat(32));
    assert!(matches!(
        o.script_ref,
        Some(CborWrap(conway::PseudoScript::PlutusV2Script(s))) if s.as_ref() == plutus.as_slice()
    ));
}

/// CBOR written by hand: what `write` puts down.
fn written(
    write: impl FnOnce(
        &mut Encoder<Vec<u8>>,
    ) -> Result<(), minicbor::encode::Error<std::convert::Infallible>>,
) -> Vec<u8> {
    let mut e = Encoder::new(Vec::new());
    write(&mut e).unwrap();
    e.into_writer()
}

/// The class's second half: an output of the account's in a site's transaction is kept for the site's next
/// transaction with the reference script it carries (`OwnOutput::reference_script`, dapp.ts `remember`), read as the
/// transaction writes it: a native script's own bytes, here with a number in a longer form than Pallas writes, so its
/// hash and size are the chain's. Read back as the worker keeps it, the UTxO is handed over with it.
#[test]
fn a_chained_output_keeps_its_reference_script_as_written() {
    let key_hash = "ab".repeat(28);
    // ScriptAll of one key, its kind (1) written `18 01`: the ledger hashes these bytes, not Pallas's `01`.
    let native = hex::decode(format!("821801818200581c{key_hash}")).unwrap();
    let plutus = hex::decode(PLUTUS).unwrap();
    let plutus_ref = written(|e| {
        e.array(2)?.u8(3)?.bytes(&plutus)?;
        Ok(())
    });
    let native_ref = [hex::decode("8200").unwrap(), native.clone()].concat();
    let (own0, own1) = (address(Role::Receive, 0), address(Role::Change, 0));
    let tx = written(|e| {
        e.array(4)?.map(3)?;
        e.u8(0)?
            .array(1)?
            .array(2)?
            .bytes(&hex::decode(TX_A).unwrap())?
            .u8(0)?;
        e.u8(1)?.array(2)?;
        e.map(3)?
            .u8(0)?
            .bytes(&own0.to_vec())?
            .u8(1)?
            .u64(4_000_000)?
            .u8(3)?
            .tag(Tag::new(24))?
            .bytes(&plutus_ref)?;
        e.map(3)?
            .u8(0)?
            .bytes(&own1.to_vec())?
            .u8(1)?
            .u64(5_000_000)?
            .u8(3)?
            .tag(Tag::new(24))?
            .bytes(&native_ref)?;
        e.u8(2)?.u64(1_000_000)?;
        e.map(0)?.bool(true)?.null()?;
        Ok(())
    });
    let input: KoiosRow = serde_json::from_value(serde_json::json!({
        "tx_hash": TX_A, "tx_index": 0, "address": own0.to_bech32().unwrap(), "value": "10000000",
    }))
    .unwrap();
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: hex::encode(&tx),
        keys: (0..3)
            .flat_map(|index| [KeyPath { role: 0, index }, KeyPath { role: 1, index }])
            .collect(),
        inputs: vec![input],
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    };
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let summary = cip30::inspect_tx(&account, &request).unwrap();
    assert_eq!(summary.own_outputs.len(), 2);
    let scripts: Vec<Option<KoiosScript>> = summary
        .own_outputs
        .iter()
        .map(|o| o.reference_script.clone())
        .collect();
    assert_eq!(
        scripts,
        [
            Some(KoiosScript {
                hash: Some(hex::encode(Hasher::<224>::hash_tagged(&plutus, 3))),
                size: Some(plutus.len() as u64),
                kind: Some("plutusV3".into()),
                bytes: Some(PLUTUS.into()),
            }),
            Some(KoiosScript {
                hash: Some(hex::encode(Hasher::<224>::hash_tagged(&native, 0))),
                size: Some(native.len() as u64),
                kind: Some("timelock".into()),
                bytes: Some(hex::encode(&native)),
            }),
        ]
    );

    // As the worker keeps it (dapp.ts `remember`) and hands it to a site: with the script, its bytes as written.
    for (own, script_ref) in summary.own_outputs.iter().zip([&plutus_ref, &native_ref]) {
        let kept: KoiosRow = serde_json::from_value(serde_json::json!({
            "tx_hash": summary.tx_hash,
            "tx_index": own.tx_index,
            "address": own.address,
            "value": own.lovelace,
            "reference_script": serde_json::to_value(&own.reference_script).unwrap(),
        }))
        .unwrap();
        let handed = cip30::utxo_cbor(&kept).unwrap();
        let wrapped = written(|e| {
            e.u8(3)?.tag(Tag::new(24))?.bytes(script_ref)?;
            Ok(())
        });
        assert!(
            hex::encode(&handed).contains(&hex::encode(&wrapped)),
            "output {} is handed over with its script as written",
            own.tx_index
        );
    }
}
