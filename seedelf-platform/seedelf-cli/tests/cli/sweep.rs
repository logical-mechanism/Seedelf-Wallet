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
/// three were among the 20 it took. It takes the 20 that bring most, which
/// the junk, holding little ADA, is never among while the user has 20 of
/// their own (r2cli#1); with fewer, it reaches the junk, leaves the third
/// out, and still takes what it can spend together. The rest wait for the
/// next run.
#[tokio::test]
#[serial]
async fn sweep_all_goes_when_a_strangers_tokens_total_past_a_u64() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1_000);
    // The junk at the lowest hashes, the user's UTxOs (5 ₳ each, one of them
    // holding 1,000 of a token they bought) after it.
    let rows = |scalar, own: u64| {
        let mut rows: Vec<_> = (1..=3)
            .map(|n| wallet_utxo(scalar, n, 1_500_000, &[junk()]))
            .collect();
        rows.push(wallet_utxo(
            scalar,
            10,
            5_000_000,
            std::slice::from_ref(&bought),
        ));
        rows.extend((11..11 + own).map(|n| wallet_utxo(scalar, n, 5_000_000, &[])));
        rows
    };
    let swept = |tx: &DecodedTx, token: &TokenAmount| -> u64 {
        tx.outputs
            .iter()
            .filter_map(|o| o.assets.get(&(token.0.clone(), token.1.clone())))
            .sum()
    };

    let tx = sweep_all_of(|scalar| rows(scalar, 19), 20).await;
    let expected: Vec<_> = (10..=29).map(|n| (tx_hash(n), 0)).collect();
    assert_eq!(
        sorted_inputs(&tx),
        expected,
        "the user's 20, which bring most: all three junk UTxOs stay"
    );
    assert_eq!(swept(&tx, &junk()), 0);
    assert_eq!(swept(&tx, &bought), 1_000);

    let tx = sweep_all_of(|scalar| rows(scalar, 6), 9).await;
    let mut expected = vec![(tx_hash(1), 0), (tx_hash(2), 0)];
    expected.extend((10..=16).map(|n| (tx_hash(n), 0)));
    assert_eq!(
        sorted_inputs(&tx),
        expected,
        "all it can spend together: the third junk UTxO stays"
    );
    assert_eq!(swept(&tx, &junk()), 2 * (i64::MAX as u64));
    assert_eq!(swept(&tx, &bought), 1_000);
}

/// The run [`sweep_all_of_nothing_but_piles_names_them`] reads, as its child
/// process: `sweep --all` of a balance that is only a stranger's 25 piles of
/// 30 tokens, each holding less ADA than its outputs need, so nothing can go.
/// Does nothing in the parent.
#[tokio::test]
#[serial]
async fn sweep_all_of_nothing_but_piles_in_a_child_process() {
    if !is_child("sweep::sweep_all_of_nothing_but_piles_in_a_child_process") {
        return;
    }
    let mut scenario = Scenario::start().await;
    let piles: Vec<_> = (0..25u8)
        .map(|i| {
            let mut row = wallet_utxo(scenario.scalar, 7, 2_000_000, &pile(0x10 + i, 30));
            row.tx_index = u64::from(i);
            row
        })
        .collect();
    scenario.mount_credential_utxos(piles).await;
    scenario.mount_evaluate(20).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;
    let swept = run(
        sweep_args(external_address_bech32(), None, true),
        PREPROD,
        VARIANT,
    )
    .await;
    match swept {
        Ok(()) => println!("OUTCOME: sent"),
        Err(e) => println!("OUTCOME: error: {e:#}"),
    }
}

/// A `sweep --all` that sends nothing names the UTxOs that stopped it, by
/// outpoint, and says nothing of running it again, which would take the same
/// UTxOs. It named none of them, and said "run sweep --all again" of the rest,
/// which were the user's own whenever a stranger's piles came first (chunk
/// 51, r2cli#1).
#[test]
#[serial]
fn sweep_all_of_nothing_but_piles_names_them() {
    let (stdout, stderr) = run_child(
        "sweep::sweep_all_of_nothing_but_piles_in_a_child_process",
        std::time::Duration::from_secs(120),
    );
    let outcome = line_after(&stdout, "OUTCOME: ").unwrap_or_default();
    assert!(
        outcome.starts_with("error:"),
        "precondition: nothing could go: {outcome}\n{stdout}\n{stderr}"
    );
    let named: std::collections::BTreeSet<String> = stdout
        .lines()
        .filter_map(|line| line.trim().strip_prefix("UTxO: ").map(str::to_string))
        .collect();
    let tried: std::collections::BTreeSet<String> =
        (0..20).map(|i| format!("{}#{i}", tx_hash(7))).collect();
    assert_eq!(named, tried, "the 20 piles it tried are named:\n{stdout}");
    assert!(
        stdout
            .lines()
            .any(|line| line.trim() == "Past what one transaction takes: 5"),
        "the 5 it never reached are counted:\n{stdout}"
    );
    assert!(
        !stdout.contains("again"),
        "no advice to run it again:\n{stdout}"
    );
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

/// `sweep` refuses a script, stake or other-network address itself, before it
/// unlocks the wallet or reads the contract (chunk 51, t1b#9). Core's builders
/// refuse them too, in their own words, once the contract is read: a payment
/// with no datum to a script can lock for good there.
#[tokio::test]
#[serial]
async fn sweep_refuses_to_pay_a_script_stake_or_other_network_address() {
    for address in not_payable_addresses() {
        for all in [false, true] {
            let mut scenario = Scenario::start().await;
            scenario
                .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
                .await;
            scenario.mount_evaluate(1).await;
            scenario.mount_collateral().await;
            scenario.mount_submit().await;

            let lovelace = (!all).then_some(2_000_000);
            let refused = run(sweep_args(address.clone(), lovelace, all), PREPROD, VARIANT)
                .await
                .expect_err("a payment no address takes is refused");
            assert!(
                refused
                    .to_string()
                    .contains("Supplied Address Is Incorrect"),
                "{address}, all: {all}: {refused:#}"
            );
            assert_eq!(
                scenario.requests_to("/api/v1/credential_utxos").await,
                0,
                "{address}, all: {all}: refused before the contract is read"
            );
            assert_eq!(scenario.requests_to("/api/v1/submittx").await, 0);
        }
    }
}

/// A stranger's row at the KEY address carrying the contract's hash, under
/// the user's register, comes with the contract's rows (Koios asks by the 28
/// bytes alone), and no key can spend it: `sweep --all` leaves it and sends
/// the rest, where taking it, the node refused the whole spend (chunk 51,
/// x2#2).
#[tokio::test]
#[serial]
async fn sweep_all_leaves_a_row_at_the_key_address_carrying_the_contracts_hash() {
    let mut scenario = Scenario::start().await;
    let mut planted = wallet_utxo(scenario.scalar, 2, 1_340_000, &[]);
    planted.address = key_address_with_the_contracts_hash();
    scenario
        .mount_credential_utxos(vec![
            wallet_utxo(scenario.scalar, 1, 10_000_000, &[]),
            planted,
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
    .expect("sweep --all sends what's at the contract");
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_eq!(
        tx.inputs,
        vec![(tx_hash(1), 0)],
        "only the contract's row is spent"
    );
}
