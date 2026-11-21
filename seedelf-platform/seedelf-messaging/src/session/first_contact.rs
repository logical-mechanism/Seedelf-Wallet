//! The first-contact block F and the session secret SK (docs/protocol.md §3).

use std::fmt;

use blstrs::G1Affine;
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::Error;
use crate::register::{POINT_LEN, decode_point};
use crate::session::secret::Secret32;

/// Bytes in a conversation ID.
pub const CID_LEN: usize = 16;

/// The longest `to`: a Seedelf's asset name.
pub const MAX_TO_LEN: usize = 32;

/// F's size with an empty `to` and no `replaces`.
pub const FIRST_CONTACT_MIN_LEN: usize = CID_LEN + 8 + 1 + 1 + 3 * POINT_LEN;

/// F's size with a full `to` and a `replaces`.
pub const FIRST_CONTACT_MAX_LEN: usize = FIRST_CONTACT_MIN_LEN + MAX_TO_LEN + CID_LEN;

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

/// The first-contact block F, which every message carries until the first
/// reply:
///
/// ```text
/// cid (16) | t (8) | to (1 + 0–32) | replaces (1 + 0 or 16) | p₀ (48) | A (48) | E_A (48)
/// ```
///
/// - `t`: when the conversation started, in Unix seconds, big-endian.
/// - `to`: a length byte, then the handle's asset name (empty allowed).
/// - `replaces`: a length byte, then the conversation ID this one continues
///   (docs/protocol.md §6), or nothing.
/// - `p₀`: the conversation's base, shared by both identities.
/// - `A`: the initiator's public value on it, `[x_A]p₀`.
/// - `E_A`: the session ephemeral, `[e_A]p₀`.
///
/// Every point is canonical, in G1 and not the identity: parsing checks it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct FirstContact {
    pub(crate) cid: ConversationId,
    pub(crate) started_at: u64,
    pub(crate) to: Vec<u8>,
    pub(crate) replaces: Option<ConversationId>,
    pub(crate) base: G1Affine,
    pub(crate) initiator: G1Affine,
    pub(crate) ephemeral: G1Affine,
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

    /// The handle's asset name the initiator wrote to, or empty.
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
        let mut out = Vec::with_capacity(self.len());
        out.extend_from_slice(&self.cid.0);
        out.extend_from_slice(&self.started_at.to_be_bytes());
        // Both lengths are checked on construction and on parse.
        out.push(self.to.len() as u8);
        out.extend_from_slice(&self.to);
        match self.replaces {
            Some(cid) => {
                out.push(CID_LEN as u8);
                out.extend_from_slice(&cid.0);
            }
            None => out.push(0),
        }
        out.extend_from_slice(&self.base.to_compressed());
        out.extend_from_slice(&self.initiator.to_compressed());
        out.extend_from_slice(&self.ephemeral.to_compressed());
        out
    }

    /// F's size in bytes: 170 to 218.
    #[allow(clippy::len_without_is_empty)]
    pub fn len(&self) -> usize {
        FIRST_CONTACT_MIN_LEN + self.to.len() + if self.replaces.is_some() { CID_LEN } else { 0 }
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
        let base = decode_point(&reader.array()?)?;
        let initiator = decode_point(&reader.array()?)?;
        let ephemeral = decode_point(&reader.array()?)?;
        Ok((
            Self {
                cid,
                started_at,
                to,
                replaces,
                base,
                initiator,
                ephemeral,
            },
            reader.position(),
        ))
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
