//! The one-time key every Seedelf spend is signed with (spend.rs). The
//! deployed contract takes a proof whose key's hash is among the
//! transaction's signers (5b82530 wallet.ak), so a fresh, secret key for each
//! spend is the whole defence against replay: a key anyone could derive would
//! let anyone who sees a pending or rolled-back spend copy its proofs into a
//! transaction paying themselves (chunk 51, t1b#12).

use serial_test::serial;

use seedelf_cli::commands::transfer::{TransforArgs, run};
use seedelf_crypto::schnorr::random_scalar;

use crate::harness::*;

/// Two transfers, each spending two of the wallet's UTxOs: each is signed by
/// a one-time key of its own, every input's proof names that key and
/// verifies, and the two keys differ.
#[tokio::test]
#[serial]
async fn every_spend_is_signed_and_proven_by_a_fresh_one_time_key() {
    let mut keys = Vec::new();
    for _ in 0..2 {
        let mut scenario = Scenario::start().await;
        scenario
            .mount_credential_utxos(vec![
                wallet_utxo(scenario.scalar, 1, 10_000_000, &[]),
                wallet_utxo(scenario.scalar, 2, 10_000_000, &[]),
                seedelf_utxo(random_scalar(), 3, 1_500_000, SAMPLE_SEEDELF),
            ])
            .await;
        scenario.mount_evaluate(2).await;
        scenario.mount_collateral().await;
        scenario.mount_submit().await;

        // 12 ADA: both UTxOs are spent, so both are proven.
        run(
            TransforArgs {
                seedelfs: vec![SAMPLE_SEEDELF.to_string()],
                lovelaces: Some(vec![12_000_000]),
                assets: vec![],
                utxos: None,
            },
            PREPROD,
            VARIANT,
        )
        .await
        .expect("transfer should succeed");

        let cbor = scenario.submitted_cbor().await;
        assert_eq!(decode_tx(&cbor).inputs.len(), 2, "both UTxOs are spent");
        keys.push(one_time_key_of(&cbor, &scenario.ledger));
    }
    assert_ne!(keys[0], keys[1], "each spend's one-time key is its own");
}
