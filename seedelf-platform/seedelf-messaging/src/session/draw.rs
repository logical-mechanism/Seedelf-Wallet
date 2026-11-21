//! Where a session's random values come from.
//!
//! Production draws from the operating system alone ([`OsDraw`]). The test
//! vectors fix every value, so each operation draws in a documented order
//! (docs/protocol.md §16.3):
//!
//! - starting from a handle: `b`, then `cid`, then `e_A`, then `s_A`;
//! - starting a continuation: `cid`, then `e_A`, then `s_A`;
//! - sending: the ratchet's salt, then the outer envelope's `b`, then its `r`;
//! - a ratchet step on receiving: the new ratchet key.

use blstrs::Scalar;
use rand_core::{OsRng, RngCore};

use crate::keys::random_nonzero_scalar;

/// A source of the session layer's random values.
pub(crate) trait Draw {
    /// A uniformly random nonzero scalar.
    fn scalar(&mut self) -> Scalar;
    /// 16 uniformly random bytes.
    fn bytes16(&mut self) -> [u8; 16];
}

/// The operating system's generator.
pub(crate) struct OsDraw;

impl Draw for OsDraw {
    fn scalar(&mut self) -> Scalar {
        random_nonzero_scalar()
    }

    fn bytes16(&mut self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        OsRng.fill_bytes(&mut bytes);
        bytes
    }
}
