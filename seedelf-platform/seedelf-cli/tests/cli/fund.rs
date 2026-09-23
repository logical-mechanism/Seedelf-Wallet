//! `fund` — an address sends funds to an existing seedelf. Finishes by serving
//! the CIP30 signing site, so the test captures the CBOR at the web-server
//! seam.

use serial_test::serial;

use seedelf_cli::commands::fund::{FundArgs, run};

use crate::harness::*;

/// Funding a seedelf must conserve value, place the funded output (with the
/// seedelf's re-randomized `Register`) at the wallet contract, and return
/// change to the paying address.
#[tokio::test]
#[serial]
async fn fund_sends_lovelace_to_seedelf() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_credential_utxos(vec![seedelf_utxo(
            scenario.scalar,
            1,
            1_500_000,
            SAMPLE_SEEDELF,
        )])
        .await;
    scenario
        .mount_address_utxos(vec![address_utxo(
            &external_address_bech32(),
            2,
            10_000_000,
            &[],
        )])
        .await;
    scenario.arm_web_capture();

    run(
        FundArgs {
            address: external_address_bech32(),
            seedelf: SAMPLE_SEEDELF.to_string(),
            lovelace: Some(3_000_000),
            assets: vec![],
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("fund should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.outputs.len(), 2, "funded output + change");

    let funded = tx.outputs_to(&wallet_address());
    assert_eq!(funded.len(), 1, "the funded output goes to the wallet");
    assert_eq!(
        funded[0].lovelace, 3_000_000,
        "the seedelf receives exactly the requested lovelace"
    );
    assert_eq!(
        tx.outputs_to(&external_address()).len(),
        1,
        "change returns to the paying address"
    );
    assert!(tx.mint.is_empty(), "fund mints nothing");
}
