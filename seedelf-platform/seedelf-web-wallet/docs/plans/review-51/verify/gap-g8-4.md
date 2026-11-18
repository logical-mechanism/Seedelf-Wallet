# gap-g8#4: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. A payment can pay at most 20 recipients, and that cap exists twice: in the extension (shared/recipients.ts:7, used by the form in Recipients.tsx:44/:116 and by the worker in send.ts:66, transfer.ts:86 and withdraw.ts:84) and in WebAssembly (lib.rs:1537-1547, called at :1678, :3038 and :3384). So the user can't add a 21st card, and the worker and WebAssembly each refuse one.

Nothing below the cap needs it:
- Core has no count rule. settle refuses only an output value over 5,000 bytes, a signed size over 16,384 bytes, or a fee over the maximum. Its TooLarge words already say "pay fewer recipients".
- Several recipients never go in parts: build_transfer_parts (:4606-4607, :4649) and build_withdraw_parts (:4724, :4793) split only a single payment.
- The deployed wallet validator (5b82530) checks only the proof and extra_signatories. It never reads outputs, so more recipients add no script cost.

My test asks for 25 different recipients at 2 ADA each, through the function each worker binding calls (buildAccountSend, buildTransferParts, buildWithdrawParts):
- On TREE, all 3 tests fail with WebAssembly's "A payment pays at most 20 recipients at once, not 25".
- In a copy where only lib.rs:1537 is raised to 100, all 3 pass. Each builds one transaction paying every recipient exactly 2 ADA: public Send 2,245 bytes, private Send 4,854 bytes, Make public 2,779 bytes, against the 16,384 limit. The private spends' compute fee is 86,241 lovelace for 3 script inputs with 26 outputs.

Grade: low.
- Who: the user, by an ordinary action, but only when paying more than 20 recipients at once, which is an edge case.
- Cost: the screen states the limit plainly, and the way out is to split the payment. That costs about 0.17 ₳ more on the public side (20+5 is about 0.239 + 0.182 ₳, against 0.254 ₳ in one transaction) and about 0.2 ₳ more on the private side (estimated). The second private spend may also wait a block if it spends the first one's change. No funds are at risk.

One nuance: the finder's line that two private spends are "tied by timing" adds no harm. One transaction paying them all already shows they were paid together (privacy.md, "Paying several recipients at once").

It's not known or settled. Nothing in the backlog, any review's Not fixed list or SECURITY.md covers it. The cap predates the owner's 2026-10-19 rule (refuse only what the ledger or the contracts refuse), and that rule points to lifting it. The fix still needs the owner, because it changes what three screens offer.

**Evidence:**

Trace, from where the input enters to the outcome (paths relative to TREE):

1. The form.
- Send (CardanoSend.tsx:342), private Send (Transfer.tsx:377) and Make public (Withdraw.tsx:365) all render AddRecipient and useRecipients from ui/components/Recipients.tsx.
- Recipients.tsx:44: `add: () => setDrafts((all) => (all.length < MAX_RECIPIENTS ? [...all, blank(next.current++)] : all))`.
- Recipients.tsx:116-117: `if (count >= MAX_RECIPIENTS) { return <p className="note center">{t("recipients.atMost", { number: MAX_RECIPIENTS })}</p>; }`.
- en.json:1664 "A payment pays at most {{number}} recipients."

2. The worker.
- send.ts:66, transfer.ts:86 and withdraw.ts:84 call `checkRecipients(payments.length)`.
- shared/recipients.ts:7 `export const MAX_RECIPIENTS = 20;` and :12 `if (count > MAX_RECIPIENTS) throw new Error(t("shared.recipients.tooMany", { max: MAX_RECIPIENTS }));`.
- The comment at recipients.ts:1-3 already says "core refuses a transaction over the network's 16 KiB whatever the count".

3. WebAssembly (seedelf-web-wallet/wasm/src/lib.rs).
- :1537 `pub const MAX_RECIPIENTS: usize = 20;` and :1543-1544 `if n > MAX_RECIPIENTS { bail!("A payment pays at most {MAX_RECIPIENTS} recipients at once, not {n}"); }`.
- It is called in three places:
  - :1678 account_send, behind buildAccountSend (:6578-6582).
  - :3038 transfer_plan, reached by buildTransferParts (:6664-6668) → build_transfer_parts → build_transfer (:4647) → transfer_plan (:3166).
  - :3384 withdrawal_of, behind buildWithdrawParts.

4. Core (seedelf-core/src/build.rs) has no count rule.
- account_send_many (:772-801) checks only that each payee is payable. account_payment (:844-956), payment_outputs (:3216-3253) and address_outputs (:3454-3463) have no count.
- settle (:253-285) refuses only these:
  - an output value over MAX_VALUE_SIZE, 5,000 bytes (:269-270);
  - a signed size over MAX_TX_SIZE, 16,384 bytes (:133, :272-275);
  - a fee over the maximum (check_fee).
- TooLarge's words (:169): "...Send fewer tokens, or pay fewer recipients, at once".

5. Several recipients are always one transaction.
- build_transfer_parts doc (:4606-4607): "Several Seedelfs at once go in one transaction, as before".
- :4649 `Err(e) if too_much(&e) && request.payments.len() == 1 => e`.
- build_withdraw_parts (:4724, :4793) does the same, or splits a funding.
- architecture.md:169: "Several recipients at once still go as one."

6. The contract. `git show 5b82530:seedelf-contracts/validators/wallet.ak` (:38-49) checks only `schnorr.prove(...)` and `list.has(transaction.extra_signatories, proof.vkh)`. It never reads outputs.

7. Already pinned: wasm/tests/api_test.rs:676-678 and :1751-1753 (literal "at most 20 recipients"), and extension/tests/send.test.ts:183-184.

Runs:
- On TREE: `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked -p seedelf-wasm --test r51_gap-g8_4 -- --nocapture`. All 3 fail at the cap (output in test_result).
- The same test in a copy: `$HOME/.cache/seedelf-review-51/gap-g8_4-trace`, via rsync, excluding target/node_modules/dist.
  - A diff against TREE shows only lib.rs:1537 changed (20 → 100).
  - It used its own CARGO_TARGET_DIR, gap-g8_4-trace-target.
  - All 3 pass, with the sizes and fees in test_result.
  - The copy and its target (1.5 GB) were removed afterwards.

Cost of splitting (estimates from the measured fees: 155,381 lovelace base + 44 per byte, plus compute and reference-script fees on the private side):
- Public, 20+5: about 0.239 + 0.182 ₳, against 0.254 ₳ in one transaction, so about 0.17 ₳ more.
- Private: about 0.2 ₳ more.

Rough headroom from the measured sizes: about 66 bytes per ADA-only address output and about 150 per Seedelf output. So on the order of 200 addresses or about 90 Seedelfs would fit one transaction.

TREE is unchanged: `git status` shows 0 modified tracked files. The test file is the only addition.

**Known:** None: it isn't known or settled.

Searched:
- docs/backlog.md: Declined, every ❓ and ⬜, the "Send and Make public" and "Smaller features" sections.
- docs/archive/plans/*.md: every review's Not fixed, Left open and For the owner lists, and the chunk plans.
- SECURITY.md, and the review-51 lanes and INDEX.md.
- Terms: MAX_RECIPIENTS, "20 recipients", "up to 20", "at most 20", recipients.atMost, tooMany, "several recipients", multi-send, "Add recipient", "pay fewer recipients", bulk, airdrop, batch.

The hits only describe the design:
- chunk-14-style-flow-2.md:32 is item 3, built 2026-09-24. Its "(the user's choice)" is attached to the screens staying separate and to Max paying one recipient, not to the number 20.
- flows.md:243 and :250, architecture.md:152 and seedelf-platform/CLAUDE.md:57 describe the cap.
- post-release-roadmap.md:61 marks the feature "matched" in the Lace parity table.
- Commit c3bc3930 gives no reason for 20.

Other lanes:
- X3.md:63 only notes that TS and WebAssembly agree on 20.
- W1b.md:73 lists check_recipients as a guard.

It isn't frozen code. The owner's rule of 2026-10-19 (refuse only what the ledger or the contracts refuse) supports the finding rather than settling it.

**Fix notes:**

Change both copies together: extension/src/shared/recipients.ts:7 and wasm/src/lib.rs:1537. Either raise the cap well past use (the finder's 100 keeps a sane card list), or drop the count and let core's settle refuse what doesn't fit (TooLarge, build.rs:169: "...pay fewer recipients, at once"). Recipients.tsx:44 and :116 follow the constant.

Rough room in one transaction, from the measured sizes: on the order of 200 ADA-only addresses, or about 90 Seedelfs. Tokens shrink that.

If a several-recipient payment can reach 16 KiB, it goes as one transaction, never in parts. The user would then see core's English TooLarge words: no extension string matches "network's limit", and short.ts's tooMany maps only the computation error. Give it a translated worker line, as worker.parts.tooMany is for computation.

Update the pins and the docs with it:
- Tests: wasm/tests/api_test.rs:678 and :1753 assert the literal "at most 20 recipients". extension/tests/send.test.ts:183-184 uses MAX_RECIPIENTS + 1, which is fine if a cap stays.
- Docs: flows.md:233, 243, 250, 372 and 396; architecture.md:152; seedelf-platform/CLAUDE.md:57.
- Strings: en/es/ja recipients.atMost and shared.recipients.tooMany. Drop them, or back-translate if the words change.

Needs the owner: it changes what Send, private Send and Make public offer, which is chunk 14's built design. My test passes unchanged once the cap is lifted, as the copy showed.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/wasm/tests/r51_gap-g8_4.rs`

Result: On TREE (from seedelf-platform: nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m cargo test -j 4 --locked -p seedelf-wasm --test r51_gap-g8_4 -- --nocapture):

running 3 tests
thread 'private_send_pays_25_seedelfs_in_one_transaction' panicked at seedelf-web-wallet/wasm/tests/r51_gap-g8_4.rs:222:29:
Send, 25 Seedelfs at 2 ADA from the private balance: A payment pays at most 20 recipients at once, not 25
test private_send_pays_25_seedelfs_in_one_transaction ... FAILED
thread 'make_public_pays_25_addresses_in_one_transaction' panicked at seedelf-web-wallet/wasm/tests/r51_gap-g8_4.rs:278:29:
Make public, 25 addresses at 2 ADA from the private balance: A payment pays at most 20 recipients at once, not 25
test make_public_pays_25_addresses_in_one_transaction ... FAILED
thread 'public_send_pays_25_addresses_in_one_transaction' panicked at seedelf-web-wallet/wasm/tests/r51_gap-g8_4.rs:178:29:
Send, 25 addresses at 2 ADA from the public account: A payment pays at most 20 recipients at once, not 25
test public_send_pays_25_addresses_in_one_transaction ... FAILED
test result: FAILED. 0 passed; 3 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.42s

In a copy where only wasm/src/lib.rs:1537 is changed to `MAX_RECIPIENTS: usize = 100` (same command, CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-51/gap-g8_4-trace-target; copy and target removed afterwards):

Make public: 25 recipients, 3 inputs, 26 outputs, 2779 bytes signed (limit 16384), fee 373334 (compute 86241)
test make_public_pays_25_addresses_in_one_transaction ... ok
private Send: 25 recipients, 3 inputs, 26 outputs, 4854 bytes signed (limit 16384), fee 464634 (compute 86241)
test private_send_pays_25_seedelfs_in_one_transaction ... ok
public Send: 25 recipients, 26 outputs, 2245 bytes signed (limit 16384), fee 254161
test public_send_pays_25_addresses_in_one_transaction ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.71s

```
//! Chunk 51, finding gap-g8#4: a payment pays at most 20 recipients, on
//! either side. WebAssembly's `MAX_RECIPIENTS` (20) is checked by
//! `check_recipients` in `account_send`, `transfer_plan` and `withdrawal_of`,
//! and the extension's `shared/recipients.ts` holds the same 20. Core has no
//! count rule: its `settle` refuses only a transaction over the ledger's
//! 16 KiB (`build::MAX_TX_SIZE`), and the deployed wallet validator never reads
//! a transaction's outputs, so more recipients add nothing to its scripts' cost.
//!
//! Each test asks for 25 recipients, each a different address or Seedelf, at
//! 2 ADA each, through the function the worker's binding calls
//! (`buildAccountSend`, `buildTransferParts`, `buildWithdrawParts`). Each
//! asserts the right behaviour: one transaction that pays every recipient
//! exactly what was asked and fits the ledger's size limit. They fail while
//! the cap is there.

use pallas_primitives::alonzo::{Constr, MaybeIndefArray, PlutusData};
use pallas_primitives::conway::DatumOption;
use pallas_traverse::MultiEraTx;
use seedelf_core::build::MAX_TX_SIZE;
use seedelf_crypto::cardano::{CardanoAccount, Role};
use seedelf_crypto::derivation::seedelf_key_v1;
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{InlineDatum, UtxoResponse};
use seedelf_wasm::api::{
    self, PathedUtxo, SeedelfPayment, SendPayment, SendRequest, TransferRequest, WithdrawPayment,
    WithdrawRequest,
};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/// More recipients than `api::MAX_RECIPIENTS` (20).
const RECIPIENTS: usize = 25;
/// What each recipient is paid.
const EACH: u64 = 2_000_000;
/// A private spend's `tx_cbor` is unsigned: giveme.my's and the one-time key's
/// witnesses add 2 × 101 bytes, and the witness set's key and array header.
const TWO_WITNESSES: u64 = 2 * 101 + 5;

fn fixture(path: &str) -> Value {
    let path = format!("{}/{path}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn params() -> Value {
    fixture("../../seedelf-core/tests/fixtures/epoch_params.json")[0].clone()
}

/// The 12-word phrase's real preprod UTxOs, each with its derivation path (as
/// api_test.rs's `account_utxos`): 10,350.54 ADA in 6 UTxOs.
fn account_utxos(account: &CardanoAccount) -> Vec<PathedUtxo> {
    let doc = fixture("../extension/tests/fixtures/koios-preprod.json");
    let stake = account.stake_address(true).unwrap().to_bech32().unwrap();
    let rows = doc["accounts"][&stake]["account_utxos"].as_array().unwrap().clone();
    let mut paths = Vec::new();
    for role in [Role::Receive, Role::Change] {
        for index in 0..20 {
            let addr = account.base_address(true, role, index).unwrap().to_bech32().unwrap();
            paths.push((addr, role as u32, index));
        }
    }
    rows.into_iter()
        .filter_map(|row| {
            let (_, role, index) = paths
                .iter()
                .find(|(a, _, _)| a == row["address"].as_str().unwrap())?;
            Some(PathedUtxo {
                utxo: serde_json::from_value(row).unwrap(),
                role: *role,
                index: *index,
            })
        })
        .collect()
}

/// Someone else's 25 receive addresses: the 15-word vector phrase's account.
fn their_addresses() -> Vec<String> {
    let doc = fixture("../../seedelf-crypto/tests/vectors/cardano_account.json");
    let phrase = doc["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["account"] == 0 && v["phrase"].as_str().unwrap().split(' ').count() == 15)
        .unwrap()["phrase"]
        .as_str()
        .unwrap()
        .to_string();
    let theirs = CardanoAccount::from_phrase(&phrase, 0).unwrap();
    (0..RECIPIENTS as u32)
        .map(|i| theirs.base_address(true, Role::Receive, i).unwrap().to_bech32().unwrap())
        .collect()
}

/// The private balance: four of the 12-word phrase's synthetic 25 ADA contract
/// UTxO (owned-utxos.json), 100 ADA under its own register.
fn private_balance() -> Vec<UtxoResponse> {
    let owned: Vec<UtxoResponse> = serde_json::from_value(
        fixture("../extension/tests/fixtures/owned-utxos.json")["owned_utxos"].clone(),
    )
    .unwrap();
    let base = owned.into_iter().next().unwrap();
    assert_eq!(base.value, "25000000");
    (0..4u64)
        .map(|i| UtxoResponse {
            tx_hash: format!("{:064x}", i + 1),
            ..base.clone()
        })
        .collect()
}

/// Someone else's Seedelf named `name`, under a fresh register of `key`: the
/// recorded preprod recipient's contract UTxO (transfer-preprod.json), renamed.
fn their_seedelf(name: &str, key: blstrs::Scalar) -> UtxoResponse {
    let register = Register::create(key).unwrap().rerandomize().unwrap();
    let mut utxo: UtxoResponse = serde_json::from_value(
        fixture("../extension/tests/fixtures/transfer-preprod.json")["recipient"].clone(),
    )
    .unwrap();
    utxo.asset_list.as_mut().unwrap()[0].asset_name = name.to_string();
    utxo.inline_datum = Some(InlineDatum {
        bytes: hex::encode(register.to_vec().unwrap()),
        value: json!({"constructor": 0, "fields": [
            {"bytes": register.generator}, {"bytes": register.public_value}]}),
    });
    utxo
}

fn register_from(datum: DatumOption) -> Register {
    let DatumOption::Data(data) = datum else {
        panic!("an inline datum")
    };
    let PlutusData::Constr(Constr { fields, .. }) = &data.0 else {
        panic!("a register is a constructor")
    };
    let fields = match fields {
        MaybeIndefArray::Def(v) | MaybeIndefArray::Indef(v) => v,
    };
    let bytes = |d: &PlutusData| match d {
        PlutusData::BoundedBytes(b) => hex::encode(b.as_slice()),
        _ => panic!("a point is bytes"),
    };
    Register::new(bytes(&fields[0]), bytes(&fields[1]))
}

/// What each output to `address` pays it.
fn paid_to(tx: &MultiEraTx, address: &str) -> Vec<u64> {
    tx.outputs()
        .iter()
        .filter(|o| o.address().unwrap().to_bech32().unwrap() == address)
        .map(|o| o.value().coin())
        .collect()
}

#[test]
fn public_send_pays_25_addresses_in_one_transaction() {
    let account = CardanoAccount::from_phrase(PHRASE, 0).unwrap();
    let to = their_addresses();
    let request = SendRequest {
        network: "preprod".into(),
        params: params(),
        utxos: account_utxos(&account),
        payments: to
            .iter()
            .map(|a| SendPayment {
                to: a.clone(),
                recipient: None,
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            })
            .collect(),
        withdrawal: None,
        note: None,
        invalid_hereafter: None,
    };
    let result = api::account_send(&account, request)
        .unwrap_or_else(|e| panic!("Send, {RECIPIENTS} addresses at 2 ADA from the public account: {e}"));
    assert_eq!(result.payments.len(), RECIPIENTS);
    let bytes = hex::decode(&result.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    for a in &to {
        assert_eq!(paid_to(&tx, a), vec![EACH], "{a}");
    }
    let size = bytes.len() as u64;
    println!(
        "public Send: {RECIPIENTS} recipients, {} outputs, {size} bytes signed (limit {MAX_TX_SIZE}), fee {}",
        tx.outputs().len(),
        result.fee
    );
    assert!(size <= MAX_TX_SIZE, "{size}");
}

#[test]
fn private_send_pays_25_seedelfs_in_one_transaction() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let keys: Vec<blstrs::Scalar> = (0..RECIPIENTS).map(|_| random_scalar()).collect();
    let payments = keys
        .iter()
        .enumerate()
        .map(|(i, key)| {
            let name = format!("5eed0e1f{:056x}", i + 1);
            SeedelfPayment {
                recipient: their_seedelf(&name, *key),
                to: name,
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            }
        })
        .collect();
    let request = TransferRequest {
        network: "preprod".into(),
        params: params(),
        utxos: private_balance(),
        payments,
        classes: Default::default(),
        carry: false,
        seed: None,
        evaluation: None,
    };
    let parts = api::build_transfer_parts(sk, request)
        .unwrap_or_else(|e| panic!("Send, {RECIPIENTS} Seedelfs at 2 ADA from the private balance: {e}"));
    assert_eq!(parts.len(), 1, "several recipients go as one transaction");
    let part = &parts[0];
    assert_eq!(part.payments.len(), RECIPIENTS);
    assert!(part.payments.iter().all(|p| !p.to_self && p.lovelace == EACH.to_string()));
    let bytes = hex::decode(&part.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let outs: Vec<(Register, u64)> = tx
        .outputs()
        .iter()
        .map(|o| (register_from(o.datum().unwrap().into()), o.value().coin()))
        .collect();
    // Each Seedelf once, under a fresh copy of its own register.
    for key in &keys {
        let paid: Vec<u64> = outs
            .iter()
            .filter(|(r, _)| r.is_owned(*key).unwrap())
            .map(|(_, l)| *l)
            .collect();
        assert_eq!(paid, vec![EACH]);
    }
    let size = bytes.len() as u64 + TWO_WITNESSES;
    println!(
        "private Send: {RECIPIENTS} recipients, {} inputs, {} outputs, {size} bytes signed (limit {MAX_TX_SIZE}), fee {} (compute {})",
        part.inputs.len(),
        tx.outputs().len(),
        part.fee.total,
        part.fee.compute
    );
    assert!(size <= MAX_TX_SIZE, "{size}");
}

#[test]
fn make_public_pays_25_addresses_in_one_transaction() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let to = their_addresses();
    let request = WithdrawRequest {
        network: "preprod".into(),
        params: params(),
        utxos: private_balance(),
        payments: to
            .iter()
            .map(|a| WithdrawPayment {
                to: a.clone(),
                lovelace: Some(EACH.to_string()),
                tokens: vec![],
            })
            .collect(),
        classes: Default::default(),
        funding: None,
        most: false,
        carry: false,
        seed: None,
        evaluation: None,
    };
    let parts = api::build_withdraw_parts(sk, request)
        .unwrap_or_else(|e| panic!("Make public, {RECIPIENTS} addresses at 2 ADA from the private balance: {e}"));
    assert_eq!(parts.len(), 1, "several recipients go as one transaction");
    let part = &parts[0];
    assert_eq!(part.payments.len(), RECIPIENTS);
    let bytes = hex::decode(&part.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    for a in &to {
        assert_eq!(paid_to(&tx, a), vec![EACH], "{a}");
    }
    let size = bytes.len() as u64 + TWO_WITNESSES;
    println!(
        "Make public: {RECIPIENTS} recipients, {} inputs, {} outputs, {size} bytes signed (limit {MAX_TX_SIZE}), fee {} (compute {})",
        part.inputs.len(),
        tx.outputs().len(),
        part.fee.total,
        part.fee.compute
    );
    assert!(size <= MAX_TX_SIZE, "{size}");
}
```
