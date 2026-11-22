//! The first-contact block F, its proof that the base re-randomizes the
//! named handle, its stamp, and the session secret SK (docs/protocol.md §3).

use std::fmt;

use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::Error;
use crate::keys::scalar_mod_q;
use crate::register::{POINT_LEN, Register, decode_point};
use crate::session::draw::{Draw, hedged_scalar};
use crate::session::secret::Secret32;

/// Bytes in a conversation ID.
pub const CID_LEN: usize = 16;

/// The longest `to`: a Seedelf's asset name.
pub const MAX_TO_LEN: usize = 32;

/// The proof that `p₀` re-randomizes the handle in `to`: its challenge `c`
/// (32) then its response `z` (32).
pub const BASE_PROOF_LEN: usize = 64;

/// F's fixed fields: cid, t, both length bytes, `p₀`, `A` and `E_A`.
const FIXED_LEN: usize = CID_LEN + 8 + 1 + 1 + 3 * POINT_LEN;

/// F's smallest size: a continuation, which has no `to` and no proof but
/// must have `replaces`.
pub const FIRST_CONTACT_MIN_LEN: usize = FIXED_LEN + CID_LEN;

/// F's largest size: a full `to`, a `replaces` and the proof.
pub const FIRST_CONTACT_MAX_LEN: usize = FIXED_LEN + MAX_TO_LEN + CID_LEN + BASE_PROOF_LEN;

/// The work a first message's stamp must show, in leading zero bits: 2²⁴
/// SHA-256 attempts on average, about 7 s of WebAssembly (docs/protocol.md
/// §16.4). A reader that asked for more would drop every first message
/// written at this price.
pub const FIRST_CONTACT_STAMP_BITS: u32 = 24;

/// A first-contact stamp: 8 bytes, big-endian, after F.
pub const STAMP_LEN: usize = 8;

/// SHA-256's label for the proof's challenge.
pub(crate) const BASE_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base";

/// HMAC-SHA-512's label for `b`, keyed by the writer's key (§16.2).
pub(crate) const BASE_SCALAR_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base-scalar";

/// HMAC-SHA-512's label for the base proof's nonce `k`, keyed by `b`
/// (§16.2).
pub(crate) const BASE_NONCE_LABEL: &[u8] = b"Seedelf-Messaging|v1|session|base-nonce";

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

/// The proof that `p₀ = [b]g` for the handle `(g, v)` named in `to`: a
/// Schnorr proof of `b` with F in its challenge (docs/protocol.md §3).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct BaseProof {
    /// `c`: the challenge, SHA-256's 32 bytes as they came.
    pub(crate) challenge: [u8; 32],
    /// `z = k + c·b`.
    pub(crate) response: Scalar,
}

/// The first-contact block F, which every message carries until the first
/// reply:
///
/// ```text
/// cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48) | proof (0 or 64)
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
/// - `proof`: `c ‖ z`, that `p₀` re-randomizes the handle in `to`; present
///   exactly when `to` is.
///
/// Every point is canonical, in G1 and not the identity, and `z` is below
/// the group order: parsing checks it.
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
        let mut out = self.prefix_bytes();
        if let Some(proof) = &self.proof {
            out.extend_from_slice(&proof.challenge);
            out.extend_from_slice(&proof.response.to_bytes_be());
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

    /// F before its proof, F′: what the proof's challenge covers.
    pub(crate) fn prefix_bytes(&self) -> Vec<u8> {
        let mut out = head_bytes(&self.cid, self.started_at, &self.to, self.replaces);
        out.extend_from_slice(&self.base.to_compressed());
        out.extend_from_slice(&self.initiator.to_compressed());
        out.extend_from_slice(&self.ephemeral.to_compressed());
        out
    }

    /// F's size in bytes: 186 for a continuation, 235 to 282 from a handle.
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
    }

    /// Whether the proof shows that `p₀` re-randomizes `handle`.
    pub(crate) fn proves_base(&self, handle: &Register) -> bool {
        let Some(proof) = &self.proof else {
            return false;
        };
        let c = scalar_mod_q(&proof.challenge);
        let commitment =
            (handle.generator() * proof.response - G1Projective::from(self.base) * c).to_affine();
        base_challenge(handle, &self.base, &commitment, &self.prefix_bytes()) == proof.challenge
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
        let proof = if to.is_empty() {
            None
        } else {
            let challenge = reader.array()?;
            let response = Option::from(Scalar::from_bytes_be(&reader.array()?))
                .ok_or(Error::InvalidMessage)?;
            Some(BaseProof {
                challenge,
                response,
            })
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
            },
            reader.position(),
        ))
    }
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
/// `"Seedelf-Messaging|v1|session|base-nonce" ‖ g ‖ v ‖ p₀ ‖ F′ ‖ aux`.
/// Everything the challenge covers but `T`, which follows from the nonce.
pub(crate) fn base_nonce_message(
    handle: &Register,
    base: &G1Affine,
    prefix: &[u8],
    aux: &[u8; 32],
) -> Vec<u8> {
    let mut out = BASE_NONCE_LABEL.to_vec();
    out.extend_from_slice(&handle.to_bytes());
    out.extend_from_slice(&base.to_compressed());
    out.extend_from_slice(prefix);
    out.extend_from_slice(aux);
    out
}

/// `c = SHA-256("Seedelf-Messaging|v1|session|base" ‖ g ‖ v ‖ p₀ ‖ T ‖ F′)`,
/// with `(g, v)` the handle, `T` the commitment and `F′` F before its proof.
pub(crate) fn base_challenge(
    handle: &Register,
    base: &G1Affine,
    commitment: &G1Affine,
    prefix: &[u8],
) -> [u8; 32] {
    Sha256::new()
        .chain_update(BASE_LABEL)
        .chain_update(handle.to_bytes())
        .chain_update(base.to_compressed())
        .chain_update(commitment.to_compressed())
        .chain_update(prefix)
        .finalize()
        .into()
}

/// The proof that `base = [b]g` for `handle = (g, v)`, F′ being `prefix`.
/// Its nonce `k` is HMAC-SHA-512 keyed by `b` over [`base_nonce_message`],
/// with 32 drawn bytes of `aux`, reduced mod q ([`hedged_scalar`]): so one
/// `k` never meets two challenges, which would give `b` away.
pub(crate) fn prove_base(
    handle: &Register,
    b: &Scalar,
    prefix: &[u8],
    draw: &mut dyn Draw,
) -> BaseProof {
    let base = (handle.generator() * b).to_affine();
    let k = hedged_scalar(b, draw, |aux| {
        base_nonce_message(handle, &base, prefix, aux)
    });
    prove_base_with_nonce(handle, b, &k, prefix)
}

/// The proof with the nonce `k` given: `T = [k]g`, `c` from
/// [`base_challenge`], `z = k + c·b`. Only [`prove_base`] chooses `k`; the
/// tests and vectors call this to check it.
pub(crate) fn prove_base_with_nonce(
    handle: &Register,
    b: &Scalar,
    k: &Scalar,
    prefix: &[u8],
) -> BaseProof {
    let base = (handle.generator() * b).to_affine();
    let commitment = (handle.generator() * k).to_affine();
    let challenge = base_challenge(handle, &base, &commitment, prefix);
    BaseProof {
        challenge,
        response: k + scalar_mod_q(&challenge) * b,
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
