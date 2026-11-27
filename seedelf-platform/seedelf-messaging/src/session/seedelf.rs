//! A Seedelf as Messages sees it, and its messaging register on a hashed
//! base (docs/protocol.md §21.3, chunk 55).
//!
//! A Seedelf is the handle: "message me at ⟨Seedelf⟩". Messages reads and
//! writes with its own key, x_m, never the Seedelf key x, on a register
//! M_S = (h_S, [x_m]h_S) whose base h_S is a hash of the Seedelf: its
//! network, its policy, its asset name and its datum's register. Nobody
//! chooses h_S, so publishing [x_m]h_S answers no one's static Diffie–Hellman
//! question (docs/joint-security.md, rule 1m).
//!
//! No API here takes a base. A [`Handle`] is made only by
//! [`Seedelf::handle`], from the wallet's own messaging key, or by a checked
//! [`Certificate`](super::Certificate), from the other side's: either way
//! the crate computes h_S itself.

use blstrs::{G1Affine, G1Projective};
use group::{Curve, Group};

use crate::register::Register;
use crate::session::first_contact::MAX_TO_LEN;
use crate::{Error, SecretKey};

/// A Seedelf policy's hash: 28 bytes.
pub const POLICY_LEN: usize = 28;

/// The network byte for preprod (§21.2). Cardano's network id isn't used:
/// it's 0 for every test network.
pub const NETWORK_PREPROD: u8 = 0x00;

/// The network byte for mainnet (§21.2).
pub const NETWORK_MAINNET: u8 = 0x01;

/// The domain separation tag of h_S's hash to the curve: RFC 9380's
/// `BLS12381G1_XMD:SHA-256_SSWU_RO_`, its tag ending in that suite's ID as
/// RFC 9380 §3.1 recommends. 64 bytes.
pub const HANDLE_BASE_DST: &[u8] =
    b"Seedelf-Messaging|v1|handle-base|BLS12381G1_XMD:SHA-256_SSWU_RO_";

/// Where a Seedelf lives: its network's byte and the Seedelf policy's hash
/// (§21.3, §21.4). Every Seedelf, certificate and reveal is read under one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Chain {
    network: u8,
    policy: [u8; POLICY_LEN],
}

impl Chain {
    /// A chain from its network's byte, [`NETWORK_PREPROD`] or
    /// [`NETWORK_MAINNET`], and the policy's hash. Any other network byte is
    /// [`Error::UnknownNetwork`].
    pub fn new(network: u8, policy: [u8; POLICY_LEN]) -> Result<Self, Error> {
        match network {
            NETWORK_PREPROD | NETWORK_MAINNET => Ok(Self { network, policy }),
            _ => Err(Error::UnknownNetwork),
        }
    }

    /// The network's byte.
    pub fn network(&self) -> u8 {
        self.network
    }

    /// The Seedelf policy's hash.
    pub fn policy(&self) -> &[u8; POLICY_LEN] {
        &self.policy
    }

    /// The relay pool's name for this chain's network, `preprod` or
    /// `mainnet` (protocol.md §17.1): what a listing digest is taken under.
    pub fn pool(&self) -> &'static str {
        if self.network == NETWORK_MAINNET {
            "mainnet"
        } else {
            "preprod"
        }
    }
}

/// A Seedelf: its chain, its asset name (1 to 32 raw bytes) and its datum's
/// register (g_S, u_S), the register of the Seedelf key x, as the chain
/// shows it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Seedelf {
    chain: Chain,
    name: Vec<u8>,
    register: Register,
}

impl Seedelf {
    /// A Seedelf from its chain, its asset name, 1 to 32 bytes, and its
    /// datum's register. A name of another length is
    /// [`Error::InvalidMessage`].
    pub fn new(chain: Chain, name: &[u8], register: Register) -> Result<Self, Error> {
        if name.is_empty() || name.len() > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        Ok(Self {
            chain,
            name: name.to_vec(),
            register,
        })
    }

    /// The chain.
    pub fn chain(&self) -> &Chain {
        &self.chain
    }

    /// The asset name.
    pub fn name(&self) -> &[u8] {
        &self.name
    }

    /// The datum's register (g_S, u_S).
    pub fn register(&self) -> &Register {
        &self.register
    }

    /// h_S's message: `network ‖ policy ‖ len(N) ‖ N ‖ g_S ‖ u_S`, the points
    /// compressed (§21.3).
    pub(crate) fn base_message(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + POLICY_LEN + 1 + MAX_TO_LEN + 96);
        out.push(self.chain.network);
        out.extend_from_slice(&self.chain.policy);
        out.push(self.name.len() as u8);
        out.extend_from_slice(&self.name);
        out.extend_from_slice(&self.register.to_bytes());
        out
    }

    /// h_S, the base of the Seedelf's messaging register: RFC 9380's hash to
    /// G1 of [`Self::base_message`] under [`HANDLE_BASE_DST`]. The hash
    /// clears the cofactor, so h_S is in G1; an h_S that's the identity
    /// (probability about 2⁻²⁵⁵) is [`Error::IdentityPoint`].
    pub(crate) fn base(&self) -> Result<G1Affine, Error> {
        let base = G1Projective::hash_to_curve(&self.base_message(), HANDLE_BASE_DST, &[]);
        if bool::from(base.is_identity()) {
            return Err(Error::IdentityPoint);
        }
        Ok(base.to_affine())
    }

    /// The wallet's own handle for this Seedelf: its messaging register
    /// `M_S = (h_S, [x_m]h_S)`, with `key` the messaging key x_m, never the
    /// Seedelf key. A first message's `to` and base proof are checked
    /// against it, and a reveal is made with it.
    pub fn handle(&self, key: &SecretKey) -> Result<Handle, Error> {
        let base = self.base()?;
        let value = (G1Projective::from(base) * key.scalar()).to_affine();
        Ok(Handle {
            seedelf: self.clone(),
            register: Register::from_checked(base, value),
        })
    }
}

/// A Seedelf and its messaging register M_S = (h_S, m_S): one of the
/// reader's handles, which a first message's `to` and proof are checked
/// against, or the handle a writer writes to.
///
/// Made only by [`Seedelf::handle`] (the wallet's own, from its messaging
/// key) or by a checked [`Certificate`](super::Certificate) (the other
/// side's), so its base is always the hash of its Seedelf. A name may come
/// with several handles: one for each register the Seedelf has held.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Handle {
    seedelf: Seedelf,
    register: Register,
}

impl Handle {
    /// The handle of `seedelf` whose messaging value is `value`, on the base
    /// the crate computes: what a checked certificate or reveal names.
    pub(crate) fn from_value(seedelf: Seedelf, base: G1Affine, value: G1Affine) -> Self {
        Self {
            seedelf,
            register: Register::from_checked(base, value),
        }
    }

    /// The Seedelf.
    pub fn seedelf(&self) -> &Seedelf {
        &self.seedelf
    }

    /// The Seedelf's asset name.
    pub fn name(&self) -> &[u8] {
        self.seedelf.name()
    }

    /// The messaging register M_S = (h_S, m_S): what Messages writes to and
    /// proves against.
    pub fn register(&self) -> &Register {
        &self.register
    }
}
