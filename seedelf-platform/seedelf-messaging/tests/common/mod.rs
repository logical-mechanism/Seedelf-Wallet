//! Helpers shared by the integration tests.

#![allow(dead_code)]

use blstrs::{G1Affine, G1Projective, Scalar};
use ff::Field;
use group::prime::PrimeCurveAffine;
use rand_core::OsRng;

/// A uniformly random nonzero scalar.
pub fn random_nonzero() -> Scalar {
    loop {
        let scalar = Scalar::random(&mut OsRng);
        if !bool::from(scalar.is_zero()) {
            return scalar;
        }
    }
}

/// The standard G1 generator.
pub fn g1() -> G1Projective {
    G1Projective::from(G1Affine::generator())
}

/// The three points of an envelope's header, compressed: `p`, `w`, `c`.
pub fn header_points(bytes: &[u8]) -> [[u8; 48]; 3] {
    [0, 1, 2].map(|i| bytes[1 + 48 * i..1 + 48 * (i + 1)].try_into().unwrap())
}

/// `bytes` with point `i` (0 = `p`, 1 = `w`, 2 = `c`) replaced.
pub fn with_point(bytes: &[u8], i: usize, point: &[u8; 48]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[1 + 48 * i..1 + 48 * (i + 1)].copy_from_slice(point);
    out
}

/// A compressed point from the header, decoded (it was checked on parse).
pub fn point(bytes: &[u8; 48]) -> G1Projective {
    G1Projective::from(G1Affine::from_compressed(bytes).unwrap())
}

/// The stamp work the session tests' readers ask: a few hundred attempts,
/// where readers ask 2²⁴.
pub const TEST_BITS: u32 = 8;

/// The asset name each test wallet's handle goes by.
pub const HANDLE: &[u8] = b"5eed0e1f handle";

/// A wallet's handles: its root register, under [`HANDLE`].
pub fn handles(key: &seedelf_messaging::SecretKey) -> Vec<seedelf_messaging::session::Handle> {
    vec![seedelf_messaging::session::Handle::new(HANDLE, key.register()).unwrap()]
}

/// `inbox`, asking [`TEST_BITS`] of first messages' stamps.
pub fn test_bits(
    mut inbox: seedelf_messaging::session::Inbox,
) -> seedelf_messaging::session::Inbox {
    inbox.set_first_contact_bits(TEST_BITS);
    inbox
}

/// Solves `cid`'s first-contact stamp at [`TEST_BITS`] and sets it.
pub fn stamp(
    inbox: &mut seedelf_messaging::session::Inbox,
    cid: seedelf_messaging::session::ConversationId,
) {
    let digest = inbox.stamp_digest(cid).unwrap();
    let nonce = seedelf_messaging::relay::find_stamp(&digest, TEST_BITS, 0, u64::MAX).unwrap();
    inbox.set_stamp(cid, nonce).unwrap();
}

/// Starts a conversation to a reader's root register under [`HANDLE`], with
/// its stamp set.
pub fn start(
    inbox: &mut seedelf_messaging::session::Inbox,
    writer: &seedelf_messaging::SecretKey,
    handle: &seedelf_messaging::Register,
    now: u64,
) -> seedelf_messaging::session::ConversationId {
    let cid = inbox.start(writer, handle, HANDLE, now).unwrap();
    stamp(inbox, cid);
    cid
}
