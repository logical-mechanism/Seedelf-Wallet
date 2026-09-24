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

use crate::address::{collateral_address, wallet_contract};
use crate::assets::{Asset, Assets};
use crate::constants::{COLLATERAL_HASH, COLLATERAL_PUBLIC_KEY, Config, MAXIMUM_TOKENS_PER_UTXO};
use crate::data_structures::{create_mint_redeemer, create_spend_redeemer};
use crate::transaction::{
    address_minimum_lovelace_with_assets, checked_lovelace, collateral_input, computation_fee,
    decode_tx_hash, reference_utxo, seedelf_minimum_lovelace, seedelf_token_name,
    wallet_minimum_lovelace_with_assets,
};
use crate::utxos::{assets_of, collect_address_utxos};

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
    params.min_fee_a * tx_size + params.min_fee_b
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
    settle(signers, |size| linear_fee(params, size), build)
}

/// [`settle_fee`] with any pricing: `price(size)` is the fee a transaction of
/// `size` signed bytes needs.
fn settle(
    signers: usize,
    price: impl Fn(u64) -> u64,
    mut build: impl FnMut(u64) -> Result<StagingTransaction>,
) -> Result<(u64, StagingTransaction)> {
    let mut fee: u64 = 200_000;
    for _ in 0..5 {
        let staged = build(fee)?;
        let needed = price(signed_size(&staged, signers)?);
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

/// An account-paid mint's inputs can't pay for it.
const ACCOUNT_MINT_SHORT: NotEnough =
    NotEnough("Not enough ADA in the Cardano account for the seedelf, its fee and the change");

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
    let (fee, staged) = settle_fee(params, 1, |fee| {
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
    Err(last_error.unwrap_or_else(|| MOVE_IN_SHORT.into()))
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
    let (fee, staged) = settle_fee(params, signers, |fee| {
        (deposit, change) = match amount {
            MoveInAmount::Lovelace(lovelace) => {
                let change = total
                    .checked_sub(lovelace)
                    .and_then(|rest| rest.checked_sub(fee))
                    .ok_or(MOVE_IN_SHORT)?;
                (lovelace, change)
            }
            MoveInAmount::Max => {
                let deposit = total
                    .checked_sub(fee)
                    .and_then(|rest| rest.checked_sub(change_floor))
                    .ok_or(MOVE_IN_SHORT)?;
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
        for output in change_outputs(params, change_addr, change, &staying, MOVE_IN_SHORT)? {
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
// The caller signs it with the one-time key and giveme.my's witness. Mint is
// built on it here; transfer, sweep and remove follow.
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

/// The Conway reference-script fee per byte (`min_fee_ref_script_cost_per_byte`).
/// Both scripts are far below the first 25 KiB tier, so it's flat.
const REFERENCE_SCRIPT_FEE_PER_BYTE: u64 = 15;

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

/// The execution budgets Ogmios measured, by redeemer.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Budgets {
    spend: BTreeMap<u64, Budget>,
    mint: BTreeMap<u64, Budget>,
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
                other => {
                    bail!("Ogmios measured a {other} script, which this transaction doesn't have")
                }
            };
        }
        Ok(budgets)
    }

    /// A guess for `spends` wallet-contract inputs and `mints` seedelf
    /// policies, before Ogmios has measured anything.
    fn guess(spends: usize, mints: usize) -> Self {
        Budgets {
            spend: (0..spends as u64)
                .map(|i| (i, SPEND_BUDGET_GUESS))
                .collect(),
            mint: (0..mints as u64).map(|i| (i, MINT_BUDGET_GUESS)).collect(),
        }
    }

    pub fn spend(&self, index: u64) -> Option<Budget> {
        self.spend.get(&index).copied()
    }

    pub fn mint(&self, index: u64) -> Option<Budget> {
        self.mint.get(&index).copied()
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
                "mint" => "the seedelf policy".to_string(),
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
    if failures.is_empty() {
        format!("Ogmios couldn't evaluate the transaction: {message}")
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
    /// The scripts read from reference inputs.
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
    signer: Hash<28>,
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
            signer,
        })
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
        let budgets = Budgets::guess(self.inputs.len(), usize::from(self.mint.is_some()));
        self.settle(&budgets, &redeemers)
    }

    fn proofs(&self) -> Result<&[Vec<u8>]> {
        self.redeemers
            .as_deref()
            .context("The Seedelf spend isn't proven yet")
    }

    fn settle(&self, budgets: &Budgets, redeemers: &[Vec<u8>]) -> Result<FinalSpend> {
        // Every redeemer needs a budget, and together they must fit a transaction.
        let mut used = Vec::with_capacity(self.inputs.len() + 1);
        for index in 0..self.inputs.len() as u64 {
            used.push(budgets.spend(index).with_context(|| {
                format!("Ogmios measured no budget for spending input {index}")
            })?);
        }
        if self.mint.is_some() {
            used.push(
                budgets
                    .mint(0)
                    .context("Ogmios measured no budget for the seedelf policy")?,
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
        let contract = &self.chain.config.contract;
        let mut script_bytes = contract.wallet_contract_size;
        if self.mint.is_some() {
            script_bytes += contract.seedelf_contract_size;
        }
        let script_reference = script_bytes * REFERENCE_SCRIPT_FEE_PER_BYTE;

        // Two signatures: the one-time key and giveme.my's collateral key.
        let (fee, staged) = settle(
            2,
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
        let (total, mut tokens) = assets_of(self.inputs())?;
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
        for output in self.outputs.iter().cloned().chain(change) {
            tx = tx.output(output);
        }
        tx = tx
            .collateral_input(collateral_input(*network_flag))
            .collateral_output(collateral_output(collateral_address(*network_flag), fee)?)
            .fee(fee)
            .reference_input(reference_utxo(config.reference.wallet_reference_utxo))
            .language_view(ScriptKind::PlutusV3, params.cost_model_v3.clone())
            .disclosed_signer(self.signer)
            .disclosed_signer(Hash::new(COLLATERAL_HASH));

        // Redeemers point at inputs in the ledger's order: sorted by tx id, then index.
        let mut order: Vec<&Input> = self.inputs.iter().map(|o| &o.input).collect();
        order.sort_by_key(|i| (i.tx_hash.0, i.txo_index));
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
                .position(|i| **i == owned.input)
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
        .context("The seedelf policy id is not hex")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("The seedelf policy id is not 28 bytes"))?;
    Ok(Hash::new(bytes))
}

/// Picks as few of `available` as it can: pure-ADA UTxOs first, largest
/// first, then token UTxOs, adding one at a time until `attempt` succeeds.
/// Only "not enough" failures move on to more inputs.
fn select_script_inputs<T>(
    available: &[UtxoResponse],
    mut attempt: impl FnMut(&[UtxoResponse]) -> Result<T>,
) -> Result<T> {
    let mut sorted: Vec<UtxoResponse> = available.to_vec();
    sorted.sort_by_key(|u| {
        let tokens = u.asset_list.as_ref().is_some_and(|a| !a.is_empty());
        let lovelace = u.value.parse::<u64>().unwrap_or(0);
        (tokens, std::cmp::Reverse(lovelace))
    });
    let mut last_error = None;
    for k in 1..=sorted.len() {
        match attempt(&sorted[..k]) {
            Ok(built) => return Ok(built),
            Err(e) if e.downcast_ref::<NotEnough>().is_some() => last_error = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap_or_else(|| SEEDELF_SHORT.into()))
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
    select_script_inputs(available, |inputs| {
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
    // Points that don't decode, or aren't in the prime-order subgroup, would
    // lock the seedelf and anything sent to it for good.
    if !seedelf.is_valid().unwrap_or(false) {
        bail!("The seedelf's register isn't made of valid points");
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
// key. The collateral is one of the account's own UTxOs, as in the CLI: this
// transaction names the account anyway. It needn't be ADA-only: the
// collateral return gives back its tokens, which Babbage and later allow.
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
    /// The new token's name: prefix, label, and the smallest input.
    pub token_name: Vec<u8>,
    /// Locked with the token; only removing the seedelf gets it back.
    pub lovelace: u64,
}

/// A finished account-paid mint: the unsigned transaction and what it does.
pub struct FinalAccountMint {
    /// Needs a signature from each input's key and the collateral's.
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
        self.stage(fee, None)?
            .build_conway_raw()
            .context("Failed To Build The Draft Transaction")
    }

    /// The unsigned transaction, with the policy's measured budget and the
    /// fee it and the signed size need.
    pub fn finalize(&self, budgets: &Budgets) -> Result<FinalAccountMint> {
        self.settle(budgets)
    }

    /// [`Self::finalize`] with a guessed budget: whether these inputs pay.
    fn estimate(&self) -> Result<FinalAccountMint> {
        self.settle(&Budgets::guess(0, 1))
    }

    /// How many keys sign: each distinct payment key among the inputs and
    /// the collateral.
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
            .context("Ogmios measured no budget for the seedelf policy")?;
        let compute = computation_fee(&self.chain.params, budget.mem, budget.steps);
        let script_reference =
            self.chain.config.contract.seedelf_contract_size * REFERENCE_SCRIPT_FEE_PER_BYTE;
        let (fee, staged) = settle(
            self.signers(),
            |size| even(linear_fee(&self.chain.params, size) + compute + script_reference),
            |fee| self.stage(fee, Some(budgets)),
        )?;
        let (change_lovelace, change_tokens) = self.change(fee)?;
        let change_outputs = staged.outputs.as_ref().map_or(0, Vec::len) - 1;
        Ok(FinalAccountMint {
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

    /// Everything the inputs hold, less the seedelf's ADA and the fee.
    fn change(&self, fee: u64) -> Result<(u64, Assets)> {
        let (total, tokens) = assets_of(self.inputs.clone())?;
        let lovelace = total
            .checked_sub(self.lovelace)
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

/// Mints a seedelf paid by the Cardano account. `available` is the account's
/// UTxOs (key addresses the caller can sign for):
///
/// - Inputs: pure ADA first, largest first, then token UTxOs, as few as pay
///   for the seedelf, the fee and valid change. A pure-ADA UTxO of exactly
///   5 ADA is never spent (it's probably another wallet's collateral).
/// - Collateral: any of `available`, preferring an ADA-only one, then one of
///   at least 2 ADA (3/2 of the fee plus the return), then one that isn't
///   spent, then a 5 ADA one, then the largest. Its tokens, if any, come
///   back with the collateral return.
/// - The token is named after the smallest input, with `label` cut to 15
///   bytes; it sits in the contract under `seedelf`, used as given (pass a
///   fresh re-randomization). Tokens in the inputs go back with the change,
///   to `change_addr`.
pub fn account_mint(
    chain: &Chain,
    available: &[UtxoResponse],
    label: &str,
    seedelf: &Register,
    change_addr: &Address,
) -> Result<AccountMint> {
    if !seedelf.is_valid().unwrap_or(false) {
        bail!("The seedelf's register isn't made of valid points");
    }
    if available.is_empty() {
        bail!("There is nothing in the Cardano account to pay for a seedelf");
    }
    let pure_ada = |u: &UtxoResponse| u.asset_list.as_ref().is_none_or(|a| a.is_empty());
    let lovelace_of = |u: &UtxoResponse| u.value.parse::<u64>().unwrap_or(0);

    let mut spendable: Vec<UtxoResponse> = collect_address_utxos(available.to_vec())?;
    spendable.sort_by_key(|u| (!pure_ada(u), std::cmp::Reverse(lovelace_of(u))));

    let config = &chain.config;
    let policy = policy_hash(config)?;
    let lovelace = seedelf_minimum_lovelace(&chain.params)?;
    let wallet_addr = wallet_contract(chain.network_flag, config.contract.wallet_contract_hash);
    let redeemer = create_mint_redeemer(label.to_string())?;

    let mut last_error = None;
    for k in 1..=spendable.len() {
        let inputs = &spendable[..k];
        let spent = |u: &UtxoResponse| {
            inputs
                .iter()
                .any(|i| i.tx_hash == u.tx_hash && i.tx_index == u.tx_index)
        };
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
        let Some(collateral) = candidates.first() else {
            bail!("There is nothing in the Cardano account to pay for a seedelf");
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
            collateral: (*collateral).clone(),
            seedelf: seedelf_output,
            redeemer: redeemer.clone(),
            change_addr: change_addr.clone(),
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
