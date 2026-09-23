//! `external sweep` — pulls every UTxO from the wallet's dApp address back
//! into the wallet contract. No collateral service, no web server: it signs
//! with the wallet key and submits directly.

use serial_test::serial;

use crate::harness::*;

/// A sweep of a pure-ADA UTxO plus a token-bearing UTxO must conserve value
/// and write a single owned, valid-`Register` change output to the contract.
#[tokio::test]
#[serial]
async fn external_sweep_mixed_utxos_is_sound() {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");
    let token = ("aa".repeat(28), hex::encode("SWEEPTOKEN"), 7);

    scenario
        .mount_address_utxos(vec![
            address_utxo(&dapp, 1, 10_000_000, &[]),
            address_utxo(&dapp, 2, 5_000_000, std::slice::from_ref(&token)),
        ])
        .await;
    scenario.mount_submit().await;

    seedelf_cli::commands::external::sweep::run(PREPROD, VARIANT)
        .await
        .expect("external sweep should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    // Both UTxOs are consumed and everything lands in one wallet output.
    assert_eq!(tx.inputs.len(), 2, "both source UTxOs should be spent");
    assert_eq!(tx.outputs.len(), 1, "expected a single change output");
    assert_eq!(
        tx.outputs_to(&wallet_address()).len(),
        1,
        "the change output must go to the wallet contract"
    );
    assert!(tx.mint.is_empty(), "external sweep mints nothing");
}

/// A sweep of only pure-ADA UTxOs exercises the no-token change path.
#[tokio::test]
#[serial]
async fn external_sweep_pure_ada_is_sound() {
    let mut scenario = Scenario::start().await;
    let dapp = dapp_address_for(scenario.scalar)
        .to_bech32()
        .expect("dapp bech32");

    scenario
        .mount_address_utxos(vec![
            address_utxo(&dapp, 10, 8_000_000, &[]),
            address_utxo(&dapp, 11, 12_000_000, &[]),
        ])
        .await;
    scenario.mount_submit().await;

    seedelf_cli::commands::external::sweep::run(PREPROD, VARIANT)
        .await
        .expect("external sweep should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.inputs.len(), 2);
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.outputs_to(&wallet_address()).len(), 1);
}
