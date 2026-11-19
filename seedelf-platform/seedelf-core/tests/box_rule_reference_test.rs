//! The box rule, held to a brute force that takes none of its expected answers from selection's own code (chunk 51,
//! rounds six and seven: every fix round broke the merge order where the last left it, and round six's reference read
//! its step-1 key and its rule-5 baseline from the code it checked, l6reference#6). Seeded private balances of boxes
//! back from Lovejoin, each one a mix moved, a plain way back or one of unknown making, some a token pool's holding its
//! token, beside a few other UTxOs (money made private, payments received, the funding's own session's money, another
//! session's) and in some more small payments than one transaction spends. For a Send, a Make public, a session's
//! funding and a stealth mint over each, every set of the UTxOs that pays is built, as selection's own attempt builds
//! it, and the best by the rule is the one selection must match:
//!
//! - rule 1: nothing 1e1b0647's selection sent as one transaction is refused (its selection is copied below, `old`, and
//!   run over the same balance), and nothing is refused where any set pays (what `old` built, some set pays, so it only
//!   names the failure the second check makes: l7reference#1);
//! - one UTxO that pays alone: by the purpose's rank, from this file's own table, and among boxes of one rank a box a
//!   mix moved, then a plain one, then one of unknown making (read from each class's origin and tags), before size; a
//!   stealth mint ranks those boxes alike (l5still#3, l6reference#9);
//! - merging, in one strict order: as few boxes of unknown making as pay, none where the others pay without one; as
//!   few boxes as pay; of as many, the most a mix moved; never more of the other inputs than the plain choice's build;
//!   then the purpose's order and size. The plain choice and the other inputs its build takes (rule 5's baseline) are
//!   this file's own: the boxes the rule weighs largest (a box of ADA alone by its ADA, one holding tokens by its ADA
//!   less what its tokens add to an ADA change's least, from the ledger's own least), beside all the other money where
//!   one transaction takes that, else beside as few of it as pay, the largest first with a funding's last resort
//!   (another session's money) after the rest, then the largest first whatever the tier (l6reference#1). No balance's
//!   other money holds a token and no spend sends one, so every change here keeps none and that weight is the one
//!   beside what a change keeps (l7merge#2); mint_test pins that weight beside tokens, and token_holders_test the rule
//!   beside the UTxOs holding a token sent (l7reference#4).
//!
//! Its balances reach the windows round six's last look found: another session's money beside more payments than one
//! transaction spends (l6reference#1); a box of ADA alone weighing between a token pool's way back's ADA less its
//! token's whole least and what that box pays beside a change (l6reference#2); token pools' ways back near their least
//! beside 21 payments at the input limit (l6still#1); boxes of unknown making that a set without them pays
//! (l6reference#3). And those round seven's found: a box of ADA alone between what a token pool's way back pays beside
//! a change and the ADA it holds, which a weight by its ADA can't tell apart (BAND, l7reference#2); two ways back of
//! one pool beside such boxes at the input limit, where only 1e1b0647's own orders build what pays, and with boxes of
//! unknown making, where those orders must run before the first of them (`pair_band`, l7reference#1, l7still#1,
//! l7still#2), checked there within the rule's stated margin: none of unknown making where a set without one pays,
//! strictly, and past one, one more of them than pays at most; one box more than the fewest that pay at most; rules 4
//! and 5 unasked.
//!
//! The default runs a handful of balances in seconds: `cargo test -p seedelf-core --test box_rule_reference_test`.
//! A sweep of many more: the same with `-- --ignored --nocapture` (a minute or two in release).

use std::collections::{BTreeMap, BTreeSet};

use pallas_addresses::{
    Address, Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::SecretKey;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_core::address::wallet_contract;
use seedelf_core::assets::{Asset as Token, Assets};
use seedelf_core::build::{
    self, AddressPayment, Chain, Class, Histories, Origin, Payment, Purpose,
};
use seedelf_core::constants::get_config;
use seedelf_core::transaction::{seedelf_minimum_lovelace, wallet_minimum_lovelace_with_assets};
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

/// Step 1's key for one UTxO that pays alone, this file's own (from build.rs's `Purpose` docs, not its code): the
/// purpose's rank of what made it (Send and Make public take money made private first and boxes last; a funding its
/// own session's money first, then payments received, then boxes, money made private late and another session's
/// last; a stealth mint a box a mix moved first, then payments received, then any other box), then among boxes of one
/// rank a mixed one, a plain one, one of unknown making, though a stealth mint ranks those alike, then the smallest.
fn alone_key(spend: &Spend, kind: Kind, class: &Class, lovelace: u64) -> (u8, u8, u64) {
    let rank = match spend {
        Spend::Send(_) | Spend::Public(_) => match kind {
            Kind::Own => 0,
            Kind::OwnSession | Kind::OtherSession => 1,
            Kind::Received => 2,
            Kind::Mixed => 4,
            Kind::Plain | Kind::Unknown => 5,
        },
        Spend::Fund(_) => match kind {
            Kind::OwnSession => 0,
            Kind::Received => 1,
            Kind::Mixed => 2,
            Kind::Plain | Kind::Unknown => 3,
            Kind::Own => 6,
            Kind::OtherSession => 7,
        },
        Spend::Mint => match kind {
            Kind::Mixed => 0,
            Kind::Received => 1,
            Kind::Plain | Kind::Unknown => 2,
            Kind::Own => 5,
            Kind::OwnSession | Kind::OtherSession => 6,
        },
    };
    let made = if kind.is_box() && !matches!(spend, Spend::Mint) {
        made_of(class)
    } else {
        0
    };
    (rank, made, lovelace)
}

/// Whether a merge takes `kind` only after the rest of the other money, this file's own: a funding's last resort,
/// another session's money.
fn last_resort(spend: &Spend, kind: Kind) -> bool {
    matches!((spend, kind), (Spend::Fund(_), Kind::OtherSession))
}

/// What a box pays beside the change a spend makes anyway, from the ledger's own least of a Seedelf output: its ADA
/// where it holds no token, else its ADA less what its tokens add to that change's least.
fn weight_of(params: &ProtocolParameters, u: &UtxoResponse) -> u128 {
    let lovelace = u128::from(lovelace_of(u));
    let tokens = u.asset_list.iter().flatten().fold(Assets::new(), |all, a| {
        let quantity = a.quantity.parse().unwrap();
        all.add(Token::new(a.policy_id.clone(), a.asset_name.clone(), quantity).unwrap())
            .unwrap()
    });
    if tokens.items.is_empty() {
        return lovelace;
    }
    let least = |t: Assets| u128::from(wallet_minimum_lovelace_with_assets(params, t).unwrap());
    lovelace - (least(tokens) - least(Assets::new()))
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

/// Whether the boxes in `bmask` pay beside some of the other money: each set of the other UTxOs, and of the small
/// payments, which are alike, the fewest beside them that get past the floor, then one more at a time.
fn pays_beside(balance: &Balance, spend: &Spend, paying: &mut Paying, bmask: u32) -> bool {
    let floor = u128::from(spend.floor(&paying.w.chain.params));
    let (nb, nd, ns) = (balance.boxes, balance.distinct, balance.smalls);
    let small = |s: usize| -> Vec<&UtxoResponse> {
        balance.items[nb + nd..nb + nd + s]
            .iter()
            .map(|(u, _)| u)
            .collect()
    };
    let each = u128::from(balance.small);
    for dmask in 0..(1u32 << nd) {
        let chosen: Vec<&UtxoResponse> = (0..nb)
            .filter(|i| bmask & (1 << i) != 0)
            .chain((0..nd).filter(|i| dmask & (1 << i) != 0).map(|i| nb + i))
            .map(|i| &balance.items[i].0)
            .collect();
        let held: u128 = chosen.iter().map(|u| u128::from(lovelace_of(u))).sum();
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

/// The plain choice at the best level `(u, n)`, and the other inputs its build takes: rule 5's baseline, by the rule's
/// own words. The u boxes of unknown making and the n − u others the rule weighs largest (`weight_of`; of as heavy, a
/// mixed one first, then the balance's order), beside all the other money where one transaction takes that (order a),
/// else beside as few of it as pay, the largest first with a funding's last resort after the rest, or where that runs
/// into the input limit the largest first whatever the tier (order c). The boxes, the other inputs, and whether they
/// were all the other money; None where those boxes pay beside none of it.
fn plain_choice(
    balance: &Balance,
    spend: &Spend,
    paying: &mut Paying,
    (u, n): (usize, usize),
    h: &Histories,
) -> Option<(BTreeSet<usize>, Vec<usize>, bool)> {
    let params = &paying.w.chain.params;
    let floor = u128::from(spend.floor(params));
    let weighed: Vec<(usize, u128, u8)> = (0..balance.boxes)
        .map(|i| {
            let b = &balance.items[i].0;
            (i, weight_of(params, b), made_of(&h.class_of(b)))
        })
        .collect();
    let mut unknown: Vec<&(usize, u128, u8)> = weighed.iter().filter(|b| b.2 == 2).collect();
    unknown.sort_by_key(|b| std::cmp::Reverse(b.1));
    let mut known: Vec<&(usize, u128, u8)> = weighed.iter().filter(|b| b.2 < 2).collect();
    known.sort_by_key(|b| (std::cmp::Reverse(b.1), b.2));
    let chosen: BTreeSet<usize> = unknown
        .iter()
        .take(u)
        .chain(known.iter().take(n - u))
        .map(|b| b.0)
        .collect();
    let boxes: Vec<&UtxoResponse> = chosen.iter().map(|&i| &balance.items[i].0).collect();
    let others: Vec<usize> = (balance.boxes..balance.items.len()).collect();
    let with = |money: &[usize]| -> Vec<&UtxoResponse> {
        boxes
            .iter()
            .copied()
            .chain(money.iter().map(|&i| &balance.items[i].0))
            .collect()
    };
    if paying.verdict(&with(&others)) == Verdict::Pays {
        return Some((chosen, others, true));
    }
    let size = |i: &usize| std::cmp::Reverse(lovelace_of(&balance.items[*i].0));
    let mut largest = others.clone();
    largest.sort_by_key(|i| (last_resort(spend, balance.items[*i].1), size(i)));
    let mut by_size = others.clone();
    by_size.sort_by_key(size);
    let mut orders = vec![largest];
    if by_size != orders[0] {
        orders.push(by_size);
    }
    for order in orders {
        for m in 0..=order.len() {
            let inputs = with(&order[..m]);
            let held: u128 = inputs.iter().map(|u| u128::from(lovelace_of(u))).sum();
            if held <= floor {
                continue;
            }
            match paying.verdict(&inputs) {
                Verdict::Pays => return Some((chosen, order[..m].to_vec(), false)),
                Verdict::Failed => break,
                Verdict::Short => {}
            }
        }
    }
    None
}

/// What the brute force says of one Spend over one balance, or why selection's pick isn't as good.
fn check(w: &World, balance: &Balance, spend: &Spend, tally: &mut Tally) -> Result<(), String> {
    check_with(w, balance, spend, tally, false)
}

/// Whether a set of boxes at `level` (of unknown making, in all) that pays holds two of one token pool.
fn pair_pays_at(
    balance: &Balance,
    spend: &Spend,
    paying: &mut Paying,
    level: (usize, usize),
) -> bool {
    let pool = |i: usize| {
        balance.items[i]
            .0
            .asset_list
            .iter()
            .flatten()
            .map(|a| a.asset_name.clone())
            .next()
    };
    (0..(1u32 << balance.boxes))
        .filter(|&mask| {
            let b = boxes_in(mask, balance);
            let (bu, bn, _) = boxes_key(&b, balance);
            let pools: Vec<String> = b.iter().filter_map(|&i| pool(i)).collect();
            (bu, bn) == level && (1..pools.len()).any(|j| pools[..j].contains(&pools[j]))
        })
        .any(|mask| pays_beside(balance, spend, paying, mask))
}

/// [`check`], and with `margin`, where a set holding two ways back of one token pool pays at the best level, the
/// rule's stated margin there (build.rs's `Weighed::InOne`): none of unknown making where a set without one pays,
/// strictly, and past one, as few as pay or one more; of boxes, the fewest that pay or one more; rules 4 and 5 unasked.
fn check_with(
    w: &World,
    balance: &Balance,
    spend: &Spend,
    tally: &mut Tally,
    margin: bool,
) -> Result<(), String> {
    let available: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let purpose = spend.purpose();
    let h = balance.histories(purpose.clone(), true);
    let mut paying = Paying::new(w, spend);
    let t0 = std::time::Instant::now();
    let picked = paying.apart(&available, &h);
    tally.apart_ms += t0.elapsed().as_millis();
    let t0 = std::time::Instant::now();
    let floor = spend.floor(&w.chain.params);
    let old_built = old::built(&w.chain.params, &available, &h, &purpose, floor, |inputs| {
        paying.verdict(inputs)
    });
    let best = best_paying(balance, spend, &mut paying);
    tally.reference_ms += t0.elapsed().as_millis();
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
    // Rule 1: never refused where 1e1b0647 sent it as one transaction, nor where anything pays.
    if old_built {
        tally.old_built += 1;
        if picked.is_err() {
            return Err(said("refused where 1e1b0647's selection built it".into()));
        }
    }
    let Some(best) = best else {
        tally.unpaid += 1;
        tally.builds += paying.builds;
        return match picked {
            Err(_) => Ok(()),
            Ok(_) => Err(said("no set of these UTxOs pays".into())),
        };
    };
    let picked = picked.map_err(|_| said("refused where a set pays".into()))?;
    if balance.smalls > 0 {
        tally.past_the_limit += 1;
    }

    // One UTxO that pays alone: by the purpose's rank, then the box's kind, then the smallest, by this file's table.
    let key_of = |u: &UtxoResponse| {
        let kind = balance.items[balance.position(u)].1;
        alone_key(spend, kind, &h.class_of(u), lovelace_of(u))
    };
    let alone: Vec<&UtxoResponse> = balance
        .items
        .iter()
        .map(|(u, _)| u)
        .filter(|u| paying.verdict(&[u]) == Verdict::Pays)
        .collect();
    if let Some(best) = alone.iter().map(|u| key_of(u)).min() {
        tally.alone += 1;
        tally.builds += paying.builds;
        return match picked.as_slice() {
            [one] if key_of(one) == best => Ok(()),
            _ => Err(said(format!(
                "one UTxO pays alone, the best by (rank, box kind, size) {best:?}"
            ))),
        };
    }
    tally.merged += 1;

    // Merging: the fewest of unknown making, then the fewest boxes, over every set that pays.
    let at: BTreeSet<usize> = picked.iter().map(|u| balance.position(u)).collect();
    let picked_boxes: BTreeSet<usize> = at.iter().copied().filter(|&i| i < balance.boxes).collect();
    let picked_others: BTreeSet<usize> =
        at.iter().copied().filter(|&i| i >= balance.boxes).collect();
    let (u, n, m) = boxes_key(&picked_boxes, balance);
    if margin && pair_pays_at(balance, spend, &mut paying, best) {
        tally.builds += paying.builds;
        tally.pair += 1;
        let unknown_ok = u == best.0 || (best.0 > 0 && u == best.0 + 1);
        tally.one_more_unknown += usize::from(u > best.0);
        return if unknown_ok && (n == best.1 || n == best.1 + 1) {
            Ok(())
        } else {
            Err(said(format!(
                "{u} of unknown making and {n} boxes, where (of unknown making, boxes) {best:?} pay, two ways back of \
                 one pool among them"
            )))
        };
    }
    if (u, n) != best {
        tally.builds += paying.builds;
        return Err(said(format!(
            "{u} of unknown making and {n} boxes, where (of unknown making, boxes) {best:?} pay"
        )));
    }
    // With no box to merge, rules 4 and 5 ask nothing: the other money goes by the purpose's order.
    if n == 0 {
        tally.builds += paying.builds;
        return Ok(());
    }
    // Rule 5's baseline, this file's own: the plain choice and the other inputs its build takes.
    let Some((plain_boxes, plain_others, all_of_it)) =
        plain_choice(balance, spend, &mut paying, best, &h)
    else {
        tally.builds += paying.builds;
        return Err(said(format!(
            "at {best:?}, the boxes the rule weighs largest pay beside none of the other money"
        )));
    };
    let plain_set: BTreeSet<usize> = plain_others.iter().copied().collect();
    let describe_at = |at: &[usize]| {
        let inputs: Vec<UtxoResponse> = at.iter().map(|&i| balance.items[i].0.clone()).collect();
        describe_inputs(balance, &inputs)
    };
    let plain_text = describe_at(
        &plain_boxes
            .iter()
            .chain(&plain_others)
            .copied()
            .collect::<Vec<_>>(),
    );
    if picked_boxes == plain_boxes {
        if picked_others != plain_set {
            tally.builds += paying.builds;
            return Err(said(format!(
                "the plain choice's boxes beside other inputs than its build takes ({plain_text})"
            )));
        }
    } else {
        let (_, _, plain_mixed) = boxes_key(&plain_boxes, balance);
        if m <= plain_mixed {
            tally.builds += paying.builds;
            return Err(said(format!(
                "other boxes than the plain choice's ({plain_text}), with no more a mix moved"
            )));
        }
        if !picked_others.is_subset(&plain_set) || (all_of_it && picked_others != plain_set) {
            tally.builds += paying.builds;
            return Err(said(format!(
                "it took other inputs the plain choice's build didn't ({plain_text})"
            )));
        }
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
    tally.builds += paying.builds;
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
        let i = balance.position(u);
        if i >= balance.boxes + balance.distinct {
            smalls += 1;
        } else {
            let (_, k) = &balance.items[i];
            let token = if holds_tokens(u) { "+token" } else { "" };
            named.push(format!("{k:?} {}{token}", ada(lovelace_of(u))));
        }
    }
    if smalls > 0 {
        named.push(format!("{smalls} received of {}", ada(balance.small)));
    }
    format!("[{}]", named.join(", "))
}

#[derive(Default, Debug)]
struct Tally {
    unpaid: usize,
    alone: usize,
    merged: usize,
    past_the_limit: usize,
    old_built: usize,
    /// Checked within the margin, where two ways back of one pool pay at the best level.
    pair: usize,
    /// Of those, the picks with one box of unknown making more than pay, past the first (the rule's stated margin).
    one_more_unknown: usize,
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

/// The box sizes a balance draws from: boxes of ADA alone, and token pools' ways back holding their token.
#[derive(Clone, Copy)]
struct Sizes {
    ada: &'static [u64],
    token: &'static [u64],
}

/// Round six's: spaced so that no weight of a token pool's way back, its ADA less its token's whole least nor what it
/// pays beside a change, sets it on the other side of another box from where it stands by what it pays.
const SPACED: Sizes = Sizes {
    ada: &[4_710_000, 9_710_000, 19_710_000, 24_710_000],
    token: &[7_500_000, 14_500_000],
};

/// Round seven's (l6reference#2, l6still#1): boxes of ADA alone between a token pool's way back's ADA less its token's
/// whole least and what it pays beside a change (6.6 ₳ beside 7.5 ₳, 13.6 ₳ beside 14.5 ₳, 4.71 ₳ beside 6 ₳), where
/// those two weights disagree; clear of the per-box weight's own margin, the token's share of a change's least that two
/// ways back of one pool pay once and their weights count twice (172,400 lovelace here; 142,230 for two pools of one
/// policy, whose second token adds 30,170).
const WINDOW: Sizes = Sizes {
    ada: &[4_710_000, 6_600_000, 9_710_000, 13_600_000],
    token: &[6_000_000, 7_500_000, 14_500_000],
};

/// Round eight's (l7reference#2): boxes of ADA alone between what a token pool's way back pays beside a change and the
/// ADA it holds (5.9 ₳ beside 6 ₳, 7.4 ₳ beside 7.5 ₳, 14.4 ₳ beside 14.5 ₳), 72,400 lovelace over what it pays, where
/// its one-transaction weight and its ADA order them apart; 5.9 ₳ beside 7.5 ₳ is in WINDOW's window too, where that
/// weight and what a box adds disagree.
const BAND: Sizes = Sizes {
    ada: &[5_900_000, 7_400_000, 14_400_000],
    token: &[6_000_000, 7_500_000, 14_500_000],
};

/// What a part's balances are like.
#[derive(Clone, Copy)]
struct Shape {
    sizes: Sizes,
    most_boxes: u64,
    /// Every balance holds 18 to 25 small payments, more than one transaction spends (else three in ten).
    past_the_limit: bool,
    /// The small payments' size.
    small: u64,
    /// Every balance holds another session's money (round six's balances held it only beside no small payments).
    other_session: bool,
    /// The amounts are drawn near what one box and the other money pay, where weights and the input limit decide.
    near: bool,
    /// Every balance holds exactly one token pool's way back, somewhere among its boxes, so no two boxes share a token's
    /// share of the change's least, the per-box weight's margin (l7reference#2).
    one_token_box: bool,
}

const DEFAULT: Shape = Shape {
    sizes: SPACED,
    most_boxes: 6,
    past_the_limit: false,
    small: 2 * ADA,
    other_session: false,
    near: false,
    one_token_box: false,
};

/// A balance and four spends over it, from `seed`.
fn balance(w: &World, seed: u64, shape: Shape) -> (Balance, Vec<Spend>) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut n = u32::try_from(seed % 100_000).unwrap() * 64;
    let mut next = || {
        n += 1;
        n
    };
    let boxes = 1 + rng.below(shape.most_boxes) as usize;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    // Drawn only where the shape asks, so the other parts' balances stay as they were.
    let token_at = shape
        .one_token_box
        .then(|| rng.below(boxes as u64) as usize);
    for i in 0..boxes {
        let kind = match rng.below(100) {
            0..40 => Kind::Mixed,
            40..75 => Kind::Plain,
            _ => Kind::Unknown,
        };
        let sizes = shape.sizes;
        let token = rng.below(5) == 0;
        let u = if token_at.map_or(token, |at| i == at) {
            let lovelace = sizes.token[rng.below(sizes.token.len() as u64) as usize];
            let pool = ["poolA", "poolB"][rng.below(2) as usize];
            utxo(w, next(), lovelace, Some(pool))
        } else {
            let lovelace = sizes.ada[rng.below(sizes.ada.len() as u64) as usize];
            utxo(w, next(), lovelace, None)
        };
        items.push((u, kind));
    }
    let smalls = if shape.past_the_limit || rng.below(10) < 3 {
        18 + rng.below(8) as usize
    } else {
        0
    };
    let mut kinds = vec![
        Kind::Own,
        Kind::Received,
        Kind::Received,
        Kind::OwnSession,
        Kind::OtherSession,
    ];
    let mut distinct = rng.below(4) as usize;
    if shape.other_session {
        kinds.retain(|k| *k != Kind::OtherSession);
        let lovelace = [5_000_000, 8_000_000, 20_000_000, 40_000_000][rng.below(4) as usize];
        items.push((utxo(w, next(), lovelace, None), Kind::OtherSession));
        distinct = distinct.clamp(1, 3);
        for _ in 1..distinct {
            let kind = kinds.remove(rng.below(kinds.len() as u64) as usize);
            let lovelace =
                [1_500_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000][rng.below(5) as usize];
            items.push((utxo(w, next(), lovelace, None), kind));
        }
    } else {
        for _ in 0..distinct {
            let kind = kinds.remove(rng.below(kinds.len() as u64) as usize);
            let lovelace =
                [1_500_000, 2_000_000, 3_000_000, 5_000_000, 8_000_000][rng.below(5) as usize];
            items.push((utxo(w, next(), lovelace, None), kind));
        }
    }
    for _ in 0..smalls {
        items.push((utxo(w, next(), shape.small, None), Kind::Received));
    }
    let total: u64 = items.iter().map(|(u, _)| lovelace_of(u)).sum();
    let others: u64 = items[boxes..boxes + distinct]
        .iter()
        .map(|(u, _)| lovelace_of(u))
        .sum();
    let in_one = others + shape.small * smalls.min(21) as u64;
    let mut amount = || {
        if shape.near {
            // One box beside the other money, up to 2 ₳ under what it holds.
            let b = lovelace_of(&items[rng.below(boxes as u64) as usize].0);
            (in_one + b)
                .saturating_sub(rng.below(200) * (ADA / 100))
                .max(2 * ADA)
        } else {
            let tenths = (total / (ADA / 10)).saturating_sub(20).max(1);
            ADA * 2 + rng.below(tenths) * (ADA / 10)
        }
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
            small: shape.small,
        },
        vec![
            Spend::Send(send),
            Spend::Public(public),
            Spend::Fund(fund),
            Spend::Mint,
        ],
    )
}

fn sweep(seeds: std::ops::Range<u64>, shape: Shape) -> Tally {
    let w = world();
    let mut tally = Tally::default();
    let mut wrong = Vec::new();
    for seed in seeds {
        let (balance, spends) = balance(&w, seed, shape);
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

/// The most `make` pays with exactly `inputs`, to 1,000 lovelace.
fn most_paid_by(w: &World, make: &dyn Fn(u64) -> Spend, inputs: &[&UtxoResponse]) -> u64 {
    let pays = |l: u64| Paying::new(w, &make(l)).verdict(inputs) == Verdict::Pays;
    let mut hi: u64 = inputs.iter().map(|u| lovelace_of(u)).sum();
    let mut lo = hi / 2;
    assert!(
        pays(lo) && !pays(hi),
        "the set pays half of what it holds and not all"
    );
    while hi - lo > 1_000 {
        let mid = lo + (hi - lo) / 2;
        if pays(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// Round eight's (l7reference#1, l7still#2): where two ways back of one token pool pay their token's share of the
/// change's least once and their weights count it twice, beside boxes of ADA alone that weigh more than either and pay
/// less (5.9 ₳ beside 6 ₳ and poolA's token, or 7.4 ₳ beside 7.5 ₳), at the input limit: the pair, maybe one more box
/// of 4.71 ₳, maybe one other UTxO, 18 to 25 payments received of 10 ₳. A Send, a Make public and a funding, each up
/// to 0.09 ₳ under the most the pair, the other UTxO and as many payments as one transaction spends beside them pay,
/// where the rule's own orders can miss the set that pays and 1e1b0647's build it (pass d). With `unknown`, a box may
/// be of unknown making, so the pass before the first of them is reached too.
fn pair_band(w: &World, seed: u64, unknown: bool) -> (Balance, Vec<Spend>) {
    let mut rng = Rng(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1);
    let mut n = u32::try_from(seed % 100_000).unwrap() * 64;
    let mut next = || {
        n += 1;
        n
    };
    let band = rng.below(2) as usize;
    let (pair, beside) = ([6_000_000, 7_500_000][band], [5_900_000, 7_400_000][band]);
    let kind = |rng: &mut Rng| match rng.below(100) {
        0..40 => Kind::Mixed,
        40..75 => Kind::Plain,
        _ if unknown => Kind::Unknown,
        _ => Kind::Plain,
    };
    let mut boxes: Vec<(UtxoResponse, Kind)> = Vec::new();
    for _ in 0..2 {
        let k = kind(&mut rng);
        boxes.push((utxo(w, next(), pair, Some("poolA")), k));
    }
    for _ in 0..1 + rng.below(2) {
        let k = kind(&mut rng);
        boxes.push((utxo(w, next(), beside, None), k));
    }
    if rng.below(2) == 0 {
        let k = kind(&mut rng);
        boxes.push((utxo(w, next(), 4_710_000, None), k));
    }
    for i in (1..boxes.len()).rev() {
        let j = rng.below(i as u64 + 1) as usize;
        boxes.swap(i, j);
    }
    let nb = boxes.len();
    let mut items = boxes;
    let distinct = rng.below(2) as usize;
    let mut kinds = vec![
        Kind::Own,
        Kind::Received,
        Kind::OwnSession,
        Kind::OtherSession,
    ];
    for _ in 0..distinct {
        let k = kinds.remove(rng.below(kinds.len() as u64) as usize);
        let lovelace = [1_500_000, 2_000_000, 3_000_000][rng.below(3) as usize];
        items.push((utxo(w, next(), lovelace, None), k));
    }
    let smalls = 18 + rng.below(8) as usize;
    for _ in 0..smalls {
        items.push((utxo(w, next(), 10 * ADA, None), Kind::Received));
    }
    let balance = Balance {
        items,
        boxes: nb,
        distinct,
        smalls,
        small: 10 * ADA,
    };
    let fit = (22 - 2 - distinct).min(smalls);
    let target: Vec<&UtxoResponse> = (0..nb)
        .filter(|&i| holds_tokens(&balance.items[i].0))
        .map(|i| &balance.items[i].0)
        .chain(
            balance.items[nb..nb + distinct + fit]
                .iter()
                .map(|(u, _)| u),
        )
        .collect();
    let mut near =
        |make: &dyn Fn(u64) -> Spend| most_paid_by(w, make, &target) - rng.below(10) * (ADA / 100);
    let (send, public, fund) = (near(&Spend::Send), near(&Spend::Public), near(&Spend::Fund));
    (
        balance,
        vec![Spend::Send(send), Spend::Public(public), Spend::Fund(fund)],
    )
}

/// [`sweep`] over [`pair_band`]'s balances, checked within the rule's stated margin.
fn pair_sweep(seeds: std::ops::Range<u64>, unknown: bool) -> Tally {
    let w = world();
    let mut tally = Tally::default();
    let mut wrong = Vec::new();
    for seed in seeds {
        let (balance, spends) = pair_band(&w, seed, unknown);
        for spend in &spends {
            if let Err(e) = check_with(&w, &balance, spend, &mut tally, true) {
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

/// The default, in parts run side by side: balances of up to six boxes, some past what one transaction spends.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_first() {
    let tally = sweep(0..6, DEFAULT);
    assert!(tally.merged > 0 && tally.alone > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_second() {
    let tally = sweep(6..12, DEFAULT);
    assert!(tally.merged > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_third() {
    let tally = sweep(12..18, DEFAULT);
    assert!(tally.merged > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_fourth() {
    let tally = sweep(18..24, DEFAULT);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// Past what one transaction spends: where a and b can't take every other UTxO before the boxes, order c brings the
/// boxes forward, and a mixed box's choice may take no more of the other inputs than the plain one's (l5merge#3).
#[test]
fn selection_picks_the_best_set_by_the_box_rule_past_the_input_limit() {
    let shape = Shape {
        most_boxes: 7,
        past_the_limit: true,
        ..DEFAULT
    };
    let tally = sweep(110..122, shape);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// Chunk 51, round seven (l6reference#1, l6words#2): another session's money beside more small payments than one
/// transaction spends, which round six's balances never held: past the input limit a funding takes that last resort
/// before a box where it pays, as within the limit.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_beside_another_sessions_money_past_the_limit() {
    let shape = Shape {
        most_boxes: 6,
        past_the_limit: true,
        other_session: true,
        near: true,
        ..DEFAULT
    };
    let tally = sweep(300..316, shape);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// Chunk 51, round seven (l6reference#2): boxes of ADA alone between a token pool's way back's ADA less its token's
/// whole least and what it pays beside a change, round six's reference spaced its sizes to stay clear of; amounts near
/// what one box and the other money pay.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_where_a_weight_could_disagree_with_what_pays() {
    let shape = Shape {
        sizes: WINDOW,
        near: true,
        ..DEFAULT
    };
    let tally = sweep(400..424, shape);
    assert!(tally.merged > 0, "{tally:?}");
}

/// Chunk 51, round seven (l6still#1, l6words#3): token pools' ways back near their least beside 18 to 25 payments of
/// 5 ₳ at the input limit, amounts near what one box and 21 payments pay.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_with_token_boxes_at_the_input_limit() {
    let shape = Shape {
        sizes: WINDOW,
        past_the_limit: true,
        small: 5 * ADA,
        near: true,
        ..DEFAULT
    };
    let tally = sweep(500..512, shape);
    assert!(tally.merged > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// Chunk 51, round eight (l7reference#2): one token pool's way back to a balance beside boxes of ADA alone between what
/// it pays beside a change and the ADA it holds, amounts near what one box and the other money pay. Weighed by its
/// ADA, or by what it adds, a token pool's way back goes on the wrong side of such a box (where two of one pool would
/// share their token's least, the margin of the parts below).
#[test]
fn selection_picks_the_best_set_by_the_box_rule_where_a_weight_could_disagree_with_the_ada_a_box_holds()
 {
    let tally = sweep(650..670, BAND_SHAPE);
    assert!(tally.merged > 0, "{tally:?}");
}

#[test]
fn selection_picks_the_best_set_by_the_box_rule_where_a_weight_could_disagree_with_the_ada_a_box_holds_too()
 {
    let tally = sweep(670..690, BAND_SHAPE);
    assert!(tally.merged > 0, "{tally:?}");
}

const BAND_SHAPE: Shape = Shape {
    sizes: BAND,
    near: true,
    one_token_box: true,
    ..DEFAULT
};

/// Chunk 51, round eight (l7reference#1, l7still#2): two ways back of one token pool beside boxes of ADA alone that
/// weigh more than either at the input limit, where only 1e1b0647's own orders (pass d) build what pays: never refused
/// where a set pays, and within the rule's stated margin.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_beside_two_ways_back_of_one_pool() {
    let tally = pair_sweep(7_000..7_012, false);
    assert!(tally.pair > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// The same with boxes of unknown making among them (l7merge#1, l7still#1): where the rule's orders without one build
/// nothing, 1e1b0647's over the rest without any go before the first, so as few of unknown making as pay, strictly.
#[test]
fn selection_picks_the_best_set_by_the_box_rule_beside_two_ways_back_of_one_pool_and_boxes_of_unknown_making()
 {
    let tally = pair_sweep(7_012..7_024, true);
    assert!(tally.pair > 0 && tally.past_the_limit > 0, "{tally:?}");
}

/// The sweep: many more balances, of up to eight boxes, of every shape above.
#[test]
#[ignore]
fn selection_picks_the_best_set_by_the_box_rule_over_many_balances() {
    let shapes = [
        Shape {
            most_boxes: 8,
            ..DEFAULT
        },
        Shape {
            sizes: WINDOW,
            most_boxes: 8,
            ..DEFAULT
        },
        Shape {
            sizes: WINDOW,
            most_boxes: 8,
            near: true,
            ..DEFAULT
        },
        Shape {
            most_boxes: 8,
            past_the_limit: true,
            other_session: true,
            near: true,
            ..DEFAULT
        },
        Shape {
            sizes: WINDOW,
            most_boxes: 8,
            past_the_limit: true,
            small: 5 * ADA,
            near: true,
            ..DEFAULT
        },
        Shape {
            most_boxes: 8,
            ..BAND_SHAPE
        },
        Shape {
            most_boxes: 8,
            past_the_limit: true,
            small: 5 * ADA,
            ..BAND_SHAPE
        },
    ];
    let mut all = Tally::default();
    let mut failed = Vec::new();
    let mut add = |t: Tally| {
        all.unpaid += t.unpaid;
        all.alone += t.alone;
        all.merged += t.merged;
        all.past_the_limit += t.past_the_limit;
        all.old_built += t.old_built;
        all.pair += t.pair;
        all.one_more_unknown += t.one_more_unknown;
        all.builds += t.builds;
    };
    for (i, shape) in shapes.into_iter().enumerate() {
        let from = 1_000 + 1_000 * i as u64;
        match std::panic::catch_unwind(|| sweep(from..from + 300, shape)) {
            Ok(t) => add(t),
            Err(_) => failed.push(format!("shape {i}")),
        }
    }
    for unknown in [false, true] {
        let from = if unknown { 7_300 } else { 7_100 };
        match std::panic::catch_unwind(|| pair_sweep(from..from + 150, unknown)) {
            Ok(t) => add(t),
            Err(_) => failed.push(format!(
                "two ways back of one pool, unknown making {unknown}"
            )),
        }
    }
    println!("all: {all:?}");
    assert!(failed.is_empty(), "{failed:?} failed (above)");
    assert!(
        all.merged > 0 && all.alone > 0 && all.past_the_limit > 0,
        "{all:?}"
    );
}

/// Chunk 51, round six: the box rule's search stays polynomial in the boxes. Five hundred boxes back from Lovejoin, a
/// mix's, plain and of unknown making, with and without more small payments than one transaction spends: a payment
/// that builds, one only boxes of unknown making pay, and one too large for one transaction, each in a fraction of a
/// second.
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
            small: 2 * ADA,
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
    // Round eight's slowest case took about 0.16 s in a debug build beside the other parts, 0.035 s in release
    // (l7reference#3).
    let bound = if cfg!(debug_assertions) { 3 } else { 1 };
    assert!(worst < std::time::Duration::from_secs(bound), "{worst:?}");
}

/// Chunk 51, round seven (l6merge#1): round six's search parsed every UTxO's lovelace again on each try and walked
/// every prefix that couldn't pay, for each of its u × k choices, so a payment too large for one transaction over
/// boxes of both kinds beside hundreds of payments took seconds where 1e1b0647 took a tenth of one, and its parts,
/// which run the search again after each part, minutes. 100 boxes of unknown making and 100 plain of 10 ₳ beside 400
/// payments received of 2 ₳, a Send of 1,200 ₳; then the reruns a payment's parts make, 20 UTxOs a part, the payments
/// first. Refused as too many for one transaction, as before; each selection in about 1e1b0647's time.
#[test]
fn boxes_of_both_kinds_beside_hundreds_of_payments_plan_in_about_1e1b0647s_time() {
    let w = world();
    let (took, reruns, count) = parts_shape(&w, 100, 100, 400, 1_200 * ADA);
    println!(
        "100 + 100 boxes, 400 payments, a Send of 1,200 ₳: one selection {took:?}; {count} reruns {reruns:?}"
    );
    // This test's own figures, on one machine (chunk 51, l7reference#3): round six's code took about 10 s and 44 to 50 s
    // in a debug build, 1.1 to 1.4 s and 5.3 to 7.3 s in release; round seven's 0.5 to 0.9 s and 3.5 to 6 s, 0.1 s and
    // 0.8 to 1 s; round eight's, which makes no choice its count alone refuses (l7merge#3), 0.05 s and 0.8 s, 0.01 s and
    // 0.1 s, beside the other parts. The bounds sit three times under round six's, with room for a loaded runner.
    let (one, all) = if cfg!(debug_assertions) {
        (3_000, 15_000)
    } else {
        (300, 1_500)
    };
    assert!(
        took < std::time::Duration::from_millis(one),
        "one selection took {took:?}"
    );
    assert!(
        reruns < std::time::Duration::from_millis(all),
        "the reruns took {reruns:?}"
    );
}

/// The same with 200 + 200 boxes beside 600 payments, a Send of 2,000 ₳.
#[test]
#[ignore]
fn more_boxes_of_both_kinds_beside_more_payments_plan_in_about_1e1b0647s_time() {
    let w = world();
    let (took, reruns, count) = parts_shape(&w, 200, 200, 600, 2_000 * ADA);
    println!(
        "200 + 200 boxes, 600 payments, a Send of 2,000 ₳: one selection {took:?}; {count} reruns {reruns:?}"
    );
    // Round seven's took 0.27 s and 3.5 s in release, round eight's 0.015 s and 0.25 s.
    let (one, all) = if cfg!(debug_assertions) {
        (5_000, 25_000)
    } else {
        (500, 2_500)
    };
    assert!(
        took < std::time::Duration::from_millis(one),
        "one selection took {took:?}"
    );
    assert!(
        reruns < std::time::Duration::from_millis(all),
        "the reruns took {reruns:?}"
    );
}

/// `unknown` boxes of unknown making and `plain` plain ones of 10 ₳, beside `received` payments of 2 ₳: one
/// selection's time for a Send of `lovelace`, refused as too many, and the reruns a payment's parts make after each
/// part (lib.rs's `in_parts`: history's order takes the payments first, 20 to a part, then the boxes), and how many.
fn parts_shape(
    w: &World,
    unknown: u32,
    plain: u32,
    received: u32,
    lovelace: u64,
) -> (std::time::Duration, std::time::Duration, usize) {
    let mut n = 0x1000_0000u32;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    for (count, lovelace, kind) in [
        (unknown, 10 * ADA, Kind::Unknown),
        (plain, 10 * ADA, Kind::Plain),
        (received, 2 * ADA, Kind::Received),
    ] {
        for _ in 0..count {
            n += 1;
            items.push((utxo(w, n, lovelace, None), kind));
        }
    }
    let balance = Balance {
        boxes: (unknown + plain) as usize,
        distinct: 0,
        smalls: received as usize,
        small: 2 * ADA,
        items,
    };
    let h = balance.histories(Purpose::Pay, true);
    let send = |utxos: &[UtxoResponse], lovelace: u64| {
        let paying = Paying::new(w, &Spend::Send(lovelace));
        let started = std::time::Instant::now();
        let picked = paying.apart(utxos, &h);
        (started.elapsed(), picked)
    };
    let all: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let (took, picked) = send(&all, lovelace);
    let e = picked.expect_err("too many for one transaction");
    assert!(build::is_too_many(&e), "{e}");
    let mut rest = all.clone();
    rest.reverse();
    let (mut owed, mut reruns, mut count) = (lovelace, std::time::Duration::ZERO, 0);
    while !rest.is_empty() {
        let taken: Vec<UtxoResponse> = rest.drain(..20.min(rest.len())).collect();
        let paid = taken.iter().map(lovelace_of).sum::<u64>() - 400_000;
        owed = owed.saturating_sub(paid);
        if owed == 0 || rest.is_empty() {
            break;
        }
        let (rerun, picked) = send(&rest, owed);
        reruns += rerun;
        count += 1;
        if picked.is_ok() {
            break;
        }
    }
    (took, reruns, count)
}

/// 1e1b0647's selection with histories known, `build.rs`'s `select_script_inputs`, `apart`, `one_more` and `grow` as
/// they stood at 1e1b0647 (its `Purpose` ranks and tiers with them), copied here for rule 1: nothing it sent as one
/// transaction may now be refused or sent in parts. Over balances that send no token, so `holding` takes none and
/// every choice's base is empty. Copied because the crate keeps them private, and its own have moved on.
mod old {
    use super::*;

    enum Tried {
        Built,
        Short,
        Failed,
        Skipped,
    }

    enum Grown {
        Built,
        Short,
        Failed(usize),
    }

    const MAX_TOKEN_SINGLES: usize = 12;

    fn rank(purpose: &Purpose, class: &Class) -> u8 {
        use Origin::*;
        match purpose {
            Purpose::Pay => match class.origin {
                Own => 0,
                Session | Change => 1,
                Received => 2,
                Unknown => 3,
                Mixed => 4,
                Lovejoin => 5,
            },
            Purpose::Mint => match class.origin {
                Mixed => 0,
                Received => 1,
                Lovejoin => 2,
                Unknown => 3,
                Change => 4,
                Own => 5,
                Session => 6,
            },
            Purpose::Fund { session } => {
                if session.as_deref().is_some_and(|s| class.has(s)) {
                    return 0;
                }
                match class.origin {
                    Received => 1,
                    Mixed => 2,
                    Lovejoin => 3,
                    Unknown => 4,
                    Change => 5,
                    Own => 6,
                    Session => 7,
                }
            }
        }
    }

    fn tier(purpose: &Purpose, class: &Class) -> u8 {
        match (purpose, class.origin) {
            (_, Origin::Lovejoin | Origin::Mixed) => 2,
            (Purpose::Fund { .. }, Origin::Session) if rank(purpose, class) > 0 => 1,
            _ => 0,
        }
    }

    fn one_more<'a, K: Ord>(
        mut candidates: Vec<&'a UtxoResponse>,
        rank: impl Fn(&UtxoResponse) -> K,
        try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried,
    ) -> bool {
        candidates.sort_by_key(|u| (rank(u), lovelace_of(u)));
        let mut short_at: Option<u64> = None;
        let mut token_tries = 0;
        for u in candidates {
            let ada_only = !holds_tokens(u);
            if ada_only && short_at.is_some_and(|at| lovelace_of(u) <= at) {
                continue;
            }
            if !ada_only {
                if token_tries == MAX_TOKEN_SINGLES {
                    continue;
                }
                token_tries += 1;
            }
            match try_with(&[u]) {
                Tried::Built => return true,
                Tried::Short if ada_only => short_at = short_at.max(Some(lovelace_of(u))),
                _ => {}
            }
        }
        false
    }

    fn grow<'a>(
        order: &[&'a UtxoResponse],
        from: usize,
        try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried,
    ) -> Grown {
        for k in from.max(1)..=order.len() {
            match try_with(&order[..k]) {
                Tried::Built => return Grown::Built,
                Tried::Failed => return Grown::Failed(k),
                _ => {}
            }
        }
        Grown::Short
    }

    /// Whether 1e1b0647's selection built a spend of `available` for `purpose`, `floor` paid out, `attempt` saying
    /// whether exactly some inputs pay.
    pub fn built(
        params: &ProtocolParameters,
        available: &[UtxoResponse],
        histories: &Histories,
        purpose: &Purpose,
        floor: u64,
        mut attempt: impl FnMut(&[&UtxoResponse]) -> Verdict,
    ) -> bool {
        let evaluable: Vec<UtxoResponse> = available
            .iter()
            .filter(|u| seedelf_core::eval::refusal(u).is_none())
            .cloned()
            .collect();
        let (rest, _) =
            seedelf_core::utxos::fitting(&evaluable, &Assets::new(), |_| false).unwrap();
        let piles: BTreeSet<(String, u64)> = rest
            .iter()
            .filter(|u| build::adds(params, u).is_ok_and(|a| a < 0))
            .map(|u| (u.tx_hash.clone(), u.tx_index))
            .collect();
        let last = |u: &UtxoResponse| piles.contains(&(u.tx_hash.clone(), u.tx_index));
        let class = |u: &UtxoResponse| histories.class_of(u);
        // No token is sent: the base is empty, and every UTxO joins it.
        let joins_base = |_: &UtxoResponse| true;
        let mut try_with = |extra: &[&UtxoResponse]| -> Tried {
            let lovelace: u128 = extra.iter().map(|u| u128::from(lovelace_of(u))).sum();
            if lovelace <= u128::from(floor) || extra.is_empty() {
                return Tried::Skipped;
            }
            match attempt(extra) {
                Verdict::Pays => Tried::Built,
                Verdict::Short => Tried::Short,
                Verdict::Failed => Tried::Failed,
            }
        };

        // 1.
        let ranked = |u: &UtxoResponse| (last(u), rank(purpose, &class(u)));
        let singles: Vec<&UtxoResponse> = rest.iter().filter(|u| joins_base(u)).collect();
        if one_more(singles, ranked, &mut try_with) {
            return true;
        }

        // 2.
        let mut classes: Vec<(Class, Vec<&UtxoResponse>)> = Vec::new();
        for u in rest.iter().filter(|u| joins_base(u)) {
            let c = class(u);
            match classes.iter_mut().find(|(k, _)| k.id == c.id) {
                Some((_, rows)) => rows.push(u),
                None => classes.push((c, vec![u])),
            }
        }
        classes.sort_by_key(|(c, rows)| {
            let total: u128 = rows.iter().map(|u| u128::from(lovelace_of(u))).sum();
            (rank(purpose, c), std::cmp::Reverse(total), c.id.clone())
        });
        for (_, rows) in &mut classes {
            rows.sort_by_key(|u| (last(u), holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
            for k in 2..=rows.len() {
                match try_with(&rows[..k]) {
                    Tried::Built => return true,
                    Tried::Failed => break,
                    _ => {}
                }
            }
        }

        // 3. With no token sent, nothing.

        // a, b, c and d.
        let tier = |u: &UtxoResponse| tier(purpose, &class(u));
        let mut by_history: Vec<&UtxoResponse> = rest.iter().collect();
        by_history.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                rank(purpose, &class(u)),
                holds_tokens(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let mut by_tier: Vec<&UtxoResponse> = rest.iter().collect();
        by_tier.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                holds_tokens(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let is_box = |u: &UtxoResponse| tier(u) == 2 && !holds_tokens(u);
        let mut boxes: Vec<&UtxoResponse> = rest.iter().filter(|u| is_box(u)).collect();
        boxes.sort_by_key(|u| (!joins_base(u), std::cmp::Reverse(lovelace_of(u))));
        let mut largest: Vec<&UtxoResponse> = rest.iter().filter(|u| !is_box(u)).collect();
        largest.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let mut tokens_last: Vec<&UtxoResponse> = rest.iter().filter(|u| !is_box(u)).collect();
        tokens_last.sort_by_key(|u| {
            (
                last(u),
                holds_tokens(u),
                tier(u),
                !joins_base(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let same = |a: &[&UtxoResponse], b: &[&UtxoResponse]| {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| std::ptr::eq(*x, *y))
        };
        let mut rests = vec![&largest];
        if !same(&largest, &tokens_last) {
            rests.push(&tokens_last);
        }
        let (boxes, rests) = (&boxes, &rests);
        let fewest_boxes = (0..=boxes.len())
            .filter(|_| !largest.is_empty())
            .flat_map(|j| {
                rests.iter().map(move |others| {
                    (
                        boxes[..j]
                            .iter()
                            .chain(others.iter())
                            .copied()
                            .collect::<Vec<_>>(),
                        j,
                    )
                })
            });
        let mut blind: Vec<&UtxoResponse> = rest.iter().collect();
        blind.sort_by_key(|u| (last(u), holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
        let mut boxes_fail = false;
        let mut grown: Vec<Vec<&UtxoResponse>> = Vec::new();
        let orders = [(by_history, 0), (by_tier, 0)]
            .into_iter()
            .chain(fewest_boxes)
            .chain([(blind, 0)]);
        for (order, j) in orders {
            let grown_before =
                |g: &Vec<&UtxoResponse>| g.len() >= order.len() && same(&g[..order.len()], &order);
            if (j > 0 && boxes_fail) || grown.iter().any(grown_before) {
                continue;
            }
            let whole = order.len() == rest.len();
            match grow(&order, j, &mut try_with) {
                Grown::Built => return true,
                Grown::Short => {}
                Grown::Failed(at) => boxes_fail |= j > 0 && at == j,
            }
            if whole {
                grown.push(order);
            }
        }
        false
    }
}
