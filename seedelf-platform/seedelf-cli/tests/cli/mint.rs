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

/// A fresh minter (each `Scenario` has its own wallet scalar) mints a Seedelf
/// for the holder of `recipient`, given as `-g` and `-p`, from one owned UTxO
/// `n`: the minted Seedelf's datum, after checking the transaction conserves
/// value, keeps every output above its minimum, and gives the change back to
/// the minter.
async fn mint_for(
    recipient: &seedelf_crypto::register::Register,
    label: &str,
    n: u64,
) -> seedelf_crypto::register::Register {
    let mut scenario = Scenario::start().await;
    scenario
        .mount_credential_utxos(vec![wallet_utxo(scenario.scalar, n, 10_000_000, &[])])
        .await;
    scenario.mount_evaluate_mint(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    run(
        MintArgs {
            label: Some(label.to_string()),
            generator: Some(recipient.generator.clone()),
            public_value: Some(recipient.public_value.clone()),
            utxos: None,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect("util mint -g -p should succeed");

    let params = protocol_params().await;
    let tx = decode_tx(&scenario.submitted_cbor().await);
    assert_value_conserved(&tx, &scenario.ledger);
    assert_no_sub_min_outputs(&tx, &params);

    let policy = seedelf_policy();
    let minted: i128 = tx
        .mint
        .iter()
        .filter(|((p, _), _)| p == &policy)
        .map(|(_, qty)| *qty)
        .sum();
    assert_eq!(minted, 1, "exactly one Seedelf token is minted");

    let (seedelfs, change): (Vec<&DecodedOutput>, Vec<&DecodedOutput>) = tx
        .outputs_to(&wallet_address())
        .into_iter()
        .partition(|o| o.assets.keys().any(|(p, _)| p == &policy));
    assert_eq!(seedelfs.len(), 1, "one output holds the new Seedelf");
    assert_eq!(change.len(), 1, "one change output");
    let back = change[0]
        .register
        .as_ref()
        .expect("the change carries a Register");
    assert!(
        back.is_owned(scenario.scalar).expect("change ownership"),
        "the change goes back to the minter"
    );
    seedelfs[0]
        .register
        .clone()
        .expect("the Seedelf output carries a Register datum")
}

/// `util mint -g -p` mints a Seedelf for someone else under a fresh
/// re-randomization of the register they give, as `create` and `util mint`
/// without the flags do: still theirs (one scalar on both points), but no two
/// such mints share a datum, and none is their `util base` register, whose
/// generator is G1 itself. Written as given, every Seedelf minted for one
/// person from that register showed anyone they were one person's (chunk 51,
/// r4#8).
#[tokio::test]
#[serial]
async fn util_mint_for_someone_else_rerandomizes_the_register_given() {
    use seedelf_crypto::register::Register;
    // Alice's key, and what `util base` prints for her: `Register::create`.
    let alice = seedelf_crypto::schnorr::random_scalar();
    let base = Register::create(alice).expect("Alice's base register");
    let g1 = Register::create(blstrs::Scalar::from(1u64))
        .expect("G1")
        .generator;
    assert_eq!(base.generator, g1, "util base's generator is G1 itself");

    // Bob mints her a Seedelf from the register she gave him, then Carol does.
    let from_bob = mint_for(&base, "for alice", 1).await;
    let from_carol = mint_for(&base, "for alice too", 2).await;

    // Both before the fix and after: each is Alice's, and safe to pay.
    for (minter, datum) in [("Bob", &from_bob), ("Carol", &from_carol)] {
        assert!(
            datum.is_owned(alice).expect("ownership"),
            "{minter}'s mint must sit under a register Alice's key owns"
        );
        assert!(
            seedelf_core::build::is_payable(datum),
            "{minter}'s mint must sit under a payable register"
        );
    }

    assert_ne!(
        from_bob, base,
        "Bob's mint put Alice's base register on chain as given, not re-randomized"
    );
    assert_ne!(
        from_carol, base,
        "Carol's mint put Alice's base register on chain as given, not re-randomized"
    );
    assert_ne!(
        from_bob.generator, g1,
        "a Seedelf minted for someone else is marked by G1 as its generator"
    );
    assert_ne!(
        from_bob, from_carol,
        "two Seedelfs minted for Alice share one datum: anyone can see they're one person's"
    );
}
