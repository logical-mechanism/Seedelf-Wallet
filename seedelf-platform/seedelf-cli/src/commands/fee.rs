// Shared with the web wallet through seedelf-core's network-free builders.
pub(crate) use seedelf_core::build::{
    collateral_output, fake_signer, linear_fee, reference_script_fee,
};

/// Sum the fee components and bump to an even lovelace count. The collateral
/// output uses `3/2 * total_fee`; keeping `total_fee` even keeps that integer.
pub(crate) fn total_with_even_rounding(
    tx_fee: u64,
    compute_fee: u64,
    script_reference_fee: u64,
) -> u64 {
    seedelf_core::build::even(tx_fee + compute_fee + script_reference_fee)
}
