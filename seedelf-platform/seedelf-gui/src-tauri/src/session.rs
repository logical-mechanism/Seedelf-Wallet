use blstrs::Scalar;
use core::{fmt, ops::Deref};
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
            core::slice::from_raw_parts_mut(p, n).zeroize(); // volatile wipe
        }
    }
}

struct LockedBox {
    inner: Box<SecretScalar>,
}

impl LockedBox {
    fn new(secret: SecretScalar) -> Self {
        let mut inner = Box::new(secret);
        unsafe {
            let p = (&mut *inner) as *mut SecretScalar as *mut u8;
            let n = core::mem::size_of::<SecretScalar>();
            os_mem::page_lock(p, n);
        }
        Self { inner }
    }
}

impl Drop for LockedBox {
    fn drop(&mut self) {
        unsafe {
            let p = (&mut *self.inner) as *mut SecretScalar as *mut u8;
            let n = core::mem::size_of::<SecretScalar>();
            // scrub while still locked, then unlock
            core::slice::from_raw_parts_mut(p, n).zeroize();
            os_mem::page_unlock(p, n);
        }
    }
}

// --- global slot ---
static KEY: OnceCell<RwLock<Option<LockedBox>>> = OnceCell::new();
fn slot() -> &'static RwLock<Option<LockedBox>> {
    KEY.get_or_init(|| RwLock::new(None))
}

// --- public API ---
pub fn unlock(new_key: Scalar) {
    *slot().write() = Some(LockedBox::new(SecretScalar(new_key)));
}

pub fn lock() {
    let _ = slot().write().take();
}

pub fn is_unlocked() -> bool {
    slot().read().is_some()
}

/// Synchronous borrow: the closure must finish before returning.
pub fn with_key_sync<F, R>(f: F) -> Result<R, &'static str>
where
    F: FnOnce(&Scalar) -> R,
{
    let guard = slot().read();
    guard
        .as_ref()
        .map(|b| f(&b.inner.0))
        .ok_or("Wallet is locked")
}

/// Async-friendly: hands you an owned, zeroizing wrapper you can move across .await.
/// The inner scalar is wiped when the future completes and the wrapper is dropped.
pub async fn with_key<F, Fut, R>(f: F) -> Result<R, &'static str>
where
    F: FnOnce(EphemeralScalar) -> Fut,
    Fut: core::future::Future<Output = R>,
{
    // copy under the read lock, then drop the lock
    let s = {
        let g = slot().read();
        let lb = g.as_ref().ok_or("Wallet is locked")?;
        lb.inner.0 // by-value copy
    };
    let eph = EphemeralScalar(s);
    let out = f(eph).await; // drops `eph` afterwards -> zeroized
    Ok(out)
}

/// Owned, zeroizing scalar for async flows. Move it; don't clone it.
#[repr(transparent)]
pub struct EphemeralScalar(Scalar);

impl Deref for EphemeralScalar {
    type Target = Scalar;
    fn deref(&self) -> &Scalar {
        &self.0
    }
}

impl Drop for EphemeralScalar {
    fn drop(&mut self) {
        unsafe {
            let p = &mut self.0 as *mut _ as *mut u8;
            let n = core::mem::size_of::<Scalar>();
            core::slice::from_raw_parts_mut(p, n).zeroize();
        }
    }
}

impl fmt::Debug for EphemeralScalar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("EphemeralScalar(**redacted**)")
    }
}

/// Call once at process startup for extra hygiene (Unix).
pub fn harden_process_best_effort() {
    os_mem::disable_core_dumps();
}

// ---------- platform glue ----------
mod os_mem {
    #[allow(unused_variables)]
    pub unsafe fn page_lock(p: *mut u8, n: usize) {
        #[cfg(target_family = "unix")]
        unsafe {
            let _ = libc::mlock(p as *const _, n);
            #[cfg(target_os = "linux")]
            {
                let _ = libc::madvise(p as *mut _, n, libc::MADV_DONTDUMP);
            }
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Memory::VirtualLock;
            let _ = VirtualLock(p as *mut _, n);
            // Optional: exclude from Windows Error Reporting heap dumps:
            use windows_sys::Win32::System::ErrorReporting::WerAddExcludedMemoryBlock;
            let _ = WerAddExcludedMemoryBlock(p as _, n as u32);
        }
    }

    #[allow(unused_variables)]
    pub unsafe fn page_unlock(p: *mut u8, n: usize) {
        #[cfg(target_family = "unix")]
        unsafe {
            let _ = libc::munlock(p as *const _, n);
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Memory::VirtualUnlock;
            let _ = VirtualUnlock(p as *mut _, n);
        }
    }

    pub fn disable_core_dumps() {
        #[cfg(target_family = "unix")]
        unsafe {
            // hard-disable core files; macOS + Linux
            let r = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            let _ = libc::setrlimit(libc::RLIMIT_CORE, &r);

            #[cfg(target_os = "linux")]
            {
                // make process undumpable (also blocks ptrace by non-root)
                let _ = libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0);
            }
        }
    }
}
