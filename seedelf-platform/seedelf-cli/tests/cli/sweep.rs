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

/// Runs `sweep --all` to the external address over the owned `rows`, Ogmios
/// measuring up to `measured` inputs, and returns the transaction it
/// submitted, checked sound, every output paying the address.
async fn sweep_all_of(
    rows: impl FnOnce(blstrs::Scalar) -> Vec<seedelf_koios::koios::UtxoResponse>,
    measured: usize,
) -> DecodedTx {
    let mut scenario = Scenario::start().await;
    scenario.mount_credential_utxos(rows(scenario.scalar)).await;
    scenario.mount_evaluate(measured).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        sweep_args(external_address_bech32(), None, true),
        PREPROD,
        VARIANT,
    )
    .await
    .expect("sweep --all should send what it can");

    let params = protocol_params().await;
    let cbor = scenario.submitted_cbor().await;
    assert!(
        cbor.len() / 2 <= 16_384,
        "the sweep is {} bytes, over the network's limit",
        cbor.len() / 2
    );
    let tx = decode_tx(&cbor);
    assert_sound_transaction(&tx, &scenario, &params);
    assert!(
        tx.outputs.iter().all(|o| o.address == external_address()),
        "sweep --all sends everything it spends to the address"
    );
    tx
}

fn sorted_inputs(tx: &DecodedTx) -> Vec<(String, u64)> {
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    inputs
}

/// A stranger pays three UTxOs of 2^63 − 1 of one token under
/// re-randomizations of the user's register (chunk 51, r4#2). Together
/// they're past what one output holds, so `sweep --all` stopped whenever all
/// three were among the 20 it took. It leaves the third out, and still takes
/// 20 it can spend together; the rest wait for the next run.
#[tokio::test]
#[serial]
async fn sweep_all_goes_when_a_strangers_tokens_total_past_a_u64() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    let tx = sweep_all_of(
        |scalar| {
            let mut rows: Vec<_> = (1..=3)
                .map(|n| wallet_utxo(scalar, n, 1_500_000, &[junk()]))
                .collect();
            rows.push(wallet_utxo(
                scalar,
                10,
                5_000_000,
                std::slice::from_ref(&bought),
            ));
            rows.extend((11..=29).map(|n| wallet_utxo(scalar, n, 5_000_000, &[])));
            rows
        },
        20,
    )
    .await;

    let mut expected = vec![(tx_hash(1), 0), (tx_hash(2), 0)];
    expected.extend((10..=27).map(|n| (tx_hash(n), 0)));
    assert_eq!(
        sorted_inputs(&tx),
        expected,
        "the first 20 it can spend together: the third junk UTxO stays"
    );
    let swept = |token: &TokenAmount| -> u64 {
        tx.outputs
            .iter()
            .filter_map(|o| o.assets.get(&(token.0.clone(), token.1.clone())))
            .sum()
    };
    assert_eq!(swept(&junk()), 2 * (i64::MAX as u64));
    assert_eq!(swept(&bought), 1_000);
}

/// UTxOs whose tokens' outputs (20 tokens to an output) pass 16 KiB together
/// can't stop `sweep --all`: it sends as many as fit, and leaves the rest.
#[tokio::test]
#[serial]
async fn sweep_all_takes_what_one_transaction_holds() {
    let tx = sweep_all_of(
        |scalar| {
            vec![
                wallet_utxo(scalar, 1, 50_000_000, &[]),
                wallet_utxo(scalar, 2, 40_000_000, &pile(0x10, 700)),
                wallet_utxo(scalar, 3, 40_000_000, &pile(0x20, 700)),
                wallet_utxo(scalar, 4, 40_000_000, &pile(0x30, 700)),
            ]
        },
        4,
    )
    .await;

    assert_eq!(
        sorted_inputs(&tx),
        vec![(tx_hash(1), 0), (tx_hash(2), 0), (tx_hash(3), 0)]
    );
}

/// A stranger's pile of tokens under the user's register, holding too little
/// ADA for the outputs `sweep --all` splits it into (600 tokens need about 41
/// ADA at the address here, and came with 12), can't stop the sweep of the
/// rest, whose ADA can't make up the difference: it stays.
#[tokio::test]
#[serial]
async fn sweep_all_leaves_tokens_the_rest_cant_carry() {
    let tx = sweep_all_of(
        |scalar| {
            vec![
                wallet_utxo(scalar, 1, 10_000_000, &[]),
                wallet_utxo(scalar, 2, 12_000_000, &pile(0x40, 600)),
            ]
        },
        2,
    )
    .await;

    assert_eq!(tx.inputs, vec![(tx_hash(1), 0)]);
    assert!(tx.outputs.iter().all(|o| o.assets.is_empty()));
}
