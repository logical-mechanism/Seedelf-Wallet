//! `create` — an address pays to mint a new seedelf. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use serial_test::serial;

use seedelf_cli::commands::create::{CreateArgs, run};
use seedelf_koios::koios::UtxoResponse;

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

/// Run `create` from an address holding `utxos`, at the network's
/// reference-script price `per_byte` (the recorded 15 when `None`), and
/// return the transaction it built.
async fn create_with(utxos: Vec<UtxoResponse>, per_byte: Option<u64>) -> DecodedTx {
    let mut scenario = Scenario::start().await;
    if let Some(per_byte) = per_byte {
        scenario.mount_reference_script_price(per_byte).await;
    }
    scenario.mount_address_utxos(utxos).await;
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
    tx
}

/// A 5 ADA UTxO the command claims as collateral, and one to pay with.
fn payer_utxos() -> Vec<UtxoResponse> {
    vec![
        address_utxo(&external_address_bech32(), 1, 5_000_000, &[]),
        address_utxo(&external_address_bech32(), 2, 10_000_000, &[]),
    ]
}

/// A UTxO holding a reference script is never spent: it would cost Conway's
/// reference-script fee, and the script may be deployed there on purpose.
#[tokio::test]
#[serial]
async fn create_never_spends_a_utxo_holding_a_reference_script() {
    let mut utxos = payer_utxos();
    // The most ADA, which selection would take first.
    utxos.push(with_reference_script(
        address_utxo(&external_address_bech32(), 3, 50_000_000, &[]),
        519,
    ));
    let tx = create_with(utxos, None).await;
    assert_eq!(tx.inputs, vec![(tx_hash(2), 0)]);
}

/// The policy, by reference, is priced at the network's reference-script
/// price, not a fixed 15 lovelace a byte.
#[tokio::test]
#[serial]
async fn create_prices_the_policy_at_the_networks_reference_script_price() {
    let recorded = create_with(payer_utxos(), None).await.fee;
    let raised = create_with(payer_utxos(), Some(115)).await.fee;
    // The same transaction, with the policy's bytes 100 lovelace dearer.
    assert_eq!(
        raised - recorded,
        config().contract.seedelf_contract_size * 100
    );
}
