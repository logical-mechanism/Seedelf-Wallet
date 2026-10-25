//! Lovejoin's token pools (its PR #163): the scripts the wallet derives from
//! a seed, the pools it trusts and why, and the wallet's own builders on a
//! token pool, against Lovejoin's own launch on preprod.
//!
//! The classic pool's tests (`lovejoin_test.rs`, `lovejoin_mainnet_test.rs`,
//! `withdraw_zero_test.rs`) run unedited beside these: token pools only add.

use blstrs::{G1Projective, Scalar};
use ff::Field;
use group::Group;
use hex_literal::hex;
use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_codec::minicbor;
use pallas_crypto::hash::Hash;
use pallas_primitives::Fragment;
use pallas_primitives::conway::{BigInt, PlutusData, TransactionOutput, Value};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{Output, ScriptKind};
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::{self, Budgets};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{
    self, BoxToken, BoxValue, Coin, Holding, Payer, PoolBox, Protocol, ReferenceDatum, Rejected,
    Version, templates,
};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::Value as Json;

fn json(text: &str) -> Json {
    serde_json::from_str(text).unwrap()
}

fn params() -> ProtocolParameters {
    let rows = json(include_str!("fixtures/epoch_params.json"));
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn mainnet_params() -> ProtocolParameters {
    let rows = json(include_str!("fixtures/epoch_params_mainnet.json"));
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn h28(text: &str) -> [u8; 28] {
    hex::decode(text).unwrap().try_into().unwrap()
}

/// Lovejoin's token-pool launch on preprod, as its `addresses.json` records
/// it: 2 ₳ and 10^16 LJTEST a box.
const LJ_SEED: ([u8; 32], u64) = (
    hex!("5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b"),
    2,
);
const LJ_POLICY: [u8; 28] = hex!("c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69");
const LJ_MIX_LOGIC: [u8; 28] = hex!("ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953");
const LJ_MIX_BOX: [u8; 28] = hex!("b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4");
const LJ_FEE: [u8; 28] = hex!("69fca85ab7b867159465515d5c22dba7d2ea177c39c105a2a9eef332");

/// The fixture's three transactions (its reference UTxO's, and its two
/// reference scripts', each output 0), each checked by its hash.
fn lj_outputs() -> Vec<Resolved> {
    let doc = json(include_str!("fixtures/lovejoin-token-preprod.json"));
    doc["txs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tx| {
            let outputs =
                eval::resolve_outputs(&hex::decode(tx["cbor"].as_str().unwrap()).unwrap()).unwrap();
            assert_eq!(
                hex::encode(outputs[0].tx_hash),
                tx["hash"].as_str().unwrap()
            );
            outputs[0].clone()
        })
        .collect()
}

/// The mint transaction's inputs, read from its bytes: where its seed is.
fn lj_launch_inputs() -> Vec<([u8; 32], u64)> {
    let doc = json(include_str!("fixtures/lovejoin-token-preprod.json"));
    let cbor = hex::decode(doc["txs"][0]["cbor"].as_str().unwrap()).unwrap();
    let tx = MultiEraTx::decode(&cbor).unwrap();
    tx.inputs()
        .iter()
        .map(|i| (**i.hash(), i.index()))
        .collect()
}

/// Lovejoin's preprod token pool, verified. Its reference scripts sit at a
/// key address, not the holder, so the wallet carries both inline.
fn lj_pool() -> Protocol {
    let outputs = lj_outputs();
    lovejoin::verify_pool(true, &outputs[0], LJ_SEED, &outputs[1..]).unwrap()
}

/// The same pool read with its two reference scripts, as Lovejoin's own
/// transactions read them: what a pool whose scripts are at the holder is
/// like.
fn lj_pool_by_reference() -> Protocol {
    let outputs = lj_outputs();
    let pool = lj_pool();
    let script_bytes = outputs[1..]
        .iter()
        .map(|o| {
            let TransactionOutput::PostAlonzo(o) = minicbor::decode(&o.output).unwrap() else {
                panic!()
            };
            match o.script_ref.unwrap().0 {
                pallas_primitives::conway::ScriptRef::PlutusV3Script(s) => s.as_ref().len() as u64,
                _ => panic!(),
            }
        })
        .sum();
    Protocol {
        references: outputs,
        inline_scripts: Vec::new(),
        script_bytes,
        ..pool
    }
}

// ---------------------------------------------------------------------------
// The box value
// ---------------------------------------------------------------------------

#[test]
fn box_values_match_lovejoins_vectors() {
    let doc = json(include_str!("fixtures/lovejoin-box-value-vectors.json"));
    let vectors = doc["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), 64);
    for v in vectors {
        let token = v["token"].as_object().map(|t| BoxToken {
            policy: h28(t["policy"].as_str().unwrap()),
            name: hex::decode(t["name"].as_str().unwrap()).unwrap(),
            quantity: t["quantity"].as_str().unwrap().parse().unwrap(),
        });
        let value = BoxValue {
            lovelace: v["lovelace"].as_str().unwrap().parse().unwrap(),
            token,
        };
        assert_eq!(
            hex::encode(value.cbor()),
            v["expected_serialize"].as_str().unwrap(),
            "{v}"
        );
    }
}

#[test]
fn the_classic_box_value_is_byte_for_byte_todays() {
    assert_eq!(
        hex::encode(BoxValue::ada(10_000_000).cbor()),
        "a140a1401a00989680"
    );
    for flag in [true, false] {
        let classic = Protocol::of(flag).unwrap();
        assert_eq!(classic.box_value(), BoxValue::ada(10_000_000));
        assert_eq!(classic.version, Version::Classic);
        assert!(classic.inline_scripts.is_empty());
    }
}

#[test]
fn a_box_value_checks_values_exactly() {
    let token = BoxToken {
        policy: [7; 28],
        name: b"NIGHT".to_vec(),
        quantity: 100,
    };
    let value = BoxValue {
        lovelace: 4_000_000,
        token: Some(token.clone()),
    };
    let decode = |output: Output| -> Value {
        let TransactionOutput::PostAlonzo(o) = minicbor::decode(
            &output
                .build_babbage_raw()
                .unwrap()
                .encode_fragment()
                .unwrap(),
        )
        .unwrap() else {
            panic!()
        };
        o.value
    };
    let address = lovejoin::holder_address(true);
    let exact = value.output(address.clone()).unwrap();
    assert!(value.is_value(&decode(exact.clone())));
    // More ADA, more of the token, another token, or none: not a box.
    assert!(
        !value.is_value(&decode(
            Output::new(address.clone(), 4_000_001)
                .add_asset(Hash::new(token.policy), token.name.clone(), 100)
                .unwrap()
        ))
    );
    assert!(
        !value.is_value(&decode(
            Output::new(address.clone(), 4_000_000)
                .add_asset(Hash::new(token.policy), token.name.clone(), 101)
                .unwrap()
        ))
    );
    assert!(
        !value.is_value(&decode(
            exact
                .clone()
                .add_asset(Hash::new([8; 28]), b"x".to_vec(), 1)
                .unwrap()
        ))
    );
    assert!(!value.is_value(&decode(Output::new(address, 4_000_000))));
    assert!(BoxValue::ada(4_000_000).is_value(&Value::Coin(4_000_000)));
    // k boxes' token, as long as it fits one output.
    assert_eq!(value.token_total(3).unwrap().unwrap().1, 300);
    let max = BoxValue {
        lovelace: 4_000_000,
        token: Some(BoxToken {
            quantity: u64::MAX,
            ..token
        }),
    };
    assert_eq!(max.token_total(1).unwrap().unwrap().1, u64::MAX);
    assert!(max.token_total(2).is_err());
}

// ---------------------------------------------------------------------------
// The templates and the derivation (S0a)
// ---------------------------------------------------------------------------

/// The unapplied scripts' hashes, as `aiken build` at Lovejoin 8131b1d
/// reports them (`plutus.json`). Any change to the bundled bytes is a new
/// set of templates beside these, never an edit.
#[test]
fn templates_are_frozen() {
    assert_eq!(
        templates::COMMIT,
        "8131b1dffd988932fce187acfb35e740d61d460f"
    );
    assert_eq!(
        templates::reference_holder().unwrap().hash,
        templates::REFERENCE_HOLDER_HASH
    );
    assert_eq!(
        templates::REFERENCE_HOLDER_HASH,
        h28("288fea77a0f674c6080aadd8ed3ca42cd5a920bf1f00c0d3e63306e4")
    );
    let unapplied = templates::unapplied_hashes();
    assert_eq!(
        unapplied,
        [
            h28("6878ed6f8fc90297645c0f26e014c1aa46625b65bdb2fa8f57e3e9c6"),
            h28("62befd1e9b7e5f8c33dd0b74d82e050072dede2803f8678320c563af"),
            h28("2365a62d5bdf9b2bc2d95a727c86e1fe165b5a8f14e1e2af5e84f0e4"),
            h28("3698bbfd9e1dca5a5bc0c33bb7bc8b8c02f9dfef1c84aa8e3aa7d67f"),
        ]
    );
}

/// The wallet's `uplc` 1.1.23 applies the 1.1.24 templates to Lovejoin's
/// seed and gets every hash Lovejoin's launch recorded, and the very bytes
/// of the two scripts it published.
#[test]
fn derive_reproduces_lovejoins_preprod_token_pool() {
    let derived = templates::derive(&LJ_SEED.0, LJ_SEED.1).unwrap();
    assert_eq!(derived.policy(), LJ_POLICY);
    assert_eq!(derived.mix_logic.hash, LJ_MIX_LOGIC);
    assert_eq!(derived.mix_box.hash, LJ_MIX_BOX);
    assert_eq!(derived.fee_contract.hash, LJ_FEE);
    let doc = json(include_str!("fixtures/lovejoin-token-preprod.json"));
    assert_eq!(h28(doc["mix_box_hash"].as_str().unwrap()), LJ_MIX_BOX);
    assert_eq!(h28(doc["mix_logic_hash"].as_str().unwrap()), LJ_MIX_LOGIC);
    // The published reference scripts are the derived bytes exactly.
    let outputs = lj_outputs();
    for (output, script) in outputs[1..]
        .iter()
        .zip([&derived.mix_box, &derived.mix_logic])
    {
        let TransactionOutput::PostAlonzo(o) = minicbor::decode(&output.output).unwrap() else {
            panic!()
        };
        let Some(pallas_primitives::conway::ScriptRef::PlutusV3Script(published)) =
            o.script_ref.map(|s| s.0)
        else {
            panic!("a V3 reference script")
        };
        assert_eq!(published.as_ref(), script.cbor.as_slice());
    }
    // Another seed, another pool.
    let other = templates::derive(&LJ_SEED.0, 3).unwrap();
    assert_ne!(other.policy(), LJ_POLICY);
    assert_ne!(other.mix_box.hash, LJ_MIX_BOX);
}

// ---------------------------------------------------------------------------
// Trusting a pool
// ---------------------------------------------------------------------------

#[test]
fn the_wallet_trusts_lovejoins_preprod_pool() {
    let pool = lj_pool();
    assert_eq!(pool.version, Version::TokenV1);
    assert_eq!(pool.id, LJ_POLICY);
    assert_eq!(pool.mix_box_hash, LJ_MIX_BOX);
    assert_eq!(pool.mix_logic_hash, LJ_MIX_LOGIC);
    assert_eq!(pool.fee_hash, LJ_FEE);
    assert_eq!(pool.denom, 2_000_000);
    assert_eq!(pool.max_fee, 1_500_000);
    assert_eq!(
        pool.token,
        Some(BoxToken {
            policy: h28("02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa"),
            name: b"LJTEST".to_vec(),
            quantity: 10_000_000_000_000_000,
        })
    );
    assert_eq!(pool.seed, Some(LJ_SEED));
    // Its scripts sit at a key address, which its key could spend: carried
    // inline, never read from there.
    assert_eq!(pool.references.len(), 1);
    assert_eq!(pool.inline_scripts.len(), 2);
    assert_eq!(pool.script_bytes, 0);
}

#[test]
fn the_seed_is_found_among_the_launchs_inputs() {
    let inputs = lj_launch_inputs();
    assert!(inputs.contains(&LJ_SEED));
    assert_eq!(lovejoin::find_seed(&LJ_POLICY, &inputs), Some(LJ_SEED));
    assert_eq!(lovejoin::policy_of(&LJ_SEED), Some(LJ_POLICY));
    let others: Vec<_> = inputs.into_iter().filter(|i| *i != LJ_SEED).collect();
    assert_eq!(lovejoin::find_seed(&LJ_POLICY, &others), None);
}

/// A reference UTxO at the holder, built here: `lovelace`, the NFT under
/// `policy` (and `extra` tokens), `datum` inline, and a script if given.
fn candidate_output(
    policy: [u8; 28],
    datum: &[u8],
    extra: Option<([u8; 28], &[u8], u64)>,
    stake: bool,
    script: Option<Vec<u8>>,
    holder: [u8; 28],
) -> Resolved {
    let delegation = if stake {
        ShelleyDelegationPart::Key(Hash::new([9; 28]))
    } else {
        ShelleyDelegationPart::Null
    };
    let address: Address = ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Script(Hash::new(holder)),
        delegation,
    )
    .into();
    let mut output = Output::new(address, 2_000_000)
        .add_asset(Hash::new(policy), b"lovejoin".to_vec(), 1)
        .unwrap()
        .set_inline_datum(datum.to_vec());
    if let Some((p, name, q)) = extra {
        output = output.add_asset(Hash::new(p), name.to_vec(), q).unwrap();
    }
    if let Some(script) = script {
        output = output.set_inline_script(ScriptKind::PlutusV3, script);
    }
    Resolved {
        tx_hash: [0x44; 32],
        index: 0,
        output: output
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    }
}

fn lj_datum() -> ReferenceDatum {
    let outputs = lj_outputs();
    lovejoin::candidate(true, &outputs[0]).unwrap().1
}

#[test]
fn a_datum_round_trips() {
    let datum = lj_datum();
    assert_eq!(ReferenceDatum::decode(&datum.encode()).unwrap(), datum);
    // A launch's datum built here verifies as Lovejoin's own does.
    let genuine = candidate_output(
        LJ_POLICY,
        &datum.encode(),
        None,
        false,
        None,
        templates::REFERENCE_HOLDER_HASH,
    );
    let pool = lovejoin::verify_pool(true, &genuine, LJ_SEED, &[]).unwrap();
    assert_eq!(pool.id, LJ_POLICY);
}

#[test]
fn verify_pool_refuses_what_isnt_a_genuine_token_pool() {
    let datum = lj_datum();
    let holder = templates::REFERENCE_HOLDER_HASH;
    let verify = |r: &Resolved| lovejoin::verify_pool(true, r, LJ_SEED, &[]).unwrap_err();

    // A fake NFT: any policy can mint "lovejoin"; the seed doesn't make it.
    let fake = candidate_output([0x13; 28], &datum.encode(), None, false, None, holder);
    assert_eq!(verify(&fake), Rejected::WrongSeed);
    // The genuine NFT, with a seed that isn't its launch's.
    let genuine = candidate_output(LJ_POLICY, &datum.encode(), None, false, None, holder);
    assert_eq!(
        lovejoin::verify_pool(true, &genuine, (LJ_SEED.0, 0), &[]).unwrap_err(),
        Rejected::WrongSeed
    );
    // A datum naming other scripts: one_shot_mint never checks them.
    for field in 0..3 {
        let mut wrong = datum.clone();
        match field {
            0 => wrong.mix_box_hash = [1; 28],
            1 => wrong.mix_logic_hash = [1; 28],
            _ => wrong.fee_hash = [1; 28],
        }
        let r = candidate_output(LJ_POLICY, &wrong.encode(), None, false, None, holder);
        assert_eq!(verify(&r), Rejected::WrongScripts, "field {field}");
    }
    // A stake credential, an extra asset, a reference script, another address.
    assert_eq!(
        verify(&candidate_output(
            LJ_POLICY,
            &datum.encode(),
            None,
            true,
            None,
            holder
        )),
        Rejected::StakeCredential
    );
    assert_eq!(
        verify(&candidate_output(
            LJ_POLICY,
            &datum.encode(),
            Some(([5; 28], b"junk", 1)),
            false,
            None,
            holder
        )),
        Rejected::NotOneNft
    );
    assert_eq!(
        verify(&candidate_output(
            LJ_POLICY,
            &datum.encode(),
            None,
            false,
            Some(vec![0x41, 0x00]),
            holder
        )),
        Rejected::ReferenceScript
    );
    assert_eq!(
        verify(&candidate_output(
            LJ_POLICY,
            &datum.encode(),
            None,
            false,
            None,
            [3; 28]
        )),
        Rejected::NotAtHolder
    );
    // The other network's holder address is another address.
    assert_eq!(
        lovejoin::verify_pool(false, &genuine, LJ_SEED, &[]).unwrap_err(),
        Rejected::NotAtHolder
    );
    // An ADA pool on the new scripts at the classic pool's 10 ₳: a copy of its value.
    let ada = ReferenceDatum {
        box_value: BoxValue::ada(10_000_000),
        ..datum.clone()
    };
    assert_eq!(
        verify(&candidate_output(
            LJ_POLICY,
            &ada.encode(),
            None,
            false,
            None,
            holder
        )),
        Rejected::AdaPool
    );
    // At any other amount, an ADA pool is a pool like the token pools (session 1, 17).
    let ada = ReferenceDatum {
        box_value: BoxValue::ada(25_000_000),
        ..datum.clone()
    };
    let pool = lovejoin::verify_pool(
        true,
        &candidate_output(LJ_POLICY, &ada.encode(), None, false, None, holder),
        LJ_SEED,
        &[],
    )
    .unwrap();
    assert_eq!(pool.box_value(), BoxValue::ada(25_000_000));
    // The classic pool's five-field datum isn't a token pool's.
    let five = PlutusData::Constr(pallas_primitives::Constr {
        tag: 121,
        any_constructor: None,
        fields: pallas_primitives::MaybeIndefArray::Indef(vec![
            PlutusData::BigInt(BigInt::Int(10_000_000i64.into())),
            PlutusData::BigInt(BigInt::Int(1_000_000i64.into())),
            PlutusData::BoundedBytes(LJ_MIX_BOX.to_vec().into()),
            PlutusData::BoundedBytes(LJ_MIX_LOGIC.to_vec().into()),
            PlutusData::BoundedBytes(LJ_FEE.to_vec().into()),
        ]),
    })
    .encode_fragment()
    .unwrap();
    assert!(matches!(
        verify(&candidate_output(
            LJ_POLICY, &five, None, false, None, holder
        )),
        Rejected::BadDatum(_)
    ));
}

#[test]
fn a_reference_datum_is_held_to_one_shot_mints_ranges() {
    let datum = lj_datum();
    let token = datum.box_value.token.clone().unwrap();
    let bad = |d: ReferenceDatum| ReferenceDatum::decode(&d.encode()).unwrap_err();
    let with = |lovelace: u64, max_fee: u64, token: BoxToken| ReferenceDatum {
        box_value: BoxValue {
            lovelace,
            token: Some(token),
        },
        max_fee,
        ..datum.clone()
    };
    assert!(matches!(
        bad(with(2_000_000, 2_000_000, token.clone())),
        Rejected::BadDatum(_)
    ));
    assert!(matches!(
        bad(with(2_000_000, 0, token.clone())),
        Rejected::BadDatum(_)
    ));
    assert!(matches!(
        bad(with(
            2_000_000,
            1,
            BoxToken {
                quantity: 0,
                ..token.clone()
            }
        )),
        Rejected::BadDatum(_)
    ));
    assert!(matches!(
        bad(with(
            2_000_000,
            1,
            BoxToken {
                name: vec![0; 33],
                ..token.clone()
            }
        )),
        Rejected::BadDatum(_)
    ));
    // At each boundary, a datum that holds: a 32-byte name, Q = 2^64 − 1.
    let edge = with(
        2_000_000,
        1_999_999,
        BoxToken {
            name: vec![0xab; 32],
            quantity: u64::MAX,
            ..token
        },
    );
    assert_eq!(ReferenceDatum::decode(&edge.encode()).unwrap(), edge);
}

/// The classic pools' ids, fee caps and fee scripts, as Lovejoin's records
/// give them, are what their bundled reference outputs hold: the NFT, and a
/// five-field datum naming the pool's scripts.
#[test]
fn the_classic_pools_facts_are_their_reference_outputs() {
    for flag in [true, false] {
        let classic = Protocol::of(flag).unwrap();
        let TransactionOutput::PostAlonzo(o) =
            minicbor::decode(&classic.references[0].output).unwrap()
        else {
            panic!()
        };
        let Value::Multiasset(_, assets) = o.value else {
            panic!("the NFT")
        };
        assert_eq!(*assets[0].0, classic.id);
        assert_eq!(assets[0].1[0].0.as_slice(), b"lovejoin");
        let Some(pallas_primitives::conway::DatumOption::Data(data)) = o.datum_option else {
            panic!("an inline datum")
        };
        let PlutusData::Constr(c) = data.0 else {
            panic!()
        };
        let f = c.fields.to_vec();
        assert_eq!(f.len(), 5);
        let int = |d: &PlutusData| match d {
            PlutusData::BigInt(BigInt::Int(i)) => i128::from(i.0) as u64,
            _ => panic!(),
        };
        let bytes = |d: &PlutusData| match d {
            PlutusData::BoundedBytes(b) => b.to_vec(),
            _ => panic!(),
        };
        assert_eq!(int(&f[0]), classic.denom);
        assert_eq!(int(&f[1]), classic.max_fee);
        assert_eq!(bytes(&f[2]), classic.mix_box_hash);
        assert_eq!(bytes(&f[3]), classic.mix_logic_hash);
        assert_eq!(bytes(&f[4]), classic.fee_hash);
    }
}

// ---------------------------------------------------------------------------
// The rehearsal, replayed (S0a)
// ---------------------------------------------------------------------------

/// Lovejoin's own token mixes and withdraws on preprod, measured again by
/// the wallet's evaluator from their recorded bytes: the budgets the chain
/// charged, to the step.
#[test]
fn the_wallets_evaluator_measures_lovejoins_token_rehearsal_as_the_chain_did() {
    let doc = json(include_str!("fixtures/lovejoin-token-preprod-runs.json"));
    let txs: Vec<(String, Vec<u8>)> = doc["txs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| {
            (
                t["hash"].as_str().unwrap().to_string(),
                hex::decode(t["cbor"].as_str().unwrap()).unwrap(),
            )
        })
        .collect();
    let mut known: Vec<Resolved> = Vec::new();
    for (hash, cbor) in &txs {
        let outputs = eval::resolve_outputs(cbor).unwrap();
        assert_eq!(&hex::encode(outputs[0].tx_hash), hash);
        known.extend(outputs);
    }
    let runs = doc["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 7);
    for run in runs {
        let (_, cbor) = txs
            .iter()
            .find(|(h, _)| h == run["tx"].as_str().unwrap())
            .unwrap();
        let answer = eval::evaluate(cbor, &known, &params().cost_model_v3, true).unwrap();
        let budgets = Budgets::from_ogmios(&answer)
            .unwrap_or_else(|e| panic!("{}: {e}: {answer}", run["step"]));
        for r in run["redeemers"].as_array().unwrap() {
            let index = r["index"].as_u64().unwrap();
            let measured = match r["tag"].as_str().unwrap() {
                "SPEND" => budgets.spend(index),
                "REWARD" => budgets.withdraw(index),
                other => panic!("{other}"),
            }
            .unwrap();
            assert_eq!(
                (measured.mem, measured.steps),
                (r["mem"].as_u64().unwrap(), r["steps"].as_u64().unwrap()),
                "{} {}",
                run["step"],
                r
            );
        }
    }
}

// ---------------------------------------------------------------------------
// The wallet's builders on a token pool
// ---------------------------------------------------------------------------

fn random_scalar() -> Scalar {
    loop {
        let s = Scalar::random(&mut OsRng);
        if !bool::from(s.is_zero()) {
            return s;
        }
    }
}

/// A box of `pool`'s, made up here, owned by `sk` when given.
fn made_up_box(pool: &Protocol, sk: Option<&Scalar>, first: u8) -> PoolBox {
    let a = G1Projective::generator() * random_scalar();
    let b = a * sk.copied().unwrap_or_else(random_scalar);
    let (a, b) = (crypto::point_to_bytes(&a), crypto::point_to_bytes(&b));
    let output = pool
        .box_value()
        .output(pool.mix_box_address())
        .unwrap()
        .set_inline_datum(lovejoin::mix_datum(&a, &b));
    let mut tx_hash = [first; 32];
    tx_hash[31] = rand_core::RngCore::next_u32(&mut OsRng) as u8;
    let utxo = Resolved {
        tx_hash,
        index: 0,
        output: output
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    };
    PoolBox::from_resolved(utxo, pool).expect("a box of the pool's")
}

fn session(flag: bool) -> Address {
    let mut raw = vec![if flag { 0x00 } else { 0x01 }];
    raw.extend([0x51; 28]);
    raw.extend([0x52; 28]);
    Address::from_bytes(&raw).unwrap()
}

fn coin(flag: bool, first: u8, lovelace: u64) -> Coin {
    Coin {
        utxo: Resolved {
            tx_hash: [first; 32],
            index: 0,
            output: Output::new(session(flag), lovelace)
                .build_babbage_raw()
                .unwrap()
                .encode_fragment()
                .unwrap(),
        },
        lovelace,
    }
}

fn payer(flag: bool, lovelace: u64) -> Payer {
    Payer {
        fee: coin(flag, 0xf1, lovelace),
        collateral: Some(coin(flag, 0xcc, 5_000_000)),
        address: session(flag),
        signers: 1,
    }
}

#[test]
fn a_token_box_is_read_from_a_row_and_its_bytes_alike() {
    let pool = lj_pool();
    let made = made_up_box(&pool, None, 0x20);
    // Ten ADA alone at the token pool's mix_box isn't one of its boxes.
    let classic_shaped = Resolved {
        output: Output::new(pool.mix_box_address(), 10_000_000)
            .set_inline_datum(lovejoin::mix_datum(&made.a, &made.b))
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
        ..made.utxo.clone()
    };
    assert!(PoolBox::from_resolved(classic_shaped, &pool).is_none());
    // Nor is a token box one of the classic pool's.
    let classic = Protocol::of(true).unwrap();
    assert!(PoolBox::from_resolved(made.utxo.clone(), &classic).is_none());
}

#[test]
fn a_token_pool_mixes_with_its_scripts_inline_and_by_reference() {
    for pool in [lj_pool(), lj_pool_by_reference()] {
        let boxes: Vec<PoolBox> = (0..3)
            .map(|i| made_up_box(&pool, None, 0x20 + 0x10 * i))
            .collect();
        let mixed = lovejoin::mix(&params(), &pool, &boxes, &payer(true, 50_000_000)).unwrap();
        assert_eq!(mixed.outputs.len(), 3);
        for out in &mixed.outputs {
            assert!(PoolBox::from_resolved(out.utxo.clone(), &pool).is_some());
        }
        let tx = MultiEraTx::decode(&mixed.tx.tx_bytes.0).unwrap();
        let inline = !pool.inline_scripts.is_empty();
        assert_eq!(tx.plutus_v3_scripts().len(), if inline { 2 } else { 0 });
        // About the classic pool's 0.88 ₳, and more with the scripts inline.
        assert!(mixed.fee < 1_200_000, "{}", mixed.fee);
        println!(
            "token mix, inline {inline}: {} lovelace, {} bytes",
            mixed.fee,
            mixed.tx.tx_bytes.0.len()
        );
    }
}

#[test]
fn a_token_box_comes_back_into_a_seedelf_holding_its_token() {
    let sk = Scalar::from(424_242u64);
    let owner = Register::create(sk).unwrap();
    for pool in [lj_pool(), lj_pool_by_reference()] {
        let boxes = vec![made_up_box(&pool, Some(&sk), 0x30)];
        let back = lovejoin::withdraw(
            &params(),
            &pool,
            &boxes,
            &sk,
            owner.clone().rerandomize().unwrap(),
        )
        .unwrap();
        let token = pool.token.clone().unwrap();
        assert_eq!(back.token, Some((token.clone(), token.quantity)));
        assert_eq!(back.lovelace, pool.denom - back.fee);
        let tx = MultiEraTx::decode(&back.tx.tx_bytes.0).unwrap();
        let out = &tx.outputs()[0];
        assert_eq!(out.value().coin(), back.lovelace);
        let value = out.value();
        let assets = value.assets();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].assets()[0].output_coin(), Some(token.quantity));
        println!(
            "token withdraw, inline {}: {} lovelace, {} bytes",
            !pool.inline_scripts.is_empty(),
            back.fee,
            back.tx.tx_bytes.0.len()
        );
    }
    // Two boxes come back together, holding twice the token.
    let pool = lj_pool();
    let boxes = vec![
        made_up_box(&pool, Some(&sk), 0x30),
        made_up_box(&pool, Some(&sk), 0x40),
    ];
    let back = lovejoin::withdraw(
        &params(),
        &pool,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
    )
    .unwrap();
    assert_eq!(back.token.unwrap().1, 2 * pool.token.unwrap().quantity);
}

#[test]
fn a_box_too_poor_to_come_back_says_so_and_an_account_can_pay() {
    let sk = Scalar::from(777u64);
    let owner = Register::create(sk).unwrap();
    // A pool whose boxes hold too little ADA for a long name and a large Q.
    let poor = Protocol {
        denom: 1_500_000,
        token: Some(BoxToken {
            policy: [0xab; 28],
            name: vec![0xcd; 32],
            quantity: u64::MAX,
        }),
        ..lj_pool()
    };
    let boxes = vec![made_up_box(&poor, Some(&sk), 0x30)];
    let err = lovejoin::withdraw(
        &params(),
        &poor,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
    )
    .unwrap_err();
    assert!(
        err.downcast_ref::<lovejoin::CantPayBack>().is_some(),
        "{err}"
    );
    // Paid by an account, the box comes back whole, the account making up
    // what the output needs beyond the box's ADA.
    let paid = lovejoin::withdraw_paid(
        &params(),
        &poor,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &payer(true, 20_000_000),
    )
    .unwrap();
    assert!(paid.lovelace > 1_500_000);
    let topped = paid.lovelace - 1_500_000;
    assert_eq!(
        paid.change.unwrap().lovelace,
        20_000_000 - paid.fee - topped
    );
    // A box that holds enough ADA for the output but not for the fee too.
    let tight = Protocol {
        denom: 1_800_000,
        ..poor
    };
    let boxes = vec![made_up_box(&tight, Some(&sk), 0x30)];
    let err = lovejoin::withdraw(
        &params(),
        &tight,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
    )
    .unwrap_err();
    assert!(
        err.downcast_ref::<lovejoin::CantPayBack>().is_some(),
        "{err}"
    );
    let paid = lovejoin::withdraw_paid(
        &params(),
        &tight,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &payer(true, 20_000_000),
    )
    .unwrap();
    assert_eq!(paid.lovelace, 1_800_000);
    assert_eq!(paid.change.unwrap().lovelace, 20_000_000 - paid.fee);
}

/// A box worth less than the withdraw's fee itself (session 5's review, L1):
/// it's a box that can't pay its own way back, as one short of its output's
/// minimum is, so the wallet says so and offers a payer, never a plain error
/// read as a check that couldn't be made. Paid from the private balance, a
/// UTxO too small with it is `PrivateTooSmall`, so the next one is tried.
#[test]
fn a_box_worth_less_than_the_fee_cant_pay_its_way_back() {
    let sk = Scalar::from(777u64);
    let owner = Register::create(sk).unwrap();
    let pool = lj_pool();
    let boxes = vec![made_up_box(&pool, Some(&sk), 0x30)];
    // A fixed fee over what the box holds.
    let dear = ProtocolParameters {
        min_fee_b: pool.denom + 1_000_000,
        ..params()
    };
    let err = lovejoin::withdraw(
        &dear,
        &pool,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
    )
    .unwrap_err();
    assert!(
        err.downcast_ref::<lovejoin::CantPayBack>().is_some(),
        "{err}"
    );
    let err = lovejoin::withdraw_private(
        &dear,
        &pool,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &seedelf_payer(sk, 0xf2, 1_000_000),
    )
    .unwrap_err();
    assert!(
        err.downcast_ref::<lovejoin::PrivateTooSmall>().is_some(),
        "{err}"
    );
    // A UTxO that covers the fee and the output pays.
    let back = lovejoin::withdraw_private(
        &dear,
        &pool,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &seedelf_payer(sk, 0xf2, 20_000_000),
    )
    .unwrap();
    assert_eq!(back.lovelace, pool.denom + 20_000_000 - back.fee);
}

/// One of `sk`'s Seedelf UTxOs, ADA alone, and what spends it beside a
/// withdraw: its proof bound to a one-time key's hash.
fn seedelf_payer(sk: Scalar, first: u8, lovelace: u64) -> lovejoin::SeedelfPayer {
    let config =
        seedelf_core::constants::get_config(seedelf_core::constants::VARIANT, true).unwrap();
    let to = seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash);
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let signer = [0x5e; 28];
    let (z, g_r) =
        seedelf_crypto::schnorr::create_proof(register.clone(), sk, hex::encode(signer)).unwrap();
    lovejoin::SeedelfPayer {
        coin: Coin {
            utxo: Resolved {
                tx_hash: [first; 32],
                index: 0,
                output: Output::new(to, lovelace)
                    .set_inline_datum(register.to_vec().unwrap())
                    .build_babbage_raw()
                    .unwrap()
                    .encode_fragment()
                    .unwrap(),
            },
            lovelace,
        },
        redeemer: seedelf_core::data_structures::create_spend_redeemer(z, g_r, hex::encode(signer))
            .unwrap(),
        signer,
    }
}

// 34g's last review: a box that can't pay its own way back comes back paid
// from the private balance, a Seedelf UTxO spent beside it, as the public
// account could already pay. Built, proven and run through both scripts.
#[test]
fn a_box_too_poor_to_come_back_is_paid_for_from_the_private_balance() {
    let sk = Scalar::from(777u64);
    let owner = Register::create(sk).unwrap();
    let poor = Protocol {
        denom: 1_500_000,
        token: Some(BoxToken {
            policy: [0xab; 28],
            name: vec![0xcd; 32],
            quantity: u64::MAX,
        }),
        ..lj_pool()
    };
    let boxes = vec![made_up_box(&poor, Some(&sk), 0x30)];
    let payer = seedelf_payer(sk, 0xf2, 20_000_000);
    let back = lovejoin::withdraw_private(
        &params(),
        &poor,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &payer,
    )
    .unwrap();
    // The box and the UTxO come back together, in one output holding the token, less the fee.
    assert_eq!(back.lovelace, 1_500_000 + 20_000_000 - back.fee);
    assert!(back.change.is_none());
    let token = poor.token.clone().unwrap();
    assert_eq!(back.token, Some((token.clone(), token.quantity)));
    let tx = MultiEraTx::decode(&back.tx.tx_bytes.0).unwrap();
    assert_eq!(tx.outputs().len(), 1);
    assert_eq!(tx.outputs()[0].value().coin(), back.lovelace);
    let spent: Vec<[u8; 32]> = tx.inputs().iter().map(|i| **i.hash()).collect();
    assert!(spent.contains(&[0xf2; 32]));
    // giveme.my's collateral, and the one-time key signs beside its key.
    let signers: Vec<[u8; 28]> = tx
        .required_signers()
        .collect::<Vec<_>>()
        .iter()
        .map(|h| ***h)
        .collect();
    assert!(signers.contains(&[0x5e; 28]));
    assert!(signers.contains(&seedelf_core::constants::COLLATERAL_HASH));
    // A UTxO too small for what the output needs, with the box, after the fee: said apart.
    let small = seedelf_payer(sk, 0xf3, 300_000);
    let err = lovejoin::withdraw_private(
        &params(),
        &poor,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &small,
    )
    .unwrap_err();
    assert!(
        err.downcast_ref::<lovejoin::PrivateTooSmall>().is_some(),
        "{err}"
    );
    // The classic pool's box too.
    let classic = Protocol::of(true).unwrap();
    let boxes = vec![made_up_box(&classic, Some(&sk), 0x31)];
    let back = lovejoin::withdraw_private(
        &params(),
        &classic,
        &boxes,
        &sk,
        owner.rerandomize().unwrap(),
        &seedelf_payer(sk, 0xf4, 5_000_000),
    )
    .unwrap();
    assert_eq!(back.lovelace, 10_000_000 + 5_000_000 - back.fee);
}

#[test]
fn a_classic_box_comes_back_paid_by_an_account_too() {
    let classic = Protocol::of(true).unwrap();
    let sk = Scalar::from(31u64);
    let owner = Register::create(sk).unwrap();
    let boxes = vec![made_up_box(&classic, Some(&sk), 0x30)];
    let paid = lovejoin::withdraw_paid(
        &params(),
        &classic,
        &boxes,
        &sk,
        owner.clone().rerandomize().unwrap(),
        &payer(true, 20_000_000),
    )
    .unwrap();
    assert_eq!(paid.lovelace, 10_000_000);
    assert!(paid.token.is_none());
}

fn token_holding(
    pool: &Protocol,
    first: u8,
    lovelace: u64,
    boxes: u64,
    extra: Option<([u8; 28], &[u8], u64)>,
) -> Holding {
    let token = pool.token.clone().unwrap();
    let mut output = Output::new(session(true), lovelace)
        .add_asset(
            Hash::new(token.policy),
            token.name.clone(),
            token.quantity * boxes,
        )
        .unwrap();
    if let Some((p, n, q)) = extra {
        output = output.add_asset(Hash::new(p), n.to_vec(), q).unwrap();
    }
    Holding::of(&Resolved {
        tx_hash: [first; 32],
        index: 0,
        output: output
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    })
    .unwrap()
}

#[test]
fn a_token_deposit_takes_q_a_box_and_keeps_the_rest_apart() {
    let pool = lj_pool();
    let sk = Scalar::from(5u64);
    let owner = Register::create(sk).unwrap();
    let owners: Vec<Register> = (0..3)
        .map(|_| owner.clone().rerandomize().unwrap())
        .collect();
    // Exactly three boxes' worth of the token, and ADA alone besides.
    let inputs = vec![
        token_holding(&pool, 0x10, 3_000_000, 3, None),
        Holding::from(&coin(true, 0x11, 20_000_000)),
    ];
    let deposit =
        lovejoin::deposit_from(&params(), &pool, &inputs, &owners, &session(true), 1).unwrap();
    assert_eq!(deposit.boxes.len(), 3);
    assert!(deposit.token_change.is_empty());
    for b in &deposit.boxes {
        assert!(PoolBox::from_resolved(b.utxo.clone(), &pool).is_some());
        assert!(b.is_owned(&sk));
    }
    assert_eq!(
        deposit.change.lovelace,
        23_000_000 - 3 * pool.denom - deposit.fee
    );
    // More of the token and another token: back apart, with their least ADA.
    let inputs = vec![
        token_holding(&pool, 0x10, 3_000_000, 5, Some(([0x77; 28], b"other", 9))),
        Holding::from(&coin(true, 0x11, 20_000_000)),
    ];
    let deposit =
        lovejoin::deposit_from(&params(), &pool, &inputs, &owners, &session(true), 1).unwrap();
    assert_eq!(deposit.token_change.len(), 1);
    let kept = &deposit.token_change[0];
    let token = pool.token.clone().unwrap();
    assert_eq!(
        kept.tokens
            .quantity_of(hex::encode(token.policy), hex::encode(&token.name))
            .unwrap(),
        Some(2 * token.quantity)
    );
    assert_eq!(
        kept.tokens
            .quantity_of(hex::encode([0x77; 28]), hex::encode(b"other"))
            .unwrap(),
        Some(9)
    );
    assert_eq!(
        deposit.change.lovelace,
        23_000_000 - 3 * pool.denom - kept.lovelace - deposit.fee
    );
    // The ADA change is last, and holds ADA alone.
    let tx = MultiEraTx::decode(&deposit.tx.tx_bytes.0).unwrap();
    assert_eq!(tx.outputs().len(), 5);
    assert!(tx.outputs()[4].value().assets().is_empty());
    // Too little of the token for three boxes.
    let inputs = vec![
        token_holding(&pool, 0x10, 3_000_000, 2, None),
        Holding::from(&coin(true, 0x11, 20_000_000)),
    ];
    assert!(lovejoin::deposit_from(&params(), &pool, &inputs, &owners, &session(true), 1).is_err());
}

#[test]
fn a_token_chain_deposits_mixes_and_comes_back() {
    let pool = lj_pool_by_reference();
    let sk = Scalar::from(987_654_321u64);
    let owner = Register::create(sk).unwrap();
    let owners = vec![owner.clone().rerandomize().unwrap()];
    let others: Vec<PoolBox> = (0..8).map(|i| made_up_box(&pool, None, 0x50 + i)).collect();
    let funding = lovejoin::Funding {
        coins: vec![coin(true, 0x11, 30_000_000)],
        collateral: Some(coin(true, 0xcc, 5_000_000)),
        address: session(true),
        deposit_signers: 1,
        mix_signers: 1,
    };
    let tokens = vec![token_holding(&pool, 0x10, 3_000_000, 1, None)];
    let chain =
        lovejoin::chain_from(&params(), &pool, &funding, &tokens, &owners, 2, &others).unwrap();
    // A deposit and four mixes: one box fanned out two waves deep.
    assert_eq!(chain.txs.len(), 5);
    assert_eq!(chain.leaves.len(), 1);
    let leaf = &chain.leaves[0];
    assert!(leaf.is_owned(&sk));
    let back = lovejoin::withdraw(
        &params(),
        &pool,
        std::slice::from_ref(leaf),
        &sk,
        owner.clone().rerandomize().unwrap(),
    )
    .unwrap();
    assert_eq!(back.token.unwrap().1, pool.token.unwrap().quantity);
}

#[test]
fn the_mainnet_parameters_take_a_token_pool_too() {
    // A token pool on mainnet's parameters: the same scripts, a seed of its own.
    let derived = templates::derive(&[0x42; 32], 0).unwrap();
    let datum = ReferenceDatum {
        mix_box_hash: derived.mix_box.hash,
        mix_logic_hash: derived.mix_logic.hash,
        fee_hash: derived.fee_contract.hash,
        ..lj_datum()
    };
    let address: Address = ShelleyAddress::new(
        Network::Mainnet,
        ShelleyPaymentPart::Script(Hash::new(templates::REFERENCE_HOLDER_HASH)),
        ShelleyDelegationPart::Null,
    )
    .into();
    let reference = Resolved {
        tx_hash: [0x45; 32],
        index: 0,
        output: Output::new(address, 2_000_000)
            .add_asset(Hash::new(derived.policy()), b"lovejoin".to_vec(), 1)
            .unwrap()
            .set_inline_datum(datum.encode())
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    };
    let pool = lovejoin::verify_pool(false, &reference, ([0x42; 32], 0), &[]).unwrap();
    let boxes: Vec<PoolBox> = (0..3)
        .map(|i| made_up_box(&pool, None, 0x20 + 0x10 * i))
        .collect();
    lovejoin::mix(&mainnet_params(), &pool, &boxes, &payer(false, 50_000_000)).unwrap();
}

// ---------------------------------------------------------------------------
// The classic pool, unchanged
// ---------------------------------------------------------------------------

/// Classic deposits, byte for byte what 1.5.0's builder made for the same
/// registers and UTxOs (the fixture was built from `main` before token
/// pools). A mix and a withdraw are random, so `lovejoin_width_test.rs`
/// checks them against an independent builder instead, budget for budget.
#[test]
fn classic_deposits_are_byte_for_byte_one_point_fives() {
    let doc = json(include_str!("fixtures/lovejoin-classic-deposit-pins.json"));
    for pin in doc["pins"].as_array().unwrap() {
        let flag = pin["preprod"].as_bool().unwrap();
        let params = if flag { params() } else { mainnet_params() };
        let protocol = Protocol::of(flag).unwrap();
        let address = session(flag);
        let coin = |first: u8, lovelace: u64| Coin {
            utxo: Resolved {
                tx_hash: [first; 32],
                index: 1,
                output: Output::new(address.clone(), lovelace)
                    .build_babbage_raw()
                    .unwrap()
                    .encode_fragment()
                    .unwrap(),
            },
            lovelace,
        };
        let owners: Vec<Register> = (1..=3u64)
            .map(|i| Register::create(Scalar::from(1000 + i)).unwrap())
            .collect();
        let deposit = lovejoin::deposit(
            &params,
            &protocol,
            &[coin(0x10, 25_000_000), coin(0x20, 9_000_000)],
            &owners,
            &address,
            1,
        )
        .unwrap();
        assert_eq!(deposit.fee, pin["fee"].as_u64().unwrap());
        assert_eq!(
            hex::encode(&deposit.tx.tx_bytes.0),
            pin["tx"].as_str().unwrap()
        );
        assert!(deposit.token_change.is_empty());
    }
}

// ---------------------------------------------------------------------------
// Usable for a new mix
// ---------------------------------------------------------------------------

#[test]
fn the_classic_pool_is_usable() {
    for flag in [true, false] {
        let p = if flag { params() } else { mainnet_params() };
        let usable = lovejoin::usable(&p, &Protocol::of(flag).unwrap(), true).unwrap();
        assert!(usable.box_minimum < 1_500_000, "{usable:?}");
        assert!(usable.back > 9_000_000, "{usable:?}");
    }
}

/// Lovejoin's own preprod pool, 2 ₳ a box with its scripts carried inline:
/// a box still pays its own way back, LJTEST's name being short.
#[test]
fn lovejoins_two_ada_pool_brings_a_box_back() {
    let usable = lovejoin::usable(&params(), &lj_pool(), true).unwrap();
    println!("{usable:?}");
    assert_eq!(usable.back, 2_000_000 - usable.withdraw_fee);
    assert!(usable.box_minimum < 2_000_000);
}

#[test]
fn a_pool_isnt_usable_unregistered_too_small_or_unable_to_come_back() {
    let pool = lj_pool();
    assert_eq!(
        lovejoin::usable(&params(), &pool, false).unwrap_err(),
        lovejoin::Unusable::NotRegistered
    );
    let worst = BoxToken {
        policy: [0xab; 28],
        name: vec![0xcd; 32],
        quantity: u64::MAX,
    };
    // Under the ledger's minimum for a box.
    let tiny = Protocol {
        denom: 1_000_000,
        token: Some(worst.clone()),
        ..pool.clone()
    };
    assert!(matches!(
        lovejoin::usable(&params(), &tiny, true).unwrap_err(),
        lovejoin::Unusable::BelowMinimum { has: 1_000_000, .. }
    ));
    // A box that exists but can't pay its own way back.
    let poor = Protocol {
        denom: 1_800_000,
        token: Some(worst),
        ..pool
    };
    assert!(matches!(
        lovejoin::usable(&params(), &poor, true).unwrap_err(),
        lovejoin::Unusable::CantComeBack { .. }
    ));
}

/// How many boxes one deposit into a token pool holds at the worst a box's
/// token can be (a 32-byte name and a quantity in eight bytes): the worker's
/// MAX_TOKEN_DEPOSIT_BOXES leaves room for a few dozen more inputs, as the
/// classic pool's 96 does (106 fit with one input there).
#[test]
fn a_token_deposit_holds_the_worker_s_most_boxes() {
    const MAX_TOKEN_DEPOSIT_BOXES: usize = 64;
    let worst = BoxToken {
        policy: [0xab; 28],
        name: vec![0xcd; 32],
        quantity: u64::MAX / 128,
    };
    let pool = Protocol {
        denom: 9_000_000,
        token: Some(worst.clone()),
        ..lj_pool()
    };
    let sk = Scalar::from(5u64);
    let owner = Register::create(sk).unwrap();
    let fits = |boxes: usize, coins: usize| {
        let owners: Vec<Register> = (0..boxes)
            .map(|_| owner.clone().rerandomize().unwrap())
            .collect();
        let mut inputs = vec![token_holding(&pool, 0x10, 3_000_000, boxes as u64, None)];
        inputs
            .extend((0..coins).map(|i| Holding::from(&coin(true, 0x80 + i as u8, 1_000_000_000))));
        lovejoin::deposit_from(&params(), &pool, &inputs, &owners, &session(true), 1).is_ok()
    };
    let most = (1..=128).take_while(|n| fits(*n, 1)).last().unwrap();
    println!("{most} worst token boxes fit one deposit with two inputs");
    assert!(fits(MAX_TOKEN_DEPOSIT_BOXES, 30));
    assert!((MAX_TOKEN_DEPOSIT_BOXES + 6..128).contains(&most), "{most}");
}

/// Whether a box already in a pool comes back (the escape hatch's question,
/// chunk 34's 34d) is its way back alone: where `usable` stops at a new box's
/// minimum, `comes_back` says whether the withdraw pays.
#[test]
fn a_box_already_there_is_asked_only_about_its_way_back() {
    let worst = BoxToken {
        policy: [0xab; 28],
        name: vec![0xcd; 32],
        quantity: u64::MAX,
    };
    let pool = Protocol {
        denom: 3_000_000,
        token: Some(worst.clone()),
        ..lj_pool()
    };
    // Under today's price a box comes back.
    assert!(lovejoin::comes_back(&params(), &pool).is_ok());
    // At twice the price of a byte, usable stops at the box's minimum; comes_back says it can't come back.
    let dear = ProtocolParameters {
        coins_per_utxo_size: params().coins_per_utxo_size * 2,
        ..params()
    };
    assert!(matches!(
        lovejoin::usable(&dear, &pool, true).unwrap_err(),
        lovejoin::Unusable::BelowMinimum { .. }
    ));
    assert!(matches!(
        lovejoin::comes_back(&dear, &pool).unwrap_err(),
        lovejoin::Unusable::CantComeBack { .. }
    ));
    // Registration isn't its question: a box comes back through a registered credential, which it can't unregister.
    let poor = Protocol {
        denom: 1_800_000,
        token: Some(worst),
        ..lj_pool()
    };
    assert!(matches!(
        lovejoin::comes_back(&params(), &poor).unwrap_err(),
        lovejoin::Unusable::CantComeBack { .. }
    ));
}

/// A private Bootstrap's session as the worker funds it, and what it runs
/// (1.6.0's release review, 318-rust#0): one UTxO of [`lovejoin::funding_for`]'s
/// ADA at depth 0 and the way back's reserve, and the boxes' token, with no
/// collateral; its deposit, then its return, a sweep of the deposit's change
/// alone into the wallet contract, signed by the session's key. The deposit's
/// fee, and what the sweep pays back, when both build.
fn bootstraps(
    params: &ProtocolParameters,
    pool: &Protocol,
    flag: bool,
    boxes: usize,
) -> Option<(u64, u64)> {
    let owner = Register::create(Scalar::from(7u64)).unwrap();
    let owners: Vec<Register> = (0..boxes)
        .map(|_| owner.clone().rerandomize().unwrap())
        .collect();
    let lovelace = lovejoin::funding_for(boxes, 0, pool.denom) + lovejoin::BOOTSTRAP_BACK_RESERVE;
    let input = match &pool.token {
        None => Holding::from(&coin(flag, 0x10, lovelace)),
        Some(_) => token_holding(pool, 0x10, lovelace, boxes as u64, None),
    };
    let deposit = lovejoin::deposit_from(params, pool, &[input], &owners, &session(flag), 1).ok()?;
    // The funding holds exactly the boxes' token: nothing comes back beside the ADA.
    assert!(deposit.token_change.is_empty());
    let change = UtxoResponse {
        tx_hash: hex::encode(deposit.change.utxo.tx_hash),
        tx_index: deposit.change.utxo.index,
        address: session(flag).to_bech32().unwrap(),
        value: deposit.change.lovelace.to_string(),
        ..Default::default()
    };
    let config = get_config(VARIANT, flag).unwrap();
    let wallet = wallet_contract(flag, config.contract.wallet_contract_hash);
    let (_, fee) =
        build::external_sweep(params, &[change], &owner, &wallet, Hash::new([0x51; 28])).ok()?;
    Some((deposit.fee, deposit.change.lovelace - fee))
}

/// A Bootstrap paid from the private balance (chunk 34's 34d review, 3; 1.6.0's
/// release review, 318-rust#0): its session's one UTxO pays the deposit's fee,
/// which grows with the boxes, from its 1.5 ₳ reserve, and its way back, a
/// sweep with no collateral whose Seedelf output must hold its least, from
/// what that leaves and the way back's reserve. `bootstrap_most` builds both:
/// under today's parameters one deposit's most goes, in the classic pool and a
/// token pool, on both networks, and at a dearer byte the sweep holds it to
/// fewer, never the deposit alone.
#[test]
fn a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for() {
    let classic = Protocol::of(true).unwrap();
    let most = lovejoin::bootstrap_most(&params(), &classic, true, 96).unwrap();
    println!("a private Bootstrap of the classic pool: at most {most}");
    for boxes in [1, most] {
        let (fee, back) = bootstraps(&params(), &classic, true, boxes).expect("built");
        println!("  {boxes} boxes: deposit fee {fee}, {back} back");
    }
    assert_eq!(most, 96);
    // Capped by what's asked, too.
    assert_eq!(
        lovejoin::bootstrap_most(&params(), &classic, true, 12).unwrap(),
        12
    );
    assert_eq!(
        lovejoin::bootstrap_most(&params(), &classic, true, 0).unwrap(),
        0
    );
    // Mainnet's parameters and addresses alike.
    let mainnet = Protocol::of(false).unwrap();
    let mainnet_most = lovejoin::bootstrap_most(&mainnet_params(), &mainnet, false, 96).unwrap();
    assert_eq!(mainnet_most, 96);
    assert!(bootstraps(&mainnet_params(), &mainnet, false, 1).is_some());
    assert!(bootstraps(&mainnet_params(), &mainnet, false, mainnet_most).is_some());

    let lj = lj_pool();
    let lj_most = lovejoin::bootstrap_most(&params(), &lj, true, 64).unwrap();
    println!("a private Bootstrap of LJTEST's pool: at most {lj_most}");
    for boxes in [1, lj_most] {
        let (fee, back) = bootstraps(&params(), &lj, true, boxes).expect("built");
        println!("  {boxes} boxes: deposit fee {fee}, {back} back");
    }
    assert_eq!(lj_most, 64);

    // The worst a token can be: one token deposit's most still, its way back paid.
    let worst = Protocol {
        denom: 9_000_000,
        token: Some(BoxToken {
            policy: [0xab; 28],
            name: vec![0xcd; 32],
            quantity: u64::MAX / 128,
        }),
        ..lj_pool()
    };
    let worst_most = lovejoin::bootstrap_most(&params(), &worst, true, 64).unwrap();
    println!("a private Bootstrap of the worst token's pool: at most {worst_most}");
    let (fee, back) = bootstraps(&params(), &worst, true, worst_most).expect("built");
    println!("  {worst_most} boxes: deposit fee {fee}, {back} back");
    assert_eq!(worst_most, 64);

    // At half as dear again a byte, the way back's Seedelf output needs more than a large deposit leaves: the sweep,
    // not the deposit, holds it to fewer, and a count past it is never offered.
    let dear = ProtocolParameters {
        coins_per_utxo_size: params().coins_per_utxo_size * 3 / 2,
        ..params()
    };
    let dear_most = lovejoin::bootstrap_most(&dear, &classic, true, 96).unwrap();
    println!("at a dearer byte: at most {dear_most}");
    assert!((1..96).contains(&dear_most), "{dear_most}");
    assert!(bootstraps(&dear, &classic, true, dear_most).is_some());
    assert!(bootstraps(&dear, &classic, true, dear_most + 1).is_none());
    let owner = Register::create(Scalar::from(7u64)).unwrap();
    let past = dear_most + 1;
    let input = Holding::from(&coin(
        true,
        0x10,
        lovejoin::funding_for(past, 0, classic.denom) + lovejoin::BOOTSTRAP_BACK_RESERVE,
    ));
    assert!(
        lovejoin::deposit_from(&dear, &classic, &[input], &vec![owner; past], &session(true), 1)
            .is_ok(),
        "the deposit alone builds there"
    );
}
