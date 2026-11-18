# r2money#1: verification

From lane R2money, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and my run matches the finder's figures to the lovelace. When a session has lost its 5 ₳, `session_collateral` falls back to the largest ADA-only UTxO of 2 ₳ or more. `plan_return` then chooses the merged form. For a heavy return, 3/2 of the fee takes that collateral's return under an output's least, and since 21caa3b8 core refuses the build. Nothing then re-plans with no merge: `built_or_without_strangers` has no strangers to drop, and the worker rethrows anything that isn't TOO_LITTLE. Yet the plain sweep of the same UTxOs builds, with no script and no collateral. The figures: least 978,370; merged fee 747,574; a 2 ₳ collateral would come back as 878,639; sweep fee 689,629, every UTxO taken. The wallet refuses a return the ledger would take.

Two corrections to the finder:
1. **The way out is wider than they say.** On a site's session page, Top up (while its site still uses the session) adds a fresh 5 ₳ whenever none fits (sessions.ts:2405-2413). `session_collateral` then prefers that 5 ₳, and the merged return builds. Any ADA-only UTxO of at least least + 3/2 × fee (about 2.1 ₳ here) also works, because the fallback takes the largest. The page shows and copies the session's address (SiteSessions.tsx:394-433), so a payment from anywhere also works when Top up is off for a detached site. What's missing is a pointer: the refusal reaches the page in core's English, "The collateral can't cover this transaction's fee and come back as an output". The by-hand 5 ₳ offer (`backCollateralBuild`) never applies here, because `byHand` excludes site sessions (sessions.ts:1288).
2. **Since:** the 2 ₳ fallback and a merged plan with no sweep fallback date from 7db81171 (chunk 16, 2026-09-25), in every tag from web-wallet/1.6.0 to 1.9.1. 1.9.1 signed this merged return and the node refused it at submit for the collateral return's minimum. 21caa3b8 only moved the refusal from submit to build. Neither version brings the money back.

Grade: the user reaches it, through a narrow edge case. All of these must hold at once:
- a site's transaction the user approved spent the session's 5 ₳ (dapp.ts only names that in the prompt);
- the return is heavy: the fee must pass (C − least) × 2/3 = 681,086, which means a merged transaction of about 11 KB with one merge (about 9 KB with four), on the order of 200 or more distinct tokens with long names;
- the largest ADA-only UTxO sits in [2 ₳, least + 3/2 × fee): [2, 2.0997) ₳ in this shape, and at most about [2, 2.48) ₳ at the 16 KiB ceiling;
- the funding's change is still unspent.

Nothing is lost or locked, and there's a way out, so this is low, not medium.

A stranger variant, traced but not run: an ADA-only row is never dropped as a stranger's. So a stranger's 2 ₳ ADA-only UTxO can turn such a heavy session, with no ADA-only of its own at 2 ₳ or more, from the sweep into the refused merge. It still needs the user's other preconditions, and the same way out applies.

The Lovejoin chain's return can't meet this. It merges only under `held.collateral`, the exact 5 ₳ (wasm lovejoin.rs:1949-1958, 1977-1993), and sweeps otherwise. lovejoin.rs:598 never merges. Not known: nothing in backlog.md, archive/plans, SECURITY.md, owner-calls.md or chunk 51's INDEX/FINDINGS covers it. gap-g4#2 assumes "the direct merge still goes" on the 2 ₳ fallback without the heavy-fee case.

**Evidence:**

Traced at FIXTREE HEAD 853d5779. lib.rs, build.rs and sessions.ts aren't modified in the working copy; I read them with `git show HEAD:`.

1. wasm/src/lib.rs:985-999 `session_collateral`: the exact 5 ₳ (`find(... == build::COLLATERAL_LOVELACE)`), else `.filter(|u| lovelace(u) >= 2_000_000).max_by_key(...)`. Only the 2 ₳ floor is checked, although the doc at :982-983 says it "leaves its return a valid output".
2. lib.rs:1190: `base` (merged) is set whenever `merge` isn't empty, every row is evaluable and `session_collateral(&measured)` is Some.
3. lib.rs:1437-1453: `attempt(None)` makes one plan and passes it to `built_or_without_strangers(plan, planned_return)`. There's no second plan with `merge = &[]`.
4. lib.rs:1479-1490 → `merged_return` → :1373-1375 `ScriptSpend::new(...).with_account(key, rows, collateral)` → `measure_locally`.
5. In core build.rs:
   - :1886-1890 `measuring_draft` calls `draft()` (:1796-1803), which calls `estimate()` (:1818-1827), which calls `settle` (:2019-2024).
   - The loop at :253-285 first stages at FIRST_DRAFT_FEE = 200,000: 2 ₳ − 300,000 clears the least.
   - It then stages at the priced fee, where `stage` (:2207-2213) runs `.checked_sub(fee * 3 / 2).filter(|back| *back >= least).context("... come back as an output")?`.
   - `is_short` (:2885-2887) only downcasts `NotEnough`, so the error goes out as is.
6. lib.rs:1321-1344: with `strangers == 0`, `without_strangers` gives None, and `None => return Err(e)` returns the refusal.
7. Worker, sessions.ts:
   - :4673: `merge = fundingChange(...)` (:5200-5218), the funding's change while it's still in the private balance.
   - :4913-4941 `build()`: `if (e instanceof WalletLocked || !TOO_LITTLE.test(message)) throw e;`. TOO_LITTLE (:1050) doesn't match the collateral's words, and no other attempt is made.
8. dapp.ts:1868-1880 `keptApart`: for a session holder it returns whether the 5 ₳ is among the inputs (`collateralSpent`) and never refuses.
9. Way out:
   - sessions.ts:2397-2414 `topUpBuild` (site sessions only): `fresh = !held.some(collateralFits)` adds a `SESSION_COLLATERAL` output.
   - SiteSessions.tsx:330-360: Top up is off only when the site is detached or the session is funding.
   - SiteSessions.tsx:394-433: the session's address, with a Copy button.
10. Since: `git blame` of lib.rs:985-999 points to 7db81171 (2026-09-25), contained in web-wallet/1.6.0 through 1.9.1. web-wallet/1.9.1's build.rs:2200 had only `.context("The collateral can't cover this transaction's fee")`, with no least check.
11. My test in FIXTREE (output in test_result) fails at the bug, after both controls pass: the sweep builds with every UTxO, and the merged form with 3 ₳ up builds with merged = 1.
12. In a copy outside FIXTREE (`$HOME/.cache/seedelf-review-51`, removed afterwards), I re-planned with `merge = &[]` in `attempt`:
   - with the guard `merged && !build::is_short(&e)`, my test passed ("built, fee 689629, merged 0, inputs 14"), but session_test.rs failed two pinned refusals: a_return_merges_into_the_funding_change_under_the_sessions_collateral (:365, a foreign merge row) and a_return_merges_into_four_of_the_fundings_changes_at_most (:400, t1e#14);
   - narrowed to `e.to_string().contains("can't cover this transaction's fee")`, three test files passed: r51_r2money_1 1/1, session_test 17 passed (1 ignored), return_cost_test 5/5.

**Known:** None: not settled or known. Searched:
- seedelf-web-wallet/docs/backlog.md: every collateral line; `session_collateral`, "largest ADA-only", "2 ₳ or more", merged return with collateral;
- docs/archive/plans/* (59 files): the same terms, and "funding's change" with collateral;
- SECURITY.md's out-of-scope list: it doesn't apply, since no data source lies and the fix is in our code;
- review-51's owner-calls.md, INDEX.md, FINDINGS.md, fixes/G1-G6.md and the other R2 lanes. gap-g4#2 (a swap spending the 5 ₳, the owner's call) is about the Lovejoin tail, and asserts the direct merge "still goes" on the 2 ₳ fallback without the heavy-fee case. e3a#2, e8b#1 and lead#1 are about which 5 ₳ is picked. R2still and R2docs only list build.rs:2210 as a guard.

Related, not a duplicate: r2money#2. That's the same least held at the estimate's guessed fee, a band just above where this one starts.

**Fix notes:**

**Class:** a plan picks a transaction form (merged) that its collateral can't carry, and nothing tries the other form (the sweep) that the ledger takes. This is a refusal the owner's rule says the wallet shouldn't make.

**Fix:** in `api::session_return`'s `attempt` (wasm lib.rs:1446-1452), when the merged plan's build fails because of the collateral, plan again with `merge = &[]` and build that (`external_sweep` via `planned_return`). `plan_return` already makes the same fallback for an unmeasurable row, and for a session with no collateral at all. Catch only that refusal: a typed error from core's `ScriptSpend::stage` (build.rs:2207-2213), for example a `CollateralShort` that WASM downcasts as `is_short` does `NotEnough`, rather than the words.
- Don't widen it to "any non-short error". In my copy that turned two pinned refusals into sweeps and failed session_test.rs:365 (a foreign merge row's "isn't this wallet's") and :400 (t1e#14, five merges).
- This one change also covers r2money#2's band (the least held at the estimate's guessed fee). The merged form fails there with the same error, and the sweep builds.

**Alternative:** `session_collateral`'s fallback could require at least least + 3/2 × the plan's fee (Draft::needs prices it) and report merged = false otherwise. It would have to price above the guess to cover r2money#2's band too.

**Other members, checked:** the Lovejoin chain's return (wasm lovejoin.rs:1949-1993) merges only under the exact 5 ₳ in `held.collateral`, and lovejoin.rs:598 never merges, so neither can meet this.

**Cost:** in this edge case the return makes new contract UTxOs instead of joining the funding's change, as it already does for unmeasurable rows. No default changes and no refusal is added, so it doesn't need the owner, though the owner may want to know.

**Optional, a screen's words (the owner's call):** a refusal that names Top up, which adds the 5 ₳ by itself (sessions.ts:2405-2413), would signpost the way out that exists today.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/wasm/tests/r51_r2money_1.rs`

Result: Run from FIXTREE/seedelf-platform: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --locked -p seedelf-wasm --test r51_r2money_1 -- --nocapture`. It FAILS today, at the bug's assertion, after both controls pass:

```
running 1 test
least 978370; sweep fee 689629; merged fee 747574, 3/2 of it 1121361; a 2 ₳ collateral would come back as 878639
merged into the funding's change, 2 ₳ up: refused: The collateral can't cover this transaction's fee and come back as an output

thread 'r51_r2money_1_a_merged_return_its_fallback_collateral_cant_cover_still_comes_back' (2942120) panicked at seedelf-web-wallet/wasm/tests/r51_r2money_1.rs:218:9:
the return is refused, though the plain sweep of the same UTxOs builds (fee 689629): The collateral can't cover this transaction's fee and come back as an output
test r51_r2money_1_a_merged_return_its_fallback_collateral_cant_cover_still_comes_back ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.61s
```

With the fix sketch in a removed copy (the re-plan guarded to the collateral's refusal), the same test passes ("merged into the funding's change, 2 ₳ up: built, fee 689629, merged 0, inputs 14 ... ok"). session_test.rs (17 passed, 1 ignored) and return_cost_test.rs (5 passed) also stay green there. This is a Rust-only finding, so no Vitest run applies (and so no VITE_ENABLE_MAINNET=false leg).

```
//! Chunk 51, r2money#1: a session's return merged into its funding's change,
//! whose only collateral is `session_collateral`'s fallback (the largest
//! ADA-only UTxO of 2 ₳ or more, the session's 5 ₳ being gone). A heavy
//! return's fee takes 3/2 of it past an output's least, so the merged form is
//! refused (21caa3b8's words), and nothing tries the plain sweep of the same
//! UTxOs, which runs no script, needs no collateral and builds.
//!
//! The right behaviour: the return still comes back, whole, in a transaction
//! the ledger takes. This test fails while `session_return` refuses it.

use pallas_addresses::Address;
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{self, SessionReturnRequest, SessionReturnResult};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";

fn accounts() -> CardanoAccount {
    CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap()
}

fn params() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

/// A UTxO at `address` as Koios lists it.
fn utxo(tx: u8, address: &Address, lovelace: u64, tokens: &[(String, u64)]) -> UtxoResponse {
    let assets: Vec<Value> = tokens
        .iter()
        .map(|(n, q)| json!({ "policy_id": POLICY, "asset_name": n, "quantity": q.to_string(), "decimals": 0, "fingerprint": "" }))
        .collect();
    serde_json::from_value(json!({
        "tx_hash": hex::encode([tx; 32]),
        "tx_index": 0,
        "address": address.to_bech32().unwrap(),
        "value": lovelace.to_string(),
        "stake_address": null,
        "payment_cred": "",
        "epoch_no": 0,
        "block_height": 0,
        "block_time": 0,
        "datum_hash": null,
        "inline_datum": null,
        "reference_script": null,
        "asset_list": assets,
        "is_spent": false,
    }))
    .unwrap()
}

/// The change the session's funding left in the private balance, under a
/// fresh copy of `sk`'s register: what a return merges into.
fn funding_change(sk: blstrs::Scalar, lovelace: u64) -> UtxoResponse {
    let wallet = wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let register = Register::create(sk).unwrap().rerandomize().unwrap();
    let mut row = utxo(0xf0, &wallet, lovelace, &[]);
    row.inline_datum = serde_json::from_value(json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
    .unwrap();
    row
}

/// What a site's session can hold after its 5 ₳ collateral was spent by a
/// site's transaction the user approved: 13 of the session's own UTxOs, each
/// 20 NFTs (32-byte names, as CIP-68's) and 6 ₳, which pays their deposit
/// outputs; and one ADA-only UTxO of `ada`, the only one, which is
/// `session_collateral`'s fallback when it's 2 ₳ or more. All of them are
/// the session's own (outputs of transactions its key signed).
fn account(at: &Address, ada: u64) -> (Vec<UtxoResponse>, Vec<String>) {
    let mut rows: Vec<UtxoResponse> = (0..13u8)
        .map(|i| {
            let nfts: Vec<(String, u64)> = (0..20u8)
                .map(|j| {
                    let mut name = [0x41u8; 32];
                    name[0] = i;
                    name[1] = j;
                    (hex::encode(name), 1)
                })
                .collect();
            utxo(0x10 + i, at, 6_000_000, &nfts)
        })
        .collect();
    rows.push(utxo(0xc0, at, ada, &[]));
    let own = rows.iter().map(|u| u.tx_hash.clone()).collect();
    (rows, own)
}

fn request(utxos: &[UtxoResponse], merge: &[UtxoResponse], own: &[String]) -> SessionReturnRequest {
    SessionReturnRequest {
        network: "preprod".into(),
        params: params(),
        index: 3,
        utxos: utxos.to_vec(),
        merge: merge.to_vec(),
        own: own.to_vec(),
        collateral_pool: None,
        collateral_boxes: vec![],
        rewards: Default::default(),
    }
}

/// The least an output of ADA alone holds at `at`.
fn least(at: &Address) -> u64 {
    let p = ProtocolParameters::from_koios(&params()).unwrap();
    seedelf_core::transaction::address_minimum_lovelace_with_assets(
        &p,
        &at.to_bech32().unwrap(),
        seedelf_core::assets::Assets::new(),
    )
    .unwrap()
}

/// That `built`'s transaction is one the ledger takes as to its collateral:
/// none (no script runs), or one that covers 3/2 of the fee and whose return
/// holds an output's least. Its fee.
fn collateral_holds(built: &SessionReturnResult, rows: &[UtxoResponse], least: u64) -> u64 {
    let bytes = hex::decode(&built.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let fee = tx.fee().unwrap();
    assert_eq!(fee.to_string(), built.fee);
    let put_up: u64 = tx
        .collateral()
        .iter()
        .map(|i| {
            rows.iter()
                .find(|u| u.tx_hash == hex::encode(**i.hash()) && u.tx_index == i.index())
                .expect("the collateral is one of the account's UTxOs")
                .value
                .parse::<u64>()
                .unwrap()
        })
        .sum();
    if put_up == 0 {
        assert!(tx.collateral_return().is_none());
        return fee;
    }
    let back = tx.collateral_return().map_or(0, |o| o.value().coin());
    assert!(
        back >= least,
        "the collateral comes back as {back} lovelace, under an output's least ({least}): the ledger refuses it"
    );
    assert!(
        2 * (put_up - back) >= 3 * fee,
        "the collateral covers 3/2 of the fee"
    );
    fee
}

#[test]
fn r51_r2money_1_a_merged_return_its_fallback_collateral_cant_cover_still_comes_back() {
    let accounts = accounts();
    let at = api::one_time_address(&accounts, true, 3).unwrap();
    let least = least(&at);
    let sk = random_scalar();
    let change = funding_change(sk, 10_000_000);

    // The account as the site left it: its only ADA-only UTxO is 2 ₳.
    let (rows, own) = account(&at, 2_000_000);

    // The plain sweep of these UTxOs builds: no script, no collateral, every UTxO in one transaction.
    let sweep = api::session_return(&accounts, sk, request(&rows, &[], &own))
        .expect("the plain sweep of the account's UTxOs builds");
    assert_eq!(sweep.merged, 0);
    assert_eq!(sweep.inputs, rows.len());
    assert!(sweep.left_out.is_empty());
    let sweep_fee = collateral_holds(&sweep, &rows, least);

    // The same account with a 3 ₳ ADA-only UTxO instead merges into the funding's change, under that collateral; its
    // fee takes 3/2 of a 2 ₳ one past an output's least, so 2 ₳ can't be this merged return's collateral.
    let (roomy, roomy_own) = account(&at, 3_000_000);
    let merged = api::session_return(&accounts, sk, request(&roomy, std::slice::from_ref(&change), &roomy_own))
        .expect("with 3 ₳ up, the merged return builds");
    assert_eq!(merged.merged, 1);
    let merged_fee = collateral_holds(&merged, &roomy, least);
    println!(
        "least {least}; sweep fee {sweep_fee}; merged fee {merged_fee}, 3/2 of it {}; a 2 ₳ collateral would come back as {}",
        merged_fee * 3 / 2,
        2_000_000i64 - (merged_fee * 3 / 2) as i64,
    );
    assert!(
        2_000_000 < least + merged_fee * 3 / 2,
        "the shape needs a merged return whose collateral a 2 ₳ one can't be"
    );

    // The bug: with the funding's change to merge into and only the 2 ₳ to put up, the return is refused, and nothing
    // falls back to the sweep that builds. Every Bring it back and every runner step is refused while this holds.
    let back = api::session_return(&accounts, sk, request(&rows, std::slice::from_ref(&change), &own));
    println!(
        "merged into the funding's change, 2 ₳ up: {}",
        match &back {
            Ok(b) => format!("built, fee {}, merged {}, inputs {}", b.fee, b.merged, b.inputs),
            Err(e) => format!("refused: {e}"),
        }
    );
    let back = back.unwrap_or_else(|e| {
        panic!("the return is refused, though the plain sweep of the same UTxOs builds (fee {sweep_fee}): {e}")
    });
    // Everything comes back, as the sweep shows one transaction holds it, in a transaction the ledger takes.
    assert!(back.left_out.is_empty(), "{:?}", back.left_out.len());
    assert_eq!(back.inputs, rows.len());
    collateral_holds(&back, &rows, least);
}
```
