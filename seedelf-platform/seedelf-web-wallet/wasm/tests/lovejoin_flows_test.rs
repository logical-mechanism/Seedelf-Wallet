//! Chunk 34's 34d through the WebAssembly layer: the tile's flows into a
//! token pool (a mix session's chain, the public account's), a launch from
//! either side, a box brought back with the public account paying, and what
//! a launch's box may hold. Lovejoin's own preprod token pool stands in for
//! any token pool, named by a `PoolRef` as the worker names one.

use blstrs::Scalar;
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::lovejoin::{self, BoxToken, BoxValue, ReferenceDatum, mix_datum, templates};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT, Role};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self as wasm, AccountChainRequest, BoxValueRequest, ChainRequest, FundingRequest, OutRef,
    PlanRequest, PoolRef, WithdrawPaidRequest,
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

/// A box of the pool's at `mix_box`, owned by `sk` when given.
fn box_row(first: &str, sk: Option<Scalar>) -> UtxoResponse {
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
        "tx_hash": first.repeat(32), "address": mix_box.to_bech32().unwrap(), "value": "2000000",
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
            collateral: OutRef {
                tx_hash: hex::encode([0x11; 32]),
                tx_index: 0,
            },
            depth: 1,
            again: false,
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
            collateral: OutRef {
                tx_hash: hex::encode([0x11; 32]),
                tx_index: 0,
            },
            pool: others(4),
            depth: 1,
            boxes: None,
            merge: Vec::new(),
            again: false,
            own: vec![funding.clone()],
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
