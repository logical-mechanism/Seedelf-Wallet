//! Chunk 51, round eight's last look, l8still#1 (a trace check's pin, scratch only). Beside a change whose last output
//! is full (the other money keeps exactly 20 kinds of token), two ways back of one token pool share the one second
//! output their token opens, but orders a and b weigh each as if it opened that output alone, its whole least off the
//! box's ADA. A box of ADA alone weighing between that and what they pay together goes first, so a merge takes one box
//! more than pays (rule 3), or of as many boxes, fewer a mix moved (rule 4).
//!
//! E: M, money made private holding 20 kinds of token (of the pools' policy, or of another), at its least and 0.5 ₳;
//! T1 and T2, ways back of one token pool, 7.5 ₳ and its token each; A, a way back of 6.5 ₳ of ADA alone. Just under
//! the most M, T1 and T2 pay, M, A and either one are short: M, T1 and T2, two boxes, whatever a mix moved.
//! F: M of its least and 3 ₳ with 20 kinds; R, 3 ₳ received; T, a plain way back of 7.5 ₳ and poolB; X, a mixed one of
//! 5.9 ₳ and poolB; A, a plain one of 6 ₳ (and, as the finder's seed 481, U1 and U2 of unknown making). Just under the
//! most T, X, M and R pay, T, A, M and R pay too, and every one box beside M and R is short: T and X, one mixed.

use pallas_crypto::hash::{Hash, Hasher};
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::Assets;
use seedelf_core::build::{self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose};
use seedelf_core::constants::get_config;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const POOL_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const BUNDLE_POLICY: &str = "e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0";
const X_POLICY: &str = "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0";

struct World {
    chain: Chain,
    owner: Register,
    signer: Hash<28>,
}

fn world() -> World {
    let rows: Value = serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    World {
        chain: Chain {
            params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
            network_flag: true,
            config: get_config(1, true).unwrap(),
        },
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(build::fake_signer().public_key().as_ref()),
    }
}

/// A wallet-contract UTxO of `w`'s, as Koios returns it: (policy, name, quantity) each token.
fn owned(w: &World, n: u8, lovelace: u64, tokens: &[(&str, &str, u64)]) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: hex::encode([n; 32]),
        tx_index: 0,
        address: wallet_contract(true, w.chain.config.contract.wallet_contract_hash)
            .to_bech32()
            .unwrap(),
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
            tokens
                .iter()
                .map(|(policy, name, q)| Asset {
                    decimals: 0,
                    quantity: q.to_string(),
                    policy_id: policy.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .collect(),
        ),
        ..Default::default()
    }
}

/// M: 20 kinds of `policy`'s token at their least and `over`.
fn bundle(w: &World, n: u8, policy: &str, over: u64) -> UtxoResponse {
    let names: Vec<String> = (0..20).map(|i| format!("m{i:02}")).collect();
    let tokens: Vec<(&str, &str, u64)> = names.iter().map(|m| (policy, m.as_str(), 1)).collect();
    let probe = owned(w, n, 10_000_000, &tokens);
    let least = 10_000_000 - u64::try_from(build::adds(&w.chain.params, &probe).unwrap()).unwrap();
    owned(w, n, least + over, &tokens)
}

fn class(id: String, origin: Origin) -> Class {
    Class { id, origin }
}

fn own() -> Class {
    class("public:0".into(), Origin::Own)
}

fn received(u: &UtxoResponse) -> Class {
    class(format!("received:{}", u.tx_hash), Origin::Received)
}

fn way_back(u: &UtxoResponse, origin: Origin) -> Class {
    class(format!("box:{}", u.tx_hash), origin)
}

fn unknown(u: &UtxoResponse) -> Class {
    class(format!("box:{0}+unknown:{0}", u.tx_hash), Origin::Lovejoin)
}

#[derive(Debug, Clone, Copy)]
enum Out {
    Send,
    Public,
    Fund,
}

fn key_address() -> pallas_addresses::Address {
    use pallas_addresses::{
        Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    };
    ShelleyAddress::new(
        Network::Testnet,
        ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
        ShelleyDelegationPart::Null,
    )
    .into()
}

/// A Send to someone's Seedelf, a Make public, or a session's funding and its 5 ₳ collateral: `lovelace` in all.
fn outputs(out: Out, lovelace: u64) -> (Purpose, Vec<Payment>, Vec<AddressPayment>) {
    let to = |lovelace| AddressPayment {
        to: key_address(),
        lovelace,
        tokens: Assets::new(),
    };
    match out {
        Out::Send => (
            Purpose::Pay,
            vec![Payment {
                register: Register::create(random_scalar())
                    .unwrap()
                    .rerandomize()
                    .unwrap(),
                lovelace,
                tokens: Assets::new(),
            }],
            Vec::new(),
        ),
        Out::Public => (Purpose::Pay, Vec::new(), vec![to(lovelace)]),
        Out::Fund => (
            Purpose::Fund {
                session: Some("session:7".into()),
            },
            Vec::new(),
            vec![to(lovelace - 5_000_000), to(5_000_000)],
        ),
    }
}

/// Whether exactly `inputs` pay, as selection's attempt asks it.
fn pays(w: &World, inputs: &[UtxoResponse], out: Out, lovelace: u64) -> anyhow::Result<()> {
    let (_, seedelfs, pay) = outputs(out, lovelace);
    if pay.is_empty() {
        build::transfer_from(&w.chain, inputs, &seedelfs, &w.owner, w.signer)
    } else {
        build::sweep_many_from(&w.chain, inputs, &pay, &w.owner, w.signer)
    }
    .and_then(|s| s.estimate())
    .map(|_| ())
}

/// What the web wallet's selection spends of `known`, by their classes.
fn picked(
    w: &World,
    known: &[(&UtxoResponse, Class)],
    out: Out,
    lovelace: u64,
) -> anyhow::Result<Vec<UtxoResponse>> {
    let (purpose, seedelfs, pay) = outputs(out, lovelace);
    let available: Vec<UtxoResponse> = known.iter().map(|(u, _)| (*u).clone()).collect();
    let h = known.iter().fold(Histories::new(purpose), |h, (u, c)| {
        h.with(&u.tx_hash, u.tx_index, c.clone())
    });
    if pay.is_empty() {
        build::transfer_apart(&w.chain, &available, &h, &seedelfs, &w.owner, w.signer)
    } else {
        build::sweep_many_apart(&w.chain, &available, &h, &pay, &w.owner, w.signer)
    }
    .map(|s| s.inputs())
}

/// The most `pays` pays, between `lo`, which it pays, and `hi`, which it doesn't.
fn most_paid(mut lo: u64, mut hi: u64, pays: impl Fn(u64) -> bool) -> u64 {
    assert!(pays(lo) && !pays(hi), "{lo} pays, {hi} doesn't");
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if pays(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

fn outpoints(utxos: &[UtxoResponse]) -> Vec<String> {
    let mut v: Vec<String> = utxos
        .iter()
        .map(|u| format!("{}#{}", u.tx_hash, u.tx_index))
        .collect();
    v.sort();
    v
}

/// What `spent` holds of `names`, by name, and how many others.
fn named(spent: &[UtxoResponse], names: &[(&UtxoResponse, &str)]) -> String {
    let mut seen: Vec<&str> = Vec::new();
    let mut others = 0;
    for s in spent {
        match names.iter().find(|(n, _)| n.tx_hash == s.tx_hash) {
            Some((_, name)) => seen.push(name),
            None => others += 1,
        }
    }
    seen.sort_unstable();
    format!("{} and {others} others", seen.join(", "))
}

#[test]
fn beside_a_full_change_two_ways_back_of_one_pool_pay_the_output_they_open_once() {
    let w = world();
    let mut wrong: Vec<String> = Vec::new();
    // E.
    for (n, policy) in [(0u8, POOL_POLICY), (1, BUNDLE_POLICY)] {
        let m = bundle(&w, 0x20 + n, policy, 500_000);
        let t1 = owned(&w, 0x70 + 2 * n, 7_500_000, &[(POOL_POLICY, "pooltoken", 1)]);
        let t2 = owned(&w, 0x71 + 2 * n, 7_500_000, &[(POOL_POLICY, "pooltoken", 1)]);
        let a = owned(&w, 0x30 + n, 6_500_000, &[]);
        let names = [(&m, "M"), (&t1, "T1"), (&t2, "T2"), (&a, "A")];
        let target = vec![m.clone(), t1.clone(), t2.clone()];
        for out in [Out::Send, Out::Public, Out::Fund] {
            let lo = if matches!(out, Out::Fund) { 6_100_000 } else { 2_000_000 };
            let most = most_paid(lo, 30_000_000, |l| pays(&w, &target, out, l).is_ok());
            let lovelace = most - 20_000;
            for (what, inputs) in [
                ("M, A and T1", vec![m.clone(), a.clone(), t1.clone()]),
                ("M, A and T2", vec![m.clone(), a.clone(), t2.clone()]),
                ("T1 and T2", vec![t1.clone(), t2.clone()]),
            ] {
                let e = pays(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "E{n} {out:?}: {what}: {e}");
            }
            pays(&w, &[m.clone(), a.clone(), t1.clone(), t2.clone()], out, lovelace)
                .expect("M, A, T1 and T2 pay");
            for (a_origin, t_origin) in [
                (Origin::Lovejoin, Origin::Lovejoin),
                (Origin::Mixed, Origin::Lovejoin),
                (Origin::Lovejoin, Origin::Mixed),
            ] {
                let known: Vec<(&UtxoResponse, Class)> = vec![
                    (&m, own()),
                    (&t1, way_back(&t1, t_origin)),
                    (&t2, way_back(&t2, t_origin)),
                    (&a, way_back(&a, a_origin)),
                ];
                let line = format!(
                    "E (20 kinds of {}): {out:?} of {lovelace} (M, T1 and T2 pay up to {most}), A {a_origin:?}, T {t_origin:?}",
                    if n == 0 { "the pool's policy" } else { "another policy" }
                );
                match picked(&w, &known, out, lovelace) {
                    Ok(s) if outpoints(&s) == outpoints(&target) => {}
                    Ok(s) => wrong.push(format!(
                        "{line}: spent {}, where M, T1 and T2 (two boxes) pay",
                        named(&s, &names)
                    )),
                    Err(e) => wrong.push(format!("{line}: refused: {e}")),
                }
            }
        }
    }
    // F.
    let m = bundle(&w, 0x28, BUNDLE_POLICY, 3_000_000);
    let r = owned(&w, 0x29, 3_000_000, &[]);
    let t = owned(&w, 0x78, 7_500_000, &[(POOL_POLICY, "poolB", 1)]);
    let x = owned(&w, 0x79, 5_900_000, &[(POOL_POLICY, "poolB", 1)]);
    let a = owned(&w, 0x38, 6_000_000, &[]);
    let u1 = owned(&w, 0x91, 6_000_000, &[(X_POLICY, "X", 1)]);
    let u2 = owned(&w, 0x92, 9_710_000, &[(POOL_POLICY, "poolB", 1)]);
    let names = [(&m, "M"), (&r, "R"), (&t, "T"), (&x, "X"), (&a, "A"), (&u1, "U1"), (&u2, "U2")];
    let target = vec![m.clone(), r.clone(), t.clone(), x.clone()];
    for out in [Out::Send, Out::Public, Out::Fund] {
        let lo = if matches!(out, Out::Fund) { 6_100_000 } else { 2_000_000 };
        let most = most_paid(lo, 40_000_000, |l| pays(&w, &target, out, l).is_ok());
        let lovelace = most - 20_000;
        pays(&w, &[m.clone(), r.clone(), t.clone(), a.clone()], out, lovelace)
            .expect("T, A, M and R pay");
        for (what, inputs) in [
            ("X, A, M and R", vec![m.clone(), r.clone(), x.clone(), a.clone()]),
            ("T, M and R", vec![m.clone(), r.clone(), t.clone()]),
            ("A, M and R", vec![m.clone(), r.clone(), a.clone()]),
        ] {
            let e = pays(&w, &inputs, out, lovelace).unwrap_err();
            assert!(build::is_short(&e), "F {out:?}: {what}: {e}");
        }
        for with_unknown in [false, true] {
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&m, own()),
                (&r, received(&r)),
                (&t, way_back(&t, Origin::Lovejoin)),
                (&x, way_back(&x, Origin::Mixed)),
                (&a, way_back(&a, Origin::Lovejoin)),
            ];
            if with_unknown {
                known.push((&u1, unknown(&u1)));
                known.push((&u2, unknown(&u2)));
            }
            let line = format!(
                "F{}: {out:?} of {lovelace} (T, X, M and R pay up to {most})",
                if with_unknown { " with U1 and U2" } else { "" }
            );
            match picked(&w, &known, out, lovelace) {
                Ok(s) if outpoints(&s) == outpoints(&target) => {}
                Ok(s) => wrong.push(format!(
                    "{line}: spent {}, where T and X (one mixed) pay beside M and R",
                    named(&s, &names)
                )),
                Err(e) => wrong.push(format!("{line}: refused: {e}")),
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "beside a change keeping 20 kinds, two ways back of one pool weighed as if each opened its own output:\n{}",
        wrong.join("\n")
    );
}

/// What the extra box costs in E: the fee of each set at the Send HEAD picks for.
#[test]
fn e_fees() {
    let w = world();
    let m = bundle(&w, 0x20, POOL_POLICY, 500_000);
    let t1 = owned(&w, 0x70, 7_500_000, &[(POOL_POLICY, "pooltoken", 1)]);
    let t2 = owned(&w, 0x71, 7_500_000, &[(POOL_POLICY, "pooltoken", 1)]);
    let a = owned(&w, 0x30, 6_500_000, &[]);
    let fee = |inputs: &[UtxoResponse], lovelace: u64| {
        let (_, seedelfs, _) = outputs(Out::Send, lovelace);
        build::transfer_from(&w.chain, inputs, &seedelfs, &w.owner, w.signer)
            .and_then(|s| s.estimate())
            .map(|e| e.fee.total)
    };
    let lovelace = 13_484_598;
    let few = fee(&[m.clone(), t1.clone(), t2.clone()], lovelace).unwrap();
    let more = fee(&[m.clone(), a.clone(), t1.clone(), t2.clone()], lovelace).unwrap();
    let ma = most_paid(2_000_000, 30_000_000, |l| pays(&w, &[m.clone(), a.clone(), t1.clone()], Out::Send, l).is_ok());
    let mt = most_paid(2_000_000, 30_000_000, |l| pays(&w, &[m.clone(), t1.clone(), t2.clone()], Out::Send, l).is_ok());
    println!("fee M,T1,T2 {few} | fee A,M,T1,T2 {more} | extra {} | M,A,T1 pays up to {ma} | M,T1,T2 up to {mt}", more - few);
}
