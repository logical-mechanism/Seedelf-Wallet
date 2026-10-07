//! The DEX orders a private session places through Minswap's aggregator, read
//! exactly, and their cancels, built in the wallet (chunk 24, Step 3 in
//! `seedelf-web-wallet/docs/plans/chunk-24-dapp-additions.md`).
//!
//! Minswap's `cancel-tx` route answers 404 on both networks (2026-10-07), and
//! its `pending-orders` doesn't list every order, so a session can't count on
//! Minswap to get its money back. Every order a session places sits at a
//! script this table knows ([`read_order`]; the web wallet's order check
//! refuses any other), owned by the session's own key, and [`cancel_orders`]
//! spends it back with the session's own keys and collateral.
//!
//! The table (`orders.json`) pins each DEX's order script by network: its
//! Plutus version, and where the script is read from, a reference UTxO
//! (checked on chain) or, for a Plutus V1 script, bytes bundled here, which
//! the transaction carries. What each cancel needs was read from real owner
//! cancels on chain, and each DEX's source or bytecode, on 2026-10-07: no
//! validity interval, withdrawal or mint; the canceller's key a required
//! signer; Splash's refund first and exact.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, anyhow, bail};
use pallas_addresses::Address;
use pallas_codec::minicbor;
use pallas_crypto::hash::{Hash, Hasher};
use pallas_primitives::Fragment;
use pallas_primitives::conway::{self, PlutusData};
use pallas_txbuilder::{
    BuildConway, BuiltTransaction, ExUnits, Input, Output, ScriptKind, StagingTransaction,
};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use serde::Deserialize;

use crate::assets::Assets;
use crate::build::{
    Budget, Budgets, MAX_TX_BUDGET, NotEnough, Patches, change_outputs, even, input_of, linear_fee,
    reference_script_fee, settle, tx_id,
};
use crate::eval::{self, Resolved};
use crate::staking::Staking;
use crate::transaction::computation_fee;
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

/// Reads `protocol`'s order datum: who cancels it, and whom it pays.
pub fn read(protocol: Protocol, datum: &[u8]) -> Result<OrderRead> {
    let unreadable = || {
        anyhow!(
            "This {} order's details aren't in the shape the wallet reads",
            protocol.name()
        )
    };
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
            // Twelve fields: 9 the redeemer address, 10 the cancelling key.
            Protocol::Splash => {
                if fields.len() != 12 {
                    return None;
                }
                Some((key(&fields[10])?, vec![address(&fields[9])?]))
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

/// Cancels the session's orders: the first of `c.orders` and those that can
/// share its transaction. Each must be the session's ([`Session::owns`]) at
/// a script the table holds. Everything comes back to the session's
/// address, a Splash order's exact refund first; the fee comes from the
/// orders' ADA and the session's funds. Measured in the wallet.
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

    // Read every order, and check it's the session's to cancel.
    let mut read = Vec::with_capacity(c.orders.len());
    for order in c.orders {
        let at = format!("{}#{}", order.utxo.tx_hash, order.utxo.tx_index);
        let script = hash28(&order.utxo.payment_cred)
            .with_context(|| format!("Order {at} doesn't sit at a script"))?;
        let entry = entry(c.network_flag, &script)?
            .with_context(|| format!("Order {at} sits at a script the wallet can't cancel at"))?;
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
    let splash = placed[0].entry.protocol.alone();

    // The scripts: by reference, each checked against the table, or carried.
    let mut references: BTreeMap<String, (Input, Resolved, u64)> = BTreeMap::new();
    let mut carried: BTreeMap<Hash<28>, Vec<u8>> = BTreeMap::new();
    for p in &placed {
        if let Some(bytes) = &p.entry.inline {
            carried.insert(p.entry.script, bytes.clone());
            continue;
        }
        let at = p
            .entry
            .reference_outpoint()
            .context("A script with nowhere to read it from")?;
        if references.contains_key(&at) {
            continue;
        }
        let row = c
            .references
            .iter()
            .find(|r| format!("{}#{}", r.tx_hash, r.tx_index) == at)
            .with_context(|| {
                format!("The wallet doesn't have {at}, where the order's script is read from")
            })?;
        if row.is_spent {
            bail!("{at}, where the order's script was read from, has been spent");
        }
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
        let size = p.entry.reference.map_or(0, |(_, _, size)| size);
        references.insert(
            at,
            (
                input_of(row)?,
                eval::resolve_reference(row, version, &bytes)?,
                size,
            ),
        );
    }
    if version == 1 && !references.is_empty() {
        bail!("A Plutus V1 script can't be read by reference");
    }

    // The fee comes from the orders' ADA (bar Splash's, refunded whole) and
    // the session's funds; the collateral too when nothing else can pay.
    let funds: Vec<&UtxoResponse> = c
        .funds
        .iter()
        .filter(|u| format!("{}#{}", u.tx_hash, u.tx_index) != collateral_ref)
        .collect();
    let spend_collateral = splash && funds.is_empty();
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

    let stage = |fee: u64, budgets: Option<&[Budget]>| -> Result<StagingTransaction> {
        let mut tx = StagingTransaction::new();
        for row in &spent {
            tx = tx.input(input_of(row)?);
        }
        for (input, _, _) in references.values() {
            tx = tx.reference_input(input.clone());
        }
        // A Splash order's refund is output 0, its own value exactly.
        let mut remaining = lovelace_in
            .checked_sub(fee)
            .context("The orders and the session can't pay the cancel's fee")?;
        let mut tokens: Assets = tokens_in.clone();
        if let Some((lovelace, refunded)) = &refund {
            let mut out = Output::new(c.address.clone(), *lovelace);
            for asset in &refunded.items {
                out = out
                    .add_asset(asset.policy_id, asset.token_name.clone(), asset.amount)
                    .context("Failed To Add An Asset")?;
            }
            tx = tx.output(out);
            remaining = remaining
                .checked_sub(*lovelace)
                .context("The session can't pay the cancel's fee")?;
            tokens = tokens.separate(refunded.clone())?;
        }
        for out in change_outputs(
            c.params,
            c.address,
            remaining,
            &tokens,
            NotEnough("The orders and the session can't pay the cancel's fee"),
        )? {
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
        for bytes in carried.values() {
            tx = tx.script(ScriptKind::PlutusV1, bytes.clone());
        }
        for signer in &signers {
            tx = tx.disclosed_signer(*signer);
        }
        // Collateral: 3/2 of the fee, the rest back.
        let held = fee.checked_mul(3).context("Fee overflow")? / 2;
        let back = collateral_lovelace
            .checked_sub(held)
            .context("The session's collateral can't cover the cancel's fee")?;
        Ok(tx
            .language_view(kind, model.clone())
            .collateral_input(input_of(c.collateral)?)
            .collateral_output(Output::new(c.address.clone(), back))
            .fee(fee))
    };

    // Measure: a draft at a generous fee, then the cancel as it will be sent.
    let mut known: Vec<Resolved> = spent.iter().map(eval::resolve_row).collect::<Result<_>>()?;
    known.push(eval::resolve_row(c.collateral)?);
    known.extend(references.values().map(|(_, r, _)| r.clone()));
    let measure = |tx: &BuiltTransaction| -> Result<Vec<Budget>> {
        let answer = eval::evaluate_with(
            &tx.tx_bytes.0,
            &known,
            &c.params.cost_model_v1,
            &c.params.cost_model_v2,
            &c.params.cost_model_v3,
            c.network_flag,
        )?;
        let measured = Budgets::from_ogmios(&answer)?;
        let order = ledger_positions(&spent, &placed)?;
        order
            .iter()
            .map(|index| {
                measured
                    .spend(*index)
                    .with_context(|| format!("No budget was measured for input {index}"))
            })
            .collect()
    };
    let draft = stage(even(1_000_000), None)?
        .build_conway_raw()
        .context("Failed To Build The Draft Cancel")?;
    let mut budgets = measure(&draft)?;
    let reference_bytes: u64 = references.values().map(|(_, _, size)| *size).sum();
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
