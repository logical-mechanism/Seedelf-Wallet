# shapes (find:shapes)

2 finding(s).

## shapes#1: An amount whose token needs three or more parts overpays by one token output's least for each part past the second (in_parts' keep)

- **Severity:** medium; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:4158`
- **Since:** unchanged from 1.9.0

**What.** `in_parts` (lib.rs:4143-4168) has a part that can pay more than is owed pay all but `keep`. `keep = least(&later)` is the least of the tokens still owed, counted as ONE more output.

When those tokens need two or more parts, each part must pay its own share's least. The part right after reserves nothing for the next, because `owed - keep` is 0 by then and it pays `least(share)` anyway. Every later part then pays its least on top of a remainder that has already hit 0.

With P token parts, the payment is (P - 2) x least(token output) over what was asked. The parts' total is above max(asked, sum of each part's least), the bound this lane added to `check_parts`.

`whole()` (extension/src/background/script-spend.ts:493) sums each part's lovelace, so the review states the inflated amount (e.g. 54.88 ₳ where 50 was typed) with no note why.

The shape is the owner's own (Lovejoin token boxes brought back, 1.6.0's test, 42 and 90 boxes). It also hits any token spread over more than about 40 UTxOs with a little ADA to spare: a token over 60 UTxOs at its least + 0.06 ₳, with five 5 ₳ UTxOs, overpays 1.146460 ₳ to an address.

#384 didn't touch `in_parts`. All 188 token-box rows pay identical totals on 1.9.0 and 1.9.1.

**Scenario.** Lovejoin token boxes (4.5 ₳ + 100 MIN each), all MIN asked. least([MIN]) is 1.633490 ₳ to a Seedelf and 1.155080 ₳ to an address.
- 61 boxes + 50 ₳ to a Seedelf: 3 parts pay [48.366510, 1.633490, 1.633490] = 51.633490 ₳ (1.633490 over). To an address: 51.155080 (1.155080 over).
- 90 boxes + 50 ₳: 5 parts, 54.883230 ₳ to a Seedelf (4.883230 over), 53.448000 to an address (3.448000 over).
- 90 boxes + 243 ₳ (the suite's 600‰): parts [89.090264, 89.084244, 63.192002, 1.633490, 1.633490], fees [0.909736, 0.915756, 0.922356, 0.922356, 0.560966]. 244.633490 ₳ paid for 243.000000 asked, where the parts' leasts sum to 8.167450.
- 150 boxes + 50 ₳: 8 parts, 59.783700 ₳ to a Seedelf (9.783700 over), 56.913240 to an address (6.913240 over).
- 150 boxes + 243 ₳: 249.516720 (6.516720 over).
- 75% of the MIN behaves alike: 90 boxes + 50 ₳ = 53.249740 to a Seedelf (3.249740 over).

**Evidence.** Code at 3063b33f, wasm/src/lib.rs:4158-4167:
```rust
let keep = least(&later)?;
if paid.saturating_add(keep) <= owed {
    return Ok(all);
}
amount(
    picks,
    owed.saturating_sub(keep).max(least(&share)?),
    share.clone(),
    first,
)
```

Runs (own worktrees, CARGO_TARGET_DIR ~/.cache/seedelf-review-1.9.1/shapes and shapes-190; release build, test binary run with --ignored):
- Main suite with the new bound, on both versions: `BAD transfer amount 600‰ ADA + 1 token(s) at 1000‰ ... 5 part(s) [...p89.090264...p89.084244...p63.192002...p1.633490...p1.633490] paid 244.63 ADA` and `! OVERPAID paid 244633490 > max(asked 243000000, the parts' leasts 8167450): 1633490 over`. Withdraw: `! OVERPAID paid 244155080 > max(asked 243000000, the parts' leasts 5775400): 1155080 over`. Summary on both: `2 with problems, 108 refused, 0 of them Max`.
- token_boxes_in_parts_pay_what_was_asked: `token boxes 1.9.0: 188 rows, 90 overpaid`, `token boxes 1.9.1: 188 rows, 90 overpaid`, `1.9.0 and 1.9.1 pay the same in every row: True`.
- spread_token_then_ada: `BAD [Address] holders x60 (+60000) frees x5 asked 2x least + 1300000 (3592920): 3 part(s) [...p2.446460...p1.146460...p1.146460] ... OVERPAID paid 4739380 > max(asked 3592920, the parts' leasts 3439380): 1146460 over`.

Focused test (in the lane's file; fails on 1.9.0 and 1.9.1 with `left: 51633490 right: 50000000`):
```rust
#[test]
fn token_boxes_sent_in_three_parts_pay_what_was_asked() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let pp = ProtocolParameters::from_koios(&params()).unwrap();
    let recorded = fixture("../extension/tests/fixtures/transfer-preprod.json");
    let t: Tok = (policy(1), name(1, false));
    let mut i = 0;
    let utxos: Vec<UtxoResponse> = (0..61)
        .map(|_| {
            let mut u = make(&mut i, 0, &[(t.clone(), 100_000_000)], &pp);
            u.value = "4500000".into();
            u
        })
        .collect();
    let sold = vec![(t.clone(), held(&utxos, &t))];
    for to in [To::Seedelf, To::Address] {
        let o = pay(&utxos, sk, to, 50_000_000, &sold, &recorded);
        let paid: u64 = o.parts.iter().map(|p| p.paid).sum();
        assert!(o.ok, "{to:?}: {}", o.line);
        assert_eq!(paid, 50_000_000, "{to:?}: {} {:?}", o.line, o.problems);
    }
}
```

Full test file: SCRATCH/review-1.9.1/shapes/payment_parts_shapes_test.shapes-lane.rs
Diff against 3063b33f: SCRATCH/review-1.9.1/shapes/payment_parts_shapes_test.diff

**Suggestion.** After planning, when the parts pay more than max(asked, Σ least(share_i)), rebuild the part that paid `owed - keep` paying the excess less. Its change takes the excess and the later parts stay as they are. The alternative is to reserve each later part's least, which isn't known up front.

Add the lane's lovelace bound (in `check_parts`) to the parts suite so any such shape fails, and keep the focused test.

## shapes#2: The bounty's own shape still spends needless bundles: about 0.9 ₳ more in fees than one input; with other ADA beside, up to 3.68 ₳ more in fees and 2.93 ₳ more paid

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `seedelf-platform/seedelf-core/src/build.rs:2949`
- **Since:** unchanged from 1.9.0

**What.** Core's `holding` (build.rs:2949) takes, "for each token in turn, the UTxOs holding the most of it". Its own doc says "as few of `available` as together hold `needed`", which isn't true here. It is reached from the wallet's `Room::picks` (wasm lib.rs:3915-3929, `build::max_inputs_by` → build.rs:2915) and from core's one-transaction `select_script_inputs` (build.rs:2558).

In the bounty's shape every token is held most by its bundle of 20, so every part (and the first one-transaction try) takes bundles whose 19 other tokens stay, though the UTxO holding the ADA holds all that's asked. The bundles make the transaction near 16 KB and leave less room, so with other ADA beside, the planner splits the tokens across parts. Each part pays its own outputs' least, so the recipient gets more than asked too. That stays within the lane's bound, because the split brings its own leasts.

#384's test checks only the totals, against asked.max(leasts), not inputs or fees. In 1.9.0 the same bundles were spent, plus the trailing part. #384 removed the trailing part, the larger cost the reporter saw, but in this exact shape about 0.9 ₳ of fees is still left.

The 8 rows on 1.9.1 where the last two parts go as one transaction are this shape, all with the same plan in 1.9.0. The tokens' part takes bundles, and a chain's last part of tokens carries rather than adding a UTxO of ADA alone (fit_part only grows `ada` when both its amount and its carry are short), leaving a part of ADA alone after it.

**Scenario.** - The bounty's shape: 10 token kinds, 2 of each asked, held by the UTxO with 300 ₳; asked 0.
  - 1.9.1 to a Seedelf: 1 part, 10 inputs (9 bundles and it), 16,000 bytes, fee 1.165394 ₳. One transaction of that UTxO alone pays it for 0.263040 ₳.
  - To an address: 1.161742 against 0.259388 ₳.
  - 1.9.0: the same 10 inputs (fee 1.171994) plus a trailing part (1.456780 paid, fee 0.233912).
- n = 30: 9 inputs, 15,830 bytes, fee 1.129168 against 0.327808 ₳.
- Worst case: n = 30, the tokens' UTxO 0.15 ₳ past its least, one 50 ₳ UTxO, asked 0, to a Seedelf. 4 parts, 34 inputs, fees 4.046 ₳, paid 14.395400 ₳, where 2 inputs pay 11.464600 for 0.364 ₳ (6.6 ₳ more in all).
- Over the 1,433 q = 2 rows that went in 1.9.1: every one is costlier than the single transaction. Extra fees run from 0.46 to 3.68 ₳; 615 rows use more than one part; 464 pay the recipient more, up to 2.93 ₳.
- Needless-part example: a Seedelf, asked least + 3 ₳, with three 1.757 ₳ UTxOs. 7 + 3 inputs, fees 0.804154 + 0.306190, where one transaction of 8 inputs costs 0.833692.

**Evidence.** Code: core build.rs:2949-2960 (`fn holding`: `candidates.sort_by_key(|u| std::cmp::Reverse(quantity_in(u, &policy, &name)));` per token). build.rs:2915 (`let mut taken = holding(&fits, needed)?;` in `max_inputs_by`). build.rs:2558 (`let mandatory = holding(available, needed)?;` in `select_script_inputs`). wasm lib.rs:3929 (`Ok(build::max_inputs_by(&from, &assets_of(share)?, at_most, |u| worth.of_utxo(u))?.0)`).

Runs:
- bounty_shapes_* on 1.9.1: `[Seedelf] 1206 runs: 0 with problems, 296 refused, 0 topped up, 3 with a needless part, 521 costlier than one transaction`. `[Address] 1218 runs: ... 4 with a needless part, 533 costlier`. `[Funding] 1161 runs: ... 1 with a needless part, 379 costlier`.
- Line: `ok [Seedelf] n10 rich+300ADA free[none] q2 asked 0 (0) ... 1 part(s) [10in/16000B/v1329/p4.310000/t10/f1.165394]` with `~ COSTLIER 1 part(s), 10 inputs, fees 1165394; one transaction of 1 inputs pays it for 263040`.
- costlier.py over the logs: `n30 Seedelf rows 218 >1 part 139 extra fee min 0.460 max 3.683 ... extra paid ... max 2.931`, and `worst: Seedelf n30 rich+fee-ish 0.15 free[50ADA] q2 0 4p 34in fees 4.046 paid 14.395400 | one: 2in fee 0.364 paid 11.464600`.

Focused test (fails on 1.9.1 with `left: (1, 10) right: (1, 1)`; on 1.9.0 with a part after paid):
```rust
#[test]
fn the_bounty_shape_spends_the_utxo_holding_the_ada_alone() {
    let sk = seedelf_key_v1(PHRASE, 0).unwrap();
    let pp = ProtocolParameters::from_koios(&params()).unwrap();
    let recorded = fixture("../extension/tests/fixtures/transfer-preprod.json");
    let utxos = bounty_utxos(10, 300_000_000, &[], &pp);
    let sold: Vec<(Tok, u128)> = (0..10).map(|k| (btoken(k), 2)).collect();
    for to in [To::Seedelf, To::Address] {
        let o = pay(&utxos, sk, to, 0, &sold, &recorded);
        assert!(o.ok && o.problems.is_empty(), "{to:?}: {} {:?}", o.line, o.problems);
        let inputs: usize = o.parts.iter().map(|p| p.inputs.len()).sum();
        assert_eq!((o.parts.len(), inputs), (1, 1), "{to:?}: {}", o.line);
    }
}
```

`bounty_utxos`, `btoken`, `pay`, `one` and `one_fewer` are in the lane's file: SCRATCH/review-1.9.1/shapes/payment_parts_shapes_test.shapes-lane.rs

**Suggestion.** Wallet side (no CLI change): in `Room::picks`, hand `max_inputs_by` only the fewest group UTxOs, by worth, that together hold the share (plus `free`), so `holding` can't reach for bundles. Optionally, in a chain's last part of tokens, try `for_ada` before falling back to the carry.

Core side: make `holding` prefer a UTxO holding enough of several tokens, and fix its doc. This changes the CLI's selection too, so it's the owner's call.

Pin it with the focused test, and extend #384's api_test to assert the inputs or fee.

## Checked and holds

- #384 ends a chain once it's paid. In 3,585 runs of the bounty's shapes on 1.9.1 there are 0 parts after the payment was paid, 0 top-ups and 0 overpays. On 1.9.0 there were 167, 562 and 39.
- The top-up, counted apart as asked. On 1.9.0 it hit 562 of 2,487 bounty payments that went (22.6%), from 1 lovelace to 1.456780 ₳, mean 0.755934 ₳, at every ask from 0 to least + least([]) - 1. On 1.9.1 there were none: not in the bounty runs, not in 1,136 runs of a fine sweep (20,000-lovelace steps) of the ADA UTxO beside 12 whole move-in bundles (316 of them chained), not in 224 runs of a spread token before UTxOs of ADA alone, and not in 960 NFT runs.
- The new lovelace bound fails on 1.9.0 where #384's own suite check is blind (asked least + 1: a TOPUP of 0.978369 ₳ to an address) and passes on 1.9.1. That's a test that fails before the fix and passes after it.
- No regression. Of the 2,487 bounty rows both versions built, none that 1.9.0 built is refused by 1.9.1, and 104 that 1.9.0 refused now go as one part (e.g. the tokens' UTxO 2 ₳ past its least, with nothing beside).
- The plans change for the better overall. Where the asked amount is the same (2,225 rows), 1.9.1 is cheaper in fees + paid in 727 rows (up to 1.806 ₳, 561.5 ₳ in all) and dearer in 22 (at most 0.870 ₳). Each dearer row traded a chain, or 1.9.0's top-up part, for independent parts with higher fees (the owner's 'chains only where needed'), or split the tokens differently. All of them are in shapes#2's shapes. Not a defect.
- A session's funding pays its 5 ₳ collateral in the first part of every plan: 1,161 funding runs, none flagged by the check that the first part pays at least the collateral.
- A chain's carries pay exactly their share's least. No chained plan on 1.9.1 pays over max(asked, the parts' leasts).
- The boundary asks (least + fee ± 1, least + fee + least([]), least + least([]) - 1/0/+1) behave like their neighbours on 1.9.1: no overpay, and none refused where a neighbour goes.
- The main suite with the new bound gives the same result on 1.9.0 and 1.9.1: 2 overpaid (shapes#1, token boxes x90 at 600‰), 108 refused, 0 Max refused. Its 4 notes are an artifact (0‰ of one NFT rounds to an ask of nothing, raised to an output's least by design).

## Coverage

I didn't write report.md: the Write tool refuses report files from a subagent, so this output is the report.\n\nWhat I ran:\n- Worktrees at 3063b33f and c0b451a8, each with its own target dir: ~/.cache/seedelf-review-1.9.1/shapes and shapes-190. Both worktrees are removed now.\n- Release builds of payment_parts_shapes_test with my additions, the same file on both versions.\n\nA trap other lanes may hit: cargo hashes workspace members by their path relative to the workspace root. Building a second worktree into the same target dir silently linked 1.9.1's seedelf-wasm into the \"1.9.0\" test binary. I caught it by checking that the two binaries differ on the bounty shape, and rebuilt 1.9.0 in its own target dir.\n\nThe sweeps:\n- Bounty shapes: n ∈ {10, 30}; 10 sizes of the ADA UTxO; 3 sets of UTxOs of ADA alone; 2 of each token, or all of each (n = 10 only); 14 asks; 3 recipients (Seedelf, address, funding). 3,585 runs on 1.9.1 and 3,525 on 1.9.0 (the fee-based asks adapt to each version).\n- Token boxes: 42, 61, 90 or 150 boxes, 100% or 75% of the MIN, 15 asks, 2 recipients.\n- Top-up hunts in 1.9.1: an NFT chain (never chained, so it didn't reach the path), a bundle-chain window sweep, and a spread token before UTxOs of ADA alone.\n\nNot covered:\n- Histories. Every run uses empty classes, so Worth::apart and by_history_first's history orders aren't exercised. shapes#1's keep is in the same in_parts they call.\n- Max and Everything aren't bounded, since there is no asked amount.\n- All of each token for n = 30, and asks between 2 and all.\n- The 1.9.0 run of the bundle-chain window sweep, which I stopped. It would only show the top-up #384 already fixed.\n- The TypeScript review (whole(), the minimum note). I only read it, to say what the user sees.\n- By reading the code I believe a top-up can still happen in two places: in chained, when the last part of tokens' amount is short on a dust change while its carry goes; and in in_parts, when the last part of tokens pays only its least and only parts of ADA alone follow. In both, an earlier amount(carry + rest) or amount(rest) pays the remainder whenever what's left fits one transaction, and no shape I tried got past it.\n\nFiles, all in SCRATCH/review-1.9.1/shapes/:\n- Test file: payment_parts_shapes_test.shapes-lane.rs\n- Diff against 3063b33f: payment_parts_shapes_test.diff\n- Logs: run-190.log, run-3063-b.log, run-3063-mainsuite-oldbin.log, bchain2-3063.log, spread-3063.log, nft-190.log, nft-3063.log\n- Comparison scripts: compare_rows.py, costlier.py, cost_diff2.py
