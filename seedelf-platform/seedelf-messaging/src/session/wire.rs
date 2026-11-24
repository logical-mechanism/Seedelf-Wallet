//! Inner messages, their padding, and the outer envelope around them
//! (docs/protocol.md §3, §4.1 and §9).
//!
//! ```text
//! 0x01 | F | stamp (8) | ratchet header (56) | ratchet ciphertext   a first-contact message
//! 0x02 | cid (16) | ratchet header (56) | ratchet ciphertext        a session message
//! ```
//!
//! The inner message is padded with `0x80` then zeros to fill one of
//! [`ENVELOPE_SIZES`], and sealed in a v1 envelope to the other side's
//! identity re-randomized by the message's outer scalar (docs/protocol.md
//! §16.2).
//!
//! A first-contact message's header has PN 0 and N below 16
//! ([`MAX_REQUEST_MESSAGES`]): the initiator's first chain, within a
//! request's share (§3.1). Any other doesn't parse.

use blstrs::G1Affine;

use crate::envelope::{ENVELOPE_OVERHEAD, Envelope, decrypt_message};
use crate::session::first_contact::{CID_LEN, ConversationId, FirstContact, Reader, STAMP_LEN};
use crate::session::inbox::MAX_REQUEST_MESSAGES;
use crate::session::ratchet::{Header, RATCHET_HEADER_LEN, RATCHET_OVERHEAD};
use crate::{Error, SecretKey};

/// The four envelope sizes, in bytes: every session envelope is one of them.
pub const ENVELOPE_SIZES: [usize; 4] = [512, 2048, 8192, 32768];

/// The largest session envelope: 32 KiB.
pub const MAX_ENVELOPE_LEN: usize = ENVELOPE_SIZES[3];

/// A first-contact message's type byte.
pub const FIRST_CONTACT_TYPE: u8 = 0x01;

/// A session message's type byte.
pub const SESSION_TYPE: u8 = 0x02;

/// A session message's size beyond its text: the type, the cid, the ratchet
/// header, and the ratchet ciphertext's salt and tag. 105 bytes.
pub const SESSION_OVERHEAD: usize = 1 + CID_LEN + RATCHET_HEADER_LEN + RATCHET_OVERHEAD;

/// The padding's marker byte.
const PAD_MARKER: u8 = 0x80;

/// The smallest envelope size that holds `inner_len` bytes and the padding's
/// marker.
pub(crate) fn envelope_size(inner_len: usize) -> Result<usize, Error> {
    ENVELOPE_SIZES
        .into_iter()
        .find(|size| inner_len < size - ENVELOPE_OVERHEAD)
        .ok_or(Error::MessageTooLarge)
}

/// The most inner bytes an envelope holds: 366 for the smallest.
pub fn inner_capacity(envelope_size: usize) -> usize {
    envelope_size - ENVELOPE_OVERHEAD - 1
}

/// `inner ‖ 0x80 ‖ zeros`, to fill an envelope of `size` bytes.
pub(crate) fn pad(inner: &[u8], size: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(size - ENVELOPE_OVERHEAD);
    out.extend_from_slice(inner);
    out.push(PAD_MARKER);
    out.resize(size - ENVELOPE_OVERHEAD, 0);
    out
}

/// The inner message from an opened envelope's plaintext: its length must
/// fill one of [`ENVELOPE_SIZES`], and the padding must be `0x80` then zeros.
pub(crate) fn unpad(padded: &[u8]) -> Result<&[u8], Error> {
    if !ENVELOPE_SIZES.contains(&(padded.len() + ENVELOPE_OVERHEAD)) {
        return Err(Error::InvalidPadding);
    }
    let end = padded
        .iter()
        .rposition(|&byte| byte != 0)
        .ok_or(Error::InvalidPadding)?;
    if padded[end] != PAD_MARKER {
        return Err(Error::InvalidPadding);
    }
    Ok(&padded[..end])
}

/// Where an inner message's envelope stands: what a conversation checks
/// against the scalars the message key derives, the outer scalar and the
/// envelope's ephemeral scalar (docs/protocol.md §16.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Outer {
    /// Opened from an envelope with this generator `p` and ephemeral point
    /// `c`.
    Envelope {
        generator: G1Affine,
        ephemeral: G1Affine,
    },
    /// Stored after its check passed: a request's message.
    Checked,
    /// Parsed from bytes alone, so it can't be checked: refused.
    Unknown,
}

/// An opened envelope's inner message, parsed and every point checked, but
/// not yet decrypted by any conversation.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Opened {
    pub(crate) cid: ConversationId,
    /// F and its bytes, for a first-contact message.
    pub(crate) first: Option<(FirstContact, Vec<u8>)>,
    /// The first-contact stamp, for a first-contact message.
    pub(crate) stamp: Option<u64>,
    pub(crate) header: Header,
    pub(crate) ciphertext: Vec<u8>,
    /// The inner message's bytes, unpadded, as a request stores them.
    pub(crate) bytes: Vec<u8>,
    pub(crate) outer: Outer,
}

impl Opened {
    /// The conversation ID.
    pub fn cid(&self) -> ConversationId {
        self.cid
    }

    /// F, for a first-contact message.
    pub fn first_contact(&self) -> Option<&FirstContact> {
        self.first.as_ref().map(|(first, _)| first)
    }

    /// The first-contact stamp's nonce, for a first-contact message.
    pub fn stamp(&self) -> Option<u64> {
        self.stamp
    }

    /// The ratchet header.
    pub fn header(&self) -> &Header {
        &self.header
    }

    /// The inner message's bytes, without padding.
    pub fn to_bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// An inner message from its unpadded bytes. Without its envelope, no
    /// conversation takes it ([`Error::WrongEnvelopeRegister`]): the
    /// envelope's register is what a message's outer scalar is checked
    /// against.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        Self::parse(bytes, Outer::Unknown)
    }

    /// The same message, marked as having passed its envelope's check, as a
    /// request stores it.
    pub(crate) fn checked(&self) -> Self {
        Self {
            outer: Outer::Checked,
            ..self.clone()
        }
    }

    pub(crate) fn parse(bytes: &[u8], outer: Outer) -> Result<Self, Error> {
        let mut reader = Reader::new(bytes);
        let (cid, first, stamp) = match reader.byte()? {
            FIRST_CONTACT_TYPE => {
                let rest = reader.rest();
                let (first, used) = FirstContact::parse_prefix(rest)?;
                let first_bytes = rest[..used].to_vec();
                reader = Reader::new(&rest[used..]);
                let stamp = u64::from_be_bytes(reader.array::<STAMP_LEN>()?);
                (first.cid, Some((first, first_bytes)), Some(stamp))
            }
            SESSION_TYPE => (ConversationId(reader.array()?), None, None),
            _ => return Err(Error::InvalidMessage),
        };
        let header = Header::read(&mut reader)?;
        // Only the initiator's first chain sends first-contact messages, and
        // only within a request's share: one past it is no writer's.
        if first.is_some() && (header.pn != 0 || header.n >= MAX_REQUEST_MESSAGES as u32) {
            return Err(Error::InvalidMessage);
        }
        let ciphertext = reader.rest().to_vec();
        if ciphertext.len() < RATCHET_OVERHEAD {
            return Err(Error::InvalidMessage);
        }
        debug_assert!(reader.is_done());
        Ok(Self {
            cid,
            first,
            stamp,
            header,
            ciphertext,
            bytes: bytes.to_vec(),
            outer,
        })
    }
}

/// Opens an envelope addressed to `key` and parses its inner message.
///
/// Every point is checked before `key` touches it (the envelope's, F's and
/// the ratchet header's), and the padding and size must be exact. A
/// first-contact message's header must have PN 0 and N below 16, the
/// initiator's first chain within a request's share. Nothing about any
/// conversation is decided here.
pub fn open(key: &SecretKey, envelope: &[u8]) -> Result<Opened, Error> {
    let envelope = Envelope::from_bytes(envelope)?;
    let padded = decrypt_message(key, &envelope)?;
    Opened::parse(
        unpad(&padded)?,
        Outer::Envelope {
            generator: envelope.generator_point(),
            ephemeral: envelope.ephemeral_point(),
        },
    )
}
