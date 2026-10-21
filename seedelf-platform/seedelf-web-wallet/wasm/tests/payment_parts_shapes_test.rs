//! Payments in parts over UTxOs of every shape: ADA alone, a token spread thin, a pool's boxes brought back, NFTs,
//! bundles of many tokens (a move-in's, at exactly their least ADA), and a mix; each asked for amounts, amounts with
//! some or all of their tokens, Max and Everything (the owner, 1.6.0: "we dont know if it works in general for any type
//! of utxo with arbitrary amount of tokens"). Every part built is decoded and checked as the ledger would: its size,
//! each output's value, value conserved, no UTxO spent twice, exactly the tokens asked. A refusal is printed with the
//! most an amount could pay with the tokens that stay (fees aside), so one well under it stands out; Max is never
//! refused. About a minute in release:
//! `cargo test --release -p seedelf-wasm --test payment_parts_shapes_test -- --ignored --nocapture`.

use pallas_codec::minicbor;
use pallas_primitives::alonzo::{Constr, MaybeIndefArray, PlutusData};
use pallas_primitives::conway::DatumOption;
use pallas_traverse::MultiEraTx;
use seedelf_core::assets::{Asset, Assets};
use seedelf_core::build;
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{Asset as KAsset, ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{
    self, SeedelfPayment, TokenAmount, TransferRequest, WithdrawPayment, WithdrawRequest,
};
use serde_json::Value;
use std::collections::BTreeMap;

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
    let owned: Vec<UtxoResponse> = serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
    )
    .unwrap();
    owned[0].clone()
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

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo + 1)
    }
}

type Tok = (String, String);

fn policy(n: u64) -> String {
    format!("{:056x}", 0xabc0_0000_0000u64 + n)
}

fn name(n: u64, long: bool) -> String {
    if long {
        format!("{:064x}", 0x1000 + n)
    } else {
        hex::encode(format!("T{n}"))
    }
}

fn make(i: &mut u64, extra: u64, assets: &[(Tok, u64)], pp: &ProtocolParameters) -> UtxoResponse {
    *i += 1;
    let mut bundle = Assets::new();
    for ((p, n), q) in assets {
        bundle = bundle
            .add(Asset::new(p.clone(), n.clone(), *q).unwrap())
            .unwrap();
    }
    let min =
        seedelf_core::transaction::wallet_minimum_lovelace_with_assets(pp, bundle.clone()).unwrap();
    UtxoResponse {
        tx_hash: format!("{:064x}", *i),
        tx_index: 0,
        value: (min + extra).to_string(),
        asset_list: if assets.is_empty() {
            Some(vec![])
        } else {
            Some(
                assets
                    .iter()
                    .map(|((p, n), q)| KAsset {
                        decimals: 0,
                        quantity: q.to_string(),
                        policy_id: p.clone(),
                        asset_name: n.clone(),
                        fingerprint: String::new(),
                    })
                    .collect(),
            )
        },
        ..base()
    }
}

/// A wallet shape: its UTxOs, and the token the requests send ("T").
struct Shape {
    label: String,
    utxos: Vec<UtxoResponse>,
    token: Option<Tok>,
    /// Several tokens to send at once (all of each).
    several: Vec<Tok>,
}

fn shapes(pp: &ProtocolParameters) -> Vec<Shape> {
    let mut rng = Rng(0x9e3779b97f4a7c15);
    let mut out = Vec::new();
    let t: Tok = (policy(1), name(1, false));
    // 1. ADA only, many.
    for n in [30u64, 60, 120] {
        let mut i = 0;
        let utxos = (0..n)
            .map(|_| make(&mut i, rng.range(0, 60_000_000), &[], pp))
            .collect();
        out.push(Shape {
            label: format!("ada x{n}"),
            utxos,
            token: None,
            several: vec![],
        });
    }
    // 2. A token spread thin, with some ADA UTxOs.
    for (n, m, extra) in [
        (30u64, 5u64, 0u64),
        (45, 0, 3_000_000),
        (60, 30, 500_000),
        (21, 2, 0),
        (22, 0, 0),
    ] {
        let mut i = 0;
        let mut utxos: Vec<UtxoResponse> = (0..n)
            .map(|_| {
                make(
                    &mut i,
                    rng.range(0, extra),
                    &[(t.clone(), rng.range(1, 5_000_000))],
                    pp,
                )
            })
            .collect();
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(5_000_000, 80_000_000), &[], pp)));
        out.push(Shape {
            label: format!("spread T x{n} (+{extra}) + ada x{m}"),
            utxos,
            token: Some(t.clone()),
            several: vec![],
        });
    }
    // 3. Lovejoin token boxes back: 4.5 ADA + 100 MIN each, nothing else.
    for n in [42u64, 90] {
        let mut i = 0;
        let utxos = (0..n)
            .map(|_| {
                let mut u = make(&mut i, 0, &[(t.clone(), 100_000_000)], pp);
                u.value = "4500000".into();
                u
            })
            .collect();
        out.push(Shape {
            label: format!("token boxes x{n}"),
            utxos,
            token: Some(t.clone()),
            several: vec![],
        });
    }
    // 4. NFTs, one each under its own policy, at the least ADA; a few ADA UTxOs.
    for (n, m) in [(30u64, 3u64), (70, 10)] {
        let mut i = 0;
        let nfts: Vec<Tok> = (0..n).map(|k| (policy(100 + k), name(k, true))).collect();
        let mut utxos: Vec<UtxoResponse> = nfts
            .iter()
            .map(|nft| make(&mut i, 0, &[(nft.clone(), 1)], pp))
            .collect();
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(5_000_000, 50_000_000), &[], pp)));
        out.push(Shape {
            label: format!("nfts x{n} + ada x{m}"),
            utxos,
            token: Some(nfts[0].clone()),
            several: nfts,
        });
    }
    // 5. Bundles: each UTxO many distinct tokens (own policies, long names), at the least ADA, + ADA UTxOs.
    for (n, k, m) in [(25u64, 10u64, 5u64), (25, 30, 5), (40, 20, 20)] {
        let mut i = 0;
        let mut next = 0u64;
        let mut utxos = Vec::new();
        for _ in 0..n {
            let assets: Vec<(Tok, u64)> = (0..k)
                .map(|_| {
                    next += 1;
                    (
                        (policy(1000 + next), name(next, true)),
                        rng.range(1, u32::MAX as u64),
                    )
                })
                .collect();
            utxos.push(make(&mut i, rng.range(0, 1_000_000), &assets, pp));
        }
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(5_000_000, 50_000_000), &[], pp)));
        let first = utxos[0].asset_list.clone().unwrap()[0].clone();
        out.push(Shape {
            label: format!("bundles x{n} of {k} + ada x{m}"),
            utxos,
            token: Some((first.policy_id, first.asset_name)),
            several: vec![],
        });
    }
    // 6. ADA-poor holders: T plus 8 other tokens each, at the least ADA; ADA UTxOs.
    for (n, m) in [(25u64, 10u64), (20, 10), (19, 10)] {
        let mut i = 0;
        let mut next = 0u64;
        let mut utxos = Vec::new();
        for _ in 0..n {
            let mut assets: Vec<(Tok, u64)> = vec![(t.clone(), rng.range(1, 1_000_000))];
            for _ in 0..8 {
                next += 1;
                assets.push(((policy(5000 + next), name(next, true)), rng.range(1, 1000)));
            }
            utxos.push(make(&mut i, 0, &assets, pp));
        }
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(20_000_000, 60_000_000), &[], pp)));
        out.push(Shape {
            label: format!("poor holders x{n} (T + 8) + ada x{m}"),
            utxos,
            token: Some(t.clone()),
            several: vec![],
        });
    }
    // 7. Several tokens, each spread over its own 15 UTxOs, + ADA.
    {
        let mut i = 0;
        let toks: Vec<Tok> = (0..4).map(|k| (policy(9000 + k), name(k, false))).collect();
        let mut utxos = Vec::new();
        for tk in &toks {
            for _ in 0..15 {
                utxos.push(make(
                    &mut i,
                    rng.range(0, 2_000_000),
                    &[(tk.clone(), rng.range(1, 1_000_000))],
                    pp,
                ));
            }
        }
        utxos.extend((0..10).map(|_| make(&mut i, rng.range(5_000_000, 50_000_000), &[], pp)));
        out.push(Shape {
            label: "4 tokens x15 each + ada x10".into(),
            utxos,
            token: Some(toks[0].clone()),
            several: toks,
        });
    }
    // 9. Fat bundles: a few UTxOs, each as many distinct tokens as an output holds; send them all.
    for (n, k, m) in [(4u64, 40u64, 3u64), (2, 60, 2), (12, 20, 2)] {
        let mut i = 0;
        let mut next = 0u64;
        let mut utxos = Vec::new();
        let mut all = Vec::new();
        for _ in 0..n {
            let assets: Vec<(Tok, u64)> = (0..k)
                .map(|_| {
                    next += 1;
                    let t = (policy(50_000 + next), name(next, true));
                    all.push(t.clone());
                    (t, rng.range(1, 1_000_000))
                })
                .collect();
            utxos.push(make(&mut i, rng.range(0, 1_000_000), &assets, pp));
        }
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(10_000_000, 50_000_000), &[], pp)));
        out.push(Shape {
            label: format!("fat bundles x{n} of {k} + ada x{m}"),
            token: Some(all[0].clone()),
            several: all,
            utxos,
        });
    }
    // 10. A move-in's bundles: 20 tokens each at exactly their least ADA, and only a few UTxOs of ADA.
    for (n, m) in [(12u64, 1u64), (12, 2), (30, 3), (8, 1), (45, 4)] {
        let mut i = 0;
        let mut next = 0u64;
        let mut utxos = Vec::new();
        let mut all = Vec::new();
        for _ in 0..n {
            let assets: Vec<(Tok, u64)> = (0..20)
                .map(|_| {
                    next += 1;
                    let t = (policy(70_000 + next), name(next, true));
                    all.push(t.clone());
                    (t, rng.range(1, u32::MAX as u64))
                })
                .collect();
            utxos.push(make(&mut i, 0, &assets, pp));
        }
        utxos.extend((0..m).map(|_| make(&mut i, rng.range(10_000_000, 40_000_000), &[], pp)));
        out.push(Shape {
            label: format!("move-in bundles x{n} of 20 + ada x{m}"),
            token: Some(all[0].clone()),
            several: all,
            utxos,
        });
    }
    // 8. Mixed: a bit of everything, shuffled.
    {
        let mut i = 0;
        let mut utxos = Vec::new();
        let mut next = 0u64;
        for _ in 0..80 {
            let kind = rng.range(0, 4);
            let assets: Vec<(Tok, u64)> = match kind {
                0 => vec![],
                1 => vec![(t.clone(), rng.range(1, 1_000_000))],
                2 => {
                    next += 1;
                    vec![((policy(20_000 + next), name(next, true)), 1)]
                }
                _ => (0..rng.range(2, 12))
                    .map(|_| {
                        next += 1;
                        (
                            (policy(30_000 + next % 7), name(next, true)),
                            rng.range(1, 10_000),
                        )
                    })
                    .collect(),
            };
            utxos.push(make(&mut i, rng.range(0, 20_000_000), &assets, pp));
        }
        out.push(Shape {
            label: "mixed x80".into(),
            utxos,
            token: Some(t.clone()),
            several: vec![],
        });
    }
    out
}

fn lovelace(u: &UtxoResponse) -> u64 {
    u.value.parse().unwrap()
}

fn held(utxos: &[UtxoResponse], tok: &Tok) -> u128 {
    utxos
        .iter()
        .flat_map(|u| u.asset_list.iter().flatten())
        .filter(|a| a.policy_id == tok.0 && a.asset_name == tok.1)
        .map(|a| a.quantity.parse::<u128>().unwrap())
        .sum()
}

fn register_from(datum: DatumOption) -> Register {
    let DatumOption::Data(data) = datum else {
        panic!("an inline datum")
    };
    let PlutusData::Constr(Constr { fields, .. }) = &data.0 else {
        panic!("constr")
    };
    let fields = match fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |d: &PlutusData| match d {
        PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
        _ => panic!("bytes"),
    };
    Register::new(bytes(&fields[0]), bytes(&fields[1]))
}

#[derive(Default, Debug)]
struct Part {
    size: usize,
    biggest_value: usize,
    inputs: Vec<(String, u64)>,
    paid_lovelace: u64,
    paid: BTreeMap<Tok, u128>,
    kept: BTreeMap<Tok, u128>,
    problems: Vec<String>,
}

/// Decodes a part and checks what the node would: size, each output's value size, conservation.
fn inspect(
    cbor: &str,
    utxos: &[UtxoResponse],
    sk: blstrs::Scalar,
    to_address: Option<&str>,
) -> Part {
    let bytes = hex::decode(cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let mut part = Part {
        size: bytes.len(),
        ..Default::default()
    };
    if part.size > 16_384 {
        part.problems
            .push(format!("tx {} bytes > 16384", part.size));
    }
    let mut in_lovelace = 0u64;
    let mut in_tokens: BTreeMap<Tok, u128> = BTreeMap::new();
    for i in tx.inputs() {
        let h = hex::encode(i.hash().as_ref());
        let ix = i.index();
        match utxos.iter().find(|u| u.tx_hash == h && u.tx_index == ix) {
            Some(u) => {
                in_lovelace += lovelace(u);
                for a in u.asset_list.iter().flatten() {
                    *in_tokens
                        .entry((a.policy_id.clone(), a.asset_name.clone()))
                        .or_default() += a.quantity.parse::<u128>().unwrap();
                }
            }
            None => part
                .problems
                .push(format!("input {h}#{ix} not in the wallet")),
        }
        part.inputs.push((h, ix));
    }
    let mut out_lovelace = 0u64;
    let mut out_tokens: BTreeMap<Tok, u128> = BTreeMap::new();
    for o in tx.outputs() {
        let v = o.value();
        let size = minicbor::to_vec(v.into_conway()).unwrap().len();
        part.biggest_value = part.biggest_value.max(size);
        if size > 5000 {
            part.problems
                .push(format!("output value {size} bytes > 5000"));
        }
        let paid = match to_address {
            Some(addr) => o.address().unwrap().to_bech32().unwrap() == addr,
            None => o
                .datum()
                .map(|d| !register_from(d.into()).is_owned(sk).unwrap_or(true))
                .unwrap_or(false),
        };
        out_lovelace += v.coin();
        if paid {
            part.paid_lovelace += v.coin();
        }
        for p in v.assets() {
            for a in p.assets() {
                let tok = (hex::encode(p.policy().as_ref()), hex::encode(a.name()));
                let q = a.output_coin().unwrap() as u128;
                *out_tokens.entry(tok.clone()).or_default() += q;
                if paid {
                    *part.paid.entry(tok).or_default() += q;
                } else {
                    *part.kept.entry(tok).or_default() += q;
                }
            }
        }
    }
    let fee = tx.fee().unwrap();
    if in_lovelace != out_lovelace + fee {
        part.problems.push(format!(
            "ADA in {in_lovelace} != out {out_lovelace} + fee {fee}"
        ));
    }
    if in_tokens != out_tokens {
        part.problems.push("tokens not conserved".into());
    }
    part
}

#[derive(Clone)]
enum Ask {
    /// ADA (fraction of the total, per mille), and tokens: (token, per mille of what's held).
    Amount(u64, Vec<(Tok, u64)>),
    Max(Vec<Tok>),
}

fn describe(ask: &Ask) -> String {
    match ask {
        Ask::Amount(ada, toks) => format!(
            "amount {}‰ ADA{}",
            ada,
            if toks.is_empty() {
                String::new()
            } else {
                format!(" + {} token(s) at {}‰", toks.len(), toks[0].1)
            }
        ),
        Ask::Max(toks) => format!("max + {} token(s)", toks.len()),
    }
}

fn asks(shape: &Shape) -> Vec<Ask> {
    let mut v = vec![
        Ask::Amount(250, vec![]),
        Ask::Amount(600, vec![]),
        Ask::Amount(900, vec![]),
        Ask::Max(vec![]),
    ];
    if let Some(t) = &shape.token {
        v.push(Ask::Amount(0, vec![(t.clone(), 1000)]));
        v.push(Ask::Amount(0, vec![(t.clone(), 500)]));
        v.push(Ask::Amount(600, vec![(t.clone(), 1000)]));
        v.push(Ask::Amount(900, vec![(t.clone(), 1000)]));
        v.push(Ask::Max(vec![t.clone()]));
    }
    if !shape.several.is_empty() {
        v.push(Ask::Amount(
            0,
            shape.several.iter().map(|t| (t.clone(), 1000)).collect(),
        ));
        v.push(Ask::Amount(
            500,
            shape.several.iter().map(|t| (t.clone(), 1000)).collect(),
        ));
        v.push(Ask::Max(shape.several.clone()));
    }
    v
}

struct Outcome {
    ok: bool,
    line: String,
    problems: Vec<String>,
}

fn check_parts(
    utxos: &[UtxoResponse],
    sk: blstrs::Scalar,
    to_address: Option<&str>,
    cbors: Vec<(String, usize)>,
    want_lovelace: Option<u64>,
    want_tokens: &BTreeMap<Tok, u128>,
    max_tokens: Option<&[Tok]>,
) -> (String, Vec<String>) {
    let mut problems = Vec::new();
    let mut seen: Vec<(String, u64)> = Vec::new();
    let mut paid_lovelace = 0u64;
    let mut paid: BTreeMap<Tok, u128> = BTreeMap::new();
    let mut sizes = Vec::new();
    let mut left = 0;
    for (cbor, l) in &cbors {
        let part = inspect(cbor, utxos, sk, to_address);
        problems.extend(part.problems.iter().cloned());
        for i in &part.inputs {
            if seen.contains(i) {
                problems.push(format!("input {}#{} in two parts", i.0, i.1));
            }
            seen.push(i.clone());
        }
        paid_lovelace += part.paid_lovelace;
        for (t, q) in part.paid {
            *paid.entry(t).or_default() += q;
        }
        sizes.push(format!(
            "{}in/{}B/v{}",
            part.inputs.len(),
            part.size,
            part.biggest_value
        ));
        left = *l;
    }
    if let Some(w) = want_lovelace
        && paid_lovelace < w
    {
        problems.push(format!("paid {paid_lovelace} < asked {w}"));
    }
    match max_tokens {
        None => {
            // Amounts: exactly the tokens asked, for withdraw and transfer.
            if &paid != want_tokens {
                problems.push(format!(
                    "tokens paid {} kinds, asked {} kinds (or amounts differ)",
                    paid.len(),
                    want_tokens.len()
                ));
            }
        }
        Some(_) => {
            if to_address.is_none() {
                // Max to a Seedelf: the tokens named, all the spent UTxOs hold of them.
                let spent: Vec<UtxoResponse> = utxos
                    .iter()
                    .filter(|u| seen.contains(&(u.tx_hash.clone(), u.tx_index)))
                    .cloned()
                    .collect();
                let held: BTreeMap<Tok, u128> = want_tokens
                    .keys()
                    .map(|t| (t.clone(), self::held(&spent, t)))
                    .filter(|(_, q)| *q > 0)
                    .collect();
                if paid != held {
                    problems.push(format!(
                        "max paid {} token kinds, its UTxOs held {}",
                        paid.len(),
                        held.len()
                    ));
                }
            }
            // Max never leaves a UTxO of ADA alone: it adds to the payment whatever else is left.
            let unspent_ada = utxos
                .iter()
                .filter(|u| u.asset_list.iter().flatten().next().is_none())
                .filter(|u| !seen.contains(&(u.tx_hash.clone(), u.tx_index)))
                .count();
            if unspent_ada > 0 {
                problems.push(format!("max left {unspent_ada} UTxOs of ADA alone"));
            }
            if left == 0 && seen.len() != utxos.len() {
                problems.push(format!(
                    "max spent {} of {} but says none left",
                    seen.len(),
                    utxos.len()
                ));
            }
        }
    }
    let line = format!(
        "{} part(s) [{}] paid {:.2} ADA, {} token kinds{}",
        cbors.len(),
        sizes.join(" "),
        paid_lovelace as f64 / 1e6,
        paid.len(),
        if left > 0 {
            format!(", LEFT {left}")
        } else {
            String::new()
        }
    );
    (line, problems)
}

/// The most an amount could pay, fees aside: all the ADA but what the tokens that stay need.
fn upper(utxos: &[UtxoResponse], sent: &BTreeMap<Tok, u128>, pp: &ProtocolParameters) -> u64 {
    let mut kept: BTreeMap<Tok, u128> = BTreeMap::new();
    for a in utxos.iter().flat_map(|u| u.asset_list.iter().flatten()) {
        *kept
            .entry((a.policy_id.clone(), a.asset_name.clone()))
            .or_default() += a.quantity.parse::<u128>().unwrap();
    }
    let mut assets = Assets::new();
    for (t, q) in kept {
        let left = q - sent.get(&t).copied().unwrap_or(0);
        if left > 0 {
            assets = assets
                .add(Asset::new(t.0, t.1, left as u64).unwrap())
                .unwrap();
        }
    }
    let total: u64 = utxos.iter().map(lovelace).sum();
    total.saturating_sub(if assets.is_empty() {
        0
    } else {
        build::minimum_deposit(pp, &assets).unwrap()
    })
}

fn run(shape: &Shape, ask: &Ask, sk: blstrs::Scalar, withdraw: bool, recorded: &Value) -> Outcome {
    let total: u64 = shape.utxos.iter().map(lovelace).sum();
    let (lovelace_ask, tokens): (Option<u64>, Vec<TokenAmount>) = match ask {
        Ask::Amount(per_mille, toks) => (
            Some(total / 1000 * per_mille),
            toks.iter()
                .filter_map(|(t, pm)| {
                    let q = held(&shape.utxos, t) * (*pm as u128) / 1000;
                    (q > 0).then(|| TokenAmount {
                        policy_id: t.0.clone(),
                        asset_name: t.1.clone(),
                        quantity: q.to_string(),
                    })
                })
                .collect(),
        ),
        Ask::Max(toks) => (
            None,
            toks.iter()
                .map(|t| TokenAmount {
                    policy_id: t.0.clone(),
                    asset_name: t.1.clone(),
                    quantity: held(&shape.utxos, t).to_string(),
                })
                .collect(),
        ),
    };
    let want: BTreeMap<Tok, u128> = tokens
        .iter()
        .map(|t| {
            (
                (t.policy_id.clone(), t.asset_name.clone()),
                t.quantity.parse().unwrap(),
            )
        })
        .collect();
    let max_toks: Option<Vec<Tok>> = match ask {
        Ask::Max(t) => Some(t.clone()),
        _ => None,
    };
    if withdraw {
        // Everything takes no tokens: only the no-token Max is asked of a withdrawal.
        if matches!(ask, Ask::Max(t) if !t.is_empty()) {
            return Outcome {
                ok: true,
                line: "skip".into(),
                problems: vec![],
            };
        }
        let to = theirs();
        let r = WithdrawRequest {
            network: "preprod".into(),
            params: params(),
            utxos: shape.utxos.clone(),
            payments: vec![WithdrawPayment {
                to: to.clone(),
                lovelace: lovelace_ask.map(|l| l.to_string()),
                tokens: tokens.clone(),
            }],
            classes: Default::default(),
            funding: None,
            most: false,
            seed: None,
            evaluation: None,
        };
        match api::build_withdraw_parts(sk, r) {
            Ok(parts) => {
                let cbors = parts.iter().map(|p| (p.tx_cbor.clone(), p.left)).collect();
                // Everything pays every token of what it spends; not checked against `want`.
                let want_t = if max_toks.is_some() {
                    BTreeMap::new()
                } else {
                    want.clone()
                };
                let (line, mut problems) = check_parts(
                    &shape.utxos,
                    sk,
                    Some(&to),
                    cbors,
                    lovelace_ask,
                    &want_t,
                    max_toks.as_deref(),
                );
                if max_toks.is_some() {
                    problems.retain(|p| !p.starts_with("max paid"));
                }
                Outcome {
                    ok: true,
                    line,
                    problems,
                }
            }
            Err(e) => Outcome {
                ok: false,
                line: format!("ERR {e}{}", verdict(&shape.utxos, lovelace_ask, &want)),
                problems: vec![],
            },
        }
    } else {
        let r = TransferRequest {
            network: "preprod".into(),
            params: params(),
            utxos: shape.utxos.clone(),
            payments: vec![SeedelfPayment {
                to: recorded["to"].as_str().unwrap().into(),
                recipient: serde_json::from_value(recorded["recipient"].clone()).unwrap(),
                lovelace: lovelace_ask.map(|l| l.to_string()),
                tokens: tokens.clone(),
            }],
            classes: Default::default(),
            seed: None,
            evaluation: None,
        };
        match api::build_transfer_parts(sk, r) {
            Ok(parts) => {
                let cbors = parts.iter().map(|p| (p.tx_cbor.clone(), p.left)).collect();
                let (line, problems) = check_parts(
                    &shape.utxos,
                    sk,
                    None,
                    cbors,
                    lovelace_ask,
                    &want,
                    max_toks.as_deref(),
                );
                Outcome {
                    ok: true,
                    line,
                    problems,
                }
            }
            Err(e) => Outcome {
                ok: false,
                line: format!("ERR {e}{}", verdict(&shape.utxos, lovelace_ask, &want)),
                problems: vec![],
            },
        }
    }
}

/// Whether a refusal looks wrong: Max should always go; an amount well under what could be paid should too.
fn verdict(utxos: &[UtxoResponse], asked: Option<u64>, sent: &BTreeMap<Tok, u128>) -> String {
    let pp = ProtocolParameters::from_koios(&params()).unwrap();
    let most = upper(utxos, sent, &pp);
    match asked {
        None => "  <<< MAX REFUSED".into(),
        Some(a) if (a as f64) < most as f64 * 0.85 => format!(
            "  <<< GAP? asked {:.1} of at most {:.1}",
            a as f64 / 1e6,
            most as f64 / 1e6
        ),
        Some(a) => format!(
            "  (asked {:.1} of at most {:.1})",
            a as f64 / 1e6,
            most as f64 / 1e6
        ),
    }
}

#[test]
#[ignore = "slow: every shape, about a minute in release"]
fn every_shape_goes_in_parts_the_ledger_takes() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let pp = ProtocolParameters::from_koios(&params()).unwrap();
    let recorded = fixture("../extension/tests/fixtures/transfer-preprod.json");
    let only = std::env::var("ONLY").ok();
    let mut bad = 0;
    let mut errs = 0;
    let mut max_refused = 0;
    for shape in shapes(&pp) {
        if only
            .as_ref()
            .is_some_and(|o| !shape.label.contains(o.as_str()))
        {
            continue;
        }
        let total: u64 = shape.utxos.iter().map(lovelace).sum();
        println!(
            "\n=== {} ({} UTxOs, {:.2} ADA)",
            shape.label,
            shape.utxos.len(),
            total as f64 / 1e6
        );
        for ask in asks(&shape) {
            for withdraw in [false, true] {
                let started = std::time::Instant::now();
                let o = run(&shape, &ask, sk, withdraw, &recorded);
                if o.line == "skip" {
                    continue;
                }
                let flag = if !o.problems.is_empty() {
                    bad += 1;
                    "BAD "
                } else if !o.ok {
                    errs += 1;
                    if matches!(ask, Ask::Max(_)) {
                        max_refused += 1;
                    }
                    "err "
                } else {
                    "ok  "
                };
                println!(
                    "{flag}{:8} {:32} {:>5}ms {}",
                    if withdraw { "withdraw" } else { "transfer" },
                    describe(&ask),
                    started.elapsed().as_millis(),
                    o.line
                );
                for p in &o.problems {
                    println!("       ! {p}");
                }
            }
        }
    }
    println!("\n{bad} with problems, {errs} refused, {max_refused} of them Max");
    assert_eq!((bad, max_refused), (0, 0));
}
