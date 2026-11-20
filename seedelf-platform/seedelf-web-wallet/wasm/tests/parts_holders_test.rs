//! A payment in parts by history takes the UTxOs holding the token it sends as the box rule takes them for the whole
//! payment (`token_group`, `build::holding_by_rule`): 1.9.3's review of chunk 52, r3#1. Both pins failed on chunk 52's
//! code and pass on 1.9.2.

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_koios::koios::{Asset as Held, ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{self, ClassIn, SeedelfPayment, TokenAmount, TransferRequest};
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

fn base() -> UtxoResponse {
    serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"][0].clone(),
    )
    .unwrap()
}

/// UTxO `n`: `lovelace` more than the least its `tokens` need in one output.
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
    let least = if tokens.is_empty() {
        0
    } else {
        wallet_minimum_lovelace_with_assets(&pp, held).unwrap()
    };
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

fn token(i: u64, quantity: u64) -> TokenAmount {
    TokenAmount {
        policy_id: format!("{:056x}", 0xabc0_0000 + i),
        asset_name: format!("{:064x}", 0x1000 + i),
        quantity: quantity.to_string(),
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Made {
    Own,
    Mixed,
    Plain,
    Unknown,
}

fn class_in(made: Made, u: &UtxoResponse) -> ClassIn {
    let (id, origin) = match made {
        Made::Own => ("public:0".to_string(), "own"),
        Made::Mixed => (format!("box:{}", u.tx_hash), "mixed"),
        Made::Plain => (format!("box:{}", u.tx_hash), "lovejoin"),
        Made::Unknown => (format!("box:{0}+unknown:{0}", u.tx_hash), "lovejoin"),
    };
    ClassIn {
        id,
        origin: origin.into(),
    }
}

fn transfer(
    rows: &[(UtxoResponse, Made)],
    lovelace: Option<u64>,
    tokens: Vec<TokenAmount>,
) -> TransferRequest {
    let r = fixture("../extension/tests/fixtures/transfer-preprod.json");
    TransferRequest {
        network: "preprod".into(),
        params: params(),
        utxos: rows.iter().map(|(u, _)| u.clone()).collect(),
        payments: vec![SeedelfPayment {
            to: r["to"].as_str().unwrap().into(),
            recipient: serde_json::from_value(r["recipient"].clone()).unwrap(),
            lovelace: lovelace.map(|l| l.to_string()),
            tokens,
        }],
        classes: rows
            .iter()
            .map(|(u, m)| (format!("{}#{}", u.tx_hash, u.tx_index), class_in(*m, u)))
            .collect(),
        carry: false,
        most: false,
        seed: None,
        evaluation: None,
    }
}

/// What the parts merge, by kind, over the whole payment, and what their fees total.
fn tally(rows: &[(UtxoResponse, Made)], parts: &[api::TransferResult]) -> ([usize; 4], u64) {
    let mut count = [0usize; 4];
    for p in parts {
        for i in &p.inputs {
            if let Some((_, m)) = rows
                .iter()
                .find(|(u, _)| u.tx_hash == i.tx_hash && u.tx_index == i.tx_index)
            {
                count[*m as usize] += 1;
            }
        }
    }
    let fees = parts
        .iter()
        .map(|p| p.fee.total.parse::<u64>().unwrap())
        .sum();
    (count, fees)
}

/// A Send of 1,000 T and 400 ₳ from 25 mixed ways back of 1 T each, one way back of unknown making holding 1,000 T,
/// all at 4.5 ₳, and 60 UTxOs of 10 ₳ made private: one transaction can't spend it, so it goes in parts. The rule's
/// holders for the whole payment are the one box of unknown making alone (no fewer of unknown making hold it, and then
/// as few boxes), so the parts merge that box and no other, in 2 parts, as 1.9.2's did. Chunk 52's parts took every
/// mixed box first, a part's room of them: 21 boxes in 3 parts.
#[test]
fn a_payment_in_parts_merges_only_the_box_the_rules_holders_need() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let t = token(9, 1);
    let mut rows: Vec<(UtxoResponse, Made)> = (1..=25)
        .map(|i| {
            (
                UtxoResponse {
                    value: "4500000".into(),
                    ..utxo(i, 0, std::slice::from_ref(&t))
                },
                Made::Mixed,
            )
        })
        .collect();
    let big = TokenAmount {
        quantity: "1000".into(),
        ..t.clone()
    };
    rows.push((
        UtxoResponse {
            value: "4500000".into(),
            ..utxo(500, 0, std::slice::from_ref(&big))
        },
        Made::Unknown,
    ));
    for i in 0..60 {
        rows.push((utxo(1_000 + i, 10_000_000, &[]), Made::Own));
    }
    let tokens = vec![TokenAmount {
        quantity: "1000".into(),
        ..t
    }];
    let parts = api::build_transfer_parts(sk, transfer(&rows, Some(400_000_000), tokens)).unwrap();
    let (count, fees) = tally(&rows, &parts);
    assert_eq!(
        (
            count[Made::Mixed as usize]
                + count[Made::Plain as usize]
                + count[Made::Unknown as usize],
            parts.len()
        ),
        (1, 2),
        "boxes merged and parts; merged {count:?} (own, mixed, plain, unknown), fees {fees}"
    );
}

/// A Send of 4,500 T and 400 ₳, the token spread over 300 UTxOs made private holding 1 T each at its least and 5 mixed
/// boxes of 1,000 T; the ADA in 60 UTxOs of 10 ₳ made private and 20 boxes of 12 ₳ of unknown making. The rule's
/// holders for the whole payment are the 5 boxes (the others hold 300), so the parts take them first: 2 parts, as
/// 1.9.2's. Chunk 52's took the thin ones first, a part's room at a time: 7 parts and 3.4 times the fees.
#[test]
fn a_payment_in_parts_of_a_token_spread_thin_takes_the_rules_boxes_first() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let t = token(7, 1);
    let mut rows: Vec<(UtxoResponse, Made)> = Vec::new();
    let mut n = 0u64;
    let mut next = || {
        n += 1;
        n
    };
    for _ in 0..300 {
        rows.push((utxo(next(), 0, std::slice::from_ref(&t)), Made::Own));
    }
    let big = TokenAmount {
        quantity: "1000".into(),
        ..t.clone()
    };
    for _ in 0..5 {
        rows.push((utxo(next(), 0, std::slice::from_ref(&big)), Made::Mixed));
    }
    for _ in 0..60 {
        rows.push((utxo(next(), 10_000_000, &[]), Made::Own));
    }
    for _ in 0..20 {
        rows.push((utxo(next(), 12_000_000, &[]), Made::Unknown));
    }
    let tokens = vec![TokenAmount {
        quantity: "4500".into(),
        ..t
    }];
    let parts = api::build_transfer_parts(sk, transfer(&rows, Some(400_000_000), tokens)).unwrap();
    let (count, fees) = tally(&rows, &parts);
    assert_eq!(
        parts.len(),
        2,
        "merged {count:?} (own, mixed, plain, unknown), fees {fees}"
    );
}
