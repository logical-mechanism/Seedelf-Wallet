use anyhow::{Context, Result, bail};
use pallas_addresses::Address;
use pallas_txbuilder::Output;
use serde_json::Value;

// Shared with the web wallet through seedelf-core's network-free builders.
pub(crate) use seedelf_core::build::{fake_signer, linear_fee};

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
///
/// Errors if the fee is large enough that `3/2 * total_fee` exceeds the fixed
/// 5 ADA collateral — at that point the collateral cannot cover the tx anyway.
pub(crate) fn collateral_output(addr: Address, total_fee: u64) -> Result<Output> {
    let collateral_return: u64 = 5_000_000u64
        .checked_sub(total_fee * 3 / 2)
        .context("transaction fee is too large for the 5 ADA collateral to cover")?;
    Ok(Output::new(addr, collateral_return))
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
