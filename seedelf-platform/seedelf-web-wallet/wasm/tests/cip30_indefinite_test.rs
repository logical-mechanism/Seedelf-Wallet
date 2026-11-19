//! Chunk 51, gap-g8#5's class in WebAssembly: `attachWitnesses`, which adds
//! the wallet's signatures to a transaction someone else built (a session's
//! Minswap swap), read only a definite-length transaction list, witness set
//! and vkey list. The ledger reads either length, and hashes the body as
//! written, so one written indefinite (`9f … ff`, `bf … ff`) was refused here
//! ("a transaction is a list of four", "an indefinite-length witness set isn't
//! supported") though it's the ledger's. Each case asserts what the ledger
//! does: the body untouched, so the id holds, and every witness and datum kept.

use pallas_crypto::hash::Hasher;
use pallas_primitives::{Fragment, conway};
use seedelf_core::build;
use seedelf_wasm::cip30;

const TX_A: &str = "1111111111111111111111111111111111111111111111111111111111111111";

/// A vkey witness, `[vkey, signature]`, made of `n`: nothing here checks a signature.
fn witness(n: u8) -> String {
    format!("825820{}5840{}", hex::encode([n; 32]), hex::encode([n; 64]))
}

/// The body: one input, no outputs, no fee.
fn body() -> String {
    format!("a300818258 20{TX_A}00018002 00").replace(' ', "")
}

/// What the wallet makes of `tx` with the account's witness `2` added: its body's id, its vkeys' first bytes, and
/// whether it carries the datum `d87980` still.
fn attached(tx: &str, added: &str) -> Result<(String, Vec<u8>, bool), String> {
    let out = cip30::attach_witnesses(tx, added).map_err(|e| e.to_string())?;
    let bytes = hex::decode(&out).unwrap();
    let decoded = conway::Tx::decode_fragment(&bytes).map_err(|e| e.to_string())?;
    let vkeys = decoded
        .transaction_witness_set
        .vkeywitness
        .iter()
        .flat_map(|set| set.iter())
        .map(|w| w.vkey[0])
        .collect();
    let datum = decoded
        .transaction_witness_set
        .plutus_data
        .is_some_and(|set| {
            set.iter()
                .any(|d| hex::encode(d.encode_fragment().unwrap()) == "d87980")
        });
    Ok((hex::encode(build::tx_id(&bytes).unwrap()), vkeys, datum))
}

#[test]
fn witnesses_attach_to_a_transaction_written_with_indefinite_lengths() {
    let id = hex::encode(Hasher::<256>::hash(&hex::decode(body()).unwrap()));
    let (one, two) = (witness(1), witness(2));
    let added = format!("a10081{two}");
    let added_indefinite = format!("bf009f{two}ffff");
    let cases = [
        // Definite throughout, as before.
        format!("84{}a10081{one}f5f6", body()),
        // The transaction's list indefinite.
        format!("9f{}a10081{one}f5f6ff", body()),
        // Its witness set, and its vkey list, indefinite.
        format!("84{}bf009f{one}ffff f5f6", body()).replace(' ', ""),
    ];
    for tx in &cases {
        for added in [&added, &added_indefinite] {
            assert_eq!(
                attached(tx, added),
                Ok((id.clone(), vec![1, 2], false)),
                "{tx} + {added}"
            );
        }
    }
    // A datum the builder put in an indefinite witness set stays, under the hash its output names.
    let with_datum = format!("9f{}bf0081{one}0481d87980fff5f6ff", body());
    assert_eq!(
        attached(&with_datum, &added_indefinite),
        Ok((id.clone(), vec![1, 2], true))
    );

    // What isn't a transaction of four items still isn't: five, a list with no break, or bytes after the break.
    for broken in [
        format!("9f{}a10081{one}f5f6f6ff", body()),
        format!("9f{}a10081{one}f5f6", body()),
        format!("9f{}a10081{one}f5f6ff00", body()),
        format!("85{}a10081{one}f5f6f6", body()),
    ] {
        assert!(attached(&broken, &added).is_err(), "{broken}");
    }
}
