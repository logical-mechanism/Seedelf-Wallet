use std::fmt;

use blstrs::Scalar;
use ff::Field;
use rand_core::OsRng;
use zeroize::Zeroize;

use crate::Error;
use crate::register::Register;

/// A recipient's messaging secret `y`: a nonzero scalar.
///
/// Its register is `(g, [y]g)`. Phase 1 makes it with [`SecretKey::generate`];
/// [`SecretKey::from_scalar`] takes a Seedelf wallet's own scalar, so a
/// Seedelf's registers can be recipients too (docs/security.md, "One key for
/// spending and reading").
///
/// It has no `Clone`, no `PartialEq` and no byte export, its `Debug` prints
/// nothing of it, and its bytes are wiped when it drops.
pub struct SecretKey {
    // Canonical big-endian bytes, not a `Scalar`: blstrs's `Scalar` has no
    // `Zeroize`, and the bytes can be wiped. Converted at each use.
    bytes: [u8; 32],
}

impl SecretKey {
    /// A fresh random key from the operating system's generator.
    pub fn generate() -> Self {
        Self::from_nonzero(random_nonzero_scalar())
    }

    /// A key from its canonical 32-byte big-endian encoding.
    ///
    /// Refuses zero and any value not below the group order.
    pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self, Error> {
        scalar_from_bytes(bytes).map(Self::from_nonzero)
    }

    /// A key from a scalar, such as a Seedelf wallet's. Refuses zero.
    pub fn from_scalar(scalar: Scalar) -> Result<Self, Error> {
        if bool::from(scalar.is_zero()) {
            return Err(Error::InvalidScalar);
        }
        Ok(Self::from_nonzero(scalar))
    }

    /// The key's root register `(G, [y]G)`, on the standard G1 generator `G`.
    pub fn register(&self) -> Register {
        Register::root(self)
    }

    fn from_nonzero(scalar: Scalar) -> Self {
        Self {
            bytes: scalar.to_bytes_be(),
        }
    }

    pub(crate) fn scalar(&self) -> Scalar {
        // Only canonical nonzero bytes are ever stored, so this can't fail.
        Option::from(Scalar::from_bytes_be(&self.bytes)).expect("a stored key is canonical")
    }
}

impl fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretKey(..)")
    }
}

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

/// A uniformly random nonzero scalar from the operating system's generator.
pub(crate) fn random_nonzero_scalar() -> Scalar {
    loop {
        let scalar = Scalar::random(&mut OsRng);
        if !bool::from(scalar.is_zero()) {
            return scalar;
        }
    }
}

/// A canonical, nonzero scalar from 32 big-endian bytes.
pub(crate) fn scalar_from_bytes(bytes: &[u8; 32]) -> Result<Scalar, Error> {
    let scalar: Scalar = Option::from(Scalar::from_bytes_be(bytes)).ok_or(Error::InvalidScalar)?;
    if bool::from(scalar.is_zero()) {
        return Err(Error::InvalidScalar);
    }
    Ok(scalar)
}
