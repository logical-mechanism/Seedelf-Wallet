//! Chunk 34's 34e in core: the planner per pool (each pool's mix estimate, a
//! chain's boxes across pools, token pools first) and D3's width (four boxes
//! a mix beside three), against the classic pool on preprod and Lovejoin's
//! own preprod token pool.
//!
//! The classic pool's tests (`lovejoin_test.rs`, `lovejoin_mainnet_test.rs`,
//! `withdraw_zero_test.rs`) and the token pools' (`lovejoin_pools_test.rs`)
//! run unedited beside these: one pool three wide plans and builds as before.

use blstrs::{G1Projective, Scalar};
use ff::Field;
use group::Group;
use hex_literal::hex;
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::Hash;
use pallas_primitives::Fragment;
use pallas_primitives::conway::TransactionOutput;
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::Output;
use rand_core::OsRng;
use seedelf_core::assets::Assets;
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{
    self, Coin, Funding, Holding, Leg, LegPlan, PoolBox, PoolShort, Protocol,
};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::ProtocolParameters;
use serde_json::Value as Json;

fn json(text: &str) -> Json {
    serde_json::from_str(text).unwrap()
}

fn params() -> ProtocolParameters {
    let rows = json(include_str!("fixtures/epoch_params.json"));
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

/// Lovejoin's token-pool launch on preprod: 2 ₳ and 10^16 LJTEST a box.
const LJ_SEED: ([u8; 32], u64) = (
    hex!("5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b"),
    2,
);

/// The fixture's three transactions' outputs 0: the reference UTxO's, and its two reference scripts'.
fn lj_outputs() -> Vec<Resolved> {
    let doc = json(include_str!("fixtures/lovejoin-token-preprod.json"));
    doc["txs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tx| {
            eval::resolve_outputs(&hex::decode(tx["cbor"].as_str().unwrap()).unwrap()).unwrap()[0]
                .clone()
        })
        .collect()
}

/// Lovejoin's preprod token pool, verified: its scripts sit at a key address, so the wallet carries them inline.
fn lj_pool() -> Protocol {
    let outputs = lj_outputs();
    lovejoin::verify_pool(true, &outputs[0], LJ_SEED, &outputs[1..]).unwrap()
}

/// The same pool with its two scripts read by reference: what a pool whose scripts are at the holder is like.
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

/// `n` strangers' boxes of `pool`'s.
fn others(pool: &Protocol, n: u8, first: u8) -> Vec<PoolBox> {
    (0..n).map(|i| made_up_box(pool, None, first + i)).collect()
}

fn session() -> Address {
    let mut raw = vec![0x00];
    raw.extend([0x51; 28]);
    raw.extend([0x52; 28]);
    Address::from_bytes(&raw).unwrap()
}

fn coin(first: u8, lovelace: u64) -> Coin {
    Coin {
        utxo: Resolved {
            tx_hash: [first; 32],
            index: 0,
            output: Output::new(session(), lovelace)
                .build_babbage_raw()
                .unwrap()
                .encode_fragment()
                .unwrap(),
        },
        lovelace,
    }
}

/// A UTxO of the session's holding `boxes` boxes' worth of `pool`'s token, and `extra` of another.
fn token_holding(
    pool: &Protocol,
    first: u8,
    lovelace: u64,
    boxes: u64,
    extra: Option<u64>,
) -> Holding {
    let token = pool.token.clone().unwrap();
    let mut output = Output::new(session(), lovelace)
        .add_asset(
            Hash::new(token.policy),
            token.name.clone(),
            token.quantity * boxes,
        )
        .unwrap();
    if let Some(q) = extra {
        output = output
            .add_asset(Hash::new([0x77; 28]), b"other".to_vec(), q)
            .unwrap();
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

fn funding(coins: Vec<Coin>) -> Funding {
    Funding {
        coins,
        collateral: Some(coin(0xcc, 5_000_000)),
        address: session(),
        deposit_signers: 1,
        mix_signers: 1,
    }
}

fn owners(sk: Scalar, n: usize) -> Vec<Register> {
    let base = Register::create(sk).unwrap();
    (0..n)
        .map(|_| base.clone().rerandomize().unwrap())
        .collect()
}

/// How many of `boxes` transaction `tx` spends.
fn spends(tx: &[u8], boxes: &[PoolBox]) -> usize {
    let tx = MultiEraTx::decode(tx).unwrap();
    tx.inputs()
        .iter()
        .filter(|i| {
            boxes
                .iter()
                .any(|b| b.utxo.tx_hash == **i.hash() && b.utxo.index == i.index())
        })
        .count()
}

// ---------------------------------------------------------------------------
// The width
// ---------------------------------------------------------------------------

#[test]
fn four_wide_fans_a_box_out_over_more_mixes() {
    for depth in 0..=3 {
        assert_eq!(
            lovejoin::mixes_per_box_at(depth, 3),
            lovejoin::mixes_per_box(depth)
        );
    }
    // 1, 5 and 21 mixes; 4, 16 and 64 leaves (lovejoin-mix-width.md).
    assert_eq!(lovejoin::mixes_per_box_at(1, 4), 1);
    assert_eq!(lovejoin::mixes_per_box_at(2, 4), 5);
    assert_eq!(lovejoin::mixes_per_box_at(3, 4), 21);
    assert!(lovejoin::check_width(3).is_ok());
    assert!(lovejoin::check_width(4).is_ok());
    for width in [0, 1, 2, 5, 6] {
        assert!(lovejoin::check_width(width).is_err(), "{width}");
    }
}

// ---------------------------------------------------------------------------
// The planner per pool
// ---------------------------------------------------------------------------

#[test]
fn the_classic_pool_plans_three_wide_exactly_as_before() {
    let classic = Protocol::of(true).unwrap();
    for depth in 0..=3 {
        for boxes in [1, 2, 3, 10, 40] {
            assert_eq!(
                lovejoin::funding_for_in(boxes, &classic, depth, 3),
                lovejoin::funding_for(boxes, depth, classic.denom)
            );
            if depth > 0 {
                assert_eq!(
                    lovejoin::again_funding_in(boxes, &classic, depth, 3),
                    lovejoin::again_funding(boxes, depth)
                );
            }
        }
        for spare in [0, 9_000_000, 16_000_000, 50_000_000, 300_000_000] {
            assert_eq!(
                lovejoin::boxes_affordable_in(spare, &classic, depth, 3),
                lovejoin::boxes_affordable(spare, depth, classic.denom)
            );
            if depth > 0 {
                assert_eq!(
                    lovejoin::again_affordable_in(spare, &classic, depth, 3),
                    lovejoin::again_affordable(spare, depth)
                );
            }
        }
    }
    assert_eq!(lovejoin::again_affordable_in(50_000_000, &classic, 0, 3), 0);
}

#[test]
fn each_pool_plans_on_its_own_mix() {
    let classic = Protocol::of(true).unwrap();
    // Three wide by reference is the classic pool's estimate; four wide is dearer, and scripts inline dearer still.
    assert_eq!(
        lovejoin::mix_fee_estimate(&classic, 3),
        lovejoin::MIX_FEE_ESTIMATE
    );
    assert_eq!(
        lovejoin::mix_fee_estimate(&classic, 4),
        lovejoin::MIX_FEE_ESTIMATE_FOUR
    );
    assert_eq!(
        lovejoin::mix_fee_estimate(&lj_pool_by_reference(), 3),
        lovejoin::MIX_FEE_ESTIMATE
    );
    assert_eq!(
        lovejoin::mix_fee_estimate(&lj_pool(), 3),
        lovejoin::MIX_FEE_ESTIMATE + lovejoin::INLINE_SCRIPTS_ESTIMATE
    );
    assert_eq!(
        lovejoin::mix_fee_estimate(&lj_pool(), 4),
        lovejoin::MIX_FEE_ESTIMATE_FOUR + lovejoin::INLINE_SCRIPTS_ESTIMATE
    );
    // A box at depth 2: its own ADA and four mixes three wide, five four wide.
    let token = lj_pool_by_reference();
    assert_eq!(
        lovejoin::per_box_in(&token, 2, 3),
        token.denom + 4 * lovejoin::MIX_FEE_ESTIMATE
    );
    assert_eq!(
        lovejoin::per_box_in(&token, 2, 4),
        token.denom + 5 * lovejoin::MIX_FEE_ESTIMATE_FOUR
    );
    assert_eq!(
        lovejoin::funding_for_in(2, &classic, 2, 4),
        1_500_000 + 2 * (10_000_000 + 5 * lovejoin::MIX_FEE_ESTIMATE_FOUR)
    );
}

#[test]
fn one_classic_leg_with_no_tokens_plans_as_boxes_affordable() {
    let classic = Protocol::of(true).unwrap();
    for depth in 0..=3 {
        for spare in [0, 9_000_000, 16_000_000, 50_000_000, 300_000_000] {
            let legs = [LegPlan {
                protocol: &classic,
                most: usize::MAX,
                held: 0,
            }];
            assert_eq!(
                lovejoin::plan_across(
                    &params(),
                    &session(),
                    spare,
                    &Assets::new(),
                    &legs,
                    depth,
                    3
                )
                .unwrap(),
                vec![lovejoin::boxes_affordable(spare, depth, classic.denom)]
            );
        }
    }
}

#[test]
fn token_boxes_come_first_and_ada_boxes_take_what_they_leave() {
    let classic = Protocol::of(true).unwrap();
    let pool = lj_pool_by_reference();
    let q = pool.token.clone().unwrap().quantity;
    let tokens = |boxes: u64| token_holding(&pool, 0x10, 2_000_000, boxes, None).tokens;
    let per_token = lovejoin::per_box_in(&pool, 2, 3);
    let per_classic = lovejoin::per_box_in(&classic, 2, 3);
    let legs = |held: u64, most: usize| {
        [
            LegPlan {
                protocol: &pool,
                most,
                held: u128::from(held) * u128::from(q),
            },
            LegPlan {
                protocol: &classic,
                most: usize::MAX,
                held: 0,
            },
        ]
    };
    // Two boxes' worth of the token, and ADA for both and two ADA boxes: the token's boxes take it exactly, so
    // nothing's kept back for a token change.
    let spare = 1_500_000 + 2 * per_token + 2 * per_classic;
    let plan = lovejoin::plan_across(&params(), &session(), spare, &tokens(2), &legs(2, 99), 2, 3)
        .unwrap();
    assert_eq!(plan, vec![2, 2]);
    // The same ADA with five boxes' worth of the token: the token's boxes take the ADA first, all five, and
    // what's left pays for no ADA box.
    let plan = lovejoin::plan_across(&params(), &session(), spare, &tokens(5), &legs(5, 99), 2, 3)
        .unwrap();
    assert_eq!(plan, vec![5, 0]);
    // Its pool has room for one: the rest of the ADA goes to ADA boxes, less the least the token left needs back
    // with the change.
    let plan =
        lovejoin::plan_across(&params(), &session(), spare, &tokens(5), &legs(5, 1), 2, 3).unwrap();
    assert_eq!(plan[0], 1);
    let least = spare - 1_500_000 - per_token - plan[1] as u64 * per_classic;
    assert!(least < per_classic, "{plan:?}");
    // No ADA for a token box: none, and the token comes back as it is.
    let plan = lovejoin::plan_across(
        &params(),
        &session(),
        per_token,
        &tokens(3),
        &legs(3, 99),
        2,
        3,
    )
    .unwrap();
    assert_eq!(plan, vec![0, 0]);
    // Four wide, each box costs more, so the same ADA makes fewer.
    let wide = lovejoin::plan_across(&params(), &session(), spare, &tokens(2), &legs(2, 99), 2, 4)
        .unwrap();
    assert!(wide.iter().sum::<usize>() < 4, "{wide:?}");
    // Another token in the same UTxO stays back with the change: its least is kept back, so fewer ADA boxes fit
    // when the ADA is tight.
    let with_other = token_holding(&pool, 0x10, 2_000_000, 2, Some(9)).tokens;
    let tight = 1_500_000 + 2 * per_token + per_classic + 500_000;
    let plain = lovejoin::plan_across(&params(), &session(), tight, &tokens(2), &legs(2, 99), 2, 3)
        .unwrap();
    let kept = lovejoin::plan_across(
        &params(),
        &session(),
        tight,
        &with_other,
        &legs(2, 99),
        2,
        3,
    )
    .unwrap();
    assert_eq!(plain, vec![2, 1]);
    assert_eq!(kept, vec![2, 0]);
    // Asked of a width there isn't.
    assert!(
        lovejoin::plan_across(&params(), &session(), spare, &tokens(2), &legs(2, 99), 2, 5)
            .is_err()
    );
}

#[test]
fn the_boxes_that_take_every_token_keep_nothing_back_for_a_token_change() {
    // 34e's review, 8: ADA for exactly the token's two boxes. Kept back for a token change, it pays for one, which
    // leaves a token change; kept back for none, it pays for both, which leave none. Both go.
    let classic = Protocol::of(true).unwrap();
    let pool = lj_pool_by_reference();
    let q = pool.token.clone().unwrap().quantity;
    let tokens = token_holding(&pool, 0x10, 2_000_000, 2, None).tokens;
    let legs = [
        LegPlan {
            protocol: &pool,
            most: 99,
            held: 2 * u128::from(q),
        },
        LegPlan {
            protocol: &classic,
            most: usize::MAX,
            held: 0,
        },
    ];
    let spare = 1_500_000 + 2 * lovejoin::per_box_in(&pool, 2, 3);
    let plan = lovejoin::plan_across(&params(), &session(), spare, &tokens, &legs, 2, 3).unwrap();
    assert_eq!(plan, vec![2, 0]);
    // A little less, and the second box isn't paid for: the token left needs its change, kept back.
    let plan =
        lovejoin::plan_across(&params(), &session(), spare - 1, &tokens, &legs, 2, 3).unwrap();
    assert_eq!(plan, vec![1, 0]);
}

// ---------------------------------------------------------------------------
// A chain across pools
// ---------------------------------------------------------------------------

/// An output as the ledger reads it, its tokens sorted: pallas-txbuilder keeps an output's tokens in a `HashMap`, so
/// two builds of one transaction may write an output holding two policies' tokens in either order, by chance.
type ReadOutput = (Vec<u8>, u64, Vec<(Vec<u8>, Vec<u8>, u64)>, Option<Vec<u8>>);
fn read_output(o: &pallas_traverse::MultiEraOutput) -> ReadOutput {
    let value = o.value();
    let mut tokens: Vec<_> = value
        .assets()
        .iter()
        .flat_map(|p| {
            p.assets()
                .iter()
                .map(|a| {
                    (
                        p.policy().to_vec(),
                        a.name().to_vec(),
                        a.output_coin().unwrap_or(0),
                    )
                })
                .collect::<Vec<_>>()
        })
        .collect();
    tokens.sort();
    let datum = match o.datum() {
        Some(pallas_primitives::conway::PseudoDatumOption::Data(d)) => Some(d.raw_cbor().to_vec()),
        _ => None,
    };
    (o.address().unwrap().to_vec(), value.coin(), tokens, datum)
}

/// A transaction as the ledger reads it, each output's tokens sorted (read_output).
fn read_tx(bytes: &[u8]) -> (usize, Vec<String>, Vec<ReadOutput>, Option<u64>) {
    let tx = MultiEraTx::decode(bytes).unwrap();
    let inputs = tx
        .inputs()
        .iter()
        .map(|i| format!("{}#{}", i.hash(), i.index()))
        .collect();
    let outputs = tx.outputs().iter().map(read_output).collect();
    (bytes.len(), inputs, outputs, tx.fee())
}

/// UTxOs a transaction made, at their indexes, as the ledger reads them: not by the transaction's id, which follows
/// the order its outputs' tokens were written in (read_output).
fn read_made(utxos: &[&Resolved]) -> Vec<(u64, ReadOutput)> {
    utxos
        .iter()
        .map(|u| {
            let o =
                pallas_traverse::MultiEraOutput::decode(pallas_traverse::Era::Conway, &u.output)
                    .unwrap();
            (u.index, read_output(&o))
        })
        .collect()
}

#[test]
fn one_leg_deposits_exactly_as_deposit_from() {
    let pool = lj_pool_by_reference();
    let registers = owners(Scalar::from(5u64), 3);
    // One token: byte for byte. With another beside it in the token change, the same transaction, its tokens in
    // whichever order the builder wrote them (read_tx).
    for extra in [None, Some(9)] {
        let inputs = vec![
            token_holding(&pool, 0x10, 3_000_000, 5, extra),
            Holding::from(&coin(0x11, 20_000_000)),
        ];
        let one =
            lovejoin::deposit_from(&params(), &pool, &inputs, &registers, &session(), 1).unwrap();
        let across =
            lovejoin::deposit_across(&params(), &[(&pool, &registers)], &inputs, &session(), 1)
                .unwrap();
        if extra.is_none() {
            assert_eq!(one.tx.tx_bytes.0, across.tx.tx_bytes.0);
            assert_eq!(one.boxes, across.boxes);
            assert_eq!(one.token_change, across.token_change);
        }
        assert_eq!(read_tx(&one.tx.tx_bytes.0), read_tx(&across.tx.tx_bytes.0));
        assert_eq!(one.fee, across.fee);
        let boxes =
            |d: &lovejoin::Deposit| read_made(&d.boxes.iter().map(|b| &b.utxo).collect::<Vec<_>>());
        let change = |d: &lovejoin::Deposit| {
            read_made(&d.token_change.iter().map(|h| &h.utxo).collect::<Vec<_>>())
        };
        assert_eq!(boxes(&one), boxes(&across));
        assert_eq!(change(&one), change(&across));
    }
}

#[test]
fn a_deposit_across_pools_puts_each_box_in_its_own_pool() {
    let classic = Protocol::of(true).unwrap();
    let pool = lj_pool_by_reference();
    let sk = Scalar::from(17u64);
    let (in_classic, in_token) = (owners(sk, 2), owners(sk, 3));
    let inputs = vec![
        token_holding(&pool, 0x10, 2_000_000, 4, None),
        Holding::from(&coin(0x11, 40_000_000)),
    ];
    let deposit = lovejoin::deposit_across(
        &params(),
        &[(&pool, &in_token), (&classic, &in_classic)],
        &inputs,
        &session(),
        1,
    )
    .unwrap();
    assert_eq!(deposit.boxes.len(), 5);
    // The token pool's three first, then the classic pool's two, each a box of its own pool alone.
    for b in &deposit.boxes[..3] {
        assert!(PoolBox::from_resolved(b.utxo.clone(), &pool).is_some());
        assert!(PoolBox::from_resolved(b.utxo.clone(), &classic).is_none());
        assert!(b.is_owned(&sk));
    }
    for b in &deposit.boxes[3..] {
        assert!(PoolBox::from_resolved(b.utxo.clone(), &classic).is_some());
        assert!(PoolBox::from_resolved(b.utxo.clone(), &pool).is_none());
    }
    // The fourth box's worth of the token comes back apart, with its least; the ADA change is last.
    assert_eq!(deposit.token_change.len(), 1);
    let token = pool.token.clone().unwrap();
    assert_eq!(
        deposit.token_change[0]
            .tokens
            .quantity_of(hex::encode(token.policy), hex::encode(&token.name))
            .unwrap(),
        Some(token.quantity)
    );
    assert_eq!(
        deposit.change.lovelace,
        42_000_000
            - 3 * pool.denom
            - 2 * classic.denom
            - deposit.token_change[0].lovelace
            - deposit.fee
    );
    // Too little of the token for the boxes asked: refused.
    let short = vec![
        token_holding(&pool, 0x10, 2_000_000, 2, None),
        Holding::from(&coin(0x11, 40_000_000)),
    ];
    assert!(
        lovejoin::deposit_across(
            &params(),
            &[(&pool, &in_token), (&classic, &in_classic)],
            &short,
            &session(),
            1,
        )
        .is_err()
    );
}

#[test]
fn a_chain_across_pools_mixes_each_leg_in_its_own_pool() {
    let classic = Protocol::of(true).unwrap();
    let pool = lj_pool_by_reference();
    let sk = Scalar::from(987_654_321u64);
    let (in_token, in_classic) = (owners(sk, 1), owners(sk, 1));
    let (token_others, classic_others) = (others(&pool, 2, 0x50), others(&classic, 2, 0x70));
    let legs = [
        Leg {
            protocol: &pool,
            owners: &in_token,
            pool: &token_others,
        },
        Leg {
            protocol: &classic,
            owners: &in_classic,
            pool: &classic_others,
        },
    ];
    let tokens = vec![token_holding(&pool, 0x10, 2_000_000, 1, None)];
    let chain = lovejoin::chain_across(
        &params(),
        &funding(vec![coin(0x11, 30_000_000)]),
        &tokens,
        &legs,
        1,
        3,
    )
    .unwrap();
    // One deposit, then one mix in each pool: the token pool's first, as the legs go.
    assert_eq!(
        chain.txs.iter().map(|t| t.kind).collect::<Vec<_>>(),
        ["deposit", "mix", "mix"]
    );
    assert_eq!(spends(&chain.txs[1].tx.tx_bytes.0, &token_others), 2);
    assert_eq!(spends(&chain.txs[1].tx.tx_bytes.0, &classic_others), 0);
    assert_eq!(spends(&chain.txs[2].tx.tx_bytes.0, &classic_others), 2);
    assert_eq!(spends(&chain.txs[2].tx.tx_bytes.0, &token_others), 0);
    // A leaf for each box, in the legs' order, each the wallet's and in its own pool.
    assert_eq!(chain.leaves.len(), 2);
    assert!(PoolBox::from_resolved(chain.leaves[0].utxo.clone(), &pool).is_some());
    assert!(PoolBox::from_resolved(chain.leaves[1].utxo.clone(), &classic).is_some());
    assert!(chain.leaves.iter().all(|l| l.is_owned(&sk)));
    // Each mix paid from the one before's change.
    let fees: u64 = chain.txs.iter().map(|t| t.fee).sum();
    assert_eq!(
        chain.change.lovelace,
        32_000_000 - pool.denom - classic.denom - fees
    );
    // A pool short for its leg: the chain isn't built, and says which way it's short.
    let short = [
        legs[0],
        Leg {
            protocol: &classic,
            owners: &in_classic,
            pool: &classic_others[..1],
        },
    ];
    let err = lovejoin::chain_across(
        &params(),
        &funding(vec![coin(0x11, 30_000_000)]),
        &tokens,
        &short,
        1,
        3,
    )
    .unwrap_err();
    assert_eq!(
        err.downcast_ref::<PoolShort>(),
        Some(&PoolShort { have: 1, needed: 2 })
    );
}

#[test]
fn a_four_wide_chain_mixes_four_boxes_at_a_time() {
    let classic = Protocol::of(true).unwrap();
    let sk = Scalar::from(4_444u64);
    let mine = owners(sk, 1);
    let pool = others(&classic, 3, 0x30);
    let legs = [Leg {
        protocol: &classic,
        owners: &mine,
        pool: &pool,
    }];
    let funded = lovejoin::funding_for_in(1, &classic, 1, 4);
    let chain = lovejoin::chain_across(
        &params(),
        &funding(vec![coin(0x11, funded)]),
        &[],
        &legs,
        1,
        4,
    )
    .unwrap();
    assert_eq!(chain.txs.len(), 2);
    let mix = MultiEraTx::decode(&chain.txs[1].tx.tx_bytes.0).unwrap();
    // Four boxes in (ours and three others), the fee input, and four boxes out besides the change.
    assert_eq!(spends(&chain.txs[1].tx.tx_bytes.0, &pool), 3);
    assert_eq!(mix.inputs().len(), 5);
    assert_eq!(mix.outputs().len(), 5);
    assert!(
        chain.txs[1].fee <= lovejoin::MIX_FEE_ESTIMATE_FOUR,
        "{}",
        chain.txs[1].fee
    );
    assert!(
        chain.txs[1].fee > lovejoin::MIX_FEE_ESTIMATE,
        "{}",
        chain.txs[1].fee
    );
    assert!(chain.leaves[0].is_owned(&sk));
    // Two others aren't enough for four a mix, though they are for three.
    let err = lovejoin::chain_across(
        &params(),
        &funding(vec![coin(0x11, funded)]),
        &[],
        &[Leg {
            pool: &pool[..2],
            ..legs[0]
        }],
        1,
        4,
    )
    .unwrap_err();
    assert_eq!(
        err.downcast_ref::<PoolShort>(),
        Some(&PoolShort { have: 2, needed: 3 })
    );
    // The wallet's own boxes mixed again, four wide.
    let ours = vec![made_up_box(&classic, Some(&sk), 0x40)];
    let payer = lovejoin::Payer {
        fee: coin(0x47, lovejoin::again_funding_in(1, &classic, 1, 4)),
        collateral: Some(coin(0xcc, 5_000_000)),
        address: session(),
        signers: 1,
    };
    let again = lovejoin::again_at(&params(), &classic, &payer, &ours, 1, 4, &pool).unwrap();
    assert_eq!(again.txs.len(), 1);
    assert_eq!(spends(&again.txs[0].tx.tx_bytes.0, &pool), 3);
    // A width that isn't one.
    assert!(lovejoin::again_at(&params(), &classic, &payer, &ours, 1, 5, &pool).is_err());
}
