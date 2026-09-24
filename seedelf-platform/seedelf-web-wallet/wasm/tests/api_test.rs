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
        let err = |r: anyhow::Result<api::MintDraft>| r.unwrap_err().to_string();

        // The UTxO holding a seedelf.
        assert!(err(api::draft_mint(sk, request(owned(), ""))).contains("holds a seedelf"));
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
            label: label.into(),
            evaluation,
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
            .contains("is not at the account's address")
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
