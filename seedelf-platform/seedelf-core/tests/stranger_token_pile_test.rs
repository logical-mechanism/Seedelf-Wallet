//! Chunk 51, finding r2a#3: a stranger's many-token UTxO costs several times
//! its ADA once its tokens go back as change 20 to an output (build.rs
//! `token_chunks`, `deposit_outputs`, `minimum_deposit`), and history-aware
//! selection (`apart`, order a) takes it, a Received payment of tier 0, ahead
//! of the boxes, so a payment that money without it pays spends it, ties the
//! user's own ADA to the stranger's tokens as their least, and merges more
//! boxes than the payment needs.
//!
//! The state: 20 ₳ made private (Own), four boxes back from Lovejoin, and a
//! stranger's payment of 200 tokens (one policy, 1-byte names) holding the
//! least the ledger takes for it at the contract's address (Received). Make
//! public 35 ₳ to an address (Purpose::Pay, `sweep_many_apart`, the web
//! wallet's `build_withdraw` for an amount).

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_txbuilder::Output;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build::{self, AddressPayment, Chain, Class, Histories, Origin, Purpose};
use seedelf_core::constants::OVERHEAD_COST;
use seedelf_core::constants::get_config;
use seedelf_core::transaction::calculate_min_required_utxo;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset as KoiosAsset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
/// About what a box back from Lovejoin brings: 10 ₳ less the withdraw's fee.
const BOX: u64 = 9_710_000;
const ADA: u64 = 1_000_000;
/// What re-making a bundle may cost beyond its own least: the wallet sizes a
/// contract output at a base address (about 0.12 ₳ more, known).
const PREMIUM: u64 = 250_000;

fn chain() -> Chain {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    Chain {
        params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
        network_flag: true,
        config: get_config(1, true).unwrap(),
    }
}

struct World {
    chain: Chain,
    owner: Register,
    wallet: Address,
    signer: Hash<28>,
}

fn world() -> World {
    let chain = chain();
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key).public_key().as_ref()),
    }
}

/// A wallet-contract UTxO owned by `w`, made by the transaction `[a, b; 32]`,
/// holding one of each token named in `names` (raw bytes), as Koios lists it.
fn owned(w: &World, a: u8, b: u8, lovelace: u64, names: &[Vec<u8>]) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    let mut hash = [a; 32];
    hash[31] = b;
    UtxoResponse {
        tx_hash: hex::encode(hash),
        tx_index: 0,
        address: w.wallet.to_bech32().unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(w.chain.config.contract.wallet_contract_hash),
        inline_datum: Some(InlineDatum {
            bytes: hex::encode(register.to_vec().unwrap()),
            value: json!({
                "constructor": 0,
                "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
            }),
        }),
        asset_list: Some(
            names
                .iter()
                .map(|name| KoiosAsset {
                    decimals: 0,
                    quantity: "1".to_string(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

/// The least the ledger takes for one output at the contract's address
/// holding one of each of `names` under an inline register: what a stranger
/// pays the Seedelf, at the least.
fn least_on_chain(w: &World, names: &[Vec<u8>]) -> u64 {
    let policy: [u8; 28] = hex::decode(TOKEN_POLICY).unwrap().try_into().unwrap();
    let register = w.owner.clone().rerandomize().unwrap();
    let mut output =
        Output::new(w.wallet.clone(), 5_000_000).set_inline_datum(register.to_vec().unwrap());
    for name in names {
        output = output
            .add_asset(Hash::new(policy), name.clone(), 1)
            .unwrap();
    }
    calculate_min_required_utxo(output, &w.chain.params).unwrap()
}

fn class(id: &str, origin: Origin) -> Class {
    Class {
        id: id.into(),
        origin,
    }
}

fn pay(lovelace: u64) -> Vec<AddressPayment> {
    vec![AddressPayment {
        to: ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Null,
        )
        .into(),
        lovelace,
        tokens: Assets::new(),
    }]
}

fn same(a: &UtxoResponse, b: &UtxoResponse) -> bool {
    a.tx_hash == b.tx_hash && a.tx_index == b.tx_index
}

/// What `inputs` do with the payment, estimated: built, or why not.
fn tried(w: &World, inputs: &[UtxoResponse], payment: &[AddressPayment]) -> String {
    match build::sweep_many_from(&w.chain, inputs, payment, &w.owner, w.signer)
        .and_then(|s| s.estimate())
    {
        Ok(f) => format!(
            "builds: fee {}, change {} lovelace in {} outputs, {} tokens kept",
            f.fee.total,
            f.change_lovelace,
            f.change_outputs,
            f.change_tokens.items.len()
        ),
        Err(e) => format!("refused (is_short = {}): {e}", build::is_short(&e)),
    }
}

#[test]
fn a_strangers_bundle_that_costs_more_than_it_holds_is_not_spent_where_money_without_it_pays() {
    let w = world();
    let names: Vec<Vec<u8>> = (0..200u16).map(|i| vec![i as u8]).collect();
    let d_least = least_on_chain(&w, &names);

    let o1 = owned(&w, 0x01, 0, 20 * ADA, &[]);
    let d = owned(&w, 0xd0, 0, d_least, &names);
    let boxes: Vec<UtxoResponse> = (0..4).map(|i| owned(&w, 0xb0, i, BOX, &[])).collect();
    let available: Vec<UtxoResponse> = [o1.clone(), d.clone()]
        .into_iter()
        .chain(boxes.iter().cloned())
        .collect();
    // As the extension classes them (activity.ts `classes`): money made
    // private, a stranger's payment received, each box its own.
    let h = boxes.iter().fold(
        Histories::new(Purpose::Pay)
            .with(&o1.tx_hash, 0, class("public", Origin::Own))
            .with(
                &d.tx_hash,
                0,
                class(&format!("received:{}", d.tx_hash), Origin::Received),
            ),
        |h, b| {
            h.with(
                &b.tx_hash,
                0,
                class(&format!("box:{}", b.tx_hash), Origin::Lovejoin),
            )
        },
    );
    let payment = pay(35 * ADA);

    // D's tokens as change, 20 to an output, need far more than D holds.
    let d_tokens = names.iter().fold(Assets::new(), |all, n| {
        all.add(Asset::new(TOKEN_POLICY.to_string(), hex::encode(n), 1).unwrap())
            .unwrap()
    });
    let kept = build::minimum_deposit(&w.chain.params, &d_tokens).unwrap();
    println!("D holds {d_least} lovelace, its least on chain; its tokens as change need {kept}");

    // The trace of history order a ([O1, D, B1, B2, B3, B4]), grown one at a time.
    let label = |u: &UtxoResponse| {
        if same(u, &o1) {
            "O1".to_string()
        } else if same(u, &d) {
            "D".to_string()
        } else {
            format!("B{}", boxes.iter().position(|b| same(b, u)).unwrap() + 1)
        }
    };
    for k in 4..=6 {
        let set = &available[..k];
        let names: Vec<String> = set.iter().map(label).collect();
        println!("{}: {}", names.join(" + "), tried(&w, set, &payment));
    }

    // Money without D pays it, with change of ADA alone.
    let without = vec![o1.clone(), boxes[0].clone(), boxes[1].clone()];
    println!("O1 + B1 + B2: {}", tried(&w, &without, &payment));
    let paid = build::sweep_many_from(&w.chain, &without, &payment, &w.owner, w.signer)
        .unwrap()
        .estimate()
        .expect("O1 + B1 + B2 pay 35 ₳");
    assert!(paid.change_tokens.is_empty());

    // What the history-aware selection builds.
    let spend = build::sweep_many_apart(&w.chain, &available, &h, &payment, &w.owner, w.signer)
        .expect("the payment is made");
    let spent = spend.inputs();
    let finished = spend.estimate().unwrap();
    let spent_names: Vec<String> = spent.iter().map(label).collect();
    let boxes_spent = spent
        .iter()
        .filter(|u| boxes.iter().any(|b| same(b, u)))
        .count();
    let tx = pallas_traverse::MultiEraTx::decode(&finished.tx.tx_bytes.0).unwrap();
    // The ADA that can't leave the stranger's tokens: the least the ledger
    // takes for each output holding them, as built.
    let coins = w.chain.params.coins_per_utxo_size;
    let mut tied = 0u64;
    let mut held = 0u64;
    let mut token_outputs = 0usize;
    let mut at_least = 0usize;
    for output in tx.outputs() {
        if output.value().assets().is_empty() {
            continue;
        }
        let least = (OVERHEAD_COST + output.encode().len() as u64) * coins;
        let wallet_least = least + 28 * coins; // sized at a base address
        token_outputs += 1;
        tied += least;
        held += output.value().coin();
        if output.value().coin() == wallet_least {
            at_least += 1;
        }
    }
    println!(
        "sweep_many_apart spends {} ({boxes_spent} boxes): fee {}, change {} lovelace in {} outputs",
        spent_names.join(" + "),
        finished.fee.total,
        finished.change_lovelace,
        finished.change_outputs
    );
    println!(
        "{token_outputs} outputs hold the stranger's tokens ({at_least} at exactly the wallet's least), {held} lovelace in them; the ledger's least for them is {tied}, against the {d_least} D brought"
    );

    // Right: spending money of the user's own never ties more of it to a
    // stranger's tokens than their UTxO brought (beyond the base-address
    // premium), and merges no more boxes than the payment needs.
    let ok_money = tied <= d_least + PREMIUM;
    let ok_boxes = boxes_spent <= 2;
    assert!(
        ok_money && ok_boxes,
        "a payment O1 + B1 + B2 make spent {}: {} lovelace of the user's own now sits as the least of {} outputs of the stranger's tokens ({} where D brought {}), and {} boxes are merged where 2 pay",
        spent_names.join(" + "),
        tied.saturating_sub(d_least),
        token_outputs,
        tied,
        d_least,
        boxes_spent
    );
}
