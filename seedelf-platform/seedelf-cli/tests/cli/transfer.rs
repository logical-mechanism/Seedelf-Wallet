//! `transfer` — a seedelf spends wallet UTxOs to pay one or more seedelfs.
//! Signs with a one-time key plus the collateral service and submits directly.

use serial_test::serial;

use seedelf_cli::commands::transfer::{TransforArgs, run};

use crate::harness::*;

/// A single-recipient transfer must conserve value and leave both the
/// recipient output and the change output owned, datum-bearing, and at the
/// wallet contract.
#[tokio::test]
#[serial]
async fn transfer_single_recipient_is_sound() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_credential_utxos(vec![
            wallet_utxo(scenario.scalar, 1, 10_000_000, &[]),
            seedelf_utxo(scenario.scalar, 2, 1_500_000, SAMPLE_SEEDELF),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        TransforArgs {
            seedelfs: vec![SAMPLE_SEEDELF.to_string()],
            lovelaces: Some(vec![2_000_000]),
            assets: vec![],
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("transfer should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    // One recipient output + one change output, both at the wallet contract.
    assert_eq!(tx.outputs.len(), 2, "recipient + change");
    assert_eq!(tx.outputs_to(&wallet_address()).len(), 2);
    assert!(tx.mint.is_empty(), "transfer mints nothing");
}

/// Transferring a wallet UTxO that also carries an unrelated native token
/// exercises the token change-output path.
#[tokio::test]
#[serial]
async fn transfer_returns_token_change() {
    let mut scenario = Scenario::start().await;
    let token = ("bb".repeat(28), hex::encode("XTOKEN"), 42);

    scenario
        .mount_credential_utxos(vec![
            wallet_utxo(scenario.scalar, 1, 10_000_000, std::slice::from_ref(&token)),
            seedelf_utxo(scenario.scalar, 2, 1_500_000, SAMPLE_SEEDELF),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        TransforArgs {
            seedelfs: vec![SAMPLE_SEEDELF.to_string()],
            lovelaces: Some(vec![2_000_000]),
            assets: vec![],
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("transfer should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    // The token the recipient was not sent must return as change.
    let change_token: u64 = tx
        .outputs
        .iter()
        .filter_map(|o| o.assets.get(&(token.0.clone(), token.1.clone())))
        .sum();
    assert_eq!(change_token, 42, "unsent token must be fully returned");
}
