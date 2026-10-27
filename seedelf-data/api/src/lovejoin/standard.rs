//! Which token pools are shown (web wallet chunk 34's design session 1, 11,
//! 20 and 22, with the owner's rule of 2026-10-17 for "finished"): the data
//! layer's copy of the rule the wallet applies to Koios's answers itself.
//!
//! A pool is **standard** when its reference UTxO is genuine and its launch
//! finished it:
//! - at the holder's enterprise address, with no reference script, holding
//!   one `lovejoin` NFT and ADA alone, its datum a pool's;
//! - of a token in the wallet's token list, or of ADA at any amount but the
//!   classic pool's 10 ₳;
//! - its NFT's policy made by one of the launch's inputs, the seed, and the
//!   datum naming exactly the scripts that seed makes;
//! - the launch transaction itself putting `mix_box` and `mix_logic` at the
//!   holder as reference scripts, each under no datum or one the wallet reads
//!   (nested within `datum::MAX_DEPTH`), and registering L, unless L was
//!   registered in an earlier block.
//!
//! Of the standard pools with the same values (the box's ADA and its token),
//! the **earliest launched is shown**, and only it: by block, then by place
//! in the block, then by id. Nothing of this can change once it's on chain,
//! so a pool shown is shown for good, and a copy never is.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use super::datum::{self, ReferenceDatum, Token};
use super::templates::{self, Derived, HOLDER_HASH, NFT_NAME};
use crate::constants::bytes;
use crate::ids;
use crate::row::Row;

/// The classic pool's box: an ADA pool on the new scripts at this value is a copy of its.
pub const CLASSIC_LOVELACE: u64 = 10_000_000;

/// What db-sync says of a candidate's launch transaction: the one that made it.
#[derive(Debug, Clone)]
pub struct Launch {
    pub tx: String,
    pub block: i64,
    /// Its place in its block.
    pub index: i64,
    pub slot: i64,
    /// What it spent: one of them is the seed.
    pub inputs: Vec<([u8; 32], u64)>,
    /// Its outputs at the holder that carry a reference script, each with the script's hash.
    pub scripts: Vec<(Row, [u8; 28])>,
    /// The script credentials it registers.
    pub registers: Vec<[u8; 28]>,
}

/// An output at the holder holding a `lovejoin` NFT, and its launch.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub reference: Row,
    pub launch: Launch,
}

/// A genuine pool its launch finished.
#[derive(Debug, Clone)]
pub struct Pool {
    pub id: [u8; 28],
    pub datum: ReferenceDatum,
    pub seed: ([u8; 32], u64),
    pub derived: Derived,
    pub reference: Row,
    /// Its `mix_box` and `mix_logic` reference scripts, as the launch put them at the holder.
    pub scripts: Vec<Row>,
    pub launch: Launch,
}

impl Pool {
    /// Its values: what a copy has the same of.
    pub fn values(&self) -> (u64, Option<Token>) {
        (self.datum.box_lovelace, self.datum.token.clone())
    }
}

/// What's known of a candidate once checked.
#[derive(Debug, Clone)]
pub enum Verdict {
    Standard(Box<Pool>),
    /// All but L's registration, which its launch didn't make: standard if
    /// L was registered in an earlier block.
    Unregistered(Box<Pool>),
    Rejected(&'static str),
}

/// The tokens whose pools are shown: the wallet's token list for mainnet
/// (`tokens/list.json`, round three, 20), built in. A release that lists a
/// token is deployed here before its upload, as every release is.
pub struct Listed(HashSet<(String, String)>);

impl Listed {
    pub fn mainnet() -> Self {
        Listed::parse(include_str!(
            "../../../../seedelf-platform/seedelf-web-wallet/extension/src/tokens/list.json"
        ))
    }

    fn parse(list: &str) -> Self {
        #[derive(Deserialize)]
        struct Entry {
            policy: String,
            name: String,
        }
        #[derive(Deserialize)]
        struct List {
            mainnet: Vec<Entry>,
        }
        let list: List = serde_json::from_str(list).expect("the wallet's token list reads");
        Listed(
            list.mainnet
                .into_iter()
                .map(|e| (e.policy.to_lowercase(), e.name.to_lowercase()))
                .collect(),
        )
    }

    #[cfg(test)]
    pub fn of(units: &[(&str, &str)]) -> Self {
        Listed(
            units
                .iter()
                .map(|(p, n)| (p.to_string(), n.to_string()))
                .collect(),
        )
    }

    pub fn has(&self, token: &Token) -> bool {
        self.0.contains(&(hex(&token.policy), hex(&token.name)))
    }
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

/// `reference_holder`'s enterprise address on mainnet: where a launch puts its reference UTxO.
pub fn holder_address() -> String {
    let mut raw = vec![0x71];
    raw.extend(bytes(HOLDER_HASH));
    ids::encode("addr", &raw)
}

/// Checks a candidate, cheapest first: its shape, its token, then the seed
/// and the scripts it makes, then what its launch did.
pub fn check(candidate: &Candidate, listed: &Listed, holder: &str) -> Verdict {
    check_with(candidate, listed, holder, &mut |tx, index| {
        templates::policy_of(tx, index).ok()
    })
}

/// What policy an input would make its launch's NFT under, if any.
pub type PolicyOf<'a> = dyn FnMut(&[u8; 32], u64) -> Option<[u8; 28]> + 'a;

/// [`check`], with the policy each input would make worked out by
/// `policy_of`: the candidates of one launch share its inputs, so a caller
/// checking several works each out once.
pub fn check_with(
    candidate: &Candidate,
    listed: &Listed,
    holder: &str,
    policy_of: &mut PolicyOf,
) -> Verdict {
    match pool_of(candidate, listed, holder, policy_of) {
        Ok((pool, true)) => Verdict::Standard(Box::new(pool)),
        Ok((pool, false)) => Verdict::Unregistered(Box::new(pool)),
        Err(why) => Verdict::Rejected(why),
    }
}

/// A verdict whose launch didn't register L, once the first block that did is
/// known: standard if that block came before the launch's. Others as they are.
pub fn settle(verdict: Verdict, first_registered: Option<i64>) -> Verdict {
    match verdict {
        Verdict::Unregistered(pool) => match first_registered {
            Some(block) if block < pool.launch.block => Verdict::Standard(pool),
            _ => Verdict::Rejected("its launch didn't register L, nor did an earlier block"),
        },
        other => other,
    }
}

fn pool_of(
    candidate: &Candidate,
    listed: &Listed,
    holder: &str,
    policy_of: &mut PolicyOf,
) -> Result<(Pool, bool), &'static str> {
    let reference = &candidate.reference;
    if reference.address != holder {
        return Err("it isn't at the holder's enterprise address");
    }
    if reference.script {
        return Err("it carries a reference script");
    }
    let [crate::row::Asset(policy, name, quantity, _)] = reference.assets.as_slice() else {
        return Err("it doesn't hold one Lovejoin NFT and ADA alone");
    };
    if name != &hex(NFT_NAME) || quantity != "1" {
        return Err("it doesn't hold one Lovejoin NFT and ADA alone");
    }
    let id: [u8; 28] = bytes(policy)
        .try_into()
        .map_err(|_| "its NFT's policy isn't 28 bytes")?;
    let datum = datum::decode(&bytes(
        reference.datum.as_deref().ok_or("it has no inline datum")?,
    ))?;
    match &datum.token {
        None if datum.box_lovelace == CLASSIC_LOVELACE => {
            return Err("a 10 ₳ ADA pool, a copy of the classic pool's value");
        }
        Some(token) if !listed.has(token) => return Err("its token isn't in the wallet's list"),
        _ => {}
    }
    let launch = &candidate.launch;
    let seed = *launch
        .inputs
        .iter()
        .find(|(tx, index)| policy_of(tx, *index) == Some(id))
        .ok_or("none of its launch's inputs makes its NFT")?;
    let derived = templates::derive(&seed.0, seed.1).map_err(|_| "its scripts can't be made")?;
    if (datum.mix_box, datum.mix_logic, datum.fee)
        != (derived.mix_box, derived.mix_logic, derived.fee_contract)
    {
        return Err("its datum names scripts its seed doesn't make");
    }
    // A row whose datum the wallet can't read is no reference to its script:
    // the wallet passes it over, carries the script, and so never shows the
    // pool (seedelf-core's `eval::unreadable_datum`). A launch can put any
    // datum beside its scripts, as one_shot_mint checks only the reference
    // output (1.6.0's release review, 314-wasm#0).
    let readable = |row: &Row| {
        row.datum
            .as_deref()
            .is_none_or(|d| datum::within_depth(&bytes(d), datum::MAX_DEPTH))
    };
    let script = |hash: [u8; 28]| {
        let mut rows = launch.scripts.iter().filter(|(_, h)| *h == hash).peekable();
        if rows.peek().is_none() {
            return Err("its launch didn't put its scripts at the holder");
        }
        rows.find(|(row, _)| readable(row))
            .map(|(row, _)| row.clone())
            .ok_or("its launch put a script at the holder under a datum the wallet can't read")
    };
    let (mix_box, mix_logic) = (script(derived.mix_box)?, script(derived.mix_logic)?);
    let registered = launch.registers.contains(&derived.mix_logic);
    Ok((
        Pool {
            id,
            datum,
            seed,
            derived,
            reference: reference.clone(),
            scripts: vec![mix_box, mix_logic],
            launch: launch.clone(),
        },
        registered,
    ))
}

/// Of `standard`, the earliest launched of each value.
pub fn shown(standard: Vec<Pool>) -> Vec<Pool> {
    let mut first: HashMap<(u64, Option<Token>), Pool> = HashMap::new();
    for pool in standard {
        let key = pool.values();
        let earlier = |a: &Pool, b: &Pool| {
            (a.launch.block, a.launch.index, a.id) < (b.launch.block, b.launch.index, b.id)
        };
        match first.get(&key) {
            Some(kept) if !earlier(&pool, kept) => {}
            _ => {
                first.insert(key, pool);
            }
        }
    }
    let mut shown: Vec<Pool> = first.into_values().collect();
    shown.sort_by_key(|p| (p.launch.block, p.launch.index, p.id));
    shown
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::row::{Asset, Point};
    use serde_json::Value;

    /// A launch as the wallet makes one, checked: standard.
    pub(crate) fn standard_pool() -> Verdict {
        check(
            &launch(4_500_000, djed()),
            &Listed::of(&[DJED]),
            &holder_address(),
        )
    }

    /// Lovejoin's own preprod seed (the vectors' first), standing in for a launch on mainnet.
    const SEED: &str = "5c6f327e511818805adb6b4e055a6b222f9f8706cfda3540bdb0e9bb0f6acc0b";
    const DJED: (&str, &str) = (
        "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61",
        "446a65644d6963726f555344",
    );

    const UNLISTED: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn seed() -> ([u8; 32], u64) {
        (bytes(SEED).try_into().unwrap(), 2)
    }

    fn head(major: u8, n: u64) -> Vec<u8> {
        super::super::flat::cbor_head(major, n)
    }

    fn b(x: &[u8]) -> Vec<u8> {
        [head(2, x.len() as u64), x.to_vec()].concat()
    }

    fn datum_cbor(lovelace: u64, token: Option<(&str, &str, u64)>, d: &Derived) -> String {
        let (p, n, q) = token
            .map(|(p, n, q)| (bytes(p), bytes(n), q))
            .unwrap_or_default();
        let mut out = vec![0xd8, 0x79, 0x9f];
        for f in [
            head(0, lovelace),
            b(&p),
            b(&n),
            head(0, q),
            head(0, 1_500_000),
            b(&d.mix_box),
            b(&d.mix_logic),
            b(&d.fee_contract),
        ] {
            out.extend(f);
        }
        out.push(0xff);
        hex(&out)
    }

    fn row(
        reference: &str,
        address: &str,
        assets: Vec<Asset>,
        datum: Option<String>,
        script: bool,
    ) -> Row {
        Row {
            reference: reference.into(),
            address: address.into(),
            lovelace: "1700000".into(),
            assets,
            datum,
            script,
            created: Point::at(150_000_000),
            spent: None,
            made_by: None,
        }
    }

    /// A launch as the wallet makes one: the reference UTxO, both scripts, L registered.
    fn launch(lovelace: u64, token: Option<(&str, &str, u64)>) -> Candidate {
        let d = templates::derive(&seed().0, seed().1).unwrap();
        let holder = holder_address();
        let tx = "ab".repeat(32);
        let nft = Asset::new(hex(&d.policy), hex(NFT_NAME), "1".into());
        Candidate {
            reference: row(
                &format!("{tx}#0"),
                &holder,
                vec![nft],
                Some(datum_cbor(lovelace, token, &d)),
                false,
            ),
            launch: Launch {
                tx,
                block: 12_000_000,
                index: 3,
                slot: 150_000_000,
                inputs: vec![([7; 32], 0), seed()],
                scripts: vec![
                    (
                        row(
                            &format!("{}#1", "ab".repeat(32)),
                            &holder,
                            vec![],
                            None,
                            true,
                        ),
                        d.mix_box,
                    ),
                    (
                        row(
                            &format!("{}#2", "ab".repeat(32)),
                            &holder,
                            vec![],
                            None,
                            true,
                        ),
                        d.mix_logic,
                    ),
                ],
                registers: vec![d.mix_logic],
            },
        }
    }

    fn djed() -> Option<(&'static str, &'static str, u64)> {
        Some((DJED.0, DJED.1, 100_000_000))
    }

    fn verdict(c: &Candidate) -> Result<bool, &'static str> {
        match check(c, &Listed::of(&[DJED]), &holder_address()) {
            Verdict::Standard(_) => Ok(true),
            Verdict::Unregistered(_) => Ok(false),
            Verdict::Rejected(why) => Err(why),
        }
    }

    #[test]
    fn the_holders_address_is_its_enterprise_one() {
        assert_eq!(
            holder_address(),
            ids::encode("addr", &[&[0x71][..], &bytes(HOLDER_HASH)].concat())
        );
        assert!(holder_address().starts_with("addr1w"));
    }

    #[test]
    fn a_launch_as_the_wallet_makes_one_is_standard() {
        assert_eq!(verdict(&launch(4_500_000, djed())), Ok(true));
        // An ADA pool at any amount but the classic's.
        assert_eq!(verdict(&launch(25_000_000, None)), Ok(true));
        // L registered elsewhere: standard only if that was in an earlier block.
        let mut c = launch(4_500_000, djed());
        c.launch.registers.clear();
        assert_eq!(verdict(&c), Ok(false));
    }

    #[test]
    fn l_registered_only_by_an_earlier_block_still_makes_it_standard() {
        let mut c = launch(4_500_000, djed());
        c.launch.registers.clear();
        let unregistered = check(&c, &Listed::of(&[DJED]), &holder_address());
        let at = c.launch.block;
        let standard = |first| matches!(settle(unregistered.clone(), first), Verdict::Standard(_));
        assert!(standard(Some(at - 1)));
        assert!(!standard(Some(at)));
        assert!(!standard(Some(at + 1)));
        assert!(!standard(None));
        // A verdict already settled stays as it is.
        let done = check(
            &launch(4_500_000, djed()),
            &Listed::of(&[DJED]),
            &holder_address(),
        );
        assert!(matches!(settle(done, None), Verdict::Standard(_)));
    }

    #[test]
    fn a_launchs_inputs_are_tried_through_the_callers_memo() {
        let c = launch(4_500_000, djed());
        let mut asked = Vec::new();
        let verdict = check_with(
            &c,
            &Listed::of(&[DJED]),
            &holder_address(),
            &mut |tx, index| {
                asked.push((*tx, index));
                templates::policy_of(tx, index).ok()
            },
        );
        assert!(matches!(verdict, Verdict::Standard(_)));
        assert_eq!(asked, c.launch.inputs);
    }

    #[test]
    fn anything_else_is_refused() {
        let refused = |c: Candidate| verdict(&c).unwrap_err();
        assert_eq!(
            refused(launch(10_000_000, None)),
            "a 10 ₳ ADA pool, a copy of the classic pool's value"
        );
        let unlisted = Some((UNLISTED, "4142", 5));
        assert_eq!(
            refused(launch(4_500_000, unlisted)),
            "its token isn't in the wallet's list"
        );
        let mut c = launch(4_500_000, djed());
        c.launch.inputs.retain(|i| *i != seed());
        assert_eq!(refused(c), "none of its launch's inputs makes its NFT");
        let mut c = launch(4_500_000, djed());
        c.launch.scripts.pop();
        assert_eq!(
            refused(c),
            "its launch didn't put its scripts at the holder"
        );
        let mut c = launch(4_500_000, djed());
        c.reference.address = ids::encode(
            "addr",
            &[&[0x11][..], &bytes(HOLDER_HASH), &[9; 28]].concat(),
        );
        assert_eq!(refused(c), "it isn't at the holder's enterprise address");
        let mut c = launch(4_500_000, djed());
        c.reference.script = true;
        assert_eq!(refused(c), "it carries a reference script");
        let mut c = launch(4_500_000, djed());
        c.reference
            .assets
            .push(Asset::new(DJED.0.into(), DJED.1.into(), "1".into()));
        assert_eq!(refused(c), "it doesn't hold one Lovejoin NFT and ADA alone");
        // The genuine NFT, its datum naming other scripts: one_shot_mint never checks them.
        let mut c = launch(4_500_000, djed());
        let other = templates::derive(&[1; 32], 0).unwrap();
        c.reference.datum = Some(datum_cbor(4_500_000, djed(), &other));
        assert_eq!(refused(c), "its datum names scripts its seed doesn't make");
    }

    #[test]
    fn a_script_under_a_datum_too_deep_for_the_wallet_isnt_one_it_reads() {
        // 1.6.0's release review, 314-wasm#0: one_shot_mint checks only the
        // reference output, so a launch can put any datum beside its
        // scripts. The wallet decoding one a few thousand levels deep
        // overflowed its WebAssembly's stack, and it locked itself.
        let lists = |levels: usize| hex(&[vec![0x81; levels], vec![0x00]].concat());
        let with = |datum: Option<String>| {
            let mut c = launch(4_500_000, djed());
            c.launch.scripts[0].0.datum = datum;
            verdict(&c)
        };
        // Within the depth the wallet reads anywhere, a datum changes nothing.
        assert_eq!(with(Some(lists(128))), Ok(true));
        for levels in [129, 3_000, 100_000] {
            assert_eq!(
                with(Some(lists(levels))),
                Err("its launch put a script at the holder under a datum the wallet can't read")
            );
        }
        // Beside a copy the wallet can read, which is the one shown.
        let mut c = launch(4_500_000, djed());
        let mut deep = c.launch.scripts[0].clone();
        deep.0.reference = format!("{}#3", "ab".repeat(32));
        deep.0.datum = Some(lists(100_000));
        c.launch.scripts.insert(0, deep);
        match check(&c, &Listed::of(&[DJED]), &holder_address()) {
            Verdict::Standard(pool) => {
                assert_eq!(pool.scripts[0].reference, format!("{}#1", "ab".repeat(32)))
            }
            other => panic!("{other:?}"),
        }
    }

    /// The scenarios the wallet's own copy of the rule is held to too
    /// (extension/tests/fixtures/lovejoin-shown.json).
    #[test]
    fn the_earliest_of_each_value_is_shown() {
        let scenarios: Value = serde_json::from_str(include_str!(
            "../../../../seedelf-platform/seedelf-web-wallet/extension/tests/fixtures/lovejoin-shown.json"
        ))
        .unwrap();
        let template = match check(
            &launch(4_500_000, djed()),
            &Listed::of(&[DJED]),
            &holder_address(),
        ) {
            Verdict::Standard(pool) => *pool,
            other => panic!("{other:?}"),
        };
        for s in scenarios["scenarios"].as_array().unwrap() {
            let pools = s["pools"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| {
                    let mut pool = template.clone();
                    pool.id = bytes(p["id"].as_str().unwrap()).try_into().unwrap();
                    pool.datum.box_lovelace = p["boxLovelace"].as_str().unwrap().parse().unwrap();
                    pool.datum.token = p["token"].as_object().map(|t| Token {
                        policy: bytes(t["policy"].as_str().unwrap()).try_into().unwrap(),
                        name: bytes(t["name"].as_str().unwrap()),
                        quantity: t["quantity"].as_str().unwrap().parse().unwrap(),
                    });
                    pool.launch.block = p["launch"]["block"].as_i64().unwrap();
                    pool.launch.index = p["launch"]["index"].as_i64().unwrap();
                    pool
                })
                .collect();
            let ids: Vec<String> = shown(pools).iter().map(|p| hex(&p.id)).collect();
            let expected: Vec<String> = s["shown"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_string())
                .collect();
            assert_eq!(ids, expected, "{}", s["about"]);
        }
    }

    #[test]
    fn the_wallets_list_reads() {
        let listed = Listed::mainnet();
        assert!(listed.0.len() >= 20);
        assert!(listed.has(&Token {
            policy: bytes(DJED.0).try_into().unwrap(),
            name: bytes(DJED.1),
            quantity: 1,
        }));
    }
}
