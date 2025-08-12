use blstrs::Scalar;
use core::fmt;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use zeroize::Zeroize;

#[repr(transparent)]
pub struct SecretScalar(Scalar);

impl fmt::Debug for SecretScalar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretScalar(**redacted**)")
    }
}

impl Drop for SecretScalar {
    fn drop(&mut self) {
        unsafe {
            let p = self as *mut _ as *mut u8;
            let n = core::mem::size_of::<SecretScalar>();
            core::slice::from_raw_parts_mut(p, n).zeroize();
        }
    }
}

struct LockedBox {
    inner: Box<SecretScalar>,
}

impl LockedBox {
    fn new(secret: SecretScalar) -> Self {
        let mut inner = Box::new(secret);
        let p = (&mut *inner) as *mut SecretScalar as *mut u8;
        let n = core::mem::size_of::<SecretScalar>();

        #[cfg(target_family = "unix")]
        unsafe {
            let _ = libc::mlock(p as *const _, n);
            #[cfg(target_os = "linux")]
            {
                let _ = libc::madvise(p as *mut _, n, libc::MADV_DONTDUMP);
            }
        }

        Self { inner }
    }
}

impl Drop for LockedBox {
    fn drop(&mut self) {
        unsafe {
            let p = (&mut *self.inner) as *mut SecretScalar as *mut u8;
            let n = core::mem::size_of::<SecretScalar>();
            core::slice::from_raw_parts_mut(p, n).zeroize();
            #[cfg(target_family = "unix")]
            {
                let _ = libc::munlock(p as *const _, n);
            }
        }
    }
}

// --- global slot (now Send/Sync-ok) ---
static KEY: OnceCell<RwLock<Option<LockedBox>>> = OnceCell::new();
fn slot() -> &'static RwLock<Option<LockedBox>> {
    KEY.get_or_init(|| RwLock::new(None))
}

// --- API ---
pub fn unlock(new_key: Scalar) {
    *slot().write() = Some(LockedBox::new(SecretScalar(new_key)));
}

pub fn lock() {
    let _ = slot().write().take();
}

pub fn with_key<F, R>(f: F) -> Result<R, &'static str>
where
    F: FnOnce(&Scalar) -> R,
{
    let guard = slot().read();
    guard
        .as_ref()
        .map(|b| f(&b.inner.0))
        .ok_or("Wallet is locked")
}

pub fn is_unlocked() -> bool {
    slot().read().is_some()
}
