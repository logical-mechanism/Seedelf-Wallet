//! The exact search after a build too large for one transaction: 1.9.3's gate review's last look at its fixes, F2.
//! A too-large build at one level could pass over every set of a later one beside all the other money unbuilt, and
//! 3's orders then started past every start: what 1.9.2 sent as one transaction was refused. Each pin failed then.
#![allow(dead_code)] // The brute force's machinery, in box_rule_reference_test.rs's shape, is used in part.
use std::collections::BTreeMap;

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::Assets;
use seedelf_core::build::{
    self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose,
};
use seedelf_core::constants::get_config;
use seedelf_core::transaction::seedelf_minimum_lovelace;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{Asset, InlineDatum, ProtocolParameters, UtxoResponse};
use serde_json::{Value, json};

const TOKEN_POLICY: &str = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const ADA: u64 = 1_000_000;

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
    to: Address,
}

fn world() -> World {
    let chain = chain();
    let key = SecretKey::new(OsRng);
    World {
        wallet: wallet_contract(true, chain.config.contract.wallet_contract_hash),
        chain,
        owner: Register::create(random_scalar()).unwrap(),
        signer: Hasher::<224>::hash(PrivateKey::from(key).public_key().as_ref()),
        to: ShelleyAddress::new(
            Network::Testnet,
            ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
            ShelleyDelegationPart::Null,
        )
        .into(),
    }
}

/// A wallet-contract UTxO of `w`'s, made by transaction `n` (as many as a sweep needs), with one of `token` where
/// given, as Koios returns it.
fn utxo(w: &World, n: u32, lovelace: u64, token: Option<&str>) -> UtxoResponse {
    let register = w.owner.clone().rerandomize().unwrap();
    UtxoResponse {
        tx_hash: format!("{n:08x}").repeat(8),
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
            token
                .map(|name| Asset {
                    decimals: 0,
                    quantity: "1".into(),
                    policy_id: TOKEN_POLICY.to_string(),
                    asset_name: hex::encode(name),
                    fingerprint: String::new(),
                })
                .into_iter()
                .collect(),
        ),
        ..Default::default()
    }
}

fn lovelace_of(u: &UtxoResponse) -> u64 {
    u.value.parse().unwrap()
}

fn holds_tokens(u: &UtxoResponse) -> bool {
    u.asset_list.as_ref().is_some_and(|a| !a.is_empty())
}

/// What made a UTxO, as the extension classes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// A box's way back a mix moved (`box:<tx>`, origin mixed).
    Mixed,
    /// A plain way back (`box:<tx>`, origin lovejoin), 1.9.1's among them.
    Plain,
    /// One whose making the wallet can't place (`box:<tx>+unknown:<tx>`, origin lovejoin).
    Unknown,
    /// Money made private from public account 0.
    Own,
    /// A payment received, a class of its own.
    Received,
    /// The funding's own session's money (`session:7`).
    OwnSession,
    /// Another session's money (`session:3`), which a funding takes last.
    OtherSession,
}

impl Kind {
    fn is_box(self) -> bool {
        matches!(self, Kind::Mixed | Kind::Plain | Kind::Unknown)
    }

    fn class(self, tx: &str, mixed_known: bool) -> Class {
        let (id, origin) = match self {
            Kind::Mixed if mixed_known => (format!("box:{tx}"), Origin::Mixed),
            Kind::Mixed | Kind::Plain => (format!("box:{tx}"), Origin::Lovejoin),
            Kind::Unknown => (format!("box:{tx}+unknown:{tx}"), Origin::Lovejoin),
            Kind::Own => ("public:0".into(), Origin::Own),
            Kind::Received => (format!("received:{tx}"), Origin::Received),
            Kind::OwnSession => ("session:7".into(), Origin::Session),
            Kind::OtherSession => ("session:3".into(), Origin::Session),
        };
        Class { id, origin }
    }
}

/// What kind of box a class is, read from its origin and its parts' tags as the extension writes them, never from
/// selection's own helpers: 0, one a mix moved (origin mixed); 1, a plain one, each part a box's (`box:<tx>`); 2, one
/// of unknown making (a part of another kind, such as an `unknown:<tx>`).
fn made_of(class: &Class) -> u8 {
    if class.origin == Origin::Mixed {
        0
    } else if class.id.split('+').all(|part| part.starts_with("box:")) {
        1
    } else {
        2
    }
}

/// One balance: its UTxOs, each with what made it, the boxes first, then the other money, then `smalls` payments
/// received of `small` lovelace each (one transaction spends no more than 22 inputs).
struct Balance {
    items: Vec<(UtxoResponse, Kind)>,
    boxes: usize,
    distinct: usize,
    smalls: usize,
    small: u64,
}

impl Balance {
    fn histories(&self, purpose: Purpose, mixed_known: bool) -> Histories {
        self.items
            .iter()
            .fold(Histories::new(purpose), |h, (u, k)| {
                h.with(&u.tx_hash, u.tx_index, k.class(&u.tx_hash, mixed_known))
            })
    }

    fn position(&self, u: &UtxoResponse) -> usize {
        self.items
            .iter()
            .position(|(x, _)| x.tx_hash == u.tx_hash && x.tx_index == u.tx_index)
            .expect("a UTxO of the balance")
    }

    fn describe(&self) -> String {
        self.items
            .iter()
            .take(self.boxes + self.distinct)
            .map(|(u, k)| {
                let token = if holds_tokens(u) { "+token" } else { "" };
                format!("{k:?} {}{token}", ada(lovelace_of(u)))
            })
            .chain(
                (self.smalls > 0)
                    .then(|| format!("{} received of {}", self.smalls, ada(self.small))),
            )
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn ada(lovelace: u64) -> String {
    format!("{}.{:06} ₳", lovelace / ADA, lovelace % ADA)
}

/// What a balance pays.
#[derive(Debug, Clone)]
enum Spend {
    /// A Send of this much to a Seedelf.
    Send(u64),
    /// A Make public of this much to an address.
    Public(u64),
    /// A new session's funding of this much and its 5 ₳ collateral.
    Fund(u64),
    /// A stealth mint: a new Seedelf, its least locked with it.
    Mint,
}

impl Spend {
    fn purpose(&self) -> Purpose {
        match self {
            Spend::Fund(_) => Purpose::Fund {
                session: Some("session:7".into()),
            },
            Spend::Mint => Purpose::Mint,
            _ => Purpose::Pay,
        }
    }

    /// What it pays out: inputs holding no more can't pay, and selection doesn't ask.
    fn floor(&self, params: &ProtocolParameters) -> u64 {
        match self {
            Spend::Send(l) | Spend::Public(l) => *l,
            Spend::Fund(l) => l + 5 * ADA,
            Spend::Mint => seedelf_minimum_lovelace(params).unwrap(),
        }
    }

    fn outputs(&self, w: &World) -> (Vec<Payment>, Vec<AddressPayment>) {
        let to = |lovelace: u64| AddressPayment {
            to: w.to.clone(),
            lovelace,
            tokens: Assets::new(),
        };
        match self {
            Spend::Send(l) => (
                vec![Payment {
                    register: w.owner.clone().rerandomize().unwrap(),
                    lovelace: *l,
                    tokens: Assets::new(),
                }],
                Vec::new(),
            ),
            Spend::Public(l) => (Vec::new(), vec![to(*l)]),
            Spend::Fund(l) => (Vec::new(), vec![to(*l), to(5 * ADA)]),
            Spend::Mint => (Vec::new(), Vec::new()),
        }
    }
}

/// A Spend's outputs, made once, and selection's attempt over exactly some inputs.
struct Paying<'w> {
    w: &'w World,
    spend: Spend,
    seedelfs: Vec<Payment>,
    addresses: Vec<AddressPayment>,
    /// Whether exactly these values pay, by their lovelace and tokens: the inputs' own identities don't change it.
    known: BTreeMap<Vec<(u64, String)>, Verdict>,
    builds: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Pays,
    Short,
    /// Too much computation, or too large: more inputs won't mend it.
    Failed,
}

impl<'w> Paying<'w> {
    fn new(w: &'w World, spend: &Spend) -> Self {
        let (seedelfs, addresses) = spend.outputs(w);
        Paying {
            w,
            spend: spend.clone(),
            seedelfs,
            addresses,
            known: BTreeMap::new(),
            builds: 0,
        }
    }

    fn verdict(&mut self, inputs: &[&UtxoResponse]) -> Verdict {
        let mut key: Vec<(u64, String)> = inputs
            .iter()
            .map(|u| {
                let token = u
                    .asset_list
                    .iter()
                    .flatten()
                    .map(|a| a.asset_name.clone())
                    .collect::<Vec<_>>()
                    .join(",");
                (lovelace_of(u), token)
            })
            .collect();
        key.sort();
        if let Some(v) = self.known.get(&key) {
            return *v;
        }
        self.builds += 1;
        let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
        let w = self.w;
        let built = match self.spend {
            Spend::Mint => {
                let seedelf = w.owner.clone().rerandomize().unwrap();
                build::mint_from(&w.chain, &inputs, "", &seedelf, &w.owner, w.signer)
                    .and_then(|m| m.spend.estimate().map(|_| ()))
            }
            _ if self.addresses.is_empty() => {
                build::transfer_from(&w.chain, &inputs, &self.seedelfs, &w.owner, w.signer)
                    .and_then(|s| s.estimate().map(|_| ()))
            }
            _ => build::sweep_many_from(&w.chain, &inputs, &self.addresses, &w.owner, w.signer)
                .and_then(|s| s.estimate().map(|_| ())),
        };
        let v = match built {
            Ok(()) => Verdict::Pays,
            Err(e) if build::is_short(&e) => Verdict::Short,
            Err(_) => Verdict::Failed,
        };
        self.known.insert(key, v);
        v
    }

    /// Selection's own pick from `available`.
    fn apart(
        &self,
        available: &[UtxoResponse],
        h: &Histories,
    ) -> anyhow::Result<Vec<UtxoResponse>> {
        let w = self.w;
        match self.spend {
            Spend::Mint => {
                let seedelf = w.owner.clone().rerandomize().unwrap();
                build::mint_apart(&w.chain, available, h, "", &seedelf, &w.owner, w.signer)
                    .map(|m| m.spend.inputs())
            }
            _ if self.addresses.is_empty() => {
                build::transfer_apart(&w.chain, available, h, &self.seedelfs, &w.owner, w.signer)
                    .map(|s| s.inputs())
            }
            _ => {
                build::sweep_many_apart(&w.chain, available, h, &self.addresses, &w.owner, w.signer)
                    .map(|s| s.inputs())
            }
        }
    }
}
// ---- Last look (1.9.3 gate review): probes, not for merge. ----

/// A box `n` of `lovelace` holding `kinds` kinds of 32-byte names, each under a policy of its own (`policy0` on).
fn token_box(w: &World, n: u32, lovelace: u64, kinds: u32, policy0: u32) -> UtxoResponse {
    let mut u = utxo(w, n, lovelace, None);
    u.asset_list = Some(
        (0..kinds)
            .map(|i| Asset {
                decimals: 0,
                quantity: "1".into(),
                policy_id: hex::encode(((policy0 + i) as u64).to_be_bytes()).repeat(4)[..56]
                    .to_string(),
                asset_name: hex::encode(format!("{n:08x}{i:024x}")),
                fingerprint: String::new(),
            })
            .collect(),
    );
    u
}

/// The large prune meets r2#1's `from`: a level whose sets beside all the other money are all passed over as too large
/// by an earlier level's build (none built at this one) starts c's orders from `beyond`, past every start, so a set of
/// that level that fits beside fewer of the other money is never built. T (100 ₳ and many kinds), B1 (20 ₳, a token),
/// B2 (1.5 ₳, a token), all plain, beside 20 UTxOs of 2 ₳ made private; a Send of 62 ₳. T pays only beside so much of
/// the other money that it's too large; T and B1 beside one or two of it pay and fit. 1.9.2's c builds T and B1 (its
/// largest two by weight) beside the fewest that pay.
#[test]
fn after_a_build_too_large_a_level_is_still_tried_beside_fewer_of_the_other_money() {
    let w = world();
    let spend = Spend::Send(62 * ADA);
    let history: Vec<UtxoResponse> = (0..20u32)
        .map(|i| utxo(&w, 0x5000_0100 + i, 2 * ADA, None))
        .collect();
    let b1 = token_box(&w, 0x5000_0001, 20 * ADA, 1, 0x7100);
    let b2 = token_box(&w, 0x5000_0002, 1_500_000, 1, 0x7200);
    let mut paying = Paying::new(&w, &spend);
    let mut found = None;
    for kinds in (100..=300u32).step_by(2) {
        let mut t = token_box(&w, 0x5000_0000, 0, kinds, 0x1000);
        let (_, held) = seedelf_core::utxos::assets_of(vec![t.clone()]).unwrap();
        t.value = (build::minimum_deposit(&w.chain.params, &held).unwrap() + 42 * ADA).to_string();
        fn with<'a>(
            extra: &[&'a UtxoResponse],
            history: &'a [UtxoResponse],
            k: usize,
        ) -> Vec<&'a UtxoResponse> {
            extra.iter().copied().chain(history[..k].iter()).collect()
        }
        let all = paying.verdict(&with(&[&t], &history, 20));
        // The first count of the other money beside T that isn't short.
        let first = (0..=20).find(|&k| paying.verdict(&with(&[&t], &history, k)) != Verdict::Short);
        let first_v = first.map(|k| paying.verdict(&with(&[&t], &history, k)));
        let pair =
            (0..=4).find(|&k| paying.verdict(&with(&[&t, &b1], &history, k)) == Verdict::Pays);
        let small = paying.verdict(&with(&[&b1, &b2], &history, 20));
        let b1_all = paying.verdict(&with(&[&b1], &history, 20));
        println!(
            "kinds {kinds}: T beside all {all:?}, T first not short at {first:?} {first_v:?}, T+B1 pays beside {pair:?}, B1+B2 beside all {small:?}, B1 beside all {b1_all:?}"
        );
        if all == Verdict::Failed
            && first_v.is_none_or(|v| v == Verdict::Failed)
            && pair.is_some()
            && small == Verdict::Short
            && b1_all == Verdict::Short
        {
            found = Some((kinds, t, pair.unwrap()));
            break;
        }
    }
    let (kinds, t, pair) = found.expect("a T that fits the window");
    for k in 0..=4 {
        let three: Vec<&UtxoResponse> = [&t, &b1, &b2]
            .into_iter()
            .chain(history[..k].iter())
            .collect();
        let two: Vec<&UtxoResponse> = [&t, &b1].into_iter().chain(history[..k].iter()).collect();
        println!(
            "beside {k}: T+B1 {:?}, T+B1+B2 {:?}",
            paying.verdict(&two),
            paying.verdict(&three)
        );
    }
    let mut items: Vec<(UtxoResponse, Kind)> =
        vec![(t, Kind::Plain), (b1, Kind::Plain), (b2, Kind::Plain)];
    items.extend(history.iter().cloned().map(|u| (u, Kind::Own)));
    let balance = Balance {
        boxes: 3,
        distinct: 20,
        smalls: 0,
        small: 2 * ADA,
        items,
    };
    let available: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let h = balance.histories(spend.purpose(), true);
    let started = std::time::Instant::now();
    let picked = paying.apart(&available, &h);
    println!(
        "T of {kinds} kinds; T and B1 pay beside {pair} of the other money; selection took {:?}",
        started.elapsed()
    );
    let picked = picked.expect("T and B1 pay in one transaction");
    let boxes: Vec<String> = picked
        .iter()
        .filter_map(|u| {
            let at = balance.position(u);
            (at < 3).then(|| ["T", "B1", "B2"][at].to_string())
        })
        .collect();
    println!(
        "picked boxes {boxes:?} beside {} of the other money",
        picked.len() - boxes.len()
    );
    assert_eq!(
        boxes.len(),
        2,
        "as few boxes as pay: T and B1 beside {pair} pay, yet {boxes:?}"
    );
}

/// r1#2's money (20 UTxOs made private, each 20 kinds of a policy of its own at their least and 0.06 ₳) beside twelve
/// boxes, half of ADA alone and half holding `per` kinds of policies of their own, each box's ADA set so every box is
/// worth about 4.71 ₳ beside the change (its tokens' own least and their bytes' fee added), plus 7 × 2^i: so a level's
/// sets of as much worth take different counts of change outputs.
fn many_outputs(per: u32) -> std::time::Duration {
    let w = world();
    let p = &w.chain.params;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    for i in 0..12u32 {
        let kind = if i % 2 == 0 { Kind::Mixed } else { Kind::Plain };
        let jitter = 7 * (1u64 << i);
        let u = if i % 2 == 0 {
            utxo(&w, 0x6000_0000 + i, 4_710_000 + jitter, None)
        } else {
            let mut u = utxo(&w, 0x6000_0000 + i, 0, None);
            u.asset_list = Some(
                (0..per)
                    .map(|j| Asset {
                        decimals: 0,
                        quantity: "1".into(),
                        policy_id: format!("{:02x}", 0xa0 + i).repeat(28),
                        asset_name: hex::encode(format!("b{i}m{j:02}")),
                        fingerprint: String::new(),
                    })
                    .collect(),
            );
            let (_, held) = seedelf_core::utxos::assets_of(vec![u.clone()]).unwrap();
            let least = build::minimum_deposit(p, &held).unwrap();
            let bytes = least / p.coins_per_utxo_size - 160;
            u.value = (least + 4_710_000 + jitter + bytes * p.min_fee_a).to_string();
            u
        };
        items.push((u, kind));
    }
    for k in 0..20u32 {
        let mut u = utxo(&w, 0x6000_0100 + k, 0, None);
        u.asset_list = Some(
            (0..20)
                .map(|i| Asset {
                    decimals: 0,
                    quantity: "1".into(),
                    policy_id: format!("{:02x}", 0x60 + k).repeat(28),
                    asset_name: hex::encode(format!("k{k}m{i:02}")),
                    fingerprint: String::new(),
                })
                .collect(),
        );
        let (_, held) = seedelf_core::utxos::assets_of(vec![u.clone()]).unwrap();
        u.value = (build::minimum_deposit(p, &held).unwrap() + 60_000).to_string();
        items.push((u, Kind::Own));
    }
    let balance = Balance {
        boxes: 12,
        distinct: 20,
        smalls: 0,
        small: 2 * ADA,
        items,
    };
    let available: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let mut worst = std::time::Duration::ZERO;
    for lovelace in [10 * ADA, 15 * ADA, 20 * ADA, 30 * ADA, 40 * ADA] {
        let spend = Spend::Send(lovelace);
        let paying = Paying::new(&w, &spend);
        let h = balance.histories(spend.purpose(), true);
        let started = std::time::Instant::now();
        let picked = paying.apart(&available, &h);
        let took = started.elapsed();
        worst = worst.max(took);
        println!(
            "per {per}: {spend:?}: {} in {took:?}",
            match &picked {
                Ok(inputs) => format!("{} inputs", inputs.len()),
                Err(e) => format!("refused ({e})"),
            }
        );
    }
    worst
}

#[test]
fn twelve_boxes_whose_sets_take_many_counts_of_change_outputs_plan_in_a_second() {
    let mut worst = std::time::Duration::ZERO;
    for per in [20u32, 10, 7] {
        worst = worst.max(many_outputs(per));
    }
    println!("the slowest: {worst:?}");
    assert!(
        worst < std::time::Duration::from_secs(if cfg!(debug_assertions) { 3 } else { 1 }),
        "the slowest selection took {worst:?}"
    );
}

/// The same with the bytes in the change of the token sent, and a pool's way back: a Send of 1 TOK and 50 ₳. H, made
/// private, holds TOK and `kinds` other kinds; B0, a plain box of 42 ₳; B1, a plain box of 20 ₳ holding one token of
/// its pool; 19 payments received of 2 ₳ each. B0 pays only beside so many payments that it's too large; B0 and B1
/// beside H alone pay and fit.
#[test]
fn after_a_build_too_large_a_level_beside_the_holders_change_is_still_tried_beside_less() {
    use seedelf_core::assets::Asset as Token;
    let w = world();
    let p = &w.chain.params;
    let sent = Token::new(TOKEN_POLICY.into(), hex::encode("TOK"), 1).unwrap();
    let pay = vec![build::Payment {
        register: w.owner.clone().rerandomize().unwrap(),
        lovelace: 50 * ADA,
        tokens: Assets::new().add(sent).unwrap(),
    }];
    let received: Vec<UtxoResponse> = (0..19u32)
        .map(|i| utxo(&w, 0x5100_0100 + i, 2 * ADA, None))
        .collect();
    let b0 = utxo(&w, 0x5100_0001, 42 * ADA, None);
    let b1 = token_box(&w, 0x5100_0002, 20 * ADA, 1, 0x7300);
    let pays = |inputs: &[&UtxoResponse]| -> Verdict {
        let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
        match build::transfer_from(&w.chain, &inputs, &pay, &w.owner, w.signer)
            .and_then(|s| s.estimate().map(|_| ()))
        {
            Ok(()) => Verdict::Pays,
            Err(e) if build::is_short(&e) => Verdict::Short,
            Err(_) => Verdict::Failed,
        }
    };
    for kinds in (150..=260u32).step_by(4) {
        let mut h = token_box(&w, 0x5100_0000, 0, kinds, 0x2000);
        h.asset_list.as_mut().unwrap().push(Asset {
            decimals: 0,
            quantity: "1".into(),
            policy_id: TOKEN_POLICY.into(),
            asset_name: hex::encode("TOK"),
            fingerprint: String::new(),
        });
        let (_, held) = seedelf_core::utxos::assets_of(vec![h.clone()]).unwrap();
        h.value = (build::minimum_deposit(p, &held).unwrap() + ADA / 2).to_string();
        let with = |boxes: &[&UtxoResponse], k: usize| -> Verdict {
            let all: Vec<&UtxoResponse> = std::iter::once(&h)
                .chain(boxes.iter().copied())
                .chain(received[..k].iter())
                .collect();
            pays(&all)
        };
        let first = (0..=19)
            .find(|&k| with(&[&b0], k) != Verdict::Short)
            .map(|k| (k, with(&[&b0], k)));
        let pair = with(&[&b0, &b1], 0);
        let b1_first = (0..=19)
            .find(|&k| with(&[&b1], k) != Verdict::Short)
            .map(|k| (k, with(&[&b1], k)));
        println!(
            "kinds {kinds}: B0 first not short {first:?}, B1 first not short {b1_first:?}, B0+B1 beside H alone {pair:?}"
        );
        if first.is_some_and(|(_, v)| v == Verdict::Failed)
            && b1_first.is_none_or(|(_, v)| v == Verdict::Failed)
            && pair == Verdict::Pays
        {
            let mut rows: Vec<(UtxoResponse, Kind)> = vec![
                (b0.clone(), Kind::Plain),
                (b1.clone(), Kind::Plain),
                (h.clone(), Kind::Own),
            ];
            rows.extend(received.iter().cloned().map(|u| (u, Kind::Received)));
            let balance = Balance {
                boxes: 2,
                distinct: 20,
                smalls: 0,
                small: 2 * ADA,
                items: rows,
            };
            let available: Vec<UtxoResponse> =
                balance.items.iter().map(|(u, _)| u.clone()).collect();
            let hs = balance.histories(Purpose::Pay, true);
            let picked = build::transfer_apart(&w.chain, &available, &hs, &pay, &w.owner, w.signer)
                .map(|s| s.inputs());
            match &picked {
                Ok(inputs) => println!(
                    "picked {} inputs, boxes {:?}",
                    inputs.len(),
                    inputs
                        .iter()
                        .filter(|u| balance.position(u) < 2)
                        .map(|u| ["B0", "B1"][balance.position(u)])
                        .collect::<Vec<_>>()
                ),
                Err(e) => println!("refused: {e}"),
            }
            assert!(picked.is_ok(), "B0 and B1 beside H pay in one transaction");
            return;
        }
    }
    panic!("no window");
}
