//! The DEX orders a private session places through Minswap's aggregator, read
//! for who cancels them and whom they pay, and their cancels, built in the
//! wallet (chunk 24, Step 3 in
//! `seedelf-web-wallet/docs/archive/plans/chunk-24-dapp-additions.md`).
//!
//! Minswap's `cancel-tx` route answers 404 on both networks (2026-10-07), and
//! its `pending-orders` doesn't list every order, so a session can't count on
//! Minswap to get its money back. Every order a session places sits at a
//! script this table knows ([`read_order`]; the web wallet's order check
//! refuses any other), owned by the session's own key, in a form its script
//! can spend ([`unspendable`]), and its cancel is built and run before the
//! session signs the swap ([`check_cancels`]). [`cancel_orders`] spends it
//! back with the session's own keys and collateral.
//!
//! The table (`orders.json`) pins each DEX's order script by network: its
//! Plutus version, and where the script is read from, a reference UTxO
//! (checked on chain) or, for a Plutus V1 script, bytes bundled here, which
//! the transaction carries. A reference spent since (by whoever holds it)
//! still gives its script through Koios: checked against the pinned hash, the
//! transaction carries it instead. What each cancel needs was read from real
//! owner cancels on chain, and each DEX's source or bytecode, on 2026-10-07:
//! no validity interval, withdrawal or mint; the canceller's key a required
//! signer; Splash's refund first and exact.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, anyhow, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::Fragment;
use pallas_primitives::conway::{self, PlutusData, PseudoDatumOption, PseudoScript};
use pallas_traverse::MultiEraTx;
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, ExUnits, Input, Output, ScriptKind, StagingTransaction,
};
use seedelf_koios::koios::{
    Asset as KoiosAsset, InlineDatum, ProtocolParameters, ReferenceScript, UtxoResponse,
};
use serde::Deserialize;
use serde_json::Value;

use crate::assets::Assets;
use crate::build::{
    Budget, Budgets, MAX_TX_BUDGET, NotEnough, Patches, change_outputs, even, input_of, is_short,
    linear_fee, reference_script_fee, settle, tx_id,
};
use crate::eval::{self, Resolved};
use crate::staking::Staking;
use crate::transaction::{address_minimum_lovelace_with_assets, computation_fee};
use crate::utxos::assets_of;

/// The pinned table: see the module comment.
const TABLE: &str = include_str!("orders.json");

/// A DEX whose orders a session places, by the name Minswap's aggregator
/// gives it. Spectrum's legs are Splash's limit orders, at the same script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
pub enum Protocol {
    Minswap,
    MinswapV2,
    MinswapStable,
    SundaeSwap,
    SundaeSwapV3,
    SundaeSwapStable,
    WingRiders,
    WingRidersV2,
    WingRidersStableV2,
    Splash,
}

impl Protocol {
    /// The spend redeemer that cancels its order: `Constr 1 []` everywhere
    /// but Splash, whose `action: Bool` cancels on `False`, `Constr 0 []`.
    fn cancel_redeemer(self) -> Vec<u8> {
        match self {
            Protocol::Splash => vec![0xd8, 0x79, 0x80],
            _ => vec![0xd8, 0x7a, 0x80],
        }
    }

    /// Whether its order's owner is the session's stake key, not its payment
    /// key: SundaeSwap V3's and Stableswaps', as Minswap builds them.
    pub fn signs_with_stake(self) -> bool {
        matches!(self, Protocol::SundaeSwapV3 | Protocol::SundaeSwapStable)
    }

    /// Whether its order must be cancelled in a transaction of its own:
    /// Splash's script holds output 0 to its own value exactly, so two of
    /// them can't share one.
    fn alone(self) -> bool {
        matches!(self, Protocol::Splash)
    }

    pub fn name(self) -> &'static str {
        match self {
            Protocol::Minswap => "Minswap",
            Protocol::MinswapV2 => "MinswapV2",
            Protocol::MinswapStable => "MinswapStable",
            Protocol::SundaeSwap => "SundaeSwap",
            Protocol::SundaeSwapV3 => "SundaeSwapV3",
            Protocol::SundaeSwapStable => "SundaeSwapStable",
            Protocol::WingRiders => "WingRiders",
            Protocol::WingRidersV2 => "WingRidersV2",
            Protocol::WingRidersStableV2 => "WingRidersStableV2",
            Protocol::Splash => "Splash",
        }
    }
}

#[derive(Deserialize)]
struct TableJson {
    orders: NetworksJson,
    inline: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct NetworksJson {
    mainnet: Vec<EntryJson>,
    preprod: Vec<EntryJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntryJson {
    protocol: Protocol,
    script: String,
    plutus: u8,
    reference: Option<String>,
    reference_size: Option<u64>,
    inline: Option<String>,
}

/// One DEX order script the wallet can cancel at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub protocol: Protocol,
    /// The order script's hash: its address's payment part.
    pub script: Hash<28>,
    /// Its Plutus version, 1 to 3.
    pub plutus: u8,
    /// Where it's read from by reference, and the script's size there.
    pub reference: Option<(Hash<32>, u64, u64)>,
    /// Its bytes, carried in the transaction: a Plutus V1 script's.
    pub inline: Option<Vec<u8>>,
}

impl Entry {
    /// The reference UTxO, as `hash#index`.
    pub fn reference_outpoint(&self) -> Option<String> {
        self.reference
            .map(|(hash, index, _)| format!("{hash}#{index}"))
    }
}

/// The script hash of `bytes`, a Plutus script of `version`.
fn script_hash(version: u8, bytes: &[u8]) -> Hash<28> {
    let mut tagged = Vec::with_capacity(bytes.len() + 1);
    tagged.push(version);
    tagged.extend_from_slice(bytes);
    Hasher::<224>::hash(&tagged)
}

fn hash28(hex_str: &str) -> Result<Hash<28>> {
    let bytes: [u8; 28] = hex::decode(hex_str)?
        .try_into()
        .map_err(|_| anyhow!("{hex_str} isn't a 28-byte hash"))?;
    Ok(Hash::new(bytes))
}

/// `hash#index`.
fn outpoint(text: &str) -> Result<(Hash<32>, u64)> {
    let (hash, index) = text
        .split_once('#')
        .with_context(|| format!("{text} isn't a UTxO reference"))?;
    let hash: [u8; 32] = hex::decode(hash)?
        .try_into()
        .map_err(|_| anyhow!("{text} isn't a UTxO reference"))?;
    Ok((Hash::new(hash), index.parse()?))
}

/// The table for a network (`true` is preprod, as everywhere in the
/// workspace). Each bundled script is checked against its hash.
pub fn table(network_flag: bool) -> Result<Vec<Entry>> {
    let json: TableJson = serde_json::from_str(TABLE).context("orders.json can't be read")?;
    let rows = if network_flag {
        json.orders.preprod
    } else {
        json.orders.mainnet
    };
    rows.into_iter()
        .map(|row| {
            let script = hash28(&row.script)?;
            if !(1..=3).contains(&row.plutus) {
                bail!("{} names Plutus V{}", row.script, row.plutus);
            }
            let reference = row
                .reference
                .as_deref()
                .map(|r| {
                    let (hash, index) = outpoint(r)?;
                    let size = row
                        .reference_size
                        .with_context(|| format!("{r} has no size"))?;
                    Ok::<_, anyhow::Error>((hash, index, size))
                })
                .transpose()?;
            let inline = row
                .inline
                .as_deref()
                .map(|name| -> Result<Vec<u8>> {
                    let bytes = hex::decode(
                        json.inline
                            .get(name)
                            .with_context(|| format!("No script named {name}"))?,
                    )?;
                    if script_hash(row.plutus, &bytes) != script {
                        bail!("The bundled {name} script isn't {}", row.script);
                    }
                    Ok(bytes)
                })
                .transpose()?;
            if reference.is_none() == inline.is_none() {
                bail!("{} needs one place to read its script from", row.script);
            }
            if inline.is_some() && row.plutus != 1 {
                bail!("Only a Plutus V1 script is carried in the transaction");
            }
            Ok(Entry {
                protocol: row.protocol,
                script,
                plutus: row.plutus,
                reference,
                inline,
            })
        })
        .collect()
}

/// The table's entry for an order script, if the wallet can cancel there.
pub fn entry(network_flag: bool, script: &Hash<28>) -> Result<Option<Entry>> {
    Ok(table(network_flag)?
        .into_iter()
        .find(|e| e.script == *script))
}

// ---------------------------------------------------------------------------
// Reading an order's datum.
// ---------------------------------------------------------------------------

/// A Plutus address's credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Credential {
    Key(Hash<28>),
    Script(Hash<28>),
}

/// An address as a datum holds it: its payment part, and its staking part
/// when it has one by credential (a pointer isn't read).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlutusAddress {
    pub payment: Credential,
    pub stake: Option<Credential>,
}

/// Who an order names, read from its datum.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderRead {
    pub protocol: Protocol,
    /// The key whose signature cancels it.
    pub signer: Hash<28>,
    /// Every address it may pay: its proceeds', and its refund's.
    pub pays: Vec<PlutusAddress>,
}

/// The session's keys: its payment key (`0/i`) and its stake key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Session {
    pub payment: Hash<28>,
    pub stake: Hash<28>,
}

impl Session {
    /// The session's own address, as a datum names it.
    pub fn address(&self) -> PlutusAddress {
        PlutusAddress {
            payment: Credential::Key(self.payment),
            stake: Some(Credential::Key(self.stake)),
        }
    }

    /// Whether `order` is the session's: cancelled by its own key (the stake
    /// key's where the DEX names that), and paying only the session.
    pub fn owns(&self, order: &OrderRead) -> bool {
        let key = if order.protocol.signs_with_stake() {
            self.stake
        } else {
            self.payment
        };
        let own = self.address();
        order.signer == key && !order.pays.is_empty() && order.pays.iter().all(|a| *a == own)
    }
}

/// A constructor's index and fields.
fn constr(d: &PlutusData) -> Option<(u64, &[PlutusData])> {
    let PlutusData::Constr(c) = d else {
        return None;
    };
    let index = match c.tag {
        121..=127 => c.tag - 121,
        1280..=1400 => c.tag - 1280 + 7,
        102 => c.any_constructor?,
        _ => return None,
    };
    Some((index, c.fields.as_slice()))
}

fn key(d: &PlutusData) -> Option<Hash<28>> {
    let PlutusData::BoundedBytes(b) = d else {
        return None;
    };
    let bytes: [u8; 28] = b.as_slice().try_into().ok()?;
    Some(Hash::new(bytes))
}

fn credential(d: &PlutusData) -> Option<Credential> {
    match constr(d)? {
        (0, [h]) => Some(Credential::Key(key(h)?)),
        (1, [h]) => Some(Credential::Script(key(h)?)),
        _ => None,
    }
}

/// `Constr 0 [payment, Some(Inline(stake)) | None]`.
fn address(d: &PlutusData) -> Option<PlutusAddress> {
    let (0, [payment, stake]) = constr(d)? else {
        return None;
    };
    let stake = match constr(stake)? {
        (1, []) => None,
        (0, [inline]) => match constr(inline)? {
            (0, [c]) => Some(credential(c)?),
            _ => return None,
        },
        _ => return None,
    };
    Some(PlutusAddress {
        payment: credential(payment)?,
        stake,
    })
}

/// `Some(x)` is `Constr 0 [x]`, `None` `Constr 1 []`.
fn option(d: &PlutusData) -> Option<Option<&PlutusData>> {
    match constr(d)? {
        (0, [x]) => Some(Some(x)),
        (1, []) => Some(None),
        _ => None,
    }
}

fn key_of(a: &PlutusAddress) -> Option<Hash<28>> {
    match a.payment {
        Credential::Key(k) => Some(k),
        Credential::Script(_) => None,
    }
}

fn is_bytes(d: &PlutusData) -> bool {
    matches!(d, PlutusData::BoundedBytes(_))
}

fn is_int(d: &PlutusData) -> bool {
    matches!(d, PlutusData::BigInt(_))
}

/// An asset class: `Constr 0 [policy, name]`.
fn is_asset(d: &PlutusData) -> bool {
    matches!(constr(d), Some((0, [policy, name])) if is_bytes(policy) && is_bytes(name))
}

/// A ratio: `Constr 0 [numerator, denominator]`.
fn is_ratio(d: &PlutusData) -> bool {
    matches!(constr(d), Some((0, [n, m])) if is_int(n) && is_int(m))
}

/// A list of byte strings (key hashes).
fn is_byte_list(d: &PlutusData) -> bool {
    matches!(d, PlutusData::Array(items) if items.iter().all(is_bytes))
}

/// Reads `protocol`'s order datum: who cancels it, and whom it pays.
///
/// Anyone can pay an order's address an output with any datum (the web
/// wallet reads what's at a spent Splash order's address), and Pallas's
/// decoder goes a call deeper for each level of nesting: a datum nested past
/// [`crate::cbor::MAX_DEPTH`] (real orders' are 10 to 14 deep) is refused
/// unread, before it can overflow WebAssembly's stack.
pub fn read(protocol: Protocol, datum: &[u8]) -> Result<OrderRead> {
    let unreadable = || {
        anyhow!(
            "This {} order's details aren't in the shape the wallet reads",
            protocol.name()
        )
    };
    if !crate::cbor::within_depth(datum, crate::cbor::MAX_DEPTH) {
        return Err(unreadable());
    }
    let data = PlutusData::decode_fragment(datum).map_err(|_| unreadable())?;
    let read = || -> Option<(Hash<28>, Vec<PlutusAddress>)> {
        let (0, fields) = constr(&data)? else {
            return None;
        };
        match protocol {
            // [sender, receiver, receiver datum hash?, step, batcher fee, deposit]:
            // the sender's key cancels.
            Protocol::Minswap | Protocol::MinswapStable => {
                let sender = address(fields.first()?)?;
                let receiver = address(fields.get(1)?)?;
                Some((key_of(&sender)?, vec![sender, receiver]))
            }
            // [canceller, refund receiver, its datum, success receiver, its datum, …]:
            // canceller = OAMSignature(key).
            Protocol::MinswapV2 => {
                let (0, [signer]) = constr(fields.first()?)? else {
                    return None;
                };
                let refund = address(fields.get(1)?)?;
                let success = address(fields.get(3)?)?;
                Some((key(signer)?, vec![refund, success]))
            }
            // [ident, OrderAddresses [Destination [address, datum?], alternate?], …]:
            // with no alternate, the destination's payment key cancels.
            Protocol::SundaeSwap => {
                let (0, [destination, alternate]) = constr(fields.get(1)?)? else {
                    return None;
                };
                if option(alternate)?.is_some() {
                    return None;
                }
                let (0, [to, datum]) = constr(destination)? else {
                    return None;
                };
                if option(datum)?.is_some() {
                    return None;
                }
                let to = address(to)?;
                Some((key_of(&to)?, vec![to]))
            }
            // [pool?, owner, max fee, destination, details, extension]:
            // owner = Signature(key), destination = Fixed { address, NoDatum }.
            Protocol::SundaeSwapV3 | Protocol::SundaeSwapStable => {
                let (0, [owner]) = constr(fields.get(1)?)? else {
                    return None;
                };
                let (0, [to, datum]) = constr(fields.get(3)?)? else {
                    return None;
                };
                let (0, []) = constr(datum)? else {
                    return None;
                };
                Some((key(owner)?, vec![address(to)?]))
            }
            // [[beneficiary, owner key, deadline, pair], action].
            Protocol::WingRiders => {
                let (0, inner) = constr(fields.first()?)? else {
                    return None;
                };
                let beneficiary = address(inner.first()?)?;
                Some((key(inner.get(1)?)?, vec![beneficiary]))
            }
            // [oil, beneficiary, owner address, …]: the owner's key reclaims.
            Protocol::WingRidersV2 | Protocol::WingRidersStableV2 => {
                let beneficiary = address(fields.get(1)?)?;
                let owner = address(fields.get(2)?)?;
                Some((key_of(&owner)?, vec![beneficiary, owner]))
            }
            // [tag, beacon, input, tradable input, cost per step, least marginal output,
            // output, base price, fee, redeemer address, cancelling key, permitted executors]:
            // 9 the redeemer address, 10 the cancelling key. Splash's script decodes all
            // twelve, so each is held to the type the real order read from chain has
            // (tests/fixtures/order_cancels.json): a datum the script couldn't decode is
            // no order the session can cancel.
            Protocol::Splash => {
                let [
                    tag,
                    beacon,
                    input,
                    tradable,
                    step_cost,
                    least_output,
                    output,
                    price,
                    fee,
                    redeemer,
                    canceller,
                    executors,
                ] = fields
                else {
                    return None;
                };
                let typed = is_bytes(tag)
                    && is_bytes(beacon)
                    && is_asset(input)
                    && is_int(tradable)
                    && is_int(step_cost)
                    && is_int(least_output)
                    && is_asset(output)
                    && is_ratio(price)
                    && is_int(fee)
                    && is_byte_list(executors);
                if !typed {
                    return None;
                }
                Some((key(canceller)?, vec![address(redeemer)?]))
            }
        }
    };
    let (signer, pays) = read().ok_or_else(unreadable)?;
    Ok(OrderRead {
        protocol,
        signer,
        pays,
    })
}

/// What an output at an order script is, if the wallet can cancel there:
/// its table entry and what its datum says. `address` is the output's
/// address bytes; `datum` its datum's CBOR. `None` for a script the table
/// doesn't hold, or an address that isn't a script's.
pub fn read_order(
    network_flag: bool,
    address: &[u8],
    datum: &[u8],
) -> Result<Option<(Entry, OrderRead)>> {
    let header = *address.first().context("An empty address")?;
    // Shelley addresses 0 to 7; an odd type pays a script.
    let kind = header >> 4;
    if kind > 7 || kind % 2 == 0 || address.len() < 29 {
        return Ok(None);
    }
    let script: [u8; 28] = address[1..29].try_into()?;
    let Some(entry) = entry(network_flag, &Hash::new(script))? else {
        return Ok(None);
    };
    let read = read(entry.protocol, datum)?;
    Ok(Some((entry, read)))
}

/// Why an output at `entry`'s order script can never be cancelled, from its
/// form alone, or `None` when its form is one its script spends: `inline`, it
/// holds its datum inline, which the ledger never lets a Plutus V1 script
/// spend; `script`, it carries a reference script, which a V1 script can't
/// spend either and the wallet's evaluator doesn't take ([`eval::refusal`]).
/// Words that follow "Order `hash#index`" or "This order". The web wallet's
/// order check (`readDexOrder`) and [`cancel_orders`] both ask it.
pub fn unspendable(entry: &Entry, inline: bool, script: bool) -> Option<&'static str> {
    if script {
        Some("carries a reference script, so the wallet can't cancel it")
    } else if inline && entry.plutus == 1 {
        Some("holds its datum inline, which its Plutus V1 script can never spend")
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Building a cancel.
// ---------------------------------------------------------------------------

/// An order to cancel: its UTxO, as Koios lists it, and its datum's CBOR,
/// the original bytes (inline, or the ones its hash names).
#[derive(Debug, Clone)]
pub struct OrderToCancel {
    pub utxo: UtxoResponse,
    pub datum: Vec<u8>,
}

/// What a cancel is built from.
pub struct Cancel<'a> {
    pub params: &'a ProtocolParameters,
    /// `true` is preprod.
    pub network_flag: bool,
    pub session: Session,
    /// The session's address, where everything goes back.
    pub address: &'a Address,
    /// The orders to cancel, every one the session's. One transaction takes
    /// the first and those that can share it ([`group`]).
    pub orders: &'a [OrderToCancel],
    /// The session's own UTxOs, which pay the fee with the orders' ADA.
    pub funds: &'a [UtxoResponse],
    /// The session's collateral: one of its ADA-only UTxOs.
    pub collateral: &'a UtxoResponse,
    /// The reference UTxOs the orders' scripts are read from, as Koios lists
    /// them with their scripts' bytes.
    pub references: &'a [UtxoResponse],
}

/// A cancel, built and measured, unsigned.
pub struct FinalCancel {
    pub tx: BuiltTransaction,
    pub fee: u64,
    /// The orders it cancels, `hash#index`.
    pub covers: Vec<String>,
    /// Whether the session's stake key must sign too.
    pub stake_signs: bool,
    /// What its scripts were measured to use, order by order as `covers`.
    pub budgets: Vec<Budget>,
}

/// One order of a cancel, read and checked.
struct Placed<'a> {
    order: &'a OrderToCancel,
    entry: Entry,
    read: OrderRead,
    input: Input,
}

/// Which of `orders` one transaction cancels, by index: the first, and,
/// unless it must go alone, every other of the same Plutus version that may
/// share it.
fn group(orders: &[(Entry, OrderRead)]) -> Vec<usize> {
    let Some((first, _)) = orders.first() else {
        return Vec::new();
    };
    if first.protocol.alone() {
        return vec![0];
    }
    orders
        .iter()
        .enumerate()
        .filter(|(_, (e, _))| e.plutus == first.plutus && !e.protocol.alone())
        .map(|(i, _)| i)
        .collect()
}

/// A rough budget for measuring a draft: what each script is let run.
const DRAFT_ORDER_BUDGET: Budget = Budget {
    mem: 2_000_000,
    steps: 1_000_000_000,
};

/// The fee a draft is staged at, to be measured: `settle`'s own first guess,
/// about what a cancel pays (0.19 to 0.3 ADA). The order scripts read neither
/// the fee nor the change, and the cancel sent is priced again. Even, so the
/// collateral's 3/2 of it is whole.
const DRAFT_FEE: u64 = 200_000;

/// A session's collateral as its funding pays one: exactly 5 ADA of ADA
/// alone, which its return puts up for Lovejoin (the web wallet's
/// `collateralFits`). A cancel that has to spend the collateral for its fee
/// leaves one behind where what's left allows.
const SESSION_COLLATERAL: u64 = 5_000_000;

/// The fee at which a cancel that spends the collateral decides whether it
/// can leave an exact one behind: more than a cancel pays (0.19 to 0.3 ADA
/// for one order), so the decision holds at the fee it settles at, and the
/// cancel's outputs don't change while its fee does.
const KEEP_AT_FEE: u64 = 1_000_000;

/// The orders' ADA and the session's funds can't pay the fee and the change.
const CANCEL_SHORT: NotEnough = NotEnough("The orders and the session can't pay the cancel's fee");

/// A Splash order's ADA all goes back in its refund, and the session's funds
/// can't pay the fee and the change.
const REFUND_SHORT: NotEnough = NotEnough("The session can't pay the cancel's fee");

/// The collateral must cover 1.5 times the fee, and what it gets back is an
/// output, held to the least one holds.
const COLLATERAL_SHORT: &str =
    "The session's collateral is too small to cover the cancel's fee and come back as an output";

/// Cancels the session's orders: the first of `c.orders` and those that can
/// share its transaction. Each must be the session's ([`Session::owns`]) at
/// a script the table holds, in a form its script spends ([`unspendable`]).
/// Everything comes back to the session's address, a Splash order's exact
/// refund first. The fee comes from the orders' ADA and the session's funds,
/// and from its collateral too only when they can't pay it and a change
/// output. Measured in the wallet.
pub fn cancel_orders(c: &Cancel) -> Result<FinalCancel> {
    let collateral_ref = format!("{}#{}", c.collateral.tx_hash, c.collateral.tx_index);
    if c.collateral
        .asset_list
        .as_ref()
        .is_some_and(|a| !a.is_empty())
        || c.collateral.inline_datum.is_some()
        || c.collateral.datum_hash.is_some()
    {
        bail!("The session's collateral must hold ADA alone");
    }

    // Read every order, and check it's the session's to cancel, in a form its
    // script can spend.
    let mut read = Vec::with_capacity(c.orders.len());
    for order in c.orders {
        let at = format!("{}#{}", order.utxo.tx_hash, order.utxo.tx_index);
        let script = hash28(&order.utxo.payment_cred)
            .with_context(|| format!("Order {at} doesn't sit at a script"))?;
        let entry = entry(c.network_flag, &script)?
            .with_context(|| format!("Order {at} sits at a script the wallet can't cancel at"))?;
        if let Some(why) = unspendable(
            &entry,
            order.utxo.inline_datum.is_some(),
            order.utxo.reference_script.is_some(),
        ) {
            bail!("Order {at} {why}");
        }
        match (&order.utxo.inline_datum, &order.utxo.datum_hash) {
            (Some(inline), _) => {
                if hex::decode(&inline.bytes)? != order.datum {
                    bail!("Order {at}'s datum isn't the one it holds");
                }
            }
            (None, Some(hash)) => {
                if hex::encode(Hasher::<256>::hash(&order.datum)) != *hash {
                    bail!("Order {at}'s datum isn't the one its hash names");
                }
            }
            (None, None) => bail!("Order {at} holds no datum"),
        }
        let order_read = self::read(entry.protocol, &order.datum)?;
        if !c.session.owns(&order_read) {
            bail!("Order {at} isn't this session's to cancel");
        }
        read.push((entry, order_read));
    }
    let chosen = group(&read);
    if chosen.is_empty() {
        bail!("There's no order to cancel");
    }
    let placed: Vec<Placed> = chosen
        .iter()
        .map(|&i| {
            let (entry, read) = read[i].clone();
            Ok(Placed {
                order: &c.orders[i],
                input: input_of(&c.orders[i].utxo)?,
                entry,
                read,
            })
        })
        .collect::<Result<_>>()?;
    let version = placed[0].entry.plutus;

    // The scripts: by reference, each checked against the table, or carried:
    // a Plutus V1 script's bundled bytes, and a reference's spent since.
    let mut scripts = Scripts {
        references: BTreeMap::new(),
        carried: BTreeMap::new(),
    };
    for p in &placed {
        if let Some(bytes) = &p.entry.inline {
            scripts.carried.insert(p.entry.script, bytes.clone());
            continue;
        }
        let at = p
            .entry
            .reference_outpoint()
            .context("A script with nowhere to read it from")?;
        if scripts.references.contains_key(&at) || scripts.carried.contains_key(&p.entry.script) {
            continue;
        }
        let row = c
            .references
            .iter()
            .find(|r| format!("{}#{}", r.tx_hash, r.tx_index) == at)
            .with_context(|| {
                format!("The wallet doesn't have {at}, where the order's script is read from")
            })?;
        let bytes = row
            .reference_script
            .as_ref()
            .and_then(|s| s.bytes.as_deref())
            .map(hex::decode)
            .transpose()?
            .with_context(|| format!("{at} holds no script"))?;
        if script_hash(version, &bytes) != p.entry.script {
            bail!("{at} doesn't hold the order's script");
        }
        // Spent by whoever held it (SundaeSwap V3's mainnet reference sits at
        // Sundae's own key), it still gives its script: checked against the
        // pinned hash above, the transaction carries it instead.
        if row.is_spent {
            scripts.carried.insert(p.entry.script, bytes);
            continue;
        }
        let size = p.entry.reference.map_or(0, |(_, _, size)| size);
        scripts.references.insert(
            at,
            (
                input_of(row)?,
                eval::resolve_reference(row, version, &bytes)?,
                size,
            ),
        );
    }
    if version == 1 && !scripts.references.is_empty() {
        bail!("A Plutus V1 script can't be read by reference");
    }

    // The fee comes from the orders' ADA (bar Splash's, refunded whole) and
    // the session's funds; from the collateral too, only when they can't pay
    // it and a change output.
    let funds: Vec<&UtxoResponse> = c
        .funds
        .iter()
        .filter(|u| format!("{}#{}", u.tx_hash, u.tx_index) != collateral_ref)
        .collect();
    match build_cancel(c, &placed, &scripts, &funds, false) {
        Err(e) if is_short(&e) => build_cancel(c, &placed, &scripts, &funds, true),
        built => built,
    }
}

/// A cancel's scripts: those read by reference (each reference UTxO, as the
/// evaluator needs it, and its script's size), and those it carries, by
/// hash.
struct Scripts {
    references: BTreeMap<String, (Input, Resolved, u64)>,
    carried: BTreeMap<Hash<28>, Vec<u8>>,
}

/// [`cancel_orders`]' transaction, built and measured: the orders `placed`,
/// paid for by the session's `funds` (its collateral not among them) and,
/// when `spend_collateral`, its collateral too.
fn build_cancel(
    c: &Cancel,
    placed: &[Placed],
    scripts: &Scripts,
    funds: &[&UtxoResponse],
    spend_collateral: bool,
) -> Result<FinalCancel> {
    let version = placed[0].entry.plutus;
    let splash = placed[0].entry.protocol.alone();
    let mut spent: Vec<UtxoResponse> = placed.iter().map(|p| p.order.utxo.clone()).collect();
    spent.extend(funds.iter().map(|u| (*u).clone()));
    if spend_collateral {
        spent.push(c.collateral.clone());
    }
    for row in spent.iter().skip(placed.len()) {
        if row.inline_datum.is_some() || row.datum_hash.is_some() || row.reference_script.is_some()
        {
            bail!(
                "UTxO {}#{} holds a datum or a script, so a cancel can't spend it",
                row.tx_hash,
                row.tx_index
            );
        }
    }
    let (lovelace_in, tokens_in) = assets_of(spent.clone())?;
    let refund = if splash {
        let (lovelace, tokens) = assets_of(vec![placed[0].order.utxo.clone()])?;
        Some((lovelace, tokens))
    } else {
        None
    };
    let collateral_lovelace: u64 = c
        .collateral
        .value
        .parse()
        .context("The collateral's value can't be read")?;
    // What the collateral gives back is an output too, which the ledger holds
    // to the least one holds.
    let bech32 = c
        .address
        .to_bech32()
        .map_err(|e| anyhow!("The session's address can't be written: {e}"))?;
    let least_back = address_minimum_lovelace_with_assets(c.params, &bech32, Assets::new())?;

    let mut signers: BTreeSet<Hash<28>> = placed.iter().map(|p| p.read.signer).collect();
    let stake_signs = signers.contains(&c.session.stake);
    // The payment key signs for the session's funds and collateral anyway.
    signers.insert(c.session.payment);

    let kind = match version {
        1 => ScriptKind::PlutusV1,
        2 => ScriptKind::PlutusV2,
        _ => ScriptKind::PlutusV3,
    };
    let model = match version {
        1 => c.params.cost_model_v1.clone(),
        2 => c.params.cost_model_v2.clone(),
        _ => c.params.cost_model_v3.clone(),
    };
    if model.is_empty() {
        bail!("Koios gave no Plutus V{version} cost model, so the cancel can't be priced");
    }

    // What comes back besides a Splash refund. A collateral spent for the fee
    // leaves an exact one behind where what's left allows (5 ADA, and the rest
    // an output of its own), so the session's return still finds one to put
    // up for Lovejoin: decided once, at a fee above what the cancel pays.
    let refunded_lovelace = refund.as_ref().map_or(0, |(lovelace, _)| *lovelace);
    let kept_tokens = match &refund {
        Some((_, refunded)) => tokens_in.separate(refunded.clone())?,
        None => tokens_in.clone(),
    };
    let keep = spend_collateral
        && lovelace_in
            .checked_sub(refunded_lovelace + KEEP_AT_FEE + SESSION_COLLATERAL)
            .and_then(|rest| {
                change_outputs(c.params, c.address, rest, &kept_tokens, CANCEL_SHORT).ok()
            })
            .is_some_and(|rest| !rest.is_empty());
    let change = |remaining: u64, tokens: &Assets| -> Result<Vec<Output>> {
        if keep
            && let Some(rest) = remaining.checked_sub(SESSION_COLLATERAL)
            && let Ok(rest) = change_outputs(c.params, c.address, rest, tokens, CANCEL_SHORT)
        {
            let mut outputs = vec![Output::new(c.address.clone(), SESSION_COLLATERAL)];
            outputs.extend(rest);
            return Ok(outputs);
        }
        change_outputs(c.params, c.address, remaining, tokens, CANCEL_SHORT)
    };

    let stage = |fee: u64, budgets: Option<&[Budget]>| -> Result<StagingTransaction> {
        let mut tx = StagingTransaction::new();
        for row in &spent {
            tx = tx.input(input_of(row)?);
        }
        for (input, _, _) in scripts.references.values() {
            tx = tx.reference_input(input.clone());
        }
        // A Splash order's refund is output 0, its own value exactly.
        let mut remaining = lovelace_in.checked_sub(fee).ok_or(CANCEL_SHORT)?;
        let mut tokens: Assets = tokens_in.clone();
        if let Some((lovelace, refunded)) = &refund {
            let mut out = Output::new(c.address.clone(), *lovelace);
            for asset in &refunded.items {
                out = out
                    .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                    .context("Failed To Add An Asset")?;
            }
            tx = tx.output(out);
            remaining = remaining.checked_sub(*lovelace).ok_or(REFUND_SHORT)?;
            tokens = tokens.separate(refunded.clone())?;
        }
        for out in change(remaining, &tokens)? {
            tx = tx.output(out);
        }
        for (i, p) in placed.iter().enumerate() {
            let b = budgets.map_or(DRAFT_ORDER_BUDGET, |b| b[i]);
            tx = tx.add_spend_redeemer(
                p.input.clone(),
                p.entry.protocol.cancel_redeemer(),
                Some(ExUnits {
                    mem: b.mem,
                    steps: b.steps,
                }),
            );
            if p.order.utxo.inline_datum.is_none() {
                tx = tx.datum(p.order.datum.clone());
            }
        }
        // A group is of one Plutus version, so every carried script is too.
        for bytes in scripts.carried.values() {
            tx = tx.script(kind, bytes.clone());
        }
        for signer in &signers {
            tx = tx.disclosed_signer(*signer);
        }
        // Collateral: 3/2 of the fee, the rest back.
        let held = fee.checked_mul(3).context("Fee overflow")? / 2;
        let back = collateral_lovelace
            .checked_sub(held)
            .filter(|back| *back >= least_back)
            .context(COLLATERAL_SHORT)?;
        Ok(tx
            .language_view(kind, model.clone())
            .collateral_input(input_of(c.collateral)?)
            .collateral_output(Output::new(c.address.clone(), back))
            .fee(fee))
    };

    // Measure: a draft at a first guess at the fee, then the cancel as it
    // will be sent.
    let mut known: Vec<Resolved> = spent.iter().map(eval::resolve_row).collect::<Result<_>>()?;
    if !spend_collateral {
        known.push(eval::resolve_row(c.collateral)?);
    }
    known.extend(scripts.references.values().map(|(_, r, _)| r.clone()));
    let positions = ledger_positions(&spent, placed)?;
    let measure = |tx: &BuiltTransaction| -> Result<Vec<Budget>> {
        let answer = eval::evaluate_with(
            &tx.tx_bytes.0,
            &known,
            &c.params.cost_model_v1,
            &c.params.cost_model_v2,
            &c.params.cost_model_v3,
            c.network_flag,
        )?;
        // A cancel runs no script but its orders': one refusing it is a DEX's.
        if let Some(error) = answer.get("error") {
            bail!(order_refusal(error, &positions, placed));
        }
        let measured = Budgets::from_ogmios(&answer)?;
        positions
            .iter()
            .map(|index| {
                measured
                    .spend(*index)
                    .with_context(|| format!("No budget was measured for input {index}"))
            })
            .collect()
    };
    let draft = stage(DRAFT_FEE, None)?
        .build_conway_raw()
        .context("Failed To Build The Draft Cancel")?;
    let mut budgets = measure(&draft)?;
    let reference_bytes: u64 = scripts.references.values().map(|(_, _, size)| *size).sum();
    let script_reference = reference_script_fee(c.params, reference_bytes)?;
    let vkeys = signers.len();
    for _ in 0..3 {
        let total = budgets
            .iter()
            .fold(Budget { mem: 0, steps: 0 }, |a, b| Budget {
                mem: a.mem + b.mem,
                steps: a.steps + b.steps,
            });
        if total.mem > MAX_TX_BUDGET.mem || total.steps > MAX_TX_BUDGET.steps {
            bail!(
                "Cancelling these orders at once needs more computation than a transaction may use"
            );
        }
        let compute: u64 = budgets
            .iter()
            .map(|b| computation_fee(c.params, b.mem, b.steps))
            .sum();
        let (fee, staged) = settle(
            vkeys,
            Patches::staking(&Staking::none()),
            |size| even(linear_fee(c.params, size) + compute + script_reference),
            |fee| stage(fee, Some(&budgets)),
        )?;
        let tx = with_integrity(
            staged
                .build_conway_raw()
                .context("Failed To Build The Cancel")?,
            version,
            &model,
        )?;
        let used = measure(&tx)?;
        if budgets
            .iter()
            .zip(&used)
            .all(|(ours, theirs)| ours.mem >= theirs.mem && ours.steps >= theirs.steps)
        {
            return Ok(FinalCancel {
                tx,
                fee,
                covers: placed
                    .iter()
                    .map(|p| format!("{}#{}", p.order.utxo.tx_hash, p.order.utxo.tx_index))
                    .collect(),
                stake_signs,
                budgets,
            });
        }
        // The finished cancel's scripts used a hair more than the draft's.
        budgets = used
            .iter()
            .map(|b| Budget {
                mem: b.mem + b.mem.div_ceil(100),
                steps: b.steps + b.steps.div_ceil(100),
            })
            .collect();
    }
    bail!("The cancel's script budgets did not settle")
}

/// The evaluator's `error` (in Ogmios's shape) when an order's own script
/// refused the cancel, in words naming the DEX and the order, never the
/// Seedelf contract, as `Budgets::from_ogmios` would put a failed spend: a
/// cancel runs no script but its orders'. `positions` are the orders' spent
/// inputs in the ledger's order, as `placed`. It starts with an ordinary
/// word, which the web wallet lowers to fit it into its own sentence.
fn order_refusal(error: &Value, positions: &[u64], placed: &[Placed]) -> String {
    let failures: Vec<String> = error
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let reason = item
                .pointer("/error/data/validationError")
                .and_then(Value::as_str)
                .and_then(|e| e.lines().map(str::trim).rfind(|l| !l.is_empty()))
                .or_else(|| item.pointer("/error/message").and_then(Value::as_str))
                .unwrap_or("failed");
            let spend = item.pointer("/validator/purpose").and_then(Value::as_str) == Some("spend");
            let index = item.pointer("/validator/index").and_then(Value::as_u64)?;
            let order = positions
                .iter()
                .position(|p| spend && *p == index)
                .map(|k| &placed[k]);
            Some(match order {
                Some(p) => format!(
                    "{} order {}#{}: {reason}",
                    p.entry.protocol.name(),
                    p.order.utxo.tx_hash,
                    p.order.utxo.tx_index
                ),
                None => reason.to_string(),
            })
        })
        .collect();
    if failures.is_empty() {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("no reason given");
        format!("The wallet couldn't run the cancel's scripts: {message}")
    } else {
        format!(
            "The DEX's order script refused the wallet's cancel ({})",
            failures.join("; ")
        )
    }
}

// ---------------------------------------------------------------------------
// Checking a swap's orders before the session signs it.
// ---------------------------------------------------------------------------

/// What a swap places, checked before the session's key signs it
/// ([`check_cancels`]).
pub struct SwapCheck<'a> {
    pub params: &'a ProtocolParameters,
    /// `true` is preprod.
    pub network_flag: bool,
    pub session: Session,
    /// The session's address, where a cancel pays everything back.
    pub address: &'a Address,
    /// The swap, as built: neither signed nor on chain.
    pub tx_cbor: &'a [u8],
    /// Its orders' output indexes.
    pub orders: &'a [u64],
    /// The reference UTxOs the orders' scripts are read from, as Koios lists
    /// them (spent or not) with their scripts' bytes.
    pub references: &'a [UtxoResponse],
}

/// One order a swap places, and whether the wallet's own cancel of it builds
/// and runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancelCheck {
    /// Its output's index in the swap.
    pub index: u64,
    /// `hash#index`: the order, once the swap is on chain.
    pub order: String,
    /// The DEX whose order script it sits at, when the table holds that.
    pub protocol: Option<Protocol>,
    /// What its cancel pays in fees, when it builds.
    pub fee: Option<u64>,
    /// Why its cancel can't be built, or its script refuses it.
    pub why: Option<String>,
}

/// The ADA-alone UTxO a dry run's cancel pays its fee from: more than any
/// cancel may pay ([`crate::build::MAX_FEE`]) and its change, so the check is
/// of the order and its script, not of what the session will hold.
const CHECK_FUNDS: u64 = 20_000_000;

/// Builds the cancel of each order a swap places, each alone, as Stop builds
/// it once the swap is on chain ([`cancel_orders`]), and runs the order's
/// own script in the wallet's evaluator, before the session signs the swap.
/// An order its cancel can't spend (a datum its script can't decode, its
/// datum inline at a Plutus V1 script, a script on it) would keep the swap's
/// money where Stop can't bring it back. The session's funds and collateral
/// are stand-ins of ADA alone at its address. A swap that can't be read is an
/// error; anything about one order is that order's `why`.
pub fn check_cancels(s: &SwapCheck) -> Result<Vec<CancelCheck>> {
    let tx = MultiEraTx::decode(s.tx_cbor).map_err(|e| anyhow!("The swap can't be read: {e}"))?;
    let swap = tx.hash();
    let fund = stand_in(s.address, &swap, 0, CHECK_FUNDS)?;
    let collateral = stand_in(s.address, &swap, 1, SESSION_COLLATERAL)?;
    let mut checks = Vec::with_capacity(s.orders.len());
    for &index in s.orders {
        let mut check = CancelCheck {
            index,
            order: format!("{swap}#{index}"),
            protocol: None,
            fee: None,
            why: None,
        };
        match order_at(&tx, index) {
            Err(e) => check.why = Some(format!("{e:#}")),
            Ok(order) => {
                check.protocol = hash28(&order.utxo.payment_cred)
                    .ok()
                    .and_then(|script| entry(s.network_flag, &script).ok().flatten())
                    .map(|e| e.protocol);
                match cancel_orders(&Cancel {
                    params: s.params,
                    network_flag: s.network_flag,
                    session: s.session,
                    address: s.address,
                    orders: std::slice::from_ref(&order),
                    funds: std::slice::from_ref(&fund),
                    collateral: &collateral,
                    references: s.references,
                }) {
                    Ok(built) => check.fee = Some(built.fee),
                    Err(e) => check.why = Some(format!("{e:#}")),
                }
            }
        }
        checks.push(check);
    }
    Ok(checks)
}

/// Output `index` of `tx`, a swap not on chain yet, in the shape of the Koios
/// row it will have once it is, with its datum's bytes: inline, or the ones
/// the swap carries for its hash.
fn order_at(tx: &MultiEraTx, index: u64) -> Result<OrderToCancel> {
    let output = usize::try_from(index)
        .ok()
        .and_then(|i| tx.output_at(i))
        .with_context(|| format!("The swap has no output {index}"))?;
    let address = output
        .address()
        .map_err(|e| anyhow!("The swap's output {index} has an unreadable address: {e}"))?;
    let payment_cred = match &address {
        Address::Shelley(a) if a.payment().is_script() => hex::encode(a.payment().as_hash()),
        _ => String::new(),
    };
    let address = address
        .to_bech32()
        .map_err(|e| anyhow!("The swap's output {index} has an unreadable address: {e}"))?;
    let value = output.value();
    let mut asset_list = Vec::new();
    for policy in value.assets() {
        for asset in policy.assets() {
            asset_list.push(KoiosAsset {
                decimals: 0,
                quantity: asset.output_coin().unwrap_or(0).to_string(),
                policy_id: hex::encode(policy.policy()),
                asset_name: hex::encode(asset.name()),
                fingerprint: String::new(),
            });
        }
    }
    let (inline_datum, datum_hash, datum) = match output.datum() {
        Some(PseudoDatumOption::Data(data)) => {
            let bytes = data.raw_cbor().to_vec();
            let inline = InlineDatum {
                bytes: hex::encode(&bytes),
                value: Value::Null,
            };
            (Some(inline), None, bytes)
        }
        Some(PseudoDatumOption::Hash(hash)) => {
            let carried = tx
                .plutus_data()
                .iter()
                .find(|d| Hasher::<256>::hash(d.raw_cbor()) == hash)
                .with_context(|| {
                    format!("The swap doesn't carry the datum its output {index} names")
                })?;
            (None, Some(hex::encode(hash)), carried.raw_cbor().to_vec())
        }
        None => (None, None, Vec::new()),
    };
    let reference_script = output.script_ref().map(|script| {
        let (kind, bytes) = match &script {
            PseudoScript::NativeScript(s) => ("timelock", s.raw_cbor().to_vec()),
            PseudoScript::PlutusV1Script(s) => ("plutusV1", s.as_ref().to_vec()),
            PseudoScript::PlutusV2Script(s) => ("plutusV2", s.as_ref().to_vec()),
            PseudoScript::PlutusV3Script(s) => ("plutusV3", s.as_ref().to_vec()),
        };
        ReferenceScript {
            hash: None,
            size: Some(bytes.len() as u64),
            kind: Some(kind.to_string()),
            bytes: Some(hex::encode(bytes)),
        }
    });
    Ok(OrderToCancel {
        utxo: UtxoResponse {
            tx_hash: hex::encode(tx.hash()),
            tx_index: index,
            address,
            value: value.coin().to_string(),
            payment_cred,
            datum_hash,
            inline_datum,
            reference_script,
            asset_list: Some(asset_list),
            ..Default::default()
        },
        datum,
    })
}

/// One of the session's UTxOs of ADA alone, made up for a dry run: at an
/// outpoint no transaction has, the hash of the swap's own id and `tag`.
fn stand_in(address: &Address, swap: &Hash<32>, tag: u8, lovelace: u64) -> Result<UtxoResponse> {
    let mut seed = swap.to_vec();
    seed.push(tag);
    Ok(UtxoResponse {
        tx_hash: hex::encode(Hasher::<256>::hash(&seed)),
        tx_index: 0,
        address: address
            .to_bech32()
            .map_err(|e| anyhow!("The session's address can't be written: {e}"))?,
        value: lovelace.to_string(),
        ..Default::default()
    })
}

/// A transaction's script data hash, as the ledger checks it: its redeemers
/// and its witness datums, each exactly as the transaction encodes them, then
/// the language view of the one Plutus version it runs (`version`, 1 to 3).
/// Plutus V1's view is the legacy one: its key the CBOR of 0 as bytes, its
/// cost model an indefinite list inside a byte string.
pub fn integrity_hash(
    redeemers_cbor: &[u8],
    datums_cbor: Option<&[u8]>,
    version: u8,
    model: &[i64],
) -> Result<Hash<32>> {
    let mut preimage = redeemers_cbor.to_vec();
    if let Some(datums) = datums_cbor {
        preimage.extend_from_slice(datums);
    }
    let mut view = minicbor::Encoder::new(Vec::new());
    let encoded = if version == 1 {
        let mut inner = minicbor::Encoder::new(Vec::new());
        inner
            .begin_array()
            .and_then(|e| {
                for cost in model {
                    e.i64(*cost)?;
                }
                e.end()
            })
            .map_err(|e| anyhow!("The cost model can't be encoded: {e}"))?;
        view.map(1)
            .and_then(|e| e.bytes(&[0x00]))
            .and_then(|e| e.bytes(&inner.into_writer()))
            .map(|_| ())
    } else {
        view.map(1)
            .and_then(|e| e.u8(version - 1))
            .and_then(|e| e.encode(model))
            .map(|_| ())
    };
    encoded.map_err(|e| anyhow!("The language view can't be encoded: {e}"))?;
    preimage.extend(view.into_writer());
    Ok(Hasher::<256>::hash(&preimage))
}

/// `built` with the script data hash the ledger computes from its own
/// witness bytes. Pallas hashes witness datums as a plain list but writes them
/// as a tagged set, so a cancel carrying a datum (a Plutus V1 order's) would
/// be refused at submit without this.
fn with_integrity(
    mut built: BuiltTransaction,
    version: u8,
    model: &[i64],
) -> Result<BuiltTransaction> {
    let mut tx = conway::Tx::decode_fragment(&built.tx_bytes.0)
        .map_err(|e| anyhow!("The built cancel isn't a Conway transaction: {e}"))?;
    let witness = &tx.transaction_witness_set;
    let redeemers = witness
        .redeemer
        .as_ref()
        .context("The cancel has no redeemers")?;
    let redeemers_cbor =
        minicbor::to_vec(redeemers).map_err(|e| anyhow!("The redeemers can't be encoded: {e}"))?;
    let datums_cbor = witness
        .plutus_data
        .as_ref()
        .map(minicbor::to_vec)
        .transpose()
        .map_err(|e| anyhow!("The datums can't be encoded: {e}"))?;
    tx.transaction_body.script_data_hash = Some(integrity_hash(
        &redeemers_cbor,
        datums_cbor.as_deref(),
        version,
        model,
    )?);
    let bytes = tx
        .encode_fragment()
        .map_err(|e| anyhow!("Failed to encode the cancel: {e}"))?;
    built.tx_hash.0 = *tx_id(&bytes).context("The cancel can't be hashed")?;
    built.tx_bytes.0 = bytes;
    Ok(built)
}

/// Where each order sits among the spent inputs, in the ledger's order: the
/// index its spend redeemer carries.
fn ledger_positions(spent: &[UtxoResponse], placed: &[Placed]) -> Result<Vec<u64>> {
    let mut order: Vec<Input> = spent.iter().map(input_of).collect::<Result<_>>()?;
    order.sort_by_key(|i| (i.tx_hash.0, i.txo_index));
    placed
        .iter()
        .map(|p| {
            order
                .iter()
                .position(|i| *i == p.input)
                .map(|x| x as u64)
                .context("An order is missing from the cancel")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An order of `protocol` at a script of Plutus `plutus`, as [`group`]
    /// sees it.
    fn order(protocol: Protocol, plutus: u8) -> (Entry, OrderRead) {
        (
            Entry {
                protocol,
                script: Hash::new([plutus; 28]),
                plutus,
                reference: None,
                inline: None,
            },
            OrderRead {
                protocol,
                signer: Hash::new([0; 28]),
                pays: Vec::new(),
            },
        )
    }

    #[test]
    fn a_cancel_takes_the_first_order_and_those_of_its_plutus_version() {
        use Protocol::*;
        let group_of = |orders: &[(Protocol, u8)]| {
            group(&orders.iter().map(|&(p, v)| order(p, v)).collect::<Vec<_>>())
        };
        // One language view a transaction: the first order's version, wherever the others sit.
        assert_eq!(
            group_of(&[(MinswapV2, 2), (Minswap, 1), (WingRidersV2, 2)]),
            [0, 2]
        );
        assert_eq!(
            group_of(&[(Minswap, 1), (MinswapV2, 2), (SundaeSwap, 1)]),
            [0, 2]
        );
        assert_eq!(
            group_of(&[(SundaeSwapStable, 3), (MinswapV2, 2), (SundaeSwapStable, 3)]),
            [0, 2]
        );
        // A Splash order goes alone, first or not.
        assert_eq!(group_of(&[(Splash, 2), (MinswapV2, 2), (Splash, 2)]), [0]);
        assert_eq!(
            group_of(&[(MinswapV2, 2), (Splash, 2), (SundaeSwapV3, 2)]),
            [0, 2]
        );
        assert!(group_of(&[]).is_empty());
    }
}
