//! Starting a token pool, in one transaction straight from the private
//! balance: no half-launched pool, nothing stranded between steps.
//!
//! The transaction is a Seedelf spend ([`crate::build::ScriptSpend`]) of
//! ADA-only Seedelf UTxOs, the first of them the seed, with giveme.my's
//! collateral, and:
//!
//! - the NFT, minted under `one_shot_mint(seed)`, carried in the witnesses
//!   (it's used once);
//! - the reference UTxO at the holder: the NFT and the eight-field datum;
//! - `mix_box`'s and `mix_logic`'s reference scripts at the holder, where
//!   they stay for good, read by every mix and withdraw of the pool;
//! - `mix_logic`'s stake registration (Shelley's certificate 0, which no
//!   script witnesses), unless the credential is registered already, which
//!   anyone who reads the seed can arrange first;
//! - the change, back into the Seedelf under a fresh register.
//!
//! The token isn't spent: the datum only names it. What never comes back is
//! the three outputs' ADA and the stake deposit ([`Locked`]).
//!
//! Before it's returned, the pool it would make is checked as any found pool
//! is ([`super::verify_pool`]) and must be usable ([`super::usable`]); a
//! finished launch is checked again from its own bytes ([`launched_pool`]).

use super::pool::{ReferenceDatum, Rejected, candidate, holder_address, usable, verify_pool};
use super::templates::{self, Derived, NFT_NAME};
use super::value::{BoxToken, BoxValue};
use super::{Protocol, UNIT};
use crate::assets::{Asset, Assets};
use crate::build::{Chain, ScriptSpend};
use crate::eval::{self, Resolved};
use crate::staking::Staking;
use anyhow::{Context, Result, anyhow, bail};
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::Certificate;
use pallas_primitives::{Fragment, StakeCredential};
use pallas_txbuilder::{Output, ScriptKind};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::UtxoResponse;

/// What a launch writes into the pool's datum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terms {
    pub token: BoxToken,
    /// Every box's ADA.
    pub box_lovelace: u64,
    /// The most a fee shard pays a mix. The wallet never uses shards, but
    /// `one_shot_mint` wants one under the box's ADA.
    pub max_fee: u64,
}

/// What a launch locks for good, in lovelace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Locked {
    /// The reference UTxO's ADA, its least.
    pub reference: u64,
    /// `mix_box`'s reference script's ADA, its least.
    pub mix_box: u64,
    /// `mix_logic`'s reference script's ADA, its least.
    pub mix_logic: u64,
    /// `mix_logic`'s stake deposit: none when it's registered already.
    pub deposit: u64,
}

impl Locked {
    pub fn total(&self) -> u64 {
        self.reference + self.mix_box + self.mix_logic + self.deposit
    }
}

/// A launch, before its inputs are proven: prove and measure [`Self::spend`]
/// as any Seedelf spend, then check the result with [`launched_pool`].
pub struct Launch {
    pub spend: ScriptSpend,
    pub seed: ([u8; 32], u64),
    pub derived: Derived,
    pub datum: ReferenceDatum,
    pub locked: Locked,
    /// The pool as it will be once on chain, its references standing in for
    /// the outputs the launch makes: what [`super::usable`] passed.
    pub pool: Protocol,
}

/// An output at the holder with `lovelace` its least: the price of a byte
/// counts the lovelace field too, so it's worked out until it stops moving.
fn least_at_holder(
    params: &seedelf_koios::koios::ProtocolParameters,
    output: impl Fn(u64) -> Result<Output>,
) -> Result<(Output, u64)> {
    let mut lovelace = 1_000_000;
    for _ in 0..4 {
        let needed = crate::transaction::calculate_min_required_utxo(output(lovelace)?, params)?;
        if needed == lovelace {
            return Ok((output(lovelace)?, lovelace));
        }
        lovelace = needed;
    }
    bail!("An output's least ADA didn't settle")
}

fn resolved(first: u8, output: &Output) -> Result<Resolved> {
    Ok(Resolved {
        tx_hash: [first; 32],
        index: 0,
        output: output
            .build_babbage_raw()
            .context("An output can't be built")?
            .encode_fragment()
            .map_err(|e| anyhow!("An output can't be encoded: {e}"))?,
    })
}

/// Builds the launch of a pool with `terms`, spending `inputs` (ADA-only
/// Seedelf UTxOs, owned; the first is the seed) and registering
/// `mix_logic`'s credential when `register` (it isn't yet, by
/// `account_info`). The change goes back under fresh re-randomizations of
/// `change_owner`; `signer` is the one-time key's hash, as for every
/// Seedelf spend.
pub fn launch(
    chain: &Chain,
    inputs: &[UtxoResponse],
    terms: &Terms,
    register: bool,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<Launch> {
    let network_flag = chain.network_flag;
    let params = &chain.params;
    let first = inputs
        .first()
        .context("A launch spends at least one UTxO")?;
    if inputs
        .iter()
        .any(|u| u.asset_list.as_ref().is_some_and(|a| !a.is_empty()))
    {
        bail!("A launch spends Seedelf UTxOs that hold ADA alone");
    }
    if hex::encode(terms.token.policy) == chain.config.contract.seedelf_policy_id {
        bail!("A Seedelf's identifier token can't have a pool");
    }
    let seed_tx: [u8; 32] = hex::decode(&first.tx_hash)?
        .try_into()
        .map_err(|_| anyhow!("The seed's transaction hash isn't 32 bytes"))?;
    let seed = (seed_tx, first.tx_index);
    let derived = templates::derive(&seed.0, seed.1)?;
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: terms.box_lovelace,
            token: Some(terms.token.clone()),
        },
        max_fee: terms.max_fee,
        mix_box_hash: derived.mix_box.hash,
        mix_logic_hash: derived.mix_logic.hash,
        fee_hash: derived.fee_contract.hash,
    };
    // The datum must be one one_shot_mint takes, and the wallet reads.
    let encoded = datum.encode();
    if ReferenceDatum::decode(&encoded).as_ref() != Ok(&datum) {
        bail!("These terms aren't a pool one_shot_mint allows");
    }

    let holder = holder_address(network_flag);
    let policy = Hash::new(derived.policy());
    let (reference, reference_lovelace) = least_at_holder(params, |lovelace| {
        Ok(Output::new(holder.clone(), lovelace)
            .add_asset(policy, NFT_NAME.to_vec(), 1)?
            .set_inline_datum(encoded.clone()))
    })?;
    let script_output = |script: &templates::Script| {
        least_at_holder(params, |lovelace| {
            Ok(Output::new(holder.clone(), lovelace)
                .set_inline_script(ScriptKind::PlutusV3, script.cbor.clone()))
        })
    };
    let (mix_box, mix_box_lovelace) = script_output(&derived.mix_box)?;
    let (mix_logic, mix_logic_lovelace) = script_output(&derived.mix_logic)?;

    // The pool these outputs make, checked as a stranger's would be, and
    // usable once its credential is registered.
    let pool = verify_pool(
        network_flag,
        &resolved(0x01, &reference)?,
        seed,
        &[resolved(0x02, &mix_box)?, resolved(0x03, &mix_logic)?],
    )
    .map_err(|e| anyhow!("The pool this would launch isn't one the wallet trusts: {e}"))?;
    if !pool.inline_scripts.is_empty() {
        bail!("The pool this would launch doesn't read its scripts from the holder");
    }
    usable(params, &pool, true)
        .map_err(|e| anyhow!("The pool this would launch couldn't be used: {e}"))?;

    let staking = if register {
        Staking {
            certificates: vec![Certificate::StakeRegistration(StakeCredential::ScriptHash(
                Hash::new(derived.mix_logic.hash),
            ))],
            ..Staking::none()
        }
    } else {
        Staking::none()
    };
    let nft = Assets::new().add(Asset::new(
        hex::encode(derived.policy()),
        hex::encode(NFT_NAME),
        1,
    )?)?;
    let spend = ScriptSpend::new(chain, inputs, change_owner, signer)?
        .output(reference, &nft)?
        .output(mix_box, &Assets::new())?
        .output(mix_logic, &Assets::new())?
        .mint_inline(
            policy,
            derived.one_shot_mint.cbor.clone(),
            NFT_NAME.to_vec(),
            1,
            UNIT.to_vec(),
        )?
        .with_staking(staking.clone())?;
    Ok(Launch {
        spend,
        seed,
        derived,
        datum,
        locked: Locked {
            reference: reference_lovelace,
            mix_box: mix_box_lovelace,
            mix_logic: mix_logic_lovelace,
            deposit: staking.deposit_at(params.key_deposit),
        },
        pool,
    })
}

/// The pool a finished launch makes, read from its own outputs and checked
/// as any found pool is: its reference UTxO, and its two scripts by
/// reference at the holder. What the wallet records for a launch it made,
/// and refuses to sign if it isn't the pool it meant.
pub fn launched_pool(
    network_flag: bool,
    tx_cbor: &[u8],
    seed: ([u8; 32], u64),
) -> Result<Protocol> {
    let outputs = eval::resolve_outputs(tx_cbor)?;
    let reference = outputs
        .iter()
        .find(|o| candidate(network_flag, o).is_ok())
        .context("The launch makes no reference UTxO the wallet would read")?;
    let pool = verify_pool(network_flag, reference, seed, &outputs)
        .map_err(|e: Rejected| anyhow!("The launch's pool isn't one the wallet trusts: {e}"))?;
    if !pool.inline_scripts.is_empty() {
        bail!("The launch doesn't publish its scripts at the holder");
    }
    Ok(pool)
}
