//! A zero withdrawal from a script's reward account, with its redeemer: the
//! "withdraw-zero" pattern, where a script registered as a stake credential
//! runs once per transaction to check the whole of it. Lovejoin's `mix_logic`
//! works this way: every mix and every withdraw of a box carries one.
//!
//! Pallas's builder can stage neither a withdrawal nor a `Reward` redeemer
//! (`pallas-txbuilder` 0.33 to 1.4 all write `withdrawals: None`, and its
//! `RedeemerPurpose` has no reward), so, as [`crate::staking`] does for
//! certificates, a built transaction is decoded, given the withdrawal and the
//! redeemer, its script data hash worked out again, and encoded. That changes
//! the body's hash, so it's patched first and signed after.

use anyhow::{Context, Result, anyhow, bail};
use pallas_codec::minicbor;
use pallas_codec::utils::{Bytes, MaybeIndefArray};
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::conway::{self, ExUnits, PlutusData, Redeemer, RedeemerTag, Redeemers};
use pallas_primitives::{Fragment, NonEmptyKeyValuePairs};
use pallas_txbuilder::BuiltTransaction;

use crate::build::tx_id;

/// A script's reward account (CIP-19 header `0b1111`), on preprod when
/// `network_flag` is set, as everywhere in the workspace.
pub fn reward_account(script_hash: &[u8; 28], network_flag: bool) -> Vec<u8> {
    let mut account = Vec::with_capacity(29);
    account.push(if network_flag { 0xf0 } else { 0xf1 });
    account.extend_from_slice(script_hash);
    account
}

/// The script data hash of a Plutus V3 transaction: blake2b-256 of its
/// redeemers, its witness datums if it has any, and the V3 language view
/// (`{2: cost model}`), each as the transaction encodes them. The same sum
/// `pallas-txbuilder` makes, which keeps it private.
pub fn script_data_hash(
    redeemers_cbor: &[u8],
    datums_cbor: Option<&[u8]>,
    cost_model_v3: &[i64],
) -> Result<Hash<32>> {
    let mut preimage = redeemers_cbor.to_vec();
    if let Some(datums) = datums_cbor {
        preimage.extend_from_slice(datums);
    }
    let mut view = minicbor::Encoder::new(Vec::new());
    view.map(1)
        .and_then(|e| e.u8(2))
        .and_then(|e| e.encode(cost_model_v3))
        .map_err(|e| anyhow!("The language view can't be encoded: {e}"))?;
    preimage.extend(view.into_writer());
    Ok(Hasher::<256>::hash(&preimage))
}

/// A zero withdrawal from `account` whose script is run with `redeemer`.
#[derive(Debug, Clone)]
pub struct WithdrawZero {
    pub account: Vec<u8>,
    pub redeemer: PlutusData,
}

impl WithdrawZero {
    pub fn new(script_hash: &[u8; 28], network_flag: bool, redeemer_cbor: &[u8]) -> Result<Self> {
        let redeemer = PlutusData::decode_fragment(redeemer_cbor)
            .map_err(|e| anyhow!("The withdrawal's redeemer isn't Plutus data: {e}"))?;
        Ok(WithdrawZero {
            account: reward_account(script_hash, network_flag),
            redeemer,
        })
    }

    /// Sets the withdrawal and its redeemer (with `budget`) in `built`, an
    /// unsigned Plutus V3 transaction, and returns it with its new script
    /// data hash and body hash. Patching again replaces the redeemer, which is
    /// how a measured budget goes in after a draft.
    pub fn patch(
        &self,
        mut built: BuiltTransaction,
        budget: ExUnits,
        cost_model_v3: &[i64],
    ) -> Result<BuiltTransaction> {
        if built.signatures.is_some() {
            bail!("A transaction is patched before it's signed, not after");
        }
        let mut tx = conway::Tx::decode_fragment(&built.tx_bytes.0)
            .map_err(|e| anyhow!("The built transaction isn't a Conway transaction: {e}"))?;
        let body = &mut tx.transaction_body;
        let account = Bytes::from(self.account.clone());
        let others = body
            .withdrawals
            .as_ref()
            .map(|w| w.iter().any(|(a, _)| *a != account))
            .unwrap_or(false);
        if others {
            bail!("The transaction already withdraws from another account");
        }
        body.withdrawals = Some(NonEmptyKeyValuePairs::Def(vec![(account, 0)]));

        let witness = &mut tx.transaction_witness_set;
        if witness.plutus_data.is_some() {
            bail!("A transaction with witness datums can't be given a withdraw-zero yet");
        }
        let mut redeemers = match witness.redeemer.take() {
            None => Vec::new(),
            Some(Redeemers::List(list)) => list.to_vec(),
            Some(Redeemers::Map(_)) => {
                bail!("The transaction's redeemers are a map, which this patch doesn't write")
            }
        };
        // One withdrawal, so its redeemer points at index 0.
        redeemers.retain(|r| r.tag != RedeemerTag::Reward);
        redeemers.push(Redeemer {
            tag: RedeemerTag::Reward,
            index: 0,
            data: self.redeemer.clone(),
            ex_units: budget,
        });
        let redeemers = Redeemers::List(MaybeIndefArray::Def(redeemers));
        let redeemers_cbor = minicbor::to_vec(&redeemers)
            .map_err(|e| anyhow!("The redeemers can't be encoded: {e}"))?;
        tx.transaction_body.script_data_hash =
            Some(script_data_hash(&redeemers_cbor, None, cost_model_v3)?);
        tx.transaction_witness_set.redeemer = Some(redeemers);

        let bytes = tx
            .encode_fragment()
            .map_err(|e| anyhow!("Failed to encode the transaction: {e}"))?;
        built.tx_hash.0 = *tx_id(&bytes).context("The patched transaction can't be hashed")?;
        built.tx_bytes.0 = bytes;
        Ok(built)
    }
}
