//! How much ADA a box of a token pool the wallet launches must hold (S0d,
//! the owner's ask of 2026-10-13: "a provable test showing what exactly it
//! has to be for this flow"). Proven by building it, not estimated.
//!
//! A box comes back on its own: a withdraw into a Seedelf that the box pays
//! for itself. What comes back is then spent like any other Seedelf UTxO, and
//! on its own, since spending it with another would tie the two histories
//! together and undo the mixing. So a box's ADA must pay for, in turn:
//!
//! 1. the withdraw, its fee and its Seedelf output (the token, a register);
//! 2. from what came back alone, a payment of part of the token, to a
//!    Seedelf or to an address, with the token's change and the fee;
//! 3. or all of it, to a Seedelf or to an address.
//!
//! Each is built and measured by the wallet's own builders, for a token at
//! its worst (a 32-byte name, `Q = 2^64 − 1`) and a typical one, under
//! preprod's and mainnet's parameters, with the pool's scripts by reference
//! (published at the holder, as the wallet's launches do) and inline. The
//! least box value at which all of them build is searched to 0.01 ₳, and so
//! is how far the price of a byte can rise before each candidate value stops
//! covering a shape.
//!
//! What it found (2026-10-17), the same on both networks:
//!
//! | token | scripts | least box value | its withdraw fee |
//! |---|---|---|---|
//! | worst | by reference | 4.11 ₳ | 0.298 ₳ |
//! | worst | inline | 4.23 ₳ | 0.412 ₳ |
//! | typical | by reference | 3.83 ₳ | 0.297 ₳ |
//! | typical | inline | 3.95 ₳ | 0.410 ₳ |
//!
//! Every time the step that binds is paying part of the token to a Seedelf
//! from what came back alone: the recipient's output, the token's change and
//! the fee. Both outputs are sized at the wallet's Seedelf minimum, which
//! sizes against a base address and so runs about 0.12 ₳ an output over the
//! enterprise address the contract really has; sized exactly, each figure
//! would be about 0.24 ₳ lower. And how far the price of a byte (today 4,310
//! lovelace) can rise before a box value stops covering a shape, inline:
//!
//! | box value | worst token | typical token |
//! |---|---|---|
//! | 4.00 ₳ | doesn't cover it today (−6.3%) | +1.7% |
//! | 4.25 ₳ | +0.7% | +9.3% |
//! | 4.50 ₳ | +7.7% | +17.0% |
//! | 5.00 ₳ | +21.7% | +32.0% |
//!
//! So 4 ₳ covers a typical token with almost nothing to spare, and not the
//! worst a launch can name. The figure is the owner's to choose from these.
//!
//! ```text
//! cargo test -p seedelf-core --test lovejoin_box_value_test -- --nocapture
//! ```

use blstrs::{G1Projective, Scalar};
use group::Group;
use pallas_addresses::Address;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::Fragment;
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{Output, ScriptKind};
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build::{self, Chain, Payment};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::Resolved;
use seedelf_core::lovejoin::{
    self, BoxToken, BoxValue, PoolBox, Protocol, ReferenceDatum, templates,
};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

/// The least box value each case needs, as measured 2026-10-17 under the
/// bundled parameters (4,310 lovelace a byte on both networks): the same on
/// preprod and mainnet. A change in the builders or the parameters that
/// moves one shows here first.
const MEASURED: [(Shape, bool, u64); 4] = [
    (Shape::Worst, true, 4_110_000),
    (Shape::Worst, false, 4_230_000),
    (Shape::Typical, true, 3_830_000),
    (Shape::Typical, false, 3_950_000),
];

fn params(network_flag: bool) -> ProtocolParameters {
    let rows: Value = serde_json::from_str(if network_flag {
        include_str!("fixtures/epoch_params.json")
    } else {
        include_str!("fixtures/epoch_params_mainnet.json")
    })
    .unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

/// A token, at its worst or as it typically is.
#[derive(Clone, Copy, Debug)]
enum Shape {
    /// A 32-byte name and `Q = 2^64 − 1`: the largest a box's token can be.
    Worst,
    /// A five-letter name and 100 of a six-decimal token (as NIGHT is).
    Typical,
}

impl Shape {
    fn token(self) -> BoxToken {
        match self {
            Shape::Worst => BoxToken {
                policy: [0xfe; 28],
                name: vec![0xee; 32],
                quantity: u64::MAX,
            },
            Shape::Typical => BoxToken {
                policy: [0x1a; 28],
                name: b"NIGHT".to_vec(),
                quantity: 100_000_000,
            },
        }
    }
}

/// A token pool launched with `box_lovelace` a box, on the generalized
/// scripts, its seed made up here; its scripts at the holder when
/// `by_reference`, else carried in every transaction.
fn pool(network_flag: bool, box_lovelace: u64, token: BoxToken, by_reference: bool) -> Protocol {
    let seed = ([0x5e; 32], 1);
    let derived = templates::derive(&seed.0, seed.1).unwrap();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: box_lovelace,
            token: Some(token),
        },
        max_fee: 1_500_000.min(box_lovelace - 1),
        mix_box_hash: derived.mix_box.hash,
        mix_logic_hash: derived.mix_logic.hash,
        fee_hash: derived.fee_contract.hash,
    };
    let holder = lovejoin::holder_address(network_flag);
    let at_holder = |first: u8, output: Output| Resolved {
        tx_hash: [first; 32],
        index: 0,
        output: output
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    };
    let reference = at_holder(
        0x71,
        Output::new(holder.clone(), 2_000_000)
            .add_asset(Hash::new(derived.policy()), b"lovejoin".to_vec(), 1)
            .unwrap()
            .set_inline_datum(datum.encode()),
    );
    let scripts: Vec<Resolved> = if by_reference {
        [(0x72, &derived.mix_box), (0x73, &derived.mix_logic)]
            .into_iter()
            .map(|(first, s)| {
                at_holder(
                    first,
                    Output::new(holder.clone(), 20_000_000)
                        .set_inline_script(ScriptKind::PlutusV3, s.cbor.clone()),
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    lovejoin::verify_pool(network_flag, &reference, seed, &scripts).unwrap()
}

fn chain(network_flag: bool) -> Chain {
    Chain {
        params: params(network_flag),
        network_flag,
        config: get_config(VARIANT, network_flag).unwrap(),
    }
}

/// A box of `pool`'s that `sk` owns, made up here.
fn own_box(pool: &Protocol, sk: &Scalar) -> PoolBox {
    let a = G1Projective::generator() * Scalar::from(987_654_321u64);
    let b = a * sk;
    let (a, b) = (crypto::point_to_bytes(&a), crypto::point_to_bytes(&b));
    let utxo = Resolved {
        tx_hash: [0x30; 32],
        index: 0,
        output: pool
            .box_value()
            .output(pool.mix_box_address())
            .unwrap()
            .set_inline_datum(lovejoin::mix_datum(&a, &b))
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    };
    PoolBox::from_resolved(utxo, pool).unwrap()
}

fn assets_of(token: &BoxToken, quantity: u64) -> Assets {
    Assets::new()
        .add(
            Asset::new(
                hex::encode(token.policy),
                hex::encode(&token.name),
                quantity,
            )
            .unwrap(),
        )
        .unwrap()
}

/// What came back, as the wallet reads it from Koios: a row at the wallet
/// contract under the withdraw's register.
fn row(network_flag: bool, tx: &[u8], register: &Register, token: &BoxToken) -> UtxoResponse {
    let decoded = MultiEraTx::decode(tx).unwrap();
    let output = &decoded.outputs()[0];
    let config = get_config(VARIANT, network_flag).unwrap();
    let wallet = wallet_contract(network_flag, config.contract.wallet_contract_hash);
    let quantity = output.value().assets()[0].assets()[0]
        .output_coin()
        .unwrap();
    serde_json::from_value(json!({
        "tx_hash": hex::encode(*decoded.hash()), "tx_index": 0,
        "address": wallet.to_bech32().unwrap(), "value": output.value().coin().to_string(),
        "stake_address": null,
        "payment_cred": hex::encode(config.contract.wallet_contract_hash),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": {
            "bytes": hex::encode(register.to_vec().unwrap()),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
        "reference_script": null,
        "asset_list": [{
            "policy_id": hex::encode(token.policy), "asset_name": hex::encode(&token.name),
            "quantity": quantity.to_string(), "decimals": 0, "fingerprint": "",
        }],
        "is_spent": false,
    }))
    .unwrap()
}

/// The ledger's least fee for a finished transaction: its signed size, the
/// budgets it declares, and its reference scripts.
fn ledger_minimum(
    params: &ProtocolParameters,
    tx: &[u8],
    signers: usize,
    script_bytes: u64,
) -> u64 {
    let decoded = MultiEraTx::decode(tx).unwrap();
    let units: u64 = decoded
        .redeemers()
        .iter()
        .map(|r| {
            seedelf_core::transaction::computation_fee(params, r.ex_units().mem, r.ex_units().steps)
        })
        .sum();
    // A signature adds a 32-byte key and a 64-byte signature, about 101 bytes.
    let size = tx.len() as u64 + 101 * signers as u64;
    build::linear_fee(params, size)
        + units
        + build::reference_script_fee(params, script_bytes).unwrap()
}

/// Every step of a box's way back, at `box_lovelace`: `Ok` with the
/// withdraw's fee and what came back, or the first step that can't be built.
fn way_back(
    network_flag: bool,
    params: &ProtocolParameters,
    box_lovelace: u64,
    shape: Shape,
    by_reference: bool,
) -> Result<(u64, u64), String> {
    let token = shape.token();
    let pool = pool(network_flag, box_lovelace, token.clone(), by_reference);
    let sk = Scalar::from(4_242_424u64);
    let owner = Register::create(sk).unwrap();
    let destination = owner.clone().rerandomize().unwrap();
    let back = lovejoin::withdraw(
        params,
        &pool,
        &[own_box(&pool, &sk)],
        &sk,
        destination.clone(),
    )
    .map_err(|e| format!("the withdraw: {e}"))?;
    let minimum = ledger_minimum(params, &back.tx.tx_bytes.0, 1, pool.script_bytes);
    assert!(
        back.fee >= minimum,
        "the withdraw pays {} of the ledger's {minimum}",
        back.fee
    );

    let chain = Chain {
        params: params.clone(),
        ..chain(network_flag)
    };
    let came_back = row(network_flag, &back.tx.tx_bytes.0, &destination, &token);
    let signer = Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref());
    let other = Register::create(Scalar::from(31_337u64)).unwrap();
    let mut address_bytes = vec![if network_flag { 0x60 } else { 0x61 }];
    address_bytes.extend([0x44; 28]);
    let address = Address::from_bytes(&address_bytes).unwrap();
    let half = assets_of(&token, token.quantity / 2);
    let all = assets_of(&token, token.quantity);
    let measured = |what: &str, spend: anyhow::Result<build::ScriptSpend>| -> Result<(), String> {
        spend
            .and_then(|s| {
                s.proven(|register, vkh| {
                    schnorr::create_proof(register.clone(), sk, vkh.to_string())
                })
            })
            .and_then(|s| s.measure_locally(&[]))
            .map(|_| ())
            .map_err(|e| format!("{what}: {e}"))
    };
    let inputs = std::slice::from_ref(&came_back);
    let seedelf_part = build::minimum_seedelf_payment(params, &half).unwrap();
    measured(
        "part of the token to a Seedelf",
        build::transfer_from(
            &chain,
            inputs,
            &[Payment {
                register: other.clone(),
                lovelace: seedelf_part,
                tokens: half.clone(),
            }],
            &owner,
            signer,
        ),
    )?;
    let address_part = build::minimum_address_payment(params, &address, &half).unwrap();
    measured(
        "part of the token to an address",
        build::sweep_from(
            &chain,
            inputs,
            &address,
            address_part,
            &half,
            &owner,
            signer,
        ),
    )?;
    measured(
        "all of it to a Seedelf",
        build::transfer_most(&chain, inputs, &other, &all, &owner, signer),
    )?;
    measured(
        "all of it to an address",
        build::sweep_all(&chain, inputs, &address, &owner, signer),
    )?;
    Ok((back.fee, back.lovelace))
}

/// The least box value, to 0.01 ₳, at which every step builds.
fn least(network_flag: bool, params: &ProtocolParameters, shape: Shape, by_reference: bool) -> u64 {
    let (mut low, mut high) = (100u64, 1_000u64); // in hundredths of an ADA
    assert!(way_back(network_flag, params, high * 10_000, shape, by_reference).is_ok());
    assert!(way_back(network_flag, params, low * 10_000, shape, by_reference).is_err());
    while high - low > 1 {
        let mid = (low + high) / 2;
        if way_back(network_flag, params, mid * 10_000, shape, by_reference).is_ok() {
            high = mid;
        } else {
            low = mid;
        }
    }
    high * 10_000
}

fn ada(lovelace: u64) -> String {
    format!("{}.{:06} ₳", lovelace / 1_000_000, lovelace % 1_000_000)
}

/// The proof: the least box value each case needs, as recorded in
/// [`MEASURED`], and how far the price of a byte can rise before each
/// candidate value stops covering a shape.
#[test]
fn a_token_pools_box_value_is_proven() {
    for network_flag in [true, false] {
        let params = params(network_flag);
        let network = if network_flag { "preprod" } else { "mainnet" };
        for (shape, by_reference, expected) in MEASURED {
            let least = least(network_flag, &params, shape, by_reference);
            let (fee, back) = way_back(network_flag, &params, least, shape, by_reference).unwrap();
            println!(
                "{network:<8} {shape:<8?} scripts {:<6} | least box value {} | its withdraw fee {} | back {}",
                if by_reference { "by ref" } else { "inline" },
                ada(least),
                ada(fee),
                ada(back),
            );
            assert_eq!(
                least, expected,
                "{network} {shape:?} by reference {by_reference}"
            );
            // A hundredth less, and it's paying part of the token to a
            // Seedelf that can't be built.
            let short =
                way_back(network_flag, &params, least - 10_000, shape, by_reference).unwrap_err();
            assert!(
                short.starts_with("part of the token to a Seedelf"),
                "{short}"
            );
        }
    }

    // How far the price of a byte can rise before each candidate value stops
    // covering a shape, its scripts inline (the dearer): in steps of 10.
    let base = params(false);
    for shape in [Shape::Worst, Shape::Typical] {
        for candidate in [4_000_000u64, 4_250_000, 4_500_000, 5_000_000] {
            let at = |price: u64| ProtocolParameters {
                coins_per_utxo_size: price,
                ..base.clone()
            };
            let (mut low, mut high) = (base.coins_per_utxo_size / 2, base.coins_per_utxo_size * 4);
            if way_back(false, &at(low), candidate, shape, false).is_err() {
                println!(
                    "{shape:?} at {}: not even at half today's price",
                    ada(candidate)
                );
                continue;
            }
            while high - low > 10 {
                let mid = (low + high) / 2;
                if way_back(false, &at(mid), candidate, shape, false).is_ok() {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            println!(
                "{shape:?} at {}: covered up to {low} lovelace a byte, {:+.1}% on today's {}",
                ada(candidate),
                (low as f64 / base.coins_per_utxo_size as f64 - 1.0) * 100.0,
                base.coins_per_utxo_size
            );
        }
    }
}
