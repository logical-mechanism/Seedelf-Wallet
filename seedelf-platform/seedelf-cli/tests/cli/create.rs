//! `create` — an address pays to mint a new seedelf. Finishes by serving the
//! CIP30 signing site, so the test captures the CBOR at the web-server seam.

use serde_json::{Value, json};
use serial_test::serial;

use seedelf_cli::commands::create::{CreateArgs, run};
use seedelf_core::assets::Assets;
use seedelf_core::transaction::{seedelf_minimum_lovelace, wallet_minimum_lovelace_with_assets};
use seedelf_koios::koios::UtxoResponse;

use crate::harness::*;

/// Run `create` from an address holding `utxos`, the mock's evaluation
/// answering `budget` (cpu, memory), at the recorded parameters with `change`
/// made to them: what it returned, and the transaction it served to sign, if
/// it served one.
async fn create_priced(
    utxos: Vec<UtxoResponse>,
    budget: (u64, u64),
    change: impl FnOnce(&mut Value),
) -> (anyhow::Result<()>, Option<DecodedTx>) {
    let mut scenario = Scenario::start().await;
    scenario.mount_params(change).await;
    scenario.mount_address_utxos(utxos).await;
    scenario.mount_evaluate_budgets(&[budget]).await;
    scenario.arm_web_capture();
    let outcome = run(
        CreateArgs {
            address: external_address_bech32(),
            label: Some("hello".to_string()),
        },
        PREPROD,
        VARIANT,
    )
    .await;
    let served = seedelf_cli::web_server::take_captured_cbor().map(|cbor| decode_tx(&cbor));
    (outcome, served)
}

/// The fee is rounded up to even, so the collateral put up, 3/2 of it, is
/// whole and covers the ledger's 150% (chunk 51, t1b#5). Evaluations about a
/// lovelace of compute apart give the fee both parities before it's rounded.
#[tokio::test]
#[serial]
async fn create_rounds_its_fee_even_so_its_collateral_covers_150_percent() {
    for step in 0..6 {
        let budget = (250_000_000, 800_000 + 18 * step);
        let (outcome, served) = create_priced(payer_utxos(), budget, |_| {}).await;
        outcome.expect("create should succeed");
        assert_collateral_covers_the_fee(&served.expect("a transaction to sign"));
    }
}

/// A fee past the change `create` selected for is refused in words, never a
/// change that wraps below zero (chunk 51, t1b#6). Its selection covers the
/// Seedelf's minimum, a 0.205 ADA guess at the fee and a change output's
/// minimum, so a fee of about 2 ADA leaves the change short.
#[tokio::test]
#[serial]
async fn create_refuses_a_fee_past_its_change() {
    let params = recorded_params();
    // What the selection needs: the Seedelf's minimum, create's 0.205 ADA
    // guess at the fee, and a change output's minimum.
    let payer = seedelf_minimum_lovelace(&params).expect("the Seedelf's minimum")
        + 205_000
        + wallet_minimum_lovelace_with_assets(&params, Assets::new()).expect("a change minimum")
        + 100_000;
    let utxos = vec![
        address_utxo(&external_address_bech32(), 1, 5_000_000, &[]),
        address_utxo(&external_address_bech32(), 2, payer, &[]),
    ];
    let (outcome, served) = create_priced(utxos, (250_000_000, 800_000), |params| {
        params["min_fee_b"] = json!(2_000_000);
    })
    .await;
    let refused = outcome.expect_err("a fee past the change is refused");
    assert!(
        refused.to_string().contains("insufficient lovelace"),
        "{refused:#}"
    );
    assert!(served.is_none(), "nothing is served to sign");
}

/// And a fee whose 3/2, the collateral, is past the 5 ADA put up is refused
/// the same way, never a collateral return below zero: here the script runs
/// to most of what a transaction may use.
#[tokio::test]
#[serial]
async fn create_refuses_a_fee_its_collateral_cant_cover() {
    let utxos = vec![
        address_utxo(&external_address_bech32(), 1, 5_000_000, &[]),
        address_utxo(&external_address_bech32(), 2, 100_000_000, &[]),
    ];
    let (outcome, served) = create_priced(utxos, (10_000_000_000, 14_000_000), |params| {
        params["min_fee_b"] = json!(2_000_000);
    })
    .await;
    let refused = outcome.expect_err("a fee the collateral can't cover is refused");
    assert!(
        refused.to_string().contains("insufficient lovelace"),
        "{refused:#}"
    );
    assert!(served.is_none(), "nothing is served to sign");
}

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

/// A stranger's piles of tokens at the payer's address don't slow `create`,
/// which handed core every UTxO there, to add up their tokens in time that
/// grows with the square of the kinds (chunk 51, l3cli#3's sibling): with 40
/// piles of 1,000 there, the Seedelf is built within 60 s.
#[tokio::test]
#[serial]
async fn a_strangers_piles_at_the_payers_address_dont_slow_create() {
    let tx = within(std::time::Duration::from_secs(60), || {
        let payer = external_address_bech32();
        let mut utxos = payer_utxos();
        utxos.extend(
            (0..40u16).map(|n| address_utxo(&payer, 100 + u64::from(n), 19_000_000, &big_pile(n))),
        );
        create_with(utxos, None)
    })
    .await;
    assert_eq!(tx.inputs, vec![(tx_hash(2), 0)], "paid from the 10 ₳");
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

/// A 5 ADA UTxO that also holds a token is never the collateral: the return
/// is ADA alone, so the ledger would refuse it (CollateralContainsNonADA).
#[tokio::test]
#[serial]
async fn create_never_puts_up_a_collateral_holding_a_token() {
    let token = ("dd".repeat(28), hex::encode("COLLAT"), 1);
    let mut utxos = vec![address_utxo(
        &external_address_bech32(),
        3,
        5_000_000,
        &[token],
    )];
    utxos.extend(payer_utxos());
    let tx = create_with(utxos, None).await;
    assert_eq!(tx.collateral, vec![(tx_hash(1), 0)]);
    let back = tx.collateral_return.as_ref().expect("a collateral return");
    assert_eq!(back.address, external_address());
}

/// With no ADA-only UTxO of exactly 5 ADA to put up as collateral, the mint is
/// refused, rather than built with a collateral return and no collateral,
/// which the node refuses.
#[tokio::test]
#[serial]
async fn create_refuses_without_a_collateral() {
    let mut scenario = Scenario::start().await;
    let token = ("dd".repeat(28), hex::encode("COLLAT"), 1);
    scenario
        .mount_address_utxos(vec![
            address_utxo(&external_address_bech32(), 2, 10_000_000, &[]),
            // 5 ADA, but holding a token: never the collateral
            address_utxo(&external_address_bech32(), 3, 5_000_000, &[token]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    // Armed so that, without the check, the run ends at the signing site
    // rather than waiting there for a browser.
    scenario.arm_web_capture();

    let refused = run(
        CreateArgs {
            address: external_address_bech32(),
            label: Some("hello".to_string()),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("a mint with no collateral must be refused");
    assert!(
        refused.to_string().contains("No Collateral Found"),
        "{refused}"
    );
}

/// Anyone can pay the paying address too: three UTxOs of 2^63 − 1 of one
/// token there stopped `create` whenever its selection reached all three
/// (chunk 51). It leaves the third out and pays from the rest.
#[tokio::test]
#[serial]
async fn create_goes_when_a_strangers_tokens_at_the_address_total_past_a_u64() {
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1);
    let payer = external_address_bech32();
    let mut utxos = vec![address_utxo(&payer, 1, 5_000_000, &[])];
    utxos.extend((2..=4).map(|n| address_utxo(&payer, n, 1_300_000, &[junk()])));
    utxos.push(address_utxo(
        &payer,
        5,
        1_250_000,
        std::slice::from_ref(&bought),
    ));
    let tx = create_with(utxos, None).await;
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(
        inputs,
        vec![(tx_hash(2), 0), (tx_hash(3), 0), (tx_hash(5), 0)]
    );
}

/// The paying address is checked by its payment part alone: a key address
/// whose stake part is a script (`addr_test1y…`) signs with its payment key
/// like any other, so `create` pays from it. It refused one as "Supplied
/// Address Is Incorrect" (chunk 51, r2a#1).
#[tokio::test]
#[serial]
async fn create_pays_from_a_key_address_staked_by_a_script() {
    let payer = external_address_staked_by_a_script();
    let from = payer.to_bech32().expect("bech32");
    let mut scenario = Scenario::start().await;
    scenario
        .mount_address_utxos(vec![
            address_utxo(&from, 1, 5_000_000, &[]),
            address_utxo(&from, 2, 10_000_000, &[]),
        ])
        .await;
    scenario.mount_evaluate(1).await;
    scenario.arm_web_capture();

    run(
        CreateArgs {
            address: from,
            label: Some("hello".to_string()),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("create pays from a key address staked by a script");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);
    assert!(
        !tx.outputs_to(&payer).is_empty(),
        "change returns to the paying address"
    );
}
