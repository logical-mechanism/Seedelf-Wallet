//! The free checks on the network itself (chunk 34's S0b, and S0c's
//! evaluation): a token pool's mix and withdraw, and a launch, built by the
//! wallet and measured by each network through Koios's Ogmios, their
//! made-up UTxOs passed as `additionalUtxo`. Nothing is signed or sent, and
//! nothing costs a lovelace. Each network must measure every script exactly
//! as the wallet's own evaluator did.
//!
//! What they can't show: what the ledger checks before any script runs (a
//! script credential's registration without a witness, certificate 0; a
//! withdrawal from a credential that isn't registered yet; giveme.my's
//! signature). Those need a real launch on preprod.
//!
//! ```text
//! cargo test -p seedelf-core --test lovejoin_live_test -- --ignored --nocapture
//! ```

use blstrs::{G1Projective, Scalar};
use ff::Field;
use group::Group;
use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::Fragment;
use pallas_primitives::conway::PseudoDatumOption;
use pallas_traverse::{Era, MultiEraOutput, MultiEraTx};
use pallas_txbuilder::Output;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{Budgets, Chain};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{
    self, BoxToken, BoxValue, Coin, Payer, PoolBox, Protocol, ReferenceDatum, Terms, templates,
};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};

fn koios(network_flag: bool) -> &'static str {
    if network_flag {
        "https://preprod.koios.rest/api/v1"
    } else {
        "https://api.koios.rest/api/v1"
    }
}

fn curl(url: &str, body: Option<&Value>) -> Value {
    let mut args = vec![
        "-sS",
        "--max-time",
        "120",
        "-H",
        "content-type: application/json",
    ];
    if body.is_some() {
        args.extend(["-X", "POST", "--data-binary", "@-"]);
    }
    let mut child = Command::new("curl")
        .args(&args)
        .arg(url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("curl");
    let mut stdin = child.stdin.take().unwrap();
    if let Some(body) = body {
        stdin.write_all(body.to_string().as_bytes()).unwrap();
    }
    drop(stdin);
    let out = child.wait_with_output().unwrap();
    serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("{url}: {}", String::from_utf8_lossy(&out.stdout)))
}

/// The network's parameters as it runs now: these checks are for today's
/// protocol version and cost model, not the bundled fixtures'.
fn live_params(network_flag: bool) -> ProtocolParameters {
    let rows = curl(
        &format!(
            "{}/epoch_params?limit=1&order=epoch_no.desc",
            koios(network_flag)
        ),
        None,
    );
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

/// A UTxO as Ogmios v6 takes it in `additionalUtxo`.
fn ogmios_row(utxo: &Resolved) -> Value {
    let output = MultiEraOutput::decode(Era::Conway, &utxo.output).unwrap();
    let value = output.value();
    let mut amounts = serde_json::Map::new();
    amounts.insert("ada".into(), json!({ "lovelace": value.coin() }));
    for policy in value.assets() {
        let mut names = serde_json::Map::new();
        for asset in policy.assets() {
            names.insert(
                hex::encode(asset.name()),
                json!(asset.output_coin().unwrap_or(0)),
            );
        }
        amounts.insert(hex::encode(policy.policy()), Value::Object(names));
    }
    let mut row = json!({
        "transaction": { "id": hex::encode(utxo.tx_hash) },
        "index": utxo.index,
        "address": output.address().unwrap().to_bech32().unwrap(),
        "value": amounts,
    });
    if let Some(PseudoDatumOption::Data(data)) = output.datum() {
        row["datum"] = json!(hex::encode(data.raw_cbor()));
    }
    row
}

/// Ogmios's measure of `tx`, which must be the wallet's, script for script.
fn the_network_agrees(
    network_flag: bool,
    what: &str,
    tx: &[u8],
    synthetic: &[Resolved],
    known: &[Resolved],
    params: &ProtocolParameters,
) {
    let answer = curl(
        &format!("{}/ogmios", koios(network_flag)),
        Some(&json!({
            "jsonrpc": "2.0",
            "method": "evaluateTransaction",
            "params": {
                "transaction": { "cbor": hex::encode(tx) },
                "additionalUtxo": synthetic.iter().map(ogmios_row).collect::<Vec<_>>(),
            },
        })),
    );
    let network = if network_flag { "preprod" } else { "mainnet" };
    let theirs =
        Budgets::from_ogmios(&answer).unwrap_or_else(|e| panic!("{network} {what}: {e}: {answer}"));
    let ours = Budgets::from_ogmios(
        &eval::evaluate(tx, known, &params.cost_model_v3, network_flag).unwrap(),
    )
    .unwrap();
    let mut listed: Vec<(String, u64, u64, u64)> = answer["result"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["validator"]["purpose"].as_str().unwrap().to_string(),
                r["validator"]["index"].as_u64().unwrap(),
                r["budget"]["memory"].as_u64().unwrap(),
                r["budget"]["cpu"].as_u64().unwrap(),
            )
        })
        .collect();
    listed.sort();
    for (purpose, index, mem, cpu) in &listed {
        let mine = match purpose.as_str() {
            "spend" => ours.spend(*index),
            "mint" => ours.mint(*index),
            "withdraw" => ours.withdraw(*index),
            other => panic!("{other}"),
        }
        .unwrap();
        assert_eq!(
            (mine.mem, mine.steps),
            (*mem, *cpu),
            "{network} {what} {purpose} {index}"
        );
    }
    assert!(theirs.covers(&ours) && ours.covers(&theirs));
    println!("{network} {what}: the network measures it as the wallet does: {listed:?}");
}

fn random_scalar() -> Scalar {
    loop {
        let s = Scalar::random(&mut OsRng);
        if !bool::from(s.is_zero()) {
            return s;
        }
    }
}

fn resolved(first: u8, output: Output) -> Resolved {
    let mut tx_hash = [first; 32];
    tx_hash[31] = rand_core::RngCore::next_u32(&mut OsRng) as u8;
    Resolved {
        tx_hash,
        index: 0,
        output: output
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    }
}

/// A token pool on `network_flag`, launched from a made-up seed: its
/// reference UTxO is made up too, so it goes in `additionalUtxo`.
fn made_up_pool(network_flag: bool) -> Protocol {
    let seed = ([0x42; 32], 0);
    let derived = templates::derive(&seed.0, seed.1).unwrap();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: 4_500_000,
            token: Some(BoxToken {
                policy: [0xfe; 28],
                name: vec![0xee; 32],
                quantity: u64::MAX,
            }),
        },
        max_fee: 1_500_000,
        mix_box_hash: derived.mix_box.hash,
        mix_logic_hash: derived.mix_logic.hash,
        fee_hash: derived.fee_contract.hash,
    };
    let reference = resolved(
        0x45,
        Output::new(lovejoin::holder_address(network_flag), 2_000_000)
            .add_asset(Hash::new(derived.policy()), b"lovejoin".to_vec(), 1)
            .unwrap()
            .set_inline_datum(datum.encode()),
    );
    lovejoin::verify_pool(network_flag, &reference, seed, &[]).unwrap()
}

fn made_up_box(pool: &Protocol, sk: Option<&Scalar>, first: u8) -> PoolBox {
    let a = G1Projective::generator() * random_scalar();
    let b = a * sk.copied().unwrap_or_else(random_scalar);
    let (a, b) = (crypto::point_to_bytes(&a), crypto::point_to_bytes(&b));
    let utxo = resolved(
        first,
        pool.box_value()
            .output(pool.mix_box_address())
            .unwrap()
            .set_inline_datum(lovejoin::mix_datum(&a, &b)),
    );
    PoolBox::from_resolved(utxo, pool).unwrap()
}

fn session(network_flag: bool) -> Address {
    ShelleyAddress::new(
        if network_flag {
            Network::Testnet
        } else {
            Network::Mainnet
        },
        ShelleyPaymentPart::Key(Hash::new([0x51; 28])),
        ShelleyDelegationPart::Key(Hash::new([0x52; 28])),
    )
    .into()
}

fn coin(network_flag: bool, first: u8, lovelace: u64) -> Coin {
    Coin {
        utxo: resolved(first, Output::new(session(network_flag), lovelace)),
        lovelace,
    }
}

/// S0b: a token pool's mix and withdraw, measured by each network.
#[test]
#[ignore = "live Koios"]
fn each_network_measures_a_token_mix_and_withdraw_as_the_wallet_does() {
    for network_flag in [true, false] {
        let params = live_params(network_flag);
        let pool = made_up_pool(network_flag);
        let reference = pool.references.clone();

        let boxes: Vec<PoolBox> = (0..3)
            .map(|i| made_up_box(&pool, None, 0x20 + 0x10 * i))
            .collect();
        let payer = Payer {
            fee: coin(network_flag, 0xf1, 50_000_000),
            collateral: Some(coin(network_flag, 0xcc, 5_000_000)),
            address: session(network_flag),
            signers: 1,
        };
        let mixed = lovejoin::mix(&params, &pool, &boxes, &payer).unwrap();
        let mut synthetic: Vec<Resolved> = boxes.iter().map(|b| b.utxo.clone()).collect();
        synthetic.push(payer.fee.utxo.clone());
        synthetic.push(payer.collateral.clone().unwrap().utxo);
        synthetic.extend(reference.iter().cloned());
        the_network_agrees(
            network_flag,
            "token mix",
            &mixed.tx.tx_bytes.0,
            &synthetic,
            &synthetic,
            &params,
        );

        let sk = random_scalar();
        let owner = Register::create(sk).unwrap();
        let mine = vec![made_up_box(&pool, Some(&sk), 0x60)];
        let back =
            lovejoin::withdraw(&params, &pool, &mine, &sk, owner.rerandomize().unwrap()).unwrap();
        let mut synthetic: Vec<Resolved> = mine.iter().map(|b| b.utxo.clone()).collect();
        synthetic.extend(reference.iter().cloned());
        the_network_agrees(
            network_flag,
            "token withdraw",
            &back.tx.tx_bytes.0,
            &synthetic,
            &synthetic,
            &params,
        );
    }
}

/// S0c's evaluation: a launch, from made-up Seedelf UTxOs, measured by each
/// network: the wallet contract's proofs and one_shot_mint, beside the
/// certificate-0 registration and the outputs at the holder.
#[test]
#[ignore = "live Koios"]
fn each_network_measures_a_launch_as_the_wallet_does() {
    for network_flag in [true, false] {
        let params = live_params(network_flag);
        let chain = Chain {
            params: params.clone(),
            network_flag,
            config: get_config(VARIANT, network_flag).unwrap(),
        };
        let sk = random_scalar();
        let owner = Register::create(sk).unwrap();
        let signer = Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref());
        let wallet = wallet_contract(network_flag, chain.config.contract.wallet_contract_hash);
        let mut tx_hash = [0x31; 32];
        tx_hash[31] = rand_core::RngCore::next_u32(&mut OsRng) as u8;
        let register = owner.clone().rerandomize().unwrap();
        let row: UtxoResponse = serde_json::from_value(json!({
            "tx_hash": hex::encode(tx_hash), "tx_index": 1,
            "address": wallet.to_bech32().unwrap(), "value": "40000000",
            "stake_address": null,
            "payment_cred": hex::encode(chain.config.contract.wallet_contract_hash),
            "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
            "inline_datum": {
                "bytes": hex::encode(register.to_vec().unwrap()),
                "value": { "constructor": 0, "fields": [
                    { "bytes": register.generator }, { "bytes": register.public_value },
                ]},
            },
            "reference_script": null, "asset_list": [], "is_spent": false,
        }))
        .unwrap();
        let terms = Terms {
            token: BoxToken {
                policy: [0x1a; 28],
                name: b"NIGHT".to_vec(),
                quantity: 100_000_000,
            },
            box_lovelace: 4_500_000,
            max_fee: 1_500_000,
        };
        let launch = lovejoin::launch(
            &chain,
            std::slice::from_ref(&row),
            &terms,
            true,
            &owner,
            signer,
        )
        .unwrap();
        let done = launch
            .spend
            .proven(|r, vkh| schnorr::create_proof(r.clone(), sk, vkh.to_string()))
            .unwrap()
            .measure_locally(&[])
            .unwrap();
        let input = eval::resolve_row(&row).unwrap();
        let mut known = vec![input.clone()];
        known.extend(eval::seedelf_references(network_flag).unwrap());
        the_network_agrees(
            network_flag,
            "launch",
            &done.tx.tx_bytes.0,
            &[input],
            &known,
            &params,
        );
        let decoded = MultiEraTx::decode(&done.tx.tx_bytes.0).unwrap();
        assert!(
            decoded
                .as_conway()
                .unwrap()
                .transaction_body
                .certificates
                .is_some()
        );
    }
}
