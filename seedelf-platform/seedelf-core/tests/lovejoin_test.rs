//! Lovejoin's transactions (`seedelf_core::lovejoin`), each measured offline
//! against the deployed preprod scripts: a wrong proof, context or layout
//! fails here, not on chain.

use blstrs::Scalar;
use pallas_codec::minicbor;
use pallas_primitives::conway::{PlutusData, Redeemers};
use pallas_primitives::{Fragment, MaybeIndefArray};
use pallas_traverse::MultiEraTx;
use seedelf_core::eval::Resolved;
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, Protocol};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::ProtocolParameters;
use serde_json::{Value, json};

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/eval-preprod.json")).expect("fixture")
}

fn case(name: &str) -> Value {
    fixture()["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"].as_str().unwrap().starts_with(name))
        .unwrap()
        .clone()
}

fn resolved(case: &Value) -> Vec<Resolved> {
    case["utxos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| Resolved {
            tx_hash: hex::decode(u["tx_hash"].as_str().unwrap())
                .unwrap()
                .try_into()
                .unwrap(),
            index: u["index"].as_u64().unwrap(),
            output: hex::decode(u["output"].as_str().unwrap()).unwrap(),
        })
        .collect()
}

/// Preprod's parameters at epoch 315, with its 350-entry V3 cost model.
fn params() -> ProtocolParameters {
    let cost_model = case("seedelf spend")["cost_model_v3"].clone();
    ProtocolParameters::from_koios(&json!({
        "min_fee_a": 44,
        "min_fee_b": 155381,
        "coins_per_utxo_size": "4310",
        "key_deposit": "2000000",
        "price_mem": 0.0577,
        "price_step": 0.0000721,
        "cost_models": { "PlutusV3": cost_model },
    }))
    .unwrap()
}

fn pool_boxes(protocol: &Protocol) -> Vec<PoolBox> {
    // The boxes a recorded preprod mix took.
    resolved(&case("lovejoin mix N=3 wallet"))
        .into_iter()
        .filter_map(|r| PoolBox::from_resolved(r, protocol))
        .collect()
}

/// An enterprise key address on preprod, and an ADA-only UTxO at it.
fn key_address(seed: u8) -> pallas_addresses::Address {
    let mut raw = vec![0x60];
    raw.extend([seed; 28]);
    pallas_addresses::Address::from_bytes(&raw).unwrap()
}

fn coin(seed: u8, lovelace: u64) -> Coin {
    let mut e = minicbor::Encoder::new(Vec::new());
    e.map(2)
        .unwrap()
        .u8(0)
        .unwrap()
        .bytes(&key_address(seed).to_vec())
        .unwrap();
    e.u8(1).unwrap().u64(lovelace).unwrap();
    Coin {
        utxo: Resolved {
            tx_hash: [seed; 32],
            index: 0,
            output: e.into_writer(),
        },
        lovelace,
    }
}

fn funding(coins: &[Coin]) -> lovejoin::Funding {
    lovejoin::Funding {
        coins: coins.to_vec(),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
        deposit_signers: 1,
        mix_signers: 1,
    }
}

fn payer(fee: u64) -> Payer {
    Payer {
        fee: coin(0x11, fee),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
        signers: 1,
    }
}

/// The ledger's collateral rule: what the collateral puts up (its `lovelace`
/// less the collateral return) is at least 150% of the fee, rounded up.
fn collateral_is_enough(tx_cbor: &[u8], lovelace: u64) {
    let tx = MultiEraTx::decode(tx_cbor).unwrap();
    let fee = tx.fee().unwrap();
    let back = tx.collateral_return().unwrap().value().coin();
    assert!(
        lovelace - back >= (fee * 3).div_ceil(2),
        "fee {fee}: {} put up, {} needed",
        lovelace - back,
        (fee * 3).div_ceil(2)
    );
}

#[test]
fn the_owner_context_is_the_ledgers() {
    // The recorded withdraw's own proofs verify against the context read from
    // it: the outputs and input references encode as the ledger's do.
    let protocol = Protocol::of(true).unwrap();
    let case = case("lovejoin withdraw");
    let bytes = hex::decode(case["tx"].as_str().unwrap()).unwrap();
    let ctx = lovejoin::owner_context(&bytes, &protocol.mix_box_hash).unwrap();

    let tx = MultiEraTx::decode(&bytes).unwrap();
    let conway = tx.as_conway().unwrap();
    let reward_data = match conway
        .transaction_witness_set
        .redeemer
        .as_ref()
        .unwrap()
        .clone()
        .unwrap()
    {
        Redeemers::List(list) => list
            .iter()
            .find(|r| r.tag == pallas_primitives::conway::RedeemerTag::Reward)
            .unwrap()
            .data
            .clone(),
        Redeemers::Map(map) => map
            .iter()
            .find(|(k, _)| k.tag == pallas_primitives::conway::RedeemerTag::Reward)
            .unwrap()
            .1
            .data
            .clone(),
    };
    let reward = &reward_data;
    let PlutusData::Constr(owner) = reward else {
        panic!()
    };
    let PlutusData::Array(proofs) = &owner.fields[0] else {
        panic!()
    };

    let mut boxes: Vec<PoolBox> = resolved(&case)
        .into_iter()
        .filter_map(|r| PoolBox::from_resolved(r, &protocol))
        .collect();
    boxes.sort_by_key(|b| (b.utxo.tx_hash, b.utxo.index));
    assert_eq!(boxes.len(), 4);
    for (boxed, proof) in boxes.iter().zip(proofs.iter()) {
        let PlutusData::Constr(p) = proof else {
            panic!()
        };
        let (PlutusData::BoundedBytes(t), PlutusData::BoundedBytes(z)) =
            (&p.fields[0], &p.fields[1])
        else {
            panic!()
        };
        let proof = crypto::SchnorrProof {
            t: t.to_vec().try_into().unwrap(),
            z: z.to_vec().try_into().unwrap(),
        };
        let a = crypto::point_from_bytes(&boxed.a).unwrap();
        let b = crypto::point_from_bytes(&boxed.b).unwrap();
        assert!(crypto::verify_schnorr(&a, &b, &proof, &ctx));
    }
}

#[test]
fn input_references_serialise_as_lovejoins_vectors() {
    use pallas_primitives::conway::TransactionInput;
    use uplc::tx::to_plutus_data::ToPlutusData;
    let doc: Value = serde_json::from_str(include_str!(
        "../../seedelf-crypto/tests/vectors/lovejoin_v1.json"
    ))
    .unwrap();
    let mut seen = 0;
    for v in doc["encoding"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["kind"] == "output_refs")
    {
        let refs: Vec<TransactionInput> = v["refs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| TransactionInput {
                transaction_id: r["tx_id"].as_str().unwrap().parse().unwrap(),
                index: r["output_index"].as_u64().unwrap(),
            })
            .collect();
        let got = uplc::plutus_data_to_bytes(&refs.to_plutus_data());
        assert_eq!(hex::encode(got), v["expected_serialize"].as_str().unwrap());
        seen += 1;
    }
    assert_eq!(seen, 40);
}

#[test]
fn a_mix_of_pool_boxes_passes_mix_logic() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    assert_eq!(boxes.len(), 3);
    let mix = lovejoin::mix(&params(), &protocol, &boxes, &payer(20_000_000)).unwrap();
    assert_eq!(mix.outputs.len(), 3);
    let mut moved = mix.moved_to.clone();
    moved.sort();
    assert_eq!(moved, vec![0, 1, 2]);
    // About what the same mix cost on preprod (876,825 lovelace).
    assert!((800_000..1_000_000).contains(&mix.fee), "fee {}", mix.fee);
    assert_eq!(mix.change.lovelace, 20_000_000 - mix.fee);
    // The new boxes are boxes a mix may take.
    for out in &mix.outputs {
        assert!(PoolBox::from_resolved(out.utxo.clone(), &protocol).is_some());
    }
}

#[test]
fn a_mix_needs_two_boxes_and_a_payer_who_can_pay() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    assert!(lovejoin::mix(&params(), &protocol, &boxes[..1], &payer(20_000_000)).is_err());
    let short = lovejoin::mix(&params(), &protocol, &boxes, &payer(300_000)).unwrap_err();
    assert!(short.to_string().contains("enough ADA left"), "{short}");
}

#[test]
fn deposit_mix_and_withdraw_chain_before_anything_is_on_chain() {
    let protocol = Protocol::of(true).unwrap();
    let params = params();
    let sk = Scalar::from(987_654_321u64);
    let owner = Register::create(sk).unwrap();

    // The session deposits two boxes, owned by the Seedelf key.
    let owners = vec![
        owner.clone().rerandomize().unwrap(),
        owner.clone().rerandomize().unwrap(),
    ];
    let deposit = lovejoin::deposit(
        &params,
        &protocol,
        &[coin(0x44, 40_000_000)],
        &owners,
        &key_address(0x33),
        1,
    )
    .unwrap();
    assert_eq!(deposit.boxes.len(), 2);
    assert!(deposit.boxes.iter().all(|b| b.is_owned(&sk)));
    assert_eq!(
        deposit.change.lovelace,
        40_000_000 - 20_000_000 - deposit.fee
    );

    // A mix of one of them with two pool boxes, paid from the deposit's change,
    // spends outputs that exist only in the unsent deposit.
    let mut boxes = pool_boxes(&protocol)[..2].to_vec();
    boxes.push(deposit.boxes[0].clone());
    let payer = Payer {
        fee: deposit.change.clone(),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
        signers: 1,
    };
    let mix = lovejoin::mix(&params, &protocol, &boxes, &payer).unwrap();
    collateral_is_enough(&mix.tx.tx_bytes.0, 5_000_000);
    let ours: Vec<&PoolBox> = mix.outputs.iter().filter(|b| b.is_owned(&sk)).collect();
    assert_eq!(ours.len(), 1, "exactly one output is still ours");
    assert_eq!(mix.outputs[mix.moved_to[2]], *ours[0]);

    // A second mix chains on the first's change and outputs.
    let payer = Payer {
        fee: mix.change.clone(),
        ..payer
    };
    let mut again = mix.outputs.clone();
    again.push(pool_boxes(&protocol)[2].clone());
    let second = lovejoin::mix(&params, &protocol, &again, &payer).unwrap();
    assert_eq!(second.outputs.iter().filter(|b| b.is_owned(&sk)).count(), 1);

    // The box comes back into a fresh register, paid from itself.
    let ours = second
        .outputs
        .iter()
        .find(|b| b.is_owned(&sk))
        .unwrap()
        .clone();
    let destination = owner.clone().rerandomize().unwrap();
    let withdraw =
        lovejoin::withdraw(&params, &protocol, &[ours], &sk, destination.clone()).unwrap();
    assert_eq!(withdraw.lovelace, protocol.denom - withdraw.fee);
    // giveme.my's 5 ₳ covers it as the ledger counts, and every one of several draws does.
    collateral_is_enough(&withdraw.tx.tx_bytes.0, 5_000_000);
    for _ in 0..6 {
        let again = lovejoin::withdraw(
            &params,
            &protocol,
            &[second
                .outputs
                .iter()
                .find(|b| b.is_owned(&sk))
                .unwrap()
                .clone()],
            &sk,
            owner.clone().rerandomize().unwrap(),
        )
        .unwrap();
        assert_eq!(again.fee % 2, 0, "an even fee, so 3/2 of it is whole");
        collateral_is_enough(&again.tx.tx_bytes.0, 5_000_000);
    }
    assert!(
        (200_000..600_000).contains(&withdraw.fee),
        "fee {}",
        withdraw.fee
    );
    let outputs = seedelf_core::eval::resolve_outputs(&withdraw.tx.tx_bytes.0).unwrap();
    assert_eq!(outputs.len(), 1);
    let pallas_primitives::conway::TransactionOutput::PostAlonzo(out) =
        minicbor::decode(&outputs[0].output).unwrap()
    else {
        panic!("a post-Alonzo output")
    };
    let Some(pallas_primitives::conway::DatumOption::Data(data)) = out.datum_option else {
        panic!("an inline datum")
    };
    assert_eq!(
        data.0.encode_fragment().unwrap(),
        destination.to_vec().unwrap()
    );
}

#[test]
fn someone_elses_box_is_not_withdrawn() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let sk = Scalar::from(5u64);
    let destination = Register::create(sk).unwrap().rerandomize().unwrap();
    let err = lovejoin::withdraw(&params(), &protocol, &boxes[..1], &sk, destination).unwrap_err();
    assert!(err.to_string().contains("isn't this wallet's"), "{err}");
}

#[test]
fn the_box_datum_is_canonical_and_reads_back() {
    let a = [0xaa; 48];
    let b = [0xbb; 48];
    let datum = lovejoin::mix_datum(&a, &b);
    assert_eq!(&datum[..3], &[0xd8, 0x79, 0x9f]);
    assert_eq!(*datum.last().unwrap(), 0xff);
    // Plutus data reads it as Constr 0 [a, b].
    let PlutusData::Constr(c) = PlutusData::decode_fragment(&datum).unwrap() else {
        panic!()
    };
    assert_eq!(c.tag, 121);
    assert!(matches!(c.fields, MaybeIndefArray::Indef(_)));
}

#[test]
fn lovejoin_is_not_on_mainnet() {
    assert!(Protocol::of(false).is_err());
}

/// Every box the recorded Lovejoin transactions spent, once each.
fn all_pool_boxes(protocol: &Protocol) -> Vec<PoolBox> {
    let mut boxes: Vec<PoolBox> = Vec::new();
    for name in [
        "lovejoin withdraw",
        "lovejoin mix N=4",
        "lovejoin mix N=3 wallet",
        "lovejoin mix N=3 shard",
    ] {
        for r in resolved(&case(name)) {
            if let Some(b) = PoolBox::from_resolved(r, protocol)
                && !boxes.iter().any(|x| x.utxo == b.utxo)
            {
                boxes.push(b);
            }
        }
    }
    boxes
}

#[test]
fn a_chain_fans_each_box_out_and_keeps_track_of_ours() {
    let protocol = Protocol::of(true).unwrap();
    let params = params();
    let sk = Scalar::from(42u64);
    let base = Register::create(sk).unwrap();
    let pool = all_pool_boxes(&protocol);
    assert!(pool.len() >= 8, "{} recorded boxes", pool.len());

    // One box, two waves deep: 1 + 3 mixes, 8 fresh boxes.
    let owners = vec![base.clone().rerandomize().unwrap()];
    let coins = [coin(0x44, 20_000_000)];
    let chain = lovejoin::chain(&params, &protocol, &funding(&coins), &owners, 2, &pool).unwrap();
    assert_eq!(chain.txs.len(), 1 + lovejoin::mixes_per_box(2));
    assert_eq!(chain.txs[0].kind, "deposit");
    assert!(chain.txs[1..].iter().all(|t| t.kind == "mix"));
    assert_eq!(chain.leaves.len(), 1);
    assert!(chain.leaves[0].is_owned(&sk));
    let fees: u64 = chain.txs.iter().map(|t| t.fee).sum();
    assert_eq!(chain.change.lovelace, 20_000_000 - 10_000_000 - fees);
    // Each transaction spends the one before's change: nothing waits on chain.
    for pair in chain.txs.windows(2) {
        let before = MultiEraTx::decode(&pair[0].tx.tx_bytes.0).unwrap().hash();
        let after = MultiEraTx::decode(&pair[1].tx.tx_bytes.0).unwrap();
        assert!(
            after.inputs().iter().any(|i| *i.hash() == before),
            "chained on its parent"
        );
    }

    // Two boxes, one wave: two mixes, and both leaves are ours.
    let owners = vec![
        base.clone().rerandomize().unwrap(),
        base.rerandomize().unwrap(),
    ];
    let coins = [coin(0x44, 30_000_000)];
    let chain = lovejoin::chain(&params, &protocol, &funding(&coins), &owners, 1, &pool).unwrap();
    assert_eq!(chain.txs.len(), 3);
    assert_eq!(chain.leaves.len(), 2);
    assert!(chain.leaves.iter().all(|b| b.is_owned(&sk)));
}

#[test]
fn a_chain_needs_enough_pool_boxes() {
    let protocol = Protocol::of(true).unwrap();
    let owners = vec![
        Register::create(Scalar::from(7u64))
            .unwrap()
            .rerandomize()
            .unwrap(),
    ];
    let pool = all_pool_boxes(&protocol)[..3].to_vec();
    let err = lovejoin::chain(
        &params(),
        &protocol,
        &funding(&[coin(0x44, 20_000_000)]),
        &owners,
        2,
        &pool,
    )
    .unwrap_err();
    assert!(err.to_string().contains("pool has 3 boxes"), "{err}");
}

#[test]
fn boxes_are_planned_on_what_the_session_can_pay() {
    // Depth 2: a box and four mixes, about 13.8 ₳.
    assert_eq!(lovejoin::boxes_affordable(9_000_000, 2, 10_000_000), 0);
    assert_eq!(lovejoin::boxes_affordable(16_000_000, 2, 10_000_000), 1);
    assert_eq!(lovejoin::boxes_affordable(50_000_000, 2, 10_000_000), 3);
    assert_eq!(lovejoin::mixes_per_box(1), 1);
    assert_eq!(lovejoin::mixes_per_box(2), 4);
    assert_eq!(lovejoin::mixes_per_box(3), 13);
    // Funding for k boxes is the plan run backwards: it pays for exactly k.
    for depth in 1..=3 {
        for boxes in 1..=5 {
            let funded = lovejoin::funding_for(boxes, depth, 10_000_000);
            assert_eq!(lovejoin::boxes_affordable(funded, depth, 10_000_000), boxes);
            assert_eq!(
                lovejoin::boxes_affordable(funded - 1, depth, 10_000_000),
                boxes - 1
            );
        }
    }
    assert_eq!(lovejoin::funding_for(1, 2, 10_000_000), 15_300_000);
}

#[test]
fn a_chain_funded_for_its_boxes_goes_through_and_keeps_its_change() {
    // Exactly what the tile funds a one-time account with for two boxes at depth 1.
    let protocol = Protocol::of(true).unwrap();
    let owner = Register::create(Scalar::from(42u64)).unwrap();
    let owners = vec![
        owner.clone().rerandomize().unwrap(),
        owner.rerandomize().unwrap(),
    ];
    let funded = lovejoin::funding_for(2, 1, protocol.denom);
    let built = lovejoin::chain(
        &params(),
        &protocol,
        &funding(&[coin(0x44, funded)]),
        &owners,
        1,
        &all_pool_boxes(&protocol),
    )
    .unwrap();
    assert_eq!(built.txs.len(), 3);
    // What the mixes didn't use comes back: more than an output's least.
    assert!(
        built.change.lovelace > 1_000_000,
        "{}",
        built.change.lovelace
    );
}

#[test]
fn a_mix_never_leaves_change_under_an_outputs_least() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let err = lovejoin::mix(&params(), &protocol, &boxes, &payer(1_500_000)).unwrap_err();
    assert!(err.to_string().contains("keep the change"), "{err}");
}

/// `count` boxes of `sk`'s, as a deposit (not on chain) leaves them in the pool.
fn our_boxes(sk: Scalar, count: usize) -> Vec<PoolBox> {
    let protocol = Protocol::of(true).unwrap();
    let base = Register::create(sk).unwrap();
    let owners: Vec<Register> = (0..count)
        .map(|_| base.clone().rerandomize().unwrap())
        .collect();
    lovejoin::deposit(
        &params(),
        &protocol,
        &[coin(0x55, 50_000_000)],
        &owners,
        &key_address(0x55),
        1,
    )
    .unwrap()
    .boxes
}

#[test]
fn boxes_of_ours_in_the_pool_fan_out_again_with_no_deposit() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(42u64);
    let ours = our_boxes(sk, 2);
    // The pool as Koios lists it: ours among the others, left out of the draw.
    let mut pool = all_pool_boxes(&protocol);
    pool.extend(ours.iter().cloned());

    let funded = lovejoin::again_funding(2, 1);
    let paying = Payer {
        fee: coin(0x44, funded),
        ..payer(0)
    };
    let chain = lovejoin::again(&params(), &protocol, &paying, &ours, 1, &pool).unwrap();
    // One wave: a mix for each box, and nothing else.
    assert_eq!(chain.txs.len(), 2);
    assert!(chain.txs.iter().all(|t| t.kind == "mix"));
    assert_eq!(chain.leaves.len(), 2);
    assert!(chain.leaves.iter().all(|b| b.is_owned(&sk)));
    assert!(chain.leaves.iter().all(|b| !ours.contains(b)), "moved");
    // Each of our boxes is in a mix with two boxes that aren't ours.
    let spent: Vec<(Vec<u8>, u64)> = chain
        .txs
        .iter()
        .flat_map(|t| {
            MultiEraTx::decode(&t.tx.tx_bytes.0)
                .unwrap()
                .inputs()
                .iter()
                .map(|i| (i.hash().to_vec(), i.index()))
                .collect::<Vec<_>>()
        })
        .collect();
    for b in &ours {
        let count = spent
            .iter()
            .filter(|(h, i)| *h == b.utxo.tx_hash.to_vec() && *i == b.utxo.index)
            .count();
        assert_eq!(count, 1, "each of ours mixed once");
    }
    // The first mix pays from the funding; each after from the one before's change.
    let first = MultiEraTx::decode(&chain.txs[0].tx.tx_bytes.0).unwrap();
    assert!(first.inputs().iter().any(|i| **i.hash() == [0x44; 32]));
    let second = MultiEraTx::decode(&chain.txs[1].tx.tx_bytes.0).unwrap();
    assert!(second.inputs().iter().any(|i| *i.hash() == first.hash()));
    let fees: u64 = chain.txs.iter().map(|t| t.fee).sum();
    assert_eq!(chain.change.lovelace, funded - fees);
    // What the mixes didn't use comes back: more than an output's least.
    assert!(
        chain.change.lovelace > 1_000_000,
        "{}",
        chain.change.lovelace
    );
    for t in &chain.txs {
        collateral_is_enough(&t.tx.tx_bytes.0, 5_000_000);
    }
}

#[test]
fn mixing_again_needs_a_box_and_enough_others() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(42u64);
    let ours = our_boxes(sk, 1);
    let err = lovejoin::again(
        &params(),
        &protocol,
        &payer(20_000_000),
        &[],
        1,
        &all_pool_boxes(&protocol),
    )
    .unwrap_err();
    assert!(err.to_string().contains("no box to mix again"), "{err}");
    // Ours don't count among the boxes to mix with.
    let mut pool = vec![all_pool_boxes(&protocol)[0].clone()];
    pool.extend(ours.iter().cloned());
    let err =
        lovejoin::again(&params(), &protocol, &payer(20_000_000), &ours, 1, &pool).unwrap_err();
    assert!(err.to_string().contains("pool has 1 boxes"), "{err}");
}

#[test]
fn mixing_again_is_planned_on_the_mixes_alone() {
    // Depth 2: four mixes a box, about 3.8 ₳, and no box to pay for.
    assert_eq!(lovejoin::again_affordable(4_000_000, 2), 0);
    assert_eq!(lovejoin::again_affordable(5_300_000, 2), 1);
    for depth in 1..=3 {
        for boxes in 1..=5 {
            let funded = lovejoin::again_funding(boxes, depth);
            assert_eq!(lovejoin::again_affordable(funded, depth), boxes);
            assert_eq!(lovejoin::again_affordable(funded - 1, depth), boxes - 1);
        }
    }
    assert_eq!(lovejoin::again_funding(1, 2), 5_300_000);
}
