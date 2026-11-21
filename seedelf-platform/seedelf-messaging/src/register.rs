use blstrs::{G1Affine, G1Projective, Scalar};
use group::Curve;
use group::prime::PrimeCurveAffine;

use crate::Error;
use crate::keys::{SecretKey, random_nonzero_scalar};

/// Bytes in a compressed G1 point.
pub const POINT_LEN: usize = 48;

/// A Seedelf-style register `(g, v)` with `v = [y]g` for the owner's secret `y`.
///
/// Both points are in G1's prime-order subgroup and neither is the identity:
/// every constructor checks this, so holding a `Register` means it holds.
/// It is the same pair a Seedelf datum carries, in the same compressed form.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Register {
    generator: G1Affine,
    public_value: G1Affine,
}

impl Register {
    /// A register from its two compressed points, `generator` then
    /// `public_value`, as a Seedelf datum holds them.
    pub fn from_bytes(
        generator: &[u8; POINT_LEN],
        public_value: &[u8; POINT_LEN],
    ) -> Result<Self, Error> {
        Ok(Self {
            generator: decode_point(generator)?,
            public_value: decode_point(public_value)?,
        })
    }

    /// The generator `g`, compressed.
    pub fn generator_bytes(&self) -> [u8; POINT_LEN] {
        self.generator.to_compressed()
    }

    /// The public value `v`, compressed.
    pub fn public_value_bytes(&self) -> [u8; POINT_LEN] {
        self.public_value.to_compressed()
    }

    /// `generator || public_value`, compressed.
    pub fn to_bytes(&self) -> [u8; 2 * POINT_LEN] {
        let mut out = [0u8; 2 * POINT_LEN];
        out[..POINT_LEN].copy_from_slice(&self.generator_bytes());
        out[POINT_LEN..].copy_from_slice(&self.public_value_bytes());
        out
    }

    /// `(G, [y]G)` for the standard G1 generator `G`.
    pub(crate) fn root(key: &SecretKey) -> Self {
        let generator = G1Affine::generator();
        let public_value = (G1Projective::from(generator) * key.scalar()).to_affine();
        Self {
            generator,
            public_value,
        }
    }

    /// A register from points already decoded and checked by [`decode_point`].
    pub(crate) fn from_checked(generator: G1Affine, public_value: G1Affine) -> Self {
        Self {
            generator,
            public_value,
        }
    }

    pub(crate) fn generator(&self) -> G1Projective {
        G1Projective::from(self.generator)
    }

    pub(crate) fn public_value(&self) -> G1Projective {
        G1Projective::from(self.public_value)
    }
}

/// Re-randomizes `register` with a fresh nonzero scalar `b`:
/// `(g, v)` becomes `([b]g, [b]v)`.
///
/// The same `b` goes on both points, so the owner's relation `v = [y]g`
/// carries over to `[b]v = [y][b]g`. Needs no secret.
pub fn rerandomize_register(register: &Register) -> Register {
    rerandomize_with(register, &random_nonzero_scalar())
}

/// [`rerandomize_register`] with a given `b`, which must be nonzero.
///
/// A nonzero `b` times a point of prime order other than the identity is
/// never the identity, so the result is still a valid register.
pub(crate) fn rerandomize_with(register: &Register, b: &Scalar) -> Register {
    Register {
        generator: (register.generator() * b).to_affine(),
        public_value: (register.public_value() * b).to_affine(),
    }
}

/// Whether `register` is one of `key`'s: `[y]g == v`.
///
/// One G1 scalar multiplication and a comparison; no pairing.
pub fn matches_register(key: &SecretKey, register: &Register) -> bool {
    register.generator() * key.scalar() == register.public_value()
}

/// A G1 point from untrusted bytes: the canonical compressed encoding of a
/// point in the prime-order subgroup, other than the identity.
pub(crate) fn decode_point(bytes: &[u8; POINT_LEN]) -> Result<G1Affine, Error> {
    // blst checks the flag bits, that x is below the field modulus and that
    // the point is on the curve, but not the subgroup.
    let point: G1Affine =
        Option::from(G1Affine::from_compressed_unchecked(bytes)).ok_or(Error::InvalidEncoding)?;
    // One encoding per point: whatever blst would also accept for it (stray
    // bits beside the infinity flag, say) is refused.
    if point.to_compressed() != *bytes || !bool::from(point.is_on_curve()) {
        return Err(Error::InvalidEncoding);
    }
    if bool::from(point.is_identity()) {
        return Err(Error::IdentityPoint);
    }
    // A point with a small-order component would let a sender learn the
    // recipient's key modulo the cofactor's small factors.
    if !bool::from(point.is_torsion_free()) {
        return Err(Error::NotInSubgroup);
    }
    Ok(point)
}
