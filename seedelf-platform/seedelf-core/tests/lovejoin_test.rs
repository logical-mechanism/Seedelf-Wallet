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
    }
}

fn payer(fee: u64) -> Payer {
    Payer {
        fee: coin(0x11, fee),
        collateral: coin(0x22, 5_000_000),
        address: key_address(0x33),
    }
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
    assert!(short.to_string().contains("can't pay"), "{short}");
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
    };
    let mix = lovejoin::mix(&params, &protocol, &boxes, &payer).unwrap();
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
    let destination = owner.rerandomize().unwrap();
    let withdraw =
        lovejoin::withdraw(&params, &protocol, &[ours], &sk, destination.clone()).unwrap();
    assert_eq!(withdraw.lovelace, protocol.denom - withdraw.fee);
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
}
