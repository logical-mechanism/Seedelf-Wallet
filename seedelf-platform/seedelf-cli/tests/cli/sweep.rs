//! `sweep` — a seedelf spends wallet UTxOs out to a plain address. Signs with
//! a one-time key plus the collateral service and submits directly.

use serial_test::serial;

use seedelf_cli::commands::sweep::{SweepArgs, run};

use crate::harness::*;

fn sweep_args(address: String, lovelace: Option<u64>, all: bool) -> SweepArgs {
    SweepArgs {
        address: Some(address),
        lovelace,
        all,
        assets: vec![],
        ada_handle: None,
        utxos: None,
    }
}

/// `--all` drains every wallet UTxO (including a token) into one address
/// output and leaves no change.
#[tokio::test]
#[serial]
async fn sweep_all_drains_wallet_to_address() {
    let mut scenario = Scenario::start().await;
    let token = ("cc".repeat(28), hex::encode("SWEEPALL"), 5);

    scenario
        .mount_credential_utxos(vec![
            wallet_utxo(scenario.scalar, 1, 8_000_000, &[]),
            wallet_utxo(scenario.scalar, 2, 6_000_000, std::slice::from_ref(&token)),
        ])
        .await;
    scenario.mount_evaluate(2).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        sweep_args(external_address_bech32(), None, true),
        PREPROD,
        VARIANT,
    )
    .await
    .expect("sweep --all should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.inputs.len(), 2, "both wallet UTxOs swept");
    assert_eq!(tx.outputs.len(), 1, "no change on a full sweep");
    assert_eq!(tx.outputs_to(&external_address()).len(), 1);
    let swept_token: u64 = tx.outputs[0]
        .assets
        .get(&(token.0.clone(), token.1.clone()))
        .copied()
        .unwrap_or(0);
    assert_eq!(swept_token, 5, "the token must sweep out with the ADA");
}

/// A partial `--lovelace` sweep pays the address and returns owned, valid
/// change to the wallet contract.
#[tokio::test]
#[serial]
async fn sweep_partial_returns_change_to_wallet() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        sweep_args(external_address_bech32(), Some(3_000_000), false),
        PREPROD,
        VARIANT,
    )
    .await
    .expect("sweep --lovelace should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.outputs.len(), 2, "address payment + wallet change");
    let to_address = tx.outputs_to(&external_address());
    assert_eq!(to_address.len(), 1);
    assert_eq!(
        to_address[0].lovelace, 3_000_000,
        "address receives exactly the requested lovelace"
    );
    assert_eq!(
        tx.outputs_to(&wallet_address()).len(),
        1,
        "change to wallet"
    );
}
