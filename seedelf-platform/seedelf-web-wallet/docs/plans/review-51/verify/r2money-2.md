# r2money#2: verification

From lane R2money, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and 21caa3b8 brought it in. The collateral check it added runs in every staging, the estimate's included. A merged return's draft takes its fee from estimate(), which prices the spend on SPEND_BUDGET_GUESS, about 1.3 times what the wallet contract really uses. So a collateral whose return clears the least at the fee actually paid, but not at the guessed fee, is refused. The refusal is not a NotEnough error, so measuring_draft passes it straight on, and nothing in WebAssembly or the worker falls back.

Run in the fix tree: least 978,370, settled fee 747,574, collateral 2,104,731 (it gives back 983,370 at the settled fee). The return is refused with "The collateral can't cover this transaction's fee and come back as an output". Before 21caa3b8 that transaction built, and the ledger takes it.

The refused band is 3/2 of the guess's extra compute for each merged Seedelf UTxO: 14,655 lovelace measured in core, about 57,000 at MAX_MERGE's four.

Who can reach it: the user, and only when three things hold together:
- the session's 5 ₳ is gone (a site's transaction the user approved, which dapp.ts allows with a prompt, or gap-g4#2's Minswap swap);
- the return is heavy, with a fee of about 0.68 ₳ or more so that least + 3/2 × fee passes 2 ₳;
- the largest ADA-only UTxO falls inside that narrow window.

Nothing is signed wrongly or lost. The money stays at the session's account, and a site's session has a way out: Top up adds a fresh 5 ₳ when none fits. So it is low: a regression that refuses, in a narrow edge case, a transaction the ledger accepts.

**Evidence:**

The tree traced is the fix tree at HEAD. Neither build.rs nor lib.rs is modified in its working copy (git status lists only extension TS, docs and other verifiers' new tests).

How the refusal is reached:
1. In wasm/src/lib.rs:985-999, session_collateral takes the exact 5 ₳ UTxO, else `.filter(|u| lovelace(u) >= 2_000_000).max_by_key(..)`.
2. lib.rs:1190: plan_return merges whenever merge is non-empty, the rows are evaluable and session_collateral finds one.
3. lib.rs:1479 → merged_return (lib.rs:1356-1390) → `ScriptSpend::new(..).with_account(key, rows, collateral)` → `measure_locally(known)`.
4. In seedelf-core/src/build.rs:1834-1871, measure_locally runs `measure(&self.measuring_draft()?)?` before finalize.
5. build.rs:1886-1890, measuring_draft: `match self.draft() { Err(e) if is_short(&e) => e, other => return other }`. is_short (build.rs:2885) only matches NotEnough.
6. build.rs:1796-1802, draft(): `let fee = self.estimate()?.fee.total;`
7. build.rs:1818-1827, estimate(): `Budgets::guess(..)`, which is SPEND_BUDGET_GUESS (100,000 mem, 450M steps) against the measured 76,043 and 337,845,799 (build.rs:1117-1123), then `self.settle(..)`.
8. ScriptSpend::settle (1972ff) calls core settle (build.rs:253-286), which runs `build(fee)?` = `self.stage(fee, ..)` every round, the last one at the guessed fee.
9. build.rs:2200-2213 (blame: 21caa3b8): `checked_sub(fee * 3 / 2).filter(|back| *back >= least).context("...come back as an output")?`.

What happens after the refusal:
- lib.rs:1321-1345, built_or_without_strangers: with no strangers in the plan it reaches `None => return Err(e)`.
- lib.rs:1446-1462: session_return's attempt(None) is the same plan.
- In the worker, sessions.ts:4935 rethrows everything except TOO_LITTLE.
- Precondition: dapp.ts:1868-1877 lets a site's transaction in a session spend the session's collateral (it is only named in the prompt).
- Way out: sessions.ts:2397-2412, topUpBuild adds a fresh 5 ₳ when `!held.some(collateralFits)` (site sessions only, :2399); backCollateralBuild (:2515) offers 5 ₳ where Lovejoin wants it.

Runs:
- In the fix tree, my test failed with the same fee on two runs (see test_result).
- In a copy with a candidate fix (stage saturating; the least checked in finalize at the fee that's sent), my test passes.
- A copy-only core check, simple shape: `least 857690 guessed fee 237044 settled fee 227274 band 14655; over 3000/6000/10000: Ok((227274, 860690/863690/867690)); under by 1000: Err(..come back as an output); short of 3/2: Err(..)`.
- The same check against unmutated core: `over 3000: Err("The collateral can't cover this transaction's fee and come back as an output")`.
- With the fix in the copy, merge_test's two estimate()-based tests fail with Ok(236956) and Ok(237044).
- Logs are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-r2money_2-trace/. The copy and its target are removed.

**Known:** Not known.

Searched docs/backlog.md and docs/archive/plans/*.md for: 'guessed fee', "guess's fee", "estimate's fee", 'at the estimate', 'draft fee', 'first guess', SPEND_BUDGET_GUESS, 'budget guess', 'guessed budget', '2 ₳ or more', 'largest ADA-only', session_collateral, 'merged return', 'own collateral', and every 'collateral' line in backlog.md. Also searched review-51's owner-calls.md, INDEX.md, FINDINGS.md, FIX.md and RESUME.md for r2money, 'collateral return', 'come back as an output', session_collateral and guess, the chunk-46 and chunk-49 plans for collateral, and the fixers' notes.

The only hits are near the topic, none on this symptom:
- review-1.9.1.md:64 measures SPEND_BUDGET_GUESS less the measured budget at 9,468 to 9,589 lovelace, but for a chain end's window, not a collateral.
- t1a#12 and t1d#1 are the account mint's and the launch's least, already pinned.
- gap-g4#2 (owner-calls §3) says a Minswap swap can spend the session's 5 ₳. That is this finding's precondition, not its symptom.

Its sibling r2money#1 (a collateral under the band, with no sweep fallback) is a different case.

**Fix notes:**

What to change, in seedelf-core/src/build.rs:
- In ScriptSpend::stage, lines 2195-2217: stage the account collateral's return saturating, `account.collateral_lovelace.saturating_sub(fee * 3 / 2)`, with no refusal there.
- Hold it to `checked_sub(fee * 3 / 2).filter(|b| *b >= least)`, in the same words, once, at the fee that is sent: in ScriptSpend::finalize after `self.settle(..)`. Both of measure_locally's finishes go through finalize.
- This is the pattern 21caa3b8 itself used for withdraw_paid: saturating inside the loop (lovejoin/mod.rs:1617), checked in the round that returns (mod.rs:1768-1775).

Checked in a throwaway copy:
- My test passes.
- The guard still refuses a collateral 1,000 lovelace under least + 3/2 × the settled fee, and one short of 3/2 of the fee, through measure_locally.
- merge_test.rs's `an_account_collateral_short_of_three_halves_of_the_fee_is_refused` and `an_account_collateral_whose_return_falls_under_its_least_is_refused` test the refusal through estimate(), so with the fix they fail (Ok(236956), Ok(237044)). Move both to a proven spend's measure_locally at the settled fee, and add the band case (least + 3/2 × settled + a few thousand lovelace builds).
- measuring_draft's `Err(_) => Err(short)` arm (build.rs:1898-1902) then no longer catches the collateral at most_fee. That is harmless, because finalize refuses at the settled fee.

With r2money#1: if that finding's sweep fallback lands, this band would come back as a plain sweep, which makes new UTxOs instead of joining the funding change and so is less private. This fix keeps the band merged, so do it either way.

No owner call is needed. The fix only narrows a refusal to what the ledger refuses (the 2026-10-19 rule), and it changes no default or screen.

The class: a least or cover held at a guessed or draft fee instead of the fee that's sent.
- AccountMint::stage (build.rs:3762-3770) checks at MINT_BUDGET_GUESS's estimate, with a band of about 3,300 lovelace. The web wallet gives it the account's 5 ₳, and the CLI's account_collateral can pick 2 ₳ or more, but a mint's fee is far below the 0.68 ₳ needed, so it is unreachable today.
- The launch (launch.rs:502-511) takes 5 ₳ and is unreachable.
- Lovejoin's mix_with payer change at MIX_DRAFT_FEE (mod.rs:1099-1102) and the deposit's change at FIRST_DRAFT_FEE are the same class for a change output, already in R2money's notes for the owner.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/wasm/tests/r51_r2money_2.rs`

Result: Ran from FIXTREE/seedelf-platform with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --locked -p seedelf-wasm --test r51_r2money_2`. It fails today, the same way on all three runs:

```
running 1 test
thread 'a_merged_return_whose_collateral_comes_back_with_its_least_at_the_fee_it_pays_is_built' panicked at seedelf-web-wallet/wasm/tests/r51_r2money_2.rs:148:9:
refused: The collateral can't cover this transaction's fee and come back as an output (least 978370, settled fee 747574, collateral 2104731, which gives back 983370 at that fee)
test a_merged_return_whose_collateral_comes_back_with_its_least_at_the_fee_it_pays_is_built ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.54s
```

The same test in a throwaway copy, with stage saturating and the least checked in finalize at the settled fee: `test a_merged_return_whose_collateral_comes_back_with_its_least_at_the_fee_it_pays_is_built ... ok` / `test result: ok. 1 passed`.

This is a Rust test, so the VITE_ENABLE_MAINNET=false run doesn't apply.

```
//! Chunk 51, r2money#2. A session's return merged into its funding's change puts up the session's own collateral:
//! its 5 ₳ UTxO or, once a site's transaction spent that, the largest ADA-only one of 2 ₳ or more
//! (`session_collateral`). What that collateral gives back is an output, and the ledger holds it to an output's least
//! at the fee the transaction pays. A return whose settled fee leaves the least is a transaction the ledger takes, so
//! it's built. 21caa3b8 checks the least in every staging, the estimate's too, whose fee is priced on
//! SPEND_BUDGET_GUESS (about 1.3× what the wallet contract uses): a collateral within 3/2 of the guess's extra compute
//! above the settled fee's need is refused.

use pallas_addresses::Address;
use pallas_traverse::MultiEraTx;
use seedelf_core::address::wallet_contract;
use seedelf_core::constants::{VARIANT, get_config};
use seedelf_crypto::cardano::{CardanoAccount, ONE_TIME_ACCOUNT};
use seedelf_crypto::register::Register;
use seedelf_crypto::schnorr::random_scalar;
use seedelf_koios::koios::{ProtocolParameters, UtxoResponse};
use seedelf_wasm::api::{self, SessionReturnRequest};
use serde_json::{Value, json};

const PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const POLICY: &str = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed72";
/// The session's own UTxOs holding tokens, 20 each: the return re-makes each as a deposit output of its own, so its
/// fee is heavy enough that 3/2 of it and the least pass 2 ₳.
const TOKEN_ROWS: u8 = 13;

fn params() -> Value {
    let rows: Value = serde_json::from_str(include_str!(
        "../../../seedelf-core/tests/fixtures/epoch_params.json"
    ))
    .unwrap();
    rows[0].clone()
}

fn row(tx: u8, address: &Address, lovelace: u64, names: &[String]) -> UtxoResponse {
    let assets: Vec<Value> = names
        .iter()
        .map(|n| json!({ "policy_id": POLICY, "asset_name": n, "quantity": "1", "decimals": 0, "fingerprint": "" }))
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

/// The Seedelf change the session's funding made, under a fresh copy of `owner`.
fn funding_change(owner: &Register, lovelace: u64) -> UtxoResponse {
    let wallet = wallet_contract(
        true,
        get_config(VARIANT, true)
            .unwrap()
            .contract
            .wallet_contract_hash,
    );
    let register = owner.clone().rerandomize().unwrap();
    let mut change = row(0xf0, &wallet, lovelace, &[]);
    change.inline_datum = serde_json::from_value(json!({
        "bytes": hex::encode(register.to_vec().unwrap()),
        "value": { "constructor": 0, "fields": [
            { "bytes": register.generator }, { "bytes": register.public_value },
        ]},
    }))
    .unwrap();
    change
}

/// The session's account, all of it made by the session's own transactions: TOKEN_ROWS UTxOs of 20 tokens and 6 ₳,
/// and one of `collateral` lovelace, ADA alone. No 5 ₳ UTxO: a site's transaction spent it.
fn account(at: &Address, collateral: u64) -> (Vec<UtxoResponse>, Vec<String>) {
    let mut rows: Vec<UtxoResponse> = (0..TOKEN_ROWS)
        .map(|i| {
            let names: Vec<String> = (0..20u8)
                .map(|j| {
                    let mut name = [0x52u8; 32];
                    name[0] = i;
                    name[1] = j;
                    hex::encode(name)
                })
                .collect();
            row(0x10 + i, at, 6_000_000, &names)
        })
        .collect();
    rows.push(row(0xc0, at, collateral, &[]));
    let own = rows.iter().map(|r| r.tx_hash.clone()).collect();
    (rows, own)
}

#[test]
fn a_merged_return_whose_collateral_comes_back_with_its_least_at_the_fee_it_pays_is_built() {
    let accounts = CardanoAccount::from_phrase(PHRASE, ONE_TIME_ACCOUNT).unwrap();
    let index = 3;
    let at = api::one_time_address(&accounts, true, index).unwrap();
    let sk = random_scalar();
    let change = funding_change(&Register::create(sk).unwrap(), 10_000_000);
    let back = |collateral: u64| {
        let (utxos, own) = account(&at, collateral);
        api::session_return(
            &accounts,
            sk,
            SessionReturnRequest {
                network: "preprod".into(),
                params: params(),
                index,
                utxos,
                merge: vec![change.clone()],
                own,
                collateral_pool: None,
                collateral_boxes: vec![],
                rewards: Default::default(),
            },
        )
    };
    let p = ProtocolParameters::from_koios(&params()).unwrap();
    let least = seedelf_core::transaction::address_minimum_lovelace_with_assets(
        &p,
        &at.to_bech32().unwrap(),
        seedelf_core::assets::Assets::new(),
    )
    .unwrap();

    // The fee this return settles at, its collateral well clear of the least.
    let clear = back(3_000_000).expect("with 3 ₳ up, the merged return builds");
    assert_eq!(clear.merged, 1);
    assert_eq!(clear.inputs, usize::from(TOKEN_ROWS) + 1);
    let settled: u64 = clear.fee.parse().unwrap();

    // A collateral that pays 3/2 of that fee and gives back 5,000 lovelace over its least. It's the fallback's pick
    // (2 ₳ or more, not 5 ₳), and the proofs' budgets move the fee by far less than 5,000 / (3/2).
    let collateral = least + settled * 3 / 2 + 5_000;
    assert!(
        collateral >= 2_000_000 && collateral != 5_000_000,
        "{collateral}"
    );
    let built = back(collateral).unwrap_or_else(|e| {
        panic!(
            "refused: {e} (least {least}, settled fee {settled}, collateral {collateral}, which gives back {} at that fee)",
            collateral - settled * 3 / 2
        )
    });
    assert_eq!(built.merged, 1);
    assert_eq!(built.inputs, usize::from(TOKEN_ROWS) + 1);

    // The transaction the ledger takes: the collateral is that UTxO, 3/2 of the fee stays, and what comes back holds
    // at least an output's least, by the ledger's own rule on its bytes.
    let bytes = hex::decode(&built.tx_cbor).unwrap();
    let tx = MultiEraTx::decode(&bytes).unwrap();
    let fee = tx.fee().unwrap();
    assert_eq!(fee.to_string(), built.fee);
    let collaterals: Vec<_> = tx
        .collateral()
        .iter()
        .map(|i| (**i.hash(), i.index()))
        .collect();
    assert_eq!(collaterals, vec![([0xc0; 32], 0)]);
    let returned = tx.collateral_return().expect("a collateral return");
    assert_eq!(returned.address().unwrap().to_vec(), at.to_vec());
    let coin = returned.value().coin();
    assert_eq!(collateral - coin, fee * 3 / 2);
    let ledger_least = (160 + returned.encode().len() as u64) * 4_310;
    assert!(
        coin >= ledger_least && coin >= least,
        "{coin} < {ledger_least} / {least}"
    );
}
```
