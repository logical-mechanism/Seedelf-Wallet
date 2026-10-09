//! The private index's compact row: everything the wallet reads from a
//! contract UTxO, and nothing else (chunk 26's plan, "The compact row").

use serde::Serialize;

use crate::constants::{MIXBOX_HASH, SEEDELF_POLICY, SEEDELF_PREFIX};

/// Where on chain something happened: the block's height, its slot, and its time (Unix seconds).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Point {
    pub block: i64,
    pub slot: i64,
    pub time: i64,
}

/// A spend: where it happened, and the transaction that made it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Spend {
    #[serde(flatten)]
    pub at: Point,
    pub by: String,
}

/// Who made a Lovejoin box: whether its transaction spent a box itself, and
/// each of its inputs' payment and stake credentials (hex), so the wallet can
/// tell its own boxes from the feed alone, with no request about one box.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MadeBy {
    pub mixed: bool,
    pub inputs: Vec<[Option<String>; 2]>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Row {
    /// `<tx hash>#<index>`.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The exact bech32: both the enterprise and the staked form sit at the contract.
    pub address: String,
    pub lovelace: String,
    /// `[policy, name, quantity]`, hex and a decimal string.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<[String; 3]>,
    /// The inline datum's CBOR, hex. The wallet's own parser decides what it means.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub datum: Option<String>,
    /// The output carries a reference script: the wallet never spends one.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub script: bool,
    pub created: Point,
    /// Only in a "since" answer's `created`: the row was spent after it was made.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spent: Option<Spend>,
    /// Only for Lovejoin's boxes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub made_by: Option<MadeBy>,
}

/// An older row spent since a cursor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Spent {
    #[serde(rename = "ref")]
    pub reference: String,
    #[serde(flatten)]
    pub spend: Spend,
}

impl Row {
    /// The Seedelf name this row holds, if any: the first asset under the
    /// Seedelf policy whose name has the prefix, as the wallet's `seedelfTokenOf` takes it.
    pub fn seedelf_name(&self) -> Option<&str> {
        self.assets
            .iter()
            .find(|[policy, name, _]| policy == SEEDELF_POLICY && name.starts_with(SEEDELF_PREFIX))
            .map(|[_, name, _]| name.as_str())
    }
}

/// Reads the shared row columns (`chain::ROW_COLUMNS`); the spend columns too when `with_spend`.
pub fn read_row(row: &tokio_postgres::Row, with_spend: bool) -> anyhow::Result<Row> {
    let assets: Vec<[String; 3]> = serde_json::from_str(row.try_get::<_, &str>("assets")?)?;
    let made_by = row
        .try_get::<_, Option<&str>>("inputs")?
        .map(serde_json::from_str::<Vec<[Option<String>; 2]>>)
        .transpose()?
        .map(|inputs| MadeBy {
            mixed: inputs
                .iter()
                .any(|[payment, _]| payment.as_deref() == Some(MIXBOX_HASH)),
            inputs,
        });
    Ok(Row {
        reference: row.try_get("ref")?,
        address: row.try_get("address")?,
        lovelace: row.try_get("lovelace")?,
        assets,
        datum: row.try_get("datum")?,
        script: row.try_get("script")?,
        created: Point {
            block: row.try_get("block")?,
            slot: row.try_get("slot")?,
            time: row.try_get("time")?,
        },
        spent: if with_spend { read_spend(row)? } else { None },
        made_by,
    })
}

/// Reads the spend columns (`chain::SPEND_COLUMNS`): `None` while unspent.
pub fn read_spend(row: &tokio_postgres::Row) -> anyhow::Result<Option<Spend>> {
    let by: Option<String> = row.try_get("spent_by")?;
    Ok(match by {
        None => None,
        Some(by) => Some(Spend {
            at: Point {
                block: row.try_get("spent_block")?,
                slot: row.try_get("spent_slot")?,
                time: row.try_get("spent_time")?,
            },
            by,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CONTRACT_HASH;

    fn row(assets: Vec<[String; 3]>) -> Row {
        Row {
            reference: format!("{}#0", "ab".repeat(32)),
            address: "addr1w…".into(),
            lovelace: "1500000".into(),
            assets,
            datum: Some("d8799f5830".into()),
            script: false,
            created: Point {
                block: 1,
                slot: 2,
                time: 3,
            },
            spent: None,
            made_by: None,
        }
    }

    fn asset(policy: &str, name: &str) -> [String; 3] {
        [policy.into(), name.into(), "1".into()]
    }

    #[test]
    fn a_seedelf_name_needs_the_policy_and_the_prefix() {
        let name = format!("{SEEDELF_PREFIX}{}", "00".repeat(28));
        assert_eq!(
            row(vec![asset(SEEDELF_POLICY, &name)]).seedelf_name(),
            Some(name.as_str())
        );
        assert_eq!(row(vec![asset(CONTRACT_HASH, &name)]).seedelf_name(), None);
        assert_eq!(
            row(vec![asset(SEEDELF_POLICY, "00".repeat(32).as_str())]).seedelf_name(),
            None
        );
        assert_eq!(row(vec![]).seedelf_name(), None);
    }

    #[test]
    fn empty_fields_stay_out_of_the_json() {
        let json = serde_json::to_value(row(vec![])).unwrap();
        let keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["address", "created", "datum", "lovelace", "ref"]);
    }

    #[test]
    fn a_spend_flattens_its_point() {
        let spend = Spend {
            at: Point {
                block: 10,
                slot: 20,
                time: 30,
            },
            by: "cd".repeat(32),
        };
        assert_eq!(
            serde_json::to_value(spend).unwrap(),
            serde_json::json!({"block": 10, "slot": 20, "time": 30, "by": "cd".repeat(32)})
        );
    }
}
