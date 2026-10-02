//! The dApp connector (CIP-30) for the public account: what a dApp is shown,
//! in CIP-30's encodings, what a dApp's transaction does to the account
//! (read before the user is asked to sign it), and the signing itself, of
//! transactions and of data (CIP-8). The keys stay in this module.
//!
//! Only the public account is ever offered: its payment keys in the range
//! discovery found, and its stake key. The Seedelf key is never used here.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use anyhow::{Result, anyhow, bail};
use pallas_addresses::byron::AddrAttrProperty;
use pallas_addresses::{
    Address, Network as AddressNetwork, ShelleyDelegationPart, ShelleyPaymentPart, StakePayload,
};
use pallas_codec::minicbor::{self, Encoder};
use pallas_codec::utils::Nullable;
use pallas_crypto::hash::Hash;
use pallas_primitives::{Fragment, Metadatum, StakeCredential, conway};
use seedelf_core::address::wallet_contract;
use seedelf_core::build;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_core::staking::{drep_id, pool_id};
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::register::Register;
use serde::{Deserialize, Serialize};

/// Where one of the account's keys sits: 0 the receive chain, 1 change, and
/// the index on it.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct KeyPath {
    pub role: u32,
    pub index: u32,
}

/// A token and a quantity, hex names, the quantity as a decimal string
/// (signed where it's a change).
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub policy_id: String,
    pub asset_name: String,
    pub quantity: String,
}

/// A UTxO as Koios returns it, with only what the connector reads.
#[derive(Deserialize, Clone, Debug)]
pub struct KoiosRow {
    pub tx_hash: String,
    pub tx_index: u64,
    pub address: String,
    pub value: String,
    #[serde(default)]
    pub datum_hash: Option<String>,
    #[serde(default)]
    pub inline_datum: Option<InlineDatum>,
    #[serde(default)]
    pub asset_list: Option<Vec<KoiosAsset>>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct InlineDatum {
    pub bytes: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct KoiosAsset {
    pub policy_id: String,
    pub asset_name: String,
    pub quantity: String,
}

pub(crate) fn network_flag(network: &str) -> Result<bool> {
    match network {
        "preprod" => Ok(true),
        "mainnet" => Ok(false),
        other => bail!("unknown network {other:?}"),
    }
}

fn address_network(network_flag: bool) -> AddressNetwork {
    if network_flag {
        AddressNetwork::Testnet
    } else {
        AddressNetwork::Mainnet
    }
}

/// The network an address is for, as the ledger reads it. A Byron address
/// says so in its attributes, which Pallas doesn't read for it: a network
/// magic for a test network, and none for mainnet.
fn network_of(address: &Address) -> Result<AddressNetwork> {
    Ok(match address {
        Address::Shelley(s) => s.network(),
        Address::Stake(s) => s.network(),
        Address::Byron(b) => {
            let payload = b.decode().map_err(|e| anyhow!("{e}"))?;
            if payload
                .attributes
                .iter()
                .any(|a| matches!(a, AddrAttrProperty::NetworkTag(_)))
            {
                AddressNetwork::Testnet
            } else {
                AddressNetwork::Mainnet
            }
        }
    })
}

type Enc = Encoder<Vec<u8>>;

/// An asset name in canonical order: its length, then its bytes.
type NameKey<'a> = (usize, &'a [u8]);

/// Writing to a `Vec` can't fail; this keeps the encoders' `?` short.
fn cbor(
    write: impl FnOnce(&mut Enc) -> Result<(), minicbor::encode::Error<std::convert::Infallible>>,
) -> Vec<u8> {
    let mut e = Encoder::new(Vec::new());
    write(&mut e).expect("writing CBOR to memory never fails");
    e.into_writer()
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/// ADA and tokens, keyed by (policy, name) in bytes.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Amount {
    pub lovelace: u64,
    pub tokens: BTreeMap<(Vec<u8>, Vec<u8>), u64>,
}

impl Amount {
    fn add_token(&mut self, policy: Vec<u8>, name: Vec<u8>, quantity: u64) -> Result<()> {
        let held = self.tokens.entry((policy, name)).or_default();
        *held = held
            .checked_add(quantity)
            .ok_or_else(|| anyhow!("a token amount overflows"))?;
        Ok(())
    }

    fn add(&mut self, other: &Amount) -> Result<()> {
        self.lovelace = self
            .lovelace
            .checked_add(other.lovelace)
            .ok_or_else(|| anyhow!("an ADA amount overflows"))?;
        for ((p, n), q) in &other.tokens {
            self.add_token(p.clone(), n.clone(), *q)?;
        }
        Ok(())
    }

    fn of_row(row: &KoiosRow) -> Result<Amount> {
        let mut amount = Amount {
            lovelace: row.value.parse().map_err(|_| {
                anyhow!(
                    "UTxO {}#{} has no readable value",
                    row.tx_hash,
                    row.tx_index
                )
            })?,
            tokens: BTreeMap::new(),
        };
        for a in row.asset_list.iter().flatten() {
            let quantity = a
                .quantity
                .parse()
                .map_err(|_| anyhow!("a token quantity isn't a whole number: {:?}", a.quantity))?;
            amount.add_token(
                hex::decode(&a.policy_id)?,
                hex::decode(&a.asset_name)?,
                quantity,
            )?;
        }
        Ok(amount)
    }

    fn of_value(value: &conway::Value) -> Result<Amount> {
        let mut amount = Amount::default();
        match value {
            conway::Value::Coin(c) => amount.lovelace = *c,
            conway::Value::Multiasset(c, assets) => {
                amount.lovelace = *c;
                for (policy, names) in assets.iter() {
                    for (name, q) in names.iter() {
                        amount.add_token(policy.to_vec(), name.to_vec(), u64::from(q))?;
                    }
                }
            }
        }
        Ok(amount)
    }

    fn of_legacy(value: &pallas_primitives::alonzo::Value) -> Result<Amount> {
        let mut amount = Amount::default();
        match value {
            pallas_primitives::alonzo::Value::Coin(c) => amount.lovelace = *c,
            pallas_primitives::alonzo::Value::Multiasset(c, assets) => {
                amount.lovelace = *c;
                for (policy, names) in assets.iter() {
                    for (name, q) in names.iter() {
                        amount.add_token(policy.to_vec(), name.to_vec(), *q)?;
                    }
                }
            }
        }
        Ok(amount)
    }

    pub fn tokens_out(&self) -> Vec<Token> {
        self.tokens
            .iter()
            .map(|((p, n), q)| Token {
                policy_id: hex::encode(p),
                asset_name: hex::encode(n),
                quantity: q.to_string(),
            })
            .collect()
    }

    /// CIP-30's `Value`: the coin alone, or `[coin, multiasset]`, in
    /// canonical order (policies by bytes, names by length, then bytes).
    fn encode(&self, e: &mut Enc) -> Result<(), minicbor::encode::Error<std::convert::Infallible>> {
        let nonzero: Vec<_> = self.tokens.iter().filter(|(_, q)| **q > 0).collect();
        if nonzero.is_empty() {
            e.u64(self.lovelace)?;
            return Ok(());
        }
        // Names by (length, bytes): CBOR's canonical order for byte-string keys.
        let mut policies: BTreeMap<&[u8], BTreeMap<NameKey, u64>> = BTreeMap::new();
        for ((p, n), q) in nonzero {
            policies
                .entry(p.as_slice())
                .or_default()
                .insert((n.len(), n.as_slice()), *q);
        }
        e.array(2)?.u64(self.lovelace)?.map(policies.len() as u64)?;
        for (policy, names) in policies {
            e.bytes(policy)?.map(names.len() as u64)?;
            for ((_, name), q) in names {
                e.bytes(name)?.u64(q)?;
            }
        }
        Ok(())
    }
}

/// The change from `before` to `after`, per asset: ADA and each token that
/// moved, with its sign.
fn difference(before: &Amount, after: &Amount) -> (i128, Vec<Token>) {
    let lovelace = i128::from(after.lovelace) - i128::from(before.lovelace);
    let keys: BTreeSet<_> = before.tokens.keys().chain(after.tokens.keys()).collect();
    let tokens = keys
        .into_iter()
        .filter_map(|k| {
            let d = i128::from(*after.tokens.get(k).unwrap_or(&0))
                - i128::from(*before.tokens.get(k).unwrap_or(&0));
            (d != 0).then(|| Token {
                policy_id: hex::encode(&k.0),
                asset_name: hex::encode(&k.1),
                quantity: d.to_string(),
            })
        })
        .collect();
    (lovelace, tokens)
}

// ---------------------------------------------------------------------------
// What a dApp is shown (getBalance, getUtxos, the addresses)
// ---------------------------------------------------------------------------

/// A UTxO as CIP-30's `TransactionUnspentOutput`: `[input, output]`. The
/// output is the legacy array unless it holds an inline datum. A reference
/// script on one of the account's own UTxOs isn't passed on.
pub fn utxo_cbor(row: &KoiosRow) -> Result<Vec<u8>> {
    let tx_hash = hex::decode(&row.tx_hash)?;
    if tx_hash.len() != 32 {
        bail!(
            "UTxO {}#{} has a malformed transaction hash",
            row.tx_hash,
            row.tx_index
        );
    }
    let address = Address::from_bech32(&row.address)
        .map_err(|e| {
            anyhow!(
                "UTxO {}#{} has an unreadable address: {e}",
                row.tx_hash,
                row.tx_index
            )
        })?
        .to_vec();
    let amount = Amount::of_row(row)?;
    let inline = row
        .inline_datum
        .as_ref()
        .map(|d| hex::decode(&d.bytes))
        .transpose()?;
    let datum_hash = row.datum_hash.as_ref().map(hex::decode).transpose()?;
    Ok(cbor(|e| {
        e.array(2)?.array(2)?.bytes(&tx_hash)?.u64(row.tx_index)?;
        match (inline, datum_hash) {
            (Some(datum), _) => {
                e.map(3)?.u8(0)?.bytes(&address)?.u8(1)?;
                amount.encode(e)?;
                // [1, #6.24(bytes .cbor plutus_data)]
                e.u8(2)?
                    .array(2)?
                    .u8(1)?
                    .tag(minicbor::data::Tag::new(24))?
                    .bytes(&datum)?;
            }
            (None, Some(hash)) => {
                e.array(3)?.bytes(&address)?;
                amount.encode(e)?;
                e.bytes(&hash)?;
            }
            (None, None) => {
                e.array(2)?.bytes(&address)?;
                amount.encode(e)?;
            }
        }
        Ok(())
    }))
}

/// A balance as CIP-30's `Value`.
pub fn value_cbor(lovelace: &str, tokens: &[Token]) -> Result<Vec<u8>> {
    let mut amount = Amount {
        lovelace: lovelace
            .parse()
            .map_err(|_| anyhow!("the balance isn't a whole number of lovelace"))?,
        tokens: BTreeMap::new(),
    };
    for t in tokens {
        let quantity = t
            .quantity
            .parse()
            .map_err(|_| anyhow!("a token quantity isn't a whole number: {:?}", t.quantity))?;
        amount.add_token(
            hex::decode(&t.policy_id)?,
            hex::decode(&t.asset_name)?,
            quantity,
        )?;
    }
    Ok(cbor(|e| amount.encode(e)))
}

/// An address as CIP-30 hands it over: its bytes, in hex.
pub fn address_hex(bech32: &str) -> Result<String> {
    Ok(Address::from_bech32(bech32)
        .map_err(|e| anyhow!("unreadable address {bech32:?}: {e}"))?
        .to_hex())
}

/// The most policies and tokens, all together, an amount a dApp asks for may
/// name: far past any balance a site covers with one call, and each is a few
/// hundred bytes here, so a site's amount can't run the module out of memory
/// (independent review M15).
pub const MAX_VALUE_ENTRIES: usize = 1_000;

/// An amount a dApp asks for (`getUtxos(amount)`, `getCollateral`): a CIP-30
/// `Value` in hex. Lenient about encodings: definite or indefinite lengths,
/// and a zero quantity counts as none. One naming more than
/// `MAX_VALUE_ENTRIES` policies and tokens is refused as it's read.
pub fn read_value(value_hex: &str) -> Result<(u64, Vec<Token>)> {
    let bytes = hex::decode(value_hex.trim()).map_err(|_| anyhow!("the amount isn't hex"))?;
    let mut d = minicbor::Decoder::new(&bytes);
    let unreadable = |e: minicbor::decode::Error| anyhow!("the amount isn't a Cardano value: {e}");
    use minicbor::data::Type;
    let mut tokens = Vec::new();
    let mut entries = 0usize;
    let mut count = || -> Result<()> {
        entries += 1;
        if entries > MAX_VALUE_ENTRIES {
            bail!("the amount names more than {MAX_VALUE_ENTRIES} tokens");
        }
        Ok(())
    };
    let lovelace = match d.datatype().map_err(unreadable)? {
        Type::Array | Type::ArrayIndef => {
            d.array().map_err(unreadable)?;
            let lovelace = d.u64().map_err(unreadable)?;
            let policies = d.map().map_err(unreadable)?;
            let mut i = 0;
            while policies.is_none_or(|n| i < n) {
                if policies.is_none() && d.datatype().map_err(unreadable)? == Type::Break {
                    d.skip().ok();
                    break;
                }
                count()?;
                let policy = d.bytes().map_err(unreadable)?.to_vec();
                let names = d.map().map_err(unreadable)?;
                let mut j = 0;
                while names.is_none_or(|n| j < n) {
                    if names.is_none() && d.datatype().map_err(unreadable)? == Type::Break {
                        d.skip().ok();
                        break;
                    }
                    count()?;
                    let name = d.bytes().map_err(unreadable)?.to_vec();
                    let quantity = d.u64().map_err(unreadable)?;
                    if quantity > 0 {
                        tokens.push(Token {
                            policy_id: hex::encode(&policy),
                            asset_name: hex::encode(&name),
                            quantity: quantity.to_string(),
                        });
                    }
                    j += 1;
                }
                i += 1;
            }
            lovelace
        }
        _ => d.u64().map_err(unreadable)?,
    };
    Ok((lovelace, tokens))
}

// ---------------------------------------------------------------------------
// The account's keys
// ---------------------------------------------------------------------------

/// The account's key hashes: every payment key in range, and the stake key
/// (`2/0` for the public account, `2/i` for private session `i`).
struct Keys {
    payment: HashMap<Hash<28>, KeyPath>,
    stake: Hash<28>,
}

fn keys_of(account: &CardanoAccount, paths: &[KeyPath], stake_index: u32) -> Result<Keys> {
    let mut payment = HashMap::new();
    for p in paths {
        let role = match p.role {
            0 => Role::Receive,
            1 => Role::Change,
            r => bail!("a payment key is on the receive (0) or change (1) chain, not {r}"),
        };
        payment.insert(account.key_hash(role, p.index)?, *p);
    }
    Ok(Keys {
        payment,
        stake: account.key_hash(Role::Staking, stake_index)?,
    })
}

/// Who a key-signed thing needs: one of the account's keys, or someone else.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Signer {
    Payment(KeyPath),
    Stake,
}

impl Keys {
    fn of_hash(&self, hash: &Hash<28>) -> Option<Signer> {
        if *hash == self.stake {
            return Some(Signer::Stake);
        }
        self.payment.get(hash).copied().map(Signer::Payment)
    }

    /// The key path of an address that's the account's: one of its payment
    /// keys, with its stake key as the staking part, as every address the
    /// wallet hands out has. Its payment key under anyone else's staking
    /// part, none or a pointer is someone else's address: the account could
    /// spend what's there, but its stake would earn and vote for them.
    fn own_address(&self, address: &Address) -> Option<KeyPath> {
        let Address::Shelley(s) = address else {
            return None;
        };
        match (s.payment(), s.delegation()) {
            (ShelleyPaymentPart::Key(h), ShelleyDelegationPart::Key(stake))
                if *stake == self.stake =>
            {
                self.payment.get(h).copied()
            }
            _ => None,
        }
    }

    /// Whether an address has one of the account's payment keys, whatever
    /// its staking part.
    fn has_payment_key(&self, address: &Address) -> bool {
        matches!(address, Address::Shelley(s)
            if matches!(s.payment(), ShelleyPaymentPart::Key(h) if self.payment.contains_key(h)))
    }
}

// ---------------------------------------------------------------------------
// A site's CBOR, before anything decodes it
// ---------------------------------------------------------------------------

/// The largest transaction a site may ask the wallet to read: four times the
/// ledger's limit today (16 KiB), so a raise of it breaks no site. Reading
/// checks every register datum's points, about a millisecond each, so this
/// keeps a read well under a second.
pub(crate) const MAX_TX_BYTES: usize = 64 * 1024;

/// How deep a site's CBOR may nest. Pallas decodes plutus data, metadata and
/// native scripts recursively, and a few thousand levels (a 3 KB
/// transaction) overflow WebAssembly's stack. That leaves the instance dead:
/// nothing works after it, not even Lock. Real transactions nest a few dozen
/// levels at most.
const MAX_NESTING: usize = 128;

/// One open level in [`nests_within`]'s walk.
enum Level {
    /// An array or a map (its keys and values each an item), with the items
    /// left to read: `None` until a break.
    Items(Option<u64>),
    /// A tag, before the one item it wraps.
    Tag,
    /// CBOR in a byte string a tag wraps, as an inline datum or a reference
    /// script is: Pallas decodes that too. It ends at `end`, inside bytes
    /// that end at `outer`.
    Wrapped { end: usize, outer: usize },
}

/// A CBOR item's head at `pos`: its major type, its argument (`None` for an
/// indefinite length), and where what follows the head starts.
fn cbor_head(bytes: &[u8], pos: usize) -> Option<(u8, Option<u64>, usize)> {
    let initial = *bytes.get(pos)?;
    let wide = |n: usize| -> Option<(u64, usize)> {
        let b = bytes.get(pos + 1..pos + 1 + n)?;
        Some((
            b.iter().fold(0u64, |a, x| (a << 8) | u64::from(*x)),
            pos + 1 + n,
        ))
    };
    let (argument, next) = match initial & 0x1f {
        n @ 0..=23 => (Some(u64::from(n)), pos + 1),
        24 => wide(1).map(|(a, p)| (Some(a), p))?,
        25 => wide(2).map(|(a, p)| (Some(a), p))?,
        26 => wide(4).map(|(a, p)| (Some(a), p))?,
        27 => wide(8).map(|(a, p)| (Some(a), p))?,
        31 => (None, pos + 1),
        // 28–30 are reserved.
        _ => return None,
    };
    Some((initial >> 5, argument, next))
}

/// Whether CBOR `bytes` stay within `max` levels: each array, map and tag is
/// one, and so is the CBOR a tag wraps in a byte string. It walks the bytes
/// without recursing, one head at a time.
///
/// What isn't well-formed ends the walk, as it ends any decoder there too.
/// Inside a wrapped byte string it only means those bytes aren't CBOR (a big
/// number's, say), and the walk goes on after them.
fn nests_within(bytes: &[u8], max: usize) -> bool {
    let mut levels = vec![Level::Items(Some(1))];
    let mut pos = 0;
    let mut limit = bytes.len();
    while let Some(level) = levels.last() {
        match *level {
            Level::Items(Some(0)) => {
                levels.pop();
                continue;
            }
            Level::Wrapped { end, outer } => {
                (pos, limit) = (end, outer);
                levels.pop();
                continue;
            }
            _ => {}
        }
        match cbor_step(bytes, pos, limit, &mut levels) {
            Some(next) => (pos, limit) = next,
            None => {
                let Some(i) = levels
                    .iter()
                    .rposition(|l| matches!(l, Level::Wrapped { .. }))
                else {
                    return true;
                };
                let Level::Wrapped { end, outer } = levels[i] else {
                    unreachable!("found as wrapped")
                };
                levels.truncate(i);
                (pos, limit) = (end, outer);
                continue;
            }
        }
        // The first level is the whole item's, not a nesting.
        if levels.len() > max + 1 {
            return false;
        }
    }
    true
}

/// Reads the item at `pos` for the innermost open level, opening a level
/// for an array, a map, a tag or a wrapped byte string, whose bytes end at
/// `limit`. Where the walk goes next and where the bytes it's in end, or
/// `None` for bytes that aren't well-formed CBOR.
fn cbor_step(
    bytes: &[u8],
    pos: usize,
    limit: usize,
    levels: &mut Vec<Level>,
) -> Option<(usize, usize)> {
    let bytes = &bytes[..limit];
    if *bytes.get(pos)? == 0xff {
        // A break closes an indefinite array, map or string.
        return match levels.last() {
            Some(Level::Items(None)) => {
                levels.pop();
                Some((pos + 1, limit))
            }
            _ => None,
        };
    }
    let after_tag = matches!(levels.last(), Some(Level::Tag));
    match levels.last_mut() {
        Some(Level::Items(Some(n))) => *n -= 1,
        // The tag's level stays open until its item is read.
        Some(level @ Level::Tag) => *level = Level::Items(Some(0)),
        _ => {}
    }
    let (major, argument, next) = cbor_head(bytes, pos)?;
    let opened = match (major, argument) {
        (0 | 1 | 7, Some(_)) => None,
        (2 | 3, Some(length)) => {
            let end = usize::try_from(length)
                .ok()
                .and_then(|l| next.checked_add(l))
                .filter(|end| *end <= limit)?;
            if major == 2 && after_tag {
                levels.push(Level::Wrapped { end, outer: limit });
                levels.push(Level::Items(Some(1)));
                return Some((next, end));
            }
            return Some((end, limit));
        }
        // An indefinite string's chunks, until a break.
        (2 | 3, None) => Some(Level::Items(None)),
        (4, length) => Some(Level::Items(length)),
        (5, length) => Some(Level::Items(length.map(|n| n.saturating_mul(2)))),
        (6, Some(_)) => Some(Level::Tag),
        _ => return None,
    };
    levels.extend(opened);
    Some((next, limit))
}

/// Refuses a site's CBOR that nests deeper than [`MAX_NESTING`], before
/// anything decodes it.
pub(crate) fn check_nesting(bytes: &[u8]) -> Result<()> {
    if !nests_within(bytes, MAX_NESTING) {
        bail!(
            "The wallet can't read this transaction: its data is nested more than {MAX_NESTING} levels deep."
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// What a dApp's transaction does
// ---------------------------------------------------------------------------

/// A dApp's transaction to read (and later sign), as JSON from the extension.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxRequest {
    pub network: String,
    pub tx_cbor: String,
    /// The account's payment keys in range, as discovery found them.
    pub keys: Vec<KeyPath>,
    /// The UTxOs its inputs and collateral spend, as far as the extension
    /// could find them: the account's own (fresh, or from a transaction it
    /// signed that isn't on chain yet), and others' from Koios.
    pub inputs: Vec<KoiosRow>,
    #[serde(default)]
    pub partial_sign: bool,
    /// The stake key's index: 0 for the public account, `i` for private
    /// session `i`, whose stake key is `2/i`.
    #[serde(default)]
    pub stake_index: u32,
    /// The deposit the stake key paid when it registered (Koios's
    /// `account_info.deposit`), in lovelace, as a number or a string: what an
    /// old deregistration certificate gets back, which it doesn't say.
    /// Without it, the account's own is refused.
    #[serde(default, deserialize_with = "lovelace_or_none")]
    pub stake_deposit: Option<u64>,
}

/// An amount of lovelace a request may give as a JSON number or a decimal
/// string (as Koios writes them), or leave out.
fn lovelace_or_none<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Lovelace {
        Number(u64),
        Text(String),
    }
    match Option::<Lovelace>::deserialize(d)? {
        None => Ok(None),
        Some(Lovelace::Number(n)) => Ok(Some(n)),
        Some(Lovelace::Text(text)) => text
            .parse()
            .map(Some)
            .map_err(|_| serde::de::Error::custom(format!("{text:?} isn't an amount of lovelace"))),
    }
}

/// One output paying anyone but the account.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Paid {
    pub address: String,
    pub lovelace: String,
    pub tokens: Vec<Token>,
    /// "hash", "inline" or none.
    pub datum: Option<String>,
    /// The address is a script's: a contract holds what it's paid.
    pub script: bool,
    /// Into Seedelf Wallet's contract: "register" when its datum is a
    /// register someone can spend, "none" when it isn't (anyone could take it).
    pub seedelf: Option<String>,
    /// The address has one of the account's payment keys, but someone
    /// else's staking part, or none: the account could spend what's there,
    /// but its stake would earn and vote for whoever holds that part. So
    /// it's paid, not the account's.
    pub own_payment_key: bool,
}

/// One of the account's outputs, kept by the extension until it's on chain,
/// so a dApp's next transaction can spend it.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OwnOutput {
    pub tx_index: u64,
    pub address: String,
    pub role: u32,
    pub index: u32,
    pub lovelace: String,
    pub tokens: Vec<Token>,
    pub inline_datum: Option<String>,
    pub datum_hash: Option<String>,
}

/// A certificate, in words the extension turns into a sentence.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cert {
    /// "register", "unregister", "delegate", "vote", "register-delegate",
    /// "register-vote", "delegate-vote", "register-delegate-vote", "drep",
    /// "pool" or "committee".
    pub kind: String,
    /// It's about the account's own stake key.
    pub own: bool,
    /// The pool it stakes with, or a stake pool's own certificate's pool.
    pub pool: Option<String>,
    /// A stake pool's own certificate (kind "pool"): "register" (a new pool,
    /// or new terms for one) or "retire".
    pub pool_action: Option<String>,
    pub drep: Option<String>,
    pub deposit: Option<String>,
    pub refund: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Withdrawal {
    pub address: String,
    pub lovelace: String,
    pub own: bool,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollateralOut {
    /// How many of the account's UTxOs are put up.
    pub own: usize,
    /// What they hold, in ADA.
    pub lovelace: String,
    /// The most the network takes if a script refuses (`total_collateral`), when given.
    pub total: Option<String>,
    /// Returned to the account from the collateral if it's taken.
    pub returned_lovelace: Option<String>,
    /// What the account loses if a contract refuses it: the collateral
    /// put up, less what comes back.
    pub at_risk: String,
}

/// What a dApp's transaction does to the public account, for the signing prompt.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TxSummary {
    pub tx_hash: String,
    pub fee: String,
    /// The account's change: ADA (signed lovelace) and each token that moved.
    /// Its ADA is what comes back less what the account puts in: its UTxOs
    /// and its staking both.
    pub net_lovelace: String,
    pub net_tokens: Vec<Token>,
    /// What the account's UTxOs put in, and what comes back to it.
    pub spent_lovelace: String,
    pub returned_lovelace: String,
    /// What the account puts in from its staking: the rewards it withdraws
    /// and the deposit its stake key gets back. It's the account's money as
    /// much as its UTxOs are, so it counts in the net. Any of it the
    /// account's outputs don't hold (`returned_lovelace` beyond
    /// `spent_lovelace`) goes to the others it pays, or to the fee.
    pub staking_lovelace: String,
    /// How many of the account's UTxOs it spends.
    pub own_inputs: usize,
    /// Outputs to anyone else.
    pub paid: Vec<Paid>,
    pub own_outputs: Vec<OwnOutput>,
    /// Tokens minted (positive) or burned.
    pub mint: Vec<Token>,
    pub certificates: Vec<Cert>,
    pub withdrawals: Vec<Withdrawal>,
    pub collateral: Option<CollateralOut>,
    /// It runs smart contracts (it has redeemers), so its collateral is at stake.
    pub scripts: bool,
    pub reference_inputs: usize,
    pub votes: usize,
    pub proposals: usize,
    pub donation: Option<String>,
    /// CIP-20's message (label 674), when there is one.
    pub note: Option<Vec<String>>,
    /// Any metadata at all.
    pub metadata: bool,
    pub valid_from: Option<u64>,
    pub valid_until: Option<u64>,
    /// The account's keys that sign: "0/3", "1/0", "stake".
    pub signs: Vec<String>,
    /// Inputs and collateral the wallet couldn't find anywhere
    /// (`txhash#index`). Only ever with the stake key signing alone: with
    /// any, a payment key's signature is refused.
    pub unknown_inputs: Vec<String>,
    /// Signatures it needs from keys that aren't the account's.
    pub others_sign: usize,
    /// The account's signatures are all it needs, as far as the wallet can tell.
    pub complete: bool,
}

struct Inspection {
    summary: TxSummary,
    signers: BTreeSet<Signer>,
    tx_hash: Hash<32>,
}

fn signer_name(s: &Signer) -> String {
    match s {
        Signer::Payment(p) => format!("{}/{}", p.role, p.index),
        Signer::Stake => "stake".to_string(),
    }
}

/// An output's address bytes, value, inline datum and datum hash (hex).
type OutputParts = (Vec<u8>, Amount, Option<String>, Option<String>);

/// The address and value of an output, however it's written.
fn output_parts(out: &conway::TransactionOutput) -> Result<OutputParts> {
    Ok(match out {
        conway::PseudoTransactionOutput::Legacy(o) => (
            o.address.to_vec(),
            Amount::of_legacy(&o.amount)?,
            None,
            o.datum_hash.map(|h| hex::encode(h.as_ref())),
        ),
        conway::PseudoTransactionOutput::PostAlonzo(o) => {
            let (inline, hash) = match &o.datum_option {
                Some(conway::PseudoDatumOption::Data(d)) => {
                    let bytes = d.0.encode_fragment().map_err(|e| anyhow!("{e}"))?;
                    (Some(hex::encode(bytes)), None)
                }
                Some(conway::PseudoDatumOption::Hash(h)) => (None, Some(hex::encode(h.as_ref()))),
                None => (None, None),
            };
            (
                o.address.to_vec(),
                Amount::of_value(&o.value)?,
                inline,
                hash,
            )
        }
    })
}

/// Whether an inline datum is a register a Seedelf payment could go under:
/// one [`register_datum`] reads that also passes `is_payable`.
fn is_register_datum(datum_hex: &str) -> bool {
    register_datum(datum_hex).is_some_and(|r| build::is_payable(&r))
}

/// The register an inline datum holds, if it is one: constructor 0 (tag 121)
/// holding two 48-byte points, in a definite or indefinite list. It says
/// nothing about whether a payment under it could be spent (`is_payable`).
pub(crate) fn register_datum(datum_hex: &str) -> Option<Register> {
    let bytes = hex::decode(datum_hex).ok()?;
    let mut d = minicbor::Decoder::new(&bytes);
    let points = (|| -> Result<(Vec<u8>, Vec<u8>), minicbor::decode::Error> {
        if d.tag()? != minicbor::data::Tag::new(121) {
            return Err(minicbor::decode::Error::message("not constructor 0"));
        }
        let length = d.array()?;
        let generator = d.bytes()?.to_vec();
        let public_value = d.bytes()?.to_vec();
        match length {
            Some(2) => {}
            None if d.datatype()? == minicbor::data::Type::Break => {}
            _ => return Err(minicbor::decode::Error::message("not two fields")),
        }
        Ok((generator, public_value))
    })();
    match points {
        Ok((g, u)) if g.len() == 48 && u.len() == 48 => {
            Some(Register::new(hex::encode(g), hex::encode(u)))
        }
        _ => None,
    }
}

/// The CIP-20 message in a transaction's metadata, if it has one.
fn note_of(aux: &conway::AuxiliaryData) -> (bool, Option<Vec<String>>) {
    let metadata = match aux {
        conway::AuxiliaryData::Shelley(m) => Some(m),
        conway::AuxiliaryData::ShelleyMa(m) => Some(&m.transaction_metadata),
        conway::AuxiliaryData::PostAlonzo(m) => m.metadata.as_ref(),
    };
    let Some(metadata) = metadata else {
        return (false, None);
    };
    let note = metadata
        .iter()
        .find(|(label, _)| *label == 674)
        .and_then(|(_, m)| {
            let Metadatum::Map(fields) = m else {
                return None;
            };
            fields.iter().find_map(|(k, v)| match (k, v) {
                (Metadatum::Text(k), Metadatum::Array(lines)) if k == "msg" => Some(
                    lines
                        .iter()
                        .filter_map(|l| match l {
                            Metadatum::Text(t) => Some(t.clone()),
                            _ => None,
                        })
                        .collect(),
                ),
                (Metadatum::Text(k), Metadatum::Text(line)) if k == "msg" => {
                    Some(vec![line.clone()])
                }
                _ => None,
            })
        });
    (!metadata.is_empty(), note)
}

fn stake_hash(cred: &StakeCredential) -> Option<&Hash<28>> {
    match cred {
        StakeCredential::AddrKeyhash(h) => Some(h),
        StakeCredential::ScriptHash(_) => None,
    }
}

fn inspect(account: &CardanoAccount, request: &TxRequest) -> Result<Inspection> {
    let flag = network_flag(&request.network)?;
    let network = address_network(flag);
    let network_name = if flag { "preprod" } else { "mainnet" };
    let other_name = if flag { "mainnet" } else { "a test network" };
    let text = request.tx_cbor.trim();
    if text.len() > 2 * MAX_TX_BYTES {
        bail!("The wallet can't read this transaction: it's far larger than Cardano allows.");
    }
    let bytes = hex::decode(text).map_err(|_| anyhow!("The transaction isn't hex."))?;
    check_nesting(&bytes)?;
    let tx = conway::Tx::decode_fragment(&bytes)
        .map_err(|e| anyhow!("The wallet can't read this transaction: {e}"))?;
    let tx_hash = build::tx_id(&bytes)?;
    let body = &tx.transaction_body;
    let keys = keys_of(account, &request.keys, request.stake_index)?;

    if body
        .network_id
        .is_some_and(|id| (u8::from(id) == 0) != flag)
    {
        bail!("This transaction is for {other_name}, and the wallet is on {network_name}.");
    }

    // Every input the extension could find, by outpoint.
    let found: HashMap<(String, u64), &KoiosRow> = request
        .inputs
        .iter()
        .map(|r| ((r.tx_hash.to_lowercase(), r.tx_index), r))
        .collect();
    let mut signers = BTreeSet::new();
    let mut unknown = Vec::new();
    let mut others_sign = 0usize;
    let mut foreign_keys: BTreeSet<Hash<28>> = BTreeSet::new();

    // Who can spend an input: one of our keys, someone else's key, or a
    // script (whose own rules decide, with no key needed).
    let mut owner = |row: &KoiosRow| -> Result<Option<Signer>> {
        let address = Address::from_bech32(&row.address).map_err(|e| {
            anyhow!(
                "UTxO {}#{} has an unreadable address: {e}",
                row.tx_hash,
                row.tx_index
            )
        })?;
        // The account's keys are the same on both networks, and a signature
        // says nothing of the network: one over a UTxO on the other network
        // would spend it there. It's never counted, as ours or anyone's.
        if let Address::Shelley(s) = &address
            && s.network() != network
        {
            bail!(
                "This transaction spends a UTxO on {other_name} ({}#{}), and the wallet is on {network_name}.",
                row.tx_hash,
                row.tx_index
            );
        }
        Ok(match address {
            Address::Shelley(s) => match s.payment() {
                ShelleyPaymentPart::Key(h) => match keys.payment.get(h) {
                    Some(p) => Some(Signer::Payment(*p)),
                    None => {
                        foreign_keys.insert(*h);
                        None
                    }
                },
                ShelleyPaymentPart::Script(_) => None,
            },
            // A Byron address needs a bootstrap witness this wallet never makes.
            _ => {
                foreign_keys.insert(Hash::new([0; 28]));
                None
            }
        })
    };

    let mut spent = Amount::default();
    let mut own_inputs = 0usize;
    for input in body.inputs.iter() {
        let key = (hex::encode(input.transaction_id), input.index);
        match found.get(&key) {
            Some(row) => {
                if let Some(signer) = owner(row)? {
                    signers.insert(signer);
                    spent.add(&Amount::of_row(row)?)?;
                    own_inputs += 1;
                }
            }
            None => unknown.push(format!("{}#{}", key.0, key.1)),
        }
    }

    let mut collateral = None;
    if let Some(inputs) = &body.collateral {
        let mut put_up = Amount::default();
        let mut own = 0usize;
        for input in inputs.iter() {
            let key = (hex::encode(input.transaction_id), input.index);
            match found.get(&key) {
                Some(row) => {
                    if let Some(signer) = owner(row)? {
                        signers.insert(signer);
                        put_up.add(&Amount::of_row(row)?)?;
                        own += 1;
                    }
                }
                None => unknown.push(format!("{}#{}", key.0, key.1)),
            }
        }
        // What comes back if a contract refuses it: a return to anyone else
        // would hand them the account's collateral (Lace refuses it too).
        let returned = match &body.collateral_return {
            Some(out) => {
                let (address, amount, _, _) = output_parts(out)?;
                if let Ok(a) = Address::from_bytes(&address)
                    && network_of(&a).map_err(|e| {
                        anyhow!("The collateral return has an unreadable address: {e}")
                    })? != network
                {
                    bail!(
                        "If a contract refused this transaction, its collateral would go to an address on {other_name}, and the wallet is on {network_name}."
                    );
                }
                let ours =
                    Address::from_bytes(&address).is_ok_and(|a| keys.own_address(&a).is_some());
                if !ours && own > 0 {
                    bail!(
                        "If a contract refused this transaction, your collateral would go to someone else, so the wallet won't sign it."
                    );
                }
                ours.then_some(amount.lovelace)
            }
            None => None,
        };
        let at_risk = put_up.lovelace.saturating_sub(returned.unwrap_or(0));
        collateral = Some(CollateralOut {
            own,
            lovelace: put_up.lovelace.to_string(),
            total: body.total_collateral.map(|c| c.to_string()),
            returned_lovelace: returned.map(|r| r.to_string()),
            at_risk: at_risk.to_string(),
        });
    }
    if !tx.success && collateral.as_ref().is_some_and(|c| c.own > 0) {
        bail!(
            "This transaction is marked to fail its contracts, which would take your collateral, so the wallet won't sign it."
        );
    }

    for signer in body.required_signers.iter().flat_map(|s| s.iter()) {
        match keys.of_hash(signer) {
            Some(s) => {
                signers.insert(s);
            }
            None => {
                foreign_keys.insert(*signer);
            }
        }
    }

    // Outputs: the account's own, and everyone else's.
    let contract = get_config(VARIANT, flag)?.contract.wallet_contract_hash;
    let contract_address = wallet_contract(flag, contract);
    let contract_hash = match &contract_address {
        Address::Shelley(s) => *s.payment().as_hash(),
        _ => unreachable!("the wallet contract is a Shelley address"),
    };
    let mut returned = Amount::default();
    let mut paid = Vec::new();
    let mut own_outputs = Vec::new();
    for (i, out) in body.outputs.iter().enumerate() {
        let (address_bytes, amount, inline, hash) = output_parts(out)?;
        let address = Address::from_bytes(&address_bytes)
            .map_err(|e| anyhow!("Output {i} has an unreadable address: {e}"))?;
        // A Byron address counts too: with no network magic, it's mainnet's.
        if network_of(&address).map_err(|e| anyhow!("Output {i} has an unreadable address: {e}"))?
            != network
        {
            bail!(
                "This transaction pays an address on {other_name}, and the wallet is on {network_name}."
            );
        }
        let bech32 = address.to_bech32().unwrap_or_else(|_| address.to_hex());
        if let Some(path) = keys.own_address(&address) {
            returned.add(&amount)?;
            own_outputs.push(OwnOutput {
                tx_index: i as u64,
                address: bech32,
                role: path.role,
                index: path.index,
                lovelace: amount.lovelace.to_string(),
                tokens: amount.tokens_out(),
                inline_datum: inline,
                datum_hash: hash,
            });
            continue;
        }
        let script = matches!(&address, Address::Shelley(s) if s.payment().is_script());
        let seedelf = match &address {
            Address::Shelley(s) if *s.payment().as_hash() == contract_hash => Some(
                if inline.as_deref().is_some_and(is_register_datum) {
                    "register"
                } else {
                    "none"
                }
                .to_string(),
            ),
            _ => None,
        };
        paid.push(Paid {
            address: bech32,
            lovelace: amount.lovelace.to_string(),
            tokens: amount.tokens_out(),
            datum: if inline.is_some() {
                Some("inline".into())
            } else {
                hash.map(|_| "hash".into())
            },
            script,
            seedelf,
            own_payment_key: keys.has_payment_key(&address),
        });
    }

    // What the account puts in from its staking: its rewards, and its stake
    // key's deposit back. Neither is in a UTxO, and either can leave in the
    // outputs as any of its ADA can.
    let mut staking = 0u64;
    let add_staking = |staking: u64, lovelace: u64| {
        staking
            .checked_add(lovelace)
            .ok_or_else(|| anyhow!("an ADA amount overflows"))
    };

    let mut certificates = Vec::new();
    for cert in body.certificates.iter().flat_map(|c| c.iter()) {
        use conway::Certificate as C;
        let (cred, mut c, witnessed) = match cert {
            C::StakeRegistration(cred) => (Some(cred), cert_kind("register"), false),
            C::StakeDeregistration(cred) => (Some(cred), cert_kind("unregister"), true),
            C::StakeDelegation(cred, pool) => (
                Some(cred),
                Cert {
                    pool: Some(pool_id(pool)),
                    ..cert_kind("delegate")
                },
                true,
            ),
            C::Reg(cred, deposit) => (
                Some(cred),
                Cert {
                    deposit: Some(deposit.to_string()),
                    ..cert_kind("register")
                },
                true,
            ),
            C::UnReg(cred, refund) => (
                Some(cred),
                Cert {
                    refund: Some(refund.to_string()),
                    ..cert_kind("unregister")
                },
                true,
            ),
            C::VoteDeleg(cred, drep) => (
                Some(cred),
                Cert {
                    drep: Some(drep_id(drep)),
                    ..cert_kind("vote")
                },
                true,
            ),
            C::StakeVoteDeleg(cred, pool, drep) => (
                Some(cred),
                Cert {
                    pool: Some(pool_id(pool)),
                    drep: Some(drep_id(drep)),
                    ..cert_kind("delegate-vote")
                },
                true,
            ),
            C::StakeRegDeleg(cred, pool, deposit) => (
                Some(cred),
                Cert {
                    pool: Some(pool_id(pool)),
                    deposit: Some(deposit.to_string()),
                    ..cert_kind("register-delegate")
                },
                true,
            ),
            C::VoteRegDeleg(cred, drep, deposit) => (
                Some(cred),
                Cert {
                    drep: Some(drep_id(drep)),
                    deposit: Some(deposit.to_string()),
                    ..cert_kind("register-vote")
                },
                true,
            ),
            C::StakeVoteRegDeleg(cred, pool, drep, deposit) => (
                Some(cred),
                Cert {
                    pool: Some(pool_id(pool)),
                    drep: Some(drep_id(drep)),
                    deposit: Some(deposit.to_string()),
                    ..cert_kind("register-delegate-vote")
                },
                true,
            ),
            C::PoolRegistration {
                operator,
                pool_owners,
                ..
            } => {
                // An owner's stake is the pool's pledge, and it earns an
                // owner no rewards: the pool's reward account gets them.
                // The stake key signing for anything else in the
                // transaction would sign for this too.
                if pool_owners.contains(&keys.stake) {
                    bail!(
                        "This transaction makes your stake key an owner of stake pool {}: your stake would count as its pledge, and the rewards it earns would go to the pool's reward account, not to you. The wallet won't sign it.",
                        pool_id(operator)
                    );
                }
                (
                    None,
                    Cert {
                        pool: Some(pool_id(operator)),
                        pool_action: Some("register".into()),
                        ..cert_kind("pool")
                    },
                    true,
                )
            }
            C::PoolRetirement(pool, _) => (
                None,
                Cert {
                    pool: Some(pool_id(pool)),
                    pool_action: Some("retire".into()),
                    ..cert_kind("pool")
                },
                true,
            ),
            C::AuthCommitteeHot(..) | C::ResignCommitteeCold(..) => {
                (None, cert_kind("committee"), true)
            }
            C::RegDRepCert(..) | C::UnRegDRepCert(..) | C::UpdateDRepCert(..) => {
                (None, cert_kind("drep"), true)
            }
        };
        match cred.and_then(stake_hash) {
            Some(h) if *h == keys.stake => {
                c.own = true;
                if witnessed {
                    signers.insert(Signer::Stake);
                }
            }
            Some(h) if witnessed => {
                foreign_keys.insert(*h);
            }
            // A script's stake credential, or a registration that needs no signature.
            Some(_) => {}
            // Pools, the committee and DReps sign with keys this wallet doesn't hold.
            None => others_sign += 1,
        }
        if c.own {
            match cert {
                // Its refund is the deposit the key paid when it registered,
                // which the certificate doesn't say: the extension reads it
                // (`stake_deposit`), and it's counted as Conway's UnReg says
                // its own. Without it, what the account puts in can't be
                // counted. The wallet's own staking writes Conway's.
                C::StakeDeregistration(_) => match request.stake_deposit {
                    Some(deposit) => {
                        staking = add_staking(staking, deposit)?;
                        c.refund = Some(deposit.to_string());
                    }
                    None => bail!(
                        "This transaction stops your staking with an old kind of certificate that doesn't say how much deposit comes back, so the wallet can't show where it goes and won't sign it."
                    ),
                },
                C::UnReg(_, refund) => staking = add_staking(staking, *refund)?,
                _ => {}
            }
        }
        certificates.push(c);
    }

    let mut withdrawals = Vec::new();
    for (account_bytes, amount) in body.withdrawals.iter().flat_map(|w| w.iter()) {
        let address = Address::from_bytes(account_bytes)
            .map_err(|e| anyhow!("A withdrawal's reward address is unreadable: {e}"))?;
        let (own, bech32) = match &address {
            Address::Stake(s) => {
                if s.network() != network {
                    bail!(
                        "This transaction withdraws from {other_name}, and the wallet is on {network_name}."
                    );
                }
                let own = match s.payload() {
                    StakePayload::Stake(h) if *h == keys.stake => {
                        signers.insert(Signer::Stake);
                        staking = add_staking(staking, *amount)?;
                        true
                    }
                    StakePayload::Stake(h) => {
                        foreign_keys.insert(*h);
                        false
                    }
                    // A script's: the "withdraw zero" many contracts use, no key needed.
                    StakePayload::Script(_) => false,
                };
                (
                    own,
                    address.to_bech32().unwrap_or_else(|_| address.to_hex()),
                )
            }
            _ => bail!("A withdrawal isn't from a reward address."),
        };
        withdrawals.push(Withdrawal {
            address: bech32,
            lovelace: amount.to_string(),
            own,
        });
    }

    let mut votes = 0;
    for (voter, procedures) in body.voting_procedures.iter().flat_map(|v| v.iter()) {
        votes += procedures.len();
        match voter {
            conway::Voter::ConstitutionalCommitteeScript(_) | conway::Voter::DRepScript(_) => {}
            conway::Voter::ConstitutionalCommitteeKey(h)
            | conway::Voter::DRepKey(h)
            | conway::Voter::StakePoolKey(h) => {
                foreign_keys.insert(*h);
            }
        }
    }

    let mut mint = Amount::default();
    let mut burn = Amount::default();
    for (policy, names) in body.mint.iter().flat_map(|m| m.iter()) {
        for (name, q) in names.iter() {
            let q = i64::from(q);
            let target = if q > 0 { &mut mint } else { &mut burn };
            target.add_token(policy.to_vec(), name.to_vec(), q.unsigned_abs())?;
        }
    }
    let (_, minted) = difference(&burn, &mint);

    let (metadata, note) = match &tx.auxiliary_data {
        Nullable::Some(aux) => note_of(aux),
        _ => (false, None),
    };
    let witnesses = &tx.transaction_witness_set;
    // Redeemers are what run Plutus scripts. A script data hash alone only
    // covers datums in the witness set, as a DEX order's is: nothing runs.
    let scripts = witnesses.redeemer.is_some();

    // A payment key's signature spends every UTxO under that key, one the
    // wallet couldn't find too, whatever partialSign says: the account's own
    // that isn't on chain yet (a Send's change, a top-up) is one. A stake
    // key's signature spends nothing.
    let payment_signs = signers.iter().any(|s| matches!(s, Signer::Payment(_)));
    if let (Some(first), true) = (unknown.first(), payment_signs) {
        bail!(match unknown.len() {
            1 => format!(
                "This transaction spends a UTxO the wallet can't find yet ({first}). It could be yours and not on chain yet, and signing would let it be spent, so the wallet won't sign it. Try again once it's on chain."
            ),
            n => format!(
                "This transaction spends {n} UTxOs the wallet can't find yet ({first} and {} more). They could be yours and not on chain yet, and signing would let them be spent, so the wallet won't sign it. Try again once they're on chain.",
                n - 1
            ),
        });
    }

    let put_in = Amount {
        lovelace: add_staking(spent.lovelace, staking)?,
        ..spent.clone()
    };
    let (net, net_tokens) = difference(&put_in, &returned);
    others_sign += foreign_keys.len();
    let complete = others_sign == 0 && unknown.is_empty();
    let summary = TxSummary {
        tx_hash: hex::encode(tx_hash),
        fee: body.fee.to_string(),
        net_lovelace: net.to_string(),
        net_tokens,
        spent_lovelace: spent.lovelace.to_string(),
        returned_lovelace: returned.lovelace.to_string(),
        staking_lovelace: staking.to_string(),
        own_inputs,
        paid,
        own_outputs,
        mint: minted,
        certificates,
        withdrawals,
        collateral,
        scripts,
        reference_inputs: body.reference_inputs.as_ref().map_or(0, |r| r.len()),
        votes,
        proposals: body.proposal_procedures.as_ref().map_or(0, |p| p.len()),
        donation: body.donation.map(|d| u64::from(d).to_string()),
        note,
        metadata,
        valid_from: body.validity_interval_start,
        valid_until: body.ttl,
        signs: signers.iter().map(signer_name).collect(),
        unknown_inputs: unknown,
        others_sign,
        complete,
    };
    Ok(Inspection {
        summary,
        signers,
        tx_hash,
    })
}

fn cert_kind(kind: &str) -> Cert {
    Cert {
        kind: kind.to_string(),
        ..Cert::default()
    }
}

/// What a dApp's transaction does to the public account, for the prompt.
/// Refuses one for the other network, one it can't read, and one the wallet
/// won't sign whatever the user says.
pub fn inspect_tx(account: &CardanoAccount, request: &TxRequest) -> Result<TxSummary> {
    Ok(inspect(account, request)?.summary)
}

/// The account's signatures on a dApp's transaction, as CIP-30's
/// `transaction_witness_set` (vkey witnesses only), and the summary it was
/// signed against.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Signed {
    pub witness_set: String,
    pub summary: TxSummary,
}

/// Signs a dApp's transaction with every key of the account's it needs.
/// Without `partial_sign`, refuses one that needs anyone else's signature
/// too, or spends a UTxO the wallet couldn't find (CIP-30's
/// `ProofGeneration`), as it does one with nothing of the account's to sign.
/// With it too, a payment key never signs one that spends a UTxO the wallet
/// couldn't find ([`inspect_tx`] refuses it).
pub fn sign_tx(account: &CardanoAccount, request: &TxRequest) -> Result<Signed> {
    let Inspection {
        summary,
        signers,
        tx_hash,
    } = inspect(account, request)?;
    if signers.is_empty() {
        bail!("Nothing in this transaction is this account's to sign.");
    }
    if !request.partial_sign && !summary.complete {
        bail!(
            "This transaction needs signatures the wallet can't give: it spends or is signed for by keys that aren't this account's."
        );
    }
    let mut witnesses = Vec::new();
    for signer in &signers {
        let key = match signer {
            Signer::Payment(p) => {
                let role = if p.role == 0 {
                    Role::Receive
                } else {
                    Role::Change
                };
                account.private_key(role, p.index)?
            }
            Signer::Stake => account.private_key(Role::Staking, request.stake_index)?,
        }
        .to_ed25519_private_key();
        let signature = key.sign(tx_hash);
        witnesses.push((key.public_key(), signature));
    }
    // Written the way the transaction writes its sets, so a dApp merging it
    // in keeps one style.
    let tagged = uses_set_tags(&hex::decode(request.tx_cbor.trim())?);
    let witness_set = cbor(|e| {
        e.map(1)?.u8(0)?;
        if tagged {
            e.tag(minicbor::data::Tag::new(258))?;
        }
        e.array(witnesses.len() as u64)?;
        for (public, signature) in &witnesses {
            e.array(2)?
                .bytes(public.as_ref())?
                .bytes(signature.as_ref())?;
        }
        Ok(())
    });
    Ok(Signed {
        witness_set: hex::encode(witness_set),
        summary,
    })
}

/// The raw bytes of the next CBOR item.
fn raw_item<'b>(d: &mut minicbor::Decoder<'b>) -> Result<&'b [u8]> {
    let start = d.position();
    d.skip()
        .map_err(|e| anyhow!("the transaction isn't valid CBOR: {e}"))?;
    Ok(&d.input()[start..d.position()])
}

/// A definite-length map's `(key, raw value)` entries, keys as numbers.
fn raw_map<'b>(d: &mut minicbor::Decoder<'b>) -> Result<Vec<(u64, &'b [u8])>> {
    let entries = d
        .map()
        .map_err(|e| anyhow!("a witness set is a map: {e}"))?
        .ok_or_else(|| anyhow!("an indefinite-length witness set isn't supported"))?;
    // Not sized by `entries`: whoever wrote the bytes chose it, and a huge
    // one would abort WebAssembly. Each entry needs bytes to be read.
    let mut out = Vec::new();
    for _ in 0..entries {
        let key = d
            .u64()
            .map_err(|e| anyhow!("a witness set's keys are numbers: {e}"))?;
        out.push((key, raw_item(d)?));
    }
    Ok(out)
}

/// The vkey witnesses in a witness set's key 0, each raw, and whether the
/// list is a tagged set (`#6.258`).
fn raw_vkeys(value: &[u8]) -> Result<(bool, Vec<&[u8]>)> {
    let mut d = minicbor::Decoder::new(value);
    let tagged = d.datatype().ok() == Some(minicbor::data::Type::Tag);
    if tagged {
        d.tag().map_err(|e| anyhow!("bad witness tag: {e}"))?;
    }
    let n = d
        .array()
        .map_err(|e| anyhow!("vkey witnesses are a list: {e}"))?
        .ok_or_else(|| anyhow!("an indefinite-length witness list isn't supported"))?;
    let mut items = Vec::new();
    for _ in 0..n {
        items.push(raw_item(&mut d)?);
    }
    Ok((tagged, items))
}

/// A whole transaction with `witness_set` (CIP-30's, vkey witnesses only,
/// as [`sign_tx`] makes) added to its own witness set, for the wallet to
/// submit a transaction someone else built (a session's swap).
///
/// Everything else is copied byte for byte: the body, so the transaction's
/// id is unchanged, and the witness set's other entries, so a datum the
/// builder put there still has the hash its output names. Witnesses already
/// there stay; one for the same key isn't added twice.
pub fn attach_witnesses(tx_cbor: &str, witness_set: &str) -> Result<String> {
    let tx = hex::decode(tx_cbor.trim())?;
    let added = hex::decode(witness_set.trim())?;
    check_nesting(&tx)?;
    check_nesting(&added)?;

    let mut d = minicbor::Decoder::new(&tx);
    if d.array()
        .map_err(|e| anyhow!("a transaction is a list: {e}"))?
        != Some(4)
    {
        bail!("a transaction is a list of four: body, witnesses, validity, metadata");
    }
    let body = raw_item(&mut d)?;
    let mut own = raw_map(&mut d)?;
    let rest = &tx[d.position()..];
    // The validity flag and the metadata, as they were.
    let mut tail = minicbor::Decoder::new(rest);
    raw_item(&mut tail)?;
    raw_item(&mut tail)?;
    if tail.position() != rest.len() {
        bail!("the transaction has bytes after its end");
    }

    let new_vkeys = {
        let mut a = minicbor::Decoder::new(&added);
        let entries = raw_map(&mut a)?;
        match entries.as_slice() {
            [(0, value)] => raw_vkeys(value)?.1,
            _ => bail!("the signatures to add are a witness set of vkey witnesses only"),
        }
    };

    let tagged_default = uses_set_tags(&tx);
    let (tagged, mut vkeys) = match own.iter().find(|(k, _)| *k == 0) {
        Some((_, value)) => raw_vkeys(value)?,
        None => (tagged_default, Vec::new()),
    };
    // A witness is [vkey, signature]; the same vkey signs once.
    let vkey_of = |raw: &[u8]| -> Result<Vec<u8>> {
        let mut w = minicbor::Decoder::new(raw);
        w.array()
            .map_err(|e| anyhow!("a vkey witness is a pair: {e}"))?;
        Ok(w.bytes()
            .map_err(|e| anyhow!("a vkey witness starts with its key: {e}"))?
            .to_vec())
    };
    let mut seen: BTreeSet<Vec<u8>> = vkeys.iter().map(|w| vkey_of(w)).collect::<Result<_>>()?;
    for w in new_vkeys {
        if seen.insert(vkey_of(w)?) {
            vkeys.push(w);
        }
    }
    let vkey_list = cbor(|e| {
        if tagged {
            e.tag(minicbor::data::Tag::new(258))?;
        }
        e.array(vkeys.len() as u64)?;
        for w in &vkeys {
            e.writer_mut().extend_from_slice(w);
        }
        Ok(())
    });
    own.retain(|(k, _)| *k != 0);
    own.push((0, &vkey_list));
    own.sort_by_key(|(k, _)| *k);

    let out = cbor(|e| {
        e.array(4)?;
        e.writer_mut().extend_from_slice(body);
        e.map(own.len() as u64)?;
        for (key, value) in &own {
            e.u64(*key)?;
            e.writer_mut().extend_from_slice(value);
        }
        e.writer_mut().extend_from_slice(rest);
        Ok(())
    });
    Ok(hex::encode(out))
}

/// Whether a transaction writes its inputs as a tagged set (`#6.258`), as
/// Conway allows and newer tools do.
fn uses_set_tags(tx: &[u8]) -> bool {
    let mut d = minicbor::Decoder::new(tx);
    let found = (|| -> Result<bool, minicbor::decode::Error> {
        d.array()?;
        let entries = d.map()?.unwrap_or(u64::MAX);
        for _ in 0..entries {
            if d.u64()? == 0 {
                return Ok(d.datatype()? == minicbor::data::Type::Tag);
            }
            d.skip()?;
        }
        Ok(false)
    })();
    found.unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Signing data (CIP-8, as CIP-30's signData)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataRequest {
    pub network: String,
    pub keys: Vec<KeyPath>,
    /// The address to sign with: its bytes in hex, or bech32.
    pub address: String,
    /// Hex.
    #[serde(default)]
    pub payload: String,
    /// The stake key's index, as `TxRequest`'s.
    #[serde(default)]
    pub stake_index: u32,
}

/// Which of the account's keys an address signs data with.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DataSigner {
    /// The address, in bech32.
    pub address: String,
    /// "payment" (then `role` and `index`) or "stake".
    pub key: String,
    pub role: Option<u32>,
    pub index: Option<u32>,
}

fn parse_address(text: &str) -> Result<Address> {
    let text = text.trim();
    Address::from_bech32(text)
        .or_else(|_| Address::from_hex(text))
        .map_err(|_| anyhow!("That isn't an address."))
}

fn data_key(account: &CardanoAccount, request: &DataRequest) -> Result<Option<(Address, Signer)>> {
    let flag = network_flag(&request.network)?;
    let address = parse_address(&request.address)?;
    if address
        .network()
        .is_some_and(|n| n != address_network(flag))
    {
        return Ok(None);
    }
    let keys = keys_of(account, &request.keys, request.stake_index)?;
    let signer = match &address {
        Address::Shelley(s) => match s.payment() {
            ShelleyPaymentPart::Key(h) => keys.payment.get(h).copied().map(Signer::Payment),
            ShelleyPaymentPart::Script(_) => None,
        },
        Address::Stake(s) => match s.payload() {
            StakePayload::Stake(h) if *h == keys.stake => Some(Signer::Stake),
            _ => None,
        },
        Address::Byron(_) => None,
    };
    Ok(signer.map(|s| (address, s)))
}

/// Which key signs data for `address`: `None` when it isn't one of the
/// account's (CIP-30's `AddressNotPK`).
pub fn data_signer(account: &CardanoAccount, request: &DataRequest) -> Result<Option<DataSigner>> {
    Ok(data_key(account, request)?.map(|(address, signer)| {
        let bech32 = address.to_bech32().unwrap_or_else(|_| address.to_hex());
        match signer {
            Signer::Payment(p) => DataSigner {
                address: bech32,
                key: "payment".into(),
                role: Some(p.role),
                index: Some(p.index),
            },
            Signer::Stake => DataSigner {
                address: bech32,
                key: "stake".into(),
                role: None,
                index: None,
            },
        }
    }))
}

/// CIP-30's `DataSignature`: a COSE_Sign1 and the COSE_Key to check it, hex.
#[derive(Serialize, Debug)]
pub struct DataSignature {
    pub signature: String,
    pub key: String,
}

/// Signs `payload` for `address` as CIP-8 says: a COSE_Sign1 whose
/// protected header names EdDSA and the address, over the payload as given
/// (not hashed).
pub fn sign_data(account: &CardanoAccount, request: &DataRequest) -> Result<DataSignature> {
    let (address, signer) =
        data_key(account, request)?.ok_or_else(|| anyhow!("That address isn't this account's."))?;
    let payload =
        hex::decode(request.payload.trim()).map_err(|_| anyhow!("The data to sign isn't hex."))?;
    let key = match signer {
        Signer::Payment(p) => {
            let role = if p.role == 0 {
                Role::Receive
            } else {
                Role::Change
            };
            account.private_key(role, p.index)?
        }
        Signer::Stake => account.private_key(Role::Staking, request.stake_index)?,
    }
    .to_ed25519_private_key();

    // { 1 (alg): -8 (EdDSA), "address": bytes }
    let protected = cbor(|e| {
        e.map(2)?
            .u8(1)?
            .i8(-8)?
            .str("address")?
            .bytes(&address.to_vec())?;
        Ok(())
    });
    let to_sign = cbor(|e| {
        e.array(4)?
            .str("Signature1")?
            .bytes(&protected)?
            .bytes(&[])?
            .bytes(&payload)?;
        Ok(())
    });
    let signature = key.sign(&to_sign);
    let cose_sign1 = cbor(|e| {
        e.array(4)?
            .bytes(&protected)?
            .map(1)?
            .str("hashed")?
            .bool(false)?
            .bytes(&payload)?
            .bytes(signature.as_ref())?;
        Ok(())
    });
    // { 1 (kty): 1 (OKP), 3 (alg): -8 (EdDSA), -1 (crv): 6 (Ed25519), -2 (x): public key }
    let cose_key = cbor(|e| {
        e.map(4)?
            .u8(1)?
            .u8(1)?
            .u8(3)?
            .i8(-8)?
            .i8(-1)?
            .u8(6)?
            .i8(-2)?
            .bytes(key.public_key().as_ref())?;
        Ok(())
    });
    Ok(DataSignature {
        signature: hex::encode(cose_sign1),
        key: hex::encode(cose_key),
    })
}
