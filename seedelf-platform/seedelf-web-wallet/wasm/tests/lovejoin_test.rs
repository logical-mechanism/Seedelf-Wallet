//! Lovejoin through the web wallet's WebAssembly layer (`seedelf_wasm::lovejoin`):
//! a session's chain, signed by its key and measured against the deployed
//! preprod scripts, and the later withdraw of its boxes.

use blstrs::Scalar;
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::eval::{self, Resolved};
use seedelf_core::lovejoin::{PoolBox, Protocol, mix_datum};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self, AccountChainRequest, ChainRequest, FinishRequest, FundingRequest, OutRef, OwnedRequest,
    PlanRequest, WithdrawRequest,
};
use serde_json::{Value, json};

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
                collateral: collateral(),
                depth,
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
            collateral: collateral(),
            pool: pool(&protocol),
            depth: 1,
            boxes: None,
            merge: vec![],
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
            collateral: collateral(),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![funding_change(sk)],
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
            collateral: collateral(),
            pool: pool(&protocol),
            depth: 1,
            boxes: Some(1),
            merge: vec![],
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
            collateral: collateral(),
            pool: pool(&protocol),
            depth: 2,
            boxes: None,
            merge: vec![],
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
    })
    .unwrap();
    assert_eq!((funded.lovelace.as_str(), funded.mixes), ("29100000", 8));
    assert!(
        lovejoin::funding(FundingRequest {
            network: "preprod".into(),
            boxes: 0,
            depth: 2
        })
        .is_err()
    );
    assert!(
        lovejoin::funding(FundingRequest {
            network: "mainnet".into(),
            boxes: 1,
            depth: 2
        })
        .is_err()
    );
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
                ],
                collateral,
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
            collateral: public_utxo(0x5c, Role::Receive, 0, 5_000_000),
            pool: pool(&protocol),
            depth: 1,
            boxes: 2,
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("doesn't pay for 2 boxes"), "{err}");
}
