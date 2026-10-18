//! Finding the shown pools in db-sync, and their crowds. Every launch puts
//! its reference UTxO at the holder, which takes no parameters, so the holder
//! is the index: each output there holding a `lovejoin` token is a candidate,
//! checked once ([`super::standard::check`]) and its verdict kept, since
//! nothing about a transaction on chain changes. What's at the holder is
//! locked for good, so spam there is burned, and costs this server one check.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;

use super::crowd::{self, Crowd};
use super::db::{self, Found};
use super::standard::{self, Candidate, Listed, Pool, Verdict};
use super::templates::{self, HOLDER_HASH, NFT_NAME};
use crate::chain::Chain;
use crate::constants::{MIXBOX_HASH, bytes};
use crate::row::Asset;

/// Verdicts kept, at most: past this, a candidate is checked again at each
/// request (and still shown when it's standard). A candidate costs whoever
/// made it at least a UTxO's minimum, burned at the holder.
const MAX_VERDICTS: usize = 200_000;

/// Candidates whose launches are read in one round of queries.
const LAUNCHES_PER_READ: usize = 500;

/// How long the holder's candidates are read on from where the last read
/// stopped, before all of them are read again: so a block rolled back under
/// the stable cursor, almost unheard of, is forgotten within this.
const READ_AGAIN: Duration = Duration::from_secs(3600);

/// The holder's candidates read so far: by the block at slot `upto`, with
/// output ids up to `high`.
struct Seen {
    found: Vec<Found>,
    upto: i64,
    high: i64,
    read: Instant,
}

pub struct Discovery {
    listed: Arc<Listed>,
    holder: String,
    holder_cred: Vec<u8>,
    verdicts: Mutex<HashMap<String, Verdict>>,
    seen: Mutex<Option<Seen>>,
}

impl Default for Discovery {
    fn default() -> Self {
        Discovery {
            listed: Arc::new(Listed::mainnet()),
            holder: standard::holder_address(),
            holder_cred: bytes(HOLDER_HASH),
            verdicts: Mutex::new(HashMap::new()),
            seen: Mutex::new(None),
        }
    }
}

/// Of `found`, the standard pools as `verdict` says, each where its launch is
/// now: a block rolled back and made again could have moved it.
pub fn standard_of<'a>(
    found: &[Found],
    verdict: impl Fn(&str) -> Option<&'a Verdict>,
) -> Vec<Pool> {
    found
        .iter()
        .filter_map(|f| match verdict(&f.row.reference) {
            Some(Verdict::Standard(pool)) => {
                let mut pool = (**pool).clone();
                (pool.launch.block, pool.launch.index, pool.launch.slot) =
                    (f.block, f.index, f.slot);
                Some(pool)
            }
            _ => None,
        })
        .collect()
}

impl Discovery {
    /// The pools shown as of the block at slot `at`, in the order they were launched.
    pub async fn shown(&self, chain: &Chain, at: i64) -> Result<Vec<Pool>> {
        let found = self.found(chain, at).await?;
        let new: Vec<&Found> = {
            let verdicts = self.verdicts.lock().expect("verdicts lock");
            found
                .iter()
                .filter(|f| !verdicts.contains_key(&f.row.reference))
                .collect()
        };
        // This request's own verdicts count whether or not there's room to keep them.
        let mut fresh = HashMap::new();
        for chunk in new.chunks(LAUNCHES_PER_READ) {
            let checked = self.check(chain, chunk).await?;
            let mut verdicts = self.verdicts.lock().expect("verdicts lock");
            for (reference, verdict) in checked {
                if verdicts.len() < MAX_VERDICTS {
                    verdicts.insert(reference.clone(), verdict.clone());
                }
                fresh.insert(reference, verdict);
            }
        }
        let verdicts = self.verdicts.lock().expect("verdicts lock");
        let verdict = |r: &str| fresh.get(r).or_else(|| verdicts.get(r));
        // What's refused stays refused: it's dropped from the read kept, whose size is then the pools'.
        if let Some(seen) = self.seen.lock().expect("seen lock").as_mut() {
            seen.found
                .retain(|f| !matches!(verdict(&f.row.reference), Some(Verdict::Rejected(_))));
        }
        Ok(standard::shown(standard_of(&found, verdict)))
    }

    /// The holder's candidates by the block at slot `at`: only what's newer
    /// than the last read is asked of db-sync, and all of it every READ_AGAIN.
    async fn found(&self, chain: &Chain, at: i64) -> Result<Vec<Found>> {
        let (upto, high) = {
            let seen = self.seen.lock().expect("seen lock");
            match seen.as_ref() {
                Some(s) if s.read.elapsed() < READ_AGAIN => (s.upto, s.high),
                _ => (i64::MIN, i64::MIN),
            }
        };
        if at > upto {
            let newer = db::found(chain, &self.holder_cred, NFT_NAME, at, high.max(0)).await?;
            let mut seen = self.seen.lock().expect("seen lock");
            match seen.as_mut() {
                // Read on: what's above the ids kept, whoever read on meanwhile. A later block's
                // outputs have higher ids than an earlier one's, so nothing between is missed.
                Some(s) if upto != i64::MIN => {
                    let known = s.high;
                    s.found.extend(newer.into_iter().filter(|f| f.id > known));
                    s.high = s.found.iter().map(|f| f.id).max().unwrap_or(known);
                    s.upto = s.upto.max(at);
                }
                // The first read, or the hourly one: it stands alone.
                _ => {
                    *seen = Some(Seen {
                        high: newer.iter().map(|f| f.id).max().unwrap_or(0),
                        found: newer,
                        upto: at,
                        read: Instant::now(),
                    });
                }
            }
        }
        let seen = self.seen.lock().expect("seen lock");
        Ok(seen
            .as_ref()
            .map(|s| s.found.iter().filter(|f| f.slot <= at).cloned().collect())
            .unwrap_or_default())
    }

    /// Checks `found`: what each launch did, then the rules, then, for a
    /// launch that didn't register L, whether an earlier block did.
    async fn check(&self, chain: &Chain, found: &[&Found]) -> Result<Vec<(String, Verdict)>> {
        let launches = db::launches(chain, &self.holder_cred, found).await?;
        let candidates: Vec<Candidate> = found
            .iter()
            .filter_map(|f| {
                Some(Candidate {
                    reference: f.row.clone(),
                    launch: launches.get(&f.tx_id)?.clone(),
                })
            })
            .collect();
        let (listed, holder) = (self.listed.clone(), self.holder.clone());
        // Deriving scripts is CPU work: off the request threads. A launch's
        // candidates share its inputs, so each input's policy is worked out once.
        let mut checked = tokio::task::spawn_blocking(move || {
            let mut policies = HashMap::new();
            let mut policy_of = |tx: &[u8; 32], index: u64| {
                *policies
                    .entry((*tx, index))
                    .or_insert_with(|| templates::policy_of(tx, index).ok())
            };
            candidates
                .into_iter()
                .map(|c| {
                    let verdict = standard::check_with(&c, &listed, &holder, &mut policy_of);
                    (c.reference.reference, verdict)
                })
                .collect::<Vec<_>>()
        })
        .await?;
        let unregistered: Vec<[u8; 28]> = checked
            .iter()
            .filter_map(|(_, v)| match v {
                Verdict::Unregistered(pool) => Some(pool.derived.mix_logic),
                _ => None,
            })
            .collect();
        if !unregistered.is_empty() {
            let first = db::registered(chain, &unregistered).await?;
            for (_, verdict) in &mut checked {
                let mix_logic = match verdict {
                    Verdict::Unregistered(pool) => pool.derived.mix_logic,
                    _ => continue,
                };
                *verdict = standard::settle(verdict.clone(), first.get(&mix_logic).copied());
            }
        }
        Ok(checked)
    }

    /// The classic pool's crowd and each of `pools`', as of the block at slot `at`.
    pub async fn crowds(
        &self,
        chain: &Chain,
        pools: &[Pool],
        at: i64,
    ) -> Result<(Crowd, Vec<Crowd>)> {
        let mut creds = vec![bytes(MIXBOX_HASH)];
        creds.extend(pools.iter().map(|p| p.derived.mix_box.to_vec()));
        let ever = db::ever(chain, &creds, at).await?;
        let mut by_cred: HashMap<&str, Vec<&db::Ever>> = HashMap::new();
        for e in &ever {
            by_cred.entry(e.cred.as_str()).or_default().push(e);
        }
        let of = |cred: &str, value: &dyn Fn(&db::Ever) -> bool| {
            let outputs: Vec<crowd::Output> = by_cred
                .get(cred)
                .map(|es| es.iter().map(|e| e.output(value(e))).collect())
                .unwrap_or_default();
            crowd::crowd(&outputs)
        };
        let classic = of(MIXBOX_HASH, &|e| {
            is_box(e, standard::CLASSIC_LOVELACE, None)
        });
        let crowds = pools
            .iter()
            .map(|p| {
                let token = p.datum.token.as_ref().map(|t| {
                    Asset::new(
                        standard::hex(&t.policy),
                        standard::hex(&t.name),
                        t.quantity.to_string(),
                    )
                });
                of(&standard::hex(&p.derived.mix_box), &|e| {
                    is_box(e, p.datum.box_lovelace, token.as_ref())
                })
            })
            .collect();
        Ok((classic, crowds))
    }
}

/// Whether an output holds exactly a box: `lovelace`, `token` if any and
/// nothing else, and a box's datum.
fn is_box(e: &db::Ever, lovelace: u64, token: Option<&Asset>) -> bool {
    let assets_match = match (token, e.assets.as_slice()) {
        (None, []) => true,
        (Some(Asset(policy, name, quantity, _)), [[p, n, q]]) => {
            p == policy && n == name && q == quantity
        }
        _ => false,
    };
    e.lovelace == lovelace.to_string()
        && assets_match
        && e.datum.as_deref().is_some_and(super::datum::is_mix_datum)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::row::{Point, Row};

    fn found(reference: &str, block: i64) -> Found {
        Found {
            id: block,
            row: Row {
                reference: reference.into(),
                address: String::new(),
                lovelace: "1".into(),
                assets: vec![],
                datum: None,
                script: false,
                created: Point::at(block * 20),
                spent: None,
                made_by: None,
            },
            tx_id: block,
            tx: reference.into(),
            block,
            index: 4,
            slot: block * 20,
        }
    }

    #[test]
    fn a_standard_pool_is_taken_where_its_launch_is_now() {
        let pool = match standard::tests::standard_pool() {
            Verdict::Standard(pool) => pool,
            other => panic!("{other:?}"),
        };
        let verdicts: HashMap<String, Verdict> = [
            ("a#0".to_string(), Verdict::Standard(pool.clone())),
            ("b#0".to_string(), Verdict::Rejected("no")),
        ]
        .into();
        let pools = standard_of(
            &[found("a#0", 77), found("b#0", 78), found("c#0", 79)],
            |r| verdicts.get(r),
        );
        assert_eq!(pools.len(), 1);
        assert_eq!(
            (
                pools[0].launch.block,
                pools[0].launch.index,
                pools[0].launch.slot
            ),
            (77, 4, 1540)
        );
        assert_ne!(pool.launch.block, 77);
    }
}
