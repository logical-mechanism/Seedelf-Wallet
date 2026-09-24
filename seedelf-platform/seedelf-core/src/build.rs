//! Network-free transaction building, shared by the CLI and the web wallet.
//!
//! Each builder takes chain data the caller has already fetched (protocol
//! parameters, and UTxOs as Koios returns them) and returns an unsigned
//! transaction. Callers make the network calls and sign: the CLI with its
//! file-stored key, the web wallet inside WebAssembly with its HD keys.

use std::collections::BTreeSet;
use std::fmt;

use anyhow::{Context, Result, bail};
use pallas_addresses::Address;
use pallas_crypto::hash::Hash;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::{BuildConway, BuiltTransaction, Input, Output, StagingTransaction};
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use seedelf_crypto::register::Register;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

use crate::assets::{Asset, Assets};
use crate::constants::MAXIMUM_TOKENS_PER_UTXO;
use crate::transaction::{
    address_minimum_lovelace_with_assets, checked_lovelace, decode_tx_hash,
    wallet_minimum_lovelace_with_assets,
};
use crate::utxos::{assets_of, collect_address_utxos};

/// A throwaway ed25519 key, used to sign a draft so its size includes a
/// realistic witness. The signature is discarded.
pub fn fake_signer() -> PrivateKey {
    PrivateKey::from(SecretKey::new(OsRng))
}

/// The linear (size-based) fee for a transaction of `tx_size` bytes.
pub fn linear_fee(tx_size: u64) -> u64 {
    fees::compute_linear_fee_policy(tx_size, &fees::PolicyParams::default())
}

/// Settles the size fee of a key-signed transaction. `build(fee)` stages the
/// transaction for a given fee; each draft is signed with `signers` throwaway
/// keys and priced, until the fee covers the transaction it produces.
/// Returns the fee and the transaction staged with it.
pub fn settle_fee(
    signers: usize,
    mut build: impl FnMut(u64) -> Result<StagingTransaction>,
) -> Result<(u64, StagingTransaction)> {
    let mut fee: u64 = 200_000;
    for _ in 0..5 {
        let staged = build(fee)?;
        let needed = linear_fee(signed_size(&staged, signers)?);
        if needed <= fee && fee - needed < 1_000 {
            return Ok((fee, staged));
        }
        // Too low, or far above what's needed (the first guess): price again.
        fee = needed;
    }
    bail!("The transaction fee did not settle")
}

fn signed_size(staged: &StagingTransaction, signers: usize) -> Result<u64> {
    let mut built = staged
        .clone()
        .build_conway_raw()
        .context("Failed To Build The Draft Transaction")?;
    for _ in 0..signers.max(1) {
        built = built
            .sign(fake_signer())
            .context("Failed To Sign The Draft Transaction")?;
    }
    Ok(built.tx_bytes.0.len() as u64)
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
/// all when there's nothing to return.
fn change_outputs(
    params: &ProtocolParameters,
    change_addr: &Address,
    lovelace: u64,
    tokens: &Assets,
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
            bail!(NotEnough);
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
#[derive(Debug)]
struct NotEnough;

impl fmt::Display for NotEnough {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Not enough ADA in the Cardano account for this move, its fee and the change")
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
            "A {} deposit of these tokens needs at least {}.{:06} ADA",
            self.what,
            self.needed / 1_000_000,
            self.needed % 1_000_000
        )
    }
}

impl std::error::Error for TooLittle {}

/// `external sweep`: every UTxO at the CLI's dApp address back into the
/// wallet contract, under fresh re-randomizations of `owner`. `signer` is the
/// dApp key's hash, disclosed as a required signer. Returns the unsigned
/// transaction and its fee.
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
    let (fee, staged) = settle_fee(1, |fee| {
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

/// How much ADA a move-in takes into Seedelf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveInAmount {
    Lovelace(u64),
    /// Everything that can move: all ADA but the fee and the minimum the
    /// change needs to carry the tokens that stay.
    Max,
}

/// A built move-in: the unsigned transaction and what it does.
pub struct MoveIn {
    pub tx: BuiltTransaction,
    /// The spent UTxOs, in input order; each needs its payment key's signature.
    pub inputs: Vec<UtxoResponse>,
    pub fee: u64,
    /// Lovelace and tokens into the wallet contract.
    pub lovelace: u64,
    pub tokens: Assets,
    /// How many wallet-contract outputs hold them.
    pub deposit_outputs: usize,
    /// What goes back to the Cardano account.
    pub change_lovelace: u64,
    pub change_tokens: Assets,
}

/// Move-in: the Cardano account pays into the wallet contract under fresh
/// re-randomizations of `owner`, the user's base register. No script runs.
///
/// - `available` is the account's UTxOs (key addresses the caller can sign
///   for). A pure-ADA UTxO of exactly 5 ADA is never spent: it's probably
///   another wallet's collateral, as in the CLI.
/// - `picked` tokens move in full; every UTxO holding one is spent.
/// - Otherwise pure-ADA UTxOs are spent first, largest first, then other
///   token UTxOs, until the amount, the fee and valid change are covered.
///   Tokens that aren't picked go back with the change.
/// - Change goes to `change_addr`. There is no change output when nothing is left.
pub fn move_in(
    params: &ProtocolParameters,
    available: &[UtxoResponse],
    amount: MoveInAmount,
    picked: &[(String, String)],
    owner: &Register,
    wallet_addr: &Address,
    change_addr: &Address,
) -> Result<MoveIn> {
    let eligible: Vec<UtxoResponse> = collect_address_utxos(available.to_vec())?;
    let holds_picked = |u: &UtxoResponse| {
        u.asset_list.as_ref().is_some_and(|assets| {
            assets.iter().any(|a| {
                picked
                    .iter()
                    .any(|(p, n)| *p == a.policy_id && *n == a.asset_name)
            })
        })
    };
    for (policy, name) in picked {
        let held = eligible.iter().any(|u| {
            u.asset_list.as_ref().is_some_and(|assets| {
                assets
                    .iter()
                    .any(|a| a.policy_id == *policy && a.asset_name == *name)
            })
        });
        if !held {
            bail!("The Cardano account doesn't hold the token {policy}.{name}");
        }
    }

    let (mandatory, mut rest): (Vec<UtxoResponse>, Vec<UtxoResponse>) =
        eligible.into_iter().partition(|u| holds_picked(u));
    // Pure ADA first, then token UTxOs; largest first within each.
    rest.sort_by_key(|u| {
        let tokens = u.asset_list.as_ref().is_some_and(|a| !a.is_empty());
        let lovelace = u.value.parse::<u64>().unwrap_or(0);
        (tokens, std::cmp::Reverse(lovelace))
    });

    let attempt = |selected: &[UtxoResponse]| {
        build_move_in(
            params,
            selected,
            amount,
            picked,
            owner,
            wallet_addr,
            change_addr,
        )
    };

    if amount == MoveInAmount::Max {
        let all: Vec<UtxoResponse> = mandatory.into_iter().chain(rest).collect();
        if all.is_empty() {
            bail!("There is nothing in the Cardano account to move");
        }
        return attempt(&all);
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
    Err(last_error.unwrap_or_else(|| NotEnough.into()))
}

fn build_move_in(
    params: &ProtocolParameters,
    selected: &[UtxoResponse],
    amount: MoveInAmount,
    picked: &[(String, String)],
    owner: &Register,
    wallet_addr: &Address,
    change_addr: &Address,
) -> Result<MoveIn> {
    let (total, all_tokens) = assets_of(selected.to_vec())?;
    let is_picked = |a: &Asset| {
        let policy = hex::encode(a.policy_id);
        let name = hex::encode(&a.token_name);
        picked.iter().any(|(p, n)| *p == policy && *n == name)
    };
    let moving = Assets {
        items: all_tokens
            .items
            .iter()
            .filter(|a| is_picked(a))
            .cloned()
            .collect(),
    };
    let staying = Assets {
        items: all_tokens
            .items
            .iter()
            .filter(|a| !is_picked(a))
            .cloned()
            .collect(),
    };
    let inputs: Vec<Input> = selected.iter().map(input_of).collect::<Result<_>>()?;
    let signers = selected
        .iter()
        .map(|u| u.payment_cred.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let change_floor = minimum_change(params, change_addr, &staying)?;

    let mut deposit = 0;
    let mut change = 0;
    let mut outputs = 0;
    let (fee, staged) = settle_fee(signers, |fee| {
        (deposit, change) = match amount {
            MoveInAmount::Lovelace(lovelace) => {
                let change = total
                    .checked_sub(lovelace)
                    .and_then(|rest| rest.checked_sub(fee))
                    .ok_or(NotEnough)?;
                (lovelace, change)
            }
            MoveInAmount::Max => {
                let deposit = total
                    .checked_sub(fee)
                    .and_then(|rest| rest.checked_sub(change_floor))
                    .ok_or(NotEnough)?;
                (deposit, change_floor)
            }
        };
        let deposits = deposit_outputs(params, wallet_addr, owner, deposit, &moving)?;
        outputs = deposits.len();
        let mut tx = StagingTransaction::new();
        for input in &inputs {
            tx = tx.input(input.clone());
        }
        for output in deposits {
            tx = tx.output(output);
        }
        for output in change_outputs(params, change_addr, change, &staying)? {
            tx = tx.output(output);
        }
        Ok(tx.fee(fee))
    })?;

    Ok(MoveIn {
        tx: staged
            .build_conway_raw()
            .context("Failed To Build The Transaction")?,
        inputs: selected.to_vec(),
        fee,
        lovelace: deposit,
        tokens: moving,
        deposit_outputs: outputs,
        change_lovelace: change,
        change_tokens: staying,
    })
}
