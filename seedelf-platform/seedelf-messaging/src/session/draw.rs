//! Where a session's random values come from.
//!
//! Production draws from the operating system alone ([`OsDraw`]). The test
//! vectors fix every value, so each operation draws in a documented order
//! (docs/protocol.md §16.3):
//!
//! - starting from a handle: `b`, then `cid`, then `e_A`, then `s_A`, then
//!   the base proof's `k`;
//! - starting a continuation: `cid`, then `e_A`, then `s_A`;
//! - sending: the ratchet's salt, then the outer envelope's `r` (its
//!   re-randomization is the outer scalar, derived, not drawn);
//! - a ratchet step on receiving: the new ratchet key;
//! - a reveal: `c₂`, then `z₂`, then the nonce's 32 bytes of `aux` (§19.2).

use blstrs::Scalar;
use rand_core::{OsRng, RngCore};

use crate::keys::random_nonzero_scalar;

/// A source of the session layer's random values.
pub(crate) trait Draw {
    /// A uniformly random nonzero scalar.
    fn scalar(&mut self) -> Scalar;
    /// 16 uniformly random bytes.
    fn bytes16(&mut self) -> [u8; 16];
    /// 32 uniformly random bytes.
    fn bytes32(&mut self) -> [u8; 32];
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

    fn bytes32(&mut self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        bytes
    }
}
