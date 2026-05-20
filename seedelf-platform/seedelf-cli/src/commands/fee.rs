use anyhow::{Result, bail};
use pallas_addresses::Address;
use pallas_crypto::key::ed25519::SecretKey;
use pallas_traverse::fees;
use pallas_txbuilder::Output;
use pallas_wallet::PrivateKey;
use rand_core::OsRng;
use serde_json::Value;

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

/// Build the collateral return Output: returns `5 ADA - 3/2 * total_fee` to
/// the supplied address. Caller is responsible for ensuring `total_fee` is
/// even (via [`total_with_even_rounding`]) so the integer division is exact.
pub(crate) fn collateral_output(addr: Address, total_fee: u64) -> Output {
    Output::new(addr, 5_000_000 - total_fee * 3 / 2)
}

/// Interpret a Koios `submit_tx` JSON response. Returns the tx hash on
/// success, or `Err` with the raw response when Koios rejects the tx.
pub(crate) fn parse_submit_response(response: &Value) -> Result<String> {
    // Koios returns the tx hash as a bare JSON string on success and an
    // object (with `contents` / `code` / etc.) on failure.
    if let Some(hash) = response.as_str() {
        return Ok(hash.to_string());
    }
    bail!("Koios rejected the transaction: {response}")
}
