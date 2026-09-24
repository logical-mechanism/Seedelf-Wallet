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
        let err = |r: anyhow::Result<api::SpendDraft>| r.unwrap_err().to_string();

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
    use seedelf_wasm::api::{self, TokenAmount, TransferRequest};
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
            to: r["to"].as_str().unwrap().into(),
            recipient: serde_json::from_value(r["recipient"].clone()).unwrap(),
            lovelace: r["lovelace"].as_str().unwrap().into(),
            tokens: serde_json::from_value(r["tokens"].clone()).unwrap(),
            seed: None,
            evaluation: None,
        }
    }

    /// The recorded recipient's UTxO, but under `register`.
    fn under(register: &Register) -> UtxoResponse {
        let mut utxo = request().recipient;
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
        assert!(!result.to_self);
        assert_eq!(result.to, final_["to"].as_str().unwrap());
        assert_eq!(result.lovelace, "5000000");
        assert_eq!(
            result.tokens,
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
        let found = register_from_utxo(&request().recipient);
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
        r.recipient = under(&Register::create(bob).unwrap().rerandomize().unwrap());
        let result = finish(sk, r);
        assert!(!result.to_self);
        let paid = &outputs(&result.tx_cbor)[0].0;
        assert!(paid.is_owned(bob).unwrap());
        assert!(!paid.is_owned(sk).unwrap());

        // Your own seedelf: allowed, flagged, and the payment comes back.
        let mine = owned().pop().unwrap();
        let mut r = request();
        r.to = mine.asset_list.as_ref().unwrap()[0].asset_name.clone();
        r.recipient = mine;
        let result = finish(sk, r);
        assert!(result.to_self);
        assert!(outputs(&result.tx_cbor)[0].0.is_owned(sk).unwrap());
    }

    #[test]
    fn refuses_what_would_lose_or_misdirect_money() {
        let sk = seedelf_key_v1(PHRASE, 0).unwrap();
        let err = |r: TransferRequest| api::draft_transfer(sk, r).unwrap_err().to_string();

        // Names: 64 lowercase hex characters starting 5eed0e1f.
        for bad in [
            "5eed0e1f",
            &request().to.to_uppercase(),
            &format!("00{}", &request().to[2..]),
            &format!("{}zz", &request().to[..62]),
        ] {
            let mut r = request();
            r.to = bad.to_string();
            assert!(err(r).contains("64 hex characters"), "{bad}");
        }
        assert!(api::is_seedelf_name(&request().to));

        // The recipient's UTxO must hold that seedelf, in the contract, under a register.
        let mut r = request();
        r.to = format!("{}00", &request().to[..62]);
        assert!(err(r).contains("doesn't hold the seedelf"));
        let mut r = request();
        r.recipient.payment_cred = "00".repeat(28);
        assert!(err(r).contains("isn't in the Seedelf wallet contract"));
        let mut r = request();
        r.recipient.inline_datum = None;
        assert!(err(r).contains("no register"));
        let mut r = request();
        r.recipient = under(&Register::new("00".repeat(48), "00".repeat(48)));
        assert!(err(r).contains("register isn't valid"));
        let identity = format!("c0{}", "00".repeat(47));
        let mut r = request();
        r.recipient = under(&Register::new(
            Register::create(random_scalar()).unwrap().generator,
            identity,
        ));
        assert!(err(r).contains("register isn't valid"));

        // What pays: only this wallet's UTxOs, never one holding a seedelf.
        let mut r = request();
        r.utxos = owned();
        assert!(err(r).contains("holds a seedelf"));
        assert!(
            api::draft_transfer(random_scalar(), request())
                .unwrap_err()
                .to_string()
                .contains("isn't this wallet's")
        );

        // Amounts.
        let mut r = request();
        r.tokens[0].quantity = "0".into();
        assert!(err(r).contains("above zero"));
        let mut r = request();
        r.lovelace = "45000000000000001".into();
        assert!(err(r).contains("45 billion"));
        let mut r = request();
        r.lovelace = "1000000".into();
        assert!(err(r).contains("needs at least"));
        let mut r = request();
        r.tokens[0].quantity = "1234560001".into();
        assert!(err(r).contains("holds only 1234560000"));
        let mut r = request();
        r.lovelace = "30000000".into();
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
            (result.lovelace.as_str(), result.tokens.len()),
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
        assert_eq!(result.lovelace, (28_000_000 - fee).to_string());
        assert_eq!(result.tokens.len(), 1);
        assert_eq!(
            (result.change_lovelace.as_str(), result.change_outputs),
            ("0", 0)
        );
        let outs = outputs(&result.tx_cbor);
        assert!(outs.iter().all(|(a, _)| *a == theirs()));
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
            r.to = to.into();
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
        assert!(err(r).contains("holds a seedelf"));
        assert!(
            api::draft_withdraw(random_scalar(), request("amount"))
                .unwrap_err()
                .to_string()
                .contains("isn't this wallet's")
        );
        let mut r = request("amount");
        r.lovelace = Some("500000".into());
        assert!(err(r).contains("needs at least"));

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
                .contains("exactly one seedelf")
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
            self.lovelace = None;
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
