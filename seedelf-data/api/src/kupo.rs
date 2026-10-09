//! Kupo, the private index's second source: the Seedelf-only Kupo at home
//! (`kupo_seedelf.service`), matching the contract and the mix box, unpruned.
//! It needs only the node, so the private index keeps answering while
//! db-sync is down, behind, or resyncing.
//!
//! Its rows are db-sync's, field for field and in the same order
//! (`tests/live_private.rs`), but for one thing: a Lovejoin box's `made_by`
//! says whether its transaction spent a box, and leaves `inputs` null. Kupo
//! indexes outputs at our two credentials, not who paid for a transaction.
//!
//! Kupo's filters are inclusive: "after slot S" is `created_after=S+1`.

use std::collections::{BTreeMap, HashSet};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::chain::Block;
use crate::constants::MIXBOX_HASH;
use crate::row::{MadeBy, Point, Row, Spend, Spent};

/// Kupo answers from its own small database in milliseconds (4 ms for the
/// contract's snapshot over the LAN): one that takes seconds is down to us.
const TIMEOUT: Duration = Duration::from_secs(5);

/// A connection that takes longer than this won't come: home is unreachable.
const CONNECT: Duration = Duration::from_secs(3);

/// How many times an answer's reads are made again when a block lands between them.
const TRIES: usize = 3;

/// The header Kupo stamps every answer with: the slot it had indexed to.
const CHECKPOINT: &str = "x-most-recent-checkpoint";

#[derive(Clone)]
pub struct Kupo {
    http: reqwest::Client,
    base: String,
}

#[derive(Deserialize)]
struct Checkpoint {
    slot_no: i64,
    header_hash: String,
}

impl From<Checkpoint> for Block {
    fn from(point: Checkpoint) -> Self {
        Block {
            slot: point.slot_no,
            hash: point.header_hash,
        }
    }
}

#[derive(Deserialize)]
struct Value {
    coins: u64,
    #[serde(default)]
    assets: BTreeMap<String, u64>,
}

#[derive(Deserialize)]
struct SpentAt {
    slot_no: i64,
    transaction_id: Option<String>,
}

#[derive(Deserialize)]
struct Match {
    transaction_index: i64,
    transaction_id: String,
    output_index: i64,
    address: String,
    value: Value,
    /// With `?resolve_hashes`: the datum's CBOR, inline or found by its hash.
    #[serde(default)]
    datum: Option<String>,
    datum_type: Option<String>,
    script_hash: Option<String>,
    created_at: Checkpoint,
    spent_at: Option<SpentAt>,
}

impl Match {
    /// Where it sits on chain: db-sync's `tx_out.id` order.
    fn place(&self) -> (i64, i64, i64) {
        (
            self.created_at.slot_no,
            self.transaction_index,
            self.output_index,
        )
    }

    fn reference(&self) -> String {
        format!("{}#{}", self.transaction_id, self.output_index)
    }

    fn spend(&self) -> Result<Option<Spend>> {
        self.spent_at
            .as_ref()
            .map(|at| {
                Ok(Spend {
                    at: Point::at(at.slot_no),
                    by: at
                        .transaction_id
                        .clone()
                        .context("Kupo kept a spend without its transaction")?,
                })
            })
            .transpose()
    }

    /// The compact row, as db-sync's query makes it. `spent` only when asked for, as there.
    fn row(&self, with_spend: bool) -> Result<Row> {
        let assets = self
            .value
            .assets
            .iter()
            .map(|(unit, quantity)| {
                let (policy, name) = unit.split_once('.').unwrap_or((unit, ""));
                [policy.to_string(), name.to_string(), quantity.to_string()]
            })
            .collect();
        Ok(Row {
            reference: self.reference(),
            address: self.address.clone(),
            lovelace: self.value.coins.to_string(),
            assets,
            // db-sync's row has inline datums only: a hash's datum isn't the output's own.
            datum: match self.datum_type.as_deref() {
                Some("inline") => self.datum.clone(),
                _ => None,
            },
            script: self.script_hash.is_some(),
            created: Point::at(self.created_at.slot_no),
            spent: if with_spend { self.spend()? } else { None },
            made_by: None,
        })
    }
}

impl Kupo {
    pub fn new(url: &str) -> Result<Self> {
        Ok(Kupo {
            http: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .connect_timeout(CONNECT)
                .build()?,
            base: url.trim_end_matches('/').to_string(),
        })
    }

    /// `path`'s answer, and the checkpoint Kupo gave it at.
    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<(T, i64)> {
        // Errors by kind only: reqwest's own carry the URL, which names home.
        let response = self
            .http
            .get(format!("{}/{path}", self.base))
            .send()
            .await
            .map_err(|error| anyhow::anyhow!("Kupo is unreachable ({})", kind(&error)))?;
        if !response.status().is_success() {
            bail!("Kupo answered {}", response.status().as_u16());
        }
        let checkpoint = response
            .headers()
            .get(CHECKPOINT)
            .and_then(|value| value.to_str().ok()?.parse().ok())
            .context("Kupo's answer has no checkpoint")?;
        let body = response
            .bytes()
            .await
            .map_err(|error| anyhow::anyhow!("Kupo's answer broke off ({})", kind(&error)))?;
        Ok((serde_json::from_slice(&body)?, checkpoint))
    }

    /// Kupo's newest block: the first of its sample of checkpoints.
    pub async fn tip(&self) -> Result<Block> {
        let (sample, _) = self.get::<Vec<Checkpoint>>("checkpoints").await?;
        sample
            .into_iter()
            .next()
            .map(Block::from)
            .context("Kupo has no checkpoint yet")
    }

    /// The newest block at or before `slot`, if Kupo has one. It keeps every
    /// block's checkpoint from its start on (block 11,305,804), as db-sync does.
    pub async fn block_before(&self, slot: i64) -> Result<Option<Block>> {
        let (point, _) = self
            .get::<Option<Checkpoint>>(&format!("checkpoints/{slot}"))
            .await?;
        Ok(point.map(Block::from))
    }

    /// Each of `queries` on `cred`'s matches, all read at one checkpoint: a
    /// block landing between two reads would make one answer of two chain states.
    async fn together(&self, cred: &str, queries: &[String]) -> Result<Vec<Vec<Match>>> {
        for _ in 0..TRIES {
            let mut answers = Vec::with_capacity(queries.len());
            let mut at = HashSet::new();
            for query in queries {
                let (matches, checkpoint) = self
                    .get::<Vec<Match>>(&format!("matches/{cred}/*?{query}"))
                    .await?;
                answers.push(matches);
                at.insert(checkpoint);
            }
            if at.len() == 1 {
                return Ok(answers);
            }
        }
        bail!("Kupo's checkpoint kept moving between reads")
    }

    /// The rows at `cred` (hex) unspent as of the block at slot `at`.
    pub async fn unspent_as_of(&self, cred: &str, at: i64, provenance: bool) -> Result<Vec<Row>> {
        // Unspent first: a row spent between the two reads is in both, never in neither.
        let [unspent, spent] = self
            .together(
                cred,
                &[
                    format!("unspent&created_before={at}&resolve_hashes"),
                    format!(
                        "spent&created_before={at}&spent_after={}&resolve_hashes",
                        at + 1
                    ),
                ],
            )
            .await?
            .try_into()
            .map_err(|_| anyhow::anyhow!("two reads"))?;
        let mut seen = HashSet::new();
        let mut matches: Vec<Match> = unspent
            .into_iter()
            .chain(spent)
            .filter(|m| seen.insert(m.reference()))
            .collect();
        matches.sort_by_key(Match::place);
        self.rows(&matches, false, provenance).await
    }

    /// The rows at `cred` made after slot `after`, each with its spend if
    /// it's been spent since, and the rows made by then and spent after it.
    pub async fn since(
        &self,
        cred: &str,
        after: i64,
        provenance: bool,
    ) -> Result<(Vec<Row>, Vec<Spent>)> {
        let [mut created, mut spent] = self
            .together(
                cred,
                &[
                    format!("created_after={}&resolve_hashes", after + 1),
                    format!("spent&created_before={after}&spent_after={}", after + 1),
                ],
            )
            .await?
            .try_into()
            .map_err(|_| anyhow::anyhow!("two reads"))?;
        created.sort_by_key(Match::place);
        // db-sync's order: by the spend's slot and transaction, then where the row sits.
        spent.sort_by(|a, b| {
            let key = |m: &Match| {
                m.spent_at
                    .as_ref()
                    .map(|at| (at.slot_no, at.transaction_id.clone()))
            };
            key(a).cmp(&key(b)).then(a.place().cmp(&b.place()))
        });
        let spent = spent
            .iter()
            .map(|m| {
                Ok(Spent {
                    reference: m.reference(),
                    spend: m.spend()?.context("a spent match without its spend")?,
                })
            })
            .collect::<Result<_>>()?;
        Ok((self.rows(&created, true, provenance).await?, spent))
    }

    /// The rows at `cred` unspent now, at Kupo's checkpoint.
    pub async fn unspent_now(&self, cred: &str, provenance: bool) -> Result<Vec<Row>> {
        let [mut unspent] = self
            .together(cred, &["unspent&resolve_hashes".to_string()])
            .await?
            .try_into()
            .map_err(|_| anyhow::anyhow!("one read"))?;
        unspent.sort_by_key(Match::place);
        self.rows(&unspent, false, provenance).await
    }

    /// `matches` as rows; for Lovejoin's boxes, with whether each one's
    /// transaction spent a box. That transaction spent its inputs in the
    /// block that made the box, so the read needs no checkpoint of its own.
    async fn rows(
        &self,
        matches: &[Match],
        with_spend: bool,
        provenance: bool,
    ) -> Result<Vec<Row>> {
        let mut rows = matches
            .iter()
            .map(|m| m.row(with_spend))
            .collect::<Result<Vec<_>>>()?;
        let first = matches.iter().map(|m| m.created_at.slot_no).min();
        let (true, Some(first)) = (provenance, first) else {
            return Ok(rows);
        };
        let (spent, _) = self
            .get::<Vec<Match>>(&format!(
                "matches/{MIXBOX_HASH}/*?spent&spent_after={first}"
            ))
            .await?;
        let mixers: HashSet<String> = spent
            .into_iter()
            .filter_map(|m| m.spent_at?.transaction_id)
            .collect();
        for (row, m) in rows.iter_mut().zip(matches) {
            row.made_by = Some(MadeBy {
                mixed: mixers.contains(&m.transaction_id),
                inputs: None,
            });
        }
        Ok(rows)
    }
}

/// What kind of failure a request to Kupo was, without its URL.
fn kind(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timed out"
    } else if error.is_connect() {
        "no connection"
    } else if error.is_body() || error.is_decode() {
        "a broken answer"
    } else {
        "a failed request"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_match(json: serde_json::Value) -> Match {
        serde_json::from_value(json).unwrap()
    }

    fn base() -> serde_json::Value {
        serde_json::json!({
            "transaction_index": 3,
            "transaction_id": "ab".repeat(32),
            "output_index": 1,
            "address": "addr1w…",
            "value": { "coins": 1749860, "assets": {
                format!("{}.5eed0e1f00", "84".repeat(28)): 1,
                "11".repeat(28): 7,
            } },
            "datum_hash": "cd".repeat(32),
            "datum": "d8799f5830",
            "datum_type": "inline",
            "script_hash": null,
            "created_at": { "slot_no": 144889937, "header_hash": "ef".repeat(32) },
            "spent_at": null,
        })
    }

    #[test]
    fn a_match_is_db_syncs_row() {
        let row = a_match(base()).row(true).unwrap();
        assert_eq!(row.reference, format!("{}#1", "ab".repeat(32)));
        assert_eq!(row.lovelace, "1749860");
        // The asset with no name sorts first, as db-sync's (policy, name) does.
        assert_eq!(
            row.assets,
            vec![
                ["11".repeat(28), String::new(), "7".into()],
                ["84".repeat(28), "5eed0e1f00".into(), "1".into()],
            ]
        );
        assert_eq!(row.datum.as_deref(), Some("d8799f5830"));
        assert!(!row.script);
        assert_eq!(row.created, Point::at(144889937));
        assert_eq!(row.created.time, 1736456228);
        assert!(row.spent.is_none() && row.made_by.is_none());
    }

    #[test]
    fn only_an_inline_datum_is_the_rows() {
        let mut json = base();
        json["datum_type"] = "hash".into();
        assert_eq!(a_match(json).row(false).unwrap().datum, None);
    }

    #[test]
    fn a_spend_is_kept_only_when_asked_for() {
        let mut json = base();
        json["script_hash"] = "12".repeat(28).into();
        json["spent_at"] = serde_json::json!({
            "slot_no": 199952316, "header_hash": "ef".repeat(32),
            "transaction_id": "99".repeat(32), "input_index": 0, "redeemer": null,
        });
        let m = a_match(json);
        assert!(m.row(true).unwrap().script);
        let spent = m.row(true).unwrap().spent.unwrap();
        assert_eq!((spent.at.slot, spent.by), (199952316, "99".repeat(32)));
        assert!(m.row(false).unwrap().spent.is_none());
    }
}
