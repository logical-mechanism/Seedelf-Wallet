# r2cli#2: verification

From lane R2cli, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and runs confirm it.

**What changed.** r2b#2's fix (48a4c977 in FIXTREE, 82078f10 on cli/stranger-rows) sorts `select`'s rows by `(!holds_sent, has_tokens, Reverse(lovelace))` (utxos.rs:243-255). So every UTxO holding any of the sent token goes ahead of the ADA-only rows. `holds_sent` uses `Assets::any`, which matches policy and name at any amount, so 1 T makes U2 a holder.

**The flaw.** Once the first holder brings all of the token, the loop's third branch (utxos.rs:304, "you need ada because you already found the tokens") takes the next holder for its ADA. That happens before any ADA-only row is reached. The r2b#2 verifier's fix note missed this when it said the branches "then already take holders, then ADA, then other token UTxOs". The extra holder's other tokens join the change. select's floor (multiplier × one output's least for all of them, utxos.rs:315-336) then raises the goal.

**On the finder's layout:**
- `fund -l 100 ₳ --asset T=100`: the floor is 41.63 ₳, so the goal becomes 141.63 ₳ against the 129.4 ₳ held. select returns nothing and fund says "Not Enough Lovelace/Tokens". U1 + U3 pay it (select picks them when given just those two), and main's order picked [U3, U1].
- With -l 50 ₳, it spends U2 needlessly.

**No guard saves it.**
- fund's filters before select (collect_address_utxos, the reference-script retain, fitting) keep all three rows, in order.
- Nothing goes back to a row it passed, and the recursion re-sorts the same way.
- create and extract pass no tokens, so only fund is hit.

**Not known.** It is in none of backlog.md, the archived reviews, owner-calls.md, fix-branches.md or G2.md. fix-branches.md's independent review even says "no selection takes junk that `main` wouldn't", which this contradicts.

The CLI's patch-release branch cli/stranger-rows (343fb772) has the same do_select, so this ships with that release unless it's fixed.

**Grade: low.**
- Who: the user, by an ordinary `fund` of a token. The address must hold a second holder of that token which carries other tokens and less ADA than the first. A stranger can plant such a holder only for a fungible token, since they need a unit of it; an NFT is unique.
- Cost, when refused: a valid payment is turned down with a misleading message.
- Cost, when it builds: a slightly larger fee (about 0.1 ₳ by my estimate, not run), and the unneeded UTxO's tokens are re-made as four change outputs at the user's own address. No money is lost, locked or misdirected.
- Way out:
  - fund the token with less ADA, then the rest in a second ADA-only fund;
  - or consolidate U2 from the CIP-30 wallet;
  - or use the web wallet, which never calls this selector.

**Evidence:**

The trace, in FIXTREE's committed code. None of the core, koios or Cargo files is modified in the working copy.

**fund's path:**
1. seedelf-cli/src/commands/fund.rs:91 `let lovelace: u64 = args.lovelace.unwrap_or(minimum_lovelace);` is the bare amount sent, with no fee in it.
2. fund.rs:124-136 runs, in order:
   - get_address_utxos;
   - collect_address_utxos, which drops only a token-free UTxO of exactly 5 ₳ (utxos.rs:192);
   - `retain(reference_script.is_none())`;
   - `utxos::fitting(.., |_| false)`, which drops only rows whose tokens would overflow and keeps the order (utxos.rs:438-479).
3. fund.rs:137-146 calls `utxos::select(&params, rows, lovelace, selected_tokens)`, and on an empty answer runs `bail!("Not Enough Lovelace/Tokens")`.

**select on U1 (20 ₳, 100 T), U2 (9.4 ₳, 1 T and 60 NFTs of 60 policies) and U3 (100 ₳ alone), goal 100 ₳, tokens {T:100}:**
1. The sort. utxos.rs:248-251 sets `holds_sent = has_tokens && !tokens.is_empty() && assets_of(..).any(tokens)`. `Assets::any` (assets.rs:291-309) compares policy and name only, so U2 is a holder. With the key `(!holds_sent, has_tokens, Reverse(v))` and `sort_by_key` at :254, the order is U1, U2, U3.
2. U1. The first branch at :284 (`any && !found.contains`) takes it: sum 20 ₳, found {T:100}.
3. U2. At :284, `!found.contains` is false, so it isn't added there. The third branch at :304 (`!added && 20 ₳ < 100 ₳ && found.contains(tokens)`) then takes it: sum 29.4 ₳, and its 61 tokens merge into found.
4. U3. The ADA-only branch at :294 takes it: sum 129.4 ₳.
5. The check at :315-336:
   - change = found.separate(tokens), which is 61 kinds;
   - multiplier = 61/20 + 1 = 4 (MAXIMUM_TOKENS_PER_UTXO = 20, constants.rs:95);
   - floor = 4 × 10,408,650 = 41,634,600;
   - total_needed = 141.63 ₳, more than the 129.4 ₳ held.
6. The recursion at :341 runs with lovelace 141.63 ₳: same order, same three rows, and the loop ends short. :356 returns `Ok(Vec::new())`.

**Main** (`git show main:seedelf-platform/seedelf-core/src/utxos.rs`, :202-208) sorts by `(has_tokens, b_val.cmp(a_val))`, which gives U3, U1, U2:
- U3 gives sum 100 ₳.
- U1 gives sum 120 ₳ and found {T:100}.
- The change is empty, so the floor is 1,456,780 and total_needed is 101.46 ₳, within 120 ₳.
- Result: [U3, U1].

**Callers.** create.rs:81 and util/extract.rs:146 pass `Assets::new()`, so holds_sent is false for every row and their order is unchanged. Nothing in seedelf-wasm or the extension calls `select`.

**Since.** `git show 48a4c977 -- seedelf-core/src/utxos.rs` adds `SelectOrder` and the new key. `diff` of do_select between cli/stranger-rows (343fb772) and FIXTREE HEAD shows no difference.

**Class.** The other holder-first selectors don't share it:
- build.rs:2549-2595 `select_script_inputs` takes only `holding`'s pick (build.rs:2965: as few as hold each token, the most of it first). The rest is sorted `(holds_tokens, Reverse(lovelace))`, so a leftover holder comes after ADA alone.
- build.rs:901-913 `account_payment` makes every holder mandatory on purpose and builds exact change.

**Runs.**
- In FIXTREE, the test fails (see test_result). The figures it printed: ADA-only change floor 1,456,780; U2's 61 tokens give 4 × one output's least = 41,634,600. The control, U1 + U3 alone, picks ["U1","U3"]. All three rows pick [] for 100 ₳ and ["U1","U2","U3"] for 50 ₳.
- In a throwaway copy with main's order (`(has_tokens, Reverse(v))`), using its own CARGO_TARGET_DIR under ~/.cache/seedelf-review-51: the test passes (["U3","U1"] for both goals). r2b#2's `fund_takes_ada_from_a_token_utxo_sorted_ahead_of_the_one_holding_the_token` fails at selection_integration.rs:184. So the new order is what breaks this case.
- In the same copy with a candidate fix (holders lead only until the gathered tokens hold what's sent; any later holder sorts with the other token UTxOs after ADA alone):
  - r51_r2cli_2: 1 passed;
  - selection_integration: 4 passed, r2b#2's included;
  - utxos_test: 19 passed, 3 ignored;
  - proptest_core: 8 passed;
  - seedelf-cli's `cli` harness, filtered to fund::, create:: and extract::: 26 passed.

The copy and its target were removed afterwards.

**Known:** None: it isn't settled or known. What I searched:
- seedelf-web-wallet/docs/backlog.md for utxos::select, do_select, "Not Enough Lovelace", holds_sent, "second holder" and "holders first": no hits.
- docs/archive/plans/: only chunk-09-transfer.md:43, which describes the call.
- review-51/owner-calls.md: r2a#3 is core's history-aware `apart` and the CLI sweeps' dusting, a different function. It doesn't cover `utxos::select`.
- fix-branches.md: its CLI 'For the owner' items are dusting, the window, reference scripts and the order of sweep --all. None is about fund's select. Its independent review says "no selection takes junk that `main` wouldn't", which this finding shows is false for fund.
- fixes/G2.md: it records only r2b#2's order change.
- verify/r2b-2.md: its fix note prescribed this key and claimed the branches "then already take holders, then ADA, then other token UTxOs", which is the gap.
- INDEX.md: it lists r2cli#2 with no verdict yet.
- SECURITY.md: no out-of-scope clause applies, and no data source has to lie.

**Fix notes:**

**What to change** (seedelf-core/src/utxos.rs, do_select:243-255): the holders should lead only until they bring every token sent.

The cleanest model is `select_script_inputs`' blind path (build.rs:2549-2595), which works in three steps:
1. Take `holding`'s pick (build.rs:2965): as few UTxOs as hold each sent token's amount, the most of that token first.
2. Then take ADA-only rows, the most lovelace first.
3. Then take every other token UTxO, the most lovelace first, with the leftover holders among them.

The loop's three branches can stay as they are.

A minimal version I checked in a copy:
- after the sort, walk the sorted holders, keeping each in front while the gathered assets don't yet `contains(tokens)`;
- push every later row into a second group, re-keyed as a non-holder;
- sort that group by `(has_tokens, Reverse(lovelace))` and chain it after the front.

It passes this test and r2b#2's. selection_integration, utxos_test, proptest_core and the CLI harness's fund, create and extract tests stay green.

With several sent tokens, prefer `holding`'s per-token pick. The lovelace-ordered minimal version can take an unneeded holder of one token while another token is still missing.

Move this test into selection_integration.rs next to r2b#2's, and keep both.

**Class.** `utxos::select` is the only member with this flaw:
- `select_script_inputs` already takes only the holders `holding` needs, then ADA first.
- `account_payment` makes every holder mandatory by design and builds exact change, so it doesn't refuse on this layout.

The r2b#2 verifier cited account_payment's order as the model; select_script_inputs' is the right one. The class is "holders first" applied past the point where the tokens are found. That is a selection-order regression introduced by a fix, CLI-only.

**Related, pre-existing in main too, a note only:** select's change floor counts multiplier × one output's least for all change tokens. Here that's 41.63 ₳, where 4 outputs at 20 tokens need roughly 13 ₳ by estimate. That over-count is what turns the needless spend into a refusal.

**How it ships:**
- It goes into the CLI's patch release from cli/stranger-rows (343fb772 has the same do_select).
- The web wallet doesn't change.
- It removes a refusal and adds none, so it doesn't need the owner's call.
- fix-branches.md's line "no selection takes junk that `main` wouldn't" should get a dated erratum (the owner's errata rule for review records).

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-core/tests/r51_r2cli_2.rs`

Result: It **FAILS** in FIXTREE today, as the bug predicts. The file passes `rustfmt --edition 2024 --check`. Command, from FIXTREE/seedelf-platform:

`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --locked -p seedelf-core --test r51_r2cli_2`

```
running 1 test
test r51_r2cli_2_fund_takes_ada_only_rows_before_a_second_holder_of_the_token_sent ... FAILED

failures:

---- r51_r2cli_2_fund_takes_ada_only_rows_before_a_second_holder_of_the_token_sent stdout ----
R51_R2CLI_2 floors: ADA-only change 1456780; with U2's 61 tokens 4 x one output's least = 41634600
R51_R2CLI_2 control, U1 and U3 alone, 100 ₳: ["U1", "U3"]
R51_R2CLI_2 picked for 100 ₳: []; for 50 ₳: ["U1", "U2", "U3"]

thread 'r51_r2cli_2_fund_takes_ada_only_rows_before_a_second_holder_of_the_token_sent' (2939720) panicked at seedelf-core/tests/r51_r2cli_2.rs:161:5:
the address holds 129.4 ₳ and 101 T, and U1 + U3 pay 100 ₳ and the 100 T with ADA-only change (select picks ["U1", "U3"] from them alone), yet from all three select picked [] for 100 ₳ (an empty pick is fund's "Not Enough Lovelace/Tokens") and ["U1", "U2", "U3"] for 50 ₳: U2 joined for its ADA ahead of U3, and its 61 tokens put the change's floor at 41634600 lovelace

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

Checks in a throwaway copy (rsync of FIXTREE/seedelf-platform to ~/.cache/seedelf-review-51/verify-r2cli_2-trace, with its own CARGO_TARGET_DIR there; both removed afterwards):

**main's order put back** (`sort_by_key((has_tokens, Reverse(v)))`):
- `R51_R2CLI_2 picked for 100 ₳: ["U3", "U1"]; for 50 ₳: ["U3", "U1"]`, then `test r51_r2cli_2_... ok`.
- selection_integration: `fund_takes_ada_from_a_token_utxo_sorted_ahead_of_the_one_holding_the_token ... FAILED` (panicked at selection_integration.rs:184:9), `3 passed; 1 failed`.

**Candidate fix** (holders lead only until the gathered tokens hold what's sent; the rest re-keyed as non-holders and sorted `(has_tokens, Reverse(v))`):

| Test | Result |
|---|---|
| r51_r2cli_2 | 1 passed |
| selection_integration | 4 passed, r2b#2's included |
| utxos_test | 19 passed, 3 ignored |
| proptest_core | 8 passed |
| seedelf-cli `--test cli -- fund:: create:: extract::` | 26 passed, 31 filtered out |

The Vitest double run (VITE_ENABLE_MAINNET=false) doesn't apply: this is a Rust test.

```
//! Chunk 51, finding r2cli#2: r2b#2's fix sorts every UTxO holding a token
//! being sent ahead of the ADA-only ones (utxos.rs `SelectOrder`,
//! `(!holds_sent, has_tokens, Reverse(lovelace))`). Once the first holder has
//! brought all of the token sent, `do_select`'s third branch ("you need ada
//! because you already found the tokens") takes the next holder for its ADA
//! before any ADA-only UTxO is reached. That holder's other tokens join the
//! change, and the change's floor (one output's least for all of them, times
//! the outputs at 20 tokens each) raises the goal past what the address holds.
//!
//! This runs `fund`'s own steps (fund.rs:124-142): `collect_address_utxos`,
//! no reference scripts, `fitting`, then `select` with the lovelace and the
//! tokens asked for: `fund -l <lovelace> --asset <T>=100`.

use seedelf_core::assets::{Asset, Assets};
use seedelf_core::constants::MAXIMUM_TOKENS_PER_UTXO;
use seedelf_core::transaction::wallet_minimum_lovelace_with_assets;
use seedelf_core::utxos;
use seedelf_koios::koios::{Asset as KoiosAsset, ProtocolParameters, Ratio, UtxoResponse};

const T_POLICY: &str = "11111111111111111111111111111111111111111111111111111111";
const ADA: u64 = 1_000_000;

fn fixture_params() -> ProtocolParameters {
    ProtocolParameters {
        min_fee_a: 44,
        min_fee_b: 155_381,
        coins_per_utxo_size: 4_310,
        key_deposit: 2_000_000,
        drep_deposit: Some(500_000_000),
        price_mem: 0.0577,
        price_step: 0.0000721,
        cost_model_v3: Vec::new(),
        cost_model_v1: Vec::new(),
        cost_model_v2: Vec::new(),
        min_fee_ref_script_cost_per_byte: Ratio::whole(15),
    }
}

/// A UTxO at the paying address, made by the transaction `[byte; 32]`.
fn row(byte: u8, lovelace: u64, tokens: &[(String, &str, u64)]) -> UtxoResponse {
    UtxoResponse {
        tx_hash: hex::encode([byte; 32]),
        value: lovelace.to_string(),
        asset_list: Some(
            tokens
                .iter()
                .map(|(policy, name, quantity)| KoiosAsset {
                    policy_id: policy.clone(),
                    asset_name: (*name).to_string(),
                    quantity: quantity.to_string(),
                    ..Default::default()
                })
                .collect(),
        ),
        ..Default::default()
    }
}

fn label(u: &UtxoResponse) -> String {
    format!("U{}", u8::from_str_radix(&u.tx_hash[..2], 16).unwrap())
}

fn labels(picked: &[UtxoResponse]) -> Vec<String> {
    picked.iter().map(label).collect()
}

/// `--asset <T_POLICY>.aa=100`
fn sent() -> Assets {
    Assets::new()
        .add(Asset::new(T_POLICY.to_string(), "aa".to_string(), 100).unwrap())
        .unwrap()
}

#[test]
fn r51_r2cli_2_fund_takes_ada_only_rows_before_a_second_holder_of_the_token_sent() {
    let params = fixture_params();

    // U1: 20 ₳ and the 100 T sent. U2: 9.4 ₳, 1 T and 60 NFTs of 60 policies.
    // U3: 100 ₳ alone. 129.4 ₳ and 101 T in all.
    let mut u2_tokens: Vec<(String, &str, u64)> = vec![(T_POLICY.to_string(), "aa", 1)];
    for i in 0..60u8 {
        u2_tokens.push((hex::encode([0x40 + i; 28]), "01", 1));
    }
    let u1 = row(0x01, 20 * ADA, &[(T_POLICY.to_string(), "aa", 100)]);
    let u2 = row(0x02, 9_400_000, &u2_tokens);
    let u3 = row(0x03, 100 * ADA, &[]);

    // fund.rs:124-136: no pure 5 ₳ row, no reference script, nothing overflows.
    let usable = utxos::collect_address_utxos(vec![u1.clone(), u2.clone(), u3.clone()]).unwrap();
    let usable: Vec<UtxoResponse> = usable
        .into_iter()
        .filter(|u| u.reference_script.is_none())
        .collect();
    let (usable, left) = utxos::fitting(&usable, &Assets::new(), |_| false).unwrap();
    assert_eq!(
        (labels(&usable), left.len()),
        (
            vec!["U1".to_string(), "U2".to_string(), "U3".to_string()],
            0
        ),
        "fund hands select all three rows"
    );

    // The floors select's check (utxos.rs:315-336) sets: no change tokens with
    // U1 and U3; U2's 61 tokens once U2 joins.
    let ada_change_least = wallet_minimum_lovelace_with_assets(&params, Assets::new()).unwrap();
    let u2_change = utxos::assets_of(vec![u2.clone()]).unwrap().1;
    let kinds = u2_change.len();
    let multiplier = if kinds > MAXIMUM_TOKENS_PER_UTXO {
        kinds / MAXIMUM_TOKENS_PER_UTXO + 1
    } else {
        1
    };
    let u2_floor = multiplier * wallet_minimum_lovelace_with_assets(&params, u2_change).unwrap();
    println!(
        "R51_R2CLI_2 floors: ADA-only change {ada_change_least}; with U2's {kinds} tokens {multiplier} x one output's least = {u2_floor}"
    );

    // Control: under select's own rule, U1 and U3 pay 100 ₳ and the 100 T.
    let control = utxos::select(&params, vec![u1.clone(), u3.clone()], 100 * ADA, sent()).unwrap();
    println!(
        "R51_R2CLI_2 control, U1 and U3 alone, 100 ₳: {:?}",
        labels(&control)
    );
    assert!(
        !control.is_empty(),
        "U1 and U3 alone pay 100 ₳ and the 100 T"
    );

    // `fund -l 100000000 --asset <T>=100`, and the same with -l 50000000.
    let picked_100 = utxos::select(&params, usable.clone(), 100 * ADA, sent()).unwrap();
    let picked_50 = utxos::select(&params, usable.clone(), 50 * ADA, sent()).unwrap();
    println!(
        "R51_R2CLI_2 picked for 100 ₳: {:?}; for 50 ₳: {:?}",
        labels(&picked_100),
        labels(&picked_50)
    );

    // What select promises when it picks (as r2b#2's test checks it).
    for (goal, picked) in [(100 * ADA, &picked_100), (50 * ADA, &picked_50)] {
        if picked.is_empty() {
            continue;
        }
        let (total, found) = utxos::assets_of(picked.clone()).unwrap();
        assert!(found.contains(sent()), "the pick holds the token sent");
        let change = found.separate(sent()).unwrap();
        let change_least = wallet_minimum_lovelace_with_assets(&params, change).unwrap();
        assert!(
            total >= goal + change_least,
            "picked {total} lovelace, short of the goal {goal} and the change's {change_least}"
        );
    }

    // Right: the token's holders go first only until the token sent is found;
    // ADA alone comes before any other token UTxO, so U2 is never needed.
    let refused = picked_100.is_empty();
    let spends_u2 = picked_100
        .iter()
        .chain(picked_50.iter())
        .any(|u| label(u) == "U2");
    assert!(
        !refused && !spends_u2,
        "the address holds 129.4 ₳ and 101 T, and U1 + U3 pay 100 ₳ and the 100 T with ADA-only \
         change (select picks {:?} from them alone), yet from all three select picked {:?} for \
         100 ₳ (an empty pick is fund's \"Not Enough Lovelace/Tokens\") and {:?} for 50 ₳: U2 \
         joined for its ADA ahead of U3, and its {kinds} tokens put the change's floor at \
         {u2_floor} lovelace",
        labels(&control),
        labels(&picked_100),
        labels(&picked_50),
    );
}
```
