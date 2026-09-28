//! Network-free transaction building, shared by the CLI and the web wallet.
//!
//! Each builder takes chain data the caller has already fetched (protocol
//! parameters, and UTxOs as Koios returns them) and returns an unsigned
//! transaction. Callers make the network calls and sign: the CLI with its
//! file-stored key, the web wallet inside WebAssembly with its HD keys.

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

use crate::address::{collateral_address, is_not_a_script, is_on_correct_network, wallet_contract};
use crate::assets::{Asset, Assets};
use crate::constants::{COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO};
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

/// What's patched into a built transaction, since Pallas can stage neither:
/// staking (certificates, a withdrawal; see [`Staking::patch`]) and a note
/// ([`Note::patch`]).
#[derive(Clone, Copy)]
struct Patches<'a> {
    staking: &'a Staking,
    note: Option<&'a Note>,
}

impl<'a> Patches<'a> {
    /// Only `staking`: every transaction but a send with a note.
    fn staking(staking: &'a Staking) -> Self {
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

/// [`settle_fee`] with any pricing: `price(size)` is the fee a transaction of
/// `size` signed bytes needs. `patches` go into each draft before it's
/// priced; `signers` doesn't count the stake key a staking patch needs.
/// A draft over [`MAX_TX_SIZE`], or a fee over [`MAX_FEE`], is refused here,
/// in words.
fn settle(
    signers: usize,
    patches: Patches,
    price: impl Fn(u64) -> u64,
    mut build: impl FnMut(u64) -> Result<StagingTransaction>,
) -> Result<(u64, StagingTransaction)> {
    let mut fee: u64 = 200_000;
    for _ in 0..5 {
        let staged = build(fee)?;
        let size = signed_size(&staged, signers, patches)?;
        if size > MAX_TX_SIZE {
            bail!(
                "This transaction would be {size} bytes, over the network's limit of {MAX_TX_SIZE}. Send fewer tokens, or pay fewer recipients, at once"
            );
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
fn built_with(staged: StagingTransaction, patches: Patches) -> Result<BuiltTransaction> {
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
fn expiring(tx: StagingTransaction, invalid_hereafter: Option<u64>) -> StagingTransaction {
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
    let chunks: Vec<Assets> = if tokens.items.is_empty() {
        vec![Assets::new()]
    } else {
        tokens.split(MAXIMUM_TOKENS_PER_UTXO as usize)
    };
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

/// The least lovelace a deposit of `tokens` needs: the sum of each deposit
/// output's minimum.
pub fn minimum_deposit(params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
    if tokens.items.is_empty() {
        return wallet_minimum_lovelace_with_assets(params, Assets::new());
    }
    tokens
        .split(MAXIMUM_TOKENS_PER_UTXO as usize)
        .into_iter()
        .map(|chunk| wallet_minimum_lovelace_with_assets(params, chunk))
        .sum()
}

/// Change outputs to a key address: `tokens` split `MAXIMUM_TOKENS_PER_UTXO`
/// to an output, the last output carrying the rest of `lovelace`. No output at
/// all when there's nothing to return. `short` is the error when the
/// lovelace can't carry the tokens.
fn change_outputs(
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
fn minimum_change(
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
struct NotEnough(&'static str);

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
    /// A key address, in one output.
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
            Payee::Address(to) => Ok(vec![pay_address(params, to, lovelace, tokens)?]),
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

/// Send: the Cardano account pays `to`, a key address on this network
/// (`network_flag`: `true` is preprod), in one output. The UTxOs are chosen,
/// the change made, and `staking` and `invalid_hereafter` carried, as for
/// [`move_in`].
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
/// order given, then the change. Each is a key address on this network or a
/// Seedelf (see [`Payee::Seedelf`]), with its own amount and tokens. Max pays a
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
        bail!("A staking transaction needs a certificate or a withdrawal");
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
/// `max_tx_ex_steps` as of epoch 290 on preprod. They have only gone up since
/// (17.5M memory at epoch 315), so this errs on the safe side.
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
    fn guess(spends: &[u64], mints: usize) -> Self {
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

/// A token minted (or burned, when negative) under the seedelf policy.
#[derive(Clone)]
struct PolicyMint {
    policy: Hash<28>,
    token_name: Vec<u8>,
    amount: i64,
    redeemer: Vec<u8>,
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
    signer: Hash<28>,
    /// A key account spent alongside, with its collateral ([`Self::with_account`]).
    account: Option<AccountPart>,
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
            signer,
            account: None,
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

    /// Sends what's left after the outputs and the fee to `addr`, a key
    /// address, instead of back into the contract: everything, for sending
    /// the lot, or a removed seedelf's ADA. Tokens go 20 to an output.
    pub fn change_to(mut self, addr: &Address) -> Self {
        self.change_addr = Some(addr.clone());
        self
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
        });
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
        self.stage(fee, None, redeemers)?
            .build_conway_raw()
            .context("Failed To Build The Draft Transaction")
    }

    /// The unsigned transaction, with the budgets Ogmios measured on the
    /// draft and the fee they and the signed size need.
    pub fn finalize(&self, budgets: &Budgets) -> Result<FinalSpend> {
        let redeemers = self.proofs()?;
        self.settle(budgets, redeemers)
    }

    /// [`Self::finalize`] with guessed budgets and stand-in proofs: whether
    /// these inputs can pay, before anything is proven or measured.
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
        let budgets = measure(&self.draft()?)?;
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
            bail!(
                "Spending {} UTxOs at once needs more computation than a transaction may use",
                self.inputs.len()
            );
        }

        let compute: u64 = used
            .iter()
            .map(|b| computation_fee(&self.chain.params, b.mem, b.steps))
            .sum();
        // The Seedelf scripts, read from reference inputs, and any reference
        // script on a spent input, which Conway charges for too.
        let contract = &self.chain.config.contract;
        let mut script_bytes = contract.wallet_contract_size;
        if self.mint.is_some() {
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
            Patches::staking(&Staking::none()),
            |size| even(linear_fee(&self.chain.params, size) + compute + script_reference),
            |fee| self.stage(fee, Some(budgets), redeemers),
        )?;
        let (change_lovelace, change_tokens) = self.remainder(fee)?;
        let change_outputs = staged.outputs.as_ref().map_or(0, Vec::len) - self.outputs.len();
        Ok(FinalSpend {
            tx: staged
                .build_conway_raw()
                .context("Failed To Build The Transaction")?,
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
            .checked_sub(self.paid_lovelace)
            .and_then(|rest| rest.checked_sub(fee))
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
        let (change_lovelace, change_tokens) = self.remainder(fee)?;
        let wallet_addr = wallet_contract(*network_flag, config.contract.wallet_contract_hash);
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
        let mut outputs: Vec<Output> = self.outputs.iter().cloned().chain(change).collect();
        crate::lovejoin::shuffle(&mut outputs);
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
                // The fee is even, so 3/2 of it is whole.
                let back = account
                    .collateral_lovelace
                    .checked_sub(fee * 3 / 2)
                    .context("The collateral can't cover this transaction's fee")?;
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
            tx = tx
                .reference_input(reference_utxo(config.reference.seedelf_reference_utxo))
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
// history), and gives each a class. Selection keeps classes apart whenever a
// selection that doesn't merge them pays, and when none does it merges them
// anyway, never refusing: the review then says what was merged. The CLI
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
    /// A box back from Lovejoin: each is a class of its own.
    Lovejoin,
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

/// What a spend is for, which orders the classes it would rather take.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Purpose {
    /// Send or Make public: own money first, a box back from Lovejoin last.
    #[default]
    Pay,
    /// A stealth mint: received money first, since the new Seedelf is tied to
    /// whatever pays for it.
    Mint,
    /// A private session's funding or top-up: received money, or a box that
    /// pays alone, first; another session's money last. `session` is the
    /// session's own class, whose money a top-up may take first.
    Fund { session: Option<String> },
}

impl Purpose {
    /// How much this spend would rather take money of `class`: lowest first.
    fn rank(&self, class: &Class) -> u8 {
        use Origin::*;
        match self {
            Purpose::Pay => match class.origin {
                Own => 0,
                Session => 1,
                Received => 2,
                Unknown => 3,
                Lovejoin => 4,
            },
            Purpose::Mint => match class.origin {
                Received => 0,
                Lovejoin => 1,
                Unknown => 2,
                Own => 3,
                Session => 4,
            },
            Purpose::Fund { session } => {
                if session.as_deref().is_some_and(|s| class.has(s)) {
                    return 0;
                }
                match class.origin {
                    Received => 1,
                    Lovejoin => 2,
                    Unknown => 3,
                    Own => 4,
                    Session => 5,
                }
            }
        }
    }

    /// When merging: 0 for what's taken first, 1 for what's taken only when
    /// nothing else pays (another session's money, for a funding), 2 for a
    /// box, taken last and one at a time.
    fn tier(&self, class: &Class) -> u8 {
        match (self, class.origin) {
            (_, Origin::Lovejoin) => 2,
            (Purpose::Fund { .. }, Origin::Session) if self.rank(class) > 0 => 1,
            _ => 0,
        }
    }
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
///    purpose's order, the smallest first;
/// 2. UTxOs of one class, by the purpose's order, the largest first;
/// 3. merging classes: with tokens sent, their UTxOs and one of another
///    class first; then by the purpose's order, its last resorts after the
///    rest, and boxes back from Lovejoin last of all, one at a time, so two
///    are spent together only when nothing else pays. When that runs into
///    what a transaction can spend (too many inputs), the same without the
///    purpose's order; then as few boxes as pay, none first, then one more
///    at a time, each with the fewest other inputs (the largest first,
///    tokens or not), or with UTxOs holding tokens last, for when their
///    tokens make it too large; and at the last the CLI's own order, so
///    nothing the CLI pays is refused.
fn select_script_inputs<T>(
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
    if !histories.blind(available) {
        return apart(mandatory, rest, floor, histories, attempt);
    }
    rest.sort_by_key(|u| (holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
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

/// How many UTxOs holding tokens [`apart`] tries alone. Each is a question
/// of its own (its change must carry its tokens), and a wallet can hold
/// hundreds; past these, the later steps still find what pays.
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
/// tried.
fn one_more<'a, T>(
    mut candidates: Vec<&'a UtxoResponse>,
    rank: impl Fn(&UtxoResponse) -> u8,
    try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried<T>,
) -> Option<T> {
    candidates.sort_by_key(|u| (rank(u), lovelace_of(u)));
    let mut short_at: Option<u64> = None;
    let mut token_tries = 0;
    for u in candidates {
        let ada_only = !holds_tokens(u);
        if ada_only && short_at.is_some_and(|at| lovelace_of(u) <= at) {
            continue;
        }
        if !ada_only {
            if token_tries == MAX_TOKEN_SINGLES {
                continue;
            }
            token_tries += 1;
        }
        match try_with(&[u]) {
            Tried::Built(built) => return Some(built),
            Tried::Short if ada_only => short_at = short_at.max(Some(lovelace_of(u))),
            _ => {}
        }
    }
    None
}

/// How growing one of [`apart`]'s merging orders ended.
enum Grown<T> {
    Built(T),
    /// Everything in it together is short.
    Short,
    /// The choice of its first `.0` failed otherwise (too much computation,
    /// say): more inputs won't mend it.
    Failed(usize),
}

/// `order[..k]` for k = `from`, `from` + 1, … until one builds or fails
/// otherwise.
fn grow<'a, T>(
    order: &[&'a UtxoResponse],
    from: usize,
    try_with: &mut impl FnMut(&[&'a UtxoResponse]) -> Tried<T>,
) -> Grown<T> {
    for k in from.max(1)..=order.len() {
        match try_with(&order[..k]) {
            Tried::Built(built) => return Grown::Built(built),
            Tried::Failed => return Grown::Failed(k),
            _ => {}
        }
    }
    Grown::Short
}

/// [`select_script_inputs`] with histories known: `base` are the UTxOs
/// holding the tokens sent, which every choice spends, and `rest` the others.
fn apart<T>(
    base: Vec<UtxoResponse>,
    rest: Vec<UtxoResponse>,
    floor: u64,
    histories: &Histories,
    mut attempt: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
    let purpose = &histories.purpose;
    let class = |u: &UtxoResponse| histories.class_of(u);
    let base_lovelace: u64 = base.iter().map(lovelace_of).sum();
    let base_classes: Vec<String> = base.iter().map(|u| class(u).id).collect();
    // Money that adds no history to what the tokens sent bring.
    let joins_base = |u: &UtxoResponse| base.is_empty() || base_classes.contains(&class(u).id);

    let mut not_enough: Option<anyhow::Error> = None;
    let mut other: Option<anyhow::Error> = None;
    let mut try_with = |extra: &[&UtxoResponse]| -> Tried<T> {
        let lovelace = base_lovelace + extra.iter().map(|u| lovelace_of(u)).sum::<u64>();
        if lovelace <= floor || (base.is_empty() && extra.is_empty()) {
            return Tried::Skipped;
        }
        let selected: Vec<UtxoResponse> = base
            .iter()
            .cloned()
            .chain(extra.iter().map(|u| (*u).clone()))
            .collect();
        match attempt(&selected) {
            Ok(built) => Tried::Built(built),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => {
                not_enough = Some(e);
                Tried::Short
            }
            Err(e) => {
                other = Some(e);
                Tried::Failed
            }
        }
    };

    // The tokens' own UTxOs, alone.
    if let Tried::Built(built) = try_with(&[]) {
        return Ok(built);
    }

    // 1. One more UTxO: by the purpose's order, the smallest first.
    let singles: Vec<&UtxoResponse> = rest.iter().filter(|u| joins_base(u)).collect();
    if let Some(built) = one_more(singles, |u| purpose.rank(&class(u)), &mut try_with) {
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
        let total: u64 = rows.iter().map(|u| lovelace_of(u)).sum();
        (purpose.rank(c), std::cmp::Reverse(total), c.id.clone())
    });
    for (_, rows) in &mut classes {
        rows.sort_by_key(|u| (holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
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
            .filter(|u| !joins_base(u) && purpose.tier(&class(u)) == 0)
            .collect();
        if let Some(built) = one_more(others, |u| purpose.rank(&class(u)), &mut try_with) {
            return Ok(built);
        }
    }

    // Then orders tried in turn, each grown one UTxO at a time. One that runs
    // into what more inputs can't mend (too much computation, too large) is
    // left for the next; short with everything is short in any order
    // (independent review M6).
    //
    // a. As the CLI would, but the purpose's last resorts after the rest,
    //    and boxes after everything, one at a time; within each, by the
    //    purpose's order, the largest first (independent review L39).
    // b. The same without the purpose's order, pure ADA before tokens within
    //    each: what merging paid before a did is paid the same way.
    // c. As few boxes as pay: the largest j of them, then the rest without
    //    the other boxes (the last resorts after the others), for j = 0, 1,
    //    2, …, so no more boxes are spent together than pay. For each j, the
    //    rest the largest first, tokens or not, for the fewest inputs; then
    //    pure ADA before tokens, for when a UTxO's tokens make it too large.
    //    Boxes that fail alone fail with more.
    // d. The CLI's own order, boxes among the rest by size: never refused
    //    what the CLI would pay.
    let tier = |u: &UtxoResponse| purpose.tier(&class(u));
    let mut by_history: Vec<&UtxoResponse> = rest.iter().collect();
    by_history.sort_by_key(|u| {
        (
            tier(u),
            !joins_base(u),
            purpose.rank(&class(u)),
            holds_tokens(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let mut by_tier: Vec<&UtxoResponse> = rest.iter().collect();
    by_tier.sort_by_key(|u| {
        (
            tier(u),
            !joins_base(u),
            holds_tokens(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let is_box = |u: &UtxoResponse| tier(u) == 2 && !holds_tokens(u);
    let mut boxes: Vec<&UtxoResponse> = rest.iter().filter(|u| is_box(u)).collect();
    boxes.sort_by_key(|u| (!joins_base(u), std::cmp::Reverse(lovelace_of(u))));
    let mut largest: Vec<&UtxoResponse> = rest.iter().filter(|u| !is_box(u)).collect();
    largest.sort_by_key(|u| (tier(u), !joins_base(u), std::cmp::Reverse(lovelace_of(u))));
    let mut tokens_last: Vec<&UtxoResponse> = rest.iter().filter(|u| !is_box(u)).collect();
    tokens_last.sort_by_key(|u| {
        (
            holds_tokens(u),
            tier(u),
            !joins_base(u),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });
    let same = |a: &[&UtxoResponse], b: &[&UtxoResponse]| {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| std::ptr::eq(*x, *y))
    };
    let mut rests = vec![&largest];
    if !same(&largest, &tokens_last) {
        rests.push(&tokens_last);
    }
    let (boxes, rests) = (&boxes, &rests);
    // With nothing but boxes, a grew these already.
    let fewest_boxes = (0..=boxes.len())
        .filter(|_| !largest.is_empty())
        .flat_map(|j| {
            rests
                .iter()
                .map(move |others| (boxes[..j].iter().chain(others.iter()).copied().collect(), j))
        });
    let mut blind: Vec<&UtxoResponse> = rest.iter().collect();
    blind.sort_by_key(|u| (holds_tokens(u), std::cmp::Reverse(lovelace_of(u))));
    let mut failed = false;
    let mut boxes_fail = false;
    let mut grown: Vec<Vec<&UtxoResponse>> = Vec::new();
    // Each order, and how many boxes it brings forward (none for a, b, d).
    let orders = [(by_history, 0), (by_tier, 0)]
        .into_iter()
        .chain(fewest_boxes)
        .chain([(blind, 0)]);
    for (order, j) in orders {
        // The same order again, or the start of one grown whole before (c's
        // without boxes, often), would fail the same way.
        let grown_before =
            |g: &Vec<&UtxoResponse>| g.len() >= order.len() && same(&g[..order.len()], &order);
        if (j > 0 && boxes_fail) || grown.iter().any(grown_before) {
            continue;
        }
        let whole = order.len() == rest.len();
        match grow(&order, j, &mut try_with) {
            Grown::Built(built) => return Ok(built),
            Grown::Short if whole => {
                failed = false;
                break;
            }
            // Short without the other boxes: one more may pay.
            Grown::Short => {}
            Grown::Failed(at) => {
                failed = true;
                boxes_fail |= j > 0 && at == j;
            }
        }
        if whole {
            grown.push(order);
        }
    }
    Err(match (failed, other, not_enough) {
        (true, Some(e), _) => e,
        (_, _, Some(e)) => e,
        (_, Some(e), None) => e,
        _ => SEEDELF_SHORT.into(),
    })
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
/// the UTxOs holding the most of it, until there's enough. Errors naming the
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
    select_script_inputs(available, &Assets::new(), floor, histories, |inputs| {
        let built = mint_from(chain, inputs, label, seedelf, change_owner, signer)?;
        built.spend.estimate()?;
        Ok(built)
    })
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

/// One output per payment, each under a fresh re-randomization of the
/// recipient's register and above its minimum.
fn payment_outputs(chain: &Chain, payments: &[Payment]) -> Result<Vec<(Output, Assets)>> {
    if payments.is_empty() {
        bail!("A transfer pays at least one Seedelf");
    }
    let wallet_addr = wallet_contract(
        chain.network_flag,
        chain.config.contract.wallet_contract_hash,
    );
    payments
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
            let output = deposit_output(&wallet_addr, &payment.register, payment.lovelace, &payment.tokens)?;
            Ok((output, payment.tokens.clone()))
        })
        .collect()
}

/// The least lovelace a payment to a seedelf with `tokens` must carry: one
/// contract output under a register.
pub fn minimum_seedelf_payment(params: &ProtocolParameters, tokens: &Assets) -> Result<u64> {
    wallet_minimum_lovelace_with_assets(params, tokens.clone())
}

/// Lovelace as ADA, with all six decimals.
fn ada(lovelace: u64) -> String {
    format!("{}.{:06}", lovelace / 1_000_000, lovelace % 1_000_000)
}

// ---------------------------------------------------------------------------
// Withdraw: paying an address from the Seedelf balance, or removing a seedelf
//
// `sweep` pays an address a fixed amount, and the change goes back into the
// contract; `sweep_all` sends everything the inputs hold, less the fee.
// `remove` burns a seedelf, and what its UTxO held goes back into the
// contract, or to an address with `ScriptSpend::change_to`.
// ---------------------------------------------------------------------------

/// Whether a withdrawal can pay `addr`: a Shelley address on this network
/// with no script in it. A script output would carry no datum, which locks
/// it at most scripts.
pub fn is_payable_address(addr: &Address, network_flag: bool) -> bool {
    matches!(addr, Address::Shelley(_))
        && is_not_a_script(addr.clone())
        && is_on_correct_network(addr.clone(), network_flag)
}

fn check_address(chain: &Chain, addr: &Address) -> Result<()> {
    check_payable(addr, chain.network_flag)
}

fn check_payable(addr: &Address, network_flag: bool) -> Result<()> {
    if !is_payable_address(addr, network_flag) {
        let network = if network_flag { "preprod" } else { "mainnet" };
        bail!(
            "Payments go to a normal {network} address: not a script, stake or other network's address"
        );
    }
    Ok(())
}

/// The least lovelace an output paying `to` exactly `tokens` must carry.
pub fn minimum_address_payment(
    params: &ProtocolParameters,
    to: &Address,
    tokens: &Assets,
) -> Result<u64> {
    let bech32 = to
        .to_bech32()
        .map_err(|e| anyhow::anyhow!("Failed to encode the address: {e}"))?;
    address_minimum_lovelace_with_assets(params, &bech32, tokens.clone())
}

/// The output paying `to` exactly `lovelace` and `tokens`, above its minimum.
fn address_output(chain: &Chain, to: &Address, lovelace: u64, tokens: &Assets) -> Result<Output> {
    check_address(chain, to)?;
    pay_address(&chain.params, to, lovelace, tokens)
}

/// [`address_output`] for an address already checked.
fn pay_address(
    params: &ProtocolParameters,
    to: &Address,
    lovelace: u64,
    tokens: &Assets,
) -> Result<Output> {
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
    let mut output = Output::new(to.clone(), lovelace);
    for asset in &tokens.items {
        output = output
            .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
            .context("Failed To Add An Asset")?;
    }
    Ok(output)
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

/// A payment to a key address from the Seedelf balance.
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
    if payments.is_empty() {
        bail!("A withdrawal pays at least one address");
    }
    let outputs: Vec<(Output, Assets)> = payments
        .iter()
        .map(|p| {
            Ok((
                address_output(chain, &p.to, p.lovelace, &p.tokens)?,
                p.tokens.clone(),
            ))
        })
        .collect::<Result<_>>()?;
    let needed = payments
        .iter()
        .try_fold(Assets::new(), |all, p| all.merge(p.tokens.clone()))?;
    select_script_inputs(
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
    let output = address_output(chain, to, lovelace, tokens)?;
    ScriptSpend::new(chain, inputs, change_owner, signer)?.output(output, tokens)
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
    /// fee it and the signed size need.
    pub fn finalize(&self, budgets: &Budgets) -> Result<FinalAccountMint> {
        self.settle(budgets)
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
        // with any tokens it holds.
        let collateral_addr = Address::from_bech32(&self.collateral.address)
            .map_err(|e| anyhow::anyhow!("The collateral UTxO's address is invalid: {e}"))?;
        let (collateral_lovelace, collateral_tokens) = assets_of(vec![self.collateral.clone()])?;
        let collateral_back = collateral_lovelace.saturating_sub(fee * 3 / 2);
        if collateral_back
            < address_minimum_lovelace_with_assets(
                params,
                &self.collateral.address,
                collateral_tokens.clone(),
            )?
        {
            bail!("The Cardano account's UTxOs are too small to put up as collateral");
        }
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
    let pure_ada = |u: &UtxoResponse| u.asset_list.as_ref().is_none_or(|a| a.is_empty());
    let lovelace_of = |u: &UtxoResponse| u.value.parse::<u64>().unwrap_or(0);
    let same =
        |a: &UtxoResponse, b: &UtxoResponse| a.tx_hash == b.tx_hash && a.tx_index == b.tx_index;

    // Never one holding a reference script that can't be measured, so can't
    // be priced.
    let spendable: Vec<UtxoResponse> = available
        .iter()
        .filter(|u| collateral.is_none_or(|c| !same(u, c)))
        .filter(|u| reference_script_size(u).is_ok())
        .cloned()
        .collect();
    let (mut spendable, _) = fitting(&spendable, &Assets::new(), |_| false)?;
    if spendable.is_empty() {
        bail!("There is nothing in the Cardano account to pay for a Seedelf");
    }
    // A reference script costs more to spend: those after the rest.
    spendable.sort_by_key(|u| {
        (
            !pure_ada(u),
            u.reference_script.is_some(),
            std::cmp::Reverse(lovelace_of(u)),
        )
    });

    let config = &chain.config;
    let policy = policy_hash(config)?;
    let lovelace = seedelf_minimum_lovelace(&chain.params)?;
    let wallet_addr = wallet_contract(chain.network_flag, config.contract.wallet_contract_hash);
    let redeemer = create_mint_redeemer(label.to_string())?;

    let mut last_error = None;
    for k in 1..=spendable.len() {
        let inputs = &spendable[..k];
        let spent = |u: &UtxoResponse| inputs.iter().any(|i| same(i, u));
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
        let Some(collateral) = collateral.or(candidates.first().copied()) else {
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
