//! The box rule, held to a brute force (chunk 51, round six: every fix round so far broke the merge order where the
//! last left it, so this pins the rule, not one shape). Seeded private balances of boxes back from Lovejoin, each one
//! a mix moved, a plain way back or one of unknown making, some a token pool's holding its token, beside a few other
//! UTxOs (money made private, payments received, a session's money) and in some more small payments than one
//! transaction spends. For a Send, a Make public and a session's funding over each, every set of the UTxOs that pays is
//! built, as selection's own attempt builds it, and the best by the rule is the one selection must match:
//!
//! - one UTxO that pays alone, by the purpose's rank, and among boxes of one rank a box a mix moved, then a plain one,
//!   then one of unknown making, before size (l5still#3);
//! - merging, in one strict order: never refused where anything pays (1e1b0647 paid every such set too, so nothing it
//!   built is refused now; l5merge#2); as few boxes of unknown making as pay, none where the others pay without one;
//!   as few boxes as pay; of as many, the most a mix moved; and never more of the other inputs than the plain choice's
//!   build, the same balance's where no box is known to be mixed (l5merge#3, l5still#2).
//!
//! The boxes' sizes are spaced so that a token pool's way back, weighed by what it adds (its ADA less its token's
//! least: the rule's weight), sorts among boxes of ADA alone as the change it pays into does: within a box's least of
//! another's, the two would weigh one way and pay the other (round six's notes).
//!
//! The default runs a handful of balances in seconds: `cargo test -p seedelf-core --test box_rule_reference_test`.
//! A sweep of many more: the same with `-- --ignored --nocapture` (a few minutes in release).

use std::collections::{BTreeMap, BTreeSet};

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

/// One balance: its UTxOs, each with what made it, the boxes first, then the other money, then `smalls` payments
/// received of 2 ₳ each (one transaction spends no more than 22 inputs).
struct Balance {
    items: Vec<(UtxoResponse, Kind)>,
    boxes: usize,
    distinct: usize,
    smalls: usize,
}

impl Balance {
    fn histories(&self, purpose: Purpose, mixed_known: bool) -> Histories {
        self.items
            .iter()
            .fold(Histories::new(purpose), |h, (u, k)| {
                h.with(&u.tx_hash, u.tx_index, k.class(&u.tx_hash, mixed_known))
            })
    }

    fn kind_of(&self, u: &UtxoResponse) -> Kind {
        self.items
            .iter()
            .find(|(x, _)| x.tx_hash == u.tx_hash && x.tx_index == u.tx_index)
            .map(|(_, k)| *k)
            .expect("a UTxO of the balance")
    }

    fn describe(&self) -> String {
        self.items
            .iter()
            .take(self.boxes + self.distinct)
            .map(|(u, k)| {
                let token = if u.asset_list.as_ref().is_some_and(|a| !a.is_empty()) {
                    "+token"
                } else {
                    ""
                };
                format!("{k:?} {}{token}", ada(u.value.parse().unwrap()))
            })
            .chain((self.smalls > 0).then(|| format!("{} received of 2 ₳", self.smalls)))
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
}

impl Spend {
    fn purpose(&self) -> Purpose {
        match self {
            Spend::Fund(_) => Purpose::Fund {
                session: Some("session:7".into()),
            },
            _ => Purpose::Pay,
        }
    }

    /// What it pays out: inputs holding no more can't pay, and selection doesn't ask.
    fn floor(&self) -> u64 {
        match self {
            Spend::Send(l) | Spend::Public(l) => *l,
            Spend::Fund(l) => l + 5 * ADA,
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
        }
    }
}

/// A Spend's outputs, made once, and selection's attempt over exactly some inputs.
struct Paying<'w> {
    w: &'w World,
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
                (u.value.parse().unwrap(), token)
            })
            .collect();
        key.sort();
        if let Some(v) = self.known.get(&key) {
            return *v;
        }
        self.builds += 1;
        let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
        let built = if self.addresses.is_empty() {
            build::transfer_from(
                &self.w.chain,
                &inputs,
                &self.seedelfs,
                &self.w.owner,
                self.w.signer,
            )
        } else {
            build::sweep_many_from(
                &self.w.chain,
                &inputs,
                &self.addresses,
                &self.w.owner,
                self.w.signer,
            )
        }
        .and_then(|s| s.estimate().map(|_| ()));
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
        if self.addresses.is_empty() {
            build::transfer_apart(
                &self.w.chain,
                available,
                h,
                &self.seedelfs,
                &self.w.owner,
                self.w.signer,
            )
        } else {
            build::sweep_many_apart(
                &self.w.chain,
                available,
                h,
                &self.addresses,
                &self.w.owner,
                self.w.signer,
            )
        }
        .map(|s| s.inputs())
    }
}

/// A set of boxes as the rule weighs it: how many of unknown making, how many in all, how many a mix moved.
fn boxes_key(b: &BTreeSet<usize>, balance: &Balance) -> (usize, usize, usize) {
    let kinds: Vec<Kind> = b.iter().map(|&i| balance.items[i].1).collect();
    (
        kinds.iter().filter(|k| **k == Kind::Unknown).count(),
        kinds.len(),
        kinds.iter().filter(|k| **k == Kind::Mixed).count(),
    )
}

/// The boxes in `mask`, as positions in the balance.
fn boxes_in(mask: u32, balance: &Balance) -> BTreeSet<usize> {
    (0..balance.boxes)
        .filter(|i| mask & (1 << i) != 0)
        .collect()
}

/// Whether the boxes in `bmask` pay beside some of the other money: each set of the other UTxOs, and of the payments
/// received of 2 ₳, which are alike, the fewest beside them that get past the floor, then one more at a time.
fn pays_beside(balance: &Balance, spend: &Spend, paying: &mut Paying, bmask: u32) -> bool {
    let floor = u128::from(spend.floor());
    let lovelace = |u: &UtxoResponse| u128::from(u.value.parse::<u64>().unwrap());
    let (nb, nd, ns) = (balance.boxes, balance.distinct, balance.smalls);
    let small = |s: usize| -> Vec<&UtxoResponse> {
        balance.items[nb + nd..nb + nd + s]
            .iter()
            .map(|(u, _)| u)
            .collect()
    };
    let each = 2 * u128::from(ADA);
    for dmask in 0..(1u32 << nd) {
        let chosen: Vec<&UtxoResponse> = (0..nb)
            .filter(|i| bmask & (1 << i) != 0)
            .chain((0..nd).filter(|i| dmask & (1 << i) != 0).map(|i| nb + i))
            .map(|i| &balance.items[i].0)
            .collect();
        let held: u128 = chosen.iter().map(|u| lovelace(u)).sum();
        if held + each * ns as u128 <= floor {
            continue;
        }
        let from = if held > floor {
            0
        } else {
            usize::try_from((floor - held) / each + 1).unwrap()
        };
        for s in from..=ns {
            if chosen.is_empty() && s == 0 {
                continue;
            }
            let inputs: Vec<&UtxoResponse> = chosen.iter().copied().chain(small(s)).collect();
            match paying.verdict(&inputs) {
                Verdict::Pays => return true,
                Verdict::Failed => break,
                Verdict::Short => {}
            }
        }
    }
    false
}

/// The best a set that pays can be by the rule's first two counts, over every set of the UTxOs: the fewest boxes of
/// unknown making, then the fewest boxes. Searched in that order, so it stops at the first that pays; None where no
/// set pays.
fn best_paying(balance: &Balance, spend: &Spend, paying: &mut Paying) -> Option<(usize, usize)> {
    let mut levels: BTreeMap<(usize, usize), Vec<u32>> = BTreeMap::new();
    for bmask in 0..(1u32 << balance.boxes) {
        let (u, n, _) = boxes_key(&boxes_in(bmask, balance), balance);
        levels.entry((u, n)).or_default().push(bmask);
    }
    levels.into_iter().find_map(|(level, masks)| {
        masks
            .into_iter()
            .any(|bmask| pays_beside(balance, spend, paying, bmask))
            .then_some(level)
    })
}

/// What the brute force says of one Spend over one balance, or why selection's pick isn't as good.
fn check(w: &World, balance: &Balance, spend: &Spend, tally: &mut Tally) -> Result<(), String> {
    let available: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let purpose = spend.purpose();
    let h = balance.histories(purpose.clone(), true);
    let mut paying = Paying::new(w, spend);
    let t0 = std::time::Instant::now();
    let picked = paying.apart(&available, &h);
    tally.apart_ms += t0.elapsed().as_millis();
    let t0 = std::time::Instant::now();
    let best = best_paying(balance, spend, &mut paying);
    tally.reference_ms += t0.elapsed().as_millis();
    tally.builds += paying.builds;
    let picked_text = match &picked {
        Ok(inputs) => describe_inputs(balance, inputs),
        Err(e) => format!("nothing: {e}"),
    };
    let said = |what: String| {
        format!(
            "{spend:?} over [{}]: {what}; selection picked {picked_text}",
            balance.describe(),
        )
    };
    // Never refused where anything pays (1e1b0647 paid no set this misses).
    let Some(best) = best else {
        tally.unpaid += 1;
        return match picked {
            Err(_) => Ok(()),
            Ok(_) => Err(said("no set of these UTxOs pays".into())),
        };
    };
    let picked = picked.map_err(|_| said("refused where a set pays".into()))?;
    if balance.smalls > 0 {
        tally.past_the_limit += 1;
    }

    // One UTxO that pays alone: by the purpose's rank, then the box rank, then the smallest.
    let made = |u: &UtxoResponse| {
        let c = h.class_of(u);
        if balance.kind_of(u).is_box() {
            build::box_rank(&c)
        } else {
            0
        }
    };
    let alone_key = |u: &UtxoResponse| (h.rank_of(u), made(u), u.value.parse::<u64>().unwrap());
    let alone: Vec<&UtxoResponse> = balance
        .items
        .iter()
        .map(|(u, _)| u)
        .filter(|u| paying.verdict(&[u]) == Verdict::Pays)
        .collect();
    if let Some(best) = alone.iter().map(|u| alone_key(u)).min() {
        tally.alone += 1;
        return match picked.as_slice() {
            [one] if alone_key(one) == best => Ok(()),
            _ => Err(said(format!(
                "one UTxO pays alone, the best by (rank, box rank, size) {best:?}"
            ))),
        };
    }
    tally.merged += 1;

    // Merging: the fewest of unknown making, then the fewest boxes, over every set that pays.
    let at: Vec<usize> = picked
        .iter()
        .map(|u| {
            balance
                .items
                .iter()
                .position(|(x, _)| x.tx_hash == u.tx_hash)
                .unwrap()
        })
        .collect();
    let picked_boxes: BTreeSet<usize> = at.iter().copied().filter(|&i| i < balance.boxes).collect();
    let picked_others: BTreeSet<usize> =
        at.iter().copied().filter(|&i| i >= balance.boxes).collect();
    let (u, n, m) = boxes_key(&picked_boxes, balance);
    if (u, n) != best {
        return Err(said(format!(
            "{u} of unknown making and {n} boxes, where (of unknown making, boxes) {best:?} pay"
        )));
    }

    // The plain choice's build: the same balance, no box known to be mixed.
    let plain = paying
        .apart(&available, &balance.histories(purpose, false))
        .map_err(|e| said(format!("with no box known to be mixed, refused: {e}")))?;
    let plain_others: BTreeSet<usize> = plain
        .iter()
        .map(|u| {
            balance
                .items
                .iter()
                .position(|(x, _)| x.tx_hash == u.tx_hash)
                .unwrap()
        })
        .filter(|&i| i >= balance.boxes)
        .collect();
    let plain_boxes: BTreeSet<usize> = plain
        .iter()
        .filter_map(|u| (0..balance.boxes).find(|&i| balance.items[i].0.tx_hash == u.tx_hash))
        .collect();
    let (pu, pn, _) = boxes_key(&plain_boxes, balance);
    if (pu, pn) != best {
        return Err(said(format!(
            "with no box known to be mixed, {pu} of unknown making and {pn} boxes, where {best:?} pay"
        )));
    }
    if !picked_others.is_subset(&plain_others) {
        return Err(said(format!(
            "it took other inputs the plain choice's build didn't ({})",
            describe_inputs(balance, &plain)
        )));
    }
    // Of as many, the most a mix moved, beside no more than the plain choice's other inputs.
    let beside: Vec<&UtxoResponse> = plain_others.iter().map(|&i| &balance.items[i].0).collect();
    let most = (0..(1u32 << balance.boxes))
        .map(|mask| boxes_in(mask, balance))
        .filter(|b| {
            let (bu, bn, _) = boxes_key(b, balance);
            (bu, bn) == best
        })
        .filter(|b| {
            let inputs: Vec<&UtxoResponse> = b
                .iter()
                .map(|&i| &balance.items[i].0)
                .chain(beside.iter().copied())
                .collect();
            paying.verdict(&inputs) == Verdict::Pays
        })
        .map(|b| boxes_key(&b, balance).2)
        .max()
        .unwrap_or(0);
    if m != most {
        return Err(said(format!(
            "{m} boxes a mix moved, where {most} of as many pay beside the plain choice's other inputs"
        )));
    }
    Ok(())
}

fn describe_inputs(balance: &Balance, inputs: &[UtxoResponse]) -> String {
    let mut smalls = 0;
    let mut named: Vec<String> = Vec::new();
    for u in inputs {
        let i = balance
            .items
            .iter()
            .position(|(x, _)| x.tx_hash == u.tx_hash)
            .unwrap();
        if i >= balance.boxes + balance.distinct {
            smalls += 1;
        } else {
            let (_, k) = &balance.items[i];
            named.push(format!("{k:?} {}", ada(u.value.parse().unwrap())));
        }
    }
    if smalls > 0 {
        named.push(format!("{smalls} received of 2 ₳"));
    }
    format!("[{}]", named.join(", "))
}

#[derive(Default, Debug)]
struct Tally {
    unpaid: usize,
    alone: usize,
    merged: usize,
    past_the_limit: usize,
    builds: usize,
    apart_ms: u128,
    reference_ms: u128,
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A balance and three spends over it, from `seed`: up to `most_boxes` boxes, up to three other UTxOs, and in some
/// (in all, `past_the_limit`) 18 to 25 payments received of 2 ₳.
fn balance(w: &World, seed: u64, most_boxes: u64, past_the_limit: bool) -> (Balance, Vec<Spend>) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut n = u32::try_from(seed % 100_000).unwrap() * 64;
    let mut next = || {
        n += 1;
        n
    };
    let boxes = 1 + rng.below(most_boxes) as usize;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    for _ in 0..boxes {
        let kind = match rng.below(100) {
            0..40 => Kind::Mixed,
            40..75 => Kind::Plain,
            _ => Kind::Unknown,
        };
        // Spaced so a token's least (about 1.2 ₳) never puts a token pool's way back on the other side of another
        // box by weight from where it stands by what it pays.
        let u = if rng.below(5) == 0 {
            let lovelace = [7_500_000, 14_500_000][rng.below(2) as usize];
            let pool = ["poolA", "poolB"][rng.below(2) as usize];
            utxo(w, next(), lovelace, Some(pool))
        } else {
            let lovelace = [4_710_000, 9_710_000, 19_710_000, 24_710_000][rng.below(4) as usize];
            utxo(w, next(), lovelace, None)
        };
        items.push((u, kind));
    }
    let smalls = if past_the_limit || rng.below(10) < 3 {
        18 + rng.below(8) as usize
    } else {
        0
    };
    let mut kinds = vec![Kind::Own, Kind::Received, Kind::Received, Kind::OwnSession];
    if smalls == 0 {
        kinds.push(Kind::OtherSession);
    }
    let distinct = rng.below(4) as usize;
    for _ in 0..distinct {
        let kind = kinds.remove(rng.below(kinds.len() as u64) as usize);
        let lovelace =
            [1_500_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000][rng.below(5) as usize];
        items.push((utxo(w, next(), lovelace, None), kind));
    }
    for _ in 0..smalls {
        items.push((utxo(w, next(), 2 * ADA, None), Kind::Received));
    }
    let total: u64 = items
        .iter()
        .map(|(u, _)| u.value.parse::<u64>().unwrap())
        .sum();
    let mut amount = || {
        let tenths = (total / (ADA / 10)).saturating_sub(20).max(1);
        ADA * 2 + rng.below(tenths) * (ADA / 10)
    };
    let send = amount();
    let public = amount();
    let fund = amount().saturating_sub(5 * ADA).max(ADA);
    (
        Balance {
            items,
            boxes,
            distinct,
            smalls,
        },
        vec![Spend::Send(send), Spend::Public(public), Spend::Fund(fund)],
    )
}

fn sweep(seeds: std::ops::Range<u64>, most_boxes: u64, past_the_limit: bool) -> Tally {
    let w = world();
    let mut tally = Tally::default();
    let mut wrong = Vec::new();
    for seed in seeds {
        let (balance, spends) = balance(&w, seed, most_boxes, past_the_limit);
        for spend in &spends {
            if let Err(e) = check(&w, &balance, spend, &mut tally) {
                wrong.push(format!("seed {seed}: {e}"));
            }
        }
    }
    println!("{tally:?}");
    assert!(
        wrong.is_empty(),
        "selection's pick isn't the best by the box rule ({} of them):\n{}",
        wrong.len(),
        wrong.join("\n")
    );
    tally
}

/// The default, in four parts run side by side: balances of up to six boxes, some past what one transaction spends.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_first() {
    let tally = sweep(0..6, 6, false);
    assert!(tally.merged > 0 && tally.alone > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_second() {
    let tally = sweep(6..12, 6, false);
    assert!(tally.merged > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_third() {
    let tally = sweep(12..18, 6, false);
    assert!(tally.merged > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_fourth() {
    let tally = sweep(18..24, 6, false);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// Past what one transaction spends: where a and b can't take every other UTxO before the boxes, order c brings the
/// boxes forward, and a mixed box's choice may take no more of the other inputs than the plain one's (l5merge#3).
#[test]
fn selection_picks_the_best_set_by_the_box_rule_past_the_input_limit() {
    let tally = sweep(110..122, 7, true);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// The sweep: many more balances, of up to eight boxes.
#[test]
#[ignore]
fn selection_picks_the_best_set_by_the_box_rule_over_many_balances() {
    let tally = sweep(1_000..1_400, 8, false);
    assert!(
        tally.merged > 0 && tally.alone > 0 && tally.past_the_limit > 0,
        "{tally:?}"
    );
}

/// Chunk 51, round six: the box rule's search stays polynomial in the boxes. Five hundred boxes back from Lovejoin, a
/// mix's, plain and of unknown making, with and without more small payments than one transaction spends: a payment
/// that builds, one only boxes of unknown making pay, and one too large for one transaction, each in seconds at most
/// (about a second in release).
#[test]
fn five_hundred_boxes_build_a_spend_in_seconds() {
    let w = world();
    let mut rng = Rng(0x5eed_0500);
    let mut n = 9_000_000u32;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    for i in 0..500u32 {
        n += 1;
        let kind = match i % 5 {
            0 | 1 => Kind::Mixed,
            2 | 3 => Kind::Plain,
            _ => Kind::Unknown,
        };
        let lovelace = [4_710_000, 9_710_000, 19_710_000, 24_710_000][rng.below(4) as usize];
        let token = (rng.below(10) == 0).then_some("poolA");
        items.push((utxo(&w, n, lovelace, token), kind));
    }
    let smalls: Vec<(UtxoResponse, Kind)> = (0..25)
        .map(|_| {
            n += 1;
            (utxo(&w, n, 2 * ADA, None), Kind::Received)
        })
        .collect();
    let unknown_only: Vec<(UtxoResponse, Kind)> = items
        .iter()
        .filter(|(_, k)| *k == Kind::Unknown)
        .cloned()
        .chain(
            items
                .iter()
                .filter(|(_, k)| *k == Kind::Plain)
                .take(3)
                .cloned(),
        )
        .collect();
    let mut worst = std::time::Duration::ZERO;
    for (name, items, spend, builds) in [
        (
            "500 boxes, a Send of 100 ₳",
            items.clone(),
            Spend::Send(100 * ADA),
            true,
        ),
        (
            "500 boxes, a funding of 95 ₳",
            items.clone(),
            Spend::Fund(95 * ADA),
            true,
        ),
        (
            "500 boxes and 25 payments, a Make public of 100 ₳",
            [items.clone(), smalls.clone()].concat(),
            Spend::Public(100 * ADA),
            true,
        ),
        (
            "100 of unknown making and 3 plain, a Send of 120 ₳",
            unknown_only.clone(),
            Spend::Send(120 * ADA),
            true,
        ),
        (
            "500 boxes, a Send of 2,000 ₳, too large for one",
            items.clone(),
            Spend::Send(2_000 * ADA),
            false,
        ),
        (
            "500 boxes and 25 payments, a Send of 2,000 ₳",
            [items.clone(), smalls.clone()].concat(),
            Spend::Send(2_000 * ADA),
            false,
        ),
    ] {
        let balance = Balance {
            boxes: items.len(),
            distinct: 0,
            smalls: 0,
            items,
        };
        let available: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
        let paying = Paying::new(&w, &spend);
        let started = std::time::Instant::now();
        let picked = paying.apart(&available, &balance.histories(spend.purpose(), true));
        let took = started.elapsed();
        worst = worst.max(took);
        println!(
            "{name}: {} in {took:?}",
            match &picked {
                Ok(inputs) => format!("{} inputs", inputs.len()),
                Err(e) => format!("refused ({e})"),
            }
        );
        assert_eq!(picked.is_ok(), builds, "{name}");
    }
    assert!(worst < std::time::Duration::from_secs(30), "{worst:?}");
}
