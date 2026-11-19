//! `fund` — an address sends funds to an existing seedelf. Finishes by serving
//! the CIP30 signing site, so the test captures the CBOR at the web-server
//! seam.

use serial_test::serial;

use seedelf_cli::commands::fund::{FundArgs, run};
use seedelf_crypto::register::Register;

use crate::harness::*;

/// What `fund` hands core's selection puts first the holders of the token
/// sent that the selection takes, then the rest in the selection's own
/// order, within the kinds of token core adds up (chunk 51, l4cli#2). It put
/// every holder first, by lovelace, so a stranger's four piles at the payer's
/// address, each one SNEK beside a thousand junk tokens at its least (74 ₳),
/// took all 4,000 kinds: the user's ADA beside their 10 NFTs (A), or their own
/// SNEK beside 3 NFTs (B), was left out, and `fund --asset` was refused.
#[tokio::test]
#[serial]
async fn a_strangers_piles_holding_the_token_sent_dont_crowd_out_the_payers_own() {
    let payer = external_address_bech32();
    let params = recorded_params();
    let layouts = [
        (
            "A",
            vec![
                address_utxo(&payer, 2, 2_000_000, &[snek(1_000)]),
                address_utxo(
                    &payer,
                    3,
                    500_000_000,
                    &(1..=10).map(nft).collect::<Vec<_>>(),
                ),
            ],
            vec![(tx_hash(2), 0), (tx_hash(3), 0)],
        ),
        (
            "B",
            vec![
                address_utxo(&payer, 2, 2_000_000, &[snek(1_000), nft(1), nft(2), nft(3)]),
                address_utxo(&payer, 4, 500_000_000, &[]),
            ],
            vec![(tx_hash(2), 0), (tx_hash(4), 0)],
        ),
    ];
    let mut wrong = Vec::new();
    for (layout, mut rows, expected) in layouts {
        for (i, pile) in four_snek_piles().into_iter().enumerate() {
            let least = seedelf_core::transaction::address_minimum_lovelace_with_assets(
                &params,
                &payer,
                as_assets(&pile),
            )
            .expect("least");
            rows.push(address_utxo(&payer, 101 + i as u64, least, &pile));
        }
        let mut scenario = Scenario::start().await;
        scenario
            .mount_credential_utxos(vec![seedelf_utxo(
                scenario.scalar,
                1,
                1_500_000,
                SAMPLE_SEEDELF,
            )])
            .await;
        scenario.mount_address_utxos(rows).await;
        scenario.arm_web_capture();
        let funded = run(
            FundArgs {
                address: payer.clone(),
                seedelf: SAMPLE_SEEDELF.to_string(),
                lovelace: Some(10_000_000),
                assets: vec![snek_spec(100)],
            },
            PREPROD,
            VARIANT,
        )
        .await;
        if let Err(e) = funded {
            wrong.push(format!("{layout}: {e:#}"));
            continue;
        }
        let tx = decode_tx(&scenario.captured_cbor());
        assert_sound_transaction(&tx, &scenario, &protocol_params().await);
        let mut inputs = tx.inputs.clone();
        inputs.sort();
        if inputs != expected {
            wrong.push(format!("{layout}: spent {inputs:?}"));
        }
    }
    assert!(
        wrong.is_empty(),
        "the user's SNEK and their ADA pay:\n{}",
        wrong.join("\n")
    );
}

/// A stranger's piles of tokens at the payer's address don't slow `fund`:
/// core adds up the tokens of all it's handed in time that grows with the
/// square of the kinds, and `fund`, as `create` and `util extract`, handed it
/// every UTxO there (chunk 51, l3cli#3's sibling). With 40 piles of 1,000
/// tokens beside the user's 100 ₳, the fund must be built within 60 s.
#[tokio::test]
#[serial]
async fn a_strangers_piles_at_the_payers_address_dont_slow_fund() {
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![seedelf_utxo(
            scenario.scalar,
            1,
            1_500_000,
            SAMPLE_SEEDELF,
        )])
        .await;
    let payer = external_address_bech32();
    let mut rows: Vec<_> = (0..40u16)
        .map(|n| address_utxo(&payer, 100 + u64::from(n), 19_000_000, &big_pile(n)))
        .collect();
    rows.push(address_utxo(&payer, 2, 100_000_000, &[]));
    scenario.mount_address_utxos(rows).await;
    scenario.arm_web_capture();

    within(std::time::Duration::from_secs(60), move || async move {
        run(
            FundArgs {
                address: payer,
                seedelf: SAMPLE_SEEDELF.to_string(),
                lovelace: Some(10_000_000),
                assets: vec![],
            },
            PREPROD,
            VARIANT,
        )
        .await
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .expect("the fund is built");
    let tx = decode_tx(&scenario.captured_cbor());
    assert_eq!(tx.inputs, vec![(tx_hash(2), 0)], "paid from the 100 ₳");
}

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

/// A UTxO holding a reference script is never spent: it would cost Conway's
/// reference-script fee, and the script may be deployed there on purpose.
#[tokio::test]
#[serial]
async fn fund_never_spends_a_utxo_holding_a_reference_script() {
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
        .mount_address_utxos(vec![
            address_utxo(&external_address_bech32(), 2, 10_000_000, &[]),
            // The most ADA, which selection would take first.
            with_reference_script(
                address_utxo(&external_address_bech32(), 3, 50_000_000, &[]),
                519,
            ),
        ])
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
    assert_eq!(tx.inputs, vec![(tx_hash(2), 0)]);
}

/// A Seedelf whose register's public value is the identity is refused before
/// anything is built: the minting policy doesn't check datums, so one can be
/// minted by hand, and a payment under it is anyone's to take.
#[tokio::test]
#[serial]
async fn fund_refuses_a_seedelf_whose_public_value_is_the_identity() {
    let mut scenario = Scenario::start().await;

    let mut hostile = seedelf_utxo(scenario.scalar, 1, 1_500_000, SAMPLE_SEEDELF);
    let generator = owned_register(scenario.scalar).generator;
    let identity = format!("c0{}", "00".repeat(47));
    hostile.inline_datum = Some(register_inline_datum(&Register::new(generator, identity)));
    scenario.mount_credential_utxos(vec![hostile]).await;
    scenario
        .mount_address_utxos(vec![address_utxo(
            &external_address_bech32(),
            2,
            10_000_000,
            &[],
        )])
        .await;
    // Armed so that, without the check, the run ends at the signing site
    // rather than waiting there for a browser.
    scenario.arm_web_capture();

    let refused = run(
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
    .expect_err("a payment to an identity public value must be refused");
    assert!(
        refused.to_string().contains("register isn't valid"),
        "{refused}"
    );
}

/// Anyone can pay the funding address too: three UTxOs of 2^63 − 1 of one
/// token there stopped `fund` whenever its selection reached all three
/// (chunk 51). It leaves the third out and pays from the rest.
#[tokio::test]
#[serial]
async fn fund_goes_when_a_strangers_tokens_at_the_address_total_past_a_u64() {
    let mut scenario = Scenario::start().await;
    let bought = ("bb".repeat(28), hex::encode("BOUGHT"), 1);

    scenario
        .mount_credential_utxos(vec![seedelf_utxo(
            scenario.scalar,
            9,
            1_500_000,
            SAMPLE_SEEDELF,
        )])
        .await;
    let payer = external_address_bech32();
    let mut rows = vec![address_utxo(&payer, 1, 2_000_000, &[])];
    rows.extend((2..=4).map(|n| address_utxo(&payer, n, 5_000_000, &[junk()])));
    rows.push(address_utxo(
        &payer,
        5,
        4_000_000,
        std::slice::from_ref(&bought),
    ));
    scenario.mount_address_utxos(rows).await;
    scenario.arm_web_capture();

    run(
        FundArgs {
            address: payer,
            seedelf: SAMPLE_SEEDELF.to_string(),
            lovelace: Some(12_000_000),
            assets: vec![],
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("fund should pay from what fits");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);
    let mut inputs = tx.inputs.clone();
    inputs.sort();
    assert_eq!(
        inputs,
        vec![
            (tx_hash(1), 0),
            (tx_hash(2), 0),
            (tx_hash(3), 0),
            (tx_hash(5), 0)
        ]
    );
}

/// A fee past the change `fund` selected for is refused in words, never a
/// change that wraps below zero into an output no one has (chunk 51, t1b#6).
/// Its selection covers the payment and a change output's minimum, not the
/// fee, so a fee of about 2 ADA leaves the change short: with no token to
/// return, and with one.
#[tokio::test]
#[serial]
async fn fund_refuses_a_fee_past_its_change() {
    let returned = ("dd".repeat(28), hex::encode("BACK"), 1);
    for tokens in [vec![], vec![returned]] {
        let mut scenario = Scenario::start().await;
        scenario
            .mount_params(|params| params["min_fee_b"] = serde_json::json!(2_000_000))
            .await;
        scenario
            .mount_credential_utxos(vec![seedelf_utxo(
                seedelf_crypto::schnorr::random_scalar(),
                1,
                1_500_000,
                SAMPLE_SEEDELF,
            )])
            .await;
        // 10 ADA to pay, and 2 ADA over: a change output's minimum, not the fee.
        scenario
            .mount_address_utxos(vec![address_utxo(
                &external_address_bech32(),
                2,
                12_000_000,
                &tokens,
            )])
            .await;
        scenario.arm_web_capture();

        let refused = run(
            FundArgs {
                address: external_address_bech32(),
                seedelf: SAMPLE_SEEDELF.to_string(),
                lovelace: Some(10_000_000),
                assets: vec![],
            },
            PREPROD,
            VARIANT,
        )
        .await
        .expect_err("a fee past the change is refused");
        assert!(
            refused.to_string().contains("insufficient lovelace"),
            "with {} tokens back: {refused:#}",
            tokens.len()
        );
        assert!(
            seedelf_cli::web_server::take_captured_cbor().is_none(),
            "nothing is served to sign"
        );
    }
}

/// The paying address is checked by its payment part alone: a key address
/// whose stake part is a script (`addr_test1y…`) signs with its payment key
/// like any other, so `fund` pays from it. It refused one as "Supplied
/// Address Is Incorrect", since Pallas's `has_script` counts the stake part
/// too (chunk 51, r2a#1).
#[tokio::test]
#[serial]
async fn fund_pays_from_a_key_address_staked_by_a_script() {
    let payer = external_address_staked_by_a_script();
    let from = payer.to_bech32().expect("bech32");
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
        .mount_address_utxos(vec![address_utxo(&from, 2, 10_000_000, &[])])
        .await;
    scenario.arm_web_capture();

    run(
        FundArgs {
            address: from,
            seedelf: SAMPLE_SEEDELF.to_string(),
            lovelace: Some(3_000_000),
            assets: vec![],
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("fund pays from a key address staked by a script");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.captured_cbor());
    assert_sound_transaction(&tx, &scenario, &params);
    assert_eq!(tx.outputs_to(&wallet_address()).len(), 1);
    assert_eq!(
        tx.outputs_to(&payer).len(),
        1,
        "change returns to the paying address"
    );
}
