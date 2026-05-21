//! `remove` — spends a seedelf UTxO, burns its identity token, and returns the
//! leftover ADA to an address. Signs with a one-time key plus the collateral
//! service and submits directly.

use serial_test::serial;

use seedelf_cli::commands::remove::{RemoveArgs, run};

use crate::harness::*;

/// Removing a seedelf must conserve value, burn exactly one identity token,
/// and pay the leftover ADA out to the address.
#[tokio::test]
#[serial]
async fn remove_burns_token_and_returns_ada() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_credential_utxos(vec![seedelf_utxo(
            scenario.scalar,
            1,
            5_000_000,
            SAMPLE_SEEDELF,
        )])
        .await;
    // remove evaluates two scripts: the spend and the burn.
    scenario.mount_evaluate(2).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        RemoveArgs {
            seedelf: SAMPLE_SEEDELF.to_string(),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("remove should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.inputs.len(), 1, "only the seedelf UTxO is spent");
    assert_eq!(
        tx.outputs.len(),
        1,
        "leftover ADA goes to one address output"
    );
    assert_eq!(tx.outputs_to(&external_address()).len(), 1);

    let burned = tx
        .mint
        .get(&(seedelf_policy(), SAMPLE_SEEDELF.to_string()))
        .copied()
        .expect("the seedelf token must be in the mint field");
    assert_eq!(burned, -1, "exactly one seedelf token must be burned");
}
