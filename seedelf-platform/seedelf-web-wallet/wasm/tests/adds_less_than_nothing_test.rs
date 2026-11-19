//! Chunk 51, r2a#3, the WebAssembly side. A UTxO adds less than nothing to a payment when its tokens need more ADA kept
//! with them in the Seedelf balance (20 to an output) than it holds (`seedelf_core::build::adds`): a stranger's pile of
//! tokens at the least one output of them needs, say. Wherever the wallet picks it comes after everything else, so an
//! amount never needs it. The shortfall's figure ("up to about X ₳", the worker's `privateShortOf`) is built without it
//! (`most`), so an amount up to that figure goes, measured without it first where the guessed budgets call it short
//! (`measured_or_more`); and Max, which spends every UTxO, takes it after a UTxO that adds exactly nothing.

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build;
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_koios::koios::{Asset as Held, ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{self, OutRef, TransferRequest, WithdrawRequest};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADA: u64 = 1_000_000;

fn fixture(path: &str) -> Value {
    let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn params() -> Value {
    fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
}

fn pp() -> ProtocolParameters {
    ProtocolParameters::from_koios(&params()).unwrap()
}

/// The phrase's 25 ADA contract UTxO: every UTxO here is a copy of it, its own outpoint.
fn base() -> UtxoResponse {
    serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"][0].clone(),
    )
    .unwrap()
}

/// A token: (policy, name), both hex.
type Token = (String, String);

/// UTxO `n`: `extra` lovelace more than the least one output of its `tokens` needs, one of each.
fn utxo(n: u64, extra: u64, tokens: &[Token]) -> UtxoResponse {
    let held = tokens.iter().fold(Assets::new(), |all, (policy, name)| {
        all.add(Asset::new(policy.clone(), name.clone(), 1).unwrap())
            .unwrap()
    });
    let least = wallet_minimum_lovelace_with_assets(&pp(), held).unwrap();
    UtxoResponse {
        tx_hash: format!("{n:064x}"),
        value: (least + extra).to_string(),
        asset_list: Some(
            tokens
                .iter()
                .map(|(policy, name)| Held {
                    decimals: 0,
                    quantity: "1".into(),
                    policy_id: policy.clone(),
                    asset_name: name.clone(),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..base()
    }
}

/// `count` tokens under policy `p`, one-byte names from `first`.
fn tokens(p: u64, first: u8, count: u8) -> Vec<Token> {
    (first..first + count)
        .map(|i| (format!("{p:056x}"), hex::encode([i])))
        .collect()
}

/// A stranger's pile: 200 tokens at the least one output of them needs, where change holds 20 to an output.
fn pile(n: u64) -> UtxoResponse {
    let all: Vec<Token> = (0..200u8)
        .map(|i| (format!("{:056x}", 0xdead_u64), hex::encode([i])))
        .collect();
    utxo(n, 0, &all)
}

fn theirs() -> String {
    fixture("../../seedelf-crypto/tests/vectors/cardano_account.json")["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
        .unwrap()["preprod"]["receive_0"]
        .as_str()
        .unwrap()
        .to_string()
}

/// Paying the recorded Seedelf, as the worker asks it: `lovelace` null is Max; `most`, the shortfall's figure.
fn transfer(utxos: &[UtxoResponse], lovelace: Option<u64>, most: bool) -> TransferRequest {
    let r = fixture("../extension/tests/fixtures/transfer-preprod.json");
    serde_json::from_value(json!({
        "network": "preprod",
        "params": params(),
        "utxos": utxos,
        "payments": [{
            "to": r["to"],
            "recipient": r["recipient"],
            "lovelace": lovelace.map(|l| l.to_string()),
            "tokens": [],
        }],
        "most": most,
    }))
    .unwrap()
}

/// Making public to an address, as the worker asks it.
fn withdraw(utxos: &[UtxoResponse], lovelace: Option<u64>, most: bool) -> WithdrawRequest {
    serde_json::from_value(json!({
        "network": "preprod",
        "params": params(),
        "utxos": utxos,
        "payments": [{ "to": theirs(), "lovelace": lovelace.map(|l| l.to_string()), "tokens": [] }],
        "most": most,
    }))
    .unwrap()
}

fn spends(inputs: &[&OutRef], u: &UtxoResponse) -> bool {
    inputs
        .iter()
        .any(|i| i.tx_hash == u.tx_hash && i.tx_index == u.tx_index)
}

/// Each part's inputs, and what the parts pay the recipient.
fn of_transfer(parts: &[api::TransferResult]) -> (Vec<&OutRef>, u64) {
    let paid = parts
        .iter()
        .map(|p| p.payments[0].lovelace.parse::<u64>().unwrap())
        .sum();
    (parts.iter().flat_map(|p| &p.inputs).collect(), paid)
}

fn of_withdraw(parts: &[api::WithdrawResult]) -> (Vec<&OutRef>, u64) {
    let paid = parts
        .iter()
        .map(|p| p.payments[0].lovelace.parse::<u64>().unwrap())
        .sum();
    (parts.iter().flat_map(|p| &p.inputs).collect(), paid)
}

#[test]
fn the_shortfalls_figure_leaves_out_a_utxo_that_adds_less_than_nothing_and_an_amount_up_to_it_goes()
{
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    // 20 ₳, a token kept at its least and 1.5 ₳ more, and a stranger's pile, which adds less than nothing.
    let stranger = pile(4);
    let utxos = vec![
        utxo(1, 10 * ADA, &[]),
        utxo(2, 10 * ADA, &[]),
        utxo(3, 1_500_000, &tokens(0xabc, 0, 1)),
        stranger.clone(),
    ];
    assert!(build::adds(&pp(), &stranger).unwrap() < -10 * ADA as i128);
    // What the three that add something pay, fees aside: all their ADA but the least the kept token needs.
    let value = |u: &UtxoResponse| u.value.parse::<u64>().unwrap();
    let upper: u64 = utxos[..3].iter().map(value).sum::<u64>() - (value(&utxos[2]) - 1_500_000);
    let near = |most: u64| most <= upper && most + ADA > upper;

    // Paying a Seedelf. Max spends every UTxO, the pile too, and keeps its tokens' least.
    let max = api::build_transfer_parts(sk, transfer(&utxos, None, false)).unwrap();
    let (spent, max_paid) = of_transfer(&max);
    assert!(spends(&spent, &stranger));
    // The figure an amount that's too much is told: what an amount can pay, which never needs the pile.
    let figure = api::build_transfer_parts(sk, transfer(&utxos, None, true)).unwrap();
    let (spent, most) = of_transfer(&figure);
    assert!(
        !spends(&spent, &stranger) && near(most) && most > max_paid + 10 * ADA,
        "the figure spent the pile ({}) and said {most}, against Max's {max_paid} and {upper} fees aside",
        spends(&spent, &stranger)
    );
    // An amount up to it goes, without the pile: picking's guessed budgets call it short, and it's measured.
    let amount = most - 5_000;
    let paid = api::build_transfer_parts(sk, transfer(&utxos, Some(amount), false))
        .unwrap_or_else(|e| panic!("{amount} under the figure {most} was refused: {e}"));
    let (spent, sent) = of_transfer(&paid);
    assert!(!spends(&spent, &stranger) && sent == amount);

    // Making it public: the same. Everything spends every UTxO and sends every token, the pile's with it.
    let everything = api::build_withdraw_parts(sk, withdraw(&utxos, None, false)).unwrap();
    let (spent, _) = of_withdraw(&everything);
    assert!(spends(&spent, &stranger));
    let figure = api::build_withdraw_parts(sk, withdraw(&utxos, None, true)).unwrap();
    let (spent, most) = of_withdraw(&figure);
    assert!(
        !spends(&spent, &stranger) && near(most),
        "the figure spent the pile ({}) and said {most}, against {upper} fees aside",
        spends(&spent, &stranger)
    );
    let amount = most - 5_000;
    let paid = api::build_withdraw_parts(sk, withdraw(&utxos, Some(amount), false))
        .unwrap_or_else(|e| panic!("{amount} under the figure {most} was refused: {e}"));
    let (spent, sent) = of_withdraw(&paid);
    assert!(!spends(&spent, &stranger) && sent == amount);
}

#[test]
fn max_in_parts_takes_a_utxo_that_adds_less_than_nothing_after_one_that_adds_nothing() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    // The pile first, then two bundles of 20 tokens at exactly their least, then 18 UTxOs of ADA: one more than a
    // transaction spends.
    let stranger = pile(1);
    let mut utxos = vec![
        stranger.clone(),
        utxo(2, 0, &tokens(0xb1, 0, 20)),
        utxo(3, 0, &tokens(0xb2, 0, 20)),
    ];
    utxos.extend((10..28).map(|n| utxo(n, 5 * ADA, &[])));
    for u in &utxos[1..3] {
        assert_eq!(build::adds(&pp(), u).unwrap(), 0);
    }

    let parts = api::build_transfer_parts(sk, transfer(&utxos, None, false)).unwrap();
    let (spent, _) = of_transfer(&parts);
    // Max spends every UTxO, the pile in its last part.
    assert!(utxos.iter().all(|u| spends(&spent, u)));
    assert!(parts.len() > 1);
    let first: Vec<&OutRef> = parts[0].inputs.iter().collect();
    assert!(
        !spends(&first, &stranger),
        "the first part spent the pile, ahead of a bundle that adds nothing"
    );
}
