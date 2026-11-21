//! Seedelf Messaging, Phase 1: end-to-end encryption of a byte payload to a
//! re-randomized Seedelf register, and its discovery by the recipient.
//!
//! A recipient's register is `(g, v)` with `v = [y]g`. A sender re-randomizes
//! it to `(p, w) = ([b]g, [b]v)`, picks an ephemeral `c = [r]p`, and seals the
//! message under a key derived from the shared point `[r]w = [y]c` (ECIES-KEM
//! with HKDF-SHA256 and AES-256-GCM). The recipient finds their envelopes by
//! testing `[y]p == w`, then decrypts. Nothing here needs a pairing.
//!
//! docs/construction.md has the mathematics; docs/security.md what holds,
//! under which assumptions, and what doesn't. Unaudited: not for production
//! use.
//!
//! ```
//! use seedelf_messaging::{SecretKey, decrypt_message, encrypt_message, Envelope};
//!
//! let alice = SecretKey::generate();
//! let envelope = encrypt_message(&alice.register(), b"hello")?;
//! let bytes = envelope.to_bytes();
//!
//! let received = Envelope::from_bytes(&bytes)?;
//! assert!(received.is_for(&alice));
//! assert_eq!(decrypt_message(&alice, &received)?, b"hello");
//! # Ok::<(), seedelf_messaging::Error>(())
//! ```

#![forbid(unsafe_code)]
#![warn(missing_docs)]

mod envelope;
mod error;
mod keys;
mod register;
#[cfg(test)]
mod tests;

pub use envelope::{
    ENVELOPE_OVERHEAD, Envelope, HEADER_LEN, MAX_PLAINTEXT_LEN, VERSION, decrypt_message,
    encrypt_message,
};
pub use error::Error;
pub use keys::SecretKey;
pub use register::{POINT_LEN, Register, matches_register, rerandomize_register};
