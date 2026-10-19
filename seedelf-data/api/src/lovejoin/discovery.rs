//! Finding the shown pools in db-sync, and their crowds. Every launch puts
//! its reference UTxO at the holder, which takes no parameters, so the holder
//! is the index: each output there holding a `lovejoin` token is a candidate,
//! checked once ([`super::standard::check`]) and its verdict kept, since
//! nothing about a transaction on chain changes. What's at the holder is
//! locked for good, so spam there is burned, and costs this server one check.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
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

/// How many times a read on may find what it read on from replaced meanwhile
/// by a read from the start, and read on again, before it reads from the
/// start itself: such a read comes once an hour, or a few at once, as it's
/// due for every request then.
const READ_ON_TRIES: usize = 3;

/// The holder's candidates read so far: by the block at slot `upto`, with
/// output ids up to `high`.
struct Seen {
    found: Vec<Found>,
    upto: i64,
    high: i64,
    read: Instant,
    /// Which read from the start this is: a read on joins only the one it
    /// read on from (1.6.0's release review, DATA-3).
    generation: u64,
}

pub struct Discovery {
    listed: Arc<Listed>,
    holder: String,
    holder_cred: Vec<u8>,
    verdicts: Mutex<HashMap<String, Verdict>>,
    seen: Mutex<Option<Seen>>,
    /// Reads from the start so far: each one's [`Seen::generation`].
    reads: AtomicU64,
}

impl Default for Discovery {
    fn default() -> Self {
        Discovery {
            listed: Arc::new(Listed::mainnet()),
            holder: standard::holder_address(),
            holder_cred: bytes(HOLDER_HASH),
            verdicts: Mutex::new(HashMap::new()),
            seen: Mutex::new(None),
            reads: AtomicU64::new(0),
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
        self.found_with(at, |at, after| {
            db::found(chain, &self.holder_cred, NFT_NAME, at, after)
        })
        .await
    }

    /// [`Self::found`], with `read(at, after)` reading the holder's candidates
    /// by the block at slot `at` whose ids are above `after`: db-sync, or a
    /// test's chain.
    async fn found_with<R, F>(&self, at: i64, read: R) -> Result<Vec<Found>>
    where
        R: Fn(i64, i64) -> F,
        F: Future<Output = Result<Vec<Found>>>,
    {
        let answer = |seen: &Option<Seen>| -> Vec<Found> {
            seen.as_ref()
                .map(|s| s.found.iter().filter(|f| f.slot <= at).cloned().collect())
                .unwrap_or_default()
        };
        for attempt in 0..=READ_ON_TRIES {
            // What's kept to read on from (its generation), or the start: past its hour, or once a read on has met
            // too many reads from the start, which a read from the start never does.
            let (from, high) = {
                let seen = self.seen.lock().expect("seen lock");
                match seen.as_ref() {
                    Some(s) if s.read.elapsed() < READ_AGAIN && attempt < READ_ON_TRIES => {
                        // Nothing newer to read: answered from what's kept, under the same lock, so a
                        // read from the start of an older block can't come between.
                        if at <= s.upto {
                            return Ok(answer(&seen));
                        }
                        (Some(s.generation), s.high)
                    }
                    _ => (None, 0),
                }
            };
            let newer = read(at, high).await?;
            let mut seen = self.seen.lock().expect("seen lock");
            match (from, seen.as_mut()) {
                // Read on: what's above the ids kept, whoever read on meanwhile. A later block's
                // outputs have higher ids than an earlier one's, so nothing between is missed.
                (Some(generation), Some(s)) if s.generation == generation => {
                    let known = s.high;
                    s.found.extend(newer.into_iter().filter(|f| f.id > known));
                    s.high = s.found.iter().map(|f| f.id).max().unwrap_or(known);
                    s.upto = s.upto.max(at);
                }
                // What it read on from was replaced meanwhile by a read from the start, perhaps by an
                // older block: what lies between that read's highest id and where this one started was
                // read by neither, so it's read on again from what's kept now (1.6.0's release review,
                // DATA-3).
                (Some(_), _) => continue,
                // The first read, or the hourly one: it stands alone.
                (None, _) => {
                    *seen = Some(Seen {
                        high: newer.iter().map(|f| f.id).max().unwrap_or(0),
                        found: newer,
                        upto: at,
                        read: Instant::now(),
                        generation: self.reads.fetch_add(1, Ordering::Relaxed) + 1,
                    });
                }
            }
            return Ok(answer(&seen));
        }
        unreachable!("the last attempt reads from the start, which always stands alone")
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

    /// The holder's candidates on a made-up chain: one a block, its id the block's.
    fn chain_of(blocks: &[i64]) -> Vec<Found> {
        blocks
            .iter()
            .map(|b| found(&format!("{b:02x}#0"), *b))
            .collect()
    }

    /// db-sync over `chain`: by the block at slot `at`, the ids above `after`.
    fn read_of(chain: &[Found]) -> impl Fn(i64, i64) -> std::future::Ready<Result<Vec<Found>>> {
        move |at, after| {
            std::future::ready(Ok(chain
                .iter()
                .filter(|f| f.slot <= at && f.id > after)
                .cloned()
                .collect()))
        }
    }

    fn ids(found: &[Found]) -> Vec<i64> {
        found.iter().map(|f| f.id).collect()
    }

    /// 1.6.0's release review, DATA-3: a request reading on from what's kept
    /// while another reads it all from the start (the hour up), by an older
    /// block, met that read's answer above its highest id. What lay between
    /// that and where the first started was read by neither, and so gone for
    /// up to an hour, a shown pool with it.
    #[tokio::test]
    async fn a_read_from_the_start_meanwhile_leaves_no_gap_in_a_read_on() {
        // Candidates at slots 200, 900, 960 and 1,100.
        let chain = chain_of(&[10, 45, 48, 55]);
        let discovery = Discovery::default();
        let read = discovery.found_with(1000, read_of(&chain)).await.unwrap();
        assert_eq!(ids(&read), [10, 45, 48]);
        // Reading on to slot 1,200, from 48: meanwhile another request reads from the start, by slot 900.
        let calls = std::cell::Cell::new(0);
        let read_on = |at, after| {
            calls.set(calls.get() + 1);
            let first = calls.get() == 1;
            let (discovery, chain) = (&discovery, &chain);
            async move {
                if first {
                    *discovery.seen.lock().unwrap() = None;
                    let older = discovery.found_with(900, read_of(chain)).await?;
                    assert_eq!(ids(&older), [10, 45]);
                }
                read_of(chain)(at, after).await
            }
        };
        let read = discovery.found_with(1200, read_on).await.unwrap();
        assert_eq!(ids(&read), [10, 45, 48, 55]);
        // And what's kept, for whoever reads on next.
        let read = discovery.found_with(1300, read_of(&chain)).await.unwrap();
        assert_eq!(ids(&read), [10, 45, 48, 55]);
    }

    /// DATA-3's fix, bounded: a read on that keeps meeting reads from the
    /// start reads from the start itself, which stands alone.
    #[tokio::test]
    async fn a_read_on_that_keeps_meeting_reads_from_the_start_reads_from_the_start() {
        let chain = chain_of(&[10, 45, 48, 55]);
        let discovery = Discovery::default();
        discovery.found_with(1000, read_of(&chain)).await.unwrap();
        let calls = std::cell::Cell::new(0);
        let read_on = |at, after| {
            calls.set(calls.get() + 1);
            let (discovery, chain) = (&discovery, &chain);
            async move {
                *discovery.seen.lock().unwrap() = None;
                discovery.found_with(900, read_of(chain)).await?;
                read_of(chain)(at, after).await
            }
        };
        let read = discovery.found_with(1200, read_on).await.unwrap();
        assert_eq!(ids(&read), [10, 45, 48, 55]);
        assert_eq!(calls.get(), READ_ON_TRIES + 1);
    }
}
