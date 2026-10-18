//! Chunk 34's 34e through the WebAssembly layer: a session's return across
//! pools (its token through its token pool, its ADA through the classic
//! pool, one deposit and the mixes in each), and D3's width, four boxes a
//! mix, named on its own beside a request. Lovejoin's own preprod token pool
//! stands in for any token pool, named by a `PoolRef` as the worker names one.

use blstrs::Scalar;
use pallas_traverse::MultiEraTx;
use seedelf_core::lovejoin::{
    self, BoxToken, BoxValue, Protocol, ReferenceDatum, mix_datum, templates,
};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self as wasm, Across, ChainRequest, FundingRequest, LegRequest, OutRef, PlanRequest, PoolRef,
    Wide,
};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// Lovejoin's own token pool on preprod: its seed, its NFT's policy, and
/// LJTEST, the token its boxes hold, 10^16 a box beside 2 ₳.
const LJ_SEED: &str = "5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b";
const LJ_POLICY: &str = "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69";
const LJTEST: &str = "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa";
const Q: u64 = 10_000_000_000_000_000;

fn params() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

fn derived() -> templates::Derived {
    let seed: [u8; 32] = hex::decode(LJ_SEED).unwrap().try_into().unwrap();
    templates::derive(&seed, 2).unwrap()
}

fn row(value: Value) -> UtxoResponse {
    let mut base = json!({
        "tx_index": 0, "stake_address": null, "epoch_no": 0, "block_height": 0,
        "block_time": 0, "datum_hash": null, "inline_datum": null, "payment_cred": "",
        "reference_script": null, "asset_list": [], "is_spent": false,
    });
    for (k, v) in value.as_object().unwrap() {
        base[k] = v.clone();
    }
    serde_json::from_value(base).unwrap()
}

fn ljtest(quantity: u64) -> Value {
    json!({ "policy_id": LJTEST, "asset_name": hex::encode("LJTEST"),
            "quantity": quantity.to_string(), "decimals": 0, "fingerprint": "" })
}

fn holder() -> String {
    lovejoin::holder_address(true).to_bech32().unwrap()
}

/// The pool as the worker would find it, its scripts at the holder.
fn pool_ref() -> PoolRef {
    let d = derived();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: 2_000_000,
            token: Some(BoxToken {
                policy: hex::decode(LJTEST).unwrap().try_into().unwrap(),
                name: b"LJTEST".to_vec(),
                quantity: Q,
            }),
        },
        max_fee: 1_500_000,
        mix_box_hash: d.mix_box.hash,
        mix_logic_hash: d.mix_logic.hash,
        fee_hash: d.fee_contract.hash,
    };
    let reference = row(json!({
        "tx_hash": "7f".repeat(32), "address": holder(), "value": "1698140",
        "payment_cred": hex::encode(templates::REFERENCE_HOLDER_HASH),
        "inline_datum": { "bytes": hex::encode(datum.encode()), "value": {} },
        "asset_list": [{ "policy_id": LJ_POLICY, "asset_name": hex::encode("lovejoin"),
                         "quantity": "1", "decimals": 0, "fingerprint": "" }],
    }));
    let script = |first: &str, s: &templates::Script| {
        row(json!({
            "tx_hash": first.repeat(32), "address": holder(), "value": "20000000",
            "payment_cred": hex::encode(templates::REFERENCE_HOLDER_HASH),
            "reference_script": { "hash": hex::encode(s.hash), "size": s.cbor.len(),
                                  "type": "plutusV3", "bytes": hex::encode(&s.cbor) },
        }))
    };
    PoolRef {
        reference,
        seed: OutRef {
            tx_hash: LJ_SEED.to_string(),
            tx_index: 2,
        },
        scripts: vec![script("7d", &d.mix_box), script("17", &d.mix_logic)],
    }
}

/// A box at `pool`'s `mix_box`, a stranger's, its transaction's hash starting `first`.
fn box_row(pool: &Protocol, first: u8, n: u8) -> UtxoResponse {
    let register = Register::create(Scalar::from(
        1_000u64 + u64::from(first) * 256 + u64::from(n),
    ))
    .unwrap()
    .rerandomize()
    .unwrap();
    let point = |p: &str| -> [u8; 48] { hex::decode(p).unwrap().try_into().unwrap() };
    let datum = mix_datum(&point(&register.generator), &point(&register.public_value));
    let mut hash = [first; 32];
    hash[31] = n;
    row(json!({
        "tx_hash": hex::encode(hash), "address": pool.mix_box_address().to_bech32().unwrap(),
        "value": pool.denom.to_string(), "payment_cred": hex::encode(pool.mix_box_hash),
        "inline_datum": { "bytes": hex::encode(datum), "value": {} },
        "asset_list": if pool.token.is_some() { vec![ljtest(Q)] } else { vec![] },
    }))
}

fn others(pool: &Protocol, first: u8, n: u8) -> Vec<UtxoResponse> {
    (0..n).map(|i| box_row(pool, first, i)).collect()
}

fn classic() -> Protocol {
    Protocol::of(true).unwrap()
}

fn token_pool() -> Protocol {
    wasm::protocol_of(true, Some(&pool_ref())).unwrap()
}

fn accounts() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap()
}

fn session() -> String {
    api::one_time_address(&accounts(), true, 0)
        .unwrap()
        .to_bech32()
        .unwrap()
}

fn at_session(tx: u8, index: u64, lovelace: u64, assets: Vec<Value>) -> UtxoResponse {
    row(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": index, "address": session(),
        "value": lovelace.to_string(), "asset_list": assets,
    }))
}

/// A swap's session, its order filled: the funding's change (its own), the fill (a batcher's transaction) holding
/// three boxes' worth of LJTEST, and its 5 ₳ collateral.
fn filled() -> (Vec<UtxoResponse>, String, String) {
    let funding = hex::encode([0x10; 32]);
    let fill = hex::encode([0x20; 32]);
    let utxos = vec![
        at_session(0x10, 0, 40_000_000, vec![]),
        at_session(0x20, 0, 2_000_000, vec![ljtest(3 * Q)]),
        at_session(0x11, 0, 5_000_000, vec![]),
    ];
    (utxos, funding, fill)
}

fn collateral() -> OutRef {
    OutRef {
        tx_hash: hex::encode([0x11; 32]),
        tx_index: 0,
    }
}

fn plan_request(utxos: Vec<UtxoResponse>, depth: u32) -> PlanRequest {
    PlanRequest {
        network: "preprod".into(),
        index: 0,
        utxos,
        collateral: collateral(),
        depth,
        again: false,
    }
}

/// The token pool, then the classic pool: their rows, at most `most` boxes each.
fn legs(most: [Option<usize>; 2]) -> Vec<LegRequest> {
    vec![
        LegRequest {
            pool_ref: Some(pool_ref()),
            pool: others(&token_pool(), 0xb0, 8),
            most: most[0],
        },
        LegRequest {
            pool_ref: None,
            pool: others(&classic(), 0xc0, 8),
            most: most[1],
        },
    ]
}

fn across(legs: Vec<LegRequest>, fills: Vec<String>) -> Across {
    Across {
        legs,
        fills,
        params: Some(params()),
    }
}

fn holds_ljtest(output: &pallas_traverse::MultiEraOutput) -> Option<u64> {
    output
        .value()
        .assets()
        .iter()
        .find(|p| hex::encode(p.policy()) == LJTEST)
        .and_then(|p| p.assets().first().and_then(|a| a.output_coin()))
}

#[test]
fn a_return_plans_its_token_boxes_first_then_its_ada() {
    let (utxos, funding, fill) = filled();
    let plan = wasm::plan_across_pools(
        &accounts(),
        plan_request(utxos.clone(), 1),
        std::slice::from_ref(&funding),
        &across(legs([None, None]), vec![fill.clone()]),
        3,
    )
    .unwrap();
    // Three boxes of the token (2 ₳ and a mix each), then two of the classic pool's from the ADA they leave.
    assert_eq!(plan.legs, vec![3, 2]);
    assert_eq!(plan.boxes, 5);
    assert_eq!(plan.mixes, 5);
    assert_eq!(plan.mix_fees, (5 * lovejoin::MIX_FEE_ESTIMATE).to_string());
    // The fill is a batcher's transaction: named as one, its token may go in; otherwise, never a stranger's.
    let strangers = wasm::plan_across_pools(
        &accounts(),
        plan_request(utxos.clone(), 1),
        std::slice::from_ref(&funding),
        &across(legs([None, None]), Vec::new()),
        3,
    )
    .unwrap();
    assert_eq!(strangers.legs[0], 0);
    // Each leg at most its pool's room.
    let roomy = wasm::plan_across_pools(
        &accounts(),
        plan_request(utxos.clone(), 1),
        std::slice::from_ref(&funding),
        &across(legs([Some(1), Some(1)]), vec![fill.clone()]),
        3,
    )
    .unwrap();
    assert_eq!(roomy.legs, vec![1, 1]);
    // Four wide: dearer mixes, so fewer boxes from the same ADA.
    let wide = wasm::plan_across_pools(
        &accounts(),
        plan_request(utxos.clone(), 2),
        std::slice::from_ref(&funding),
        &across(legs([None, None]), vec![fill.clone()]),
        4,
    )
    .unwrap();
    assert_eq!(wide.mixes, wide.boxes * 5);
    assert!(wide.boxes < plan.boxes, "{wide:?}");
    // A token pool named twice, or a plan with no parameters to price a token change by.
    let twice = vec![legs([None, None]).remove(0), legs([None, None]).remove(0)];
    assert!(
        wasm::plan_across_pools(
            &accounts(),
            plan_request(utxos.clone(), 1),
            &[],
            &across(twice, Vec::new()),
            3,
        )
        .is_err()
    );
    let no_params = Across {
        params: None,
        ..across(legs([None, None]), Vec::new())
    };
    assert!(
        wasm::plan_across_pools(&accounts(), plan_request(utxos, 1), &[], &no_params, 3).is_err()
    );
}

#[test]
fn a_return_across_pools_deposits_once_and_mixes_each_box_in_its_pool() {
    let sk = Scalar::from(31_337u64);
    let (utxos, funding, fill) = filled();
    let request = ChainRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos,
        collateral: collateral(),
        pool: Vec::new(),
        depth: 1,
        boxes: None,
        merge: Vec::new(),
        again: false,
        own: vec![funding.clone()],
    };
    let chain = wasm::chain_across_pools(
        &accounts(),
        sk,
        request,
        &across(legs([Some(2), Some(1)]), vec![fill.clone()]),
        3,
    )
    .unwrap();
    assert!(chain.skipped.is_none());
    assert_eq!(chain.legs, vec![2, 1]);
    assert_eq!(chain.boxes, 3);
    let kinds: Vec<&str> = chain.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, ["deposit", "mix", "mix", "mix", "back"]);

    // One deposit: the fill's LJTEST and the funding's ADA in, two token boxes and a classic box out, and the
    // third box's worth of LJTEST back apart.
    let deposit_bytes = hex::decode(&chain.txs[0].tx_cbor).unwrap();
    let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
    let spent: Vec<String> = deposit
        .inputs()
        .iter()
        .map(|i| hex::encode(i.hash()))
        .collect();
    assert!(spent.contains(&fill));
    assert!(spent.contains(&funding));
    let outputs = deposit.outputs();
    let (token, classic) = (token_pool(), classic());
    let at = |o: &pallas_traverse::MultiEraOutput, p: &Protocol| {
        o.address().unwrap().to_vec() == p.mix_box_address().to_vec()
    };
    for o in &outputs[..2] {
        assert!(at(o, &token));
        assert_eq!(o.value().coin(), 2_000_000);
        assert_eq!(holds_ljtest(o), Some(Q));
    }
    assert!(at(&outputs[2], &classic));
    assert_eq!(outputs[2].value().coin(), 10_000_000);
    assert_eq!(holds_ljtest(&outputs[3]), Some(Q));

    // The token pool's mixes first, each in its own pool alone; each leg's leaves among its own mixes' outputs.
    let mixed_in = |i: usize, p: &Protocol| {
        let bytes = hex::decode(&chain.txs[i].tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        tx.outputs().iter().take(3).all(|o| at(o, p))
    };
    assert!(mixed_in(1, &token) && mixed_in(2, &token) && mixed_in(3, &classic));
    let leaf_of = |leaf: &OutRef| {
        chain
            .txs
            .iter()
            .position(|t| t.tx_hash == leaf.tx_hash)
            .unwrap()
    };
    assert!(
        chain.leaves[..2]
            .iter()
            .all(|l| (1..=2).contains(&leaf_of(l)))
    );
    assert_eq!(leaf_of(&chain.leaves[2]), 3);

    // The return takes the third box's worth home, with the chain's change and the collateral.
    let returned: u64 = chain
        .tokens
        .iter()
        .filter(|t| t.policy_id == LJTEST)
        .map(|t| t.quantity.parse::<u64>().unwrap())
        .sum();
    assert_eq!(returned, Q);
}

#[test]
fn a_session_mixes_four_boxes_a_mix_when_asked() {
    let sk = Scalar::from(4_040u64);
    let (mut utxos, funding, _) = filled();
    utxos.remove(1);
    let classic = classic();
    let plan = wasm::plan_at(&accounts(), plan_request(utxos.clone(), 2), None, &[], 4).unwrap();
    assert_eq!(plan.mixes, plan.boxes * 5);
    assert_eq!(
        plan.mix_fees,
        (plan.mixes as u64 * lovejoin::MIX_FEE_ESTIMATE_FOUR).to_string()
    );
    let funded = wasm::funding_at(
        FundingRequest {
            network: "preprod".into(),
            boxes: 1,
            depth: 1,
            again: false,
        },
        None,
        4,
    )
    .unwrap();
    assert_eq!(funded.mixes, 1);
    assert_eq!(
        funded.lovelace,
        (1_500_000 + 10_000_000 + lovejoin::MIX_FEE_ESTIMATE_FOUR).to_string()
    );
    let chain = wasm::chain_at(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos,
            collateral: collateral(),
            pool: others(&classic, 0xc0, 3),
            depth: 1,
            boxes: Some(1),
            merge: Vec::new(),
            again: false,
            own: vec![funding],
        },
        None,
        4,
    )
    .unwrap();
    let kinds: Vec<&str> = chain.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, ["deposit", "mix", "back"]);
    let bytes = hex::decode(&chain.txs[1].tx_cbor).unwrap();
    let mix = MultiEraTx::decode(&bytes).unwrap();
    // Four boxes and the fee input in; four boxes and the change out.
    assert_eq!(mix.inputs().len(), 5);
    assert_eq!(mix.outputs().len(), 5);
    // Three wide, two of those others would do; four wide they're short, and the chain says so.
    let short = wasm::chain_at(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: filled()
                .0
                .into_iter()
                .filter(|u| u.asset_list.as_ref().is_none_or(|a| a.is_empty()))
                .collect(),
            collateral: collateral(),
            pool: others(&classic, 0xc0, 2),
            depth: 1,
            boxes: Some(1),
            merge: Vec::new(),
            again: false,
            own: Vec::new(),
        },
        None,
        4,
    )
    .unwrap();
    assert!(short.skipped.is_some());
    assert!(short.txs.is_empty());
}

#[test]
fn a_requests_width_is_read_on_its_own_and_checked() {
    let named = |text: &str| serde_json::from_str::<Wide>(text).unwrap().width();
    // None named is three, as every request before it.
    assert_eq!(named(r#"{"network":"preprod","boxes":1}"#).unwrap(), 3);
    assert_eq!(named(r#"{"width":4}"#).unwrap(), 4);
    assert!(named(r#"{"width":5}"#).is_err());
    assert!(named(r#"{"width":2}"#).is_err());
    let funded = |width| {
        wasm::funding_at(
            FundingRequest {
                network: "preprod".into(),
                boxes: 1,
                depth: 1,
                again: false,
            },
            None,
            width,
        )
    };
    assert!(funded(5).is_err());
    // Three is the classic funding exactly.
    assert_eq!(
        serde_json::to_value(funded(3).unwrap()).unwrap(),
        serde_json::to_value(
            wasm::funding(FundingRequest {
                network: "preprod".into(),
                boxes: 1,
                depth: 1,
                again: false,
            })
            .unwrap()
        )
        .unwrap()
    );
}
