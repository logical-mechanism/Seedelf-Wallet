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
    /// Authenticated decryption failed: the envelope was altered.
    DecryptionFailed,
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
        }
    }
}

impl std::error::Error for Error {}
