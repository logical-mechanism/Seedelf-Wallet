//! Chunk 51, gap-g8#4: a payment paid at most 20 recipients, on either side.
//! WebAssembly's `MAX_RECIPIENTS` is checked by `check_recipients` in
//! `account_send`, `transfer_plan` and `withdrawal_of`, and the extension's
//! `shared/recipients.ts` holds the same number. Core has no count rule: its
//! `settle` refuses only a transaction over the ledger's 16 KiB
//! (`build::MAX_TX_SIZE`), and the deployed wallet validator never reads a
//! transaction's outputs, so more recipients add nothing to its scripts'
//! cost. Both copies now hold 100, and what doesn't fit 16 KiB is core's
//! `TooLarge` to say (the worker says it in the user's words).
//!
//! Each test asks for 25 recipients, each a different address or Seedelf, at
//! 2 ADA each, through the function the worker's binding calls
//! (`buildAccountSend`, `buildTransferParts`, `buildWithdrawParts`). Each
//! asserts one transaction that pays every recipient exactly what was asked
//! and fits the ledger's size limit.

use pallas_primitives::alonzo::{Constr, MaybeIndefArray, PlutusData};
use pallas_primitives::conway::DatumOption;
use pallas_traverse::MultiEraTx;
use seedelf_core::build::MAX_TX_SIZE;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{InlineDatum, UtxoResponse};
use seedelf_wasm::api::{
    self, PathedUtxo, SeedelfPayment, SendPayment, SendRequest, TransferRequest, WithdrawPayment,
    WithdrawRequest,
};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// More recipients than the old cap of 20.
const RECIPIENTS: usize = 25;
/// What each recipient is paid.
const EACH: u64 = 2_000_000;
/// A private spend's `tx_cbor` is unsigned: giveme.my's and the one-time key's
/// witnesses add 2 × 101 bytes, and the witness set's key and array header.
const TWO_WITNESSES: u64 = 2 * 101 + 5;

fn fixture(path: &str) -> Value {
    let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn params() -> Value {
    fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
}

/// The 12-word phrase's real preprod UTxOs, each with its derivation path (as
/// api_test.rs's `account_utxos`): 10,350.54 ADA in 6 UTxOs.
fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
    let doc = fixture("../extension/tests/fixtures/koios-preprod.json");
    let stake = account.stake_address(true).unwrap().to_bech32().unwrap();
    let rows = doc["accounts"][&stake]["account_utxos"]
        .as_array()
        .unwrap()
        .clone();
    let mut paths = Vec::new();
    for role in [Role::Receive, Role::Change] {
        for index in 0..20 {
            let addr = account
                .base_address(true, role, index)
                .unwrap()
                .to_bech32()
                .unwrap();
            paths.push((addr, role as u32, index));
        }
    }
    rows.into_iter()
        .filter_map(|row| {
            let (_, role, index) = paths
                .iter()
                .find(|(a, _, _)| a == row["address"].as_str().unwrap())?;
            Some(PathedUtxo {
                utxo: serde_json::from_value(row).unwrap(),
                role: *role,
                index: *index,
            })
        })
        .collect()
}

/// Someone else's 25 receive addresses: the 15-word vector phrase's account.
fn their_addresses() -> Vec<String> {
    let doc = fixture("../../seedelf-crypto/tests/vectors/cardano_account.json");
    let phrase = doc["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
        .unwrap()["phrase"]
        .as_str()
        .unwrap()
        .to_string();
    let theirs = CardanoAccount::from_phrase(&phrase, 0).unwrap();
    (0..RECIPIENTS as u32)
        .map(|i| {
            theirs
                .base_address(true, Role::Receive, i)
                .unwrap()
                .to_bech32()
                .unwrap()
        })
        .collect()
}

/// The private balance: four of the 12-word phrase's synthetic 25 ADA contract
/// UTxO (owned-utxos.json), 100 ADA under its own register.
fn private_balance() -> Vec<UtxoResponse> {
    let owned: Vec<UtxoResponse> = serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
    )
    .unwrap();
    let base = owned.into_iter().next().unwrap();
    assert_eq!(base.value, "25000000");
    (0..4u64)
        .map(|i| UtxoResponse {
            tx_hash: format!("{:064x}", i + 1),
            ..base.clone()
        })
        .collect()
}

/// Someone else's Seedelf named `name`, under a fresh register of `key`: the
/// recorded preprod recipient's contract UTxO (transfer-preprod.json), renamed.
fn their_seedelf(name: &str, key: blstrs::Scalar) -> UtxoResponse {
    let register = Register::create(key).unwrap().rerandomize().unwrap();
    let mut utxo: UtxoResponse = serde_json::from_value(
        fixture("../extension/tests/fixtures/transfer-preprod.json")["recipient"].clone(),
    )
    .unwrap();
    utxo.asset_list.as_mut().unwrap()[0].asset_name = name.to_string();
    utxo.inline_datum = Some(InlineDatum {
        bytes: hex::encode(register.to_vec().unwrap()),
        value: json!({"constructor": 0, "fields": [
            {"bytes": register.generator}, {"bytes": register.public_value}]}),
    });
    utxo
}

fn register_from(datum: DatumOption) -> Register {
    let DatumOption::Data(data) = datum else {
        panic!("an inline datum")
    };
    let PlutusData::Constr(Constr { fields, .. }) = &data.0 else {
        panic!("a register is a constructor")
    };
    let fields = match fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |d: &PlutusData| match d {
        PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
        _ => panic!("a point is bytes"),
    };
    Register::new(bytes(&fields[0]), bytes(&fields[1]))
}

/// What each output to `address` pays it.
fn paid_to(tx: &MultiEraTx, address: &str) -> Vec<u64> {
    tx.outputs()
        .iter()
        .filter(|o| o.address().unwrap().to_bech32().unwrap() == address)
        .map(|o| o.value().coin())
        .collect()
}

#[test]
fn public_send_pays_25_addresses_in_one_transaction() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let to = their_addresses();
    let request = SendRequest {
        network: "preprod".into(),
        params: params(),
        utxos: account_utxos(&account),
        payments: to
            .iter()
            .map(|a| SendPayment {
                to: a.clone(),
                recipient: None,
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            })
            .collect(),
        withdrawal: None,
        note: None,
        invalid_hereafter: None,
    };
    let result = api::account_send(&account, request).unwrap_or_else(|e| {
        panic!("Send, {RECIPIENTS} addresses at 2 ADA from the public account: {e}")
    });
    assert_eq!(result.payments.len(), RECIPIENTS);
    let bytes = hex::decode(&result.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    for a in &to {
        assert_eq!(paid_to(&tx, a), vec![EACH], "{a}");
    }
    let size = bytes.len() as u64;
    assert!(size <= MAX_TX_SIZE, "{size}");
}

#[test]
fn private_send_pays_25_seedelfs_in_one_transaction() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let keys: Vec<blstrs::Scalar> = (0..RECIPIENTS).map(|_| random_scalar()).collect();
    let payments = keys
        .iter()
        .enumerate()
        .map(|(i, key)| {
            let name = format!("5eed0e1f{:056x}", i + 1);
            SeedelfPayment {
                recipient: their_seedelf(&name, *key),
                to: name,
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            }
        })
        .collect();
    let request = TransferRequest {
        network: "preprod".into(),
        params: params(),
        utxos: private_balance(),
        payments,
        classes: Default::default(),
        carry: false,
        most: false,
        seed: None,
        evaluation: None,
    };
    let parts = api::build_transfer_parts(sk, request).unwrap_or_else(|e| {
        panic!("Send, {RECIPIENTS} Seedelfs at 2 ADA from the private balance: {e}")
    });
    assert_eq!(parts.len(), 1, "several recipients go as one transaction");
    let part = &parts[0];
    assert_eq!(part.payments.len(), RECIPIENTS);
    assert!(
        part.payments
            .iter()
            .all(|p| !p.to_self && p.lovelace == EACH.to_string())
    );
    let bytes = hex::decode(&part.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let outs: Vec<(Register, u64)> = tx
        .outputs()
        .iter()
        .map(|o| (register_from(o.datum().unwrap().into()), o.value().coin()))
        .collect();
    // Each Seedelf once, under a fresh copy of its own register.
    for key in &keys {
        let paid: Vec<u64> = outs
            .iter()
            .filter(|(r, _)| r.is_owned(*key).unwrap())
            .map(|(_, l)| *l)
            .collect();
        assert_eq!(paid, vec![EACH]);
    }
    let size = bytes.len() as u64 + TWO_WITNESSES;
    assert!(size <= MAX_TX_SIZE, "{size}");
}

#[test]
fn make_public_pays_25_addresses_in_one_transaction() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let to = their_addresses();
    let request = WithdrawRequest {
        network: "preprod".into(),
        params: params(),
        utxos: private_balance(),
        payments: to
            .iter()
            .map(|a| WithdrawPayment {
                to: a.clone(),
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            })
            .collect(),
        classes: Default::default(),
        funding: None,
        most: false,
        carry: false,
        seed: None,
        evaluation: None,
    };
    let parts = api::build_withdraw_parts(sk, request).unwrap_or_else(|e| {
        panic!("Make public, {RECIPIENTS} addresses at 2 ADA from the private balance: {e}")
    });
    assert_eq!(parts.len(), 1, "several recipients go as one transaction");
    let part = &parts[0];
    assert_eq!(part.payments.len(), RECIPIENTS);
    let bytes = hex::decode(&part.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    for a in &to {
        assert_eq!(paid_to(&tx, a), vec![EACH], "{a}");
    }
    let size = bytes.len() as u64 + TWO_WITNESSES;
    assert!(size <= MAX_TX_SIZE, "{size}");
}
