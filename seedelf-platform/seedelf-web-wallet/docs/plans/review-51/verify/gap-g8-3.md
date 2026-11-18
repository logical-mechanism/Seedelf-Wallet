# gap-g8#3: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

I couldn't refute it. The finding holds as described. The only things stopping a longer note are the 64 cap itself, in the UI (CardanoSend.tsx NOTE_MAX) and in core (note.rs MAX_NOTE_CHARS). No other check exists on the path, and nothing downstream needs a short note:
- The worker and WebAssembly pass the text straight to Note::new.
- `split` already makes lines of at most 64 bytes.
- `settle` prices every draft with the note patched in, and refuses only past 16 KiB.
- The ledger checks only that each metadata text is at most 64 bytes, and puts no bound on how many there are.
- The wallet itself already writes two-line messages: non-ASCII notes over 64 bytes, checked on preprod by probe-note.mjs.
- Its own Activity reads other wallets' notes of up to 500 characters (activity.ts:683).

My test asks for a 120-character reference to go on a send whole. It fails on TREE at Note::new with "A note is at most 64 characters, not 120". In a copy with the cap raised to 256 it passes, as two lines of 59 and 60 bytes, a 461-byte signed transaction and a fee at the ledger's formula.

The cap isn't settled. It's a documented chunk-14 design ("Lace's limit", flows.md:234, architecture.md:125), pinned by note_test.rs:107-124 and e2e/extension.spec.ts:4916-4920. No backlog line, Not-fixed entry or owner call covers it, and it predates the owner's 2026-10-19 rule that the wallet refuses only what the ledger refuses.

Grade: low.
- Who: the user, by an ordinary paste.
- Cost: no money, just a payment reference cut short. The cut is announced, but its words wrongly say 64 is "the most a note can hold".
- Way out: shorten the note, or use another wallet.

One small error in the finding: it puts the fee at "about 0.0053 ₳ for 120 bytes". The real cost is 167 bytes = 7,348 lovelace ≈ 0.0073 ₳ in all, about 0.0025 ₳ more than a 64-character note. That doesn't change the finding.

**Evidence:**

Trace, where the input enters to where it comes out (TREE = Seedelf-Wallet-chunk51; code under review = 1.9.1, identical here):

1. UI. extension/src/ui/screens/CardanoSend.tsx:51-52 has `const NOTE_MAX = 64;`. Its onChange at :363-367 does `const chars = [...e.target.value]; setNoteCut(chars.length > NOTE_MAX); setNote(chars.slice(0, NOTE_MAX).join(""))`, and :380-384 shows send.note.cut. en.json:1784 is "Cut to {{max}} characters, the most a note can hold." (es and ja say the same). Review at :141 calls `call("send-build", { payments, note: note.trim() || undefined })`. Pinned by e2e/extension.spec.ts:4918-4920: fill "x"×80, value "x"×64, then "Cut to 64 characters, the most a note can hold."
2. Worker. background/handlers.ts:233-234 calls `ctx.send.build(ctx.network, message.payments, message.note, ctx.progress)`. In background/send.ts, :60-76 build goes to pay(..., note), and :130-138 passes `note: note || undefined` into the request for wasm.buildAccountSend. Nothing on the way checks the length.
3. WebAssembly. wasm/src/lib.rs:1698 is `let note = Note::new(request.note.as_deref().unwrap_or(""))?;`, then :1701 calls build::account_send_many(..., note.as_ref(), ...).
4. Core. seedelf-core/src/note.rs:23 is `pub const MAX_NOTE_CHARS: usize = 64;` ("one of CIP-20's lines, as Lace allows"). :45-47 refuses any control character ("A note is one line of text, with no tabs or line breaks"). :48-51 refuses anything over 64 characters ("A note is at most {MAX_NOTE_CHARS} characters, not {chars}"). :108-125 `split` already cuts any text into lines of at most 64 bytes, at a space where it can. Pinned by tests/note_test.rs:107-124 (asserts "A note is at most 64 characters, not 65").
5. Fee and size. build.rs:796 passes `Patches { staking, note }` to account_payment. :1021 runs `settle(signers, patches, price, ...)`, and :287-295 signed_size builds each draft with built_with(staged, patches) (:298), so the fee pays for the note's bytes whatever their length. :273-275 refuses only past MAX_TX_SIZE (16,384). The final transaction is built_with(staged, patches) at :1064.
6. Ledger (cardano-ledger conway-1.19, local copy in the 1.8.1 review scratch):
   - libs/cardano-ledger-core/src/Cardano/Ledger/Metadata.hs:79-91: `validMetadatum (S s) = BS.length (T.encodeUtf8 s) <= 64`, `validMetadatum (List xs) = all validMetadatum xs`. Lists have no length bound.
   - Shelley/TxAuxData.hs:103 and Alonzo/TxAuxData.hs:321 apply `all validMetadatum metadata`. Shelley/Rules/Utxow.hs:460: `failureUnless (validateTxAuxData pv md') InvalidMetadata`.
   - So a msg of two 64-byte lines is valid.
7. The wallet's own evidence:
   - tests/fixtures/probe-note.mjs:52-55 checked a two-line note against preprod's node decoder.
   - background/activity.ts:683-695 reads received notes of up to 500 characters, lines joined.

Runs (only my test):
- TREE: `cargo test -j 4 --locked -p seedelf-core --test r51_gap-g8_3` fails, panicking at r51_gap-g8_3.rs:90:10: "a 120-character note fits CIP-20's msg as two 64-byte lines: A note is at most 64 characters, not 120". Result: 0 passed; 1 failed.
- Copy under ~/.cache/seedelf-review-51, own CARGO_TARGET_DIR, with only note.rs:23 changed to 256: my test passes. Output: "lines ["Invoice 2026-118 for October: 14 hours of design work at 85", "EUR, purchase order PO-77341, client ref ACME/NL/042. Thanks"], signed size 461 bytes, fee 175665 lovelace" (= 44×461+155381).
- In the same copy, note_test's a_note_is_one_line_of_at_most_64_characters and a_note_over_64_bytes_is_split_into_lines_that_fit fail. They pin the cap, so a fix must update them.
- The copy and its target dir were removed afterwards.

Cost: the note adds 167 bytes (a 35-byte body hash plus 133 bytes of auxiliary data), 7,348 lovelace. A 64-character note adds 110 bytes, 4,840 lovelace, which matches flows.md:234's 0.00484 ₳.

**Known:** Not known.
- docs/backlog.md: searched for MAX_NOTE, note.cut, NOTE_MAX, CIP-20, msg, 674, "64 characters", "Lace's", "note box/field" and "Send's note". Nothing. Line 193 ("Cardano parity with Lace's extension is closed") is about which features to build, not this limit.
- docs/archive/plans/: chunk-14-style-flow-2.md:36 is the design ("one line of at most 64 characters (Lace's limit)", Claude's decision on the owner's ask for "a note on a payment, as Lace's 'Add a note' and Eternl's message"), and :50 is a UTF-16 fix. usability-review.md:428 / PY-12 (:1105) only added the cut's notice. No Not-fixed, Left-open, Disputed or For-the-owner entry.
- The design is documented in flows.md:234 and architecture.md:125.
- Owner's memory: grep for CIP-20, MAX_NOTE, "64 char" and "label 674" finds only web-wallet-branching.md:52 (item 7 built). The owner never decided the length.
- The 2026-10-19 rule (no-paternalistic-guards: "the wallet refuses only what the ledger/contracts refuse") came later than this design.
- SECURITY.md's out-of-scope list doesn't cover it.
- review-51 lanes: no duplicate. E9a lists the code-point cut as checked_ok.

**Fix notes:**

The owner decides: this changes what Send's note box accepts.

The fix:
- Raise core's MAX_NOTE_CHARS (note.rs:23) and the UI's NOTE_MAX (CardanoSend.tsx:52) together. 500 would match what Activity keeps of a received note (activity.ts:683). Or drop the count and let settle's 16 KiB TooLarge refuse in words. Keep the counter and the "anyone can read it" line.
- If the owner keeps 64, reword send.note.cut in en, es and ja, which today says 64 is "the most a note can hold", and back-translate it.

What else changes with the cap:
- seedelf-core/tests/note_test.rs:107-146: both tests fail with a raised cap.
- e2e/extension.spec.ts:4916-4920 ("10/64", the 80→64 cut, the cut's words).
- The doc comments: CardanoSend.tsx:6-7 and :51, wasm/src/lib.rs:1563-1564, note.rs:22 and :29.
- docs/flows.md:234 and docs/architecture.md:125.

Two things to know:
- A long note with no spaces, such as a hash, is cut between characters every 64 bytes. Readers that join lines with a space (this wallet's activity.ts:692, as note.rs:63-65 says) will show a space inside it. Today only non-ASCII notes over 64 bytes hit this; a raised cap makes it reachable for ASCII too.
- The same family: core also refuses tabs and line breaks (note.rs:45-47), which the ledger takes in metadata text. Line breaks could become CIP-20 lines instead, as the finder suggests.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-core/tests/r51_gap-g8_3.rs`

Result: On TREE, from seedelf-platform: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked -p seedelf-core --test r51_gap-g8_3`, exit 101:

running 1 test
test a_120_character_note_goes_on_a_send_whole_in_lines_the_ledger_takes ... FAILED
---- a_120_character_note_goes_on_a_send_whole_in_lines_the_ledger_takes stdout ----
thread '...' panicked at seedelf-core/tests/r51_gap-g8_3.rs:90:10:
a 120-character note fits CIP-20's msg as two 64-byte lines: A note is at most 64 characters, not 120
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

As a check that it passes once fixed: in a copy (~/.cache/seedelf-review-51/verify-gap-g8_3-trace, own CARGO_TARGET_DIR, since removed) with only note.rs:23 changed to `MAX_NOTE_CHARS: usize = 256`, the same test passes, exit 0:

120-character note: lines ["Invoice 2026-118 for October: 14 hours of design work at 85", "EUR, purchase order PO-77341, client ref ACME/NL/042. Thanks"], signed size 461 bytes, fee 175665 lovelace
test a_120_character_note_goes_on_a_send_whole_in_lines_the_ledger_takes ... ok
test result: ok. 1 passed; 0 failed

In that copy, note_test.rs's a_note_is_one_line_of_at_most_64_characters (:116) and a_note_over_64_bytes_is_split_into_lines_that_fit (:140) fail. They pin the 64 cap by building their inputs from MAX_NOTE_CHARS.

```
//! Chunk 51, gap-g8#3: a note longer than 64 characters. The ledger holds
//! each metadata text to 64 bytes and nothing more (cardano-ledger's
//! `validMetadatum`: `S s` at most 64 bytes, a `List` of any length), so
//! CIP-20's `msg` takes as many 64-byte lines as the transaction's 16 KiB
//! holds. Core already cuts a note into such lines (`note.rs` `split`), and
//! `settle` prices every draft with the note patched in. So a 120-character
//! payment reference should go on a send whole, as two lines that fit, with
//! a fee that pays for them. Today `Note::new` refuses it.

use pallas_addresses::Address;
use pallas_crypto::hash::Hasher;
use pallas_primitives::{Metadatum, Nullable};
use pallas_traverse::MultiEraTx;
use seedelf_core::build::{
    self, AccountAmount, AccountPay, MAX_TX_SIZE, Payee, fake_signer, tx_id,
};
use seedelf_core::note::{NOTE_LABEL, Note};
use seedelf_core::staking::Staking;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// A payment reference a user might paste: 120 characters, all ASCII.
const REFERENCE: &str = "Invoice 2026-118 for October: 14 hours of design work at 85 EUR, purchase order PO-77341, client ref ACME/NL/042. Thanks";

fn params() -> ProtocolParameters {
    let rows: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/epoch_params.json")).unwrap();
    ProtocolParameters::from_koios(&rows[0]).unwrap()
}

fn utxo(account: &CardanoAccount, lovelace: u64) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([7u8; 32]),
        tx_index: 0,
        address: account
            .base_address(true, Role::Receive, 0)
            .unwrap()
            .to_bech32()
            .unwrap(),
        value: lovelace.to_string(),
        payment_cred: hex::encode(account.key_hash(Role::Receive, 0).unwrap()),
        asset_list: Some(vec![]),
        ..Default::default()
    }
}

/// CIP-20's lines under label 674, and whether the body's hash of the
/// auxiliary data matches its bytes.
fn message_of(bytes: &[u8]) -> (Vec<String>, bool) {
    let tx = MultiEraTx::decode(bytes).unwrap();
    let conway = tx.as_conway().unwrap();
    let Nullable::Some(raw) = &conway.auxiliary_data else {
        panic!("no auxiliary data");
    };
    let hash = conway
        .transaction_body
        .auxiliary_data_hash
        .as_ref()
        .unwrap();
    let matches = hash.to_vec() == Hasher::<256>::hash(raw.raw_cbor()).to_vec();
    let Some(Metadatum::Map(message)) = tx.metadata().find(NOTE_LABEL).cloned() else {
        panic!("no message under 674");
    };
    let lines = message
        .iter()
        .find(|(k, _)| *k == Metadatum::Text("msg".to_string()))
        .map(|(_, v)| match v {
            Metadatum::Array(lines) => lines
                .iter()
                .map(|l| match l {
                    Metadatum::Text(t) => t.clone(),
                    other => panic!("a line that isn't text: {other:?}"),
                })
                .collect(),
            other => panic!("msg isn't a list: {other:?}"),
        })
        .unwrap();
    (lines, matches)
}

#[test]
fn a_120_character_note_goes_on_a_send_whole_in_lines_the_ledger_takes() {
    assert_eq!((REFERENCE.chars().count(), REFERENCE.len()), (120, 120));

    // The ledger takes it: two of CIP-20's lines, each at most 64 bytes.
    let note = Note::new(REFERENCE)
        .expect("a 120-character note fits CIP-20's msg as two 64-byte lines")
        .expect("not empty");
    assert_eq!(note.text(), REFERENCE, "the review shows the whole reference");
    assert!(note.lines().len() >= 2, "{:?}", note.lines());
    assert!(
        note.lines().iter().all(|l| !l.is_empty() && l.len() <= 64),
        "each line within the ledger's 64 bytes: {:?}",
        note.lines()
    );
    assert_eq!(
        note.lines().join(" "),
        REFERENCE,
        "cut only at spaces, so a reader rejoins it whole"
    );

    // On a send: the lines under 674's msg, the body's hash of them, the
    // transaction's hash, a fee that pays for them, and under 16 KiB.
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let to: Address = CardanoAccount::from_phrase(PHRASE, 1)
        .unwrap()
        .base_address(true, Role::Receive, 0)
        .unwrap();
    let params = params();
    let built = build::account_send_many(
        &params,
        &[utxo(&account, 20_000_000)],
        &[AccountPay::new(
            Payee::Address(&to),
            AccountAmount::Lovelace(5_000_000),
            &[],
        )],
        true,
        &account.base_address(true, Role::Receive, 0).unwrap(),
        &Staking::none(),
        Some(&note),
        None,
    )
    .expect("a send carrying the 120-character note builds");

    let (lines, hash_matches) = message_of(&built.tx.tx_bytes.0);
    assert_eq!(lines, note.lines(), "the transaction carries every line");
    assert!(
        hash_matches,
        "the body carries the hash of the note's bytes"
    );
    assert_eq!(built.tx.tx_hash.0, *tx_id(&built.tx.tx_bytes.0).unwrap());

    let signed = built.tx.clone().sign(fake_signer()).unwrap();
    let size = signed.tx_bytes.0.len() as u64;
    assert!(size <= MAX_TX_SIZE, "{size} bytes");
    let minimum = params.min_fee_a * size + params.min_fee_b;
    assert!(built.fee >= minimum, "fee {} < {minimum}", built.fee);
    assert!(built.fee < minimum + 1_000);
    assert_eq!(built.change_lovelace, 20_000_000 - 5_000_000 - built.fee);
    eprintln!(
        "120-character note: lines {:?}, signed size {size} bytes, fee {} lovelace",
        note.lines(),
        built.fee
    );
}
```
