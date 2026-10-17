//! Lovejoin's token pools through the WebAssembly layer: a pool named by
//! what the worker found of it on chain (`lovejoin::PoolRef`), verified here
//! on every call from the bundled templates; the wallet's boxes in it, and a
//! box back; and starting a pool from the Seedelf balance. A request
//! without a pool is the classic pool's, its JSON as before.

use blstrs::Scalar;
use pallas_crypto::hash::Hasher;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::MultiEraTx;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::build;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::lovejoin::{self, BoxToken, BoxValue, ReferenceDatum, mix_datum, templates};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;
use seedelf_wasm::api;
use seedelf_wasm::lovejoin::{
    self as wasm, OutRef, OwnedRequest, PoolRef, UsableRequest, VerifyPoolRequest, WithdrawRequest,
};
use serde_json::{Value, json};

fn params() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

/// Lovejoin's own token pool on preprod: its seed, and its datum's terms.
const LJ_SEED: &str = "5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b";
const LJ_POLICY: &str = "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69";
const LJTEST: &str = "02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa";

fn derived() -> templates::Derived {
    let seed: [u8; 32] = hex::decode(LJ_SEED).unwrap().try_into().unwrap();
    templates::derive(&seed, 2).unwrap()
}

fn row(value: Value) -> UtxoResponse {
    let mut base = json!({
        "tx_index": 0, "stake_address": null, "epoch_no": 0, "block_height": 0,
        "block_time": 0, "datum_hash": null, "inline_datum": null,
        "reference_script": null, "asset_list": [], "is_spent": false,
    });
    for (k, v) in value.as_object().unwrap() {
        base[k] = v.clone();
    }
    serde_json::from_value(base).unwrap()
}

fn holder() -> String {
    lovejoin::holder_address(true).to_bech32().unwrap()
}

/// The pool as the worker would find it: its reference UTxO at the holder,
/// and its two scripts there too when `at_holder`, else at a key address
/// (where Lovejoin's own launch left them).
fn lj_pool_ref(at_holder: bool) -> PoolRef {
    let d = derived();
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: 2_000_000,
            token: Some(BoxToken {
                policy: hex::decode(LJTEST).unwrap().try_into().unwrap(),
                name: b"LJTEST".to_vec(),
                quantity: 10_000_000_000_000_000,
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
    let park = "addr_test1qzl48hyeyvgh6hmpavf8zcnvjpcpd7gwapa0fukhh0ym3ndl20wfjgc3040kr6cjw93xeyrszmusa6r67ned0w7fhrxsjjqyv6";
    let script = |first: &str, s: &templates::Script| {
        row(json!({
            "tx_hash": first.repeat(32), "address": if at_holder { holder() } else { park.to_string() },
            "value": "20000000", "payment_cred": hex::encode(templates::REFERENCE_HOLDER_HASH),
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

#[test]
fn a_pool_the_worker_found_is_verified_and_shown() {
    let view = wasm::verify_pool(VerifyPoolRequest {
        network: "preprod".into(),
        pool: lj_pool_ref(true),
    })
    .unwrap();
    assert_eq!(view.id, LJ_POLICY);
    assert_eq!(view.version, "tokenV1");
    assert_eq!(view.box_lovelace, "2000000");
    let token = view.token.as_ref().unwrap();
    assert_eq!(token.policy_id, LJTEST);
    assert_eq!(token.asset_name, hex::encode("LJTEST"));
    assert_eq!(token.quantity, "10000000000000000");
    assert_eq!(
        view.mix_box_hash,
        "b51f7e0331d32c706c0657a9ae28e5900e651d569d922b7093b52ea4"
    );
    assert_eq!(
        view.mix_logic_hash,
        "ada2c293ad286873fb2d265b4a8597edc5271e927e13dc0496e7b953"
    );
    assert_eq!(view.scripts_inline, 0);
    assert_eq!(view.seed.as_ref().unwrap().tx_index, 2);
    // Its scripts away from the holder: never read from there, carried.
    let away = wasm::verify_pool(VerifyPoolRequest {
        network: "preprod".into(),
        pool: lj_pool_ref(false),
    })
    .unwrap();
    assert_eq!(away.scripts_inline, 2);
}

#[test]
fn a_pool_without_its_launchs_seed_isnt_trusted() {
    let mut pool = lj_pool_ref(true);
    pool.seed.tx_index = 0;
    let e = wasm::verify_pool(VerifyPoolRequest {
        network: "preprod".into(),
        pool,
    })
    .unwrap_err();
    assert!(e.to_string().contains("seed"), "{e}");
    // Nor on the other network.
    let e = wasm::verify_pool(VerifyPoolRequest {
        network: "mainnet".into(),
        pool: lj_pool_ref(true),
    })
    .unwrap_err();
    assert!(e.to_string().contains("holder"), "{e}");
}

#[test]
fn usable_says_why_a_pool_cant_take_a_mix() {
    let classic = wasm::usable(UsableRequest {
        network: "preprod".into(),
        params: params(),
        pool_ref: None,
        registered: true,
    })
    .unwrap();
    assert!(classic.usable && classic.why.is_none());
    let unregistered = wasm::usable(UsableRequest {
        network: "preprod".into(),
        params: params(),
        pool_ref: Some(lj_pool_ref(true)),
        registered: false,
    })
    .unwrap();
    assert!(!unregistered.usable);
    assert_eq!(unregistered.why.as_deref(), Some("notRegistered"));
    let lj = wasm::usable(UsableRequest {
        network: "preprod".into(),
        params: params(),
        pool_ref: Some(lj_pool_ref(true)),
        registered: true,
    })
    .unwrap();
    assert!(lj.usable, "{lj:?}");
    assert_eq!(
        lj.back.unwrap().parse::<u64>().unwrap() + lj.withdraw_fee.unwrap().parse::<u64>().unwrap(),
        2_000_000
    );
}

/// A box of the pool's at `mix_box`, as Koios lists it, owned by `sk` when given.
fn box_row(first: &str, sk: Option<Scalar>) -> UtxoResponse {
    let d = derived();
    // A register's shape, b = [sk]·a, as the wallet's boxes are.
    let owner = sk.unwrap_or(Scalar::from(99u64 + first.as_bytes()[0] as u64));
    let register = Register::create(owner).unwrap().rerandomize().unwrap();
    let point = |p: &str| -> [u8; 48] { hex::decode(p).unwrap().try_into().unwrap() };
    let datum = mix_datum(&point(&register.generator), &point(&register.public_value));
    let mix_box = seedelf_core::lovejoin::verify_pool(
        true,
        &seedelf_core::eval::resolve_row(&lj_pool_ref(true).reference).unwrap(),
        (hex::decode(LJ_SEED).unwrap().try_into().unwrap(), 2),
        &[],
    )
    .unwrap()
    .mix_box_address();
    row(json!({
        "tx_hash": first.repeat(32), "address": mix_box.to_bech32().unwrap(), "value": "2000000",
        "payment_cred": hex::encode(d.mix_box.hash),
        "inline_datum": { "bytes": hex::encode(datum), "value": {} },
        "asset_list": [{ "policy_id": LJTEST, "asset_name": hex::encode("LJTEST"),
                         "quantity": "10000000000000000", "decimals": 0, "fingerprint": "" }],
    }))
}

#[test]
fn the_wallets_boxes_in_a_token_pool_are_read_and_one_comes_back() {
    let sk = Scalar::from(4_242u64);
    let rows = vec![
        box_row("a1", Some(sk)),
        box_row("b2", None),
        box_row("c3", None),
    ];
    let pool = lj_pool_ref(true);
    let owned = wasm::owned_in(
        sk,
        OwnedRequest {
            network: "preprod".into(),
            pool: rows.clone(),
        },
        Some(&pool),
    )
    .unwrap();
    assert_eq!(owned.boxes.len(), 1);
    assert_eq!(owned.others, 2);
    assert_eq!(owned.lovelace, "2000000");
    assert_eq!(owned.token.as_ref().unwrap().quantity, "10000000000000000");
    // Read as the classic pool's, they're no boxes at all.
    let classic = wasm::owned(
        sk,
        OwnedRequest {
            network: "preprod".into(),
            pool: rows.clone(),
        },
    )
    .unwrap();
    assert!(classic.boxes.is_empty() && classic.others == 0);
    // And the classic pool's JSON is as it was: no token.
    let json = serde_json::to_value(&classic).unwrap();
    assert!(json.get("token").is_none());

    let back = wasm::withdraw_in(
        sk,
        WithdrawRequest {
            network: "preprod".into(),
            params: params(),
            pool: rows,
            box_ref: None,
        },
        Some(&pool),
    )
    .unwrap();
    let fee: u64 = back.fee.parse().unwrap();
    assert_eq!(back.lovelace.parse::<u64>().unwrap(), 2_000_000 - fee);
    assert_eq!(back.token.as_ref().unwrap().quantity, "10000000000000000");
    let bytes = hex::decode(&back.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let out = &tx.outputs()[0];
    let value = out.value();
    assert_eq!(
        value.assets()[0].assets()[0].output_coin(),
        Some(10_000_000_000_000_000)
    );
}

/// A Seedelf UTxO of `sk`'s, as Koios lists it.
fn seedelf_row(sk: Scalar, first: &str, lovelace: u64) -> UtxoResponse {
    let config = get_config(VARIANT, true).unwrap();
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    row(json!({
        "tx_hash": first.repeat(32), "tx_index": 1,
        "address": wallet_contract(true, config.contract.wallet_contract_hash).to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "payment_cred": hex::encode(config.contract.wallet_contract_hash),
        "inline_datum": {
            "bytes": hex::encode(register.to_vec().unwrap()),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
    }))
}

#[test]
fn a_pool_starts_from_the_seedelf_balance_and_signs_as_any_spend() {
    let sk = Scalar::from(5_151_515u64);
    let utxos = vec![
        seedelf_row(sk, "e1", 40_000_000),
        seedelf_row(sk, "e2", 3_000_000),
    ];
    let request = api::LaunchRequest {
        network: "preprod".into(),
        params: params(),
        utxos,
        classes: Default::default(),
        token: api::TokenAmount {
            policy_id: "1a".repeat(28),
            asset_name: hex::encode("NIGHT"),
            quantity: "100000000".into(),
        },
        box_lovelace: "4500000".into(),
        max_fee: "1500000".into(),
        register: true,
    };
    let launched = api::build_launch(sk, request).unwrap();
    assert_eq!(launched.pool.version, "tokenV1");
    assert_eq!(launched.pool.scripts_inline, 0);
    assert_eq!(launched.pool.box_lovelace, "4500000");
    let seed = launched.pool.seed.as_ref().unwrap();
    let seed_tx: [u8; 32] = hex::decode(&seed.tx_hash).unwrap().try_into().unwrap();
    assert_eq!(
        launched.pool.id,
        hex::encode(templates::derive(&seed_tx, seed.tx_index).unwrap().policy())
    );
    assert_eq!(launched.locked.total, "23123310");
    // The 40 ₳ pays alone; the seed is one it spends.
    assert_eq!(launched.inputs.len(), 1);
    assert_eq!(launched.inputs[0].tx_hash, seed.tx_hash);

    // Signed as every Seedelf spend is: the one-time key and giveme.my's.
    let hash: [u8; 32] = hex::decode(&launched.tx_hash).unwrap().try_into().unwrap();
    let stand_in = PrivateKey::from(SecretKey::new(OsRng));
    let signature = stand_in.sign(hash);
    let signed = api::sign_with_collateral_key(
        sk,
        api::SignRequest {
            tx_cbor: launched.tx_cbor.clone(),
            seed: launched.seed.clone(),
            collateral: json!({ "witness": format!(
                "a10081825820{}5840{}",
                hex::encode(stand_in.public_key()),
                hex::encode(signature)
            )}),
        },
        stand_in.public_key(),
    )
    .unwrap();
    assert_eq!(signed.tx_hash, launched.tx_hash);
    let signers = build::required_signers(&hex::decode(&launched.tx_cbor).unwrap()).unwrap();
    let seed_bytes: [u8; 32] = hex::decode(&launched.seed).unwrap().try_into().unwrap();
    let one_time = Hasher::<224>::hash(api::one_time_key(&sk, &seed_bytes).public_key().as_ref());
    assert!(signers.contains(&one_time));
}

/// What the worker sends: the request's JSON, with `poolRef` beside it,
/// read on its own; the request reads as it always has.
#[test]
fn the_worker_names_a_pool_beside_a_request() {
    let text = json!({
        "network": "preprod", "pool": [],
        "poolRef": {
            "reference": serde_json::to_value(&lj_pool_ref(true).reference).unwrap(),
            "seed": { "txHash": LJ_SEED, "txIndex": 2 },
        },
    })
    .to_string();
    let named: wasm::PoolNamed = serde_json::from_str(&text).unwrap();
    assert!(named.pool_ref.is_some());
    let request: OwnedRequest = serde_json::from_str(&text).unwrap();
    assert_eq!(request.network, "preprod");
    // Without it, the classic pool, as before.
    let classic: wasm::PoolNamed =
        serde_json::from_str(r#"{ "network": "preprod", "pool": [] }"#).unwrap();
    assert!(classic.pool_ref.is_none());
}
