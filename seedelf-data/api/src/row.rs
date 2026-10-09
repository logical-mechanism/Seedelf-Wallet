//! The private index's compact row: everything the wallet reads from a
//! contract UTxO, and nothing else (chunk 26's plan, "The compact row").

use serde::Serialize;

use crate::constants::{MIXBOX_HASH, SEEDELF_POLICY, SEEDELF_PREFIX, slot_time};
use crate::decimals::Decimals;

/// Where on chain something happened: its block's slot, and its time (Unix
/// seconds). No height: Kupo, the second source, knows blocks by slot alone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Point {
    pub slot: i64,
    pub time: i64,
}

impl Point {
    pub fn at(slot: i64) -> Self {
        Point {
            slot,
            time: slot_time(slot),
        }
    }
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
/// `inputs` is null when Kupo answered: it knows the box's spends, not who paid.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MadeBy {
    pub mixed: bool,
    pub inputs: Option<Vec<[Option<String>; 2]>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Row {
    /// `<tx hash>#<index>`.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The exact bech32: both the enterprise and the staked form sit at the contract.
    pub address: String,
    pub lovelace: String,
    /// The tokens it holds, by policy and name.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<Asset>,
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

/// A token a row holds: `[policy, name, quantity, decimals]`, the first two
/// hex, the quantity a decimal string, and the token registry's decimals (0
/// for a token it doesn't list), as Koios puts them in every `asset_list`.
/// Both sources make a row's assets with 0, and the answer fills them in
/// (`with_decimals`), so their rows stay the same.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Asset(pub String, pub String, pub String, pub u8);

impl Asset {
    pub fn new(policy: String, name: String, quantity: String) -> Self {
        Asset(policy, name, quantity, 0)
    }
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
            .find(|Asset(policy, name, ..)| {
                policy == SEEDELF_POLICY && name.starts_with(SEEDELF_PREFIX)
            })
            .map(|Asset(_, name, ..)| name.as_str())
    }

    /// Its tokens' decimals, from the token registry (`decimals.rs`): what a
    /// wallet shows a token the list it carries doesn't have by, without
    /// asking about the token, which would say what it holds.
    pub fn with_decimals(mut self, decimals: &Decimals) -> Self {
        for asset in &mut self.assets {
            asset.3 = decimals.of(&asset.0, &asset.1);
        }
        self
    }
}

/// Reads the shared row columns (`chain::ROW_COLUMNS`); the spend columns too when `with_spend`.
pub fn read_row(row: &tokio_postgres::Row, with_spend: bool) -> anyhow::Result<Row> {
    let assets: Vec<[String; 3]> = serde_json::from_str(row.try_get::<_, &str>("assets")?)?;
    let assets = assets
        .into_iter()
        .map(|[policy, name, quantity]| Asset::new(policy, name, quantity))
        .collect();
    let made_by = row
        .try_get::<_, Option<&str>>("inputs")?
        .map(serde_json::from_str::<Vec<[Option<String>; 2]>>)
        .transpose()?
        .map(|inputs| MadeBy {
            mixed: inputs
                .iter()
                .any(|[payment, _]| payment.as_deref() == Some(MIXBOX_HASH)),
            inputs: Some(inputs),
        });
    Ok(Row {
        reference: row.try_get("ref")?,
        address: row.try_get("address")?,
        lovelace: row.try_get("lovelace")?,
        assets,
        datum: row.try_get("datum")?,
        script: row.try_get("script")?,
        created: Point::at(row.try_get("slot")?),
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
            at: Point::at(row.try_get("spent_slot")?),
            by,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CONTRACT_HASH;

    fn row(assets: Vec<Asset>) -> Row {
        Row {
            reference: format!("{}#0", "ab".repeat(32)),
            address: "addr1w…".into(),
            lovelace: "1500000".into(),
            assets,
            datum: Some("d8799f5830".into()),
            script: false,
            created: Point { slot: 2, time: 3 },
            spent: None,
            made_by: None,
        }
    }

    fn asset(policy: &str, name: &str) -> Asset {
        Asset::new(policy.into(), name.into(), "1".into())
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
    fn an_asset_is_an_array_with_the_registrys_decimals() {
        let decimals = Decimals::parse(r#"{"aabb0011": 6}"#).unwrap();
        let held = row(vec![asset("aabb", "0011"), asset("aabb", "0012")]).with_decimals(&decimals);
        assert_eq!(
            serde_json::to_value(&held).unwrap()["assets"],
            serde_json::json!([["aabb", "0011", "1", 6], ["aabb", "0012", "1", 0]])
        );
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
            at: Point { slot: 20, time: 30 },
            by: "cd".repeat(32),
        };
        assert_eq!(
            serde_json::to_value(spend).unwrap(),
            serde_json::json!({"slot": 20, "time": 30, "by": "cd".repeat(32)})
        );
    }
}
