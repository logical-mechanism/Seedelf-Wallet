//! Chunk 51, r2sign#1: a payment into Seedelf Wallet's contract is a Seedelf payment only where a Seedelf Wallet will
//! read it, and every reader takes every spelling the ledger takes. One register, written every way the ledger reads
//! it alike, and data that isn't one (`extension/tests/fixtures/register-spellings.json`, which the extension's
//! chain.test.ts reads too, for `registerOf`): seedelf-koios `register_of_datum`, which the WebAssembly's spends, core's
//! `ScriptSpend` and the CLI read a contract row's register with, the sign window's reading (cip30) and Transaction
//! details' (decode) agree on each. A datum kept by hash is no Seedelf payment, whatever the witness set carries: a
//! Koios row has no inline datum for such an output, so no Seedelf Wallet ever finds or spends it, and who can take
//! it is the preimage's to decide, which may be the site's alone. Before the fix, an indefinite pair `102([_ 0, [g,
//! u]])` read "register" in the window and "Yours" in the details while neither reader took it, and a datum the
//! witness set carried for an output's hash read "register" too.

use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use seedelf_core::build::{self, Chain, ScriptSpend};
use seedelf_core::constants::get_config;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{
    ProtocolParameters, UtxoResponse, extract_bytes_with_logging, register_of_datum,
};
use seedelf_wasm::cip30::{self, KeyPath, KoiosRow, TxRequest};
use seedelf_wasm::decode::decode_tx;
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

/// One of the fixture's spellings: its name, its datum's bytes, and whether it's the register.
type Spelling = (String, Vec<u8>, bool);

/// The fixture's register, its secret, and each of its spellings.
fn spellings() -> (Register, blstrs::Scalar, Vec<Spelling>) {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../extension/tests/fixtures/register-spellings.json"
    ))
    .unwrap();
    let register = Register::new(
        fixture["generator"].as_str().unwrap().into(),
        fixture["publicValue"].as_str().unwrap().into(),
    );
    let sk = blstrs::Scalar::from(fixture["secret"].as_str().unwrap().parse::<u64>().unwrap());
    let all = fixture["spellings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["name"].as_str().unwrap().to_string(),
                hex::decode(s["datum"].as_str().unwrap()).unwrap(),
                s["register"].as_bool().unwrap(),
            )
        })
        .collect();
    (register, sk, all)
}

/// A CBOR head of `major` with `n`.
fn head(major: u8, n: usize) -> String {
    let m = major << 5;
    match n {
        n if n < 24 => format!("{:02x}", m | n as u8),
        n if n < 0x100 => format!("{:02x}{n:02x}", m | 24),
        n => format!("{:02x}{n:04x}", m | 25),
    }
}

/// A CBOR byte string.
fn bstr(b: &[u8]) -> String {
    format!("{}{}", head(2, b.len()), hex::encode(b))
}

/// A post-Alonzo output written by hand: Pallas would write a tag-102 pair back definite, and the site's bytes are
/// what's signed and put on chain.
fn output(address: &Address, lovelace: u32, datum_option: &str) -> String {
    format!(
        "a300{}011a{lovelace:08x}02{datum_option}",
        bstr(&address.to_vec())
    )
}

#[test]
fn every_reader_of_a_payments_register_reads_every_spelling_alike() {
    let (register, sk, spellings) = spellings();
    assert_eq!(
        Register::create(sk).unwrap(),
        register,
        "the test vector's register"
    );
    assert!(build::is_payable(&register));

    // seedelf-koios, as the WebAssembly, core and the CLI read a row: each register spelling is the register, nothing
    // else is one.
    let mut wrong = Vec::new();
    for (name, datum, is_register) in &spellings {
        let read = register_of_datum(datum);
        if read.as_ref() != is_register.then_some(&register) {
            wrong.push(format!("seedelf-koios register_of_datum, {name}: {read:?}"));
        }
    }

    // A site's transaction paying into the contract each spelling twice: inline, then kept by hash. The witness set
    // carries the datum of every hash it can hold in place: Pallas reads a tag-102 pair's head and leaves an
    // indefinite one's closing break, so one of those in the witness set leaves the transaction unreadable.
    let config = get_config(1, true).unwrap();
    let contract_hash = config.contract.wallet_contract_hash;
    let contract = seedelf_core::address::wallet_contract(true, contract_hash);
    let lovelace = 2_000_000u32;
    let mut outputs = Vec::new();
    let mut carried = Vec::new();
    for (_, datum, _) in &spellings {
        outputs.push(output(
            &contract,
            lovelace,
            &format!("8201d818{}", bstr(datum)),
        ));
        let hash = Hasher::<256>::hash(datum);
        outputs.push(output(
            &contract,
            lovelace,
            &format!("8200{}", bstr(hash.as_ref())),
        ));
        if !hex::encode(datum).starts_with("d8669f") {
            carried.push(hex::encode(datum));
        }
    }
    assert!(carried.len() > 1, "some of them carried");
    let fee = 400_000u64;
    let body = format!(
        "a30081825820{TX_A}0001{}{}021a{fee:08x}",
        head(4, outputs.len()),
        outputs.concat()
    );
    let witnesses = format!("a104{}{}", head(4, carried.len()), carried.concat());
    let tx = format!("84{body}{witnesses}f5f6");

    let funded = u64::from(lovelace) * outputs.len() as u64 + fee;
    let input: KoiosRow = serde_json::from_value(json!({
        "tx_hash": TX_A, "tx_index": 0,
        "address": account().base_address(true, Role::Receive, 0).unwrap().to_bech32().unwrap(),
        "value": funded.to_string(), "asset_list": [],
    }))
    .unwrap();
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.clone(),
        keys: vec![KeyPath { role: 0, index: 0 }],
        inputs: vec![input],
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    };
    let summary = cip30::inspect_tx(&account(), &request).unwrap();
    assert_eq!(summary.paid.len(), outputs.len());
    let detail = decode_tx("preprod", &tx).unwrap();
    assert_eq!(detail.outputs.len(), outputs.len());

    // Core's spend of each spelling as Koios lists it once it's on chain: found, owned and spent.
    let epoch: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    let chain = Chain {
        params: ProtocolParameters::from_koios(&epoch[0]).unwrap(),
        network_flag: true,
        config,
    };
    let row = |index: usize, datum: &[u8]| -> UtxoResponse {
        serde_json::from_value(json!({
            "tx_hash": summary.tx_hash, "tx_index": index,
            "address": contract.to_bech32().unwrap(), "value": lovelace.to_string(),
            "stake_address": null, "payment_cred": hex::encode(contract_hash),
            "epoch_no": 0, "block_height": 0, "block_time": 0,
            "datum_hash": hex::encode(Hasher::<256>::hash(datum).as_ref()),
            "inline_datum": { "bytes": hex::encode(datum), "value": null },
            "reference_script": null, "asset_list": [], "is_spent": false,
        }))
        .unwrap()
    };
    let signer = Hash::<28>::new([7; 28]);

    for (n, (name, datum, is_register)) in spellings.iter().enumerate() {
        let (inline, hashed) = (2 * n, 2 * n + 1);
        // What a Seedelf Wallet does with the row: reads its register, owns it by sk, and spends it.
        let on_chain = row(inline, datum);
        let finds = extract_bytes_with_logging(&on_chain.inline_datum)
            .is_some_and(|r| build::is_payable(&r) && r.is_owned(sk).unwrap_or(false))
            && ScriptSpend::new(&chain, std::slice::from_ref(&on_chain), &register, signer).is_ok();
        if finds != *is_register {
            wrong.push(format!(
                "{name}: a Seedelf Wallet finds and spends it: {finds}"
            ));
        }
        // The sign window: a Seedelf payment ("register") just where the wallet finds it; otherwise, at the contract
        // with no register, anyone's ("none").
        let window = summary.paid[inline].seedelf.as_deref();
        let said = if *is_register { "register" } else { "none" };
        if window != Some(said) {
            wrong.push(format!(
                "sign window, inline {name}: {window:?}, not {said:?}"
            ));
        }
        // Transaction details: payable just where the wallet finds it.
        let payable = detail.outputs[inline]
            .register
            .as_ref()
            .is_some_and(|r| r.payable);
        if payable != *is_register {
            wrong.push(format!(
                "Transaction details, inline {name}: payable {payable}"
            ));
        }
        // Kept by hash, carried or not: never a Seedelf payment, never "anyone can take", in either reading.
        let window = summary.paid[hashed].seedelf.as_deref();
        if window != Some("hash") {
            wrong.push(format!(
                "sign window, {name} kept by hash: {window:?}, not \"hash\""
            ));
        }
        if detail.outputs[hashed].register.is_some() {
            wrong.push(format!(
                "Transaction details, {name} kept by hash: a register"
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}

/// The fixture's reference scripts, each as an output's key 3 in hex, by name.
fn reference_scripts() -> Vec<(String, String)> {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../extension/tests/fixtures/register-spellings.json"
    ))
    .unwrap();
    fixture["referenceScripts"]["scripts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| {
            (
                s["name"].as_str().unwrap().to_string(),
                s["scriptRef"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// Chunk 51, l3sign#1: a payment under a register whose output carries a reference script too. Its register's owner
/// can spend it, but the private balance leaves such a row out and no Seedelf Wallet spend takes it yet (core's
/// `eval::refusal`), so the sign window never reads it as a Seedelf payment: "script-ref", in every spelling of the
/// register, beside any script. Transaction details still reads its register and its script, which the extension's
/// tx-view.ts tags as one Seedelf Wallet can't spend yet. Data that isn't a register, and a datum kept by hash, read as
/// they do without the script. Before the fix, the window read "register" whatever the output carried.
#[test]
fn a_register_beside_a_reference_script_is_never_read_as_a_seedelf_payment() {
    let (_, _, spellings) = spellings();
    let scripts = reference_scripts();
    assert!(scripts.len() > 1, "more than one kind of script");
    let config = get_config(1, true).unwrap();
    let contract =
        seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash);
    let lovelace = 2_000_000u32;
    // Each spelling beside each script: inline, then kept by hash.
    let mut outputs = Vec::new();
    let mut cases = Vec::new();
    for (name, datum, is_register) in &spellings {
        let hash = Hasher::<256>::hash(datum);
        for (script, script_ref) in &scripts {
            for datum_option in [
                format!("8201d818{}", bstr(datum)),
                format!("8200{}", bstr(hash.as_ref())),
            ] {
                outputs.push(format!(
                    "a400{}011a{lovelace:08x}02{datum_option}03{script_ref}",
                    bstr(&contract.to_vec())
                ));
            }
            cases.push((format!("{name}, beside {script}"), *is_register));
        }
    }
    let fee = 400_000u64;
    let body = format!(
        "a30081825820{TX_A}0001{}{}021a{fee:08x}",
        head(4, outputs.len()),
        outputs.concat()
    );
    let tx = format!("84{body}a0f5f6");
    let funded = u64::from(lovelace) * outputs.len() as u64 + fee;
    let input: KoiosRow = serde_json::from_value(json!({
        "tx_hash": TX_A, "tx_index": 0,
        "address": account().base_address(true, Role::Receive, 0).unwrap().to_bech32().unwrap(),
        "value": funded.to_string(), "asset_list": [],
    }))
    .unwrap();
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.clone(),
        keys: vec![KeyPath { role: 0, index: 0 }],
        inputs: vec![input],
        partial_sign: false,
        stake_index: 0,
        stake_deposit: None,
        governance: false,
    };
    let summary = cip30::inspect_tx(&account(), &request).unwrap();
    assert_eq!(summary.paid.len(), outputs.len());
    let detail = decode_tx("preprod", &tx).unwrap();
    assert_eq!(detail.outputs.len(), outputs.len());

    let mut wrong = Vec::new();
    for (n, (name, is_register)) in cases.iter().enumerate() {
        let (inline, hashed) = (2 * n, 2 * n + 1);
        // The sign window: a register beside a script is a reading of its own, never a Seedelf payment's.
        let window = summary.paid[inline].seedelf.as_deref();
        let said = if *is_register { "script-ref" } else { "none" };
        if window != Some(said) {
            wrong.push(format!(
                "sign window, inline {name}: {window:?}, not {said:?}"
            ));
        }
        // Transaction details: the register as without the script, and the script beside it.
        let out = &detail.outputs[inline];
        let payable = out.register.as_ref().is_some_and(|r| r.payable);
        if payable != *is_register || out.script_ref.is_none() {
            wrong.push(format!(
                "Transaction details, inline {name}: payable {payable}, script {}",
                out.script_ref.is_some()
            ));
        }
        // Kept by hash: as without the script, in both.
        let window = summary.paid[hashed].seedelf.as_deref();
        if window != Some("hash") {
            wrong.push(format!(
                "sign window, {name} kept by hash: {window:?}, not \"hash\""
            ));
        }
        if detail.outputs[hashed].register.is_some() || detail.outputs[hashed].script_ref.is_none()
        {
            wrong.push(format!(
                "Transaction details, {name} kept by hash: a register, or no script"
            ));
        }
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
}
