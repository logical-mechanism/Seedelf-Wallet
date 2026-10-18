//! Starting a pool, in one transaction: no half-launched pool, nothing
//! stranded between steps. A token pool, or an ADA pool at any amount but the
//! classic pool's 10 ₳ (chunk 34's session 1, 17).
//!
//! What a launch makes is the same whoever pays for it:
//!
//! - the NFT, minted under `one_shot_mint(seed)`, carried in the witnesses
//!   (it's used once);
//! - the reference UTxO at the holder: the NFT and the eight-field datum;
//! - `mix_box`'s and `mix_logic`'s reference scripts at the holder, where
//!   they stay for good, read by every mix and withdraw of the pool;
//! - `mix_logic`'s stake registration (Shelley's certificate 0, which no
//!   script witnesses), unless the credential is registered already, which
//!   anyone who reads the seed can arrange first;
//! - the change, last.
//!
//! The outputs go in that order, never shuffled: `one_shot_mint` looks for
//! the reference UTxO among them, so its cost would move with a shuffle.
//!
//! Two payers:
//!
//! - **The private balance** ([`launch`], the default): a Seedelf spend
//!   ([`crate::build::ScriptSpend`]) of ADA-only Seedelf UTxOs, the first of
//!   them the seed, with giveme.my's collateral; the change goes back into
//!   the Seedelf under a fresh register.
//! - **The public account** ([`launch_from_account`], the user's choice to
//!   show that link): its UTxOs, the first of them the seed, and its own
//!   collateral; the change goes back to the account.
//!
//! The token isn't spent: the datum only names it. What never comes back is
//! the three outputs' ADA and the stake deposit ([`Locked`]).
//!
//! Before it's returned, the pool it would make is checked as any found pool
//! is ([`super::verify_pool`]) and must be usable ([`super::usable`]); a
//! finished launch is checked again from its own bytes ([`launched_pool`]).

use super::pool::{
    CLASSIC_LOVELACE, ReferenceDatum, Rejected, candidate, holder_address, usable, verify_pool,
};
use super::templates::{self, Derived, NFT_NAME};
use super::value::{BoxToken, BoxValue};
use super::{Protocol, UNIT};
use crate::assets::{Asset, Assets};
use crate::build::{
    Budgets, Chain, DRAFT_BUDGET, NotEnough, Patches, ScriptFee, ScriptSpend, account_collateral,
    account_inputs, built_with, change_outputs, even, expiring, input_of, linear_fee,
    reference_script_fee, settle,
};
use crate::eval::{self, Resolved};
use crate::staking::Staking;
use crate::transaction::{address_minimum_lovelace_with_assets, computation_fee};
use crate::utxos::{assets_of, reference_script_bytes};
use anyhow::{Context, Result, anyhow, bail};
use pallas_addresses::Address;
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::Certificate;
use pallas_primitives::{Fragment, StakeCredential};
use pallas_txbuilder::{BuiltTransaction, ExUnits, Output, ScriptKind, StagingTransaction};
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use std::collections::BTreeSet;

/// What a launch writes into the pool's datum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Terms {
    /// The token every box holds besides its ADA; none for an ADA pool, whose
    /// box is its ADA alone.
    pub token: Option<BoxToken>,
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

    /// What its three outputs hold: the total less the deposit.
    fn outputs(&self) -> u64 {
        self.reference + self.mix_box + self.mix_logic
    }
}

/// A launch from the private balance, before its inputs are proven: prove
/// and measure [`Self::spend`] as any Seedelf spend, then check the result
/// with [`launched_pool`].
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

/// What a launch spending `seed` makes, whoever pays for it.
struct Made {
    derived: Derived,
    datum: ReferenceDatum,
    policy: Hash<28>,
    /// The NFT, as the reference UTxO holds it.
    nft: Assets,
    /// The reference UTxO, then `mix_box`'s and `mix_logic`'s scripts.
    outputs: [Output; 3],
    staking: Staking,
    locked: Locked,
    pool: Protocol,
}

/// An output at the holder with `lovelace` its least: the price of a byte
/// counts the lovelace field too, so it's worked out until it stops moving.
fn least_at_holder(
    params: &ProtocolParameters,
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

/// Checks `terms` as a launch must meet them, before anything is derived: a
/// Seedelf's identifier token has no pool (`seedelf_policy` is the
/// contract's), and an ADA pool's box isn't the classic pool's 10 ₳, whose
/// copy is never shown.
fn check_terms(terms: &Terms, seedelf_policy: &str) -> Result<()> {
    match &terms.token {
        Some(token) if hex::encode(token.policy) == seedelf_policy => {
            bail!("A Seedelf's identifier token can't have a pool")
        }
        None if terms.box_lovelace == CLASSIC_LOVELACE => bail!(
            "An ADA pool of 10 ₳ a box would be a copy of the classic pool's value, which no wallet shows"
        ),
        _ => Ok(()),
    }
}

/// What a launch spending `seed` with `terms` makes, checked: its datum one
/// `one_shot_mint` takes and the wallet reads, its pool one the wallet
/// trusts, reading its scripts from the holder, and usable once its
/// credential is registered. `register`: whether to register `mix_logic`'s
/// credential (it isn't yet, by `account_info`).
fn made(chain: &Chain, seed: ([u8; 32], u64), terms: &Terms, register: bool) -> Result<Made> {
    let network_flag = chain.network_flag;
    let params = &chain.params;
    check_terms(terms, &chain.config.contract.seedelf_policy_id)?;
    let derived = templates::derive(&seed.0, seed.1)?;
    let datum = ReferenceDatum {
        box_value: BoxValue {
            lovelace: terms.box_lovelace,
            token: terms.token.clone(),
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
    let locked = Locked {
        reference: reference_lovelace,
        mix_box: mix_box_lovelace,
        mix_logic: mix_logic_lovelace,
        deposit: staking.deposit_at(params.key_deposit),
    };
    Ok(Made {
        derived,
        datum,
        policy,
        nft,
        outputs: [reference, mix_box, mix_logic],
        staking,
        locked,
        pool,
    })
}

/// The seed a launch spending `first` uses: that UTxO.
fn seed_of(first: &UtxoResponse) -> Result<([u8; 32], u64)> {
    let tx: [u8; 32] = hex::decode(&first.tx_hash)?
        .try_into()
        .map_err(|_| anyhow!("The seed's transaction hash isn't 32 bytes"))?;
    Ok((tx, first.tx_index))
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
    let first = inputs
        .first()
        .context("A launch spends at least one UTxO")?;
    if inputs
        .iter()
        .any(|u| u.asset_list.as_ref().is_some_and(|a| !a.is_empty()))
    {
        bail!("A launch spends Seedelf UTxOs that hold ADA alone");
    }
    let seed = seed_of(first)?;
    let made = made(chain, seed, terms, register)?;
    let [reference, mix_box, mix_logic] = made.outputs;
    let spend = ScriptSpend::new(chain, inputs, change_owner, signer)?
        .output(reference, &made.nft)?
        .output(mix_box, &Assets::new())?
        .output(mix_logic, &Assets::new())?
        .mint_inline(
            made.policy,
            made.derived.one_shot_mint.cbor.clone(),
            NFT_NAME.to_vec(),
            1,
            UNIT.to_vec(),
        )?
        .with_staking(made.staking)?
        .in_order();
    Ok(Launch {
        spend,
        seed,
        derived: made.derived,
        datum: made.datum,
        locked: made.locked,
        pool: made.pool,
    })
}

/// [`launch`] with the inputs picked from `available` (the wallet's Seedelf
/// UTxOs; those holding tokens are left out), keeping their `histories`
/// apart where a choice that pays does, as a stealth mint picks
/// ([`crate::build::mint_apart`]): whatever pays for a launch is tied to it
/// (pass [`crate::build::Purpose::Mint`]'s order). The first input picked is
/// the seed.
pub fn launch_apart(
    chain: &Chain,
    available: &[UtxoResponse],
    histories: &crate::build::Histories,
    terms: &Terms,
    register: bool,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<Launch> {
    let ada: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| u.asset_list.as_ref().is_none_or(|a| a.is_empty()))
        .cloned()
        .collect();
    crate::build::select_script_inputs(&ada, &Assets::new(), 0, histories, |inputs| {
        let built = launch(chain, inputs, terms, register, change_owner, signer)?;
        built.spend.estimate()?;
        Ok(built)
    })
}

/// The account's UTxOs can't pay for a launch.
const ACCOUNT_LAUNCH_SHORT: NotEnough = NotEnough(
    "There isn't enough ADA in the public account for this pool's launch, its fee and the change",
);

/// A launch paid by the public account, before its mint is measured:
/// measure and finish it with [`Self::measure_locally`], then check the
/// result with [`launched_pool`]. Its inputs' keys and its collateral's sign.
#[derive(Clone)]
pub struct AccountLaunch {
    chain: Chain,
    inputs: Vec<UtxoResponse>,
    collateral: UtxoResponse,
    outputs: Vec<Output>,
    policy: Hash<28>,
    one_shot: Vec<u8>,
    staking: Staking,
    change_addr: Address,
    invalid_hereafter: Option<u64>,
    pub seed: ([u8; 32], u64),
    pub derived: Derived,
    pub datum: ReferenceDatum,
    pub locked: Locked,
    /// The pool as it will be once on chain, as for [`Launch::pool`].
    pub pool: Protocol,
}

/// A finished account-paid launch: the unsigned transaction and what it does.
pub struct FinalAccountLaunch {
    /// Needs a signature from each input's key and the collateral's.
    pub tx: BuiltTransaction,
    pub fee: ScriptFee,
    /// Back to the public account.
    pub change_lovelace: u64,
    pub change_tokens: Assets,
    pub change_outputs: usize,
}

impl AccountLaunch {
    /// The UTxOs spent, the seed first.
    pub fn inputs(&self) -> &[UtxoResponse] {
        &self.inputs
    }

    /// The UTxO put up as collateral: only taken if the mint fails, which
    /// measuring it rules out.
    pub fn collateral(&self) -> &UtxoResponse {
        &self.collateral
    }

    /// How many payment keys sign: each distinct one among the inputs and
    /// the collateral. Registering a script's credential needs no key.
    fn signers(&self) -> usize {
        self.inputs
            .iter()
            .chain(std::iter::once(&self.collateral))
            .map(|u| u.payment_cred.as_str())
            .collect::<BTreeSet<_>>()
            .len()
    }

    fn patches(&self) -> Patches<'_> {
        Patches::staking(&self.staking)
    }

    /// Everything the inputs hold, less the three outputs, the stake deposit
    /// and the fee.
    fn change(&self, fee: u64) -> Result<(u64, Assets)> {
        let (total, tokens) = assets_of(self.inputs.clone())?;
        let lovelace = total
            .checked_sub(self.locked.outputs())
            .and_then(|rest| rest.checked_sub(self.locked.deposit))
            .and_then(|rest| rest.checked_sub(fee))
            .ok_or(ACCOUNT_LAUNCH_SHORT)?;
        Ok((lovelace, tokens))
    }

    fn stage(&self, fee: u64, budgets: Option<&Budgets>) -> Result<StagingTransaction> {
        let params = &self.chain.params;
        let (change_lovelace, change_tokens) = self.change(fee)?;
        let change = change_outputs(
            params,
            &self.change_addr,
            change_lovelace,
            &change_tokens,
            ACCOUNT_LAUNCH_SHORT,
        )?;
        // The collateral comes back, less 3/2 of the fee, to where it was,
        // with any tokens it holds.
        let collateral_addr = Address::from_bech32(&self.collateral.address)
            .map_err(|e| anyhow!("The collateral UTxO's address is invalid: {e}"))?;
        let (collateral_lovelace, collateral_tokens) = assets_of(vec![self.collateral.clone()])?;
        let collateral_back = collateral_lovelace.saturating_sub(fee * 3 / 2);
        if collateral_back
            < address_minimum_lovelace_with_assets(
                params,
                &self.collateral.address,
                collateral_tokens.clone(),
            )?
        {
            bail!("The public account's collateral is too small to put up for this launch");
        }
        let mut collateral_return = Output::new(collateral_addr, collateral_back);
        for asset in &collateral_tokens.items {
            collateral_return = collateral_return
                .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                .context("Failed To Add An Asset")?;
        }
        let budget = budgets.and_then(|b| b.mint(0)).unwrap_or(DRAFT_BUDGET);
        let mut tx = StagingTransaction::new();
        for utxo in &self.inputs {
            tx = tx.input(input_of(utxo)?);
        }
        // In order, the change last: one_shot_mint looks for the reference UTxO.
        for output in self.outputs.iter().cloned().chain(change) {
            tx = tx.output(output);
        }
        tx = expiring(tx, self.invalid_hereafter);
        Ok(tx
            .collateral_input(input_of(&self.collateral)?)
            .collateral_output(collateral_return)
            .fee(fee)
            .script(ScriptKind::PlutusV3, self.one_shot.clone())
            .mint_asset(self.policy, NFT_NAME.to_vec(), 1)
            .context("Failed To Mint The Pool's NFT")?
            .add_mint_redeemer(
                self.policy,
                UNIT.to_vec(),
                Some(ExUnits {
                    mem: budget.mem,
                    steps: budget.steps,
                }),
            )
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone()))
    }

    fn settle(&self, budgets: &Budgets) -> Result<FinalAccountLaunch> {
        let params = &self.chain.params;
        let budget = budgets
            .mint(0)
            .context("No budget was measured for the pool's one-shot mint")?;
        let compute = computation_fee(params, budget.mem, budget.steps);
        // Any reference script on an input (never the collateral's: the ledger
        // doesn't count it). The one-shot mint is in the witnesses, so its
        // bytes count in the size.
        let script_reference = reference_script_fee(params, reference_script_bytes(&self.inputs)?)?;
        let (fee, staged) = settle(
            self.signers(),
            self.patches(),
            |size| even(linear_fee(params, size) + compute + script_reference),
            |fee| self.stage(fee, Some(budgets)),
        )?;
        let (change_lovelace, change_tokens) = self.change(fee)?;
        let change_outputs = staged.outputs.as_ref().map_or(0, Vec::len) - self.outputs.len();
        Ok(FinalAccountLaunch {
            tx: built_with(staged, self.patches())?,
            fee: ScriptFee {
                size: fee - compute - script_reference,
                compute,
                script_reference,
                total: fee,
            },
            change_lovelace,
            change_tokens,
            change_outputs,
        })
    }

    /// Whether these inputs pay, with a guessed budget.
    fn estimate(&self) -> Result<FinalAccountLaunch> {
        self.settle(&Budgets::guess(&[], 1))
    }

    /// Measures the one-shot mint in the wallet ([`crate::eval`]) and
    /// finishes the launch: the draft, then the finished transaction
    /// measured again as it will be sent. Nothing goes to a node first.
    pub fn measure_locally(&self) -> Result<FinalAccountLaunch> {
        let known = self
            .inputs
            .iter()
            .map(eval::resolve_row)
            .collect::<Result<Vec<_>>>()?;
        let measure = |tx: &BuiltTransaction| -> Result<Budgets> {
            let answer = eval::evaluate(
                &tx.tx_bytes.0,
                &known,
                &self.chain.params.cost_model_v3,
                self.chain.network_flag,
            )?;
            Budgets::from_ogmios(&answer)
        };
        let fee = self.estimate()?.fee.total;
        let draft = built_with(self.stage(fee, None)?, self.patches())?;
        let budgets = measure(&draft)?;
        let finished = self.settle(&budgets)?;
        let again = measure(&finished.tx)?;
        if budgets.covers(&again) {
            return Ok(finished);
        }
        let finished = self.settle(&again.with_margin(1))?;
        if !again.with_margin(1).covers(&measure(&finished.tx)?) {
            bail!("The one-shot mint's budget did not settle");
        }
        Ok(finished)
    }
}

/// Builds the launch of a pool with `terms` paid by the public account, from
/// `available` (key addresses the caller can sign for), as an account-paid
/// mint picks ([`crate::build::account_mint`]): pure ADA first, largest
/// first, then token UTxOs, as few as pay for the launch, its fee and valid
/// change; the first input is the seed. `collateral` is the account's own,
/// set aside (never an input), or one of `available` is picked. The change,
/// tokens and all, goes to `change_addr`. `register` and `invalid_hereafter`
/// as for [`launch`] and [`crate::build::move_in`].
pub fn launch_from_account(
    chain: &Chain,
    available: &[UtxoResponse],
    collateral: Option<&UtxoResponse>,
    terms: &Terms,
    register: bool,
    change_addr: &Address,
    invalid_hereafter: Option<u64>,
) -> Result<AccountLaunch> {
    let spendable = account_inputs(available, collateral)?;
    let first = spendable
        .first()
        .context("There's nothing in the public account to pay for a launch")?;
    // Every choice of inputs starts with the same UTxO, so they all make the
    // same pool.
    let seed = seed_of(first)?;
    let made = made(chain, seed, terms, register)?;
    let mut last_error = None;
    for k in 1..=spendable.len() {
        let inputs = &spendable[..k];
        let Some(collateral) = account_collateral(available, inputs, collateral) else {
            bail!("There's nothing in the public account to put up as collateral");
        };
        let launch = AccountLaunch {
            chain: chain.clone(),
            inputs: inputs.to_vec(),
            collateral: collateral.clone(),
            outputs: made.outputs.to_vec(),
            policy: made.policy,
            one_shot: made.derived.one_shot_mint.cbor.clone(),
            staking: made.staking.clone(),
            change_addr: change_addr.clone(),
            invalid_hereafter,
            seed,
            derived: made.derived.clone(),
            datum: made.datum.clone(),
            locked: made.locked,
            pool: made.pool.clone(),
        };
        match launch.estimate() {
            Ok(_) => return Ok(launch),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => last_error = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or_else(|| ACCOUNT_LAUNCH_SHORT.into()))
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
