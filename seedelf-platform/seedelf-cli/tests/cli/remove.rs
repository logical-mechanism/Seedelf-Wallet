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
    // remove evaluates two scripts: the spend and the burn, as Ogmios labels them.
    scenario.mount_evaluate_mint(1).await;
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

/// A `remove` scenario with everything a burn needs mounted, the Seedelf
/// under `owner`'s register (the wallet's own when `None`), paying
/// `address`: the run's refusal, and how often it evaluated and sent.
async fn remove_refused(
    owner: Option<blstrs::Scalar>,
    address: String,
) -> (anyhow::Error, usize, usize) {
    let mut scenario = Scenario::start().await;
    let owner = owner.unwrap_or(scenario.scalar);
    scenario
        .mount_credential_utxos(vec![seedelf_utxo(owner, 1, 5_000_000, SAMPLE_SEEDELF)])
        .await;
    scenario.mount_evaluate_mint(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;
    let refused = run(
        RemoveArgs {
            seedelf: SAMPLE_SEEDELF.to_string(),
            address,
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("remove is refused");
    (
        refused,
        scenario.requests_to("/api/v1/ogmios").await,
        scenario.requests_to("/api/v1/submittx").await,
    )
}

/// A Seedelf under another key's register is refused before anything is
/// proven, evaluated or sent: the contract would refuse the proof anyway,
/// in a script error (chunk 51, t1b#8).
#[tokio::test]
#[serial]
async fn remove_refuses_a_seedelf_this_wallet_doesnt_own() {
    let someone_else = seedelf_crypto::schnorr::random_scalar();
    let (refused, evaluated, sent) =
        remove_refused(Some(someone_else), external_address_bech32()).await;
    assert!(
        refused.to_string().contains("isn't this wallet's"),
        "{refused:#}"
    );
    assert_eq!((evaluated, sent), (0, 0), "nothing is evaluated or sent");
}

/// The burned Seedelf's ADA goes only to an address on this network that a
/// payment can go to: core pays `remove`'s change unchecked, and a stake or
/// other-network address takes nothing (chunk 51, t1b#9).
#[tokio::test]
#[serial]
async fn remove_refuses_to_pay_a_stake_or_other_network_address() {
    for address in not_payable_addresses() {
        let (refused, evaluated, sent) = remove_refused(None, address.clone()).await;
        assert!(
            refused
                .to_string()
                .contains("Supplied Address Is Incorrect"),
            "{address}: {refused:#}"
        );
        assert_eq!(
            (evaluated, sent),
            (0, 0),
            "{address}: nothing is evaluated or sent"
        );
    }
}

/// The burned Seedelf's ADA goes to a key address staked by a script, and to
/// a script's address, as the ledger takes both, with no datum: `remove`
/// refused them as "Supplied Address Is Incorrect" (chunk 51, r2a#1; a
/// script's gets a warning, the owner's call of 2026-11-18).
#[tokio::test]
#[serial]
async fn remove_pays_a_key_address_staked_by_a_script_and_a_scripts_address() {
    for to in [external_address_staked_by_a_script(), a_multisig_address()] {
        let mut scenario = Scenario::start().await;
        scenario
            .mount_credential_utxos(vec![seedelf_utxo(
                scenario.scalar,
                1,
                5_000_000,
                SAMPLE_SEEDELF,
            )])
            .await;
        scenario.mount_evaluate_mint(1).await;
        scenario.mount_collateral().await;
        scenario.mount_submit().await;
        run(
            RemoveArgs {
                seedelf: SAMPLE_SEEDELF.to_string(),
                address: to.to_bech32().expect("bech32"),
            },
            PREPROD,
            VARIANT,
        )
        .await
        .unwrap_or_else(|e| panic!("{to:?}: {e:#}"));
        let tx = decode_tx(&scenario.submitted_cbor().await);
        let paid: Vec<bool> = tx.outputs_to(&to).iter().map(|o| o.has_datum).collect();
        assert_eq!(paid, vec![false], "{to:?}: one output, with no datum");
    }
}

/// A Seedelf token sent to the KEY address carrying the contract's hash comes
/// with the contract's rows, but no key can spend from there: `remove` says
/// the Seedelf isn't on chain, where it built a spend the node refused
/// (chunk 51, x2#2).
#[tokio::test]
#[serial]
async fn remove_finds_no_seedelf_at_the_key_address_carrying_the_contracts_hash() {
    let mut scenario = Scenario::start().await;
    let mut held = seedelf_utxo(scenario.scalar, 1, 5_000_000, SAMPLE_SEEDELF);
    held.address = key_address_with_the_contracts_hash();
    scenario.mount_credential_utxos(vec![held]).await;
    scenario.mount_evaluate_mint(1).await;
    scenario.mount_collateral().await;
    scenario.mount_submit().await;

    let refused = run(
        RemoveArgs {
            seedelf: SAMPLE_SEEDELF.to_string(),
            address: external_address_bech32(),
        },
        PREPROD,
        VARIANT,
    )
    .await
    .expect_err("no Seedelf at the contract");
    assert!(
        refused.to_string().contains("not found on chain"),
        "{refused:#}"
    );
    assert_eq!(
        scenario.requests_to("/api/v1/submittx").await,
        0,
        "nothing is sent"
    );
}
