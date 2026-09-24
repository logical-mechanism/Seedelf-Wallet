use anyhow::{Result, bail};
use serde_json::Value;

// Shared with the web wallet through seedelf-core's network-free builders.
pub(crate) use seedelf_core::build::{collateral_output, fake_signer, linear_fee};

/// Sum the fee components and bump to an even lovelace count. The collateral
/// output uses `3/2 * total_fee`; keeping `total_fee` even keeps that integer.
pub(crate) fn total_with_even_rounding(
    tx_fee: u64,
    compute_fee: u64,
    script_reference_fee: u64,
) -> u64 {
    seedelf_core::build::even(tx_fee + compute_fee + script_reference_fee)
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
