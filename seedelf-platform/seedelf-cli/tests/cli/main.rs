//! Offline mock-Koios integration tests for every transaction-building command.
//!
//! Each test drives a real `command::run(...)` against a local mock Koios
//! server, captures the transaction the command tried to submit, decodes it
//! with Pallas, and asserts it is a sound, balanced transaction. See
//! `harness.rs` for the shared scaffolding and the rationale for `#[serial]`.

mod harness;

mod create;
mod external_sweep;
mod extract;
mod fund;
mod mint;
mod remove;
mod sweep;
mod transfer;
