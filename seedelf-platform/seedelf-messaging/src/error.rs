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
    /// Not this key's: an envelope whose tag isn't the tag of this key's
    /// `[y]p`, or a register that isn't one of this key's, a conversation's
    /// own identity or a Seedelf's to reveal.
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
    /// A session message of a held conversation that would make the reader
    /// store more than `MAX_SKIP` keys, but that authenticates and whose
    /// envelope's checks pass: the conversation can't take it
    /// (docs/protocol.md §6, §16.4). One past the bound that doesn't
    /// authenticate is [`Error::DecryptionFailed`], as any forgery is.
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
    /// A first message whose first-contact stamp shows less work than the
    /// reader asks.
    StampTooLow,
    /// A first-contact message, sent before its stamp was set.
    Unstamped,
    /// A first message whose `to` names none of the reader's handles.
    UnknownHandle,
    /// A first message whose proof that its base re-randomizes the named
    /// handle doesn't verify against any of that handle's registers.
    InvalidBaseProof,
    /// A first message without a handle that isn't a verified continuation
    /// of one of the reader's conversations.
    UnverifiedContinuation,
    /// A first message whose keys proof doesn't verify: that its writer
    /// knows the keys of `E_A`, of the header key `S_A` and, from a handle,
    /// of `A` or the reader's `w₀` (docs/protocol.md §3). Or a request whose
    /// messages don't all carry the first's header key.
    InvalidKeysProof,
    /// A first-contact message past a request's share (docs/protocol.md
    /// §3.1): at most 16 of them, and 64 KiB of their inner messages, before
    /// a reply. At the writer, a send past it, refused before the chain
    /// moves. At the reader, a later message of a request past it, or one
    /// that would take the requests past 256 KiB, refused before the request
    /// is replayed: a join never pushes another request out.
    RequestFull,
    /// A message whose envelope isn't addressed to its conversation identity
    /// re-randomized by the message's own outer scalar, whose ephemeral point
    /// isn't the one its message key gives, or that came without its
    /// envelope.
    WrongEnvelopeRegister,
    /// A reveal this side can't make or take: only the side that wrote first
    /// reveals, once a reply has decrypted, and only the side written to
    /// checks one (docs/protocol.md §19).
    RevealNotAllowed,
    /// A reveal whose proof doesn't verify for this conversation.
    InvalidReveal,
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
            Error::NotForThisKey => write!(f, "register is not one of this key's"),
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
            Error::StampTooLow => write!(f, "first-contact stamp shows too little work"),
            Error::Unstamped => write!(f, "first-contact message has no stamp yet"),
            Error::UnknownHandle => write!(f, "first message names none of this reader's handles"),
            Error::InvalidBaseProof => {
                write!(f, "proof that the base re-randomizes the handle fails")
            }
            Error::UnverifiedContinuation => {
                write!(
                    f,
                    "first message without a handle continues no conversation here"
                )
            }
            Error::InvalidKeysProof => {
                write!(
                    f,
                    "proof that the writer knows its first message's keys fails"
                )
            }
            Error::RequestFull => {
                write!(f, "request has no room for another first-contact message")
            }
            Error::WrongEnvelopeRegister => {
                write!(
                    f,
                    "envelope is not addressed to the conversation identity it must be"
                )
            }
            Error::RevealNotAllowed => write!(f, "this side can't make or take a reveal"),
            Error::InvalidReveal => {
                write!(f, "reveal's proof doesn't verify for this conversation")
            }
        }
    }
}

impl std::error::Error for Error {}
