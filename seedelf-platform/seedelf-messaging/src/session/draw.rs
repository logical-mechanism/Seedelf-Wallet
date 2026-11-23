//! Where a session's random values come from.
//!
//! Production draws from the operating system alone ([`OsDraw`]). The test
//! vectors fix every value, so each operation draws in a documented order
//! (docs/protocol.md §16.3):
//!
//! - starting from a handle: `cid`, then `b`'s 32 bytes of `aux`, then
//!   `e_A`, then `s_A`, then the base proof's 32 bytes of `aux`;
//! - starting a continuation: `cid`, then `e_A`, then `s_A`;
//! - sending: the ratchet's salt, then the outer envelope's `r` (its
//!   re-randomization is the outer scalar, derived, not drawn);
//! - a ratchet step on receiving: the new ratchet key;
//! - a reveal: `c₂`, then `z₂`, then the nonce's 32 bytes of `aux` (§19.2).
//!
//! Three scalars aren't drawn but hedged ([`hedged_scalar`]): the writer's
//! `b`, keyed by its key, the base proof's `k`, keyed by `b`, and a reveal's
//! nonce, keyed by its prover's key (§16.2, §19.2). Each is an HMAC over 32
//! drawn bytes and everything it must cover, so a source that fails or
//! repeats never gives one away or puts one nonce under two challenges
//! (docs/joint-security.md, rule 2).

use blstrs::Scalar;
use ff::Field;
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use sha2::Sha512;
use zeroize::Zeroizing;

use crate::keys::{random_nonzero_scalar, scalar_mod_q};

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

/// HMAC-SHA-512 keyed by `key`'s 32 big-endian bytes over `message`: the 64
/// bytes a hedged scalar is reduced from. The key's copy and the output are
/// wiped.
pub(crate) fn hedge_okm(key: &Scalar, message: &[u8]) -> Zeroizing<[u8; 64]> {
    let key = Zeroizing::new(key.to_bytes_be());
    let mut mac =
        <Hmac<Sha512> as Mac>::new_from_slice(&key[..]).expect("HMAC takes a key of any length");
    mac.update(message);
    let mut okm = Zeroizing::new([0u8; 64]);
    okm.copy_from_slice(&mac.finalize().into_bytes());
    okm
}

/// A scalar hedged against the random source: draws 32 bytes `aux`, then
/// [`hedge_okm`] of `key` over `message(aux)`, reduced mod q. A zero
/// (probability about 2⁻²⁵⁵) draws `aux` again.
///
/// It's as secret as `key` whatever the source gives, and the same only for
/// the same key, message and `aux`.
pub(crate) fn hedged_scalar(
    key: &Scalar,
    draw: &mut dyn Draw,
    message: impl Fn(&[u8; 32]) -> Vec<u8>,
) -> Scalar {
    loop {
        let aux = draw.bytes32();
        let scalar = scalar_mod_q(&hedge_okm(key, &message(&aux))[..]);
        if !bool::from(scalar.is_zero()) {
            return scalar;
        }
    }
}
