use seedelf_crypto::register::Register;
use seedelf_wasm::api;

// Same vector as seedelf-crypto's `random_register` test: sk = 18446744073709551606.
const VECTOR_SK: &str = "000000000000000000000000000000000000000000000000fffffffffffffff6";
const G1: &str = "97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb";
const VECTOR_PUBLIC_VALUE: &str = "82dcf46570656ca0d6fb143b8e7c2816b20cb1a6434ca4c8c95c624443c22c9e1d40ad0df5de088b19a4b44b685b8475";
// The BLS12-381 scalar field order r, big-endian.
const R: &str = "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001";

#[test]
fn scalar_from_hex_matches_known_vector() {
    let sk = api::scalar_from_hex(VECTOR_SK).unwrap();
    let register = Register::create(sk).unwrap();
    assert_eq!(register.generator, G1);
    assert_eq!(register.public_value, VECTOR_PUBLIC_VALUE);
}

#[test]
fn scalar_from_hex_rejects_bad_input() {
    assert!(api::scalar_from_hex(&"00".repeat(32)).is_err(), "zero");
    assert!(api::scalar_from_hex(R).is_err(), "equal to r");
    assert!(api::scalar_from_hex(&"ff".repeat(32)).is_err(), "above r");
    assert!(api::scalar_from_hex(&"01".repeat(31)).is_err(), "31 bytes");
    assert!(api::scalar_from_hex("zz").is_err(), "not hex");
}

#[test]
fn rerandomized_register_stays_owned_and_proves() {
    let sk = api::scalar_from_hex(VECTOR_SK).unwrap();
    let register = api::rerandomize(&Register::create(sk).unwrap()).unwrap();
    assert_ne!(register.generator, G1);
    assert!(register.is_valid().unwrap());
    assert!(register.is_owned(sk).unwrap());

    let vkh = "ab".repeat(28);
    let (z, g_r) =
        seedelf_crypto::schnorr::create_proof(register.clone(), sk, vkh.clone()).unwrap();
    assert!(api::verify_proof(&register, &z, &g_r, &vkh).unwrap());
    assert!(!api::verify_proof(&register, &z, &g_r, &"cd".repeat(28)).unwrap());
}

/// Whether a Seedelf spend built in the wallet declares budgets that cover
/// what its scripts use, as the ledger checks: measured again here, against
/// `rows` (what it spends) and the bundled references.
fn covers(
    tx_cbor: &str,
    rows: &[seedelf_koios::koios::UtxoResponse],
    params: &serde_json::Value,
) -> bool {
    use seedelf_core::eval;
    let bytes = hex::decode(tx_cbor).unwrap();
    let mut known: Vec<eval::Resolved> =
        rows.iter().map(|r| eval::resolve_row(r).unwrap()).collect();
    known.extend(eval::seedelf_references(true).unwrap());
    let cost_model = seedelf_koios::koios::ProtocolParameters::from_koios(params)
        .unwrap()
        .cost_model_v3;
    let answer = eval::evaluate(&bytes, &known, &cost_model, true).unwrap();
    eval::declared_covers(&bytes, &answer).unwrap().is_ok()
}

#[test]
fn with_phrase_rebuilds_the_vault_phrase() {
    let entropy = [0u8; 32];
    let words = api::with_phrase(&entropy, |p| Ok(p.split(' ').count())).unwrap();
    assert_eq!(words, 24);
    assert!(
        api::with_phrase(&[0u8; 24], |_| Ok(())).is_err(),
        "18 words"
    );
    let failed: anyhow::Result<()> = api::with_phrase(&entropy, |_| anyhow::bail!("inner"));
    assert_eq!(failed.unwrap_err().to_string(), "inner");
}

mod move_in {
    use std::collections::BTreeSet;

    use pallas_crypto::key::ed25519::{PublicKey, Signature};
    use pallas_traverse::MultiEraTx;
    use seedelf_crypto::cardano::{CardanoAccount, Role};
    use seedelf_crypto::schnorr::random_scalar;
    use seedelf_koios::koios::UtxoResponse;
    use seedelf_wasm::api::{
        self, MoveInRequest, PathedUtxo, SendPayment, SendRequest, TokenAmount,
    };
    use serde_json::Value;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn params() -> Value {
        let rows: Value = serde_json::from_str(include_str!(
            "../../../seedelf-core/tests/fixtures/epoch_params.json"
        ))
        .unwrap();
        rows[0].clone()
    }

    /// The 12-word phrase's real preprod UTxOs (recorded by the extension's
    /// tests/fixtures/record-koios.mjs), each with its derivation path.
    pub(super) fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
        let doc: Value = serde_json::from_str(include_str!(
            "../../extension/tests/fixtures/koios-preprod.json"
        ))
        .unwrap();
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

    fn request(
        utxos: Vec<PathedUtxo>,
        lovelace: Option<&str>,
        tokens: Vec<TokenAmount>,
    ) -> MoveInRequest {
        MoveInRequest {
            network: "preprod".into(),
            params: params(),
            utxos,
            lovelace: lovelace.map(String::from),
            tokens,
            withdrawal: None,
        }
    }

    #[test]
    fn signs_a_real_account_move_in_with_exactly_the_inputs_keys() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let utxos = account_utxos(&account);
        assert_eq!(
            utxos.len(),
            6,
            "the recorded account has 6 UTxOs at derived addresses"
        );
        let creds: std::collections::HashMap<String, String> = utxos
            .iter()
            .map(|p| {
                (
                    format!("{}#{}", p.utxo.tx_hash, p.utxo.tx_index),
                    p.utxo.payment_cred.clone(),
                )
            })
            .collect();

        let sk = random_scalar();
        // Part of the account's 3,000,000,000 tUSDM; the rest stays with the change.
        let tusdm = TokenAmount {
            policy_id: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9".into(),
            asset_name: "0014df10745553444d".into(),
            quantity: "1000000000".into(),
        };
        let result = api::move_in(
            &account,
            sk,
            request(utxos, Some("25000000"), vec![tusdm.clone()]),
        )
        .unwrap();
        assert_eq!(result.lovelace, "25000000");
        assert_eq!(result.tokens.len(), 1);
        assert_eq!(result.tokens[0].policy_id, tusdm.policy_id);
        assert_eq!(result.tokens[0].quantity, "1000000000");
        // The change: the rest of the tUSDM, and the token that shares its UTxO.
        assert_eq!(result.change_tokens, 2);

        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(hex::encode(*tx.hash()), result.tx_hash);
        assert_eq!(tx.fee().unwrap().to_string(), result.fee);

        // Every witness is a valid signature of this transaction...
        let witnesses = tx.vkey_witnesses();
        let mut signers = BTreeSet::new();
        for w in witnesses.iter() {
            let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
            let sig: [u8; 64] = w.signature.to_vec().try_into().unwrap();
            assert!(
                PublicKey::from(key).verify(tx.hash(), &Signature::from(sig)),
                "signature verifies"
            );
            signers.insert(hex::encode(pallas_crypto::hash::Hasher::<224>::hash(&key)));
        }
        // ...by exactly the payment keys of the spent inputs.
        let spent: BTreeSet<String> = tx
            .inputs()
            .iter()
            .map(|i| creds[&format!("{}#{}", hex::encode(*i.hash()), i.index())].clone())
            .collect();
        assert_eq!(signers, spent);
        assert_eq!(witnesses.len(), spent.len());

        // Only the contract deposits carry a datum (the core tests check the registers).
        let with_datum = tx.outputs().iter().filter_map(|o| o.datum()).count();
        assert_eq!(with_datum, result.deposit_outputs);
    }

    #[test]
    fn refuses_a_utxo_that_is_not_at_its_path() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let mut utxos = account_utxos(&account);
        utxos[0].index += 1;
        let err = api::move_in(
            &account,
            random_scalar(),
            request(utxos, Some("5000000"), vec![]),
        )
        .unwrap_err();
        assert!(
            err.to_string()
                .contains("is not under the account's payment key"),
            "{err}"
        );

        for (amount, reason) in [
            ("45000000000000001", "more than all the ADA there is"),
            (
                "99999999999999999999999999999999999999999",
                "whole number of lovelace",
            ),
            ("12.5", "whole number of lovelace"),
        ] {
            let err = api::move_in(
                &account,
                random_scalar(),
                request(account_utxos(&account), Some(amount), vec![]),
            )
            .unwrap_err();
            assert!(err.to_string().contains(reason), "{amount}: {err}");
        }

        let mut staking = account_utxos(&account);
        staking[0].role = 2;
        let err =
            api::move_in(&account, random_scalar(), request(staking, None, vec![])).unwrap_err();
        assert!(
            err.to_string().contains("receive (0) or change (1)"),
            "{err}"
        );
    }

    /// A UTxO under the account's receive key 0, with `delegation` as its
    /// staking part: an enterprise address (none), or someone else's stake key.
    fn stray(
        account: &CardanoAccount,
        n: u8,
        payment: pallas_addresses::ShelleyPaymentPart,
        delegation: pallas_addresses::ShelleyDelegationPart,
        lovelace: u64,
    ) -> PathedUtxo {
        let address = pallas_addresses::ShelleyAddress::new(
            pallas_addresses::Network::Testnet,
            payment,
            delegation,
        );
        PathedUtxo {
            utxo: UtxoResponse {
                tx_hash: hex::encode([n; 32]),
                tx_index: 0,
                address: pallas_addresses::Address::Shelley(address)
                    .to_bech32()
                    .unwrap(),
                value: lovelace.to_string(),
                payment_cred: hex::encode(account.key_hash(Role::Receive, 0).unwrap()),
                asset_list: Some(vec![]),
                ..Default::default()
            },
            role: 0,
            index: 0,
        }
    }

    #[test]
    fn spends_the_payment_keys_money_whatever_its_staking_part() {
        use pallas_addresses::{ShelleyDelegationPart, ShelleyPaymentPart};
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let key = account.key_hash(Role::Receive, 0).unwrap();
        let theirs = CardanoAccount::from_phrase(PHRASE, 1)
            .unwrap()
            .key_hash(Role::Staking, 0)
            .unwrap();
        let enterprise = stray(
            &account,
            0xe1,
            ShelleyPaymentPart::Key(key),
            ShelleyDelegationPart::Null,
            40_000_000,
        );
        let franken = stray(
            &account,
            0xf1,
            ShelleyPaymentPart::Key(key),
            ShelleyDelegationPart::Key(theirs),
            30_000_000,
        );

        // Both are ours: Max spends them, signed by receive key 0 alone.
        let result = api::move_in(
            &account,
            random_scalar(),
            request(vec![enterprise, franken], None, vec![]),
        )
        .unwrap();
        assert_eq!(result.inputs, 2);
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let witnesses = tx.vkey_witnesses();
        assert_eq!(witnesses.len(), 1);
        let vkey: [u8; 32] = witnesses[0].vkey.to_vec().try_into().unwrap();
        assert_eq!(pallas_crypto::hash::Hasher::<224>::hash(&vkey), key);

        // A script whose hash happens to be our key's is not ours to sign for.
        let script = stray(
            &account,
            0x5c,
            ShelleyPaymentPart::Script(key),
            ShelleyDelegationPart::Null,
            40_000_000,
        );
        let err = api::move_in(
            &account,
            random_scalar(),
            request(vec![script], None, vec![]),
        )
        .unwrap_err();
        assert!(
            err.to_string()
                .contains("is not under the account's payment key"),
            "{err}"
        );
    }

    pub(super) fn tusdm(quantity: &str) -> TokenAmount {
        TokenAmount {
            policy_id: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9".into(),
            asset_name: "0014df10745553444d".into(),
            quantity: quantity.into(),
        }
    }

    #[test]
    fn a_short_move_in_goes_up_to_the_least_the_deposit_needs() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        for asked in ["0", "900000"] {
            let result = api::move_in(
                &account,
                random_scalar(),
                request(account_utxos(&account), Some(asked), vec![tusdm("1")]),
            )
            .unwrap();
            let minimum = result.minimum.clone().unwrap();
            assert_eq!(result.lovelace, minimum, "{asked} goes up to the minimum");
            let minimum: u64 = minimum.parse().unwrap();
            assert!(minimum > 1_000_000 && minimum < 2_000_000, "{minimum}");
        }
        // Max has no minimum to speak of.
        let max = api::move_in(
            &account,
            random_scalar(),
            request(account_utxos(&account), None, vec![]),
        )
        .unwrap();
        assert_eq!(max.minimum, None);
    }

    /// The 15-word vector phrase's receive address: someone else's.
    fn theirs() -> String {
        let doc: Value = serde_json::from_str(include_str!(
            "../../../seedelf-crypto/tests/vectors/cardano_account.json"
        ))
        .unwrap();
        doc["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
            .unwrap()["preprod"]["receive_0"]
            .as_str()
            .unwrap()
            .to_string()
    }

    pub(super) fn send(
        utxos: Vec<PathedUtxo>,
        to: &str,
        lovelace: Option<&str>,
        tokens: Vec<TokenAmount>,
    ) -> SendRequest {
        SendRequest {
            network: "preprod".into(),
            params: params(),
            utxos,
            payments: vec![SendPayment {
                to: to.into(),
                recipient: None,
                lovelace: lovelace.map(String::from),
                tokens,
            }],
            withdrawal: None,
            note: None,
        }
    }

    /// An output's address, lovelace and tokens, `policy.name` → quantity.
    type Paid = (String, u64, Vec<(String, u64)>);

    fn outputs(tx_cbor: &str) -> Vec<Paid> {
        let bytes = hex::decode(tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        tx.outputs()
            .iter()
            .map(|o| {
                let tokens = o
                    .value()
                    .assets()
                    .iter()
                    .flat_map(|p| {
                        p.assets()
                            .iter()
                            .map(|a| {
                                (
                                    format!(
                                        "{}.{}",
                                        hex::encode(*p.policy()),
                                        hex::encode(a.name())
                                    ),
                                    a.output_coin().unwrap(),
                                )
                            })
                            .collect::<Vec<_>>()
                    })
                    .collect();
                (
                    o.address().unwrap().to_bech32().unwrap(),
                    o.value().coin(),
                    tokens,
                )
            })
            .collect()
    }

    #[test]
    fn sends_to_an_address_signed_by_exactly_the_inputs_keys() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let utxos = account_utxos(&account);
        let creds: std::collections::HashMap<String, String> = utxos
            .iter()
            .map(|p| {
                (
                    format!("{}#{}", p.utxo.tx_hash, p.utxo.tx_index),
                    p.utxo.payment_cred.clone(),
                )
            })
            .collect();
        let to = theirs();
        let result = api::account_send(
            &account,
            send(utxos, &to, Some("3000000"), vec![tusdm("1000000000")]),
        )
        .unwrap();
        assert!(!result.max);
        assert_eq!(result.payments.len(), 1);
        assert_eq!(result.payments[0].to, to);
        assert_eq!(result.payments[0].lovelace, "3000000");
        assert_eq!(result.payments[0].tokens, vec![tusdm("1000000000")]);
        assert_eq!(
            result.change_tokens, 2,
            "the rest of the tUSDM, and its neighbour"
        );

        // Exactly the payment to the address, and nothing into the contract.
        let outs = outputs(&result.tx_cbor);
        let paid: Vec<_> = outs.iter().filter(|(a, _, _)| *a == to).collect();
        assert_eq!(paid.len(), 1);
        assert_eq!(paid[0].1, 3_000_000);
        assert_eq!(
            paid[0].2,
            vec![(
                "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d"
                    .to_string(),
                1_000_000_000
            )]
        );
        let home = account
            .base_address(true, Role::Receive, 0)
            .unwrap()
            .to_bech32()
            .unwrap();
        assert!(
            outs.iter().all(|(a, _, _)| *a == to || *a == home),
            "the rest is change to 0/0"
        );

        // Signed by exactly the spent inputs' payment keys, every signature valid.
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(hex::encode(*tx.hash()), result.tx_hash);
        let mut signers = BTreeSet::new();
        for w in tx.vkey_witnesses().iter() {
            let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
            let sig: [u8; 64] = w.signature.to_vec().try_into().unwrap();
            assert!(PublicKey::from(key).verify(tx.hash(), &Signature::from(sig)));
            signers.insert(hex::encode(pallas_crypto::hash::Hasher::<224>::hash(&key)));
        }
        let spent: BTreeSet<String> = tx
            .inputs()
            .iter()
            .map(|i| creds[&format!("{}#{}", hex::encode(*i.hash()), i.index())].clone())
            .collect();
        assert_eq!(signers, spent);

        // Only the tokens: the least ADA they need.
        let result = api::account_send(
            &account,
            send(account_utxos(&account), &to, Some("0"), vec![tusdm("1")]),
        )
        .unwrap();
        let paid = &result.payments[0];
        assert_eq!(Some(paid.lovelace.clone()), paid.minimum);
        let minimum: u64 = paid.lovelace.parse().unwrap();
        assert!(minimum > 1_000_000 && minimum < 2_000_000, "{minimum}");
        let outs = outputs(&result.tx_cbor);
        assert_eq!(outs.iter().find(|(a, _, _)| *a == to).unwrap().1, minimum);

        // Max: everything but the fee and what the change needs.
        let max =
            api::account_send(&account, send(account_utxos(&account), &to, None, vec![])).unwrap();
        assert!(max.max);
        assert_eq!(max.payments[0].minimum, None);
        assert_eq!(max.inputs, 6);
    }

    #[test]
    fn a_note_goes_on_the_send_and_the_keys_sign_it_there() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let to = theirs();
        let mut request = send(account_utxos(&account), &to, Some("3000000"), vec![]);
        request.note = Some("  Invoice 42  ".into());
        let result = api::account_send(&account, request).unwrap();
        assert_eq!(result.note.as_deref(), Some("Invoice 42"));

        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(hex::encode(*tx.hash()), result.tx_hash);
        assert!(tx.metadata().find(674).is_some(), "CIP-20's label");
        assert!(!tx.vkey_witnesses().is_empty());
        for w in tx.vkey_witnesses().iter() {
            let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
            let sig: [u8; 64] = w.signature.to_vec().try_into().unwrap();
            assert!(
                PublicKey::from(key).verify(tx.hash(), &Signature::from(sig)),
                "signed over the hash with the note in it"
            );
        }

        // No note, or only spaces: nothing is added.
        let mut request = send(account_utxos(&account), &to, Some("3000000"), vec![]);
        request.note = Some("   ".into());
        let result = api::account_send(&account, request).unwrap();
        assert_eq!(result.note, None);
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        assert!(
            MultiEraTx::decode(&bytes)
                .unwrap()
                .metadata()
                .find(674)
                .is_none()
        );

        // A note that can't go on a transaction is refused, in words.
        let mut request = send(account_utxos(&account), &to, Some("3000000"), vec![]);
        request.note = Some("x".repeat(65));
        let e = api::account_send(&account, request)
            .err()
            .unwrap()
            .to_string();
        assert_eq!(e, "A note is at most 64 characters, not 65");
    }

    #[test]
    fn sends_to_several_addresses_in_one_payment() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let to = theirs();
        let home = account
            .base_address(true, Role::Receive, 0)
            .unwrap()
            .to_bech32()
            .unwrap();
        let mut request = send(
            account_utxos(&account),
            &to,
            Some("3000000"),
            vec![tusdm("400")],
        );
        request.payments.push(SendPayment {
            to: format!(" {to} "),
            recipient: None,
            lovelace: Some("0".into()),
            tokens: vec![tusdm("600")],
        });
        let result = api::account_send(&account, request).unwrap();
        assert!(!result.max);
        assert_eq!(result.payments.len(), 2);
        assert_eq!(result.payments[1].to, to, "trimmed");
        assert_eq!(
            result.payments[1].lovelace,
            result.payments[1].minimum.clone().unwrap()
        );
        // Both payments, in order, then the change to 0/0.
        let outs = outputs(&result.tx_cbor);
        let tusdm_key =
            "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d";
        assert_eq!(
            outs[0],
            (to.clone(), 3_000_000, vec![(tusdm_key.to_string(), 400)])
        );
        assert_eq!(outs[1].0, to);
        assert_eq!(outs[1].2, vec![(tusdm_key.to_string(), 600)]);
        assert!(outs[2..].iter().all(|(a, _, _)| *a == home));

        // Max is for one recipient; and there's a limit to how many.
        let mut two_max = send(account_utxos(&account), &to, None, vec![]);
        two_max.payments.push(two_max.payments[0].clone());
        let e = api::account_send(&account, two_max)
            .unwrap_err()
            .to_string();
        assert!(e.contains("Max pays a single recipient"), "{e}");
        let mut crowd = send(account_utxos(&account), &to, Some("2000000"), vec![]);
        crowd.payments = vec![crowd.payments[0].clone(); api::MAX_RECIPIENTS + 1];
        let e = api::account_send(&account, crowd).unwrap_err().to_string();
        assert!(e.contains("at most 20 recipients"), "{e}");
        let mut nobody = send(account_utxos(&account), &to, Some("2000000"), vec![]);
        nobody.payments.clear();
        let e = api::account_send(&account, nobody).unwrap_err().to_string();
        assert!(e.contains("someone to pay"), "{e}");
    }

    #[test]
    fn send_refuses_what_would_lose_money() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let err = |to: &str, lovelace: &str| {
            api::account_send(
                &account,
                send(account_utxos(&account), to, Some(lovelace), vec![]),
            )
            .unwrap_err()
            .to_string()
        };
        let contract = {
            let config = seedelf_core::constants::get_config(1, true).unwrap();
            seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash)
                .to_bech32()
                .unwrap()
        };
        let mainnet = account
            .base_address(false, Role::Receive, 0)
            .unwrap()
            .to_bech32()
            .unwrap();
        let stake = account.stake_address(true).unwrap().to_bech32().unwrap();
        for bad in [contract.as_str(), mainnet.as_str(), stake.as_str()] {
            assert!(
                err(bad, "2000000").contains("normal preprod address"),
                "{bad}"
            );
        }
        assert!(err("nope", "2000000").contains("isn't a Cardano address"));
        assert!(err(&theirs(), "999999999999999").contains("for this payment"));

        let mut moved = account_utxos(&account);
        moved[0].index += 1;
        let e = api::account_send(&account, send(moved, &theirs(), Some("2000000"), vec![]))
            .unwrap_err();
        assert!(
            e.to_string()
                .contains("is not under the account's payment key"),
            "{e}"
        );
        let e = api::account_send(
            &account,
            send(
                account_utxos(&account),
                &theirs(),
                Some("2000000"),
                vec![tusdm("0")],
            ),
        )
        .unwrap_err();
        assert!(e.to_string().contains("more than none"), "{e}");
    }
}

mod mint {
    use pallas_crypto::hash::Hasher;
    use pallas_crypto::key::ed25519::{PublicKey, SecretKey, Signature};
    use pallas_traverse::MultiEraTx;
    use pallas_wallet::PrivateKey;
    use rand_core::OsRng;
    use seedelf_core::build;
    use seedelf_core::constants::COLLATERAL_HASH;
    use seedelf_crypto::derivation::seedelf_key_v1;
    use seedelf_crypto::schnorr::random_scalar;
    use seedelf_koios::koios::UtxoResponse;
    use seedelf_wasm::api::{self, MintRequest, OutRef, SignRequest};
    use serde_json::{Value, json};

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn fixture(path: &str) -> Value {
        let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn params() -> Value {
        fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
    }

    /// The 12-word phrase's synthetic contract UTxOs: 25 ADA, 3 ADA with a
    /// token, and one holding a seedelf.
    fn owned() -> Vec<UtxoResponse> {
        serde_json::from_value(
            fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
        )
        .unwrap()
    }

    /// The real preprod mint recorded by record-mint.mjs.
    fn recorded() -> Value {
        fixture("../extension/tests/fixtures/mint-preprod.json")
    }

    fn request(utxos: Vec<UtxoResponse>, label: &str) -> MintRequest {
        MintRequest {
            network: "preprod".into(),
            params: params(),
            utxos,
            label: label.into(),
            seed: None,
            evaluation: None,
        }
    }

    fn spendable() -> Vec<UtxoResponse> {
        owned().into_iter().take(2).collect()
    }

    fn signer_of(sk: blstrs::Scalar, seed: &str) -> pallas_crypto::hash::Hash<28> {
        let seed: [u8; 32] = hex::decode(seed).unwrap().try_into().unwrap();
        Hasher::<224>::hash(api::one_time_key(&sk, &seed).public_key().as_ref())
    }

    fn signers(cbor_hex: &str) -> Vec<String> {
        build::required_signers(&hex::decode(cbor_hex).unwrap())
            .unwrap()
            .iter()
            .map(hex::encode)
            .collect()
    }

    #[test]
    fn builds_a_mint_measured_in_the_wallet_under_a_new_one_time_key() {
        // No draft leaves the wallet: its own evaluator measures the scripts.
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let result = api::build_mint(sk, request(spendable(), "web-wallet")).unwrap();
        let one_time = hex::encode(signer_of(sk, &result.seed));
        assert_eq!(
            signers(&result.tx_cbor),
            vec![one_time, hex::encode(COLLATERAL_HASH)]
        );
        assert!(crate::covers(&result.tx_cbor, &spendable(), &params()));
        // Each build draws a new one-time key.
        let again = api::build_mint(sk, request(spendable(), "web-wallet")).unwrap();
        assert_ne!(again.seed, result.seed);
    }

    #[test]
    fn drafts_and_finishes_a_mint_under_one_one_time_key() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let draft = api::draft_mint(sk, request(spendable(), "web-wallet")).unwrap();
        assert_eq!(draft.seed.len(), 64);
        // The 25 ADA UTxO pays alone: pure ADA, largest first.
        assert_eq!(
            draft.inputs,
            vec![OutRef {
                tx_hash: "a1".repeat(32),
                tx_index: 0
            }]
        );
        let one_time = hex::encode(signer_of(sk, &draft.seed));
        assert_eq!(
            signers(&draft.draft_cbor),
            vec![one_time.clone(), hex::encode(COLLATERAL_HASH)]
        );

        let mut finish = request(spendable(), "web-wallet");
        finish.seed = Some(draft.seed.clone());
        finish.evaluation = Some(recorded()["evaluation"].clone());
        let result = api::finish_mint(sk, finish).unwrap();
        assert_eq!(result.seed, draft.seed);
        assert_eq!(result.inputs, draft.inputs);
        assert_eq!(
            result.token_name,
            format!("5eed0e1f{}00{}", hex::encode("web-wallet"), "a1".repeat(32))[..64]
        );
        assert_eq!(signers(&result.tx_cbor), signers(&draft.draft_cbor));
        let tx = MultiEraTx::decode(&hex::decode(&result.tx_cbor).unwrap())
            .unwrap()
            .hash();
        assert_eq!(hex::encode(tx), result.tx_hash);
        let fee: u64 = result.fee.total.parse().unwrap();
        assert_eq!(fee % 2, 0);
        assert_eq!(
            fee,
            [
                &result.fee.size,
                &result.fee.compute,
                &result.fee.script_reference
            ]
            .iter()
            .map(|p| p.parse::<u64>().unwrap())
            .sum::<u64>()
        );
        assert_eq!(result.change_outputs, 1);
        assert_eq!(
            25_000_000 - result.lovelace.parse::<u64>().unwrap() - fee,
            result.change_lovelace.parse::<u64>().unwrap()
        );

        // Another seed is another one-time key.
        let mut other = request(spendable(), "web-wallet");
        other.seed = Some("11".repeat(32));
        other.evaluation = Some(recorded()["evaluation"].clone());
        let other = api::finish_mint(sk, other).unwrap();
        assert_ne!(signers(&other.tx_cbor)[0], one_time);
    }

    fn finished(sk: blstrs::Scalar) -> api::MintResult {
        let mut finish = request(spendable(), "");
        finish.seed = Some("42".repeat(32));
        finish.evaluation = Some(recorded()["evaluation"].clone());
        api::finish_mint(sk, finish).unwrap()
    }

    /// giveme.my's answer: a witness set whose last 64 bytes are the signature.
    fn witness(key: &PublicKey, signature: &Signature) -> Value {
        json!({"witness": format!("a10081825820{}5840{}", hex::encode(key), hex::encode(signature))})
    }

    #[test]
    fn signs_once_the_collateral_signature_checks_out() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let result = finished(sk);
        let hash: [u8; 32] = hex::decode(&result.tx_hash).unwrap().try_into().unwrap();
        let stand_in = PrivateKey::from(SecretKey::new(OsRng));
        let answer = witness(&stand_in.public_key(), &stand_in.sign(hash));
        let sign = |collateral: Value, seed: &str| SignRequest {
            tx_cbor: result.tx_cbor.clone(),
            seed: seed.into(),
            collateral,
        };

        let signed = api::sign_with_collateral_key(
            sk,
            sign(answer.clone(), &result.seed),
            stand_in.public_key(),
        )
        .unwrap();
        assert_eq!(signed.tx_hash, result.tx_hash);
        let bytes = hex::decode(&signed.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(
            hex::encode(tx.hash()),
            result.tx_hash,
            "the body is untouched"
        );
        let mut keys = Vec::new();
        for w in tx.vkey_witnesses() {
            let key = PublicKey::from(<[u8; 32]>::try_from(w.vkey.to_vec()).unwrap());
            let sig = Signature::from(<[u8; 64]>::try_from(w.signature.to_vec()).unwrap());
            assert!(key.verify(tx.hash(), &sig), "every signature verifies");
            keys.push(hex::encode(Hasher::<224>::hash(key.as_ref())));
        }
        keys.sort();
        let mut want = vec![
            hex::encode(signer_of(sk, &result.seed)),
            hex::encode(Hasher::<224>::hash(stand_in.public_key().as_ref())),
        ];
        want.sort();
        assert_eq!(keys, want, "the one-time key and the collateral key signed");

        // Against giveme.my's real key, that signature is refused.
        let e = api::sign_script_spend(sk, sign(answer.clone(), &result.seed)).unwrap_err();
        assert!(
            e.to_string().contains("doesn't match this transaction"),
            "{e}"
        );
        // giveme.my refusing to sign (its real answer to an unknown input).
        let e = api::sign_script_spend(
            sk,
            sign(recorded()["collateral"]["answer"].clone(), &result.seed),
        )
        .unwrap_err();
        assert!(
            e.to_string().contains("Transaction Fails Validation"),
            "{e}"
        );
        // The wrong seed is the wrong one-time key.
        let e = api::sign_with_collateral_key(
            sk,
            sign(answer.clone(), &"00".repeat(32)),
            stand_in.public_key(),
        )
        .unwrap_err();
        assert!(
            e.to_string()
                .contains("wasn't built with that one-time key"),
            "{e}"
        );
        // So is another wallet's key with the right seed.
        let e = api::sign_with_collateral_key(
            random_scalar(),
            sign(answer, &result.seed),
            stand_in.public_key(),
        )
        .unwrap_err();
        assert!(
            e.to_string()
                .contains("wasn't built with that one-time key"),
            "{e}"
        );
    }

    #[test]
    fn refuses_what_it_must_not_spend_or_write() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let err = |r: anyhow::Result<api::SpendDraft>| r.unwrap_err().to_string();

        // The UTxO holding a seedelf.
        assert!(err(api::draft_mint(sk, request(owned(), ""))).contains("holds a Seedelf"));
        // Someone else's UTxO: real contract UTxOs from preprod.
        let theirs: Vec<UtxoResponse> = serde_json::from_value(
            fixture("../extension/tests/fixtures/koios-preprod.json")["contract_utxos"].clone(),
        )
        .unwrap();
        let mut utxos = spendable();
        utxos.push(theirs[0].clone());
        assert!(err(api::draft_mint(sk, request(utxos, ""))).contains("isn't this wallet's"));
        assert!(
            err(api::draft_mint(random_scalar(), request(spendable(), "")))
                .contains("isn't this wallet's")
        );

        // Labels: at most 15 characters of printable ASCII.
        assert!(api::draft_mint(sk, request(spendable(), "fifteen chars!!")).is_ok());
        assert!(
            err(api::draft_mint(
                sk,
                request(spendable(), "sixteen chars!!!")
            ))
            .contains("at most 15")
        );
        assert!(err(api::draft_mint(sk, request(spendable(), "héllo"))).contains("not 'é'"));
        assert!(err(api::draft_mint(sk, request(spendable(), "tab\there"))).contains("ASCII"));

        let mut r = request(spendable(), "");
        r.network = "testnet".into();
        assert!(err(api::draft_mint(sk, r)).contains("unknown network"));
        assert!(err(api::draft_mint(sk, request(Vec::new(), ""))).contains("Not enough ADA"));

        // Finishing needs the draft's seed and Ogmios's answer, and says why the scripts refused.
        let finish = |seed: Option<&str>, evaluation: Option<Value>| {
            let mut r = request(spendable(), "");
            r.seed = seed.map(String::from);
            r.evaluation = evaluation;
            api::finish_mint(sk, r).unwrap_err().to_string()
        };
        assert!(finish(None, Some(recorded()["evaluation"].clone())).contains("seed"));
        assert!(finish(Some("ab"), Some(recorded()["evaluation"].clone())).contains("32 bytes"));
        assert!(finish(Some(&"ab".repeat(32)), None).contains("evaluation"));
        let failure = fixture("../../seedelf-core/tests/fixtures/ogmios/script_failure.json");
        assert!(finish(Some(&"ab".repeat(32)), Some(failure)).contains("refused this transaction"));
    }

    #[test]
    fn one_time_keys_are_new_per_seed_and_bound_to_the_wallet() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let key = |sk, seed: u8| hex::encode(api::one_time_key(&sk, &[seed; 32]).public_key());
        assert_eq!(key(sk, 1), key(sk, 1));
        assert_ne!(key(sk, 1), key(sk, 2));
        assert_ne!(key(sk, 1), key(random_scalar(), 1));
    }
}

mod account_mint {
    use std::collections::{BTreeSet, HashMap};

    use pallas_crypto::key::ed25519::{PublicKey, Signature};
    use pallas_traverse::MultiEraTx;
    use seedelf_crypto::cardano::{CardanoAccount, Role};
    use seedelf_crypto::derivation::seedelf_key_v1;
    use seedelf_wasm::api::{self, AccountMintRequest, PathedUtxo};
    use serde_json::Value;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn fixture(path: &str) -> Value {
        let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// The 12-word phrase's recorded preprod account UTxOs, each with its path.
    fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
        let doc = fixture("../extension/tests/fixtures/koios-preprod.json");
        let stake = account.stake_address(true).unwrap().to_bech32().unwrap();
        let mut paths = HashMap::new();
        for role in [Role::Receive, Role::Change] {
            for index in 0..20 {
                let addr = account
                    .base_address(true, role, index)
                    .unwrap()
                    .to_bech32()
                    .unwrap();
                paths.insert(addr, (role as u32, index));
            }
        }
        doc["accounts"][&stake]["account_utxos"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| {
                let (role, index) = *paths.get(row["address"].as_str().unwrap())?;
                Some(PathedUtxo {
                    utxo: serde_json::from_value(row.clone()).unwrap(),
                    role,
                    index,
                })
            })
            .collect()
    }

    fn request(
        utxos: Vec<PathedUtxo>,
        label: &str,
        evaluation: Option<Value>,
    ) -> AccountMintRequest {
        AccountMintRequest {
            network: "preprod".into(),
            params: fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone(),
            utxos,
            collateral: None,
            label: label.into(),
            evaluation,
            withdrawal: None,
        }
    }

    fn evaluation() -> Value {
        fixture("../../seedelf-core/tests/fixtures/ogmios/account_mint.json")
    }

    #[test]
    fn signs_an_account_paid_mint_with_exactly_the_keys_it_spends() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let utxos = account_utxos(&account);
        let creds: HashMap<String, String> = utxos
            .iter()
            .map(|p| {
                (
                    format!("{}#{}", p.utxo.tx_hash, p.utxo.tx_index),
                    p.utxo.payment_cred.clone(),
                )
            })
            .collect();

        let draft = api::draft_account_mint(
            &account,
            sk,
            request(account_utxos(&account), "first", None),
        )
        .unwrap();
        let result =
            api::finish_account_mint(&account, sk, request(utxos, "first", Some(evaluation())))
                .unwrap();
        assert_eq!(result.inputs, draft.inputs);
        assert_eq!(result.collateral, draft.collateral);
        assert!(
            result
                .token_name
                .starts_with(&format!("5eed0e1f{}", hex::encode("first")))
        );
        assert_eq!(result.lovelace, "1749860");

        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(hex::encode(*tx.hash()), result.tx_hash);
        assert_eq!(tx.fee().unwrap().to_string(), result.fee.total);

        // Every witness verifies, and they come from exactly the inputs' and the collateral's keys.
        let mut signers = BTreeSet::new();
        for w in tx.vkey_witnesses() {
            let key = PublicKey::from(<[u8; 32]>::try_from(w.vkey.to_vec()).unwrap());
            let sig = Signature::from(<[u8; 64]>::try_from(w.signature.to_vec()).unwrap());
            assert!(key.verify(tx.hash(), &sig), "signature verifies");
            signers.insert(hex::encode(pallas_crypto::hash::Hasher::<224>::hash(
                key.as_ref(),
            )));
        }
        let spent: BTreeSet<String> = tx
            .inputs()
            .iter()
            .chain(tx.collateral().iter())
            .map(|i| creds[&format!("{}#{}", hex::encode(*i.hash()), i.index())].clone())
            .collect();
        assert_eq!(signers, spent);
        assert_eq!(tx.vkey_witnesses().len(), spent.len());
        assert!(tx.required_signers().is_empty());
    }

    #[test]
    fn puts_up_the_collateral_set_aside_and_signs_for_it() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let mut utxos = account_utxos(&account);
        let set_aside = utxos.pop().unwrap();
        let out_ref = |p: &PathedUtxo| (p.utxo.tx_hash.clone(), p.utxo.tx_index);
        let with =
            |utxos: Vec<PathedUtxo>, collateral: PathedUtxo, evaluation| AccountMintRequest {
                collateral: Some(collateral),
                ..request(utxos, "first", evaluation)
            };

        let result = api::finish_account_mint(
            &account,
            sk,
            with(utxos, set_aside.clone(), Some(evaluation())),
        )
        .unwrap();
        let expected = out_ref(&set_aside);
        assert_eq!(
            (
                result.collateral.tx_hash.clone(),
                result.collateral.tx_index
            ),
            expected
        );
        assert!(
            result
                .inputs
                .iter()
                .all(|i| (i.tx_hash.clone(), i.tx_index) != expected)
        );
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let signers: BTreeSet<String> = tx
            .vkey_witnesses()
            .iter()
            .map(|w| hex::encode(pallas_crypto::hash::Hasher::<224>::hash(&w.vkey.to_vec())))
            .collect();
        assert!(
            signers.contains(&set_aside.utxo.payment_cred),
            "the collateral's key signs"
        );

        // A collateral that isn't the account's is refused, like any UTxO.
        let mut moved = set_aside.clone();
        moved.index += 1;
        let e = api::draft_account_mint(&account, sk, with(account_utxos(&account), moved, None))
            .unwrap_err();
        assert!(
            e.to_string()
                .contains("is not under the account's payment key"),
            "{e}"
        );
    }

    #[test]
    fn refuses_what_it_must_not_sign_or_write() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let err = |r: anyhow::Result<api::AccountMintDraft>| r.unwrap_err().to_string();

        let mut moved = account_utxos(&account);
        moved[0].index += 1;
        assert!(
            err(api::draft_account_mint(
                &account,
                sk,
                request(moved, "", None)
            ))
            .contains("is not under the account's payment key")
        );
        assert!(
            err(api::draft_account_mint(
                &account,
                sk,
                request(account_utxos(&account), "sixteen chars!!!", None)
            ))
            .contains("at most 15")
        );
        assert!(
            err(api::draft_account_mint(
                &account,
                sk,
                request(Vec::new(), "", None)
            ))
            .contains("nothing in the Cardano account")
        );
        let e = api::finish_account_mint(&account, sk, request(account_utxos(&account), "", None))
            .unwrap_err();
        assert!(e.to_string().contains("evaluation"));
        let failure = fixture("../../seedelf-core/tests/fixtures/ogmios/script_failure.json");
        let e = api::finish_account_mint(
            &account,
            sk,
            request(account_utxos(&account), "", Some(failure)),
        )
        .unwrap_err();
        assert!(e.to_string().contains("refused this transaction"));
    }
}

mod transfer {
    use pallas_crypto::hash::Hasher;
    use pallas_primitives::alonzo::{Constr, MaybeIndefArray, PlutusData};
    use pallas_primitives::conway::DatumOption;
    use pallas_traverse::MultiEraTx;
    use seedelf_core::build;
    use seedelf_core::constants::COLLATERAL_HASH;
    use seedelf_crypto::derivation::seedelf_key_v1;
    use seedelf_crypto::register::Register;
    use seedelf_crypto::schnorr::random_scalar;
    use seedelf_koios::koios::{InlineDatum, UtxoResponse};
    use seedelf_wasm::api::{self, SeedelfPayment, TokenAmount, TransferRequest};
    use serde_json::{Value, json};

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn fixture(path: &str) -> Value {
        let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn params() -> Value {
        fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
    }

    /// The 12-word phrase's synthetic contract UTxOs: 25 ADA, 3 ADA with
    /// 1,234.56 tUSDM, and one holding its own seedelf.
    fn owned() -> Vec<UtxoResponse> {
        serde_json::from_value(
            fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
        )
        .unwrap()
    }

    fn spendable() -> Vec<UtxoResponse> {
        owned().into_iter().take(2).collect()
    }

    /// A real preprod transfer, recorded by record-transfer.mjs.
    fn recorded() -> Value {
        fixture("../extension/tests/fixtures/transfer-preprod.json")
    }

    /// The recorded request: 5 ADA and 1 tUSDM to a live preprod seedelf.
    fn request() -> TransferRequest {
        let r = recorded();
        TransferRequest {
            network: "preprod".into(),
            params: params(),
            utxos: spendable(),
            payments: vec![SeedelfPayment {
                to: r["to"].as_str().unwrap().into(),
                recipient: serde_json::from_value(r["recipient"].clone()).unwrap(),
                lovelace: r["lovelace"].as_str().unwrap().into(),
                tokens: serde_json::from_value(r["tokens"].clone()).unwrap(),
            }],
            seed: None,
            evaluation: None,
        }
    }

    /// The recorded recipient: a live preprod Seedelf's name, and its UTxO.
    fn their_name() -> String {
        request().payments[0].to.clone()
    }

    fn their_utxo() -> UtxoResponse {
        request().payments[0].recipient.clone()
    }

    /// The recorded recipient's UTxO, but under `register`.
    fn under(register: &Register) -> UtxoResponse {
        let mut utxo = their_utxo();
        utxo.inline_datum = Some(InlineDatum {
            bytes: hex::encode(register.to_vec().unwrap()),
            value: json!({"constructor": 0, "fields": [
                {"bytes": register.generator}, {"bytes": register.public_value}]}),
        });
        utxo
    }

    fn finish(sk: blstrs::Scalar, mut r: TransferRequest) -> api::TransferResult {
        r.seed = Some("42".repeat(32));
        r.evaluation = Some(recorded()["evaluation"].clone());
        api::finish_transfer(sk, r).unwrap()
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

    /// Each output's register, lovelace and token count.
    fn outputs(tx_cbor: &str) -> Vec<(Register, u64, usize)> {
        let bytes = hex::decode(tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        tx.outputs()
            .iter()
            .map(|o| {
                let tokens = o.value().assets().iter().map(|p| p.assets().len()).sum();
                (
                    register_from(o.datum().unwrap().into()),
                    o.value().coin(),
                    tokens,
                )
            })
            .collect()
    }

    #[test]
    fn builds_a_transfer_measured_in_the_wallet_as_the_chain_did() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let result = api::build_transfer(sk, request()).unwrap();
        // The recorded preprod transfer's fee: the wallet's evaluator costs
        // its scripts as the network's did. The scripts see the signers sorted
        // by hash, and the wallet script looks for the one-time key's among
        // them: when that random hash sorts before giveme.my's, as the recorded
        // one didn't, it's found a step sooner and costs a little less.
        let seed: [u8; 32] = hex::decode(&result.seed).unwrap().try_into().unwrap();
        let one_time = Hasher::<224>::hash(api::one_time_key(&sk, &seed).public_key().as_ref());
        let fee: u64 = result.fee.total.parse().unwrap();
        let recorded_fee: u64 = recorded()["final"]["fee"]["total"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        if *one_time > COLLATERAL_HASH {
            assert_eq!(fee, recorded_fee);
        } else {
            assert!(
                fee < recorded_fee && recorded_fee - fee < 1_000,
                "fee {fee}"
            );
        }
        assert!(crate::covers(&result.tx_cbor, &request().utxos, &params()));
    }

    #[test]
    fn drafts_and_finishes_a_transfer_to_a_real_seedelf() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let draft = api::draft_transfer(sk, request()).unwrap();
        // The tUSDM UTxO first, then the 25 ADA one, as recorded.
        assert_eq!(
            serde_json::to_value(&draft.inputs).unwrap(),
            recorded()["draft"]["inputs"]
        );
        let seed: [u8; 32] = hex::decode(&draft.seed).unwrap().try_into().unwrap();
        let one_time = Hasher::<224>::hash(api::one_time_key(&sk, &seed).public_key().as_ref());
        let signers: Vec<_> = build::required_signers(&hex::decode(&draft.draft_cbor).unwrap())
            .unwrap()
            .into_iter()
            .map(hex::encode)
            .collect();
        assert_eq!(
            signers,
            vec![hex::encode(one_time), hex::encode(COLLATERAL_HASH)]
        );

        let result = finish(sk, request());
        let final_ = &recorded()["final"];
        assert!(!result.payments[0].to_self);
        assert_eq!(result.payments[0].to, final_["to"].as_str().unwrap());
        assert_eq!(result.payments[0].lovelace, "5000000");
        assert_eq!(
            result.payments[0].tokens,
            vec![TokenAmount {
                policy_id: "c0".repeat(28),
                asset_name: hex::encode("tUSDM"),
                quantity: "1000000".into(),
            }]
        );
        // The same size and budgets as the recorded transaction: the same fee.
        assert_eq!(result.fee.total, final_["fee"]["total"].as_str().unwrap());
        let fee: u64 = result.fee.total.parse().unwrap();
        assert_eq!(
            result.change_lovelace.parse::<u64>().unwrap(),
            28_000_000 - 5_000_000 - fee
        );
        assert_eq!((result.change_tokens, result.change_outputs), (1, 1));

        // The payment is a new copy of the recipient's register, never the one found.
        let found = register_from_utxo(&their_utxo());
        let outs = outputs(&result.tx_cbor);
        assert_eq!(outs.len(), 2);
        let (paid, lovelace, tokens) = &outs[0];
        assert!(build::is_payable(paid));
        assert_ne!(paid, &found);
        assert_ne!(paid.generator, found.generator);
        assert!(!paid.is_owned(sk).unwrap());
        assert_eq!((*lovelace, *tokens), (5_000_000, 1));
        assert!(outs[1].0.is_owned(sk).unwrap(), "the change is ours");
        assert!(!result.tx_cbor.contains(&found.public_value));
    }

    #[test]
    fn a_short_amount_goes_up_to_the_least_the_payment_needs() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        // "0" with a token: only the ADA the token needs.
        for asked in ["0", "1000000"] {
            let mut r = request();
            r.payments[0].lovelace = asked.into();
            let result = finish(sk, r);
            let minimum: u64 = result.payments[0].minimum.parse().unwrap();
            assert!(minimum > 1_000_000 && minimum < 2_000_000, "{minimum}");
            assert_eq!(
                result.payments[0].lovelace, result.payments[0].minimum,
                "{asked} goes up to the minimum"
            );
            assert_eq!(outputs(&result.tx_cbor)[0].1, minimum);
        }
        // More than the minimum is paid as asked.
        let result = finish(sk, request());
        assert_eq!(result.payments[0].lovelace, "5000000");
        assert!(result.payments[0].minimum.parse::<u64>().unwrap() < 5_000_000);
    }

    fn register_from_utxo(utxo: &UtxoResponse) -> Register {
        let fields = &utxo.inline_datum.as_ref().unwrap().value["fields"];
        Register::new(
            fields[0]["bytes"].as_str().unwrap().into(),
            fields[1]["bytes"].as_str().unwrap().into(),
        )
    }

    #[test]
    fn pays_whoever_owns_the_register_and_flags_your_own() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();

        // Someone whose key we know: the payment is theirs, not ours.
        let bob = random_scalar();
        let mut r = request();
        r.payments[0].recipient = under(&Register::create(bob).unwrap().rerandomize().unwrap());
        let result = finish(sk, r);
        assert!(!result.payments[0].to_self);
        let paid = &outputs(&result.tx_cbor)[0].0;
        assert!(paid.is_owned(bob).unwrap());
        assert!(!paid.is_owned(sk).unwrap());

        // Your own seedelf: allowed, flagged, and the payment comes back.
        let mine = owned().pop().unwrap();
        let mut r = request();
        r.payments[0].to = mine.asset_list.as_ref().unwrap()[0].asset_name.clone();
        r.payments[0].recipient = mine;
        let result = finish(sk, r);
        assert!(result.payments[0].to_self);
        assert!(outputs(&result.tx_cbor)[0].0.is_owned(sk).unwrap());
    }

    #[test]
    fn pays_several_seedelfs_in_one_transfer() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let bob = random_scalar();
        let mut r = request();
        let mut second = r.payments[0].clone();
        second.recipient = under(&Register::create(bob).unwrap().rerandomize().unwrap());
        second.lovelace = "2000000".into();
        second.tokens = vec![];
        r.payments.push(second);
        let result = finish(sk, r);
        assert_eq!(result.payments.len(), 2);
        assert_eq!(result.payments[1].lovelace, "2000000");
        assert!(!result.payments[1].to_self);
        // Each Seedelf as asked, in order, under a fresh copy of its register; then our change.
        let outs = outputs(&result.tx_cbor);
        assert_eq!((outs[0].1, outs[0].2), (5_000_000, 1));
        assert_eq!((outs[1].1, outs[1].2), (2_000_000, 0));
        assert!(outs[1].0.is_owned(bob).unwrap());
        assert!(!outs[0].0.is_owned(bob).unwrap() && !outs[0].0.is_owned(sk).unwrap());
        assert!(
            outs[2..].iter().all(|o| o.0.is_owned(sk).unwrap()),
            "the change is ours"
        );

        let mut crowd = request();
        crowd.payments = vec![crowd.payments[0].clone(); api::MAX_RECIPIENTS + 1];
        let e = api::draft_transfer(sk, crowd).unwrap_err().to_string();
        assert!(e.contains("at most 20 recipients"), "{e}");
        let mut none = request();
        none.payments.clear();
        let e = api::draft_transfer(sk, none).unwrap_err().to_string();
        assert!(e.contains("someone to pay"), "{e}");
    }

    #[test]
    fn refuses_what_would_lose_or_misdirect_money() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let err = |r: TransferRequest| api::draft_transfer(sk, r).unwrap_err().to_string();

        // Names: 64 lowercase hex characters starting 5eed0e1f.
        for bad in [
            "5eed0e1f",
            &their_name().to_uppercase(),
            &format!("00{}", &their_name()[2..]),
            &format!("{}zz", &their_name()[..62]),
        ] {
            let mut r = request();
            r.payments[0].to = bad.to_string();
            assert!(err(r).contains("64 hex characters"), "{bad}");
        }
        assert!(api::is_seedelf_name(&their_name()));

        // The recipient's UTxO must hold that seedelf, in the contract, under a register.
        let mut r = request();
        r.payments[0].to = format!("{}00", &their_name()[..62]);
        assert!(err(r).contains("doesn't hold the Seedelf"));
        let mut r = request();
        r.payments[0].recipient.payment_cred = "00".repeat(28);
        assert!(err(r).contains("isn't in the Seedelf Wallet contract"));
        let mut r = request();
        r.payments[0].recipient.inline_datum = None;
        assert!(err(r).contains("no register"));
        let mut r = request();
        r.payments[0].recipient = under(&Register::new("00".repeat(48), "00".repeat(48)));
        assert!(err(r).contains("register isn't valid"));
        let identity = format!("c0{}", "00".repeat(47));
        let mut r = request();
        r.payments[0].recipient = under(&Register::new(
            Register::create(random_scalar()).unwrap().generator,
            identity,
        ));
        assert!(err(r).contains("register isn't valid"));

        // What pays: only this wallet's UTxOs, never one holding a seedelf.
        let mut r = request();
        r.utxos = owned();
        assert!(err(r).contains("holds a Seedelf"));
        assert!(
            api::draft_transfer(random_scalar(), request())
                .unwrap_err()
                .to_string()
                .contains("isn't this wallet's")
        );

        // Amounts.
        let mut r = request();
        r.payments[0].tokens[0].quantity = "0".into();
        assert!(err(r).contains("above zero"));
        let mut r = request();
        r.payments[0].lovelace = "45000000000000001".into();
        assert!(err(r).contains("45 billion"));
        let mut r = request();
        r.payments[0].tokens[0].quantity = "1234560001".into();
        assert!(err(r).contains("holds only 1234560000"));
        let mut r = request();
        r.payments[0].lovelace = "30000000".into();
        assert!(err(r).contains("Not enough ADA"));

        // Finishing needs the draft's seed and Ogmios's answer.
        let mut r = request();
        r.evaluation = Some(recorded()["evaluation"].clone());
        let e = api::finish_transfer(sk, r).unwrap_err().to_string();
        assert!(
            e.contains("finishing a transfer needs the draft's seed"),
            "{e}"
        );
        let mut r = request();
        r.seed = Some("ab".repeat(32));
        let e = api::finish_transfer(sk, r).unwrap_err().to_string();
        assert!(e.contains("evaluation"), "{e}");
    }
    /// The contract outputs of a send from the Cardano account: each one's
    /// register and lovelace. Everything else is change.
    fn contract_outputs(tx_cbor: &str) -> Vec<(Register, u64)> {
        let bytes = hex::decode(tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        tx.outputs()
            .iter()
            .filter_map(|o| Some((register_from(o.datum()?.into()), o.value().coin())))
            .collect()
    }

    #[test]
    fn the_cardano_account_pays_someones_seedelf_under_a_fresh_copy_of_its_register() {
        use super::move_in::{account_utxos, send, tusdm};
        use seedelf_crypto::cardano::{CardanoAccount, Role};

        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let to = their_name();
        let pay = |recipient: Option<UtxoResponse>, to: &str| {
            let mut r = send(
                account_utxos(&account),
                to,
                Some("5000000"),
                vec![tusdm("1")],
            );
            r.payments[0].recipient = recipient;
            api::account_send(&account, r)
        };

        let result = pay(Some(their_utxo()), &to).unwrap();
        assert_eq!(result.payments[0].to, to);
        assert_eq!(result.payments[0].lovelace, "5000000");
        let found = register_from_utxo(&their_utxo());
        let paid = contract_outputs(&result.tx_cbor);
        assert_eq!(paid.len(), 1, "one contract output: the payment");
        assert_eq!(paid[0].1, 5_000_000);
        assert!(build::is_payable(&paid[0].0));
        assert_ne!(
            paid[0].0.generator, found.generator,
            "never the register found"
        );
        assert!(!paid[0].0.is_owned(sk).unwrap(), "not ours");
        assert!(!result.tx_cbor.contains(&found.public_value));
        // Everything else goes back to the account's 0/0, and only its keys sign.
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let home = account.base_address(true, Role::Receive, 0).unwrap();
        assert!(
            tx.outputs()
                .iter()
                .all(|o| o.datum().is_some() || o.address().unwrap() == home)
        );
        assert!(tx.redeemers().is_empty(), "no script runs");

        // Whoever owns the register owns the payment.
        let bob = random_scalar();
        let result = pay(
            Some(under(
                &Register::create(bob).unwrap().rerandomize().unwrap(),
            )),
            &to,
        )
        .unwrap();
        assert!(
            contract_outputs(&result.tx_cbor)[0]
                .0
                .is_owned(bob)
                .unwrap()
        );

        // Only the UTxO holding that seedelf, in the contract, under a safe register.
        let err =
            |recipient: Option<UtxoResponse>, to: &str| pay(recipient, to).unwrap_err().to_string();
        assert!(err(None, &to).contains("needs the contract UTxO"));
        assert!(
            err(Some(their_utxo()), &format!("{}00", &to[..62]))
                .contains("doesn't hold the Seedelf")
        );
        let mut elsewhere = their_utxo();
        elsewhere.payment_cred = "00".repeat(28);
        assert!(err(Some(elsewhere), &to).contains("isn't in the Seedelf Wallet contract"));
        let identity = format!("c0{}", "00".repeat(47));
        let taken = Register::new(
            Register::create(random_scalar()).unwrap().generator,
            identity,
        );
        assert!(err(Some(under(&taken)), &to).contains("register isn't valid"));
        // A name that isn't whole is read as an address.
        assert!(err(Some(their_utxo()), &to[..62]).contains("isn't a Cardano address"));
    }
}

mod withdraw {
    use pallas_traverse::MultiEraTx;
    use seedelf_crypto::cardano::CardanoAccount;
    use seedelf_crypto::derivation::seedelf_key_v1;
    use seedelf_crypto::schnorr::random_scalar;
    use seedelf_koios::koios::UtxoResponse;
    use seedelf_wasm::api::{self, RemoveRequest, WithdrawRequest};
    use serde_json::{Value, json};

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn fixture(path: &str) -> Value {
        let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn params() -> Value {
        fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
    }

    /// Real preprod evaluations, recorded by record-withdraw.mjs.
    fn recorded() -> Value {
        fixture("../extension/tests/fixtures/withdraw-preprod.json")
    }

    fn owned() -> Vec<UtxoResponse> {
        serde_json::from_value(
            fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
        )
        .unwrap()
    }

    /// The 15-word vector phrase's receive address: someone else's.
    fn theirs() -> String {
        fixture("../../seedelf-crypto/tests/vectors/cardano_account.json")["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
            .unwrap()["preprod"]["receive_0"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// A recorded request; the recording leaves out the protocol parameters.
    fn request(which: &str) -> WithdrawRequest {
        let mut r = recorded()[which]["request"].clone();
        r["params"] = params();
        // Recorded paying one address, before a withdrawal could pay several.
        r["payments"] = json!([{"to": r["to"], "lovelace": r["lovelace"], "tokens": r["tokens"]}]);
        serde_json::from_value(r).unwrap()
    }

    fn removal(to: Option<String>) -> RemoveRequest {
        RemoveRequest {
            network: "preprod".into(),
            params: params(),
            utxo: owned().pop().unwrap(),
            to,
            seed: None,
            evaluation: None,
        }
    }

    fn with_evaluation<T>(mut r: T, set: impl FnOnce(&mut T)) -> T {
        set(&mut r);
        r
    }

    /// The wallet contract's own address: a script.
    fn contract() -> String {
        let config = seedelf_core::constants::get_config(1, true).unwrap();
        seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash)
            .to_bech32()
            .unwrap()
    }

    /// The 12-word phrase's mainnet receive address: the wrong network.
    fn mainnet() -> String {
        fixture("../../seedelf-crypto/tests/vectors/cardano_account.json")["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 12)
            .unwrap()["mainnet"]["receive_0"]
            .as_str()
            .unwrap()
            .to_string()
    }

    /// Output addresses and lovelace.
    fn outputs(tx_cbor: &str) -> Vec<(String, u64)> {
        let bytes = hex::decode(tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        tx.outputs()
            .iter()
            .map(|o| (o.address().unwrap().to_bech32().unwrap(), o.value().coin()))
            .collect()
    }

    #[test]
    fn builds_a_withdrawal_and_a_removal_measured_in_the_wallet() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let amount = api::build_withdraw(sk, request("amount")).unwrap();
        assert!(!amount.max);
        assert!(crate::covers(
            &amount.tx_cbor,
            &request("amount").utxos,
            &params()
        ));
        let removed = api::build_remove(sk, removal(Some(theirs()))).unwrap();
        assert!(crate::covers(
            &removed.tx_cbor,
            &[owned().pop().unwrap()],
            &params()
        ));
    }

    #[test]
    fn withdraws_an_amount_or_everything() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let rec = recorded();

        // An amount: exactly that to the address, the rest back to Seedelf.
        let draft = api::draft_withdraw(sk, request("amount")).unwrap();
        assert_eq!(
            serde_json::to_value(&draft.inputs).unwrap(),
            rec["amount"]["draft"]["inputs"]
        );
        let result = api::finish_withdraw(
            sk,
            with_evaluation(request("amount"), |r| {
                r.seed = Some("42".repeat(32));
                r.evaluation = Some(rec["amount"]["evaluation"].clone());
            }),
        )
        .unwrap();
        assert!(!result.max);
        assert_eq!(result.fee.total, rec["amount"]["final"]["fee"]["total"]);
        assert_eq!(
            (
                result.payments[0].lovelace.as_str(),
                result.payments[0].tokens.len()
            ),
            ("5000000", 1)
        );
        assert_eq!(
            (result.change_outputs, result.change_tokens, result.left),
            (1, 1, 0)
        );
        let outs = outputs(&result.tx_cbor);
        assert_eq!(outs[0], (theirs(), 5_000_000));

        // Max: every UTxO and token to the address, nothing back.
        let result = api::finish_withdraw(
            sk,
            with_evaluation(request("max"), |r| {
                r.seed = Some("42".repeat(32));
                r.evaluation = Some(rec["max"]["evaluation"].clone());
            }),
        )
        .unwrap();
        assert!(result.max);
        let fee: u64 = result.fee.total.parse().unwrap();
        assert_eq!(result.payments[0].lovelace, (28_000_000 - fee).to_string());
        assert_eq!(result.payments[0].tokens.len(), 1);
        assert_eq!(
            (result.change_lovelace.as_str(), result.change_outputs),
            ("0", 0)
        );
        let outs = outputs(&result.tx_cbor);
        assert!(outs.iter().all(|(a, _)| *a == theirs()));
    }

    #[test]
    fn withdraws_to_several_addresses_at_once() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let rec = recorded();
        let mut r = request("amount");
        let mut second = r.payments[0].clone();
        second.lovelace = Some("2000000".into());
        second.tokens = vec![];
        r.payments.push(second);
        let result = api::finish_withdraw(
            sk,
            with_evaluation(r, |r| {
                r.seed = Some("42".repeat(32));
                r.evaluation = Some(rec["amount"]["evaluation"].clone());
            }),
        )
        .unwrap();
        assert!(!result.max);
        assert_eq!(result.payments.len(), 2);
        assert_eq!(result.payments[1].lovelace, "2000000");
        let outs = outputs(&result.tx_cbor);
        assert_eq!(outs[0], (theirs(), 5_000_000));
        assert_eq!(outs[1], (theirs(), 2_000_000));
        assert!(
            outs[2..].iter().all(|(a, _)| *a == contract()),
            "the change goes back in"
        );

        // Max is for one address.
        let mut two = request("max");
        two.payments.push(two.payments[0].clone());
        let e = api::draft_withdraw(sk, two).unwrap_err().to_string();
        assert!(e.contains("Max pays a single recipient"), "{e}");
    }

    #[test]
    fn a_short_amount_goes_up_to_the_least_the_payment_needs() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let rec = recorded();
        let finish = |lovelace: &str| {
            api::finish_withdraw(
                sk,
                with_evaluation(request("amount"), |r| {
                    r.payments[0].lovelace = Some(lovelace.into());
                    r.seed = Some("42".repeat(32));
                    r.evaluation = Some(rec["amount"]["evaluation"].clone());
                }),
            )
            .unwrap()
        };
        for asked in ["0", "500000"] {
            let result = finish(asked);
            let minimum = result.payments[0].minimum.clone().unwrap();
            assert_eq!(
                result.payments[0].lovelace, minimum,
                "{asked} goes up to the minimum"
            );
            let minimum: u64 = minimum.parse().unwrap();
            assert!(minimum > 1_000_000 && minimum < 2_000_000, "{minimum}");
            assert_eq!(outputs(&result.tx_cbor)[0], (theirs(), minimum));
        }
        let result = finish("5000000");
        assert_eq!(result.payments[0].lovelace, "5000000");

        // Max has no minimum to speak of.
        let max = api::finish_withdraw(
            sk,
            with_evaluation(request("max"), |r| {
                r.seed = Some("42".repeat(32));
                r.evaluation = Some(rec["max"]["evaluation"].clone());
            }),
        )
        .unwrap();
        assert_eq!(max.payments[0].minimum, None);
    }

    #[test]
    fn max_takes_the_twenty_largest_and_says_what_is_left() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let base = owned().into_iter().next().unwrap();
        let utxos: Vec<UtxoResponse> = (0..25u64)
            .map(|i| UtxoResponse {
                tx_hash: format!("{:064x}", i + 1),
                value: (2_000_000 + i * 100_000).to_string(),
                ..base.clone()
            })
            .collect();
        let spends: Vec<Value> = (0..20)
            .map(|i| json!({"validator": {"index": i, "purpose": "spend"}, "budget": {"memory": 76_043, "cpu": 337_845_799}}))
            .collect();
        let mut r = request("max");
        r.utxos = utxos;
        r.seed = Some("42".repeat(32));
        r.evaluation = Some(json!({"result": spends}));
        let result = api::finish_withdraw(sk, r).unwrap();
        assert_eq!((result.inputs.len(), result.left), (20, 5));
        // The largest 20: every value from 2.5 ADA up.
        let smallest = (0..5u64)
            .map(|i| format!("{:064x}", i + 1))
            .collect::<Vec<_>>();
        assert!(result.inputs.iter().all(|i| !smallest.contains(&i.tx_hash)));
    }

    #[test]
    fn removes_its_own_seedelf_to_an_address_or_back_to_seedelf() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let rec = recorded();
        let finish = |to: Option<String>| {
            let mut r = removal(to);
            r.seed = Some("42".repeat(32));
            r.evaluation = Some(rec["remove"]["evaluation"].clone());
            api::finish_remove(sk, r).unwrap()
        };

        let result = finish(Some(theirs()));
        assert_eq!(result.fee.total, rec["remove"]["final"]["fee"]["total"]);
        assert!(
            result
                .name
                .starts_with(&format!("5eed0e1f{}", hex::encode("web-wallet")))
        );
        let fee: u64 = result.fee.total.parse().unwrap();
        assert_eq!(result.lovelace, (1_500_000 - fee).to_string());
        assert_eq!(outputs(&result.tx_cbor), vec![(theirs(), 1_500_000 - fee)]);
        let bytes = hex::decode(&result.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let burned: Vec<i64> = tx
            .mints()
            .iter()
            .flat_map(|p| p.assets().into_iter().map(|a| a.mint_coin().unwrap()))
            .collect();
        assert_eq!(burned, vec![-1]);

        // Back into the Seedelf balance: one contract output, under a fresh
        // register. That needs a real seedelf's 1.74986 ADA: the synthetic
        // one's 1.5 less the fee is below a contract output's minimum.
        let e = api::finish_remove(
            sk,
            with_evaluation(removal(None), |r| {
                r.seed = Some("42".repeat(32));
                r.evaluation = Some(rec["remove"]["evaluation"].clone());
            }),
        )
        .unwrap_err();
        assert!(e.to_string().contains("Not enough ADA"), "{e}");
        let finish = |to: Option<String>| {
            let mut r = removal(to);
            r.utxo.value = "1749860".into();
            r.seed = Some("42".repeat(32));
            r.evaluation = Some(rec["remove"]["evaluation"].clone());
            api::finish_remove(sk, r).unwrap()
        };
        let result = finish(None);
        assert_eq!(result.to, None);
        let outs = outputs(&result.tx_cbor);
        assert_eq!(outs.len(), 1);
        assert!(outs[0].0.starts_with("addr_test1w"), "{}", outs[0].0);
    }

    #[test]
    fn refuses_what_would_lose_or_misdirect_money() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let err = |r: WithdrawRequest| api::draft_withdraw(sk, r).unwrap_err().to_string();
        let to = |to: &str| {
            let mut r = request("amount");
            r.payments[0].to = to.into();
            r
        };

        // Only a normal preprod key address.
        assert!(err(to("nope")).contains("isn't a Cardano address"));
        let stake = "stake_test1urj40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzas324ywz";
        for bad in [contract(), mainnet(), stake.to_string()] {
            let e = err(to(&bad));
            assert!(e.contains("normal preprod address"), "{bad}: {e}");
        }

        // Max takes no token amounts; spends only this wallet's UTxOs, never a seedelf's.
        assert!(err(request("amount").tap_max()).contains("takes no token amounts"));
        let mut r = request("amount");
        r.utxos = owned();
        assert!(err(r).contains("holds a Seedelf"));
        assert!(
            api::draft_withdraw(random_scalar(), request("amount"))
                .unwrap_err()
                .to_string()
                .contains("isn't this wallet's")
        );

        // Removing: only this wallet's seedelf, from a UTxO holding one.
        let theirs: Vec<UtxoResponse> = serde_json::from_value(
            fixture("../extension/tests/fixtures/koios-preprod.json")["contract_utxos"].clone(),
        )
        .unwrap();
        let mut r = removal(None);
        r.utxo = theirs[0].clone();
        assert!(
            api::draft_remove(sk, r)
                .unwrap_err()
                .to_string()
                .contains("isn't this wallet's")
        );
        let mut r = removal(None);
        r.utxo = owned().remove(0);
        assert!(
            api::draft_remove(sk, r)
                .unwrap_err()
                .to_string()
                .contains("exactly one Seedelf")
        );
        let r = removal(Some(contract()));
        assert!(
            api::draft_remove(sk, r)
                .unwrap_err()
                .to_string()
                .contains("normal preprod address")
        );
        let e = api::finish_remove(sk, removal(None))
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("finishing a removal needs the draft's seed"),
            "{e}"
        );
    }

    trait TapMax {
        fn tap_max(self) -> Self;
    }

    impl TapMax for WithdrawRequest {
        /// Max, but with the amount's tokens left in.
        fn tap_max(mut self) -> Self {
            self.payments[0].lovelace = None;
            self
        }
    }

    #[test]
    fn knows_the_accounts_own_addresses() {
        let vectors = fixture("../../seedelf-crypto/tests/vectors/cardano_account.json");
        let v12 = vectors["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 12)
            .unwrap();
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let own = |a: &str| api::is_own_address(&account, a).unwrap();
        assert!(own(v12["preprod"]["receive_0"].as_str().unwrap()));
        assert!(own(v12["mainnet"]["receive_0"].as_str().unwrap()));
        assert!(!own(&theirs()));
        assert!(!own(&contract()));
        assert!(!own("nope"));
    }
}

mod staking {
    use std::collections::{BTreeSet, HashMap};

    use pallas_crypto::hash::Hasher;
    use pallas_crypto::key::ed25519::{PublicKey, Signature};
    use pallas_primitives::conway::{self, Certificate, DRep};
    use pallas_primitives::{Fragment, StakeCredential};
    use pallas_traverse::MultiEraTx;
    use seedelf_crypto::cardano::{CardanoAccount, Role};
    use seedelf_wasm::api::{
        self, PathedUtxo, SendRequest, StakeStateIn, StakingAction, StakingRequest,
    };
    use serde_json::Value;

    const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const LOGIC: &str = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
    const LOGIC_DREP: &str = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

    fn fixture(path: &str) -> Value {
        let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn params() -> Value {
        fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
    }

    /// The 12-word phrase's recorded preprod account UTxOs, each with its path.
    fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
        let doc = fixture("../extension/tests/fixtures/koios-preprod.json");
        let stake = account.stake_address(true).unwrap().to_bech32().unwrap();
        let mut paths = HashMap::new();
        for role in [Role::Receive, Role::Change] {
            for index in 0..20 {
                let addr = account
                    .base_address(true, role, index)
                    .unwrap()
                    .to_bech32()
                    .unwrap();
                paths.insert(addr, (role as u32, index));
            }
        }
        doc["accounts"][&stake]["account_utxos"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|row| {
                let (role, index) = *paths.get(row["address"].as_str().unwrap())?;
                Some(PathedUtxo {
                    utxo: serde_json::from_value(row.clone()).unwrap(),
                    role,
                    index,
                })
            })
            .collect()
    }

    /// The account as Koios's `account_info` recorded it: registered, with
    /// LOGIC, always abstaining, and 57.475311 ADA of rewards.
    fn recorded() -> StakeStateIn {
        let doc = fixture("../extension/tests/fixtures/staking-preprod.json");
        let info = &doc["account_info"][0];
        StakeStateIn {
            registered: info["status"] == "registered",
            deposit: info["deposit"].as_str().unwrap().into(),
            rewards: info["rewards_available"].as_str().unwrap().into(),
            drep: info["delegated_drep"].as_str().map(String::from),
        }
    }

    fn unregistered() -> StakeStateIn {
        StakeStateIn {
            registered: false,
            deposit: "0".into(),
            rewards: "0".into(),
            drep: None,
        }
    }

    fn request(
        account: &CardanoAccount,
        action: StakingAction,
        state: StakeStateIn,
    ) -> StakingRequest {
        StakingRequest {
            network: "preprod".into(),
            params: params(),
            utxos: account_utxos(account),
            action,
            state,
        }
    }

    struct Signed {
        certificates: Vec<Certificate>,
        withdrawals: Vec<(Vec<u8>, u64)>,
        /// Key hashes, hex, of every valid signature.
        signers: BTreeSet<String>,
        /// The spent UTxOs' payment keys, hex.
        payment_keys: BTreeSet<String>,
    }

    /// Decodes a signed transaction and checks each signature is over its id.
    fn signed(account: &CardanoAccount, tx_cbor: &str, tx_hash: &str) -> Signed {
        let bytes = hex::decode(tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        assert_eq!(hex::encode(*tx.hash()), tx_hash);
        let mut signers = BTreeSet::new();
        for w in tx.vkey_witnesses().iter() {
            let key: [u8; 32] = w.vkey.to_vec().try_into().unwrap();
            let sig: [u8; 64] = w.signature.to_vec().try_into().unwrap();
            assert!(
                PublicKey::from(key).verify(tx.hash(), &Signature::from(sig)),
                "a signature over the transaction's own id"
            );
            signers.insert(hex::encode(Hasher::<224>::hash(&key)));
        }
        let creds: HashMap<String, String> = account_utxos(account)
            .into_iter()
            .map(|p| {
                (
                    format!("{}#{}", p.utxo.tx_hash, p.utxo.tx_index),
                    p.utxo.payment_cred,
                )
            })
            .collect();
        let payment_keys = tx
            .inputs()
            .iter()
            .map(|i| creds[&format!("{}#{}", hex::encode(*i.hash()), i.index())].clone())
            .collect();
        let body = conway::Tx::decode_fragment(&bytes)
            .unwrap()
            .transaction_body;
        Signed {
            certificates: body.certificates.map(|c| c.to_vec()).unwrap_or_default(),
            withdrawals: body
                .withdrawals
                .map(|w| w.iter().map(|(a, l)| (a.to_vec(), *l)).collect())
                .unwrap_or_default(),
            signers,
            payment_keys,
        }
    }

    fn stake_key(account: &CardanoAccount) -> String {
        hex::encode(account.key_hash(Role::Staking, 0).unwrap())
    }

    fn cred(account: &CardanoAccount) -> StakeCredential {
        StakeCredential::AddrKeyhash(account.key_hash(Role::Staking, 0).unwrap())
    }

    #[test]
    fn the_first_delegation_registers_and_signs_with_the_stake_key() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let delegate = StakingAction::Delegate {
            pool: format!(" {LOGIC}\n"),
        };
        let result = api::stake(&account, request(&account, delegate, unregistered())).unwrap();
        assert_eq!(result.pool.as_deref(), Some(LOGIC), "the pool, read back");
        assert_eq!(result.drep, None);
        assert_eq!(
            (
                result.deposit.as_str(),
                result.refund.as_str(),
                result.withdrawal.as_str()
            ),
            ("2000000", "0", "0")
        );

        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        let pool = seedelf_core::staking::parse_pool_id(LOGIC).unwrap();
        assert_eq!(
            tx.certificates,
            vec![Certificate::StakeRegDeleg(cred(&account), pool, 2_000_000)]
        );
        // The spent UTxOs' payment keys and the stake key, nobody else.
        let mut expected = tx.payment_keys.clone();
        expected.insert(stake_key(&account));
        assert_eq!(tx.signers, expected);
        // Pure ADA first, largest first: the 3 and a 2 ADA UTxO cover the
        // deposit, the fee and the change.
        assert_eq!(result.inputs, 2);
    }

    #[test]
    fn an_account_mint_spends_the_rewards_and_the_stake_key_signs_for_them() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let sk = seedelf_crypto::derivation::seedelf_key_v1(PHRASE, 0).unwrap();
        let mint = |evaluation: Option<Value>| api::AccountMintRequest {
            network: "preprod".into(),
            params: params(),
            utxos: account_utxos(&account),
            collateral: None,
            label: "rewards".into(),
            withdrawal: Some("57475311".into()),
            evaluation,
        };
        let draft = api::draft_account_mint(&account, sk, mint(None)).unwrap();
        let draft_tx = conway::Tx::decode_fragment(&hex::decode(&draft.draft_cbor).unwrap())
            .unwrap()
            .transaction_body;
        assert!(
            draft_tx.withdrawals.is_some(),
            "Ogmios evaluates the withdrawal too"
        );

        let evaluation = fixture("../../seedelf-core/tests/fixtures/ogmios/account_mint.json");
        let result = api::finish_account_mint(&account, sk, mint(Some(evaluation))).unwrap();
        assert_eq!(result.withdrawal, "57475311");
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        assert!(tx.signers.contains(&stake_key(&account)));
        assert_eq!(tx.withdrawals.len(), 1);
    }

    #[test]
    fn changes_pool_and_delegates_the_vote_without_a_deposit() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let other = "pool1sh4cddrln788xmnjnsqhdwj9e7th3c3ck3zjk7ny9znwj44t8he";
        let result = api::stake(
            &account,
            request(
                &account,
                StakingAction::Delegate { pool: other.into() },
                recorded(),
            ),
        )
        .unwrap();
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        assert!(matches!(
            tx.certificates[..],
            [Certificate::StakeDelegation(..)]
        ));
        assert!(
            tx.withdrawals.is_empty(),
            "a change of pool leaves the rewards"
        );
        assert_eq!(result.deposit, "0");

        // A DRep by its CIP-129 ID: Logical Mechanism's is a script.
        let result = api::stake(
            &account,
            request(
                &account,
                StakingAction::Vote {
                    drep: LOGIC_DREP.into(),
                },
                recorded(),
            ),
        )
        .unwrap();
        assert_eq!(result.drep.as_deref(), Some(LOGIC_DREP));
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        let script = seedelf_core::staking::parse_drep(LOGIC_DREP).unwrap();
        assert!(matches!(script, DRep::Script(_)));
        assert_eq!(
            tx.certificates,
            vec![Certificate::VoteDeleg(cred(&account), script)]
        );
        assert!(tx.signers.contains(&stake_key(&account)));

        // Always abstain, registering first.
        let result = api::stake(
            &account,
            request(
                &account,
                StakingAction::Vote {
                    drep: "drep_always_abstain".into(),
                },
                unregistered(),
            ),
        )
        .unwrap();
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        assert_eq!(
            tx.certificates,
            vec![Certificate::VoteRegDeleg(
                cred(&account),
                DRep::Abstain,
                2_000_000
            )]
        );
    }

    #[test]
    fn withdraws_the_rewards_and_stops_staking() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let reward_account = account.stake_address(true).unwrap().to_vec();

        let result = api::stake(
            &account,
            request(&account, StakingAction::Withdraw, recorded()),
        )
        .unwrap();
        assert_eq!(result.withdrawal, "57475311");
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        assert!(tx.certificates.is_empty());
        assert_eq!(tx.withdrawals, vec![(reward_account.clone(), 57_475_311)]);
        assert!(tx.signers.contains(&stake_key(&account)));

        let result =
            api::stake(&account, request(&account, StakingAction::Stop, recorded())).unwrap();
        assert_eq!(
            (result.refund.as_str(), result.withdrawal.as_str()),
            ("2000000", "57475311")
        );
        let tx = signed(&account, &result.tx_cbor, &result.tx_hash);
        assert_eq!(
            tx.certificates,
            vec![Certificate::UnReg(cred(&account), 2_000_000)]
        );
        assert_eq!(tx.withdrawals, vec![(reward_account, 57_475_311)]);
    }

    #[test]
    fn refuses_what_the_ledger_would() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let err = |action: StakingAction, state: StakeStateIn| {
            api::stake(&account, request(&account, action, state))
                .unwrap_err()
                .to_string()
        };
        let locked = StakeStateIn {
            drep: None,
            ..recorded()
        };
        assert!(err(StakingAction::Withdraw, locked.clone()).contains("voting power"));
        assert!(err(StakingAction::Stop, locked).contains("voting power"));
        assert!(err(StakingAction::Withdraw, unregistered()).contains("no rewards"));
        assert!(err(StakingAction::Stop, unregistered()).contains("isn't staking"));
        assert!(
            err(
                StakingAction::Delegate {
                    pool: LOGIC_DREP.into()
                },
                recorded()
            )
            .contains("stake pool ID")
        );
        assert!(err(StakingAction::Vote { drep: LOGIC.into() }, recorded()).contains("DRep ID"));
        let odd = StakeStateIn {
            rewards: "-1".into(),
            ..recorded()
        };
        assert!(err(StakingAction::Withdraw, odd).contains("whole number"));

        // A UTxO that isn't at its path is refused before anything is signed.
        let mut r = request(&account, StakingAction::Withdraw, recorded());
        r.utxos[0].index += 1;
        assert!(api::stake(&account, r).is_err());
    }

    #[test]
    fn a_send_spends_the_rewards_and_the_stake_key_signs_for_them() {
        let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
        let to = account
            .base_address(true, Role::Receive, 5)
            .unwrap()
            .to_bech32()
            .unwrap();
        let send = |withdrawal: Option<&str>| SendRequest {
            network: "preprod".into(),
            params: params(),
            utxos: account_utxos(&account),
            payments: vec![api::SendPayment {
                to: to.clone(),
                recipient: None,
                lovelace: None,
                tokens: vec![],
            }],
            withdrawal: withdrawal.map(String::from),
            note: None,
        };
        let plain = api::account_send(&account, send(None)).unwrap();
        assert_eq!(plain.withdrawal, "0");
        let tx = signed(&account, &plain.tx_cbor, &plain.tx_hash);
        assert!(
            !tx.signers.contains(&stake_key(&account)),
            "no rewards, no stake key"
        );

        let with = api::account_send(&account, send(Some("57475311"))).unwrap();
        assert_eq!(with.withdrawal, "57475311");
        let tx = signed(&account, &with.tx_cbor, &with.tx_hash);
        assert!(tx.signers.contains(&stake_key(&account)));
        assert_eq!(tx.withdrawals.len(), 1);
        // Max sends the rewards too, less the stake key's witness in the fee.
        let more: u64 = with.payments[0].lovelace.parse::<u64>().unwrap()
            - plain.payments[0].lovelace.parse::<u64>().unwrap();
        let extra_fee: u64 = with.fee.parse::<u64>().unwrap() - plain.fee.parse::<u64>().unwrap();
        assert_eq!(more + extra_fee, 57_475_311);

        // Nothing to withdraw is no withdrawal.
        let none = api::account_send(&account, send(Some("0"))).unwrap();
        assert_eq!(none.withdrawal, "0");
    }

    #[test]
    fn reads_pool_and_drep_ids_the_way_koios_names_them() {
        let hex = "1e3105f23f2ac91b3fb4c35fa4fe301421028e356e114944e902005b";
        assert_eq!(api::pool_id(hex).unwrap(), LOGIC);
        assert_eq!(api::pool_id(LOGIC).unwrap(), LOGIC);
        assert!(api::pool_id("pool1").is_err());
        assert_eq!(api::drep_id(LOGIC_DREP).unwrap(), LOGIC_DREP);
        assert_eq!(
            api::drep_id("drep_always_no_confidence").unwrap(),
            "drep_always_no_confidence"
        );
        assert!(api::drep_id(LOGIC).is_err());
    }
}
