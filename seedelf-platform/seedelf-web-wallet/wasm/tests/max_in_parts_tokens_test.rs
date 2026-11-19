//! Chunk 51, w1a#1: Max in parts (`build_transfer_parts`, a single payment with `lovelace` null) goes straight to
//! `max_in_parts`, which never checks that the tokens it's asked to send are in the UTxOs it's given. The Send
//! form offers a token's whole held figure (`unlocked(balances.seedelf)`), which counts UTxOs a chain being sent
//! has reserved; `readContract` leaves those out of `utxos`. Asked for more of a token than `utxos` hold, a part
//! with no holder left picks nothing and `fit_part` bails with a plain "Not enough ADA" (not core's `NotEnough`),
//! which `max_in_parts` reads as a part that failed for its tokens: the UTxOs of ADA alone stay, blamed on a token
//! (`LeftWhy::Tokens`), or, with none of the token there, Max is refused as short of ADA. One transaction's Max
//! refuses both in words through core's `holding`.
//!
//! The right behaviour, whichever fix the owner picks: refused in words naming the token, as one transaction's
//! Max is, or built so that every UTxO of ADA alone goes (Max leaves nothing it could spend).

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_koios::koios::{Asset as Held, ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{self, SeedelfPayment, TokenAmount, TransferRequest};
use serde_json::Value;

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

fn fixture(path: &str) -> Value {
    let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn params() -> Value {
    fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
}

/// The phrase's 25 ADA contract UTxO: every UTxO here is a copy of it, its own outpoint.
fn base() -> UtxoResponse {
    serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"][0].clone(),
    )
    .unwrap()
}

/// UTxO `n`: `lovelace` more than the least its `tokens` need in one output (api_test's `parts_of_any_shape`).
fn utxo(n: u64, lovelace: u64, tokens: &[TokenAmount]) -> UtxoResponse {
    let pp = ProtocolParameters::from_koios(&params()).unwrap();
    let held = tokens.iter().fold(Assets::new(), |all, t| {
        all.add(
            Asset::new(
                t.policy_id.clone(),
                t.asset_name.clone(),
                t.quantity.parse().unwrap(),
            )
            .unwrap(),
        )
        .unwrap()
    });
    let least = wallet_minimum_lovelace_with_assets(&pp, held).unwrap();
    UtxoResponse {
        tx_hash: format!("{n:064x}"),
        value: (least + lovelace).to_string(),
        asset_list: Some(
            tokens
                .iter()
                .map(|t| Held {
                    decimals: 0,
                    quantity: t.quantity.clone(),
                    policy_id: t.policy_id.clone(),
                    asset_name: t.asset_name.clone(),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..base()
    }
}

/// Token T, `quantity` of it.
fn t(quantity: u64) -> TokenAmount {
    TokenAmount {
        policy_id: format!("{:056x}", 0xabc0_0000u64),
        asset_name: format!("{:064x}", 0x1000u64),
        quantity: quantity.to_string(),
    }
}

fn ada(first: u64, n: u64, lovelace: u64) -> Vec<UtxoResponse> {
    (first..first + n).map(|i| utxo(i, lovelace, &[])).collect()
}

fn transfer(utxos: Vec<UtxoResponse>, tokens: Vec<TokenAmount>) -> TransferRequest {
    let r = fixture("../extension/tests/fixtures/transfer-preprod.json");
    TransferRequest {
        network: "preprod".into(),
        params: params(),
        utxos,
        payments: vec![SeedelfPayment {
            to: r["to"].as_str().unwrap().into(),
            recipient: serde_json::from_value(r["recipient"].clone()).unwrap(),
            // Max.
            lovelace: None,
            tokens,
        }],
        classes: Default::default(),
        carry: false,
        most: false,
        seed: None,
        evaluation: None,
    }
}

/// What's wrong with Max in parts over `utxos`, asked for 15 T: `None` when it's refused in words naming the
/// token, or built with every UTxO of ADA alone spent.
fn wrong(case: &str, sk: blstrs::Scalar, utxos: &[UtxoResponse]) -> Option<String> {
    let policy = t(0).policy_id;
    match api::build_transfer_parts(sk, transfer(utxos.to_vec(), vec![t(15)])) {
        Err(e) => {
            let e = e.to_string();
            (e.contains("Not enough ADA") || !e.contains(&policy)).then(|| {
                format!(
                    "{case}: Max in parts refused as {e:?}, though {} UTxOs of ADA alone are there",
                    utxos.len()
                )
            })
        }
        Ok(parts) => {
            let spent: Vec<&api::OutRef> = parts.iter().flat_map(|p| &p.inputs).collect();
            let ada_left: Vec<&UtxoResponse> = utxos
                .iter()
                .filter(|u| u.asset_list.iter().flatten().next().is_none())
                .filter(|u| {
                    !spent
                        .iter()
                        .any(|i| i.tx_hash == u.tx_hash && i.tx_index == u.tx_index)
                })
                .collect();
            if ada_left.is_empty() {
                return None;
            }
            let last = parts.last().unwrap();
            let paid: u64 = parts
                .iter()
                .map(|p| p.payments[0].lovelace.parse::<u64>().unwrap())
                .sum();
            let tokens: Vec<String> = parts
                .iter()
                .flat_map(|p| p.payments[0].tokens.iter().map(|x| x.quantity.clone()))
                .collect();
            let stranded: u64 = ada_left
                .iter()
                .map(|u| u.value.parse::<u64>().unwrap())
                .sum();
            Some(format!(
                "{case}: Max in parts went as {} part(s) paying {paid} lovelace and T {tokens:?}, and left {} UTxOs \
                 of ADA alone ({stranded} lovelace) unspent; the last part says left = {}, left_why = {:?}",
                parts.len(),
                ada_left.len(),
                last.left,
                last.left_why,
            ))
        }
    }
}

#[test]
fn max_in_parts_asked_for_more_of_a_token_than_its_utxos_hold_is_refused_for_the_token_or_spends_the_ada()
 {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let mut problems = Vec::new();

    // A: 10 T spendable (5 more held by a chain being sent, so the form offers 15), and 25 UTxOs of 10 ₳ alone.
    let mut some = vec![utxo(1, 1_000_000, &[t(10)])];
    some.extend(ada(100, 25, 10_000_000));
    // One transaction's Max refuses it in words, through core's `holding`.
    let one = api::build_transfer(sk, transfer(some.clone(), vec![t(15)]))
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        one.contains("holds only 10 of the token"),
        "one transaction's Max: {one:?}"
    );
    problems.extend(wrong("A (10 of 15 T spendable)", sk, &some));

    // B: none of T spendable (all of it held by a chain being sent), and the same 25 UTxOs of ADA alone.
    let none = ada(100, 25, 10_000_000);
    let one = api::build_transfer(sk, transfer(none.clone(), vec![t(15)]))
        .err()
        .map(|e| e.to_string())
        .unwrap_or_default();
    assert!(
        one.contains("doesn't hold the token"),
        "one transaction's Max: {one:?}"
    );
    problems.extend(wrong("B (no T spendable)", sk, &none));

    assert!(problems.is_empty(), "\n{}", problems.join("\n"));
}

/// Chunk 51, w1a#1's other half: a part that picks nothing (none of what's left holds a token still owed) has an error
/// of its own, so Max in parts never leaves the UTxOs of ADA alone put down to tokens (`LeftWhy::Tokens`), nor calls
/// the ask short of ADA. Make public's figure (`most`, its tokens named) asks no holding check first, so it reaches
/// that part: in A it went as one part and left the 25 UTxOs of ADA alone put down to tokens, in B it was refused as
/// "Not enough ADA".
#[test]
fn a_part_that_picks_nothing_is_refused_never_put_down_to_tokens_or_to_ada() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let to = fixture("../../seedelf-crypto/tests/vectors/cardano_account.json")["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
        .unwrap()["preprod"]["receive_0"]
        .clone();
    let mut some = vec![utxo(1, 1_000_000, &[t(10)])];
    some.extend(ada(100, 25, 10_000_000));
    let none = ada(100, 25, 10_000_000);
    for (case, utxos) in [("A (10 of 15 T)", some), ("B (no T)", none)] {
        let request: seedelf_wasm::api::WithdrawRequest =
            serde_json::from_value(serde_json::json!({
                "network": "preprod",
                "params": params(),
                "utxos": utxos,
                "payments": [{ "to": to, "lovelace": null, "tokens": [t(15)] }],
                "most": true,
            }))
            .unwrap();
        match api::build_withdraw_parts(sk, request) {
            Ok(parts) => {
                let last = parts.last().unwrap();
                panic!(
                    "{case}: went as {} part(s), the last leaving {} put down to {:?}",
                    parts.len(),
                    last.left,
                    last.left_why
                );
            }
            Err(e) => {
                let e = e.to_string();
                assert!(
                    e.contains("holds the tokens this payment still sends")
                        && !e.contains("Not enough ADA"),
                    "{case}: {e}"
                );
            }
        }
    }
}
