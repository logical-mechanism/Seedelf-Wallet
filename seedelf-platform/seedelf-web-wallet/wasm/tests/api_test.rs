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
    use seedelf_wasm::api::{self, MoveInRequest, PathedUtxo, TokenRef};
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
    fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
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
        tokens: Vec<TokenRef>,
    ) -> MoveInRequest {
        MoveInRequest {
            network: "preprod".into(),
            params: params(),
            utxos,
            lovelace: lovelace.map(String::from),
            tokens,
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
        let tusdm = TokenRef {
            policy_id: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9".into(),
            asset_name: "0014df10745553444d".into(),
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
        assert_eq!(result.tokens[0].quantity, "3000000000");

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
            err.to_string().contains("is not at the account's address"),
            "{err}"
        );

        let mut staking = account_utxos(&account);
        staking[0].role = 2;
        let err =
            api::move_in(&account, random_scalar(), request(staking, None, vec![])).unwrap_err();
        assert!(
            err.to_string().contains("receive (0) or change (1)"),
            "{err}"
        );
    }
}
