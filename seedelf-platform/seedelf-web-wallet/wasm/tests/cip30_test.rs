//! The dApp connector's Cardano side (`seedelf_wasm::cip30`): CIP-30's
//! encodings, reading a dApp's transaction for the prompt, signing it, and
//! CIP-8 data signatures, checked against Pallas's own decoders and
//! Ed25519 verification.

use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_codec::utils::{Bytes, CborWrap, NonEmptyKeyValuePairs, NonEmptySet, Nullable, Set};
use pallas_crypto::hash::Hash;
use pallas_crypto::key::ed25519::{PublicKey, Signature};
use pallas_primitives::{Fragment, PlutusData, StakeCredential, TransactionInput, conway};
use seedelf_core::build;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_wasm::cip30::{self, DataRequest, KeyPath, KoiosRow, Token, TxRequest};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const TX_B: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const POLICY: &str = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
/// A register datum: constructor 0 with the G1 generator and the test vector's public value.
const REGISTER_DATUM: &str = "d8799f583097f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb583082dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475ff";

fn account() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, 0).unwrap()
}

fn keys() -> Vec<KeyPath> {
    (0..3)
        .flat_map(|index| [KeyPath { role: 0, index }, KeyPath { role: 1, index }])
        .collect()
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

fn row(
    tx: &str,
    index: u64,
    address: &Address,
    lovelace: u64,
    tokens: &[(&str, &str, u64)],
) -> KoiosRow {
    let assets: Vec<serde_json::Value> = tokens
        .iter()
        .map(|(p, n, q)| serde_json::json!({ "policy_id": p, "asset_name": n, "quantity": q.to_string() }))
        .collect();
    serde_json::from_value(serde_json::json!({
        "tx_hash": tx,
        "tx_index": index,
        "address": address.to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "asset_list": assets,
    }))
    .unwrap()
}

fn input(tx: &str, index: u64) -> TransactionInput {
    TransactionInput {
        transaction_id: Hash::new(hex::decode(tx).unwrap().try_into().unwrap()),
        index,
    }
}

fn out(address: &Address, lovelace: u64, datum: Option<&str>) -> conway::TransactionOutput {
    conway::PseudoTransactionOutput::PostAlonzo(conway::PostAlonzoTransactionOutput {
        address: Bytes::from(address.to_vec()),
        value: conway::Value::Coin(lovelace),
        datum_option: datum.map(|d| {
            conway::PseudoDatumOption::Data(CborWrap(
                PlutusData::decode_fragment(&hex::decode(d).unwrap()).unwrap(),
            ))
        }),
        script_ref: None,
    })
}

fn body(
    inputs: Vec<TransactionInput>,
    outputs: Vec<conway::TransactionOutput>,
) -> conway::TransactionBody {
    conway::TransactionBody {
        inputs: Set::from(inputs),
        outputs,
        fee: 200_000,
        ttl: Some(99_999_999),
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
    }
}

fn tx_hex(body: conway::TransactionBody) -> String {
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
    hex::encode(tx.encode_fragment().unwrap())
}

fn request(tx: String, inputs: Vec<KoiosRow>, partial_sign: bool) -> TxRequest {
    TxRequest {
        network: "preprod".into(),
        tx_cbor: tx,
        keys: keys(),
        inputs,
        partial_sign,
        stake_index: 0,
    }
}

fn stake_credential() -> StakeCredential {
    StakeCredential::AddrKeyhash(account().key_hash(Role::Staking, 0).unwrap())
}

fn stake_account_bytes() -> Vec<u8> {
    account().stake_address(true).unwrap().to_vec()
}

// --- Encodings --------------------------------------------------------------

#[test]
fn a_utxo_decodes_as_the_ledger_writes_it() {
    let address = ours(Role::Receive, 0);
    let utxo = row(TX_A, 3, &address, 7_000_000, &[(POLICY, "74657374", 5)]);
    let bytes = cip30::utxo_cbor(&utxo).unwrap();

    let mut d = minicbor::Decoder::new(&bytes);
    assert_eq!(d.array().unwrap(), Some(2));
    let decoded: TransactionInput = d.decode().unwrap();
    assert_eq!(decoded, input(TX_A, 3));
    let output: conway::TransactionOutput = d.decode().unwrap();
    let conway::PseudoTransactionOutput::Legacy(legacy) = output else {
        panic!("a UTxO without a datum is written in the legacy form");
    };
    assert_eq!(legacy.address.to_vec(), address.to_vec());
    let pallas_primitives::alonzo::Value::Multiasset(coin, assets) = legacy.amount else {
        panic!("tokens are written");
    };
    assert_eq!(coin, 7_000_000);
    assert_eq!(hex::encode(assets[0].0.as_ref()), POLICY);
    assert_eq!(assets[0].1[0].1, 5);
}

#[test]
fn a_utxo_with_an_inline_datum_keeps_it() {
    let mut utxo = row(TX_A, 0, &ours(Role::Receive, 0), 2_000_000, &[]);
    utxo.inline_datum = Some(cip30::InlineDatum {
        bytes: REGISTER_DATUM.into(),
    });
    let bytes = cip30::utxo_cbor(&utxo).unwrap();
    let mut d = minicbor::Decoder::new(&bytes);
    d.array().unwrap();
    d.skip().unwrap();
    let output: conway::TransactionOutput = d.decode().unwrap();
    let conway::PseudoTransactionOutput::PostAlonzo(o) = output else {
        panic!("an inline datum needs the map form");
    };
    let Some(conway::PseudoDatumOption::Data(CborWrap(datum))) = o.datum_option else {
        panic!("the datum is inline");
    };
    assert_eq!(
        hex::encode(datum.encode_fragment().unwrap()),
        REGISTER_DATUM
    );
}

#[test]
fn a_balance_is_a_value_and_reads_back() {
    assert_eq!(
        hex::encode(cip30::value_cbor("5000000", &[]).unwrap()),
        "1a004c4b40"
    );
    let tokens = vec![
        Token {
            policy_id: POLICY.into(),
            asset_name: "74657374".into(),
            quantity: "5".into(),
        },
        Token {
            policy_id: POLICY.into(),
            asset_name: "61".into(),
            quantity: "1".into(),
        },
    ];
    let bytes = cip30::value_cbor("3000000", &tokens).unwrap();
    let value: conway::Value = minicbor::decode(&bytes).unwrap();
    assert!(matches!(value, conway::Value::Multiasset(3_000_000, _)));
    let (lovelace, back) = cip30::read_value(&hex::encode(&bytes)).unwrap();
    assert_eq!(lovelace, 3_000_000);
    // Canonical order: the shorter name first.
    assert_eq!(back[0].asset_name, "61");
    assert_eq!(back[1], tokens[0]);
    assert_eq!(
        cip30::read_value("1a004c4b40").unwrap(),
        (5_000_000, vec![])
    );
    assert!(cip30::read_value("zz").is_err());
}

#[test]
fn an_address_is_its_bytes() {
    let address = ours(Role::Receive, 0);
    assert_eq!(
        cip30::address_hex(&address.to_bech32().unwrap()).unwrap(),
        address.to_hex()
    );
}

// --- A dApp's transaction ---------------------------------------------------

/// A swap-like transaction: 10 ₳ and 5 tokens in from the account, 4 ₳ to a
/// contract with a datum, the change back to `1/0`.
fn swap() -> (String, Vec<KoiosRow>) {
    let script = seedelf_core::address::wallet_contract(true, [0x94; 28]);
    let tx = tx_hex(body(
        vec![input(TX_A, 0), input(TX_A, 1)],
        vec![
            out(&script, 4_000_000, Some("d87980")),
            out(&ours(Role::Change, 0), 5_800_000, None),
        ],
    ));
    let rows = vec![
        row(
            TX_A,
            0,
            &ours(Role::Receive, 0),
            6_000_000,
            &[(POLICY, "74657374", 5)],
        ),
        row(TX_A, 1, &ours(Role::Receive, 2), 4_000_000, &[]),
    ];
    (tx, rows)
}

#[test]
fn a_transaction_shows_what_leaves_the_account() {
    let (tx, rows) = swap();
    let summary = cip30::inspect_tx(&account(), &request(tx.clone(), rows, false)).unwrap();
    assert_eq!(
        summary.tx_hash,
        hex::encode(build::tx_id(&hex::decode(&tx).unwrap()).unwrap())
    );
    assert_eq!(summary.fee, "200000");
    assert_eq!(summary.spent_lovelace, "10000000");
    assert_eq!(summary.returned_lovelace, "5800000");
    assert_eq!(summary.net_lovelace, "-4200000");
    assert_eq!(summary.net_tokens.len(), 1);
    assert_eq!(summary.net_tokens[0].quantity, "-5");
    assert_eq!(summary.own_inputs, 2);
    assert_eq!(summary.paid.len(), 1);
    assert!(summary.paid[0].script);
    assert_eq!(summary.paid[0].datum.as_deref(), Some("inline"));
    assert_eq!(summary.paid[0].seedelf, None, "another script");
    assert_eq!(summary.own_outputs.len(), 1);
    assert_eq!(
        (summary.own_outputs[0].role, summary.own_outputs[0].index),
        (1, 0)
    );
    assert_eq!(summary.signs, vec!["0/0", "0/2"]);
    assert!(summary.complete);
    assert_eq!(summary.valid_until, Some(99_999_999));
}

#[test]
fn signing_gives_only_the_accounts_witnesses_over_the_transaction() {
    let (tx, rows) = swap();
    let signed = cip30::sign_tx(&account(), &request(tx.clone(), rows, false)).unwrap();
    let hash = build::tx_id(&hex::decode(&tx).unwrap()).unwrap();
    let set: conway::WitnessSet =
        minicbor::decode(&hex::decode(&signed.witness_set).unwrap()).unwrap();
    let vkeys = set.vkeywitness.unwrap().to_vec();
    assert_eq!(vkeys.len(), 2);
    let expected = [
        account().key_hash(Role::Receive, 0).unwrap(),
        account().key_hash(Role::Receive, 2).unwrap(),
    ];
    for w in &vkeys {
        let key = PublicKey::from(<[u8; 32]>::try_from(w.vkey.to_vec()).unwrap());
        let signature = Signature::from(<[u8; 64]>::try_from(w.signature.to_vec()).unwrap());
        assert!(key.verify(hash, &signature));
        assert!(expected.contains(&pallas_crypto::hash::Hasher::<224>::hash(key.as_ref())));
    }
    assert!(set.native_script.is_none() && set.redeemer.is_none());
    // Pallas writes sets tagged (#6.258), and the witnesses follow.
    assert_eq!(
        &hex::decode(&signed.witness_set).unwrap()[..5],
        &[0xa1, 0x00, 0xd9, 0x01, 0x02]
    );

    // A transaction with untagged sets gets untagged witnesses.
    assert_eq!(&tx[4..12], "00d90102", "the inputs, tagged");
    let untagged = format!("{}{}", &tx[..6], &tx[12..]);
    let (_, rows) = swap();
    let signed = cip30::sign_tx(&account(), &request(untagged, rows, false)).unwrap();
    assert_eq!(
        &hex::decode(&signed.witness_set).unwrap()[..3],
        &[0xa1, 0x00, 0x82]
    );
}

#[test]
fn someone_elses_input_needs_partial_signing() {
    let (_, mut rows) = swap();
    let tx = tx_hex(body(
        vec![input(TX_A, 0), input(TX_B, 0)],
        vec![out(&theirs(), 8_000_000, None)],
    ));
    rows.push(row(TX_B, 0, &theirs(), 5_000_000, &[]));
    let summary = cip30::inspect_tx(&account(), &request(tx.clone(), rows.clone(), false)).unwrap();
    assert!(!summary.complete);
    assert_eq!(summary.others_sign, 1);
    let refused =
        cip30::sign_tx(&account(), &request(tx.clone(), rows.clone(), false)).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("signatures the wallet can't give")
    );

    let signed = cip30::sign_tx(&account(), &request(tx, rows, true)).unwrap();
    assert_eq!(signed.summary.signs, vec!["0/0"]);
}

#[test]
fn an_input_the_wallet_cant_find_is_unknown() {
    let (_, rows) = swap();
    let tx = tx_hex(body(
        vec![input(TX_A, 0), input(TX_B, 7)],
        vec![out(&theirs(), 1_000_000, None)],
    ));
    let summary = cip30::inspect_tx(&account(), &request(tx, rows, false)).unwrap();
    assert_eq!(summary.unknown_inputs, vec![format!("{TX_B}#7")]);
    assert!(!summary.complete);
}

#[test]
fn a_script_input_needs_no_key() {
    let (_, mut rows) = swap();
    let script = seedelf_core::address::wallet_contract(true, [0x94; 28]);
    rows.push(row(TX_B, 1, &script, 3_000_000, &[]));
    let tx = tx_hex(body(
        vec![input(TX_A, 1), input(TX_B, 1)],
        vec![out(&ours(Role::Receive, 0), 6_800_000, None)],
    ));
    let summary = cip30::inspect_tx(&account(), &request(tx, rows, false)).unwrap();
    assert!(summary.complete);
    assert_eq!(summary.signs, vec!["0/2"]);
    assert_eq!(summary.net_lovelace, "2800000");
}

#[test]
fn staking_and_required_signers_sign_with_the_right_keys() {
    let (_, rows) = swap();
    let mut b = body(
        vec![input(TX_A, 1)],
        vec![out(&ours(Role::Receive, 0), 3_000_000, None)],
    );
    b.certificates = NonEmptySet::try_from(vec![conway::Certificate::StakeDelegation(
        stake_credential(),
        Hash::new([7; 28]),
    )])
    .ok();
    b.withdrawals =
        NonEmptyKeyValuePairs::try_from(vec![(Bytes::from(stake_account_bytes()), 1_000_000)]).ok();
    b.required_signers =
        NonEmptySet::try_from(vec![account().key_hash(Role::Change, 1).unwrap()]).ok();
    let summary = cip30::inspect_tx(&account(), &request(tx_hex(b), rows, false)).unwrap();
    assert_eq!(summary.signs, vec!["0/2", "1/1", "stake"]);
    assert_eq!(summary.certificates.len(), 1);
    assert!(summary.certificates[0].own);
    assert_eq!(summary.certificates[0].kind, "delegate");
    assert!(
        summary.certificates[0]
            .pool
            .as_deref()
            .unwrap()
            .starts_with("pool1")
    );
    assert!(summary.withdrawals[0].own);
    assert!(summary.complete);
}

#[test]
fn a_legacy_registration_needs_no_signature() {
    let (_, rows) = swap();
    let mut b = body(
        vec![input(TX_A, 1)],
        vec![out(&ours(Role::Receive, 0), 1_800_000, None)],
    );
    b.certificates = NonEmptySet::try_from(vec![conway::Certificate::StakeRegistration(
        stake_credential(),
    )])
    .ok();
    let summary = cip30::inspect_tx(&account(), &request(tx_hex(b), rows, false)).unwrap();
    assert_eq!(summary.signs, vec!["0/2"]);
    assert_eq!(summary.certificates[0].kind, "register");
}

#[test]
fn a_collateral_return_to_someone_else_is_refused() {
    let (_, rows) = swap();
    let mut b = body(
        vec![input(TX_A, 0)],
        vec![out(&ours(Role::Receive, 0), 5_000_000, None)],
    );
    b.collateral = NonEmptySet::try_from(vec![input(TX_A, 1)]).ok();
    b.collateral_return = Some(out(&theirs(), 3_700_000, None));
    let refused =
        cip30::inspect_tx(&account(), &request(tx_hex(b.clone()), rows.clone(), true)).unwrap_err();
    assert!(
        refused
            .to_string()
            .contains("collateral would go to someone else")
    );

    b.collateral_return = Some(out(&ours(Role::Receive, 0), 3_700_000, None));
    b.total_collateral = Some(300_000);
    let summary = cip30::inspect_tx(&account(), &request(tx_hex(b), rows, false)).unwrap();
    let collateral = summary.collateral.unwrap();
    assert_eq!(collateral.own, 1);
    assert_eq!(collateral.at_risk, "300000");
    assert_eq!(
        summary.signs,
        vec!["0/0", "0/2"],
        "the collateral's key signs too"
    );
}

#[test]
fn the_other_network_is_refused() {
    let (_, rows) = swap();
    let mainnet = account().base_address(false, Role::Receive, 0).unwrap();
    let tx = tx_hex(body(
        vec![input(TX_A, 1)],
        vec![out(&mainnet, 3_000_000, None)],
    ));
    let refused = cip30::inspect_tx(&account(), &request(tx, rows.clone(), false)).unwrap_err();
    assert!(refused.to_string().contains("mainnet"));

    let mut b = body(vec![input(TX_A, 1)], vec![]);
    b.network_id = Some(pallas_primitives::NetworkId::Mainnet);
    assert!(cip30::inspect_tx(&account(), &request(tx_hex(b), rows, false)).is_err());
}

#[test]
fn a_payment_into_seedelf_says_whether_it_has_a_register() {
    let (_, rows) = swap();
    let contract = seedelf_core::address::wallet_contract(
        true,
        seedelf_core::constants::get_config(1, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let tx = tx_hex(body(
        vec![input(TX_A, 1)],
        vec![
            out(&contract, 2_000_000, Some(REGISTER_DATUM)),
            out(&contract, 1_500_000, None),
        ],
    ));
    let summary = cip30::inspect_tx(&account(), &request(tx, rows, false)).unwrap();
    assert_eq!(summary.paid[0].seedelf.as_deref(), Some("register"));
    assert_eq!(summary.paid[1].seedelf.as_deref(), Some("none"));
}

#[test]
fn nothing_to_sign_is_refused() {
    let (_, mut rows) = swap();
    rows.push(row(TX_B, 0, &theirs(), 5_000_000, &[]));
    let tx = tx_hex(body(
        vec![input(TX_B, 0)],
        vec![out(&theirs(), 4_800_000, None)],
    ));
    let refused = cip30::sign_tx(&account(), &request(tx, rows, true)).unwrap_err();
    assert!(refused.to_string().contains("Nothing in this transaction"));
}

// --- Signing data (CIP-8) ---------------------------------------------------

fn data_request(address: &str) -> DataRequest {
    DataRequest {
        network: "preprod".into(),
        keys: keys(),
        address: address.into(),
        payload: hex::encode("Sign in to example.com: nonce 42"),
        stake_index: 0,
    }
}

/// Checks a COSE_Sign1 the way a verifier does: rebuild the signed
/// structure from its protected header and payload, and verify with the key.
fn verify_cose(signature_hex: &str, key_hex: &str) -> (Vec<u8>, Vec<u8>) {
    let sign1 = hex::decode(signature_hex).unwrap();
    let mut d = minicbor::Decoder::new(&sign1);
    assert_eq!(d.array().unwrap(), Some(4));
    let protected = d.bytes().unwrap().to_vec();
    assert_eq!(d.map().unwrap(), Some(1));
    assert_eq!(d.str().unwrap(), "hashed");
    assert!(!d.bool().unwrap());
    let payload = d.bytes().unwrap().to_vec();
    let signature: [u8; 64] = d.bytes().unwrap().try_into().unwrap();

    let key = hex::decode(key_hex).unwrap();
    let mut k = minicbor::Decoder::new(&key);
    assert_eq!(k.map().unwrap(), Some(4));
    assert_eq!((k.u8().unwrap(), k.u8().unwrap()), (1, 1), "kty OKP");
    assert_eq!((k.u8().unwrap(), k.i8().unwrap()), (3, -8), "alg EdDSA");
    assert_eq!((k.i8().unwrap(), k.u8().unwrap()), (-1, 6), "crv Ed25519");
    assert_eq!(k.i8().unwrap(), -2);
    let x: [u8; 32] = k.bytes().unwrap().try_into().unwrap();

    let mut to_sign = minicbor::Encoder::new(Vec::new());
    to_sign
        .array(4)
        .unwrap()
        .str("Signature1")
        .unwrap()
        .bytes(&protected)
        .unwrap()
        .bytes(&[])
        .unwrap()
        .bytes(&payload)
        .unwrap();
    assert!(PublicKey::from(x).verify(to_sign.into_writer(), &Signature::from(signature)));

    let mut p = minicbor::Decoder::new(&protected);
    assert_eq!(p.map().unwrap(), Some(2));
    assert_eq!((p.u8().unwrap(), p.i8().unwrap()), (1, -8));
    assert_eq!(p.str().unwrap(), "address");
    (p.bytes().unwrap().to_vec(), x.to_vec())
}

#[test]
fn data_is_signed_with_the_addresss_payment_key() {
    let address = ours(Role::Change, 1);
    for form in [address.to_bech32().unwrap(), address.to_hex()] {
        let request = data_request(&form);
        let signer = cip30::data_signer(&account(), &request).unwrap().unwrap();
        assert_eq!(
            (signer.key.as_str(), signer.role, signer.index),
            ("payment", Some(1), Some(1))
        );
        let signed = cip30::sign_data(&account(), &request).unwrap();
        let (header_address, key) = verify_cose(&signed.signature, &signed.key);
        assert_eq!(header_address, address.to_vec());
        assert_eq!(
            pallas_crypto::hash::Hasher::<224>::hash(&key),
            account().key_hash(Role::Change, 1).unwrap()
        );
    }
}

#[test]
fn a_reward_address_signs_with_the_stake_key() {
    let stake = account().stake_address(true).unwrap();
    let request = data_request(&stake.to_bech32().unwrap());
    assert_eq!(
        cip30::data_signer(&account(), &request)
            .unwrap()
            .unwrap()
            .key,
        "stake"
    );
    let signed = cip30::sign_data(&account(), &request).unwrap();
    let (_, key) = verify_cose(&signed.signature, &signed.key);
    assert_eq!(
        pallas_crypto::hash::Hasher::<224>::hash(&key),
        account().key_hash(Role::Staking, 0).unwrap()
    );
}

#[test]
fn someone_elses_address_has_no_signer() {
    let request = data_request(&theirs().to_bech32().unwrap());
    assert!(cip30::data_signer(&account(), &request).unwrap().is_none());
    assert!(cip30::sign_data(&account(), &request).is_err());
    // Our key, the other network.
    let mainnet = account().base_address(false, Role::Receive, 0).unwrap();
    assert!(
        cip30::data_signer(&account(), &data_request(&mainnet.to_bech32().unwrap()))
            .unwrap()
            .is_none()
    );
    assert!(cip30::data_signer(&account(), &data_request("not an address")).is_err());
}
