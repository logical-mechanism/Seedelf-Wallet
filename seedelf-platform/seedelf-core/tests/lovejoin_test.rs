//! Lovejoin's transactions (`seedelf_core::lovejoin`), each measured offline
//! against the deployed preprod scripts: a wrong proof, context or layout
//! fails here, not on chain. Mainnet's are in `lovejoin_mainnet_test.rs`.

use blstrs::Scalar;
use pallas_codec::minicbor;
use pallas_primitives::conway::{PlutusData, Redeemers};
use pallas_primitives::{Fragment, MaybeIndefArray};
use pallas_traverse::MultiEraTx;
use seedelf_core::eval::Resolved;
use seedelf_core::lovejoin::{self, Coin, Payer, PoolBox, PoolShort, Protocol, Rewards};
use seedelf_crypto::lovejoin as crypto;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, Ratio};
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
        "min_fee_ref_script_cost_per_byte": 15,
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
        collateral: Some(coin(0x22, 5_000_000)),
        address: key_address(0x33),
        deposit_signers: 1,
        mix_signers: 1,
    }
}

fn payer(fee: u64) -> Payer {
    Payer {
        fee: coin(0x11, fee),
        collateral: Some(coin(0x22, 5_000_000)),
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
    let mix = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
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
    // In its own words, before the sigma-OR would refuse it in others (chunk 51, t1c#12).
    let one = lovejoin::mix(
        &params(),
        &protocol,
        &boxes[..1],
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(one.to_string().contains("at least two boxes"), "{one}");
    let short = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(300_000),
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(short.to_string().contains("enough ADA left"), "{short}");
}

#[test]
fn a_mix_never_pays_a_fee_over_the_limit() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    // A public account's collateral can cover far more than a mix's fee.
    let rich = Payer {
        fee: coin(0x11, 30_000_000),
        collateral: Some(coin(0x22, 50_000_000)),
        address: key_address(0x33),
        signers: 2,
    };
    let wrong = ProtocolParameters {
        min_fee_b: 12_000_000,
        ..params()
    };
    let err = lovejoin::mix(&wrong, &protocol, &boxes, &rich, &mut Rewards::none()).unwrap_err();
    assert!(err.to_string().contains("over the wallet's limit"), "{err}");
}

#[test]
fn a_mix_prices_its_reference_scripts_from_the_parameters() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let today = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
    let dearer = ProtocolParameters {
        min_fee_ref_script_cost_per_byte: Ratio::whole(45),
        ..params()
    };
    let mix = lovejoin::mix(
        &dearer,
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
    // mix_box's 629 bytes and mix_logic's 3,156, at 30 lovelace a byte more.
    // A proof's scalars move the measured budget by a hair between builds.
    let more = mix.fee - today.fee;
    assert!(more.abs_diff(3_785 * 30) < 100, "{more}");
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
        collateral: Some(coin(0x22, 5_000_000)),
        address: key_address(0x33),
        signers: 1,
    };
    let mix = lovejoin::mix(&params, &protocol, &boxes, &payer, &mut Rewards::none()).unwrap();
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
    let second = lovejoin::mix(&params, &protocol, &again, &payer, &mut Rewards::none()).unwrap();
    assert_eq!(second.outputs.iter().filter(|b| b.is_owned(&sk)).count(), 1);

    // The box comes back into a fresh register, paid from itself.
    let ours = second
        .outputs
        .iter()
        .find(|b| b.is_owned(&sk))
        .unwrap()
        .clone();
    let destination = owner.clone().rerandomize().unwrap();
    let withdraw = lovejoin::withdraw(
        &params,
        &protocol,
        &[ours],
        &sk,
        destination.clone(),
        &mut Rewards::none(),
    )
    .unwrap();
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
            &mut Rewards::none(),
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

/// What a mix under giveme.my's collateral must carry for giveme.my to sign
/// it and the ledger to take it: its collateral input, never spent, its
/// return to giveme.my's address of 5 ₳ less 3/2 of an even fee, and its key
/// among the required signers.
fn under_givemes_collateral(tx_cbor: &[u8]) {
    let tx = MultiEraTx::decode(tx_cbor).unwrap();
    let giveme = seedelf_core::transaction::collateral_input(true);
    let at = |i: &pallas_traverse::MultiEraInput| (**i.hash(), i.index());
    let given = (giveme.tx_hash.0, giveme.txo_index);
    assert_eq!(
        tx.collateral().iter().map(at).collect::<Vec<_>>(),
        vec![given]
    );
    assert!(
        !tx.inputs().iter().map(at).any(|i| i == given),
        "giveme.my's coin is never spent"
    );
    let fee = tx.fee().unwrap();
    assert_eq!(fee % 2, 0, "an even fee, so 3/2 of it is whole");
    let back = tx.collateral_return().unwrap();
    assert_eq!(
        back.address().unwrap(),
        seedelf_core::address::collateral_address(true)
    );
    assert_eq!(back.value().coin(), 5_000_000 - fee * 3 / 2);
    let signers: Vec<[u8; 28]> = tx
        .required_signers()
        .collect::<Vec<_>>()
        .iter()
        .map(|h| ***h)
        .collect();
    assert_eq!(signers, vec![seedelf_core::constants::COLLATERAL_HASH]);
}

#[test]
fn a_mix_under_givemes_collateral_passes_mix_logic() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    // The payer's collateral is never put up.
    let mix = lovejoin::mix_giveme(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
    under_givemes_collateral(&mix.tx.tx_bytes.0);
    assert_eq!(mix.outputs.len(), 3);
    assert_eq!(mix.change.lovelace, 20_000_000 - mix.fee);
    // giveme.my's signature makes it a little dearer than the same mix under the payer's own.
    let own = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
    assert!(
        mix.fee > own.fee && mix.fee - own.fee < 20_000,
        "{} against {}",
        mix.fee,
        own.fee
    );
    let tx = MultiEraTx::decode(&own.tx.tx_bytes.0).unwrap();
    assert!(tx.required_signers().collect::<Vec<_>>().is_empty());
    collateral_is_enough(&own.tx.tx_bytes.0, 5_000_000);
}

#[test]
fn a_sessions_collateral_goes_into_a_box_and_is_mixed_once() {
    let protocol = Protocol::of(true).unwrap();
    let params = params();
    let sk = Scalar::from(424_242u64);
    let owner = Register::create(sk).unwrap().rerandomize().unwrap();
    // The session's collateral and the chain's change, which pays: this pool's
    // boxes hold 10 ₳, a 5 ₳ pool's 5.
    let coins = [coin(0x22, 10_000_000), coin(0x44, 2_500_000)];
    let address = key_address(0x33);
    let pool = pool_boxes(&protocol);
    let tail = lovejoin::collateral_tail(
        &params,
        &protocol,
        &coins,
        &owner,
        &pool,
        &address,
        1,
        &mut Rewards::none(),
    )
    .unwrap();

    // The deposit spends both, makes one box of ours, and the rest is change.
    let deposit = MultiEraTx::decode(&tail.deposit.tx.tx_bytes.0).unwrap();
    let spent: Vec<[u8; 32]> = deposit.inputs().iter().map(|i| **i.hash()).collect();
    assert_eq!(spent.len(), 2);
    assert!(spent.contains(&[0x22; 32]) && spent.contains(&[0x44; 32]));
    assert_eq!(tail.deposit.boxes.len(), 1);
    assert!(tail.deposit.boxes[0].is_owned(&sk));
    assert_eq!(
        tail.deposit.change.lovelace,
        12_500_000 - 10_000_000 - tail.deposit.fee
    );

    // The mix takes that box, two of the pool's, and the deposit's change, which
    // exist only in the unsent deposit, under giveme.my's collateral.
    under_givemes_collateral(&tail.mix.tx.tx_bytes.0);
    let mixed = MultiEraTx::decode(&tail.mix.tx.tx_bytes.0).unwrap();
    let spent: Vec<([u8; 32], u64)> = mixed
        .inputs()
        .iter()
        .map(|i| (**i.hash(), i.index()))
        .collect();
    assert_eq!(spent.len(), 4);
    for taken in [&tail.deposit.boxes[0].utxo, &tail.deposit.change.utxo] {
        assert!(spent.contains(&(taken.tx_hash, taken.index)));
    }
    let drawn = pool
        .iter()
        .filter(|b| spent.contains(&(b.utxo.tx_hash, b.utxo.index)))
        .count();
    assert_eq!(drawn, 2);
    assert_eq!(tail.mix.outputs.len(), 3);
    let ours: Vec<&PoolBox> = tail
        .mix
        .outputs
        .iter()
        .filter(|b| b.is_owned(&sk))
        .collect();
    assert_eq!(
        ours,
        vec![&tail.leaf],
        "exactly one output is ours: the leaf"
    );
    assert_eq!(
        tail.mix.change.lovelace,
        tail.deposit.change.lovelace - tail.mix.fee
    );

    // Too few of the pool's boxes to draw two: said as the pool short.
    let err = lovejoin::collateral_tail(
        &params,
        &protocol,
        &coins,
        &owner,
        &pool[..1],
        &address,
        1,
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert_eq!(
        err.downcast_ref::<PoolShort>(),
        Some(&PoolShort { have: 1, needed: 2 })
    );
}

#[test]
fn someone_elses_box_is_not_withdrawn() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let sk = Scalar::from(5u64);
    let destination = Register::create(sk).unwrap().rerandomize().unwrap();
    let err = lovejoin::withdraw(
        &params(),
        &protocol,
        &boxes[..1],
        &sk,
        destination,
        &mut Rewards::none(),
    )
    .unwrap_err();
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

/// Constructor 0 under the general form's tag, `102([index, fields])`: its pair
/// and its fields each definite or indefinite, as the ledger takes either.
fn box_datum_102(
    a: &[u8; 48],
    b: &[u8; 48],
    pair_indef: bool,
    fields_indef: bool,
    index: u8,
) -> Vec<u8> {
    let mut e = minicbor::Encoder::new(Vec::new());
    e.tag(minicbor::data::Tag::new(102)).unwrap();
    if pair_indef {
        e.begin_array().unwrap();
    } else {
        e.array(2).unwrap();
    }
    e.u8(index).unwrap();
    if fields_indef {
        e.begin_array().unwrap();
    } else {
        e.array(2).unwrap();
    }
    e.bytes(a).unwrap().bytes(b).unwrap();
    if fields_indef {
        e.end().unwrap();
    }
    if pair_indef {
        e.end().unwrap();
    }
    e.into_writer()
}

/// A pool row as Koios or the private index lists one: the box value at
/// `mix_box`, with the inline datum's bytes as the transaction wrote them.
fn box_row(protocol: &Protocol, datum: &[u8]) -> seedelf_koios::koios::UtxoResponse {
    serde_json::from_value(json!({
        "tx_hash": hex::encode([0x51; 32]), "tx_index": 0,
        "address": protocol.mix_box_address().to_bech32().unwrap(),
        "value": protocol.denom.to_string(), "stake_address": null,
        "payment_cred": hex::encode(protocol.mix_box_hash), "epoch_no": 0,
        "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": { "bytes": hex::encode(datum), "value": null },
        "reference_script": null, "asset_list": [], "is_spent": false,
    }))
    .unwrap()
}

/// Chunk 51, r3a#1: whoever builds a mix writes its outputs, and mix_logic reads
/// a box's datum as data, never as bytes. So a stranger's mix of this wallet's
/// box can leave it as `Constr 0 [a, b]` in the general form, which the ledger
/// reads as the same data. It's still the wallet's box, to find, mix and bring
/// back; read only in the wallet's own spelling, it dropped out of every list.
#[test]
fn a_box_in_constructor_0s_general_form_is_still_the_wallets() {
    let sk = seedelf_crypto::schnorr::random_scalar();
    let moved = Register::create(sk).unwrap().rerandomize().unwrap();
    let a: [u8; 48] = hex::decode(&moved.generator).unwrap().try_into().unwrap();
    let b: [u8; 48] = hex::decode(&moved.public_value)
        .unwrap()
        .try_into()
        .unwrap();
    let canonical = lovejoin::mix_datum(&a, &b);
    for protocol in [Protocol::of(true).unwrap(), Protocol::of(false).unwrap()] {
        let ours = PoolBox::from_row(&box_row(&protocol, &canonical), &protocol).unwrap();
        assert!(ours.is_owned(&sk));
        for (pair_indef, fields_indef) in
            [(false, true), (false, false), (true, true), (true, false)]
        {
            let general = box_datum_102(&a, &b, pair_indef, fields_indef, 0);
            assert_eq!(
                PlutusData::decode_fragment(&general).unwrap(),
                PlutusData::decode_fragment(&canonical).unwrap()
            );
            let found = PoolBox::from_row(&box_row(&protocol, &general), &protocol);
            let found = found.unwrap_or_else(|| {
                panic!(
                    "pair indefinite {pair_indef}, fields indefinite {fields_indef}: not read as a box"
                )
            });
            assert!(found.is_owned(&sk));
            assert_eq!((found.a, found.b), (a, b));
        }
        // Another constructor, in either spelling, is still no box.
        let mut tag_122 = canonical.clone();
        tag_122[1] = 0x7a;
        for other in [box_datum_102(&a, &b, false, true, 1), tag_122] {
            assert_eq!(
                PoolBox::from_row(&box_row(&protocol, &other), &protocol),
                None
            );
        }
    }
}

/// Chunk 51, r3a#1's class: one set of box spellings. A box's datum spelled 252
/// ways, each with what the node reads it as (`fixtures/lovejoin-box-spellings.json`,
/// cardano-cli's verdicts): a row is a box in exactly the spellings the node
/// reads as `Constr 0 [a, b]`, and in no other, on either network. seedelf-data's
/// crowd is held to the same file (`is_mix_datum`), so the wallet and the data
/// layer take the same boxes: the node's.
#[test]
fn a_box_is_read_in_exactly_the_spellings_the_node_reads_as_one() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/lovejoin-box-spellings.json")).unwrap();
    let point = |key: &str| -> [u8; 48] {
        hex::decode(fixture[key].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap()
    };
    let (a, b) = (point("a"), point("b"));
    let spellings = fixture["spellings"].as_array().unwrap();
    // The wallet's own spelling comes first: a box the key 2 owns (a = G1's generator, b = 2G).
    let ours = hex::encode(lovejoin::mix_datum(&a, &b));
    assert_eq!(spellings[0]["hex"], ours);
    assert_eq!(spellings[0]["node"], "constr0_ab");
    let mut wrong = Vec::new();
    for (network, protocol) in [
        ("preprod", Protocol::of(true).unwrap()),
        ("mainnet", Protocol::of(false).unwrap()),
    ] {
        for s in spellings {
            let datum = hex::decode(s["hex"].as_str().unwrap()).unwrap();
            let read = PoolBox::from_row(&box_row(&protocol, &datum), &protocol)
                .map(|found| (found.a, found.b, found.is_owned(&Scalar::from(2u64))));
            if read != (s["node"] == "constr0_ab").then_some((a, b, true)) {
                let how = if read.is_some() { "read" } else { "not read" };
                wrong.push(format!(
                    "{} ({network}, the node's {}): {how} as a box",
                    s["name"], s["node"]
                ));
            }
        }
    }
    // Not vacuous: boxes, and spellings that aren't one, both.
    assert!(spellings.iter().any(|s| s["node"] != "constr0_ab"));
    assert!(
        wrong.is_empty(),
        "{} of the node's verdicts read otherwise:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}

/// Chunk 51, x2#1: Koios lists a credential's UTxOs by its 28 bytes, a key's and a
/// script's alike, so a stranger's 5 ₳ at the KEY address whose hash is
/// mix_box's script hash comes back with the pool's own rows. No mix can spend
/// it (mix_box reads an input's payment part as a script), so read as a box it
/// was counted toward the pool's floor and drawn, and every chain that drew it
/// failed. Only an address whose payment part is mix_box's script holds a box,
/// whatever its stake part, as the contract reads it.
#[test]
fn a_key_address_carrying_mix_box_s_hash_holds_no_box() {
    let sk = seedelf_crypto::schnorr::random_scalar();
    let owner = Register::create(sk).unwrap().rerandomize().unwrap();
    let a: [u8; 48] = hex::decode(&owner.generator).unwrap().try_into().unwrap();
    let b: [u8; 48] = hex::decode(&owner.public_value)
        .unwrap()
        .try_into()
        .unwrap();
    let datum = lovejoin::mix_datum(&a, &b);
    for protocol in [Protocol::of(true).unwrap(), Protocol::of(false).unwrap()] {
        let net = if protocol.network_flag { 0 } else { 1 };
        let bech32 = |bytes: Vec<u8>| {
            pallas_addresses::Address::from_bytes(&bytes)
                .unwrap()
                .to_bech32()
                .unwrap()
        };
        let at = |address: String| {
            let mut row = box_row(&protocol, &datum);
            row.address = address;
            PoolBox::from_row(&row, &protocol)
        };
        // The key address: header 0b0110 (a key, no stake part), then the hash.
        let twin = bech32([vec![0x60 | net], protocol.mix_box_hash.to_vec()].concat());
        assert_eq!(at(twin.clone()), None, "{twin} is no box");
        // Its base form too (a key, with a stake key).
        let twin_staked =
            bech32([vec![net], protocol.mix_box_hash.to_vec(), vec![0x77; 28]].concat());
        assert_eq!(at(twin_staked.clone()), None, "{twin_staked} is no box");
        // mix_box's own address holds one, and so does its form with a stake
        // part (0b0001: a script, with a stake key), which the contract also spends.
        assert!(at(protocol.mix_box_address().to_bech32().unwrap()).is_some());
        let staked = bech32(
            [
                vec![0x10 | net],
                protocol.mix_box_hash.to_vec(),
                vec![0x77; 28],
            ]
            .concat(),
        );
        assert!(at(staked).is_some_and(|b| b.is_owned(&sk)));
    }
}

/// `b` with its inline datum spelled `102([0, [_ a, b]])` in its output's bytes,
/// as a stranger's mix may leave a box. The datum sits in tag 24's byte string
/// (`d8 18 58 <length>`), whichever spelling it had before.
fn respelled(b: &PoolBox, protocol: &Protocol) -> PoolBox {
    let general = box_datum_102(&b.a, &b.b, false, true, 0);
    let out = &b.utxo.output;
    let at = out
        .windows(3)
        .position(|w| w == [0xd8, 0x18, 0x58])
        .expect("the box's inline datum, as tag 24's byte string");
    let length = out[at + 3] as usize;
    let datum = &out[at + 4..at + 4 + length];
    assert_eq!(
        PlutusData::decode_fragment(datum).unwrap(),
        PlutusData::decode_fragment(&general).unwrap()
    );
    let mut output = out.clone();
    let to = [vec![0xd8, 0x18, 0x58, general.len() as u8], general].concat();
    output.splice(at..at + 4 + length, to);
    let utxo = Resolved {
        output,
        ..b.utxo.clone()
    };
    PoolBox::from_resolved(utxo, protocol).expect("still a box")
}

/// r3a#1's other half: a box in the general form isn't only listed, it mixes
/// and it comes back. mix_logic hashes the outputs' datums, which the wallet
/// writes in its own spelling, and reads the inputs' as data.
#[test]
fn a_box_in_the_general_form_mixes_and_comes_back() {
    let protocol = Protocol::of(true).unwrap();
    let mut boxes = pool_boxes(&protocol);
    boxes[0] = respelled(&boxes[0], &protocol);
    let mix = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .unwrap();
    assert_eq!(mix.outputs.len(), 3);
    for out in &mix.outputs {
        assert!(PoolBox::from_resolved(out.utxo.clone(), &protocol).is_some());
    }

    let sk = Scalar::from(31_415u64);
    let ours: Vec<PoolBox> = our_boxes(sk, 1)
        .iter()
        .map(|b| respelled(b, &protocol))
        .collect();
    assert!(ours[0].is_owned(&sk));
    let destination = Register::create(sk).unwrap().rerandomize().unwrap();
    let back = lovejoin::withdraw(
        &params(),
        &protocol,
        &ours,
        &sk,
        destination,
        &mut Rewards::none(),
    )
    .unwrap();
    assert_eq!(back.lovelace, protocol.denom - back.fee);
}

#[test]
fn lovejoin_is_on_preprod_and_mainnet() {
    let preprod = Protocol::of(true).unwrap();
    let mainnet = Protocol::of(false).unwrap();
    assert!(preprod.network_flag && !mainnet.network_flag);
    assert_eq!(
        mainnet.mix_box_address().to_bech32().unwrap(),
        "addr1w8q5tsg07j72aal45ndm8l9lmh9ykmrmpqv3kp5skyh3ltgw48lct"
    );
    assert_ne!(preprod.mix_logic_hash, mainnet.mix_logic_hash);
}

/// The script a bundled reference output carries, read here on its own: the
/// bytes inside its `script_ref`.
fn reference_script(output: &[u8]) -> Option<Vec<u8>> {
    use pallas_primitives::conway::{ScriptRef, TransactionOutput};
    let TransactionOutput::PostAlonzo(output) = minicbor::decode(output).unwrap() else {
        panic!("a post-Alonzo output")
    };
    match output.script_ref?.0 {
        ScriptRef::PlutusV3Script(script) => Some(script.as_ref().to_vec()),
        _ => panic!("a Plutus V3 script"),
    }
}

#[test]
fn the_reference_scripts_are_priced_on_the_scripts_referenced() {
    // mainnet's mix_logic is 5 bytes longer: preprod's size would price every
    // mainnet mix and withdraw 75 lovelace under the ledger's minimum.
    for (network_flag, sizes) in [(true, vec![629, 3_156]), (false, vec![629, 3_161])] {
        let protocol = Protocol::of(network_flag).unwrap();
        let scripts: Vec<Vec<u8>> = protocol
            .references
            .iter()
            .filter_map(|r| reference_script(&r.output))
            .collect();
        assert_eq!(scripts.iter().map(Vec::len).collect::<Vec<_>>(), sizes);
        // They're the scripts the protocol names: blake2b-224 of 0x03 ‖ script.
        let hash = |script: &[u8]| -> [u8; 28] {
            *pallas_crypto::hash::Hasher::<224>::hash(&[&[3u8][..], script].concat())
        };
        assert_eq!(hash(&scripts[0]), protocol.mix_box_hash);
        assert_eq!(hash(&scripts[1]), protocol.mix_logic_hash);
        assert_eq!(protocol.script_bytes, sizes.iter().sum::<usize>() as u64);
    }
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
    let chain = lovejoin::chain(
        &params,
        &protocol,
        &funding(&coins),
        &owners,
        2,
        &pool,
        &mut Rewards::none(),
    )
    .unwrap();
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
    let chain = lovejoin::chain(
        &params,
        &protocol,
        &funding(&coins),
        &owners,
        1,
        &pool,
        &mut Rewards::none(),
    )
    .unwrap();
    assert_eq!(chain.txs.len(), 3);
    assert_eq!(chain.leaves.len(), 2);
    assert!(chain.leaves.iter().all(|b| b.is_owned(&sk)));
}

#[test]
fn a_seed_is_the_deposit_alone_and_needs_no_pool_and_no_collateral() {
    let protocol = Protocol::of(true).unwrap();
    let params = params();
    let sk = Scalar::from(9u64);
    let base = Register::create(sk).unwrap();
    let owners: Vec<_> = (0..3)
        .map(|_| base.clone().rerandomize().unwrap())
        .collect();
    // Depth 0: no mixes, so it draws nothing from the pool and spends no
    // script. An empty pool and no collateral are both fine.
    let funding = lovejoin::Funding {
        coins: vec![coin(0x44, 40_000_000)],
        collateral: None,
        address: key_address(0x55),
        deposit_signers: 1,
        mix_signers: 1,
    };
    let seed = lovejoin::chain(
        &params,
        &protocol,
        &funding,
        &owners,
        0,
        &[],
        &mut Rewards::none(),
    )
    .unwrap();
    assert_eq!(seed.txs.len(), 1, "the deposit alone");
    assert_eq!(seed.txs[0].kind, "deposit");
    assert_eq!(seed.leaves.len(), 3);
    assert!(seed.leaves.iter().all(|b| b.is_owned(&sk)));
    assert_eq!(
        seed.change.lovelace,
        40_000_000 - 30_000_000 - seed.txs[0].fee
    );

    // Anything that mixes still needs collateral, and the chain says so before
    // its first mix would (chunk 51, t1c#13).
    let err = lovejoin::chain(
        &params,
        &protocol,
        &funding,
        &owners,
        1,
        &all_pool_boxes(&protocol),
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(
        err.to_string()
            .contains("A chain that mixes needs collateral"),
        "{err}"
    );
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
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("pool has 3 boxes"), "{err}");
    // Its own type, which a caller tells from a build that failed.
    assert_eq!(
        err.downcast_ref::<PoolShort>(),
        Some(&PoolShort { have: 3, needed: 8 })
    );
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
            let funded = lovejoin::funding_for(boxes, depth, 10_000_000).unwrap();
            assert_eq!(lovejoin::boxes_affordable(funded, depth, 10_000_000), boxes);
            assert_eq!(
                lovejoin::boxes_affordable(funded - 1, depth, 10_000_000),
                boxes - 1
            );
        }
    }
    assert_eq!(lovejoin::funding_for(1, 2, 10_000_000).unwrap(), 15_300_000);
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
    let funded = lovejoin::funding_for(2, 1, protocol.denom).unwrap();
    let built = lovejoin::chain(
        &params(),
        &protocol,
        &funding(&[coin(0x44, funded)]),
        &owners,
        1,
        &all_pool_boxes(&protocol),
        &mut Rewards::none(),
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
    let err = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(1_500_000),
        &mut Rewards::none(),
    )
    .unwrap_err();
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
    let chain = lovejoin::again(
        &params(),
        &protocol,
        &paying,
        &ours,
        1,
        &pool,
        &mut Rewards::none(),
    )
    .unwrap();
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
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("no box to mix again"), "{err}");
    // Ours don't count among the boxes to mix with.
    let mut pool = vec![all_pool_boxes(&protocol)[0].clone()];
    pool.extend(ours.iter().cloned());
    let err = lovejoin::again(
        &params(),
        &protocol,
        &payer(20_000_000),
        &ours,
        1,
        &pool,
        &mut Rewards::none(),
    )
    .unwrap_err();
    assert!(err.to_string().contains("pool has 1 boxes"), "{err}");
    assert!(err.downcast_ref::<PoolShort>().is_some());
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

// ---------------------------------------------------------------------------
// The reward balance (chunk 43): what sits in mix_logic's reward account
// ---------------------------------------------------------------------------

/// A retired stake pool's deposit, refunded into `mix_logic`'s reward account.
const WINDFALL: u64 = 500_000_000;

/// `lovelace` in `protocol`'s reward account.
fn holding(protocol: &Protocol, lovelace: u64) -> Rewards {
    Rewards::of([(protocol.mix_logic_hash, lovelace)])
}

/// What `tx` withdraws, from which reward accounts.
fn withdrawals(tx_cbor: &[u8]) -> Vec<(Vec<u8>, u64)> {
    let tx = MultiEraTx::decode(tx_cbor).unwrap();
    tx.as_conway()
        .unwrap()
        .transaction_body
        .withdrawals
        .as_ref()
        .map(|w| w.iter().map(|(a, l)| (a.to_vec(), *l)).collect())
        .unwrap_or_default()
}

/// One withdrawal of `lovelace` from `protocol`'s `mix_logic` account.
fn withdraws(protocol: &Protocol, lovelace: u64) -> Vec<(Vec<u8>, u64)> {
    vec![(
        seedelf_core::withdraw_zero::reward_account(&protocol.mix_logic_hash, true),
        lovelace,
    )]
}

/// The ledger's balance: what the inputs held and the withdrawal brings is
/// every output's ADA and the fee.
fn balances(tx_cbor: &[u8], inputs: u64) {
    let tx = MultiEraTx::decode(tx_cbor).unwrap();
    let out: u64 = tx.outputs().iter().map(|o| o.value().coin()).sum();
    let withdrawn: u64 = withdrawals(tx_cbor).iter().map(|(_, l)| l).sum();
    assert_eq!(inputs + withdrawn, out + tx.fee().unwrap());
}

/// Each output's ADA, in order.
fn coins_out(tx_cbor: &[u8]) -> Vec<u64> {
    let tx = MultiEraTx::decode(tx_cbor).unwrap();
    tx.outputs().iter().map(|o| o.value().coin()).collect()
}

#[test]
fn a_mix_takes_the_reward_balance_whole_into_its_change() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let mut rewards = holding(&protocol, WINDFALL);
    // Built at all is mix_logic passing a withdrawal that isn't 0: the mix is
    // measured as it will be sent.
    let mix = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(
        withdrawals(&mix.tx.tx_bytes.0),
        withdraws(&protocol, WINDFALL)
    );
    assert_eq!(mix.taken, WINDFALL);
    assert_eq!(mix.change.lovelace, 20_000_000 + WINDFALL - mix.fee);
    // Every box still holds exactly the box value; the change holds it.
    assert_eq!(
        coins_out(&mix.tx.tx_bytes.0),
        vec![protocol.denom; 3]
            .into_iter()
            .chain([mix.change.lovelace])
            .collect::<Vec<_>>()
    );
    balances(&mix.tx.tx_bytes.0, 3 * protocol.denom + 20_000_000);
    collateral_is_enough(&mix.tx.tx_bytes.0, 5_000_000);

    // Taken: the next mix in the pool withdraws 0, and costs the same but for
    // the amount's few bytes.
    assert_eq!(rewards.balance(&protocol), 0);
    let next = lovejoin::mix(
        &params(),
        &protocol,
        &boxes,
        &payer(20_000_000),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(withdrawals(&next.tx.tx_bytes.0), withdraws(&protocol, 0));
    assert_eq!(next.taken, 0);
    assert_eq!(next.change.lovelace, 20_000_000 - next.fee);
    assert!(
        mix.fee.abs_diff(next.fee) < 2_000,
        "{} and {}",
        mix.fee,
        next.fee
    );
}

#[test]
fn a_mix_takes_only_its_own_pools_balance() {
    let protocol = Protocol::of(true).unwrap();
    let other = Protocol::of(false).unwrap();
    let mut rewards = holding(&other, WINDFALL);
    let mix = lovejoin::mix(
        &params(),
        &protocol,
        &pool_boxes(&protocol),
        &payer(20_000_000),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(withdrawals(&mix.tx.tx_bytes.0), withdraws(&protocol, 0));
    assert_eq!(rewards.balance(&other), WINDFALL);
    assert_eq!(rewards, holding(&other, WINDFALL));
    // None at all is what the wallet always built.
    assert_eq!(Rewards::of([(protocol.mix_logic_hash, 0)]), Rewards::none());
}

/// A pool named twice holds the last balance given for it, a 0 too: the
/// worker's reads come as a map of hex, where one hash in upper and in lower
/// case is two keys (1.8.1's release review, core#2).
#[test]
fn a_pool_named_twice_holds_the_last_balance_given() {
    let protocol = Protocol::of(true).unwrap();
    let h = protocol.mix_logic_hash;
    let of = |balances: &[u64]| Rewards::of(balances.iter().map(|l| (h, *l)));
    assert_eq!(of(&[5, 7]), holding(&protocol, 7));
    assert_eq!(of(&[7, 5]), holding(&protocol, 5));
    assert_eq!(of(&[0, 5]), holding(&protocol, 5));
    assert_eq!(of(&[5, 0]), Rewards::none());
}

#[test]
fn a_build_that_fails_takes_nothing() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let mut rewards = holding(&protocol, WINDFALL);
    // Collateral too small for the fee: refused after the balance was read.
    let poor = Payer {
        collateral: Some(coin(0x22, 100_000)),
        ..payer(20_000_000)
    };
    let err = lovejoin::mix(&params(), &protocol, &boxes, &poor, &mut rewards).unwrap_err();
    assert!(err.to_string().contains("collateral can't cover"), "{err}");
    assert_eq!(rewards.balance(&protocol), WINDFALL);
    // Someone else's box isn't withdrawn, and nothing is taken.
    let sk = Scalar::from(5u64);
    let destination = Register::create(sk).unwrap().rerandomize().unwrap();
    assert!(
        lovejoin::withdraw(
            &params(),
            &protocol,
            &boxes[..1],
            &sk,
            destination,
            &mut rewards
        )
        .is_err()
    );
    assert_eq!(rewards.balance(&protocol), WINDFALL);
}

#[test]
fn a_reward_balance_past_what_a_u64_holds_is_refused_in_words() {
    let protocol = Protocol::of(true).unwrap();
    let mut rewards = holding(&protocol, u64::MAX);
    let err = lovejoin::mix(
        &params(),
        &protocol,
        &pool_boxes(&protocol),
        &payer(20_000_000),
        &mut rewards,
    )
    .unwrap_err();
    assert!(err.to_string().contains("more ADA than there is"), "{err}");
    let sk = Scalar::from(77u64);
    let ours = our_boxes(sk, 1);
    let err = lovejoin::withdraw(
        &params(),
        &protocol,
        &ours,
        &sk,
        Register::create(sk).unwrap().rerandomize().unwrap(),
        &mut rewards,
    )
    .unwrap_err();
    assert!(err.to_string().contains("more ADA than there is"), "{err}");
    assert_eq!(rewards.balance(&protocol), u64::MAX);
}

#[test]
fn a_mix_under_givemes_collateral_takes_it_into_the_payers_change() {
    let protocol = Protocol::of(true).unwrap();
    let mut rewards = holding(&protocol, WINDFALL);
    let mix = lovejoin::mix_giveme(
        &params(),
        &protocol,
        &pool_boxes(&protocol),
        &payer(20_000_000),
        &mut rewards,
    )
    .unwrap();
    under_givemes_collateral(&mix.tx.tx_bytes.0);
    assert_eq!(
        withdrawals(&mix.tx.tx_bytes.0),
        withdraws(&protocol, WINDFALL)
    );
    assert_eq!(mix.change.lovelace, 20_000_000 + WINDFALL - mix.fee);
    balances(&mix.tx.tx_bytes.0, 3 * protocol.denom + 20_000_000);
    assert_eq!(rewards, Rewards::none());
}

#[test]
fn a_withdraw_takes_the_reward_balance_into_the_register() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(31_415u64);
    let ours = our_boxes(sk, 1);
    let destination = Register::create(sk).unwrap().rerandomize().unwrap();
    let mut rewards = holding(&protocol, WINDFALL);
    let back = lovejoin::withdraw(
        &params(),
        &protocol,
        &ours,
        &sk,
        destination.clone(),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(
        withdrawals(&back.tx.tx_bytes.0),
        withdraws(&protocol, WINDFALL)
    );
    assert_eq!(back.taken, WINDFALL);
    assert_eq!(back.lovelace, protocol.denom + WINDFALL - back.fee);
    assert_eq!(coins_out(&back.tx.tx_bytes.0), vec![back.lovelace]);
    balances(&back.tx.tx_bytes.0, protocol.denom);
    assert_eq!(back.fee % 2, 0, "an even fee, so 3/2 of it is whole");
    collateral_is_enough(&back.tx.tx_bytes.0, 5_000_000);
    assert_eq!(rewards, Rewards::none());
    // Taken: the next withdraw there withdraws 0.
    let next =
        lovejoin::withdraw(&params(), &protocol, &ours, &sk, destination, &mut rewards).unwrap();
    assert_eq!(withdrawals(&next.tx.tx_bytes.0), withdraws(&protocol, 0));
    assert_eq!(next.lovelace, protocol.denom - next.fee);
}

#[test]
fn a_chains_first_mix_takes_the_balance_and_its_change_carries_it() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(42u64);
    let owners = vec![Register::create(sk).unwrap().rerandomize().unwrap()];
    let coins = [coin(0x44, 20_000_000)];
    let mut rewards = holding(&protocol, WINDFALL);
    // One box, two waves deep: four mixes, each paid from the one before's change.
    let chain = lovejoin::chain(
        &params(),
        &protocol,
        &funding(&coins),
        &owners,
        2,
        &all_pool_boxes(&protocol),
        &mut rewards,
    )
    .unwrap();
    let taken: Vec<u64> = chain.txs.iter().map(|t| t.taken).collect();
    assert_eq!(taken, vec![0, WINDFALL, 0, 0, 0]);
    assert!(withdrawals(&chain.txs[0].tx.tx_bytes.0).is_empty());
    assert_eq!(
        withdrawals(&chain.txs[1].tx.tx_bytes.0),
        withdraws(&protocol, WINDFALL)
    );
    for later in &chain.txs[2..] {
        assert_eq!(withdrawals(&later.tx.tx_bytes.0), withdraws(&protocol, 0));
    }
    let fees: u64 = chain.txs.iter().map(|t| t.fee).sum();
    assert_eq!(
        chain.change.lovelace,
        20_000_000 - protocol.denom - fees + WINDFALL
    );
    assert_eq!(rewards, Rewards::none());

    // Mixing again from that change takes nothing more.
    let again = lovejoin::again(
        &params(),
        &protocol,
        &payer(20_000_000),
        &chain.leaves,
        1,
        &all_pool_boxes(&protocol),
        &mut rewards,
    )
    .unwrap();
    assert!(again.txs.iter().all(|t| t.taken == 0));

    // Mixing again with a balance there: its first mix takes it, out of the
    // caller's `Rewards`, which a session's collateral tail is built on next
    // (1.8.1's release review, mutants#2).
    let mut rewards = holding(&protocol, WINDFALL);
    let again = lovejoin::again(
        &params(),
        &protocol,
        &payer(20_000_000),
        &chain.leaves,
        1,
        &all_pool_boxes(&protocol),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(again.txs[0].taken, WINDFALL);
    assert_eq!(
        again.change.lovelace,
        20_000_000 + WINDFALL - again.txs[0].fee
    );
    assert_eq!(rewards, Rewards::none());
}

#[test]
fn a_sessions_collateral_mix_takes_only_what_its_chain_left() {
    let protocol = Protocol::of(true).unwrap();
    let params = params();
    let sk = Scalar::from(424_242u64);
    let owner = Register::create(sk).unwrap().rerandomize().unwrap();
    let coins = [coin(0x22, 10_000_000), coin(0x44, 2_500_000)];
    let address = key_address(0x33);
    let pool = pool_boxes(&protocol);

    // Alone, the tail's mix takes the pool's balance into its change.
    let mut rewards = holding(&protocol, WINDFALL);
    let tail = lovejoin::collateral_tail(
        &params,
        &protocol,
        &coins,
        &owner,
        &pool,
        &address,
        1,
        &mut rewards,
    )
    .unwrap();
    assert!(withdrawals(&tail.deposit.tx.tx_bytes.0).is_empty());
    assert_eq!(tail.mix.taken, WINDFALL);
    under_givemes_collateral(&tail.mix.tx.tx_bytes.0);
    assert_eq!(
        tail.mix.change.lovelace,
        tail.deposit.change.lovelace + WINDFALL - tail.mix.fee
    );
    assert_eq!(rewards, Rewards::none());

    // After a chain that mixed in the same pool, it takes nothing: one
    // `Rewards` goes through both.
    let mut rewards = holding(&protocol, WINDFALL);
    let chain = lovejoin::chain(
        &params,
        &protocol,
        &funding(&[coin(0x55, 20_000_000)]),
        &[Register::create(sk).unwrap().rerandomize().unwrap()],
        1,
        &all_pool_boxes(&protocol),
        &mut rewards,
    )
    .unwrap();
    assert_eq!(chain.txs[1].taken, WINDFALL);
    let tail = lovejoin::collateral_tail(
        &params,
        &protocol,
        &coins,
        &owner,
        &pool,
        &address,
        1,
        &mut rewards,
    )
    .unwrap();
    assert_eq!(tail.mix.taken, 0);
    assert_eq!(
        withdrawals(&tail.mix.tx.tx_bytes.0),
        withdraws(&protocol, 0)
    );
}

/// The compressed identity point of G1: `c0` and 47 zero bytes.
fn identity() -> [u8; 48] {
    let mut point = [0u8; 48];
    point[0] = 0xc0;
    point
}

/// Chunk 51, t1c#1: a box with an identity point is no one's, and no box: the
/// identity decodes and sits in the subgroup, so only this check keeps a
/// stranger's such box out of the count a pool's floor is held to, and out of
/// the user's mixes, where it would hide them among one box fewer.
#[test]
fn a_box_with_an_identity_point_is_no_box() {
    let protocol = Protocol::of(true).unwrap();
    let owner = Register::create(Scalar::from(5u64))
        .unwrap()
        .rerandomize()
        .unwrap();
    let point: [u8; 48] = hex::decode(&owner.public_value)
        .unwrap()
        .try_into()
        .unwrap();
    let other: [u8; 48] = hex::decode(&owner.generator).unwrap().try_into().unwrap();
    let as_output = |datum: &[u8]| Resolved {
        tx_hash: [0x5a; 32],
        index: 0,
        output: protocol
            .box_value()
            .output(protocol.mix_box_address())
            .unwrap()
            .set_inline_datum(datum.to_vec())
            .build_babbage_raw()
            .unwrap()
            .encode_fragment()
            .unwrap(),
    };
    let genuine = lovejoin::mix_datum(&other, &point);
    assert!(PoolBox::from_row(&box_row(&protocol, &genuine), &protocol).is_some());
    assert!(PoolBox::from_resolved(as_output(&genuine), &protocol).is_some());
    for (a, b) in [(identity(), point), (point, identity())] {
        let datum = lovejoin::mix_datum(&a, &b);
        assert_eq!(
            PoolBox::from_row(&box_row(&protocol, &datum), &protocol),
            None
        );
        assert_eq!(PoolBox::from_resolved(as_output(&datum), &protocol), None);
    }
}

/// Chunk 51, t1c#9: the lead's x2#1 fix reads a row's address, and
/// `a_key_address_carrying_mix_box_s_hash_holds_no_box` pins that; this pins
/// its network half: mix_box's own script address on the other network holds
/// no box of this one's.
#[test]
fn mix_boxs_address_on_the_other_network_holds_no_box() {
    let owner = Register::create(Scalar::from(6u64))
        .unwrap()
        .rerandomize()
        .unwrap();
    let a: [u8; 48] = hex::decode(&owner.generator).unwrap().try_into().unwrap();
    let b: [u8; 48] = hex::decode(&owner.public_value)
        .unwrap()
        .try_into()
        .unwrap();
    let datum = lovejoin::mix_datum(&a, &b);
    for protocol in [Protocol::of(true).unwrap(), Protocol::of(false).unwrap()] {
        let mut row = box_row(&protocol, &datum);
        assert!(PoolBox::from_row(&row, &protocol).is_some());
        let other_network = if protocol.network_flag { 0x71 } else { 0x70 };
        row.address = pallas_addresses::Address::from_bytes(
            &[vec![other_network], protocol.mix_box_hash.to_vec()].concat(),
        )
        .unwrap()
        .to_bech32()
        .unwrap();
        assert_eq!(PoolBox::from_row(&row, &protocol), None, "{}", row.address);
    }
}

/// Chunk 51, t1c#8: only ADA pays for Lovejoin. A UTxO holding a token isn't
/// a coin: no output of a mix or a withdraw, nor a collateral return, would
/// carry its token, which the ledger refuses.
#[test]
fn a_utxo_holding_a_token_is_no_coin_to_pay_lovejoin_with() {
    let row = |assets: Value| -> seedelf_koios::koios::UtxoResponse {
        serde_json::from_value(json!({
            "tx_hash": hex::encode([0x61; 32]), "tx_index": 0,
            "address": key_address(0x61).to_bech32().unwrap(), "value": "20000000",
            "stake_address": null, "payment_cred": "", "epoch_no": 0, "block_height": 0,
            "block_time": 0, "datum_hash": null, "inline_datum": null,
            "reference_script": null, "asset_list": assets, "is_spent": false,
        }))
        .unwrap()
    };
    assert_eq!(
        Coin::from_row(&row(json!([]))).unwrap().lovelace,
        20_000_000
    );
    let token = json!([{ "policy_id": "c0".repeat(28), "asset_name": "", "quantity": "1",
                         "decimals": 0, "fingerprint": "" }]);
    let refused = Coin::from_row(&row(token)).map(|c| c.lovelace);
    assert!(
        matches!(&refused, Err(e) if e.to_string().contains("holds tokens; only ADA pays for Lovejoin")),
        "{refused:?}"
    );
}

/// Chunk 51, t1c#11: a box is mixed once in a transaction, in the wallet's
/// own words, before the evaluator would refuse it in its own.
#[test]
fn a_box_is_never_mixed_twice_in_one_transaction() {
    let protocol = Protocol::of(true).unwrap();
    let boxes = pool_boxes(&protocol);
    let twice = [boxes[0].clone(), boxes[1].clone(), boxes[0].clone()];
    let refused = lovejoin::mix(
        &params(),
        &protocol,
        &twice,
        &payer(20_000_000),
        &mut Rewards::none(),
    )
    .map(|m| m.fee);
    assert!(
        matches!(&refused, Err(e) if e.to_string().contains("can't be mixed twice")),
        "{refused:?}"
    );
}

/// Chunk 51, t1c#14: a fan-out is 0 to 3 waves deep; deeper, it would plan
/// tens of mixes a box (and from 21 waves count past a usize on wasm32).
#[test]
fn a_fan_out_deeper_than_three_waves_is_refused() {
    let protocol = Protocol::of(true).unwrap();
    let owners = vec![
        Register::create(Scalar::from(7u64))
            .unwrap()
            .rerandomize()
            .unwrap(),
    ];
    let refused = lovejoin::chain(
        &params(),
        &protocol,
        &funding(&[coin(0x44, 40_000_000)]),
        &owners,
        4,
        &all_pool_boxes(&protocol),
        &mut Rewards::none(),
    )
    .map(|chain| chain.txs.len());
    assert!(
        matches!(&refused, Err(e) if e.to_string().contains("0 to 3 waves deep")),
        "{refused:?}"
    );
}

/// Chunk 51, t1c#6: boxes come back only into a register a payment is safe
/// under (`build::is_payable`): an identity public value is anyone's to take,
/// an identity generator or a non-point locks them for good.
#[test]
fn boxes_never_come_back_into_a_register_no_one_or_anyone_can_spend() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(27_182u64);
    let ours = our_boxes(sk, 1);
    let g = Register::create(sk).unwrap().generator;
    let identity = hex::encode(identity());
    for destination in [
        Register::new(g.clone(), identity.clone()),
        Register::new(identity.clone(), g.clone()),
        Register::new("00".repeat(48), "00".repeat(48)),
    ] {
        let refused = lovejoin::withdraw(
            &params(),
            &protocol,
            &ours,
            &sk,
            destination,
            &mut Rewards::none(),
        )
        .map(|w| w.lovelace);
        assert!(
            matches!(&refused, Err(e) if e.to_string().contains("valid, non-identity register")),
            "{refused:?}"
        );
    }
}

/// Chunk 51, t1c#5: a withdraw the public account pays keeps the account's
/// change as an output the ledger takes, at least an output's least, at the
/// fee that settles. A coin that pays that fee and the least is taken: it was
/// refused when its first round, priced at a 0.5 ₳ guess, held the change to
/// its least too. Less is refused in words, where the ledger would refuse the
/// signed withdraw.
#[test]
fn a_paid_withdraw_keeps_the_accounts_change_at_least_an_outputs_least() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(16_180u64);
    let ours = our_boxes(sk, 1);
    let paid = |lovelace: u64| {
        lovejoin::withdraw_paid(
            &params(),
            &protocol,
            &ours,
            &sk,
            Register::create(sk).unwrap().rerandomize().unwrap(),
            &payer(lovelace),
            &mut Rewards::none(),
        )
        .map(|w| (w.fee, w.change.map(|c| c.lovelace)))
    };
    let (fee, _) = paid(20_000_000).unwrap();
    let least = seedelf_core::transaction::calculate_min_required_utxo(
        pallas_txbuilder::Output::new(key_address(0x33), 1_000_000),
        &params(),
    )
    .unwrap();
    // Each build's proofs are new, so its fee moves by a hair: well clear of it.
    let coin = fee + least + 5_000;
    assert!(coin < 500_000 + least, "{coin}");
    let (fee, change) = paid(coin).unwrap_or_else(|e| panic!("{coin}: {e}"));
    assert_eq!(change, Some(coin - fee));
    assert!(coin - fee >= least);
    let refused = paid(fee + least - 5_000);
    assert!(
        matches!(&refused, Err(e) if e.to_string().contains("keep the change")),
        "{refused:?}"
    );
}
