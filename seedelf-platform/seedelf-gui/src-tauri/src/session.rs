use blstrs::Scalar;
use once_cell::sync::OnceCell;
use std::sync::RwLock;
use zeroize::Zeroize; // trait we’ll implement for the wrapper

/* ----------  SecretScalar: zeroes itself when dropped  ---------- */

pub struct SecretScalar(pub Scalar);

impl Zeroize for SecretScalar {
    fn zeroize(&mut self) {
        unsafe {
            // overwrite the entire struct with zeros (32 bytes)
            core::ptr::write_bytes(
                self as *mut _ as *mut u8,
                0,
                core::mem::size_of::<SecretScalar>(),
            );
        }
    }
}

impl Drop for SecretScalar {
    fn drop(&mut self) {
        self.zeroize(); // guaranteed wipe on drop
    }
}

/* ----------  Global RAM slot  ---------- */

static KEY: OnceCell<RwLock<Option<SecretScalar>>> = OnceCell::new();

fn slot() -> &'static RwLock<Option<SecretScalar>> {
    KEY.get_or_init(|| RwLock::new(None))
}

/* ----------  API  ---------- */

/// Put the decrypted key in RAM (replaces any existing one).
pub fn unlock(new_key: Scalar) {
    *slot().write().expect("poisoned lock") = Some(SecretScalar(new_key));
}

/// Remove and wipe the key.
pub fn lock() {
    // `take()` drops the SecretScalar; its Drop impl zeroises the bytes.
    let _ = slot().write().expect("poisoned lock").take();
}

/// Borrow the key immutably for one operation.
pub fn with_key<F, R>(f: F) -> Result<R, &'static str>
where
    F: FnOnce(&Scalar) -> R,
{
    slot()
        .read()
        .expect("poisoned lock")
        .as_ref()
        .map(|s| f(&s.0)) // pass inner scalar to the closure
        .ok_or("Wallet is locked")
}

/// Check if a key is currently loaded.
pub fn is_unlocked() -> bool {
    slot().read().expect("poisoned lock").is_some()
}
