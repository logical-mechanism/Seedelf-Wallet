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
        token: BoxToken {
            policy: [0x1a; 28],
            name: b"NIGHT".to_vec(),
            quantity: 100_000_000,
        },
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
        assert_eq!(pool.token, Some(terms().token));
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
    t.token.policy = seedelf;
    assert!(refused(t).contains("identifier"));
    // Terms one_shot_mint would refuse.
    let mut t = terms();
    t.max_fee = t.box_lovelace;
    assert!(refused(t).contains("one_shot_mint"));
    let mut t = terms();
    t.token.name = vec![0; 33];
    assert!(refused(t).contains("one_shot_mint"));
    // A box too small to come back.
    let mut t = terms();
    t.box_lovelace = 1_700_000;
    t.max_fee = 1_000_000;
    t.token.name = vec![0xee; 32];
    t.token.quantity = u64::MAX;
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
