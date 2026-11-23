//! Where a session's random values come from.
//!
//! Production draws from the operating system alone ([`OsDraw`]). The test
//! vectors fix every value, so each operation draws in a documented order
//! (docs/protocol.md §16.3):
//!
//! - starting from a handle: `cid`, then `b`'s 32 bytes of `aux`, then
//!   `e_A`, then `s_A`, then the base proof's `c₂`, `z₂` and 32 bytes of
//!   `aux`, then the keys proof's `c₂`, `z₂` and 32 bytes of `aux`;
//! - starting a continuation: `cid`, then `e_A`, then `s_A`, then the keys
//!   proof's 32 bytes of `aux`;
//! - sending: the ratchet's salt alone (the envelope's re-randomization and
//!   its ephemeral scalar both come from the message key and the salt);
//! - a ratchet step on receiving: the new ratchet key;
//! - a reveal: `c₂`, then `z₂`, then the nonce's 32 bytes of `aux` (§19.2).
//!
//! The scalars a key's safety rests on aren't drawn but hedged: the writer's
//! `b`, keyed by its key ([`hedged_scalar`]); the base proof's `k`, keyed by
//! `b`, and the keys proof's three nonces, keyed by `e_A`, `s_A` and the
//! writer's key, each drawn with its proof's other values
//! ([`hedged_or_draws`], [`hedged_aux_draws`]); and a reveal's nonce, keyed by
//! its prover's key (§16.2, §19.2). Each is an HMAC over 32 drawn bytes and
//! everything its challenge covers, so a source that fails or repeats never
//! gives one away or puts one nonce under two challenges
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

/// [`hedge_okm`] of `key` over `message`, reduced mod q: a hedged nonce
/// from its message. Zero only with probability about 2⁻²⁵⁵, which its
/// caller handles by drawing everything again.
pub(crate) fn hedge(key: &Scalar, message: &[u8]) -> Scalar {
    scalar_mod_q(&hedge_okm(key, message)[..])
}

/// The draws of an OR-proof's hedged nonces (Cramer, Damgård and
/// Schoenmakers): the simulated branch's challenge share `c₂`, then its
/// response `z₂`, then 32 bytes of `aux`. `derive` derives every nonce of
/// the proof from all three at once, and gives `None` if any is zero: then
/// all three are drawn again and every nonce derived again. Returns `c₂`,
/// `z₂` and what `derive` gave.
///
/// The one helper for a proof with more than one nonce, or with a simulated
/// branch: [`hedged_scalar`] once for each nonce would draw an `aux` for
/// each, and a source that repeated every draw but one would then put one
/// nonce under two challenges (docs/joint-security.md, rule 2 and §9).
pub(crate) fn hedged_or_draws<T>(
    draw: &mut dyn Draw,
    mut derive: impl FnMut(&Scalar, &Scalar, &[u8; 32]) -> Option<T>,
) -> (Scalar, Scalar, T) {
    loop {
        let c2 = draw.scalar();
        let z2 = draw.scalar();
        let aux = draw.bytes32();
        if let Some(nonces) = derive(&c2, &z2, &aux) {
            return (c2, z2, nonces);
        }
    }
}

/// The draw of a proof's hedged nonces when it has no simulated branch: 32
/// bytes of `aux`, from which `derive` derives every nonce at once, giving
/// `None` if any is zero, which draws `aux` again for all of them.
pub(crate) fn hedged_aux_draws<T>(
    draw: &mut dyn Draw,
    mut derive: impl FnMut(&[u8; 32]) -> Option<T>,
) -> T {
    loop {
        let aux = draw.bytes32();
        if let Some(nonces) = derive(&aux) {
            return nonces;
        }
    }
}
