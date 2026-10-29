# v-pr333-2-trace: pr333#2, flows.md and architecture.md still say a dearer byte lowers the private Bootstrap's cap

**Verdict: confirmed. Severity: low** (as the finding says). Confidence: high.

I tried to refute it on HEAD (`6bca8bec`) and couldn't. Every part of it holds. A scratch test asserting what each doc line says fails on HEAD, all three ways. A sweep of other kinds of "dearer byte" finds none that lowers HEAD's cap, so architecture.md's "fewer at a dearer byte" is wrong under every reading I tried, not only the 6,465 one.

## What the docs say on HEAD

- **`docs/flows.md:523`** (the Bootstrap bullet). #333 edited it, but only to add "at today's prices" to "3 ₳ of reserves". The rest is as it stood before #333:
  - "That payment carries the boxes, 1.5 ₳ for the deposit's fee and change, and **1.5 ₳ for returning the rest**, a sweep with no collateral; the wallet measures how many by building both, **one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)**".
  - "…but one *For returning the rest* **(1.5 ₳, and what it doesn't use comes back)**".
- **`docs/architecture.md:672`** has both claims in one paragraph:
  - First, "(`privateBootstrapMost`, WebAssembly's `lovejoinBootstrapMost`, which builds both for each count: one deposit's most under today's parameters, **fewer at a dearer byte**)".
  - Then, a few sentences on, the text #333 added: "never less than `BOOTSTRAP_BACK_RESERVE` (1.5 ₳, today's), **so a dearer byte doesn't lower the cap** (1.8 ₳ at 6,465 lovelace a byte, where a fixed 1.5 ₳ held it to 68 classic boxes; 1.7.0)".
- **#333 rewrote this exact phrase in code, but not in the doc.** It changed `privateBootstrapMost`'s comment from "under today's parameters one deposit's most, fewer at a dearer byte" to "one deposit's most, at a dearer byte too" (`extension/src/background/lovejoin.ts:2942`). architecture.md kept the old wording.

## What the code does on HEAD

- **The reserve.** `seedelf-core/src/lovejoin/mod.rs:1744-1751` has `bootstrap_back_reserve(params)`. It adds up three things:
  - the Seedelf output's least,
  - the sweep's fee,
  - `linear_fee(params, MAX_TX_SIZE)`, the most any deposit's fee can be.

  It takes `DEPOSIT_RESERVE` off that sum, rounds up to a tenth of an ADA, and never goes below `.max(BOOTSTRAP_BACK_RESERVE)`, the 1.5 ₳ floor. Because the largest deposit's fee is counted in, the reserve covers any deposit at any price.
- **The cap.** `bootstrap_most` calls `let back = bootstrap_back_reserve(params)?;` (`:1974`) and funds every count it tries with `.checked_add(back)` (`:1990`).
- **The WebAssembly passes straight through.** `lovejoinBootstrapMost` calls `bootstrap_most_in`, which calls `lovejoin::bootstrap_most` (`wasm/src/lovejoin.rs:2014-2018`). `lovejoinBootstrapReserve(params)` calls `bootstrap_back_reserve` (`wasm/src/lib.rs:5767-5773`).
- **The worker.** Both the form's bounds and the review use the parameters the review read:
  - The form's bounds come from `privateBootstrapBounds` (`lovejoin.ts:2963-2967`). It reads the parameters once and passes them to `privateBootstrapMost` and `lovejoinBootstrapReserve`.
  - The funding adds `const back = mix.bootstrap ? BigInt(this.deps.wasm.lovejoinBootstrapReserve(JSON.stringify(params))) : 0n;` (`sessions.ts:2096`), from those same parameters.
  - The review's *For returning the rest* row shows `summary.bootstrapReserve`, which is that `back` (`ui/screens/Lovejoin.tsx:3798`). At 6,465 the row would read "1.8 ₳, and what it doesn't use comes back".
- **HEAD's own tests already say so.**
  - `extension/tests/lovejoin-flows.test.ts:507`: `expect(await lj.privateBootstrapBounds("preprod")).toEqual({ most: 96, back: "1800000" });` at `coins_per_utxo_size: "6465"`.
  - `:510`: `expect(funded.bootstrapReserve).toBe("1800000");`.
  - `seedelf-core/tests/lovejoin_pools_test.rs:1809`: `bootstrap_most(&dear, &classic, true, 96)` is 96.

  I ran the flows case on this tree (`npx vitest run tests/lovejoin-flows.test.ts -t "caps a Bootstrap from the private balance"`), and it passed: 1 passed, 32 skipped. So the built module in `wasm/pkg` gives the same figures as core's source.

## Repro

I wrote a scratch test, `seedelf-platform/seedelf-core/tests/zz_review_v-pr333-2-trace_1.rs`. I ran it with `cargo test --locked -p seedelf-core --test zz_review_v-pr333-2-trace_1 -- --nocapture --test-threads=1`, and have since deleted it. It has four tests:

- **One test asserts each doc's claim. All three FAIL on HEAD:**
  - `doc_flows_says_68_classic_at_6465`: `left: 96, right: 68`.
  - `doc_flows_says_way_back_is_a_flat_1_5`: `left: 1800000, right: 1500000`.
  - `doc_architecture_says_fewer_at_a_dearer_byte`: `assertion failed: lovejoin::bootstrap_most(&dear, &classic, true, 96).unwrap() < 96`.
- **`what_head_does` (passes).** For each pool and price it computes three caps, then asserts the figures the finding cites:
  - HEAD's cap;
  - a copy of `bootstrap_most`'s search, which matches HEAD's at every row;
  - the same search with the fixed 1.5 ₳ of before #333.

  The figures it asserts:
  - 6,465 is `4,310 × 3/2`;
  - the reserve is 1.5 ₳ today and exactly 1.8 ₳ at 6,465;
  - the cap at 6,465 is 96 classic boxes;
  - a fixed 1.5 ₳ gives exactly 68 there, the figure flows.md still quotes.

| Parameters | Way back's reserve | HEAD's cap: classic, preprod / mainnet | HEAD's cap: LJTEST | Fixed 1.5 ₳'s cap: classic / LJTEST |
|---|---|---|---|---|
| today (44, 4,310) | 1.5 ₳ | 96 / 96 | 64 | 96 / 64 |
| UTxO byte ×1.5 (6,465) | **1.8 ₳** | **96** / 96 | **64** | **68** / 51 |
| UTxO byte ×2 | 2.5 ₳ | 96 / 96 | 64 | 0 / 0 |
| UTxO byte ×3 | 4.0 ₳ | 96 / 96 | 64 | 0 / 0 |
| tx byte ×1.5 (`min_fee_a` 66) | 1.5 ₳ | 96 / 96 | 64 | 96 / 64 |
| tx byte ×2 | 1.8 ₳ | 96 / 96 | 64 | 88 / 64 |
| tx byte ×3 | 2.5 ₳ | 96 / 96 | 64 | 58 / 43 |
| both ×1.5 | 2.2 ₳ | 96 / 96 | 64 | 44 / 33 |
| both ×2 | 3.3 ₳ | 96 / 96 | 64 | 0 / 0 |

So on HEAD no dearer byte lowers the cap, whether it's the UTxO byte, the transaction byte or both. "Fewer at a dearer byte" is false under every reading. The later sentence, "a dearer byte doesn't lower the cap", is the true one. architecture.md's history clause, "a fixed 1.5 ₳ held it to 68 classic boxes", is accurate (68 in the classic pool, and 51 of LJTEST, as core's own comment says), and can stay.

## How narrow it is

- **Today's figure is right.** At today's parameters, 4,310 and 44, the reserve is 1.5 ₳ on both networks' fixtures (`lovejoin_pools_test.rs` asserts both). So flows.md's "1.5 ₳ for returning the rest" and the review row's "(1.5 ₳, …)" are correct today. They are missing a qualifier, and the same bullet already says "3 ₳ of reserves at today's prices".
- **The parenthetical is plainly wrong.** "(68 in the classic pool at 6,465 lovelace a byte …)" gives a number HEAD never produces: at 6,465 the cap is 96.
- **The architecture.md part is a self-contradiction** within one paragraph.
- **The finding's scenario is hypothetical.** Mainnet is at 4,310, so a reader is misled only about what happens at a dearer byte, and no user or money is affected. Docs that disagree with the code are in scope, so it's **low**, as filed.

## Fix advice

The finding's fix is right. To keep it short:

- **flows.md:523:** "…1.5 ₳ for the deposit's fee and change, and a reserve for returning the rest, priced from the network's parameters (1.5 ₳ today, 1.8 ₳ at 6,465 lovelace a byte), a sweep with no collateral; the wallet measures how many by building both: one deposit's most, at a dearer byte too (a fixed 1.5 ₳ held it to 68 classic boxes at 6,465; 1.7.0)". The 68 can also be dropped altogether. The review row becomes "(1.5 ₳ today, and what it doesn't use comes back)".
- **architecture.md:672:** replace ", fewer at a dearer byte" with ", at a dearer byte too", the same edit #333 made to `lovejoin.ts:2942`. The rest of the paragraph is accurate.
- **Next door, not part of this finding:** `docs/post-release-roadmap.md:378` (*Kept in mind*) also still says, in the present tense, "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳, so a dearer byte lowers the cap (68 classic boxes, and 51 of LJTEST, at 6,465 lovelace a byte)". On the list, item 4 at `:38` still shows only its overflow half ✅. These are list ticks, which v-pr329-0-trace's finding already covers for the release-prep docs commit. That commit can fix this wording in the same pass.

Scratch files: the Rust test above, now deleted. Nothing tracked was edited.
