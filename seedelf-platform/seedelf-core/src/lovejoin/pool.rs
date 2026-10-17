//! Lovejoin's token pools: what a pool is on chain, and why the wallet
//! trusts one.
//!
//! A launch leaves a reference UTxO at `reference_holder` (always false, so
//! it's there for good) holding the pool's one `lovejoin` NFT and an inline
//! datum of eight fields: the box value, the most a fee shard may pay, and
//! the hashes of the pool's three scripts. `one_shot_mint` checks the datum's
//! shape and ranges, but **never its three hashes**: anyone can launch a pool
//! whose datum names scripts of their own. So the wallet trusts no hash a
//! datum gives. It derives the scripts itself from the seed the launch spent
//! ([`super::templates::derive`]), and a pool is one whose datum names
//! exactly those. Every address and reward account the wallet builds comes
//! from what it derived, never from the datum.
//!
//! The seed alone proves the NFT genuine, whoever supplies it: the policy
//! `one_shot_mint(seed)` hashes to can mint only in the one transaction that
//! spends the seed, and only one NFT. A seed comes from the bundled list,
//! the data layer, or the inputs of the transaction that made the reference
//! UTxO ([`find_seed`]).
//!
//! A verified pool is always read, so a box of the wallet's never vanishes
//! from view; whether it's usable for a new mix is a separate question
//! ([`super::usable`]).

use super::templates::{self, Derived, NFT_NAME, REFERENCE_HOLDER_HASH};
use super::value::{BoxToken, BoxValue};
use super::{Protocol, Version, reference_script_size};
use crate::cbor;
use crate::eval::Resolved;
use pallas_addresses::{Address, Network, ShelleyDelegationPart, ShelleyPaymentPart};
use pallas_codec::minicbor;
use pallas_codec::utils::Int;
use pallas_primitives::conway::{
    BigInt, DatumOption, PlutusData, ScriptRef, TransactionOutput, Value,
};
use pallas_primitives::{Fragment, MaybeIndefArray};
use std::fmt;

/// The ledger's ceiling on one asset's quantity in an output, and so on `Q`.
pub const MAX_TOKEN_QUANTITY: u64 = u64::MAX;

/// A token pool's reference datum, decoded as strictly as `one_shot_mint`
/// checks it at the launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceDatum {
    pub box_value: BoxValue,
    /// The most a fee shard pays for one mix (`max_fee_per_mix_lovelace`).
    /// The wallet pays its own fees, so it only shows this.
    pub max_fee: u64,
    pub mix_box_hash: [u8; 28],
    pub mix_logic_hash: [u8; 28],
    pub fee_hash: [u8; 28],
}

/// Why a UTxO at the holder isn't a pool the wallet reads. Most candidates
/// that fail are someone's spam or mistake, and are dropped without a word;
/// the reason is for the pools page's filter, and for tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejected {
    /// Not an output the ledger keeps in Conway's form, or one that can't be
    /// read.
    Unreadable,
    /// Not at `reference_holder`, or on the other network.
    NotAtHolder,
    /// At the holder, but with a stake credential, which `one_shot_mint`
    /// never allows.
    StakeCredential,
    /// It carries a reference script, which `one_shot_mint` never allows.
    ReferenceScript,
    /// It doesn't hold exactly one `lovejoin` NFT and ADA besides.
    NotOneNft,
    /// No inline datum, or not the eight fields within their ranges.
    BadDatum(String),
    /// An ADA pool on the generalized scripts. The classic pool is the only
    /// ADA pool the wallet uses ("at this moment", the owner, 2026-10-13).
    AdaPool,
    /// The seed given doesn't make this NFT's policy: no proof it's genuine.
    WrongSeed,
    /// The NFT is genuine, but its datum names scripts that aren't the ones
    /// its seed makes.
    WrongScripts,
}

impl fmt::Display for Rejected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Rejected::Unreadable => write!(f, "It can't be read as a pool's reference UTxO"),
            Rejected::NotAtHolder => write!(f, "It isn't at Lovejoin's reference holder"),
            Rejected::StakeCredential => write!(
                f,
                "It has a stake credential, which a launch never gives it"
            ),
            Rejected::ReferenceScript => write!(
                f,
                "It carries a reference script, which a launch never gives it"
            ),
            Rejected::NotOneNft => write!(f, "It doesn't hold one Lovejoin NFT and ADA alone"),
            Rejected::BadDatum(why) => write!(f, "Its datum isn't a token pool's: {why}"),
            Rejected::AdaPool => write!(
                f,
                "It's an ADA pool on the new scripts, which the wallet doesn't use"
            ),
            Rejected::WrongSeed => write!(
                f,
                "Its seed doesn't make its NFT, so it can't be proven genuine"
            ),
            Rejected::WrongScripts => write!(
                f,
                "Its datum names scripts other than the ones its launch makes"
            ),
        }
    }
}

impl std::error::Error for Rejected {}

fn int_of(data: &PlutusData) -> Option<i128> {
    match data {
        PlutusData::BigInt(BigInt::Int(int)) => Some(i128::from(int.0)),
        _ => None,
    }
}

fn bytes_of(data: &PlutusData) -> Option<Vec<u8>> {
    match data {
        PlutusData::BoundedBytes(b) => Some(b.to_vec()),
        _ => None,
    }
}

fn hash28(data: &PlutusData, field: &str) -> Result<[u8; 28], Rejected> {
    bytes_of(data)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| Rejected::BadDatum(format!("{field} isn't a 28-byte hash")))
}

impl ReferenceDatum {
    /// Decodes a reference datum: `Constr 0` of eight fields, each of its
    /// type and within the ranges `one_shot_mint` holds a launch to, and the
    /// three script hashes 28 bytes each (which it doesn't check).
    pub fn decode(datum: &[u8]) -> Result<Self, Rejected> {
        let bad = |why: &str| Rejected::BadDatum(why.to_string());
        if !cbor::within_depth(datum, cbor::MAX_DEPTH) {
            return Err(bad("it's nested too deeply to read"));
        }
        let Ok(PlutusData::Constr(constr)) = PlutusData::decode_fragment(datum) else {
            return Err(bad("it isn't a constructor"));
        };
        if constr.tag != 121 || constr.any_constructor.is_some() {
            return Err(bad("it isn't constructor 0"));
        }
        let [
            lovelace,
            policy,
            name,
            quantity,
            max_fee,
            mix_box,
            mix_logic,
            fee,
        ] = constr.fields.as_slice()
        else {
            return Err(bad("it doesn't have eight fields"));
        };
        let lovelace = int_of(lovelace).ok_or_else(|| bad("box_lovelace isn't an integer"))?;
        let box_lovelace = u64::try_from(lovelace)
            .ok()
            .filter(|l| *l > 0)
            .ok_or_else(|| bad("box_lovelace is out of range"))?;
        let max_fee =
            int_of(max_fee).ok_or_else(|| bad("max_fee_per_mix_lovelace isn't an integer"))?;
        let max_fee = u64::try_from(max_fee)
            .ok()
            .filter(|f| *f > 0 && *f < box_lovelace)
            .ok_or_else(|| bad("max_fee_per_mix_lovelace is out of range"))?;
        let policy = bytes_of(policy).ok_or_else(|| bad("token_policy isn't bytes"))?;
        let name = bytes_of(name).ok_or_else(|| bad("token_name isn't bytes"))?;
        let quantity = int_of(quantity).ok_or_else(|| bad("token_quantity isn't an integer"))?;
        let token = if policy.is_empty() {
            if !name.is_empty() || quantity != 0 {
                return Err(bad("an ADA pool's token fields aren't empty"));
            }
            None
        } else {
            let policy: [u8; 28] = policy
                .try_into()
                .map_err(|_| bad("token_policy isn't 28 bytes"))?;
            if name.len() > 32 {
                return Err(bad("token_name is over 32 bytes"));
            }
            let quantity = u64::try_from(quantity)
                .ok()
                .filter(|q| *q > 0)
                .ok_or_else(|| bad("token_quantity is out of range"))?;
            Some(BoxToken {
                policy,
                name,
                quantity,
            })
        };
        Ok(ReferenceDatum {
            box_value: BoxValue {
                lovelace: box_lovelace,
                token,
            },
            max_fee,
            mix_box_hash: hash28(mix_box, "mix_script_hash")?,
            mix_logic_hash: hash28(mix_logic, "mix_logic_script_hash")?,
            fee_hash: hash28(fee, "fee_script_hash")?,
        })
    }

    /// The datum as a launch writes it: `Constr 0` of the eight fields, in
    /// the canonical form `serialise_data` gives (fields as an indefinite
    /// list, integers and bytes in their shortest forms).
    pub fn encode(&self) -> Vec<u8> {
        let int = |n: u64| PlutusData::BigInt(BigInt::Int(Int(minicbor::data::Int::from(n))));
        let bytes = |b: &[u8]| PlutusData::BoundedBytes(b.to_vec().into());
        let (policy, name, quantity) = match &self.box_value.token {
            Some(t) => (t.policy.to_vec(), t.name.clone(), t.quantity),
            None => (Vec::new(), Vec::new(), 0),
        };
        PlutusData::Constr(pallas_primitives::Constr {
            tag: 121,
            any_constructor: None,
            fields: MaybeIndefArray::Indef(vec![
                int(self.box_value.lovelace),
                bytes(&policy),
                bytes(&name),
                int(quantity),
                int(self.max_fee),
                bytes(&self.mix_box_hash),
                bytes(&self.mix_logic_hash),
                bytes(&self.fee_hash),
            ]),
        })
        .encode_fragment()
        .expect("encoding into a Vec doesn't fail")
    }
}

/// `reference_holder`'s enterprise address on a network: where every launch's
/// reference UTxO sits, and the reference scripts the wallet publishes.
pub fn holder_address(network_flag: bool) -> Address {
    script_address(&REFERENCE_HOLDER_HASH, network_flag)
}

pub(crate) fn script_address(hash: &[u8; 28], network_flag: bool) -> Address {
    let network = if network_flag {
        Network::Testnet
    } else {
        Network::Mainnet
    };
    pallas_addresses::ShelleyAddress::new(
        network,
        ShelleyPaymentPart::Script(pallas_crypto::hash::Hash::new(*hash)),
        ShelleyDelegationPart::Null,
    )
    .into()
}

/// An output as the ledger keeps it, if it's in Conway's (post-Alonzo) form.
fn post_alonzo(output: &[u8]) -> Option<pallas_primitives::conway::PostAlonzoTransactionOutput> {
    match minicbor::decode::<TransactionOutput>(output).ok()? {
        TransactionOutput::PostAlonzo(o) => Some(o),
        TransactionOutput::Legacy(_) => None,
    }
}

/// Whether `output` is at `reference_holder` on this network, stake
/// credential or not: a UTxO there is never spent.
fn at_holder(address: &[u8], network_flag: bool) -> Option<bool> {
    let address = Address::from_bytes(address).ok()?;
    let Address::Shelley(shelley) = address else {
        return Some(false);
    };
    let network = if network_flag {
        Network::Testnet
    } else {
        Network::Mainnet
    };
    Some(
        shelley.network() == network
            && matches!(shelley.payment(), ShelleyPaymentPart::Script(h) if **h == REFERENCE_HOLDER_HASH),
    )
}

/// The policy of the one `lovejoin` NFT `value` holds with ADA alone.
fn nft_policy(value: &Value) -> Option<[u8; 28]> {
    let Value::Multiasset(_, assets) = value else {
        return None;
    };
    let [(policy, names)] = assets.as_slice() else {
        return None;
    };
    let [(name, quantity)] = names.as_slice() else {
        return None;
    };
    (name.as_slice() == NFT_NAME && u64::from(quantity) == 1).then_some(**policy)
}

/// The cheap part of [`verify_pool`], offline and without a seed: whether
/// `reference` has a launch's shape (at the holder, no stake credential, no
/// reference script, one `lovejoin` NFT and ADA alone, a token pool's eight
/// fields). Returns the NFT's policy (the pool's id) and its datum.
pub fn candidate(
    network_flag: bool,
    reference: &Resolved,
) -> Result<([u8; 28], ReferenceDatum), Rejected> {
    let output = post_alonzo(&reference.output).ok_or(Rejected::Unreadable)?;
    if at_holder(&output.address, network_flag) != Some(true) {
        return Err(Rejected::NotAtHolder);
    }
    let Ok(Address::Shelley(shelley)) = Address::from_bytes(&output.address) else {
        return Err(Rejected::Unreadable);
    };
    if !matches!(shelley.delegation(), ShelleyDelegationPart::Null) {
        return Err(Rejected::StakeCredential);
    }
    if output.script_ref.is_some() {
        return Err(Rejected::ReferenceScript);
    }
    let policy = nft_policy(&output.value).ok_or(Rejected::NotOneNft)?;
    let Some(DatumOption::Data(data)) = output.datum_option else {
        return Err(Rejected::BadDatum("there's no inline datum".to_string()));
    };
    let datum =
        ReferenceDatum::decode(&data.0.encode_fragment().map_err(|_| Rejected::Unreadable)?)?;
    if datum.box_value.token.is_none() {
        return Err(Rejected::AdaPool);
    }
    Ok((policy, datum))
}

/// Trusts a token pool, or says why not: `reference` is its reference UTxO
/// (at the holder, holding its NFT), `seed` the UTxO its launch spent, and
/// `script_refs` UTxOs that may carry its scripts as reference scripts (any
/// found at the holder; others are ignored). The checks run cheapest first:
/// the shape, offline; then the derivation, on the CPU.
///
/// Each of `mix_box` and `mix_logic` is read from a reference UTxO at the
/// holder when one carries it, and carried in each transaction otherwise
/// (about 0.12 ₳ more a transaction). A reference anywhere else could be
/// spent by whoever holds its key, which would make every transaction
/// reading it fail.
pub fn verify_pool(
    network_flag: bool,
    reference: &Resolved,
    seed: ([u8; 32], u64),
    script_refs: &[Resolved],
) -> Result<Protocol, Rejected> {
    let (policy, datum) = candidate(network_flag, reference)?;
    let derived = templates::derive(&seed.0, seed.1).map_err(|_| Rejected::WrongSeed)?;
    if derived.policy() != policy {
        return Err(Rejected::WrongSeed);
    }
    if datum.mix_box_hash != derived.mix_box.hash
        || datum.mix_logic_hash != derived.mix_logic.hash
        || datum.fee_hash != derived.fee_contract.hash
    {
        return Err(Rejected::WrongScripts);
    }
    Ok(pool_of(
        network_flag,
        reference,
        seed,
        &datum,
        &derived,
        script_refs,
    ))
}

/// The pool a verified reference UTxO describes, with its scripts read from
/// `script_refs` at the holder where they are.
fn pool_of(
    network_flag: bool,
    reference: &Resolved,
    seed: ([u8; 32], u64),
    datum: &ReferenceDatum,
    derived: &Derived,
    script_refs: &[Resolved],
) -> Protocol {
    let mut sorted: Vec<&Resolved> = script_refs.iter().collect();
    sorted.sort_by_key(|r| (r.tx_hash, r.index));
    let held = |script: &templates::Script| -> Option<Resolved> {
        sorted
            .iter()
            .find(|r| {
                let Some(output) = post_alonzo(&r.output) else {
                    return false;
                };
                at_holder(&output.address, network_flag) == Some(true)
                    && matches!(output.script_ref.map(|s| s.0),
                        Some(ScriptRef::PlutusV3Script(s)) if s.as_ref() == script.cbor.as_slice())
            })
            .map(|r| (*r).clone())
    };
    let mut references = vec![reference.clone()];
    let mut inline_scripts = Vec::new();
    for script in [&derived.mix_box, &derived.mix_logic] {
        match held(script) {
            Some(r) => references.push(r),
            None => inline_scripts.push(script.cbor.clone()),
        }
    }
    let script_bytes = references
        .iter()
        .map(|r| reference_script_size(&r.output).unwrap_or(0))
        .sum();
    Protocol {
        network_flag,
        denom: datum.box_value.lovelace,
        mix_box_hash: derived.mix_box.hash,
        mix_logic_hash: derived.mix_logic.hash,
        references,
        script_bytes,
        version: Version::TokenV1,
        id: derived.policy(),
        token: datum.box_value.token.clone(),
        max_fee: datum.max_fee,
        fee_hash: derived.fee_contract.hash,
        inline_scripts,
        seed: Some(seed),
    }
}

/// The policy a launch spending `seed` mints its NFT under: one application
/// of `one_shot_mint`, cheaper than [`templates::derive`]'s four.
pub fn policy_of(seed: &([u8; 32], u64)) -> Option<[u8; 28]> {
    templates::one_shot_mint(&seed.0, seed.1)
        .ok()
        .map(|s| s.hash)
}

/// Of `inputs` (those of the transaction that made a candidate's reference
/// UTxO, from one `tx_info`), the seed whose launch made `policy`, if any.
pub fn find_seed(policy: &[u8; 28], inputs: &[([u8; 32], u64)]) -> Option<([u8; 32], u64)> {
    inputs
        .iter()
        .find(|seed| policy_of(seed).as_ref() == Some(policy))
        .copied()
}

/// Why a verified pool can't take a new mix. Its boxes are still read, so
/// the wallet's never vanish from view, and still come back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unusable {
    /// `mix_logic`'s stake credential isn't registered, so no mix or
    /// withdraw can make its zero withdrawal. Anyone can register it.
    NotRegistered,
    /// A box holds less ADA than the ledger now asks of its output, so no
    /// mix can make one.
    BelowMinimum { has: u64, needs: u64 },
    /// A box can't pay its own way back into a Seedelf ([`super::CantPayBack`]).
    CantComeBack { has: u64, needs: u64 },
    /// The check itself couldn't be built.
    Unchecked(String),
}

impl fmt::Display for Unusable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Unusable::NotRegistered => write!(f, "Its mix_logic credential isn't registered"),
            Unusable::BelowMinimum { has, needs } => write!(
                f,
                "A box holds {has} lovelace, under the {needs} the ledger asks of it now"
            ),
            Unusable::CantComeBack { has, needs } => write!(
                f,
                "A box can't pay its own way back: {has} lovelace is left after the fee, and its Seedelf output needs {needs}"
            ),
            Unusable::Unchecked(why) => write!(f, "It couldn't be checked: {why}"),
        }
    }
}

/// What [`usable`] measured: a box's minimum now, and what bringing one back
/// costs and leaves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usable {
    pub box_minimum: u64,
    pub withdraw_fee: u64,
    /// What a box brings back into the Seedelf, its token aside.
    pub back: u64,
}

/// Whether `pool` can take a new mix under `params`, checked at each read:
/// `registered` says whether `mix_logic`'s credential is (one `account_info`
/// for every pool); a box must meet the ledger's minimum; and one must pay
/// its own way back into a Seedelf, which is built here (a box made up for
/// the purpose, owned by a key used once) and measured against the pool's
/// scripts, so the answer is the ledger's, not an estimate.
pub fn usable(
    params: &seedelf_koios::koios::ProtocolParameters,
    pool: &Protocol,
    registered: bool,
) -> Result<Usable, Unusable> {
    use blstrs::{G1Projective, Scalar};
    use group::Group;
    if !registered {
        return Err(Unusable::NotRegistered);
    }
    let unchecked = |e: anyhow::Error| Unusable::Unchecked(e.to_string());
    let sk = super::nonzero_scalar();
    let a = G1Projective::generator() * super::nonzero_scalar();
    let (a, b) = (
        seedelf_crypto::lovejoin::point_to_bytes(&a),
        seedelf_crypto::lovejoin::point_to_bytes(&(a * sk)),
    );
    let output = pool
        .box_value()
        .output(pool.mix_box_address())
        .map_err(unchecked)?
        .set_inline_datum(super::mix_datum(&a, &b));
    let box_minimum = crate::transaction::calculate_min_required_utxo(output.clone(), params)
        .map_err(unchecked)?;
    if pool.denom < box_minimum {
        return Err(Unusable::BelowMinimum {
            has: pool.denom,
            needs: box_minimum,
        });
    }
    let utxo = Resolved {
        tx_hash: [0; 32],
        index: 0,
        output: output
            .build_babbage_raw()
            .map_err(|e| Unusable::Unchecked(e.to_string()))?
            .encode_fragment()
            .map_err(|e| Unusable::Unchecked(e.to_string()))?,
    };
    let boxed = super::PoolBox::from_resolved(utxo, pool).ok_or_else(|| {
        Unusable::Unchecked("a box of its own isn't one of its boxes".to_string())
    })?;
    let destination = seedelf_crypto::register::Register::create(Scalar::from(1u64))
        .and_then(|r| r.rerandomize())
        .map_err(unchecked)?;
    match super::withdraw(params, pool, &[boxed], &sk, destination) {
        Ok(back) => Ok(Usable {
            box_minimum,
            withdraw_fee: back.fee,
            back: back.lovelace,
        }),
        Err(e) => match e.downcast_ref::<super::CantPayBack>() {
            Some(short) => Err(Unusable::CantComeBack {
                has: short.has,
                needs: short.needs,
            }),
            None => Err(unchecked(e)),
        },
    }
}
