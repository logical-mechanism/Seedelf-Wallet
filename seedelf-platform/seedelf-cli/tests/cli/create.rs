//! `create` — an address pays to mint a new seedelf. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use serial_test::serial;

use seedelf_cli::commands::create::{CreateArgs, run};

use crate::harness::*;

/// Creating a seedelf must conserve value, mint exactly one identity token,
/// put the seedelf output (with an owned, valid `Register`) at the wallet
/// contract, and return change to the paying address.
#[tokio::test]
#[serial]
async fn create_mints_seedelf_and_conserves_value() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_address_utxos(vec![
            // a clean 5 ADA UTxO the command claims as collateral
            address_utxo(&external_address_bech32(), 1, 5_000_000, &[]),
            address_utxo(&external_address_bech32(), 2, 10_000_000, &[]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        CreateArgs {
            address: external_address_bech32(),
            label: Some("hello".to_string()),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("create should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(
        tx.inputs.len(),
        1,
        "only the funding UTxO is a regular input"
    );
    assert_eq!(tx.outputs.len(), 2, "seedelf output + change");
    assert_eq!(
        tx.outputs_to(&wallet_address()).len(),
        1,
        "the seedelf output goes to the wallet contract"
    );
    assert_eq!(
        tx.outputs_to(&external_address()).len(),
        1,
        "change returns to the paying address"
    );

    let minted: i128 = tx
        .mint
        .iter()
        .filter(|((policy, _), _)| policy == &seedelf_policy())
        .map(|(_, qty)| *qty)
        .sum();
    assert_eq!(minted, 1, "exactly one seedelf token must be minted");
}
