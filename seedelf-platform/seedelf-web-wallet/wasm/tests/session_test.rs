//! Private sessions' Cardano side: the one-time accounts (account `24301'`,
//! each session with its own payment and stake keys), bringing one back into Seedelf, and the
//! connector's reading and signing of a transaction built for one (a swap).

use pallas_addresses::{Address, ShelleyDelegationPart, ShelleyPaymentPart, StakePayload};
use pallas_codec::minicbor;
use pallas_codec::utils::{Bytes, NonEmptyKeyValuePairs, Nullable, Set};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::{PublicKey, Signature};
use pallas_primitives::{Fragment, PlutusData, TransactionInput, conway};
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{MAINNET_STAKE_HASH, PREPROD_STAKE_HASH, VARIANT, get_config};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT, Role};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api::{self, SessionReturnRequest};
use seedelf_wasm::cip30::{self, DataRequest, KeyPath, KoiosRow, TxRequest};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";
const MIN: &str = "4d494e";

fn accounts() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap()
}

fn params() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

fn session(index: u32) -> Address {
    api::one_time_address(&accounts(), true, index).unwrap()
}

/// A UTxO at `address` as Koios returns it.
fn utxo(
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
        "tx_hash": hex::encode([tx; 32]),
        "tx_index": index,
        "address": address.to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": "",
        "epoch_no": 0,
        "block_height": 0,
        "block_time": 0,
        "datum_hash": null,
        "inline_datum": null,
        "reference_script": null,
        "asset_list": assets,
        "is_spent": false,
    }))
    .unwrap()
}

/// The register in an output's inline datum: constructor 0 with the two points.
fn register_of(datum: &PlutusData) -> Register {
    let PlutusData::Constr(c) = datum else {
        panic!("not a constructor")
    };
    let fields: Vec<String> = c
        .fields
        .iter()
        .map(|f| match f {
            PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
            _ => panic!("a register holds two byte strings"),
        })
        .collect();
    Register::new(fields[0].clone(), fields[1].clone())
}

#[test]
fn one_time_accounts_are_account_24301_each_with_its_own_payment_and_stake_keys() {
    let accounts = accounts();
    let Address::Shelley(first) = session(0) else {
        panic!("a Shelley address")
    };
    // Payment key 0/0 and stake key 2/0 of m/1852'/1815'/24301', pinned: the derivation is frozen.
    assert_eq!(
        *first.payment(),
        ShelleyPaymentPart::Key(accounts.key_hash(Role::Receive, 0).unwrap())
    );
    assert_eq!(
        hex::encode(accounts.key_hash(Role::Receive, 0).unwrap()),
        PINNED_SESSION_0_KEY_HASH
    );
    assert_eq!(
        *first.delegation(),
        ShelleyDelegationPart::Key(accounts.key_hash(Role::Staking, 0).unwrap())
    );
    assert_eq!(session(0).to_bech32().unwrap(), PINNED_SESSION_0_PREPROD);
    assert_eq!(
        api::one_time_address(&accounts, false, 0)
            .unwrap()
            .to_bech32()
            .unwrap(),
        PINNED_SESSION_0_MAINNET
    );

    // Each session has its own payment and stake keys, shared with no other
    // session, and none is the public account's.
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let public_stake = public.key_hash(Role::Staking, 0).unwrap();
    let mut seen = std::collections::HashSet::new();
    for index in 0..20 {
        let Address::Shelley(at) = session(index) else {
            panic!("a Shelley address")
        };
        let payment = *at.payment().as_hash();
        let stake = *at.delegation().as_hash().expect("a staking part");
        assert!(
            seen.insert(payment),
            "session {index} repeats a payment key"
        );
        assert!(seen.insert(stake), "session {index} repeats a stake key");
        assert_ne!(payment, public.key_hash(Role::Receive, index).unwrap());
        assert_ne!(stake, public_stake);
        assert_ne!(stake, Hash::new(PREPROD_STAKE_HASH));
    }

    // Sessions recorded before keep the shared staking part they were funded at.
    let Address::Shelley(before) = api::shared_stake_address(&accounts, true, 0).unwrap() else {
        panic!("a Shelley address")
    };
    assert_eq!(before.payment(), first.payment());
    assert_eq!(
        *before.delegation(),
        ShelleyDelegationPart::Key(Hash::new(PREPROD_STAKE_HASH))
    );
    let Address::Shelley(before) = api::shared_stake_address(&accounts, false, 0).unwrap() else {
        panic!("a Shelley address")
    };
    assert_eq!(
        *before.delegation(),
        ShelleyDelegationPart::Key(Hash::new(MAINNET_STAKE_HASH))
    );
}

/// 24301'/0/0 of the all-"abandon" 12-word phrase, as `cardano-address key child 1852H/1815H/24301H/0/0` derives it.
const PINNED_SESSION_0_KEY_HASH: &str = "e264f7d08781fc73dfd84d1b32b074c6a24291ebab8035841a0b5984";

/// Session 0's address, payment key 24301'/0/0 and stake key 24301'/2/0, as
/// `cardano-address address payment --network-tag testnet | cardano-address
/// address delegation` builds it from those two keys.
const PINNED_SESSION_0_PREPROD: &str = "addr_test1qr3xfa7ss7qlcu7lmpx3kv4swnr2ys53aw4cqdvyrg94npxw22u923w7cyxhs2hrz2navj50pvqc7msf04kgpqf4hlcs00h9ax";
const PINNED_SESSION_0_MAINNET: &str = "addr1q83xfa7ss7qlcu7lmpx3kv4swnr2ys53aw4cqdvyrg94npxw22u923w7cyxhs2hrz2navj50pvqc7msf04kgpqf4hlcsve293e";

#[test]
fn a_session_comes_back_whole_into_seedelf_signed_by_its_key() {
    let accounts = accounts();
    let at = session(3);
    let utxos = vec![
        utxo(1, 0, &at, 20_000_000, &[]),
        utxo(2, 1, &at, 2_500_000, &[(POLICY, MIN, 906_594_100)]),
        utxo(3, 0, &at, 5_000_000, &[]),
    ];
    let sk = random_scalar();
    let result = api::session_return(
        &accounts,
        sk,
        SessionReturnRequest {
            network: "preprod".into(),
            params: params(),
            index: 3,
            utxos: utxos.clone(),
        },
    )
    .unwrap();

    let bytes = hex::decode(&result.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    assert_eq!(hex::encode(*tx.hash()), result.tx_hash);
    let fee = tx.fee().unwrap();
    assert_eq!(fee.to_string(), result.fee);
    assert_eq!(tx.inputs().len(), 3);
    assert_eq!(result.inputs, 3);

    // Everything goes into the contract, each output under a fresh register the key owns.
    let wallet = wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let mut lovelace = 0;
    let mut min = 0;
    let mut generators = std::collections::HashSet::new();
    for out in tx.outputs() {
        assert_eq!(out.address().unwrap().to_vec(), wallet.to_vec());
        let datum = match out.datum().unwrap() {
            pallas_primitives::conway::PseudoDatumOption::Data(d) => d.0.clone(),
            _ => panic!("an inline register"),
        };
        let register = register_of(&datum);
        assert!(register.is_owned(sk).unwrap(), "the user's register");
        assert!(
            generators.insert(register.generator.clone()),
            "re-randomized for each output"
        );
        lovelace += out.value().coin();
        for policy in out.value().assets() {
            for asset in policy.assets() {
                min += asset.output_coin().unwrap_or(0);
            }
        }
    }
    assert_eq!(lovelace, 27_500_000 - fee);
    assert_eq!(result.lovelace, (27_500_000 - fee).to_string());
    assert_eq!(min, 906_594_100);
    assert_eq!(result.tokens.len(), 1);
    assert_eq!(result.deposit_outputs, tx.outputs().len());

    // One signature, by session 3's key, over this transaction.
    let witnesses = tx.vkey_witnesses();
    assert_eq!(witnesses.len(), 1);
    let key: [u8; 32] = witnesses[0].vkey.to_vec().try_into().unwrap();
    let sig: [u8; 64] = witnesses[0].signature.to_vec().try_into().unwrap();
    assert!(PublicKey::from(key).verify(tx.hash(), &Signature::from(sig)));
    assert_eq!(
        Hasher::<224>::hash(&key),
        accounts.key_hash(Role::Receive, 3).unwrap()
    );
}

#[test]
fn a_return_takes_only_the_sessions_own_utxos() {
    let accounts = accounts();
    let request = |index: u32, utxos: Vec<UtxoResponse>| SessionReturnRequest {
        network: "preprod".into(),
        params: params(),
        index,
        utxos,
    };
    let sk = random_scalar();
    let err = api::session_return(
        &accounts,
        sk,
        request(3, vec![utxo(1, 0, &session(4), 9_000_000, &[])]),
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("isn't at session 3's account"),
        "{err}"
    );

    let public = CardanoAccount::from_phrase(PHRASE, 0)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    assert!(
        api::session_return(
            &accounts,
            sk,
            request(0, vec![utxo(1, 0, &public, 9_000_000, &[])])
        )
        .is_err()
    );

    let err = api::session_return(&accounts, sk, request(3, vec![])).unwrap_err();
    assert!(err.to_string().contains("nothing to bring back"), "{err}");

    let mainnet = api::one_time_address(&accounts, false, 3).unwrap();
    assert!(
        api::session_return(
            &accounts,
            sk,
            request(3, vec![utxo(1, 0, &mainnet, 9_000_000, &[])])
        )
        .is_err(),
        "the other network's address"
    );
}

/// A swap as Minswap's aggregator builds one for a session: its UTxO pays a
/// DEX's order contract (a datum hash), and the change comes back.
fn swap_tx(index: u32) -> (String, Vec<KoiosRow>) {
    let at = session(index);
    // An order contract's address, with the sender's staking part, as a V1 order's is.
    let Address::Shelley(sender) = &at else {
        panic!("a Shelley address")
    };
    let order = Address::Shelley(pallas_addresses::ShelleyAddress::new(
        pallas_addresses::Network::Testnet,
        ShelleyPaymentPart::Script(Hash::new([0xa6; 28])),
        sender.delegation().clone(),
    ));
    let input = TransactionInput {
        transaction_id: Hash::new([7; 32]),
        index: 1,
    };
    let output = |address: &Address, lovelace: u64, datum_hash: Option<Hash<32>>| {
        conway::PseudoTransactionOutput::PostAlonzo(conway::PostAlonzoTransactionOutput {
            address: Bytes::from(address.to_vec()),
            value: conway::Value::Coin(lovelace),
            datum_option: datum_hash.map(conway::PseudoDatumOption::Hash),
            script_ref: None,
        })
    };
    let body = conway::TransactionBody {
        inputs: Set::from(vec![input]),
        outputs: vec![
            output(&order, 14_000_000, Some(Hash::new([0xb4; 32]))),
            output(&at, 131_585_414, None),
        ],
        fee: 205_189,
        ttl: Some(134_639_865),
        certificates: None,
        withdrawals: None,
        auxiliary_data_hash: None,
        validity_interval_start: None,
        mint: None,
        script_data_hash: None,
        collateral: None,
        required_signers: None,
        network_id: None,
        collateral_return: None,
        total_collateral: None,
        reference_inputs: None,
        voting_procedures: None,
        proposal_procedures: None,
        treasury_value: None,
        donation: None,
    };
    let tx = conway::Tx {
        transaction_body: body,
        transaction_witness_set: conway::WitnessSet {
            vkeywitness: None,
            native_script: None,
            bootstrap_witness: None,
            plutus_v1_script: None,
            plutus_data: None,
            redeemer: None,
            plutus_v2_script: None,
            plutus_v3_script: None,
        },
        success: true,
        auxiliary_data: Nullable::Null,
    };
    let row: KoiosRow = serde_json::from_value(json!({
        "tx_hash": hex::encode([7u8; 32]),
        "tx_index": 1,
        "address": at.to_bech32().unwrap(),
        "value": "145790603",
    }))
    .unwrap();
    (hex::encode(tx.encode_fragment().unwrap()), vec![row])
}

#[test]
fn the_connector_reads_and_signs_a_swap_for_a_session_with_its_key_alone() {
    let accounts = accounts();
    let (tx, inputs) = swap_tx(5);
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.clone(),
        keys: vec![KeyPath { role: 0, index: 5 }],
        inputs,
        partial_sign: false,
        stake_index: 5,
    };
    let summary = cip30::inspect_tx(&accounts, &request).unwrap();
    assert_eq!(summary.own_inputs, 1);
    assert_eq!(summary.fee, "205189");
    assert_eq!(summary.paid.len(), 1);
    assert!(summary.paid[0].script);
    assert_eq!(summary.paid[0].lovelace, "14000000");
    assert_eq!(summary.paid[0].datum.as_deref(), Some("hash"));
    assert_eq!(summary.own_outputs.len(), 1);
    assert_eq!(
        summary.net_lovelace,
        (-(14_000_000i64 + 205_189)).to_string()
    );
    assert_eq!(summary.signs, vec!["0/5".to_string()]);
    assert!(summary.complete);

    let signed = cip30::sign_tx(&accounts, &request).unwrap();
    let witness_set =
        conway::WitnessSet::decode_fragment(&hex::decode(&signed.witness_set).unwrap()).unwrap();
    let witnesses = witness_set.vkeywitness.unwrap();
    assert_eq!(witnesses.len(), 1);
    let w = witnesses.iter().next().unwrap();
    let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
    assert_eq!(
        Hasher::<224>::hash(&key),
        accounts.key_hash(Role::Receive, 5).unwrap()
    );
    let hash = MultiEraTx::decode(&hex::decode(&tx).unwrap())
        .unwrap()
        .hash();
    let sig: [u8; 64] = w.signature.to_vec().try_into().unwrap();
    assert!(PublicKey::from(key).verify(hash, &Signature::from(sig)));

    // Another session's key doesn't make it this session's.
    let other = TxRequest {
        keys: vec![KeyPath { role: 0, index: 6 }],
        ..request
    };
    assert!(
        cip30::inspect_tx(&accounts, &other).is_err()
            || !cip30::inspect_tx(&accounts, &other).unwrap().complete
    );
}

/// The public key in a COSE_Key (CIP-8's `key`): its `-2` entry.
fn cose_key_x(key_hex: &str) -> [u8; 32] {
    let key = hex::decode(key_hex).unwrap();
    let mut d = minicbor::Decoder::new(&key);
    let entries = d.map().unwrap().unwrap();
    for _ in 0..entries {
        let label = d.i64().unwrap();
        if label == -2 {
            return d.bytes().unwrap().try_into().unwrap();
        }
        d.skip().unwrap();
    }
    panic!("no -2 in the COSE key")
}

#[test]
fn a_site_connected_to_a_session_signs_in_with_its_payment_key_or_its_own_stake_key() {
    let accounts = accounts();
    let index = 7;
    let reward = api::one_time_reward_address(&accounts, true, index).unwrap();
    let Address::Stake(stake) = &reward else {
        panic!("a reward address")
    };
    assert!(
        matches!(stake.payload(), StakePayload::Stake(h) if *h == accounts.key_hash(Role::Staking, index).unwrap()),
        "its reward address is its own stake key's, 2/{index}"
    );
    let request = |address: &Address, stake_index: u32| DataRequest {
        network: "preprod".into(),
        keys: vec![KeyPath { role: 0, index }],
        address: address.to_bech32().unwrap(),
        payload: hex::encode("Sign in to example.com"),
        stake_index,
    };

    // Its address signs with its payment key.
    let signer = cip30::data_signer(&accounts, &request(&session(index), index))
        .unwrap()
        .unwrap();
    assert_eq!(
        (signer.key.as_str(), signer.index),
        ("payment", Some(index))
    );
    let signed = cip30::sign_data(&accounts, &request(&session(index), index)).unwrap();
    assert_eq!(
        Hasher::<224>::hash(&cose_key_x(&signed.key)),
        accounts.key_hash(Role::Receive, index).unwrap()
    );

    // Its reward address, with its stake key, 2/index.
    assert_eq!(
        cip30::data_signer(&accounts, &request(&reward, index))
            .unwrap()
            .unwrap()
            .key,
        "stake"
    );
    let signed = cip30::sign_data(&accounts, &request(&reward, index)).unwrap();
    assert_eq!(
        Hasher::<224>::hash(&cose_key_x(&signed.key)),
        accounts.key_hash(Role::Staking, index).unwrap()
    );

    // Asked with the public account's stake index, the reward address isn't the session's.
    assert!(
        cip30::data_signer(&accounts, &request(&reward, 0))
            .unwrap()
            .is_none()
    );
}

#[test]
fn a_withdrawal_from_a_sessions_reward_account_is_signed_by_its_own_stake_key() {
    let accounts = accounts();
    let index = 5;
    let (tx, inputs) = swap_tx(index);
    let mut whole = conway::Tx::decode_fragment(&hex::decode(&tx).unwrap()).unwrap();
    let reward = api::one_time_reward_address(&accounts, true, index).unwrap();
    whole.transaction_body.withdrawals =
        NonEmptyKeyValuePairs::try_from(vec![(Bytes::from(reward.to_vec()), 0)]).ok();
    let tx = hex::encode(whole.encode_fragment().unwrap());
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx.clone(),
        keys: vec![KeyPath { role: 0, index }],
        inputs,
        partial_sign: false,
        stake_index: index,
    };
    let summary = cip30::inspect_tx(&accounts, &request).unwrap();
    assert_eq!(summary.signs, vec!["0/5".to_string(), "stake".to_string()]);
    assert!(summary.withdrawals[0].own);
    assert!(summary.complete);

    let signed = cip30::sign_tx(&accounts, &request).unwrap();
    let witness_set =
        conway::WitnessSet::decode_fragment(&hex::decode(&signed.witness_set).unwrap()).unwrap();
    let signers: Vec<_> = witness_set
        .vkeywitness
        .unwrap()
        .iter()
        .map(|w| Hasher::<224>::hash(&w.vkey.to_vec()))
        .collect();
    assert!(signers.contains(&accounts.key_hash(Role::Staking, index).unwrap()));

    // With the public account's stake index, it's someone else's withdrawal: the session can't sign it all.
    let public = TxRequest {
        stake_index: 0,
        ..request
    };
    let summary = cip30::inspect_tx(&accounts, &public).unwrap();
    assert!(!summary.withdrawals[0].own);
    assert!(!summary.complete);
}

/// Minswap's aggregator's real preprod swap (`fixtures/minswap-swap-preprod.json`):
/// read, signed, and put back together for Koios with nothing of the
/// builder's changed, the order's datum above all.
#[test]
fn a_real_aggregator_swap_is_read_signed_and_assembled_byte_for_byte() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/minswap-swap-preprod.json")).unwrap();
    let tx_cbor = fixture["cbor"].as_str().unwrap();
    let input: KoiosRow = serde_json::from_value(fixture["input"].clone()).unwrap();
    // Its sender is the public account's 0/0 of the same phrase.
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let request = TxRequest {
        network: "preprod".into(),
        tx_cbor: tx_cbor.into(),
        keys: vec![KeyPath { role: 0, index: 0 }],
        inputs: vec![input],
        partial_sign: false,
        stake_index: 0,
    };
    let summary = cip30::inspect_tx(&public, &request).unwrap();
    assert!(summary.complete);
    assert_eq!(summary.own_inputs, 1);
    assert_eq!(summary.paid.len(), 1, "the order");
    assert!(summary.paid[0].script);
    assert_eq!(summary.paid[0].lovelace, "14000000");
    assert_eq!(summary.paid[0].datum.as_deref(), Some("hash"));
    assert!(!summary.scripts, "placing an order runs no script");
    assert!(summary.collateral.is_none());
    assert_eq!(
        summary.note.as_ref().unwrap()[0],
        "Minswap: Aggregator Market Order"
    );
    assert_eq!(summary.signs, vec!["0/0".to_string()]);

    let signed = cip30::sign_tx(&public, &request).unwrap();
    let whole = cip30::attach_witnesses(tx_cbor, &signed.witness_set).unwrap();
    let before_bytes = hex::decode(tx_cbor).unwrap();
    let before = MultiEraTx::decode(&before_bytes).unwrap();
    let after_bytes = hex::decode(&whole).unwrap();
    let after = MultiEraTx::decode(&after_bytes).unwrap();
    assert_eq!(after.hash(), before.hash(), "the body is untouched");

    // The builder's datum is kept byte for byte, so it still hashes to the order's datum hash.
    let datum_bytes = |tx: &MultiEraTx| -> Vec<Vec<u8>> {
        tx.plutus_data()
            .iter()
            .map(|d| d.raw_cbor().to_vec())
            .collect()
    };
    assert_eq!(datum_bytes(&after), datum_bytes(&before));
    assert_eq!(datum_bytes(&after).len(), 1);
    let order_hash = match before.outputs()[0].datum().unwrap() {
        conway::PseudoDatumOption::Hash(h) => h,
        _ => panic!("the order names its datum by hash"),
    };
    assert_eq!(Hasher::<256>::hash(&datum_bytes(&after)[0]), order_hash);

    let witnesses = after.vkey_witnesses();
    assert_eq!(witnesses.len(), 1);
    let key: [u8; 32] = witnesses[0].vkey.to_vec().try_into().unwrap();
    let sig: [u8; 64] = witnesses[0].signature.to_vec().try_into().unwrap();
    assert!(PublicKey::from(key).verify(after.hash(), &Signature::from(sig)));
    assert_eq!(
        Hasher::<224>::hash(&key),
        public.key_hash(Role::Receive, 0).unwrap()
    );

    // Adding the same signature again changes nothing.
    assert_eq!(
        cip30::attach_witnesses(&whole, &signed.witness_set).unwrap(),
        whole
    );
    // The metadata and the validity flag come through too.
    assert_eq!(
        after.metadata().find(674).is_some(),
        before.metadata().find(674).is_some()
    );
    assert!(
        cip30::attach_witnesses(tx_cbor, "a0").is_err(),
        "nothing to add"
    );
}

/// Writes the extension's fixture for a session's swap (`extension/tests/
/// fixtures/session-swap.json`): session 0's address and key hash, its UTxO,
/// and an unsigned swap from it, as Minswap's aggregator shapes one. Run with
/// `cargo test -p seedelf-wasm --test session_test -- --ignored`.
#[test]
#[ignore]
fn record_the_extensions_session_swap_fixture() {
    let accounts = accounts();
    let (tx, inputs) = swap_tx(0);
    let fixture = json!({
        "about": "Generated by wasm/tests/session_test.rs (record_the_extensions_session_swap_fixture): session 0 of the all-abandon 12-word phrase, its one UTxO, and an unsigned swap from it shaped like Minswap's aggregator's (an order with a datum hash, the change back).",
        "address": session(0).to_bech32().unwrap(),
        "keyHash": hex::encode(accounts.key_hash(Role::Receive, 0).unwrap()),
        "utxo": {
            "tx_hash": inputs[0].tx_hash,
            "tx_index": inputs[0].tx_index,
            "address": inputs[0].address,
            "value": inputs[0].value,
        },
        "swapCbor": tx,
    });
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../extension/tests/fixtures/session-swap.json"
    );
    std::fs::write(path, serde_json::to_string_pretty(&fixture).unwrap() + "\n").unwrap();
}
