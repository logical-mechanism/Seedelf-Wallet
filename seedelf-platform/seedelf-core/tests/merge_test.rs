//! A Seedelf spend that also spends a key account and puts up that account's
//! collateral (`ScriptSpend::with_account`): a private session's return,
//! merged into the Seedelf UTxO its funding made. Measured in the wallet
//! against the deployed preprod wallet contract, so a wrong redeemer index,
//! proof or signer fails here.

use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::conway::PlutusData;
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{Chain, ScriptSpend};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const MIN_POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";

/// Preprod's parameters at epoch 315, with its 350-entry V3 cost model.
fn params() -> ProtocolParameters {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/eval-preprod.json")).expect("fixture");
    let seedelf = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"].as_str().unwrap().starts_with("seedelf spend"))
        .unwrap()
        .clone();
    ProtocolParameters::from_koios(&json!({
        "min_fee_a": 44, "min_fee_b": 155381, "coins_per_utxo_size": "4310",
        "key_deposit": "2000000", "price_mem": 0.0577, "price_step": 0.0000721,
        "cost_models": { "PlutusV3": seedelf["cost_model_v3"] },
    }))
    .unwrap()
}

fn chain() -> Chain {
    Chain {
        params: params(),
        network_flag: true,
        config: get_config(VARIANT, true).unwrap(),
    }
}

struct Session {
    key: Hash<28>,
    address: Address,
}

fn session() -> Session {
    let key = Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref());
    let address = ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(key),
        ShelleyDelegationPart::Null,
    )
    .into();
    Session { key, address }
}

fn row(
    tx: u8,
    index: u64,
    address: &Address,
    lovelace: u64,
    tokens: &[(&str, &str, u64)],
) -> UtxoResponse {
    let assets: Vec<Value> = tokens
        .iter()
        .map(|(p, n, q)| json!({ "policy_id": p, "asset_name": n, "quantity": q.to_string(), "decimals": 0, "fingerprint": "" }))
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": index,
        "address": address.to_bech32().unwrap(), "value": lovelace.to_string(),
        "stake_address": null, "payment_cred": "", "epoch_no": 0, "block_height": 0,
        "block_time": 0, "datum_hash": null, "inline_datum": null,
        "reference_script": null, "asset_list": assets, "is_spent": false,
    }))
    .unwrap()
}

/// A wallet-contract UTxO under `register`, as Koios lists it.
fn contract_row(tx: u8, index: u64, lovelace: u64, register: &Register) -> UtxoResponse {
    let wallet = wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let mut r = row(tx, index, &wallet, lovelace, &[]);
    r.inline_datum = serde_json::from_value(json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
    .unwrap();
    r
}

fn spends(tx: &MultiEraTx, hash: [u8; 32], index: u64) -> bool {
    tx.inputs()
        .iter()
        .any(|i| **i.hash() == hash && i.index() == index)
}

#[test]
fn a_sessions_return_merges_into_its_funding_change_under_its_own_collateral() {
    let sk = schnorr::random_scalar();
    let owner = Register::create(sk).unwrap();
    let s = session();
    // The funding's change, sorted after two of the account's UTxOs and
    // before the third, so its redeemer points past the account's inputs.
    let change = contract_row(0x30, 2, 20_000_000, &owner.clone().rerandomize().unwrap());
    let account = vec![
        row(0x10, 0, &s.address, 30_000_000, &[]),
        row(0x20, 1, &s.address, 5_000_000, &[]),
        row(
            0x40,
            0,
            &s.address,
            2_000_000,
            &[(MIN_POLICY, "4d494e", 500)],
        ),
    ];
    let collateral = account[1].clone();
    // The proof is bound to a one-time key of its own, never the account's.
    let one_time = session().key;

    let spend = ScriptSpend::new(&chain(), std::slice::from_ref(&change), &owner, one_time)
        .unwrap()
        .with_account(s.key, &account, &collateral)
        .unwrap()
        .proven(|register, vkh| schnorr::create_proof(register.clone(), sk, vkh.to_string()))
        .unwrap();
    let built = spend.measure_locally(&[]).unwrap();

    let tx = MultiEraTx::decode(&built.tx.tx_bytes.0).unwrap();
    let conway = tx.as_conway().unwrap();
    // Everything is spent, the collateral too, and it's the collateral.
    for (hash, index) in [(0x10, 0), (0x20, 1), (0x30, 2), (0x40, 0)] {
        assert!(spends(&tx, [hash; 32], index));
    }
    let collaterals: Vec<_> = tx
        .collateral()
        .iter()
        .map(|i| (**i.hash(), i.index()))
        .collect();
    assert_eq!(collaterals, vec![([0x20; 32], 1)]);
    // The collateral's return goes back to the account: 5 ₳ less 3/2 of the fee.
    let back = tx.collateral_return().expect("a collateral return");
    assert_eq!(back.address().unwrap().to_vec(), s.address.to_vec());
    assert_eq!(back.value().coin(), 5_000_000 - built.fee.total * 3 / 2);
    // The one-time key is the one the proof names; the account's key signs for its UTxOs.
    let signers: Vec<Hash<28>> = conway
        .transaction_body
        .required_signers
        .clone()
        .map(|s| s.to_vec())
        .unwrap_or_default();
    assert_eq!(signers, vec![one_time]);
    // The one spend redeemer points at the change, third in the ledger's order.
    let redeemers = tx.redeemers();
    assert_eq!(redeemers.len(), 1);
    assert_eq!(redeemers[0].index(), 2);

    // Everything, less the fee, lands in the contract under this wallet's registers.
    let total_in = 20_000_000 + 30_000_000 + 5_000_000 + 2_000_000;
    let mut total_out = 0;
    let mut tokens = 0;
    for output in tx.outputs() {
        let address = Address::from_bytes(&output.address().unwrap().to_vec()).unwrap();
        assert!(address.has_script(), "into the wallet contract");
        let Some(pallas_primitives::conway::PseudoDatumOption::Data(data)) = output.datum() else {
            panic!("a register datum")
        };
        let PlutusData::Constr(c) = data.unwrap().unwrap() else {
            panic!("a register")
        };
        let hexes: Vec<String> = c
            .fields
            .iter()
            .map(|f| match f {
                PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
                _ => panic!("two points"),
            })
            .collect();
        assert!(
            Register::new(hexes[0].clone(), hexes[1].clone())
                .is_owned(sk)
                .unwrap()
        );
        total_out += output.value().coin();
        tokens += output
            .value()
            .assets()
            .iter()
            .flat_map(|p| p.assets())
            .map(|a| a.output_coin().unwrap_or(0))
            .sum::<u64>();
    }
    assert_eq!(tokens, 500);
    assert_eq!(total_out + built.fee.total, total_in);
    assert_eq!(built.change_lovelace, total_out);
    assert_eq!(built.change_outputs, 1);
}

#[test]
fn an_account_under_another_key_or_a_token_collateral_is_refused() {
    let sk = schnorr::random_scalar();
    let owner = Register::create(sk).unwrap();
    let s = session();
    let other = session();
    let one_time = session().key;
    let change = contract_row(0x30, 0, 20_000_000, &owner.clone().rerandomize().unwrap());
    let spend =
        || ScriptSpend::new(&chain(), std::slice::from_ref(&change), &owner, one_time).unwrap();

    let foreign = row(0x10, 0, &other.address, 30_000_000, &[]);
    let ours = row(0x11, 0, &s.address, 5_000_000, &[]);
    let error = spend()
        .with_account(s.key, &[foreign], &ours)
        .err()
        .unwrap();
    assert!(
        error.to_string().contains("isn't under the account's key"),
        "{error}"
    );

    let tokens = row(0x12, 0, &s.address, 5_000_000, &[(MIN_POLICY, "4d494e", 1)]);
    let error = spend()
        .with_account(s.key, std::slice::from_ref(&ours), &tokens)
        .err()
        .unwrap();
    assert!(error.to_string().contains("ADA alone"), "{error}");

    let error = spend()
        .with_account(s.key, &[ours.clone(), ours.clone()], &ours)
        .err()
        .unwrap();
    assert!(error.to_string().contains("spent twice"), "{error}");

    // The proofs never bind to the account's own key.
    let bound_to_account =
        ScriptSpend::new(&chain(), std::slice::from_ref(&change), &owner, s.key).unwrap();
    let error = bound_to_account
        .with_account(s.key, std::slice::from_ref(&ours), &ours)
        .err()
        .unwrap();
    assert!(error.to_string().contains("one-time key"), "{error}");
}
