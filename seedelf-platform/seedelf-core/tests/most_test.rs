//! The most a private payment can be, measured in the wallet against the
//! deployed preprod wallet contract: Max to one Seedelf or one address
//! (`ScriptSpend::pay_rest`), and an amount the guessed budgets call short
//! that the measured ones pay. Blind test T05 found the private Send's limit
//! by about 15 guesses: there was no Max, and the check used a fee about 1.3×
//! the review's, so amounts the review's own fee allowed were refused.

use pallas_addresses::{
    Address, Network, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_primitives::conway::{PlutusData, PseudoDatumOption};
use pallas_traverse::MultiEraTx;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build::{self, AddressPayment, Chain, Payment, ScriptSpend};
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::{self, random_scalar};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";

/// Preprod's parameters at epoch 315, with its V3 cost model (as merge_test.rs).
fn chain() -> Chain {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/eval-preprod.json")).expect("fixture");
    let seedelf = doc["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"].as_str().unwrap().starts_with("seedelf spend"))
        .unwrap()
        .clone();
    let params = ProtocolParameters::from_koios(&json!({
        "min_fee_a": 44, "min_fee_b": 155381, "coins_per_utxo_size": "4310",
        "key_deposit": "2000000", "price_mem": 0.0577, "price_step": 0.0000721,
        "min_fee_ref_script_cost_per_byte": 15,
        "cost_models": { "PlutusV3": seedelf["cost_model_v3"] },
    }))
    .unwrap();
    Chain {
        params,
        network_flag: true,
        config: get_config(VARIANT, true).unwrap(),
    }
}

struct World {
    chain: Chain,
    sk: blstrs::Scalar,
    owner: Register,
    signer: Hash<28>,
}

fn world() -> World {
    let sk = random_scalar();
    World {
        chain: chain(),
        sk,
        owner: Register::create(sk).unwrap(),
        signer: Hasher::<224>::hash(SecretKey::new(OsRng).public_key().as_ref()),
    }
}

fn tokens(quantity: u64) -> Assets {
    Assets::new()
        .add(Asset::new(TOKEN_POLICY.into(), hex::encode("tok"), quantity).unwrap())
        .unwrap()
}

/// A wallet-contract UTxO `w` owns, holding `token` of the test token.
fn owned(w: &World, tx: u8, lovelace: u64, token: u64) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    let wallet = wallet_contract(true, w.chain.config.contract.wallet_contract_hash);
    let assets: Vec<Value> = if token == 0 {
        vec![]
    } else {
        vec![
            json!({ "policy_id": TOKEN_POLICY, "asset_name": hex::encode("tok"),
                     "quantity": token.to_string(), "decimals": 0, "fingerprint": "" }),
        ]
    };
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]), "tx_index": 0,
        "address": wallet.to_bech32().unwrap(), "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": hex::encode(w.chain.config.contract.wallet_contract_hash),
        "epoch_no": 0, "block_height": 0, "block_time": 0, "datum_hash": null,
        "inline_datum": {
            "bytes": hex::encode(register.to_vec().unwrap()),
            "value": { "constructor": 0, "fields": [
                { "bytes": register.generator }, { "bytes": register.public_value },
            ]},
        },
        "reference_script": null, "asset_list": assets, "is_spent": false,
    }))
    .unwrap()
}

/// Blind test T05's private balance: 25 ₳, and 3 ₳ holding a token.
fn t05(w: &World) -> Vec<UtxoResponse> {
    vec![owned(w, 0x01, 25_000_000, 0), owned(w, 0x02, 3_000_000, 5)]
}

fn measured(w: &World, spend: ScriptSpend) -> anyhow::Result<build::FinalSpend> {
    spend
        .proven(|register, vkh| schnorr::create_proof(register.clone(), w.sk, vkh.to_string()))?
        .measure_locally(&[])
}

/// Each output's lovelace, token count, and whether `sk` owns its register (none for a key address).
fn outputs(tx: &build::FinalSpend, sk: blstrs::Scalar) -> Vec<(u64, u64, Option<bool>)> {
    let tx = MultiEraTx::decode(&tx.tx.tx_bytes.0).unwrap();
    tx.outputs()
        .iter()
        .map(|o| {
            let owned = match o.datum() {
                Some(PseudoDatumOption::Data(data)) => {
                    let PlutusData::Constr(c) = data.unwrap().unwrap() else {
                        panic!("a register")
                    };
                    let point = |i: usize| match &c.fields[i] {
                        PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
                        _ => panic!("a point"),
                    };
                    Some(Register::new(point(0), point(1)).is_owned(sk).unwrap())
                }
                _ => None,
            };
            let held = o
                .value()
                .assets()
                .iter()
                .flat_map(|p| p.assets())
                .map(|a| a.output_coin().unwrap_or(0))
                .sum();
            (o.value().coin(), held, owned)
        })
        .collect()
}

#[test]
fn max_to_a_seedelf_pays_all_but_the_fee_and_what_the_kept_token_needs() {
    let w = world();
    let bob = random_scalar();
    let to = Register::create(bob).unwrap().rerandomize().unwrap();
    let available = t05(&w);
    let (inputs, left) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
    assert_eq!((inputs.len(), left), (2, 0));

    let spend =
        build::transfer_most(&w.chain, &inputs, &to, &Assets::new(), &w.owner, w.signer).unwrap();
    let built = measured(&w, spend).unwrap();
    let kept = build::minimum_deposit(&w.chain.params, &tokens(5)).unwrap();
    let paid = built.rest_lovelace.unwrap();
    assert_eq!(paid, 28_000_000 - built.fee.total - kept);
    assert_eq!(built.change_lovelace, kept);
    let mut outs = outputs(&built, w.sk);
    outs.sort();
    // Bob's payment, and the token kept under our register with exactly its minimum.
    assert_eq!(outs, {
        let mut want = vec![(kept, 5, Some(true)), (paid, 0, Some(false))];
        want.sort();
        want
    });
    // The fee the review shows is the measured one: under the guessed budgets'.
    let guessed = build::transfer_most(&w.chain, &inputs, &to, &Assets::new(), &w.owner, w.signer)
        .unwrap()
        .estimate()
        .unwrap();
    assert!(
        guessed.fee.total > built.fee.total,
        "{} {}",
        guessed.fee.total,
        built.fee.total
    );

    // With the token sent too, everything but the fee goes, and nothing stays.
    let spend =
        build::transfer_most(&w.chain, &inputs, &to, &tokens(5), &w.owner, w.signer).unwrap();
    let built = measured(&w, spend).unwrap();
    assert_eq!(built.rest_lovelace, Some(28_000_000 - built.fee.total));
    assert_eq!(
        outputs(&built, w.sk),
        vec![(28_000_000 - built.fee.total, 5, Some(false))]
    );
}

#[test]
fn an_amount_the_guessed_fee_refuses_is_measured_and_paid_up_to_max() {
    let w = world();
    let bob = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    let available = t05(&w);
    let (inputs, _) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
    let most = measured(
        &w,
        build::transfer_most(&w.chain, &inputs, &bob, &Assets::new(), &w.owner, w.signer).unwrap(),
    )
    .unwrap()
    .rest_lovelace
    .unwrap();

    // A hair under Max: the guessed budgets call it short, as the old check did (T05's 26.07 ₳)…
    let pay = |lovelace| {
        build::transfer_from(
            &w.chain,
            &inputs,
            &[Payment {
                register: bob.clone(),
                lovelace,
                tokens: Assets::new(),
            }],
            &w.owner,
            w.signer,
        )
        .unwrap()
    };
    let e = pay(most - 5_000).estimate().err().unwrap();
    assert!(build::is_short(&e), "{e}");
    let e = build::transfer(
        &w.chain,
        &available,
        &[Payment {
            register: bob.clone(),
            lovelace: most - 5_000,
            tokens: Assets::new(),
        }],
        &w.owner,
        w.signer,
    )
    .err()
    .unwrap();
    assert!(build::is_short(&e), "{e}");
    // …and measured, it pays, the token kept with at least its minimum.
    let built = measured(&w, pay(most - 5_000)).unwrap();
    let kept = build::minimum_deposit(&w.chain.params, &tokens(5)).unwrap();
    assert!(built.change_lovelace >= kept);
    assert_eq!(
        built.change_lovelace,
        28_000_000 - (most - 5_000) - built.fee.total
    );
    // More than Max is short, measured too.
    let e = measured(&w, pay(most + 5_000)).err().unwrap();
    assert!(build::is_short(&e), "{e}");
}

#[test]
fn what_stays_may_be_odd_when_the_guess_calls_an_amount_short() {
    // ADA alone, so nothing need stay: the measuring draft's fee is all that's left. Rounded down to even, it
    // left a lovelace of change, never valid, and an amount leaving an odd remainder the guessed fee calls short
    // was refused, its message saying what stays would be too little (cross-area review).
    let w = world();
    let bob = Register::create(random_scalar())
        .unwrap()
        .rerandomize()
        .unwrap();
    let inputs = vec![
        owned(&w, 0x01, 25_000_000, 0),
        owned(&w, 0x02, 3_000_000, 0),
    ];
    let pay = |lovelace: u64| {
        build::transfer_from(
            &w.chain,
            &inputs,
            &[Payment {
                register: bob.clone(),
                lovelace,
                tokens: Assets::new(),
            }],
            &w.owner,
            w.signer,
        )
        .unwrap()
    };
    let least = build::minimum_deposit(&w.chain.params, &Assets::new()).unwrap();
    // What stays before the fee, past the least that can: an even remainder the guess calls short and the measured
    // fee pays, and the odd one beside it, a lovelace more.
    let mut odd = 0;
    for extra in (0..400_000u64).step_by(2_000) {
        let even = least + extra;
        if pay(28_000_000 - even).estimate().is_ok()
            || measured(&w, pay(28_000_000 - even)).is_err()
        {
            continue;
        }
        let left = even + 1;
        let built = measured(&w, pay(28_000_000 - left))
            .unwrap_or_else(|e| panic!("an odd remainder of {left} is refused: {e}"));
        assert_eq!(built.change_lovelace, left - built.fee.total);
        assert!(built.change_lovelace >= least);
        odd += 1;
    }
    assert!(
        odd > 0,
        "the guess called nothing short that the measured fee pays"
    );
}

#[test]
fn max_to_an_address_keeps_the_tokens_it_isnt_sending() {
    let w = world();
    let to: Address = ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(Hasher::<224>::hash(b"someone")),
        ShelleyDelegationPart::Null,
    )
    .into();
    let available = t05(&w);
    let (inputs, _) = build::max_inputs(&available, &Assets::new(), 20).unwrap();
    let spend =
        build::sweep_most(&w.chain, &inputs, &to, &Assets::new(), &w.owner, w.signer).unwrap();
    let built = measured(&w, spend).unwrap();
    let kept = build::minimum_deposit(&w.chain.params, &tokens(5)).unwrap();
    let paid = built.rest_lovelace.unwrap();
    assert_eq!(paid, 28_000_000 - built.fee.total - kept);
    let mut outs = outputs(&built, w.sk);
    outs.sort();
    assert_eq!(outs, vec![(kept, 5, Some(true)), (paid, 0, None)]);

    // An amount a hair under it, measured, pays too: several addresses, exactly these inputs.
    let half = paid / 2;
    let payments = [
        AddressPayment {
            to: to.clone(),
            lovelace: half,
            tokens: Assets::new(),
        },
        AddressPayment {
            to: to.clone(),
            lovelace: paid - half - 10_000,
            tokens: Assets::new(),
        },
    ];
    let spend = build::sweep_many_from(&w.chain, &inputs, &payments, &w.owner, w.signer).unwrap();
    assert!(build::is_short(&spend.estimate().err().unwrap()));
    let built = measured(&w, spend).unwrap();
    assert!(built.change_lovelace >= kept);

    // A script address can't be paid what's left.
    let script: Address = wallet_contract(true, w.chain.config.contract.wallet_contract_hash);
    let e = build::sweep_most(
        &w.chain,
        &inputs,
        &script,
        &Assets::new(),
        &w.owner,
        w.signer,
    )
    .err()
    .unwrap();
    assert!(e.to_string().contains("normal preprod address"), "{e}");
}
