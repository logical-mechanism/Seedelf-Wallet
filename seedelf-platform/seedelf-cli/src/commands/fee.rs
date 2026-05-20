use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;

/// Throwaway ed25519 key used to sign a draft transaction so its serialized
/// size includes a realistic witness blob for tx-size fee estimation. The
/// signature itself is discarded.
pub(crate) fn fake_signer() -> PrivateKey {
    PrivateKey::from(SecretKey::new(OsRng))
}

pub(crate) fn linear_fee(tx_size: u64) -> u64 {
    fees::compute_linear_fee_policy(tx_size, &fees::PolicyParams::default())
}

/// Sum the fee components and bump to an even lovelace count. The collateral
/// output uses `3/2 * total_fee`; keeping `total_fee` even keeps that integer.
pub(crate) fn total_with_even_rounding(
    tx_fee: u64,
    compute_fee: u64,
    script_reference_fee: u64,
) -> u64 {
    let total = tx_fee + compute_fee + script_reference_fee;
    if total.is_multiple_of(2) {
        total
    } else {
        total + 1
    }
}
