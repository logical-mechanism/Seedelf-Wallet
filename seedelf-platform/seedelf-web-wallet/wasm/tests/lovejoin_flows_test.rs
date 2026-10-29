//! Chunk 34's 34d through the WebAssembly layer: the tile's flows into a
//! token pool (a mix session's chain, the public account's), a launch from
//! either side, a box brought back with the public account paying or the
//! private balance (34g's call 36), and what a launch's box may hold. Lovejoin's own preprod token pool stands in for
//! any token pool, named by a `PoolRef` as the worker names one.

use blstrs::Scalar;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::{PublicKey, SecretKey, Signature};
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build::Budgets;
use seedelf_core::constants::{COLLATERAL_HASH, VARIANT, get_config};
use seedelf_core::eval;
use seedelf_core::lovejoin::{
    self, BoxToken, BoxValue, PoolBox, ReferenceDatum, mix_datum, templates,
};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self as wasm, AccountChainRequest, BootstrapMostRequest, BoxValueRequest, ChainRequest,
    FundingRequest, OutRef, PlanRequest, PoolRef, WithdrawPaidRequest, WithdrawPrivateRequest,
    WithdrawRequest,
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

/// The way back's reserve a private Bootstrap's session is funded with, priced
/// from the parameters as the worker's `lovejoinBootstrapReserve` is (1.7.0's
/// release review, x-mut-rs#4).
fn back_reserve() -> u64 {
    lovejoin::bootstrap_back_reserve(&ProtocolParameters::from_koios(&params()).unwrap()).unwrap()
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
    pool_ref_worth(2_000_000)
}

/// [`pool_ref`] with boxes of `lovelace` beside the token.
fn pool_ref_worth(lovelace: u64) -> PoolRef {
    let d = derived();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace,
            token: Some(BoxToken {
                policy: hex::decode(LJTEST).unwrap().try_into().unwrap(),
                name: b"LJTEST".to_vec(),
                quantity: Q,
            }),
        },
        // 1.5 ₳ for the 2 ₳ pool, as Lovejoin's; below the box value, as a pool's datum must be.
        max_fee: lovelace * 3 / 4,
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

/// A box of the pool's at `mix_box`, owned by `sk` when given.
fn box_row(first: &str, sk: Option<Scalar>) -> UtxoResponse {
    box_row_worth(first, sk, 2_000_000)
}

/// [`box_row`] holding `lovelace` beside the token.
fn box_row_worth(first: &str, sk: Option<Scalar>, lovelace: u64) -> UtxoResponse {
    let d = derived();
    let owner = sk.unwrap_or(Scalar::from(
        99u64 + first.as_bytes()[0] as u64 * 7 + first.as_bytes()[1] as u64,
    ));
    let register = Register::create(owner).unwrap().rerandomize().unwrap();
    let point = |p: &str| -> [u8; 48] { hex::decode(p).unwrap().try_into().unwrap() };
    let datum = mix_datum(&point(&register.generator), &point(&register.public_value));
    let mix_box = wasm::protocol_of(true, Some(&pool_ref()))
        .unwrap()
        .mix_box_address();
    row(json!({
        "tx_hash": first.repeat(32), "address": mix_box.to_bech32().unwrap(), "value": lovelace.to_string(),
        "payment_cred": hex::encode(d.mix_box.hash),
        "inline_datum": { "bytes": hex::encode(datum), "value": {} },
        "asset_list": [ljtest(Q)],
    }))
}

fn others(n: usize) -> Vec<UtxoResponse> {
    (0..n)
        .map(|i| box_row(&format!("{:02x}", 0xb0 + i), None))
        .collect()
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

fn holds_ljtest(output: &pallas_traverse::MultiEraOutput) -> Option<u64> {
    output
        .value()
        .assets()
        .iter()
        .find(|p| hex::encode(p.policy()) == LJTEST)
        .and_then(|p| p.assets().first().and_then(|a| a.output_coin()))
}

#[test]
fn a_mix_session_is_funded_with_the_boxes_ada_and_their_token() {
    let funded = wasm::funding_in(
        FundingRequest {
            network: "preprod".into(),
            boxes: 2,
            depth: 1,
            again: false,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    // Two boxes of 2 ₳, their two mixes, and the deposit's reserve.
    assert_eq!(
        funded.lovelace,
        (1_500_000 + 2 * (2_000_000 + 950_000)).to_string()
    );
    let token = funded.token.unwrap();
    assert_eq!(token.policy_id, LJTEST);
    assert_eq!(token.quantity, (2 * Q).to_string());
    // Mixing again deposits nothing, so it takes no token; the classic pool none either.
    let again = wasm::funding_in(
        FundingRequest {
            network: "preprod".into(),
            boxes: 2,
            depth: 1,
            again: true,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    assert!(again.token.is_none());
    let classic = wasm::funding(FundingRequest {
        network: "preprod".into(),
        boxes: 2,
        depth: 1,
        again: false,
    })
    .unwrap();
    assert!(
        serde_json::to_value(&classic)
            .unwrap()
            .get("token")
            .is_none()
    );
}

#[test]
fn a_mix_session_deposits_its_token_and_brings_back_what_the_boxes_dont_take() {
    let sk = Scalar::from(7_070_707u64);
    let funding = hex::encode([0x10; 32]);
    // Its funding: the boxes' ADA and one and a half boxes' worth of LJTEST.
    // A stranger's UTxO holding LJTEST too, which no deposit takes.
    let utxos = vec![
        at_session(0x10, 0, 6_000_000, vec![ljtest(Q + Q / 2)]),
        at_session(0x11, 0, 5_000_000, vec![]),
        at_session(0x12, 0, 3_000_000, vec![ljtest(Q)]),
    ];
    let plan = wasm::plan_in(
        &accounts(),
        PlanRequest {
            network: "preprod".into(),
            index: 0,
            utxos: utxos.clone(),
            collateral: Some(OutRef {
                tx_hash: hex::encode([0x11; 32]),
                tx_index: 0,
            }),
            depth: 1,
            again: false,
            collateral_reserve: false,
        },
        Some(&pool_ref()),
        std::slice::from_ref(&funding),
    )
    .unwrap();
    // Its own UTxO holds the token for one box, though its ADA pays for two.
    assert_eq!(plan.boxes, 1);

    let chain = wasm::chain_in(
        &accounts(),
        sk,
        ChainRequest {
            network: "preprod".into(),
            params: params(),
            index: 0,
            utxos,
            collateral: Some(OutRef {
                tx_hash: hex::encode([0x11; 32]),
                tx_index: 0,
            }),
            pool: others(4),
            depth: 1,
            boxes: None,
            merge: Vec::new(),
            again: false,
            own: vec![funding.clone()],
            collateral_pool: None,
            collateral_boxes: vec![],
            collateral_reserve: false,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    assert!(chain.skipped.is_none());
    let kinds: Vec<&str> = chain.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, ["deposit", "mix", "back"]);
    assert_eq!(chain.boxes, 1);
    assert_eq!(chain.leaves.len(), 1);

    let deposit_bytes = hex::decode(&chain.txs[0].tx_cbor).unwrap();
    let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
    let spent: Vec<String> = deposit
        .inputs()
        .iter()
        .map(|i| hex::encode(i.hash()))
        .collect();
    assert!(spent.contains(&funding));
    // Never the stranger's.
    assert!(!spent.contains(&hex::encode([0x12; 32])));
    let outputs = deposit.outputs();
    assert_eq!(outputs[0].value().coin(), 2_000_000);
    assert_eq!(holds_ljtest(&outputs[0]), Some(Q));
    // The half box's worth the box didn't take, apart from the ADA change.
    assert_eq!(holds_ljtest(&outputs[1]), Some(Q / 2));

    // The return brings that half back, and the stranger's too, which pays its own way.
    let back_bytes = hex::decode(&chain.txs[2].tx_cbor).unwrap();
    let back = MultiEraTx::decode(&back_bytes).unwrap();
    let back_spent: Vec<(String, u64)> = back
        .inputs()
        .iter()
        .map(|i| (hex::encode(i.hash()), i.index()))
        .collect();
    assert!(back_spent.contains(&(chain.txs[0].tx_hash.clone(), 1)));
    let returned: u64 = chain
        .tokens
        .iter()
        .filter(|t| t.policy_id == LJTEST)
        .map(|t| t.quantity.parse::<u64>().unwrap())
        .sum();
    assert_eq!(returned, Q / 2 + Q);
}

/// A Bootstrap of the token pool from the private balance (1.6.0's release
/// review, 318-rust#0): its session funded exactly as the worker funds it, one
/// UTxO of its boxes' ADA, the deposit's reserve and its way back's, and their
/// LJTEST, with no collateral. Its chain is the deposit and a sweep back into
/// the wallet contract, at one box and at the most the private balance may put
/// in, where a token box's longer output makes the deposit dearer.
#[test]
fn a_private_bootstrap_of_a_token_pool_deposits_and_sweeps_back() {
    let sk = Scalar::from(7_171_717u64);
    let funding = hex::encode([0x10; 32]);
    let most = wasm::bootstrap_most_in(
        BootstrapMostRequest {
            network: "preprod".into(),
            params: params(),
            most: 64,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    let config = get_config(VARIANT, true).unwrap();
    let contract = wallet_contract(true, config.contract.wallet_contract_hash);
    for boxes in [1, most] {
        let funded = wasm::funding_in(
            FundingRequest {
                network: "preprod".into(),
                boxes,
                depth: 0,
                again: false,
            },
            Some(&pool_ref()),
        )
        .unwrap();
        let lovelace = funded.lovelace.parse::<u64>().unwrap() + back_reserve();
        let quantity: u64 = funded.token.unwrap().quantity.parse().unwrap();
        assert_eq!(quantity, boxes as u64 * Q);
        let chain = wasm::chain_in(
            &accounts(),
            sk,
            ChainRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos: vec![at_session(0x10, 0, lovelace, vec![ljtest(quantity)])],
                collateral: None,
                // A Bootstrap draws nothing: an empty pool takes it.
                pool: Vec::new(),
                depth: 0,
                boxes: Some(boxes),
                merge: Vec::new(),
                again: false,
                own: vec![funding.clone()],
                collateral_pool: None,
                collateral_boxes: vec![],
                collateral_reserve: false,
            },
            Some(&pool_ref()),
        )
        .unwrap_or_else(|e| panic!("{boxes} boxes, funded {lovelace}: {e}"));
        assert!(chain.skipped.is_none());
        let kinds: Vec<&str> = chain.txs.iter().map(|t| t.kind.as_str()).collect();
        assert_eq!(kinds, ["deposit", "back"]);
        assert_eq!(chain.boxes, boxes);
        let deposit_bytes = hex::decode(&chain.txs[0].tx_cbor).unwrap();
        let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
        let boxed = deposit
            .outputs()
            .iter()
            .filter(|o| o.value().coin() == 2_000_000 && holds_ljtest(o) == Some(Q))
            .count();
        assert_eq!(boxed, boxes);
        // The return sweeps the deposit's change alone, every LJTEST in the boxes: ADA into the wallet contract.
        let back_bytes = hex::decode(&chain.txs[1].tx_cbor).unwrap();
        let back = MultiEraTx::decode(&back_bytes).unwrap();
        assert_eq!(back.inputs().len(), 1);
        assert_eq!(*back.inputs()[0].hash(), deposit.hash());
        assert!(back.collateral().is_empty() && back.redeemers().is_empty());
        for output in back.outputs() {
            let address =
                pallas_addresses::Address::from_bytes(&output.address().unwrap().to_vec()).unwrap();
            assert_eq!(address, contract, "into the wallet contract");
            assert_eq!(holds_ljtest(&output), None);
        }
        assert!(chain.tokens.is_empty());
        let returned: u64 = chain.returned.parse().unwrap();
        let fees: u64 = chain.fees.parse().unwrap();
        assert_eq!(returned + fees + boxes as u64 * 2_000_000, lovelace);
        println!("{boxes} token boxes, funded {lovelace}: fees {fees}, {returned} back");
    }
}

/// A UTxO of the public account (account 0) at `role/index`'s base address.
fn public(tx: u8, role: Role, index: u32, lovelace: u64, assets: Vec<Value>) -> api::PathedUtxo {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let at = account
        .base_address(true, role, index)
        .unwrap()
        .to_bech32()
        .unwrap();
    api::PathedUtxo {
        utxo: row(json!({
            "tx_hash": hex::encode([tx; 32]), "address": at, "value": lovelace.to_string(),
            "payment_cred": hex::encode(account.key_hash(role, index).unwrap()),
            "asset_list": assets,
        })),
        role: role as u32,
        index,
    }
}

fn witnesses(tx_cbor: &str) -> usize {
    let bytes = hex::decode(tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    tx.vkey_witnesses().len()
}

/// What a transaction reads, its reference inputs, each as `<transaction>#<index>`.
fn reads(tx_cbor: &str) -> Vec<String> {
    let bytes = hex::decode(tx_cbor).unwrap();
    MultiEraTx::decode(&bytes)
        .unwrap()
        .reference_inputs()
        .iter()
        .map(|i| format!("{}#{}", hex::encode(i.hash()), i.index()))
        .collect()
}

/// Every deposit into a token pool reads the pool's reference UTxO (1.6.0's
/// release review, 317-wallet#0): a mix session's, a private Bootstrap's and
/// the public account's. A pool is verified offline, so one a list names may
/// not be on chain, and boxes paid into it were locked for good; the ledger
/// refuses such a deposit now. The classic pool's deposits read nothing, as
/// 1.5.0's did.
#[test]
fn every_deposit_into_a_token_pool_reads_its_reference_utxo() {
    let reference = vec![format!("{}#0", "7f".repeat(32))];
    let sk = Scalar::from(8_080_808u64);
    let in_session = |utxos: Vec<UtxoResponse>,
                      collateral: Option<OutRef>,
                      draws: Vec<UtxoResponse>,
                      depth: u32,
                      pool: Option<&PoolRef>| {
        wasm::chain_in(
            &accounts(),
            sk,
            ChainRequest {
                network: "preprod".into(),
                params: params(),
                index: 0,
                utxos,
                collateral,
                pool: draws,
                depth,
                boxes: Some(1),
                merge: Vec::new(),
                again: false,
                own: vec![hex::encode([0x10; 32])],
                collateral_pool: None,
                collateral_boxes: vec![],
                collateral_reserve: false,
            },
            pool,
        )
        .unwrap()
    };
    // A mix session: its deposit reads the pool's reference UTxO, as its mix does.
    let mixed = in_session(
        vec![
            at_session(0x10, 0, 6_000_000, vec![ljtest(Q)]),
            at_session(0x11, 0, 5_000_000, vec![]),
        ],
        Some(OutRef {
            tx_hash: hex::encode([0x11; 32]),
            tx_index: 0,
        }),
        others(4),
        1,
        Some(&pool_ref()),
    );
    let kinds: Vec<&str> = mixed.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, ["deposit", "mix", "back"]);
    assert_eq!(reads(&mixed.txs[0].tx_cbor), reference);
    assert!(reads(&mixed.txs[1].tx_cbor).contains(&reference[0]));
    // A private Bootstrap: its session's one UTxO, no collateral, nothing drawn.
    let funded = |pool: Option<&PoolRef>| {
        let funding = FundingRequest {
            network: "preprod".into(),
            boxes: 1,
            depth: 0,
            again: false,
        };
        wasm::funding_in(funding, pool)
            .unwrap()
            .lovelace
            .parse::<u64>()
            .unwrap()
            + back_reserve()
    };
    let bootstrap = in_session(
        vec![at_session(
            0x10,
            0,
            funded(Some(&pool_ref())),
            vec![ljtest(Q)],
        )],
        None,
        Vec::new(),
        0,
        Some(&pool_ref()),
    );
    assert_eq!(bootstrap.txs[0].kind, "deposit");
    assert_eq!(reads(&bootstrap.txs[0].tx_cbor), reference);
    // The classic pool's reads nothing.
    let classic = in_session(
        vec![at_session(0x10, 0, funded(None), vec![])],
        None,
        Vec::new(),
        0,
        None,
    );
    assert_eq!(classic.txs[0].kind, "deposit");
    assert!(reads(&classic.txs[0].tx_cbor).is_empty());
    // The public account's, with a mix and without.
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    for depth in [1, 0] {
        let chain = wasm::chain_from_account_in(
            &account,
            sk,
            AccountChainRequest {
                network: "preprod".into(),
                params: params(),
                utxos: vec![
                    public(0x60, Role::Receive, 1, 3_000_000, vec![ljtest(Q)]),
                    public(0x61, Role::Change, 0, 20_000_000, vec![]),
                ],
                collateral: (depth > 0).then(|| public(0x6c, Role::Receive, 0, 5_000_000, vec![])),
                pool: others(2),
                depth,
                boxes: 1,
            },
            Some(&pool_ref()),
        )
        .unwrap();
        assert_eq!(chain.txs[0].kind, "deposit");
        assert_eq!(reads(&chain.txs[0].tx_cbor), reference, "depth {depth}");
    }
}

#[test]
fn the_public_account_mixes_into_a_token_pool_with_its_token() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let sk = Scalar::from(2_468u64);
    let chain = wasm::chain_from_account_in(
        &account,
        sk,
        AccountChainRequest {
            network: "preprod".into(),
            params: params(),
            utxos: vec![
                public(0x60, Role::Receive, 1, 3_000_000, vec![ljtest(3 * Q)]),
                public(0x61, Role::Change, 0, 20_000_000, vec![]),
            ],
            collateral: Some(public(0x6c, Role::Receive, 0, 5_000_000, vec![])),
            pool: others(4),
            depth: 1,
            boxes: 2,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    let kinds: Vec<&str> = chain.txs.iter().map(|t| t.kind.as_str()).collect();
    assert_eq!(kinds, ["deposit", "mix", "mix"]);
    let deposit_bytes = hex::decode(&chain.txs[0].tx_cbor).unwrap();
    let deposit = MultiEraTx::decode(&deposit_bytes).unwrap();
    let spent: Vec<String> = deposit
        .inputs()
        .iter()
        .map(|i| hex::encode(i.hash()))
        .collect();
    assert!(spent.contains(&hex::encode([0x60; 32])));
    let outputs = deposit.outputs();
    assert_eq!(holds_ljtest(&outputs[0]), Some(Q));
    assert_eq!(holds_ljtest(&outputs[1]), Some(Q));
    // The box the deposit didn't take back to the account's 0/0.
    let home = account.base_address(true, Role::Receive, 0).unwrap();
    assert!(
        outputs
            .iter()
            .any(|o| o.address().unwrap() == home && holds_ljtest(o) == Some(Q))
    );
    // Signed by both keys it spends.
    assert_eq!(witnesses(&chain.txs[0].tx_cbor), 2);
    // Too little of the token: said so.
    let short = wasm::chain_from_account_in(
        &account,
        sk,
        AccountChainRequest {
            network: "preprod".into(),
            params: params(),
            utxos: vec![
                public(0x60, Role::Receive, 1, 3_000_000, vec![ljtest(Q)]),
                public(0x61, Role::Change, 0, 20_000_000, vec![]),
            ],
            collateral: Some(public(0x6c, Role::Receive, 0, 5_000_000, vec![])),
            pool: others(4),
            depth: 1,
            boxes: 2,
        },
        Some(&pool_ref()),
    )
    .unwrap_err();
    assert!(
        short.to_string().contains("enough of this pool's token"),
        "{short}"
    );
}

#[test]
fn a_box_comes_back_with_the_public_account_paying() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let sk = Scalar::from(4_242u64);
    let back = wasm::withdraw_paid_in(
        &account,
        sk,
        WithdrawPaidRequest {
            network: "preprod".into(),
            params: params(),
            pool: vec![box_row("a1", Some(sk)), box_row("b2", None)],
            box_ref: None,
            utxos: vec![
                public(0x70, Role::Receive, 2, 12_000_000, vec![]),
                public(0x71, Role::Receive, 3, 3_000_000, vec![ljtest(5)]),
            ],
            collateral: public(0x7c, Role::Receive, 0, 5_000_000, vec![]),
        },
        Some(&pool_ref()),
    )
    .unwrap();
    assert_eq!(back.box_ref.tx_hash, "a1".repeat(32));
    assert_eq!(back.token.as_ref().unwrap().quantity, Q.to_string());
    let paid: u64 = back.paid.parse().unwrap();
    let fee: u64 = back.fee.parse().unwrap();
    let lovelace: u64 = back.lovelace.parse().unwrap();
    // The account pays the fee and makes up what the Seedelf output needs past the box's 2 ₳.
    assert_eq!(paid, fee + (lovelace - 2_000_000));
    let tx_bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&tx_bytes).unwrap();
    let config = get_config(VARIANT, true).unwrap();
    let wallet = wallet_contract(true, config.contract.wallet_contract_hash);
    assert_eq!(tx.outputs()[0].address().unwrap(), wallet);
    assert_eq!(holds_ljtest(&tx.outputs()[0]), Some(Q));
    // The largest ADA UTxO paid, never the token one; signed by its key and the collateral's.
    let spent: Vec<String> = tx.inputs().iter().map(|i| hex::encode(i.hash())).collect();
    assert!(spent.contains(&hex::encode([0x70; 32])));
    assert!(!spent.contains(&hex::encode([0x71; 32])));
    assert_eq!(witnesses(&back.tx_cbor), 2);
}

#[test]
fn a_pool_starts_from_the_public_account_signed_by_its_keys() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let launched = api::build_launch_from_account(
        &account,
        api::AccountLaunchRequest {
            network: "preprod".into(),
            params: params(),
            utxos: vec![
                public(0x80, Role::Receive, 1, 20_000_000, vec![]),
                public(0x81, Role::Change, 2, 10_000_000, vec![]),
            ],
            collateral: Some(public(0x8c, Role::Receive, 0, 5_000_000, vec![])),
            token: Some(api::TokenAmount {
                policy_id: "1a".repeat(28),
                asset_name: hex::encode("NIGHT"),
                quantity: "100000000".into(),
            }),
            box_lovelace: "4500000".into(),
            max_fee: "1500000".into(),
            register: true,
            invalid_hereafter: Some(99_999_999),
        },
    )
    .unwrap();
    assert_eq!(launched.pool.version, "tokenV1");
    assert_eq!(launched.pool.scripts_inline, 0);
    // The seed is the largest UTxO, its first input.
    let seed = launched.pool.seed.as_ref().unwrap();
    assert_eq!(seed.tx_hash, hex::encode([0x80; 32]));
    assert_eq!(launched.inputs[0].tx_hash, seed.tx_hash);
    assert_eq!(launched.collateral.tx_hash, hex::encode([0x8c; 32]));
    assert!(launched.mix_logic_stake.starts_with("stake_test1"));
    // Two inputs under two keys and the collateral under a third: three signatures.
    assert_eq!(launched.inputs.len(), 2);
    assert_eq!(witnesses(&launched.tx_cbor), 3);
    assert_eq!(launched.locked.total, "23123310");
}

#[test]
fn an_ada_pool_starts_from_the_seedelf_balance() {
    let sk = Scalar::from(5_151_515u64);
    let config = get_config(VARIANT, true).unwrap();
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let utxo = row(json!({
        "tx_hash": "e1".repeat(32), "tx_index": 1,
        "address": wallet_contract(true, config.contract.wallet_contract_hash).to_bech32().unwrap(),
        "value": "60000000",
        "payment_cred": hex::encode(config.contract.wallet_contract_hash),
        "inline_datum": {
            "bytes": hex::encode(register.to_vec().unwrap()),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
    }));
    let request = |box_lovelace: &str| api::LaunchRequest {
        network: "preprod".into(),
        params: params(),
        utxos: vec![utxo.clone()],
        classes: Default::default(),
        token: None,
        box_lovelace: box_lovelace.into(),
        max_fee: "1500000".into(),
        register: true,
    };
    let launched = api::build_launch(sk, request("25000000")).unwrap();
    assert_eq!(launched.pool.box_lovelace, "25000000");
    assert!(launched.pool.token.is_none());
    // Never a copy of the classic pool's 10 ₳.
    let why = api::build_launch(sk, request("10000000"))
        .err()
        .unwrap()
        .to_string();
    assert!(why.contains("copy of the classic pool"), "{why}");
}

#[test]
fn a_launchs_box_value_is_its_way_backs() {
    let typical = wasm::box_value(BoxValueRequest {
        network: "preprod".into(),
        params: params(),
        token: Some(api::TokenAmount {
            policy_id: "1a".repeat(28),
            asset_name: hex::encode("NIGHT"),
            quantity: "100000000".into(),
        }),
    })
    .unwrap();
    // S0d's figures, scripts by reference.
    assert_eq!(typical.least, "3830000");
    assert_eq!(typical.suggested, "4500000");
    assert_eq!(typical.most.as_deref(), Some("9000000"));
    let ada = wasm::box_value(BoxValueRequest {
        network: "preprod".into(),
        params: params(),
        token: None,
    })
    .unwrap();
    assert_eq!(ada.least, "3450000");
    assert!(ada.most.is_none());
}

/// A pool of one of its token a box (1.6.0's release review, MONEY-2): the
/// launch form asks for its box value as the creator types, and "1" trapped,
/// which locked the wallet. It has one now, and none of the token is refused
/// in words, the module whole.
#[test]
fn a_box_of_one_token_has_a_box_value_and_none_is_refused() {
    let of = |quantity: &str| {
        wasm::box_value(BoxValueRequest {
            network: "mainnet".into(),
            params: params(),
            token: Some(api::TokenAmount {
                policy_id: "1a".repeat(28),
                asset_name: hex::encode("SNEK"),
                quantity: quantity.into(),
            }),
        })
    };
    let one = of("1").unwrap();
    assert_eq!(one.least, "3620000");
    assert_eq!(one.suggested, "4000000");
    assert_eq!(one.most.as_deref(), Some("9000000"));
    let none = of("0").unwrap_err().to_string();
    assert!(none.contains("at least one of its token"), "{none}");
}

/// A large Bootstrap from the public account (1.6.0's release review,
/// MONEY-5): its UTxOs were picked only until they covered the boxes and the
/// deposit's 1.5 ₳ reserve, which 64 token boxes' fee (about 0.8 ₳) and an
/// ADA change at a base address (about 0.97 ₳) outgrow. So an account of
/// hundreds of ₳ was refused as short whenever the UTxOs picked happened to
/// land near that. Now another is picked, and the deposit built again.
#[test]
fn a_large_bootstrap_from_the_public_account_takes_another_utxo_for_its_fee() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let boxes = 64;
    // The boxes take 128 ₳ and the reserve 1.5 ₳: these three cover it by 0.1 ₳, largest first.
    let mut utxos = vec![
        public(0x60, Role::Receive, 1, 2_000_000, vec![ljtest(64 * Q)]),
        public(0x61, Role::Change, 0, 100_000_000, vec![]),
        public(0x62, Role::Change, 1, 27_600_000, vec![]),
    ];
    utxos.extend((0..5).map(|i| public(0x70 + i, Role::Receive, 2, 2_000_000, vec![])));
    let chain = wasm::chain_from_account_in(
        &account,
        Scalar::from(1_357u64),
        AccountChainRequest {
            network: "preprod".into(),
            params: params(),
            utxos,
            collateral: None,
            pool: Vec::new(),
            depth: 0,
            boxes,
        },
        Some(&pool_ref()),
    )
    .unwrap();
    assert_eq!(chain.txs.len(), 1);
    let bytes = hex::decode(&chain.txs[0].tx_cbor).unwrap();
    let deposit = MultiEraTx::decode(&bytes).unwrap();
    // One more UTxO than `needed` asked for, and no more.
    assert_eq!(deposit.inputs().len(), 4);
    let outputs = deposit.outputs();
    assert_eq!(
        outputs
            .iter()
            .filter(|o| holds_ljtest(o) == Some(Q))
            .count(),
        boxes
    );
    // Its change is the least an output holds, at least.
    let change = outputs.last().unwrap().value().coin();
    assert!(change >= 969_750, "{change}");
    assert_eq!(chain.returned, change.to_string());
}

/// A UTxO of `sk`'s private balance, as Koios lists it, with `extra` fields.
fn private_row_with(sk: Scalar, tx: u8, lovelace: u64, extra: Value) -> UtxoResponse {
    let config = get_config(VARIANT, true).unwrap();
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let mut fields = json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": 1,
        "address": wallet_contract(true, config.contract.wallet_contract_hash).to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "payment_cred": hex::encode(config.contract.wallet_contract_hash),
        "inline_datum": { "bytes": hex::encode(register.to_vec().unwrap()), "value": {} },
    });
    for (k, v) in extra.as_object().unwrap() {
        fields[k] = v.clone();
    }
    row(fields)
}

fn private_row(sk: Scalar, tx: u8, lovelace: u64) -> UtxoResponse {
    private_row_with(sk, tx, lovelace, json!({}))
}

/// Bringing back the wallet's box among `pool`, a box of 1.5 ₳ and the token, paid from `utxos`.
fn bring_back_privately(
    sk: Scalar,
    pool: Vec<UtxoResponse>,
    box_ref: Option<OutRef>,
    utxos: Vec<UtxoResponse>,
) -> anyhow::Result<wasm::WithdrawPrivateResult> {
    wasm::withdraw_private_in(
        sk,
        WithdrawPrivateRequest {
            network: "preprod".into(),
            params: params(),
            pool,
            box_ref,
            utxos,
        },
        Some(&pool_ref_worth(1_500_000)),
    )
}

// 34g's call 36: a box that can't pay its own way back comes back paid from
// the private balance by default, a Seedelf UTxO spent beside it under a new
// one-time key, as the public account could already pay.
#[test]
fn a_box_too_poor_to_come_back_is_paid_from_the_private_balance() {
    let sk = Scalar::from(6_161u64);
    let poor = pool_ref_worth(1_500_000);
    let pool = vec![
        box_row_worth("c1", Some(sk), 1_500_000),
        box_row_worth("c2", None, 1_500_000),
    ];
    // On its own, it can't come back.
    let alone = wasm::withdraw_in(
        sk,
        WithdrawRequest {
            network: "preprod".into(),
            params: params(),
            pool: pool.clone(),
            box_ref: None,
        },
        Some(&poor),
    )
    .unwrap_err();
    assert!(
        alone.downcast_ref::<lovejoin::CantPayBack>().is_some(),
        "{alone}"
    );

    let paying = private_row(sk, 0xe1, 5_000_000);
    let back = bring_back_privately(sk, pool.clone(), None, vec![paying.clone()]).unwrap();
    assert_eq!(back.box_ref.tx_hash, "c1".repeat(32));
    assert_eq!(back.spent, format!("{}#1", "e1".repeat(32)));
    assert_eq!(back.spent_lovelace, "5000000");
    assert_eq!(back.token.as_ref().unwrap().quantity, Q.to_string());
    let fee: u64 = back.fee.parse().unwrap();
    let lovelace: u64 = back.lovelace.parse().unwrap();
    // The box's ADA and the UTxO's come back together, less the fee.
    assert_eq!(lovelace, 1_500_000 + 5_000_000 - fee);
    // The worker's names, as the other withdraws answer.
    let answer = serde_json::to_value(&back).unwrap();
    for field in [
        "txCbor",
        "txHash",
        "seed",
        "fee",
        "lovelace",
        "spent",
        "spentLovelace",
        "boxRef",
        "token",
    ] {
        assert!(answer.get(field).is_some(), "{field}");
    }

    let bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    assert_eq!(hex::encode(tx.hash()), back.tx_hash);
    // One output, at the wallet contract under a fresh register of the wallet's: the token and the ADA.
    let outputs = tx.outputs();
    assert_eq!(outputs.len(), 1);
    let config = get_config(VARIANT, true).unwrap();
    let wallet = wallet_contract(true, config.contract.wallet_contract_hash);
    assert_eq!(outputs[0].address().unwrap(), wallet);
    assert_eq!(outputs[0].value().coin(), lovelace);
    assert_eq!(holds_ljtest(&outputs[0]), Some(Q));
    let datum = match outputs[0].datum().unwrap() {
        pallas_primitives::conway::PseudoDatumOption::Data(d) => {
            let data: &pallas_primitives::PlutusData = &d.0;
            pallas_primitives::Fragment::encode_fragment(data).unwrap()
        }
        _ => panic!("an inline register"),
    };
    let register = seedelf_koios::koios::register_of_datum(&datum).unwrap();
    assert!(register.is_owned(sk).unwrap());
    // The box and the private UTxO spent, nothing else.
    let mut spent: Vec<String> = tx.inputs().iter().map(|i| hex::encode(i.hash())).collect();
    spent.sort();
    assert_eq!(spent, ["c1".repeat(32), "e1".repeat(32)]);
    // Unsigned, as any Seedelf spend giveme.my sees: the seed's one-time key and giveme.my's are its signers.
    assert_eq!(tx.vkey_witnesses().len(), 0);
    let seed: [u8; 32] = hex::decode(&back.seed).unwrap().try_into().unwrap();
    let one_time = api::one_time_key(&sk, &seed).public_key();
    let one_time_hash = Hasher::<224>::hash(one_time.as_ref());
    let signers = seedelf_core::build::required_signers(&bytes).unwrap();
    assert!(signers.contains(&Hash::new(COLLATERAL_HASH)));
    assert!(signers.contains(&one_time_hash));

    // Both scripts run, measured again here, and what it declares covers them.
    let protocol = wasm::protocol_of(true, Some(&poor)).unwrap();
    let mut known = vec![
        eval::resolve_row(&pool[0]).unwrap(),
        eval::resolve_row(&paying).unwrap(),
    ];
    known.extend(protocol.references.iter().cloned());
    known.extend(eval::seedelf_references(true).unwrap());
    let cost_model = ProtocolParameters::from_koios(&params())
        .unwrap()
        .cost_model_v3;
    let measured = eval::evaluate(&bytes, &known, &cost_model, true).unwrap();
    let budgets = Budgets::from_ogmios(&measured).unwrap();
    // The box (c1…) is input 0, the private UTxO (e1…) input 1, and mix_logic's withdrawal.
    assert!(budgets.spend(0).is_some(), "{measured}");
    assert!(budgets.spend(1).is_some(), "{measured}");
    assert!(budgets.withdraw(0).is_some(), "{measured}");
    assert!(eval::declared_covers(&bytes, &measured).unwrap().is_ok());

    // Finished as any Seedelf spend: giveme.my's checked signature, then the one-time key's, added together.
    let giveme = SecretKey::new(OsRng);
    let hash = seedelf_core::build::tx_id(&bytes).unwrap();
    let collateral = json!({
        "witness": format!("8258{}", hex::encode([0u8; 32])) + &hex::encode(giveme.sign(hash).as_ref())
    });
    let signed = api::sign_with_collateral_key(
        sk,
        api::SignRequest {
            tx_cbor: back.tx_cbor.clone(),
            seed: back.seed.clone(),
            collateral,
        },
        giveme.public_key(),
    )
    .unwrap();
    assert_eq!(signed.tx_hash, back.tx_hash);
    let signed_bytes = hex::decode(&signed.tx_cbor).unwrap();
    let signed_tx = MultiEraTx::decode(&signed_bytes).unwrap();
    assert_eq!(hex::encode(signed_tx.hash()), back.tx_hash);
    let witnessed = signed_tx.vkey_witnesses();
    assert_eq!(witnessed.len(), 2);
    for w in witnessed {
        let vkey: [u8; 32] = w.vkey.as_slice().try_into().unwrap();
        let signature: [u8; 64] = w.signature.as_slice().try_into().unwrap();
        assert!(PublicKey::from(vkey).verify(hash, &Signature::from(signature)));
    }
    assert!(
        witnessed
            .iter()
            .any(|w| w.vkey.as_slice() == one_time.as_ref())
    );
}

#[test]
fn the_private_balance_passes_over_what_cant_pay_and_takes_the_next() {
    let sk = Scalar::from(6_262u64);
    let pool = vec![box_row_worth("c3", Some(sk), 1_500_000)];
    let script = derived().mix_logic;
    let utxos = vec![
        // A token's.
        private_row_with(sk, 0xe1, 40_000_000, json!({ "asset_list": [ljtest(5)] })),
        // Someone else's.
        private_row(Scalar::from(9_999u64), 0xe2, 40_000_000),
        // One holding a reference script, which the wallet's evaluator can't take.
        private_row_with(
            sk,
            0xe3,
            40_000_000,
            json!({ "reference_script": { "hash": hex::encode(script.hash), "size": script.cbor.len(),
                                          "type": "plutusV3", "bytes": hex::encode(&script.cbor) } }),
        ),
        // Too small to make up what the output needs.
        private_row(sk, 0xe4, 300_000),
        // The first that pays.
        private_row(sk, 0xe5, 3_000_000),
        private_row(sk, 0xe6, 50_000_000),
    ];
    let back = bring_back_privately(sk, pool, None, utxos).unwrap();
    assert_eq!(back.spent, format!("{}#1", "e5".repeat(32)));
    assert_eq!(back.spent_lovelace, "3000000");
    let fee: u64 = back.fee.parse().unwrap();
    assert_eq!(back.lovelace, (1_500_000 + 3_000_000 - fee).to_string());
    let bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let mut spent: Vec<String> = tx.inputs().iter().map(|i| hex::encode(i.hash())).collect();
    spent.sort();
    assert_eq!(spent, ["c3".repeat(32), "e5".repeat(32)]);
}

#[test]
fn none_of_the_private_balance_paying_says_so_in_fixed_words() {
    let sk = Scalar::from(6_363u64);
    let pool = vec![
        box_row_worth("c4", Some(sk), 1_500_000),
        box_row_worth("c5", None, 1_500_000),
    ];
    let none_pays = vec![
        private_row(sk, 0xe4, 300_000),
        private_row_with(sk, 0xe1, 40_000_000, json!({ "asset_list": [ljtest(5)] })),
        private_row(Scalar::from(9_999u64), 0xe2, 40_000_000),
    ];
    // The too small one alone was tried, and refused as too small.
    let protocol = wasm::protocol_of(true, Some(&pool_ref_worth(1_500_000))).unwrap();
    let too_small = lovejoin::withdraw_private(
        &ProtocolParameters::from_koios(&params()).unwrap(),
        &protocol,
        &[PoolBox::from_row(&pool[0], &protocol).unwrap()],
        &sk,
        Register::create(sk).unwrap().rerandomize().unwrap(),
        &seedelf_payer(sk, &none_pays[0]),
    )
    .unwrap_err();
    assert!(
        too_small
            .downcast_ref::<lovejoin::PrivateTooSmall>()
            .is_some(),
        "{too_small}"
    );
    for utxos in [none_pays, Vec::new()] {
        let e = bring_back_privately(sk, pool.clone(), None, utxos).unwrap_err();
        assert_eq!(format!("{e:#}"), wasm::NO_PRIVATE_PAYS);
    }
    // Any other refusal is said as it is: a box that isn't the wallet's.
    let theirs = OutRef {
        tx_hash: "c5".repeat(32),
        tx_index: 0,
    };
    let e = bring_back_privately(
        sk,
        pool,
        Some(theirs),
        vec![private_row(sk, 0xe5, 3_000_000)],
    )
    .unwrap_err();
    assert_eq!(
        e.to_string(),
        "That box isn't in the pool as this wallet's anymore"
    );
}

/// What spends `utxo`, one of `sk`'s, beside a withdraw: its proof bound to a one-time key's hash.
fn seedelf_payer(sk: Scalar, utxo: &UtxoResponse) -> lovejoin::SeedelfPayer {
    let register = seedelf_koios::koios::extract_bytes_with_logging(&utxo.inline_datum).unwrap();
    let signer = [0x5e; 28];
    let (z, g_r) =
        seedelf_crypto::schnorr::create_proof(register, sk, hex::encode(signer)).unwrap();
    lovejoin::SeedelfPayer {
        coin: lovejoin::Coin::from_row(utxo).unwrap(),
        redeemer: seedelf_core::data_structures::create_spend_redeemer(z, g_r, hex::encode(signer))
            .unwrap(),
        signer,
    }
}
