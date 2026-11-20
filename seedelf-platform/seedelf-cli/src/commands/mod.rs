pub mod balance;
pub mod create;
pub mod external;
pub(crate) mod fee;
pub mod fund;
pub mod remove;
pub mod rows;
pub(crate) mod spend;
pub(crate) mod submit;
pub mod sweep;
pub mod transfer;
pub mod util;
pub(crate) mod welcome;

/// What `sweep` and `remove` say before they pay a script's address (its
/// payment part a script: a multisig's, a contract's). The ledger takes the
/// payment, so they pay it, but it carries no datum, which some scripts can
/// never spend and some let anyone take, the Seedelf contract's own address
/// among them (chunk 51, r2a#1; the owner's call of 2026-11-18, a warning
/// rather than a refusal).
pub(crate) fn warn_if_a_script(addr: &pallas_addresses::Address) {
    use colored::Colorize;
    if seedelf_core::address::is_script_address(addr) {
        println!(
            "{}",
            "That's a script's address. This payment carries no datum: some scripts can never spend it, and some let anyone take it."
                .bright_yellow()
        );
    }
}
