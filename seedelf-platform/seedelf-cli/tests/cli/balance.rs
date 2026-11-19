//! `balance` and `external balance` — what the wallet holds, in the contract
//! and at the external wallet's address. Both read rows anyone can add to, so
//! a stranger's rows must never stop either view.

use serial_test::serial;

use crate::harness::*;

/// A stranger pays three UTxOs of 2^63 − 1 of one token under
/// re-randomizations of the user's register, which sits on chain beside each
/// Seedelf. Their total is past a u64 (chunk 51, r4#2), and `balance`, the
/// CLI's only view of what's in the contract, stopped on every run.
#[tokio::test]
#[serial]
async fn balance_shows_a_wallet_holding_tokens_past_a_u64() {
    let mut scenario = Scenario::start().await;
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    let mut rows = vec![
        seedelf_utxo(scenario.scalar, 9, 1_500_000, SAMPLE_SEEDELF),
        wallet_utxo(scenario.scalar, 1, 100_000_000, &[]),
        wallet_utxo(scenario.scalar, 2, 5_000_000, std::slice::from_ref(&bought)),
    ];
    rows.extend((3..=5).map(|n| wallet_utxo(scenario.scalar, n, 1_500_000, &[junk()])));
    scenario.mount_credential_utxos(rows).await;

    seedelf_cli::commands::balance::run(PREPROD, VARIANT)
        .await
        .expect("balance should show a wallet holding a stranger's tokens");
}

/// The same three UTxOs at the external wallet's address, which anyone can
/// pay (chunk 51, r4#1), stopped `external balance` on every run.
#[tokio::test]
#[serial]
async fn external_balance_shows_a_wallet_holding_tokens_past_a_u64() {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");
    let mut rows = vec![address_utxo(&dapp, 1, 300_000_000, &[])];
    rows.extend((3..=5).map(|n| address_utxo(&dapp, n, 1_500_000, &[junk()])));
    scenario.mount_address_utxos(rows).await;

    seedelf_cli::commands::external::balance::run(PREPROD)
        .await
        .expect("external balance should show a wallet holding a stranger's tokens");
}

/// What both views show is totalled in u128, so a token past a u64 shows its
/// true total, and nothing is left out.
#[test]
#[serial]
fn balance_totals_are_exact_past_a_u64() {
    let address = external_address_bech32();
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    let mut rows = vec![address_utxo(
        &address,
        1,
        300_000_000,
        std::slice::from_ref(&bought),
    )];
    rows.extend((2..=4).map(|n| address_utxo(&address, n, 1_500_000, &[junk()])));

    let totals = seedelf_cli::commands::rows::totals(&rows).expect("totals");
    assert_eq!(totals.lovelace, 304_500_000);
    let tokens: Vec<(String, String, u128)> = totals
        .tokens
        .iter()
        .map(|t| (t.policy_id.clone(), t.name.clone(), t.amount))
        .collect();
    assert_eq!(
        tokens,
        vec![
            (bought.0, bought.1, 1_000),
            (junk().0, junk().1, 3 * u128::from(i64::MAX as u64))
        ]
    );
}
