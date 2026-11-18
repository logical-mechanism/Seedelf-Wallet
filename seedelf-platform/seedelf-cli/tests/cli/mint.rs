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
    scenario.mount_evaluate_mint(1).await;
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

/// `util mint -g <generator> -p <public value>` with everything a mint needs
/// mounted: its refusal, and how often it evaluated and sent.
async fn mint_under(generator: String, public_value: String) -> (anyhow::Error, usize, usize) {
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, 1, 10_000_000, &[])])
        .await;
    scenario.mount_evaluate_mint(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;
    let refused = run(
        MintArgs {
            label: Some("someone".to_string()),
            generator: Some(generator),
            public_value: Some(public_value),
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("a mint under that register is refused");
    (
        refused,
        scenario.requests_to("/api/v1/ogmios").await,
        scenario.requests_to("/api/v1/submittx").await,
    )
}

/// A register given with `-g`/`-p` whose points aren't points of the group is
/// refused by `util mint`'s own check, before anything is evaluated or sent
/// (chunk 51, t1b#10): a Seedelf under it, and anything paid to it, would be
/// locked for good. Core's mint refuses it too, in its own words.
#[tokio::test]
#[serial]
async fn util_mint_refuses_a_register_that_isnt_made_of_points() {
    let good = owned_register(seedelf_crypto::schnorr::random_scalar());
    // Both flag bits set, and more: no point's encoding.
    let bad = "ff".repeat(48);
    for (generator, public_value, which) in [
        (bad.clone(), good.public_value.clone(), "generator"),
        (good.generator.clone(), bad.clone(), "public value"),
    ] {
        let (refused, evaluated, sent) = mint_under(generator, public_value).await;
        assert!(
            refused
                .to_string()
                .contains(&format!("Failed to decompress {which}")),
            "the CLI's own check refuses a {which} that isn't a point: {refused:#}"
        );
        assert_eq!(
            (evaluated, sent),
            (0, 0),
            "{which}: nothing is evaluated or sent"
        );
    }
}

/// A register with the identity for either point is made of points, so the
/// CLI's check takes it, and core's mint refuses it (chunk 51, t1b#10): under
/// (g, identity) the Seedelf, and whatever is paid to it, would be anyone's
/// (u = g^0), and under the identity generator no one's, for good.
#[tokio::test]
#[serial]
async fn util_mint_refuses_an_identity_register() {
    let good = owned_register(seedelf_crypto::schnorr::random_scalar());
    let identity = format!("c0{}", "00".repeat(47));
    for (generator, public_value) in [
        (good.generator.clone(), identity.clone()),
        (identity.clone(), good.public_value.clone()),
        (identity.clone(), identity.clone()),
    ] {
        let (refused, evaluated, sent) = mint_under(generator.clone(), public_value.clone()).await;
        assert!(
            refused.to_string().contains("isn't made of valid points"),
            "({generator}, {public_value}): {refused:#}"
        );
        assert_eq!((evaluated, sent), (0, 0), "nothing is evaluated or sent");
    }
}
