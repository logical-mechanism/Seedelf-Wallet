//! `util extract` — rescues a wallet-contract UTxO that has an empty datum,
//! paying it (plus address funding) out to an address. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use serial_test::serial;

use seedelf_cli::commands::util::extract::{ExtractArgs, run};

use crate::harness::*;

/// Extracting an empty-datum UTxO must conserve value and pay everything out
/// to one plain-address output with no datum.
#[tokio::test]
#[serial]
async fn extract_rescues_empty_datum_utxo() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_utxo_info(vec![empty_datum_utxo(50, 2_000_000, &[])])
        .await;
    scenario
        .mount_address_utxos(vec![
            // a clean 5 ADA UTxO the command picks up as collateral
            address_utxo(&external_address_bech32(), 51, 5_000_000, &[]),
            address_utxo(&external_address_bech32(), 52, 10_000_000, &[]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        ExtractArgs {
            utxo: format!("{}#0", tx_hash(50)),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("extract should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);

    // The empty-datum UTxO plus the funding UTxO are spent into one output.
    assert_eq!(tx.inputs.len(), 2, "empty-datum UTxO + funding UTxO");
    assert_eq!(tx.outputs.len(), 1);
    assert_eq!(tx.outputs_to(&external_address()).len(), 1);
    assert!(tx.mint.is_empty(), "extract mints nothing");
}
