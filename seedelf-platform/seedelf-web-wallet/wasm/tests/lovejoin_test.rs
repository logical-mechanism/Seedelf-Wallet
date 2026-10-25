//! Lovejoin through the web wallet's WebAssembly layer (`seedelf_wasm::lovejoin`):
//! a session's chain, signed by its key and measured against the deployed
//! preprod scripts, and the later withdraw of its boxes. Mainnet's are in
//! `lovejoin_mainnet_test.rs`.

use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{
    BoxValue, PoolBox, Protocol, ReferenceDatum, holder_address, mix_datum, templates,
};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self, AccountChainRequest, BootstrapMostRequest, ChainRequest, FinishRequest, FundingRequest,
    OutRef, OwnedRequest, PlanRequest, PoolRef, WithdrawRequest,
};
use serde_json::{Value, json};

mod deep;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const MIN_POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";

fn accounts() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap()
}

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/eval-preprod.json"
    ))
    .unwrap()
}

/// Preprod's parameters at epoch 315, with its 350-entry V3 cost model.
fn params() -> Value {
    let cases = fixture()["cases"].as_array().unwrap().clone();
    let seedelf = cases
        .iter()
        .find(|c| c["name"].as_str().unwrap().starts_with("seedelf"))
        .unwrap();
    json!({
        "min_fee_a": 44, "min_fee_b": 155381, "coins_per_utxo_size": "4310",
        "key_deposit": "2000000", "price_mem": 0.0577, "price_step": 0.0000721,
        "min_fee_ref_script_cost_per_byte": 15,
        "cost_models": { "PlutusV3": seedelf["cost_model_v3"] },
    })
}

fn session() -> String {
    api::one_time_address(&accounts(), true, 0)
        .unwrap()
        .to_bech32()
        .unwrap()
}

fn row(
    tx: u8,
    index: u64,
    address: &str,
    lovelace: u64,
    tokens: &[(&str, &str, u64)],
) -> UtxoResponse {
    let assets: Vec<Value> = tokens
        .iter()
        .map(|(p, n, q)| json!({ "policy_id": p, "asset_name": n, "quantity": q.to_string(), "decimals": 0, "fingerprint": "" }))
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": index, "address": address,
        "value": lovelace.to_string(), "stake_address": null, "payment_cred": "",
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": null, "reference_script": null, "asset_list": assets, "is_spent": false,
    }))
    .unwrap()
}

/// A box as Koios lists it at `mix_box`.
fn box_row(b: &PoolBox, protocol: &Protocol) -> UtxoResponse {
    serde_json::from_value(json!({
        "tx_hash": hex::encode(b.utxo.tx_hash), "tx_index": b.utxo.index,
        "address": protocol.mix_box_address().to_bech32().unwrap(),
        "value": protocol.denom.to_string(), "stake_address": null,
        "payment_cred": hex::encode(protocol.mix_box_hash),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": { "bytes": hex::encode(mix_datum(&b.a, &b.b)), "value": {} },
        "reference_script": null, "asset_list": [], "is_spent": false,
    }))
    .unwrap()
}

/// Every box the recorded Lovejoin transactions spent, as pool rows.
fn pool(protocol: &Protocol) -> Vec<UtxoResponse> {
    let mut seen: Vec<PoolBox> = Vec::new();
    for case in fixture()["cases"].as_array().unwrap() {
        for u in case["utxos"].as_array().unwrap() {
            let r = Resolved {
                tx_hash: hex::decode(u["tx_hash"].as_str().unwrap())
                    .unwrap()
                    .try_into()
                    .unwrap(),
                index: u["index"].as_u64().unwrap(),
                output: hex::decode(u["output"].as_str().unwrap()).unwrap(),
            };
            if let Some(b) = PoolBox::from_resolved(r, protocol)
                && !seen.iter().any(|s| s.utxo == b.utxo)
            {
                seen.push(b);
            }
        }
    }
    seen.iter().map(|b| box_row(b, protocol)).collect()
}

fn holdings() -> Vec<UtxoResponse> {
    let at = session();
    vec![
        row(1, 0, &at, 30_000_000, &[]),
        row(2, 1, &at, 5_000_000, &[]),
        row(3, 0, &at, 2_000_000, &[(MIN_POLICY, "4d494e", 500)]),
    ]
}

fn collateral() -> OutRef {
    OutRef {
        tx_hash: hex::encode([2u8; 32]),
        tx_index: 1,
    }
}

fn spends(tx: &MultiEraTx, hash: [u8; 32], index: u64) -> bool {
    tx.inputs()
        .iter()
        .any(|i| **i.hash() == hash && i.index() == index)
}

#[test]
fn a_session_plans_its_boxes_on_its_spare_ada() {
    let plan = |depth| {
        lovejoin::plan(
            &accounts(),
            PlanRequest {
                network: "preprod".into(),
                index: 0,
                utxos: holdings(),
                collateral: Some(collateral()),
                depth,
                again: false,
                collateral_reserve: false,
            },
        )
        .unwrap()
    };
    // 30 ₳ spare (the collateral and the token UTxO aside).
    let one = plan(1);
    assert_eq!(
        (one.boxes, one.mixes, one.spare.as_str()),
        (2, 2, "30000000")
    );
    let two = plan(2);
    assert_eq!((two.boxes, two.mixes), (2, 8));
}

#[test]
fn a_sessions_chain_is_signed_in_order_and_spends_its_collateral_last() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(1234u64);
    let result = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: holdings(),
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: None,
            merge: vec![],
            again: false,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap();
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, vec!["deposit", "mix", "mix", "back"]);
    assert_eq!(result.boxes, 2);
    assert_eq!(result.leaves.len(), 2);

    let key = accounts().key_hash(Role::Receive, 0).unwrap();
    let txs: Vec<Vec<u8>> = result
        .txs
        .iter()
        .map(|t| hex::decode(&t.tx_cbor).unwrap())
        .collect();
    for (i, bytes) in txs.iter().enumerate() {
        let tx = MultiEraTx::decode(bytes).unwrap();
        assert_eq!(hex::encode(tx.hash()), result.txs[i].tx_hash);
        // Signed by the session's key, once.
        let witnesses = tx.vkey_witnesses();
        assert_eq!(witnesses.len(), 1, "{}", result.txs[i].kind);
        let signer = pallas_crypto::hash::Hasher::<224>::hash(&witnesses[0].vkey);
        assert_eq!(signer, key);
        // The collateral is spent only by the return.
        assert_eq!(spends(&tx, [2; 32], 1), result.txs[i].kind == "back");
        // Each transaction after the deposit spends the one before's change.
        if i > 0 {
            let before = MultiEraTx::decode(&txs[i - 1]).unwrap();
            assert!(tx.inputs().iter().any(|inp| *inp.hash() == before.hash()));
        }
    }
    // The return takes the token UTxO too, and everything lands in Seedelf.
    let back = MultiEraTx::decode(txs.last().unwrap()).unwrap();
    assert!(spends(&back, [3; 32], 0));
    for output in back.outputs() {
        let address = Address::from_bytes(&output.address().unwrap().to_vec()).unwrap();
        assert!(address.has_script(), "into the wallet contract");
    }
}

/// The change a session's funding made: a Seedelf UTxO under a fresh copy
/// of `sk`'s register.
fn funding_change(sk: Scalar) -> UtxoResponse {
    let config = seedelf_core::constants::get_config(1, true).unwrap();
    let wallet = seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash);
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let mut change = row(9, 2, &wallet.to_bech32().unwrap(), 12_000_000, &[]);
    change.inline_datum = serde_json::from_value(json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
    .unwrap();
    change
}

#[test]
fn a_chains_return_merges_into_the_funding_change() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(4321u64);
    let result = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: holdings(),
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![funding_change(sk)],
            again: false,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap();
    assert_eq!(result.merged, 1);
    let back = result.txs.last().unwrap();
    assert_eq!(back.kind, "back");
    let bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    // The funding's change, the chain's last change, the collateral (also
    // the collateral) and the token UTxO.
    assert!(spends(&tx, [9; 32], 2));
    assert!(spends(&tx, [2; 32], 1));
    assert!(spends(&tx, [3; 32], 0));
    assert_eq!(tx.inputs().len(), 4);
    let collaterals: Vec<_> = tx
        .collateral()
        .iter()
        .map(|i| (**i.hash(), i.index()))
        .collect();
    assert_eq!(collaterals, vec![([2; 32], 1)]);
    // One Seedelf spend, its proof bound to a one-time key, which signs with the session's.
    assert_eq!(tx.redeemers().len(), 1);
    let signers: Vec<_> = tx
        .vkey_witnesses()
        .iter()
        .map(|w| pallas_crypto::hash::Hasher::<224>::hash(&w.vkey))
        .collect();
    let session_key = accounts().key_hash(Role::Receive, 0).unwrap();
    assert_eq!(signers.len(), 2);
    assert!(signers.contains(&session_key));
    let required = seedelf_core::build::required_signers(&bytes).unwrap();
    assert_eq!(required.len(), 1);
    assert_ne!(required[0], session_key, "never the session's key");
    assert!(signers.contains(&required[0]));
    // What comes back at once is the account's ADA less the return's fee, with the token.
    let fee: u64 = back.fee.parse().unwrap();
    let into: u64 = tx.outputs().iter().map(|o| o.value().coin()).sum();
    assert_eq!(into, 12_000_000 + result.returned.parse::<u64>().unwrap());
    assert_eq!(result.tokens.len(), 1);
    assert!(fee > 0);
}

/// A Bootstrap's session (depth 0) is funded with no collateral (the owner,
/// 2026-10-23): its deposit runs no script, and its return is a sweep, never
/// merged, since a merge needs one to put up. Funded exactly as the worker funds
/// it, one UTxO of its boxes, the deposit's reserve and its way back's (1.6.0's
/// release review, 318-rust#0), its whole chain builds, at one box and at the
/// most the private balance may put in. A chain that mixes still can't go
/// without one.
#[test]
fn a_bootstrap_with_no_collateral_deposits_and_sweeps_back() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(4321u64);
    let at = session();
    let most = lovejoin::bootstrap_most_in(
        BootstrapMostRequest {
            network: "preprod".into(),
            params: params(),
            most: 96,
        },
        None,
    )
    .unwrap();
    let config = seedelf_core::constants::get_config(1, true).unwrap();
    let least = seedelf_core::build::minimum_seedelf_payment(
        &seedelf_koios::koios::ProtocolParameters::from_koios(&params()).unwrap(),
        &seedelf_core::assets::Assets::new(),
    )
    .unwrap();
    for boxes in [1, most] {
        let funding = lovejoin::funding(FundingRequest {
            network: "preprod".into(),
            boxes,
            depth: 0,
            again: false,
        })
        .unwrap();
        let lovelace = funding.lovelace.parse::<u64>().unwrap()
            + seedelf_core::lovejoin::BOOTSTRAP_BACK_RESERVE;
        let funded = vec![row(1, 0, &at, lovelace, &[])];
        let plan = lovejoin::plan(
            &accounts(),
            PlanRequest {
                network: "preprod".into(),
                index: 0,
                utxos: funded.clone(),
                collateral: None,
                depth: 0,
                again: false,
                collateral_reserve: false,
            },
        )
        .unwrap();
        // The way back's reserve never pays for a box more.
        assert_eq!(plan.boxes, boxes);
        let request = |depth| ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: funded.clone(),
            collateral: None,
            pool: pool(&protocol),
            depth,
            boxes: Some(boxes),
            merge: vec![funding_change(sk)],
            again: false,
            own: vec![hex::encode([1u8; 32])],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        };
        let result = lovejoin::chain(&accounts(), sk, request(0))
            .unwrap_or_else(|e| panic!("{boxes} boxes, funded {lovelace}: {e}"));
        let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
        assert_eq!(kinds, vec!["deposit", "back"]);
        assert_eq!(result.boxes, boxes);
        assert_eq!(result.merged, 0, "swept: nothing to put up for a merge");
        let bytes: Vec<Vec<u8>> = result
            .txs
            .iter()
            .map(|t| hex::decode(&t.tx_cbor).unwrap())
            .collect();
        let txs: Vec<MultiEraTx> = bytes
            .iter()
            .map(|b| MultiEraTx::decode(b).unwrap())
            .collect();
        for (tx, out) in txs.iter().zip(&result.txs) {
            assert!(tx.collateral().is_empty(), "{} puts up nothing", out.kind);
            assert!(tx.redeemers().is_empty(), "{} runs no script", out.kind);
        }
        // Every box goes in, and the deposit's change stays at the session's own address.
        let boxed = txs[0]
            .outputs()
            .iter()
            .filter(|o| o.value().coin() == protocol.denom)
            .count();
        assert_eq!(boxed, boxes);
        let change: Vec<String> = txs[0]
            .outputs()
            .iter()
            .map(|o| Address::from_bytes(&o.address().unwrap().to_vec()).unwrap())
            .filter(|a| !a.has_script())
            .map(|a| a.to_bech32().unwrap())
            .collect();
        assert_eq!(change, vec![at.clone()]);
        // The return spends that change alone, leaves the funding's change where it is, and pays the wallet
        // contract all the rest: what the fees didn't use, at least a Seedelf output's least.
        assert!(spends(&txs[1], *txs[0].hash(), boxes as u64));
        assert!(!spends(&txs[1], [9; 32], 2));
        assert_eq!(txs[1].inputs().len(), 1);
        let wallet =
            seedelf_core::address::wallet_contract(true, config.contract.wallet_contract_hash);
        for output in txs[1].outputs() {
            let address = Address::from_bytes(&output.address().unwrap().to_vec()).unwrap();
            assert_eq!(address, wallet, "into the wallet contract");
        }
        let returned: u64 = result.returned.parse().unwrap();
        let fees: u64 = result.fees.parse().unwrap();
        assert_eq!(returned + fees + boxes as u64 * protocol.denom, lovelace);
        assert!(returned >= least, "{returned}");
        println!("{boxes} boxes, funded {lovelace}: fees {fees}, {returned} back");
        let refused = lovejoin::chain(&accounts(), sk, request(1)).unwrap_err();
        assert!(
            refused
                .to_string()
                .contains("needs the session's collateral"),
            "{refused}"
        );
    }
}

#[test]
fn a_chains_return_leaves_out_what_would_overflow_a_token() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(4322u64);
    let at = session();
    // A stranger's three UTxOs of 2^63 − 1 of one token at the session.
    let junk = (1u64 << 63) - 1;
    let mut utxos = holdings();
    for tx in 7..10 {
        utxos.push(row(
            tx,
            0,
            &at,
            1_500_000,
            &[(&"ab".repeat(28), "6a756e6b", junk)],
        ));
    }
    let chain = |merge: Vec<UtxoResponse>| {
        lovejoin::chain(
            &accounts(),
            sk,
            ChainRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos: utxos.clone(),
                collateral: Some(collateral()),
                pool: pool(&protocol),
                depth: 1,
                boxes: Some(1),
                merge,
                again: false,
                own: vec![],
                collateral_pool: None,
                collateral_boxes: vec![],
                collateral_reserve: false,
            },
        )
        .unwrap()
    };
    for (merge, merged) in [(vec![], 0), (vec![funding_change(sk)], 1)] {
        let result = chain(merge);
        assert_eq!(result.merged, merged);
        let back = result.txs.last().unwrap();
        let bytes = hex::decode(&back.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        // The session's token UTxO and two of the three come back; one waits.
        assert!(spends(&tx, [3; 32], 0));
        assert!(spends(&tx, [7; 32], 0) && spends(&tx, [8; 32], 0));
        assert!(!spends(&tx, [9; 32], 0));
        assert_eq!(result.left_out.len(), 1);
        assert_eq!(result.left_out[0].tx_hash, hex::encode([9u8; 32]));
        assert_eq!(result.tokens.len(), 2);
    }
}

/// The recorded Koios row's reference script: the Seedelf policy, 519 bytes.
fn recorded_script() -> Option<seedelf_koios::koios::ReferenceScript> {
    let rows: Vec<UtxoResponse> = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/reference_script_utxo.json"
    ))
    .unwrap();
    rows[0].reference_script.clone()
}

#[test]
fn a_utxo_with_a_reference_script_pays_no_mix_and_comes_back_swept() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(4323u64);
    // A stranger's ADA-only UTxO at the session, carrying a reference script:
    // the wallet's evaluator can't take it.
    let mut utxos = holdings();
    utxos.push(UtxoResponse {
        reference_script: recorded_script(),
        ..row(8, 0, &session(), 40_000_000, &[])
    });
    let result = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos,
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![funding_change(sk)],
            again: false,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap();
    let deposit = MultiEraTx::decode(&hex::decode(&result.txs[0].tx_cbor).unwrap())
        .unwrap()
        .inputs()
        .iter()
        .map(|i| **i.hash())
        .collect::<Vec<_>>();
    assert_eq!(
        deposit,
        vec![[1; 32]],
        "the deposit is paid from the session's own"
    );
    // The return takes it, swept into new registers: no script runs, and the
    // fee pays for its 519 bytes.
    assert_eq!(result.merged, 0);
    let back = result.txs.last().unwrap();
    let bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    assert!(spends(&tx, [8; 32], 0) && spends(&tx, [2; 32], 1) && spends(&tx, [3; 32], 0));
    assert!(tx.redeemers().is_empty());
    let fee: u64 = back.fee.parse().unwrap();
    assert!(fee >= 44 * bytes.len() as u64 + 155_381 + 519 * 15);
    assert!(result.left_out.is_empty());
}

#[test]
fn the_boxes_come_back_one_by_one_through_giveme_my() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(5678u64);
    let chain = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: holdings(),
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![],
            again: false,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap();

    // The pool, as Koios would list it once the chain is in: our leaf among others.
    // Koios lists only what's unspent: what a later transaction of the chain
    // spends is gone.
    let txs: Vec<Vec<u8>> = chain
        .txs
        .iter()
        .map(|t| hex::decode(&t.tx_cbor).unwrap())
        .collect();
    let spent: Vec<([u8; 32], u64)> = txs
        .iter()
        .flat_map(|b| {
            MultiEraTx::decode(b)
                .unwrap()
                .inputs()
                .iter()
                .map(|i| (**i.hash(), i.index()))
                .collect::<Vec<_>>()
        })
        .collect();
    let mut rows: Vec<UtxoResponse> = pool(&protocol)
        .into_iter()
        .filter(|r| {
            let hash: [u8; 32] = hex::decode(&r.tx_hash).unwrap().try_into().unwrap();
            !spent.contains(&(hash, r.tx_index))
        })
        .collect();
    for bytes in &txs {
        for r in eval::resolve_outputs(bytes).unwrap() {
            if spent.contains(&(r.tx_hash, r.index)) {
                continue;
            }
            if let Some(b) = PoolBox::from_resolved(r, &protocol) {
                rows.push(box_row(&b, &protocol));
            }
        }
    }
    let owned = lovejoin::owned(
        sk,
        OwnedRequest {
            network: "preprod".into(),
            pool: rows.clone(),
        },
    )
    .unwrap();
    assert_eq!(owned.boxes, chain.leaves);
    assert_eq!(owned.lovelace, "10000000");

    let built = lovejoin::withdraw(
        sk,
        WithdrawRequest {
            network: "preprod".into(),
            params: params(),
            pool: rows,
            box_ref: None,
        },
    )
    .unwrap();
    assert_eq!(built.box_ref, chain.leaves[0]);
    let fee: u64 = built.fee.parse().unwrap();
    assert_eq!(built.lovelace.parse::<u64>().unwrap(), 10_000_000 - fee);

    // giveme.my's signature is checked, then added: the only witness.
    let giveme = SecretKey::new(OsRng);
    let hash = seedelf_core::build::tx_id(&hex::decode(&built.tx_cbor).unwrap()).unwrap();
    let signature = giveme.sign(hash);
    let answer = json!({ "witness": format!("8258{}", hex::encode([0u8; 32])) + &hex::encode(signature.as_ref()) });
    let finished = lovejoin::finish_with_collateral_key(
        FinishRequest {
            tx_cbor: built.tx_cbor.clone(),
            collateral: answer.clone(),
        },
        giveme.public_key(),
    )
    .unwrap();
    assert_eq!(finished.tx_hash, built.tx_hash);
    let signed = hex::decode(&finished.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&signed).unwrap();
    assert_eq!(tx.vkey_witnesses().len(), 1);
    // A signature from anyone else isn't added.
    let stranger = SecretKey::new(OsRng).public_key();
    assert!(
        lovejoin::finish_with_collateral_key(
            FinishRequest {
                tx_cbor: built.tx_cbor,
                collateral: answer
            },
            stranger
        )
        .is_err()
    );
}

#[test]
fn a_session_without_a_box_of_spare_ada_is_refused() {
    let protocol = Protocol::of(true).unwrap();
    let at = session();
    let err = lovejoin::chain(
        &accounts(),
        Scalar::from(1u64),
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: vec![
                row(1, 0, &at, 8_000_000, &[]),
                row(2, 1, &at, 5_000_000, &[]),
            ],
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 2,
            boxes: None,
            merge: vec![],
            again: false,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("doesn't pay for a Lovejoin box"),
        "{err}"
    );
}

/// A UTxO of the public account (account 0) at `role/index`'s base address, with its path.
fn public_utxo(tx: u8, role: Role, index: u32, lovelace: u64) -> api::PathedUtxo {
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let at = public
        .base_address(true, role, index)
        .unwrap()
        .to_bech32()
        .unwrap();
    api::PathedUtxo {
        utxo: row(tx, 0, &at, lovelace, &[]),
        role: role as u32,
        index,
    }
}

#[test]
fn the_tile_funds_exactly_the_boxes_asked_for() {
    let funded = lovejoin::funding(FundingRequest {
        network: "preprod".into(),
        boxes: 2,
        depth: 2,
        again: false,
    })
    .unwrap();
    assert_eq!((funded.lovelace.as_str(), funded.mixes), ("29100000", 8));
    assert!(
        lovejoin::funding(FundingRequest {
            network: "preprod".into(),
            boxes: 0,
            depth: 2,
            again: false,
        })
        .is_err()
    );
    // Mainnet's boxes hold the same 10 ₳.
    let mainnet = lovejoin::funding(FundingRequest {
        network: "mainnet".into(),
        boxes: 2,
        depth: 2,
        again: false,
    })
    .unwrap();
    assert_eq!((mainnet.lovelace, mainnet.mixes), (funded.lovelace, 8));
}

#[test]
fn the_public_account_mixes_straight_in_signed_by_the_keys_it_spends() {
    let protocol = Protocol::of(true).unwrap();
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let sk = Scalar::from(2468u64);
    let key = |role: Role, index: u32| public.key_hash(role, index).unwrap();
    let build = |collateral: api::PathedUtxo| {
        lovejoin::chain_from_account(
            &public,
            sk,
            AccountChainRequest {
                network: "preprod".into(),
                params: params(),
                // Two boxes at depth 1 take 23.4 ₳: the two largest ADA-only
                // UTxOs, under two keys; the small one and the token one stay.
                utxos: vec![
                    public_utxo(0x51, Role::Receive, 1, 15_000_000),
                    public_utxo(0x52, Role::Change, 0, 12_000_000),
                    public_utxo(0x53, Role::Receive, 2, 3_000_000),
                    // The largest, but carrying a reference script: never a coin.
                    api::PathedUtxo {
                        utxo: UtxoResponse {
                            reference_script: recorded_script(),
                            ..public_utxo(0x54, Role::Receive, 3, 50_000_000).utxo
                        },
                        ..public_utxo(0x54, Role::Receive, 3, 50_000_000)
                    },
                ],
                collateral: Some(collateral),
                pool: pool(&protocol),
                depth: 1,
                boxes: 2,
            },
        )
        .unwrap()
    };
    let signers = |t: &lovejoin::ChainTxOut| -> Vec<pallas_crypto::hash::Hash<28>> {
        let bytes = hex::decode(&t.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let mut keys: Vec<_> = tx
            .vkey_witnesses()
            .iter()
            .map(|w| pallas_crypto::hash::Hasher::<224>::hash(&w.vkey))
            .collect();
        keys.sort();
        keys
    };
    let sorted = |mut v: Vec<pallas_crypto::hash::Hash<28>>| {
        v.sort();
        v
    };

    // The collateral at 0/0, where the change goes: one key signs each mix.
    let result = build(public_utxo(0x5c, Role::Receive, 0, 5_000_000));
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(
        kinds,
        vec!["deposit", "mix", "mix"],
        "no return: the change stays"
    );
    assert_eq!(result.leaves.len(), 2);
    assert_eq!(
        signers(&result.txs[0]),
        sorted(vec![key(Role::Receive, 1), key(Role::Change, 0)])
    );
    for mix in &result.txs[1..] {
        assert_eq!(signers(mix), vec![key(Role::Receive, 0)]);
    }
    let deposit_bytes = hex::decode(&result.txs[0].tx_cbor).unwrap();
    let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
    assert!(spends(&deposit, [0x51; 32], 0) && spends(&deposit, [0x52; 32], 0));
    assert!(!spends(&deposit, [0x53; 32], 0));

    // The collateral elsewhere: its key signs each mix too, and each fee pays for both.
    let result = build(public_utxo(0x5d, Role::Receive, 7, 5_000_000));
    for mix in &result.txs[1..] {
        assert_eq!(
            signers(mix),
            sorted(vec![key(Role::Receive, 0), key(Role::Receive, 7)])
        );
        let bytes = hex::decode(&mix.tx_cbor).unwrap();
        let fee: u64 = mix.fee.parse().unwrap();
        assert!(
            fee >= 44 * bytes.len() as u64 + 155_381,
            "the fee covers the signed size"
        );
    }
    assert!(result.returned.parse::<u64>().unwrap() > 1_000_000);

    // Too little ADA says so.
    let err = lovejoin::chain_from_account(
        &public,
        sk,
        AccountChainRequest {
            network: "preprod".into(),
            params: params(),
            utxos: vec![public_utxo(0x51, Role::Receive, 1, 15_000_000)],
            collateral: Some(public_utxo(0x5c, Role::Receive, 0, 5_000_000)),
            pool: pool(&protocol),
            depth: 1,
            boxes: 2,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("doesn't pay for 2 boxes"), "{err}");
}

/// `count` boxes of `sk`'s in the pool, as Koios lists them (a deposit's,
/// not on chain: the evaluator reads them from their rows).
fn our_box_rows(sk: Scalar, count: usize, protocol: &Protocol) -> Vec<UtxoResponse> {
    let params = seedelf_koios::koios::ProtocolParameters::from_koios(&params()).unwrap();
    let base = Register::create(sk).unwrap();
    let owners: Vec<Register> = (0..count)
        .map(|_| base.clone().rerandomize().unwrap())
        .collect();
    let at = Address::from_bech32(&session()).unwrap();
    let paying =
        seedelf_core::lovejoin::Coin::from_row(&row(7, 0, &session(), 50_000_000, &[])).unwrap();
    seedelf_core::lovejoin::deposit(&params, protocol, &[paying], &owners, &at, 1)
        .unwrap()
        .boxes
        .iter()
        .map(|b| box_row(b, protocol))
        .collect()
}

#[test]
fn a_strangers_deep_utxos_at_mix_box_leave_the_pool_readable() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(1357u64);
    let ours = our_box_rows(sk, 2, &protocol);
    let mut rows: Vec<Value> = pool(&protocol)
        .iter()
        .chain(&ours)
        .map(|r| serde_json::to_value(r).unwrap())
        .collect();
    rows.extend([json!("datum"), json!("script")]);
    let mix_box = protocol.mix_box_address().to_bech32().unwrap();
    let cred = hex::encode(protocol.mix_box_hash);
    // A box-sized UTxO under a deep datum, and a box of ours but for its deep
    // reference script.
    let deep_datum = deep::row(
        0xd1,
        &mix_box,
        &cred,
        protocol.denom,
        &deep::datum(200),
        "null",
    );
    let scripted = deep::row(
        0xd2,
        &mix_box,
        &cred,
        protocol.denom,
        &serde_json::to_string(&ours[0].inline_datum).unwrap(),
        &deep::script(100_000),
    );
    let strangers = [
        ("datum", deep_datum.as_str()),
        ("script", scripted.as_str()),
    ];

    // What `lovejoinOwned` does with the worker's JSON: both are skipped.
    let request: OwnedRequest = serde_json::from_str(&deep::splice(
        &json!({ "network": "preprod", "pool": rows }),
        &strangers,
    ))
    .unwrap();
    let owned = lovejoin::owned(sk, request).unwrap();
    assert_eq!(owned.boxes.len(), 2);
    assert_eq!(owned.lovelace, "20000000");

    // `buildLovejoinWithdraw` takes one of ours back.
    let request: WithdrawRequest = serde_json::from_str(&deep::splice(
        &json!({ "network": "preprod", "params": params(), "pool": rows }),
        &strangers,
    ))
    .unwrap();
    let built = lovejoin::withdraw(sk, request).unwrap();
    assert!(owned.boxes.contains(&built.box_ref));
}

#[test]
fn a_mix_session_mixes_the_wallets_boxes_again_with_no_deposit() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(2468u64);
    let ours = our_box_rows(sk, 3, &protocol);
    let mut every = pool(&protocol);
    every.extend(ours.iter().cloned());
    let at = session();
    // The funding for two boxes at depth 1, a small ADA UTxO sent to the
    // account since, the collateral, and a token UTxO.
    let funded = seedelf_core::lovejoin::again_funding(2, 1);
    let utxos = vec![
        row(1, 0, &at, funded, &[]),
        row(4, 0, &at, 1_500_000, &[]),
        row(2, 1, &at, 5_000_000, &[]),
        row(3, 0, &at, 2_000_000, &[(MIN_POLICY, "4d494e", 500)]),
    ];
    let plan = lovejoin::plan(
        &accounts(),
        PlanRequest {
            network: "preprod".into(),
            index: 0,
            utxos: utxos.clone(),
            collateral: Some(collateral()),
            depth: 1,
            again: true,
            collateral_reserve: false,
        },
    )
    .unwrap();
    // The mixes alone, paid from the largest UTxO: the funding.
    assert_eq!((plan.boxes, plan.mixes), (2, 2));

    let result = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos,
            collateral: Some(collateral()),
            pool: every,
            depth: 1,
            boxes: Some(2),
            merge: vec![],
            again: true,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap();
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, vec!["mix", "mix", "back"]);
    assert_eq!((result.boxes, result.leaves.len()), (2, 2));

    let key = accounts().key_hash(Role::Receive, 0).unwrap();
    let bytes: Vec<Vec<u8>> = result
        .txs
        .iter()
        .map(|t| hex::decode(&t.tx_cbor).unwrap())
        .collect();
    let txs: Vec<MultiEraTx> = bytes
        .iter()
        .map(|b| MultiEraTx::decode(b).unwrap())
        .collect();
    for tx in &txs {
        let witnesses = tx.vkey_witnesses();
        assert_eq!(witnesses.len(), 1);
        assert_eq!(
            pallas_crypto::hash::Hasher::<224>::hash(&witnesses[0].vkey),
            key
        );
    }
    // The first mix pays from the funding and takes a box of ours; nothing
    // else of ours is spent twice, and the third box is left alone.
    assert!(spends(&txs[0], [1; 32], 0));
    let ours_spent = |tx: &MultiEraTx| {
        ours.iter()
            .filter(|r| {
                spends(
                    tx,
                    hex::decode(&r.tx_hash).unwrap().try_into().unwrap(),
                    r.tx_index,
                )
            })
            .count()
    };
    assert_eq!(ours_spent(&txs[0]), 1);
    assert_eq!(ours_spent(&txs[1]), 1);
    // The return takes the chain's change, the collateral, the ADA the chain
    // left alone and the token UTxO, all into the wallet contract.
    let back = &txs[2];
    assert!(spends(back, *txs[1].hash(), 3), "the last mix's change");
    assert!(spends(back, [2; 32], 1));
    assert!(spends(back, [4; 32], 0));
    assert!(spends(back, [3; 32], 0));
    for output in back.outputs() {
        let address = Address::from_bytes(&output.address().unwrap().to_vec()).unwrap();
        assert!(address.has_script(), "into the wallet contract");
    }
    assert_eq!(result.tokens.len(), 1);

    // None of the wallet's boxes in the pool: nothing to mix again.
    let err = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: vec![row(1, 0, &at, funded, &[]), row(2, 1, &at, 5_000_000, &[])],
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(2),
            merge: vec![],
            again: true,
            own: vec![],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("None of this wallet's boxes"),
        "{err}"
    );
}

#[test]
fn the_public_account_mixes_its_own_boxes_again_signed_by_the_keys_it_spends() {
    let protocol = Protocol::of(true).unwrap();
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let sk = Scalar::from(2468u64);
    let key = |role: Role, index: u32| public.key_hash(role, index).unwrap();
    let ours = our_box_rows(sk, 3, &protocol);
    let mut every = pool(&protocol);
    every.extend(ours.iter().cloned());
    let funded = seedelf_core::lovejoin::again_funding(2, 1);
    let build = |utxos: Vec<api::PathedUtxo>, pool: Vec<UtxoResponse>| {
        lovejoin::again_from_account(
            &public,
            sk,
            AccountChainRequest {
                network: "preprod".into(),
                params: params(),
                utxos,
                collateral: Some(public_utxo(0x5d, Role::Receive, 7, 5_000_000)),
                pool,
                depth: 1,
                boxes: 2,
            },
        )
    };
    let signers = |t: &lovejoin::ChainTxOut| -> Vec<pallas_crypto::hash::Hash<28>> {
        let bytes = hex::decode(&t.tx_cbor).unwrap();
        let tx = MultiEraTx::decode(&bytes).unwrap();
        let mut keys: Vec<_> = tx
            .vkey_witnesses()
            .iter()
            .map(|w| pallas_crypto::hash::Hasher::<224>::hash(&w.vkey))
            .collect();
        keys.sort();
        keys
    };
    let sorted = |mut v: Vec<pallas_crypto::hash::Hash<28>>| {
        v.sort();
        v
    };

    // The largest ADA-only UTxO pays, at 0/4; the smaller one stays.
    let result = build(
        vec![
            public_utxo(0x61, Role::Receive, 4, funded + 1_000_000),
            public_utxo(0x62, Role::Change, 0, 3_000_000),
        ],
        every.clone(),
    )
    .unwrap();
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(
        kinds,
        vec!["mix", "mix"],
        "no deposit, and no return: the change stays"
    );
    assert_eq!((result.boxes, result.leaves.len()), (2, 2));
    // The first mix is signed by the paying UTxO's key and the collateral's, the next by the change's (0/0) and the collateral's.
    assert_eq!(
        signers(&result.txs[0]),
        sorted(vec![key(Role::Receive, 4), key(Role::Receive, 7)])
    );
    assert_eq!(
        signers(&result.txs[1]),
        sorted(vec![key(Role::Receive, 0), key(Role::Receive, 7)])
    );
    let bytes: Vec<Vec<u8>> = result
        .txs
        .iter()
        .map(|t| hex::decode(&t.tx_cbor).unwrap())
        .collect();
    let txs: Vec<MultiEraTx> = bytes
        .iter()
        .map(|b| MultiEraTx::decode(b).unwrap())
        .collect();
    let ours_spent = |tx: &MultiEraTx| {
        ours.iter()
            .filter(|r| {
                spends(
                    tx,
                    hex::decode(&r.tx_hash).unwrap().try_into().unwrap(),
                    r.tx_index,
                )
            })
            .count()
    };
    assert!(spends(&txs[0], [0x61; 32], 0));
    assert!(spends(&txs[1], *txs[0].hash(), 3), "the first mix's change");
    assert_eq!((ours_spent(&txs[0]), ours_spent(&txs[1])), (1, 1));
    for tx in &txs {
        assert!(!spends(tx, [0x62; 32], 0) && !spends(tx, [0x5d; 32], 0));
    }
    for (mix, bytes) in result.txs.iter().zip(&bytes) {
        let fee: u64 = mix.fee.parse().unwrap();
        assert!(
            fee >= 44 * bytes.len() as u64 + 155_381,
            "the fee covers the signed size"
        );
    }
    assert!(result.returned.parse::<u64>().unwrap() > 1_000_000);

    // No one UTxO pays for it, though two together would: it says so.
    let err = build(
        vec![
            public_utxo(0x61, Role::Receive, 4, funded / 2 + 1),
            public_utxo(0x62, Role::Change, 0, funded / 2 + 1),
        ],
        every.clone(),
    )
    .unwrap_err();
    assert!(
        err.to_string()
            .contains("doesn't pay for mixing 2 boxes again"),
        "{err}"
    );
    // None of the wallet's boxes in the pool: nothing to mix again.
    let err = build(
        vec![public_utxo(0x61, Role::Receive, 4, funded + 1_000_000)],
        pool(&protocol),
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("None of this wallet's boxes"),
        "{err}"
    );
}

#[test]
fn mixing_again_is_funded_for_the_mixes_alone() {
    let funded = lovejoin::funding(FundingRequest {
        network: "preprod".into(),
        boxes: 2,
        depth: 2,
        again: true,
    })
    .unwrap();
    assert_eq!((funded.lovelace.as_str(), funded.mixes), ("9100000", 8));
}

/// What else anyone can leave at `mix_box`, none of it a box: a token beside
/// the 10 ₳, no datum, a datum whose points aren't on the curve, and a box's
/// datum on 12 ₳.
fn junk(protocol: &Protocol) -> Vec<UtxoResponse> {
    let like = |tx: u8| UtxoResponse {
        tx_hash: hex::encode([tx; 32]),
        ..pool(protocol)[0].clone()
    };
    vec![
        UtxoResponse {
            asset_list: Some(
                serde_json::from_value(json!([{ "policy_id": MIN_POLICY, "asset_name": "4d494e",
                    "quantity": "1", "decimals": 0, "fingerprint": "" }]))
                .unwrap(),
            ),
            ..like(0xe1)
        },
        UtxoResponse {
            inline_datum: None,
            ..like(0xe2)
        },
        UtxoResponse {
            inline_datum: serde_json::from_value(json!({
                "bytes": hex::encode(mix_datum(&[0xaa; 48], &[0xbb; 48])), "value": {},
            }))
            .unwrap(),
            ..like(0xe3)
        },
        UtxoResponse {
            value: "12000000".into(),
            ..like(0xe4)
        },
    ]
}

#[test]
fn junk_at_mix_box_is_not_counted_among_the_boxes_to_mix_with() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(1357u64);
    let ours = our_box_rows(sk, 2, &protocol);
    let boxes = pool(&protocol);
    let mut rows = boxes.clone();
    rows.extend(junk(&protocol));
    rows.extend(ours.iter().cloned());
    let owned = lovejoin::owned(
        sk,
        OwnedRequest {
            network: "preprod".into(),
            pool: rows,
        },
    )
    .unwrap();
    assert_eq!(owned.boxes.len(), 2);
    // Only the other boxes, never the junk: what a mix may take.
    assert_eq!(owned.others, boxes.len());
    let refs: Vec<OutRef> = boxes
        .iter()
        .map(|r| OutRef {
            tx_hash: r.tx_hash.clone(),
            tx_index: r.tx_index,
        })
        .collect();
    assert_eq!(owned.other_boxes, refs);
    let answer = serde_json::to_value(&owned).unwrap();
    assert_eq!(answer["others"], boxes.len());
    assert_eq!(answer["otherBoxes"].as_array().unwrap().len(), boxes.len());
}

#[test]
fn a_pool_too_small_for_a_sessions_chain_skips_lovejoin() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(2469u64);
    // One box to mix with, and four UTxOs the worker counted as boxes too: a
    // box one wave deep takes two.
    let mut rows = pool(&protocol)[..1].to_vec();
    rows.extend(junk(&protocol));
    let request = |pool: Vec<UtxoResponse>, again: bool, utxos: Vec<UtxoResponse>| ChainRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos,
        collateral: Some(collateral()),
        pool,
        depth: 1,
        boxes: Some(1),
        merge: vec![],
        again,
        own: vec![],
        collateral_pool: None,
        collateral_boxes: vec![],
        collateral_reserve: false,
    };
    let result =
        lovejoin::chain(&accounts(), sk, request(rows.clone(), false, holdings())).unwrap();
    assert!(result.txs.is_empty());
    assert_eq!(result.boxes, 0);
    assert_eq!(
        result.skipped.as_deref(),
        Some("Lovejoin's pool has 1 boxes to mix with, and this needs 2")
    );
    let answer = serde_json::to_value(&result).unwrap();
    assert_eq!(answer["skipped"], json!(result.skipped));

    // Mixing the wallet's boxes again is skipped the same way.
    let at = session();
    let funded = seedelf_core::lovejoin::again_funding(1, 1);
    let mut again = rows.clone();
    again.extend(our_box_rows(sk, 1, &protocol));
    let utxos = vec![row(1, 0, &at, funded, &[]), row(2, 1, &at, 5_000_000, &[])];
    let result = lovejoin::chain(&accounts(), sk, request(again, true, utxos)).unwrap();
    assert!(result.txs.is_empty());
    assert!(result.skipped.is_some());

    // One more box and it's built, and says nothing of a skip.
    rows.extend(pool(&protocol)[1..2].iter().cloned());
    let result =
        lovejoin::chain(&accounts(), sk, request(rows.clone(), false, holdings())).unwrap();
    assert_eq!(result.boxes, 1);
    assert!(result.skipped.is_none());
    assert!(
        serde_json::to_value(&result)
            .unwrap()
            .get("skipped")
            .is_none()
    );

    // The public account's mix is reviewed by hand: too few boxes is an error.
    let public = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let err = lovejoin::chain_from_account(
        &public,
        sk,
        AccountChainRequest {
            network: "preprod".into(),
            params: params(),
            utxos: vec![public_utxo(0x51, Role::Receive, 1, 30_000_000)],
            collateral: Some(public_utxo(0x5c, Role::Receive, 0, 5_000_000)),
            pool: rows[..1].to_vec(),
            depth: 1,
            boxes: 1,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("pool has 1 boxes"), "{err}");
}

/// An ADA pool of `lovelace` boxes as the worker names one: a 5 ₳ pool takes
/// a session's collateral (the owner, 2026-10-22). Lovejoin's own preprod
/// token pool's seed stands in for its launch.
fn ada_pool_ref(lovelace: u64) -> PoolRef {
    const SEED: &str = "5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b";
    const NFT_POLICY: &str = "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69";
    let d = templates::derive(&hex::decode(SEED).unwrap().try_into().unwrap(), 2).unwrap();
    let datum = ReferenceDatum {
        box_value: BoxValue::ada(lovelace),
        max_fee: lovelace * 3 / 4,
        mix_box_hash: d.mix_box.hash,
        mix_logic_hash: d.mix_logic.hash,
        fee_hash: d.fee_contract.hash,
    };
    let holder = holder_address(true).to_bech32().unwrap();
    let at_holder = |mut row: UtxoResponse| {
        row.payment_cred = hex::encode(templates::REFERENCE_HOLDER_HASH);
        row
    };
    let mut reference = at_holder(row(
        0x7f,
        0,
        &holder,
        1_698_140,
        &[(NFT_POLICY, &hex::encode("lovejoin"), 1)],
    ));
    reference.inline_datum =
        serde_json::from_value(json!({ "bytes": hex::encode(datum.encode()), "value": {} }))
            .unwrap();
    let script = |tx: u8, s: &templates::Script| {
        let mut row = at_holder(row(tx, 0, &holder, 20_000_000, &[]));
        row.reference_script = serde_json::from_value(json!({
            "hash": hex::encode(s.hash), "size": s.cbor.len(), "type": "plutusV3",
            "bytes": hex::encode(&s.cbor),
        }))
        .unwrap();
        row
    };
    PoolRef {
        reference,
        seed: OutRef {
            tx_hash: SEED.to_string(),
            tx_index: 2,
        },
        scripts: vec![script(0x7d, &d.mix_box), script(0x17, &d.mix_logic)],
    }
}

/// The 5 ₳ pool [`ada_pool_ref`] names, verified.
fn five() -> Protocol {
    lovejoin::protocol_of(true, Some(&ada_pool_ref(5_000_000))).unwrap()
}

/// `n` strangers' boxes in the 5 ₳ pool, as Koios lists them at its
/// `mix_box`, their transactions' hashes starting `first`.
fn strangers(first: u8, n: u8) -> Vec<UtxoResponse> {
    let pool = five();
    (0..n)
        .map(|i| {
            let owner = Register::create(Scalar::from(9_000u64 + u64::from(i)))
                .unwrap()
                .rerandomize()
                .unwrap();
            let point = |p: &str| -> [u8; 48] { hex::decode(p).unwrap().try_into().unwrap() };
            let mut hash = [first; 32];
            hash[31] = i;
            let b = PoolBox {
                utxo: Resolved {
                    tx_hash: hash,
                    index: 0,
                    output: vec![],
                },
                a: point(&owner.generator),
                b: point(&owner.public_value),
            };
            box_row(&b, &pool)
        })
        .collect()
}

fn spends_ref(tx: &MultiEraTx, at: &OutRef) -> bool {
    tx.inputs()
        .iter()
        .any(|i| hex::encode(**i.hash()) == at.tx_hash && i.index() == at.tx_index)
}

/// A session's collateral's tail, as a chain's or a direct return's
/// transactions have it: the deposit spends the session's 5 ₳ collateral and
/// pays one box of 5 ₳ alone into the 5 ₳ pool, the wallet's own; the mix
/// takes that box, two of `others`, and the deposit's change, under
/// giveme.my's collateral, signed by the session's key alone for now, its
/// leaf the wallet's. Returns the mix, whose change the return takes.
fn the_tail(
    deposit: &lovejoin::ChainTxOut,
    mix: &lovejoin::ChainTxOut,
    tail: &lovejoin::TailOut,
    others: &[UtxoResponse],
    sk: Scalar,
) -> Vec<u8> {
    let pool = five();
    assert_eq!(
        (deposit.kind.as_str(), mix.kind.as_str()),
        ("deposit", "mix")
    );
    assert!(deposit.tail && !deposit.giveme);
    assert!(mix.tail && mix.giveme);
    let deposited = hex::decode(&deposit.tx_cbor).unwrap();
    let d = MultiEraTx::decode(&deposited).unwrap();
    assert!(spends(&d, [2; 32], 1), "the session's collateral");
    assert_eq!(tail.boxed.tx_hash, hex::encode(d.hash()));
    let outputs = eval::resolve_outputs(&deposited).unwrap();
    let boxed = PoolBox::from_resolved(outputs[tail.boxed.tx_index as usize].clone(), &pool)
        .expect("a box of the 5 ₳ pool");
    assert!(boxed.is_owned(&sk));
    let out = &d.outputs()[tail.boxed.tx_index as usize];
    assert_eq!(out.value().coin(), 5_000_000);
    assert!(out.value().assets().is_empty());
    assert_eq!(
        d.outputs()
            .iter()
            .filter(|o| o.address().unwrap().to_vec() == pool.mix_box_address().to_vec())
            .count(),
        1,
        "one box"
    );

    let mixed = hex::decode(&mix.tx_cbor).unwrap();
    let m = MultiEraTx::decode(&mixed).unwrap();
    assert!(spends_ref(&m, &tail.boxed));
    assert!(m.inputs().iter().any(|i| *i.hash() == d.hash()));
    let drawn = others
        .iter()
        .filter(|r| {
            spends_ref(
                &m,
                &OutRef {
                    tx_hash: r.tx_hash.clone(),
                    tx_index: r.tx_index,
                },
            )
        })
        .count();
    assert_eq!(drawn, 2, "two of the others");
    assert_eq!(m.inputs().len(), 4);
    let giveme = seedelf_core::transaction::collateral_input(true);
    assert_eq!(
        m.collateral()
            .iter()
            .map(|i| (**i.hash(), i.index()))
            .collect::<Vec<_>>(),
        vec![(giveme.tx_hash.0, giveme.txo_index)]
    );
    let required = seedelf_core::build::required_signers(&mixed).unwrap();
    assert!(
        required
            .iter()
            .any(|h| **h == seedelf_core::constants::COLLATERAL_HASH)
    );
    assert_eq!(m.fee().unwrap() % 2, 0);
    let key = accounts().key_hash(Role::Receive, 0).unwrap();
    let witnesses = m.vkey_witnesses();
    assert_eq!(witnesses.len(), 1, "giveme.my signs later");
    assert_eq!(
        pallas_crypto::hash::Hasher::<224>::hash(&witnesses[0].vkey),
        key
    );
    let made = eval::resolve_outputs(&mixed).unwrap();
    let leaf = PoolBox::from_resolved(made[tail.leaf.tx_index as usize].clone(), &pool)
        .expect("the leaf, a box of the 5 ₳ pool");
    assert_eq!(tail.leaf.tx_hash, hex::encode(m.hash()));
    assert!(leaf.is_owned(&sk));
    let ours = made
        .iter()
        .filter_map(|r| PoolBox::from_resolved(r.clone(), &pool))
        .filter(|b| b.is_owned(&sk))
        .count();
    assert_eq!(ours, 1);
    assert_eq!(
        tail.fee.parse::<u64>().unwrap(),
        deposit.fee.parse::<u64>().unwrap() + mix.fee.parse::<u64>().unwrap()
    );
    mixed
}

/// The return after a tail: a sweep of the mix's change into Seedelf, never
/// the collateral, never merged. What it pays into Seedelf.
fn swept_after(back: &str, mix: &[u8]) -> u64 {
    let bytes = hex::decode(back).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let mix = MultiEraTx::decode(mix).unwrap();
    assert!(tx.inputs().iter().any(|i| *i.hash() == mix.hash()));
    assert!(!spends(&tx, [2; 32], 1));
    assert!(tx.collateral().is_empty(), "a sweep runs no script");
    tx.outputs()
        .iter()
        .map(|o| {
            let address = Address::from_bytes(&o.address().unwrap().to_vec()).unwrap();
            assert!(address.has_script(), "into the wallet contract");
            o.value().coin()
        })
        .sum()
}

#[test]
fn a_chains_collateral_is_mixed_once_on_its_way_into_the_5_ada_pool() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(5151u64);
    // Strangers' boxes, and one of the wallet's own, which is never drawn.
    let mut others = strangers(0xa1, 3);
    let mut rows = others.clone();
    rows.extend(our_box_rows(sk, 1, &five()));
    others.truncate(3);
    let request = |merge: Vec<UtxoResponse>| ChainRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos: holdings(),
        collateral: Some(collateral()),
        pool: pool(&protocol),
        depth: 1,
        boxes: Some(1),
        merge,
        again: false,
        own: vec![],
        collateral_pool: Some(ada_pool_ref(5_000_000)),
        collateral_boxes: rows.clone(),
        collateral_reserve: false,
    };
    // Even with the funding's change to merge into: the collateral a merge puts up is in the box.
    for merge in [vec![funding_change(sk)], vec![]] {
        let result = lovejoin::chain(&accounts(), sk, request(merge)).unwrap();
        let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
        assert_eq!(kinds, vec!["deposit", "mix", "deposit", "mix", "back"]);
        assert!(result.txs[..2].iter().all(|t| !t.tail && !t.giveme));
        let tail = result
            .collateral_tail
            .clone()
            .expect("the collateral's tail");
        // The tail's deposit is paid from the chain's change.
        let chain_mix_bytes = hex::decode(&result.txs[1].tx_cbor).unwrap();
        let chain_mix = MultiEraTx::decode(&chain_mix_bytes).unwrap();
        let deposit_bytes = hex::decode(&result.txs[2].tx_cbor).unwrap();
        let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
        assert!(
            deposit
                .inputs()
                .iter()
                .any(|i| *i.hash() == chain_mix.hash())
        );
        let mixed = the_tail(&result.txs[2], &result.txs[3], &tail, &others, sk);
        let back = &result.txs[4];
        let seedelf = swept_after(&back.tx_cbor, &mixed);
        assert_eq!(result.merged, 0);
        assert_eq!(seedelf, result.returned.parse::<u64>().unwrap());
        // Every fee counted, the tail's too; the chain's leaves are its own boxes alone.
        let fees: u64 = result
            .txs
            .iter()
            .map(|t| t.fee.parse::<u64>().unwrap())
            .sum();
        assert_eq!(result.fees, fees.to_string());
        assert_eq!(result.leaves.len(), 1);
        assert!(result.leaves.iter().all(|l| *l != tail.leaf));
        // The worker reads the tail's marks and its boxes by these names.
        let answer = serde_json::to_value(&result).unwrap();
        assert_eq!(answer["txs"][3]["giveme"], json!(true));
        assert!(answer["txs"][1].get("tail").is_none());
        assert_eq!(answer["collateralTail"]["box"], json!(tail.boxed));
        assert_eq!(answer["collateralTail"]["leaf"], json!(tail.leaf));
    }
}

#[test]
fn a_direct_return_mixes_the_collateral_once_on_its_way_into_the_5_ada_pool() {
    let sk = Scalar::from(6262u64);
    let at = session();
    let others = strangers(0xa2, 2);
    let utxos = vec![
        row(1, 0, &at, 20_000_000, &[]),
        row(2, 1, &at, 5_000_000, &[]),
    ];
    for merge in [vec![funding_change(sk)], vec![]] {
        let result = api::session_return(
            &accounts(),
            sk,
            api::SessionReturnRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos: utxos.clone(),
                merge,
                own: vec![],
                collateral_pool: Some(ada_pool_ref(5_000_000)),
                collateral_boxes: others.clone(),
            },
        )
        .unwrap();
        let tail = result.tail.as_ref().expect("the collateral's tail");
        let mixed = the_tail(&tail.txs[0], &tail.txs[1], &tail.tail, &others, sk);
        let seedelf = swept_after(&result.tx_cbor, &mixed);
        assert_eq!(result.merged, 0);
        let fee: u64 = result.fee.parse().unwrap();
        let tail_fee: u64 = tail.tail.fee.parse().unwrap();
        // Everything but the box's 5 ₳ and the fees comes back.
        assert_eq!(result.lovelace, (20_000_000 - tail_fee - fee).to_string());
        assert_eq!(seedelf, 20_000_000 - tail_fee - fee);
        assert_eq!(result.inputs, 1, "the mix's change alone");
    }
}

#[test]
fn the_collateral_comes_back_with_the_rest_where_its_mix_cant_be_built() {
    let sk = Scalar::from(7373u64);
    let at = session();
    let ask = |utxos: Vec<UtxoResponse>,
               lovelace: u64,
               boxes: Vec<UtxoResponse>,
               merge: Vec<UtxoResponse>| {
        api::session_return(
            &accounts(),
            sk,
            api::SessionReturnRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos,
                merge,
                own: vec![],
                collateral_pool: Some(ada_pool_ref(lovelace)),
                collateral_boxes: boxes,
            },
        )
        .unwrap()
    };
    let as_before = |r: &api::SessionReturnResult, total: u64| {
        assert!(r.tail.is_none());
        let fee: u64 = r.fee.parse().unwrap();
        assert_eq!(r.lovelace, (total - fee).to_string());
    };
    let both = || {
        vec![
            row(1, 0, &at, 20_000_000, &[]),
            row(2, 1, &at, 5_000_000, &[]),
        ]
    };
    // The collateral alone: nothing else pays for its mix.
    as_before(
        &ask(
            vec![row(2, 1, &at, 5_000_000, &[])],
            5_000_000,
            strangers(0xa3, 2),
            vec![],
        ),
        5_000_000,
    );
    // A pool of other boxes isn't the collateral's.
    as_before(
        &ask(both(), 25_000_000, strangers(0xa3, 2), vec![]),
        25_000_000,
    );
    // An account whose collateral is spent puts none of its other ADA in a box.
    as_before(
        &ask(
            vec![row(1, 0, &at, 20_000_000, &[])],
            5_000_000,
            strangers(0xa3, 2),
            vec![],
        ),
        20_000_000,
    );
    // One stranger's box and the wallet's own: too few to draw two.
    let mut few = strangers(0xa3, 1);
    few.extend(our_box_rows(sk, 1, &five()));
    as_before(&ask(both(), 5_000_000, few, vec![]), 25_000_000);
    // Merged as before, the collateral put up and spent with the rest.
    let merged = ask(both(), 5_000_000, vec![], vec![funding_change(sk)]);
    as_before(&merged, 25_000_000);
    assert_eq!(merged.merged, 1);
    assert!(spends(
        &MultiEraTx::decode(&hex::decode(&merged.tx_cbor).unwrap()).unwrap(),
        [2; 32],
        1
    ));

    // A chain whose change can't pay for the tail: its return as before.
    let protocol = Protocol::of(true).unwrap();
    let funded = seedelf_core::lovejoin::funding_for(1, 1, 10_000_000);
    let result = lovejoin::chain(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos: vec![row(1, 0, &at, funded, &[]), row(2, 1, &at, 5_000_000, &[])],
            collateral: Some(collateral()),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![],
            again: false,
            own: vec![],
            collateral_pool: Some(ada_pool_ref(5_000_000)),
            collateral_boxes: strangers(0xa3, 2),
            collateral_reserve: false,
        },
    )
    .unwrap();
    assert!(result.collateral_tail.is_none());
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, vec!["deposit", "mix", "back"]);
    let back_bytes = hex::decode(&result.txs[2].tx_cbor).unwrap();
    let back = MultiEraTx::decode(&back_bytes).unwrap();
    assert!(
        spends(&back, [2; 32], 1),
        "the collateral comes back with the rest"
    );
}

#[test]
fn the_collateral_never_draws_a_box_its_chain_drew() {
    let sk = Scalar::from(4343u64);
    // A chain into the 5 ₳ pool itself, which its collateral's mix draws from too.
    let request = |others: Vec<UtxoResponse>| ChainRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos: holdings(),
        collateral: Some(collateral()),
        pool: others.clone(),
        depth: 1,
        boxes: Some(1),
        merge: vec![],
        again: false,
        own: vec![],
        collateral_pool: Some(ada_pool_ref(5_000_000)),
        collateral_boxes: others,
        collateral_reserve: false,
    };
    let chain = |others| {
        lovejoin::chain_in(
            &accounts(),
            sk,
            request(others),
            Some(&ada_pool_ref(5_000_000)),
        )
        .unwrap()
    };
    // Three: the chain's mix takes two, which leaves one, too few for the collateral's.
    let three = chain(strangers(0xa6, 3));
    assert_eq!(three.boxes, 1);
    assert!(three.collateral_tail.is_none());
    // Four: it takes the other two.
    let others = strangers(0xa6, 4);
    let four = chain(others.clone());
    let tail = four.collateral_tail.clone().expect("the collateral's tail");
    let mixed = the_tail(&four.txs[2], &four.txs[3], &tail, &others, sk);
    let drew = |bytes: &[u8]| -> Vec<String> {
        let tx = MultiEraTx::decode(bytes).unwrap();
        others
            .iter()
            .filter(|r| {
                spends_ref(
                    &tx,
                    &OutRef {
                        tx_hash: r.tx_hash.clone(),
                        tx_index: r.tx_index,
                    },
                )
            })
            .map(|r| r.tx_hash.clone())
            .collect()
    };
    let chains = drew(&hex::decode(&four.txs[1].tx_cbor).unwrap());
    let tails = drew(&mixed);
    assert_eq!((chains.len(), tails.len()), (2, 2));
    assert!(tails.iter().all(|t| !chains.contains(t)));
}

#[test]
fn a_session_funded_for_its_collateral_counts_its_boxes_after_the_reserve() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(8484u64);
    let at = session();
    let reserve = seedelf_core::lovejoin::COLLATERAL_TAIL_RESERVE;
    let funded = seedelf_core::lovejoin::funding_for(1, 1, 10_000_000) + reserve;
    let request = |reserved: bool| ChainRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos: vec![row(1, 0, &at, funded, &[]), row(2, 1, &at, 5_000_000, &[])],
        collateral: Some(collateral()),
        pool: pool(&protocol),
        depth: 1,
        boxes: None,
        merge: vec![],
        again: false,
        own: vec![],
        collateral_pool: Some(ada_pool_ref(5_000_000)),
        collateral_boxes: strangers(0xa4, 2),
        collateral_reserve: reserved,
    };
    // One box, and the reserve pays for the collateral's mix and the sweep after it.
    let result = lovejoin::chain(&accounts(), sk, request(true)).unwrap();
    assert_eq!(result.boxes, 1);
    assert!(result.collateral_tail.is_some());
    // The plan counts the same way.
    let plan = |reserved: bool, lovelace: u64| {
        lovejoin::plan(
            &accounts(),
            PlanRequest {
                network: "preprod".into(),
                index: 0,
                utxos: vec![
                    row(1, 0, &at, lovelace, &[]),
                    row(2, 1, &at, 5_000_000, &[]),
                ],
                collateral: Some(collateral()),
                depth: 1,
                again: false,
                collateral_reserve: reserved,
            },
        )
        .unwrap()
        .boxes
    };
    let two = seedelf_core::lovejoin::funding_for(2, 1, 10_000_000);
    assert_eq!(plan(false, two), 2);
    assert_eq!(plan(true, two), 1, "the reserve comes out first");
    assert_eq!(plan(true, two + reserve), 2);
}

#[test]
fn the_collateral_mix_is_built_again_from_what_the_chain_left() {
    let sk = Scalar::from(9595u64);
    let at = session();
    let pool = five();
    // The tail's deposit is on chain: the box at the pool, its change at the account.
    let boxed = our_box_rows(sk, 1, &pool).remove(0);
    let others = strangers(0xa5, 3);
    let mut rows = others.clone();
    rows.push(boxed.clone());
    let utxos = vec![
        row(0x31, 1, &at, 3_000_000, &[]),
        row(3, 0, &at, 2_000_000, &[(MIN_POLICY, "4d494e", 500)]),
    ];
    let request = |boxed: &UtxoResponse| lovejoin::CollateralMixRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos: utxos.clone(),
        boxed: OutRef {
            tx_hash: boxed.tx_hash.clone(),
            tx_index: boxed.tx_index,
        },
        pool_ref: ada_pool_ref(5_000_000),
        pool: rows.clone(),
        own: vec![],
    };
    let result = lovejoin::collateral_mix(&accounts(), sk, request(&boxed)).unwrap();
    let kinds: Vec<&str> = result.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, vec!["mix", "back"]);
    assert!(result.txs[0].giveme && result.txs[0].tail);
    let tail = result.collateral_tail.clone().unwrap();
    let mixed = hex::decode(&result.txs[0].tx_cbor).unwrap();
    let m = MultiEraTx::decode(&mixed).unwrap();
    assert!(spends_ref(&m, &tail.boxed));
    assert!(spends(&m, [0x31; 32], 1), "the deposit's change pays");
    assert_eq!(m.inputs().len(), 4);
    let made = eval::resolve_outputs(&mixed).unwrap();
    assert!(
        PoolBox::from_resolved(made[tail.leaf.tx_index as usize].clone(), &pool)
            .unwrap()
            .is_owned(&sk)
    );
    let seedelf = swept_after(&result.txs[1].tx_cbor, &mixed);
    assert_eq!(seedelf, result.returned.parse::<u64>().unwrap());
    let back_bytes = hex::decode(&result.txs[1].tx_cbor).unwrap();
    let back = MultiEraTx::decode(&back_bytes).unwrap();
    assert!(spends(&back, [3; 32], 0), "the rest comes back with it");

    // giveme.my's signature goes on beside the session's.
    let giveme = SecretKey::new(OsRng);
    let hash = seedelf_core::build::tx_id(&mixed).unwrap();
    let answer = json!({ "witness": format!("8258{}", hex::encode([0u8; 32])) + &hex::encode(giveme.sign(hash).as_ref()) });
    let finished = lovejoin::finish_with_collateral_key(
        FinishRequest {
            tx_cbor: result.txs[0].tx_cbor.clone(),
            collateral: answer,
        },
        giveme.public_key(),
    )
    .unwrap();
    assert_eq!(finished.tx_hash, result.txs[0].tx_hash);
    let signed_bytes = hex::decode(&finished.tx_cbor).unwrap();
    let signed = MultiEraTx::decode(&signed_bytes).unwrap();
    assert_eq!(signed.vkey_witnesses().len(), 2);

    // A stranger's box isn't the collateral's.
    let err = lovejoin::collateral_mix(&accounts(), sk, request(&others[0])).unwrap_err();
    assert!(err.to_string().contains("isn't this wallet's"), "{err}");
}
