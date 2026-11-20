//! `sweep` — a seedelf spends wallet UTxOs out to an address, or an ADA
//! Handle's. Signs with a one-time key plus the collateral service and
//! submits directly.

use pallas_addresses::{Address, Network, ShelleyAddress, ShelleyDelegationPart, StakeKeyHash};
use serde_json::json;
use serial_test::serial;
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

use seedelf_cli::commands::sweep::{SweepArgs, run};

use crate::harness::*;

/// What `sweep` prints before it pays a script's address.
const SCRIPT_WARNING: &str = "That's a script's address. This payment carries no datum: some scripts can never spend it, and some let anyone take it.";

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

/// `sweep` refuses a stake or other-network address itself, before it
/// unlocks the wallet or reads the contract (chunk 51, t1b#9). Core's builders
/// refuse them too, in their own words, once the contract is read. A script's
/// address the ledger takes, so `sweep` does, with a warning (r2a#1, below).
#[tokio::test]
#[serial]
async fn sweep_refuses_to_pay_a_stake_or_other_network_address() {
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

/// The run [`sweep_pays_a_scripts_address_and_says_it_carries_no_datum`]
/// reads, as its child process: `sweep` of 2 ADA to a multisig's address.
/// Does nothing in the parent.
#[tokio::test]
#[serial]
async fn sweep_to_a_scripts_address_in_a_child_process() {
    if !is_child("sweep::sweep_to_a_scripts_address_in_a_child_process") {
        return;
    }
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;
    let to = a_multisig_address();
    let swept = run(
        sweep_args(to.to_bech32().expect("bech32"), Some(2_000_000), false),
        PREPROD,
        VARIANT,
    )
    .await;
    match swept {
        Ok(()) => println!("OUTCOME: sent"),
        Err(e) => println!("OUTCOME: error: {e:#}"),
    }
    let tx = decode_tx(&scenario.submitted_cbor().await);
    let paid: Vec<(u64, bool)> = tx
        .outputs_to(&to)
        .iter()
        .map(|o| (o.lovelace, o.has_datum))
        .collect();
    println!("PAID: {paid:?}");
}

/// A script's address (its payment part a script: a multisig's, a
/// contract's) is paid, as the ledger takes it, and `sweep` says first that
/// the payment carries no datum, which some scripts can never spend and some
/// let anyone take: it refused one as "Supplied Address Is Incorrect"
/// (chunk 51, r2a#1; the owner's call of 2026-11-18, a warning rather than a
/// refusal).
#[test]
#[serial]
fn sweep_pays_a_scripts_address_and_says_it_carries_no_datum() {
    let (stdout, stderr) = run_child(
        "sweep::sweep_to_a_scripts_address_in_a_child_process",
        std::time::Duration::from_secs(120),
    );
    assert_eq!(
        line_after(&stdout, "OUTCOME: ").as_deref(),
        Some("sent"),
        "{stdout}\n{stderr}"
    );
    assert_eq!(
        line_after(&stdout, "PAID: ").as_deref(),
        Some("[(2000000, false)]"),
        "one output pays it exactly, with no datum"
    );
    assert!(stdout.contains(SCRIPT_WARNING), "{stdout}");
}

/// The Seedelf contract's address with a stake key (`addr_test1z…`): the
/// same script as [`wallet_address`], another string.
fn the_contract_staked() -> Address {
    let Address::Shelley(contract) = wallet_address() else {
        panic!("the wallet contract is a Shelley address");
    };
    Address::from(ShelleyAddress::new(
        Network::Testnet,
        contract.payment().clone(),
        ShelleyDelegationPart::Key(StakeKeyHash::new([0x22; 28])),
    ))
}

/// The ways [`sweep_pays_the_contract_by_handle_as_by_address`] pays the
/// Seedelf contract: `-a` its address, and `--ada-handle` a handle Koios
/// says is held there, or at its staked form.
const TO_THE_CONTRACT: [&str; 3] = ["address", "handle", "handle-staked"];

/// The run [`sweep_pays_the_contract_by_handle_as_by_address`] reads, as its
/// child process: `sweep` of 2 ADA each of [`TO_THE_CONTRACT`]'s ways. Does
/// nothing in the parent.
#[tokio::test]
#[serial]
async fn sweep_to_the_contract_by_handle_in_a_child_process() {
    if !is_child("sweep::sweep_to_the_contract_by_handle_in_a_child_process") {
        return;
    }
    for case in TO_THE_CONTRACT {
        let to = if case == "handle-staked" {
            the_contract_staked()
        } else {
            wallet_address()
        };
        let bech32 = to.to_bech32().expect("bech32");
        let mut scenario = Scenario::start().await;
        scenario
            .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
            .await;
        scenario.mount_evaluate(1).await;
        scenario.mount_collateral().await;
        scenario.mount_submit().await;
        let (address, ada_handle) = if case == "address" {
            (Some(bech32), None)
        } else {
            Mock::given(method("GET"))
                .and(path("/api/v1/asset_nft_address"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_json(json!([{ "payment_address": bech32 }])),
                )
                .mount(&scenario.server)
                .await;
            (None, Some("friend".to_string()))
        };
        println!("BEGIN {case}");
        let swept = run(
            SweepArgs {
                address,
                lovelace: Some(2_000_000),
                all: false,
                assets: vec![],
                ada_handle,
                utxos: None,
            },
            PREPROD,
            VARIANT,
        )
        .await;
        match swept {
            Ok(()) => println!("OUTCOME {case}: sent"),
            Err(e) => println!("OUTCOME {case}: error: {e:#}"),
        }
        // The change goes back to the contract under a register: the
        // payment is the output there with no datum.
        let paid: Vec<u64> = if scenario.requests_to("/api/v1/submittx").await == 0 {
            Vec::new()
        } else {
            decode_tx(&scenario.submitted_cbor().await)
                .outputs_to(&to)
                .iter()
                .filter(|o| !o.has_datum)
                .map(|o| o.lovelace)
                .collect()
        };
        println!("PAID {case}: {paid:?}");
        println!("END {case}");
    }
}

/// A handle held at the Seedelf contract is paid as the contract's address
/// is, with the warning that the payment carries no datum, which anyone can
/// take there: the ledger takes it. `sweep --ada-handle` refused one at the
/// contract's address as "ADA Handle Is In Wallet Address", and paid one at
/// its staked form, by a string compare (chunk 51, cli#2; the owner's B16
/// (2), a warning rather than a refusal for every script's address).
#[test]
#[serial]
fn sweep_pays_the_contract_by_handle_as_by_address() {
    let (stdout, stderr) = run_child(
        "sweep::sweep_to_the_contract_by_handle_in_a_child_process",
        std::time::Duration::from_secs(120),
    );
    let seen: Vec<(&str, Option<String>, Option<String>, bool)> = TO_THE_CONTRACT
        .into_iter()
        .map(|case| {
            let begin = stdout
                .find(&format!("BEGIN {case}\n"))
                .unwrap_or_else(|| panic!("{case} never ran\n{stdout}\n{stderr}"));
            let end = stdout[begin..]
                .find(&format!("END {case}\n"))
                .map_or(stdout.len(), |i| begin + i);
            let run = &stdout[begin..end];
            (
                case,
                line_after(run, &format!("OUTCOME {case}: ")),
                line_after(run, &format!("PAID {case}: ")),
                run.contains(SCRIPT_WARNING),
            )
        })
        .collect();
    let sent = |case| {
        (
            case,
            Some("sent".to_string()),
            Some("[2000000]".to_string()),
            true,
        )
    };
    assert_eq!(
        seen,
        TO_THE_CONTRACT.map(sent).to_vec(),
        "each way: sent, 2 ADA paid with no datum, the warning printed\n{stdout}\n{stderr}"
    );
}

/// A key address whose stake part is a script (`addr_test1y…`) is an
/// ordinary payee: only its payment key spends what's paid there, with no
/// datum. `sweep` refused it as a script's (chunk 51, r2a#1).
#[tokio::test]
#[serial]
async fn sweep_pays_a_key_address_staked_by_a_script() {
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;
    let to = external_address_staked_by_a_script();
    run(
        sweep_args(to.to_bech32().expect("bech32"), Some(2_000_000), false),
        PREPROD,
        VARIANT,
    )
    .await
    .expect("sweep pays a key address staked by a script");
    let tx = decode_tx(&scenario.submitted_cbor().await);
    let paid: Vec<(u64, bool)> = tx
        .outputs_to(&to)
        .iter()
        .map(|o| (o.lovelace, o.has_datum))
        .collect();
    assert_eq!(paid, vec![(2_000_000, false)]);
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
