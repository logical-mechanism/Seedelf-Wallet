//! A session's return takes what's at its account by cost (independent
//! review H1, H2): its own and ADA-only UTxOs first; a stranger's token UTxO
//! only when its own ADA pays for the deposit outputs its tokens add; and
//! never more than one transaction holds. Anyone can pay the session's
//! address, so a stranger's tokens never make the return unbuildable, nor
//! take the user's ADA as their deposit. The Lovejoin chain's return shares
//! the plan.

use blstrs::Scalar;
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::MAX_TX_SIZE;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::eval::Resolved;
use seedelf_core::lovejoin::{PoolBox, Protocol, mix_datum};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api::{self, SessionReturnRequest};
use seedelf_wasm::lovejoin::{self, ChainRequest, OutRef};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const MIN_POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";
const MIN: &str = "4d494e";

fn accounts() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap()
}

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/eval-preprod.json"
    ))
    .unwrap()
}

/// Preprod's parameters at epoch 315, with its V3 cost model.
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

/// A UTxO at `address` as Koios lists it: `tokens` as (policy, name, quantity).
fn row(
    tx: u8,
    index: u64,
    address: &str,
    lovelace: u64,
    tokens: &[(String, String, u64)],
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

fn ada(tx: u8, index: u64, lovelace: u64) -> UtxoResponse {
    row(tx, index, &session(), lovelace, &[])
}

/// `n` distinct tokens with 2-byte names under a policy of `p` repeated: the
/// most a stranger packs into one UTxO for its minimum.
fn junk(p: u8, n: u16) -> Vec<(String, String, u64)> {
    (0..n)
        .map(|i| (hex::encode([p; 28]), format!("{i:04x}"), 1))
        .collect()
}

fn request(utxos: Vec<UtxoResponse>, merge: Vec<UtxoResponse>, own: &[u8]) -> SessionReturnRequest {
    SessionReturnRequest {
        network: "preprod".into(),
        params: params(),
        index: 0,
        utxos,
        merge,
        own: own.iter().map(|t| hex::encode([*t; 32])).collect(),
    }
}

/// The Seedelf UTxO a session's funding left in the private balance: a register of `sk`'s.
fn funding_change(sk: Scalar) -> UtxoResponse {
    let wallet = wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let mut change = row(0x11, 0, &wallet.to_bech32().unwrap(), 40_000_000, &[]);
    change.inline_datum = serde_json::from_value(json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
    .unwrap();
    change
}

fn left(result: &api::SessionReturnResult) -> Vec<(u8, String)> {
    result
        .left_out
        .iter()
        .map(|l| (hex::decode(&l.tx_hash).unwrap()[0], l.reason.clone()))
        .collect()
}

fn spent(tx_cbor: &str) -> Vec<u8> {
    let bytes = hex::decode(tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let mut firsts: Vec<u8> = tx.inputs().iter().map(|i| i.hash()[0]).collect();
    firsts.sort();
    firsts
}

fn size(tx_cbor: &str) -> u64 {
    hex::decode(tx_cbor).unwrap().len() as u64
}

#[test]
fn a_strangers_400_tokens_on_12_ada_stay_and_the_sessions_own_comes_back() {
    // The swap's fill (a batcher's transaction), the swap's change and the
    // collateral (the session's own), and a stranger's 400 tokens on 12 ₳:
    // their deposit would take about 38 ₳ (independent review H1).
    let at = session();
    let min = vec![(MIN_POLICY.to_string(), MIN.to_string(), 906_594_100)];
    let utxos = vec![
        row(0xaa, 0, &at, 2_000_000, &min),
        ada(0x21, 1, 1_500_000),
        ada(0x20, 1, 5_000_000),
        row(0xbb, 0, &at, 12_000_000, &junk(0xab, 400)),
    ];
    let sk = random_scalar();
    for merge in [vec![], vec![funding_change(sk)]] {
        let merged = !merge.is_empty();
        let result = api::session_return(
            &accounts(),
            sk,
            request(utxos.clone(), merge, &[0x20, 0x21]),
        )
        .unwrap();
        assert_eq!(left(&result), vec![(0xbb, "cost".to_string())]);
        assert_eq!(result.inputs, 3);
        assert_eq!(result.merged, usize::from(merged));
        let fee: u64 = result.fee.parse().unwrap();
        assert_eq!(result.lovelace, (8_500_000 - fee).to_string());
        assert_eq!(result.tokens.len(), 1);
        assert_eq!(result.tokens[0].quantity, "906594100");
        let inputs = spent(&result.tx_cbor);
        assert!(!inputs.contains(&0xbb));
        assert!(inputs.contains(&0xaa) && inputs.contains(&0x20) && inputs.contains(&0x21));
    }
}

#[test]
fn junk_packed_to_its_minimum_never_blocks_a_return_nor_takes_the_users_ada() {
    // Independent review H2: 1,200 tokens a UTxO on about 23 ₳ would be 60
    // deposit outputs needing ~116 ₳ each; 600 on 13 ₳, 30 needing ~57 ₳.
    let at = session();
    let sk = random_scalar();
    let cases: Vec<(u64, Vec<UtxoResponse>)> = vec![
        (
            100_000_000,
            vec![row(0xb1, 0, &at, 23_000_000, &junk(0xb1, 1_200))],
        ),
        (
            100_000_000,
            vec![
                row(0xb1, 0, &at, 23_000_000, &junk(0xb1, 1_200)),
                row(0xb2, 0, &at, 23_000_000, &junk(0xb2, 1_200)),
            ],
        ),
        (
            1_000_000_000,
            vec![
                row(0xb1, 0, &at, 23_000_000, &junk(0xb1, 1_200)),
                row(0xb2, 0, &at, 23_000_000, &junk(0xb2, 1_200)),
            ],
        ),
        (
            1_000_000_000,
            vec![
                row(0xb1, 0, &at, 13_000_000, &junk(0xb1, 600)),
                row(0xb2, 0, &at, 13_000_000, &junk(0xb2, 600)),
                row(0xb3, 0, &at, 13_000_000, &junk(0xb3, 600)),
            ],
        ),
    ];
    for (held, strangers) in cases {
        let mut utxos = vec![ada(0x20, 0, held), ada(0x20, 1, 5_000_000)];
        utxos.extend(strangers.iter().cloned());
        let result = api::session_return(&accounts(), sk, request(utxos, vec![], &[0x20])).unwrap();
        let firsts: Vec<(u8, String)> = strangers
            .iter()
            .map(|s| (hex::decode(&s.tx_hash).unwrap()[0], "cost".to_string()))
            .collect();
        assert_eq!(left(&result), firsts);
        // All of the user's ADA comes back, less the fee, in one deposit output: no junk.
        let fee: u64 = result.fee.parse().unwrap();
        assert_eq!(result.lovelace, (held + 5_000_000 - fee).to_string());
        assert!(result.tokens.is_empty());
        assert_eq!(result.deposit_outputs, 1);
        assert!(size(&result.tx_cbor) <= MAX_TX_SIZE);
    }
}

#[test]
fn a_stranger_whose_own_ada_pays_for_its_tokens_comes_back_with_them() {
    let at = session();
    let sk = random_scalar();
    // 400 tokens take 20 deposit outputs, about 38.9 ₳ between them.
    for (lovelace, taken) in [(30_000_000, false), (45_000_000, true)] {
        let utxos = vec![
            ada(0x20, 0, 10_000_000),
            row(0xbb, 0, &at, lovelace, &junk(0xab, 400)),
        ];
        let result = api::session_return(&accounts(), sk, request(utxos, vec![], &[0x20])).unwrap();
        if taken {
            assert!(result.left_out.is_empty());
            assert_eq!(result.deposit_outputs, 20);
            assert_eq!(result.tokens.len(), 400);
            let fee: u64 = result.fee.parse().unwrap();
            assert_eq!(result.lovelace, (10_000_000 + lovelace - fee).to_string());
        } else {
            assert_eq!(left(&result), vec![(0xbb, "cost".to_string())]);
            assert_eq!(result.deposit_outputs, 1);
        }
    }
    // Alone at the account, a stranger's UTxO pays for the whole return, or stays.
    let alone = |lovelace| row(0xbb, 0, &at, lovelace, &junk(0xab, 1));
    let result = api::session_return(
        &accounts(),
        sk,
        request(vec![alone(3_000_000)], vec![], &[]),
    )
    .unwrap();
    assert_eq!(result.inputs, 1);
    let err = api::session_return(
        &accounts(),
        sk,
        request(vec![alone(1_200_000)], vec![], &[]),
    )
    .unwrap_err();
    assert_eq!(err.to_string(), api::NOTHING_PAYS);
}

#[test]
fn one_return_holds_what_one_transaction_can_and_the_rest_waits_for_the_next() {
    let at = session();
    let sk = random_scalar();
    // Three strangers that pay their own way, 400 tokens each: two fit one return.
    let mut utxos = vec![ada(0x20, 0, 50_000_000)];
    for p in [0xb1, 0xb2, 0xb3] {
        utxos.push(row(p, 0, &at, 60_000_000, &junk(p, 400)));
    }
    for merge in [vec![], vec![funding_change(sk)]] {
        let result =
            api::session_return(&accounts(), sk, request(utxos.clone(), merge, &[0x20])).unwrap();
        assert_eq!(left(&result), vec![(0xb3, "size".to_string())]);
        assert!(size(&result.tx_cbor) <= MAX_TX_SIZE);
        // The next return takes it.
        let rest: Vec<UtxoResponse> = utxos
            .iter()
            .filter(|u| u.tx_hash == hex::encode([0xb3u8; 32]))
            .cloned()
            .collect();
        let next = api::session_return(&accounts(), sk, request(rest, vec![], &[0x20])).unwrap();
        assert!(next.left_out.is_empty());
    }

    // A stranger's dust: 500 UTxOs of 1 ₳. The session's own first, then as many as one transaction holds.
    let mut utxos = vec![ada(0x20, 0, 20_000_000), ada(0x20, 1, 5_000_000)];
    for i in 0..500u64 {
        utxos.push(row(0xd0 + (i % 32) as u8, i, &at, 1_000_000, &[]));
    }
    let result = api::session_return(&accounts(), sk, request(utxos, vec![], &[0x20])).unwrap();
    assert!(
        size(&result.tx_cbor) <= MAX_TX_SIZE,
        "{}",
        size(&result.tx_cbor)
    );
    assert!(result.inputs > 300, "{}", result.inputs);
    assert_eq!(result.inputs + result.left_out.len(), 502);
    assert!(
        result
            .left_out
            .iter()
            .all(|l| l.reason == "size" && !l.tx_hash.starts_with("20"))
    );
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

#[test]
fn a_chains_return_leaves_a_strangers_junk_behind_and_the_chain_still_goes() {
    let protocol = Protocol::of(true).unwrap();
    let sk = Scalar::from(4322u64);
    let at = session();
    let utxos = vec![
        ada(0x20, 0, 30_000_000),
        ada(0x20, 1, 5_000_000),
        row(
            0xaa,
            0,
            &at,
            2_000_000,
            &[(MIN_POLICY.to_string(), MIN.to_string(), 500)],
        ),
        row(0xbb, 0, &at, 12_000_000, &junk(0xab, 400)),
    ];
    for merge in [vec![], vec![funding_change(sk)]] {
        let result = lovejoin::chain(
            &accounts(),
            sk,
            ChainRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos: utxos.clone(),
                collateral: OutRef {
                    tx_hash: hex::encode([0x20u8; 32]),
                    tx_index: 1,
                },
                pool: pool(&protocol),
                depth: 1,
                boxes: Some(1),
                merge,
                again: false,
                own: vec![hex::encode([0x20u8; 32])],
            },
        )
        .unwrap();
        assert!(result.skipped.is_none());
        let back = result.txs.last().unwrap();
        assert_eq!(back.kind, "back");
        let inputs = spent(&back.tx_cbor);
        assert!(inputs.contains(&0xaa) && inputs.contains(&0x20));
        assert!(!inputs.contains(&0xbb));
        assert_eq!(result.left_out.len(), 1);
        assert_eq!(
            (
                result.left_out[0].tx_hash.clone(),
                result.left_out[0].reason.as_str()
            ),
            (hex::encode([0xbbu8; 32]), "cost")
        );
        assert_eq!(result.tokens.len(), 1);
    }
}
