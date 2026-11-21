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
