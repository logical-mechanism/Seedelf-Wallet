//! The first-contact block F, its two proofs, its stamp, and the session
//! secret SK (docs/protocol.md §3).
//!
//! F carries two designated-verifier proofs, each a Fiat–Shamir OR-proof
//! (Cramer, Damgård and Schoenmakers) whose second branch is the reader's
//! own key, so the reader could have made it and it convinces no one else:
//!
//! - the base proof, that `p₀` re-randomizes the handle `to` names: the
//!   writer knows `b` with `p₀ = [b]g_S`, or the handle's key;
//! - the keys proof, that the writer knows the keys of `E_A` and of the
//!   header key `S_A` and, from a handle, of `A` or of the reader's `w₀`.
//!
//! So every point the reader raises to its key is one whose discrete log the
//! writer has shown it knows, or a value a held conversation already bound
//! (docs/joint-security.md, rule 1).

use std::fmt;

use blstrs::{G1Affine, G1Projective, Scalar};
use ff::Field;
use group::Curve;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::Error;
use crate::keys::scalar_mod_q;
use crate::register::{POINT_LEN, Register, decode_point};
use crate::session::draw::{Draw, hedge, hedged_aux_draws, hedged_or_draws, hedged_scalar};
use crate::session::secret::Secret32;

/// Bytes in a conversation ID.
pub const CID_LEN: usize = 16;

/// The longest `to`: a Seedelf's asset name.
pub const MAX_TO_LEN: usize = 32;

/// A scalar of a proof: 32 bytes, big-endian, below the group order.
const SCALAR_LEN: usize = 32;

/// The proof that `p₀` re-randomizes the handle in `to`:
/// `c₁ | c₂ | z₁ | z₂`, 128 bytes.
pub const BASE_PROOF_LEN: usize = 4 * SCALAR_LEN;

/// The keys proof of a first message from a handle:
/// `c₁ | c₂ | z₁ | z₂ | z_e | z_s`, 192 bytes.
pub const KEYS_PROOF_LEN: usize = 6 * SCALAR_LEN;

/// The keys proof of a continuation: `c | z_e | z_s`, 96 bytes.
pub const CONTINUATION_KEYS_PROOF_LEN: usize = 3 * SCALAR_LEN;

/// F's fixed fields: cid, t, both length bytes, `p₀`, `A` and `E_A`.
const FIXED_LEN: usize = CID_LEN + 8 + 1 + 1 + 3 * POINT_LEN;

/// F's smallest size, 282 bytes: a continuation, which has no `to` and no
/// base proof but must have `replaces`, and has the shorter keys proof.
pub const FIRST_CONTACT_MIN_LEN: usize = FIXED_LEN + CID_LEN + CONTINUATION_KEYS_PROOF_LEN;

/// F's largest size, 538 bytes: a full `to`, a `replaces`, the base proof
/// and the keys proof.
pub const FIRST_CONTACT_MAX_LEN: usize =
    FIXED_LEN + MAX_TO_LEN + CID_LEN + BASE_PROOF_LEN + KEYS_PROOF_LEN;

/// The work a first message's stamp must show, in leading zero bits: 2²⁴
/// SHA-256 attempts on average, about 7 s of WebAssembly (docs/protocol.md
/// §16.4). A reader that asked for more would drop every first message
/// written at this price.
pub const FIRST_CONTACT_STAMP_BITS: u32 = 24;

/// A first-contact stamp: 8 bytes, big-endian, after F.
pub const STAMP_LEN: usize = 8;

/// SHA-256's label for the base proof's challenge.
pub(crate) const BASE_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base";

/// HMAC-SHA-512's label for `b`, keyed by the writer's key (§16.2).
pub(crate) const BASE_SCALAR_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base-scalar";

/// HMAC-SHA-512's label for the base proof's nonce `k`, keyed by `b`
/// (§16.2).
pub(crate) const BASE_NONCE_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base-nonce";

/// SHA-256's label for the keys proof's challenge, from a handle.
pub(crate) const KEYS_HANDLE_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|keys|handle";

/// SHA-256's label for the keys proof's challenge, in a continuation.
pub(crate) const KEYS_CONTINUATION_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|keys|continuation";

/// HMAC-SHA-512's label for the keys proof's nonce `k_e`, keyed by `e_A`.
pub(crate) const KEYS_NONCE_E_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|keys-nonce|e";

/// HMAC-SHA-512's label for the keys proof's nonce `k_s`, keyed by `s_A`.
pub(crate) const KEYS_NONCE_S_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|keys-nonce|s";

/// HMAC-SHA-512's label for the keys proof's nonce `k₁`, keyed by the
/// writer's key (docs/joint-security.md, use 10).
pub(crate) const KEYS_NONCE_A_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|keys-nonce|a";

/// SHA-256's label for the stamp's digest.
pub(crate) const FIRST_STAMP_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|stamp";

/// How old a first message's `t` may be when it's read: 48 hours.
pub const FIRST_CONTACT_MAX_AGE: u64 = 48 * 3600;

/// How far ahead of the reader's clock a first message's `t` may be: an hour.
pub const FIRST_CONTACT_MAX_AHEAD: u64 = 3600;

/// HKDF-SHA256's salt for SK.
pub(crate) const SESSION_SALT: &[u8] = b"Seedelf-Messaging|v1|session|salt";

/// HKDF-SHA256's info for SK, before F.
pub(crate) const SESSION_INFO: &[u8] = b"Seedelf-Messaging|v1|session|SK";

/// A conversation's random 16-byte ID, `cid`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ConversationId(pub [u8; CID_LEN]);

impl fmt::Debug for ConversationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ConversationId(")?;
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        write!(f, ")")
    }
}

/// One of the reader's handles: a Seedelf's asset name and a register it
/// has held, which a first message's `to` and proof are checked against.
/// A name may come with several registers, every one the wallet knows.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Handle {
    name: Vec<u8>,
    register: Register,
}

impl Handle {
    /// A handle from its asset name, 1 to 32 bytes, and its register.
    pub fn new(name: &[u8], register: Register) -> Result<Self, Error> {
        if name.is_empty() || name.len() > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        Ok(Self {
            name: name.to_vec(),
            register,
        })
    }

    /// The asset name.
    pub fn name(&self) -> &[u8] {
        &self.name
    }

    /// The register.
    pub fn register(&self) -> &Register {
        &self.register
    }
}

/// The proof that `p₀ = [b]g` for the handle `(g, v)` named in `to`, or
/// that its maker knows the handle's own key `y` with `v = [y]g`: an
/// OR-proof with F′ in its challenge (docs/protocol.md §3, §16.2). The
/// writer proves `b`'s branch and simulates the other. The reader, who holds
/// `y`, could have made it for any `p₀`, so it convinces the reader alone;
/// anyone else must know `b`, so `p₀` re-randomizes the named handle.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct BaseProof {
    /// `c₁`, `b`'s branch's challenge share.
    pub(crate) c1: Scalar,
    /// `c₂`, the handle's key's challenge share.
    pub(crate) c2: Scalar,
    /// `z₁ = k + c₁·b`.
    pub(crate) z1: Scalar,
    /// `z₂`, the handle's key's response.
    pub(crate) z2: Scalar,
}

/// The proof that F's writer knows the discrete logs, on `p₀`, of the points
/// the reader raises to its key (docs/protocol.md §3, §16.2): `E_A` and the
/// first ratchet key `S_A`, and from a handle `A` or the reader's own `w₀`.
/// Its form is set by F: from a handle when `to` is there, else a
/// continuation's, which needs no `A` branch since a continuation's `A` must
/// be a value the reader already holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum KeysProof {
    /// From a handle: `log E_A` AND `log S_A` AND (`log A` OR `log w₀`).
    /// `c₁ + c₂` is the challenge; `c₁`, `z₁` are `A`'s branch, `c₂`, `z₂`
    /// `w₀`'s, and `z_e`, `z_s` answer the whole challenge.
    Handle {
        c1: Scalar,
        c2: Scalar,
        z1: Scalar,
        z2: Scalar,
        ze: Scalar,
        zs: Scalar,
    },
    /// A continuation: `log E_A` AND `log S_A`.
    Continuation { c: Scalar, ze: Scalar, zs: Scalar },
}

impl KeysProof {
    fn scalars(&self) -> Vec<Scalar> {
        match *self {
            KeysProof::Handle {
                c1,
                c2,
                z1,
                z2,
                ze,
                zs,
            } => vec![c1, c2, z1, z2, ze, zs],
            KeysProof::Continuation { c, ze, zs } => vec![c, ze, zs],
        }
    }
}

/// The first-contact block F, which every message carries until the first
/// reply:
///
/// ```text
/// cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48) | base proof (0 or 128) | keys proof (192 or 96)
/// ```
///
/// - `t`: when the conversation started, in Unix seconds, big-endian.
/// - `to`: a length byte, then the handle's asset name. Empty only for a
///   continuation.
/// - `replaces`: a length byte, then the conversation ID this one continues
///   (docs/protocol.md §6), or nothing. Required when `to` is empty.
/// - `p₀`: the conversation's base, shared by both identities.
/// - `A`: the initiator's public value on it, `[x_A]p₀`.
/// - `E_A`: the session ephemeral, `[e_A]p₀`.
/// - the base proof: `c₁ ‖ c₂ ‖ z₁ ‖ z₂`, that `p₀` re-randomizes the handle
///   in `to`; present exactly when `to` is.
/// - the keys proof: `c₁ ‖ c₂ ‖ z₁ ‖ z₂ ‖ z_e ‖ z_s` when `to` is there,
///   else `c ‖ z_e ‖ z_s`.
///
/// Every point is canonical, in G1 and not the identity, and every scalar is
/// below the group order (any may be 0): parsing checks it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FirstContact {
    pub(crate) cid: ConversationId,
    pub(crate) started_at: u64,
    pub(crate) to: Vec<u8>,
    pub(crate) replaces: Option<ConversationId>,
    pub(crate) base: G1Affine,
    pub(crate) initiator: G1Affine,
    pub(crate) ephemeral: G1Affine,
    pub(crate) proof: Option<BaseProof>,
    /// Always there in an F that was parsed or sent; `None` only while
    /// `Conversation::begin` builds one.
    pub(crate) keys_proof: Option<KeysProof>,
}

impl FirstContact {
    /// The conversation ID.
    pub fn cid(&self) -> ConversationId {
        self.cid
    }

    /// `t`: when the conversation started, in Unix seconds, by its
    /// initiator's clock.
    pub fn started_at(&self) -> u64 {
        self.started_at
    }

    /// The handle's asset name the initiator wrote to, which its proof
    /// verifies, or empty for a continuation.
    pub fn to(&self) -> &[u8] {
        &self.to
    }

    /// The conversation this one says it continues.
    pub fn replaces(&self) -> Option<ConversationId> {
        self.replaces
    }

    /// The base `p₀`, compressed.
    pub fn base_bytes(&self) -> [u8; POINT_LEN] {
        self.base.to_compressed()
    }

    /// `A`, the initiator's public value, compressed.
    pub fn initiator_bytes(&self) -> [u8; POINT_LEN] {
        self.initiator.to_compressed()
    }

    /// F's bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = self.proven_bytes();
        if let Some(proof) = &self.keys_proof {
            for scalar in proof.scalars() {
                out.extend_from_slice(&scalar.to_bytes_be());
            }
        }
        out
    }

    /// `SHA-256("Seedelf-Messaging|v1|session|stamp" ‖ F)`: what a stamp's
    /// work is over. Each attempt is then one SHA-256 block, of this digest
    /// and the 8-byte nonce, as the relay's stamp is
    /// ([`stamp_bits`](crate::relay::stamp_bits), [`find_stamp`](crate::relay::find_stamp)).
    pub fn stamp_digest(&self) -> [u8; 32] {
        Sha256::new()
            .chain_update(FIRST_STAMP_LABEL)
            .chain_update(self.to_bytes())
            .finalize()
            .into()
    }

    /// F before its proofs, F′: what the base proof's challenge covers.
    pub(crate) fn prefix_bytes(&self) -> Vec<u8> {
        let mut out = head_bytes(&self.cid, self.started_at, &self.to, self.replaces);
        out.extend_from_slice(&self.base.to_compressed());
        out.extend_from_slice(&self.initiator.to_compressed());
        out.extend_from_slice(&self.ephemeral.to_compressed());
        out
    }

    /// F before its keys proof, F″: F′ and the base proof, if there is one.
    /// What the keys proof's challenge covers, inside its `M`.
    pub(crate) fn proven_bytes(&self) -> Vec<u8> {
        let mut out = self.prefix_bytes();
        if let Some(proof) = &self.proof {
            for scalar in [proof.c1, proof.c2, proof.z1, proof.z2] {
                out.extend_from_slice(&scalar.to_bytes_be());
            }
        }
        out
    }

    /// F's size in bytes: 282 for a continuation, 491 to 538 from a handle.
    #[allow(clippy::len_without_is_empty)]
    pub fn len(&self) -> usize {
        FIXED_LEN
            + self.to.len()
            + if self.replaces.is_some() { CID_LEN } else { 0 }
            + if self.proof.is_some() {
                BASE_PROOF_LEN
            } else {
                0
            }
            + match self.keys_proof {
                Some(KeysProof::Handle { .. }) => KEYS_PROOF_LEN,
                Some(KeysProof::Continuation { .. }) => CONTINUATION_KEYS_PROOF_LEN,
                None => 0,
            }
    }

    /// Whether the base proof shows that `p₀` re-randomizes `handle`, or
    /// that its maker holds `handle`'s key (docs/protocol.md §16.2). Needs
    /// public values only.
    pub(crate) fn proves_base(&self, handle: &Register) -> bool {
        let Some(proof) = &self.proof else {
            return false;
        };
        base_verifies(handle, &self.base, &self.prefix_bytes(), proof)
    }

    /// Whether the keys proof verifies for the reader's `w₀ = responder` and
    /// the first ratchet key `S_A = ratchet`, every message's header key
    /// (docs/protocol.md §16.2), in the form F's `to` sets.
    pub(crate) fn proves_keys(&self, responder: &G1Affine, ratchet: &G1Affine) -> bool {
        let Some(proof) = &self.keys_proof else {
            return false;
        };
        let from_handle = !self.to.is_empty();
        if from_handle != matches!(proof, KeysProof::Handle { .. }) {
            return false;
        }
        KeysStatement::of(self, responder, ratchet).verifies(proof)
    }

    /// F from exactly its bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        let (first, used) = Self::parse_prefix(bytes)?;
        if used != bytes.len() {
            return Err(Error::InvalidMessage);
        }
        Ok(first)
    }

    /// F from the start of `bytes`, and how many bytes it took.
    pub(crate) fn parse_prefix(bytes: &[u8]) -> Result<(Self, usize), Error> {
        let mut reader = Reader::new(bytes);
        let cid = ConversationId(reader.array()?);
        let started_at = u64::from_be_bytes(reader.array()?);
        let to_len = usize::from(reader.byte()?);
        if to_len > MAX_TO_LEN {
            return Err(Error::InvalidMessage);
        }
        let to = reader.take(to_len)?.to_vec();
        let replaces = match reader.byte()? {
            0 => None,
            16 => Some(ConversationId(reader.array()?)),
            _ => return Err(Error::InvalidMessage),
        };
        // A first message names a handle or continues a conversation.
        if to.is_empty() && replaces.is_none() {
            return Err(Error::InvalidMessage);
        }
        let base = decode_point(&reader.array()?)?;
        let initiator = decode_point(&reader.array()?)?;
        let ephemeral = decode_point(&reader.array()?)?;
        let mut scalar =
            || -> Result<Scalar, Error> { proof_scalar(&reader.array::<SCALAR_LEN>()?) };
        let (proof, keys_proof) = if to.is_empty() {
            let keys = KeysProof::Continuation {
                c: scalar()?,
                ze: scalar()?,
                zs: scalar()?,
            };
            (None, keys)
        } else {
            let base_proof = BaseProof {
                c1: scalar()?,
                c2: scalar()?,
                z1: scalar()?,
                z2: scalar()?,
            };
            let keys = KeysProof::Handle {
                c1: scalar()?,
                c2: scalar()?,
                z1: scalar()?,
                z2: scalar()?,
                ze: scalar()?,
                zs: scalar()?,
            };
            (Some(base_proof), keys)
        };
        Ok((
            Self {
                cid,
                started_at,
                to,
                replaces,
                base,
                initiator,
                ephemeral,
                proof,
                keys_proof: Some(keys_proof),
            },
            reader.position(),
        ))
    }
}

/// A proof's scalar from its 32 big-endian bytes: below the group order,
/// zero allowed. Anything else is [`Error::InvalidMessage`].
fn proof_scalar(bytes: &[u8; SCALAR_LEN]) -> Result<Scalar, Error> {
    Option::from(Scalar::from_bytes_be(bytes)).ok_or(Error::InvalidMessage)
}

/// F's head: `cid | t | len | to | len | replaces`, F's bytes before `p₀`.
/// What `b` covers ([`base_scalar`]), since `p₀` follows from it.
pub(crate) fn head_bytes(
    cid: &ConversationId,
    started_at: u64,
    to: &[u8],
    replaces: Option<ConversationId>,
) -> Vec<u8> {
    let mut out = Vec::with_capacity(FIRST_CONTACT_MAX_LEN);
    out.extend_from_slice(&cid.0);
    out.extend_from_slice(&started_at.to_be_bytes());
    // Both lengths are checked on construction and on parse.
    out.push(to.len() as u8);
    out.extend_from_slice(to);
    match replaces {
        Some(cid) => {
            out.push(CID_LEN as u8);
            out.extend_from_slice(&cid.0);
        }
        None => out.push(0),
    }
    out
}

/// What `b`'s HMAC is over: `"Seedelf-Messaging|v1|session|base-scalar" ‖ g ‖
/// v ‖ head ‖ aux`, with `(g, v)` the handle and `head` F's head.
pub(crate) fn base_scalar_message(handle: &Register, head: &[u8], aux: &[u8; 32]) -> Vec<u8> {
    let mut out = BASE_SCALAR_LABEL.to_vec();
    out.extend_from_slice(&handle.to_bytes());
    out.extend_from_slice(head);
    out.extend_from_slice(aux);
    out
}

/// `b`, the re-randomization of `handle` into the responder's identity:
/// HMAC-SHA-512 keyed by the writer's key `x` over [`base_scalar_message`],
/// with 32 drawn bytes of `aux`, reduced mod q ([`hedged_scalar`]).
///
/// It blinds the writer's `A = [x][b]g`: whoever learns `b` gets `[x]g` on a
/// generator they chose. Keyed by `x`, it stays secret whatever the random
/// source gives (docs/joint-security.md, rule 1 and rule 2).
pub(crate) fn base_scalar(
    x: &Scalar,
    handle: &Register,
    head: &[u8],
    draw: &mut dyn Draw,
) -> Scalar {
    hedged_scalar(x, draw, |aux| base_scalar_message(handle, head, aux))
}

/// What the base proof's nonce's HMAC is over:
/// `"Seedelf-Messaging|v1|session|base-nonce" ‖ g ‖ v ‖ p₀ ‖ F′ ‖ c₂ ‖ z₂ ‖ aux`,
/// with `c₂` and `z₂` the simulated branch's. Everything the challenge
/// covers but `T₁`, which follows from the nonce: `T₂` follows from `c₂`,
/// `z₂` and the handle.
pub(crate) fn base_nonce_message(
    handle: &Register,
    base: &G1Affine,
    prefix: &[u8],
    simulated: (&Scalar, &Scalar),
    aux: &[u8; 32],
) -> Vec<u8> {
    let mut out = BASE_NONCE_LABEL.to_vec();
    out.extend_from_slice(&handle.to_bytes());
    out.extend_from_slice(&base.to_compressed());
    out.extend_from_slice(prefix);
    out.extend_from_slice(&simulated.0.to_bytes_be());
    out.extend_from_slice(&simulated.1.to_bytes_be());
    out.extend_from_slice(aux);
    out
}

/// `SHA-256("Seedelf-Messaging|v1|session|base" ‖ g ‖ v ‖ p₀ ‖ T₁ ‖ T₂ ‖ F′)`,
/// with `(g, v)` the handle, `T₁` and `T₂` the two branches' commitments,
/// each compressed (O as `0xc0` then 47 zero bytes), and `F′` F before its
/// proofs.
pub(crate) fn base_challenge(
    handle: &Register,
    base: &G1Affine,
    commitments: (&G1Affine, &G1Affine),
    prefix: &[u8],
) -> [u8; 32] {
    Sha256::new()
        .chain_update(BASE_LABEL)
        .chain_update(handle.to_bytes())
        .chain_update(base.to_compressed())
        .chain_update(commitments.0.to_compressed())
        .chain_update(commitments.1.to_compressed())
        .chain_update(prefix)
        .finalize()
        .into()
}

/// The commitments a base proof gives, as the reader recomputes them:
/// `T₁ = [z₁]g − [c₁]p₀` and `T₂ = [z₂]g − [c₂]v`.
pub(crate) fn base_commitments(
    handle: &Register,
    base: &G1Affine,
    proof: &BaseProof,
) -> (G1Affine, G1Affine) {
    (
        (handle.generator() * proof.z1 - G1Projective::from(*base) * proof.c1).to_affine(),
        (handle.generator() * proof.z2 - handle.public_value() * proof.c2).to_affine(),
    )
}

/// Whether a base proof verifies: `c₁ + c₂` is the challenge over its
/// commitments, mod q, compared in F_q.
pub(crate) fn base_verifies(
    handle: &Register,
    base: &G1Affine,
    prefix: &[u8],
    proof: &BaseProof,
) -> bool {
    let (t1, t2) = base_commitments(handle, base, proof);
    scalar_mod_q(&base_challenge(handle, base, (&t1, &t2), prefix)) == proof.c1 + proof.c2
}

/// The proof that `base = [b]g` for `handle = (g, v)`, F′ being `prefix`,
/// with the handle's key's branch simulated. Draws `c₂`, `z₂` and 32 bytes
/// of `aux` ([`hedged_or_draws`]); its nonce `k` is HMAC-SHA-512 keyed by `b`
/// over [`base_nonce_message`], so one `k` never meets two challenges, which
/// would give `b` away. A zero `k` draws all three again.
pub(crate) fn prove_base(
    handle: &Register,
    b: &Scalar,
    prefix: &[u8],
    draw: &mut dyn Draw,
) -> BaseProof {
    let base = (handle.generator() * b).to_affine();
    let (c2, z2, k) = hedged_or_draws(draw, |c2, z2, aux| {
        let k = hedge(b, &base_nonce_message(handle, &base, prefix, (c2, z2), aux));
        (!bool::from(k.is_zero())).then_some(k)
    });
    prove_base_with(handle, b, &k, (&c2, &z2), prefix)
}

/// The base proof with its nonce `k` and simulated branch `(c₂, z₂)` given:
/// `T₁ = [k]g`, `T₂ = [z₂]g − [c₂]v`, `c` from [`base_challenge`] mod q,
/// `c₁ = c − c₂`, `z₁ = k + c₁·b`. Only [`prove_base`] chooses them; the
/// tests and vectors call this to check it.
pub(crate) fn prove_base_with(
    handle: &Register,
    b: &Scalar,
    k: &Scalar,
    simulated: (&Scalar, &Scalar),
    prefix: &[u8],
) -> BaseProof {
    let (c2, z2) = (*simulated.0, *simulated.1);
    let base = (handle.generator() * b).to_affine();
    let t1 = (handle.generator() * k).to_affine();
    let t2 = (handle.generator() * z2 - handle.public_value() * c2).to_affine();
    let c = scalar_mod_q(&base_challenge(handle, &base, (&t1, &t2), prefix));
    let c1 = c - c2;
    BaseProof {
        c1,
        c2,
        z1: k + c1 * b,
        z2,
    }
}

/// What a keys proof is about (docs/protocol.md §16.2): F's base `p₀`, `A`,
/// the responder's value `w₀`, `E_A`, the first ratchet key `S_A`, and F″.
/// Its challenge and every nonce cover
/// `M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″`, the points compressed.
pub(crate) struct KeysStatement {
    pub(crate) base: G1Affine,
    pub(crate) initiator: G1Affine,
    pub(crate) responder: G1Affine,
    pub(crate) ephemeral: G1Affine,
    pub(crate) ratchet: G1Affine,
    /// F″: F before its keys proof.
    pub(crate) proven: Vec<u8>,
}

/// The commitments a keys proof gives, as the reader recomputes them, or a
/// writer's from its nonces: `T_e`, `T_s`, and from a handle `T₁` and `T₂`.
pub(crate) struct KeysCommitments {
    pub(crate) te: G1Affine,
    pub(crate) ts: G1Affine,
    pub(crate) t1: Option<G1Affine>,
    pub(crate) t2: Option<G1Affine>,
}

/// A keys proof's three nonces and the commitments they make, from one draw.
struct KeysNonces {
    ke: Scalar,
    ks: Scalar,
    k1: Scalar,
    te: G1Affine,
    ts: G1Affine,
}

impl KeysStatement {
    /// The statement of `first`'s keys proof, for the responder's value
    /// `responder` and the first ratchet key `ratchet`.
    pub(crate) fn of(first: &FirstContact, responder: &G1Affine, ratchet: &G1Affine) -> Self {
        Self {
            base: first.base,
            initiator: first.initiator,
            responder: *responder,
            ephemeral: first.ephemeral,
            ratchet: *ratchet,
            proven: first.proven_bytes(),
        }
    }

    /// `M = p₀ ‖ A ‖ w₀ ‖ E_A ‖ S_A ‖ F″`.
    pub(crate) fn message(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(5 * POINT_LEN + self.proven.len());
        for point in [
            &self.base,
            &self.initiator,
            &self.responder,
            &self.ephemeral,
            &self.ratchet,
        ] {
            out.extend_from_slice(&point.to_compressed());
        }
        out.extend_from_slice(&self.proven);
        out
    }

    /// A nonce's HMAC message: `label ‖ M ‖ parts`, the parts in order
    /// (docs/protocol.md §16.2):
    /// - from a handle, `k_e` and `k_s` take `c₂ ‖ z₂ ‖ aux`, and `k₁`
    ///   takes `T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux`;
    /// - in a continuation, `k_e` and `k_s` take `aux`.
    pub(crate) fn nonce_message(&self, label: &[u8], parts: &[&[u8]]) -> Vec<u8> {
        let mut out = label.to_vec();
        out.extend_from_slice(&self.message());
        for part in parts {
            out.extend_from_slice(part);
        }
        out
    }

    /// The challenge's 32 bytes: SHA-256 of the form's label, `M` and the
    /// commitments in order, each compressed (O as `0xc0` then 47 zero
    /// bytes).
    pub(crate) fn challenge(&self, commitments: &KeysCommitments) -> [u8; 32] {
        let label = if commitments.t1.is_some() {
            KEYS_HANDLE_LABEL
        } else {
            KEYS_CONTINUATION_LABEL
        };
        let mut hash = Sha256::new()
            .chain_update(label)
            .chain_update(self.message())
            .chain_update(commitments.te.to_compressed())
            .chain_update(commitments.ts.to_compressed());
        for point in [commitments.t1, commitments.t2].into_iter().flatten() {
            hash.update(point.to_compressed());
        }
        hash.finalize().into()
    }

    /// The commitments a proof's shares and responses give: what the reader
    /// recomputes.
    pub(crate) fn commitments_of(&self, proof: &KeysProof) -> KeysCommitments {
        let p0 = G1Projective::from(self.base);
        let (c, ze, zs, initiator) = match *proof {
            KeysProof::Handle {
                c1,
                c2,
                z1,
                z2,
                ze,
                zs,
            } => (
                c1 + c2,
                ze,
                zs,
                Some((
                    (p0 * z1 - G1Projective::from(self.initiator) * c1).to_affine(),
                    (p0 * z2 - G1Projective::from(self.responder) * c2).to_affine(),
                )),
            ),
            KeysProof::Continuation { c, ze, zs } => (c, ze, zs, None),
        };
        KeysCommitments {
            te: (p0 * ze - G1Projective::from(self.ephemeral) * c).to_affine(),
            ts: (p0 * zs - G1Projective::from(self.ratchet) * c).to_affine(),
            t1: initiator.map(|(t1, _)| t1),
            t2: initiator.map(|(_, t2)| t2),
        }
    }

    /// Whether `proof` verifies: the challenge over the commitments it
    /// gives, mod q, is `c₁ + c₂` (from a handle) or `c` (a continuation),
    /// compared in F_q.
    pub(crate) fn verifies(&self, proof: &KeysProof) -> bool {
        let c = scalar_mod_q(&self.challenge(&self.commitments_of(proof)));
        match *proof {
            KeysProof::Handle { c1, c2, .. } => c == c1 + c2,
            KeysProof::Continuation { c: claimed, .. } => c == claimed,
        }
    }

    /// The proof from a handle, made by the writer, whose key is `x` and
    /// whose session ephemeral and first ratchet key are `e` and `s`
    /// (docs/joint-security.md, use 10). Its `A` is `[x]p₀`, computed here:
    /// an `A` that isn't is [`Error::NotForThisKey`], since a proof for it
    /// would give `[x]p₀` away. `w₀`'s branch is simulated.
    ///
    /// One draw of `c₂`, `z₂` and `aux` gives all three nonces
    /// ([`hedged_or_draws`]): `k_e` and `k_s` HMAC-SHA-512 keyed by `e` and
    /// `s` over `M ‖ c₂ ‖ z₂ ‖ aux`, and `k₁` keyed by `x` over
    /// `M ‖ T_e ‖ T_s ‖ c₂ ‖ z₂ ‖ aux`, each with its own label. So each
    /// covers everything its challenge does, and a zero draws everything
    /// again.
    pub(crate) fn prove_handle(
        &self,
        x: &Scalar,
        e: &Scalar,
        s: &Scalar,
        draw: &mut dyn Draw,
    ) -> Result<KeysProof, Error> {
        self.check_initiator(x)?;
        let (c2, z2, nonces) = hedged_or_draws(draw, |c2, z2, aux| {
            self.handle_nonces(x, e, s, (c2, z2), aux)
        });
        Ok(self.respond_handle(x, e, s, &nonces, (&c2, &z2)))
    }

    /// [`Self::prove_handle`] with its nonces `(k_e, k_s, k₁)` and simulated
    /// branch `(c₂, z₂)` given. Only `prove_handle` chooses them; the tests
    /// and vectors call this to check it. It refuses an `A` that isn't
    /// `[x]p₀` as `prove_handle` does.
    #[cfg(test)]
    pub(crate) fn prove_handle_with(
        &self,
        x: &Scalar,
        e: &Scalar,
        s: &Scalar,
        nonces: (&Scalar, &Scalar, &Scalar),
        simulated: (&Scalar, &Scalar),
    ) -> Result<KeysProof, Error> {
        self.check_initiator(x)?;
        let p0 = G1Projective::from(self.base);
        let nonces = KeysNonces {
            ke: *nonces.0,
            ks: *nonces.1,
            k1: *nonces.2,
            te: (p0 * nonces.0).to_affine(),
            ts: (p0 * nonces.1).to_affine(),
        };
        Ok(self.respond_handle(x, e, s, &nonces, simulated))
    }

    /// `A = [x]p₀`, or [`Error::NotForThisKey`]: no proof is made for an `A`
    /// the key doesn't own, since its response would give `[x]p₀` away.
    fn check_initiator(&self, x: &Scalar) -> Result<(), Error> {
        if (G1Projective::from(self.base) * x).to_affine() != self.initiator {
            return Err(Error::NotForThisKey);
        }
        Ok(())
    }

    /// The proof from a handle, its nonces and simulated branch chosen:
    /// `T₁ = [k₁]p₀`, `T₂ = [z₂]p₀ − [c₂]w₀`, `c` the challenge mod q,
    /// `c₁ = c − c₂`, `z₁ = k₁ + c₁·x`, `z_e = k_e + c·e`, `z_s = k_s + c·s`.
    fn respond_handle(
        &self,
        x: &Scalar,
        e: &Scalar,
        s: &Scalar,
        nonces: &KeysNonces,
        simulated: (&Scalar, &Scalar),
    ) -> KeysProof {
        let (c2, z2) = (*simulated.0, *simulated.1);
        let p0 = G1Projective::from(self.base);
        let commitments = KeysCommitments {
            te: nonces.te,
            ts: nonces.ts,
            t1: Some((p0 * nonces.k1).to_affine()),
            t2: Some((p0 * z2 - G1Projective::from(self.responder) * c2).to_affine()),
        };
        let c = scalar_mod_q(&self.challenge(&commitments));
        let c1 = c - c2;
        KeysProof::Handle {
            c1,
            c2,
            z1: nonces.k1 + c1 * x,
            z2,
            ze: nonces.ke + c * e,
            zs: nonces.ks + c * s,
        }
    }

    /// The three nonces of a proof from a handle for one draw, or `None` if
    /// any is zero.
    fn handle_nonces(
        &self,
        x: &Scalar,
        e: &Scalar,
        s: &Scalar,
        simulated: (&Scalar, &Scalar),
        aux: &[u8; 32],
    ) -> Option<KeysNonces> {
        let p0 = G1Projective::from(self.base);
        let (c2, z2) = (simulated.0.to_bytes_be(), simulated.1.to_bytes_be());
        let ke = hedge(e, &self.nonce_message(KEYS_NONCE_E_LABEL, &[&c2, &z2, aux]));
        let ks = hedge(s, &self.nonce_message(KEYS_NONCE_S_LABEL, &[&c2, &z2, aux]));
        let (te, ts) = ((p0 * ke).to_affine(), (p0 * ks).to_affine());
        let k1 = hedge(
            x,
            &self.nonce_message(
                KEYS_NONCE_A_LABEL,
                &[&te.to_compressed(), &ts.to_compressed(), &c2, &z2, aux],
            ),
        );
        let zero = bool::from(ke.is_zero() | ks.is_zero() | k1.is_zero());
        (!zero).then_some(KeysNonces { ke, ks, k1, te, ts })
    }

    /// A continuation's proof, of `e` and `s` alone: no use of the writer's
    /// key, since a continuation's `A` and `w₀` are values both sides already
    /// hold. One draw of `aux` gives both nonces, `k_e` and `k_s`
    /// HMAC-SHA-512 keyed by `e` and `s` over `M ‖ aux` ([`hedged_aux_draws`]),
    /// and a zero draws `aux` again for both.
    pub(crate) fn prove_continuation(
        &self,
        e: &Scalar,
        s: &Scalar,
        draw: &mut dyn Draw,
    ) -> KeysProof {
        let (ke, ks) = hedged_aux_draws(draw, |aux| {
            let ke = hedge(e, &self.nonce_message(KEYS_NONCE_E_LABEL, &[aux]));
            let ks = hedge(s, &self.nonce_message(KEYS_NONCE_S_LABEL, &[aux]));
            (!bool::from(ke.is_zero() | ks.is_zero())).then_some((ke, ks))
        });
        self.prove_continuation_with(e, s, (&ke, &ks))
    }

    /// A continuation's proof with its nonces `(k_e, k_s)` given:
    /// `T_e = [k_e]p₀`, `T_s = [k_s]p₀`, `c` the challenge mod q,
    /// `z_e = k_e + c·e`, `z_s = k_s + c·s`. Only [`Self::prove_continuation`]
    /// chooses them; the tests and vectors call this to check it.
    pub(crate) fn prove_continuation_with(
        &self,
        e: &Scalar,
        s: &Scalar,
        nonces: (&Scalar, &Scalar),
    ) -> KeysProof {
        let p0 = G1Projective::from(self.base);
        let (ke, ks) = (*nonces.0, *nonces.1);
        let commitments = KeysCommitments {
            te: (p0 * ke).to_affine(),
            ts: (p0 * ks).to_affine(),
            t1: None,
            t2: None,
        };
        let c = scalar_mod_q(&self.challenge(&commitments));
        KeysProof::Continuation {
            c,
            ze: ke + c * e,
            zs: ks + c * s,
        }
    }
}

/// Whether a first message started at `t` may be read at `now`:
/// `now ∈ [t − 1 h, t + 48 h]`, both ends included (docs/protocol.md §5).
pub fn within_window(t: u64, now: u64) -> bool {
    now <= t.saturating_add(FIRST_CONTACT_MAX_AGE)
        && t <= now.saturating_add(FIRST_CONTACT_MAX_AHEAD)
}

/// SK = HKDF-SHA256(salt = "Seedelf-Messaging|v1|session|salt",
/// ikm = ephemeral DH ‖ static DH, info = "Seedelf-Messaging|v1|session|SK" ‖ F),
/// 32 bytes.
///
/// The initiator passes `[e_A]w₀` and `[x_A]w₀`; the responder `[x_B]E_A`
/// and `[x_B]A`, which are the same points.
pub(crate) fn session_key(
    ephemeral_dh: &[u8; POINT_LEN],
    static_dh: &[u8; POINT_LEN],
    first_contact: &[u8],
) -> Secret32 {
    let mut ikm = Zeroizing::new([0u8; 2 * POINT_LEN]);
    ikm[..POINT_LEN].copy_from_slice(ephemeral_dh);
    ikm[POINT_LEN..].copy_from_slice(static_dh);
    let mut sk = Secret32::zero();
    Hkdf::<Sha256>::new(Some(SESSION_SALT), ikm.as_ref())
        .expand_multi_info(&[SESSION_INFO, first_contact], sk.as_mut())
        // HKDF-SHA256 refuses only outputs over 8,160 bytes.
        .expect("32 bytes is within HKDF-SHA256's limit");
    sk
}

/// A cursor over untrusted bytes: every read checks the length.
pub(crate) struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8], Error> {
        let end = self.at.checked_add(n).ok_or(Error::InvalidMessage)?;
        let slice = self.bytes.get(self.at..end).ok_or(Error::InvalidMessage)?;
        self.at = end;
        Ok(slice)
    }

    pub(crate) fn array<const N: usize>(&mut self) -> Result<[u8; N], Error> {
        Ok(self.take(N)?.try_into().expect("take returned N bytes"))
    }

    pub(crate) fn byte(&mut self) -> Result<u8, Error> {
        Ok(self.take(1)?[0])
    }

    pub(crate) fn rest(&mut self) -> &'a [u8] {
        let rest = &self.bytes[self.at..];
        self.at = self.bytes.len();
        rest
    }

    pub(crate) fn position(&self) -> usize {
        self.at
    }

    pub(crate) fn is_done(&self) -> bool {
        self.at == self.bytes.len()
    }
}
