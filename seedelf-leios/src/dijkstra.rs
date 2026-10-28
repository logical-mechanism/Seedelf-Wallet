//! What Dijkstra, Leios's era, refuses in the wallet's transactions, and the
//! harness's mend for it.
//!
//! **The redeemers.** Musashi runs protocol version 12, and the ledger its node
//! is built on (cardano-ledger 9df9f98, `Alonzo/TxWits.hs`) decodes them as a
//! map alone from there: "List encoding of redeemers not supported starting
//! with PV 12". Dijkstra's CDDL drops the list form too. Pallas 0.35's
//! txbuilder writes them as a list (`Redeemers::List`), and so does core's
//! zero-withdrawal patch (`withdraw_zero.rs`), so every script transaction the
//! wallet builds, each Seedelf spend and each Lovejoin mix, is refused as it is.
//! A deposit, which runs no script, has no redeemers and goes as it is.
//!
//! The script data hash is over the redeemers' bytes as written, so it's
//! computed again (core's `orders::integrity_hash`), and the map is a byte
//! longer a redeemer, so the fee goes up by what those bytes cost, taken from
//! the payer's change, and the collateral's return comes down to keep 150% of
//! the fee. Nothing a script reads moves but the fee and that change, so the
//! scripts are run again to check they use what they declared.
//!
//! This is a mend for the harness, after the fact. In core it would be a step
//! of `Patches`, before `settle` prices the draft, as the other patches are:
//! that's for a later decision, never this folder.

use anyhow::{Context, Result, anyhow, bail};
use pallas_codec::minicbor;
use pallas_codec::utils::{NonEmptyKeyValuePairs, NonEmptySet};
use pallas_primitives::Fragment;
use pallas_primitives::conway::{
    self, PseudoTransactionOutput, Redeemers, RedeemersKey, RedeemersValue, ScriptRef,
    TransactionOutput, VKeyWitness, Value,
};
use pallas_traverse::MultiEraOutput;
use seedelf_core::build::{Budgets, linear_fee, reference_script_fee};
use seedelf_core::eval::{self, Resolved};
use seedelf_core::orders::integrity_hash;
use seedelf_core::transaction::computation_fee;
use seedelf_koios::koios::ProtocolParameters;

/// What in `tx` a Dijkstra node at protocol version 12 would refuse to decode,
/// in words. Empty when nothing is.
pub fn refusals(tx: &[u8]) -> Result<Vec<&'static str>> {
    let tx = conway::Tx::decode_fragment(tx).map_err(|e| anyhow!("not a Conway transaction: {e}"))?;
    let mut found = Vec::new();
    if matches!(tx.transaction_witness_set.redeemer, Some(Redeemers::List(_))) {
        found.push("redeemers written as a list (PV 12 takes a map only)");
    }
    // Dijkstra's multiasset is `{+ policy => {+ name => n}}`: never empty.
    let empty_assets = tx.transaction_body.outputs.iter().any(|o| match o {
        PseudoTransactionOutput::PostAlonzo(o) => matches!(&o.value, Value::Multiasset(_, m) if m.is_empty()),
        PseudoTransactionOutput::Legacy(_) => false,
    });
    if empty_assets {
        found.push("an output with an empty token map");
    }
    if tx.transaction_body.mint.as_ref().is_some_and(|m| m.is_empty()) {
        found.push("an empty mint");
    }
    // PV 12 refuses a witness set with the same key twice.
    if let Some(vkeys) = &tx.transaction_witness_set.vkeywitness {
        let mut keys: Vec<&[u8]> = vkeys.iter().map(|w| w.vkey.as_ref()).collect();
        keys.sort();
        if keys.windows(2).any(|w| w[0] == w[1]) {
            found.push("the same key's signature twice");
        }
    }
    Ok(found)
}

/// A transaction mended for Dijkstra, unsigned.
#[derive(Debug, Clone)]
pub struct Mended {
    pub tx: Vec<u8>,
    pub fee_before: u64,
    pub fee_after: u64,
    /// Signed size, before and after.
    pub size_before: u64,
    pub size_after: u64,
}

/// `tx` with its redeemers as a map, its script data hash and fee to match,
/// the fee's rise taken from output `change`, and its collateral return
/// lowered to keep 150% of the fee. `known` resolves every input, reference
/// input and collateral, for running the scripts again. `signers` is how many
/// keys will sign it, for its size. Its signatures, if any, are dropped:
/// the body changes, so they'd be over another transaction.
pub fn mend(
    tx: &[u8],
    params: &ProtocolParameters,
    change: usize,
    signers: usize,
    known: &[Resolved],
) -> Result<Mended> {
    let mut tx = conway::Tx::decode_fragment(tx).map_err(|e| anyhow!("not a Conway transaction: {e}"))?;
    tx.transaction_witness_set.vkeywitness = None;
    let size_before = signed_size(&tx, signers)?;
    let fee_before = tx.transaction_body.fee;

    let list = match tx.transaction_witness_set.redeemer.take() {
        Some(Redeemers::List(list)) => list.to_vec(),
        Some(map @ Redeemers::Map(_)) => {
            tx.transaction_witness_set.redeemer = Some(map);
            Vec::new()
        }
        None => bail!("No redeemers: a transaction that runs no script goes as it is"),
    };
    if !list.is_empty() {
        let mut pairs: Vec<(RedeemersKey, RedeemersValue)> = list
            .into_iter()
            .map(|r| {
                (
                    RedeemersKey {
                        tag: r.tag,
                        index: r.index,
                    },
                    RedeemersValue {
                        data: r.data,
                        ex_units: r.ex_units,
                    },
                )
            })
            .collect();
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        tx.transaction_witness_set.redeemer = Some(Redeemers::Map(NonEmptyKeyValuePairs::Def(pairs)));
    }
    rehash(&mut tx, params)?;

    let collateral_in: u64 = match &tx.transaction_body.collateral {
        None => 0,
        Some(inputs) => inputs
            .iter()
            .map(|i| lovelace_of(known, i.transaction_id.as_ref(), i.index))
            .sum::<Result<u64>>()?,
    };
    let script_fee = reference_script_fee(params, reference_script_bytes(&tx, known)?)?;
    let mut fee = fee_before;
    for _ in 0..6 {
        let units = declared_units(&tx);
        let needed = linear_fee(params, signed_size(&tx, signers)?)
            + units.iter().map(|(m, s)| computation_fee(params, *m, *s)).sum::<u64>()
            + script_fee;
        let next = needed.max(fee_before).next_multiple_of(2);
        if next == fee {
            break;
        }
        tx.transaction_body.fee = next;
        set_lovelace(&mut tx.transaction_body.outputs, change, |was| {
            was.checked_sub(next - fee).context("the change can't pay the rise")
        })?;
        if let Some(back) = tx.transaction_body.collateral_return.as_mut() {
            let keep = (next * 3).div_ceil(2) + 1;
            let most_back = collateral_in.checked_sub(keep).context("the collateral can't cover the fee")?;
            set_output_lovelace(back, |was| Ok(was.min(most_back)))?;
            if tx.transaction_body.total_collateral.is_some() {
                let returned = output_lovelace(back);
                tx.transaction_body.total_collateral = Some(collateral_in - returned);
            }
        }
        fee = next;
    }
    let bytes = tx.encode_fragment().map_err(|e| anyhow!("can't encode: {e}"))?;

    // The scripts see the new fee and change: run them again.
    let answer = eval::evaluate(&bytes, known, &params.cost_model_v3, true)?;
    let used = Budgets::from_ogmios(&answer)?;
    let declared = budgets_of(&tx);
    if !declared.covers(&used) {
        bail!("Mended, a script uses more than it declares: {answer}");
    }
    Ok(Mended {
        size_after: signed_size(&tx, signers)?,
        tx: bytes,
        fee_before,
        fee_after: fee,
        size_before,
    })
}

/// The script data hash from the transaction's own redeemer and datum bytes,
/// for Plutus V3 (every script the wallet runs).
fn rehash(tx: &mut conway::Tx, params: &ProtocolParameters) -> Result<()> {
    let w = &tx.transaction_witness_set;
    let redeemers = w.redeemer.as_ref().context("no redeemers")?;
    let redeemers_cbor = minicbor::to_vec(redeemers).map_err(|e| anyhow!("redeemers: {e}"))?;
    let datums_cbor = w
        .plutus_data
        .as_ref()
        .map(minicbor::to_vec)
        .transpose()
        .map_err(|e| anyhow!("datums: {e}"))?;
    tx.transaction_body.script_data_hash = Some(integrity_hash(
        &redeemers_cbor,
        datums_cbor.as_deref(),
        3,
        &params.cost_model_v3,
    )?);
    Ok(())
}

/// Each redeemer's declared (mem, steps).
fn declared_units(tx: &conway::Tx) -> Vec<(u64, u64)> {
    match &tx.transaction_witness_set.redeemer {
        Some(Redeemers::Map(m)) => m.iter().map(|(_, v)| (v.ex_units.mem, v.ex_units.steps)).collect(),
        Some(Redeemers::List(l)) => l.iter().map(|r| (r.ex_units.mem, r.ex_units.steps)).collect(),
        None => Vec::new(),
    }
}

/// The declared budgets, keyed as Ogmios keys them.
fn budgets_of(tx: &conway::Tx) -> Budgets {
    let entries: Vec<serde_json::Value> = match &tx.transaction_witness_set.redeemer {
        Some(Redeemers::Map(m)) => m
            .iter()
            .filter_map(|(k, v)| entry(k.tag, k.index, v.ex_units.mem, v.ex_units.steps))
            .collect(),
        Some(Redeemers::List(l)) => l
            .iter()
            .filter_map(|r| entry(r.tag, r.index, r.ex_units.mem, r.ex_units.steps))
            .collect(),
        None => Vec::new(),
    };
    Budgets::from_ogmios(&serde_json::json!({ "result": entries })).expect("well-formed")
}

/// One budget as Ogmios lists it; none for a purpose the wallet never runs
/// (`Budgets` holds spends, mints and withdrawals).
fn entry(tag: conway::RedeemerTag, index: u32, mem: u64, steps: u64) -> Option<serde_json::Value> {
    let purpose = match tag {
        conway::RedeemerTag::Spend => "spend",
        conway::RedeemerTag::Mint => "mint",
        conway::RedeemerTag::Reward => "withdraw",
        _ => return None,
    };
    Some(serde_json::json!({
        "validator": { "purpose": purpose, "index": index },
        "budget": { "memory": mem, "cpu": steps },
    }))
}

/// Signed size: the transaction with `signers` vkey witnesses of the real
/// shape (a 32-byte key, a 64-byte signature).
pub fn signed_size(tx: &conway::Tx, signers: usize) -> Result<u64> {
    let mut signed = tx.clone();
    let fakes: Vec<VKeyWitness> = (0..signers)
        .map(|i| VKeyWitness {
            vkey: vec![i as u8; 32].into(),
            signature: vec![0; 64].into(),
        })
        .collect();
    signed.transaction_witness_set.vkeywitness = NonEmptySet::from_vec(fakes);
    Ok(signed.encode_fragment().map_err(|e| anyhow!("can't encode: {e}"))?.len() as u64)
}

/// The bytes of every reference script the transaction's inputs and
/// reference inputs carry: what the reference-script fee prices.
fn reference_script_bytes(tx: &conway::Tx, known: &[Resolved]) -> Result<u64> {
    let mut total = 0;
    let refs = tx.transaction_body.reference_inputs.iter().flat_map(|s| s.iter());
    for input in tx.transaction_body.inputs.iter().chain(refs) {
        let utxo = find(known, input.transaction_id.as_ref(), input.index)?;
        if let Ok(TransactionOutput::PostAlonzo(o)) = minicbor::decode::<TransactionOutput>(&utxo.output) {
            if let Some(script) = o.script_ref {
                total += match script.0 {
                    ScriptRef::PlutusV3Script(s) => s.as_ref().len() as u64,
                    ScriptRef::PlutusV2Script(s) => s.as_ref().len() as u64,
                    ScriptRef::PlutusV1Script(s) => s.as_ref().len() as u64,
                    ScriptRef::NativeScript(_) => 0,
                };
            }
        }
    }
    Ok(total)
}

fn find<'a>(known: &'a [Resolved], hash: &[u8], index: u64) -> Result<&'a Resolved> {
    known
        .iter()
        .find(|r| r.tx_hash.as_slice() == hash && r.index == index)
        .with_context(|| format!("{}#{index} isn't known", hex::encode(hash)))
}

fn lovelace_of(known: &[Resolved], hash: &[u8], index: u64) -> Result<u64> {
    let utxo = find(known, hash, index)?;
    let output = MultiEraOutput::decode(pallas_traverse::Era::Conway, &utxo.output)
        .map_err(|e| anyhow!("{}#{index}: {e}", hex::encode(hash)))?;
    Ok(output.value().coin())
}

fn output_lovelace(output: &TransactionOutput) -> u64 {
    match output {
        PseudoTransactionOutput::PostAlonzo(o) => match &o.value {
            Value::Coin(c) | Value::Multiasset(c, _) => *c,
        },
        PseudoTransactionOutput::Legacy(o) => match &o.amount {
            pallas_primitives::alonzo::Value::Coin(c)
            | pallas_primitives::alonzo::Value::Multiasset(c, _) => *c,
        },
    }
}

fn set_output_lovelace(output: &mut TransactionOutput, f: impl Fn(u64) -> Result<u64>) -> Result<()> {
    match output {
        PseudoTransactionOutput::PostAlonzo(o) => match &mut o.value {
            Value::Coin(c) | Value::Multiasset(c, _) => *c = f(*c)?,
        },
        PseudoTransactionOutput::Legacy(_) => bail!("a legacy output"),
    }
    Ok(())
}

fn set_lovelace(
    outputs: &mut [TransactionOutput],
    index: usize,
    f: impl Fn(u64) -> Result<u64>,
) -> Result<()> {
    let output = outputs.get_mut(index).context("no such output")?;
    set_output_lovelace(output, f)
}
