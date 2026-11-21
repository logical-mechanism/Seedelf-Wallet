//! A 32-byte secret wiped on drop: root keys, chain keys, message keys, SK,
//! and ratchet private keys' scalars.

use zeroize::Zeroize;

/// 32 secret bytes. `Clone` makes a second copy that is wiped on its own drop;
/// `Debug` prints nothing of it.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Secret32([u8; 32]);

impl Secret32 {
    pub(crate) fn zero() -> Self {
        Self([0u8; 32])
    }

    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub(crate) fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl AsMut<[u8]> for Secret32 {
    fn as_mut(&mut self) -> &mut [u8] {
        &mut self.0
    }
}

impl std::fmt::Debug for Secret32 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret32(..)")
    }
}

impl Drop for Secret32 {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
