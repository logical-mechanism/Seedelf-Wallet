//! Starting a token pool from the private balance (chunk 34b): one Seedelf
//! spend that mints the pool's NFT, writes its reference UTxO and publishes
//! its two scripts at the holder, and registers `mix_logic`'s credential.
//! Built and measured here against the deployed Seedelf contracts and the
//! generalized Lovejoin scripts; the pool it makes is read back from its own
//! bytes and checked as a stranger's pool would be.

use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::StakeCredential;
use pallas_primitives::conway::Certificate;
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{Chain, FinalSpend, MAX_TX_SIZE};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::lovejoin::{self, BoxToken, Terms, Version, templates};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{self, random_scalar};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

fn chain(network_flag: bool) -> Chain {
    let rows: Value = serde_json::from_str(if network_flag {
        include_str!("fixtures/epoch_params.json")
    } else {
        include_str!("fixtures/epoch_params_mainnet.json")
    })
    .unwrap();
    Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag,
        config: get_config(VARIANT, network_flag).unwrap(),
    }
}

struct World {
    chain: Chain,
    sk: blstrs::Scalar,
    owner: Register,
    signer: Hash<28>,
}

fn world(network_flag: bool) -> World {
    let sk = random_scalar();
    World {
        chain: chain(network_flag),
        sk,
        owner: Register::create(sk).unwrap(),
        signer: Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref()),
    }
}

/// A Seedelf UTxO `w` owns, holding `lovelace` and, if given, a token.
fn owned(w: &World, tx: u8, lovelace: u64, token: Option<(&str, u64)>) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    let wallet = wallet_contract(
        w.chain.network_flag,
        w.chain.config.contract.wallet_contract_hash,
    );
    let assets: Vec<Value> = token
        .map(|(policy, q)| {
            json!({ "policy_id": policy, "asset_name": hex::encode("tok"),
                    "quantity": q.to_string(), "decimals": 0, "fingerprint": "" })
        })
        .into_iter()
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": 1,
        "address": wallet.to_bech32().unwrap(), "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": hex::encode(w.chain.config.contract.wallet_contract_hash),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": {
            "bytes": hex::encode(register.to_vec().unwrap()),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
        "reference_script": null, "asset_list": assets, "is_spent": false,
    }))
    .unwrap()
}

fn terms() -> Terms {
    Terms {
        token: Some(BoxToken {
            policy: [0x1a; 28],
            name: b"NIGHT".to_vec(),
            quantity: 100_000_000,
        }),
        box_lovelace: 4_500_000,
        max_fee: 1_500_000,
    }
}

fn finished(w: &World, launch: &lovejoin::Launch) -> FinalSpend {
    launch
        .spend
        .clone()
        .proven(|register, vkh| schnorr::create_proof(register.clone(), w.sk, vkh.to_string()))
        .unwrap()
        .measure_locally(&[])
        .unwrap()
}

#[test]
fn a_launch_makes_a_pool_the_wallet_trusts() {
    for network_flag in [true, false] {
        let w = world(network_flag);
        let inputs = vec![
            owned(&w, 0x31, 30_000_000, None),
            owned(&w, 0x32, 12_000_000, None),
        ];
        let launch =
            lovejoin::launch(&w.chain, &inputs, &terms(), true, &w.owner, w.signer).unwrap();
        // The seed is the first input given.
        assert_eq!(launch.seed, ([0x31; 32], 1));
        let derived = templates::derive(&launch.seed.0, launch.seed.1).unwrap();
        assert_eq!(launch.derived, derived);

        let done = finished(&w, &launch);
        let tx = &done.tx.tx_bytes.0;
        assert!((tx.len() as u64) < MAX_TX_SIZE);
        let pool = lovejoin::launched_pool(network_flag, tx, launch.seed).unwrap();
        assert_eq!(pool.version, Version::TokenV1);
        assert_eq!(pool.id, derived.policy());
        assert_eq!(pool.mix_logic_hash, derived.mix_logic.hash);
        assert_eq!(pool.denom, 4_500_000);
        assert_eq!(pool.token, terms().token);
        // Both scripts by reference, from the holder, as every later mix reads them.
        assert!(pool.inline_scripts.is_empty());
        assert_eq!(pool.references.len(), 3);
        assert_eq!(pool.seed, Some(launch.seed));

        let decoded = MultiEraTx::decode(tx).unwrap();
        // One certificate: mix_logic's credential, registered.
        let conway = decoded.as_conway().unwrap();
        let certs: Vec<Certificate> = conway
            .transaction_body
            .certificates
            .clone()
            .unwrap()
            .to_vec();
        assert_eq!(
            certs,
            vec![Certificate::StakeRegistration(StakeCredential::ScriptHash(
                Hash::new(derived.mix_logic.hash)
            ))]
        );
        // The NFT, minted once, with one_shot_mint the only script carried.
        assert_eq!(decoded.mints().len(), 1);
        assert_eq!(decoded.plutus_v3_scripts().len(), 1);
        // What goes in comes out, but the fee and the deposit.
        let outputs: u64 = decoded.outputs().iter().map(|o| o.value().coin()).sum();
        assert_eq!(
            42_000_000,
            outputs + done.fee.total + w.chain.params.key_deposit
        );
        assert_eq!(launch.locked.deposit, w.chain.params.key_deposit);
        println!(
            "{}: a launch locks {} lovelace for good (reference {}, mix_box {}, mix_logic {}, deposit {}), costs {} in fees, {} bytes",
            if network_flag { "preprod" } else { "mainnet" },
            launch.locked.total(),
            launch.locked.reference,
            launch.locked.mix_box,
            launch.locked.mix_logic,
            launch.locked.deposit,
            done.fee.total,
            tx.len()
        );
        // About the 23.3 ₳ the plan reckoned.
        assert!((23_000_000..24_000_000).contains(&launch.locked.total()));
    }
}

#[test]
fn a_launch_registers_nothing_when_the_credential_is_already() {
    let w = world(true);
    let inputs = vec![owned(&w, 0x31, 30_000_000, None)];
    let launch = lovejoin::launch(&w.chain, &inputs, &terms(), false, &w.owner, w.signer).unwrap();
    assert_eq!(launch.locked.deposit, 0);
    let done = finished(&w, &launch);
    let decoded = MultiEraTx::decode(&done.tx.tx_bytes.0).unwrap();
    assert!(
        decoded
            .as_conway()
            .unwrap()
            .transaction_body
            .certificates
            .is_none()
    );
    let outputs: u64 = decoded.outputs().iter().map(|o| o.value().coin()).sum();
    assert_eq!(30_000_000, outputs + done.fee.total);
}

#[test]
fn a_launch_refuses_what_isnt_a_pool_to_start() {
    let w = world(true);
    let inputs = vec![owned(&w, 0x31, 30_000_000, None)];
    let refused = |t: Terms| {
        lovejoin::launch(&w.chain, &inputs, &t, true, &w.owner, w.signer)
            .err()
            .unwrap()
            .to_string()
    };
    // A Seedelf's identifier token.
    let seedelf: [u8; 28] = hex::decode(&w.chain.config.contract.seedelf_policy_id)
        .unwrap()
        .try_into()
        .unwrap();
    let mut t = terms();
    t.token.as_mut().unwrap().policy = seedelf;
    assert!(refused(t).contains("identifier"));
    // Terms one_shot_mint would refuse.
    let mut t = terms();
    t.max_fee = t.box_lovelace;
    assert!(refused(t).contains("one_shot_mint"));
    let mut t = terms();
    t.token.as_mut().unwrap().name = vec![0; 33];
    assert!(refused(t).contains("one_shot_mint"));
    // A box too small to come back.
    let mut t = terms();
    t.box_lovelace = 1_700_000;
    t.max_fee = 1_000_000;
    let token = t.token.as_mut().unwrap();
    token.name = vec![0xee; 32];
    token.quantity = u64::MAX;
    let why = refused(t);
    assert!(why.contains("couldn't be used"), "{why}");
    // Inputs holding tokens.
    let with_token = vec![owned(
        &w,
        0x33,
        30_000_000,
        Some((
            "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
            5,
        )),
    )];
    assert!(
        lovejoin::launch(&w.chain, &with_token, &terms(), true, &w.owner, w.signer)
            .err()
            .unwrap()
            .to_string()
            .contains("ADA alone")
    );
    // Too little to pay for it all.
    let poor = vec![owned(&w, 0x34, 20_000_000, None)];
    let launch = lovejoin::launch(&w.chain, &poor, &terms(), true, &w.owner, w.signer).unwrap();
    assert!(
        launch
            .spend
            .proven(|register, vkh| schnorr::create_proof(register.clone(), w.sk, vkh.to_string()))
            .unwrap()
            .measure_locally(&[])
            .is_err()
    );
}

#[test]
fn a_launched_pools_change_goes_back_to_the_seedelf() {
    let w = world(true);
    let inputs = vec![owned(&w, 0x31, 40_000_000, None)];
    let launch = lovejoin::launch(&w.chain, &inputs, &terms(), true, &w.owner, w.signer).unwrap();
    let done = finished(&w, &launch);
    assert!(done.change_lovelace > 0);
    assert!(done.change_tokens.is_empty());
    let decoded = MultiEraTx::decode(&done.tx.tx_bytes.0).unwrap();
    let wallet = wallet_contract(true, w.chain.config.contract.wallet_contract_hash);
    let to_wallet: Vec<_> = decoded
        .outputs()
        .iter()
        .filter(|o| o.address().unwrap() == wallet)
        .map(|o| o.value().coin())
        .collect();
    assert_eq!(to_wallet, vec![done.change_lovelace]);
    // Every other output is at the holder, never to be spent.
    let holder: Address = lovejoin::holder_address(true);
    assert_eq!(
        decoded
            .outputs()
            .iter()
            .filter(|o| o.address().unwrap() == holder)
            .count(),
        3
    );
}

/// An ADA pool's terms: no token, every box `lovelace` of ADA.
fn ada_terms(lovelace: u64) -> Terms {
    Terms {
        token: None,
        box_lovelace: lovelace,
        max_fee: 1_500_000,
    }
}

#[test]
fn an_ada_pool_launches_at_any_amount_but_the_classic_pools() {
    for network_flag in [true, false] {
        let w = world(network_flag);
        let inputs = vec![owned(&w, 0x41, 40_000_000, None)];
        let launch = lovejoin::launch(
            &w.chain,
            &inputs,
            &ada_terms(25_000_000),
            true,
            &w.owner,
            w.signer,
        )
        .unwrap();
        let done = finished(&w, &launch);
        let pool = lovejoin::launched_pool(network_flag, &done.tx.tx_bytes.0, launch.seed).unwrap();
        assert_eq!(pool.version, Version::TokenV1);
        assert_eq!(pool.denom, 25_000_000);
        assert_eq!(pool.token, None);
        assert!(pool.inline_scripts.is_empty());
        // The classic pool's 10 ₳ would be a copy of its value: refused before anything is built.
        let why = lovejoin::launch(
            &w.chain,
            &inputs,
            &ada_terms(10_000_000),
            true,
            &w.owner,
            w.signer,
        )
        .err()
        .unwrap()
        .to_string();
        assert!(why.contains("copy of the classic pool"), "{why}");
    }
}

/// A UTxO at the public account's base address, under payment key `key`.
fn account_row(
    network_flag: bool,
    key: [u8; 28],
    tx: u8,
    lovelace: u64,
    token: Option<(&str, u64)>,
) -> UtxoResponse {
    let mut bytes = vec![if network_flag { 0x00 } else { 0x01 }];
    bytes.extend(key);
    bytes.extend([0x5a; 28]);
    let address = Address::from_bytes(&bytes).unwrap();
    let assets: Vec<Value> = token
        .map(|(policy, q)| {
            json!({ "policy_id": policy, "asset_name": hex::encode("tok"),
                    "quantity": q.to_string(), "decimals": 0, "fingerprint": "" })
        })
        .into_iter()
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": 0,
        "address": address.to_bech32().unwrap(), "value": lovelace.to_string(),
        "stake_address": null, "payment_cred": hex::encode(key),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": null, "reference_script": null, "asset_list": assets, "is_spent": false,
    }))
    .unwrap()
}

#[test]
fn the_public_account_launches_a_pool_the_wallet_trusts() {
    for network_flag in [true, false] {
        let w = world(network_flag);
        let change: Address = account_row(network_flag, [0x0a; 28], 0, 1, None)
            .address
            .parse::<String>()
            .map(|a| Address::from_bech32(&a).unwrap())
            .unwrap();
        let available = vec![
            account_row(network_flag, [0x0a; 28], 0x51, 18_000_000, None),
            account_row(network_flag, [0x0b; 28], 0x52, 14_000_000, None),
            account_row(
                network_flag,
                [0x0a; 28],
                0x53,
                3_000_000,
                Some((
                    "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
                    7,
                )),
            ),
        ];
        let collateral = account_row(network_flag, [0x0a; 28], 0x5c, 5_000_000, None);
        let launch = lovejoin::launch_from_account(
            &w.chain,
            &available,
            Some(&collateral),
            &terms(),
            true,
            &change,
            Some(123_456_789),
        )
        .unwrap();
        // The largest pure ADA UTxO first, and it's the seed; as few as pay.
        assert_eq!(launch.seed, ([0x51; 32], 0));
        assert_eq!(launch.inputs().len(), 2);
        assert_eq!(launch.collateral().tx_hash, collateral.tx_hash);
        let done = launch.measure_locally().unwrap();
        let tx = &done.tx.tx_bytes.0;
        assert!((tx.len() as u64) < MAX_TX_SIZE);
        let pool = lovejoin::launched_pool(network_flag, tx, launch.seed).unwrap();
        assert_eq!(pool.id, launch.derived.policy());
        assert_eq!(pool.token, terms().token);
        assert!(pool.inline_scripts.is_empty());

        let decoded = MultiEraTx::decode(tx).unwrap();
        let conway = decoded.as_conway().unwrap();
        assert_eq!(
            conway
                .transaction_body
                .certificates
                .clone()
                .unwrap()
                .to_vec(),
            vec![Certificate::StakeRegistration(StakeCredential::ScriptHash(
                Hash::new(launch.derived.mix_logic.hash)
            ))]
        );
        assert_eq!(conway.transaction_body.ttl, Some(123_456_789));
        // The holder's three first, in order, then the change, at the account.
        let holder = lovejoin::holder_address(network_flag);
        let outputs = decoded.outputs();
        assert!(outputs[..3].iter().all(|o| o.address().unwrap() == holder));
        assert!(outputs[3..].iter().all(|o| o.address().unwrap() == change));
        assert_eq!(outputs.len(), 4);
        // What goes in comes out, but the fee and the deposit.
        let out: u64 = outputs.iter().map(|o| o.value().coin()).sum();
        assert_eq!(
            32_000_000,
            out + done.fee.total + w.chain.params.key_deposit
        );
        assert_eq!(done.change_lovelace, outputs[3].value().coin());
        assert!(done.change_tokens.is_empty());
        // The one-shot mint is the only script carried, and the collateral is the one set aside.
        assert_eq!(decoded.plutus_v3_scripts().len(), 1);
        assert_eq!(decoded.collateral().len(), 1);
    }
}

#[test]
fn an_account_launch_takes_tokens_only_when_ada_alone_doesnt_pay() {
    let w = world(true);
    let change = Address::from_bech32(&account_row(true, [0x0a; 28], 0, 1, None).address).unwrap();
    let token = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
    let available = vec![
        account_row(true, [0x0a; 28], 0x61, 20_000_000, None),
        account_row(true, [0x0a; 28], 0x62, 9_000_000, Some((token, 7))),
    ];
    let launch = lovejoin::launch_from_account(
        &w.chain,
        &available,
        None,
        &ada_terms(25_000_000),
        true,
        &change,
        None,
    )
    .unwrap();
    assert_eq!(launch.inputs().len(), 2);
    let done = launch.measure_locally().unwrap();
    // The token comes back to the account with the change.
    assert_eq!(done.change_tokens.items.len(), 1);
    assert!(lovejoin::launched_pool(true, &done.tx.tx_bytes.0, launch.seed).is_ok());
    // Too little altogether: said in words.
    let poor = vec![account_row(true, [0x0a; 28], 0x63, 15_000_000, None)];
    let why = lovejoin::launch_from_account(
        &w.chain,
        &poor,
        None,
        &ada_terms(25_000_000),
        true,
        &change,
        None,
    )
    .err()
    .unwrap()
    .to_string();
    assert!(why.contains("public account"), "{why}");
}

#[test]
fn an_account_launch_never_spends_a_utxo_carrying_a_reference_script() {
    // 1.6.0's release review, 318-rust#1: an account launch is measured in the wallet, whose evaluator can't take a
    // UTxO carrying a reference script (anyone can send the account one). Picked after the ADA alone fell short, as
    // the account's inputs are ordered for a measure through Ogmios, it had the launch refused, though the token's
    // UTxO pays. Such a UTxO is never picked, as the other launches and mixes paid from the account leave it out.
    let w = world(true);
    let change = Address::from_bech32(&account_row(true, [0x0a; 28], 0, 1, None).address).unwrap();
    let token = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
    let scripted = |tx: u8, lovelace: u64| UtxoResponse {
        reference_script: Some(
            serde_json::from_value(json!({
                "hash": hex::encode([0x5c; 28]), "size": 14, "type": "plutusV3",
                "bytes": "4d01000033222220051200120011",
            }))
            .unwrap(),
        ),
        ..account_row(true, [0x0a; 28], tx, lovelace, None)
    };
    let available = vec![
        account_row(true, [0x0a; 28], 0x71, 20_000_000, None),
        scripted(0x72, 10_000_000),
        account_row(true, [0x0a; 28], 0x73, 30_000_000, Some((token, 7))),
    ];
    let collateral = account_row(true, [0x0a; 28], 0x7c, 5_000_000, None);
    let launch = lovejoin::launch_from_account(
        &w.chain,
        &available,
        Some(&collateral),
        &terms(),
        true,
        &change,
        None,
    )
    .unwrap();
    let spent: Vec<String> = launch.inputs().iter().map(|u| u.tx_hash.clone()).collect();
    assert_eq!(spent, [hex::encode([0x71; 32]), hex::encode([0x73; 32])]);
    let done = launch.measure_locally().unwrap();
    assert_eq!(done.change_tokens.items.len(), 1);
    assert!(lovejoin::launched_pool(true, &done.tx.tx_bytes.0, launch.seed).is_ok());
    // One that would pay alone is no seed either: refused before anything is built.
    let why = lovejoin::launch_from_account(
        &w.chain,
        &[scripted(0x74, 40_000_000)],
        Some(&collateral),
        &terms(),
        true,
        &change,
        None,
    )
    .err()
    .unwrap()
    .to_string();
    assert!(why.contains("public account"), "{why}");
}
