//! Script budgets measured inside the wallet, with Aiken's `uplc`, instead of
//! asking Ogmios (through Koios) to evaluate a draft.
//!
//! The answer has the shape of Ogmios's `evaluateTransaction` answer, so
//! [`crate::build::Budgets::from_ogmios`] reads either, and a failed script is
//! put in words the same way.
//!
//! Evaluating locally is what lets a chain of transactions be built before any
//! of it is on chain: a transaction can spend the outputs of one that hasn't
//! been sent yet, since the wallet hands the evaluator every UTxO itself
//! ([`resolve_outputs`]). `uplc` 1.1.23 matched the chain's budgets exactly on
//! recorded preprod transactions (Seedelf spends, and Lovejoin's mixes and
//! withdraws) under both the 297- and 350-parameter V3 cost models; 1.1.21
//! didn't, which is why it must be kept current across hard forks.

use crate::references;
use anyhow::{Context, Result, anyhow, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::{CostModels, Redeemer, RedeemerTag};
use pallas_traverse::MultiEraTx;
use seedelf_koios::koios::UtxoResponse;
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// The most a single script may use while measured. The ledger's
/// per-transaction limit (10 billion steps, 17.5 million memory units on
/// preprod and mainnet in 2026) caps the whole transaction; the builders check
/// the total.
const MEASURE_LIMIT: (u64, u64) = (14_000_000_000, 20_000_000);

/// A UTxO the evaluator can see: where it is, and its output's CBOR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub tx_hash: [u8; 32],
    pub index: u64,
    pub output: Vec<u8>,
}

impl Resolved {
    fn input_cbor(&self) -> Result<Vec<u8>> {
        let mut e = minicbor::Encoder::new(Vec::new());
        e.array(2)?.bytes(&self.tx_hash)?.u64(self.index)?;
        Ok(e.into_writer())
    }
}

/// A Koios UTxO row as the evaluator needs it. A reference script on the row
/// isn't carried over (the wallet's own UTxOs don't hold one), so such a row
/// is refused rather than evaluated wrongly.
pub fn resolve_row(row: &UtxoResponse) -> Result<Resolved> {
    let tx_hash: [u8; 32] = hex::decode(&row.tx_hash)?
        .try_into()
        .map_err(|_| anyhow!("UTxO {}#{} has a malformed hash", row.tx_hash, row.tx_index))?;
    if row.reference_script.as_ref().is_some_and(|s| !s.is_null()) {
        bail!(
            "UTxO {}#{} holds a reference script, which the wallet can't evaluate with yet",
            row.tx_hash,
            row.tx_index
        );
    }
    let address = Address::from_bech32(&row.address)
        .map_err(|e| {
            anyhow!(
                "UTxO {}#{} has an unreadable address: {e}",
                row.tx_hash,
                row.tx_index
            )
        })?
        .to_vec();
    let lovelace: u64 = row.value.parse().map_err(|_| {
        anyhow!(
            "UTxO {}#{} has an unreadable value",
            row.tx_hash,
            row.tx_index
        )
    })?;
    // The ledger's value is a map ordered by policy, then by name, bytewise.
    let mut tokens: BTreeMap<Vec<u8>, BTreeMap<Vec<u8>, u64>> = BTreeMap::new();
    for asset in row.asset_list.iter().flatten() {
        let quantity: u64 = asset.quantity.parse().map_err(|_| {
            anyhow!(
                "UTxO {}#{} has an unreadable token amount",
                row.tx_hash,
                row.tx_index
            )
        })?;
        *tokens
            .entry(hex::decode(&asset.policy_id)?)
            .or_default()
            .entry(hex::decode(&asset.asset_name)?)
            .or_default() += quantity;
    }
    let inline = row
        .inline_datum
        .as_ref()
        .map(|d| hex::decode(&d.bytes))
        .transpose()?;
    let datum_hash = row.datum_hash.as_ref().map(hex::decode).transpose()?;

    let mut e = minicbor::Encoder::new(Vec::new());
    let fields = 2 + u64::from(inline.is_some() || datum_hash.is_some());
    e.map(fields)?.u8(0)?.bytes(&address)?.u8(1)?;
    if tokens.is_empty() {
        e.u64(lovelace)?;
    } else {
        e.array(2)?.u64(lovelace)?.map(tokens.len() as u64)?;
        for (policy, names) in &tokens {
            e.bytes(policy)?.map(names.len() as u64)?;
            for (name, quantity) in names {
                e.bytes(name)?.u64(*quantity)?;
            }
        }
    }
    match (inline, datum_hash) {
        // [1, #6.24(bytes .cbor plutus_data)]
        (Some(datum), _) => {
            e.u8(2)?
                .array(2)?
                .u8(1)?
                .tag(minicbor::data::Tag::new(24))?
                .bytes(&datum)?;
        }
        (None, Some(hash)) => {
            e.u8(2)?.array(2)?.u8(0)?.bytes(&hash)?;
        }
        (None, None) => {}
    }
    Ok(Resolved {
        tx_hash,
        index: row.tx_index,
        output: e.into_writer(),
    })
}

/// Every output of a built transaction, as UTxOs a later transaction in the
/// same chain can spend before this one is on chain.
pub fn resolve_outputs(tx_cbor: &[u8]) -> Result<Vec<Resolved>> {
    let tx =
        MultiEraTx::decode(tx_cbor).map_err(|e| anyhow!("The transaction can't be read: {e}"))?;
    let tx_hash: [u8; 32] = *tx.hash();
    Ok(tx
        .outputs()
        .iter()
        .enumerate()
        .map(|(index, output)| Resolved {
            tx_hash,
            index: index as u64,
            output: output.encode(),
        })
        .collect())
}

/// The Seedelf contracts' reference UTxOs on a network (`true` is preprod,
/// as everywhere in the workspace).
pub fn seedelf_references(network_flag: bool) -> Result<Vec<Resolved>> {
    let config = crate::constants::get_config(crate::constants::VARIANT, network_flag)?;
    let (wallet, seedelf) = if network_flag {
        (references::PREPROD_WALLET, references::PREPROD_SEEDELF)
    } else {
        (references::MAINNET_WALLET, references::MAINNET_SEEDELF)
    };
    Ok(vec![
        Resolved {
            tx_hash: config.reference.wallet_reference_utxo,
            index: 1,
            output: hex::decode(wallet)?,
        },
        Resolved {
            tx_hash: config.reference.seedelf_reference_utxo,
            index: 1,
            output: hex::decode(seedelf)?,
        },
    ])
}

/// Where slot 0 of the Shelley era sits, for the time a script sees.
fn slot_config(network_flag: bool) -> (u64, u64, u32) {
    if network_flag {
        (1_655_769_600_000, 86_400, 1_000)
    } else {
        (1_596_059_091_000, 4_492_800, 1_000)
    }
}

fn purpose(tag: &RedeemerTag) -> &'static str {
    match tag {
        RedeemerTag::Spend => "spend",
        RedeemerTag::Mint => "mint",
        RedeemerTag::Cert => "publish",
        RedeemerTag::Reward => "withdraw",
        RedeemerTag::Vote => "vote",
        RedeemerTag::Propose => "propose",
    }
}

/// Measures every script in `tx_cbor` against `known`, the UTxOs it spends
/// and reads (from Koios rows, earlier transactions of a chain, or the bundled
/// references). Answers as Ogmios does: `{ result: [{ validator: { purpose,
/// index }, budget: { memory, cpu } }] }`, or `{ error: … }` naming the
/// script that failed.
pub fn evaluate(
    tx_cbor: &[u8],
    known: &[Resolved],
    cost_model_v3: &[i64],
    network_flag: bool,
) -> Result<Value> {
    let tx =
        MultiEraTx::decode(tx_cbor).map_err(|e| anyhow!("The transaction can't be read: {e}"))?;
    let mut pairs = Vec::new();
    for input in tx.inputs().iter().chain(tx.reference_inputs().iter()) {
        let hash: Hash<32> = *input.hash();
        let index = input.index();
        let resolved = known
            .iter()
            .find(|r| r.tx_hash == *hash && r.index == index)
            .with_context(|| {
                format!("The wallet doesn't have UTxO {hash}#{index}, which this transaction uses")
            })?;
        pairs.push((resolved.input_cbor()?, resolved.output.clone()));
    }
    let cost_models = CostModels {
        plutus_v1: None,
        plutus_v2: None,
        plutus_v3: Some(cost_model_v3.to_vec()),
    };
    let cost_models = minicbor::to_vec(&cost_models)
        .map_err(|e| anyhow!("The cost model can't be encoded: {e}"))?;

    match uplc::tx::eval_phase_two_raw(
        tx_cbor,
        &pairs,
        Some(&cost_models),
        MEASURE_LIMIT,
        slot_config(network_flag),
        true,
        |_| (),
    ) {
        Ok(results) => {
            let mut rows = Vec::with_capacity(results.len());
            for (redeemer, result) in results {
                let redeemer: Redeemer = minicbor::decode(&redeemer)
                    .map_err(|e| anyhow!("The evaluator returned an unreadable redeemer: {e}"))?;
                let cost = result.cost();
                rows.push(json!({
                    "validator": { "purpose": purpose(&redeemer.tag), "index": redeemer.index },
                    "budget": { "memory": cost.mem, "cpu": cost.cpu },
                }));
            }
            Ok(json!({ "result": rows }))
        }
        Err(uplc::tx::error::Error::RedeemerError { tag, index, err }) => {
            let reason = err.to_string();
            let reason = reason.lines().next().unwrap_or("failed").to_string();
            Ok(json!({
                "error": {
                    "code": 3010,
                    "message": "Some scripts of the transaction terminated with error(s).",
                    "data": [{
                        "validator": { "purpose": ogmios_purpose(&tag), "index": index },
                        "error": { "message": reason, "data": { "validationError": reason, "traces": [] } },
                    }],
                }
            }))
        }
        Err(e) => bail!("The wallet couldn't evaluate the transaction: {e}"),
    }
}

/// `uplc` names purposes as the redeemer tags are spelled in Rust.
fn ogmios_purpose(tag: &str) -> &'static str {
    match tag.to_ascii_lowercase().as_str() {
        "spend" => "spend",
        "mint" => "mint",
        "cert" => "publish",
        "reward" | "withdraw" => "withdraw",
        "vote" => "vote",
        _ => "propose",
    }
}

/// A built transaction's outputs as Ogmios v6 UTxOs, for
/// `evaluateTransaction`'s `additionalUtxo`: with them the network's own
/// evaluator can measure a transaction whose parents aren't on chain yet (a
/// chain's first mix, on its unsent deposit). That's the check that the
/// wallet's evaluator still costs scripts as the network does.
pub fn ogmios_utxos(tx_cbor: &[u8]) -> Result<Value> {
    let tx =
        MultiEraTx::decode(tx_cbor).map_err(|e| anyhow!("The transaction can't be read: {e}"))?;
    let id = hex::encode(tx.hash());
    let mut rows = Vec::new();
    for (index, output) in tx.outputs().iter().enumerate() {
        let address = output
            .address()
            .map_err(|e| anyhow!("An output's address can't be read: {e}"))?
            .to_bech32()
            .map_err(|e| anyhow!("An output's address can't be written: {e}"))?;
        let value = output.value();
        let mut amounts = serde_json::Map::new();
        amounts.insert("ada".into(), json!({ "lovelace": value.coin() }));
        for policy in value.assets() {
            let mut names = serde_json::Map::new();
            for asset in policy.assets() {
                names.insert(
                    hex::encode(asset.name()),
                    json!(asset.output_coin().unwrap_or(0)),
                );
            }
            amounts.insert(hex::encode(policy.policy()), Value::Object(names));
        }
        let mut row = json!({
            "transaction": { "id": id },
            "index": index,
            "address": address,
            "value": amounts,
        });
        match output.datum() {
            Some(pallas_primitives::conway::PseudoDatumOption::Data(data)) => {
                row["datum"] = json!(hex::encode(data.raw_cbor()));
            }
            Some(pallas_primitives::conway::PseudoDatumOption::Hash(hash)) => {
                row["datumHash"] = json!(hex::encode(hash));
            }
            None => {}
        }
        rows.push(row);
    }
    Ok(Value::Array(rows))
}

/// Whether the budgets `tx_cbor` declares cover what `answer` measured
/// (Ogmios's `evaluateTransaction` answer, or [`evaluate`]'s), redeemer by
/// redeemer; the reason when they don't, a failed script included.
pub fn declared_covers(tx_cbor: &[u8], answer: &Value) -> Result<std::result::Result<(), String>> {
    let measured = match crate::build::Budgets::from_ogmios(answer) {
        Ok(budgets) => budgets,
        Err(e) => return Ok(Err(e.to_string())),
    };
    let tx =
        MultiEraTx::decode(tx_cbor).map_err(|e| anyhow!("The transaction can't be read: {e}"))?;
    let rows: Vec<Value> = tx
        .redeemers()
        .iter()
        .map(|r| {
            let units = r.ex_units();
            json!({
                "validator": { "purpose": purpose(&r.tag()), "index": r.index() },
                "budget": { "memory": units.mem, "cpu": units.steps },
            })
        })
        .collect();
    let declared = crate::build::Budgets::from_ogmios(&json!({ "result": rows }))?;
    Ok(if declared.covers(&measured) {
        Ok(())
    } else {
        Err("the network measures its scripts above what the wallet declared".to_string())
    })
}
