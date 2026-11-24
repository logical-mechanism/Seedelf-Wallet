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

/// Where an envelope's header holds `p`, the tag of `w` and `c`:
/// `version (1) | p (48) | tag (32) | c (48)`.
pub const P_AT: usize = 1;
pub const TAG_AT: usize = 49;
pub const C_AT: usize = 81;

/// The two points of an envelope's header, compressed: `p`, `c`.
pub fn header_points(bytes: &[u8]) -> [[u8; 48]; 2] {
    [P_AT, C_AT].map(|at| bytes[at..at + 48].try_into().unwrap())
}

/// `bytes` with point `i` (0 = `p`, 1 = `c`) replaced.
pub fn with_point(bytes: &[u8], i: usize, point: &[u8; 48]) -> Vec<u8> {
    let at = [P_AT, C_AT][i];
    let mut out = bytes.to_vec();
    out[at..at + 48].copy_from_slice(point);
    out
}

/// An envelope's tag of `w`.
pub fn tag(bytes: &[u8]) -> [u8; 32] {
    bytes[TAG_AT..C_AT].try_into().unwrap()
}

/// `bytes` with its tag replaced.
pub fn with_tag(bytes: &[u8], tag: &[u8; 32]) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[TAG_AT..C_AT].copy_from_slice(tag);
    out
}

/// The tag an envelope carries for `w`: SHA-256 of its label and `w`
/// compressed (docs/construction.md §4.1).
pub fn tag_of(w: &G1Projective) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::new()
        .chain_update(b"Seedelf-Messaging|v1|envelope|tag")
        .chain_update(w.to_compressed())
        .finalize()
        .into()
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
