//! Staking and voting delegation for a Cardano account: certificates and
//! reward withdrawals, riding in an account transaction.
//!
//! Pallas's builder can stage neither (`pallas-txbuilder` 0.33 writes `None`
//! for both, and 1.4 is the same), so an account transaction is staged and
//! built as usual, then [`Staking::patch`] decodes the body, sets them, and
//! encodes it again. That changes the body's hash: the patched transaction
//! comes back with its new hash, so it's always patched first and signed
//! after, and `BuiltTransaction::sign` signs the right hash.
//!
//! The ledger's rules, which the builders here keep:
//!
//! - A key is registered with a deposit (`key_deposit`), and unregistering
//!   returns exactly the deposit paid. Registering and delegating go in one
//!   certificate (Conway's `StakeRegDeleg` and `VoteRegDeleg`).
//! - A withdrawal takes the whole reward balance: the ledger refuses anything
//!   else. Since Conway's second phase it also refuses one from a key whose
//!   vote isn't delegated (to a DRep, or always abstain or no confidence).
//! - Unregistering needs an empty reward balance, so it withdraws it too.
//! - Every certificate here, and a withdrawal, needs the stake key's
//!   signature.

use std::fmt;

use anyhow::{Context, Result, anyhow, bail};
use bech32::{FromBase32, ToBase32, Variant};
use pallas_addresses::{Address, StakePayload};
use pallas_crypto::hash::Hash;
use pallas_primitives::conway::{self, Certificate, DRep};
use pallas_primitives::{Fragment, NonEmptyKeyValuePairs, NonEmptySet, StakeCredential};
use pallas_txbuilder::BuiltTransaction;

use crate::build::tx_id;

/// Koios's names for the two pinned vote delegations (`account_info`'s
/// `delegated_drep`), which the wallet uses too.
pub const ALWAYS_ABSTAIN: &str = "drep_always_abstain";
pub const ALWAYS_NO_CONFIDENCE: &str = "drep_always_no_confidence";

/// CIP-129's header byte of a DRep ID: a key hash, or a script hash.
const DREP_KEY_HEADER: u8 = 0x22;
const DREP_SCRIPT_HEADER: u8 = 0x23;

/// The account's stake key, as certificates and withdrawals name it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StakeKey {
    credential: StakeCredential,
    /// The reward address's bytes: what a withdrawal is keyed by.
    reward_account: Vec<u8>,
}

impl StakeKey {
    /// The key of a reward (stake) address. A script's reward address isn't
    /// an account's, so it's refused.
    pub fn new(stake_address: &Address) -> Result<Self> {
        let Address::Stake(stake) = stake_address else {
            bail!("A stake key is named by its reward (stake) address");
        };
        let StakePayload::Stake(hash) = stake.payload() else {
            bail!("That reward address belongs to a script, not an account's stake key");
        };
        Ok(StakeKey {
            credential: StakeCredential::AddrKeyhash(*hash),
            reward_account: stake_address.to_vec(),
        })
    }
}

/// Where the stake key stands, as Koios's `account_info` says.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StakeState {
    pub registered: bool,
    /// The deposit paid when it was registered: what unregistering returns.
    pub deposit: u64,
    /// The reward balance: a withdrawal must take all of it.
    pub rewards: u64,
    /// Whether its vote is delegated, which Conway needs for a withdrawal.
    pub votes: bool,
}

/// Something to do with the stake key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StakeAction {
    /// Delegate to a stake pool, registering the key first when it isn't.
    Delegate(Hash<28>),
    /// Delegate the vote, registering the key first when it isn't.
    Vote(DRep),
    /// Withdraw the rewards.
    Withdraw,
    /// Stop staking: withdraw the rewards, unregister the key, and get its
    /// deposit back.
    Stop,
}

/// Why the rewards can't be withdrawn: the vote isn't delegated.
#[derive(Debug, Clone, Copy)]
pub struct RewardsLocked;

impl fmt::Display for RewardsLocked {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "Your rewards can't be withdrawn until you delegate your voting power: to a DRep, or always abstain",
        )
    }
}

impl std::error::Error for RewardsLocked {}

/// What an account transaction does with the stake key besides paying:
/// certificates and a reward withdrawal. Empty for a plain payment.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Staking {
    pub certificates: Vec<Certificate>,
    /// The reward account (its address bytes) and the rewards withdrawn.
    pub withdrawal: Option<(Vec<u8>, u64)>,
}

impl Staking {
    /// Nothing: a plain payment.
    pub fn none() -> Self {
        Self::default()
    }

    /// The whole reward balance, withdrawn alongside a payment: nothing when
    /// there are no rewards. Refused when the vote isn't delegated.
    pub fn withdraw(key: &StakeKey, state: &StakeState) -> Result<Self> {
        if !state.registered || state.rewards == 0 {
            return Ok(Self::none());
        }
        if !state.votes {
            bail!(RewardsLocked);
        }
        Ok(Staking {
            certificates: Vec::new(),
            withdrawal: Some((key.reward_account.clone(), state.rewards)),
        })
    }

    /// The certificates and withdrawal `action` needs, the key standing as
    /// `state` says. `key_deposit` is the current protocol parameter, paid
    /// when the key is registered.
    pub fn of(
        key: &StakeKey,
        action: &StakeAction,
        state: &StakeState,
        key_deposit: u64,
    ) -> Result<Self> {
        let cred = key.credential.clone();
        let certificate = |c: Certificate| Staking {
            certificates: vec![c],
            withdrawal: None,
        };
        Ok(match action {
            StakeAction::Delegate(pool) if state.registered => {
                certificate(Certificate::StakeDelegation(cred, *pool))
            }
            StakeAction::Delegate(pool) => {
                certificate(Certificate::StakeRegDeleg(cred, *pool, key_deposit))
            }
            StakeAction::Vote(drep) if state.registered => {
                certificate(Certificate::VoteDeleg(cred, drep.clone()))
            }
            StakeAction::Vote(drep) => {
                certificate(Certificate::VoteRegDeleg(cred, drep.clone(), key_deposit))
            }
            StakeAction::Withdraw => {
                if !state.registered || state.rewards == 0 {
                    bail!("There are no rewards to withdraw");
                }
                Self::withdraw(key, state)?
            }
            StakeAction::Stop => {
                if !state.registered {
                    bail!("This account isn't staking");
                }
                let mut stop = Self::withdraw(key, state)?;
                stop.certificates
                    .push(Certificate::UnReg(cred, state.deposit));
                stop
            }
        })
    }

    pub fn is_empty(&self) -> bool {
        self.certificates.is_empty() && self.withdrawal.is_none()
    }

    /// Whether the stake key signs: for any certificate or withdrawal here.
    pub fn signers(&self) -> usize {
        usize::from(!self.is_empty())
    }

    /// Lovelace the certificates lock up: a registration's deposit.
    pub fn deposit(&self) -> u64 {
        self.certificates
            .iter()
            .map(|c| match c {
                Certificate::Reg(_, d)
                | Certificate::StakeRegDeleg(_, _, d)
                | Certificate::VoteRegDeleg(_, _, d)
                | Certificate::StakeVoteRegDeleg(_, _, _, d) => *d,
                _ => 0,
            })
            .sum()
    }

    /// Lovelace the certificates return: an unregistration's deposit.
    pub fn refund(&self) -> u64 {
        self.certificates
            .iter()
            .map(|c| match c {
                Certificate::UnReg(_, d) => *d,
                _ => 0,
            })
            .sum()
    }

    /// Rewards withdrawn.
    pub fn withdrawn(&self) -> u64 {
        self.withdrawal.as_ref().map_or(0, |(_, l)| *l)
    }

    /// What the inputs gain (rewards, a refund) less what they lose (a
    /// deposit), for the transaction's balance; `None` below zero.
    pub fn net(&self, inputs: u64) -> Option<u64> {
        inputs
            .checked_add(self.withdrawn())?
            .checked_add(self.refund())?
            .checked_sub(self.deposit())
    }

    /// Sets the certificates and withdrawal in `built`, an unsigned
    /// transaction, and returns it with its new hash. Nothing to set leaves
    /// it as it was.
    pub fn patch(&self, mut built: BuiltTransaction) -> Result<BuiltTransaction> {
        if self.is_empty() {
            return Ok(built);
        }
        if built.signatures.is_some() {
            bail!("A transaction is patched before it's signed, not after");
        }
        let mut tx = conway::Tx::decode_fragment(&built.tx_bytes.0)
            .map_err(|e| anyhow!("The built transaction isn't a Conway transaction: {e}"))?;
        let body = &mut tx.transaction_body;
        if body.certificates.is_some() || body.withdrawals.is_some() {
            bail!("The transaction already has certificates or withdrawals");
        }
        body.certificates = NonEmptySet::from_vec(self.certificates.clone());
        body.withdrawals = self.withdrawal.as_ref().map(|(account, lovelace)| {
            NonEmptyKeyValuePairs::Def(vec![(account.clone().into(), *lovelace)])
        });
        let bytes = tx
            .encode_fragment()
            .map_err(|e| anyhow!("Failed to encode the transaction: {e}"))?;
        // Pallas doesn't export its byte types, but their fields are public.
        built.tx_hash.0 = *tx_id(&bytes)?;
        built.tx_bytes.0 = bytes;
        Ok(built)
    }
}

/// A stake pool's ID: bech32 (`pool1…`) or 56 hex characters.
pub fn parse_pool_id(id: &str) -> Result<Hash<28>> {
    let id = id.trim();
    let bytes = if id.len() == 56 && id.bytes().all(|b| b.is_ascii_hexdigit()) {
        hex::decode(id).context("A pool ID in hex is 28 bytes")?
    } else {
        let (hrp, data) = bech32_of(id).ok_or_else(|| anyhow!("That isn't a stake pool ID"))?;
        if hrp != "pool" {
            bail!("That isn't a stake pool ID: pool IDs start pool1");
        }
        data
    };
    let hash: [u8; 28] = bytes
        .try_into()
        .map_err(|_| anyhow!("That isn't a stake pool ID: it's the wrong length"))?;
    Ok(Hash::new(hash))
}

/// A pool's bech32 ID (`pool1…`).
pub fn pool_id(hash: &Hash<28>) -> String {
    bech32::encode("pool", hash.as_ref().to_base32(), Variant::Bech32)
        .expect("a pool ID always encodes")
}

/// A vote delegation: [`ALWAYS_ABSTAIN`], [`ALWAYS_NO_CONFIDENCE`], or a
/// DRep's ID. IDs are read in CIP-129 form (`drep1…` with a header byte, as
/// Koios gives them) and CIP-105's (`drep1…` for a key, `drep_script1…`).
pub fn parse_drep(id: &str) -> Result<DRep> {
    let id = id.trim();
    match id {
        ALWAYS_ABSTAIN => return Ok(DRep::Abstain),
        ALWAYS_NO_CONFIDENCE => return Ok(DRep::NoConfidence),
        _ => {}
    }
    let (hrp, data) = bech32_of(id).ok_or_else(|| anyhow!("That isn't a DRep ID"))?;
    let hash = |bytes: &[u8]| -> Result<Hash<28>> {
        let hash: [u8; 28] = bytes
            .try_into()
            .map_err(|_| anyhow!("That isn't a DRep ID: it's the wrong length"))?;
        Ok(Hash::new(hash))
    };
    match (hrp.as_str(), data.len()) {
        ("drep", 29) => match data[0] {
            DREP_KEY_HEADER => Ok(DRep::Key(hash(&data[1..])?)),
            DREP_SCRIPT_HEADER => Ok(DRep::Script(hash(&data[1..])?)),
            _ => bail!("That isn't a DRep ID: its header names something else"),
        },
        ("drep", 28) => Ok(DRep::Key(hash(&data)?)),
        ("drep_script", 28) => Ok(DRep::Script(hash(&data)?)),
        ("drep" | "drep_script", _) => bail!("That isn't a DRep ID: it's the wrong length"),
        _ => bail!("That isn't a DRep ID: DRep IDs start drep1"),
    }
}

/// A vote delegation as Koios names it: CIP-129 for a DRep, or one of the
/// pinned two.
pub fn drep_id(drep: &DRep) -> String {
    let (header, hash) = match drep {
        DRep::Abstain => return ALWAYS_ABSTAIN.to_string(),
        DRep::NoConfidence => return ALWAYS_NO_CONFIDENCE.to_string(),
        DRep::Key(h) => (DREP_KEY_HEADER, h),
        DRep::Script(h) => (DREP_SCRIPT_HEADER, h),
    };
    let bytes: Vec<u8> = std::iter::once(header)
        .chain(hash.as_ref().iter().copied())
        .collect();
    bech32::encode("drep", bytes.to_base32(), Variant::Bech32).expect("a DRep ID always encodes")
}

/// The human-readable part and bytes of a bech32 string, lowercase.
fn bech32_of(text: &str) -> Option<(String, Vec<u8>)> {
    let (hrp, data, variant) = bech32::decode(text).ok()?;
    if variant != Variant::Bech32 {
        return None;
    }
    Some((hrp, Vec::<u8>::from_base32(&data).ok()?))
}
