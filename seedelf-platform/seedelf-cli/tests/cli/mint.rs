//! `util mint` — mints a new seedelf identity token from existing wallet
//! UTxOs. Signs with a one-time key plus the collateral service and submits
//! directly.

use serial_test::serial;

use seedelf_cli::commands::util::mint::{MintArgs, run};

use crate::harness::*;

/// Minting a seedelf must conserve value, mint exactly one identity token, and
/// leave the seedelf output and the change owned and at the wallet contract.
#[tokio::test]
#[serial]
async fn mint_creates_one_seedelf_and_conserves_value() {
    let mut scenario = Scenario::start().await;

    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
        .await;
    // mint evaluates one spend per input plus the mint script.
    scenario.mount_evaluate(2).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        MintArgs {
            label: Some("integration".to_string()),
            generator: None,
            public_value: None,
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("mint should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_sound_transaction(&tx, &scenario, &params);

    assert_eq!(tx.outputs.len(), 2, "seedelf output + change");
    assert_eq!(tx.outputs_to(&wallet_address()).len(), 2);

    let minted: i128 = tx
        .mint
        .iter()
        .filter(|((policy, _), _)| policy == &seedelf_policy())
        .map(|(_, qty)| *qty)
        .sum();
    assert_eq!(minted, 1, "exactly one seedelf token must be minted");
}
