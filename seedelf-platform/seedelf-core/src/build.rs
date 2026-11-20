//! Network-free transaction building, shared by the CLI and the web wallet.
//!
//! Each builder takes chain data the caller has already fetched (protocol
//! parameters, and UTxOs as Koios returns them) and returns an unsigned
//! transaction. Callers make the network calls and sign: the CLI with its
//! file-stored key, the web wallet inside WebAssembly with its HD keys.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use anyhow::{Context, Result, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_crypto::key::ed25519::{PublicKey, SecretKey, Signature};
use pallas_primitives::{Fragment, NonEmptySet, conway};
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, ExUnits, Input, Output, ScriptKind, StagingTransaction,
};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse, extract_bytes_with_logging};
use serde_json::Value;

use crate::address::{collateral_address, is_on_correct_network, wallet_contract};
use crate::assets::{Asset, Assets};
use crate::constants::{
    COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO, OVERHEAD_COST,
};
use crate::data_structures::{create_mint_redeemer, create_spend_redeemer};
use crate::note::Note;
use crate::staking::Staking;
use crate::transaction::{
    address_minimum_lovelace_with_assets, checked_lovelace, collateral_input, computation_fee,
    decode_tx_hash, reference_utxo, seedelf_minimum_lovelace, seedelf_token_name,
    wallet_minimum_lovelace_with_assets,
};
use crate::utxos::{assets_of, fitting, reference_script_bytes, reference_script_size};

/// A throwaway ed25519 key, used to sign a draft so its size includes a
/// realistic witness. The signature is discarded.
pub fn fake_signer() -> PrivateKey {
    PrivateKey::from(SecretKey::new(OsRng))
}

/// The linear (size-based) fee for a transaction of `tx_size` bytes:
/// `min_fee_a × size + min_fee_b`, as the ledger charges it. (Pallas's
/// `fees::PolicyParams::default()` is Byron's policy, 43.946 lovelace a byte,
/// which falls a few dozen lovelace short on a Seedelf spend.)
pub fn linear_fee(params: &ProtocolParameters, tx_size: u64) -> u64 {
    params
        .min_fee_a
        .saturating_mul(tx_size)
        .saturating_add(params.min_fee_b)
}

/// The most reference-script bytes one transaction may use, over its spent
/// and reference inputs together: the ledger's `maxRefScriptSizePerTx`,
/// 200 KiB.
pub const MAX_REFERENCE_SCRIPT_BYTES: u64 = 204_800;

/// How many bytes of reference script each of Conway's price tiers holds.
const REFERENCE_SCRIPT_TIER: u64 = 25_600;

/// Conway's fee for `bytes` of reference scripts, which the ledger adds for
/// every script on a spent or reference input: the first 25,600 bytes at
/// `min_fee_ref_script_cost_per_byte`, each next 25,600 at 1.2 times the
/// price of the ones before, and the total rounded down (the ledger's
/// `tierRefScriptFee`, in exact fractions as it works). More than
/// [`MAX_REFERENCE_SCRIPT_BYTES`] is refused, in words, as the ledger would.
pub fn reference_script_fee(params: &ProtocolParameters, bytes: u64) -> Result<u64> {
    if bytes > MAX_REFERENCE_SCRIPT_BYTES {
        bail!(
            "This transaction would use {bytes} bytes of reference scripts, over the network's limit of {MAX_REFERENCE_SCRIPT_BYTES}. Spend fewer UTxOs holding one at once"
        );
    }
    let price = params.min_fee_ref_script_cost_per_byte;
    if price.denominator == 0 {
        bail!("The network's reference script price isn't a number");
    }
    // Tier k costs price × (6/5)^k a byte. Over the common denominator
    // 5^tiers, each full tier adds TIER × 6^k × 5^(tiers−k), and the bytes
    // past the last full tier add rest × 6^tiers. With at most 8 tiers, every
    // step fits a u128.
    let tiers = (bytes / REFERENCE_SCRIPT_TIER) as u32;
    let rest = u128::from(bytes % REFERENCE_SCRIPT_TIER);
    let tier = u128::from(REFERENCE_SCRIPT_TIER);
    let scaled: u128 = (0..tiers)
        .map(|k| tier * 6u128.pow(k) * 5u128.pow(tiers - k))
        .sum::<u128>()
        + rest * 6u128.pow(tiers);
    let fee =
        scaled * u128::from(price.numerator) / (u128::from(price.denominator) * 5u128.pow(tiers));
    u64::try_from(fee).context("The reference scripts' fee doesn't fit a number")
}

/// The most a transaction the wallet builds may pay in fees. Real ones pay
/// under 1 ₳, and even a 16 KiB transaction running scripts to the ledger's
/// limit pays about 2.6 ₳. More comes from wrong protocol parameters, and the
/// ledger would take it all.
pub const MAX_FEE: u64 = 10_000_000;

/// Refuses a fee over [`MAX_FEE`], in words.
pub fn check_fee(fee: u64) -> Result<()> {
    if fee > MAX_FEE {
        bail!(
            "This transaction's fee would be {} ADA, over the wallet's limit of {} ADA, so it wasn't built. The network's fee settings look wrong: try again later",
            ada(fee),
            ada(MAX_FEE)
        );
    }
    Ok(())
}

/// Settles the size fee of a key-signed transaction. `build(fee)` stages the
/// transaction for a given fee; each draft is signed with `signers` throwaway
/// keys and priced, until the fee covers the transaction it produces.
/// Returns the fee and the transaction staged with it.
pub fn settle_fee(
    params: &ProtocolParameters,
    signers: usize,
    build: impl FnMut(u64) -> Result<StagingTransaction>,
) -> Result<(u64, StagingTransaction)> {
    settle(
        signers,
        Patches::staking(&Staking::none()),
        |size| linear_fee(params, size),
        build,
    )
}

/// The largest transaction the ledger takes, signed: `max_tx_size`, 16 KiB on
/// mainnet and preprod. A bigger one is refused at submit.
pub const MAX_TX_SIZE: u64 = 16_384;

/// The most bytes one output's value (its ADA and tokens) may take: the
/// ledger's `max_val_size`, 5,000 on mainnet and preprod. An output holding
/// more is refused at submit, however small the transaction.
pub const MAX_VALUE_SIZE: u64 = 5_000;

/// A transaction, or one of its outputs, larger than the ledger takes
/// ([`MAX_TX_SIZE`], [`MAX_VALUE_SIZE`]): fewer UTxOs or tokens at once might
/// go, so a payment can go as several transactions ([`is_too_large`]).
#[derive(Debug, Clone, Copy)]
pub enum TooLarge {
    /// The signed transaction's size.
    Transaction(u64),
    /// The largest output's value's size.
    Output(u64),
}

impl TooLarge {
    /// How many UTxOs of `k` would fit, read off how far over its limit this
    /// is: fewer than `k`, and at least one.
    pub fn fewer(&self, k: usize) -> usize {
        let (size, limit) = match *self {
            TooLarge::Transaction(size) => (size, MAX_TX_SIZE),
            TooLarge::Output(size) => (size, MAX_VALUE_SIZE),
        };
        let fit = (k as u64).saturating_mul(limit) / size.max(1);
        (fit as usize).clamp(1, k.saturating_sub(1).max(1))
    }
}

impl fmt::Display for TooLarge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TooLarge::Transaction(size) => write!(
                f,
                "This transaction would be {size} bytes, over the network's limit of {MAX_TX_SIZE}. Send fewer tokens, or pay fewer recipients, at once"
            ),
            TooLarge::Output(size) => write!(
                f,
                "One output would hold {size} bytes of tokens, over the network's limit of {MAX_VALUE_SIZE}. Send fewer tokens at once"
            ),
        }
    }
}

impl std::error::Error for TooLarge {}

/// Whether `e` is [`TooLarge`]: a transaction or an output bigger than the
/// ledger takes.
pub fn is_too_large(e: &anyhow::Error) -> bool {
    e.downcast_ref::<TooLarge>().is_some()
}

/// The CBOR size of a whole number, or of the head of a byte string or map
/// that long.
fn head_size(n: u64) -> u64 {
    match n {
        0..=23 => 1,
        24..=0xff => 2,
        0x100..=0xffff => 3,
        0x1_0000..=0xffff_ffff => 5,
        _ => 9,
    }
}

/// The size of `output`'s value as the ledger measures it against
/// [`MAX_VALUE_SIZE`]: its CBOR, the lovelace alone, or `[lovelace,
/// {policy: {name: amount}}]`.
pub fn value_size(output: &Output) -> u64 {
    let Some(assets) = output.assets.as_ref().filter(|a| !a.is_empty()) else {
        return head_size(output.lovelace);
    };
    let mut size = 1 + head_size(output.lovelace) + head_size(assets.len() as u64);
    for names in assets.values() {
        size += head_size(28) + 28 + head_size(names.len() as u64);
        for (name, amount) in names {
            let length = name.0.len() as u64;
            size += head_size(length) + length + head_size(*amount);
        }
    }
    size
}

/// What's patched into a built transaction, since Pallas can stage neither:
/// staking (certificates, a withdrawal; see [`Staking::patch`]) and a note
/// ([`Note::patch`]).
#[derive(Clone, Copy)]
pub(crate) struct Patches<'a> {
    staking: &'a Staking,
    note: Option<&'a Note>,
}

impl<'a> Patches<'a> {
    /// Only `staking`: every transaction but a send with a note.
    pub(crate) fn staking(staking: &'a Staking) -> Self {
        Patches {
            staking,
            note: None,
        }
    }

    fn apply(&self, built: BuiltTransaction) -> Result<BuiltTransaction> {
        let built = self.staking.patch(built)?;
        match self.note {
            Some(note) => note.patch(built),
            None => Ok(built),
        }
    }
}

/// The fee [`settle`] drafts a transaction at first, before it's priced: what
/// it pays out must leave each output its least after this too.
pub(crate) const FIRST_DRAFT_FEE: u64 = 200_000;

/// [`settle_fee`] with any pricing: `price(size)` is the fee a transaction of
/// `size` signed bytes needs. `patches` go into each draft before it's
/// priced; `signers` doesn't count the stake key a staking patch needs.
/// A draft over [`MAX_TX_SIZE`], one with an output over [`MAX_VALUE_SIZE`]
/// ([`TooLarge`]), or a fee over [`MAX_FEE`], is refused here, in words.
pub(crate) fn settle(
    signers: usize,
    patches: Patches,
    price: impl Fn(u64) -> u64,
    mut build: impl FnMut(u64) -> Result<StagingTransaction>,
) -> Result<(u64, StagingTransaction)> {
    let mut fee: u64 = FIRST_DRAFT_FEE;
    for _ in 0..5 {
        let staged = build(fee)?;
        let largest = staged
            .outputs
            .iter()
            .flatten()
            .map(value_size)
            .max()
            .unwrap_or(0);
        if largest > MAX_VALUE_SIZE {
            return Err(TooLarge::Output(largest).into());
        }
        let size = signed_size(&staged, signers, patches)?;
        if size > MAX_TX_SIZE {
            return Err(TooLarge::Transaction(size).into());
        }
        let needed = price(size);
        check_fee(needed)?;
        if needed <= fee && fee - needed < 1_000 {
            return Ok((fee, staged));
        }
        // Too low, or far above what's needed (the first guess): price again.
        fee = needed;
    }
    bail!("The transaction fee did not settle")
}

fn signed_size(staged: &StagingTransaction, signers: usize, patches: Patches) -> Result<u64> {
    let mut built = built_with(staged.clone(), patches)?;
    for _ in 0..signers.max(1) + patches.staking.signers() {
        built = built
            .sign(fake_signer())
            .context("Failed To Sign The Draft Transaction")?;
    }
    Ok(built.tx_bytes.0.len() as u64)
}

/// Builds a staged transaction, then patches `patches` into it.
pub(crate) fn built_with(staged: StagingTransaction, patches: Patches) -> Result<BuiltTransaction> {
    patches.apply(
        staged
            .build_conway_raw()
            .context("Failed To Build The Transaction")?,
    )
}

/// `tx`, valid until slot `invalid_hereafter` when one is given: the ledger
/// refuses it from that slot on, so one that never landed can't land later.
/// Staged, not patched, so every draft is priced with it and the staking and
/// note patches hash a body that holds it.
pub(crate) fn expiring(
    tx: StagingTransaction,
    invalid_hereafter: Option<u64>,
) -> StagingTransaction {
    match invalid_hereafter {
        Some(slot) => tx.invalid_from_slot(slot),
        None => tx,
    }
}

/// The transaction input for a Koios UTxO.
pub fn input_of(utxo: &UtxoResponse) -> Result<Input> {
    Ok(Input::new(
        Hash::new(decode_tx_hash(&utxo.tx_hash)?),
        utxo.tx_index,
    ))
}

/// A wallet-contract output holding `lovelace` and `tokens` under a fresh
/// re-randomization of `owner` (the same `d` on both points).
fn deposit_output(
    wallet_addr: &Address,
    owner: &Register,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Output> {
    let datum: Vec<u8> = owner
        .clone()
        .rerandomize()
        .context("Failed To Randomize Points")?
        .to_vec()?;
    let mut output = Output::new(wallet_addr.clone(), lovelace).set_inline_datum(datum);
    for asset in &tokens.items {
        output = output
            .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
            .context("Failed To Add An Asset")?;
    }
    Ok(output)
}

/// The tokens of each output a payment, deposit or change of `tokens` goes
/// out in: `MAXIMUM_TOKENS_PER_UTXO` to an output, so none holds more than the
/// ledger takes ([`MAX_VALUE_SIZE`]); one of ADA alone when there are none.
fn token_chunks(tokens: &Assets) -> Vec<Assets> {
    if tokens.items.is_empty() {
        vec![Assets::new()]
    } else {
        tokens.split(MAXIMUM_TOKENS_PER_UTXO as usize)
    }
}

/// Outputs that deposit `lovelace` and `tokens` into the wallet contract,
/// each under a fresh re-randomization of `owner`. Tokens go
/// `MAXIMUM_TOKENS_PER_UTXO` to an output; every output but the last carries
/// its minimum, and the last carries the rest.
pub fn deposit_outputs(
    params: &ProtocolParameters,
    wallet_addr: &Address,
    owner: &Register,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Vec<Output>> {
    let chunks = token_chunks(tokens);
    let last = chunks.len() - 1;
    let mut remaining = lovelace;
    let mut outputs = Vec::with_capacity(chunks.len());
    for (i, chunk) in chunks.iter().enumerate() {
        let minimum = wallet_minimum_lovelace_with_assets(params, chunk.clone())?;
        let amount = if i == last { remaining } else { minimum };
        if amount < minimum || remaining < amount {
            bail!(TooLittle {
                what: "Seedelf",
                needed: minimum_deposit(params, tokens)?,
            });
        }
        remaining -= amount;
        outputs.push(deposit_output(wallet_addr, owner, amount, chunk)?);
    }
    Ok(outputs)
}

/// [`deposit_outputs`], each output with the tokens it holds: a payment to the
/// Seedelf under `owner`.
fn seedelf_payment(
    params: &ProtocolParameters,
    wallet_addr: &Address,
    owner: &Register,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Vec<(Output, Assets)>> {
    let outputs = deposit_outputs(params, wallet_addr, owner, lovelace, tokens)?;
    Ok(outputs.into_iter().zip(token_chunks(tokens)).collect())
}

/// The least lovelace a deposit of `tokens` needs: the sum of each deposit
/// output's minimum.
pub fn minimum_deposit(params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
    token_chunks(tokens)
        .into_iter()
        .map(|chunk| wallet_minimum_lovelace_with_assets(params, chunk))
        .sum()
}

/// What `utxo` adds to a spend from the Seedelf balance: its ADA less the
/// least its own tokens need back there as change ([`minimum_deposit`], 20 to
/// an output), with its sign. A stranger's pile of tokens at their least on
/// chain needs more than it holds: it adds less than nothing, so selection
/// takes it after everything else (chunk 51, r2a#3), as a session's return
/// leaves such a UTxO behind (`plan_return`, independent review H1). An error
/// where its value can't be read.
pub fn adds(params: &ProtocolParameters, utxo: &UtxoResponse) -> Result<i128> {
    let (lovelace, tokens) = crate::utxos::assets_of(vec![utxo.clone()])?;
    if tokens.is_empty() {
        return Ok(i128::from(lovelace));
    }
    Ok(i128::from(lovelace) - i128::from(minimum_deposit(params, &tokens)?))
}

/// Change outputs to `change_addr`, with no datum: `tokens` split
/// `MAXIMUM_TOKENS_PER_UTXO` to an output, the last output carrying the rest
/// of `lovelace`. No output at all when there's nothing to return. `short` is
/// the error when the lovelace can't carry the tokens.
pub(crate) fn change_outputs(
    params: &ProtocolParameters,
    change_addr: &Address,
    lovelace: u64,
    tokens: &Assets,
    short: NotEnough,
) -> Result<Vec<Output>> {
    if lovelace == 0 && tokens.items.is_empty() {
        return Ok(Vec::new());
    }
    let bech32 = change_addr
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode the change address: {e}"))?;
    let chunks: Vec<Assets> = if tokens.items.is_empty() {
        vec![Assets::new()]
    } else {
        tokens.split(MAXIMUM_TOKENS_PER_UTXO as usize)
    };
    let last = chunks.len() - 1;
    let mut remaining = lovelace;
    let mut outputs = Vec::with_capacity(chunks.len());
    for (i, chunk) in chunks.iter().enumerate() {
        let minimum = address_minimum_lovelace_with_assets(params, &bech32, chunk.clone())?;
        let amount = if i == last { remaining } else { minimum };
        if amount < minimum || remaining < amount {
            bail!(short);
        }
        remaining -= amount;
        let mut output = Output::new(change_addr.clone(), amount);
        for asset in &chunk.items {
            output = output
                .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                .context("Failed To Add An Asset")?;
        }
        outputs.push(output);
    }
    Ok(outputs)
}

/// The least lovelace change outputs holding `tokens` need.
pub(crate) fn minimum_change(
    params: &ProtocolParameters,
    change_addr: &Address,
    tokens: &Assets,
) -> Result<u64> {
    if tokens.items.is_empty() {
        return Ok(0);
    }
    let bech32 = change_addr
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode the change address: {e}"))?;
    tokens
        .split(MAXIMUM_TOKENS_PER_UTXO as usize)
        .into_iter()
        .map(|chunk| address_minimum_lovelace_with_assets(params, &bech32, chunk))
        .sum()
}

/// The chosen inputs can't pay for the transaction; more inputs might.
#[derive(Debug, Clone, Copy)]
pub(crate) struct NotEnough(pub(crate) &'static str);

/// A move-in's inputs can't pay for it.
const MOVE_IN_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Cardano account for this move, its fee and the change");

/// An account payment's inputs can't pay for it.
const SEND_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Cardano account for this payment, its fee and the change");

/// A staking transaction's inputs can't pay for it.
const STAKE_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Cardano account for this, its fee and the change");

/// An account-paid mint's inputs can't pay for it.
const ACCOUNT_MINT_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Cardano account for the Seedelf, its fee and the change");

/// A script spend's inputs can't pay for it.
const SEEDELF_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Seedelf balance for this, its fee and the change");

impl fmt::Display for NotEnough {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for NotEnough {}

/// The inputs together need more computation than a transaction may use
/// ([`MAX_TX_BUDGET`]): fewer at once might go, so a payment can go as
/// several transactions, each spending its own ([`is_too_many`]).
#[derive(Debug, Clone, Copy)]
pub struct TooMany(pub usize);

impl fmt::Display for TooMany {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Spending {} UTxOs at once needs more computation than a transaction may use",
            self.0
        )
    }
}

impl std::error::Error for TooMany {}

/// Whether `e` is [`TooMany`]: more UTxOs than one transaction can spend.
pub fn is_too_many(e: &anyhow::Error) -> bool {
    e.downcast_ref::<TooMany>().is_some()
}

/// An account's collateral that can't cover 3/2 of the fee its transaction
/// sends and come back as an output holding an output's least, which the
/// ledger refuses ([`is_collateral_short`]). A larger collateral may carry
/// it, or a transaction running no script, which puts up none.
#[derive(Debug, Clone, Copy)]
pub struct CollateralShort(pub &'static str);

impl fmt::Display for CollateralShort {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

impl std::error::Error for CollateralShort {}

/// Whether `e` is [`CollateralShort`]: the account's collateral can't carry
/// the fee its transaction sends.
pub fn is_collateral_short(e: &anyhow::Error) -> bool {
    e.downcast_ref::<CollateralShort>().is_some()
}

/// A Seedelf spend's account collateral ([`ScriptSpend::with_account`]).
const SPEND_COLLATERAL_SHORT: CollateralShort =
    CollateralShort("The collateral can't cover this transaction's fee and come back as an output");

/// An account-paid mint's ([`account_mint`]).
const MINT_COLLATERAL_SHORT: CollateralShort =
    CollateralShort("The Cardano account's UTxOs are too small to put up as collateral");

/// What a collateral of `lovelace` at `address`, holding `tokens`, gives
/// back when its transaction sends `fee`: 3/2 of the fee stays, and what comes
/// back is an output, held to an output's least; `short` when it can't. Only
/// for the fee that's sent: a draft's and an estimate's are guesses, priced on
/// budget guesses about 1.3× what the scripts use, and held to them the least
/// refused collaterals the ledger takes (chunk 51, r2money#2). A draft stages
/// its return saturating instead: it's only measured, never sent.
pub(crate) fn collateral_back(
    params: &ProtocolParameters,
    address: &str,
    lovelace: u64,
    tokens: Assets,
    fee: u64,
    short: CollateralShort,
) -> Result<u64> {
    let least = address_minimum_lovelace_with_assets(params, address, tokens)?;
    lovelace
        .checked_sub(fee * 3 / 2)
        .filter(|back| *back >= least)
        .ok_or_else(|| short.into())
}

/// The amount asked for is below what the outputs must carry.
#[derive(Debug)]
struct TooLittle {
    what: &'static str,
    needed: u64,
}

impl fmt::Display for TooLittle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "A {} deposit of these tokens needs at least {} ADA",
            self.what,
            ada(self.needed)
        )
    }
}

impl std::error::Error for TooLittle {}

/// `external sweep`: every UTxO at the CLI's dApp address back into the
/// wallet contract, under fresh re-randomizations of `owner`. `signer` is the
/// dApp key's hash, disclosed as a required signer. The fee pays for any
/// reference script they hold. Returns the unsigned transaction and its fee.
pub fn external_sweep(
    params: &ProtocolParameters,
    utxos: &[UtxoResponse],
    owner: &Register,
    wallet_addr: &Address,
    signer: Hash<28>,
) -> Result<(BuiltTransaction, u64)> {
    if utxos.is_empty() {
        bail!("Not Enough Lovelace/Tokens");
    }
    let (total, tokens) = assets_of(utxos.to_vec())?;
    let inputs: Vec<Input> = utxos.iter().map(input_of).collect::<Result<_>>()?;
    // Conway charges for a reference script on a spent input too.
    let script_fee = reference_script_fee(params, reference_script_bytes(utxos)?)?;
    let price = |size| linear_fee(params, size).saturating_add(script_fee);
    let (fee, staged) = settle(1, Patches::staking(&Staking::none()), price, |fee| {
        let lovelace = checked_lovelace(total, &[fee])?;
        let mut tx = StagingTransaction::new();
        for input in &inputs {
            tx = tx.input(input.clone());
        }
        for output in deposit_outputs(params, wallet_addr, owner, lovelace, &tokens)? {
            tx = tx.output(output);
        }
        Ok(tx.fee(fee).disclosed_signer(signer))
    })?;
    let tx = staged
        .build_conway_raw()
        .context("Failed To Build The Transaction")?;
    Ok((tx, fee))
}

/// How much ADA the Cardano account pays, into Seedelf or to an address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountAmount {
    Lovelace(u64),
    /// Everything that can go: all ADA but the fee and the minimum the
    /// change needs to carry the tokens that stay.
    Max,
}

/// Where the Cardano account pays.
#[derive(Clone, Copy)]
pub enum Payee<'a> {
    /// Into the wallet contract, under fresh re-randomizations of `owner`:
    /// the user's base register (a move-in), or the register of the contract
    /// UTxO holding someone's seedelf, which must be [`is_payable`]: only its
    /// owner can spend the payment, and nothing on chain ties it to their
    /// seedelf. Tokens go `MAXIMUM_TOKENS_PER_UTXO` to an output.
    Seedelf {
        owner: &'a Register,
        wallet_addr: &'a Address,
    },
    /// An address on this network ([`is_payable_address`]). Tokens go
    /// `MAXIMUM_TOKENS_PER_UTXO` to an output.
    Address(&'a Address),
    /// No one: the transaction only does something with the stake key
    /// (certificates, a withdrawal), and everything comes back as change.
    Nobody,
}

impl Payee<'_> {
    /// The least lovelace a payment of `tokens` here must carry.
    pub fn minimum(&self, params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
        match self {
            Payee::Seedelf { .. } => minimum_deposit(params, tokens),
            Payee::Address(to) => minimum_address_payment(params, to, tokens),
            Payee::Nobody => Ok(0),
        }
    }

    fn outputs(
        &self,
        params: &ProtocolParameters,
        lovelace: u64,
        tokens: &Assets,
    ) -> Result<Vec<Output>> {
        match self {
            Payee::Seedelf { owner, wallet_addr } => {
                deposit_outputs(params, wallet_addr, owner, lovelace, tokens)
            }
            Payee::Address(to) => Ok(pay_address(params, to, lovelace, tokens)?
                .into_iter()
                .map(|(output, _)| output)
                .collect()),
            Payee::Nobody if lovelace == 0 && tokens.items.is_empty() => Ok(Vec::new()),
            Payee::Nobody => bail!("A transaction that pays no one pays nothing"),
        }
    }
}

/// One recipient of a payment from the Cardano account: where it goes, how
/// much ADA, and which tokens, as `(policy, name, quantity)` in hex.
#[derive(Clone)]
pub struct AccountPay<'a> {
    pub payee: Payee<'a>,
    pub amount: AccountAmount,
    pub picked: Vec<(String, String, u64)>,
}

impl<'a> AccountPay<'a> {
    pub fn new(payee: Payee<'a>, amount: AccountAmount, picked: &[(String, String, u64)]) -> Self {
        AccountPay {
            payee,
            amount,
            picked: picked.to_vec(),
        }
    }
}

/// A built payment from the Cardano account (a move-in, a send, or a staking
/// transaction): the unsigned transaction and what it does.
pub struct AccountPayment {
    /// With its staking patched in: needs the stake key's signature too when
    /// there was any.
    pub tx: BuiltTransaction,
    /// The spent UTxOs, in input order; each needs its payment key's signature.
    pub inputs: Vec<UtxoResponse>,
    pub fee: u64,
    /// Lovelace and tokens paid, all recipients together.
    pub lovelace: u64,
    pub tokens: Assets,
    /// The lovelace each recipient got, in order.
    pub paid: Vec<u64>,
    /// How many outputs hold them.
    pub outputs: usize,
    /// What goes back to the Cardano account.
    pub change_lovelace: u64,
    pub change_tokens: Assets,
    /// What Max couldn't spend with the rest, in the order given: see
    /// [`fitting`] and [`reference_script_size`]. Empty for an amount.
    pub left_out: Vec<UtxoResponse>,
}

/// Move-in: the Cardano account pays into the wallet contract under fresh
/// re-randomizations of `owner`, the user's base register. No script runs.
///
/// - `available` is what may be spent: key addresses the caller can sign
///   for. Every one of them can be; the caller leaves out what it keeps (the
///   web wallet's collateral and the UTxOs its user locked).
/// - `picked` tokens go in the quantities asked, as `(policy, name,
///   quantity)` in hex. Every UTxO holding one is spent, and what's left of
///   it goes back with the change.
/// - Otherwise pure-ADA UTxOs are spent first, largest first, then other
///   token UTxOs, until the amount, the fee and valid change are covered.
///   Tokens that aren't picked go back with the change.
/// - A UTxO whose tokens would push a total past what one output holds is
///   never spent with the rest ([`fitting`]), nor is one holding a reference
///   script that can't be measured ([`reference_script_size`]); Max says
///   which it left out. The fee pays for every spent input's reference
///   script, as Conway charges.
/// - Change goes to `change_addr`. There is no change output when nothing is left.
/// - `staking` rides along: a reward withdrawal adds to what pays
///   ([`Staking::withdraw`]), and it's patched into the transaction.
/// - `invalid_hereafter` is the slot the transaction stops being valid at
///   ([`crate::eval::slot_at`] gives one from the time): past it, one that
///   never landed can't land any more, so a payment made again can't pay
///   twice. `None` leaves it valid for as long as its inputs are unspent.
#[allow(clippy::too_many_arguments)]
pub fn move_in(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    amount: AccountAmount,
    picked: &[(String, String, u64)],
    owner: &Register,
    wallet_addr: &Address,
    change_addr: &Address,
    staking: &Staking,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    let payee = Payee::Seedelf { owner, wallet_addr };
    account_payment(
        params,
        available,
        &[AccountPay::new(payee, amount, picked)],
        Patches::staking(staking),
        change_addr,
        MOVE_IN_SHORT,
        invalid_hereafter,
    )
}

/// Send: the Cardano account pays `to`, an address on this network
/// ([`is_payable_address`]; `network_flag`: `true` is preprod), its tokens
/// `MAXIMUM_TOKENS_PER_UTXO` to an output ([`Payee::Address`]). The UTxOs
/// are chosen, the change made, and `staking` and `invalid_hereafter`
/// carried, as for [`move_in`].
#[allow(clippy::too_many_arguments)]
pub fn account_send(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    amount: AccountAmount,
    picked: &[(String, String, u64)],
    to: &Address,
    network_flag: bool,
    change_addr: &Address,
    staking: &Staking,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    let payee = Payee::Address(to);
    account_send_many(
        params,
        available,
        &[AccountPay::new(payee, amount, picked)],
        network_flag,
        change_addr,
        staking,
        None,
        invalid_hereafter,
    )
}

/// Send to several: the Cardano account pays each of `recipients`, in the
/// order given, then the change. Each is an address on this network
/// ([`is_payable_address`]) or a Seedelf (see [`Payee::Seedelf`]), with its
/// own amount and tokens. Max pays a
/// single recipient. The UTxOs are chosen, the change made, and `staking`
/// and `invalid_hereafter` carried, as for [`move_in`]. A `note` goes on the
/// transaction as CIP-20's message, which anyone can read; the fee pays for
/// its bytes.
#[allow(clippy::too_many_arguments)]
pub fn account_send_many(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    recipients: &[AccountPay],
    network_flag: bool,
    change_addr: &Address,
    staking: &Staking,
    note: Option<&Note>,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    if recipients.is_empty() {
        bail!("A payment needs someone to pay");
    }
    for pay in recipients {
        match pay.payee {
            Payee::Address(to) => check_payable(to, network_flag)?,
            Payee::Seedelf { owner, .. } => check_register(owner)?,
            Payee::Nobody => bail!("A payment needs someone to pay"),
        }
    }
    account_payment(
        params,
        available,
        recipients,
        Patches { staking, note },
        change_addr,
        SEND_SHORT,
        invalid_hereafter,
    )
}

/// Refuses a register a payment would be lost under ([`is_payable`]).
fn check_register(register: &Register) -> Result<()> {
    if !is_payable(register) {
        bail!(
            "That Seedelf's register isn't valid: a payment to it could be locked for good, or taken by anyone"
        );
    }
    Ok(())
}

/// A staking transaction from the Cardano account: `staking`'s certificates
/// and withdrawal, and nothing paid to anyone. The inputs pay the fee and any
/// deposit, and everything else comes back to `change_addr`; UTxOs are
/// chosen as for [`move_in`], as few as pay. A withdrawal or a refund counts
/// towards the fee, but a transaction always spends at least one UTxO.
/// `invalid_hereafter` is as for [`move_in`].
pub fn account_staking(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    staking: &Staking,
    change_addr: &Address,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    if staking.is_empty() {
        bail!("A staking transaction needs a certificate, a withdrawal or a vote");
    }
    account_payment(
        params,
        available,
        &[AccountPay::new(
            Payee::Nobody,
            AccountAmount::Lovelace(0),
            &[],
        )],
        Patches::staking(staking),
        change_addr,
        STAKE_SHORT,
        invalid_hereafter,
    )
}

fn account_payment(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    pays: &[AccountPay],
    patches: Patches,
    change_addr: &Address,
    short: NotEnough,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    let max = pays.iter().any(|p| p.amount == AccountAmount::Max);
    if max && pays.len() > 1 {
        bail!("Max pays a single recipient: give each of several an amount");
    }
    // Every recipient's tokens together: what the inputs must hold.
    let mut picked: BTreeMap<(&str, &str), u64> = BTreeMap::new();
    for (policy, name, quantity) in pays.iter().flat_map(|p| &p.picked) {
        if *quantity == 0 {
            bail!("Choose more than none of the token {policy}.{name}, or leave it out");
        }
        let total = picked.entry((policy, name)).or_default();
        *total = total.saturating_add(*quantity);
    }
    let holds_picked = |u: &UtxoResponse| {
        u.asset_list.as_ref().is_some_and(|assets| {
            assets
                .iter()
                .any(|a| picked.contains_key(&(a.policy_id.as_str(), a.asset_name.as_str())))
        })
    };
    // A UTxO holding a reference script that can't be measured can't be
    // priced, so it's never spent. Of the rest, what one transaction can hold
    // together, the UTxOs with picked tokens first.
    let priced: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| reference_script_size(u).is_ok())
        .cloned()
        .collect();
    let (eligible, _) = fitting(&priced, &Assets::new(), holds_picked)?;
    let left_out: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| !eligible.iter().any(|e| same_utxo(e, u)))
        .cloned()
        .collect();
    for ((policy, name), quantity) in &picked {
        let held: u64 = eligible
            .iter()
            .flat_map(|u| u.asset_list.iter().flatten())
            .filter(|a| a.policy_id == *policy && a.asset_name == *name)
            .map(|a| a.quantity.parse::<u64>().unwrap_or(0))
            .sum();
        if held == 0 {
            bail!("The Cardano account doesn't hold the token {policy}.{name}");
        }
        if *quantity > held {
            bail!("The Cardano account holds only {held} of the token {policy}.{name}");
        }
    }

    let (mandatory, mut rest): (Vec<UtxoResponse>, Vec<UtxoResponse>) =
        eligible.into_iter().partition(|u| holds_picked(u));
    // Pure ADA first, then token UTxOs; within each, those holding a
    // reference script (which costs more to spend) after the rest, and the
    // largest first.
    rest.sort_by_key(|u| {
        let tokens = u.asset_list.as_ref().is_some_and(|a| !a.is_empty());
        let lovelace = u.value.parse::<u64>().unwrap_or(0);
        (
            tokens,
            u.reference_script.is_some(),
            std::cmp::Reverse(lovelace),
        )
    });

    let attempt = |selected: &[UtxoResponse]| {
        build_account_payment(
            params,
            selected,
            pays,
            patches,
            change_addr,
            short,
            invalid_hereafter,
        )
    };

    if max {
        let all: Vec<UtxoResponse> = mandatory.into_iter().chain(rest).collect();
        if all.is_empty() {
            bail!("There is nothing in the Cardano account to spend");
        }
        let mut built = attempt(&all)?;
        built.left_out = left_out;
        return Ok(built);
    }

    let mut last_error = None;
    for k in 0..=rest.len() {
        let selected: Vec<UtxoResponse> = mandatory
            .iter()
            .chain(rest.iter().take(k))
            .cloned()
            .collect();
        if selected.is_empty() {
            continue;
        }
        match attempt(&selected) {
            Ok(built) => return Ok(built),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => last_error = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or_else(|| short.into()))
}

fn build_account_payment(
    params: &ProtocolParameters,
    selected: &[UtxoResponse],
    pays: &[AccountPay],
    patches: Patches,
    change_addr: &Address,
    short: NotEnough,
    invalid_hereafter: Option<u64>,
) -> Result<AccountPayment> {
    let (inputs_total, all_tokens) = assets_of(selected.to_vec())?;
    // What pays: the inputs, plus rewards and a refund, less a deposit.
    let total = patches.staking.net(inputs_total).ok_or(short)?;
    // How much of a held token `picked` asks for (0 for tokens not picked).
    let asked_in = |picked: &[(String, String, u64)], a: &Asset| -> u64 {
        let policy = hex::encode(a.policy_id);
        let name = hex::encode(&a.token_name);
        picked
            .iter()
            .filter(|(p, n, _)| *p == policy && *n == name)
            .map(|(_, _, q)| *q)
            .fold(0u64, u64::saturating_add)
    };
    let tokens_for = |picked: &[(String, String, u64)]| Assets {
        items: all_tokens
            .items
            .iter()
            .filter(|a| asked_in(picked, a) > 0)
            .map(|a| Asset {
                amount: asked_in(picked, a).min(a.amount),
                ..a.clone()
            })
            .collect(),
    };
    let each_tokens: Vec<Assets> = pays.iter().map(|p| tokens_for(&p.picked)).collect();
    let all_picked: Vec<(String, String, u64)> =
        pays.iter().flat_map(|p| p.picked.iter().cloned()).collect();
    let asked = |a: &Asset| asked_in(&all_picked, a).min(a.amount);
    let paying = tokens_for(&all_picked);
    let staying = Assets {
        items: all_tokens
            .items
            .iter()
            .filter(|a| a.amount > asked(a))
            .map(|a| Asset {
                amount: a.amount - asked(a),
                ..a.clone()
            })
            .collect(),
    };
    let inputs: Vec<Input> = selected.iter().map(input_of).collect::<Result<_>>()?;
    let signers = selected
        .iter()
        .map(|u| u.payment_cred.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let change_floor = minimum_change(params, change_addr, &staying)?;
    // Conway charges for a reference script on a spent input too.
    let script_fee = reference_script_fee(params, reference_script_bytes(selected)?)?;

    let mut paid: Vec<u64> = Vec::new();
    let mut change = 0;
    let mut outputs = 0;
    let price = |size| linear_fee(params, size).saturating_add(script_fee);
    let (fee, staged) = settle(signers, patches, price, |fee| {
        (paid, change) = match pays {
            [only] if only.amount == AccountAmount::Max => {
                let all = total
                    .checked_sub(fee)
                    .and_then(|rest| rest.checked_sub(change_floor))
                    .ok_or(short)?;
                (vec![all], change_floor)
            }
            _ => {
                let each: Vec<u64> = pays
                    .iter()
                    .map(|p| match p.amount {
                        AccountAmount::Lovelace(lovelace) => lovelace,
                        AccountAmount::Max => 0,
                    })
                    .collect();
                let change = each
                    .iter()
                    .try_fold(total, |rest, l| rest.checked_sub(*l))
                    .and_then(|rest| rest.checked_sub(fee))
                    .ok_or(short)?;
                (each, change)
            }
        };
        let mut tx = StagingTransaction::new();
        for input in &inputs {
            tx = tx.input(input.clone());
        }
        outputs = 0;
        for ((pay, lovelace), tokens) in pays.iter().zip(&paid).zip(&each_tokens) {
            for output in pay.payee.outputs(params, *lovelace, tokens)? {
                outputs += 1;
                tx = tx.output(output);
            }
        }
        for output in change_outputs(params, change_addr, change, &staying, short)? {
            tx = tx.output(output);
        }
        Ok(expiring(tx.fee(fee), invalid_hereafter))
    })?;

    Ok(AccountPayment {
        tx: built_with(staged, patches)?,
        inputs: selected.to_vec(),
        fee,
        lovelace: paid.iter().sum(),
        tokens: paying,
        paid,
        outputs,
        change_lovelace: change,
        change_tokens: staying,
        left_out: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Seedelf script spends
//
// Every spend of owned wallet-contract UTxOs has the same shape: each input is
// unlocked by a Schnorr proof bound to a one-time key, collateral comes from
// giveme.my, and the scripts are read from reference inputs. It's built in two
// phases, because the scripts' execution budgets are only known after Ogmios
// has evaluated a draft:
//
//   ScriptSpend::new → .output(…) / .mint(…) → .proven(prove)
//     .draft()             placeholder budgets, for Ogmios to evaluate
//     .finalize(budgets)   the real budgets and fee: the unsigned transaction
//
// The caller signs it with the one-time key and giveme.my's witness. Mint,
// transfer, sweep and remove are built on it here.
// ---------------------------------------------------------------------------

/// What one script may use: memory units and CPU steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub mem: u64,
    pub steps: u64,
}

/// Each redeemer's budget in a draft: the most a transaction may use, so
/// evaluation never runs short. Ogmios reports what each script really used.
pub const DRAFT_BUDGET: Budget = Budget {
    mem: 14_000_000,
    steps: 10_000_000_000,
};

/// The most execution a transaction may use: `max_tx_ex_mem` and
/// `max_tx_ex_steps` as of epoch 290 on preprod, and mainnet's at epoch 658.
/// Preprod's have only gone up since (17.5M memory at epoch 315), so this errs
/// on the safe side there.
pub const MAX_TX_BUDGET: Budget = Budget {
    mem: 16_500_000,
    steps: 10_000_000_000,
};

/// A guess at one wallet-contract spend's budget, used only to pick enough
/// inputs before Ogmios has measured the real one. Ogmios measured 76,043
/// memory and 337,845,799 steps on preprod (epoch 315); this is about 1.3×.
pub const SPEND_BUDGET_GUESS: Budget = Budget {
    mem: 100_000,
    steps: 450_000_000,
};

/// A guess at the seedelf policy's budget, like [`SPEND_BUDGET_GUESS`].
/// Measured: 72,836 memory and 21,396,182 steps.
pub const MINT_BUDGET_GUESS: Budget = Budget {
    mem: 100_000,
    steps: 30_000_000,
};

/// The most wallet-contract inputs one transaction spends at the guessed
/// budgets ([`SPEND_BUDGET_GUESS`] each within [`MAX_TX_BUDGET`]): 22. More
/// are [`TooMany`] by their count alone.
pub(crate) const GUESSED_MOST_INPUTS: usize = {
    let steps = MAX_TX_BUDGET.steps / SPEND_BUDGET_GUESS.steps;
    let mem = MAX_TX_BUDGET.mem / SPEND_BUDGET_GUESS.mem;
    (if steps < mem { steps } else { mem }) as usize
};

/// The collateral giveme.my lends: one 5 ADA UTxO.
pub const COLLATERAL_LOVELACE: u64 = 5_000_000;

/// Rounds a fee up to an even number of lovelace, so the collateral's
/// `3/2 × fee` is whole.
pub fn even(fee: u64) -> u64 {
    fee + fee % 2
}

/// The collateral return: 5 ADA − 3/2 × `fee` back to giveme.my. `fee` must
/// be even (see [`even`]). Errors when the fee is too large for the 5 ADA
/// collateral to cover.
pub fn collateral_output(addr: Address, fee: u64) -> Result<Output> {
    let collateral_return: u64 = COLLATERAL_LOVELACE
        .checked_sub(fee * 3 / 2)
        .context("transaction fee is too large for the 5 ADA collateral to cover")?;
    Ok(Output::new(addr, collateral_return))
}

/// The collateral key's signature in giveme.my's answer, `{ "witness": hex }`:
/// the witness's last 64 bytes.
pub fn collateral_signature(answer: &Value) -> Result<[u8; 64]> {
    let witness = answer
        .get("witness")
        .and_then(Value::as_str)
        .filter(|w| w.len() >= 128)
        .with_context(|| format!("The collateral service answered unexpectedly: {answer}"))?
        .as_bytes();
    hex::decode(&witness[witness.len() - 128..])
        .context("The collateral service's witness isn't hex")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("The collateral service's signature isn't 64 bytes"))
}

/// Whether `signature` is giveme.my's collateral key signing `tx_hash`.
pub fn is_collateral_signature(tx_hash: &[u8], signature: &[u8; 64]) -> bool {
    PublicKey::from(COLLATERAL_PUBLIC_KEY).verify(tx_hash, &Signature::from(*signature))
}

/// Adds vkey witnesses to a transaction kept as CBOR, leaving its body, and so
/// its hash, byte for byte as it was. For signing a script spend built at
/// review and sent later.
pub fn add_witnesses(tx_cbor: &[u8], witnesses: &[(PublicKey, Signature)]) -> Result<Vec<u8>> {
    let hash = tx_id(tx_cbor)?;
    let mut tx = conway::Tx::decode_fragment(tx_cbor)
        .map_err(|e| anyhow::anyhow!("The transaction to sign isn't a Conway transaction: {e}"))?;
    let mut vkeys: Vec<conway::VKeyWitness> = tx
        .transaction_witness_set
        .vkeywitness
        .map(|w| w.to_vec())
        .unwrap_or_default();
    for (key, signature) in witnesses {
        vkeys.push(conway::VKeyWitness {
            vkey: key.as_ref().to_vec().into(),
            signature: signature.as_ref().to_vec().into(),
        });
    }
    tx.transaction_witness_set.vkeywitness = NonEmptySet::from_vec(vkeys);
    let signed = tx
        .encode_fragment()
        .map_err(|e| anyhow::anyhow!("Failed to encode the signed transaction: {e}"))?;
    if tx_id(&signed)? != hash {
        bail!("Signing changed the transaction");
    }
    Ok(signed)
}

/// A transaction's id: the hash of its body exactly as encoded (the first
/// element of the transaction's CBOR array).
pub fn tx_id(tx_cbor: &[u8]) -> Result<Hash<32>> {
    let mut decoder = minicbor::Decoder::new(tx_cbor);
    let body = decoder.array().and_then(|_| {
        let start = decoder.position();
        decoder.skip()?;
        Ok(start..decoder.position())
    });
    let body = body.map_err(|e| anyhow::anyhow!("The transaction isn't valid CBOR: {e}"))?;
    Ok(Hasher::<256>::hash(&tx_cbor[body]))
}

/// The key hashes a Conway transaction needs signatures from.
pub fn required_signers(tx_cbor: &[u8]) -> Result<Vec<Hash<28>>> {
    let tx = conway::Tx::decode_fragment(tx_cbor)
        .map_err(|e| anyhow::anyhow!("The transaction isn't a Conway transaction: {e}"))?;
    Ok(tx
        .transaction_body
        .required_signers
        .map(|s| s.to_vec())
        .unwrap_or_default())
}

/// The execution budgets measured by redeemer, by Ogmios or in the wallet
/// ([`crate::eval`]).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Budgets {
    spend: BTreeMap<u64, Budget>,
    mint: BTreeMap<u64, Budget>,
    withdraw: BTreeMap<u64, Budget>,
}

impl Budgets {
    /// Reads Ogmios's answer to `evaluateTransaction` (JSON-RPC, Ogmios v6):
    /// a `result` list of `{ validator: { purpose, index }, budget: { memory,
    /// cpu } }`. Budgets are matched to redeemers by purpose and index, never
    /// by their order in the answer. An `error` answer becomes an error that
    /// says which script failed and why.
    pub fn from_ogmios(answer: &Value) -> Result<Self> {
        if let Some(error) = answer.get("error") {
            bail!(ogmios_failure(error));
        }
        let rows = answer
            .get("result")
            .and_then(Value::as_array)
            .with_context(|| format!("Ogmios answered without budgets: {answer}"))?;
        let mut budgets = Budgets::default();
        for row in rows {
            let purpose = row.pointer("/validator/purpose").and_then(Value::as_str);
            let index = row.pointer("/validator/index").and_then(Value::as_u64);
            let mem = row.pointer("/budget/memory").and_then(Value::as_u64);
            let steps = row.pointer("/budget/cpu").and_then(Value::as_u64);
            let (Some(purpose), Some(index), Some(mem), Some(steps)) = (purpose, index, mem, steps)
            else {
                bail!("Ogmios returned a budget the wallet can't read: {row}");
            };
            let budget = Budget { mem, steps };
            match purpose {
                "spend" => budgets.spend.insert(index, budget),
                "mint" => budgets.mint.insert(index, budget),
                "withdraw" => budgets.withdraw.insert(index, budget),
                other => {
                    bail!("Ogmios measured a {other} script, which this transaction doesn't have")
                }
            };
        }
        Ok(budgets)
    }

    /// A guess for `spends` wallet-contract inputs and `mints` seedelf
    /// policies, before Ogmios has measured anything.
    pub(crate) fn guess(spends: &[u64], mints: usize) -> Self {
        Budgets {
            spend: spends.iter().map(|i| (*i, SPEND_BUDGET_GUESS)).collect(),
            mint: (0..mints as u64).map(|i| (i, MINT_BUDGET_GUESS)).collect(),
            withdraw: BTreeMap::new(),
        }
    }

    pub fn spend(&self, index: u64) -> Option<Budget> {
        self.spend.get(&index).copied()
    }

    pub fn mint(&self, index: u64) -> Option<Budget> {
        self.mint.get(&index).copied()
    }

    /// A script withdrawal's budget (a withdraw-zero, such as Lovejoin's).
    pub fn withdraw(&self, index: u64) -> Option<Budget> {
        self.withdraw.get(&index).copied()
    }

    /// Every budget raised by `percent`, rounded up: what to declare when the
    /// transaction measured will change a little before it's sent (a proof
    /// bound to the fee costs a hair more or less each time it's made).
    pub fn with_margin(&self, percent: u64) -> Self {
        let raise = |m: &BTreeMap<u64, Budget>| {
            m.iter()
                .map(|(i, b)| {
                    let up = |x: u64| x + (x * percent).div_ceil(100);
                    (
                        *i,
                        Budget {
                            mem: up(b.mem),
                            steps: up(b.steps),
                        },
                    )
                })
                .collect()
        };
        Budgets {
            spend: raise(&self.spend),
            mint: raise(&self.mint),
            withdraw: raise(&self.withdraw),
        }
    }

    /// Whether every budget here is at least `used`'s, redeemer by redeemer.
    pub fn covers(&self, used: &Budgets) -> bool {
        let within = |ours: &BTreeMap<u64, Budget>, theirs: &BTreeMap<u64, Budget>| {
            theirs.iter().all(|(i, b)| {
                ours.get(i)
                    .is_some_and(|o| o.mem >= b.mem && o.steps >= b.steps)
            })
        };
        within(&self.spend, &used.spend)
            && within(&self.mint, &used.mint)
            && within(&self.withdraw, &used.withdraw)
    }
}

/// Ogmios's `error` object in plain words. Script failures name the script
/// and keep the machine's last words and any traces; inputs Ogmios can't find
/// mean the wallet's view of the chain is out of date.
fn ogmios_failure(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("no reason given");
    let items: Vec<&Value> = error
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .collect();
    // 3110: redeemers pointing at inputs Ogmios can't resolve; 3117: unknown inputs.
    let stale = error.get("code").and_then(Value::as_i64) == Some(3117)
        || items.iter().any(|item| {
            matches!(
                item.pointer("/error/code").and_then(Value::as_i64),
                Some(3110 | 3117)
            )
        });
    if stale {
        return "Some of the UTxOs this spends aren't on chain anymore. Refresh the balance and try again.".to_string();
    }
    let failures: Vec<String> = items
        .iter()
        .filter_map(|item| {
            let purpose = item.pointer("/validator/purpose").and_then(Value::as_str)?;
            let index = item.pointer("/validator/index").and_then(Value::as_u64)?;
            let what = match purpose {
                "spend" => format!("spending input {index}"),
                "mint" => "the Seedelf policy".to_string(),
                other => format!("{other} {index}"),
            };
            let reason = item
                .pointer("/error/data/validationError")
                .and_then(Value::as_str)
                .and_then(|e| e.lines().map(str::trim).rfind(|l| !l.is_empty()))
                .or_else(|| item.pointer("/error/message").and_then(Value::as_str))
                .unwrap_or("failed");
            let traces: Vec<&str> = item
                .pointer("/error/data/traces")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            Some(if traces.is_empty() {
                format!("{what}: {reason}")
            } else {
                format!("{what}: {reason}, traces: {}", traces.join("; "))
            })
        })
        .collect();
    // Seedelf's scripts only spend and mint; a withdraw-zero is Lovejoin's.
    let foreign = items.iter().any(|item| {
        !matches!(
            item.pointer("/validator/purpose").and_then(Value::as_str),
            Some("spend" | "mint") | None
        )
    });
    if failures.is_empty() {
        format!("Ogmios couldn't evaluate the transaction: {message}")
    } else if foreign {
        format!(
            "A script refused this transaction ({})",
            failures.join("; ")
        )
    } else {
        format!(
            "The Seedelf contract refused this transaction ({})",
            failures.join("; ")
        )
    }
}

/// The fee of a script spend, by part. `total` is what the transaction pays:
/// the sum, rounded up to even.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScriptFee {
    /// The linear fee for the signed size.
    pub size: u64,
    /// Execution units, at the protocol's prices.
    pub compute: u64,
    /// Reference scripts: those read from reference inputs, and any on a
    /// spent input.
    pub script_reference: u64,
    pub total: u64,
}

/// A finished script spend: the unsigned transaction and what it does.
pub struct FinalSpend {
    /// Needs the one-time key's signature and giveme.my's witness.
    pub tx: BuiltTransaction,
    pub fee: ScriptFee,
    /// What [`ScriptSpend::pay_rest`] paid, in lovelace, with the tokens it
    /// was given; `None` without it.
    pub rest_lovelace: Option<u64>,
    /// Back into the wallet contract, under fresh registers.
    pub change_lovelace: u64,
    pub change_tokens: Assets,
    pub change_outputs: usize,
}

/// What every script spend is built against.
#[derive(Clone)]
pub struct Chain {
    pub params: ProtocolParameters,
    /// The CLI's convention: `true` is preprod.
    pub network_flag: bool,
    /// The contract variant's hashes and reference UTxOs (`get_config`).
    pub config: Config,
}

/// An owned wallet-contract UTxO being spent.
#[derive(Clone)]
struct OwnedInput {
    utxo: UtxoResponse,
    input: Input,
    register: Register,
}

/// A token minted (or burned, when negative) under the seedelf policy, or
/// under a policy whose script the transaction carries.
#[derive(Clone)]
struct PolicyMint {
    policy: Hash<28>,
    token_name: Vec<u8>,
    amount: i64,
    redeemer: Vec<u8>,
    /// None for the seedelf policy, read from its reference UTxO; otherwise
    /// the policy's Plutus V3 script, in the witnesses (a Lovejoin launch's
    /// one-shot mint, which is used once).
    script: Option<Vec<u8>>,
}

/// A key account whose UTxOs a Seedelf spend takes too, and whose own
/// collateral it puts up instead of giveme.my's: a private session bringing
/// its money back into the Seedelf UTxO its funding made. The account's key
/// signs for its UTxOs; the proofs stay bound to the spend's own one-time key
/// (privacy rule 1), which signs too. The account's key may sign what others
/// build (a site's session does), so a proof bound to it could be replayed
/// in a transaction someone else put in front of it.
#[derive(Clone)]
struct AccountPart {
    inputs: Vec<(UtxoResponse, Input)>,
    collateral: Input,
    collateral_lovelace: u64,
    collateral_addr: Address,
}

/// Who [`ScriptSpend::pay_rest`] pays what's left.
#[derive(Debug, Clone)]
pub enum RestTo {
    /// A Seedelf: into the contract, each output under a fresh
    /// re-randomization of its register, which must be [`is_payable`]. Tokens
    /// go `MAXIMUM_TOKENS_PER_UTXO` to an output ([`deposit_outputs`]).
    Seedelf(Register),
    /// An address on this network ([`is_payable_address`]). Tokens go
    /// `MAXIMUM_TOKENS_PER_UTXO` to an output.
    Address(Address),
}

/// [`ScriptSpend::pay_rest`]'s payee, and the tokens it's sent.
#[derive(Clone)]
struct Rest {
    to: RestTo,
    tokens: Assets,
}

/// A Seedelf script spend, before its execution budgets are known. See the
/// section comment above.
#[derive(Clone)]
pub struct ScriptSpend {
    chain: Chain,
    inputs: Vec<OwnedInput>,
    /// One spend redeemer per input, once proven.
    redeemers: Option<Vec<Vec<u8>>>,
    outputs: Vec<Output>,
    paid_lovelace: u64,
    paid_tokens: Assets,
    mint: Option<PolicyMint>,
    change_owner: Register,
    /// Where the change goes instead of the contract, if anywhere.
    change_addr: Option<Address>,
    /// Who's paid what's left rather than the change, if anyone ([`Self::pay_rest`]).
    rest: Option<Rest>,
    signer: Hash<28>,
    /// A key account spent alongside, with its collateral ([`Self::with_account`]).
    account: Option<AccountPart>,
    /// Certificates patched in ([`Self::with_staking`]); none for any spend
    /// but a Lovejoin launch.
    staking: Staking,
    /// Whether the outputs go in a fresh random order each time it's staged
    /// (every spend but a Lovejoin launch: [`Self::in_order`]).
    shuffled: bool,
}

impl ScriptSpend {
    /// Spends `inputs`, owned wallet-contract UTxOs (each datum is a
    /// register). What's left after the outputs and the fee goes back into
    /// the contract under fresh re-randomizations of `change_owner`. `signer`
    /// is the one-time key's hash: every proof is bound to it, and it must
    /// sign.
    pub fn new(
        chain: &Chain,
        inputs: &[UtxoResponse],
        change_owner: &Register,
        signer: Hash<28>,
    ) -> Result<Self> {
        if inputs.is_empty() {
            bail!("A Seedelf spend needs at least one UTxO to spend");
        }
        let inputs = inputs
            .iter()
            .map(|utxo| {
                let register =
                    extract_bytes_with_logging(&utxo.inline_datum).with_context(|| {
                        format!("UTxO {}#{} holds no register", utxo.tx_hash, utxo.tx_index)
                    })?;
                Ok(OwnedInput {
                    input: input_of(utxo)?,
                    utxo: utxo.clone(),
                    register,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(ScriptSpend {
            chain: chain.clone(),
            inputs,
            redeemers: None,
            outputs: Vec::new(),
            paid_lovelace: 0,
            paid_tokens: Assets::new(),
            mint: None,
            change_owner: change_owner.clone(),
            change_addr: None,
            rest: None,
            signer,
            account: None,
            staking: Staking::none(),
            shuffled: true,
        })
    }

    /// Spends `inputs` too, UTxOs under the key account's key `account`, and
    /// puts up `collateral`, an ADA-only UTxO of the same account, in place of
    /// giveme.my's (it may be one of `inputs`: the ledger takes a UTxO as
    /// both). The account's key and the one-time key sign; giveme.my doesn't.
    /// What the account holds goes with the change. `account` can't be the
    /// one-time key: the proofs must stay bound to a key used once.
    pub fn with_account(
        mut self,
        account: Hash<28>,
        inputs: &[UtxoResponse],
        collateral: &UtxoResponse,
    ) -> Result<Self> {
        if account == self.signer {
            bail!("The account's key can't also be the spend's one-time key");
        }
        let network_flag = self.chain.network_flag;
        let at_signer = |utxo: &UtxoResponse| -> Result<Address> {
            let addr = Address::from_bech32(&utxo.address).with_context(|| {
                format!(
                    "UTxO {}#{} has an unreadable address",
                    utxo.tx_hash, utxo.tx_index
                )
            })?;
            let key = match &addr {
                Address::Shelley(s) if is_on_correct_network(addr.clone(), network_flag) => {
                    match s.payment() {
                        pallas_addresses::ShelleyPaymentPart::Key(k) => Some(*k),
                        pallas_addresses::ShelleyPaymentPart::Script(_) => None,
                    }
                }
                _ => None,
            };
            if key != Some(account) {
                bail!(
                    "UTxO {}#{} isn't under the account's key",
                    utxo.tx_hash,
                    utxo.tx_index
                );
            }
            Ok(addr)
        };
        let mut taken = Vec::with_capacity(inputs.len());
        for utxo in inputs {
            at_signer(utxo)?;
            let input = input_of(utxo)?;
            if self.inputs.iter().any(|o| o.input == input)
                || taken
                    .iter()
                    .any(|(_, i): &(UtxoResponse, Input)| *i == input)
            {
                bail!("UTxO {}#{} is spent twice", utxo.tx_hash, utxo.tx_index);
            }
            taken.push((utxo.clone(), input));
        }
        let collateral_addr = at_signer(collateral)?;
        if collateral
            .asset_list
            .as_ref()
            .is_some_and(|a| !a.is_empty())
        {
            bail!("A collateral must hold ADA alone");
        }
        self.account = Some(AccountPart {
            inputs: taken,
            collateral: input_of(collateral)?,
            collateral_lovelace: collateral
                .value
                .parse()
                .context("The collateral's value isn't a number")?,
            collateral_addr,
        });
        Ok(self)
    }

    /// Sends what's left after the outputs and the fee to `addr`, an address
    /// on this network ([`is_payable_address`], which the caller checks),
    /// instead of back into the contract: everything, for sending the lot,
    /// or a removed seedelf's ADA. Tokens go 20 to an output.
    pub fn change_to(mut self, addr: &Address) -> Self {
        self.change_addr = Some(addr.clone());
        self
    }

    /// Pays `to` everything left after the outputs and the fee, with
    /// `tokens`, rather than keeping it as change: the most these inputs can
    /// pay (Max, as [`AccountAmount::Max`] is for the Cardano account). The
    /// tokens it doesn't send stay as change with the least ADA they need
    /// ([`minimum_deposit`], or what an output at [`Self::change_to`]'s
    /// address needs), and no other ADA stays. With none to keep there's no
    /// change at all. Short ([`is_short`]) when what's left can't carry
    /// `tokens` to `to`.
    pub fn pay_rest(mut self, to: RestTo, tokens: &Assets) -> Result<Self> {
        match &to {
            RestTo::Seedelf(register) => check_register(register)?,
            RestTo::Address(addr) => check_address(&self.chain, addr)?,
        }
        if tokens.items.iter().any(|a| a.amount == 0) {
            bail!("A payment can't send none of a token");
        }
        self.rest = Some(Rest {
            to,
            tokens: tokens.clone(),
        });
        Ok(self)
    }

    /// Carries what's left after the outputs and the fee forward, in one output of ADA alone under a fresh
    /// re-randomization of the change's owner ([`Self::pay_rest`] to the wallet itself, with no token): a payment in
    /// parts whose next part has no ADA of its own to pay with spends it ([`carried`]). The tokens it doesn't send stay
    /// as change with the least ADA they need. Short when what's left can't make an output of ADA alone.
    pub fn carry(self) -> Result<Self> {
        let owner = self.change_owner.clone();
        self.pay_rest(RestTo::Seedelf(owner), &Assets::new())
    }

    /// Adds an output. `tokens` must be what the output holds.
    pub fn output(mut self, output: Output, tokens: &Assets) -> Result<Self> {
        self.paid_lovelace = self
            .paid_lovelace
            .checked_add(output.lovelace)
            .context("output lovelace overflow")?;
        self.paid_tokens = self.paid_tokens.merge(tokens.clone())?;
        self.outputs.push(output);
        Ok(self)
    }

    /// Mints `amount` of `token_name` under the seedelf policy (burns it
    /// when negative), with the policy's `redeemer`.
    pub fn mint(mut self, token_name: Vec<u8>, amount: i64, redeemer: Vec<u8>) -> Result<Self> {
        self.mint = Some(PolicyMint {
            policy: policy_hash(&self.chain.config)?,
            token_name,
            amount,
            redeemer,
            script: None,
        });
        Ok(self)
    }

    /// Mints `amount` of `token_name` under the Plutus V3 `script`, which
    /// the transaction carries in its witnesses, with `redeemer`: a Lovejoin
    /// launch's NFT. The script must hash to `policy`.
    pub fn mint_inline(
        mut self,
        policy: Hash<28>,
        script: Vec<u8>,
        token_name: Vec<u8>,
        amount: i64,
        redeemer: Vec<u8>,
    ) -> Result<Self> {
        if *Hasher::<224>::hash_tagged(&script, 3) != *policy {
            bail!("The minting script isn't the policy's");
        }
        self.mint = Some(PolicyMint {
            policy,
            token_name,
            amount,
            redeemer,
            script: Some(script),
        });
        Ok(self)
    }

    /// Stages the outputs in the order given, the change last, rather than
    /// in a fresh random order: a Lovejoin launch. Its scripts look for an
    /// output (`one_shot_mint` its reference UTxO), so a shuffled draft and
    /// its finished transaction could cost them more than the margin apart;
    /// and the order hides nothing there, the outputs' addresses saying what
    /// each one is.
    pub fn in_order(mut self) -> Self {
        self.shuffled = false;
        self
    }

    /// Patches `staking`'s certificates in, and takes their deposit out of
    /// the change: a Lovejoin launch registering `mix_logic`'s credential.
    /// Only a script's registration with Shelley's certificate (0), the one
    /// certificate of a script's the ledger asks no witness for
    /// (`Staking::registers_scripts_alone`). The spend adds no key's
    /// signature and stages no certifying redeemer, so any other certificate,
    /// a withdrawal or a vote would be built and measured, then refused by
    /// the node; it's refused here, in words (1.6.0's release review,
    /// 314-core#2).
    pub fn with_staking(mut self, staking: Staking) -> Result<Self> {
        if !staking.registers_scripts_alone() {
            bail!(
                "A Seedelf spend takes only a script's stake registration: any other certificate, a withdrawal or a vote needs a signature or a script the spend doesn't add"
            );
        }
        self.staking = staking;
        Ok(self)
    }

    /// Proves every input: `prove(register, vkh)` returns the Schnorr proof
    /// `(z, g_r)` for a register, bound to `vkh`, the one-time key's hash in
    /// hex. The caller holds the secret; this never sees it.
    pub fn proven(
        mut self,
        mut prove: impl FnMut(&Register, &str) -> Result<(String, String)>,
    ) -> Result<Self> {
        let vkh = hex::encode(self.signer);
        let redeemers = self
            .inputs
            .iter()
            .map(|owned| {
                let (z, g_r) = prove(&owned.register, &vkh)?;
                create_spend_redeemer(z, g_r, vkh.clone())
            })
            .collect::<Result<Vec<_>>>()?;
        self.redeemers = Some(redeemers);
        Ok(self)
    }

    /// The UTxOs spent, in the order given.
    pub fn inputs(&self) -> Vec<UtxoResponse> {
        self.inputs.iter().map(|o| o.utxo.clone()).collect()
    }

    /// The draft for Ogmios to evaluate: every redeemer carries
    /// [`DRAFT_BUDGET`]. Needs [`Self::proven`] first, or the scripts fail.
    pub fn draft(&self) -> Result<BuiltTransaction> {
        let redeemers = self.proofs()?;
        // Ogmios doesn't check the fee. Staging with the estimated one keeps
        // the draft's change valid whenever the finished transaction's is.
        let fee = self.estimate()?.fee.total;
        built_with(self.stage(fee, None, redeemers)?, self.patches())
            .context("Failed To Build The Draft Transaction")
    }

    fn patches(&self) -> Patches<'_> {
        Patches::staking(&self.staking)
    }

    /// The unsigned transaction, with the budgets Ogmios measured on the
    /// draft and the fee they and the signed size need. An account's
    /// collateral is held here, at that fee, to cover 3/2 of it and come back
    /// as an output ([`CollateralShort`] when it can't).
    pub fn finalize(&self, budgets: &Budgets) -> Result<FinalSpend> {
        let redeemers = self.proofs()?;
        let finished = self.settle(budgets, redeemers)?;
        if let Some(account) = &self.account {
            let address = account
                .collateral_addr
                .to_bech32()
                .map_err(|e| anyhow::anyhow!("The collateral's address can't be written: {e}"))?;
            collateral_back(
                &self.chain.params,
                &address,
                account.collateral_lovelace,
                Assets::new(),
                finished.fee.total,
                SPEND_COLLATERAL_SHORT,
            )?;
        }
        Ok(finished)
    }

    /// [`Self::finalize`] with guessed budgets and stand-in proofs: whether
    /// these inputs can pay, before anything is proven or measured. An
    /// account's collateral isn't held to its guessed fee, only to the fee
    /// that's sent.
    pub fn estimate(&self) -> Result<FinalSpend> {
        let placeholder = create_spend_redeemer(
            "00".repeat(32),
            Register::create(blstrs::Scalar::from(1u64))?.generator,
            hex::encode(self.signer),
        )?;
        let redeemers = vec![placeholder; self.inputs.len()];
        let budgets = Budgets::guess(&self.positions()?, usize::from(self.mint.is_some()));
        self.settle(&budgets, &redeemers)
    }

    /// Measures the scripts in the wallet ([`crate::eval`]) rather than
    /// through Ogmios, and finishes the spend: the draft, then the finished
    /// transaction measured again as it will be sent. `known` are UTxOs it
    /// spends that aren't on chain yet (a chain's own outputs); the rest
    /// come from the rows given, and the Seedelf references are bundled.
    pub fn measure_locally(&self, known: &[crate::eval::Resolved]) -> Result<FinalSpend> {
        let Chain {
            params,
            network_flag,
            ..
        } = &self.chain;
        let mut resolved: Vec<crate::eval::Resolved> = known.to_vec();
        let rows = self.inputs.iter().map(|o| &o.utxo).chain(
            self.account
                .iter()
                .flat_map(|a| a.inputs.iter().map(|(u, _)| u)),
        );
        for row in rows {
            let hash = decode_tx_hash(&row.tx_hash)?;
            if !resolved
                .iter()
                .any(|r| r.tx_hash == hash && r.index == row.tx_index)
            {
                resolved.push(crate::eval::resolve_row(row)?);
            }
        }
        resolved.extend(crate::eval::seedelf_references(*network_flag)?);
        let measure = |tx: &BuiltTransaction| -> Result<Budgets> {
            let answer = crate::eval::evaluate(
                &tx.tx_bytes.0,
                &resolved,
                &params.cost_model_v3,
                *network_flag,
            )?;
            Budgets::from_ogmios(&answer)
        };
        let budgets = measure(&self.measuring_draft()?)?;
        let finished = self.finalize(&budgets)?;
        let again = measure(&finished.tx)?;
        if budgets.covers(&again) {
            return Ok(finished);
        }
        // The finished transaction's scripts used a hair more than the draft's.
        let finished = self.finalize(&again.with_margin(1))?;
        if !again.with_margin(1).covers(&measure(&finished.tx)?) {
            bail!("The scripts' budgets did not settle");
        }
        Ok(finished)
    }

    /// The draft [`Self::measure_locally`] measures: [`Self::draft`], or, when
    /// the guessed budgets call these inputs short, the same staged with the
    /// most fee they can pay. The guess runs about 1.3× what the scripts use,
    /// so a spend it calls short may pay once measured: that check refused
    /// amounts the review's own fee allowed, so the most a private Send could
    /// pay couldn't be worked out from the screen (blind test T05). The
    /// scripts read neither the fee nor the outputs, so they use the same.
    fn measuring_draft(&self) -> Result<BuiltTransaction> {
        let short = match self.draft() {
            Err(e) if is_short(&e) => e,
            other => return other,
        };
        let redeemers = self.proofs()?;
        let Some(fee) = self.most_fee()? else {
            return Err(short);
        };
        // A fee its outputs can't be staged at: the guess wasn't what fell
        // short. (An account's collateral is held at the fee that's sent.)
        match self.stage(fee, None, redeemers) {
            Ok(staged) => {
                built_with(staged, self.patches()).context("Failed To Build The Draft Transaction")
            }
            Err(_) => Err(short),
        }
    }

    /// The largest fee these inputs can pay along with their outputs, what
    /// [`Self::pay_rest`] must carry, and valid change; `None` when they
    /// can't pay any. Even, as a sent fee is (its collateral is 3/2 of it),
    /// but when nothing need stay: then it's all that's left, so there's no
    /// change at all. An even one there could leave a lovelace of change,
    /// which is never valid, and every amount leaving an odd remainder in the
    /// window the guess calls short was refused (cross-area review). The
    /// draft is only measured, never sent, so its fee needn't be even.
    fn most_fee(&self) -> Result<Option<u64>> {
        let (left, tokens) = match self.remainder(0) {
            Ok(left) => left,
            Err(e) if is_short(&e) => return Ok(None),
            Err(e) => return Err(e),
        };
        let needs = match &self.rest {
            Some(rest) => {
                let kept = tokens
                    .separate(rest.tokens.clone())
                    .context("The UTxOs spent don't hold the tokens being sent")?;
                self.change_minimum(&kept)? + self.rest_minimum(rest)?
            }
            None => self.change_minimum(&tokens)?,
        };
        Ok(left
            .checked_sub(needs)
            .map(|fee| if needs == 0 { fee } else { fee - fee % 2 })
            .filter(|fee| *fee > 0))
    }

    fn proofs(&self) -> Result<&[Vec<u8>]> {
        self.redeemers
            .as_deref()
            .context("The Seedelf spend isn't proven yet")
    }

    /// Every input, the account's too, in the ledger's order: by
    /// transaction id, then index. Redeemers point into it.
    fn ledger_order(&self) -> Vec<Input> {
        let mut order: Vec<Input> = self
            .inputs
            .iter()
            .map(|o| o.input.clone())
            .chain(
                self.account
                    .iter()
                    .flat_map(|a| a.inputs.iter().map(|(_, i)| i.clone())),
            )
            .collect();
        order.sort_by_key(|i| (i.tx_hash.0, i.txo_index));
        order
    }

    /// Where each owned input sits in the ledger's order, in the order given:
    /// the index its spend redeemer carries.
    fn positions(&self) -> Result<Vec<u64>> {
        let order = self.ledger_order();
        self.inputs
            .iter()
            .map(|owned| {
                order
                    .iter()
                    .position(|i| *i == owned.input)
                    .map(|p| p as u64)
                    .context("An input is missing from the transaction")
            })
            .collect()
    }

    fn settle(&self, budgets: &Budgets, redeemers: &[Vec<u8>]) -> Result<FinalSpend> {
        // Every redeemer needs a budget, and together they must fit a transaction.
        let mut used = Vec::with_capacity(self.inputs.len() + 1);
        let mut positions = self.positions()?;
        positions.sort_unstable();
        for index in positions {
            used.push(budgets.spend(index).with_context(|| {
                format!("Ogmios measured no budget for spending input {index}")
            })?);
        }
        if self.mint.is_some() {
            used.push(
                budgets
                    .mint(0)
                    .context("Ogmios measured no budget for the Seedelf policy")?,
            );
        }
        let total = used
            .iter()
            .fold(Budget { mem: 0, steps: 0 }, |a, b| Budget {
                mem: a.mem + b.mem,
                steps: a.steps + b.steps,
            });
        if total.mem > MAX_TX_BUDGET.mem || total.steps > MAX_TX_BUDGET.steps {
            return Err(TooMany(self.inputs.len()).into());
        }

        let compute: u64 = used
            .iter()
            .map(|b| computation_fee(&self.chain.params, b.mem, b.steps))
            .sum();
        // The Seedelf scripts, read from reference inputs, and any reference
        // script on a spent input, which Conway charges for too.
        let contract = &self.chain.config.contract;
        let mut script_bytes = contract.wallet_contract_size;
        if self.mint.as_ref().is_some_and(|m| m.script.is_none()) {
            script_bytes += contract.seedelf_contract_size;
        }
        let mut spent = self.inputs();
        if let Some(account) = &self.account {
            spent.extend(account.inputs.iter().map(|(u, _)| u.clone()));
        }
        script_bytes += reference_script_bytes(&spent)?;
        let script_reference = reference_script_fee(&self.chain.params, script_bytes)?;

        // Two signatures: the one-time key and giveme.my's collateral key, or
        // the account's key when an account puts up the collateral.
        let (fee, staged) = settle(
            2,
            self.patches(),
            |size| even(linear_fee(&self.chain.params, size) + compute + script_reference),
            |fee| self.stage(fee, Some(budgets), redeemers),
        )?;
        let (rest_lovelace, change_lovelace, change_tokens) = self.split(fee)?;
        let rest_outputs = match (&self.rest, rest_lovelace) {
            (Some(rest), Some(_)) => token_chunks(&rest.tokens).len(),
            _ => 0,
        };
        let change_outputs =
            staged.outputs.as_ref().map_or(0, Vec::len) - self.outputs.len() - rest_outputs;
        Ok(FinalSpend {
            tx: built_with(staged, self.patches())?,
            fee: ScriptFee {
                size: fee - compute - script_reference,
                compute,
                script_reference,
                total: fee,
            },
            rest_lovelace,
            change_lovelace,
            change_tokens,
            change_outputs,
        })
    }

    /// What's left when the fee is `fee`, split: what [`Self::pay_rest`]
    /// pays (`None` without it), and the change.
    fn split(&self, fee: u64) -> Result<(Option<u64>, u64, Assets)> {
        let (lovelace, tokens) = self.remainder(fee)?;
        let Some(rest) = &self.rest else {
            return Ok((None, lovelace, tokens));
        };
        let kept = tokens
            .separate(rest.tokens.clone())
            .context("The UTxOs spent don't hold the tokens being sent")?;
        let kept_lovelace = self.change_minimum(&kept)?;
        let paid = lovelace.checked_sub(kept_lovelace).ok_or(SEEDELF_SHORT)?;
        if paid < self.rest_minimum(rest)? {
            bail!(SEEDELF_SHORT);
        }
        Ok((Some(paid), kept_lovelace, kept))
    }

    /// The least ADA change holding `tokens` needs: none without tokens,
    /// since then there needn't be any change.
    fn change_minimum(&self, tokens: &Assets) -> Result<u64> {
        if tokens.is_empty() {
            return Ok(0);
        }
        match &self.change_addr {
            Some(addr) => minimum_change(&self.chain.params, addr, tokens),
            None => minimum_deposit(&self.chain.params, tokens),
        }
    }

    /// The least ADA [`Self::pay_rest`]'s payment needs.
    fn rest_minimum(&self, rest: &Rest) -> Result<u64> {
        match &rest.to {
            RestTo::Seedelf(_) => minimum_seedelf_payment(&self.chain.params, &rest.tokens),
            RestTo::Address(addr) => {
                minimum_address_payment(&self.chain.params, addr, &rest.tokens)
            }
        }
    }

    /// What goes back into the contract when the fee is `fee`.
    fn remainder(&self, fee: u64) -> Result<(u64, Assets)> {
        let mut spent = self.inputs();
        if let Some(account) = &self.account {
            spent.extend(account.inputs.iter().map(|(u, _)| u.clone()));
        }
        let (total, mut tokens) = assets_of(spent)?;
        if let Some(m) = &self.mint {
            let asset = Asset::new(
                hex::encode(m.policy),
                hex::encode(&m.token_name),
                m.amount.unsigned_abs(),
            )?;
            tokens = if m.amount >= 0 {
                tokens.add(asset)?
            } else {
                tokens
                    .sub(asset)
                    .context("The UTxOs spent don't hold the token to burn")?
            };
        }
        let lovelace = total
            .checked_add(self.staking.refund())
            .and_then(|total| total.checked_sub(self.paid_lovelace))
            .and_then(|rest| rest.checked_sub(fee))
            .and_then(|rest| {
                rest.checked_sub(self.staking.deposit_at(self.chain.params.key_deposit))
            })
            .ok_or(SEEDELF_SHORT)?;
        let tokens = tokens
            .separate(self.paid_tokens.clone())
            .context("The UTxOs spent don't hold the tokens being sent")?;
        Ok((lovelace, tokens))
    }

    fn stage(
        &self,
        fee: u64,
        budgets: Option<&Budgets>,
        redeemers: &[Vec<u8>],
    ) -> Result<StagingTransaction> {
        let Chain {
            params,
            network_flag,
            config,
        } = &self.chain;
        let (rest_lovelace, change_lovelace, change_tokens) = self.split(fee)?;
        let wallet_addr = wallet_contract(*network_flag, config.contract.wallet_contract_hash);
        let rest: Vec<Output> = match (&self.rest, rest_lovelace) {
            (Some(Rest { to, tokens }), Some(lovelace)) => match to {
                RestTo::Seedelf(register) => {
                    deposit_outputs(params, &wallet_addr, register, lovelace, tokens)?
                }
                RestTo::Address(addr) => pay_address(params, addr, lovelace, tokens)?
                    .into_iter()
                    .map(|(output, _)| output)
                    .collect(),
            },
            _ => Vec::new(),
        };
        let change = if change_lovelace == 0 && change_tokens.is_empty() {
            Vec::new()
        } else if let Some(addr) = &self.change_addr {
            change_outputs(params, addr, change_lovelace, &change_tokens, SEEDELF_SHORT)?
        } else {
            if change_lovelace < minimum_deposit(params, &change_tokens)? {
                bail!(SEEDELF_SHORT);
            }
            deposit_outputs(
                params,
                &wallet_addr,
                &self.change_owner,
                change_lovelace,
                &change_tokens,
            )?
        };

        let mut tx = StagingTransaction::new();
        for owned in &self.inputs {
            tx = tx.input(owned.input.clone());
        }
        for (_, input) in self.account.iter().flat_map(|a| &a.inputs) {
            tx = tx.input(input.clone());
        }
        // The payments and the change in a random order, drawn afresh each
        // time: in a transfer both are contract outputs under fresh
        // registers, so a fixed order was all that said which one is the
        // change (privacy review §3.7). No redeemer points at an output, and
        // the order changes neither the size nor the fee.
        let mut outputs: Vec<Output> = self
            .outputs
            .iter()
            .cloned()
            .chain(rest)
            .chain(change)
            .collect();
        if self.shuffled {
            crate::lovejoin::shuffle(&mut outputs);
        }
        for output in outputs {
            tx = tx.output(output);
        }
        tx = match &self.account {
            None => tx
                .collateral_input(collateral_input(*network_flag))
                .collateral_output(collateral_output(collateral_address(*network_flag), fee)?)
                .disclosed_signer(self.signer)
                .disclosed_signer(Hash::new(COLLATERAL_HASH)),
            Some(account) => {
                // The fee is even, so 3/2 of it is whole. What comes back is
                // an output, held to an output's least at the fee that's sent,
                // in finalize: a draft's or an estimate's is a guess (chunk 51,
                // r2money#2).
                let back = account.collateral_lovelace.saturating_sub(fee * 3 / 2);
                tx.collateral_input(account.collateral.clone())
                    .collateral_output(Output::new(account.collateral_addr.clone(), back))
                    .disclosed_signer(self.signer)
            }
        };
        tx = tx
            .fee(fee)
            .reference_input(reference_utxo(config.reference.wallet_reference_utxo))
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone());

        // Redeemers point at inputs in the ledger's order: sorted by tx id, then index.
        let order = self.ledger_order();
        let units = |budget: Option<Budget>| {
            let b = budget.unwrap_or(DRAFT_BUDGET);
            ExUnits {
                mem: b.mem,
                steps: b.steps,
            }
        };
        for (owned, redeemer) in self.inputs.iter().zip(redeemers) {
            let index = order
                .iter()
                .position(|i| *i == owned.input)
                .context("An input is missing from the transaction")?;
            let budget = budgets.and_then(|b| b.spend(index as u64));
            tx = tx.add_spend_redeemer(owned.input.clone(), redeemer.clone(), Some(units(budget)));
        }
        if let Some(m) = &self.mint {
            tx = match &m.script {
                None => tx.reference_input(reference_utxo(config.reference.seedelf_reference_utxo)),
                Some(script) => tx.script(ScriptKind::PlutusV3, script.clone()),
            };
            tx = tx
                .mint_asset(m.policy, m.token_name.clone(), m.amount)
                .context("Failed To Mint The Seedelf")?
                .add_mint_redeemer(
                    m.policy,
                    m.redeemer.clone(),
                    Some(units(budgets.and_then(|b| b.mint(0)))),
                );
        }
        Ok(tx)
    }
}

/// What [`ScriptSpend::carry`] carried in `built`, as Koios will list it once that transaction is on chain: its output
/// at the wallet contract holding `built.rest_lovelace` and no token, under the register it was given. The next part
/// of a payment spends it before it's on chain, measured in the wallet ([`ScriptSpend::measure_locally`] reads its
/// row). Refused when no output is it, or more than one could be.
pub fn carried(chain: &Chain, built: &FinalSpend) -> Result<UtxoResponse> {
    let lovelace = built
        .rest_lovelace
        .context("The transaction carries nothing forward")?;
    let tx = pallas_traverse::MultiEraTx::decode(&built.tx.tx_bytes.0)
        .map_err(|e| anyhow::anyhow!("The transaction can't be read: {e}"))?;
    let hash = chain.config.contract.wallet_contract_hash;
    let wallet = wallet_contract(chain.network_flag, hash);
    let outputs = tx.outputs();
    let mut carries = outputs.iter().enumerate().filter(|(_, o)| {
        o.address().is_ok_and(|a| a.to_vec() == wallet.to_vec())
            && o.value().coin() == lovelace
            && o.value().assets().is_empty()
    });
    let (index, output) = carries
        .next()
        .context("The transaction has no output carrying its ADA forward")?;
    if carries.next().is_some() {
        bail!("The transaction has two outputs that could carry its ADA forward");
    }
    let Some(conway::PseudoDatumOption::Data(datum)) = output.datum() else {
        bail!("The output carrying the ADA forward holds no register");
    };
    Ok(UtxoResponse {
        tx_hash: hex::encode(tx.hash()),
        tx_index: index as u64,
        address: wallet
            .to_bech32()
            .map_err(|e| anyhow::anyhow!("The wallet contract's address: {e}"))?,
        value: lovelace.to_string(),
        stake_address: None,
        payment_cred: hex::encode(hash),
        epoch_no: 0,
        block_height: 0,
        block_time: 0,
        datum_hash: None,
        inline_datum: Some(seedelf_koios::koios::InlineDatum {
            bytes: hex::encode(datum.raw_cbor()),
            value: Value::Null,
        }),
        reference_script: None,
        asset_list: Some(Vec::new()),
        is_spent: false,
    })
}

fn policy_hash(config: &Config) -> Result<Hash<28>> {
    let bytes: [u8; 28] = hex::decode(&config.contract.seedelf_policy_id)
        .context("The Seedelf policy id is not hex")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("The Seedelf policy id is not 28 bytes"))?;
    Ok(Hash::new(bytes))
}

// ---------------------------------------------------------------------------
// Keeping histories apart
//
// Two contract UTxOs spent in one transaction can be taken to share an owner,
// so a spend ties together the histories of everything it spends. Two boxes
// back from Lovejoin spent together undo much of the mixing; the change a
// session's funding left, spent in another session's funding, ties the two
// sessions; money made private from the public account, spent on a stealth
// mint, ties the new Seedelf to the account (privacy review §2.3).
//
// The web wallet knows where each of its UTxOs came from (its sealed
// history), and gives each a class. Selection keeps classes apart where one
// of the choices it tries without merging them pays, and otherwise merges
// them, never refusing what the CLI's order would pay (independent review
// M6): the review then says what was merged. The CLI
// knows nothing of the sort: every UTxO is Unknown, and it picks as it
// always has.
// ---------------------------------------------------------------------------

/// Where a UTxO's money came from, as far as the wallet knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Origin {
    /// Nothing is known: the CLI's UTxOs, a restored wallet's.
    #[default]
    Unknown,
    /// Made private from the wallet's own public account, or its change.
    Own,
    /// Paid by someone else.
    Received,
    /// What a private session's funding left, or its return.
    Session,
    /// A box back from Lovejoin: each is a class of its own. One the wallet doesn't know is mixed: one brought back
    /// before it kept that record, which its deposit may still tie to whatever paid for it, one a chain of its own left
    /// short of its last mixes, or a box's way back merged with other boxes or with money of no history. The web
    /// wallet's way back of a box whose making it can't place is one too ([`box_rank`]).
    Lovejoin,
    /// A box back from Lovejoin the wallet knows is mixed (its own chain's last mix made it, or the server said a mix
    /// did), its way back alone: no spend has touched it since (chunk 51, the owner's answer 4 to B15, time#1).
    Mixed,
    /// What an earlier private spend of the wallet's own left, its change, tied to that spend in the open, naming no
    /// public account, no session and no spend made elsewhere: when nothing fresher pays, a stealth mint, a pool's
    /// start and a funding take it before money made private (chunk 51, the owner's answer of 2026-11-18, l2rank#6).
    /// Change that names one of those ranks as a session's money.
    Change,
}

/// The class every UTxO with no history is in.
pub const UNKNOWN_CLASS: &str = "unknown";

/// A UTxO's history: UTxOs of one class share it, and spending them together
/// ties nothing new. `id` names it; a class whose histories were merged
/// before names each of them, joined by `+`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Class {
    pub id: String,
    pub origin: Origin,
}

impl Default for Class {
    fn default() -> Self {
        Class {
            id: UNKNOWN_CLASS.to_string(),
            origin: Origin::Unknown,
        }
    }
}

impl Class {
    /// Whether this class's history includes `part`'s.
    pub fn has(&self, part: &str) -> bool {
        self.id.split('+').any(|p| p == part)
    }
}

/// What a spend is for, which orders the classes it would rather take beside the UTxOs holding the tokens it sends,
/// which [`holding`] takes first, whatever made them (chunk 51, l6words#1, l7words#8).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Purpose {
    /// Send or Make public: own money first, a box back from Lovejoin last; of boxes that pay alone, one the wallet
    /// knows is mixed, then a plain one, then one of unknown making (chunk 51, l3rank#3, l5still#3); merging, by the
    /// box rule ([`box_rank`]).
    #[default]
    Pay,
    /// A stealth mint, and a pool's start from the Seedelf balance: the new
    /// Seedelf is tied to whatever pays for it, so where one pays alone a box back from a mix
    /// (`Origin::Mixed`) first, which no payer knows but one who put it in under the wallet's key
    /// and mixed it themselves, since nothing tells that box from the wallet's
    /// own (chunk 51, own#3), then received money, which its payer does
    /// (chunk 51, gap-g1#1 (b), the owner's B15). An earlier spend's change
    /// goes before money made private, which ties it to the public account
    /// (`Origin::Change`, chunk 51, l2rank#6). Merging, by the box rule ([`box_rank`]; l5merge#4).
    Mint,
    /// A private session's funding or top-up: received money first, then a
    /// box that pays alone, one the wallet knows is mixed, then a plain one,
    /// then one of unknown making (chunk 51, l3rank#3, l5still#3); an earlier
    /// spend's change before money made private; another session's money
    /// last; merging, by the box rule ([`box_rank`]). `session` is the
    /// session's own class, whose money a top-up may take first.
    Fund { session: Option<String> },
}

impl Purpose {
    /// How much this spend would rather take money of `class`: lowest first.
    fn rank(&self, class: &Class) -> u8 {
        use Origin::*;
        match self {
            // Of boxes that pay alone, one the wallet knows is mixed before any other, here and for a funding: any
            // other may be one someone else put in under the wallet's key, a register copied as found among them, whose
            // way back ties the spend to whoever reads that register's Seedelf, where a mixed box's ties it to nothing
            // (chunk 51, l3rank#3); of the others, a plain one before one of unknown making (`box_rank`, l5still#3, in
            // `apart`). Merging boxes goes by the box rule instead (`box_rank`; l4code#1).
            Purpose::Pay => match class.origin {
                Own => 0,
                Session | Change => 1,
                Received => 2,
                Unknown => 3,
                Mixed => 4,
                Lovejoin => 5,
            },
            // Only a box the wallet knows is mixed goes first; any other box, as every box brought back before it
            // kept that record, after received money, as before B15 (chunk 51, the owner's answer 4). What a
            // spend of the wallet's own left is tied to that spend, after fresh money (answer 2), and, nothing
            // fresher paying, before money made private, which ties the new Seedelf to the public account; change
            // that names a public account or a session ranks as a session's, last (the owner's answer of 2026-11-18,
            // l2rank#6).
            Purpose::Mint => match class.origin {
                Mixed => 0,
                Received => 1,
                Lovejoin => 2,
                Unknown => 3,
                Change => 4,
                Own => 5,
                Session => 6,
            },
            Purpose::Fund { session } => {
                if session.as_deref().is_some_and(|s| class.has(s)) {
                    return 0;
                }
                match class.origin {
                    Received => 1,
                    Mixed => 2,
                    Lovejoin => 3,
                    Unknown => 4,
                    Change => 5,
                    Own => 6,
                    Session => 7,
                }
            }
        }
    }

    /// When merging: 0 for what's taken first, 1 for what's taken only when
    /// nothing else pays (another session's money, for a funding), 2 for a
    /// box, taken last, by the box rule ([`box_rank`]). An
    /// earlier spend's change is no session's: 0, so a funding merges it
    /// before money made private too.
    fn tier(&self, class: &Class) -> u8 {
        match (self, class.origin) {
            (_, Origin::Lovejoin | Origin::Mixed) => 2,
            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 1,
            _ => 0,
        }
    }
}

/// What kind of box back from Lovejoin `class` is, for every purpose: 0, one the wallet knows is mixed, which ties
/// nothing; 1, a plain one, boxes alone (each part a `box:<tx>`), whose making the wallet knows or, kept by 1.9.1 with
/// no record, can't tell (chunk 51, l5still#5); 2, one of unknown making (a part of another kind: the `unknown:<tx>`
/// of a box someone else may have put in, or money of no history).
///
/// The box rule, the one every spend merges boxes by (chunk 51, round six's rule, after l4code#1, l5merge#1,
/// l5merge#2, l5merge#3, l5still#2 and l5still#4, with round seven's l6reference#1, l6reference#2, l6still#1 and
/// l6words#3, round eight's l7merge#1, l7merge#2 and l7still#1, and round nine's l8merge#2; chunk 52's exact search).
/// It orders what pays beside the UTxOs holding the tokens a spend sends, which [`holding`] takes first, by how much of
/// each token they hold, whatever made them (l6words#1). The boxes are every box back from Lovejoin that adds
/// something, a token pool's way back holding its token included. In one strict order:
///
/// 1. nothing 1e1b0647's selection sent as one transaction is refused or sent in parts: where nothing else builds,
///    1e1b0647's own orders run before the CLI's, and that pass is what makes this hold (l5merge#2, l6still#1,
///    l6words#3);
/// 2. as few boxes of unknown making as pay; before the first, 1e1b0647's orders run over everything else too
///    (l7merge#1, l7still#1);
/// 3. then as few boxes as pay;
/// 4. of as many, the most a mix moved;
/// 5. never at the cost of more of the other inputs than the plain choice's build takes (l5merge#3, l5still#2).
///
/// Where a spend's boxes number at most [`EXACT_BOXES`], nearly every wallet's, the merge searches every set of them
/// ([`Exact`], chunk 52): each set costed from what it merges, its tokens' least shared as its change shares them, and
/// beside the other money as the weighed orders take it, all of it where one transaction takes that, else as few of it
/// as pay. So 2 to 4 hold over every set of the boxes, and the plain choice is the set of its level that adds the most.
/// Past that many, the merge goes by orders of boxes each weighed by itself ([`box_weight`], [`Weighed::InOne`]), and 2
/// to 4 hold among the orders tried, within the margins `Weighed` names: near the input limit, beside token boxes, a
/// merge can take a box of unknown making, or one more of them, where a set those orders don't try pays without it, as
/// beside two ways back of one pool, or a token that shares or opens a change output (l8merge#1, l8still#2); and it can
/// take a box more than pays, or a plain box where a mixed one pays.
///
/// After those, the purpose's order and size: where one transaction takes it, all the other money before any box, a
/// funding's last resort (another session's money) after the rest; past that, as few of it as pay, the last resorts
/// after the rest and then among it by size, so one goes in before a box where it pays (l6reference#1, l6words#2). One
/// box that pays alone goes by [`Purpose`]'s order, and among boxes it ranks alike by this one, before size
/// (l5still#3); a stealth mint and a pool's start keep their own order there (l6reference#9).
pub fn box_rank(class: &Class) -> u8 {
    if class.origin == Origin::Mixed {
        0
    } else if class.id.split('+').all(|p| p.starts_with("box:")) {
        1
    } else {
        2
    }
}

/// Which weight the box rule weighs a box by ([`box_weight`]): the one each order it's for says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Weighed<'a> {
    /// In one transaction ([`select_script_inputs`]'s merging): what the box pays beside the change its order makes
    /// anyway, which keeps the tokens given ([`Kept`]). A box of ADA alone weighs its ADA; one holding tokens, its ADA
    /// less what its tokens add to that change's least, none below nothing: change goes 20 kinds of token to an output,
    /// so a token that opens another output costs that output's whole least (chunk 51, l6reference#2, l6still#1,
    /// l7merge#2). Orders a and b take all the other money before any box, so their change keeps the holders' tokens
    /// less those sent and all the other money's; where they build with more than one box whose making the wallet
    /// knows, fewer, the largest by the weight beside a change of ADA alone, go instead where they build (l8merge#2).
    /// Order c, which takes as few of the other money as pay after its boxes, tries the boxes weighed beside a change
    /// of ADA alone and beside a's too.
    ///
    /// Each box is weighed by itself, though the boxes a set takes share their change's outputs, so a set's weight
    /// isn't what it pays. A box's token share of the change's least is about 0.2 ADA where the token joins an output
    /// with room, and up to an output's whole least, about 1.6 ADA, where the change's last output is full; a little
    /// more for a long token name. Boxes of one token, or whose tokens share the output they open, pay that share once;
    /// boxes whose tokens each fit the change's last output can open another together; and c's change keeps only the
    /// other money c takes, so a box there can pay up to an output's least more or less than either weight (chunk 51,
    /// l8merge#3, l8still#1). So the orders can miss the best: near the input limit, beside token boxes, a merge can
    /// take a box of unknown making, or one more of them, where a set the search doesn't try pays without it (rule 2:
    /// two ways back of one pool, or a token that shares or opens a change output; l8merge#1, l8still#2); and it can
    /// take a box more than pays (rule 3), or a plain box where a mixed one pays (rule 4). Only past [`EXACT_BOXES`]
    /// boxes: with as many or fewer, the merge costs every set of them as a whole instead ([`Exact`], chunk 52).
    InOne(&'a Kept),
    /// In a payment's parts (the web wallet's `Worth::apart`): what it adds ([`adds`]: its ADA less its tokens' whole
    /// least), since a part pays all but its fee and leaves the tokens it keeps with just their least. Each box is
    /// weighed alone here too, so boxes whose tokens share one output of a part's change pay up to that output's least,
    /// about 1.6 ADA, more than counted, and a part's plan can take more boxes than it needs, or one of unknown making
    /// where those whose making the wallet knows pay.
    InParts,
}

/// The tokens a spend's change keeps whatever boxes it merges, which [`Weighed::InOne`] weighs a box beside, with the
/// least of each output they go out in, 20 to an output ([`minimum_deposit`]): worked out once a selection, so an ADA
/// change's least isn't made again for every box (chunk 51, l7merge#2, l7merge#4). [`Kept::nothing`]: a change of ADA
/// alone, whose weight is round seven's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kept {
    tokens: Assets,
    /// Each output's tokens and least.
    chunks: Vec<(Assets, u64)>,
    least: u64,
}

impl Kept {
    /// A change keeping `tokens`; one of ADA alone where their least can't be worked out.
    pub fn new(params: &ProtocolParameters, tokens: Assets) -> Self {
        let chunks: Option<Vec<(Assets, u64)>> = token_chunks(&tokens)
            .into_iter()
            .map(|chunk| {
                wallet_minimum_lovelace_with_assets(params, chunk.clone())
                    .ok()
                    .map(|least| (chunk, least))
            })
            .collect();
        match chunks {
            Some(chunks) => Kept {
                least: chunks.iter().map(|(_, least)| *least).sum(),
                tokens,
                chunks,
            },
            None if !tokens.is_empty() => Kept::nothing(params),
            None => Kept {
                tokens,
                chunks: Vec::new(),
                least: 0,
            },
        }
    }

    /// A change of ADA alone.
    pub fn nothing(params: &ProtocolParameters) -> Self {
        Kept::new(params, Assets::new())
    }

    /// What `tokens` add to this change's least, kept with it: its outputs again, each that the tokens leave as it was
    /// read rather than made. None where that can't be worked out.
    fn adds_to(&self, params: &ProtocolParameters, tokens: &Assets) -> Option<u64> {
        let all = self.tokens.merge(tokens.clone()).ok()?;
        let mut least = 0u64;
        for (i, chunk) in token_chunks(&all).into_iter().enumerate() {
            least += match self.chunks.get(i) {
                Some((kept, l)) if *kept == chunk => *l,
                _ => wallet_minimum_lovelace_with_assets(params, chunk).ok()?,
            };
        }
        Some(least.saturating_sub(self.least))
    }
}

/// What the box rule weighs a box by, as `weighed` says ([`Weighed`]), and its [`box_rank`]: what `utxos`, a box's,
/// bring to a spend, none counting less than nothing, nor one whose value can't be read, so a token pool's way back
/// holding its token is weighed as a box too (chunk 51, l5merge#1). Selection weighs [`Weighed::InOne`], the web
/// wallet's payments in parts [`Weighed::InParts`], through this one helper.
pub fn box_weight(
    params: &ProtocolParameters,
    class: &Class,
    utxos: &[&UtxoResponse],
    weighed: Weighed,
) -> (u128, u8) {
    let weight = utxos
        .iter()
        .map(|u| {
            let Some(added) = adds(params, u).ok().and_then(|a| u128::try_from(a).ok()) else {
                return 0;
            };
            match weighed {
                Weighed::InOne(kept) if holds_tokens(u) => {
                    let lovelace = u128::from(lovelace_of(u));
                    if kept.tokens.is_empty() {
                        // Beside an ADA change its tokens add their own least less that change's: what `adds` took
                        // off, less the change's least.
                        (added + u128::from(kept.least)).min(lovelace)
                    } else {
                        assets_of(vec![(*u).clone()])
                            .ok()
                            .and_then(|(_, own)| kept.adds_to(params, &own))
                            .map_or(added, |more| lovelace.saturating_sub(u128::from(more)))
                    }
                }
                _ => added,
            }
        })
        .sum();
    (weight, box_rank(class))
}

/// The boxes, each given as its weight and [`box_rank`], whose making the wallet knows (rank 0 or 1), the largest
/// first, of boxes as large a mixed one first. Positions in `boxes`.
fn known_largest_first(boxes: &[(u128, u8)]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..boxes.len()).filter(|&i| boxes[i].1 < 2).collect();
    order.sort_by_key(|&i| (std::cmp::Reverse(boxes[i].0), boxes[i].1));
    order
}

/// Those of unknown making (rank 2), the largest first.
fn unknown_largest_first(boxes: &[(u128, u8)]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..boxes.len()).filter(|&i| boxes[i].1 == 2).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(boxes[i].0));
    order
}

/// Choices of as many boxes as the first `j` of `order` (positions in `boxes`, the largest first), with more mixed
/// ones (rank 0) among them, the most first: each the largest mixed boxes and the largest others in `order`, so where
/// some choice of `j` with that many mixed boxes pays, that one does. Positions in `boxes`.
fn more_mixed(boxes: &[(u128, u8)], order: &[usize], j: usize) -> Vec<Vec<usize>> {
    let (mixed, others): (Vec<usize>, Vec<usize>) = order.iter().partition(|&&i| boxes[i].1 == 0);
    // The first `j` take `had` mixed boxes and `j - had` others: a choice with more mixed ones takes fewer others.
    let had = order[..j.min(order.len())]
        .iter()
        .filter(|&&i| boxes[i].1 == 0)
        .count();
    (had + 1..=j.min(mixed.len()))
        .rev()
        .filter(|&m| j - m <= others.len())
        .map(|m| mixed[..m].iter().chain(&others[..j - m]).copied().collect())
        .collect()
}

/// The order a payment in parts takes boxes back from Lovejoin in, each given as its weight and [`box_rank`], where
/// the rest leaves `gap` owed, as one transaction merges them by the box rule: first those that add more than `gap`,
/// as few of unknown making as do, the largest, beside as few whose making the wallet knows as do, of those the choice
/// with the most mixed that does; then the others whose making it knows, then those of unknown making, each the
/// largest first. Positions in `boxes`.
pub fn boxes_to_merge(boxes: &[(u128, u8)], gap: u128) -> Vec<usize> {
    let (known, unknown) = (known_largest_first(boxes), unknown_largest_first(boxes));
    let held = |order: &[usize]| -> Vec<u128> {
        std::iter::once(0)
            .chain(order.iter().scan(0u128, |sum, &i| {
                *sum += boxes[i].0;
                Some(*sum)
            }))
            .collect()
    };
    let (known_held, unknown_held) = (held(&known), held(&unknown));
    let all_known = known_held[known.len()];
    let Some(u) = (0..=unknown.len()).find(|&u| all_known + unknown_held[u] > gap) else {
        return known.into_iter().chain(unknown).collect();
    };
    let besides = unknown_held[u];
    let k = (0..=known.len())
        .find(|&k| besides + known_held[k] > gap)
        .unwrap_or(known.len());
    let sum = |chosen: &[usize]| chosen.iter().map(|&i| boxes[i].0).sum::<u128>();
    let first = more_mixed(boxes, &known, k)
        .into_iter()
        .find(|chosen| besides + sum(chosen) > gap)
        .unwrap_or_else(|| known[..k].to_vec());
    let rest = known.iter().copied().filter(|i| !first.contains(i));
    first
        .iter()
        .copied()
        .chain(unknown[..u].iter().copied())
        .chain(rest)
        .chain(unknown[u..].iter().copied())
        .collect()
}

/// What selection knows of the UTxOs it picks from: each one's class, by
/// outpoint, and what the spend is for. [`Histories::default`] knows
/// nothing, and picks as the CLI always has.
#[derive(Debug, Clone, Default)]
pub struct Histories {
    classes: BTreeMap<(String, u64), Class>,
    purpose: Purpose,
}

impl Histories {
    /// Nothing known yet, for a spend that's for `purpose`.
    pub fn new(purpose: Purpose) -> Self {
        Histories {
            classes: BTreeMap::new(),
            purpose,
        }
    }

    /// The UTxO `tx_hash#tx_index` is of `class`.
    pub fn with(mut self, tx_hash: &str, tx_index: u64, class: Class) -> Self {
        self.classes.insert((tx_hash.to_string(), tx_index), class);
        self
    }

    /// `utxo`'s class: Unknown when none was given.
    pub fn class_of(&self, utxo: &UtxoResponse) -> Class {
        self.classes
            .get(&(utxo.tx_hash.clone(), utxo.tx_index))
            .cloned()
            .unwrap_or_default()
    }

    /// How much the spend would rather take `utxo`, by its class: lowest
    /// first ([`Purpose`]'s order). The web wallet's payments in parts order
    /// histories by it, after [`Histories::tier_of`], since a part that takes
    /// all its room can't keep them apart; boxes as one transaction merges
    /// them ([`boxes_to_merge`]).
    pub fn rank_of(&self, utxo: &UtxoResponse) -> u8 {
        self.purpose.rank(&self.class_of(utxo))
    }

    /// When the spend merges histories, how late it takes `utxo`, by its
    /// class ([`Purpose`]'s tiers): 0 first, 1 only when nothing else pays
    /// (another session's money, for a funding), 2 last (a box back from
    /// Lovejoin). The web wallet's payments in parts take them in this order,
    /// as one transaction merges them.
    pub fn tier_of(&self, utxo: &UtxoResponse) -> u8 {
        self.purpose.tier(&self.class_of(utxo))
    }

    /// Whether `utxo`, no box back from Lovejoin, is money the spend's purpose takes before a box a mix moved: for a
    /// payment, all of it; for a funding, its own session's money and money received, never another session's, money
    /// made private, change or Unknown money (chunk 52's review, r3#2). The UTxOs holding a token sent go so
    /// ([`holding_by_rule`]).
    pub fn before_boxes(&self, utxo: &UtxoResponse) -> bool {
        let mixed = Class {
            id: String::new(),
            origin: Origin::Mixed,
        };
        self.tier_of(utxo) < 2 && self.rank_of(utxo) < self.purpose.rank(&mixed)
    }

    /// The classes `inputs` merge: each one once, in the order first spent,
    /// when there's more than one; none when they share a history.
    pub fn merged(&self, inputs: &[UtxoResponse]) -> Vec<Class> {
        let mut classes: Vec<Class> = Vec::new();
        for class in inputs.iter().map(|u| self.class_of(u)) {
            if !classes.iter().any(|c| c.id == class.id) {
                classes.push(class);
            }
        }
        if classes.len() > 1 {
            classes
        } else {
            Vec::new()
        }
    }

    /// How many histories a spend of `inputs` ties together, counted as [`Histories::merged`] counts them, but with a
    /// top-up's own session among them: its funding ties that session to whatever it spends, so another session's
    /// money alone ties two (1.9.3's review, F4).
    pub fn ties(&self, inputs: &[UtxoResponse]) -> usize {
        let mut ids: Vec<String> = Vec::new();
        for class in inputs.iter().map(|u| self.class_of(u)) {
            if !ids.contains(&class.id) {
                ids.push(class.id);
            }
        }
        if let Purpose::Fund { session: Some(own) } = &self.purpose
            && !ids.iter().any(|id| id.split('+').any(|part| part == own))
        {
            ids.push(own.clone());
        }
        if ids.len() > 1 { ids.len() } else { 0 }
    }

    /// Whether nothing is known of any of `utxos`.
    fn blind(&self, utxos: &[UtxoResponse]) -> bool {
        utxos
            .iter()
            .all(|u| self.class_of(u).origin == Origin::Unknown)
    }
}

fn lovelace_of(utxo: &UtxoResponse) -> u64 {
    utxo.value.parse::<u64>().unwrap_or(0)
}

fn holds_tokens(utxo: &UtxoResponse) -> bool {
    utxo.asset_list.as_ref().is_some_and(|a| !a.is_empty())
}

/// The outpoints of `utxos` that add less than nothing to a spend ([`adds`]):
/// a stranger's pile of tokens at their least on chain, say. One whose value
/// can't be read keeps its place.
fn less_than_nothing(
    params: &ProtocolParameters,
    utxos: &[UtxoResponse],
) -> BTreeSet<(String, u64)> {
    utxos
        .iter()
        .filter(|u| adds(params, u).is_ok_and(|a| a < 0))
        .map(|u| (u.tx_hash.clone(), u.tx_index))
        .collect()
}

/// Picks as few of `available` as it can, keeping different histories apart
/// when it can (see the section comment above), and hands each choice to
/// `attempt` until one succeeds. Only "not enough" failures move on. Never
/// picked: a UTxO the wallet's evaluator can't take
/// ([`crate::eval::refusal`]: one holding a reference script, which anyone
/// can pay a Seedelf), and one whose tokens would push a total past what one
/// output holds ([`fitting`]). `floor` is the lovelace the spend pays out:
/// inputs holding no more can't pay, and aren't tried.
///
/// First the UTxOs holding the tokens in `needed` ([`holding`]). When nothing
/// is known of any UTxO's history, then pure-ADA UTxOs, largest first, then
/// other token UTxOs, adding one at a time: the CLI's way. Otherwise, in turn:
///
/// 1. one UTxO that pays on its own (a token-bearing one counts), by the
///    purpose's order, among boxes of one rank by [`box_rank`], the smallest
///    first;
/// 2. UTxOs of one class, by the purpose's order, the largest first;
/// 3. merging classes: with tokens sent, their UTxOs and one of another
///    class first; then the boxes back from Lovejoin by the box rule
///    ([`box_rank`]), for every purpose: as few of unknown making as pay,
///    then as few boxes as pay, of as many the most a mix moved, with no more
///    of the other inputs than the plain choice takes. With at most
///    [`EXACT_BOXES`] boxes over every set of them, each costed from what it
///    merges ([`Exact`], chunk 52); past that, among the orders it tries and
///    within the margins it names, each box weighed by what it pays beside
///    the change its order makes anyway. Beside them the other money by the purpose's
///    order, its last resorts after the rest, all of it before any box where
///    one transaction takes that; where that runs into what a transaction
///    can spend (too many inputs), or everything together is short (a UTxO
///    whose tokens need more change than it holds costs more than it adds),
///    the same without the purpose's order, then the boxes first and as few
///    of the other inputs as pay (the largest first, tokens or not, or with
///    UTxOs holding tokens last, for when their tokens make it too large; the
///    last resorts after the rest, then among it by size, chunk 51,
///    l6reference#1); before the first box of unknown making, 1e1b0647's own
///    orders over the rest without any (l7merge#1); where none of that
///    builds, 1e1b0647's own orders over everything, so nothing it sent as
///    one transaction is refused (l6still#1); and at the last the CLI's own
///    order, so nothing the CLI pays is refused.
///
/// `attempt` prices each input at the guessed budgets, as every caller's
/// does ([`ScriptSpend::estimate`]): a choice of more inputs than those let
/// one transaction spend is refused as too many by its count alone, never
/// made (l7merge#3).
///
/// Wherever a step or order takes it (the CLI's too, but not merge orders a
/// and b, which leave it out), a UTxO that adds less than nothing ([`adds`]:
/// its tokens need more change than it holds) comes after everything else,
/// boxes included, everything else keeping its place. So it's spent only for
/// a token it holds that's being sent, or when nothing else pays beside as
/// few boxes: beside a set's boxes it can go in before one more box, as c
/// takes it, but with at most [`EXACT_BOXES`] boxes never with none where a
/// box pays beside the other money (1.9.3's release review, r2#1, r2#4);
/// never refused: a stranger's pile of tokens no longer ties the user's ADA
/// to it as its change's least, nor merges more boxes than a payment needs
/// (chunk 51, r2a#3, l6still#2; `plan_return`'s rule for a session's return,
/// independent review H1, ranked rather than left out).
pub(crate) fn select_script_inputs<T>(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    needed: &Assets,
    floor: u64,
    histories: &Histories,
    mut attempt: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
    let holds_needed = |u: &UtxoResponse| {
        needed.items.iter().any(|want| {
            quantity_in(
                u,
                &hex::encode(want.policy_id),
                &hex::encode(&want.token_name),
            ) > 0
        })
    };
    let evaluable: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| crate::eval::refusal(u).is_none())
        .cloned()
        .collect();
    let (available, _) = fitting(&evaluable, &Assets::new(), holds_needed)?;
    let available = available.as_slice();
    let mandatory = holding(available, needed)?;
    let mut rest: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| !mandatory.iter().any(|m| same_utxo(m, u)))
        .cloned()
        .collect();
    let piles = less_than_nothing(params, available);
    let last = |u: &UtxoResponse| piles.contains(&(u.tx_hash.clone(), u.tx_index));
    if !histories.blind(available) {
        let ruled = holding_by_rule(available, needed, histories)?;
        if ruled.len() == mandatory.len()
            && ruled
                .iter()
                .all(|r| mandatory.iter().any(|m| same_utxo(m, r)))
        {
            return apart(
                params, mandatory, rest, needed, floor, histories, last, attempt,
            );
        }
        // The holders by the box rule, and by how much of each token they hold: the spend that does better by the rule
        // over all its boxes goes, and of two alike there, the one merging fewer histories (chunk 52's review, r3#3:
        // money made private beside the mixed box that paid alone); the rule's holders' where they tie on both, and
        // the others' only where the rule's are refused or do worse, so nothing that built before is refused (chunk 52,
        // l6words#1's code option).
        let spent: RefCell<Vec<UtxoResponse>> = RefCell::new(Vec::new());
        let mut recorded = |inputs: &[UtxoResponse]| {
            let built = attempt(inputs);
            if built.is_ok() {
                *spent.borrow_mut() = inputs.to_vec();
            }
            built
        };
        let beside = |base: &[UtxoResponse]| -> Vec<UtxoResponse> {
            available
                .iter()
                .filter(|u| !base.iter().any(|b| same_utxo(b, u)))
                .cloned()
                .collect()
        };
        let by_rule = apart(
            params,
            ruled.clone(),
            beside(&ruled),
            needed,
            floor,
            histories,
            last,
            &mut recorded,
        );
        let ruled_spent = spent.take();
        let by_quantity = apart(
            params,
            mandatory,
            rest,
            needed,
            floor,
            histories,
            last,
            &mut recorded,
        );
        let quantity_spent = spent.take();
        let key = |spent: &[UtxoResponse]| (box_key(spent, histories), histories.ties(spent));
        return match (by_rule, by_quantity) {
            (Ok(_), Ok(other)) if key(&quantity_spent) < key(&ruled_spent) => Ok(other),
            (Ok(ruled), _) => Ok(ruled),
            (Err(_), other) => other,
        };
    }
    rest.sort_by_key(|u| (last(u), holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
    let mut last_error = None;
    for k in 0..=rest.len() {
        let selected: Vec<UtxoResponse> = mandatory.iter().chain(&rest[..k]).cloned().collect();
        if selected.is_empty() {
            continue;
        }
        match attempt(&selected) {
            Ok(built) => return Ok(built),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => last_error = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or_else(|| SEEDELF_SHORT.into()))
}

/// How many of the boxes holding tokens, and as many of the other UTxOs holding them, [`one_more`] asks alone. Each is
/// a question of its own (its change must carry its tokens), and a wallet can hold hundreds; one holding no more than
/// the spend pays out isn't asked, and counts against neither (chunk 51, l5merge#1); past these, the later steps still
/// find what pays.
const MAX_TOKEN_SINGLES: usize = 12;

/// One choice [`apart`] hands to `attempt`.
enum Tried<T> {
    Built(T),
    /// These inputs don't hold enough.
    Short,
    /// They failed otherwise (too much computation, say).
    Failed,
    /// Not tried: they can't pay what the spend pays out.
    Skipped,
}

/// [`apart`] with one more UTxO: each of `candidates` in turn, by `rank`,
/// the smallest first. One of ADA alone that was short says no smaller one
/// of ADA alone will do, and only [`MAX_TOKEN_SINGLES`] holding tokens are
/// asked of boxes back from Lovejoin (`is_box`) and as many of the rest, so
/// no pile of tokens of the user's own keeps a box that pays alone, a token
/// pool's way back, from being asked; one holding no more than the spend
/// pays out isn't asked, and counts against neither (chunk 51, l5merge#1,
/// l5still#3). Those holding tokens it passes by for the cap go in `passed`.
fn one_more<'a, T, K: Ord>(
    mut candidates: Vec<&'a UtxoResponse>,
    rank: impl Fn(&UtxoResponse) -> K,
    is_box: impl Fn(&UtxoResponse) -> bool,
    try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried<T>,
    passed: &mut Vec<&'a UtxoResponse>,
) -> Option<T> {
    candidates.sort_by_key(|u| (rank(u), lovelace_of(u)));
    let mut short_at: Option<u64> = None;
    let mut token_tries = [0; 2];
    for u in candidates {
        let ada_only = !holds_tokens(u);
        if ada_only && short_at.is_some_and(|at| lovelace_of(u) <= at) {
            continue;
        }
        let tries = &mut token_tries[usize::from(is_box(u))];
        if !ada_only && *tries == MAX_TOKEN_SINGLES {
            passed.push(u);
            continue;
        }
        match try_with(&[u]) {
            Tried::Built(built) => return Some(built),
            Tried::Skipped => {}
            tried => {
                if !ada_only {
                    *tries += 1;
                } else if matches!(tried, Tried::Short) {
                    short_at = short_at.max(Some(lovelace_of(u)));
                }
            }
        }
    }
    None
}

/// How growing one of [`apart`]'s merging orders ended.
enum Grown<T> {
    /// Its first `.1` built.
    Built(T, usize),
    /// Everything in it together is short.
    Short,
    /// The choice of its first `.0` failed otherwise (too much computation,
    /// say): more inputs won't mend it.
    Failed(usize),
}

/// What [`apart`] asks of a choice before it's built: whether it holds more than the spend pays out beside the tokens'
/// own UTxOs (`asked`, of the lovelace it holds besides theirs; `try_with` passes by any other, `Tried::Skipped`), and
/// what each UTxO holds (`value`, read once a selection: chunk 51, l6merge#1).
struct Asked<'f> {
    asked: &'f dyn Fn(u128) -> bool,
    value: &'f dyn Fn(&UtxoResponse) -> u128,
}

/// `order[..k]` for k = `from`, `from` + 1, … until one builds or fails otherwise. The starts that hold too little to be
/// asked aren't handed to `try_with`, which would pass them by: it starts at the first that holds enough (chunk 51,
/// l6merge#1: walking each such start, reading every input's lovelace again, took seconds).
fn grow<'a, T>(
    order: &[&'a UtxoResponse],
    from: usize,
    ask: &Asked,
    try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried<T>,
) -> Grown<T> {
    let mut k = from.max(1);
    if k > order.len() {
        return Grown::Short;
    }
    let mut held: u128 = order[..k].iter().map(|u| (ask.value)(u)).sum();
    while !(ask.asked)(held) {
        if k == order.len() {
            return Grown::Short;
        }
        held += (ask.value)(order[k]);
        k += 1;
    }
    for k in k..=order.len() {
        match try_with(&order[..k]) {
            Tried::Built(built) => return Grown::Built(built, k),
            Tried::Failed => return Grown::Failed(k),
            _ => {}
        }
    }
    Grown::Short
}

/// Where one of [`apart`]'s orders built with the first `j` of `order`'s boxes (positions in `boxes`, each weighed as
/// `weights` has it), its choices of as many boxes with more of them mixed ([`more_mixed`]), the most first: `head`,
/// then the choice, then `tail`, the other inputs the build took after its boxes, one at a time and never more, so a
/// mixed box goes first only where it pays with no more of them (chunk 51, l5merge#3, l5still#2). The first that
/// builds.
fn more_mixed_built<'a, T>(
    head: &[&'a UtxoResponse],
    j: usize,
    tail: &[&'a UtxoResponse],
    (boxes, weights, order): (&[&'a UtxoResponse], &[(u128, u8)], &[usize]),
    ask: &Asked,
    try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried<T>,
) -> Option<T> {
    more_mixed(weights, order, j)
        .into_iter()
        .find_map(|chosen| {
            let order: Vec<&UtxoResponse> = head
                .iter()
                .copied()
                .chain(chosen.iter().map(|&i| boxes[i]))
                .chain(tail.iter().copied())
                .collect();
            match grow(&order, head.len() + j, ask, try_with) {
                Grown::Built(built, _) => Some(built),
                _ => None,
            }
        })
}

/// Where [`apart`]'s order a or b built with `j` boxes whose making the wallet knows, the largest by the weight beside
/// the change it keeps, after `head` (all the other money, and a's boxes of unknown making): the first of fewer, the
/// largest `jj` by the weight beside a change of ADA alone (`boxes`, in that order), that builds after the same `head`,
/// the fewest first, where they're other boxes than the first `jj` by its own weight (`same_first`). So the swap keeps
/// the other inputs and those of unknown making and takes fewer boxes, as c tries both weights at each count (chunk
/// 51, l8merge#2: beside a change whose last output is full, two token boxes that share the output they open pay up to
/// its least more than they weigh). None where none of them builds.
fn fewer_built<'a, T>(
    head: &[&'a UtxoResponse],
    j: usize,
    (boxes, same_first): (&[&'a UtxoResponse], &[bool]),
    grown: &GrownWhole<'a>,
    run: &mut impl FnMut(
        Vec<&'a UtxoResponse>,
        usize,
        Option<Known>,
        &GrownWhole<'a>,
    ) -> Option<Grown<T>>,
) -> Option<T> {
    (1..j).filter(|&jj| !same_first[jj]).find_map(|jj| {
        let order: Vec<&UtxoResponse> = head.iter().chain(&boxes[..jj]).copied().collect();
        let at = Known {
            at: head.len(),
            most: jj,
            follow: false,
            kept: false,
        };
        match run(order, head.len() + jj, Some(at), grown) {
            Some(Grown::Built(built, _)) => Some(built),
            _ => None,
        }
    })
}

/// Where the boxes whose making the wallet knows are in one of [`apart`]'s orders, for a choice of as many with more
/// of them mixed: where they start (`at`), how many it holds there at most (`most`), whether the other inputs it took
/// after them follow them (`follow`, c's orders), and whether they're in the order of their weight beside what the
/// change of a and b keeps (`kept`) or beside a change of ADA alone ([`Weighed::InOne`]).
#[derive(Clone, Copy)]
struct Known {
    at: usize,
    most: usize,
    follow: bool,
    kept: bool,
}

/// Orders [`apart`] grew whole (every UTxO of the `whole` it grows them from), and failed or fell short with: one that
/// starts any of them would end the same way.
struct GrownWhole<'a> {
    orders: RefCell<Vec<Vec<&'a UtxoResponse>>>,
    whole: usize,
}

impl GrownWhole<'_> {
    /// None yet, of orders grown from `whole` UTxOs.
    fn of(whole: usize) -> Self {
        GrownWhole {
            orders: RefCell::new(Vec::new()),
            whole,
        }
    }
}

/// [`apart`]'s runner of one order (its UTxOs, where it grows from, where its boxes are, and the orders grown whole it
/// mustn't start), as given: one lifetime for the orders it grows and keeps.
fn runner<'a, T>(
    run: impl FnMut(Vec<&'a UtxoResponse>, usize, Option<Known>, &GrownWhole<'a>) -> Option<Grown<T>>,
) -> impl FnMut(Vec<&'a UtxoResponse>, usize, Option<Known>, &GrownWhole<'a>) -> Option<Grown<T>> {
    run
}

/// Whether the order made of `parts`, in turn, starts one of `grown`, without making it.
fn starts_grown(grown: &GrownWhole, parts: &[&[&UtxoResponse]]) -> bool {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    grown.orders.borrow().iter().any(|g| {
        g.len() >= len
            && g.iter()
                .zip(parts.iter().flat_map(|p| p.iter()))
                .all(|(x, y)| std::ptr::eq(*x, *y))
    })
}

/// What each start of `order` holds: `held[k]` is `order[..k]`'s lovelace.
fn held_by(order: &[&UtxoResponse], value: &dyn Fn(&UtxoResponse) -> u128) -> Vec<u128> {
    std::iter::once(0)
        .chain(order.iter().scan(0u128, |sum, u| {
            *sum += value(u);
            Some(*sum)
        }))
        .collect()
}

/// Where an order of `parts`, in turn, is first asked with `at` inputs, at or past `too_many_at`, an input count
/// already too many for one transaction: it can only fail there, so it isn't made or grown, but ends as [`apart`]'s
/// `run` would end it: nothing where it starts one of `grown`; else `failed`, and kept in `grown` where it's whole.
/// None where it isn't such an order.
fn ends_too_many<'a, T>(
    parts: &[&[&'a UtxoResponse]],
    at: usize,
    grown: &GrownWhole<'a>,
    too_many_at: Option<usize>,
    failed: &Cell<bool>,
) -> Option<Option<Grown<T>>> {
    if !too_many_at.is_some_and(|many| at >= many) {
        return None;
    }
    if starts_grown(grown, parts) {
        return Some(None);
    }
    failed.set(true);
    if parts.iter().map(|p| p.len()).sum::<usize>() == grown.whole {
        grown
            .orders
            .borrow_mut()
            .push(parts.iter().flat_map(|p| p.iter().copied()).collect());
    }
    Some(Some(Grown::Failed(at)))
}

/// 1e1b0647's own orders over some of [`apart`]'s UTxOs, as it ordered them (chunk 51, l5merge#2, l6still#1): its
/// step 1's singles holding tokens, by the purpose's order, the smallest first; its a and b, every UTxO, the boxes
/// last; and its c, its boxes (those of ADA alone) by size, then the other money, a token pool's way back among it,
/// the largest first or with tokens last.
struct OldOrders<'a> {
    singles: Vec<&'a UtxoResponse>,
    a: Vec<&'a UtxoResponse>,
    b: Vec<&'a UtxoResponse>,
    boxes: Vec<&'a UtxoResponse>,
    rests: Vec<Vec<&'a UtxoResponse>>,
}

impl<'a> OldOrders<'a> {
    /// The same orders without those `out` says: 1e1b0647's own over the rest.
    fn without(&self, out: impl Fn(&UtxoResponse) -> bool) -> Self {
        let keep = |order: &[&'a UtxoResponse]| -> Vec<&'a UtxoResponse> {
            order.iter().copied().filter(|u| !out(u)).collect()
        };
        let mut rests: Vec<Vec<&'a UtxoResponse>> = Vec::new();
        for money in self.rests.iter().map(|m| keep(m)) {
            let same = |r: &Vec<&UtxoResponse>| {
                r.len() == money.len() && r.iter().zip(&money).all(|(x, y)| std::ptr::eq(*x, *y))
            };
            if !rests.iter().any(same) {
                rests.push(money);
            }
        }
        OldOrders {
            singles: keep(&self.singles),
            a: keep(&self.a),
            b: keep(&self.b),
            boxes: keep(&self.boxes),
            rests,
        }
    }
}

/// [`apart`]'s `first_asked`: where an order that starts with `head` UTxOs holding `head_held`, then grows through what
/// `starts` says each start of the rest holds, is first asked, grown from `from`.
type FirstAsked<'s> = dyn Fn(usize, usize, u128, &[u128]) -> usize + 's;

/// What [`apart`]'s pass of 1e1b0647's own orders reads, beside the orders.
struct OldSearch<'s> {
    /// Those holding tokens apart's own step 1 passed by for its cap: of 1e1b0647's singles, only these are asked again.
    passed: &'s [&'s UtxoResponse],
    first_asked: &'s FirstAsked<'s>,
    unpaid: &'s dyn Fn(u128) -> bool,
    value: &'s dyn Fn(&UtxoResponse) -> u128,
    too_many_at: &'s Cell<Option<usize>>,
    failed: &'s Cell<bool>,
}

/// `old`'s orders as 1e1b0647 grew them (pass d of [`apart`]), each by `run`, their whole ones kept apart from the
/// rule's: the singles its step 1 asked, as many as its cap, counting those holding too little to be asked, that
/// apart's step 1 passed by (how they end says nothing of the orders' own, `failed`); its a and b; its c, with its own
/// prune by the fewest boxes that failed alone. The first that builds.
fn old_orders_built<'a, T>(
    old: &OldOrders<'a>,
    search: &OldSearch,
    run: &mut impl FnMut(
        Vec<&'a UtxoResponse>,
        usize,
        Option<Known>,
        &GrownWhole<'a>,
    ) -> Option<Grown<T>>,
) -> Option<T> {
    let grown = GrownWhole::of(old.a.len());
    let asked = old
        .singles
        .iter()
        .take(MAX_TOKEN_SINGLES)
        .filter(|u| search.passed.iter().any(|p| std::ptr::eq(*p, **u)));
    let orders_failed = search.failed.get();
    for &u in asked {
        if let Some(Grown::Built(built, _)) = run(vec![u], 1, None, &grown) {
            return Some(built);
        }
    }
    search.failed.set(orders_failed);
    for order in [&old.a, &old.b] {
        if let Some(Grown::Built(built, _)) = run(order.clone(), 0, None, &grown) {
            return Some(built);
        }
    }
    if old.rests.first().is_none_or(|money| money.is_empty()) {
        return None;
    }
    let rests_held: Vec<Vec<u128>> = old.rests.iter().map(|m| held_by(m, search.value)).collect();
    let boxes_held = held_by(&old.boxes, search.value);
    // The fewest of those boxes that failed alone: as many or more fail too (a count, so a pass never skips one
    // smaller than the fewest that failed; l5merge#2).
    let mut old_fail: Option<usize> = None;
    for (j, &held) in boxes_held.iter().enumerate() {
        for (money, starts) in old.rests.iter().zip(&rests_held) {
            if j > 0 && old_fail.is_some_and(|fewest| j >= fewest) {
                return None;
            }
            if (search.unpaid)(held + starts[money.len()]) {
                continue;
            }
            let at_first = (search.first_asked)(j, j, held, starts);
            let parts: [&[&UtxoResponse]; 2] = [&old.boxes[..j], money];
            let ran = ends_too_many(
                &parts,
                at_first,
                &grown,
                search.too_many_at.get(),
                search.failed,
            )
            .unwrap_or_else(|| {
                let c = old.boxes[..j].iter().chain(money.iter()).copied().collect();
                run(c, j, None, &grown)
            });
            match ran {
                Some(Grown::Built(built, _)) => return Some(built),
                Some(Grown::Failed(at)) if j > 0 && at == j => {
                    old_fail = Some(old_fail.map_or(j, |fewest| fewest.min(j)));
                }
                _ => {}
            }
        }
    }
    None
}

/// How many boxes back from Lovejoin a merge searches every set of (chunk 52): with at most this many, the box rule's
/// merge is exact ([`Exact`]); past it, it goes by the weighed orders, within the margins [`box_rank`] names. At most
/// 4,096 sets, each costed without a build.
pub const EXACT_BOXES: usize = 12;

/// What two choices' fees can differ by, of as many inputs and change outputs, beyond the bytes their costs count
/// ([`Exact`]): [`even`]'s lovelace, with room.
const FEE_ROUNDING: i128 = 8;

/// The bytes a change output's address, the wallet contract's, takes fewer than the base address its least is sized at
/// ([`wallet_minimum_lovelace_with_assets`]): a set's cost counts each of its change's outputs that much larger than
/// it's built, and no address takes fewer bytes than the wallet contract's ([`Exact`]).
const ADDRESS_GAP: i128 = 28;

/// The most the head of a transaction's count of outputs can differ by, in bytes, between two choices ([`Exact`]).
const COUNT_HEAD: i128 = 2;

/// How many bytes more than a set's that a build found too large for one transaction another set's own parts must add,
/// at as many inputs or more, to be too large as well ([`Exact`]): a change's last output holding 2³² lovelace or more
/// takes 4 more than its least sizes it at, and other outputs can take [`COUNT_HEAD`] fewer to count.
const LARGER: i128 = 4 + COUNT_HEAD;

/// A token as a change's cost reads it ([`Around`]): its policy, the bytes its name takes, and how much.
#[derive(Clone, Copy)]
struct Held {
    policy: Hash<28>,
    name: u64,
    amount: u64,
}

/// A token's policy and name.
type TokenKey = (Hash<28>, Vec<u8>);

/// What a change costs a spend beside its lovelace ([`change_cost`]): its outputs' least, the bytes they take, and how
/// many.
type Cost = (u64, u64, usize);

impl Held {
    fn of(a: &Asset) -> Self {
        let length = a.token_name.len() as u64;
        Held {
            policy: a.policy_id,
            name: head_size(length) + length,
            amount: a.amount,
        }
    }
}

fn key_of(a: &Asset) -> TokenKey {
    (a.policy_id, a.token_name.clone())
}

/// The bytes `items`, one output's tokens, add to its value as the ledger encodes it, over a value of ADA alone:
/// [`value_size`]'s `[lovelace, {policy: {name: amount}}]` less the lovelace's own head.
fn held_bytes(items: &[Held]) -> u64 {
    // Each policy, and how many names it holds.
    let mut policies: Vec<(Hash<28>, u64)> = Vec::new();
    let mut names = 0u64;
    for h in items {
        names += h.name + head_size(h.amount);
        match policies.iter_mut().find(|(p, _)| *p == h.policy) {
            Some((_, n)) => *n += 1,
            None => policies.push((h.policy, 1)),
        }
    }
    1 + head_size(policies.len() as u64)
        + policies
            .iter()
            .map(|(_, n)| head_size(28) + 28 + head_size(*n))
            .sum::<u64>()
        + names
}

/// The least of one change output of `items` and the bytes it takes, worked out from `empty`, the least of one of ADA
/// alone, without making it.
fn output_cost(coins_per_byte: u64, empty: u64, items: &[Held]) -> (u64, u64) {
    let least = if items.is_empty() {
        empty
    } else {
        empty.saturating_add(coins_per_byte.saturating_mul(held_bytes(items)))
    };
    (
        least,
        (least / coins_per_byte).saturating_sub(OVERHEAD_COST),
    )
}

/// The least, bytes and outputs of the outputs `items` go out in, 20 kinds to an output ([`token_chunks`]); none where
/// there are none.
fn outputs_cost(coins_per_byte: u64, empty: u64, items: &[Held]) -> (u64, u64, usize) {
    items
        .chunks(MAXIMUM_TOKENS_PER_UTXO as usize)
        .fold((0, 0, 0), |(least, bytes, n), chunk| {
            let (l, b) = output_cost(coins_per_byte, empty, chunk);
            (least.saturating_add(l), bytes.saturating_add(b), n + 1)
        })
}

/// What a change of `tokens` costs a spend beside its lovelace (chunk 52): each output's least, 20 kinds of token to an
/// output as [`minimum_deposit`] has it, the bytes the outputs take, read off those leasts, and how many outputs; one
/// of ADA alone where there are no tokens.
fn change_cost(coins_per_byte: u64, empty: u64, tokens: &Assets) -> (u64, u64, usize) {
    let items: Vec<Held> = tokens.items.iter().map(Held::of).collect();
    if items.is_empty() {
        let (least, bytes) = output_cost(coins_per_byte, empty, &[]);
        return (least, bytes, 1);
    }
    outputs_cost(coins_per_byte, empty, &items)
}

/// A change's tokens around a set's, as the inputs bring them (chunk 52): those `before` the set's and those `after`.
/// The change is `before`, then the set's own kinds new to it, then `after`'s new to both, each kind's amounts merged
/// where it first comes, less those sent ([`Assets::separate`]).
struct Around {
    raw: (Assets, Assets),
    /// Laid out once, so a set costs only the output where its tokens meet the others'; None where it can't be (the
    /// tokens sent aren't all before), and every set is costed in full.
    laid: Option<Laid>,
}

/// [`Around`]'s change laid out: `before` with `after`'s kinds it holds merged in, less those sent; `at`, where each
/// kind of it is; `moved`, the kinds a set holding one would move (one after, which then merges into the set's, or one
/// sent whole, which comes back), so such a set is costed in full; the rest `after`; what `before`'s whole outputs
/// cost; and what `after`'s cost from each place it can start in an output (`tails`, as worked out).
struct Laid {
    before: Vec<Held>,
    at: BTreeMap<TokenKey, usize>,
    moved: BTreeSet<TokenKey>,
    after: Vec<Held>,
    whole: (u64, u64, usize),
    tails: Vec<Option<(u64, u64, usize)>>,
}

impl Around {
    fn new(
        before: Assets,
        after: Assets,
        needed: &Assets,
        coins_per_byte: u64,
        empty: u64,
    ) -> Self {
        let laid = (|| -> Option<Laid> {
            let mut items: Vec<(TokenKey, Held)> = before
                .items
                .iter()
                .map(|a| (key_of(a), Held::of(a)))
                .collect();
            let at: BTreeMap<TokenKey, usize> = items
                .iter()
                .enumerate()
                .map(|(i, (k, _))| (k.clone(), i))
                .collect();
            let (mut moved, mut rest) = (BTreeSet::new(), Vec::new());
            for a in &after.items {
                match at.get(&key_of(a)) {
                    Some(&i) => items[i].1.amount = items[i].1.amount.checked_add(a.amount)?,
                    None => {
                        moved.insert(key_of(a));
                        rest.push(Held::of(a));
                    }
                }
            }
            for n in &needed.items {
                let i = *at.get(&key_of(n))?;
                items[i].1.amount = items[i].1.amount.checked_sub(n.amount)?;
            }
            for (k, h) in &items {
                if h.amount == 0 {
                    moved.insert(k.clone());
                }
            }
            items.retain(|(_, h)| h.amount > 0);
            let at = items
                .iter()
                .enumerate()
                .map(|(i, (k, _))| (k.clone(), i))
                .collect();
            let before: Vec<Held> = items.into_iter().map(|(_, h)| h).collect();
            let whole = before.len() - before.len() % MAXIMUM_TOKENS_PER_UTXO as usize;
            Some(Laid {
                whole: outputs_cost(coins_per_byte, empty, &before[..whole]),
                before,
                at,
                moved,
                after: rest,
                tails: vec![None; MAXIMUM_TOKENS_PER_UTXO as usize],
            })
        })();
        Around {
            raw: (before, after),
            laid,
        }
    }
}

impl Laid {
    /// The cost of a change of a set holding `kinds` (each box's, in turn), from the layout: `before`'s whole outputs,
    /// the outputs where its tokens meet the set's and `after`'s, and `after`'s from where it then starts. None where
    /// the set moves a kind (`moved`) or an amount can't be added up: it's costed in full.
    fn cost(
        &mut self,
        kinds: &[&[(TokenKey, Held)]],
        coins_per_byte: u64,
        empty: u64,
    ) -> Option<(u64, u64, usize)> {
        let mut bumps: Vec<(usize, u64)> = Vec::new();
        let mut new: Vec<(&TokenKey, Held)> = Vec::new();
        for (key, held) in kinds.iter().flat_map(|k| k.iter()) {
            if self.moved.contains(key) {
                return None;
            }
            if let Some(&i) = self.at.get(key) {
                match bumps.iter_mut().find(|(j, _)| *j == i) {
                    Some((_, amount)) => *amount = amount.checked_add(held.amount)?,
                    None => bumps.push((i, held.amount)),
                }
            } else if let Some((_, h)) = new.iter_mut().find(|(k, _)| *k == key) {
                h.amount = h.amount.checked_add(held.amount)?;
            } else {
                new.push((key, *held));
            }
        }
        let per = MAXIMUM_TOKENS_PER_UTXO as usize;
        let whole = self.before.len() - self.before.len() % per;
        let (mut least, mut bytes, mut outputs) = self.whole;
        let mut meet: Vec<Held> = self.before[whole..].to_vec();
        for (i, add) in bumps {
            let had = self.before[i].amount;
            let now = had.checked_add(add)?;
            if i < whole {
                // Within a whole output only the amount's own bytes change.
                let more = head_size(now) - head_size(had);
                least = least.saturating_add(coins_per_byte.saturating_mul(more));
                bytes = bytes.saturating_add(more);
            } else {
                meet[i - whole].amount = now;
            }
        }
        meet.extend(new.into_iter().map(|(_, h)| h));
        let phase = ((per - meet.len() % per) % per).min(self.after.len());
        meet.extend_from_slice(&self.after[..phase]);
        let tail = match self.tails[phase] {
            Some(tail) => tail,
            None => {
                let tail = outputs_cost(coins_per_byte, empty, &self.after[phase..]);
                self.tails[phase] = Some(tail);
                tail
            }
        };
        for (l, b, n) in [outputs_cost(coins_per_byte, empty, &meet), tail] {
            least = least.saturating_add(l);
            bytes = bytes.saturating_add(b);
            outputs += n;
        }
        if outputs == 0 {
            let (least, bytes) = output_cost(coins_per_byte, empty, &[]);
            return Some((least, bytes, 1));
        }
        Some((least, bytes, outputs))
    }
}

/// `all` with `more` merged in, as [`Assets::merge`] merges them, kept with where each kind is.
fn merge_into(all: &mut (Vec<Asset>, BTreeMap<TokenKey, usize>), more: &Assets) -> Option<()> {
    for a in &more.items {
        match all.1.get(&key_of(a)) {
            Some(&i) => all.0[i].amount = all.0[i].amount.checked_add(a.amount)?,
            None => {
                all.1.insert(key_of(a), all.0.len());
                all.0.push(a.clone());
            }
        }
    }
    Some(())
}

/// One set of the boxes [`Exact`] searches, by its mask: what its boxes hold, and how the box rule counts them.
#[derive(Clone, Copy, Default)]
struct BoxSet {
    lovelace: u128,
    /// The bytes its outpoints' indexes take past one each.
    index: u64,
    /// Which of its boxes hold tokens.
    tokens: u32,
    unknown: u8,
    boxes: u8,
    mixed: u8,
}

/// The other money a set of boxes goes beside in [`Exact`], as the weighed orders take it: all that adds something, by
/// the purpose's order, where one transaction takes that (merge order a); or the first `k` of c's `order`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Beside {
    All,
    Fewest { order: usize, k: usize },
}

/// A level's sets, each with what it adds to a spend beside the other money ([`Exact::candidates`]), the most first:
/// its ADA less its change's least and the bytes of fee its outputs and outpoints take, its mask, how many outputs that
/// change takes, and the bytes its own parts add to the transaction: that change's as built (28 an output fewer than
/// its least sizes them, at a base address) and its outpoints' indexes past one each.
type Candidates = std::rc::Rc<Vec<(i128, u32, usize, i128)>>;

/// The box rule's exact search (chunk 52), where a spend's boxes back from Lovejoin number at most [`EXACT_BOXES`]: every
/// set of them, in the rule's order, each beside the other money as the weighed orders take it, rather than orders of
/// boxes by what each pays alone. Sets come in levels, as few of unknown making, then as few boxes; at a level, the one
/// that pays the most first (the plain choice), then those a mix moved more of, beside no more of the other money.
///
/// Each set is costed from what it merges, without a build: its ADA, beside what the other money and the tokens' own
/// UTxOs bring, less the least its change needs with its tokens among those the change keeps anyway, and less the fee
/// of the bytes that change and its outpoints take. A spend's fee is otherwise the same for every choice of as many
/// inputs and change outputs. So a build that comes up short says that no set worth less, of as many change outputs,
/// pays at that count of inputs, nor at a larger count by more than the computation the inputs it adds cost; and with
/// other outputs, none worth less by more than a few bytes of fee (`epsilon`; 1.9.3's release review, r1#2). Nor
/// does one pay whose worth, its change's outputs counted at their addresses' size ([`ADDRESS_GAP`]), is less than
/// the fee every transaction pays and its inputs' computation. Only a set those bounds can't rule out is built.
struct Exact<'a> {
    fee_per_byte: i128,
    coins_per_byte: u64,
    /// The least of a change of ADA alone.
    empty: u64,
    /// What one more input's guessed computation costs.
    per_input: i128,
    /// The fee every transaction pays whatever its size (`min_fee_b`).
    least_fee: i128,
    /// The fee of [`ADDRESS_GAP`]'s bytes: what each output of a set's change takes in fee less than its cost counts.
    address: i128,
    /// The most that comes to: as many outputs as a change can take, of every kind of token it could keep.
    widest: i128,
    /// How far apart two sets' fees can be beyond what their costs say: the bytes an output's address and lovelace
    /// take as the least sizes it rather than as the change is, and rounding.
    epsilon: i128,
    floor: u128,
    needed: Assets,
    base: usize,
    base_lovelace: u128,
    base_index: u64,
    boxes: Vec<&'a UtxoResponse>,
    box_tokens: Vec<Assets>,
    /// Each box's tokens, as a change's cost reads them.
    box_kinds: Vec<Vec<(TokenKey, Held)>>,
    sets: Vec<BoxSet>,
    /// The sets, by (of unknown making, boxes).
    levels: BTreeMap<(u8, u8), Vec<u32>>,
    history: Vec<&'a UtxoResponse>,
    history_lovelace: u128,
    history_index: u64,
    history_tokens: bool,
    orders: Vec<Vec<&'a UtxoResponse>>,
    /// Where each of c's orders first holds a UTxO `history` leaves out (one that adds less than nothing, after the
    /// rest): the count of its first start that does, past its length where none does.
    beyond: Vec<usize>,
    /// What each start of each order holds, and its outpoints' extra bytes.
    order_lovelace: Vec<Vec<u128>>,
    order_index: Vec<Vec<u64>>,
    /// Which of `arounds` the change of each start of each order keeps.
    order_around: Vec<Vec<usize>>,
    /// Where each of `arounds` is first an order's: the order, and how many of it.
    around_at: Vec<(usize, usize)>,
    /// The tokens a change keeps around a set's: with all the other money (0), or the tokens' own UTxOs' and an
    /// order's first k, each made where it's first needed.
    arounds: BTreeMap<usize, Around>,
    base_tokens: Assets,
    history_tokens_held: Assets,
    costs: BTreeMap<(usize, u32), Option<Cost>>,
    candidates: BTreeMap<(usize, u8, u8), Candidates>,
    /// By count of inputs, the most a set worth that much came up short.
    shorts: Vec<Option<i128>>,
    /// The same by change outputs and count of inputs: of as many outputs, two sets' fees differ by what their costs
    /// count alone, rounding aside, so one worth less is short too (r1#2).
    shorts_at: BTreeMap<(usize, usize), i128>,
    /// Builds already short, by count, worth and change outputs: another alike ends the same way.
    tried: BTreeSet<(usize, i128, usize)>,
    /// Counts of inputs, and the bytes a set's own parts added ([`Candidates`]), a build failed at otherwise (too
    /// large): as many inputs or more, whose parts add [`LARGER`] bytes more or past it, fail too, whatever their
    /// outputs (r1#1).
    large: Vec<(usize, i128)>,
}

impl<'a> Exact<'a> {
    /// The search over `boxes` (each with its [`box_rank`] as the merge weighs it), beside `base`, the tokens' own
    /// UTxOs, and the other money `history` (all of it, by the purpose's order) or c's `orders`. None where a value
    /// can't be read, or there are too many boxes: the weighed orders go instead.
    #[allow(clippy::too_many_arguments)]
    fn new(
        params: &ProtocolParameters,
        base: &[UtxoResponse],
        needed: &Assets,
        floor: u64,
        boxes: &[&'a UtxoResponse],
        ranks: &[u8],
        history: &[&'a UtxoResponse],
        orders: &[&Vec<&'a UtxoResponse>],
        value: &dyn Fn(&UtxoResponse) -> u128,
    ) -> Option<Self> {
        if boxes.len() > EXACT_BOXES || params.coins_per_utxo_size == 0 {
            return None;
        }
        let tokens_of = |u: &UtxoResponse| -> Option<Assets> {
            if holds_tokens(u) {
                assets_of(vec![u.clone()]).ok().map(|(_, t)| t)
            } else {
                Some(Assets::new())
            }
        };
        let index = |u: &UtxoResponse| head_size(u.tx_index) - 1;
        let merged = |all: Assets, more: &[&UtxoResponse]| -> Option<Assets> {
            more.iter()
                .filter(|u| holds_tokens(u))
                .try_fold(all, |all, u| all.merge(tokens_of(u)?).ok())
        };
        let base_tokens = assets_of(base.to_vec()).ok()?.1;
        let box_tokens: Vec<Assets> = boxes.iter().map(|u| tokens_of(u)).collect::<Option<_>>()?;
        let mut sets = vec![BoxSet::default(); 1 << boxes.len()];
        let mut levels: BTreeMap<(u8, u8), Vec<u32>> = BTreeMap::new();
        levels.entry((0, 0)).or_default().push(0);
        for mask in 1..sets.len() {
            let i = mask.trailing_zeros() as usize;
            let had = sets[mask & (mask - 1)];
            let set = BoxSet {
                lovelace: had.lovelace + value(boxes[i]),
                index: had.index + index(boxes[i]),
                tokens: had.tokens | (u32::from(!box_tokens[i].is_empty()) << i),
                unknown: had.unknown + u8::from(ranks[i] == 2),
                boxes: had.boxes + 1,
                mixed: had.mixed + u8::from(ranks[i] == 0),
            };
            sets[mask] = set;
            levels
                .entry((set.unknown, set.boxes))
                .or_default()
                .push(mask as u32);
        }
        let (mut order_lovelace, mut order_index, mut order_around) = (vec![], vec![], vec![]);
        // 0: beside all the other money; 1: beside none of it; then each start of an order that takes one more token.
        let mut around_at = vec![(0, 0), (0, 0)];
        for (o, order) in orders.iter().enumerate() {
            let (mut held, mut extra, mut around) = (vec![0u128], vec![0u64], vec![1usize]);
            for (k, u) in order.iter().enumerate() {
                held.push(held.last().copied().unwrap_or(0) + value(u));
                extra.push(extra.last().copied().unwrap_or(0) + index(u));
                if holds_tokens(u) {
                    around_at.push((o, k + 1));
                }
                around.push(if holds_tokens(u) {
                    around_at.len() - 1
                } else {
                    around.last().copied().unwrap_or(1)
                });
            }
            order_lovelace.push(held);
            order_index.push(extra);
            order_around.push(around);
        }
        // How many outputs a change can take, of every kind of token it could keep.
        let mut kinds: BTreeSet<TokenKey> = base_tokens.items.iter().map(key_of).collect();
        for t in box_tokens.iter().chain(
            orders
                .iter()
                .flat_map(|o| o.iter())
                .filter(|u| holds_tokens(u))
                .filter_map(|u| tokens_of(u))
                .collect::<Vec<_>>()
                .iter(),
        ) {
            kinds.extend(t.items.iter().map(key_of));
        }
        let outputs = kinds.len().div_ceil(MAXIMUM_TOKENS_PER_UTXO as usize) as i128 + 1;
        let in_history: BTreeSet<*const UtxoResponse> =
            history.iter().map(|u| *u as *const UtxoResponse).collect();
        let beyond = orders
            .iter()
            .map(|o| {
                o.iter()
                    .position(|u| !in_history.contains(&(*u as *const UtxoResponse)))
                    .map_or(o.len() + 1, |at| at + 1)
            })
            .collect();
        let history_tokens_held = merged(Assets::new(), history)?;
        let box_kinds = box_tokens
            .iter()
            .map(|t| t.items.iter().map(|a| (key_of(a), Held::of(a))).collect())
            .collect();
        let fee_per_byte = i128::from(params.min_fee_a);
        let empty = wallet_minimum_lovelace_with_assets(params, Assets::new()).ok()?;
        let compute = computation_fee(params, SPEND_BUDGET_GUESS.mem, SPEND_BUDGET_GUESS.steps);
        Some(Exact {
            fee_per_byte,
            coins_per_byte: params.coins_per_utxo_size,
            empty,
            per_input: i128::from(compute),
            least_fee: i128::from(params.min_fee_b),
            address: fee_per_byte * ADDRESS_GAP,
            widest: fee_per_byte * ADDRESS_GAP * outputs,
            epsilon: fee_per_byte * (32 * outputs + 16) + FEE_ROUNDING,
            floor: u128::from(floor),
            needed: needed.clone(),
            base: base.len(),
            base_lovelace: base.iter().map(|u| u128::from(lovelace_of(u))).sum(),
            base_index: base.iter().map(index).sum(),
            boxes: boxes.to_vec(),
            box_tokens,
            box_kinds,
            sets,
            levels,
            history: history.to_vec(),
            history_lovelace: history.iter().map(|u| value(u)).sum(),
            history_index: history.iter().map(|u| index(u)).sum(),
            history_tokens: history.iter().any(|u| holds_tokens(u)),
            orders: orders.iter().map(|o| o.to_vec()).collect(),
            beyond,
            order_lovelace,
            order_index,
            order_around,
            around_at,
            arounds: BTreeMap::new(),
            base_tokens,
            history_tokens_held,
            costs: BTreeMap::new(),
            candidates: BTreeMap::new(),
            shorts: vec![None; GUESSED_MOST_INPUTS + 1],
            shorts_at: BTreeMap::new(),
            tried: BTreeSet::new(),
            large: Vec::new(),
        })
    }

    /// Whether any box is of unknown making.
    fn has_unknown(&self) -> bool {
        self.levels.keys().any(|(u, _)| *u > 0)
    }

    /// `around`'s tokens, made where first needed: beside all the other money, the tokens' own UTxOs' and all of its
    /// (0); beside an order's first k, theirs, and the first k's after the set's.
    fn around(&mut self, around: usize) -> Option<&mut Around> {
        if !self.arounds.contains_key(&around) {
            let mut after = (Vec::new(), BTreeMap::new());
            let before = if around == 0 {
                let mut before = (Vec::new(), BTreeMap::new());
                merge_into(&mut before, &self.base_tokens)?;
                merge_into(&mut before, &self.history_tokens_held)?;
                Assets { items: before.0 }
            } else {
                let (order, k) = self.around_at[around];
                for u in self.orders[order][..k].iter().filter(|u| holds_tokens(u)) {
                    merge_into(&mut after, &assets_of(vec![(*u).clone()]).ok()?.1)?;
                }
                self.base_tokens.clone()
            };
            let made = Around::new(
                before,
                Assets { items: after.0 },
                &self.needed,
                self.coins_per_byte,
                self.empty,
            );
            self.arounds.insert(around, made);
        }
        self.arounds.get_mut(&around)
    }

    /// The least, bytes and outputs of the change of the boxes in `tokens` between `around`'s tokens. None where the
    /// tokens can't be added up or don't hold those sent.
    fn cost(&mut self, around: usize, tokens: u32) -> Option<(u64, u64, usize)> {
        if let Some(cost) = self.costs.get(&(around, tokens)) {
            return *cost;
        }
        let made = self.around(around).is_some();
        let Exact {
            arounds,
            box_kinds,
            box_tokens,
            needed,
            coins_per_byte,
            empty,
            costs,
            ..
        } = self;
        let picked = (0..box_kinds.len()).filter(|i| tokens & (1 << i) != 0);
        let cost = arounds.get_mut(&around).filter(|_| made).and_then(|a| {
            let kinds: Vec<&[(TokenKey, Held)]> =
                picked.clone().map(|i| box_kinds[i].as_slice()).collect();
            if let Some(fast) = a
                .laid
                .as_mut()
                .and_then(|l| l.cost(&kinds, *coins_per_byte, *empty))
            {
                return Some(fast);
            }
            // In full, as the build adds them up.
            let (before, after) = &a.raw;
            picked
                .clone()
                .try_fold(before.clone(), |all, i| {
                    all.merge(box_tokens[i].clone()).ok()
                })
                .and_then(|all| all.merge(after.clone()).ok())
                .and_then(|all| all.separate(needed.clone()).ok())
                .map(|change| change_cost(*coins_per_byte, *empty, &change))
        });
        costs.insert((around, tokens), cost);
        cost
    }

    /// The level's sets beside `around`'s change, what each adds ([`Candidates`]) the most first, of as much the most
    /// a mix moved first, then the boxes first in the order they were given (a's weighed order). A set whose change
    /// can't be worked out isn't one.
    fn candidates(&mut self, around: usize, unknown: u8, boxes: u8) -> Candidates {
        if let Some(c) = self.candidates.get(&(around, unknown, boxes)) {
            return c.clone();
        }
        let masks = self
            .levels
            .get(&(unknown, boxes))
            .cloned()
            .unwrap_or_default();
        let mut c: Vec<(i128, u32, usize, i128, u8)> = Vec::with_capacity(masks.len());
        for mask in masks {
            let set = self.sets[mask as usize];
            if let Some((least, bytes, outputs)) = self.cost(around, set.tokens) {
                let fee = self.fee_per_byte * i128::from(bytes + set.index);
                let adds =
                    i128::try_from(set.lovelace).unwrap_or(i128::MAX) - i128::from(least) - fee;
                let size = i128::from(bytes + set.index) - ADDRESS_GAP * outputs as i128;
                c.push((adds, mask, outputs, size, set.mixed));
            }
        }
        c.sort_by_key(|&(adds, mask, _, _, mixed)| {
            (std::cmp::Reverse(adds), std::cmp::Reverse(mixed), mask)
        });
        let c: Candidates =
            std::rc::Rc::new(c.into_iter().map(|(a, m, o, z, _)| (a, m, o, z)).collect());
        self.candidates.insert((around, unknown, boxes), c.clone());
        c
    }

    /// What the other money `beside` holds, its outpoints' extra bytes, how many UTxOs, and which change tokens it
    /// keeps.
    fn money(&self, beside: Beside) -> (u128, u64, usize, usize) {
        match beside {
            Beside::All => (
                self.history_lovelace,
                self.history_index,
                self.history.len(),
                0,
            ),
            Beside::Fewest { order, k } => (
                self.order_lovelace[order][k],
                self.order_index[order][k],
                k,
                self.order_around[order][k],
            ),
        }
    }

    /// The most a set worth that much fell short by at `count` inputs, carried to `count` from fewer by the computation
    /// the inputs between cost: a set worth no more than this, less `epsilon`, can't pay there.
    fn bound(&self, count: usize) -> Option<i128> {
        self.shorts
            .iter()
            .enumerate()
            .take(count + 1)
            .filter_map(|(c, s)| s.map(|s| s + self.per_input * (count - c) as i128))
            .max()
    }

    /// [`Self::bound`] of builds whose change took `outputs` outputs ([`Exact::shorts_at`]): a set of as many outputs
    /// worth no more than this, less [`FEE_ROUNDING`], can't pay at `count`.
    fn bound_at(&self, outputs: usize, count: usize) -> Option<i128> {
        self.shorts_at
            .range((outputs, 0)..=(outputs, count))
            .map(|(&(_, c), &s)| s + self.per_input * (count - c) as i128)
            .max()
    }

    /// Of `cands` (a level's, filtered or not, of `boxes` boxes holding at most `most`) beside `beside`, the first that
    /// builds, the most it adds first, passing by each the bounds rule out. Err with whether one was too many for one
    /// transaction: more inputs won't mend it.
    #[allow(clippy::too_many_arguments)]
    fn first_built<T>(
        &mut self,
        cands: &[(i128, u32, usize, i128)],
        beside: Beside,
        (boxes, most): (u8, u128),
        run: &mut impl FnMut(
            Vec<&'a UtxoResponse>,
            usize,
            Option<Known>,
            &GrownWhole<'a>,
        ) -> Option<Grown<T>>,
        grown: &GrownWhole<'a>,
        too_many_at: &Cell<Option<usize>>,
    ) -> Result<(u32, T), bool> {
        let (held, index, k, _) = self.money(beside);
        let extra = k + usize::from(boxes);
        let count = self.base + extra;
        if count > GUESSED_MOST_INPUTS || too_many_at.get().is_some_and(|at| extra >= at) {
            return Err(true);
        }
        let offset = i128::try_from(self.base_lovelace + held).unwrap_or(i128::MAX)
            - i128::try_from(self.floor).unwrap_or(i128::MAX)
            - self.fee_per_byte * i128::from(self.base_index + index);
        if self.base_lovelace + held + most <= self.floor {
            return Err(false);
        }
        let mut bound = self.bound(count);
        // The least any transaction of `count` inputs pays in fee beyond the bytes a set's cost counts: no set worth
        // less pays, its change's outputs counted at the size their addresses take (r1#2). Those after one are worth
        // no more, so none is worth more than it would be with the most outputs.
        let fee_floor = self.least_fee + self.per_input * count as i128;
        for &(adds, mask, outputs, size) in cands {
            let worth = offset + adds;
            if worth + self.widest < fee_floor || bound.is_some_and(|b| worth <= b - self.epsilon) {
                break;
            }
            // Under that floor with its own outputs, or, of as many change outputs, worth less than one that came up
            // short (1.9.3's release review, r1#2).
            if worth + self.address * (outputs as i128) < fee_floor
                || self
                    .bound_at(outputs, count)
                    .is_some_and(|b| worth <= b - FEE_ROUNDING)
            {
                continue;
            }
            let set = self.sets[mask as usize];
            let size = size + i128::from(self.base_index + index);
            // It can't pay what the spend pays out.
            if self.base_lovelace + held + set.lovelace <= self.floor
                || self.tried.contains(&(count, worth, outputs))
                || self
                    .large
                    .iter()
                    .any(|&(c, z)| count >= c && size >= z + LARGER)
            {
                continue;
            }
            let picked = (0..self.boxes.len())
                .filter(|i| mask & (1 << i) != 0)
                .map(|i| self.boxes[i]);
            let order: Vec<&'a UtxoResponse> = match beside {
                Beside::All => self.history.iter().copied().chain(picked).collect(),
                Beside::Fewest { order, k } => picked
                    .chain(self.orders[order][..k].iter().copied())
                    .collect(),
            };
            let len = order.len();
            match run(order, len, None, grown) {
                Some(Grown::Built(built, _)) => return Ok((mask, built)),
                Some(Grown::Short) => {
                    self.tried.insert((count, worth, outputs));
                    let s = &mut self.shorts[count];
                    *s = Some(s.map_or(worth, |s| s.max(worth)));
                    let at = self.shorts_at.entry((outputs, count)).or_insert(worth);
                    *at = (*at).max(worth);
                    bound = self.bound(count);
                }
                Some(Grown::Failed(_)) => {
                    if too_many_at.get().is_some_and(|at| extra >= at) {
                        return Err(true);
                    }
                    // Too large: as many inputs or more whose own parts add more bytes are too. A set of as many
                    // inputs, worth and outputs can be smaller, so this isn't one tried (r1#1).
                    self.large.push((count, size));
                }
                None => {}
            }
        }
        Err(false)
    }

    /// The first level of `unknown` boxes of unknown making that builds, in the rule's order ([`Exact`]).
    fn search<T>(
        &mut self,
        unknown: std::ops::RangeInclusive<u8>,
        run: &mut impl FnMut(
            Vec<&'a UtxoResponse>,
            usize,
            Option<Known>,
            &GrownWhole<'a>,
        ) -> Option<Grown<T>>,
        grown: &GrownWhole<'a>,
        too_many_at: &Cell<Option<usize>>,
    ) -> Option<T> {
        let levels: Vec<(u8, u8)> = self
            .levels
            .keys()
            .copied()
            .filter(|(u, n)| unknown.contains(u) && *n > 0)
            .collect();
        for (u, n) in levels {
            if self.base + usize::from(n) > GUESSED_MOST_INPUTS {
                continue;
            }
            if let Some(built) = self.level(u, n, run, grown, too_many_at) {
                return Some(built);
            }
        }
        None
    }

    /// The level of `u` boxes of unknown making and `n` in all: its plain choice, the set that adds the most and
    /// builds beside all the other money where one transaction takes that, else beside the fewest of one of c's orders;
    /// then, of as many, the one a mix moved the most of that builds beside the same other money or less (rules 4 and
    /// 5): where the plain choice went beside all of it, beside it and then beside the first k of each of c's orders,
    /// fewer than all of it. None where no set of the level builds.
    fn level<T>(
        &mut self,
        u: u8,
        n: u8,
        run: &mut impl FnMut(
            Vec<&'a UtxoResponse>,
            usize,
            Option<Known>,
            &GrownWhole<'a>,
        ) -> Option<Grown<T>>,
        grown: &GrownWhole<'a>,
        too_many_at: &Cell<Option<usize>>,
    ) -> Option<T> {
        let held = self.levels.get(&(u, n)).map_or(0, |masks| {
            masks
                .iter()
                .map(|&m| self.sets[m as usize].lovelace)
                .max()
                .unwrap_or(0)
        });
        let mut plain: Option<(u32, Beside, T)> = None;
        // Where each of c's orders starts. With all of the other money short beside every set of the level, fewer of
        // it is too, unless some of it holds tokens (whose change can cost more than they add): then only a start that
        // holds a UTxO it leaves out can pay, one that adds less than nothing, which c's orders take after the rest
        // (1.9.3's release review, r2#1). Where a build was too many or too large instead, fewer of it can fit.
        let mut from = vec![0; self.orders.len()];
        // What can't pay what the spend pays out, beside the most a set of the level holds, isn't costed.
        let can = |exact: &Self, beside: Beside| {
            exact.base_lovelace + exact.money(beside).0 + held > exact.floor
        };
        if !self.history.is_empty()
            && self.base + self.history.len() + usize::from(n) <= GUESSED_MOST_INPUTS
            && can(self, Beside::All)
        {
            let cands = self.candidates(0, u, n);
            match self.first_built(&cands, Beside::All, (n, held), run, grown, too_many_at) {
                Ok((mask, built)) => plain = Some((mask, Beside::All, built)),
                // Short, and no build too large at any level: a too-large one before can have passed over every set
                // of this one beside all of it, unbuilt (1.9.3's review, F2).
                Err(false) if !self.history_tokens && self.large.is_empty() => {
                    from.clone_from(&self.beyond)
                }
                Err(_) => {}
            }
        }
        if plain.is_none() {
            'orders: for (order, &start) in from.iter().enumerate() {
                let most = self.orders[order]
                    .len()
                    .min(GUESSED_MOST_INPUTS.saturating_sub(self.base + usize::from(n)));
                for k in start..=most {
                    let beside = Beside::Fewest { order, k };
                    if !can(self, beside) {
                        continue;
                    }
                    let cands = self.candidates(self.order_around[order][k], u, n);
                    match self.first_built(&cands, beside, (n, held), run, grown, too_many_at) {
                        Ok((mask, built)) => {
                            plain = Some((mask, beside, built));
                            break 'orders;
                        }
                        Err(true) => break,
                        Err(false) => {}
                    }
                }
            }
        }
        let (mask, beside, built) = plain?;
        let had = self.sets[mask as usize].mixed;
        let (_, _, _, around) = self.money(beside);
        let cands = self.candidates(around, u, n);
        let most_mixed = cands
            .iter()
            .map(|&(_, m, _, _)| self.sets[m as usize].mixed)
            .max()
            .unwrap_or(0);
        let of = |exact: &Self, cands: &[(i128, u32, usize, i128)], mixed: u8| {
            cands
                .iter()
                .copied()
                .filter(|&(_, m, _, _)| exact.sets[m as usize].mixed == mixed)
                .collect::<Vec<_>>()
        };
        for mixed in (had + 1..=most_mixed).rev() {
            let more = of(self, &cands, mixed);
            if let Ok((_, built)) =
                self.first_built(&more, beside, (n, held), run, grown, too_many_at)
            {
                return Some(built);
            }
            // Where all the other money didn't build, beside fewer of it, where that can pay more (it holds tokens,
            // whose change can cost more than they add, or a build was too large): the first k of each of c's orders,
            // fewer than all of it, so no more of the other inputs than the plain choice takes (1.9.3's release review,
            // r2#3).
            // A build too large at any level counts: one before can have passed over these unbuilt (F2).
            if beside != Beside::All || !(self.history_tokens || !self.large.is_empty()) {
                continue;
            }
            for order in 0..self.orders.len() {
                for k in 0..self.history.len() {
                    let fewer = Beside::Fewest { order, k };
                    if !can(self, fewer) {
                        continue;
                    }
                    let cands = self.candidates(self.order_around[order][k], u, n);
                    let more = of(self, &cands, mixed);
                    match self.first_built(&more, fewer, (n, held), run, grown, too_many_at) {
                        Ok((_, built)) => return Some(built),
                        Err(true) => break,
                        Err(false) => {}
                    }
                }
            }
        }
        Some(built)
    }
}

/// [`select_script_inputs`] with histories known: `base` are the UTxOs
/// holding the tokens sent, `needed`, which every choice spends, and `rest`
/// the others, of which those `last` says add less than nothing come after
/// everything else wherever a step or order takes them (merge orders a and b
/// leave them out).
///
/// `attempt` must price each input at the guessed budgets
/// ([`ScriptSpend::estimate`], [`SPEND_BUDGET_GUESS`] each), as every caller's
/// does: a choice of more inputs than those let one transaction spend
/// ([`GUESSED_MOST_INPUTS`]) is refused as [`TooMany`] by its count alone,
/// as that attempt would refuse it, without being made (chunk 51, l7merge#3).
/// An attempt that measured real budgets would lose those choices.
#[allow(clippy::too_many_arguments)]
fn apart<T>(
    params: &ProtocolParameters,
    base: Vec<UtxoResponse>,
    rest: Vec<UtxoResponse>,
    needed: &Assets,
    floor: u64,
    histories: &Histories,
    last: impl Fn(&UtxoResponse) -> bool,
    mut attempt: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
    let purpose = &histories.purpose;
    let class = |u: &UtxoResponse| histories.class_of(u);
    // The totals here are only compared, so in u128: a lying index's lovelace
    // can pass a u64 together, and the store's module traps on an overflow
    // (1.7.0's release review, x-overflow#0). The spend refuses it in words.
    // The search's tries read each of `rest`'s once (chunk 51, l6merge#1: they
    // read every input's again on each choice they tried; the sorts below
    // still read theirs); a UTxO is known by where it sits in `rest`.
    let values: Vec<u128> = rest.iter().map(|u| u128::from(lovelace_of(u))).collect();
    let size = std::mem::size_of::<UtxoResponse>().max(1);
    let lovelace_in = |u: &UtxoResponse| -> u128 {
        let at = (u as *const UtxoResponse)
            .addr()
            .wrapping_sub(rest.as_ptr().addr())
            / size;
        match rest.get(at) {
            Some(r) if std::ptr::eq(r, u) => values[at],
            _ => u128::from(lovelace_of(u)),
        }
    };
    let base_lovelace: u128 = base.iter().map(|u| u128::from(lovelace_of(u))).sum();
    let base_classes: Vec<String> = base.iter().map(|u| class(u).id).collect();
    // Money that adds no history to what the tokens sent bring.
    let joins_base = |u: &UtxoResponse| base.is_empty() || base_classes.contains(&class(u).id);
    let tier = |u: &UtxoResponse| purpose.tier(&class(u));
    // A box back from Lovejoin that adds something, a token pool's way back holding its token included (chunk 51,
    // l5merge#1); one that adds less than nothing goes after everything, as any such UTxO does (r2a#3). Those `holding`
    // took for a token the spend sends are in `base`, not boxes here (l6words#1, l7words#8); a box holding it that
    // `holding` didn't need is one.
    let is_box = |u: &UtxoResponse| tier(u) == 2 && !last(u);
    // A choice holding no more than this beside the tokens' own UTxOs can't pay what the spend pays out.
    let asked = |held: u128| base_lovelace + held > u128::from(floor);
    let ask = Asked {
        asked: &asked,
        value: &lovelace_in,
    };

    let mut not_enough: Option<anyhow::Error> = None;
    let mut other: Option<anyhow::Error> = None;
    // The fewest UTxOs beside the tokens' that were too many for one transaction (`TooMany`): as many or more are too,
    // since every input's computation is guessed alike, so none is built again (chunk 51, round six: the box rule's
    // orders reach that count often where a payment is too large for one transaction). A choice of more inputs than
    // the guessed budgets let one transaction spend is refused so by its count, as the attempt would refuse it, and
    // never made: a payment in parts runs this search over what's left before each part, and its orders' first starts
    // that pay hold hundreds (l7merge#3).
    let too_many_at: Cell<Option<usize>> = Cell::new(None);
    let mut try_with = |extra: &[&UtxoResponse]| -> Tried<T> {
        let lovelace = extra.iter().map(|u| lovelace_in(u)).sum::<u128>();
        if !asked(lovelace) || (base.is_empty() && extra.is_empty()) {
            return Tried::Skipped;
        }
        if too_many_at.get().is_some_and(|at| extra.len() >= at) {
            return Tried::Failed;
        }
        let count = base.len() + extra.len();
        let tried = if count > GUESSED_MOST_INPUTS {
            Err(TooMany(count).into())
        } else {
            let selected: Vec<UtxoResponse> = base
                .iter()
                .cloned()
                .chain(extra.iter().map(|u| (*u).clone()))
                .collect();
            attempt(&selected)
        };
        match tried {
            Ok(built) => Tried::Built(built),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => {
                not_enough = Some(e);
                Tried::Short
            }
            Err(e) => {
                if is_too_many(&e) {
                    let at = too_many_at
                        .get()
                        .map_or(extra.len(), |at| at.min(extra.len()));
                    too_many_at.set(Some(at));
                }
                other = Some(e);
                Tried::Failed
            }
        }
    };

    // The tokens' own UTxOs, alone.
    if let Tried::Built(built) = try_with(&[]) {
        return Ok(built);
    }

    // 1. One more UTxO: by the purpose's order, the smallest first; one that
    // adds less than nothing last, here and wherever a step or order below
    // takes it (merge orders a and b leave it out; chunk 51, l7still#3).
    // Among boxes the purpose ranks alike, one a mix moved, then a plain one,
    // then one of unknown making, as merging and the escape hatch take them;
    // a stealth mint keeps its own order (chunk 51, l5still#3).
    let ranked = |u: &UtxoResponse| {
        let c = class(u);
        let made = if matches!(purpose, Purpose::Mint) || purpose.tier(&c) < 2 {
            0
        } else {
            box_rank(&c)
        };
        (last(u), purpose.rank(&c), made)
    };
    let singles: Vec<&UtxoResponse> = rest.iter().filter(|u| joins_base(u)).collect();
    // Those holding tokens this step passes by for its cap, for 1e1b0647's own orders at d.
    let mut passed: Vec<&UtxoResponse> = Vec::new();
    if let Some(built) = one_more(singles.clone(), ranked, is_box, &mut try_with, &mut passed) {
        return Ok(built);
    }

    // 2. UTxOs of one class: the classes by the purpose's order (the most
    // money first among equals), each one's largest first, pure ADA before
    // tokens.
    let mut classes: Vec<(Class, Vec<&UtxoResponse>)> = Vec::new();
    for u in rest.iter().filter(|u| joins_base(u)) {
        let c = class(u);
        match classes.iter_mut().find(|(k, _)| k.id == c.id) {
            Some((_, rows)) => rows.push(u),
            None => classes.push((c, vec![u])),
        }
    }
    classes.sort_by_key(|(c, rows)| {
        let total: u128 = rows.iter().map(|u| lovelace_in(u)).sum();
        (purpose.rank(c), std::cmp::Reverse(total), c.id.clone())
    });
    for (_, rows) in &mut classes {
        rows.sort_by_key(|u| (last(u), holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
        for k in 2..=rows.len() {
            match try_with(&rows[..k]) {
                Tried::Built(built) => return Ok(built),
                // More of this class won't mend it.
                Tried::Failed => break,
                _ => {}
            }
        }
    }

    // 3. Merging. With tokens sent, first their UTxOs and one UTxO of another
    // class, as in 1: two histories before more (independent review L39).
    // Boxes and the purpose's last resorts wait for the merging below.
    if !base.is_empty() {
        let others: Vec<&UtxoResponse> = rest
            .iter()
            // Never one that adds less than nothing: a stranger's pile waits until a box can't pay (1.9.3's review, F3).
            .filter(|u| !joins_base(u) && purpose.tier(&class(u)) == 0 && !last(u))
            .collect();
        if let Some(built) = one_more(others, ranked, is_box, &mut try_with, &mut Vec::new()) {
            return Ok(built);
        }
    }

    // Then the merge, by the box rule ([`box_rank`]): as few boxes of unknown making as pay; then as few boxes as pay;
    // of as many, the most a mix moved, with no more of the other inputs than the plain choice's build; then the
    // purpose's order and size. With at most EXACT_BOXES boxes, over every set of them ([`Exact`], below the orders'
    // setup, chunk 52), each beside the other money as a and c take it. Past that, of the choices the weighed orders
    // try, within the margins the rule names, each box weighed by what it pays beside the change its order makes
    // anyway ([`Weighed::InOne`]). So for u = 0, 1, 2, … boxes of unknown making, the largest u, in turn:
    //
    // a. As the CLI would, but the purpose's last resorts after the rest and the boxes after everything: the other
    //    money that adds something by the purpose's order (independent review L39), then the u, then those whose
    //    making the wallet knows, the largest first, one at a time, as few as pay. Its change keeps what the tokens' own
    //    UTxOs hold beyond what's sent and all the other money's tokens, so its boxes are weighed beside those (chunk
    //    51, l7merge#2). Where it builds with more than one of them, fewer, the largest by the weight beside a change
    //    of ADA alone, go instead where they build beside the same other money and the same u, the fewest first, as c
    //    tries both weights at each count (`fewer_built`, l8merge#2): two token boxes that share the output they open
    //    pay up to its least more than they weigh.
    // b. (u = 0) The same without the purpose's order, pure ADA before tokens, fewer by the other weight too: what
    //    merging paid before a did is paid the same way.
    // c. Where a and b run into what one transaction spends: the u and the largest k of those whose making the wallet
    //    knows, for k = 0, 1, 2, …, then the fewest of the other money that pay, the largest first, tokens or not, or
    //    with UTxOs holding tokens last, for when their tokens make it too large; in each of those the last resorts
    //    after the others, and then among them by size, so a last resort that lets the rest pay in one transaction goes
    //    in before a box, as a takes it (chunk 51, l6reference#1, l6words#2). It takes its boxes before the other
    //    money, so which tokens their change keeps isn't known: the largest k weighed beside a change of ADA alone, then,
    //    where they're other boxes, the largest k weighed beside what a's change keeps (l7merge#2). Boxes that fail alone
    //    fail with more, of either kind.
    //
    // Where one builds with k boxes whose making the wallet knows, the choice of as many with the most a mix moved
    // that builds with the same other inputs, or fewer, goes instead (`more_mixed_built`, the boxes weighed as that
    // order weighed them; chunk 51, l5merge#3, l5still#2).
    //
    // d. 1e1b0647's own orders, so nothing it sent as one transaction is refused or sent in parts: this pass is what
    //    makes rule 1 hold. The rule weighs each box by itself, so beside another holding the same token a box pays
    //    more than its weight says, and a set 1e1b0647 took can be one the rule's orders never try (chunk 51, l5merge#2,
    //    l6still#1, l6words#3). So, where none of those built: the singles holding tokens its step 1 asked that step 1
    //    here passed by for its cap, then its a and b (every UTxO, the boxes last), then its c (the boxes of ADA alone
    //    by size, then the other money, token boxes among it, the largest first or with tokens last), as it grew them,
    //    with its own prune by the fewest boxes that failed alone. Its singles, its a and its c each build what no other
    //    order tries (mint_test's `where_only_1e1b0647s_step_1_asks_a_box_it_still_goes_in_one`,
    //    `where_only_1e1b0647s_a_takes_mixed_boxes_first_it_still_goes_in_one` and
    //    `where_the_box_rules_orders_build_nothing_1e1b0647s_own_still_send_it_in_one`); its b, which no balance found
    //    needs, replays 1e1b0647 whole (l7still#2). The same orders run once before the first box of unknown making
    //    too, over everything else (l7merge#1, l7still#1): a set they build holds none, so it goes before anything the
    //    orders with one or more build, and that is the one choice they change. Past EXACT_BOXES boxes, a set neither
    //    they nor the weighed orders try can still pay without one: near the input limit, beside token boxes, a merge
    //    can then take one (l8merge#1, l8still#2), and past one, with no such pass between one and two, one more of
    //    them than pays. Neither pass promises rules 3 to 5 for what it builds.
    // e. The CLI's own order: never refused what the CLI would pay.
    //
    // Each order is grown one UTxO at a time, from its first start that holds more than the spend pays out. One that
    // runs into what more inputs can't mend (too much computation, too large) is left for the next (independent review
    // M6), and so is one short with everything: a UTxO whose tokens need more change than it holds costs more than it
    // adds, so fewer may pay (chunk 51, r2a#2). Wherever an order takes one (a and b leave it out), a UTxO that adds
    // less than nothing comes after everything else (r2a#3, l7still#3); it's no box. With no box, or none of unknown
    // making, a and b and c are the orders they were before the rule (u = 0 alone).
    let box_list: Vec<&UtxoResponse> = rest.iter().filter(|u| is_box(u)).collect();
    let others: Vec<&UtxoResponse> = rest.iter().filter(|u| !is_box(u)).collect();
    let others_held: u128 = others.iter().map(|u| lovelace_in(u)).sum();
    let mut by_history: Vec<&UtxoResponse> = others.iter().copied().filter(|u| !last(u)).collect();
    by_history.sort_by_key(|u| {
        (
            tier(u),
            !joins_base(u),
            purpose.rank(&class(u)),
            holds_tokens(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let mut by_tier = by_history.clone();
    by_tier.sort_by_key(|u| {
        (
            tier(u),
            !joins_base(u),
            holds_tokens(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    // What a box pays beside: a change of ADA alone, its least worked out once (chunk 51, l7merge#4), and the change a
    // and b make, which keeps the tokens' own UTxOs' tokens less those sent and all of their other money's (l7merge#2);
    // that one only where a box holds tokens, since a box of ADA alone weighs its ADA beside any.
    let nothing = Kept::nothing(params);
    let kept = if box_list.iter().any(|u| holds_tokens(u)) {
        let theirs = assets_of(base.clone()).map_or_else(|_| Assets::new(), |(_, t)| t);
        let left = theirs.separate(needed.clone()).unwrap_or(theirs);
        let money: Vec<UtxoResponse> = by_history
            .iter()
            .filter(|u| holds_tokens(u))
            .map(|u| (*u).clone())
            .collect();
        let held = assets_of(money).map_or_else(|_| Assets::new(), |(_, t)| t);
        Kept::new(params, left.merge(held).unwrap_or(left))
    } else {
        nothing.clone()
    };
    let weigh = |beside: &Kept| -> Vec<(u128, u8)> {
        box_list
            .iter()
            .map(|u| {
                let (weight, rank) = box_weight(params, &class(u), &[u], Weighed::InOne(beside));
                // One that adds no history to what the tokens sent bring is taken first among as many, as a mixed one
                // is.
                (
                    weight,
                    if !base.is_empty() && joins_base(u) {
                        0
                    } else {
                        rank
                    },
                )
            })
            .collect()
    };
    let weights = weigh(&nothing);
    let weights_kept = if kept.tokens.is_empty() {
        weights.clone()
    } else {
        weigh(&kept)
    };
    let of =
        |order: &[usize]| -> Vec<&UtxoResponse> { order.iter().map(|&i| box_list[i]).collect() };
    let (known, unknown) = (
        known_largest_first(&weights),
        unknown_largest_first(&weights),
    );
    let (known_kept, unknown_kept) = (
        known_largest_first(&weights_kept),
        unknown_largest_first(&weights_kept),
    );
    let (known_boxes, unknown_boxes) = (of(&known), of(&unknown));
    let (known_boxes_kept, unknown_boxes_kept) = (of(&known_kept), of(&unknown_kept));
    // What each order's start holds, to pass by those whose whole never gets past what the spend pays out, and to
    // find where each grows from without making it (chunk 51, l6merge#1).
    let (known_held, unknown_held) = (
        held_by(&known_boxes, &lovelace_in),
        held_by(&unknown_boxes, &lovelace_in),
    );
    let (known_held_kept, unknown_held_kept) = (
        held_by(&known_boxes_kept, &lovelace_in),
        held_by(&unknown_boxes_kept, &lovelace_in),
    );
    // Whether the largest k whose making the wallet knows are the same boxes by either weight: c tries them once.
    let mut same_first = vec![true];
    {
        let (mut by_one, mut by_kept) = (vec![false; box_list.len()], vec![false; box_list.len()]);
        // How many boxes are among the first k of one order but not the other's.
        let mut differ = 0usize;
        for (&i, &j) in known.iter().zip(&known_kept) {
            by_one[i] = true;
            differ = if by_kept[i] { differ - 1 } else { differ + 1 };
            by_kept[j] = true;
            differ = if by_one[j] { differ - 1 } else { differ + 1 };
            same_first.push(differ == 0);
        }
    }
    let unpaid = |most: u128| !asked(most);

    // In a and b, the boxes come after everything of tiers 0 and 1 that adds something.
    let ahead = by_history.len();
    let ahead_starts = held_by(&by_history, &lovelace_in);
    let ahead_held: u128 = ahead_starts[ahead];
    let mut largest = others.clone();
    largest.sort_by_key(|u| {
        (
            last(u),
            tier(u),
            !joins_base(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let mut tokens_last = others.clone();
    tokens_last.sort_by_key(|u| {
        (
            last(u),
            holds_tokens(u),
            tier(u),
            !joins_base(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    // The last resorts among the rest, by size (chunk 51, l6reference#1, l6words#2).
    let mut by_size = others.clone();
    by_size.sort_by_key(|u| (last(u), !joins_base(u), std::cmp::Reverse(lovelace_of(u))));
    let mut by_size_tokens_last = others.clone();
    by_size_tokens_last.sort_by_key(|u| {
        (
            last(u),
            holds_tokens(u),
            !joins_base(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let same = |a: &[&UtxoResponse], b: &[&UtxoResponse]| {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| std::ptr::eq(*x, *y))
    };
    let mut rests: Vec<&Vec<&UtxoResponse>> = vec![&largest];
    for money in [&tokens_last, &by_size, &by_size_tokens_last] {
        if !rests.iter().any(|r| same(r, money)) {
            rests.push(money);
        }
    }
    let rests_held: Vec<Vec<u128>> = rests.iter().map(|m| held_by(m, &lovelace_in)).collect();
    let mut blind: Vec<&UtxoResponse> = rest.iter().collect();
    blind.sort_by_key(|u| (last(u), holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));

    let failed = Cell::new(false);
    // Whether an order of every UTxO was short: everything together.
    let short_whole = Cell::new(false);
    let grown = GrownWhole::of(rest.len());
    // Grows `order` from `from`, and where it builds with boxes whose making the wallet knows (`known_at`, where they
    // are), tries a choice of as many with more of them mixed first. None where it starts an order its `whole_ones`
    // grew whole before, which would end the same way.
    let mut run = runner(|order, from, known_at, whole_ones| {
        if whole_ones
            .orders
            .borrow()
            .iter()
            .any(|g| g.len() >= order.len() && same(&g[..order.len()], &order))
        {
            return None;
        }
        let whole = order.len() == whole_ones.whole;
        let ran = match grow(&order, from, &ask, &mut try_with) {
            Grown::Built(built, k) => {
                let more = known_at.and_then(
                    |Known {
                         at,
                         most,
                         follow,
                         kept,
                     }| {
                        let with = k.saturating_sub(at).min(most);
                        let after = &order[at + with..k.max(at + with)];
                        let tail: &[&UtxoResponse] = if follow { after } else { &[] };
                        let (weights, known) = if kept {
                            (&weights_kept, &known_kept)
                        } else {
                            (&weights, &known)
                        };
                        let weighed = (box_list.as_slice(), weights.as_slice(), known.as_slice());
                        more_mixed_built(&order[..at], with, tail, weighed, &ask, &mut try_with)
                    },
                );
                return Some(Grown::Built(more.unwrap_or(built), k));
            }
            Grown::Short => {
                short_whole.set(short_whole.get() || order.len() == rest.len());
                Grown::Short
            }
            Grown::Failed(at) => {
                failed.set(true);
                Grown::Failed(at)
            }
        };
        if whole {
            whole_ones.orders.borrow_mut().push(order);
        }
        Some(ran)
    });
    // Where an order that starts with `head`, holding `head_held`, then grows through what `starts` says each start
    // of the rest holds, is first asked, grown from `from`.
    let first_asked = |from: usize, head: usize, head_held: u128, starts: &[u128]| -> usize {
        if from >= 1 && from <= head && asked(head_held) {
            return from;
        }
        head + starts
            .partition_point(|&h| !asked(head_held + h))
            .max(usize::from(head == 0))
    };
    // d's orders, 1e1b0647's own, made where they're first needed.
    let old_orders = || -> OldOrders {
        let mut singles: Vec<&UtxoResponse> = singles
            .iter()
            .copied()
            .filter(|u| holds_tokens(u))
            .collect();
        singles.sort_by_key(|u| ((last(u), purpose.rank(&class(u))), lovelace_of(u)));
        let mut a: Vec<&UtxoResponse> = rest.iter().collect();
        a.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                purpose.rank(&class(u)),
                holds_tokens(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let mut b: Vec<&UtxoResponse> = rest.iter().collect();
        b.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                holds_tokens(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        // Its c's boxes were those of ADA alone; a token pool's way back was other money, after the rest.
        let old_box = |u: &UtxoResponse| tier(u) == 2 && !holds_tokens(u);
        let mut boxes: Vec<&UtxoResponse> = rest.iter().filter(|u| old_box(u)).collect();
        boxes.sort_by_key(|u| (!joins_base(u), std::cmp::Reverse(lovelace_of(u))));
        let mut largest: Vec<&UtxoResponse> = rest.iter().filter(|u| !old_box(u)).collect();
        largest.sort_by_key(|u| {
            (
                last(u),
                tier(u),
                !joins_base(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let mut tokens_last: Vec<&UtxoResponse> = rest.iter().filter(|u| !old_box(u)).collect();
        tokens_last.sort_by_key(|u| {
            (
                last(u),
                holds_tokens(u),
                tier(u),
                !joins_base(u),
                std::cmp::Reverse(lovelace_of(u)),
            )
        });
        let mut rests = vec![largest];
        if !same(&rests[0], &tokens_last) {
            rests.push(tokens_last);
        }
        OldOrders {
            singles,
            a,
            b,
            boxes,
            rests,
        }
    };
    let mut old: Option<OldOrders> = None;
    let search = OldSearch {
        passed: &passed,
        first_asked: &first_asked,
        unpaid: &unpaid,
        value: &lovelace_in,
        too_many_at: &too_many_at,
        failed: &failed,
    };

    // With at most EXACT_BOXES boxes, the exact search (chunk 52): the other money alone, as a, b and c take it; then
    // every set of the boxes in the rule's order, beside the other money as a and c take it ([`Exact`]); before the
    // first box of unknown making, 1e1b0647's own orders over everything else, as below. Where none builds, d and e.
    // The boxes go in a's weighed order, of unknown making then those whose making the wallet knows, each the largest
    // by its weight beside what a's change keeps: a change takes its tokens 20 kinds to an output in the order the
    // inputs bring them, so each set a would build is built in a's order (1.9.3's release review, r2#2).
    let weighed: Vec<usize> = unknown_kept.iter().chain(&known_kept).copied().collect();
    let exact_boxes: Vec<&UtxoResponse> = weighed.iter().map(|&i| box_list[i]).collect();
    let ranks: Vec<u8> = weighed.iter().map(|&i| weights[i].1).collect();
    let mut exact = Exact::new(
        params,
        &base,
        needed,
        floor,
        &exact_boxes,
        &ranks,
        &by_history,
        &rests,
        &lovelace_in,
    );
    if let Some(exact) = exact.as_mut() {
        // A UTxO that adds less than nothing comes after the boxes here, as wherever an order takes it (r2a#3): c's
        // orders go without theirs alone, and take them beside the boxes below (r2#4).
        let mut alone: Vec<Vec<&UtxoResponse>> = Vec::new();
        for money in [&by_history, &by_tier]
            .into_iter()
            .chain(rests.iter().copied())
        {
            let money: Vec<&UtxoResponse> =
                money.iter().copied().take_while(|u| !last(u)).collect();
            if money.is_empty() || alone.iter().any(|m| same(m, &money)) {
                continue;
            }
            if let Some(Grown::Built(built, _)) = run(money.clone(), 0, None, &grown) {
                return Ok(built);
            }
            alone.push(money);
        }
        if let Some(built) = exact.search(0..=0, &mut run, &grown, &too_many_at) {
            return Ok(built);
        }
        if exact.has_unknown() {
            let unknown_box = |x: &UtxoResponse| unknown_boxes.iter().any(|b| std::ptr::eq(*b, x));
            let without = old.get_or_insert_with(&old_orders).without(unknown_box);
            let held: u128 = without.a.iter().map(|x| lovelace_in(x)).sum();
            if !without.a.is_empty()
                && !unpaid(held)
                && let Some(built) = old_orders_built(&without, &search, &mut run)
            {
                return Ok(built);
            }
            if let Some(built) = exact.search(1..=u8::MAX, &mut run, &grown, &too_many_at) {
                return Ok(built);
            }
        }
    }

    // Past EXACT_BOXES boxes, the weighed orders.
    //
    // The fewest boxes whose making the wallet knows that, beside the u of unknown making, failed alone in c: as
    // many or more fail too, beside as many or more of unknown making.
    let mut known_fail: Option<usize> = None;
    // Whether a's start, its other money and the u, failed alone: with more of unknown making it fails too.
    let mut ahead_fail = false;
    let weighed_to = if exact.is_some() {
        0
    } else {
        unknown.len() + 1
    };
    for u in 0..weighed_to {
        // Before the first box of unknown making, once, where none of u = 0's orders built: 1e1b0647's own orders over
        // everything else (d's, chunk 51, l7merge#1, l7still#1). What they build holds none; a set that neither they
        // nor u = 0's orders try can still pay without one (l8merge#1, l8still#2).
        if u == 1 {
            let unknown_box = |x: &UtxoResponse| unknown_boxes.iter().any(|b| std::ptr::eq(*b, x));
            let without = old.get_or_insert_with(&old_orders).without(unknown_box);
            let held: u128 = without.a.iter().map(|x| lovelace_in(x)).sum();
            if !without.a.is_empty()
                && !unpaid(held)
                && let Some(built) = old_orders_built(&without, &search, &mut run)
            {
                return Ok(built);
            }
        }
        // a, and b with none of unknown making, the boxes weighed beside what their change keeps.
        let besides_kept = &unknown_boxes_kept[..u];
        if !ahead_fail && !unpaid(ahead_held + unknown_held_kept[u] + known_held_kept[known.len()])
        {
            let from = if u == 0 { 0 } else { ahead + u };
            // Where a is first asked: within its other money (u = 0), or beside the u and the first boxes it knows.
            let at_first = if u == 0 && asked(ahead_held) {
                ahead_starts.partition_point(|&h| !asked(h)).max(1)
            } else {
                first_asked(
                    from.max(ahead + u),
                    ahead + u,
                    ahead_held + unknown_held_kept[u],
                    &known_held_kept,
                )
            };
            let parts: [&[&UtxoResponse]; 3] = [&by_history, besides_kept, &known_boxes_kept];
            let ran = ends_too_many(&parts, at_first, &grown, too_many_at.get(), &failed)
                .unwrap_or_else(|| {
                    let a = by_history
                        .iter()
                        .chain(besides_kept)
                        .chain(&known_boxes_kept)
                        .copied()
                        .collect();
                    let at = Known {
                        at: ahead + u,
                        most: known.len(),
                        follow: false,
                        kept: true,
                    };
                    run(a, from, Some(at), &grown)
                });
            match ran {
                // With more than one box whose making the wallet knows, fewer by the other weight where they build
                // (l8merge#2).
                Some(Grown::Built(built, k)) => {
                    let j = k.saturating_sub(ahead + u);
                    let fewer = (j > 1).then(|| {
                        let head: Vec<&UtxoResponse> =
                            by_history.iter().chain(besides_kept).copied().collect();
                        let weighed = (known_boxes.as_slice(), same_first.as_slice());
                        fewer_built(&head, j, weighed, &grown, &mut run)
                    });
                    return Ok(fewer.flatten().unwrap_or(built));
                }
                Some(Grown::Failed(at)) => ahead_fail = (u > 0 && at == ahead + u) || at <= ahead,
                _ => {}
            }
            if u == 0 && !same(&by_history, &by_tier) {
                let b = by_tier.iter().chain(&known_boxes_kept).copied().collect();
                let at = Known {
                    at: ahead,
                    most: known.len(),
                    follow: false,
                    kept: true,
                };
                if let Some(Grown::Built(built, k)) = run(b, 0, Some(at), &grown) {
                    let j = k.saturating_sub(ahead);
                    let weighed = (known_boxes.as_slice(), same_first.as_slice());
                    let fewer =
                        (j > 1).then(|| fewer_built(&by_tier, j, weighed, &grown, &mut run));
                    return Ok(fewer.flatten().unwrap_or(built));
                }
            }
        }
        // c. With no other money, a grew these already: by c's second weight, beside all the change keeps there, and
        // where it built, fewer by c's first (chunk 51, l8still#4).
        if largest.is_empty() {
            continue;
        }
        let besides = &unknown_boxes[..u];
        let most = known_fail.map_or(known.len(), |k| k.saturating_sub(1));
        for k in 0..=most.min(known.len()) {
            let mut alone = false;
            // The largest k beside a change of ADA alone, then, where they're other boxes, beside what a's keeps.
            for (boxes, held, kept) in [
                (&known_boxes[..k], known_held[k], false),
                (&known_boxes_kept[..k], known_held_kept[k], true),
            ] {
                if (kept && same_first[k]) || unpaid(unknown_held[u] + held + others_held) {
                    continue;
                }
                for (money, starts) in rests.iter().zip(&rests_held) {
                    let at_first = first_asked(u + k, u + k, unknown_held[u] + held, starts);
                    let parts: [&[&UtxoResponse]; 3] = [besides, boxes, money];
                    let ran = ends_too_many(&parts, at_first, &grown, too_many_at.get(), &failed)
                        .unwrap_or_else(|| {
                            let c = besides
                                .iter()
                                .chain(boxes)
                                .chain(money.iter())
                                .copied()
                                .collect();
                            let at = Known {
                                at: u,
                                most: k,
                                follow: true,
                                kept,
                            };
                            run(c, u + k, Some(at), &grown)
                        });
                    match ran {
                        Some(Grown::Built(built, _)) => return Ok(built),
                        Some(Grown::Failed(at)) if u + k > 0 && at == u + k => alone = true,
                        _ => {}
                    }
                    if alone {
                        break;
                    }
                }
                if alone {
                    break;
                }
            }
            if alone {
                known_fail = Some(k);
                break;
            }
        }
        // The u alone fail: more of them fail too.
        if known_fail == Some(0) {
            break;
        }
    }

    // d. 1e1b0647's own orders over everything.
    if let Some(built) = old_orders_built(old.get_or_insert_with(&old_orders), &search, &mut run) {
        return Ok(built);
    }

    // e.
    if let Some(Grown::Built(built, _)) = run(blind, 0, None, &grown) {
        return Ok(built);
    }
    drop(run);
    // Short with everything is refused as short, whatever failed besides, as
    // when the search ended there.
    Err(
        match (failed.get() && !short_whole.get(), other, not_enough) {
            (true, Some(e), _) => e,
            (_, _, Some(e)) => e,
            (_, Some(e), None) => e,
            _ => SEEDELF_SHORT.into(),
        },
    )
}

/// Whether `e` says the UTxOs a spend was given can't pay for it, its fee
/// and its change (core's "Not enough ADA" errors): more UTxOs might, and an
/// amount may fit once less is asked.
pub fn is_short(e: &anyhow::Error) -> bool {
    e.downcast_ref::<NotEnough>().is_some()
}

/// The UTxOs a spend that takes all it can takes from `available`: Max, or
/// a payment nothing smaller pays. Those holding `needed` first ([`holding`]:
/// as few as hold enough), then the rest, the most lovelace first, `at_most`
/// in all; never one the wallet's evaluator can't take
/// ([`crate::eval::refusal`]), nor one whose tokens would push a total past
/// what one output holds ([`fitting`]). Returns them, and how many of
/// `available` it left.
pub fn max_inputs(
    available: &[UtxoResponse],
    needed: &Assets,
    at_most: usize,
) -> Result<(Vec<UtxoResponse>, usize)> {
    max_inputs_by(available, needed, at_most, lovelace_of)
}

/// [`max_inputs`], the rest taken by `worth`, the most first: what each adds
/// to a payment. The web wallet's payments in parts rank a UTxO by its ADA
/// less what its own tokens need, so a bundle of tokens holding no more than
/// their least comes after a UTxO of ADA alone, however much ADA it holds;
/// where histories are known, by history first ([`Histories::tier_of`],
/// [`Histories::rank_of`]), then that.
pub fn max_inputs_by<K: Ord>(
    available: &[UtxoResponse],
    needed: &Assets,
    at_most: usize,
    worth: impl Fn(&UtxoResponse) -> K,
) -> Result<(Vec<UtxoResponse>, usize)> {
    max_inputs_apart(available, needed, at_most, worth, None)
}

/// [`max_inputs_by`], where `histories` are given those holding `needed` by the box rule ([`holding_by_rule`], chunk
/// 52, l6words#1's code option), and by how much of each token they hold only where the rule's are more than `at_most`.
/// The web wallet's payments in parts by history pass them; by what each adds, they don't, so what those parts took
/// before is still tried.
pub fn max_inputs_apart<K: Ord>(
    available: &[UtxoResponse],
    needed: &Assets,
    at_most: usize,
    worth: impl Fn(&UtxoResponse) -> K,
    histories: Option<&Histories>,
) -> Result<(Vec<UtxoResponse>, usize)> {
    let holds_needed = |u: &UtxoResponse| {
        needed.items.iter().any(|want| {
            quantity_in(
                u,
                &hex::encode(want.policy_id),
                &hex::encode(&want.token_name),
            ) > 0
        })
    };
    let evaluable: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| crate::eval::refusal(u).is_none())
        .cloned()
        .collect();
    let (fits, _) = fitting(&evaluable, &Assets::new(), holds_needed)?;
    let ruled = match histories {
        Some(h) if !h.blind(&fits) => Some(holding_by_rule(&fits, needed, h)?),
        _ => None,
    };
    let mut taken = match ruled {
        Some(ruled) if ruled.len() <= at_most => ruled,
        _ => holding(&fits, needed)?,
    };
    if taken.len() > at_most {
        bail!(
            "The tokens being sent are spread over more than {at_most} UTxOs, more than one transaction spends: send less of them at once"
        );
    }
    let mut rest: Vec<UtxoResponse> = fits
        .into_iter()
        .filter(|u| !taken.iter().any(|t| same_utxo(t, u)))
        .collect();
    rest.sort_by_key(|u| std::cmp::Reverse(worth(u)));
    rest.truncate(at_most - taken.len());
    taken.extend(rest);
    let left = available.len() - taken.len();
    Ok((taken, left))
}

fn same_utxo(a: &UtxoResponse, b: &UtxoResponse) -> bool {
    a.tx_hash == b.tx_hash && a.tx_index == b.tx_index
}

/// How much of a token a UTxO holds.
fn quantity_in(utxo: &UtxoResponse, policy: &str, name: &str) -> u64 {
    utxo.asset_list
        .iter()
        .flatten()
        .filter(|a| a.policy_id == policy && a.asset_name == name)
        .map(|a| a.quantity.parse::<u64>().unwrap_or(0))
        .sum()
}

/// As few of `available` as together hold `needed`: for each token in turn,
/// the UTxOs holding the most of it, until there's enough, whatever made
/// them: a box back from Lovejoin among them is no box to the box rule, which
/// orders only what pays beside them (chunk 51, l6words#1). Errors naming the
/// token when `available` doesn't hold enough of it.
fn holding(available: &[UtxoResponse], needed: &Assets) -> Result<Vec<UtxoResponse>> {
    let mut picked: Vec<UtxoResponse> = Vec::new();
    for want in &needed.items {
        let policy = hex::encode(want.policy_id);
        let name = hex::encode(&want.token_name);
        let mut have: u64 = picked.iter().map(|u| quantity_in(u, &policy, &name)).sum();
        let mut candidates: Vec<&UtxoResponse> = available
            .iter()
            .filter(|u| quantity_in(u, &policy, &name) > 0)
            .filter(|u| !picked.iter().any(|p| same_utxo(p, u)))
            .collect();
        candidates.sort_by_key(|u| std::cmp::Reverse(quantity_in(u, &policy, &name)));
        for utxo in candidates {
            if have >= want.amount {
                break;
            }
            have = have.saturating_add(quantity_in(utxo, &policy, &name));
            picked.push(utxo.clone());
        }
        if have < want.amount {
            if have == 0 {
                bail!("The Seedelf balance doesn't hold the token {policy}.{name}");
            }
            bail!(
                "The Seedelf balance holds only {have} of the token {policy}.{name}, not {}",
                want.amount
            );
        }
    }
    Ok(picked)
}

/// [`holding`] by the box rule (chunk 52, l6words#1's code option): for each token in turn, the UTxOs holding it that
/// are no box back from Lovejoin and that the spend's purpose takes before a box a mix moved first
/// ([`Histories::before_boxes`]), the most of it first, as `holding` takes them; where those don't hold enough, as few
/// boxes of unknown making as hold the rest, then as few boxes, of as many the most a mix moved, the largest first,
/// beside as few of those first as then hold enough; and only then the purpose's later money holding it, the most first
/// (chunk 52's review, r3#2: a funding's token came from another session's money before a mixed box that paid alone).
/// Then a holder that another token's choice made needless is dropped ([`needless_dropped`], r3#4). Errors as
/// `holding` does.
pub fn holding_by_rule(
    available: &[UtxoResponse],
    needed: &Assets,
    histories: &Histories,
) -> Result<Vec<UtxoResponse>> {
    let mut picked: Vec<UtxoResponse> = Vec::new();
    // Those picked so far, looked up as a set: a payment of many tokens has as many holders (1.9.3's review, F1).
    let mut taken: std::collections::HashSet<(&str, u64)> = std::collections::HashSet::new();
    for want in &needed.items {
        let policy = hex::encode(want.policy_id);
        let name = hex::encode(&want.token_name);
        let held = |u: &UtxoResponse| u128::from(quantity_in(u, &policy, &name));
        let sum = |us: &[&UtxoResponse]| us.iter().map(|u| held(u)).sum::<u128>();
        let have: u128 = picked.iter().map(held).sum();
        let need = u128::from(want.amount).saturating_sub(have);
        if need == 0 {
            continue;
        }
        let holders: Vec<&UtxoResponse> = available
            .iter()
            .filter(|u| held(u) > 0 && !taken.contains(&(u.tx_hash.as_str(), u.tx_index)))
            .collect();
        if sum(&holders) < need {
            return holding(available, needed);
        }
        let (money, boxes): (Vec<&UtxoResponse>, Vec<&UtxoResponse>) =
            holders.into_iter().partition(|u| histories.tier_of(u) < 2);
        let (mut others, mut later): (Vec<&UtxoResponse>, Vec<&UtxoResponse>) =
            money.into_iter().partition(|u| histories.before_boxes(u));
        others.sort_by_key(|u| std::cmp::Reverse(held(u)));
        later.sort_by_key(|u| std::cmp::Reverse(held(u)));
        let rank = |u: &UtxoResponse| box_rank(&histories.class_of(u));
        let largest = |of: &dyn Fn(u8) -> bool| -> Vec<&UtxoResponse> {
            let mut b: Vec<&UtxoResponse> = boxes.iter().copied().filter(|u| of(rank(u))).collect();
            b.sort_by_key(|u| (std::cmp::Reverse(held(u)), rank(u)));
            b
        };
        let mut chosen: Vec<&UtxoResponse> = Vec::new();
        let beside = sum(&others);
        if beside < need {
            let (unknown, known) = (largest(&|r| r == 2), largest(&|r| r < 2));
            // As few of unknown making as hold the rest beside every other holder.
            let all_known = sum(&known);
            let u = (0..=unknown.len())
                .find(|&u| beside + all_known + sum(&unknown[..u]) >= need)
                .unwrap_or(unknown.len());
            // Then as few whose making the wallet knows as hold the rest, the largest; of as many, the most a mix moved.
            let left = need.saturating_sub(beside + sum(&unknown[..u]));
            let j = (0..=known.len())
                .find(|&j| sum(&known[..j]) >= left)
                .unwrap_or(known.len());
            let (mixed, plain) = (largest(&|r| r == 0), largest(&|r| r == 1));
            let most = (0..=j.min(mixed.len()))
                .rev()
                .filter(|&m| j - m <= plain.len())
                .map(|m| [&mixed[..m], &plain[..j - m]].concat())
                .find(|set| sum(set) >= left)
                .unwrap_or_else(|| known[..j].to_vec());
            chosen = [&unknown[..u], &most[..]].concat();
        }
        // Beside the boxes, as few of the others as then hold enough, the purpose's later money last.
        let mut got = sum(&chosen);
        for o in others.into_iter().chain(later) {
            if got >= need {
                break;
            }
            got += held(o);
            chosen.push(o);
        }
        taken.extend(chosen.iter().map(|u| (u.tx_hash.as_str(), u.tx_index)));
        picked.extend(chosen.into_iter().cloned());
    }
    Ok(needless_dropped(picked, needed, histories))
}

/// `picked` less each holder the others make needless, every token of `needed` still held enough without it: a box of
/// unknown making first, then a plain box, then a mixed one, then the rest, the one holding least of them first. Each
/// token's holders are chosen in turn, so a later token's can hold an earlier one's too (chunk 52's review, r3#4: two
/// boxes of unknown making went where one held both). What each holds of each token is read once, and what the rest
/// hold kept as a running total: summing every token over all the others again for each holder took a minute for a
/// payment of 400 tokens in parts (1.9.3's review, F1).
fn needless_dropped(
    picked: Vec<UtxoResponse>,
    needed: &Assets,
    histories: &Histories,
) -> Vec<UtxoResponse> {
    let wants: Vec<(String, String, u128)> = needed
        .items
        .iter()
        .map(|want| {
            (
                hex::encode(want.policy_id),
                hex::encode(&want.token_name),
                u128::from(want.amount),
            )
        })
        .collect();
    let holds: Vec<Vec<u128>> = picked
        .iter()
        .map(|u| {
            wants
                .iter()
                .map(|(policy, name, _)| u128::from(quantity_in(u, policy, name)))
                .collect()
        })
        .collect();
    let mut total: Vec<u128> = (0..wants.len())
        .map(|t| holds.iter().map(|h| h[t]).sum())
        .collect();
    let place = |u: &UtxoResponse| match histories.tier_of(u) {
        2 => 2 - box_rank(&histories.class_of(u)),
        _ => 3,
    };
    let mut order: Vec<usize> = (0..picked.len()).collect();
    order.sort_by_key(|&i| (place(&picked[i]), holds[i].iter().sum::<u128>()));
    let mut keep = vec![true; picked.len()];
    for i in order {
        let needless = wants
            .iter()
            .enumerate()
            .all(|(t, (_, _, amount))| total[t] - holds[i][t] >= *amount);
        if needless {
            keep[i] = false;
            for (t, sum) in total.iter_mut().enumerate() {
                *sum -= holds[i][t];
            }
        }
    }
    picked
        .into_iter()
        .zip(keep)
        .filter_map(|(u, kept)| kept.then_some(u))
        .collect()
}

/// A whole spend's boxes back from Lovejoin as the box rule counts them ([`box_rank`]): how many of unknown making, how
/// many in all, and how many a mix moved, so the smaller is the better.
fn box_key(
    spent: &[UtxoResponse],
    histories: &Histories,
) -> (usize, usize, std::cmp::Reverse<usize>) {
    let ranks: Vec<u8> = spent
        .iter()
        .filter(|u| histories.tier_of(u) == 2)
        .map(|u| box_rank(&histories.class_of(u)))
        .collect();
    (
        ranks.iter().filter(|r| **r == 2).count(),
        ranks.len(),
        std::cmp::Reverse(ranks.iter().filter(|r| **r == 0).count()),
    )
}

/// A seedelf mint, ready to prove, draft and finalize.
pub struct SeedelfMint {
    pub spend: ScriptSpend,
    /// The new token's name: prefix, label, and the smallest input.
    pub token_name: Vec<u8>,
    /// Locked with the token; only removing the seedelf gets it back.
    pub lovelace: u64,
}

/// `util mint`: a new seedelf paid from owned wallet-contract UTxOs. Picks as
/// few of `available` as can pay (see [`mint_from`]).
pub fn mint(
    chain: &Chain,
    available: &[UtxoResponse],
    label: &str,
    seedelf: &Register,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<SeedelfMint> {
    mint_apart(
        chain,
        available,
        &Histories::default(),
        label,
        seedelf,
        change_owner,
        signer,
    )
}

/// [`mint`], keeping the `histories` of `available` apart where it can.
pub fn mint_apart(
    chain: &Chain,
    available: &[UtxoResponse],
    histories: &Histories,
    label: &str,
    seedelf: &Register,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<SeedelfMint> {
    let floor = seedelf_minimum_lovelace(&chain.params)?;
    select_script_inputs(
        &chain.params,
        available,
        &Assets::new(),
        floor,
        histories,
        |inputs| {
            let built = mint_from(chain, inputs, label, seedelf, change_owner, signer)?;
            built.spend.estimate()?;
            Ok(built)
        },
    )
}

/// A seedelf mint spending exactly `inputs`.
///
/// - The token is named after the smallest input (`seedelf_token_name`), as
///   the policy checks, with `label` cut to 15 bytes.
/// - It sits in the contract with the minimum ADA, under `seedelf`, which is
///   used as given: pass a fresh re-randomization.
/// - The rest goes back into the contract under fresh re-randomizations of
///   `change_owner`.
pub fn mint_from(
    chain: &Chain,
    inputs: &[UtxoResponse],
    label: &str,
    seedelf: &Register,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<SeedelfMint> {
    // Points that don't decode, aren't in the prime-order subgroup, or are the
    // identity would lose the seedelf and anything sent to it.
    if !is_payable(seedelf) {
        bail!("The Seedelf's register isn't made of valid points");
    }
    let spend = ScriptSpend::new(chain, inputs, change_owner, signer)?;
    let Chain {
        params,
        network_flag,
        config,
    } = chain;
    let policy = policy_hash(config)?;
    let owned: Vec<Input> = spend.inputs.iter().map(|o| o.input.clone()).collect();
    let token_name = seedelf_token_name(label.to_string(), Some(&owned))?;
    let lovelace = seedelf_minimum_lovelace(params)?;
    let wallet_addr = wallet_contract(*network_flag, config.contract.wallet_contract_hash);
    let output = Output::new(wallet_addr, lovelace)
        .set_inline_datum(seedelf.to_vec()?)
        .add_asset(policy, token_name.clone(), 1)
        .context("Failed To Add The Seedelf")?;
    let token = Asset::new(
        config.contract.seedelf_policy_id.clone(),
        hex::encode(&token_name),
        1,
    )?;
    let spend = spend.output(output, &Assets::new().add(token)?)?.mint(
        token_name.clone(),
        1,
        create_mint_redeemer(label.to_string())?,
    )?;
    Ok(SeedelfMint {
        spend,
        token_name,
        lovelace,
    })
}

// ---------------------------------------------------------------------------
// Transfer: paying seedelfs from the Seedelf balance
//
// Each payment goes into the contract under a fresh re-randomization of the
// recipient's register, as found on chain with their seedelf. The register
// itself is never written back: re-randomizing is what keeps payments to the
// same seedelf unlinkable, and it refuses points outside the prime-order
// subgroup. The rest goes back under fresh re-randomizations of the payer's.
// `transfer_most` is Max: one seedelf is paid everything but the fee and what
// the tokens that stay need (`ScriptSpend::pay_rest`).
// ---------------------------------------------------------------------------

/// A payment to a seedelf.
#[derive(Debug, Clone)]
pub struct Payment {
    /// The recipient's register: the datum of the UTxO holding their seedelf.
    pub register: Register,
    pub lovelace: u64,
    pub tokens: Assets,
}

/// Whether anything paid to `register` is safe: both points decode, lie in
/// the prime-order subgroup, and neither is the identity. An identity public
/// value is `g^0`, so anyone could prove the key and take the payment; an
/// identity generator locks it for good, as does a torsion point.
pub fn is_payable(register: &Register) -> bool {
    let identity = |point: &str| {
        hex::decode(point)
            .is_ok_and(|b| b.len() == 48 && b[0] == 0xc0 && b[1..].iter().all(|&x| x == 0))
    };
    register.is_valid().unwrap_or(false)
        && !identity(&register.generator)
        && !identity(&register.public_value)
}

/// `transfer`: pays each of `payments` from owned wallet-contract UTxOs.
/// Picks as few of `available` as can pay: the UTxOs holding the tokens
/// being sent first, then as in [`mint`].
pub fn transfer(
    chain: &Chain,
    available: &[UtxoResponse],
    payments: &[Payment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    transfer_apart(
        chain,
        available,
        &Histories::default(),
        payments,
        change_owner,
        signer,
    )
}

/// [`transfer`], keeping the `histories` of `available` apart where it can.
pub fn transfer_apart(
    chain: &Chain,
    available: &[UtxoResponse],
    histories: &Histories,
    payments: &[Payment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let outputs = payment_outputs(chain, payments)?;
    let needed = payments
        .iter()
        .try_fold(Assets::new(), |all, p| all.merge(p.tokens.clone()))?;
    select_script_inputs(
        &chain.params,
        available,
        &needed,
        paid_out(&outputs),
        histories,
        |inputs| {
            let spend = paying(chain, inputs, &outputs, change_owner, signer)?;
            spend.estimate()?;
            Ok(spend)
        },
    )
}

/// The lovelace `outputs` carry.
fn paid_out(outputs: &[(Output, Assets)]) -> u64 {
    outputs.iter().map(|(o, _)| o.lovelace).sum()
}

/// A transfer spending exactly `inputs`. They must hold the tokens being
/// sent.
pub fn transfer_from(
    chain: &Chain,
    inputs: &[UtxoResponse],
    payments: &[Payment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let outputs = payment_outputs(chain, payments)?;
    paying(chain, inputs, &outputs, change_owner, signer)
}

/// Max for a transfer: pays the seedelf under `to` everything `inputs` hold
/// but the fee, with `tokens`, spending exactly `inputs` ([`max_inputs`]
/// picks them). The tokens it doesn't send stay in the Seedelf balance under
/// fresh re-randomizations of `change_owner`, with the least ADA they need,
/// and no other ADA stays ([`ScriptSpend::pay_rest`]). So its payment is the
/// most a transfer of `tokens` from `inputs` can pay. `to` must be
/// [`is_payable`], and is re-randomized as every payment is.
pub fn transfer_most(
    chain: &Chain,
    inputs: &[UtxoResponse],
    to: &Register,
    tokens: &Assets,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    ScriptSpend::new(chain, inputs, change_owner, signer)?
        .pay_rest(RestTo::Seedelf(to.clone()), tokens)
}

fn paying(
    chain: &Chain,
    inputs: &[UtxoResponse],
    outputs: &[(Output, Assets)],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    outputs.iter().try_fold(
        ScriptSpend::new(chain, inputs, change_owner, signer)?,
        |spend, (output, tokens)| spend.output(output.clone(), tokens),
    )
}

/// Each payment's outputs, each under a fresh re-randomization of the
/// recipient's register, its tokens `MAXIMUM_TOKENS_PER_UTXO` to an output
/// ([`seedelf_payment`]), and together above its minimum.
fn payment_outputs(chain: &Chain, payments: &[Payment]) -> Result<Vec<(Output, Assets)>> {
    if payments.is_empty() {
        bail!("A transfer pays at least one Seedelf");
    }
    let wallet_addr = wallet_contract(
        chain.network_flag,
        chain.config.contract.wallet_contract_hash,
    );
    let paid = payments
        .iter()
        .map(|payment| {
            if !is_payable(&payment.register) {
                bail!(
                    "That Seedelf's register isn't valid: a payment to it could be locked for good, or taken by anyone"
                );
            }
            if payment.tokens.items.iter().any(|a| a.amount == 0) {
                bail!("A payment can't send none of a token");
            }
            let minimum = minimum_seedelf_payment(&chain.params, &payment.tokens)?;
            if payment.lovelace < minimum {
                bail!(
                    "A payment to a Seedelf{} needs at least {} ADA",
                    if payment.tokens.is_empty() { "" } else { " with these tokens" },
                    ada(minimum)
                );
            }
            seedelf_payment(
                &chain.params,
                &wallet_addr,
                &payment.register,
                payment.lovelace,
                &payment.tokens,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(paid.into_iter().flatten().collect())
}

/// The least lovelace a payment to a seedelf with `tokens` must carry: its
/// contract outputs' under the register, the tokens `MAXIMUM_TOKENS_PER_UTXO`
/// to an output ([`minimum_deposit`]).
pub fn minimum_seedelf_payment(params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
    minimum_deposit(params, tokens)
}

/// Lovelace as ADA, with all six decimals.
fn ada(lovelace: u64) -> String {
    format!("{}.{:06}", lovelace / 1_000_000, lovelace % 1_000_000)
}

// ---------------------------------------------------------------------------
// Withdraw: paying an address from the Seedelf balance, or removing a seedelf
//
// `sweep` pays an address a fixed amount, and the change goes back into the
// contract; `sweep_all` sends everything the inputs hold, less the fee;
// `sweep_most` the most a payment of some tokens can be, the others staying.
// `remove` burns a seedelf, and what its UTxO held goes back into the
// contract, or to an address with `ScriptSpend::change_to`.
// ---------------------------------------------------------------------------

/// Whether a payment can go to `addr`: a Shelley address on this network,
/// as the ledger takes one, whatever its parts. A stake address, a Byron
/// address and another network's can't be paid here. A key address staked by
/// a script (`addr1y…`) is an ordinary payee: only its payment key spends it.
/// A script's address ([`crate::address::is_script_address`]) takes a payment
/// too, with no datum, which some scripts can never spend and some let anyone
/// take, the Seedelf contract's own address among them: the callers say so,
/// the ledger refusing neither (chunk 51, r2a#1; the owner's call of
/// 2026-11-18).
pub fn is_payable_address(addr: &Address, network_flag: bool) -> bool {
    matches!(addr, Address::Shelley(_)) && is_on_correct_network(addr.clone(), network_flag)
}

fn check_address(chain: &Chain, addr: &Address) -> Result<()> {
    check_payable(addr, chain.network_flag)
}

fn check_payable(addr: &Address, network_flag: bool) -> Result<()> {
    if !is_payable_address(addr, network_flag) {
        let network = if network_flag { "preprod" } else { "mainnet" };
        bail!(
            "Payments go to an address on {network}: not a stake, Byron or other network's address"
        );
    }
    Ok(())
}

/// The least lovelace a payment to `to` of exactly `tokens` must carry: its
/// outputs', the tokens `MAXIMUM_TOKENS_PER_UTXO` to an output.
pub fn minimum_address_payment(
    params: &ProtocolParameters,
    to: &Address,
    tokens: &Assets,
) -> Result<u64> {
    let bech32 = to
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode the address: {e}"))?;
    token_chunks(tokens)
        .into_iter()
        .map(|chunk| address_minimum_lovelace_with_assets(params, &bech32, chunk))
        .sum()
}

/// The outputs paying `to` exactly `lovelace` and `tokens`, above their
/// minimum ([`pay_address`]).
fn address_payment(
    chain: &Chain,
    to: &Address,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Vec<(Output, Assets)>> {
    check_address(chain, to)?;
    pay_address(&chain.params, to, lovelace, tokens)
}

/// [`address_payment`] for an address already checked: the tokens
/// `MAXIMUM_TOKENS_PER_UTXO` to an output, every output but the last carrying
/// its minimum and the last the rest, each with the tokens it holds.
fn pay_address(
    params: &ProtocolParameters,
    to: &Address,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Vec<(Output, Assets)>> {
    if tokens.items.iter().any(|a| a.amount == 0) {
        bail!("A payment can't send none of a token");
    }
    let minimum = minimum_address_payment(params, to, tokens)?;
    if lovelace < minimum {
        bail!(
            "A payment to that address{} needs at least {} ADA",
            if tokens.is_empty() {
                ""
            } else {
                " with these tokens"
            },
            ada(minimum)
        );
    }
    let bech32 = to
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode the address: {e}"))?;
    let chunks = token_chunks(tokens);
    let last = chunks.len() - 1;
    let mut remaining = lovelace;
    let mut outputs = Vec::with_capacity(chunks.len());
    for (i, chunk) in chunks.into_iter().enumerate() {
        let amount = if i == last {
            remaining
        } else {
            address_minimum_lovelace_with_assets(params, &bech32, chunk.clone())?
        };
        remaining -= amount;
        let mut output = Output::new(to.clone(), amount);
        for asset in &chunk.items {
            output = output
                .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                .context("Failed To Add An Asset")?;
        }
        outputs.push((output, chunk));
    }
    Ok(outputs)
}

/// `sweep`: pays `to` exactly `lovelace` and `tokens` from owned
/// wallet-contract UTxOs, as few as can pay (the ones holding the tokens
/// first, as for a transfer). The change goes back into the contract under
/// fresh re-randomizations of `change_owner`.
pub fn sweep(
    chain: &Chain,
    available: &[UtxoResponse],
    to: &Address,
    lovelace: u64,
    tokens: &Assets,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let payment = AddressPayment {
        to: to.clone(),
        lovelace,
        tokens: tokens.clone(),
    };
    sweep_many(chain, available, &[payment], change_owner, signer)
}

/// A payment from the Seedelf balance to an address on this network
/// ([`is_payable_address`]).
#[derive(Debug, Clone)]
pub struct AddressPayment {
    pub to: Address,
    pub lovelace: u64,
    pub tokens: Assets,
}

/// [`sweep`] to several: pays each of `payments` from as few owned UTxOs as
/// can pay them all. The outputs, change included, go in a random order
/// ([`ScriptSpend`]).
pub fn sweep_many(
    chain: &Chain,
    available: &[UtxoResponse],
    payments: &[AddressPayment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    sweep_many_apart(
        chain,
        available,
        &Histories::default(),
        payments,
        change_owner,
        signer,
    )
}

/// [`sweep_many`], keeping the `histories` of `available` apart where it can.
pub fn sweep_many_apart(
    chain: &Chain,
    available: &[UtxoResponse],
    histories: &Histories,
    payments: &[AddressPayment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let outputs = address_outputs(chain, payments)?;
    let needed = payments
        .iter()
        .try_fold(Assets::new(), |all, p| all.merge(p.tokens.clone()))?;
    select_script_inputs(
        &chain.params,
        available,
        &needed,
        paid_out(&outputs),
        histories,
        |inputs| {
            let spend = paying(chain, inputs, &outputs, change_owner, signer)?;
            spend.estimate()?;
            Ok(spend)
        },
    )
}

/// Each payment's outputs, to its address and above its minimum
/// ([`address_payment`]).
fn address_outputs(chain: &Chain, payments: &[AddressPayment]) -> Result<Vec<(Output, Assets)>> {
    if payments.is_empty() {
        bail!("A withdrawal pays at least one address");
    }
    let paid = payments
        .iter()
        .map(|p| address_payment(chain, &p.to, p.lovelace, &p.tokens))
        .collect::<Result<Vec<_>>>()?;
    Ok(paid.into_iter().flatten().collect())
}

/// [`sweep_many`] spending exactly `inputs`. They must hold the tokens being
/// sent.
pub fn sweep_many_from(
    chain: &Chain,
    inputs: &[UtxoResponse],
    payments: &[AddressPayment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let outputs = address_outputs(chain, payments)?;
    paying(chain, inputs, &outputs, change_owner, signer)
}

/// [`transfer_most`] to `to`, an address on this network
/// ([`is_payable_address`]): the most a withdrawal of `tokens` can pay from
/// `inputs`, the other tokens staying in the Seedelf balance with the least
/// ADA they need. ([`sweep_all`] sends every token.)
pub fn sweep_most(
    chain: &Chain,
    inputs: &[UtxoResponse],
    to: &Address,
    tokens: &Assets,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    sweep_most_with(chain, inputs, to, tokens, &[], change_owner, signer)
}

/// [`sweep_most`] that pays each of `extra` too, as its own outputs, first:
/// the web wallet's funding in parts, whose first part carries the one-time
/// account's collateral beside the most it can pay.
pub fn sweep_most_with(
    chain: &Chain,
    inputs: &[UtxoResponse],
    to: &Address,
    tokens: &Assets,
    extra: &[AddressPayment],
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let fixed = if extra.is_empty() {
        Vec::new()
    } else {
        address_outputs(chain, extra)?
    };
    fixed
        .into_iter()
        .try_fold(
            ScriptSpend::new(chain, inputs, change_owner, signer)?,
            |spend, (output, tokens)| spend.output(output, &tokens),
        )?
        .pay_rest(RestTo::Address(to.clone()), tokens)
}

/// A sweep spending exactly `inputs`. They must hold the tokens being sent.
pub fn sweep_from(
    chain: &Chain,
    inputs: &[UtxoResponse],
    to: &Address,
    lovelace: u64,
    tokens: &Assets,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    address_payment(chain, to, lovelace, tokens)?
        .into_iter()
        .try_fold(
            ScriptSpend::new(chain, inputs, change_owner, signer)?,
            |spend, (output, tokens)| spend.output(output, &tokens),
        )
}

/// `sweep --all`: everything `inputs` hold, less the fee, to `to`. Tokens go
/// 20 to an output.
pub fn sweep_all(
    chain: &Chain,
    inputs: &[UtxoResponse],
    to: &Address,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    check_address(chain, to)?;
    Ok(ScriptSpend::new(chain, inputs, change_owner, signer)?.change_to(to))
}

/// The seedelf token in `utxo`, by name: it must hold exactly one.
pub fn seedelf_in(chain: &Chain, utxo: &UtxoResponse) -> Result<Vec<u8>> {
    let policy = &chain.config.contract.seedelf_policy_id;
    let held: Vec<&seedelf_koios::koios::Asset> = utxo
        .asset_list
        .iter()
        .flatten()
        .filter(|a| &a.policy_id == policy)
        .collect();
    match held.as_slice() {
        [one] if one.quantity == "1" => {
            hex::decode(&one.asset_name).context("The Seedelf's name isn't hex")
        }
        _ => bail!(
            "UTxO {}#{} doesn't hold exactly one Seedelf",
            utxo.tx_hash,
            utxo.tx_index
        ),
    }
}

/// `remove`: spends the UTxO holding a seedelf and burns the token. What
/// it held, less the fee, goes back into the contract under a fresh
/// re-randomization of `change_owner`, or to an address with
/// [`ScriptSpend::change_to`].
pub fn remove(
    chain: &Chain,
    seedelf_utxo: &UtxoResponse,
    change_owner: &Register,
    signer: Hash<28>,
) -> Result<ScriptSpend> {
    let token_name = seedelf_in(chain, seedelf_utxo)?;
    ScriptSpend::new(
        chain,
        std::slice::from_ref(seedelf_utxo),
        change_owner,
        signer,
    )?
    .mint(token_name, -1, create_mint_redeemer(String::new())?)
}

// ---------------------------------------------------------------------------
// A seedelf mint paid by the Cardano account
//
// The first seedelf is minted before any move-in: the account pays, so the
// seedelf is linked to it openly, but money moved in afterwards looks the
// same as paying anyone's seedelf. (A stealth mint from moved-in money would
// link the account, the seedelf and the change in one chain; see the web
// wallet's privacy.md.) This is the CLI's `create`, with the account's keys
// instead of a browser wallet.
//
// Nothing in the contract is spent, so there are no proofs and no one-time
// key. The collateral is one of the account's own UTxOs, as in the CLI (the
// web wallet's set-aside one, when it has one): this transaction names the
// account anyway. It needn't be ADA-only: the collateral return gives back
// its tokens, which Babbage and later allow.
// ---------------------------------------------------------------------------

/// The least an ADA-only account UTxO should hold to be put up as collateral:
/// 3/2 of any fee a mint pays, plus the minimum the collateral return needs.
const ACCOUNT_COLLATERAL_MINIMUM: u64 = 2_000_000;

/// A seedelf mint paid by the Cardano account, ready to draft and finalize.
#[derive(Clone)]
pub struct AccountMint {
    chain: Chain,
    inputs: Vec<UtxoResponse>,
    collateral: UtxoResponse,
    seedelf: Output,
    redeemer: Vec<u8>,
    change_addr: Address,
    /// A reward withdrawal riding along, patched into every draft.
    staking: Staking,
    /// The slot it stops being valid at, staged in every draft.
    invalid_hereafter: Option<u64>,
    /// The new token's name: prefix, label, and the smallest input.
    pub token_name: Vec<u8>,
    /// Locked with the token; only removing the seedelf gets it back.
    pub lovelace: u64,
}

/// A finished account-paid mint: the unsigned transaction and what it does.
pub struct FinalAccountMint {
    /// Needs a signature from each input's key and the collateral's, and the
    /// stake key's when a withdrawal rides along.
    pub tx: BuiltTransaction,
    pub fee: ScriptFee,
    /// Back to the Cardano account.
    pub change_lovelace: u64,
    pub change_tokens: Assets,
    pub change_outputs: usize,
}

impl AccountMint {
    /// The UTxOs spent, in the order given.
    pub fn inputs(&self) -> &[UtxoResponse] {
        &self.inputs
    }

    /// The UTxO put up as collateral. It's only taken if the policy fails,
    /// which evaluation rules out.
    pub fn collateral(&self) -> &UtxoResponse {
        &self.collateral
    }

    /// The draft for Ogmios to evaluate: the policy's redeemer carries
    /// [`DRAFT_BUDGET`], and the fee is the estimate.
    pub fn draft(&self) -> Result<BuiltTransaction> {
        let fee = self.estimate()?.fee.total;
        built_with(self.stage(fee, None)?, Patches::staking(&self.staking))
    }

    /// The unsigned transaction, with the policy's measured budget and the
    /// fee it and the signed size need. The collateral is held here, at that
    /// fee, to cover 3/2 of it and come back as an output, its tokens with it
    /// ([`CollateralShort`] when it can't).
    pub fn finalize(&self, budgets: &Budgets) -> Result<FinalAccountMint> {
        let finished = self.settle(budgets)?;
        let (lovelace, tokens) = assets_of(vec![self.collateral.clone()])?;
        collateral_back(
            &self.chain.params,
            &self.collateral.address,
            lovelace,
            tokens,
            finished.fee.total,
            MINT_COLLATERAL_SHORT,
        )?;
        Ok(finished)
    }

    /// [`Self::finalize`] with a guessed budget: whether these inputs pay.
    fn estimate(&self) -> Result<FinalAccountMint> {
        self.settle(&Budgets::guess(&[], 1))
    }

    /// How many payment keys sign: each distinct one among the inputs and
    /// the collateral. (A withdrawal's stake key is counted by `settle`.)
    fn signers(&self) -> usize {
        self.inputs
            .iter()
            .chain(std::iter::once(&self.collateral))
            .map(|u| u.payment_cred.as_str())
            .collect::<BTreeSet<_>>()
            .len()
    }

    fn settle(&self, budgets: &Budgets) -> Result<FinalAccountMint> {
        let budget = budgets
            .mint(0)
            .context("Ogmios measured no budget for the Seedelf policy")?;
        let compute = computation_fee(&self.chain.params, budget.mem, budget.steps);
        // The policy, by reference, and any reference script on an input
        // (never the collateral's: the ledger doesn't count it).
        let script_reference = reference_script_fee(
            &self.chain.params,
            self.chain.config.contract.seedelf_contract_size
                + reference_script_bytes(&self.inputs)?,
        )?;
        let (fee, staged) = settle(
            self.signers(),
            Patches::staking(&self.staking),
            |size| even(linear_fee(&self.chain.params, size) + compute + script_reference),
            |fee| self.stage(fee, Some(budgets)),
        )?;
        let (change_lovelace, change_tokens) = self.change(fee)?;
        let change_outputs = staged.outputs.as_ref().map_or(0, Vec::len) - 1;
        Ok(FinalAccountMint {
            tx: built_with(staged, Patches::staking(&self.staking))?,
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

    /// Everything the inputs hold, and any rewards withdrawn, less the
    /// seedelf's ADA and the fee.
    fn change(&self, fee: u64) -> Result<(u64, Assets)> {
        let (inputs, tokens) = assets_of(self.inputs.clone())?;
        let lovelace = self
            .staking
            .net(inputs)
            .and_then(|total| total.checked_sub(self.lovelace))
            .and_then(|rest| rest.checked_sub(fee))
            .ok_or(ACCOUNT_MINT_SHORT)?;
        Ok((lovelace, tokens))
    }

    fn stage(&self, fee: u64, budgets: Option<&Budgets>) -> Result<StagingTransaction> {
        let Chain { params, config, .. } = &self.chain;
        let (change_lovelace, change_tokens) = self.change(fee)?;
        let change = change_outputs(
            params,
            &self.change_addr,
            change_lovelace,
            &change_tokens,
            ACCOUNT_MINT_SHORT,
        )?;

        // The collateral comes back, less 3/2 of the fee, to where it was,
        // with any tokens it holds: held to an output's least at the fee
        // that's sent, in finalize, since a draft's is the estimate's guess
        // (chunk 51, r2money#2).
        let collateral_addr = Address::from_bech32(&self.collateral.address)
            .map_err(|e| anyhow::anyhow!("The collateral UTxO's address is invalid: {e}"))?;
        let (collateral_lovelace, collateral_tokens) = assets_of(vec![self.collateral.clone()])?;
        let collateral_back = collateral_lovelace.saturating_sub(fee * 3 / 2);
        let mut collateral_return = Output::new(collateral_addr, collateral_back);
        for asset in &collateral_tokens.items {
            collateral_return = collateral_return
                .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                .context("Failed To Add An Asset")?;
        }

        let policy = policy_hash(config)?;
        let budget = budgets.and_then(|b| b.mint(0)).unwrap_or(DRAFT_BUDGET);
        let mut tx = StagingTransaction::new();
        for utxo in &self.inputs {
            tx = tx.input(input_of(utxo)?);
        }
        for output in std::iter::once(self.seedelf.clone()).chain(change) {
            tx = tx.output(output);
        }
        tx = expiring(tx, self.invalid_hereafter);
        Ok(tx
            .collateral_input(input_of(&self.collateral)?)
            .collateral_output(collateral_return)
            .fee(fee)
            .reference_input(reference_utxo(config.reference.seedelf_reference_utxo))
            .mint_asset(policy, self.token_name.clone(), 1)
            .context("Failed To Mint The Seedelf")?
            .add_mint_redeemer(
                policy,
                self.redeemer.clone(),
                Some(ExUnits {
                    mem: budget.mem,
                    steps: budget.steps,
                }),
            )
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone()))
    }
}

/// What an account-paid script transaction may spend, in the order it takes
/// them: `available` but the set-aside `collateral` and any UTxO holding a
/// reference script that can't be measured (so can't be priced), as many as
/// fit together; pure ADA first, largest first, then token UTxOs, those
/// carrying a reference script after the rest, since it costs more to spend.
pub(crate) fn account_inputs(
    available: &[UtxoResponse],
    collateral: Option<&UtxoResponse>,
) -> Result<Vec<UtxoResponse>> {
    let pure_ada = |u: &UtxoResponse| u.asset_list.as_ref().is_none_or(|a| a.is_empty());
    let spendable: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| collateral.is_none_or(|c| !same_utxo(u, c)))
        .filter(|u| reference_script_size(u).is_ok())
        .cloned()
        .collect();
    let (mut spendable, _) = fitting(&spendable, &Assets::new(), |_| false)?;
    spendable.sort_by_key(|u| {
        (
            !pure_ada(u),
            u.reference_script.is_some(),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    Ok(spendable)
}

/// What an account-paid script transaction spending `inputs` puts up as
/// collateral: `given` when there is one (the web wallet's, set aside), else
/// one of `available`, preferring an ADA-only one, then one of at least 2 ADA
/// (3/2 of the fee plus the return), then one that isn't spent, then a 5 ADA
/// one, then the largest.
pub(crate) fn account_collateral<'a>(
    available: &'a [UtxoResponse],
    inputs: &[UtxoResponse],
    given: Option<&'a UtxoResponse>,
) -> Option<&'a UtxoResponse> {
    if given.is_some() {
        return given;
    }
    let pure_ada = |u: &UtxoResponse| u.asset_list.as_ref().is_none_or(|a| a.is_empty());
    let spent = |u: &UtxoResponse| inputs.iter().any(|i| same_utxo(i, u));
    let mut candidates: Vec<&UtxoResponse> = available.iter().collect();
    candidates.sort_by_key(|u| {
        (
            !pure_ada(u),
            lovelace_of(u) < ACCOUNT_COLLATERAL_MINIMUM,
            spent(u),
            lovelace_of(u) != COLLATERAL_LOVELACE,
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    candidates.first().copied()
}

/// Mints a seedelf paid by the Cardano account. `available` is what may be
/// spent (key addresses the caller can sign for), as for [`move_in`]:
///
/// - Inputs: pure ADA first, largest first, then token UTxOs, as few as pay
///   for the seedelf, the fee and valid change.
/// - Collateral: `collateral` when given (the web wallet's, set aside: it's
///   never an input, even if `available` lists it). Otherwise any of
///   `available`, preferring an ADA-only one, then one of at least 2 ADA (3/2
///   of the fee plus the return), then one that isn't spent, then a 5 ADA
///   one, then the largest. Its tokens, if any, come back with the
///   collateral return.
/// - The token is named after the smallest input, with `label` cut to 15
///   bytes; it sits in the contract under `seedelf`, used as given (pass a
///   fresh re-randomization). Tokens in the inputs go back with the change,
///   to `change_addr`.
/// - `staking` rides along, as for [`move_in`]: a withdrawal of the rewards.
/// - `invalid_hereafter` is as for [`move_in`]; the draft Ogmios measures
///   holds it too.
#[allow(clippy::too_many_arguments)]
pub fn account_mint(
    chain: &Chain,
    available: &[UtxoResponse],
    collateral: Option<&UtxoResponse>,
    label: &str,
    seedelf: &Register,
    change_addr: &Address,
    staking: &Staking,
    invalid_hereafter: Option<u64>,
) -> Result<AccountMint> {
    if !is_payable(seedelf) {
        bail!("The Seedelf's register isn't made of valid points");
    }
    let spendable = account_inputs(available, collateral)?;
    if spendable.is_empty() {
        bail!("There is nothing in the Cardano account to pay for a Seedelf");
    }

    let config = &chain.config;
    let policy = policy_hash(config)?;
    let lovelace = seedelf_minimum_lovelace(&chain.params)?;
    let wallet_addr = wallet_contract(chain.network_flag, config.contract.wallet_contract_hash);
    let redeemer = create_mint_redeemer(label.to_string())?;

    let mut last_error = None;
    for k in 1..=spendable.len() {
        let inputs = &spendable[..k];
        let Some(collateral) = account_collateral(available, inputs, collateral) else {
            bail!("There is nothing in the Cardano account to pay for a Seedelf");
        };

        let owned: Vec<Input> = inputs.iter().map(input_of).collect::<Result<_>>()?;
        let token_name = seedelf_token_name(label.to_string(), Some(&owned))?;
        let seedelf_output = Output::new(wallet_addr.clone(), lovelace)
            .set_inline_datum(seedelf.to_vec()?)
            .add_asset(policy, token_name.clone(), 1)
            .context("Failed To Add The Seedelf")?;
        let mint = AccountMint {
            chain: chain.clone(),
            inputs: inputs.to_vec(),
            collateral: collateral.clone(),
            seedelf: seedelf_output,
            redeemer: redeemer.clone(),
            change_addr: change_addr.clone(),
            staking: staking.clone(),
            invalid_hereafter,
            token_name,
            lovelace,
        };
        match mint.estimate() {
            Ok(_) => return Ok(mint),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => last_error = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or_else(|| ACCOUNT_MINT_SHORT.into()))
}

/// Chunk 51, l7merge#3: a payment too large for one transaction over hundreds of small UTxOs was refused as too many
/// only after hundreds of choices the guessed budgets refuse by their count alone, each made in full: every attempt
/// prices each input at [`SPEND_BUDGET_GUESS`], so no choice of more than 22 fits [`MAX_TX_BUDGET`], yet each of
/// `apart`'s orders was made at its first start that holds what the spend pays out, hundreds of inputs, and a
/// payment's parts run the search again over what's left before each part. The refusal stays [`TooMany`], so the
/// wallet's parts still take the payment.
#[cfg(test)]
mod too_many_by_count {
    use super::*;
    use pallas_addresses::{
        Network, PaymentKeyHash, ShelleyAddress, ShelleyDelegationPart, ShelleyPaymentPart,
    };
    use seedelf_crypto::schnorr::random_scalar;
    use seedelf_koios::koios::{Asset as KoiosAsset, InlineDatum};
    use serde_json::json;

    const ADA: u64 = 1_000_000;

    struct World {
        chain: Chain,
        owner: Register,
        signer: Hash<28>,
        to: Address,
    }

    fn world() -> World {
        let rows: Value =
            serde_json::from_str(include_str!("../tests/fixtures/epoch_params.json")).unwrap();
        World {
            chain: Chain {
                params: ProtocolParameters::from_koios(&rows[0]).unwrap(),
                network_flag: true,
                config: crate::constants::get_config(1, true).unwrap(),
            },
            owner: Register::create(random_scalar()).unwrap(),
            signer: Hasher::<224>::hash(fake_signer().public_key().as_ref()),
            to: ShelleyAddress::new(
                Network::Testnet,
                ShelleyPaymentPart::Key(PaymentKeyHash::new([7; 28])),
                ShelleyDelegationPart::Null,
            )
            .into(),
        }
    }

    /// What made a UTxO, as the extension classes it.
    #[derive(Clone, Copy)]
    enum Made {
        Unknown,
        Plain,
        Received,
        OtherSession,
    }

    /// `shape`'s UTxOs, each (how many, lovelace, a token's name, what made it), under `w`'s register, and their classes.
    fn balance(
        w: &World,
        purpose: Purpose,
        shape: &[(usize, u64, Option<&str>, Made)],
    ) -> (Vec<UtxoResponse>, Histories) {
        let (mut n, mut utxos, mut h) = (0x1000_0000u32, Vec::new(), Histories::new(purpose));
        for &(count, lovelace, token, made) in shape {
            for _ in 0..count {
                n += 1;
                let register = w.owner.clone().rerandomize().unwrap();
                let tx = format!("{n:08x}").repeat(8);
                let u = UtxoResponse {
                    tx_hash: tx.clone(),
                    tx_index: 0,
                    address: wallet_contract(true, w.chain.config.contract.wallet_contract_hash)
                        .to_bech32()
                        .unwrap(),
                    value: lovelace.to_string(),
                    payment_cred: hex::encode(w.chain.config.contract.wallet_contract_hash),
                    inline_datum: Some(InlineDatum {
                        bytes: hex::encode(register.to_vec().unwrap()),
                        value: json!({
                            "constructor": 0,
                            "fields": [{"bytes": register.generator}, {"bytes": register.public_value}]
                        }),
                    }),
                    asset_list: Some(
                        token
                            .map(|name| KoiosAsset {
                                decimals: 0,
                                quantity: "1".into(),
                                policy_id: "c0".repeat(28),
                                asset_name: hex::encode(name),
                                fingerprint: String::new(),
                            })
                            .into_iter()
                            .collect(),
                    ),
                    ..Default::default()
                };
                let (id, origin) = match made {
                    Made::Unknown => (format!("box:{tx}+unknown:{tx}"), Origin::Lovejoin),
                    Made::Plain => (format!("box:{tx}"), Origin::Lovejoin),
                    Made::Received => (format!("received:{tx}"), Origin::Received),
                    Made::OtherSession => ("session:3".to_string(), Origin::Session),
                };
                h = h.with(&u.tx_hash, u.tx_index, Class { id, origin });
                utxos.push(u);
            }
        }
        (utxos, h)
    }

    /// What one selection over `available` paying `outputs` asks of its attempt: how many choices hold more inputs
    /// than the guessed budgets let one transaction spend, and whether it was refused as too many.
    fn too_many_asked(
        w: &World,
        available: &[UtxoResponse],
        h: &Histories,
        outputs: &[(Output, Assets)],
    ) -> (usize, bool) {
        let most = (MAX_TX_BUDGET.steps / SPEND_BUDGET_GUESS.steps)
            .min(MAX_TX_BUDGET.mem / SPEND_BUDGET_GUESS.mem) as usize;
        let mut doomed = 0;
        let picked = select_script_inputs(
            &w.chain.params,
            available,
            &Assets::new(),
            paid_out(outputs),
            h,
            |inputs| {
                doomed += usize::from(inputs.len() > most);
                let spend = paying(&w.chain, inputs, outputs, &w.owner, w.signer)?;
                spend.estimate()?;
                Ok(spend)
            },
        );
        (doomed, picked.as_ref().is_err_and(is_too_many))
    }

    #[test]
    fn a_send_too_large_for_one_transaction_makes_no_choice_the_guessed_budgets_refuse_by_its_count()
     {
        let w = world();
        let (all, h) = balance(
            &w,
            Purpose::Pay,
            &[
                (100, 10 * ADA, None, Made::Unknown),
                (100, 10 * ADA, None, Made::Plain),
                (400, 2 * ADA, None, Made::Received),
            ],
        );
        let send = |lovelace: u64| {
            let pay = [Payment {
                register: w.owner.clone().rerandomize().unwrap(),
                lovelace,
                tokens: Assets::new(),
            }];
            payment_outputs(&w.chain, &pay).unwrap()
        };
        let (doomed, too_many) = too_many_asked(&w, &all, &h, &send(1_200 * ADA));
        assert!(
            too_many,
            "a Send of 1,200 ₳ is refused as too many for one transaction"
        );
        // The reruns a payment's parts make, 20 UTxOs a part (the web wallet's `in_parts`).
        let (mut rest, mut owed, mut reruns) = (all.clone(), 1_200 * ADA, 0);
        rest.reverse();
        while rest.len() > 20 {
            let taken: Vec<UtxoResponse> = rest.drain(..20).collect();
            owed = owed.saturating_sub(taken.iter().map(lovelace_of).sum::<u64>() - 400_000);
            let (more, too_many) = too_many_asked(&w, &rest, &h, &send(owed));
            reruns += more;
            if !too_many {
                break;
            }
        }
        assert_eq!(
            (doomed, reruns),
            (0, 0),
            "choices made in full though their count alone is too many, in the one transaction and in the parts' reruns"
        );
    }

    #[test]
    fn a_funding_too_large_for_one_transaction_makes_no_choice_the_guessed_budgets_refuse_by_its_count()
     {
        let w = world();
        let purpose = Purpose::Fund {
            session: Some("session:7".into()),
        };
        let (all, h) = balance(
            &w,
            purpose,
            &[
                (125, 10 * ADA, None, Made::Unknown),
                (62, 10 * ADA, None, Made::Plain),
                (63, 10 * ADA, Some("poolA"), Made::Plain),
                (125, 2 * ADA, None, Made::Received),
                (125, 2_500_000, Some("gift"), Made::Received),
                (250, 3 * ADA, None, Made::OtherSession),
            ],
        );
        let to = |lovelace: u64| AddressPayment {
            to: w.to.clone(),
            lovelace,
            tokens: Assets::new(),
        };
        let outputs = address_outputs(&w.chain, &[to(1_000 * ADA), to(5 * ADA)]).unwrap();
        let (doomed, too_many) = too_many_asked(&w, &all, &h, &outputs);
        assert!(
            too_many,
            "a funding of 1,000 ₳ is refused as too many for one transaction"
        );
        assert_eq!(
            doomed, 0,
            "choices made in full though their count alone is too many"
        );
    }

    /// Chunk 51, l8reference#2: only an order of every UTxO marks a spend short (`short_whole`). The pass before the
    /// first box of unknown making grows 1e1b0647's orders whole over the rest without any, which is short where
    /// everything isn't. 22 plain boxes of 13.19 ₳ beside 10 of unknown making of 10 ₳, a Send of 290 ₳: the 22 plain
    /// ones hold more than it pays out and are short by its fee, every other set of 22 holds less, and every set of 23
    /// is too many. So it's refused as too many for one transaction, which the wallet's parts take, not as short.
    #[test]
    fn a_send_short_beside_all_but_the_boxes_of_unknown_making_stays_too_many_for_one_transaction()
    {
        let w = world();
        let (all, h) = balance(
            &w,
            Purpose::Pay,
            &[
                (22, 13_190_000, None, Made::Plain),
                (10, 10 * ADA, None, Made::Unknown),
            ],
        );
        let pay = [Payment {
            register: w.owner.clone().rerandomize().unwrap(),
            lovelace: 290 * ADA,
            tokens: Assets::new(),
        }];
        let outputs = payment_outputs(&w.chain, &pay).unwrap();
        let plain = &all[..22];
        assert!(
            plain.iter().map(lovelace_of).sum::<u64>() > paid_out(&outputs),
            "the 22 plain ones hold more than the Send pays out, so that pass asks them"
        );
        let alone = paying(&w.chain, plain, &outputs, &w.owner, w.signer)
            .and_then(|spend| spend.estimate().map(|_| ()));
        assert!(
            alone.as_ref().is_err_and(is_short),
            "the 22 plain ones are short by the fee: {alone:?}"
        );
        let picked = select_script_inputs(
            &w.chain.params,
            &all,
            &Assets::new(),
            paid_out(&outputs),
            &h,
            |inputs| {
                let spend = paying(&w.chain, inputs, &outputs, &w.owner, w.signer)?;
                spend.estimate()?;
                Ok(spend)
            },
        );
        let e = picked
            .map(|spend| spend.inputs().len())
            .expect_err("no set of 22 or fewer pays");
        assert!(
            is_too_many(&e),
            "refused as too many for one transaction, so the wallet's parts take it: {e}"
        );
    }
}

#[cfg(test)]
mod exact_costs {
    use super::*;

    /// Chunk 52: the exact search's change least, worked out from its tokens without making an output, is the ledger's
    /// own least of the outputs that change goes out in ([`minimum_deposit`]), and its bytes are those outputs' as that
    /// least sizes them: one to four policies, names of 1 to 32 bytes, quantities of every CBOR width, 1 to 45 kinds.
    #[test]
    fn a_changes_least_worked_out_from_its_tokens_is_the_ledgers() {
        let rows: Value =
            serde_json::from_str(include_str!("../tests/fixtures/epoch_params.json")).unwrap();
        let p = ProtocolParameters::from_koios(&rows[0]).unwrap();
        let empty = wallet_minimum_lovelace_with_assets(&p, Assets::new()).unwrap();
        let mut seed = 0x5eed_0052u64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for case in 0..400 {
            let kinds = 1 + next() % 45;
            let policies = 1 + next() % 4;
            let mut tokens = Assets::new();
            for k in 0..kinds {
                let policy = hex::encode([(next() % policies) as u8 + 1; 28]);
                let length = [1usize, 5, 23, 24, 32][(next() % 5) as usize];
                let name: String = (0..length)
                    .map(|i| format!("{:02x}", if i == 0 { k as usize } else { i }))
                    .collect();
                let amount = [
                    1,
                    23,
                    24,
                    255,
                    256,
                    65_535,
                    65_536,
                    u64::from(u32::MAX),
                    u64::from(u32::MAX) + 1,
                    u64::MAX / 3,
                ][(next() % 10) as usize];
                tokens = tokens
                    .add(Asset::new(policy, name, amount).unwrap())
                    .unwrap();
            }
            let (least, bytes, outputs) = change_cost(p.coins_per_utxo_size, empty, &tokens);
            assert_eq!(least, minimum_deposit(&p, &tokens).unwrap(), "case {case}");
            assert_eq!(outputs, token_chunks(&tokens).len(), "case {case}");
            let sized: u64 = token_chunks(&tokens)
                .into_iter()
                .map(|c| {
                    wallet_minimum_lovelace_with_assets(&p, c).unwrap() / p.coins_per_utxo_size
                        - OVERHEAD_COST
                })
                .sum();
            assert_eq!(bytes, sized, "case {case}");
        }
        assert_eq!(
            change_cost(p.coins_per_utxo_size, empty, &Assets::new()),
            (empty, empty / p.coins_per_utxo_size - OVERHEAD_COST, 1)
        );
    }

    /// Chunk 52: a set's change costed from its layout ([`Laid::cost`]) is its change costed in full, as the build adds
    /// its tokens up (each kind merged where it first comes, less those sent), wherever the layout answers: tokens
    /// before the set's from none to 45 kinds, after them from none to 45, some shared with the set's or sent, the set's
    /// own bumping kinds before them, new ones, and ones whose amounts change their bytes.
    #[test]
    fn a_sets_change_costed_from_its_layout_is_its_change_costed_in_full() {
        let rows: Value =
            serde_json::from_str(include_str!("../tests/fixtures/epoch_params.json")).unwrap();
        let p = ProtocolParameters::from_koios(&rows[0]).unwrap();
        let (cpb, empty) = (
            p.coins_per_utxo_size,
            wallet_minimum_lovelace_with_assets(&p, Assets::new()).unwrap(),
        );
        let seed = Cell::new(0x5eed_5e75u64);
        let next = || {
            let mut x = seed.get();
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            seed.set(x);
            x
        };
        let token = |kind: u64, amount: u64| {
            let policy = hex::encode([(kind % 5) as u8 + 1; 28]);
            let name: String = (0..1 + kind % 9)
                .map(|i| format!("{:02x}", (kind + i) % 256))
                .collect();
            Asset::new(policy, name, amount).unwrap()
        };
        let amounts = [1u64, 23, 24, 255, 256, 65_535, 65_536, u64::from(u32::MAX)];
        let (mut laid, mut fallbacks) = (0, 0);
        for case in 0..3_000 {
            let draw = |n: u64, from: u64| {
                (0..n).fold(Assets::new(), |all, _| {
                    all.add(token(from + next() % 60, amounts[(next() % 8) as usize]))
                        .unwrap()
                })
            };
            let before = draw(next() % 46, 0);
            let after = draw(next() % 46, 20);
            let boxes: Vec<Assets> = (0..1 + next() % 4)
                .map(|_| draw(1 + next() % 3, 10))
                .collect();
            // Some of a kind before is sent.
            let needed =
                before
                    .items
                    .iter()
                    .filter(|_| next() % 4 == 0)
                    .fold(Assets::new(), |all, a| {
                        let sent = if next() % 2 == 0 {
                            a.amount
                        } else {
                            a.amount.div_ceil(2)
                        };
                        all.add(Asset {
                            amount: sent,
                            ..a.clone()
                        })
                        .unwrap()
                    });
            let kinds: Vec<Vec<(TokenKey, Held)>> = boxes
                .iter()
                .map(|t| t.items.iter().map(|a| (key_of(a), Held::of(a))).collect())
                .collect();
            let full = boxes
                .iter()
                .try_fold(before.clone(), |all, t| all.merge(t.clone()))
                .and_then(|all| all.merge(after.clone()))
                .and_then(|all| all.separate(needed.clone()))
                .map(|change| change_cost(cpb, empty, &change))
                .ok();
            let mut around = Around::new(before, after, &needed, cpb, empty);
            let kinds: Vec<&[(TokenKey, Held)]> = kinds.iter().map(|k| k.as_slice()).collect();
            match around
                .laid
                .as_mut()
                .and_then(|l| l.cost(&kinds, cpb, empty))
            {
                Some(fast) => {
                    laid += 1;
                    assert_eq!(Some(fast), full, "case {case}");
                }
                None => fallbacks += 1,
            }
        }
        assert!(
            laid > 1_000 && fallbacks > 100,
            "{laid} laid, {fallbacks} in full"
        );
    }

    /// 1.9.3's release review: the least worked out from token counts is the ledger's in shapes the test above doesn't
    /// draw: up to 25 policies among 65 kinds, so up to 20 policies an output, names of none to 32 bytes, and quantities
    /// up to `u64::MAX`.
    #[test]
    fn a_changes_least_with_many_policies_an_output_is_the_ledgers() {
        let rows: Value =
            serde_json::from_str(include_str!("../tests/fixtures/epoch_params.json")).unwrap();
        let p = ProtocolParameters::from_koios(&rows[0]).unwrap();
        let empty = wallet_minimum_lovelace_with_assets(&p, Assets::new()).unwrap();
        let mut seed = 0x0bad_cafe_u64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        for case in 0..2_000 {
            let kinds = 1 + next() % 65;
            let policies = 1 + next() % 25;
            let mut tokens = Assets::new();
            for k in 0..kinds {
                let policy = hex::encode([(next() % policies) as u8 + 1; 28]);
                let length = [0usize, 1, 23, 24, 31, 32][(next() % 6) as usize];
                let name: String = (0..length)
                    .map(|i| format!("{:02x}", (k as usize * 13 + i) % 256))
                    .collect();
                let amount = [
                    1,
                    23,
                    24,
                    255,
                    256,
                    65_535,
                    65_536,
                    u64::from(u32::MAX),
                    u64::from(u32::MAX) + 1,
                    u64::MAX,
                ][(next() % 10) as usize];
                if let Ok(t) = tokens.add(Asset::new(policy, name, amount).unwrap()) {
                    tokens = t;
                }
            }
            let (least, bytes, outputs) = change_cost(p.coins_per_utxo_size, empty, &tokens);
            assert_eq!(least, minimum_deposit(&p, &tokens).unwrap(), "case {case}");
            assert_eq!(outputs, token_chunks(&tokens).len(), "case {case}");
            let sized: u64 = token_chunks(&tokens)
                .into_iter()
                .map(|c| {
                    wallet_minimum_lovelace_with_assets(&p, c).unwrap() / p.coins_per_utxo_size
                        - OVERHEAD_COST
                })
                .sum();
            assert_eq!(bytes, sized, "case {case}");
        }
    }

    /// 1.9.3's release review: a set's change costed from its layout is its change costed in full in shapes the test
    /// above doesn't draw: up to 23 policies, names of none to 32 bytes, quantities up to near `u64::MAX`. Where only the
    /// full merge overflows partway (before what's sent comes off), the layout may still answer: counted apart, since
    /// `fitting` keeps a balance whose total of a token passes what an output holds out of selection.
    #[test]
    fn a_sets_change_costed_from_its_layout_near_u64_max_and_with_many_policies_is_its_change_costed_in_full()
     {
        let rows: Value =
            serde_json::from_str(include_str!("../tests/fixtures/epoch_params.json")).unwrap();
        let p = ProtocolParameters::from_koios(&rows[0]).unwrap();
        let (cpb, empty) = (
            p.coins_per_utxo_size,
            wallet_minimum_lovelace_with_assets(&p, Assets::new()).unwrap(),
        );
        let seed = Cell::new(0x0123_4567_89ab_cdefu64);
        let next = || {
            let mut x = seed.get();
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            seed.set(x);
            x
        };
        let token = |kind: u64, amount: u64| {
            let policy = hex::encode([(kind % 23) as u8 + 1; 28]);
            let name: String = (0..kind % 33)
                .map(|i| format!("{:02x}", (kind * 7 + i) % 256))
                .collect();
            Asset::new(policy, name, amount).unwrap()
        };
        let amounts = [
            1u64,
            23,
            24,
            65_535,
            65_536,
            u64::from(u32::MAX),
            u64::from(u32::MAX) + 1,
            u64::MAX / 4,
            u64::MAX / 3,
            u64::MAX - 7,
        ];
        let (mut laid, mut fallbacks, mut overflow_only) = (0, 0, 0);
        for case in 0..20_000 {
            let draw = |n: u64, from: u64| {
                (0..n).fold(Assets::new(), |all, _| {
                    let t = token(from + next() % 70, amounts[(next() % 10) as usize]);
                    all.add(t).unwrap_or(all)
                })
            };
            let before = draw(next() % 62, 0);
            let after = draw(next() % 62, 25);
            let boxes: Vec<Assets> = (0..1 + next() % 5)
                .map(|_| draw(1 + next() % 4, 12))
                .collect();
            let needed =
                before
                    .items
                    .iter()
                    .filter(|_| next() % 4 == 0)
                    .fold(Assets::new(), |all, a| {
                        let sent = if next() % 2 == 0 {
                            a.amount
                        } else {
                            a.amount.div_ceil(2)
                        };
                        all.add(Asset {
                            amount: sent,
                            ..a.clone()
                        })
                        .unwrap()
                    });
            let kinds: Vec<Vec<(TokenKey, Held)>> = boxes
                .iter()
                .map(|t| t.items.iter().map(|a| (key_of(a), Held::of(a))).collect())
                .collect();
            let full = boxes
                .iter()
                .try_fold(before.clone(), |all, t| all.merge(t.clone()))
                .and_then(|all| all.merge(after.clone()))
                .and_then(|all| all.separate(needed.clone()))
                .map(|change| change_cost(cpb, empty, &change))
                .ok();
            let mut around = Around::new(before, after, &needed, cpb, empty);
            let kinds: Vec<&[(TokenKey, Held)]> = kinds.iter().map(|k| k.as_slice()).collect();
            match around
                .laid
                .as_mut()
                .and_then(|l| l.cost(&kinds, cpb, empty))
            {
                Some(_) if full.is_none() => overflow_only += 1,
                Some(fast) => {
                    laid += 1;
                    assert_eq!(Some(fast), full, "case {case}");
                }
                None => fallbacks += 1,
            }
        }
        println!(
            "{laid} laid, {fallbacks} in full, {overflow_only} where only the full merge overflows"
        );
        assert!(laid > 1_000, "{laid} laid");
    }
}
