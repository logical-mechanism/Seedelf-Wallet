use std::fmt;

/// Why an input or an operation was refused.
///
/// Every refusal of untrusted bytes is one of these, never a panic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not the canonical compressed encoding of a point on BLS12-381's G1 curve.
    InvalidEncoding,
    /// On the curve, but outside the prime-order subgroup G1.
    NotInSubgroup,
    /// The identity point, which no key owns.
    IdentityPoint,
    /// A scalar that is zero or not below the group order.
    InvalidScalar,
    /// An envelope version this library doesn't read.
    UnsupportedVersion(u8),
    /// An envelope shorter than its fixed parts, or longer than the largest
    /// plaintext allows.
    InvalidLength,
    /// A plaintext longer than [`MAX_PLAINTEXT_LEN`](crate::MAX_PLAINTEXT_LEN).
    PlaintextTooLarge,
    /// The envelope's register isn't one of this key's.
    NotForThisKey,
    /// Authenticated decryption failed: the envelope or message was altered,
    /// or wasn't made with this conversation's keys.
    DecryptionFailed,
    /// An opened envelope whose padding isn't `0x80` then zeros, or whose
    /// size isn't one of the session layer's envelope sizes.
    InvalidPadding,
    /// An inner message that doesn't parse: an unknown type, a bad length,
    /// or a field out of range.
    InvalidMessage,
    /// A message too long for the largest envelope.
    MessageTooLarge,
    /// A first message whose start time `t` is more than 48 hours old or more
    /// than an hour ahead of the reader's clock.
    OutsideWindow,
    /// A conversation or request the reader deleted, whose tombstone stands.
    Deleted,
    /// A first-contact message for a known conversation ID whose block isn't
    /// the stored one.
    DifferentFirstContact,
    /// A message that would make the reader derive more than `MAX_SKIP` keys.
    TooFarAhead,
    /// A message whose key was already used or deleted: a duplicate or replay
    /// in the current receiving chain or the stored skipped keys, or a
    /// skipped key past its lifetime. A replay from an earlier chain whose
    /// keys are gone can't be told from a forgery: it's
    /// [`Error::DecryptionFailed`], and changes nothing either.
    KeyUsedOrDeleted,
    /// A session message for a conversation ID the reader doesn't have.
    UnknownConversation,
    /// A message this conversation can't take: a first-contact message to
    /// the side that wrote it, or a session message for a request not yet
    /// replied to.
    UnexpectedMessage,
    /// Starting a conversation with a register of one's own key.
    OwnRegister,
    /// A chain counter would pass `u32::MAX`.
    ChainExhausted,
    /// Stored session state that doesn't parse or isn't consistent.
    InvalidState,
    /// A stored state's format version this library doesn't read.
    UnsupportedStateVersion(u8),
    /// Proof of work past [`MAX_STAMP_BITS`](crate::relay::MAX_STAMP_BITS).
    StampTooHard,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::InvalidEncoding => write!(f, "not a canonical compressed G1 point"),
            Error::NotInSubgroup => write!(f, "point is outside the prime-order subgroup"),
            Error::IdentityPoint => write!(f, "point is the identity"),
            Error::InvalidScalar => write!(f, "scalar is zero or not below the group order"),
            Error::UnsupportedVersion(v) => write!(f, "unsupported envelope version {v}"),
            Error::InvalidLength => write!(f, "envelope has an invalid length"),
            Error::PlaintextTooLarge => write!(f, "plaintext is too large"),
            Error::NotForThisKey => write!(f, "envelope is not addressed to this key"),
            Error::DecryptionFailed => write!(f, "authenticated decryption failed"),
            Error::InvalidPadding => write!(f, "message padding or size is invalid"),
            Error::InvalidMessage => write!(f, "inner message is malformed"),
            Error::MessageTooLarge => write!(f, "message is too large for the largest envelope"),
            Error::OutsideWindow => write!(f, "first message is outside the acceptance window"),
            Error::Deleted => write!(f, "conversation was deleted"),
            Error::DifferentFirstContact => {
                write!(f, "first-contact block differs from the stored one")
            }
            Error::TooFarAhead => write!(f, "message is too far ahead of the receiving chain"),
            Error::KeyUsedOrDeleted => write!(f, "message key was already used or deleted"),
            Error::UnknownConversation => write!(f, "unknown conversation"),
            Error::UnexpectedMessage => write!(f, "message is unexpected in this conversation"),
            Error::OwnRegister => write!(f, "register belongs to this key"),
            Error::ChainExhausted => write!(f, "chain counter is exhausted"),
            Error::InvalidState => write!(f, "stored session state is invalid"),
            Error::UnsupportedStateVersion(v) => write!(f, "unsupported session state version {v}"),
            Error::StampTooHard => write!(f, "proof of work asked is past the most this solves"),
        }
    }
}

impl std::error::Error for Error {}
